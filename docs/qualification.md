# Qualification with mock provider APIs

The human revision returned with cancelled oversight job
`3MOBC7YZSI5Ndwb8HhM04S72W96` states: **“the tests should run against a mock api.”**
The recovered original feedback also says existing open-source emulators may
provide those responses. This supersedes the earlier authenticated-API test
prerequisite. B01–B08, S01–S14, E01–E09, P01–P02 and D01–D28 remain tracked;
[acceptance.md](acceptance.md) retains the original rows and records this revision.

## Candidate checks

Use the frozen repository installation with scripts disabled. Exact project
manifests establish import readiness, independently of isolated worker CLI
packages. Both pinned native runtimes are required production dependencies. A
Linux-only package must not let the installer silently omit a runtime as an
optional dependency; independent offline consumer installs exercise this boundary. The two approved adapter pins remain unchanged. The unsuccessful
five-package worker proposal approved as
`de7fe039-26de-4ad9-abb3-961e58edbf94` remains unadopted.
The hook artifact-contract regression also uses the runner's `jq` executable
(tested with 1.8.1) to execute the exact projection returned by the hook. The
recipe itself evaluates that projection with its built-in `jq` function; product
library/CLI consumers do not require this test tool.
Native builds also require the compiler and Node 24.22.3 headers beside the
installed Node prefix. `scripts/build-native.ts` uses those installed headers;
it does not fetch a compiler, headers or runtime. The verify hook builds helpers
before focused tests, because descriptor-relative filesystem tests load the
packaged Node-API module.

```sh
pnpm install --frozen-lockfile --ignore-scripts
node scripts/build-native.ts
node scripts/focused.ts --report artifacts/focused-tests.json
pnpm run build
pnpm pack --pack-destination artifacts
node scripts/probes/run.ts --report artifacts/provider-probes.json
node scripts/consumers/run.ts --artifact artifacts/acp-plus-session-0.1.0-candidate.0.tgz --report artifacts/consumer-report.json
node scripts/product-report.ts --focused artifacts/focused-tests.json --native artifacts/provider-probes.json --consumers artifacts/consumer-report.json --artifact artifacts/acp-plus-session-0.1.0-candidate.0.tgz --report artifacts/product-report.json
node scripts/verify.ts --report artifacts/product-report.json --artifact artifacts/acp-plus-session-0.1.0-candidate.0.tgz
```

The native probe command intentionally exits 1 for four observed upstream
negative controls. The aggregate requires exactly those failures and passing
wrapper mitigations; it rejects additional failures, missing providers,
survivors, timeouts and stale provenance. The managed verify hook records the
native result and continues to that strict assessment. Local inspection of an
uncommitted implementation may use `--allow-dirty`; the hook requires the clean
managed candidate. Changes to source, commit, dependencies or artifact require
fresh qualification of those identities.

The hook returns diagnostic artifact references after removing the three Git
transport names forbidden by `c2.build-hook/v1`: `__git_state_thin_pack__`,
`diff_from_parent.diff` and `diff_from_base.diff`. They remain runtime transport
artifacts. Available logs, reports and packed artifacts retain their original
references, including when an early failure produces only a log.

## What the mocks exercise

The existing `scripts/probes/endpoints.ts` uses Node's HTTP server on ephemeral
127.0.0.1 ports to emulate OpenAI Responses SSE and Anthropic Messages SSE,
including text, tool calls and token-count requests. This is an actual HTTP
boundary for the real installed native programs, rather than an in-process SDK
replacement. Existing fixtures already cover the needed wire protocols; no new
emulator library was adopted. Startup performs no installation or runtime fetch.

The packed library, CLI and ACP consumers run from independent offline installs.
The endpoints inspect actual provider requests after source capsule/workspace
deletion, relocation, independent branches and successor restoration. Withheld
remembered/prior-tool/destination markers must appear in the correct restored
requests; canned response text cannot satisfy these assertions. The shared
checkpoint stays immutable. Real local tool callbacks, permissions,
cancellation, writer reaping and filesystem publication still run normally.
Unmodified acpx additionally exercises denial and cancellation for both providers.
The native owner acknowledges installed signal handlers on its private channel
before a forced stop can be sent. Turn cancellation skips the graceful TERM
window, kills only the owner's kernel-owned children (including reparented detached
writers), and still requires its final reaping confirmation. Graceful export and
close keep their existing shutdown policy. The cancellation regression upgrades
an in-progress graceful stop, reaps TERM-resistant detached writers within two
seconds, and covers cancellation before the owner's readiness handshake. This
keeps cancellation responses within acpx's 2.5-second wait; reports record actual
SIGINT-to-exit duration. Consumer failures still reach aggregate hook assessment
so its diagnostic report is emitted before verification rejects the candidate.

S02 now uses these mock-API continuation checks. D24 requires separately supplied
fixture keys and byte scans excluding those keys plus private credential/config,
cache and unrelated-session sentinels from checkpoints and both successors.
`scripts/mock-policy.ts` rejects missing history/deletion/isolation evidence,
remote endpoints, protocol/request-count mismatches, endpoint errors, missing
credential exclusion and missing acpx cleanup. Reports explicitly identify
`mock-api` policy and `fixture-only` credentials. They make no authenticated-model
or inference-quality claim. No provider credentials or runner-secret binding is
required, and the cancelled credential-delivery job must not be resumed.

The required and advertised pair is **Linux arm64 / Node 24.22.3** with the
measured native versions. Human request
`3be5e26e-00e1-4d3d-8a46-a491d09d2cc6` removed macOS implementation,
qualification, runners and ownership consultations from this job. Accepted
Linux-only direction `c2566a42-c1bb-4210-ad8b-05b59a0f9e27` preserves both
providers and all 61 expectation IDs/priorities. Other platforms are outside
scope, not unavailable required checks. Existing portable source may remain;
it does not advertise macOS support. Unsupported runtime pairs fail explicitly.
The verify hook rejects the wrong OS, architecture, Node or pnpm version before
installation or provider execution.

[Current test statements](test-direction.md) map every expectation to existing
files and retain the R01 delayed-descriptor-close output regression. Original
contract rows remain in acceptance.md for traceability; their obsolete Auth and
Linux/macOS prerequisites follow the current mock/Linux overrides.

Source inspection identifies the pinned direct-core Codex dispatch without App
Server; it is not a rebuilt-binary provenance attestation. Claude child-history
replay does not prove restarting a child task. Unqualified native layouts fail
explicitly.

## Actual publication

The recipe owns merge/publication. The current package remains private and no
publisher hook/channel is configured. A real publisher is still a prerequisite;
merge alone creates no public artifact reference. Candidate P02/D28 are explicitly
deferred, never marked passed from a local pack.

After authorized actual publication, use:

```sh
node scripts/published.ts --reference /absolute/publication-reference.json --report artifacts/published-report.json
```

The reference contains a public HTTPS `url`, exact `version`, sha256/sha512 SRI
`integrity`, and `sourceCommit`. The bounded acquisition rejects redirects and
checks downloaded integrity, packaged source and version. It repeats all eight
installed consumers and both-provider deleted-source/relocated branch/successor
checks against the fetched bytes using the same mock APIs and strict evidence
policy. No credential argument is needed. Record actual references and results;
no wrapper publication reference exists yet. Changed bytes require investigation
and requalification. Invalid-reference negative tests do not prove actual public
acquisition or publication.
