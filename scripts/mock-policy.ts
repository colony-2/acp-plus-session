// Human revision returned with cancelled oversight 3MOBC7YZSI5Ndwb8HhM04S72W96.
// Keep original expectation IDs; qualify API-dependent behavior with local mocks.
export const mockPolicy = {
  mode: 'mock-api',
  direction: 'the tests should run against a mock api.',
  sourceJob: '3MOBC7YZSI5Ndwb8HhM04S72W96',
  adjustedExpectations: ['S02', 'D24', 'P02', 'D28'],
  scope: 'Actual installed adapters/runtimes and filesystem/process behavior; simulated provider API responses, no authenticated-model claim'
};
// Human removal of macOS, accepted in the Linux-only implementation direction.
export const platformPolicy = {
  required: ['linux-arm64'],
  excluded: ['darwin', 'windows', 'unqualified Linux architectures'],
  removalRequest: '3be5e26e-00e1-4d3d-8a46-a491d09d2cc6',
  approvalRequest: 'c2566a42-c1bb-4210-ad8b-05b59a0f9e27'
};
const assertions = ['ambientHomesUnchanged', 'unrelatedWorkspaceUnchanged', 'sourceResolvedFromConsumer', 'rememberedAndPriorToolInAlpha', 'alphaDestinationTool', 'alphaSuccessor', 'rememberedAndPriorToolInBeta', 'betaDestinationTool', 'betaSuccessor', 'independentBranches', 'nativeBypassBlocked', 'requestsConsumed'];
const checks = ['source-private-state-and-workspace-deleted', 'alpha-successor-restored-after-branch-deletion', 'beta-successor-restored-after-branch-deletion'];
export function qualifyMockConsumers(report: any) {
  const mode = report?.schema === 'acp-plus-session/consumer-report/v1' && report.apiMode === 'mock' && report.mockApi?.transport === 'loopback-http' && report.mockApi?.credentialMode === 'fixture-only' && report.status === 'passed' && report.consumers?.length === 8;
  return ['codex', 'claude'].map(provider => {
    const cases = ['library', 'cli', 'acp'].map(consumer => {
      const matches = report?.consumers?.filter((c: any) => c.provider === provider && c.consumer === consumer) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    });
    const continuation = mode && cases.every(c => {
      let local = false;
      try { const u = new URL(c?.mockApi?.url); local = u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port; } catch { /* fail closed */ }
      return c?.status === 'passed' && local && c.mockApi.protocol === (provider === 'codex' ? 'openai-responses-sse' : 'anthropic-messages-sse') && c.mockApi.modelRequests === (c.consumer === 'library' ? 17 : 10) && Array.isArray(c.mockApi.endpointErrors) && c.mockApi.endpointErrors.length === 0 && assertions.every(key => c.assertions?.[key] === true) && checks.every(key => c.outcome?.checks?.includes(key));
    });
    const credentialExclusion = continuation && cases[0]?.outcome?.checks?.includes('built-in-checkpoints-exclude-auth-config-cache-lock-unrelated-session-sentinels') === true;
    const acpx = report?.consumers?.filter((c: any) => c.provider === provider && c.consumer === 'acpx') ?? [];
    const compatibility = acpx.length === 1 && acpx[0].status === 'passed' && acpx[0].code === 5 && acpx[0].expectedDenialExitCode === 5 && acpx[0].markerWritten === false && acpx[0].cancellation?.code === 0 && acpx[0].cancellation?.survivor === false && acpx[0].cancellation?.cancelForwarded === true;
    return { provider, continuation: Boolean(continuation), credentialExclusion: Boolean(credentialExclusion), compatibility, status: continuation && credentialExclusion && compatibility ? 'passed' : 'failed' };
  });
}
