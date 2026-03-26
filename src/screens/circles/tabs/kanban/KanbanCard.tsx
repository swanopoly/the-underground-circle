/**
 * KanbanCard — HQ Dashboard task card with goal tag, priority badge, time-ago, peer review indicator
 * Supports HTML5 drag-and-drop on web + move menu on mobile
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Image } from 'react-native';
import { KanbanTask, TaskStatus, PRIORITY_COLORS, COLUMNS, DEFAULT_AGENT_ROSTER, MODEL_ICONS } from '../../../../types/kanban';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import type { GoalWithCount } from '../../../../hooks/useGoals';

interface Props {
  task: KanbanTask;
  agents: CircleOfficeAgent[];
  goals?: GoalWithCount[];
  onPress: () => void;
  onMove: (taskId: string, newStatus: TaskStatus) => void;
  onDragStart?: (task: KanbanTask) => void;
  onDragEnd?: () => void;
}

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

function daysBetween(startStr: string, endStr: string): number {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function isStale(task: KanbanTask): boolean {
  if (task.status !== 'backlog' && task.status !== 'todo') return false;
  const ms = Date.now() - new Date(task.created_at).getTime();
  return ms > 7 * 24 * 60 * 60 * 1000;
}

function priorityBadge(priority: string): { label: string; color: string } {
  if (priority === 'urgent') return { label: 'H', color: '#ef4444' };
  if (priority === 'high') return { label: 'H', color: '#f97316' };
  if (priority === 'normal') return { label: 'M', color: '#f59e0b' };
  return { label: 'L', color: '#3b82f6' };
}

function getDueDateInfo(dueDate: string | null): { label: string; color: string } | null {
  if (!dueDate) return null;
  const now = new Date();
  const due = new Date(dueDate + 'T23:59:59');
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const overdue = Math.abs(diffDays);
    return { label: `${overdue}d overdue`, color: '#ef4444' };
  }
  if (diffDays === 0) return { label: 'Due today', color: '#f59e0b' };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, color: '#f59e0b' };
  return { label: `Due ${diffDays}d`, color: '#6f6f6f' };
}

export default function KanbanCard({ task, agents, goals, onPress, onMove, onDragStart, onDragEnd }: Props) {
  const [hovered, setHovered] = useState(false);
  const [showMoveBar, setShowMoveBar] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isDone = task.status === 'done';
  const isPeerReview = task.status === 'peer_review';
  const dueDateInfo = !isDone ? getDueDateInfo(task.due_date) : null;
  const dragRef = useRef<View>(null);

  const assignedAgent = task.assigned_agent_id
    ? agents.find(a => a.id === task.assigned_agent_id)
    : null;

  // Resolve goal from joined data or from goals list
  const goalData = task.goal
    || (task.goal_id && goals ? goals.find(g => g.id === task.goal_id) : null);

  // Peer review info — determine how many agents on the goal to get total reviewers
  const peerApprovals = task.peer_approvals || [];
  const goalAgentIds = goalData && 'assigned_agent_ids' in goalData
    ? (goalData as GoalWithCount).assigned_agent_ids || []
    : [];
  const totalReviewers = Math.max(goalAgentIds.length, 1);
  const approvedCount = peerApprovals.length;

  const pb = priorityBadge(task.priority);

  // Attach native HTML5 drag events via ref — RNW View refs resolve to DOM elements
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = dragRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;

    node.setAttribute('draggable', 'true');
    node.style.cursor = 'grab';

    const handleDragStart = (e: DragEvent) => {
      e.dataTransfer!.setData('text/plain', task.id);
      e.dataTransfer!.effectAllowed = 'move';
      setIsDragging(true);
      onDragStart?.(task);
    };

    const handleDragEnd = () => {
      setIsDragging(false);
      onDragEnd?.();
    };

    node.addEventListener('dragstart', handleDragStart);
    node.addEventListener('dragend', handleDragEnd);

    return () => {
      node.removeEventListener('dragstart', handleDragStart);
      node.removeEventListener('dragend', handleDragEnd);
    };
  }, [task.id, onDragStart, onDragEnd]);

  return (
    <View style={s.wrapper}>
      <View
        ref={dragRef}
        style={[
          s.card,
          hovered && !isDragging && s.cardHovered,
          isDone && s.cardDone,
          isPeerReview && s.cardPeerReview,
          isDragging && s.cardDragging,
        ]}
      >
        <Pressable
          onPress={onPress}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={s.cardInner}
        >
          {/* Drag handle */}
          {Platform.OS === 'web' && (
            <View style={s.dragHandle}>
              <Text style={s.dragHandleText}>⠿</Text>
            </View>
          )}

          {/* Title */}
          <Text style={[s.title, isDone && s.titleDone]} numberOfLines={2}>{task.title}</Text>

          {/* Description preview */}
          {task.description ? (
            <Text style={s.descriptionPreview} numberOfLines={1}>
              {task.description.length > 60 ? task.description.slice(0, 60) + '...' : task.description}
            </Text>
          ) : null}

          {/* Image thumbnail */}
          {task.image_url && (
            <Image source={{ uri: task.image_url }} style={s.thumbnail} resizeMode="cover" />
          )}

          {/* Goal tag */}
          {goalData && (
            <View style={s.goalTag}>
              <View style={[s.goalDot, { backgroundColor: goalData.status === 'active' ? '#22c55e' : goalData.status === 'paused' ? '#f59e0b' : '#6f6f6f' }]} />
              <Text style={s.goalName} numberOfLines={1}>{goalData.name}</Text>
            </View>
          )}

          {/* Peer review indicator */}
          {isPeerReview && (
            <View style={s.reviewRow}>
              <View style={s.reviewAvatars}>
                {goalAgentIds.slice(0, 5).map((aid, i) => {
                  const approved = peerApprovals.includes(aid);
                  const agent = agents.find(a => a.id === aid);
                  const roster = DEFAULT_AGENT_ROSTER.find(r => agent?.name?.toLowerCase().includes(r.name.toLowerCase()));
                  return (
                    <View
                      key={i}
                      style={[
                        s.reviewAvatar,
                        { backgroundColor: approved ? '#22c55e15' : '#1a1a1a', borderColor: approved ? '#22c55e30' : '#3e3e3e' },
                      ]}
                    >
                      {roster ? (
                        <Text style={s.reviewAvatarEmoji}>{roster.emoji}</Text>
                      ) : (
                        <Text style={[s.reviewAvatarText, approved && { color: '#22c55e' }]}>
                          {approved ? '\u2713' : (agent?.name || '?')[0].toUpperCase()}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={[s.reviewCount, approvedCount >= totalReviewers && { color: '#22c55e' }]}>
                {approvedCount}/{totalReviewers}
              </Text>
            </View>
          )}

          {/* Footer */}
          <View style={s.footer}>
            <View style={s.footerLeft}>
              <Text style={s.toolIcon}>{'\u270E'}</Text>
            </View>

            <View style={s.footerRight}>
              {/* Agent avatar + model indicator */}
              {assignedAgent ? (
                <>
                  <View style={[s.avatar, { backgroundColor: assignedAgent.color || '#9e9e9e' }]}>
                    <Text style={s.avatarText}>{assignedAgent.name[0].toUpperCase()}</Text>
                  </View>
                  {(() => {
                    const roster = DEFAULT_AGENT_ROSTER.find(r =>
                      assignedAgent.name?.toLowerCase().includes(r.name.toLowerCase())
                    );
                    const mi = roster ? MODEL_ICONS[roster.preferredModel] : null;
                    return mi ? (
                      <View style={[s.modelPill, { backgroundColor: mi.color + '15' }]}>
                        <Text style={{ fontSize: 8, lineHeight: 10 }}>{mi.icon}</Text>
                      </View>
                    ) : null;
                  })()}
                </>
              ) : task.assignee ? (
                <View style={[s.avatar, { backgroundColor: '#9e9e9e' }]}>
                  <Text style={s.avatarText}>
                    {(task.assignee.display_name || task.assignee.username || '?')[0].toUpperCase()}
                  </Text>
                </View>
              ) : null}

              {/* Priority badge */}
              <View style={[s.priorityBadge, { backgroundColor: pb.color + '18' }]}>
                <Text style={[s.priorityText, { color: pb.color }]}>{pb.label}</Text>
              </View>

              {/* Comment count badge */}
              {task.review_comments_count != null && task.review_comments_count > 0 && (
                <View style={s.commentBadge}>
                  <Text style={s.commentText}>{'\uD83D\uDCAC'} {task.review_comments_count}</Text>
                </View>
              )}

              {/* Stale task indicator */}
              {!isDone && isStale(task) && (
                <Text style={s.staleIcon}>{'\u23F3'}</Text>
              )}

              {/* Due date urgency */}
              {dueDateInfo && (
                <View style={[s.dueBadge, { backgroundColor: dueDateInfo.color + '15' }]}>
                  <Text style={[s.dueText, { color: dueDateInfo.color }]}>{dueDateInfo.label}</Text>
                </View>
              )}

              {/* Time ago / Completion time */}
              {isDone && task.completed_at ? (
                <Text style={s.completionText}>Done in {daysBetween(task.created_at, task.completed_at)}d</Text>
              ) : (
                <Text style={s.timeText}>{timeAgo(task.created_at)}</Text>
              )}

              {/* Move menu trigger (mobile fallback) */}
              <Pressable
                onPress={(e: any) => { e.stopPropagation?.(); setShowMoveBar(p => !p); }}
                style={[s.moveBtn, showMoveBar && s.moveBtnActive]}
                hitSlop={6}
              >
                <Text style={s.moveBtnText}>{'...'}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </View>

      {/* Move bar */}
      {showMoveBar && (
        <View style={s.moveBar}>
          {COLUMNS.filter(c => c.key !== task.status).map(col => (
            <Pressable
              key={col.key}
              onPress={() => { onMove(task.id, col.key); setShowMoveBar(false); }}
              style={s.moveChip}
            >
              <View style={[s.moveChipDot, { backgroundColor: col.color }]} />
              <Text style={[s.moveChipText, { color: col.color }]}>{col.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#161616',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? {
      transition: 'all 0.2s cubic-bezier(.4,0,.2,1)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    } as any : {}),
  },
  cardInner: {
    padding: 12,
    gap: 8,
  },
  cardHovered: {
    borderColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? {
      transform: [{ translateY: -1 }],
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    } as any : {}),
  },
  cardDragging: {
    opacity: 0.4,
    ...(Platform.OS === 'web' ? {
      transform: [{ scale: 0.97 }],
      boxShadow: '0 0 0 2px #ffffff30',
    } as any : {}),
  },
  cardDone: {
    opacity: 0.45,
  },
  cardPeerReview: {
    borderColor: '#a855f715',
    backgroundColor: '#a855f706',
  },
  dragHandle: {
    position: 'absolute' as any,
    top: 4,
    right: 6,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.3,
    ...(Platform.OS === 'web' ? { cursor: 'grab' } as any : {}),
  },
  dragHandleText: {
    color: '#9e9e9e',
    fontSize: 10,
    lineHeight: 12,
  },
  title: {
    color: '#e8e8e8',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 19,
  },
  titleDone: {
    textDecorationLine: 'line-through',
    color: '#6f6f6f',
  },
  descriptionPreview: {
    color: '#6f6f6f',
    fontSize: 9,
    lineHeight: 13,
    marginTop: -4,
  },
  thumbnail: {
    width: '100%' as any,
    height: 80,
    borderRadius: 4,
    marginTop: 4,
    backgroundColor: '#1a1a1a',
  },
  goalTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  goalDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  goalName: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '600',
    maxWidth: 140,
  },
  // Peer review
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reviewAvatars: {
    flexDirection: 'row',
    gap: 3,
  },
  reviewAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewAvatarEmoji: {
    fontSize: 9,
  },
  reviewAvatarText: {
    color: '#6f6f6f',
    fontSize: 8,
    fontWeight: '700',
  },
  reviewCount: {
    color: '#9e9e9e',
    fontSize: 10,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolIcon: {
    color: '#6f6f6f',
    fontSize: 13,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  modelPill: {
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -4,
  },
  priorityBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  priorityText: {
    fontSize: 9,
    fontWeight: '800',
  },
  dueBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  dueText: {
    fontSize: 9,
    fontWeight: '700',
  },
  timeText: {
    color: '#3e3e3e',
    fontSize: 10,
    fontWeight: '500',
  },
  commentBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#3b82f620',
  },
  commentText: {
    color: '#3b82f6',
    fontSize: 9,
    fontWeight: '700',
  },
  staleIcon: {
    fontSize: 10,
    color: '#f59e0b',
  },
  completionText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '600',
  },
  moveBtn: {
    width: 22,
    height: 22,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  moveBtnActive: {
    backgroundColor: '#1a1a1a',
  },
  moveBtnText: {
    color: '#6f6f6f',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 13,
    letterSpacing: 1,
  },
  moveBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    marginTop: 4,
  },
  moveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  moveChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  moveChipText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
