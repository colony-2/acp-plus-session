import { execFileSync } from 'node:child_process';
import { readFile, readlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function identity() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    const st = await lstat(path).catch((error: any) => { if (error.code !== 'ENOENT') throw error; return null; });
    hash.update(path + '\0');
    if (!st) { hash.update('deleted\0'); continue; }
    hash.update(String(st.mode) + '\0');
    if (st.isSymbolicLink()) hash.update('link\0' + await readlink(path) + '\0');
    else if (st.isFile()) {
      const bytes = await readFile(path);
      hash.update(bytes.length + '\0').update(bytes);
    } else throw new Error(`Unsupported source entry: ${path}`);
  }
  return { commit, treeSha256: hash.digest('hex'),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) };
}
