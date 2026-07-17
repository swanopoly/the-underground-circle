/**
 * context-budget-fit-core-smoketest — the pure cross-SOURCE value-density
 * knapsack (src/lib/contextBudgetFitCore.ts) that spends ONE token budget across
 * a heterogeneous candidate bag with per-source floors/caps. Load-bearing
 * assertions:
 *
 *   fitCandidatesToBudget(candidates, budgetTokens, opts?): FitBudgetResult
 *     - KNAPSACK beats prefix-fill: a big low-density item early + small high-value
 *       items after it -> the small items are kept, the big one skipped, and
 *       usedTokens <= budget (stop-at-first-overflow would drop them all).
 *     - per-source FLOOR (minItems/minTokens) reserves a source's share before the
 *       global competition, even under a tight budget that density alone would
 *       spend elsewhere.
 *     - per-source CAP (maxItems/maxTokens) is never exceeded even when the source
 *       ranks high and the budget is roomy.
 *     - source WEIGHT multiplies value before density ranking (flips the winner).
 *     - INVARIANTS: usedTokens <= budget; keep union drop covers every id once;
 *       per-source maxTokens honored; zero-token items are free.
 *     - keep is grouped by source in first-seen order, input order within a source;
 *       drop is input order; DETERMINISTIC (same input twice -> identical result).
 *   normalizeCandidates(candidates): defensive coerce + dedup-by-id (first wins),
 *     blank source -> 'default', synth positional id, tokens/value/label clamped.
 *
 *   And: every export is TOTAL — null/undefined/number/string/{}/[]/NaN/Inf/
 *   negative/huge/control-char/cyclic/throwing-getter input -> a valid bounded
 *   result, never a throw, never a leaked control/fence char.
 *
 * Pure — loads under tsx (contextBudgetFitCore has zero imports). Control chars
 * are built/checked by code point so no literal control byte lives in this file.
 */

import {
  fitCandidatesToBudget,
  normalizeCandidates,
  DEFAULT_SOURCE_RULE,
  MAX_CANDIDATES,
  MAX_BUDGET_TOKENS,
  MAX_KEEP_ITEMS,
  MAX_SOURCE_RULES,
  MAX_ID_LEN,
  MAX_SOURCE_LEN,
  MAX_VALUE_MAGNITUDE,
  type BudgetCandidate,
  type FitBudgetResult,
  type FitBudgetOptions,
} from '../src/lib/contextBudgetFitCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── helpers ────────────────────────────────────────────────────────────────
const NUL = String.fromCharCode(0);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const DEL = String.fromCharCode(0x7f);

/** Mirror of the core's strip set (code-pointed so no literal control char here). */
function hasStrippable(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x2028 || c === 0x2029 || c === 0x60 || c === 0x3c || c === 0x3e) return true;
  }
  return false;
}

function ids(list: BudgetCandidate[]): string[] {
  return list.map((c) => c.id);
}
function sumTokens(list: BudgetCandidate[]): number {
  return list.reduce((a, c) => a + c.tokens, 0);
}
function keptIds(r: FitBudgetResult): string[] {
  return ids(r.keep);
}
function has(list: BudgetCandidate[], id: string): boolean {
  return list.some((c) => c.id === id);
}
function bySrc(r: FitBudgetResult, source: string): { keptItems: number; keptTokens: number; droppedItems: number } | undefined {
  return r.bySource.find((s) => s.source === source);
}

/** Structural validity every result must satisfy. */
function resultIsValid(r: unknown): r is FitBudgetResult {
  if (!r || typeof r !== 'object') return false;
  const rr = r as FitBudgetResult;
  if (!Array.isArray(rr.keep) || !Array.isArray(rr.drop) || !Array.isArray(rr.bySource)) return false;
  if (typeof rr.usedTokens !== 'number' || !Number.isFinite(rr.usedTokens) || rr.usedTokens < 0) return false;
  if (rr.keep.length > MAX_KEEP_ITEMS) return false;
  for (const c of [...rr.keep, ...rr.drop]) {
    if (!c || typeof c !== 'object') return false;
    if (typeof c.id !== 'string' || c.id.length === 0 || c.id.length > MAX_ID_LEN) return false;
    if (typeof c.source !== 'string' || c.source.length === 0 || c.source.length > MAX_SOURCE_LEN) return false;
    if (typeof c.tokens !== 'number' || !Number.isFinite(c.tokens) || c.tokens < 0) return false;
    if (typeof c.value !== 'number' || !Number.isFinite(c.value)) return false;
    if (hasStrippable(c.id) || hasStrippable(c.source)) return false; // no leaked control/fence char
  }
  for (const s of rr.bySource) {
    if (!s || typeof s.source !== 'string') return false;
    if (typeof s.keptItems !== 'number' || s.keptItems < 0) return false;
    if (typeof s.keptTokens !== 'number' || s.keptTokens < 0) return false;
    if (typeof s.droppedItems !== 'number' || s.droppedItems < 0) return false;
  }
  return true;
}

/** keep union drop == every normalized id exactly once (the partition guarantee). */
function partitionOk(r: FitBudgetResult, input: unknown): boolean {
  const normalized = normalizeCandidates(input);
  const all = [...keptIds(r), ...ids(r.drop)];
  if (all.length !== normalized.length) return false;
  const set = new Set(all);
  if (set.size !== all.length) return false; // disjoint + unique
  const normSet = new Set(ids(normalized));
  if (normSet.size !== set.size) return false;
  for (const id of set) if (!normSet.has(id)) return false;
  return true;
}

/** usedTokens == Σ kept tokens AND <= budget. */
function usedOk(r: FitBudgetResult, budget: number): boolean {
  return r.usedTokens === sumTokens(r.keep) && r.usedTokens <= budget;
}

function totalOn(candidates: unknown, budget: unknown, opts?: unknown): boolean {
  try {
    const r = fitCandidatesToBudget(candidates as never, budget as never, opts as FitBudgetOptions);
    return resultIsValid(r);
  } catch {
    return false;
  }
}

function range<T>(n: number, f: (i: number) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) out.push(f(i));
  return out;
}

function main(): void {
  // ─── (A) knapsack beats prefix-fill ──────────────────────────────────────
  {
    const big: BudgetCandidate = { id: 'big', source: 's', tokens: 1000, value: 10 }; // density 0.01
    const smalls = range(5, (i) => ({ id: `sm${i}`, source: 's', tokens: 10, value: 8 })); // density 0.8
    const input = [big, ...smalls]; // big FIRST — a prefix fill in input order stops here
    const r = fitCandidatesToBudget(input, 60);
    assertEq(r.keep.length, 5, '(A) all 5 small high-density items kept');
    for (let i = 0; i < 5; i += 1) assert(has(r.keep, `sm${i}`), `(A) sm${i} kept`);
    assert(has(r.drop, 'big'), '(A) the big low-density item is dropped (skipped, not stopped on)');
    assertEq(r.usedTokens, 50, '(A) usedTokens = 5*10');
    assert(r.usedTokens <= 60, '(A) usedTokens <= budget');
    assert(usedOk(r, 60), '(A) usedTokens == Σ kept tokens');
    assert(partitionOk(r, input), '(A) keep∪drop covers every id once');
    assert(resultIsValid(r), '(A) result structurally valid');
  }

  // ─── (B) per-source floor (minItems) ─────────────────────────────────────
  {
    const retr = range(10, (i) => ({ id: `r${i}`, source: 'retrieval', tokens: 10, value: 9 })); // density 0.9
    const note: BudgetCandidate = { id: 'note1', source: 'user_note', tokens: 20, value: 5 }; // density 0.25, LAST
    const input = [...retr, note];
    const withRule = fitCandidatesToBudget(input, 30, { sourceRules: { user_note: { minItems: 1 } } });
    assert(has(withRule.keep, 'note1'), '(B) minItems floor keeps >=1 user_note under a tight budget');
    assertEq(bySrc(withRule, 'user_note')?.keptItems, 1, '(B) exactly one user_note reserved');
    assert(usedOk(withRule, 30), '(B) usedTokens invariant holds with a floor');
    // Contrast: WITHOUT the floor, higher-density retrieval crowds the note out.
    const noRule = fitCandidatesToBudget(input, 30);
    assert(!has(noRule.keep, 'note1'), '(B) without the floor the low-density note is dropped');
    assert(has(noRule.keep, 'r0'), '(B) without the floor retrieval fills the budget');
  }

  // ─── (C) per-source cap (maxItems) + drop input order ────────────────────
  {
    const retr = range(12, (i) => ({ id: `r${i}`, source: 'retrieval', tokens: 5, value: 9 }));
    const r = fitCandidatesToBudget(retr, 1000, { sourceRules: { retrieval: { maxItems: 3 } } });
    assertEq(r.keep.length, 3, '(C) retrieval capped at 3 despite a roomy budget');
    assertEq(bySrc(r, 'retrieval')?.keptItems, 3, '(C) bySource reports 3 kept');
    assertJson(keptIds(r), ['r0', 'r1', 'r2'], '(C) tie-break keeps the first three by input index');
    assertJson(ids(r.drop), ['r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11'], '(C) drop is in input order');
    assert(partitionOk(r, retr), '(C) partition still total under a cap');
  }

  // ─── (D) source weight raises density (flips the winner) ─────────────────
  {
    const a = range(4, (i) => ({ id: `a${i}`, source: 'A', tokens: 10, value: 5 })); // eff 5, density 0.5
    const b = range(4, (i) => ({ id: `b${i}`, source: 'B', tokens: 10, value: 5 })); // weighted 2 -> eff 10
    const input = [...a, ...b];
    const weighted = fitCandidatesToBudget(input, 40, { sourceRules: { B: { weight: 2 } } });
    assertEq(bySrc(weighted, 'B')?.keptItems, 4, '(D) weight lifts B above A — all 4 B kept');
    assertEq(bySrc(weighted, 'A')?.keptItems, 0, '(D) A crowded out by the weighted source');
    // Contrast: no weight -> equal density, tie-break by input index keeps A.
    const flat = fitCandidatesToBudget(input, 40);
    assertEq(bySrc(flat, 'A')?.keptItems, 4, '(D) without weight the earlier source (A) wins the tie');
    assertEq(bySrc(flat, 'B')?.keptItems, 0, '(D) B dropped without a weight edge');
  }

  // ─── (E) minTokens floor + maxTokens cap ─────────────────────────────────
  {
    const other = range(5, (i) => ({ id: `o${i}`, source: 'O', tokens: 10, value: 9 })); // density 0.9
    const src = range(5, (i) => ({ id: `s${i}`, source: 'S', tokens: 10, value: 1 })); // density 0.1
    const input = [...other, ...src];
    const floored = fitCandidatesToBudget(input, 60, { sourceRules: { S: { minTokens: 30 } } });
    assert((bySrc(floored, 'S')?.keptTokens ?? 0) >= 30, '(E) minTokens floor reserves >=30 tokens for the low-density source');
    assert(usedOk(floored, 60), '(E) usedTokens invariant holds with a token floor');
    const capped = fitCandidatesToBudget(input, 1000, { sourceRules: { O: { maxTokens: 20 } } });
    assert((bySrc(capped, 'O')?.keptTokens ?? 999) <= 20, '(E) maxTokens caps the source token spend');
    assertEq(bySrc(capped, 'O')?.keptItems, 2, '(E) maxTokens 20 admits exactly two 10-token items');
  }

  // ─── (F) invariants: zero-token free + partition + caps ──────────────────
  {
    const bigItem: BudgetCandidate = { id: 'B1', source: 'X', tokens: 100, value: 1 };
    const zero: BudgetCandidate = { id: 'Z1', source: 'Z', tokens: 0, value: 0.001 };
    const r = fitCandidatesToBudget([bigItem, zero], 5);
    assert(has(r.keep, 'Z1'), '(F) zero-token item is free — kept even when the budget cannot fit the big one');
    assert(has(r.drop, 'B1'), '(F) the unaffordable item is dropped');
    assertEq(r.usedTokens, 0, '(F) zero-token keep costs 0');
    assert(usedOk(r, 5), '(F) usedTokens <= budget');
  }
  {
    // A capped source must never exceed its maxTokens even with reservation + globals.
    const items = [
      ...range(6, (i) => ({ id: `p${i}`, source: 'P', tokens: 7, value: 4 })),
      ...range(6, (i) => ({ id: `q${i}`, source: 'Q', tokens: 3, value: 9 })),
    ];
    const opts: FitBudgetOptions = { sourceRules: { P: { minItems: 2, maxTokens: 21 }, Q: { maxItems: 4 } } };
    const r = fitCandidatesToBudget(items, 60, opts);
    assert((bySrc(r, 'P')?.keptTokens ?? 999) <= 21, '(F) P maxTokens 21 never exceeded');
    assert((bySrc(r, 'P')?.keptItems ?? 0) >= 2, '(F) P minItems 2 honored');
    assert((bySrc(r, 'Q')?.keptItems ?? 999) <= 4, '(F) Q maxItems 4 never exceeded');
    assert(usedOk(r, 60), '(F) usedTokens invariant under combined floors+caps');
    assert(partitionOk(r, items), '(F) partition total under combined floors+caps');
    assert(resultIsValid(r), '(F) combined-rule result structurally valid');
  }

  // ─── (G) keep grouped by source (first-seen), input order within source ──
  {
    const input = [
      { id: 'a1', source: 'A', tokens: 2, value: 5 },
      { id: 'b1', source: 'B', tokens: 2, value: 5 },
      { id: 'a2', source: 'A', tokens: 2, value: 5 },
      { id: 'b2', source: 'B', tokens: 2, value: 5 },
    ];
    const r = fitCandidatesToBudget(input, 1000); // roomy — everything kept
    assertEq(r.keep.length, 4, '(G) roomy budget keeps all four');
    assertJson(keptIds(r), ['a1', 'a2', 'b1', 'b2'], '(G) keep grouped by first-seen source, input order within');
    assertJson(r.bySource.map((s) => s.source), ['A', 'B'], '(G) bySource in first-seen order');
    assert(usedOk(r, 1000), '(G) usedTokens invariant');
  }

  // ─── (H) determinism ─────────────────────────────────────────────────────
  {
    const input = [
      ...range(8, (i) => ({ id: `u${i}`, source: 'user_note', tokens: 5 + i, value: 9 - i })),
      ...range(8, (i) => ({ id: `t${i}`, source: 'retrieval', tokens: 3 + i, value: 4 + (i % 3) })),
      { id: 'free', source: 'misc', tokens: 0, value: 2 },
    ];
    const opts: FitBudgetOptions = { sourceRules: { user_note: { minItems: 2, weight: 1.5 }, retrieval: { maxItems: 5 } }, maxItems: 10 };
    const a = fitCandidatesToBudget(input, 40, opts);
    const b = fitCandidatesToBudget(input, 40, opts);
    assertJson(a, b, '(H) same input twice -> byte-identical result');
    assert(usedOk(a, 40), '(H) usedTokens invariant on the complex case');
    assert(partitionOk(a, input), '(H) partition total on the complex case');
    // scores encode nothing wall-clock: a third run matches too.
    const c = fitCandidatesToBudget(input, 40, opts);
    assertJson(a, c, '(H) third run identical (no RNG / clock)');
  }

  // ─── (I) bounds + exported constants ─────────────────────────────────────
  {
    assertEq(MAX_CANDIDATES, 5000, '(I) MAX_CANDIDATES');
    assertEq(MAX_BUDGET_TOKENS, 1_000_000_000, '(I) MAX_BUDGET_TOKENS');
    assertEq(MAX_KEEP_ITEMS, 2000, '(I) MAX_KEEP_ITEMS');
    assertEq(MAX_SOURCE_RULES, 256, '(I) MAX_SOURCE_RULES');
    assertEq(MAX_ID_LEN, 256, '(I) MAX_ID_LEN');
    assertEq(MAX_SOURCE_LEN, 64, '(I) MAX_SOURCE_LEN');
    assertEq(MAX_VALUE_MAGNITUDE, 1_000_000, '(I) MAX_VALUE_MAGNITUDE');
    // MAX_CANDIDATES: 6000 rows normalize to <= 5000.
    const many = range(6000, (i) => ({ id: `m${i}`, source: 'M', tokens: 1, value: 1 }));
    assertEq(normalizeCandidates(many).length, MAX_CANDIDATES, '(I) input capped at MAX_CANDIDATES');
    // MAX_KEEP_ITEMS: 3000 free items, roomy budget, default global cap -> keep 2000.
    const free = range(3000, (i) => ({ id: `f${i}`, source: 'F', tokens: 0, value: 1 }));
    const rk = fitCandidatesToBudget(free, MAX_BUDGET_TOKENS);
    assertEq(rk.keep.length, MAX_KEEP_ITEMS, '(I) keep capped at MAX_KEEP_ITEMS (default global cap)');
    assertEq(rk.usedTokens, 0, '(I) free items cost nothing');
    assert(resultIsValid(rk), '(I) capped-keep result valid');
    // Budget over the ceiling is clamped, not overflowed.
    const rr = fitCandidatesToBudget([{ id: 'x', source: 'A', tokens: 5, value: 1 }], 1e12);
    assert(rr.usedTokens <= MAX_BUDGET_TOKENS, '(I) budget clamped to MAX_BUDGET_TOKENS');
    assert(has(rr.keep, 'x'), '(I) item still kept under a clamped huge budget');
    // Global maxItems opt honored + clamped.
    const capped = fitCandidatesToBudget(range(20, (i) => ({ id: `c${i}`, source: 'C', tokens: 1, value: 1 })), 1000, { maxItems: 4 });
    assertEq(capped.keep.length, 4, '(I) opts.maxItems honored');
    assertEq(fitCandidatesToBudget(range(5, (i) => ({ id: `d${i}`, source: 'D', tokens: 1, value: 1 })), 1000, { maxItems: 0 }).keep.length, 0, '(I) opts.maxItems 0 keeps nothing');
  }

  // ─── (J) normalizeCandidates coercion + dedup ────────────────────────────
  {
    // dedup by id, first wins.
    const dup = normalizeCandidates([
      { id: 'x', source: 'A', tokens: 1, value: 1 },
      { id: 'x', source: 'B', tokens: 2, value: 2 },
    ]);
    assertEq(dup.length, 1, '(J) dedup by id collapses to one');
    assertEq(dup[0].source, 'A', '(J) dedup keeps the FIRST occurrence');
    // blank / missing source -> default.
    assertEq(normalizeCandidates([{ id: 'y', tokens: 1, value: 1 }])[0].source, 'default', '(J) missing source -> default');
    assertEq(normalizeCandidates([{ id: 'y', source: '   ', tokens: 1, value: 1 }])[0].source, 'default', '(J) whitespace source -> default');
    // value magnitude clamp.
    assertEq(normalizeCandidates([{ id: 'v', source: 'A', tokens: 1, value: 1e12 }])[0].value, MAX_VALUE_MAGNITUDE, '(J) value clamped to +MAX');
    assertEq(normalizeCandidates([{ id: 'v', source: 'A', tokens: 1, value: -1e12 }])[0].value, -MAX_VALUE_MAGNITUDE, '(J) value clamped to -MAX');
    assertEq(normalizeCandidates([{ id: 'v', source: 'A', tokens: 1, value: NaN }])[0].value, 0, '(J) NaN value -> 0');
    // token clamp.
    assertEq(normalizeCandidates([{ id: 't', source: 'A', tokens: -5, value: 1 }])[0].tokens, 0, '(J) negative tokens -> 0');
    assertEq(normalizeCandidates([{ id: 't', source: 'A', tokens: 3.9, value: 1 }])[0].tokens, 3, '(J) fractional tokens floored');
    assertEq(normalizeCandidates([{ id: 't', source: 'A', tokens: Infinity, value: 1 }])[0].tokens, MAX_BUDGET_TOKENS, '(J) +Infinity tokens -> cap (never free)');
    // synthesized positional id for a blank id.
    const synth = normalizeCandidates([{ source: 'A', tokens: 1, value: 1 }]);
    assertEq(synth.length, 1, '(J) blank-id row is kept');
    assert(synth[0].id.length > 0, '(J) blank id -> a stable non-empty positional id');
    // id / source length clamp.
    assertEq(normalizeCandidates([{ id: 'a'.repeat(500), source: 'A', tokens: 1, value: 1 }])[0].id.length, MAX_ID_LEN, '(J) id clamped to MAX_ID_LEN');
    assertEq(normalizeCandidates([{ id: 'z', source: 'b'.repeat(500), tokens: 1, value: 1 }])[0].source.length, MAX_SOURCE_LEN, '(J) source clamped to MAX_SOURCE_LEN');
    // control / fence chars stripped from id + source.
    const cleaned = normalizeCandidates([{ id: `a${NUL}b${DEL}`, source: `s${LS}\`<>${PS}`, tokens: 1, value: 1 }]);
    assert(!hasStrippable(cleaned[0].id), '(J) id stripped of control/fence chars');
    assert(!hasStrippable(cleaned[0].source), '(J) source stripped of control/fence chars');
    // non-object / array rows dropped; numeric coercions accepted.
    const mixed = normalizeCandidates([null, 42, 'str', [], { id: 'ok', source: 'A', tokens: '7', value: '3' }, true]);
    assertEq(mixed.length, 1, '(J) junk rows dropped, one valid survives');
    assertEq(mixed[0].tokens, 7, '(J) numeric-string tokens coerced');
    assertEq(mixed[0].value, 3, '(J) numeric-string value coerced');
    assert(Array.isArray(normalizeCandidates('nope')), '(J) non-array input -> [] (array)');
    assertEq(normalizeCandidates('nope').length, 0, '(J) non-array input -> empty');
  }

  // ─── (K) DEFAULT_SOURCE_RULE ─────────────────────────────────────────────
  {
    assertEq(DEFAULT_SOURCE_RULE.weight, 1, '(K) DEFAULT_SOURCE_RULE.weight is 1');
    assert(Object.isFrozen(DEFAULT_SOURCE_RULE), '(K) DEFAULT_SOURCE_RULE is frozen');
  }

  // ─── (HOSTILE) totality: never throw, never leak ─────────────────────────
  const baseList = [
    { id: 'k1', source: 'A', tokens: 5, value: 3 },
    { id: 'k2', source: 'B', tokens: 7, value: 8 },
  ];
  try {
    // hostile candidates -> empty, valid shape.
    for (const bad of [null, undefined, 42, 'str', {}, NaN, true, () => 1, Symbol('s'), 9n, -0]) {
      assert(totalOn(bad, 100), 'hostile candidates total', String(bad).slice(0, 12));
      assertEq(fitCandidatesToBudget(bad as never, 100).keep.length, 0, 'hostile candidates -> no keep');
    }
    // hostile budgets.
    for (const bad of [null, undefined, NaN, 'nope', {}, () => 5, Symbol('b'), true]) {
      assert(totalOn(baseList, bad), 'hostile budget total', String(bad).slice(0, 12));
    }
    // budget 0 / negative -> empty keep, everything drops (still partitioned).
    for (const b of [0, -10, -1e9]) {
      const r = fitCandidatesToBudget(baseList, b);
      assertEq(r.keep.length, 0, 'non-positive budget -> no keep');
      assert(partitionOk(r, baseList), 'non-positive budget still partitions');
    }
    // Infinity / string / huge budgets are usable, not fatal.
    assert(totalOn(baseList, Infinity), 'Infinity budget total');
    assert(has(fitCandidatesToBudget(baseList, Infinity).keep, 'k2'), 'Infinity budget keeps items');
    assert(has(fitCandidatesToBudget(baseList, '100').keep, 'k2'), 'numeric-string budget coerced + usable');
    assert(totalOn(baseList, 1e15), 'huge budget total');

    // hostile opts.
    for (const o of [42, 'nope', true, [], () => 1, Symbol('o'), { maxItems: NaN }, { maxItems: Infinity }, { maxItems: -5 }, { maxItems: 'x' }]) {
      assert(totalOn(baseList, 100, o), 'hostile opts total', JSON.stringify(String(o)).slice(0, 20));
    }
    assertEq(fitCandidatesToBudget(baseList, 100, { maxItems: -5 } as FitBudgetOptions).keep.length, 0, 'negative opts.maxItems keeps nothing');
    // hostile sourceRules.
    for (const sr of [42, 'x', null, [], () => 1, { A: 42 }, { A: null }, { A: 'nope' }, { A: { minItems: NaN, maxItems: -1, minTokens: 'x', maxTokens: Infinity, weight: -3 } }]) {
      assert(totalOn(baseList, 100, { sourceRules: sr } as unknown as FitBudgetOptions), 'hostile sourceRules total', JSON.stringify(String(sr)).slice(0, 24));
    }
    // a garbage rule for a real source still yields a valid, partitioned result.
    const gr = fitCandidatesToBudget(baseList, 100, { sourceRules: { A: { minItems: NaN, maxItems: -1, weight: -3 } } } as unknown as FitBudgetOptions);
    assert(resultIsValid(gr) && partitionOk(gr, baseList), 'garbage rule -> valid partitioned result');

    // NaN / Inf / negative tokens+value items.
    const weird = [
      { id: 'w1', source: 'A', tokens: NaN, value: NaN },
      { id: 'w2', source: 'A', tokens: Infinity, value: Infinity },
      { id: 'w3', source: 'A', tokens: -5, value: -Infinity },
      { id: 'w4', source: 'A', tokens: 1e30, value: 1e30 },
    ];
    assert(totalOn(weird, 100), 'weird-number items total');
    const wr = fitCandidatesToBudget(weird, 100);
    assert(resultIsValid(wr), 'weird-number result valid');
    assert(usedOk(wr, 100), 'weird-number usedTokens invariant');
    assert(partitionOk(wr, weird), 'weird-number partition total');

    // throwing getters on each field — item skipped, siblings survive.
    const boom = (field: string): BudgetCandidate => {
      const o: Record<string, unknown> = { id: 'boom', source: 'A', tokens: 1, value: 1 };
      Object.defineProperty(o, field, {
        get() {
          throw new Error(`boom ${field}`);
        },
        enumerable: true,
      });
      return o as unknown as BudgetCandidate;
    };
    for (const field of ['id', 'source', 'tokens', 'value']) {
      assert(totalOn([boom(field)], 100), `throwing getter on ${field} is total`);
    }
    const good: BudgetCandidate = { id: 'good', source: 'A', tokens: 1, value: 1 };
    const withBoom = fitCandidatesToBudget([boom('value'), good], 100);
    assert(has(withBoom.keep, 'good') || has(withBoom.drop, 'good'), 'good item survives a throwing sibling');
    assert(has(withBoom.keep, 'good'), 'good item is kept alongside a skipped throwing sibling');

    // cyclic candidate — scalar reads don't traverse the cycle.
    const cyc: Record<string, unknown> = { id: 'cyc', source: 'A', tokens: 2, value: 5 };
    cyc.self = cyc;
    cyc.list = [cyc, cyc];
    assert(totalOn([cyc], 100), 'cyclic candidate total');
    assert(has(fitCandidatesToBudget([cyc], 100).keep, 'cyc'), 'cyclic candidate still selected');

    // 10k candidates -> bounded output.
    const many = range(10000, (i) => ({ id: `m${i}`, source: i % 2 ? 'even' : 'odd', tokens: 1, value: 1 }));
    assert(totalOn(many, MAX_BUDGET_TOKENS), '10k candidates total');
    const mr = fitCandidatesToBudget(many, MAX_BUDGET_TOKENS);
    assert(mr.keep.length <= MAX_KEEP_ITEMS, '10k -> keep bounded by MAX_KEEP_ITEMS');
    assert(normalizeCandidates(many).length <= MAX_CANDIDATES, '10k -> normalized bounded by MAX_CANDIDATES');
    assert(resultIsValid(mr), '10k result valid');

    // many source rules -> bounded, no throw.
    const bigRules: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i += 1) bigRules[`src${i}`] = { minItems: 1, maxItems: 2, weight: 1 };
    assert(totalOn(baseList, 100, { sourceRules: bigRules } as unknown as FitBudgetOptions), 'huge sourceRules map total');

    // 300-char ids/sources clamped in output.
    const bic = fitCandidatesToBudget([{ id: 'x'.repeat(300), source: 'y'.repeat(300), tokens: 1, value: 1 }], 100);
    assert((bic.keep[0]?.id.length ?? 0) <= MAX_ID_LEN, '300-char id clamped in output');
    assert((bic.keep[0]?.source.length ?? 0) <= MAX_SOURCE_LEN, '300-char source clamped in output');

    // control/fence chars in id+source never appear in ANY output field.
    const nasty = fitCandidatesToBudget(
      [{ id: `a${NUL}b\`<>`, source: `s${LS}${PS}\`<>`, tokens: 1, value: 1 }],
      100,
    );
    assert(resultIsValid(nasty), 'control-char item -> valid result (no leaked control/fence char)');
    assert(!hasStrippable(JSON.stringify(nasty)), 'no control/fence char anywhere in the serialized result');

    // a secret-shaped id is cleaned + length-bounded (the core carries no item text).
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const sr2 = fitCandidatesToBudget([{ id: JWT, source: 'auth', tokens: 1, value: 9 }], 100);
    assert(resultIsValid(sr2), 'secret-shaped id -> valid result');
    assert((sr2.keep[0]?.id.length ?? 0) <= MAX_ID_LEN, 'secret-shaped id length-bounded');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (HOSTILE) sweep threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll context-budget-fit-core smoke cases passed (${passes} passed).`);
}

main();
