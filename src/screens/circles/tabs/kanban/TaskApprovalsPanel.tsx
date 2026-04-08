/**
 * TaskApprovalsPanel -- Renders approval gates for a task run
 * PR1: read-only display only (no approve/reject buttons — those come in PR2).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';

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
  requested_at: string;
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

const KIND_ICONS: Record<string, string> = {
  human_review: 'HR',
  deploy: 'Dp',
  merge: 'Mg',
  budget: '$',
  access: 'Ac',
  release: 'Rl',
  security: 'Sc',
};

const KIND_COLORS: Record<string, string> = {
  human_review: '#6366f1',
  deploy: '#22c55e',
  merge: '#3b82f6',
  budget: '#f59e0b',
  access: '#ec4899',
  release: '#8b5cf6',
  security: '#ef4444',
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

  const fetchApprovals = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('task_run_approvals')
        .select('id, run_id, approval_kind, title, summary, status, requested_at, resolved_at, resolved_by')
        .eq('run_id', runId)
        .order('requested_at', { ascending: true });

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
                <Text style={s.timestampValue}>{timeAgo(approval.requested_at)}</Text>
                {approval.resolved_at ? (
                  <>
                    <View style={s.timestampDivider} />
                    <Text style={s.timestampLabel}>Resolved</Text>
                    <Text style={s.timestampValue}>{timeAgo(approval.resolved_at)}</Text>
                  </>
                ) : null}
              </View>
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
