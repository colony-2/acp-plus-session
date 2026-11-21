// Product checks remain separate from native-backend fixture findings.
export const acceptanceIds = [
  ...Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 14 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 9 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`),
  'P01', 'P02',
  ...Array.from({ length: 28 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`)
];

export const publicationCheckIds = ['P02', 'D28'];

export function assess(report: any, source: any, candidate: string, lockfileSha256: string, artifactSha256: string | undefined, allowDirty = false) {
  const failures: string[] = [];
  if (report.validationPolicy?.mode !== 'mock-api') failures.push('Missing mock API validation policy');
  if (!['candidate', 'published'].includes(report.phase)) failures.push('Missing acceptance phase');
  if (report.phase === 'published' && (!report.publication?.url || !report.publication?.version || !report.publication?.integrity || report.publication?.sourceCommit !== candidate || report.publication?.artifactSha256 !== artifactSha256)) failures.push('Missing or mismatched actual publication references');
  if (report.schema !== 'acp-plus-session/acceptance-report/v1') failures.push('Not a product acceptance report');
  if (source.commit !== candidate || report.source?.commit !== candidate) failures.push('Candidate commit mismatch');
  if (report.source?.treeSha256 !== source.treeSha256) failures.push('Source digest mismatch');
  if (report.sourceUnchanged !== true) failures.push('Source changed during verification');
  if (!allowDirty && source.dirty) failures.push('Candidate checkout is dirty');
  if (report.lockfileSha256 !== lockfileSha256) failures.push('Dependency lock digest mismatch');
  if (!artifactSha256) failures.push('Missing candidate distributable');
  else if (report.artifactSha256 !== artifactSha256) failures.push('Distributable digest mismatch');
  for (const provider of ['codex', 'claude']) {
    const providers = report.providers?.filter((p: any) => p.provider === provider) ?? [];
    if (providers.length === 0) failures.push(`Missing provider: ${provider}`);
    else if (providers.length !== 1 || providers[0].status !== 'passed') failures.push(`Provider qualification failed: ${provider}`);
  }
  for (const id of acceptanceIds) {
    const outcomes = report.productChecks?.filter((c: any) => c.id === id) ?? [];
    if (report.phase === 'candidate' && publicationCheckIds.includes(id)) {
      if (outcomes.length !== 1 || outcomes[0].status !== 'not_run' || outcomes[0].deferredUntil !== 'actual_publication') failures.push(`${id}: ${outcomes[0]?.status ?? 'missing'} (requires explicit publication deferral)`);
      continue;
    }
    if (outcomes.length !== 1 || outcomes[0].status !== 'passed') failures.push(`${id}: ${outcomes[0]?.status ?? 'missing'}`);
  }
  return failures;
}
