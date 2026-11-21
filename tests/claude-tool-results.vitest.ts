import { expect, test } from 'vitest';
import { relocateClaudeToolResults, portableClaudeToolRoot } from '../src/providers/claude-tool-results.ts';

const source = '/private/source/projects/project/session/tool-results';
const output = (path: string) => `Error: result (52,143 characters across 4 lines) exceeds maximum allowed tokens. Output has been saved to ${path}.\nFormat: Plain text\nRead ${path} in chunks.\n`;
const native = (path: string) => ({ type: 'user', unknown: { retained: ['opaque', 42] }, toolUseResult: output(path),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: output(path) }] } });
const serialize = (x: unknown) => JSON.stringify(x) + '\n';

test('native output references seal and relocate through a second export, retaining unknown fields', () => {
  const record = native(source + '/result.txt');
  const sealed = relocateClaudeToolResults(serialize(record), source, portableClaudeToolRoot, new Set(['result.txt']));
  expect(sealed.referenced).toEqual(['result.txt']);
  const restored = relocateClaudeToolResults(sealed.text, portableClaudeToolRoot, '/new/session/tool-results', new Set(['result.txt']));
  const actual = JSON.parse(restored.text);
  expect(actual.unknown).toEqual(record.unknown);
  expect(actual.message.content[0].content).toBe(output('/new/session/tool-results/result.txt'));
  expect(actual.toolUseResult).toBe(actual.message.content[0].content);
  const successor = relocateClaudeToolResults(restored.text, '/new/session/tool-results', portableClaudeToolRoot, new Set(['result.txt']));
  expect(successor).toEqual(sealed);
});

test('ordinary user and assistant text containing an artifact-looking string is preserved', () => {
  for (const type of ['user', 'assistant']) {
    const record = { type, message: { role: type, content: [{ type: 'text', text: output(source + '/result.txt') }] } };
    const result = relocateClaudeToolResults(serialize(record), source, portableClaudeToolRoot, new Set());
    expect(JSON.parse(result.text)).toEqual(record); expect(result.referenced).toEqual([]);
  }
});

test('references must identify an inventoried file owned by this session', () => {
  for (const path of ['/etc/secret.txt', source + '/../foreign.txt', source + '/nested/result.txt', source + '/symlink.txt']) {
    expect(() => relocateClaudeToolResults(serialize(native(path)), source, portableClaudeToolRoot, new Set(['result.txt']))).toThrow();
  }
  expect(() => relocateClaudeToolResults(serialize(native(source + '/missing.txt')), source, portableClaudeToolRoot, new Set(['result.txt']))).toThrow('Missing');
});

test('unsupported persisted output and malformed transcripts fail closed', () => {
  const text = serialize(native(source + '/result.txt'));
  expect(() => relocateClaudeToolResults(text.replaceAll('Plain text', 'Unknown encoding'), source, portableClaudeToolRoot)).toThrow('Unsupported');
  for (const input of ['', 'not json\n', text.slice(0, -1), '[]\n']) {
    expect(() => relocateClaudeToolResults(input, source, portableClaudeToolRoot)).toThrow();
  }
});

test('relocation accounts for repeated JSON-escaped expansion before allocating output', () => {
  const text = serialize(native(source + '/result.txt'));
  const target = '/new/' + 'a'.repeat(2048) + '/"quoted"\\root';
  const expected = relocateClaudeToolResults(text, source, target).text;
  expect(relocateClaudeToolResults(text, source, target, undefined, Buffer.byteLength(expected)).text).toBe(expected);
  expect(() => relocateClaudeToolResults(text, source, target, undefined, Buffer.byteLength(expected) - 1)).toThrow('byte limit');
  expect(() => relocateClaudeToolResults(text, source, target, undefined, text.length - 1)).toThrow('byte limit');
});
