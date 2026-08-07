/**
 * memoryEmbeddings — Phase 1 of AGENT_MEMORY_GOD_PLAN, and the COMPLETE OWNER
 * of semantic-memory embedding coverage.
 *
 * Thin client for embedding memory text via the `llm-proxy` edge fn
 * (provider: 'openai-embed'), plus the three things that make coverage real:
 *
 *   1. EMBED ON WRITE — `queueMemoryEmbedding()`. A one-line, synchronous,
 *      never-throwing, never-awaited call for the `memory_entries` write paths
 *      (owned by other modules). Writes are coalesced for 250ms and batched, so
 *      a burst of saves costs one proxy request instead of N.
 *   2. REPAIR — `repairMemoryEmbeddings()` / `ensureMemoryEmbeddingCoverage()`.
 *      A bounded, resumable, idempotent sweep over `embedding IS NULL`. Safe to
 *      run as often as you like: the SQL predicate plus
 *      `evaluateEmbeddingEligibility` mean an already-embedded row is never
 *      re-billed.
 *   3. ORPHAN RECOVERY — every path that gives up on a row (breaker open, proxy
 *      error, queue overflow, privacy block) records it on the orphan ledger.
 *      The ledger arms the repair sweep, which is refused while the breaker is
 *      open and fires as soon as it closes. Rows written during an outage are
 *      therefore repaired instead of being orphaned forever.
 *
 * WHY THIS MATTERS: `match_memories` filters `AND m.embedding IS NOT NULL`, so
 * an un-embedded row is invisible to every semantic retrieval path in the app.
 * Before this file owned coverage, `embedAndStoreMemory` had two call sites
 * (both inside one dead extraction path), `backfillMemoryEmbeddings` had zero
 * callers, and a five-minute proxy outage permanently deleted everything saved
 * during it from semantic search.
 *
 * THE ONE RULE: EMBEDDING MUST NEVER BE ABLE TO FAIL A MEMORY WRITE. A memory
 * saved without an embedding is degraded and repairable; a memory that fails to
 * save is data loss. Nothing here is awaited by a write path, nothing here
 * throws into one, and nothing here returns a value a write path can mistake
 * for its own success.
 *
 * Design notes (unchanged):
 *   * All calls are fire-and-forget from the user's perspective — we never
 *     block the UI on embedding latency.
 *   * The model name and dimensions are recorded on the row so we can
 *     safely migrate providers (re-embed only rows whose model differs).
 *   * Batch size ceiling = 50 per request. OpenAI accepts larger batches
 *     but bigger batches → larger responses → slower user-visible calls
 *     during interactive backfill.
 *
 * Decisions live in the pure core (`memoryEmbeddingPolicyCore.ts`, smoke:
 * `npx tsx scripts/memory-embedding-policy-core-smoketest.ts`); this file only
 * does I/O.
 */

import { supabase } from './supabase';
import { shouldBlockExternalAiProvider } from './privacyMode';
import { readLLMProxyInvokeError } from './llmProxyErrorCore';
import { safeGetSession } from './authSession';
import {
  EMBEDDING_BATCH_MAX,
  EMBEDDING_COALESCE_MS,
  EMBEDDING_QUEUE_MAX,
  REPAIR_MIN_INTERVAL_MS,
  advanceRepairCursor,
  buildEmbeddingInput,
  createEmbeddingBreakerState,
  createEmbeddingRepairSchedule,
  createRepairCursor,
  describeEmbeddingBreaker,
  describeEmbeddingCoverage,
  enqueueEmbeddingJobs,
  formatEmbeddingCoverage,
  isEmbeddingBreakerOpen,
  markEmbeddingOrphans,
  noteEmbeddingRepairRun,
  parseRepairCursor,
  planEmbeddingBatches,
  recordEmbeddingFailure,
  recordEmbeddingSuccess,
  resolveRepairMaxPages,
  resolveRepairPageSize,
  selectEmbeddingBatch,
  serializeRepairCursor,
  shouldContinueRepair,
  shouldRunEmbeddingRepair,
  summarizeRepairCursor,
  takeEmbeddingBatch,
  type EmbeddingBreakerState,
  type EmbeddingQueueItem,
  type EmbeddingRepairSchedule,
  type MemoryEmbeddingRepairCursor,
} from './memoryEmbeddingPolicyCore';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;
const BATCH_SIZE = EMBEDDING_BATCH_MAX;
const EMBEDDING_PROXY_TIMEOUT_MS = 30_000;

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  input_tokens: number;
}

// ─── Circuit breaker + orphan ledger ─────────────────────────────────────────
// Breaker semantics are UNCHANGED from the legacy implementation: 5 consecutive
// failures opens it, any success closes it, cooldown is 5 minutes. The only
// deviation is that a BACKWARDS clock jump can no longer wedge it open (see
// describeEmbeddingBreaker) — the safer direction, since a stuck-open breaker
// is exactly what used to orphan rows permanently.
let breakerState: EmbeddingBreakerState = createEmbeddingBreakerState();
let repairSchedule: EmbeddingRepairSchedule = createEmbeddingRepairSchedule();

type EmbeddingCredentialBlockCode = 'key_missing' | 'credential_unreadable';
type EmbeddingCredentialBlock = {
  code: EmbeddingCredentialBlockCode;
  provider: 'openai';
  sinceMs: number;
  generation: number;
  userId: string | null;
};

// Missing/unreadable BYOK state is not a transient proxy outage. Keep one
// session-local terminal pause so write and repair paths do not hammer the same
// permanent 400/409. The durable orphan ledger remains armed and a successful
// OpenAI Marketplace write explicitly clears this pause below.
let embeddingCredentialBlock: EmbeddingCredentialBlock | null = null;
let embeddingCredentialGeneration = 0;
let embeddingProxyTurn: Promise<void> | null = null;

/**
 * Record rows we could not embed. This is the ONLY thing standing between a
 * proxy outage and a permanently unsearchable memory: it arms the repair sweep,
 * which finds the rows again through `embedding IS NULL`.
 */
function noteOrphans(count: number, why: string, log = true): void {
  if (!count || count <= 0) return;
  repairSchedule = markEmbeddingOrphans(repairSchedule, count, Date.now());
  if (log) {
    console.warn(`[memoryEmbeddings] ${count} memory row(s) left un-embedded (${why}) — queued for repair sweep`);
  }
}

function isEmbeddingCredentialBlockCode(value: unknown): value is EmbeddingCredentialBlockCode {
  return value === 'key_missing' || value === 'credential_unreadable';
}

async function readEmbeddingAuthUserId(): Promise<{ known: boolean; userId: string | null }> {
  const { value, error } = await safeGetSession();
  if (error) return { known: false, userId: null };
  return { known: true, userId: value?.user?.id ?? null };
}

/**
 * Called only after an OpenAI Marketplace key write succeeds. The next repair
 * is forced in the background; a still-broken credential pauses again after
 * one bounded probe instead of entering a retry loop.
 */
export function resetMemoryEmbeddingCredentialBlock(): void {
  embeddingCredentialGeneration += 1;
  embeddingCredentialBlock = null;
  breakerState = recordEmbeddingSuccess(breakerState);
  const activeRepair = repairInFlight;
  void (activeRepair ? activeRepair.catch(() => undefined) : Promise.resolve())
    .then(() => ensureMemoryEmbeddingCoverage({ force: true }))
    .catch(() => {});
}

async function callEmbedProxy(inputs: string[]): Promise<EmbedResponse | null> {
  if (inputs.length === 0) return { embeddings: [], model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMS, input_tokens: 0 };
  if (shouldBlockExternalAiProvider('openai')) return null;
  const initialAuth = await readEmbeddingAuthUserId();
  if (
    embeddingCredentialBlock
    && initialAuth.known
    && embeddingCredentialBlock.userId !== initialAuth.userId
  ) {
    // A terminal credential result belongs only to the signed-in user that
    // produced it. An in-place account switch must not inherit that pause.
    embeddingCredentialGeneration += 1;
    embeddingCredentialBlock = null;
    breakerState = recordEmbeddingSuccess(breakerState);
  }
  if (embeddingCredentialBlock) return null;

  // Multiple memory writers can wake together during app startup. Serialize
  // only the proxy turn (not vector writes) so one terminal credential result
  // establishes the session pause before another request can leave. Successful
  // turns still receive and return the vectors for their own exact input batch.
  while (embeddingProxyTurn) {
    await embeddingProxyTurn.catch(() => {});
    if (embeddingCredentialBlock || shouldBlockExternalAiProvider('openai')) return null;
  }
  let releaseProxyTurn!: () => void;
  const proxyTurn = new Promise<void>((resolve) => { releaseProxyTurn = resolve; });
  embeddingProxyTurn = proxyTurn;
  const requestCredentialGeneration = embeddingCredentialGeneration;
  const requestUserId = initialAuth.known ? initialAuth.userId : undefined;

  try {
    // Re-check after acquiring the turn: a preceding request may have paused
    // credentials or opened the breaker while this caller was waiting.
    if (embeddingCredentialBlock || shouldBlockExternalAiProvider('openai')) return null;

    // Circuit breaker — if we've failed N times in a row, stop trying for 5 min
    if (isEmbeddingBreakerOpen(breakerState, Date.now())) {
      return null;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller) timeout = setTimeout(() => controller.abort(), EMBEDDING_PROXY_TIMEOUT_MS);
      const { data, error } = await supabase.functions.invoke('llm-proxy', {
        body: {
          provider: 'openai-embed',
          model: EMBEDDING_MODEL,
          input: inputs,
          messages: [],
        },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (error) {
        const details = await readLLMProxyInvokeError(error, 'openai');
        if (isEmbeddingCredentialBlockCode(details.code)) {
          const completedAuth = await readEmbeddingAuthUserId();
          // A key can be replaced while this request is in flight. Never let
          // the response from old ciphertext or a prior signed-in account
          // re-pause the current credential generation.
          if (
            requestCredentialGeneration !== embeddingCredentialGeneration
            || requestUserId === undefined
            || !completedAuth.known
            || completedAuth.userId !== requestUserId
          ) {
            if (completedAuth.known && completedAuth.userId !== requestUserId) {
              embeddingCredentialGeneration += 1;
              embeddingCredentialBlock = null;
              breakerState = recordEmbeddingSuccess(breakerState);
            }
            return null;
          }
          embeddingCredentialBlock = {
            code: details.code,
            provider: 'openai',
            sinceMs: Date.now(),
            generation: requestCredentialGeneration,
            userId: requestUserId,
          };
          console.warn(`[memoryEmbeddings] paused until the OpenAI Marketplace key changes (${details.code}): ${details.message}`);
          return null;
        }
        breakerState = recordEmbeddingFailure(breakerState, Date.now());
        console.warn('[memoryEmbeddings] proxy error:', details.message, '| status:', details.status);
        return null;
      }
      if (!data?.embeddings || !Array.isArray(data.embeddings) || data.embeddings.length === 0) {
        breakerState = recordEmbeddingFailure(breakerState, Date.now());
        console.warn('[memoryEmbeddings] proxy returned an unexpected response shape');
        return null;
      }
      // Success — reset circuit breaker
      breakerState = recordEmbeddingSuccess(breakerState);
      return data as EmbedResponse;
    } catch (err) {
      breakerState = recordEmbeddingFailure(breakerState, Date.now());
      console.warn('[memoryEmbeddings] proxy call failed:', err instanceof Error ? err.name : 'unknown_error');
      return null;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  } finally {
    if (embeddingProxyTurn === proxyTurn) embeddingProxyTurn = null;
    releaseProxyTurn();
  }
}

/** pgvector wants the literal text form `"[0.1,0.2,...]"`, not a JSON array. */
function toPgVector(vector: number[]): string | null {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) return null;
  for (let i = 0; i < vector.length; i += 1) {
    if (typeof vector[i] !== 'number' || !Number.isFinite(vector[i])) return null;
  }
  return `[${vector.join(',')}]`;
}

/** Persist one vector. Returns false (never throws) on any failure. */
async function storeEmbedding(memoryId: string, vector: number[], model: string): Promise<boolean> {
  const vectorStr = toPgVector(vector);
  if (!vectorStr) return false;
  try {
    const { error } = await supabase
      .from('memory_entries')
      .update({
        embedding: vectorStr as any,
        embedding_model: model || EMBEDDING_MODEL,
        embedded_at: new Date().toISOString(),
      })
      .eq('id', memoryId);
    if (error) {
      // PGRST204 = column not in schema cache yet (migration not run).
      if ((error as any).code !== 'PGRST204' && (error as any).code !== '42703') {
        console.warn('[memoryEmbeddings] store failed:', error.message);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[memoryEmbeddings] store threw:', err);
    return false;
  }
}

/**
 * Embed a batch of strings (P4 codebase index reuse). Returns one vector per
 * input in order, or null on total failure. Inputs are chunked at BATCH_SIZE;
 * a failed chunk nulls its members rather than failing the whole batch.
 */
export async function embedTexts(texts: string[]): Promise<Array<number[] | null> | null> {
  const inputs = (texts || []).map((t) => (t || '').trim().slice(0, 30000));
  if (inputs.length === 0) return [];
  const out: Array<number[] | null> = new Array(inputs.length).fill(null);
  let anySucceeded = false;
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const chunk = inputs.slice(i, i + BATCH_SIZE);
    // Preserve positions: empty strings are skipped locally (proxy rejects them).
    const sendIdx: number[] = [];
    const send: string[] = [];
    chunk.forEach((t, j) => { if (t) { sendIdx.push(i + j); send.push(t); } });
    if (send.length === 0) continue;
    const res = await callEmbedProxy(send);
    if (!res) continue;
    anySucceeded = true;
    res.embeddings.forEach((vec, j) => {
      if (Array.isArray(vec) && vec.length === EMBEDDING_DIMS) out[sendIdx[j]] = vec;
    });
  }
  return anySucceeded || inputs.every((t) => !t) ? out : null;
}

/** Embed a single string. Returns the 1536d vector or null on failure. */
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const res = await callEmbedProxy([trimmed]);
  return res?.embeddings[0] || null;
}

/**
 * Embed a memory's content and persist the vector on memory_entries.
 * Fire-and-forget — callers should not await except in tests/backfill.
 *
 * Prefer `queueMemoryEmbedding` from write paths: it coalesces and batches, so
 * N saves in a burst cost one proxy call instead of N. This single-row form
 * stays for callers that genuinely need the awaited boolean.
 */
export async function embedAndStoreMemory(opts: {
  memoryId: string;
  title: string;
  content: string;
}): Promise<boolean> {
  const memoryId = String(opts?.memoryId || '').trim();
  const combined = buildEmbeddingInput(opts);
  if (!memoryId || !combined) return false;
  const vector = await embedText(combined);
  if (!vector) {
    if (!embeddingCredentialBlock) {
      console.warn(`[memoryEmbeddings] embedText returned null for memory ${memoryId.slice(0, 8)} — embedding skipped`);
    }
    noteOrphans(
      1,
      embeddingCredentialBlock ? 'OpenAI Marketplace credential unavailable' : 'embed proxy returned nothing',
      !embeddingCredentialBlock,
    );
    return false;
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
    console.warn(`[memoryEmbeddings] unexpected vector shape: length=${vector?.length}, expected=${EMBEDDING_DIMS}`);
    noteOrphans(1, 'unexpected vector shape');
    return false;
  }
  const stored = await storeEmbedding(memoryId, vector, EMBEDDING_MODEL);
  if (!stored) noteOrphans(1, 'vector write failed');
  return stored;
}

// ═══════════════════════════════════════════════════════════════════════════
// EMBED ON WRITE
// ═══════════════════════════════════════════════════════════════════════════

let embedQueue: EmbeddingQueueItem[] = [];
let drainTimer: any = null;
let draining: Promise<void> | null = null;

function armTimer(delayMs: number, fn: () => void): void {
  try {
    if (drainTimer) return;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      try { fn(); } catch { /* a drain must never surface into a caller */ }
    }, Math.max(0, delayMs));
    // Do not hold a Node process (scripts/tests) open for a background drain.
    if (drainTimer && typeof drainTimer.unref === 'function') drainTimer.unref();
  } catch {
    drainTimer = null;
  }
}

/**
 * THE EMBED-ON-WRITE ENTRY POINT.
 *
 * Designed for a single fire-and-forget line at the bottom of a `memory_entries`
 * write path, in a module this file does not own:
 *
 *     queueMemoryEmbedding({ memoryId: saved.id, title: saved.title, content: saved.content });
 *
 * Contract, so a write path can adopt it without reading this file:
 *   * SYNCHRONOUS and returns void — there is nothing to await and nothing to
 *     branch on, so it cannot become part of the write's success condition.
 *   * NEVER THROWS. Every failure mode inside is caught and turned into an
 *     orphan-ledger entry that the repair sweep will pick up.
 *   * IDEMPOTENT per row within the coalesce window: saving then immediately
 *     editing the same row embeds once, from the newer text.
 *   * SAFE ON UPDATE PATHS. Content that just changed makes any stored vector
 *     stale, so the queue always re-embeds what it is handed.
 */
export function queueMemoryEmbedding(opts: {
  memoryId: string;
  title?: string | null;
  content?: string | null;
}): void {
  try {
    const memoryId = String(opts?.memoryId || '').trim();
    const text = buildEmbeddingInput({ title: opts?.title, content: opts?.content });
    if (!memoryId || !text) return;

    const result = enqueueEmbeddingJobs(embedQueue, [{ id: memoryId, text }], {
      maxSize: EMBEDDING_QUEUE_MAX,
      nowMs: Date.now(),
    });
    embedQueue = result.queue;
    // Evicted rows are still `embedding IS NULL` in the database, so the sweep
    // will find them. Losing them from memory is not losing them.
    if (result.dropped.length > 0) noteOrphans(result.dropped.length, 'write queue overflow');

    armTimer(EMBEDDING_COALESCE_MS, () => { void drainEmbedQueue(); });
  } catch (err) {
    // Absolute last resort: a write path must never see an exception from here.
    try { console.warn('[memoryEmbeddings] queueMemoryEmbedding ignored an error:', err); } catch { /* noop */ }
  }
}

async function drainEmbedQueue(): Promise<void> {
  if (draining) { await draining; return; }

  // The in-flight marker is cleared by the CALLER, not inside the worker. If a
  // `finally` inside the worker cleared it, a fully synchronous path (empty
  // queue, open breaker, empty batch) would clear it BEFORE the assignment
  // below and wedge `draining` on a resolved promise forever — after which the
  // queue would never drain again.
  const run = (async () => {
    try {
      if (embedQueue.length > 0 && embeddingCredentialBlock) {
        noteOrphans(embedQueue.length, 'OpenAI Marketplace credential unavailable', false);
        embedQueue = [];
        return;
      }
      if (embedQueue.length > 0 && shouldBlockExternalAiProvider('openai')) {
        // Strict local AI mode. Record the debt and let go of the rows — the
        // sweep re-finds them from the database once the mode is turned off.
        noteOrphans(embedQueue.length, 'strict local AI mode blocks external embedding');
        embedQueue = [];
        return;
      }
      while (embedQueue.length > 0) {
        const now = Date.now();
        const breaker = describeEmbeddingBreaker(breakerState, now);
        if (breaker.open) {
          // Do NOT burn the queue against an open breaker. Mark the debt so the
          // durable sweep is armed either way, and retry once it heals.
          noteOrphans(embedQueue.length, 'embed breaker open');
          armTimer(breaker.remainingMs + EMBEDDING_COALESCE_MS, () => { void drainEmbedQueue(); });
          return;
        }

        const { batch, queue } = takeEmbeddingBatch(embedQueue, EMBEDDING_BATCH_MAX);
        embedQueue = queue;
        if (batch.length === 0) return;

        const res = await callEmbedProxy(batch.map((item) => item.text));
        if (!res) {
          // Failed batches are NOT requeued — that risks an infinite retry loop
          // against a broken proxy. They become orphans, and the sweep (which
          // reads `embedding IS NULL` from the database) is the retry.
          const credentialBlocked = Boolean(embeddingCredentialBlock);
          noteOrphans(
            batch.length,
            credentialBlocked ? 'OpenAI Marketplace credential unavailable' : 'embed proxy failure',
            !credentialBlocked,
          );
          if (credentialBlocked) {
            noteOrphans(embedQueue.length, 'OpenAI Marketplace credential unavailable', false);
            embedQueue = [];
            return;
          }
          continue;
        }

        let failed = 0;
        await Promise.all(batch.map(async (item, i) => {
          const vector = res.embeddings?.[i];
          const ok = Array.isArray(vector) ? await storeEmbedding(item.id, vector, res.model || EMBEDDING_MODEL) : false;
          if (!ok) failed += 1;
        }));
        if (failed > 0) noteOrphans(failed, 'vector write failure');
      }
    } catch (err) {
      console.warn('[memoryEmbeddings] drain failed:', err);
      noteOrphans(embedQueue.length, 'drain error');
    }
  })();

  draining = run;
  try {
    await run;
  } finally {
    if (draining === run) draining = null;
  }

  // Any debt recorded above (this drain or an earlier one) becomes a sweep.
  void ensureMemoryEmbeddingCoverage().catch(() => {});
}

/**
 * Await the write-path queue. For scripts, tests, and "before I search, make
 * sure what I just saved is findable" call sites. Never throws.
 */
export async function flushMemoryEmbeddingQueue(): Promise<{ pending: number }> {
  try {
    await drainEmbedQueue();
  } catch { /* drain already logs */ }
  return { pending: embedQueue.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// REPAIR / BACKFILL
// ═══════════════════════════════════════════════════════════════════════════

const REPAIR_CURSOR_STORAGE_KEY = 'uc_memory_embedding_repair_cursor';
let repairCursor: MemoryEmbeddingRepairCursor | null = null;
let repairInFlight: Promise<MemoryEmbeddingRepairResult> | null = null;

function readPersistedCursor(): MemoryEmbeddingRepairCursor | null {
  if (repairCursor) return repairCursor;
  try {
    const store = (globalThis as any)?.localStorage;
    const raw = store?.getItem?.(REPAIR_CURSOR_STORAGE_KEY);
    const parsed = parseRepairCursor(raw);
    if (parsed) repairCursor = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function persistCursor(cursor: MemoryEmbeddingRepairCursor): void {
  repairCursor = cursor;
  try {
    (globalThis as any)?.localStorage?.setItem?.(REPAIR_CURSOR_STORAGE_KEY, serializeRepairCursor(cursor));
  } catch { /* memory-only resume is still a resume */ }
}

export interface MemoryEmbeddingRepairResult {
  ran: boolean;
  /** Why the pass stopped, including credential_blocked for terminal BYOK setup state. */
  reason: string;
  cursor: MemoryEmbeddingRepairCursor;
  scanned: number;
  eligible: number;
  embedded: number;
  failed: number;
  skipped: number;
  pages: number;
  done: boolean;
  dryRun: boolean;
  summary: string;
}

function repairResult(
  cursor: MemoryEmbeddingRepairCursor,
  reason: string,
  ran: boolean,
  eligible: number,
  dryRun: boolean,
): MemoryEmbeddingRepairResult {
  return {
    ran,
    reason,
    cursor,
    scanned: cursor.scanned,
    eligible,
    embedded: cursor.embedded,
    failed: cursor.failed,
    skipped: cursor.skipped,
    pages: cursor.pagesDone,
    done: cursor.done,
    dryRun,
    summary: summarizeRepairCursor(cursor),
  };
}

/**
 * One page of un-embedded rows, keyset-paged on `id`.
 *
 * NOTE: `embedding` is deliberately NOT selected — 1536 floats per row would
 * dwarf the payload, and the `IS NULL` predicate already proves it is empty.
 * `evaluateEmbeddingEligibility` then sees `embedding: undefined`, which reads
 * as "not covered", which is exactly right for this query.
 */
async function fetchRepairPage(
  lastId: string | null,
  pageSize: number,
  circleId?: string,
): Promise<Array<{ id: string; title: string; content: string; embedding_model?: string }> | null> {
  try {
    let query = supabase
      .from('memory_entries')
      .select('id, title, content, embedding_model')
      .eq('is_active', true)
      .is('embedding', null)
      .order('id', { ascending: true })
      .limit(pageSize);
    if (lastId) query = query.gt('id', lastId);
    if (circleId) query = query.eq('circle_id', circleId);

    const { data, error } = await query;
    if (error) {
      // PGRST204 / 42703 = embedding column not migrated yet — not an error.
      if ((error as any).code !== 'PGRST204' && (error as any).code !== '42703') {
        console.warn('[memoryEmbeddings] repair fetch failed:', error.message);
      }
      return null;
    }
    return (data || []) as any;
  } catch (err) {
    console.warn('[memoryEmbeddings] repair fetch threw:', err);
    return null;
  }
}

/**
 * THE REPAIR SWEEP. Finds `memory_entries` rows with no embedding and embeds
 * them.
 *
 * Properties that make it safe to run repeatedly, from anywhere:
 *   * BOUNDED — `pageSize` rows per query, `maxPages` queries per invocation,
 *     optional `maxRows` and wall-clock `deadlineMs`. One automatic pass can
 *     never walk an unbounded table.
 *   * RESUMABLE — keyset on `id` (the only unique, totally ordered column), so
 *     the cursor only moves forward. Rows that FAIL to embed stay null, and a
 *     naive re-fetch would hand back the same poisoned rows forever; the cursor
 *     steps past them and a later pass (starting fresh) retries them.
 *   * IDEMPOTENT — the SQL `IS NULL` filter plus `evaluateEmbeddingEligibility`
 *     mean an already-embedded row is never re-sent to the proxy. Running this
 *     every minute forever costs nothing once coverage is complete.
 *   * FAIL-SOFT — a fetch error, a proxy error, or an open breaker stops the
 *     pass and leaves the debt on the ledger. It never throws.
 */
export async function repairMemoryEmbeddings(opts?: {
  circleId?: string;
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
  deadlineMs?: number;
  /** Continue from the persisted cursor (default true). */
  resume?: boolean;
  /** Report what would be embedded without calling the proxy. */
  dryRun?: boolean;
  onProgress?: (cursor: MemoryEmbeddingRepairCursor) => void;
}): Promise<MemoryEmbeddingRepairResult> {
  const pageSize = resolveRepairPageSize(opts?.pageSize);
  const maxPages = resolveRepairMaxPages(opts?.maxPages);
  const dryRun = opts?.dryRun === true;

  if (shouldBlockExternalAiProvider('openai')) {
    // Privacy mode: leave the debt on the ledger so coverage is repaired once
    // strict local mode is turned off.
    return repairResult(createRepairCursor(Date.now()), 'privacy_blocked', false, 0, dryRun);
  }
  if (embeddingCredentialBlock) {
    return repairResult(createRepairCursor(Date.now()), 'credential_blocked', false, 0, dryRun);
  }

  const persisted = opts?.resume === false ? null : readPersistedCursor();
  // A completed sweep starts over next time: new null rows can appear anywhere
  // in the id space, so "done" means "done with this pass", not "done forever".
  let cursor = persisted && !persisted.done ? persisted : createRepairCursor(Date.now());

  let eligibleTotal = 0;
  let stopReason = 'done';

  for (;;) {
    const now = Date.now();
    const gate = shouldContinueRepair(cursor, {
      maxPages,
      maxRows: opts?.maxRows,
      deadlineMs: opts?.deadlineMs,
      nowMs: now,
      breakerOpen: isEmbeddingBreakerOpen(breakerState, now),
    });
    if (!gate.continue) { stopReason = gate.reason; break; }

    const rows = await fetchRepairPage(cursor.lastId, pageSize, opts?.circleId);
    if (rows === null) { stopReason = 'fetch_failed'; break; }

    // Belt-and-braces: the SQL filter already excludes covered rows, but the
    // eligibility core is the thing that PROVES we never re-bill one.
    const jobs: Array<{ id: string; text: string }> = [];
    const claimed: string[] = [];
    let pending: any[] = rows;
    let pageSkipped = 0;
    while (pending.length > 0) {
      const sel = selectEmbeddingBatch(pending, { maxBatchSize: EMBEDDING_BATCH_MAX, seenIds: claimed });
      jobs.push(...sel.batch);
      for (const job of sel.batch) claimed.push(job.id);
      pageSkipped += sel.skipped.length;
      if (!sel.truncated || sel.remaining.length === 0) break;
      pending = sel.remaining as any[];
    }
    eligibleTotal += jobs.length;

    let pageEmbedded = 0;
    let pageFailed = 0;
    let credentialBlocked = false;
    if (!dryRun) {
      for (const chunk of planEmbeddingBatches(jobs, EMBEDDING_BATCH_MAX)) {
        const res = await callEmbedProxy(chunk.map((job) => job.text));
        if (!res) {
          if (embeddingCredentialBlock) {
            credentialBlocked = true;
            break;
          }
          pageFailed += chunk.length;
          continue;
        }
        await Promise.all(chunk.map(async (job, i) => {
          const vector = res.embeddings?.[i];
          const ok = Array.isArray(vector) ? await storeEmbedding(job.id, vector, res.model || EMBEDDING_MODEL) : false;
          if (ok) pageEmbedded += 1; else pageFailed += 1;
        }));
      }
    }

    // Do not advance the repair cursor past rows that were never attempted.
    // A Marketplace key change clears the pause and retries this exact page.
    if (credentialBlocked) {
      stopReason = 'credential_blocked';
      break;
    }

    cursor = advanceRepairCursor(
      cursor,
      {
        rowIds: rows.map((row) => row?.id),
        requestedPageSize: pageSize,
        embedded: pageEmbedded,
        failed: pageFailed,
        skipped: pageSkipped,
      },
      Date.now(),
    );
    if (!dryRun) persistCursor(cursor);
    try { opts?.onProgress?.(cursor); } catch { /* progress must not break the sweep */ }
  }

  return repairResult(cursor, stopReason, true, eligibleTotal, dryRun);
}

/**
 * THE TRIGGER. Throttled, self-arming, safe to call on any hot path.
 *
 * Why this and not a cron: this app has no installed scheduler, and a Supabase
 * cron would need the service role plus a deployed function to embed on the
 * user's behalf — it cannot see RLS-scoped rows the way the signed-in client
 * can. So the repair rides the write path instead: every `queueMemoryEmbedding`
 * drain calls this, it costs one `shouldRunEmbeddingRepair` comparison when
 * nothing is owed, and it becomes a real bounded sweep only when
 *   (a) orphans are on the ledger and the breaker has closed,
 *   (b) it is the first call of the session (which catches every historical
 *       orphan, including everything written before this file existed), or
 *   (c) the idle re-sweep interval has elapsed.
 * `scripts/backfill-memory-embeddings.ts` is the loud, ops-side companion for
 * a large one-time catch-up.
 */
export async function ensureMemoryEmbeddingCoverage(opts?: {
  force?: boolean;
  circleId?: string;
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
}): Promise<MemoryEmbeddingRepairResult> {
  const now = Date.now();
  const idle = repairResult(readPersistedCursor() || createRepairCursor(now), 'idle', false, 0, false);

  if (shouldBlockExternalAiProvider('openai')) return { ...idle, reason: 'privacy_blocked' };
  if (embeddingCredentialBlock) return { ...idle, reason: 'credential_blocked' };
  if (repairInFlight) return repairInFlight;

  const decision = shouldRunEmbeddingRepair({
    schedule: repairSchedule,
    breaker: breakerState,
    nowMs: now,
    minIntervalMs: REPAIR_MIN_INTERVAL_MS,
    force: opts?.force === true,
  });
  if (!decision.run) return { ...idle, reason: decision.reason };

  // Same rule as the drain: the in-flight marker is cleared by the caller, so a
  // synchronous failure path cannot wedge it before the assignment below.
  const run = (async (): Promise<MemoryEmbeddingRepairResult> => {
    try {
      const result = await repairMemoryEmbeddings({
        circleId: opts?.circleId,
        pageSize: opts?.pageSize,
        maxPages: opts?.maxPages,
        maxRows: opts?.maxRows,
      });
      // The debt clears only on a CLEAN, COMPLETE pass. A partial or partly
      // failed sweep keeps the ledger armed so the next one retries.
      repairSchedule = noteEmbeddingRepairRun(repairSchedule, Date.now(), {
        clearedOrphans: result.done && result.failed === 0,
      });
      if (result.embedded > 0 || result.failed > 0) {
        console.info(`[memoryEmbeddings] repair (${decision.reason}): ${result.summary}`);
      }
      return result;
    } catch (err) {
      console.warn('[memoryEmbeddings] repair sweep failed:', err);
      return { ...idle, reason: 'error' };
    }
  })();

  repairInFlight = run;
  try {
    return await run;
  } finally {
    if (repairInFlight === run) repairInFlight = null;
  }
}

/** Row counts behind the semantic-retrieval gap. Never throws. */
export async function getMemoryEmbeddingCoverage(circleId?: string): Promise<{
  total: number;
  embedded: number;
  missing: number;
  pct: number;
  healthy: boolean;
  summary: string;
}> {
  const count = async (missingOnly: boolean): Promise<number> => {
    try {
      let query = supabase
        .from('memory_entries')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);
      if (missingOnly) query = query.is('embedding', null);
      if (circleId) query = query.eq('circle_id', circleId);
      const { count: n, error } = await query;
      if (error) return 0;
      return n || 0;
    } catch {
      return 0;
    }
  };

  const total = await count(false);
  const missing = await count(true);
  const coverage = describeEmbeddingCoverage({ total, embedded: Math.max(0, total - missing) });
  return { ...coverage, summary: formatEmbeddingCoverage(coverage) };
}

/** Breaker + orphan-ledger + cursor snapshot for diagnostics and scripts. */
export function getMemoryEmbeddingRuntimeStatus(): {
  breaker: ReturnType<typeof describeEmbeddingBreaker>;
  orphanCount: number;
  repairOwed: boolean;
  lastRepairAtMs: number;
  queued: number;
  cursor: MemoryEmbeddingRepairCursor | null;
  credentialBlock: Omit<EmbeddingCredentialBlock, 'userId'> | null;
} {
  return {
    breaker: describeEmbeddingBreaker(breakerState, Date.now()),
    orphanCount: repairSchedule.orphanCount,
    repairOwed: repairSchedule.repairOwed,
    lastRepairAtMs: repairSchedule.lastRepairAtMs,
    queued: embedQueue.length,
    cursor: readPersistedCursor(),
    credentialBlock: embeddingCredentialBlock ? {
      code: embeddingCredentialBlock.code,
      provider: embeddingCredentialBlock.provider,
      sinceMs: embeddingCredentialBlock.sinceMs,
      generation: embeddingCredentialBlock.generation,
    } : null,
  };
}

/**
 * Legacy entry point (kept for compatibility — it had zero callers). Runs a
 * fresh, forced, bounded sweep from the start of the table.
 */
export async function backfillMemoryEmbeddings(opts: {
  circleId?: string;
  limit?: number;              // cap this pass; default 500
  onProgress?: (done: number, total: number) => void;
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 500, 100000));
  const pageSize = resolveRepairPageSize(Math.min(limit, BATCH_SIZE));
  const result = await repairMemoryEmbeddings({
    circleId: opts?.circleId,
    pageSize,
    maxPages: Math.min(Math.ceil(limit / pageSize), 200),
    maxRows: limit,
    resume: false,
    onProgress: (cursor) => {
      try { opts?.onProgress?.(cursor.scanned, limit); } catch { /* noop */ }
    },
  });
  return { processed: result.scanned, succeeded: result.embedded, failed: result.failed };
}

/**
 * Diagnostic: test the full embedding pipeline and report what works.
 * Call from browser console: import('./lib/memoryEmbeddings').then(m => m.diagnoseEmbeddingPipeline())
 */
export async function diagnoseEmbeddingPipeline(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = { timestamp: new Date().toISOString() };

  // 1. Test the embed proxy
  try {
    const res = await callEmbedProxy(['test diagnostic']);
    if (res?.embeddings?.length) {
      results.embedProxy = `OK — got ${res.embeddings[0].length}d vector, model=${res.model}`;
    } else {
      results.embedProxy = `FAIL — returned: ${JSON.stringify(res).slice(0, 200)}`;
    }
  } catch (e: any) { results.embedProxy = `ERROR — ${e.message}`; }

  // 2. Check embedding column exists
  try {
    const { data, error } = await supabase
      .from('memory_entries')
      .select('id, embedding_model, embedded_at')
      .not('embedding', 'is', null)
      .limit(1);
    results.embeddedRows = error ? `QUERY ERROR: ${error.message}` : `${data?.length || 0} rows with embeddings`;
  } catch (e: any) { results.embeddedRows = `ERROR — ${e.message}`; }

  // 3. Check total memories + the actual coverage gap
  try {
    const { count } = await supabase
      .from('memory_entries')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    results.totalMemories = count;
  } catch (e: any) { results.totalMemories = `ERROR — ${e.message}`; }

  try {
    results.coverage = (await getMemoryEmbeddingCoverage()).summary;
  } catch (e: any) { results.coverage = `ERROR — ${e.message}`; }

  // 4. Check match_memories RPC exists
  try {
    // Dummy vector won't match anything but tests the RPC path
    const dummyVec = Array(EMBEDDING_DIMS).fill(0);
    const { error } = await supabase.rpc('match_memories', {
      p_query_embedding: `[${dummyVec.join(',')}]`,
      p_match_count: 1,
    });
    results.matchRpc = error ? `ERROR: ${error.message}` : 'OK';
  } catch (e: any) { results.matchRpc = `ERROR — ${e.message}`; }

  // 5. Check soul_wisdom table
  try {
    const { data } = await supabase.from('soul_wisdom').select('soul_key, generated_at').limit(3);
    results.soulWisdom = data?.length ? `${data.length} entries` : 'EMPTY';
  } catch (e: any) { results.soulWisdom = `ERROR — ${e.message}`; }

  // 6. Circuit breaker + orphan ledger + resume cursor
  const status = getMemoryEmbeddingRuntimeStatus();
  results.circuitBreaker = {
    consecutiveFailures: status.breaker.consecutiveFailures,
    open: status.breaker.open,
    lastFailureAt: status.breaker.lastFailureAtMs ? new Date(status.breaker.lastFailureAtMs).toISOString() : 'never',
    retryAt: status.breaker.retryAtMs ? new Date(status.breaker.retryAtMs).toISOString() : 'n/a',
  };
  results.orphanLedger = {
    orphanCount: status.orphanCount,
    repairOwed: status.repairOwed,
    queuedForEmbedding: status.queued,
    lastRepairAt: status.lastRepairAtMs ? new Date(status.lastRepairAtMs).toISOString() : 'never',
  };
  results.repairCursor = status.cursor ? summarizeRepairCursor(status.cursor) : 'none';

  console.log('[memoryEmbeddings] DIAGNOSTIC:', JSON.stringify(results, null, 2));
  return results;
}

/**
 * Semantic memory search via the `match_memories` RPC. RLS is enforced at
 * the RPC level, so callers only ever see memories they could read through
 * the regular API.
 */
export async function semanticSearchMemories(opts: {
  queryText: string;
  circleId?: string;
  soulKey?: string;
  matchThreshold?: number;    // 0..1, default 0 (return any match, sorted)
  limit?: number;             // default 20
}): Promise<Array<{
  id: string;
  title: string;
  content: string;
  memory_kind: string;
  scope: string;
  importance: number;
  similarity: number;
  metadata: Record<string, unknown>;
}>> {
  const embedding = await embedText(opts.queryText);
  if (!embedding) return [];

  const { data, error } = await supabase.rpc('match_memories', {
    p_query_embedding: embedding,
    p_circle_id: opts.circleId ?? null,
    p_match_threshold: opts.matchThreshold ?? 0,
    p_match_count: opts.limit ?? 20,
    p_soul_key: opts.soulKey ?? null,
  });

  if (error) {
    // PGRST202 = RPC not found (migration not run yet).
    if ((error as any).code !== 'PGRST202') {
      console.warn('[memoryEmbeddings] match_memories failed:', error.message);
    }
    return [];
  }
  return (data || []) as any;
}
