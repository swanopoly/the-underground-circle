/**
 * FeedTab — HQ Dashboard with AgentTopBar, GoalsPanel, ActivityFeed, KanbanBoard
 *
 * Desktop: three-panel layout + top bar
 * Mobile: tab switcher between Goals | Activity | Board
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Platform, ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useDebouncedValue } from '@mantine/hooks';
import { useKanbanData, type KanbanMember } from '../../../hooks/useKanbanData';
import { useGoals } from '../../../hooks/useGoals';
import { usePlans } from '../../../hooks/usePlans';
import {
  KanbanTask, TaskStatus, TaskPriority, TaskCompletionPolicy, TasksByColumn,
  COLUMNS, PRIORITY_COLORS, PRIORITY_LABELS,
} from '../../../types/kanban';
import type { GoalWithCount } from '../../../hooks/useGoals';
import type { CircleOfficeAgent, AgentStatus } from '../../../lib/circleOffice';
import { subscribeToCircleOffice } from '../../../lib/circleOffice';
import { useAutoConnectLiveAgents, mergeDbAndLiveCircleAgents } from '../../../hooks/useAutoConnectLiveAgents';
import { getAdaptiveFeedDefaults, loadAdaptiveWorkspaceSettings, loadCircleWorkspaceProfile, recordFeedActivity } from '../../../lib/workspaceAdaptation';
import { useCircleAutomations, useDashboardStats } from '../../../services/automationService';
import { useProjectRooms } from '../../../services/projectRooms';
import type { CircleIntegrationGroupKey } from '../../../lib/circleIntegrationCatalog';

import { supabase } from '../../../lib/supabase';
import CircleStoriesRail from '../../../components/stories/CircleStoriesRail.web';
import AgentTopBar from './kanban/AgentTopBar';
import OrchestraPanel from './kanban/OrchestraPanel';
import GoalsPanel from './kanban/GoalsPanel';
import ActivityFeedPanel from './kanban/ActivityFeedPanel';
import KanbanBoard from './kanban/KanbanBoard';
import TaskDetailModal from './kanban/TaskDetailModal';
import GoalDetailModal from './kanban/GoalDetailModal';
import TaskCalendar from '../../../components/TaskCalendar';
import TaskTable from '../../../components/TaskTable';
import MemberCardModal from '../../../components/MemberCardModal';

// ─── Loading Animation (uses shared circle loader) ──────────────────────

import { LoadingScreen as FeedLoadingAnimation } from '../../../components/LoadingWave';
import MissionsTab from './MissionsTab';
import { useMissions, useMissionDetail, missionProgress, isOverdue, type Mission } from '../../../lib/missions';
import SuggestedTaskChips from '../../../components/SuggestedTaskChips';
import { getEmptyStateSuggestions, type EmptyStateSuggestionAction } from '../../../lib/emptyStateSuggestions';
import { classifyRunFreshness, runEmptyStateModel, freshnessRank } from '../../../lib/runFreshnessCore';
import NeedsAttentionPanel from '../../../components/feed/NeedsAttentionPanel';
import { buildNeedsAttention } from '../../../lib/accountabilityNagCore';
import { SEED_EVENT_NAME, buildComposerSeedDetail } from '../../../lib/chatComposerSeedCore';

// ─── Task Search Bar (rendered in FeedTab, right under OrchestraPanel) ────

function TaskSearchBar({
  searchText,
  onSearchChange,
  filterPriority,
  onFilterPriority,
  filterAssignee,
  onFilterAssignee,
  filterRoom,
  onFilterRoom,
  assigneeOptions,
  roomOptions,
  searchInputRef,
  totalTasks,
}: {
  searchText: string;
  onSearchChange: (text: string) => void;
  filterPriority: TaskPriority | null;
  onFilterPriority: (p: TaskPriority | null) => void;
  filterAssignee: string | null;
  onFilterAssignee: (a: string | null) => void;
  filterRoom: string | null;
  onFilterRoom: (roomId: string | null) => void;
  assigneeOptions: { id: string; label: string; color: string }[];
  roomOptions: { id: string; label: string; color: string }[];
  searchInputRef?: React.RefObject<TextInput | null>;
  totalTasks: number;
}) {
  const hasFilters = searchText || filterPriority || filterAssignee || filterRoom;
  return (
    <View style={fb.filterBar}>
      <View style={fb.searchRow}>
        <Text style={fb.searchIcon}>/</Text>
        <TextInput
          ref={searchInputRef as any}
          style={fb.searchInput}
          placeholder="Search tasks..."
          placeholderTextColor="#444444"
          value={searchText}
          onChangeText={onSearchChange}
          maxLength={100}
        />
        {hasFilters ? (
          <Pressable onPress={() => { onSearchChange(''); onFilterPriority(null); onFilterAssignee(null); onFilterRoom(null); }} style={fb.clearBtn}>
            <Text style={fb.clearBtnText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fb.filterChips}>
        {(['urgent', 'high', 'normal', 'low'] as TaskPriority[]).map(p => {
          const active = filterPriority === p;
          return (
            <Pressable key={p} onPress={() => onFilterPriority(active ? null : p)} style={[fb.filterChip, active && fb.filterChipActive]}>
              <Text style={[fb.filterChipText, active && { color: '#e8e8e8' }]}>{PRIORITY_LABELS[p]}</Text>
            </Pressable>
          );
        })}
        <View style={fb.taskCount}>
          <Text style={fb.taskCountText}>{totalTasks} tasks</Text>
        </View>
        {assigneeOptions.map(opt => {
          const active = filterAssignee === opt.id;
          return (
            <Pressable key={opt.id} onPress={() => onFilterAssignee(active ? null : opt.id)} style={[fb.filterChip, active && { backgroundColor: opt.color + '18', borderColor: opt.color + '30' }]}>
              <View style={[fb.filterChipDot, { backgroundColor: opt.color }]} />
              <Text style={[fb.filterChipText, active && { color: opt.color }]} numberOfLines={1}>{opt.label}</Text>
            </Pressable>
          );
        })}
        {roomOptions.map(opt => {
          const active = filterRoom === opt.id;
          return (
            <Pressable key={opt.id} onPress={() => onFilterRoom(active ? null : opt.id)} style={[fb.filterChip, active && { backgroundColor: opt.color + '18', borderColor: opt.color + '30' }]}>
              <View style={[fb.filterChipDot, { backgroundColor: opt.color }]} />
              <Text style={[fb.filterChipText, active && { color: opt.color }]} numberOfLines={1}>Room: {opt.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Agent Tasks Panel (shows auto-created tasks from agent invocations) ────

function isAgentTask(task: KanbanTask): boolean {
  return (task.description || '').includes('**Agent:**');
}

function parseAgentTaskMeta(task: KanbanTask): {
  agentName: string;
  model: string;
  duration: string;
  tokens: string;
  prompt: string;
  response: string;
  status: 'processing' | 'done' | 'failed';
} {
  const desc = task.description || '';
  const agentMatch = desc.match(/\*\*Agent:\*\*\s*(.+)/);
  const modelMatch = desc.match(/\*\*Model:\*\*\s*(.+)/);
  const durationMatch = desc.match(/\*\*Duration:\*\*\s*(.+)/);
  const tokensMatch = desc.match(/\*\*Tokens:\*\*\s*(.+)/);
  const statusMatch = desc.match(/\*\*Status:\*\*\s*(.+)/);

  // Extract prompt (between first ``` pair)
  const promptMatch = desc.match(/\*\*Prompt\*\*\s*```\s*([\s\S]*?)```/);
  // Extract response (between last ``` pair after **Response**)
  const responseMatch = desc.match(/\*\*Response\*\*\s*```\s*([\s\S]*?)```/);

  const isProcessing = desc.includes('*Processing...*');
  const isFailed = statusMatch?.[1]?.includes('Failed') || task.status === 'review';

  return {
    agentName: agentMatch?.[1] || 'Agent',
    model: modelMatch?.[1] || '',
    duration: durationMatch?.[1] || '',
    tokens: tokensMatch?.[1] || '',
    prompt: promptMatch?.[1]?.trim() || '',
    response: responseMatch?.[1]?.trim() || '',
    status: isProcessing ? 'processing' : isFailed ? 'failed' : 'done',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HuggingSwan Activity Panel — shows HF tool invocations from agent_activity
// ═══════════════════════════════════════════════════════════════════════════════

type HfActivity = {
  id: string;
  title: string;
  body: string;
  status: string;
  metadata: any;
  created_at: string;
};

function HuggingSwanPanel({ circleId }: { circleId: string }) {
  const [activities, setActivities] = useState<HfActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('agent_activity')
        .select('id, title, body, status, metadata, created_at')
        .eq('circle_id', circleId)
        .eq('activity_type', 'tool_call')
        .or('agent_name.eq.HuggingSwan,agent_name.eq.HF Proxy')
        .order('created_at', { ascending: false })
        .limit(30);
      if (!cancelled) {
        setActivities(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [circleId]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`hf-activity-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_activity',
        filter: `circle_id=eq.${circleId}`,
      }, (payload: any) => {
        const row = payload.new;
        if (row.activity_type === 'tool_call' && (row.agent_name === 'HuggingSwan' || row.agent_name === 'HF Proxy')) {
          setActivities(prev => [row, ...prev].slice(0, 30));
        }
      })
      .subscribe((status, err) => {
        if (err) console.error('[FeedTab] Realtime subscription error:', err);
      });
    return () => { supabase.removeChannel(channel); };
  }, [circleId]);

  const parseBody = (body: string) => {
    try { return JSON.parse(body); } catch { return null; }
  };

  if (loading) {
    return (
      <View style={hs.container}>
        <Text style={hs.loading}>Loading HuggingSwan activity...</Text>
      </View>
    );
  }

  return (
    <View style={hs.container}>
      <View style={hs.header}>
        <Text style={hs.headerIcon}>🤗</Text>
        <Text style={hs.headerTitle}>HUGGINGSWAN AI TOOLS</Text>
        <View style={[at.countBadge, { marginLeft: 8 }]}>
          <Text style={at.countText}>{activities.length}</Text>
        </View>
      </View>

      {activities.length === 0 ? (
        <View style={hs.emptyState}>
          <Text style={hs.emptyText}>
            No AI tool activity yet. Ask BlackSwan to generate an image,
            summarize text, classify sentiment, or translate — it will use
            Hugging Face models automatically.
          </Text>
          <View style={hs.chipRow}>
            {['"generate an image of a sunset"', '"summarize this PR"', '"classify: is this a bug?"', '"translate to French"'].map(hint => (
              <View key={hint} style={hs.hintChip}>
                <Text style={hs.hintText}>{hint}</Text>
              </View>
            ))}
          </View>
          {/* Actionable next steps. These map to real chat commands
              (/create, /watch, /review, /imagine) that all live in the Chat
              surface: seed the composer with the command, then navigate
              there via the existing uc:switch-tab event. */}
          <View style={{ marginTop: 14, width: '100%' }}>
            <SuggestedTaskChips
              suggestions={getEmptyStateSuggestions('feed')}
              onPick={(action: EmptyStateSuggestionAction) => {
                // Every feed suggestion is a chat command; seed the composer, then open Chat.
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                  const seed = action.kind === 'seed_command' ? buildComposerSeedDetail(action.value) : null;
                  try {
                    if (seed) window.dispatchEvent(new CustomEvent(SEED_EVENT_NAME, { detail: seed }));
                    window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab: 'CHAT' } }));
                  } catch {}
                }
              }}
              accentColor="#a5b4fc"
              nativeID="section-feed-empty-suggestions"
            />
          </View>
        </View>
      ) : (
        <ScrollView style={hs.list} showsVerticalScrollIndicator={false}>
          {activities.map(act => {
            const parsed = parseBody(act.body);
            const tool = act.metadata?.tool || act.title.split(':')[0] || 'tool';
            const isImage = tool.includes('image') && parsed?.image_url;
            const time = timeAgo(act.created_at);

            return (
              <View key={act.id} style={hs.card}>
                <View style={hs.cardHeader}>
                  <Text style={hs.toolBadge}>
                    {tool.replace('hf_', '').replace(/_/g, ' ').toUpperCase()}
                  </Text>
                  <Text style={hs.cardTime}>{time}</Text>
                </View>
                <Text style={hs.cardTitle} numberOfLines={2}>{act.title}</Text>

                {/* Image preview */}
                {isImage && parsed.image_url && (
                  <View style={hs.imageWrap}>
                    {Platform.OS === 'web' ? (
                      <img
                        src={parsed.image_url}
                        style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 6 } as any}
                        alt="Generated"
                      />
                    ) : null}
                  </View>
                )}

                {/* Summary text */}
                {parsed?.summary && (
                  <Text style={hs.resultText} numberOfLines={4}>{parsed.summary}</Text>
                )}

                {/* Translation result */}
                {parsed?.translated && (
                  <Text style={hs.resultText}>{parsed.translated}</Text>
                )}

                {/* Classification result */}
                {parsed?.classification && Array.isArray(parsed.classification) && (
                  <View style={hs.chipRow}>
                    {(Array.isArray(parsed.classification[0]) ? parsed.classification[0] : parsed.classification).slice(0, 3).map((c: any, i: number) => (
                      <View key={i} style={hs.classBadge}>
                        <Text style={hs.classLabel}>{c.label}</Text>
                        <Text style={hs.classScore}>{(c.score * 100).toFixed(0)}%</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Chat reply */}
                {parsed?.reply && (
                  <Text style={hs.resultText} numberOfLines={4}>{parsed.reply}</Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const hs = StyleSheet.create({
  container: { flex: 1 },
  loading: { color: '#6b7280', textAlign: 'center', marginTop: 40, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerIcon: { fontSize: 16, marginRight: 6 },
  headerTitle: { color: '#e8e8e8', fontSize: 11, fontWeight: '700', letterSpacing: 1, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  emptyState: { padding: 16, alignItems: 'center' },
  emptyText: { color: '#6b7280', fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  hintChip: { backgroundColor: '#1a1a2e', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#2a2a4a' },
  hintText: { color: '#9ca3af', fontSize: 10, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontStyle: 'italic' },
  list: { flex: 1, paddingHorizontal: 8 },
  card: { backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a', padding: 10, marginBottom: 6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  toolBadge: { backgroundColor: '#6366f120', color: '#a5b4fc', fontSize: 9, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, overflow: 'hidden', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, letterSpacing: 0.5 },
  cardTime: { color: '#4b5563', fontSize: 10, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  cardTitle: { color: '#9ca3af', fontSize: 11, lineHeight: 16, marginBottom: 4 },
  imageWrap: { borderRadius: 6, overflow: 'hidden', marginTop: 4, backgroundColor: '#111' },
  resultText: { color: '#d1d5db', fontSize: 11, lineHeight: 16, marginTop: 4, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  classBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  classLabel: { color: '#d1d5db', fontSize: 10, fontWeight: '600', marginRight: 4 },
  classScore: { color: '#6b7280', fontSize: 10 },
});

// ═══════════════════════════════════════════════════════════════════════════════

function ActiveRunsWidget({ circleId }: { circleId: string }) {
  const [runs, setRuns] = React.useState<any[]>([]);
  React.useEffect(() => {
    (async () => {
      try {
        const { getActiveRuns } = await import('../../../lib/agentRunSystem');
        setRuns(await getActiveRuns(circleId));
      } catch {}
    })();
    const interval = setInterval(async () => {
      try {
        const { getActiveRuns } = await import('../../../lib/agentRunSystem');
        setRuns(await getActiveRuns(circleId));
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [circleId]);

  const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  // Shared freshness → colour so Feed paints the identical dot/label that Chat
  // and Office do from one `agent_runs` row (runFreshnessCore is the one brain).
  const freshnessColors: Record<string, string> = {
    live: '#22c55e',
    recent: '#6366f1',
    idle: '#f59e0b',
    stale: '#ef4444',
    done: '#606075',
    unknown: '#606075',
  };

  // Finding 2: a just-finished run or a momentary poll gap must NOT blank the
  // widget via `return null`. Render an explicit "no active runs" affordance.
  const emptyState = runEmptyStateModel({ hasRuns: runs.length, loading: false, error: null });
  if (emptyState.kind !== 'has_data') {
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO, marginBottom: 6 }}>ACTIVE RUNS ({runs.length})</Text>
        <Text style={{ color: '#3a3a4e', fontSize: 10, fontFamily: MONO }}>{emptyState.message}</Text>
      </View>
    );
  }

  // Classify each run once, then order most-alive → over via the shared rank.
  const nowMs = Date.now();
  const rankedRuns = runs
    .map((run: any) => ({
      run,
      fresh: classifyRunFreshness({
        status: run.status,
        updatedAtMs: Date.parse(run.updated_at || run.completed_at || run.started_at || run.created_at),
        nowMs,
      }),
    }))
    .sort((a, b) => freshnessRank(a.fresh.freshness) - freshnessRank(b.fresh.freshness));

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO, marginBottom: 6 }}>ACTIVE RUNS ({runs.length})</Text>
      {rankedRuns.map(({ run, fresh }) => {
        const dotColor = freshnessColors[fresh.freshness] || '#606075';
        return (
          <View key={run.id} style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: dotColor + '40', borderRadius: 2, padding: 8, marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
              <Text style={{ color: '#f0f0f5', fontSize: 10, fontWeight: '600', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{run.title || 'Untitled'}</Text>
              <Text style={{ color: dotColor, fontSize: 8, fontWeight: '700', fontFamily: MONO }}>{fresh.label}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
              <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO }}>{run.surface}</Text>
              {run.delegated_to && <Text style={{ color: '#a855f7', fontSize: 8, fontFamily: MONO }}>{run.delegated_to}</Text>}
              {run.mode !== 'talk' && <Text style={{ color: '#606075', fontSize: 8, fontFamily: MONO }}>{run.mode}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

function AgentTasksPanel({
  tasksByColumn,
  agents,
  onCardPress,
  searchText,
  filterPriority,
  filterAssignee,
  filterRoom,
}: {
  tasksByColumn: TasksByColumn;
  agents: CircleOfficeAgent[];
  onCardPress: (task: KanbanTask) => void;
  searchText: string;
  filterPriority: TaskPriority | null;
  filterAssignee: string | null;
  filterRoom: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string | null>(null);

  // Collect all agent tasks sorted by newest first
  const agentTasks = useMemo(() => {
    const all: KanbanTask[] = [];
    for (const col of Object.values(tasksByColumn)) {
      for (const t of col) {
        if (isAgentTask(t)) all.push(t);
      }
    }
    return all.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ).slice(0, 50);
  }, [tasksByColumn]);

  const searchQuery = searchText.toLowerCase().trim();

  const filteredTasks = agentTasks.filter(task => {
    const meta = parseAgentTaskMeta(task);
    if (filterAgent && meta.agentName !== filterAgent) return false;
    if (filterPriority && task.priority !== filterPriority) return false;
    if (filterAssignee) {
      if (filterAssignee.startsWith('agent:')) {
        const agentId = filterAssignee.slice(6);
        const assignedAgentIds = task.assigned_agent_ids || (task.assigned_agent_id ? [task.assigned_agent_id] : []);
        if (!assignedAgentIds.includes(agentId)) return false;
      } else if (task.assigned_to !== filterAssignee) {
        return false;
      }
    }
    if (filterRoom && task.room_id !== filterRoom) return false;
    if (!searchQuery) return true;

    const haystack = [task.title, task.description || '', meta.prompt, meta.response]
      .join('\n')
      .toLowerCase();
    return haystack.includes(searchQuery);
  });

  const processingCount = agentTasks.filter(t => parseAgentTaskMeta(t).status === 'processing').length;

  // Extract unique agent names + match to agent records for spirit info
  const activeAgentNames = useMemo(() => {
    const names = new Set(agentTasks.map(t => parseAgentTaskMeta(t).agentName));
    return Array.from(names);
  }, [agentTasks]);

  // Extract tool calls from task descriptions
  const parseToolCalls = (desc: string): string[] => {
    const tools: string[] = [];
    const toolMatches = desc.match(/\*\*([a-z_]+)\*\*:/g);
    if (toolMatches) {
      for (const m of toolMatches) {
        tools.push(m.replace(/\*\*/g, '').replace(':', ''));
      }
    }
    // Also check for action summaries
    const actionMatches = desc.match(/[✅❌] \*\*([a-z_]+)\*\*/g);
    if (actionMatches) {
      for (const m of actionMatches) {
        const tool = m.replace(/[✅❌] \*\*/g, '').replace(/\*\*/g, '');
        if (!tools.includes(tool)) tools.push(tool);
      }
    }
    return tools;
  };

  return (
    <View style={at.container}>
      <View style={at.header}>
        <View style={at.headerLeft}>
          <Text style={at.headerIcon}>{'\u2699'}</Text>
          <Text style={at.headerTitle}>AGENT TASKS</Text>
          <View style={at.countBadge}>
            <Text style={at.countText}>{filteredTasks.length}</Text>
          </View>
          {processingCount > 0 && (
            <View style={at.liveBadge}>
              <View style={at.liveDot} />
              <Text style={at.liveText}>{processingCount} active</Text>
            </View>
          )}
        </View>
      </View>

      {/* Agent filter chips with spirit info */}
      {activeAgentNames.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 8, marginBottom: 4, maxHeight: 32 }}>
          <Pressable
            onPress={() => setFilterAgent(null)}
            style={[at.filterChip, !filterAgent && at.filterChipActive]}
          >
            <Text style={[at.filterChipText, !filterAgent && { color: '#fff' }]}>All</Text>
          </Pressable>
          {activeAgentNames.map(name => {
            const agent = agents.find(a => a.name === name);
            const isActive = filterAgent === name;
            return (
              <Pressable
                key={name}
                onPress={() => setFilterAgent(isActive ? null : name)}
                style={[at.filterChip, isActive && { borderColor: agent?.color || '#6366f1', backgroundColor: (agent?.color || '#6366f1') + '20' }]}
              >
                {agent?.spirit_emoji && <Text style={{ fontSize: 11, marginRight: 3 }}>{agent.spirit_emoji}</Text>}
                <Text style={[at.filterChipText, isActive && { color: agent?.color || '#fff' }]}>{name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView style={at.list} contentContainerStyle={at.listContent} showsVerticalScrollIndicator={false}>
        {filteredTasks.map(task => {
          const meta = parseAgentTaskMeta(task);
          const agent = agents.find(a => a.name === meta.agentName);
          const color = agent?.color || '#e8e8e8';
          const isExpanded = expandedId === task.id;
          const timeStr = timeAgo(task.created_at);
          const toolCalls = parseToolCalls(task.description || '');

          return (
            <Pressable
              key={task.id}
              onPress={() => onCardPress(task)}
              style={[at.card, meta.status === 'processing' && at.cardActive]}
            >
              {/* Status + Agent + Spirit row */}
              <View style={at.cardTopRow}>
                <View style={at.statusRow}>
                  <View style={[
                    at.statusDot,
                    meta.status === 'processing' ? at.statusProcessing :
                    meta.status === 'failed' ? at.statusFailed :
                    at.statusDone,
                  ]} />
                  {agent?.spirit_emoji && <Text style={{ fontSize: 12, marginRight: 3 }}>{agent.spirit_emoji}</Text>}
                  <Text style={[at.agentName, { color }]}>{meta.agentName}</Text>
                  {agent?.spirit && (
                    <Text style={at.spiritBadge}>{agent.spirit.replace(/-/g, ' ')}</Text>
                  )}
                </View>
                <Text style={at.timeText}>{timeStr}</Text>
              </View>

              {/* Prompt preview */}
              <Text style={at.promptText} numberOfLines={isExpanded ? 6 : 2}>
                {meta.prompt || task.title}
              </Text>

              {/* Tool call chips */}
              {toolCalls.length > 0 && (
                <View style={at.toolRow}>
                  {toolCalls.map((tool, i) => (
                    <View key={i} style={at.toolChip}>
                      <Text style={at.toolChipText}>{tool}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Metrics row (only for completed) */}
              {meta.status !== 'processing' && (meta.tokens || meta.duration) && (
                <View style={at.metricsRow}>
                  {meta.model ? <Text style={at.metricText}>{meta.model}</Text> : null}
                  {meta.duration && meta.duration !== 'N/A' ? (
                    <Text style={at.metricText}>{meta.duration}</Text>
                  ) : null}
                  {meta.tokens && meta.tokens !== 'N/A' ? (
                    <Text style={at.metricText}>{meta.tokens} tok</Text>
                  ) : null}
                </View>
              )}

              {/* Processing indicator */}
              {meta.status === 'processing' && (
                <Text style={at.processingText}>Processing...</Text>
              )}

              {/* Response preview (expandable) */}
              {meta.response && (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setExpandedId(isExpanded ? null : task.id);
                  }}
                  style={at.responseToggle}
                >
                  <Text style={at.responseToggleText}>
                    {isExpanded ? 'Hide response' : 'Show response'}
                  </Text>
                </Pressable>
              )}
              {isExpanded && meta.response && (
                <View style={at.responseBox}>
                  <Text style={at.responseText} numberOfLines={20}>
                    {meta.response}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}

        {filteredTasks.length === 0 && (
          <View style={at.empty}>
            <Text style={at.emptyIcon}>{'\u2699'}</Text>
            <Text style={at.emptyText}>No agent tasks yet</Text>
            <Text style={at.emptySubtext}>Tasks auto-created from agent prompts appear here</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const MOBILE_BREAKPOINT = 768;

type MobileTab = 'missions' | 'goals' | 'activity' | 'agents' | 'board' | 'ai-tools';
type DesktopLowerTab = 'activity' | 'agents' | 'ai-tools';

const AGENT_ASSIGNMENT_STATUS_ORDER: Record<AgentStatus, number> = {
  active: 0,
  building: 1,
  idle: 2,
  offline: 3,
  error: 4,
};

function isConnectedAgent(agent: Pick<CircleOfficeAgent, 'status'>): boolean {
  return agent.status === 'active' || agent.status === 'building' || agent.status === 'idle';
}

function compareAgentsForAssignment(
  a: Pick<CircleOfficeAgent, 'status' | 'name'>,
  b: Pick<CircleOfficeAgent, 'status' | 'name'>,
): number {
  const statusDiff =
    (AGENT_ASSIGNMENT_STATUS_ORDER[a.status] ?? 9) - (AGENT_ASSIGNMENT_STATUS_ORDER[b.status] ?? 9);
  if (statusDiff !== 0) return statusDiff;
  return a.name.localeCompare(b.name);
}

function filterTasksByBoardControls(
  tasksByColumn: TasksByColumn,
  filters: {
    searchText: string;
    filterPriority: TaskPriority | null;
    filterAssignee: string | null;
    filterRoom: string | null;
  },
): TasksByColumn {
  const q = filters.searchText.toLowerCase().trim();
  const hasFilters = q || filters.filterPriority || filters.filterAssignee || filters.filterRoom;
  if (!hasFilters) return tasksByColumn;

  const result = {} as TasksByColumn;
  for (const key of Object.keys(tasksByColumn) as TaskStatus[]) {
    result[key] = tasksByColumn[key].filter(t => {
      if (filters.filterPriority && t.priority !== filters.filterPriority) return false;
      if (filters.filterAssignee) {
        if (filters.filterAssignee.startsWith('agent:')) {
          const assignedAgentIds = t.assigned_agent_ids || (t.assigned_agent_id ? [t.assigned_agent_id] : []);
          if (!assignedAgentIds.includes(filters.filterAssignee.slice(6))) return false;
        } else if (t.assigned_to !== filters.filterAssignee) {
          return false;
        }
      }
      if (filters.filterRoom && t.room_id !== filters.filterRoom) return false;
      if (!q) return true;
      const haystack = `${t.title}\n${t.description || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }
  return result;
}

export default function FeedTab({
  circleId,
  accentColor,
  onOpenMarketplace,
}: {
  circleId: string;
  accentColor?: string;
  onOpenMarketplace?: (focus?: { itemId?: string | null; groupKey?: CircleIntegrationGroupKey | null }) => void;
}) {
  const kanban = useKanbanData(circleId);
  const goalsHook = useGoals(circleId);
  const plansHook = usePlans(circleId);
  const { automations } = useCircleAutomations(circleId);
  const { stats: dashStats } = useDashboardStats(circleId);
  const [filteredGoalId, setFilteredGoalId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<KanbanTask | null>(null);
  const [editGoal, setEditGoal] = useState<GoalWithCount | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createInColumn, setCreateInColumn] = useState<TaskStatus>('todo');
  // Pre-fill title for CreateTaskModal, seeded by `/task new <title>` in chat
  // or other deeplink flows. Cleared on modal close.
  const [createPrefillTitle, setCreatePrefillTitle] = useState('');
  const [mobileTab, setMobileTab] = useState<MobileTab>('missions');
  const [desktopLowerTab, setDesktopLowerTab] = useState<DesktopLowerTab>('activity');
  // Notion-style view toggle for the task pane: board (kanban) / calendar
  // (month grid keyed on tasks.due_date) / table (sortable rows + group-by).
  // Same underlying task data, three projections.
  const [kanbanViewMode, setKanbanViewMode] = useState<'board' | 'calendar' | 'table'>('board');

  // Member card popup — driven by the user deeplink consumer below. When
  // an @user chip is clicked, the corresponding localStorage key gets set,
  // and we resolve it here into a modal showing the member's profile card.
  const [memberCardUserId, setMemberCardUserId] = useState<string | null>(null);

  // ── Deeplink consumption ──────────────────────────────────────────────────
  // Mention chips (in chat, missions, proofs, the inbox, etc.) write these
  // localStorage keys when clicked. Here we resolve them to the in-tab
  // modals so the target opens without a separate route change. Consumed
  // once and cleared so a refresh doesn't re-trigger.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (kanban.loading) return;

    let pendingTask: string | null = null;
    let pendingGoal: string | null = null;
    let pendingUser: string | null = null;
    try { pendingTask = window.localStorage.getItem('uc_pending_task_deeplink'); } catch {}
    try { pendingGoal = window.localStorage.getItem('uc_pending_goal_deeplink'); } catch {}
    try { pendingUser = window.localStorage.getItem('uc_pending_user_deeplink'); } catch {}

    if (pendingTask) {
      const t = kanban.tasks.find((x) => x.id === pendingTask);
      if (t) {
        setDetailTask(t);
        try { window.localStorage.removeItem('uc_pending_task_deeplink'); } catch {}
      }
    }
    if (pendingGoal) {
      const g = goalsHook.goals.find((x) => x.id === pendingGoal);
      if (g) {
        setEditGoal(g);
        try { window.localStorage.removeItem('uc_pending_goal_deeplink'); } catch {}
      }
    }
    if (pendingUser) {
      // User deeplinks don't need to wait on the kanban data — pop the
      // member card immediately and clear the key so refreshes don't
      // re-trigger it.
      setMemberCardUserId(pendingUser);
      try { window.localStorage.removeItem('uc_pending_user_deeplink'); } catch {}
    }
  }, [kanban.loading, kanban.tasks, goalsHook.goals]);

  // `/task new <title>` from chat opens CreateTaskModal pre-filled with the
  // title. Matches the /mission create pattern.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onOpen = (e: any) => {
      const title = (e?.detail?.title ?? '').toString();
      setCreatePrefillTitle(title);
      setCreateInColumn('todo');
      setShowCreate(true);
      try { window.localStorage.removeItem('uc_pending_task_create'); } catch {}
    };
    try {
      const pending = window.localStorage.getItem('uc_pending_task_create');
      if (pending !== null) {
        setCreatePrefillTitle(pending);
        setCreateInColumn('todo');
        setShowCreate(true);
        window.localStorage.removeItem('uc_pending_task_create');
      }
    } catch {}
    window.addEventListener('uc:open-task-create', onOpen as any);
    return () => window.removeEventListener('uc:open-task-create', onOpen as any);
  }, []);
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const searchInputRef = useRef<TextInput>(null);

  // ─── Live agent subscription (auto-connect + DB realtime) ────
  // DB-side refresh: when the `circle_office_agents` table updates, re-fetch
  // the kanban view. Auto-connect live-session updates are handled by
  // `useAutoConnectLiveAgents` below.
  useEffect(() => {
    const unsubDb = subscribeToCircleOffice(circleId, () => {
      kanban.refresh();
    });
    return () => { unsubDb(); };
  // kanban.refresh is a stable closure; re-subscribing on every render would
  // tear down the realtime channel needlessly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId]);

  const { liveCircleAgents: liveAgents } = useAutoConnectLiveAgents({ circleId });

  // Merge DB agents with the live session list so task assignment still sees
  // the full roster. Shared across FeedTab and future consumers.
  const agents = useMemo(
    () => mergeDbAndLiveCircleAgents(kanban.agents, liveAgents),
    [kanban.agents, liveAgents],
  );

  // The ORCHESTRA strip above the board should reflect live connected sessions only
  const orchestraAgents = useMemo(() =>
    liveAgents.filter(isConnectedAgent).sort(compareAgentsForAssignment),
  [liveAgents]);

  // Sorted agents for task assignment: live connected agents first, then the rest
  const sortedAgentsForAssign = useMemo(() => {
    const liveIds = new Set(orchestraAgents.map(a => a.id));
    const liveNames = new Set(orchestraAgents.map(a => a.name.toLowerCase()));
    return [...agents].sort((a, b) => {
      const aIsLive = liveIds.has(a.id) || liveNames.has(a.name.toLowerCase());
      const bIsLive = liveIds.has(b.id) || liveNames.has(b.name.toLowerCase());
      if (aIsLive !== bIsLive) return aIsLive ? -1 : 1;
      return compareAgentsForAssignment(a, b);
    });
  }, [agents, orchestraAgents]);

  // ─── Search & filter state (lifted from KanbanBoard) ────
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText] = useDebouncedValue(searchText, 300);
  const [filterPriority, setFilterPriority] = useState<TaskPriority | null>(null);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterRoom, setFilterRoom] = useState<string | null>(null);
  // Derived: is any filter active? TaskTable + TaskCalendar consume this
  // to distinguish filtered-to-zero from genuinely empty circles.
  const hasActiveFilters = !!(searchText.trim() || filterPriority || filterAssignee || filterRoom || filteredGoalId);
  const clearAllTaskFilters = useCallback(() => {
    setSearchText('');
    setFilterPriority(null);
    setFilterAssignee(null);
    setFilterRoom(null);
    setFilteredGoalId(null);
  }, []);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const { rooms: projectRooms } = useProjectRooms(circleId);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadCircleWorkspaceProfile(circleId),
      loadAdaptiveWorkspaceSettings(circleId),
    ]).then(([profile, settings]) => {
      if (cancelled) return;
      const adaptive = getAdaptiveFeedDefaults(profile, settings);
      setMobileTab(adaptive.mobileTab as MobileTab);
      setDesktopLowerTab(adaptive.desktopLowerTab as DesktopLowerTab);
      setSearchExpanded(adaptive.searchExpanded);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [circleId]);

  useEffect(() => {
    recordFeedActivity(circleId, 'mobile_tab', mobileTab).catch(() => {});
  }, [circleId, mobileTab]);

  useEffect(() => {
    recordFeedActivity(circleId, 'desktop_lower_tab', desktopLowerTab).catch(() => {});
  }, [circleId, desktopLowerTab]);

  useEffect(() => {
    if (searchExpanded) {
      recordFeedActivity(circleId, 'search_expand').catch(() => {});
    }
  }, [circleId, searchExpanded]);

  // Collect unique assignees for filter chips
  const assigneeOptions = useMemo(() => {
    const opts: { id: string; label: string; color: string }[] = [];
    const seen = new Set<string>();
    const allTasks = Object.values(kanban.tasksByColumn).flat();
    for (const t of allTasks) {
      const assignedAgentIds = t.assigned_agent_ids || (t.assigned_agent_id ? [t.assigned_agent_id] : []);
      for (const agentId of assignedAgentIds) {
        if (seen.has('agent:' + agentId)) continue;
        seen.add('agent:' + agentId);
        const agent = agents.find(a => a.id === agentId);
        opts.push({ id: 'agent:' + agentId, label: agent?.name || 'Agent', color: agent?.color || '#e8e8e8' });
      }
      if (t.assigned_to && !seen.has(t.assigned_to)) {
        seen.add(t.assigned_to);
        opts.push({ id: t.assigned_to, label: (t as any).assignee?.display_name || (t as any).assignee?.username || 'User', color: '#e8e8e8' });
      }
    }
    return opts;
  }, [kanban.tasksByColumn, agents]);

  const handleOpenMarketplace = useCallback((focus?: { itemId?: string | null; groupKey?: CircleIntegrationGroupKey | null }) => {
    recordFeedActivity(circleId, 'marketplace_jump').catch(() => {});
    onOpenMarketplace?.(focus);
  }, [circleId, onOpenMarketplace]);
  const roomOptions = useMemo(() => {
    const opts: { id: string; label: string; color: string }[] = [];
    const seen = new Set<string>();
    for (const room of projectRooms) {
      if (seen.has(room.id)) continue;
      seen.add(room.id);
      opts.push({ id: room.id, label: room.name, color: room.color || '#22d3ee' });
    }
    const allTasks = Object.values(kanban.tasksByColumn).flat();
    for (const t of allTasks) {
      if (!t.room_id || seen.has(t.room_id) || !t.room?.name) continue;
      seen.add(t.room_id);
      opts.push({ id: t.room_id, label: t.room.name, color: t.room.color || '#22d3ee' });
    }
    return opts;
  }, [kanban.tasksByColumn, projectRooms]);

  const totalTasks = useMemo(() => Object.values(kanban.tasksByColumn).reduce((sum, arr) => sum + arr.length, 0), [kanban.tasksByColumn]);

  const automationStats = useMemo(() => {
    const activeCount = automations.filter(a => a.enabled).length;
    const runsThisWeek = (dashStats?.successfulLast7d || 0) + (dashStats?.failedLast7d || 0);
    return { activeCount, runsThisWeek };
  }, [automations, dashStats]);

  // Mission stats for OrchestraPanel
  const { missions: allMissions } = useMissions(circleId);
  const missionStats = useMemo(() => {
    const active = allMissions.filter(m => m.status === 'active');
    const overdueCount = active.filter(m => isOverdue(m)).length;
    return {
      active: active.length,
      overdue: overdueCount,
      avgProgress: 0, // computed async below isn't worth it here — we show count + overdue
    };
  }, [allMissions]);

  // Task health stats for OrchestraPanel
  const taskStats = useMemo(() => {
    const allTasks = Object.values(kanban.tasksByColumn).flat();
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let overdue = 0;
    let dueToday = 0;
    let inProgress = 0;
    let completedThisWeek = 0;
    const completed = kanban.tasksByColumn.done?.length || 0;

    for (const t of allTasks) {
      if (t.status === 'in_progress') inProgress++;
      if (t.status === 'done' && t.completed_at && new Date(t.completed_at).getTime() > weekAgo) {
        completedThisWeek++;
      }
      if (t.due_date && t.status !== 'done') {
        const due = new Date(t.due_date + 'T23:59:59');
        const diffMs = due.getTime() - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays < 0) overdue++;
        else if (diffDays === 0) dueToday++;
      }
    }

    return { total: allTasks.length, completed, inProgress, overdue, dueToday, completedThisWeek };
  }, [kanban.tasksByColumn]);

  // Needs-attention ranking (overdue/breached/stalled/blocked) composed from
  // the SLA + priority cores; renders under the Orchestra panel.
  const needsAttention = useMemo(() => {
    const allTasks = Object.values(kanban.tasksByColumn).flat();
    return buildNeedsAttention({ nowMs: Date.now(), tasks: allTasks, missions: allMissions });
  }, [kanban.tasksByColumn, allMissions]);

  const handleNeedsAttentionAction = useCallback((item: { taskId?: string }) => {
    if (!item.taskId) return;
    const t = Object.values(kanban.tasksByColumn).flat().find(x => x.id === item.taskId);
    if (t) setDetailTask(t);
  }, [kanban.tasksByColumn]);

  const goalFilteredTasksByColumn = useMemo(() => {
    if (!filteredGoalId) return kanban.tasksByColumn;
    const filtered = {} as TasksByColumn;
    for (const key of Object.keys(kanban.tasksByColumn) as TaskStatus[]) {
      filtered[key] = kanban.tasksByColumn[key].filter(t => (t as any).goal_id === filteredGoalId);
    }
    return filtered;
  }, [kanban.tasksByColumn, filteredGoalId]);

  const visibleTasksByColumn = useMemo(() => (
    filterTasksByBoardControls(goalFilteredTasksByColumn, {
      searchText: debouncedSearchText,
      filterPriority,
      filterAssignee,
      filterRoom,
    })
  ), [goalFilteredTasksByColumn, debouncedSearchText, filterPriority, filterAssignee, filterRoom]);


  // Batch move handler
  const handleBatchMove = useCallback(async (taskIds: string[], newStatus: TaskStatus) => {
    await Promise.all(taskIds.map(id => kanban.moveTask(id, newStatus)));
  }, [kanban.moveTask]);

  const handleBatchAssignRoom = useCallback(async (taskIds: string[], roomId: string | null) => {
    await Promise.all(taskIds.map(id => kanban.updateTask(id, { room_id: roomId } as any)));
  }, [kanban.updateTask]);

  // Archive done handler (deletes old completed tasks)
  const handleArchiveDone = useCallback(async (taskIds: string[]) => {
    await Promise.all(taskIds.map(id => kanban.deleteTask(id)));
  }, [kanban.deleteTask]);

  // Keyboard shortcuts (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === 'Escape') {
        if (detailTask) { setDetailTask(null); e.preventDefault(); return; }
        if (showCreate) { setShowCreate(false); e.preventDefault(); return; }
      }

      if (isInput) return;

      if (e.key === 'n' || e.key === 'N') {
        setCreateInColumn('todo');
        setShowCreate(true);
        e.preventDefault();
        return;
      }
      if (e.key === '/') {
        setSearchExpanded(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
        e.preventDefault();
        return;
      }
      // 1-7 switch mobile tabs to columns
      if (isMobile && e.key >= '1' && e.key <= '7') {
        const colIndex = parseInt(e.key) - 1;
        if (colIndex < COLUMNS.length) {
          setMobileTab('board');
          // The column switch happens through the board's activeColumn
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [detailTask, showCreate, isMobile]);

  if (kanban.loading) {
    return <FeedLoadingAnimation />;
  }

  // ─── Mobile Layout ─────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <View style={s.container}>
        <AgentTopBar agents={orchestraAgents} />
        {Platform.OS === 'web' && <CircleStoriesRail circleId={circleId} accentColor="#6366f1" />}
        <OrchestraPanel agents={orchestraAgents} automationStats={automationStats} taskStats={taskStats} missionStats={missionStats} />
        <NeedsAttentionPanel items={needsAttention} onAction={handleNeedsAttentionAction} />
        <TaskSearchBar
          searchText={searchText}
          onSearchChange={setSearchText}
          filterPriority={filterPriority}
          onFilterPriority={setFilterPriority}
          filterAssignee={filterAssignee}
          onFilterAssignee={setFilterAssignee}
          filterRoom={filterRoom}
          onFilterRoom={setFilterRoom}
          assigneeOptions={assigneeOptions}
          roomOptions={roomOptions}
          searchInputRef={searchInputRef}
          totalTasks={totalTasks}
        />

        <View style={s.mobileBody}>
          {mobileTab === 'missions' && (
            <View style={s.mobilePanel}>
              <MissionsTab circleId={circleId} accentColor={accentColor || '#6366f1'} />
            </View>
          )}
          {mobileTab === 'goals' && (
            <View style={s.mobilePanel}>
              <GoalsPanel
                goals={goalsHook.goals}
                agents={agents}
                filteredGoalId={filteredGoalId}
                onFilter={setFilteredGoalId}
                onCreateGoal={goalsHook.createGoal}
                onUpdateGoal={goalsHook.updateGoal}
                onDeleteGoal={goalsHook.deleteGoal}
                onCreateTask={kanban.createTask}
                onEditGoal={setEditGoal}
                plans={plansHook.plans}
                onOpenMarketplace={handleOpenMarketplace}
                circleId={circleId}
                onCreatePlan={plansHook.createPlan}
                onUpdatePlan={plansHook.updatePlan}
                onDeletePlan={plansHook.deletePlan}
                onGenerateTasks={plansHook.generateTasksFromPlan}
              />
            </View>
          )}
          {mobileTab === 'activity' && (
            <View style={s.mobilePanel}>
              <ActivityFeedPanel circleId={circleId} agents={agents} />
            </View>
          )}
          {mobileTab === 'agents' && (
            <View style={s.mobilePanel}>
              <ActiveRunsWidget circleId={circleId} />
              <AgentTasksPanel
                tasksByColumn={visibleTasksByColumn}
                agents={agents}
                onCardPress={setDetailTask}
                searchText={debouncedSearchText}
                filterPriority={filterPriority}
                filterAssignee={filterAssignee}
                filterRoom={filterRoom}
              />
            </View>
          )}
          {mobileTab === 'ai-tools' && (
            <View style={s.mobilePanel}>
              <HuggingSwanPanel circleId={circleId} />
            </View>
          )}
          {/* Plans integrated into GoalsPanel via sidebar tab */}
          {mobileTab === 'board' && (
            <>
              <KanbanViewToggle mode={kanbanViewMode} onChange={setKanbanViewMode} />
              {kanbanViewMode === 'calendar' ? (
                <TaskCalendar
                  tasks={Object.values(visibleTasksByColumn).flat()}
                  accentColor={accentColor || '#6366f1'}
                  isFiltered={hasActiveFilters}
                  onClearFilters={clearAllTaskFilters}
                  onSelectTask={(id) => {
                    const t = Object.values(visibleTasksByColumn).flat().find(x => x.id === id);
                    if (t) setDetailTask(t);
                  }}
                />
              ) : kanbanViewMode === 'table' ? (
                <TaskTable
                  tasks={Object.values(visibleTasksByColumn).flat()}
                  accentColor={accentColor || '#6366f1'}
                  isFiltered={hasActiveFilters}
                  onClearFilters={clearAllTaskFilters}
                  onSelectTask={(id) => {
                    const t = Object.values(visibleTasksByColumn).flat().find(x => x.id === id);
                    if (t) setDetailTask(t);
                  }}
                  onStatusChange={(taskId, nextStatus) => kanban.moveTask(taskId, nextStatus)}
                />
              ) : (
            <KanbanBoard
              columns={COLUMNS}
              tasksByColumn={visibleTasksByColumn}
              agents={agents}
              goals={goalsHook.goals}
              isFiltered={hasActiveFilters}
              onClearFilters={clearAllTaskFilters}
              onCardPress={setDetailTask}
              onMoveTask={kanban.moveTask}
              onQuickAdd={(status, title) => kanban.createTask({
                title,
                status,
                goal_id: filteredGoalId || undefined,
                room_id: filterRoom || undefined,
              })}
              onAddTask={(status) => { setCreateInColumn(status); setShowCreate(true); }}
              onBatchMove={handleBatchMove}
              onBatchAssignRoom={handleBatchAssignRoom}
              roomOptions={roomOptions}
              onArchiveDone={handleArchiveDone}
            />
              )}
            </>
          )}
        </View>

        {/* Mobile tab bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.mobileTabBar}
        >
          {([
            { key: 'missions' as MobileTab, label: 'Missions', icon: '\uD83C\uDFAF' },
            { key: 'goals' as MobileTab, label: 'Goals', icon: '\u2299' },
            { key: 'board' as MobileTab, label: 'Board', icon: '\u25A6' },
            { key: 'activity' as MobileTab, label: 'Activity', icon: '\u26A1' },
            { key: 'agents' as MobileTab, label: 'Agents', icon: '\u2699' },
            { key: 'ai-tools' as MobileTab, label: 'AI Tools', icon: '\uD83E\uDD17' },
          ]).map(tab => {
            const isActive = mobileTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setMobileTab(tab.key)}
                style={[s.mobileTabBtn, isActive && s.mobileTabBtnActive]}
              >
                <Text style={[s.mobileTabIcon, isActive && s.mobileTabIconActive]}>{tab.icon}</Text>
                <Text style={[s.mobileTabLabel, isActive && s.mobileTabLabelActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {detailTask && (
      <TaskDetailModal
        task={detailTask}
        kanban={kanban}
        agents={sortedAgentsForAssign}
        goals={goalsHook.goals}
        circleId={circleId}
        onOpenMarketplace={handleOpenMarketplace}
        onClose={() => setDetailTask(null)}
      />
        )}

        {editGoal && (
          <GoalDetailModal
            goal={editGoal}
            agents={agents}
            onClose={() => setEditGoal(null)}
            onUpdate={(goalId, fields) => { goalsHook.updateGoal(goalId, fields); setEditGoal(null); }}
            onDelete={(goalId) => { goalsHook.deleteGoal(goalId); setEditGoal(null); }}
            onCreateTask={kanban.createTask}
          />
        )}

        {showCreate && (
          <CreateTaskModal
            circleId={circleId}
            column={createInColumn}
            members={kanban.members}
            agents={sortedAgentsForAssign}
            goals={goalsHook.goals}
            missions={allMissions}
            initialGoalId={filteredGoalId}
            initialRoomId={filterRoom}
            prefillTitle={createPrefillTitle}
            onClose={() => { setShowCreate(false); setCreatePrefillTitle(''); }}
            onCreate={async (fields) => {
              await kanban.createTask(fields);
              setShowCreate(false);
              setCreatePrefillTitle('');
            }}
          />
        )}
      </View>
    );
  }

  // ─── Desktop Layout ────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <AgentTopBar agents={orchestraAgents} />
      {Platform.OS === 'web' && <CircleStoriesRail circleId={circleId} accentColor="#6366f1" />}
      <OrchestraPanel agents={orchestraAgents} automationStats={automationStats} taskStats={taskStats} missionStats={missionStats} />
      <NeedsAttentionPanel items={needsAttention} onAction={handleNeedsAttentionAction} />

      {/* Collapsible search bar — click to expand, / key also opens */}
      {searchExpanded ? (
        <TaskSearchBar
          searchText={searchText}
          onSearchChange={setSearchText}
          filterPriority={filterPriority}
          onFilterPriority={setFilterPriority}
          filterAssignee={filterAssignee}
          onFilterAssignee={setFilterAssignee}
          filterRoom={filterRoom}
          onFilterRoom={setFilterRoom}
          assigneeOptions={assigneeOptions}
          roomOptions={roomOptions}
          searchInputRef={searchInputRef}
          totalTasks={totalTasks}
        />
      ) : (
        <Pressable
          onPress={() => { setSearchExpanded(true); setTimeout(() => searchInputRef.current?.focus(), 100); }}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingVertical: 6,
            borderBottomWidth: 1, borderBottomColor: '#111',
          }}
        >
          <Text style={{ color: '#404050', fontSize: 12, fontFamily: 'monospace' }}>/</Text>
          <Text style={{ color: '#404050', fontSize: 12 }}>Search {totalTasks} tasks...</Text>
          {(searchText || filterPriority || filterAssignee || filterRoom) && (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#6366f1', marginLeft: 4 }} />
          )}
        </Pressable>
      )}

      <View style={s.body}>
        <GoalsPanel
          goals={goalsHook.goals}
          agents={agents}
          filteredGoalId={filteredGoalId}
          onFilter={setFilteredGoalId}
          onCreateGoal={goalsHook.createGoal}
          onUpdateGoal={goalsHook.updateGoal}
          onDeleteGoal={goalsHook.deleteGoal}
          onCreateTask={kanban.createTask}
          onEditGoal={setEditGoal}
          plans={plansHook.plans}
          circleId={circleId}
          onCreatePlan={plansHook.createPlan}
          onUpdatePlan={plansHook.updatePlan}
          onDeletePlan={plansHook.deletePlan}
          onGenerateTasks={plansHook.generateTasksFromPlan}
          onOpenMarketplace={handleOpenMarketplace}
        />

        {/* Center panel: Missions only (full height) */}
        <View style={ct.wrapper}>
          <MissionsTab circleId={circleId} accentColor={accentColor || '#6366f1'} />
        </View>

        <View style={{ flex: 1, flexDirection: 'column', minWidth: 0 }}>
          <KanbanViewToggle mode={kanbanViewMode} onChange={setKanbanViewMode} />
          {kanbanViewMode === 'calendar' ? (
            <TaskCalendar
              tasks={Object.values(visibleTasksByColumn).flat()}
              accentColor={accentColor || '#6366f1'}
              isFiltered={hasActiveFilters}
              onClearFilters={clearAllTaskFilters}
              onSelectTask={(id) => {
                const t = Object.values(visibleTasksByColumn).flat().find(x => x.id === id);
                if (t) setDetailTask(t);
              }}
            />
          ) : kanbanViewMode === 'table' ? (
            <TaskTable
              tasks={Object.values(visibleTasksByColumn).flat()}
              accentColor={accentColor || '#6366f1'}
              isFiltered={hasActiveFilters}
              onClearFilters={clearAllTaskFilters}
              onSelectTask={(id) => {
                const t = Object.values(visibleTasksByColumn).flat().find(x => x.id === id);
                if (t) setDetailTask(t);
              }}
              onStatusChange={(taskId, nextStatus) => kanban.moveTask(taskId, nextStatus)}
            />
          ) : (
            <KanbanBoard
              columns={COLUMNS}
              tasksByColumn={visibleTasksByColumn}
              agents={agents}
              goals={goalsHook.goals}
              isFiltered={hasActiveFilters}
              onClearFilters={clearAllTaskFilters}
              onCardPress={setDetailTask}
              onMoveTask={kanban.moveTask}
              onQuickAdd={(status, title) => kanban.createTask({
                title,
                status,
                goal_id: filteredGoalId || undefined,
                room_id: filterRoom || undefined,
              })}
              onAddTask={(status) => { setCreateInColumn(status); setShowCreate(true); }}
              onBatchMove={handleBatchMove}
              onBatchAssignRoom={handleBatchAssignRoom}
              roomOptions={roomOptions}
              onArchiveDone={handleArchiveDone}
            />
          )}
        </View>
      </View>

      {/* Collapsible Activity strip at bottom */}
      <View style={{ borderTopWidth: 1, borderTopColor: '#151515', backgroundColor: '#0a0a0a' }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingVertical: 8,
          }}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {([
              { key: 'activity' as DesktopLowerTab, label: 'ACTIVITY' },
              { key: 'agents' as DesktopLowerTab, label: 'AGENT TASKS' },
              { key: 'ai-tools' as DesktopLowerTab, label: 'AI TOOLS' },
            ]).map(tab => {
              const active = desktopLowerTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => {
                    setDesktopLowerTab(tab.key);
                    if (!activityExpanded) setActivityExpanded(true);
                  }}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: active ? '#6366f155' : '#1f1f28',
                    backgroundColor: active ? '#6366f118' : '#0f0f15',
                  }}
                >
                  <Text style={{ color: active ? '#c7d2fe' : '#606070', fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={{ color: '#404050', fontSize: 11, flex: 1, textAlign: 'right' }}>
            {activityExpanded
              ? desktopLowerTab === 'activity'
                ? 'Hide feed'
                : desktopLowerTab === 'agents'
                  ? 'Hide agent task stream'
                  : 'Hide AI tool feed'
              : desktopLowerTab === 'activity'
                ? 'Show recent agent activity'
                : desktopLowerTab === 'agents'
                  ? 'Show agent task stream'
                  : 'Show AI tool feed'}
          </Text>
          <Pressable
            onPress={() => setActivityExpanded(!activityExpanded)}
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
          >
            <Text style={{ color: '#606070', fontSize: 14, fontFamily: 'monospace' }}>
              {activityExpanded ? '−' : '+'}
            </Text>
          </Pressable>
        </View>
        {activityExpanded && (
          <View style={{ height: 240, borderTopWidth: 1, borderTopColor: '#151515' }}>
            {desktopLowerTab === 'activity' ? (
              <ActivityFeedPanel circleId={circleId} agents={agents} />
            ) : desktopLowerTab === 'agents' ? (
              <View style={{ flex: 1, paddingTop: 10 }}>
                <ActiveRunsWidget circleId={circleId} />
                <AgentTasksPanel
                  tasksByColumn={visibleTasksByColumn}
                  agents={agents}
                  onCardPress={setDetailTask}
                  searchText={debouncedSearchText}
                  filterPriority={filterPriority}
                  filterAssignee={filterAssignee}
                  filterRoom={filterRoom}
                />
              </View>
            ) : (
              <View style={{ flex: 1, paddingTop: 10 }}>
                <HuggingSwanPanel circleId={circleId} />
              </View>
            )}
          </View>
        )}
      </View>

      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          kanban={kanban}
          agents={sortedAgentsForAssign}
          goals={goalsHook.goals}
          circleId={circleId}
          onOpenMarketplace={handleOpenMarketplace}
          onClose={() => setDetailTask(null)}
        />
      )}

      {editGoal && (
        <GoalDetailModal
          goal={editGoal}
          agents={agents}
          onClose={() => setEditGoal(null)}
          onUpdate={(goalId, fields) => { goalsHook.updateGoal(goalId, fields); setEditGoal(null); }}
          onDelete={(goalId) => { goalsHook.deleteGoal(goalId); setEditGoal(null); }}
          onCreateTask={kanban.createTask}
        />
      )}

      {/* Member-card modal — driven by the @user deeplink consumer above. */}
      <MemberCardModal
        userId={memberCardUserId}
        onClose={() => setMemberCardUserId(null)}
      />

      {showCreate && (
        <CreateTaskModal
          circleId={circleId}
          column={createInColumn}
          members={kanban.members}
          agents={agents}
          goals={goalsHook.goals}
          missions={allMissions}
          initialGoalId={filteredGoalId}
          initialRoomId={filterRoom}
          prefillTitle={createPrefillTitle}
          onClose={() => { setShowCreate(false); setCreatePrefillTitle(''); }}
          onCreate={async (fields) => {
            await kanban.createTask(fields);
            setShowCreate(false);
            setCreatePrefillTitle('');
          }}
        />
      )}
    </View>
  );
}

// ─── Create Task Modal ──────────────────────────────────────────────────────

interface CreateModalProps {
  circleId: string;
  column: TaskStatus;
  members: KanbanMember[];
  agents: CircleOfficeAgent[];
  goals: GoalWithCount[];
  missions?: Mission[];
  initialGoalId?: string | null;
  initialRoomId?: string | null;
  prefillTitle?: string;
  onClose: () => void;
  onCreate: (fields: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    assigned_to?: string | null;
    assigned_agent_id?: string | null;
    assigned_agent_ids?: string[];
    inherit_room_agents?: boolean;
    completion_policy?: TaskCompletionPolicy;
    due_date?: string | null;
    goal_id?: string | null;
    room_id?: string | null;
    mission_id?: string | null;
  }) => void;
}

function CreateTaskModal({
  circleId,
  column,
  members,
  agents,
  goals,
  missions,
  initialGoalId,
  initialRoomId,
  prefillTitle,
  onClose,
  onCreate,
}: CreateModalProps) {
  const { rooms } = useProjectRooms(circleId);
  const hasInitialRoom = !!initialRoomId;
  const [title, setTitle] = useState(prefillTitle?.trim() || '');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<'manual' | 'room_team'>(hasInitialRoom ? 'room_team' : 'manual');
  const [completionPolicy, setCompletionPolicy] = useState<TaskCompletionPolicy>('single_owner');
  const [dueDate, setDueDate] = useState('');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(initialGoalId || null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId || null);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const columnDef = COLUMNS.find(c => c.key === column) || COLUMNS[1];
  const sortedAgentsForAssign = useMemo(() => [...agents].sort(compareAgentsForAssignment), [agents]);
  const initialGoal = useMemo(() => goals.find(goal => goal.id === initialGoalId) || null, [goals, initialGoalId]);
  const initialRoom = useMemo(() => rooms.find(room => room.id === initialRoomId) || null, [rooms, initialRoomId]);

  useEffect(() => {
    setSelectedGoalId(initialGoalId || null);
  }, [initialGoalId]);

  useEffect(() => {
    setSelectedRoomId(initialRoomId || null);
  }, [initialRoomId]);

  useEffect(() => {
    if (assignmentMode === 'room_team') {
      setCompletionPolicy(prev => prev === 'single_owner' ? 'any_assigned' : prev);
      return;
    }
    setCompletionPolicy(assignedAgentIds.length > 1 ? 'any_assigned' : 'single_owner');
  }, [assignedAgentIds, assignmentMode]);

  useEffect(() => {
    if (!selectedRoomId && assignmentMode === 'room_team') {
      setAssignmentMode('manual');
    }
  }, [selectedRoomId, assignmentMode]);

  useEffect(() => {
    if (assignmentMode !== 'room_team') return;
    setAssignedTo(null);
    setAssignedAgentIds([]);
  }, [assignmentMode]);

  const handleCreate = () => {
    if (!title.trim()) { setError('Give the task a title'); return; }
    const useRoomTeam = assignmentMode === 'room_team' && !!selectedRoomId;
    onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status: column,
      assigned_to: useRoomTeam ? null : assignedTo,
      assigned_agent_id: useRoomTeam ? undefined : assignedAgentIds[0] || null,
      assigned_agent_ids: useRoomTeam ? undefined : assignedAgentIds,
      inherit_room_agents: useRoomTeam,
      completion_policy: completionPolicy,
      due_date: dueDate || null,
      goal_id: selectedGoalId,
      room_id: selectedRoomId,
      mission_id: selectedMissionId,
    });
  };

  const activeMissions = (missions || []).filter(m => m.status === 'active');

  return (
    <View style={m.overlay}>
      <Pressable style={m.backdrop} onPress={onClose} />
      <View style={m.modal}>
        <ScrollView contentContainerStyle={m.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={m.headerRow}>
            <Text style={m.headerTitle}>New task</Text>
            <View style={[m.columnBadge, { backgroundColor: columnDef.color + '12' }]}>
              <View style={[m.columnDot, { backgroundColor: columnDef.color }]} />
              <Text style={[m.columnBadgeText, { color: columnDef.color }]}>{columnDef.label}</Text>
            </View>
          </View>

          {error ? (
            <View style={m.errorBox}>
              <Text style={m.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Title */}
          <TextInput
            style={m.titleInput}
            placeholder="Task title"
            placeholderTextColor="#444444"
            value={title}
            onChangeText={(t) => { setTitle(t); setError(''); }}
            maxLength={200}
            autoFocus
          />

          {/* Description */}
          <TextInput
            style={[m.input, m.textArea]}
            placeholder="Add details..."
            placeholderTextColor="#333333"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={500}
          />

          {(initialRoom || initialGoal) && (
            <View style={m.contextBox}>
              <Text style={m.contextLabel}>Starting from current board context</Text>
              <View style={m.contextChipRow}>
                {initialRoom && (
                  <View style={[m.contextChip, { borderColor: (initialRoom.color || '#22d3ee') + '35' }]}>
                    <View style={[m.contextChipDot, { backgroundColor: initialRoom.color || '#22d3ee' }]} />
                    <Text style={m.contextChipText}>Room: {initialRoom.name}</Text>
                  </View>
                )}
                {initialGoal && (
                  <View style={[m.contextChip, { borderColor: '#22c55e35' }]}>
                    <View style={[m.contextChipDot, { backgroundColor: '#22c55e' }]} />
                    <Text style={m.contextChipText}>Goal: {initialGoal.name}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {rooms.length > 0 && (
            <>
              <Text style={m.sectionLabel}>Project Room</Text>
              <View style={m.chipRow}>
                <Pressable
                  onPress={() => setSelectedRoomId(null)}
                  style={[m.chip, !selectedRoomId && m.chipActive]}
                >
                  <Text style={[m.chipText, !selectedRoomId && { color: '#e8e8e8' }]}>None</Text>
                </Pressable>
                {rooms.map(room => {
                  const active = selectedRoomId === room.id;
                  const color = room.color || '#22d3ee';
                  return (
                    <Pressable
                      key={room.id}
                      onPress={() => setSelectedRoomId(active ? null : room.id)}
                      style={[m.chip, active && { backgroundColor: color + '15', borderColor: color + '30' }]}
                    >
                      <View style={[m.chipDot, { backgroundColor: color }]} />
                      <Text style={[m.chipText, active && { color }]} numberOfLines={1}>{room.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Goal selector */}
          {goals.length > 0 && (
            <>
              <Text style={m.sectionLabel}>Goal</Text>
              <View style={m.chipRow}>
                <Pressable
                  onPress={() => setSelectedGoalId(null)}
                  style={[m.chip, !selectedGoalId && m.chipActive]}
                >
                  <Text style={[m.chipText, !selectedGoalId && { color: '#e8e8e8' }]}>None</Text>
                </Pressable>
                {goals.map(g => {
                  const active = selectedGoalId === g.id;
                  const gColor = g.status === 'active' ? '#22c55e' : g.status === 'paused' ? '#f59e0b' : '#666666';
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => setSelectedGoalId(active ? null : g.id)}
                      style={[m.chip, active && { backgroundColor: gColor + '15', borderColor: gColor + '30' }]}
                    >
                      <View style={[m.chipDot, { backgroundColor: gColor }]} />
                      <Text style={[m.chipText, active && { color: gColor }]} numberOfLines={1}>{g.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Mission link */}
          {activeMissions.length > 0 && (
            <>
              <Text style={m.sectionLabel}>Link to Mission</Text>
              <View style={m.chipRow}>
                <Pressable
                  onPress={() => setSelectedMissionId(null)}
                  style={[m.chip, !selectedMissionId && m.chipActive]}
                >
                  <Text style={[m.chipText, !selectedMissionId && { color: '#e8e8e8' }]}>None</Text>
                </Pressable>
                {activeMissions.map(mi => {
                  const active = selectedMissionId === mi.id;
                  return (
                    <Pressable
                      key={mi.id}
                      onPress={() => setSelectedMissionId(active ? null : mi.id)}
                      style={[m.chip, active && { backgroundColor: '#6366f115', borderColor: '#6366f130' }]}
                    >
                      <View style={[m.chipDot, { backgroundColor: '#6366f1' }]} />
                      <Text style={[m.chipText, active && { color: '#6366f1' }]} numberOfLines={1}>{mi.title}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Priority */}
          <Text style={m.sectionLabel}>Priority</Text>
          <View style={m.chipRow}>
            {(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map(p => {
              const active = priority === p;
              const color = PRIORITY_COLORS[p];
              return (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  style={[m.chip, active && { backgroundColor: color + '15', borderColor: color + '30' }]}
                >
                  {active && <View style={[m.chipDot, { backgroundColor: color }]} />}
                  <Text style={[m.chipText, active && { color }]}>{PRIORITY_LABELS[p]}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Assign */}
          <Text style={m.sectionLabel}>Assignment source</Text>
          <View style={m.chipRow}>
            <Pressable
              onPress={() => setAssignmentMode('manual')}
              style={[m.chip, assignmentMode === 'manual' && m.chipActive]}
            >
              <Text style={[m.chipText, assignmentMode === 'manual' && { color: '#e8e8e8' }]}>Custom assignees</Text>
            </Pressable>
            <Pressable
              onPress={() => selectedRoomId && setAssignmentMode('room_team')}
              style={[m.chip, assignmentMode === 'room_team' && m.chipActive, !selectedRoomId && { opacity: 0.4 }]}
              disabled={!selectedRoomId}
            >
              <Text style={[m.chipText, assignmentMode === 'room_team' && { color: '#e8e8e8' }]}>Use room team</Text>
            </Pressable>
          </View>

          <Text style={m.sectionLabel}>Assign to</Text>
          {assignmentMode === 'room_team' ? (
            <View style={m.noteBox}>
              <Text style={m.noteText}>
                This task will inherit the active agents assigned to the selected project room when it is created.
              </Text>
            </View>
          ) : (
            <View style={m.chipRow}>
              <Pressable
                onPress={() => { setAssignedTo(null); setAssignedAgentIds([]); }}
                style={[m.chip, !assignedTo && assignedAgentIds.length === 0 && m.chipActive]}
              >
                <Text style={[m.chipText, !assignedTo && assignedAgentIds.length === 0 && { color: '#e8e8e8' }]}>Nobody</Text>
              </Pressable>
              {members.map(mem => (
                <Pressable
                  key={mem.id}
                  onPress={() => { setAssignedTo(mem.id); setAssignedAgentIds([]); }}
                  style={[m.chip, assignedTo === mem.id && m.chipActive]}
                >
                  <Text style={[m.chipText, assignedTo === mem.id && { color: '#e8e8e8' }]}>
                    {mem.display_name || mem.username}
                  </Text>
                </Pressable>
              ))}
              {sortedAgentsForAssign.map(a => {
                const active = assignedAgentIds.includes(a.id);
                const isOnline = a.status === 'active' || a.status === 'building' || a.status === 'idle';
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => {
                      setAssignedTo(null);
                      setAssignedAgentIds(prev => prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id]);
                    }}
                    style={[m.chip, active && { backgroundColor: (a.color || '#e8e8e8') + '15', borderColor: (a.color || '#e8e8e8') + '30' }, !isOnline && { opacity: 0.35 }]}
                  >
                    <View style={[m.chipDot, { backgroundColor: isOnline ? (a.color || '#e8e8e8') : '#555' }]} />
                    <Text style={[m.chipText, active && { color: a.color || '#e8e8e8' }]}>{active ? '✓ ' : ''}{a.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Text style={m.sectionLabel}>Completion policy</Text>
          <View style={m.chipRow}>
            {[
              { key: 'single_owner' as TaskCompletionPolicy, label: 'Owner finishes', hint: 'One primary assignee is responsible for completion.' },
              { key: 'any_assigned' as TaskCompletionPolicy, label: 'Any assigned can finish', hint: 'Collaborators can help, but one successful agent can complete it.' },
              { key: 'all_assigned' as TaskCompletionPolicy, label: 'All assigned must finish', hint: 'Use for strict review or multi-signoff workflows.' },
            ].map(option => {
              const active = completionPolicy === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setCompletionPolicy(option.key)}
                  style={[m.policyChip, active && m.policyChipActive]}
                >
                  <Text style={[m.policyChipTitle, active && m.policyChipTitleActive]}>{option.label}</Text>
                  <Text style={[m.policyChipHint, active && m.policyChipHintActive]}>{option.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Due date */}
          <Text style={m.sectionLabel}>Due date</Text>
          <TextInput
            style={m.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#333333"
            value={dueDate}
            onChangeText={setDueDate}
            maxLength={10}
          />

          {/* Actions */}
          <View style={m.btnRow}>
            <Pressable onPress={handleCreate} style={m.createBtn}>
              <Text style={m.createBtnText}>Create task</Text>
            </Pressable>
            <Pressable onPress={onClose} style={m.cancelBtn}>
              <Text style={m.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#080808' },
  loadingDots: { flexDirection: 'row', gap: 10, alignItems: 'center', height: 40 },
  loadingDot: { width: 10, height: 10, borderRadius: 5 },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  // Mobile
  mobileBody: {
    flex: 1,
  },
  mobilePanel: {
    flex: 1,
  },
  mobileTabBar: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#151515',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 8,
  },
  mobileTabBtn: {
    alignItems: 'center',
    gap: 3,
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mobileTabBtnActive: {
    backgroundColor: '#151515',
  },
  mobileTabIcon: {
    fontSize: 16,
    color: '#444444',
  },
  mobileTabIconActive: {
    color: '#6366f1',
  },
  mobileTabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#444444',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mobileTabLabelActive: {
    color: '#c0c0c0',
  },
});

// ─── Center Tab Switcher (Desktop: Activity ↔ Agent Tasks) ──────────────────

const ct = StyleSheet.create({
  wrapper: {
    width: 380,
    backgroundColor: '#0a0a0a',
    borderRightWidth: 1,
    borderRightColor: '#151515',
    borderLeftWidth: 1,
    borderLeftColor: '#151515',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
  },
  tabText: {
    color: '#505050',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: '#d0d0d0',
  },
});

// ─── Agent Tasks Panel Styles ───────────────────────────────────────────────

const at = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#151515',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIcon: {
    fontSize: 13,
  },
  headerTitle: {
    color: '#909090',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  countBadge: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '700',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffff08',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  liveText: {
    color: '#22c55e',
    fontSize: 9,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 8,
    gap: 6,
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  cardActive: {
    borderColor: '#ffffff15',
    backgroundColor: '#0d0d0d',
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusProcessing: {
    backgroundColor: '#f59e0b',
  },
  statusDone: {
    backgroundColor: '#22c55e',
  },
  statusFailed: {
    backgroundColor: '#ef4444',
  },
  agentName: {
    fontSize: 11,
    fontWeight: '700',
  },
  timeText: {
    color: '#444444',
    fontSize: 9,
    fontWeight: '600',
  },
  promptText: {
    color: '#909090',
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  metricText: {
    color: '#555555',
    fontSize: 9,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  processingText: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '600',
    fontStyle: 'italic',
    marginTop: 2,
  },
  responseToggle: {
    marginTop: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  responseToggleText: {
    color: '#6366f1',
    fontSize: 10,
    fontWeight: '600',
  },
  responseBox: {
    marginTop: 6,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#151515',
  },
  responseText: {
    color: '#6f6f6f',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: 'monospace',
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
    color: '#333333',
    fontSize: 12,
    fontWeight: '500',
  },
  emptySubtext: {
    color: '#333333',
    fontSize: 11,
    textAlign: 'center',
  },
  // Spirit + filter styles
  spiritBadge: {
    color: '#4b5563',
    fontSize: 8,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    backgroundColor: '#1a1a1a',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 4,
    textTransform: 'capitalize' as any,
    overflow: 'hidden' as any,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
  },
  filterChipActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  filterChipText: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginBottom: 4,
  },
  toolChip: {
    backgroundColor: '#6366f110',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#6366f130',
  },
  toolChipText: {
    color: '#a5b4fc',
    fontSize: 8,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    letterSpacing: 0.3,
  },
});

const fb = StyleSheet.create({
  filterBar: {
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#151515',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    paddingHorizontal: 8,
  },
  searchIcon: {
    color: '#444444',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    color: '#c0c0c0',
    fontSize: 12,
    paddingVertical: 7,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  clearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#1e1e1e',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  clearBtnText: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '600',
  },
  filterChips: {
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 2,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    backgroundColor: '#0c0c0c',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  filterChipActive: {
    backgroundColor: '#1a1a1a',
    borderColor: '#3a3a3a',
  },
  filterChipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  filterChipText: {
    color: '#555555',
    fontSize: 10,
    fontWeight: '600',
  },
  taskCount: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#111111',
    marginLeft: 4,
  },
  taskCountText: {
    color: '#555555',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});

const m = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(4px)' } as any : {}),
  },
  modal: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    width: '92%',
    maxWidth: 480,
    maxHeight: '85%',
    zIndex: 101,
    ...(Platform.OS === 'web' ? { boxShadow: '0 20px 60px rgba(0,0,0,0.5)' } as any : {}),
  },
  scrollContent: {
    padding: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    color: '#e8e8e8',
    fontSize: 18,
    fontWeight: '600',
  },
  columnBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  columnDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  columnBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: '#ef444415',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center',
  },
  titleInput: {
    color: '#e8e8e8',
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#0c0c0c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  input: {
    color: '#c0c0c0',
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#0c0c0c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  contextBox: {
    backgroundColor: '#0c0c0c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  contextLabel: {
    color: '#6f6f6f',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contextChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#121212',
  },
  contextChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  contextChipText: {
    color: '#b8b8b8',
    fontSize: 11,
    fontWeight: '600',
  },
  sectionLabel: {
    color: '#6f6f6f',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    backgroundColor: '#0c0c0c',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  chipActive: {
    borderColor: '#3a3a3a',
    backgroundColor: '#1a1a1a',
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    color: '#555555',
    fontSize: 12,
    fontWeight: '600',
  },
  noteBox: {
    backgroundColor: '#0c0c0c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 12,
    marginBottom: 10,
  },
  noteText: {
    color: '#9a9a9a',
    fontSize: 12,
    lineHeight: 18,
  },
  policyChip: {
    minWidth: 140,
    maxWidth: 220,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    backgroundColor: '#0c0c0c',
    gap: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  policyChipActive: {
    borderColor: '#3a3a3a',
    backgroundColor: '#161616',
  },
  policyChipTitle: {
    color: '#b8b8b8',
    fontSize: 12,
    fontWeight: '700',
  },
  policyChipTitleActive: {
    color: '#e8e8e8',
  },
  policyChipHint: {
    color: '#666666',
    fontSize: 11,
    lineHeight: 15,
  },
  policyChipHintActive: {
    color: '#9a9a9a',
  },
  btnRow: {
    gap: 8,
    marginTop: 16,
  },
  createBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  createBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cancelBtnText: {
    color: '#555555',
    fontSize: 13,
    fontWeight: '500',
  },
});

// ─── Kanban/Calendar view toggle ───────────────────────────────────────────
// Small pill-row that sits above both KanbanBoard render sites (mobile +
// desktop). Keeps the chrome minimal so it doesn't compete with the
// KanbanBoard's own filter bar.
function KanbanViewToggle({
  mode,
  onChange,
}: {
  mode: 'board' | 'calendar' | 'table';
  onChange: (m: 'board' | 'calendar' | 'table') => void;
}) {
  const LABELS: Record<'board' | 'calendar' | 'table', string> = {
    board: 'Board',
    calendar: 'Calendar',
    table: 'Table',
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#151515',
        backgroundColor: '#000',
      }}
      nativeID="section-kanban-view-toggle"
    >
      {(['board', 'calendar', 'table'] as const).map((m) => {
        const active = mode === m;
        return (
          <Pressable
            key={m}
            onPress={() => onChange(m)}
            style={({ hovered, pressed }: any) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderWidth: 1,
              borderColor: active ? '#4f46e5' : '#273244',
              backgroundColor: active ? '#312e81' : hovered ? '#121a26' : '#0c131d',
              borderRadius: 12,
              opacity: pressed ? 0.92 : 1,
              ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
            })}
          >
            <Text
              style={{
                color: active ? '#eef2ff' : '#94a3b8',
                fontSize: 11,
                fontWeight: '700',
              }}
            >
              {LABELS[m]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
