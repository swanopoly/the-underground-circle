/**
 * ActivityFeedPanel — live agent activity feed for the HQ Dashboard
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';

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

export default function ActivityFeedPanel({ circleId, agents }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskRunFeedItem[]>([]);
  const [proofItems, setProofItems] = useState<ProofItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const automationRunsSupportedRef = useRef(true);
  const taskRunsSupportedRef = useRef(true);
  const proofSupportedRef = useRef(true);

  const fetchActivity = useCallback(async () => {
    try {
      // Fetch both activity and recent automation runs in parallel
      const actRes = await supabase
        .from('agent_activity')
        .select('id, agent_name, activity_type, source, source_detail, title, body, created_at')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(60);

      if (!actRes.error && actRes.data) setItems(actRes.data);

      if (automationRunsSupportedRef.current) {
        const runRes = await supabase
          .from('automation_runs')
          .select('id, status, error_message, output_text, model_used, estimated_cost, duration_ms, trigger_source, started_at')
          .eq('circle_id', circleId)
          .in('status', ['failed', 'completed'])
          .order('started_at', { ascending: false })
          .limit(10);

        if (runRes.error) {
          automationRunsSupportedRef.current = false;
          setRuns([]);
          console.warn('[ActivityFeedPanel] automation_runs unavailable:', runRes.error.message);
        } else if (runRes.data) {
          setRuns(runRes.data);
        }
      }

      if (taskRunsSupportedRef.current) {
        const taskRunRes = await supabase
          .from('task_runs')
          .select('id, task_id, agent_id, run_kind, status, summary, model_used, token_count, duration_ms, started_at')
          .eq('circle_id', circleId)
          .in('status', ['completed', 'failed'])
          .order('started_at', { ascending: false })
          .limit(12);

        if (taskRunRes.error) {
          taskRunsSupportedRef.current = false;
          setTaskRuns([]);
          console.warn('[ActivityFeedPanel] task_runs unavailable:', taskRunRes.error.message);
        } else if (taskRunRes.data) {
          setTaskRuns(taskRunRes.data);
        }
      }

      // Fetch proof-of-work entries
      if (proofSupportedRef.current) {
        const powRes = await supabase
          .from('proof_of_work')
          .select('id, pow_type, title, agent_name, created_at, detail')
          .eq('circle_id', circleId)
          .order('created_at', { ascending: false })
          .limit(20);

        if (powRes.error) {
          proofSupportedRef.current = false;
          setProofItems([]);
        } else if (powRes.data) {
          setProofItems(powRes.data);
        }
      }
    } catch (err) {
      console.error('ActivityFeed fetch error:', err);
    }
  }, [circleId]);

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

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerBolt}>&#x26A1;</Text>
          <Text style={s.headerTitle}>ACTIVITY</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{items.length}</Text>
          </View>
        </View>
      </View>

      {/* Feed */}
      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
        {/* Recent task runs */}
        {taskRuns.map(run => {
          const agent = agents.find(a => a.id === run.agent_id);
          const color = run.status === 'failed' ? '#ef4444' : (agent?.color || '#22c55e');
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
                  <Text style={s.timestamp}>{timeAgo(run.started_at)}</Text>
                </View>
              </View>
            </View>
          );
        })}

        {/* Failed/recent automation runs */}
        {runs.filter(r => r.status === 'failed').map(run => (
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
        ))}

        {items.map(item => {
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
        })}

        {/* Proof-of-work entries */}
        {proofItems.map(pow => {
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
                  <Text style={s.timestamp}>{timeAgo(pow.created_at)}</Text>
                </View>
              </View>
            </View>
          );
        })}

        {items.length === 0 && proofItems.length === 0 && (
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
