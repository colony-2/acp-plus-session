import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const root = process.env.CONSUMER_STATE_ROOT, provider = process.env.CONSUMER_PROVIDER;
const importedFrom = import.meta.resolve('acp-plus-session'), cli = path.join(path.dirname(fileURLToPath(importedFrom)), 'cli.js');
const facts = { remembered: 'remembered-' + randomUUID(), priorTool: 'prior-tool-' + randomUUID(), branches: {} }, checks = [], invocations = [];
let terminalCalls = 0, readCalls = 0;
async function client(workspace, negotiate = true, hold = false) {
  const argv = [cli, 'acp', '--provider', provider, '--base-url', process.env.CONSUMER_ENDPOINT];
  const child = spawn(process.execPath, argv, { env: { ...process.env, [provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY']: 'consumer-fixture-key' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(), terminals = new Map(); let sequence = 0, stderr = '', release, entered;
  const permissionRequested = new Promise(resolve => { entered = resolve; });
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-65536); });
  const send = m => { assert.equal(child.stdin.writableEnded, false, 'test response must reach the open control transport'); child.stdin.write(JSON.stringify(m) + '\n'); };
  const done = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', code => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('ACP exited')); } pending.clear(); if (code === 0) resolve(); else reject(new Error('ACP exit ' + code + ': ' + stderr)); });
  }); void done.catch(()=>{});
  const request = (method, params) => {
    const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('ACP timeout ' + method)); child.kill('SIGTERM'); }, 45000); pending.set(id, { resolve, reject, timer }); send({ jsonrpc: '2.0', id, method, params }); });
  };
  async function reverse(method, p) {
    if (method === 'session/request_permission') {
      if (hold) { entered(); return new Promise(resolve => { release = () => { const option = p.options.find(o => o.kind === 'allow_once'); resolve({ outcome: { outcome: 'selected', optionId: option.optionId } }); }; }); }
      const option = p.options.find(o => o.kind === 'allow_once'); return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
    }
    if (method === 'fs/read_text_file') { readCalls++; return { content: await fs.readFile(path.resolve(workspace, p.path), 'utf8') }; }
    if (method === 'terminal/create') {
      terminalCalls++; const id = randomUUID(); const tool = spawn(p.command, p.args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
      const terminal = { text: '', done: new Promise(resolve => tool.on('close', code => resolve({ exitCode: code }))), process: tool }; terminals.set(id, terminal);
      for (const stream of [tool.stdout, tool.stderr]) stream.on('data', b => { terminal.text = (terminal.text + b).slice(-65536); }); return { terminalId: id };
    }
    const terminal = terminals.get(p.terminalId);
    if (method === 'terminal/wait_for_exit') return terminal.done;
    if (method === 'terminal/output') return { output: terminal.text, truncated: false };
    if (method === 'terminal/release') { await terminal.done; terminals.delete(p.terminalId); return {}; }
    if (method === 'terminal/kill') { terminal.process.kill('SIGTERM'); await terminal.done; return {}; }
    throw new Error('Unexpected reverse callback ' + method);
  }
  createInterface({ input: child.stdout }).on('line', line => {
    const m = JSON.parse(line);
    if (m.method && m.id !== undefined) void reverse(m.method, m.params).then(result => send({ jsonrpc: '2.0', id: m.id, result }), error => send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: error.message } }));
    else if (m.id !== undefined) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); if (m.error) p.reject(Object.assign(new Error(m.error.message), { rpc: m.error })); else p.resolve(m.result); }
  });
  const initialized = await request('initialize', { protocolVersion: 1, clientCapabilities: { terminal: true, fs: { readTextFile: true } }, ...(negotiate ? { _meta: { 'acp-plus-session/checkpoint': 1 } } : {}) });
  assert.equal(Boolean(initialized.agentCapabilities._meta?.['acp-plus-session/checkpoint']), negotiate);
  const session = async checkpoint => (await request(checkpoint ? '_acp_plus_session/restore' : 'session/new', { cwd: workspace, mcpServers: [], ...(checkpoint ? { checkpoint } : {}) })).sessionId;
  return { request, session, permissionRequested, lateGrant: async () => { release(); await new Promise(resolve => setImmediate(resolve)); }, notify: (method, params) => send({ jsonrpc: '2.0', method, params }), async close() { child.stdin.end(); await done; invocations.push({ command: [process.execPath, ...argv], code: 0 }); assert.deepEqual(await fs.readdir(process.env.TMPDIR), []); } };
}
const make = async name => { const workspace = path.join(root, name); await fs.mkdir(workspace, { mode: 0o700 }); return workspace; };
const source = await make('source-workspace'), checkpoint = path.join(root, 'checkpoint');
await fs.writeFile(path.join(source, 'context.txt'), facts.priorTool);
const ordinary = await client(source, false); await assert.rejects(ordinary.request('_acp_plus_session/restore', { cwd: source, checkpoint }), error => error.rpc.code === -32601); await ordinary.close(); checks.push('unnegotiated-checkpoint-method-refused');
const first = await client(source), id = await first.session();
await first.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: `Remember ${facts.remembered}. Read context.txt using the local tool.` }] });
const exporting = first.request('_acp_plus_session/export', { sessionId: id, destination: checkpoint });
await assert.rejects(first.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: 'MUST NOT RUN' }] }));
await assert.rejects(first.request('_acp_plus_session/restore', { sessionId: id, cwd: source, checkpoint }));
await exporting;
await assert.rejects(first.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: 'MUST NOT RUN' }] }));
await first.request('_acp_plus_session/resume', { sessionId: id }); await first.close();
await fs.rm(source, { recursive: true }); checks.push('export-result-delivered-on-live-control-transport', 'explicit-resume-after-export', 'source-private-state-and-workspace-deleted');
const originalManifest = await fs.readFile(path.join(checkpoint, 'manifest.json'));
for (const branch of ['alpha', 'beta']) {
  const workspace = await make(branch + '-workspace'); facts.branches[branch] = branch + '-' + randomUUID(); await fs.writeFile(path.join(workspace, 'destination.txt'), facts.branches[branch]);
  const resumed = await client(workspace), id = await resumed.session(checkpoint);
  await resumed.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: 'Continue using remembered context. Read destination.txt using the local tool.' }] });
  const successor = path.join(root, branch + '-successor'); await resumed.request('_acp_plus_session/export', { sessionId: id, destination: successor }); await resumed.close();
  await fs.rm(workspace, { recursive: true }); const nextWorkspace = await make(branch + '-next-workspace'); const next = await client(nextWorkspace), nextId = await next.session(successor);
  await next.request('session/prompt', { sessionId: nextId, prompt: [{ type: 'text', text: 'Continue with prior context.' }] }); await next.close(); checks.push(branch + '-successor-restored-after-branch-deletion');
}
assert.deepEqual(await fs.readFile(path.join(checkpoint, 'manifest.json')), originalManifest); assert.equal(terminalCalls, 2); assert.equal(readCalls, 1); checks.push('approved-filesystem-and-terminal-callbacks-executed-exactly-once', 'racing-prompt-and-replacement-import-refused');
const cancelledWorkspace = await make('cancelled-workspace'), cancelled = await client(cancelledWorkspace, true, true), cancelledId = await cancelled.session();
const turn = cancelled.request('session/prompt', { sessionId: cancelledId, prompt: [{ type: 'text', text: 'Exercise cancellation while permission is pending.' }] });
await cancelled.permissionRequested; cancelled.notify('session/cancel', { sessionId: cancelledId });
assert.equal((await turn).stopReason, 'cancelled'); await cancelled.lateGrant(); await cancelled.close();
assert.equal(terminalCalls, 2); assert.equal(readCalls, 1); await assert.rejects(fs.access(path.join(cancelledWorkspace, 'cancelled-marker'))); checks.push('cancellation-and-late-permission-response-cannot-execute-tool');
const disconnectedWorkspace = await make('disconnected-workspace'), disconnected = await client(disconnectedWorkspace, true, true), disconnectedId = await disconnected.session();
const disconnectedTurn = disconnected.request('session/prompt', { sessionId: disconnectedId, prompt: [{ type: 'text', text: 'Exercise disconnection during permission.' }] }); void disconnectedTurn.catch(() => {});
await disconnected.permissionRequested; await disconnected.close(); await assert.rejects(disconnectedTurn);
assert.equal(terminalCalls, 2); assert.equal(readCalls, 1); await assert.rejects(fs.access(path.join(disconnectedWorkspace, 'disconnected-marker'))); checks.push('disconnection-during-permission-cannot-execute-tool');
console.log(JSON.stringify({ provider, consumer: 'acp', facts, checks, invocations, importedFrom }));
