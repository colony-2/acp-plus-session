import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { identity } from './probes/identity.ts';
import { sha256 } from '../src/core/files.ts';
const run = promisify(execFile), args = process.argv.slice(2);
const path = resolve(args[args.indexOf('--report') + 1] ?? 'artifacts/focused-tests.json');
const source = await identity();
const report: any = { schema: 'acp-plus-session/focused-report/v1', startedAt: new Date().toISOString(), source, lockfileSha256: sha256(await readFile('pnpm-lock.yaml')), commands: [] };
const commands = [[process.execPath, 'scripts/check-project-dependencies.ts'], ['pnpm', 'run', 'typecheck'], ['pnpm', 'run', 'test:codecs'], ['pnpm', 'run', 'test:core'], ['pnpm', 'run', 'test:qualification']];
for (const command of commands) {
  const startedAt = new Date().toISOString();
  try { const result = await run(command[0], command.slice(1), { timeout: 120000, maxBuffer: 256 * 1024 }); report.commands.push({ command, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), code: 0, stdout: result.stdout, stderr: result.stderr }); }
  catch (error: any) { report.commands.push({ command, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), code: error.code, stdout: error.stdout?.slice(-65536), stderr: error.stderr?.slice(-65536), error: error.message.slice(0, 2048) }); break; }
}
report.finishedAt = new Date().toISOString(); report.finalSource = await identity(); report.sourceUnchanged = source.treeSha256 === report.finalSource.treeSha256;
report.status = report.commands.length === commands.length && report.commands.every((r: any) => r.code === 0) && report.sourceUnchanged ? 'passed' : 'failed';
await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: path, status: report.status })); if (report.status !== 'passed') process.exitCode = 1;
