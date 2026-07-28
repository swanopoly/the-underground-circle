/**
 * Agent Memory System
 *
 * Persistent memory that survives across sessions. The agent remembers
 * user preferences, project decisions, findings, and context.
 *
 * Architecture (inspired by Mem0, Letta, ChatGPT Memory):
 * - Extraction: LLM analyzes conversation and extracts memory-worthy facts
 * - Dedup: new memories are checked against existing ones for contradictions
 * - Storage: Supabase memory_entries table with scope hierarchy
 * - Retrieval: loaded into system prompt at session start
 * - Management: user can view, edit, delete memories
 */

import { supabase } from './supabase';
import {
  saveMemory,
  loadMemories,
  type MemoryScope,
  type MemoryKind,
  type MemoryEntry,
} from './agentRunSystem';
import { decideSoulMemoryRouting, type SoulMemoryRouting } from './agentSoulMemory';
import { embedAndStoreMemory } from './memoryEmbeddings';
import { shouldBlockExternalAiProvider } from './privacyMode';
import {
  buildExtractionPrompt,
  classifyExtractionOutcome,
  classifyExtractionRun,
  outcomeForParseReason,
  outcomeForSkipReason,
  parseExtractedMemories as parseExtractionResponse,
  selectExtractionRoutes,
  shouldTryNextRoute,
  DEFAULT_MIN_MESSAGES,
  type ExtractedMemoryCandidate,
  type ExtractionRoute,
  type MemoryExtractionOutcome,
} from './memoryExtractionCore';

// ── Soul Link Persistence ───────────────────────────────────────────────────
// Phase 0 of AGENT_MEMORY_GOD_PLAN: every freshly-saved memory gets routed
// through `decideSoulMemoryRouting` and the result is persisted both in the
// new `memory_soul_links` table (structured ownership) and the existing
// `metadata.soul_key`/`metadata.relevant_souls` fields (so the current panel
// UI keeps working without a concurrent refactor).

interface SoulLinkRow {
  memory_id: string;
  soul_key: string;
  role: 'primary' | 'shared' | 'reference';
  ownership_mode: SoulMemoryRouting['ownershipMode'];
  confidence: number;
  rationale: string;
  circle_id: string | null | undefined;
}

function buildSoulLinkRows(
  memoryId: string,
  circleId: string | null | undefined,
  routing: SoulMemoryRouting,
): SoulLinkRow[] {
  // agent_core memories intentionally have no SOUL link — they belong to
  // the agent as a whole. Persist the decision in metadata instead.
  if (routing.ownershipMode === 'agent_core' || !routing.primarySoulKey) return [];

  const rows: SoulLinkRow[] = [{
    memory_id: memoryId,
    soul_key: routing.primarySoulKey,
    role: 'primary',
    ownership_mode: routing.ownershipMode,
    confidence: Math.max(0, Math.min(1, routing.confidence)),
    rationale: routing.rationale,
    circle_id: circleId,
  }];

  if (routing.ownershipMode === 'shared_multi') {
    for (const key of routing.relevantSoulKeys) {
      if (!key || key === routing.primarySoulKey) continue;
      rows.push({
        memory_id: memoryId,
        soul_key: key,
        role: 'shared',
        ownership_mode: 'shared_multi',
        confidence: Math.max(0, Math.min(1, routing.confidence * 0.85)),
        rationale: routing.rationale,
        circle_id: circleId,
      });
    }
  }
  return rows;
}

async function persistSoulRouting(
  memory: MemoryEntry,
  routing: SoulMemoryRouting,
): Promise<void> {
  // 1. The new authoritative store — the join table
  const rows = buildSoulLinkRows(memory.id, memory.circle_id, routing);
  if (rows.length > 0) {
    const { error } = await supabase.from('memory_soul_links').insert(rows);
    if (error && error.code !== 'PGRST205') {
      // PGRST205 = table not yet in the schema cache (migration not run)
      console.warn('[AgentMemory] soul link insert failed:', error.message);
    }
  }

  // 2. Back-compat mirror in metadata — the panel still reads these keys
  //    (AgentMemoryPanel.dedupeMemoryGroups + getRelevantSouls). Drop once
  //    the panel migrates to the memory_with_souls view.
  try {
    const existingMeta = (memory.metadata && typeof memory.metadata === 'object')
      ? { ...memory.metadata }
      : {};
    const mirrored = {
      ...existingMeta,
      soul_key: routing.primarySoulKey,
      relevant_souls: routing.relevantSoulKeys,
      ownership_mode: routing.ownershipMode,
      soul_confidence: routing.confidence,
    };
    await supabase
      .from('memory_entries')
      .update({ metadata: mirrored })
      .eq('id', memory.id);
  } catch (err) {
    console.warn('[AgentMemory] metadata soul mirror failed:', err);
  }
}

// ── Memory Extraction ───────────────────────────────────────────────────────

// Extraction used to be hard-wired to a PLATFORM Gemini key that is only
// non-empty when EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS === 'true'. That flag
// ships `false`, so the key was `''`, extraction short-circuited before it
// ever called a model, and every caller got a clean-looking
// {saved:0,updated:0,rejected:0}. The whole "the agent remembers our
// conversations" loop captured nothing, silently.
//
// The transport now mirrors memoryEmbeddings: server-side `llm-proxy` via
// supabase.functions.invoke, keyed by the user's own marketplace providers
// (or an llm-proxy env key), with the same circuit-breaker conventions. The
// platform key survives ONLY as an optional fast path for dev builds that
// explicitly opt in.
const PLATFORM_GEMINI_KEY = process.env.EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS === 'true'
  ? process.env.EXPO_PUBLIC_GEMINI_API_KEY || ''
  : '';

type ExtractedMemory = ExtractedMemoryCandidate;

/** Extraction is a background per-turn job; never spend real latency on it. */
const EXTRACTION_MAX_TOKENS = 1024;
const EXTRACTION_TIMEOUT_MS = 20_000;

// Circuit breaker — same shape as memoryEmbeddings.callEmbedProxy. Extraction
// fires on every assistant turn, so a broken proxy must not be retried on each
// one; N consecutive failures park the feature for the backoff window.
let extractionFailures = 0;
const MAX_EXTRACTION_FAILURES = 5;
const EXTRACTION_BACKOFF_MS = 5 * 60 * 1000;
let lastExtractionFailureAt = 0;

// Provider discovery is a DB round-trip; cache it for the session.
let providerCache: { at: number; providers: string[] } | null = null;
const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadAvailableProviders(): Promise<string[]> {
  const now = Date.now();
  if (providerCache && now - providerCache.at < PROVIDER_CACHE_TTL_MS) return providerCache.providers;
  try {
    const { listApiKeys } = await import('./llmProviders');
    const keys = await listApiKeys();
    const providers = (keys || [])
      .filter(k => k && k.isActive !== false && typeof k.provider === 'string')
      .map(k => String(k.provider));
    providerCache = { at: now, providers };
    return providers;
  } catch (err) {
    console.warn('[AgentMemory] provider discovery failed:', err);
    // Cache the empty answer briefly so a broken RPC doesn't get hammered;
    // platform-env routes are still attempted below.
    providerCache = { at: now, providers: [] };
    return [];
  }
}

/** Read the `{ error, code }` JSON body off a non-2xx functions.invoke
 *  failure (supabase-js hands it back as FunctionsHttpError with the Response
 *  on `.context`). Best-effort — any shape problem returns nulls. */
async function readProxyErrorBody(error: unknown): Promise<{ code?: string; status?: number }> {
  const status = typeof (error as any)?.context?.status === 'number'
    ? (error as any).context.status as number
    : typeof (error as any)?.status === 'number' ? (error as any).status as number : undefined;
  try {
    const ctx = (error as any)?.context;
    if (!ctx) return { status };
    const body = typeof ctx.clone === 'function'
      ? await ctx.clone().json()
      : typeof ctx.json === 'function' ? await ctx.json() : null;
    const code = typeof body?.code === 'string' ? body.code : undefined;
    return { code, status };
  } catch {
    return { status };
  }
}

interface ExtractionCallResult {
  text: string | null;
  route: ExtractionRoute | null;
  /** Set when no route produced a response. */
  failure: 'no_provider' | 'provider_error' | 'blocked' | null;
  detail: string;
}

/** Optional dev fast path: direct Gemini, only when the platform-key flag is on. */
async function callPlatformGemini(prompt: { system: string; user: string }): Promise<string | null> {
  if (!PLATFORM_GEMINI_KEY) return null;
  if (shouldBlockExternalAiProvider('google_ai')) return null;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${PLATFORM_GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt.system}\n\n${prompt.user}` }] }],
          generationConfig: { maxOutputTokens: EXTRACTION_MAX_TOKENS, temperature: 0.1 },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.warn('[AgentMemory] platform Gemini fast path failed:', e);
    return null;
  }
}

/**
 * Run the extraction prompt through `llm-proxy`, walking the candidate routes
 * until one answers. Returns which route answered so callers can report it.
 */
async function callExtractionModel(prompt: { system: string; user: string }): Promise<ExtractionCallResult> {
  // Circuit breaker first — a dead proxy must not cost a round trip per turn.
  if (extractionFailures >= MAX_EXTRACTION_FAILURES && Date.now() - lastExtractionFailureAt < EXTRACTION_BACKOFF_MS) {
    return { text: null, route: null, failure: 'provider_error', detail: 'Extraction circuit breaker open after repeated failures.' };
  }

  const fastPath = await callPlatformGemini(prompt);
  if (fastPath) {
    extractionFailures = 0;
    return { text: fastPath, route: { provider: 'google_ai', model: 'gemini-2.5-flash', source: 'override' }, failure: null, detail: 'platform key fast path' };
  }

  const availableProviders = await loadAvailableProviders();
  const blockedProviders = [...new Set([...availableProviders, 'anthropic', 'google_ai', 'zai', 'minimax'])]
    .filter(p => shouldBlockExternalAiProvider(p));
  const routes = selectExtractionRoutes({ availableProviders, blockedProviders });

  if (routes.length === 0) {
    const detail = blockedProviders.length > 0
      ? 'Memory extraction blocked by strict local AI mode.'
      : 'No model provider available for memory extraction — connect a provider key in Marketplace.';
    return { text: null, route: null, failure: blockedProviders.length > 0 ? 'blocked' : 'no_provider', detail };
  }

  let lastDetail = '';
  for (const route of routes) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // functions.invoke has no timeout of its own; a hung provider would
      // otherwise keep a background extraction alive for the whole session.
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller) timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

      const { data, error } = await supabase.functions.invoke('llm-proxy', {
        body: {
          provider: route.provider,
          model: route.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          max_tokens: EXTRACTION_MAX_TOKENS,
          temperature: 0,
          thinkingLevel: 'fast',
        },
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (error) {
        const { code, status } = await readProxyErrorBody(error);
        lastDetail = `llm-proxy ${route.provider}: ${code || (error as any)?.message || 'error'}`;
        if (shouldTryNextRoute(code, status)) continue;
        extractionFailures += 1;
        lastExtractionFailureAt = Date.now();
        return { text: null, route, failure: 'provider_error', detail: lastDetail };
      }
      if (data?.error) {
        lastDetail = `llm-proxy ${route.provider}: ${String(data.error).slice(0, 160)}`;
        continue;
      }
      const text = typeof data?.response === 'string' ? data.response : '';
      if (!text.trim()) {
        lastDetail = `llm-proxy ${route.provider} returned an empty response.`;
        continue;
      }
      extractionFailures = 0;
      return { text, route, failure: null, detail: `${route.provider}/${route.model} (${route.source})` };
    } catch (err) {
      lastDetail = `llm-proxy ${route.provider} threw: ${(err as Error)?.message || String(err)}`;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  extractionFailures += 1;
  lastExtractionFailureAt = Date.now();
  // Every route refused a key ⇒ the user genuinely has no usable provider.
  const allKeyMissing = /key_missing/.test(lastDetail);
  return {
    text: null,
    route: null,
    failure: allKeyMissing ? 'no_provider' : 'provider_error',
    detail: lastDetail || 'All extraction routes failed.',
  };
}

/**
 * Rich extraction result. `outcome` is the field that fixes the original
 * defect: an empty `memories` array now means either "the model read the
 * conversation and there was nothing durable in it" (`nothing_to_save`) or
 * "extraction never reached a model" (`no_provider` / `provider_error` /
 * `parse_failed`) — and those are no longer the same observable state.
 */
export interface MemoryExtractionResult {
  memories: ExtractedMemory[];
  outcome: MemoryExtractionOutcome;
  /** True only when a model actually answered. */
  ran: boolean;
  /** Operator-facing sentence. Contains no user content and no secrets. */
  detail: string;
  provider?: string;
  model?: string;
}

/**
 * Extract memories from a conversation using LLM analysis, reporting WHY when
 * nothing came back. Routes through the server-side `llm-proxy` so it works
 * without any client-side platform key.
 */
export async function extractMemoriesFromConversationDetailed(
  messages: Array<{ role: string; text: string }>,
  existingMemories: MemoryEntry[],
  opts?: { minMessages?: number },
): Promise<MemoryExtractionResult> {
  // Cheap local gates first — a 1-turn conversation should never cost a
  // provider lookup, let alone a model call.
  const decision = classifyExtractionRun({
    messages,
    hasProvider: true, // real provider resolution happens in callExtractionModel
    minMessages: opts?.minMessages ?? DEFAULT_MIN_MESSAGES,
  });
  if (!decision.shouldRun) {
    const report = classifyExtractionOutcome({
      outcome: outcomeForSkipReason(decision.reason),
      detail: decision.detail,
    });
    if (report.shouldWarn) console.warn('[AgentMemory] extraction did not run:', report.outcome, '—', report.detail);
    return { memories: [], outcome: report.outcome, ran: false, detail: report.detail };
  }

  const prompt = buildExtractionPrompt({ messages: decision.messages, existingMemories });
  const call = await callExtractionModel(prompt);

  if (!call.text) {
    const report = classifyExtractionOutcome({
      outcome: call.failure || 'provider_error',
      detail: call.detail,
    });
    // THE observability contract: a broken extraction pipeline is loud.
    if (report.shouldWarn) console.warn('[AgentMemory] extraction did not run:', report.outcome, '—', report.detail);
    return {
      memories: [],
      outcome: report.outcome,
      ran: false,
      detail: report.detail,
      provider: call.route?.provider,
      model: call.route?.model,
    };
  }

  const parsed = parseExtractionResponse(call.text);
  const report = classifyExtractionOutcome({
    outcome: outcomeForParseReason(parsed.reason),
    candidateCount: parsed.memories.length,
    detail: parsed.parseOk
      ? `${parsed.memories.length} candidate(s) from ${call.detail}.`
      : `Model response was unusable (${parsed.reason}) from ${call.detail}.`,
  });
  if (report.shouldWarn) {
    console.warn('[AgentMemory] extraction response unusable:', report.detail, '| head:', call.text.slice(0, 200));
  }

  return {
    memories: parsed.memories,
    outcome: report.outcome,
    ran: report.ran,
    detail: report.detail,
    provider: call.route?.provider,
    model: call.route?.model,
  };
}

/**
 * Back-compat shape for existing callers — unchanged signature and return
 * type. Prefer `extractMemoriesFromConversationDetailed` for new code.
 */
export async function extractMemoriesFromConversation(
  messages: Array<{ role: string; text: string }>,
  existingMemories: MemoryEntry[],
): Promise<ExtractedMemory[]> {
  const result = await extractMemoriesFromConversationDetailed(messages, existingMemories);
  return result.memories;
}

// ── Auto-Extract and Save ───────────────────────────────────────────────────

/**
 * Result of one auto-extract pass.
 *
 * `saved`/`updated`/`rejected` are unchanged so existing callers (notably
 * ChatTab, which destructures `{ saved }`) keep compiling untouched. Every
 * diagnostic field is OPTIONAL and additive — read `outcome`/`ran` to tell
 * "nothing worth saving" apart from "extraction never happened".
 */
export interface AutoExtractResult {
  saved: number;
  updated: number;
  rejected: number;
  /** Why this pass produced what it produced. */
  outcome?: MemoryExtractionOutcome;
  /** True only when a model actually read the conversation. */
  ran?: boolean;
  /** Candidates the model returned before the quality gate and dedupe. */
  extracted?: number;
  /** Operator-facing sentence; safe to log or show in a diagnostics panel. */
  detail?: string;
  provider?: string;
  model?: string;
}

/**
 * Run memory extraction on a conversation and save results.
 * Deduplicates against existing, quality-gates candidates, detects contradictions.
 */
export async function autoExtractAndSave(
  circleId: string,
  userId: string,
  messages: Array<{ role: string; text: string }>,
): Promise<AutoExtractResult> {
  // Load existing memories for dedup (scoped to this user for user memories)
  const existing = await loadMemories({ circleId, userId, scopes: ['circle', 'user'], limit: 100 });

  // Extract new memories. The detailed call reports WHY it produced nothing;
  // the old boolean-ish path made "no provider" look identical to "nothing
  // worth saving", which is what silently emptied this whole feature.
  const extraction = await extractMemoriesFromConversationDetailed(messages, existing);
  const diagnostics = {
    outcome: extraction.outcome,
    ran: extraction.ran,
    extracted: extraction.memories.length,
    detail: extraction.detail,
    provider: extraction.provider,
    model: extraction.model,
  };
  const extracted = extraction.memories;
  if (extracted.length === 0) return { saved: 0, updated: 0, rejected: 0, ...diagnostics };

  let saved = 0;
  let updated = 0;
  let rejected = 0;

  // Import quality gate
  let isHighQuality: (c: { kind: string; title: string; content: string }) => boolean;
  try {
    const mod = await import('./memoryConsolidation');
    isHighQuality = mod.isHighQualityMemory;
  } catch {
    isHighQuality = () => true; // fallback: accept all
  }

  for (const mem of extracted) {
    // Quality gate: reject noise
    if (!isHighQuality(mem)) { rejected++; continue; }
    // Improved dedup: check title similarity + content overlap
    const titleLower = mem.title.toLowerCase();
    const contentLower = mem.content.toLowerCase();
    const duplicate = existing.find(e => {
      const eTitleLower = e.title.toLowerCase();
      const eContentLower = e.content.toLowerCase();
      // Exact title match
      if (eTitleLower === titleLower) return true;
      // Title contains the other
      if (eTitleLower.includes(titleLower) || titleLower.includes(eTitleLower)) return true;
      // Content substantially overlaps (>60% of shorter string)
      const shorter = contentLower.length < eContentLower.length ? contentLower : eContentLower;
      const longer = contentLower.length < eContentLower.length ? eContentLower : contentLower;
      if (shorter.length > 20 && longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.6)))) return true;
      return false;
    });

    if (duplicate) {
      // Update existing memory — supersedes the old version
      try {
        const { error } = await supabase
          .from('memory_entries')
          .update({
            content: mem.content,
            memory_kind: mem.kind,
            updated_at: new Date().toISOString(),
          })
          .eq('id', duplicate.id);
        if (error) {
          console.warn('[AgentMemory] Update failed:', error.message);
          rejected++;
        } else {
          updated++;
          // Content changed → existing embedding is stale. Re-embed in the
          // background so semantic retrieval reflects the current wording.
          void embedAndStoreMemory({
            memoryId: duplicate.id,
            title: duplicate.title,
            content: mem.content,
          }).catch(err => console.warn('[AgentMemory] re-embed failed (non-fatal):', err));
        }
      } catch (e) {
        console.warn('[AgentMemory] Update error:', e);
        rejected++;
      }
    } else {
      // Save new memory with proper scope, importance, and retrieval mode.
      // NOTE: scope (user/circle/agent/…) answers "who owns this row in the
      // visibility sense"; soul routing is a separate dimension that answers
      // "which persona(s) is this memory about." Both are captured.
      const scope: MemoryScope = ['preference', 'instruction'].includes(mem.kind) ? 'user' : 'circle';
      const importance = mem.kind === 'instruction' ? 0.9 : mem.kind === 'decision' ? 0.8 : mem.kind === 'preference' ? 0.7 : 0.5;
      const retrievalMode = ['instruction', 'preference'].includes(mem.kind) ? 'startup' : 'on_demand';

      const result = await saveMemory({
        scope,
        circleId,
        userId: scope === 'user' ? userId : undefined,
        memoryKind: mem.kind as MemoryKind,
        title: mem.title,
        content: mem.content,
        sourceSurface: 'main_chat',
        importance,
        retrievalMode: retrievalMode as any,
        visibility: scope === 'user' ? 'private' : 'circle_shared',
      });

      if (result) {
        // Phase 0: route to SOUL(s) and persist the links. The router
        // inspects the memory content and picks 0–3 SOULs; agent_core
        // memories get no link at all (they belong to the agent itself).
        try {
          const routing = decideSoulMemoryRouting({
            text: `${mem.title}\n${mem.content}`,
          });
          await persistSoulRouting(result, routing);
        } catch (err) {
          console.warn('[AgentMemory] soul routing failed (non-fatal):', err);
        }

        // Phase 1: embed for semantic retrieval. Fire-and-forget — we never
        // block the user's turn on an embedding call. Failures leave the row
        // un-embedded; the next backfill pass will catch it.
        void embedAndStoreMemory({
          memoryId: result.id,
          title: mem.title,
          content: mem.content,
        }).catch(err => console.warn('[AgentMemory] embed failed (non-fatal):', err));

        saved++;
      } else {
        rejected++;
      }
    }
  }

  // Run consolidation after extraction to merge duplicates
  try {
    const { consolidateMemories } = await import('./memoryConsolidation');
    await consolidateMemories(circleId);
  } catch {}

  return { saved, updated, rejected, ...diagnostics };
}

// ── Memory Management (User-Facing) ─────────────────────────────────────────

/**
 * Get all memories for a user, grouped by scope and kind.
 */
export async function getUserMemories(
  circleId: string,
  userId?: string,
  agentId?: string,
): Promise<{
  circle: MemoryEntry[];
  agent: MemoryEntry[];
  user: MemoryEntry[];
  session: MemoryEntry[];
  total: number;
}> {
  const scopes: MemoryScope[] = agentId ? ['circle', 'agent', 'user', 'session'] : ['circle', 'user', 'session'];
  const all = await loadMemories({ circleId, userId, agentId, scopes, limit: 200 });

  const circle = all.filter(m => m.scope === 'circle');
  const agent = all.filter(m => m.scope === 'agent');
  const user = all.filter(m => m.scope === 'user');
  const session = all.filter(m => m.scope === 'session');

  return { circle, agent, user, session, total: all.length };
}

/**
 * Edit a memory's content.
 */
export async function editMemory(
  memoryId: string,
  updates: {
    title?: string;
    content?: string;
    memory_kind?: MemoryKind;
    retrieval_mode?: 'startup' | 'on_demand' | 'manual_only';
  },
): Promise<boolean> {
  const patch = { ...updates, updated_at: new Date().toISOString() };
  // The embedding is built from `${title}\n${content}` (memoryEmbeddings), so
  // BOTH fields invalidate it. Without this, a user who corrects a wrong
  // memory keeps getting it retrieved semantically on the OLD wording — the
  // auto-update branch in autoExtractAndSave already re-embeds; the
  // user-facing edit path did not. That asymmetry broke the product's
  // "see why the agent said it, and fix it" guarantee.
  const touchesEmbedding = typeof updates?.title === 'string' || typeof updates?.content === 'string';

  if (!touchesEmbedding) {
    const { error } = await supabase.from('memory_entries').update(patch).eq('id', memoryId);
    return !error;
  }

  // `.select()` returns the post-update row, so we re-embed the FULL new text
  // even when the caller only patched one of the two fields.
  const { data, error } = await supabase
    .from('memory_entries')
    .update(patch)
    .eq('id', memoryId)
    .select('id, title, content');
  if (error) return false;

  const row = Array.isArray(data) ? data[0] : null;
  const title = typeof row?.title === 'string' ? row.title : (typeof updates.title === 'string' ? updates.title : '');
  const content = typeof row?.content === 'string' ? row.content : (typeof updates.content === 'string' ? updates.content : '');
  // No row back (RLS-hidden or no match) ⇒ nothing actually changed to embed.
  if (row && (title || content)) {
    // Fire-and-forget, same convention as the auto-update branch: never block
    // a user's edit on embedding latency; the backfill sweep catches misses.
    void embedAndStoreMemory({ memoryId, title, content })
      .catch(err => console.warn('[AgentMemory] re-embed after edit failed (non-fatal):', err));
  }
  return true;
}

/**
 * Delete a memory (soft-delete by deactivating).
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  return !error;
}

/**
 * Hard delete a memory permanently.
 */
export async function permanentlyDeleteMemory(memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .delete()
    .eq('id', memoryId);
  return !error;
}

/**
 * Search memories by keyword.
 */
export async function searchMemories(
  circleId: string,
  query: string,
  limit: number = 20,
): Promise<MemoryEntry[]> {
  // Use Supabase text search
  const { data, error } = await supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((d: any) => ({
    id: d.id, scope: d.scope, circle_id: d.circle_id, room_id: d.room_id,
    agent_id: d.agent_id, user_id: d.user_id, session_id: d.session_id,
    memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, is_active: d.is_active,
    source_surface: d.source_surface, visibility: d.visibility, importance: d.importance,
    retrieval_mode: d.retrieval_mode, updated_at: d.updated_at, created_at: d.created_at,
    metadata: d.metadata || {},
  }));
}

// ── Memory Stats ────────────────────────────────────────────────────────────

export async function getMemoryStats(circleId: string): Promise<{
  total: number;
  byScope: Record<string, number>;
  byKind: Record<string, number>;
  oldestMemory?: string;
  newestMemory?: string;
}> {
  const all = await loadMemories({ circleId, limit: 500 });

  const byScope: Record<string, number> = {};
  const byKind: Record<string, number> = {};

  for (const m of all) {
    byScope[m.scope] = (byScope[m.scope] || 0) + 1;
    byKind[m.memory_kind] = (byKind[m.memory_kind] || 0) + 1;
  }

  return {
    total: all.length,
    byScope,
    byKind,
    oldestMemory: all.length > 0 ? all[all.length - 1].created_at : undefined,
    newestMemory: all.length > 0 ? all[0].created_at : undefined,
  };
}
