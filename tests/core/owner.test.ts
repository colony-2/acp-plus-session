import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { startOwned } from '../../src/runtime/process.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { DescriptorHandle } from '../../src/runtime/filesystem.ts';
import { localClient } from '../../src/client.ts';
import { waitForPid, pidAbsent } from '../fixtures/pid-readiness.mjs';
const fixtureImport = `import { publishPid, waitForPid, pidAbsent } from ${JSON.stringify(new URL('../fixtures/pid-readiness.mjs', import.meta.url).href)};`;

test('fast terminal output survives descriptor-close backpressure before terminal admission', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fast-terminal-')); t.after(() => rm(root, { recursive: true, force: true }));
  const originalClose = DescriptorHandle.prototype.close;
  t.mock.method(DescriptorHandle.prototype, 'close', async function(this: DescriptorHandle) {
    await delay(200); await originalClose.call(this);
  });
  const client = localClient(root, resolve('artifacts/native/owner'));
  const { terminalId } = await client.call('terminal/create', { command: '/bin/sh', args: ['-c', 'printf fast-output; printf fast-error >&2'] });
  try {
    const result = await client.call('terminal/wait_for_exit', { terminalId });
    assert.equal(result.exitCode, 0);
    const { output } = await client.call('terminal/output', { terminalId });
    assert.ok(output.includes('fast-output'), output); assert.ok(output.includes('fast-error'), output);
  } finally { await client.call('terminal/release', { terminalId }); }
});

test('owned terminal starts from an inherited directory descriptor after pathname substitution', async t => {
  const root = await mkdtemp(join(tmpdir(), 'owned-cwd-')); t.after(() => rm(root, { recursive: true, force: true }));
  const owner = join(root, 'owner'); execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', 'native/owner.c', '-o', owner]);
  const workspace = join(root, 'workspace'); await mkdir(workspace, { mode: 0o700 });
  await writeFile(join(workspace, 'context'), 'original');
  const directory = await open(workspace, constants.O_RDONLY | constants.O_DIRECTORY);
  await rename(workspace, join(root, 'relocated')); await mkdir(workspace, { mode: 0o700 });
  await writeFile(join(workspace, 'context'), 'substituted');
  const process = startOwned(owner, globalThis.process.execPath, ['-e', "require('fs').writeSync(1,require('fs').readFileSync('context'))"], { cwdFd: directory.fd });
  await directory.close(); process.input.end();
  let text = ''; process.output.on('data', chunk => { text += chunk; }); t.after(() => process.stop());
  const result = await process.done; assert.equal(result.code, 0, result.diagnostics); assert.equal(text, 'original');
});

test('S06/E09: cancellation reaps TERM-resistant detached writers within the client wait', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cancel-owner-'));
  let child: ReturnType<typeof startOwned> | undefined;
  t.after(async () => { await child?.stop(true); await rm(root, { recursive: true, force: true }); });
  const owner = resolve('artifacts/native/owner');
  await writeFile(join(root, 'writer.mjs'), `${fixtureImport}import fs from'node:fs';process.on('SIGTERM',()=>{});fs.appendFileSync('writes','x');setInterval(()=>fs.appendFileSync('writes','x'),10);await publishPid('writer-pid');`);
  await writeFile(join(root, 'leader.mjs'), `${fixtureImport}import{spawn}from'node:child_process';process.on('SIGTERM',()=>{});spawn(process.execPath,['writer.mjs'],{detached:true,stdio:'inherit'});setInterval(()=>{},100);await publishPid('leader-pid');`);
  child = startOwned(owner, process.execPath, ['leader.mjs'], { cwd: root }); child.output.resume();
  const pids = await Promise.all(['leader-pid', 'writer-pid'].map(name => waitForPid(join(root, name))));
  assert.ok((await readFile(join(root, 'writes'))).length > 0);
  const started = performance.now();
  const graceful = child.stop(); // Cancellation also upgrades an existing graceful shutdown.
  assert.equal(child.stop(true), graceful);
  await graceful; // Includes the private completion marker and waitpid confirmation.
  assert.ok(performance.now() - started < 2000, 'reaping must finish before acpx closes its 2.5s cancellation wait');
  for (const pid of pids) assert.ok(pidAbsent(pid));
  const bytes = await readFile(join(root, 'writes')); await delay(50);
  assert.deepEqual(await readFile(join(root, 'writes')), bytes);
});

test('S06: cancellation before owner readiness waits for the private handshake', { timeout: 10000 }, async () => {
  for (let i = 0; i < 10; i++) {
    const child = startOwned(resolve('artifacts/native/owner'), process.execPath, ['-e', 'setInterval(()=>{},100)'], {});
    await child.stop(true);
    assert.equal((await child.done).code, 128 + 10); // Linux SIGUSR1, owner reaped its child.
  }
});

test('S06/D10: parent crash triggers installed owner cleanup while an outer owner keeps the test tree reaped', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'product-owner-'));
  let outer: ReturnType<typeof startOwned> | undefined;
  t.after(async () => { await outer?.stop(true); await rm(root, { recursive: true, force: true }); });
  const owner = join(root, 'owner'); execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', 'native/owner.c', '-o', owner]);
  await writeFile(join(root, 'writer.mjs'), `${fixtureImport}import fs from'node:fs';process.on('SIGTERM',()=>{});fs.appendFileSync('writes','x');setInterval(()=>fs.appendFileSync('writes','x'),10);await publishPid('writer-pid');`);
  await writeFile(join(root, 'native.mjs'), `${fixtureImport}import{spawn}from'node:child_process';spawn(process.execPath,['writer.mjs'],{detached:true,stdio:'inherit'});setInterval(()=>{},100);await publishPid('native-pid');`);
  await writeFile(join(root, 'wrapper.mjs'), `import{spawn}from'node:child_process';spawn(${JSON.stringify(owner)},[process.execPath,'native.mjs'],{stdio:['ignore','inherit','inherit','pipe']});setInterval(()=>{},100);`);
  // This leader remains alive while the inner owner handles parent death.
  // Thus the outer owner cannot mask a missing parent-death implementation.
  await writeFile(join(root, 'leader.mjs'), `${fixtureImport}import{spawn}from'node:child_process';import fs from'node:fs';const wrapper=spawn(process.execPath,['wrapper.mjs'],{stdio:'inherit'});const keepAlive=setInterval(()=>{},100);const pids=await Promise.all(['writer-pid','native-pid'].map(path=>waitForPid(path)));wrapper.kill('SIGKILL');const deadline=performance.now()+15000;const timer=setInterval(()=>{if(pids.every(pidAbsent)){fs.writeFileSync('result','reaped-before-outer-stop');clearInterval(timer);clearInterval(keepAlive);process.exit(0);}if(performance.now()>deadline){console.error('Parent-crash cleanup timed out for PIDs',pids);process.exit(1);}},20);`);
  outer = startOwned(owner, process.execPath, [join(root, 'leader.mjs')], { cwd: root, env: { PATH: '/usr/bin:/bin' } }); outer.input.end(); outer.output.resume();
  const result = await outer.done; assert.equal(result.code, 0, result.diagnostics);
  assert.equal(await readFile(join(root, 'result'), 'utf8'), 'reaped-before-outer-stop');
  for (const file of ['writer-pid', 'native-pid']) assert.ok(pidAbsent(await waitForPid(join(root, file))));
  const bytes = await readFile(join(root, 'writes')); assert.ok(bytes.length > 0); await delay(50);
  assert.deepEqual(await readFile(join(root, 'writes')), bytes);
});
