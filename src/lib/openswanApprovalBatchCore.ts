/**
 * openswanApprovalBatchCore — UX batcher that folds multiple *pending*
 * approvals into ONE approval card when — and only when — it is safe, so the
 * user taps "yes" once for a bundle of compatible low/medium-risk actions
 * instead of clearing a queue one hoop at a time.
 *
 * This is the display-time companion to the *decision* modules:
 *   - `unifiedApprovalPolicyCore.resolveApprovalDecision` decides whether a
 *     single action needs approval at all (auto / require / blocked).
 *   - `chatApprovalGate.createHitlApprovalGate` /
 *     `openswanToolApprovals.resolveOpenSwanRuntimeApprovalDecision` file and
 *     de-dupe the actual `agent_approvals` rows.
 *   - THIS core takes the set that already resolved to `require_approval`
 *     (status `pending`) and groups the compatible ones so the UI can render
 *     fewer cards. It never *grants* anything and never lowers a gate.
 *
 * The hard rule comes from `approvalEffectPolicyCore`: persistent, external,
 * destructive, credential/payment/private-file/permission, ambiguous, and
 * unknown effects each stay on their OWN card. Only positively classified
 * observe/lifecycle/reversible-non-secret low/medium actions can batch.
 *
 * PURITY (load-bearing): the only runtime import is the dependency-free pure
 * effect core; no Date.now()/Math.random() at module scope. Every export is
 * TOTAL — any input (null / undefined / wrong type / huge / hostile / cyclic /
 * throwing getters) yields a safe, bounded plan and never throws. Fail-closed:
 * anything we cannot prove batch-safe becomes its own separate card, never a
 * silent merge. Deterministic: same input → same plan. Secret-safe: only a
 * risk-tier label and array indices are echoed back — never tool args or
 * values. Smoke: scripts/openswan-approval-batch-core-smoketest.ts.
 */

import {
  ALWAYS_EXACT_APPROVAL_EFFECTS,
  requiresExactApproval,
} from './approvalEffectPolicyCore';

/**
 * Canonical risk buckets this batcher reasons over. Folds three real
 * taxonomies onto one axis:
 *   - `computerTaskEvidenceContract.ComputerTaskApprovalRisk`
 *       'low' | 'medium' | 'high' | 'critical'
 *   - `chatAutomationPlanner.ChatAutomationRisk`
 *       'safe'→low | 'review'→medium | 'external_side_effect'→high | 'destructive'→critical
 *   - `agentReceipt.AgentReceiptRiskTier`
 *       'read'→low | 'reversible'→medium | 'external'→high | 'irreversible'→critical
 * Anything unrecognized normalizes to 'unknown' (never batchable — fail-closed).
 */
export type ApprovalBatchRiskLabel = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

/**
 * One rendered approval card. `indices` are positions in the ORIGINAL pending
 * array so the caller can map a batch decision back to its rows.
 *   - `requiresSeparate: false` → these items are safe to show (and approve)
 *     under one combined card, even when there is currently only one of them.
 *   - `requiresSeparate: true`  → this item MUST be its own card (a floor
 *     action, or a high/critical/unknown-risk action) and needs explicit
 *     per-item consent.
 * `combinedRisk` is the shared risk label of the card (a taxonomy tier, never
 * a secret).
 */
export interface ApprovalBatchGroup {
  indices: number[];
  combinedRisk: string;
  requiresSeparate: boolean;
}

export interface ApprovalBatchPlan {
  /** Cards to render, ordered by the first (minimum) original index each covers. */
  batches: ApprovalBatchGroup[];
  /** True iff at least one card actually bundles ≥2 items (i.e. saved a tap). */
  canBatch: boolean;
}

/**
 * Backward-compatible marker export. The canonical source is the shared effect
 * core, so batch/card/request policy cannot drift independently.
 */
export const ALWAYS_SEPARATE_FLOOR_MARKERS = ALWAYS_EXACT_APPROVAL_EFFECTS;

// Bounds so pathological inputs can never blow up time/space.
const MAX_ITEMS = 500; // pending queues are tiny; extras are omitted (→ handled individually)
const MAX_STR = 200;

/** Normalize an unknown to a bounded, trimmed, lower-cased token. */
function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, MAX_STR) : '';
}

/**
 * Any positive signal reads as "floor" — over-separation is always the SAFE
 * direction (a match only ever ADDS a card, never removes a gate). Mirrors
 * `unifiedApprovalPolicyCore.isFloor`'s truthiness handling.
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
 * Fold any input risk onto the canonical axis. Total: unrecognized / missing /
 * wrong-typed → 'unknown' (which is never batchable, so unknown fails closed).
 */
export function normalizeApprovalBatchRisk(value: unknown): ApprovalBatchRiskLabel {
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

/**
 * Is this an exact-floor action that must keep its own card?
 * Detected generously (safe over-ask direction):
 *   - an explicit truthy `floor` flag, OR
 *   - canonical classification of the category + tool signals.
 * High/critical risk is handled separately by the batchability test; this
 * classifier additionally closes low/medium exact and unknown-effect gaps.
 */
function isFloorItem(tool: unknown, category: unknown, floorFlag: unknown): boolean {
  if (truthyFloorFlag(floorFlag)) return true;
  return requiresExactApproval([category, tool]);
}

/** Minimum original index a batch covers (its display position). */
function firstIndex(group: ApprovalBatchGroup): number {
  return group.indices.length > 0 ? group.indices[0] : Number.MAX_SAFE_INTEGER;
}

/**
 * Plan how a set of *pending* approvals should be rendered as cards.
 *
 * Rules (fail-closed throughout):
 *   1. canonical exact-floor effect  → its own card, `requiresSeparate: true`.
 *   2. high / critical / unknown risk → its own card, `requiresSeparate: true`.
 *   3. non-floor low-risk items       → one shared card (`combinedRisk: 'low'`).
 *   4. non-floor medium-risk items    → one shared card (`combinedRisk: 'medium'`).
 * Different risk levels never co-mingle under a single yes; low and medium each
 * get at most one shared card. Cards are ordered by their first original index.
 * `canBatch` is true iff some card bundles ≥2 items.
 *
 * `pending` is typed `unknown` and every element is parsed defensively, so any
 * hostile shape yields a safe plan. Items past `MAX_ITEMS` are omitted from the
 * plan entirely (the caller must handle any index not present individually).
 */
export function planApprovalBatch(pending: unknown): ApprovalBatchPlan {
  const EMPTY: ApprovalBatchPlan = { batches: [], canBatch: false };
  try {
    if (!Array.isArray(pending)) return EMPTY;
    const n = Math.min(pending.length, MAX_ITEMS);

    const lowIndices: number[] = [];
    const mediumIndices: number[] = [];
    const separate: ApprovalBatchGroup[] = [];

    for (let i = 0; i < n; i++) {
      let risk: ApprovalBatchRiskLabel = 'unknown';
      let floor = true; // fail-closed default until we successfully read the item
      try {
        const item = pending[i];
        const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        risk = normalizeApprovalBatchRisk(rec.risk);
        floor = isFloorItem(rec.tool, rec.category, rec.floor);
      } catch {
        // Unreadable / hostile element (e.g. throwing getter) → own card.
        risk = 'unknown';
        floor = true;
      }

      const batchable = !floor && (risk === 'low' || risk === 'medium');
      if (batchable) {
        if (risk === 'low') lowIndices.push(i);
        else mediumIndices.push(i);
      } else {
        separate.push({ indices: [i], combinedRisk: risk, requiresSeparate: true });
      }
    }

    const batches: ApprovalBatchGroup[] = [];
    if (lowIndices.length > 0) {
      batches.push({ indices: lowIndices, combinedRisk: 'low', requiresSeparate: false });
    }
    if (mediumIndices.length > 0) {
      batches.push({ indices: mediumIndices, combinedRisk: 'medium', requiresSeparate: false });
    }
    for (const group of separate) batches.push(group);

    // Deterministic display order: by first covered index ascending. Every
    // index belongs to exactly one batch, so the minima are unique → total order.
    batches.sort((a, b) => firstIndex(a) - firstIndex(b));

    const canBatch = batches.some((b) => b.indices.length >= 2);
    return { batches, canBatch };
  } catch {
    return EMPTY;
  }
}
