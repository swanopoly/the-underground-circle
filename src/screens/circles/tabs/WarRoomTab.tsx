/**
 * WarRoomTab — The Underground Circle's Live Build Feed
 *
 * Everyone in the circle watching each other's AI agents build in real time.
 * Cards appear when someone posts a "Step Away" handoff.
 * Cards close when they post "Back at Keyboard."
 *
 * This is the social primitive that makes the circle feel alive.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  RefreshControl,
  Animated,
  Platform,
} from 'react-native';
import { supabase } from '../../../lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

type ToolId = 'claude-code' | 'cowork' | 'openclaw' | 'codex' | 'gemini' | 'cursor' | 'other';

type LiveSession = {
  id: string;          // message id of the step-away post
  userId: string;
  userName: string;
  tool: ToolId;
  task: string;
  goal: string;
  returnTime: string;
  sessionUrl?: string;
  budget?: string;
  startedAt: string;   // ISO timestamp
  reactions: Record<string, string[]>; // emoji → userIds
  elapsed: string;     // human-readable elapsed time
};

type CompletedSession = {
  id: string;
  userId: string;
  userName: string;
  tool: ToolId;
  task: string;
  verdict: 'shipped' | 'pivoted' | 'rolled-back' | 'still-running' | string;
  note: string;
  completedAt: string;
  duration: string;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const TOOL_META: Record<ToolId, { icon: string; label: string; color: string }> = {
  'claude-code': { icon: '💻', label: 'Claude Code', color: '#6366f1' },
  'cowork':      { icon: '💼', label: 'Cowork',      color: '#22c55e' },
  'openclaw':    { icon: '🐾', label: 'OpenClaw',    color: '#f59e0b' },
  'codex':       { icon: '🧠', label: 'Codex',       color: '#10a37f' },
  'gemini':      { icon: '♊', label: 'Gemini',       color: '#4285f4' },
  'cursor':      { icon: '🎯', label: 'Cursor',       color: '#8b5cf6' },
  'other':       { icon: '🤖', label: 'AI Agent',    color: '#06b6d4' },
};

const REACTION_OPTIONS = ['🔥', '👀', '⚡', '🚀', '⚠️', '🎉'];

const VERDICT_META: Record<string, { icon: string; color: string }> = {
  'shipped':      { icon: '✅', color: '#22c55e' },
  'pivoted':      { icon: '🔄', color: '#f59e0b' },
  'rolled-back':  { icon: '↩️', color: '#ef4444' },
  'still-running':{ icon: '⏳', color: '#6366f1' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function elapsed(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

function duration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Parse a step-away message content into structured data */
function parseStepAway(content: string): Partial<LiveSession> | null {
  if (!content.includes('STEPPING AWAY')) return null;
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const result: Partial<LiveSession> = {};

  // Extract tool from first line: "🖥️ **STEPPING AWAY** — handing off to Claude Code"
  const toolLine = lines[0] || '';
  const toolMatch = toolLine.match(/handing off to (.+)$/);
  if (toolMatch) {
    const toolLabel = toolMatch[1].toLowerCase();
    if (toolLabel.includes('claude code')) result.tool = 'claude-code';
    else if (toolLabel.includes('cowork')) result.tool = 'cowork';
    else if (toolLabel.includes('openclaw')) result.tool = 'openclaw';
    else if (toolLabel.includes('codex')) result.tool = 'codex';
    else if (toolLabel.includes('gemini')) result.tool = 'gemini';
    else if (toolLabel.includes('cursor')) result.tool = 'cursor';
    else result.tool = 'other';
  }

  for (const line of lines) {
    const taskMatch = line.match(/\*\*Task:\*\*\s*(.+)/);
    if (taskMatch) result.task = taskMatch[1];
    const goalMatch = line.match(/\*\*Goal:\*\*\s*(.+)/);
    if (goalMatch) result.goal = goalMatch[1];
    const backMatch = line.match(/\*\*Back:\*\*\s*(.+)/);
    if (backMatch) result.returnTime = backMatch[1];
    const urlMatch = line.match(/🔗 Session:\s*(https?:\/\/\S+)/);
    if (urlMatch) result.sessionUrl = urlMatch[1];
    const budgetMatch = line.match(/💰 Budget:\s*(.+)/);
    if (budgetMatch) result.budget = budgetMatch[1];
  }

  return result;
}

/** Parse a back-at-keyboard message */
function parseBackAtKeyboard(content: string): { verdict: string; note: string } | null {
  if (!content.includes('BACK AT KEYBOARD')) return null;
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  let verdict = 'shipped';
  let note = '';

  // First line: "⌨️ **BACK AT KEYBOARD** — ✅ Shipped it"
  const firstLine = lines[0] || '';
  if (firstLine.includes('Pivoted')) verdict = 'pivoted';
  else if (firstLine.includes('Rolled back')) verdict = 'rolled-back';
  else if (firstLine.includes('Still running')) verdict = 'still-running';
  else verdict = 'shipped';

  const noteMatch = content.match(/\*\*Verdict:\*\*\s*([\s\S]+)/);
  if (noteMatch) note = noteMatch[1].trim();

  return { verdict, note };
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function WarRoomTab({ circleId, accentColor = '#6366f1' }: {
  circleId: string;
  accentColor?: string;
}) {
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [completed, setCompleted] = useState<CompletedSession[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for live indicator
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Ticker to update elapsed times
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // ─── Auth ────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id || null);
    }).catch(() => {});
  }, []);

  // ─── Load Data ───────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    // Get all members for display names
    const { data: members } = await supabase
      .from('circle_members')
      .select('user:profiles(id, display_name, username)')
      .eq('circle_id', circleId);

    const map: Record<string, string> = {};
    (members || []).forEach((m: any) => {
      if (m.user) map[m.user.id] = m.user.display_name || m.user.username || 'Unknown';
    });
    setMemberMap(map);

    // Get recent messages (last 48h) — step-away and back-at-keyboard
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: messages } = await supabase
      .from('messages')
      .select('id, content, user_id, created_at, reactions')
      .eq('circle_id', circleId)
      .eq('is_bot', false)
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (!messages) return;

    // Separate step-away and back-at-keyboard messages
    const stepAwayMsgs = messages.filter(m => m.content?.includes('STEPPING AWAY'));
    const bakMsgs = messages.filter(m => m.content?.includes('BACK AT KEYBOARD'));

    // Build a map of userId → latest BAK timestamp
    const bakByUser: Record<string, { at: string; verdict: string; note: string; msgId: string }> = {};
    bakMsgs.forEach(m => {
      const parsed = parseBackAtKeyboard(m.content);
      if (!parsed) return;
      const existing = bakByUser[m.user_id];
      if (!existing || m.created_at > existing.at) {
        bakByUser[m.user_id] = { at: m.created_at, ...parsed, msgId: m.id };
      }
    });

    const live: LiveSession[] = [];
    const done: CompletedSession[] = [];

    for (const msg of stepAwayMsgs) {
      const parsed = parseStepAway(msg.content);
      if (!parsed?.task) continue;
      const userName = map[msg.user_id] || 'Unknown';
      const bak = bakByUser[msg.user_id];

      if (bak && bak.at > msg.created_at) {
        // Session is closed — add to completed
        done.unshift({
          id: msg.id,
          userId: msg.user_id,
          userName,
          tool: parsed.tool || 'other',
          task: parsed.task || '',
          verdict: bak.verdict,
          note: bak.note,
          completedAt: bak.at,
          duration: duration(msg.created_at, bak.at),
        });
      } else {
        // Session is live
        live.push({
          id: msg.id,
          userId: msg.user_id,
          userName,
          tool: parsed.tool || 'other',
          task: parsed.task || '',
          goal: parsed.goal || '',
          returnTime: parsed.returnTime || '?',
          sessionUrl: parsed.sessionUrl,
          budget: parsed.budget,
          startedAt: msg.created_at,
          reactions: msg.reactions || {},
          elapsed: elapsed(msg.created_at),
        });
      }
    }

    // Sort live by most recent first
    live.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    setLiveSessions(live);
    setCompleted(done.slice(0, 10));
  }, [circleId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Update elapsed times on tick
  useEffect(() => {
    setLiveSessions(prev => prev.map(s => ({ ...s, elapsed: elapsed(s.startedAt) })));
  }, [tick]);

  // ─── Realtime ────────────────────────────────────────────────────────────

  useEffect(() => {
    const channel = supabase
      .channel(`war-room-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `circle_id=eq.${circleId}`,
      }, () => loadSessions())
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `circle_id=eq.${circleId}`,
      }, () => loadSessions())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [circleId, loadSessions]);

  // ─── Reactions ───────────────────────────────────────────────────────────

  const handleReaction = async (sessionId: string, emoji: string) => {
    if (!currentUserId) return;

    const session = liveSessions.find(s => s.id === sessionId);
    if (!session) return;

    const current = session.reactions[emoji] || [];
    const hasReacted = current.includes(currentUserId);
    const updated = hasReacted
      ? current.filter(id => id !== currentUserId)
      : [...current, currentUserId];

    const newReactions = { ...session.reactions, [emoji]: updated };
    if (updated.length === 0) delete newReactions[emoji];

    // Optimistic update
    setLiveSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, reactions: newReactions } : s
    ));

    await supabase
      .from('messages')
      .update({ reactions: newReactions })
      .eq('id', sessionId);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const totalReactions = liveSessions.reduce((sum, s) =>
    sum + Object.values(s.reactions).reduce((r, users) => r + users.length, 0), 0
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>⚡ War Room</Text>
          <View style={styles.liveRow}>
            <Animated.View style={[styles.liveDot, { opacity: pulseAnim, backgroundColor: accentColor }]} />
            <Text style={styles.liveLabel}>
              {liveSessions.length > 0
                ? `${liveSessions.length} agent${liveSessions.length !== 1 ? 's' : ''} building live`
                : 'No active sessions'}
            </Text>
          </View>
        </View>
        {totalReactions > 0 && (
          <Text style={styles.energyCount}>🔥 {totalReactions} reactions</Text>
        )}
      </View>

      {/* Empty state */}
      {liveSessions.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🤖</Text>
          <Text style={styles.emptyTitle}>No agents building right now</Text>
          <Text style={styles.emptyText}>
            When someone in your circle steps away and hands off to Claude Code, Gemini, Codex, or any AI agent — their session appears here live.
          </Text>
          <Text style={styles.emptyHint}>
            Tap the <Text style={{ color: accentColor }}>🖥️ Step Away & Hand Off</Text> button in the Chat tab to start.
          </Text>
        </View>
      )}

      {/* Live Sessions */}
      {liveSessions.map((session) => (
        <LiveSessionCard
          key={session.id}
          session={session}
          currentUserId={currentUserId}
          accentColor={accentColor}
          onReaction={handleReaction}
        />
      ))}

      {/* Completed Sessions */}
      {completed.length > 0 && (
        <>
          <View style={styles.sectionDivider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>COMPLETED TODAY</Text>
            <View style={styles.dividerLine} />
          </View>
          {completed.map((session) => (
            <CompletedCard key={session.id} session={session} />
          ))}
        </>
      )}

    </ScrollView>
  );
}

// ─── Live Session Card ───────────────────────────────────────────────────────

function LiveSessionCard({ session, currentUserId, accentColor, onReaction }: {
  session: LiveSession;
  currentUserId: string | null;
  accentColor: string;
  onReaction: (id: string, emoji: string) => void;
}) {
  const tool = TOOL_META[session.tool] || TOOL_META['other'];
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const totalReactions = Object.values(session.reactions).reduce((sum, users) => sum + users.length, 0);

  return (
    <View style={[styles.sessionCard, { borderColor: tool.color + '44' }]}>
      {/* Card Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.toolBadge, { backgroundColor: tool.color + '22', borderColor: tool.color + '55' }]}>
            <Text style={styles.toolBadgeIcon}>{tool.icon}</Text>
            <Text style={[styles.toolBadgeLabel, { color: tool.color }]}>{tool.label}</Text>
          </View>
          <Animated.View style={[styles.livePing, { backgroundColor: tool.color, opacity: pulseAnim }]} />
        </View>
        <View style={styles.cardHeaderRight}>
          <Text style={styles.elapsedText}>⏱ {session.elapsed}</Text>
          <Text style={styles.backText}>Back: {session.returnTime}</Text>
        </View>
      </View>

      {/* Builder identity */}
      <View style={styles.builderRow}>
        <View style={[styles.builderAvatar, { backgroundColor: tool.color + '33' }]}>
          <Text style={styles.builderAvatarText}>{session.userName[0]?.toUpperCase() || '?'}</Text>
        </View>
        <View>
          <Text style={styles.builderName}>{session.userName}</Text>
          <Text style={styles.builderStatus}>is building with AI →</Text>
        </View>
      </View>

      {/* Task & Goal */}
      <View style={[styles.taskBlock, { borderLeftColor: tool.color }]}>
        <Text style={styles.taskLabel}>BUILDING</Text>
        <Text style={styles.taskText}>{session.task}</Text>
      </View>

      <View style={styles.goalBlock}>
        <Text style={styles.goalLabel}>🎯 GOAL</Text>
        <Text style={styles.goalText}>{session.goal}</Text>
      </View>

      {/* Budget if set */}
      {session.budget && (
        <Text style={styles.budgetText}>💰 Budget: {session.budget}</Text>
      )}

      {/* Session URL */}
      {session.sessionUrl && (
        <Pressable onPress={() => Linking.openURL(session.sessionUrl!)} style={styles.sessionUrlBtn}>
          <Text style={[styles.sessionUrlText, { color: tool.color }]}>🔗 Watch live on claude.ai/code →</Text>
        </Pressable>
      )}

      {/* Reactions */}
      <View style={styles.reactionsRow}>
        {REACTION_OPTIONS.map(emoji => {
          const users = session.reactions[emoji] || [];
          const hasReacted = currentUserId ? users.includes(currentUserId) : false;
          return (
            <Pressable
              key={emoji}
              onPress={() => onReaction(session.id, emoji)}
              style={[
                styles.reactionBtn,
                hasReacted && { backgroundColor: tool.color + '22', borderColor: tool.color + '55' },
              ]}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              {users.length > 0 && (
                <Text style={[styles.reactionCount, hasReacted && { color: tool.color }]}>
                  {users.length}
                </Text>
              )}
            </Pressable>
          );
        })}
        {totalReactions > 0 && (
          <Text style={styles.watchingText}>
            {totalReactions} {totalReactions === 1 ? 'person' : 'people'} watching
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Completed Session Card ──────────────────────────────────────────────────

function CompletedCard({ session }: { session: CompletedSession }) {
  const tool = TOOL_META[session.tool as ToolId] || TOOL_META['other'];
  const verdict = VERDICT_META[session.verdict] || { icon: '✅', color: '#22c55e' };

  return (
    <View style={styles.completedCard}>
      <View style={styles.completedHeader}>
        <View style={styles.completedHeaderLeft}>
          <Text style={styles.completedToolIcon}>{tool.icon}</Text>
          <Text style={styles.completedName}>{session.userName}</Text>
          <Text style={styles.completedDuration}>{session.duration}</Text>
        </View>
        <Text style={[styles.verdictBadge, { color: verdict.color }]}>
          {verdict.icon} {session.verdict}
        </Text>
      </View>
      <Text style={styles.completedTask} numberOfLines={1}>{session.task}</Text>
      {session.note ? (
        <Text style={styles.completedNote} numberOfLines={2}>{session.note}</Text>
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 16, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  headerLeft: {},
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveLabel: { color: '#666', fontSize: 13 },
  energyCount: { color: '#f59e0b', fontSize: 13, fontWeight: '600' },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptyText: { color: '#666', fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 16 },
  emptyHint: { color: '#555', fontSize: 13, lineHeight: 20, textAlign: 'center' },

  // Live Card
  sessionCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.4)' } as any : {}),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardHeaderRight: { alignItems: 'flex-end' },
  toolBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  toolBadgeIcon: { fontSize: 14 },
  toolBadgeLabel: { fontSize: 12, fontWeight: '700' },
  livePing: { width: 8, height: 8, borderRadius: 4 },
  elapsedText: { color: '#666', fontSize: 12 },
  backText: { color: '#444', fontSize: 11, marginTop: 2 },

  builderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  builderAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  builderAvatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  builderName: { color: '#ddd', fontSize: 14, fontWeight: '700' },
  builderStatus: { color: '#555', fontSize: 12 },

  taskBlock: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 10 },
  taskLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 3 },
  taskText: { color: '#e0e0e0', fontSize: 15, fontWeight: '600', lineHeight: 22 },

  goalBlock: { backgroundColor: '#000000', borderRadius: 8, padding: 10, marginBottom: 10, flexDirection: 'row', gap: 8 },
  goalLabel: { color: '#555', fontSize: 12, fontWeight: '700' },
  goalText: { color: '#aaa', fontSize: 13, flex: 1, lineHeight: 18 },

  budgetText: { color: '#666', fontSize: 12, marginBottom: 8 },

  sessionUrlBtn: { marginBottom: 14 },
  sessionUrlText: { fontSize: 13, fontWeight: '600' },

  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  reactionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#222',
    backgroundColor: '#000000',
  },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { color: '#666', fontSize: 12, fontWeight: '600' },
  watchingText: { color: '#444', fontSize: 11, marginLeft: 4, flex: 1, textAlign: 'right' },

  // Section divider
  sectionDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  dividerLabel: { color: '#333', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },

  // Completed card
  completedCard: {
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#000000',
    padding: 12,
    marginBottom: 8,
  },
  completedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  completedHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  completedToolIcon: { fontSize: 14 },
  completedName: { color: '#888', fontSize: 13, fontWeight: '600' },
  completedDuration: { color: '#444', fontSize: 11 },
  verdictBadge: { fontSize: 12, fontWeight: '700' },
  completedTask: { color: '#555', fontSize: 13, marginBottom: 4 },
  completedNote: { color: '#444', fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
});
