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
import { CronJob, formatCronSchedule } from '../../../../lib/openswanService';
import { useAgentActivity, AgentActivity } from '../../../../services/agentActivityLogger';
import { supabase } from '../../../../lib/supabase';
import { safeGetUser } from '../../../../lib/authSession';
import { subscribeWithReconnect, type ResilientSubscriptionHandle } from '../../../../lib/subscribeWithReconnect';
import { BADGES, getEarnedBadges, getNextBadge, formatPoints, Badge } from '../../../../lib/badges';
import {
  calculateAgentScore, calculateFarmMetrics,
  analyzeWorkloadDistribution, generateCostOptimizations,
  performHealthCheck,
} from '../../../../lib/agentFarmMetrics';
import type { AgentConnection } from '../../../../lib/connectionManager';
import type { BudgetAlert } from '../../../../lib/budgetAlerts';
import type { AgentApproval } from '../../../../services/hitlService';
import {
  loadSiteAgentReadiness,
  type SiteAgentReadinessSnapshot,
  type SiteAgentReadinessPriority,
} from '../../../../lib/siteAgentReadiness';
import type { OfficeBridgeReadinessSnapshot } from '../../../../lib/officeBridgeReadiness';

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
  connections?: AgentConnection[];
  pendingApprovals?: AgentApproval[];
  budgetAlerts?: BudgetAlert[];
  periodCosts?: { today: number; week: number; month: number };
  /** Trip-meter spend from OfficeTab: durable ledger since the user's last
   *  explicit reset (all-time when never reset). Null until first fetch. */
  runningCost?: { total: number; sinceIso: string | null } | null;
}

// ── COLORS ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#000000',
  surface: '#0a0a0a',
  surfaceLight: '#161616',
  border: '#1a1a1a',
  borderActive: '#2a2a2a',
  text: '#e8e8e8',
  textSec: '#9e9e9e',
  textTert: '#6f6f6f',
  active: '#22c55e',
  idle: '#f59e0b',
  error: '#ef4444',
  offline: '#6f6f6f',
  accent: '#6366f1',
  pink: '#a855f7',
  live: '#22c55e',
  amber: '#f59e0b',
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
    let handle: ResilientSubscriptionHandle | null = null;
    let cancelled = false;
    // safeGetUser instead of a bare supabase.auth.getUser() (CLAUDE.md: migrate
    // while touching the file) — the raw call can reject and this had no catch.
    void safeGetUser().then(({ value: user }) => {
      if (!user || cancelled) return;
      const loadXp = () => {
        // A new account has no reward row until its first server-owned award.
        // Treat that as zero instead of requiring exactly one row, which makes
        // PostgREST emit a noisy 406 during every Office load.
        void supabase.from('user_points').select('lifetime_points').eq('user_id', user.id).maybeSingle()
          .then(({ data }) => { if (data && !cancelled) setLifetimeXP(data.lifetime_points ?? 0); });
      };
      loadXp();
      handle = subscribeWithReconnect({
        channelName: 'wb_rewards_' + user.id,
        onCatchUp: loadXp,
        setup: (channel) => channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'user_points', filter: `user_id=eq.${user.id}` },
          (p: any) => { if (p.new?.lifetime_points != null) setLifetimeXP(p.new.lifetime_points); },
        ),
      });
      if (cancelled) { handle.unsubscribe(); handle = null; }
    });
    return () => { cancelled = true; if (handle) handle.unsubscribe(); };
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

const COLLAPSED_H = 46;
const EXPANDED_H = 390;

type Tone = 'good' | 'live' | 'warn' | 'danger' | 'info' | 'muted';

interface MissionCardVm {
  title: string;
  value: string;
  detail: string;
  tone: Tone;
  foot?: string;
}

interface CommandIssueVm {
  title: string;
  detail: string;
  tone: Tone;
}

interface ActionCueVm {
  label: string;
  detail: string;
  tone: Tone;
}

interface CommandCenterVm {
  readyScore: number;
  stateLabel: string;
  stateTone: Tone;
  missionCards: MissionCardVm[];
  issues: CommandIssueVm[];
  actionCues: ActionCueVm[];
  activeBrowserAgents: OfficeAgent[];
  activeToolAgents: OfficeAgent[];
  connectionStats: {
    enabled: number;
    connected: number;
    connecting: number;
    error: number;
    disconnected: number;
  };
  bridgeReadiness: OfficeBridgeReadinessSnapshot | null;
  readiness: SiteAgentReadinessSnapshot | null;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// Same precision ladder as OfficeRunningCostStrip so the two readouts of the
// trip meter can never disagree in the same viewport.
function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export default function Whiteboard({
  editable, notes = [], onNotesChange,
  agents = [], statusHistory = [], cronJobs = [], circleId,
  connectedCount = 0, totalConnections = 0,
  connections = [], pendingApprovals = [], budgetAlerts = [], periodCosts,
  runningCost = null,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [readinessSnapshot, setReadinessSnapshot] = useState<SiteAgentReadinessSnapshot | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [bridgeReadiness, setBridgeReadiness] = useState<OfficeBridgeReadinessSnapshot | null>(null);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // ── BlackSwan status ──
  const [bsStatus, setBsStatus] = useState<'local' | 'offline' | 'checking'>('checking');
  useEffect(() => {
    // The collapsed header still renders the BlackSwan pill, so keep one
    // lightweight health signal. Refresh it slowly while collapsed and more
    // often only while the diagnostics board is open.
    let alive = true;
    const check = async () => {
      const ok = await isBlackSwanAvailable();
      if (alive) setBsStatus(ok ? 'local' : 'offline');
    };
    check();
    const t = setInterval(check, expanded ? 30_000 : 120_000);
    return () => { alive = false; clearInterval(t); };
  }, [expanded]);

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

  const refreshReadiness = useCallback(async () => {
    if (!circleId) return;
    setReadinessLoading(true);
    setReadinessError(null);
    try {
      const snapshot = await loadSiteAgentReadiness(circleId);
      setReadinessSnapshot(snapshot);
    } catch (error: any) {
      setReadinessError(error?.message || 'Automation readiness audit failed.');
    } finally {
      setReadinessLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    if (!expanded || !circleId) return;
    let alive = true;
    const run = async () => {
      if (!alive) return;
      await refreshReadiness();
    };
    run();
    const timer = setInterval(run, 90_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [circleId, expanded, refreshReadiness]);

  const refreshBridgeReadiness = useCallback(async () => {
    setBridgeLoading(true);
    setBridgeError(null);
    try {
      // Single probe→snapshot owner (O5, P39) — shared with the OfficeTab
      // main-view readiness strip so the two surfaces can never drift. Probe
      // failures are folded INTO the snapshot (fail-visible), not thrown.
      const { runOfficeBridgeReadinessProbe } = await import('../../../../lib/officeBridgeReadinessProbe');
      setBridgeReadiness(await runOfficeBridgeReadinessProbe({ timeoutMs: 1500 }));
    } catch (error: any) {
      // The probe helper never throws; belt-and-braces for the import itself.
      setBridgeError(error?.message || 'Bridge health audit failed.');
    } finally {
      setBridgeLoading(false);
    }
  }, []);

  useEffect(() => {
    // Full bridge diagnostics import and probe multiple local runtimes. The
    // collapsed strip already has Office connection counts, so keep this work
    // dormant until the operator expands the board.
    if (!expanded) {
      setBridgeLoading(false);
      return;
    }
    let alive = true;
    const run = async () => {
      if (!alive) return;
      await refreshBridgeReadiness();
    };
    run();
    const timer = setInterval(run, 45_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [expanded, refreshBridgeReadiness]);

  // Running tasks
  const runningTasks = useMemo(() => {
    const map = new Map<string, AgentActivity>();
    for (const a of [...activities].reverse()) {
      if (a.activity_type === 'task_started') map.set(a.title, a);
      if (a.activity_type === 'task_completed' || a.activity_type === 'task_failed') map.delete(a.title);
    }
    return Array.from(map.values());
  }, [activities]);

  // Live ticker stats (matches OfficeTab liveStats)
  const liveCount = useMemo(() => agents.filter(a => a.status === 'active' || a.status === 'building').length, [agents]);
  const totalTokens = useMemo(() => agents.reduce((s, a) => s + a.tokensUsed, 0), [agents]);
  const totalMsgs = useMemo(() => agents.reduce((s, a) => s + a.turns, 0), [agents]);

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

  const commandCenter = useMemo<CommandCenterVm>(() => {
    const enabledConnections = connections.filter(c => c.enabled);
    const connected = enabledConnections.filter(c => c.status === 'connected').length || connectedCount;
    const connecting = enabledConnections.filter(c => c.status === 'connecting').length;
    const errorConnections = enabledConnections.filter(c => c.status === 'error');
    const disconnected = enabledConnections.filter(c => c.status === 'disconnected').length;
    const failedToday = todayStats.failed;
    const dangerBudgetAlerts = budgetAlerts.filter(a => a.level === 'danger' || a.level === 'critical');
    const warningBudgetAlerts = budgetAlerts.filter(a => a.level === 'warning' || a.level === 'info');
    const healthIssues = healthCheck.issues ?? [];
    const criticalHealth = healthIssues.filter((i: any) => i.severity === 'critical').length;
    const warningHealth = healthIssues.filter((i: any) => i.severity === 'warning').length;
    const activeBrowserAgents = agents.filter(a => {
      const text = [
        a.currentToolName,
        a.activity,
        a.currentToolFile,
        ...(a.recentActions ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      return /(browser|computer|playwright|website|wordpress|shopify|webflow|chrome|safari|credential|login)/.test(text);
    });
    const activeToolAgents = agents.filter(a => !!a.currentToolName || (a.status === 'active' || a.status === 'building'));
    const connectedRatio = totalConnections > 0 ? connected / totalConnections : agents.length > 0 ? 1 : 0;
    let score = 100;
    score -= pendingApprovals.length * 10;
    score -= errorConnections.length * 12;
    score -= disconnected * 5;
    score -= dangerBudgetAlerts.length * 14;
    score -= warningBudgetAlerts.length * 5;
    score -= failedToday * 4;
    score -= criticalHealth * 15;
    score -= warningHealth * 5;
    score -= connectedRatio < 1 && totalConnections > 0 ? Math.round((1 - connectedRatio) * 20) : 0;
    if (readinessSnapshot) score = Math.round((score * 0.65) + (readinessSnapshot.score * 0.35));
    if (bridgeReadiness) score = Math.round((score * 0.8) + (bridgeReadiness.score * 0.2));
    if (readinessError) score -= 8;
    if (bridgeError) score -= 8;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const issues: CommandIssueVm[] = [];
    if (pendingApprovals.length > 0) {
      const latest = pendingApprovals[0];
      issues.push({
        title: `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? '' : 's'} waiting`,
        detail: latest?.description || latest?.action_type || 'Review human-in-the-loop requests before agents continue.',
        tone: 'warn',
      });
    }
    if (errorConnections.length > 0) {
      issues.push({
        title: `${errorConnections.length} bridge${errorConnections.length === 1 ? '' : 's'} errored`,
        detail: errorConnections.slice(0, 2).map(c => c.name).join(', '),
        tone: 'danger',
      });
    }
    if (dangerBudgetAlerts.length > 0) {
      const alert = dangerBudgetAlerts[0];
      issues.push({
        title: `${alert.period.toUpperCase()} budget ${Math.round(alert.percentage)}%`,
        detail: alert.message,
        tone: alert.level === 'critical' ? 'danger' : 'warn',
      });
    }
    if (failedToday > 0) {
      issues.push({
        title: `${failedToday} failed task${failedToday === 1 ? '' : 's'} today`,
        detail: 'Open Activity to inspect the failed run timeline before retrying.',
        tone: 'danger',
      });
    }
    if (criticalHealth > 0 || warningHealth > 0) {
      const issue = healthIssues[0];
      issues.push({
        title: `${criticalHealth || warningHealth} health issue${(criticalHealth || warningHealth) === 1 ? '' : 's'}`,
        detail: issue?.message || 'Agent farm health needs attention.',
        tone: criticalHealth > 0 ? 'danger' : 'warn',
      });
    }
    if (readinessError) {
      issues.push({
        title: 'Readiness audit failed',
        detail: readinessError,
        tone: 'warn',
      });
    }
    if (readinessSnapshot?.blockers.length) {
      for (const blocker of readinessSnapshot.blockers.slice(0, 2)) {
        issues.push({
          title: 'Automation blocker',
          detail: blocker,
          tone: readinessSnapshot.grade === 'blocked' ? 'danger' : 'warn',
        });
      }
    }
    if (bridgeError) {
      issues.push({
        title: 'Bridge audit failed',
        detail: bridgeError,
        tone: 'warn',
      });
    } else if (bridgeReadiness && (bridgeReadiness.offline > 0 || bridgeReadiness.degraded > 0 || !bridgeReadiness.available)) {
      issues.push({
        title: bridgeReadiness.statusLabel,
        detail: bridgeReadiness.primaryIssue || bridgeReadiness.summary,
        tone: bridgeReadiness.tone === 'danger' ? 'danger' : 'warn',
      });
    }

    const actionCues: ActionCueVm[] = [];
    if (pendingApprovals.length > 0) actionCues.push({ label: 'Review approvals', detail: 'Unblock waiting agents from the HITL queue.', tone: 'warn' });
    if (errorConnections.length > 0) actionCues.push({ label: 'Reconnect bridges', detail: errorConnections[0]?.error || 'Run bridge diagnostics and retry failed links.', tone: 'danger' });
    if (bridgeReadiness && (bridgeReadiness.offline > 0 || bridgeReadiness.degraded > 0 || !bridgeReadiness.available)) {
      actionCues.push({
        label: bridgeReadiness.actionLabel,
        detail: bridgeReadiness.actionDetail,
        tone: bridgeReadiness.tone === 'danger' ? 'danger' : 'warn',
      });
    }
    if (activeBrowserAgents.length > 0) actionCues.push({ label: 'Watch browser session', detail: `${activeBrowserAgents[0].name} is using browser/computer tools.`, tone: 'live' });
    if (dangerBudgetAlerts.length > 0) actionCues.push({ label: 'Check spend controls', detail: dangerBudgetAlerts[0].message, tone: 'danger' });
    if (readinessSnapshot?.recommendations.length) {
      for (const rec of readinessSnapshot.recommendations.slice(0, 2)) {
        actionCues.push({
          label: rec.title,
          detail: rec.detail,
          tone: priorityTone(rec.priority),
        });
      }
    }
    if (runningTasks.length === 0 && agents.length > 0) actionCues.push({ label: 'Assign next mission', detail: 'No active task is running. Start from Chat or Terminal.', tone: 'info' });
    if (actionCues.length === 0) actionCues.push({ label: 'Ready for work', detail: 'No blockers detected. Agents are ready for the next mission.', tone: 'good' });

    const highestAlert = budgetAlerts[0];
    const costs = periodCosts ?? {
      today: farmMetrics.totalCostToday,
      week: farmMetrics.totalCostWeek,
      month: 0,
    };
    const missionCards: MissionCardVm[] = [
      {
        title: 'Active Runs',
        value: String(runningTasks.length),
        detail: runningTasks[0]?.title || (activeToolAgents[0]?.activity ?? 'No run in flight'),
        tone: runningTasks.length > 0 || activeToolAgents.length > 0 ? 'live' : 'muted',
        foot: activeToolAgents.length > 0 ? `${activeToolAgents.length} agent${activeToolAgents.length === 1 ? '' : 's'} working` : 'Queue is clear',
      },
      {
        title: 'Blocked',
        value: String(issues.length),
        detail: issues[0]?.title || 'No blockers detected',
        tone: issues.length > 0 ? (issues.some(i => i.tone === 'danger') ? 'danger' : 'warn') : 'good',
        foot: pendingApprovals.length > 0 ? `${pendingApprovals.length} approval pending` : 'HITL clear',
      },
      {
        title: 'Browser Use',
        value: String(activeBrowserAgents.length),
        detail: activeBrowserAgents[0]?.activity || 'No live browser/computer session',
        tone: activeBrowserAgents.length > 0 ? 'live' : 'muted',
        foot: activeBrowserAgents[0]?.name || 'Ready when granted',
      },
      {
        title: 'Spend',
        value: `$${costs.today.toFixed(2)}`,
        detail: highestAlert?.message || `$${costs.week.toFixed(2)} this week`,
        tone: dangerBudgetAlerts.length > 0 ? 'danger' : warningBudgetAlerts.length > 0 ? 'warn' : costs.today > 0 ? 'info' : 'muted',
        foot: costs.month > 0 ? `$${costs.month.toFixed(2)} month` : 'Budget ledger',
      },
      {
        title: 'Auto Ready',
        value: readinessSnapshot ? String(readinessSnapshot.score) : readinessLoading ? '...' : '—',
        detail: readinessSnapshot?.summary || readinessError || 'Open the board to audit automation readiness',
        tone: readinessSnapshot ? gradeTone(readinessSnapshot.grade) : readinessError ? 'warn' : 'muted',
        foot: readinessSnapshot ? readinessSnapshot.statusLabel : 'Capability audit',
      },
      {
        title: 'Bridges',
        value: bridgeReadiness
          ? `${bridgeReadiness.healthy}/${bridgeReadiness.total}`
          : bridgeLoading ? '...' : `${connected}/${totalConnections || enabledConnections.length || 0}`,
        detail: bridgeReadiness?.primaryIssue || bridgeReadiness?.summary || errorConnections[0]?.error || (connecting > 0 ? `${connecting} connecting` : 'Bridge links available'),
        tone: bridgeReadiness ? bridgeReadiness.tone : errorConnections.length > 0 ? 'danger' : connected > 0 ? 'good' : totalConnections > 0 ? 'warn' : 'muted',
        foot: bridgeReadiness
          ? `${bridgeReadiness.activeSessions} active session${bridgeReadiness.activeSessions === 1 ? '' : 's'}`
          : errorConnections.length > 0 ? errorConnections[0]?.name : `${enabledConnections.length} enabled`,
      },
      {
        title: 'Schedules',
        value: String(cronJobs.filter(j => j.enabled).length),
        detail: cronJobs.length > 0 ? `${cronJobs.length} cron job${cronJobs.length === 1 ? '' : 's'} configured` : 'No scheduled automations',
        tone: cronJobs.some(j => j.enabled) ? 'info' : 'muted',
        foot: 'Automation calendar',
      },
    ];

    const stateTone: Tone = score >= 85 ? 'good' : score >= 65 ? 'info' : score >= 40 ? 'warn' : 'danger';
    const stateLabel = score >= 85 ? 'READY' : score >= 65 ? 'WATCH' : score >= 40 ? 'NEEDS REVIEW' : 'BLOCKED';
    return {
      readyScore: score,
      stateLabel,
      stateTone,
      missionCards,
      issues,
      actionCues: actionCues.slice(0, 4),
      activeBrowserAgents,
      activeToolAgents,
      connectionStats: {
        enabled: enabledConnections.length,
        connected,
        connecting,
        error: errorConnections.length,
        disconnected,
      },
      bridgeReadiness,
      readiness: readinessSnapshot,
    };
  }, [
    agents,
    budgetAlerts,
    connectedCount,
    connections,
    cronJobs,
    farmMetrics.totalCostToday,
    farmMetrics.totalCostWeek,
    healthCheck,
    pendingApprovals,
    periodCosts,
    bridgeError,
    bridgeLoading,
    bridgeReadiness,
    readinessError,
    readinessLoading,
    readinessSnapshot,
    runningTasks,
    todayStats.failed,
    totalConnections,
  ]);

  const addNote = () => {
    if (noteText.trim() && onNotesChange) {
      onNotesChange([noteText.trim(), ...notes].slice(0, 8));
      setNoteText('');
    }
  };

  // Health
  const healthLabel = healthCheck.passed
    ? (farmMetrics.healthStatus === 'excellent' ? 'HEALTHY' : 'OK')
    : 'CRITICAL';
  const healthLabelColor = healthCheck.passed
    ? (farmMetrics.healthStatus === 'excellent' ? C.active : C.idle)
    : C.error;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  // Badge color
  const BADGE_REMAP: Record<string, string> = { '#ffd700': '#ffd700', '#e5e4e2': '#e5e4e2', '#c0c0c0': '#c0c0c0' };
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

      {/* ── ALWAYS VISIBLE: stats + XP bar ── */}
      <Pressable
        onPress={toggleExpand}
        onLongPress={() => editable && setEditing(true)}
        style={s.headerWrap}
      >
        {/* Row 1: CMD stats dashboard strip */}
        <View style={s.statsStrip}>
          <View style={s.statsRow}>
            {/* Status cell */}
            <View style={[s.statCell, { backgroundColor: healthLabelColor + '10', borderColor: healthLabelColor + '30' }]}>
              <View style={s.statValRow}>
                <View style={[s.healthDot, { backgroundColor: healthLabelColor }]} />
                <Text style={[s.statValue, { color: healthLabelColor }]}>{healthLabel}</Text>
              </View>
              <Text style={s.statLabel}>STATUS</Text>
            </View>

            {/* Live count cell */}
            <View style={[s.statCell, { backgroundColor: liveCount > 0 ? '#22c55e10' : '#ffffff04', borderColor: liveCount > 0 ? '#22c55e30' : '#ffffff10' }]}>
              <View style={s.statValRow}>
                <View style={[s.cmdDot, { backgroundColor: liveCount > 0 ? '#22c55e' : '#333' }]} />
                <Text style={[s.statValue, { color: liveCount > 0 ? '#22c55e' : '#555' }]}>{liveCount}</Text>
              </View>
              <Text style={s.statLabel}>LIVE</Text>
            </View>

            {/* Agents cell */}
            <View style={[s.statCell, { backgroundColor: '#6366f110', borderColor: '#6366f120' }]}>
              <Text style={[s.statValue, { color: '#6366f1' }]}>{agents.length}</Text>
              <Text style={s.statLabel}>AGENTS</Text>
            </View>

            {/* Tokens cell */}
            <View style={[s.statCell, { backgroundColor: totalTokens > 0 ? '#a855f710' : '#ffffff04', borderColor: totalTokens > 0 ? '#a855f720' : '#ffffff10' }]}>
              <Text style={[s.statValue, { color: totalTokens > 0 ? '#a855f7' : '#444' }]}>
                {totalTokens > 0 ? fmtTok(totalTokens) : '—'}
              </Text>
              <Text style={s.statLabel}>TOKENS</Text>
            </View>

            {/* Cost cell */}
            <View style={[s.statCell, { backgroundColor: farmMetrics.totalCostToday > 0 ? '#22c55e10' : '#ffffff04', borderColor: farmMetrics.totalCostToday > 0 ? '#22c55e20' : '#ffffff10' }]}>
              <Text style={[s.statValue, { color: farmMetrics.totalCostToday > 0 ? '#22c55e' : '#444' }]}>
                ${farmMetrics.totalCostToday.toFixed(2)}
              </Text>
              <CostBurnSparkline cost={farmMetrics.totalCostToday} />
              <Text style={s.statLabel}>COST</Text>
            </View>

            {/* Running-cost trip meter cell — durable spend since the user's
                last reset ('all time' when never reset). Hidden until the
                first fetch lands so it can't paint a convincing $0. */}
            {runningCost ? (
              <View style={[s.statCell, { backgroundColor: runningCost.total > 0 ? '#f59e0b10' : '#ffffff04', borderColor: runningCost.total > 0 ? '#f59e0b20' : '#ffffff10' }]}>
                <Text style={[s.statValue, { color: runningCost.total > 0 ? '#f59e0b' : '#444' }]}>
                  {fmtUsd(runningCost.total)}
                </Text>
                <Text style={s.statLabel}>RUNNING COST</Text>
                <Text style={s.statSubLabel}>
                  {runningCost.sinceIso
                    ? `since ${new Date(runningCost.sinceIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : 'all time'}
                </Text>
              </View>
            ) : null}

            {/* Output cell */}
            <View style={[s.statCell, { backgroundColor: totalMsgs > 0 ? '#3b82f610' : '#ffffff04', borderColor: totalMsgs > 0 ? '#3b82f620' : '#ffffff10' }]}>
              <Text style={[s.statValue, { color: totalMsgs > 0 ? '#3b82f6' : '#444' }]}>
                {totalMsgs > 0 ? fmtTok(totalMsgs) : '—'}
              </Text>
              <Text style={s.statLabel}>OUTPUT</Text>
            </View>

            {/* Connections cell */}
            <View style={[s.statCell, { backgroundColor: '#6366f110', borderColor: '#6366f120' }]}>
              <Text style={[s.statValue, { color: connectedCount > 0 ? '#6366f1' : '#555' }]}>{connectedCount}/{totalConnections || 0}</Text>
              <Text style={s.statLabel}>LINKS</Text>
            </View>
          </View>

          {/* Right side: time + BS pill + chevron */}
          <View style={s.statsTrailing}>
            <Text style={s.timeText}>{timeStr}</Text>
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
                bsStatus === 'checking' && { color: '#f59e0b' },
              ]}>
                {bsStatus === 'local' ? '🦢' : bsStatus === 'checking' ? '…' : '🦢'}
              </Text>
            </View>
            <Animated.View style={{ transform: [{ rotate: expandBtnRotate }], marginLeft: 2 }}>
              <Text style={s.chevron}>▼</Text>
            </Animated.View>
          </View>
        </View>

        {/* Row 2: Inline XP bar + achievement */}
        <View style={s.xpInline}>
          <View style={[s.xpInlineBadge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '40' }]}>
            <Text style={s.xpInlineIcon}>{reward.currentBadge ? (reward.currentBadge.name.includes('Legend') ? '👑' : reward.currentBadge.name.includes('Master') ? '⚔️' : reward.currentBadge.name.includes('Expert') ? '🔥' : reward.currentBadge.name.includes('Veteran') ? '🛡️' : reward.currentBadge.name.includes('Recruit') ? '🌱' : '⭐') : '💀'}</Text>
            <Text style={[s.xpInlineName, { color: badgeColor }]}>{(reward.currentBadge?.name ?? 'UNRANKED').toUpperCase()}</Text>
          </View>
          <View style={s.xpInlineTrack}>
            <View style={[s.xpInlineFill, { width: `${reward.progressPct}%` as any, backgroundColor: badgeColor }]} />
          </View>
          <Text style={[s.xpInlinePct, { color: badgeColor }]}>{reward.progressPct}%</Text>
          <Text style={s.xpInlineXp}>{formatPoints(reward.lifetimeXP)} XP</Text>
        </View>
      </Pressable>

      {/* ── EXPANDED: full details ── */}
      <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentTranslateY }], flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} onStartShouldSetResponder={() => true}>
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
              reward={reward} badgeColor={badgeColor} commandCenter={commandCenter}
              readinessLoading={readinessLoading} readinessError={readinessError} onRefreshReadiness={refreshReadiness}
              bridgeLoading={bridgeLoading} bridgeError={bridgeError} onRefreshBridgeReadiness={refreshBridgeReadiness}
            />
          )}
          {activeTab === 'agents' && (
            <AgentsTab agents={sortedAgents} agentScores={agentScores} workloads={workloads} commandCenter={commandCenter} />
          )}
          {activeTab === 'activity' && (
            <ActivityTab agents={agents} activities={activities} statusHistory={statusHistory} runningTasks={runningTasks} commandCenter={commandCenter} />
          )}
          {activeTab === 'ops' && (
            <OpsTab
              cronJobs={cronJobs}
              activities={activities}
              costOpts={costOpts}
              commandCenter={commandCenter}
              budgetAlerts={budgetAlerts}
              periodCosts={periodCosts}
              readinessLoading={readinessLoading}
              readinessError={readinessError}
              onRefreshReadiness={refreshReadiness}
              bridgeLoading={bridgeLoading}
              bridgeError={bridgeError}
              onRefreshBridgeReadiness={refreshBridgeReadiness}
            />
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

function toneColor(tone: Tone): string {
  if (tone === 'good') return C.active;
  if (tone === 'live') return C.live;
  if (tone === 'warn') return C.amber;
  if (tone === 'danger') return C.error;
  if (tone === 'info') return C.accent;
  return C.textTert;
}

function priorityTone(priority: SiteAgentReadinessPriority): Tone {
  if (priority === 'critical') return 'danger';
  if (priority === 'high') return 'warn';
  if (priority === 'medium') return 'info';
  return 'muted';
}

function gradeTone(grade: SiteAgentReadinessSnapshot['grade']): Tone {
  if (grade === 'ready') return 'good';
  if (grade === 'review') return 'info';
  if (grade === 'setup') return 'warn';
  return 'danger';
}

function CommandCenterPanel({ commandCenter }: { commandCenter: CommandCenterVm }) {
  const stateColor = toneColor(commandCenter.stateTone);
  const bridgeStats = commandCenter.bridgeReadiness;
  return (
    <View style={s.commandPanel}>
      <View style={s.commandTopRow}>
        <View style={s.commandTitleBlock}>
          <Text style={s.commandEyebrow}>COMMAND CENTER</Text>
          <Text style={s.commandHeadline}>Mission readiness</Text>
        </View>
        <View style={[s.readyBadge, { borderColor: stateColor + '55', backgroundColor: stateColor + '14' }]}>
          <Text style={[s.readyScore, { color: stateColor }]}>{commandCenter.readyScore}</Text>
          <Text style={[s.readyLabel, { color: stateColor }]}>{commandCenter.stateLabel}</Text>
        </View>
      </View>
      <View style={s.readyTrack}>
        <View style={[s.readyFill, { width: `${commandCenter.readyScore}%` as any, backgroundColor: stateColor }]} />
      </View>
      <View style={s.commandKpiRow}>
        <CommandKpi label="LINKS" value={`${commandCenter.connectionStats.connected}/${commandCenter.connectionStats.enabled || 0}`} tone={commandCenter.connectionStats.error > 0 ? 'danger' : 'good'} />
        <CommandKpi label="TOOLS" value={String(commandCenter.activeToolAgents.length)} tone={commandCenter.activeToolAgents.length > 0 ? 'live' : 'muted'} />
        <CommandKpi label="BROWSER" value={String(commandCenter.activeBrowserAgents.length)} tone={commandCenter.activeBrowserAgents.length > 0 ? 'live' : 'muted'} />
        <CommandKpi
          label="BRIDGE"
          value={bridgeStats ? `${bridgeStats.healthy}/${bridgeStats.total}` : '—'}
          tone={bridgeStats ? bridgeStats.tone : commandCenter.issues.length > 0 ? 'warn' : 'muted'}
        />
      </View>
    </View>
  );
}

function CommandKpi({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const color = toneColor(tone);
  return (
    <View style={[s.commandKpi, { borderColor: color + '25', backgroundColor: color + '0d' }]}>
      <Text style={[s.commandKpiVal, { color }]}>{value}</Text>
      <Text style={s.commandKpiLabel}>{label}</Text>
    </View>
  );
}

function MissionBoardGrid({ cards }: { cards: MissionCardVm[] }) {
  return (
    <View style={s.missionGrid}>
      {cards.map(card => <MissionCard key={card.title} card={card} />)}
    </View>
  );
}

function MissionCard({ card }: { card: MissionCardVm }) {
  const color = toneColor(card.tone);
  return (
    <View style={[s.missionCard, { borderColor: color + '28', backgroundColor: color + '0a' }]}>
      <View style={s.missionCardHead}>
        <Text style={s.missionCardTitle}>{card.title}</Text>
        <Text style={[s.missionCardValue, { color }]}>{card.value}</Text>
      </View>
      <Text style={s.missionCardDetail} numberOfLines={2}>{card.detail}</Text>
      {card.foot ? <Text style={[s.missionCardFoot, { color }]} numberOfLines={1}>{card.foot}</Text> : null}
    </View>
  );
}

function IssueStack({ issues }: { issues: CommandIssueVm[] }) {
  if (issues.length === 0) {
    return (
      <View style={s.clearState}>
        <Text style={s.clearStateTitle}>NO BLOCKERS</Text>
        <Text style={s.clearStateText}>Approvals, bridges, spend, and health checks are clear.</Text>
      </View>
    );
  }
  return (
    <View>
      {issues.slice(0, 5).map((issue, i) => {
        const color = toneColor(issue.tone);
        return (
          <View key={`${issue.title}-${i}`} style={[s.issueRow, { borderLeftColor: color }]}>
            <View style={[s.issueDot, { backgroundColor: color }]} />
            <View style={s.issueCopy}>
              <Text style={s.issueTitle}>{issue.title}</Text>
              <Text style={s.issueDetail} numberOfLines={2}>{issue.detail}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ActionCueList({ cues }: { cues: ActionCueVm[] }) {
  return (
    <View style={s.cueGrid}>
      {cues.map(cue => {
        const color = toneColor(cue.tone);
        return (
          <View key={cue.label} style={[s.cueCard, { borderColor: color + '25' }]}>
            <Text style={[s.cueLabel, { color }]}>{cue.label}</Text>
            <Text style={s.cueDetail} numberOfLines={2}>{cue.detail}</Text>
          </View>
        );
      })}
    </View>
  );
}

function AutomationReadinessPanel({
  snapshot,
  loading,
  error,
  onRefresh,
  compact = false,
}: {
  snapshot: SiteAgentReadinessSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  compact?: boolean;
}) {
  const tone = snapshot ? gradeTone(snapshot.grade) : error ? 'warn' : 'muted';
  const color = toneColor(tone);
  return (
    <View style={[s.readinessPanel, { borderColor: color + '35' }]}>
      <View style={s.readinessHead}>
        <View style={s.readinessTitleBlock}>
          <Text style={s.readinessEyebrow}>AUTOMATION READINESS</Text>
          <Text style={s.readinessTitle}>
            {snapshot?.statusLabel || (loading ? 'Auditing capabilities...' : error ? 'Audit needs review' : 'Open board to audit')}
          </Text>
          <Text style={s.readinessSummary} numberOfLines={2}>
            {snapshot?.summary || error || 'Checks browser/computer use, local bridges, MCP, vault access, observability, and guardrails.'}
          </Text>
        </View>
        <View style={[s.readinessScoreBox, { backgroundColor: color + '12', borderColor: color + '45' }]}>
          <Text style={[s.readinessScore, { color }]}>{snapshot ? snapshot.score : loading ? '...' : '—'}</Text>
          <Text style={[s.readinessGrade, { color }]}>{snapshot?.grade?.toUpperCase() || 'AUDIT'}</Text>
        </View>
      </View>

      {snapshot ? (
        <>
          <View style={s.readinessStatsGrid}>
            <ReadinessStat label="CAPS READY" value={`${snapshot.stats.capabilitiesReady}/${snapshot.stats.capabilitiesReady + snapshot.stats.capabilitiesPartial + snapshot.stats.capabilitiesMissing || 8}`} tone={snapshot.stats.capabilitiesMissing > 0 ? 'warn' : 'good'} />
            <ReadinessStat label="VAULT" value={snapshot.stats.vaultScore == null ? '—' : String(snapshot.stats.vaultScore)} tone={snapshot.stats.vaultCriticalIssues > 0 ? 'danger' : snapshot.stats.vaultHighRiskIssues > 0 ? 'warn' : 'good'} />
            <ReadinessStat label="BRIDGES" value={String(snapshot.stats.activeBridgeProviders)} tone={snapshot.stats.activeBridgeProviders > 0 ? 'good' : 'warn'} />
            <ReadinessStat label="MCP TOOLS" value={String(snapshot.stats.activeMcpToolCount)} tone={snapshot.stats.activeMcpToolCount > 0 ? 'info' : 'muted'} />
            <ReadinessStat label="OBSERVE" value={snapshot.stats.observabilityConnected ? 'YES' : 'NO'} tone={snapshot.stats.observabilityConnected ? 'good' : 'warn'} />
          </View>

          {!compact && <CapabilityFindingGrid snapshot={snapshot} />}

          <View style={s.secTight}>
            <Text style={s.secTitle}>NEXT BEST SETUP</Text>
            {snapshot.recommendations.slice(0, compact ? 2 : 5).map(rec => {
              const recColor = toneColor(priorityTone(rec.priority));
              return (
                <View key={rec.id} style={[s.recommendationRow, { borderLeftColor: recColor }]}>
                  <View style={s.recommendationTop}>
                    <Text style={[s.recommendationPriority, { color: recColor }]}>{rec.priority.toUpperCase()}</Text>
                    <Text style={s.recommendationArea}>{rec.area.toUpperCase()}</Text>
                    <Text style={s.recommendationAction}>{rec.actionLabel}</Text>
                  </View>
                  <Text style={s.recommendationTitle}>{rec.title}</Text>
                  <Text style={s.recommendationDetail} numberOfLines={2}>{rec.detail}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : (
        <View style={s.readinessEmpty}>
          <Text style={s.readinessEmptyText}>{loading ? 'Running readiness audit...' : 'No readiness snapshot yet.'}</Text>
        </View>
      )}

      <Pressable
        onPress={onRefresh}
        disabled={loading}
        style={[s.refreshAuditBtn, loading && { opacity: 0.6 }, Platform.OS === 'web' && { cursor: loading ? 'default' : 'pointer' } as any]}
      >
        <Text style={[s.refreshAuditText, { color }]}>{loading ? 'AUDITING...' : 'REFRESH READINESS'}</Text>
      </Pressable>
    </View>
  );
}

function AgentBridgeReadinessPanel({
  snapshot,
  loading,
  error,
  onRefresh,
  compact = false,
}: {
  snapshot: OfficeBridgeReadinessSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  compact?: boolean;
}) {
  const tone = snapshot ? snapshot.tone : error ? 'warn' : 'muted';
  const color = toneColor(tone);
  return (
    <View style={[s.bridgePanel, { borderColor: color + '35' }]}>
      <View style={s.readinessHead}>
        <View style={s.readinessTitleBlock}>
          <Text style={s.readinessEyebrow}>AGENT BRIDGES</Text>
          <Text style={s.readinessTitle}>
            {snapshot?.statusLabel || (loading ? 'Checking bridges...' : error ? 'Bridge audit needs review' : 'Bridge audit pending')}
          </Text>
          <Text style={s.readinessSummary} numberOfLines={2}>
            {snapshot?.summary || error || 'Checks Claude Code, Codex, Gemini CLI, Cursor, and OpenSwan local bridge health.'}
          </Text>
        </View>
        <View style={[s.readinessScoreBox, { backgroundColor: color + '12', borderColor: color + '45' }]}>
          <Text style={[s.readinessScore, { color }]}>{snapshot ? snapshot.score : loading ? '...' : '—'}</Text>
          <Text style={[s.readinessGrade, { color }]}>{snapshot?.tone?.toUpperCase() || 'AUDIT'}</Text>
        </View>
      </View>

      {snapshot ? (
        <>
          <View style={s.readinessStatsGrid}>
            <ReadinessStat label="READY" value={`${snapshot.healthy}/${snapshot.total}`} tone={snapshot.offline > 0 ? 'danger' : snapshot.degraded > 0 ? 'warn' : 'good'} />
            <ReadinessStat label="DEGRADED" value={String(snapshot.degraded)} tone={snapshot.degraded > 0 ? 'warn' : 'good'} />
            <ReadinessStat label="OFFLINE" value={String(snapshot.offline)} tone={snapshot.offline > 0 ? 'danger' : 'good'} />
            <ReadinessStat label="SESSIONS" value={String(snapshot.activeSessions)} tone={snapshot.activeSessions > 0 ? 'live' : 'muted'} />
            <ReadinessStat label="ACCESS" value={snapshot.available ? 'ON' : 'OFF'} tone={snapshot.available ? 'good' : 'warn'} />
          </View>

          {!compact ? (
            <View style={s.secTight}>
              <Text style={s.secTitle}>BRIDGE FLEET</Text>
              <View style={s.bridgeFleetGrid}>
                {snapshot.results.map(result => {
                  const resultTone: Tone = result.status === 'healthy' ? 'good' : result.status === 'degraded' ? 'warn' : 'danger';
                  const resultColor = toneColor(resultTone);
                  return (
                    <View key={result.name} style={[s.bridgeFleetCard, { borderColor: resultColor + '25', backgroundColor: resultColor + '08' }]}>
                      <View style={s.bridgeFleetHead}>
                        <Text style={s.bridgeFleetName} numberOfLines={1}>{result.label}</Text>
                        <Text style={[s.bridgeFleetStatus, { color: resultColor }]}>{result.status.toUpperCase()}</Text>
                      </View>
                      <Text style={s.bridgeFleetDetail} numberOfLines={2}>{result.detail}</Text>
                      <Text style={s.bridgeFleetFoot} numberOfLines={1}>
                        :{result.port}{result.sessionCount !== undefined ? ` · ${result.sessionCount} session${result.sessionCount === 1 ? '' : 's'}` : ''}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {snapshot.primaryIssue ? (
            <View style={[s.recommendationRow, { borderLeftColor: color }]}>
              <View style={s.recommendationTop}>
                <Text style={[s.recommendationPriority, { color }]}>{snapshot.actionLabel.toUpperCase()}</Text>
              </View>
              <Text style={s.recommendationTitle}>{snapshot.primaryIssue}</Text>
              <Text style={s.recommendationDetail} numberOfLines={2}>{snapshot.actionDetail}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <View style={s.readinessEmpty}>
          <Text style={s.readinessEmptyText}>{loading ? 'Checking local bridge fleet...' : 'No bridge health snapshot yet.'}</Text>
        </View>
      )}

      <Pressable
        onPress={onRefresh}
        disabled={loading}
        style={[s.refreshAuditBtn, loading && { opacity: 0.6 }, Platform.OS === 'web' && { cursor: loading ? 'default' : 'pointer' } as any]}
      >
        <Text style={[s.refreshAuditText, { color }]}>{loading ? 'CHECKING...' : 'REFRESH BRIDGES'}</Text>
      </Pressable>
    </View>
  );
}

function ReadinessStat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const color = toneColor(tone);
  return (
    <View style={[s.readinessStat, { borderColor: color + '25', backgroundColor: color + '0a' }]}>
      <Text style={[s.readinessStatVal, { color }]}>{value}</Text>
      <Text style={s.readinessStatLabel}>{label}</Text>
    </View>
  );
}

function CapabilityFindingGrid({ snapshot }: { snapshot: SiteAgentReadinessSnapshot }) {
  const findings = snapshot.capabilityAudit?.findings || [];
  if (findings.length === 0) return null;
  return (
    <View style={s.secTight}>
      <Text style={s.secTitle}>COMPUTER USE CAPABILITIES</Text>
      <View style={s.capabilityGrid}>
        {findings.map(finding => {
          const tone: Tone = finding.status === 'ready' ? 'good' : finding.status === 'partial' ? 'warn' : 'danger';
          const color = toneColor(tone);
          return (
            <View key={finding.id} style={[s.capabilityCard, { borderColor: color + '25' }]}>
              <View style={s.capabilityHead}>
                <Text style={s.capabilityLabel} numberOfLines={1}>{finding.label}</Text>
                <Text style={[s.capabilityStatus, { color }]}>{finding.status.toUpperCase()}</Text>
              </View>
              <Text style={s.capabilityDetail} numberOfLines={2}>{finding.detail}</Text>
              {finding.sources.length > 0 ? <Text style={s.capabilitySources} numberOfLines={1}>{finding.sources.join(' · ')}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function AutomationPlaybooksPanel({ snapshot }: { snapshot: SiteAgentReadinessSnapshot | null }) {
  const caps = new Set(snapshot?.capabilityAudit?.availableIntegrationCapabilities || []);
  const providers = new Set(snapshot?.capabilityAudit?.availableIntegrationProviders || []);
  const playbooks = [
    {
      title: 'WordPress publishing',
      detail: 'Use vault login/app password, browser replay, draft preview, then approval before publish.',
      ready: snapshot ? snapshot.stats.vaultCredentials > 0 && (caps.has('web_automation') || providers.has('wordpress')) : false,
    },
    {
      title: 'Website edits',
      detail: 'Launch isolated browser, scope allowed domains, record selectors, verify visual diff before save.',
      ready: snapshot ? caps.has('web_automation') || snapshot.stats.capabilitiesReady > 0 : false,
    },
    {
      title: 'Desktop app work',
      detail: 'Use local bridge for launch/focus/type/a11y tree, require approval for destructive actions.',
      ready: snapshot ? (snapshot.capabilityAudit?.findings || []).some(f => f.id === 'desktop_control' && f.status !== 'missing') : false,
    },
    {
      title: 'Research + build',
      detail: 'Route through task preflight, trace tool calls, cap spend, and store reusable runbooks.',
      ready: snapshot ? snapshot.stats.observabilityConnected || snapshot.stats.activeMcpToolCount > 0 : false,
    },
  ];

  return (
    <View style={s.sec}>
      <Text style={s.secTitle}>AUTOMATION PLAYBOOKS</Text>
      <View style={s.playbookGrid}>
        {playbooks.map(playbook => {
          const color = playbook.ready ? C.active : C.amber;
          return (
            <View key={playbook.title} style={[s.playbookCard, { borderColor: color + '25', backgroundColor: color + '08' }]}>
              <View style={s.playbookHead}>
                <Text style={s.playbookTitle}>{playbook.title}</Text>
                <Text style={[s.playbookStatus, { color }]}>{playbook.ready ? 'READY' : 'SETUP'}</Text>
              </View>
              <Text style={s.playbookDetail} numberOfLines={3}>{playbook.detail}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── COST BURN SPARKLINE ────────────────────────────────────────────────────
// Tiny 30-min rolling bar chart. Samples the live cumulative cost every 30s,
// converts to per-sample deltas, and renders them inline under the dollar
// value so you can see *when* spending is happening — not just the total.
// Renders nothing until we have at least one meaningful delta so the cell
// doesn't look broken on a fresh page load.

const BURN_SAMPLE_COUNT = 30;     // 30 samples × 30s = 15 min in view at most
const BURN_SAMPLE_INTERVAL_MS = 30_000;

function CostBurnSparkline({ cost }: { cost: number }) {
  const [samples, setSamples] = useState<Array<{ t: number; cost: number }>>(
    () => [{ t: Date.now(), cost: cost || 0 }],
  );

  // Bucket samples on a fixed interval so spikes from re-renders don't
  // flood the chart. We use an effect tied to the cost value — whenever it
  // changes, we either append (if past interval) or overwrite the last
  // bucket so each bar represents real wall-clock time.
  useEffect(() => {
    setSamples(prev => {
      const last = prev[prev.length - 1];
      const now = Date.now();
      if (last && now - last.t < BURN_SAMPLE_INTERVAL_MS) {
        const next = prev.slice(0, -1);
        next.push({ t: last.t, cost });
        return next;
      }
      const next = [...prev, { t: now, cost }];
      return next.slice(-BURN_SAMPLE_COUNT);
    });
  }, [cost]);

  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    deltas.push(Math.max(0, samples[i].cost - samples[i - 1].cost));
  }
  const hasSignal = deltas.some(d => d > 0);
  if (!hasSignal) return null;

  const max = Math.max(...deltas, 0.0001);
  return (
    <View style={sparkStyles.row}>
      {deltas.map((d, i) => {
        const h = Math.max(1, Math.round((d / max) * 14));
        return (
          <View
            key={`${samples[i]?.t}-${i}`}
            style={[
              sparkStyles.bar,
              { height: h, backgroundColor: d > 0 ? '#22c55e' : '#22c55e30' },
            ]}
          />
        );
      })}
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    height: 14,
    marginTop: 2,
    marginBottom: 2,
  },
  bar: {
    width: 3,
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
  },
});

// ── OVERVIEW TAB ───────────────────────────────────────────────────────────
function OverviewTab({
  agents,
  sortedAgents,
  activities,
  runningTasks,
  farmMetrics,
  healthCheck,
  workloads,
  costOpts,
  todayStats,
  reward,
  badgeColor,
  commandCenter,
  readinessLoading,
  readinessError,
  onRefreshReadiness,
  bridgeLoading,
  bridgeError,
  onRefreshBridgeReadiness,
}: any) {
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
      <CommandCenterPanel commandCenter={commandCenter} />

      <View style={s.sec}>
        <AgentBridgeReadinessPanel
          snapshot={commandCenter.bridgeReadiness}
          loading={bridgeLoading}
          error={bridgeError}
          onRefresh={onRefreshBridgeReadiness}
          compact
        />
      </View>

      <View style={s.sec}>
        <AutomationReadinessPanel
          snapshot={commandCenter.readiness}
          loading={readinessLoading}
          error={readinessError}
          onRefresh={onRefreshReadiness}
          compact
        />
      </View>

      <View style={s.sec}>
        <Text style={s.secTitle}>MISSION BOARD</Text>
        <MissionBoardGrid cards={commandCenter.missionCards} />
      </View>

      <View style={s.splitSec}>
        <View style={s.splitCol}>
          <Text style={s.secTitle}>BLOCKERS</Text>
          <IssueStack issues={commandCenter.issues} />
        </View>
        <View style={s.splitCol}>
          <Text style={s.secTitle}>NEXT MOVES</Text>
          <ActionCueList cues={commandCenter.actionCues} />
        </View>
      </View>

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
function AgentsTab({ agents, agentScores, workloads, commandCenter }: { agents: OfficeAgent[]; agentScores: any[]; workloads: any[]; commandCenter: CommandCenterVm }) {
  const browserAgentIds = new Set(commandCenter.activeBrowserAgents.map(a => a.id));
  const toolAgentIds = new Set(commandCenter.activeToolAgents.map(a => a.id));
  return (
    <View>
      {agents.length === 0 ? (
        <Text style={s.emptyInline}>No agents connected</Text>
      ) : (
        <>
          <View style={s.sec}>
            <Text style={s.secTitle}>AGENT COMMAND MATRIX</Text>
            <View style={s.agentMatrix}>
              {agents.slice(0, 8).map(agent => {
                const score = agentScores.find((sc: any) => sc.agentId === agent.id);
                const wl = workloads.find((w: any) => w.agentId === agent.id);
                const statusColor = STATUS_COLORS[agent.status] || C.textTert;
                return (
                  <View key={agent.id} style={s.matrixRow}>
                    <View style={[s.matrixStatus, { backgroundColor: statusColor }]} />
                    <Text style={s.matrixName} numberOfLines={1}>{agent.name}</Text>
                    <Text style={s.matrixCellText} numberOfLines={1}>{agent.currentToolName || agent.model || 'ready'}</Text>
                    <Text style={[s.matrixBadge, { color: toolAgentIds.has(agent.id) ? C.live : C.textTert }]}>
                      {toolAgentIds.has(agent.id) ? 'WORK' : 'IDLE'}
                    </Text>
                    <Text style={[s.matrixBadge, { color: browserAgentIds.has(agent.id) ? C.accent : C.textTert }]}>
                      {browserAgentIds.has(agent.id) ? 'WEB' : 'SAFE'}
                    </Text>
                    <Text style={[s.matrixBadge, { color: score?.grade === 'S' || score?.grade === 'A' ? C.active : score?.grade === 'B' ? C.idle : C.textTert }]}>
                      {score?.grade || '—'}
                    </Text>
                    <Text style={[s.matrixBadge, { color: wl?.currentLoad > 85 ? C.error : wl?.currentLoad > 50 ? C.idle : C.active }]}>
                      {wl ? `${wl.currentLoad}%` : '0%'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={s.sec}>
            <Text style={s.secTitle}>AGENT DETAIL CARDS</Text>
            {agents.map(agent => {
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
            <View style={s.accessRow}>
              <Text style={[s.accessChip, { color: toolAgentIds.has(agent.id) ? C.live : C.textTert, borderColor: toolAgentIds.has(agent.id) ? C.live + '35' : C.border }]}>
                {toolAgentIds.has(agent.id) ? 'TOOL ACTIVE' : 'TOOLS READY'}
              </Text>
              <Text style={[s.accessChip, { color: browserAgentIds.has(agent.id) ? C.accent : C.textTert, borderColor: browserAgentIds.has(agent.id) ? C.accent + '35' : C.border }]}>
                {browserAgentIds.has(agent.id) ? 'BROWSER WATCH' : 'NO BROWSER'}
              </Text>
              <Text style={[s.accessChip, { color: agent.providerType === 'claude-code' || agent.providerType === 'openswan' ? C.amber : C.textTert, borderColor: C.border }]}>
                {agent.providerType === 'claude-code' || agent.providerType === 'openswan' ? 'LOCAL BRIDGE' : 'API'}
              </Text>
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
          </View>
        </>
      )}
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
function ActivityTab({ agents, activities, statusHistory, runningTasks, commandCenter }: {
  agents: OfficeAgent[]; activities: AgentActivity[];
  statusHistory: Array<OfficeAgent[]>; runningTasks: AgentActivity[];
  commandCenter: CommandCenterVm;
}) {
  const agentNames = useMemo(() => {
    const names = new Set(activities.map(a => a.agent_name));
    return ['All', ...Array.from(names)];
  }, [activities]);

  const [selected, setSelected] = useState('All');
  const filtered = selected === 'All' ? activities : activities.filter(a => a.agent_name === selected);
  const recentRunSteps = filtered.slice(0, 8);

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

      <View style={s.sec}>
        <Text style={s.secTitle}>RUN INSPECTOR</Text>
        <View style={s.inspectorGrid}>
          <CommandKpi label="RUNNING" value={String(runningTasks.length)} tone={runningTasks.length > 0 ? 'live' : 'muted'} />
          <CommandKpi label="BROWSER" value={String(commandCenter.activeBrowserAgents.length)} tone={commandCenter.activeBrowserAgents.length > 0 ? 'live' : 'muted'} />
          <CommandKpi label="TOOLS" value={String(commandCenter.activeToolAgents.length)} tone={commandCenter.activeToolAgents.length > 0 ? 'info' : 'muted'} />
          <CommandKpi label="BLOCKS" value={String(commandCenter.issues.length)} tone={commandCenter.issues.length > 0 ? 'warn' : 'good'} />
        </View>
        <View style={s.timeline}>
          {recentRunSteps.length === 0 ? (
            <Text style={s.emptyInline}>No run evidence yet</Text>
          ) : recentRunSteps.map((step, index) => {
            const ti = TYPE_ICONS[step.activity_type] ?? { icon: '·', color: C.textSec };
            return (
              <View key={step.id} style={s.timelineRow}>
                <View style={s.timelineRail}>
                  <View style={[s.timelineDot, { backgroundColor: ti.color }]} />
                  {index < recentRunSteps.length - 1 ? <View style={s.timelineLine} /> : null}
                </View>
                <View style={s.timelineCard}>
                  <View style={s.timelineCardHead}>
                    <Text style={[s.timelineType, { color: ti.color }]}>{step.activity_type.replace('_', ' ').toUpperCase()}</Text>
                    <Text style={s.timelineTime}>{timeAgo(step.created_at)}</Text>
                  </View>
                  <Text style={s.timelineTitle} numberOfLines={2}>{step.title}</Text>
                  <Text style={s.timelineMeta} numberOfLines={1}>{step.agent_name} · {step.source}{step.source_detail ? ` · ${step.source_detail}` : ''}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

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
function OpsTab({ cronJobs, activities, costOpts, commandCenter, budgetAlerts, periodCosts, readinessLoading, readinessError, onRefreshReadiness, bridgeLoading, bridgeError, onRefreshBridgeReadiness }: {
  cronJobs: CronJob[];
  activities: AgentActivity[];
  costOpts: any[];
  commandCenter: CommandCenterVm;
  budgetAlerts: BudgetAlert[];
  periodCosts?: { today: number; week: number; month: number };
  readinessLoading: boolean;
  readinessError: string | null;
  onRefreshReadiness: () => void;
  bridgeLoading: boolean;
  bridgeError: string | null;
  onRefreshBridgeReadiness: () => void;
}) {
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
        <Text style={s.secTitle}>CONTROL TOWER</Text>
        <View style={s.controlTower}>
          <View style={s.controlTowerHead}>
            <View>
              <Text style={s.controlTowerTitle}>{commandCenter.stateLabel}</Text>
              <Text style={s.controlTowerSub}>Operational posture for agents, bridges, approvals, and spend.</Text>
            </View>
            <Text style={[s.controlTowerScore, { color: toneColor(commandCenter.stateTone) }]}>{commandCenter.readyScore}</Text>
          </View>
          <IssueStack issues={commandCenter.issues} />
          <ActionCueList cues={commandCenter.actionCues} />
        </View>
      </View>

      <View style={s.sec}>
        <AgentBridgeReadinessPanel
          snapshot={commandCenter.bridgeReadiness}
          loading={bridgeLoading}
          error={bridgeError}
          onRefresh={onRefreshBridgeReadiness}
        />
      </View>

      <View style={s.sec}>
        <AutomationReadinessPanel
          snapshot={commandCenter.readiness}
          loading={readinessLoading}
          error={readinessError}
          onRefresh={onRefreshReadiness}
        />
      </View>

      <AutomationPlaybooksPanel snapshot={commandCenter.readiness} />

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

      <View style={s.sec}>
        <Text style={s.secTitle}>TRACKED SPEND</Text>
        <View style={s.ledgerRow}>
          <MetricCell label="24H" value={`$${(periodCosts?.today ?? 0).toFixed(2)}`} color={budgetAlerts.some(a => a.period === 'daily' && (a.level === 'danger' || a.level === 'critical')) ? C.error : C.active} />
          <MetricCell label="7D" value={`$${(periodCosts?.week ?? 0).toFixed(2)}`} color={budgetAlerts.some(a => a.period === 'weekly' && (a.level === 'danger' || a.level === 'critical')) ? C.error : C.amber} />
          <MetricCell label="30D" value={`$${(periodCosts?.month ?? 0).toFixed(2)}`} color={budgetAlerts.some(a => a.period === 'monthly' && (a.level === 'danger' || a.level === 'critical')) ? C.error : C.accent} />
        </View>
        {budgetAlerts.length > 0 ? (
          budgetAlerts.slice(0, 3).map(alert => (
            <View key={`${alert.period}-${alert.level}`} style={[s.budgetAlertRow, { borderLeftColor: alert.level === 'critical' || alert.level === 'danger' ? C.error : C.amber }]}>
              <Text style={s.budgetAlertTitle}>{alert.period.toUpperCase()} · {Math.round(alert.percentage)}%</Text>
              <Text style={s.budgetAlertDetail}>{alert.message}</Text>
            </View>
          ))
        ) : (
          <Text style={s.emptyInline}>No budget alerts active</Text>
        )}
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
              <Text style={s.cronSched}>{formatCronSchedule(job.schedule)}</Text>
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
    paddingHorizontal: 6,
    paddingTop: 3,
    paddingBottom: 3,
    overflow: 'hidden',
  } as any,
});

const s = StyleSheet.create({
  // ── Header ──
  headerWrap: { marginBottom: 0, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  // Stats strip: centered row of stat cells
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 2,
  } as any,
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flex: 1,
  } as any,
  statCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
    minWidth: 26,
  } as any,
  statValRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  } as any,
  statValue: {
    fontSize: 7,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  } as any,
  statLabel: {
    fontSize: 4,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#6f6f6f',
    letterSpacing: 0.8,
    marginTop: 1,
  } as any,
  statSubLabel: {
    fontSize: 4,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#484f58',
    letterSpacing: 0.4,
  } as any,
  statsTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 4,
  } as any,
  healthDot: { width: 4, height: 4, borderRadius: 2 },
  title: { fontSize: 7, fontWeight: '900', fontFamily: 'monospace', color: C.text, letterSpacing: 1, opacity: 0.9 },
  healthLabel: { fontSize: 5.5, fontWeight: '800', fontFamily: 'monospace' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.live + '12', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
  liveDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.live },
  liveBadgeText: { fontSize: 5, fontWeight: '800', fontFamily: 'monospace', color: C.live },
  connText: { fontSize: 5, fontFamily: 'monospace', color: C.textSec, fontWeight: '600' },
  timeText: { fontSize: 5, fontFamily: 'monospace', color: C.textTert, fontWeight: '700' },
  chevron: { fontSize: 5, color: C.accent, fontWeight: '900' },
  // Inline stat values (kept for compatibility)
  cmdDiv: { fontSize: 6, color: '#333', marginHorizontal: 1 },
  cmdVal: { fontSize: 6, fontWeight: '800', fontFamily: 'monospace' },
  cmdDot: { width: 4, height: 4, borderRadius: 2 },

  // ── Inline XP (always visible) ──
  xpInline: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 1, paddingBottom: 0 },
  xpInlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, borderWidth: 1 },
  xpInlineIcon: { fontSize: 7 },
  xpInlineName: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5 },
  xpInlineTrack: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  xpInlineFill: { height: '100%' as any, borderRadius: 2 },
  xpInlinePct: { fontSize: 5.5, fontWeight: '800', fontFamily: 'monospace' },
  xpInlineXp: { fontSize: 5, fontWeight: '700', fontFamily: 'monospace', color: C.textSec },

  // ── BlackSwan pill ──
  bsPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3, paddingVertical: 0, borderRadius: 3, borderWidth: 1, borderColor: '#2a2a2a', marginLeft: 2 },
  bsPillLocal:    { backgroundColor: '#22c55e15', borderColor: '#22c55e30' },
  bsPillOffline:  { backgroundColor: '#111111',   borderColor: '#2a2a2a' },
  bsPillChecking: { backgroundColor: '#f59e0b15', borderColor: '#f59e0b30' },
  bsPillText: { fontSize: 5, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.3 },

  // ── Notes header ──
  headerBar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, paddingBottom: 2 },
  headerIcon: { fontSize: 8 },
  headerTitle: { fontSize: 8, fontWeight: '800', fontFamily: 'monospace', color: C.text, letterSpacing: 1 },
  headerBtn: { marginLeft: 'auto', backgroundColor: C.accent + '18', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  headerBtnText: { fontSize: 7, fontWeight: '800', fontFamily: 'monospace', color: C.accent },

  // ── Status Bar ──
  statusWrap: { marginBottom: 3 },
  statusTrack: { flexDirection: 'row', height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: C.border, opacity: 0.8 },
  statusSeg: { height: '100%' as any },
  statusLabels: { flexDirection: 'row', gap: 5, marginTop: 2 },
  statusLabel: { fontSize: 5, fontWeight: '700', fontFamily: 'monospace', opacity: 0.85 },

  // ── Metrics Row ──
  metricsRow: { flexDirection: 'row', gap: 3, marginBottom: 2 },
  miniMetric: { flex: 1, alignItems: 'center', backgroundColor: C.surface, borderRadius: 4, paddingVertical: 2 },
  miniMetricVal: { fontSize: 6, fontWeight: '900', fontFamily: 'monospace' },
  miniMetricLabel: { fontSize: 4, fontWeight: '700', fontFamily: 'monospace', color: C.textTert, letterSpacing: 0.3, marginTop: 0 },

  // ── XP Row (RPG) ──
  xpCard: { backgroundColor: C.surface, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, marginBottom: 4, borderWidth: 1, borderColor: C.border },
  xpTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  xpLevelBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, borderWidth: 1 },
  xpLevelIcon: { fontSize: 8 },
  xpLevelName: { fontSize: 6, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.8 },
  xpRightCol: { alignItems: 'flex-end', gap: 0 },
  xpTotalLabel: { fontSize: 4.5, fontFamily: 'monospace', color: C.textTert, fontWeight: '600' },
  xpTotalVal: { fontSize: 7, fontWeight: '900', fontFamily: 'monospace' },
  xpTrackWrap: { position: 'relative', height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 2 },
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
  tabBar: { flexDirection: 'row', gap: 0, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: {
    paddingHorizontal: 6, paddingVertical: 2, borderBottomWidth: 2, borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabItemActive: { borderBottomColor: C.accent },
  tabLabel: { fontSize: 6, fontWeight: '700', fontFamily: 'monospace', color: C.textTert },
  tabLabelActive: { color: C.accent },
  tabContent: { flex: 1, overflow: 'hidden' },
  scroll: { flex: 1 },

  // ── Sections ──
  sec: { marginBottom: 6 },
  secTight: { marginTop: 7 },
  secTitle: { fontSize: 5, fontWeight: '800', fontFamily: 'monospace', color: C.textTert, letterSpacing: 1, marginBottom: 3, opacity: 0.7 },
  splitSec: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  splitCol: { flex: 1, minWidth: 0 },

  // ── Command Center ──
  commandPanel: {
    backgroundColor: '#050505',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.accent + '30',
    padding: 8,
    marginBottom: 7,
  },
  commandTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  commandTitleBlock: { flex: 1 },
  commandEyebrow: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', color: C.accent, letterSpacing: 1.2 },
  commandHeadline: { fontSize: 10, fontWeight: '900', fontFamily: 'monospace', color: C.text, marginTop: 1 },
  readyBadge: { width: 58, borderRadius: 8, borderWidth: 1, paddingVertical: 4, alignItems: 'center' },
  readyScore: { fontSize: 17, fontWeight: '900', fontFamily: 'monospace', lineHeight: 18 },
  readyLabel: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.7, marginTop: 1 },
  readyTrack: { height: 4, borderRadius: 2, backgroundColor: C.border, overflow: 'hidden', marginTop: 7, marginBottom: 6 },
  readyFill: { height: '100%' as any, borderRadius: 2 },
  commandKpiRow: { flexDirection: 'row', gap: 4 },
  commandKpi: { flex: 1, alignItems: 'center', borderRadius: 5, borderWidth: 1, paddingVertical: 4 },
  commandKpiVal: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace' },
  commandKpiLabel: { fontSize: 4.5, fontWeight: '800', fontFamily: 'monospace', color: C.textTert, letterSpacing: 0.5, marginTop: 1 },
  missionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  missionCard: { width: '32%' as any, minHeight: 66, borderRadius: 7, borderWidth: 1, padding: 6 },
  missionCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 3 },
  missionCardTitle: { fontSize: 5.5, fontWeight: '900', fontFamily: 'monospace', color: C.textTert, letterSpacing: 0.6, textTransform: 'uppercase' },
  missionCardValue: { fontSize: 13, fontWeight: '900', fontFamily: 'monospace' },
  missionCardDetail: { fontSize: 6.3, fontFamily: 'monospace', color: C.text, opacity: 0.9, minHeight: 22 },
  missionCardFoot: { fontSize: 5.4, fontWeight: '800', fontFamily: 'monospace', marginTop: 'auto' as any, opacity: 0.9 },
  clearState: { backgroundColor: C.active + '08', borderRadius: 6, borderWidth: 1, borderColor: C.active + '20', padding: 6 },
  clearStateTitle: { fontSize: 6, fontWeight: '900', fontFamily: 'monospace', color: C.active, letterSpacing: 0.7 },
  clearStateText: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, marginTop: 2 },
  issueRow: { flexDirection: 'row', gap: 5, backgroundColor: C.surface, borderRadius: 6, borderLeftWidth: 2, padding: 6, marginBottom: 4 },
  issueDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
  issueCopy: { flex: 1 },
  issueTitle: { fontSize: 6.5, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  issueDetail: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, marginTop: 1 },
  cueGrid: { gap: 4 },
  cueCard: { backgroundColor: C.surface, borderRadius: 6, borderWidth: 1, padding: 6 },
  cueLabel: { fontSize: 6.5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.3 },
  cueDetail: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, marginTop: 2 },
  readinessPanel: { backgroundColor: '#050505', borderRadius: 8, borderWidth: 1, padding: 8 },
  bridgePanel: { backgroundColor: '#050505', borderRadius: 8, borderWidth: 1, padding: 8 },
  readinessHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  readinessTitleBlock: { flex: 1 },
  readinessEyebrow: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', color: C.textTert, letterSpacing: 1.2 },
  readinessTitle: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace', color: C.text, marginTop: 1 },
  readinessSummary: { fontSize: 6.2, fontFamily: 'monospace', color: C.textSec, marginTop: 2 },
  readinessScoreBox: { width: 58, borderRadius: 8, borderWidth: 1, alignItems: 'center', paddingVertical: 5 },
  readinessScore: { fontSize: 17, fontWeight: '900', fontFamily: 'monospace', lineHeight: 18 },
  readinessGrade: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5, marginTop: 1 },
  readinessStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  readinessStat: { width: '19%' as any, minWidth: 45, borderRadius: 6, borderWidth: 1, alignItems: 'center', paddingVertical: 4 },
  readinessStatVal: { fontSize: 8, fontWeight: '900', fontFamily: 'monospace' },
  readinessStatLabel: { fontSize: 4.3, fontWeight: '800', fontFamily: 'monospace', color: C.textTert, letterSpacing: 0.4, marginTop: 1 },
  readinessEmpty: { backgroundColor: C.surface, borderRadius: 6, padding: 7, marginTop: 7 },
  readinessEmptyText: { fontSize: 6.5, fontFamily: 'monospace', color: C.textSec, textAlign: 'center' },
  refreshAuditBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: C.border, paddingVertical: 5, marginTop: 7 },
  refreshAuditText: { fontSize: 6, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.7 },
  capabilityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  capabilityCard: { width: '49%' as any, backgroundColor: C.surface, borderRadius: 6, borderWidth: 1, padding: 6 },
  capabilityHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  capabilityLabel: { flex: 1, fontSize: 6.2, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  capabilityStatus: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace' },
  capabilityDetail: { fontSize: 5.8, fontFamily: 'monospace', color: C.textSec, marginTop: 3 },
  capabilitySources: { fontSize: 5.2, fontFamily: 'monospace', color: C.textTert, marginTop: 3 },
  recommendationRow: { backgroundColor: C.surface, borderRadius: 6, borderLeftWidth: 2, padding: 6, marginBottom: 4 },
  recommendationTop: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  recommendationPriority: { fontSize: 5.5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5 },
  recommendationArea: { fontSize: 5, fontWeight: '800', fontFamily: 'monospace', color: C.textTert },
  recommendationAction: { marginLeft: 'auto' as any, fontSize: 5, fontWeight: '800', fontFamily: 'monospace', color: C.accent },
  recommendationTitle: { fontSize: 6.8, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  recommendationDetail: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, marginTop: 2 },
  bridgeFleetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  bridgeFleetCard: { width: '49%' as any, minHeight: 56, borderRadius: 6, borderWidth: 1, padding: 6 },
  bridgeFleetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 3 },
  bridgeFleetName: { flex: 1, fontSize: 6.4, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  bridgeFleetStatus: { fontSize: 5.2, fontWeight: '900', fontFamily: 'monospace' },
  bridgeFleetDetail: { fontSize: 5.8, fontFamily: 'monospace', color: C.textSec, lineHeight: 8 },
  bridgeFleetFoot: { fontSize: 5.2, fontWeight: '800', fontFamily: 'monospace', color: C.textTert, marginTop: 'auto' as any },
  playbookGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  playbookCard: { width: '49%' as any, minHeight: 70, borderRadius: 7, borderWidth: 1, padding: 7 },
  playbookHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 4 },
  playbookTitle: { flex: 1, fontSize: 6.8, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  playbookStatus: { fontSize: 5.2, fontWeight: '900', fontFamily: 'monospace' },
  playbookDetail: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, lineHeight: 9 },

  // ── Alerts ──
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surface, borderRadius: 4, padding: 4, marginBottom: 3, borderLeftWidth: 2 },
  alertIcon: { fontSize: 6, fontWeight: '800' },
  alertText: { fontSize: 6, fontFamily: 'monospace', color: C.text, flex: 1, opacity: 0.9 },

  // ── Metric Grid ──
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  metricCell: { width: '32%' as any, alignItems: 'center', paddingVertical: 3, backgroundColor: C.surface, borderRadius: 4, marginBottom: 2 },
  metricCellVal: { fontSize: 8, fontWeight: '900', fontFamily: 'monospace' },
  metricCellLabel: { fontSize: 4.5, fontWeight: '700', fontFamily: 'monospace', color: C.textTert, letterSpacing: 0.3, marginTop: 0, opacity: 0.7 },

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
  agentMatrix: { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  matrixRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#ffffff08' },
  matrixStatus: { width: 5, height: 5, borderRadius: 2.5 },
  matrixName: { width: 56, fontSize: 6.5, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  matrixCellText: { flex: 1, fontSize: 6, fontFamily: 'monospace', color: C.textSec },
  matrixBadge: { width: 28, fontSize: 5.5, fontWeight: '900', fontFamily: 'monospace', textAlign: 'right' },
  agentCard: { backgroundColor: C.surface, borderRadius: 8, padding: 8, marginBottom: 6, borderLeftWidth: 2, borderLeftColor: C.border },
  agentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  agentCardDot: { width: 6, height: 6, borderRadius: 3 },
  agentCardName: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace', color: C.text, flex: 1 },
  agentCardStatus: { fontSize: 6, fontWeight: '700', fontFamily: 'monospace', color: C.textSec, opacity: 0.8 },
  agentCardGrade: { fontSize: 10, fontWeight: '900', fontFamily: 'monospace' },
  agentCardInfo: { flexDirection: 'row', gap: 6, marginBottom: 5 },
  agentCardMeta: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, opacity: 0.8 },
  accessRow: { flexDirection: 'row', gap: 4, marginBottom: 5, flexWrap: 'wrap' },
  accessChip: { fontSize: 5.4, fontWeight: '900', fontFamily: 'monospace', borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, letterSpacing: 0.3 },
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
  inspectorGrid: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  timeline: { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 6 },
  timelineRow: { flexDirection: 'row', gap: 6 },
  timelineRail: { width: 8, alignItems: 'center' },
  timelineDot: { width: 7, height: 7, borderRadius: 3.5 },
  timelineLine: { width: 1, flex: 1, minHeight: 28, backgroundColor: C.border },
  timelineCard: { flex: 1, paddingBottom: 7 },
  timelineCardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  timelineType: { fontSize: 5.5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5 },
  timelineTime: { fontSize: 5.5, fontFamily: 'monospace', color: C.textTert },
  timelineTitle: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: C.text, marginTop: 2 },
  timelineMeta: { fontSize: 5.8, fontFamily: 'monospace', color: C.textTert, marginTop: 1 },

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
  controlTower: { backgroundColor: '#050505', borderRadius: 8, borderWidth: 1, borderColor: C.borderActive, padding: 7 },
  controlTowerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  controlTowerTitle: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace', color: C.text, letterSpacing: 0.7 },
  controlTowerSub: { fontSize: 6, fontFamily: 'monospace', color: C.textTert, marginTop: 1 },
  controlTowerScore: { fontSize: 18, fontWeight: '900', fontFamily: 'monospace' },
  ledgerRow: { flexDirection: 'row', gap: 2 },
  budgetAlertRow: { backgroundColor: C.surface, borderRadius: 6, borderLeftWidth: 2, padding: 6, marginTop: 4 },
  budgetAlertTitle: { fontSize: 6.5, fontWeight: '900', fontFamily: 'monospace', color: C.text },
  budgetAlertDetail: { fontSize: 6, fontFamily: 'monospace', color: C.textSec, marginTop: 2 },
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
