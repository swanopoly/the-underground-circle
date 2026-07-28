/**
 * v2MemorySearchCore — the pure decision layer behind the SwanBot **v2**
 * on-demand memory search tool (`searchCircleMemory` in
 * `supabase/functions/swanbot-v2-ai/index.ts`).
 *
 * THE GAP THIS CLOSES (P3 of `docs/MEMORY_V2_INTEGRATION_PLAN.md`):
 * `searchCircleMemory` searched ONLY `circle_memory` — the legacy single
 * free-text operating document per circle. It never touched `memory_entries`,
 * which is where the entire real memory pipeline writes: extraction,
 * `save_memory`, agent outcomes, `/remember`. So the model's only on-demand
 * recall reached almost nothing the system actually remembers. P1 injects a
 * bounded set into Block 2; THIS is how the model reaches past that budget —
 * and the injected block's own omission note points at it
 * (`V2_MEMORY_OMISSION_NOTE`: "Use the memory search tool if you need more.").
 *
 * ─── WHY ONE TOOL OVER TWO SOURCES, NOT A REPOINT AND NOT A SIBLING ─────────
 *
 * Three options were on the table. This module implements (c) — one tool,
 * `searchCircleMemory`, searching BOTH `memory_entries` and the legacy
 * `circle_memory` doc, with every row tagged by `source`.
 *
 *   (a) Repoint `searchCircleMemory` at `memory_entries` and drop the doc.
 *       REJECTED: the circle memory doc is genuinely useful — it is the
 *       circle's hand-maintained operating document, edited through the HITL
 *       surface (`20260226_hitl.sql`), and it is the one place a team writes
 *       "how we work" prose that nobody would ever file as a `memory_entries`
 *       row. Losing it is a regression, and a silent one: the tool would keep
 *       its name and quietly stop covering a source it used to cover.
 *
 *   (b) Add a sibling `searchMemories` and leave the doc tool alone.
 *       REJECTED for two concrete costs. First, TOOL CONFUSION: two tools whose
 *       names differ only in a word ("circle memory" vs "memories") force the
 *       model to guess which store holds a fact it has never seen — and the
 *       common failure is calling one, getting nothing, and concluding the
 *       circle has no memory of it. Second, PREFIX COST: `searchCircleMemory` is
 *       in `BASE_TOOL_NAMES` (always active) and in two `TOOL_GROUPS`
 *       (`research`, `memory`), so a sibling adds a permanent second tool
 *       definition to the CACHED system prefix on every turn for every user.
 *
 *   (c) ONE tool, both sources.  CHOSEN. The model asks "what do we know about
 *       X" once and gets everything, ranked together. Renaming or removing a
 *       tool the model may already be prompted about has its own cost, so the
 *       NAME IS UNCHANGED — every existing group membership, prompt mention and
 *       persisted transcript keeps working. The description changes to say what
 *       it now covers, and an optional `source` argument lets a follow-up call
 *       narrow to one store when the first call returns noise.
 *
 * ─── PRIVACY IS THE WHOLE BALLGAME ──────────────────────────────────────────
 *
 * The edge runs a SERVICE-ROLE client (`index.ts:~4682`), so RLS is BYPASSED.
 * Any `memory_entries` read is guarded ONLY by the filter around it. Getting
 * that wrong leaks one member's private memory to another — the exact defect
 * fixed in v1 on 2026-07-24 (`swanbot-ai/index.ts:595`).
 *
 * This module therefore does NOT write its own predicate. The authoritative
 * predicate is `v2MemoryInjectionCore.evaluateMemoryRowVisibility`, already
 * smoke-tested at length, and it is **INJECTED** here as `isVisible` (same
 * pattern as `fence` and `planSectionFit` in that module — the edge and the
 * smoke both pass the real function; nothing here can drift from it). Two
 * consequences encoded as behaviour:
 *
 *   - MISSING PREDICATE ⇒ ZERO `memory_entries` RESULTS. Fail closed. A search
 *     that returned rows without a visibility verdict is the leak itself.
 *   - THE SQL ONLY NARROWS. `buildMemoryFloorQueryPlan`'s `postFilterRequired`
 *     is honoured: every row that comes back is re-judged here before it can be
 *     rendered. PostgREST filter strings are easy to get subtly wrong (NULL
 *     semantics, precedence inside `or(...)`), so the query is an optimization
 *     and the predicate is the authority.
 *
 * The `circle_memory` doc has no per-user dimension — it is one row per circle,
 * scoped by `circle_id` alone, and the edge already verifies circle membership
 * before the turn runs (`index.ts:4871-4877`). It is therefore NOT run through
 * the per-user predicate (there is no `user_id` to judge), and it is tagged
 * `source: 'circle_doc'` so the distinction is visible rather than implied.
 *
 * ─── TEXT MATCHING: SQL IS A SUPERSET, THIS FILE IS THE AUTHORITY ───────────
 *
 * Searching title OR content needs a PostgREST `or(...)` expression, where `,`
 * `(` `)` are STRUCTURAL — a query containing them could rewrite the filter.
 * Rather than escape (fragile) or strip (turns the filter into a SUBSET and
 * silently loses real matches), every unsafe character is mapped to the `*`
 * WILDCARD. The SQL filter is then always a SUPERSET of the true match set, and
 * `matchesMemorySearchQuery` does the authoritative literal, case-insensitive
 * comparison over what came back. Worst case for a hostile query is extra rows
 * fetched and discarded — never a rewritten filter, never a missed row.
 *
 * PURITY / SAFETY CONTRACT (repo convention for pure cores):
 *   - ZERO imports. This file is imported by the Deno edge function, which
 *     resolves the whole graph; every core the edge imports is import-free.
 *     That is the house rule, not an accident — see the plan's "Deno
 *     constraint" section. The visibility predicate and the fence are injected
 *     for exactly this reason.
 *   - NO CLOCK: no `Date.now()`, no argless `new Date()`, no `Math.random()`.
 *     Age is computed from a caller-supplied `nowMs` or reported as null.
 *   - TOTAL: every export handles null / undefined / wrong type / NaN / cyclic /
 *     throwing-getter / megabyte input by returning a safe bounded value. Never
 *     throws.
 *   - SECRET-SAFE: diagnostics carry counts and fixed reason codes, never row
 *     content. The only echoed query text is the SANITIZED literal.
 */

// ─── Bounds (all exported so the smoke can pin them) ─────────────────────────

/** Results returned when the caller does not ask for a specific count. */
export const MEMORY_SEARCH_DEFAULT_LIMIT = 6;
/** Hard ceiling on returned results. Tool results are re-sent on every
 *  subsequent turn of the loop, so a big result set is a recurring token cost. */
export const MEMORY_SEARCH_MAX_LIMIT = 12;
/** Max rows SCANNED from either source. The SQL filter is a superset, so the
 *  edge over-fetches a little and this bounds the work regardless. */
export const MEMORY_SEARCH_MAX_ROWS_SCANNED = 200;
/** Multiplier the edge should apply to `limit` when fetching, to leave room for
 *  superset rows that fail the authoritative literal match. */
export const MEMORY_SEARCH_FETCH_MULTIPLIER = 5;
/** Chars of body text in one excerpt window, before the fence is applied. */
export const MEMORY_SEARCH_EXCERPT_CHARS = 320;
/** Chars kept from a row title inside the fenced excerpt. */
export const MEMORY_SEARCH_TITLE_CHARS = 120;
/** Shorter than this and the query matches half the corpus. Refused. */
export const MEMORY_SEARCH_MIN_QUERY_CHARS = 2;
/** Longer than this is not a search, it is a paste. Truncated, not refused. */
export const MEMORY_SEARCH_MAX_QUERY_CHARS = 200;
/** Ceiling on the generated PostgREST pattern, so the request URL stays bounded. */
export const MEMORY_SEARCH_MAX_PATTERN_CHARS = 160;
/** Hard cut applied to any raw field BEFORE regex work, so a megabyte column is
 *  never fully scanned. Above every other bound so it never shapes output. */
export const MEMORY_SEARCH_MAX_SCAN_CHARS = 40000;

/** `memory_kind` values the schema allows (`20260411_memory_entries_standalone.sql:18`).
 *  Anything else is reported as `fact` rather than echoed as free text. */
export const MEMORY_SEARCH_KINDS: ReadonlyArray<string> = [
  'fact',
  'instruction',
  'preference',
  'decision',
  'finding',
  'policy',
  'context',
];

/** `scope` values the schema allows (incl. `agent` from `20260411_agent_memory_scope.sql`). */
export const MEMORY_SEARCH_SCOPES: ReadonlyArray<string> = [
  'org',
  'circle',
  'room',
  'user',
  'session',
  'agent',
];

/** `visibility` values across the live migrations (they disagree; union them). */
export const MEMORY_SEARCH_VISIBILITIES: ReadonlyArray<string> = [
  'private',
  'room_shared',
  'circle_shared',
  'org_shared',
  'public',
];

/** Which store(s) a call may address. Default `all`. */
export const MEMORY_SEARCH_SOURCES = ['all', 'memories', 'circle_doc'] as const;
export type MemorySearchSource = (typeof MEMORY_SEARCH_SOURCES)[number];

const KIND_SET: ReadonlySet<string> = new Set(MEMORY_SEARCH_KINDS);
const SCOPE_SET: ReadonlySet<string> = new Set(MEMORY_SEARCH_SCOPES);
const VISIBILITY_SET: ReadonlySet<string> = new Set(MEMORY_SEARCH_VISIBILITIES);
const SOURCE_SET: ReadonlySet<string> = new Set<string>(MEMORY_SEARCH_SOURCES);

// ─── Total coercion helpers (mirrors v2MemoryInjectionCore's guards) ─────────

/** Guarded property read — a throwing getter / hostile proxy yields undefined. */
function readField(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Guarded indexed read — a hostile index getter yields undefined. */
function readIndex(arr: ArrayLike<unknown>, i: number): unknown {
  try {
    return arr[i];
  } catch {
    return undefined;
  }
}

/** Invisible Unicode Tag block (U+E0000–U+E007F): renders as nothing, carries ASCII. */
const UNICODE_TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
/** C0 controls except TAB/LF/CR, plus DEL and the line/paragraph separators. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f\u2028\u2029]/g;
const CR_NEWLINES = /\r\n?/g;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Bounded, control-stripped, single-line text. Non-strings become ''. */
function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  try {
    let s = raw.length > MEMORY_SEARCH_MAX_SCAN_CHARS ? raw.slice(0, MEMORY_SEARCH_MAX_SCAN_CHARS) : raw;
    s = s
      .replace(CR_NEWLINES, ' ')
      .replace(UNICODE_TAG_CHARS, '')
      .replace(CONTROL_CHARS, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s.length > maxLen ? s.slice(0, maxLen).trim() : s;
  } catch {
    return '';
  }
}

/** Finite number or undefined. Accepts number / numeric string / bigint. */
function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Parse a timestamp WITHOUT reading the clock. Unusable input -> undefined. */
function toEpochMs(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return undefined;
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return parsed;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Allowlist an enum-ish column. Unknown values become null, never free text. */
function enumOrNull(v: unknown, allowed: ReadonlySet<string>): string | null {
  const s = str(v);
  return s !== '' && allowed.has(s) ? s : null;
}

// ─── 1. Query normalization + the superset SQL pattern ───────────────────────

export type MemorySearchQueryReason =
  | 'ok'
  | 'not_a_string'
  | 'empty'
  | 'too_short';

export interface NormalizedMemorySearchQuery {
  ok: boolean;
  /** Sanitized, bounded, single-line query. Safe to echo back to the model. */
  literal: string;
  /** `literal.toLowerCase()` — the comparison form used by the matcher. */
  lowered: string;
  /**
   * PostgREST `ilike` pattern. ALWAYS a SUPERSET of the true match set: every
   * character that is structural in an `or(...)` expression, and every LIKE
   * metacharacter, is mapped to the `*` wildcard rather than escaped or removed.
   * `''` when the query is unusable.
   */
  pattern: string;
  /**
   * True when sanitization left nothing but wildcards (e.g. a pure-CJK or
   * pure-punctuation query). The pattern then matches everything, so the SQL
   * does no narrowing at all and the literal match here does all the work. The
   * edge should still run the query — over-fetching and discarding is correct
   * and bounded; refusing would silently break non-Latin search.
   */
  wildcardOnly: boolean;
  /** True when the raw query was longer than the cap and was cut. */
  truncated: boolean;
  reason: MemorySearchQueryReason;
}

/**
 * Characters that must never reach a PostgREST filter expression verbatim:
 *   `,` `(` `)`  — structural in `or(...)`; would rewrite the filter.
 *   `.`          — the column/operator/value separator.
 *   `"` `\`      — quoting/escaping inside a filter value.
 *   `:`          — used by PostgREST casts/JSON paths.
 *   `*` `%` `_`  — LIKE/ILIKE metacharacters; a literal one must not act as one.
 *   `{` `}` `[` `]` — array/JSON grouping.
 * Everything else (including all non-ASCII letters) is preserved, so search
 * keeps working for non-Latin scripts.
 */
const FILTER_UNSAFE = /[,()."'\\:*%_{}[\]&|!<>=+#?/;`~^$@\u0000-\u001f\u007f]/g;

const EMPTY_QUERY: NormalizedMemorySearchQuery = {
  ok: false,
  literal: '',
  lowered: '',
  pattern: '',
  wildcardOnly: false,
  truncated: false,
  reason: 'empty',
};

/**
 * Normalize an untrusted `query` argument into a literal to match on and a
 * SUPERSET SQL pattern. Total: any input shape returns a verdict, never throws.
 *
 * A non-string is REFUSED (`not_a_string`) rather than stringified — a model
 * that sends `{query: {q: "x"}}` should get a corrective error, not a search
 * for `"[object Object]"`.
 */
export function normalizeMemorySearchQuery(raw: unknown): NormalizedMemorySearchQuery {
  try {
    if (typeof raw !== 'string') return { ...EMPTY_QUERY, reason: 'not_a_string' };
    const cut = raw.length > MEMORY_SEARCH_MAX_QUERY_CHARS;
    const literal = cleanText(raw, MEMORY_SEARCH_MAX_QUERY_CHARS);
    if (literal === '') return { ...EMPTY_QUERY, truncated: cut, reason: 'empty' };
    if (literal.length < MEMORY_SEARCH_MIN_QUERY_CHARS) {
      return { ...EMPTY_QUERY, literal, lowered: literal.toLowerCase(), truncated: cut, reason: 'too_short' };
    }

    // Map every unsafe char to the wildcard, then collapse runs.
    let body = literal.replace(FILTER_UNSAFE, '*').replace(/\*{2,}/g, '*');
    if (body.length > MEMORY_SEARCH_MAX_PATTERN_CHARS) {
      body = body.slice(0, MEMORY_SEARCH_MAX_PATTERN_CHARS);
    }
    const wildcardOnly = body.replace(/[*\s]/g, '') === '';
    // Leading/trailing wildcards make it a contains-match either way.
    const pattern = `*${body}*`.replace(/\*{2,}/g, '*');

    return {
      ok: true,
      literal,
      lowered: literal.toLowerCase(),
      pattern,
      wildcardOnly,
      truncated: cut,
      reason: 'ok',
    };
  } catch {
    return { ...EMPTY_QUERY };
  }
}

/**
 * Build the PostgREST `or(...)` TEXT filter for a set of columns.
 *
 * The edge ANDs this onto the privacy filter by calling `.or()` a SECOND time —
 * repeated top-level params are ANDed by PostgREST, so the result is
 * `(privacy) AND (text)`. Even if that were ever to degrade, privacy does not
 * depend on it: `selectMemorySearchHits` re-runs the injected predicate on every
 * returned row.
 *
 * Returns `''` for an unusable query or an empty column list — the caller must
 * then skip `.or()` rather than pass an empty expression.
 */
export function buildMemorySearchTextFilter(
  query: unknown,
  columns: unknown,
): string {
  try {
    const q =
      query !== null && typeof query === 'object' && typeof (query as { pattern?: unknown }).pattern === 'string'
        ? (query as NormalizedMemorySearchQuery)
        : normalizeMemorySearchQuery(query);
    if (!q.ok || q.pattern === '') return '';
    if (!Array.isArray(columns) || columns.length === 0) return '';
    const parts: string[] = [];
    const limit = Math.min(columns.length, 8);
    for (let i = 0; i < limit; i += 1) {
      const col = str(readIndex(columns, i));
      // Column names are author-supplied constants; refuse anything that is not
      // plainly identifier-shaped rather than trusting the call site.
      if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(col)) continue;
      parts.push(`${col}.ilike.${q.pattern}`);
    }
    return parts.join(',');
  } catch {
    return '';
  }
}

/**
 * The AUTHORITATIVE text match. Case-insensitive literal containment over the
 * title and the content. The SQL is a superset; this decides.
 */
export function matchesMemorySearchQuery(
  title: unknown,
  content: unknown,
  lowered: unknown,
): { matched: boolean; where: 'title' | 'content' | 'both' | 'none' } {
  try {
    const needle = typeof lowered === 'string' ? lowered.toLowerCase() : '';
    if (needle === '') return { matched: false, where: 'none' };
    const t = cleanText(title, MEMORY_SEARCH_MAX_SCAN_CHARS).toLowerCase();
    const c = cleanText(content, MEMORY_SEARCH_MAX_SCAN_CHARS).toLowerCase();
    const inTitle = t !== '' && t.includes(needle);
    const inContent = c !== '' && c.includes(needle);
    if (inTitle && inContent) return { matched: true, where: 'both' };
    if (inTitle) return { matched: true, where: 'title' };
    if (inContent) return { matched: true, where: 'content' };
    return { matched: false, where: 'none' };
  } catch {
    return { matched: false, where: 'none' };
  }
}

/** Normalize the optional `source` argument. Unknown/absent -> `'all'`. */
export function normalizeMemorySearchSource(raw: unknown): MemorySearchSource {
  const s = str(raw).toLowerCase();
  return SOURCE_SET.has(s) ? (s as MemorySearchSource) : 'all';
}

/** Clamp the optional `limit` argument into `[1, MEMORY_SEARCH_MAX_LIMIT]`. */
export function normalizeMemorySearchLimit(raw: unknown): number {
  const n = toFiniteNumber(raw);
  if (n === undefined) return MEMORY_SEARCH_DEFAULT_LIMIT;
  return Math.max(1, Math.min(MEMORY_SEARCH_MAX_LIMIT, Math.floor(n)));
}

/** How many rows the edge should FETCH for a given result `limit`. Bounded. */
export function memorySearchFetchLimit(limit: unknown): number {
  const n = normalizeMemorySearchLimit(limit);
  return Math.min(MEMORY_SEARCH_MAX_ROWS_SCANNED, n * MEMORY_SEARCH_FETCH_MULTIPLIER);
}

// ─── 2. Excerpt: a bounded window CENTRED ON THE MATCH ───────────────────────

/**
 * Build the unfenced body of one result.
 *
 * Centring the window on the match is not cosmetic. The old tool returned
 * `content.slice(0, 1200)` — for the `circle_memory` operating document (one
 * long free-text row per circle) that reliably returned the TOP of the document
 * and not the matched passage, so a successful search could still show the model
 * nothing relevant. The window here always contains the hit when there is one.
 *
 * The title is rendered INSIDE this string on purpose: a memory title is
 * user-authored untrusted text, so it must not leave the tool as an unfenced
 * field. Everything structured that IS returned unfenced (`kind`, `scope`,
 * `visibility`, `importance`, timestamps, ids) is enum-allowlisted or numeric.
 *
 * Deterministic for identical inputs. Never throws.
 */
export function buildMemorySearchExcerpt(
  title: unknown,
  content: unknown,
  lowered: unknown,
  excerptChars?: unknown,
): string {
  try {
    const rawMax = toFiniteNumber(excerptChars);
    const maxChars =
      rawMax === undefined
        ? MEMORY_SEARCH_EXCERPT_CHARS
        : Math.max(40, Math.min(Math.floor(rawMax), MEMORY_SEARCH_EXCERPT_CHARS * 4));
    const cleanTitle = cleanText(title, MEMORY_SEARCH_TITLE_CHARS);
    const body = cleanText(content, MEMORY_SEARCH_MAX_SCAN_CHARS);
    if (body === '') return cleanTitle;

    let window = body;
    if (body.length > maxChars) {
      const needle = typeof lowered === 'string' ? lowered.toLowerCase() : '';
      const found = needle === '' ? -1 : body.toLowerCase().indexOf(needle);
      const anchor = found < 0 ? 0 : found;
      const half = Math.max(0, Math.floor((maxChars - Math.min(needle.length, maxChars)) / 2));
      let start = Math.max(0, anchor - half);
      let end = Math.min(body.length, start + maxChars);
      // Re-expand leftwards when the window ran into the right edge.
      if (end - start < maxChars) start = Math.max(0, end - maxChars);

      // Back off to word boundaries so the fragment does not start/end mid-word.
      if (start > 0) {
        const sp = body.indexOf(' ', start);
        if (sp >= 0 && sp - start <= 40) start = sp + 1;
      }
      if (end < body.length) {
        const sp = body.lastIndexOf(' ', end);
        if (sp > start && end - sp <= 40) end = sp;
      }
      window = `${start > 0 ? '…' : ''}${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`;
    }

    if (cleanTitle === '') return window;
    if (window === '') return cleanTitle;
    return `${cleanTitle} — ${window}`;
  } catch {
    return '';
  }
}

// ─── 3. Selection: predicate, match, rank, bound ─────────────────────────────

/** One returned result. `excerpt` is the ONLY memory-derived string, and it is
 *  fenced. Everything else is numeric, a timestamp, an id, or enum-allowlisted. */
export interface MemorySearchHit {
  /** Row id, bounded and control-stripped. */
  id: string;
  /** Which store it came from. `circle_doc` is the legacy per-circle document. */
  source: 'memory' | 'circle_doc';
  /** Allowlisted `memory_kind`, or the constant `circle_doc`. */
  kind: string;
  /** Allowlisted `scope`, else null. */
  scope: string | null;
  /** Allowlisted `visibility`, else null. */
  visibility: string | null;
  /** True when the row belongs to the calling user. Display metadata only —
   *  the authorization decision is the injected predicate's, never this. */
  own: boolean;
  importance: number;
  /** ISO timestamp as stored, or null when unusable. */
  updatedAt: string | null;
  /** Whole days between `nowMs` and `updatedAt`. null without a caller clock. */
  ageDays: number | null;
  matchedIn: 'title' | 'content' | 'both';
  /** FENCED, bounded, match-centred. Untrusted content, quoted as data. */
  excerpt: string;
}

export interface MemorySearchSelection {
  results: MemorySearchHit[];
  scannedMemories: number;
  scannedDoc: number;
  /** Rows that were visible AND matched, before the result cap. */
  matched: number;
  /** `matched - results.length` — how much the model did not see. */
  omitted: number;
  /** Privacy denials by fixed reason code. Counts only, never content. */
  deniedByReason: Record<string, number>;
  /**
   * True when a wiring problem SUPPRESSED content: the visibility predicate was
   * missing/threw, or the fence was missing/threw/returned unfenced text. The
   * direction is correct (withheld, not leaked) but it is still a bug and the
   * edge should log it.
   */
  failClosed: boolean;
  /** True when rows were cut by the scan cap or the result cap. */
  truncated: boolean;
}

export interface MemorySearchInput {
  /** Raw or already-normalized query. */
  query: unknown;
  /** Rows fetched from `memory_entries`. */
  memoryRows?: unknown;
  /** Rows fetched from `circle_memory` (the legacy per-circle document). */
  docRows?: unknown;
  /** `{ userId, circleId, agentLookupIds? }` — all server-derived. */
  ctx?: unknown;
  limit?: unknown;
  /** Caller-supplied clock. Absent -> `ageDays` is null everywhere. */
  nowMs?: unknown;
  /** REQUIRED. `wrapUntrusted`. Missing/misbehaving -> no results (fail closed). */
  fence?: unknown;
  /**
   * REQUIRED for `memoryRows`. Inject
   * `v2MemoryInjectionCore.evaluateMemoryRowVisibility` (or its boolean sibling).
   * Missing -> ZERO memory results. See the header: a memory-entry search with
   * no visibility verdict IS the leak.
   */
  isVisible?: unknown;
  /** Override the per-result excerpt window. Clamped. */
  excerptChars?: unknown;
}

type FenceFn = (text: string) => unknown;
type VisibilityFn = (row: unknown, ctx: unknown) => unknown;

interface RankedHit extends MemorySearchHit {
  rank: number;
  updatedAtMs: number;
  seq: number;
  sourceRank: number;
}

function matchRank(where: 'title' | 'content' | 'both'): number {
  if (where === 'both') return 3;
  if (where === 'title') return 2;
  return 1;
}

const DEFAULT_IMPORTANCE = 0.5;

function emptySelection(failClosed: boolean): MemorySearchSelection {
  return {
    results: [],
    scannedMemories: 0,
    scannedDoc: 0,
    matched: 0,
    omitted: 0,
    deniedByReason: {},
    failClosed,
    truncated: false,
  };
}

/**
 * Apply the injected privacy predicate, the authoritative literal match, then
 * rank and bound.
 *
 * ORDER OF OPERATIONS IS THE SAFETY PROPERTY: visibility is decided FIRST, on
 * every `memory_entries` row, before anything about the row is rendered. A row
 * that fails the predicate never reaches the excerpt builder, so there is no
 * path by which its text can appear in the output.
 *
 * Ranking is a TOTAL order — match strength, then importance, then recency, then
 * source, then id, then scan position — so the same rows always produce the same
 * results in the same order.
 *
 * Total: any input shape returns a selection, never throws.
 */
export function selectMemorySearchHits(input: MemorySearchInput): MemorySearchSelection {
  const deniedByReason: Record<string, number> = {};
  try {
    const rawQuery = readField(input, 'query');
    const q =
      rawQuery !== null && typeof rawQuery === 'object' && typeof (rawQuery as { lowered?: unknown }).lowered === 'string'
        ? (rawQuery as NormalizedMemorySearchQuery)
        : normalizeMemorySearchQuery(rawQuery);
    if (!q.ok) return emptySelection(false);

    const fenceRaw = readField(input, 'fence');
    if (typeof fenceRaw !== 'function') return emptySelection(true);
    const fence = fenceRaw as FenceFn;

    const ctx = readField(input, 'ctx');
    const ctxUserId = str(readField(ctx, 'userId'));
    const limit = normalizeMemorySearchLimit(readField(input, 'limit'));
    const nowMs = toFiniteNumber(readField(input, 'nowMs'));
    const excerptChars = readField(input, 'excerptChars');

    const visibleRaw = readField(input, 'isVisible');
    const isVisible = typeof visibleRaw === 'function' ? (visibleRaw as VisibilityFn) : null;

    const memoryRows = readField(input, 'memoryRows');
    const docRows = readField(input, 'docRows');
    const memoryList: unknown[] = Array.isArray(memoryRows) ? memoryRows : [];
    const docList: unknown[] = Array.isArray(docRows) ? docRows : [];

    let failClosed = false;
    let truncated =
      memoryList.length > MEMORY_SEARCH_MAX_ROWS_SCANNED || docList.length > MEMORY_SEARCH_MAX_ROWS_SCANNED;

    // Fail closed: memory rows without a predicate are not searchable at all.
    if (memoryList.length > 0 && !isVisible) failClosed = true;

    const ranked: RankedHit[] = [];
    let seq = 0;

    const pushHit = (
      row: unknown,
      source: 'memory' | 'circle_doc',
      titleField: unknown,
      contentField: unknown,
      where: 'title' | 'content' | 'both',
      kind: string,
      scope: string | null,
      visibility: string | null,
      own: boolean,
      importance: number,
      updatedAtRaw: unknown,
    ): void => {
      const body = buildMemorySearchExcerpt(titleField, contentField, q.lowered, excerptChars);
      if (body === '') return; // nothing renderable — not a privacy denial
      let fenced: unknown;
      try {
        fenced = fence(body);
      } catch {
        failClosed = true; // a throwing fence must never fall back to raw text
        return;
      }
      if (typeof fenced !== 'string') {
        failClosed = true;
        return;
      }
      if (fenced === '') return; // legitimate: a blank body fences to ''
      if (fenced === body) {
        failClosed = true; // an identity fence emits UNFENCED memory. Refuse it.
        return;
      }
      const updatedAtMs = toEpochMs(updatedAtRaw);
      const updatedAt = typeof updatedAtRaw === 'string' && updatedAtMs !== undefined
        ? cleanText(updatedAtRaw, 64)
        : null;
      const ageDays =
        nowMs !== undefined && updatedAtMs !== undefined
          ? Math.max(0, Math.round((nowMs - updatedAtMs) / 86_400_000))
          : null;
      ranked.push({
        id: cleanText(readField(row, 'id'), 64) || `row#${seq}`,
        source,
        kind,
        scope,
        visibility,
        own,
        importance,
        updatedAt,
        ageDays,
        matchedIn: where,
        excerpt: fenced,
        rank: matchRank(where),
        updatedAtMs: updatedAtMs === undefined ? Number.NEGATIVE_INFINITY : updatedAtMs,
        seq: seq++,
        sourceRank: source === 'memory' ? 0 : 1,
      });
    };

    // ── memory_entries — PRIVACY FIRST, ALWAYS ──────────────────────────────
    const memScan = Math.min(memoryList.length, MEMORY_SEARCH_MAX_ROWS_SCANNED);
    let scannedMemories = 0;
    if (isVisible) {
      for (let i = 0; i < memScan; i += 1) {
        scannedMemories += 1;
        const row = readIndex(memoryList, i);
        let verdict: unknown;
        try {
          verdict = isVisible(row, ctx);
        } catch {
          // A throwing predicate denies. Never assume visible.
          failClosed = true;
          deniedByReason.predicate_threw = (deniedByReason.predicate_threw ?? 0) + 1;
          continue;
        }
        const eligible =
          typeof verdict === 'boolean'
            ? verdict
            : readField(verdict, 'eligible') === true;
        if (!eligible) {
          const reason = str(readField(verdict, 'reason')) || 'denied';
          deniedByReason[reason] = (deniedByReason[reason] ?? 0) + 1;
          continue;
        }
        const title = readField(row, 'title');
        const content = readField(row, 'content');
        const m = matchesMemorySearchQuery(title, content, q.lowered);
        if (!m.matched || m.where === 'none') continue;
        const rowUser = str(readField(row, 'user_id')) || str(readField(row, 'userId'));
        const importance = toFiniteNumber(readField(row, 'importance'));
        pushHit(
          row,
          'memory',
          title,
          content,
          m.where,
          enumOrNull(readField(row, 'memory_kind'), KIND_SET) ?? 'fact',
          enumOrNull(readField(row, 'scope'), SCOPE_SET),
          enumOrNull(readField(row, 'visibility'), VISIBILITY_SET),
          rowUser !== '' && ctxUserId !== '' && rowUser === ctxUserId,
          importance === undefined ? DEFAULT_IMPORTANCE : importance,
          readField(row, 'updated_at') ?? readField(row, 'updatedAt') ?? readField(row, 'created_at'),
        );
      }
    }

    // ── circle_memory — the circle's shared operating document ──────────────
    // No per-user dimension exists on this table (one row per circle, scoped by
    // `circle_id`, and circle membership is verified before the turn runs), so
    // the per-user predicate has nothing to judge. `scope`/`visibility` below are
    // author-supplied constants describing what the table structurally IS.
    const docScan = Math.min(docList.length, MEMORY_SEARCH_MAX_ROWS_SCANNED);
    let scannedDoc = 0;
    for (let i = 0; i < docScan; i += 1) {
      scannedDoc += 1;
      const row = readIndex(docList, i);
      if (row === null || typeof row !== 'object') continue;
      const content = readField(row, 'content');
      const m = matchesMemorySearchQuery(undefined, content, q.lowered);
      if (!m.matched || m.where === 'none') continue;
      pushHit(
        row,
        'circle_doc',
        '',
        content,
        'content',
        'circle_doc',
        'circle',
        'circle_shared',
        false,
        DEFAULT_IMPORTANCE,
        readField(row, 'updated_at') ?? readField(row, 'created_at'),
      );
    }

    ranked.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      if (b.importance !== a.importance) return b.importance - a.importance;
      if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs > a.updatedAtMs ? 1 : -1;
      if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return a.seq - b.seq;
    });

    const matched = ranked.length;
    const kept = ranked.slice(0, limit);
    if (matched > kept.length) truncated = true;

    return {
      results: kept.map((r) => ({
        id: r.id,
        source: r.source,
        kind: r.kind,
        scope: r.scope,
        visibility: r.visibility,
        own: r.own,
        importance: r.importance,
        updatedAt: r.updatedAt,
        ageDays: r.ageDays,
        matchedIn: r.matchedIn,
        excerpt: r.excerpt,
      })),
      scannedMemories,
      scannedDoc,
      matched,
      omitted: matched - kept.length,
      deniedByReason,
      failClosed,
      truncated,
    };
  } catch {
    return emptySelection(true);
  }
}

// ─── 4. The tool payload ─────────────────────────────────────────────────────

export interface MemorySearchToolData {
  /** The SANITIZED query, echoed so the model can see what was actually run. */
  query: string;
  /** Which store(s) were addressed. */
  source: MemorySearchSource;
  count: number;
  results: MemorySearchHit[];
  /** Matched but not returned, because of the result cap. */
  omitted: number;
  scanned: { memories: number; circleDoc: number };
  /** Present only when there is something honest to say about the shortfall. */
  note?: string;
}

/**
 * Shape a selection into the `{ ok: true, data }` payload the tool returns.
 *
 * The `note` exists so an empty or clipped result is HONEST rather than read by
 * the model as "the circle has no memory of this": a search that returns nothing
 * because the budget clipped it, or because the caller's own memory simply does
 * not mention the term, are different facts and the model acts differently on
 * them.
 */
export function buildMemorySearchToolData(
  selection: unknown,
  query: unknown,
  source: unknown,
): MemorySearchToolData {
  const src = normalizeMemorySearchSource(source);
  const literal =
    query !== null && typeof query === 'object' && typeof (query as { literal?: unknown }).literal === 'string'
      ? cleanText((query as { literal: string }).literal, MEMORY_SEARCH_MAX_QUERY_CHARS)
      : cleanText(query, MEMORY_SEARCH_MAX_QUERY_CHARS);

  const resultsRaw = readField(selection, 'results');
  const results: MemorySearchHit[] = Array.isArray(resultsRaw) ? (resultsRaw as MemorySearchHit[]) : [];
  const omitted = Math.max(0, toFiniteNumber(readField(selection, 'omitted')) ?? 0);
  const scannedMemories = Math.max(0, toFiniteNumber(readField(selection, 'scannedMemories')) ?? 0);
  const scannedDoc = Math.max(0, toFiniteNumber(readField(selection, 'scannedDoc')) ?? 0);

  const notes: string[] = [];
  if (omitted > 0) {
    notes.push(`${omitted} more match(es) were not returned — narrow the query or raise \`limit\` (max ${MEMORY_SEARCH_MAX_LIMIT}).`);
  }
  if (results.length === 0) {
    notes.push(
      'No stored memory matched. This is a literal substring search, not a semantic one — try a shorter or different term before concluding nothing is remembered.',
    );
  }
  if (readField(selection, 'failClosed') === true) {
    notes.push('Some results were withheld by a safety check.');
  }

  return {
    query: literal,
    source: src,
    count: results.length,
    results,
    omitted,
    scanned: { memories: scannedMemories, circleDoc: scannedDoc },
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}
