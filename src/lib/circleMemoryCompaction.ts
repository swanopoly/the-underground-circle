/**
 * circleMemoryCompaction — Phase 4. Keeps the shared `circle_memory` doc
 * bounded so it fits inside the frozen prompt block alongside everything
 * else (mode contract, skills table, circle snapshot).
 *
 * Flow:
 *   1. `checkCircleMemorySize(circleId)` → returns `{ size, overBudget }`.
 *      Cheap: single indexed read. Callers can poll this on a cron or
 *      fire it opportunistically after any `circle_memory` update.
 *   2. `proposeMemoryCompaction(circleId, opts)` → if over budget, files
 *      a `memory.compact` HITL approval with the current content. A
 *      reviewer (or the companion LLM worker) produces the compacted
 *      version; `applyApprovedMemoryCompaction` commits it.
 *   3. The agent is NEVER allowed to rewrite `circle_memory` directly —
 *      see AGENTS_ROADMAP §6 rule 4.
 *
 * Budget: Phase 4 targets ~4000 chars (~1000 tokens) for the shared
 * circle doc. This leaves room for skill table + user notes + mode
 * contract inside the frozen block. Tunable per-circle via
 * `circles.settings.circle_memory_max_chars`.
 */

import { supabase } from './supabase';

const DEFAULT_MAX_CHARS = 4000;
const COMPACTION_TRIGGER_MULTIPLIER = 1.1; // 10% overage before we propose
const COMPACTION_COOLDOWN_HOURS = 24;

export type MemorySizeCheck = {
  circleId: string;
  contentLength: number;
  lastEditedAt: string | null;
  maxChars: number;
  overBudget: boolean;
  pendingCompactionId: string | null;
  cooldownActiveUntil: string | null;
};

export async function checkCircleMemorySize(
  circleId: string,
): Promise<MemorySizeCheck | null> {
  // Fetch the memory doc + circle settings in parallel so we apply the
  // right per-circle budget.
  const [{ data: memoryRow, error: mErr }, { data: circleRow }] = await Promise.all([
    supabase
      .from('circle_memory')
      .select('content, last_edited_at')
      .eq('circle_id', circleId)
      .maybeSingle(),
    supabase
      .from('circles')
      .select('settings')
      .eq('id', circleId)
      .maybeSingle(),
  ]);

  if (mErr) {
    console.warn('[circleMemoryCompaction] read failed:', mErr.message);
    return null;
  }

  const settings = (circleRow?.settings || {}) as Record<string, unknown>;
  const configuredMax = Number(settings.circle_memory_max_chars);
  const maxChars = Number.isFinite(configuredMax) && configuredMax > 500 ? configuredMax : DEFAULT_MAX_CHARS;

  const content = (memoryRow?.content || '').toString();
  const contentLength = content.length;

  // Look for an existing pending compaction so we don't double-file.
  const { data: pending } = await supabase
    .from('agent_approvals')
    .select('id, requested_at')
    .eq('circle_id', circleId)
    .eq('action_type', 'memory.compact')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const pendingCompactionId = pending?.id ?? null;
  const cooldownActiveUntil = pending?.requested_at
    ? new Date(new Date(pending.requested_at).getTime() + COMPACTION_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()
    : null;

  return {
    circleId,
    contentLength,
    lastEditedAt: memoryRow?.last_edited_at ?? null,
    maxChars,
    overBudget: contentLength > maxChars * COMPACTION_TRIGGER_MULTIPLIER,
    pendingCompactionId,
    cooldownActiveUntil,
  };
}

export type ProposeCompactionResult =
  | { ok: true; approvalId: string; proposedSummary: string; originalChars: number }
  | { ok: true; skipped: 'under_budget' | 'cooldown_active' | 'pending_exists'; approvalId?: string }
  | { ok: false; error: string };

export type ProposeCompactionOptions = {
  /**
   * Function that returns a compacted version of the current content.
   * Defaults to a simple head+tail truncation ("keep first 40% + last
   * 40%, drop the middle with a marker") which is safe but unhelpful —
   * real callers pass an LLM-backed summarizer.
   */
  summarizer?: (content: string, maxChars: number) => Promise<string>;
  /** SessionKey + agentName attached to the approval row for audit trail. */
  sessionKey?: string;
  agentName?: string;
  /** Free-form reviewer note. */
  rationale?: string;
};

/**
 * Files an `agent_approvals` row of kind `memory.compact` with the
 * proposed summarized content. No write to `circle_memory` happens here —
 * approval + apply is a separate step so a human is always in the loop.
 */
export async function proposeMemoryCompaction(
  circleId: string,
  opts: ProposeCompactionOptions = {},
): Promise<ProposeCompactionResult> {
  const status = await checkCircleMemorySize(circleId);
  if (!status) return { ok: false, error: 'could not load circle_memory' };
  if (!status.overBudget) return { ok: true, skipped: 'under_budget' };
  if (status.pendingCompactionId) {
    return {
      ok: true,
      skipped: 'pending_exists',
      approvalId: status.pendingCompactionId,
    };
  }
  if (status.cooldownActiveUntil && new Date(status.cooldownActiveUntil) > new Date()) {
    return { ok: true, skipped: 'cooldown_active' };
  }

  const { data: memoryRow } = await supabase
    .from('circle_memory')
    .select('content')
    .eq('circle_id', circleId)
    .maybeSingle();
  const originalContent = (memoryRow?.content || '').toString();

  const summarizer = opts.summarizer ?? defaultHeadTailSummarizer;
  let proposedSummary: string;
  try {
    proposedSummary = await summarizer(originalContent, status.maxChars);
  } catch (e) {
    return { ok: false, error: `summarizer threw: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!proposedSummary || proposedSummary.length === 0) {
    return { ok: false, error: 'summarizer returned empty content' };
  }
  if (proposedSummary.length > status.maxChars * COMPACTION_TRIGGER_MULTIPLIER) {
    return {
      ok: false,
      error: `summarizer output (${proposedSummary.length} chars) still over budget (${status.maxChars}).`,
    };
  }

  const { data, error } = await supabase
    .from('agent_approvals')
    .insert({
      circle_id: circleId,
      session_key: opts.sessionKey ?? 'default::blackswan',
      agent_name: opts.agentName ?? 'BlackSwan',
      action_type: 'memory.compact',
      description:
        `Compact circle memory: ${originalContent.length} → ${proposedSummary.length} chars` +
        (opts.rationale ? ` — ${opts.rationale.slice(0, 200)}` : ''),
      payload: {
        action: 'compact',
        circleId,
        originalContent,
        proposedSummary,
        originalChars: originalContent.length,
        proposedChars: proposedSummary.length,
        maxChars: status.maxChars,
        summarizerKind: opts.summarizer ? 'custom' : 'default_head_tail',
        rationale: opts.rationale ?? null,
      },
      timeout_seconds: 60 * 60 * 24 * 3, // 3 days — compaction isn't urgent
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: `approval queue insert failed: ${error.message}` };
  return {
    ok: true,
    approvalId: data.id,
    proposedSummary,
    originalChars: originalContent.length,
  };
}

/**
 * Applies an approved compaction proposal. Mirrors `applyApprovedSkillAction`
 * — idempotent via `agent_approvals.applied_at`, no-op on still-pending.
 * Call from the approval-resolution UI or a cron worker.
 */
export async function applyApprovedMemoryCompaction(
  approvalId: string,
): Promise<{ ok: true; applied: boolean; reason?: string } | { ok: false; error: string }> {
  const { data: approval, error: loadError } = await supabase
    .from('agent_approvals')
    .select('id, status, payload, applied_at, circle_id, resolved_by')
    .eq('id', approvalId)
    .maybeSingle();

  if (loadError) return { ok: false, error: `approval lookup: ${loadError.message}` };
  if (!approval)  return { ok: false, error: `approval ${approvalId} not found` };
  if (approval.status !== 'approved' && approval.status !== 'auto_approved') {
    return { ok: true, applied: false, reason: `status is "${approval.status}"` };
  }
  if (approval.applied_at) return { ok: true, applied: false, reason: 'already applied' };

  const payload = approval.payload || {};
  const proposedSummary = String(payload.proposedSummary || '');
  const circleId = approval.circle_id;
  if (!circleId || proposedSummary.length === 0) {
    return { ok: false, error: 'invalid payload' };
  }

  // Upsert the new content. `circle_memory` has one row per circle; it may
  // already exist, so prefer update-first, fall back to insert.
  const { data: existing } = await supabase
    .from('circle_memory')
    .select('id')
    .eq('circle_id', circleId)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('circle_memory')
      .update({
        content: proposedSummary,
        last_edited_at: new Date().toISOString(),
        edited_by: approval.resolved_by ?? null,
      })
      .eq('id', existing.id);
    if (error) return { ok: false, error: `update failed: ${error.message}` };
  } else {
    const { error } = await supabase.from('circle_memory').insert({
      circle_id: circleId,
      content: proposedSummary,
      last_edited_at: new Date().toISOString(),
      edited_by: approval.resolved_by ?? null,
    });
    if (error) return { ok: false, error: `insert failed: ${error.message}` };
  }

  try {
    await supabase
      .from('agent_approvals')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', approvalId);
  } catch {}

  return { ok: true, applied: true };
}

// ─── Default summarizer ─────────────────────────────────────────────────────

/**
 * Safe fallback — keeps head + tail, drops the middle with a marker.
 * Deterministic, cheap, unhelpful for quality but gets the size back
 * under budget. Real users should pass a Haiku-backed summarizer that
 * actually understands the content. See `HERMES_INTEGRATION_PLAN.md`
 * Phase 4 — the production summarizer lives in an edge function so the
 * server-side API key isn't exposed.
 */
async function defaultHeadTailSummarizer(content: string, maxChars: number): Promise<string> {
  if (content.length <= maxChars) return content;
  const keep = Math.floor(maxChars * 0.45);
  const head = content.slice(0, keep);
  const tail = content.slice(-keep);
  const droppedChars = content.length - head.length - tail.length;
  return `${head}\n\n[— auto-compaction trimmed ${droppedChars} chars from the middle. Approve via the HITL banner to commit, or edit the summary before approving. —]\n\n${tail}`;
}
