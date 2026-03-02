import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, Platform, ScrollView,
} from 'react-native';
import {
  OfficeAgent,
  WHITEBOARD_MODES,
  STATUS_COLORS,
  calculateDailyScore,
} from '../../../../lib/officeAgents';
import { CronJob } from '../../../../lib/openclawService';
import { useAgentActivity, AgentActivity } from '../../../../services/agentActivityLogger';
import { supabase } from '../../../../lib/supabase';
import { BADGES, getEarnedBadges, getNextBadge, formatPoints, Badge } from '../../../../lib/badges';

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

const SOURCE_ICONS: Record<string, string> = {
  discord: '🎮',
  webchat: '💻',
  cron: '⏰',
  system: '⚙️',
};

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  task_started:    { icon: '▶', color: '#F59E0B' },
  task_completed:  { icon: '✓', color: '#10B981' },
  task_failed:     { icon: '✗', color: '#EF4444' },
  message_in:      { icon: '↓', color: '#6366f1' },
  message_out:     { icon: '↑', color: '#6366f1' },
  tool_call:       { icon: '⚡', color: '#ec4899' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Whiteboard({
  editable, notes = [], onNotesChange,
  agents = [], statusHistory = [], cronJobs = [], circleId,
  connectedCount = 0, totalConnections = 0,
}: Props) {
  const [modeIndex, setModeIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState('');
  const mode = WHITEBOARD_MODES[modeIndex];

  const { activities } = useAgentActivity(circleId ?? null);

  // Running tasks = started but no matching completed/failed
  const runningTasks = useMemo(() => {
    const map = new Map<string, AgentActivity>();
    for (const a of [...activities].reverse()) {
      if (a.activity_type === 'task_started') map.set(a.title, a);
      if (a.activity_type === 'task_completed' || a.activity_type === 'task_failed') map.delete(a.title);
    }
    return Array.from(map.values());
  }, [activities]);

  const cycleMode = () => {
    if (editing) return;
    setModeIndex(i => (i + 1) % WHITEBOARD_MODES.length);
  };

  const addNote = () => {
    if (noteText.trim() && onNotesChange) {
      onNotesChange([noteText.trim(), ...notes].slice(0, 8));
      setNoteText('');
    }
  };

  return (
    <View style={styles.board}>
      <Pressable
        onPress={cycleMode}
        onLongPress={() => editable && setEditing(!editing)}
        style={[styles.frame, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerIcon}>{editing ? '✏️' : mode.icon}</Text>
          <Text style={styles.headerText}>{editing ? 'NOTES' : mode.label}</Text>
          {runningTasks.length > 0 && !editing && (
            <View style={styles.runningBadge}>
              <View style={styles.runningDot} />
              <Text style={styles.runningCount}>{runningTasks.length} live</Text>
            </View>
          )}
          {editable && (
            <Pressable onPress={() => setEditing(v => !v)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>{editing ? 'VIEW' : 'EDIT'}</Text>
            </Pressable>
          )}
          {!editing && <Text style={styles.headerHint}>TAP</Text>}
        </View>

        {/* Content — fixed height, always scrollable */}
        <View style={styles.content}>
          {editing ? (
            <NotesView notes={notes} noteText={noteText} setNoteText={setNoteText} addNote={addNote} />
          ) : (
            <>
              {mode.key === 'overview'   && <OverviewView agents={agents} activities={activities} runningTasks={runningTasks} cronJobs={cronJobs} connectedCount={connectedCount} totalConnections={totalConnections} />}
              {mode.key === 'activity'   && <ActivityView agents={agents} statusHistory={statusHistory} activities={activities} />}
              {mode.key === 'ops'        && <OpsView cronJobs={cronJobs} activities={activities} />}
              {mode.key === 'agent_log'  && <AgentLogView activities={activities} runningTasks={runningTasks} />}
            </>
          )}
        </View>

        {/* Mode dots */}
        {!editing && (
          <View style={styles.dots}>
            {WHITEBOARD_MODES.map((_, i) => (
              <View key={i} style={[styles.dot, i === modeIndex && styles.dotActive]} />
            ))}
          </View>
        )}
      </Pressable>

      {/* Marker tray */}
      <View style={styles.tray}>
        {['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#ec4899'].map((c, i) => (
          <View key={i} style={[styles.marker, { backgroundColor: c }]} />
        ))}
      </View>
    </View>
  );
}

// ── XP / LEVEL CALC ──────────────────────────────────────────────────────

// ── REAL REWARD SYSTEM HOOK ───────────────────────────────────────────────
// Pulls lifetime_points from user_points table and maps against badge thresholds.
// XP flows generously from every agent turn + action.
// Badges are the hard part — milestone monuments, not participation trophies.

interface RewardState {
  lifetimeXP: number;
  currentBadge: Badge | null;
  nextBadge: Badge | null;
  progressPct: number;   // 0-100 toward next badge
  earnedCount: number;
  totalBadges: number;
}

function useRewardState(): RewardState {
  const [lifetimeXP, setLifetimeXP] = useState(0);
  const [earnedCount, setEarnedCount] = useState(0);

  useEffect(() => {
    let sub: any;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      // Initial fetch
      supabase.from('user_points').select('lifetime_points').eq('user_id', user.id).single()
        .then(({ data }) => { if (data) setLifetimeXP(data.lifetime_points ?? 0); });
      supabase.from('user_badges').select('badge_id', { count: 'exact', head: true }).eq('user_id', user.id)
        .then(({ count }) => setEarnedCount(count ?? 0));
      // Realtime updates
      sub = supabase.channel('wb_rewards_' + user.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_points', filter: `user_id=eq.${user.id}` },
          (p: any) => { if (p.new?.lifetime_points != null) setLifetimeXP(p.new.lifetime_points); })
        .subscribe();
    });
    return () => { if (sub) supabase.removeChannel(sub); };
  }, []);

  const earned = getEarnedBadges(lifetimeXP);
  const currentBadge = earned.length ? earned[earned.length - 1] : null;
  const nextBadge    = getNextBadge(lifetimeXP) ?? null;

  let progressPct = 0;
  if (nextBadge) {
    const tierStart = currentBadge?.pointsRequired ?? 0;
    const tierEnd   = nextBadge.pointsRequired;
    progressPct = Math.min(100, Math.round(((lifetimeXP - tierStart) / (tierEnd - tierStart)) * 100));
  } else {
    progressPct = 100; // max badge earned
  }

  return {
    lifetimeXP,
    currentBadge,
    nextBadge,
    progressPct,
    earnedCount: earned.length,
    totalBadges: BADGES.length,
  };
}

// ── SLIDE 1: OVERVIEW (comprehensive status dashboard) ───────────────────

// Mini sparkline — 6 bars for the last 6 hours of activity
function ActivitySparkline({ activities }: { activities: AgentActivity[] }) {
  const now = Date.now();
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const a of activities) {
    const hoursAgo = Math.floor((now - new Date(a.created_at).getTime()) / 3600000);
    if (hoursAgo >= 0 && hoursAgo < 6) buckets[5 - hoursAgo]++;
  }
  const max = Math.max(1, ...buckets);
  return (
    <View style={s.sparkWrap}>
      <Text style={s.sparkLabel}>6H</Text>
      {buckets.map((v, i) => (
        <View key={i} style={s.sparkCol}>
          <View style={[s.sparkBar, { height: Math.max(1, (v / max) * 12), backgroundColor: v > 0 ? '#6366f1' : '#ddd' }]} />
        </View>
      ))}
      <Text style={s.sparkLabel}>NOW</Text>
    </View>
  );
}

function OverviewView({ agents, activities, runningTasks = [], cronJobs = [], connectedCount = 0, totalConnections = 0 }: {
  agents: OfficeAgent[]; activities: AgentActivity[]; runningTasks?: AgentActivity[]; cronJobs?: CronJob[];
  connectedCount?: number; totalConnections?: number;
}) {
  const reward = useRewardState();

  const now = new Date();
  const todayActs = activities.filter(a => {
    const d = new Date(a.created_at);
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
  });

  const activeCount  = agents.filter(a => a.status === 'active').length;
  const idleCount    = agents.filter(a => a.status === 'idle').length;
  const errorCount   = agents.filter(a => a.status === 'error').length;
  const offlineCount = agents.filter(a => a.status === 'offline').length;
  const totalCost    = agents.reduce((s, a) => s + a.costToday, 0);
  const totalMsgs    = agents.reduce((s, a) => s + a.messagesProcessed, 0);
  const totalTokens  = agents.reduce((s, a) => s + a.tokensUsed, 0);

  const todayCompleted = todayActs.filter(a => a.activity_type === 'task_completed').length;
  const todayFailed    = todayActs.filter(a => a.activity_type === 'task_failed').length;
  const todayTools     = todayActs.filter(a => a.activity_type === 'tool_call').length;
  const todayMsgsIn   = todayActs.filter(a => a.activity_type === 'message_in').length;
  const todayMsgsOut  = todayActs.filter(a => a.activity_type === 'message_out').length;
  const successRate    = todayCompleted + todayFailed > 0
    ? Math.round((todayCompleted / (todayCompleted + todayFailed)) * 100)
    : null;

  // Hourly activity rate
  const oneHourAgo = Date.now() - 3600000;
  const lastHourActs = activities.filter(a => new Date(a.created_at).getTime() > oneHourAgo).length;
  const fiveMinAgo = Date.now() - 300000;
  const last5MinActs = activities.filter(a => new Date(a.created_at).getTime() > fiveMinAgo).length;

  // Uptime from first activity
  const oldest = activities.length ? activities[activities.length - 1] : null;
  let uptimeStr = '—';
  if (oldest) {
    const diff = Date.now() - new Date(oldest.created_at).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const health = useMemo(() => {
    let h = 50;
    if (agents.length) h += (activeCount / agents.length) * 30;
    if (errorCount > 0) h -= errorCount * 10;
    if (successRate !== null) h += (successRate - 50) * 0.2;
    return Math.max(0, Math.min(100, Math.round(h)));
  }, [agents, activeCount, errorCount, successRate]);

  const healthColor = health >= 75 ? '#16a34a' : health >= 45 ? '#b45309' : '#dc2626';
  const healthLabel = health >= 75 ? 'OK' : health >= 45 ? '!!' : '!!';

  const best = useMemo(() => {
    if (!agents.length) return null;
    return [...agents].sort((a, b) => calculateDailyScore(b) - calculateDailyScore(a))[0];
  }, [agents]);

  // Top agents by cost
  const topCostAgents = useMemo(() => {
    return [...agents].filter(a => a.costToday > 0).sort((a, b) => b.costToday - a.costToday).slice(0, 3);
  }, [agents]);

  // Recent activities (last 5)
  const recentActs = activities.slice(0, 5);

  // Enabled cron count
  const enabledCrons = cronJobs.filter(j => j.enabled).length;

  // Per-agent activity counts
  const agentActCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of todayActs) counts[a.agent_name] = (counts[a.agent_name] ?? 0) + 1;
    return counts;
  }, [todayActs]);

  // Badge tier color
  const BADGE_COLOR_REMAP: Record<string, string> = {
    '#ffd700': '#b45309',
    '#e5e4e2': '#6366f1',
    '#c0c0c0': '#475569',
  };
  const rawBadgeColor = reward.currentBadge?.color ?? '#6366f1';
  const badgeColor = BADGE_COLOR_REMAP[rawBadgeColor] ?? rawBadgeColor;

  // Pulse state text
  const pulseText = last5MinActs > 5 ? 'HIGH ACTIVITY' : last5MinActs > 0 ? 'ACTIVE' : activeCount > 0 ? 'MONITORING' : agents.length > 0 ? 'IDLE' : 'STANDBY';
  const pulseColor = last5MinActs > 5 ? '#22c55e' : last5MinActs > 0 ? '#6366f1' : '#6b7280';

  // Time display
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} onStartShouldSetResponder={() => true}>

      {/* ── Row 1: XP + health + pulse + time ─── */}
      <View style={s.topRow}>
        <View style={[s.healthPill, { borderColor: healthColor }]}>
          <Text style={[s.healthScore, { color: healthColor }]}>{health}</Text>
          <Text style={[s.healthLabel, { color: healthColor }]}>{healthLabel}</Text>
        </View>
        <View style={[s.xpInline, { borderColor: badgeColor + '40' }]}>
          <Text style={[s.xpRankInline, { color: badgeColor }]}>
            {reward.currentBadge ? reward.currentBadge.name.toUpperCase() : 'UNRANKED'}
          </Text>
          <View style={s.xpTrackInline}>
            <View style={[s.xpFill, { width: `${reward.progressPct}%` as any, backgroundColor: badgeColor }]} />
          </View>
          <Text style={s.xpValInline}>{formatPoints(reward.lifetimeXP)}</Text>
        </View>
        <View style={s.pulseWrap}>
          <View style={[s.pulseDot, { backgroundColor: pulseColor }]} />
          <Text style={[s.pulseText, { color: pulseColor }]}>{pulseText}</Text>
        </View>
        <Text style={s.timeText}>{timeStr}</Text>
      </View>

      {/* ── Row 2: Agent counts + connections + crons + live tasks ─── */}
      <View style={s.countsRow}>
        <Text style={s.countItem}>🟢 <Text style={{ color: '#22c55e' }}>{activeCount}</Text></Text>
        <Text style={s.countItem}>🟡 <Text style={{ color: '#eab308' }}>{idleCount}</Text></Text>
        <Text style={s.countItem}>🔴 <Text style={{ color: '#ef4444' }}>{errorCount}</Text></Text>
        <Text style={s.countItem}>⚫ <Text style={{ color: '#6b7280' }}>{offlineCount}</Text></Text>
        <View style={s.countDivider} />
        <Text style={s.countItem}>🔌 {connectedCount}/{totalConnections || 0}</Text>
        {enabledCrons > 0 && <Text style={s.countItem}>⏰ {enabledCrons}</Text>}
        {runningTasks.length > 0 && (
          <View style={s.liveChip}>
            <View style={s.liveDotSmall} />
            <Text style={s.liveChipText}>{runningTasks.length} LIVE</Text>
          </View>
        )}
        <Text style={s.countItemRight}>{dateStr}</Text>
      </View>

      {/* ── Row 3: Dense 3×3 metrics grid ─── */}
      <View style={s.gridBlock}>
        <View style={s.gridRow}>
          <Metric label="COST"    value={`$${totalCost.toFixed(2)}`}  color="#ef4444" />
          <Metric label="TOKENS"  value={totalTokens > 0 ? `${(totalTokens/1000).toFixed(0)}K` : '0'} color="#ec4899" />
          <Metric label="MSGS"    value={String(totalMsgs)}           color="#b45309" />
        </View>
        <View style={s.gridRow}>
          <Metric label="✓ DONE"  value={String(todayCompleted)}      color="#22c55e" />
          <Metric label="✗ FAIL"  value={String(todayFailed)}         color="#ef4444" />
          <Metric label="⚡ TOOL"  value={String(todayTools)}           color="#ec4899" />
        </View>
        <View style={s.gridRow}>
          <Metric label="RATE"    value={successRate !== null ? `${successRate}%` : '—'} color="#6366f1" />
          <Metric label="/HR"     value={String(lastHourActs)}        color="#6366f1" />
          <Metric label="UPTIME"  value={uptimeStr}                   color="#b45309" />
        </View>
      </View>

      {/* ── Row 4: Activity sparkline (always visible) ─── */}
      <ActivitySparkline activities={activities} />

      {/* ── Running tasks ─── */}
      {runningTasks.length > 0 && runningTasks.slice(0, 2).map(t => (
        <View key={t.id} style={s.runTaskRow}>
          <View style={s.liveDotSmall} />
          <Text style={s.runTaskAgent}>{t.agent_name}</Text>
          <Text style={s.runTaskTitle} numberOfLines={1}>{t.title}</Text>
          <Text style={s.actTime}>{timeAgo(t.created_at)}</Text>
        </View>
      ))}

      {/* ── Agent roster ─── */}
      {best && (
        <View style={s.aotdRow}>
          <Text style={s.aotdLabel}>🌟 {best.name}</Text>
          <Text style={s.aotdRole}>{best.role}</Text>
          <Text style={[s.aotdScore, { color: best.color }]}>{calculateDailyScore(best)}</Text>
        </View>
      )}
      {agents.length > 0 ? agents.map(a => (
        <View key={a.id} style={s.statusRow}>
          <View style={[s.dot4, { backgroundColor: STATUS_COLORS[a.status] }]} />
          <Text style={s.agentName} numberOfLines={1}>{a.name}</Text>
          <Text style={s.agentActivity} numberOfLines={1}>{a.activity || '—'}</Text>
          <Text style={s.agentEvt}>{agentActCounts[a.name] ?? 0}</Text>
          {a.costToday > 0 && <Text style={s.agentCost}>${a.costToday.toFixed(2)}</Text>}
          <Text style={s.agentStatus}>{a.status.toUpperCase()}</Text>
        </View>
      )) : (
        <View style={s.emptyBlock}>
          <Text style={s.emptyTitle}>NO AGENTS CONNECTED</Text>
          <Text style={s.emptyHint}>⚙️ Open Customize → Connections</Text>
          <Text style={s.emptyHint}>🔌 Add OpenClaw or webhook endpoint</Text>
          <Text style={s.emptyHint}>📡 Agents appear here once live</Text>
        </View>
      )}

      {/* ── Cost breakdown bars ─── */}
      {topCostAgents.length > 0 && (
        <View style={s.costBarWrap}>
          {topCostAgents.map(a => {
            const pct = totalCost > 0 ? Math.round((a.costToday / totalCost) * 100) : 0;
            return (
              <View key={a.id} style={s.costBarRow}>
                <Text style={[s.costBarName, { color: a.color }]}>{a.name}</Text>
                <View style={s.costBarTrack}>
                  <View style={[s.costBarFill, { width: `${pct}%` as any, backgroundColor: a.color }]} />
                </View>
                <Text style={s.costBarVal}>{pct}%</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Recent activity (always shows — even if empty) ─── */}
      <Text style={s.sectionLabel}>LATEST ACTIVITY</Text>
      {recentActs.length > 0 ? recentActs.map(a => {
        const ti = TYPE_ICONS[a.activity_type] ?? { icon: '·', color: '#888' };
        return (
          <View key={a.id} style={s.recentRow}>
            <Text style={[s.recentIcon, { color: ti.color }]}>{ti.icon}</Text>
            <Text style={s.recentAgent}>{a.agent_name}</Text>
            <Text style={s.recentTitle} numberOfLines={1}>{a.title}</Text>
            <Text style={s.actTime}>{timeAgo(a.created_at)}</Text>
          </View>
        );
      }) : (
        <Text style={s.emptyInline}>No activity recorded yet — connect an agent to begin</Text>
      )}

      {/* ── Next badge target (always shows) ─── */}
      <View style={s.badgeTarget}>
        {reward.nextBadge ? (
          <Text style={s.badgeTargetText}>
            {reward.earnedCount}/{reward.totalBadges} badges · {reward.progressPct}% → {reward.nextBadge.name.toUpperCase()} @ {formatPoints(reward.nextBadge.pointsRequired)} XP
          </Text>
        ) : (
          <Text style={[s.badgeTargetText, { color: '#16a34a' }]}>
            {reward.earnedCount}/{reward.totalBadges} badges · ALL RANKS ACHIEVED · {formatPoints(reward.lifetimeXP)} XP
          </Text>
        )}
      </View>

      {/* ── Message flow ─── */}
      {(todayMsgsIn > 0 || todayMsgsOut > 0) && (
        <View style={s.msgFlowRow}>
          <Text style={s.msgFlowItem}>↓ IN <Text style={{ color: '#6366f1' }}>{todayMsgsIn}</Text></Text>
          <Text style={s.msgFlowItem}>↑ OUT <Text style={{ color: '#6366f1' }}>{todayMsgsOut}</Text></Text>
          <Text style={s.msgFlowItem}>NET <Text style={{ color: '#888' }}>{todayMsgsIn + todayMsgsOut}</Text></Text>
        </View>
      )}
    </ScrollView>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.metricCell}>
      <Text style={[s.metricVal, { color }]}>{value}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

// ── SLIDE 2: ACTIVITY (live actions + status history) ─────────────────────

function ActivityView({
  agents, statusHistory, activities,
}: { agents: OfficeAgent[]; statusHistory: Array<OfficeAgent[]>; activities: AgentActivity[] }) {
  // Merge local agent actions + Supabase activity into one feed
  const localActions = agents
    .filter(a => a.status !== 'offline')
    .flatMap(a => a.recentActions.slice(0, 2).map(act => ({
      key: `local-${a.id}-${act}`,
      icon: '📡',
      agent: a.name,
      color: a.color,
      text: act,
      time: '',
    })));

  const remoteActions = activities.slice(0, 20).map(a => ({
    key: a.id,
    icon: SOURCE_ICONS[a.source] ?? '📡',
    agent: a.agent_name,
    color: TYPE_ICONS[a.activity_type]?.color ?? '#888',
    text: a.title,
    time: timeAgo(a.created_at),
  }));

  const merged = [...localActions, ...remoteActions].slice(0, 25);

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} onStartShouldSetResponder={() => true}>
      {merged.length === 0
        ? <Text style={s.empty}>No activity yet</Text>
        : merged.map(item => (
          <View key={item.key} style={s.actRow}>
            <Text style={s.actIcon}>{item.icon}</Text>
            <Text style={[s.actAgent, { color: item.color }]}>{item.agent}</Text>
            <Text style={s.actText} numberOfLines={1}>{item.text}</Text>
            {!!item.time && <Text style={s.actTime}>{item.time}</Text>}
          </View>
        ))
      }

      {/* Status history snapshots */}
      {statusHistory.length > 0 && (
        <>
          <Text style={s.sectionDivider}>── SNAPSHOTS ──</Text>
          {[...statusHistory].reverse().slice(0, 5).map((snap, i) => (
            <View key={i} style={s.snapBlock}>
              <Text style={s.snapLabel}>#{statusHistory.length - i}</Text>
              {snap.map(a => (
                <View key={a.id} style={s.snapRow}>
                  <View style={[s.dot4, { backgroundColor: STATUS_COLORS[a.status] }]} />
                  <Text style={s.snapName}>{a.name}</Text>
                  <Text style={s.snapStatus}>{a.status.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ── SLIDE 3: OPS (real stats + cron) ─────────────────────────────────────

function OpsView({ cronJobs, activities }: { cronJobs: CronJob[]; activities: AgentActivity[] }) {
  const enabled  = cronJobs.filter(j => j.enabled);
  const disabled = cronJobs.filter(j => !j.enabled);
  const sorted   = [...enabled, ...disabled];

  const cronLogs = activities.filter(a => a.source === 'cron').slice(0, 6);

  // ── Real Ops Stats ──
  const completed  = activities.filter(a => a.activity_type === 'task_completed').length;
  const failed     = activities.filter(a => a.activity_type === 'task_failed').length;
  const toolCalls  = activities.filter(a => a.activity_type === 'tool_call').length;
  const totalTasks = completed + failed;
  const successPct = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : null;

  // Busiest agent
  const agentCounts: Record<string, number> = {};
  for (const a of activities) agentCounts[a.agent_name] = (agentCounts[a.agent_name] ?? 0) + 1;
  const busiestAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0];

  // Uptime from first activity
  const oldest = activities.length ? activities[activities.length - 1] : null;
  let uptimeStr = '—';
  if (oldest) {
    const diff = Date.now() - new Date(oldest.created_at).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Error rate by source
  const errorsBySource: Record<string, number> = {};
  for (const a of activities.filter(x => x.activity_type === 'task_failed')) {
    errorsBySource[a.source] = (errorsBySource[a.source] ?? 0) + 1;
  }

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} onStartShouldSetResponder={() => true}>

      {/* Live Stats grid */}
      <Text style={s.sectionLabel}>OPS METRICS</Text>
      <View style={s.opsGrid}>
        <OpsMetric label="COMPLETED"  value={String(completed)}  color="#22c55e" />
        <OpsMetric label="FAILED"     value={String(failed)}     color="#ef4444" />
        <OpsMetric label="TOOL CALLS" value={String(toolCalls)}  color="#ec4899" />
        <OpsMetric label="SUCCESS"    value={successPct !== null ? `${successPct}%` : '—'} color="#6366f1" />
        <OpsMetric label="UPTIME"     value={uptimeStr}          color="#b45309" />
        <OpsMetric label="LOG SIZE"   value={String(activities.length)} color="#6b7280" />
      </View>

      {/* Busiest agent + error breakdown */}
      {busiestAgent && (
        <View style={s.opsInfoRow}>
          <Text style={s.opsInfoLabel}>🔥 TOP AGENT</Text>
          <Text style={s.opsInfoVal}>{busiestAgent[0]}</Text>
          <Text style={s.opsInfoCount}>{busiestAgent[1]} events</Text>
        </View>
      )}
      {Object.keys(errorsBySource).length > 0 && (
        <View style={s.opsInfoRow}>
          <Text style={s.opsInfoLabel}>⚠ ERRORS BY SOURCE</Text>
          {Object.entries(errorsBySource).map(([src, cnt]) => (
            <Text key={src} style={s.opsErrItem}>{src}: {cnt}</Text>
          ))}
        </View>
      )}

      {/* Cron jobs */}
      {sorted.length > 0 && (
        <>
          <Text style={s.sectionLabel}>CRON  {enabled.length} on / {disabled.length} off</Text>
          {sorted.map(job => (
            <View key={job.id} style={s.cronRow}>
              <View style={[s.dot4, { backgroundColor: job.enabled ? '#22c55e' : '#6b7280' }]} />
              <Text style={[s.cronName, !job.enabled && s.cronOff]} numberOfLines={1}>
                {job.name || job.id.slice(0, 10)}
              </Text>
              <Text style={s.cronSched}>{job.schedule?.expr || job.schedule?.kind || ''}</Text>
            </View>
          ))}
        </>
      )}

      {/* Recent cron logs from Supabase */}
      {cronLogs.length > 0 && (
        <>
          <Text style={s.sectionLabel}>RECENT CRON RUNS</Text>
          {cronLogs.map(a => (
            <View key={a.id} style={s.cronLogRow}>
              <Text style={[s.cronLogIcon, {
                color: a.status === 'completed' ? '#10B981' : a.status === 'failed' ? '#EF4444' : '#F59E0B'
              }]}>
                {a.status === 'completed' ? '✓' : a.status === 'failed' ? '✗' : '▶'}
              </Text>
              <Text style={s.cronLogTitle} numberOfLines={1}>{a.source_detail || a.title}</Text>
              <Text style={s.actTime}>{timeAgo(a.created_at)}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function OpsMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.opsMetricBox}>
      <Text style={[s.opsMetricVal, { color }]}>{value}</Text>
      <Text style={s.opsMetricLabel}>{label}</Text>
    </View>
  );
}

// ── SLIDE 4: AGENT LOG (live + full scrollable audit by agent) ────────────

function AgentLogView({
  activities, runningTasks,
}: { activities: AgentActivity[]; runningTasks: AgentActivity[] }) {
  const agents = useMemo(() => {
    const names = new Set(activities.map(a => a.agent_name));
    return ['All', ...Array.from(names)];
  }, [activities]);

  const [selected, setSelected] = useState('All');

  const filtered = selected === 'All'
    ? activities
    : activities.filter(a => a.agent_name === selected);

  return (
    <View style={{ flex: 1 }}>
      {/* Agent filter tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabRow} onStartShouldSetResponder={() => true}>
        {agents.map(name => (
          <Pressable
            key={name}
            onPress={(e) => { e.stopPropagation?.(); setSelected(name); }}
            style={[s.tab, selected === name && s.tabActive]}
          >
            <Text style={[s.tabText, selected === name && s.tabTextActive]}>{name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Live tasks banner */}
      {runningTasks.length > 0 && (
        <View style={s.liveBanner}>
          <View style={s.liveDot} />
          <Text style={s.liveText} numberOfLines={1}>
            {runningTasks[0].title}
          </Text>
          <Text style={s.liveTime}>{timeAgo(runningTasks[0].created_at)}</Text>
        </View>
      )}

      {/* Full log */}
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} onStartShouldSetResponder={() => true}>
        {filtered.length === 0
          ? <Text style={s.empty}>No activity logged</Text>
          : filtered.map(a => {
            const ti = TYPE_ICONS[a.activity_type] ?? { icon: '·', color: '#888' };
            const srcIcon = SOURCE_ICONS[a.source] ?? '📡';
            const dateLabel = formatDate(a.created_at);
            return (
              <View key={a.id} style={s.logRow}>
                <Text style={s.logSrc}>{srcIcon}</Text>
                <View style={s.logContent}>
                  <Text style={s.logTitle} numberOfLines={2}>{a.title}</Text>
                  {a.body && <Text style={s.logBody} numberOfLines={1}>{a.body}</Text>}
                  <Text style={s.logMeta}>
                    {a.agent_name}{a.source_detail ? ` · ${a.source_detail}` : ''} · {dateLabel}
                  </Text>
                </View>
                <View style={s.logRight}>
                  <Text style={[s.logTypeIcon, { color: ti.color }]}>{ti.icon}</Text>
                  <Text style={s.actTime}>{timeAgo(a.created_at)}</Text>
                </View>
              </View>
            );
          })
        }
      </ScrollView>
    </View>
  );
}

// ── NOTES (edit mode) ────────────────────────────────────────────────────

function NotesView({ notes, noteText, setNoteText, addNote }: {
  notes: string[]; noteText: string; setNoteText: (t: string) => void; addNote: () => void;
}) {
  return (
    <View style={s.notesWrap}>
      <View style={s.noteInputRow}>
        <TextInput
          style={s.noteInput}
          value={noteText}
          onChangeText={setNoteText}
          onSubmitEditing={addNote}
          placeholder="Add a note..."
          placeholderTextColor="#999"
          maxLength={80}
        />
        <Pressable onPress={addNote} style={s.noteAdd}>
          <Text style={s.noteAddText}>+</Text>
        </Pressable>
      </View>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {notes.map((note, i) => (
          <Text key={i} style={s.noteItem} numberOfLines={1}>• {note}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  board: { position: 'absolute', left: 20, top: 6, right: 20, zIndex: 5 },
  frame: {
    width: '100%' as any,
    height: 120,
    backgroundColor: '#f5f5f0',
    borderWidth: 2,
    borderColor: '#8B7355',
    borderRadius: 2,
    padding: 5,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderBottomWidth: 1, borderBottomColor: '#ddd',
    paddingBottom: 2, marginBottom: 2,
  },
  headerIcon: { fontSize: 11 },
  headerText: { fontSize: 10, fontWeight: '800', fontFamily: 'monospace', color: '#333', letterSpacing: 1.5 },
  headerHint: { fontSize: 6, color: '#bbb', fontFamily: 'monospace', marginLeft: 'auto' },
  runningBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#F59E0B22', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4,
  },
  runningDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#F59E0B' },
  runningCount: { fontSize: 6, color: '#F59E0B', fontWeight: '800', fontFamily: 'monospace' },
  editBtn: {
    marginLeft: 4, backgroundColor: '#e8e8e0',
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  editBtnText: { fontSize: 6, fontWeight: '800', color: '#555', fontFamily: 'monospace' },
  content: { flex: 1, overflow: 'hidden' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 1 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#ccc' },
  dotActive: { backgroundColor: '#333' },
  tray: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 2 },
  marker: { width: 4, height: 14, borderRadius: 1 },
});

// Short-named inner styles to keep things tight
const s = StyleSheet.create({
  scroll: { flex: 1 },
  empty: { fontSize: 8, color: '#999', fontFamily: 'monospace', fontStyle: 'italic', textAlign: 'center', marginTop: 8 },
  sectionLabel: { fontSize: 5, color: '#aaa', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5, marginTop: 2, marginBottom: 1 },
  sectionDivider: { fontSize: 6, color: '#bbb', fontFamily: 'monospace', textAlign: 'center', marginVertical: 4 },

  // Top row — health + XP + pulse + time
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 1 },
  healthPill: {
    flexDirection: 'row', alignItems: 'center', gap: 1,
    borderWidth: 1, borderRadius: 3, paddingHorizontal: 2, paddingVertical: 0,
  },
  healthScore: { fontSize: 7, fontWeight: '900', fontFamily: 'monospace' },
  healthLabel: { fontSize: 4, fontWeight: '800', fontFamily: 'monospace' },
  xpInline: {
    flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1,
    backgroundColor: '#f0f0ec', borderRadius: 2, paddingHorizontal: 2, paddingVertical: 1,
    borderWidth: 1,
  },
  xpRankInline: { fontSize: 5, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 0.5 },
  xpTrackInline: { flex: 1, height: 3, backgroundColor: '#ddd', borderRadius: 1.5, overflow: 'hidden' },
  xpFill: { height: '100%' as any, borderRadius: 1.5 },
  xpValInline: { fontSize: 5, fontWeight: '700', fontFamily: 'monospace', color: '#555' },
  pulseWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pulseDot: { width: 3, height: 3, borderRadius: 1.5 },
  pulseText: { fontSize: 4.5, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.3 },
  timeText: { fontSize: 5, color: '#aaa', fontFamily: 'monospace', fontWeight: '700' },

  // Counts row
  countsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 1, flexWrap: 'wrap' },
  countItem: { fontSize: 5.5, color: '#888', fontFamily: 'monospace', fontWeight: '600' },
  countItemRight: { fontSize: 5, color: '#bbb', fontFamily: 'monospace', marginLeft: 'auto' },
  countDivider: { width: 1, height: 6, backgroundColor: '#ddd' },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#F59E0B15', paddingHorizontal: 3, paddingVertical: 0, borderRadius: 2 },
  liveDotSmall: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#F59E0B' },
  liveChipText: { fontSize: 4.5, color: '#F59E0B', fontWeight: '800', fontFamily: 'monospace' },

  // Grid block — 3×3
  gridBlock: { marginBottom: 1, backgroundColor: '#f8f8f4', borderRadius: 2, padding: 2, borderWidth: 1, borderColor: '#eee' },
  gridRow: { flexDirection: 'row' },
  metricCell: { flex: 1, alignItems: 'center', paddingVertical: 1 },
  metricVal: { fontSize: 8, fontWeight: '900', fontFamily: 'monospace' },
  metricLabel: { fontSize: 4, color: '#888', fontFamily: 'monospace', letterSpacing: 0.3 },

  // Sparkline
  sparkWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, marginBottom: 1, paddingVertical: 1 },
  sparkLabel: { fontSize: 4, color: '#bbb', fontFamily: 'monospace', fontWeight: '700' },
  sparkCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 12 },
  sparkBar: { width: '80%' as any, borderRadius: 0.5, minHeight: 1 },

  // Agent of the day
  aotdRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 1, paddingBottom: 1, borderBottomWidth: 1, borderBottomColor: '#eee' },
  aotdLabel: { fontSize: 5.5, color: '#333', fontFamily: 'monospace', fontWeight: '700', flex: 1 },
  aotdRole: { fontSize: 5, color: '#888', fontFamily: 'monospace' },
  aotdScore: { fontSize: 8, fontWeight: '900', fontFamily: 'monospace' },

  // Status rows
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 1 },
  dot5: { width: 5, height: 5, borderRadius: 2.5 },
  dot4: { width: 3, height: 3, borderRadius: 1.5 },
  agentName: { fontSize: 5.5, color: '#333', fontFamily: 'monospace', fontWeight: '700', width: 40 },
  agentActivity: { fontSize: 5, color: '#888', fontFamily: 'monospace', flex: 1 },
  agentEvt: { fontSize: 5, color: '#6366f1', fontFamily: 'monospace', fontWeight: '600', width: 10, textAlign: 'right' },
  agentCost: { fontSize: 5, color: '#ef4444', fontFamily: 'monospace', fontWeight: '600' },
  agentStatus: { fontSize: 4, color: '#aaa', fontFamily: 'monospace', fontWeight: '600' },

  // Empty state
  emptyBlock: { paddingVertical: 3, gap: 2 },
  emptyTitle: { fontSize: 6, color: '#888', fontFamily: 'monospace', fontWeight: '800', textAlign: 'center' },
  emptyHint: { fontSize: 5.5, color: '#aaa', fontFamily: 'monospace' },
  emptyInline: { fontSize: 5, color: '#bbb', fontFamily: 'monospace', fontStyle: 'italic', marginBottom: 1 },

  // Running tasks
  runTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 1 },
  runTaskAgent: { fontSize: 5.5, color: '#F59E0B', fontFamily: 'monospace', fontWeight: '700', width: 36 },
  runTaskTitle: { fontSize: 5, color: '#555', fontFamily: 'monospace', flex: 1 },

  // Cost bars
  costBarWrap: { marginBottom: 1 },
  costBarRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 1 },
  costBarName: { fontSize: 4.5, fontFamily: 'monospace', fontWeight: '700', width: 32 },
  costBarTrack: { flex: 1, height: 2.5, backgroundColor: '#e8e8e0', borderRadius: 1, overflow: 'hidden' },
  costBarFill: { height: '100%' as any, borderRadius: 1 },
  costBarVal: { fontSize: 4.5, color: '#888', fontFamily: 'monospace', fontWeight: '600', width: 18, textAlign: 'right' },

  // Recent activity
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 1 },
  recentIcon: { fontSize: 5.5, fontWeight: '800', width: 7 },
  recentAgent: { fontSize: 4.5, fontWeight: '700', fontFamily: 'monospace', color: '#555', width: 32 },
  recentTitle: { fontSize: 4.5, color: '#888', fontFamily: 'monospace', flex: 1 },

  // Badge target
  badgeTarget: { marginTop: 1, paddingTop: 1, borderTopWidth: 1, borderTopColor: '#eee' },
  badgeTargetText: { fontSize: 4.5, color: '#aaa', fontFamily: 'monospace', textAlign: 'center' },

  // Message flow
  msgFlowRow: { flexDirection: 'row', gap: 6, marginTop: 1 },
  msgFlowItem: { fontSize: 5, color: '#888', fontFamily: 'monospace', fontWeight: '600' },

  // Activity
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2 },
  actIcon: { fontSize: 8, width: 12 },
  actAgent: { fontSize: 7, fontWeight: '800', fontFamily: 'monospace', width: 44 },
  actText: { fontSize: 7, color: '#555', fontFamily: 'monospace', flex: 1 },
  actTime: { fontSize: 6, color: '#aaa', fontFamily: 'monospace' },

  // Snapshots
  snapBlock: { marginBottom: 3, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: '#eee' },
  snapLabel: { fontSize: 6, color: '#bbb', fontFamily: 'monospace', fontWeight: '700', marginBottom: 1 },
  snapRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 1 },
  snapName: { fontSize: 6, color: '#555', fontFamily: 'monospace', flex: 1 },
  snapStatus: { fontSize: 5, color: '#aaa', fontFamily: 'monospace', fontWeight: '600' },

  // Ops
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  taskIcon: { fontSize: 8, fontWeight: '700', width: 10 },
  taskText: { fontSize: 7, color: '#333', fontFamily: 'monospace', flex: 1 },
  taskDone: { color: '#bbb', textDecorationLine: 'line-through' },
  cronRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  cronName: { fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: '600', flex: 1 },
  cronOff: { color: '#aaa', textDecorationLine: 'line-through' },
  cronSched: { fontSize: 6, color: '#888', fontFamily: 'monospace' },
  cronLogRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  cronLogIcon: { fontSize: 8, fontWeight: '800', width: 10 },
  cronLogTitle: { fontSize: 7, color: '#555', fontFamily: 'monospace', flex: 1 },

  // Agent log
  tabRow: { maxHeight: 18, marginBottom: 3 },
  tab: {
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3,
    backgroundColor: '#e8e8e0', marginRight: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabActive: { backgroundColor: '#333' },
  tabText: { fontSize: 6, color: '#555', fontFamily: 'monospace', fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  liveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F59E0B11', borderRadius: 3, padding: 3, marginBottom: 3,
    borderWidth: 1, borderColor: '#F59E0B33',
  },
  liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#F59E0B' },
  liveText: { fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: '700', flex: 1 },
  liveTime: { fontSize: 6, color: '#F59E0B', fontFamily: 'monospace' },
  logRow: {
    flexDirection: 'row', gap: 4, marginBottom: 3,
    paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  logSrc: { fontSize: 8, width: 11, marginTop: 1 },
  logContent: { flex: 1, gap: 1 },
  logTitle: { fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: '600' },
  logBody: { fontSize: 6, color: '#888', fontFamily: 'monospace' },
  logMeta: { fontSize: 5.5, color: '#bbb', fontFamily: 'monospace' },
  logRight: { alignItems: 'flex-end', gap: 2 },
  logTypeIcon: { fontSize: 8, fontWeight: '800' },


  // OPS grid
  opsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginBottom: 4 },
  opsMetricBox: { alignItems: 'center', width: '30%' as any },
  opsMetricVal: { fontSize: 11, fontWeight: '900', fontFamily: 'monospace' },
  opsMetricLabel: { fontSize: 5, color: '#888', fontFamily: 'monospace', letterSpacing: 0.3 },
  opsInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3, flexWrap: 'wrap' },
  opsInfoLabel: { fontSize: 6, fontWeight: '800', fontFamily: 'monospace', color: '#aaa' },
  opsInfoVal: { fontSize: 7, fontWeight: '700', fontFamily: 'monospace', color: '#333' },
  opsInfoCount: { fontSize: 6, fontFamily: 'monospace', color: '#888' },
  opsErrItem: { fontSize: 6, fontFamily: 'monospace', color: '#ef4444', marginLeft: 4 },

  // Notes
  notesWrap: { flex: 1 },
  noteInputRow: { flexDirection: 'row', gap: 4, marginBottom: 3 },
  noteInput: {
    flex: 1, backgroundColor: '#eee', borderRadius: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    fontSize: 7, fontFamily: 'monospace', color: '#333',
  },
  noteAdd: {
    width: 18, height: 18, borderRadius: 3, backgroundColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  noteAddText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  noteItem: { fontSize: 7, color: '#555', fontFamily: 'monospace', marginBottom: 2 },
});
