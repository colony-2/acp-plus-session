import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function endpoint(provider: 'codex' | 'claude', answer: (body: any, index: number) => any) {
  const requests: any[] = [];
  const errors: string[] = [];
  const server = createServer(async (req, res) => {
    let bytes = 0, body = '';
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) { res.writeHead(413).end(); return; }
      body += chunk;
    }
    if (req.url?.includes('count_tokens')) { res.setHeader('content-type', 'application/json'); res.end('{"input_tokens":10}'); return; }
    const route = provider === 'codex' ? '/v1/responses' : '/v1/messages';
    if (!req.url?.split('?')[0].endsWith(route)) { res.writeHead(404).end(); return; }
    try {
      const parsed = JSON.parse(body);
      requests.push({ path: req.url, body: parsed });
      const result = answer(parsed, requests.length - 1);
      const events = provider === 'codex' ? codexEvents(result) : claudeEvents(result);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const data of events) res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    } catch (e) { errors.push(String(e)); res.writeHead(500).end(JSON.stringify({ error: String(e) })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, requests, errors,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

function codexEvents(result: any) {
  const id = `resp_${randomUUID()}`, itemId = `item_${randomUUID()}`;
  const item = typeof result === 'string'
    ? { id: itemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: result, annotations: [] }] }
    : result.customInput !== undefined
    ? { id: itemId, type: 'custom_tool_call', status: 'completed', name: result.name, call_id: `call_${randomUUID()}`, input: result.customInput }
    : { id: itemId, type: 'function_call', status: 'completed', name: result.name, call_id: `call_${randomUUID()}`, arguments: JSON.stringify(result.arguments) };
  const envelope = (output: any[]) => ({ id, object: 'response', created_at: 1741290958, status: 'completed',
    model: 'gpt-5.3-codex', output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
  return [
    { type: 'response.created', response: { ...envelope([]), status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
    ...(typeof result === 'string' ? [{ type: 'response.output_text.delta', item_id: itemId, output_index: 0, content_index: 0, delta: result }] : []),
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: envelope([item]) }
  ];
}

function claudeEvents(result: any) {
  const tool = typeof result !== 'string';
  const block = tool ? { type: 'tool_use', id: `toolu_${randomUUID()}`, name: result.name, input: {} } : { type: 'text', text: '' };
  return [
    { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant',
      content: [], model: 'claude-sonnet-4-6', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: block },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(result.arguments) } : { type: 'text_delta', text: result } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' }
  ];
}
