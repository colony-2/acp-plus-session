import { untilAborted } from '../core/abort.ts';
import type { Readable, Writable } from 'node:stream';
import { parseJson } from '../core/json.ts';
import { SessionError, cancelled } from '../core/errors.ts';

type Id = string | number;
export type RequestHandler = (method: string, params: any, signal: AbortSignal) => Promise<any>;
export interface RpcOptions { maxFrameBytes?: number; maxPending?: number; timeoutMs?: number; onNotification?: (method: string, params: any) => Promise<void> }
export class RpcError extends Error {
  readonly code: number; readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) { super(message); this.code = code; this.data = data; }
}
export class RpcPeer {
  readonly #closeController = new AbortController();
  #closed = false; #sequence = 0; #queueBytes = 0; #writes: Promise<void> = Promise.resolve();
  #pending = new Map<Id, { resolve: (v: any) => void; reject: (e: Error) => void; clear: () => void }>();
  #incoming = new Map<Id, AbortController>();
  #handlers = new Set<Promise<void>>();
  #notificationCount = 0;
  #notifications: Promise<void> = Promise.resolve();
  readonly done: Promise<void>;
  readonly #input: Readable; readonly #output: Writable; readonly #handler: RequestHandler; readonly #options: Required<Pick<RpcOptions, 'maxFrameBytes' | 'maxPending' | 'timeoutMs'>> & RpcOptions;
  constructor(input: Readable, output: Writable, handler: RequestHandler, options: RpcOptions = {}) {
    this.#input = input; this.#output = output; this.#handler = handler;
    this.#options = { maxFrameBytes: 4 * 1024 * 1024, maxPending: 128, timeoutMs: 120000, ...options };
    for (const key of ['maxFrameBytes', 'maxPending', 'timeoutMs'] as const) if (!Number.isSafeInteger(this.#options[key]) || this.#options[key] < 1) throw new Error('Invalid protocol limits');
    input.on('error', () => this.close()); output.on('error', () => this.close());
    this.done = this.#read(); void this.done.catch(() => this.close());
  }
  get closed() { return this.#closed; }
  async send(message: any) {
    if (this.#closed) throw new SessionError('STOPPED', 'ACP transport is closed');
    const bytes = Buffer.from(JSON.stringify(message) + '\n');
    if (bytes.length > this.#options.maxFrameBytes || this.#queueBytes + bytes.length > 2 * this.#options.maxFrameBytes) { this.close(); throw new Error('ACP output queue limit exceeded'); }
    this.#queueBytes += bytes.length;
    const write = this.#writes.then(() => untilAborted(new Promise<void>((resolve, reject) => {
      if (this.#closed) { reject(new Error('ACP transport closed')); return; }
      this.#output.write(bytes, error => error ? reject(error) : resolve());
    }), this.#closeController.signal).catch(cause => { if (this.#closed) throw new SessionError('STOPPED', 'ACP transport closed during write', { cause }); throw cause; })).finally(() => { this.#queueBytes -= bytes.length; });
    this.#writes = write.catch(() => this.close());
    return write;
  }
  notify(method: string, params: any) { return this.send({ jsonrpc: '2.0', method, params }); }
  async request(method: string, params: any, signal?: AbortSignal): Promise<any> {
    cancelled(signal);
    if (this.#closed || this.#pending.size >= this.#options.maxPending) throw new Error('ACP request admission unavailable');
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const finish = (error: Error) => { const p = this.#pending.get(id); if (p) { this.#pending.delete(id); p.clear(); reject(error); } };
      const abort = () => finish(new SessionError('CANCELLED', 'ACP request cancelled'));
      const timer = setTimeout(() => finish(new Error(`ACP request timed out: ${method}`)), this.#options.timeoutMs);
      const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      this.#pending.set(id, { resolve, reject, clear });
      void this.send({ jsonrpc: '2.0', id, method, params }).catch(error => finish(error));
    });
  }
  async #read() {
    let pending = Buffer.alloc(0);
    try {
      for await (const chunk of this.#input) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let start = 0;
        for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
          if (pending.length + end - start > this.#options.maxFrameBytes) throw new Error('ACP frame limit exceeded');
          const line = Buffer.concat([pending, bytes.subarray(start, end)]); pending = Buffer.alloc(0); start = end + 1;
          if (line.length) this.#receive(parseJson(new TextDecoder('utf-8', { fatal: true }).decode(line), 64));

        }
        if (pending.length + bytes.length - start > this.#options.maxFrameBytes) throw new Error('ACP fragmented frame limit exceeded');
        pending = Buffer.concat([pending, bytes.subarray(start)]);
      }
      if (pending.length) throw new Error('Truncated ACP frame');
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([this.#notifications, new Promise((_, reject) => { drainTimer = setTimeout(() => reject(new Error('ACP notification drain timed out')), 2000); })]); } finally { clearTimeout(drainTimer); }
    } catch (error) {
      if (!this.#closed) throw error;
    } finally {
      this.close();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([Promise.allSettled([...this.#handlers]), new Promise(resolve => { timer = setTimeout(resolve, 25000); })]); } finally { clearTimeout(timer); }
    }
  }
  #receive(message: any) {
    if (this.#closed) return;
    if (!message || message.jsonrpc !== '2.0' || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid ACP frame');
    if (message.id !== undefined && !(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isSafeInteger(message.id)))) throw new Error('Invalid ACP request ID');
    if (typeof message.method === 'string') {
      if (message.id === undefined) {
        // Notifications retain stream order. They do not block correlated
        // responses or reverse requests needed to finish an outstanding turn.
        if (this.#notificationCount >= this.#options.maxPending) throw new Error('ACP notification queue limit exceeded');
        this.#notificationCount++;
        this.#notifications = this.#notifications.then(() => this.#options.onNotification?.(message.method, message.params)).catch(() => this.close()).finally(() => { this.#notificationCount--; });
      } else {
        if (this.#incoming.has(message.id) || this.#incoming.size >= this.#options.maxPending) throw new Error('Duplicate or excessive ACP request');
        const controller = new AbortController(); this.#incoming.set(message.id, controller);
        const task = (async () => {
          try {
            const result = await this.#handler(message.method, message.params, controller.signal);
            if (!controller.signal.aborted) await this.send({ jsonrpc: '2.0', id: message.id, result });
          } catch (error) {
            if (!controller.signal.aborted) await this.send({ jsonrpc: '2.0', id: message.id, error: { code: error instanceof RpcError ? error.code : -32603, message: error instanceof Error ? error.message : 'ACP operation failed' } });
          } finally { this.#incoming.delete(message.id); }
        })().catch(() => this.close());
        this.#handlers.add(task); void task.finally(() => this.#handlers.delete(task));
      }
    } else if (message.id !== undefined && (Object.hasOwn(message, 'result') !== Object.hasOwn(message, 'error'))) {
      const p = this.#pending.get(message.id);
      if (!p) return; // Late response cannot revive a cancelled operation.
      this.#pending.delete(message.id); p.clear();
      if (message.error) p.reject(new RpcError(message.error.code, message.error.message, message.error.data));
      else p.resolve(message.result);
    } else throw new Error('Invalid ACP response');
  }
  async flush() { await this.#writes; }
  async drainNotifications(signal?: AbortSignal) { await untilAborted(this.#notifications, AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])])); }
  close() {
    if (this.#closed) return; this.#closed = true; this.#closeController.abort();
    for (const p of this.#pending.values()) { p.clear(); p.reject(new SessionError('STOPPED', 'ACP transport closed')); } this.#pending.clear();
    for (const controller of this.#incoming.values()) controller.abort(); this.#incoming.clear();
    this.#input.destroy(); this.#output.destroy();
  }
}
