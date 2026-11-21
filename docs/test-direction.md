# Current direction: Linux-only verification using mock provider APIs

## Human decisions and scope

Accepted direction: `c2566a42-c1bb-4210-ad8b-05b59a0f9e27`, empty feedback, `2026-11-21T05:04:42.260551Z`, submission `5551aef6-3e34-4d20-9b65-ae29457e7924`. Preparation adds mappings/detail, with unchanged scope.

Human removal: “i'mve removing the requirement for thes job to even support macOS.” Request `3be5e26e-00e1-4d3d-8a46-a491d09d2cc6`, submission `48a58ae9-d389-4ec8-811e-0a209e02788f`, `2026-11-21T04:51:32.210742Z`; continued under `afb70d09-0e1c-40fd-95b5-49458fb045a6` at `04:54:05.812655Z`. Darwin is excluded, not an unavailable required check. No platform consultation belongs here.

The separate human direction remains: “the tests should run against a mock api. i believe there are several open source emulators that emulate those systems responses.” Cancelled `3MOBC7YZSI5Ndwb8HhM04S72W96` advised retaining loopback fixtures/request assertions; it supplied no credentials/runners/acceptance. Do not retry or add an unneeded emulator.

## Necessary detail

Keep the existing core: idle/no activity → stop/reap → capture/hooks/validation → no-replace commit → stopped. Busy work rejects export; post-stop failure requires explicit guarded resume. Restore validates private copied closure before hooks/execution and never falls back to creation. Codecs isolate branches and exclude credentials/config/cache/locks/unrelated state.

Use actual binaries against loopback APIs; assert request context and filesystem/process effects. Delete source and branch state, relocate, and run native turns after each successor restore. Fault barriers cover admission, writer exit, copying, hooks and commit. Test below/at/above existing budgets: manifest/hook JSON 1 MiB, depth 64, 50,000 entries, 256 MiB/file, 2 GiB total. Exercise real Linux primitives/privacy; mocks do not establish them.

Prior dirty `3026f008…` and clean `11822b4ea57105012fcf4dc7e77a5155d03e5670` share digest `4fa66c44692320d69770382133abdec2178abc61338d0c07db899547d8c480d7`. Prior passes remain historical. Freeze final docs/version/config before testing; regenerate affected evidence after changes. Record exact source/lock/artifact identities, runtime/helper versions/hashes, OS/kernel/filesystem, tools, argv/cwd, timestamps, assertions and cleanup. Failed/unavailable/not-run outcomes remain distinct.

## Test statements

All 61 IDs/priorities remain, mapped to actual files. S02/D24 wording and Auth/Platforms dependencies follow approved mock/Linux overrides. R01 labels an existing regression. P0 blocks acceptance; P1 gates its claim. Statements are requirements, not results.

Dependencies: **FS** private local filesystem; **F** controlled process/fault fixtures; **A** pinned installed Codex/Claude paths; **M** loopback API mocks/fixture keys; **L** Linux arm64, Node 24.22.3; **PK** built/fetched artifact with preinstalled dependencies; **SRC** exact upstream/binary provenance; **EV** identity-bound reports. All filenames are repository-relative. Additional helper/consumer checks may exercise the same expectation.

### Bundle and filesystem

|ID|Priority|Kind|Filename|Dependencies|Expectation|
|---|---|---|---|---|---|
|B01|P0|Unit|`tests/core/bundle.test.ts`|FS|Round trips must preserve unknown application JSON fields and opaque binary payload bytes.|
|B02|P0|Unit|`tests/core/bundle.test.ts`|FS|Unsupported bundle versions, required features, providers, or state formats must fail before hooks or adapter launch.|
|B03|P0|Unit|`tests/core/bundle.test.ts`|FS|Absolute paths, traversal, escaping links, special files, and namespace collisions must be rejected before materialization.|
|B04|P0|Unit|`tests/core/bundle.test.ts`|FS|Missing, unexpected, truncated, or hash-mismatched payloads must fail validation without exposing an imported instance.|
|B05|P0|Unit|`tests/core/bundle.test.ts`|FS|Oversized manifests, excessive files, and excessive payload bytes must fail within configured limits.|
|B06|P0|Integration|`tests/core/publication.test.ts`|FS, F|Interrupted exports must expose no partial checkpoint and preserve every previously published checkpoint.|
|B07|P0|Integration|`tests/core/publication.test.ts`|FS|Exporting to an existing destination must report conflict without modifying its contents.|
|B08|P1|Integration|`tests/consumers/library.mjs`|FS, L|Restored files must retain supported modes; private state and manifests must remain inaccessible to other users.|

### Providers and lifecycle

|ID|Priority|Kind|Filename|Dependencies|Expectation|
|---|---|---|---|---|---|
|S01|P0|Integration|`tests/consumers/library.mjs`|A, M|Each provider must resume remembered context after source-state deletion and workspace relocation, then export a usable successor checkpoint.|
|S02|P0|Integration|`tests/consumers/library.mjs`|A, M, L|Each advertised provider must retain withheld context in native requests after relocated restoration using mock APIs, without receiving remembered content in its resume prompt.|
|S03|P0|Integration|`tests/consumers/library.mjs`|A, M|Independent restores must diverge without changing their shared source checkpoint or each other’s mutable provider state.|
|S04|P0|Integration|`tests/core/lifecycle.test.ts`|F|Active turns, background writers, pending permissions, or running client tools must make export report busy.|
|S05|P0|Integration|`tests/core/lifecycle.test.ts`|F, FS|Snapshot collection must begin only after writers stop; successful export must require explicit resume before another prompt.|
|S06|P0|Integration|`tests/core/owner.test.ts`|F, FS|Adapter crashes, shutdown timeouts, and cancellation must leave no usable partial import or orphaned writer.|
|S07|P0|Integration|`tests/consumers/library.mjs`|A, M|Missing provider state or failed native session load must report restore failure, never start a fresh conversation.|
|S08|P0|Integration|`scripts/probes/codex.ts`|A, M, FS|Codex export must include committed WAL state and relocate validated indexes without changing the source checkpoint.|
|S09|P0|Integration|`scripts/probes/claude.ts`|A, M, FS|Claude restore must resolve cwd-encoded lookup and preserve required related transcripts when restoring under a different workspace path.|
|S10|P0|Integration|`tests/consumers/library.mjs`|A, FS|Built-in exports must exclude credential/config sentinels, caches, locks, and unrelated sessions from provider homes.|
|S11|P0|Integration|`tests/consumers/library.mjs`|A, M, FS|Local sessions must execute filesystem and terminal callbacks on the same host without C2 runtime services.|
|S12|P0|Integration|`tests/consumers/library.mjs`|F|Missing installed dependencies must fail before session creation without invoking package installers or network downloads.|
|S13|P1|Integration|`scripts/consumers/run.ts`|A, L|Every advertised version pair must pass relocation and successor export; untested pairs must not be advertised as compatible.|
|S14|P0|Integration|`tests/consumers/library.mjs`|A, FS|Session restore and execution must leave the user’s existing agent home and unrelated workspaces unchanged.|

### Extensions and ACP

|ID|Priority|Kind|Filename|Dependencies|Expectation|
|---|---|---|---|---|---|
|E01|P0|Integration|`tests/core/hooks.test.ts`|F, FS|Configured export/import hooks must round-trip namespaced JSON and files in deterministic order.|
|E02|P0|Unit|`tests/core/hooks.test.ts`|F|Bundle-supplied commands must never execute; missing required hooks and incompatible hook versions must fail before adapter startup.|
|E03|P0|Integration|`tests/core/hooks.test.ts`|F, FS|Hook timeout, failure, invalid output, or namespace escape must abort publication and discard staged state.|
|E04|P1|Unit|`tests/core/hooks.test.ts`|FS|Unknown optional extensions must remain inactive, retain opaque JSON/files through re-export, and produce an explicit notice.|
|E05|P0|Integration|`tests/consumers/acp.mjs`|F|Standard ACP streaming, request IDs, reverse callbacks, permissions, and cancellation must survive wrapper forwarding.|
|E06|P0|Integration|`tests/consumers/acp.mjs`|F|Checkpoint capabilities must be advertised only when implemented; ordinary clients must chat without negotiating extensions.|
|E07|P0|Integration|`tests/consumers/acp.mjs`|F, FS|Export must return its complete result before closing control transport, and refuse racing prompts or imports.|
|E08|P0|Integration|`tests/consumers/acp.mjs`|F, FS|Local clients must enforce permission decisions and avoid advertising unavailable callbacks or silently routing tool execution remotely.|
|E09|P1|Integration|`scripts/consumers/acpx.ts`|A, M|An unmodified acpx custom-agent configuration must chat through each wrapper while preserving standard permission and cancellation behavior.|

### Packaging and publication

|ID|Priority|Kind|Filename|Dependencies|Expectation|
|---|---|---|---|---|---|
|P01|P0|Integration|`scripts/consumers/run.ts`|PK, L|The candidate package must expose usable library and CLI entrypoints with its locked, preinstalled adapter dependencies.|
|P02|P0|Integration|`scripts/published.ts`|PK, A, M|The actual published version must pass consumer startup and provider checkpoint continuation before release success is reported.|

### Detail and regression

|ID|Priority|Kind|Filename|Dependencies|Expectation|
|---|---|---|---|---|---|
|D01|P0|Integration|`scripts/probes/provenance.ts`|SRC, A, L|Reviewed source, installed binary provenance and runtime traces must establish that Codex uses neither external nor embedded App Server.|
|D02|P0|Integration|`tests/consumers/library.mjs`|SRC, F, PK|Substituted binaries, unsupported versions or missing installed helpers must fail before session state creation, without invoking installers.|
|D03|P0|Integration|`tests/codex-guard.test.ts`|A, M, FS|Missing lookup, corrupt rollout and resume re-entry failures must prevent fresh native execution before any user prompt or tool work is admitted.|
|D04|P0|Integration|`tests/consumers/library.mjs`|A, M, FS|Initial load and later Claude query recreation must fail closed when required restored transcripts disappear, without starting a new conversation.|
|D05|P0|Integration|`tests/consumers/library.mjs`|A, M, FS|Each provider must recall withheld random facts and prior local tool results after source deletion and relocation without replacement history or revealing prompts.|
|D06|P0|Integration|`tests/consumers/library.mjs`|A, M, FS|Both independent native branches must export successors that restore after branch-state deletion, retain divergent context and execute tools in their destination workspaces.|
|D07|P1|Integration|`tests/claude-layout.vitest.ts`|A, M, L|Claude relocation must resolve long, canonicalized and normalized workspace paths while rejecting ambiguous lookup collisions without mutating the source checkpoint.|
|D08|P0|Integration|`tests/core/lifecycle.test.ts`|F, FS|Simultaneous prompt, permission, tool and export admissions must yield one consistent lifecycle outcome without deadlock or capture during outstanding work.|
|D09|P0|Integration|`tests/core/lifecycle.test.ts`|F, FS|Capture, hook or publication failure after shutdown must leave execution stopped; only explicit successful resume may admit another prompt.|
|D10|P0|Integration|`tests/core/owner.test.ts`|F, L|Surviving descendants and inherited pipes must be cleaned within deadlines; unconfirmed writer exit must prevent capture and publication.|
|D11|P0|Integration|`tests/core/lifecycle.test.ts`|F, FS|Cancellation before publication must discard staging; cancellation after atomic commit must report the committed checkpoint without falsely claiming rollback.|
|D12|P0|Integration|`tests/consumers/acp.mjs`|A, M, FS|Approved filesystem and terminal callbacks must execute exactly once on the declared host and return their results through the correct ACP request.|
|D13|P0|Integration|`tests/consumers/library.mjs`|A, M, FS|Denial, cancellation, disconnection or absent permission handlers must prevent native and broker tool execution, including bypass paths.|
|D14|P0|Integration|`tests/core/acp-peer.test.ts`|F|Late permission responses must not revive canceled operations or affect other sessions; restored instances must inherit no live permission grants or handles.|
|D15|P0|Integration|`tests/core/acp-peer.test.ts`|F|Fragmented frames, interleaved reverse requests and streamed updates must preserve IDs, ordering, backpressure and cancellation while diagnostics remain outside ACP stdout.|
|D16|P0|Integration|`tests/consumers/acp.mjs`|F, FS|Negotiated restore must create an isolated branch; unnegotiated checkpoint requests and operations racing export must fail without disrupting ordinary ACP sessions.|
|D17|P0|Integration|`tests/core/descriptor-filesystem.test.ts`|FS, F|Source mutation or link substitution during validation and copying must never materialize unchecked bytes, escape private staging or expose an imported instance.|
|D18|P0|Unit|`tests/core/bundle.test.ts`|FS|Duplicate JSON keys, duplicate inventory paths, hard-link aliases and destination case or Unicode collisions must fail before hooks or native launch.|
|D19|P0|Unit|`tests/core/bundle.test.ts`|FS|Boundary fixtures must accept values at each finite budget and reject excess during processing without unbounded buffering.|
|D20|P0|Integration|`tests/core/hooks.test.ts`|F, FS|Hook file and JSON output exceeding budgets or entering provider namespaces must abort publication, reap hook processes and remove staging.|
|D21|P0|Integration|`tests/core/publication.test.ts`|FS, F, L|Concurrent publishers targeting one destination must produce exactly one complete winner and conflict losers without replacing existing content.|
|D22|P0|Integration|`tests/core/publication.test.ts`|FS, F, L|Unsupported atomic filesystem operations must fail explicitly; crashes around sealing and commit must expose either no checkpoint or a fully validated checkpoint.|
|D23|P0|Integration|`tests/consumers/library.mjs`|A, FS|Resume, failed restore and concurrent branches must preserve existing user homes, unrelated workspaces and immutable source inventories.|
|D24|P0|Integration|`tests/consumers/library.mjs`|A, FS|Built-in bundles and captured diagnostics must exclude credential sentinels; fixture keys must be supplied separately during candidate and published continuation checks.|
|D25|P0|Integration|`scripts/consumers/run.ts`|PK, A, M, L|Clean library and CLI consumers must complete both-provider continuation using only the candidate tarball and preinstalled dependencies, without source-tree resolution or runtime downloads.|
|D26|P0|Integration|`tests/verification-hook.test.ts`|EV, F, PK|Candidate verification must reject stale commit or artifact digests and fail required behavior without silently skipping a provider.|
|D27|P0|Integration|`tests/consumers/cli.mjs`|PK, F, FS|CLI create and restore modes must be exclusive; failed restore must exit unsuccessfully without creating fresh native state.|
|D28|P0|Integration|`scripts/published.ts`|PK, A, M, L, EV|Published acceptance must record real publication references and repeat consumer startup, relocated continuation, branches and successor restoration against the fetched published artifact.|
|R01|P0|Integration|`tests/core/owner.test.ts`|F, FS, L|Fast terminal exit must retain stdout and stderr while cwd-descriptor closure is delayed 200 milliseconds.|

Fixture readiness regressions in `tests/process-ownership.test.ts` qualify S06,
E09 and D10 alongside real process cleanup checks. Empty, decimal-prefix and
missing-newline records remain pending at acknowledged barriers. The isolated
original reader must fail those readiness assertions for empty and partial
records. The shared internal publisher must hide its empty, partial and closed
sibling temporary file until rename; death and rename failure must never expose
partial readiness. Strict PID validation precedes process checks, and malformed
records or readiness deadlines fail explicitly. Cancellation timing starts only
after validated readiness. The parent-crash proof requires both inner processes
to disappear while the outer leader is alive. These checks run through focused
qualification; both-provider probes and eight installed consumers remain required.

## Candidate checks using pre-merge evidence

Use Node 24.22.3, pnpm 12.21.0, installed compiler/Node headers and frozen project devDependencies. Preserve `--ignore-scripts`; do not adopt the failed five-worker-package proposal or reopen adapter approvals. [Owner correction](package-dependency-resolution.md).

The existing `.c2/recipes/hooks/build/verify.yaml` checks candidate/Node and frozen installation, then runs:

```sh
node scripts/build-native.ts
node scripts/focused.ts --report artifacts/focused-tests.json
pnpm run build
pnpm pack --pack-destination artifacts
node scripts/probes/run.ts --report artifacts/provider-probes.json
node scripts/consumers/run.ts --artifact artifacts/acp-plus-session-0.1.0-candidate.0.tgz --report artifacts/consumer-report.json
node scripts/product-report.ts --focused artifacts/focused-tests.json --native artifacts/provider-probes.json --consumers artifacts/consumer-report.json --artifact artifacts/acp-plus-session-0.1.0-candidate.0.tgz --report artifacts/product-report.json
node scripts/verify.ts --candidate <managed-commit> --report artifacts/product-report.json --artifact artifacts/acp-plus-session-0.1.0-candidate.0.tgz
```

Native probes intentionally exit 1 for four raw controls: Codex missing-load fallback, image-permission bypass, insufficient native-tool removal and Claude Read routing. Continue only to strict aggregation of a fresh report: exactly those failures, passing wrapper mitigations, no extra failures/timeouts/survivors, both providers and matching identities. Forbid `--allow-dirty`; retain failed-run diagnostics, filtering only prohibited Git transport artifacts.

Offline consumers resolve installed exports/bins, never source symlinks. Run both providers through library/CLI/ACP/acpx. Candidate P02/D28 stay explicitly `not_run` until publication. R01 maps to its existing focused result; the acceptance schema still tracks 61 IDs.

## Assessment after actual publication

The package is private with no publisher/channel. Root coordinates publication; Linux verification proceeds. Freeze final version/manifest/lock before packing. After publication:

```sh
node scripts/published.ts --reference /absolute/publication-reference.json --report artifacts/published-report.json
```

Require real HTTPS URL/version/SRI/source commit, bounded acquisition, integrity/source/version checks and all eight installed consumers plus both-provider continuation on fetched bytes. Record both artifact digests; investigate content differences and rerun affected checks. A local pack, publish command or synthetic reference cannot satisfy P02/D28.

The publisher script emits `published-report/v1`; the verifier expects `acceptance-report/v1`. Preserve the acquisition/consumer report separately. Final release assessment links its real passing result to P02/D28 and the matching candidate matrix. Do not feed incompatible schemas into the verifier. Synthetic validator coverage proves gating, not public acquisition. No release success until this assessment passes.

[qualification.json](qualification.json) retains all prior data. [acceptance.json](acceptance.json) groups all historical statuses and references qualification metadata instead of repeating it. Historical error/Darwin references are provenance, not work or gates. Owner evidence/YAML remain selected. Product checks/publication were not run.
