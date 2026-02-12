import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  RefreshControl,
  Modal,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { showAlert } from '../../../lib/alert';
import Button from '../../../components/Button';

const PRIORITY_COLORS: any = {
  low: '#555',
  normal: '#888',
  high: '#e89b3e',
  urgent: '#e84040',
};

const PRIORITY_LABELS: any = {
  low: 'LOW',
  normal: 'NORMAL',
  high: 'HIGH',
  urgent: 'URGENT',
};

const STATUS_LABELS: any = {
  open: 'TO DO',
  in_progress: 'IN PROGRESS',
  done: 'DONE',
};

export default function FeedTab({ circleId }: { circleId: string }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);

  const fetchTasks = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    let query = supabase
      .from('tasks')
      .select('*, creator:profiles!tasks_created_by_fkey(username, display_name), assignee:profiles!tasks_assigned_to_fkey(username, display_name)')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false });

    if (filter === 'mine' && user) {
      query = query.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
    } else if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data } = await query;
    setTasks(data || []);

    // Fetch members for assignment
    const { data: memberData } = await supabase
      .from('circle_members')
      .select('user:profiles(id, username, display_name)')
      .eq('circle_id', circleId);
    setMembers((memberData || []).map((m: any) => m.user));
  }, [circleId, filter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateTaskStatus = async (taskId: string, status: string) => {
    await supabase.from('tasks').update({
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    }).eq('id', taskId);
    fetchTasks();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTasks();
    setRefreshing(false);
  };

  const openCount = tasks.filter(t => t.status === 'open').length;
  const progressCount = tasks.filter(t => t.status === 'in_progress').length;
  const doneCount = tasks.filter(t => t.status === 'done').length;

  return (
    <View style={styles.container}>
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{openCount}</Text>
          <Text style={styles.statLabel}>TO DO</Text>
        </View>
        <View style={[styles.statDot, { backgroundColor: '#e89b3e' }]} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{progressCount}</Text>
          <Text style={styles.statLabel}>IN PROGRESS</Text>
        </View>
        <View style={[styles.statDot, { backgroundColor: '#4a9a4a' }]} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{doneCount}</Text>
          <Text style={styles.statLabel}>DONE</Text>
        </View>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {[
          { key: 'all', label: 'ALL' },
          { key: 'mine', label: 'MINE' },
          { key: 'open', label: 'TO DO' },
          { key: 'in_progress', label: 'IN PROGRESS' },
          { key: 'done', label: 'DONE' },
        ].map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </View>

      {/* Task List */}
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            currentUserId={currentUserId}
            onStatusChange={updateTaskStatus}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>No tasks yet</Text>
            <Text style={styles.emptySubtext}>Create one and start grinding</Text>
          </View>
        }
      />

      {/* Create Task Button */}
      <View style={styles.createBar}>
        <Button title="+ NEW TASK" onPress={() => setShowCreate(true)} />
      </View>

      {/* Create Task Modal */}
      {showCreate && (
        <CreateTaskModal
          circleId={circleId}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchTasks(); }}
        />
      )}
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.chip, active && styles.chipActive, hovered && !active && styles.chipHovered]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TaskCard({ task, currentUserId, onStatusChange }: any) {
  const [hovered, setHovered] = useState(false);
  const isDone = task.status === 'done';
  const priorityColor = PRIORITY_COLORS[task.priority] || '#888';

  const nextStatus = () => {
    if (task.status === 'open') return 'in_progress';
    if (task.status === 'in_progress') return 'done';
    return 'open';
  };

  const statusIcon = () => {
    if (task.status === 'done') return '✓';
    if (task.status === 'in_progress') return '◐';
    return '○';
  };

  const dueText = () => {
    if (!task.due_date) return null;
    const due = new Date(task.due_date);
    const now = new Date();
    const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
    if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: '#e84040' };
    if (diff === 0) return { text: 'Due today', color: '#e89b3e' };
    if (diff <= 3) return { text: `Due in ${diff}d`, color: '#e89b3e' };
    return { text: `Due in ${diff}d`, color: '#555' };
  };

  const due = dueText();

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.taskCard, hovered && styles.taskCardHovered, isDone && styles.taskCardDone]}
    >
      <View style={styles.taskRow}>
        {/* Status Toggle */}
        <Pressable onPress={() => onStatusChange(task.id, nextStatus())} style={styles.statusButton}>
          <Text style={[styles.statusIcon, isDone && styles.statusIconDone]}>{statusIcon()}</Text>
        </Pressable>

        <View style={styles.taskContent}>
          {/* Title + Priority */}
          <View style={styles.taskHeader}>
            <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]} numberOfLines={2}>
              {task.title}
            </Text>
            <View style={[styles.priorityBadge, { borderColor: priorityColor }]}>
              <Text style={[styles.priorityText, { color: priorityColor }]}>
                {PRIORITY_LABELS[task.priority]}
              </Text>
            </View>
          </View>

          {/* Description */}
          {task.description && (
            <Text style={styles.taskDesc} numberOfLines={2}>{task.description}</Text>
          )}

          {/* Footer: assignee, due, status */}
          <View style={styles.taskFooter}>
            {task.assignee && (
              <View style={styles.assigneeBadge}>
                <Text style={styles.assigneeText}>→ {task.assignee.display_name}</Text>
              </View>
            )}
            {due && (
              <Text style={[styles.dueText, { color: due.color }]}>{due.text}</Text>
            )}
            <Text style={styles.statusText}>{STATUS_LABELS[task.status]}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function CreateTaskModal({ circleId, members, currentUserId, onClose, onCreated }: any) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    if (!title.trim()) { setError('Give the task a title'); return; }

    setLoading(true);
    const { error: createError } = await supabase.from('tasks').insert({
      circle_id: circleId,
      created_by: currentUserId,
      assigned_to: assignedTo,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: dueDate || null,
    });

    setLoading(false);
    if (createError) { setError(createError.message); return; }
    onCreated();
  };

  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>NEW TASK</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.inputLabel}>TITLE</Text>
        <TextInput
          style={styles.input}
          placeholder="What needs to get done?"
          placeholderTextColor="#444"
          value={title}
          onChangeText={setTitle}
          maxLength={200}
        />

        <Text style={styles.inputLabel}>DETAILS (OPTIONAL)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="More context..."
          placeholderTextColor="#444"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
        />

        <Text style={styles.inputLabel}>PRIORITY</Text>
        <View style={styles.priorityRow}>
          {['low', 'normal', 'high', 'urgent'].map((p) => (
            <PriorityChip
              key={p}
              label={PRIORITY_LABELS[p]}
              color={PRIORITY_COLORS[p]}
              active={priority === p}
              onPress={() => setPriority(p)}
            />
          ))}
        </View>

        <Text style={styles.inputLabel}>ASSIGN TO</Text>
        <View style={styles.assignRow}>
          <AssignChip
            label="Unassigned"
            active={assignedTo === null}
            onPress={() => setAssignedTo(null)}
          />
          {members.map((m: any) => (
            <AssignChip
              key={m.id}
              label={m.display_name || m.username}
              active={assignedTo === m.id}
              onPress={() => setAssignedTo(m.id)}
            />
          ))}
        </View>

        <Text style={styles.inputLabel}>DUE DATE (OPTIONAL)</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#444"
          value={dueDate}
          onChangeText={setDueDate}
          maxLength={10}
        />

        <View style={styles.modalButtons}>
          <Button title="CREATE TASK" onPress={handleCreate} loading={loading} />
          <Button title="CANCEL" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

function PriorityChip({ label, color, active, onPress }: any) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.pChip, active && { borderColor: color, backgroundColor: color + '15' }, hovered && !active && styles.pChipHovered]}
    >
      <Text style={[styles.pChipText, { color: active ? color : '#555' }]}>{label}</Text>
    </Pressable>
  );
}

function AssignChip({ label, active, onPress }: any) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.aChip, active && styles.aChipActive, hovered && !active && styles.aChipHovered]}
    >
      <Text style={[styles.aChipText, active && styles.aChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  statItem: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 18, fontWeight: '900' },
  statLabel: { color: '#555', fontSize: 9, letterSpacing: 1, fontWeight: '700', marginTop: 2 },
  statDot: { width: 4, height: 4, borderRadius: 2 },
  filterRow: {
    flexDirection: 'row',
    padding: 12,
    paddingHorizontal: 16,
    gap: 6,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  chipActive: { borderColor: '#fff', backgroundColor: '#1a1a1a' },
  chipHovered: { borderColor: '#444' },
  chipText: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  chipTextActive: { color: '#fff' },
  list: {
    padding: 16,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  taskCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {}),
  },
  taskCardHovered: { borderColor: '#2a2a2a', backgroundColor: '#131313' },
  taskCardDone: { opacity: 0.6 },
  taskRow: { flexDirection: 'row', gap: 12 },
  statusButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  statusIcon: { color: '#666', fontSize: 16 },
  statusIconDone: { color: '#4a9a4a' },
  taskContent: { flex: 1 },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  taskTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#666' },
  priorityBadge: { borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 },
  priorityText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  taskDesc: { color: '#666', fontSize: 13, marginTop: 6, lineHeight: 18 },
  taskFooter: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' },
  assigneeBadge: { backgroundColor: '#1a1a2e', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8 },
  assigneeText: { color: '#88f', fontSize: 11, fontWeight: '600' },
  dueText: { fontSize: 11, fontWeight: '600' },
  statusText: { color: '#444', fontSize: 10, letterSpacing: 1, fontWeight: '700' },
  createBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 32, marginBottom: 12 },
  emptyText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptySubtext: { color: '#555', fontSize: 14, marginTop: 4 },
  // Modal
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCard: {
    width: '90%',
    maxWidth: 420,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: '#222',
    zIndex: 101,
    maxHeight: '85%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 24,
  },
  inputLabel: { color: '#666', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  errorBox: { backgroundColor: '#2a1515', borderWidth: 1, borderColor: '#4a2020', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff6666', fontSize: 13, textAlign: 'center' },
  priorityRow: { flexDirection: 'row', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  pChip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#222', backgroundColor: '#0a0a0a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  pChipHovered: { borderColor: '#444' },
  pChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  assignRow: { flexDirection: 'row', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  aChip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#222', backgroundColor: '#0a0a0a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  aChipActive: { borderColor: '#fff', backgroundColor: '#1a1a1a' },
  aChipHovered: { borderColor: '#444' },
  aChipText: { color: '#555', fontSize: 12, fontWeight: '600' },
  aChipTextActive: { color: '#fff' },
  modalButtons: { gap: 8, marginTop: 8 },
});
