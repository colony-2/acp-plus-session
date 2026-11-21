# Adapter evidence and probes for portable session continuation

Current test-direction revision: the human requires mock provider APIs, superseding
this approved plan's authenticated-API test prerequisite. Original architecture,
both-provider scope and behavioral expectations remain. See
[qualification.md](qualification.md) and [acceptance.md](acceptance.md) for the
current test mechanism; no authenticated-inference result is claimed.

The accepted feature uses one TypeScript lifecycle/checkpoint core, an owned ACP bridge over a qualified installed direct-core Codex CLI, and the selected upstream Claude ACP adapter. External **and embedded** Codex App Server backends are excluded. Codex 0.112.0 is a probe candidate, not a qualified pin. Native restore safety and permission/tool integration must be established before broader implementation. This document adds implementation detail and verification planning; it reports no new provider success.

## Human direction and existing evidence

Root job `3MLIsDEVyJwBJBmmIEu1IKNASdj` retains creation evidence and the original human request in `review/adapter-findings.md`:

> let's create a new cell called acp-plus-session which is a project that houses app wrappers that support user defined extension of import/export of the session state as an opaque set of files plus json. we'll start by making this work with codex and claude (the c2ops codex cell already has logic that does this if you want to see it). this new adapter will also ideally make everything run local. our goal is it uses the same base adapters used by acpx but with these enhancements.

| Decision | Exact recorded reference | Effect |
| --- | --- | --- |
| Original approval, `accept`, empty feedback | Request `06976dc3-e74d-4708-9f12-64f5da2417a0`, `2026-11-19T21:54:16.368757Z` | Both providers and original B/S/E/P contract. |
| “review the codex op in c2ops cell. it's session carry already works.”, `revise` | Request `7020f346-0dbd-46a3-a797-21360b519ba4`, `2026-11-20T02:43:21.212713Z` | Inspect and credit working carry; retain its useful evidence below. |
| “don't use app servers.”, `revise` | Request `a294a8f7-8e8d-44df-8e4b-bdad6bc22a0a`, `2026-11-20T03:35:13.453969Z` | Supersedes exact Codex-adapter requirement and removes former direct-CLI exclusion. |
| Latest direction, `accept`, empty feedback | Request `5e8ebcee-ea93-40a5-8c68-54cde65fce4d`, submission `24d3488d-ba64-4f8b-97bb-e84683b117d1`, `2026-11-20T04:34:57.757305Z` | Accepts the strict no-App-Server proposal and provider asymmetry. This detail preserves it. |

The latest complete response and receipt were retrieved from this job's `input:collect_user_input` occurrence in direction cycle 3, following the log cursor. No planning session was imported. Root retains coordination and reconciles `PURPOSE.md`'s old exact-adapter sentence. No new cell, ownership transfer, upstream change, or c2ops migration is proposed. The [one-pager](portable-codex-claude-sessions.md) retains Non Goals and scope; all [33 original expectations](acceptance.md) remain verbatim. Additional detail checks strengthen their verification.

## Codex without App Server

The [official non-interactive guide](https://learn.chatgpt.com/docs/non-interactive-mode) documents `codex exec`, JSON events, explicit sandbox/approval settings, and native resume. The [SDK guide](https://learn.chatgpt.com/docs/codex-sdk) documents TypeScript thread resume/configuration. Earlier review used the OpenAI Docs skill. These document public interfaces; they do not prove every binary avoids App Server, provides bidirectional ACP callbacks, or remains supported indefinitely. Direct process ownership keeps shutdown and capture timing in our core; adopting the SDK would add a lifecycle layer without changing its binary backend.

### Exact source findings

| Source and revision | Observed behavior and consequence |
| --- | --- |
| [Codex ACP entrypoint, `ad09e0ead18511a65a0761cac832aa3087219b10`](https://github.com/agentclientprotocol/codex-acp/blob/ad09e0ead18511a65a0761cac832aa3087219b10/src/index.ts) | App Server startup/connection/supervisor/client. Manifest adapter 2.8.0, Codex `^0.170.0`. Excluded; no fallback to it. |
| [Current Codex exec, `a0a30c40e8dbcc44af52e2df64dcce64368d4422`](https://github.com/openai/codex/blob/a0a30c40e8dbcc44af52e2df64dcce64368d4422/codex-rs/exec/src/lib.rs) | Starts `InProcessAppServerClient`. Modern exec command naming does not satisfy the accepted exclusion. |
| [0.162.1, `092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/exec/src/lib.rs); [0.157.1, `36650394c5b38c2990ccf2a3457165ca3e9d9726`](https://github.com/openai/codex/blob/36650394c5b38c2990ccf2a3457165ca3e9d9726/codex-rs/exec/src/lib.rs); [0.148.0, `3ba0f711642a888aec92a611a3f3b2211157ff89`](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/exec/src/lib.rs) | c2ops' tested versions also embed App Server. Their carry results remain valid, but do not qualify these runtimes here. |
| [0.112.0 exec, `0ec16b2d9dd7d92f5661b132afdf4df3abb3d443`](https://github.com/openai/codex/blob/0ec16b2d9dd7d92f5661b132afdf4df3abb3d443/codex-rs/exec/src/lib.rs) | Uses `codex_core::ThreadManager` directly in inspected exec path. Missing native resume lookup can fall through to `start_thread`; headless approval defaults to `Never`. Candidate requires provenance, closure, guarded lookup, and permission probes. No current provider compatibility is established. |
| [0.112.0 TypeScript SDK wrapper, same commit](https://github.com/openai/codex/blob/0ec16b2d9dd7d92f5661b132afdf4df3abb3d443/sdk/typescript/src/exec.ts) | Spawns `exec --experimental-json`, passes resume ID, writes prompt, closes stdin. Configuration/abort support does not supply an ACP reverse-request channel. |
| [Claude entrypoint](https://github.com/agentclientprotocol/claude-agent-acp/blob/80440d8b8294f9d4cd086d7cba39c716107657f0/src/index.ts) and [manifest, `80440d8b8294f9d4cd086d7cba39c716107657f0`](https://github.com/agentclientprotocol/claude-agent-acp/blob/80440d8b8294f9d4cd086d7cba39c716107657f0/package.json) | Adapter 0.109.0, ACP SDK 2.8.0, Agent SDK 0.3.328, Node >=22 are manifest observations, not tested pins. Retain this upstream adapter and qualify actual installed CLI/SDK lifecycle. |

`rust-v0.112.0` resolves from annotated tag object `82df81da4bfc489aee8daaee9044982e73eeac35` to peeled commit `0ec16b2d9dd7d92f5661b132afdf4df3abb3d443`. Registry metadata confirms CLI/SDK 0.112.0 exist; SDK depends exactly on that CLI. CLI optional packages cover Linux/macOS x64/arm64, without proving our platform claims. Upstream artifact: [codex-0.112.0.tgz](https://registry.npmjs.org/@openai/codex/-/codex-0.112.0.tgz), integrity `sha512-zYSfPydyI4c8oyb/A+p4foEkMcmCH3g5HzhFC2A4ReLEzMUddtGalUi6gbjHyTZh5R5FgvUeN72krDZwn97wPw==`. Metadata only was read; tarball/platform binary provenance remains unverified. This is not an acp-plus-session publication.

The [approved question/answer table](portable-codex-claude-sessions.md#key-challengesdesign-questions--answers) preserves alternatives and consequences. No supported historical ACP replacement or tool broker is established; failed feasibility requires local investigation, preserving both providers.

## c2ops Codex session carry: what already works

Inspected HEAD: **`bb30dfcf46980053113ae23e7bef757049208324`**. Its working finite-CLI carry is reusable algorithmic evidence, even though its tested runtime internals are excluded here. All links below pin that inspected tree.

### Source-to-reuse map

| Implementation | What works and what to port |
| --- | --- |
| [`session.go`: prepare/restore](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/session.go#L60) | Fresh private home per invocation; metadata/top-level allowlist, regular-file, SQLite `quick_check`, native-ID and rollout-reference validation; failed restores remove private state. Port ownership and fail-closed staging, separating native identity from checkpoint/branch identity. |
| [`session.go`: export](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/session.go#L198) | Captures `state_5.sqlite`, `thread_history_1.sqlite`, `goals_1.sqlite`, `queue_1.sqlite`, `memories_1.sqlite`; directories `sessions`, `archived_sessions`, `memories`. SQLite `VACUUM INTO` includes committed WAL; rejects unrecognized databases except excluded logs. Port consistent snapshots; derive the candidate layout and session-owned closure. Credentials/config, skills, caches and locks are outside that allowlist. |
| [`session.go`: relocate](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/session.go#L306) | Export copies index, makes validated `threads.rollout_path` relative, clears cwd; restore rewrites private copy to destination. Requires requested native ID and existing regular rollout files; canonicalizes symlinked ancestors. Port validation and copy-only rewriting; never mutate bundle. |
| [`op.go`: Run](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/op.go#L108), [`execute.go`: watchdog](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/execute.go#L147) | Completion before publication; leader wait, process-group descendant cleanup, bounded inherited-pipe draining, timeout/cancellation kill/wait. Failed execution publishes no successor. Port bounded cleanup; prove every writer exited rather than equating group signaling or turn completion with quiescence. |
| [`session_test.go`](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/session_test.go) | Synthetic deleted-source/concurrent branches, branch-successor restore, source immutability, WAL, invalid metadata/databases/paths, outside rollouts, symlinks and failed-run nonpublication. Port fixtures; add envelope limits/hashes, hooks, unrelated-state exclusion and native provider branch/successor chains. Inspected, not rerun. |
| [`execute_live_test.go`](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/execute_live_test.go#L70), [`compatibility_test.go`](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/compatibility_test.go#L16) | Real CLI/deterministic Responses-SSE mock; remove source, move workspace, assert original conversation reaches provider request and shell uses new cwd. Full op freezes/hydrates real object storage and exports successor. Port request-history assertions, adding withheld random fact, prior tool-result recall and native successor restoration for both providers. |

The op's `c2ops.codex.session/v1` draft has metadata plus a named `home`; C2 freeze/hydration supplies its object transport. This TypeScript product owns its envelope, integrity/limits and immutable directory publication without C2 runtime services. Do not reuse [`command.go`](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/pkg/codex/command.go)'s approval/sandbox bypass or Nix/download launchers. The [migration guide](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/MIGRATION_OBJECT_SESSIONS.md) also documents private restores, explicit checkpoint forwarding, credential/config exclusion and invalid-state failure.

### Recorded working evidence

These are owner-recorded outcomes, not new executions. Report links pin the inspected tree; execution baselines are separately recorded below.

| Exact report | Execution baseline/platform | Recorded outcome |
| --- | --- | --- |
| [20-version experiment](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/compatibility-results/2026-10-09/results.json) | `36a5e2b6b81f8d1e97bec586c21151ae0516e071`; Linux aarch64; real CLI/local mock, version-response shim | Basic flow passes all 20 sampled releases .143–.162. Complete carry passes 15 sampled releases .148–.162. Five earlier exports fail missing `thread_history_1.sqlite`: actual failures, not unavailable authentication. |
| [Minimum same-version](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/compatibility-results/2026-10-09/minimum-148/results.json) | `0a5d9ec36c87a6d81b9055140ff4cfada6dd3f33`; Linux aarch64 | 0.148.0, 0.157.1, 0.162.1 each report configured skill/tool, remembered relocated resume and full Run→RunSkill carry/successor export: nine `works` outcomes. |
| [Upgrade](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/compatibility-results/2026-10-09/minimum-148/to-0.162.1/results.json) | Same baseline/platform | Producers .148/.157 → .162: two full-op `works` outcomes. |
| [Downgrade](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/compatibility-results/2026-10-09/minimum-148/to-0.148.0/results.json) | Same baseline/platform | .162 → .148: one full-op `works` outcome; not universal layout compatibility. |

The baseline tests delete source state/invocation, hydrate in a relocated worktree, assert native ID, assert initial conversation reaches the provider, check shell cwd and require successor export. Their assertion is stronger than the mock emitting a prearranged answer. Full native successor restoration remains new work; the existing branch-successor restore is synthetic.

Provenance limits remain consequential. [`CLI_COMPATIBILITY.md`](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/CLI_COMPATIBILITY.md) says x86_64 in prose; every inspected JSON says **aarch64**, so no x86 claim follows. Minimum reports label unaltered version checks, but their tracked baseline still requires exactly .157.1 and always shims `--version`; no working-tree diff accompanies them. Current bb30 source implements minimum/actual-version policy. Credit working carry without treating the baseline hash as sufficient reproduction provenance. Reports omit Go/Node/package-manager versions and complete invocation text.

Documented reproductions from `codex/`, not historical command logs or runs performed here:

```sh
python3 scripts/compatibility_matrix.py --versions 0.148.0 0.157.1 0.162.1 --output /tmp/codex-same-version
python3 scripts/compatibility_matrix.py --versions 0.148.0 0.157.1 --resume-version 0.162.1 --output /tmp/codex-upgrade
python3 scripts/compatibility_matrix.py --versions 0.162.1 --resume-version 0.148.0 --output /tmp/codex-downgrade
```

The [matrix script](https://github.com/colony-2/c2ops/blob/bb30dfcf46980053113ae23e7bef757049208324/codex/scripts/compatibility_matrix.py) builds Go tests/provisions packages. Its provisioning is not a product startup pattern.

## Focused probes before product implementation

Use disposable private homes and installed dependencies. Record file inventories before/after turns, shutdown, restore and successors; descendant identities, argv, exit/reap timestamps and bounded sanitized traces. Source audit alone does not prove runtime behavior.

| Gate | Required evidence |
| --- | --- |
| Backend | Exact source/platform-binary provenance plus native dispatch audit and process tree: neither embedded nor external App Server. |
| Codex | Actual state/schema closure; guarded lookup, missing/corrupt state and re-entry; supported callbacks/permissions with no native bypass. |
| Claude | Private `CLAUDE_CONFIG_DIR`, related/subagent closure; lossy cwd encoding, 200-character prefix/hash, canonicalization/macOS normalization; initial load and later query recreation fail closed. |
| Shutdown/isolation | Every writer/tool reaped before capture; crash/timeout/cancel/inherited-pipe faults; credential/config/cache/lock/unrelated sentinels excluded; existing user home unchanged. |
| Carry chain | Each provider: deleted source, relocated withheld context and prior tool result, destination tool, divergent branches, successor export, branch deletion and native successor restoration. |

Unsupported layout fails before hooks/native launch. Missing guard/callback mechanisms are failed feasibility, not unavailable authentication. Do not implement broad APIs assuming these gaps are solved.

## Implementation detail

These are proposed implementation contracts, conditional on probe success. Filenames/API names below are planned, not existing code. No product implementation is part of this preparation.

### Boundaries and entrypoints

| Boundary | Responsibility and proposed surface |
| --- | --- |
| `src/core/` | Serialized lifecycle, operation admission, cancellation, writer ownership, staging, validation, hooks and publication. Sole authority for making a session usable. |
| `src/providers/codex.ts`, `claude.ts` | Versioned codecs: inspect native identity/layout, derive allowlisted closure, capture consistently, relocate copies and verify safe intended load. Codex native driver additionally translates ACP; Claude driver forwards selected upstream ACP. Codec output still passes common validation. |
| `src/index.ts` | Separate `createSession(options)` and `restoreSession(checkpoint, options)`; both require provider/workspace/local configuration. Session exposes `prompt`, `exportCheckpoint`, `resume`, `close` and lifecycle events, with AbortSignal support. Restore never calls create on error. |
| `src/cli.ts` | `acp-plus-session stdio --provider … --workspace …` serves ACP. `run --new` or `run --restore <dir>` admits a finite prompt from `--prompt-file`, optionally `--export <new-dir>`. Mutually exclusive create/restore modes prevent accidental fresh fallback. CLI invocations own no persistent daemon. |
| `src/acp/` | Same core behind standard ACP sessions and negotiated checkpoint export/restore/resume. Restore creates a new private branch/session ID; never replaces an existing live instance. Capability/method constants and errors are frozen against the selected SDK by wire fixtures before implementation is advertised. |

Keep wrapper instance, ACP session, native conversation, checkpoint, and branch lineage IDs distinct. Native IDs may be retained across isolated branches; mutable homes cannot be shared. Credentials and tool registrations are supplied locally per instance, not recovered from a bundle. Standard new sessions remain explicit operations.

Resolve executable/module paths from the installed locked dependency set, without a shell. Validate actual versions/digests and supported producer→consumer layout/platform pairs before creating state. Ship exact package pins and lock data, including runtime/platform optional packages and any SQLite/publication helper. An environment-selected executable must satisfy the same checks; PATH/name/version output alone is insufficient. Install-time provisioning is separate from session startup. Missing dependencies fail without `npx`, installers, forked runtimes or downloads.

### Lifecycle and admission

| State | Admitted action / transition |
| --- | --- |
| Restoring | Validate, stage, relocate and establish safe intended native load; no public handle or user prompt. Success → Idle; failure → cleanup with restore error. |
| Idle | Prompt → Running. Export may atomically close admission → Stopping only when no turn, background work, permission request or client tool is outstanding. |
| Running | Stream events/reverse calls; export returns busy without altering the turn. Completion plus settled callbacks → Idle; cancellation waits for bounded cleanup. |
| Stopping / Capturing | Reject prompts, imports into that instance, duplicate exports and resume. Stop/reap writers, capture, hooks, validate, publish. Control transport stays alive. |
| Stopped | Export outcome delivered; prompts return explicit stopped error. Explicit resume revalidates native state and safely reloads → Idle. Failed export after stopping also stays stopped. |
| Faulted / Closed | No capture or implicit restart. Cleanup remains idempotent; failed reaping makes the operation fail. Close never publishes. |

Use one per-instance admission mutex and activity counters for turns, reverse calls, permissions, client tools and asynchronous writers. Do not hold the mutex while awaiting client responses; reserve the operation then settle by token/generation. This avoids callback deadlocks and prevents a late response reviving canceled work. Export checks activity and changes state in the same critical section. Cancellation addresses its request, not unrelated ACP sessions; connection loss cancels owned work. Repeated close/cancel waits for the same cleanup task.

The lifecycle is conservative after uncertainty: no inferred restart after failed export/resume, no post-error capture of potentially live state. Preserve stopped state for explicit recovery where safe; if private state is invalid, require an explicit restore or create operation rather than silently making a conversation.

### Restore transaction and native guard

1. Resolve installed dependencies and compatibility; bound manifest parsing. Validate all required features/extensions, inventory, hashes, path/kind/mode/limit rules and local hook availability before hooks/native launch.
2. Materialize validated bytes into a new owner-private staging home. Copy/hash through safely opened regular files; reject changes, links and aliases. Revalidate staged inventory so a changed source cannot substitute unchecked bytes. Never launch against the source bundle or user home.
3. Relocate only copied provider indexes/transcripts to canonical destination roots; validate native ID and all referenced state again. Run trusted import hooks in sorted extension-ID order, confined to their namespaces. Revalidate outputs and provider closure.
4. Establish a supported guarded exact-session load. No user prompt/tool work is released until fresh fallback is impossible. For 0.112.0, prove the lookup guard covers native no-path/error branches under exclusive ownership; a later ID check is only additional evidence. If the native interface cannot guarantee this ordering, it is disqualified, not patched around with a new conversation.
5. Expose Idle only after safe-load verification. On any failure cancel, stop/reap, discard private staging and return typed restore failure. Apply the same guard on resume and Claude query recreation. No replayed client history substitutes for native continuation.

### Export transaction and process ownership

1. Reserve export from Idle; reject busy activity without stopping it. Seal prompt/callback admission for that instance and record operation generation.
2. Ask drivers to stop, settle tools, terminate descendants and wait/reap. Bound graceful exit, forced termination and inherited-pipe draining. An exited leader or sent signal does not prove quiescence; unaccounted writers fail capture. Do not kill unrelated user processes. The wrapper's ACP control transport remains open.
3. Capture provider closure into destination-filesystem staging. Consistently snapshot any SQLite/WAL state using a qualified installed SQLite facility; validate snapshots with `quick_check`. Unknown native databases/layouts fail, rather than being silently dropped. Rewrite only exported copies to relative roots.
4. Run export hooks after writer exit; validate complete provider/extension inventory, unknown optional retention, sizes and hashes. Seal immutable manifest/payload. No publication on hook, capture, timeout or validation failure.
5. Publish once with atomic **no-replace** semantics; report complete checkpoint reference/digest or typed failure. Remain Stopped after every post-shutdown outcome. Explicit resume is required even if publication failed. Cancellation after the commit point reports the committed result rather than falsely claiming rollback.

Track adapter/SDK/CLI, broker and tool descendants, including surviving children and inherited pipes. Platform harnesses prove cleanup. Reject detached-writer configurations without ownership guarantees; confirm external client tool completion before capture.

### Envelope, limits and atomic publication

A versioned `manifest.json` records provider/native identity, format/features, actual producer versions, checkpoint/parent identity, application JSON, extension IDs/versions/required flags, and relative inventory paths, kinds, supported modes, byte sizes and SHA-256 payload hashes. Hash regular files; inventory directories explicitly. Return the finalized manifest digest with the checkpoint reference. Hashes detect damage, not sender identity. No signature/authenticity promise is added.

Preserve unknown application JSON semantically and opaque binary bytes exactly; optional unknown extensions stay inactive with a notice and re-export unchanged. Unknown required features/versions fail. JSON duplicate keys and ambiguous inventories fail; do not canonicalize opaque JSON into lossy types. Reserve provider/application/extension namespaces; extension IDs map to validated directories, never raw path concatenation.

Initially accept regular files/directories only; reject symlinks, hard-link aliases, devices, sockets and FIFOs. Validate relative normalized paths and destination filesystem case/Unicode collisions before materialization. Canonicalize workspace/private roots and symlinked ancestors, verify containment using opened entries and recheck through capture. Existing workspaces are user-supplied, not part of checkpoints. Keep provider homes/manifests private (directories 0700, files at most 0600); preserve supported executable bits only in payloads where the codec declares them, with owner-only access. Strip ownership/setuid/setgid and reject unsafe mode requests. Record platform-specific mode support explicitly.

Initial configurable budgets: manifest 1 MiB, JSON depth 64, 50,000 inventory entries, 256 MiB per file, 2 GiB aggregate payload, hook JSON 1 MiB, diagnostic tail 64 KiB per process. Stream with backpressure; count actual bytes while reading/copying/hashing and enforce namespace/aggregate limits on hook files too. Start with 30-second hook deadlines, 10-second graceful shutdown, 10-second forced-exit wait and 2-second pipe drain. Test each boundary and make probe-driven default changes explicit before qualification. Overrides remain finite; exceeding limits returns a specific error and removes staging.

A plain Node rename/check-then-rename is insufficient for concurrent no-replace directory publication. Qualify a small packaged OS primitive/helper using Linux `renameat2(RENAME_NOREPLACE)` and macOS exclusive rename where supported, installed with the distributable. Do not depend on runtime compilation/download. If the platform/filesystem cannot provide the guarantee, fail explicitly. Stage alongside destination; never copy across filesystems as a publication fallback. Crash/kill tests cover staging, sealing and commit; concurrent publishers yield one winner and conflict losers, preserving earlier destinations. Flush files/manifest and parent metadata where supported; do not claim untested power-loss/network-filesystem durability. A crash after commit may leave a valid checkpoint without a delivered result; recovery validates it, never overwrites it.

### Hooks, local callbacks and ACP

Trusted local registration supplies ID/version, command argument array, schema and deadline. Bundles contain data only. Required-hook resolution happens before startup; both phases run deterministically by ID in separate namespaces with bounded IO and process cleanup. Any required missing/incompatible registration or hook failure aborts. Hook output cannot mutate provider namespaces or publish a checkpoint itself. External side effects of trusted programs are not transactional; automatic retries and exactly-once claims are excluded. Built-in provider exports omit credentials/config, caches, locks and unrelated sessions; trusted custom hooks are user code and must not be described as a general secret scrubber.

Keep ACP request IDs and reverse-request correlation separate for client/adapter directions. Preserve session IDs, update ordering, streaming/backpressure and error/cancellation semantics. Stdout contains ACP only; diagnostics go to bounded stderr. Advertise checkpoint extensions only after negotiation and implemented capability checks; ordinary clients still chat. Extension restore is isolated, export result/error precedes any control close, and racing prompts/restore into the exporting instance are refused. Freeze concrete extension wire names against the pinned ACP SDK; do not reuse standard methods for different semantics.

The embedded library/CLI client implements declared filesystem/terminal callbacks on the same host. Forwarded ACP uses the connected client's routing and must not be called local when remote. No advertised callback without a handler; no permission grant until the actual client decision. Denial, absent handler, timeout, disconnection or cancellation cannot execute the operation. Clear pending grants/handles on stop/restore; scope approvals to the current operation, and ignore late responses after cancellation. Codex's supported integration and prevention of native bypass remain first-gate questions; this design does not assume a broker already solves them.

## Verification, publication, and current outcomes

Own tests, fixtures, deterministic provider endpoints, platform/process/atomic-publication harnesses, packaging, docs and `.c2/recipes/hooks/build/verify.yaml` here. That proposed candidate hook must consume the exact candidate revision/artifact and return a nonzero result for failed required behavior. No narrowing capabilities or omitting a provider to make it green. The [test contract](acceptance.md) names original and additional checks with dependencies.

### Candidate checks using pre-merge evidence

Planned commands, not available commands or completed runs in this purpose-only checkout:

```sh
npm run probe -- --provider codex --report artifacts/probe-codex.json
npm run probe -- --provider claude --report artifacts/probe-claude.json
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm pack --json
npm run test:consumer -- --artifact <candidate-tarball>
npm run test:acceptance -- --artifact <candidate-tarball>
```

Run probes first. The acceptance contract defines Vitest fixtures, race barriers and real platform checks. Only qualified OS/architecture/dependency combinations enter the support matrix; authentication is separately injected.

Build/pack once from the exact candidate, record digest and package inventory, and install into clean library and CLI consumer projects with the locked dependencies already provisioned. Neither consumer may resolve source-tree modules or workspace symlinks. Run ESM import, documented library flow, packaged CLI help/stdio/run, and both-provider full carry chains through the installed artifact. Deny package-manager invocation/runtime download while allowing explicitly configured provider endpoints. Run unmodified acpx against both wrappers. Compare public exports/bins, license/docs, hook configuration, fixtures and declared platform dependencies with the packed inventory.

Evidence records candidate commit/dirty diff; package version/digest; adapter/SDK/CLI/helper source revisions, installed versions/digests; Node/npm, OS/architecture/filesystem; exact argv/cwd, sanitized environment, test IDs, exit codes, bounded traces and continuation/cleanup assertions. The hook rejects stale candidate identities/digests. Source-only, c2ops or different-tarball results cannot replace consumer acceptance. Later changes invalidate affected evidence.

### Actual publication assessment

After the authorized publication step, fetch the actual registry/release artifact by exact version/integrity, verify its source association and compare candidate contents. Repeat isolated library/CLI consumers and both-provider source-deletion/relocation, branches, successor export/restoration checks using that published artifact and fresh private state. Record real package URL, version, integrity, release/tag/source references, platform/dependency versions, commands and outcomes. A URL to an upstream dependency or a successful publish command does not satisfy P02. Mismatched bytes require investigation/revalidation. Do not report release success until published checks pass; if publication or authentication is unavailable, identify the outstanding assessment honestly.

| Evidence status | Meaning |
| --- | --- |
| Passed | Actual named check passed on recorded artifact/platform/dependencies. Mock, authenticated and platform results are separately labeled. |
| Failed | Required behavior was attempted and failed, including unsupported callback/guard behavior. Blocks the affected acceptance claim. |
| Unavailable | A required authenticated/platform check could not run because its prerequisite was unavailable. No pass or release-complete claim follows. |
| Not run | Unattempted check, including all new product runtime/consumer/publication checks in this preparation. |

### Inspection outcomes retained and current

Checkout `2fd3fc9d03bed8d820ca0c2c869f4c45a327ab4a` is clean and contains only `PURPOSE.md`; no applicable `AGENTS.md`. Inbox has these three documents and no errors/hooks/feedback/children. Earlier host inspection: Linux `6.11.11-linuxkit aarch64`, Node `v24.22.3`, npm `11.19.1`; Go/Codex absent on PATH.

Earlier evidence came from `git ls-remote`, exact raw source reads, `rg`/`sed`, JSON parsing and read-only npm metadata. Official docs fetched using `urllib.request.urlopen` redirected to the cited guides; failed search/helper URLs (404) support no capability claim. c2ops tests/reports were inspected, not rerun. `c2j cells` returned `Error: JobDB runtime URL is required`; no missing registration inferred.

This preparation inspected selected documents, `c2j self`, paginated job log and complete acceptance response/receipt. It changes review documents only. Both-provider runtime feasibility, authenticated/platform checks, candidate consumers and publication remain **not run**. No wrapper publication reference exists. Delivery starts with the focused probes.

Preparation validation confirmed unchanged original rows, 61 statements of at most 23 words, preserved attachment identities/titles, valid local links/anchors and metadata, and a complete collection below the 65,536-byte JSON presentation limit. This validates documents only.
