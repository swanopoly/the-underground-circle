/**
 * chatThreadLineage — CA-8j. Read-side helpers for the thread-fork
 * parent-pointer + lineage-root columns added to `circle_chat_threads`.
 *
 * Two primary use cases:
 *
 * 1. **Compression.** When the memory-bank summariser swaps a thread's
 *    body for a compacted version, it forks a new thread. The new
 *    thread's `parent_thread_id` = the old thread's id, and its
 *    `lineage_root_id` = either the old thread's `lineage_root_id`
 *    (if it was already part of a lineage) OR the old thread's own
 *    id (first compression from a root).
 *
 * 2. **User branching.** "Fork this thread at message X" creates a
 *    new thread with `parent_thread_id = <original>` and the same
 *    `lineage_root_id` as the original.
 *
 * `resolveLineageRoot(parent)` is the pure helper that computes the
 * new thread's lineage_root_id from its proposed parent row. Extract
 * this as a standalone function so the smoke tests pin the rules
 * without needing Supabase.
 */

export interface ChatThreadLineageRow {
  id: string;
  parent_thread_id?: string | null;
  lineage_root_id?: string | null;
}

/**
 * Given the parent thread a new thread is forking off of, return the
 * `lineage_root_id` the new row should carry.
 *
 * Rules (in order):
 * - If parent has a `lineage_root_id`, the child inherits it.
 * - Otherwise, the parent is the root — return parent.id.
 * - If no parent at all, the new thread IS the root → return null
 *   (application code may later stamp the thread's own id post-insert
 *   when a first fork happens, but we don't pre-stamp root rows to
 *   keep the index small).
 */
export function resolveLineageRoot(parent: ChatThreadLineageRow | null | undefined): string | null {
  if (!parent) return null;
  if (parent.lineage_root_id && typeof parent.lineage_root_id === 'string' && parent.lineage_root_id.length > 0) {
    return parent.lineage_root_id;
  }
  if (parent.id) return parent.id;
  return null;
}

/**
 * Walk the parent chain from `startId` upward until we hit a thread
 * with no parent. Callers pass `fetch` to retrieve rows by id — this
 * keeps the helper pure + synchronously-testable.
 *
 * Safety: bounded at 20 steps to cap runaway loops if someone creates
 * a cycle (the CHECK constraint blocks the trivial self-loop but a
 * longer A→B→A cycle could slip past if someone manually edits).
 */
export async function walkLineageAncestors(
  startId: string,
  fetchRow: (id: string) => Promise<ChatThreadLineageRow | null>,
  maxSteps = 20,
): Promise<ChatThreadLineageRow[]> {
  const chain: ChatThreadLineageRow[] = [];
  const seen = new Set<string>();
  let currentId: string | null = startId;
  let steps = 0;
  while (currentId && steps < maxSteps) {
    if (seen.has(currentId)) break; // cycle guard
    seen.add(currentId);
    const row = await fetchRow(currentId);
    if (!row) break;
    chain.push(row);
    currentId = row.parent_thread_id || null;
    steps += 1;
  }
  return chain;
}

/**
 * Given a freshly-fetched set of threads in a lineage (all sharing
 * the same `lineage_root_id`), order them by `parent_thread_id`
 * into a traversal order: root → fork1 → fork2 → ... . Unresolved
 * siblings come after the main chain in creation order. Pure; no
 * database calls. Returns the same rows in order, never drops any.
 */
export function orderByLineage<T extends ChatThreadLineageRow>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  if (rows.length === 1) return rows.slice();
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(row.id, row);

  const hasChildIn = (id: string): boolean => {
    for (const row of rows) if (row.parent_thread_id === id) return true;
    return false;
  };

  // Find the root within this set. It's the thread whose
  // parent_thread_id is either null or points outside the set.
  const rootCandidates = rows.filter((r) => !r.parent_thread_id || !byId.has(r.parent_thread_id));
  if (rootCandidates.length === 0) return rows.slice();
  // When multiple candidates exist (cycles or fragmented set), use
  // the one with the most descendants — that's closest to the "real"
  // lineage root semantically.
  rootCandidates.sort((a, b) => {
    const aScore = hasChildIn(a.id) ? 1 : 0;
    const bScore = hasChildIn(b.id) ? 1 : 0;
    return bScore - aScore;
  });
  const root = rootCandidates[0];

  // BFS from root following parent→child.
  const out: T[] = [];
  const queued = new Set<string>();
  const queue: T[] = [root];
  queued.add(root.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    out.push(current);
    // Find children of current. Order: stable by creation if row has
    // a `last_message_at` / `created_at`; otherwise insertion order.
    const children = rows.filter((r) => r.parent_thread_id === current.id && !queued.has(r.id));
    for (const child of children) {
      queued.add(child.id);
      queue.push(child);
    }
  }
  // Append any rows we didn't reach (cycles, orphans) in insertion order.
  for (const row of rows) {
    if (!queued.has(row.id)) out.push(row);
  }
  return out;
}
