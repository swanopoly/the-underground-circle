/**
 * KanbanColumn — column with drag-and-drop target zone, 7-column support
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { KanbanTask, KanbanColumnDef, TaskStatus, COLUMNS, PRIORITY_COLORS } from '../../../../types/kanban';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import type { GoalWithCount } from '../../../../hooks/useGoals';
import KanbanCard from './KanbanCard';

interface Props {
  column: KanbanColumnDef;
  tasks: KanbanTask[];
  agents: CircleOfficeAgent[];
  goals?: GoalWithCount[];
  isFullWidth?: boolean;
  isDragOver?: boolean;
  onCardPress: (task: KanbanTask) => void;
  onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
  onQuickAdd: (title: string) => void;
  onAddTask: () => void;
  onDragStart?: (task: KanbanTask) => void;
  onDragEnd?: () => void;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
  onDrop?: (taskId: string) => void;
  onBatchMove?: (taskIds: string[], newStatus: TaskStatus) => void;
  onArchiveDone?: (taskIds: string[]) => void;
}

export default function KanbanColumn({
  column, tasks, agents, goals, isFullWidth, isDragOver,
  onCardPress, onMoveTask, onQuickAdd, onAddTask,
  onDragStart, onDragEnd, onDragEnter, onDragLeave, onDrop,
  onBatchMove, onArchiveDone,
}: Props) {
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddFocused, setQuickAddFocused] = useState(false);
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const dropRef = useRef<View>(null);

  // Priority breakdown for batch menu
  const priorityBreakdown = tasks.reduce((acc, t) => {
    acc[t.priority] = (acc[t.priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Archive: tasks completed > 7 days ago
  const archivableTasks = column.key === 'done' ? tasks.filter(t => {
    if (!t.completed_at) return false;
    const daysSince = (Date.now() - new Date(t.completed_at).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 7;
  }) : [];

  const handleQuickAdd = () => {
    const title = quickAddText.trim();
    if (!title) return;
    onQuickAdd(title);
    setQuickAddText('');
  };

  // Attach native HTML5 drop events via ref for reliable drop handling
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = dropRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };

    const handleDragEnterEvt = (e: DragEvent) => {
      e.preventDefault();
      onDragEnter?.();
    };

    const handleDragLeaveEvt = (e: DragEvent) => {
      // Only fire if truly leaving the column (not entering a child)
      if (node.contains(e.relatedTarget as Node)) return;
      onDragLeave?.();
    };

    const handleDropEvt = (e: DragEvent) => {
      e.preventDefault();
      const taskId = e.dataTransfer?.getData('text/plain');
      if (taskId) onDrop?.(taskId);
    };

    node.addEventListener('dragover', handleDragOver);
    node.addEventListener('dragenter', handleDragEnterEvt);
    node.addEventListener('dragleave', handleDragLeaveEvt);
    node.addEventListener('drop', handleDropEvt);

    return () => {
      node.removeEventListener('dragover', handleDragOver);
      node.removeEventListener('dragenter', handleDragEnterEvt);
      node.removeEventListener('dragleave', handleDragLeaveEvt);
      node.removeEventListener('drop', handleDropEvt);
    };
  }, [onDragEnter, onDragLeave, onDrop]);

  return (
    <View
      ref={dropRef}
      style={[
        s.column,
        isFullWidth && s.columnFull,
        isDragOver && s.columnDragOver,
        isDragOver && { borderColor: column.color + '60', backgroundColor: column.color + '08' },
      ]}
    >
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={[s.headerIcon, { color: column.color }]}>{column.icon}</Text>
          <Text style={s.headerLabel}>{column.label}</Text>
          <View style={[s.countPill, { backgroundColor: column.color + '15' }]}>
            <Text style={[s.countText, { color: column.color }]}>{tasks.length}</Text>
          </View>
        </View>
        <View style={s.headerRight}>
          {tasks.length > 0 && (
            <Pressable onPress={() => { setShowBatchMenu(p => !p); setConfirmArchive(false); }} style={[s.batchBtn, showBatchMenu && s.batchBtnActive]} hitSlop={4}>
              <Text style={s.batchBtnText}>...</Text>
            </Pressable>
          )}
          <Pressable onPress={onAddTask} style={s.addBtn} hitSlop={6}>
            <Text style={s.addBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      {/* Batch actions menu */}
      {showBatchMenu && (
        <View style={s.batchMenu}>
          {/* Priority breakdown */}
          <View style={s.batchSection}>
            <Text style={s.batchSectionLabel}>PRIORITY</Text>
            <View style={s.batchPriorityRow}>
              {Object.entries(priorityBreakdown).map(([p, count]) => (
                <View key={p} style={s.batchPriorityPill}>
                  <View style={[s.batchPriorityDot, { backgroundColor: PRIORITY_COLORS[p as keyof typeof PRIORITY_COLORS] || '#555' }]} />
                  <Text style={s.batchPriorityText}>{p}: {count}</Text>
                </View>
              ))}
            </View>
          </View>
          {/* Move all */}
          <View style={s.batchSection}>
            <Text style={s.batchSectionLabel}>MOVE ALL TO</Text>
            <View style={s.batchMoveRow}>
              {COLUMNS.filter(c => c.key !== column.key).map(c => (
                <Pressable
                  key={c.key}
                  onPress={() => {
                    if (onBatchMove && tasks.length > 0) {
                      onBatchMove(tasks.map(t => t.id), c.key);
                    }
                    setShowBatchMenu(false);
                  }}
                  style={s.batchMoveChip}
                >
                  <View style={[s.batchMoveDot, { backgroundColor: c.color }]} />
                  <Text style={[s.batchMoveText, { color: c.color }]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {/* Archive done */}
          {column.key === 'done' && archivableTasks.length > 0 && (
            !confirmArchive ? (
              <Pressable
                onPress={() => setConfirmArchive(true)}
                style={s.batchArchiveBtn}
              >
                <Text style={s.batchArchiveText}>Archive {archivableTasks.length} old tasks</Text>
              </Pressable>
            ) : (
              <View style={s.batchArchiveConfirm}>
                <Text style={s.batchArchiveWarning}>{archivableTasks.length} tasks will be permanently deleted</Text>
                <View style={s.batchArchiveActions}>
                  <Pressable
                    onPress={() => {
                      if (onArchiveDone) onArchiveDone(archivableTasks.map(t => t.id));
                      setShowBatchMenu(false);
                      setConfirmArchive(false);
                    }}
                    style={s.batchArchiveConfirmBtn}
                  >
                    <Text style={s.batchArchiveConfirmText}>Delete</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmArchive(false)} style={s.batchArchiveCancelBtn}>
                    <Text style={s.batchArchiveCancelText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )
          )}
        </View>
      )}

      {/* Drop indicator */}
      {isDragOver && (
        <View style={[s.dropIndicator, { backgroundColor: column.color + '15', borderColor: column.color + '40' }]}>
          <Text style={[s.dropText, { color: column.color }]}>Drop to move here</Text>
        </View>
      )}

      {/* Cards list */}
      <FlatList
        data={tasks}
        keyExtractor={t => t.id}
        renderItem={({ item }) => (
          <KanbanCard
            task={item}
            agents={agents}
            goals={goals}
            onPress={() => onCardPress(item)}
            onMove={onMoveTask}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        )}
        style={s.list}
        contentContainerStyle={[s.listContent, tasks.length === 0 && s.listContentEmpty]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !isDragOver ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>{column.icon}</Text>
              <Text style={s.emptyText}>No tasks</Text>
            </View>
          ) : null
        }
      />

      {/* Quick add */}
      <View style={[s.quickAdd, quickAddFocused && s.quickAddFocused]}>
        <TextInput
          style={s.quickInput}
          placeholder="+ Add a task..."
          placeholderTextColor="#444455"
          value={quickAddText}
          onChangeText={setQuickAddText}
          onSubmitEditing={handleQuickAdd}
          onFocus={() => setQuickAddFocused(true)}
          onBlur={() => setQuickAddFocused(false)}
          maxLength={200}
          returnKeyType="done"
        />
        {quickAddText.trim() ? (
          <Pressable onPress={handleQuickAdd} style={s.submitBtn}>
            <Text style={s.submitBtnText}>Add</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onAddTask} style={s.expandBtn}>
            <Text style={s.expandBtnText}>+</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  column: {
    width: 240,
    minWidth: 240,
    backgroundColor: '#0c0c14',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#1a1a28',
    marginRight: 10,
    flexShrink: 0,
    maxHeight: '100%',
    ...(Platform.OS === 'web' ? {
      transition: 'border-color 0.2s ease, background-color 0.2s ease',
    } as any : {}),
  },
  columnFull: {
    width: '100%' as any,
    flex: 1,
    marginRight: 0,
    borderRadius: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  columnDragOver: {
    // Colors applied inline with column.color
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIcon: {
    fontSize: 12,
    fontWeight: '700',
  },
  headerLabel: {
    color: '#9090a8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  countPill: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  batchBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  batchBtnActive: {
    backgroundColor: '#1e1e2e',
  },
  batchBtnText: {
    color: '#555566',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    lineHeight: 12,
  },
  batchMenu: {
    marginHorizontal: 8,
    marginBottom: 6,
    backgroundColor: '#0e0e16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    padding: 8,
    gap: 8,
  },
  batchSection: {
    gap: 4,
  },
  batchSectionLabel: {
    color: '#555566',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  batchPriorityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  batchPriorityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#15151e',
  },
  batchPriorityDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  batchPriorityText: {
    color: '#6b6b80',
    fontSize: 9,
    fontWeight: '600',
  },
  batchMoveRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  batchMoveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#15151e',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  batchMoveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  batchMoveText: {
    fontSize: 9,
    fontWeight: '600',
  },
  batchArchiveBtn: {
    backgroundColor: '#ef444412',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  batchArchiveText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '600',
  },
  batchArchiveConfirm: {
    padding: 8,
    gap: 6,
  },
  batchArchiveWarning: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '500',
  },
  batchArchiveActions: {
    flexDirection: 'row',
    gap: 6,
  },
  batchArchiveConfirmBtn: {
    backgroundColor: '#ef444420',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  batchArchiveConfirmText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '600',
  },
  batchArchiveCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  batchArchiveCancelText: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '600',
  },
  addBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#15151e',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addBtnText: {
    color: '#6b6b80',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 16,
  },
  dropIndicator: {
    marginHorizontal: 10,
    marginBottom: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed' as any,
    alignItems: 'center',
  },
  dropText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  listContentEmpty: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 6,
  },
  emptyIcon: {
    color: '#333333',
    fontSize: 20,
    fontWeight: '900',
  },
  emptyText: {
    color: '#333348',
    fontSize: 12,
    fontWeight: '500',
  },
  quickAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#15151e',
    ...(Platform.OS === 'web' ? { transition: 'border-color 0.15s' } as any : {}),
  },
  quickAddFocused: {
    borderTopColor: '#2a2a40',
  },
  quickInput: {
    flex: 1,
    color: '#c0c0d0',
    fontSize: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#111119',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a28',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', transition: 'border-color 0.15s' } as any : {}),
  },
  submitBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  expandBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#15151e',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  expandBtnText: {
    color: '#555566',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 18,
  },
});
