/**
 * PlanningPanel -- Deep planning interface for circle plans
 * Shows as a center tab in FeedTab. Supports create, expand, status, generate tasks.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView,
  StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import { CirclePlan, PlanStatus, PlanStep } from '../../../../types/kanban';

type PlanStepStatus = 'pending' | 'in_progress' | 'done';

interface Props {
  circleId: string;
  plans: CirclePlan[];
  onCreatePlan: (fields: { title: string; description: string }) => Promise<any>;
  onUpdatePlan: (id: string, fields: Partial<CirclePlan>) => Promise<void>;
  onDeletePlan: (id: string) => Promise<void>;
  onGenerateTasks: (planId: string) => Promise<void>;
}

const STATUS_COLORS: Record<PlanStatus, string> = {
  draft: '#666',
  investigating: '#3b82f6',
  qa: '#f59e0b',
  ready: '#22c55e',
  active: '#6366f1',
  completed: '#10b981',
  archived: '#555',
};

const STATUS_LABELS: Record<PlanStatus, string> = {
  draft: 'Draft',
  investigating: 'Investigating',
  qa: 'Q&A',
  ready: 'Ready',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

const ALL_STATUSES: PlanStatus[] = [
  'draft', 'investigating', 'qa', 'ready', 'active', 'completed', 'archived',
];

const STEP_STATUS_COLORS: Record<PlanStepStatus, string> = {
  pending: '#555',
  in_progress: '#3b82f6',
  done: '#22c55e',
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function PlanningPanel({
  circleId, plans, onCreatePlan, onUpdatePlan, onDeletePlan, onGenerateTasks,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showContextId, setShowContextId] = useState<string | null>(null);

  // Sort: active first, then by updated_at desc
  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [plans]);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreatePlan({ title, description: newDesc.trim() });
      setNewTitle('');
      setNewDesc('');
      setShowCreateForm(false);
    } catch (err) {
      console.warn('[PlanningPanel] create failed:', err);
      setCreateError(err instanceof Error ? err.message : 'Failed to create plan. Please try again.');
    } finally {
      setCreating(false);
    }
  }, [newTitle, newDesc, onCreatePlan]);

  const handleStatusChange = useCallback(async (planId: string, status: PlanStatus) => {
    try {
      await onUpdatePlan(planId, { status } as any);
    } catch (err) {
      console.warn('[PlanningPanel] status update failed:', err);
    }
  }, [onUpdatePlan]);

  const handleGenerateTasks = useCallback(async (planId: string) => {
    setGeneratingId(planId);
    try {
      await onGenerateTasks(planId);
    } catch (err) {
      console.warn('[PlanningPanel] generate tasks failed:', err);
    } finally {
      setGeneratingId(null);
    }
  }, [onGenerateTasks]);

  const handleDelete = useCallback(async (planId: string) => {
    try {
      await onDeletePlan(planId);
      setDeleteConfirmId(null);
      if (expandedId === planId) setExpandedId(null);
    } catch (err) {
      console.warn('[PlanningPanel] delete failed:', err);
    }
  }, [onDeletePlan, expandedId]);

  const getStepProgress = (steps: PlanStep[]) => {
    if (!steps || steps.length === 0) return { done: 0, total: 0, pct: 0 };
    const done = steps.filter(s => s.status === 'done').length;
    return { done, total: steps.length, pct: done / steps.length };
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Plans</Text>
        {!showCreateForm && (
          <Pressable onPress={() => setShowCreateForm(true)} style={s.newPlanBtn}>
            <Text style={s.newPlanBtnText}>+ New Plan</Text>
          </Pressable>
        )}
      </View>

      {/* Create form */}
      {showCreateForm && (
        <View style={s.createForm}>
          <TextInput
            style={s.createInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Plan title..."
            placeholderTextColor="#555"
            autoFocus
          />
          <TextInput
            style={[s.createInput, s.createDesc]}
            value={newDesc}
            onChangeText={setNewDesc}
            placeholder="Description (optional)..."
            placeholderTextColor="#444"
            multiline
            numberOfLines={3}
          />
          <View style={s.createActions}>
            <Pressable
              onPress={handleCreate}
              style={[s.createBtn, !newTitle.trim() && s.createBtnDisabled]}
              disabled={!newTitle.trim() || creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#22c55e" />
              ) : (
                <Text style={s.createBtnText}>Create Plan</Text>
              )}
            </Pressable>
            <Pressable onPress={() => { setShowCreateForm(false); setNewTitle(''); setNewDesc(''); }} style={s.cancelFormBtn}>
              <Text style={s.cancelFormText}>Cancel</Text>
            </Pressable>
          </View>
          {createError && (
            <Text style={s.createErrorText}>{createError}</Text>
          )}
        </View>
      )}

      {/* Empty state */}
      {sortedPlans.length === 0 && !showCreateForm && (
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No plans yet. Create one to start deep planning.</Text>
        </View>
      )}

      {/* Plan cards */}
      {sortedPlans.map((plan) => {
        const isExpanded = expandedId === plan.id;
        const progress = getStepProgress(plan.steps);
        const isGenerating = generatingId === plan.id;
        const isDeleteConfirm = deleteConfirmId === plan.id;
        const showContext = showContextId === plan.id;

        return (
          <View key={plan.id} style={[s.planCard, isExpanded && s.planCardExpanded]}>
            {/* Card header - clickable */}
            <Pressable
              onPress={() => setExpandedId(isExpanded ? null : plan.id)}
              style={s.planCardHeader}
            >
              <View style={s.planCardLeft}>
                <Text style={s.planTitle} numberOfLines={isExpanded ? undefined : 1}>{plan.title}</Text>
                <View style={s.planMeta}>
                  <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[plan.status] + '20' }]}>
                    <View style={[s.statusDot, { backgroundColor: STATUS_COLORS[plan.status] }]} />
                    <Text style={[s.statusText, { color: STATUS_COLORS[plan.status] }]}>
                      {STATUS_LABELS[plan.status]}
                    </Text>
                  </View>
                  {progress.total > 0 && (
                    <Text style={s.stepCount}>{progress.done}/{progress.total} steps</Text>
                  )}
                  <Text style={s.timeText}>{timeAgo(plan.created_at)}</Text>
                </View>
              </View>
              {progress.total > 0 && (
                <View style={s.miniProgress}>
                  <View style={s.miniProgressTrack}>
                    <View style={[s.miniProgressFill, { width: `${progress.pct * 100}%` as any }]} />
                  </View>
                </View>
              )}
            </Pressable>

            {/* Expanded content */}
            {isExpanded && (
              <View style={s.expandedContent}>
                {/* Description */}
                {plan.description && (
                  <Text style={s.planDescription}>{plan.description}</Text>
                )}

                {/* Status selector */}
                <View style={s.statusSelector}>
                  <Text style={s.sectionLabel}>Status</Text>
                  <View style={s.statusPills}>
                    {ALL_STATUSES.map((st) => (
                      <Pressable
                        key={st}
                        onPress={() => handleStatusChange(plan.id, st)}
                        style={[
                          s.statusPill,
                          plan.status === st && { backgroundColor: STATUS_COLORS[st] + '25', borderColor: STATUS_COLORS[st] + '50' },
                        ]}
                      >
                        <Text style={[
                          s.statusPillText,
                          plan.status === st && { color: STATUS_COLORS[st] },
                        ]}>
                          {STATUS_LABELS[st]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Steps list */}
                {plan.steps && plan.steps.length > 0 && (
                  <View style={s.stepsSection}>
                    <Text style={s.sectionLabel}>Steps</Text>
                    {plan.steps.map((step, idx) => (
                      <View key={step.id} style={s.stepRow}>
                        <View style={[s.stepIndicator, { backgroundColor: STEP_STATUS_COLORS[step.status] }]} />
                        <View style={s.stepContent}>
                          <Text style={[s.stepTitle, step.status === 'done' && s.stepTitleDone]}>
                            {idx + 1}. {step.title}
                          </Text>
                          {step.description ? (
                            <Text style={s.stepDesc} numberOfLines={2}>{step.description}</Text>
                          ) : null}
                          {step.task_id && (
                            <View style={s.linkedTaskBadge}>
                              <Text style={s.linkedTaskText}>Linked task</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Generate Tasks button */}
                <Pressable
                  onPress={() => handleGenerateTasks(plan.id)}
                  style={[s.generateTasksBtn, isGenerating && s.generateTasksBtnActive]}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <ActivityIndicator size="small" color="#6366f1" />
                  ) : (
                    <Text style={s.generateTasksText}>Generate Tasks</Text>
                  )}
                </Pressable>

                {/* Context section */}
                {plan.context && (
                  plan.context.investigation ||
                  (plan.context.findings?.length || 0) > 0 ||
                  (plan.context.qa_pairs?.length || 0) > 0
                ) && (
                  <View style={s.contextSection}>
                    <Pressable
                      onPress={() => setShowContextId(showContext ? null : plan.id)}
                      style={s.contextToggle}
                    >
                      <Text style={s.contextToggleText}>
                        {showContext ? '\u25BC' : '\u25B6'} Context
                      </Text>
                    </Pressable>

                    {showContext && (
                      <View style={s.contextBody}>
                        {/* Investigation summary */}
                        {plan.context.investigation ? (
                          <View style={s.contextGroup}>
                            <Text style={s.contextGroupLabel}>Investigation</Text>
                            <Text style={s.contextItem}>{plan.context.investigation}</Text>
                          </View>
                        ) : null}

                        {/* Findings */}
                        {plan.context.findings && plan.context.findings.length > 0 && (
                          <View style={s.contextGroup}>
                            <Text style={s.contextGroupLabel}>Findings</Text>
                            {plan.context.findings.map((finding, i) => (
                              <Text key={i} style={s.contextItem}>{'\u2022'} {finding}</Text>
                            ))}
                          </View>
                        )}

                        {/* Q&A pairs */}
                        {plan.context.qa_pairs && plan.context.qa_pairs.length > 0 && (
                          <View style={s.contextGroup}>
                            <Text style={s.contextGroupLabel}>Q&A</Text>
                            {plan.context.qa_pairs.map((qa, i) => (
                              <View key={i} style={s.qaItem}>
                                <Text style={s.qaQuestion}>Q: {qa.q}</Text>
                                <Text style={s.qaAnswer}>A: {qa.a}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* Delete button */}
                <View style={s.deleteSection}>
                  {isDeleteConfirm ? (
                    <View style={s.deleteConfirmRow}>
                      <Text style={s.deleteConfirmText}>Delete this plan?</Text>
                      <Pressable onPress={() => handleDelete(plan.id)} style={s.deleteConfirmBtn}>
                        <Text style={s.deleteConfirmYes}>Yes, delete</Text>
                      </Pressable>
                      <Pressable onPress={() => setDeleteConfirmId(null)} style={s.deleteCancelBtn}>
                        <Text style={s.deleteCancelText}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => setDeleteConfirmId(plan.id)} style={s.deleteBtn}>
                      <Text style={s.deleteBtnText}>Delete Plan</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerTitle: {
    color: '#c0c0c0',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    letterSpacing: 0.5,
  },
  newPlanBtn: {
    backgroundColor: '#6366f115',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#6366f130',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  newPlanBtnText: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // Create form
  createForm: {
    backgroundColor: '#111118',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    padding: 14,
    gap: 10,
  },
  createInput: {
    backgroundColor: '#0a0a14',
    borderWidth: 1,
    borderColor: '#1e1e3a',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#e0e0e8',
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  createDesc: {
    minHeight: 60,
    textAlignVertical: 'top',
    fontSize: 13,
  },
  createActions: {
    flexDirection: 'row',
    gap: 8,
  },
  createBtn: {
    backgroundColor: '#22c55e15',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#22c55e30',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  createBtnDisabled: {
    opacity: 0.4,
  },
  createBtnText: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '700',
  },
  cancelFormBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cancelFormText: {
    color: '#666',
    fontSize: 13,
    fontWeight: '600',
  },
  createErrorText: {
    color: '#ef4444',
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // Empty state
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#444',
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    textAlign: 'center',
  },
  // Plan cards
  planCard: {
    backgroundColor: '#111118',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    ...(Platform.OS === 'web' ? {
      transition: 'all 0.2s ease',
    } as any : {}),
  },
  planCardExpanded: {
    borderColor: '#2a2a4a',
  },
  planCardHeader: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  planCardLeft: {
    flex: 1,
    gap: 6,
  },
  planTitle: {
    color: '#e0e0e8',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  planMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  stepCount: {
    color: '#6f6f6f',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  timeText: {
    color: '#3e3e3e',
    fontSize: 10,
    fontWeight: '500',
  },
  miniProgress: {
    width: 40,
    marginLeft: 10,
  },
  miniProgressTrack: {
    height: 3,
    backgroundColor: '#1a1a2e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%' as any,
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  // Expanded content
  expandedContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  planDescription: {
    color: '#8b8b9e',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    marginTop: 10,
  },
  // Status selector
  statusSelector: {
    gap: 8,
  },
  sectionLabel: {
    color: '#6f6f7f',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statusPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    backgroundColor: '#0a0a14',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  statusPillText: {
    color: '#6f6f7f',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // Steps
  stepsSection: {
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#0a0a14',
    borderRadius: 6,
  },
  stepIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  stepContent: {
    flex: 1,
    gap: 3,
  },
  stepTitle: {
    color: '#c8c8d0',
    fontSize: 13,
    fontWeight: '500',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  stepTitleDone: {
    textDecorationLine: 'line-through',
    color: '#555565',
  },
  stepDesc: {
    color: '#555565',
    fontSize: 11,
    lineHeight: 16,
  },
  linkedTaskBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#6366f115',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  linkedTaskText: {
    color: '#6366f1',
    fontSize: 9,
    fontWeight: '700',
  },
  // Generate tasks
  generateTasksBtn: {
    backgroundColor: '#6366f112',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#6366f125',
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  generateTasksBtnActive: {
    backgroundColor: '#6366f120',
  },
  generateTasksText: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // Context
  contextSection: {
    gap: 6,
  },
  contextToggle: {
    paddingVertical: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  contextToggleText: {
    color: '#6f6f7f',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  contextBody: {
    gap: 12,
    paddingLeft: 8,
  },
  contextGroup: {
    gap: 6,
  },
  contextGroupLabel: {
    color: '#8b8b9e',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  contextItem: {
    color: '#6f6f7f',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    paddingLeft: 6,
  },
  qaItem: {
    gap: 3,
    paddingLeft: 6,
    paddingVertical: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#1e1e3a',
  },
  qaQuestion: {
    color: '#8b8b9e',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  qaAnswer: {
    color: '#6f6f7f',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // Delete
  deleteSection: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    paddingTop: 12,
  },
  deleteBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteBtnText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteConfirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteConfirmText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteConfirmBtn: {
    backgroundColor: '#ef444418',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ef444430',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteConfirmYes: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteCancelText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
});
