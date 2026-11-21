import { createInterface } from 'node:readline';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

// Probe client only. Each production entrypoint must implement its own bounded,
// backpressured forwarding; this client is not a product protocol implementation.
export function acpClient(child: ChildProcessWithoutNullStreams, reverse: (message: any) => Promise<any>) {
  const wire: any[] = [];
  const pending = new Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: any }>();
  let sequence = 0;
  const send = (message: any) => child.stdin.write(JSON.stringify(message) + '\n');
  const lines = createInterface({ input: child.stdout });
  lines.on('line', async line => {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }
    wire.push(message);
    if (message.method && message.id !== undefined) {
      try { send({ jsonrpc: '2.0', id: message.id, result: await reverse(message) }); }
      catch (e) { send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(e) } }); }
    } else if (message.id !== undefined) {
      const p = pending.get(message.id);
      if (p) {
        pending.delete(message.id); clearTimeout(p.timer);
        if (message.error) p.reject(Object.assign(new Error(JSON.stringify(message.error)), { rpc: message.error }));
        else p.resolve(message.result);
      }
    }
  });
  child.on('close', () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('ACP process closed')); }
    pending.clear(); lines.close();
  });
  return {
    wire,
    request(method: string, params: any): Promise<any> {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`ACP timeout: ${method}`)); }, 20000);
        pending.set(id, { resolve, reject, timer });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify(method: string, params: any) { send({ jsonrpc: '2.0', method, params }); }
  };
}
