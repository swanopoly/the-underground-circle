/**
 * prewarmToolSelectionCore — tool-catalog optimization v5 (pure decision core).
 *
 * Progressive disclosure (openswanBridge.getProgressiveOpenSwanTools) pins a
 * small high-frequency core every turn and defers the long tail behind a
 * `tools.search` round-trip: the model must spend one tool call to unlock a
 * deferred tool before it can use it (docs/TOOLTREE_DESKTOP_RESEARCH §2.2).
 * When the host ALREADY has strong signal about which deferred tools this turn
 * needs — a ranked catalog search (openswanToolRuntime.searchOpenSwanToolCatalog)
 * AND a capability classifier (chatCapabilityManifest.suggestCapabilitiesForMessage)
 * that independently agree — that round-trip is pure latency.
 *
 * This core picks the deferred tools to fold straight into the pinned set for
 * THIS turn, so they arrive already-loaded and the model skips the tools.search
 * hop. It is intentionally CONSERVATIVE: a tool is prewarmed only when the
 * ranked search scores it highly (PREWARM_MIN_SCORE) AND the classifier
 * suggested its family — the INTERSECTION of two signals — and the result is
 * capped so a turn can never balloon the advertised tool list.
 *
 * PURITY: zero runtime imports. No wall-clock / RNG at module scope. Every
 * export is TOTAL — null / undefined / wrong-type / huge / hostile input
 * (including objects with throwing getters) yields a safe, bounded, neutral
 * result (an empty array), never a throw. DETERMINISTIC: identical inputs
 * always produce identical output — matches are re-ranked internally by score
 * with a byte-wise name tiebreaker, so caller ordering never leaks through.
 *
 * Contract mirror (kept in sync BY HAND — this file imports nothing so the
 * smoke test loads under tsx/esbuild):
 *   - `score` uses the same tiers as searchOpenSwanToolCatalog: exact name 1000 ·
 *     name substring 400 · label phrase +120 · distinctive name segment /
 *     product-noun +60 · partial name / generic verb +35 · family +30 · label
 *     token +12 · desc token +3. PREWARM_MIN_SCORE (60) is the "distinctive
 *     name signal or better" bar, so a match resting on family (30) or
 *     description tokens (3) alone never clears it.
 *   - `family` mirrors getOpenSwanToolDisclosureFamily: the name prefix before
 *     the first '.', or the whole name for a flat tool (`fetch_url`).
 *   - `suggestedFamilies` is the string[] returned by suggestCapabilitiesForMessage.
 *
 * WIRING (report): openswanBridge.getProgressiveOpenSwanTools, before it
 * freezes the pinned set (~line 158) — union
 * `selectPrewarmToolNames(searchMatches, suggestedFamilies, { alreadyPinned: pinnedNames })`
 * into `pinnedNames` for the turn.
 */

/** One ranked catalog match — a tool name plus its search score. */
export interface CatalogMatch {
  tool: string;
  score: number;
}

/** Default ceiling on tools folded into the pinned set in a single turn. */
export const PREWARM_DEFAULT_CAP = 5;

/**
 * Minimum search score for a match to count as "high confidence". Pinned at
 * the distinctive-name-segment tier (60) of searchOpenSwanToolCatalog, so a
 * tool that matched only on its family (30) or on description tokens (3) is
 * never prewarmed — only a strong NAME-level signal (or better) qualifies.
 */
export const PREWARM_MIN_SCORE = 60;

/**
 * Only the top-K highest-scored matches are eligible candidates. Bounds the
 * work against a hostile / over-long matches array and keeps "top-K ranked"
 * honest even if the caller hands over an unsorted or huge list. Chosen larger
 * than PREWARM_HARD_CAP so the cap — not the window — is the binding limit on a
 * well-formed turn.
 */
export const PREWARM_TOP_K = 25;

/**
 * Absolute ceiling on the number of returned names, regardless of a
 * caller-supplied `cap`. Even a misbehaving caller passing `cap: 1e9` can never
 * make prewarming balloon the tool list past this.
 */
export const PREWARM_HARD_CAP = 12;

/** The catalog-search tool is the unlock path itself — never prewarm it. */
const TOOLS_SEARCH_NAME = 'tools.search';

// Hard scan bounds — keep the core O(bounded) no matter how large the input.
const MAX_MATCH_SCAN = 500;
const MAX_FAMILY_SCAN = 200;
const MAX_PINNED_SCAN = 1000;

/**
 * Disclosure family for a tool name: the prefix before the first '.', or the
 * whole name for a flat tool (`fetch_url`, `save_memory`). Mirrors
 * openswanToolRuntime.getOpenSwanToolDisclosureFamily. Total — a non-string,
 * empty, or leading-dot name yields a safe value ('' or the input unchanged),
 * never a throw.
 */
export function toolFamily(name: unknown): string {
  if (typeof name !== 'string') return '';
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Clamp a caller-supplied cap into [0, PREWARM_HARD_CAP]; default when absent/invalid. */
function normalizeCap(cap: unknown): number {
  if (typeof cap === 'number' && Number.isFinite(cap)) {
    const n = Math.floor(cap);
    if (n <= 0) return 0;
    return n < PREWARM_HARD_CAP ? n : PREWARM_HARD_CAP;
  }
  return PREWARM_DEFAULT_CAP;
}

/** Lower-cased, trimmed, de-duplicated family tokens; non-array → empty set. */
function toLowerFamilySet(value: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  const limit = value.length < MAX_FAMILY_SCAN ? value.length : MAX_FAMILY_SCAN;
  for (let i = 0; i < limit; i++) {
    try {
      const f = value[i];
      if (typeof f === 'string') {
        const t = f.trim().toLowerCase();
        if (t) out.add(t);
      }
    } catch {
      /* skip a hostile element (e.g. throwing index getter) */
    }
  }
  return out;
}

/** Trimmed tool-name set of already-pinned tools; non-array → empty set. */
function toPinnedSet(value: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  const limit = value.length < MAX_PINNED_SCAN ? value.length : MAX_PINNED_SCAN;
  for (let i = 0; i < limit; i++) {
    try {
      const s = value[i];
      if (typeof s === 'string') {
        const t = s.trim();
        if (t) out.add(t);
      }
    } catch {
      /* skip a hostile element */
    }
  }
  return out;
}

/** Read the tool name from a match record. Primary `tool`; tolerate `name`. */
function readToolName(rec: Record<string, unknown>): string {
  const tool = rec.tool;
  if (typeof tool === 'string' && tool.trim()) return tool.trim();
  // Tolerate the raw OpenSwanToolCatalogMatch shape, which names the field
  // `name`. Those carry no `score`, so they still fail the confidence gate
  // unless the caller supplies one — fail-closed, never a silent prewarm.
  const name = rec.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return '';
}

/** Read a finite numeric score; anything else (missing / NaN / ∞) → 0. */
function readScore(rec: Record<string, unknown>): number {
  const s = rec.score;
  if (typeof s === 'number' && Number.isFinite(s)) return s;
  return 0;
}

/** Normalize an unknown matches input into a bounded array of clean matches. */
function normalizeMatches(matches: unknown): CatalogMatch[] {
  if (!Array.isArray(matches)) return [];
  const out: CatalogMatch[] = [];
  const limit = matches.length < MAX_MATCH_SCAN ? matches.length : MAX_MATCH_SCAN;
  for (let i = 0; i < limit; i++) {
    try {
      const m = matches[i];
      if (!m || typeof m !== 'object') continue;
      const rec = m as Record<string, unknown>;
      const tool = readToolName(rec);
      if (!tool) continue;
      out.push({ tool, score: readScore(rec) });
    } catch {
      /* one hostile element must never discard the whole batch */
    }
  }
  return out;
}

/**
 * Pick the deferred tools to fold into the pinned set for THIS turn.
 *
 * A tool is selected when it is ALL of:
 *   1. among the top-K (PREWARM_TOP_K) highest-scored catalog matches,
 *   2. scored at or above PREWARM_MIN_SCORE (high confidence), and
 *   3. in a family the classifier independently suggested.
 * Then, unconditionally: `tools.search` and anything already pinned are
 * excluded, the list is de-duplicated (highest-scored occurrence wins), and it
 * is capped — `opts.cap` (default PREWARM_DEFAULT_CAP), hard ceiling
 * PREWARM_HARD_CAP.
 *
 * Total and deterministic: returns [] for any degenerate input (non-array
 * matches, no suggested families, all below threshold, …) and never throws.
 */
export function selectPrewarmToolNames(
  matches: unknown,
  suggestedFamilies: unknown,
  opts?: { cap?: number; alreadyPinned?: unknown },
): string[] {
  try {
    const cap = normalizeCap(opts?.cap);
    if (cap <= 0) return [];

    const suggested = toLowerFamilySet(suggestedFamilies);
    if (suggested.size === 0) return []; // no classifier signal → prewarm nothing.

    const normalized = normalizeMatches(matches);
    if (normalized.length === 0) return [];

    // Re-rank internally so the output never depends on caller ordering:
    // score desc, then tool name asc (byte-wise, locale-independent) as a
    // fully deterministic tiebreaker.
    normalized.sort(
      (a, b) => b.score - a.score || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0),
    );

    const topK =
      normalized.length < PREWARM_TOP_K ? normalized : normalized.slice(0, PREWARM_TOP_K);
    const pinned = toPinnedSet(opts?.alreadyPinned);

    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < topK.length; i++) {
      if (out.length >= cap) break;
      const tool = topK[i].tool;
      if (topK[i].score < PREWARM_MIN_SCORE) continue; // high confidence only.
      if (tool.toLowerCase() === TOOLS_SEARCH_NAME) continue; // never the unlock tool.
      if (pinned.has(tool)) continue; // already advertised this turn.
      if (seen.has(tool)) continue; // dedupe.
      if (!suggested.has(toolFamily(tool).toLowerCase())) continue; // family agreement.
      seen.add(tool);
      out.push(tool);
    }
    return out;
  } catch {
    // Ultimate safety net — any exotic hostile input degrades to "prewarm
    // nothing", which is always the safe, correct fallback (the model can
    // still reach every deferred tool via tools.search).
    return [];
  }
}
