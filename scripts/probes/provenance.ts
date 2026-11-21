import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fixtureEnv } from './support.ts';

async function fileIdentity(path: string) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { path, bytes, sha256: hash.digest('hex') };
}

// Mirror installed adapters' module resolution, never PATH-selected executables.
// These hashes identify measured artifacts, not a claim of signed provenance.
export async function provenance(deps: string, root: string) {
  const req = createRequire(join(deps, 'package.json'));
  const codexPkg = req.resolve('@openai/codex/package.json');
  const codexReq = createRequire(codexPkg);
  if (process.platform !== 'linux' || process.arch !== 'arm64') throw new Error('Provenance fixture currently implements Linux arm64 only');
  const codexNativePkg = codexReq.resolve('@openai/codex-linux-arm64/package.json');
  const codex = join(dirname(codexNativePkg), 'vendor/aarch64-unknown-linux-musl/codex/codex');
  const claudePkg = req.resolve('@agentclientprotocol/claude-agent-acp/package.json');
  const claudeReq = createRequire(claudePkg);
  const sdk = claudeReq.resolve('@anthropic-ai/claude-agent-sdk');
  const sdkPkg = join(dirname(sdk), 'package.json');
  // Use the upstream adapter's installed resolver; ambient executable overrides
  // are explicitly prohibited for this provenance measurement.
  const resolver = await import(pathToFileURL(join(dirname(claudePkg), 'dist/claude-cli.js')).href);
  if (process.env.CLAUDE_CODE_EXECUTABLE) throw new Error('Ambient Claude executable override would invalidate provenance');
  const claude = await resolver.claudeCliPath();
  const env = await fixtureEnv(join(root, 'version-home'));
  async function describe(path: string, pkg: string) {
    const packageJson = JSON.parse(await readFile(pkg, 'utf8'));
    return { package: packageJson.name, packageVersion: packageJson.version,
      packageJson: await fileIdentity(pkg), binary: await fileIdentity(path),
      versionCommand: [path, '--version'], version: execFileSync(path, ['--version'], { env, cwd: root, timeout: 10000, encoding: 'utf8' }).trim() };
  }
  return {
    codex: { ...await describe(codex, codexNativePkg), launcher: await fileIdentity(join(dirname(codexPkg), 'bin/codex.js')),
      inspectedSource: { repo: 'https://github.com/openai/codex', tag: 'rust-v0.112.0', commit: '0ec16b2d9dd7d92f5661b132afdf4df3abb3d443', dispatch: 'codex_core::ThreadManager (exec/src/lib.rs); source inspection plus runtime process traces, no rebuilt binary attestation' } },
    claude: { ...await describe(claude, sdkPkg), adapterPackageJson: await fileIdentity(claudePkg), launcher: await fileIdentity(join(dirname(claudePkg), 'dist/index.js')),
      inspectedSource: { repo: 'https://github.com/agentclientprotocol/claude-agent-acp', commit: '80440d8b8294f9d4cd086d7cba39c716107657f0' } },
    c2opsReference: { repo: 'https://github.com/colony-2/c2ops', commit: 'bb30dfcf46980053113ae23e7bef757049208324', use: 'Algorithm and fixture reference; its excluded App Server runtimes are not product qualification' }
  };
}
