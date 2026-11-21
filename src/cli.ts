#!/usr/bin/env node
import { createSession, restoreSession } from './index.ts';
import { loadConfiguration } from './config.ts';
import { serveAcp } from './acp/server.ts';
import type { SessionOptions } from './index.ts';

const args = process.argv.slice(2);
const help = `acp-plus-session run (--new | --restore CHECKPOINT) --provider codex|claude --workspace PATH --prompt TEXT [--export PATH] [--allow-tools] [--config PATH]\nacp-plus-session acp --provider codex|claude [--base-url URL] [--model NAME]\nCredentials: OPENAI_API_KEY or ANTHROPIC_API_KEY, supplied separately.\nExport stops the session; library/ACP callers must explicitly resume it.\n`;
try {
  if (args.length === 0 || args.includes('--help')) { process.stdout.write(help); }
  else {
    const mode = args.shift(); if (!['run', 'acp'].includes(mode!)) throw new Error('Expected run or acp');
    const values = new Map<string, string>(); const flags = new Set<string>();
    while (args.length) {
      const name = args.shift()!;
      if (['--new', '--allow-tools'].includes(name)) { if (flags.has(name)) throw new Error('Duplicate flag'); flags.add(name); }
      else {
        if (!['--provider', '--workspace', '--prompt', '--restore', '--export', '--base-url', '--model', '--config'].includes(name) || values.has(name) || !args.length) throw new Error('Unknown, duplicate or incomplete option');
        values.set(name, args.shift()!);
      }
    }
    const provider = values.get('--provider'); if (provider !== 'codex' && provider !== 'claude') throw new Error('Select --provider codex or claude');
    const connection = { apiKey: process.env[provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'], baseUrl: values.get('--base-url'), model: values.get('--model') };
    const configuration = await loadConfiguration(values.get('--config'));
    if (mode === 'acp') {
      if (flags.size || [...values.keys()].some(k => !['--provider', '--base-url', '--model', '--config'].includes(k))) throw new Error('ACP sessions are created by protocol requests');
      await serveAcp(process.stdin, process.stdout, { provider, connection, hooks: configuration.hooks, mcpServers: configuration.mcpServers });
    } else {
      if (flags.has('--new') === values.has('--restore')) throw new Error('Select exactly one of --new or --restore');
      const workspace = values.get('--workspace'), prompt = values.get('--prompt');
      if (!workspace || prompt === undefined) throw new Error('Provide --workspace and --prompt');
      const controller = new AbortController(); const cancel = () => controller.abort(); process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      const options: SessionOptions = { provider, workspace, connection, ...configuration, signal: controller.signal, onUpdate: async params => { process.stdout.write(JSON.stringify({ type: 'update', ...params }) + '\n'); },
        permission: async params => {
          const option = flags.has('--allow-tools') && params.options?.find((o: any) => o.kind === 'allow_once');
          return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
        } };
      const session = values.has('--restore') ? await restoreSession(values.get('--restore')!, options) : await createSession(options);
      try {
        const result = await session.prompt(prompt, controller.signal); process.stdout.write(JSON.stringify({ type: 'result', ...result }) + '\n');
        if (values.has('--export')) process.stdout.write(JSON.stringify({ type: 'checkpoint', ...await session.exportCheckpoint(values.get('--export')!, controller.signal) }) + '\n');
      } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); await session.close(); }
    }
  }
} catch (error) {
  // Do not print provider configurations, credentials or unbounded traces.
  process.stderr.write((error instanceof Error ? error.message : 'Session operation failed') + '\n'); process.exitCode = 1;
}
