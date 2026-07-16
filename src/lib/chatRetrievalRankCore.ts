/**
 * chatRetrievalRankCore — the pure "rank + dedup the COMBINED retrieval set"
 * step that optimizes context QUALITY under a tight budget.
 *
 * COMPLEMENTS memoryTurnAssemblyCore (which decides WHICH memory passes run this
 * turn — startup / retrieval / wisdom — without running any twice). Once those
 * passes have run, the memory fan-out in swanbot.ts / openswanMemoryStores.ts
 * ends up with ONE combined bag of retrieved items drawn from several stores:
 *
 *   - user-authored notes            (openswanMemoryStores.ts → userNotes)
 *   - system-inferred user profile   (openswanMemoryStores.ts → userProfile)
 *   - circle/room/agent/session      (formatRuntimeMemory)
 *   - startup memory                 (loadStartupMemory)
 *   - semantic working memory        (memoryService.retrieveForTurn →
 *                                     RetrievedMemory[], memoryService.ts:725)
 *
 * Those sources overlap: the same fact is frequently written by the user AND
 * inferred into a profile row AND surfaced by semantic recall, so the naive
 * concatenation both (a) burns the char budget on near-duplicates and (b) lets a
 * low-value late source push a high-value one out when the budget is small.
 * openswanMemoryStores already hand-rolls a narrow 40-char-prefix dedup between
 * two of those stores (formatUserProfile, lines 41-50); this core generalizes
 * that to the WHOLE combined set and adds a single, deterministic ranking so the
 * BEST context survives a tight budget instead of whatever happened to be first.
 *
 * The ranking mirrors the live scorer in memoryService.retrieveForTurn
 * (memoryService.ts:958-996): a base relevance score, a 30-day half-life recency
 * decay floored so old-but-relevant memories aren't banned
 * (`base * (0.6 + 0.4 * recencyFactor)`), plus a small additive source-trust
 * boost in the spirit of its soul/pinned/importance boosts. It does NOT re-embed
 * anything (that already happened upstream); it only re-orders + de-dups the
 * item bag those passes produced, so it is cheap and runs on every turn.
 *
 * Field mapping (RetrievalItem ← the real shapes it is fed):
 *   - id        ← RetrievedMemory.id / PromptMemoryReference.id / MemoryEntry.id
 *   - text      ← RetrievedMemory.content / MemoryEntry.content (the payload)
 *   - score     ← RetrievedMemory.score / PromptMemoryReference.score
 *                 (post-boost final ranking score; optional)
 *   - source    ← RetrievedMemory.scope / a store label / a bridge source
 *   - recencyMs ← updated_at/created_at rendered to epoch ms (optional)
 *
 * PURITY: zero imports (loads under tsx); no Date.now()/Math.random() — the
 * "now" reference is injected via opts.nowMs or derived from the newest item, so
 * ranking is deterministic; every export is TOTAL (null / undefined / wrong-type
 * / huge / hostile getters / cyclic → safe neutral, never throws); bounded (input
 * count, per-text scan length, token counts, output size all capped); secret-safe
 * (item text is only ever normalized internally for dedup keys — never logged,
 * echoed into an error, or embedded in a reason string; returned items carry only
 * the caller's own values).
 */

export interface RetrievalItem {
  id: string;
  text: string;
  score?: number;
  source?: string;
  recencyMs?: number;
}

export interface RankRetrievalOptions {
  /** Hard cap on returned items (post-dedup). Default 12 (retrieveForTurn's
   *  finalCount). <=0 → []; huge → clamped to MAX_OUTPUT_ITEMS. */
  maxItems?: number;
  /** Optional query terms for a lexical-overlap relevance nudge. A raw string
   *  (tokenized) or an array of tokens; anything else → ignored. */
  queryTokens?: unknown;
  /** Reference "now" (epoch ms) for recency decay. Omitted → the newest item's
   *  recencyMs is used as the reference (relative recency), so ordering is
   *  deterministic without a clock. */
  nowMs?: number;
  /** Recency half-life in ms. Omitted/invalid → 30 days (retrieveForTurn's
   *  recencyHalfLifeDays). */
  halfLifeMs?: number;
}

// ── Bounds (single source of truth; exported defaults reference these) ────────
const MAX_INPUT_ITEMS = 2000;
const DEFAULT_MAX_ITEMS = 12; // == TURN_RETRIEVAL_DEFAULTS.finalCount
const MAX_OUTPUT_ITEMS = 200;
const RECENCY_HALFLIFE_MS = 30 * 24 * 60 * 60 * 1000; // == recencyHalfLifeDays: 30
const RECENCY_FLOOR = 0.6; // == the 0.6 in `0.6 + 0.4 * recencyFactor`
const JACCARD_DUP_THRESHOLD = 0.9; // near-identical paraphrase cutoff (strict → few false drops)
const MIN_JACCARD_TOKENS = 6; // both texts must carry >=6 meaningful tokens for a Jaccard verdict
const SIG_CHARS = 140; // shared-prefix dedup window (generalizes the 40-char one)
const MAX_TEXT_SCAN = 4000; // cap chars scanned for normalize/tokenize
const MAX_TEXT_OUT = 20000; // cap chars in a returned item's text
const MAX_ID_CHARS = 200;
const MAX_SOURCE_CHARS = 64;
const MAX_TOKENS = 60; // cap tokens per item for Jaccard
const MIN_TOKEN_LEN = 2;
const MAX_QUERY_TOKENS = 40;
const COMPARE_WINDOW = 256; // cap kept-item Jaccard comparisons (bounds O(n^2))
const OVERLAP_WEIGHT = 0.3; // weight of the lexical-overlap nudge
const SCORE_CLAMP = 1e6;

export const RETRIEVAL_RANK_DEFAULTS = {
  maxItems: DEFAULT_MAX_ITEMS,
  halfLifeMs: RECENCY_HALFLIFE_MS,
  recencyFloor: RECENCY_FLOOR,
  jaccardDupThreshold: JACCARD_DUP_THRESHOLD,
  minJaccardTokens: MIN_JACCARD_TOKENS,
  maxInputItems: MAX_INPUT_ITEMS,
  maxOutputItems: MAX_OUTPUT_ITEMS,
} as const;

type NormItem = RetrievalItem & { _idx: number };

// ── Coercion helpers (total) ──────────────────────────────────────────────────

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

function toBoundedString(v: unknown, max: number): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else if (typeof v === 'bigint') s = v.toString();
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else return '';
  return s.length > max ? s.slice(0, max) : s;
}

function clampScore(n: number | undefined): number | undefined {
  if (n === undefined) return undefined;
  if (n > SCORE_CLAMP) return SCORE_CLAMP;
  if (n < -SCORE_CLAMP) return -SCORE_CLAMP;
  return n;
}

/**
 * Additive source-trust boost, in the spirit of retrieveForTurn's soul/pinned/
 * importance boosts. Ordered so the highest-signal stores (user-authored notes,
 * explicitly-fresh startup memory, durable circle memory) outrank fire-and-forget
 * session chatter when relevance + recency tie. Unknown source → neutral (0).
 * `source` is expected pre-normalized (lowercased/trimmed).
 */
function sourceTrust(source: string | undefined): number {
  if (!source) return 0;
  const s = source;
  // user-authored notes — user told us directly (openswanMemoryStores: first).
  if (s === 'user' || s === 'notes' || s.includes('user_note') || s.includes('usernote') || s.includes('user_mem')) return 0.25;
  // startup memory — explicitly kept fresh (retrieveForTurn startup boost 0.25).
  if (s.includes('startup')) return 0.2;
  // durable circle operating/runtime memory.
  if (s.includes('circle')) return 0.15;
  // system-inferred user profile (lower than user-authored notes).
  if (s.includes('profile')) return 0.14;
  if (s === 'org' || s.includes('org')) return 0.12;
  // external coding-agent bridges (claude_code/codex/cursor/gemini).
  if (s.includes('bridge') || s.includes('claude_code') || s.includes('codex') || s.includes('cursor') || s.includes('gemini')) return 0.1;
  if (s.includes('agent')) return 0.1;
  if (s.includes('room')) return 0.08;
  // semantic working-memory recall / on-demand.
  if (s.includes('retriev') || s.includes('working') || s.includes('semantic') || s.includes('on_demand') || s.includes('ondemand')) return 0.05;
  // session scope — fire-and-forget, lowest durable trust.
  if (s.includes('session')) return 0.02;
  return 0;
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeOne(raw: unknown, index: number): NormItem | null {
  // A bare string is treated as the item's text (lenient).
  if (typeof raw === 'string') {
    const text = toBoundedString(raw, MAX_TEXT_OUT);
    if (text.trim() === '') return null;
    return { id: `r${index}`, text, _idx: index };
  }
  if (raw === null || typeof raw !== 'object') return null;
  try {
    const obj = raw as Record<string, unknown>;
    const text = toBoundedString(obj.text ?? obj.content ?? '', MAX_TEXT_OUT);
    if (text.trim() === '') return null; // no payload → carries no context
    let id = toBoundedString(obj.id ?? '', MAX_ID_CHARS).trim();
    if (id === '') id = `r${index}`;
    const item: NormItem = { id, text, _idx: index };
    const score = clampScore(toFiniteNumber(obj.score));
    if (score !== undefined) item.score = score;
    const source = toBoundedString(obj.source ?? obj.scope ?? '', MAX_SOURCE_CHARS).trim().toLowerCase();
    if (source !== '') item.source = source;
    const rec = toFiniteNumber(obj.recencyMs ?? obj.recency);
    if (rec !== undefined && rec >= 0) item.recencyMs = rec;
    return item;
  } catch {
    // Hostile getter / proxy that throws on property access → drop this item.
    return null;
  }
}

function normalizeInternal(items: unknown): NormItem[] {
  if (!Array.isArray(items)) return [];
  const out: NormItem[] = [];
  const limit = items.length > MAX_INPUT_ITEMS ? MAX_INPUT_ITEMS : items.length;
  for (let i = 0; i < limit; i++) {
    let raw: unknown;
    try {
      raw = items[i];
    } catch {
      continue; // hostile array index getter
    }
    const n = normalizeOne(raw, i);
    if (n) out.push(n);
  }
  return out;
}

function strip(it: NormItem): RetrievalItem {
  const out: RetrievalItem = { id: it.id, text: it.text };
  if (it.score !== undefined) out.score = it.score;
  if (it.source !== undefined) out.source = it.source;
  if (it.recencyMs !== undefined) out.recencyMs = it.recencyMs;
  return out;
}

/** Coerce an arbitrary bag into bounded, sanitized RetrievalItems (no ranking,
 *  no dedup). Input order preserved; junk dropped. Total. */
export function normalizeRetrievalItems(items: unknown): RetrievalItem[] {
  try {
    return normalizeInternal(items).map(strip);
  } catch {
    return [];
  }
}

// ── Text normalization + similarity (for dedup) ───────────────────────────────

function normText(text: string): string {
  const scan = text.length > MAX_TEXT_SCAN ? text.slice(0, MAX_TEXT_SCAN) : text;
  // Lowercase, collapse every run of non-alphanumerics (unicode-aware) to a
  // single space, trim edges. Never surfaced — internal dedup key only.
  return scan.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokenSet(norm: string): Set<string> {
  const set = new Set<string>();
  if (norm === '') return set;
  const parts = norm.split(' ');
  for (let i = 0; i < parts.length && set.size < MAX_TOKENS; i++) {
    const p = parts[i];
    if (p.length >= MIN_TOKEN_LEN) set.add(p);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of small) if (large.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Walk `items` in the given order and keep only the first representative of each
 * near-duplicate cluster (so when the list is pre-ranked, the higher-ranked one
 * survives). Three signals, cheapest first:
 *   1. exact normalized-text match (Set lookup),
 *   2. identical leading SIG_CHARS for long texts (Set lookup),
 *   3. token-set Jaccard >= threshold vs a bounded window of kept items.
 * Stops once `maxKeep` items are kept. Bounded + total.
 */
function dedupCore(items: NormItem[], maxKeep: number, useJaccard: boolean): NormItem[] {
  const kept: NormItem[] = [];
  const seenNorm = new Set<string>();
  const seenSig = new Set<string>();
  const keptTokens: Set<string>[] = [];
  for (let i = 0; i < items.length; i++) {
    if (kept.length >= maxKeep) break;
    const it = items[i];
    const norm = normText(it.text);
    // Punctuation/emoji-only text normalizes to '' — fall back to the raw
    // lowercased form as the exact-dup key so distinct symbols stay distinct.
    const key = norm !== '' ? norm : it.text.trim().toLowerCase().slice(0, SIG_CHARS);
    if (key === '') { kept.push(it); continue; }
    if (seenNorm.has(key)) continue;
    const hasSig = norm.length >= SIG_CHARS;
    const sig = hasSig ? norm.slice(0, SIG_CHARS) : '';
    if (hasSig && seenSig.has(sig)) continue;
    if (useJaccard && norm !== '') {
      const tokens = tokenSet(norm);
      // Only substantial texts get a Jaccard verdict. Short/boilerplate items
      // (e.g. a title that reduces to one shared scaffolding word, or whose only
      // distinguishing token is a dropped 1-char digit) would otherwise collapse
      // distinct context — so we require >=MIN_JACCARD_TOKENS on BOTH sides and
      // rely on exact-normalized / shared-prefix dedup for the short ones.
      if (tokens.size >= MIN_JACCARD_TOKENS) {
        let dup = false;
        const from = keptTokens.length > COMPARE_WINDOW ? keptTokens.length - COMPARE_WINDOW : 0;
        for (let j = keptTokens.length - 1; j >= from; j--) {
          if (jaccard(tokens, keptTokens[j]) >= JACCARD_DUP_THRESHOLD) { dup = true; break; }
        }
        if (dup) continue;
        keptTokens.push(tokens); // pool holds only eligible (>=MIN) token sets
      }
    }
    seenNorm.add(key);
    if (hasSig) seenSig.add(sig);
    kept.push(it);
  }
  return kept;
}

/** Dedup near-identical texts, preserving input order and keeping the first
 *  occurrence of each cluster (for a pre-ranked list, that is the higher-ranked
 *  one). Total. */
export function dedupeRetrieval(items: unknown): RetrievalItem[] {
  try {
    const normalized = normalizeInternal(items);
    return dedupCore(normalized, MAX_INPUT_ITEMS, true).map(strip);
  } catch {
    return [];
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function recencyFactor(recencyMs: number | undefined, refNow: number, halfLife: number): number {
  if (recencyMs === undefined) return 1; // no recency info → don't penalize
  if (!Number.isFinite(refNow) || halfLife <= 0) return 1;
  const age = refNow - recencyMs;
  if (age <= 0) return 1; // as recent as / newer than the reference
  const f = Math.exp(-Math.LN2 * (age / halfLife));
  if (!Number.isFinite(f)) return 1;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

function scoreItem(it: NormItem, refNow: number, halfLife: number, queryTokens: Set<string> | null): number {
  const relevance = it.score ?? 0;
  const trust = sourceTrust(it.source);
  let overlap = 0;
  if (queryTokens && queryTokens.size > 0) {
    const toks = tokenSet(normText(it.text));
    if (toks.size > 0) {
      let hits = 0;
      for (const q of queryTokens) if (toks.has(q)) hits += 1;
      overlap = (hits / queryTokens.size) * OVERLAP_WEIGHT;
    }
  }
  const base = relevance + trust + overlap;
  const rf = recencyFactor(it.recencyMs, refNow, halfLife);
  const mult = RECENCY_FLOOR + (1 - RECENCY_FLOOR) * rf; // 0.6 .. 1.0
  const combined = base * mult;
  if (Number.isFinite(combined)) return combined;
  return Number.isFinite(relevance) ? relevance : 0;
}

function resolveMaxItems(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === undefined) return DEFAULT_MAX_ITEMS;
  if (n <= 0) return 0;
  const f = Math.floor(n);
  return f > MAX_OUTPUT_ITEMS ? MAX_OUTPUT_ITEMS : f;
}

function resolveHalfLife(v: unknown): number {
  const n = toFiniteNumber(v);
  return n === undefined || n <= 0 ? RECENCY_HALFLIFE_MS : n;
}

function resolveRefNow(nowMs: unknown, items: NormItem[]): number {
  const n = toFiniteNumber(nowMs);
  if (n !== undefined) return n;
  // No injected clock → newest item is the reference (relative recency).
  let max = -Infinity;
  for (const it of items) {
    if (it.recencyMs !== undefined && it.recencyMs > max) max = it.recencyMs;
  }
  return max === -Infinity ? 0 : max;
}

function resolveQueryTokens(v: unknown): Set<string> | null {
  try {
    if (v === null || v === undefined) return null;
    const raw: string[] = [];
    if (typeof v === 'string') {
      const parts = v.toLowerCase().split(/[^\p{L}\p{N}]+/u);
      for (const p of parts) if (p) raw.push(p);
    } else if (Array.isArray(v)) {
      const lim = v.length > MAX_QUERY_TOKENS * 4 ? MAX_QUERY_TOKENS * 4 : v.length;
      for (let i = 0; i < lim; i++) {
        const el = v[i];
        if (typeof el === 'string') {
          const t = el.trim().toLowerCase();
          if (t) raw.push(t);
        } else if (typeof el === 'number' && Number.isFinite(el)) {
          raw.push(String(el));
        }
      }
    } else {
      return null;
    }
    const set = new Set<string>();
    for (let i = 0; i < raw.length && set.size < MAX_QUERY_TOKENS; i++) {
      if (raw[i].length >= MIN_TOKEN_LEN) set.add(raw[i]);
    }
    return set.size > 0 ? set : null;
  } catch {
    return null;
  }
}

/**
 * Rank the COMBINED retrieval set best-first, dedup near-identical texts (keeping
 * the higher-ranked), and cap to maxItems — so a tight char budget keeps the best
 * context, not whatever store happened to be concatenated first.
 *
 * Ranking key (desc): combined = (relevance + source-trust + lexical-overlap)
 * × (0.6 + 0.4 × recencyDecay). Deterministic and stable — ties break by recency
 * (newer first) then original position. Returned items preserve the caller's own
 * field values (id/text/score/source/recencyMs); ORDER encodes the ranking, so
 * re-ranking the output is idempotent. Never throws.
 */
export function rankRetrievalForTurn(items: unknown, opts?: RankRetrievalOptions): RetrievalItem[] {
  try {
    const normalized = normalizeInternal(items);
    if (normalized.length === 0) return [];
    const maxItems = resolveMaxItems(opts ? opts.maxItems : undefined);
    if (maxItems <= 0) return [];
    const halfLife = resolveHalfLife(opts ? opts.halfLifeMs : undefined);
    const refNow = resolveRefNow(opts ? opts.nowMs : undefined, normalized);
    const queryTokens = resolveQueryTokens(opts ? opts.queryTokens : undefined);

    const scored = normalized.map((it) => ({ it, combined: scoreItem(it, refNow, halfLife, queryTokens) }));
    scored.sort((a, b) => {
      if (b.combined !== a.combined) return b.combined - a.combined;
      const ar = a.it.recencyMs;
      const br = b.it.recencyMs;
      if (ar !== br) {
        if (ar === undefined) return 1;
        if (br === undefined) return -1;
        return br - ar; // newer first
      }
      return a.it._idx - b.it._idx; // stable
    });

    const ranked = scored.map((s) => s.it);
    return dedupCore(ranked, maxItems, true).map(strip);
  } catch {
    return [];
  }
}
