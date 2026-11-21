import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startOwned } from './runtime/process.ts';
import type { OwnedProcess } from './runtime/process.ts';
import { cancelled, fail } from './core/errors.ts';
import { openRelative } from './runtime/filesystem.ts';
import type { AnchoredHandle } from './runtime/filesystem.ts';

export interface SessionClient {
  capabilities: Record<string, any>;
  call(method: string, params: any, signal?: AbortSignal): Promise<any>;
  update(params: any): Promise<void>;
}
export type PermissionHandler = (params: any, signal?: AbortSignal) => Promise<any>;
export function localClient(workspace: string, owner: string, permission?: PermissionHandler, update: (params: any) => Promise<void> = async () => {}): SessionClient {
  const terminals = new Map<string, { process: OwnedProcess; text: Buffer; result?: any }>();
  async function contained(path: string, write = false) {
    const target = resolve(workspace, path);
    const canonical = write ? resolve(await realpath(dirname(target)), target.split('/').at(-1)!) : await realpath(target);
    const rel = relative(workspace, canonical);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) fail('INTEGRITY', 'Local callback path escapes workspace');
    return canonical;
  }
  async function anchored(path: string, flags: number, directory = false) {
    const parts = path.split('/').filter(Boolean);
    if (Buffer.byteLength(path) > 8192 || parts.length > 512) fail('LIMIT', 'Local callback path exceeds supported limit');
    if (!parts.length) return open('/', flags | constants.O_NOFOLLOW | (directory ? constants.O_DIRECTORY : 0));
    let parent: AnchoredHandle = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        const next = openRelative(parent, parts[i], constants.O_RDONLY | constants.O_DIRECTORY);
        await parent.close(); parent = next;
      }
      return openRelative(parent, parts.at(-1)!, flags | (directory ? constants.O_DIRECTORY : 0), 0o600);
    } finally { await parent.close(); }
  }
  return { capabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }, update,
    async call(method, params, signal) {
      cancelled(signal);
      if (method === 'session/request_permission') return permission ? permission(params, signal) : { outcome: { outcome: 'cancelled' } };
      if (method === 'fs/read_text_file') {
        const file = await anchored(await contained(params.path), constants.O_RDONLY);
        try {
          const st = await file.stat(); if (!st.isFile() || st.size > 1024 * 1024) fail('LIMIT', 'Local read exceeds supported byte limit');
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of file.createReadStream({ autoClose: false })) {
            cancelled(signal); size += chunk.length; if (size > 1024 * 1024) fail('LIMIT', 'Local read grew beyond its byte limit'); chunks.push(chunk);
          }
          const content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); cancelled(signal);
          const lines = content.split('\n'); const start = Math.max(0, (params.line ?? 1) - 1);
          return { content: lines.slice(start, params.limit === undefined ? undefined : start + params.limit).join('\n') };
        } finally { await file.close(); }
      }
      if (method === 'fs/write_text_file') {
        if (typeof params.content !== 'string' || Buffer.byteLength(params.content) > 1024 * 1024) fail('LIMIT', 'Local write exceeds supported byte limit');
        const file = await anchored(await contained(params.path, true), constants.O_WRONLY | constants.O_CREAT);
        try { if (!(await file.stat()).isFile()) fail('INTEGRITY', 'Local write target is not regular'); cancelled(signal); await file.truncate(0); await file.writeFile(params.content); return {}; } finally { await file.close(); }
      }
      if (method === 'terminal/create') {
        if (terminals.size >= 16 || typeof params.command !== 'string') fail('LIMIT', 'Local terminal admission limit exceeded');
        const cwd = await contained(params.cwd ?? workspace);
        const terminalId = randomUUID();
        const cwdHandle = await anchored(cwd, constants.O_RDONLY, true);
        let child: OwnedProcess;
        let entry: { process: OwnedProcess; text: Buffer; result?: any };
        try {
          child = startOwned(owner, params.command, params.args ?? [], { cwdFd: cwdHandle.fd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: cwd } });
          entry = { process: child, text: Buffer.alloc(0) };
          // Drain immediately. Waiting for descriptor closure or spawn admission
          // can let a fast child exit and lose buffered output before listeners exist.
          child.child.stderr!.on('data', (chunk: Buffer) => { entry.text = Buffer.concat([entry.text, chunk]).subarray(-65536); });
          child.output.on('data', (chunk: Buffer) => { entry.text = Buffer.concat([entry.text, chunk]).subarray(-65536); });
          void child.done.then(result => { entry.result = { exitCode: result.code }; }).catch(() => {});
          await new Promise<void>((resolve, reject) => { child.child.once('spawn', resolve); child.child.once('error', reject); });
        } finally { await cwdHandle.close(); }
        terminals.set(terminalId, entry);
        child.input.end();
        return { terminalId };
      }
      if (method.startsWith('terminal/')) {
        const entry = terminals.get(params.terminalId); if (!entry) fail('STOPPED', 'Unknown local terminal');
        if (method === 'terminal/output') return { output: entry.text.toString('utf8'), truncated: entry.text.length === 65536, ...(entry.result ? { exitStatus: entry.result } : {}) };
        if (method === 'terminal/wait_for_exit') {
          const abort = () => entry.process.child.kill('SIGTERM'); signal?.addEventListener('abort', abort, { once: true });
          try { const result = await entry.process.done; return { exitCode: result.code }; }
          finally { signal?.removeEventListener('abort', abort); }
        }
        if (method === 'terminal/kill') { await entry.process.stop(); return {}; }
        if (method === 'terminal/release') { await entry.process.stop(); terminals.delete(params.terminalId); return {}; }
      }
      fail('UNSUPPORTED', `Unavailable local callback: ${method}`);
    }
  };
}
