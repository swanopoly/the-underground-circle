/**
 * MissionsTab — Circle Missions: the core accountability loop
 * See docs/NEXT_LEVEL_PLAN.md Phase 1.1
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import {
  useMissions,
  useMissionDetail,
  useProofOfWork,
  createMission,
  updateMission,
  createMissionTask,
  updateMissionTask,
  deleteMissionTask,
  missionProgress,
  isOverdue,
  formatDeadline,
  powIcon,
  getMissionAnalytics,
  Mission,
  MissionTask,
  MissionStatus,
  TaskStatus,
} from '../../../lib/missions';
import { PIXEL_COLORS, GRID, pixelCard, pixelInset, pixelButton, pixelHeader, pixelLabel, pixelBody, pixelMuted, iconBoxStyle } from '../../../lib/pixelDesign';
import {
  MISSION_TEMPLATES,
  TEMPLATE_CATEGORIES,
  MissionTemplate,
  suggestedDeadline,
} from '../../../lib/missionTemplates';
import { backfillGitHubProof } from '../../../lib/proofOfWork';
import { addProofOfWork } from '../../../lib/missions';
import { dispatchTaskToAgent } from '../../../lib/missionAgentDispatch';
import { useToast } from '../../../components/Toast';
import { useMissionStreak } from '../../../lib/missionStreaks';
import { notifyMissionComplete, notifyStreakMilestone } from '../../../lib/notifications';
import { suggestBestAgent } from '../../../lib/agentRouting';
import MissionCelebration from '../../../components/MissionCelebration';

interface Props {
  circleId: string;
  accentColor?: string;
}

// ─── Proof Quick Add ─────────────────────────────────────────────────────────

function ProofQuickAdd({ circleId, accentColor }: { circleId: string; accentColor: string }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      await addProofOfWork({
        circle_id: circleId,
        user_id: user?.id,
        pow_type: 'manual',
        title: text.trim(),
      });
      setText('');
    } catch {}
    setSaving(false);
  };

  return (
    <View style={styles.proofQuickAdd}>
      <TextInput
        style={styles.proofQuickInput}
        placeholder="What did you ship?"
        placeholderTextColor={PIXEL_COLORS.text3}
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        returnKeyType="send"
        maxLength={200}
      />
      <Pressable
        style={[styles.proofQuickBtn, { backgroundColor: text.trim() ? accentColor : PIXEL_COLORS.bg3 }]}
        onPress={handleSubmit}
        disabled={saving || !text.trim()}
      >
        <Text style={styles.proofQuickBtnText}>{saving ? '..' : 'Log'}</Text>
      </Pressable>
    </View>
  );
}

// ─── Daily Focus ─────────────────────────────────────────────────────────────

function DailyFocus({ missions, streak, accentColor, onSelectMission }: {
  missions: Mission[];
  streak: { currentStreak: number; totalTasksCompleted: number } | null;
  accentColor: string;
  onSelectMission: (id: string) => void;
}) {
  const { useMissionDetail: _unused, ...rest } = {} as any; // avoid import
  // Find the most urgent mission (overdue first, then closest deadline)
  const sorted = [...missions].sort((a, b) => {
    const aOverdue = isOverdue(a) ? 0 : 1;
    const bOverdue = isOverdue(b) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    return 0;
  });
  const top = sorted[0];
  if (!top) return null;

  const nudges = [
    'Ship something today.',
    'Small progress > no progress.',
    'Your circle is watching.',
    'One task at a time.',
    'Build momentum.',
  ];
  const nudge = nudges[Math.floor(Date.now() / 86400000) % nudges.length];

  return (
    <Pressable
      style={[styles.focusCard, { borderLeftColor: isOverdue(top) ? PIXEL_COLORS.red : accentColor }]}
      onPress={() => onSelectMission(top.id)}
    >
      <View style={styles.focusRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.focusLabel}>FOCUS</Text>
          <Text style={styles.focusTitle} numberOfLines={1}>{top.title}</Text>
          <Text style={styles.focusDeadline}>
            {formatDeadline(top.deadline)}
            {streak && streak.currentStreak > 0 ? ` · ${streak.currentStreak}d streak` : ''}
          </Text>
        </View>
        <Text style={[styles.focusArrow, { color: accentColor }]}>{'>'}</Text>
      </View>
      <Text style={styles.focusNudge}>{nudge}</Text>
    </Pressable>
  );
}

// ─── Progress Ring (web SVG) ─────────────────────────────────────────────────

function ProgressRing({ progress, size = 36, strokeWidth = 3, color }: {
  progress: number; size?: number; strokeWidth?: number; color: string;
}) {
  if (Platform.OS !== 'web') {
    // Native fallback — simple percentage text
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: strokeWidth, borderColor: color + '30', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color, fontSize: 10, fontWeight: '700', fontFamily: 'monospace' }}>{progress}%</Text>
      </View>
    );
  }
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <View style={{ width: size, height: size }}>
      {/* @ts-ignore — SVG works on web */}
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color + '20'} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' } as any} />
      </svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color, fontSize: 9, fontWeight: '700', fontFamily: 'monospace' }}>{progress}%</Text>
      </View>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function proofTypeColor(type: string): string {
  switch (type) {
    case 'commit': return PIXEL_COLORS.cyan;
    case 'pr': return PIXEL_COLORS.purple;
    case 'deploy': return PIXEL_COLORS.amber;
    case 'agent_run': return PIXEL_COLORS.green;
    case 'checkin': return PIXEL_COLORS.indigo;
    default: return PIXEL_COLORS.text2;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Status colors + labels ──────────────────────────────────────────────────

const STATUS_COLORS: Record<MissionStatus, string> = {
  draft: PIXEL_COLORS.text2,
  active: PIXEL_COLORS.indigo,
  completed: PIXEL_COLORS.green,
  archived: PIXEL_COLORS.text3,
};

const STATUS_LABELS: Record<MissionStatus, string> = {
  draft: 'DRAFT',
  active: 'ACTIVE',
  completed: 'DONE',
  archived: 'ARCHIVED',
};

const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: PIXEL_COLORS.text2,
  in_progress: PIXEL_COLORS.amber,
  done: PIXEL_COLORS.green,
  blocked: PIXEL_COLORS.red,
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function MissionsTab({ circleId, accentColor = PIXEL_COLORS.indigo }: Props) {
  const { missions, loading } = useMissions(circleId);
  const { entries: proofEntries, loading: proofLoading } = useProofOfWork(circleId);
  const [mainUserId, setMainUserId] = useState<string | null>(null);
  const { streak: mainStreak } = useMissionStreak(mainUserId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [showProof, setShowProof] = useState(false);

  const [analytics, setAnalytics] = useState<{ completionRate: number; completedTasks: number; totalTasks: number; overdueCount: number } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMainUserId(data.user?.id || null)).catch(() => {});
    getMissionAnalytics(circleId).then(a => setAnalytics(a)).catch(() => {});
  }, [circleId]);

  const filtered = missions.filter(m => {
    if (filter === 'active') return m.status === 'active';
    if (filter === 'completed') return m.status === 'completed';
    return true;
  });

  if (selectedId) {
    return (
      <MissionDetail
        missionId={selectedId}
        circleId={circleId}
        accentColor={accentColor}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <View style={styles.container} nativeID="section-missions-list">
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>MISSIONS</Text>
          <Text style={styles.subtitle}>
            {missions.filter(m => m.status === 'active').length} active
            {missions.filter(m => m.status === 'completed').length > 0 &&
              ` · ${missions.filter(m => m.status === 'completed').length} completed`}
            {mainStreak && mainStreak.currentStreak > 0 &&
              ` · ${mainStreak.currentStreak}d streak`}
          </Text>
        </View>
        <Pressable
          style={[styles.createBtn, { backgroundColor: accentColor }]}
          onPress={() => setShowCreate(true)}
        >
          <Text style={styles.createBtnText}>+ NEW MISSION</Text>
        </Pressable>
      </View>

      {/* Daily Focus — what to work on right now */}
      {missions.filter(m => m.status === 'active').length > 0 && (
        <DailyFocus
          missions={missions.filter(m => m.status === 'active')}
          streak={mainStreak}
          accentColor={accentColor}
          onSelectMission={setSelectedId}
        />
      )}

      {/* Analytics bar */}
      {analytics && analytics.totalTasks > 0 && (
        <View style={styles.analyticsRow}>
          <View style={styles.analyticItem}>
            <Text style={styles.analyticValue}>{analytics.completionRate}%</Text>
            <Text style={styles.analyticLabel}>done</Text>
          </View>
          <View style={styles.analyticItem}>
            <Text style={styles.analyticValue}>{analytics.completedTasks}/{analytics.totalTasks}</Text>
            <Text style={styles.analyticLabel}>tasks</Text>
          </View>
          {analytics.overdueCount > 0 && (
            <View style={styles.analyticItem}>
              <Text style={[styles.analyticValue, { color: PIXEL_COLORS.red }]}>{analytics.overdueCount}</Text>
              <Text style={styles.analyticLabel}>overdue</Text>
            </View>
          )}
        </View>
      )}

      {/* Filters */}
      <View style={styles.filterRow}>
        {(['all', 'active', 'completed'] as const).map(f => (
          <Pressable
            key={f}
            style={[styles.filterPill, filter === f && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && { color: accentColor }]}>
              {f.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Mission list */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={accentColor} />
          </View>
        )}

        {!loading && filtered.length === 0 && (
          <View style={styles.emptyState} nativeID="section-missions-empty">
            <View style={[iconBoxStyle(accentColor, 48)]}>
              <Text style={{ color: accentColor, fontSize: 20, fontWeight: '700', fontFamily: 'monospace' }}>!</Text>
            </View>
            <Text style={styles.emptyTitle}>No missions yet</Text>
            <Text style={styles.emptySubtext}>
              Create a mission to set a goal for your circle.{'\n'}
              Assign tasks to members and agents, track progress, ship together.
            </Text>
            <Pressable
              style={[styles.createBtn, { backgroundColor: accentColor, marginTop: GRID.lg }]}
              onPress={() => setShowCreate(true)}
            >
              <Text style={styles.createBtnText}>CREATE YOUR FIRST MISSION</Text>
            </Pressable>
          </View>
        )}

        {filtered.map(mission => (
          <MissionCard
            key={mission.id}
            mission={mission}
            accentColor={accentColor}
            onPress={() => setSelectedId(mission.id)}
          />
        ))}

        {/* ── Proof-of-Work Feed ── */}
        <Pressable
          style={styles.proofToggle}
          onPress={() => setShowProof(!showProof)}
          nativeID="section-proof-of-work"
        >
          <View style={[iconBoxStyle(PIXEL_COLORS.green, 28)]}>
            <Text style={{ color: PIXEL_COLORS.green, fontSize: 12, fontWeight: '700', fontFamily: 'monospace' }}>#</Text>
          </View>
          <Text style={styles.proofToggleText}>PROOF OF WORK</Text>
          <Text style={styles.proofToggleCount}>{proofEntries.length}</Text>
          <Text style={styles.proofToggleArrow}>{showProof ? '−' : '+'}</Text>
        </Pressable>

        {showProof && (
          <View style={styles.proofSection}>
            {/* Quick log work input */}
            <ProofQuickAdd circleId={circleId} accentColor={accentColor} />

            {proofLoading && <ActivityIndicator color={accentColor} size="small" />}
            {!proofLoading && proofEntries.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: GRID.lg }}>
                <Text style={[pixelMuted, { textAlign: 'center', marginBottom: GRID.md }]}>
                  No proof yet. Log what you shipped, connect GitHub, or complete tasks.
                </Text>
                <Pressable
                  style={[styles.actionBtn, { borderColor: accentColor + '40' }]}
                  onPress={async () => {
                    const count = await backfillGitHubProof(circleId);
                    if (count > 0) {
                      // Refresh will happen via realtime subscription
                    }
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: accentColor }]}>Import GitHub History</Text>
                </Pressable>
              </View>
            )}
            {proofEntries.slice(0, 20).map(entry => (
              <View key={entry.id} style={styles.proofRow}>
                <View style={[styles.proofIcon, { backgroundColor: proofTypeColor(entry.pow_type) + '18' }]}>
                  <Text style={{ color: proofTypeColor(entry.pow_type), fontSize: 11, fontWeight: '700', fontFamily: 'monospace' }}>
                    {powIcon(entry.pow_type)}
                  </Text>
                </View>
                <View style={styles.proofContent}>
                  <Text style={styles.proofTitle} numberOfLines={2}>{entry.title}</Text>
                  <Text style={styles.proofTime}>{timeAgo(entry.created_at)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Create modal */}
      {showCreate && (
        <CreateMissionModal
          circleId={circleId}
          accentColor={accentColor}
          onClose={() => setShowCreate(false)}
        />
      )}
    </View>
  );
}

// ─── Mission Card ────────────────────────────────────────────────────────────

function MissionCard({ mission, accentColor, onPress }: {
  mission: Mission; accentColor: string; onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { tasks } = useMissionDetail(mission.id);
  const progress = missionProgress(tasks);
  const overdue = isOverdue(mission);
  const statusColor = STATUS_COLORS[mission.status];

  return (
    <Pressable
      style={[styles.card, hovered && { borderColor: accentColor + '40' }]}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      {/* Top row: status + deadline */}
      <View style={styles.cardTopRow}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {STATUS_LABELS[mission.status]}
          </Text>
        </View>
        <Text style={[styles.deadlineText, overdue && { color: PIXEL_COLORS.red }]}>
          {formatDeadline(mission.deadline)}
        </Text>
      </View>

      {/* Title */}
      <Text style={styles.cardTitle} numberOfLines={2}>{mission.title}</Text>

      {/* Description */}
      {mission.description && (
        <Text style={styles.cardDesc} numberOfLines={2}>{mission.description}</Text>
      )}

      {/* Progress ring + bar */}
      {tasks.length > 0 && (
        <View style={[styles.progressSection, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <ProgressRing
            progress={progress}
            color={mission.status === 'completed' ? PIXEL_COLORS.green : accentColor}
            size={34}
            strokeWidth={3}
          />
          <View style={{ flex: 1 }}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, {
                width: `${progress}%` as any,
                backgroundColor: mission.status === 'completed' ? PIXEL_COLORS.green : accentColor,
              }]} />
            </View>
            <Text style={styles.progressLabel}>
              {tasks.filter(t => t.status === 'done').length}/{tasks.length} tasks
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// ─── Mission Detail ──────────────────────────────────────────────────────────

interface CircleMember {
  user_id: string;
  display_name: string;
  username: string;
}

function MissionDetail({ missionId, circleId, accentColor, onBack }: {
  missionId: string; circleId: string; accentColor: string; onBack: () => void;
}) {
  const { mission, tasks, agents, loading, refresh } = useMissionDetail(missionId);
  const { show: showToast } = useToast();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { streak, recordCompletion } = useMissionStreak(currentUserId);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // Get current user ID for streaks
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || null)).catch(() => {});
  }, []);
  const [addingTask, setAddingTask] = useState(false);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDeadline, setEditDeadline] = useState('');
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<{ taskId: string; text: string } | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  // Load circle members for assignment
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('circle_members')
        .select('user_id, profiles(display_name, username)')
        .eq('circle_id', circleId);
      if (data) {
        setMembers(data.map((m: any) => ({
          user_id: m.user_id,
          display_name: m.profiles?.display_name || m.profiles?.username || 'Unknown',
          username: m.profiles?.username || '',
        })));
      }
    })().catch(() => {});
  }, [circleId]);

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    setAddingTask(true);
    // Support "title | description" format
    const parts = newTaskTitle.split('|').map(s => s.trim());
    const title = parts[0];
    const description = parts[1] || undefined;
    await createMissionTask(missionId, title, { description });
    setNewTaskTitle('');
    setAddingTask(false);
    refresh();
  };

  const handleToggleTask = async (task: MissionTask) => {
    const next: TaskStatus = task.status === 'done' ? 'pending' : 'done';
    await updateMissionTask(task.id, { status: next });
    refresh();

    // Toast + streak + proof-of-work when task is completed
    if (next === 'done') {
      showToast(`Completed: ${task.title}`, 'success');
      // Update mission streak
      const streakResult = recordCompletion();
      if (streakResult?.bonusXP) {
        showToast(`Streak ${streakResult.streak.currentStreak}d +${streakResult.bonusXP} XP`, 'info');
      }
      if (streakResult?.milestoneReached) {
        showToast(`Milestone: ${streakResult.milestoneReached}!`, 'warning');
        notifyStreakMilestone(streakResult.streak.currentStreak, streakResult.milestoneReached).catch(() => {});
      }
    }
    if (next === 'done' && mission) {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      addProofOfWork({
        circle_id: circleId,
        mission_id: missionId,
        user_id: user?.id,
        agent_name: task.agent_name || undefined,
        pow_type: 'manual',
        title: `Completed: ${task.title}`,
        detail: { mission: mission.title, task_id: task.id },
      }).catch(() => {}); // non-blocking
    }

    // Auto-complete mission if all tasks done
    if (next === 'done') {
      const allDone = tasks.every(t => t.id === task.id ? true : t.status === 'done');
      if (allDone && mission?.status === 'active') {
        await updateMission(missionId, { status: 'completed' });
        showToast(`Mission complete: ${mission.title}`, 'success');
        notifyMissionComplete(mission.title).catch(() => {});
        setCelebrating(true);
        // Proof for mission completion
        addProofOfWork({
          circle_id: circleId,
          mission_id: missionId,
          pow_type: 'manual',
          title: `Mission complete: ${mission.title}`,
          detail: { tasks_completed: tasks.length },
        }).catch(() => {});
        refresh();
      }
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    await deleteMissionTask(taskId);
    refresh();
  };

  const progress = missionProgress(tasks);

  if (loading || !mission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={accentColor} style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.container} nativeID="section-mission-detail">
      {/* Mission completion celebration */}
      {celebrating && mission && (
        <MissionCelebration
          missionTitle={mission.title}
          taskCount={tasks.length}
          onDismiss={() => setCelebrating(false)}
        />
      )}

      {/* Back button + title */}
      <View style={styles.detailHeader}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>{'<'} Back</Text>
        </Pressable>
        <View style={[styles.statusBadge, {
          backgroundColor: STATUS_COLORS[mission.status] + '20',
          borderColor: STATUS_COLORS[mission.status] + '40',
        }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[mission.status] }]}>
            {STATUS_LABELS[mission.status]}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.detailContent}>
        {/* Title — tap to edit */}
        {editing ? (
          <View style={{ gap: GRID.sm }}>
            <TextInput
              style={[styles.input, { fontSize: 18, fontWeight: '800', color: PIXEL_COLORS.text0 }]}
              value={editTitle}
              onChangeText={setEditTitle}
              autoFocus
            />
            <TextInput
              style={[styles.input, styles.inputMultiline, { fontSize: 14 }]}
              value={editDesc}
              onChangeText={setEditDesc}
              multiline
              placeholder="Description"
              placeholderTextColor={PIXEL_COLORS.text3}
            />
            <TextInput
              style={styles.input}
              value={editDeadline}
              onChangeText={setEditDeadline}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={PIXEL_COLORS.text3}
            />
            <View style={{ flexDirection: 'row', gap: GRID.sm }}>
              <Pressable
                style={[styles.createBtn, { backgroundColor: accentColor }]}
                onPress={async () => {
                  await updateMission(missionId, {
                    title: editTitle.trim() || mission.title,
                    description: editDesc.trim() || null,
                    deadline: editDeadline || null,
                  });
                  setEditing(false);
                  refresh();
                }}
              >
                <Text style={styles.createBtnText}>Save</Text>
              </Pressable>
              <Pressable style={styles.cancelBtn} onPress={() => setEditing(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => {
            setEditTitle(mission.title);
            setEditDesc(mission.description || '');
            setEditDeadline(mission.deadline?.split('T')[0] || '');
            setEditing(true);
          }}>
            <Text style={styles.detailTitle}>{mission.title}</Text>
            {mission.description && (
              <Text style={styles.detailDesc}>{mission.description}</Text>
            )}
          </Pressable>
        )}

        {/* Meta row */}
        <View style={styles.metaRow}>
          <Text style={styles.metaItem}>
            {formatDeadline(mission.deadline)}
          </Text>
          <Text style={styles.metaItem}>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </Text>
          {agents.length > 0 && (
            <Text style={styles.metaItem}>
              {agents.length} agent{agents.length !== 1 ? 's' : ''}
            </Text>
          )}
          {!editing && (
            <Pressable onPress={() => {
              setEditTitle(mission.title);
              setEditDesc(mission.description || '');
              setEditDeadline(mission.deadline?.split('T')[0] || '');
              setEditing(true);
            }}>
              <Text style={[styles.metaItem, { color: accentColor }]}>Edit</Text>
            </Pressable>
          )}
        </View>

        {/* Progress */}
        <View style={styles.progressSection}>
          <View style={styles.progressBarBgLarge}>
            <View style={[styles.progressBarFill, {
              width: `${progress}%` as any,
              backgroundColor: mission.status === 'completed' ? PIXEL_COLORS.green : accentColor,
              height: 8,
              borderRadius: 4,
            }]} />
          </View>
          <Text style={[styles.progressLabel, { fontSize: 13 }]}>{progress}% complete</Text>
        </View>

        {/* Quick actions */}
        {mission.status === 'active' && (
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionBtn, { borderColor: PIXEL_COLORS.green + '40' }]}
              onPress={async () => {
                await updateMission(missionId, { status: 'completed' });
                refresh();
              }}
            >
              <Text style={[styles.actionBtnText, { color: PIXEL_COLORS.green }]}>Mark Complete</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, { borderColor: PIXEL_COLORS.text2 + '40' }]}
              onPress={async () => {
                await updateMission(missionId, { status: 'archived' });
                onBack();
              }}
            >
              <Text style={[styles.actionBtnText, { color: PIXEL_COLORS.text2 }]}>Archive</Text>
            </Pressable>
          </View>
        )}
        {mission.status === 'completed' && (
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionBtn, { borderColor: accentColor + '40' }]}
              onPress={async () => {
                await updateMission(missionId, { status: 'active' });
                refresh();
              }}
            >
              <Text style={[styles.actionBtnText, { color: accentColor }]}>Reopen</Text>
            </Pressable>
          </View>
        )}

        {/* ── TASKS ── */}
        <Text style={[pixelLabel, { marginTop: GRID.xl, marginBottom: GRID.sm }]}>TASKS</Text>

        {tasks.map(task => (
          <View key={task.id} style={styles.taskRow}>
            <Pressable
              style={[styles.checkbox, task.status === 'done' && { backgroundColor: PIXEL_COLORS.green + '20', borderColor: PIXEL_COLORS.green }]}
              onPress={() => handleToggleTask(task)}
            >
              {task.status === 'done' && <Text style={{ color: PIXEL_COLORS.green, fontSize: 12, fontWeight: '700' }}>{'✓'}</Text>}
            </Pressable>
            <Pressable style={styles.taskContent} onPress={() => setAssigningTaskId(assigningTaskId === task.id ? null : task.id)}>
              <Text style={[styles.taskTitle, task.status === 'done' && styles.taskTitleDone]}>
                {task.title}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                {task.agent_name && (
                  <Text style={styles.taskAgent}>{task.agent_name}</Text>
                )}
                {task.assignee_id && (
                  <Text style={[styles.taskAgent, { color: PIXEL_COLORS.cyan }]}>
                    {members.find(m => m.user_id === task.assignee_id)?.display_name || 'assigned'}
                  </Text>
                )}
                {!task.assignee_id && !task.agent_name && (
                  <Text style={[styles.taskAgent, { color: PIXEL_COLORS.text3 }]}>tap to assign</Text>
                )}
              </View>
              {task.description && (
                <Text style={{ color: PIXEL_COLORS.text2, fontSize: 11, lineHeight: 16, marginTop: 3 }} numberOfLines={2}>
                  {task.description}
                </Text>
              )}
            </Pressable>
            {/* Suggest agent button — for unassigned pending tasks */}
            {!task.agent_name && !task.assignee_id && task.status !== 'done' && (
              <Pressable
                style={styles.suggestBtn}
                onPress={async () => {
                  try {
                    // Lazy-load office agents
                    const { data } = await supabase
                      .from('circle_office_agents')
                      .select('*')
                      .eq('circle_id', circleId)
                      .eq('is_published', true);
                    const agents = (data || []) as any[];
                    if (agents.length === 0) {
                      showToast('No agents available in circle', 'warning');
                      return;
                    }
                    const suggestion = await suggestBestAgent({
                      circleId,
                      agents,
                      taskTitle: task.title,
                      taskDescription: task.description || undefined,
                    });
                    if (suggestion) {
                      await updateMissionTask(task.id, { agent_name: suggestion.agent.name });
                      showToast(`Assigned ${suggestion.agent.name} (${suggestion.score}% match)`, 'info');
                      refresh();
                    } else {
                      showToast('No agent suggestion found', 'warning');
                    }
                  } catch (e: any) {
                    showToast(`Suggest error: ${e.message}`, 'error');
                  }
                }}
              >
                <Text style={styles.suggestBtnText}>?</Text>
              </Pressable>
            )}
            {/* Run with agent button — only for agent-assigned, pending tasks */}
            {task.agent_name && task.status !== 'done' && (
              <Pressable
                style={[styles.runBtn, runningTaskId === task.id && { opacity: 0.5 }]}
                disabled={runningTaskId === task.id}
                onPress={async () => {
                  if (!mission) return;
                  setRunningTaskId(task.id);
                  setAgentResult(null);
                  const result = await dispatchTaskToAgent({
                    taskId: task.id,
                    taskTitle: task.title,
                    taskDescription: task.description || undefined,
                    missionId,
                    missionTitle: mission.title,
                    circleId,
                    agentName: task.agent_name!,
                  });
                  setRunningTaskId(null);
                  if (result.success) {
                    setAgentResult({ taskId: task.id, text: result.response });
                    showToast(`${task.agent_name} completed task`, 'success');
                  } else {
                    setAgentResult({ taskId: task.id, text: `Error: ${result.error}` });
                    showToast(`Agent failed: ${result.error}`, 'error');
                  }
                  refresh();
                }}
              >
                <Text style={styles.runBtnText}>{runningTaskId === task.id ? '...' : 'Run'}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => handleDeleteTask(task.id)} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>x</Text>
            </Pressable>
          </View>
        ))}

        {/* Agent result display */}
        {agentResult && (
          <View style={styles.agentResultBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: GRID.sm }}>
              <Text style={[pixelLabel]}>AGENT RESPONSE</Text>
              <Pressable onPress={() => setAgentResult(null)}>
                <Text style={{ color: PIXEL_COLORS.text3, fontSize: 12, fontFamily: 'monospace' }}>x</Text>
              </Pressable>
            </View>
            <Text style={{ color: PIXEL_COLORS.text0, fontSize: 13, lineHeight: 20 }}>
              {agentResult.text}
            </Text>
          </View>
        )}

        {/* Member assignment dropdown */}
        {assigningTaskId && (
          <View style={styles.assignDropdown}>
            <Text style={[pixelLabel, { marginBottom: GRID.xs }]}>ASSIGN TO</Text>
            {members.map(m => (
              <Pressable
                key={m.user_id}
                style={styles.assignOption}
                onPress={async () => {
                  await updateMissionTask(assigningTaskId, { assignee_id: m.user_id });
                  setAssigningTaskId(null);
                  refresh();
                }}
              >
                <View style={[styles.assignAvatar, { backgroundColor: accentColor + '20' }]}>
                  <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700' }}>
                    {m.display_name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.assignName}>{m.display_name}</Text>
              </Pressable>
            ))}
            <Pressable
              style={styles.assignOption}
              onPress={async () => {
                await updateMissionTask(assigningTaskId, { assignee_id: null } as any);
                setAssigningTaskId(null);
                refresh();
              }}
            >
              <Text style={[styles.assignName, { color: PIXEL_COLORS.text3 }]}>Unassign</Text>
            </Pressable>
          </View>
        )}

        {/* Add task input */}
        <View style={styles.addTaskRow}>
          <TextInput
            style={styles.addTaskInput}
            placeholder="Add a task... (use | for description)"
            placeholderTextColor={PIXEL_COLORS.text3}
            value={newTaskTitle}
            onChangeText={setNewTaskTitle}
            onSubmitEditing={handleAddTask}
            returnKeyType="done"
          />
          <Pressable
            style={[styles.addTaskBtn, { backgroundColor: accentColor }]}
            onPress={handleAddTask}
            disabled={addingTask || !newTaskTitle.trim()}
          >
            <Text style={styles.addTaskBtnText}>{addingTask ? '...' : '+'}</Text>
          </Pressable>
        </View>

        {/* ── AGENTS ── */}
        {agents.length > 0 && (
          <>
            <Text style={[pixelLabel, { marginTop: GRID.xl, marginBottom: GRID.sm }]}>ASSIGNED AGENTS</Text>
            {agents.map(a => (
              <View key={a.id} style={styles.agentRow}>
                <View style={[iconBoxStyle(accentColor, 28)]}>
                  <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700', fontFamily: 'monospace' }}>$</Text>
                </View>
                <Text style={styles.agentName}>{a.agent_name}</Text>
                <View style={[styles.roleBadge, { borderColor: PIXEL_COLORS.border1 }]}>
                  <Text style={styles.roleText}>{a.role.toUpperCase()}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Create Mission Modal (with template picker) ────────────────────────────

function CreateMissionModal({ circleId, accentColor, onClose }: {
  circleId: string; accentColor: string; onClose: () => void;
}) {
  const [step, setStep] = useState<'templates' | 'form'>('templates');
  const [selectedTemplate, setSelectedTemplate] = useState<MissionTemplate | null>(null);
  const [templateFilter, setTemplateFilter] = useState('all');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handlePickTemplate = (template: MissionTemplate) => {
    setSelectedTemplate(template);
    setTitle(template.name);
    setDescription(template.description);
    setDeadline(suggestedDeadline(template));
    setStep('form');
  };

  const handleBlank = () => {
    setSelectedTemplate(null);
    setTitle('');
    setDescription('');
    setDeadline('');
    setStep('form');
  };

  const handleCreate = async () => {
    if (!title.trim()) { setError('Title required'); return; }
    setSaving(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) { setError('Not logged in'); setSaving(false); return; }

    const { mission, error: err } = await createMission(
      circleId,
      user.id,
      title.trim(),
      description.trim() || undefined,
      deadline || undefined,
      selectedTemplate?.id,
    );

    if (err || !mission) { setError(err || 'Failed to create mission'); setSaving(false); return; }

    // Auto-create tasks from template
    if (selectedTemplate) {
      for (const t of selectedTemplate.defaultTasks) {
        await createMissionTask(mission.id, t.title, { agentName: t.agentName });
      }
    }

    onClose();
  };

  const filteredTemplates = templateFilter === 'all'
    ? MISSION_TEMPLATES
    : MISSION_TEMPLATES.filter(t => t.category === templateFilter);

  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.modal, step === 'templates' && { maxWidth: 560 }]} nativeID="section-create-mission">

        {/* ── Step 1: Template Picker ── */}
        {step === 'templates' && (
          <>
            <Text style={styles.modalTitle}>NEW MISSION</Text>
            <Text style={[pixelBody, { marginBottom: GRID.md }]}>Pick a template or start from scratch.</Text>

            {/* Category filter */}
            <View style={styles.filterRow}>
              {TEMPLATE_CATEGORIES.map(c => (
                <Pressable
                  key={c.key}
                  style={[styles.filterPill, templateFilter === c.key && { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}
                  onPress={() => setTemplateFilter(c.key)}
                >
                  <Text style={[styles.filterText, templateFilter === c.key && { color: accentColor }]}>
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {/* Blank option */}
              <Pressable style={styles.templateCard} onPress={handleBlank}>
                <View style={[iconBoxStyle(PIXEL_COLORS.text2, 36)]}>
                  <Text style={{ color: PIXEL_COLORS.text2, fontSize: 16, fontWeight: '700', fontFamily: 'monospace' }}>+</Text>
                </View>
                <View style={styles.templateCardContent}>
                  <Text style={styles.templateCardTitle}>Blank Mission</Text>
                  <Text style={styles.templateCardDesc}>Start from scratch</Text>
                </View>
              </Pressable>

              {filteredTemplates.map(t => (
                <Pressable key={t.id} style={styles.templateCard} onPress={() => handlePickTemplate(t)}>
                  <View style={[iconBoxStyle(t.iconColor, 36)]}>
                    <Text style={{ color: t.iconColor, fontSize: 14, fontWeight: '700', fontFamily: 'monospace' }}>{t.icon}</Text>
                  </View>
                  <View style={styles.templateCardContent}>
                    <Text style={styles.templateCardTitle}>{t.name}</Text>
                    <Text style={styles.templateCardDesc} numberOfLines={1}>{t.description}</Text>
                    <Text style={styles.templateCardMeta}>
                      {t.defaultTasks.length} tasks · {t.suggestedDeadlineDays}d
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>

            <View style={[styles.modalActions, { marginTop: GRID.md }]}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* ── Step 2: Mission Form ── */}
        {step === 'form' && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: GRID.sm, marginBottom: GRID.lg }}>
              <Pressable onPress={() => setStep('templates')} style={styles.backBtn}>
                <Text style={styles.backBtnText}>{'<'}</Text>
              </Pressable>
              <Text style={styles.modalTitle}>
                {selectedTemplate ? selectedTemplate.name : 'NEW MISSION'}
              </Text>
            </View>

            <Text style={[pixelLabel, { marginBottom: GRID.xs }]}>TITLE</Text>
            <TextInput
              style={styles.input}
              placeholder="Ship the landing page"
              placeholderTextColor={PIXEL_COLORS.text3}
              value={title}
              onChangeText={setTitle}
              autoFocus
              maxLength={200}
            />

            <Text style={[pixelLabel, { marginTop: GRID.md, marginBottom: GRID.xs }]}>DESCRIPTION</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="What does success look like?"
              placeholderTextColor={PIXEL_COLORS.text3}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={1000}
            />

            <Text style={[pixelLabel, { marginTop: GRID.md, marginBottom: GRID.xs }]}>DEADLINE</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={PIXEL_COLORS.text3}
              value={deadline}
              onChangeText={setDeadline}
              maxLength={10}
            />

            {selectedTemplate && (
              <Text style={[pixelMuted, { marginTop: GRID.sm }]}>
                {selectedTemplate.defaultTasks.length} tasks will be auto-created from template
              </Text>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.createBtn, { backgroundColor: accentColor }]}
                onPress={handleCreate}
                disabled={saving}
              >
                <Text style={styles.createBtnText}>{saving ? 'Creating...' : 'Create Mission'}</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PIXEL_COLORS.bg0,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: GRID.md,
    paddingTop: GRID.md,
    paddingBottom: GRID.sm,
  },
  title: {
    color: PIXEL_COLORS.text0,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    color: PIXEL_COLORS.text2,
    fontSize: 12,
    marginTop: 2,
  },

  // Daily Focus
  focusCard: {
    marginHorizontal: GRID.md,
    marginBottom: GRID.sm,
    backgroundColor: PIXEL_COLORS.bg2,
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: GRID.md,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.15s' } as any : {}),
  },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
  },
  focusLabel: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  focusTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 14,
    fontWeight: '700',
  },
  focusDeadline: {
    color: PIXEL_COLORS.text2,
    fontSize: 11,
    marginTop: 2,
  },
  focusArrow: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  focusNudge: {
    color: PIXEL_COLORS.text3,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: GRID.xs,
  },

  // Analytics bar
  analyticsRow: {
    flexDirection: 'row',
    paddingHorizontal: GRID.md,
    gap: GRID.lg,
    marginBottom: GRID.sm,
  },
  analyticItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  analyticValue: {
    color: PIXEL_COLORS.text0,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  analyticLabel: {
    color: PIXEL_COLORS.text3,
    fontSize: 11,
  },

  // Filter pills
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: GRID.md,
    gap: GRID.sm,
    marginBottom: GRID.md,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.xs,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
  },
  filterText: {
    color: PIXEL_COLORS.text2,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // List
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: GRID.md,
    paddingBottom: 100,
  },
  loadingBox: {
    paddingTop: 40,
    alignItems: 'center',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: GRID.xl,
  },
  emptyTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 16,
    fontWeight: '700',
    marginTop: GRID.lg,
  },
  emptySubtext: {
    color: PIXEL_COLORS.text2,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: GRID.sm,
  },

  // Card
  card: {
    ...pixelCard,
    padding: GRID.lg,
    marginBottom: GRID.md,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'border-color 0.15s' } as any : {}),
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: GRID.sm,
  },
  statusBadge: {
    paddingHorizontal: GRID.sm,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  deadlineText: {
    color: PIXEL_COLORS.text2,
    fontSize: 11,
  },
  cardTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  cardDesc: {
    color: PIXEL_COLORS.text1,
    fontSize: 13,
    lineHeight: 19,
    marginTop: GRID.xs,
  },

  // Progress bar
  progressSection: {
    marginTop: GRID.md,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: PIXEL_COLORS.border0,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarBgLarge: {
    height: 8,
    backgroundColor: PIXEL_COLORS.border0,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },
  progressLabel: {
    color: PIXEL_COLORS.text2,
    fontSize: 11,
    marginTop: GRID.xs,
  },

  // Detail view
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GRID.lg,
    paddingTop: GRID.lg,
    gap: GRID.md,
  },
  detailContent: {
    paddingHorizontal: GRID.md,
    paddingBottom: 100,
  },
  detailTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
    marginTop: GRID.md,
  },
  detailDesc: {
    color: PIXEL_COLORS.text1,
    fontSize: 14,
    lineHeight: 22,
    marginTop: GRID.sm,
  },
  metaRow: {
    flexDirection: 'row',
    gap: GRID.lg,
    marginTop: GRID.md,
    paddingVertical: GRID.sm,
    borderTopWidth: 1,
    borderTopColor: PIXEL_COLORS.border0,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
  },
  metaItem: {
    color: PIXEL_COLORS.text2,
    fontSize: 12,
  },
  backBtn: {
    paddingVertical: GRID.xs,
    paddingRight: GRID.sm,
  },
  backBtnText: {
    color: PIXEL_COLORS.text1,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: GRID.sm,
    marginTop: GRID.lg,
  },
  actionBtn: {
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Task rows
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: GRID.sm,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
    gap: GRID.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: PIXEL_COLORS.border2,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 13,
    fontWeight: '500',
  },
  taskTitleDone: {
    color: PIXEL_COLORS.text2,
    textDecorationLine: 'line-through',
  },
  taskAgent: {
    color: PIXEL_COLORS.text3,
    fontSize: 11,
    marginTop: 2,
  },
  deleteBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteBtnText: {
    color: PIXEL_COLORS.text3,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  // Add task
  addTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    marginTop: GRID.md,
  },
  addTaskInput: {
    flex: 1,
    ...pixelInset,
    color: PIXEL_COLORS.text0,
    fontSize: 13,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  addTaskBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addTaskBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Agent rows
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: GRID.sm,
    gap: GRID.sm,
  },
  agentName: {
    color: PIXEL_COLORS.text0,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  roleBadge: {
    paddingHorizontal: GRID.sm,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleText: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Create button
  createBtn: {
    paddingHorizontal: GRID.lg,
    paddingVertical: GRID.sm,
    borderRadius: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  createBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Modal
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modal: {
    ...pixelCard,
    width: '94%',
    maxWidth: 480,
    padding: GRID.lg,
    zIndex: 101,
    maxHeight: '85%',
  },
  modalTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: GRID.lg,
  },
  input: {
    ...pixelInset,
    color: PIXEL_COLORS.text0,
    fontSize: 14,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  errorText: {
    color: PIXEL_COLORS.red,
    fontSize: 12,
    marginTop: GRID.sm,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: GRID.sm,
    marginTop: GRID.xl,
  },
  cancelBtn: {
    paddingHorizontal: GRID.lg,
    paddingVertical: GRID.sm,
    borderRadius: 10,
  },
  cancelBtnText: {
    color: PIXEL_COLORS.text2,
    fontSize: 13,
    fontWeight: '600',
  },

  // Suggest agent button
  suggestBtn: {
    paddingHorizontal: GRID.sm,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.indigo + '40',
    backgroundColor: PIXEL_COLORS.indigo + '10',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 26,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  suggestBtnText: {
    color: PIXEL_COLORS.indigo,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Run button for agent tasks
  runBtn: {
    paddingHorizontal: GRID.sm,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.green + '40',
    backgroundColor: PIXEL_COLORS.green + '10',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  runBtnText: {
    color: PIXEL_COLORS.green,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    fontFamily: 'monospace',
  },

  // Agent result display
  agentResultBox: {
    ...pixelInset,
    padding: GRID.md,
    marginTop: GRID.md,
    borderLeftWidth: 3,
    borderLeftColor: PIXEL_COLORS.green + '60',
  },

  // Assignment dropdown
  assignDropdown: {
    ...pixelInset,
    padding: GRID.md,
    marginTop: GRID.sm,
    marginBottom: GRID.sm,
  },
  assignOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingVertical: GRID.sm,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  assignAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignName: {
    color: PIXEL_COLORS.text0,
    fontSize: 13,
  },

  // Proof quick add
  proofQuickAdd: {
    flexDirection: 'row',
    gap: GRID.sm,
    marginBottom: GRID.md,
  },
  proofQuickInput: {
    flex: 1,
    ...pixelInset,
    color: PIXEL_COLORS.text0,
    fontSize: 13,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  proofQuickBtn: {
    paddingHorizontal: GRID.md,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  proofQuickBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },

  // Proof-of-Work feed
  proofToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingVertical: GRID.md,
    marginTop: GRID.xl,
    borderTopWidth: 1,
    borderTopColor: PIXEL_COLORS.border0,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  proofToggleText: {
    color: PIXEL_COLORS.text1,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    flex: 1,
  },
  proofToggleCount: {
    color: PIXEL_COLORS.text3,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  proofToggleArrow: {
    color: PIXEL_COLORS.text3,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    width: 20,
    textAlign: 'center',
  },
  proofSection: {
    marginBottom: GRID.xl,
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GRID.sm,
    paddingVertical: GRID.sm,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
  },
  proofIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  proofContent: {
    flex: 1,
  },
  proofTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 12,
    lineHeight: 18,
  },
  proofTime: {
    color: PIXEL_COLORS.text3,
    fontSize: 10,
    marginTop: 2,
  },

  // Template cards
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.md,
    paddingVertical: GRID.md,
    paddingHorizontal: GRID.sm,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  templateCardContent: {
    flex: 1,
  },
  templateCardTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 14,
    fontWeight: '600',
  },
  templateCardDesc: {
    color: PIXEL_COLORS.text2,
    fontSize: 12,
    marginTop: 2,
  },
  templateCardMeta: {
    color: PIXEL_COLORS.text3,
    fontSize: 11,
    marginTop: 2,
  },
});
