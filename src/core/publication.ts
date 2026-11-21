import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cancelled, SessionError } from './errors.ts';

export interface CheckpointReference { path: string; manifestSha256: string; checkpointId: string }
export type Publisher = (staging: string, target: string, reference: CheckpointReference, signal?: AbortSignal) => Promise<CheckpointReference>;

// The helper's exit is the commit point. Do not abort/kill it on cancellation:
// an ambiguous rename result must not be falsely reported as rolled back.
export function atomicPublisher(installedHelper: string): Publisher {
  const helper = resolve(installedHelper);
  return async (staging, target, reference, signal) => {
    cancelled(signal);
    const directory = await open(staging, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    cancelled(signal);
    await new Promise<void>((resolve, reject) => {
      execFile(helper, [staging, target], { timeout: 10000, maxBuffer: 65536 }, error => {
        if (!error) resolve();
        else reject(new SessionError((error as any).code === 10 ? 'CONFLICT' : 'UNSUPPORTED', 'Atomic checkpoint publication failed', { cause: error }));
      });
    });
    // Commit succeeded. Metadata flush failure cannot turn it into rollback.
    // Report a committed result; crash durability is outside the guarantee.
    try { const parent = await open(dirname(target), 'r'); try { await parent.sync(); } finally { await parent.close(); } } catch { /* committed */ }
    return reference;
  };
}
