import { SessionError } from './errors.ts';
// A settled operation releases its abort listener. An operation that ignores
// cancellation remains tracked by its lifecycle activity until it settles.
export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new SessionError('CANCELLED', 'Operation cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    void work.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
