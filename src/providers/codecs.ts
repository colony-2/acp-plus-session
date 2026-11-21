import { mkdir, open, chmod, readdir, lstat } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { PrivateTree, limitsWith, sha256, safePath } from '../core/files.ts';
import type { Limits, Entry } from '../core/files.ts';
import { fail, cancelled } from '../core/errors.ts';
import { parseJson } from '../core/json.ts';
import { inspectCodexResume } from './codex-guard.ts';
import { claudeProjectKey } from './claude-layout.ts';
import { inspectClaudeRelated } from './claude-related.ts';
import { relocateClaudeToolResults, portableClaudeToolRoot } from './claude-tool-results.ts';

export const providerFormats = { codex: ['codex-0.112.0-state5-v1'], claude: ['claude-2.1.328-jsonl-v1'] } as const;
export interface Codec {
  readonly provider: 'codex' | 'claude';
  readonly format: string;
  capture(home: string, workspace: string, id: string, destination: string, signal?: AbortSignal): Promise<void>;
  restore(source: string, home: string, workspace: string, id: string, signal?: AbortSignal): Promise<void>;
  guard(home: string, workspace: string, id: string): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function privateWrite(path: string, bytes: string | Buffer) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function parents(root: string, path: string) {
  const parts = path.split('/').slice(0, -1); let current = root;
  for (const part of parts) {
    current = join(current, part);
    await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const st = await lstat(current);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o700) fail('RESTORE_FAILED', 'Unsafe private codec destination');
  }
}
async function copySelected(tree: PrivateTree, entries: Entry[], destination: string, limits: Limits, signal?: AbortSignal, consume?: (bytes: number) => void) {
  for (const entry of entries) {
    cancelled(signal); await parents(destination, entry.path);
    if (entry.kind === 'directory') await mkdir(join(destination, entry.path), { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    else { consume?.(entry.size!); if (entry.mode !== 0o600) fail('INCOMPATIBLE', 'Unsupported executable native state'); await tree.copy(entry.path, join(destination, entry.path), limits.fileBytes, entry, signal); }
  }
}
function byteBudget(limits: Limits) {
  let remaining = limits.totalBytes;
  return { get remaining() { return remaining; }, consume(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limits.fileBytes || bytes > remaining) fail('LIMIT', 'Native state exceeds byte limits');
    remaining -= bytes;
  } };
}
function codexDatabaseBytes(db: DatabaseSync, limits: Limits) {
  const bytes = Number(db.prepare('PRAGMA page_count').get()?.page_count) * Number(db.prepare('PRAGMA page_size').get()?.page_size);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > Math.min(limits.fileBytes, limits.totalBytes)) fail('LIMIT', 'Codex database exceeds byte limits');
  return bytes;
}
async function codexDatabases(home: string) {
  for (const name of await readdir(home)) {
    if (/\.(?:sqlite|db)(?:-wal|-shm)?$/.test(name) && !['state_5.sqlite', 'state_5.sqlite-wal', 'state_5.sqlite-shm', 'logs_1.sqlite', 'logs_1.sqlite-wal', 'logs_1.sqlite-shm'].includes(name)) fail('INCOMPATIBLE', 'Unrecognized native database');
  }
}
function codexSchema(db: DatabaseSync) {
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  const schema = JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all());
  // Derived from the installed pinned native runtime in the focused probes.
  if (sha256(schema) !== '17e590d728078d445468799182ceb3dfae75cb437eaa99ee64d96bef0c90decd') fail('INCOMPATIBLE', 'Unsupported Codex state database schema');
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') fail('RESTORE_FAILED', 'Corrupt Codex database');
  for (const table of ['jobs', 'agent_jobs', 'agent_job_items', 'thread_dynamic_tools']) {
    if ((db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n as number) !== 0) fail('INCOMPATIBLE', 'Unsupported live Codex job or dynamic tool state');
  }
}
export class CodexCodec implements Codec {
  readonly provider = 'codex'; readonly format = providerFormats.codex[0];
  readonly limits: Limits;
  constructor(limits: Partial<Limits> = {}) { this.limits = limitsWith(limits); }
  async guard(home: string, _workspace: string, id: string) {
    await inspectCodexResume(home, id, this.limits.fileBytes); await codexDatabases(home);
    const db = new DatabaseSync(join(home, 'state_5.sqlite'), { readOnly: true, timeout: 1000 });
    try { codexDatabaseBytes(db, this.limits); codexSchema(db); } finally { db.close(); }
  }
  async capture(home: string, workspace: string, id: string, destination: string, signal?: AbortSignal) {
    await this.guard(home, workspace, id); cancelled(signal);
    const budget = byteBudget(this.limits);
    const source = new DatabaseSync(join(home, 'state_5.sqlite'), { readOnly: true, timeout: 1000 });
    let rollout: string;
    try {
      codexSchema(source);
      rollout = (source.prepare('SELECT rollout_path FROM threads WHERE id=?').get(id) as any).rollout_path;
      budget.consume(codexDatabaseBytes(source, this.limits));
      await backup(source, join(destination, 'state_5.sqlite'), { rate: 64, progress: () => { cancelled(signal); } });
    } finally { source.close(); }
    await chmod(join(destination, 'state_5.sqlite'), 0o600);
    const sealed = new DatabaseSync(join(destination, 'state_5.sqlite'));
    try {
      const rel = relative(home, rollout!); safePath(rel);
      if (isAbsolute(rel) || !rel.startsWith('sessions/')) fail('RESTORE_FAILED', 'Codex rollout escapes its home');
      // Logs share this DB. Scrub them and reclaim freed pages so secrets in
      // diagnostic rows cannot remain in the published SQLite byte stream.
      sealed.exec('PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; DELETE FROM logs; DELETE FROM sqlite_sequence WHERE name=\'logs\'');
      sealed.prepare('UPDATE threads SET rollout_path=?,cwd=? WHERE id=?').run(rel, '', id);
      sealed.exec('VACUUM');
      codexSchema(sealed);
      const tree = await PrivateTree.open(home);
      try {
        const bytes = await tree.read(rel, Math.min(this.limits.fileBytes, budget.remaining), signal); budget.consume(bytes.length);
        await parents(destination, rel); await privateWrite(join(destination, rel), bytes);
      } finally { await tree.close(); }
      // Memories are part of the one-session private home, never the ambient
      // user home. Preserve them, while unrelated sessions/config stay out.
      const memories = join(home, 'memories');
      const st = await lstat(memories).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
      if (st) {
        const tree = await PrivateTree.open(memories);
        try { await mkdir(join(destination, 'memories'), { mode: 0o700 }); await copySelected(tree, await tree.inventory(this.limits, signal), join(destination, 'memories'), this.limits, signal, budget.consume); }
        finally { await tree.close(); }
      }
    } finally { sealed.close(); }
  }
  async restore(source: string, home: string, workspace: string, id: string, signal?: AbortSignal) {
    if (!uuid.test(id)) fail('RESTORE_FAILED', 'Invalid Codex identity');
    const tree = await PrivateTree.open(source);
    try {
      const inventory = await tree.inventory(this.limits, signal);
      if (inventory.some(e => e.path !== 'state_5.sqlite' && e.path !== 'memories' && !e.path.startsWith('memories/') && e.path !== 'sessions' && !e.path.startsWith('sessions/'))) fail('INCOMPATIBLE', 'Unexpected Codex payload');
      await copySelected(tree, inventory, home, this.limits, signal);
    } finally { await tree.close(); }
    const db = new DatabaseSync(join(home, 'state_5.sqlite'), { timeout: 1000 });
    try {
      codexSchema(db);
      const rows = db.prepare('SELECT id,rollout_path,cli_version,archived FROM threads').all() as any[];
      if (rows.length !== 1 || rows[0].id !== id || rows[0].cli_version !== '0.112.0' || rows[0].archived !== 0) fail('RESTORE_FAILED', 'Intended Codex thread is absent');
      const path = rows[0].rollout_path;
      if (typeof path !== 'string' || isAbsolute(path)) fail('RESTORE_FAILED', 'Unsealed Codex lookup');
      safePath(path);
      if (!path.startsWith('sessions/') || !path.endsWith(`-${id}.jsonl`)) fail('RESTORE_FAILED', 'Invalid Codex lookup');
      const inventoryTree = await PrivateTree.open(home);
      try {
        const entries = await inventoryTree.inventory(this.limits, signal);
        if (entries.some(e => e.path.startsWith('sessions/') && (e.kind === 'file' ? e.path !== path : !path.startsWith(e.path + '/')))) fail('RESTORE_FAILED', 'Unrelated Codex rollout in checkpoint');
      } finally { await inventoryTree.close(); }
      if (db.prepare('SELECT count(*) n FROM logs').get()?.n !== 0) fail('RESTORE_FAILED', 'Checkpoint contains excluded diagnostic state');
      db.exec('PRAGMA query_only=OFF; PRAGMA journal_mode=DELETE');
      db.prepare('UPDATE threads SET rollout_path=?,cwd=? WHERE id=?').run(join(home, path), workspace, id);
    } finally { db.close(); }
    await this.guard(home, workspace, id);
  }
}

export class ClaudeCodec implements Codec {
  readonly provider = 'claude'; readonly format = providerFormats.claude[0];
  readonly limits: Limits;
  constructor(limits: Partial<Limits> = {}) { this.limits = limitsWith(limits); }
  private checkTranscript(text: string, id: string) {
    if (!text.endsWith('\n') || !text.trim()) fail('RESTORE_FAILED', 'Missing or truncated Claude transcript');
    let found = false;
    for (const line of text.trimEnd().split('\n')) {
      const record = parseJson(line, this.limits.depth) as any;
      if (!record || typeof record !== 'object' || Array.isArray(record)) fail('RESTORE_FAILED', 'Invalid Claude record');
      if (record.sessionId !== undefined && record.sessionId !== id) fail('RESTORE_FAILED', 'Foreign Claude session');
      if (record.version !== undefined && record.version !== '2.1.328') fail('INCOMPATIBLE', 'Unsupported Claude state version');
      if (['user', 'assistant'].includes(record.type)) {
        if (record.sessionId !== id || record.version !== '2.1.328' || !uuid.test(record.uuid) || (record.parentUuid !== null && !uuid.test(record.parentUuid)) || !record.message || record.message.role !== record.type || !(typeof record.message.content === 'string' || Array.isArray(record.message.content))) fail('RESTORE_FAILED', 'Incomplete native Claude conversation record');
        found = true;
      }
    }
    if (!found) fail('RESTORE_FAILED', 'Claude transcript does not identify the intended conversation');
  }
  private async transform(source: string, destination: string | undefined, id: string, fromArtifacts: string, toArtifacts: string, signal?: AbortSignal) {
    if (!uuid.test(id)) fail('RESTORE_FAILED', 'Invalid Claude identity');
    const tree = await PrivateTree.open(source);
    try {
      const inventory = await tree.inventory(this.limits, signal);
      const memories = inventory.filter(e => e.path === 'memory' || e.path.startsWith('memory/'));
      if (inventory.some(e => !['memory', `${id}.jsonl`, id].includes(e.path) && !e.path.startsWith('memory/') && !e.path.startsWith(id + '/') && !/^[0-9a-f-]{36}(?:\.jsonl|\/|$)/.test(e.path))) fail('INCOMPATIBLE', 'Unrecognized Claude project state');
      const mainPath = `${id}.jsonl`, relatedPrefix = `${id}/subagents/`, toolPrefix = `${id}/tool-results/`;
      const selected = inventory.filter(e => e.path === mainPath || e.path === id || e.path.startsWith(id + '/'));
      if (selected.some(e => ![mainPath, id, `${id}/subagents`, `${id}/tool-results`].includes(e.path) && !(e.kind === 'file' && (e.path.startsWith(relatedPrefix) || e.path.startsWith(toolPrefix)) && e.path.split('/').length === 3))) fail('INCOMPATIBLE', 'Unknown required Claude sidecar layout');
      const names = new Set(selected.filter(e => e.kind === 'file' && e.path.startsWith(toolPrefix)).map(e => e.path.slice(toolPrefix.length)));
      const main = new TextDecoder('utf-8', { fatal: true }).decode(await tree.read(mainPath, this.limits.fileBytes, signal));
      this.checkTranscript(main, id);
      const related = new Map<string, string>();
      for (const e of selected.filter(e => e.kind === 'file' && e.path.startsWith(relatedPrefix))) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await tree.read(e.path, this.limits.fileBytes, signal));
        // Check duplicate keys before the layout helper interprets records.
        if (e.path.endsWith('.jsonl')) this.checkTranscript(text, id);
        else parseJson(text, this.limits.depth);
        related.set(e.path.slice(relatedPrefix.length), text);
      }
      inspectClaudeRelated(main, id, related);
      const budget = byteBudget(this.limits);
      const rewritten = relocateClaudeToolResults(main, fromArtifacts, toArtifacts, names, Math.min(this.limits.fileBytes, budget.remaining));
      budget.consume(Buffer.byteLength(rewritten.text));
      const refs = new Set(rewritten.referenced);
      if (destination) await privateWrite(join(destination, mainPath), rewritten.text);
      for (const [name, text] of related) {
        const result = name.endsWith('.jsonl') ? relocateClaudeToolResults(text, fromArtifacts, toArtifacts, names, Math.min(this.limits.fileBytes, budget.remaining)) : { text, referenced: [] };
        budget.consume(Buffer.byteLength(result.text));
        for (const ref of result.referenced) refs.add(ref);
        const path = relatedPrefix + name; if (destination) { await parents(destination, path); await privateWrite(join(destination, path), result.text); }
      }
      if (destination) await copySelected(tree, memories, destination, this.limits, signal, budget.consume);
      else for (const entry of memories) if (entry.kind === 'file') budget.consume(entry.size!);
      for (const name of refs) {
        const path = toolPrefix + name; const entry = selected.find(e => e.path === path)!; budget.consume(entry.size!);
        if (!destination) continue; await parents(destination, path);
        await tree.copy(path, join(destination, path), this.limits.fileBytes, entry, signal);
      }
    } finally { await tree.close(); }
  }
  async guard(home: string, workspace: string, id: string) {
    if (!uuid.test(id)) fail('RESTORE_FAILED', 'Invalid Claude native identity');
    const root = join(home, 'projects', claudeProjectKey(workspace));
    await this.transform(root, undefined, id, join(root, id, 'tool-results'), join(root, id, 'tool-results'));
  }
  async capture(home: string, workspace: string, id: string, destination: string, signal?: AbortSignal) {
    const root = join(home, 'projects', claudeProjectKey(workspace));
    await this.transform(root, destination, id, join(root, id, 'tool-results'), portableClaudeToolRoot, signal);
  }
  async restore(source: string, home: string, workspace: string, id: string, signal?: AbortSignal) {
    const root = join(home, 'projects', claudeProjectKey(workspace));
    const tree = await PrivateTree.open(source);
    try {
      const entries = await tree.inventory(this.limits, signal);
      if (entries.some(e => e.path !== `${id}.jsonl` && e.path !== id && !e.path.startsWith(id + '/') && e.path !== 'memory' && !e.path.startsWith('memory/'))) fail('INCOMPATIBLE', 'Unexpected Claude payload');
    } finally { await tree.close(); }
    await parents(home, `projects/${claudeProjectKey(workspace)}/placeholder`);
    await this.transform(source, root, id, portableClaudeToolRoot, join(root, id, 'tool-results'), signal);
    await this.guard(home, workspace, id);
  }
}
