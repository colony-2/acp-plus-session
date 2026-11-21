import { expect, test } from 'vitest';
import { inspectClaudeRelated } from '../src/providers/claude-related.ts';
const line = (x: unknown) => JSON.stringify(x) + '\n';
const main = line({ type: 'assistant', sessionId: 'session', message: { content: [{ type: 'tool_use', name: 'Agent', id: 'launch' }] } }) +
  line({ type: 'user', sessionId: 'session', toolUseResult: { agentId: 'child' }, message: { content: [{ type: 'tool_result', tool_use_id: 'launch' }] } });
const files = () => new Map([
  ['agent-child.jsonl', line({ type: 'assistant', sessionId: 'session', agentId: 'child', version: '2.1.328', message: { content: 'private child context' } })],
  ['agent-child.meta.json', JSON.stringify({ toolUseId: 'launch', finished: true })]
]);
test('related native state requires identity, launch ownership and paired files', () => {
  expect(inspectClaudeRelated(main, 'session', files())).toEqual(['child']);
  expect(inspectClaudeRelated(line({ type: 'user', sessionId: 'session' }), 'session', new Map())).toEqual([]);
  for (const name of files().keys()) {
    const missing = files(); missing.delete(name);
    expect(() => inspectClaudeRelated(main, 'session', missing)).toThrow('Missing');
  }
  expect(() => inspectClaudeRelated(main, 'session', new Map())).toThrow('Missing referenced');
});
test('foreign identities, paths, corrupt data and unsupported placement fail', () => {
  for (const replacement of [line({ sessionId: 'foreign', agentId: 'child' }), line({ sessionId: 'session', agentId: 'foreign' }), 'bad json\n', '[]\n']) {
    const invalid = files(); invalid.set('agent-child.jsonl', replacement);
    expect(() => inspectClaudeRelated(main, 'session', invalid)).toThrow();
  }
  for (const meta of [{ toolUseId: 'unrelated' }, { toolUseId: 'launch', worktreePath: '/outside' }, {}]) {
    const invalid = files(); invalid.set('agent-child.meta.json', JSON.stringify(meta));
    expect(() => inspectClaudeRelated(main, 'session', invalid)).toThrow();
  }
  const invalid = files(); invalid.set('../escape', 'data');
  expect(() => inspectClaudeRelated(main, 'session', invalid)).toThrow('Unsupported');
  const cycle = files(); cycle.set('agent-child.jsonl', cycle.get('agent-child.jsonl')! + line({ type: 'assistant', agentId: 'child', message: { content: [{ type: 'tool_use', name: 'Agent', id: 'self' }] } }));
  cycle.set('agent-child.meta.json', JSON.stringify({ toolUseId: 'self' }));
  expect(() => inspectClaudeRelated(main, 'session', cycle)).toThrow('Unrooted');
});
