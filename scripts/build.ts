import { identity } from './probes/identity.ts';
import { sha256 } from '../src/core/files.ts';
import { rm, mkdir, cp, chmod, writeFile, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await rm('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-native.ts'], { stdio: 'inherit' });
// A platform probe may build the POSIX filesystem/publisher independently, but
// an installable product must include its process owner as well.
await access('artifacts/native/owner');
await cp('artifacts/native', 'dist/native', { recursive: true });
await cp('pnpm-lock.yaml', 'dependency-lock.yaml');
await cp('src/codex-model.json', 'dist/codex-model.json');
await chmod('dist/cli.js', 0o755);

await writeFile('dist/build-identity.json', JSON.stringify({ source: await identity(), lockfileSha256: sha256(await readFile('pnpm-lock.yaml')), node: process.version, platform: process.platform + '-' + process.arch }, null, 2) + '\n');
