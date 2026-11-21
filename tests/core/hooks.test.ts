import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { HookRegistry, preservingProviderState } from '../../src/core/hooks.ts';
import { startOwned } from '../../src/runtime/process.ts';

async function setup(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'hooks-')); t.after(() => rm(root, { recursive: true, force: true }));
  const staging = join(root, 'staging'); await mkdir(staging, { mode: 0o700 });
  await mkdir(join(staging, 'provider'), { mode: 0o700 }); await writeFile(join(staging, 'provider/native'), 'original', { mode: 0o600 });
  const owner = join(root, 'owner'); execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', 'native/owner.c', '-o', owner]);
  return { root, staging, owner };
}
async function program(root: string, name: string, text: string) { const path = join(root, name + '.mjs'); await writeFile(path, text, { mode: 0o600 }); return [process.execPath, path] as [string, string]; }

test('E01/E04: registered hooks run in sorted order and unknown optional state stays inactive', async t => {
  const f = await setup(t);
  const command = await program(f.root, 'hook', `import fs from 'node:fs';let text='';for await(const chunk of process.stdin)text+=chunk;const input=JSON.parse(text);fs.writeFileSync('state.bin',Buffer.from([0,255]),{mode:0o600});console.log(JSON.stringify({phase:input.phase,previous:input.data}));`);
  const registry = new HookRegistry(['z.last', 'a.first'].map(id => ({ id, version: '1', command, required: true, validate: () => true })), f.owner);
  const unknown = { id: 'future.extension', version: '9', required: false, data: { command: ['/must/never/execute'], unknown: [true] } };
  assert.deepEqual(registry.resolve([unknown]), ['Inactive optional extension retained: future.extension@9']);
  const exported = await registry.run('export', f.staging, [unknown]);
  assert.deepEqual(exported.map(e => e.id), ['a.first', 'future.extension', 'z.last']);
  assert.deepEqual(exported[1], unknown);
  assert.deepEqual(await readFile(join(f.staging, 'extensions/a.first/state.bin')), Buffer.from([0, 255]));
  const imported = await registry.run('import', f.staging, exported);
  assert.equal((imported[0].data as any).phase, 'import');
  assert.equal((imported[0].data as any).previous.phase, 'export');
  assert.deepEqual(imported[1], unknown);
});
test('E02: missing or incompatible required hooks fail before any command', async t => {
  const f = await setup(t); const required = { id: 'test.hook', version: '1', required: true, data: null };
  const registry = new HookRegistry([], f.owner);
  assert.throws(() => registry.resolve([required]), { code: 'INCOMPATIBLE' });
  const other = new HookRegistry([{ id: 'test.hook', version: '2', required: true, command: ['/must/not/run'], validate: () => true }], f.owner);
  assert.throws(() => other.resolve([required]), { code: 'INCOMPATIBLE' });
});
test('E03/D20: invalid output, namespace mutation, excess file bytes and timeout fail after cleanup', async t => {
  for (const [name, code, limit] of [
    ['failure', 'process.exit(17)', {}],
    ['invalid', "console.log('not JSON')", {}],
    ['namespace', "import fs from 'node:fs';fs.writeFileSync('../../provider/native','tampered');console.log('null')", {}],
    ['file', "import fs from 'node:fs';fs.writeFileSync('large','x'.repeat(100),{mode:0o600});console.log('null')", { fileBytes: 16 }],
    ['output', "console.log('x'.repeat(1000))", { hookJsonBytes: 20 }],
    ['timeout', 'setInterval(()=>{},1000)', {}]
  ] as const) {
    const f = await setup(t); const command = await program(f.root, name, code);
    const registry = new HookRegistry([{ id: 'test.hook', version: '1', required: true, command, deadlineMs: name === 'timeout' ? 50 : 1000, validate: () => true }], f.owner);
    await assert.rejects(registry.run('export', f.staging, [], limit));
  }
});
test('S06/D10: a forged stdout completion cannot replace the owner completion pipe', async t => {
  const f = await setup(t);
  const fake = join(f.root, 'fake'); await writeFile(fake, '#!/bin/sh\nprintf Q\n', { mode: 0o700 }); await chmod(fake, 0o700);
  const child = startOwned(fake, '/bin/true', [], { cwd: f.root }); child.output.resume(); child.input.end();
  await assert.rejects(child.done, { code: 'SHUTDOWN_FAILED' });
});

test('D20: decoded native state outside payload namespaces cannot be changed by an import hook', async t => {
  const f = await setup(t); const native = join(f.root, 'native'); await mkdir(native, { mode: 0o700 });
  await writeFile(join(native, 'memory'), 'original', { mode: 0o600 });
  const command = await program(f.root, 'native-mutation', `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(join(native, 'memory'))},'mutated');console.log('null');`);
  const registry = new HookRegistry([{ id: 'test.hook', version: '1', required: true, command, validate: () => true }], f.owner);
  await assert.rejects(preservingProviderState(native, undefined, () => registry.run('import', f.staging, [{ id: 'test.hook', version: '1', required: true, data: null }])), { code: 'HOOK_FAILED' });
});

test('D19/D20: hook JSON input and output accept their exact byte budgets and reject excess', async t => {
  const f = await setup(t), id = 'test.hook';
  const command = await program(f.root, 'boundary', `console.log(JSON.stringify('x'.repeat(200)));`);
  const registry = new HookRegistry([{ id, version: '1', required: true, command, validate: () => true }], f.owner);
  const outputBytes = Buffer.byteLength(JSON.stringify('x'.repeat(200)) + '\n');
  await registry.run('export', f.staging, [], { hookJsonBytes: outputBytes });
  await assert.rejects(registry.run('export', f.staging, [], { hookJsonBytes: outputBytes - 1 }), { code: 'LIMIT' });
  const input = { phase: 'import', id, version: '1', data: 'x'.repeat(300) };
  const inputBytes = Buffer.byteLength(JSON.stringify(input) + '\n');
  const ext = [{ id, version: '1', required: true, data: input.data }];
  await registry.run('import', f.staging, ext, { hookJsonBytes: inputBytes });
  await assert.rejects(registry.run('import', f.staging, ext, { hookJsonBytes: inputBytes - 1 }), { code: 'LIMIT' });
});
