/**
 * runApprovalsService — realtime view + resolve actions for
 * `agent_run_approvals`. Feeds the in-chat RunApprovalBanner so users
 * can approve/reject pending HITL gates inline (v2's M3d writes here).
 *
 * Distinct from `services/hitlService.ts`, which watches the legacy
 * `agent_approvals` table used by the kill-switch / per-agent controls.
 * The two tables share a domain (human-in-the-loop gates) but have
 * different schemas and different write paths — keeping them separate
 * avoids confusing UI reads with kill-switch rows and vice versa.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export type ApprovalKind =
  | 'tool_use'
  | 'publish'
  | 'external_send'
  | 'file_write'
  | 'browser_action'
  | 'cost_threshold'
  | 'privileged_action'
  | 'plan_approval'
  | 'deliverable_review';

export type AgentRunApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';

export interface AgentRunApproval {
  id: string;
  run_id: string;
  circle_id: string;
  approval_kind: ApprovalKind;
  title: string;
  description: string | null;
  payload: Record<string, unknown> | null;
  status: AgentRunApprovalStatus;
  requested_by: string | null;
  requested_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  timeout_seconds: number;
}

// ─── Reads ─────────────────────────────────────────────────────────

export async function getPendingRunApprovals(circleId: string): Promise<AgentRunApproval[]> {
  const { data, error } = await supabase
    .from('agent_run_approvals')
    .select('id, run_id, circle_id, approval_kind, title, description, payload, status, requested_by, requested_at, resolved_by, resolved_at, timeout_seconds')
    .eq('circle_id', circleId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(10);
  if (error) {
    // Table may not exist yet on old projects; fail open so the banner
    // just doesn't show. Don't crash the chat.
    return [];
  }
  return (data || []) as AgentRunApproval[];
}

// ─── Writes ────────────────────────────────────────────────────────

export async function resolveRunApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('agent_run_approvals')
    .update({
      status,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', approvalId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─── Realtime hook ─────────────────────────────────────────────────
//
// Subscribes to postgres_changes on `agent_run_approvals` filtered by
// circle_id. On every change we refetch the pending slice rather than
// mutate local state — the query is small (≤10 rows) and this keeps
// the reducer trivial. Also refetches every 30s as a safety net in
// case the realtime channel drops silently.

export function useAgentRunApprovals(circleId?: string): {
  approvals: AgentRunApproval[];
  pendingCount: number;
  refresh: () => Promise<void>;
} {
  const [approvals, setApprovals] = useState<AgentRunApproval[]>([]);

  const refresh = useCallback(async () => {
    if (!circleId) return;
    const rows = await getPendingRunApprovals(circleId);
    setApprovals(rows);
  }, [circleId]);

  useEffect(() => {
    if (!circleId) return;
    let cancelled = false;
    refresh();

    const channel = supabase
      .channel(`agent_run_approvals:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_run_approvals',
          filter: `circle_id=eq.${circleId}`,
        },
        () => {
          if (!cancelled) refresh();
        },
      )
      .subscribe();

    // Safety-net refresh every 30s — realtime channels can drop silently.
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
