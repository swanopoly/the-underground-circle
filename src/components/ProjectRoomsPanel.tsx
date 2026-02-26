/**
 * ProjectRoomsPanel
 * Shows all project rooms for the circle — which agents are grouped in each room,
 * what they're working on, and a live activity feed per room.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  TextInput, ActivityIndicator, Platform,
} from 'react-native';
import {
  useProjectRooms, useRoomAgents, useRoomActivity,
  createRoom, updateRoomStatus, deleteRoom,
  ProjectRoom, RoomAgent, RoomActivity, RoomStatus,
} from '../services/projectRooms';

interface Props {
  circleId: string | null;
}

const STATUS_COLORS: Record<RoomStatus, string> = {
  active: '#10B981',
  paused: '#F59E0B',
  completed: '#6B7280',
};

const AGENT_STATUS_COLORS: Record<string, string> = {
  active: '#10B981',
  idle: '#F59E0B',
  offline: '#374151',
};

const ROOM_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#14b8a6', '#3b82f6', '#ef4444',
];

const ACTIVITY_ICONS: Record<string, { icon: string; color: string }> = {
  joined:         { icon: '→', color: '#10B981' },
  left:           { icon: '←', color: '#6B7280' },
  task_started:   { icon: '▶', color: '#F59E0B' },
  task_completed: { icon: '✓', color: '#10B981' },
  task_failed:    { icon: '✗', color: '#EF4444' },
  checkpoint:     { icon: '◆', color: '#6366f1' },
  message:        { icon: '·', color: '#9CA3AF' },
  file_changed:   { icon: '⊞', color: '#3b82f6' },
  handoff:        { icon: '⇌', color: '#ec4899' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Room Card ────────────────────────────────────────────────────────────────

function RoomCard({
  room,
  onStatusChange,
  onDelete,
}: {
  room: ProjectRoom;
  onStatusChange: (id: string, status: RoomStatus) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { agents } = useRoomAgents(room.id);
  const { activity } = useRoomActivity(expanded ? room.id : null);

  const activeAgents = agents.filter(a => a.status === 'active');
  const idleAgents = agents.filter(a => a.status === 'idle');
  const offlineAgents = agents.filter(a => a.status === 'offline');

  return (
    <View style={[s.roomCard, { borderLeftColor: room.color }]}>
      {/* Room header */}
      <Pressable style={s.roomHeader} onPress={() => setExpanded(v => !v)}>
        <View style={[s.roomColorDot, { backgroundColor: room.color }]} />
        <View style={s.roomHeaderInfo}>
          <Text style={s.roomName}>{room.name}</Text>
          {room.description ? (
            <Text style={s.roomDesc} numberOfLines={1}>{room.description}</Text>
          ) : null}
        </View>
        <View style={s.roomHeaderMeta}>
          <View style={[s.statusPill, { backgroundColor: STATUS_COLORS[room.status] + '22', borderColor: STATUS_COLORS[room.status] + '55' }]}>
            <View style={[s.statusDot, { backgroundColor: STATUS_COLORS[room.status] }]} />
            <Text style={[s.statusText, { color: STATUS_COLORS[room.status] }]}>{room.status.toUpperCase()}</Text>
          </View>
          <Text style={s.agentCount}>
            {activeAgents.length > 0 ? `${activeAgents.length} active` : agents.length > 0 ? `${agents.length} agents` : 'empty'}
          </Text>
          <Text style={s.expandChevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      {/* Agent pills always visible */}
      {agents.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.agentPillRow}>
          {agents.map(agent => (
            <View key={agent.id} style={[s.agentPill, { borderColor: AGENT_STATUS_COLORS[agent.status] + '55' }]}>
              <View style={[s.agentDot, { backgroundColor: AGENT_STATUS_COLORS[agent.status] }]} />
              <Text style={s.agentPillName}>{agent.agent_name}</Text>
              {agent.current_task && agent.status === 'active' && (
                <Text style={s.agentPillTask} numberOfLines={1}> — {agent.current_task}</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {agents.length === 0 && (
        <Text style={s.emptyAgents}>No agents in this room yet</Text>
      )}

      {/* Tags */}
      {room.tags.length > 0 && (
        <View style={s.tagRow}>
          {room.tags.map(tag => (
            <View key={tag} style={s.tag}>
              <Text style={s.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Expanded: activity feed + controls */}
      {expanded && (
        <View style={s.expandedContent}>
          {/* Activity feed */}
          <Text style={s.sectionLabel}>ACTIVITY</Text>
          <ScrollView style={s.activityScroll} showsVerticalScrollIndicator={false}>
            {activity.length === 0 ? (
              <Text style={s.emptyActivity}>No activity yet</Text>
            ) : activity.map(a => {
              const meta = ACTIVITY_ICONS[a.activity_type] ?? { icon: '·', color: '#9CA3AF' };
              return (
                <View key={a.id} style={s.activityRow}>
                  <Text style={[s.activityIcon, { color: meta.color }]}>{meta.icon}</Text>
                  <View style={s.activityContent}>
                    <Text style={s.activityTitle} numberOfLines={2}>{a.title}</Text>
                    {a.body ? <Text style={s.activityBody} numberOfLines={1}>{a.body}</Text> : null}
                    <Text style={s.activityMeta}>{a.agent_name} · {timeAgo(a.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Room controls */}
          <View style={s.roomControls}>
            {room.status !== 'completed' && (
              <Pressable
                style={[s.controlBtn, { borderColor: '#F59E0B55' }]}
                onPress={() => onStatusChange(room.id, room.status === 'active' ? 'paused' : 'active')}
              >
                <Text style={[s.controlBtnText, { color: '#F59E0B' }]}>
                  {room.status === 'active' ? 'Pause' : 'Resume'}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={[s.controlBtn, { borderColor: '#10B98155' }]}
              onPress={() => onStatusChange(room.id, 'completed')}
            >
              <Text style={[s.controlBtnText, { color: '#10B981' }]}>Mark Done</Text>
            </Pressable>
            <Pressable
              style={[s.controlBtn, { borderColor: '#EF444455' }]}
              onPress={() => onDelete(room.id)}
            >
              <Text style={[s.controlBtnText, { color: '#EF4444' }]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Create Room Form ─────────────────────────────────────────────────────────

function CreateRoomForm({ circleId, onCreated }: { circleId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(ROOM_COLORS[0]);
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) { setError('Room name required'); return; }
    setLoading(true);
    setError('');
    try {
      await createRoom({
        circleId,
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setName(''); setDescription(''); setTags('');
      onCreated();
    } catch (e: any) {
      setError(e.message || 'Failed to create room');
    }
    setLoading(false);
  };

  return (
    <View style={s.createForm}>
      <Text style={s.createFormTitle}>NEW PROJECT ROOM</Text>

      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        placeholder="Room name (e.g. Underground Circle V2)"
        placeholderTextColor="#4B5563"
      />
      <TextInput
        style={s.input}
        value={description}
        onChangeText={setDescription}
        placeholder="What's this room for? (optional)"
        placeholderTextColor="#4B5563"
      />
      <TextInput
        style={s.input}
        value={tags}
        onChangeText={setTags}
        placeholder="Tags: wallet, ui, backend (comma separated)"
        placeholderTextColor="#4B5563"
      />

      {/* Color picker */}
      <View style={s.colorRow}>
        <Text style={s.colorLabel}>COLOR</Text>
        {ROOM_COLORS.map(c => (
          <Pressable
            key={c}
            style={[s.colorSwatch, { backgroundColor: c }, color === c && s.colorSwatchActive]}
            onPress={() => setColor(c)}
          />
        ))}
      </View>

      {error ? <Text style={s.errorText}>{error}</Text> : null}

      <Pressable style={[s.createBtn, { backgroundColor: color }]} onPress={handleCreate} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={s.createBtnText}>CREATE ROOM</Text>
        }
      </Pressable>
    </View>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function ProjectRoomsPanel({ circleId }: Props) {
  const { rooms, isLoading, refresh } = useProjectRooms(circleId);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<RoomStatus | 'all'>('active');

  const handleStatusChange = async (id: string, status: RoomStatus) => {
    await updateRoomStatus(id, status).catch(() => {});
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteRoom(id).catch(() => {});
    refresh();
  };

  const filtered = filter === 'all' ? rooms : rooms.filter(r => r.status === filter);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>PROJECT ROOMS</Text>
          <Text style={s.headerSub}>{rooms.length} rooms · {rooms.filter(r => r.status === 'active').length} active</Text>
        </View>
        <Pressable style={s.newBtn} onPress={() => setCreating(v => !v)}>
          <Text style={s.newBtnText}>{creating ? '✕' : '+ NEW'}</Text>
        </Pressable>
      </View>

      {/* Create form */}
      {creating && circleId && (
        <CreateRoomForm circleId={circleId} onCreated={() => { setCreating(false); refresh(); }} />
      )}

      {/* Filter tabs */}
      <View style={s.filterRow}>
        {(['all', 'active', 'paused', 'completed'] as const).map(f => (
          <Pressable
            key={f}
            style={[s.filterTab, filter === f && s.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[s.filterTabText, filter === f && s.filterTabTextActive]}>
              {f.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Room list */}
      {isLoading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>No {filter !== 'all' ? filter : ''} rooms</Text>
          <Text style={s.emptySub}>
            {filter === 'active'
              ? 'Create a room to start grouping agents on a project'
              : 'Nothing here yet'}
          </Text>
        </View>
      ) : (
        <ScrollView style={s.roomList} showsVerticalScrollIndicator={false}>
          {filtered.map(room => (
            <RoomCard
              key={room.id}
              room={room}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerTitle: { color: '#F9FAFB', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, fontFamily: 'monospace' },
  headerSub: { color: '#6B7280', fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  newBtn: {
    backgroundColor: '#1F2937', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: '#374151',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  newBtnText: { color: '#9CA3AF', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },

  filterRow: { flexDirection: 'row', gap: 4, marginBottom: 12 },
  filterTab: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4,
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#1F2937',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  filterTabActive: { backgroundColor: '#1F2937', borderColor: '#374151' },
  filterTabText: { color: '#4B5563', fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  filterTabTextActive: { color: '#D1D5DB' },

  roomList: { flex: 1 },
  roomCard: {
    backgroundColor: '#111827', borderRadius: 8, marginBottom: 8,
    borderWidth: 1, borderColor: '#1F2937',
    borderLeftWidth: 3, overflow: 'hidden',
  },
  roomHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  roomColorDot: { width: 8, height: 8, borderRadius: 4 },
  roomHeaderInfo: { flex: 1 },
  roomName: { color: '#F9FAFB', fontSize: 14, fontWeight: '700' },
  roomDesc: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  roomHeaderMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  agentCount: { color: '#6B7280', fontSize: 10, fontFamily: 'monospace' },
  expandChevron: { color: '#4B5563', fontSize: 10, width: 12, textAlign: 'center' },

  agentPillRow: { maxHeight: 32, paddingHorizontal: 12, marginBottom: 8 },
  agentPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1F2937', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1, marginRight: 6, maxWidth: 280,
  },
  agentDot: { width: 6, height: 6, borderRadius: 3 },
  agentPillName: { color: '#D1D5DB', fontSize: 11, fontWeight: '600' },
  agentPillTask: { color: '#6B7280', fontSize: 10, flex: 1 },

  emptyAgents: { color: '#374151', fontSize: 11, fontFamily: 'monospace', paddingHorizontal: 12, paddingBottom: 8 },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12, paddingBottom: 8 },
  tag: { backgroundColor: '#1F2937', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { color: '#6B7280', fontSize: 10, fontFamily: 'monospace' },

  expandedContent: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#1F2937', paddingTop: 10 },
  sectionLabel: { color: '#4B5563', fontSize: 9, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace', marginBottom: 6 },
  activityScroll: { maxHeight: 180 },
  emptyActivity: { color: '#374151', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', paddingVertical: 12 },
  activityRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  activityIcon: { fontSize: 12, fontWeight: '800', width: 14, marginTop: 1 },
  activityContent: { flex: 1 },
  activityTitle: { color: '#D1D5DB', fontSize: 12, fontWeight: '500' },
  activityBody: { color: '#6B7280', fontSize: 11, marginTop: 1 },
  activityMeta: { color: '#374151', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },

  roomControls: { flexDirection: 'row', gap: 6, marginTop: 10 },
  controlBtn: {
    flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  controlBtnText: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },

  // Create form
  createForm: { backgroundColor: '#0D1117', borderRadius: 8, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#1F2937' },
  createFormTitle: { color: '#9CA3AF', fontSize: 11, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace', marginBottom: 12 },
  input: {
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#1F2937',
    borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8,
    color: '#F9FAFB', fontSize: 13, marginBottom: 8,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  colorLabel: { color: '#6B7280', fontSize: 10, fontWeight: '700', fontFamily: 'monospace', marginRight: 4 },
  colorSwatch: { width: 20, height: 20, borderRadius: 4, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  colorSwatchActive: { borderWidth: 2, borderColor: '#fff' },
  errorText: { color: '#EF4444', fontSize: 12, marginBottom: 8 },
  createBtn: {
    paddingVertical: 10, borderRadius: 6, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' },

  // States
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 6 },
  emptyTitle: { color: '#4B5563', fontSize: 14, fontWeight: '600' },
  emptySub: { color: '#374151', fontSize: 12, textAlign: 'center', maxWidth: 280 },
});
