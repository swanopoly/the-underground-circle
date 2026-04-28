/**
 * memoryActions — Phase M5 of the OpenSwan/Chat Architecture Plan.
 *
 * User-facing memory actions: pin, flag, edit, rage-forget, decay
 * importance. Thin wrappers over supabase writes + the memory_access_log
 * audit trail so every destructive action is reversible/traceable.
 */

import { supabase } from './supabase';
import { semanticSearchMemories } from './memoryEmbeddings';

export type MemoryFeedbackAction =
  | 'accepted'
  | 'confirmed_helpful'
  | 'dismissed'
  | 'not_helpful'
  | 'weak_signal'
  | 'promoted'
  | 'pinned';

export async function markMemoryReviewState(
  memoryId: string,
  decision: 'accepted' | 'dismissed' | 'pinned' | 'promoted',
): Promise<boolean> {
  const { data } = await supabase
    .from('memory_entries')
    .select('metadata')
    .eq('id', memoryId)
    .single();
  const nextMetadata = {
    ...(data?.metadata || {}),
    review_status: decision,
    reviewed_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('memory_entries')
    .update({
      metadata: nextMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', memoryId);
  return !error;
}

export async function recordMemoryFeedback(opts: {
  memoryId: string;
  action: MemoryFeedbackAction;
  note?: string;
  userId?: string;
  source?: string;
  scoreOverride?: number;
  passedOverride?: boolean | null;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const baseScore =
    opts.action === 'accepted' || opts.action === 'confirmed_helpful' || opts.action === 'promoted' || opts.action === 'pinned'
      ? 1
      : opts.action === 'weak_signal'
        ? 0.2
      : opts.action === 'dismissed' || opts.action === 'not_helpful'
        ? 0
        : null;
  const score = typeof opts.scoreOverride === 'number'
    ? Math.max(0, Math.min(1, opts.scoreOverride))
    : baseScore;
  const passed = opts.passedOverride !== undefined
    ? opts.passedOverride
    : score == null ? null : score >= 0.5;
  const { error } = await supabase
    .from('memory_evaluations')
    .insert({
      memory_id: opts.memoryId,
      evaluation_kind: 'manual_review',
      evaluator: 'user',
      passed,
      score,
      feedback: opts.note || null,
      metadata: {
        action: opts.action,
        source: opts.source || 'chat_ui',
        user_id: opts.userId || null,
        ...(opts.metadata || {}),
      },
    });
  return !error;
}

// ── Pin / Unpin ─────────────────────────────────────────────────────────────

export async function pinMemory(memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .update({ pinned: true, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  return !error;
}

export async function unpinMemory(memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .update({ pinned: false, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  return !error;
}

// ── Importance decay (user flags a memory as "not helpful") ─────────────────

export async function decayMemoryImportance(
  memoryId: string,
  decayAmount = 0.15,
): Promise<boolean> {
  const { data } = await supabase
    .from('memory_entries')
    .select('importance')
    .eq('id', memoryId)
    .single();
  if (!data) return false;
  const current = (data.importance as number) || 0.5;
  const next = Math.max(0, current - decayAmount);
  const { error } = await supabase
    .from('memory_entries')
    .update({ importance: next, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  return !error;
}

// ── Promote (boost importance + set to startup retrieval) ───────────────────

export async function promoteMemory(memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .update({
      importance: 0.95,
      retrieval_mode: 'startup',
      pinned: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', memoryId);
  return !error;
}

// ── Soft delete ─────────────────────────────────────────────────────────────

export async function softDeleteMemory(
  memoryId: string,
  userId: string,
  reason?: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  if (error) return false;
  // Audit trail
  try {
    await supabase.from('memory_access_log').insert({
      memory_id: memoryId,
      user_id: userId,
      reason: 'manual_pin',
      surface: reason || 'user_delete',
    });
  } catch { /* non-critical */ }
  return true;
}

// ── Rage forget ─────────────────────────────────────────────────────────────
// Deactivates every memory matching a query (semantic + keyword), scoped
// to the current circle. Returns the IDs so the UI can offer an undo.

export interface RageForgetResult {
  deactivated: string[];
  query: string;
}

export async function rageForget(opts: {
  circleId: string;
  userId: string;
  query: string;
  dryRun?: boolean;
}): Promise<RageForgetResult> {
  const { circleId, userId, query, dryRun } = opts;
  if (!query.trim()) return { deactivated: [], query };

  // Semantic candidate pool + keyword fallback
  const candidates = await semanticSearchMemories({
    queryText: query,
    circleId,
    matchThreshold: 0.65,
    limit: 50,
  });

  // Also do keyword search for memories without embeddings
  const qLower = query.toLowerCase();
  const { data: keywordHits } = await supabase
    .from('memory_entries')
    .select('id')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .or(`title.ilike.%${qLower}%,content.ilike.%${qLower}%`)
    .limit(50);

  const idSet = new Set<string>();
  for (const c of candidates) idSet.add(c.id);
  for (const k of keywordHits || []) idSet.add((k as any).id);

  const ids = Array.from(idSet);
  if (ids.length === 0) return { deactivated: [], query };
  if (dryRun) return { deactivated: ids, query };

  // Soft-delete all matches
  const { error } = await supabase
    .from('memory_entries')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .in('id', ids);
  if (error) {
    console.warn('[memoryActions] rageForget update failed:', error.message);
    return { deactivated: [], query };
  }

  // Audit trail for each one (batch)
  try {
    await supabase.from('memory_access_log').insert(
      ids.map(id => ({
        memory_id: id,
        user_id: userId,
        reason: 'manual_pin' as const,
        surface: `rage_forget:${query.slice(0, 100)}`,
      })),
    );
  } catch { /* non-critical */ }

  return { deactivated: ids, query };
}

// ── Undo rage forget ────────────────────────────────────────────────────────

export async function undoRageForget(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase
    .from('memory_entries')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .in('id', ids)
    .select('id');
  if (error) return 0;
  return (data || []).length;
}

// ── Load memory citations for a run ─────────────────────────────────────────
// Queries memory_access_log by surface or by run_id so the UI can show
// "which memories were used for this message."

export interface MemoryCitation {
  memoryId: string;
  title: string;
  content: string;
  memoryKind: string;
  scope: string;
  importance: number;
  soulKey: string | null;
  reason: string;
  surface: string;
  citedAt: string;
}

export async function loadCitationsForMessage(opts: {
  userId: string;
  surface: string;
  after: string;     // ISO timestamp — messages since this time
  before: string;    // ISO timestamp
}): Promise<MemoryCitation[]> {
  try {
    const { data, error } = await supabase
      .from('memory_access_log')
      .select(`
        memory_id, reason, surface, created_at,
        memory:memory_entries!inner (
          title, content, memory_kind, scope, importance, metadata
        )
      `)
      .eq('user_id', opts.userId)
      .eq('reason', 'retrieval')
      .gte('created_at', opts.after)
      .lte('created_at', opts.before)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error || !data) return [];
    return (data as any[]).map(row => ({
      memoryId: row.memory_id,
      title: row.memory?.title || '',
      content: row.memory?.content || '',
      memoryKind: row.memory?.memory_kind || '',
      scope: row.memory?.scope || '',
      importance: row.memory?.importance || 0,
      soulKey: row.memory?.metadata?.soul_key || null,
      reason: row.reason,
      surface: row.surface || '',
      citedAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

// Newer, more reliable variant — keys off the persisted message_id rather
// than a timestamp window. Used when we have the assistant message's
// dbId; the migration 20260428_memory_inspect_control.sql backs it via
// the get_memory_citations RPC.
export async function loadCitationsByAssistantMessage(
  assistantMessageId: string,
): Promise<MemoryCitation[]> {
  if (!assistantMessageId) return [];
  try {
    const { data, error } = await supabase.rpc('get_memory_citations', {
      p_assistant_message_id: assistantMessageId,
    });
    if (error || !data) return [];
    return (data as any[]).map(row => ({
      memoryId: row.memory_id,
      title: row.title || '',
      content: row.content || '',
      memoryKind: row.memory_kind || '',
      scope: row.scope || '',
      importance: row.importance || 0,
      // soul_key isn't joined by the RPC yet; future enhancement.
      soulKey: null,
      reason: row.reason || 'retrieval',
      surface: row.surface || '',
      citedAt: row.accessed_at,
    }));
  } catch {
    return [];
  }
}
