/**
 * GoalsPanel — left sidebar showing goals with filter, CRUD, and edit modal
 * with auto-generate tasks (count + frequency + round-robin agent assignment)
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform,
} from 'react-native';
import type { GoalWithCount } from '../../../../hooks/useGoals';
import type { Goal } from '../../../../types/kanban';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import type { CreateTaskFields } from '../../../../hooks/useKanbanData';

interface Props {
  goals: GoalWithCount[];
  agents: CircleOfficeAgent[];
  filteredGoalId: string | null;
  onFilter: (goalId: string | null) => void;
  onCreateGoal: (fields: Partial<Goal>) => void;
  onUpdateGoal: (goalId: string, fields: Partial<Goal>) => void;
  onDeleteGoal: (goalId: string) => void;
  onCreateTask?: (fields: CreateTaskFields) => Promise<void>;
}

export default function GoalsPanel({
  goals, agents, filteredGoalId, onFilter,
  onCreateGoal, onUpdateGoal, onDeleteGoal, onCreateTask,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editGoal, setEditGoal] = useState<GoalWithCount | null>(null);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerIcon}>&#x2299;</Text>
          <Text style={s.headerTitle}>GOALS</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{goals.length}</Text>
          </View>
        </View>
        <Pressable onPress={() => setShowAdd(true)} style={s.addBtn}>
          <Text style={s.addBtnText}>+</Text>
        </Pressable>
      </View>

      {/* Filter clear */}
      {filteredGoalId && (
        <Pressable onPress={() => onFilter(null)} style={s.clearFilter}>
          <Text style={s.clearFilterText}>Clear filter (1)</Text>
        </Pressable>
      )}

      {/* Goal cards */}
      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
        {goals.map(goal => {
          const isSelected = filteredGoalId === goal.id;
          const statusColor = GOAL_STATUS_COLORS[goal.status] || '#666680';
          const pct = goal.task_count > 0 ? Math.round((goal.completed_count / goal.task_count) * 100) : 0;
          const barColor = pct >= 100 ? '#22c55e' : pct > 0 ? '#6366f1' : '#333348';

          return (
            <Pressable
              key={goal.id}
              onPress={() => onFilter(isSelected ? null : goal.id)}
              style={[s.card, isSelected && s.cardSelected]}
            >
              <View style={s.cardHeader}>
                <Text style={s.cardName} numberOfLines={1}>{goal.name}</Text>
                <View style={s.cardActions}>
                  <Pressable onPress={(e: any) => { e.stopPropagation?.(); setEditGoal(goal); }} hitSlop={6}>
                    <Text style={s.cardActionIcon}>&#x270E;</Text>
                  </Pressable>
                  <Pressable onPress={(e: any) => { e.stopPropagation?.(); onDeleteGoal(goal.id); }} hitSlop={6}>
                    <Text style={s.cardActionIcon}>&#x2715;</Text>
                  </Pressable>
                </View>
              </View>

              {/* Status badge */}
              <View style={[s.statusBadge, { backgroundColor: statusColor + '18' }]}>
                <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[s.statusText, { color: statusColor }]}>{goal.status.toUpperCase()}</Text>
              </View>

              {/* Progress */}
              <View style={s.progressRow}>
                <Text style={s.progressText}>{goal.completed_count}/{goal.task_count} ({pct}%)</Text>
              </View>
              <View style={s.progressBar}>
                <View style={[s.progressFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
              </View>

              {/* Agent avatars */}
              {goal.assigned_agent_ids.length > 0 && (
                <View style={s.agentRow}>
                  {goal.assigned_agent_ids.slice(0, 4).map((aid, i) => {
                    const agent = agents.find(a => a.id === aid);
                    return (
                      <View key={i} style={[s.agentAvatar, { backgroundColor: agent?.color || '#6366f1' }]}>
                        <Text style={s.agentAvatarText}>
                          {(agent?.name || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    );
                  })}
                  {goal.assigned_agent_ids.length > 4 && (
                    <View style={s.agentMore}>
                      <Text style={s.agentMoreText}>+{goal.assigned_agent_ids.length - 4}</Text>
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}

        {goals.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyText}>No goals yet</Text>
            <Pressable onPress={() => setShowAdd(true)} style={s.emptyBtn}>
              <Text style={s.emptyBtnText}>+ Create goal</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Add Goal Modal */}
      {showAdd && (
        <AddGoalModal
          onClose={() => setShowAdd(false)}
          onCreate={(fields) => { onCreateGoal(fields); setShowAdd(false); }}
        />
      )}

      {/* Edit Goal Modal */}
      {editGoal && (
        <EditGoalModal
          goal={editGoal}
          agents={agents}
          onClose={() => setEditGoal(null)}
          onUpdate={(fields) => { onUpdateGoal(editGoal.id, fields); setEditGoal(null); }}
          onCreateTask={onCreateTask}
        />
      )}
    </View>
  );
}

// ─── Add Goal Modal ────────────────────────────────────────────────────────

function AddGoalModal({ onClose, onCreate }: { onClose: () => void; onCreate: (f: Partial<Goal>) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <View style={modal.overlay}>
      <Pressable style={modal.backdrop} onPress={onClose} />
      <View style={modal.box}>
        <View style={modal.header}>
          <Text style={modal.headerTitle}>New Goal</Text>
          <Pressable onPress={onClose}><Text style={modal.closeX}>&#x2715;</Text></Pressable>
        </View>
        <TextInput
          style={modal.input}
          placeholder="Goal name"
          placeholderTextColor="#444455"
          value={name}
          onChangeText={setName}
          autoFocus
          maxLength={100}
        />
        <TextInput
          style={[modal.input, modal.textArea]}
          placeholder="Description (optional)"
          placeholderTextColor="#333348"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={300}
        />
        <Pressable
          onPress={() => { if (name.trim()) onCreate({ name: name.trim(), description: description.trim() || null }); }}
          style={[modal.primaryBtn, !name.trim() && { opacity: 0.4 }]}
        >
          <Text style={modal.primaryBtnText}>Create</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Edit Goal Modal ───────────────────────────────────────────────────────

function EditGoalModal({
  goal, agents, onClose, onUpdate, onCreateTask,
}: {
  goal: GoalWithCount;
  agents: CircleOfficeAgent[];
  onClose: () => void;
  onUpdate: (f: Partial<Goal>) => void;
  onCreateTask?: (fields: CreateTaskFields) => Promise<void>;
}) {
  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description || '');
  const [status, setStatus] = useState<'active' | 'paused' | 'completed'>(goal.status);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(goal.assigned_agent_ids);
  const [taskCount, setTaskCount] = useState('4');
  const [taskFrequency, setTaskFrequency] = useState<'day' | 'week'>('day');
  const [generating, setGenerating] = useState(false);

  const toggleAgent = (id: string) => {
    setSelectedAgents(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleGenerate = async () => {
    if (!onCreateTask || generating) return;
    const count = parseInt(taskCount) || 4;
    setGenerating(true);
    try {
      for (let i = 0; i < count; i++) {
        const assignedAgent = selectedAgents.length > 0
          ? selectedAgents[i % selectedAgents.length]
          : null;
        await onCreateTask({
          title: `${goal.name} \u2014 Task #${i + 1}`,
          description: `Auto-generated task for goal: ${goal.description || goal.name}. Frequency: per ${taskFrequency}.`,
          goal_id: goal.id,
          status: 'backlog',
          priority: 'normal',
          assigned_agent_id: assignedAgent,
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={modal.overlay}>
      <Pressable style={modal.backdrop} onPress={onClose} />
      <View style={[modal.box, { maxHeight: '85%' }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={modal.header}>
            <Text style={modal.headerTitle}>Edit Goal</Text>
            <Pressable onPress={onClose}><Text style={modal.closeX}>&#x2715;</Text></Pressable>
          </View>

          <TextInput style={modal.input} value={name} onChangeText={setName} maxLength={100} />
          <TextInput
            style={[modal.input, modal.textArea]}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={300}
            placeholder="Description"
            placeholderTextColor="#333348"
          />

          {/* Status toggle */}
          <Text style={modal.label}>Status</Text>
          <View style={modal.chipRow}>
            {(['active', 'paused', 'completed'] as const).map(st => {
              const active = status === st;
              const color = GOAL_STATUS_COLORS[st];
              return (
                <Pressable
                  key={st}
                  onPress={() => setStatus(st)}
                  style={[modal.chip, active && { backgroundColor: color + '15', borderColor: color + '30' }]}
                >
                  {active && <View style={[modal.chipDot, { backgroundColor: color }]} />}
                  <Text style={[modal.chipText, active && { color }]}>{st.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Assigned agents */}
          <Text style={modal.label}>Assigned Agents</Text>
          <View style={modal.chipRow}>
            {agents.map(a => {
              const sel = selectedAgents.includes(a.id);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => toggleAgent(a.id)}
                  style={[modal.chip, sel && { backgroundColor: (a.color || '#6366f1') + '15', borderColor: (a.color || '#6366f1') + '30' }]}
                >
                  <Text style={[modal.chipText, sel && { color: a.color || '#6366f1' }]}>
                    {a.toolIcon || '>>'} {a.name}
                  </Text>
                </Pressable>
              );
            })}
            {agents.length === 0 && <Text style={modal.mutedText}>No agents available</Text>}
          </View>

          {/* Auto-generate tasks */}
          <Text style={modal.label}>Auto-generate tasks</Text>
          <View style={modal.autoRow}>
            <TextInput
              style={[modal.input, { width: 50, textAlign: 'center', marginBottom: 0 }]}
              value={taskCount}
              onChangeText={setTaskCount}
              keyboardType="numeric"
              maxLength={2}
            />
            <Text style={modal.mutedText}>per</Text>
            <View style={modal.freqRow}>
              {(['day', 'week'] as const).map(freq => {
                const active = taskFrequency === freq;
                return (
                  <Pressable
                    key={freq}
                    onPress={() => setTaskFrequency(freq)}
                    style={[modal.freqChip, active && modal.freqChipActive]}
                  >
                    <Text style={[modal.freqText, active && modal.freqTextActive]}>
                      {freq === 'day' ? 'Day' : 'Week'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={handleGenerate}
              style={[modal.runBtn, generating && { opacity: 0.5 }]}
              disabled={generating}
            >
              <Text style={modal.runBtnText}>{generating ? '...' : '\u25B7 Run'}</Text>
            </Pressable>
          </View>

          {/* Update button */}
          <Pressable
            onPress={() => {
              if (name.trim()) {
                onUpdate({
                  name: name.trim(),
                  description: description.trim() || null,
                  status,
                  assigned_agent_ids: selectedAgents,
                  auto_task_count: parseInt(taskCount) || 0,
                  auto_task_frequency: taskFrequency,
                });
              }
            }}
            style={modal.primaryBtn}
          >
            <Text style={modal.primaryBtnText}>Update Goal</Text>
          </Pressable>

          <Pressable onPress={onClose} style={modal.cancelBtn}>
            <Text style={modal.cancelBtnText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

// ─── Constants & Styles ────────────────────────────────────────────────────

const GOAL_STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  paused: '#f59e0b',
  completed: '#666680',
};

const s = StyleSheet.create({
  container: {
    width: 220,
    backgroundColor: '#0d0d16',
    borderRightWidth: 1,
    borderRightColor: '#15151e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIcon: {
    color: '#6b6b80',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  headerTitle: {
    color: '#9090a8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  countBadge: {
    backgroundColor: '#1a1a28',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '700',
  },
  addBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#15151e',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addBtnText: {
    color: '#6b6b80',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 18,
  },
  clearFilter: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#6366f108',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  clearFilterText: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '500',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 8,
    gap: 6,
  },
  card: {
    backgroundColor: '#111119',
    borderWidth: 1,
    borderColor: '#1e1e2e',
    borderRadius: 8,
    padding: 10,
    gap: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  cardSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f108',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardName: {
    color: '#e4e4ed',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 4,
  },
  cardActionIcon: {
    color: '#444455',
    fontSize: 11,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressText: {
    color: '#6b6b80',
    fontSize: 11,
    fontWeight: '500',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#1a1a28',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  agentRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 2,
  },
  agentAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentAvatarText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  agentMore: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1a1a28',
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentMoreText: {
    color: '#6b6b80',
    fontSize: 8,
    fontWeight: '700',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    color: '#333348',
    fontSize: 12,
  },
  emptyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#15151e',
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  emptyBtnText: {
    color: '#6b6b80',
    fontSize: 11,
    fontWeight: '600',
  },
});

// ─── Modal Styles ──────────────────────────────────────────────────────────

const modal = StyleSheet.create({
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
  box: {
    backgroundColor: '#111119',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    width: '90%',
    maxWidth: 420,
    padding: 20,
    zIndex: 101,
    ...(Platform.OS === 'web' ? { boxShadow: '0 20px 60px rgba(0,0,0,0.5)' } as any : {}),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#e4e4ed',
    fontSize: 16,
    fontWeight: '600',
  },
  closeX: {
    color: '#6b6b80',
    fontSize: 16,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  input: {
    backgroundColor: '#0c0c14',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: '#e4e4ed',
    fontSize: 14,
    marginBottom: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  label: {
    color: '#6b6b80',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    borderRadius: 16,
    backgroundColor: '#0c0c14',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  chipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#555566',
  },
  mutedText: {
    color: '#444455',
    fontSize: 12,
  },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  freqRow: {
    flexDirection: 'row',
    gap: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    overflow: 'hidden',
  },
  freqChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#0c0c14',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  freqChipActive: {
    backgroundColor: '#6366f120',
  },
  freqText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#555566',
  },
  freqTextActive: {
    color: '#a5b4fc',
  },
  runBtn: {
    backgroundColor: '#6366f115',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  runBtnText: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '600',
  },
  primaryBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cancelBtnText: {
    color: '#555566',
    fontSize: 13,
    fontWeight: '500',
  },
});
