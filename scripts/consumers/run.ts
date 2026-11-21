import { mkdtemp, mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, release } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { endpoint } from '../probes/endpoints.ts';
import { sha256 } from '../../src/core/files.ts';
import { acpxConsumers } from './acpx.ts';
import { identity } from '../probes/identity.ts';

const run = promisify(execFile); const args = process.argv.slice(2);
const option = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
const artifact = resolve(option('--artifact') ?? ''); if (!option('--artifact')) throw new Error('Provide --artifact');
const reportPath = resolve(option('--report') ?? 'artifacts/consumer-report.json');
const root = await mkdtemp(join(tmpdir(), 'portable-consumer-')); const project = join(root, 'project'); await mkdir(project);
await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'independent-portable-session-consumer', private: true, type: 'module', dependencies: { 'acp-plus-session': `file:${artifact}` } }));
const source = await identity();
const report: any = { schema: 'acp-plus-session/consumer-report/v1', startedAt: new Date().toISOString(), source, apiMode: 'mock', mockApi: { transport: 'loopback-http', credentialMode: 'fixture-only' }, artifact, artifactSha256: sha256(await readFile(artifact)), platform: { os: process.platform, arch: process.arch, release: release(), node: process.version }, installation: { command: ['pnpm', 'install', '--offline', '--ignore-scripts'], cwd: project }, consumers: [] };
try {
  const install = await run('pnpm', ['install', '--offline', '--ignore-scripts'], { cwd: project, timeout: 60000, maxBuffer: 1024 * 1024 }); report.installation.code = 0; report.installation.output = install.stdout;
  const built = JSON.parse(await readFile(join(project, 'node_modules/acp-plus-session/dist/build-identity.json'), 'utf8'));
  if (built.source.commit !== source.commit || built.source.treeSha256 !== source.treeSha256 || built.lockfileSha256 !== sha256(await readFile('pnpm-lock.yaml'))) throw new Error('Candidate tarball does not identify the current source and lockfile');
  report.buildIdentity = built;
  for (const consumer of ['library', 'cli', 'acp']) {
    await cp(`tests/consumers/${consumer}.mjs`, join(project, `${consumer}.mjs`));
    for (const provider of ['codex', 'claude'] as const) {
      const state = join(root, `${consumer}-${provider}`); await mkdir(state, { mode: 0o700 }); const privateState = join(state, 'private'); await mkdir(privateState, { mode: 0o700 });
      const ambient = join(state, 'ambient-home'); await mkdir(ambient, { mode: 0o700 });
      for (const name of ['.codex', '.claude']) { await mkdir(join(ambient, name), { mode: 0o700 }); await writeFile(join(ambient, name, 'auth.json'), JSON.stringify({ credentialSentinel: 'ambient-credential-sentinel' }), { mode: 0o600 }); }
      const unrelated = join(state, 'unrelated-workspace'); await mkdir(unrelated, { mode: 0o700 }); await writeFile(join(unrelated, 'sentinel'), 'unrelated-workspace-must-not-change', { mode: 0o600 });
      const responses: any[] = [consumer === 'acp' ? { name: '$read', arguments: { path: 'context.txt' } } : { name: '$local', arguments: { command: 'pwd; cat context.txt' } }, 'initial complete', { name: '$local', arguments: { command: 'pwd; cat destination.txt' } }, 'alpha complete', 'alpha successor complete', { name: '$local', arguments: { command: 'pwd; cat destination.txt' } }, 'beta complete', 'beta successor complete', ...(consumer === 'acp' ? [{ name: '$local', arguments: { command: 'touch cancelled-marker' } }, { name: '$local', arguments: { command: 'touch disconnected-marker' } }] : [{ name: '$local', arguments: { command: 'touch forbidden-marker' } }, 'denial complete', ...(consumer === 'library' ? [{ name: '$local', arguments: { command: 'touch busy-marker' } }, 'busy check complete', { name: '$bypass' }, 'bypass restriction complete', { name: '$local', arguments: { command: JSON.stringify(process.execPath) + ' leader.mjs' } }, 'writer complete', 'slow update cancellation complete'] : [])])];
      const api = await endpoint(provider, body => {
        if (provider === 'claude' && !body.tools?.length) return 'Consumer title';
        const response = responses.shift(); if (response === undefined) throw new Error('Unexpected consumer model request');
        if (response.name === '$bypass') { response.name = provider === 'codex' ? 'view_image' : 'Read'; response.arguments = provider === 'codex' ? { path: join(state, 'bypass-workspace/sentinel.png') } : { file_path: join(state, 'bypass-workspace/secret.txt') }; }
        if (response.name === '$read') response.name = body.tools.find((t: any) => t.name?.endsWith('__read_file'))?.name ?? '$missing-read-tool';
        if (response.name === '$local') response.name = body.tools.find((t: any) => t.name?.endsWith('__local_exec'))?.name ?? '$missing-local-tool';
        return response;
      });
      const command = [process.execPath, join(project, consumer + '.mjs')];
      try {
        const result = await run(command[0], command.slice(1), { cwd: project, timeout: 180000, maxBuffer: 2 * 1024 * 1024, env: { HOME: ambient, XDG_CONFIG_HOME: ambient, PATH: process.env.PATH, LANG: 'C.UTF-8', TMPDIR: privateState, CONSUMER_STATE_ROOT: state, CONSUMER_PROVIDER: provider, CONSUMER_ENDPOINT: api.url } });
        const outcome = JSON.parse(result.stdout.trim().split('\n').at(-1)!); const inputs = api.requests.filter(r => provider === 'codex' || r.body.tools?.length).map(r => JSON.stringify(provider === 'codex' ? r.body.input : r.body.messages));
        const facts = outcome.facts;
        const assertions = {
          ambientHomesUnchanged: (await readFile(join(ambient, '.codex/auth.json'), 'utf8')) === JSON.stringify({ credentialSentinel: 'ambient-credential-sentinel' }) && (await readFile(join(ambient, '.claude/auth.json'), 'utf8')) === JSON.stringify({ credentialSentinel: 'ambient-credential-sentinel' }),
          unrelatedWorkspaceUnchanged: (await readFile(join(unrelated, 'sentinel'), 'utf8')) === 'unrelated-workspace-must-not-change',
          sourceResolvedFromConsumer: fileURLToPath(outcome.importedFrom).startsWith(project + '/node_modules/'),
          rememberedAndPriorToolInAlpha: inputs[2]?.includes(facts.remembered) && inputs[2]?.includes(facts.priorTool),
          alphaDestinationTool: inputs[3]?.includes(facts.branches.alpha),
          alphaSuccessor: inputs[4]?.includes(facts.branches.alpha) && inputs[4]?.includes(facts.remembered) && inputs[4]?.includes(facts.priorTool),
          rememberedAndPriorToolInBeta: inputs[5]?.includes(facts.remembered) && inputs[5]?.includes(facts.priorTool),
          betaDestinationTool: inputs[6]?.includes(facts.branches.beta),
          betaSuccessor: inputs[7]?.includes(facts.branches.beta) && inputs[7]?.includes(facts.remembered) && inputs[7]?.includes(facts.priorTool),
          independentBranches: !inputs[5]?.includes(facts.branches.alpha) && !inputs[7]?.includes(facts.branches.alpha),
          nativeBypassBlocked: consumer !== 'library' || (!inputs[13]?.includes(facts.bypass) && !inputs[13]?.includes('data:image/')),
          requestsConsumed: responses.length === 0 && inputs.length === (consumer === 'library' ? 17 : 10) && api.errors.length === 0
        };
        const passed = Object.values(assertions).every(Boolean);
        report.consumers.push({ consumer, provider, command, cwd: project, mockApi: { url: api.url, protocol: provider === 'codex' ? 'openai-responses-sse' : 'anthropic-messages-sse', modelRequests: inputs.length, endpointErrors: api.errors }, code: 0, status: passed ? 'passed' : 'failed', assertions, outcome,
          ...(!passed ? { requestContexts: inputs.map((text, index) => ({ index, sha256: sha256(text), bytes: Buffer.byteLength(text), excerpt: text.length <= 16384 ? text : text.slice(0, 8192) + '\n[diagnostic excerpt omitted middle]\n' + text.slice(-8192) })) } : {}) });
      } catch (error: any) { report.consumers.push({ consumer, provider, command, cwd: project, status: 'failed', code: error.code, error: error.message, stdout: error.stdout?.slice(-32768), stderr: error.stderr?.slice(-32768), requestCount: api.requests.length, endpointErrors: api.errors }); }
      finally { await api.close(); }
    }
  }
  report.consumers.push(...await acpxConsumers(project, root));
} catch (error: any) { if (report.installation.code === 0) report.preparationError = { code: error.code, error: error.message }; else report.installation = { ...report.installation, code: error.code, error: error.message }; }
report.finishedAt = new Date().toISOString(); report.finalSource = await identity(); report.sourceUnchanged = source.treeSha256 === report.finalSource.treeSha256;
report.status = report.sourceUnchanged && report.consumers.length === 8 && report.consumers.every((c: any) => c.status === 'passed') ? 'passed' : 'failed';
await mkdir(resolve(reportPath, '..'), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: reportPath, status: report.status, consumers: report.consumers.map((c: any) => ({ consumer: c.consumer, provider: c.provider, status: c.status, error: c.error, assertions: c.assertions })) }));
if (report.status !== 'passed') process.exitCode = 1;
