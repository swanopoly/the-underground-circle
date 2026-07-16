/**
 * eval-gate-core-smoketest — the pure CI-gate BRAIN (src/lib/evalGateCore.ts)
 * behind ADD #1 in docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md
 * (scripts/run-evals.ts turns raw case results into a pass/fail merge verdict
 * with baseline regression detection). Load-bearing assertions:
 *
 *   SUMMARIZE: total/passed/failed/passRate over deduped (last-wins) results;
 *   passRate is 0 when total is 0, 4dp otherwise; failedIds sorted + capped at
 *   200; bySuite buckets by suite with a 'default' fallback and sums to total.
 *
 *   BASELINE DIFF: pass→fail is a REGRESSION (regressed true); fail→pass is a
 *   FIX (not a regression); id set diffs drive newCases/droppedCases; a dropped
 *   case that passed in baseline is NOT a regression; object-map baseline form;
 *   deterministic regardless of input order.
 *
 *   GATE: all-pass + no baseline → exit 0; a regression → exit 1 (default
 *   failOnRegression); passRate < minPassRate → exit 1 (0.85 vs 0.9); the
 *   minPassRate boundary passes (0.9 vs 0.9); failOnRegression:false disables
 *   the regression gate; empty input → total 0 → exit 1 under the default 1.0
 *   floor (fail closed) but 0 under a 0 floor; unparseable summary → exit 1.
 *
 *   REPORT: the exact `evals: 96/96 pass (100%) · 0 regressions` shape; the
 *   no-comparison variant drops the suffix; fixes are appended; secret-free.
 *
 *   And: every export is total — null/undefined/wrong/huge/hostile(throwing
 *   getters)/cyclic input never throws.
 *
 * Pure — loads under tsx (evalGateCore has zero imports).
 */

import {
  summarizeEvalRun,
  compareToBaseline,
  evalRunExitCode,
  formatGateReport,
  type EvalCaseResult,
  type EvalRunSummary,
  type BaselineComparison,
} from '../src/lib/evalGateCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function r(caseId: string, passed: boolean, suite?: string, score?: number): EvalCaseResult {
  const out: EvalCaseResult = { caseId, passed };
  if (suite !== undefined) out.suite = suite;
  if (score !== undefined) out.score = score;
  return out;
}

function main(): void {
  // ─── (1) summarize: basic counts + passRate + failedIds ───────────────────
  const base3 = [r('a', true), r('b', false), r('c', true)];
  const s1 = summarizeEvalRun(base3);
  assertEq(s1.total, 3, '(1) total counts every unique case');
  assertEq(s1.passed, 2, '(1) passed counts true results');
  assertEq(s1.failed, 1, '(1) failed = total - passed');
  assertEq(s1.passRate, round4(2 / 3), '(1) passRate is passed/total (4dp)');
  assertEq(JSON.stringify(s1.failedIds), JSON.stringify(['b']), '(1) failedIds lists the failing case');
  assert(!s1.failedIds.includes('a'), '(1) passing case not in failedIds');

  // ─── (2) summarize: passRate edges ────────────────────────────────────────
  assertEq(summarizeEvalRun([]).passRate, 0, '(2) passRate 0 when total 0');
  assertEq(summarizeEvalRun([]).total, 0, '(2) empty run total 0');
  assertEq(summarizeEvalRun([r('x', true)]).passRate, 1, '(2) all-pass → passRate 1');
  assertEq(summarizeEvalRun([r('x', false)]).passRate, 0, '(2) all-fail → passRate 0');
  assertEq(summarizeEvalRun([r('a', true), r('b', false)]).passRate, 0.5, '(2) half → 0.5');
  assertEq(summarizeEvalRun([r('a', true), r('b', true), r('c', true), r('d', false)]).passRate, 0.75, '(2) 3/4 → 0.75');

  // ─── (3) summarize: dedupe by caseId, last wins ───────────────────────────
  const s3 = summarizeEvalRun([r('dup', true), r('dup', false), r('solo', true)]);
  assertEq(s3.total, 2, '(3) duplicate ids collapse to one');
  assertEq(s3.passed, 1, '(3) last write wins (dup ended failed)');
  assert(s3.failedIds.includes('dup'), '(3) dup counted as failed (last wins)');
  const s3b = summarizeEvalRun([r('dup', false), r('dup', true)]);
  assertEq(s3b.passed, 1, '(3) last-wins the other direction (dup ended passed)');
  assertEq(s3b.failed, 0, '(3) no failures when dup ended passed');

  // ─── (4) summarize: per-suite breakdown + default bucket ──────────────────
  const s4 = summarizeEvalRun([
    r('a', true, 'safety'),
    r('b', false, 'safety'),
    r('c', true, 'routing'),
    r('d', true), // no suite → default
  ]);
  assertEq(s4.bySuite.safety.total, 2, '(4) safety suite total');
  assertEq(s4.bySuite.safety.passed, 1, '(4) safety suite passed');
  assertEq(s4.bySuite.routing.total, 1, '(4) routing suite total');
  assertEq(s4.bySuite.routing.passed, 1, '(4) routing suite passed');
  assertEq(s4.bySuite.default.total, 1, '(4) suiteless case lands in default');
  assertEq(s4.bySuite.default.passed, 1, '(4) default bucket passed');
  const suiteSum = Object.values(s4.bySuite).reduce((acc, v) => acc + v.total, 0);
  assertEq(suiteSum, s4.total, '(4) suite totals sum to overall total');
  assertEq(summarizeEvalRun([r('a', true, '   ')]).bySuite.default.total, 1, '(4) blank suite → default');

  // ─── (5) summarize: failedIds sorted + capped at 200 ──────────────────────
  const many: EvalCaseResult[] = [];
  for (let i = 0; i < 250; i += 1) many.push(r('fail-' + String(i).padStart(3, '0'), false));
  const s5 = summarizeEvalRun(many);
  assertEq(s5.total, 250, '(5) all 250 distinct cases counted');
  assertEq(s5.failed, 250, '(5) all 250 failed');
  assertEq(s5.failedIds.length, 200, '(5) failedIds capped at 200');
  const sortedCopy = s5.failedIds.slice().sort();
  assertEq(JSON.stringify(s5.failedIds), JSON.stringify(sortedCopy), '(5) failedIds are sorted');

  // ─── (6) baseline diff: pass→fail is a REGRESSION ─────────────────────────
  const baseline6 = [r('keep', true), r('reg', true)];
  const current6 = [r('keep', true), r('reg', false)];
  const c6 = compareToBaseline(current6, baseline6);
  assertEq(JSON.stringify(c6.regressions), JSON.stringify(['reg']), '(6) pass→fail flagged as regression');
  assertEq(c6.regressed, true, '(6) regressed true when a regression exists');
  assertEq(c6.fixes.length, 0, '(6) no fixes here');
  assertEq(c6.newCases.length, 0, '(6) no new cases');
  assertEq(c6.droppedCases.length, 0, '(6) no dropped cases');

  // ─── (7) baseline diff: fail→pass is a FIX, not a regression ──────────────
  const c7 = compareToBaseline([r('x', true)], [r('x', false)]);
  assertEq(JSON.stringify(c7.fixes), JSON.stringify(['x']), '(7) fail→pass flagged as fix');
  assertEq(c7.regressions.length, 0, '(7) a fix is not a regression');
  assertEq(c7.regressed, false, '(7) regressed false with only a fix');

  // ─── (8) baseline diff: new / dropped id set diffs ────────────────────────
  const c8 = compareToBaseline(
    [r('shared', true), r('brand-new', true)],
    [r('shared', true), r('gone', false)],
  );
  assertEq(JSON.stringify(c8.newCases), JSON.stringify(['brand-new']), '(8) newCases = in current, not baseline');
  assertEq(JSON.stringify(c8.droppedCases), JSON.stringify(['gone']), '(8) droppedCases = in baseline, not current');
  assertEq(c8.regressions.length, 0, '(8) unchanged shared case is not a regression');
  // a dropped case that PASSED in baseline is dropped, NOT a regression
  const c8b = compareToBaseline([r('kept', true)], [r('kept', true), r('removed', true)]);
  assertEq(JSON.stringify(c8b.droppedCases), JSON.stringify(['removed']), '(8) passing baseline case removed → dropped');
  assertEq(c8b.regressions.length, 0, '(8) a dropped (absent) case cannot regress');
  assertEq(c8b.regressed, false, '(8) regressed false for a pure drop');

  // ─── (9) baseline diff: object-map baseline form ──────────────────────────
  const c9 = compareToBaseline([r('a', false), r('b', true)], { a: true, b: false });
  assertEq(JSON.stringify(c9.regressions), JSON.stringify(['a']), '(9) object-map baseline: a pass→fail regression');
  assertEq(JSON.stringify(c9.fixes), JSON.stringify(['b']), '(9) object-map baseline: b fail→pass fix');
  assertEq(c9.regressed, true, '(9) object-map regression detected');
  assertEq(c9.newCases.length, 0, '(9) both ids present in the map → no new cases');

  // ─── (10) baseline diff: deterministic regardless of input order ──────────
  const cA = compareToBaseline([r('a', false), r('b', false), r('c', true)], [r('a', true), r('b', true), r('c', true)]);
  const cB = compareToBaseline([r('c', true), r('b', false), r('a', false)], [r('c', true), r('a', true), r('b', true)]);
  assertEq(JSON.stringify(cA), JSON.stringify(cB), '(10) comparison is order-independent (deterministic)');
  assertEq(JSON.stringify(cA.regressions), JSON.stringify(['a', 'b']), '(10) multiple regressions sorted');

  // ─── (11) gate: all-pass + no baseline → exit 0 ───────────────────────────
  const allPass = summarizeEvalRun([r('a', true), r('b', true)]);
  assertEq(evalRunExitCode(allPass), 0, '(11) all-pass, no baseline → 0');
  assertEq(evalRunExitCode(allPass, undefined), 0, '(11) explicit undefined comparison → 0');
  assertEq(evalRunExitCode(allPass, compareToBaseline([r('a', true), r('b', true)], [r('a', true), r('b', true)])), 0, '(11) all-pass with clean baseline → 0');

  // ─── (12) gate: a regression → exit 1 (isolated via minPassRate 0) ────────
  const regSummary = summarizeEvalRun(current6);
  const regComparison = compareToBaseline(current6, baseline6);
  assertEq(evalRunExitCode(regSummary, regComparison), 1, '(12) regression → 1 (default gate)');
  // isolate the regression path from the passRate floor:
  assertEq(evalRunExitCode(regSummary, regComparison, { minPassRate: 0 }), 1, '(12) regression alone → 1 even with a 0 floor');
  // and confirm the fix path does NOT block:
  assertEq(evalRunExitCode(summarizeEvalRun([r('x', true)]), c7, { minPassRate: 0 }), 0, '(12) a fix (no regression) → 0');

  // ─── (13) gate: passRate floor (minPassRate) ──────────────────────────────
  const rate85: EvalCaseResult[] = [];
  for (let i = 0; i < 20; i += 1) rate85.push(r('c' + i, i < 17)); // 17/20 = 0.85
  const s85 = summarizeEvalRun(rate85);
  assertEq(s85.passRate, 0.85, '(13) 17/20 → passRate 0.85');
  assertEq(evalRunExitCode(s85, undefined, { minPassRate: 0.9 }), 1, '(13) 0.85 < 0.9 floor → 1');
  assertEq(evalRunExitCode(s85, undefined, { minPassRate: 0.8 }), 0, '(13) 0.85 ≥ 0.8 floor → 0');
  assertEq(evalRunExitCode(s85), 1, '(13) 0.85 < default 1.0 floor → 1');
  // boundary: exactly at the floor passes
  const rate90: EvalCaseResult[] = [];
  for (let i = 0; i < 10; i += 1) rate90.push(r('d' + i, i < 9)); // 9/10 = 0.9
  assertEq(evalRunExitCode(summarizeEvalRun(rate90), undefined, { minPassRate: 0.9 }), 0, '(13) passRate == floor → 0 (boundary passes)');
  assertEq(evalRunExitCode(summarizeEvalRun(rate90)), 1, '(13) 0.9 < default 1.0 → 1');

  // ─── (14) gate: failOnRegression:false disables the regression gate ───────
  assertEq(evalRunExitCode(regSummary, regComparison, { failOnRegression: false, minPassRate: 0 }), 0, '(14) failOnRegression:false + 0 floor → regression tolerated');
  assertEq(evalRunExitCode(regSummary, regComparison, { failOnRegression: false }), 1, '(14) still blocked by the default 1.0 passRate floor');

  // ─── (15) gate: empty input → fail closed, unparseable → 1 ────────────────
  const emptySummary = summarizeEvalRun([]);
  assertEq(evalRunExitCode(emptySummary), 1, '(15) empty run → 1 under default 1.0 floor (fail closed)');
  assertEq(evalRunExitCode(emptySummary, undefined, { minPassRate: 0 }), 0, '(15) empty run → 0 under a 0 floor');
  assertEq(evalRunExitCode(undefined), 1, '(15) undefined summary → 1 (fail closed)');
  assertEq(evalRunExitCode(null), 1, '(15) null summary → 1');
  assertEq(evalRunExitCode('nope' as unknown), 1, '(15) string summary → 1');
  assertEq(evalRunExitCode(42 as unknown), 1, '(15) number summary → 1');
  assertEq(evalRunExitCode({}), 1, '(15) empty object summary → no passRate → 1');

  // ─── (16) gate: minPassRate clamping + opts robustness ────────────────────
  assertEq(evalRunExitCode(allPass, undefined, { minPassRate: 2 }), 0, '(16) minPassRate > 1 clamps to 1; all-pass still passes');
  assertEq(evalRunExitCode(s85, undefined, { minPassRate: -5 }), 0, '(16) negative floor clamps to 0 → passes');
  assertEq(evalRunExitCode(s85, undefined, { minPassRate: NaN }), 1, '(16) NaN floor falls back to default 1.0 → 1');
  assertEq(evalRunExitCode(s85, undefined, {} ), 1, '(16) empty opts → default floor 1.0 → 1');
  assertEq(evalRunExitCode(s85, undefined, 'bad' as unknown), 1, '(16) non-object opts ignored → default 1.0 → 1');

  // ─── (17) report: exact shape, secret-free ────────────────────────────────
  const rep96 = { total: 96, passed: 96, failed: 0, passRate: 1, failedIds: [], bySuite: {} } as EvalRunSummary;
  const cleanCmp: BaselineComparison = { regressions: [], fixes: [], newCases: [], droppedCases: [], regressed: false };
  assertEq(formatGateReport(rep96, cleanCmp), 'evals: 96/96 pass (100%) · 0 regressions', '(17) exact CI line shape');
  assertEq(formatGateReport(rep96), 'evals: 96/96 pass (100%)', '(17) no comparison → no regression suffix');
  assertEq(formatGateReport(s1), 'evals: 2/3 pass (67%)', '(17) pct rounds (2/3 → 67%)');
  const regCmp = compareToBaseline(current6, baseline6);
  assertEq(formatGateReport(regSummary, regCmp), 'evals: 1/2 pass (50%) · 1 regression', '(17) single regression is singular');
  const withFix: BaselineComparison = { regressions: [], fixes: ['x', 'y'], newCases: [], droppedCases: [], regressed: false };
  assertEq(formatGateReport(rep96, withFix), 'evals: 96/96 pass (100%) · 0 regressions · 2 fixed', '(17) fixes appended when > 0');
  // secret-free: a case id / detail carrying a secret never reaches the report
  const secretRun = summarizeEvalRun([{ caseId: 'sk-live-DEADBEEF', passed: false, detail: 'token=sk-live-DEADBEEF' } as EvalCaseResult]);
  const secretReport = formatGateReport(secretRun, compareToBaseline([{ caseId: 'sk-live-DEADBEEF', passed: false } as EvalCaseResult], [{ caseId: 'sk-live-DEADBEEF', passed: true } as EvalCaseResult]));
  assert(!secretReport.includes('sk-live-DEADBEEF'), '(17) report never echoes a case id / secret');
  assert(!secretReport.includes('token='), '(17) report never echoes a detail string');

  // ─── (18) report: total 0 + degenerate summaries ──────────────────────────
  assertEq(formatGateReport(summarizeEvalRun([])), 'evals: 0/0 pass (0%)', '(18) empty summary line');
  assertEq(formatGateReport(undefined), 'evals: (no results)', '(18) undefined summary → placeholder');
  assertEq(formatGateReport(null), 'evals: (no results)', '(18) null summary → placeholder');
  assertEq(formatGateReport({}), 'evals: (no results)', '(18) empty object → no results');
  assert(formatGateReport(rep96).indexOf('·') === -1, '(18) no comparison means no middot');

  // ─── (19) end-to-end: summarize → compare → gate → report ─────────────────
  {
    const priorResults = [r('open-app-simple', true, 'routing'), r('risky-approval', true, 'safety'), r('cred-opaque', true, 'safety')];
    const nowResults = [r('open-app-simple', true, 'routing'), r('risky-approval', false, 'safety'), r('cred-opaque', true, 'safety')];
    const summary = summarizeEvalRun(nowResults);
    const comparison = compareToBaseline(nowResults, priorResults);
    assertEq(summary.total, 3, '(19) e2e total');
    assertEq(summary.bySuite.safety.total, 2, '(19) e2e safety suite total');
    assertEq(comparison.regressed, true, '(19) e2e regression detected');
    assertEq(evalRunExitCode(summary, comparison), 1, '(19) e2e gate blocks the merge');
    assertEq(formatGateReport(summary, comparison), 'evals: 2/3 pass (67%) · 1 regression', '(19) e2e report line');
    // fix the regression → gate opens
    const fixedResults = [r('open-app-simple', true, 'routing'), r('risky-approval', true, 'safety'), r('cred-opaque', true, 'safety')];
    const fixedSummary = summarizeEvalRun(fixedResults);
    const fixedComparison = compareToBaseline(fixedResults, priorResults);
    assertEq(evalRunExitCode(fixedSummary, fixedComparison), 0, '(19) e2e gate opens once green');
    assertEq(formatGateReport(fixedSummary, fixedComparison), 'evals: 3/3 pass (100%) · 0 regressions', '(19) e2e green report');
  }

  // ─── (20) hostile / degenerate — nothing throws ───────────────────────────
  try {
    // summarizeEvalRun total safety
    assertEq(summarizeEvalRun(undefined).total, 0, '(20) summarize(undefined) → total 0');
    assertEq(summarizeEvalRun(null).total, 0, '(20) summarize(null) → total 0');
    assertEq(summarizeEvalRun('junk' as unknown).total, 0, '(20) summarize(string) → total 0');
    assertEq(summarizeEvalRun(42 as unknown).total, 0, '(20) summarize(number) → total 0');
    assertEq(summarizeEvalRun({} as unknown).total, 0, '(20) summarize(object) → total 0');
    // junk entries skipped; only the valid case survives
    const junk = summarizeEvalRun([null, 42, 'x', {}, { caseId: 7 }, { caseId: '' }, { caseId: '  ' }, r('ok', true)] as unknown[]);
    assertEq(junk.total, 1, '(20) junk entries skipped, one valid case');
    assertEq(junk.passed, 1, '(20) the valid case counted');
    // missing passed field → treated as failed (fail closed)
    const noPassed = summarizeEvalRun([{ caseId: 'z' } as EvalCaseResult]);
    assertEq(noPassed.passed, 0, '(20) missing passed → not counted as pass');
    assertEq(noPassed.failed, 1, '(20) missing passed → failed');
    // non-boolean passed values are not passes
    const truthy = summarizeEvalRun([{ caseId: 'a', passed: 1 } as unknown as EvalCaseResult, { caseId: 'b', passed: 'true' } as unknown as EvalCaseResult]);
    assertEq(truthy.passed, 0, '(20) truthy-but-not-true passed values are not passes');

    // hostile: throwing getters on caseId / passed / suite
    const boomId: Record<string, unknown> = {};
    Object.defineProperty(boomId, 'caseId', { enumerable: true, get() { throw new Error('boom-id'); } });
    const boomPassed: Record<string, unknown> = { caseId: 'bp' };
    Object.defineProperty(boomPassed, 'passed', { enumerable: true, get() { throw new Error('boom-passed'); } });
    const boomSuite: Record<string, unknown> = { caseId: 'bs', passed: true };
    Object.defineProperty(boomSuite, 'suite', { enumerable: true, get() { throw new Error('boom-suite'); } });
    const hostileSummary = summarizeEvalRun([boomId, boomPassed, boomSuite]);
    assertEq(hostileSummary.total, 2, '(20) throwing caseId getter drops that entry only');
    assertEq(hostileSummary.bySuite.default.total, 2, '(20) throwing suite getter → default bucket');
    assert(hostileSummary.failedIds.includes('bp'), '(20) throwing passed getter → failed');

    // cyclic structures
    const cyc: Record<string, unknown> = { caseId: 'cyc', passed: true };
    cyc.self = cyc;
    assertEq(summarizeEvalRun([cyc]).total, 1, '(20) cyclic result entry tolerated');
    const cycSummary: Record<string, unknown> = { total: 1, passed: 1, passRate: 1 };
    cycSummary.self = cycSummary;
    assertEq(evalRunExitCode(cycSummary), 0, '(20) cyclic summary tolerated by the gate');
    assert(typeof formatGateReport(cycSummary) === 'string', '(20) cyclic summary formats to a string');

    // compareToBaseline degenerate inputs
    assertEq(compareToBaseline(undefined, undefined).regressed, false, '(20) compare(undefined, undefined) → not regressed');
    assertEq(compareToBaseline(null, null).regressions.length, 0, '(20) compare(null, null) → empty');
    assertEq(compareToBaseline('a' as unknown, 5 as unknown).newCases.length, 0, '(20) compare(garbage, garbage) → empty');
    // current present, baseline garbage → everything is new, nothing regresses
    const cGarbageBase = compareToBaseline([r('a', true), r('b', false)], 'not-a-baseline' as unknown);
    assertEq(JSON.stringify(cGarbageBase.newCases), JSON.stringify(['a', 'b']), '(20) garbage baseline → all current are new');
    assertEq(cGarbageBase.regressed, false, '(20) garbage baseline → no regressions');
    // baseline present, current garbage → everything dropped
    const cGarbageCur = compareToBaseline(undefined, [r('a', true), r('b', true)]);
    assertEq(JSON.stringify(cGarbageCur.droppedCases), JSON.stringify(['a', 'b']), '(20) garbage current → all baseline dropped');
    assertEq(cGarbageCur.regressions.length, 0, '(20) garbage current → no regressions (only drops)');

    // hostile comparison object in the gate + report
    const boomCmp: Record<string, unknown> = {};
    Object.defineProperty(boomCmp, 'regressions', { enumerable: true, get() { throw new Error('boom-reg'); } });
    Object.defineProperty(boomCmp, 'regressed', { enumerable: true, get() { throw new Error('boom-reg2'); } });
    assertEq(evalRunExitCode(allPass, boomCmp, { minPassRate: 0 }), 0, '(20) hostile comparison → gate falls back to passRate');
    assert(typeof formatGateReport(rep96, boomCmp) === 'string', '(20) hostile comparison → report still a string');

    // hostile opts: a throwing getter degrades to defaults (total, no throw) —
    // so the strict default 1.0 floor still governs a sub-1.0 run → 1.
    const boomOpts: Record<string, unknown> = {};
    Object.defineProperty(boomOpts, 'minPassRate', { enumerable: true, get() { throw new Error('boom-min'); } });
    Object.defineProperty(boomOpts, 'failOnRegression', { enumerable: true, get() { throw new Error('boom-fail'); } });
    assertEq(evalRunExitCode(s85, undefined, boomOpts), 1, '(20) throwing opts getters → default strict floor → 1');
    assertEq(evalRunExitCode(allPass, undefined, boomOpts), 0, '(20) throwing opts getters → defaults; all-pass still → 0');

    // huge input stays bounded (no hang); result is sane
    const huge: EvalCaseResult[] = [];
    for (let i = 0; i < 5000; i += 1) huge.push(r('h' + i, i % 2 === 0));
    const hugeSummary = summarizeEvalRun(huge);
    assertEq(hugeSummary.total, 5000, '(20) 5000 cases counted');
    assertEq(hugeSummary.failedIds.length, 200, '(20) huge failedIds still capped at 200');
    assert(formatGateReport(hugeSummary).length <= 300, '(20) report stays bounded');

    passes += 1; // reached here without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (20) hostile inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} fail`);
    process.exit(1);
  }
  console.log(`\nAll eval-gate-core smoke cases passed (${passes} passed).`);
}

// Local mirror of the core's 4dp rounding so expectations stay exact.
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

main();
