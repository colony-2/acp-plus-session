// Internal fixture support. Never imported by the product or exported in its API.
import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function validatePid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error(`Invalid fixture PID: ${String(pid)}`);
  return pid;
}

export function parsePidRecord(record) {
  const malformed = () => { throw new Error(`Malformed fixture PID record: ${JSON.stringify(record.slice(0, 18))}`); };
  if (record.length > 17) return malformed();
  if (record === '') return null;
  if (/^[1-9][0-9]*$/.test(record) && Number.isSafeInteger(Number(record))) return null;
  if (!/^[1-9][0-9]*\n$/.test(record)) return malformed();
  const pid = Number(record.slice(0, -1));
  if (!Number.isSafeInteger(pid) || pid <= 1) return malformed();
  return pid;
}

export async function readPidRecord(path) {
  let file;
  try { file = await open(path, 'r'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  try {
    // One byte beyond the largest record detects oversized files without loading them.
    const buffer = Buffer.alloc(18);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return buffer.subarray(0, length).toString('utf8');
  } finally { await file.close(); }
}

export async function waitForPid(path, { timeoutMs = 2000, onObservation } = {}) {
  const deadline = performance.now() + timeoutMs;
  let record;
  do {
    record = await readPidRecord(path);
    const pid = record === undefined ? null : parsePidRecord(record);
    await onObservation?.(record, pid);
    if (pid !== null) return pid;
    if (performance.now() >= deadline) break;
    await delay(Math.min(10, Math.max(0, deadline - performance.now())));
  } while (true);
  throw new Error(`Timed out waiting for fixture PID at ${path}; last record: ${record === undefined ? 'missing' : JSON.stringify(record)}`);
}

export async function publishPid(path, pid = process.pid, { onStage } = {}) {
  const record = `${validatePid(pid)}\n`;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  let closed = false;
  try {
    await onStage?.('empty', temporary);
    const split = Math.max(1, Math.floor((record.length - 1) / 2));
    await file.writeFile(record.slice(0, split));
    await onStage?.('partial', temporary);
    await file.writeFile(record.slice(split));
    await file.close(); closed = true;
    await onStage?.('closed', temporary);
    await rename(temporary, path);
  } finally {
    try { if (!closed) await file.close(); }
    finally { await rm(temporary, { force: true }); }
  }
}

export function pidAbsent(pid) {
  validatePid(pid);
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
