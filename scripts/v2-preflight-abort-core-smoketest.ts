/**
 * v2-preflight-abort-core-smoketest — the pure, Deno-importable PRE-ROUND doom
 * guard (src/lib/v2PreflightAbortCore.ts) that lets swanbot-v2-ai's runLoop skip
 * a structurally DOOMED next model round-trip instead of spending the wasted
 * Anthropic call (supabase/functions/swanbot-v2-ai/index.ts, `anthropicTurn`
 * inside `for (iter…)` ~2627-2632). Load-bearing assertions:
 *
 *   FOUR DOOMS (fail-CLOSED on definite): modelSupported=false →
 *   model_unsupported; requestedToolMissing → no_tools_for_request; ≥ N
 *   consecutive no-progress rounds → stalled_no_progress; budgetRemaining ≤ 0 →
 *   budget_exhausted. Each yields proceed=false + a bounded reason.
 *
 *   FAIL-OPEN (the deliberate inversion vs the budget core): every ambiguous /
 *   empty / unreadable / hostile input PROCEEDS so a live turn is never wrongly
 *   killed. Only a positively-readable doom aborts.
 *
 *   GUARDS: `lastRoundProducedToolCallOrText`=true rescues a stall (the last
 *   round moved); `toolsAvailableCount`=0 ALONE never aborts (a zero-tool round
 *   can still end in a clean text terminal).
 *
 *   PRECEDENCE: co-occurring dooms resolve model → tools → stall → budget.
 *
 *   TOTALITY: null/undefined/NaN/Infinity/wrong-type/throwing-getter/cyclic
 *   input never throws.
 *
 * Pure — loads under tsx (v2PreflightAbortCore has zero runtime imports).
 */

import {
  decideV2Preflight,
  V2_PREFLIGHT_STALL_THRESHOLD,
  V2_PREFLIGHT_REASON_MAX,
  type V2PreflightDecision,
  type V2PreflightClassification,
} from '../src/lib/v2PreflightAbortCore';

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
const CLASSES: V2PreflightClassification[] = [
  'ok',
  'model_unsupported',
  'no_tools_for_request',
  'stalled_no_progress',
  'budget_exhausted',
];
function isWellFormed(d: V2PreflightDecision): boolean {
  return (
    !!d &&
    typeof d === 'object' &&
    typeof d.proceed === 'boolean' &&
    CLASSES.indexOf(d.classification) >= 0 &&
    (d.abortReason === null ||
      (typeof d.abortReason === 'string' &&
        d.abortReason.length > 0 &&
        d.abortReason.length <= V2_PREFLIGHT_REASON_MAX)) &&
    // The three fields are always mutually consistent.
    d.proceed === (d.classification === 'ok') &&
    d.proceed === (d.abortReason === null)
  );
}
function assertProceed(d: V2PreflightDecision, m: string) {
  assert(isWellFormed(d), m + ' well-formed', JSON.stringify(d));
  assertEq(d.proceed, true, m + ' proceed=true');
  assertEq(d.classification, 'ok', m + ' classification=ok');
  assertEq(d.abortReason, null, m + ' abortReason=null');
}
function assertAbort(d: V2PreflightDecision, cls: V2PreflightClassification, m: string) {
  assert(isWellFormed(d), m + ' well-formed', JSON.stringify(d));
  assertEq(d.proceed, false, m + ' proceed=false');
  assertEq(d.classification, cls, m + ' classification=' + cls);
  assert(typeof d.abortReason === 'string' && d.abortReason.length > 0, m + ' reason non-empty', JSON.stringify(d.abortReason));
  assert(!!d.abortReason && d.abortReason.indexOf(cls) === 0, m + ' reason tagged', String(d.abortReason));
}
const HEALTHY = {
  modelSupported: true,
  toolsAvailableCount: 12,
  requestedToolMissing: false,
  lastRoundProducedToolCallOrText: true,
  consecutiveNoProgressRounds: 0,
  budgetRemaining: 4,
};

function main() {
  // ── 1. Constants + a baseline healthy decision ────────────────────────────
  assertEq(V2_PREFLIGHT_STALL_THRESHOLD, 2, '1 stall-threshold=2');
  assert(Number.isInteger(V2_PREFLIGHT_STALL_THRESHOLD) && V2_PREFLIGHT_STALL_THRESHOLD >= 2, '1 threshold sane');
  assert(V2_PREFLIGHT_REASON_MAX >= 40 && V2_PREFLIGHT_REASON_MAX < 200, '1 reason-max bounded');
  assertProceed(decideV2Preflight(HEALTHY), '1 healthy baseline');

  // ── 2. model_unsupported doom ─────────────────────────────────────────────
  for (const v of [false, 0, 'false', 'no', 'off', 'FALSE', ' No ', 'unsupported', 'not_supported', 'not-supported', 'unavailable']) {
    assertAbort(decideV2Preflight({ ...HEALTHY, modelSupported: v }), 'model_unsupported', '2 unsupported ' + JSON.stringify(v));
  }
  // Supported / ambiguous modelSupported → NOT this doom (proceeds under HEALTHY).
  for (const v of [true, 1, 'true', 'yes', 'on', undefined, null, NaN, 'maybe', {}, [], 2]) {
    const d = decideV2Preflight({ ...HEALTHY, modelSupported: v });
    assert(d.classification !== 'model_unsupported', '2 not-unsupported ' + JSON.stringify(v), JSON.stringify(d));
    assertProceed(d, '2 supported→proceed ' + JSON.stringify(v));
  }

  // ── 3. no_tools_for_request doom ──────────────────────────────────────────
  for (const v of [true, 1, 'true', 'yes', 'on', 'missing', 'ABSENT', ' unavailable ', 'not_found', 'not-found']) {
    assertAbort(decideV2Preflight({ ...HEALTHY, requestedToolMissing: v }), 'no_tools_for_request', '3 missing ' + JSON.stringify(v));
  }
  // Not-missing / ambiguous → proceeds.
  for (const v of [false, 0, 'false', 'no', 'present', undefined, null, {}, []]) {
    assertProceed(decideV2Preflight({ ...HEALTHY, requestedToolMissing: v }), '3 not-missing→proceed ' + JSON.stringify(v));
  }
  // toolsAvailableCount is folded into the reason but never independently aborts.
  const withCount = decideV2Preflight({ ...HEALTHY, requestedToolMissing: true, toolsAvailableCount: 0 });
  assertAbort(withCount, 'no_tools_for_request', '3 missing+0tools');
  assert(withCount.abortReason!.indexOf('(tools=0)') > 0, '3 reason folds tool count', String(withCount.abortReason));
  // 0 tools ALONE (no missing-tool signal) → still proceeds (text terminal is fine).
  assertProceed(decideV2Preflight({ ...HEALTHY, toolsAvailableCount: 0 }), '3 zero-tools alone→proceed');
  assertProceed(decideV2Preflight({ ...HEALTHY, toolsAvailableCount: 0, requestedToolMissing: false }), '3 zero-tools + not-missing→proceed');

  // ── 4. stalled_no_progress doom ───────────────────────────────────────────
  // At/above threshold with no positive last-round output → abort.
  for (const c of [2, 3, 5, 99]) {
    assertAbort(
      decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: c, lastRoundProducedToolCallOrText: false }),
      'stalled_no_progress',
      '4 stall@' + c,
    );
  }
  // Below threshold → proceed.
  for (const c of [0, 1]) {
    assertProceed(
      decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: c, lastRoundProducedToolCallOrText: false }),
      '4 below-threshold@' + c,
    );
  }
  // GUARD: last round positively produced output → rescue even at/over threshold.
  for (const c of [2, 4, 10]) {
    assertProceed(
      decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: c, lastRoundProducedToolCallOrText: true }),
      '4 rescued-by-progress@' + c,
    );
  }
  // Unknown last-round flag does NOT rescue — the streak count alone drives it.
  assertAbort(
    decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: 2, lastRoundProducedToolCallOrText: undefined }),
    'stalled_no_progress',
    '4 unknown-lastround no rescue',
  );
  // Numeric-string / fractional streak.
  assertAbort(decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: '3', lastRoundProducedToolCallOrText: false }), 'stalled_no_progress', '4 string streak "3"');
  assertAbort(decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: 2.9, lastRoundProducedToolCallOrText: false }), 'stalled_no_progress', '4 frac streak floors to 2');
  assertProceed(decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: 1.9, lastRoundProducedToolCallOrText: false }), '4 frac 1.9 floors to 1→proceed');
  // Hostile streak (negative / non-numeric) → unreadable → fail open.
  for (const c of [-1, -100, 'abc', NaN, Infinity, {}, [], null, undefined]) {
    assertProceed(decideV2Preflight({ ...HEALTHY, consecutiveNoProgressRounds: c, lastRoundProducedToolCallOrText: false }), '4 hostile streak→proceed ' + JSON.stringify(c));
  }

  // ── 5. budget_exhausted doom ──────────────────────────────────────────────
  for (const b of [0, -0, -1, -5, -1e21, '0', '-3', ' -2 ']) {
    assertAbort(decideV2Preflight({ ...HEALTHY, budgetRemaining: b }), 'budget_exhausted', '5 exhausted ' + JSON.stringify(b));
  }
  // Positive budget → proceed.
  for (const b of [1, 0.5, 6, 24, '3']) {
    assertProceed(decideV2Preflight({ ...HEALTHY, budgetRemaining: b }), '5 positive→proceed ' + JSON.stringify(b));
  }
  // Unreadable / non-finite budget → fail open (NOT treated as <=0).
  for (const b of [NaN, Infinity, -Infinity, 'abc', '', {}, [], null, undefined]) {
    assertProceed(decideV2Preflight({ ...HEALTHY, budgetRemaining: b }), '5 unreadable→proceed ' + JSON.stringify(b));
  }

  // ── 6. Healthy variants → proceed ─────────────────────────────────────────
  assertProceed(decideV2Preflight({ ...HEALTHY }), '6 healthy');
  assertProceed(decideV2Preflight({ modelSupported: true, budgetRemaining: 1 }), '6 minimal healthy');
  assertProceed(decideV2Preflight({ ...HEALTHY, toolsAvailableCount: 30, consecutiveNoProgressRounds: 1 }), '6 one-noprogress ok');

  // ── 7. Ambiguous / empty → proceed (fail open) ────────────────────────────
  assertProceed(decideV2Preflight({}), '7 empty object');
  assertProceed(
    decideV2Preflight({
      modelSupported: undefined,
      toolsAvailableCount: undefined,
      requestedToolMissing: undefined,
      lastRoundProducedToolCallOrText: undefined,
      consecutiveNoProgressRounds: undefined,
      budgetRemaining: undefined,
    }),
    '7 all-undefined',
  );
  assertProceed(decideV2Preflight({ modelSupported: 'maybe', budgetRemaining: 'lots' }), '7 unreadable strings');

  // ── 8. Precedence: model → tools → stall → budget ─────────────────────────
  // All four dooms at once → model wins.
  const allDoom = {
    modelSupported: false,
    requestedToolMissing: true,
    consecutiveNoProgressRounds: 9,
    lastRoundProducedToolCallOrText: false,
    budgetRemaining: -5,
    toolsAvailableCount: 0,
  };
  assertAbort(decideV2Preflight(allDoom), 'model_unsupported', '8 all→model');
  // tools + stall + budget (model ok) → tools wins.
  assertAbort(
    decideV2Preflight({ modelSupported: true, requestedToolMissing: true, consecutiveNoProgressRounds: 9, lastRoundProducedToolCallOrText: false, budgetRemaining: -5 }),
    'no_tools_for_request',
    '8 tools+stall+budget→tools',
  );
  // stall + budget (model ok, tools ok) → stall wins.
  assertAbort(
    decideV2Preflight({ modelSupported: true, requestedToolMissing: false, consecutiveNoProgressRounds: 9, lastRoundProducedToolCallOrText: false, budgetRemaining: -5 }),
    'stalled_no_progress',
    '8 stall+budget→stall',
  );
  // budget only.
  assertAbort(
    decideV2Preflight({ modelSupported: true, requestedToolMissing: false, consecutiveNoProgressRounds: 0, budgetRemaining: 0 }),
    'budget_exhausted',
    '8 budget only',
  );
  // Precedence holds even when the higher-precedence guard is rescued: stall
  // rescued by last-round progress but budget still exhausted → budget wins.
  assertAbort(
    decideV2Preflight({ modelSupported: true, consecutiveNoProgressRounds: 9, lastRoundProducedToolCallOrText: true, budgetRemaining: -1 }),
    'budget_exhausted',
    '8 stall-rescued→budget',
  );

  // ── 9. Hostile / degenerate WHOLE input — no throw, and fail OPEN ──────────
  const hostileInputs: unknown[] = [
    null,
    undefined,
    0,
    7,
    -1,
    NaN,
    Infinity,
    'nope',
    '',
    true,
    false,
    Symbol('s') as unknown,
    () => 6,
    [],
    [1, 2, 3],
    {},
  ];
  for (const hi of hostileInputs) {
    const d = noThrow(() => decideV2Preflight(hi as any), '9 no-throw whole-input ' + String(hi as any)) as V2PreflightDecision;
    assert(isWellFormed(d), '9 well-formed ' + String(hi as any), JSON.stringify(d));
    // No definite doom is readable from junk → must PROCEED (fail open).
    assertProceed(d, '9 junk input→proceed ' + String(hi as any));
  }
  // Throwing getters on every field → caught → fail open (proceed).
  const throwing: Record<string, unknown> = {};
  for (const k of ['modelSupported', 'toolsAvailableCount', 'requestedToolMissing', 'lastRoundProducedToolCallOrText', 'consecutiveNoProgressRounds', 'budgetRemaining']) {
    Object.defineProperty(throwing, k, { enumerable: true, get() { throw new Error('boom-' + k); } });
  }
  assertProceed(noThrow(() => decideV2Preflight(throwing as any), '9 throwing getters no-throw') as V2PreflightDecision, '9 throwing getters→proceed');
  // A throwing getter on one field must NOT suppress a definite doom on another.
  const mixed: Record<string, unknown> = { requestedToolMissing: true };
  Object.defineProperty(mixed, 'modelSupported', { enumerable: true, get() { throw new Error('boom'); } });
  assertAbort(noThrow(() => decideV2Preflight(mixed as any), '9 mixed no-throw') as V2PreflightDecision, 'no_tools_for_request', '9 throwing model + real tool doom');
  // Cyclic input → we never stringify it → safe proceed, no throw.
  const cyclic: any = { modelSupported: true, budgetRemaining: 3 };
  cyclic.self = cyclic;
  assertProceed(noThrow(() => decideV2Preflight(cyclic), '9 cyclic no-throw') as V2PreflightDecision, '9 cyclic→proceed');
  // Hostile FIELD values under an otherwise-healthy shape → still proceed.
  assertProceed(decideV2Preflight({ ...HEALTHY, modelSupported: Symbol('x') as unknown, requestedToolMissing: (() => {}) as unknown }), '9 hostile field values→proceed');

  // ── 10. Determinism, reason bounds, secret-free ───────────────────────────
  const a = decideV2Preflight({ modelSupported: false, budgetRemaining: -1 });
  const b = decideV2Preflight({ modelSupported: false, budgetRemaining: -1 });
  assertEq(JSON.stringify(a), JSON.stringify(b), '10 deterministic');
  const reasonSamples: V2PreflightDecision[] = [
    decideV2Preflight({ modelSupported: false }),
    decideV2Preflight({ requestedToolMissing: true, toolsAvailableCount: 999999999 }),
    decideV2Preflight({ consecutiveNoProgressRounds: 1e6, lastRoundProducedToolCallOrText: false }),
    decideV2Preflight({ budgetRemaining: -1e21 }),
  ];
  for (const d of reasonSamples) {
    assert(isWellFormed(d), '10 sample well-formed', JSON.stringify(d));
    assert(!!d.abortReason && d.abortReason.length <= V2_PREFLIGHT_REASON_MAX, '10 reason bounded', String(d.abortReason));
    // Printable ASCII only — no control chars, no injected content.
    assert(/^[\x20-\x7e]+$/.test(d.abortReason || ''), '10 reason printable ascii', String(d.abortReason));
  }
  // Every decision's classification/proceed/reason invariants hold across a matrix.
  const matrix: any[] = [
    HEALTHY,
    {},
    { modelSupported: false },
    { requestedToolMissing: true },
    { consecutiveNoProgressRounds: 3, lastRoundProducedToolCallOrText: false },
    { budgetRemaining: 0 },
    { budgetRemaining: 5 },
    null,
    42,
  ];
  for (const m of matrix) {
    const d = decideV2Preflight(m as any);
    assert(isWellFormed(d), '10 matrix well-formed ' + JSON.stringify(m), JSON.stringify(d));
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll v2-preflight-abort-core smoke cases passed (' + passes + ' passed).');
}

main();
