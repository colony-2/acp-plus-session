import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyMockConsumers } from '../../scripts/mock-policy.ts';
function evidence(): any {
  return { schema: 'acp-plus-session/consumer-report/v1', apiMode: 'mock', mockApi: { transport: 'loopback-http', credentialMode: 'fixture-only' }, status: 'passed', consumers: ['codex', 'claude'].flatMap(provider => [
    ...['library', 'cli', 'acp'].map(consumer => ({ provider, consumer, status: 'passed', mockApi: { url: 'http://127.0.0.1:1234', protocol: provider === 'codex' ? 'openai-responses-sse' : 'anthropic-messages-sse', modelRequests: consumer === 'library' ? 17 : 10, endpointErrors: [] }, assertions: Object.fromEntries(['ambientHomesUnchanged', 'unrelatedWorkspaceUnchanged', 'sourceResolvedFromConsumer', 'rememberedAndPriorToolInAlpha', 'alphaDestinationTool', 'alphaSuccessor', 'rememberedAndPriorToolInBeta', 'betaDestinationTool', 'betaSuccessor', 'independentBranches', 'nativeBypassBlocked', 'requestsConsumed'].map(k => [k, true])), outcome: { checks: ['source-private-state-and-workspace-deleted', 'alpha-successor-restored-after-branch-deletion', 'beta-successor-restored-after-branch-deletion', 'built-in-checkpoints-exclude-auth-config-cache-lock-unrelated-session-sentinels'] } })),
    { provider, consumer: 'acpx', status: 'passed', code: 5, expectedDenialExitCode: 5, markerWritten: false, cancellation: { code: 0, survivor: false, cancelForwarded: true } }
  ]) };
}
test('S02/D24 revised mock policy requires both provider request-history and credential exclusion evidence', () => {
  assert.ok(qualifyMockConsumers(evidence()).every(p => p.status === 'passed'));
});
test('canned responses or a passing summary cannot replace restored request context and source deletion', () => {
  for (const key of ['rememberedAndPriorToolInAlpha', 'alphaSuccessor', 'independentBranches', 'requestsConsumed']) {
    const report = evidence(); report.consumers[0].assertions[key] = false;
    assert.equal(qualifyMockConsumers(report)[0].status, 'failed');
  }
  const report = evidence(); report.consumers[0].outcome.checks = [];
  assert.equal(qualifyMockConsumers(report)[0].continuation, false);
});
test('unlabelled old evidence, remote endpoints, wrong protocol, endpoint errors and missing providers fail', () => {
  for (const mutate of [
    (r: any) => { delete r.apiMode; },
    (r: any) => { r.consumers[0].mockApi.url = 'https://api.openai.com'; },
    (r: any) => { r.consumers[0].mockApi.protocol = 'other'; },
    (r: any) => { r.consumers[0].mockApi.endpointErrors.push('unexpected request'); },
    (r: any) => { r.consumers[0].mockApi.modelRequests = 0; },
    (r: any) => { r.consumers.pop(); },
    (r: any) => { r.consumers[1] = r.consumers[0]; }
  ]) {
    const report = evidence(); mutate(report);
    assert.ok(qualifyMockConsumers(report).some(p => p.status === 'failed'));
  }
});
test('credential exclusion and acpx cancellation cannot be silently dropped from mock qualification', () => {
  const report = evidence(); report.consumers[0].outcome.checks.pop();
  assert.equal(qualifyMockConsumers(report)[0].credentialExclusion, false);
  const cancelled = evidence(); cancelled.consumers[3].cancellation.survivor = true;
  assert.equal(qualifyMockConsumers(cancelled)[0].status, 'failed');
});
