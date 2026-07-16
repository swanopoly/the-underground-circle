/**
 * swanbot-continuation-budget-core-smoketest — the pure, Deno-importable
 * continuation-budget decision (src/lib/swanbotContinuationBudgetCore.ts) that
 * unifies the DRIFTING v2 continuation caps: the client's `MAX_CONTINUATIONS=6`
 * (src/lib/swanbot.ts :: callSwanBotV2, ~1049) and the edge's reuse of the
 * per-turn `MAX_ITERATIONS=5` (supabase/functions/swanbot-v2-ai/index.ts,
 * ~2676-2684). Load-bearing assertions:
 *
 *   OFF-BY-ONE FIX / CONSISTENT SEMANTICS: with `continuationCount` = rounds
 *   already COMPLETED, base counts 0..5 CONTINUE and 6 (and beyond) CAPS —
 *   one ceiling, `<` to continue / `>=` to stop, on BOTH surfaces.
 *
 *   CODING CEILING: coding tasks use the deeper ceiling (continue through 9,
 *   cap at 10), selectable via several truthy `isCodingTask` forms.
 *
 *   OVERRIDE: an explicit `maxOverride` is respected, floored, clamped to
 *   [OVERRIDE_MIN, HARD_MAX], and wins over the coding flag.
 *
 *   TOTALITY / FAIL-CLOSED: every hostile input (null/undefined/NaN/Infinity/
 *   negative/wrong-type/throwing-getter/cyclic) yields a SAFE STOP (never a
 *   spurious "keep going") and never throws.
 *
 * Pure — loads under tsx (swanbotContinuationBudgetCore has zero runtime imports).
 */

import {
  nextContinuationDecision,
  SWANBOT_CONTINUATION_BASE_MAX,
  SWANBOT_CONTINUATION_CODING_MAX,
  SWANBOT_CONTINUATION_HARD_MAX,
  SWANBOT_CONTINUATION_OVERRIDE_MIN,
  type ContinuationDecision,
} from '../src/lib/swanbotContinuationBudgetCore';

let passes = 0,
  failures = 0;
function assert(c: unknown, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// ── local helpers ────────────────────────────────────────────────────────────
function noThrow(fn: () => unknown, m: string): unknown {
  try {
    return fn();
  } catch (e) {
    failures++;
    console.error('FAIL: ' + m + ' :: threw ' + (e as Error)?.message);
    return undefined;
  }
}
function isWellFormed(d: ContinuationDecision): boolean {
  return (
    !!d &&
    typeof d === 'object' &&
    typeof d.shouldContinue === 'boolean' &&
    typeof d.atCap === 'boolean' &&
    typeof d.roundsLeft === 'number' &&
    Number.isFinite(d.roundsLeft) &&
    d.roundsLeft >= 0 &&
    typeof d.reason === 'string' &&
    d.reason.length > 0 &&
    d.reason.length < 80 &&
    // shouldContinue and atCap are always mutual opposites.
    d.shouldContinue !== d.atCap
  );
}
function assertContinue(d: ContinuationDecision, ceiling: number, completed: number, m: string) {
  assert(isWellFormed(d), m + ' well-formed', JSON.stringify(d));
  assertEq(d.shouldContinue, true, m + ' shouldContinue=true');
  assertEq(d.atCap, false, m + ' atCap=false');
  assertEq(d.roundsLeft, ceiling - completed, m + ' roundsLeft');
  assert(d.reason.indexOf('continue:') === 0, m + ' reason starts continue:', d.reason);
}
function assertStop(d: ContinuationDecision, m: string) {
  assert(isWellFormed(d), m + ' well-formed', JSON.stringify(d));
  assertEq(d.shouldContinue, false, m + ' shouldContinue=false');
  assertEq(d.atCap, true, m + ' atCap=true');
  assertEq(d.roundsLeft, 0, m + ' roundsLeft=0');
}

function main() {
  // ── 1. Constants sanity ────────────────────────────────────────────────────
  assertEq(SWANBOT_CONTINUATION_BASE_MAX, 6, '1 base=6');
  assertEq(SWANBOT_CONTINUATION_CODING_MAX, 10, '1 coding=10');
  assertEq(SWANBOT_CONTINUATION_HARD_MAX, 24, '1 hard=24');
  assertEq(SWANBOT_CONTINUATION_OVERRIDE_MIN, 1, '1 override-min=1');
  assert(SWANBOT_CONTINUATION_BASE_MAX < SWANBOT_CONTINUATION_CODING_MAX, '1 base<coding');
  assert(SWANBOT_CONTINUATION_CODING_MAX <= SWANBOT_CONTINUATION_HARD_MAX, '1 coding<=hard');

  // ── 2. Base ceiling: counts 0..5 CONTINUE ─────────────────────────────────
  for (let c = 0; c <= 5; c++) {
    const d = nextContinuationDecision({ continuationCount: c });
    assertContinue(d, 6, c, '2 base continue@' + c);
    assert(d.reason.indexOf('(base)') > 0, '2 base reason tag@' + c, d.reason);
  }
  // roundsLeft counts down 6..1 across completed 0..5.
  assertEq(nextContinuationDecision({ continuationCount: 0 }).roundsLeft, 6, '2 roundsLeft@0=6');
  assertEq(nextContinuationDecision({ continuationCount: 5 }).roundsLeft, 1, '2 roundsLeft@5=1');

  // ── 3. Base cap: count 6 → atCap; beyond 6 stays capped ───────────────────
  assertStop(nextContinuationDecision({ continuationCount: 6 }), '3 base cap@6');
  assert(nextContinuationDecision({ continuationCount: 6 }).reason.indexOf('at-cap:') === 0, '3 base cap reason');
  for (const over of [7, 8, 20, 100, 1e6]) {
    assertStop(nextContinuationDecision({ continuationCount: over }), '3 over-cap@' + over);
  }

  // ── 4. Coding ceiling: continue through 9, cap at 10 ──────────────────────
  for (let c = 0; c <= 9; c++) {
    assertContinue(nextContinuationDecision({ continuationCount: c, isCodingTask: true }), 10, c, '4 coding continue@' + c);
  }
  assertEq(nextContinuationDecision({ continuationCount: 9, isCodingTask: true }).roundsLeft, 1, '4 coding roundsLeft@9=1');
  assertStop(nextContinuationDecision({ continuationCount: 10, isCodingTask: true }), '4 coding cap@10');
  assertStop(nextContinuationDecision({ continuationCount: 11, isCodingTask: true }), '4 coding over-cap@11');
  // A coding task is NOT capped at 6 (where base would be).
  assertContinue(nextContinuationDecision({ continuationCount: 6, isCodingTask: true }), 10, 6, '4 coding@6 still continues');
  assert(nextContinuationDecision({ continuationCount: 6, isCodingTask: true }).reason.indexOf('(coding)') > 0, '4 coding reason tag');

  // ── 5. isCodingTask truthy / falsy forms ──────────────────────────────────
  for (const t of [true, 1, 'true', 'TRUE', ' yes ', 'coding', '1']) {
    // count 6 continues only under the coding ceiling.
    assert(nextContinuationDecision({ continuationCount: 6, isCodingTask: t }).shouldContinue === true, '5 truthy coding form ' + JSON.stringify(t));
  }
  for (const f of [false, 0, 'no', 'false', '', 'nope', null, undefined, {}, [], 2, 'yess']) {
    // Falsy/unclear → base ceiling → count 6 caps.
    assertStop(nextContinuationDecision({ continuationCount: 6, isCodingTask: f }), '5 falsy coding form ' + JSON.stringify(f));
  }

  // ── 6. Override respected + clamped + precedence ──────────────────────────
  // Plain override 8 → ceiling 8.
  assertContinue(nextContinuationDecision({ continuationCount: 7, maxOverride: 8 }), 8, 7, '6 override8 continue@7');
  assertStop(nextContinuationDecision({ continuationCount: 8, maxOverride: 8 }), '6 override8 cap@8');
  assert(nextContinuationDecision({ continuationCount: 7, maxOverride: 8 }).reason.indexOf('(override)') > 0, '6 override reason tag');
  // Override wins over coding flag.
  assertStop(nextContinuationDecision({ continuationCount: 3, isCodingTask: true, maxOverride: 3 }), '6 override beats coding cap@3');
  assertContinue(nextContinuationDecision({ continuationCount: 2, isCodingTask: true, maxOverride: 3 }), 3, 2, '6 override beats coding continue@2');
  // Clamp HIGH → HARD_MAX (24).
  assertContinue(nextContinuationDecision({ continuationCount: 23, maxOverride: 100 }), 24, 23, '6 clamp-high continue@23');
  assertStop(nextContinuationDecision({ continuationCount: 24, maxOverride: 100 }), '6 clamp-high cap@24');
  assertStop(nextContinuationDecision({ continuationCount: 24, maxOverride: 999999 }), '6 clamp-high huge cap@24');
  // Clamp LOW → OVERRIDE_MIN (1).
  assertContinue(nextContinuationDecision({ continuationCount: 0, maxOverride: 0 }), 1, 0, '6 clamp-low(0) continue@0');
  assertStop(nextContinuationDecision({ continuationCount: 1, maxOverride: 0 }), '6 clamp-low(0) cap@1');
  assertStop(nextContinuationDecision({ continuationCount: 1, maxOverride: -5 }), '6 clamp-low(neg) cap@1');
  // Fractional override floors (8.9 → 8).
  assertContinue(nextContinuationDecision({ continuationCount: 7, maxOverride: 8.9 }), 8, 7, '6 frac override floor continue@7');
  assertStop(nextContinuationDecision({ continuationCount: 8, maxOverride: 8.9 }), '6 frac override floor cap@8');
  // Numeric-string override "5" → ceiling 5.
  assertContinue(nextContinuationDecision({ continuationCount: 4, maxOverride: '5' }), 5, 4, '6 string override continue@4');
  assertStop(nextContinuationDecision({ continuationCount: 5, maxOverride: '5' }), '6 string override cap@5');
  // Non-numeric / non-finite override IGNORED → falls back to base.
  for (const bad of ['abc', '', NaN, Infinity, -Infinity, null, undefined, {}, [], true]) {
    assertStop(nextContinuationDecision({ continuationCount: 6, maxOverride: bad }), '6 bad override→base cap@6 ' + JSON.stringify(bad));
  }

  // ── 7. Numeric-string / fractional continuationCount ──────────────────────
  assertContinue(nextContinuationDecision({ continuationCount: '3' }), 6, 3, '7 string count "3"');
  assertContinue(nextContinuationDecision({ continuationCount: 3.9 }), 6, 3, '7 frac count 3.9 floors to 3');
  assertStop(nextContinuationDecision({ continuationCount: '6' }), '7 string count "6" caps');
  assertContinue(nextContinuationDecision({ continuationCount: ' 0 ' }), 6, 0, '7 padded "0" continues');

  // ── 8. Hostile / degenerate — SAFE STOP, no throw ─────────────────────────
  const hostileCounts: unknown[] = [
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    -1,
    -100,
    'abc',
    '',
    '   ',
    true,
    false,
    {},
    [],
    [1, 2, 3],
    () => 6,
    Symbol('x') as unknown,
    { valueOf() { return 3; } }, // objects are not coerced → stop
  ];
  for (const hc of hostileCounts) {
    const d = noThrow(() => nextContinuationDecision({ continuationCount: hc }), '8 no-throw count ' + String(hc as any)) as ContinuationDecision;
    assertStop(d, '8 hostile count → stop ' + String(hc as any));
    assert(d.reason.indexOf('invalid-continuation-count') === 0 || d.reason.indexOf('at-cap:') === 0, '8 hostile reason bounded');
  }
  // The whole `input` being junk (not an object) → safe stop, no throw.
  for (const bad of [null, undefined, 0, 7, 'nope', true, Symbol('s') as unknown, [] as unknown]) {
    const d = noThrow(() => nextContinuationDecision(bad as any), '8 no-throw junk input ' + String(bad as any)) as ContinuationDecision;
    assertStop(d, '8 junk input → stop ' + String(bad as any));
  }
  // Throwing getters on every field → caught → safe stop.
  const throwing: Record<string, unknown> = {};
  for (const k of ['continuationCount', 'isCodingTask', 'maxOverride']) {
    Object.defineProperty(throwing, k, {
      enumerable: true,
      get() {
        throw new Error('boom-' + k);
      },
    });
  }
  assertStop(noThrow(() => nextContinuationDecision(throwing as any), '8 throwing getters no-throw') as ContinuationDecision, '8 throwing getters → stop');
  // Cyclic object as input → we never stringify it → safe stop, no throw.
  const cyclic: any = { continuationCount: undefined };
  cyclic.self = cyclic;
  assertStop(noThrow(() => nextContinuationDecision(cyclic), '8 cyclic no-throw') as ContinuationDecision, '8 cyclic → stop');
  // Huge count → bounded reason, still a stop.
  const huge = nextContinuationDecision({ continuationCount: 1e21 });
  assertStop(huge, '8 huge count → stop');
  assert(huge.reason.length < 80, '8 huge reason bounded', huge.reason);

  // ── 9. Determinism + shape matrix ─────────────────────────────────────────
  const a = nextContinuationDecision({ continuationCount: 4, isCodingTask: true });
  const b = nextContinuationDecision({ continuationCount: 4, isCodingTask: true });
  assertEq(JSON.stringify(a), JSON.stringify(b), '9 deterministic');
  const matrix: Array<{ continuationCount: unknown; isCodingTask?: unknown; maxOverride?: unknown }> = [
    { continuationCount: 0 },
    { continuationCount: 6 },
    { continuationCount: 3, isCodingTask: true },
    { continuationCount: 10, isCodingTask: true },
    { continuationCount: 2, maxOverride: 4 },
    { continuationCount: 'x' },
    { continuationCount: 99, maxOverride: 999 },
  ];
  for (const m of matrix) {
    const d = nextContinuationDecision(m);
    assert(isWellFormed(d), '9 well-formed ' + JSON.stringify(m), JSON.stringify(d));
    // roundsLeft never exceeds the hard ceiling.
    assert(d.roundsLeft <= SWANBOT_CONTINUATION_HARD_MAX, '9 roundsLeft bounded ' + JSON.stringify(m));
  }
  // Boundary equivalence: the last continuing round + 1 always caps.
  for (const ceiling of [SWANBOT_CONTINUATION_BASE_MAX, SWANBOT_CONTINUATION_CODING_MAX]) {
    const coding = ceiling === SWANBOT_CONTINUATION_CODING_MAX;
    assertContinue(nextContinuationDecision({ continuationCount: ceiling - 1, isCodingTask: coding }), ceiling, ceiling - 1, '9 boundary continue@' + (ceiling - 1));
    assertStop(nextContinuationDecision({ continuationCount: ceiling, isCodingTask: coding }), '9 boundary cap@' + ceiling);
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll swanbot-continuation-budget-core smoke cases passed (' + passes + ' passed).');
}

main();
