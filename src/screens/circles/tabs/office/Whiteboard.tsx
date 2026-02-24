import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Platform, ScrollView } from 'react-native';
import {
  OfficeAgent,
  WHITEBOARD_MODES,
  STATUS_COLORS,
  calculateDailyScore,
} from '../../../../lib/officeAgents';
import { CronJob } from '../../../../lib/openclawService';

interface Props {
  editable?: boolean;
  notes?: string[];
  onNotesChange?: (notes: string[]) => void;
  agents?: OfficeAgent[];
  statusHistory?: Array<OfficeAgent[]>;
  cronJobs?: CronJob[];
}

export default function Whiteboard({ editable, notes = [], onNotesChange, agents = [], statusHistory = [], cronJobs = [] }: Props) {
  const [modeIndex, setModeIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState('');
  const mode = WHITEBOARD_MODES[modeIndex];

  const cycleMode = () => {
    if (editing) return;
    setModeIndex((prev) => (prev + 1) % WHITEBOARD_MODES.length);
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
          {editable && (
            <Pressable onPress={() => setEditing(!editing)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>{editing ? 'VIEW' : 'EDIT'}</Text>
            </Pressable>
          )}
          {!editing && <Text style={styles.headerHint}>TAP TO CYCLE</Text>}
        </View>

        {/* Content */}
        <View style={styles.content}>
          {editing ? (
            <NotesView notes={notes} noteText={noteText} setNoteText={setNoteText} addNote={addNote} />
          ) : (
            <>
              {mode.key === 'status' && <StatusView agents={agents} />}
              {mode.key === 'activity' && <ActivityView agents={agents} />}
              {mode.key === 'metrics' && <MetricsView agents={agents} />}
              {mode.key === 'tasks' && <TasksView />}
              {mode.key === 'history' && <StatusHistoryView history={statusHistory} />}
              {mode.key === 'cron' && <CronJobsView jobs={cronJobs} />}
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

function NotesView({ notes, noteText, setNoteText, addNote }: {
  notes: string[]; noteText: string; setNoteText: (t: string) => void; addNote: () => void;
}) {
  return (
    <View style={styles.notesContainer}>
      <View style={styles.noteInputRow}>
        <TextInput
          style={styles.noteInput}
          value={noteText}
          onChangeText={setNoteText}
          onSubmitEditing={addNote}
          placeholder="Add a note..."
          placeholderTextColor="#999"
          maxLength={80}
        />
        <Pressable onPress={addNote} style={styles.noteAddBtn}>
          <Text style={styles.noteAddText}>+</Text>
        </Pressable>
      </View>
      {notes.map((note, i) => (
        <Text key={i} style={styles.noteItem} numberOfLines={1}>• {note}</Text>
      ))}
    </View>
  );
}

function StatusView({ agents }: { agents: OfficeAgent[] }) {
  // Find Agent of the Day
  const agentOfTheDay = useMemo(() => {
    if (agents.length === 0) return null;
    
    // Calculate scores for all agents
    const scores = agents.map(agent => ({
      agent,
      score: calculateDailyScore(agent),
    }));
    
    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);
    
    // Return top agent
    return scores[0];
  }, [agents]);

  if (agents.length === 0) return <Text style={styles.emptyText}>Connect OpenClaw to see agents</Text>;
  
  const activeCount = agents.filter(a => a.status === 'active').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;
  const errorCount = agents.filter(a => a.status === 'error').length;

  return (
    <ScrollView style={styles.statusScroll} showsVerticalScrollIndicator={false}>
      {/* Agent of the Day */}
      {agentOfTheDay && (
        <View style={styles.agentOfDaySection}>
          <Text style={styles.agentOfDayTitle}>🌟 AGENT OF THE DAY</Text>
          <View style={[styles.agentOfDayCard, { borderColor: agentOfTheDay.agent.color + '60' }]}>
            <View style={[styles.agentOfDayAvatar, { backgroundColor: agentOfTheDay.agent.color + '30' }]}>
              <Text style={[styles.agentOfDayAvatarText, { color: agentOfTheDay.agent.color }]}>
                {agentOfTheDay.agent.name.charAt(0)}
              </Text>
            </View>
            <View style={styles.agentOfDayInfo}>
              <Text style={styles.agentOfDayName}>{agentOfTheDay.agent.name}</Text>
              <Text style={styles.agentOfDayRole}>{agentOfTheDay.agent.role}</Text>
              <Text style={styles.agentOfDayStats}>
                {agentOfTheDay.agent.messagesProcessed} msgs · ${agentOfTheDay.agent.costToday.toFixed(2)}
              </Text>
            </View>
            <View style={styles.agentOfDayScore}>
              <Text style={[styles.agentOfDayScoreValue, { color: agentOfTheDay.agent.color }]}>
                {agentOfTheDay.score}
              </Text>
              <Text style={styles.agentOfDayScoreLabel}>SCORE</Text>
            </View>
          </View>
        </View>
      )}

      {/* Team Stats Summary */}
      <View style={styles.teamSummary}>
        <Text style={styles.teamSummaryLine}>🟢 Active: {activeCount}</Text>
        <Text style={styles.teamSummaryLine}>🟡 Idle: {idleCount}</Text>
        {errorCount > 0 && (
          <Text style={[styles.teamSummaryLine, { color: '#ef4444' }]}>🔴 Errors: {errorCount}</Text>
        )}
      </View>

      {/* Agent List */}
      <View style={styles.statusList}>
        {agents.map((a) => (
          <View key={a.id} style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[a.status] }]} />
            <View style={styles.statusInfo}>
              <Text style={styles.statusName}>{a.name}</Text>
              <Text style={styles.statusActivity} numberOfLines={2}>{a.activity}</Text>
            </View>
            <Text style={styles.statusLabel}>{a.status.toUpperCase()}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function ActivityView({ agents }: { agents: OfficeAgent[] }) {
  const activities = agents
    .filter((a) => a.status !== 'offline')
    .flatMap((a) => a.recentActions.slice(0, 2).map((act) => ({ agent: a.name, action: act, color: a.color })))
    .slice(0, 8);
  if (activities.length === 0) return <Text style={styles.emptyText}>No recent activity</Text>;
  return (
    <View style={styles.activityList}>
      {activities.map((item, i) => (
        <View key={i} style={styles.activityRow}>
          <View style={[styles.activityDot, { backgroundColor: item.color }]} />
          <Text style={[styles.activityAgent, { color: item.color }]}>{item.agent}</Text>
          <Text style={styles.activityAction} numberOfLines={1}>{item.action}</Text>
        </View>
      ))}
    </View>
  );
}

function MetricsView({ agents }: { agents: OfficeAgent[] }) {
  const totalMessages = agents.reduce((sum, a) => sum + a.messagesProcessed, 0);
  const activeCount = agents.filter((a) => a.status === 'active').length;
  const totalTokens = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const totalCost = agents.reduce((sum, a) => sum + a.costToday, 0);
  const metrics = [
    { label: 'SESSIONS', value: agents.length.toString(), color: '#6366f1' },
    { label: 'ACTIVE', value: `${activeCount}/${agents.length}`, color: '#22c55e' },
    { label: 'MESSAGES', value: totalMessages.toLocaleString(), color: '#f59e0b' },
    { label: 'COST TODAY', value: `$${totalCost.toFixed(2)}`, color: '#ef4444' },
    { label: 'TOKENS', value: totalTokens > 0 ? `${(totalTokens / 1000).toFixed(0)}K` : '—', color: '#ec4899' },
    { label: 'STATUS', value: agents.length > 0 ? 'LIVE' : 'OFFLINE', color: agents.length > 0 ? '#22c55e' : '#6b7280' },
  ];
  return (
    <View style={styles.metricsGrid}>
      {metrics.map((m, i) => (
        <View key={i} style={styles.metricBox}>
          <Text style={[styles.metricValue, { color: m.color }]}>{m.value}</Text>
          <Text style={styles.metricLabel}>{m.label}</Text>
        </View>
      ))}
    </View>
  );
}

function TasksView() {
  const tasks = [
    { text: 'Ship Office MVP', status: '✓', color: '#22c55e' },
    { text: 'Connect OpenClaw API', status: '▶', color: '#6366f1' },
    { text: 'DAO Treasury module', status: '○', color: '#555' },
    { text: 'Agent customization', status: '▶', color: '#f59e0b' },
    { text: 'Review check-ins', status: '✓', color: '#22c55e' },
    { text: 'Research habits paper', status: '○', color: '#555' },
  ];
  return (
    <View style={styles.taskList}>
      {tasks.map((t, i) => (
        <View key={i} style={styles.taskRow}>
          <Text style={[styles.taskStatus, { color: t.color }]}>{t.status}</Text>
          <Text style={[styles.taskText, t.status === '✓' && styles.taskDone]}>{t.text}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusHistoryView({ history }: { history: Array<OfficeAgent[]> }) {
  if (history.length === 0) return <Text style={styles.emptyText}>No status history yet — check back after a poll cycle</Text>;
  return (
    <ScrollView style={styles.historyScroll} showsVerticalScrollIndicator={false}>
      {[...history].reverse().map((snapshot, i) => (
        <View key={i} style={styles.historySnapshot}>
          <Text style={styles.historyTimestamp}>SNAPSHOT {history.length - i}</Text>
          {snapshot.map((a) => (
            <View key={a.id} style={styles.historyAgentRow}>
              <View style={[styles.historyDot, { backgroundColor: STATUS_COLORS[a.status] }]} />
              <Text style={styles.historyAgentName}>{a.name}</Text>
              <Text style={styles.historyAgentStatus}>{a.status.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function CronJobsView({ jobs }: { jobs: CronJob[] }) {
  if (jobs.length === 0) return <Text style={styles.emptyText}>No cron jobs found</Text>;
  const enabled = jobs.filter(j => j.enabled);
  const disabled = jobs.filter(j => !j.enabled);
  const sorted = [...enabled, ...disabled];
  return (
    <ScrollView style={styles.cronScroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.cronSummary}>{enabled.length} active / {disabled.length} paused</Text>
      {sorted.map((job) => {
        const sched = job.schedule?.expr || job.schedule?.kind || '';
        return (
          <View key={job.id} style={styles.cronRow}>
            <View style={[styles.cronDot, { backgroundColor: job.enabled ? '#22c55e' : '#6b7280' }]} />
            <Text style={[styles.cronName, !job.enabled && styles.cronDisabled]} numberOfLines={1}>
              {job.name || job.id.slice(0, 8)}
            </Text>
            <Text style={styles.cronSchedule} numberOfLines={1}>{sched}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  board: { position: 'absolute', left: 20, top: 8, right: 20, zIndex: 5 },
  frame: {
    width: '100%' as any,
    height: 160,
    backgroundColor: '#f5f5f0',
    borderWidth: 2,
    borderColor: '#8B7355',
    borderRadius: 2,
    padding: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    paddingBottom: 4,
    marginBottom: 4,
  },
  headerIcon: { fontSize: 11 },
  headerText: {
    fontSize: 10, fontWeight: '800', fontFamily: 'monospace', color: '#333', letterSpacing: 1.5,
  },
  headerHint: {
    fontSize: 6, color: '#bbb', fontFamily: 'monospace', marginLeft: 'auto', letterSpacing: 0.5,
  },
  editBtn: {
    marginLeft: 'auto',
    backgroundColor: '#e8e8e0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  editBtnText: { fontSize: 6, fontWeight: '800', color: '#555', fontFamily: 'monospace', letterSpacing: 0.5 },
  content: { flex: 1 },
  emptyText: { fontSize: 9, color: '#999', fontFamily: 'monospace', fontStyle: 'italic', textAlign: 'center', marginTop: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 3 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#ccc' },
  dotActive: { backgroundColor: '#333' },
  tray: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 4 },
  marker: { width: 5, height: 18, borderRadius: 1 },
  // Notes
  notesContainer: { gap: 3 },
  noteInputRow: { flexDirection: 'row', gap: 4, marginBottom: 2 },
  noteInput: {
    flex: 1, backgroundColor: '#eee', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2,
    fontSize: 7, fontFamily: 'monospace', color: '#333',
  },
  noteAddBtn: {
    width: 18, height: 18, borderRadius: 3, backgroundColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  noteAddText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  noteItem: { fontSize: 7, color: '#555', fontFamily: 'monospace' },
  // Status
  statusScroll: { flex: 1 },
  agentOfDaySection: { marginBottom: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  agentOfDayTitle: { fontSize: 6, color: '#888', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5, marginBottom: 3 },
  agentOfDayCard: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    padding: 5, backgroundColor: '#fafaf8', borderRadius: 4, borderWidth: 1,
  },
  agentOfDayAvatar: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  agentOfDayAvatarText: { fontSize: 10, fontWeight: '800', fontFamily: 'monospace' },
  agentOfDayInfo: { flex: 1 },
  agentOfDayName: { fontSize: 8, fontWeight: '700', color: '#333', fontFamily: 'monospace' },
  agentOfDayRole: { fontSize: 6, color: '#666', fontFamily: 'monospace' },
  agentOfDayStats: { fontSize: 5, color: '#999', fontFamily: 'monospace', marginTop: 1 },
  agentOfDayScore: { alignItems: 'center' },
  agentOfDayScoreValue: { fontSize: 14, fontWeight: '800', fontFamily: 'monospace' },
  agentOfDayScoreLabel: { fontSize: 5, color: '#666', fontWeight: '700', fontFamily: 'monospace', letterSpacing: 0.3 },
  teamSummary: { marginBottom: 4, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: '#eee' },
  teamSummaryLine: { fontSize: 7, color: '#555', fontFamily: 'monospace', lineHeight: 11 },
  statusList: { gap: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 2 },
  statusDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
  statusInfo: { flex: 1, gap: 1 },
  statusName: { fontSize: 8, color: '#333', fontFamily: 'monospace', fontWeight: '700' },
  statusActivity: { fontSize: 7, color: '#888', fontFamily: 'monospace', lineHeight: 10 },
  statusLabel: { fontSize: 6, color: '#aaa', fontFamily: 'monospace', fontWeight: '600', minWidth: 40, textAlign: 'right', marginTop: 2 },
  // Activity
  activityList: { gap: 2 },
  activityRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  activityDot: { width: 4, height: 4, borderRadius: 2 },
  activityAgent: { fontSize: 7, fontWeight: '800', fontFamily: 'monospace', width: 60 },
  activityAction: { fontSize: 7, color: '#555', fontFamily: 'monospace', flex: 1 },
  // Metrics
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  metricBox: { alignItems: 'center', width: '30%' as any, paddingVertical: 2 },
  metricValue: { fontSize: 12, fontWeight: '900', fontFamily: 'monospace' },
  metricLabel: { fontSize: 5.5, color: '#888', fontFamily: 'monospace', letterSpacing: 0.5 },
  // Tasks
  taskList: { gap: 2 },
  taskRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  taskStatus: { fontSize: 9, fontWeight: '700', width: 14, textAlign: 'center' },
  taskText: { fontSize: 8, color: '#333', fontFamily: 'monospace', flex: 1 },
  taskDone: { color: '#aaa', textDecorationLine: 'line-through' },
  // History
  historyScroll: { flex: 1 },
  historySnapshot: { marginBottom: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#e8e8e0' },
  historyTimestamp: { fontSize: 6, color: '#aaa', fontFamily: 'monospace', fontWeight: '700', marginBottom: 2, letterSpacing: 0.5 },
  historyAgentRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 },
  historyDot: { width: 4, height: 4, borderRadius: 2 },
  historyAgentName: { fontSize: 7, color: '#333', fontFamily: 'monospace', flex: 1 },
  historyAgentStatus: { fontSize: 6, color: '#888', fontFamily: 'monospace', fontWeight: '600' },
  // Cron
  cronScroll: { flex: 1 },
  cronSummary: { fontSize: 7, color: '#999', fontFamily: 'monospace', fontWeight: '700', marginBottom: 3, letterSpacing: 0.5 },
  cronRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  cronDot: { width: 5, height: 5, borderRadius: 2.5 },
  cronName: { fontSize: 7, color: '#333', fontFamily: 'monospace', fontWeight: '600', flex: 1 },
  cronDisabled: { color: '#999', textDecorationLine: 'line-through' },
  cronSchedule: { fontSize: 6, color: '#888', fontFamily: 'monospace' },
});
