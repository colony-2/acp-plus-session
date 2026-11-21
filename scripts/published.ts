// Acquisition for qualification, never called by library/CLI session startup.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mockPolicy, platformPolicy, qualifyMockConsumers } from './mock-policy.ts';
import { identity } from './probes/identity.ts';
import { sha256 } from '../src/core/files.ts';
const run = promisify(execFile), args = process.argv.slice(2), option = (n: string) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
if (!option('--reference')) throw new Error('Provide an actual publication reference JSON file with --reference');
const reference = JSON.parse(await readFile(option('--reference')!, 'utf8')), source = await identity();
const reportPath = resolve(option('--report') ?? 'artifacts/published-report.json');
const report: any = { schema: 'acp-plus-session/published-report/v1', startedAt: new Date().toISOString(), source, phase: 'published', validationPolicy: mockPolicy, platformPolicy, commands: [] };
try {
  const url = new URL(reference.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname.endsWith('.invalid') || !reference.version || reference.sourceCommit !== source.commit || !/^sha(?:256|512)-[A-Za-z0-9+/]+=*$/.test(reference.integrity)) throw new Error('Incomplete actual publication identity');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Published artifact acquisition failed');
  const chunks: Uint8Array[] = []; let total = 0;
  for await (const chunk of response.body) { total += chunk.byteLength; if (total > 64 * 1024 * 1024) throw new Error('Published artifact exceeds acquisition limit'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks), [algorithm, expected] = reference.integrity.split('-');
  if (createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error('Published integrity mismatch');
  const root = await mkdtemp(join(tmpdir(), 'portable-published-')), artifact = join(root, 'published.tgz'); await writeFile(artifact, bytes, { mode: 0o600 });
  const manifest = JSON.parse((await run('tar', ['-xOf', artifact, 'package/package.json'], { maxBuffer: 1024 * 1024 })).stdout);
  const build = JSON.parse((await run('tar', ['-xOf', artifact, 'package/dist/build-identity.json'], { maxBuffer: 1024 * 1024 })).stdout);
  if (manifest.name !== 'acp-plus-session' || manifest.version !== reference.version || build.source.commit !== source.commit || build.source.treeSha256 !== source.treeSha256) throw new Error('Published package/source association mismatch');
  report.publication = { url: url.href, version: reference.version, integrity: reference.integrity, sourceCommit: reference.sourceCommit, sourceTreeSha256: build.source.treeSha256, artifactSha256: sha256(bytes) }; report.buildIdentity = build;
  for (const [script, name] of [['scripts/consumers/run.ts', 'consumers']]) {
    const path = join(root, name + '.json'), command = [process.execPath, script, '--artifact', artifact, '--report', path];
    let code: number | string = 0; try { await run(command[0], command.slice(1), { timeout: 1800000, maxBuffer: 1024 * 1024 }); } catch (error: any) { code = error.code; }
    report.commands.push({ command: command, code }); report[name] = JSON.parse(await readFile(path, 'utf8'));
  }
  report.mockProviders = qualifyMockConsumers(report.consumers);
  report.status = qualifyMockConsumers(report.consumers).every(p => p.status === 'passed') ? 'passed' : 'failed';
} catch (error: any) { report.status = 'failed'; report.error = error.message; }
report.finishedAt = new Date().toISOString(); report.finalSource = await identity(); report.sourceUnchanged = source.treeSha256 === report.finalSource.treeSha256; if (!report.sourceUnchanged) report.status = 'failed';
await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); console.log(JSON.stringify({ report: reportPath, status: report.status })); if (report.status !== 'passed') process.exitCode = 1;
