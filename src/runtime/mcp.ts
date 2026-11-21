import { RpcPeer, RpcError } from '../acp/peer.ts';
import { startOwned } from './process.ts';
import type { OwnedProcess } from './process.ts';
import { fail } from '../core/errors.ts';
export interface McpServer { name: string; command: string; args: string[]; env: { name: string; value: string }[]; type?: 'stdio' }
export async function connectMcp(servers: readonly McpServer[], owner: string, cwd: string, home: string, signal: AbortSignal) {
  if (servers.length > 16) fail('LIMIT', 'Too many configured MCP servers');
  const processes: { process: OwnedProcess; peer: RpcPeer }[] = [];
  const tools = new Map<string, { spec: any; call: (args: any, signal: AbortSignal) => Promise<any> }>();
  let unsafe = false;
  const close = async () => {
    for (const item of processes) item.peer.close();
    const results = await Promise.allSettled(processes.map(item => item.process.stop()));
    if (results.some(r => r.status === 'rejected')) { unsafe = true; fail('SHUTDOWN_FAILED', 'MCP writer reaping was not confirmed'); }
  };
  try {
    const names = new Set<string>();
    for (const server of servers) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(server.name) || names.has(server.name) || (server.type !== undefined && server.type !== 'stdio') || typeof server.command !== 'string' || !server.command || !Array.isArray(server.args) || server.args.some(a => typeof a !== 'string' || a.includes('\0')) || !Array.isArray(server.env) || server.env.some(e => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.name) || typeof e.value !== 'string' || e.value.includes('\0'))) fail('INCOMPATIBLE', 'Invalid configured stdio MCP server');
      names.add(server.name);
      const process = startOwned(owner, server.command, server.args, { cwd, env: { PATH: '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', ...Object.fromEntries(server.env.map(e => [e.name, e.value])) } });
      const peer = new RpcPeer(process.output, process.input, async () => { throw new RpcError(-32601, 'Unsupported MCP reverse request'); });
      processes.push({ process, peer });
      await peer.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acp-plus-session', version: '0.1.0' } }, signal);
      await peer.notify('notifications/initialized', {});
      let cursor: string | undefined; const cursors = new Set<string>();
      do {
        const listed = await peer.request('tools/list', cursor ? { cursor } : {}, signal);
        if (!Array.isArray(listed.tools)) fail('INCOMPATIBLE', 'Invalid MCP tool list');
        for (const tool of listed.tools) {
          if (tools.size >= 128 || typeof tool.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(tool.name)) fail('LIMIT', 'MCP tool catalog exceeds supported limits');
          const name = `external_${server.name}__${tool.name}`;
          if (tools.has(name) || Buffer.byteLength(JSON.stringify(tool)) > 65536) fail('INCOMPATIBLE', 'Ambiguous or excessive MCP tool definition');
          tools.set(name, { spec: { ...tool, name }, call: (args, signal) => peer.request('tools/call', { name: tool.name, arguments: args }, signal) });
        }
        if (listed.nextCursor !== undefined && typeof listed.nextCursor !== 'string') fail('INCOMPATIBLE', 'Invalid MCP pagination');
        if (cursors.size >= 128 || (listed.nextCursor !== undefined && cursors.has(listed.nextCursor))) fail('INCOMPATIBLE', 'Non-progressing MCP pagination');
        cursor = listed.nextCursor; if (cursor !== undefined) cursors.add(cursor);
      } while (cursor !== undefined);
    }
    return { tools, close, get unsafe() { return unsafe; } };
  } catch (error) { await close(); throw error; }
}
