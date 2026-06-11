/**
 * toolBatchParallelism — decide when the tools the model emitted in a single
 * round can be dispatched concurrently instead of one-at-a-time.
 *
 * Base rule (conservative on purpose): a round may run in parallel only when
 *   - there is no per-step approval gate (review mode stays sequential), AND
 *   - there is more than one tool, AND
 *   - EVERY tool is a pure read/observe (no state mutation, no external side
 *     effect, auto-approved).
 *
 * Dependency-metadata extension (T8/O6): tools may declare the state domains
 * they write (`mutationTargets`, e.g. 'filesystem', 'clipboard',
 * 'browser_page', 'circle_tasks') and read (`readsFrom`). A round with
 * mutations may still parallelize when, for every pair of tools, their write
 * sets are disjoint AND neither tool's read set intersects the other's write
 * set. Metadata is opt-in and absence stays conservative:
 *   - a mutating tool without `mutationTargets` is never parallel-safe;
 *   - a tool with no dependency metadata at all has an UNKNOWN read set, so it
 *     never parallelizes alongside a writer (but all-read rounds still work);
 *   - `externalSideEffect` tools and `approvalMode !== 'auto'` tools are never
 *     parallel regardless of declared targets — external effects have
 *     unknowable ordering semantics, and approvals must stay sequential.
 *
 * Why pairwise: tools are emitted in an intended order, and the agent often
 * relies on it (observe → act → observe-after). Reordering is only safe when
 * we can prove the tools touch disjoint state, or when the whole round is
 * order-independent reads.
 *
 * Pure + side-effect free → unit/smoke testable.
 */

export interface ToolParallelPolicy {
  mutatesState?: boolean;
  externalSideEffect?: boolean;
  approvalMode?: string;
  /** State domains this tool writes (e.g. 'filesystem', 'clipboard',
   *  'browser_page', 'circle_tasks', 'circle_missions'). A mutating tool
   *  without this is never parallel-safe. */
  mutationTargets?: string[];
  /** State domains this tool reads. A tool with no dependency metadata at all
   *  has unknown reads and never parallelizes next to a writer. */
  readsFrom?: string[];
}

/** True only for a pure read/observe tool (no mutation, no side effect, auto). */
export function isParallelSafeToolPolicy(policy: ToolParallelPolicy | null | undefined): boolean {
  if (!policy) return false;
  return policy.mutatesState === false
    && policy.externalSideEffect === false
    && policy.approvalMode === 'auto';
}

/** True if the tool declared any dependency metadata (opted into the model). */
function hasDependencyMetadata(policy: ToolParallelPolicy): boolean {
  return Array.isArray(policy.mutationTargets) || Array.isArray(policy.readsFrom);
}

/** Domains this tool writes; empty for non-mutating tools. */
function writeSetOf(policy: ToolParallelPolicy): string[] {
  if (policy.mutatesState !== true) return [];
  return Array.isArray(policy.mutationTargets) ? policy.mutationTargets : [];
}

/** Domains this tool reads, or null when unknown (no metadata declared). */
function readSetOf(policy: ToolParallelPolicy): string[] | null {
  if (Array.isArray(policy.readsFrom)) return policy.readsFrom;
  // A tool that declared its write footprint implicitly declares "reads
  // nothing else"; a tool with no metadata at all has unknown reads.
  return hasDependencyMetadata(policy) ? [] : null;
}

function setsIntersect(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const seen = new Set(a);
  return b.some((domain) => seen.has(domain));
}

/**
 * True if the tool may take part in a parallel round at all:
 * auto-approved, no external side effect, and either read-only or a mutation
 * with a declared, non-empty write set.
 */
export function isParallelEligibleToolPolicy(policy: ToolParallelPolicy | null | undefined): boolean {
  if (!policy) return false;
  if (policy.approvalMode !== 'auto') return false;
  if (policy.externalSideEffect !== false) return false;
  if (policy.mutatesState === false) return true;
  if (policy.mutatesState === true) {
    return Array.isArray(policy.mutationTargets) && policy.mutationTargets.length > 0;
  }
  // mutatesState undefined → unknown footprint → never parallel.
  return false;
}

/**
 * True when two eligible tools can safely run concurrently: disjoint write
 * sets, and neither tool's reads intersect the other's writes. A tool with an
 * unknown read set conflicts with any writer.
 */
export function toolPoliciesAreIndependent(
  a: ToolParallelPolicy,
  b: ToolParallelPolicy,
): boolean {
  const writesA = writeSetOf(a);
  const writesB = writeSetOf(b);
  if (setsIntersect(writesA, writesB)) return false;
  if (writesB.length > 0) {
    const readsA = readSetOf(a);
    if (readsA === null || setsIntersect(readsA, writesB)) return false;
  }
  if (writesA.length > 0) {
    const readsB = readSetOf(b);
    if (readsB === null || setsIntersect(readsB, writesA)) return false;
  }
  return true;
}

export function canParallelizeToolBatch(
  policies: Array<ToolParallelPolicy | null | undefined>,
  opts: { hasApprovalGate?: boolean } = {},
): boolean {
  if (opts.hasApprovalGate) return false;
  if (!Array.isArray(policies) || policies.length < 2) return false;
  if (!policies.every(isParallelEligibleToolPolicy)) return false;
  for (let i = 0; i < policies.length; i += 1) {
    for (let j = i + 1; j < policies.length; j += 1) {
      if (!toolPoliciesAreIndependent(policies[i] as ToolParallelPolicy, policies[j] as ToolParallelPolicy)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Greedy in-order grouping: walk the ordered round and extend the current
 * group while the next tool is eligible and independent of every tool already
 * in the group; otherwise close the group. Groups run sequentially in emitted
 * order; a group of length > 1 may be dispatched concurrently. With an
 * approval gate every tool is its own group; an ineligible tool always runs
 * alone and acts as a barrier.
 */
export function partitionParallelSafeBatch(
  policies: Array<ToolParallelPolicy | null | undefined>,
  opts: { hasApprovalGate?: boolean } = {},
): number[][] {
  const groups: number[][] = [];
  if (!Array.isArray(policies)) return groups;
  let current: number[] = [];
  for (let i = 0; i < policies.length; i += 1) {
    const policy = policies[i];
    const eligible = !opts.hasApprovalGate && isParallelEligibleToolPolicy(policy);
    const joins = eligible
      && current.length > 0
      && current.every((idx) => {
        const prev = policies[idx];
        return isParallelEligibleToolPolicy(prev)
          && toolPoliciesAreIndependent(prev as ToolParallelPolicy, policy as ToolParallelPolicy);
      });
    if (joins) {
      current.push(i);
      continue;
    }
    if (current.length > 0) groups.push(current);
    current = [i];
    if (!eligible) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
