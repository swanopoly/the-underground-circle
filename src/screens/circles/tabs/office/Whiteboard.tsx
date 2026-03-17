import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, Platform, ScrollView,
  Animated, Easing,
} from 'react-native';
import {
  OfficeAgent,
  STATUS_COLORS,
  calculateDailyScore,
} from '../../../../lib/officeAgents';
import { isBlackSwanAvailable } from '../../../../lib/blackswanLLM';
import { CronJob } from '../../../../lib/openclawService';
import { useAgentActivity, AgentActivity } from '../../../../services/agentActivityLogger';
import { supabase } from '../../../../lib/supabase';
import { BADGES, getEarnedBadges, getNextBadge, formatPoints, Badge } from '../../../../lib/badges';
import {
  calculateAgentScore, calculateFarmMetrics,
  analyzeWorkloadDistribution, generateCostOptimizations,
  performHealthCheck,
} from '../../../../lib/agentFarmMetrics';

interface Props {
  editable?: boolean;
  notes?: string[];
  onNotesChange?: (notes: string[]) => void;
  agents?: OfficeAgent[];
  statusHistory?: Array<OfficeAgent[]>;
  cronJobs?: CronJob[];
  circleId?: string | null;
  connectedCount?: number;
  totalConnections?: number;
}

// ── COLORS ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#05050d',
  surface: '#0c0c18',
  surfaceLight: '#111124',
  border: '#14142a',
  borderActive: '#1e1e3a',
  text: '#e2e2e8',
  textSec: '#8b8b9e',
  textTert: '#555566',
  active: '#22c55e',
  idle: '#eab308',
  error: '#ef4444',
  offline: '#6b7280',
  accent: '#6366f1',
  pink: '#ec4899',
  live: '#f59e0b',
  amber: '#b45309',
};

const SOURCE_ICONS: Record<string, string> = {
  discord: '🎮', webchat: '💻', cron: '⏰', system: '⚙️',
};

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  task_started:   { icon: '▶', color: C.live },
  task_completed: { icon: '✓', color: C.active },
  task_failed:    { icon: '✗', color: C.error },
  message_in:     { icon: '↓', color: C.accent },
  message_out:    { icon: '↑', color: C.accent },
  tool_call:      { icon: '⚡', color: C.pink },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── REWARD HOOK ────────────────────────────────────────────────────────────
interface RewardState {
  lifetimeXP: number;
  currentBadge: Badge | null;
  nextBadge: Badge | null;
  progressPct: number;
  earnedCount: number;
  totalBadges: number;
}

function useRewardState(): RewardState {
  const [lifetimeXP, setLifetimeXP] = useState(0);

  useEffect(() => {
    let sub: any;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('user_points').select('lifetime_points').eq('user_id', user.id).single()
        .then(({ data }) => { if (data) setLifetimeXP(data.lifetime_points ?? 0); });
      sub = supabase.channel('wb_rewards_' + user.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_points', filter: `user_id=eq.${user.id}` },
          (p: any) => { if (p.new?.lifetime_points != null) setLifetimeXP(p.new.lifetime_points); })
        .subscribe();
    });
    return () => { if (sub) supabase.removeChannel(sub); };
  }, []);

  const earned = getEarnedBadges(lifetimeXP);
  const currentBadge = earned.length ? earned[earned.length - 1] : null;
  const nextBadge = getNextBadge(lifetimeXP) ?? null;

  let progressPct = 0;
  if (nextBadge) {
    const tierStart = currentBadge?.pointsRequired ?? 0;
    const tierEnd = nextBadge.pointsRequired;
    progressPct = Math.min(100, Math.round(((lifetimeXP - tierStart) / (tierEnd - tierStart)) * 100));
  } else {
    progressPct = 100;
  }

  return { lifetimeXP, currentBadge, nextBadge, progressPct, earnedCount: earned.length, totalBadges: BADGES.length };
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────
type TabKey = 'overview' | 'agents' | 'activity' | 'ops';
const TAB_LIST: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'OVERVIEW' },
  { key: 'agents', label: 'AGENTS' },
  { key: 'activity', label: 'ACTIVITY' },
  { key: 'ops', label: 'OPS' },
];

const COLLAPSED_H = 48;
const EXPANDED_H = 320;

export default function Whiteboard({
  editable, notes = [], onNotesChange,
  agents = [], statusHistory = [], cronJobs = [], circleId,
  connectedCount = 0, totalConnections = 0,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [expanded, setExpanded] = useState(false);

  // ── BlackSwan status ──
  const [bsStatus, setBsStatus] = useState<'local' | 'offline' | 'checking'>('checking');
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const ok = await isBlackSwanAvailable();
      if (alive) setBsStatus(ok ? 'local' : 'offline');
    };
    check();
    const t = setInterval(check, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Animated values
  const expandAnim = useRef(new Animated.Value(0)).current; // 0 = collapsed, 1 = expanded
  const glowAnim = useRef(new Animated.Value(0)).current;

  const toggleExpand = () => {
    const toExpanded = !expanded;
    setExpanded(toExpanded);

    if (toExpanded) {
      // "Unlocking" glow pulse then expand
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: false,
        }),
      ]).start();
      Animated.spring(expandAnim, {
        toValue: 1, friction: 8, tension: 50, useNativeDriver: false,
      }).start();
    } else {
      Animated.spring(expandAnim, {
        toValue: 0, friction: 10, tension: 60, useNativeDriver: false,
      }).start();
    }
  };

  // Interpolated values
  const boardHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [COLLAPSED_H, EXPANDED_H],
  });
  const contentOpacity = expandAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });
  const contentTranslateY = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.25],
  });
  const expandBtnRotate = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const { activities } = useAgentActivity(circleId ?? null);
  const reward = useRewardState();

  // Running tasks
  const runningTasks = useMemo(() => {
    const map = new Map<string, AgentActivity>();
    for (const a of [...activities].reverse()) {
      if (a.activity_type === 'task_started') map.set(a.title, a);
      if (a.activity_type === 'task_completed' || a.activity_type === 'task_failed') map.delete(a.title);
    }
    return Array.from(map.values());
  }, [activities]);

  // Farm metrics
  const farmMetrics = useMemo(() => calculateFarmMetrics(agents, []), [agents]);
  const healthCheck = useMemo(() => performHealthCheck(agents, []), [agents]);
  const workloads = useMemo(() => analyzeWorkloadDistribution(agents), [agents]);
  const costOpts = useMemo(() => generateCostOptimizations(agents, []), [agents]);
  const agentScores = useMemo(() => agents.map(a => calculateAgentScore(a, [], agents)), [agents]);

  // Sorted agents: error → active → idle → offline
  const sortedAgents = useMemo(() => {
    const order: Record<string, number> = { error: 0, active: 1, idle: 2, offline: 3 };
    return [...agents].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
  }, [agents]);

  // Today stats
  const todayStats = useMemo(() => {
    const now = new Date();
    const today = activities.filter(a => {
      const d = new Date(a.created_at);
      return d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
    });
    const completed = today.filter(a => a.activity_type === 'task_completed').length;
    const failed = today.filter(a => a.activity_type === 'task_failed').length;
    const rate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : null;
    return { completed, failed, rate };
  }, [activities]);

  const addNote = () => {
    if (noteText.trim() && onNotesChange) {
      onNotesChange([noteText.trim(), ...notes].slice(0, 8));
      setNoteText('');
    }
  };

  // Health
  const healthLabel = healthCheck.passed
    ? (farmMetrics.healthStatus === 'excellent' ? 'HEALTHY' : 'ATTENTION')
    : 'CRITICAL';
  const healthLabelColor = healthCheck.passed
    ? (farmMetrics.healthStatus === 'excellent' ? C.active : C.idle)
    : C.error;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  // Badge color
  const BADGE_REMAP: Record<string, string> = { '#ffd700': '#b45309', '#e5e4e2': '#6366f1', '#c0c0c0': '#475569' };
  const rawBadgeColor = reward.currentBadge?.color ?? C.accent;
  const badgeColor = BADGE_REMAP[rawBadgeColor] ?? rawBadgeColor;

  // ── EDITING MODE ──
  if (editing) {
    return (
      <View style={[styles.board, { height: EXPANDED_H }]}>
        <View style={s.headerBar}>
          <Text style={s.headerIcon}>📝</Text>
          <Text style={s.headerTitle}>NOTES</Text>
          <Pressable onPress={() => setEditing(false)} style={s.headerBtn}>
            <Text style={s.headerBtnText}>DONE</Text>
          </Pressable>
        </View>
        <NotesView notes={notes} noteText={noteText} setNoteText={setNoteText} addNote={addNote} />
      </View>
    );
  }

  // ── ANIMATED BOARD ──
  return (
    <Animated.View style={[styles.board, { height: boardHeight, zIndex: expanded ? 15 : 5 }]}>
      {/* Unlock glow overlay */}
      <Animated.View pointerEvents="none" style={{
        ...StyleSheet.absoluteFillObject,
        backgroundColor: C.accent,
        opacity: glowOpacity,
        borderRadius: 0,
      }} />

      {/* ── ALWAYS VISIBLE: summary bar ── */}
      <Pressable
        onPress={toggleExpand}
        onLongPress={() => editable && setEditing(true)}
        style={s.header}
      >
        <View style={[s.healthDot, { backgroundColor: healthLabelColor }]} />
        <Text style={s.title}>COMMAND CENTER</Text>
        <Text style={[s.healthLabel, { color: healthLabelColor }]}>{healthLabel}</Text>
        <View style={s.scorePill}>
          <Text style={s.scoreVal}>{farmMetrics.averageScore}</Text>
          <Text style={s.scoreGrade}>{farmMetrics.averageScore >= 90 ? 'S' : farmMetrics.averageScore >= 80 ? 'A' : farmMetrics.averageScore >= 70 ? 'B' : farmMetrics.averageScore >= 60 ? 'C' : 'D'}</Text>
        </View>
        {runningTasks.length > 0 && (
          <View style={s.liveBadge}>
            <View style={s.liveDot} />
            <Text style={s.liveBadgeText}>{runningTasks.length} LIVE</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={s.connText}>🔌 {connectedCount}/{totalConnections || 0}</Text>
        <Text style={s.timeText}>{timeStr}</Text>
        {/* BlackSwan status pill */}
        <View style={[
          s.bsPill,
          bsStatus === 'local'    && s.bsPillLocal,
          bsStatus === 'offline'  && s.bsPillOffline,
          bsStatus === 'checking' && s.bsPillChecking,
        ]}>
          <Text style={[
            s.bsPillText,
            bsStatus === 'local'   && { color: '#22c55e' },
            bsStatus === 'offline' && { color: '#555' },
            bsStatus === 'checking' && { color: '#6366f1' },
          ]}>
            {bsStatus === 'local' ? '🦢 LOCAL' : bsStatus === 'checking' ? '🦢 …' : '🦢 OFF'}
          </Text>
        </View>
        {/* Expand/collapse chevron */}
        <Animated.View style={{ transform: [{ rotate: expandBtnRotate }], marginLeft: 4 }}>
          <Text style={s.chevron}>▼</Text>
        </Animated.View>
      </Pressable>

      {/* Status Distribution Bar — always visible */}
      <StatusBar agents={agents} farmMetrics={farmMetrics} />

      {/* Key Metrics Row — only visible when expanded */}
      {expanded && (
        <View style={s.metricsRow}>
          <MiniMetric label="COST" value={`$${farmMetrics.totalCostToday.toFixed(2)}`} color={C.error} />
          <MiniMetric label="TOKENS" value={farmMetrics.totalTokensUsed > 0 ? `${(farmMetrics.totalTokensUsed / 1000).toFixed(0)}K` : '0'} color={C.pink} />
          <MiniMetric label="TASKS" value={`${todayStats.completed}✓ ${todayStats.failed}✗`} color={C.active} />
          <MiniMetric label="RATE" value={todayStats.rate !== null ? `${todayStats.rate}%` : '—'} color={C.accent} />
        </View>
      )}

      {/* ── EXPANDED: full details ── */}
      <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentTranslateY }], flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} onStartShouldSetResponder={() => true}>
          {/* XP Bar — RPG style */}
          <RpgXpBar reward={reward} badgeColor={badgeColor} />

          {/* Tab bar */}
          <View style={s.tabBar}>
            {TAB_LIST.map(t => (
              <Pressable
                key={t.key}
                onPress={() => setActiveTab(t.key)}
                style={[s.tabItem, activeTab === t.key && s.tabItemActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={[s.tabLabel, activeTab === t.key && s.tabLabelActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Tab content */}
          {activeTab === 'overview' && (
            <OverviewTab
              agents={agents} sortedAgents={sortedAgents} activities={activities}
              runningTasks={runningTasks} farmMetrics={farmMetrics} healthCheck={healthCheck}
              workloads={workloads} costOpts={costOpts} todayStats={todayStats}
              reward={reward} badgeColor={badgeColor}
            />
          )}
          {activeTab === 'agents' && (
            <AgentsTab agents={sortedAgents} agentScores={agentScores} workloads={workloads} />
          )}
          {activeTab === 'activity' && (
            <ActivityTab agents={agents} activities={activities} statusHistory={statusHistory} runningTasks={runningTasks} />
          )}
          {activeTab === 'ops' && (
            <OpsTab cronJobs={cronJobs} activities={activities} costOpts={costOpts} />
          )}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

// ── STATUS DISTRIBUTION BAR ────────────────────────────────────────────────
function StatusBar({ agents, farmMetrics }: { agents: OfficeAgent[]; farmMetrics: any }) {
  const total = agents.length || 1;
  const pct = (n: number) => `${Math.max(0, (n / total) * 100)}%`;
  return (
    <View style={s.statusWrap}>
      <View style={s.statusTrack}>
        {farmMetrics.activeAgents > 0 && <View style={[s.statusSeg, { width: pct(farmMetrics.activeAgents) as any, backgroundColor: C.active }]} />}
        {farmMetrics.idleAgents > 0 && <View style={[s.statusSeg, { width: pct(farmMetrics.idleAgents) as any, backgroundColor: C.idle }]} />}
        {farmMetrics.errorAgents > 0 && <View style={[s.statusSeg, { width: pct(farmMetrics.errorAgents) as any, backgroundColor: C.error }]} />}
        {farmMetrics.offlineAgents > 0 && <View style={[s.statusSeg, { width: pct(farmMetrics.offlineAgents) as any, backgroundColor: C.offline }]} />}
      </View>
      <View style={s.statusLabels}>
        <Text style={[s.statusLabel, { color: C.active }]}>{farmMetrics.activeAgents} active</Text>
        <Text style={[s.statusLabel, { color: C.idle }]}>{farmMetrics.idleAgents} idle</Text>
        {farmMetrics.errorAgents > 0 && <Text style={[s.statusLabel, { color: C.error }]}>{farmMetrics.errorAgents} error</Text>}
        <Text style={[s.statusLabel, { color: C.offline }]}>{farmMetrics.offlineAgents} off</Text>
      </View>
    </View>
  );
}

function MiniMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.miniMetric}>
      <Text style={[s.miniMetricVal, { color }]}>{value}</Text>
      <Text style={s.miniMetricLabel}>{label}</Text>
    </View>
  );
}

function MetricCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.metricCell}>
      <Text style={[s.metricCellVal, { color }]}>{value}</Text>
      <Text style={s.metricCellLabel}>{label}</Text>
    </View>
  );
}

// ── OVERVIEW TAB ───────────────────────────────────────────────────────────
function OverviewTab({ agents, sortedAgents, activities, runningTasks, farmMetrics, healthCheck, workloads, costOpts, todayStats, reward, badgeColor }: any) {
  const now = Date.now();
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const a of activities) {
    const hoursAgo = Math.floor((now - new Date(a.created_at).getTime()) / 3600000);
    if (hoursAgo >= 0 && hoursAgo < 6) buckets[5 - hoursAgo]++;
  }
  const maxBucket = Math.max(1, ...buckets);

  const oldest = activities.length ? activities[activities.length - 1] : null;
  let uptimeStr = '—';
  if (oldest) {
    const diff = Date.now() - new Date(oldest.created_at).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <View>
      {/* Health Alerts */}
      {healthCheck.issues.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>HEALTH ALERTS</Text>
          {healthCheck.issues.slice(0, 4).map((issue: any, i: number) => (
            <View key={i} style={[s.alertCard, {
              borderLeftColor: issue.severity === 'critical' ? C.error : issue.severity === 'warning' ? C.idle : C.accent + '60',
            }]}>
              <Text style={[s.alertIcon, {
                color: issue.severity === 'critical' ? C.error : issue.severity === 'warning' ? C.idle : C.accent,
              }]}>
                {issue.severity === 'critical' ? '●' : issue.severity === 'warning' ? '▲' : 'ℹ'}
              </Text>
              <Text style={s.alertText}>{issue.message}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Farm Metrics Grid */}
      <View style={s.sec}>
        <Text style={s.secTitle}>FARM METRICS</Text>
        <View style={s.metricGrid}>
          <MetricCell label="COST TODAY" value={`$${farmMetrics.totalCostToday.toFixed(2)}`} color={C.error} />
          <MetricCell label="COST WEEK" value={`$${farmMetrics.totalCostWeek.toFixed(2)}`} color={C.amber} />
          <MetricCell label="TOKENS" value={farmMetrics.totalTokensUsed > 0 ? `${(farmMetrics.totalTokensUsed / 1000).toFixed(0)}K` : '0'} color={C.pink} />
          <MetricCell label="MESSAGES" value={String(farmMetrics.totalMessagesProcessed)} color={C.accent} />
          <MetricCell label="AVG SCORE" value={String(farmMetrics.averageScore)} color={C.idle} />
          <MetricCell label="UPTIME" value={uptimeStr} color={C.amber} />
        </View>
      </View>

      {/* Running Tasks */}
      {runningTasks.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>RUNNING TASKS</Text>
          {runningTasks.map((t: AgentActivity) => (
            <View key={t.id} style={s.runRow}>
              <View style={s.runDot} />
              <Text style={s.runAgent}>{t.agent_name}</Text>
              <Text style={s.runTitle} numberOfLines={1}>{t.title}</Text>
              <Text style={s.runTime}>{timeAgo(t.created_at)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Workload Distribution */}
      {workloads.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>WORKLOAD</Text>
          {workloads.map((w: any) => {
            const barColor = w.recommendedAction === 'optimal' ? C.active : w.recommendedAction === 'overloaded' ? C.error : C.accent;
            return (
              <View key={w.agentId} style={s.wlRow}>
                <Text style={s.wlName} numberOfLines={1}>{w.agentName}</Text>
                <View style={s.wlTrack}>
                  <View style={[s.wlFill, { width: `${w.currentLoad}%` as any, backgroundColor: barColor }]} />
                </View>
                <Text style={[s.wlPct, { color: barColor }]}>{w.currentLoad}%</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Cost Optimizations */}
      {costOpts.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>COST OPTIMIZATIONS</Text>
          {costOpts.slice(0, 3).map((opt: any, i: number) => (
            <View key={i} style={s.optCard}>
              <View style={[s.optPriority, {
                backgroundColor: opt.priority === 'high' ? C.error + '20' : opt.priority === 'medium' ? C.idle + '20' : C.textTert + '20',
              }]}>
                <Text style={[s.optPriorityText, {
                  color: opt.priority === 'high' ? C.error : opt.priority === 'medium' ? C.idle : C.textSec,
                }]}>{opt.priority.toUpperCase()}</Text>
              </View>
              <Text style={s.optText} numberOfLines={2}>{opt.recommendation}</Text>
              {opt.potentialSavings > 0 && <Text style={s.optSavings}>Save ~${opt.potentialSavings.toFixed(2)}</Text>}
            </View>
          ))}
        </View>
      )}

      {/* Sparkline */}
      <View style={s.sec}>
        <Text style={s.secTitle}>ACTIVITY (6H)</Text>
        <View style={s.sparkWrap}>
          <Text style={s.sparkEdge}>6H</Text>
          {buckets.map((v, i) => (
            <View key={i} style={s.sparkCol}>
              <View style={[s.sparkBar, { height: Math.max(2, (v / maxBucket) * 20), backgroundColor: v > 0 ? C.accent : C.border }]} />
              <Text style={s.sparkCount}>{v}</Text>
            </View>
          ))}
          <Text style={s.sparkEdge}>NOW</Text>
        </View>
      </View>

      {/* Top Performer */}
      {farmMetrics.topPerformer && (
        <View style={s.sec}>
          <Text style={s.secTitle}>TOP PERFORMER</Text>
          <View style={s.topRow}>
            <Text style={s.topIcon}>🌟</Text>
            <Text style={s.topName}>{farmMetrics.topPerformer.agent.name}</Text>
            <Text style={s.topRole}>{farmMetrics.topPerformer.agent.role}</Text>
            <Text style={[s.topScore, { color: farmMetrics.topPerformer.agent.color || C.accent }]}>{farmMetrics.topPerformer.score}</Text>
          </View>
        </View>
      )}

      {/* Agent roster */}
      {sortedAgents.length > 0 ? (
        <View style={s.sec}>
          <Text style={s.secTitle}>AGENTS</Text>
          {sortedAgents.map((a: OfficeAgent) => (
            <View key={a.id} style={s.rosterRow}>
              <View style={[s.rosterDot, { backgroundColor: STATUS_COLORS[a.status] }]} />
              <Text style={s.rosterName} numberOfLines={1}>{a.name}</Text>
              <Text style={s.rosterAct} numberOfLines={1}>{a.activity || '—'}</Text>
              {a.costToday > 0 && <Text style={s.rosterCost}>${a.costToday.toFixed(2)}</Text>}
              <Text style={s.rosterStatus}>{a.status.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={s.emptyBlock}>
          <Text style={s.emptyTitle}>NO AGENTS CONNECTED</Text>
          <Text style={s.emptyHint}>Open Customize → Connections to add agents</Text>
        </View>
      )}

      {/* Recent Activity */}
      <View style={s.sec}>
        <Text style={s.secTitle}>LATEST ACTIVITY</Text>
        {activities.slice(0, 5).map((a: AgentActivity) => {
          const ti = TYPE_ICONS[a.activity_type] ?? { icon: '·', color: C.textSec };
          return (
            <View key={a.id} style={s.actRow}>
              <Text style={[s.actIcon, { color: ti.color }]}>{ti.icon}</Text>
              <Text style={s.actAgent}>{a.agent_name}</Text>
              <Text style={s.actTitle} numberOfLines={1}>{a.title}</Text>
              <Text style={s.actTime}>{timeAgo(a.created_at)}</Text>
            </View>
          );
        })}
        {activities.length === 0 && <Text style={s.emptyInline}>No activity yet — connect an agent to begin</Text>}
      </View>

      {/* Rewards */}
      <View style={s.sec}>
        <Text style={s.secTitle}>REWARDS</Text>
        <View style={s.xpExpRow}>
          <Text style={[s.xpExpBadge, { color: badgeColor }]}>
            {reward.currentBadge ? reward.currentBadge.name.toUpperCase() : 'UNRANKED'}
          </Text>
          <View style={s.xpExpTrack}>
            <View style={[s.xpExpFill, { width: `${reward.progressPct}%` as any, backgroundColor: badgeColor }]} />
          </View>
          <Text style={s.xpExpVal}>{formatPoints(reward.lifetimeXP)} XP</Text>
        </View>
        {reward.nextBadge && <Text style={s.xpExpNext}>Next: {reward.nextBadge.name} at {formatPoints(reward.nextBadge.pointsRequired)}</Text>}
      </View>

      <View style={{ height: 12 }} />
    </View>
  );
}

// ── AGENTS TAB ─────────────────────────────────────────────────────────────
function AgentsTab({ agents, agentScores, workloads }: { agents: OfficeAgent[]; agentScores: any[]; workloads: any[] }) {
  return (
    <View>
      {agents.length === 0 ? (
        <Text style={s.emptyInline}>No agents connected</Text>
      ) : agents.map(agent => {
        const score = agentScores.find((sc: any) => sc.agentId === agent.id);
        const wl = workloads.find((w: any) => w.agentId === agent.id);
        return (
          <View key={agent.id} style={[s.agentCard, { borderLeftColor: STATUS_COLORS[agent.status] + '80' }]}>
            <View style={s.agentCardHeader}>
              <View style={[s.agentCardDot, { backgroundColor: STATUS_COLORS[agent.status] }]} />
              <Text style={s.agentCardName}>{agent.name}</Text>
              <Text style={s.agentCardStatus}>{agent.status.toUpperCase()}</Text>
              {score && <Text style={[s.agentCardGrade, { color: score.grade === 'S' || score.grade === 'A' ? C.active : score.grade === 'B' ? C.idle : C.error }]}>{score.grade}</Text>}
            </View>
            <View style={s.agentCardInfo}>
              <Text style={s.agentCardMeta}>{agent.role}</Text>
              <Text style={s.agentCardMeta}>{agent.model}</Text>
              {agent.connectionName ? <Text style={s.agentCardMeta}>via {agent.connectionName}</Text> : null}
            </View>
            {score && (
              <View style={s.scoreBreakdown}>
                <ScoreBar label="REL" value={score.breakdown.reliability} />
                <ScoreBar label="EFF" value={score.breakdown.efficiency} />
                <ScoreBar label="PRD" value={score.breakdown.productivity} />
                <ScoreBar label="QTY" value={score.breakdown.quality} />
              </View>
            )}
            <View style={s.agentCardStats}>
              <Text style={s.agentCardStat}>Cost: <Text style={{ color: C.error }}>${agent.costToday.toFixed(2)}</Text></Text>
              <Text style={s.agentCardStat}>Msgs: <Text style={{ color: C.accent }}>{agent.messagesProcessed}</Text></Text>
              <Text style={s.agentCardStat}>Tokens: <Text style={{ color: C.pink }}>{agent.tokensUsed > 0 ? `${(agent.tokensUsed / 1000).toFixed(0)}K` : '0'}</Text></Text>
              {wl && <Text style={s.agentCardStat}>Load: <Text style={{ color: wl.currentLoad > 85 ? C.error : wl.currentLoad > 50 ? C.idle : C.active }}>{wl.currentLoad}%</Text></Text>}
            </View>
            {agent.recentActions.length > 0 && (
              <View style={s.agentCardActions}>
                {agent.recentActions.slice(0, 3).map((act, i) => (
                  <Text key={i} style={s.agentCardAction} numberOfLines={1}>· {act}</Text>
                ))}
              </View>
            )}
          </View>
        );
      })}
      <View style={{ height: 12 }} />
    </View>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? C.active : value >= 60 ? C.idle : C.error;
  return (
    <View style={s.scoreBarWrap}>
      <Text style={s.scoreBarLabel}>{label}</Text>
      <View style={s.scoreBarTrack}>
        <View style={[s.scoreBarFill, { width: `${value}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[s.scoreBarVal, { color }]}>{value}</Text>
    </View>
  );
}

// ── ACTIVITY TAB ───────────────────────────────────────────────────────────
function ActivityTab({ agents, activities, statusHistory, runningTasks }: {
  agents: OfficeAgent[]; activities: AgentActivity[];
  statusHistory: Array<OfficeAgent[]>; runningTasks: AgentActivity[];
}) {
  const agentNames = useMemo(() => {
    const names = new Set(activities.map(a => a.agent_name));
    return ['All', ...Array.from(names)];
  }, [activities]);

  const [selected, setSelected] = useState('All');
  const filtered = selected === 'All' ? activities : activities.filter(a => a.agent_name === selected);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} onStartShouldSetResponder={() => true}>
        {agentNames.map(name => (
          <Pressable
            key={name}
            onPress={() => setSelected(name)}
            style={[s.filterChip, selected === name && s.filterChipActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[s.filterChipText, selected === name && s.filterChipTextActive]}>{name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {runningTasks.length > 0 && (
        <View style={s.liveBanner}>
          <View style={s.runDot} />
          <Text style={s.liveBannerText} numberOfLines={1}>{runningTasks[0].title}</Text>
          <Text style={s.liveBannerTime}>{timeAgo(runningTasks[0].created_at)}</Text>
        </View>
      )}

      {filtered.length === 0 ? (
        <Text style={s.emptyInline}>No activity logged</Text>
      ) : filtered.slice(0, 50).map(a => {
        const ti = TYPE_ICONS[a.activity_type] ?? { icon: '·', color: C.textSec };
        const srcIcon = SOURCE_ICONS[a.source] ?? '📡';
        return (
          <View key={a.id} style={s.logRow}>
            <Text style={s.logSrc}>{srcIcon}</Text>
            <View style={s.logContent}>
              <Text style={s.logTitle} numberOfLines={2}>{a.title}</Text>
              {a.body && <Text style={s.logBody} numberOfLines={1}>{a.body}</Text>}
              <Text style={s.logMeta}>{a.agent_name}{a.source_detail ? ` · ${a.source_detail}` : ''} · {formatDate(a.created_at)}</Text>
            </View>
            <View style={s.logRight}>
              <Text style={[s.logTypeIcon, { color: ti.color }]}>{ti.icon}</Text>
              <Text style={s.logTime}>{timeAgo(a.created_at)}</Text>
            </View>
          </View>
        );
      })}
      {statusHistory.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>STATUS SNAPSHOTS</Text>
          {[...statusHistory].reverse().slice(0, 5).map((snap, i) => (
            <View key={i} style={s.snapBlock}>
              <Text style={s.snapLabel}>#{statusHistory.length - i}</Text>
              {snap.map((a: OfficeAgent) => (
                <View key={a.id} style={s.snapRow}>
                  <View style={[s.snapDot, { backgroundColor: STATUS_COLORS[a.status] }]} />
                  <Text style={s.snapName}>{a.name}</Text>
                  <Text style={s.snapStatus}>{a.status.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
      <View style={{ height: 12 }} />
    </View>
  );
}

// ── OPS TAB ────────────────────────────────────────────────────────────────
function OpsTab({ cronJobs, activities, costOpts }: { cronJobs: CronJob[]; activities: AgentActivity[]; costOpts: any[] }) {
  const completed = activities.filter(a => a.activity_type === 'task_completed').length;
  const failed = activities.filter(a => a.activity_type === 'task_failed').length;
  const toolCalls = activities.filter(a => a.activity_type === 'tool_call').length;
  const totalTasks = completed + failed;
  const successPct = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : null;

  const agentCounts: Record<string, number> = {};
  for (const a of activities) agentCounts[a.agent_name] = (agentCounts[a.agent_name] ?? 0) + 1;
  const busiestAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0];

  const oldest = activities.length ? activities[activities.length - 1] : null;
  let uptimeStr = '—';
  if (oldest) {
    const diff = Date.now() - new Date(oldest.created_at).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const errorsBySource: Record<string, number> = {};
  for (const a of activities.filter(x => x.activity_type === 'task_failed')) errorsBySource[a.source] = (errorsBySource[a.source] ?? 0) + 1;

  const enabled = cronJobs.filter(j => j.enabled);
  const disabled = cronJobs.filter(j => !j.enabled);
  const sorted = [...enabled, ...disabled];
  const cronLogs = activities.filter(a => a.source === 'cron').slice(0, 6);

  return (
    <View>
      <View style={s.sec}>
        <Text style={s.secTitle}>OPS METRICS</Text>
        <View style={s.metricGrid}>
          <MetricCell label="COMPLETED" value={String(completed)} color={C.active} />
          <MetricCell label="FAILED" value={String(failed)} color={C.error} />
          <MetricCell label="TOOL CALLS" value={String(toolCalls)} color={C.pink} />
          <MetricCell label="SUCCESS" value={successPct !== null ? `${successPct}%` : '—'} color={C.accent} />
          <MetricCell label="UPTIME" value={uptimeStr} color={C.amber} />
          <MetricCell label="LOG SIZE" value={String(activities.length)} color={C.textSec} />
        </View>
      </View>

      {busiestAgent && (
        <View style={s.sec}>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>🔥 TOP AGENT</Text>
            <Text style={s.infoVal}>{busiestAgent[0]}</Text>
            <Text style={s.infoCount}>{busiestAgent[1]} events</Text>
          </View>
        </View>
      )}

      {Object.keys(errorsBySource).length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>ERRORS BY SOURCE</Text>
          {Object.entries(errorsBySource).map(([src, cnt]) => (
            <Text key={src} style={s.errItem}>{src}: {cnt}</Text>
          ))}
        </View>
      )}

      {sorted.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>CRON JOBS  {enabled.length} on / {disabled.length} off</Text>
          {sorted.map(job => (
            <View key={job.id} style={s.cronRow}>
              <View style={[s.cronDot, { backgroundColor: job.enabled ? C.active : C.offline }]} />
              <Text style={[s.cronName, !job.enabled && { color: C.textTert }]} numberOfLines={1}>{job.name || job.id.slice(0, 10)}</Text>
              <Text style={s.cronSched}>{job.schedule?.expr || job.schedule?.kind || ''}</Text>
            </View>
          ))}
        </View>
      )}

      {cronLogs.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>RECENT CRON RUNS</Text>
          {cronLogs.map(a => (
            <View key={a.id} style={s.cronLogRow}>
              <Text style={[s.cronLogIcon, { color: a.status === 'completed' ? C.active : a.status === 'failed' ? C.error : C.live }]}>
                {a.status === 'completed' ? '✓' : a.status === 'failed' ? '✗' : '▶'}
              </Text>
              <Text style={s.cronLogTitle} numberOfLines={1}>{a.source_detail || a.title}</Text>
              <Text style={s.cronLogTime}>{timeAgo(a.created_at)}</Text>
            </View>
          ))}
        </View>
      )}

      {costOpts.length > 0 && (
        <View style={s.sec}>
          <Text style={s.secTitle}>COST OPTIMIZATIONS</Text>
          {costOpts.map((opt: any, i: number) => (
            <View key={i} style={s.optCard}>
              <View style={[s.optPriority, { backgroundColor: opt.priority === 'high' ? C.error + '20' : opt.priority === 'medium' ? C.idle + '20' : C.textTert + '20' }]}>
                <Text style={[s.optPriorityText, { color: opt.priority === 'high' ? C.error : opt.priority === 'medium' ? C.idle : C.textSec }]}>{opt.priority.toUpperCase()}</Text>
              </View>
              <Text style={s.optText} numberOfLines={2}>{opt.recommendation}</Text>
              {opt.potentialSavings > 0 && <Text style={s.optSavings}>Save ~${opt.potentialSavings.toFixed(2)}</Text>}
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 12 }} />
    </View>
  );
}

// ── NOTES VIEW ─────────────────────────────────────────────────────────────
function NotesView({ notes, noteText, setNoteText, addNote }: {
  notes: string[]; noteText: string; setNoteText: (t: string) => void; addNote: () => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={s.noteInputRow}>
        <TextInput
          style={s.noteInput}
          value={noteText}
          onChangeText={setNoteText}
          onSubmitEditing={addNote}
          placeholder="Add a note..."
          placeholderTextColor={C.textTert}
          maxLength={80}
        />
        <Pressable onPress={addNote} style={[s.noteAddBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.noteAddText}>+</Text>
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {notes.map((note, i) => (
          <Text key={i} style={s.noteItem} numberOfLines={1}>· {note}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

// ── RPG XP BAR ──────────────────────────────────────────────────────────────
function RpgXpBar({ reward, badgeColor }: { reward: RewardState; badgeColor: string }) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Shimmer sweep — runs continuously
    const shimmer = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: false,
      })
    );
    shimmer.start();
    // Pulse on near-complete progress
    if (reward.progressPct >= 80) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.04, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        ])
      );
      pulse.start();
      return () => { shimmer.stop(); pulse.stop(); };
    }
    return () => shimmer.stop();
  }, [reward.progressPct]);

  const shimmerLeft = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['-15%' as any, '110%' as any],
  });

  const SEGMENTS = 10;
  const currentBadgeName = reward.currentBadge?.name ?? 'UNRANKED';
  const nextBadgeName = reward.nextBadge?.name ?? 'MAX';
  const icon = reward.currentBadge
    ? (reward.currentBadge.name.includes('Legend') ? '👑'
      : reward.currentBadge.name.includes('Master') ? '⚔️'
      : reward.currentBadge.name.includes('Expert') ? '🔥'
      : reward.currentBadge.name.includes('Veteran') ? '🛡️'
      : reward.currentBadge.name.includes('Recruit') ? '🌱'
      : '⭐')
    : '💀';

  const xpToNext = reward.nextBadge
    ? reward.nextBadge.pointsRequired - (reward.currentBadge?.pointsRequired ?? 0)
    : 0;
  const xpProgress = reward.lifetimeXP - (reward.currentBadge?.pointsRequired ?? 0);

  return (
    <Animated.View style={[s.xpCard, { borderColor: badgeColor + '40', transform: [{ scale: pulseAnim }] }]}>
      {/* Top row: rank badge + XP total */}
      <View style={s.xpTopRow}>
        <View style={[s.xpLevelBadge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '55' }]}>
          <Text style={s.xpLevelIcon}>{icon}</Text>
          <Text style={[s.xpLevelName, { color: badgeColor }]}>{currentBadgeName.toUpperCase()}</Text>
        </View>
        <View style={s.xpRightCol}>
          <Text style={s.xpTotalLabel}>TOTAL XP</Text>
          <Text style={[s.xpTotalVal, { color: badgeColor }]}>{formatPoints(reward.lifetimeXP)}</Text>
        </View>
      </View>

      {/* XP track with shimmer + segment ticks */}
      <View style={s.xpTrackWrap}>
        {/* Fill */}
        <View style={[s.xpTrackFill, {
          width: `${reward.progressPct}%` as any,
          backgroundColor: badgeColor,
          shadowColor: badgeColor,
          ...(Platform.OS === 'web' ? { boxShadow: `0 0 6px ${badgeColor}99` } as any : {}),
        }]} />
        {/* Shimmer sweep */}
        <Animated.View style={[s.xpTrackShimmer, { left: shimmerLeft, backgroundColor: '#ffffff' }]} />
        {/* Segment ticks */}
        <View style={s.xpSegments} pointerEvents="none">
          {Array.from({ length: SEGMENTS - 1 }).map((_, i) => (
            <View key={i} style={s.xpSegTick} />
          ))}
        </View>
      </View>

      {/* Bottom row: progress label + next tier */}
      <View style={s.xpBottomRow}>
        <Text style={[s.xpProgressLabel, { color: badgeColor }]}>
          {reward.progressPct}% {reward.progressPct >= 80 ? '🔥' : reward.progressPct >= 50 ? '⚡' : ''}
        </Text>
        {reward.nextBadge ? (
          <Text style={s.xpNextLabel}>
            {formatPoints(xpProgress)} / {formatPoints(xpToNext)} → {nextBadgeName}
          </Text>
        ) : (
          <Text style={[s.xpNextLabel, { color: badgeColor }]}>✦ MAX RANK ✦</Text>
        )}
      </View>
    </Animated.View>
  );
}

// ── STYLES ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    left: 0, top: 0, right: 0,
    backgroundColor: C.bg,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: C.accent + '30',
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    overflow: 'hidden',
  } as any,
});

const s = StyleSheet.create({
  // ── Header ──
  header: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4, paddingBottom: 4, borderBottomWidth: 0, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  healthDot: { width: 6, height: 6, borderRadius: 3 },
  title: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace', color: C.text, letterSpacing: 1.5, opacity: 0.9 },
  healthLabel: { fontSize: 7, fontWeight: '800', fontFamily: 'monospace' },
  scorePill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.surface, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8 },
  scoreVal: { fontSize: 8, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  scoreGrade: { fontSize: 6, fontWeight: '800', fontFamily: 'monospace', color: C.idle },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.live + '12', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  liveDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.live },
  liveBadgeText: { fontSize: 6, fontWeight: '800', fontFamily: 'monospace', color: C.live },
  connText: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, fontWeight: '600' },
  timeText: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, fontWeight: '700' },
  chevron: { fontSize: 6, color: C.accent, fontWeight: '900' },

  // ── BlackSwan pill ──
  bsPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a2a', marginLeft: 4 },
  bsPillLocal:    { backgroundColor: '#22c55e12', borderColor: '#22c55e40' },
  bsPillOffline:  { backgroundColor: '#11111a',   borderColor: '#2a2a3a' },
  bsPillChecking: { backgroundColor: '#6366f112', borderColor: '#6366f140' },
  bsPillText: { fontSize: 6, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.3 },

  // ── Notes header ──
  headerBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, paddingBottom: 4 },
  headerIcon: { fontSize: 10 },
  headerTitle: { fontSize: 10, fontWeight: '800', fontFamily: 'monospace', color: C.text, letterSpacing: 1 },
  headerBtn: { marginLeft: 'auto', backgroundColor: C.accent + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  headerBtnText: { fontSize: 8, fontWeight: '800', fontFamily: 'monospace', color: C.accent },

  // ── Status Bar ──
  statusWrap: { marginBottom: 5 },
  statusTrack: { flexDirection: 'row', height: 3, borderRadius: 1.5, overflow: 'hidden', backgroundColor: C.border, opacity: 0.8 },
  statusSeg: { height: '100%' as any },
  statusLabels: { flexDirection: 'row', gap: 6, marginTop: 3 },
  statusLabel: { fontSize: 5.5, fontWeight: '700', fontFamily: 'monospace', opacity: 0.85 },

  // ── Metrics Row ──
  metricsRow: { flexDirection: 'row', gap: 4, marginBottom: 2 },
  miniMetric: { flex: 1, alignItems: 'center', backgroundColor: C.surface, borderRadius: 6, paddingVertical: 3 },
  miniMetricVal: { fontSize: 7, fontWeight: '900', fontFamily: 'monospace' },
  miniMetricLabel: { fontSize: 4.5, fontWeight: '700', fontFamily: 'monospace', color: C.textTert, letterSpacing: 0.3, marginTop: 1 },

  // ── XP Row (RPG) ──
  xpCard: { backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginBottom: 6, borderWidth: 1, borderColor: C.border },
  xpTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  xpLevelBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  xpLevelIcon: { fontSize: 10 },
  xpLevelName: { fontSize: 7, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.8 },
  xpRightCol: { alignItems: 'flex-end', gap: 1 },
  xpTotalLabel: { fontSize: 5, fontFamily: 'monospace', color: C.textTert, fontWeight: '600' },
  xpTotalVal: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace' },
  xpTrackWrap: { position: 'relative', height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 3 },
  xpTrackFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  xpTrackShimmer: { position: 'absolute', top: 0, bottom: 0, width: 40, opacity: 0.35 },
  xpSegments: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row' },
  xpSegTick: { flex: 1, borderRightWidth: 1, borderRightColor: '#00000040' },
  xpBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  xpProgressLabel: { fontSize: 5.5, fontFamily: 'monospace', color: C.textSec, fontWeight: '700' },
  xpNextLabel: { fontSize: 5.5, fontFamily: 'monospace', color: C.textTert },
  xpRow: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surface, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 3, marginBottom: 6 },
  xpRank: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5 },
  xpTrack: { flex: 1, height: 3, backgroundColor: C.border, borderRadius: 1.5, overflow: 'hidden' },
  xpFill: { height: '100%' as any, borderRadius: 1.5 },
  xpVal: { fontSize: 5, fontWeight: '700', fontFamily: 'monospace', color: C.textSec },

  // ── Tab bar ──
  tabBar: { flexDirection: 'row', gap: 0, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: {
    paddingHorizontal: 8, paddingVertical: 4, borderBottomWidth: 2, borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabItemActive: { borderBottomColor: C.accent },
  tabLabel: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: C.textTert },
  tabLabelActive: { color: C.accent },
  tabContent: { flex: 1, overflow: 'hidden' },
  scroll: { flex: 1 },

  // ── Sections ──
  sec: { marginBottom: 8 },
  secTitle: { fontSize: 5.5, fontWeight: '800', fontFamily: 'monospace', color: C.textTert, letterSpacing: 1, marginBottom: 4, opacity: 0.7 },

  // ── Alerts ──
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderRadius: 6, padding: 5, marginBottom: 4, borderLeftWidth: 2 },
  alertIcon: { fontSize: 7, fontWeight: '800' },
  alertText: { fontSize: 7, fontFamily: 'monospace', color: C.text, flex: 1, opacity: 0.9 },

  // ── Metric Grid ──
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  metricCell: { width: '32%' as any, alignItems: 'center', paddingVertical: 4, backgroundColor: C.surface, borderRadius: 5, marginBottom: 2 },
  metricCellVal: { fontSize: 10, fontWeight: '900', fontFamily: 'monospace' },
  metricCellLabel: { fontSize: 5, fontWeight: '700', fontFamily: 'monospace', color: C.textTert, letterSpacing: 0.3, marginTop: 1, opacity: 0.7 },

  // ── Running Tasks ──
  runRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, paddingVertical: 2 },
  runDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.live },
  runAgent: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: C.live, width: 45 },
  runTitle: { fontSize: 7, fontFamily: 'monospace', color: C.text, flex: 1, opacity: 0.9 },
  runTime: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, opacity: 0.7 },

  // ── Workload ──
  wlRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  wlName: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: C.text, width: 45, opacity: 0.9 },
  wlTrack: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  wlFill: { height: '100%' as any, borderRadius: 2, opacity: 0.8 },
  wlPct: { fontSize: 7, fontWeight: '800', fontFamily: 'monospace', width: 22, textAlign: 'right' },

  // ── Cost Opts ──
  optCard: { backgroundColor: C.surface, borderRadius: 6, padding: 6, marginBottom: 4 },
  optPriority: { alignSelf: 'flex-start', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, marginBottom: 3 },
  optPriorityText: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5 },
  optText: { fontSize: 7, fontFamily: 'monospace', color: C.text, opacity: 0.9 },
  optSavings: { fontSize: 6, fontWeight: '700', fontFamily: 'monospace', color: C.active, marginTop: 2 },

  // ── Sparkline ──
  sparkWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingVertical: 2 },
  sparkEdge: { fontSize: 5, fontWeight: '700', fontFamily: 'monospace', color: C.textTert },
  sparkCol: { flex: 1, alignItems: 'center' },
  sparkBar: { width: '80%' as any, borderRadius: 1.5, minHeight: 2 },
  sparkCount: { fontSize: 4.5, fontFamily: 'monospace', color: C.textTert, marginTop: 1 },

  // ── Top Performer ──
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  topIcon: { fontSize: 8 },
  topName: { fontSize: 8, fontWeight: '800', fontFamily: 'monospace', color: C.text },
  topRole: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, flex: 1 },
  topScore: { fontSize: 10, fontWeight: '900', fontFamily: 'monospace' },

  // ── Agent Roster ──
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3, paddingVertical: 1 },
  rosterDot: { width: 4, height: 4, borderRadius: 2 },
  rosterName: { fontSize: 6.5, fontWeight: '700', fontFamily: 'monospace', color: C.text, width: 45 },
  rosterAct: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, flex: 1, opacity: 0.8 },
  rosterCost: { fontSize: 6, fontFamily: 'monospace', color: C.error, fontWeight: '600', opacity: 0.85 },
  rosterStatus: { fontSize: 4.5, fontFamily: 'monospace', color: C.textTert, fontWeight: '600' },

  // ── Activity rows ──
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3, paddingVertical: 1 },
  actIcon: { fontSize: 6, fontWeight: '800', width: 7 },
  actAgent: { fontSize: 6, fontWeight: '700', fontFamily: 'monospace', color: C.textSec, width: 36 },
  actTitle: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, flex: 1, opacity: 0.85 },
  actTime: { fontSize: 5, fontFamily: 'monospace', color: C.textTert, opacity: 0.6 },

  // ── Empty ──
  emptyBlock: { paddingVertical: 8, alignItems: 'center', gap: 3 },
  emptyTitle: { fontSize: 8, fontWeight: '800', fontFamily: 'monospace', color: C.textSec },
  emptyHint: { fontSize: 6, fontFamily: 'monospace', color: C.textTert },
  emptyInline: { fontSize: 7, fontFamily: 'monospace', color: C.textTert, fontStyle: 'italic', textAlign: 'center', marginTop: 8 },

  // ── XP Expanded ──
  xpExpRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  xpExpBadge: { fontSize: 7, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5 },
  xpExpTrack: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  xpExpFill: { height: '100%' as any, borderRadius: 2 },
  xpExpVal: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: C.textSec },
  xpExpNext: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, marginTop: 1 },

  // ── Agent Cards ──
  agentCard: { backgroundColor: C.surface, borderRadius: 8, padding: 8, marginBottom: 6, borderLeftWidth: 2, borderLeftColor: C.border },
  agentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  agentCardDot: { width: 6, height: 6, borderRadius: 3 },
  agentCardName: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace', color: C.text, flex: 1 },
  agentCardStatus: { fontSize: 6, fontWeight: '700', fontFamily: 'monospace', color: C.textSec, opacity: 0.8 },
  agentCardGrade: { fontSize: 10, fontWeight: '900', fontFamily: 'monospace' },
  agentCardInfo: { flexDirection: 'row', gap: 6, marginBottom: 5 },
  agentCardMeta: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, opacity: 0.8 },
  scoreBreakdown: { flexDirection: 'row', gap: 5, marginBottom: 5 },
  scoreBarWrap: { flex: 1 },
  scoreBarLabel: { fontSize: 5, fontWeight: '800', fontFamily: 'monospace', color: C.textTert, marginBottom: 1, letterSpacing: 0.3, opacity: 0.7 },
  scoreBarTrack: { height: 3, backgroundColor: C.border, borderRadius: 1.5, overflow: 'hidden' },
  scoreBarFill: { height: '100%' as any, borderRadius: 1.5, opacity: 0.85 },
  scoreBarVal: { fontSize: 5.5, fontWeight: '800', fontFamily: 'monospace', marginTop: 1 },
  agentCardStats: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  agentCardStat: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, opacity: 0.85 },
  agentCardActions: { paddingTop: 4, marginTop: 2 },
  agentCardAction: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, marginBottom: 2, opacity: 0.8 },

  // ── Activity Tab ──
  filterRow: { maxHeight: 22, marginBottom: 6 },
  filterChip: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
    backgroundColor: C.surface, marginRight: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  filterChipActive: { backgroundColor: C.accent + '18' },
  filterChipText: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: C.textTert },
  filterChipTextActive: { color: C.accent },
  liveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.live + '0a', borderRadius: 6, padding: 5, marginBottom: 5,
    borderLeftWidth: 2, borderLeftColor: C.live + '60',
  },
  liveBannerText: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: C.text, flex: 1, opacity: 0.9 },
  liveBannerTime: { fontSize: 6, fontFamily: 'monospace', color: C.live },

  logRow: { flexDirection: 'row', gap: 4, marginBottom: 5, paddingBottom: 5, borderBottomWidth: 0 },
  logSrc: { fontSize: 7, width: 10, marginTop: 1 },
  logContent: { flex: 1, gap: 2 },
  logTitle: { fontSize: 7, fontWeight: '600', fontFamily: 'monospace', color: C.text, opacity: 0.9 },
  logBody: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, opacity: 0.8 },
  logMeta: { fontSize: 5, fontFamily: 'monospace', color: C.textTert, opacity: 0.7 },
  logRight: { alignItems: 'flex-end', gap: 1 },
  logTypeIcon: { fontSize: 7, fontWeight: '800' },
  logTime: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, opacity: 0.6 },

  // ── Snapshots ──
  snapBlock: { marginBottom: 6, paddingBottom: 4 },
  snapLabel: { fontSize: 6, fontWeight: '700', fontFamily: 'monospace', color: C.textTert, marginBottom: 2, opacity: 0.7 },
  snapRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  snapDot: { width: 4, height: 4, borderRadius: 2 },
  snapName: { fontSize: 7, fontFamily: 'monospace', color: C.text, flex: 1, opacity: 0.9 },
  snapStatus: { fontSize: 6, fontWeight: '600', fontFamily: 'monospace', color: C.textSec, opacity: 0.8 },

  // ── Ops ──
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  infoLabel: { fontSize: 7, fontWeight: '800', fontFamily: 'monospace', color: C.textSec },
  infoVal: { fontSize: 8, fontWeight: '700', fontFamily: 'monospace', color: C.text },
  infoCount: { fontSize: 7, fontFamily: 'monospace', color: C.textSec, opacity: 0.8 },
  errItem: { fontSize: 7, fontFamily: 'monospace', color: C.error, marginBottom: 3, opacity: 0.9 },
  cronRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  cronDot: { width: 4, height: 4, borderRadius: 2 },
  cronName: { fontSize: 7, fontWeight: '600', fontFamily: 'monospace', color: C.text, flex: 1, opacity: 0.9 },
  cronSched: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, opacity: 0.7 },
  cronLogRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  cronLogIcon: { fontSize: 7, fontWeight: '800', width: 8 },
  cronLogTitle: { fontSize: 7, fontFamily: 'monospace', color: C.text, flex: 1, opacity: 0.9 },
  cronLogTime: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, opacity: 0.6 },

  // ── Notes ──
  noteInputRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  noteInput: { flex: 1, backgroundColor: C.surface, borderRadius: 4, borderWidth: 1, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 3, fontSize: 9, fontFamily: 'monospace', color: C.text },
  noteAddBtn: { width: 24, height: 24, borderRadius: 4, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  noteAddText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  noteItem: { fontSize: 9, fontFamily: 'monospace', color: C.text, marginBottom: 3 },
});
