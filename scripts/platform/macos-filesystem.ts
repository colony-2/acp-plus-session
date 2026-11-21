import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { release } from 'node:os';
import { identity } from '../probes/identity.ts';
import { sha256 } from '../../src/core/files.ts';

const args = process.argv.slice(2), index = args.indexOf('--report');
if (index < 0 || !args[index + 1]) throw new Error('Provide --report');
const path = resolve(args[index + 1]), run = promisify(execFile);
const source = await identity();
const report: any = { schema: 'acp-plus-session/macos-filesystem/v1', source, startedAt: new Date().toISOString(), platform: { os: process.platform, arch: process.arch, release: release(), node: process.version }, commands: [], productAcceptance: 'not_run', remaining: ['Darwin process ownership and complete descendant reaping', 'Both provider runtimes and independent packed consumers on macOS'], status: 'unavailable' };
if (process.platform === 'darwin' && process.arch === 'arm64' && process.version === 'v24.22.3') {
  report.status = 'passed';
  for (const command of [[process.execPath, 'scripts/build-native.ts'], [process.execPath, '--test', 'tests/core/descriptor-filesystem.test.ts', 'tests/core/bundle.test.ts', 'tests/core/publication.test.ts']]) {
    const startedAt = new Date().toISOString();
    try { const result = await run(command[0], command.slice(1), { timeout: 120000, maxBuffer: 512 * 1024 }); report.commands.push({ command, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), code: 0, ...result }); }
    catch (error: any) { report.commands.push({ command, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), code: error.code, error: error.message, stdout: error.stdout, stderr: error.stderr }); report.status = 'failed'; break; }
  }
  if (report.status === 'passed') report.helpers = JSON.parse(await readFile('artifacts/native/identity.json', 'utf8'));
} else report.reason = 'Requires actual macOS arm64 with Node 24.22.3 and installed compiler/Node headers; no platform simulation is accepted';
report.finishedAt = new Date().toISOString(); report.finalSource = await identity(); report.sourceUnchanged = source.treeSha256 === report.finalSource.treeSha256;
if (!report.sourceUnchanged) report.status = 'failed';
report.lockfileSha256 = sha256(await readFile('pnpm-lock.yaml'));
await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: path, status: report.status, productAcceptance: report.productAcceptance }));
if (report.status !== 'passed') process.exitCode = 1;
