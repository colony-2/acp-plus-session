import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdir, access, readFile, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { endpoint } from '../probes/endpoints.ts';
const run = promisify(execFile);
export async function acpxConsumers(project: string, root: string) {
  const req = createRequire(import.meta.url);
  const cli = await realpath(join(project, 'node_modules/acp-plus-session/dist/cli.js'));
  const acpxPkg = req.resolve('acpx/package.json'), acpx = join(dirname(acpxPkg), 'dist/cli.js');
  const version = JSON.parse(await readFile(acpxPkg, 'utf8')).version;
  const results: any[] = [];
  for (const provider of ['codex', 'claude'] as const) {
    const workspace = join(root, `acpx-${provider}`); await mkdir(workspace, { mode: 0o700 });
    const home = join(root, `acpx-${provider}-home`); await mkdir(home, { mode: 0o700 });
    let mainRequests = 0, cancelling = false;
    const api = await endpoint(provider, body => {
      if (provider === 'claude' && !body.tools?.length) return 'acpx title';
      mainRequests++;
      if (cancelling) return { name: body.tools.find((t: any) => t.name?.endsWith('__local_exec'))?.name ?? '$missing', arguments: { command: 'echo $$ > cancel-pid; while true; do printf x >> cancel-writes; sleep 0.01; done' } };
      if (mainRequests === 1) return { name: body.tools.find((t: any) => t.name?.endsWith('__local_exec'))?.name ?? '$missing', arguments: { command: 'touch acpx-forbidden-marker' } };
      if (mainRequests === 2) return 'unmodified acpx complete';
      throw new Error('Unexpected acpx request');
    });
    const quote = (arg: string) => `'${arg.replaceAll("'", "'\\''")}'`;
    const agent = [process.execPath, cli, 'acp', '--provider', provider, '--base-url', api.url].map(quote).join(' ');
    const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, [provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY']: 'consumer-fixture-key' };
    const command = [process.execPath, acpx, '--agent', agent, '--cwd', workspace, '--deny-all', '--format', 'json', '--timeout', '45', 'exec', 'Exercise the owning client denial.'];
    try {
      // acpx deliberately exits 5 when every permission is rejected, even
      // after the agent finishes its response. Assert that documented policy.
      let output: any;
      try { const ok = await run(command[0], command.slice(1), { cwd: project, timeout: 60000, maxBuffer: 2 * 1024 * 1024, env }); output = { ...ok, code: 0 }; }
      catch (error: any) { if (error.code !== 5) throw error; output = { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
      let wrote = true; try { await access(join(workspace, 'acpx-forbidden-marker')); } catch { wrote = false; }
      const denialPassed = output.code === 5 && !wrote && mainRequests === 2 && output.stdout.includes('unmodified acpx complete') && output.stdout.includes('session/request_permission') && api.errors.length === 0;
      cancelling = true;
      const cancelCommand = [process.execPath, acpx, '--agent', agent, '--cwd', workspace, '--approve-all', '--format', 'json', '--timeout', '45', 'exec', 'Exercise cancellation of an active local terminal.'];
      const child = spawn(cancelCommand[0], cancelCommand.slice(1), { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout = (stdout + b).slice(-65536); }); child.stderr.on('data', b => { stderr = (stderr + b).slice(-65536); });
      const done = new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); void done.catch(() => {});
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
      let pid = 0, code: number | null, cancellationMs = 0;
      try {
        for (let i = 0; i < 450; i++) { pid = Number(await readFile(join(workspace, 'cancel-pid'), 'utf8').catch(() => '0')); if (pid) break; await new Promise(r => setTimeout(r, 100)); }
        if (!pid) throw new Error('acpx terminal never started');
        const interruptedAt = performance.now(); child.kill('SIGINT'); code = await done; cancellationMs = performance.now() - interruptedAt;
      } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await done; } }
      let survivor = false; try { process.kill(pid, 0); survivor = true; } catch (error: any) { if (error.code !== 'ESRCH') throw error; }
      if (survivor) process.kill(pid, 'SIGKILL');
      const cancellation = { command: cancelCommand, code, cancellationMs, pid, survivor, cancelForwarded: stdout.includes('session/cancel'), output: stdout, stderr };
      results.push({ consumer: 'acpx', provider, version, command, cwd: project, code: output.code, expectedDenialExitCode: 5, status: denialPassed && !survivor && code === 0 && stdout.includes('\"stopReason\":\"cancelled\"') && cancellation.cancelForwarded ? 'passed' : 'failed', markerWritten: wrote, modelRequests: mainRequests, endpointErrors: api.errors, output: output.stdout.slice(-16384), stderr: output.stderr.slice(-16384), cancellation, scope: 'Unmodified custom-agent chat, denial, and SIGINT cancellation of an approved local terminal' });
    } catch (error: any) { results.push({ consumer: 'acpx', provider, version, command, cwd: project, code: error.code, status: 'failed', stderr: error.stderr?.slice(-16384), output: error.stdout?.slice(-16384), error: error.message }); }
    finally { await api.close(); }
  }
  return results;
}
