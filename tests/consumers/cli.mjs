import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const root = process.env.CONSUMER_STATE_ROOT, provider = process.env.CONSUMER_PROVIDER;
const cli = path.join(path.dirname(new URL(import.meta.resolve('acp-plus-session')).pathname), 'cli.js');
const remembered = 'remembered-' + randomUUID(), priorTool = 'prior-tool-' + randomUUID();
const facts = { remembered, priorTool, branches: {} }, checks = [], invocations = [];
async function invoke(mode, workspace, prompt, checkpoint, output, allow = true) {
  const args = [cli, 'run', '--provider', provider, '--workspace', workspace, '--prompt', prompt, '--base-url', process.env.CONSUMER_ENDPOINT, ...(allow ? ['--allow-tools'] : []), ...(mode === 'new' ? ['--new'] : ['--restore', checkpoint]), ...(output ? ['--export', output] : [])];
  const result = await run(process.execPath, args, { timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, [provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY']: 'consumer-fixture-key' } });
  invocations.push({ command: [process.execPath, ...args], code: 0 });
  assert.ok(result.stdout.includes('"stopReason":"end_turn"')); assert.deepEqual(await fs.readdir(process.env.TMPDIR), []);
}
const make = async name => { const workspace = path.join(root, name); await fs.mkdir(workspace, { mode: 0o700 }); return workspace; };
const source = await make('source-workspace'), checkpoint = path.join(root, 'checkpoint');
await fs.writeFile(path.join(source, 'context.txt'), priorTool);
await invoke('new', source, `Remember ${remembered}. Read context.txt using the local tool.`, null, checkpoint);
await fs.rm(source, { recursive: true }); checks.push('source-private-state-and-workspace-deleted');
const sourceManifest = await fs.readFile(path.join(checkpoint, 'manifest.json'));
for (const branch of ['alpha', 'beta']) {
  const workspace = await make(branch + '-workspace'); facts.branches[branch] = branch + '-' + randomUUID();
  await fs.writeFile(path.join(workspace, 'destination.txt'), facts.branches[branch]);
  const successor = path.join(root, branch + '-successor');
  await invoke('restore', workspace, 'Continue using remembered context. Read destination.txt using the local tool.', checkpoint, successor);
  await fs.rm(workspace, { recursive: true }); const next = await make(branch + '-next-workspace');
  await invoke('restore', next, 'Continue with prior context.', successor); checks.push(branch + '-successor-restored-after-branch-deletion');
}
assert.deepEqual(await fs.readFile(path.join(checkpoint, 'manifest.json')), sourceManifest);
for (const args of [[cli, 'run', '--provider', provider, '--workspace', root, '--prompt', 'MUST NOT RUN', '--new', '--restore', checkpoint], [cli, 'run', '--provider', provider, '--workspace', root, '--prompt', 'MUST NOT RUN', '--restore', path.join(root, 'missing')]]) {
  await assert.rejects(run(process.execPath, args, { env: process.env }), error => error.code === 1); invocations.push({ command: [process.execPath, ...args], code: 1 });
}
checks.push('exclusive-create-restore-modes', 'missing-restore-never-became-fresh');
const denied = await make('denied-workspace');
await invoke('new', denied, 'Exercise the denial boundary.', null, null, false);
await assert.rejects(fs.access(path.join(denied, 'forbidden-marker'))); checks.push('absent-permission-handler-prevents-write');
console.log(JSON.stringify({ provider, consumer: 'cli', facts, checks, invocations, importedFrom: import.meta.resolve('acp-plus-session') }));
