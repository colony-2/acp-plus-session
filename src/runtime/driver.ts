import { untilAborted } from '../core/abort.ts';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { CodexCodec, ClaudeCodec } from '../providers/codecs.ts';
import type { Codec } from '../providers/codecs.ts';
import type { Driver } from '../core/lifecycle.ts';
import type { SessionLifecycle } from '../core/lifecycle.ts';
import type { ManifestMetadata, Extension } from '../core/bundle.ts';
import { cancelled, fail, SessionError } from '../core/errors.ts';
import type { Json } from '../core/json.ts';
import { parseJson } from '../core/json.ts';
import { PrivateTree, limitsWith } from '../core/files.ts';
import type { Limits } from '../core/files.ts';
import { startOwned } from './process.ts';
import type { OwnedProcess } from './process.ts';
import type { Dependencies } from './dependencies.ts';
import type { McpServer } from './mcp.ts';
import { toolBroker } from './broker.ts';
import type { SessionClient } from '../client.ts';
import { RpcPeer, RpcError } from '../acp/peer.ts';

async function* nativeLines(stream: Readable) {
  let pending = Buffer.alloc(0), total = 0;
  for await (const bytes of stream) {
    total += bytes.length; if (total > 64 * 1024 * 1024) fail('LIMIT', 'Native event stream exceeds supported limit');
    let start = 0;
    for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
      if (pending.length + end - start > 4 * 1024 * 1024) fail('LIMIT', 'Native event frame exceeds supported limit');
      yield new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([pending, bytes.subarray(start, end)]));
      pending = Buffer.alloc(0); start = end + 1;
    }
    if (pending.length + bytes.length - start > 4 * 1024 * 1024) fail('LIMIT', 'Native fragmented event exceeds supported limit');
    pending = Buffer.concat([pending, bytes.subarray(start)]);
  }
  if (pending.length) fail('RESTORE_FAILED', 'Truncated native event');
}
export interface Connection { apiKey?: string; baseUrl?: string; model?: string }
export interface DriverOptions { provider: 'codex' | 'claude'; home: string; workspace: string; payload: string; nativeId?: string; sessionId: string; dependencies: Dependencies; client: SessionClient; connection: Connection; lifecycle: () => SessionLifecycle; application: Json; extensions: Extension[]; parentId?: string; limits?: Partial<Limits>; mcpServers?: readonly McpServer[] }
export class NativeDriver implements Driver {
  readonly codec: Codec; readonly #options: DriverOptions; readonly #limits: Limits;
  nativeId?: string; application: Json; extensions: Extension[]; parentId?: string;
  #stateDigest?: string; #process?: OwnedProcess; #unsafe = false; #failedFresh = false;
  constructor(options: DriverOptions) {
    this.#options = options; this.#limits = limitsWith(options.limits); this.nativeId = options.nativeId;
    this.application = options.application; this.extensions = options.extensions; this.parentId = options.parentId;
    this.codec = options.provider === 'codex' ? new CodexCodec(this.#limits) : new ClaudeCodec(this.#limits);
  }
  private update(params: any, signal: AbortSignal) {
    return untilAborted(this.#options.lifecycle().run('writer', () => this.#options.client.update(params), signal), signal);
  }
  private environment() {
    const o = this.#options;
    return { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: o.home, TMPDIR: join(o.home, 'tmp'), XDG_CONFIG_HOME: join(o.home, 'xdg-config'), XDG_CACHE_HOME: join(o.home, 'xdg-cache'),
      ...(o.provider === 'codex' ? { CODEX_HOME: o.home, OPENAI_API_KEY: o.connection.apiKey ?? '' } : { CLAUDE_CONFIG_DIR: o.home, ANTHROPIC_API_KEY: o.connection.apiKey ?? '', ...(o.connection.baseUrl ? { ANTHROPIC_BASE_URL: o.connection.baseUrl } : {}), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_AGENT_ACP_PROTOCOL: 'v1' }) };
  }
  isBusy() { return !!this.#process; }
  async stop() {
    if (this.#process) { await this.#process.stop(); this.#process = undefined; }
    if (this.#unsafe) fail('SHUTDOWN_FAILED', 'Client tool completion or writer reaping was not confirmed');
  }
  private async stateDigest(signal?: AbortSignal) {
    const o = this.#options; const staging = await mkdtemp(join(dirname(o.home), 'state-check-'));
    try {
      await this.codec.capture(o.home, o.workspace, this.nativeId!, staging, signal);
      const tree = await PrivateTree.open(staging);
      try { return JSON.stringify(await tree.inventory(this.#limits, signal)); } finally { await tree.close(); }
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async resume(signal?: AbortSignal) {
    cancelled(signal);
    if (!this.nativeId || this.#failedFresh) fail('RESTORE_FAILED', 'No intended native conversation to resume');
    await this.codec.guard(this.#options.home, this.#options.workspace, this.nativeId);
    const digest = await this.stateDigest(signal);
    if (this.#stateDigest !== undefined && digest !== this.#stateDigest) fail('RESTORE_FAILED', 'Required native state changed outside the owned turn');
    this.#stateDigest = digest;
  }
  async capture(staging: string, signal?: AbortSignal): Promise<ManifestMetadata> {
    if (this.#process || this.#unsafe) fail('SHUTDOWN_FAILED', 'Native state is not quiescent');
    if (!this.nativeId) fail('RESTORE_FAILED', 'No native turn has established a checkpointable conversation');
    const o = this.#options; await this.resume(signal);
    await mkdir(join(staging, 'provider'), { mode: 0o700 });
    await this.codec.capture(o.home, o.workspace, this.nativeId, join(staging, 'provider'), signal);
    const payload = await PrivateTree.open(o.payload);
    try {
      for (const entry of await payload.inventory(this.#limits, signal)) {
        if (!['application', 'extensions'].includes(entry.path.split('/')[0])) continue;
        if (entry.kind === 'directory') await mkdir(join(staging, entry.path), { mode: 0o700 });
        else await payload.copy(entry.path, join(staging, entry.path), this.#limits.fileBytes, entry, signal);
      }
    } finally { await payload.close(); }
    return { provider: o.provider, nativeId: this.nativeId, stateFormat: this.codec.format, producer: o.dependencies.producer, requiredFeatures: [], application: this.application, extensions: this.extensions, ...(this.parentId ? { parentId: this.parentId } : {}) };
  }
  async prompt(prompt: any[], signal: AbortSignal) {
    const o = this.#options; cancelled(signal);
    if (this.#failedFresh) fail('RESTORE_FAILED', 'Previous native creation failed; fresh retry is prohibited');
    if (this.nativeId) { try { await this.resume(signal); } catch (cause) { throw new SessionError('RESTORE_FAILED', 'Intended native state disappeared or is invalid; fresh execution prohibited', { cause }); } }
    await mkdir(join(o.home, 'tmp'), { mode: 0o700, recursive: true });
    const broker = await toolBroker(o.client, o.lifecycle, o.sessionId, signal, { servers: o.mcpServers ?? [], owner: o.dependencies.owner, workspace: o.workspace, home: o.home });
    try {
      return o.provider === 'codex' ? await this.codex(prompt, broker, signal) : await this.claude(prompt, broker, signal);
    } catch (error) { if (!this.nativeId) this.#failedFresh = true; if (signal.aborted) throw new SessionError('CANCELLED', 'Turn cancelled', { cause: error }); throw error; }
    finally {
      try { if (this.#process) await this.#process.stop(); } catch { this.#unsafe = true; }
      this.#process = undefined;
      try { await broker.close(); } catch (cause) { this.#unsafe = true; throw cause; }
      if (broker.unconfirmed) this.#unsafe = true;
      if (!this.#unsafe && this.nativeId) this.#stateDigest = await this.stateDigest();
    }
  }
  private async codex(prompt: any[], broker: Awaited<ReturnType<typeof toolBroker>>, signal: AbortSignal) {
    const o = this.#options; cancelled(signal);
    if (!Array.isArray(prompt) || prompt.some(b => b.type !== 'text' || typeof b.text !== 'string')) fail('UNSUPPORTED', 'Codex candidate accepts text prompt blocks');
    if (o.connection.model && o.connection.model !== 'gpt-5.3-codex') fail('INCOMPATIBLE', 'Codex model is outside the qualified tool catalog');
    const endpoint = o.connection.baseUrl ?? 'https://api.openai.com';
    if (!/^https?:\/\//.test(endpoint) || /[\r\n\0]/.test(endpoint)) fail('INCOMPATIBLE', 'Invalid provider URL');
    await writeFile(join(o.home, 'config.toml'), `model_provider = "portable"\nmodel = "gpt-5.3-codex"\n[model_providers.portable]\nname = "Configured provider"\nbase_url = ${JSON.stringify(endpoint.replace(/\/$/, '') + '/v1')}\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\nsupports_websockets = false\n[mcp_servers.portable]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(o.dependencies.broker)}]\n[mcp_servers.portable.env]\nPORTABLE_BROKER_URL = ${JSON.stringify(broker.url)}\nPORTABLE_BROKER_TOKEN = ${JSON.stringify(broker.token)}\n`, { mode: 0o600 });
    const args = ['exec', '--json', '--skip-git-repo-check', '--color', 'never', '-C', o.workspace, '--sandbox', 'workspace-write', '-c', 'approval_policy="on-request"', '-c', 'features.use_linux_sandbox_bwrap=true', '-c', 'features.shell_tool=false', '-c', 'features.apply_patch_freeform=false', '-c', 'features.collab=false', '-c', 'web_search="disabled"', '-c', `model_catalog_json=${JSON.stringify(o.dependencies.catalog)}`, ...(this.nativeId ? ['resume', this.nativeId, '-'] : ['-'])];
    cancelled(signal);
    const child = startOwned(o.dependencies.owner, o.dependencies.codex, args, { cwd: o.workspace, env: this.environment() }); this.#process = child;
    const abort = () => { void child.stop(true).catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    let completed = false; let bytes = 0;
    try {
      // The prompt uses stdin; credentials and user content never enter argv.
      if (signal.aborted) abort(); cancelled(signal);
      child.input.on('error', () => {}); child.input.end(prompt.map(b => b.text).join('\n'));
      for await (const line of nativeLines(child.output)) {
        bytes += Buffer.byteLength(line);
        if (line.length > 4 * 1024 * 1024 || bytes > 64 * 1024 * 1024) { abort(); fail('LIMIT', 'Native event stream exceeds supported limit'); }
        const event = parseJson(line) as any;
        if (event.type === 'thread.started') {
          if (this.nativeId && event.thread_id !== this.nativeId) { abort(); fail('RESTORE_FAILED', 'Native thread identity changed'); }
          this.nativeId = event.thread_id;
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') await this.update({ sessionId: o.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: event.item.text } } }, signal);
        if (event.type === 'turn.completed') completed = true;
      }
      const result = await child.done; cancelled(signal);
      if (result.code !== 0 || !completed || !this.nativeId) fail('RESTORE_FAILED', 'Native Codex turn failed');
      return { stopReason: 'end_turn' };
    } finally { signal.removeEventListener('abort', abort); }
  }
  private async claude(prompt: any[], broker: Awaited<ReturnType<typeof toolBroker>>, signal: AbortSignal) {
    const o = this.#options; cancelled(signal);
    const child = startOwned(o.dependencies.owner, process.execPath, [o.dependencies.claude], { cwd: o.workspace, env: this.environment() }); this.#process = child;
    const nativeTerminals = new Set<string>();
    const peer = new RpcPeer(child.output, child.input, async (method, params, s) => {
      if (method === 'session/request_permission') return o.lifecycle().run('permission', operationSignal => o.client.call(method, { ...params, sessionId: o.sessionId }, operationSignal), s);
      if (method.startsWith('fs/') || method.startsWith('terminal/')) return o.lifecycle().run('tool', async operationSignal => {
        const cleanup = method.startsWith('terminal/') && method !== 'terminal/create';
        if (cleanup && !nativeTerminals.has(params.terminalId)) fail('UNSUPPORTED', 'Unknown native terminal handle');
        if (!cleanup) {
          const decision = await o.lifecycle().run('permission', permissionSignal => o.client.call('session/request_permission', { sessionId: o.sessionId, toolCall: { toolCallId: randomUUID(), title: method, kind: method === 'fs/read_text_file' ? 'read' : method === 'fs/write_text_file' ? 'edit' : 'execute', status: 'pending', rawInput: params }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject once', kind: 'reject_once' }] }, permissionSignal), operationSignal);
          cancelled(operationSignal);
          if (decision?.outcome?.outcome !== 'selected' || decision.outcome.optionId !== 'allow') fail('CANCELLED', 'Connected client denied native callback');
        }
        try {
          const result = await o.client.call(method, { ...params, sessionId: o.sessionId }, operationSignal);
          if (method === 'terminal/create') nativeTerminals.add(result.terminalId);
          if (method === 'terminal/release') nativeTerminals.delete(params.terminalId);
          return result;
        } catch (error) { this.#unsafe = true; throw error; }
      }, s);
      throw new RpcError(-32601, 'Unavailable connected-client callback');
    }, { onNotification: async (method, params) => { if (method === 'session/update') await this.update({ ...params, sessionId: params.sessionId === this.nativeId ? o.sessionId : params.sessionId }, signal); } });
    const abort = () => { void peer.notify('session/cancel', { sessionId: this.nativeId }).catch(() => {}); void child.stop(true).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await peer.request('initialize', { protocolVersion: 1, clientInfo: { name: 'acp-plus-session', version: '0.1.0' }, clientCapabilities: o.client.capabilities }, signal);
      const loaded = await peer.request(this.nativeId ? 'session/load' : 'session/new', { ...(this.nativeId ? { sessionId: this.nativeId } : {}), cwd: o.workspace, mcpServers: [], _meta: { claudeCode: { options: { tools: [], settingSources: [], allowDangerouslySkipPermissions: false, ...(o.connection.model ? { model: o.connection.model } : {}), mcpServers: { portable: { command: process.execPath, args: [o.dependencies.broker], env: { PORTABLE_BROKER_URL: broker.url, PORTABLE_BROKER_TOKEN: broker.token } } } } } } }, signal);
      if (typeof loaded.sessionId !== 'string' || (this.nativeId && loaded.sessionId !== this.nativeId)) fail('RESTORE_FAILED', 'Native Claude load changed conversation identity');
      this.nativeId ??= loaded.sessionId;
      await peer.request('session/set_mode', { sessionId: this.nativeId, modeId: 'default' }, signal);
      const result = await peer.request('session/prompt', { sessionId: this.nativeId, prompt }, signal); await peer.drainNotifications(signal); return result;
    } finally { signal.removeEventListener('abort', abort); try { await child.stop(); } finally { peer.close(); for (const terminalId of nativeTerminals) { try { await o.client.call('terminal/release', { sessionId: o.sessionId, terminalId }, AbortSignal.timeout(10000)); } catch { this.#unsafe = true; } } } }
  }
}
