/**
 * memoryDedupeCore — the PURE identity/similarity layer behind the `/remember`
 * write path (`memoryService.rememberFromChat`).
 *
 * WHY THIS FILE EXISTS (a fixed data-loss bug, not a refactor):
 * `rememberFromChat` has TWO in-place UPDATE paths that replace an existing
 * `memory_entries` row's title+content. There is no history row, so a wrong
 * match is SILENT, IRREVERSIBLE destruction of user-authored memory. Both
 * matchers used to be far too eager:
 *
 *  (1) KEY COLLAPSE. `inferExplicitMemoryKey` returned the single hardcoded
 *      constant `response_standard.deep_thorough_reasoning` for ANY content
 *      mentioning "consider tradeoffs" / "reason thoroughly" / "think
 *      step-by-step" / "comprehensive analysis", and otherwise a slug of only
 *      the FIRST 80 CHARS. `upsertExplicitMemory` looks a row up by that key
 *      and UPDATEs it. So "When reviewing PRs, consider tradeoffs..." and "For
 *      DB migrations, consider tradeoffs..." collapsed onto ONE row — the first
 *      memory was destroyed by the second. Same for any two memories sharing an
 *      80-char prefix. FIX: every key now carries a full-content discriminator
 *      (`contentDiscriminator`, a full-text FNV-1a digest), and the canonical
 *      response-standard key is reserved for content that actually IS the
 *      canonical response standard.
 *
 *  (2) SIMILARITY COLLAPSE. `memorySimilarityScore` returned 0.92 on ANY
 *      substring containment and otherwise divided token overlap by
 *      `min(|A|,|B|)`. Both make a SHORT string near-identical to a LONG one
 *      that merely mentions it: `/remember postgres` scored 1.0 against any
 *      existing memory containing the word "postgres" and overwrote it. FIX:
 *      containment only counts when the shorter side is a substantial fraction
 *      of the longer AND long enough to be a statement rather than a topic word;
 *      token overlap is Jaccard (`|A∩B| / |A∪B|`), which is symmetric and cannot
 *      be gamed by shrinking one side.
 *
 * DESIGN BIAS — FALSE NEGATIVES ARE CHEAP, FALSE POSITIVES ARE NOT.
 * A missed duplicate costs one extra memory row (visible, forgettable via
 * `/forget`). A wrong duplicate costs the user's original text forever. Every
 * threshold below is therefore chosen on the conservative side, and every
 * ambiguous case (truncated compare window, empty/degenerate input, missing id)
 * resolves to "not a duplicate".
 *
 * PURITY / SAFETY CONTRACT:
 *   - Type-only imports (no supabase / react-native) → loads under `npx tsx`.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`; identical
 *     input → identical output. Callers pass `nowMs` if they ever need time.
 *   - TOTAL: every export tolerates null/undefined/wrong-type/cyclic/throwing-
 *     getter/huge input and returns a safe bounded value instead of throwing.
 *   - SYMMETRIC: `memorySimilarityScore(a, b) === memorySimilarityScore(b, a)`.
 */

import type { MemoryKind } from './agentRunSystem';

// ─── Exported bounds and thresholds (single source of truth) ─────────────────

/**
 * Chars compared per side. Beyond this we compare PREFIXES, which cannot prove
 * identity — so a truncated comparison is score-capped (see TRUNCATED_CEILING).
 */
export const MAX_COMPARE_CHARS = 20000;

/** Cap on tokens extracted per side (bounds the Jaccard set work). */
export const MAX_TOKENS_PER_SIDE = 4000;

/** Chars of content folded into a key discriminator digest. */
export const MAX_DIGEST_CHARS = 100000;

/** Chars of the content slug retained in an explicit memory key. */
export const MAX_KEY_SLUG_CHARS = 64;

/**
 * Containment (`long.includes(short)`) counts as near-identity only when the
 * shorter side is at least this fraction of the longer one. RATIONALE: at 0.6
 * the two strings are the same statement plus a clause; below it the "match" is
 * a quote of a fragment, which says nothing about the rest of the longer text.
 * The old code used an implicit floor of 0 — that is exactly how a one-word
 * `/remember postgres` overwrote a full paragraph.
 */
export const CONTAINMENT_MIN_LENGTH_RATIO = 0.6;

/**
 * Containment is additionally ignored when the shorter side is under this many
 * chars. RATIONALE: short strings ("postgres", "dark mode", "prod") are TOPIC
 * WORDS, not statements; two memories about the same topic are not the same
 * memory. 24 chars ≈ a short but complete sentence. Below the floor we fall
 * through to Jaccard, which scores such pairs on their real token overlap.
 */
export const CONTAINMENT_MIN_CHARS = 24;

/**
 * Title similarity that, WITH corroboration, marks an existing row as the same
 * memory. Unchanged from the pre-fix predicate — the bug was the scorer, not
 * this number.
 */
export const DUPLICATE_TITLE_THRESHOLD = 0.88;

/** Content similarity that alone marks an existing row as the same memory. */
export const DUPLICATE_CONTENT_THRESHOLD = 0.82;

/**
 * Corroboration floor: a TITLE match may only trigger an overwrite when the
 * bodies are at least this similar. RATIONALE: titles here are mechanical
 * truncations of content (`Instruction: ${content.slice(0, 44)}`), so two
 * unrelated memories sharing a 44-char prefix get BYTE-IDENTICAL titles and
 * score 1.0. Without this floor a title collision alone would destroy the older
 * body. 0.5 still allows a genuine rewrite/refinement of the same memory
 * (roughly half the tokens preserved) while rejecting unrelated bodies.
 */
export const TITLE_MATCH_CONTENT_FLOOR = 0.5;

/**
 * Ceiling applied when either side had to be truncated to MAX_COMPARE_CHARS and
 * the raw strings were not identical. Sits below DUPLICATE_CONTENT_THRESHOLD so
 * a prefix-only comparison can never authorize an overwrite.
 */
export const TRUNCATED_SCORE_CEILING = 0.8;

/**
 * Similarity to the canonical response-standard text required before `/remember`
 * is allowed to reuse the canonical key/title (i.e. to UPDATE the canonical row
 * rather than create its own). High on purpose: reusing that key is an overwrite.
 */
export const RESPONSE_STANDARD_MATCH_THRESHOLD = 0.9;

/** The stable metadata key of the canonical response-standard memory row. */
export const RESPONSE_STANDARD_MEMORY_KEY = 'response_standard.deep_thorough_reasoning';

/** The user-visible title of the canonical response-standard memory row. */
export const RESPONSE_STANDARD_MEMORY_TITLE = 'Response Standard: Deep Thorough Reasoning';

/** The canonical response-standard body (default of saveResponseStandardMemory). */
export const RESPONSE_STANDARD_DEFAULT_CONTENT =
  'Always reason thoroughly and deeply. Treat every request as complex unless I explicitly say otherwise. Never optimize for brevity at the expense of quality. Think step-by-step, consider tradeoffs, and provide comprehensive analysis.';

/** Phrases that mark "deep reasoning response standard" intent. */
const RESPONSE_STANDARD_RE =
  /\b(reason thoroughly|think step-by-step|consider tradeoffs|comprehensive analysis)\b/;

// ─── Total coercion helpers ─────────────────────────────────────────────────

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function safeRead(source: unknown, key: string): unknown {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return undefined;
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeText(source: unknown, key: string): string {
  return toText(safeRead(source, key));
}

// ─── Normalization / classification (moved verbatim in behavior) ────────────

/** Trim, strip wrapping quotes, collapse whitespace runs. Total. */
export function normalizeRememberContent(content: unknown): string {
  return toText(content)
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, ' ');
}

/** Infer the memory kind from free text. Behavior preserved from memoryService. */
export function inferRememberKind(content: unknown): MemoryKind {
  const lower = toText(content).toLowerCase();

  if (
    /\b(always|never|treat every request|optimi[sz]e for|reason thoroughly|think step-by-step|consider tradeoffs|provide comprehensive analysis)\b/.test(lower) ||
    /\bhow i want you\b/.test(lower)
  ) {
    return 'instruction';
  }

  if (/\b(i prefer|i like|i want|my preference|prefer)\b/.test(lower)) {
    return 'preference';
  }

  if (/\b(decided|decision|we use|our stack|project uses)\b/.test(lower)) {
    return 'decision';
  }

  return 'fact';
}

/**
 * True when the content really is the canonical response-standard instruction
 * (not merely a memory that happens to mention "consider tradeoffs").
 */
export function isCanonicalResponseStandard(content: unknown): boolean {
  const normalized = normalizeRememberContent(content);
  if (!normalized) return false;
  if (!RESPONSE_STANDARD_RE.test(normalized.toLowerCase())) return false;
  return (
    memorySimilarityScore(normalized, RESPONSE_STANDARD_DEFAULT_CONTENT) >=
    RESPONSE_STANDARD_MATCH_THRESHOLD
  );
}

/**
 * Human-readable title for a `/remember` write.
 *
 * FIX: the canonical `Response Standard: …` title is no longer handed to ANY
 * content matching the reasoning regex — that gave unrelated memories identical
 * titles (titleScore 1.0) and fed the destructive duplicate path. Only content
 * that is actually the canonical response standard keeps that exact title;
 * everything else falls through to the kind-derived, content-bearing title.
 */
export function buildRememberTitle(content: unknown, kind: MemoryKind): string {
  const text = toText(content);

  if (isCanonicalResponseStandard(text)) return RESPONSE_STANDARD_MEMORY_TITLE;

  if (kind === 'instruction') return `Instruction: ${text.slice(0, 44)}`.trim();
  if (kind === 'preference') return `Preference: ${text.slice(0, 45)}`.trim();
  if (kind === 'decision') return `Decision: ${text.slice(0, 47)}`.trim();
  return text.slice(0, 60).replace(/\n/g, ' ');
}

/** Lowercase snake slug, capped, never empty. Total. */
export function slugifyMemoryKey(value: unknown): string {
  return (
    toText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, MAX_KEY_SLUG_CHARS) || 'memory'
  );
}

/**
 * Deterministic, dependency-free full-content digest (FNV-1a 32-bit over both
 * bytes of each code unit, salted with the total length). Used ONLY as a key
 * discriminator, never as a security primitive. A collision is harmless unless
 * the kind AND the 80-char slug also match, and only then would two memories
 * share a row — orders of magnitude rarer than the prefix collision it replaces.
 */
export function contentDiscriminator(value: unknown): string {
  const text = toText(value).toLowerCase();
  const scanned = text.length > MAX_DIGEST_CHARS ? text.slice(0, MAX_DIGEST_CHARS) : text;
  let hash = 0x811c9dc5;
  for (let i = 0; i < scanned.length; i += 1) {
    const code = scanned.charCodeAt(i);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((code >>> 8) & 0xff), 0x01000193);
  }
  // Salt with the true (untruncated) length so two giant texts sharing a
  // 100k-char prefix still differ.
  hash = Math.imul(hash ^ (text.length & 0xffff), 0x01000193);
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 7);
}

/**
 * Stable identity key for an explicitly remembered memory. `upsertExplicitMemory`
 * UPDATES the row carrying this key, so two DIFFERENT memories must never share
 * one.
 *
 * FIX: the constant-key branch is now gated on the content actually being the
 * canonical response standard, and every key carries a full-content
 * discriminator so distinct bodies (including ones sharing an 80-char prefix)
 * get distinct keys. Re-saving the SAME text still yields the SAME key, so the
 * intended idempotent "update my memory" behavior is preserved exactly.
 */
export function inferExplicitMemoryKey(content: unknown, kind: MemoryKind): string {
  const normalized = normalizeRememberContent(content);
  const lower = normalized.toLowerCase();

  if (RESPONSE_STANDARD_RE.test(lower)) {
    // Genuinely the canonical response standard → keep the one canonical row.
    if (isCanonicalResponseStandard(normalized)) return RESPONSE_STANDARD_MEMORY_KEY;
    // Same intent family, different content → stable namespace, distinct key.
    return `${RESPONSE_STANDARD_MEMORY_KEY}.${slugifyMemoryKey(normalized.slice(0, 48))}.${contentDiscriminator(normalized)}`;
  }

  return `${kind}.${slugifyMemoryKey(normalized.slice(0, 80))}.${contentDiscriminator(normalized)}`;
}

// ─── Similarity ─────────────────────────────────────────────────────────────

function tokenSet(value: string): Set<string> {
  const out = new Set<string>();
  for (const term of value.split(/\W+/)) {
    if (!term) continue;
    out.add(term);
    if (out.size >= MAX_TOKENS_PER_SIDE) break;
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let overlap = 0;
  for (const term of small) {
    if (large.has(term)) overlap += 1;
  }
  const union = a.size + b.size - overlap;
  return union > 0 ? overlap / union : 0;
}

/**
 * Symmetric 0..1 similarity between two memory strings.
 *
 * Ladder (cheapest first):
 *   1. exact (after lowercase+trim) → 1
 *   2. SUBSTANTIAL containment → 0.5 + 0.5 * lengthRatio. Only when the shorter
 *      side is >= CONTAINMENT_MIN_CHARS and >= CONTAINMENT_MIN_LENGTH_RATIO of
 *      the longer. The linear map is deliberately gentle: ratio 0.60 → 0.80
 *      (below BOTH duplicate thresholds, i.e. still not a duplicate), 0.64 →
 *      0.82 (content-duplicate), 0.76 → 0.88 (title-duplicate), 1.0 → 1.0. So a
 *      "duplicate" by containment must be a statement whose superset adds at
 *      most ~a third more text — a refinement, not a different memory.
 *   3. otherwise Jaccard token overlap (`|A∩B| / |A∪B|`). Symmetric, and a
 *      one-token query can score at most 1/|union|, which kills the old
 *      `overlap / min(size)` overwrite hazard.
 * The result is the MAX of (2) and (3) so a near-identical pair is never
 * penalized by the containment floor.
 */
export function memorySimilarityScore(a: unknown, b: unknown): number {
  const rawA = toText(a).toLowerCase().trim();
  const rawB = toText(b).toLowerCase().trim();
  if (!rawA || !rawB) return 0;
  if (rawA === rawB) return 1;

  const truncated = rawA.length > MAX_COMPARE_CHARS || rawB.length > MAX_COMPARE_CHARS;
  const aa = truncated ? rawA.slice(0, MAX_COMPARE_CHARS) : rawA;
  const bb = truncated ? rawB.slice(0, MAX_COMPARE_CHARS) : rawB;

  let score = jaccard(tokenSet(aa), tokenSet(bb));

  const [shorter, longer] = aa.length <= bb.length ? [aa, bb] : [bb, aa];
  if (
    shorter.length >= CONTAINMENT_MIN_CHARS &&
    longer.length > 0 &&
    shorter.length / longer.length >= CONTAINMENT_MIN_LENGTH_RATIO &&
    longer.includes(shorter)
  ) {
    score = Math.max(score, 0.5 + 0.5 * (shorter.length / longer.length));
  }

  // A prefix-only comparison can never prove identity.
  if (truncated) score = Math.min(score, TRUNCATED_SCORE_CEILING);

  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

// ─── Duplicate selection (the destructive fallback path) ────────────────────

/** Minimal shape the duplicate scan needs from an existing memory row. */
export type DuplicateMemoryCandidate = {
  id?: string | null;
  scope?: string | null;
  user_id?: string | null;
  title?: string | null;
  content?: string | null;
};

export type DuplicateMemoryQuery = {
  title: string;
  content: string;
  scope: string;
  isPrivate: boolean;
  userId?: string | null;
};

export type DuplicateMemoryMatch<T> = {
  memory: T;
  index: number;
  titleScore: number;
  contentScore: number;
  /** Which signal cleared the bar. 'content' wins ties (it is the stronger one). */
  matchedOn: 'content' | 'title';
};

/**
 * Pick the existing memory row that the incoming `/remember` should OVERWRITE,
 * or null to write a new row.
 *
 * Predicate (see threshold comments above):
 *   contentScore >= DUPLICATE_CONTENT_THRESHOLD
 *   OR (titleScore >= DUPLICATE_TITLE_THRESHOLD AND contentScore >= TITLE_MATCH_CONTENT_FLOOR)
 *
 * Scope/ownership filters preserve the previous behavior exactly. Unlike the old
 * `.find()`, the BEST scoring candidate wins (ties → earliest index), so when
 * several rows qualify we overwrite the most-similar one rather than whichever
 * the query happened to return first. Deterministic for a given input order.
 */
export function pickDuplicateMemory<T extends DuplicateMemoryCandidate>(
  candidates: unknown,
  query: unknown,
): DuplicateMemoryMatch<T> | null {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return null;

  const title = safeText(query, 'title');
  const content = safeText(query, 'content');
  const scope = safeText(query, 'scope');
  const userId = safeText(query, 'userId');
  const isPrivate = safeRead(query, 'isPrivate') === true;

  // Never dedupe on nothing: an empty incoming body cannot justify destroying a
  // stored one, and an empty scope cannot be ownership-checked.
  if (!content.trim() || !scope) return null;
  if (isPrivate && !userId) return null;

  let best: DuplicateMemoryMatch<T> | null = null;

  for (let index = 0; index < list.length; index += 1) {
    const candidate = list[index] as T;
    if (!candidate || typeof candidate !== 'object') continue;

    const candidateId = safeText(candidate, 'id').trim();
    if (!candidateId) continue;

    const candidateScope = safeText(candidate, 'scope');
    if (candidateScope !== scope) continue;
    if (isPrivate && safeText(candidate, 'user_id') !== userId) continue;
    if (!isPrivate && candidateScope !== 'circle') continue;

    const titleScore = memorySimilarityScore(safeText(candidate, 'title'), title);
    const contentScore = memorySimilarityScore(safeText(candidate, 'content'), content);

    const contentMatch = contentScore >= DUPLICATE_CONTENT_THRESHOLD;
    const titleMatch =
      titleScore >= DUPLICATE_TITLE_THRESHOLD && contentScore >= TITLE_MATCH_CONTENT_FLOOR;
    if (!contentMatch && !titleMatch) continue;

    const match: DuplicateMemoryMatch<T> = {
      memory: candidate,
      index,
      titleScore,
      contentScore,
      matchedOn: contentMatch ? 'content' : 'title',
    };

    if (!best || rankOf(match) > rankOf(best)) best = match;
  }

  return best;
}

function rankOf(match: DuplicateMemoryMatch<unknown>): number {
  return Math.max(match.contentScore, match.titleScore);
}
