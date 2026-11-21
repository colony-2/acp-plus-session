import type { Readable, Writable } from 'node:stream';
import { RpcPeer, RpcError } from './peer.ts';
import { createSession, restoreSession } from '../index.ts';
import type { PortableSession, SessionOptions } from '../index.ts';

const extension = 'acp-plus-session/checkpoint';
export async function serveAcp(input: Readable, output: Writable, options: Pick<SessionOptions, 'provider' | 'connection' | 'hooks' | 'limits' | 'mcpServers'>) {
  const sessions = new Map<string, PortableSession>(), turns = new Map<string, AbortController>();
  let initialized = false, negotiated = false, capabilities: any = {};
  const get = (id: string) => { const session = sessions.get(id); if (!session) throw new RpcError(-32602, 'Unknown portable session'); return session; };
  const peer: RpcPeer = new RpcPeer(input, output, async (method, params, signal): Promise<any> => {
    if (method === 'initialize') {
      if (initialized || params.protocolVersion !== 1) throw new RpcError(-32602, 'Unsupported or repeated ACP initialization');
      initialized = true; capabilities = params.clientCapabilities ?? {};
      negotiated = params._meta?.[extension] === 1;
      return { protocolVersion: 1, agentInfo: { name: 'acp-plus-session', version: '0.1.0' }, agentCapabilities: { loadSession: false, promptCapabilities: { image: options.provider === 'claude', audio: false, embeddedContext: false }, mcpCapabilities: { http: false, sse: false }, ...(negotiated ? { _meta: { [extension]: { version: 1, methods: ['_acp_plus_session/export', '_acp_plus_session/restore', '_acp_plus_session/resume'] } } } : {}) }, authMethods: [] };
    }
    if (!initialized) throw new RpcError(-32000, 'Initialize ACP first');
    if (method === 'session/new' || method === '_acp_plus_session/restore') {
      if (method.startsWith('_') && !negotiated) throw new RpcError(-32601, 'Checkpoint extensions were not negotiated');
      if (method === '_acp_plus_session/restore' && (typeof params.checkpoint !== 'string' || !params.checkpoint)) throw new RpcError(-32602, 'Restore requires an explicit checkpoint path');
      if (typeof params.cwd !== 'string' || !Array.isArray(params.mcpServers ?? []) || params.sessionId !== undefined) throw new RpcError(-32602, 'Supply a workspace and MCP server list for an isolated session');
      const settings = { ...options, workspace: params.cwd, mcpServers: [...(options.mcpServers ?? []), ...(params.mcpServers ?? [])], signal, client: { capabilities, call: (m: string, p: any, s?: AbortSignal) => peer.request(m, p, s), update: (p: any) => peer.notify('session/update', p) } };
      const session = method === 'session/new' ? await createSession(settings) : await restoreSession(params.checkpoint, settings);
      sessions.set(session.id, session);
      return { sessionId: session.id, modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default', description: 'Client-controlled permissions' }] }, ...(session.notices.length ? { _meta: { notices: session.notices } } : {}) };
    }
    const session = get(params.sessionId);
    if (method === 'session/prompt') {
      if (!Array.isArray(params.prompt)) throw new RpcError(-32602, 'Expected ACP content blocks');
      if (turns.has(session.id)) throw new RpcError(-32000, 'A prompt is already active');
      const controller = new AbortController(); turns.set(session.id, controller);
      try { return await session.prompt(params.prompt, AbortSignal.any([signal, controller.signal])); }
      catch (error) { if (controller.signal.aborted) return { stopReason: 'cancelled' }; throw error; }
      finally { turns.delete(session.id); }
    }
    if (method === 'session/set_mode') {
      if (params.modeId !== 'default') throw new RpcError(-32602, 'Unsupported mode'); return {};
    }
    if (method.startsWith('_acp_plus_session/')) {
      if (!negotiated) throw new RpcError(-32601, 'Checkpoint extensions were not negotiated');
      if (method === '_acp_plus_session/export') {
        if (typeof params.destination !== 'string') throw new RpcError(-32602, 'Expected checkpoint destination');
        return session.exportCheckpoint(params.destination, signal);
      }
      if (method === '_acp_plus_session/resume') { await session.resume(signal); return {}; }
    }
    throw new RpcError(-32601, 'Unsupported ACP method');
  }, { onNotification: async (method, params) => { if (method === 'session/cancel') turns.get(params.sessionId)?.abort(); } });
  const terminate = () => peer.close(); process.on('SIGINT', terminate); process.on('SIGTERM', terminate);
  try { await peer.done; }
  finally {
    process.off('SIGINT', terminate); process.off('SIGTERM', terminate);
    for (const controller of turns.values()) controller.abort();
    const results = await Promise.allSettled([...sessions.values()].map(s => s.close()));
    if (results.some(r => r.status === 'rejected')) throw new Error('One or more sessions did not confirm cleanup');
  }
}
