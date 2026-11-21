import { fail } from './errors.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// JSON.parse alone loses duplicate keys before validation can see them.
// This scanner bounds nesting and rejects ambiguous objects, then delegates
// string/number grammar and decoding to the native JSON implementation.
export function parseJson(text: string, maxDepth = 64): Json {
  let at = 0;
  function whitespace() { while (/[\x20\x09\x0a\x0d]/.test(text[at] ?? '') && at < text.length) at++; }
  function string(): string {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    fail('INVALID_BUNDLE', 'Unterminated JSON string');
  }
  function value(depth: number) {
    if (depth > maxDepth) fail('LIMIT', 'JSON nesting limit exceeded');
    whitespace();
    if (text[at] === '{') {
      at++; whitespace(); const keys = new Set<string>();
      if (text[at] === '}') { at++; return; }
      for (;;) {
        if (text[at] !== '"') fail('INVALID_BUNDLE', 'Expected JSON object key');
        const key = string();
        if (keys.has(key)) fail('INVALID_BUNDLE', 'Duplicate JSON object key');
        keys.add(key); whitespace();
        if (text[at++] !== ':') fail('INVALID_BUNDLE', 'Expected JSON colon');
        value(depth + 1); whitespace();
        const end = text[at++];
        if (end === '}') return;
        if (end !== ',') fail('INVALID_BUNDLE', 'Expected JSON object separator');
        whitespace();
      }
    }
    if (text[at] === '[') {
      at++; whitespace();
      if (text[at] === ']') { at++; return; }
      for (;;) {
        value(depth + 1); whitespace(); const end = text[at++];
        if (end === ']') return;
        if (end !== ',') fail('INVALID_BUNDLE', 'Expected JSON array separator');
      }
    }
    if (text[at] === '"') { string(); return; }
    const match = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
    if (!match) fail('INVALID_BUNDLE', 'Invalid JSON value');
    const token = match[0];
    at += token.length;
  }
  try {
    value(0); whitespace();
    if (at !== text.length) fail('INVALID_BUNDLE', 'Trailing JSON content');
    return JSON.parse(text, ((_key: string, value: unknown, context: { source?: string }) => {
      if (typeof value !== 'number' || !context?.source) return value;
      const source = context.source;
      // Keep numeric JSON which JS cannot round-trip as an intrinsic raw JSON
      // value. JSON.stringify then preserves its exact token, including inside
      // unknown optional state. Envelope sizes/modes still require safe ints.
      function identity(token: string) {
        const [mantissa, exponent = '0'] = token.toLowerCase().split('e');
        const negative = mantissa.startsWith('-');
        const parts = mantissa.replace('-', '').split('.');
        let digits = (parts[0] + (parts[1] ?? '')).replace(/^0+/, '');
        if (!digits) return '0';
        let power = Number(exponent) - (parts[1]?.length ?? 0);
        while (digits.endsWith('0')) { digits = digits.slice(0, -1); power++; }
        return `${negative ? '-' : ''}${digits}e${power}`;
      }
      if (source.length <= 64 && Number.isFinite(value) && identity(source) === identity(String(value))) return value;
      return (JSON as any).rawJSON(source);
    }) as any);
  } catch (error) {
    if (error instanceof SyntaxError) fail('INVALID_BUNDLE', 'Invalid JSON syntax');
    throw error;
  }
}
export function finiteLimit(value: number, name: string, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('LIMIT', `Invalid finite ${name} limit`);
  return value;
}
