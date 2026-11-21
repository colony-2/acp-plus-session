import { mkdir, readFile, writeFile, cp, rm, readdir, access, realpath, symlink, lstat } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { endpoint } from './endpoints.ts';
import { acpClient } from './acp.ts';
import { fixtureEnv, start, inventory, digest, groupMembers } from './support.ts';
import { broker } from './broker.ts';
import { claudeProjectKey } from '../../src/providers/claude-layout.ts';
import { writerFixture } from './writer.ts';
import { relocateClaudeToolResults, portableClaudeToolRoot } from '../../src/providers/claude-tool-results.ts';
import { inspectClaudeRelated } from '../../src/providers/claude-related.ts';
import { ClaudeCodec } from '../../src/providers/codecs.ts';


export async function probeClaude(deps: string, root: string, reaper?: string) {
  const req = createRequire(join(deps, 'package.json'));
  const pkg = req.resolve('@agentclientprotocol/claude-agent-acp/package.json');
  const cli = join(dirname(pkg), 'dist/index.js');
  const checks: any[] = [], runs: any[] = [];
  const controller = await broker(reaper);
  const workspaces = new Map<string, string>();
  let responses: any[] = [];
  const api = await endpoint('claude', body => {
    // The adapter independently generates titles; do not feed that auxiliary
    // query a prearranged continuation answer or consume a tool fixture with it.
    if (!body.tools?.length) return 'Probe title';
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected Claude fixture request');
    if (response.name === '$local') response.name = body.tools.find((t: any) => t.name?.endsWith('__local_exec'))?.name ?? '$missing-local-tool';
    return response;
  });
  const check = (id: string, passed: boolean, detail: any) => checks.push({ id, status: passed ? 'passed' : 'failed', detail });
  async function invoke(label: string, home: string, workspace: string, prompt: string, id?: string, killQuery = false, controlled = false, allowed = true, extraEnv: Record<string, string> = {}) {
    await mkdir(workspace, { recursive: true });
    workspaces.set(home, await realpath(workspace));
    const env = await fixtureEnv(home, { CLAUDE_CONFIG_DIR: join(home, '.claude'),
      ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: 'fixture-only',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_AGENT_ACP_PROTOCOL: 'v1', ...extraEnv });
    controller.configure(workspace, env, allowed);
    const proc = start(reaper ?? process.execPath, reaper ? [process.execPath, cli] : [cli], workspace, env, 45000);
    const callbacks: any[] = [];
    const client = acpClient(proc.child, async message => {
      callbacks.push(message);
      if (message.method === 'session/request_permission') {
        // Explicit fixture policy: only the known broker tool may reach the
        // controller. The controller makes its own per-invocation decision.
        const option = controlled && JSON.stringify(message.params.toolCall).includes('local_exec') && message.params.options.find((o: any) => o.kind === 'allow_once');
        return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
      }
      if (message.method === 'fs/read_text_file') {
        if (!message.params.path.startsWith(workspace + '/')) throw new Error('Outside fixture workspace');
        return { content: await readFile(message.params.path, 'utf8') };
      }
      throw new Error(`Unadvertised reverse method ${message.method}`);
    });
    let init: any, session: any, result: any, error: string | undefined;
    const requestStart = api.requests.length;
    try {
      init = await client.request('initialize', { protocolVersion: 1, clientInfo: { name: 'portable-session-probe', version: '0' }, clientCapabilities: { fs: { readTextFile: true }, subagents: {} } });
      session = await client.request(id ? 'session/load' : 'session/new', { ...(id ? { sessionId: id } : {}), cwd: workspace, mcpServers: [],
        ...(controlled ? { _meta: { claudeCode: { options: { tools: [], settingSources: [], allowDangerouslySkipPermissions: false,
          mcpServers: { portable: { command: process.execPath, args: [resolve('tests/fixtures/mcp-broker.ts')], env: { PORTABLE_PROBE_BROKER_URL: controller.url, PORTABLE_PROBE_BROKER_TOKEN: controller.token } } } } } } } : {}) });
      await client.request('session/set_mode', { sessionId: id ?? session.sessionId, modeId: 'default' });
      if (killQuery) {
        const members = await groupMembers(proc.child.pid!);
        const query = members.find(m => m.argv.includes('--input-format') && m.argv.includes('stream-json'));
        if (!query) throw new Error('Native query process was not identified');
        process.kill(query.pid, 'SIGKILL');
        await delay(200);
      }
      result = await client.request('session/prompt', { sessionId: id ?? session.sessionId, prompt: [{ type: 'text', text: prompt }] });
    } catch (e) { error = String(e); }
    finally { proc.child.stdin.end(); }
    const processResult = await proc.done;
    const before = await inventory(home); await delay(150); const after = await inventory(home);
    const stable = JSON.stringify(before) === JSON.stringify(after);
    const requests = api.requests.slice(requestStart).filter(r => r.body.tools?.length).map(r => r.body);
    const run = { label, home, workspace, init, session, result, error, process: processResult,
      callbacks, wire: client.wire, inventory: after, stableAfterExit: stable, requestStart, requestEnd: api.requests.length };
    runs.push(run);
    return { ...run, id: id ?? session?.sessionId, requests };
  }
  const encoded = claudeProjectKey;
  const codec = new ClaudeCodec();
  async function readRelated(directory: string) {
    const files = new Map<string, string>();
    const names = await readdir(directory).catch((error: any) => { if (error.code !== 'ENOENT') throw error; return []; });
    for (const name of names) {
      const file = join(directory, name), st = await lstat(file);
      if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o077)) throw new Error('Unsafe related Claude file');
      files.set(name, await readFile(file, 'utf8'));
    }
    return files;
  }
  async function transcripts(home: string, id: string): Promise<string[]> {
    const projects = join(home, '.claude/projects');
    const files = [];
    for (const entry of await readdir(projects)) {
      const path = join(projects, entry, `${id}.jsonl`);
      try { await readFile(path); files.push(path); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    }
    return files;
  }
  async function capture(home: string, id: string, destination: string) {
    const files = await transcripts(home, id);
    if (files.length !== 1) throw new Error('Ambiguous or absent Claude transcript');
    const canonicalWorkspace = workspaces.get(home);
    if (!canonicalWorkspace) throw new Error('Unrecorded capture workspace');
    await mkdir(destination, { mode: 0o700 });
    await codec.capture(join(home, '.claude'), canonicalWorkspace, id, destination);
  }
  async function restore(checkpoint: string, home: string, workspace: string, id: string) {
    await mkdir(workspace, { recursive: true });
    await mkdir(join(home, '.claude'), { recursive: true, mode: 0o700 });
    await codec.restore(checkpoint, join(home, '.claude'), await realpath(workspace), id);
  }
  try {
    const home = join(root, 'source-home'), workspace = join(root, 'source-workspace');
    await mkdir(workspace, { recursive: true });
    const remembered = `remembered-${randomUUID()}`, toolFact = `tool-${randomUUID()}`;
    await writeFile(join(workspace, 'local-context.txt'), toolFact);
    responses = [{ name: 'Read', arguments: { file_path: join(workspace, 'local-context.txt') } }, 'initial complete'];
    const first = await invoke('initial-context-and-tool', home, workspace, `Remember ${remembered}. Read local-context.txt.`);
    const firstInputs = JSON.stringify(first.requests.at(-1)?.messages);
    check('claude.native-initial-tool', !first.error && firstInputs.includes(toolFact), { error: first.error, callbackCount: first.callbacks.length, contextReachedProvider: firstInputs.includes(toolFact) });
    check('D12.claude.read-callback-routing', first.callbacks.filter(c => c.method === 'fs/read_text_file').length === 1, 'Advertising fs.readTextFile did not route the native Read call through the client');
    check('claude.basic-shutdown', first.process.code === 0 && first.process.survivors.length === 0 && first.stableAfterExit, 'ACP EOF disposal, leader reaped, no process-group survivors observed, stable inventory for 150ms');
    if (!first.id || first.error) return { provider: 'claude', root, checks, runs, requests: api.requests, endpointErrors: api.errors };
    const checkpoint = join(root, 'checkpoint'); await capture(home, first.id, checkpoint);
    const sourceDigest = digest(JSON.stringify(await inventory(checkpoint)));
    await rm(home, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true });
    const branchFacts: Record<string, string> = {};
    for (const branch of ['alpha', 'beta']) {
      const branchHome = join(root, `${branch}-home`), branchWorkspace = join(root, `${branch}-workspace`);
      await restore(checkpoint, branchHome, branchWorkspace, first.id);
      const branchFact = `${branch}-${randomUUID()}`; branchFacts[branch] = branchFact;
      await mkdir(branchWorkspace, { recursive: true }); await writeFile(join(branchWorkspace, 'destination.txt'), branchFact);
      responses = [{ name: 'Read', arguments: { file_path: join(branchWorkspace, 'destination.txt') } }, `branch ${branch} complete`];
      const resumed = await invoke(`${branch}-relocated`, branchHome, branchWorkspace, 'Continue with remembered context. Read destination.txt.', first.id);
      const history = JSON.stringify(resumed.requests[0]?.messages), current = JSON.stringify(resumed.requests.at(-1)?.messages);
      check(`claude.${branch}.relocated-context`, !resumed.error && history.includes(remembered) && history.includes(toolFact) && current.includes(branchFact), { error: resumed.error, historyContainedRememberedFact: history.includes(remembered), historyContainedPriorToolResult: history.includes(toolFact), destinationToolResult: current.includes(branchFact) });
      const successor = join(root, `${branch}-successor`); await capture(branchHome, first.id, successor);
      await rm(branchHome, { recursive: true, force: true }); await rm(branchWorkspace, { recursive: true, force: true });
      const nextHome = join(root, `${branch}-next-home`), nextWorkspace = join(root, `${branch}-next-workspace`);
      await restore(successor, nextHome, nextWorkspace, first.id);
      responses = ['successor complete'];
      const next = await invoke(`${branch}-successor-restored`, nextHome, nextWorkspace, 'Continue and recall prior context.', first.id);
      const successorHistory = JSON.stringify(next.requests[0]?.messages);
      check(`claude.${branch}.successor-context`, !next.error && successorHistory.includes(branchFact) && successorHistory.includes(remembered) && successorHistory.includes(toolFact), { error: next.error, containsBranchFact: successorHistory.includes(branchFact) });
      if (branch === 'beta') check('claude.independent-branches', successorHistory.includes(branchFacts.beta) && !successorHistory.includes(branchFacts.alpha), 'Beta history includes beta fact and excludes alpha local tool fact');
    }
    check('claude.checkpoint-immutable', sourceDigest === digest(JSON.stringify(await inventory(checkpoint))), 'Source inventory unchanged after two independent branches');
    const childHome = join(root, 'related-source-home'), childCwd = join(root, 'related-source-workspace');
    const childFact = `child-private-${randomUUID()}`;
    responses = [{ name: 'Agent', arguments: { description: 'Native related transcript fixture', prompt: 'Record the fixture observation and report completion.', subagent_type: 'general-purpose', run_in_background: false } },
      childFact, 'parent fixture complete'];
    const childInitial = await invoke('related-native-child', childHome, childCwd, 'Run the native related-transcript fixture.');
    const related = childInitial.inventory.filter((f: any) => f.kind === 'file' && f.path.includes('/subagents/'));
    const childId = related.find((f: any) => f.path.endsWith('.jsonl'))?.path.match(/agent-([a-zA-Z0-9_-]+)\.jsonl$/)?.[1];
    const childReplay = (wire: any[]) => wire.filter(m => m.method === 'session/update' && m.params.sessionId === childId);
    check('claude.native-related-transcripts-observed', !childInitial.error && childId && related.some((f: any) => f.path.endsWith('.meta.json')) && JSON.stringify(childReplay(childInitial.wire)).includes(childFact), {
      error: childInitial.error, nativeId: childInitial.id, related, childId,
      childUpdates: childReplay(childInitial.wire).length, childTextObserved: JSON.stringify(childReplay(childInitial.wire)).includes(childFact) });
    if (!childInitial.error && childInitial.id && childId) {
      const checkpoint = join(root, 'related-checkpoint'); await capture(childHome, childInitial.id, checkpoint);
      const sealed = digest(JSON.stringify(await inventory(checkpoint)));
      await rm(childHome, { recursive: true, force: true }); await rm(childCwd, { recursive: true, force: true });
      const branchFacts: Record<string, string> = {};
      for (const branch of ['alpha', 'beta']) {
        const home = join(root, `related-${branch}-home`), cwd = join(root, `related-${branch}-workspace`);
        await restore(checkpoint, home, cwd, childInitial.id);
        branchFacts[branch] = `related-${branch}-${randomUUID()}`;
        responses = [branchFacts[branch]];
        const continued = await invoke(`related-${branch}-relocated`, home, cwd, 'Continue with the prior session context.', childInitial.id, false, true);
        check(`claude.related-${branch}.replayed-child-history`, !continued.error && JSON.stringify(childReplay(continued.wire)).includes(childFact), {
          error: continued.error, childId, childUpdates: childReplay(continued.wire).length, childTextReplayed: JSON.stringify(childReplay(continued.wire)).includes(childFact) });
        const successor = join(root, `related-${branch}-successor`); await capture(home, childInitial.id, successor);
        await rm(home, { recursive: true, force: true }); await rm(cwd, { recursive: true, force: true });
        const nextHome = join(root, `related-${branch}-next-home`), nextCwd = join(root, `related-${branch}-next-workspace`);
        await restore(successor, nextHome, nextCwd, childInitial.id);
        responses = ['related successor complete'];
        const next = await invoke(`related-${branch}-successor-restored`, nextHome, nextCwd, 'Continue with prior context.', childInitial.id, false, true);
        const history = JSON.stringify(next.requests[0]?.messages);
        check(`claude.related-${branch}.successor-child-history`, !next.error && JSON.stringify(childReplay(next.wire)).includes(childFact) && history.includes(branchFacts[branch]), {
          error: next.error, childId, childUpdates: childReplay(next.wire).length, childTextReplayed: JSON.stringify(childReplay(next.wire)).includes(childFact), branchContext: history.includes(branchFacts[branch]) });
        if (branch === 'beta') check('claude.related-independent-branches', !history.includes(branchFacts.alpha), 'Beta related-state branch excludes alpha output');
      }
      const broken = join(root, 'related-missing-checkpoint'); await cp(checkpoint, broken, { recursive: true });
      await rm(join(broken, childInitial.id, 'subagents', `agent-${childId}.jsonl`));
      const before = runs.length; let error: string | undefined;
      try { await restore(broken, join(root, 'related-missing-home'), join(root, 'related-missing-workspace'), childInitial.id); }
      catch (cause) { error = String(cause); }
      check('claude.missing-related-before-launch', Boolean(error) && runs.length === before, { error, nativeLaunches: runs.length - before });
      check('claude.related-checkpoint-immutable', sealed === digest(JSON.stringify(await inventory(checkpoint))), 'Related source checkpoint unchanged across branches and successors');
    }
    const writerCwd = join(root, 'detached-writer-workspace');
    const writer = await writerFixture(writerCwd);
    responses = [{ name: '$local', arguments: { command: writer.command } }, 'writer fixture complete'];
    const ownedWriter = await invoke('detached-tool-writer', join(root, 'detached-writer-home'), writerCwd, 'Exercise local process ownership.', undefined, false, true);
    const writerState = await writer.inspect();
    check('claude.detached-tool-writer-shutdown', !ownedWriter.error && !ownedWriter.process.timedOut &&
      ownedWriter.process.survivors.length === 0 && writerState.reaped && writerState.stableAfterExit, writerState);
    const controlledWorkspace = join(root, 'broker-workspace');
    const brokerFact = `broker-${randomUUID()}`;
    await mkdir(controlledWorkspace); await writeFile(join(controlledWorkspace, 'broker-context.txt'), brokerFact);
    responses = [{ name: '$local', arguments: { command: 'pwd; cat broker-context.txt' } }, 'broker complete'];
    const controlled = await invoke('supported-broker-options', join(root, 'broker-home'), controlledWorkspace, `Remember ${remembered}. Exercise the owning local controller.`, undefined, false, true);
    const controlledInputs = JSON.stringify(controlled.requests.at(-1)?.messages);
    check('claude.broker-local-tool', !controlled.error && controlledInputs.includes(brokerFact) && controlledInputs.includes(controlledWorkspace), { error: controlled.error, brokerCalls: controller.calls.length, toolResultReachedProvider: controlledInputs.includes(brokerFact), tools: controlled.requests[0]?.tools?.map((t: any) => t.name) });
    check('claude.broker-tool-catalog', controlled.requests.length > 0 && !controlled.requests[0]?.tools?.some((t: any) => !t.name?.startsWith('mcp__portable__') && t.name !== 'DeferredToolPlaceholder'), 'Supported tools: [] leaves broker tools and the native inert DeferredToolPlaceholder; settingSources: [] excludes user/project settings');
    const controlledCheckpoint = join(root, 'broker-checkpoint');
    if (controlled.id && !controlled.error) {
      await capture(join(root, 'broker-home'), controlled.id, controlledCheckpoint);
      const text = (await readFile(join(controlledCheckpoint, `${controlled.id}.jsonl`))).toString('latin1');
      check('claude.fixture-credential-exclusion', !text.includes(controller.token) && !text.includes('fixture-only'), 'Broker token and API key absent from selected transcript bytes');
      const sealedDigest = digest(JSON.stringify(await inventory(controlledCheckpoint)));
      await rm(join(root, 'broker-home'), { recursive: true, force: true });
      await rm(controlledWorkspace, { recursive: true, force: true });
      const facts: Record<string, string> = {};
      for (const branch of ['alpha', 'beta']) {
        const branchHome = join(root, `broker-${branch}-home`), cwd = join(root, `broker-${branch}-workspace`);
        await restore(controlledCheckpoint, branchHome, cwd, controlled.id);
        await mkdir(cwd, { recursive: true }); facts[branch] = `${branch}-${randomUUID()}`;
        await writeFile(join(cwd, 'destination.txt'), facts[branch]);
        responses = [{ name: '$local', arguments: { command: 'pwd; cat destination.txt' } }, 'branch complete'];
        const resumed = await invoke(`broker-${branch}-relocated`, branchHome, cwd, 'Continue with prior context. Read destination.txt.', controlled.id, false, true);
        const history = JSON.stringify(resumed.requests[0]?.messages), current = JSON.stringify(resumed.requests.at(-1)?.messages);
        check(`claude.broker-${branch}.relocated-context`, !resumed.error && history.includes(remembered) && history.includes(brokerFact) && current.includes(facts[branch]) && current.includes(cwd), { error: resumed.error, remembered: history.includes(remembered), priorLocalTool: history.includes(brokerFact), destinationTool: current.includes(facts[branch]) });
        const successor = join(root, `broker-${branch}-successor`);
        await capture(branchHome, controlled.id, successor);
        await rm(branchHome, { recursive: true, force: true }); await rm(cwd, { recursive: true, force: true });
        const nextHome = join(root, `broker-${branch}-next-home`), nextCwd = join(root, `broker-${branch}-next-workspace`);
        await restore(successor, nextHome, nextCwd, controlled.id);
        responses = ['successor complete'];
        const next = await invoke(`broker-${branch}-successor-restored`, nextHome, nextCwd, 'Continue with prior context.', controlled.id, false, true);
        const nextHistory = JSON.stringify(next.requests[0]?.messages);
        check(`claude.broker-${branch}.successor-context`, !next.error && nextHistory.includes(remembered) && nextHistory.includes(brokerFact) && nextHistory.includes(facts[branch]), { error: next.error, branchFact: nextHistory.includes(facts[branch]) });
        if (branch === 'beta') check('claude.broker-independent-branches', !nextHistory.includes(facts.alpha), 'Beta contains its own tool result and excludes alpha context');
      }
      check('claude.broker-checkpoint-immutable', sealedDigest === digest(JSON.stringify(await inventory(controlledCheckpoint))), 'Broker source checkpoint unchanged across independent mutable homes');
    }
    // Exercise the native on-disk lookup, not only the SDK store key. Long
    // paths need a hash suffix; Linux keeps NFC/NFD paths byte-distinct.
    const largeHome = join(root, 'large-output-home'), largeCwd = join(root, 'large-output-workspace');
    await mkdir(largeCwd, { recursive: true });
    const largeFact = `large-output-${randomUUID()}`, largeRemembered = `large-remembered-${randomUUID()}`;
    await writeFile(join(largeCwd, 'large.txt'), `${largeFact}\n${'fixture-data '.repeat(4000)}\n${largeFact}\n`);
    responses = [{ name: '$local', arguments: { command: 'cat large.txt' } }, 'large output complete'];
    const large = await invoke('large-tool-output', largeHome, largeCwd, `Remember ${largeRemembered}. Read large.txt through the local tool.`, undefined, false, true, true, { MAX_MCP_OUTPUT_TOKENS: '1024' });
    const largeFiles = large.id ? await transcripts(largeHome, large.id) : [];
    const sidecars = large.inventory.filter((f: any) => f.kind === 'file' && f.path.includes('/tool-results/'));
    check('claude.large-output-sidecar-observed', !large.error && sidecars.length > 0, {
      error: large.error, nativeId: large.id, files: largeFiles, sidecars,
      toolResult: large.requests.at(-1)?.messages?.at(-1) });
    if (!large.error && large.id && sidecars.length === 1) {
      const checkpoint = join(root, 'large-output-checkpoint'); await capture(largeHome, large.id, checkpoint);
      const sealed = digest(JSON.stringify(await inventory(checkpoint)));
      const artifactName = basename(sidecars[0].path);
      check('claude.large-output-checkpoint-bytes', digest(await readFile(join(checkpoint, large.id, 'tool-results', artifactName))) === sidecars[0].sha256,
        'Native tool-result bytes retained alongside the sealed transcript');
      await rm(largeHome, { recursive: true, force: true }); await rm(largeCwd, { recursive: true, force: true });
      const branchFacts: Record<string, string> = {};
      const quoted = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
      for (const branch of ['alpha', 'beta']) {
        const home = join(root, `artifact-${branch}-home`), cwd = join(root, `artifact-${branch}-workspace`);
        await restore(checkpoint, home, cwd, large.id);
        branchFacts[branch] = `artifact-${branch}-${randomUUID()}`;
        await writeFile(join(cwd, 'destination.txt'), branchFacts[branch]);
        const artifact = join(home, '.claude/projects', encoded(cwd), large.id, 'tool-results', artifactName);
        responses = [{ name: '$local', arguments: { command: `pwd; head -n1 ${quoted(artifact)}; cat destination.txt` } }, 'artifact branch complete'];
        const continued = await invoke(`artifact-${branch}-relocated`, home, cwd, 'Continue using prior context. Read the saved output and destination.txt.', large.id, false, true);
        const history = JSON.stringify(continued.requests[0]?.messages), current = JSON.stringify(continued.requests.at(-1)?.messages);
        check(`claude.artifact-${branch}.relocated-context`, !continued.error && history.includes(largeRemembered) && history.includes(artifact) &&
          !history.includes(join(largeHome, sidecars[0].path)) && current.includes(largeFact) && current.includes(branchFacts[branch]) && current.includes(cwd), {
          error: continued.error, remembered: history.includes(largeRemembered), relocatedReference: history.includes(artifact),
          savedOutputRead: current.includes(largeFact), destinationTool: current.includes(branchFacts[branch]) });
        const successor = join(root, `artifact-${branch}-successor`); await capture(home, large.id, successor);
        await rm(home, { recursive: true, force: true }); await rm(cwd, { recursive: true, force: true });
        const nextHome = join(root, `artifact-${branch}-next-home`), nextCwd = join(root, `artifact-${branch}-next-workspace`);
        await restore(successor, nextHome, nextCwd, large.id);
        const nextArtifact = join(nextHome, '.claude/projects', encoded(nextCwd), large.id, 'tool-results', artifactName);
        responses = [{ name: '$local', arguments: { command: `pwd; head -n1 ${quoted(nextArtifact)}` } }, 'artifact successor complete'];
        const next = await invoke(`artifact-${branch}-successor-restored`, nextHome, nextCwd, 'Continue using prior context and the saved output.', large.id, false, true);
        const prior = JSON.stringify(next.requests[0]?.messages), output = JSON.stringify(next.requests.at(-1)?.messages);
        check(`claude.artifact-${branch}.successor-context`, !next.error && prior.includes(largeRemembered) && prior.includes(branchFacts[branch]) &&
          prior.includes(nextArtifact) && output.includes(largeFact) && output.includes(nextCwd), {
          error: next.error, remembered: prior.includes(largeRemembered), branchFact: prior.includes(branchFacts[branch]),
          successorReference: prior.includes(nextArtifact), savedOutputRead: output.includes(largeFact), destinationTool: output.includes(nextCwd) });
        if (branch === 'beta') check('claude.artifact-independent-branches', !prior.includes(branchFacts.alpha), 'Beta saved-output branch excludes alpha destination fact');
      }
      const broken = join(root, 'artifact-missing-checkpoint'); await cp(checkpoint, broken, { recursive: true });
      await rm(join(broken, large.id, 'tool-results', artifactName));
      const before = runs.length; let missingError: string | undefined;
      try { await restore(broken, join(root, 'artifact-missing-home'), join(root, 'artifact-missing-workspace'), large.id); }
      catch (error) { missingError = String(error); }
      check('claude.missing-tool-result-before-launch', Boolean(missingError) && runs.length === before, { error: missingError, nativeLaunches: runs.length - before });
      check('claude.artifact-checkpoint-immutable', sealed === digest(JSON.stringify(await inventory(checkpoint))), 'Saved-output source checkpoint unchanged through branches and successors');
    }
    const longHome = join(root, 'long-source-home');
    const longCwd = join(root, 'long-source', 'a'.repeat(110), 'b'.repeat(110));
    const longFact = `long-path-${randomUUID()}`, longTool = `long-tool-${randomUUID()}`;
    await mkdir(longCwd, { recursive: true });
    await writeFile(join(longCwd, 'context.txt'), longTool);
    responses = [{ name: '$local', arguments: { command: 'pwd; cat context.txt' } }, 'long initial complete'];
    const longInitial = await invoke('long-path-initial', longHome, longCwd, `Remember ${longFact}. Read context.txt.`, undefined, false, true);
    const nativeLongFiles = longInitial.id ? await transcripts(longHome, longInitial.id) : [];
    check('claude.long-path-native-lookup', !longInitial.error && nativeLongFiles.length === 1 &&
      basename(dirname(nativeLongFiles[0])) === encoded(longCwd), {
      error: longInitial.error, workspace: longCwd, expectedKey: encoded(longCwd), files: nativeLongFiles });
    if (longInitial.id && !longInitial.error) {
      const longCheckpoint = join(root, 'long-checkpoint'); await capture(longHome, longInitial.id, longCheckpoint);
      const sealedLong = digest(JSON.stringify(await inventory(longCheckpoint)));
      await rm(longHome, { recursive: true, force: true }); await rm(join(root, 'long-source'), { recursive: true, force: true });
      for (const layout of ['long', 'unicode-nfc', 'unicode-nfd', 'canonical-symlink']) {
        const layoutHome = join(root, `${layout}-home`);
        const actualCwd = layout === 'long' ? join(root, 'long-destination', 'c'.repeat(110), 'd'.repeat(110)) :
          join(root, layout === 'unicode-nfc' ? 'dest-é' : layout === 'unicode-nfd' ? 'dest-e\u0301' : 'symlink-real');
        await mkdir(actualCwd, { recursive: true });
        const requestedCwd = layout === 'canonical-symlink' ? join(root, 'symlink-alias') : actualCwd;
        if (layout === 'canonical-symlink') await symlink(actualCwd, requestedCwd);
        await restore(longCheckpoint, layoutHome, requestedCwd, longInitial.id);
        const destinationFact = `${layout}-${randomUUID()}`;
        await writeFile(join(actualCwd, 'destination.txt'), destinationFact);
        responses = [{ name: '$local', arguments: { command: 'pwd; cat destination.txt' } }, 'layout continued'];
        const continued = await invoke(`${layout}-relocated`, layoutHome, requestedCwd, 'Continue with prior context. Read destination.txt.', longInitial.id, false, true);
        const before = JSON.stringify(continued.requests[0]?.messages), after = JSON.stringify(continued.requests.at(-1)?.messages);
        const files = await transcripts(layoutHome, longInitial.id);
        check(`claude.${layout}.relocated-context`, !continued.error && before.includes(longFact) && before.includes(longTool) &&
          after.includes(destinationFact) && after.includes(actualCwd) && files.length === 1 &&
          basename(dirname(files[0])) === encoded(actualCwd), {
          error: continued.error, remembered: before.includes(longFact), priorTool: before.includes(longTool),
          destinationTool: after.includes(destinationFact), canonicalToolCwd: after.includes(actualCwd), files,
          requestedCwd, canonicalCwd: actualCwd, expectedKey: encoded(actualCwd) });
        const successor = join(root, `${layout}-successor`); await capture(layoutHome, longInitial.id, successor);
        await rm(layoutHome, { recursive: true, force: true }); await rm(actualCwd, { recursive: true, force: true });
        if (layout === 'canonical-symlink') await rm(requestedCwd);
        const nextHome = join(root, `${layout}-next-home`), nextCwd = join(root, `${layout}-next-workspace`);
        await restore(successor, nextHome, nextCwd, longInitial.id);
        responses = ['layout successor complete'];
        const next = await invoke(`${layout}-successor-restored`, nextHome, nextCwd, 'Continue with prior context.', longInitial.id, false, true);
        const history = JSON.stringify(next.requests[0]?.messages);
        check(`claude.${layout}.successor-context`, !next.error && history.includes(longFact) && history.includes(longTool) && history.includes(destinationFact), {
          error: next.error, remembered: history.includes(longFact), priorTool: history.includes(longTool), destinationFact: history.includes(destinationFact) });
      }
      check('claude.layout-checkpoint-immutable', sealedLong === digest(JSON.stringify(await inventory(longCheckpoint))), 'Long source checkpoint unchanged through four layouts and successor restores');
    }
    await mkdir(controlledWorkspace, { recursive: true });
    const forbidden = `must-not-read-${randomUUID()}`;
    await writeFile(join(controlledWorkspace, 'forbidden.txt'), forbidden);
    responses = [{ name: 'Read', arguments: { file_path: join(controlledWorkspace, 'forbidden.txt') } }, 'native read guard complete'];
    const blockedRead = await invoke('broker-forced-native-read', join(root, 'broker-forced-read-home'), controlledWorkspace, 'Exercise the native read guard.', undefined, false, true);
    check('claude.broker-native-read-guard', blockedRead.requests.length > 0 && !JSON.stringify(blockedRead.requests).includes(forbidden), { error: blockedRead.error, requests: blockedRead.requests.length });
    responses = [{ name: 'Bash', arguments: { command: 'printf bypass > bypass-marker.txt' } }, 'native bash guard complete'];
    const blockedWrite = await invoke('broker-forced-native-bash', join(root, 'broker-forced-bash-home'), controlledWorkspace, 'Exercise the native write guard.', undefined, false, true);
    const bypassWrote = await access(join(controlledWorkspace, 'bypass-marker.txt')).then(() => true, () => false);
    check('claude.broker-native-bash-guard', blockedWrite.requests.length > 0 && !bypassWrote, { error: blockedWrite.error, requests: blockedWrite.requests.length, markerWritten: bypassWrote });
    responses = [{ name: '$local', arguments: { command: 'printf denied > broker-marker.txt' } }, 'broker denied'];
    const brokerDenied = await invoke('broker-denied', join(root, 'broker-denied-home'), controlledWorkspace, 'Exercise the owning controller denial.', undefined, false, true, false);
    const brokerWrote = await access(join(controlledWorkspace, 'broker-marker.txt')).then(() => true, () => false);
    check('claude.broker-denial', !brokerDenied.error && !brokerWrote && controller.calls.at(-1)?.decision === 'deny', { error: brokerDenied.error, markerWritten: brokerWrote, decision: controller.calls.at(-1)?.decision });
    const deniedWorkspace = join(root, 'denied-workspace');
    responses = [{ name: 'Bash', arguments: { command: 'printf denied > permission-marker.txt', description: 'Fixture permission boundary' } }, 'denied complete'];
    const denied = await invoke('native-permission-denied', join(root, 'denied-home'), deniedWorkspace, 'Exercise manual permission denial.');
    const wrote = await access(join(deniedWorkspace, 'permission-marker.txt')).then(() => true, () => false);
    check('claude.native-permission-denial', !denied.error && !wrote && denied.callbacks.some(c => c.method === 'session/request_permission'), { markerWritten: wrote, permissionRequests: denied.callbacks.filter(c => c.method === 'session/request_permission').length, error: denied.error });
    for (const fault of ['empty', 'corrupt']) {
      const badHome = join(root, `invalid-${fault}-home`), badWorkspace = join(root, `invalid-${fault}-workspace`);
      await restore(checkpoint, badHome, badWorkspace, first.id);
      await writeFile(join(badHome, '.claude/projects', encoded(badWorkspace), `${first.id}.jsonl`), fault === 'empty' ? '' : 'not a native transcript\n');
      responses = ['INVALID TRANSCRIPT MUST NOT BECOME FRESH'];
      const bad = await invoke(`native-invalid-${fault}-resume`, badHome, badWorkspace, 'Continue.', first.id);
      check(`claude.native-invalid-${fault}-load`, Boolean(bad.error) && bad.requests.length === 0, { error: bad.error, requests: bad.requests.length });
    }
    const crashedHome = join(root, 'crashed-home'), crashedWorkspace = join(root, 'crashed-workspace');
    await restore(checkpoint, crashedHome, crashedWorkspace, first.id);
    responses = ['CRASHED QUERY MUST NOT BECOME FRESH'];
    const crashed = await invoke('native-query-crash-reentry', crashedHome, crashedWorkspace, 'Continue after native failure.', first.id, true);
    check('claude.query-crash-reentry', Boolean(crashed.error) && crashed.requests.length === 0, { error: crashed.error, requests: crashed.requests.length });
    responses = ['MISSING RESUME MUST NOT EXECUTE THIS'];
    const missing = await invoke('missing-native-resume', join(root, 'missing-home'), join(root, 'missing-workspace'), 'Continue.', randomUUID());
    check('D04.claude.native-missing-load', Boolean(missing.error) && missing.requests.length === 0, { error: missing.error, requestCount: missing.requests.length });
    const report = { provider: 'claude', root, package: JSON.parse(await readFile(pkg, 'utf8')).version, launcherSha256: digest(await readFile(cli)), checks, runs, brokerCalls: controller.calls, requests: api.requests, endpointErrors: api.errors };
    const diagnosticText = JSON.stringify(report);
    check('claude.fixture-diagnostic-credential-exclusion', !diagnosticText.includes(controller.token) && !diagnosticText.includes('fixture-only'), 'Generated credential sentinels absent from captured fixture diagnostics');
    return report;
  } finally { await api.close(); await controller.close(); }
}
