/**
 * verification-depth-wiring-smoketest — proves the R1 adapter chain that
 * openswanSessionRuntime runs at the `autoExecuteVerification` seam:
 *
 *   toolEvents → buildVerificationReceipt().editedFiles → planVerificationDepth()
 *   → rebuild taskPlan.verification (upgrade required-falsy planned indices +
 *     ADD the auto-runnable missing kinds; 'build' is skipped because the
 *     auto-executor can't run it).
 *
 * Both cores are import-free / tsx-loadable (no react-native reach). This mirrors
 * the runtime rebuild EXACTLY so the wiring can't silently drift from the cores.
 *
 * Run: npx tsx scripts/verification-depth-wiring-smoketest.ts
 */

import { planVerificationDepth } from '../src/lib/verificationDepthPolicyCore';
import { buildVerificationReceipt } from '../src/lib/verificationReceiptCore';

let failures = 0;
const fail = (m: string) => { failures += 1; console.error('FAIL:', m); };
const pass = (m: string) => console.log('pass:', m);
const expect = (c: unknown, m: string) => { if (!c) fail(m); };

// The auto-runnable kinds the runtime may ADD (LOCKSTEP with the seam + with
// openswanVerificationRuntime — typecheck/tests/lint only; 'build' excluded).
const AUTO_ADDABLE = new Set<string>(['typecheck', 'tests', 'lint']);

type Check = { id: string; kind: string; required: boolean; label: string; reason: string };

// Byte-for-byte mirror of the runtime rebuild at openswanSessionRuntime's seam.
function applyDepth(planned: Check[], changed: unknown): { rebuilt: Check[]; tier: string; required: string[] } {
  const depth = planVerificationDepth({ changedFiles: changed, taskKind: 'build', plannedChecks: planned });
  const upgradeSet = new Set(depth.upgradeIndices);
  const rebuilt: Check[] = planned.map((c, i) => (upgradeSet.has(i) ? { ...c, required: true } : c));
  for (const kind of depth.missingKinds) {
    if (!AUTO_ADDABLE.has(kind)) continue; // skip 'build' etc.
    rebuilt.push({ id: `depth-${kind}`, kind, required: true, label: `Run ${kind} (risk: ${depth.riskTier})`, reason: depth.reason });
  }
  return { rebuilt, tier: depth.riskTier, required: [...depth.requiredKinds] };
}

// plannedChecks mirroring openswanTaskPlanner.buildVerification('build') base set
// (typecheck required, integration_review required, lint OPTIONAL).
const buildPlan = (): Check[] => [
  { id: 'typecheck', label: 'Typecheck changed code', kind: 'typecheck', required: true, reason: 'compile cleanly' },
  { id: 'integration', label: 'Check integration boundaries', kind: 'integration_review', required: true, reason: 'fit architecture' },
  { id: 'lint', label: 'Check lint/format expectations', kind: 'lint', required: false, reason: 'style' },
];

// ── High-risk change: a schema migration + an auth file ───────────────────────
{
  const toolEvents = [
    { tool: 'desktop.edit_file', status: 'passed', input: { path: 'supabase/migrations/0001_x.sql' } },
    { tool: 'desktop.edit_file', status: 'passed', input: { path: 'src/lib/authSession.ts' } },
  ];
  const changed = buildVerificationReceipt({ editedFiles: toolEvents }).editedFiles;
  expect(changed.length === 2, 'receipt extracts both edited paths');

  const { rebuilt, tier, required } = applyDepth(buildPlan(), changed);
  expect(tier === 'high', `schema+auth → high tier (got ${tier})`);
  for (const k of ['tests', 'lint', 'typecheck']) {
    expect(required.includes(k), `requiredKinds ⊇ [tests,lint,typecheck] — missing ${k}`);
  }
  // Planned optional lint → upgraded to required IN PLACE (same id).
  expect(rebuilt.find((c) => c.id === 'lint')?.required === true, 'planned optional lint upgraded to required');
  // Absent tests → ADDED as a required depth check.
  const tests = rebuilt.find((c) => c.id === 'depth-tests');
  expect(tests?.required === true && tests?.kind === 'tests', 'missing tests ADDED as required depth-tests');
  // 'build' is NOT auto-runnable → never added.
  expect(!rebuilt.some((c) => c.kind === 'build'), "'build' is never added (auto-executor can't run it)");
  // Already-required typecheck is not duplicated.
  expect(rebuilt.filter((c) => c.kind === 'typecheck').length === 1, 'already-required typecheck not duplicated');
  // Strictly-more-conservative: every originally-required check stays required,
  // and nothing was removed.
  expect(rebuilt.length >= buildPlan().length, 'no planned check removed');
  for (const id of buildPlan().filter((c) => c.required).map((c) => c.id)) {
    expect(rebuilt.find((c) => c.id === id)?.required === true, `originally-required ${id} stays required`);
  }
  pass('high-risk (schema+auth): tier high, lint upgraded, tests added, build skipped');
}

// ── Docs-only change: fail-safe no-op ─────────────────────────────────────────
{
  const toolEvents = [
    { tool: 'desktop.edit_file', status: 'passed', input: { path: 'docs/AGENTS_ROADMAP.md' } },
    { tool: 'desktop.edit_file', status: 'passed', input: { path: 'README.md' } },
  ];
  const changed = buildVerificationReceipt({ editedFiles: toolEvents }).editedFiles;
  const planned = buildPlan();
  const before = JSON.stringify(planned);
  const { rebuilt, tier, required } = applyDepth(planned, changed);
  expect(tier === 'low', `docs-only → low tier (got ${tier})`);
  expect(required.length === 0, 'docs-only → requiredKinds []');
  // No upgrade + no addition → the rebuilt plan deep-equals the original.
  expect(JSON.stringify(rebuilt) === before, 'docs-only → taskPlan.verification byte-unchanged (fail-safe no-op)');
  pass('docs-only: tier low, plan byte-unchanged');
}

// ── Empty changed set: neutral no-op ──────────────────────────────────────────
{
  const planned = buildPlan();
  const before = JSON.stringify(planned);
  const { rebuilt, tier, required } = applyDepth(planned, []);
  expect(tier === 'low', 'no changed files → low tier');
  expect(required.length === 0, 'no changed files → requiredKinds []');
  expect(JSON.stringify(rebuilt) === before, 'no changed files → plan unchanged');
  pass('empty changed set: neutral no-op');
}

// ── Single elevated file: tests upgraded, no manual build required ─────────────
{
  const toolEvents = [
    { tool: 'desktop.edit_file', status: 'passed', input: { path: 'supabase/functions/swanbot-v2-ai/index.ts' } },
  ];
  const changed = buildVerificationReceipt({ editedFiles: toolEvents }).editedFiles;
  const { rebuilt, tier, required } = applyDepth(buildPlan(), changed);
  expect(tier === 'elevated', `single edge file → elevated tier (got ${tier})`);
  expect(required.includes('tests') && required.includes('typecheck'), 'elevated requires tests+typecheck');
  expect(!rebuilt.some((c) => c.kind === 'build'), 'elevated never adds build');
  pass('elevated (single edge file): tests+typecheck required, no build');
}

if (failures > 0) {
  console.error(`\n${failures} verification-depth wiring smoke failure(s)`);
  process.exit(1);
}
console.log('\nAll verification-depth wiring smoke cases passed.');
