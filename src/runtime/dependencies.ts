import { createRequire } from 'node:module';
import { readFile, open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, SessionError } from '../core/errors.ts';

export interface Dependencies { codex: string; claude: string; owner: string; publish: string; broker: string; catalog: string; producer: Record<string, string> }
async function checkedFile(path: string, expected: string) {
  const file = await open(path, 'r');
  try {
    const st = await file.stat(); if (!st.isFile() || st.size > 512 * 1024 * 1024) fail('DEPENDENCY', 'Invalid installed dependency file');
    const hash = createHash('sha256');
    for await (const bytes of file.createReadStream({ autoClose: false })) hash.update(bytes);
    if (hash.digest('hex') !== expected) fail('DEPENDENCY', 'Installed dependency integrity mismatch');
  } finally { await file.close(); }
}
export async function resolveDependencies(): Promise<Dependencies> {
  // Only the measured Linux arm64 pair enters the candidate. Other platforms
  // are outside the accepted scope, rather than pending qualification.
  if (process.platform !== 'linux' || process.arch !== 'arm64' || process.version !== 'v24.22.3') fail('UNSUPPORTED', 'Candidate currently requires Linux arm64 and Node 24.22.3');
  try {
    const req = createRequire(import.meta.url);
    async function pkg(name: string, version: string, resolver = req) {
      const path = resolver.resolve(name + '/package.json'); const data = JSON.parse(await readFile(path, 'utf8'));
      if (data.name !== name || data.version !== version) fail('DEPENDENCY', `Unsupported installed ${name}`);
      return path;
    }
    const codexPkg = await pkg('@openai/codex', '0.112.0');
    const codexReq = createRequire(codexPkg);
    const codexNative = req.resolve('@openai/codex-linux-arm64/package.json');
    const codex = join(dirname(codexNative), 'vendor/aarch64-unknown-linux-musl/codex/codex');
    const claudePkg = await pkg('@agentclientprotocol/claude-agent-acp', '0.109.0');
    const adapterReq = createRequire(claudePkg);
    const sdkPath = adapterReq.resolve('@anthropic-ai/claude-agent-sdk');
    const sdkPkg = join(dirname(sdkPath), 'package.json');
    const sdk = JSON.parse(await readFile(sdkPkg, 'utf8'));
    if (sdk.name !== '@anthropic-ai/claude-agent-sdk' || sdk.version !== '0.3.328') fail('DEPENDENCY', 'Unsupported Claude SDK');
    const sdkReq = createRequire(sdkPath);
    const nativeClaude = sdkReq.resolve('@anthropic-ai/claude-agent-sdk-linux-arm64/claude');
    const claude = join(dirname(claudePkg), 'dist/index.js');
    await checkedFile(codex, '2ab154375077ea992689f576f6463cbb48d29178c80bf1d1196f6d2da6aecc27');
    await checkedFile(nativeClaude, '307f8bada27b37db7553fac75e86004e3dbff5a931ffc611b54fe710ce1eb521');
    await checkedFile(claude, 'f766071bfb432f79036ca90c67efc5306373be6b5129a240820d03146d2f4cb9');
    const nativeRoot = fileURLToPath(new URL('../native/', import.meta.url));
    const identity = JSON.parse(await readFile(join(nativeRoot, 'identity.json'), 'utf8'));
    if (identity.platform !== process.platform || identity.arch !== process.arch) fail('DEPENDENCY', 'Installed helper platform mismatch');
    for (const name of ['owner', 'publish', 'filesystem.node']) {
      const path = join(nativeRoot, name); await checkedFile(path, identity.binaries[name].binarySha256);
      if (!((await lstat(path)).mode & 0o111)) fail('DEPENDENCY', 'Installed helper is not executable');
    }
    return { codex, claude, owner: join(nativeRoot, 'owner'), publish: join(nativeRoot, 'publish'), broker: fileURLToPath(new URL('../broker-entry.js', import.meta.url)), catalog: fileURLToPath(new URL('../codex-model.json', import.meta.url)), producer: { node: process.versions.node, codex: '0.112.0', claudeAdapter: '0.109.0', claudeSdk: '0.3.328', claude: '2.1.328', platform: `${process.platform}-${process.arch}` } };
  } catch (cause) { if (cause instanceof SessionError) throw cause; throw new SessionError('DEPENDENCY', 'Required installed dependencies are unavailable; no installation attempted', { cause }); }
}
