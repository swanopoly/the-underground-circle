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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { resolveApprovalExpiresAt } from '../lib/chatAttentionQueue';
import { classifyApprovalAge } from '../lib/approvalPreviewCore';

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
  // Nothing sweeps DB rows to status 'expired' (timeout_seconds is stored but
  // unenforced), so filter dead rows here — mirroring the P12 pattern used for
  // HitlApprovalBanner — instead of letting a stale pending approval pin
  // ChatTab's "Needs your approval" pill (and the banner) indefinitely. Doing
  // it at this single read point keeps the banner list, its pending count,
  // and the run pill in agreement. Rows with no timeout (timeout <= 0 →
  // resolveApprovalExpiresAt null) fall back to classifyApprovalAge's 30-min
  // 'expired' tier as a staleness cap. Hiding a timed-out row only narrows
  // what can be approved — never widens what executes.
  const now = Date.now();
  return ((data || []) as AgentRunApproval[]).filter((row) => {
    const expiresAt = resolveApprovalExpiresAt(row.requested_at, row.timeout_seconds);
    if (expiresAt !== null) return expiresAt > now;
    return classifyApprovalAge(now - Date.parse(row.requested_at)) !== 'expired';
  });
}

// ─── Writes ────────────────────────────────────────────────────────

export async function resolveRunApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Fail-closed + idempotent (mirrors agentRunSystem.resolveRunApproval): only
  // a still-PENDING row transitions, so a late click (after another approver or
  // after expiry) can't flip a resolved/expired decision. A no-op update
  // reports ok:false with a clear reason instead of a silent success.
  const { data, error } = await supabase
    .from('agent_run_approvals')
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

  // Per-mount channel-topic suffix. supabase.channel() returns the EXISTING
  // instance for a duplicate topic, so two mounts (Chat + Office banners) with
  // a fixed `agent_run_approvals:${circleId}` topic would share one channel and
  // whichever unmounts first would removeChannel() it out from under the other.
  // A unique topic per mount gives each hook instance its own channel.
  const instanceId = useRef(Math.random().toString(36).slice(2)).current;

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
      .channel(`agent_run_approvals:${circleId}:${instanceId}`)
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
