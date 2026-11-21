import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionLifecycle } from '../../src/core/lifecycle.ts';
import type { Driver } from '../../src/core/lifecycle.ts';
import { randomUUID } from 'node:crypto';
import { atomicPublisher } from '../../src/core/publication.ts';
import { execFileSync } from 'node:child_process';

function barrier() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const compatibility = { providers: { codex: ['test-v1'] }, features: [] };
async function setup(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lifecycle-')); t.after(() => rm(root, { recursive: true, force: true }));
  const events: string[] = [];
  const driver: Driver = {
    async stop() { events.push('stopped-and-reaped'); },
    async resume() { events.push('guarded-resume'); },
    async capture(staging) {
      events.push('capture'); await mkdir(join(staging, 'provider'), { mode: 0o700 }); await writeFile(join(staging, 'provider/state'), 'native', { mode: 0o600 });
      return { provider: 'codex', nativeId: randomUUID(), stateFormat: 'test-v1', producer: { fixture: '1' }, requiredFeatures: [], application: {}, extensions: [] };
    }
  };
  const helper = join(root, 'publish'); execFileSync('gcc', ['-Wall', '-Wextra', '-Werror', '-O2', 'native/publish.c', '-o', helper]);
  const session = new SessionLifecycle(driver, { compatibility, publish: atomicPublisher(helper) });
  return { root, driver, session, events, helper };
}
test('S04/D08: every activity kind prevents export without stopping the writer', async t => {
  const f = await setup(t);
  for (const kind of ['turn', 'permission', 'tool', 'writer'] as const) {
    const gate = barrier(); const work = f.session.run(kind, () => gate.promise);
    await assert.rejects(f.session.export(join(f.root, 'checkpoint')), { code: 'BUSY' });
    assert.deepEqual(f.events, []); assert.equal(f.session.state, 'idle'); gate.resolve(); await work;
  }
});
test('S05/D08: export reserves admission synchronously, stops/reaps before capture and requires explicit resume', async t => {
  const f = await setup(t); const gate = barrier(); f.driver.stop = async () => { f.events.push('stopping'); await gate.promise; f.events.push('reaped'); };
  const exporting = f.session.export(join(f.root, 'checkpoint'));
  await assert.rejects(f.session.run('turn', async () => {}), { code: 'BUSY' });
  await assert.rejects(f.session.export(join(f.root, 'other')), { code: 'BUSY' });
  assert.deepEqual(f.events, ['stopping']); gate.resolve(); await exporting;
  assert.deepEqual(f.events, ['stopping', 'reaped', 'capture']); assert.equal(f.session.state, 'stopped');
  await assert.rejects(f.session.run('turn', async () => {}), { code: 'STOPPED' });
  await f.session.resume(); await f.session.run('turn', async () => {}); assert.equal(f.session.state, 'idle');
});
test('D09: capture and publication failure leave stopped, and preserve earlier checkpoints', async t => {
  const f = await setup(t); const checkpoint = join(f.root, 'checkpoint');
  const first = await f.session.export(checkpoint); await f.session.resume();
  await assert.rejects(f.session.export(checkpoint), { code: 'CONFLICT' }); assert.equal(f.session.state, 'stopped');
  assert.ok(first.manifestSha256); await f.session.resume();
  f.driver.capture = async () => { throw new Error('injected capture failure'); };
  await assert.rejects(f.session.export(join(f.root, 'other')), /injected/); assert.equal(f.session.state, 'stopped');
  assert.deepEqual((await readdir(f.root)).sort(), ['checkpoint', 'publish']);
});
test('S06/D10: unconfirmed writer shutdown prohibits capture and resume', async t => {
  const f = await setup(t); f.driver.stop = async () => { throw new Error('writer alive'); };
  await assert.rejects(f.session.export(join(f.root, 'checkpoint')), { code: 'SHUTDOWN_FAILED' });
  assert.equal(f.session.state, 'failed'); assert.ok(!f.events.includes('capture'));
  await assert.rejects(f.session.resume()); assert.deepEqual(await readdir(f.root), ['publish']);
});
test('D11: cancellation before capture removes staging and leaves stopped', async t => {
  const f = await setup(t); const controller = new AbortController(); f.driver.stop = async () => { controller.abort(); };
  await assert.rejects(f.session.export(join(f.root, 'checkpoint'), controller.signal), { code: 'CANCELLED' });
  assert.equal(f.session.state, 'stopped'); assert.deepEqual(await readdir(f.root), ['publish']);
});
test('D11: cancellation after atomic commit returns committed reference', async t => {
  const f = await setup(t); const controller = new AbortController();
  const publish = atomicPublisher(f.helper);
  const session = new SessionLifecycle(f.driver, { compatibility, publish: async (...args) => { const result = await publish(...args); controller.abort(); return result; } });
  const reference = await session.export(join(f.root, 'checkpoint'), controller.signal);
  assert.equal(reference.path, join(f.root, 'checkpoint')); assert.equal(session.state, 'stopped');
});
test('B07/D21: concurrent publishers yield exactly one complete winner', async t => {
  const f = await setup(t);
  const sessions = Array.from({ length: 8 }, () => new SessionLifecycle(f.driver, { compatibility, publish: atomicPublisher(f.helper) }));
  const results = await Promise.allSettled(sessions.map(s => s.export(join(f.root, 'checkpoint'))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'CONFLICT');
  assert.deepEqual((await readdir(join(f.root, 'checkpoint'))).sort(), ['manifest.json', 'provider']);
  assert.ok(sessions.every(s => s.state === 'stopped'));
});
test('S07: failed explicit native resume never admits prompt or creates a fresh session', async t => {
  const f = await setup(t); await f.session.export(join(f.root, 'checkpoint'));
  f.driver.resume = async () => { throw new Error('missing native identity'); };
  await assert.rejects(f.session.resume(), { code: 'RESTORE_FAILED' });
  await assert.rejects(f.session.run('turn', async () => { throw new Error('must not run'); }), { code: 'STOPPED' });
});

test('S06/D08: repeated close shares one cleanup and cancels active work once', async t => {
  const f = await setup(t), gate = barrier(); let stops = 0, aborts = 0;
  f.driver.stop = async () => { stops++; await gate.promise; };
  const work = f.session.run('turn', signal => new Promise<void>(resolve => { signal.addEventListener('abort', () => { aborts++; resolve(); }, { once: true }); }));
  const first = f.session.close(), second = f.session.close(); assert.equal(first, second); await work;
  gate.resolve(); await Promise.all([first, second]); await f.session.close(); assert.equal(stops, 1); assert.equal(aborts, 1); assert.equal(f.session.state, 'closed');
});
