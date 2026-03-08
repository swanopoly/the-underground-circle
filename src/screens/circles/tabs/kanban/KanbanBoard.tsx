/**
 * KanbanBoard — layout with drag-and-drop between columns (7 columns)
 * Desktop: horizontal scroll, all columns visible
 * Mobile: column tabs + single active column
 */

import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { KanbanTask, KanbanColumnDef, TaskStatus, TasksByColumn } from '../../../../types/kanban';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import type { GoalWithCount } from '../../../../hooks/useGoals';
import KanbanColumn from './KanbanColumn';

interface Props {
  columns: KanbanColumnDef[];
  tasksByColumn: TasksByColumn;
  agents: CircleOfficeAgent[];
  goals?: GoalWithCount[];
  onCardPress: (task: KanbanTask) => void;
  onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
  onQuickAdd: (status: TaskStatus, title: string) => void;
  onAddTask: (status: TaskStatus) => void;
}

const MOBILE_BREAKPOINT = 768;

export default function KanbanBoard({
  columns, tasksByColumn, agents, goals,
  onCardPress, onMoveTask, onQuickAdd, onAddTask,
}: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const [activeColumn, setActiveColumn] = useState<TaskStatus>('todo');

  // Drag state
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [draggingTask, setDraggingTask] = useState<KanbanTask | null>(null);

  const handleDragStart = useCallback((task: KanbanTask) => {
    setDraggingTask(task);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingTask(null);
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback((columnKey: TaskStatus, taskId: string) => {
    onMoveTask(taskId, columnKey);
    setDragOverColumn(null);
    setDraggingTask(null);
  }, [onMoveTask]);

  // Total task count
  const totalTasks = Object.values(tasksByColumn).reduce((sum, arr) => sum + arr.length, 0);

  if (isMobile) {
    const col = columns.find(c => c.key === activeColumn) || columns[1];
    return (
      <View style={s.mobileContainer}>
        {/* Column selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.tabBar}
          contentContainerStyle={s.tabBarContent}
        >
          {columns.map(c => {
            const isActive = c.key === activeColumn;
            const count = tasksByColumn[c.key]?.length || 0;
            return (
              <Pressable
                key={c.key}
                onPress={() => setActiveColumn(c.key)}
                style={[s.tab, isActive && s.tabActive]}
              >
                <Text style={[s.tabIcon, { color: isActive ? c.color : '#333348' }]}>{c.icon}</Text>
                <Text style={[s.tabText, isActive && { color: '#e4e4ed' }]}>{c.label}</Text>
                <View style={[s.tabBadge, isActive && { backgroundColor: c.color + '20' }]}>
                  <Text style={[s.tabBadgeText, isActive && { color: c.color }]}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <KanbanColumn
          column={col}
          tasks={tasksByColumn[col.key] || []}
          agents={agents}
          goals={goals}
          isFullWidth
          onCardPress={onCardPress}
          onMoveTask={onMoveTask}
          onQuickAdd={(title) => onQuickAdd(col.key, title)}
          onAddTask={() => onAddTask(col.key)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      </View>
    );
  }

  // Desktop
  return (
    <View style={s.desktopContainer}>
      {/* Board header */}
      <View style={s.boardHeader}>
        <Text style={s.boardTitle}>{totalTasks} tasks</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.scrollView}
        contentContainerStyle={s.scrollContent}
      >
        {columns.map(col => (
          <KanbanColumn
            key={col.key}
            column={col}
            tasks={tasksByColumn[col.key] || []}
            agents={agents}
            goals={goals}
            isDragOver={dragOverColumn === col.key && draggingTask?.status !== col.key}
            onCardPress={onCardPress}
            onMoveTask={onMoveTask}
            onQuickAdd={(title) => onQuickAdd(col.key, title)}
            onAddTask={() => onAddTask(col.key)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragEnter={() => setDragOverColumn(col.key)}
            onDragLeave={() => { if (dragOverColumn === col.key) setDragOverColumn(null); }}
            onDrop={(taskId) => handleDrop(col.key, taskId)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  // Desktop
  desktopContainer: {
    flex: 1,
  },
  boardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  boardTitle: {
    color: '#555566',
    fontSize: 12,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
    paddingRight: 20,
  },

  // Mobile
  mobileContainer: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: '#0a0a12',
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
    flexGrow: 0,
  },
  tabBarContent: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  tabActive: {
    backgroundColor: '#15151e',
  },
  tabIcon: {
    fontSize: 11,
    fontWeight: '700',
  },
  tabText: {
    color: '#555566',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tabBadge: {
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: '#111119',
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#555566',
  },
});
