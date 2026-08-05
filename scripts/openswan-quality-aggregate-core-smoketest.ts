// Smoke test for src/lib/openswanQualityAggregateCore.ts
// Run: npx tsx scripts/openswan-quality-aggregate-core-smoketest.ts
//
// Verifies the total normalizer + hardened aggregator: missing/NaN/huge/hostile
// rows never throw, produce sensible finite defaults, byOutcome never has an
// undefined key, and averages over empty input are 0.

import {
  normalizeObservedEval,
  aggregateRunQuality,
} from '../src/lib/openswanQualityAggregateCore';

let passes = 0;
let failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function isFiniteNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}
function noThrow(fn: () => unknown, m: string): unknown {
  try {
    const r = fn();
    passes++;
    return r;
  } catch (err) {
    failures++;
    console.error('FAIL: ' + m + ' :: threw ' + String(err));
    return undefined;
  }
}

function main() {
  // 1. normalizeObservedEval — total defaults on empty/missing input
  const nEmpty = normalizeObservedEval({});
  assertEq(nEmpty.score, 0, '1: empty score -> 0');
  assertEq(nEmpty.outcome, 'partial', '1: empty outcome -> partial');
  assertEq(nEmpty.verification.coverageRatio, 0, '1: empty coverageRatio -> 0');
  assertEq(nEmpty.durationMs, 0, '1: empty durationMs -> 0');
  assertEq(nEmpty.costUsd, 0, '1: empty costUsd -> 0');
  assert(!!nEmpty.verification && typeof nEmpty.verification === 'object', '1: verification is object');

  // 2. normalizeObservedEval — null/undefined/wrong-type raw -> neutral
  for (const bad of [null, undefined, 42, 'str', true, false, () => 0, Symbol('x')]) {
    const n = normalizeObservedEval(bad as unknown);
    assertEq(n.score, 0, '2: bad raw score -> 0 (' + String(typeof bad) + ')');
    assertEq(n.outcome, 'partial', '2: bad raw outcome -> partial');
    assertEq(n.verification.coverageRatio, 0, '2: bad raw coverage -> 0');
    assert(isFiniteNum(n.durationMs) && n.durationMs === 0, '2: bad raw durationMs -> 0');
  }

  // 3. score clamping
  assertEq(normalizeObservedEval({ score: 87.6 }).score, 88, '3: score rounds 87.6 -> 88');
  assertEq(normalizeObservedEval({ score: 87.4 }).score, 87, '3: score rounds 87.4 -> 87');
  assertEq(normalizeObservedEval({ score: 1e9 }).score, 100, '3: huge score -> 100');
  assertEq(normalizeObservedEval({ score: -50 }).score, 0, '3: negative score -> 0');
  assertEq(normalizeObservedEval({ score: NaN }).score, 0, '3: NaN score -> 0');
  assertEq(normalizeObservedEval({ score: Infinity }).score, 0, '3: Infinity score -> 0');
  assertEq(normalizeObservedEval({ score: -Infinity }).score, 0, '3: -Infinity score -> 0');
  assertEq(normalizeObservedEval({ score: '75' }).score, 75, '3: numeric string score -> 75');
  assertEq(normalizeObservedEval({ score: 'abc' }).score, 0, '3: non-numeric string score -> 0');
  assertEq(normalizeObservedEval({ score: '' }).score, 0, '3: empty string score -> 0');
  assertEq(normalizeObservedEval({ score: {} }).score, 0, '3: object score -> 0');
  assertEq(normalizeObservedEval({ score: [] }).score, 0, '3: array score -> 0');
  assertEq(normalizeObservedEval({ score: 100 }).score, 100, '3: exact 100 -> 100');
  assertEq(normalizeObservedEval({ score: 0 }).score, 0, '3: exact 0 -> 0');

  // 4. outcome normalization
  assertEq(normalizeObservedEval({ outcome: 'strong' }).outcome, 'strong', '4: strong kept');
  assertEq(normalizeObservedEval({ outcome: 'blocked' }).outcome, 'blocked', '4: blocked kept');
  assertEq(normalizeObservedEval({ outcome: 'failed' }).outcome, 'failed', '4: failed kept');
  assertEq(normalizeObservedEval({ outcome: 'STRONG' }).outcome, 'strong', '4: uppercase -> lower');
  assertEq(normalizeObservedEval({ outcome: '  Partial  ' }).outcome, 'partial', '4: trimmed');
  assertEq(normalizeObservedEval({ outcome: 'weird' }).outcome, 'partial', '4: unknown -> partial');
  assertEq(normalizeObservedEval({ outcome: '' }).outcome, 'partial', '4: empty -> partial');
  assertEq(normalizeObservedEval({ outcome: 123 }).outcome, 'partial', '4: number outcome -> partial');
  assertEq(normalizeObservedEval({ outcome: null }).outcome, 'partial', '4: null outcome -> partial');
  assertEq(normalizeObservedEval({ outcome: {} }).outcome, 'partial', '4: object outcome -> partial');
  assertEq(normalizeObservedEval({ outcome: 'a'.repeat(5000) }).outcome, 'partial', '4: giant outcome -> partial');

  // 5. verification.coverageRatio normalization
  assertEq(normalizeObservedEval({ verification: { coverageRatio: 0.75 } }).verification.coverageRatio, 0.75, '5: 0.75 kept');
  assertEq(normalizeObservedEval({ verification: { coverageRatio: 5 } }).verification.coverageRatio, 1, '5: huge ratio -> 1');
  assertEq(normalizeObservedEval({ verification: { coverageRatio: -1 } }).verification.coverageRatio, 0, '5: negative ratio -> 0');
  assertEq(normalizeObservedEval({ verification: { coverageRatio: NaN } }).verification.coverageRatio, 0, '5: NaN ratio -> 0');
  assertEq(normalizeObservedEval({ verification: { coverageRatio: '0.5' } }).verification.coverageRatio, 0.5, '5: string ratio -> 0.5');
  assertEq(normalizeObservedEval({ verification: {} }).verification.coverageRatio, 0, '5: missing coverageRatio -> 0');
  assertEq(normalizeObservedEval({ verification: null }).verification.coverageRatio, 0, '5: null verification -> 0');
  assertEq(normalizeObservedEval({ verification: 'x' }).verification.coverageRatio, 0, '5: string verification -> 0');
  assertEq(normalizeObservedEval({ verification: [] }).verification.coverageRatio, 0, '5: array verification -> 0');
  assertEq(normalizeObservedEval({ verification: { coverageRatio: {} } }).verification.coverageRatio, 0, '5: object ratio -> 0');

  // 6. duration / cost normalization + caps
  assertEq(normalizeObservedEval({ durationMs: 1500 }).durationMs, 1500, '6: durationMs kept');
  assertEq(normalizeObservedEval({ durationMs: -100 }).durationMs, 0, '6: negative durationMs -> 0');
  assertEq(normalizeObservedEval({ durationMs: NaN }).durationMs, 0, '6: NaN durationMs -> 0');
  assertEq(normalizeObservedEval({ durationMs: Infinity }).durationMs, 0, '6: Infinity durationMs -> 0');
  assertEq(normalizeObservedEval({ durationMs: 1e15 }).durationMs, 1e12, '6: huge durationMs -> cap');
  assertEq(normalizeObservedEval({ durationMs: '500' }).durationMs, 500, '6: string durationMs -> 500');
  assertEq(normalizeObservedEval({ costUsd: 0.25 }).costUsd, 0.25, '6: costUsd kept');
  assertEq(normalizeObservedEval({ costUsd: -5 }).costUsd, 0, '6: negative costUsd -> 0');
  assertEq(normalizeObservedEval({ costUsd: NaN }).costUsd, 0, '6: NaN costUsd -> 0');
  assertEq(normalizeObservedEval({ costUsd: 1e12 }).costUsd, 1e9, '6: huge costUsd -> cap');

  // 7. aggregateRunQuality — empty / non-array -> zero aggregate
  for (const empty of [[], null, undefined, {}, 'x', 42, true, () => 0]) {
    const agg = aggregateRunQuality(empty as unknown);
    assertEq(agg.count, 0, '7: empty count 0 (' + String(typeof empty) + ')');
    assertEq(agg.avgScore, 0, '7: empty avgScore 0');
    assertEq(agg.avgCoverage, 0, '7: empty avgCoverage 0');
    assertEq(agg.totalCostUsd, 0, '7: empty totalCostUsd 0');
    assertEq(agg.avgDurationMs, 0, '7: empty avgDurationMs 0');
    assertEq(agg.byOutcome.strong, 0, '7: empty byOutcome.strong 0');
    assertEq(agg.byOutcome.partial, 0, '7: empty byOutcome.partial 0');
    assertEq(agg.byOutcome.blocked, 0, '7: empty byOutcome.blocked 0');
    assertEq(agg.byOutcome.failed, 0, '7: empty byOutcome.failed 0');
  }

  // 8. aggregateRunQuality — basic multi-row averages (exact math)
  const basic = aggregateRunQuality([
    { score: 80, outcome: 'strong', verification: { coverageRatio: 1 }, durationMs: 1000, costUsd: 0.1 },
    { score: 40, outcome: 'partial', verification: { coverageRatio: 0.5 }, durationMs: 3000, costUsd: 0.2 },
    { score: 0, outcome: 'failed', verification: { coverageRatio: 0 }, durationMs: 2000, costUsd: 0 },
  ]);
  assertEq(basic.count, 3, '8: count 3');
  assertEq(basic.avgScore, 40, '8: avgScore (120/3) 40');
  assertEq(basic.avgCoverage, 0.5, '8: avgCoverage (1.5/3) 0.5');
  assertEq(basic.totalCostUsd, 0.3, '8: totalCostUsd 0.3 (float-safe)');
  assertEq(basic.avgDurationMs, 2000, '8: avgDurationMs (6000/3) 2000');
  assertEq(basic.byOutcome.strong, 1, '8: byOutcome.strong 1');
  assertEq(basic.byOutcome.partial, 1, '8: byOutcome.partial 1');
  assertEq(basic.byOutcome.failed, 1, '8: byOutcome.failed 1');
  assertEq(basic.byOutcome.blocked, 0, '8: byOutcome.blocked 0');

  // 9. byOutcome never has an undefined key; unknown outcomes fold into partial
  const outcomes = aggregateRunQuality([
    { outcome: 'weird' },
    { outcome: undefined },
    { outcome: null },
    { outcome: 42 },
    { outcome: 'blocked' },
    { outcome: 'blocked' },
  ]);
  assertEq(Object.keys(outcomes.byOutcome).sort().join(','), 'blocked,failed,partial,strong', '9: exactly 4 keys');
  assert(!('weird' in outcomes.byOutcome), '9: unknown outcome not a key');
  assert(!('undefined' in outcomes.byOutcome), '9: literal "undefined" not a key');
  assertEq((outcomes.byOutcome as Record<string, number>).undefined, undefined, '9: byOutcome.undefined absent');
  assertEq(outcomes.byOutcome.partial, 4, '9: 4 folded into partial');
  assertEq(outcomes.byOutcome.blocked, 2, '9: 2 blocked');
  for (const k of Object.keys(outcomes.byOutcome)) {
    assert(isFiniteNum(outcomes.byOutcome[k]), '9: byOutcome[' + k + '] finite number');
  }

  // 10. rows missing verification / score / outcome -> no throw, sensible defaults
  const partialRows = aggregateRunQuality([
    {},
    { score: 60 },
    { outcome: 'strong' },
    { verification: { coverageRatio: 1 } },
    { durationMs: 500 },
  ]);
  assertEq(partialRows.count, 5, '10: count 5');
  assert(isFiniteNum(partialRows.avgScore) && partialRows.avgScore >= 0 && partialRows.avgScore <= 100, '10: avgScore in range');
  assert(isFiniteNum(partialRows.avgCoverage) && partialRows.avgCoverage >= 0 && partialRows.avgCoverage <= 1, '10: avgCoverage in range');
  assertEq(partialRows.avgScore, 12, '10: avgScore (60/5) 12');
  assertEq(partialRows.avgCoverage, 0.2, '10: avgCoverage (1/5) 0.2');
  assertEq(partialRows.byOutcome.strong, 1, '10: one strong');
  assertEq(partialRows.byOutcome.partial, 4, '10: four partial (defaulted)');
  assertEq(partialRows.avgDurationMs, 100, '10: avgDurationMs (500/5) 100');

  // 11. NaN / Infinity / hostile numeric inputs contribute 0, never NaN
  const nanRows = aggregateRunQuality([
    { score: NaN, verification: { coverageRatio: NaN }, durationMs: NaN, costUsd: NaN },
    { score: Infinity, verification: { coverageRatio: Infinity }, durationMs: Infinity, costUsd: Infinity },
    { score: 'nope', durationMs: 'nope', costUsd: 'nope' },
  ]);
  assertEq(nanRows.count, 3, '11: count 3');
  assertEq(nanRows.avgScore, 0, '11: avgScore 0 (no NaN)');
  assertEq(nanRows.avgCoverage, 0, '11: avgCoverage 0 (no NaN)');
  assertEq(nanRows.totalCostUsd, 0, '11: totalCostUsd 0 (no NaN)');
  assertEq(nanRows.avgDurationMs, 0, '11: avgDurationMs 0 (no NaN)');
  assert(isFiniteNum(nanRows.avgScore), '11: avgScore finite');
  assert(isFiniteNum(nanRows.totalCostUsd), '11: totalCostUsd finite');

  // 12. bounded — huge array is capped, output stays finite, never throws
  const huge = new Array(MAX_ROWS_TEST).fill({ score: 100, outcome: 'strong', verification: { coverageRatio: 1 }, durationMs: 10, costUsd: 0.001 });
  const hugeAgg = noThrow(() => aggregateRunQuality(huge), '12: huge array no throw') as ReturnType<typeof aggregateRunQuality>;
  assert(hugeAgg.count <= 100000, '12: count bounded to <= MAX_ROWS');
  assertEq(hugeAgg.count, 100000, '12: count clamped to MAX_ROWS (100000)');
  assertEq(hugeAgg.avgScore, 100, '12: avgScore 100');
  assertEq(hugeAgg.avgCoverage, 1, '12: avgCoverage 1');
  assert(isFiniteNum(hugeAgg.totalCostUsd), '12: totalCostUsd finite under load');
  assert(isFiniteNum(hugeAgg.avgDurationMs), '12: avgDurationMs finite under load');

  // 12b. huge-but-finite field values do not overflow sums to Infinity
  const bigVals = aggregateRunQuality(new Array(1000).fill({ costUsd: 1e9, durationMs: 1e12 }));
  assert(isFiniteNum(bigVals.totalCostUsd), '12b: totalCostUsd finite (capped rows)');
  assert(isFiniteNum(bigVals.avgDurationMs), '12b: avgDurationMs finite (capped rows)');

  // 13. HOSTILE — never throws on cyclic / throwing-getter / exotic inputs
  const cyc: Record<string, unknown> = { score: 50, outcome: 'strong' };
  cyc.self = cyc;
  cyc.verification = cyc; // verification points back at the cyclic object
  const cycOut = noThrow(() => normalizeObservedEval(cyc), '13: cyclic normalize no throw') as ReturnType<typeof normalizeObservedEval>;
  assertEq(cycOut.score, 50, '13: cyclic score read');
  assertEq(cycOut.verification.coverageRatio, 0, '13: cyclic verification -> 0 (no coverageRatio prop)');
  noThrow(() => aggregateRunQuality([cyc, cyc, cyc]), '13: cyclic rows aggregate no throw');

  const throwingGetter: Record<string, unknown> = {};
  Object.defineProperty(throwingGetter, 'score', { get() { throw new Error('boom score'); }, enumerable: true });
  Object.defineProperty(throwingGetter, 'verification', { get() { throw new Error('boom verif'); }, enumerable: true });
  Object.defineProperty(throwingGetter, 'outcome', { get() { throw new Error('boom outcome'); }, enumerable: true });
  const tgOut = noThrow(() => normalizeObservedEval(throwingGetter), '13: throwing-getter no throw') as ReturnType<typeof normalizeObservedEval>;
  assertEq(tgOut.score, 0, '13: throwing score -> 0');
  assertEq(tgOut.outcome, 'partial', '13: throwing outcome -> partial');
  assertEq(tgOut.verification.coverageRatio, 0, '13: throwing verification -> 0');
  noThrow(() => aggregateRunQuality([throwingGetter, throwingGetter]), '13: throwing-getter rows no throw');

  // 13b. nested throwing coverageRatio getter
  const throwingRatio = { verification: {} as Record<string, unknown> };
  Object.defineProperty(throwingRatio.verification, 'coverageRatio', { get() { throw new Error('boom ratio'); }, enumerable: true });
  const trOut = noThrow(() => normalizeObservedEval(throwingRatio), '13b: throwing coverageRatio no throw') as ReturnType<typeof normalizeObservedEval>;
  assertEq(trOut.verification.coverageRatio, 0, '13b: throwing coverageRatio -> 0');

  // 13c. exotic values / arrays / mixed junk as rows -> no throw
  noThrow(() => aggregateRunQuality([null, undefined, 1, 'x', true, [], {}, () => 0, Symbol('s')] as unknown), '13c: junk rows no throw');
  noThrow(() => aggregateRunQuality([{ score: [1, 2], outcome: ['x'], verification: [], durationMs: {}, costUsd: {} }]), '13c: array-valued fields no throw');
  noThrow(() => normalizeObservedEval(Object.create(null)), '13c: null-proto object no throw');
  const bigOutcome = noThrow(() => aggregateRunQuality([{ outcome: 'z'.repeat(100000) }]), '13c: giant outcome string no throw') as ReturnType<typeof aggregateRunQuality>;
  assertEq(bigOutcome.byOutcome.partial, 1, '13c: giant outcome folds to partial');
  assertEq(Object.keys(bigOutcome.byOutcome).length, 4, '13c: byOutcome still 4 keys');

  // 14. determinism — same input, same output (pure)
  const inp = [{ score: 33, outcome: 'strong', verification: { coverageRatio: 0.4 }, durationMs: 12, costUsd: 0.01 }];
  assertEq(JSON.stringify(aggregateRunQuality(inp)), JSON.stringify(aggregateRunQuality(inp)), '14: deterministic aggregate');
  assertEq(JSON.stringify(normalizeObservedEval(inp[0])), JSON.stringify(normalizeObservedEval(inp[0])), '14: deterministic normalize');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll openswan-quality-aggregate-core smoke cases passed (' + passes + ' passed).');
}

// Kept small enough to run instantly while still exceeding MAX_ROWS (100000).
const MAX_ROWS_TEST = 100002;

main();
