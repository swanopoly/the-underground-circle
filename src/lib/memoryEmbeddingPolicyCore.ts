/**
 * memoryEmbeddingPolicyCore — the PURE decision layer behind semantic memory
 * coverage (`src/lib/memoryEmbeddings.ts`).
 *
 * WHY THIS FILE EXISTS (a verified coverage hole, not a refactor):
 * `match_memories` filters `AND m.embedding IS NOT NULL`, so an un-embedded row
 * is INVISIBLE to every semantic retrieval path in the app. Before this core:
 *
 *  (1) NO EMBED ON WRITE. `embedAndStoreMemory` had exactly two call sites, both
 *      inside `agentMemory.autoExtractAndSave`. The real chokepoint —
 *      `agentRunSystem.saveMemory`, which every `memory_entries` insert in the
 *      client funnels through (save_memory tool, MemoryViewer quick-save,
 *      `saveMemoryWithContext`, `upsertExplicitMemory`, `upsertAgentMemoryTarget`,
 *      `/remember`) — never embedded anything. Semantic recall could only ever
 *      see rows from one path.
 *
 *  (2) NO REPAIR. `backfillMemoryEmbeddings` had ZERO callers anywhere in
 *      `src/`, `supabase/` or `scripts/`. There was no mechanism, anywhere, that
 *      could turn a null embedding into a real one after the fact.
 *
 *  (3) ORPHANS ARE PERMANENT. The fire-and-forget circuit breaker opens after 5
 *      consecutive proxy failures and stays open for 5 minutes. Every memory
 *      saved in that window got a null embedding and was never retried — one
 *      proxy outage silently and permanently deleted those rows from semantic
 *      retrieval. Only a repeatable sweep over `embedding IS NULL` can undo it.
 *
 * DESIGN BIAS — A DEGRADED MEMORY BEATS A LOST MEMORY.
 * Embedding is an ENRICHMENT of a row that is already durably saved. Nothing in
 * this core, and nothing driven by it, may ever be positioned so that an
 * embedding failure can fail a memory write. Every decision here therefore
 * resolves ambiguity toward "skip this row, the sweep will catch it later"
 * rather than "retry hard" or "throw". The `embedding IS NULL` predicate in the
 * database — not any in-process queue — is the durable source of truth for what
 * still needs work; the queue is only a latency/cost optimization on top of it.
 *
 * PURITY / SAFETY CONTRACT:
 *   - Type-only imports (no supabase / react-native) → loads under `npx tsx`.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`; identical
 *     input → identical output. Callers pass `nowMs`.
 *   - TOTAL: every export tolerates null/undefined/wrong-type/cyclic/throwing-
 *     getter/huge input and returns a safe bounded value instead of throwing.
 *   - IMMUTABLE: state transitions return NEW objects; inputs are never mutated.
 *   - MONOTONIC: the repair cursor can only ever move forward, which is what
 *     makes "run it again, as often as you like" safe and terminating.
 *
 * Smoke: `npx tsx scripts/memory-embedding-policy-core-smoketest.ts`
 */

// ─── Bounds and thresholds (single source of truth) ──────────────────────────

/**
 * Max inputs per embed-proxy request. OpenAI accepts more, but bigger batches
 * mean bigger responses and a longer window in which a single failure orphans
 * every member of the batch.
 */
export const EMBEDDING_BATCH_MAX = 50;

/** Chars sent per row (title + content). Bounds per-row embedding spend. */
export const EMBEDDING_INPUT_MAX_CHARS = 30000;

/**
 * Max rows held in the in-process embed-on-write queue. Overflow is DROPPED,
 * not retried in memory: a dropped row still has `embedding IS NULL`, so the
 * repair sweep is guaranteed to find it. Bounded memory beats a queue that can
 * grow without limit during an outage.
 */
export const EMBEDDING_QUEUE_MAX = 500;

/** Debounce window for the write-path drain — coalesces bursts into one call. */
export const EMBEDDING_COALESCE_MS = 250;

/** Consecutive proxy failures before the breaker opens. Matches legacy value. */
export const EMBEDDING_BREAKER_THRESHOLD = 5;

/** Breaker cooldown. Matches the legacy BACKOFF_RESET_MS exactly. */
export const EMBEDDING_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

/** Retry backoff bounds (deterministic, no jitter — jitter needs randomness). */
export const EMBEDDING_RETRY_BASE_DELAY_MS = 1000;
export const EMBEDDING_RETRY_MAX_DELAY_MS = 60 * 1000;

/** Rows fetched per repair page. */
export const REPAIR_PAGE_SIZE_DEFAULT = 100;
export const REPAIR_PAGE_SIZE_MAX = 500;

/** Pages per repair pass. Bounds one invocation; the cursor resumes the rest. */
export const REPAIR_MAX_PAGES_DEFAULT = 5;
export const REPAIR_MAX_PAGES_MAX = 200;

/** Minimum wall-clock gap between automatic repair passes in one session. */
export const REPAIR_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Idle re-sweep cadence once nothing is known to be owed. */
export const REPAIR_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Serialized cursor format version — parse rejects anything else. */
export const REPAIR_CURSOR_VERSION = 1;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A `memory_entries` row as seen by the embedding layer. All fields hostile. */
export interface EmbeddableMemoryRow {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  /** Non-empty ⇒ already embedded. PostgREST returns pgvector as a string. */
  embedding?: unknown;
  embedding_model?: unknown;
  embedded_at?: unknown;
  is_active?: unknown;
}

/** One unit of embedding work: a row id plus the exact text to embed. */
export interface EmbeddingJob {
  id: string;
  text: string;
}

export type EmbeddingSkipReason =
  | 'missing_id'
  | 'empty_text'
  | 'inactive'
  | 'already_embedded'
  | 'duplicate_id';

export type EmbeddingEligibleReason = 'eligible' | 'model_changed' | 'content_changed';

export type EmbeddingEligibility =
  | { eligible: true; id: string; text: string; reason: EmbeddingEligibleReason }
  | { eligible: false; id: string; text: string; reason: EmbeddingSkipReason };

export interface EmbeddingEligibilityOptions {
  /** Model the runtime is about to embed with (for model-migration detection). */
  targetModel?: string;
  /** Re-embed rows whose stored `embedding_model` differs from `targetModel`. */
  reembedOnModelChange?: boolean;
  /**
   * WRITE PATH ONLY. The caller just changed this row's title/content, so any
   * stored vector is STALE and must be replaced. The repair sweep never sets
   * this — it must never spend money re-embedding an already-covered row.
   */
  allowReembed?: boolean;
  /** Skip rows with `is_active === false`. Default true. */
  requireActive?: boolean;
}

// ─── Total coercion helpers (private) ────────────────────────────────────────

function safeText(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'bigint') return String(value);
    return '';
  } catch {
    return '';
  }
}

function safeRead(row: unknown, key: string): unknown {
  if (!row || typeof row !== 'object') return undefined;
  try {
    return (row as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = finiteOr(value, Number.NaN);
  if (!Number.isFinite(n)) return fallback;
  const floored = Math.floor(n);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

// ─── Text + identity ─────────────────────────────────────────────────────────

/** Trim + collapse nothing (embedding models want the real text), just bound it. */
export function normalizeEmbeddingText(value: unknown, maxChars: number = EMBEDDING_INPUT_MAX_CHARS): string {
  const raw = safeText(value);
  if (!raw) return '';
  const cap = clampInt(maxChars, 1, EMBEDDING_INPUT_MAX_CHARS, EMBEDDING_INPUT_MAX_CHARS);
  const trimmed = raw.trim();
  return trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
}

/**
 * The exact text stored rows are embedded from: `title\ncontent`, bounded.
 * An empty result means "there is nothing here worth an embedding call".
 */
export function buildEmbeddingInput(
  row: { title?: unknown; content?: unknown } | null | undefined,
  maxChars: number = EMBEDDING_INPUT_MAX_CHARS,
): string {
  const title = safeText(safeRead(row, 'title')).trim();
  const content = safeText(safeRead(row, 'content')).trim();
  const joined = title && content ? `${title}\n${content}` : title || content;
  return normalizeEmbeddingText(joined, maxChars);
}

/** A usable `memory_entries` id: a non-empty trimmed string. */
export function normalizeMemoryId(value: unknown): string {
  const raw = safeText(value).trim();
  return raw ? raw.slice(0, 128) : '';
}

/**
 * Does this row already carry a vector? PostgREST hands pgvector back as the
 * string `"[0.1,0.2,...]"`, but a client-side row may hold a real array — both
 * count. `null`, `''`, `'[]'` and `[]` do NOT.
 */
export function hasStoredEmbedding(value: unknown): boolean {
  try {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') {
      const t = value.trim();
      return t !== '' && t !== '[]' && t.toLowerCase() !== 'null';
    }
    if (typeof value === 'object') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * The single eligibility verdict. THE INVARIANT THAT MATTERS: without
 * `allowReembed`, a row that already has an embedding is NEVER eligible — the
 * repair sweep can be run every minute forever and will never re-spend on a
 * covered row.
 */
export function evaluateEmbeddingEligibility(
  row: EmbeddableMemoryRow | null | undefined,
  opts?: EmbeddingEligibilityOptions | null,
): EmbeddingEligibility {
  const id = normalizeMemoryId(safeRead(row, 'id'));
  const text = buildEmbeddingInput(row as { title?: unknown; content?: unknown });
  if (!id) return { eligible: false, id: '', text, reason: 'missing_id' };

  const requireActive = safeRead(opts, 'requireActive') !== false;
  if (requireActive && safeRead(row, 'is_active') === false) {
    return { eligible: false, id, text, reason: 'inactive' };
  }

  if (!text) return { eligible: false, id, text, reason: 'empty_text' };

  const allowReembed = safeRead(opts, 'allowReembed') === true;
  if (allowReembed) return { eligible: true, id, text, reason: 'content_changed' };

  if (!hasStoredEmbedding(safeRead(row, 'embedding'))) {
    return { eligible: true, id, text, reason: 'eligible' };
  }

  const reembedOnModelChange = safeRead(opts, 'reembedOnModelChange') === true;
  if (reembedOnModelChange) {
    const target = safeText(safeRead(opts, 'targetModel')).trim();
    const stored = safeText(safeRead(row, 'embedding_model')).trim();
    if (target && stored && target !== stored) {
      return { eligible: true, id, text, reason: 'model_changed' };
    }
  }

  return { eligible: false, id, text, reason: 'already_embedded' };
}

// ─── Batch selection ─────────────────────────────────────────────────────────

export interface EmbeddingBatchSelection {
  /** Rows to embed now — at most `maxBatchSize`, in input order, ids unique. */
  batch: EmbeddingJob[];
  /** Rows deliberately not embedded, with the reason (for logging/receipts). */
  skipped: Array<{ id: string; reason: EmbeddingSkipReason }>;
  /** Untouched overflow rows — pass them back in to continue. */
  remaining: EmbeddableMemoryRow[];
  /** True when overflow exists, i.e. another pass is worth doing. */
  truncated: boolean;
}

export interface EmbeddingBatchOptions extends EmbeddingEligibilityOptions {
  maxBatchSize?: number;
  /** Ids already claimed by an in-flight batch — treated as duplicates. */
  seenIds?: readonly string[] | null;
}

/**
 * Split candidate rows into "embed these now" / "skipped and why" / "not yet
 * looked at". Overflow rows are returned UNEVALUATED so a second call produces
 * exactly the batch the first call deferred — that is what makes paging over a
 * large fetch resumable without a separate index.
 */
export function selectEmbeddingBatch(
  rows: readonly EmbeddableMemoryRow[] | null | undefined,
  opts?: EmbeddingBatchOptions | null,
): EmbeddingBatchSelection {
  const out: EmbeddingBatchSelection = { batch: [], skipped: [], remaining: [], truncated: false };
  if (!Array.isArray(rows)) return out;

  const maxBatchSize = clampInt(safeRead(opts, 'maxBatchSize'), 1, EMBEDDING_BATCH_MAX, EMBEDDING_BATCH_MAX);
  const seen = new Set<string>();
  const seedIds = safeRead(opts, 'seenIds');
  if (Array.isArray(seedIds)) {
    for (const raw of seedIds) {
      const id = normalizeMemoryId(raw);
      if (id) seen.add(id);
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (out.batch.length >= maxBatchSize) {
      out.remaining.push(row);
      out.truncated = true;
      continue;
    }
    const verdict = evaluateEmbeddingEligibility(row, opts);
    if (!verdict.eligible) {
      out.skipped.push({ id: verdict.id, reason: verdict.reason });
      continue;
    }
    if (seen.has(verdict.id)) {
      out.skipped.push({ id: verdict.id, reason: 'duplicate_id' });
      continue;
    }
    seen.add(verdict.id);
    out.batch.push({ id: verdict.id, text: verdict.text });
  }

  return out;
}

/** Chunk any list into bounded batches. Total; never returns empty chunks. */
export function planEmbeddingBatches<T>(
  items: readonly T[] | null | undefined,
  maxBatchSize: number = EMBEDDING_BATCH_MAX,
): T[][] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const size = clampInt(maxBatchSize, 1, EMBEDDING_BATCH_MAX, EMBEDDING_BATCH_MAX);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

// ─── Write-path queue (bounded, deduped, coalescing) ─────────────────────────

export interface EmbeddingQueueItem {
  id: string;
  text: string;
  enqueuedAtMs: number;
}

export interface EmbeddingQueueResult {
  queue: EmbeddingQueueItem[];
  /** Newly added ids. */
  added: number;
  /** Existing ids whose text was refreshed in place (a row edited twice). */
  replaced: number;
  /** Ids evicted by the size cap. Recoverable ONLY via the repair sweep. */
  dropped: string[];
  /** Ids rejected as unusable (no id / no text). */
  rejected: number;
}

/**
 * Enqueue write-path work. Dedupe is by memory id with LATEST TEXT WINS at the
 * ORIGINAL POSITION: a row saved and immediately edited embeds once, from the
 * newer text, and queue order stays stable (deterministic drains).
 *
 * Overflow evicts the OLDEST entries. That is deliberate: the newest writes are
 * the ones a user is most likely to search for next, and every evicted row is
 * still `embedding IS NULL` in the database, so the sweep will repair it.
 */
export function enqueueEmbeddingJobs(
  queue: readonly EmbeddingQueueItem[] | null | undefined,
  incoming: readonly { id?: unknown; text?: unknown }[] | null | undefined,
  opts?: { maxSize?: number; nowMs?: number } | null,
): EmbeddingQueueResult {
  const maxSize = clampInt(safeRead(opts, 'maxSize'), 1, EMBEDDING_QUEUE_MAX, EMBEDDING_QUEUE_MAX);
  const nowMs = finiteOr(safeRead(opts, 'nowMs'), 0);

  const next: EmbeddingQueueItem[] = [];
  const index = new Map<string, number>();
  if (Array.isArray(queue)) {
    for (const item of queue) {
      const id = normalizeMemoryId(safeRead(item, 'id'));
      const text = normalizeEmbeddingText(safeRead(item, 'text'));
      if (!id || !text) continue;
      if (index.has(id)) {
        next[index.get(id) as number] = { id, text, enqueuedAtMs: finiteOr(safeRead(item, 'enqueuedAtMs'), nowMs) };
        continue;
      }
      index.set(id, next.length);
      next.push({ id, text, enqueuedAtMs: finiteOr(safeRead(item, 'enqueuedAtMs'), nowMs) });
    }
  }

  let added = 0;
  let replaced = 0;
  let rejected = 0;
  if (Array.isArray(incoming)) {
    for (const raw of incoming) {
      const id = normalizeMemoryId(safeRead(raw, 'id'));
      const text = normalizeEmbeddingText(safeRead(raw, 'text'));
      if (!id || !text) { rejected += 1; continue; }
      const at = index.get(id);
      if (at !== undefined) {
        next[at] = { id, text, enqueuedAtMs: next[at].enqueuedAtMs };
        replaced += 1;
        continue;
      }
      index.set(id, next.length);
      next.push({ id, text, enqueuedAtMs: nowMs });
      added += 1;
    }
  }

  const dropped: string[] = [];
  while (next.length > maxSize) {
    const evicted = next.shift();
    if (evicted) dropped.push(evicted.id);
  }

  return { queue: next, added, replaced, dropped, rejected };
}

/** Pop up to `maxBatchSize` items off the front. Returns the remaining queue. */
export function takeEmbeddingBatch(
  queue: readonly EmbeddingQueueItem[] | null | undefined,
  maxBatchSize: number = EMBEDDING_BATCH_MAX,
): { batch: EmbeddingQueueItem[]; queue: EmbeddingQueueItem[] } {
  if (!Array.isArray(queue) || queue.length === 0) return { batch: [], queue: [] };
  const size = clampInt(maxBatchSize, 1, EMBEDDING_BATCH_MAX, EMBEDDING_BATCH_MAX);
  const safe = queue.filter((item) => normalizeMemoryId(safeRead(item, 'id')) && normalizeEmbeddingText(safeRead(item, 'text')));
  return { batch: safe.slice(0, size), queue: safe.slice(size) };
}

// ─── Circuit breaker (pure mirror of the legacy runtime behavior) ────────────

export interface EmbeddingBreakerState {
  consecutiveFailures: number;
  lastFailureAtMs: number;
}

export interface EmbeddingBreakerOptions {
  threshold?: number;
  cooldownMs?: number;
}

export interface EmbeddingBreakerStatus {
  open: boolean;
  consecutiveFailures: number;
  lastFailureAtMs: number;
  /** Wall-clock ms at which the breaker will close. 0 when it is not open. */
  retryAtMs: number;
  /** ms until it closes. 0 when it is not open. */
  remainingMs: number;
  threshold: number;
  cooldownMs: number;
}

export function createEmbeddingBreakerState(): EmbeddingBreakerState {
  return { consecutiveFailures: 0, lastFailureAtMs: 0 };
}

export function recordEmbeddingFailure(
  state: EmbeddingBreakerState | null | undefined,
  nowMs: number,
): EmbeddingBreakerState {
  const prior = clampInt(safeRead(state, 'consecutiveFailures'), 0, Number.MAX_SAFE_INTEGER, 0);
  return { consecutiveFailures: prior + 1, lastFailureAtMs: finiteOr(nowMs, 0) };
}

/** Success fully closes the breaker — identical to the legacy `= 0` reset. */
export function recordEmbeddingSuccess(_state?: EmbeddingBreakerState | null): EmbeddingBreakerState {
  return { consecutiveFailures: 0, lastFailureAtMs: 0 };
}

export function describeEmbeddingBreaker(
  state: EmbeddingBreakerState | null | undefined,
  nowMs: number,
  opts?: EmbeddingBreakerOptions | null,
): EmbeddingBreakerStatus {
  const threshold = clampInt(safeRead(opts, 'threshold'), 1, 1000, EMBEDDING_BREAKER_THRESHOLD);
  const cooldownMs = clampInt(safeRead(opts, 'cooldownMs'), 0, 24 * 60 * 60 * 1000, EMBEDDING_BREAKER_COOLDOWN_MS);
  const consecutiveFailures = clampInt(safeRead(state, 'consecutiveFailures'), 0, Number.MAX_SAFE_INTEGER, 0);
  const lastFailureAtMs = finiteOr(safeRead(state, 'lastFailureAtMs'), 0);
  const now = finiteOr(nowMs, 0);
  const elapsed = now - lastFailureAtMs;
  const open = consecutiveFailures >= threshold && elapsed >= 0 && elapsed < cooldownMs;
  const retryAtMs = open ? lastFailureAtMs + cooldownMs : 0;
  return {
    open,
    consecutiveFailures,
    lastFailureAtMs,
    retryAtMs,
    remainingMs: open ? Math.max(0, retryAtMs - now) : 0,
    threshold,
    cooldownMs,
  };
}

export function isEmbeddingBreakerOpen(
  state: EmbeddingBreakerState | null | undefined,
  nowMs: number,
  opts?: EmbeddingBreakerOptions | null,
): boolean {
  return describeEmbeddingBreaker(state, nowMs, opts).open;
}

/** Deterministic capped exponential backoff. attempt <= 0 → 0. */
export function computeEmbeddingRetryDelayMs(
  attempt: number,
  opts?: { baseMs?: number; maxMs?: number } | null,
): number {
  const n = clampInt(attempt, 0, 64, 0);
  if (n <= 0) return 0;
  const base = clampInt(safeRead(opts, 'baseMs'), 1, EMBEDDING_RETRY_MAX_DELAY_MS, EMBEDDING_RETRY_BASE_DELAY_MS);
  const max = clampInt(safeRead(opts, 'maxMs'), base, 24 * 60 * 60 * 1000, EMBEDDING_RETRY_MAX_DELAY_MS);
  const raw = base * Math.pow(2, n - 1);
  return Math.min(max, Number.isFinite(raw) ? Math.floor(raw) : max);
}

// ─── Repair cursor (keyset over id, strictly monotonic) ──────────────────────

/**
 * Resume state for the `embedding IS NULL` sweep.
 *
 * WHY KEYSET-ON-ID AND NOT "just fetch the first N null rows again":
 * a row that fails to embed STAYS null, so an offset-free re-fetch would hand
 * back the same poisoned rows forever and the sweep would never reach row N+1.
 * `id` is the only unique, totally-ordered column on `memory_entries`, so
 * `WHERE embedding IS NULL AND id > lastId ORDER BY id` guarantees strict
 * forward progress and termination regardless of how many rows fail — and a
 * fresh cursor (lastId = null) revisits the failures on the next pass.
 */
export interface MemoryEmbeddingRepairCursor {
  /** Highest id already visited. null = start from the beginning. */
  lastId: string | null;
  pagesDone: number;
  scanned: number;
  embedded: number;
  failed: number;
  skipped: number;
  /** True once a short page proved there is nothing left after `lastId`. */
  done: boolean;
  startedAtMs: number;
  updatedAtMs: number;
}

export function createRepairCursor(nowMs: number = 0): MemoryEmbeddingRepairCursor {
  const at = finiteOr(nowMs, 0);
  return {
    lastId: null,
    pagesDone: 0,
    scanned: 0,
    embedded: 0,
    failed: 0,
    skipped: 0,
    done: false,
    startedAtMs: at,
    updatedAtMs: at,
  };
}

export function normalizeRepairCursor(
  value: unknown,
  nowMs: number = 0,
): MemoryEmbeddingRepairCursor {
  const base = createRepairCursor(nowMs);
  if (!value || typeof value !== 'object') return base;
  const lastId = normalizeMemoryId(safeRead(value, 'lastId'));
  return {
    lastId: lastId || null,
    pagesDone: clampInt(safeRead(value, 'pagesDone'), 0, Number.MAX_SAFE_INTEGER, 0),
    scanned: clampInt(safeRead(value, 'scanned'), 0, Number.MAX_SAFE_INTEGER, 0),
    embedded: clampInt(safeRead(value, 'embedded'), 0, Number.MAX_SAFE_INTEGER, 0),
    failed: clampInt(safeRead(value, 'failed'), 0, Number.MAX_SAFE_INTEGER, 0),
    skipped: clampInt(safeRead(value, 'skipped'), 0, Number.MAX_SAFE_INTEGER, 0),
    done: safeRead(value, 'done') === true,
    startedAtMs: finiteOr(safeRead(value, 'startedAtMs'), base.startedAtMs),
    updatedAtMs: finiteOr(safeRead(value, 'updatedAtMs'), base.updatedAtMs),
  };
}

export interface RepairPageResult {
  /** Ids returned by the page, in query order (`ORDER BY id ASC`). */
  rowIds?: readonly unknown[] | null;
  /** Page size that was REQUESTED — a shorter page means the sweep is done. */
  requestedPageSize?: number;
  embedded?: number;
  failed?: number;
  skipped?: number;
}

/**
 * Fold one page into the cursor. THE INVARIANT: `lastId` never moves backwards
 * (it is the max of the previous cursor and every id in the page), so repeated
 * or out-of-order pages cannot make the sweep loop.
 */
export function advanceRepairCursor(
  cursor: MemoryEmbeddingRepairCursor | null | undefined,
  page: RepairPageResult | null | undefined,
  nowMs: number = 0,
): MemoryEmbeddingRepairCursor {
  const prev = normalizeRepairCursor(cursor, nowMs);
  const at = finiteOr(nowMs, prev.updatedAtMs);
  const ids: string[] = [];
  const rawIds = safeRead(page, 'rowIds');
  if (Array.isArray(rawIds)) {
    for (const raw of rawIds) {
      const id = normalizeMemoryId(raw);
      if (id) ids.push(id);
    }
  }

  let lastId = prev.lastId;
  for (const id of ids) {
    if (lastId === null || id > lastId) lastId = id;
  }

  const requested = clampInt(safeRead(page, 'requestedPageSize'), 0, REPAIR_PAGE_SIZE_MAX, 0);
  // A page shorter than requested means the keyset ran off the end of the
  // table. An empty page proves the same thing even with no requested size.
  const done = ids.length === 0 || (requested > 0 && ids.length < requested);

  return {
    lastId,
    pagesDone: prev.pagesDone + 1,
    scanned: prev.scanned + ids.length,
    embedded: prev.embedded + clampInt(safeRead(page, 'embedded'), 0, Number.MAX_SAFE_INTEGER, 0),
    failed: prev.failed + clampInt(safeRead(page, 'failed'), 0, Number.MAX_SAFE_INTEGER, 0),
    skipped: prev.skipped + clampInt(safeRead(page, 'skipped'), 0, Number.MAX_SAFE_INTEGER, 0),
    done,
    startedAtMs: prev.startedAtMs,
    updatedAtMs: at,
  };
}

export interface RepairContinueOptions {
  maxPages?: number;
  /** Hard cap on rows visited in one invocation. */
  maxRows?: number;
  /** Absolute wall-clock deadline; requires `nowMs`. */
  deadlineMs?: number;
  nowMs?: number;
  /** Breaker status — an open breaker stops the pass instead of burning pages. */
  breakerOpen?: boolean;
}

export function shouldContinueRepair(
  cursor: MemoryEmbeddingRepairCursor | null | undefined,
  opts?: RepairContinueOptions | null,
): { continue: boolean; reason: 'ready' | 'done' | 'max_pages' | 'max_rows' | 'deadline' | 'breaker_open' } {
  const c = normalizeRepairCursor(cursor, finiteOr(safeRead(opts, 'nowMs'), 0));
  if (c.done) return { continue: false, reason: 'done' };
  if (safeRead(opts, 'breakerOpen') === true) return { continue: false, reason: 'breaker_open' };
  const maxPages = clampInt(safeRead(opts, 'maxPages'), 1, REPAIR_MAX_PAGES_MAX, REPAIR_MAX_PAGES_DEFAULT);
  if (c.pagesDone >= maxPages) return { continue: false, reason: 'max_pages' };
  const maxRowsRaw = safeRead(opts, 'maxRows');
  if (maxRowsRaw !== undefined && maxRowsRaw !== null) {
    const maxRows = clampInt(maxRowsRaw, 0, Number.MAX_SAFE_INTEGER, 0);
    if (c.scanned >= maxRows) return { continue: false, reason: 'max_rows' };
  }
  const deadlineRaw = safeRead(opts, 'deadlineMs');
  if (deadlineRaw !== undefined && deadlineRaw !== null) {
    const deadline = finiteOr(deadlineRaw, Number.POSITIVE_INFINITY);
    const now = finiteOr(safeRead(opts, 'nowMs'), 0);
    if (now >= deadline) return { continue: false, reason: 'deadline' };
  }
  return { continue: true, reason: 'ready' };
}

export function resolveRepairPageSize(value?: unknown): number {
  return clampInt(value, 1, REPAIR_PAGE_SIZE_MAX, REPAIR_PAGE_SIZE_DEFAULT);
}

export function resolveRepairMaxPages(value?: unknown): number {
  return clampInt(value, 1, REPAIR_MAX_PAGES_MAX, REPAIR_MAX_PAGES_DEFAULT);
}

export function serializeRepairCursor(cursor: MemoryEmbeddingRepairCursor | null | undefined): string {
  const c = normalizeRepairCursor(cursor, 0);
  try {
    return JSON.stringify({ v: REPAIR_CURSOR_VERSION, ...c });
  } catch {
    return '';
  }
}

/** Returns null for anything that is not a cursor of the current version. */
export function parseRepairCursor(raw: unknown): MemoryEmbeddingRepairCursor | null {
  const text = safeText(raw).trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (finiteOr(safeRead(parsed, 'v'), -1) !== REPAIR_CURSOR_VERSION) return null;
  return normalizeRepairCursor(parsed, 0);
}

export function summarizeRepairCursor(cursor: MemoryEmbeddingRepairCursor | null | undefined): string {
  const c = normalizeRepairCursor(cursor, 0);
  const state = c.done ? 'complete' : `resumable@${c.lastId ? c.lastId.slice(0, 8) : 'start'}`;
  return `${c.embedded} embedded / ${c.failed} failed / ${c.skipped} skipped of ${c.scanned} scanned across ${c.pagesDone} page(s) — ${state}`;
}

// ─── Repair scheduling (the orphan-recovery trigger) ─────────────────────────

export interface EmbeddingRepairSchedule {
  /** Rows this session knows it failed to embed (breaker-open or proxy error). */
  orphanCount: number;
  /** 0 = never run in this session. */
  lastRepairAtMs: number;
  repairOwed: boolean;
}

export type EmbeddingRepairDecisionReason =
  | 'forced'
  | 'orphans_pending'
  | 'first_run'
  | 'due'
  | 'breaker_open'
  | 'cooling_down'
  | 'idle';

export function createEmbeddingRepairSchedule(): EmbeddingRepairSchedule {
  return { orphanCount: 0, lastRepairAtMs: 0, repairOwed: false };
}

/**
 * Record that N rows were written (or attempted) without an embedding. This is
 * the ORPHAN LEDGER: every path that gives up on embedding a row — breaker
 * open, proxy error, queue overflow, privacy block — must call this, and it is
 * what later flips `shouldRunEmbeddingRepair` to true once the breaker closes.
 */
export function markEmbeddingOrphans(
  schedule: EmbeddingRepairSchedule | null | undefined,
  count: number,
  _nowMs?: number,
): EmbeddingRepairSchedule {
  const prior = normalizeRepairSchedule(schedule);
  const n = clampInt(count, 0, Number.MAX_SAFE_INTEGER, 0);
  if (n <= 0) return prior;
  return { ...prior, orphanCount: prior.orphanCount + n, repairOwed: true };
}

export function normalizeRepairSchedule(
  value: EmbeddingRepairSchedule | null | undefined,
): EmbeddingRepairSchedule {
  return {
    orphanCount: clampInt(safeRead(value, 'orphanCount'), 0, Number.MAX_SAFE_INTEGER, 0),
    lastRepairAtMs: finiteOr(safeRead(value, 'lastRepairAtMs'), 0),
    repairOwed: safeRead(value, 'repairOwed') === true,
  };
}

export function noteEmbeddingRepairRun(
  schedule: EmbeddingRepairSchedule | null | undefined,
  nowMs: number,
  opts?: { clearedOrphans?: boolean } | null,
): EmbeddingRepairSchedule {
  const prior = normalizeRepairSchedule(schedule);
  const cleared = safeRead(opts, 'clearedOrphans') === true;
  return {
    orphanCount: cleared ? 0 : prior.orphanCount,
    lastRepairAtMs: finiteOr(nowMs, prior.lastRepairAtMs),
    repairOwed: cleared ? false : prior.repairOwed,
  };
}

/**
 * Should an automatic repair pass run right now?
 *
 * Order matters. The breaker is checked FIRST — with an open breaker every
 * embed call returns null, so a sweep would only burn database reads and
 * re-mark the same rows as orphans. That is also precisely why orphaned rows
 * are recoverable: the sweep is refused while the outage is live and becomes
 * eligible the moment the breaker closes, with `repairOwed` still set.
 */
export function shouldRunEmbeddingRepair(opts?: {
  schedule?: EmbeddingRepairSchedule | null;
  breaker?: EmbeddingBreakerState | null;
  nowMs?: number;
  minIntervalMs?: number;
  sweepIntervalMs?: number;
  force?: boolean;
  breakerOptions?: EmbeddingBreakerOptions | null;
} | null): { run: boolean; reason: EmbeddingRepairDecisionReason; waitMs: number } {
  const nowMs = finiteOr(safeRead(opts, 'nowMs'), 0);
  const schedule = normalizeRepairSchedule(safeRead(opts, 'schedule') as EmbeddingRepairSchedule | null);
  const breaker = describeEmbeddingBreaker(
    safeRead(opts, 'breaker') as EmbeddingBreakerState | null,
    nowMs,
    safeRead(opts, 'breakerOptions') as EmbeddingBreakerOptions | null,
  );
  if (breaker.open) return { run: false, reason: 'breaker_open', waitMs: breaker.remainingMs };

  if (safeRead(opts, 'force') === true) return { run: true, reason: 'forced', waitMs: 0 };

  const minIntervalMs = clampInt(safeRead(opts, 'minIntervalMs'), 0, 24 * 60 * 60 * 1000, REPAIR_MIN_INTERVAL_MS);
  if (schedule.lastRepairAtMs > 0) {
    const elapsed = nowMs - schedule.lastRepairAtMs;
    if (elapsed >= 0 && elapsed < minIntervalMs) {
      return { run: false, reason: 'cooling_down', waitMs: minIntervalMs - elapsed };
    }
  }

  if (schedule.repairOwed || schedule.orphanCount > 0) {
    return { run: true, reason: 'orphans_pending', waitMs: 0 };
  }
  if (schedule.lastRepairAtMs === 0) return { run: true, reason: 'first_run', waitMs: 0 };

  const sweepIntervalMs = clampInt(safeRead(opts, 'sweepIntervalMs'), 0, 7 * 24 * 60 * 60 * 1000, REPAIR_SWEEP_INTERVAL_MS);
  if (sweepIntervalMs > 0 && nowMs - schedule.lastRepairAtMs >= sweepIntervalMs) {
    return { run: true, reason: 'due', waitMs: 0 };
  }
  const wait = sweepIntervalMs > 0 ? Math.max(0, sweepIntervalMs - (nowMs - schedule.lastRepairAtMs)) : 0;
  return { run: false, reason: 'idle', waitMs: wait };
}

// ─── Coverage reporting ──────────────────────────────────────────────────────

export interface EmbeddingCoverage {
  total: number;
  embedded: number;
  missing: number;
  /** 0..1, 4dp. An empty table is vacuously fully covered. */
  pct: number;
  healthy: boolean;
}

export function describeEmbeddingCoverage(
  input?: { total?: unknown; embedded?: unknown } | null,
): EmbeddingCoverage {
  const total = clampInt(safeRead(input, 'total'), 0, Number.MAX_SAFE_INTEGER, 0);
  const embeddedRaw = clampInt(safeRead(input, 'embedded'), 0, Number.MAX_SAFE_INTEGER, 0);
  const embedded = Math.min(embeddedRaw, total);
  const missing = Math.max(0, total - embedded);
  const pct = total === 0 ? 1 : Math.round((embedded / total) * 10000) / 10000;
  return { total, embedded, missing, pct, healthy: missing === 0 };
}

export function formatEmbeddingCoverage(coverage?: EmbeddingCoverage | null): string {
  const c = describeEmbeddingCoverage(coverage as { total?: unknown; embedded?: unknown } | null);
  return `${c.embedded}/${c.total} memories embedded (${(c.pct * 100).toFixed(1)}%) — ${c.missing} missing`;
}
