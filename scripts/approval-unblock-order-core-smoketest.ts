/**
 * approval-unblock-order-core-smoketest — the PURE "which gate do I clear first?"
 * ranker (src/lib/approvalUnblockOrderCore.ts). It orders a set of pending
 * require_approval gates most-unblocking-first so the human clears the highest-
 * leverage tap first (reduces TIME-TO-UNBLOCK; orthogonal to the batch core's
 * card-COUNT reduction).
 *
 * Load-bearing assertions:
 *   normalizeApprovalOrderRisk(v) — folds safe/read→low, review→medium,
 *     destructive/irreversible→critical, REVIEW→medium, junk→unknown (mirrors
 *     openswanApprovalBatchCore).
 *   scoreApprovalSignal(s) — a gate with blockedWork:6 & waitMs:12m scores high
 *     (72); an empty gate scores low (10); at equal blocked+wait a low-risk
 *     non-floor outranks a high-risk floor (cheap-clear nudge), but a floor gate
 *     blocking a big overdue run still outranks a trivial non-floor one
 *     (blocked/wait/deadline dominate the small risk/floor weights); reason is
 *     built only from counts/durations/risk label.
 *   planApprovalOrder(pending, opts?) — ranks a mixed 5-item set most-unblocking-
 *     first, topIndex = argmax, deterministic & stable (equal score → larger
 *     waitMs first, then index asc), secret-safe headline; custom weights re-rank
 *     and malformed weights fall back to FACTOR_WEIGHTS.
 *
 * And: every export is TOTAL — null/undefined/number/{}/[]/NaN/Infinity/-1/'6',
 * a throwing-getter item, a 5000-item array, a cyclic object, and a secret-shaped
 * 10k-char id ⇒ a valid bounded plan, never a throw, never a leaked secret.
 *
 * Pure — loads under tsx (the core has ZERO runtime imports).
 */

import {
  normalizeApprovalOrderRisk,
  scoreApprovalSignal,
  planApprovalOrder,
  MAX_ITEMS,
  MAX_ID_LEN,
  MAX_REASON_LEN,
  MAX_SCORE,
  WAIT_SATURATION_MS,
  BLOCKED_SATURATION,
  DEADLINE_HORIZON_MS,
  FACTOR_WEIGHTS,
  ALWAYS_SEPARATE_FLOOR_MARKERS,
  type ApprovalOrderRiskLabel,
  type ApprovalOrderPlan,
  type RankedApproval,
  type ApprovalOrderFactors,
} from '../src/lib/approvalUnblockOrderCore';

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

// ── unsafe-char detector (identical contract to sibling smokes) ───────────────
const LINE_SEP = String.fromCharCode(0x2028, 0x2029);
const ZW = String.fromCharCode(0x200b, 0x202e, 0xfeff);
function hasUnsafeChars(s: string): boolean {
  if (typeof s !== 'string') return true;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f`<>]/.test(s)) return true;
  for (const ch of LINE_SEP + ZW) if (s.indexOf(ch) >= 0) return true;
  return false;
}

// display chars used by the core (built via fromCharCode so this source stays ASCII)
const MIDDOT = String.fromCharCode(0x00b7); // ·
const WARN = String.fromCharCode(0x26a0); // ⚠
const EMDASH = String.fromCharCode(0x2014); // —
const SEP = ` ${MIDDOT} `;

const RISK_LABELS: ApprovalOrderRiskLabel[] = ['low', 'medium', 'high', 'critical', 'unknown'];

// ── structural validators ─────────────────────────────────────────────────────
function factorsValid(f: unknown): f is ApprovalOrderFactors {
  if (!f || typeof f !== 'object') return false;
  const ff = f as ApprovalOrderFactors;
  for (const k of ['wait', 'blocked', 'deadline', 'risk', 'floor'] as const) {
    const v = ff[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}
function rankedValid(r: unknown): r is RankedApproval {
  if (!r || typeof r !== 'object') return false;
  const rr = r as RankedApproval;
  if (!Number.isInteger(rr.index) || rr.index < 0 || rr.index >= MAX_ITEMS) return false;
  if (typeof rr.id !== 'string' || rr.id.length > MAX_ID_LEN || hasUnsafeChars(rr.id)) return false;
  if (!Number.isInteger(rr.score) || rr.score < 0 || rr.score > MAX_SCORE) return false;
  if (!factorsValid(rr.factors)) return false;
  if (typeof rr.reason !== 'string' || rr.reason.length === 0 || rr.reason.length > MAX_REASON_LEN) return false;
  if (hasUnsafeChars(rr.reason)) return false;
  return true;
}
function planValid(p: unknown): p is ApprovalOrderPlan {
  if (!p || typeof p !== 'object') return false;
  const pp = p as ApprovalOrderPlan;
  if (!Array.isArray(pp.ranked) || pp.ranked.length > MAX_ITEMS) return false;
  if (!Number.isInteger(pp.topIndex)) return false;
  if (typeof pp.headline !== 'string' || pp.headline.length > MAX_REASON_LEN || hasUnsafeChars(pp.headline)) return false;
  for (const r of pp.ranked) if (!rankedValid(r)) return false;
  // scores must be in non-increasing order (correct sort)
  for (let i = 1; i < pp.ranked.length; i += 1) if (pp.ranked[i].score > pp.ranked[i - 1].score) return false;
  if (pp.ranked.length === 0) return pp.topIndex === -1 && pp.headline === '';
  return pp.topIndex === pp.ranked[0].index;
}
function totalPlan(pending: unknown, opts?: unknown): boolean {
  try {
    return planValid(planApprovalOrder(pending as unknown, opts as { weights?: unknown } | undefined));
  } catch {
    return false;
  }
}
function totalScore(s: unknown): boolean {
  try {
    const r = scoreApprovalSignal(s as never);
    return (
      Number.isInteger(r.score) &&
      r.score >= 0 &&
      r.score <= MAX_SCORE &&
      factorsValid(r.factors) &&
      typeof r.reason === 'string' &&
      r.reason.length > 0 &&
      r.reason.length <= MAX_REASON_LEN &&
      !hasUnsafeChars(r.reason)
    );
  } catch {
    return false;
  }
}

function main(): void {
  // ─── (A) normalizeApprovalOrderRisk folding ─────────────────────────────────
  {
    assertEq(normalizeApprovalOrderRisk('low'), 'low', '(A) low');
    assertEq(normalizeApprovalOrderRisk('safe'), 'low', '(A) safe→low');
    assertEq(normalizeApprovalOrderRisk('read'), 'low', '(A) read→low');
    assertEq(normalizeApprovalOrderRisk('none'), 'low', '(A) none→low');
    assertEq(normalizeApprovalOrderRisk('medium'), 'medium', '(A) medium');
    assertEq(normalizeApprovalOrderRisk('med'), 'medium', '(A) med→medium');
    assertEq(normalizeApprovalOrderRisk('review'), 'medium', '(A) review→medium');
    assertEq(normalizeApprovalOrderRisk('REVIEW'), 'medium', '(A) REVIEW→medium (case-fold)');
    assertEq(normalizeApprovalOrderRisk('reversible'), 'medium', '(A) reversible→medium');
    assertEq(normalizeApprovalOrderRisk('high'), 'high', '(A) high');
    assertEq(normalizeApprovalOrderRisk('external'), 'high', '(A) external→high');
    assertEq(normalizeApprovalOrderRisk('external_side_effect'), 'high', '(A) external_side_effect→high');
    assertEq(normalizeApprovalOrderRisk('critical'), 'critical', '(A) critical');
    assertEq(normalizeApprovalOrderRisk('crit'), 'critical', '(A) crit→critical');
    assertEq(normalizeApprovalOrderRisk('destructive'), 'critical', '(A) destructive→critical');
    assertEq(normalizeApprovalOrderRisk('irreversible'), 'critical', '(A) irreversible→critical');
    assertEq(normalizeApprovalOrderRisk('  Destructive '), 'critical', '(A) trims + case-folds');
    assertEq(normalizeApprovalOrderRisk('weird'), 'unknown', '(A) unknown token→unknown');
    assertEq(normalizeApprovalOrderRisk(''), 'unknown', '(A) empty→unknown');
    assertEq(normalizeApprovalOrderRisk(null), 'unknown', '(A) null→unknown');
    assertEq(normalizeApprovalOrderRisk(42), 'unknown', '(A) number→unknown');
    assertEq(normalizeApprovalOrderRisk({}), 'unknown', '(A) object→unknown');
  }

  // ─── (B) scoreApprovalSignal: magnitude, factors, reason ────────────────────
  {
    const loaded = scoreApprovalSignal({ blockedWork: 6, waitMs: 12 * 60_000, risk: 'low', floor: false });
    assertEq(loaded.score, 72, '(B) loaded gate (blocked6/wait12m/low) scores 72');
    const empty = scoreApprovalSignal({});
    assertEq(empty.score, 10, '(B) empty gate scores 10 (low)');
    assert(loaded.score > empty.score, '(B) loaded outranks empty', `${loaded.score} vs ${empty.score}`);
    assert(factorsValid(loaded.factors), '(B) loaded factors valid');
    assert(factorsValid(empty.factors), '(B) empty factors valid');
    assertEq(loaded.factors.wait, 0.8, '(B) wait factor = 12m/15m = 0.8');
    assertEq(loaded.factors.risk, 1, '(B) low risk factor = 1');
    assertEq(loaded.factors.floor, 1, '(B) non-floor factor = 1');
    assertEq(loaded.factors.deadline, 0, '(B) absent deadline factor = 0');

    // reason is built ONLY from counts/durations/risk label (+floor marker)
    const floored = scoreApprovalSignal({ blockedWork: 6, waitMs: 12 * 60_000, risk: 'low', floor: true });
    const expectedReason = ['unblocks ~6 steps', 'waited ~12m', 'low-risk', `${WARN} floor`].join(SEP);
    assertEq(floored.reason, expectedReason, '(B) reason matches the canonical example');
    assert(!hasUnsafeChars(floored.reason), '(B) reason has no unsafe chars');
    assert(empty.reason.includes('unknown-risk'), '(B) empty reason names the risk label', empty.reason);
    assert(!empty.reason.includes('unblocks'), '(B) empty reason omits a zero blocked count');

    // deadline pressure enters the reason
    const overdue = scoreApprovalSignal({ blockedWork: 2, msUntilDeadline: -1, risk: 'medium' });
    assert(overdue.reason.includes('overdue'), '(B) overdue deadline → "overdue" in reason', overdue.reason);
    assertEq(overdue.factors.deadline, 1, '(B) overdue deadline factor = 1');
    const dueSoon = scoreApprovalSignal({ blockedWork: 1, msUntilDeadline: 6 * 60_000, risk: 'low' });
    assert(dueSoon.reason.includes('due ~'), '(B) near deadline → "due ~Xm" in reason', dueSoon.reason);
    assert(dueSoon.factors.deadline > 0 && dueSoon.factors.deadline < 1, '(B) near deadline factor in (0,1)');

    // singular vs plural step wording
    const one = scoreApprovalSignal({ blockedWork: 1 });
    assert(one.reason.includes('~1 step') && !one.reason.includes('~1 steps'), '(B) singular "step"', one.reason);
  }

  // ─── (C) risk/floor nudge vs. blocked/wait dominance ────────────────────────
  {
    // equal blocked+wait: cheap low-risk non-floor beats high-risk floor
    const cheap = scoreApprovalSignal({ blockedWork: 3, waitMs: 5 * 60_000, risk: 'low', floor: false });
    const dear = scoreApprovalSignal({ blockedWork: 3, waitMs: 5 * 60_000, risk: 'high', floor: true });
    assert(cheap.score > dear.score, '(C) cheap-clear nudge: low/non-floor > high/floor at equal work', `${cheap.score} vs ${dear.score}`);

    // but a floor gate blocking a big overdue run still beats a trivial non-floor gate
    const bigFloor = scoreApprovalSignal({ blockedWork: 10, waitMs: 20 * 60_000, risk: 'high', floor: true, msUntilDeadline: -1000 });
    const trivial = scoreApprovalSignal({ blockedWork: 0, waitMs: 0, risk: 'low', floor: false });
    assert(bigFloor.score > trivial.score, '(C) blocked/wait/deadline dominate: big floor gate > trivial non-floor', `${bigFloor.score} vs ${trivial.score}`);
    assert(bigFloor.factors.floor === 0, '(C) floor factor 0 on a floor gate');
    assert(trivial.factors.floor === 1, '(C) floor factor 1 on a non-floor gate');

    // floor detected via tool/category substring (defense-in-depth), not just the flag
    const viaTool = scoreApprovalSignal({ tool: 'desktop.delete_file', risk: 'low' });
    assertEq(viaTool.factors.floor, 0, '(C) floor detected via tool substring "delete"');
    const viaCat = scoreApprovalSignal({ category: 'payment', risk: 'low' });
    assertEq(viaCat.factors.floor, 0, '(C) floor detected via category substring "pay"');
  }

  // ─── (D) planApprovalOrder: rank a mixed 5-item set ─────────────────────────
  {
    const pending = [
      { id: 'a', blockedWork: 0, waitMs: 0, risk: 'low' }, // idx0 ~18
      { id: 'b', blockedWork: 6, waitMs: 12 * 60_000, risk: 'low' }, // idx1 ~72
      { id: 'c', blockedWork: 1, waitMs: 2 * 60_000, risk: 'medium' }, // idx2 ~28
      { id: 'd', blockedWork: 10, waitMs: 20 * 60_000, risk: 'high', floor: true, msUntilDeadline: -1000 }, // idx3 ~86
      { id: 'e', blockedWork: 2, waitMs: 8 * 60_000, risk: 'critical' }, // idx4 ~41
    ];
    const plan = planApprovalOrder(pending);
    assert(planValid(plan), '(D) plan is structurally valid');
    assertEq(plan.ranked.length, 5, '(D) all 5 items ranked');
    assertJson(plan.ranked.map((r) => r.index), [3, 1, 4, 2, 0], '(D) most-unblocking-first order');
    assertJson(plan.ranked.map((r) => r.id), ['d', 'b', 'e', 'c', 'a'], '(D) ids follow the order');
    assertEq(plan.topIndex, 3, '(D) topIndex = argmax (idx3)');
    assertEq(plan.ranked[0].score, 86, '(D) top score = 86');
    assert(plan.headline.startsWith('Clear the top gate first'), '(D) headline lead', plan.headline);
    assertEq(plan.headline, `Clear the top gate first ${EMDASH} unblocks ~10 stalled steps (waited ~20m)`, '(D) headline from top counts/durations');
    assert(!hasUnsafeChars(plan.headline), '(D) headline no unsafe chars');
    // headline + reasons leak no id/tool text
    const blob = plan.headline + plan.ranked.map((r) => r.reason).join('|');
    assert(!/[a-e]"/.test(blob) && !blob.includes('desktop') && !blob.includes('payment'), '(D) no id/tool text in reasons/headline');
  }

  // ─── (E) determinism ────────────────────────────────────────────────────────
  {
    const cases: unknown[] = [
      [{ id: 'x', blockedWork: 4, waitMs: 9 * 60_000, risk: 'medium' }, { id: 'y', blockedWork: 1, risk: 'low', floor: true }],
      [{ blockedWork: 6, waitMs: 12 * 60_000, risk: 'low' }],
      [],
      [{ risk: 'high', msUntilDeadline: 30 * 60_000 }, { risk: 'low' }, {}],
    ];
    for (const c of cases) {
      assertJson(planApprovalOrder(c), planApprovalOrder(c), `(E) planApprovalOrder deterministic: ${JSON.stringify(c).slice(0, 40)}`);
    }
    const s = { blockedWork: 5, waitMs: 7 * 60_000, risk: 'critical', floor: true };
    assertJson(scoreApprovalSignal(s), scoreApprovalSignal(s), '(E) scoreApprovalSignal deterministic');
  }

  // ─── (F) bounds / caps / exported constants ─────────────────────────────────
  {
    assertEq(MAX_ITEMS, 500, '(F) MAX_ITEMS');
    assertEq(MAX_ID_LEN, 200, '(F) MAX_ID_LEN');
    assertEq(MAX_REASON_LEN, 140, '(F) MAX_REASON_LEN');
    assertEq(MAX_SCORE, 100, '(F) MAX_SCORE');
    assertEq(WAIT_SATURATION_MS, 15 * 60_000, '(F) WAIT_SATURATION_MS');
    assertEq(BLOCKED_SATURATION, 8, '(F) BLOCKED_SATURATION');
    assertEq(DEADLINE_HORIZON_MS, 3_600_000, '(F) DEADLINE_HORIZON_MS');
    assertJson(FACTOR_WEIGHTS, { blocked: 0.34, wait: 0.3, deadline: 0.18, risk: 0.12, floor: 0.06 }, '(F) FACTOR_WEIGHTS shape');
    const weightSum = FACTOR_WEIGHTS.blocked + FACTOR_WEIGHTS.wait + FACTOR_WEIGHTS.deadline + FACTOR_WEIGHTS.risk + FACTOR_WEIGHTS.floor;
    assert(Math.abs(weightSum - 1) < 1e-9, '(F) weights sum to 1.0', String(weightSum));
    assert(Object.isFrozen(FACTOR_WEIGHTS), '(F) FACTOR_WEIGHTS is frozen');
    assertJson([...ALWAYS_SEPARATE_FLOOR_MARKERS], ['pay', 'delete', 'login', 'grant'], '(F) floor markers lockstep');

    // blocked factor saturates: >= BLOCKED_SATURATION ⇒ factor ~1 (capped)
    const sat = scoreApprovalSignal({ blockedWork: BLOCKED_SATURATION });
    assertEq(sat.factors.blocked, 1, '(F) blocked at saturation → factor 1');
    const over = scoreApprovalSignal({ blockedWork: 1e6 });
    assertEq(over.factors.blocked, 1, '(F) blocked far over saturation → clamp 1');
    // wait saturates likewise
    assertEq(scoreApprovalSignal({ waitMs: WAIT_SATURATION_MS * 4 }).factors.wait, 1, '(F) wait over saturation → clamp 1');

    // long id clamped, reason clamped
    const longId = 'z'.repeat(10_000);
    const p = planApprovalOrder([{ id: longId, blockedWork: 3 }]);
    assert(p.ranked[0].id.length <= MAX_ID_LEN, '(F) long id clamped ≤ MAX_ID_LEN', String(p.ranked[0].id.length));
    assert(p.ranked[0].reason.length <= MAX_REASON_LEN, '(F) reason clamped ≤ MAX_REASON_LEN');

    // 5000-item array bounded to MAX_ITEMS, no hang
    const many: unknown[] = [];
    for (let i = 0; i < 5000; i += 1) many.push({ id: `g${i}`, blockedWork: i % 9, waitMs: (i % 30) * 60_000, risk: RISK_LABELS[i % RISK_LABELS.length] });
    const big = planApprovalOrder(many);
    assertEq(big.ranked.length, MAX_ITEMS, '(F) 5000-item array bounded to MAX_ITEMS');
    assert(planValid(big), '(F) huge plan still valid');
    assert(big.ranked.every((r) => r.index < MAX_ITEMS), '(F) every ranked index within the scanned window');
  }

  // ─── (G) tie-break: score → larger waitMs → index asc ───────────────────────
  {
    // both waits saturate ⇒ identical scores, but larger raw waitMs ranks first
    const tie = planApprovalOrder([
      { id: 'p', waitMs: WAIT_SATURATION_MS * 2, blockedWork: 3, risk: 'low' }, // idx0
      { id: 'q', waitMs: WAIT_SATURATION_MS * 3, blockedWork: 3, risk: 'low' }, // idx1 (older waiter)
    ]);
    assertEq(tie.ranked[0].score, tie.ranked[1].score, '(G) tie: equal scores');
    assertEq(tie.ranked[0].index, 1, '(G) tie broken by larger waitMs first (idx1)');
    assertEq(tie.topIndex, 1, '(G) topIndex is the older waiter');

    // fully identical items ⇒ index ascending
    const same = planApprovalOrder([
      { id: 'x', waitMs: WAIT_SATURATION_MS * 2, blockedWork: 3, risk: 'low' },
      { id: 'y', waitMs: WAIT_SATURATION_MS * 2, blockedWork: 3, risk: 'low' },
    ]);
    assertJson(same.ranked.map((r) => r.index), [0, 1], '(G) identical items → stable index-ascending order');
  }

  // ─── (H) weights option: re-rank + malformed fallback ───────────────────────
  {
    const list = [
      { id: 'hi', blockedWork: 10, waitMs: 20 * 60_000, risk: 'critical' }, // idx0: dominant by default
      { id: 'lo', blockedWork: 0, waitMs: 0, risk: 'low' }, // idx1: only wins on a risk-only weighting
    ];
    assertEq(planApprovalOrder(list).topIndex, 0, '(H) default weights → blocked-heavy gate wins');
    const riskOnly = planApprovalOrder(list, { weights: { blocked: 0, wait: 0, deadline: 0, risk: 1, floor: 0 } });
    assertEq(riskOnly.topIndex, 1, '(H) risk-only weights → low-risk gate wins');

    // malformed weights fall back to FACTOR_WEIGHTS (same as default ordering)
    const defTop = planApprovalOrder(list).topIndex;
    assertEq(planApprovalOrder(list, { weights: 'nonsense' }).topIndex, defTop, '(H) string weights → fallback');
    assertEq(planApprovalOrder(list, { weights: null }).topIndex, defTop, '(H) null weights → fallback');
    assertEq(planApprovalOrder(list, { weights: { blocked: 'x', wait: null, risk: NaN } }).topIndex, defTop, '(H) per-key garbage → fallback');
    assertEq(planApprovalOrder(list, { weights: { blocked: -5, wait: -1, deadline: -1, risk: -1, floor: -1 } }).topIndex, defTop, '(H) all-negative → fallback');
    assertEq(planApprovalOrder(list, { weights: { blocked: 0, wait: 0, deadline: 0, risk: 0, floor: 0 } }).topIndex, defTop, '(H) all-zero → fallback (no divide-by-zero)');
  }

  // ─── (HOSTILE) totality: never throw, never leak ────────────────────────────
  try {
    // non-array pending → the documented empty plan
    for (const bad of [null, undefined, 42, 'x', {}, NaN, true, Symbol('s'), 9n, () => 1, Infinity]) {
      assert(totalPlan(bad), 'hostile pending is total', JSON.stringify(String(bad).slice(0, 16)));
      const p = planApprovalOrder(bad as unknown);
      assertJson(p, { ranked: [], topIndex: -1, headline: '' }, 'hostile pending → empty plan');
    }
    assertJson(planApprovalOrder([]), { ranked: [], topIndex: -1, headline: '' }, 'empty array → empty plan');

    // junk entries inside the array are each coerced, never dropped or thrown
    assert(totalPlan([null, undefined, 1, 'x', true, {}, [], NaN]), 'junk-entry array is total');
    assertEq(planApprovalOrder([null, undefined, 1, {}]).ranked.length, 4, 'junk entries still ranked (never dropped)');

    // coerced numeric fields never produce NaN in a score
    for (const v of [NaN, Infinity, -Infinity, -1, '6', {}, [], null, undefined, true]) {
      assert(totalScore({ waitMs: v, blockedWork: v, msUntilDeadline: v }), `hostile numeric fields total (${String(v).slice(0, 8)})`);
    }
    assertEq(scoreApprovalSignal({ waitMs: '6' }).factors.wait, 0, "hostile: string '6' waitMs → factor 0 (non-number)");
    assertEq(scoreApprovalSignal({ blockedWork: [] }).factors.blocked, 0, 'hostile: array blockedWork → factor 0');
    assertEq(scoreApprovalSignal({ waitMs: -1 }).factors.wait, 0, 'hostile: negative waitMs → factor 0');
    assertEq(scoreApprovalSignal({ msUntilDeadline: Infinity }).factors.deadline, 0, 'hostile: Infinity deadline → factor 0 (absent)');
    assertEq(scoreApprovalSignal({ msUntilDeadline: 0 }).factors.deadline, 1, 'hostile: 0 deadline → factor 1 (<=0)');

    // throwing-getter item → fail-safe (floor + unknown), still ranked, no throw
    const boom: Record<string, unknown> = {};
    for (const k of ['id', 'waitMs', 'blockedWork', 'risk', 'floor', 'msUntilDeadline', 'tool', 'category']) {
      Object.defineProperty(boom, k, { get() { throw new Error(`${k} boom`); }, enumerable: true });
    }
    assert(totalPlan([boom, { blockedWork: 5, waitMs: 10 * 60_000, risk: 'low' }]), 'throwing-getter item is total');
    const bp = planApprovalOrder([boom, { blockedWork: 5, waitMs: 10 * 60_000, risk: 'low' }]);
    assertEq(bp.ranked.length, 2, 'throwing item still appears in ranked (never dropped)');
    const failsafe = bp.ranked.find((r) => r.index === 0)!;
    assert(failsafe.reason.includes('unknown-risk') && failsafe.reason.includes('floor'), 'fail-safe reason = unknown-risk + floor', failsafe.reason);
    assertEq(failsafe.id, '', 'fail-safe id is empty (unreadable)');
    assertEq(failsafe.factors.floor, 0, 'fail-safe over-flagged as floor (factor 0)');
    assertEq(bp.topIndex, 1, 'the readable gate outranks the fail-safe one');
    // scoreApprovalSignal directly on a throwing signal is total too
    assert(totalScore(boom), 'scoreApprovalSignal on throwing signal is total');

    // cyclic item + cyclic array → no throw
    const cyc: Record<string, unknown> = { blockedWork: 3, waitMs: 6 * 60_000, risk: 'low' };
    cyc.self = cyc;
    assert(totalPlan([cyc]), 'cyclic item is total');
    const arr: unknown[] = [{ blockedWork: 2, risk: 'low' }];
    arr.push(arr);
    assert(totalPlan(arr), 'cyclic array is total');
    assertEq(planApprovalOrder(arr).ranked.length, 2, 'cyclic array → both entries ranked');

    // secret-shaped 10k id + control chars → sanitized, and NEVER echoed into reason/headline
    const SK = `sk-ant-${'a'.repeat(64)}`;
    const NASTY = String.fromCharCode(0x00, 0x1f, 0x7f, 0x202e, 0xfeff, 0x2028) + '<b>`x`';
    const nastyId = `${SK}  ${NASTY}`.repeat(500);
    const sp = planApprovalOrder([{ id: nastyId, blockedWork: 7, waitMs: 13 * 60_000, risk: 'low' }]);
    assert(planValid(sp), 'secret/control id → still a valid plan');
    assert(sp.ranked[0].id.length <= MAX_ID_LEN, 'secret id clamped ≤ MAX_ID_LEN', String(sp.ranked[0].id.length));
    assert(!hasUnsafeChars(sp.ranked[0].id), 'secret id has no control/invisible/fence chars after sanitize');
    assert(!sp.ranked[0].reason.includes('sk-ant'), 'secret never leaks into a reason', sp.ranked[0].reason);
    assert(!sp.headline.includes('sk-ant'), 'secret never leaks into the headline', sp.headline);
    assert(!JSON.stringify(sp.ranked[0].reason).includes('sk-ant') && !JSON.stringify(sp.headline).includes('sk-ant'), 'secret absent from reason+headline JSON');

    // secret hidden in tool/category (used for floor detection, never echoed)
    const tp = planApprovalOrder([{ tool: `delete ${SK}`, category: `pay ${SK}`, blockedWork: 2 }]);
    assert(!tp.ranked[0].reason.includes('sk-ant') && !tp.headline.includes('sk-ant'), 'secret in tool/category never echoed');
    assertEq(tp.ranked[0].factors.floor, 0, 'floor still detected from tool/category substring');

    // every export shape-valid across a fuzz of primitives
    for (const bad of [null, undefined, NaN, 0, '', false, {}, [], Symbol('z'), 5n]) {
      assert(RISK_LABELS.includes(normalizeApprovalOrderRisk(bad)), 'normalizeApprovalOrderRisk total', String(bad).slice(0, 8));
      assert(totalScore(bad), 'scoreApprovalSignal total', String(bad).slice(0, 8));
      assert(totalPlan(bad), 'planApprovalOrder total', String(bad).slice(0, 8));
      assert(totalPlan([bad, bad, bad]), 'planApprovalOrder over junk array total', String(bad).slice(0, 8));
    }

    // a battery of mixed real-ish inputs all obey the invariants + no unsafe chars
    const battery: unknown[][] = [
      [{ id: 'r1', blockedWork: 3, waitMs: 4 * 60_000, risk: 'high', floor: true }],
      [{ id: 'r2', risk: 'medium', msUntilDeadline: 45 * 60_000 }, { id: 'r3', risk: 'low', blockedWork: 1 }],
      [{ id: 'r4', category: 'login', waitMs: 90 * 60_000 }],
      [{ id: 'r5', blockedWork: 9999999, waitMs: 99 * 3_600_000, msUntilDeadline: -99_999 }],
    ];
    for (const b of battery) {
      assert(totalPlan(b), 'battery plan total', JSON.stringify(b).slice(0, 40));
      const p = planApprovalOrder(b);
      for (const r of p.ranked) assert(!hasUnsafeChars(r.reason) && !hasUnsafeChars(r.id), 'battery: no unsafe chars in echoes');
      assert(!hasUnsafeChars(p.headline), 'battery: headline clean');
    }

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (HOSTILE) sweep threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll approval-unblock-order-core smoke cases passed (${passes} passed).`);
}

main();
