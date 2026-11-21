import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const projectToolVersions = {
  '@types/node': '24.19.2', typescript: '6.0.3', vitest: '5.1.1', acpx: '0.22.0'
} as const;

// Read the project's manifests, including declaration-only packages. Worker
// command bindings and pnpm's global root are deliberately not consulted.
export async function checkProjectDependencies(root = process.cwd()) {
  for (const [name, version] of Object.entries(projectToolVersions)) {
    const manifest = JSON.parse(await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`Unexpected project dependency ${name}: expected ${name}@${version}`);
    }
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  await checkProjectDependencies();
  console.log('Project dependencies verified: ' + Object.entries(projectToolVersions).map(([n, v]) => `${n}@${v}`).join(', '));
}
