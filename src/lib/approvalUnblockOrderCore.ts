// approvalUnblockOrderCore — the PURE "which gate do I clear first?" brain. In a
// shared multi-agent workspace several runs can each stall on their own
// require_approval gate at once. Both pending-approval read paths
// (runApprovalsService / hitlService) return them newest-first — the WRONG order
// for flow: a gate that just arrived and blocks one trivial step jumps ahead of a
// gate that has stalled a 6-step run for 15 minutes. openswanApprovalBatchCore
// reduces card COUNT by merging compatible gates; this core reduces TIME-TO-
// UNBLOCK by SEQUENCING the queue (including the un-batchable floor/high cards it
// leaves separate) so the human clears the highest-leverage gate first.
//
// It ranks each pending gate by five normalized factors — blocked work, accrued
// wait, deadline pressure, a fast-clear risk nudge, and a floor-defer nudge — and
// surfaces the single highest-leverage tap plus a per-item reason.
//
// This core is DISPLAY-ONLY ORDER. It never grants, waives, batches, or lowers
// any gate; an unreadable item is over-flagged (floor + unknown) not hidden.
//
// PURITY (load-bearing): zero runtime imports (batch-core risk labels referenced
// in prose only), tsx-loadable (smoke: approval-unblock-order-core). Fully
// DETERMINISTIC — no Date.now / Math.random / new Date; the caller passes already-
// computed deltas (`waitMs`, `msUntilDeadline`), mirroring the delta-input pattern
// of taskPriorityScoreCore / deadlineSlaCore. Every export is TOTAL — any input
// (null / undefined / wrong type / huge / cyclic / throwing getters) yields a
// safe, bounded plan and never throws. SECRET-SAFE — only a control-stripped id, a
// risk-taxonomy label, and numeric-derived counts/durations are echoed back; never
// tool args, titles, payloads, or values.

// ── Public contract ───────────────────────────────────────────────────────────

/**
 * Canonical risk buckets, folded from three real taxonomies onto one axis
 * (mirrors `openswanApprovalBatchCore.ApprovalBatchRiskLabel` EXACTLY so the two
 * cores compose). Anything unrecognized normalizes to 'unknown'.
 */
export type ApprovalOrderRiskLabel = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

/**
 * One pending approval's already-computed signal. Every field is `unknown` and
 * parsed defensively; the delta fields (`waitMs`, `msUntilDeadline`) are supplied
 * by the caller so this core never reads a clock.
 *   - `waitMs`         — ms since the gate was requested (idle-agent wait).
 *   - `blockedWork`    — count of remaining steps/todos this gate is stalling.
 *   - `risk`           — any risk-taxonomy token (see normalizeApprovalOrderRisk).
 *   - `floor`          — truthy ⇒ an always-confirm floor gate (pay/delete/…).
 *   - `msUntilDeadline`— ms until the run's deadline (≤0 ⇒ overdue; absent ⇒ none).
 *   - `tool`/`category`— used only for defense-in-depth floor detection.
 *   - `id`             — the row id echoed back (control-stripped, clamped).
 */
export interface PendingApprovalSignal {
  id?: unknown;
  waitMs?: unknown;
  blockedWork?: unknown;
  risk?: unknown;
  floor?: unknown;
  msUntilDeadline?: unknown;
  tool?: unknown;
  category?: unknown;
}

/** Every normalized factor (each in [0,1]) that fed a gate's score. */
export interface ApprovalOrderFactors {
  wait: number;
  blocked: number;
  deadline: number;
  risk: number;
  floor: number;
}

/** One ranked pending gate. `index` is its position in the ORIGINAL array so the
 *  caller maps an order decision back to its row. */
export interface RankedApproval {
  index: number;
  id: string;
  score: number;
  factors: ApprovalOrderFactors;
  reason: string;
}

/** The full plan: gates most-unblocking-first, the top original index, and a
 *  secret-safe one-line headline for the top gate. */
export interface ApprovalOrderPlan {
  ranked: RankedApproval[];
  topIndex: number;
  headline: string;
}

/** Per-factor weights (need not sum to 1 — the score is normalized by their sum). */
export interface ApprovalOrderWeights {
  blocked: number;
  wait: number;
  deadline: number;
  risk: number;
  floor: number;
}

// ── Tunables / bounds (all exported) ────────────────────────────────────────────

/** Pending queues are tiny; anything past this is dropped (caller handles). */
export const MAX_ITEMS = 500;
/** Echoed id is clamped to this many chars. */
export const MAX_ID_LEN = 200;
/** Each per-item reason / headline is clamped to this many chars. */
export const MAX_REASON_LEN = 140;
/** Scores are integers in [0, MAX_SCORE]. */
export const MAX_SCORE = 100;
/** A gate waited this long ⇒ full wait pressure (15 min). */
export const WAIT_SATURATION_MS = 15 * 60_000;
/** This many blocked steps already earns ~max blocked factor (log-ish curve). */
export const BLOCKED_SATURATION = 8;
/** A deadline this far out ⇒ ~0 pressure; it ramps to 1 as it nears / passes (1h). */
export const DEADLINE_HORIZON_MS = 3_600_000;

/**
 * Factor weights (sum 1.0). `blocked` + `wait` dominate — a gate is a stalled
 * PROCESS, so accrued idle-agent wait and the volume of work it blocks matter
 * most. `risk` and `floor` are small nudges: at equal blocked/wait a cheap
 * low-risk non-floor gate clears first, but blocked/wait/deadline always
 * dominate the small risk/floor terms.
 */
export const FACTOR_WEIGHTS: ApprovalOrderWeights = Object.freeze({
  blocked: 0.34,
  wait: 0.3,
  deadline: 0.18,
  risk: 0.12,
  floor: 0.06,
});

/**
 * The always-confirm floor: pay / delete / login / grant. Each such gate is a
 * deliberate decision, so it gets the LOWEST floor factor (deferred) — cheap
 * reversible flow clears first. Kept as a plain literal (no import); lockstep
 * with `openswanApprovalBatchCore.ALWAYS_SEPARATE_FLOOR_MARKERS`,
 * `unifiedApprovalPolicyCore.ALWAYS_ASK_FLOOR_MARKERS`, and
 * `computerGrantGate.STICKY_FLOOR_CATEGORIES`.
 */
export const ALWAYS_SEPARATE_FLOOR_MARKERS = ['pay', 'delete', 'login', 'grant'] as const;

// ── Internal constants ──────────────────────────────────────────────────────────

const MAX_NORM_LEN = 200; // bound on any normalized token
const MAX_BLOCKED_DISPLAY = 9999; // cap the count shown in a reason/headline

const FLOOR_MARKER_SET: ReadonlySet<string> = new Set<string>(ALWAYS_SEPARATE_FLOOR_MARKERS);

/** LOWER risk ⇒ higher fast-clear nudge (cheap, reversible work clears first). */
const RISK_FACTOR: Readonly<Record<ApprovalOrderRiskLabel, number>> = Object.freeze({
  low: 1,
  medium: 0.6,
  high: 0.3,
  critical: 0.15,
  unknown: 0.3,
});

/** Precomputed log1p(BLOCKED_SATURATION) so the blocked curve is const-time. */
const LOG1P_BLOCKED_SATURATION = Math.log1p(BLOCKED_SATURATION);

/** Fail-safe signal for an unreadable item: floor + unknown risk (over-flagged). */
const FAILSAFE_SIGNAL: PendingApprovalSignal = Object.freeze({ floor: true });

// Strip anything that could break a UI line or smuggle content out of an echoed
// id. Escape sequences only — never paste raw invisible bytes into source.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g; // C0 + DEL + C1
const LINE_SEP_RE = /[\u2028\u2029]/g; // LINE / PARAGRAPH separators
// Zero-width / bidi marks + BOM (removed outright, not spaced).
const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g; // zero-width / bidi marks + BOM (removed outright)
const FENCE_RE = /[`<>]/g; // prompt-fence chars

// ── Total helpers ───────────────────────────────────────────────────────────────

/** Finite number or 0. Non-numbers, NaN, ±Infinity → 0. */
function finiteOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Clamp x into [lo, hi]; non-finite → lo. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/** Bounded, trimmed, lower-cased token (mirrors openswanApprovalBatchCore.norm). */
function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, MAX_NORM_LEN) : '';
}

/**
 * Any positive signal reads as "floor" — over-separation is always the SAFE
 * direction (a match only ever DEFERS a gate, never removes one). Mirrors
 * `unifiedApprovalPolicyCore.isFloor` / `openswanApprovalBatchCore`.
 */
function truthyFloorFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'bigint') return value !== BigInt(0);
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Set) return value.size > 0;
  if (value instanceof Map) return value.size > 0;
  return false;
}

/**
 * Is this a floor (pay/delete/login/grant) gate? Detected generously (safe
 * over-ask direction): an explicit truthy `floor` flag, a `category` that IS a
 * floor marker, or a `category`/`tool` string that CONTAINS one (e.g.
 * 'payment', 'deletion', 'grant_access', 'desktop.delete_file').
 */
function isFloorSignal(s: PendingApprovalSignal | null | undefined): boolean {
  if (!s) return false;
  if (truthyFloorFlag(s.floor)) return true;
  const cat = norm(s.category);
  if (cat && FLOOR_MARKER_SET.has(cat)) return true;
  const tl = norm(s.tool);
  if (!cat && !tl) return false;
  for (const marker of ALWAYS_SEPARATE_FLOOR_MARKERS) {
    if (cat.includes(marker) || tl.includes(marker)) return true;
  }
  return false;
}

/**
 * Coerce an id to a bounded, control/line-sep/invisible/fence-stripped string.
 * Objects/arrays/null/undefined → ''. Pre-sliced so regex stays bounded on huge
 * input. This is the ONLY caller-supplied text this core ever echoes.
 */
function sanitizeId(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' && Number.isFinite(v)) s = String(v);
  else if (typeof v === 'boolean') s = String(v);
  else return '';
  if (s.length === 0) return '';
  if (s.length > MAX_ID_LEN * 4 + 64) s = s.slice(0, MAX_ID_LEN * 4 + 64);
  s = s
    .replace(INVISIBLE_RE, '')
    .replace(CONTROL_RE, ' ')
    .replace(LINE_SEP_RE, ' ')
    .replace(FENCE_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (s.length > MAX_ID_LEN) s = s.slice(0, MAX_ID_LEN);
  return s;
}

/** Deliberately coarse duration phrasing for a reason/headline ("~12m", "~2h"). */
function coarseDuration(ms: number): string {
  const m = Math.max(0, finiteOrZero(ms));
  const min = Math.round(m / 60_000);
  if (min < 1) return '<1m';
  if (min < 90) return `~${min}m`;
  const hr = Math.round(m / 3_600_000);
  if (hr < 48) return `~${hr}h`;
  const day = Math.round(m / 86_400_000);
  return `~${day}d`;
}

/** Clamp a reason/headline to MAX_REASON_LEN with a trailing ellipsis. */
function clampReason(s: string): string {
  if (s.length <= MAX_REASON_LEN) return s;
  return `${s.slice(0, MAX_REASON_LEN - 1)}…`;
}

/** Coarse, non-negative integer blocked count. */
function blockedCountOf(v: unknown): number {
  return Math.max(0, Math.floor(finiteOrZero(v)));
}

/** Display form of a blocked count (capped so a huge number stays tidy). */
function showCount(n: number): string {
  return n > MAX_BLOCKED_DISPLAY ? `${MAX_BLOCKED_DISPLAY}+` : String(n);
}

// ── Risk normalization ──────────────────────────────────────────────────────────

/**
 * Fold any input risk onto the canonical axis. Mirrors
 * `openswanApprovalBatchCore.normalizeApprovalBatchRisk` EXACTLY. Total:
 * unrecognized / missing / wrong-typed → 'unknown'.
 */
export function normalizeApprovalOrderRisk(value: unknown): ApprovalOrderRiskLabel {
  const s = norm(value);
  if (!s) return 'unknown';
  switch (s) {
    case 'low':
    case 'safe':
    case 'read':
    case 'none':
      return 'low';
    case 'medium':
    case 'med':
    case 'review':
    case 'reversible':
      return 'medium';
    case 'high':
    case 'external':
    case 'external_side_effect':
      return 'high';
    case 'critical':
    case 'crit':
    case 'destructive':
    case 'irreversible':
      return 'critical';
    default:
      return 'unknown';
  }
}

// ── Factor + score + reason internals ────────────────────────────────────────────

/** Compute the five normalized [0,1] factors for one signal. Never throws on
 *  plain-value input (getters are already resolved by the caller). */
function computeFactors(s: PendingApprovalSignal): ApprovalOrderFactors {
  const wait = clamp(finiteOrZero(s?.waitMs) / WAIT_SATURATION_MS, 0, 1);
  const blocked = clamp(Math.log1p(blockedCountOf(s?.blockedWork)) / LOG1P_BLOCKED_SATURATION, 0, 1);

  let deadline = 0; // absent ⇒ no pressure (deadline only ever ADDS pressure)
  const d = s?.msUntilDeadline;
  if (typeof d === 'number' && Number.isFinite(d)) {
    deadline = d <= 0 ? 1 : clamp(1 - d / DEADLINE_HORIZON_MS, 0, 1);
  }

  const risk = RISK_FACTOR[normalizeApprovalOrderRisk(s?.risk)];
  const floor = isFloorSignal(s) ? 0 : 1;
  return { wait, blocked, deadline, risk, floor };
}

/** Weighted, normalized, clamped integer score in [0, MAX_SCORE]. Normalizing by
 *  the weight sum keeps custom weights bounded; for the default 1.0-sum weights
 *  it is an identity. */
function weightedScore(f: ApprovalOrderFactors, w: ApprovalOrderWeights): number {
  const total = w.blocked + w.wait + w.deadline + w.risk + w.floor;
  if (!(total > 0)) return 0;
  const weighted =
    f.blocked * w.blocked +
    f.wait * w.wait +
    f.deadline * w.deadline +
    f.risk * w.risk +
    f.floor * w.floor;
  return Math.round(clamp(weighted / total, 0, 1) * MAX_SCORE);
}

/** Secret-safe reason from counts / coarse durations / risk label ONLY. */
function buildReason(s: PendingApprovalSignal): string {
  const parts: string[] = [];

  const blockedCount = blockedCountOf(s?.blockedWork);
  if (blockedCount >= 1) parts.push(`unblocks ~${showCount(blockedCount)} step${blockedCount === 1 ? '' : 's'}`);

  const waitMs = Math.max(0, finiteOrZero(s?.waitMs));
  if (waitMs >= 60_000) parts.push(`waited ${coarseDuration(waitMs)}`);

  const d = s?.msUntilDeadline;
  if (typeof d === 'number' && Number.isFinite(d)) {
    if (d <= 0) parts.push('overdue');
    else if (d < DEADLINE_HORIZON_MS) parts.push(`due ${coarseDuration(d)}`);
  }

  parts.push(`${normalizeApprovalOrderRisk(s?.risk)}-risk`);
  if (isFloorSignal(s)) parts.push('⚠ floor');

  return clampReason(parts.join(' · '));
}

// ── Public: score a single signal ────────────────────────────────────────────────

/**
 * Score one pending gate on the five factors and build its reason. Higher score
 * = clear sooner. Never throws — a null/garbage/throwing-getter signal degrades
 * to the fail-safe (floor + unknown risk). Deterministic. Uses the default
 * FACTOR_WEIGHTS (planApprovalOrder applies any caller weights).
 */
export function scoreApprovalSignal(s: PendingApprovalSignal): {
  score: number;
  factors: ApprovalOrderFactors;
  reason: string;
} {
  try {
    const signal = (s ?? {}) as PendingApprovalSignal;
    const factors = computeFactors(signal);
    return { score: weightedScore(factors, FACTOR_WEIGHTS), factors, reason: buildReason(signal) };
  } catch {
    const factors = computeFactors(FAILSAFE_SIGNAL);
    return {
      score: weightedScore(factors, FACTOR_WEIGHTS),
      factors,
      reason: buildReason(FAILSAFE_SIGNAL),
    };
  }
}

// ── Weight resolution ────────────────────────────────────────────────────────────

/** Resolve caller weights against the defaults; any malformed/negative/missing
 *  field falls back per-key, and an all-zero (or hostile) set → FACTOR_WEIGHTS. */
function resolveWeights(w: unknown): ApprovalOrderWeights {
  try {
    if (!w || typeof w !== 'object') return FACTOR_WEIGHTS;
    const rec = w as Record<string, unknown>;
    const pick = (k: keyof ApprovalOrderWeights): number => {
      const v = rec[k];
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : FACTOR_WEIGHTS[k];
    };
    const resolved: ApprovalOrderWeights = {
      blocked: pick('blocked'),
      wait: pick('wait'),
      deadline: pick('deadline'),
      risk: pick('risk'),
      floor: pick('floor'),
    };
    const total = resolved.blocked + resolved.wait + resolved.deadline + resolved.risk + resolved.floor;
    return total > 0 ? resolved : FACTOR_WEIGHTS;
  } catch {
    return FACTOR_WEIGHTS;
  }
}

// ── Internal ranked record (carries tie-break + headline inputs) ─────────────────

interface InternalScored {
  index: number;
  id: string;
  score: number;
  factors: ApprovalOrderFactors;
  reason: string;
  waitForTie: number;
  blockedCount: number;
  deadlineMs: number | null;
  riskLabel: ApprovalOrderRiskLabel;
}

/** Secret-safe headline for the top gate (counts / durations / risk label only). */
function buildHeadline(top: InternalScored): string {
  let h = 'Clear the top gate first';
  if (top.blockedCount >= 1) {
    h += ` — unblocks ~${showCount(top.blockedCount)} stalled step${top.blockedCount === 1 ? '' : 's'}`;
    if (top.waitForTie >= 60_000) h += ` (waited ${coarseDuration(top.waitForTie)})`;
  } else if (top.waitForTie >= 60_000) {
    h += ` — waited ${coarseDuration(top.waitForTie)}`;
  } else if (top.deadlineMs !== null && top.deadlineMs <= 0) {
    h += ' — deadline overdue';
  } else if (top.deadlineMs !== null && top.deadlineMs < DEADLINE_HORIZON_MS) {
    h += ` — due ${coarseDuration(top.deadlineMs)}`;
  } else {
    h += ` — ${top.riskLabel}-risk gate`;
  }
  return clampReason(h);
}

// ── Public: order the pending queue ──────────────────────────────────────────────

/**
 * Rank a set of pending approvals most-unblocking-first.
 *
 * Non-array input → `{ ranked: [], topIndex: -1, headline: '' }`. Scans at most
 * MAX_ITEMS (extras dropped; the caller handles any index not present). Each
 * item is parsed inside its own try/catch: a hostile throwing getter fails safe
 * (treated as floor + unknown risk, still ranked, never dropped, never thrown).
 *
 * Order: DESC by score; ties broken by larger `waitMs` first (fairness to the
 * oldest waiter), then original index ASC (stable, total order). `topIndex` is
 * the original index of the winner; `headline` is a secret-safe one-liner about
 * the top gate. Deterministic; never throws.
 */
export function planApprovalOrder(pending: unknown, opts?: { weights?: unknown }): ApprovalOrderPlan {
  const EMPTY: ApprovalOrderPlan = { ranked: [], topIndex: -1, headline: '' };
  try {
    if (!Array.isArray(pending)) return EMPTY;

    let weights: ApprovalOrderWeights = FACTOR_WEIGHTS;
    try {
      weights = resolveWeights(opts?.weights);
    } catch {
      weights = FACTOR_WEIGHTS;
    }

    const n = Math.min(pending.length, MAX_ITEMS);
    const scored: InternalScored[] = [];

    for (let i = 0; i < n; i += 1) {
      try {
        const item = pending[i];
        const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        // Reading each field resolves any getter ONCE, inside this try — a thrown
        // getter drops us to the fail-safe branch below (never a lost item).
        const signal: PendingApprovalSignal = {
          id: rec.id,
          waitMs: rec.waitMs,
          blockedWork: rec.blockedWork,
          risk: rec.risk,
          floor: rec.floor,
          msUntilDeadline: rec.msUntilDeadline,
          tool: rec.tool,
          category: rec.category,
        };
        const factors = computeFactors(signal);
        const deadlineMs =
          typeof signal.msUntilDeadline === 'number' && Number.isFinite(signal.msUntilDeadline)
            ? signal.msUntilDeadline
            : null;
        scored.push({
          index: i,
          id: sanitizeId(signal.id),
          score: weightedScore(factors, weights),
          factors,
          reason: buildReason(signal),
          waitForTie: Math.max(0, finiteOrZero(signal.waitMs)),
          blockedCount: blockedCountOf(signal.blockedWork),
          deadlineMs,
          riskLabel: normalizeApprovalOrderRisk(signal.risk),
        });
      } catch {
        const factors = computeFactors(FAILSAFE_SIGNAL);
        scored.push({
          index: i,
          id: '',
          score: weightedScore(factors, weights),
          factors,
          reason: buildReason(FAILSAFE_SIGNAL),
          waitForTie: 0,
          blockedCount: 0,
          deadlineMs: null,
          riskLabel: 'unknown',
        });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score; // higher score first
      if (b.waitForTie !== a.waitForTie) return b.waitForTie - a.waitForTie; // oldest waiter first
      return a.index - b.index; // stable, total order
    });

    const ranked: RankedApproval[] = scored.map((sc) => ({
      index: sc.index,
      id: sc.id,
      score: sc.score,
      factors: sc.factors,
      reason: sc.reason,
    }));
    const topIndex = ranked.length > 0 ? ranked[0].index : -1;
    const headline = scored.length > 0 ? buildHeadline(scored[0]) : '';
    return { ranked, topIndex, headline };
  } catch {
    return EMPTY;
  }
}
