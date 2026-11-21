import { parseJson } from '../core/json.ts';
// Pinned Claude Code 2.1.328 plain-text MCP overflow records. This transforms
// only native tool-result fields, never arbitrary historical text or commands.
// Filesystem ownership, integrity and finite-byte validation are outer codec
// responsibilities; this is not an untrusted bundle materializer.
export const portableClaudeToolRoot = 'portable-claude-state:tool-results';

export function relocateClaudeToolResults(text: string, fromRoot: string, toRoot: string, files?: ReadonlySet<string>, maxBytes = 256 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || Buffer.byteLength(text) > maxBytes) throw new Error('Claude relocation byte limit exceeded');
  let outputBytes = 0;
  if (!text.endsWith('\n')) throw new Error('Truncated Claude transcript');
  if (!fromRoot || !toRoot || /[\r\n\0]/.test(fromRoot + toRoot)) throw new Error('Unsafe Claude artifact root');
  const referenced = new Set<string>();
  function transform(value: unknown): unknown {
    if (typeof value !== 'string' || !value.startsWith('Error: result (')) return value;
    const match = /^Error: result \([\d,]+ characters across [\d,]+ lines\) exceeds maximum allowed tokens\. Output has been saved to (.+)\.\nFormat: Plain text\n/.exec(value);
    if (!match) {
      // An unrecognized native persisted-output representation must not lose
      // state silently. Ordinary tool errors without artifacts are untouched.
      if (value.includes('Output has been saved to ')) throw new Error('Unsupported Claude persisted output');
      return value;
    }
    const path = match[1];
    if (!path.startsWith(fromRoot + '/')) throw new Error('Claude artifact reference escapes its session');
    const name = path.slice(fromRoot.length + 1);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.txt$/.test(name) || name.includes('..')) throw new Error('Unsafe Claude artifact name');
    if (files && !files.has(name)) throw new Error('Missing Claude tool result artifact');
    referenced.add(name);
    const replacement = toRoot + '/' + name;
    let count = 0, offset = 0;
    while ((offset = value.indexOf(path, offset)) !== -1) { count++; offset += path.length; }
    // Compute JSON-escaped expansion before allocating the relocated string.
    const delta = count * (Buffer.byteLength(JSON.stringify(replacement)) - Buffer.byteLength(JSON.stringify(path)));
    if (!Number.isSafeInteger(outputBytes + delta) || outputBytes + delta > maxBytes) throw new Error('Claude relocation byte limit exceeded');
    outputBytes += delta;
    return value.replaceAll(path, replacement);
  }
  const lines = text.trimEnd().split('\n').map(line => {
    const record = (parseJson(line) as any);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid Claude transcript record');
    outputBytes += Buffer.byteLength(JSON.stringify(record)) + 1;
    if (outputBytes > maxBytes) throw new Error('Claude relocation byte limit exceeded');
    if (record.type === 'user' && Array.isArray(record.message?.content)) {
      record.message.content = record.message.content.map((block: any) => {
        if (block?.type !== 'tool_result') return block;
        if (typeof block.content === 'string') return { ...block, content: transform(block.content) };
        if (Array.isArray(block.content)) return { ...block, content: block.content.map((part: any) =>
          part?.type === 'text' ? { ...part, text: transform(part.text) } : part) };
        return block;
      });
      record.toolUseResult = transform(record.toolUseResult);
      if (record.toolUseResult === undefined) delete record.toolUseResult;
    }
    return JSON.stringify(record);
  });
  return { text: lines.join('\n') + '\n', referenced: [...referenced].sort() };
}
