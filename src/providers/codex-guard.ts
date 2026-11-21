import { parseJson } from '../core/json.ts';
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class ResumeValidationError extends Error {
  readonly code = 'RESTORE_FAILED';
}

const fail = (message: string): never => { throw new ResumeValidationError(message); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Precondition: a quiescent, exclusively owned private home. This guard does not
// materialize an untrusted bundle or establish exclusive process ownership.
// It validates the exact DB lookup used by pinned direct-core Codex 0.112.0,
// before that CLI can receive any prompt (its missing lookup starts fresh).
export async function inspectCodexResume(home: string, id: string, maxFileBytes = 256 * 1024 * 1024) {
  if (!uuid.test(id)) fail('Invalid native thread ID');
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) fail('Invalid finite state budget');
  const root = resolve(home);
  if (await realpath(root) !== root) fail('Native state root must be canonical');
  async function regular(path: string) {
    const rel = relative(root, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) fail('Native reference escapes private home');
    let dir = dirname(path);
    for (;;) {
      const st = await lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid())) fail('Native state directory is not owner-private');
      if (dir === root) break;
      dir = dirname(dir);
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.nlink !== 1 || st.size > maxFileBytes || (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid())) fail('Unsafe native state file');
      return { handle, st };
    } catch (error) { await handle.close(); throw error; }
  }
  try {
    const indexPath = resolve(root, 'state_5.sqlite');
    const index = await regular(indexPath);
    let rollout: string;
    try {
      const db = new DatabaseSync(indexPath, { readOnly: true, timeout: 1000 });
      try {
        db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
        if ((db.prepare('PRAGMA quick_check').get() as any)?.quick_check !== 'ok') fail('Corrupt native state index');
        const rows = db.prepare('SELECT id,rollout_path,archived,cli_version FROM threads').all() as any[];
        if (rows.length !== 1 || rows[0].id !== id || rows[0].archived !== 0 || rows[0].cli_version !== '0.112.0') fail('Native index does not identify the intended supported thread');
        const path = rows[0].rollout_path;
        if (typeof path !== 'string' || !isAbsolute(path)) fail('Native lookup has not been relocated');
        const rel = relative(root, path);
        if (!rel.startsWith('sessions' + sep) || !rel.endsWith(`-${id}.jsonl`)) fail('Invalid native rollout reference');
        rollout = path;
      } finally { db.close(); }
      const after = await lstat(indexPath);
      if (after.ino !== index.st.ino || after.dev !== index.st.dev || after.size !== index.st.size || after.mtimeMs !== index.st.mtimeMs || after.ctimeMs !== index.st.ctimeMs) fail('Native state index changed during guard');
    } finally { await index.handle.close(); }
    const file = await regular(rollout!);
    try {
      // Read through the verified descriptor. Bound actual bytes even if an
      // unexpected writer grows the file after the initial size check.
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of file.handle.createReadStream({ autoClose: false })) {
        bytes += chunk.length;
        if (bytes > maxFileBytes) fail('Native rollout exceeds budget');
        chunks.push(chunk);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      if (!text.endsWith('\n')) fail('Truncated native rollout');
      const lines = text.trimEnd().split('\n');
      if (!lines.length) fail('Empty native rollout');
      const first = parseJson(lines[0]) as any;
      if (first.type !== 'session_meta' || first.payload?.id !== id || first.payload?.cli_version !== '0.112.0' || first.payload?.source !== 'exec') fail('Native rollout identity or format mismatch');
      let conversation = false;
      for (const line of lines.slice(1)) {
        const event = parseJson(line) as any;
        if (!['response_item', 'compacted', 'turn_context', 'event_msg'].includes(event.type) || !event.payload || typeof event.payload !== 'object') fail('Unsupported native rollout entry');
        if (event.type === 'response_item') {
          const item = event.payload;
          if (typeof item.type !== 'string') fail('Invalid native response item');
          if (item.type === 'message') {
            if (!['system', 'developer', 'user', 'assistant'].includes(item.role) || !Array.isArray(item.content) || item.content.some((b: any) => !b || !['input_text', 'output_text'].includes(b.type) || typeof b.text !== 'string')) fail('Invalid native text message');
            if (item.role === 'user' && item.content.length > 0) conversation = true;
          }
        }
        if (event.type === 'compacted') {
          if (typeof event.payload.message !== 'string' || !event.payload.message) fail('Invalid native compaction');
          conversation = true;
        }
      }
      if (!conversation) fail('Native rollout contains no resumable conversation');
      const after = await file.handle.stat();
      const named = await lstat(rollout!);
      if (after.size !== bytes || after.mtimeMs !== file.st.mtimeMs || after.ctimeMs !== file.st.ctimeMs || named.ino !== file.st.ino || named.dev !== file.st.dev) fail('Native rollout changed during guard');
      return { nativeId: id, rollout: rollout!, entries: lines.length, bytes };
    } finally { await file.handle.close(); }
  } catch (error) {
    if (error instanceof ResumeValidationError) throw error;
    throw new ResumeValidationError(`Native resume validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
