import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { SessionError } from '../core/errors.ts';

export interface OwnedProcess {
  child: ChildProcess;
  input: Writable;
  output: Readable;
  done: Promise<{ code: number | null; diagnostics: string }>;
  stop(force?: boolean): Promise<void>;
}
export function startOwned(helper: string, executable: string, args: string[], options: Pick<SpawnOptions, 'cwd' | 'env'> & { cwdFd?: number }): OwnedProcess {
  const { cwdFd, ...spawnOptions } = options;
  const child = spawn(helper, [...(cwdFd === undefined ? [] : ['--cwd-fd', '4']), executable, ...args], { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe', 'pipe', ...(cwdFd === undefined ? [] : [cwdFd])] });
  child.stdin!.on('error', () => {});
  let ready = false, forceRequested = false;
  let tail = Buffer.alloc(0), confirmation = Buffer.alloc(0), failure: Error | undefined;
  const done = new Promise<{ code: number | null; diagnostics: string }>((resolve, reject) => {
    child.on('error', error => { failure = error; });
    child.stderr!.on('data', (chunk: Buffer) => { tail = Buffer.concat([tail, chunk]).subarray(-65536); });
    (child.stdio[3] as Readable).on('data', (chunk: Buffer) => {
      confirmation = Buffer.concat([confirmation, chunk]);
      if (!ready && confirmation[0] === 82) {
        ready = true; if (forceRequested) child.kill('SIGUSR1');
      }
      if (confirmation.length > 2 || !'RQ'.startsWith(confirmation.toString())) { failure = new Error('Invalid process ownership completion'); child.kill('SIGTERM'); }
    });
    child.on('close', code => {
      if (failure || confirmation.toString() !== 'RQ') reject(new SessionError('SHUTDOWN_FAILED', 'Writer reaping was not confirmed by the installed owner', { cause: failure }));
      else resolve({ code, diagnostics: tail.toString('utf8') });
    });
  });
  // Process errors may occur while a caller is awaiting a protocol response.
  // Retain the rejection for done, without an unhandled-rejection race.
  void done.catch(() => {});
  let stopping: Promise<void> | undefined;
  const stop = (force = false) => {
    // The installed owner alone signals its kernel-owned children and reaps
    // them. Cancellation skips grace without killing that confirmation writer.
    if (force) {
      forceRequested = true;
      if (ready && child.exitCode === null && child.signalCode === null) child.kill('SIGUSR1');
    }
    return stopping ??= (async () => {
      child.stdout?.resume();
      child.stdin?.end();
      // EOF permits the adapter to dispose its SDK first. Ownership still bounds
      // descendants which retain streams or ignore graceful disposal.
      const term = setTimeout(() => child.kill('SIGTERM'), 1000);
      const force = setTimeout(() => child.kill('SIGKILL'), 22000);
      try { await done; } finally { clearTimeout(term); clearTimeout(force); }
    })();
  };
  return { child, input: child.stdin!, output: child.stdout!, done, stop };
}
