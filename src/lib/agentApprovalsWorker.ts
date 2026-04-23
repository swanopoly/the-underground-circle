/**
 * agentApprovalsWorker — dispatches approved `agent_approvals` rows to the
 * right apply function.
 *
 * Without this, approved skill/memory proposals sit in the queue forever —
 * the HITL UI marks them `approved`, but no side-effect ever runs. This
 * worker closes the loop:
 *
 *   user taps Approve in HitlApprovalBanner
 *     → hitlService.resolveApproval(id, 'approved')
 *     → HitlApprovalBanner calls applyApprovedAction(id)   ← THIS FILE
 *     → dispatches by action_type:
 *         - skill.create/patch/delete  → applyApprovedSkillAction
 *         - memory.compact             → applyApprovedMemoryCompaction
 *         - user_memory.replace/delete → applyApprovedUserMemoryAction (new)
 *     → `agent_approvals.applied_at` stamped; re-runs are no-ops.
 *
 * Each apply function owns its own idempotency (checks `applied_at`); this
 * worker is a pure dispatcher. Unknown `action_type`s mark the approval
 * row with a `worker_skipped_at` metadata note and return silently — we
 * never throw across the approval UI boundary.
 */

import { supabase } from './supabase';
import { applyApprovedSkillAction } from './skillLibraryWrite';
import { applyApprovedMemoryCompaction } from './circleMemoryCompaction';
import { deleteUserMemory, replaceUserMemory } from './userMemory';

export type ApprovalApplyResult =
  | { ok: true; actionType: string; applied: boolean; reason?: string; skillId?: string }
  | { ok: false; actionType: string | null; error: string };

/**
 * Apply a single approved row. Idempotent: re-running on an already-applied
 * or non-approved row short-circuits. Safe to call from UI approve handlers
 * without awaiting the result — the return value is for telemetry/toasts.
 */
export async function applyApprovedAction(approvalId: string): Promise<ApprovalApplyResult> {
  const { data, error } = await supabase
    .from('agent_approvals')
    .select('id, action_type, status, applied_at, payload, resolved_by')
    .eq('id', approvalId)
    .maybeSingle();

  if (error) return { ok: false, actionType: null, error: `lookup failed: ${error.message}` };
  if (!data)  return { ok: false, actionType: null, error: `approval ${approvalId} not found` };

  const actionType = String(data.action_type || '');
  const status = String(data.status || '');
  if (status !== 'approved' && status !== 'auto_approved') {
    return { ok: true, actionType, applied: false, reason: `status is "${status}"` };
  }
  if (data.applied_at) return { ok: true, actionType, applied: false, reason: 'already applied' };

  // Route by action_type prefix so we can add more kinds without touching
  // call sites that already work.
  try {
    if (actionType.startsWith('skill.')) {
      const r = await applyApprovedSkillAction(approvalId);
      if (!r.ok) return { ok: false, actionType, error: r.error };
      return { ok: true, actionType, applied: r.applied, reason: r.reason, skillId: r.skillId };
    }
    if (actionType === 'memory.compact') {
      const r = await applyApprovedMemoryCompaction(approvalId);
      if (!r.ok) return { ok: false, actionType, error: r.error };
      return { ok: true, actionType, applied: r.applied, reason: r.reason };
    }
    if (actionType.startsWith('user_memory.')) {
      const r = await applyApprovedUserMemoryAction(approvalId, data);
      if (!r.ok) return { ok: false, actionType, error: r.error };
      return { ok: true, actionType, applied: r.applied, reason: r.reason };
    }

    // Unknown kind — don't guess, but do mark it so we can see it in the
    // dashboard and add a handler later.
    await supabase
      .from('agent_approvals')
      .update({
        applied_at: new Date().toISOString(),
        payload: {
          ...(data.payload || {}),
          worker_skipped_at: new Date().toISOString(),
          worker_skipped_reason: `no handler for action_type "${actionType}"`,
        },
      })
      .eq('id', approvalId);
    return { ok: true, actionType, applied: false, reason: `no handler for "${actionType}"` };
  } catch (e) {
    return { ok: false, actionType, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Scan for any approved-but-unapplied rows in a circle and apply each.
 * Useful as a one-shot catch-up on app mount, or a scheduled sweep.
 *
 * Limits to 20 per call so a backlog can't monopolise the UI thread;
 * callers loop if there's more work.
 */
export async function applyAllPendingApprovals(circleId: string): Promise<{
  processed: number;
  applied: number;
  failed: number;
  items: ApprovalApplyResult[];
}> {
  const { data, error } = await supabase
    .from('agent_approvals')
    .select('id, action_type, requested_at')
    .eq('circle_id', circleId)
    .in('status', ['approved', 'auto_approved'])
    .is('applied_at', null)
    .order('requested_at', { ascending: true })
    .limit(20);

  if (error || !data || data.length === 0) {
    return { processed: 0, applied: 0, failed: 0, items: [] };
  }
  const results: ApprovalApplyResult[] = [];
  let applied = 0;
  let failed = 0;
  for (const row of data) {
    const r = await applyApprovedAction(row.id);
    results.push(r);
    if (r.ok && r.applied) applied += 1;
    if (!r.ok) failed += 1;
  }
  return { processed: data.length, applied, failed, items: results };
}

// ─── user_memory apply path ────────────────────────────────────────────────
// Kept local (vs. a separate file) because it's a 20-line delegate around
// existing userMemory helpers and doesn't carry its own complexity.

type ApprovalRow = {
  id: string;
  action_type: string;
  status: string;
  applied_at?: string | null;
  payload?: Record<string, any> | null;
  resolved_by?: string | null;
};

async function applyApprovedUserMemoryAction(
  approvalId: string,
  row: ApprovalRow,
): Promise<{ ok: true; applied: boolean; reason?: string } | { ok: false; error: string }> {
  const payload = row.payload || {};
  const userId = String(payload.userId || '').trim();
  const circleId = (payload.circleId ?? null) as string | null;
  const action = String(payload.action || '').trim();
  if (!userId) return { ok: false, error: 'payload missing userId' };
  if (action !== 'replace' && action !== 'delete') {
    return { ok: false, error: `unexpected user_memory action "${action}"` };
  }

  // NB: `replaceUserMemory` + `deleteUserMemory` are user-owned writes (RLS
  // user_rw_own_memory). Running them from an approval handler is safe
  // because the HITL banner only lets the row's target user approve it.
  if (action === 'replace') {
    const proposed = String(payload.proposedContent || '');
    if (proposed.length === 0) return { ok: false, error: 'replace: empty proposedContent' };
    const r = await replaceUserMemory(userId, circleId, proposed);
    if (!r.ok) return { ok: false, error: r.error || 'replace failed' };
  } else {
    const r = await deleteUserMemory(userId, circleId);
    if (!r.ok) return { ok: false, error: r.error || 'delete failed' };
  }

  try {
    await supabase
      .from('agent_approvals')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', approvalId);
  } catch {}

  return { ok: true, applied: true };
}
