/**
 * GoalDetailModal — goal edit modal with TaskDetailModal-style popup design
 * Content matches original EditGoalModal (always-editable form)
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import type { GoalWithCount } from '../../../../hooks/useGoals';
import type { Goal } from '../../../../types/kanban';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import type { CreateTaskFields } from '../../../../hooks/useKanbanData';

interface Props {
  goal: GoalWithCount;
  agents: CircleOfficeAgent[];
  onClose: () => void;
  onUpdate: (goalId: string, fields: Partial<Goal>) => void;
  onDelete: (goalId: string) => void;
  onCreateTask?: (fields: CreateTaskFields) => Promise<void>;
}

const GOAL_STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  paused: '#f59e0b',
  completed: '#666680',
};

export default function GoalDetailModal({ goal, agents, onClose, onUpdate, onDelete, onCreateTask }: Props) {
  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description || '');
  const [status, setStatus] = useState<'active' | 'paused' | 'completed'>(goal.status);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(goal.assigned_agent_ids);
  const [taskCount, setTaskCount] = useState(String(goal.auto_task_count || 4));
  const [taskFrequency, setTaskFrequency] = useState<'day' | 'week'>(goal.auto_task_frequency || 'day');
  const [generating, setGenerating] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  const toggleAgent = (id: string) => {
    setSelectedAgents(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleUpdate = () => {
    if (!name.trim()) return;
    onUpdate(goal.id, {
      name: name.trim(),
      description: description.trim() || null,
      status,
      assigned_agent_ids: selectedAgents,
      auto_task_count: parseInt(taskCount) || 0,
      auto_task_frequency: taskFrequency,
      ...(lastGenerated ? { last_auto_task_at: lastGenerated } : {}),
    });
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
      // Record generation timestamp
      setLastGenerated(new Date().toISOString());
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={s.overlay}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior="padding" style={s.modalWrap}>
        <View style={s.modal}>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={s.header}>
              <Text style={s.headerTitle}>Edit Goal</Text>
              <Pressable onPress={onClose} style={s.closeBtn}>
                <Text style={s.closeBtnText}>&#x2715;</Text>
              </Pressable>
            </View>

            {/* Task overview */}
            {goal.task_count > 0 && (() => {
              const pct = Math.round((goal.completed_count / goal.task_count) * 100);
              const remaining = goal.task_count - goal.completed_count;
              return (
                <View style={s.overviewCard}>
                  <View style={s.overviewRow}>
                    <View style={s.overviewStat}>
                      <Text style={[s.overviewValue, { color: '#22c55e' }]}>{goal.completed_count}</Text>
                      <Text style={s.overviewLabel}>done</Text>
                    </View>
                    <View style={s.overviewStat}>
                      <Text style={[s.overviewValue, { color: remaining > 0 ? '#6366f1' : '#22c55e' }]}>{remaining}</Text>
                      <Text style={s.overviewLabel}>remaining</Text>
                    </View>
                    <View style={s.overviewStat}>
                      <Text style={[s.overviewValue, { color: pct >= 100 ? '#22c55e' : '#e4e4ed' }]}>{pct}%</Text>
                      <Text style={s.overviewLabel}>complete</Text>
                    </View>
                    <View style={s.overviewStat}>
                      <Text style={s.overviewValue}>{goal.task_count}</Text>
                      <Text style={s.overviewLabel}>total</Text>
                    </View>
                  </View>
                  <View style={s.overviewBar}>
                    <View style={[s.overviewBarFill, { width: `${pct}%` as any, backgroundColor: pct >= 100 ? '#22c55e' : '#6366f1' }]} />
                  </View>
                </View>
              );
            })()}

            {goal.task_count === 0 && (
              <View style={s.overviewCard}>
                <Text style={[s.overviewLabel, { textAlign: 'center' }]}>No tasks linked to this goal yet</Text>
              </View>
            )}

            {/* Name */}
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              maxLength={100}
              placeholder="Goal name"
              placeholderTextColor="#444455"
            />

            {/* Description */}
            <TextInput
              style={[s.input, s.textArea]}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={300}
              placeholder="Description"
              placeholderTextColor="#333348"
            />

            {/* Status */}
            <Text style={s.label}>Status</Text>
            <View style={s.chipRow}>
              {(['active', 'paused', 'completed'] as const).map(st => {
                const active = status === st;
                const color = GOAL_STATUS_COLORS[st];
                return (
                  <Pressable
                    key={st}
                    onPress={() => setStatus(st)}
                    style={[s.chip, active && { backgroundColor: color + '15', borderColor: color + '30' }]}
                  >
                    {active && <View style={[s.chipDot, { backgroundColor: color }]} />}
                    <Text style={[s.chipText, active && { color }]}>{st.toUpperCase()}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Assigned agents */}
            <Text style={s.label}>Assigned Agents</Text>
            <View style={s.chipRow}>
              {agents.map(a => {
                const sel = selectedAgents.includes(a.id);
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => toggleAgent(a.id)}
                    style={[s.chip, sel && { backgroundColor: (a.color || '#6366f1') + '15', borderColor: (a.color || '#6366f1') + '30' }]}
                  >
                    <Text style={[s.chipText, sel && { color: a.color || '#6366f1' }]}>
                      {a.toolIcon || '>>'} {a.name}
                    </Text>
                  </Pressable>
                );
              })}
              {agents.length === 0 && <Text style={s.mutedText}>No agents available</Text>}
            </View>

            {/* Auto-generate tasks */}
            <Text style={s.label}>Auto-generate tasks</Text>
            <View style={s.autoRow}>
              <TextInput
                style={[s.input, { width: 50, textAlign: 'center' as any, marginBottom: 0 }]}
                value={taskCount}
                onChangeText={setTaskCount}
                keyboardType="numeric"
                maxLength={2}
              />
              <Text style={s.mutedText}>per</Text>
              <View style={s.freqRow}>
                {(['day', 'week'] as const).map(freq => {
                  const active = taskFrequency === freq;
                  return (
                    <Pressable
                      key={freq}
                      onPress={() => setTaskFrequency(freq)}
                      style={[s.freqChip, active && s.freqChipActive]}
                    >
                      <Text style={[s.freqText, active && s.freqTextActive]}>
                        {freq === 'day' ? 'Day' : 'Week'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={handleGenerate}
                style={[s.runBtn, generating && { opacity: 0.5 }]}
                disabled={generating}
              >
                <Text style={s.runBtnText}>{generating ? '...' : '\u25B7 Run'}</Text>
              </Pressable>
            </View>

            {/* Update button */}
            <Pressable
              onPress={handleUpdate}
              style={[s.primaryBtn, !name.trim() && { opacity: 0.4 }]}
            >
              <Text style={s.primaryBtnText}>Update Goal</Text>
            </Pressable>

            {/* Goal metadata */}
            <View style={s.metaRow}>
              <Text style={s.metaText}>Created {new Date(goal.created_at).toLocaleDateString()}</Text>
              {goal.updated_at && goal.updated_at !== goal.created_at && (
                <Text style={s.metaText}> · Updated {new Date(goal.updated_at).toLocaleDateString()}</Text>
              )}
              {selectedAgents.length > 0 && (
                <Text style={s.metaText}> · {selectedAgents.length} agent{selectedAgents.length !== 1 ? 's' : ''}</Text>
              )}
            </View>

            {/* Delete */}
            <Pressable onPress={() => setShowDelete(p => !p)} style={s.deleteToggle}>
              <Text style={s.deleteToggleText}>Delete goal</Text>
            </Pressable>
            {showDelete && (
              <View style={s.deleteConfirm}>
                <Text style={s.deleteWarning}>This cannot be undone.</Text>
                <Pressable onPress={() => { onDelete(goal.id); onClose(); }} style={s.deleteBtn}>
                  <Text style={s.deleteBtnText}>Confirm delete</Text>
                </Pressable>
              </View>
            )}

            {/* Cancel */}
            <Pressable onPress={onClose} style={s.cancelBtn}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  // Overlay (TaskDetailModal-style)
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
  modalWrap: {
    width: '95%',
    maxWidth: 580,
    maxHeight: '90%',
    zIndex: 101,
  },
  modal: {
    backgroundColor: '#111119',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    maxHeight: '100%',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 20px 60px rgba(0,0,0,0.5)' } as any : {}),
  },
  scroll: {
    maxHeight: 520,
  },
  scrollContent: {
    padding: 24,
  },

  // Task overview
  overviewCard: {
    backgroundColor: '#0c0c14',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  overviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  overviewStat: {
    alignItems: 'center',
  },
  overviewValue: {
    color: '#e4e4ed',
    fontSize: 18,
    fontWeight: '700',
  },
  overviewLabel: {
    color: '#555566',
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  overviewBar: {
    height: 4,
    backgroundColor: '#1a1a28',
    borderRadius: 2,
    overflow: 'hidden',
  },
  overviewBarFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Header
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
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#1a1a28',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  closeBtnText: {
    color: '#6b6b80',
    fontSize: 14,
  },

  // Form fields
  input: {
    backgroundColor: '#0c0c14',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
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

  // Auto-generate
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

  // Action buttons
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
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 4,
  },
  metaText: {
    color: '#444455',
    fontSize: 10,
    fontWeight: '500',
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

  // Delete section
  deleteToggle: {
    marginTop: 10,
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteToggleText: {
    color: '#ef444460',
    fontSize: 12,
    fontWeight: '500',
  },
  deleteConfirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  deleteWarning: {
    color: '#f87171',
    fontSize: 12,
  },
  deleteBtn: {
    backgroundColor: '#ef444415',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteBtnText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
  },
});
