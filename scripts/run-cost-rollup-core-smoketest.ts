/**
 * run-cost-rollup-core-smoketest — the pure cost core (src/lib/runCostRollupCore.ts)
 * behind run-observability expansion v7: light up the long-dead
 * agent_runs.estimated_cost column + roll up spend per surface/day incl.
 * FAILED-run wasted spend. Load-bearing assertions:
 *
 *   PRICING: MODEL_PRICES covers claude/gpt/gemini families with cached ALWAYS
 *   cheaper than fresh input; every rate is finite and non-negative; a `default`
 *   conservative fallback exists.
 *
 *   ESTIMATE: known models compute the exact per-1M formula
 *   (cached*cachedRate + input*inRate + output*outRate)/1M; provider-prefixed,
 *   dotted, and mixed-case ids resolve via longest-key match (`claude-opus`
 *   beats bare `claude`); unknown/missing model → conservative default; free
 *   self-hosted models → 0; cached is cheaper than the same count of fresh
 *   input; negative/NaN/huge/string tokens degrade safely; never NaN/negative.
 *
 *   ROLLUP: costUsd summed with cents rounding on final sums only; wastedUsd =
 *   failed + max-iteration + timeout runs (NOT completed/running/cancelled) and
 *   is always <= total; grouping by surface + day with "unknown" fallback;
 *   zero/negative-cost rows ignored; MAX_ROWS + bounded group keys (overflow
 *   bucket) keep output bounded on hostile input.
 *
 *   And: every export is total — degenerate/hostile/cyclic input never throws.
 *
 * Pure — loads under tsx (runCostRollupCore has zero imports).
 */

import {
  MODEL_PRICES,
  estimateRunCostUsd,
  rollupRunCosts,
  isWastedRunStatus,
  type ModelPrice,
  type CostRollup,
} from '../src/lib/runCostRollupCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(actual === expected, msg, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

function main(): void {
  // ── Group 1: MODEL_PRICES map shape ────────────────────────────────────────
  assert(typeof MODEL_PRICES === 'object' && MODEL_PRICES !== null, '(1) MODEL_PRICES is an object');
  assert(!!MODEL_PRICES.default, '(1) default price entry exists');
  assert(!!MODEL_PRICES['claude-opus'], '(1) claude family present');
  assert(!!MODEL_PRICES['gpt-4o'], '(1) gpt family present');
  assert(!!MODEL_PRICES['gemini-flash'], '(1) gemini family present');
  {
    let allFinite = true;
    let cachedNeverPricier = true;
    let allNonNeg = true;
    for (const key of Object.keys(MODEL_PRICES)) {
      const p: ModelPrice = MODEL_PRICES[key];
      if (!Number.isFinite(p.inPer1M) || !Number.isFinite(p.outPer1M) || !Number.isFinite(p.cachedInPer1M)) {
        allFinite = false;
      }
      if (p.inPer1M < 0 || p.outPer1M < 0 || p.cachedInPer1M < 0) allNonNeg = false;
      if (p.cachedInPer1M > p.inPer1M) cachedNeverPricier = false;
    }
    assert(allFinite, '(1) all rates finite');
    assert(allNonNeg, '(1) all rates non-negative');
    assert(cachedNeverPricier, '(1) cached rate never exceeds fresh-input rate');
  }
  // paid family: cached strictly cheaper
  assert(MODEL_PRICES['claude-opus'].cachedInPer1M < MODEL_PRICES['claude-opus'].inPer1M, '(1) opus cached strictly cheaper');
  assert(MODEL_PRICES.default.inPer1M >= MODEL_PRICES['claude-sonnet'].inPer1M, '(1) default is conservative (>= sonnet input rate)');

  // ── Group 2: estimateRunCostUsd — known models, exact formula ───────────────
  // opus: 1M in @15 + 1M out @75 = 90
  assertEq(estimateRunCostUsd({ model: 'claude-opus', inputTokens: 1_000_000, outputTokens: 1_000_000 }), 90, '(2) opus 1M in + 1M out = 90');
  // sonnet: 1M in @3
  assertEq(estimateRunCostUsd({ model: 'claude-sonnet', inputTokens: 1_000_000 }), 3, '(2) sonnet 1M in = 3');
  // haiku: 1M out @4
  assertEq(estimateRunCostUsd({ model: 'claude-haiku', outputTokens: 1_000_000 }), 4, '(2) haiku 1M out = 4');
  // gpt-4o: 2M in @2.5 + 0.5M out @10 = 5 + 5 = 10
  assertEq(estimateRunCostUsd({ model: 'gpt-4o', inputTokens: 2_000_000, outputTokens: 500_000 }), 10, '(2) gpt-4o mixed = 10');
  // gemini-flash: 1M in @0.1 + 1M out @0.4 = 0.5
  assertEq(estimateRunCostUsd({ model: 'gemini-flash', inputTokens: 1_000_000, outputTokens: 1_000_000 }), 0.5, '(2) gemini-flash = 0.5');
  // cached billed at cheaper rate: opus 1M cached @1.5
  assertEq(estimateRunCostUsd({ model: 'claude-opus', cachedTokens: 1_000_000 }), 1.5, '(2) opus 1M cached = 1.5');

  // ── Group 3: model resolution (prefix / dotted / case / longest-match) ──────
  assertEq(estimateRunCostUsd({ model: 'anthropic/claude-opus-4-8', inputTokens: 1_000_000 }), 15, '(3) provider-prefixed opus id → opus');
  assertEq(estimateRunCostUsd({ model: 'google_ai/gemini-2.5-pro', inputTokens: 1_000_000 }), 1.25, '(3) dotted gemini id → gemini base');
  assertEq(estimateRunCostUsd({ model: 'CLAUDE-OPUS', inputTokens: 1_000_000 }), 15, '(3) uppercase resolves');
  assertEq(estimateRunCostUsd({ model: 'claude.opus', inputTokens: 1_000_000 }), 15, '(3) dotted claude.opus resolves');
  // longest-match: claude-opus (15) beats bare claude (3)
  assertEq(estimateRunCostUsd({ model: 'claude-opus', inputTokens: 1_000_000 }), 15, '(3) longest-match opus not bare claude');
  // gpt-4o-mini (0.15) beats gpt-4o (2.5) beats gpt-4 (3)
  assertEq(estimateRunCostUsd({ model: 'gpt-4o-mini', inputTokens: 1_000_000 }), 0.15, '(3) gpt-4o-mini specific');
  assertEq(estimateRunCostUsd({ model: 'gpt-4-1', inputTokens: 1_000_000 }), 3, '(3) gpt-4-1 → gpt-4');

  // ── Group 4: unknown / missing / free models ───────────────────────────────
  assertEq(estimateRunCostUsd({ model: 'totally-made-up-xyz', inputTokens: 1_000_000 }), 5, '(4) unknown model → default in-rate 5');
  assertEq(estimateRunCostUsd({ inputTokens: 1_000_000 }), 5, '(4) missing model → default');
  assertEq(estimateRunCostUsd({ model: '', inputTokens: 1_000_000 }), 5, '(4) empty model → default');
  assertEq(estimateRunCostUsd({ model: 'blackswan', inputTokens: 1_000_000, outputTokens: 1_000_000 }), 0, '(4) blackswan free');
  assertEq(estimateRunCostUsd({ model: 'ollama', inputTokens: 1_000_000_000 }), 0, '(4) ollama free at any volume');

  // ── Group 5: token handling — safe coercion, cached cheaper, bounded ────────
  assertEq(estimateRunCostUsd({ model: 'claude-opus', cachedTokens: 0 }), 0, '(5) zero tokens → 0');
  const freshOpus = estimateRunCostUsd({ model: 'claude-opus', inputTokens: 1_000_000 });
  const cachedOpus = estimateRunCostUsd({ model: 'claude-opus', cachedTokens: 1_000_000 });
  assert(cachedOpus < freshOpus, '(5) same-count cached cheaper than fresh input', `cached=${cachedOpus} fresh=${freshOpus}`);
  assertEq(estimateRunCostUsd({ model: 'claude-sonnet', inputTokens: '1000000' }), 3, '(5) numeric-string tokens coerced');
  assertEq(estimateRunCostUsd({ model: 'claude-sonnet', inputTokens: -5, outputTokens: -99 }), 0, '(5) negative tokens → 0');
  assertEq(estimateRunCostUsd({ model: 'claude-sonnet', inputTokens: NaN, outputTokens: Infinity }), 0, '(5) NaN/Infinity tokens → 0');
  {
    const huge = estimateRunCostUsd({ model: 'claude-opus', inputTokens: 1e30 });
    assert(Number.isFinite(huge) && huge > 0 && huge <= 1e9, '(5) huge tokens bounded + finite', `got ${huge}`);
  }
  assertEq(estimateRunCostUsd({ model: 'claude-opus', inputTokens: {} as unknown as number }), 0, '(5) object token field → 0');

  // ── Group 6: rollupRunCosts — sum + grouping ───────────────────────────────
  {
    const rows = [
      { surface: 'main_chat', day: '2026-07-14', status: 'completed', costUsd: 0.10 },
      { surface: 'main_chat', day: '2026-07-14', status: 'failed', costUsd: 0.05 },
      { surface: 'room_chat', day: '2026-07-15', status: 'completed', costUsd: 0.20 },
      { surface: 'feed_task', day: '2026-07-15', status: 'max_iterations', costUsd: 0.07 },
    ];
    const r: CostRollup = rollupRunCosts(rows);
    assertEq(r.totalUsd, 0.42, '(6) total summed + rounded to cents');
    assertEq(r.wastedUsd, 0.12, '(6) wasted = failed 0.05 + max_iter 0.07');
    assertEq(r.bySurface['main_chat'], 0.15, '(6) main_chat surface bucket');
    assertEq(r.bySurface['room_chat'], 0.20, '(6) room_chat surface bucket');
    assertEq(r.bySurface['feed_task'], 0.07, '(6) feed_task surface bucket');
    assertEq(r.byDay['2026-07-14'], 0.15, '(6) day bucket 07-14');
    assertEq(r.byDay['2026-07-15'], 0.27, '(6) day bucket 07-15');
    assert(r.wastedUsd <= r.totalUsd, '(6) wasted never exceeds total');
  }

  // ── Group 7: wasted-status classification ──────────────────────────────────
  assert(isWastedRunStatus('failed'), '(7) failed is wasted');
  assert(isWastedRunStatus('max_iterations'), '(7) max_iterations is wasted');
  assert(isWastedRunStatus('max-iterations-exceeded'), '(7) hyphenated max-iter is wasted');
  assert(isWastedRunStatus('timeout'), '(7) timeout is wasted');
  assert(isWastedRunStatus('ERROR'), '(7) ERROR (case-insensitive) is wasted');
  assert(!isWastedRunStatus('completed'), '(7) completed NOT wasted');
  assert(!isWastedRunStatus('running'), '(7) running NOT wasted');
  assert(!isWastedRunStatus('cancelled'), '(7) cancelled NOT wasted (intentional stop)');
  assert(!isWastedRunStatus(undefined), '(7) undefined status NOT wasted');
  {
    const rows = [
      { status: 'completed', costUsd: 1, surface: 'a', day: 'd' },
      { status: 'running', costUsd: 1, surface: 'a', day: 'd' },
      { status: 'cancelled', costUsd: 1, surface: 'a', day: 'd' },
      { status: 'failed', costUsd: 1, surface: 'a', day: 'd' },
    ];
    const r = rollupRunCosts(rows);
    assertEq(r.totalUsd, 4, '(7) total counts all statuses');
    assertEq(r.wastedUsd, 1, '(7) only failed counted as wasted');
  }

  // ── Group 8: grouping fallbacks + zero/negative filtering ───────────────────
  {
    const r = rollupRunCosts([{ status: 'completed', costUsd: 1 }]);
    assertEq(r.bySurface['unknown'], 1, '(8) missing surface → unknown bucket');
    assertEq(r.byDay['unknown'], 1, '(8) missing day → unknown bucket');
  }
  {
    const r = rollupRunCosts([
      { surface: 'z', costUsd: 0 },
      { surface: 'z', costUsd: -3 },
      { surface: 'z', costUsd: 0.5 },
    ]);
    assertEq(r.totalUsd, 0.5, '(8) zero/negative cost rows ignored in total');
    assertEq(r.bySurface['z'], 0.5, '(8) only positive cost in group');
    assertEq(Object.keys(r.bySurface).length, 1, '(8) no phantom buckets from 0/neg rows');
  }
  {
    // whitespace-only + overlong surface key handling
    const longSurface = 'x'.repeat(500);
    const r = rollupRunCosts([{ surface: '   ', costUsd: 1 }, { surface: longSurface, costUsd: 2 }]);
    assertEq(r.bySurface['unknown'], 1, '(8) whitespace surface → unknown');
    const keys = Object.keys(r.bySurface);
    assert(keys.every((k) => k.length <= 64), '(8) group keys length-bounded', keys.join(','));
  }

  // ── Group 9: precise accumulation, cents rounding on final sums only ────────
  {
    const r = rollupRunCosts([{ costUsd: 0.004 }, { costUsd: 0.004 }, { costUsd: 0.004 }]);
    // 0.012 accumulated precisely, then rounded → 0.01 (not zeroed per-row)
    assertEq(r.totalUsd, 0.01, '(9) sub-cent rows accumulate then round to 0.01');
  }
  {
    const r = rollupRunCosts([{ costUsd: 1.005 }, { costUsd: 1.005 }]);
    assert(Number.isFinite(r.totalUsd) && r.totalUsd >= 2 && r.totalUsd <= 2.02, '(9) rounded total in cents range', `got ${r.totalUsd}`);
  }

  // ── Group 10: bounded output on large / high-cardinality input ──────────────
  {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 120_000; i++) rows.push({ surface: 'main_chat', costUsd: 1 });
    const r = rollupRunCosts(rows);
    assertEq(r.totalUsd, 100_000, '(10) row processing capped at MAX_ROWS');
    assert(Number.isFinite(r.totalUsd), '(10) capped total finite');
  }
  {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 3000; i++) rows.push({ surface: `s${i}`, costUsd: 1 });
    const r = rollupRunCosts(rows);
    assertEq(r.totalUsd, 3000, '(10) high-cardinality total still exact');
    const keys = Object.keys(r.bySurface);
    assert(keys.length <= 2001, '(10) surface keys bounded (cap + overflow)', `keys=${keys.length}`);
    assert(r.bySurface['__overflow__'] === 1000, '(10) overflow bucket holds cut keys', `overflow=${r.bySurface['__overflow__']}`);
  }

  // ── Group 11: hostile / degenerate / cyclic — no throw ─────────────────────
  try {
    const emptyRollup = (r: CostRollup): boolean =>
      r.totalUsd === 0 && r.wastedUsd === 0 && Object.keys(r.bySurface).length === 0 && Object.keys(r.byDay).length === 0;

    assert(emptyRollup(rollupRunCosts(null)), '(11) rollup(null) empty');
    assert(emptyRollup(rollupRunCosts(undefined)), '(11) rollup(undefined) empty');
    assert(emptyRollup(rollupRunCosts(42)), '(11) rollup(number) empty');
    assert(emptyRollup(rollupRunCosts('nope')), '(11) rollup(string) empty');
    assert(emptyRollup(rollupRunCosts({ not: 'array' })), '(11) rollup(object) empty');
    assert(emptyRollup(rollupRunCosts(NaN)), '(11) rollup(NaN) empty');

    // array of junk rows → total 0, no throw
    assertEq(rollupRunCosts([null, undefined, 5, 'x', {}, []]).totalUsd, 0, '(11) junk rows → total 0');
    assertEq(rollupRunCosts([{ costUsd: NaN }, { costUsd: Infinity }, { costUsd: 'abc' }, { costUsd: -1 }]).totalUsd, 0, '(11) bad costUsd → total 0');

    // cyclic row must not blow up
    const cyclic: Record<string, unknown> = { surface: 'x', day: 'd', status: 'failed', costUsd: 1 };
    cyclic.self = cyclic;
    const cr = rollupRunCosts([cyclic]);
    assertEq(cr.totalUsd, 1, '(11) cyclic row summed');
    assertEq(cr.wastedUsd, 1, '(11) cyclic row wasted status honored');

    // estimateRunCostUsd hostile inputs
    assertEq(estimateRunCostUsd(null as unknown as { model?: unknown }), 0, '(11) estimate(null) → 0');
    assertEq(estimateRunCostUsd(undefined as unknown as { model?: unknown }), 0, '(11) estimate(undefined) → 0');
    assertEq(estimateRunCostUsd(42 as unknown as { model?: unknown }), 0, '(11) estimate(number) → 0');
    assertEq(estimateRunCostUsd('str' as unknown as { model?: unknown }), 0, '(11) estimate(string) → 0');
    assertEq(estimateRunCostUsd([] as unknown as { model?: unknown }), 0, '(11) estimate(array) → 0');
    assertEq(estimateRunCostUsd({ model: 123 }), 0, '(11) estimate(numeric model, no tokens) → 0');
    assertEq(estimateRunCostUsd({ model: {}, inputTokens: 1_000_000 }), 5, '(11) object model → default price');

    // cyclic model value → default, no throw
    const cm: Record<string, unknown> = {};
    cm.self = cm;
    assertEq(estimateRunCostUsd({ model: cm, inputTokens: 1_000_000 }), 5, '(11) cyclic model → default');

    // never NaN/negative across a battery of odd inputs
    let neverBad = true;
    const battery: Array<{ model?: unknown; cachedTokens?: unknown; inputTokens?: unknown; outputTokens?: unknown }> = [
      {},
      { model: null },
      { model: NaN },
      { inputTokens: '-999' },
      { model: 'claude-opus', inputTokens: -1e50 },
      { model: 'gpt', outputTokens: Infinity },
      { model: 'gemini', cachedTokens: 'lots' },
    ];
    for (const b of battery) {
      const c = estimateRunCostUsd(b);
      if (!Number.isFinite(c) || c < 0) neverBad = false;
    }
    assert(neverBad, '(11) estimate never NaN/negative across battery');

    assert(!isWastedRunStatus(null), '(11) isWastedRunStatus(null) → false');
    assert(!isWastedRunStatus(123), '(11) isWastedRunStatus(number) → false');
    assert(!isWastedRunStatus({}), '(11) isWastedRunStatus(object) → false');

    passes += 1; // reaching here without throwing is itself a pass
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) hostile/degenerate input threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} fail`);
    process.exit(1);
  }
  console.log(`\nAll run-cost-rollup-core smoke cases passed (${passes} passed).`);
}

main();
