/**
 * Smoke test for src/lib/toolSearchRelevanceCore.ts
 *
 * Pure — loads under tsx (toolSearchRelevanceCore has zero runtime imports).
 * Run: npx tsx scripts/tool-search-relevance-core-smoketest.ts
 *
 * Covers: STRONG-tier band + always-keep-top3, below-band exclusion, band
 * boundaries, WEAK-tier broad-tie collapse to top3, cap clamping, dedup,
 * determinism, boundedness, exported constants, and hostile no-throw.
 */

import {
  applyToolSearchRelevanceFloor,
  TOOL_SEARCH_STRONG_FLOOR,
  TOOL_SEARCH_BAND_RATIO,
  TOOL_SEARCH_MIN_FLOOR,
  TOOL_SEARCH_ALWAYS_KEEP,
  TOOL_SEARCH_DEFAULT_CAP,
  type ScoredTool,
} from '../src/lib/toolSearchRelevanceCore';

let passes = 0, failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Helpers -------------------------------------------------------------------
function mk(...scores: number[]): ScoredTool[] {
  return scores.map((s) => ({ tool: 't' + s, score: s }));
}
function names(r: ScoredTool[]): string[] { return r.map((x) => x.tool); }
function has(r: ScoredTool[], t: string): boolean { return r.some((x) => x.tool === t); }
function isSortedDesc(r: ScoredTool[]): boolean {
  for (let i = 1; i < r.length; i++) if (r[i].score > r[i - 1].score) return false;
  return true;
}

function main() {
  // 1) Empty / invalid inputs → [] ----------------------------------------
  assertEq(applyToolSearchRelevanceFloor([]).length, 0, '1 empty array');
  assertEq(applyToolSearchRelevanceFloor(null).length, 0, '1 null');
  assertEq(applyToolSearchRelevanceFloor(undefined).length, 0, '1 undefined');
  assertEq(applyToolSearchRelevanceFloor({}).length, 0, '1 plain object');
  assertEq(applyToolSearchRelevanceFloor('nope').length, 0, '1 string');
  assertEq(applyToolSearchRelevanceFloor(42).length, 0, '1 number');
  assertEq(applyToolSearchRelevanceFloor(true).length, 0, '1 bool');
  assertEq(applyToolSearchRelevanceFloor(NaN).length, 0, '1 NaN');
  assert(Array.isArray(applyToolSearchRelevanceFloor([])), '1 always array');
  // Array of all-invalid rows → []
  assertEq(applyToolSearchRelevanceFloor([null, {}, { tool: 5 }, { tool: 'a' }]).length, 0, '1 all-invalid rows');

  // 2) STRONG tier: band + below-band exclusion ---------------------------
  // topScore 100 → band = max(30, round(35)) = 35. Keep 100,90,80,40; drop 20.
  const s2 = applyToolSearchRelevanceFloor(mk(100, 90, 80, 40, 20));
  assertEq(s2.length, 4, '2 strong band length');
  assert(has(s2, 't40'), '2 t40 kept (>= band 35)');
  assert(!has(s2, 't20'), '2 t20 dropped (below band, beyond top3)');
  assert(has(s2, 't100') && has(s2, 't90') && has(s2, 't80'), '2 top band kept');
  assert(isSortedDesc(s2), '2 sorted desc');
  assertEq(s2[0].tool, 't100', '2 top is t100');
  assertEq(s2[0].score, 100, '2 score preserved');

  // 3) STRONG tier: always keep top ~3 even when band admits < 3 -----------
  // topScore 1000 → band 350; only 1000 >= band, but top3 kept.
  const s3 = applyToolSearchRelevanceFloor(mk(1000, 50, 40, 5));
  assertEq(s3.length, 3, '3 always-keep-top3 length');
  assert(has(s3, 't1000') && has(s3, 't50') && has(s3, 't40'), '3 top3 kept incl sub-band');
  assert(!has(s3, 't5'), '3 t5 (4th, below band) dropped');

  // 4) STRONG tier boundaries at floor 60 / band 30 -----------------------
  // topScore 60 → band = max(30, round(21)) = 30. above = {60,30} = 2 → keep top3.
  const s4 = applyToolSearchRelevanceFloor(mk(60, 30, 29, 10));
  assertEq(s4.length, 3, '4 floor-60 length');
  assert(has(s4, 't60'), '4 t60 in strong tier');
  assert(has(s4, 't30'), '4 t30 kept (== band 30)');
  assert(has(s4, 't29'), '4 t29 kept via always-top3');
  assert(!has(s4, 't10'), '4 t10 dropped');
  // topScore 60, four items at/above band 30 → aboveBand 3 → keep 3, drop 29.
  const s4b = applyToolSearchRelevanceFloor(mk(60, 31, 30, 29));
  assertEq(s4b.length, 3, '4b aboveBand==3 length');
  assert(!has(s4b, 't29'), '4b t29 dropped (below band, beyond top3)');

  // 5) WEAK tier: large tie at 35 → only top3 -----------------------------
  const weak35 = Array.from({ length: 10 }, (_, i) => ({ tool: 'w' + i, score: 35 }));
  const s5 = applyToolSearchRelevanceFloor(weak35);
  assertEq(s5.length, TOOL_SEARCH_ALWAYS_KEEP, '5 weak tie(35) → top3');
  assert(isSortedDesc(s5), '5 weak sorted');

  // 6) WEAK tier: description-noise all score 3 → top3 --------------------
  const weak3 = Array.from({ length: 12 }, (_, i) => ({ tool: 'd' + i, score: 3 }));
  assertEq(applyToolSearchRelevanceFloor(weak3).length, 3, '6 weak tie(3) → top3');

  // 7) WEAK tier: family tie at 30 (== min floor) → top3 -----------------
  const weak30 = Array.from({ length: 6 }, (_, i) => ({ tool: 'f' + i, score: 30 }));
  assertEq(applyToolSearchRelevanceFloor(weak30).length, 3, '7 weak family tie(30) → top3 (not wide set)');

  // 8) WEAK tier: clearer leader still capped at top3 ---------------------
  // (explicit unique names — mk() would dedup repeated scores by name).
  const s8 = applyToolSearchRelevanceFloor([
    { tool: 'lead', score: 47 },
    { tool: 'a', score: 12 },
    { tool: 'b', score: 12 },
    { tool: 'c', score: 12 },
    { tool: 'd', score: 12 },
  ]);
  assertEq(s8.length, 3, '8 weak leader length');
  assert(has(s8, 'lead'), '8 weak leader kept');

  // 9) cap clamping --------------------------------------------------------
  const many = Array.from({ length: 20 }, (_, i) => ({ tool: 'm' + String(i).padStart(2, '0'), score: 100 }));
  assertEq(applyToolSearchRelevanceFloor(many).length, TOOL_SEARCH_DEFAULT_CAP, '9 default cap 8 bounds strong set');
  assertEq(applyToolSearchRelevanceFloor(many, { cap: 5 }).length, 5, '9 cap 5');
  assertEq(applyToolSearchRelevanceFloor(many, { cap: 0 }).length, 1, '9 cap 0 → 1');
  assertEq(applyToolSearchRelevanceFloor(many, { cap: -3 }).length, 1, '9 cap negative → 1');
  assertEq(applyToolSearchRelevanceFloor(many, { cap: NaN }).length, TOOL_SEARCH_DEFAULT_CAP, '9 cap NaN → default');
  assertEq(applyToolSearchRelevanceFloor(many, { cap: Infinity }).length, TOOL_SEARCH_DEFAULT_CAP, '9 cap Infinity → default');
  assertEq(applyToolSearchRelevanceFloor(many, { cap: 4.9 }).length, 4, '9 cap float floored');
  const many40 = Array.from({ length: 40 }, (_, i) => ({ tool: 'q' + String(i).padStart(2, '0'), score: 100 }));
  assertEq(applyToolSearchRelevanceFloor(many40, { cap: 1000 }).length, 25, '9 cap huge clamped to 25');

  // 10) determinism + name tiebreak ---------------------------------------
  const inp10 = mk(100, 90, 80, 40, 20);
  assertEq(
    JSON.stringify(applyToolSearchRelevanceFloor(inp10)),
    JSON.stringify(applyToolSearchRelevanceFloor(inp10)),
    '10 deterministic',
  );
  const s10 = applyToolSearchRelevanceFloor([
    { tool: 'zeta', score: 100 },
    { tool: 'alpha', score: 100 },
    { tool: 'mid', score: 100 },
  ]);
  assertEq(names(s10).join(','), 'alpha,mid,zeta', '10 equal scores → name asc tiebreak');

  // 11) dedup: duplicate tool keeps highest score -------------------------
  const s11 = applyToolSearchRelevanceFloor([
    { tool: 'dup', score: 50 },
    { tool: 'dup', score: 100 },
    { tool: 'other', score: 70 },
  ]);
  assertEq(s11.length, 2, '11 dedup length');
  assertEq(s11.filter((x) => x.tool === 'dup').length, 1, '11 dup once');
  assertEq(s11.find((x) => x.tool === 'dup')?.score, 100, '11 dup keeps max score');

  // 12) bounded huge input -------------------------------------------------
  const huge = Array.from({ length: 100000 }, (_, i) => ({ tool: 'h' + i, score: (i % 200) + 1 }));
  let s12: ScoredTool[] = [];
  let threw12 = false;
  try { s12 = applyToolSearchRelevanceFloor(huge); } catch { threw12 = true; }
  assert(!threw12, '12 huge input no throw');
  assert(Array.isArray(s12), '12 huge result array');
  assert(s12.length <= 25, '12 huge result bounded <= 25');

  // 13) hostile no-throw ---------------------------------------------------
  const cyclic: any = { tool: 'cyc', score: 80 };
  cyclic.self = cyclic;
  const hostile: any[] = [
    null, undefined, {}, [], 'str', 5, true, NaN, Symbol('x') as any,
    { tool: 123, score: 5 },
    { tool: 'no_score' },
    { tool: 'str_score', score: 'x' },
    { tool: 'nan_score', score: NaN },
    { tool: 'inf_score', score: Infinity },
    { tool: 'neg_inf', score: -Infinity },
    { tool: '', score: 5 },
    { score: 9 },
    { tool: 'valid_a', score: 100 },
    { tool: 'valid_b', score: 70 },
    { tool: 'valid_c', score: 50, extra: { deep: { deeper: [1, 2, 3] } } },
    cyclic,
    { tool: 'x'.repeat(100000), score: 90 },
    () => 1,
    new Map(),
  ];
  let s13: ScoredTool[] = [];
  let threw13 = false;
  try { s13 = applyToolSearchRelevanceFloor(hostile); } catch { threw13 = true; }
  assert(!threw13, '13 hostile no throw');
  assert(Array.isArray(s13), '13 hostile array');
  assert(has(s13, 'valid_a'), '13 valid_a survived');
  assert(!has(s13, 'nan_score') && !has(s13, 'inf_score') && !has(s13, 'neg_inf'), '13 non-finite scores dropped');
  assert(!has(s13, ''), '13 empty tool dropped');
  assert(!s13.some((x) => x.tool.length > 200), '13 huge tool string truncated <= 200');
  assert(has(s13, 'cyc'), '13 cyclic row read shallow-safe');
  assert(s13.every((x) => typeof x.tool === 'string' && Number.isFinite(x.score)), '13 all outputs well-typed');
  // Non-array top-levels via try/catch
  let threw13b = false;
  try {
    applyToolSearchRelevanceFloor(new Set([1, 2]) as any);
    applyToolSearchRelevanceFloor(function foo() {} as any);
    applyToolSearchRelevanceFloor(Symbol('s') as any);
  } catch { threw13b = true; }
  assert(!threw13b, '13 weird top-levels no throw');

  // 14) exported constants -------------------------------------------------
  assertEq(TOOL_SEARCH_STRONG_FLOOR, 60, '14 strong floor 60');
  assertEq(TOOL_SEARCH_BAND_RATIO, 0.35, '14 band ratio 0.35');
  assertEq(TOOL_SEARCH_MIN_FLOOR, 30, '14 min floor 30');
  assertEq(TOOL_SEARCH_ALWAYS_KEEP, 3, '14 always keep 3');
  assertEq(TOOL_SEARCH_DEFAULT_CAP, 8, '14 default cap 8');

  // 15) score/tool preserved & finite -------------------------------------
  const s15 = applyToolSearchRelevanceFloor(mk(200, 100, 69, 50));
  assert(s15.every((x) => typeof x.tool === 'string'), '15 tool string');
  assert(s15.every((x) => Number.isFinite(x.score)), '15 score finite');

  // 16) band math spot-checks (derive expected) --------------------------
  // topScore 200 → band = max(30, round(70)) = 70. above = {200,100} = 2 → top3.
  assertEq(s15.length, 3, '16 band200 length (top3)');
  assert(has(s15, 't69'), '16 t69 kept via top3 though below band 70');
  assert(!has(s15, 't50'), '16 t50 dropped');
  // topScore 1000 → band 350: 400 kept, 349 dropped (beyond top3).
  const s16 = applyToolSearchRelevanceFloor(mk(1000, 400, 351, 349));
  assertEq(s16.length, 3, '16 band350 keeps 3 above band');
  assert(has(s16, 't351') && !has(s16, 't349'), '16 band350 boundary 351 in / 349 out');
  // large strong band, many above → aboveBand > alwaysKeep, bounded by cap.
  const bandWide = applyToolSearchRelevanceFloor(mk(90, 88, 86, 84, 82, 80, 78, 76, 74, 72));
  assertEq(bandWide.length, TOOL_SEARCH_DEFAULT_CAP, '16 wide strong band bounded by default cap');

  // 17) single-item inputs -------------------------------------------------
  assertEq(applyToolSearchRelevanceFloor(mk(500)).length, 1, '17 single strong');
  assertEq(applyToolSearchRelevanceFloor(mk(5)).length, 1, '17 single weak');
  assertEq(applyToolSearchRelevanceFloor(mk(500))[0].score, 500, '17 single strong score');

  // 18) two-item inputs (alwaysKeep clamped to total) ---------------------
  assertEq(applyToolSearchRelevanceFloor(mk(4, 3)).length, 2, '18 weak pair → 2 (total<alwaysKeep)');
  assertEq(applyToolSearchRelevanceFloor(mk(90, 3)).length, 2, '18 strong pair → 2');

  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll tool-search-relevance-core smoke cases passed (' + passes + ' passed).');
}
main();
