/**
 * taskRunApprovalsService — reads + fail-closed resolve actions for
 * `task_run_approvals`, the kanban task-run approval gates. Sibling of
 * `services/runApprovalsService.ts` (`agent_run_approvals`) and
 * `services/hitlService.ts` (`agent_approvals`) — one service per HITL
 * table so UI reads never mix schemas or write paths.
 *
 * Consumption is real but re-checked, not live: `canTaskRunMarkComplete`
 * (`src/lib/taskExecutionRuntime.ts`) loads this table by `run_id` on the
 * next `runAgentOnTask` attempt (`src/hooks/useKanbanData.ts`). A `pending`
 * or `rejected` row forces the task back to `in_progress` ("Completion
 * blocked" step + blocker memory) and withholds the `task_complete` XP
 * award; approving here genuinely opens that gate. Rejection keeps the
 * gate closed for that run only — a later fresh run gets a new `run_id`
 * and starts clean.
 *
 * The write path that creates rows (`createTaskRunApproval`, same lib
 * file) has no producer call site yet, so this table stays empty until the
 * executor grows one — but any row that does exist is honored by the gate,
 * which is why resolve is real wiring rather than button theater.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Matches the DB CHECK constraint in 20260404_feed_task_execution_runtime.sql. */
export type TaskRunApprovalKind =
  | 'room_patch_apply'
  | 'repo_write'
  | 'external_publish'
  | 'destructive_edit'
  | 'high_cost_generation';

export type TaskRunApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface TaskRunApproval {
  id: string;
  run_id: string;
  task_id: string;
  circle_id: string;
  approval_kind: TaskRunApprovalKind;
  title: string;
  summary: string | null;
  status: TaskRunApprovalStatus;
  requested_by: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  payload: Record<string, unknown> | null;
  /** NOTE: this table has `created_at`, not `requested_at` like its siblings. */
  created_at: string;
}

// ─── Reads ─────────────────────────────────────────────────────────

export async function getPendingTaskRunApprovals(circleId: string): Promise<TaskRunApproval[]> {
  const { data, error } = await supabase
    .from('task_run_approvals')
    .select('id, run_id, task_id, circle_id, approval_kind, title, summary, status, requested_by, resolved_by, resolved_at, payload, created_at')
    .eq('circle_id', circleId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    // Table may not exist yet on old projects; fail open so callers just
    // render an empty queue. Don't crash the Office/kanban surfaces.
    return [];
  }
  return (data || []) as TaskRunApproval[];
}

// ─── Writes ────────────────────────────────────────────────────────

export async function resolveTaskRunApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Fail-closed + idempotent (mirrors runApprovalsService.resolveRunApproval):
  // only a still-PENDING row transitions, so a late click (after another
  // approver or after expiry) can't flip a resolved/expired decision. A no-op
  // update reports ok:false with a clear reason instead of a silent success.
  const { data, error } = await supabase
    .from('task_run_approvals')
    .update({
      status,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', approvalId)
    .eq('status', 'pending')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: 'This approval is no longer pending (already resolved or expired).' };
  }
  return { ok: true };
}

// ─── Realtime hook ─────────────────────────────────────────────────
//
// Circle-wide pending view (the per-run view stays in TaskApprovalsPanel's
// own run-scoped query). Subscribes to postgres_changes filtered by
// circle_id and refetches the small pending slice on every change, plus a
// 30s safety-net poll — same shape as useAgentRunApprovals.

export function useTaskRunApprovals(circleId?: string): {
  approvals: TaskRunApproval[];
  pendingCount: number;
  refresh: () => Promise<void>;
} {
  const [approvals, setApprovals] = useState<TaskRunApproval[]>([]);

  const refresh = useCallback(async () => {
    if (!circleId) return;
    const rows = await getPendingTaskRunApprovals(circleId);
    setApprovals(rows);
  }, [circleId]);

  useEffect(() => {
    if (!circleId) return;
    let cancelled = false;
    refresh();

    const channel = supabase
      .channel(`task_run_approvals:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_run_approvals',
          filter: `circle_id=eq.${circleId}`,
        },
        () => {
          if (!cancelled) refresh();
        },
      )
      .subscribe();

    const interval = setInterval(() => { if (!cancelled) refresh(); }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [circleId, refresh]);

  const pendingCount = useMemo(() => approvals.length, [approvals]);
  return { approvals, pendingCount, refresh };
}
