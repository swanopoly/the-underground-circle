/**
 * TaskChecksPanel -- Renders acceptance check results for a task run
 * Joins task_acceptance_checks with task_run_check_results by check_id.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { subscribeWithReconnect } from '../../../../lib/subscribeWithReconnect';

interface Props {
  taskId: string;
  runId: string;
  circleId: string;
}

interface AcceptanceCheck {
  id: string;
  task_id: string;
  kind: string;
  label: string;
  required: boolean;
  description: string | null;
}

interface CheckResult {
  id: string;
  run_id: string;
  check_id: string;
  status: string;
  evidence: string | null;
  created_at: string;
}

interface JoinedCheck {
  check: AcceptanceCheck;
  result: CheckResult | null;
}

const CHECK_KIND_ICONS: Record<string, string> = {
  automated: '>_',
  manual: 'Mn',
  ai_eval: 'Ai',
  peer_review: 'Pr',
  test: 'Ts',
  lint: 'Lt',
  security: 'Sc',
  performance: 'Pf',
};

const CHECK_KIND_COLORS: Record<string, string> = {
  automated: '#3b82f6',
  manual: '#f59e0b',
  ai_eval: '#8b5cf6',
  peer_review: '#6366f1',
  test: '#22c55e',
  lint: '#06b6d4',
  security: '#ef4444',
  performance: '#ec4899',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  passed: '#22c55e',
  failed: '#ef4444',
  skipped: '#606075',
};

export default function TaskChecksPanel({ taskId, runId, circleId }: Props) {
  const [checks, setChecks] = useState<AcceptanceCheck[]>([]);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [checksRes, resultsRes] = await Promise.all([
        supabase
          .from('task_acceptance_checks')
          .select('id, task_id, kind, label, required, description')
          .eq('task_id', taskId)
          .order('created_at', { ascending: true }),
        supabase
          .from('task_run_check_results')
          .select('id, run_id, check_id, status, evidence, created_at')
          .eq('run_id', runId),
      ]);

      if (checksRes.error) {
        console.warn('[TaskChecksPanel] checks fetch error:', checksRes.error.message);
      } else if (checksRes.data) {
        setChecks(checksRes.data);
      }

      if (resultsRes.error) {
        console.warn('[TaskChecksPanel] results fetch error:', resultsRes.error.message);
      } else if (resultsRes.data) {
        setResults(resultsRes.data);
      }
    } catch (err) {
      console.error('[TaskChecksPanel] fetch exception:', err);
    } finally {
      setLoading(false);
    }
  }, [taskId, runId]);

  useEffect(() => {
    fetchData();

    const sub = subscribeWithReconnect({
      channelName: `task-checks-${runId}`,
      setup: (channel) => channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'task_run_check_results',
        filter: `run_id=eq.${runId}`,
      }, () => fetchData()),
      onCatchUp: () => fetchData(),
      heartbeatMs: 30_000,
    });

    return () => {
      sub.unsubscribe();
    };
  }, [taskId, runId, fetchData]);

  // Join checks with results
  const joined: JoinedCheck[] = checks.map((check) => ({
    check,
    result: results.find((r) => r.check_id === check.id) || null,
  }));

  // Summary counts
  const totalChecks = joined.length;
  const passedCount = joined.filter((j) => j.result?.status === 'passed').length;
  const failedCount = joined.filter((j) => j.result?.status === 'failed').length;
  const pendingCount = joined.filter((j) => !j.result || j.result.status === 'pending').length;

  const getKindIcon = (kind: string): string => CHECK_KIND_ICONS[kind] || '?';
  const getKindColor = (kind: string): string => CHECK_KIND_COLORS[kind] || '#6366f1';
  const getStatusColor = (status: string | undefined): string => {
    if (!status) return STATUS_COLORS.pending;
    return STATUS_COLORS[status] || '#606075';
  };

  if (loading) {
    return (
      <View style={s.container} nativeID="section-task-checks">
        <View style={s.header}>
          <Text style={s.headerIcon}>[?]</Text>
          <Text style={s.headerTitle}>CHECKS</Text>
        </View>
        <View style={s.empty}>
          <Text style={s.emptyText}>Loading checks...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container} nativeID="section-task-checks">
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerIcon}>[?]</Text>
        <Text style={s.headerTitle}>CHECKS</Text>
        <View style={s.countBadge}>
          <Text style={s.countText}>{totalChecks}</Text>
        </View>
      </View>

      <ScrollView
        style={s.list}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary bar */}
        {totalChecks > 0 && (
          <View style={s.summaryBar}>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>
                <Text style={{ color: '#22c55e' }}>{passedCount}</Text>
                <Text style={{ color: '#606075' }}>/{totalChecks}</Text>
                <Text style={{ color: '#a0a0b0' }}> checks passed</Text>
              </Text>
              {failedCount > 0 && (
                <View style={[s.summaryBadge, { backgroundColor: '#ef444418' }]}>
                  <Text style={[s.summaryBadgeText, { color: '#ef4444' }]}>{failedCount} failed</Text>
                </View>
              )}
              {pendingCount > 0 && (
                <View style={[s.summaryBadge, { backgroundColor: '#f59e0b18' }]}>
                  <Text style={[s.summaryBadgeText, { color: '#f59e0b' }]}>{pendingCount} pending</Text>
                </View>
              )}
            </View>
            {/* Progress bar */}
            <View style={s.progressTrack}>
              {passedCount > 0 && (
                <View style={[s.progressFill, { flex: passedCount, backgroundColor: '#22c55e' }]} />
              )}
              {failedCount > 0 && (
                <View style={[s.progressFill, { flex: failedCount, backgroundColor: '#ef4444' }]} />
              )}
              {pendingCount > 0 && (
                <View style={[s.progressFill, { flex: pendingCount, backgroundColor: '#f59e0b40' }]} />
              )}
            </View>
          </View>
        )}

        {/* Empty state */}
        {totalChecks === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>?</Text>
            <Text style={s.emptyText}>No acceptance checks defined</Text>
            <Text style={s.emptySubtext}>Add checks to validate task completion</Text>
          </View>
        )}

        {/* Check rows */}
        {joined.map(({ check, result }) => {
          const kindColor = getKindColor(check.kind);
          const status = result?.status;
          const statusColor = getStatusColor(status);

          return (
            <View key={check.id} style={s.checkRow}>
              {/* Kind icon */}
              <View style={[s.kindIconBox, { backgroundColor: kindColor + '18', borderColor: kindColor + '40' }]}>
                <Text style={[s.kindIconText, { color: kindColor }]}>{getKindIcon(check.kind)}</Text>
              </View>

              {/* Check info */}
              <View style={s.checkContent}>
                <View style={s.checkHeader}>
                  <Text style={s.checkLabel} numberOfLines={1}>{check.label}</Text>
                  <View style={s.checkBadges}>
                    {/* Required / optional */}
                    <View style={[s.reqBadge, { backgroundColor: check.required ? '#6366f118' : '#1a1a28' }]}>
                      <Text style={[s.reqBadgeText, { color: check.required ? '#6366f1' : '#606075' }]}>
                        {check.required ? 'REQ' : 'OPT'}
                      </Text>
                    </View>
                    {/* Status dot */}
                    <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                  </View>
                </View>

                {check.description ? (
                  <Text style={s.checkDesc} numberOfLines={2}>{check.description}</Text>
                ) : null}

                {/* Evidence summary */}
                {result?.evidence ? (
                  <Text style={s.evidence} numberOfLines={2}>{result.evidence}</Text>
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
    color: '#f59e0b',
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
    gap: 8,
  },
  summaryBar: {
    backgroundColor: '#0f0f18',
    borderWidth: 2,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 10,
    gap: 8,
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  summaryBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 2,
  },
  summaryBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  progressTrack: {
    height: 4,
    flexDirection: 'row',
    backgroundColor: '#1a1a28',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%' as any,
  },
  checkRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: '#0f0f18',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
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
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  checkContent: {
    flex: 1,
    gap: 3,
  },
  checkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  checkLabel: {
    color: '#f0f0f5',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    flex: 1,
  },
  checkBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  reqBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
  },
  reqBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  checkDesc: {
    color: '#a0a0b0',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  evidence: {
    color: '#606075',
    fontSize: 11,
    lineHeight: 15,
    fontFamily: 'monospace',
    fontStyle: 'italic',
    marginTop: 2,
    paddingLeft: 6,
    borderLeftWidth: 2,
    borderLeftColor: '#2a2a3e',
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
