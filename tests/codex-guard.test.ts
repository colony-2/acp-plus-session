import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectCodexResume, ResumeValidationError } from '../src/providers/codex-guard.ts';

const id = '12345678-1234-1234-1234-123456789abc';
async function fixture(t: any) {
  const home = await mkdtemp(join(tmpdir(), 'codex-guard-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, 'sessions', `rollout-fixture-${id}.jsonl`);
  await mkdir(join(home, 'sessions'), { mode: 0o700 });
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id, cli_version: '0.112.0', source: 'exec' } }) + '\n' +
    JSON.stringify({ type: 'response_item', payload: { role: 'user', type: 'message', content: [{ type: 'input_text', text: 'native context' }] } }) + '\n', { mode: 0o600 });
  const db = new DatabaseSync(join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT,archived INT,cli_version TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?,0,?)').run(id, path, '0.112.0'); db.close();
  await chmod(join(home, 'state_5.sqlite'), 0o600);
  return { home, path };
}

test('valid exact private thread passes; a missing or different identity fails', async t => {
  const f = await fixture(t);
  assert.equal((await inspectCodexResume(f.home, id)).entries, 2);
  await assert.rejects(inspectCodexResume(f.home, '87654321-1234-1234-1234-123456789abc'), ResumeValidationError);
  await rm(f.path);
  await assert.rejects(inspectCodexResume(f.home, id), ResumeValidationError);
});
test('corrupt, truncated and mismatched native rollouts fail before admission', async t => {
  const f = await fixture(t);
  const meta = JSON.stringify({ type: 'session_meta', payload: { id, cli_version: '0.112.0', source: 'exec' } }) + '\n';
  for (const text of [meta, meta + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user' } }) + '\n', 'invalid\n', '{}\n', '{"type":"session_meta","payload":{"id":"wrong"}}\n', '{"type":"session_meta"}']) {
    await writeFile(f.path, text);
    await assert.rejects(inspectCodexResume(f.home, id), ResumeValidationError);
  }
});
test('state budgets accept the exact boundary and reject excess and invalid budgets', async t => {
  const f = await fixture(t);
  // The index is larger than the rollout, so its size defines this boundary.
  const { stat } = await import('node:fs/promises');
  const boundary = (await stat(join(f.home, 'state_5.sqlite'))).size;
  await inspectCodexResume(f.home, id, boundary);
  for (const budget of [boundary - 1, 0, Infinity, NaN, 1.5]) await assert.rejects(inspectCodexResume(f.home, id, budget), ResumeValidationError);
});
test('symlinked files, directory substitution and hardlink aliases are refused', async t => {
  const f = await fixture(t);
  const saved = join(f.home, 'saved');
  const { rename } = await import('node:fs/promises');
  await rename(f.path, saved); await symlink(saved, f.path);
  await assert.rejects(inspectCodexResume(f.home, id), ResumeValidationError);
  await rm(f.path); await link(saved, f.path);
  await assert.rejects(inspectCodexResume(f.home, id), ResumeValidationError);
  await rm(f.path); await rename(saved, f.path);
  await rename(join(f.home, 'sessions'), join(f.home, 'saved-sessions'));
  await symlink(join(f.home, 'saved-sessions'), join(f.home, 'sessions'));
  await assert.rejects(inspectCodexResume(f.home, id), ResumeValidationError);
});
test('unrelated threads and unsafe private permissions fail validation', async t => {
  const f = await fixture(t);
  await chmod(f.path, 0o644);
  await assert.rejects(inspectCodexResume(f.home, id), ResumeValidationError);
  await chmod(f.path, 0o600);
  const db = new DatabaseSync(join(f.home, 'state_5.sqlite'));
  db.prepare('INSERT INTO threads VALUES(?,?,0,?)').run('87654321-1234-1234-1234-123456789abc', f.path, '0.112.0'); db.close();
  await assert.rejects(inspectCodexResume(f.home, id), ResumeValidationError);
});
