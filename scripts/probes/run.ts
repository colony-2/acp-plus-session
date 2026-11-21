import { mkdtemp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { release } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { probeCodex } from './codex.ts';
import { probeClaude } from './claude.ts';
import { identity } from './identity.ts';
import { digest } from './support.ts';
import { acceptanceIds } from '../acceptance.ts';
import { mockPolicy, platformPolicy } from '../mock-policy.ts';
import { provenance } from './provenance.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[i + 1];
};
const reportPath = resolve(option('--report', 'artifacts/provider-probes.json'));
const deps = resolve(option('--dependencies', '.'));
const root = await mkdtemp('/var/tmp/portable-provider-probe-');
await chmod(root, 0o700);
const source = await identity();
const report: any = {
  schema: 'acp-plus-session/probe-report/v1', startedAt: new Date().toISOString(), source,
  lockfileSha256: digest(await readFile('pnpm-lock.yaml')),
  platform: { os: process.platform, arch: process.arch, release: release(), node: process.version,
    pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim() },
  invocation: { argv: process.argv, cwd: process.cwd(), dependencies: deps },
  scope: 'Native backend qualification fixtures; not portable wrapper or consumer acceptance',
  providers: [],
  productChecks: acceptanceIds.map(id => ({ id, status: 'not_run', detail: 'Native probe observations are separate from wrapper and consumer acceptance' })),
  validationPolicy: mockPolicy, platformPolicy,
  excluded: ['Authenticated inference: superseded by approved request-inspecting mock API tests', 'Darwin and other unsupported platforms: outside the approved Linux arm64 scope'],
  notRun: ['Published consumers: require actual publication'],
  unavailable: []
};
try { report.runtimeProvenance = await provenance(deps, root); }
catch (error) { report.runtimeProvenance = { status: 'failed', error: String(error) }; }
let reaper: string | undefined;
try {
  if (process.platform !== 'linux') throw new Error('The current descendant-ownership harness requires Linux');
  reaper = join(root, 'linux-subreaper');
  const argv = ['-O2', '-Wall', '-Wextra', '-Werror', resolve('tests/platform/linux-subreaper.c'), '-o', reaper];
  execFileSync('cc', argv, { encoding: 'utf8' });
  report.ownershipHarness = { command: ['cc', ...argv], compiler: execFileSync('cc', ['--version'], { encoding: 'utf8' }).split('\n')[0],
    sourceSha256: digest(await readFile('tests/platform/linux-subreaper.c')), binarySha256: digest(await readFile(reaper)), scope: 'probe only' };
} catch (error) { report.ownershipHarness = { status: 'unavailable', error: String(error) }; }
// Always attempt both providers; an error in one must never suppress the other.
for (const [name, probe] of [['codex', probeCodex], ['claude', probeClaude]] as const) {
  const providerRoot = join(root, name);
  await mkdir(providerRoot, { mode: 0o700 });
  try {
    const result = await probe(deps, providerRoot, reaper);
    const req = createRequire(join(deps, 'package.json'));
    const packageName = name === 'codex' ? '@openai/codex' : '@agentclientprotocol/claude-agent-acp';
    const pkg = req.resolve(packageName + '/package.json');
    const version = JSON.parse(await readFile(pkg, 'utf8')).version;
    const launcher = join(pkg, '..', name === 'codex' ? 'bin/codex.js' : 'dist/index.js');
    const installed = { package: packageName, version, packageJsonSha256: digest(await readFile(pkg)), launcherSha256: digest(await readFile(launcher)) };
    const status = result.checks.some((c: any) => c.status !== 'passed') || result.endpointErrors.length ? 'failed' : 'passed';
    report.providers.push({ ...result, installed, status });
    console.log(JSON.stringify({ provider: name, status, checks: result.checks.map((c: any) => ({ id: c.id, status: c.status })) }));
  } catch (error) { report.providers.push({ provider: name, status: 'failed', error: String(error), checks: [] }); console.error(`${name}: ${error}`); }
}
report.finishedAt = new Date().toISOString();
report.finalSource = await identity();
report.sourceUnchanged = report.source.treeSha256 === report.finalSource.treeSha256;
report.status = report.providers.some((p: any) => p.status !== 'passed') || !report.sourceUnchanged || report.runtimeProvenance.status === 'failed' ? 'failed' : 'passed';
await mkdir(join(reportPath, '..'), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: reportPath, status: report.status, productAcceptance: 'not_run', root }));
if (report.status !== 'passed') process.exitCode = 1;
