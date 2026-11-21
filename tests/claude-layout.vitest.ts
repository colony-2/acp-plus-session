import { expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { claudeProjectKey } from '../src/providers/claude-layout.ts';

test('lookup agrees with the installed SDK at the prefix boundary and for UTF-16 paths', async () => {
  const requireAdapter = createRequire(import.meta.resolve('@agentclientprotocol/claude-agent-acp'));
  const entry = requireAdapter.resolve('@anthropic-ai/claude-agent-sdk');
  expect(JSON.parse(await readFile(join(dirname(entry), 'package.json'), 'utf8')).version).toBe('0.3.328');
  const sdk = await import(pathToFileURL(entry).href);
  const cases = ['/tmp/a_b-c.d', '/tmp/é', '/tmp/e\u0301', '/tmp/😀',
    '/' + 'a'.repeat(199), '/' + 'a'.repeat(200), '/' + 'a'.repeat(201),
    '/tmp/' + 'α😀é'.repeat(100), '/tmp/' + 'a'.repeat(300), '/tmp/' + 'a'.repeat(299) + 'b'];
  for (const dir of cases) {
    const observed: { projectKey: string }[] = [];
    await sdk.getSessionMessages('4dc9bffc-1d43-4142-8a5b-576985791162', {
      dir, sessionStore: { append: async () => {}, load: async (key: { projectKey: string }) => { observed.push(key); return null; } }
    });
    expect(observed, dir).toHaveLength(1);
    expect(claudeProjectKey(dir), dir).toBe(observed[0].projectKey);
  }
  // The suffix disambiguates paths whose encoded first 200 characters match.
  expect(claudeProjectKey(cases[8])).not.toBe(claudeProjectKey(cases[9]));
});

test('lookup refuses relative paths and embedded NUL', () => {
  expect(() => claudeProjectKey('relative')).toThrow();
  expect(() => claudeProjectKey('/tmp/a\0b')).toThrow();
});
