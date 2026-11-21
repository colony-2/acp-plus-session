export type ErrorCode = 'INVALID_BUNDLE' | 'INCOMPATIBLE' | 'LIMIT' | 'INTEGRITY' | 'CONFLICT' | 'UNSUPPORTED' | 'BUSY' | 'STOPPED' | 'CANCELLED' | 'RESTORE_FAILED' | 'SHUTDOWN_FAILED' | 'HOOK_FAILED' | 'DEPENDENCY';
export class SessionError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, options?: ErrorOptions) { super(message, options); this.code = code; this.name = 'SessionError'; }
}
export function fail(code: ErrorCode, message: string): never { throw new SessionError(code, message); }
export function cancelled(signal?: AbortSignal) { if (signal?.aborted) fail('CANCELLED', 'Operation cancelled'); }
