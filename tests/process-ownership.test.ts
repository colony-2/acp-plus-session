import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// Actual kernel primitives; this is intentionally not a mocked kill/wait test.
async function harness(t: any) {
  assert.equal(process.platform, 'linux', 'The current ownership harness requires Linux');
  const root = await mkdtemp(join(tmpdir(), 'owner-harness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = join(root, 'reaper');
  execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', resolve('tests/platform/linux-subreaper.c'), '-o', helper]);
  return { root, helper };
}
async function waitForFile(path: string) {
  for (let i = 0; i < 200; i++) {
    try { return await readFile(path, 'utf8'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    await delay(10);
  }
  throw new Error('Fixture failed to start');
}
function expectAbsent(pid: number) {
  assert.throws(() => process.kill(pid, 0), (error: any) => error.code === 'ESRCH', `Owned PID ${pid} must have been reaped`);
}

test('leader exit reaps a detached TERM-ignoring writer and closes inherited pipes', { timeout: 10000 }, async t => {
  const { root, helper } = await harness(t);
  const ready = join(root, 'ready'), marker = join(root, 'writes');
  const writer = join(root, 'writer.mjs'), leader = join(root, 'leader.mjs');
  await writeFile(writer, `import fs from 'node:fs'; process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),10);`);
  await writeFile(leader, `import{spawn}from'node:child_process';import fs from'node:fs';const c=spawn(process.execPath,[${JSON.stringify(writer)}],{detached:true,stdio:'inherit'});c.unref();const i=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(i);process.exit(0)}},10);`);
  const child = spawn(helper, [process.execPath, leader], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: Buffer[] = []; child.stderr.on('data', b => stderr.push(b)); child.stdout.resume();
  const exited = once(child, 'close');
  const pid = Number(await waitForFile(ready));
  const [code] = await exited;
  assert.equal(code, 0, Buffer.concat(stderr).toString()); expectAbsent(pid);
  assert.ok(Buffer.concat(stderr).toString().match(/reaped pid=/g)!.length >= 2);
  const size = (await stat(marker)).size; await delay(100); assert.equal((await stat(marker)).size, size);
});
test('supervisor cancellation reaps the live leader and its detached descendant', { timeout: 10000 }, async t => {
  const { root, helper } = await harness(t);
  const ready = join(root, 'ready'), leaderReady = join(root, 'leader-ready');
  const writer = join(root, 'writer.mjs'), leader = join(root, 'leader.mjs');
  await writeFile(writer, `import fs from'node:fs';process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},10);`);
  await writeFile(leader, `import{spawn}from'node:child_process';import fs from'node:fs';process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(leaderReady)},String(process.pid));spawn(process.execPath,[${JSON.stringify(writer)}],{detached:true,stdio:'inherit'});setInterval(()=>{},10);`);
  const child = spawn(helper, [process.execPath, leader], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: Buffer[] = []; child.stderr.on('data', b => stderr.push(b)); child.stdout.resume();
  const exited = once(child, 'close');
  const pid = Number(await waitForFile(ready)), leaderPid = Number(await waitForFile(leaderReady));
  child.kill('SIGTERM'); const [code] = await exited;
  assert.equal(code, 143, Buffer.concat(stderr).toString()); expectAbsent(pid); expectAbsent(leaderPid);
});
