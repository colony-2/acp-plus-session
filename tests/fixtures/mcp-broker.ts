// Minimal standards-based MCP fixture. Commands and permission decisions belong
// to the owning client process, never to imported provider data.
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
const reply = (id: unknown, result: any) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
lines.on('line', async line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') reply(message.id, { protocolVersion: message.params.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: 'portable-session-probe', version: '0' } });
  else if (message.method === 'ping') reply(message.id, {});
  else if (message.method === 'tools/list') reply(message.id, { tools: [{ name: 'local_exec',
    description: 'Run a local fixture command only after the owning client authorizes it.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } }] });
  else if (message.method === 'tools/call') {
    try {
      const response = await fetch(process.env.PORTABLE_PROBE_BROKER_URL!, {
        method: 'POST', headers: { authorization: `Bearer ${process.env.PORTABLE_PROBE_BROKER_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(message.params) });
      if (!response.ok) throw new Error(`Broker returned ${response.status}`);
      reply(message.id, await response.json());
    } catch (error) { reply(message.id, { isError: true, content: [{ type: 'text', text: String(error) }] }); }
  } else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported fixture method' } }) + '\n');
});
