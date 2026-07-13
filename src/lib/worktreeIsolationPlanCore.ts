// worktreeIsolationPlanCore — the PURE up-front ASSIGNMENT PLANNER for running
// several agent tasks against one local repo at the same time. It is the
// complement to agentFileLeaseCore (leases + content-hash CAS): those catch a
// collision AS it happens; this decides BEFORE anyone starts who can safely run
// in parallel, who must be serialized, and who should be pushed into an isolated
// git worktree — so the leases mostly never have to fire.
//
// Given N tasks, each declaring the files it will touch, we:
//   * detect every pairwise file overlap (detectFileOverlaps),
//   * build an overlap graph (nodes = tasks, edges = a shared file) and split it
//     into connected COMPONENTS,
//   * assign each task to exactly one bucket:
//       - parallelSharedSafe : no overlap with anyone AND not forceWorktree →
//         run concurrently on the shared working tree,
//       - serializedGroups   : a component of ≥2 overlapping tasks → run those
//         one-at-a-time (default), OR
//       - worktree           : forceWorktree tasks, plus (when
//         opts.isolateOverlapping) the overlapping components isolated instead
//         of serialized.
//
// FRONTIER CAVEAT (encoded in summarizeWorktreePlan): a git worktree isolates
// the *working tree* — it solves FILE collisions only. Two tasks that mutate the
// SAME shared file (same logical edit target) still race on that file's final
// state even in separate worktrees; they must be serialized or their overlap
// resolved. Worktree isolation is not a substitute for serialization when the
// tasks genuinely share an edit target.
//
// PURITY: zero imports, tsx-loadable (smoke:
// worktree-isolation-plan-core-smoketest). Deterministic — stable ordering by
// task id throughout, no Date.now()/Math.random(). Never throws.

export interface AgentTask {
  id: string;
  label?: string;
  touchedFiles: string[];
  /** Force this task into an isolated git worktree regardless of overlap. */
  forceWorktree?: boolean;
}

/** A detected overlap between two tasks: `files` is the (non-empty) intersection
 *  of their touched files. `a`/`b` are task ids, ordered a<=b. */
export interface FileOverlap {
  a: string;
  b: string;
  files: string[];
}

export interface WorktreePlanResult {
  /** Disjoint file sets → safe to run concurrently on the shared tree. */
  parallelSharedSafe: AgentTask[];
  /** Each inner group shares files (transitively) → run one-at-a-time. */
  serializedGroups: AgentTask[][];
  /** forceWorktree or (with isolateOverlapping) heavy-overlap → isolate. */
  worktree: AgentTask[];
  /** Every pairwise overlap detected (diagnostic). */
  conflicts: FileOverlap[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Normalize a touched-file path for identity comparison: coerce to string,
 *  trim, unify separators, collapse duplicate slashes, drop a trailing slash.
 *  Case-preserving (POSIX paths are case-sensitive). Empty/garbage → ''. */
function normalizeFilePath(raw: unknown): string {
  let p = typeof raw === 'string' ? raw.trim() : '';
  if (!p) return '';
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** Deduped, normalized, sorted set of a task's touched files (drops blanks). */
function fileSet(task: AgentTask): string[] {
  const files = Array.isArray(task?.touchedFiles) ? task.touchedFiles : [];
  const seen = new Set<string>();
  for (const f of files) {
    const n = normalizeFilePath(f);
    if (n) seen.add(n);
  }
  return Array.from(seen).sort((x, y) => x.localeCompare(y));
}

/** Coerce arbitrary input into a clean, deterministically-ordered task list.
 *  Drops entries without a usable string id; keeps first occurrence of a dup id;
 *  sorts by id so all downstream output is stable regardless of input order. */
function normalizeTasks(tasksRaw: unknown): AgentTask[] {
  if (!Array.isArray(tasksRaw)) return [];
  const seen = new Set<string>();
  const out: AgentTask[] = [];
  for (const t of tasksRaw) {
    if (!t || typeof t !== 'object') continue;
    const id = typeof (t as any).id === 'string' ? (t as any).id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const raw = t as AgentTask;
    out.push({
      id,
      label: typeof raw.label === 'string' ? raw.label : undefined,
      touchedFiles: fileSet(raw),
      forceWorktree: raw.forceWorktree === true,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Sorted intersection of two already-sorted, deduped file lists. */
function intersectSorted(a: string[], b: string[]): string[] {
  const bset = new Set(b);
  const out: string[] = [];
  for (const f of a) if (bset.has(f)) out.push(f);
  return out; // `a` is already sorted → result is sorted
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * All pairwise file overlaps among the tasks. Only pairs whose touched-file sets
 * intersect are reported. Deterministic order: by a.id, then b.id. Never throws.
 */
export function detectFileOverlaps(tasks: AgentTask[]): FileOverlap[] {
  const list = normalizeTasks(tasks);
  const overlaps: FileOverlap[] = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const shared = intersectSorted(list[i].touchedFiles, list[j].touchedFiles);
      if (shared.length) {
        overlaps.push({ a: list[i].id, b: list[j].id, files: shared });
      }
    }
  }
  // list is id-sorted, so i<j already yields (a.id, then b.id) order.
  return overlaps;
}

/**
 * Plan how to run the tasks against one shared repo.
 *
 * Overlap graph: nodes are tasks, an edge connects two tasks that share ≥1 file.
 *   - A task with NO edges and not forceWorktree → parallelSharedSafe.
 *   - forceWorktree tasks → worktree (always, even if otherwise disjoint).
 *   - A connected component of ≥2 tasks (transitively: A–B, B–C ⇒ {A,B,C}) →
 *       * default: one serializedGroup (ordered by id), or
 *       * opts.isolateOverlapping: those tasks go to `worktree` instead.
 *
 * Every task lands in EXACTLY ONE of parallelSharedSafe / serializedGroups /
 * worktree. Pure, deterministic (all output id-sorted), never throws.
 */
export function planWorktreeIsolation(
  tasks: AgentTask[],
  opts?: { isolateOverlapping?: boolean },
): WorktreePlanResult {
  const list = normalizeTasks(tasks);
  const isolateOverlapping = opts?.isolateOverlapping === true;
  const conflicts = detectFileOverlaps(list);

  const empty: WorktreePlanResult = {
    parallelSharedSafe: [],
    serializedGroups: [],
    worktree: [],
    conflicts,
  };
  if (!list.length) return empty;

  const byId = new Map<string, AgentTask>();
  for (const t of list) byId.set(t.id, t);

  // Adjacency from the overlap edges (undirected).
  const adj = new Map<string, Set<string>>();
  for (const t of list) adj.set(t.id, new Set());
  for (const o of conflicts) {
    adj.get(o.a)!.add(o.b);
    adj.get(o.b)!.add(o.a);
  }

  // Connected components via BFS. Iterate ids in sorted order (list is sorted)
  // so component discovery — and thus output ordering — is deterministic.
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const t of list) {
    if (visited.has(t.id)) continue;
    const queue = [t.id];
    visited.add(t.id);
    const comp: string[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      comp.push(cur);
      // sort neighbors for stable traversal
      const neighbors = Array.from(adj.get(cur) ?? []).sort((x, y) => x.localeCompare(y));
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    comp.sort((x, y) => x.localeCompare(y));
    components.push(comp);
  }

  const parallelSharedSafe: AgentTask[] = [];
  const serializedGroups: AgentTask[][] = [];
  const worktree: AgentTask[] = [];

  for (const comp of components) {
    const compTasks = comp.map((id) => byId.get(id)!).sort((a, b) => a.id.localeCompare(b.id));
    if (comp.length >= 2) {
      // Overlapping component: isolate all of them, or serialize as one group.
      // forceWorktree members of the component are already inside it; isolating
      // the whole component keeps a transitive group together.
      if (isolateOverlapping) {
        for (const t of compTasks) worktree.push(t);
      } else {
        serializedGroups.push(compTasks);
      }
    } else {
      // Singleton (no file overlap with anyone): forceWorktree → isolate,
      // otherwise safe to run in parallel on the shared tree.
      const t = compTasks[0];
      if (t.forceWorktree) worktree.push(t);
      else parallelSharedSafe.push(t);
    }
  }

  parallelSharedSafe.sort((a, b) => a.id.localeCompare(b.id));
  worktree.sort((a, b) => a.id.localeCompare(b.id));
  serializedGroups.sort((g1, g2) => (g1[0]?.id ?? '').localeCompare(g2[0]?.id ?? ''));

  return { parallelSharedSafe, serializedGroups, worktree, conflicts };
}

/**
 * One human-readable summary of the plan, including the frontier caveat that
 * worktree isolation only resolves FILE collisions (same-file edit targets still
 * need serialization). Never throws.
 */
export function summarizeWorktreePlan(result: WorktreePlanResult): string {
  const r: WorktreePlanResult = result ?? {
    parallelSharedSafe: [],
    serializedGroups: [],
    worktree: [],
    conflicts: [],
  };
  const parallel = Array.isArray(r.parallelSharedSafe) ? r.parallelSharedSafe : [];
  const groups = Array.isArray(r.serializedGroups) ? r.serializedGroups : [];
  const worktree = Array.isArray(r.worktree) ? r.worktree : [];
  const conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];

  const lines: string[] = [];
  const serializedCount = groups.reduce((n, g) => n + (Array.isArray(g) ? g.length : 0), 0);
  lines.push(
    `Worktree isolation plan: ${parallel.length} parallel-safe, ` +
      `${serializedCount} serialized across ${groups.length} group(s), ` +
      `${worktree.length} isolated in worktrees, ${conflicts.length} file overlap(s).`,
  );

  if (parallel.length) {
    lines.push(`Parallel (shared tree): ${parallel.map((t) => t.id).join(', ')}`);
  }
  groups.forEach((g, i) => {
    const ids = (Array.isArray(g) ? g : []).map((t) => t.id).join(' → ');
    lines.push(`Serialized group ${i + 1} (one at a time): ${ids}`);
  });
  if (worktree.length) {
    lines.push(`Isolated worktrees: ${worktree.map((t) => t.id).join(', ')}`);
  }

  lines.push(
    'Note: a git worktree isolates the working tree — it resolves FILE ' +
      'collisions only. Tasks that mutate the same shared file still race on ' +
      "that file's final state; serialize them (or resolve the shared edit target) rather than relying on isolation.",
  );
  return lines.join('\n');
}
