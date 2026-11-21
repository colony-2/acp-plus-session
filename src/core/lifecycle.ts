import { rm } from 'node:fs/promises';
import { exportStaging, sealBundle } from './bundle.ts';
import type { ManifestMetadata, Compatibility } from './bundle.ts';
import type { Limits } from './files.ts';
import type { Publisher, CheckpointReference } from './publication.ts';
import { cancelled, fail, SessionError } from './errors.ts';

export type SessionState = 'idle' | 'exporting' | 'stopped' | 'resuming' | 'closing' | 'closed' | 'failed';
export type ActivityKind = 'turn' | 'permission' | 'tool' | 'writer';
export interface Driver {
  // Resolves only when all owned writers have stopped AND been reaped.
  stop(): Promise<void>;
  // Must guard the intended native identity on EVERY re-entry.
  resume(signal?: AbortSignal): Promise<void>;
  capture(staging: string, signal?: AbortSignal): Promise<ManifestMetadata>;
  isBusy?(): boolean;
}
export interface LifecycleOptions {
  compatibility: Compatibility;
  publish: Publisher;
  limits?: Partial<Limits>;
  afterCapture?: (staging: string, metadata: ManifestMetadata, signal?: AbortSignal) => Promise<ManifestMetadata>;
  onPublished?: (reference: CheckpointReference) => void;
}
interface Activity { kind: ActivityKind; controller: AbortController; finished: Promise<void>; finish: () => void }

export class SessionLifecycle {
  #state: SessionState = 'idle';
  #closing?: Promise<void>;
  #activities = new Set<Activity>();
  private readonly driver: Driver;
  private readonly options: LifecycleOptions;
  constructor(driver: Driver, options: LifecycleOptions) { this.driver = driver; this.options = options; }
  get state() { return this.#state; }
  get pendingActivities() { return [...this.#activities].map(a => a.kind); }

  // Admission happens synchronously before the first await. Callbacks and
  // exporters cannot both win the same idle observation.
  async run<T>(kind: ActivityKind, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#state !== 'idle') fail(this.#state === 'exporting' || this.#state === 'resuming' ? 'BUSY' : 'STOPPED', `Session is ${this.#state}`);
    if (kind === 'turn' && [...this.#activities].some(a => a.kind === 'turn')) fail('BUSY', 'A turn is already active');
    cancelled(signal);
    let finish!: () => void;
    const activity: Activity = { kind, controller: new AbortController(), finished: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish() };
    const abort = () => activity.controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    this.#activities.add(activity);
    try { return await operation(activity.controller.signal); }
    finally { signal?.removeEventListener('abort', abort); this.#activities.delete(activity); activity.finish(); }
  }

  async export(destination: string, signal?: AbortSignal): Promise<CheckpointReference> {
    if (this.#state !== 'idle' || this.#activities.size || this.driver.isBusy?.()) fail('BUSY', 'Session has outstanding work or is not idle');
    cancelled(signal);
    this.#state = 'exporting';
    let staging: string | undefined;
    try {
      // Cancellation never bypasses ownership cleanup once shutdown begins.
      try { await this.driver.stop(); }
      catch (cause) { this.#state = 'failed'; throw new SessionError('SHUTDOWN_FAILED', 'Writer shutdown was not confirmed; capture prohibited', { cause }); }
      cancelled(signal);
      const paths = await exportStaging(destination); staging = paths.staging;
      let metadata = await this.driver.capture(staging, signal);
      if (this.options.afterCapture) metadata = await this.options.afterCapture(staging, metadata, signal);
      cancelled(signal);
      const sealed = await sealBundle(staging, metadata, this.options.compatibility, this.options.limits, signal);
      cancelled(signal);
      const result = await this.options.publish(staging, paths.target, { path: paths.target, checkpointId: sealed.manifest.checkpointId, manifestSha256: sealed.manifestSha256 }, signal);
      // The publication result is authoritative even if cancellation arrived
      // during commit. Do not throw from a notification after committing.
      staging = undefined;
      try { this.options.onPublished?.(result); } catch { /* committed */ }
      return result;
    } finally {
      if (this.#state === 'exporting') this.#state = 'stopped';
      if (staging) await rm(staging, { recursive: true, force: true });
    }
  }
  async resume(signal?: AbortSignal) {
    if (this.#state !== 'stopped') fail(this.#state === 'idle' ? 'BUSY' : 'STOPPED', `Cannot resume a ${this.#state} session`);
    cancelled(signal); this.#state = 'resuming';
    try { await this.driver.resume(signal); cancelled(signal); this.#state = 'idle'; }
    catch (cause) {
      this.#state = 'stopped';
      try { await this.driver.stop(); } catch { this.#state = 'failed'; }
      throw new SessionError('RESTORE_FAILED', 'Explicit resume failed; no fresh session admitted', { cause });
    }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    if (this.#state === 'closed') return Promise.resolve();
    if (this.#state === 'exporting' || this.#state === 'resuming') return Promise.reject(new SessionError('BUSY', 'A lifecycle transition is already in progress'));
    return this.#closing = this.closeOnce();
  }
  private async closeOnce() {
    this.#state = 'closing';
    for (const activity of this.#activities) activity.controller.abort();
    // Client callbacks must observe cancellation. Native shutdown still runs
    // if a client fails to finish, but quiescence is not falsely acknowledged.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingError: unknown;
    try {
      await Promise.race([Promise.all([...this.#activities].map(a => a.finished)), new Promise((_, reject) => { timer = setTimeout(() => reject(new SessionError('SHUTDOWN_FAILED', 'Client activity did not settle')), 22000); })]);
    } catch (error) { pendingError = error; }
    finally { clearTimeout(timer); }
    try { await this.driver.stop(); if (pendingError) throw pendingError; this.#state = 'closed'; }
    catch (cause) { this.#state = 'failed'; throw new SessionError('SHUTDOWN_FAILED', 'Session cleanup was not confirmed', { cause }); }
  }
}
