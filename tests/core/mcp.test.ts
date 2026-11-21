import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { toolBroker } from '../../src/runtime/broker.ts';
import { SessionLifecycle } from '../../src/core/lifecycle.ts';
import { localClient } from '../../src/client.ts';
import { loadConfiguration } from '../../src/config.ts';

test('E05/E08: configured stdio MCP is proxied only after the connected client permits the call', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-proxy-')); t.after(() => rm(root, { recursive: true, force: true }));
  const owner = join(root, 'owner'); execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', 'native/owner.c', '-o', owner]);
  const marker = join(root, 'marker'), script = join(root, 'server.mjs');
  await writeFile(script, `import{createInterface}from'node:readline';import fs from'node:fs';for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id===undefined)continue;let result;if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(m.method==='tools/list')result={tools:[{name:'echo',description:'Echo the explicit test input',inputSchema:{type:'object'}}]};if(m.method==='tools/call'){fs.writeFileSync(process.env.MARKER,'called');result={content:[{type:'text',text:JSON.stringify(m.params.arguments)}]}}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')}`);
  let allow = false; let permissions = 0;
  const lifecycle = new SessionLifecycle({ stop: async () => {}, resume: async () => {}, capture: async () => { throw new Error('not used'); } }, { compatibility: { providers: {}, features: [] }, publish: async (_s, _t, r) => r });
  const broker = await toolBroker({ capabilities: {}, update: async () => {}, call: async () => { permissions++; return { outcome: allow ? { outcome: 'selected', optionId: 'allow' } : { outcome: 'cancelled' } }; } }, () => lifecycle, 'session', new AbortController().signal, { servers: [{ name: 'fixture', command: process.execPath, args: [script], env: [{ name: 'MARKER', value: marker }] }], owner, workspace: root, home: root });
  t.after(() => broker.close());
  const call = async (method: string, params = {}) => (await fetch(broker.url, { method: 'POST', headers: { authorization: `Bearer ${broker.token}` }, body: JSON.stringify({ method, params }) })).json() as Promise<any>;
  const list = await call('tools/list'); assert.equal(list.tools[0].name, 'external_fixture__echo');
  const denied = await call('tools/call', { name: 'external_fixture__echo', arguments: { value: 'private' } });
  assert.equal(denied.isError, true); await assert.rejects(access(marker));
  allow = true; const permitted = await call('tools/call', { name: 'external_fixture__echo', arguments: { value: 'permitted' } });
  assert.ok(permitted.content[0].text.includes('permitted')); assert.equal(await readFile(marker, 'utf8'), 'called'); assert.equal(permissions, 2);
  assert.deepEqual(lifecycle.pendingActivities, []);
});
test('CLI hook configuration compiles only explicit local schemas and validates data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hook-config-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  await writeFile(path, JSON.stringify({ hooks: [{ id: 'test.schema', version: '1', required: true, command: ['/bin/false'], schema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } }] }));
  const config = await loadConfiguration(path); assert.equal(config.hooks[0].validate({ count: 2 }), true); assert.equal(config.hooks[0].validate({ count: 'wrong' }), false);
  await writeFile(path, '{"hooks":[],"hooks":[]}'); await assert.rejects(loadConfiguration(path));
  await writeFile(path, JSON.stringify({ command: ['/must/not/run'] })); await assert.rejects(loadConfiguration(path));
});

test('E08/D12: local file callbacks execute once per approved broker request and denial executes none', async t => {
  const root = await mkdtemp(join(tmpdir(), 'local-files-')); t.after(() => rm(root, { recursive: true, force: true }));
  const owner = join(root, 'owner'); execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', 'native/owner.c', '-o', owner]);
  let allowed = true; const counts: Record<string, number> = {};
  const client = localClient(root, owner, async () => ({ outcome: allowed ? { outcome: 'selected', optionId: 'allow' } : { outcome: 'cancelled' } }));
  const call = client.call; client.call = async (method, p, s) => { counts[method] = (counts[method] ?? 0) + 1; return call(method, p, s); };
  const lifecycle = new SessionLifecycle({ stop: async () => {}, resume: async () => {}, capture: async () => { throw new Error('not used'); } }, { compatibility: { providers: {}, features: [] }, publish: async (_s, _t, r) => r });
  const broker = await toolBroker(client, () => lifecycle, 'session', new AbortController().signal, { servers: [], owner, workspace: root, home: root }); t.after(() => broker.close());
  const invoke = async (name: string, args: any) => (await fetch(broker.url, { method: 'POST', headers: { authorization: `Bearer ${broker.token}` }, body: JSON.stringify({ method: 'tools/call', params: { name, arguments: args } }) })).json() as Promise<any>;
  assert.equal((await invoke('write_file', { path: 'local.txt', content: 'same-host' })).content[0].text, 'File written');
  assert.equal((await invoke('read_file', { path: 'local.txt' })).content[0].text, 'same-host');
  allowed = false; assert.equal((await invoke('write_file', { path: 'local.txt', content: 'MUST NOT RUN' })).isError, true);
  assert.equal(await readFile(join(root, 'local.txt'), 'utf8'), 'same-host');
  assert.deepEqual(counts, { 'session/request_permission': 3, 'fs/write_text_file': 1, 'fs/read_text_file': 1 });
});
