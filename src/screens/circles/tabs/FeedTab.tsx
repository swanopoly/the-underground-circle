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
import { useKanbanData, type KanbanMember } from '../../../hooks/useKanbanData';
import { useGoals } from '../../../hooks/useGoals';
import { usePlans } from '../../../hooks/usePlans';
import {
  KanbanTask, TaskStatus, TaskPriority, TasksByColumn,
  COLUMNS, PRIORITY_COLORS, PRIORITY_LABELS,
} from '../../../types/kanban';
import type { GoalWithCount } from '../../../hooks/useGoals';
import type { CircleOfficeAgent, AgentStatus } from '../../../lib/circleOffice';
import { PROVIDER_DISPLAY, subscribeToCircleOffice } from '../../../lib/circleOffice';
import {
  subscribeAutoConnect,
  getAutoConnectConnections,
  getAutoConnectSessions,
  setAutoConnectCircleId,
} from '../../../lib/agentAutoConnect';
import type { OfficeAgent } from '../../../lib/officeAgents';
import { sessionsToAgents } from '../../../lib/officeAgents';
import type { OpenClawSession } from '../../../lib/openclawService';
import { loadAgentIdentities, type AgentIdentity } from '../../../lib/agentIdentity';
import { storage } from '../../../lib/storage';
import { useCircleAutomations, useDashboardStats } from '../../../services/automationService';

import { supabase } from '../../../lib/supabase';
import AgentTopBar from './kanban/AgentTopBar';
import OrchestraPanel from './kanban/OrchestraPanel';
import GoalsPanel from './kanban/GoalsPanel';
import ActivityFeedPanel from './kanban/ActivityFeedPanel';
import KanbanBoard from './kanban/KanbanBoard';
import TaskDetailModal from './kanban/TaskDetailModal';
import GoalDetailModal from './kanban/GoalDetailModal';

// ─── Water Flow Loading Animation ─────────────────────────────────────────

const WAVE_COLORS = ['#6366f1', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#22d3ee'];
let _loadingStyleInjected = false;

function FeedLoadingAnimation() {
  useEffect(() => {
    if (Platform.OS !== 'web' || _loadingStyleInjected) return;
    _loadingStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes uc-wave {
        0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
        30% { transform: translateY(-18px) scale(1.3); opacity: 1; }
        60% { transform: translateY(4px) scale(0.9); opacity: 0.7; }
      }
      .uc-wave-dot {
        width: 10px; height: 10px; border-radius: 50%;
        animation: uc-wave 1.4s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
  }, []);

  if (Platform.OS === 'web') {
    return (
      <View style={s.loadingContainer}>
        <View style={s.loadingDots}>
          {WAVE_COLORS.map((color, i) => (
            <div
              key={i}
              className="uc-wave-dot"
              style={{
                backgroundColor: color,
                animationDelay: `${i * 0.12}s`,
                boxShadow: `0 0 12px ${color}60`,
              }}
            />
          ))}
        </View>
      </View>
    );
  }

  // Native fallback — static dots
  return (
    <View style={s.loadingContainer}>
      <View style={s.loadingDots}>
        {WAVE_COLORS.map((color, i) => (
          <View key={i} style={[s.loadingDot, { backgroundColor: color }]} />
        ))}
      </View>
    </View>
  );
}

// ─── Task Search Bar (rendered in FeedTab, right under OrchestraPanel) ────

function TaskSearchBar({
  searchText,
  onSearchChange,
  filterPriority,
  onFilterPriority,
  filterAssignee,
  onFilterAssignee,
  assigneeOptions,
  searchInputRef,
  totalTasks,
}: {
  searchText: string;
  onSearchChange: (text: string) => void;
  filterPriority: TaskPriority | null;
  onFilterPriority: (p: TaskPriority | null) => void;
  filterAssignee: string | null;
  onFilterAssignee: (a: string | null) => void;
  assigneeOptions: { id: string; label: string; color: string }[];
  searchInputRef?: React.RefObject<TextInput | null>;
  totalTasks: number;
}) {
  const hasFilters = searchText || filterPriority || filterAssignee;
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
          <Pressable onPress={() => { onSearchChange(''); onFilterPriority(null); onFilterAssignee(null); }} style={fb.clearBtn}>
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

function AgentTasksPanel({
  tasksByColumn,
  agents,
  onCardPress,
}: {
  tasksByColumn: TasksByColumn;
  agents: CircleOfficeAgent[];
  onCardPress: (task: KanbanTask) => void;
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

  const filteredTasks = filterAgent
    ? agentTasks.filter(t => parseAgentTaskMeta(t).agentName === filterAgent)
    : agentTasks;

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

type MobileTab = 'goals' | 'activity' | 'agents' | 'board' | 'ai-tools';
type CenterTab = 'activity' | 'agents' | 'ai-tools';

export default function FeedTab({ circleId }: { circleId: string }) {
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
  const [mobileTab, setMobileTab] = useState<MobileTab>('board');
  const [centerTab, setCenterTab] = useState<CenterTab>('activity');
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const searchInputRef = useRef<TextInput>(null);

  // ─── Live agent subscription (auto-connect + DB realtime) ────
  const [liveAgentTick, setLiveAgentTick] = useState(0);
  const [agentIdentities, setAgentIdentities] = useState<Map<string, AgentIdentity>>(new Map());
  const [legacyNames, setLegacyNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setAutoConnectCircleId(circleId);
    const unsubAuto = subscribeAutoConnect(() => setLiveAgentTick(t => t + 1));
    const unsubDb = subscribeToCircleOffice(circleId, () => {
      kanban.refresh();
      setLiveAgentTick(t => t + 1);
    });
    // Load persistent agent identities (custom names, etc.)
    loadAgentIdentities().then(setAgentIdentities).catch(() => {});
    storage.getItem('@office_agent_names').then(raw => {
      if (raw) setLegacyNames(JSON.parse(raw));
    }).catch(() => {});
    return () => { unsubAuto(); unsubDb(); };
  }, [circleId]);

  // Merge DB agents with live connected agents from auto-connect service
  const agents = useMemo(() => {
    const dbAgents = kanban.agents;
    const connections = getAutoConnectConnections();
    const sessionsMap = getAutoConnectSessions();

    // Convert live sessions → OfficeAgent[] (same pattern as OfficeTab)
    const liveOfficeAgents: OfficeAgent[] = [];
    for (const [connId, sessions] of sessionsMap) {
      if (connId === 'claude-code-auto') {
        // Claude Code sessions are already OfficeAgent[]
        const ccAgents = sessions as unknown as OfficeAgent[];
        if (ccAgents?.length) liveOfficeAgents.push(...ccAgents);
      } else {
        // OpenClaw sessions need conversion via sessionsToAgents()
        const conn = connections.find(c => c.id === connId);
        if (conn && sessions?.length) {
          const converted = sessionsToAgents(
            sessions as OpenClawSession[],
            connId,
            conn.name,
            conn.provider as any,
          );
          liveOfficeAgents.push(...converted);
        }
      }
    }

    // Apply persistent identity (custom names) — same as OfficeTab's restoreAllAgents
    const resolvedAgents = liveOfficeAgents.map(oa => {
      const sessionKey = oa.id.includes('::') ? oa.id.split('::')[1] : oa.id;
      const identity = agentIdentities.get(sessionKey);
      const legacyName = legacyNames[oa.id];
      return {
        ...oa,
        name: identity?.customName || legacyName || oa.name,
        color: identity?.customColor || oa.color,
      };
    });

    // Map OfficeAgent → CircleOfficeAgent shape for the UI
    const liveAsCircle: CircleOfficeAgent[] = resolvedAgents.map(oa => {
      const providerInfo = PROVIDER_DISPLAY[oa.providerType] || PROVIDER_DISPLAY['generic-agent'];
      return {
        id: oa.id,
        circleId,
        ownerId: '',
        ownerDisplayName: '',
        ownerUsername: '',
        provider: oa.providerType || 'generic-agent',
        name: oa.name,
        color: oa.color || providerInfo?.color || '#e8e8e8',
        toolIcon: providerInfo?.icon || '🤖',
        status: (oa.status || 'idle') as AgentStatus,
        currentTask: undefined,
        isPublished: true,
        createdAt: '',
        updatedAt: '',
      };
    });

    // Merge: update DB agents with live status, add new live agents
    const merged = dbAgents.map(a => {
      const live = liveAsCircle.find(l =>
        l.name.toLowerCase() === a.name.toLowerCase() || l.id === a.id,
      );
      return live ? { ...a, status: live.status } as CircleOfficeAgent : a;
    });
    const existingNames = new Set(merged.map(a => a.name.toLowerCase()));
    for (const live of liveAsCircle) {
      if (!existingNames.has(live.name.toLowerCase())) {
        existingNames.add(live.name.toLowerCase());
        merged.push(live);
      }
    }

    return merged;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kanban.agents, liveAgentTick, circleId, agentIdentities, legacyNames]);

  // ─── Search & filter state (lifted from KanbanBoard) ────
  const [searchText, setSearchText] = useState('');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | null>(null);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);

  // Collect unique assignees for filter chips
  const assigneeOptions = useMemo(() => {
    const opts: { id: string; label: string; color: string }[] = [];
    const seen = new Set<string>();
    const allTasks = Object.values(kanban.tasksByColumn).flat();
    for (const t of allTasks) {
      if (t.assigned_agent_id && !seen.has('agent:' + t.assigned_agent_id)) {
        seen.add('agent:' + t.assigned_agent_id);
        const agent = agents.find(a => a.id === t.assigned_agent_id);
        opts.push({ id: 'agent:' + t.assigned_agent_id, label: agent?.name || 'Agent', color: agent?.color || '#e8e8e8' });
      }
      if (t.assigned_to && !seen.has(t.assigned_to)) {
        seen.add(t.assigned_to);
        opts.push({ id: t.assigned_to, label: (t as any).assignee?.display_name || (t as any).assignee?.username || 'User', color: '#e8e8e8' });
      }
    }
    return opts;
  }, [kanban.tasksByColumn, agents]);

  const totalTasks = useMemo(() => Object.values(kanban.tasksByColumn).reduce((sum, arr) => sum + arr.length, 0), [kanban.tasksByColumn]);

  const automationStats = useMemo(() => {
    const activeCount = automations.filter(a => a.enabled).length;
    const runsThisWeek = (dashStats?.successfulLast7d || 0) + (dashStats?.failedLast7d || 0);
    return { activeCount, runsThisWeek };
  }, [automations, dashStats]);

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

  // Filter tasks by goal
  const filteredTasksByColumn = useMemo(() => {
    if (!filteredGoalId) return kanban.tasksByColumn;
    const filtered = {} as TasksByColumn;
    for (const key of Object.keys(kanban.tasksByColumn) as TaskStatus[]) {
      filtered[key] = kanban.tasksByColumn[key].filter(t => (t as any).goal_id === filteredGoalId);
    }
    return filtered;
  }, [kanban.tasksByColumn, filteredGoalId]);


  // Batch move handler
  const handleBatchMove = useCallback(async (taskIds: string[], newStatus: TaskStatus) => {
    await Promise.all(taskIds.map(id => kanban.moveTask(id, newStatus)));
  }, [kanban.moveTask]);

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
        searchInputRef.current?.focus();
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
        <AgentTopBar agents={agents} />
        <OrchestraPanel agents={agents} automationStats={automationStats} taskStats={taskStats} />
        <TaskSearchBar
          searchText={searchText}
          onSearchChange={setSearchText}
          filterPriority={filterPriority}
          onFilterPriority={setFilterPriority}
          filterAssignee={filterAssignee}
          onFilterAssignee={setFilterAssignee}
          assigneeOptions={assigneeOptions}
          searchInputRef={searchInputRef}
          totalTasks={totalTasks}
        />

        <View style={s.mobileBody}>
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
              <AgentTasksPanel
                tasksByColumn={filteredTasksByColumn}
                agents={agents}
                onCardPress={setDetailTask}
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
            <KanbanBoard
              columns={COLUMNS}
              tasksByColumn={filteredTasksByColumn}
              agents={agents}
              goals={goalsHook.goals}
              onCardPress={setDetailTask}
              onMoveTask={kanban.moveTask}
              onQuickAdd={(status, title) => kanban.createTask({ title, status })}
              onAddTask={(status) => { setCreateInColumn(status); setShowCreate(true); }}
              onBatchMove={handleBatchMove}
              onArchiveDone={handleArchiveDone}
              externalSearchText={searchText}
              externalFilterPriority={filterPriority}
              externalFilterAssignee={filterAssignee}
            />
          )}
        </View>

        {/* Mobile tab bar */}
        <View style={s.mobileTabBar}>
          {([
            { key: 'goals' as MobileTab, label: 'Goals', icon: '\u2299' },
            { key: 'activity' as MobileTab, label: 'Activity', icon: '\u26A1' },
            { key: 'agents' as MobileTab, label: 'Agents', icon: '\u2699' },
            { key: 'ai-tools' as MobileTab, label: 'AI Tools', icon: '\uD83E\uDD17' },
            { key: 'board' as MobileTab, label: 'Board', icon: '\u25A6' },
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
        </View>

        {detailTask && (
          <TaskDetailModal
            task={detailTask}
            kanban={kanban}
            goals={goalsHook.goals}
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
            column={createInColumn}
            members={kanban.members}
            agents={agents}
            goals={goalsHook.goals}
            onClose={() => setShowCreate(false)}
            onCreate={async (fields) => {
              await kanban.createTask(fields);
              setShowCreate(false);
            }}
          />
        )}
      </View>
    );
  }

  // ─── Desktop Layout ────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <AgentTopBar agents={agents} />
      <OrchestraPanel agents={agents} automationStats={automationStats} taskStats={taskStats} />
      <TaskSearchBar
        searchText={searchText}
        onSearchChange={setSearchText}
        filterPriority={filterPriority}
        onFilterPriority={setFilterPriority}
        filterAssignee={filterAssignee}
        onFilterAssignee={setFilterAssignee}
        assigneeOptions={assigneeOptions}
        searchInputRef={searchInputRef}
        totalTasks={totalTasks}
      />

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
        />

        {/* Center panel: Activity / Agent Tasks toggle */}
        <View style={ct.wrapper}>
          <View style={ct.tabs}>
            <Pressable
              onPress={() => setCenterTab('activity')}
              style={[ct.tab, centerTab === 'activity' && ct.tabActive]}
            >
              <Text style={[ct.tabText, centerTab === 'activity' && ct.tabTextActive]}>{'\u26A1'} Activity</Text>
            </Pressable>
            <Pressable
              onPress={() => setCenterTab('agents')}
              style={[ct.tab, centerTab === 'agents' && ct.tabActive]}
            >
              <Text style={[ct.tabText, centerTab === 'agents' && ct.tabTextActive]}>{'\u2699'} Agent Tasks</Text>
            </Pressable>
            <Pressable
              onPress={() => setCenterTab('ai-tools')}
              style={[ct.tab, centerTab === 'ai-tools' && ct.tabActive]}
            >
              <Text style={[ct.tabText, centerTab === 'ai-tools' && ct.tabTextActive]}>{'\uD83E\uDD17'} AI Tools</Text>
            </Pressable>
          </View>
          {centerTab === 'activity' ? (
            <ActivityFeedPanel circleId={circleId} agents={agents} />
          ) : centerTab === 'ai-tools' ? (
            <HuggingSwanPanel circleId={circleId} />
          ) : (
            <AgentTasksPanel
              tasksByColumn={filteredTasksByColumn}
              agents={agents}
              onCardPress={setDetailTask}
            />
          )}
        </View>

        <KanbanBoard
          columns={COLUMNS}
          tasksByColumn={filteredTasksByColumn}
          agents={agents}
          goals={goalsHook.goals}
          onCardPress={setDetailTask}
          onMoveTask={kanban.moveTask}
          onQuickAdd={(status, title) => kanban.createTask({ title, status })}
          onAddTask={(status) => { setCreateInColumn(status); setShowCreate(true); }}
          onBatchMove={handleBatchMove}
          onArchiveDone={handleArchiveDone}
          externalSearchText={searchText}
          externalFilterPriority={filterPriority}
          externalFilterAssignee={filterAssignee}
        />
      </View>

      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          kanban={kanban}
          goals={goalsHook.goals}
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
          column={createInColumn}
          members={kanban.members}
          agents={agents}
          goals={goalsHook.goals}
          onClose={() => setShowCreate(false)}
          onCreate={async (fields) => {
            await kanban.createTask(fields);
            setShowCreate(false);
          }}
        />
      )}
    </View>
  );
}

// ─── Create Task Modal ──────────────────────────────────────────────────────

interface CreateModalProps {
  column: TaskStatus;
  members: KanbanMember[];
  agents: CircleOfficeAgent[];
  goals: GoalWithCount[];
  onClose: () => void;
  onCreate: (fields: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    assigned_to?: string | null;
    assigned_agent_id?: string | null;
    due_date?: string | null;
    goal_id?: string | null;
  }) => void;
}

function CreateTaskModal({ column, members, agents, goals, onClose, onCreate }: CreateModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const columnDef = COLUMNS.find(c => c.key === column) || COLUMNS[1];

  const handleCreate = () => {
    if (!title.trim()) { setError('Give the task a title'); return; }
    onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status: column,
      assigned_to: assignedTo,
      assigned_agent_id: assignedAgentId,
      due_date: dueDate || null,
      goal_id: selectedGoalId,
    });
  };

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
          <Text style={m.sectionLabel}>Assign to</Text>
          <View style={m.chipRow}>
            <Pressable
              onPress={() => { setAssignedTo(null); setAssignedAgentId(null); }}
              style={[m.chip, !assignedTo && !assignedAgentId && m.chipActive]}
            >
              <Text style={[m.chipText, !assignedTo && !assignedAgentId && { color: '#e8e8e8' }]}>Nobody</Text>
            </Pressable>
            {members.map(mem => (
              <Pressable
                key={mem.id}
                onPress={() => { setAssignedTo(mem.id); setAssignedAgentId(null); }}
                style={[m.chip, assignedTo === mem.id && m.chipActive]}
              >
                <Text style={[m.chipText, assignedTo === mem.id && { color: '#e8e8e8' }]}>
                  {mem.display_name || mem.username}
                </Text>
              </Pressable>
            ))}
            {agents.map(a => (
              <Pressable
                key={a.id}
                onPress={() => { setAssignedAgentId(a.id); setAssignedTo(null); }}
                style={[m.chip, assignedAgentId === a.id && { backgroundColor: (a.color || '#e8e8e8') + '15', borderColor: (a.color || '#e8e8e8') + '30' }]}
              >
                <View style={[m.chipDot, { backgroundColor: a.color || '#e8e8e8' }]} />
                <Text style={[m.chipText, assignedAgentId === a.id && { color: a.color || '#e8e8e8' }]}>{a.name}</Text>
              </Pressable>
            ))}
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
  },
  mobileTabBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
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
    width: 260,
    backgroundColor: '#0d0d0d',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#151515',
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
  },
  tabText: {
    color: '#444444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tabTextActive: {
    color: '#c0c0c0',
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
