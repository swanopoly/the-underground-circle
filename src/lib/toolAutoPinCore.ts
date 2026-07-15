/**
 * toolAutoPinCore — tool-catalog expansion v7: learn each circle's real
 * long-tail tool usage and promote the heaviest-used DEFERRED tools into the
 * pinned core that `openswanBridge.getProgressiveOpenSwanTools` advertises
 * every turn.
 *
 * The progressive-disclosure path (docs/TOOLTREE_DESKTOP_RESEARCH §2.2)
 * advertises only a pinned core (~25–40 high-frequency tools) plus
 * `tools.search`; everything else is deferred and pulled on demand. That
 * default core is a global guess. This core closes the loop per circle: a
 * background aggregator counts which tools each circle actually invokes, and
 * `computeAutoPinSet` turns those counts into a small, bounded set of extra
 * tools to pin so a circle's real habits stop costing a `tools.search`
 * round-trip every time.
 *
 * PURITY: zero imports. All exports are TOTAL — null / undefined / wrong-type /
 * huge / hostile inputs collapse to a safe neutral (empty array), never throw.
 * Output is always bounded. No Date.now()/Math.random() anywhere.
 *
 * Operational definition of "deferred" here: a tool is a candidate iff it is
 * NOT in `excludePinned` (the caller's current pinned core) and NOT
 * `tools.search`. That keeps this core free of the runtime disclosure map —
 * the caller supplies the pinned set, so whatever remains is long-tail.
 *
 * WIRING (see report): a per-circle background aggregator produces
 * `ToolUsageRow[]` (or a `{ tool: count }` map); `computeAutoPinSet(usage, {
 * excludePinned: pinnedNames })` yields the auto-pins; `mergeAutoPins(
 * pinnedNames, autoPins)` unions them into the pinned list that
 * `getProgressiveOpenSwanTools` hands to the model.
 */

/** One aggregated per-circle usage count for a single tool. */
export interface ToolUsageRow {
  tool: string;
  count: number;
}

/** Default number of extra tools to auto-pin per circle. */
export const AUTO_PIN_DEFAULT_CAP = 6;

/** A tool must be used at least this many times before it is auto-pinned. */
export const AUTO_PIN_MIN_COUNT = 3;

/** The unlock path itself — never auto-pinned (it is already always pinned). */
const TOOLS_SEARCH_NAME = 'tools.search';

// ── Internal safety bounds (keep every export total + output bounded) ────────
const MAX_TOOL_NAME_LEN = 200; // reject absurdly long "names" outright
const MAX_INPUT_ROWS = 5000; // bound how much input we ever iterate
const MAX_AUTO_PIN_CAP = 100; // hard ceiling on auto-pin output size
const MERGE_DEFAULT_CAP = 200; // default ceiling for a merged pinned list
const MAX_MERGE_CAP = 1000; // hard ceiling on merged output size

// Tool identifiers are snake_case with optional dotted families
// (`desktop.launch_app`, `gmail.read`, `fetch_url`). Reject anything with
// whitespace, quotes, control chars, or other hostile shapes. Linear regex —
// no catastrophic backtracking, and only ever run on <=200-char strings.
const TOOL_NAME_SHAPE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Coerce an arbitrary value into a valid tool name, or null if it cannot be
 * one. Trims surrounding whitespace, rejects empty / overlong / mis-shaped.
 */
function normalizeToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TOOL_NAME_LEN) return null;
  if (!TOOL_NAME_SHAPE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Coerce an arbitrary value into a finite, non-negative count, or null.
 * Numeric strings (e.g. a Postgres bigint serialized as text) are accepted.
 */
function normalizeCount(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  return null;
}

/** Resolve a requested cap against a default + hard maximum. Honors an explicit 0. */
function resolveCap(cap: unknown, dflt: number, max: number): number {
  if (typeof cap !== 'number' || !Number.isFinite(cap)) return dflt;
  const floored = Math.floor(cap);
  if (floored < 0) return dflt; // negative is garbage → default
  return floored > max ? max : floored;
}

/** Resolve a requested minimum count against a default. Honors any finite >= 0. */
function resolveMinCount(minCount: unknown, dflt: number): number {
  if (typeof minCount !== 'number' || !Number.isFinite(minCount) || minCount < 0) return dflt;
  return minCount;
}

/**
 * Normalize an arbitrary "collection of names" (array, Set, Map keys, plain
 * record keys, or a single string) into a bounded Set of valid tool names.
 */
function toNameSet(value: unknown): Set<string> {
  const out = new Set<string>();
  const items = toIterable(value);
  let seen = 0;
  for (const item of items) {
    if (seen >= MAX_INPUT_ROWS) break;
    seen += 1;
    const name = normalizeToolName(item);
    if (name !== null) out.add(name);
  }
  return out;
}

/** Best-effort conversion of an unknown value into an iterable of members. */
function toIterable(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.length > MAX_INPUT_ROWS ? value.slice(0, MAX_INPUT_ROWS) : value;
  }
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return [...value.keys()];
  if (typeof value === 'string') return [value];
  if (typeof value === 'object') {
    try {
      return Object.keys(value as Record<string, unknown>);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fold arbitrary usage input into per-tool total counts. Accepts:
 *   - `ToolUsageRow[]`            (array of `{ tool, count }`)
 *   - `Record<string, number>`    (map of tool → count)
 *   - `Map<string, number>`
 * Duplicate tools are summed. Unparseable rows are skipped.
 */
function extractTotals(usage: unknown): Map<string, number> {
  const totals = new Map<string, number>();
  if (usage === null || usage === undefined) return totals;

  const add = (toolRaw: unknown, countRaw: unknown): void => {
    const name = normalizeToolName(toolRaw);
    if (name === null) return;
    const count = normalizeCount(countRaw);
    if (count === null) return;
    totals.set(name, (totals.get(name) || 0) + count);
  };

  let processed = 0;
  if (Array.isArray(usage)) {
    for (const row of usage) {
      if (processed >= MAX_INPUT_ROWS) break;
      processed += 1;
      if (row && typeof row === 'object') {
        add((row as { tool?: unknown }).tool, (row as { count?: unknown }).count);
      }
    }
  } else if (usage instanceof Map) {
    for (const [key, val] of usage) {
      if (processed >= MAX_INPUT_ROWS) break;
      processed += 1;
      add(key, val);
    }
  } else if (typeof usage === 'object') {
    let keys: string[] = [];
    try {
      keys = Object.keys(usage as Record<string, unknown>);
    } catch {
      keys = [];
    }
    for (const key of keys) {
      if (processed >= MAX_INPUT_ROWS) break;
      processed += 1;
      add(key, (usage as Record<string, unknown>)[key]);
    }
  }
  return totals;
}

/**
 * From aggregated per-circle tool usage, return the most-used DEFERRED tools
 * to auto-pin.
 *
 * Rules: sort by count desc, require `count >= minCount` (default
 * AUTO_PIN_MIN_COUNT), cap the result (default AUTO_PIN_DEFAULT_CAP), and
 * exclude already-pinned tools (`opts.excludePinned`) plus `tools.search`.
 * Ties on count break deterministically by ascending tool name.
 *
 * Total: any hostile/degenerate input returns `[]`.
 */
export function computeAutoPinSet(
  usage: unknown,
  opts?: { cap?: number; minCount?: number; excludePinned?: unknown },
): string[] {
  try {
    const cap = resolveCap(opts?.cap, AUTO_PIN_DEFAULT_CAP, MAX_AUTO_PIN_CAP);
    if (cap <= 0) return [];
    const minCount = resolveMinCount(opts?.minCount, AUTO_PIN_MIN_COUNT);

    const excluded = toNameSet(opts?.excludePinned);
    excluded.add(TOOLS_SEARCH_NAME); // never auto-pin the unlock path

    const totals = extractTotals(usage);

    const candidates: Array<{ tool: string; count: number }> = [];
    for (const [tool, count] of totals) {
      if (excluded.has(tool)) continue;
      if (count < minCount) continue;
      candidates.push({ tool, count });
    }

    candidates.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.tool < b.tool) return -1;
      if (a.tool > b.tool) return 1;
      return 0;
    });

    const out: string[] = [];
    for (let i = 0; i < candidates.length && out.length < cap; i += 1) {
      out.push(candidates[i].tool);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Union a base pinned list with auto-pins into a single deduped, bounded list.
 * Base entries come first (never dropped in favor of an auto-pin), then any
 * new auto-pins. Output is capped at `cap` (default MERGE_DEFAULT_CAP).
 *
 * Total: any hostile/degenerate input returns `[]`.
 */
export function mergeAutoPins(basePinned: unknown, autoPins: unknown, cap?: number): string[] {
  try {
    const limit = resolveCap(cap, MERGE_DEFAULT_CAP, MAX_MERGE_CAP);
    if (limit <= 0) return [];

    const out: string[] = [];
    const seen = new Set<string>();

    const push = (raw: unknown): void => {
      if (out.length >= limit) return;
      const name = normalizeToolName(raw);
      if (name === null || seen.has(name)) return;
      seen.add(name);
      out.push(name);
    };

    for (const item of toIterable(basePinned)) {
      if (out.length >= limit) break;
      push(item);
    }
    for (const item of toIterable(autoPins)) {
      if (out.length >= limit) break;
      push(item);
    }
    return out;
  } catch {
    return [];
  }
}
