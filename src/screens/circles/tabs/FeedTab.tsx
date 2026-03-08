/**
 * FeedTab — HQ Dashboard with AgentTopBar, GoalsPanel, ActivityFeed, KanbanBoard
 *
 * Desktop: three-panel layout + top bar
 * Mobile: tab switcher between Goals | Activity | Board
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Platform, ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useKanbanData, type KanbanMember } from '../../../hooks/useKanbanData';
import { useGoals } from '../../../hooks/useGoals';
import {
  KanbanTask, TaskStatus, TaskPriority, TasksByColumn,
  COLUMNS, PRIORITY_COLORS, PRIORITY_LABELS,
} from '../../../types/kanban';
import type { GoalWithCount } from '../../../hooks/useGoals';
import type { CircleOfficeAgent } from '../../../lib/circleOffice';

import AgentTopBar from './kanban/AgentTopBar';
import GoalsPanel from './kanban/GoalsPanel';
import ActivityFeedPanel from './kanban/ActivityFeedPanel';
import KanbanBoard from './kanban/KanbanBoard';
import TaskDetailModal from './kanban/TaskDetailModal';

const MOBILE_BREAKPOINT = 768;

type MobileTab = 'goals' | 'activity' | 'board';

export default function FeedTab({ circleId }: { circleId: string }) {
  const kanban = useKanbanData(circleId);
  const goalsHook = useGoals(circleId);
  const [filteredGoalId, setFilteredGoalId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<KanbanTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createInColumn, setCreateInColumn] = useState<TaskStatus>('todo');
  const [mobileTab, setMobileTab] = useState<MobileTab>('board');
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;

  // Filter tasks by goal
  const filteredTasksByColumn = useMemo(() => {
    if (!filteredGoalId) return kanban.tasksByColumn;
    const filtered = {} as TasksByColumn;
    for (const key of Object.keys(kanban.tasksByColumn) as TaskStatus[]) {
      filtered[key] = kanban.tasksByColumn[key].filter(t => (t as any).goal_id === filteredGoalId);
    }
    return filtered;
  }, [kanban.tasksByColumn, filteredGoalId]);

  if (kanban.loading) {
    return (
      <View style={s.loadingContainer}>
        <View style={s.loadingDots}>
          <View style={[s.loadingDot, { backgroundColor: '#6366f1' }]} />
          <View style={[s.loadingDot, { backgroundColor: '#f59e0b', opacity: 0.7 }]} />
          <View style={[s.loadingDot, { backgroundColor: '#22c55e', opacity: 0.4 }]} />
        </View>
      </View>
    );
  }

  // ─── Mobile Layout ─────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <View style={s.container}>
        <AgentTopBar agents={kanban.agents} />

        <View style={s.mobileBody}>
          {mobileTab === 'goals' && (
            <View style={s.mobilePanel}>
              <GoalsPanel
                goals={goalsHook.goals}
                agents={kanban.agents}
                filteredGoalId={filteredGoalId}
                onFilter={setFilteredGoalId}
                onCreateGoal={goalsHook.createGoal}
                onUpdateGoal={goalsHook.updateGoal}
                onDeleteGoal={goalsHook.deleteGoal}
                onCreateTask={kanban.createTask}
              />
            </View>
          )}
          {mobileTab === 'activity' && (
            <View style={s.mobilePanel}>
              <ActivityFeedPanel circleId={circleId} agents={kanban.agents} />
            </View>
          )}
          {mobileTab === 'board' && (
            <KanbanBoard
              columns={COLUMNS}
              tasksByColumn={filteredTasksByColumn}
              agents={kanban.agents}
              goals={goalsHook.goals}
              onCardPress={setDetailTask}
              onMoveTask={kanban.moveTask}
              onQuickAdd={(status, title) => kanban.createTask({ title, status })}
              onAddTask={(status) => { setCreateInColumn(status); setShowCreate(true); }}
            />
          )}
        </View>

        {/* Mobile tab bar */}
        <View style={s.mobileTabBar}>
          {([
            { key: 'goals' as MobileTab, label: 'Goals', icon: '\u2299' },
            { key: 'activity' as MobileTab, label: 'Activity', icon: '\u26A1' },
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

        {showCreate && (
          <CreateTaskModal
            column={createInColumn}
            members={kanban.members}
            agents={kanban.agents}
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
      <AgentTopBar agents={kanban.agents} />

      <View style={s.body}>
        <GoalsPanel
          goals={goalsHook.goals}
          agents={kanban.agents}
          filteredGoalId={filteredGoalId}
          onFilter={setFilteredGoalId}
          onCreateGoal={goalsHook.createGoal}
          onUpdateGoal={goalsHook.updateGoal}
          onDeleteGoal={goalsHook.deleteGoal}
          onCreateTask={kanban.createTask}
        />

        <ActivityFeedPanel circleId={circleId} agents={kanban.agents} />

        <KanbanBoard
          columns={COLUMNS}
          tasksByColumn={filteredTasksByColumn}
          agents={kanban.agents}
          goals={goalsHook.goals}
          onCardPress={setDetailTask}
          onMoveTask={kanban.moveTask}
          onQuickAdd={(status, title) => kanban.createTask({ title, status })}
          onAddTask={(status) => { setCreateInColumn(status); setShowCreate(true); }}
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

      {showCreate && (
        <CreateTaskModal
          column={createInColumn}
          members={kanban.members}
          agents={kanban.agents}
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
            placeholderTextColor="#444455"
            value={title}
            onChangeText={(t) => { setTitle(t); setError(''); }}
            maxLength={200}
            autoFocus
          />

          {/* Description */}
          <TextInput
            style={[m.input, m.textArea]}
            placeholder="Add details..."
            placeholderTextColor="#333348"
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
                  <Text style={[m.chipText, !selectedGoalId && { color: '#e4e4ed' }]}>None</Text>
                </Pressable>
                {goals.map(g => {
                  const active = selectedGoalId === g.id;
                  const gColor = g.status === 'active' ? '#22c55e' : g.status === 'paused' ? '#f59e0b' : '#666680';
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
              <Text style={[m.chipText, !assignedTo && !assignedAgentId && { color: '#e4e4ed' }]}>Nobody</Text>
            </Pressable>
            {members.map(mem => (
              <Pressable
                key={mem.id}
                onPress={() => { setAssignedTo(mem.id); setAssignedAgentId(null); }}
                style={[m.chip, assignedTo === mem.id && m.chipActive]}
              >
                <Text style={[m.chipText, assignedTo === mem.id && { color: '#e4e4ed' }]}>
                  {mem.display_name || mem.username}
                </Text>
              </Pressable>
            ))}
            {agents.map(a => (
              <Pressable
                key={a.id}
                onPress={() => { setAssignedAgentId(a.id); setAssignedTo(null); }}
                style={[m.chip, assignedAgentId === a.id && { backgroundColor: (a.color || '#6366f1') + '15', borderColor: (a.color || '#6366f1') + '30' }]}
              >
                <View style={[m.chipDot, { backgroundColor: a.color || '#6366f1' }]} />
                <Text style={[m.chipText, assignedAgentId === a.id && { color: a.color || '#6366f1' }]}>{a.name}</Text>
              </Pressable>
            ))}
          </View>

          {/* Due date */}
          <Text style={m.sectionLabel}>Due date</Text>
          <TextInput
            style={m.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#333348"
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
  container: { flex: 1, backgroundColor: '#08080e' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#08080e' },
  loadingDots: { flexDirection: 'row', gap: 8 },
  loadingDot: { width: 8, height: 8, borderRadius: 4 },
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
    backgroundColor: '#0a0a12',
    borderTopWidth: 1,
    borderTopColor: '#15151e',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  mobileTabBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
    borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mobileTabBtnActive: {
    backgroundColor: '#15151e',
  },
  mobileTabIcon: {
    fontSize: 16,
    color: '#444455',
  },
  mobileTabIconActive: {
    color: '#e4e4ed',
  },
  mobileTabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#444455',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mobileTabLabelActive: {
    color: '#c0c0d0',
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
    backgroundColor: '#111119',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e2e',
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
    color: '#e4e4ed',
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
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    textAlign: 'center',
  },
  titleInput: {
    color: '#e4e4ed',
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#0c0c14',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a28',
    marginBottom: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  input: {
    color: '#c0c0d0',
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#0c0c14',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a28',
    marginBottom: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  sectionLabel: {
    color: '#6b6b80',
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
    borderColor: '#1e1e2e',
    backgroundColor: '#0c0c14',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  chipActive: {
    borderColor: '#3a3a50',
    backgroundColor: '#1a1a28',
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    color: '#555566',
    fontSize: 12,
    fontWeight: '600',
  },
  btnRow: {
    gap: 8,
    marginTop: 16,
  },
  createBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
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
    color: '#555566',
    fontSize: 13,
    fontWeight: '500',
  },
});
