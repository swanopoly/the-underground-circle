/**
 * clientToolBatchCore — pure partitioner that lets the SwanBot v2
 * client-tool continuation path (`executeClientToolCalls` in
 * `src/lib/swanbot.ts`) run independent read-only client tools in
 * parallel instead of strictly serially.
 *
 * Problem: a v2 continuation round can carry up to ~40 client tool calls
 * and today each one is awaited in sequence — even when they are pure
 * reads with no ordering dependency (read a11y tree + list running apps +
 * screenshot). This core walks the calls IN ORDER and coalesces
 * consecutive read-only calls into one parallel-safe group, while every
 * non-read (or unknown) call stays a singleton group at its original
 * position. Group order preserves emission order, so:
 *
 *   - a write NEVER moves past any other call (serial semantics intact);
 *   - `groups.flat()` reproduces the input sequence element-for-element
 *     (up to MAX_CLIENT_TOOL_BATCH_CALLS), so a caller can zip groups
 *     back onto its original call objects by position.
 *
 * Sibling module: `src/lib/toolBatchParallelism.ts` does policy-metadata
 * partitioning for the typed loop (agentExecutionCore). This core is
 * name-only because the v2 continuation path sees bare `{ id, name }`
 * calls from the edge function, with no policy objects in hand.
 *
 * Purity contract (smoke-tested under tsx): zero runtime imports, zero
 * side effects at import, every export total (never throws, bounded
 * output), deterministic.
 */

export interface ToolBatchCall {
  id: string;
  name: string;
}

export interface ClientToolBatchPartition {
  /** Ordered partition of the input: read-only runs coalesced, everything
   *  else singleton. Flattening reproduces the (capped) input order. */
  groups: ToolBatchCall[][];
  /** Count of calls that landed in a group of size > 1 (i.e. how many
   *  calls actually gained concurrency). */
  parallelizable: number;
}

/** Hard cap on how many calls one partition will process — keeps output
 *  bounded on adversarial input. Real v2 rounds carry ≤ ~40 calls. */
export const MAX_CLIENT_TOOL_BATCH_CALLS = 500;

/** Cap on projected id/name field length in the returned groups. */
const MAX_FIELD_CHARS = 200;

/**
 * Side-effect-free client tools that are safe to dispatch concurrently
 * with each other. READS ONLY — deliberately excludes desktop.edit_file,
 * local.run_shell, git.run, clipboard_write/clear, launch/focus/open,
 * every browser click/type/fill/select action, and every *.create tool.
 * Unknown names fail closed (treated as writes → singleton groups).
 */
export const READONLY_CLIENT_TOOLS: ReadonlySet<string> = new Set([
  // desktop reads
  'desktop.file_read',
  'desktop.file_list',
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.list_running_apps',
  'desktop.list_installed_apps',
  'desktop.list_browser_tabs',
  'desktop.window_state',
  'desktop.clipboard',
  'desktop.screen_size',
  'desktop.screenshot',
  'desktop.read_a11y_tree',
  'desktop.observe_app',
  'desktop.wait_for_app',
  'desktop.app_reachability',
  // browser reads
  'browser.dom_snapshot',
  'browser.verification_state',
  'browser.screenshot',
  // codebase / coordination reads
  'codebase.search',
  'coordination.file_status',
]);

/** Strict membership: exact catalog name, strings only. Anything else
 *  (wrong type, casing, whitespace, unknown tool) → false (fail closed). */
export function isReadOnlyClientTool(name: unknown): boolean {
  return typeof name === 'string' && READONLY_CLIENT_TOOLS.has(name);
}

/** Total string coercion: non-strings → '', long strings capped. */
function capField(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value;
}

/** Project one raw element to a safe { id, name }. Never throws — even a
 *  throwing getter or revoked proxy degrades to empty fields (which are
 *  not read-only names, so the call stays a serial singleton). */
function toBatchCall(value: unknown): ToolBatchCall {
  let id: unknown;
  let name: unknown;
  try {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      id = (value as Record<string, unknown>).id;
      name = (value as Record<string, unknown>).name;
    }
  } catch {
    // adversarial getter/proxy — fall through to empty fields
  }
  return { id: capField(id), name: capField(name) };
}

/**
 * Partition an ordered client-tool call batch into dispatch groups.
 *
 *   - consecutive read-only calls → one group (safe to Promise.all);
 *   - any non-read, unknown, or malformed call → its own singleton group;
 *   - group order == input order; a write never reorders past anything;
 *   - `parallelizable` = number of calls in groups of size > 1;
 *   - degenerate input (non-array, empty) → { groups: [], parallelizable: 0 }.
 *
 * Caller contract: run groups sequentially; within a group of size > 1
 * dispatch concurrently. Since flattened groups mirror the input order,
 * map group members back to the original richer call objects by position
 * (a running cursor), not by identity.
 */
export function partitionClientToolBatch(calls: unknown): ClientToolBatchPartition {
  try {
    if (!Array.isArray(calls) || calls.length === 0) {
      return { groups: [], parallelizable: 0 };
    }
    const limit = Math.min(calls.length, MAX_CLIENT_TOOL_BATCH_CALLS);
    const groups: ToolBatchCall[][] = [];
    let openReadRun: ToolBatchCall[] | null = null;
    for (let i = 0; i < limit; i += 1) {
      const call = toBatchCall(calls[i]);
      if (isReadOnlyClientTool(call.name)) {
        if (openReadRun) {
          openReadRun.push(call);
        } else {
          openReadRun = [call];
          groups.push(openReadRun);
        }
      } else {
        openReadRun = null;
        groups.push([call]);
      }
    }
    let parallelizable = 0;
    for (const group of groups) {
      if (group.length > 1) parallelizable += group.length;
    }
    return { groups, parallelizable };
  } catch {
    // Totality backstop (e.g. revoked-proxy Array.isArray) — neutral value.
    return { groups: [], parallelizable: 0 };
  }
}
