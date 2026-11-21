import { mkdtemp, mkdir, rm, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveDependencies } from './runtime/dependencies.ts';
import { NativeDriver } from './runtime/driver.ts';
import type { McpServer } from './runtime/mcp.ts';
import type { Connection } from './runtime/driver.ts';
import { SessionLifecycle } from './core/lifecycle.ts';
import { atomicPublisher } from './core/publication.ts';
import { stageBundle } from './core/bundle.ts';
import { providerFormats, CodexCodec, ClaudeCodec } from './providers/codecs.ts';
import type { Json } from './core/json.ts';
import { parseJson } from './core/json.ts';
import type { Limits } from './core/files.ts';
import { HookRegistry, preservingProviderState } from './core/hooks.ts';
import type { HookRegistration } from './core/hooks.ts';
import type { SessionClient, PermissionHandler } from './client.ts';
import { localClient } from './client.ts';
import { cancelled, fail, SessionError } from './core/errors.ts';

export { SessionError } from './core/errors.ts';
export type { CheckpointReference } from './core/publication.ts';
export type { Json } from './core/json.ts';
export type { HookRegistration } from './core/hooks.ts';
export type { SessionClient, PermissionHandler } from './client.ts';
export interface SessionOptions {
  provider: 'codex' | 'claude'; workspace: string; mcpServers?: readonly McpServer[]; connection?: Connection; application?: Json;
  client?: SessionClient; permission?: PermissionHandler; onUpdate?: (params: any) => Promise<void>;
  hooks?: readonly HookRegistration[]; limits?: Partial<Limits>; signal?: AbortSignal;
}
export interface PortableSession {
  readonly id: string; readonly state: string; readonly notices: readonly string[];
  prompt(content: string | any[], signal?: AbortSignal): Promise<any>;
  exportCheckpoint(destination: string, signal?: AbortSignal): ReturnType<SessionLifecycle['export']>;
  resume(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
export function createSession(options: SessionOptions): Promise<PortableSession> { return openSession(options); }
export async function restoreSession(checkpoint: string, options: SessionOptions): Promise<PortableSession> {
  if (typeof checkpoint !== 'string' || !checkpoint || checkpoint.includes('\0')) throw new SessionError('RESTORE_FAILED', 'Restore requires an explicit checkpoint path; no fresh conversation was created');
  return openSession(options, checkpoint);
}
async function openSession(options: SessionOptions, checkpoint?: string): Promise<PortableSession> {
  // Installed dependency qualification precedes session filesystem creation.
  const dependencies = await resolveDependencies(); cancelled(options.signal);
  if (!['codex', 'claude'].includes(options.provider)) fail('INCOMPATIBLE', 'Unsupported provider');
  const workspace = await realpath(options.workspace);
  if (!(await stat(workspace)).isDirectory()) fail('INCOMPATIBLE', 'Workspace must be an existing directory');
  cancelled(options.signal);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acp-plus-session-')));
  let lifecycle: SessionLifecycle | undefined;
  let driver: NativeDriver | undefined;
  const compatibility = { providers: providerFormats, features: [] };
  try {
    const registry = new HookRegistry(options.hooks ?? [], dependencies.owner);
    const home = join(root, 'native'); await mkdir(home, { mode: 0o700 });
    let payload = join(root, 'payload'); await mkdir(payload, { mode: 0o700 });
    let application = parseJson(JSON.stringify(options.application ?? null));
    let extensions: import('./core/bundle.ts').Extension[] = [];
    let nativeId: string | undefined, parentId: string | undefined;
    const notices: string[] = [];
    if (checkpoint) {
      const restored = await stageBundle(checkpoint, root, compatibility, options.limits, options.signal);
      if (restored.manifest.provider !== options.provider) fail('INCOMPATIBLE', 'Checkpoint provider differs from requested provider');
      // Producer compatibility is strict until further pairs are qualified.
      for (const [key, value] of Object.entries(dependencies.producer)) if (restored.manifest.producer[key] !== value) fail('INCOMPATIBLE', `Unsupported producer ${key}`);
      payload = restored.staging; application = restored.manifest.application; extensions = restored.manifest.extensions;
      notices.push(...registry.resolve(extensions));
      nativeId = restored.manifest.nativeId; parentId = restored.manifest.checkpointId;
      const codec = options.provider === 'codex' ? new CodexCodec(options.limits) : new ClaudeCodec(options.limits);
      await codec.restore(join(payload, 'provider'), home, workspace, nativeId, options.signal);
      if (options.hooks?.length) extensions = await preservingProviderState(home, options.limits, () => registry.run('import', payload, extensions, options.limits, options.signal));
    }
    const id = randomUUID();
    const client = options.client ?? localClient(workspace, dependencies.owner, options.permission, options.onUpdate);
    driver = new NativeDriver({ provider: options.provider, home, workspace, payload, nativeId, sessionId: id, dependencies, client, connection: options.connection ?? {}, lifecycle: () => lifecycle!, application, extensions, parentId, mcpServers: options.mcpServers, limits: options.limits });
    if (nativeId) await driver.resume(options.signal);
    lifecycle = new SessionLifecycle(driver, { compatibility, publish: atomicPublisher(dependencies.publish), limits: options.limits,
      afterCapture: async (staging, metadata, signal) => ({ ...metadata, extensions: options.hooks?.length ? await preservingProviderState(home, options.limits, () => registry.run('export', staging, metadata.extensions, options.limits, signal)) : metadata.extensions }),
      onPublished: reference => { driver!.parentId = reference.checkpointId; } });
    const active = lifecycle; cancelled(options.signal);
    return { id, notices, get state() { return active.state; },
      prompt: (content, signal) => active.run('turn', s => driver!.prompt(typeof content === 'string' ? [{ type: 'text', text: content }] : content, s), signal),
      exportCheckpoint: (destination, signal) => active.export(destination, signal), resume: signal => active.resume(signal),
      async close() { await active.close(); await rm(root, { recursive: true, force: true }); } };
  } catch (cause) {
    try { await driver?.stop(); } catch { /* failure stays fail-closed */ }
    await rm(root, { recursive: true, force: true });
    if (checkpoint) throw new SessionError('RESTORE_FAILED', 'Checkpoint restore failed; no fresh conversation was created', { cause });
    throw cause;
  }
}
