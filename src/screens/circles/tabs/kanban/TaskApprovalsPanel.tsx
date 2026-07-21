/**
 * TaskApprovalsPanel -- Renders approval gates for a task run.
 *
 * PR2 (shipped): pending cards carry Approve/Reject buttons wired to
 * `resolveTaskRunApproval` (`src/services/taskRunApprovalsService.ts`) — a
 * fail-closed, pending-only status flip that stamps resolver + timestamp.
 * Resolution is genuinely consumed: `canTaskRunMarkComplete`
 * (`src/lib/taskExecutionRuntime.ts`) re-checks this table on the next
 * `runAgentOnTask` attempt — pending OR rejected rows keep the task out of
 * `done` and withhold completion XP; approving here opens that gate.
 *
 * PR2 also fixed the PR1 query: this table has `created_at`, not
 * `requested_at` (selecting the latter errored at runtime and the panel
 * always rendered empty), and the kind icon/color maps now match the DB
 * CHECK kinds (room_patch_apply / repo_write / external_publish /
 * destructive_edit / high_cost_generation).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform, Pressable, ActivityIndicator,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { safeGetUserId } from '../../../../lib/authSession';
import { resolveTaskRunApproval } from '../../../../services/taskRunApprovalsService';

interface Props {
  runId: string;
  circleId: string;
}

interface Approval {
  id: string;
  run_id: string;
  approval_kind: string;
  title: string;
  summary: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  rejected: '#ef4444',
  expired: '#606075',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  expired: 'EXPIRED',
};

// Keys match the DB CHECK constraint on task_run_approvals.approval_kind.
const KIND_ICONS: Record<string, string> = {
  room_patch_apply: 'Rm',
  repo_write: 'Rw',
  external_publish: 'Pb',
  destructive_edit: 'Dx',
  high_cost_generation: '$',
};

const KIND_COLORS: Record<string, string> = {
  room_patch_apply: '#6366f1',
  repo_write: '#3b82f6',
  external_publish: '#ec4899',
  destructive_edit: '#ef4444',
  high_cost_generation: '#f59e0b',
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TaskApprovalsPanel({ runId, circleId }: Props) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, 'approving' | 'rejecting' | undefined>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({});

  const fetchApprovals = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('task_run_approvals')
        .select('id, run_id, approval_kind, title, summary, status, created_at, resolved_at, resolved_by')
        .eq('run_id', runId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[TaskApprovalsPanel] fetch error:', error.message);
      } else if (data) {
        setApprovals(data);
      }
    } catch (err) {
      console.error('[TaskApprovalsPanel] fetch exception:', err);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchApprovals();

    const channel = supabase
      .channel(`task-run-approvals-${runId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'task_run_approvals',
        filter: `run_id=eq.${runId}`,
      }, () => fetchApprovals())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId, fetchApprovals]);

  const handleResolve = useCallback(async (approvalId: string, status: 'approved' | 'rejected') => {
    setBusy((prev) => ({ ...prev, [approvalId]: status === 'approved' ? 'approving' : 'rejecting' }));
    setActionErrors((prev) => ({ ...prev, [approvalId]: undefined }));
    try {
      const userId = await safeGetUserId();
      if (!userId) {
        setActionErrors((prev) => ({ ...prev, [approvalId]: 'Sign-in required — no signed-in user found to record the decision.' }));
        return;
      }
      // Fail-closed: only flips a still-pending row; a late click after
      // another approver reports ok:false instead of silently overwriting.
      const result = await resolveTaskRunApproval(approvalId, status, userId);
      if (!result.ok) {
        setActionErrors((prev) => ({ ...prev, [approvalId]: result.error || 'Could not resolve this approval.' }));
      }
      // Realtime also fires, but refetch now so the card updates immediately.
      await fetchApprovals();
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [approvalId]: err instanceof Error ? err.message : 'Could not resolve this approval.',
      }));
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[approvalId];
        return next;
      });
    }
  }, [fetchApprovals]);

  const getKindIcon = (kind: string): string => KIND_ICONS[kind] || '!!';
  const getKindColor = (kind: string): string => KIND_COLORS[kind] || '#6366f1';
  const getStatusColor = (status: string): string => STATUS_COLORS[status] || '#606075';
  const getStatusLabel = (status: string): string => STATUS_LABELS[status] || status.toUpperCase();

  if (loading) {
    return (
      <View style={s.container} nativeID="section-task-approvals">
        <View style={s.header}>
          <Text style={s.headerIcon}>[!]</Text>
          <Text style={s.headerTitle}>APPROVALS</Text>
        </View>
        <View style={s.empty}>
          <Text style={s.emptyText}>Loading approvals...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container} nativeID="section-task-approvals">
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerIcon}>[!]</Text>
        <Text style={s.headerTitle}>APPROVALS</Text>
        {approvals.length > 0 && (
          <View style={s.countBadge}>
            <Text style={s.countText}>{approvals.length}</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={s.list}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Empty state */}
        {approvals.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>//</Text>
            <Text style={s.emptyText}>No approvals required</Text>
            <Text style={s.emptySubtext}>This run does not have any approval gates</Text>
          </View>
        )}

        {/* Approval cards */}
        {approvals.map((approval) => {
          const kindColor = getKindColor(approval.approval_kind);
          const statusColor = getStatusColor(approval.status);

          return (
            <View key={approval.id} style={s.card}>
              {/* Card top row: kind icon + kind label + status badge */}
              <View style={s.cardTopRow}>
                <View style={[s.kindIconBox, { backgroundColor: kindColor + '18', borderColor: kindColor + '40' }]}>
                  <Text style={[s.kindIconText, { color: kindColor }]}>{getKindIcon(approval.approval_kind)}</Text>
                </View>
                <Text style={[s.kindLabel, { color: kindColor }]}>
                  {approval.approval_kind.replace(/_/g, ' ').toUpperCase()}
                </Text>
                <View style={[s.statusBadge, { backgroundColor: statusColor + '18' }]}>
                  <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[s.statusLabel, { color: statusColor }]}>{getStatusLabel(approval.status)}</Text>
                </View>
              </View>

              {/* Title */}
              <Text style={s.cardTitle} numberOfLines={2}>{approval.title}</Text>

              {/* Summary */}
              {approval.summary ? (
                <Text style={s.cardSummary} numberOfLines={4}>{approval.summary}</Text>
              ) : null}

              {/* Timestamps */}
              <View style={s.timestampRow}>
                <Text style={s.timestampLabel}>Requested</Text>
                <Text style={s.timestampValue}>{timeAgo(approval.created_at)}</Text>
                {approval.resolved_at ? (
                  <>
                    <View style={s.timestampDivider} />
                    <Text style={s.timestampLabel}>Resolved</Text>
                    <Text style={s.timestampValue}>{timeAgo(approval.resolved_at)}</Text>
                  </>
                ) : null}
              </View>

              {/* Approve / Reject — pending rows only. Resolution feeds the
                  canTaskRunMarkComplete gate on the next run attempt. */}
              {approval.status === 'pending' ? (
                <>
                  <View style={s.actionRow}>
                    <Pressable
                      style={[s.actionBtn, s.rejectBtn]}
                      onPress={() => handleResolve(approval.id, 'rejected')}
                      disabled={!!busy[approval.id]}
                      accessibilityRole="button"
                      accessibilityLabel={`Reject approval: ${approval.title}`}
                    >
                      {busy[approval.id] === 'rejecting' ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Text style={[s.actionBtnText, s.rejectBtnText]}>REJECT</Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={[s.actionBtn, s.approveBtn]}
                      onPress={() => handleResolve(approval.id, 'approved')}
                      disabled={!!busy[approval.id]}
                      accessibilityRole="button"
                      accessibilityLabel={`Approve approval: ${approval.title}`}
                    >
                      {busy[approval.id] === 'approving' ? (
                        <ActivityIndicator size="small" color="#22c55e" />
                      ) : (
                        <Text style={[s.actionBtnText, s.approveBtnText]}>APPROVE</Text>
                      )}
                    </Pressable>
                  </View>
                  {actionErrors[approval.id] ? (
                    <Text style={s.actionError}>{actionErrors[approval.id]}</Text>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a10',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a28',
    gap: 6,
  },
  headerIcon: {
    color: '#ec4899',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  headerTitle: {
    color: '#a0a0b0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  countBadge: {
    backgroundColor: '#1a1a28',
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    color: '#606075',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
    gap: 10,
  },
  card: {
    backgroundColor: '#0f0f18',
    borderWidth: 2,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 12,
    gap: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kindIconBox: {
    width: 28,
    height: 28,
    borderRadius: 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  kindIconText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  kindLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  cardTitle: {
    color: '#f0f0f5',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    lineHeight: 18,
  },
  cardSummary: {
    color: '#a0a0b0',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  timestampLabel: {
    color: '#606075',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  timestampValue: {
    color: '#444455',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  timestampDivider: {
    width: 1,
    height: 10,
    backgroundColor: '#1a1a28',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  actionBtnText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  rejectBtn: {
    borderColor: '#ef444440',
    backgroundColor: '#ef444410',
  },
  rejectBtnText: {
    color: '#ef4444',
  },
  approveBtn: {
    borderColor: '#22c55e40',
    backgroundColor: '#22c55e10',
  },
  approveBtnText: {
    color: '#22c55e',
  },
  actionError: {
    color: '#ef4444',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 6,
  },
  emptyIcon: {
    color: '#2a2a3e',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  emptyText: {
    color: '#606075',
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  emptySubtext: {
    color: '#444455',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
