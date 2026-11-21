import { mkdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { extensionId } from './bundle.ts';
import type { Extension } from './bundle.ts';
import { limitsWith, PrivateTree } from './files.ts';
import type { Limits } from './files.ts';
import type { Json } from './json.ts';
import { parseJson } from './json.ts';
import { cancelled, fail, SessionError } from './errors.ts';
import { startOwned } from '../runtime/process.ts';

export interface HookRegistration {
  id: string;
  version: string;
  command: readonly [string, ...string[]];
  deadlineMs?: number;
  required: boolean;
  validate(data: Json): boolean;
}
export class HookRegistry {
  readonly #hooks = new Map<string, HookRegistration>();
  constructor(hooks: readonly HookRegistration[], privateOwner: string) {
    this.owner = privateOwner;
    for (const hook of hooks) {
      if (!extensionId.test(hook.id) || hook.id.length > 120 || typeof hook.version !== 'string' || !hook.version.trim() || hook.version.length > 120 || /[\x00-\x1f\x7f]/.test(hook.version) || hook.version !== hook.version.toWellFormed() || typeof hook.required !== 'boolean' || !Array.isArray(hook.command) || hook.command.length === 0 || this.#hooks.has(hook.id) || typeof hook.command[0] !== 'string' || !isAbsolute(hook.command[0]) || hook.command.some(s => typeof s !== 'string' || s.includes('\0')) || !Number.isSafeInteger(hook.deadlineMs ?? 30000) || (hook.deadlineMs ?? 30000) < 1 || typeof hook.validate !== 'function') fail('HOOK_FAILED', 'Invalid trusted hook registration');
      this.#hooks.set(hook.id, { ...hook, command: [hook.command[0], ...hook.command.slice(1)] as [string, ...string[]] });
    }
  }
  private readonly owner: string;
  resolve(extensions: readonly Extension[]): string[] {
    const notices: string[] = [];
    for (const extension of extensions) {
      const hook = this.#hooks.get(extension.id);
      if (!hook || hook.version !== extension.version) {
        if (extension.required) fail('INCOMPATIBLE', `Required hook ${extension.id}@${extension.version} is unavailable`);
        notices.push(`Inactive optional extension retained: ${extension.id}@${extension.version}`);
      } else if (!hook.validate(extension.data)) fail('HOOK_FAILED', `Invalid extension data for ${extension.id}`);
    }
    return notices;
  }
  async run(phase: 'export' | 'import', staging: string, extensions: readonly Extension[], overrides: Partial<Limits> = {}, signal?: AbortSignal): Promise<Extension[]> {
    this.resolve(extensions);
    const limits = limitsWith(overrides);
    const result = new Map(extensions.map(e => [e.id, parseJson(JSON.stringify(e)) as unknown as Extension]));
    const tree = await PrivateTree.open(staging);
    try {
      for (const hook of [...this.#hooks.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        cancelled(signal);
        const existing = result.get(hook.id);
        if (phase === 'import' && (!existing || existing.version !== hook.version)) continue;
        // Incompatible optional state stays inactive, including during export.
        if (existing && existing.version !== hook.version) continue;
        const prefix = `extensions/${hook.id}`;
        await mkdir(join(staging, 'extensions'), { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        await mkdir(join(staging, prefix), { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const before = await tree.inventory(limits, signal);
        const input = JSON.stringify({ phase, id: hook.id, version: hook.version, data: existing?.data ?? null }) + '\n';
        if (Buffer.byteLength(input) > limits.hookJsonBytes) fail('LIMIT', 'Hook JSON input byte limit exceeded');
        const process = startOwned(this.owner, hook.command[0], hook.command.slice(1), { cwd: join(staging, prefix),
          // Credentials and the caller's agent homes do not enter hooks by
          // accident. Trusted commands may explicitly read external resources.
          env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
        let reason: unknown; let bytes = 0; const chunks: Buffer[] = [];
        const terminate = (cause: unknown) => { reason ??= cause; process.child.kill('SIGTERM'); };
        const onAbort = () => terminate(new SessionError('CANCELLED', 'Hook cancelled'));
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => terminate(new SessionError('HOOK_FAILED', 'Hook deadline exceeded')), hook.deadlineMs ?? 30000);
        try {
          process.input.on('error', error => terminate(error));
          process.input.end(input);
          for await (const chunk of process.output) {
            bytes += chunk.length;
            if (bytes > limits.hookJsonBytes) { terminate(new SessionError('LIMIT', 'Hook JSON byte limit exceeded')); continue; }
            chunks.push(Buffer.from(chunk));
          }
          const ended = await process.done;
          if (reason) throw reason;
          cancelled(signal);
          if (ended.code !== 0) fail('HOOK_FAILED', `Hook ${hook.id} failed`);
          const data = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), limits.depth);
          if (!hook.validate(data)) fail('HOOK_FAILED', `Hook ${hook.id} output failed its registered schema`);
          const outside = (entries: Awaited<ReturnType<PrivateTree['inventory']>>) => JSON.stringify(entries.filter(e => e.path !== prefix && !e.path.startsWith(prefix + '/')));
          const after = await tree.inventory(limits, signal);
          if (outside(before) !== outside(after)) fail('HOOK_FAILED', `Hook ${hook.id} changed another namespace`);
          result.set(hook.id, { id: hook.id, version: hook.version, required: existing?.required ?? hook.required, data });
        } finally {
          clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
          // Always wait for ownership completion, including output failures.
          await process.stop();
        }
      }
      return [...result.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    } finally { await tree.close(); }
  }
}

// Hooks are trusted local programs, but provider state is outside their
// extension contract. Detect mutation of decoded state as well as payloads.
export async function preservingProviderState<T>(home: string, limits: Partial<Limits> | undefined, operation: () => Promise<T>): Promise<T> {
  const inventory = async () => { const tree = await PrivateTree.open(home); try { return JSON.stringify(await tree.inventory(limitsWith(limits))); } finally { await tree.close(); } };
  const before = await inventory(); const result = await operation();
  if (await inventory() !== before) fail('HOOK_FAILED', 'Hook mutated decoded provider state');
  return result;
}
