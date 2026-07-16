/**
 * toolSearchRelevanceCore — a relevance floor for `tools.search` results.
 *
 * Problem (tool-runtime opt v6): `searchOpenSwanToolCatalog` in
 * `openswanToolRuntime.ts` ranks the loop-safe catalog and returns
 * `scored.slice(0, limit)`. When a query only glances off descriptions,
 * labels, generic verb segments, or a whole tool family, MANY long-tail
 * tools tie at a low score and the fixed slice silently unlocks all of
 * them for the next turn — tools the turn does not actually need.
 *
 * This core adds a deterministic floor over the already-scored `{tool, score}`
 * shape (map the internal `{score, tool, family}` rows to `{tool: name, score}`
 * and call this just before the slice):
 *
 *   STRONG tier (topScore >= TOOL_SEARCH_STRONG_FLOOR): the best hit is a real
 *     domain signal (exact/substring name, whole distinctive segment, product
 *     synonym, or full-phrase label). Keep every match at or above the band
 *     `max(TOOL_SEARCH_MIN_FLOOR, round(topScore * TOOL_SEARCH_BAND_RATIO))`,
 *     and always keep the top ~TOOL_SEARCH_ALWAYS_KEEP even if they dip below
 *     the band. Matches below the band beyond the always-keep set are dropped.
 *
 *   WEAK tier (topScore < TOOL_SEARCH_STRONG_FLOOR): the best hit is only
 *     description-noise / a generic verb segment / a partial substring / a
 *     family match — exactly the signals that broadly tie a wide long-tail.
 *     Return only the top ~TOOL_SEARCH_ALWAYS_KEEP so a weak, broadly-tied
 *     search does NOT unlock the wide set.
 *
 * Purity: zero imports. No Date.now()/Math.random(). Every export is TOTAL —
 * hostile/cyclic/huge/wrong input yields a bounded, safe result and never
 * throws. Output is bounded by `cap` (default TOOL_SEARCH_DEFAULT_CAP).
 */

export interface ScoredTool {
  tool: string;
  score: number;
}

/** Top score at/above which matches are treated as a real domain signal. */
export const TOOL_SEARCH_STRONG_FLOOR = 60;

/** Band width: keep strong-tier matches within this ratio of the top score. */
export const TOOL_SEARCH_BAND_RATIO = 0.35;

/** Absolute band floor — the band never drops below this. */
export const TOOL_SEARCH_MIN_FLOOR = 30;

/** Always keep at least this many top matches (both tiers), before the cap. */
export const TOOL_SEARCH_ALWAYS_KEEP = 3;

/** Default output cap. */
export const TOOL_SEARCH_DEFAULT_CAP = 8;

/** Hard ceiling on cap and on how many raw entries we inspect. */
const CAP_CEILING = 25;
const MAX_INPUT = 10000;
const MAX_TOOL_LEN = 200;

/**
 * Coerce arbitrary input into a bounded, de-duplicated list of valid
 * `{tool, score}` entries. Reads only shallow `.tool`/`.score`, so cyclic
 * inputs are safe. Non-object rows, non-string / empty tools, and
 * non-finite scores are skipped. Duplicate tools keep their highest score.
 */
function normalizeScoredList(matches: unknown): ScoredTool[] {
  if (!Array.isArray(matches)) return [];
  const best = new Map<string, number>();
  const n = matches.length < MAX_INPUT ? matches.length : MAX_INPUT;
  for (let i = 0; i < n; i++) {
    const row = matches[i];
    if (!row || typeof row !== 'object') continue;
    const rec = row as { tool?: unknown; score?: unknown };
    const rawTool = rec.tool;
    if (typeof rawTool !== 'string' || rawTool.length === 0) continue;
    const tool = rawTool.length > MAX_TOOL_LEN ? rawTool.slice(0, MAX_TOOL_LEN) : rawTool;
    const rawScore = rec.score;
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) continue;
    const prev = best.get(tool);
    if (prev === undefined || rawScore > prev) best.set(tool, rawScore);
  }
  const out: ScoredTool[] = [];
  best.forEach((score, tool) => out.push({ tool, score }));
  return out;
}

/** Deterministic ranking: score desc, then tool name asc (locale-independent). */
function compareScored(a: ScoredTool, b: ScoredTool): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.tool < b.tool) return -1;
  if (a.tool > b.tool) return 1;
  return 0;
}

/** Resolve the effective output cap from opts, clamped to a safe range. */
function resolveCap(opts?: { cap?: number }): number {
  const raw = opts?.cap;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return TOOL_SEARCH_DEFAULT_CAP;
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > CAP_CEILING) return CAP_CEILING;
  return floored;
}

/**
 * Apply the relevance floor to a scored `tools.search` result set.
 *
 * @param matches Anything shaped like `{ tool: string; score: number }[]`.
 * @param opts.cap Max entries to return (default TOOL_SEARCH_DEFAULT_CAP,
 *   clamped to [1, 25]).
 * @returns The kept, ranked `{tool, score}` entries — always an array.
 */
export function applyToolSearchRelevanceFloor(
  matches: unknown,
  opts?: { cap?: number },
): ScoredTool[] {
  const list = normalizeScoredList(matches);
  if (list.length === 0) return [];

  list.sort(compareScored);

  const total = list.length;
  const cap = resolveCap(opts);
  const alwaysKeep = Math.min(TOOL_SEARCH_ALWAYS_KEEP, total);
  const topScore = list[0].score;

  let keep: number;
  if (topScore >= TOOL_SEARCH_STRONG_FLOOR) {
    // Strong tier: keep the band, plus always the top few.
    const band = Math.max(TOOL_SEARCH_MIN_FLOOR, Math.round(topScore * TOOL_SEARCH_BAND_RATIO));
    let aboveBand = 0;
    for (let i = 0; i < total; i++) {
      // list is sorted desc, so the first sub-band score ends the run.
      if (list[i].score >= band) aboveBand++;
      else break;
    }
    keep = aboveBand > alwaysKeep ? aboveBand : alwaysKeep;
  } else {
    // Weak tier: a sub-floor top score is low-confidence and broadly tied on
    // description/verb/family noise — do NOT widen past the always-keep set.
    keep = alwaysKeep;
  }

  if (keep > cap) keep = cap;
  if (keep > total) keep = total;
  return list.slice(0, keep);
}

export default applyToolSearchRelevanceFloor;
