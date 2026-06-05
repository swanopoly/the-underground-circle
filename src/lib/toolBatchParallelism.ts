/**
 * toolBatchParallelism — decide when the tools the model emitted in a single
 * round can be dispatched concurrently instead of one-at-a-time.
 *
 * Safe rule (conservative on purpose): a round may run in parallel only when
 *   - there is no per-step approval gate (review mode stays sequential), AND
 *   - there is more than one tool, AND
 *   - EVERY tool is a pure read/observe (no state mutation, no external side
 *     effect, auto-approved).
 *
 * Why "every": tools are emitted in an intended order, and the agent often
 * relies on it (observe → act → observe-after). Reordering a read relative to a
 * mutation would break that sequencing, so a single mutating/side-effecting/
 * approval tool forces the whole round sequential. An all-read round (e.g. a few
 * fetch_url / search / read_a11y_tree calls to gather context) is order-
 * independent, so running it concurrently is both safe and a real latency win.
 *
 * Pure + side-effect free → unit/smoke testable.
 */

export interface ToolParallelPolicy {
  mutatesState?: boolean;
  externalSideEffect?: boolean;
  approvalMode?: string;
}

/** True only for a pure read/observe tool (no mutation, no side effect, auto). */
export function isParallelSafeToolPolicy(policy: ToolParallelPolicy | null | undefined): boolean {
  if (!policy) return false;
  return policy.mutatesState === false
    && policy.externalSideEffect === false
    && policy.approvalMode === 'auto';
}

export function canParallelizeToolBatch(
  policies: Array<ToolParallelPolicy | null | undefined>,
  opts: { hasApprovalGate?: boolean } = {},
): boolean {
  if (opts.hasApprovalGate) return false;
  if (!Array.isArray(policies) || policies.length < 2) return false;
  return policies.every(isParallelSafeToolPolicy);
}
