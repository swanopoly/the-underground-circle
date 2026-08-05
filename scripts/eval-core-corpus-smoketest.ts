/**
 * eval-core-corpus-smoketest — guards the DETERMINISTIC tier-1 regression corpus
 * (`evals/coreGoldenCorpus.ts`), the model-free golden net over the highest-value
 * PURE cores this session built for
 * docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md (ADD #1, the eval CI gate).
 *
 * This smoke IS the regression assertion: it runs every golden case in the corpus
 * and requires ALL of them to pass. Each case pins the exact output of a real
 * pure core on a fixed input, so if a future consolidation drifts a core's
 * behavior, its case flips pass→fail and this smoke exits non-zero — with no API
 * keys, no network, and no flakiness.
 *
 * Covers:
 *   - Corpus shape & coverage: ≥40 cases across ≥8 suites, unique ids, valid
 *     fields, and the ten expected core suites all present.
 *   - The net itself: EVERY case in CORE_GOLDEN_CORPUS passes (the drift alarm).
 *   - runCoreGoldenCorpus(): one result row per case, each with the right suite
 *     and passed:true; the row shape matches the planned evalGateCore contract.
 *   - Harness self-check: a deliberately-wrong (known-false) case is DETECTED as
 *     passed:false, proving the net would actually catch a regression.
 *   - Hostile no-throw group: a case whose run() throws → row passed:false with a
 *     detail (never crashes); a null / {} / run-less garbage case → passed:false.
 *
 * Imports the REAL corpus module (which imports the REAL pure cores at runtime —
 * the spec-sanctioned exception; every core is dependency-light + tsx-loadable).
 *
 * Run: npx tsx scripts/eval-core-corpus-smoketest.ts
 */

import {
  CORE_GOLDEN_CORPUS,
  runCoreGoldenCase,
  runCoreGoldenCorpus,
  coreGoldenSuites,
  type CoreGoldenCase,
} from '../evals/coreGoldenCorpus';

let passes = 0,
  failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

/** The ten core suites the corpus must cover (the highest-value cores). */
const EXPECTED_SUITES = [
  'approval',
  'command',
  'cache_split',
  'lane',
  'memory',
  'checkpoint',
  'otel',
  'message_metadata',
  'tool_result_summary',
  'run_and_fix_gate',
];

function main(): void {
  // ── Group 1: corpus shape & coverage ──────────────────────────────────────
  assert(Array.isArray(CORE_GOLDEN_CORPUS), '1.1 corpus is an array');
  assert(CORE_GOLDEN_CORPUS.length >= 40, `1.2 corpus has >=40 cases (has ${CORE_GOLDEN_CORPUS.length})`);

  const suites = coreGoldenSuites();
  assert(suites.length >= 8, `1.3 corpus spans >=8 suites (has ${suites.length})`);

  const ids = new Set<string>();
  let dupeIds = 0;
  let badFields = 0;
  for (const c of CORE_GOLDEN_CORPUS) {
    if (ids.has(c.id)) dupeIds++;
    ids.add(c.id);
    if (
      typeof c.id !== 'string' ||
      c.id.length === 0 ||
      typeof c.suite !== 'string' ||
      c.suite.length === 0 ||
      typeof c.run !== 'function' ||
      typeof c.describe !== 'string' ||
      c.describe.length === 0
    ) {
      badFields++;
    }
  }
  assertEq(dupeIds, 0, '1.4 all case ids are unique');
  assertEq(badFields, 0, '1.5 every case has valid id/suite/run/describe fields');
  assertEq(ids.size, CORE_GOLDEN_CORPUS.length, '1.6 id count equals case count');

  for (const s of EXPECTED_SUITES) {
    assert(suites.indexOf(s) !== -1, `1.7 expected suite present: ${s}`);
  }

  // ── Group 2: THE REGRESSION NET — every golden case passes ─────────────────
  // If a core drifts, exactly its case(s) flip to passed:false here.
  let corpusPassed = 0;
  for (const c of CORE_GOLDEN_CORPUS) {
    const row = runCoreGoldenCase(c);
    if (row.passed) corpusPassed++;
    assert(row.passed === true, `2.x golden holds: ${c.suite}/${c.id}`, row.detail);
  }
  assertEq(corpusPassed, CORE_GOLDEN_CORPUS.length, '2.0 EVERY golden case passed (no drift)');

  // ── Group 3: runCoreGoldenCorpus() row mapping + shape ─────────────────────
  const rows = runCoreGoldenCorpus();
  assertEq(rows.length, CORE_GOLDEN_CORPUS.length, '3.1 one result row per corpus case');

  let rowShapeOk = 0;
  let rowSuiteMatch = 0;
  let rowIdMatch = 0;
  let rowPassed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const src = CORE_GOLDEN_CORPUS[i];
    if (typeof row.caseId === 'string' && typeof row.suite === 'string' && typeof row.passed === 'boolean') {
      rowShapeOk++;
    }
    if (row.suite === src.suite) rowSuiteMatch++;
    if (row.caseId === src.id) rowIdMatch++;
    if (row.passed) rowPassed++;
  }
  assertEq(rowShapeOk, rows.length, '3.2 every row has {caseId,suite,passed} of the right types');
  assertEq(rowSuiteMatch, rows.length, '3.3 every row.suite matches its source case');
  assertEq(rowIdMatch, rows.length, '3.4 every row.caseId matches its source case');
  assertEq(rowPassed, rows.length, '3.5 every row passed');
  // Passing rows carry no failure detail.
  assert(
    rows.every((r) => r.passed === true && r.detail === undefined),
    '3.6 passing rows carry no detail',
  );

  // ── Group 4: harness self-check — a wrong golden IS caught ──────────────────
  const knownFalse: CoreGoldenCase = {
    id: 'probe-known-false',
    suite: 'probe',
    describe: 'a deliberately-wrong golden that must be detected as failing',
    run: () => false,
  };
  const falseRow = runCoreGoldenCase(knownFalse);
  assertEq(falseRow.passed, false, '4.1 a known-false case is detected as passed:false');
  assert(typeof falseRow.detail === 'string' && falseRow.detail.length > 0, '4.2 the failing row carries a detail');
  assertEq(falseRow.caseId, 'probe-known-false', '4.3 the failing row keeps the case id');

  const knownTrue: CoreGoldenCase = {
    id: 'probe-known-true',
    suite: 'probe',
    describe: 'a trivially-true golden',
    run: () => true,
  };
  const trueRow = runCoreGoldenCase(knownTrue);
  assertEq(trueRow.passed, true, '4.4 a known-true case is detected as passed:true');

  // A non-boolean-true return (e.g. a truthy object) is treated as a mismatch,
  // never a false pass — the runner requires === true.
  const truthyNonBool: CoreGoldenCase = {
    id: 'probe-truthy-nonbool',
    suite: 'probe',
    describe: 'a run() returning a truthy non-true value must NOT pass',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (() => ({} as unknown)) as unknown as () => boolean,
  };
  assertEq(runCoreGoldenCase(truthyNonBool).passed, false, '4.5 a truthy non-true return does not pass');

  // ── Group 5: HOSTILE no-throw group ────────────────────────────────────────
  // The runner is TOTAL: a throwing case, or a hostile/garbage case object,
  // becomes a passed:false row and never crashes the run.
  let hostileThrew = false;
  let thrownRow: { passed: boolean; detail?: string } = { passed: true };
  try {
    const thrower: CoreGoldenCase = {
      id: 'probe-throws',
      suite: 'probe',
      describe: 'a run() that throws must yield passed:false, not a crash',
      run: () => {
        throw new Error('boom');
      },
    };
    thrownRow = runCoreGoldenCase(thrower);
  } catch {
    hostileThrew = true;
  }
  assertEq(hostileThrew, false, '5.1 a throwing case does not crash the runner');
  assertEq(thrownRow.passed, false, '5.2 a throwing case yields passed:false');
  assert(typeof thrownRow.detail === 'string' && /threw/.test(thrownRow.detail as string), '5.3 the thrown row details the throw');

  // Garbage case objects — the runner must survive each.
  let garbageThrew = false;
  const garbage: unknown[] = [null, undefined, 42, 'nope', {}, { id: 'x', suite: 'y' }, { id: 'z', suite: 's', run: 'not-a-fn' }];
  const garbageRows: Array<{ passed: boolean }> = [];
  try {
    for (const g of garbage) {
      garbageRows.push(runCoreGoldenCase(g as CoreGoldenCase));
    }
  } catch {
    garbageThrew = true;
  }
  assertEq(garbageThrew, false, '5.4 hostile/garbage case objects never crash the runner');
  assert(garbageRows.every((r) => r.passed === false), '5.5 every garbage case object → passed:false');
  assertEq(garbageRows.length, garbage.length, '5.6 every garbage input produced a row');

  // The full corpus run itself is total (already exercised in Group 3, re-assert
  // it does not throw when called again — determinism + no hidden clock state).
  let rerunThrew = false;
  let rerun: ReturnType<typeof runCoreGoldenCorpus> = [];
  try {
    rerun = runCoreGoldenCorpus();
  } catch {
    rerunThrew = true;
  }
  assertEq(rerunThrew, false, '5.7 runCoreGoldenCorpus() is total (re-run does not throw)');
  assertEq(rerun.length, CORE_GOLDEN_CORPUS.length, '5.8 the re-run returns one row per case');
  // Determinism: the two independent runs produce identical pass/fail per case.
  assert(
    rerun.every((r, i) => r.passed === rows[i].passed && r.caseId === rows[i].caseId),
    '5.9 the corpus run is deterministic (two runs agree)',
  );

  // ── Group 6: per-suite population (each expected suite has >=1 case) ────────
  for (const s of EXPECTED_SUITES) {
    const count = CORE_GOLDEN_CORPUS.filter((c) => c.suite === s).length;
    assert(count >= 1, `6.x suite has at least one case: ${s} (${count})`);
  }
  // No stray suites outside the expected set.
  assert(
    suites.every((s) => EXPECTED_SUITES.indexOf(s) !== -1),
    '6.0 corpus has no unexpected suites',
  );

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll eval-core-corpus smoke cases passed (' + passes + ' passed).');
}
main();
