# acp-plus-session

A TypeScript candidate for portable Codex and Claude conversations, with library,
CLI and ACP stdio entrypoints. This is **not a release-qualified version**.
Required provider tests use local mock APIs under the latest human direction;
actual-published acceptance has not run. The
[61 acceptance expectations](docs/acceptance.md) remain required.

The shared core owns lifecycle, validation, hooks, isolated restores and atomic
publication. Codex uses the installed **0.112.0 direct-core CLI** through our ACP
bridge; Claude uses the unchanged upstream **claude-agent-acp 0.109.0**, Agent SDK
**0.3.328** and Claude Code **2.1.328**. Neither external nor embedded Codex App
Server is used. The accepted exception and source evidence are in
[the approved design](docs/adapter-probes-and-design.md).

The current candidate requires **Linux arm64, Node 24.22.3 and pnpm 12.21.0**.
The accepted scope excludes macOS and other unqualified platforms; startup fails
explicitly there. These are candidate qualification bounds, not
a claim about authenticated inference. Installed native runtimes are checked by
version and SHA-256 before creating private state. Startup never runs installers
or downloads a runtime. Install dependencies separately; both pinned native runtimes are required
production dependencies for this Linux arm64 package. `dependency-lock.yaml` in the tarball records the tested closure.

```sh
pnpm install --frozen-lockfile --ignore-scripts
node scripts/check-project-dependencies.ts
node scripts/build-native.ts
pnpm run typecheck
pnpm run test:codecs
pnpm run test:core
pnpm run test:qualification
pnpm run build
pnpm pack --pack-destination artifacts
node scripts/consumers/run.ts --artifact artifacts/acp-plus-session-0.1.0-candidate.0.tgz
```

Build compiles the TypeScript and platform helpers into the distributable;
startup does not compile them. The package remains private pending acceptance.
All implementation stays in this repository; the managed recipe owns merge and
publication. No wrapper publication reference exists yet.

## Library

```ts
import { createSession, restoreSession } from 'acp-plus-session';

const session = await createSession({
  provider: 'codex',
  workspace: '/absolute/existing/workspace',
  connection: { apiKey: process.env.OPENAI_API_KEY },
  onUpdate: async update => { /* deliver ACP updates */ },
  // Supply permission(params, signal) to make explicit per-call decisions.
  // Without a handler, tool requests are denied.
});
try {
  await session.prompt('Remember the conversation context.');
  const checkpoint = await session.exportCheckpoint('/private/checkpoints/first');
  // Export stopped and reaped writers. The session is now stopped.
  await session.resume();
} finally {
  await session.close();
}

const branch = await restoreSession('/private/checkpoints/first', {
  provider: 'codex',
  workspace: '/a/relocated/workspace',
  connection: { apiKey: process.env.OPENAI_API_KEY },
});
try { await branch.prompt('Continue with the earlier context.'); }
finally { await branch.close(); }
```

Select `claude` and supply `ANTHROPIC_API_KEY` for Claude. `connection.baseUrl`
configures a provider endpoint root; Codex appends `/v1`. Codex's current trusted
catalog supports `gpt-5.3-codex`; other models are not silently substituted.
Credentials, workspace contents and external tools are supplied separately.
Restores use fresh private homes, never an ambient agent home. Missing, corrupt,
unsupported or empty restore inputs fail; restore never switches to creation.

Export rejects outstanding turns, permissions, client tools or writers. Once
shutdown begins, capture/hook/publication failure also leaves execution stopped.
Explicit resume revalidates the intended native identity. An unconfirmed writer
exit makes the instance unusable for capture. Cancellation before commit removes
staging; cancellation after commit returns the committed reference. A crash
around commit can leave a complete checkpoint without a delivered response.
Existing destinations are never replaced.

## CLI and ACP

```sh
# Tool requests are denied unless you explicitly choose --allow-tools.
acp-plus-session run --new --provider codex --workspace /work/project \
  --prompt 'Remember our context' --export /private/checkpoints/first
acp-plus-session run --restore /private/checkpoints/first --provider codex \
  --workspace /work/relocated --prompt 'Continue with prior context'
acp-plus-session acp --provider claude
```

Create and restore modes are exclusive. CLI credentials come from
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Diagnostics use stderr; ACP stdout contains
only protocol frames. Ordinary ACP clients can initialize, create, prompt,
cancel and select the default mode without checkpoint negotiation. Forwarded
filesystem/terminal callbacks run on the connected client host; embedded library
and `run` callbacks run locally. Missing capabilities are not advertised to the
backends. Every execution requires an actual client permission decision.

To negotiate checkpoints, send initialize `_meta` with
`{"acp-plus-session/checkpoint":1}`. The matching agent capability lists:

- `_acp_plus_session/export`: `{sessionId,destination}` → checkpoint reference.
- `_acp_plus_session/restore`: `{checkpoint,cwd,mcpServers:[]}` → isolated session.
- `_acp_plus_session/resume`: `{sessionId}` → explicit guarded resume.

Export reports its outcome on the live control transport. Racing prompts fail.
Restore creates a branch; it cannot replace an existing session. Unnegotiated
extension calls fail. Standard `session/load` is not advertised; portable restore
uses the negotiated method. HTTP/SSE MCP transports are not advertised. Configured
stdio MCP servers are proxied through the same permission boundary and process
owner; their commands and credentials are never restored from a checkpoint.

## Local extension hooks

Library `hooks` registrations provide an ID, exact version, required flag,
absolute command/argument array, deadline and `validate(data)` function. CLI
`--config /path/to/local.json` registers hooks with JSON schemas compiled by
pinned Ajv 8.20.0. A local configuration can also provide `application` JSON and
`mcpServers`. For example:

```json
{
  "application": {"ownerDefined": true},
  "hooks": [{
    "id": "app.scratch",
    "version": "1",
    "required": true,
    "command": ["/usr/local/bin/my-checkpoint-hook"],
    "deadlineMs": 30000,
    "schema": {"type": "object"}
  }]
}
```

The hook receives one JSON input `{phase,id,version,data}` on stdin and returns
one JSON value on stdout. Its cwd is its own `extensions/<id>` staging namespace.
Hooks run by sorted ID after writer shutdown on export and after native-state
validation on import. The default deadline is 30 seconds. Hook failure, invalid
output or namespace mutation aborts the transaction. Missing/incompatible required
hooks fail before startup. Unknown optional state remains inactive, produces a
notice and retains its JSON and files through re-export.

Commands and schemas come only from trusted local registration. Checkpoint data
cannot register commands. Hooks are trusted user programs, not an OS sandbox;
external side effects cannot be rolled back or promised exactly once. Built-in
provider exports exclude authentication/configuration, logs, caches, locks and
unrelated conversations. Custom programs and intentionally supplied conversation
content are not subject to a general secret-scrubbing promise.

## Validation and evidence

The envelope inventories every payload entry with private mode, size and SHA-256.
Validation rejects duplicate JSON keys, aliases, links/special files, namespace
escapes, unsupported formats/features, extra/missing bytes and corruption before
hooks or native startup. Arbitrary application numeric JSON is retained without
rounding. Defaults: 1 MiB manifest and hook JSON, depth 64, 50,000 entries,
256 MiB per file and 2 GiB aggregate payload. Reads, hashing and copying enforce
finite budgets. Files/directories are owner-private; supported application
executable bits are retained. Hashes detect damage, not sender identity.

Descriptor-relative POSIX reads prevent ancestor substitution from redirecting
copies. Local filesystem callbacks also open canonical path components without
following substituted links; terminal startup holds its workspace directory open. The packaged publisher uses `renameat2(RENAME_NOREPLACE)`; unsupported
filesystems fail. The packaged subreaper confirms all owned descendants were
waited for, including detached TERM-ignoring writers, and handles parent death.
No power-loss or network-filesystem durability claim is made.

Provider probes retain four actual raw-backend failures: Codex missing-resume
fallback, native image permission bypass, incomplete tool removal by flags alone,
and Claude Read not using the advertised filesystem callback. The product uses
guarded re-entry, a trusted Codex catalog, supported Claude tool restrictions and
an owning client callback broker. Raw failures remain evidence; they are not
relabeled as successful native behavior.

The consumer harness installs the actual tarball in an independent project with
preinstalled dependencies and offline installation. It checks library/CLI/ACP
carry after source-state deletion and relocation, independent branches, successor
restoration, permissions and cleanup. It also uses an unmodified pinned acpx
client. The distributable embeds its source and lockfile build identity. Structured reports identify the tested source, artifact, versions,
platform, commands and outcomes. These fixture checks do not substitute for
actual-published acceptance or authenticated inference. See
[qualification stages](docs/qualification.md).
