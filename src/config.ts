import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Ajv } from 'ajv';
import { parseJson } from './core/json.ts';
import type { Json } from './core/json.ts';
import type { HookRegistration } from './core/hooks.ts';
import type { McpServer } from './runtime/mcp.ts';
import { fail } from './core/errors.ts';

// Explicit local configuration is trusted registration. Checkpoint manifests
// never enter this loader and cannot provide commands or validators.
export async function loadConfiguration(path?: string): Promise<{ hooks: HookRegistration[]; mcpServers: McpServer[]; application: Json }> {
  if (!path) return { hooks: [], mcpServers: [], application: null };
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let text: string;
  try {
    const st = await file.stat(); if (!st.isFile() || st.size > 1024 * 1024) fail('LIMIT', 'Configuration exceeds supported byte limit');
    let size = 0; const chunks: Buffer[] = [];
    for await (const bytes of file.createReadStream({ autoClose: false })) { size += bytes.length; if (size > 1024 * 1024) fail('LIMIT', 'Configuration grew beyond supported byte limit'); chunks.push(bytes); }
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await file.close(); }
  const config = parseJson(text) as any;
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !['hooks', 'mcpServers', 'application'].includes(k)) || !Array.isArray(config.hooks ?? []) || !Array.isArray(config.mcpServers ?? [])) fail('INCOMPATIBLE', 'Invalid local configuration');
  const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: false });
  const hooks = (config.hooks ?? []).map((hook: any) => {
    if (!hook || typeof hook !== 'object' || !Object.hasOwn(hook, 'schema')) fail('HOOK_FAILED', 'Hook registration requires a local schema');
    let validate: ReturnType<Ajv['compile']>;
    try { validate = ajv.compile(hook.schema); } catch { fail('HOOK_FAILED', 'Invalid registered hook schema'); }
    if ((validate as any).$async) fail('HOOK_FAILED', 'Asynchronous hook schemas are unsupported');
    return { id: hook.id, version: hook.version, required: hook.required, command: hook.command, deadlineMs: hook.deadlineMs, validate: (data: Json) => validate(data) === true };
  });
  return { hooks, mcpServers: config.mcpServers ?? [], application: config.application ?? null };
}
