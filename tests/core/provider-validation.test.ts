import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ClaudeCodec } from '../../src/providers/codecs.ts';
import { claudeProjectKey } from '../../src/providers/claude-layout.ts';
test('S07/D04: valid JSON without native Claude conversation fields is not restorable', async t => {
  const home = await mkdtemp(join(tmpdir(), 'claude-record-')); t.after(() => rm(home, { recursive: true, force: true }));
  const workspace = '/fixture/workspace', id = randomUUID(), project = join(home, 'projects', claudeProjectKey(workspace)); await mkdir(project, { recursive: true, mode: 0o700 });
  const valid = { type: 'user', sessionId: id, version: '2.1.328', uuid: randomUUID(), parentUuid: null, message: { role: 'user', content: [{ type: 'text', text: 'context' }] } };
  const path = join(project, id + '.jsonl'), codec = new ClaudeCodec(); await writeFile(path, JSON.stringify(valid) + '\n', { mode: 0o600 }); await codec.guard(home, workspace, id);
  for (const record of [{ type: 'user', sessionId: id, version: '2.1.328' }, { ...valid, uuid: undefined }, { ...valid, parentUuid: 'missing' }, { ...valid, message: { role: 'assistant', content: [] } }, { ...valid, message: null }]) {
    await writeFile(path, JSON.stringify(record) + '\n'); await assert.rejects(codec.guard(home, workspace, id), { code: 'RESTORE_FAILED' });
  }
});
