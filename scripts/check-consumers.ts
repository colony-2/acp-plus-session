import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
for (const name of await readdir('tests/consumers')) if (name.endsWith('.mjs')) execFileSync(process.execPath, ['--check', 'tests/consumers/' + name], { stdio: 'inherit' });
