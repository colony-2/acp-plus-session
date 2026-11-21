# Portable Codex and Claude sessions through local ACP wrappers

Current test-direction revision: the human requires mock provider APIs, superseding
this approved plan's authenticated-API test prerequisite. Original architecture,
both-provider scope and behavioral expectations remain. See
[qualification.md](qualification.md) and [acceptance.md](acceptance.md) for the
current test mechanism; no authenticated-inference result is claimed.

## Problem Description

Applications need to move conversations and continue remembered context and local tool context. c2ops already demonstrates Codex carry across source deletion and workspace relocation. The instruction **“don't use app servers”** excludes the previously selected Codex ACP adapter.

The accepted **feature direction** is one TypeScript lifecycle/checkpoint core, an owned ACP bridge over an installed direct-core Codex CLI, and the selected upstream Claude ACP adapter. Exclude external and embedded Codex App Server backends. Codex **0.112.0** is a source-backed probe candidate, not a qualified pin; native resume safety and permission/tool integration gate wider implementation.

Direction accepted under request `5e8ebcee-ea93-40a5-8c68-54cde65fce4d` on November 20, 2026. This preparation adds [implementation detail](adapter-probes-and-design.md#implementation-detail) and [test statements](acceptance.md#additional-detail-checks), preserving the approved scope.

## Non Goals

No external/embedded Codex App Server, upstream fork, cross-provider conversion, acpx replacement, repository snapshot, bundled credentials, cloud synchronization, c2ops migration, browser UI, remote execution service, Windows, offline inference promise, or universal OS/version portability. The accepted revision removes the former direct-CLI exclusion. Do not copy c2ops' C2 transport, Go runtime, download launchers or approval bypass. Both providers and all 33 original acceptance expectations remain. Root retains coordination and creation evidence.

## What we are planning to do

1. **Qualify both backends first.** Reuse c2ops' carry algorithms and test patterns, deriving the actual Codex candidate layout. Probe closure, shutdown, guarded native resume, callbacks/permissions, streaming and cancellation; separately qualify Claude. This prevents building around an infeasible replacement.
2. **Share lifecycle and validation.** Validate compatibility, inventories, hashes, paths, modes and finite limits before hooks/startup. Restore into private staging; expose only verified intended continuation. Isolated writable homes make restores independent branches.
3. **Make export a stopping boundary.** Reject busy work; stop/reap writers before capture/hooks. Publish an immutable directory atomically without replacement. Deliver the result over the live control connection and require explicit resume afterward, including failures after shutdown.
4. **Expose library, CLI and ACP stdio.** Preserve standard ACP, permission enforcement and same-host local callbacks, with negotiated checkpoint extensions. Launch pinned installed dependencies without forks or runtime downloads. Shared entrypoints prevent inconsistent failure rules.
5. **Verify actual artifacts.** Own fixtures, platform harnesses, packaging, docs and candidate hook. For both providers prove deleted-source relocated context/tool continuation, independent branches, successor export and native successor restoration. Test candidate-distributable consumers before merge, then repeat against the actual published version with real publication references.

### Expected scope

| Cell | Core code | Tests | Docs |
| --- | --- | --- | --- |
| acp-plus-session | large | large | large |
| root | none | none | small |

Tests include frameworks, fixtures, mocks, platform harnesses and implementations. The approved revision added the owned Codex bridge and expanded docs from medium to large for provider asymmetry, runtime restrictions and compatibility. This preparation makes no further scope change. No acpx, c2ops or upstream edits are planned.

## Compat/Upgrade (what existing users need to do)

Existing acpx/c2ops users need no migration. Adopters select this product's ACP command or library/CLI and install tested dependencies. Codex replaces `@agentclientprotocol/codex-acp`; Claude retains `@agentclientprotocol/claude-agent-acp`. Root reconciles the old exact-adapter promise in `PURPOSE.md`.

Supply credentials, workspace contents and external tools separately. Export requires explicit resume; failed restore never becomes fresh chat. Unsupported versions/formats, required hooks and unavailable capabilities fail explicitly. Ordinary ACP clients need no checkpoint negotiation. Advertise only demonstrated Linux/macOS combinations; no backend pin or wrapper publication is qualified yet.

## Key challenges/design questions & answers

| Question | Answer, alternatives and consequences |
| --- | --- |
| What changed from the original approval? | November 19 selected acpx's exact adapters. The November 20 instruction superseded the Codex adapter/App Server architecture and direct-CLI exclusion; the latest approval accepts that revision. Claude and all 33 expectations remain. [Exact decisions](adapter-probes-and-design.md#human-direction-and-existing-evidence). |
| What does “no app servers” exclude? | Both separate and embedded Codex App Server backends. Modern inspected exec embeds one. Using it requires changed direction; this preparation does not reopen the accepted exclusion. |
| What alternative is supported, and is its runtime qualified? | Official `codex exec` provides finite execution, JSON events and native resume. Published 0.112.0 uses direct core in inspected source, but needs current provider, artifact-provenance and full acceptance checks. Official documentation does not guarantee ongoing support for that old version. The TS SDK uses the same binary. |
| Can both adapters still match acpx? | No: retain Claude's adapter and own the Codex ACP bridge without a fork. Unmodified acpx can use its custom-agent command. No supported historical no-server ACP adapter has been established. |
| What is reusable from c2ops? | Private homes, SQLite/WAL snapshots, native-ID/rollout validation, copy-only relocation, branches and provider-request history assertions at `bb30dfcf46980053113ae23e7bef757049208324`. Its tested runtimes embed App Server, so carry success does not qualify those binaries here. [Sources and working evidence](adapter-probes-and-design.md#c2ops-codex-session-carry-what-already-works). |
| Does the old CLI use c2ops' file set? | Unknown. Derive actual closure; do not assume five databases exist, fabricate them or treat all missing files as optional. c2ops records failed export below .148 for a missing database. This may disqualify the older candidate. |
| How will permissions and tools work without native ACP? | JSONL cannot supply missing reverse requests. First prove a supported local tool integration and prevention of native permission bypass. A stdio tool broker is a hypothesis. E05/E08/E09 remain blocking; auto-approval or read-only-only Codex scope is not accepted. |
| How will failed resume remain fail-closed? | 0.112.0 can fall through from missing lookup to a new thread. Demonstrate guarded exact-session lookup under exclusive state ownership before user execution, including re-entry. A later ID mismatch is insufficient. Reject the backend if supported integration cannot prevent fallback without a fork. |
| What if replacement feasibility fails? | Investigate the concrete limitation locally, record failure and retain both-provider scope. Seek a compatible upstream alternative or changed requirement; do not silently use App Server, fork, weaken acceptance or ship partial Codex behavior. |
| Why one core and two codecs? | Lifecycle, validation, hooks, cancellation and publication must agree across library/CLI/ACP. Codecs own native closure/layout/relocation; Codex additionally owns protocol mapping. Separate lifecycle implementations duplicate failure rules. |
| What does Claude still need? | Qualify private-state closure, related/subagent transcripts, cwd encoding/long-path normalization, writer shutdown, initial load and query recreation failures, branches and native successor restoration. Codex evidence proves none of these for Claude. |
| What is portable and opaque? | A versioned envelope contains native identity, actual producer versions, required features and integrity inventories. Preserve unknown application JSON and binary bytes; only codecs relocate native state. Credentials, workspace contents and live processes remain separate. |
| How is state bounded and isolated? | Validate kinds, hashes, paths, missing/unexpected entries, collisions and finite budgets before hooks/startup. Use private staging; reject links/special files and unsafe modes. Exclude credential/config/cache/lock/unrelated state. Hashes detect damage, not sender identity. [Budgets and mechanics](adapter-probes-and-design.md#envelope-limits-and-atomic-publication). |
| How do export failures and races behave? | Atomically seal admission from idle, reject outstanding work, stop/reap, capture/hooks, then publish with tested no-replace semantics. Preserve older checkpoints. Failure after stopping also requires explicit recovery; uncertain writer exit prohibits capture. Keep control transport alive for the outcome. |
| How are branches and relocation proved? | Fresh private homes, immutable source, withheld remembered and prior tool context, new destination tools, divergent branches, then successor deletion/restoration and another native turn. Existing user homes stay unchanged. Synthetic fixtures or successor export alone are insufficient. |
| How do hooks and optional extensions behave? | Trusted local IDs/versions/argument arrays/schemas/deadlines; deterministic export after shutdown and import before startup. Required-hook failures abort staging. Bundles never supply commands. Preserve inactive unknown optional state with a notice. External hook effects cannot be rolled back or promised exactly once. |
| How are ACP and locality preserved? | Own Codex IDs/events/reverse calls/permissions/cancellation; preserve Claude forwarding. Advertise implemented negotiated extensions and available callbacks only. Embedded-client tools run on the same host; forwarding retains client routing. Model/auth network calls remain possible. Test unmodified acpx with both providers. |
| What remains open before release? | Backend guard/tool feasibility, exact pins/layouts, platform mode/limit qualification and atomic-publication primitives. Detail chooses initial budgets and a platform-helper approach, subject to probes. Candidate checks precede actual-published checks. Failed behavior is failure; unavailable auth/platform checks are unverified; unattempted checks are not run. |
