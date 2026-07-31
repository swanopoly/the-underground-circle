/**
 * ActivityFeedPanel — live agent activity feed for the HQ Dashboard.
 *
 * Renders ONE chronological, deduped timeline merged from four lanes
 * (agent_activity, automation_runs, task_runs, proof_of_work) via the pure
 * `feedTimelineMergeCore`, so a completed run shows once — richest
 * representation first (proof > activity > task_run) — instead of three
 * stacked copies with the proof card buried at the bottom.
 *
 * Lane failures use `decideFeedLaneRetry`: only schema-permanent errors
 * (missing table/column) disable a lane for the session; transient errors
 * get a bounded 2s/8s/30s retry and the lane stays enabled.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import RunMetadataSummary from '../../../../components/chat/RunMetadataSummary';
import AgentRunProofDetail from '../../../../components/feed/AgentRunProofDetail';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import {
  buildRunMetadataSummaryProps,
  fetchTaskRunMetadataByOpenSwanRunId,
} from '../../../../lib/taskRunMetadata';
import {
  buildFeedTimeline,
  decideFeedLaneRetry,
} from '../../../../lib/feedTimelineMergeCore';

interface Props {
  circleId: string;
  agents: CircleOfficeAgent[];
}

interface ActivityItem {
  id: string;
  agent_name: string;
  activity_type: string;
  source: string | null;
  source_detail: string | null;
  title: string | null;
  body: string | null;
  /** jsonb — carries run_id / task_id for task_completed rows (base schema). */
  metadata: Record<string, unknown> | null;
  created_at: string;
}

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

interface AutomationRun {
  id: string;
  status: string;
  error_message: string | null;
  output_text: string | null;
  model_used: string | null;
  estimated_cost: number | null;
  duration_ms: number | null;
  trigger_source: string | null;
  started_at: string;
}

interface TaskRunFeedItem {
  id: string;
  task_id: string;
  agent_id: string;
  openswan_run_id?: string | null;
  run_kind: string;
  status: string;
  summary: string | null;
  model_used: string | null;
  token_count: number | null;
  duration_ms: number | null;
  started_at: string;
}

interface ProofItem {
  id: string;
  pow_type: string;
  title: string;
  agent_name: string | null;
  created_at: string;
  detail: any;
}

type FeedLane = 'activity' | 'automationRuns' | 'taskRuns' | 'proof';
const FEED_LANES: readonly FeedLane[] = ['activity', 'automationRuns', 'taskRuns', 'proof'];

export default function ActivityFeedPanel({ circleId, agents }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskRunFeedItem[]>([]);
  const [taskRunMetadataByRunId, setTaskRunMetadataByRunId] = useState<Record<string, Record<string, any>>>({});
  const [proofItems, setProofItems] = useState<ProofItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Per-lane resilience state. A lane is disabled ONLY for schema-permanent
  // errors (missing table/column); transient errors keep it enabled and get
  // a bounded retry. This replaces the old any-error-latches-forever refs.
  const laneDisabledRef = useRef<Record<FeedLane, boolean>>({
    activity: false, automationRuns: false, taskRuns: false, proof: false,
  });
  const laneAttemptsRef = useRef<Record<FeedLane, number>>({
    activity: 0, automationRuns: 0, taskRuns: 0, proof: 0,
  });
  const laneTimersRef = useRef<Partial<Record<FeedLane, ReturnType<typeof setTimeout>>>>({});
  const fetchRef = useRef<() => void>(() => {});

  const clearLaneTimer = (lane: FeedLane) => {
    const timer = laneTimersRef.current[lane];
    if (timer) {
      clearTimeout(timer);
      delete laneTimersRef.current[lane];
    }
  };

  /** Success path: reset the lane's failure count and pending retry. */
  const noteLaneSuccess = (lane: FeedLane) => {
    laneAttemptsRef.current[lane] = 0;
    clearLaneTimer(lane);
  };

  /** Failure path: schema-permanent → disable lane; transient → bounded retry. */
  const noteLaneError = (lane: FeedLane, error: unknown) => {
    const attempt = laneAttemptsRef.current[lane] + 1;
    laneAttemptsRef.current[lane] = attempt;
    const decision = decideFeedLaneRetry(error, attempt);
    if (decision.disableForever) {
      laneDisabledRef.current[lane] = true;
      clearLaneTimer(lane);
      console.warn(`[ActivityFeedPanel] ${lane} lane unavailable (schema):`, (error as any)?.message || error);
      return;
    }
    console.warn(`[ActivityFeedPanel] ${lane} lane fetch failed (attempt ${attempt}, transient):`, (error as any)?.message || error);
    if (decision.retryInMs != null) {
      clearLaneTimer(lane);
      laneTimersRef.current[lane] = setTimeout(() => {
        delete laneTimersRef.current[lane];
        fetchRef.current();
      }, decision.retryInMs);
    }
    // Past the retry cap the lane stays enabled but idle until the next
    // poll / realtime-triggered refresh. Last-good data is kept on screen.
  };

  const fetchActivity = useCallback(async () => {
    try {
      if (!laneDisabledRef.current.activity) {
        const actRes = await supabase
          .from('agent_activity')
          .select('id, agent_name, activity_type, source, source_detail, title, body, metadata, created_at')
          .eq('circle_id', circleId)
          .order('created_at', { ascending: false })
          .limit(60);

        if (actRes.error) {
          noteLaneError('activity', actRes.error);
        } else if (actRes.data) {
          noteLaneSuccess('activity');
          setItems(actRes.data);
        }
      }

      if (!laneDisabledRef.current.automationRuns) {
        const runRes = await supabase
          .from('automation_runs')
          .select('id, status, error_message, output_text, model_used, estimated_cost, duration_ms, trigger_source, started_at')
          .eq('circle_id', circleId)
          .in('status', ['failed', 'completed'])
          .order('started_at', { ascending: false })
          .limit(10);

        if (runRes.error) {
          noteLaneError('automationRuns', runRes.error);
          if (laneDisabledRef.current.automationRuns) setRuns([]);
        } else if (runRes.data) {
          noteLaneSuccess('automationRuns');
          setRuns(runRes.data);
        }
      }

      if (!laneDisabledRef.current.taskRuns) {
        const taskRunRes = await supabase
          .from('task_runs')
          .select('id, task_id, agent_id, openswan_run_id, run_kind, status, summary, model_used, token_count, duration_ms, started_at')
          .eq('circle_id', circleId)
          .in('status', ['completed', 'failed'])
          .order('started_at', { ascending: false })
          .limit(12);

        if (taskRunRes.error) {
          noteLaneError('taskRuns', taskRunRes.error);
          if (laneDisabledRef.current.taskRuns) setTaskRuns([]);
        } else if (taskRunRes.data) {
          noteLaneSuccess('taskRuns');
          setTaskRuns(taskRunRes.data);
          const openSwanRunIds = taskRunRes.data
            .map((run) => run.openswan_run_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0);
          const nextMetadata = await fetchTaskRunMetadataByOpenSwanRunId(openSwanRunIds);
          setTaskRunMetadataByRunId(nextMetadata);
        }
      }

      // Fetch proof-of-work entries
      if (!laneDisabledRef.current.proof) {
        const powRes = await supabase
          .from('proof_of_work')
          .select('id, pow_type, title, agent_name, created_at, detail')
          .eq('circle_id', circleId)
          .order('created_at', { ascending: false })
          .limit(20);

        if (powRes.error) {
          noteLaneError('proof', powRes.error);
          if (laneDisabledRef.current.proof) setProofItems([]);
        } else if (powRes.data) {
          noteLaneSuccess('proof');
          setProofItems(powRes.data);
        }
      }
    } catch (err) {
      console.error('ActivityFeed fetch error:', err);
    }
  }, [circleId]);

  useEffect(() => {
    fetchRef.current = fetchActivity;
  }, [fetchActivity]);

  useEffect(() => {
    fetchActivity();

    // Realtime subscription — both activity and automation runs
    const channel = supabase
      .channel(`activity-feed-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'agent_activity',
        filter: `circle_id=eq.${circleId}`,
      }, () => fetchActivity())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'automation_runs',
        filter: `circle_id=eq.${circleId}`,
      }, () => fetchActivity())
      .subscribe();

    // Fallback poll every 30s
    pollRef.current = setInterval(fetchActivity, 30000);

    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
      for (const lane of FEED_LANES) {
        const timer = laneTimersRef.current[lane];
        if (timer) clearTimeout(timer);
      }
      laneTimersRef.current = {};
    };
  }, [circleId, fetchActivity]);

  const getAgentColor = (name: string, source?: string | null): string => {
    if (source === 'github') return '#238636';
    const agent = agents.find(a => a.name === name);
    return agent?.color || '#6366f1';
  };

  const getAgentIcon = (name: string, source?: string | null): string => {
    if (source === 'github') return '{>}';
    const agent = agents.find(a => a.name === name);
    return agent?.toolIcon || '>>';
  };

  // One chronological, deduped timeline across all four lanes. Only failed
  // automation runs surface here (matching the previous rendering).
  const failedRuns = useMemo(() => runs.filter(r => r.status === 'failed'), [runs]);
  const timeline = useMemo(
    () => buildFeedTimeline({
      activity: items,
      automationRuns: failedRuns,
      taskRuns,
      proofs: proofItems,
    }),
    [items, failedRuns, taskRuns, proofItems],
  );

  // ─── Per-kind row renderers (existing visual language, reordered) ──────

  const renderTaskRun = (run: TaskRunFeedItem) => {
    const agent = agents.find(a => a.id === run.agent_id);
    const color = run.status === 'failed' ? '#ef4444' : (agent?.color || '#22c55e');
    const runMetadata = run.openswan_run_id ? taskRunMetadataByRunId[run.openswan_run_id] : null;
    return (
      <View key={`task-run-${run.id}`} style={[s.item, { borderLeftWidth: 3, borderLeftColor: color }]}>
        <View style={s.itemRow}>
          <View style={[s.iconCircle, { backgroundColor: color + '20' }]}>
            <Text style={[s.iconText, { color }]}>{run.status === 'failed' ? '!' : '>'}</Text>
          </View>
          <View style={s.itemContent}>
            <View style={s.itemNameRow}>
              <Text style={[s.itemAgent, { color }]}>{agent?.name || run.agent_id}</Text>
              <Text style={[s.sourceBadge, { color }]}>{run.run_kind}</Text>
            </View>
            <Text style={s.itemAction}>{run.summary || 'Completed task run'}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {run.model_used ? <Text style={{ color: '#6f6f6f', fontSize: 11 }}>{run.model_used}</Text> : null}
              {run.duration_ms ? <Text style={{ color: '#6f6f6f', fontSize: 11 }}>{(run.duration_ms / 1000).toFixed(1)}s</Text> : null}
              {run.token_count ? <Text style={{ color: '#6f6f6f', fontSize: 11 }}>{run.token_count} tok</Text> : null}
            </View>
            {runMetadata ? (
              <View style={{ marginTop: 6 }}>
                <RunMetadataSummary
                  {...buildRunMetadataSummaryProps(runMetadata)}
                  variant="compact"
                  accentColor="#38bdf8"
                />
              </View>
            ) : null}
            <Text style={s.timestamp}>{timeAgo(run.started_at)}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderAutomationRun = (run: AutomationRun) => (
    <View key={`run-${run.id}`} style={[s.item, { borderLeftWidth: 3, borderLeftColor: '#ef4444' }]}>
      <View style={s.itemRow}>
        <View style={[s.iconCircle, { backgroundColor: '#ef444420' }]}>
          <Text style={[s.iconText, { color: '#ef4444' }]}>!</Text>
        </View>
        <View style={s.itemContent}>
          <View style={s.itemNameRow}>
            <Text style={[s.itemAgent, { color: '#ef4444' }]}>Automation Failed</Text>
            <Text style={[s.sourceBadge, { color: '#ef4444' }]}>{run.trigger_source || 'auto'}</Text>
          </View>
          <Text style={s.itemAction}>{run.model_used || 'Unknown model'} {run.duration_ms ? `(${(run.duration_ms / 1000).toFixed(1)}s)` : ''}</Text>
          {run.error_message && (
            <Text style={[s.itemDetail, { color: '#fca5a5' }]} numberOfLines={expanded[`run-${run.id}`] ? undefined : 2}>
              {run.error_message}
            </Text>
          )}
          {run.error_message && (run.error_message.length > 80) && !expanded[`run-${run.id}`] && (
            <Text style={s.moreLink} onPress={() => setExpanded(p => ({ ...p, [`run-${run.id}`]: true }))}>
              see error details...
            </Text>
          )}
          <Text style={s.timestamp}>{timeAgo(run.started_at)}</Text>
        </View>
      </View>
    </View>
  );

  const renderActivityItem = (item: ActivityItem) => {
    const isGitHub = item.source === 'github';
    const color = getAgentColor(item.agent_name, item.source);
    const icon = getAgentIcon(item.agent_name, item.source);
    const isExpanded = expanded[item.id];
    const detail = item.body || item.title;
    const hasLongDetail = (detail?.length || 0) > 80;
    const displayName = isGitHub ? (item.source_detail || 'GitHub') : item.agent_name;

    return (
      <View key={item.id} style={s.item}>
        <View style={s.itemRow}>
          <View style={[s.iconCircle, { backgroundColor: color + '20' }]}>
            <Text style={[s.iconText, { color }]}>{icon}</Text>
          </View>
          <View style={s.itemContent}>
            <View style={s.itemNameRow}>
              <Text style={s.itemAgent}>{displayName}</Text>
              {isGitHub && <Text style={[s.sourceBadge, { color: '#238636' }]}>GH</Text>}
              <View style={s.readDot} />
            </View>
            <Text style={s.itemAction}>{item.title || item.activity_type}</Text>
            {item.body && (
              <Text
                style={s.itemDetail}
                numberOfLines={isExpanded ? undefined : 2}
              >
                {item.body}
              </Text>
            )}
            {hasLongDetail && !isExpanded && (
              <Text
                style={s.moreLink}
                onPress={() => setExpanded(p => ({ ...p, [item.id]: true }))}
              >
                more...
              </Text>
            )}
            <Text style={s.timestamp}>{timeAgo(item.created_at)}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderProof = (pow: ProofItem) => {
    const powColors: Record<string, string> = {
      commit: '#22d3ee', pr: '#a855f7', deploy: '#f59e0b',
      agent_run: '#22c55e', checkin: '#6366f1', manual: '#e8e8e8',
    };
    const powIcons: Record<string, string> = {
      commit: '>_', pr: '[]', deploy: '//',
      agent_run: '$', checkin: '#', manual: '+',
    };
    const color = powColors[pow.pow_type] || '#888';
    const icon = powIcons[pow.pow_type] || '+';
    return (
      <View key={`pow-${pow.id}`} style={s.item}>
        <View style={s.itemRow}>
          <View style={[s.iconCircle, { backgroundColor: color + '18' }]}>
            <Text style={[s.iconText, { color }]}>{icon}</Text>
          </View>
          <View style={s.itemContent}>
            <View style={s.itemNameRow}>
              <Text style={[s.itemAgent, { color }]}>{pow.agent_name || 'proof'}</Text>
              <Text style={[s.sourceBadge, { color }]}>POW</Text>
            </View>
            <Text style={s.itemAction}>{pow.title}</Text>
            {pow.pow_type === 'agent_run' && <AgentRunProofDetail detail={pow.detail} />}
            <Text style={s.timestamp}>{timeAgo(pow.created_at)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerBolt}>&#x26A1;</Text>
          <Text style={s.headerTitle}>ACTIVITY</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{timeline.items.length}</Text>
          </View>
        </View>
      </View>

      {/* Feed — one merged, deduped, time-desc timeline */}
      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
        {timeline.items.map(entry => {
          switch (entry.kind) {
            case 'proof': return renderProof(entry.row as ProofItem);
            case 'activity': return renderActivityItem(entry.row as ActivityItem);
            case 'task_run': return renderTaskRun(entry.row as TaskRunFeedItem);
            case 'automation_run': return renderAutomationRun(entry.row as AutomationRun);
            default: return null;
          }
        })}

        {timeline.truncatedCount > 0 && (
          <Text style={s.truncatedNote}>+{timeline.truncatedCount} older item{timeline.truncatedCount === 1 ? '' : 's'}</Text>
        )}

        {timeline.items.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>&#x26A1;</Text>
            <Text style={s.emptyText}>No activity yet</Text>
            <Text style={s.emptySubtext}>Agent actions and proof-of-work will appear here</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    width: 260,
    backgroundColor: '#0d0d16',
    borderRightWidth: 1,
    borderRightColor: '#15151e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBolt: {
    fontSize: 13,
  },
  headerTitle: {
    color: '#9090a8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  countBadge: {
    backgroundColor: '#1a1a28',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 8,
    gap: 2,
  },
  item: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#15151e08',
  },
  itemRow: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemAgent: {
    color: '#e4e4ed',
    fontSize: 12,
    fontWeight: '700',
  },
  readDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#333348',
  },
  sourceBadge: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  itemAction: {
    color: '#9090a8',
    fontSize: 11,
    lineHeight: 15,
  },
  itemDetail: {
    color: '#6b6b80',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  moreLink: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  timestamp: {
    color: '#444455',
    fontSize: 10,
    marginTop: 3,
  },
  truncatedNote: {
    color: '#444455',
    fontSize: 10,
    textAlign: 'center',
    paddingVertical: 8,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 6,
  },
  emptyIcon: {
    fontSize: 20,
    opacity: 0.3,
  },
  emptyText: {
    color: '#333348',
    fontSize: 12,
    fontWeight: '500',
  },
  emptySubtext: {
    color: '#333333',
    fontSize: 11,
  },
});
