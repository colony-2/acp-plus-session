import { parseJson } from '../core/json.ts';
// Validate the observed 2.1.328 related-transcript representation. Callers own
// byte budgets, private files and stopped writers. No bundle commands execute.
export function inspectClaudeRelated(main: string, sessionId: string, files: ReadonlyMap<string, string>) {
  const agents = new Map<string, { transcript: string, metadata: string }>();
  for (const name of files.keys()) {
    const match = /^agent-([a-zA-Z0-9_-]{1,128})\.(jsonl|meta\.json)$/.exec(name);
    if (!match) throw new Error('Unsupported related Claude state file');
    agents.set(match[1], { transcript: `agent-${match[1]}.jsonl`, metadata: `agent-${match[1]}.meta.json` });
  }
  const launches = new Map<string, Set<string | null>>();
  const results: { agentId: string, owner: string | null, toolIds: string[] }[] = [];
  function records(text: string, agentId?: string) {
    if (!text.endsWith('\n')) throw new Error('Truncated related Claude transcript');
    let identified = !agentId;
    for (const line of text.trimEnd().split('\n')) {
      const record = (parseJson(line) as any);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid related Claude record');
      if (record.sessionId !== undefined && record.sessionId !== sessionId) throw new Error('Related transcript session mismatch');
      if (record.version !== undefined && record.version !== '2.1.328') throw new Error('Unsupported related transcript version');
      if (agentId && record.agentId !== undefined && record.agentId !== agentId) throw new Error('Related transcript agent mismatch');
      if (agentId && record.agentId === agentId && record.sessionId === sessionId) identified = true;
      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        for (const block of record.message.content) {
          if (block?.type === 'tool_use' && ['Agent', 'Task'].includes(block.name) && typeof block.id === 'string') {
            const owners = launches.get(block.id) ?? new Set(); owners.add(agentId ?? null); launches.set(block.id, owners);
          }
        }
      }
      if (record.type === 'user' && typeof record.toolUseResult?.agentId === 'string' && Array.isArray(record.message?.content)) {
        results.push({ agentId: record.toolUseResult.agentId, owner: agentId ?? null,
          toolIds: record.message.content.filter((b: any) => b?.type === 'tool_result').map((b: any) => b.tool_use_id) });
      }
    }
    if (!identified) throw new Error('Unidentified related Claude transcript');
  }
  records(main);
  const metadata: { id: string, toolUseId: string }[] = [];
  for (const [id, pair] of agents) {
    const transcript = files.get(pair.transcript), meta = files.get(pair.metadata);
    if (transcript === undefined || meta === undefined) throw new Error('Missing related Claude transcript or metadata');
    records(transcript, id);
    const value = (parseJson(meta) as any);
    if (!value || typeof value !== 'object' || typeof value.toolUseId !== 'string') throw new Error('Invalid related Claude metadata');
    // Default-cwd children are qualified here. Worktree placement needs its
    // own relocation proof before the complete codec can support it.
    if (['cwd', 'worktreePath', 'inheritedWorktreePath'].some(key => value[key] !== undefined)) throw new Error('Unqualified related Claude working directory');
    metadata.push({ id, toolUseId: value.toolUseId });
  }
  const parents = new Map<string, string | null>(), usedLaunches = new Set<string>();
  for (const item of metadata) {
    const owners = launches.get(item.toolUseId);
    if (!owners || owners.size !== 1 || usedLaunches.has(item.toolUseId)) throw new Error('Unowned or ambiguous related Claude transcript');
    usedLaunches.add(item.toolUseId); parents.set(item.id, [...owners][0]);
  }
  for (const id of parents.keys()) {
    const seen = new Set<string>(); let current: string | null = id;
    while (current !== null) {
      if (seen.has(current) || !parents.has(current)) throw new Error('Unrooted related Claude transcript');
      seen.add(current); current = parents.get(current)!;
    }
  }
  for (const result of results) {
    if (result.toolIds.some(id => launches.get(id)?.has(result.owner)) && !agents.has(result.agentId)) throw new Error('Missing referenced Claude subagent');
  }
  return [...agents.keys()].sort();
}
