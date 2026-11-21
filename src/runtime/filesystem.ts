import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { close, fstat, fsync, read, ftruncate, writeFile, createReadStream } from 'node:fs';
import type { Stats } from 'node:fs';
import { promisify } from 'node:util';
import { SessionError, fail } from '../core/errors.ts';

interface NativeFilesystem { openAt(parent: number, component: string, flags: number, mode: number): number; openDirectory(parent: number): unknown; nextDirectory(cursor: unknown): string | null; closeDirectory(cursor: unknown): void }
let loaded: NativeFilesystem | undefined;
function native(): NativeFilesystem {
  if (loaded) return loaded;
  if (!['linux', 'darwin'].includes(process.platform)) fail('UNSUPPORTED', 'Descriptor-relative filesystem access requires Linux or macOS');
  const source = import.meta.url.endsWith('.ts');
  try { return loaded = createRequire(import.meta.url)(fileURLToPath(new URL(source ? '../../artifacts/native/filesystem.node' : '../native/filesystem.node', import.meta.url))); }
  catch (cause) { throw new SessionError('DEPENDENCY', 'The installed descriptor-relative filesystem helper is unavailable; no build or installation attempted', { cause }); }
}
export interface AnchoredHandle {
  readonly fd: number;
  stat(): Promise<Stats>;
  close(): Promise<void>;
  sync(): Promise<void>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
}
export class DescriptorHandle implements AnchoredHandle {
  private closed = false;
  private readonly descriptor: number;
  constructor(fd: number) { this.descriptor = fd; }
  get fd() { this.check(); return this.descriptor; }
  private check() { if (this.closed) fail('STOPPED', 'Descriptor is closed'); }
  async stat() { this.check(); return promisify(fstat)(this.fd); }
  async close() { if (!this.closed) { this.closed = true; await promisify(close)(this.descriptor); } }
  async sync() { this.check(); await promisify(fsync)(this.fd); }
  async read(buffer: Buffer, offset: number, length: number, position: number) { this.check(); return promisify(read)(this.fd, buffer, offset, length, position); }
  async truncate(length: number) { this.check(); await promisify(ftruncate)(this.fd, length); }
  async writeFile(content: string) { this.check(); await promisify(writeFile)(this.fd, content); }
  createReadStream(_options?: { autoClose?: boolean }) { this.check(); return createReadStream('', { fd: this.fd, autoClose: false }); }
}
export function openRelative(parent: AnchoredHandle, component: string, flags: number, mode = 0o600): DescriptorHandle {
  return new DescriptorHandle(native().openAt(parent.fd, component, flags, mode));
}
export function* directoryNames(parent: AnchoredHandle): Generator<string> {
  const helper = native(), cursor = helper.openDirectory(parent.fd);
  try { for (;;) { const name = helper.nextDirectory(cursor); if (name === null) break; yield name; } }
  finally { helper.closeDirectory(cursor); }
}
