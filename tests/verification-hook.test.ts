import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceIds, assess, publicationCheckIds } from '../scripts/acceptance.ts';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkProjectDependencies, projectToolVersions } from '../scripts/check-project-dependencies.ts';
import { Ajv } from 'ajv';

const source = { commit: 'candidate', treeSha256: 'content', dirty: false };
const healthy = () => ({ schema: 'acp-plus-session/acceptance-report/v1', phase: 'candidate', validationPolicy: { mode: 'mock-api' }, source, sourceUnchanged: true, lockfileSha256: 'lock', artifactSha256: 'artifact', providers: [{ provider: 'codex', status: 'passed' }, { provider: 'claude', status: 'passed' }],
  productChecks: acceptanceIds.map(id => ({ id, status: publicationCheckIds.includes(id) ? 'not_run' : 'passed', ...(publicationCheckIds.includes(id) ? { deferredUntil: 'actual_publication' } : {}) })) });

test('synthetic complete control passes the report validator', () => {
  assert.deepEqual(assess(healthy(), source, 'candidate', 'lock', 'artifact'), []);
});
test('stale candidate, changed source and changed dependency lock fail', () => {
  assert.ok(assess(healthy(), source, 'other', 'lock', 'artifact').includes('Candidate commit mismatch'));
  assert.ok(assess(healthy(), { ...source, treeSha256: 'changed' }, 'candidate', 'lock', 'artifact').includes('Source digest mismatch'));
  assert.ok(assess(healthy(), source, 'candidate', 'other', 'artifact').includes('Dependency lock digest mismatch'));
  assert.ok(assess(healthy(), source, 'candidate', 'lock', 'stale-artifact').includes('Distributable digest mismatch'));
  assert.ok(assess(healthy(), source, 'candidate', 'lock', undefined).includes('Missing candidate distributable'));
});
test('dirty candidate requires explicit local-only override', () => {
  assert.ok(assess(healthy(), { ...source, dirty: true }, 'candidate', 'lock', 'artifact').includes('Candidate checkout is dirty'));
  assert.deepEqual(assess(healthy(), { ...source, dirty: true }, 'candidate', 'lock', 'artifact', true), []);
});
test('a missing provider cannot be silently skipped', () => {
  const report = healthy(); report.providers.pop();
  assert.ok(assess(report, source, 'candidate', 'lock', 'artifact').includes('Missing provider: claude'));
  report.providers.push({ provider: 'claude', status: 'failed' });
  assert.ok(assess(report, source, 'candidate', 'lock', 'artifact').includes('Provider qualification failed: claude'));
  report.providers[1].status = 'passed'; report.providers.push({ provider: 'claude', status: 'passed' });
  assert.ok(assess(report, source, 'candidate', 'lock', 'artifact').includes('Provider qualification failed: claude'));
});
test('failed, unavailable, missing and duplicate required checks fail acceptance', () => {
  for (const status of ['failed', 'unavailable', 'not_run']) {
    const report = healthy(); report.productChecks.find(c => c.id === 'S01')!.status = status;
    assert.ok(assess(report, source, 'candidate', 'lock', 'artifact').includes(`S01: ${status}`));
  }
  const missing = healthy(); missing.productChecks.pop();
  assert.ok(assess(missing, source, 'candidate', 'lock', 'artifact').some(f => f.startsWith('D28: missing')));
  const duplicate = healthy(); duplicate.productChecks.push({ id: 'S01', status: 'passed' });
  assert.ok(assess(duplicate, source, 'candidate', 'lock', 'artifact').some(f => f.startsWith('S01:')));
});
test('native probes and source-changing runs cannot masquerade as product acceptance', () => {
  const probes = { ...healthy(), schema: 'acp-plus-session/probe-report/v1' };
  assert.ok(assess(probes, source, 'candidate', 'lock', 'artifact').includes('Not a product acceptance report'));
  const changed = { ...healthy(), sourceUnchanged: false };
  assert.ok(assess(changed, source, 'candidate', 'lock', 'artifact').includes('Source changed during verification'));
});

test('project dependency checks reject missing, misnamed and substituted declarations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'project-dependencies-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(checkProjectDependencies(root));
  for (const [name, version] of Object.entries(projectToolVersions)) {
    const directory = join(root, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version }));
  }
  await checkProjectDependencies(root);
  for (const manifest of [{ name: 'wrong', version: '24.19.2' }, { name: '@types/node', version: '24.19.1' }]) {
    await writeFile(join(root, 'node_modules/@types/node/package.json'), JSON.stringify(manifest));
    await assert.rejects(checkProjectDependencies(root), /Unexpected project dependency @types\/node/);
  }
});

test('the actual hook stops at failed boundaries and clears stale qualification reports', async t => {
  const root = await mkdtemp(join(tmpdir(), 'verify-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), outbox = join(root, 'outbox');
  await mkdir(bin); await mkdir(outbox);
  const hook = await readFile(new URL('../.c2/recipes/hooks/build/verify.yaml', import.meta.url), 'utf8');
  const run = hook.split('    run: |\n')[1].split('\noutputs:')[0].split('\n').map(s => s.slice(6)).join('\n');
  await writeFile(join(bin, 'git'), `#!/bin/sh
printf 'git\\n' >> "$OUTBOX/calls"
case "$1" in
  rev-parse) if [ "$FAIL_STAGE" = git ]; then printf wrong; else printf candidate; fi;;
  status) if [ "$FAIL_STAGE" = dirty ]; then printf " M fixture"; fi;;
esac
`, { mode: 0o700 });
  await writeFile(join(bin, 'pnpm'), `#!/bin/sh
printf 'pnpm %s\\n' "$*" >> "$OUTBOX/calls"
case "$1" in
  --version) if [ "$FAIL_STAGE" = pnpm ]; then printf 0; else printf 12.21.0; fi;;
  install) [ "$FAIL_STAGE" != install ];;
  run) [ "$2" = build ] && [ "$FAIL_STAGE" != build ];;
  pack) [ "$FAIL_STAGE" != pack ];;
  *) exit 98;;
esac
`, { mode: 0o700 });
  await writeFile(join(bin, 'node'), `#!/bin/sh
printf 'node %s\\n' "$*" >> "$OUTBOX/calls"
case "$1" in
  --version) if [ "$FAIL_STAGE" = node ]; then printf v0; else printf v24.22.3; fi;;
  -p) case "$2" in
    process.platform) if [ "$FAIL_STAGE" = platform ]; then printf darwin; else printf linux; fi;;
    process.arch) if [ "$FAIL_STAGE" = arch ]; then printf x64; else printf arm64; fi;;
    *) exit 97;;
  esac;;
  scripts/build-native.ts) [ "$FAIL_STAGE" != native ];;
  scripts/focused.ts) [ "$FAIL_STAGE" != focused ];;
  scripts/package-path.ts) [ "$FAIL_STAGE" != artifact ] && printf artifact.tgz;;
  scripts/probes/run.ts) exit 1;;
  scripts/consumers/run.ts) [ "$FAIL_STAGE" != consumers ];;
  scripts/product-report.ts) [ "$FAIL_STAGE" != report ];;
  scripts/verify.ts) [ "$FAIL_STAGE" != assess ] && [ "$FAIL_STAGE" != consumers ];;
  *) exit 99;;
esac
`, { mode: 0o700 });
  for (const stage of ['git', 'dirty', 'node', 'platform', 'arch', 'pnpm', 'install', 'native', 'focused', 'build', 'pack', 'artifact', 'consumers', 'report', 'assess', 'success']) {
    await rm(join(outbox, 'calls'), { force: true });
    for (const name of ['focused-tests', 'provider-probes', 'consumer-report', 'product-report']) await writeFile(join(outbox, name + '.json'), 'stale report');
    const stdout = execFileSync('/bin/sh', ['-c', run], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, REPO: root, OUTBOX: outbox, CANDIDATE: 'candidate', FAIL_STAGE: stage } });
    assert.equal(stdout, stage === 'success' ? 'passed' : 'failed');
    const calls = await readFile(join(outbox, 'calls'), 'utf8');
    if (!['git', 'dirty', 'node', 'platform', 'arch', 'pnpm', 'install'].includes(stage)) {
      for (const name of ['focused-tests', 'provider-probes', 'consumer-report', 'product-report']) await assert.rejects(access(join(outbox, name + '.json')));
    }
    if (['git', 'dirty', 'node', 'platform', 'arch', 'pnpm', 'install', 'native', 'focused', 'build', 'pack', 'artifact'].includes(stage)) assert.ok(!calls.includes('node scripts/probes/run.ts'), `${stage} must stop before provider launch`);
    if (['consumers', 'report', 'assess', 'success'].includes(stage)) assert.ok(calls.includes('node scripts/probes/run.ts'), 'raw negative controls do not suppress product checks');
    if (stage === 'consumers') assert.ok(calls.includes('node scripts/product-report.ts') && calls.includes('node scripts/verify.ts'), 'consumer failure reaches aggregate assessment and still fails the hook');
    if (['git', 'dirty', 'node', 'platform', 'arch', 'pnpm', 'install', 'native', 'focused', 'build', 'pack', 'artifact', 'report'].includes(stage)) assert.ok(!calls.includes('node scripts/verify.ts'), `${stage} must stop before assessment`);
  }
});

test('candidate defers actual publication checks without passing them; published assessment requires them and references', () => {
  const candidate = healthy();
  const fabricated = healthy(); fabricated.productChecks.find(c => c.id === 'P02')!.status = 'passed';
  assert.ok(assess(fabricated, source, 'candidate', 'lock', 'artifact').some(f => f.startsWith('P02:')));
  const published: any = { ...healthy(), phase: 'published' };
  assert.ok(assess(published, source, 'candidate', 'lock', 'artifact').includes('Missing or mismatched actual publication references'));
  published.publication = { url: 'https://example.invalid/synthetic-validator-fixture', version: 'fixture', integrity: 'fixture', sourceCommit: 'candidate', artifactSha256: 'artifact' };
  assert.ok(assess(published, source, 'candidate', 'lock', 'artifact').includes('P02: not_run'));
  published.productChecks = acceptanceIds.map(id => ({ id, status: 'passed' }));
  assert.deepEqual(assess(published, source, 'candidate', 'lock', 'artifact'), []);
  assert.deepEqual(assess(candidate, source, 'candidate', 'lock', 'artifact'), []);
});

test('focused runner records each failed local check and never launches later checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'focused-runner-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin')); await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'pnpm-lock.yaml'), 'fixture lock');
  await writeFile(join(root, 'bin/git'), '#!/bin/sh\nif [ "$1" = rev-parse ]; then printf candidate; fi\n', { mode: 0o700 });
  await writeFile(join(root, 'bin/pnpm'), '#!/bin/sh\nif [ "$2" = "$FAIL_STAGE" ]; then exit 23; fi\n', { mode: 0o700 });
  await writeFile(join(root, 'scripts/check-project-dependencies.ts'), "if (process.env.FAIL_STAGE === 'metadata') process.exit(23);");
  const runner = new URL('../scripts/focused.ts', import.meta.url);
  for (const [index, stage] of ['metadata', 'typecheck', 'test:codecs', 'test:core', 'test:qualification', 'success'].entries()) {
    const report = join(root, 'focused.json');
    let code = 0;
    try { execFileSync(process.execPath, [runner.pathname, '--report', report], { cwd: root, env: { ...process.env, PATH: join(root, 'bin') + ':/usr/bin:/bin', FAIL_STAGE: stage }, stdio: 'pipe' }); }
    catch (error: any) { code = error.status; }
    const actual = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(code, stage === 'success' ? 0 : 1); assert.equal(actual.status, stage === 'success' ? 'passed' : 'failed');
    assert.equal(actual.commands.length, Math.min(index + 1, 5)); assert.equal(actual.commands.at(-1).code, stage === 'success' ? 0 : 23);
    assert.equal(actual.sourceUnchanged, true);
  }
});

test('publication harness rejects invalid references without launching consumers or requesting credentials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'publication-harness-')); t.after(() => rm(root, { recursive: true, force: true }));
  const reference = join(root, 'reference.json'), published = join(root, 'published.json');
  await writeFile(reference, JSON.stringify({ url: 'https://example.invalid/synthetic-negative-fixture', version: 'fixture', sourceCommit: 'wrong', integrity: 'sha256-ZmFrZQ==' }));
  assert.throws(() => execFileSync(process.execPath, ['scripts/published.ts', '--reference', reference, '--report', published], { env: { PATH: process.env.PATH }, stdio: 'pipe' }));
  const failed = JSON.parse(await readFile(published, 'utf8')); assert.equal(failed.status, 'failed'); assert.equal(failed.publication, undefined); assert.deepEqual(failed.commands, []);
  assert.equal(failed.validationPolicy.mode, 'mock-api');
});

test('the hook uses mock APIs without a provider-secret prerequisite', async () => {
  const hook = await readFile(new URL('../.c2/recipes/hooks/build/verify.yaml', import.meta.url), 'utf8');
  assert.ok(!/scripts\/live|--live|PORTABLE_AUTH_CONFIG|--auth-config/.test(hook));
  const report = { ...healthy(), validationPolicy: undefined };
  assert.ok(assess(report, source, 'candidate', 'lock', 'artifact').includes('Missing mock API validation policy'));
});

test('hook artifact projection satisfies the reserved-name contract on complete and early-failure output', async () => {
  const hook = await readFile(new URL('../.c2/recipes/hooks/build/verify.yaml', import.meta.url), 'utf8');
  // Execute the actual hook filter, including when failed commands produced only a log.
  const filter = hook.match(/^  artifact_refs: \$\{\{ jq\(sequence\.verify\.artifacts, '([^']+)'\) \}\}$/m)?.[1];
  assert.ok(filter, 'the hook must project artifacts before returning them');
  const schema = JSON.parse(await readFile(new URL('./fixtures/build-hook-artifact-refs.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ strict: true }).compile(schema);
  const ref = (name: string) => ({ kind: 'stored', name, stored: { key: { jobId: 'fixture', taskOrdinal: 152, name } } });
  const reserved = Object.fromEntries(schema.propertyNames.not.enum.map((name: string) => [name, ref(name)]));
  const complete = Object.fromEntries(['tests.log', 'focused-tests.json', 'provider-probes.json', 'consumer-report.json', 'product-report.json', 'acp-plus-session-0.1.0-candidate.0.tgz', '_c2j/git-stderr.txt'].map(name => [name, ref(name)]));
  for (const visible of [complete, { 'tests.log': ref('tests.log') }, {}]) {
    const raw = { ...visible, ...reserved };
    assert.equal(validate(raw), false, 'the unfiltered runtime map reproduces the output-contract failure');
    const projected = JSON.parse(execFileSync('jq', ['-c', filter], { input: JSON.stringify(raw), encoding: 'utf8' }));
    assert.equal(validate(projected), true, JSON.stringify(validate.errors));
    assert.deepEqual(projected, visible, 'preserve every available diagnostic reference unchanged');
  }
  assert.deepEqual(JSON.parse(execFileSync('jq', ['-c', filter], { input: '{}', encoding: 'utf8' })), {});
});
