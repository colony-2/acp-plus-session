import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForPid, readPidRecord } from './pid-readiness.mjs';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Barrier timed out: ${label}`)), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
export function publisher(mode, path, initial) {
  // IPC uses FD 4; FD 3 is reserved for the product's private handshake.
  const child = fork(new URL('./pid-barrier.mjs', import.meta.url), [mode, path, ...(initial ? [initial] : [])], { stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'ipc'] });
  let stderr = '', exited = false;
  child.stdout.resume(); child.stderr.on('data', chunk => { stderr += chunk; });
  const queue = [], waiters = [];
  child.on('message', message => { const waiter = waiters.shift(); if (waiter) waiter.resolve(message); else queue.push(message); });
  const closed = once(child, 'close').then(result => {
    exited = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`Publisher exited unexpectedly: ${result}; ${stderr}`));
    return result;
  });
  return {
    child, closed,
    release() { child.send('continue'); },
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (exited) return Promise.reject(new Error(`Publisher already exited; ${stderr}`));
      const waiter = deferred(); waiters.push(waiter);
      return bounded(waiter.promise, 'publisher observation');
    },
    async stop() { if (!exited) child.kill('SIGKILL'); await bounded(closed, 'publisher close'); }
  };
}

// The original reader's return behavior is unchanged. The wrapper instruments
// the read, and the caller acknowledges observing it before testing settlement.
async function originalReader(path, onObservation) {
  const observedRead = async (...args) => {
    const record = await readFile(...args);
    await onObservation(record, Number(record));
    return record;
  };
  async function waitForFile(path) {
    for (let i = 0; i < 200; i++) {
      try { return await observedRead(path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await delay(10);
    }
    throw new Error('Fixture failed to start');
  }
  return Number(await waitForFile(path));
}

export async function readingRegression(original = false, initial = 'empty') {
  const root = await mkdtemp(join(tmpdir(), 'pid-reading-'));
  const path = join(root, 'ready'), writer = publisher('staged', path, initial);
  let reading, gate;
  try {
    writer.release();
    let event = await writer.next();
    let expectedRecord;
    let observed = deferred();
    gate = deferred();
    let settled = false, observedStage = false;
    const observe = async (record) => {
      if (record === expectedRecord && !observedStage) {
        observedStage = true;
        const held = gate;
        observed.resolve(record);
        await held.promise;
      }
    };
    expectedRecord = await readPidRecord(path);
    reading = (original ? originalReader(path, observe) : waitForPid(path, { onObservation: observe })).finally(() => { settled = true; });
    // Attach immediately, including intentional baseline failures.
    void reading.catch(() => {});
    while (event.stage !== 'done') {
      const record = await bounded(observed.promise, `reader saw ${event.stage}`);
      assert.equal(record, await readFile(path, 'utf8'));
      gate.resolve();
      // Drain promise continuations; this is not a delay-based observation.
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false, `premature readiness for ${event.stage} record ${JSON.stringify(record)}`);
      observed = deferred(); gate = deferred();
      writer.release(); event = await writer.next();
      expectedRecord = await readPidRecord(path); observedStage = false;
    }
    gate.resolve();
    assert.equal(await bounded(reading, 'completed PID'), writer.child.pid);
    assert.deepEqual(await bounded(writer.closed, 'writer close'), [0, null]);
  } finally {
    gate?.resolve();
    await writer.stop();
    // A failed assertion must not leave a reader retrying a removed root.
    if (reading) await reading.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await readingRegression(process.argv[2] === 'original', process.argv[3]);
}
