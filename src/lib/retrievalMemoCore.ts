// retrievalMemoCore — a PURE memo key + a tiny in-module promise/value cache so
// the per-turn query embed + memory rank happens ONCE instead of twice.
//
// THE COST THIS EXISTS FOR (memory opt v7): in
// `src/lib/memoryService.ts` the prompt-build Promise.all wave (~1139) fires
// BOTH `loadSoulWisdomWithFallback(...)` (which, on a cache miss, synthesizes
// soul wisdom by embedding + ranking the SAME `opts.query`) AND
// `retrieveForTurn(...)` (which embeds + ranks that identical query again) in the
// SAME wave. So one user turn embeds + ranks the same query TWICE — two embedding
// round-trips and two rank passes for one message. This module lets the second
// caller reuse the first caller's scored result within a short TTL, keyed by the
// normalized (query, circle, user, soul, surface) tuple.
//
// WIRING (do this in memoryService.ts `retrieveForTurn`):
//   const memoKey = buildRetrievalMemoKey({
//     queryText: opts.queryText, circleId: opts.circleId, userId: opts.userId,
//     activeSoulKey: opts.activeSoulKey, surface: opts.surface,
//   });
//   const now = Date.now();
//   const cached = memoKey ? getMemoized(memoKey, now) : undefined;
//   const scored: RetrievedMemory[] = Array.isArray(cached)
//     ? (cached as RetrievedMemory[])
//     : /* …existing embed → RPC → rank producing `scored` (pre-slice)… */;
//   if (memoKey && !Array.isArray(cached)) setMemoized(memoKey, scored, now);
//   // then the existing finalCount/budgetChars slice + format proceeds on `scored`.
// Store the PRE-SLICE `scored[]` (not `kept`) so callers with different
// finalCount/budgetChars still reuse the same ranking. `Date.now()` is passed IN
// (this module is deterministic; the caller owns the clock).
//
// PURITY / SAFETY CONTRACT:
//   - ZERO runtime imports (tsx/esbuild-loadable; no react-native/supabase). No
//     Date.now()/Math.random() at module scope — the only module state is one
//     bounded Map used as an LRU.
//   - Every export is TOTAL: null / undefined / wrong-type / huge / hostile
//     (throwing getters, Proxies) input never throws. buildRetrievalMemoKey
//     resolves to the '' uncacheable sentinel; the cache ops become no-ops /
//     misses. Output is bounded (key length capped; Map size capped at MAX).
//   - BIAS = fail toward NOT caching. An empty/whitespace/non-string query, a
//     hostile input, or an un-anchorable clock all yield '' / a miss, so the turn
//     simply recomputes (correct, just not deduped). A false cache HIT would
//     serve a stale ranking, so on ANY ambiguity we prefer the miss.

/** Default freshness window for a memoized ranking: 30s comfortably spans one
 *  Promise.all wave while never surviving into a later turn. */
export const RETRIEVAL_MEMO_TTL_MS = 30_000;

/** Bounded LRU capacity. A turn memoizes exactly one entry; 64 leaves ample room
 *  for interleaved concurrent turns/surfaces without unbounded growth. */
export const RETRIEVAL_MEMO_MAX = 64;

/** '' is the uncacheable sentinel returned by buildRetrievalMemoKey and rejected
 *  by every cache op — an empty/invalid query is never stored. */
const UNCACHEABLE = '';

/** Key version tag: lets a future key-shape change invalidate old entries and
 *  keeps the key unmistakably distinct from the '' sentinel. */
const KEY_VERSION = 'rm1:';

/** Cap the query contribution so a hostile 10MB message can't produce a 10MB Map
 *  key. Real turn queries are far shorter; two distinct queries sharing a 2048-char
 *  prefix inside a 30s window is not a realistic collision. */
const MAX_QUERY_LEN = 2048;

/** Cap each identity field (circle/user/soul/surface). UUIDs / surface slugs are
 *  tiny; this only bounds hostile input. */
const MAX_FIELD_LEN = 256;

// ── key construction ─────────────────────────────────────────────────────────

/**
 * Normalize the query into its cache-key form: STRING-ONLY (a non-string query
 * is not a real query → uncacheable), capped, whitespace-collapsed, trimmed,
 * lowercased. Returns '' for empty/whitespace/non-string so the caller emits the
 * uncacheable sentinel.
 */
function normalizeQuery(v: unknown): string {
  if (typeof v !== 'string') return '';
  const capped = v.length > MAX_QUERY_LEN ? v.slice(0, MAX_QUERY_LEN) : v;
  return capped.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Normalize an identity field (circle/user/soul/surface). Strings and primitive
 * ids (number/boolean/bigint) coerce to a trimmed, capped string; null/undefined
 * and non-identifier types (symbol/function/object) become '' (an absent tag).
 * Never throws.
 */
function normalizeField(v: unknown): string {
  try {
    if (v === null || v === undefined) return '';
    const t = typeof v;
    let s: string;
    if (t === 'string') s = v as string;
    else if (t === 'number' || t === 'boolean' || t === 'bigint') s = String(v);
    else return '';
    if (s.length > MAX_FIELD_LEN) s = s.slice(0, MAX_FIELD_LEN);
    return s.trim();
  } catch {
    return '';
  }
}

/**
 * Build a stable, normalized cache key for a turn's retrieval. Same inputs →
 * same key; a different circle / user / soul / surface → a different key. An
 * empty/whitespace/non-string query, or any hostile input (throwing getter /
 * Proxy / non-object), yields the '' uncacheable sentinel.
 *
 * The five normalized parts are JSON-encoded (an array of strings, which never
 * throws and escapes internal delimiters) so no field value can forge a boundary
 * and collide with a different tuple.
 */
export function buildRetrievalMemoKey(input: {
  queryText: unknown;
  circleId: unknown;
  userId: unknown;
  activeSoulKey: unknown;
  surface: unknown;
}): string {
  try {
    if (input === null || typeof input !== 'object') return UNCACHEABLE;
    const record = input as Record<string, unknown>;
    const q = normalizeQuery(record.queryText);
    if (!q) return UNCACHEABLE;
    const c = normalizeField(record.circleId);
    const u = normalizeField(record.userId);
    const s = normalizeField(record.activeSoulKey);
    const f = normalizeField(record.surface);
    return KEY_VERSION + JSON.stringify([q, c, u, s, f]);
  } catch {
    return UNCACHEABLE;
  }
}

// ── the bounded LRU value cache ──────────────────────────────────────────────

/** Module-scoped store. Map insertion order IS the LRU order: a hit re-inserts
 *  (most-recently-used); eviction drops the front (least-recently-used). `at` is
 *  the store time, used only for TTL — a hit does NOT extend it. */
const memoStore = new Map<string, { at: number; value: unknown }>();

/** A finite millisecond clock value, or null if the caller passed garbage. */
function toFiniteMs(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Resolve the effective TTL: a finite, non-negative override, else the default.
 *  A ttl of 0 is honored (every entry reads as immediately expired). */
function normalizeTtl(ttlMs: unknown): number {
  return typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs >= 0
    ? ttlMs
    : RETRIEVAL_MEMO_TTL_MS;
}

/**
 * Read a memoized value. Returns the stored value on a fresh hit (and promotes it
 * to most-recently-used without extending its TTL), or undefined on: the ''/
 * invalid key, an absent entry, a garbage clock, or an entry at/after its TTL
 * (which is also evicted). TTL is measured as `nowMs - at >= ttl` → expired, so
 * exactly-TTL is a miss. Never throws.
 */
export function getMemoized(key: string, nowMs: number, ttlMs?: number): unknown | undefined {
  try {
    if (typeof key !== 'string' || key === UNCACHEABLE) return undefined;
    const entry = memoStore.get(key);
    if (!entry) return undefined;
    const now = toFiniteMs(nowMs);
    if (now === null) return undefined;
    const ttl = normalizeTtl(ttlMs);
    if (now - entry.at >= ttl) {
      memoStore.delete(key);
      return undefined;
    }
    // LRU promote: re-insert to move to the back, preserving the original `at`.
    memoStore.delete(key);
    memoStore.set(key, entry);
    return entry.value;
  } catch {
    return undefined;
  }
}

/**
 * Store a value under `key`, anchored at `nowMs`, as most-recently-used, then
 * evict least-recently-used entries while over RETRIEVAL_MEMO_MAX. No-ops on the
 * ''/invalid key or a garbage clock (behaving as no-cache). Never throws.
 */
export function setMemoized(key: string, value: unknown, nowMs: number): void {
  try {
    if (typeof key !== 'string' || key === UNCACHEABLE) return;
    const now = toFiniteMs(nowMs);
    if (now === null) return;
    if (memoStore.has(key)) memoStore.delete(key);
    memoStore.set(key, { at: now, value });
    while (memoStore.size > RETRIEVAL_MEMO_MAX) {
      const oldest = memoStore.keys().next().value;
      if (oldest === undefined) break;
      memoStore.delete(oldest);
    }
  } catch {
    // never throw
  }
}

/** Drop every memoized entry. Safe to call anytime (e.g. on sign-out / tests). */
export function clearRetrievalMemo(): void {
  try {
    memoStore.clear();
  } catch {
    // never throw
  }
}

/** Current number of live entries (observability / tests). Never throws. */
export function retrievalMemoSize(): number {
  try {
    return memoStore.size;
  } catch {
    return 0;
  }
}
