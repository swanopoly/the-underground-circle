/**
 * officeBoardStallCore — pure, READ-ONLY stall classification for the Office
 * ops board.
 *
 * Stall detection previously existed ONLY inside the per-agent AgentRunsPanel
 * (two clicks deep); on the main board a stuck run looked identical to a
 * healthy one. This core surfaces the SAME policy — runStallPolicyCore's
 * heartbeat thresholds — as a per-row verdict the board can badge.
 *
 * Deliberately NOT a reaper: this module never writes, never plans a reap,
 * and never marks anything failed. Two surfaces racing reaps is forbidden;
 * the background reaper (planRunReap) stays the only writer. The board only
 * labels: "this run's heartbeat is old — STALLED?".
 *
 * Divergence from the reaper's fallback, on purpose: runStallPolicyCore falls
 * back to `started_at` when `updated_at` is absent (a reaper must eventually
 * kill heartbeat-less zombies). The board does NOT — a node without an
 * `updatedAt` heartbeat (legacy fetch, missing column) is never flagged,
 * because a long-running healthy run with only an old start time would
 * otherwise show a false STALLED? badge. Totality: missing/garbage input →
 * not stalled.
 *
 * Purity: caller passes `nowMs`; zero runtime imports beyond the pure policy
 * core, so tsx/esbuild loads this directly.
 */

import {
  classifyRunLiveness,
  RUN_STALL_STALE_MS,
  RUN_STALL_DEAD_MS,
  type RunLiveness,
} from './runStallPolicyCore';

/** Badge text for a stalled row — question mark because the board only reads. */
export const OFFICE_BOARD_STALL_LABEL = 'STALLED?' as const;

/** Re-exported policy thresholds so board callers/smokes pin the real values. */
export { RUN_STALL_STALE_MS, RUN_STALL_DEAD_MS };

/** Upper bound on nodes walked so hostile/cyclic input stays bounded. */
const MAX_NODES = 5000;

/** Structural node input — OfficeRunNode is assignable; children optional. */
export interface BoardStallNodeLike {
  runId?: string;
  status?: string;
  /** Heartbeat ISO timestamp (agent_runs.updated_at) threaded onto the node. */
  updatedAt?: string | null;
  children?: BoardStallNodeLike[] | null;
}

export interface BoardStallVerdict {
  stalled: boolean;
  /** The underlying policy verdict ('stale' | 'dead' when stalled). */
  liveness: RunLiveness;
  /** Present exactly when stalled. */
  label?: typeof OFFICE_BOARD_STALL_LABEL;
}

const NOT_STALLED: BoardStallVerdict = { stalled: false, liveness: 'live' };

/**
 * Classify one board node. Stalled ⇔ the run is 'running' AND its
 * `updatedAt` heartbeat age crosses the policy's stale threshold ('stale' or
 * 'dead'). Missing/unparseable heartbeat, non-running status, invalid nowMs,
 * or garbage input → not stalled (never a throw).
 */
export function classifyRunNodeStall(
  node: BoardStallNodeLike | null | undefined,
  nowMs: number,
): BoardStallVerdict {
  if (!node || typeof node !== 'object') return NOT_STALLED;
  const updatedAt = node.updatedAt;
  if (typeof updatedAt !== 'string' || updatedAt.trim().length === 0) return NOT_STALLED;

  const liveness = classifyRunLiveness({
    status: node.status,
    // No started_at fallback here (see module doc): board flags heartbeats only.
    startedAt: null,
    updatedAt,
    nowMs,
  });

  if (liveness === 'stale' || liveness === 'dead') {
    return { stalled: true, liveness, label: OFFICE_BOARD_STALL_LABEL };
  }
  return { stalled: false, liveness };
}

/**
 * Classify a whole board tree (roots + nested children) in one pass. Returns
 * a map keyed by runId; nodes without a usable id are skipped. De-dupes by
 * id and bounds the walk, so cyclic/hostile input terminates. Read-only.
 */
export function classifyBoardStalls(
  nodes: BoardStallNodeLike[] | null | undefined,
  nowMs: number,
): Map<string, BoardStallVerdict> {
  const out = new Map<string, BoardStallVerdict>();
  if (!Array.isArray(nodes)) return out;

  // FIFO walk (index pointer, no shift) so document order is preserved and
  // the FIRST occurrence of a duplicated runId wins — matching the board
  // builder's own first-occurrence dedupe.
  const queue: BoardStallNodeLike[] = [];
  for (const node of nodes) if (node && typeof node === 'object') queue.push(node);

  let cursor = 0;
  while (cursor < queue.length && cursor < MAX_NODES) {
    const node = queue[cursor];
    cursor += 1;

    const id = typeof node.runId === 'string' ? node.runId.trim() : '';
    if (id && !out.has(id)) {
      out.set(id, classifyRunNodeStall(node, nowMs));
    }

    if (queue.length < MAX_NODES) {
      for (const child of Array.isArray(node.children) ? node.children : []) {
        if (child && typeof child === 'object') queue.push(child);
      }
    }
  }

  return out;
}
