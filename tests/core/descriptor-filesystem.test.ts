import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, symlink, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRelative, directoryNames } from '../../src/runtime/filesystem.ts';

test('POSIX descriptor opens and independent directory cursors survive ancestor replacement', async t => {
  const root = await mkdtemp(join(tmpdir(), 'descriptor-fs-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source'); await mkdir(path, { mode: 0o700 });
  await writeFile(join(path, 'context'), 'original', { mode: 0o600 });
  const parent = await open(path, constants.O_RDONLY | constants.O_DIRECTORY); t.after(() => parent.close());
  await rename(path, join(root, 'moved')); await mkdir(path, { mode: 0o700 });
  await writeFile(join(path, 'context'), 'substitution', { mode: 0o600 });
  const file = openRelative(parent, 'context', constants.O_RDONLY);
  try {
    const bytes = Buffer.alloc(32), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    assert.equal(bytes.subarray(0, bytesRead).toString(), 'original');
  } finally { await file.close(); }
  assert.throws(() => openRelative(file, 'context', constants.O_RDONLY), { code: 'STOPPED' });
  for (let i = 0; i < 3; i++) assert.deepEqual([...directoryNames(parent)], ['context']);
  for (const _name of directoryNames(parent)) break;
  assert.deepEqual([...directoryNames(parent)], ['context']);
});

test('POSIX opens reject traversal and symlinks; directory cursors terminate without retaining a listing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'descriptor-fs-')); t.after(() => rm(root, { recursive: true, force: true }));
  const parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY); t.after(() => parent.close());
  await symlink('/etc/passwd', join(root, 'escape'));
  for (const name of ['.', '..', 'a/b', 'a\0b', '']) assert.throws(() => openRelative(parent, name, constants.O_RDONLY));
  assert.throws(() => openRelative(parent, 'escape', constants.O_RDONLY), { code: 'ELOOP' });
  for (let i = 0; i < 128; i++) await writeFile(join(root, String(i)), 'x', { mode: 0o600 });
  const cursor = directoryNames(parent);
  assert.equal(typeof cursor.next().value, 'string'); cursor.return(undefined);
  assert.equal([...directoryNames(parent)].length, 129);
});
