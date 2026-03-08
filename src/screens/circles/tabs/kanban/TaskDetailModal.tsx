/**
 * TaskDetailModal — task detail/edit modal with comments + peer review workflow
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import {
  KanbanTask, TaskComment, TaskStatus, TaskPriority,
  COLUMNS, PRIORITY_COLORS, PRIORITY_LABELS, DEFAULT_AGENT_ROSTER,
} from '../../../../types/kanban';
import type { KanbanData, KanbanMember } from '../../../../hooks/useKanbanData';
import type { GoalWithCount } from '../../../../hooks/useGoals';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import { supabase } from '../../../../lib/supabase';

interface Props {
  task: KanbanTask;
  kanban: KanbanData;
  goals?: GoalWithCount[];
  onClose: () => void;
}

export default function TaskDetailModal({ task: initialTask, kanban, goals, onClose }: Props) {
  const task = kanban.tasks.find(t => t.id === initialTask.id) || initialTask;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignedTo, setAssignedTo] = useState<string | null>(task.assigned_to);
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(task.assigned_agent_id);
  const [dueDate, setDueDate] = useState(task.due_date || '');

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [showAssignees, setShowAssignees] = useState(false);
  const commentsRef = useRef<ScrollView>(null);

  // Sync edited fields when task updates
  useEffect(() => {
    if (!editing) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setAssignedTo(task.assigned_to);
      setAssignedAgentId(task.assigned_agent_id);
      setDueDate(task.due_date || '');
    }
  }, [task, editing]);

  // Load comments
  const loadComments = useCallback(async () => {
    const c = await kanban.fetchComments(task.id);
    setComments(c);
  }, [task.id, kanban.fetchComments]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Realtime comments
  useEffect(() => {
    const channel = supabase
      .channel(`task-comments-${task.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'task_comments',
        filter: `task_id=eq.${task.id}`,
      }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [task.id, loadComments]);

  const handleSave = async () => {
    await kanban.updateTask(task.id, {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      assigned_to: assignedTo,
      assigned_agent_id: assignedAgentId,
      due_date: dueDate || null,
    } as any);
    setEditing(false);
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    await kanban.addComment(task.id, commentText);
    setCommentText('');
  };

  const handleDelete = async () => {
    await kanban.deleteTask(task.id);
    onClose();
  };

  // ─── Peer Review Actions ───────────────────────────────────────────────
  const handleApprove = async () => {
    if (kanban.approveTask && kanban.currentUserId) {
      await kanban.approveTask(task.id, kanban.currentUserId);
      await kanban.addComment(task.id, '[APPROVED] \u2705 Approved this task');
    }
  };

  const handleRequestChanges = async () => {
    if (kanban.requestChanges) {
      await kanban.requestChanges(task.id);
      await kanban.addComment(task.id, '[CHANGES_REQUESTED] \u{1F504} Requested changes on this task');
    }
  };

  const handleFinalApprove = async () => {
    await kanban.moveTask(task.id, 'approved');
    await kanban.addComment(task.id, '[FINAL_APPROVED] \u2705 Final review approved \u2014 moving to APPROVED');
  };

  const handleSendBack = async () => {
    await kanban.moveTask(task.id, 'peer_review');
    await kanban.addComment(task.id, '[SENT_BACK] \u{1F504} Sent back to peer review');
  };

  const assignedAgent = assignedAgentId
    ? kanban.agents.find(a => a.id === assignedAgentId)
    : null;
  const assignedMember = assignedTo
    ? kanban.members.find(m => m.id === assignedTo)
    : null;

  const currentCol = COLUMNS.find(c => c.key === task.status) || COLUMNS[1];

  // Peer review data
  const isPeerReview = task.status === 'peer_review';
  const isFinalReview = task.status === 'review';
  const peerApprovals = task.peer_approvals || [];
  const goalData = goals?.find(g => g.id === task.goal_id);
  const goalAgentIds = goalData?.assigned_agent_ids || [];

  const timeSince = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <View style={s.overlay}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior="padding" style={s.modalWrap}>
        <View style={s.modal}>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Peer Review Banner */}
            {isPeerReview && (
              <View style={s.reviewBanner}>
                <View style={[s.reviewBannerDot, { backgroundColor: '#a855f7' }]} />
                <Text style={s.reviewBannerText}>PEER REVIEW</Text>
              </View>
            )}
            {isFinalReview && (
              <View style={[s.reviewBanner, { backgroundColor: '#f9731608' }]}>
                <View style={[s.reviewBannerDot, { backgroundColor: '#f97316' }]} />
                <Text style={[s.reviewBannerText, { color: '#f97316' }]}>FINAL REVIEW</Text>
              </View>
            )}

            {/* Header */}
            <View style={s.headerRow}>
              <View style={s.headerLeft}>
                <View style={[s.columnIndicator, { backgroundColor: currentCol.color + '15' }]}>
                  <View style={[s.columnDot, { backgroundColor: currentCol.color }]} />
                  <Text style={[s.columnLabel, { color: currentCol.color }]}>{currentCol.label}</Text>
                </View>
              </View>
              <View style={s.headerActions}>
                {!editing ? (
                  <Pressable onPress={() => setEditing(true)} style={s.headerBtn}>
                    <Text style={s.editBtnText}>Edit</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={handleSave} style={[s.headerBtn, s.saveBtnBg]}>
                    <Text style={s.saveBtnText}>Save</Text>
                  </Pressable>
                )}
                <Pressable onPress={onClose} style={s.closeBtn}>
                  <Text style={s.closeBtnText}>x</Text>
                </Pressable>
              </View>
            </View>

            {/* Status progress */}
            <View style={s.statusBar}>
              {COLUMNS.map((col, i) => {
                const isActive = col.key === task.status;
                const isPast = COLUMNS.findIndex(c => c.key === task.status) >= i;
                return (
                  <Pressable
                    key={col.key}
                    onPress={() => kanban.moveTask(task.id, col.key)}
                    style={[
                      s.statusStep,
                      isPast && { backgroundColor: col.color + '12' },
                      isActive && { backgroundColor: col.color + '20', borderColor: col.color + '40' },
                    ]}
                  >
                    <View style={[s.statusDot, isPast ? { backgroundColor: col.color } : { backgroundColor: '#2a2a3e' }]} />
                    <Text style={[
                      s.statusStepText,
                      isActive ? { color: col.color } : isPast ? { color: '#9090a8' } : { color: '#444455' },
                    ]}>
                      {col.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Peer Review Panel */}
            {isPeerReview && goalAgentIds.length > 0 && (
              <View style={s.peerPanel}>
                <Text style={s.peerPanelTitle}>Reviewers</Text>
                {goalAgentIds.map((aid, i) => {
                  const approved = peerApprovals.includes(aid);
                  const agent = kanban.agents.find(a => a.id === aid);
                  const roster = DEFAULT_AGENT_ROSTER.find(r => agent?.name?.toLowerCase().includes(r.name.toLowerCase()));
                  return (
                    <View key={i} style={s.peerRow}>
                      <View style={[s.peerIcon, approved ? { backgroundColor: '#22c55e20' } : { backgroundColor: '#1a1a28' }]}>
                        {roster ? (
                          <Text style={s.peerEmoji}>{roster.emoji}</Text>
                        ) : (
                          <Text style={[s.peerInitial, approved && { color: '#22c55e' }]}>
                            {(agent?.name || '?')[0].toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <Text style={s.peerName}>{agent?.name || aid}</Text>
                      {approved ? (
                        <View style={s.peerApprovedBadge}>
                          <Text style={s.peerApprovedText}>{'\u2713'} Approved</Text>
                        </View>
                      ) : (
                        <View style={s.peerPendingBadge}>
                          <Text style={s.peerPendingText}>{'\u23F3'} Pending</Text>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Peer review action buttons */}
                <View style={s.peerActions}>
                  <Pressable onPress={handleApprove} style={s.approveBtn}>
                    <Text style={s.approveBtnText}>{'\u2713'} Approve</Text>
                  </Pressable>
                  <Pressable onPress={handleRequestChanges} style={s.changesBtn}>
                    <Text style={s.changesBtnText}>{'\u{1F504}'} Request Changes</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Final Review Panel */}
            {isFinalReview && (
              <View style={[s.peerPanel, { borderColor: '#f9731620' }]}>
                <Text style={[s.peerPanelTitle, { color: '#f97316' }]}>Final Review</Text>
                <Text style={s.peerPanelSub}>
                  This task has passed peer review. Approve to mark as complete or send it back.
                </Text>
                <View style={s.peerActions}>
                  <Pressable onPress={handleFinalApprove} style={s.approveBtn}>
                    <Text style={s.approveBtnText}>{'\u2713'} Approve & Complete</Text>
                  </Pressable>
                  <Pressable onPress={handleSendBack} style={s.changesBtn}>
                    <Text style={s.changesBtnText}>{'\u{1F504}'} Send Back</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Title */}
            <Text style={s.sectionLabel}>Title</Text>
            {editing ? (
              <TextInput
                style={s.input}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
              />
            ) : (
              <Text style={s.titleText}>{task.title}</Text>
            )}

            {/* Description */}
            <Text style={s.sectionLabel}>Description</Text>
            {editing ? (
              <TextInput
                style={[s.input, s.textArea]}
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={500}
                placeholder="Add details..."
                placeholderTextColor="#333348"
              />
            ) : (
              <Text style={[s.fieldValue, !task.description && s.fieldEmpty]}>
                {task.description || 'No description'}
              </Text>
            )}

            {/* Priority */}
            <Text style={s.sectionLabel}>Priority</Text>
            {editing ? (
              <View style={s.chipRow}>
                {(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map(p => {
                  const active = priority === p;
                  const color = PRIORITY_COLORS[p];
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setPriority(p)}
                      style={[s.chip, active && { backgroundColor: color + '15', borderColor: color + '30' }]}
                    >
                      {active && <View style={[s.chipDot, { backgroundColor: color }]} />}
                      <Text style={[s.chipText, active && { color }]}>{PRIORITY_LABELS[p]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[s.inlineBadge, { backgroundColor: PRIORITY_COLORS[task.priority] + '15' }]}>
                <Text style={{ color: PRIORITY_COLORS[task.priority], fontSize: 12, fontWeight: '600' }}>
                  {PRIORITY_LABELS[task.priority]}
                </Text>
              </View>
            )}

            {/* Assignee */}
            <Text style={s.sectionLabel}>Assigned to</Text>
            {editing ? (
              <View>
                <Pressable onPress={() => setShowAssignees(p => !p)} style={s.assigneeToggle}>
                  <View style={s.assigneeToggleLeft}>
                    {(assignedAgent || assignedMember) && (
                      <View style={[s.assigneeAvatar, { backgroundColor: assignedAgent?.color || '#6366f1' }]}>
                        <Text style={s.assigneeAvatarText}>
                          {(assignedAgent ? assignedAgent.name : (assignedMember?.display_name || assignedMember?.username || '?'))[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text style={s.assigneeToggleText}>
                      {assignedAgent ? assignedAgent.name
                        : assignedMember ? (assignedMember.display_name || assignedMember.username)
                        : 'Unassigned'}
                    </Text>
                  </View>
                  <Text style={s.assigneeToggleArrow}>{showAssignees ? '-' : '+'}</Text>
                </Pressable>
                {showAssignees && (
                  <View style={s.assigneeList}>
                    <Pressable
                      onPress={() => { setAssignedTo(null); setAssignedAgentId(null); setShowAssignees(false); }}
                      style={[s.assigneeOption, !assignedTo && !assignedAgentId && s.assigneeOptionActive]}
                    >
                      <Text style={s.assigneeOptionText}>Unassigned</Text>
                    </Pressable>
                    {kanban.members.length > 0 && (
                      <Text style={s.assigneeSectionLabel}>Members</Text>
                    )}
                    {kanban.members.map(m => (
                      <Pressable
                        key={m.id}
                        onPress={() => { setAssignedTo(m.id); setAssignedAgentId(null); setShowAssignees(false); }}
                        style={[s.assigneeOption, assignedTo === m.id && s.assigneeOptionActive]}
                      >
                        <View style={s.assigneeOptionRow}>
                          <View style={[s.assigneeAvatar, { backgroundColor: '#6366f1' }]}>
                            <Text style={s.assigneeAvatarText}>
                              {(m.display_name || m.username || '?')[0].toUpperCase()}
                            </Text>
                          </View>
                          <Text style={s.assigneeOptionText}>{m.display_name || m.username}</Text>
                        </View>
                      </Pressable>
                    ))}
                    {kanban.agents.length > 0 && (
                      <Text style={s.assigneeSectionLabel}>Agents</Text>
                    )}
                    {kanban.agents.map(a => (
                      <Pressable
                        key={a.id}
                        onPress={() => { setAssignedAgentId(a.id); setAssignedTo(null); setShowAssignees(false); }}
                        style={[s.assigneeOption, assignedAgentId === a.id && s.assigneeOptionActive]}
                      >
                        <View style={s.assigneeOptionRow}>
                          <View style={[s.assigneeAvatar, { backgroundColor: a.color || '#6366f1' }]}>
                            <Text style={s.assigneeAvatarText}>{a.name[0].toUpperCase()}</Text>
                          </View>
                          <Text style={s.assigneeOptionText}>{a.name}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={s.assigneeDisplay}>
                {(task.assignee || assignedAgent) ? (
                  <View style={s.assigneeRow}>
                    <View style={[s.assigneeAvatar, { backgroundColor: assignedAgent?.color || '#6366f1' }]}>
                      <Text style={s.assigneeAvatarText}>
                        {(assignedAgent ? assignedAgent.name : (task.assignee?.display_name || task.assignee?.username || '?'))[0].toUpperCase()}
                      </Text>
                    </View>
                    <Text style={s.fieldValue}>
                      {assignedAgent ? assignedAgent.name : (task.assignee?.display_name || task.assignee?.username)}
                    </Text>
                  </View>
                ) : (
                  <Text style={s.fieldEmpty}>Unassigned</Text>
                )}
              </View>
            )}

            {/* Due date */}
            <Text style={s.sectionLabel}>Due date</Text>
            {editing ? (
              <TextInput
                style={s.input}
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#333348"
                maxLength={10}
              />
            ) : (
              <Text style={[s.fieldValue, !task.due_date && s.fieldEmpty]}>
                {task.due_date || 'No due date'}
              </Text>
            )}

            {/* Meta */}
            <View style={s.metaRow}>
              <Text style={s.metaText}>
                Created {timeSince(task.created_at)}
                {task.creator ? ` by ${task.creator.display_name || task.creator.username}` : ''}
              </Text>
              {task.completed_at && (
                <Text style={[s.metaText, { color: '#22c55e' }]}>
                  Completed {timeSince(task.completed_at)}
                </Text>
              )}
            </View>

            {/* Delete */}
            <Pressable onPress={() => setShowDelete(p => !p)} style={s.deleteToggle}>
              <Text style={s.deleteToggleText}>Delete task</Text>
            </Pressable>
            {showDelete && (
              <View style={s.deleteConfirm}>
                <Text style={s.deleteWarning}>This cannot be undone.</Text>
                <Pressable onPress={handleDelete} style={s.deleteBtn}>
                  <Text style={s.deleteBtnText}>Confirm delete</Text>
                </Pressable>
              </View>
            )}

            {/* Comments section */}
            <View style={s.commentSection}>
              <Text style={s.commentHeader}>Comments ({comments.length})</Text>

              {comments.map(c => {
                const isApproval = c.content.startsWith('[APPROVED]');
                const isChanges = c.content.startsWith('[CHANGES_REQUESTED]');
                const isFinal = c.content.startsWith('[FINAL_APPROVED]');
                const isSentBack = c.content.startsWith('[SENT_BACK]');
                const isAction = isApproval || isChanges || isFinal || isSentBack;
                const actionColor = isApproval || isFinal ? '#22c55e' : isChanges || isSentBack ? '#f59e0b' : undefined;

                return (
                  <View key={c.id} style={[s.comment, isAction && { backgroundColor: (actionColor || '#6366f1') + '08' }]}>
                    <View style={s.commentMeta}>
                      <View style={s.commentAuthorRow}>
                        <View style={[s.commentAvatar, isAction && { backgroundColor: actionColor + '20' }]}>
                          <Text style={[s.commentAvatarText, isAction && { color: actionColor }]}>
                            {((c.user as any)?.display_name || (c.user as any)?.username || '?')[0].toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[s.commentAuthor, isAction && { color: actionColor }]}>
                          {(c.user as any)?.display_name || (c.user as any)?.username || 'User'}
                        </Text>
                      </View>
                      <Text style={s.commentTime}>{timeSince(c.created_at)}</Text>
                    </View>
                    <Text style={[s.commentContent, isAction && { color: actionColor }]}>{c.content}</Text>
                  </View>
                );
              })}

              {comments.length === 0 && (
                <Text style={s.noComments}>No comments yet</Text>
              )}
            </View>
          </ScrollView>

          {/* Comment input */}
          <View style={s.commentInput}>
            <TextInput
              style={s.commentField}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment..."
              placeholderTextColor="#444455"
              onSubmitEditing={handleAddComment}
              returnKeyType="send"
            />
            <Pressable
              onPress={handleAddComment}
              style={[s.commentSend, !commentText.trim() && { opacity: 0.3 }]}
              disabled={!commentText.trim()}
            >
              <Text style={s.commentSendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
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

  // Review banners
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#a855f708',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  reviewBannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  reviewBannerText: {
    color: '#a855f7',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Peer review panel
  peerPanel: {
    backgroundColor: '#a855f706',
    borderWidth: 1,
    borderColor: '#a855f720',
    borderRadius: 10,
    padding: 14,
    gap: 8,
    marginBottom: 16,
  },
  peerPanelTitle: {
    color: '#a855f7',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  peerPanelSub: {
    color: '#9090a8',
    fontSize: 12,
    lineHeight: 17,
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  peerIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  peerEmoji: {
    fontSize: 12,
  },
  peerInitial: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '700',
  },
  peerName: {
    color: '#c0c0d0',
    fontSize: 13,
    flex: 1,
  },
  peerApprovedBadge: {
    backgroundColor: '#22c55e15',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  peerApprovedText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '600',
  },
  peerPendingBadge: {
    backgroundColor: '#f59e0b10',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  peerPendingText: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '600',
  },
  peerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  approveBtn: {
    backgroundColor: '#22c55e15',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  approveBtnText: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '600',
  },
  changesBtn: {
    backgroundColor: '#f59e0b10',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  changesBtnText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '600',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  columnIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  columnDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  columnLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1a1a28',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  editBtnText: {
    color: '#9090a8',
    fontSize: 12,
    fontWeight: '600',
  },
  saveBtnBg: {
    backgroundColor: '#6366f1',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 12,
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
    fontSize: 16,
    fontWeight: '400',
  },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 24,
  },
  statusStep: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusStepText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // Fields
  sectionLabel: {
    color: '#6b6b80',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  titleText: {
    color: '#e4e4ed',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  fieldValue: {
    color: '#c0c0d0',
    fontSize: 14,
    lineHeight: 20,
  },
  fieldEmpty: {
    color: '#444455',
    fontStyle: 'italic',
  },
  input: {
    backgroundColor: '#0c0c14',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    color: '#e4e4ed',
    fontSize: 14,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    borderRadius: 20,
    backgroundColor: '#0c0c14',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555566',
  },
  inlineBadge: {
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },

  // Assignee
  assigneeToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0c0c14',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  assigneeToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assigneeToggleText: {
    color: '#c0c0d0',
    fontSize: 13,
  },
  assigneeToggleArrow: {
    color: '#555566',
    fontSize: 16,
    fontWeight: '300',
  },
  assigneeList: {
    backgroundColor: '#0c0c14',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#1a1a28',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    maxHeight: 220,
    overflow: 'hidden',
  },
  assigneeSectionLabel: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  assigneeOption: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#15151e',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  assigneeOptionActive: {
    backgroundColor: '#15151e',
  },
  assigneeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assigneeOptionText: {
    color: '#c0c0d0',
    fontSize: 13,
  },
  assigneeAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assigneeAvatarText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  assigneeDisplay: {},
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Meta
  metaRow: {
    marginTop: 20,
    gap: 4,
  },
  metaText: {
    color: '#444455',
    fontSize: 12,
  },

  // Delete
  deleteToggle: {
    marginTop: 14,
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

  // Comments
  commentSection: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    paddingTop: 16,
  },
  commentHeader: {
    color: '#6b6b80',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  comment: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#0c0c14',
  },
  commentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  commentAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1a1a28',
    justifyContent: 'center',
    alignItems: 'center',
  },
  commentAvatarText: {
    color: '#6b6b80',
    fontSize: 9,
    fontWeight: '700',
  },
  commentAuthor: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '600',
  },
  commentTime: {
    color: '#444455',
    fontSize: 11,
  },
  commentContent: {
    color: '#c0c0d0',
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 26,
  },
  noComments: {
    color: '#333348',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // Comment input
  commentInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    padding: 12,
    backgroundColor: '#0e0e16',
  },
  commentField: {
    flex: 1,
    backgroundColor: '#0c0c14',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#e4e4ed',
    fontSize: 13,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  commentSend: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  commentSendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
