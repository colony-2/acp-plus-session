import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { run } from './support.ts';

export async function broker(reaper?: string) {
  const token = randomUUID();
  let workspace = '', env: Record<string, string> = {}, allowed = true;
  const calls: any[] = [];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end(); return; }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16384) { res.writeHead(413).end(); return; }
    }
    const message = JSON.parse(body);
    const call: any = { workspace, arguments: message.arguments, decision: allowed ? 'allow' : 'deny' };
    calls.push(call);
    let result: any;
    if (message.name !== 'local_exec' || typeof message.arguments?.command !== 'string') result = { isError: true, content: [{ type: 'text', text: 'Invalid fixture call' }] };
    else if (!allowed) result = { isError: true, content: [{ type: 'text', text: 'Permission denied by the owning fixture client' }] };
    else {
      const execution = await run(reaper ?? '/bin/sh', reaper ? ['/bin/sh', '-c', message.arguments.command] : ['-c', message.arguments.command], workspace, env);
      call.execution = execution;
      result = { isError: execution.code !== 0 || execution.timedOut || execution.survivors.length > 0,
        content: [{ type: 'text', text: execution.stdout + execution.stderr }] };
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { token, url: `http://127.0.0.1:${address.port}`, calls,
    configure(nextWorkspace: string, nextEnv: Record<string, string>, nextAllowed = true) { workspace = nextWorkspace; env = nextEnv; allowed = nextAllowed; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
