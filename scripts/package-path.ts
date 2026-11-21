import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^[a-z0-9-]+$/.test(pkg.name) || !/^[a-zA-Z0-9.+-]+$/.test(pkg.version)) throw new Error('Unsupported package identity');
console.log(resolve(process.argv[2], `${pkg.name}-${pkg.version}.tgz`));
