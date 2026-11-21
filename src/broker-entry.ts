// Installed MCP transport. Authority stays with the owning client over an
// ephemeral authenticated loopback channel, never with checkpoint data.
import { RpcPeer, RpcError } from './acp/peer.ts';
const peer = new RpcPeer(process.stdin, process.stdout, async (method, params, signal) => {
  if (method === 'initialize') return { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'acp-plus-session', version: '0.1.0' } };
  if (method === 'ping') return {};
  if (method === 'tools/list' || method === 'tools/call') {
    const response = await fetch(process.env.PORTABLE_BROKER_URL!, { method: 'POST', signal,
      headers: { authorization: `Bearer ${process.env.PORTABLE_BROKER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) });
    if (!response.ok) throw new RpcError(-32603, 'Owning client rejected tool request');
    return response.json();
  }
  throw new RpcError(-32601, 'Unsupported MCP method');
});
await peer.done;
