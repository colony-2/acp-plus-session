import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function inventory(root: string): Promise<any[]> {
  const files: any[] = [];
  async function walk(relative: string) {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = join(relative, name);
      const st = await lstat(join(root, path));
      files.push({ path, kind: st.isFile() ? 'file' : st.isDirectory() ? 'directory' : 'other',
        mode: st.mode & 0o7777, size: st.size,
        ...(st.isFile() ? { sha256: digest(await readFile(join(root, path))) } : {}) });
      if (st.isDirectory()) await walk(path);
    }
  }
  await walk('');
  return files;
}

// Deliberately do not inherit provider credentials, configuration, hooks or agent homes.
export async function fixtureEnv(home: string, extra: Record<string, string> = {}) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8',
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', ...extra };
}

export async function groupMembers(group: number) {
  if (process.platform !== 'linux') throw new Error('This process probe currently requires Linux /proc');
  const found: any[] = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = await readFile(`/proc/${entry}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === group) found.push({ pid: Number(entry), ppid: Number(fields[1]),
        state: fields[0], startTicks: fields[19],
        argv: (await readFile(`/proc/${entry}/cmdline`, 'utf8')).split('\0').filter(Boolean) });
    } catch (error: any) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  }
  return found;
}

export function start(command: string, args: string[], cwd: string, env: Record<string, string>, timeoutMs = 20000) {
  const startedAt = new Date().toISOString();
  // Node has no per-child umask option. The synchronous spawn inherits this
  // value; restore it before yielding so other fixture work is unaffected.
  const previousMask = process.umask(0o077);
  let child: ChildProcessWithoutNullStreams;
  try { child = spawn(command, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
  finally { process.umask(previousMask); }
  let stdout = '', stderr = '', timedOut = false;
  const trace: any[] = [];
  let reading = false;
  const poll = setInterval(async () => {
    if (reading || !child.pid) return;
    reading = true;
    try { trace.push({ at: new Date().toISOString(), members: await groupMembers(child.pid) }); }
    finally { reading = false; }
  }, 100);
  const signal = (sig: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, sig); } catch (e: any) { if (e.code !== 'ESRCH') throw e; }
  };
  const timer = setTimeout(() => { timedOut = true; signal('SIGKILL'); }, timeoutMs);
  child.stdout.on('data', b => { stdout = (stdout + b.toString()).slice(-65536); });
  child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-65536); });
  const done = new Promise<any>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', async (code, sig) => {
      clearTimeout(timer); clearInterval(poll);
      while (reading) await delay(5);
      const survivors = child.pid ? await groupMembers(child.pid) : [];
      if (survivors.length) signal('SIGKILL');
      resolve({ command, args, cwd, environmentKeys: Object.keys(env).sort(), pid: child.pid,
        startedAt, reapedAt: new Date().toISOString(), code, signal: sig, timedOut,
        stdout, stderr, trace, survivors });
    });
  });
  return { child, done, signal };
}

export async function run(command: string, args: string[], cwd: string, env: Record<string, string>) {
  const p = start(command, args, cwd, env);
  p.child.stdin.end();
  return p.done;
}
