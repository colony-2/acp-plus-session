import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, link, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sealBundle, stageBundle, validateManifest } from '../../src/core/bundle.ts';
import type { ManifestMetadata } from '../../src/core/bundle.ts';
import { limitsWith, PrivateTree } from '../../src/core/files.ts';
import { parseJson } from '../../src/core/json.ts';

export const compatibility = { providers: { codex: ['test-v1'], claude: ['test-v1'] }, features: ['test'] };
export const metadata = (): ManifestMetadata => ({ provider: 'codex', nativeId: randomUUID(), stateFormat: 'test-v1', producer: { fixture: '1' }, requiredFeatures: ['test'], application: { unknown: { nested: [true, null, '🥑', 1.25] } }, extensions: [{ id: 'future.optional', version: '9', required: false, data: { arbitrary: [3] } }] });
async function fixture(t: test.TestContext, payload = Buffer.from([0, 255, 128, 10])) {
  const root = await mkdtemp(join(tmpdir(), 'bundle-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'checkpoint'); await mkdir(source, { mode: 0o700 });
  await mkdir(join(source, 'provider'), { mode: 0o700 });
  await writeFile(join(source, 'provider/native.bin'), payload, { mode: 0o600 });
  const sealed = await sealBundle(source, metadata(), compatibility);
  return { root, source, ...sealed };
}
async function alter(source: string, change: (m: any) => void) {
  const path = join(source, 'manifest.json'), m = JSON.parse(await readFile(path, 'utf8')); change(m); await writeFile(path, JSON.stringify(m));
}

test('B01: opaque binary, unknown application and optional extension state survive validated staging', async t => {
  const f = await fixture(t); const bytes = await readFile(join(f.source, 'provider/native.bin'));
  const restored = await stageBundle(f.source, f.root, compatibility);
  assert.deepEqual(restored.manifest.application, f.manifest.application);
  assert.deepEqual(restored.manifest.extensions, f.manifest.extensions);
  assert.deepEqual(await readFile(join(restored.staging, 'provider/native.bin')), bytes);
  assert.equal(restored.manifestSha256, f.manifestSha256);
});
test('B02: unknown formats, providers, required features and envelope versions fail before staging', async t => {
  const f = await fixture(t); const original = await readFile(join(f.source, 'manifest.json'));
  for (const patch of [{ schema: 'future' }, { stateFormat: 'future' }, { provider: 'other' }, { requiredFeatures: ['future'] }]) {
    await writeFile(join(f.source, 'manifest.json'), original);
    await alter(f.source, m => Object.assign(m, patch));
    await assert.rejects(stageBundle(f.source, f.root, compatibility), { code: 'INCOMPATIBLE' });
    assert.deepEqual(await readdir(f.root), ['checkpoint']);
  }
});
test('B03/D18: traversal, aliases, missing parents and namespace violations fail', async t => {
  const f = await fixture(t);
  const m = f.manifest;
  for (const path of ['/tmp/escape', '../escape', 'provider/../escape', 'provider//x', 'provider/./x', 'provider\\x', 'provider/a\u0000b', 'other/x', 'provider/missing/x']) {
    const changed = structuredClone(m); changed.inventory[1].path = path;
    assert.throws(() => validateManifest(changed as any, compatibility, limitsWith()));
  }
  for (const paths of [['provider/A', 'provider/a'], ['provider/é', 'provider/e\u0301'], ['provider/a', 'provider/a']]) {
    const changed = structuredClone(m); changed.inventory = [m.inventory[0], ...paths.map(path => ({ ...m.inventory[1], path }))];
    assert.throws(() => validateManifest(changed as any, compatibility, limitsWith()), /collid/);
  }
});
test('B03/D18: symlinks, hardlinks, unsafe modes and special files are rejected', async t => {
  const f = await fixture(t); const payload = join(f.source, 'provider/native.bin');
  await rm(payload); await symlink('/etc/passwd', payload);
  await assert.rejects(stageBundle(f.source, f.root, compatibility));
  await rm(payload); await writeFile(payload, 'bytes', { mode: 0o600 });
  await link(payload, join(f.root, 'alias'));
  await assert.rejects(stageBundle(f.source, f.root, compatibility));
  await rm(join(f.root, 'alias')); await chmod(payload, 0o644);
  await assert.rejects(stageBundle(f.source, f.root, compatibility));
  await chmod(payload, 0o600); await rm(payload); await mkdir(payload, { mode: 0o700 });
  await assert.rejects(stageBundle(f.source, f.root, compatibility));
  await rm(payload, { recursive: true }); execFileSync('mkfifo', ['-m', '600', payload]);
  await assert.rejects(stageBundle(f.source, f.root, compatibility));
});
test('B04: missing, extra, truncated and hash-mismatched payloads never return an import', async t => {
  for (const mutation of ['missing', 'extra', 'truncated', 'hash']) {
    const f = await fixture(t); const payload = join(f.source, 'provider/native.bin');
    if (mutation === 'missing') await rm(payload);
    if (mutation === 'extra') await writeFile(join(f.source, 'provider/extra'), 'x', { mode: 0o600 });
    if (mutation === 'truncated') await writeFile(payload, Buffer.from([0]));
    if (mutation === 'hash') await writeFile(payload, Buffer.from([1, 255, 128, 10]));
    await assert.rejects(stageBundle(f.source, f.root, compatibility), { code: 'INTEGRITY' });
    assert.deepEqual(await readdir(f.root), ['checkpoint']);
  }
});
test('B05/D19: finite manifest, entry, file, aggregate and depth boundaries', async t => {
  const f = await fixture(t); const size = (await readFile(join(f.source, 'manifest.json'))).length;
  const limits = { manifestBytes: size, entries: 2, fileBytes: 4, totalBytes: 4 };
  await stageBundle(f.source, f.root, compatibility, limits);
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    await assert.rejects(stageBundle(f.source, f.root, compatibility, { ...limits, [key]: limits[key] - 1 }), { code: 'LIMIT' });
  }
  assert.deepEqual(parseJson('[[0]]', 2), [[0]]);
  assert.throws(() => parseJson('[[[0]]]', 2), { code: 'LIMIT' });
  for (const value of [NaN, Infinity, 0, -1, 1.1]) assert.throws(() => limitsWith({ fileBytes: value }), { code: 'LIMIT' });
});
test('D18: duplicate keys including escaped aliases and malformed JSON fail', () => {
  for (const json of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}', '[1,]', '{"x":true}x']) assert.throws(() => parseJson(json));
});
test('D17: anchored open survives ancestor replacement without reading substituted files', async t => {
  const f = await fixture(t); const tree = await PrivateTree.open(f.source);
  t.after(() => tree.close());
  const { rename } = await import('node:fs/promises');
  await rename(f.source, join(f.root, 'original'));
  await mkdir(f.source, { mode: 0o700 }); await mkdir(join(f.source, 'provider'), { mode: 0o700 });
  await writeFile(join(f.source, 'provider/native.bin'), 'unchecked substitute', { mode: 0o600 });
  assert.deepEqual(await tree.read('provider/native.bin', 100), Buffer.from([0, 255, 128, 10]));
  await rm(join(f.root, 'original/provider/native.bin'));
  await symlink(join(f.source, 'provider/native.bin'), join(f.root, 'original/provider/native.bin'));
  await assert.rejects(tree.read('provider/native.bin', 100));
});

test('B01: arbitrary numeric application JSON survives re-serialization without precision loss', () => {
  for (const token of ['9007199254740993', '1e400', '0.1000000000000000000000001']) {
    const json = '{"opaque":' + token + '}';
    assert.equal(JSON.stringify(parseJson(json)), json);
  }
});

test('B08: staged private state and manifest deny a different unprivileged identity', async t => {
  if (process.getuid?.() !== 0) { t.skip('Requires a separately usable identity; this worker is not root'); return; }
  const f = await fixture(t), restored = await stageBundle(f.source, f.root, compatibility);
  await chmod(f.root, 0o755);
  const read = (path: string) => execFileSync(process.execPath, ['-e', 'try{require("node:fs").readFileSync(process.argv[1]);process.exit(99)}catch(e){if(e.code!=="EACCES")throw e}', path], { uid: 65534, gid: 65534, encoding: 'utf8' });
  read(join(restored.staging, 'provider/native.bin'));
  await chmod(f.source, 0o755); read(join(f.source, 'manifest.json'));
  assert.equal((await (await import('node:fs/promises')).stat(restored.staging)).mode & 0o777, 0o700);
});

test('D19: directory nesting is bounded during inventory and manifest validation', async t => {
  const f = await fixture(t), tree = await PrivateTree.open(f.source); t.after(() => tree.close());
  await tree.inventory(limitsWith({ depth: 2 }));
  await assert.rejects(tree.inventory(limitsWith({ depth: 1 })), { code: 'LIMIT' });
  validateManifest(f.manifest as any, compatibility, limitsWith({ depth: 2 }));
  assert.throws(() => validateManifest(f.manifest as any, compatibility, limitsWith({ depth: 1 })), { code: 'LIMIT' });
});
