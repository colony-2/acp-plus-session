import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { stageBundle, sealBundle } from '../../src/core/bundle.ts';
import { SessionLifecycle } from '../../src/core/lifecycle.ts';
import { atomicPublisher } from '../../src/core/publication.ts';
const compatibility = { providers: { codex: ['fixture'] }, features: [] };
async function setup(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'publication-')); t.after(() => rm(root, { recursive: true, force: true }));
  const helper = join(root, 'publish'); execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', 'native/publish.c', '-o', helper]);
  return { root, helper };
}
test('B06/D22: SIGKILL around real atomic commit exposes no target or a fully validated checkpoint', async t => {
  const f = await setup(t);
  const previous = join(f.root, 'previous'); await mkdir(previous, { mode: 0o700 }); await mkdir(join(previous, 'provider'), { mode: 0o700 }); await writeFile(join(previous, 'provider/original'), 'immutable', { mode: 0o600 });
  await sealBundle(previous, { provider: 'codex', nativeId: 'fixture', stateFormat: 'fixture', producer: { fixture: '1' }, requiredFeatures: [], application: {}, extensions: [] }, compatibility);
  const priorManifest = await readFile(join(previous, 'manifest.json'));
  for (const phase of ['before', 'after']) {
    const script = join(f.root, phase + '.mjs'), marker = join(f.root, phase + '.ready'), target = join(f.root, phase);
    const lifecycle = pathToFileURL(join(process.cwd(), 'src/core/lifecycle.ts')).href;
    const publication = pathToFileURL(join(process.cwd(), 'src/core/publication.ts')).href;
    await writeFile(script, `import{SessionLifecycle}from${JSON.stringify(lifecycle)};import{atomicPublisher}from${JSON.stringify(publication)};import{mkdir,writeFile}from'node:fs/promises';import{join}from'node:path';
const driver={stop:async()=>{},resume:async()=>{},capture:async p=>{await mkdir(join(p,'provider'),{mode:0o700});await writeFile(join(p,'provider/native'),'complete',{mode:0o600});return{provider:'codex',nativeId:'fixture',stateFormat:'fixture',producer:{fixture:'1'},requiredFeatures:[],application:{},extensions:[]}}};
const commit=atomicPublisher(${JSON.stringify(f.helper)});const pause=async()=>{await writeFile(${JSON.stringify(marker)},'ready');await new Promise(()=>{setInterval(()=>{},1000)})};
const publish=async(...a)=>{if(${JSON.stringify(phase)}==='before')await pause();const r=await commit(...a);if(${JSON.stringify(phase)}==='after')await pause();return r};
await new SessionLifecycle(driver,{compatibility:${JSON.stringify(compatibility)},publish}).export(${JSON.stringify(target)});`);
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr = ''; child.stderr.on('data', b => { stderr += b; });
    const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) { ready = await access(marker).then(() => true, () => false); if (ready || child.exitCode !== null) break; await new Promise(r => setTimeout(r, 25)); }
      assert.equal(ready, true, stderr); child.kill('SIGKILL'); await done;
      if (phase === 'before') await assert.rejects(access(target));
      else { const restored = await stageBundle(target, f.root, compatibility); assert.equal(await readFile(join(restored.staging, 'provider/native'), 'utf8'), 'complete'); }
      assert.equal(await readFile(join(previous, 'provider/original'), 'utf8'), 'immutable'); assert.deepEqual(await readFile(join(previous, 'manifest.json')), priorManifest); await stageBundle(previous, f.root, compatibility);
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await done; } }
  }
});
test('D22: unsupported atomic helper fails explicitly without publishing or replacing existing state', async t => {
  const f = await setup(t), helper = join(f.root, 'unsupported'); await writeFile(helper, '#!/bin/sh\nexit 11\n', { mode: 0o700 });
  const driver: import('../../src/core/lifecycle.ts').Driver = { stop: async () => {}, resume: async () => {}, capture: async (p: string) => { await mkdir(join(p, 'provider'), { mode: 0o700 }); return { provider: 'codex', nativeId: 'fixture', stateFormat: 'fixture', producer: { fixture: '1' }, requiredFeatures: [], application: null, extensions: [] }; } };
  const session = new SessionLifecycle(driver, { compatibility, publish: atomicPublisher(helper) });
  await assert.rejects(session.export(join(f.root, 'target')), { code: 'UNSUPPORTED' }); await assert.rejects(access(join(f.root, 'target'))); assert.equal(session.state, 'stopped');
});
