/**
 * memoryEmbeddings — Phase 1 of AGENT_MEMORY_GOD_PLAN.
 *
 * Thin client for embedding memory text via the `llm-proxy` edge fn
 * (provider: 'openai-embed'), plus a fire-and-forget helper that stores
 * the resulting vector on `memory_entries`.
 *
 * Design notes:
 *   * All calls are fire-and-forget from the user's perspective — we never
 *     block the UI on embedding latency. On failure we log and move on;
 *     the row simply stays un-embedded and can be picked up by the
 *     backfill sweep later.
 *   * The model name and dimensions are recorded on the row so we can
 *     safely migrate providers (re-embed only rows whose model differs).
 *   * Batch size ceiling = 50 per request. OpenAI accepts larger batches
 *     but bigger batches → larger responses → slower user-visible calls
 *     during interactive backfill.
 */

import { supabase } from './supabase';
import { shouldBlockExternalAiProvider } from './privacyMode';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;
const BATCH_SIZE = 50;

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  input_tokens: number;
}

// Track consecutive failures to avoid hammering a broken endpoint
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;
const BACKOFF_RESET_MS = 5 * 60 * 1000; // 5 min
let lastFailureAt = 0;

async function callEmbedProxy(inputs: string[]): Promise<EmbedResponse | null> {
  if (inputs.length === 0) return { embeddings: [], model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMS, input_tokens: 0 };
  if (shouldBlockExternalAiProvider('openai')) return null;

  // Circuit breaker — if we've failed N times in a row, stop trying for 5 min
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && Date.now() - lastFailureAt < BACKOFF_RESET_MS) {
    return null;
  }

  try {
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      body: {
        provider: 'openai-embed',
        model: EMBEDDING_MODEL,
        input: inputs,
        messages: [],
      },
    });
    if (error) {
      consecutiveFailures++;
      lastFailureAt = Date.now();
      console.warn('[memoryEmbeddings] proxy error:', error.message, '| status:', (error as any).status, '| context:', JSON.stringify(error).slice(0, 200));
      return null;
    }
    if (!data?.embeddings || !Array.isArray(data.embeddings) || data.embeddings.length === 0) {
      consecutiveFailures++;
      lastFailureAt = Date.now();
      console.warn('[memoryEmbeddings] proxy returned unexpected data:', JSON.stringify(data).slice(0, 300));
      return null;
    }
    // Success — reset circuit breaker
    consecutiveFailures = 0;
    return data as EmbedResponse;
  } catch (err) {
    consecutiveFailures++;
    lastFailureAt = Date.now();
    console.warn('[memoryEmbeddings] proxy call failed:', err);
    return null;
  }
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
 */
export async function embedAndStoreMemory(opts: {
  memoryId: string;
  title: string;
  content: string;
}): Promise<boolean> {
  const combined = `${opts.title}\n${opts.content}`.trim();
  if (!combined) return false;
  const vector = await embedText(combined);
  if (!vector) {
    console.warn(`[memoryEmbeddings] embedText returned null for memory ${opts.memoryId.slice(0, 8)} — embedding skipped`);
    return false;
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
    console.warn(`[memoryEmbeddings] unexpected vector shape: length=${vector?.length}, expected=${EMBEDDING_DIMS}`);
    return false;
  }
  // pgvector expects the vector as a JSON array string "[0.1, 0.2, ...]"
  const vectorStr = `[${vector.join(',')}]`;
  const { error } = await supabase
    .from('memory_entries')
    .update({
      embedding: vectorStr as any,
      embedding_model: EMBEDDING_MODEL,
      embedded_at: new Date().toISOString(),
    })
    .eq('id', opts.memoryId);
  if (error) {
    // PGRST204 = column not in schema cache yet (migration not run).
    if ((error as any).code !== 'PGRST204' && (error as any).code !== '42703') {
      console.warn('[memoryEmbeddings] store failed:', error.message);
    }
    return false;
  }
  return true;
}

/**
 * Backfill embeddings for memories that don't have one yet.
 * Processes in batches of BATCH_SIZE; returns a summary.
 *
 * Intended to be called from an admin screen or on-demand; once we wire a
 * Supabase cron it can be invoked from there too.
 */
export async function backfillMemoryEmbeddings(opts: {
  circleId?: string;
  limit?: number;              // cap this pass; default 500
  onProgress?: (done: number, total: number) => void;
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = opts.limit ?? 500;
  let query = supabase
    .from('memory_entries')
    .select('id, title, content')
    .eq('is_active', true)
    .is('embedding', null)
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (opts.circleId) query = query.eq('circle_id', opts.circleId);

  const { data: rows, error } = await query;
  if (error || !rows) {
    console.warn('[memoryEmbeddings] backfill fetch failed:', error?.message);
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  const total = rows.length;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(r => `${r.title}\n${r.content}`.slice(0, 30000));
    const res = await callEmbedProxy(inputs);
    if (!res) {
      failed += batch.length;
      opts.onProgress?.(Math.min(i + BATCH_SIZE, total), total);
      continue;
    }

    // Write back — sequential updates because Supabase JS doesn't expose a
    // bulk upsert that preserves the IDs we need per row.
    await Promise.all(batch.map(async (row, j) => {
      const vector = res.embeddings[j];
      if (!vector) { failed++; return; }
      const { error: upErr } = await supabase
        .from('memory_entries')
        .update({
          embedding: vector,
          embedding_model: res.model,
          embedded_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (upErr) { failed++; } else { succeeded++; }
    }));

    opts.onProgress?.(Math.min(i + BATCH_SIZE, total), total);
  }

  return { processed: total, succeeded, failed };
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

  // 3. Check total memories
  try {
    const { count } = await supabase
      .from('memory_entries')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    results.totalMemories = count;
  } catch (e: any) { results.totalMemories = `ERROR — ${e.message}`; }

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

  // 6. Circuit breaker status
  results.circuitBreaker = { consecutiveFailures, lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : 'never' };

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
