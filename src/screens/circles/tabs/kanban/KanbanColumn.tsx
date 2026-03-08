/**
 * KanbanColumn — column with drag-and-drop target zone, 7-column support
 */

import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { KanbanTask, KanbanColumnDef, TaskStatus } from '../../../../types/kanban';
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
}

export default function KanbanColumn({
  column, tasks, agents, goals, isFullWidth, isDragOver,
  onCardPress, onMoveTask, onQuickAdd, onAddTask,
  onDragStart, onDragEnd, onDragEnter, onDragLeave, onDrop,
}: Props) {
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddFocused, setQuickAddFocused] = useState(false);

  const handleQuickAdd = () => {
    const title = quickAddText.trim();
    if (!title) return;
    onQuickAdd(title);
    setQuickAddText('');
  };

  const webDropProps = Platform.OS === 'web' ? {
    onDragOver: (e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDragEnter: (e: any) => { e.preventDefault(); onDragEnter?.(); },
    onDragLeave: (e: any) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      onDragLeave?.();
    },
    onDrop: (e: any) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData('text/plain');
      if (taskId) onDrop?.(taskId);
    },
  } : {};

  return (
    <View
      style={[
        s.column,
        isFullWidth && s.columnFull,
        isDragOver && s.columnDragOver,
        isDragOver && { borderColor: column.color + '50' },
      ]}
      {...webDropProps}
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
        <Pressable onPress={onAddTask} style={s.addBtn} hitSlop={6}>
          <Text style={s.addBtnText}>+</Text>
        </Pressable>
      </View>

      {/* Drop indicator */}
      {isDragOver && (
        <View style={[s.dropIndicator, { backgroundColor: column.color + '12', borderColor: column.color + '30' }]}>
          <Text style={[s.dropText, { color: column.color }]}>Drop here</Text>
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
    borderWidth: 1,
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
    backgroundColor: '#0f0f1a',
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
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed' as any,
    alignItems: 'center',
  },
  dropText: {
    fontSize: 11,
    fontWeight: '600',
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
    color: '#2a2a3e',
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
