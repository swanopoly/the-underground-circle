/**
 * TaskRunTimeline -- Step-by-step timeline of a task run execution
 * Loads steps from task_run_steps, subscribes to realtime inserts.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { subscribeWithReconnect } from '../../../../lib/subscribeWithReconnect';

interface Props {
  runId: string;
  circleId: string;
}

interface RunStep {
  id: string;
  run_id: string;
  step_index: number;
  kind: string;
  title: string;
  status: string;
  summary: string | null;
  created_at: string;
}

type StepKind =
  | 'plan'
  | 'execution'
  | 'tool_call'
  | 'artifact_create'
  | 'check_eval'
  | 'approval_request'
  | 'finalize'
  | 'error';

const KIND_ICONS: Record<StepKind, string> = {
  plan: 'P',
  execution: '!',
  tool_call: 'T',
  artifact_create: 'A',
  check_eval: '?',
  approval_request: '!',
  finalize: 'F',
  error: 'X',
};

const KIND_COLORS: Record<StepKind, string> = {
  plan: '#6366f1',
  execution: '#3b82f6',
  tool_call: '#06b6d4',
  artifact_create: '#8b5cf6',
  check_eval: '#f59e0b',
  approval_request: '#ec4899',
  finalize: '#22c55e',
  error: '#ef4444',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
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

export default function TaskRunTimeline({ runId, circleId }: Props) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSteps = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('task_run_steps')
        .select('id, run_id, step_index, kind, title, status, summary, created_at')
        .eq('run_id', runId)
        .order('step_index', { ascending: true });

      if (error) {
        console.warn('[TaskRunTimeline] fetch error:', error.message);
      } else if (data) {
        setSteps(data);
      }
    } catch (err) {
      console.error('[TaskRunTimeline] fetch exception:', err);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchSteps();

    const sub = subscribeWithReconnect({
      channelName: `task-run-steps-${runId}`,
      setup: (channel) => channel
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'task_run_steps',
          filter: `run_id=eq.${runId}`,
        }, () => fetchSteps())
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'task_run_steps',
          filter: `run_id=eq.${runId}`,
        }, () => fetchSteps()),
      onCatchUp: () => fetchSteps(),
    });

    return () => {
      sub.unsubscribe();
    };
  }, [runId, fetchSteps]);

  const getKindIcon = (kind: string): string => {
    return KIND_ICONS[kind as StepKind] || '>';
  };

  const getKindColor = (kind: string): string => {
    return KIND_COLORS[kind as StepKind] || '#6366f1';
  };

  const getStatusColor = (status: string): string => {
    return STATUS_COLORS[status] || '#606075';
  };

  if (loading) {
    return (
      <View style={s.container} nativeID="section-task-run-timeline">
        <View style={s.header}>
          <Text style={s.headerIcon}>[T]</Text>
          <Text style={s.headerTitle}>TIMELINE</Text>
        </View>
        <View style={s.empty}>
          <Text style={s.emptyText}>Loading steps...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container} nativeID="section-task-run-timeline">
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerIcon}>[T]</Text>
        <Text style={s.headerTitle}>TIMELINE</Text>
        <View style={s.countBadge}>
          <Text style={s.countText}>{steps.length}</Text>
        </View>
      </View>

      {/* Steps */}
      <ScrollView
        style={s.list}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      >
        {steps.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>//</Text>
            <Text style={s.emptyText}>No steps yet</Text>
            <Text style={s.emptySubtext}>Steps will appear as the run executes</Text>
          </View>
        )}

        {steps.map((step, idx) => {
          const kindColor = getKindColor(step.kind);
          const statusColor = getStatusColor(step.status);
          const isLast = idx === steps.length - 1;

          return (
            <View key={step.id} style={s.stepRow}>
              {/* Timeline rail */}
              <View style={s.rail}>
                <View style={[s.iconCircle, { backgroundColor: kindColor + '18', borderColor: kindColor + '40' }]}>
                  <Text style={[s.iconText, { color: kindColor }]}>{getKindIcon(step.kind)}</Text>
                </View>
                {!isLast && <View style={s.connector} />}
              </View>

              {/* Step content */}
              <View style={s.stepContent}>
                <View style={s.stepHeader}>
                  <Text style={s.stepTitle} numberOfLines={2}>{step.title}</Text>
                  <View style={[s.statusBadge, { backgroundColor: statusColor + '18' }]}>
                    <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[s.statusLabel, { color: statusColor }]}>{step.status}</Text>
                  </View>
                </View>

                {step.summary ? (
                  <Text style={s.stepSummary} numberOfLines={3}>{step.summary}</Text>
                ) : null}

                <Text style={s.timestamp}>{timeAgo(step.created_at)}</Text>
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
    color: '#6366f1',
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
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rail: {
    alignItems: 'center',
    width: 32,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 16,
    backgroundColor: '#1a1a28',
  },
  stepContent: {
    flex: 1,
    paddingBottom: 16,
    gap: 4,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepTitle: {
    flex: 1,
    color: '#f0f0f5',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    lineHeight: 18,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
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
    textTransform: 'uppercase',
  },
  stepSummary: {
    color: '#a0a0b0',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  timestamp: {
    color: '#606075',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
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
