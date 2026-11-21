import { connectMcp } from './mcp.ts';
import type { McpServer } from './mcp.ts';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { SessionClient } from '../client.ts';
import { cancelled, fail } from '../core/errors.ts';
import { parseJson } from '../core/json.ts';
import type { SessionLifecycle } from '../core/lifecycle.ts';

export async function toolBroker(client: SessionClient, lifecycle: () => SessionLifecycle, sessionId: string, turnSignal: AbortSignal, configuration: { servers: readonly McpServer[]; owner: string; workspace: string; home: string }) {
  const token = randomUUID(); let unconfirmed = false; let active = 0; let closing = false;
  const operations = new Set<Promise<void>>();
  const external = await connectMcp(configuration.servers, configuration.owner, configuration.workspace, configuration.home, turnSignal);
  const specs = [
    ...(client.capabilities.fs?.readTextFile ? [{ name: 'read_file', description: 'Read a workspace file through the connected client after permission.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }] : []),
    ...(client.capabilities.fs?.writeTextFile ? [{ name: 'write_file', description: 'Write a workspace file through the connected client after permission.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } }] : []),
    ...(client.capabilities.terminal ? [{ name: 'local_exec', description: 'Run a shell command on the connected client host after permission.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } }] : [])
    , ...[...external.tools.values()].map(t => t.spec)
  ];
  const server = createServer((req, res) => {
    const operation = (async () => {
      const header = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${token}`);
      if (header.length !== expected.length || !timingSafeEqual(header, expected) || closing || active >= 16 || turnSignal.aborted) { res.writeHead(403).end(); return; }
      active++;
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const bytes of req) { size += bytes.length; if (size > 4 * 1024 * 1024) { res.writeHead(413).end(); return; } chunks.push(bytes); }
        const message = parseJson(Buffer.concat(chunks).toString('utf8')) as any;
        let result: any;
        if (message.method === 'tools/list') result = { tools: specs };
        else if (message.method === 'tools/call') {
          result = await lifecycle().run('tool', async signal => {
            cancelled(signal); const { name, arguments: args } = message.params ?? {};
            const custom = external.tools.get(name);
            if (!specs.some(s => s.name === name) || !args || typeof args !== 'object' || Array.isArray(args) || (!custom && (Object.keys(args).some(k => !(name === 'local_exec' ? ['command'] : name === 'write_file' ? ['path', 'content'] : ['path']).includes(k)) || (name === 'local_exec' ? typeof args.command !== 'string' : typeof args.path !== 'string') || (name === 'write_file' && typeof args.content !== 'string')))) fail('UNSUPPORTED', 'Invalid local tool request');
            const toolCallId = randomUUID();
            const toolCall = { toolCallId, title: name, kind: name === 'local_exec' ? 'execute' : name === 'read_file' ? 'read' : 'edit', status: 'pending', rawInput: args };
            await client.update({ sessionId, update: { sessionUpdate: 'tool_call', ...toolCall } });
            const decision = await lifecycle().run('permission', s => client.call('session/request_permission', { sessionId, toolCall, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject once', kind: 'reject_once' }] }, s), signal);
            cancelled(signal);
            if (decision?.outcome?.outcome !== 'selected' || decision.outcome.optionId !== 'allow') { await client.update({ sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', rawOutput: { error: 'Permission denied' } } }); return { isError: true, content: [{ type: 'text', text: 'Permission denied by the connected client' }] }; }
            await client.update({ sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' } });
            if (custom) { const result = await custom.call(args, signal); await client.update({ sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: result.isError ? 'failed' : 'completed', rawOutput: result } }); return result; }
            let value: string;
            if (name !== 'local_exec') {
              try {
                const response = await client.call(name === 'read_file' ? 'fs/read_text_file' : 'fs/write_text_file', { sessionId, ...args }, signal);
                value = name === 'read_file' ? response.content : 'File written';
              } catch (error) { unconfirmed = true; throw error; }
            } else {
              let terminalId: string | undefined;
              try {
                const terminal = await client.call('terminal/create', { sessionId, command: '/bin/sh', args: ['-c', args.command], outputByteLimit: 65536 }, signal);
                terminalId = terminal.terminalId;
                cancelled(signal);
                const exit = await client.call('terminal/wait_for_exit', { sessionId, terminalId }, signal);
                const output = await client.call('terminal/output', { sessionId, terminalId }, signal);
                value = output.output + `\nExit code: ${exit.exitCode}`;
              } catch (error) { if (!terminalId) unconfirmed = true; throw error; }
              finally {
                if (terminalId) try { await client.call('terminal/release', { sessionId, terminalId }, AbortSignal.timeout(10000)); } catch { unconfirmed = true; }
              }
            }
            cancelled(signal);
            await client.update({ sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', rawOutput: value } });
            return { content: [{ type: 'text', text: value }] };
          }, turnSignal);
        } else fail('UNSUPPORTED', 'Unsupported broker method');
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
      } finally { active--; }
    })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
    operations.add(operation); void operation.finally(() => operations.delete(operation));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { token, url, get unconfirmed() { return unconfirmed || active > 0; }, async close() {
    closing = true; let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled([...operations]), new Promise<void>(resolve => { timer = setTimeout(() => { unconfirmed = true; resolve(); }, 22000); })]); } finally { clearTimeout(timer); }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await external.close();
  } };
}
