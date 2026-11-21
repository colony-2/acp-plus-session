import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { RpcPeer } from '../../src/acp/peer.ts';

test('E05/D15: fragmented frames, independent string/number IDs, reverse calls and ordered updates', async () => {
  const input = new PassThrough(), output = new PassThrough(); const frames: any[] = [];
  let raw = ''; output.on('data', b => { raw += b; for (let n; (n = raw.indexOf('\n')) !== -1;) { frames.push(JSON.parse(raw.slice(0, n))); raw = raw.slice(n + 1); } });
  const notifications: number[] = [];
  const peer: RpcPeer = new RpcPeer(input, output, async (method, params): Promise<any> => {
    if (method === 'turn') return peer.request('permission', params);
    return { echoed: params };
  }, { onNotification: async (_m, p) => { notifications.push(p.order); } });
  const text = JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'turn', params: { local: true } }) + '\n';
  for (const byte of Buffer.from(text)) input.write(Buffer.from([byte]));
  await new Promise(r => setImmediate(r));
  assert.equal(frames[0].method, 'permission'); assert.equal(frames[0].id, 1);
  input.write('{"jsonrpc":"2.0","method":"update","params":{"order":1}}\n');
  input.write('{"jsonrpc":"2.0","method":"update","params":{"order":2}}\n');
  input.write('{"jsonrpc":"2.0","id":1,"result":{"allowed":false}}\n');
  await new Promise(r => setImmediate(r)); await peer.flush();
  assert.deepEqual(frames[1], { jsonrpc: '2.0', id: '1', result: { allowed: false } });
  assert.deepEqual(notifications, [1, 2]); input.end(); await peer.done;
});
test('D14: cancelled request ignores its late response and does not settle another request', async () => {
  const input = new PassThrough(), output = new PassThrough(); output.resume();
  const peer = new RpcPeer(input, output, async () => null);
  const controller = new AbortController(); const first = peer.request('permission', {}, controller.signal);
  controller.abort(); await assert.rejects(first, { code: 'CANCELLED' });
  const second = peer.request('permission', {});
  input.write('{"jsonrpc":"2.0","id":1,"result":"late grant"}\n');
  input.write('{"jsonrpc":"2.0","id":2,"result":"denied"}\n');
  assert.equal(await second, 'denied'); input.end(); await peer.done;
});
test('D15: malformed, truncated, duplicate-key and oversized frames close fail-closed', async () => {
  for (const bytes of ['{', '{"jsonrpc":"2.0","id":1,"id":2}\n', 'x'.repeat(65)]) {
    const input = new PassThrough(), output = new PassThrough(); output.resume(); const peer = new RpcPeer(input, output, async () => null, { maxFrameBytes: 64 });
    input.end(bytes); await assert.rejects(peer.done); assert.equal(peer.closed, true);
  }
});

test('D15: slow output applies backpressure without reordering and closes blocked writes', async () => {
  const input = new PassThrough(); let release!: () => void; const frames: any[] = [];
  const output = new Writable({ highWaterMark: 1, write(bytes, _encoding, callback) { frames.push(JSON.parse(bytes.toString())); release = () => callback(); } });
  const peer = new RpcPeer(input, output, async () => null);
  let firstDone = false; const first = peer.notify('update', { order: 1 }).then(() => { firstDone = true; });
  const second = peer.notify('update', { order: 2 });
  await new Promise(r => setImmediate(r)); assert.equal(firstDone, false); assert.equal(frames.length, 1);
  release(); await first; await new Promise(r => setImmediate(r)); assert.equal(frames.length, 2); assert.equal(frames[1].params.order, 2);
  release(); await second;
  const blocked = peer.notify('blocked', {}); await new Promise(r => setImmediate(r)); peer.close();
  await assert.rejects(blocked, { code: 'STOPPED' }); await peer.done;
});
test('D15: bounded notification queues fail closed without waiting on reverse-call replies', async () => {
  const input = new PassThrough(), output = new PassThrough(); output.resume();
  const peer = new RpcPeer(input, output, async () => null, { maxPending: 1, onNotification: async () => new Promise(() => {}) });
  input.write(' {"jsonrpc":"2.0","method":"update"}\n'.repeat(2));
  await assert.rejects(peer.done, /notification queue limit/); assert.equal(peer.closed, true);
});
