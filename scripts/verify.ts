import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assess } from './acceptance.ts';
import { identity } from './probes/identity.ts';
import { digest } from './probes/support.ts';

const args = process.argv.slice(2);
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
try {
  const path = option('--report');
  if (!path) throw new Error('Provide the fresh candidate report with --report');
  const report = JSON.parse(await readFile(path, 'utf8'));
  const artifact = option('--artifact');
  const candidate = option('--candidate') ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const failures = assess(report, await identity(), candidate, digest(await readFile('pnpm-lock.yaml')), artifact ? digest(await readFile(artifact)) : undefined, args.includes('--allow-dirty'));
  console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }));
  if (failures.length) process.exitCode = 1;
} catch (error) { console.error(String(error)); process.exitCode = 1; }
