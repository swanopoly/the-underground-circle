// toolPolicyCore — the PURE governance brain for per-tool approval. It decides,
// for a proposed tool call (toolId × scope × action tags), whether the call may
// run automatically, needs a fresh human approval, or is blocked outright — by
// combining a resolved per-tool policy (scope-specific mode, per-day rate cap,
// require-review flag) with a NON-WAIVABLE always-confirm floor.
//
// It executes nothing: a caller (chat/agent runtime, approval gate) asks
// checkToolPolicy() for a decision, shows the user an approval when asked, and
// records each granted use via recordToolUse() so the rate window advances.
//
// Posture (fail-closed): an UNKNOWN tool/scope with no matching policy defaults
// to 'ask' (never silent auto). A resolved 'blocked' policy always wins. A
// canonical exact-floor action can NEVER be 'auto' no matter what a policy says
// — the floor forces at least 'ask' and cannot be downgraded.
// requireReview and hitting the per-day rate cap also force 'ask'. Over-asking is
// safe; the only real failure would be silently auto-running a floor/blocked/
// unknown action, so the ordering below is deliberate.
//
// PURITY: only the dependency-free effect core is imported; tsx-loadable
// (smoke: tool-policy-core). Fully
// DETERMINISTIC — the caller passes `now`; no Date.now()/Math.random(). Never
// throws — every input is guarded and coerced to a safe default.

import {
  ALWAYS_EXACT_APPROVAL_EFFECTS,
  classifyApprovalEffect,
  requiresExactApproval,
} from './approvalEffectPolicyCore';

export type ToolApprovalMode = 'auto' | 'ask' | 'blocked';

export interface ToolPolicy {
  toolId: string;
  scope: string;
  mode: ToolApprovalMode;
  /** Optional per-day (per-window) cap on auto-grants before a fresh approval. */
  maxPerDay?: number;
  /** When true, always require a human review (forces at least 'ask'). */
  requireReview?: boolean;
}

/** key `${toolId}::${scope}` -> sorted ascending timestamps(ms) within window. */
export type ToolUsageWindow = Record<string, number[]>;

/**
 * Action categories that can NEVER auto-run. If any of a call's action tags is
 * one of these, the floor forces at least 'ask' even if a policy says 'auto'.
 * The floor is non-waivable: no policy can downgrade it.
 */
export const FLOOR_ACTION_CATEGORIES = ALWAYS_EXACT_APPROVAL_EFFECTS;

const DEFAULT_WINDOW_MS = 86_400_000; // 24h
const WILDCARD_SCOPES = new Set(['*', '']);

function isValidMode(mode: unknown): mode is ToolApprovalMode {
  return mode === 'auto' || mode === 'ask' || mode === 'blocked';
}

/** Coerce an unknown to a finite non-negative integer, or null if not usable. */
function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  return floored >= 0 ? floored : null;
}

function normWindowMs(windowMs: unknown): number {
  const n = toPositiveInt(windowMs);
  // A zero/invalid window would make every entry "expired"; fall back to default.
  return n && n > 0 ? n : DEFAULT_WINDOW_MS;
}

function usageKey(toolId: string, scope: string): string {
  return `${toolId}::${scope}`;
}

/**
 * True if the action tags classify to a non-waivable exact effect. Missing,
 * malformed, ambiguous, and unknown tags fail closed to the exact floor.
 */
export function isFloorAction(actionTags: string[] | undefined): boolean {
  return requiresExactApproval(actionTags);
}

/** The floor category that tripped, for a human-readable reason string. */
function firstFloorCategory(actionTags: string[] | undefined): string | null {
  const effect = classifyApprovalEffect(actionTags);
  return requiresExactApproval(effect) ? effect : null;
}

/**
 * Resolve the most-specific policy for a tool call. Exact scope match beats a
 * wildcard scope ('*' or ''); among equal specificity, the first in the array
 * wins. Returns null when nothing matches (caller should fail closed). Never
 * throws — malformed entries (non-object, wrong toolId, invalid mode) are
 * skipped.
 */
export function resolveToolPolicy(
  toolId: string,
  scope: string,
  policies: ToolPolicy[],
): ToolPolicy | null {
  if (typeof toolId !== 'string' || !toolId || !Array.isArray(policies)) return null;
  const scopeStr = typeof scope === 'string' ? scope : '';

  let exact: ToolPolicy | null = null;
  let wildcard: ToolPolicy | null = null;

  for (const p of policies) {
    if (!p || typeof p !== 'object') continue;
    if (p.toolId !== toolId) continue;
    if (!isValidMode(p.mode)) continue;
    const pScope = typeof p.scope === 'string' ? p.scope : '';

    if (pScope === scopeStr && !WILDCARD_SCOPES.has(scopeStr)) {
      // True exact (non-wildcard) match — highest specificity; first wins.
      if (!exact) exact = p;
    } else if (pScope === scopeStr) {
      // Requested scope is itself a wildcard and the policy matches it exactly.
      if (!exact) exact = p;
    } else if (WILDCARD_SCOPES.has(pScope)) {
      // Wildcard policy that can cover a specific requested scope.
      if (!wildcard) wildcard = p;
    }
  }

  return exact || wildcard || null;
}

/** Count timestamps within [now - windowMs, now]; ignores non-finite entries. */
function countInWindow(stamps: number[] | undefined, now: number, windowMs: number): number {
  if (!Array.isArray(stamps)) return 0;
  const cutoff = now - windowMs;
  let count = 0;
  for (const t of stamps) {
    if (typeof t === 'number' && Number.isFinite(t) && t > cutoff && t <= now) count += 1;
  }
  return count;
}

/**
 * Decide how a proposed tool call must be handled. Ordering is load-bearing:
 *   1. blocked policy → 'blocked'.
 *   2. floor action → never 'auto' (force >= 'ask', floorEnforced true).
 *   3. requireReview → force 'ask'.
 *   4. rate cap reached → 'ask' (rateRemaining 0).
 *   5. otherwise policy.mode (default 'ask' when no policy matched).
 * Never throws; unknown/malformed inputs fail closed to 'ask'.
 */
export function checkToolPolicy(args: {
  toolId: string;
  scope: string;
  actionTags?: string[];
  policies: ToolPolicy[];
  usage?: ToolUsageWindow;
  now: number;
  windowMs?: number;
}): { decision: ToolApprovalMode; reason: string; rateRemaining: number | null; floorEnforced: boolean } {
  const toolId = typeof args?.toolId === 'string' ? args.toolId : '';
  const scope = typeof args?.scope === 'string' ? args.scope : '';
  const actionTags = args?.actionTags;
  const policies = Array.isArray(args?.policies) ? args.policies : [];
  const now = typeof args?.now === 'number' && Number.isFinite(args.now) ? args.now : 0;
  const windowMs = normWindowMs(args?.windowMs);
  const usage = args?.usage && typeof args.usage === 'object' ? args.usage : undefined;

  const floor = isFloorAction(actionTags);
  const policy = resolveToolPolicy(toolId, scope, policies);

  // Compute rate context up front so rateRemaining is reported consistently.
  const cap = policy ? toPositiveInt(policy.maxPerDay) : null;
  const count = cap !== null ? countInWindow(usage?.[usageKey(toolId, scope)], now, windowMs) : 0;
  const capReached = cap !== null && count >= cap;
  const rateRemaining = cap !== null ? Math.max(0, cap - count) : null;

  // 1) Blocked policy always wins — even over the floor (blocked is stricter).
  if (policy && policy.mode === 'blocked') {
    return {
      decision: 'blocked',
      reason: floor
        ? `tool blocked by policy (also non-waivable floor: ${firstFloorCategory(actionTags)})`
        : 'tool blocked by policy',
      rateRemaining,
      floorEnforced: floor,
    };
  }

  // 2) Non-waivable floor — can never be 'auto'. Force at least 'ask'.
  if (floor) {
    return {
      decision: 'ask',
      reason: `non-waivable approval floor: ${firstFloorCategory(actionTags)}`,
      rateRemaining,
      floorEnforced: true,
    };
  }

  // 3) Explicit require-review flag forces a human in the loop.
  if (policy && policy.requireReview === true) {
    return { decision: 'ask', reason: 'policy requires review', rateRemaining, floorEnforced: false };
  }

  // 4) Per-day rate cap reached — needs a fresh approval before running again.
  if (capReached) {
    return { decision: 'ask', reason: 'rate limit', rateRemaining: 0, floorEnforced: false };
  }

  // 5) Fall through to the resolved mode; unknown tool fails closed to 'ask'.
  if (!policy) {
    return { decision: 'ask', reason: 'no matching policy — fail closed', rateRemaining, floorEnforced: false };
  }
  const mode: ToolApprovalMode = policy.mode; // 'auto' | 'ask' (blocked handled above)
  return {
    decision: mode,
    reason: mode === 'auto' ? 'policy allows auto' : 'policy requires approval',
    rateRemaining,
    floorEnforced: false,
  };
}

/**
 * Append a granted use to the window and prune anything older than the window.
 * PURE: returns a NEW usage object (input is never mutated). The updated key's
 * timestamps are sorted ascending. Malformed inputs degrade gracefully.
 */
export function recordToolUse(
  usage: ToolUsageWindow,
  toolId: string,
  scope: string,
  now: number,
  windowMs?: number,
): ToolUsageWindow {
  const win = normWindowMs(windowMs);
  const nowNum = typeof now === 'number' && Number.isFinite(now) ? now : 0;
  const tId = typeof toolId === 'string' ? toolId : '';
  const scopeStr = typeof scope === 'string' ? scope : '';
  const key = usageKey(tId, scopeStr);

  // Shallow-clone every key into a fresh object (no input mutation).
  const next: ToolUsageWindow = {};
  if (usage && typeof usage === 'object') {
    for (const k of Object.keys(usage)) {
      const arr = usage[k];
      next[k] = Array.isArray(arr) ? arr.slice() : [];
    }
  }

  const cutoff = nowNum - win;
  const existing = Array.isArray(next[key]) ? next[key] : [];
  const merged = existing.filter((t) => typeof t === 'number' && Number.isFinite(t) && t > cutoff && t <= nowNum);
  merged.push(nowNum);
  merged.sort((a, b) => a - b);
  next[key] = merged;

  return next;
}
