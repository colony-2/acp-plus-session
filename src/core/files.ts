import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { open, mkdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fail, cancelled } from './errors.ts';
import { finiteLimit } from './json.ts';
import { openRelative, directoryNames } from '../runtime/filesystem.ts';
import type { AnchoredHandle } from '../runtime/filesystem.ts';

export interface Limits { manifestBytes: number; depth: number; entries: number; fileBytes: number; totalBytes: number; hookJsonBytes: number }
export const defaultLimits: Readonly<Limits> = Object.freeze({ manifestBytes: 1024 * 1024, depth: 64, entries: 50000, fileBytes: 256 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024, hookJsonBytes: 1024 * 1024 });
export function limitsWith(overrides: Partial<Limits> = {}): Limits {
  const limits = { ...defaultLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) finiteLimit(value, name);
  return limits;
}
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface Entry { path: string; kind: 'directory' | 'file'; mode: number; size?: number; sha256?: string }

export function safePath(path: string) {
  if (!path || path.length > 4096 || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || path.includes(':') || path.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' '))) fail('INVALID_BUNDLE', 'Unsafe inventory path');
  // Reject invalid Unicode as well as aliases on common case-insensitive and
  // Unicode-normalizing filesystems, even when running on a sensitive one.
  if (path !== path.toWellFormed()) fail('INVALID_BUNDLE', 'Invalid Unicode path');
  return path;
}
export const collisionKey = (path: string) => path.normalize('NFD').toLowerCase();
function privateMode(mode: number, directory: boolean) {
  const m = mode & 0o7777;
  if (directory ? m !== 0o700 : m !== 0o600 && m !== 0o700) fail('INVALID_BUNDLE', 'State entry has unsafe mode');
}
function same(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.nlink === b.nlink;
}

// Anchor every traversal component to an open directory. A renamed ancestor or
// a symlink substitution cannot redirect later reads. openat/fdopendir retain
// the anchor on Linux and macOS without requiring procfs or path reconstruction.
export class PrivateTree {
  private readonly root: FileHandle;
  private constructor(root: FileHandle) { this.root = root; }
  static async open(path: string) {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await PrivateTree.checkDirectory(handle); return new PrivateTree(handle); }
    catch (error) { await handle.close(); throw error; }
  }
  static async checkDirectory(handle: AnchoredHandle) {
    const st = await handle.stat();
    if (!st.isDirectory() || (process.getuid && st.uid !== process.getuid())) fail('INVALID_BUNDLE', 'State directory is not owned by the current user');
    privateMode(st.mode, true);
  }
  async close() { await this.root.close(); }
  async withEntry<T>(path: string, directory: boolean, fn: (handle: AnchoredHandle) => Promise<T>): Promise<T> {
    safePath(path);
    const parts = path.split('/'); let parent: AnchoredHandle = this.root;
    const handles: AnchoredHandle[] = [];
    try {
      for (let i = 0; i < parts.length; i++) {
        const isDir = i < parts.length - 1 || directory;
        const handle = openRelative(parent, parts[i], constants.O_RDONLY | (isDir ? constants.O_DIRECTORY : 0));
        handles.push(handle);
        if (isDir) await PrivateTree.checkDirectory(handle);
        parent = handle;
      }
      return await fn(parent);
    } finally { for (const handle of handles.reverse()) await handle.close(); }
  }
  async read(path: string, limit: number, signal?: AbortSignal) {
    return this.withEntry(path, false, async handle => {
      const chunks: Buffer[] = []; let bytes = 0;
      await this.consume(handle, limit, async chunk => { chunks.push(Buffer.from(chunk)); bytes += chunk.length; }, signal);
      return Buffer.concat(chunks, bytes);
    });
  }
  async copy(path: string, destination: string, limit: number, expected: Entry, signal?: AbortSignal) {
    await this.withEntry(path, false, async handle => {
      const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, expected.mode);
      try {
        const result = await this.consume(handle, limit, async chunk => {
          // FileHandle.write can be short; do not assume a full write.
          let offset = 0;
          while (offset < chunk.length) offset += (await output.write(chunk, offset, chunk.length - offset)).bytesWritten;
        }, signal);
        if (result.size !== expected.size || result.sha256 !== expected.sha256) fail('INTEGRITY', 'Payload integrity mismatch');
        await output.chmod(expected.mode); await output.sync();
      } finally { await output.close(); }
    });
  }
  async consume(handle: AnchoredHandle, limit: number, sink: (chunk: Buffer) => Promise<void>, signal?: AbortSignal) {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (process.getuid && before.uid !== process.getuid())) fail('INVALID_BUNDLE', 'State file is not a private, singly linked regular file');
    privateMode(before.mode, false);
    if (before.size > limit) fail('LIMIT', 'File byte limit exceeded');
    const hash = createHash('sha256'); let size = 0;
    const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1));
    for (;;) {
      cancelled(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) fail('LIMIT', 'File byte limit exceeded during read');
      const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await sink(chunk);
    }
    const after = await handle.stat();
    if (before.size !== size || !same(before, after)) fail('INTEGRITY', 'State file changed while reading');
    return { size, sha256: hash.digest('hex'), mode: before.mode & 0o777 };
  }
  async sync(entries: Entry[]) {
    for (const entry of [...entries].sort((a, b) => b.path.split('/').length - a.path.split('/').length)) {
      await this.withEntry(entry.path, entry.kind === 'directory', handle => handle.sync());
    }
    await this.root.sync();
  }
  async inventory(limits: Limits, signal?: AbortSignal, envelopeBytes?: number): Promise<Entry[]> {
    const result: Entry[] = []; const collisions = new Set<string>(); let total = 0;
    const visit = async (directory: AnchoredHandle, prefix: string) => {
      const before = await directory.stat();
      const names = directoryNames(directory);
      for (const name of names) {
        cancelled(signal);
        const path = prefix + name; safePath(path);
        if (path.split('/').length > limits.depth) fail('LIMIT', 'Inventory nesting limit exceeded');
        const key = collisionKey(path);
        if (collisions.has(key)) fail('INVALID_BUNDLE', 'Case or Unicode namespace collision');
        collisions.add(key);
        if (result.length >= limits.entries + (envelopeBytes === undefined ? 0 : 1)) fail('LIMIT', 'Inventory entry limit exceeded');
        const child = openRelative(directory, name, constants.O_RDONLY);
        try {
          const st = await child.stat();
          privateMode(st.mode, st.isDirectory());
          if (st.isDirectory()) {
            await PrivateTree.checkDirectory(child);
            result.push({ path, kind: 'directory', mode: 0o700 }); await visit(child, path + '/');
          } else if (st.isFile()) {
            const envelope = path === 'manifest.json' && envelopeBytes !== undefined;
            const digest = await this.consume(child, envelope ? envelopeBytes : Math.min(limits.fileBytes, limits.totalBytes - total), async () => {}, signal);
            if (!envelope) total += digest.size;
            result.push({ path, kind: 'file', ...digest });
          } else fail('INVALID_BUNDLE', 'Links and special files are prohibited');
        } finally { await child.close(); }
      }
      if (!same(before, await directory.stat())) fail('INTEGRITY', 'Directory changed during traversal');
    };
    await visit(this.root, '');
    return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
}
export async function privateDirectory(path: string) { await mkdir(path, { mode: 0o700 }); }
