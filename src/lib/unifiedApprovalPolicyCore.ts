/**
 * unifiedApprovalPolicyCore — the ONE Human-In-The-Loop approval policy that
 * every execution lane calls (CONSOLIDATE #2 of
 * docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md).
 *
 * Today three approval engines make the same "may I run this?" decision with
 * subtly different rules:
 *
 *   1. `chatApprovalGate.createHitlApprovalGate` — folds per-category
 *      auto-approve settings (`chatAutoApproveSettings.resolveAutoApproveDecision`
 *      → 'ask'|'auto'|'never') with the planner's coarse `approval.required`
 *      bit, and enforces the destructive floor (`resolveAutoApproveWaiver`).
 *   2. `openswanToolRuntime.maybeRequestToolApproval` — per-tool
 *      `OpenSwanToolPolicy.approvalMode` ('auto'|'ask') plus `mutatesState` /
 *      `externalSideEffect`.
 *   3. `chatComputerRequestRouter.constraintBlocksToolCall` — user "never do X"
 *      forbids (→ block) and the always-confirm floor pay/delete/login/grant
 *      (→ require confirmation, never auto), whose canonical value is
 *      `computerGrantGate.STICKY_FLOOR_CATEGORIES`.
 *
 * This file is the single source of truth those three fold into. `category`
 * mirrors `chatAutoApproveSettings.AutoApproveCategory`; the floor markers
 * mirror `chatComputerRequestRouter.ChatComputerConstraintCategory` /
 * `computerGrantGate.STICKY_FLOOR_CATEGORIES`. Both are typed `unknown` on the
 * input so this module stays dependency-free.
 *
 * PURITY (load-bearing): zero runtime imports (type names referenced in prose
 * only), no Date.now()/Math.random() at module scope. Every export is TOTAL —
 * any input (null / undefined / wrong type / huge / hostile / cyclic) yields a
 * safe, bounded, fail-closed decision and never throws. Secret-safe: only the
 * normalized category label (a taxonomy enum, never a value) is echoed back.
 * Deterministic: same input → same decision. Smoke:
 * scripts/unified-approval-policy-core-smoketest.ts.
 */

export type ApprovalDecisionKind = 'auto_approve' | 'require_approval' | 'blocked';

/**
 * Everything a lane knows about one candidate action, all `unknown` so the
 * core never imports the real types and every field survives hostile input.
 */
export interface ApprovalPolicyInput {
  /** Per-tool policy mode — `OpenSwanToolApprovalMode` 'auto' | 'ask'. */
  toolApprovalMode?: unknown;
  /** Whether the tool changes durable state (`OpenSwanToolPolicy.mutatesState`). */
  mutatesState?: unknown;
  /** Whether the tool reaches outside the app (`OpenSwanToolPolicy.externalSideEffect`). */
  externalSideEffect?: unknown;
  /** Auto-approve taxonomy bucket — `AutoApproveCategory` (e.g. 'memory_read'). */
  category?: unknown;
  /** The categories the user set to auto-approve — a string / string[] / Set<string>. */
  userAutoApprove?: unknown;
  /** The user forbade this action — `true`, the category, or a list/Set of forbidden categories. */
  userConstraintsBlock?: unknown;
  /** Always-confirm floor hit — pay / delete / login / grant. `true`, a marker, or a non-empty list. */
  isFloorAction?: unknown;
}

export interface ApprovalDecision {
  kind: ApprovalDecisionKind;
  /** Short, secret-safe explanation of why this decision was reached. */
  reason: string;
  /** Normalized category label, when one was supplied (for observability). */
  category?: string;
}

/**
 * The always-confirm floor: purchases, permanent deletions, credential entry,
 * and account/authorization grants. Never auto-approved in any autonomy mode.
 * Canonical value mirrors `computerGrantGate.STICKY_FLOOR_CATEGORIES` (and its
 * re-export `chatComputerRequestRouter.ALWAYS_CONFIRM_FLOOR`); kept here as a
 * plain literal so this core needs no import. If the canonical list changes,
 * update both in lockstep.
 */
export const ALWAYS_ASK_FLOOR_MARKERS = ['pay', 'delete', 'login', 'grant'] as const;

const FLOOR_MARKER_SET: ReadonlySet<string> = new Set<string>(ALWAYS_ASK_FLOOR_MARKERS);

// Bounds so pathological inputs can never blow up time/space.
const MAX_STR = 200;
const MAX_LIST = 200;

/** Normalize an unknown to a bounded, trimmed, lower-cased category token. */
function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, MAX_STR) : '';
}

/** Collect the normalized string members of an array/Set, bounded. */
function collectStrings(value: unknown): string[] {
  const out: string[] = [];
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length && out.length < MAX_LIST; i++) {
        const el = value[i];
        if (typeof el === 'string') out.push(el.trim().toLowerCase().slice(0, MAX_STR));
      }
    } else if (value instanceof Set) {
      let n = 0;
      for (const el of value) {
        if (n++ >= MAX_LIST) break;
        if (typeof el === 'string') out.push(el.trim().toLowerCase().slice(0, MAX_STR));
      }
    }
  } catch {
    /* hostile iterator / throwing member — ignore, return what we have */
  }
  return out;
}

/** Only the exact token 'auto' (case/space-tolerant) reads as auto; else 'ask' (fail-closed). */
function normalizeMode(value: unknown): 'auto' | 'ask' {
  return norm(value) === 'auto' ? 'auto' : 'ask';
}

/**
 * Is this action user-forbidden? Safe (over-block) direction:
 *   - `true`                            → forbidden (blanket)
 *   - a non-empty category string       → forbidden iff it equals the category
 *                                         (or, when no category is known, block)
 *   - a list/Set of forbidden categories→ forbidden iff it contains the category
 *                                         (or, when no category is known, block)
 * Mirrors `constraintBlocksToolCall`'s forbidden precedence.
 */
function isForbidden(value: unknown, categoryStr: string): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const s = norm(value);
    if (!s) return false;
    return categoryStr ? s === categoryStr : true;
  }
  if (Array.isArray(value) || value instanceof Set) {
    const list = collectStrings(value);
    if (list.length === 0) return false;
    return categoryStr ? list.includes(categoryStr) : true;
  }
  return false;
}

/**
 * Is this an always-confirm floor action? Safe (over-ask) direction — a match
 * only ever ADDS an approval, never a hard block, so we read any positive
 * signal as floor:
 *   - `true`, a non-empty string, a non-zero finite number/bigint, or a
 *     non-empty list/Set → floor
 *   - defense-in-depth: a category that is itself a floor marker → floor
 */
function isFloor(value: unknown, categoryStr: string): boolean {
  if (value === true) return true;
  else if (typeof value === 'string') { if (value.trim().length > 0) return true; }
  else if (typeof value === 'number') { if (Number.isFinite(value) && value !== 0) return true; }
  else if (typeof value === 'bigint') { if (value !== BigInt(0)) return true; }
  else if (Array.isArray(value)) { if (value.length > 0) return true; }
  else if (value instanceof Set) { if (value.size > 0) return true; }
  if (categoryStr && FLOOR_MARKER_SET.has(categoryStr)) return true;
  return false;
}

/**
 * Did the user opt THIS category into auto-approve? Strict (never over-approve)
 * direction: requires a known category AND an explicit membership match. A
 * blanket `true` is deliberately NOT honored (that path belongs to the tool
 * policy's own 'auto' mode).
 */
function isAutoApprovedCategory(value: unknown, categoryStr: string): boolean {
  if (!categoryStr) return false;
  if (typeof value === 'string') return norm(value) === categoryStr;
  if (Array.isArray(value) || value instanceof Set) return collectStrings(value).includes(categoryStr);
  return false;
}

/**
 * The single fold. Precedence, highest first:
 *   1. user-forbidden        → blocked
 *   2. always-confirm floor  → require_approval (ALWAYS; beats every auto path)
 *   3. tool 'auto' + provably non-mutating & non-external → auto_approve
 *   4. category the user auto-approved                    → auto_approve
 *   5. otherwise             → require_approval (fail-closed default)
 *
 * Deterministic and total: any error or unrecognized shape fails closed to
 * require_approval.
 */
export function resolveApprovalDecision(input: ApprovalPolicyInput): ApprovalDecision {
  try {
    const inp: Record<string, unknown> =
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const categoryStr = norm(inp.category);
    const withCat = (decision: ApprovalDecision): ApprovalDecision =>
      categoryStr ? { ...decision, category: categoryStr } : decision;

    // 1. A user-forbidden action can never run — blocked wins over everything.
    if (isForbidden(inp.userConstraintsBlock, categoryStr)) {
      return withCat({ kind: 'blocked', reason: 'blocked: the user forbade this action' });
    }

    // 2. Floor (pay/delete/login/grant) always requires approval — no autonomy
    //    setting, tool 'auto' mode, or auto-approved category can waive it.
    if (isFloor(inp.isFloorAction, categoryStr)) {
      return withCat({
        kind: 'require_approval',
        reason: 'always-confirm floor (pay/delete/login/grant) requires approval',
      });
    }

    // 3. Tool policy 'auto' AND provably non-mutating & non-external → auto.
    //    Any truthy mutatesState/externalSideEffect (fail-closed) drops through.
    if (
      normalizeMode(inp.toolApprovalMode) === 'auto' &&
      !inp.mutatesState &&
      !inp.externalSideEffect
    ) {
      return withCat({
        kind: 'auto_approve',
        reason: 'tool policy auto-approve (non-mutating, no external side effect)',
      });
    }

    // 4. The user opted this category into auto-approve → auto.
    if (isAutoApprovedCategory(inp.userAutoApprove, categoryStr)) {
      return withCat({ kind: 'auto_approve', reason: 'user auto-approved this category' });
    }

    // 5. Default: require approval (fail-closed).
    return withCat({ kind: 'require_approval', reason: 'default: approval required (fail-closed)' });
  } catch {
    return { kind: 'require_approval', reason: 'fail-closed: internal error' };
  }
}
