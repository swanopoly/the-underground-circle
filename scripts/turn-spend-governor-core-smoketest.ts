/**
 * turn-spend-governor-core-smoketest — the pure in-flight per-TURN DOLLAR
 * governor (src/lib/turnSpendGovernorCore.ts). openswanSessionRuntime consults
 * evaluateTurnSpend each round so a long turn takes the CHEAPEST GRACEFUL
 * economic lever (downshift -> summarize -> stop) instead of running to its step
 * cap regardless of cost or being hard-blocked by a period limit. Load-bearing:
 *
 *   BANDS — calm -> continue; warm -> downshift; warm+alreadyDownshifted ->
 *   summarize-and-continue; hot -> summarize; hot+alreadySummarized -> downshift;
 *   hot+both -> stop-and-ask; ratio >= 1 -> stop. BACKSTOP — accrued >= $50
 *   (uncapped) -> stop, capped:false, cap = ABSOLUTE. CAP-COMPOSITION —
 *   min(soft, fraction-of-remaining), value modulation (0 -> x0.6, 1 -> x1.4,
 *   0.5 -> x1.0), MIN/MAX clamps. PROJECTION — a pricey round breaches at a low
 *   ratio -> downshift; rounds 0 -> projected null, never breaches. DETERMINISM.
 *
 *   TOTAL: null / undefined / wrong-type / NaN / +-Infinity / negative / huge /
 *   bigint / symbol / control-char / cyclic / throwing-getter input never throws.
 *
 * Pure — loads under tsx (turnSpendGovernorCore has zero imports).
 * Run: npx tsx scripts/turn-spend-governor-core-smoketest.ts
 */

import {
  evaluateTurnSpend,
  resolveEffectiveTurnCap,
  SPEND_GOVERNOR_DOWNSHIFT_RATIO,
  SPEND_GOVERNOR_SUMMARIZE_RATIO,
  SPEND_GOVERNOR_STOP_RATIO,
  DEFAULT_TURN_CAP_FRACTION,
  ABSOLUTE_MAX_TURN_USD,
  MIN_TURN_CAP_USD,
  MAX_TURN_CAP_USD,
  MIN_VALUE_MULT,
  MAX_VALUE_MULT,
  DEFAULT_TASK_VALUE,
  MAX_ACCRUED_USD,
  MAX_RATIO,
  MAX_REASON_LEN,
  type SpendGovernorAction,
  type SpendGovernorDecision,
} from '../src/lib/turnSpendGovernorCore';

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
function assertClose(a: number, b: number, msg: string, eps = 1e-9): void {
  assert(
    typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= eps,
    msg,
    `got ${a} want ~${b}`,
  );
}
function assertIncludes(hay: string, needle: string, msg: string): void {
  assert(typeof hay === 'string' && hay.includes(needle), msg, `"${hay}" missing "${needle}"`);
}

const ACTIONS: ReadonlySet<SpendGovernorAction> = new Set([
  'continue',
  'downshift',
  'summarize-and-continue',
  'stop-and-ask',
]);

/** A reason must carry no control / DEL / C1 / line-separator char. */
function noControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) {
      return false;
    }
  }
  return true;
}

/** A decision is well-formed: valid action; cap in [MIN, ABSOLUTE]; finite ratio
 *  in [0, MAX_RATIO]; projected null or a finite non-negative bounded number;
 *  boolean flags; a bounded, non-empty, control-free reason. */
function wellFormed(d: SpendGovernorDecision): boolean {
  return (
    !!d &&
    typeof d === 'object' &&
    ACTIONS.has(d.action) &&
    typeof d.effectiveTurnCapUsd === 'number' &&
    Number.isFinite(d.effectiveTurnCapUsd) &&
    d.effectiveTurnCapUsd >= MIN_TURN_CAP_USD &&
    d.effectiveTurnCapUsd <= ABSOLUTE_MAX_TURN_USD &&
    typeof d.spendRatio === 'number' &&
    Number.isFinite(d.spendRatio) &&
    d.spendRatio >= 0 &&
    d.spendRatio <= MAX_RATIO &&
    (d.projectedNextRoundUsd === null ||
      (typeof d.projectedNextRoundUsd === 'number' &&
        Number.isFinite(d.projectedNextRoundUsd) &&
        d.projectedNextRoundUsd >= 0 &&
        d.projectedNextRoundUsd <= MAX_ACCRUED_USD)) &&
    typeof d.nextRoundBreaches === 'boolean' &&
    typeof d.capped === 'boolean' &&
    typeof d.reason === 'string' &&
    d.reason.length > 0 &&
    d.reason.length <= MAX_REASON_LEN &&
    noControlChars(d.reason)
  );
}

/** Runs the governor on hostile input; records a failure (not a crash) on throw. */
function noThrow(label: string, fn: () => SpendGovernorDecision): SpendGovernorDecision {
  try {
    const d = fn();
    assert(wellFormed(d), `${label} -> well-formed decision`, JSON.stringify(d));
    return d;
  } catch (err) {
    // Never String() the hostile value itself — only the fixed label + err.
    assert(false, `${label} -> must not throw`, String(err));
    return { action: 'stop-and-ask', effectiveTurnCapUsd: MIN_TURN_CAP_USD, spendRatio: 0, projectedNextRoundUsd: null, nextRoundBreaches: false, capped: true, reason: 'threw' };
  }
}

/** A cap composed from an explicit soft cap so bands hit exact ratios. */
const CAP1 = { perTurnSoftCapUsd: 1 }; // baseCap 1, taskValue default 0.5 -> mult ~1.0 -> cap ~1.0

function main(): void {
  // ─── (1) exported policy constants ────────────────────────────────────────
  assertEq(SPEND_GOVERNOR_DOWNSHIFT_RATIO, 0.6, '(1) downshift ratio = 0.6');
  assertEq(SPEND_GOVERNOR_SUMMARIZE_RATIO, 0.85, '(1) summarize ratio = 0.85');
  assertEq(SPEND_GOVERNOR_STOP_RATIO, 1.0, '(1) stop ratio = 1.0');
  assertEq(DEFAULT_TURN_CAP_FRACTION, 0.25, '(1) turn cap fraction = 0.25');
  assertEq(ABSOLUTE_MAX_TURN_USD, 50, '(1) absolute per-turn backstop = $50');
  assertEq(MIN_TURN_CAP_USD, 0.02, '(1) min turn cap = $0.02');
  assertEq(MAX_TURN_CAP_USD, 25, '(1) max real turn cap = $25');
  assert(MAX_TURN_CAP_USD <= ABSOLUTE_MAX_TURN_USD, '(1) max real cap <= absolute backstop');
  assertEq(MIN_VALUE_MULT, 0.6, '(1) min value mult = 0.6');
  assertEq(MAX_VALUE_MULT, 1.4, '(1) max value mult = 1.4');
  assertEq(DEFAULT_TASK_VALUE, 0.5, '(1) default task value = 0.5');
  assertEq(MAX_ACCRUED_USD, 1e9, '(1) max accrued = 1e9');
  assertEq(MAX_RATIO, 1e6, '(1) max ratio = 1e6');
  assertEq(MAX_REASON_LEN, 200, '(1) max reason len = 200');
  // value 0.5 -> multiplier 1.0 (identity — no surprise by default)
  assertClose(MIN_VALUE_MULT + 0.5 * (MAX_VALUE_MULT - MIN_VALUE_MULT), 1.0, '(1) value 0.5 -> mult 1.0');

  // ─── (2) BANDS ────────────────────────────────────────────────────────────
  const calm = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.3 });
  assertEq(calm.action, 'continue', '(2) calm (ratio .3) -> continue');
  assert(wellFormed(calm), '(2) calm decision well-formed', JSON.stringify(calm));
  assertIncludes(calm.reason, 'continue:', '(2) calm reason marks continue');

  const warm = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.7 });
  assertEq(warm.action, 'downshift', '(2) warm (ratio .7) -> downshift');
  assertIncludes(warm.reason, 'downshift:', '(2) warm reason marks downshift');

  const warmD = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.7, alreadyDownshifted: true });
  assertEq(warmD.action, 'summarize-and-continue', '(2) warm + alreadyDownshifted -> summarize');

  const hot = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.9 });
  assertEq(hot.action, 'summarize-and-continue', '(2) hot (ratio .9) -> summarize');
  assertIncludes(hot.reason, 'summarize-and-continue:', '(2) hot reason marks summarize');

  const hotS = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.9, alreadySummarized: true });
  assertEq(hotS.action, 'downshift', '(2) hot + alreadySummarized -> downshift');

  const hotBoth = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.9, alreadyDownshifted: true, alreadySummarized: true });
  assertEq(hotBoth.action, 'stop-and-ask', '(2) hot + both levers spent -> stop-and-ask');
  assertIncludes(hotBoth.reason, 'stop-and-ask:', '(2) both-spent reason marks stop');

  const overCap = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 1.0 });
  assertEq(overCap.action, 'stop-and-ask', '(2) ratio >= 1 (accrued == cap) -> stop');
  const wayOver = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 5 });
  assertEq(wayOver.action, 'stop-and-ask', '(2) ratio well over 1 -> stop');

  // ─── (3) band CONSISTENCY (the other lever combinations) ──────────────────
  // warm + alreadySummarized (downshift still available) -> downshift (cheapest).
  const warmS = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.7, alreadySummarized: true });
  assertEq(warmS.action, 'downshift', '(3) warm + alreadySummarized -> downshift');
  // hot + alreadyDownshifted (summarize still available) -> summarize.
  const hotDownshifted = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.9, alreadyDownshifted: true });
  assertEq(hotDownshifted.action, 'summarize-and-continue', '(3) hot + alreadyDownshifted -> summarize');
  // warm + BOTH levers spent, NO breach (rounds 0) -> continue (next round fits).
  const warmBothNoBreach = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.7, alreadyDownshifted: true, alreadySummarized: true });
  assertEq(warmBothNoBreach.action, 'continue', '(3) warm + both spent + no breach -> continue');
  assertIncludes(warmBothNoBreach.reason, 'both levers spent', '(3) continue reason names spent levers');
  // warm + BOTH spent + the next round WOULD breach -> stop (rule 3 drains it).
  const warmBothBreach = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.7, roundsCompleted: 1, alreadyDownshifted: true, alreadySummarized: true });
  assertEq(warmBothBreach.nextRoundBreaches, true, '(3) 0.7 over 1 round projects a breach');
  assertEq(warmBothBreach.action, 'stop-and-ask', '(3) warm + both spent + breach -> stop');

  // strict-flag coercion: a truthy-but-not-true flag is NOT a spent lever.
  const warmLooseFlag = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.7, alreadyDownshifted: 'yes' as unknown });
  assertEq(warmLooseFlag.action, 'downshift', "(3) 'yes' (not === true) is not a spent lever -> downshift");

  // ─── (4) BACKSTOP: accrued >= $50 stops even when uncapped ─────────────────
  const backstop = evaluateTurnSpend({ accruedTurnUsd: 60 }); // no soft/circle cap -> uncapped
  assertEq(backstop.action, 'stop-and-ask', '(4) accrued 60 uncapped -> stop');
  assertEq(backstop.capped, false, '(4) uncapped -> capped:false');
  assertEq(backstop.effectiveTurnCapUsd, ABSOLUTE_MAX_TURN_USD, '(4) uncapped cap = ABSOLUTE backstop');
  assertIncludes(backstop.reason, 'WARNING', '(4) backstop stop warns');
  assertIncludes(backstop.reason, 'backstop', '(4) backstop stop names the backstop');
  // exactly at the backstop threshold.
  assertEq(evaluateTurnSpend({ accruedTurnUsd: ABSOLUTE_MAX_TURN_USD }).action, 'stop-and-ask', '(4) accrued == backstop -> stop');
  // just UNDER the backstop but uncapped: cap is $50, so 49.99/50 ~ 0.9998 is the
  // HOT band -> the ladder gracefully summarizes before the hard stop at $50.
  assertEq(evaluateTurnSpend({ accruedTurnUsd: 49.99 }).action, 'summarize-and-continue', '(4) 49.99 uncapped (ratio ~1.0) -> summarize just below backstop');
  // genuinely calm on the uncapped $50 ceiling.
  assertEq(evaluateTurnSpend({ accruedTurnUsd: 10 }).action, 'continue', '(4) 10 uncapped (ratio .2) -> continue');
  // backstop also fires when a real cap exists.
  const backstopCapped = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 60 });
  assertEq(backstopCapped.action, 'stop-and-ask', '(4) accrued 60 with a cap -> stop');
  assertEq(backstopCapped.capped, true, '(4) a soft cap present -> capped:true');

  // ─── (5) CAP COMPOSITION (resolveEffectiveTurnCap directly) ───────────────
  // softCap 2 & circleRemaining 4 (derived 4*0.25 = 1.0): min picks derived 1.0.
  const comp = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 2, circleCapUsd: 4, circleSpentUsd: 0 });
  assertClose(comp.cap, 1.0, '(5) min(soft 2, derived 1.0) -> ~1.0 (default value mult 1.0)');
  assertEq(comp.capped, true, '(5) a composed cap is capped:true');
  // softCap smaller than derived -> softCap wins.
  const softWins = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 0.5, circleCapUsd: 4, circleSpentUsd: 0 });
  assertClose(softWins.cap, 0.5, '(5) min(soft 0.5, derived 1.0) -> ~0.5');
  // only a circle budget -> derived alone.
  const derivedOnly = resolveEffectiveTurnCap({ circleCapUsd: 8, circleSpentUsd: 4 });
  assertClose(derivedOnly.cap, 1.0, '(5) derived = remaining(4)*0.25 = 1.0');
  // only a soft cap -> soft alone.
  const softOnly = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 3 });
  assertClose(softOnly.cap, 3.0, '(5) soft cap 3 alone -> ~3.0');
  // circleSpent > circleCap -> remaining 0 -> baseCap 0 -> floored to MIN.
  const exhausted = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 2, circleCapUsd: 4, circleSpentUsd: 10 });
  assertEq(exhausted.cap, MIN_TURN_CAP_USD, '(5) circleSpent>cap -> remaining 0 -> cap floored to MIN');
  assertEq(exhausted.capped, true, '(5) exhausted-circle cap is still capped:true (not uncapped)');
  // negative circleSpent treated as 0 (no free extra budget, no crash).
  const negSpent = resolveEffectiveTurnCap({ circleCapUsd: 8, circleSpentUsd: -5 });
  assertClose(negSpent.cap, 2.0, '(5) negative spent -> treated as 0 -> derived 8*0.25 = 2.0');

  // ─── (6) VALUE MODULATION (value 0 tight, 1 loose, 0.5 identity) ──────────
  const v0 = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1, taskValue: 0 });
  assertClose(v0.cap, 0.6, '(6) value 0 -> baseCap x0.6');
  const v1 = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1, taskValue: 1 });
  assertClose(v1.cap, 1.4, '(6) value 1 -> baseCap x1.4');
  const vHalf = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1, taskValue: 0.5 });
  assertClose(vHalf.cap, 1.0, '(6) value 0.5 -> baseCap x1.0 (identity)');
  const vDefault = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1 });
  assertClose(vDefault.cap, 1.0, '(6) missing value defaults to 0.5 -> x1.0');
  // value is monotonic: higher value -> more runway.
  assert(v0.cap < vHalf.cap && vHalf.cap < v1.cap, '(6) cap is monotonic in task value');
  // out-of-range value clamps to [0,1].
  const vNeg = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1, taskValue: -10 });
  assertClose(vNeg.cap, 0.6, '(6) value -10 clamps to 0 -> x0.6');
  const vBig = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1, taskValue: 99 });
  assertClose(vBig.cap, 1.4, '(6) value 99 clamps to 1 -> x1.4');

  // ─── (7) MIN / MAX clamps on the composed cap ─────────────────────────────
  const huge = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1000, taskValue: 1 });
  assertEq(huge.cap, MAX_TURN_CAP_USD, '(7) 1000 x1.4 clamps to MAX_TURN_CAP_USD (25)');
  // regression: a near-MAX_VALUE soft cap with taskValue>0.5 overflows baseCap*mult
  // to +Infinity; the overflowed-too-large product must clamp to the MAX ceiling
  // (25), NOT collapse to MIN (0.02) via clampNumber's non-finite -> lo floor.
  const overflowCap = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 1.3e308, taskValue: 1 });
  assertEq(overflowCap.cap, MAX_TURN_CAP_USD, '(7) overflow soft cap 1.3e308 x1.4 -> +Infinity clamps to MAX (25), not MIN');
  const tiny = resolveEffectiveTurnCap({ perTurnSoftCapUsd: 0.0001, taskValue: 0 });
  assertEq(tiny.cap, MIN_TURN_CAP_USD, '(7) 0.0001 x0.6 clamps up to MIN_TURN_CAP_USD (0.02)');
  assert(huge.cap <= ABSOLUTE_MAX_TURN_USD, '(7) real cap never exceeds the absolute backstop');

  // ─── (8) UNCAPPED -> backstop is the only ceiling ─────────────────────────
  const uncapped = resolveEffectiveTurnCap({});
  assertEq(uncapped.cap, ABSOLUTE_MAX_TURN_USD, '(8) no soft/circle cap -> cap = ABSOLUTE (unmodulated)');
  assertEq(uncapped.capped, false, '(8) no budget -> capped:false');
  // a zero/negative circle cap is "no cap on that axis".
  assertEq(resolveEffectiveTurnCap({ circleCapUsd: 0 }).capped, false, '(8) circleCap 0 -> uncapped');
  assertEq(resolveEffectiveTurnCap({ circleCapUsd: -5 }).capped, false, '(8) negative circleCap -> uncapped');
  // uncapped is NOT value-modulated (backstop is the safety net, not a budget).
  assertEq(resolveEffectiveTurnCap({ taskValue: 1 }).cap, ABSOLUTE_MAX_TURN_USD, '(8) uncapped cap ignores task value');

  // ─── (9) PROJECTION (next-round affordability from observed $/round) ──────
  // ratio .3 over 1 round: projected $.30, 0.30 + 0.30 = 0.60 < cap -> no breach.
  const proj = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.3, roundsCompleted: 1 });
  assertEq(proj.projectedNextRoundUsd, 0.3, '(9) projected = accrued/rounds = 0.30');
  assertEq(proj.nextRoundBreaches, false, '(9) 0.30 + 0.30 under a ~$1 cap -> no breach');
  assertEq(proj.action, 'continue', '(9) low ratio + no breach -> continue');
  // a single pricey round breaches at a LOW overall ratio (< downshift band) ->
  // the projection fires the downshift before the ratio alone would.
  const breach = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.55, roundsCompleted: 1 });
  assertEq(breach.projectedNextRoundUsd, 0.55, '(9) projected = 0.55/1 = 0.55');
  assert(breach.spendRatio < SPEND_GOVERNOR_DOWNSHIFT_RATIO, '(9) ratio ~0.55 is below the warm band');
  assertEq(breach.nextRoundBreaches, true, '(9) 0.55 + 0.55 = 1.1 > ~$1 cap -> breach');
  assertEq(breach.action, 'downshift', '(9) breach at low ratio -> downshift (not just continue)');
  assertIncludes(breach.reason, 'breach', '(9) breach reason names the projected breach');
  // rounds 0 -> no projection, never breaches.
  const noRounds = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.5, roundsCompleted: 0 });
  assertEq(noRounds.projectedNextRoundUsd, null, '(9) rounds 0 -> projected null');
  assertEq(noRounds.nextRoundBreaches, false, '(9) rounds 0 -> never breaches');
  assertEq(noRounds.action, 'continue', '(9) rounds 0, ratio .5 -> continue');
  // a breach at a low ratio with the downshift lever already spent -> summarize.
  const breachD = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.55, roundsCompleted: 1, alreadyDownshifted: true });
  assertEq(breachD.action, 'summarize-and-continue', '(9) breach + already downshifted -> summarize');

  // ─── (10) DETERMINISM (identical input twice -> identical decision) ───────
  const detInputs: Array<Record<string, unknown>> = [
    { ...CAP1, accruedTurnUsd: 0.7 },
    { ...CAP1, accruedTurnUsd: 0.9, alreadySummarized: true },
    { accruedTurnUsd: 60 },
    { ...CAP1, accruedTurnUsd: 0.55, roundsCompleted: 1 },
    { circleCapUsd: 8, circleSpentUsd: 4, accruedTurnUsd: 0.5, roundsCompleted: 3, taskValue: 0.9 },
  ];
  for (const inp of detInputs) {
    const a = evaluateTurnSpend(inp);
    const b = evaluateTurnSpend(inp);
    assertEq(JSON.stringify(a), JSON.stringify(b), `(10) deterministic: ${JSON.stringify(inp).slice(0, 40)}`);
  }

  // ─── (11) coercion of used-values (NaN / Infinity / negative / string) ────
  assertEq(evaluateTurnSpend({ ...CAP1, accruedTurnUsd: -5 }).action, 'continue', '(11) negative accrued -> 0 -> continue');
  assertEq(evaluateTurnSpend({ ...CAP1, accruedTurnUsd: Number.NaN }).spendRatio, 0, '(11) NaN accrued -> 0 ratio');
  assertEq(evaluateTurnSpend({ ...CAP1, accruedTurnUsd: Infinity }).spendRatio, 0, '(11) Infinity accrued -> coerced to 0');
  assertEq(evaluateTurnSpend({ ...CAP1, accruedTurnUsd: '0.9' }).action, 'summarize-and-continue', '(11) numeric-string accrued parses (0.9 hot)');
  // huge accrued clamps to MAX_ACCRUED_USD but still stops (backstop first).
  const clampedHuge = evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 1e12 });
  assertEq(clampedHuge.action, 'stop-and-ask', '(11) 1e12 accrued -> stop');
  assert(clampedHuge.spendRatio <= MAX_RATIO, '(11) ratio bounded by MAX_RATIO');
  // fractional rounds floor; rounds that coerce to 0 give null projection.
  assertEq(evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.3, roundsCompleted: 2.9 }).projectedNextRoundUsd, 0.15, '(11) rounds 2.9 floor to 2 -> projected 0.15');
  assertEq(evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.3, roundsCompleted: -1 }).projectedNextRoundUsd, null, '(11) negative rounds -> 0 -> null projection');
  assertEq(evaluateTurnSpend({ ...CAP1, accruedTurnUsd: 0.3, roundsCompleted: Infinity }).projectedNextRoundUsd, null, '(11) Infinity rounds -> null projection');

  // ─── (12) HOSTILE — never throws, always well-formed ──────────────────────
  const cyclic: Record<string, unknown> = { accruedTurnUsd: 0.7, perTurnSoftCapUsd: 1 };
  cyclic.self = cyclic;

  const throwingState: Record<string, unknown> = {};
  for (const k of [
    'accruedTurnUsd', 'roundsCompleted', 'circleSpentUsd', 'circleCapUsd',
    'perTurnSoftCapUsd', 'alreadyDownshifted', 'alreadySummarized', 'taskValue',
  ]) {
    Object.defineProperty(throwingState, k, { get() { throw new Error(`boom:${k}`); }, enumerable: true });
  }

  const NUL = String.fromCharCode(0);
  const ctrlStr = 'a' + NUL + String.fromCharCode(7) + String.fromCharCode(0x2028) + 'b'; // non-numeric w/ controls
  const hugeStr = '9'.repeat(100000);

  // Each entry is [label, state]; the label is used in messages so a throwing /
  // symbol / bigint value is NEVER passed to String() in an assertion message.
  const hostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['negative-number', -5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['1e400(Infinity)', 1e400],
    ['numeric-string-state', '9'],
    ['empty-object', {}],
    ['array', []],
    ['boolean', true],
    ['bigint-state', 10n],
    ['symbol-state', Symbol('s')],
    ['cyclic', cyclic],
    ['throwing-getters', throwingState],
    ['huge-string-state', hugeStr],
    // hostile FIELD values inside a real object:
    ['fields:NaN/neg/Inf/oob-value', { accruedTurnUsd: NaN, roundsCompleted: -1, circleCapUsd: Infinity, taskValue: 5 }],
    ['fields:hugeStr/1e400/negCap', { accruedTurnUsd: hugeStr, roundsCompleted: 1e400, perTurnSoftCapUsd: -3 }],
    ['fields:controlChars', { accruedTurnUsd: ctrlStr, taskValue: NaN }],
    ['fields:bigint/string', { accruedTurnUsd: 10n, roundsCompleted: 2n, circleCapUsd: 'abc' }],
    ['fields:symbol/obj/arr', { accruedTurnUsd: Symbol('x'), circleSpentUsd: {}, circleCapUsd: [] }],
    ['fields:spent>cap', { accruedTurnUsd: 0.5, circleCapUsd: 1, circleSpentUsd: 100 }],
  ];

  const gathered: SpendGovernorDecision[] = [];
  for (const [label, state] of hostiles) {
    const d = noThrow(`(12) ${label}`, () => evaluateTurnSpend(state as never));
    // Extra invariants beyond wellFormed:
    assert(ACTIONS.has(d.action), `(12) ${label} -> action in 4-set`, JSON.stringify(d.action));
    assert(d.effectiveTurnCapUsd >= MIN_TURN_CAP_USD && d.effectiveTurnCapUsd <= ABSOLUTE_MAX_TURN_USD, `(12) ${label} -> cap in [MIN, ABSOLUTE]`, String(d.effectiveTurnCapUsd));
    assert(Number.isFinite(d.spendRatio) && d.spendRatio <= MAX_RATIO, `(12) ${label} -> ratio finite <= MAX_RATIO`, String(d.spendRatio));
    assert(d.reason.length > 0 && d.reason.length <= MAX_REASON_LEN, `(12) ${label} -> reason bounded & non-empty`, String(d.reason.length));
    assert(noControlChars(d.reason), `(12) ${label} -> reason has no control chars`, JSON.stringify(d.reason));
    gathered.push(d);
  }

  // The all-throwing-getters object degrades to the conservative fallback path.
  const hg = evaluateTurnSpend(throwingState as never);
  assertEq(hg.action, 'continue', '(12) all-throwing input -> conservative continue');

  // resolveEffectiveTurnCap is independently total on hostile input.
  const rc1 = noThrowCap('(12) resolveCap null', () => resolveEffectiveTurnCap(null as never));
  assertEq(rc1.cap, ABSOLUTE_MAX_TURN_USD, '(12) resolveCap(null) -> uncapped backstop');
  const rc2 = noThrowCap('(12) resolveCap throwing', () => resolveEffectiveTurnCap(throwingState as never));
  assert(rc2.cap >= MIN_TURN_CAP_USD && rc2.cap <= ABSOLUTE_MAX_TURN_USD, '(12) resolveCap(throwing) -> cap bounded', String(rc2.cap));

  // Every gathered hostile reason stays bounded, non-empty, and control-free.
  for (const d of gathered) {
    assert(d.reason.length > 0 && d.reason.length <= MAX_REASON_LEN && noControlChars(d.reason), '(12) sweep: reason bounded/clean', JSON.stringify(d.reason));
  }
}

/** Cap-resolver variant of noThrow. */
function noThrowCap(label: string, fn: () => { cap: number; capped: boolean }): { cap: number; capped: boolean } {
  try {
    const r = fn();
    assert(
      !!r && typeof r === 'object' && typeof r.cap === 'number' && Number.isFinite(r.cap) &&
        r.cap >= MIN_TURN_CAP_USD && r.cap <= ABSOLUTE_MAX_TURN_USD && typeof r.capped === 'boolean',
      `${label} -> well-formed cap result`,
      JSON.stringify(r),
    );
    return r;
  } catch (err) {
    assert(false, `${label} -> must not throw`, String(err));
    return { cap: ABSOLUTE_MAX_TURN_USD, capped: false };
  }
}

main();

if (failures > 0) {
  console.error(`\nturnSpendGovernorCore smoke: ${failures} FAILED, ${passes} passed`);
  process.exit(1);
}
console.log(`\nAll ${passes} assertions passed — turnSpendGovernorCore is sound.`);
