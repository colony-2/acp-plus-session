import { copyFile } from 'node:fs/promises';
import { mkdir, readFile, writeFile, cp, rm, access, chmod } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { endpoint } from './endpoints.ts';
import { fixtureEnv, run, inventory, digest } from './support.ts';
import { broker } from './broker.ts';
import { CodexCodec } from '../../src/providers/codecs.ts';
import { inspectCodexResume } from '../../src/providers/codex-guard.ts';
import { writerFixture } from './writer.ts';

export async function probeCodex(deps: string, root: string, reaper?: string) {
  const req = createRequire(join(deps, 'package.json'));
  const pkg = req.resolve('@openai/codex/package.json');
  const cli = join(dirname(pkg), 'bin/codex.js');
  const runs: any[] = [], checks: any[] = [];
  const controller = await broker(reaper);
  const restricted = ['-c', 'features.shell_tool=false', '-c', 'features.apply_patch_freeform=false', '-c', 'features.collab=false', '-c', 'web_search="disabled"', '-c', `model_catalog_json=${JSON.stringify(resolve('tests/fixtures/codex-broker-model.json'))}`];
  let responses: any[] = [];
  const api = await endpoint('codex', body => {
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected fixture request');
    if (response.name === '$local') response.name = body.tools.find((t: any) => t.name?.endsWith('__local_exec'))?.name ?? '$missing-local-tool';
    return response;
  });
  const check = (id: string, passed: boolean, detail: any) => checks.push({ id, status: passed ? 'passed' : 'failed', detail });
  async function invoke(label: string, home: string, workspace: string, prompt: string, id?: string, extra: string[] = [], controlled = true, allowed = true, guarded = true) {
    await mkdir(workspace, { recursive: true }); await mkdir(home, { recursive: true, mode: 0o700 });
    const state = join(home, '.codex'); await mkdir(state, { recursive: true, mode: 0o700 });
    // Relocate only the fixture's copied index, after native writers were reaped.
    if (await access(join(state, 'state_5.sqlite')).then(() => true, () => false)) {
      const db = new DatabaseSync(join(state, 'state_5.sqlite'));
      try {
        for (const row of db.prepare('SELECT id, rollout_path FROM threads').all() as any[]) {
          if (isAbsolute(row.rollout_path)) { if (!row.rollout_path.startsWith(state + '/sessions/')) throw new Error('Foreign relocated rollout'); continue; }
          if (row.rollout_path.startsWith('../')) throw new Error('Unsealed fixture rollout reference');
          db.prepare('UPDATE threads SET rollout_path=?,cwd=? WHERE id=?').run(join(state, row.rollout_path), workspace, row.id);
        }
      } finally { db.close(); }
    }
    if (id && guarded) await inspectCodexResume(state, id);
    await writeFile(join(state, 'config.toml'), `model_provider = "mock"
model = "gpt-5.3-codex"
[model_providers.mock]
name = "Local fixture"
base_url = "${api.url}/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 1000
${controlled ? `
[mcp_servers.portable]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(resolve('tests/fixtures/mcp-broker.ts'))}]
[mcp_servers.portable.env]
PORTABLE_PROBE_BROKER_URL = ${JSON.stringify(controller.url)}
PORTABLE_PROBE_BROKER_TOKEN = ${JSON.stringify(controller.token)}
` : ''}
`, { mode: 0o600 });
    const env = await fixtureEnv(home, { CODEX_HOME: state, OPENAI_API_KEY: 'fixture-only', NO_COLOR: '1' });
    controller.configure(workspace, env, allowed);
    const beforeRequest = api.requests.length;
    const argv = [cli, 'exec', '--json', '--skip-git-repo-check', '--color', 'never', '-C', workspace,
      '--sandbox', 'workspace-write', '-c', 'approval_policy="on-request"', '-c', 'features.use_linux_sandbox_bwrap=true', ...(controlled ? restricted : []), ...extra,
      ...(id ? ['resume', id, prompt] : [prompt])];
    const result = await run(reaper ?? process.execPath, reaper ? [process.execPath, ...argv] : argv, workspace, env);
    const events = result.stdout.trim().split('\n').map((s: string) => { try { return JSON.parse(s); } catch { return {}; } });
    const threadId = events.find((e: any) => e.type === 'thread.started')?.thread_id;
    const before = await inventory(state); await delay(150); const after = await inventory(state);
    const stable = JSON.stringify(before) === JSON.stringify(after);
    runs.push({ label, process: result, events, threadId, requestStart: beforeRequest, requestEnd: api.requests.length, inventory: after, stableAfterExit: stable });
    return { result, threadId, state, requests: api.requests.slice(beforeRequest).map(r => r.body), events, stable };
  }
  const codec = new CodexCodec();
  async function capture(state: string, destination: string) {
    await mkdir(destination, { mode: 0o700 });
    const db = new DatabaseSync(join(state, 'state_5.sqlite'));
    const rawMain = join(root, `wal-main-${randomUUID()}.sqlite`);
    let expectedTitle = ''; const logSentinel = 'excluded-log-' + randomUUID();
    try {
      const id = db.prepare('SELECT id FROM threads').get()!.id as string;
      db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0');
      const beforeTitle = db.prepare('SELECT title FROM threads WHERE id=?').get(id)!.title;
      db.prepare('INSERT INTO logs(ts,ts_nanos,level,target,message) VALUES(?,?,?,?,?)').run(1, 1, 'ERROR', 'qualification', logSentinel);
      expectedTitle = 'committed-wal-' + randomUUID(); db.prepare('UPDATE threads SET title=? WHERE id=?').run(expectedTitle, id);
      // Keep an idle connection open solely to retain the committed WAL. The
      // raw main-file copy must still contain the older row, unlike backup.
      await copyFile(join(state, 'state_5.sqlite'), rawMain);
      const mainOnly = new DatabaseSync(rawMain, { readOnly: true });
      let oldMain: unknown;
      try { oldMain = mainOnly.prepare('SELECT title FROM threads WHERE id=?').get(id)!.title; } finally { mainOnly.close(); }
      await codec.capture(state, '', id, destination);
      const sealed = new DatabaseSync(join(destination, 'state_5.sqlite'), { readOnly: true });
      try {
        check('codex.fixture-committed-wal', oldMain === beforeTitle && sealed.prepare('SELECT title FROM threads WHERE id=?').get(id)!.title === expectedTitle, { rawMainHeldPreviousValue: oldMain === beforeTitle, committedWalIncluded: sealed.prepare('SELECT title FROM threads WHERE id=?').get(id)!.title === expectedTitle });
        check('codex.fixture-database-log-exclusion', !(await readFile(join(destination, 'state_5.sqlite'))).includes(Buffer.from(logSentinel)), 'Production codec deletes log rows and vacuums their freed bytes');
        check('codex.fixture-sqlite-snapshot', sealed.prepare('PRAGMA quick_check').get()?.quick_check === 'ok', { method: 'Product codec: committed-WAL backup, log scrubbing, relative index' });
      } finally { sealed.close(); }
    } finally { db.close(); await rm(rawMain, { force: true }); }
  }
  try {
    const home = join(root, 'source-home'), workspace = join(root, 'source-workspace');
    await mkdir(workspace, { recursive: true });
    const remembered = `remembered-${randomUUID()}`, toolFact = `tool-${randomUUID()}`;
    await writeFile(join(workspace, 'local-context.txt'), toolFact);
    responses = [{ name: '$local', arguments: { command: 'pwd; cat local-context.txt' } }, 'initial complete'];
    const first = await invoke('initial-context-and-tool', home, workspace, `Remember ${remembered}. Read local-context.txt.`);
    const firstInputs = JSON.stringify(first.requests.at(-1)?.input);
    check('codex.native-initial-tool', first.result.code === 0 && firstInputs.includes(toolFact) && firstInputs.includes(workspace), 'Real local command output reached the provider request');
    check('codex.basic-shutdown', first.result.code === 0 && first.result.survivors.length === 0 && first.stable, 'Leader reaped, no process-group survivors observed, inventory stable for 150ms');
    const checkpoint = join(root, 'checkpoint'); await capture(first.state, checkpoint);
    const sourceDigest = digest(JSON.stringify(await inventory(checkpoint)));
    const checkpointText = (await Promise.all((await inventory(checkpoint)).filter(f => f.kind === 'file').map(f => readFile(join(checkpoint, f.path))))).map(bytes => bytes.toString('latin1')).join('\n');
    check('codex.fixture-credential-exclusion', !checkpointText.includes(controller.token) && !checkpointText.includes('fixture-only'), 'Generated broker/API credentials are outside the selected fixture closure');
    await rm(home, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true });
    const branchFacts: Record<string, string> = {};
    for (const branch of ['alpha', 'beta']) {
      const branchHome = join(root, `${branch}-home`), branchWorkspace = join(root, `${branch}-workspace`);
      const state = join(branchHome, '.codex'); await mkdir(state, { recursive: true, mode: 0o700 });
      await codec.restore(checkpoint, state, branchWorkspace, first.threadId);
      const branchFact = `${branch}-${randomUUID()}`; branchFacts[branch] = branchFact;
      await mkdir(branchWorkspace, { recursive: true }); await writeFile(join(branchWorkspace, 'destination.txt'), branchFact);
      responses = [{ name: '$local', arguments: { command: 'pwd; cat destination.txt' } }, `branch ${branch} complete`];
      const resumed = await invoke(`${branch}-relocated`, branchHome, branchWorkspace, 'Continue with remembered context. Read destination.txt.', first.threadId);
      const history = JSON.stringify(resumed.requests[0]?.input), current = JSON.stringify(resumed.requests.at(-1)?.input);
      check(`codex.${branch}.relocated-context`, resumed.result.code === 0 && resumed.threadId === first.threadId && history.includes(remembered) && history.includes(toolFact) && current.includes(branchWorkspace) && current.includes(branchFact), { historyContainedRememberedFact: history.includes(remembered), historyContainedPriorToolResult: history.includes(toolFact), destinationToolResult: current.includes(branchFact) });
      const successor = join(root, `${branch}-successor`); await capture(state, successor);
      await rm(branchHome, { recursive: true, force: true }); await rm(branchWorkspace, { recursive: true, force: true });
      const nextHome = join(root, `${branch}-next-home`), nextWorkspace = join(root, `${branch}-next-workspace`);
      await mkdir(join(nextHome, '.codex'), { recursive: true, mode: 0o700 }); await codec.restore(successor, join(nextHome, '.codex'), nextWorkspace, first.threadId);
      responses = ['successor complete'];
      const next = await invoke(`${branch}-successor-restored`, nextHome, nextWorkspace, 'Continue and recall prior context.', first.threadId);
      const successorHistory = JSON.stringify(next.requests[0]?.input);
      check(`codex.${branch}.successor-context`, next.result.code === 0 && next.threadId === first.threadId && successorHistory.includes(branchFact) && successorHistory.includes(remembered) && successorHistory.includes(toolFact), { containsBranchFact: successorHistory.includes(branchFact) });
      if (branch === 'beta') check('codex.independent-branches', !successorHistory.includes(branchFacts.alpha), 'Beta history excludes alpha local tool fact');
    }
    check('codex.checkpoint-immutable', sourceDigest === digest(JSON.stringify(await inventory(checkpoint))), 'Source inventory unchanged after two independent branches');
    const writerCwd = join(root, 'detached-writer-workspace');
    const writer = await writerFixture(writerCwd);
    responses = [{ name: '$local', arguments: { command: writer.command } }, 'writer fixture complete'];
    const ownedWriter = await invoke('detached-tool-writer', join(root, 'detached-writer-home'), writerCwd, 'Exercise local process ownership.');
    const writerState = await writer.inspect();
    check('codex.detached-tool-writer-shutdown', ownedWriter.result.code === 0 && !ownedWriter.result.timedOut &&
      ownedWriter.result.survivors.length === 0 && writerState.reaped && writerState.stableAfterExit, writerState);
    for (const fault of ['missing', 'corrupt', 'mismatched-id']) {
      const badHome = join(root, `guard-${fault}-home`), badState = join(badHome, '.codex');
      await mkdir(badState, { recursive: true, mode: 0o700 });
      await cp(checkpoint, badState, { recursive: true });
      const rollout = (await inventory(badState)).find(f => f.path.endsWith('.jsonl'));
      if (fault === 'missing') await rm(join(badState, rollout.path));
      if (fault === 'corrupt') await writeFile(join(badState, rollout.path), 'not a native rollout\n');
      const before = api.requests.length, beforeRuns = runs.length;
      let error: string | undefined;
      try { await invoke(`guard-${fault}`, badHome, join(root, `guard-${fault}-workspace`), 'THIS PROMPT MUST NOT RUN', fault === 'mismatched-id' ? randomUUID() : first.threadId); }
      catch (e) { error = String(e); }
      check(`codex.prelaunch-guard.${fault}`, Boolean(error) && before === api.requests.length && beforeRuns === runs.length, { error, nativeLaunches: runs.length - beforeRuns, requests: api.requests.length - before });
    }
    responses = ['MISSING RESUME MUST NOT EXECUTE THIS'];
    const missing = await invoke('missing-native-resume', join(root, 'missing-home'), join(root, 'missing-workspace'), 'Continue.', randomUUID(), [], true, true, false);
    check('D03.codex.native-missing-load', missing.result.code !== 0 && missing.requests.length === 0 && !missing.threadId, { actualExit: missing.result.code, requestCount: missing.requests.length, freshThread: missing.threadId });
    const permissionWorkspace = join(root, 'permission-workspace');
    await mkdir(permissionWorkspace);
    const image = join(permissionWorkspace, 'fixture.png');
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'));
    responses = [{ name: 'view_image', arguments: { path: image } }, 'permission probe complete'];
    const permission = await invoke('absent-permission-handler', join(root, 'permission-home'), permissionWorkspace, 'Exercise the configured permission boundary.', undefined,
      ['-c', 'features.shell_tool=false', '-c', 'features.apply_patch_freeform=false', '-c', 'web_search="disabled"'], false);
    const imageSent = JSON.stringify(permission.requests.at(-1)?.input).includes('data:image/');
    check('D13.codex.native-permissions', !imageSent, { nativeImageReadWithoutHandler: imageSent, events: permission.events.map((e: any) => e.type) });
    responses = ['disabled tool catalog'];
    const disabled = await invoke('disable-native-tool-flags', join(root, 'disabled-home'), join(root, 'disabled-workspace'), 'Describe available tools.', undefined,
      ['-c', 'features.shell_tool=false', '-c', 'features.apply_patch_freeform=false', '-c', 'features.collab=false', '-c', 'web_search="disabled"'], false);
    const tools = disabled.requests[0]?.tools ?? [];
    check('codex.broker-native-tool-removal', !tools.some((t: any) => ['apply_patch', 'view_image', 'exec_command', 'shell_command'].includes(t.name)), { remainingTools: tools.map((t: any) => t.name ?? t.type), explanation: 'Disabling shell and apply-patch feature flags must remove native bypass paths before an MCP-only broker is sufficient' });
    responses = [{ name: 'view_image', arguments: { path: image } }, 'restricted image probe complete'];
    const catalog = await invoke('restricted-model-native-image', join(root, 'catalog-home'), permissionWorkspace, 'Exercise the local controller boundary.', undefined, restricted);
    const catalogResult = JSON.stringify(catalog.requests.at(-1)?.input);
    check('codex.broker-catalog-image-guard', catalog.result.code === 0 && catalogResult.includes('view_image is not allowed') && !catalogResult.includes('data:image/'), { blockedBeforeImageRead: catalogResult.includes('view_image is not allowed'), advertisedTools: catalog.requests[0]?.tools?.map((t: any) => t.name ?? t.type) });
    const deniedWorkspace = join(root, 'denied-workspace');
    responses = [{ name: '$local', arguments: { command: 'printf denied > permission-marker.txt' } }, 'denied tool complete'];
    const denied = await invoke('broker-permission-denied', join(root, 'denied-home'), deniedWorkspace, 'Exercise the owning client denial.', undefined, [], true, false);
    const wrote = await access(join(deniedWorkspace, 'permission-marker.txt')).then(() => true, () => false);
    check('codex.broker-denial', denied.result.code === 0 && !wrote && JSON.stringify(denied.requests.at(-1)?.input).includes('Permission denied by the owning fixture client'), { markerWritten: wrote, lastDecision: controller.calls.at(-1)?.decision });
    const report = { provider: 'codex', root, package: JSON.parse(await readFile(pkg, 'utf8')).version, launcherSha256: digest(await readFile(cli)), checks, runs, brokerCalls: controller.calls, requests: api.requests, endpointErrors: api.errors };
    const diagnosticText = JSON.stringify(report);
    check('codex.fixture-diagnostic-credential-exclusion', !diagnosticText.includes(controller.token) && !diagnosticText.includes('fixture-only'), 'Generated credential sentinels absent from captured fixture diagnostics');
    return report;
  } finally { await api.close(); await controller.close(); }
}
