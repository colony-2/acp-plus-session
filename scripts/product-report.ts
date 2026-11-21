import { readFile, writeFile } from 'node:fs/promises';
import { acceptanceIds, publicationCheckIds } from './acceptance.ts';
import { mockPolicy, platformPolicy, qualifyMockConsumers } from './mock-policy.ts';
import { identity } from './probes/identity.ts';
import { sha256 } from '../src/core/files.ts';
const args = process.argv.slice(2); const option = (key: string) => { if (!args.includes(key) || !args[args.indexOf(key) + 1]) throw new Error(`Missing ${key}`); return args[args.indexOf(key) + 1]; };
const source = await identity(); const lockfileSha256 = sha256(await readFile('pnpm-lock.yaml'));
const focused = JSON.parse(await readFile(option('--focused'), 'utf8'));
const native = JSON.parse(await readFile(option('--native'), 'utf8'));
const consumers = JSON.parse(await readFile(option('--consumers'), 'utf8'));
const artifactSha256 = sha256(await readFile(option('--artifact')));
for (const r of [focused, native, consumers]) if (r.source?.commit !== source.commit || r.source?.treeSha256 !== source.treeSha256 || !r.sourceUnchanged) throw new Error('Stale or source-changing qualification input');
if (focused.lockfileSha256 !== lockfileSha256 || native.lockfileSha256 !== lockfileSha256 || consumers.artifactSha256 !== artifactSha256) throw new Error('Stale dependency or artifact input');
const mockProviders = qualifyMockConsumers(consumers);
const expectedControls = new Set(['D03.codex.native-missing-load', 'D13.codex.native-permissions', 'codex.broker-native-tool-removal', 'D12.claude.read-callback-routing']);
const providers = ['codex', 'claude'].map(provider => {
  const n = native.providers.filter((p: any) => p.provider === provider), checks = n[0]?.checks ?? [];
  const actual = consumers.consumers.filter((p: any) => p.provider === provider && ['library', 'cli', 'acp'].includes(p.consumer));
  const rawFailures = checks.filter((c: any) => expectedControls.has(c.id));
  const nativePassed = n.length === 1 && checks.length >= (provider === 'codex' ? 28 : 55) && rawFailures.length === (provider === 'codex' ? 3 : 1) && checks.every((c: any) => c.status === (expectedControls.has(c.id) ? 'failed' : 'passed')) && n[0].endpointErrors.length === 0 && n[0].runs.every((r: any) => !r.process.timedOut && r.process.survivors.length === 0) && !!native.runtimeProvenance[provider]?.binary?.sha256;
  return { provider, status: nativePassed && actual.length === 3 && mockProviders.find(p => p.provider === provider)?.status === 'passed' ? 'passed' : 'failed', scope: 'Pinned native fixtures and packed consumers against loopback mock APIs on Linux arm64', rawControlFailures: rawFailures.map((c: any) => c.id) };
});
// Each row links concrete, bounded evidence. These are candidate assessments,
// not an authentication or publication attestation from successful mock runs.
const evidence: Record<string, string> = {
  B01: 'bundle binary/numeric JSON roundtrip; packed registered hooks and retained optional opaque files',
  B02: 'bundle unsupported schema/format/provider/features; required hook/version rejection before launch',
  B03: 'traversal/namespace/case/Unicode controls; real symlink, hardlink and FIFO rejection',
  B04: 'missing/extra/truncated/hash-mismatched source fixtures return no staged import',
  B05: 'manifest/entry/file/aggregate/depth boundary fixtures; streaming descriptor reads',
  B06: 'SIGKILL barriers before and after real rename commit; old valid checkpoint unchanged',
  B07: 'existing-target conflict and eight concurrent real no-replace publishers',
  B08: 'uid/gid 65534 denied staged state and manifest; packed extension executable mode roundtrip',
  S02: 'Human mock-API revision: both real runtimes and all packed consumers send remembered/prior-tool context after source deletion, relocation, branching and successor restoration; response scripts alone cannot satisfy request assertions',
  D24: 'Human mock-API revision: separately supplied fixture keys plus credential/config/cache/unrelated-session sentinels excluded from built-in checkpoints, including both successor branches',
  S01: 'packed library/CLI/ACP remembered+tool context, deleted source, relocation and successor chains',
  S03: 'alpha/beta context separation and immutable source; concurrent restored-instance exports',
  S04: 'each activity kind blocks export; real pending native permission makes packed export busy',
  S05: 'synchronous transition admission; reaped detached TERM-ignoring product tool; explicit resume',
  S06: 'crashed wrapper ownership, forged completion, shutdown failure; ACP/acpx cancel/disconnect cleanup',
  S07: 'falsy/missing/corrupt restores and removed native JSONL reentry fail without model requests',
  S08: 'native fixture retains committed WAL while raw main is stale; product codec includes committed row',
  S09: 'native long/Unicode/canonical path and related transcript replay through successor restores',
  S10: 'packed auth/config/cache/lock/unrelated-session and native codec SQLite log sentinels absent from built-in bytes',
  S11: 'local library tools and ACP owning-client filesystem/terminal callbacks without C2 services',
  S12: 'packed missing helper fails before any private state; installed dependency resolution only',
  S13: 'exact measured Linux arm64/Node/native pair only; other platforms explicitly unsupported',
  S14: 'ambient Codex/Claude credential homes and unrelated workspace sentinels remain unchanged',
  E01: 'sorted registered hook order and packed namespaced JSON/binary/mode roundtrip',
  E02: 'required unavailable/version/schema controls; optional command data never executes',
  E03: 'hook exit/timeout/invalid JSON/oversize and namespace mutation controls, owner cleanup',
  E04: 'packed unknown optional JSON number and opaque file retained inactive with explicit notices',
  E05: 'fragmented ACP IDs/reverse calls/ordered chunks/backpressure; packed callback and cancellation wire',
  E06: 'ordinary ACP/acpx chat and rejected unnegotiated checkpoint methods; negotiated capability checks',
  E07: 'export response on live control stream; stopped/racing prompts and replacement imports rejected',
  E08: 'local file writes/reads execute once after permission; unavailable/denied callbacks do not execute',
  E09: 'unmodified acpx 0.22 custom-agent chat, denial exit 5, SIGINT cancellation result and terminal cleanup',
  P01: 'independent offline tarball install and real locked installed backends via library/CLI/ACP',
  D01: 'exact upstream ThreadManager source revision, installed hashes and exec/runtime traces; no App Server',
  D02: 'packed missing/substituted helper and unsupported adapter version fail before private state creation',
  D03: 'exact Codex lookup/rollout guard fault fixtures plus packed no-model-request reentry control',
  D04: 'Claude missing transcript/child/artifact guards and packed removed-state recreation control',
  D05: 'random withheld remembered and prior-tool markers present in actual native resumed requests',
  D06: 'both alpha/beta successors after branch deletion retain branch context and destination tool output',
  D07: 'SDK lookup boundary, long UTF-16/NFC/NFD/canonical path native chains and alias rejection',
  D08: 'lifecycle transition/activity race barriers, pending permissions, repeated-close shared cleanup',
  D09: 'post-shutdown capture/publication errors remain stopped; hook failure same transaction path',
  D10: 'real Linux subreaper parent-crash and detached TERM-ignoring writer; unconfirmed completion forbids capture',
  D11: 'cancellation before capture discards staging; cancellation after real commit returns reference',
  D12: 'packed ACP exact one filesystem and two terminal calls; local file write/read exact invocation counts',
  D13: 'default denial, pending cancellation/disconnection and forced unadvertised native bypass controls',
  D14: 'late reverse-response correlation controls; packed late grant after cancel executes no callback',
  D15: 'fragmented/interleaved/ordered peer tests, slow output and bounded queues; ACP-only stdout parsing',
  D16: 'negotiated branch restore isolation, unnegotiated rejection and racing prompt/replacement import controls',
  D17: 'anchored descriptor ancestor/link substitution fixture, streamed source identity checks and staging integrity',
  D18: 'duplicate JSON and escaped keys, inventory aliases, hardlinks, case/NFD collision controls',
  D19: 'finite at/excess budgets for envelope, count, file, total, depth, hook input/output and relocation expansion',
  D20: 'hook byte budgets, payload/native namespace mutation and timeout cleanup fixtures',
  D21: 'eight simultaneous publishers yield one complete winner, conflict losers and stopped sessions',
  D22: 'actual pre/post-commit SIGKILL controls validate outcome; unsupported helper error is explicit',
  D23: 'packed ambient/unrelated/source immutability, failed restores and concurrent isolated restored exports',
  D25: 'separate project resolves candidate library/bin and pinned natives; offline setup precedes execution',
  D26: 'actual hook shell failure boundaries, focused runner early stop, stale source/lock/artifact validator controls',
  D27: 'packed CLI exclusive create/restore modes and missing restore failure without native state'
};
const completeFixtures = focused.status === 'passed' && consumers.status === 'passed' && providers.every(p => p.status === 'passed');
const productChecks = acceptanceIds.map(id => {
  if (publicationCheckIds.includes(id)) return { id, status: 'not_run', deferredUntil: 'actual_publication', detail: 'Requires the fetched actual published artifact and real publication identity; local pack is not publication' };
  return { id, status: completeFixtures && evidence[id] ? 'passed' : 'not_run', detail: evidence[id] ?? 'Expectation has not yet been qualified' };
});
const report = { schema: 'acp-plus-session/acceptance-report/v1', phase: 'candidate', validationPolicy: mockPolicy, platformPolicy, mockProviders, source, sourceUnchanged: true, lockfileSha256, artifactSha256, inputs: { focused: option('--focused'), native: option('--native'), consumers: option('--consumers') }, providers, productChecks, additionalPlatforms: { status: 'out_of_scope', detail: 'Approved Linux arm64-only scope; Darwin implementation, runners and qualification were removed, not deferred' }, status: productChecks.some(c => !publicationCheckIds.includes(c.id) && c.status !== 'passed') || providers.some(p => p.status !== 'passed') ? 'failed' : 'passed' };
await writeFile(option('--report'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: option('--report'), status: report.status, unresolved: productChecks.filter(c => c.status !== 'passed').map(c => ({ id: c.id, status: c.status })) }));
