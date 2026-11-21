// Executed from an independent install. Only the distributable is imported.
import { createSession, restoreSession } from 'acp-plus-session';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { waitForPid, pidAbsent } from './pid-readiness.mjs';
const fixtureImport = `import { publishPid, waitForPid } from ${JSON.stringify(new URL('./pid-readiness.mjs', import.meta.url).href)};`;
const root = process.env.CONSUMER_STATE_ROOT, provider = process.env.CONSUMER_PROVIDER;
const connection = { apiKey: 'consumer-fixture-key', baseUrl: process.env.CONSUMER_ENDPOINT };
const credentialSentinel = 'credential-must-stay-out-' + randomUUID();
const remembered = 'remembered-' + randomUUID(), priorTool = 'prior-tool-' + randomUUID();
const facts = { remembered, priorTool, branches: {} }; const checks = [];
const permission = async params => {
  const option = params.options.find(o => o.kind === 'allow_once');
  return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
};
const make = async name => { const workspace = path.join(root, name); await fs.mkdir(workspace, { mode: 0o700 }); return workspace; };
const hookProgram = path.join(root, 'fixture-hook.mjs'), futureProgram = path.join(root, 'future-hook.mjs'), futureMarker = path.join(root, 'future-import-marker');
await fs.writeFile(hookProgram, `import fs from'node:fs';let text='';for await(const b of process.stdin)text+=b;const input=JSON.parse(text);fs.writeFileSync('opaque.bin',Buffer.from([0,255,128,10]),{mode:0o700});console.log(JSON.stringify({counter:(input.data?.counter??0)+1}));`);
await fs.writeFile(futureProgram, `import fs from'node:fs';let text='';for await(const b of process.stdin)text+=b;const input=JSON.parse(text);if(input.phase==='import')fs.writeFileSync(process.argv[2],'MUST NOT RUN');fs.writeFileSync('future.bin',Buffer.from([255,0,127]),{mode:0o600});console.log('{"futureNumber":9007199254740993,"command":["/must/never/execute"]}');`);
const hooks = [{ id: 'app.fixture', version: '1', required: true, command: [process.execPath, hookProgram], validate: data => typeof data?.counter === 'number' }];
const sourceHooks = [...hooks, { id: 'future.optional', version: '9', required: false, command: [process.execPath, futureProgram, futureMarker], validate: () => true }];
const checkpoint = path.join(root, 'checkpoint'); const source = await make('source-workspace');
await fs.writeFile(path.join(source, 'context.txt'), priorTool);
const session = await createSession({ provider, workspace: source, connection, permission, hooks: sourceHooks, application: { unknown: { test: [1, true, null, '🥑'] } } });
await session.prompt(`Remember ${remembered}. Read context.txt using the local tool.`);
const capsule = (await fs.readdir(process.env.TMPDIR))[0], nativeHome = path.join(process.env.TMPDIR, capsule, 'native');
for (const name of ['auth.json', 'excluded-settings.json', 'excluded.lock']) await fs.writeFile(path.join(nativeHome, name), credentialSentinel, { mode: 0o600 });
await fs.mkdir(path.join(nativeHome, 'excluded-cache'), { mode: 0o700 }); await fs.writeFile(path.join(nativeHome, 'excluded-cache/secret'), credentialSentinel, { mode: 0o600 });
if (provider === 'codex') {
  await fs.mkdir(path.join(nativeHome, 'sessions/unrelated'), { mode: 0o700 }); await fs.writeFile(path.join(nativeHome, 'sessions/unrelated', randomUUID() + '.jsonl'), credentialSentinel, { mode: 0o600 });
} else {
  const project = (await fs.readdir(path.join(nativeHome, 'projects')))[0];
  await fs.writeFile(path.join(nativeHome, 'projects', project, randomUUID() + '.jsonl'), credentialSentinel, { mode: 0o600 });
}
const reference = await session.exportCheckpoint(checkpoint);
assert.equal(session.state, 'stopped'); await assert.rejects(session.prompt('MUST NOT RUN'), { code: 'STOPPED' });
await session.resume(); assert.equal(session.state, 'idle'); await session.close();
assert.deepEqual(await fs.readdir(process.env.TMPDIR), []);
await fs.rm(source, { recursive: true });
checks.push('export-stopped-explicit-resume', 'source-private-state-and-workspace-deleted');
async function digest(directory) {
  const hash = createHash('sha256');
  async function visit(root, prefix = '') { for (const name of (await fs.readdir(root)).sort()) { const p = path.join(root, name), rel = prefix + name; const st = await fs.lstat(p); hash.update(rel + ':' + st.mode + ':'); if (st.isDirectory()) await visit(p, rel + '/'); else { const bytes = await fs.readFile(p); assert.equal(bytes.includes(Buffer.from(credentialSentinel)), false); assert.equal(bytes.includes(Buffer.from('consumer-fixture-key')), false); hash.update(bytes); } } }
  await visit(directory); return hash.digest('hex');
}
const sharedDigest = await digest(checkpoint); checks.push('built-in-checkpoints-exclude-auth-config-cache-lock-unrelated-session-sentinels');
for (const branch of ['alpha', 'beta']) {
  const workspace = await make(`${branch}-workspace`), fact = `${branch}-${randomUUID()}`; facts.branches[branch] = fact;
  await fs.writeFile(path.join(workspace, 'destination.txt'), fact);
  const resumed = await restoreSession(checkpoint, { provider, workspace, connection, permission, hooks });
  assert.ok(resumed.notices.some(n => n.includes('future.optional')));
  await resumed.prompt('Continue using remembered context. Read destination.txt using the local tool.');
  const successor = path.join(root, branch + '-successor'); await resumed.exportCheckpoint(successor); await digest(successor);
  assert.deepEqual(await fs.readFile(path.join(successor, 'extensions/app.fixture/opaque.bin')), Buffer.from([0,255,128,10]));
  assert.equal((await fs.stat(path.join(successor, 'extensions/app.fixture/opaque.bin'))).mode & 0o777, 0o700);
  assert.deepEqual(await fs.readFile(path.join(successor, 'extensions/future.optional/future.bin')), Buffer.from([255,0,127]));
  assert.ok((await fs.readFile(path.join(successor, 'manifest.json'), 'utf8')).includes('9007199254740993'));
  await resumed.close();
  await fs.rm(workspace, { recursive: true }); assert.deepEqual(await fs.readdir(process.env.TMPDIR), []);
  const nextWorkspace = await make(`${branch}-next-workspace`);
  const next = await restoreSession(successor, { provider, workspace: nextWorkspace, connection, permission, hooks });
  await next.prompt('Continue with prior context.'); await next.close();
  checks.push(branch + '-successor-restored-after-branch-deletion');
}
await assert.rejects(fs.access(futureMarker)); checks.push('registered-hook-binary-and-mode-roundtrip', 'unknown-optional-json-and-files-retained-inactively');
assert.equal(await digest(checkpoint), sharedDigest); checks.push('shared-checkpoint-immutable');
const concurrentWorkspaces = await Promise.all(['concurrent-one', 'concurrent-two'].map(make));
const concurrent = await Promise.all(concurrentWorkspaces.map(workspace => restoreSession(checkpoint, { provider, workspace, connection, permission, hooks })));
assert.notEqual(concurrent[0].id, concurrent[1].id); assert.equal((await fs.readdir(process.env.TMPDIR)).length, 2);
await Promise.all(concurrent.map((s, i) => s.exportCheckpoint(path.join(root, 'concurrent-checkpoint-' + i)))); await Promise.all(concurrent.map(s => s.close()));
assert.equal(await digest(checkpoint), sharedDigest); assert.deepEqual(await fs.readdir(process.env.TMPDIR), []); checks.push('concurrent-independent-restore-and-export-isolated');
const manifest = JSON.parse(await fs.readFile(path.join(checkpoint, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.application, { unknown: { test: [1, true, null, '🥑'] } });
const missingWorkspace = await make('failed-restore-workspace');
for (const invalid of [undefined, null, '', 0]) await assert.rejects(restoreSession(invalid, { provider, workspace: missingWorkspace, connection, permission }), { code: 'RESTORE_FAILED' });
await assert.rejects(restoreSession(path.join(root, 'missing-checkpoint'), { provider, workspace: missingWorkspace, connection, permission }), { code: 'RESTORE_FAILED' });
assert.deepEqual(await fs.readdir(process.env.TMPDIR), []); checks.push('missing-restore-never-created-fresh-state');
const deniedWorkspace = await make('denied-workspace');
const denied = await createSession({ provider, workspace: deniedWorkspace, connection });
await denied.prompt('Exercise the denial boundary.'); await denied.close();
await assert.rejects(fs.access(path.join(deniedWorkspace, 'forbidden-marker'))); checks.push('absent-permission-handler-prevents-write');
const busyWorkspace = await make('busy-workspace');
let entered; const requested = new Promise(resolve => { entered = resolve; }); let decide;
const busy = await createSession({ provider, workspace: busyWorkspace, connection, permission: async () => { entered(); return new Promise(resolve => { decide = resolve; }); } });
const turn = busy.prompt('Exercise the busy export boundary.'); await requested;
await assert.rejects(busy.exportCheckpoint(path.join(root, 'busy-checkpoint')), { code: 'BUSY' });
decide({ outcome: { outcome: 'cancelled' } }); await turn; await busy.close();
await assert.rejects(fs.access(path.join(root, 'busy-checkpoint'))); checks.push('native-pending-permission-makes-export-busy');
const guardWorkspace = await make('guard-workspace');
const guarded = await restoreSession(checkpoint, { provider, workspace: guardWorkspace, connection, permission, hooks });
async function jsonlFiles(directory) { const result = []; for (const name of await fs.readdir(directory)) { const p = path.join(directory, name); if ((await fs.lstat(p)).isDirectory()) result.push(...await jsonlFiles(p)); else if (name.endsWith('.jsonl')) result.push(p); } return result; }
for (const capsule of await fs.readdir(process.env.TMPDIR)) for (const file of await jsonlFiles(path.join(process.env.TMPDIR, capsule, 'native'))) await fs.rm(file);
await assert.rejects(guarded.prompt('MUST NOT RUN'), { code: 'RESTORE_FAILED' }); await guarded.close(); checks.push('native-state-loss-on-reentry-never-became-fresh');
const malformed = path.join(root, 'malformed-native-checkpoint'); await fs.cp(checkpoint, malformed, { recursive: true });
const brokenManifest = JSON.parse(await fs.readFile(path.join(malformed, 'manifest.json'), 'utf8'));
const record = brokenManifest.inventory.find(e => e.kind === 'file' && e.path.endsWith('.jsonl'));
const invalid = 'not native JSON\n'; await fs.writeFile(path.join(malformed, record.path), invalid); record.size = Buffer.byteLength(invalid); record.sha256 = createHash('sha256').update(invalid).digest('hex');
const hookMarker = path.join(root, 'invalid-state-hook-marker'), invalidHookProgram = path.join(root, 'invalid-state-hook.mjs');
await fs.writeFile(invalidHookProgram, `import fs from 'node:fs';fs.writeFileSync(process.argv[2],'MUST NOT RUN');console.log('null');`);
brokenManifest.extensions.push({ id: 'test.import', version: '1', required: true, data: null });
await fs.writeFile(path.join(malformed, 'manifest.json'), JSON.stringify(brokenManifest));
await assert.rejects(restoreSession(malformed, { provider, workspace: guardWorkspace, connection, hooks: [...hooks, { id: 'test.import', version: '1', required: true, command: [process.execPath, invalidHookProgram, hookMarker], validate: () => true }] }), { code: 'RESTORE_FAILED' });
await assert.rejects(fs.access(hookMarker)); checks.push('corrupt-native-state-rejected-before-import-hook');
const incomplete = provider === 'codex' ? (await fs.readFile(path.join(checkpoint, record.path), 'utf8')).split('\n')[0] + '\n' : JSON.stringify({ type: 'user', sessionId: brokenManifest.nativeId, version: '2.1.328' }) + '\n';
await fs.writeFile(path.join(malformed, record.path), incomplete); record.size = Buffer.byteLength(incomplete); record.sha256 = createHash('sha256').update(incomplete).digest('hex');
await fs.writeFile(path.join(malformed, 'manifest.json'), JSON.stringify(brokenManifest));
await assert.rejects(restoreSession(malformed, { provider, workspace: guardWorkspace, connection, hooks: [...hooks, { id: 'test.import', version: '1', required: true, command: [process.execPath, invalidHookProgram, hookMarker], validate: () => true }] }), { code: 'RESTORE_FAILED' });
await assert.rejects(fs.access(hookMarker)); checks.push('well-formed-json-without-native-conversation-rejected-before-hooks');

const bypassWorkspace = await make('bypass-workspace'); facts.bypass = 'never-send-' + randomUUID();
await fs.writeFile(path.join(bypassWorkspace, 'secret.txt'), facts.bypass);
await fs.writeFile(path.join(bypassWorkspace, 'sentinel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'));
const bypass = await createSession({ provider, workspace: bypassWorkspace, connection }); await bypass.prompt('Exercise native tool restrictions.'); await bypass.close(); checks.push('unadvertised-native-tool-cannot-bypass-permission-handler');
const writerWorkspace = await make('writer-workspace');
await fs.writeFile(path.join(writerWorkspace, 'writer.mjs'), `${fixtureImport}import fs from 'node:fs';process.on('SIGTERM',()=>{});fs.appendFileSync('writes','x');setInterval(()=>fs.appendFileSync('writes','x'),10);await publishPid('pid');`);
await fs.writeFile(path.join(writerWorkspace, 'leader.mjs'), `${fixtureImport}import{spawn}from'node:child_process';const c=spawn(process.execPath,['writer.mjs'],{detached:true,stdio:'inherit'});c.unref();const i=setInterval(()=>{},10);await waitForPid('pid');clearInterval(i);process.exit(0);`);
const writer = await createSession({ provider, workspace: writerWorkspace, connection, permission, hooks }); await writer.prompt('Exercise the detached writer ownership boundary.');
const pid = await waitForPid(path.join(writerWorkspace, 'pid')); assert.ok(pidAbsent(pid));
const size = (await fs.stat(path.join(writerWorkspace, 'writes'))).size; assert.ok(size > 0); await new Promise(r=>setTimeout(r,100)); assert.equal((await fs.stat(path.join(writerWorkspace, 'writes'))).size, size);
await writer.exportCheckpoint(path.join(root, 'writer-checkpoint')); await writer.close(); checks.push('product-terminal-owner-reaped-detached-term-ignoring-writer-before-export');
const updateWorkspace = await make('slow-update-workspace'); let releaseUpdate, enteredUpdate;
const updateEntered = new Promise(resolve => { enteredUpdate = resolve; });
const slow = await createSession({ provider, workspace: updateWorkspace, connection, onUpdate: async p => { if (p.update?.sessionUpdate === 'agent_message_chunk') { enteredUpdate(); await new Promise(resolve => { releaseUpdate = resolve; }); } } });
const updateCancellation = new AbortController(), slowTurn = slow.prompt('Exercise cancellation during an undelivered update.', updateCancellation.signal); void slowTurn.catch(() => {});
await updateEntered; updateCancellation.abort(); await assert.rejects(slowTurn, { code: 'CANCELLED' });
await assert.rejects(slow.exportCheckpoint(path.join(root, 'undelivered-update-checkpoint')), { code: 'BUSY' });
releaseUpdate(); await new Promise(resolve => setImmediate(resolve)); await slow.close(); checks.push('cancelled-blocked-update-reaps-native-writers-and-prevents-export-until-callback-settles');
// Corrupt only this independent installation, replacing directory entries
// rather than mutating shared package-store inodes. No installer may run.
const installed = path.dirname(new URL(import.meta.resolve('acp-plus-session')).pathname);
const installedOwner = path.join(installed, 'native/owner'), savedOwner = installedOwner + '.qualification-original';
await fs.rename(installedOwner, savedOwner);
try {
  await assert.rejects(createSession({ provider, workspace: guardWorkspace, connection }), { code: 'DEPENDENCY' });
  await fs.writeFile(installedOwner, '#!/bin/sh\ntouch ' + JSON.stringify(path.join(root, 'substituted-helper-ran')) + '\n', { mode: 0o700 });
  await assert.rejects(createSession({ provider, workspace: guardWorkspace, connection }), { code: 'DEPENDENCY' });
  await assert.rejects(fs.access(path.join(root, 'substituted-helper-ran')));
  assert.deepEqual(await fs.readdir(process.env.TMPDIR), []);
} finally { await fs.rm(installedOwner, { force: true }); await fs.rename(savedOwner, installedOwner); }
checks.push('missing-and-substituted-installed-helper-failed-before-private-state-creation');
const adapterManifest = createRequire(import.meta.resolve('acp-plus-session')).resolve('@agentclientprotocol/claude-agent-acp/package.json'), savedManifest = adapterManifest + '.qualification-original';
await fs.rename(adapterManifest, savedManifest);
try {
  const unsupported = JSON.parse(await fs.readFile(savedManifest, 'utf8')); unsupported.version = '0.0.0-unsupported'; await fs.writeFile(adapterManifest, JSON.stringify(unsupported));
  await assert.rejects(createSession({ provider, workspace: guardWorkspace, connection }), { code: 'DEPENDENCY' }); assert.deepEqual(await fs.readdir(process.env.TMPDIR), []);
} finally { await fs.rm(adapterManifest, { force: true }); await fs.rename(savedManifest, adapterManifest); }
checks.push('unsupported-adapter-version-failed-before-private-state-creation');

console.log(JSON.stringify({ provider, consumer: 'library', reference, facts, checks, importedFrom: import.meta.resolve('acp-plus-session') }));
