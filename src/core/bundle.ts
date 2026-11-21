import { mkdtemp, mkdir, rm, open, chmod } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrivateTree, collisionKey, safePath, limitsWith, sha256 } from './files.ts';
import type { Entry, Limits } from './files.ts';
import { parseJson } from './json.ts';
import type { Json } from './json.ts';
import { cancelled, fail } from './errors.ts';

export interface Extension { id: string; version: string; required: boolean; data: Json }
export interface Manifest {
  schema: 'acp-plus-session/checkpoint/v1';
  checkpointId: string;
  parentId?: string;
  provider: 'codex' | 'claude';
  nativeId: string;
  stateFormat: string;
  producer: Record<string, string>;
  requiredFeatures: string[];
  application: Json;
  extensions: Extension[];
  inventory: Entry[];
}
export interface Compatibility {
  providers: Readonly<Record<string, readonly string[]>>;
  features: readonly string[];
}
export const extensionId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const hash = /^[a-f0-9]{64}$/;
const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: any) => typeof v === 'string' && v.length > 0 && v.length <= 1024 && v === v.toWellFormed() && !/[\x00-\x1f\x7f]/.test(v);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateManifest(value: Json, compatibility: Compatibility, limits: Limits): Manifest {
  const m = value as unknown as Manifest;
  if (!object(m) || m.schema !== 'acp-plus-session/checkpoint/v1') fail('INCOMPATIBLE', 'Unsupported checkpoint schema');
  if (!uuid.test(m.checkpointId) || (m.parentId !== undefined && !uuid.test(m.parentId)) || !text(m.nativeId)) fail('INVALID_BUNDLE', 'Invalid checkpoint identity');
  if (!Object.hasOwn(compatibility.providers, m.provider) || !compatibility.providers[m.provider].includes(m.stateFormat)) fail('INCOMPATIBLE', 'Unsupported provider state format');
  if (!Array.isArray(m.requiredFeatures) || new Set(m.requiredFeatures).size !== m.requiredFeatures.length || m.requiredFeatures.some(f => !compatibility.features.includes(f))) fail('INCOMPATIBLE', 'Unsupported required feature');
  if (!object(m.producer) || !Object.keys(m.producer).length || Object.entries(m.producer).some(([k, v]) => !text(k) || !text(v))) fail('INVALID_BUNDLE', 'Missing producer versions');
  if (!Object.hasOwn(m, 'application') || !Array.isArray(m.extensions) || m.extensions.length > limits.entries) fail('INVALID_BUNDLE', 'Invalid application or extensions');
  const ids = new Set<string>();
  for (const ext of m.extensions) {
    if (!object(ext) || !extensionId.test(ext.id) || ext.id.length > 120 || !text(ext.version) || typeof ext.required !== 'boolean' || !Object.hasOwn(ext, 'data') || ids.has(ext.id)) fail('INVALID_BUNDLE', 'Invalid or duplicate extension');
    // Commands, if present as opaque extension data, have no execution meaning.
    ids.add(ext.id);
  }
  if (!Array.isArray(m.inventory)) fail('INVALID_BUNDLE', 'Missing inventory');
  if (m.inventory.length > limits.entries) fail('LIMIT', 'Inventory entry limit exceeded');
  const paths = new Map<string, Entry>(); const aliases = new Set<string>(); let total = 0;
  for (const entry of m.inventory) {
    if (!object(entry) || typeof entry.path !== 'string') fail('INVALID_BUNDLE', 'Invalid inventory entry');
    safePath(entry.path);
    const alias = collisionKey(entry.path);
    if (aliases.has(alias)) fail('INVALID_BUNDLE', 'Duplicate or colliding inventory path');
    aliases.add(alias); paths.set(entry.path, entry);
    const parts = entry.path.split('/');
    if (parts.length > limits.depth) fail('LIMIT', 'Inventory nesting limit exceeded');
    if ((parts.length === 1 || (parts[0] === 'extensions' && parts.length === 2)) && entry.kind !== 'directory') fail('INVALID_BUNDLE', 'Namespace roots must be directories');
    if (!['provider', 'application', 'extensions'].includes(parts[0]) || (parts[0] === 'extensions' && parts.length > 1 && !ids.has(parts[1]))) fail('INVALID_BUNDLE', 'Unknown payload namespace');
    if (entry.kind === 'directory') {
      if (entry.mode !== 0o700 || entry.size !== undefined || entry.sha256 !== undefined) fail('INVALID_BUNDLE', 'Invalid directory metadata');
    } else if (entry.kind === 'file') {
      if ((entry.mode !== 0o600 && entry.mode !== 0o700) || (parts[0] === 'provider' && entry.mode !== 0o600) || !Number.isSafeInteger(entry.size) || entry.size! < 0 || !hash.test(entry.sha256!)) fail('INVALID_BUNDLE', 'Invalid file metadata');
      total += entry.size!;
      if (entry.size! > limits.fileBytes || total > limits.totalBytes) fail('LIMIT', 'Payload byte limit exceeded');
    } else fail('INVALID_BUNDLE', 'Unsupported payload kind');
  }
  for (const entry of m.inventory) {
    if (entry.path.includes('/') && paths.get(dirname(entry.path))?.kind !== 'directory') fail('INVALID_BUNDLE', 'Missing parent directory');
  }
  if (paths.get('provider')?.kind !== 'directory') fail('INVALID_BUNDLE', 'Missing provider namespace');
  return m;
}
function normalized(entries: Entry[]) { return JSON.stringify(entries.map(e => ({ path: e.path, kind: e.kind, mode: e.mode, ...(e.kind === 'file' ? { size: e.size, sha256: e.sha256 } : {}) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)); }

// All bytes are checked through anchored descriptors; only private staging is
// written. A failed import never returns a materialized instance.
export async function stageBundle(source: string, stagingParent: string, compatibility: Compatibility, overrides: Partial<Limits> = {}, signal?: AbortSignal) {
  const limits = limitsWith(overrides);
  const tree = await PrivateTree.open(source);
  let staging: string | undefined;
  try {
    const bytes = await tree.read('manifest.json', limits.manifestBytes, signal);
    const manifest = validateManifest(parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), limits.depth), compatibility, limits);
    // Inventory includes the envelope; its budget is accounted separately.
    const before = await tree.inventory(limits, signal, limits.manifestBytes);
    const payload = before.filter(e => e.path !== 'manifest.json');
    const envelope = before.find(e => e.path === 'manifest.json');
    if (envelope?.sha256 !== sha256(bytes) || normalized(payload) !== normalized(manifest.inventory)) fail('INTEGRITY', 'Bundle inventory mismatch');
    cancelled(signal);
    staging = await mkdtemp(join(stagingParent, '.portable-import-')); await chmod(staging, 0o700);
    for (const entry of [...manifest.inventory].sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
      cancelled(signal);
      if (entry.kind === 'directory') await mkdir(join(staging, entry.path), { mode: 0o700 });
      else await tree.copy(entry.path, join(staging, entry.path), limits.fileBytes, entry, signal);
    }
    if (normalized(await tree.inventory(limits, signal, limits.manifestBytes)) !== normalized(before)) fail('INTEGRITY', 'Bundle changed during import');
    const staged = await PrivateTree.open(staging);
    try { if (normalized(await staged.inventory(limits, signal)) !== normalized(manifest.inventory)) fail('INTEGRITY', 'Staged bundle mismatch'); }
    finally { await staged.close(); }
    return { staging, manifest, manifestSha256: sha256(bytes) };
  } catch (error) { if (staging) await rm(staging, { recursive: true, force: true }); throw error; }
  finally { await tree.close(); }
}

export type ManifestMetadata = Omit<Manifest, 'schema' | 'checkpointId' | 'inventory'>;
export async function sealBundle(staging: string, metadata: ManifestMetadata, compatibility: Compatibility, overrides: Partial<Limits> = {}, signal?: AbortSignal) {
  const limits = limitsWith(overrides);
  const tree = await PrivateTree.open(staging);
  let inventory: Entry[];
  try { inventory = await tree.inventory(limits, signal); await tree.sync(inventory); } finally { await tree.close(); }
  const manifest = { ...metadata, schema: 'acp-plus-session/checkpoint/v1' as const, checkpointId: randomUUID(), inventory };
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n');
  if (bytes.length > limits.manifestBytes) fail('LIMIT', 'Manifest byte limit exceeded');
  validateManifest(parseJson(bytes.toString('utf8'), limits.depth), compatibility, limits);
  const file = await open(join(staging, 'manifest.json'), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  return { manifest, manifestSha256: sha256(bytes) };
}

export async function exportStaging(destination: string) {
  const target = resolve(destination);
  if (basename(target).startsWith('.portable-')) fail('INVALID_BUNDLE', 'Reserved checkpoint name');
  const staging = await mkdtemp(join(dirname(target), '.portable-export-'));
  await chmod(staging, 0o700);
  return { staging, target };
}
