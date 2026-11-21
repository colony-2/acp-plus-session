import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForPid, pidAbsent, parsePidRecord, validatePid, publishPid, readPidRecord } from './fixtures/pid-readiness.mjs';
import { readingRegression, publisher, bounded } from './fixtures/pid-readiness-regression.mjs';
const fixtureImport = `import { publishPid, waitForPid } from ${JSON.stringify(new URL('./fixtures/pid-readiness.mjs', import.meta.url).href)};`;

// Actual kernel primitives; this is intentionally not a mocked kill/wait test.
async function harness(t: any) {
  assert.equal(process.platform, 'linux', 'The current ownership harness requires Linux');
  const root = await mkdtemp(join(tmpdir(), 'owner-harness-'));
  const children: { child: ReturnType<typeof spawn>; exited: Promise<any> }[] = [];
  t.after(async () => {
    for (const { child, exited } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await bounded(exited, 'ownership harness cleanup');
    }
    await rm(root, { recursive: true, force: true });
  });
  const helper = join(root, 'reaper');
  execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', resolve('tests/platform/linux-subreaper.c'), '-o', helper]);
  return { root, helper, cleanup(child: ReturnType<typeof spawn>, exited: Promise<any>) { children.push({ child, exited }); } };
}
function expectAbsent(pid: number) {
  assert.ok(pidAbsent(pid), `Owned PID ${pid} must have been reaped`);
}

test('leader exit reaps a detached TERM-ignoring writer and closes inherited pipes', { timeout: 10000 }, async t => {
  const { root, helper, cleanup } = await harness(t);
  const ready = join(root, 'ready'), marker = join(root, 'writes');
  const writer = join(root, 'writer.mjs'), leader = join(root, 'leader.mjs');
  await writeFile(writer, `${fixtureImport}import fs from 'node:fs'; process.on('SIGTERM',()=>{}); fs.appendFileSync(${JSON.stringify(marker)},'x'); setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),10); await publishPid(${JSON.stringify(ready)});`);
  await writeFile(leader, `${fixtureImport}import{spawn}from'node:child_process';const c=spawn(process.execPath,[${JSON.stringify(writer)}],{detached:true,stdio:'inherit'});c.unref();const i=setInterval(()=>{},10);await waitForPid(${JSON.stringify(ready)});clearInterval(i);process.exit(0);`);
  const child = spawn(helper, [process.execPath, leader], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: Buffer[] = []; child.stderr.on('data', b => stderr.push(b)); child.stdout.resume();
  const exited = once(child, 'close'); cleanup(child, exited);
  const pid = await waitForPid(ready);
  const [code] = await exited;
  assert.equal(code, 0, Buffer.concat(stderr).toString()); expectAbsent(pid);
  assert.ok(Buffer.concat(stderr).toString().match(/reaped pid=/g)!.length >= 2);
  const size = (await stat(marker)).size; assert.ok(size > 0); await delay(100); assert.equal((await stat(marker)).size, size);
});
test('supervisor cancellation reaps the live leader and its detached descendant', { timeout: 10000 }, async t => {
  const { root, helper, cleanup } = await harness(t);
  const ready = join(root, 'ready'), leaderReady = join(root, 'leader-ready');
  const writer = join(root, 'writer.mjs'), leader = join(root, 'leader.mjs');
  await writeFile(writer, `${fixtureImport}process.on('SIGTERM',()=>{});setInterval(()=>{},10);await publishPid(${JSON.stringify(ready)});`);
  await writeFile(leader, `${fixtureImport}import{spawn}from'node:child_process';process.on('SIGTERM',()=>{});spawn(process.execPath,[${JSON.stringify(writer)}],{detached:true,stdio:'inherit'});setInterval(()=>{},10);await publishPid(${JSON.stringify(leaderReady)});`);
  const child = spawn(helper, [process.execPath, leader], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: Buffer[] = []; child.stderr.on('data', b => stderr.push(b)); child.stdout.resume();
  const exited = once(child, 'close'); cleanup(child, exited);
  const pid = await waitForPid(ready), leaderPid = await waitForPid(leaderReady);
  child.kill('SIGTERM'); const [code] = await exited;
  assert.equal(code, 143, Buffer.concat(stderr).toString()); expectAbsent(pid); expectAbsent(leaderPid);
});


async function readinessRoot(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'pid-record-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('PID records accept only canonical complete safe PIDs greater than one', () => {
  for (const pid of [2, process.pid, Number.MAX_SAFE_INTEGER]) assert.equal(parsePidRecord(`${pid}\n`), pid);
  for (const prefix of ['', '1', '12', String(process.pid), String(Number.MAX_SAFE_INTEGER)]) assert.equal(parsePidRecord(prefix), null);
  for (const record of ['0', '0\n', '1\n', '-2\n', '+2\n', ' 2\n', '2 \n', '02', '02\n', 'a', '2x', '2\r\n', '2\n3\n', '2\n\n', '9007199254740992', '9007199254740992\n', '2'.repeat(18), '2\0\n']) assert.throws(() => parsePidRecord(record), /Malformed fixture PID/);
});
test('invalid process identities fail before the process syscall', t => {
  const kill = t.mock.method(process, 'kill', () => { throw new Error('must not call kill'); });
  for (const pid of [0, 1, -2, NaN, Infinity, 2.1, Number.MAX_SAFE_INTEGER + 1, '2']) {
    assert.throws(() => validatePid(pid as number), /Invalid fixture PID/);
    assert.throws(() => pidAbsent(pid as number), /Invalid fixture PID/);
  }
  assert.equal(kill.mock.callCount(), 0);
});
test('readiness distinguishes missing records, filesystem errors, malformed data and explicit timeouts', async t => {
  const root = await readinessRoot(t), path = join(root, 'ready');
  assert.equal(await readPidRecord(path), undefined);
  for (const record of [undefined, '', '12', String(process.pid)]) {
    if (record !== undefined) await writeFile(path, record);
    await assert.rejects(waitForPid(path, { timeoutMs: 20 }), error => {
      assert.match(String(error), /Timed out waiting for fixture PID/);
      assert.ok(String(error).includes(path));
      assert.ok(String(error).includes(record === undefined ? 'missing' : JSON.stringify(record)));
      return true;
    });
  }
  await writeFile(path, '0\n'); await assert.rejects(waitForPid(path), /Malformed fixture PID/);
  await writeFile(path, '2'.repeat(1024 * 1024)); await assert.rejects(waitForPid(path), /Malformed fixture PID/);
  await assert.rejects(waitForPid(join(path, 'not-a-file')), { code: 'ENOTDIR' });
});
test('barriers keep empty, partial and unterminated PID records pending until completion', { timeout: 10000 }, async () => {
  await readingRegression();
});
test('the original reader fails the same empty and partial observation assertions', { timeout: 10000 }, async t => {
  for (const stage of ['empty', 'partial']) {
    await assert.rejects(promisify(execFile)(process.execPath, [new URL('./fixtures/pid-readiness-regression.mjs', import.meta.url).pathname, 'original', stage], { timeout: 5000 }), (error: any) => {
      assert.equal(error.code, 1);
      assert.ok(error.stderr.includes(`premature readiness for ${stage} record`), error.stderr);
      t.diagnostic(`Original reader: expected failure, premature readiness for ${stage} record`);
      return true;
    });
  }
});
test('atomic publisher hides empty, partial and closed temporary records until rename', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pid-atomic-')), path = join(root, 'ready'), writer = publisher('atomic', path);
  // Stop before removing the fixture directory, including assertion failures.
  t.after(async () => { await writer.stop(); await rm(root, { recursive: true, force: true }); });
  writer.release();
  for (const stage of ['empty', 'partial', 'closed']) {
    const event = await writer.next(); assert.equal(event.stage, stage);
    assert.equal(resolve(event.temporary, '..'), root, 'temporary must be a sibling');
    assert.equal(await readPidRecord(path), undefined);
    const temporary = await readFile(event.temporary, 'utf8');
    if (stage === 'empty') assert.equal(temporary, '');
    else if (stage === 'partial') assert.equal(temporary, String(writer.child.pid).slice(0, Math.max(1, Math.floor(String(writer.child.pid).length / 2))));
    else assert.equal(temporary, `${writer.child.pid}\n`);
    let observed = false;
    await assert.rejects(waitForPid(path, { timeoutMs: 0, onObservation: (record, pid) => { assert.equal(record, undefined); assert.equal(pid, null); observed = true; } }), /Timed out/);
    assert.ok(observed);
    writer.release();
  }
  assert.equal((await writer.next()).stage, 'done');
  assert.equal(await readFile(path, 'utf8'), `${writer.child.pid}\n`);
  assert.equal(await waitForPid(path), writer.child.pid);
  assert.deepEqual(await bounded(writer.closed, 'atomic publisher close'), [0, null]);
  assert.deepEqual(await readdir(root), ['ready']);
});
test('publisher death and rename failure never expose partial readiness', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pid-atomic-')), path = join(root, 'ready'), writer = publisher('atomic', path);
  // Stop before removing the fixture directory, including assertion failures.
  t.after(async () => { await writer.stop(); await rm(root, { recursive: true, force: true }); }); writer.release();
  assert.equal((await writer.next()).stage, 'empty'); writer.release();
  assert.equal((await writer.next()).stage, 'partial'); await writer.stop();
  assert.equal(await readPidRecord(path), undefined);
  await assert.rejects(waitForPid(path, { timeoutMs: 20 }), /Timed out/);
  const destination = join(root, 'directory'); await mkdir(destination);
  await assert.rejects(publishPid(destination), (error: any) => ['EISDIR', 'ENOTEMPTY'].includes(error.code));
  assert.deepEqual(await readdir(destination), []);
  assert.equal((await readdir(root)).filter(name => name.startsWith('directory.')).length, 0, 'failed publication removes its temporary');
  await assert.rejects(publishPid(path, 0), /Invalid fixture PID/);
  assert.equal(await readPidRecord(path), undefined);
});
