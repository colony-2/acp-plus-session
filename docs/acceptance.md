# Portable session product acceptance contract

## Current approved scope: Linux arm64 and mock provider APIs

Human request `3be5e26e-00e1-4d3d-8a46-a491d09d2cc6` removes macOS
implementation, qualification, runners and ownership consultations from this job.
Approval `c2566a42-c1bb-4210-ad8b-05b59a0f9e27` accepts Linux arm64 only,
with both providers and all 61 IDs/priorities preserved. The historical
Linux/macOS and authentication dependencies below are overridden accordingly;
other platforms are excluded, not unavailable required checks. See the
[current statements and actual test paths](test-direction.md). R01 names an
existing terminal-output regression and does not expand the acceptance schema.

## Current human revision: mock provider APIs

The human feedback returned with cancelled root job `3MOBC7YZSI5Ndwb8HhM04S72W96`
says “the tests should run against a mock api.” This replaces the earlier
real-provider authentication prerequisite for API-dependent tests. Original
expectation rows below remain verbatim for traceability; S02 and D24 are now
qualified with actual installed runtimes against local mock APIs, actual restored
request histories, separately supplied fixture credentials and exclusion scans.
P02/D28 still require the actual published artifact, repeating those same mock
checks. No result is relabeled as authenticated inference. All validation,
lifecycle, permission, cancellation, isolation, context, platform and publication
requirements remain. See [current qualification](qualification.md) for executable
commands and scope. Historical preparation statements below describe that plan's
creation, not the current implementation status.


The original 33 B/S/E/P rows and priorities below are retained verbatim from root job `3MLIsDEVyJwBJBmmIEu1IKNASdj`, artifact `review/acp-plus-session-tests.md`. They are required checks, not results. P0 blocks delivery; P1 is required for the documented behavior/platform claim. Creation C01–C05 and evidence remain with root.

The accepted no-App-Server revision replaces the upstream Codex adapter with an owned bridge; Claude retains its upstream adapter. Neither external nor embedded Codex App Server may be used. The backend must qualify permissions/callbacks and no-fresh native load; JSONL or a process-only check is insufficient. See the [proposal](portable-codex-claude-sessions.md) and [detail/evidence](adapter-probes-and-design.md). Filenames are proposed test paths, not existing implementations.

Dependencies: **FS** = isolated local filesystem; **Fake** = controlled child-process fixtures; **Adapters** = qualified Codex bridge/Claude adapter with pinned installed runtimes; **Mock** = deterministic provider endpoint; **Auth** = authenticated provider access; **Platforms** = supported Linux/macOS runners; **Package** = built/published package with preinstalled dependencies.

## Bundle and filesystem contract

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| B01 | P0 | Unit | `tests/bundle.test.ts` | FS | Round trips must preserve unknown application JSON fields and opaque binary payload bytes. |
| B02 | P0 | Unit | `tests/bundle.test.ts` | FS | Unsupported bundle versions, required features, providers, or state formats must fail before hooks or adapter launch. |
| B03 | P0 | Unit | `tests/bundle-paths.test.ts` | FS | Absolute paths, traversal, escaping links, special files, and namespace collisions must be rejected before materialization. |
| B04 | P0 | Unit | `tests/bundle-integrity.test.ts` | FS | Missing, unexpected, truncated, or hash-mismatched payloads must fail validation without exposing an imported instance. |
| B05 | P0 | Unit | `tests/bundle-limits.test.ts` | FS | Oversized manifests, excessive files, and excessive payload bytes must fail within configured limits. |
| B06 | P0 | Integration | `tests/publication.test.ts` | FS, Fake | Interrupted exports must expose no partial checkpoint and preserve every previously published checkpoint. |
| B07 | P0 | Integration | `tests/publication.test.ts` | FS | Exporting to an existing destination must report conflict without modifying its contents. |
| B08 | P1 | Integration | `tests/bundle-modes.test.ts` | FS, Platforms | Restored files must retain supported modes; private state and manifests must remain inaccessible to other users. |

## Providers, lifecycle, and locality

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| S01 | P0 | Integration | `tests/provider-roundtrip.test.ts` | Adapters, Mock | Each provider must resume remembered context after source-state deletion and workspace relocation, then export a usable successor checkpoint. |
| S02 | P0 | Integration | `tests/provider-live.test.ts` | Adapters, Auth, Platforms | Each advertised provider/platform combination must complete an authenticated relocated round trip without receiving remembered content in its resume prompt. |
| S03 | P0 | Integration | `tests/branching.test.ts` | Adapters, Mock | Independent restores must diverge without changing their shared source checkpoint or each other’s mutable provider state. |
| S04 | P0 | Integration | `tests/lifecycle.test.ts` | Fake | Active turns, background writers, pending permissions, or running client tools must make export report busy. |
| S05 | P0 | Integration | `tests/lifecycle.test.ts` | Fake, FS | Snapshot collection must begin only after writers stop; successful export must require explicit resume before another prompt. |
| S06 | P0 | Integration | `tests/lifecycle.test.ts` | Fake, FS | Adapter crashes, shutdown timeouts, and cancellation must leave no usable partial import or orphaned writer. |
| S07 | P0 | Integration | `tests/restore-failure.test.ts` | Adapters, Mock | Missing provider state or failed native session load must report restore failure, never start a fresh conversation. |
| S08 | P0 | Integration | `tests/codex-state.test.ts` | Adapters, Mock, FS | Codex export must include committed WAL state and relocate validated indexes without changing the source checkpoint. |
| S09 | P0 | Integration | `tests/claude-state.test.ts` | Adapters, Mock, FS | Claude restore must resolve cwd-encoded lookup and preserve required related transcripts when restoring under a different workspace path. |
| S10 | P0 | Integration | `tests/credential-exclusion.test.ts` | Adapters, FS | Built-in exports must exclude credential/config sentinels, caches, locks, and unrelated sessions from provider homes. |
| S11 | P0 | Integration | `tests/local-execution.test.ts` | Adapters, Mock, FS | Local sessions must execute filesystem and terminal callbacks on the same host without C2 runtime services. |
| S12 | P0 | Integration | `tests/dependency-resolution.test.ts` | Fake | Missing installed dependencies must fail before session creation without invoking package installers or network downloads. |
| S13 | P1 | Integration | `tests/version-compatibility.test.ts` | Adapters, Platforms | Every advertised version pair must pass relocation and successor export; untested pairs must not be advertised as compatible. |
| S14 | P0 | Integration | `tests/isolation.test.ts` | Adapters, FS | Session restore and execution must leave the user’s existing agent home and unrelated workspaces unchanged. |

## User extensions and ACP clients

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| E01 | P0 | Integration | `tests/hooks.test.ts` | Fake, FS | Configured export/import hooks must round-trip namespaced JSON and files in deterministic order. |
| E02 | P0 | Unit | `tests/hook-registration.test.ts` | Fake | Bundle-supplied commands must never execute; missing required hooks and incompatible hook versions must fail before adapter startup. |
| E03 | P0 | Integration | `tests/hooks-failure.test.ts` | Fake, FS | Hook timeout, failure, invalid output, or namespace escape must abort publication and discard staged state. |
| E04 | P1 | Unit | `tests/optional-extensions.test.ts` | FS | Unknown optional extensions must remain inactive, retain opaque JSON/files through re-export, and produce an explicit notice. |
| E05 | P0 | Integration | `tests/acp-forwarding.test.ts` | Fake | Standard ACP streaming, request IDs, reverse callbacks, permissions, and cancellation must survive wrapper forwarding. |
| E06 | P0 | Integration | `tests/acp-extensions.test.ts` | Fake | Checkpoint capabilities must be advertised only when implemented; ordinary clients must chat without negotiating extensions. |
| E07 | P0 | Integration | `tests/acp-extensions.test.ts` | Fake, FS | Export must return its complete result before closing control transport, and refuse racing prompts or imports. |
| E08 | P0 | Integration | `tests/local-callbacks.test.ts` | Fake, FS | Local clients must enforce permission decisions and avoid advertising unavailable callbacks or silently routing tool execution remotely. |
| E09 | P1 | Integration | `tests/acpx-client.test.ts` | Adapters, Mock | An unmodified acpx custom-agent configuration must chat through each wrapper while preserving standard permission and cancellation behavior. |

## Packaging and publication

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| P01 | P0 | Integration | `tests/package-smoke.test.ts` | Package, Platforms | The candidate package must expose usable library and CLI entrypoints with its locked, preinstalled adapter dependencies. |
| P02 | P0 | Integration | `tests/published-smoke.test.ts` | Package, Adapters, Auth | The actual published version must pass consumer startup and provider checkpoint continuation before release success is reported. |

## Running the checks

Run candidate typecheck/build/unit/integration and packed-consumer checks before merge; published checks run after actual publication. Required behavior failures fail acceptance. Missing authentication/platform prerequisites remain unavailable; unattempted checks remain not run. c2ops results and copied files do not substitute for this product's acceptance. The detailed plan follows the statements below.

## Additional detail checks

These statements supplement the unchanged 33 expectations. **Source** means exact upstream source and installed-artifact provenance; **Evidence** means structured candidate results. Other dependency names use the legend above. Each expectation is at most 30 words. P0 remains blocking; unavailable prerequisites are recorded separately from failed behavior.

### Backend qualification and continuation

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| D01 | P0 | Integration | `tests/backend-qualification.test.ts` | Source, Adapters, Platforms | Reviewed source, installed binary provenance and runtime traces must establish that Codex uses neither external nor embedded App Server. |
| D02 | P0 | Integration | `tests/dependency-resolution.test.ts` | Source, Fake, Package | Substituted binaries, unsupported versions or missing installed helpers must fail before session state creation, without invoking installers. |
| D03 | P0 | Integration | `tests/codex-resume-guard.test.ts` | Adapters, Mock, FS | Missing lookup, corrupt rollout and resume re-entry failures must prevent fresh native execution before any user prompt or tool work is admitted. |
| D04 | P0 | Integration | `tests/claude-resume-guard.test.ts` | Adapters, Mock, FS | Initial load and later Claude query recreation must fail closed when required restored transcripts disappear, without starting a new conversation. |
| D05 | P0 | Integration | `tests/provider-roundtrip.test.ts` | Adapters, Mock, FS | Each provider must recall withheld random facts and prior local tool results after source deletion and relocation without replacement history or revealing prompts. |
| D06 | P0 | Integration | `tests/branch-successor.test.ts` | Adapters, Mock, FS | Both independent native branches must export successors that restore after branch-state deletion, retain divergent context and execute tools in their destination workspaces. |
| D07 | P1 | Integration | `tests/claude-state.test.ts` | Adapters, Mock, Platforms | Claude relocation must resolve long, canonicalized and normalized workspace paths while rejecting ambiguous lookup collisions without mutating the source checkpoint. |

### Lifecycle, permissions and ACP

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| D08 | P0 | Integration | `tests/lifecycle-races.test.ts` | Fake, FS | Simultaneous prompt, permission, tool and export admissions must yield one consistent lifecycle outcome without deadlock or capture during outstanding work. |
| D09 | P0 | Integration | `tests/lifecycle.test.ts` | Fake, FS | Capture, hook or publication failure after shutdown must leave execution stopped; only explicit successful resume may admit another prompt. |
| D10 | P0 | Integration | `tests/process-cleanup.test.ts` | Fake, Platforms | Surviving descendants and inherited pipes must be cleaned within deadlines; unconfirmed writer exit must prevent capture and publication. |
| D11 | P0 | Integration | `tests/cancellation.test.ts` | Fake, FS | Cancellation before publication must discard staging; cancellation after atomic commit must report the committed checkpoint without falsely claiming rollback. |
| D12 | P0 | Integration | `tests/local-callbacks.test.ts` | Adapters, Mock, FS | Approved filesystem and terminal callbacks must execute exactly once on the declared host and return their results through the correct ACP request. |
| D13 | P0 | Integration | `tests/native-permissions.test.ts` | Adapters, Mock, FS | Denial, cancellation, disconnection or absent permission handlers must prevent native and broker tool execution, including bypass paths. |
| D14 | P0 | Integration | `tests/acp-forwarding.test.ts` | Fake | Late permission responses must not revive canceled operations or affect other sessions; restored instances must inherit no live permission grants or handles. |
| D15 | P0 | Integration | `tests/acp-forwarding.test.ts` | Fake | Fragmented frames, interleaved reverse requests and streamed updates must preserve IDs, ordering, backpressure and cancellation while diagnostics remain outside ACP stdout. |
| D16 | P0 | Integration | `tests/acp-extensions.test.ts` | Fake, FS | Negotiated restore must create an isolated branch; unnegotiated checkpoint requests and operations racing export must fail without disrupting ordinary ACP sessions. |

### Validation, hooks and publication

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| D17 | P0 | Integration | `tests/bundle-source-races.test.ts` | FS, Fake | Source mutation or link substitution during validation and copying must never materialize unchecked bytes, escape private staging or expose an imported instance. |
| D18 | P0 | Unit | `tests/bundle-paths.test.ts` | FS | Duplicate JSON keys, duplicate inventory paths, hard-link aliases and destination case or Unicode collisions must fail before hooks or native launch. |
| D19 | P0 | Unit | `tests/bundle-limits.test.ts` | FS | Boundary fixtures must accept values at each finite budget and reject excess during processing without unbounded buffering. |
| D20 | P0 | Integration | `tests/hooks-failure.test.ts` | Fake, FS | Hook file and JSON output exceeding budgets or entering provider namespaces must abort publication, reap hook processes and remove staging. |
| D21 | P0 | Integration | `tests/publication-races.test.ts` | FS, Fake, Platforms | Concurrent publishers targeting one destination must produce exactly one complete winner and conflict losers without replacing existing content. |
| D22 | P0 | Integration | `tests/publication.test.ts` | FS, Fake, Platforms | Unsupported atomic filesystem operations must fail explicitly; crashes around sealing and commit must expose either no checkpoint or a fully validated checkpoint. |
| D23 | P0 | Integration | `tests/isolation.test.ts` | Adapters, FS | Resume, failed restore and concurrent branches must preserve existing user homes, unrelated workspaces and immutable source inventories. |
| D24 | P0 | Integration | `tests/credential-exclusion.test.ts` | Adapters, FS | Built-in bundles and captured diagnostics must exclude credential sentinels; authentication must be supplied separately during candidate and published continuation checks. |

### Candidate and published consumers

| ID | Priority | Kind | Filename | Dependencies | Expectation |
| --- | --- | --- | --- | --- | --- |
| D25 | P0 | Integration | `tests/package-smoke.test.ts` | Package, Adapters, Mock, Platforms | Clean library and CLI consumers must complete both-provider continuation using only the candidate tarball and preinstalled dependencies, without source-tree resolution or runtime downloads. |
| D26 | P0 | Integration | `tests/verification-hook.test.ts` | Evidence, Fake, Package | Candidate verification must reject stale commit or artifact digests and fail required behavior without silently skipping a provider. |
| D27 | P0 | Integration | `tests/cli-modes.test.ts` | Package, Fake, FS | CLI create and restore modes must be exclusive; failed restore must exit unsuccessfully without creating fresh native state. |
| D28 | P0 | Integration | `tests/published-smoke.test.ts` | Package, Adapters, Auth, Platforms, Evidence | Published acceptance must record real publication references and repeat consumer startup, relocated continuation, branches and successor restoration against the fetched published artifact. |

## Test implementation and evidence plan

Start backend/guard D01–D04 and both-provider closure/shutdown probes before broad implementation. Reuse [c2ops fixtures/request-history assertions](adapter-probes-and-design.md#c2ops-codex-session-carry-what-already-works), retaining their provenance limits. Disqualify a backend that fails server, permission or no-fresh requirements; do not weaken expectations.

Use Vitest, temporary roots and deterministic child/provider fixtures; barriers inject faults at admission, writer exit, copying, hooks and atomic commit. Native integration uses real binaries; platform tests use real process/filesystem primitives. Test below/at/above every budget and corrupt/remove every required native file, including successor state. Test private modes using another unprivileged identity; otherwise record unavailable coverage.

The [candidate plan](adapter-probes-and-design.md#candidate-checks-using-pre-merge-evidence) covers probes, typecheck/build, unit/integration, packed consumers, acpx and authenticated/platform checks. Map all 61 IDs to results. P0 failures block acceptance; P1 claims require evidence. Required unavailable or unattempted checks prohibit full acceptance, never become successful skips.

P01/D25 use independent consumers of the candidate tarball. P02/D28 repeat against the fetched actual published artifact after publication. Record source revision, artifact integrity, installed versions, platforms, commands and outcomes separately. No product implementation, test execution, candidate package or wrapper publication exists in this preparation.
