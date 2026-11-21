import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256 } from '../src/core/files.ts';

if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Native helpers require Linux or macOS');
const output = resolve('artifacts/native');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: 0o700 });
const binaries: Record<string, any> = {};
for (const name of process.platform === 'darwin' ? ['publish', 'filesystem.node'] : ['owner', 'publish', 'filesystem.node']) {
  const source = name === 'filesystem.node' ? 'native/filesystem.c' : `native/${name}.c`;
  const args = ['-O2', '-Wall', '-Wextra', '-Werror', ...(name === 'filesystem.node' ? [process.platform === 'darwin' ? '-bundle' : '-shared', ...(process.platform === 'darwin' ? ['-undefined', 'dynamic_lookup'] : ['-fPIC']), '-DNAPI_VERSION=8', '-I', resolve(dirname(process.execPath), '../include/node')] : []), resolve(source), '-o', resolve(output, name)];
  execFileSync('cc', args, { stdio: 'inherit' }); await chmod(resolve(output, name), 0o700);
  binaries[name] = { binarySha256: sha256(await readFile(resolve(output, name))), sourceSha256: sha256(await readFile(source)), command: ['cc', ...args] };
}
await writeFile(resolve(output, 'identity.json'), JSON.stringify({ platform: process.platform, arch: process.arch, compiler: execFileSync('cc', ['--version'], { encoding: 'utf8' }).split('\n')[0], binaries }, null, 2) + '\n', { mode: 0o600 });
