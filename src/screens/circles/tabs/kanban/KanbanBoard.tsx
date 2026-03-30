/**
 * KanbanBoard — layout with drag-and-drop between columns (7 columns)
 * Desktop: horizontal scroll, all columns visible
 * Mobile: column tabs + single active column
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { KanbanTask, KanbanColumnDef, TaskStatus, TaskPriority, TasksByColumn } from '../../../../types/kanban';
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
  onBatchMove?: (taskIds: string[], newStatus: TaskStatus) => void;
  onArchiveDone?: (taskIds: string[]) => void;
  externalSearchText?: string;
  externalFilterPriority?: TaskPriority | null;
  externalFilterAssignee?: string | null;
}

const MOBILE_BREAKPOINT = 768;

export default function KanbanBoard({
  columns, tasksByColumn, agents, goals,
  onCardPress, onMoveTask, onQuickAdd, onAddTask,
  onBatchMove, onArchiveDone,
  externalSearchText, externalFilterPriority, externalFilterAssignee,
}: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const [activeColumn, setActiveColumn] = useState<TaskStatus>('todo');

  // Search & filter values (controlled externally by FeedTab)
  const searchText = externalSearchText ?? '';
  const filterPriority = externalFilterPriority ?? null;
  const filterAssignee = externalFilterAssignee ?? null;

  // Apply search + filters to tasksByColumn
  const filteredTasksByColumn = useMemo(() => {
    const q = searchText.toLowerCase().trim();
    const hasFilters = q || filterPriority || filterAssignee;
    if (!hasFilters) return tasksByColumn;

    const result = {} as TasksByColumn;
    for (const key of Object.keys(tasksByColumn) as TaskStatus[]) {
      result[key] = tasksByColumn[key].filter(t => {
        if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false;
        if (filterPriority && t.priority !== filterPriority) return false;
        if (filterAssignee) {
          if (filterAssignee.startsWith('agent:')) {
            const assignedAgentIds = t.assigned_agent_ids || (t.assigned_agent_id ? [t.assigned_agent_id] : []);
            if (!assignedAgentIds.includes(filterAssignee.slice(6))) return false;
          } else {
            if (t.assigned_to !== filterAssignee) return false;
          }
        }
        return true;
      });
    }
    return result;
  }, [tasksByColumn, searchText, filterPriority, filterAssignee]);

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
            const count = filteredTasksByColumn[c.key]?.length || 0;
            return (
              <Pressable
                key={c.key}
                onPress={() => setActiveColumn(c.key)}
                style={[s.tab, isActive && s.tabActive]}
              >
                <Text style={[s.tabIcon, { color: isActive ? c.color : '#3e3e3e' }]}>{c.icon}</Text>
                <Text style={[s.tabText, isActive && { color: '#6366f1' }]}>{c.label}</Text>
                <View style={[s.tabBadge, isActive && { backgroundColor: c.color + '20' }]}>
                  <Text style={[s.tabBadgeText, isActive && { color: c.color }]}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <KanbanColumn
          column={col}
          tasks={filteredTasksByColumn[col.key] || []}
          agents={agents}
          goals={goals}
          isFullWidth
          onCardPress={onCardPress}
          onMoveTask={onMoveTask}
          onQuickAdd={(title) => onQuickAdd(col.key, title)}
          onAddTask={() => onAddTask(col.key)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onBatchMove={onBatchMove}
          onArchiveDone={onArchiveDone}
        />
      </View>
    );
  }

  // Desktop
  return (
    <View style={s.desktopContainer}>
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
            tasks={filteredTasksByColumn[col.key] || []}
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
            onBatchMove={onBatchMove}
            onArchiveDone={onArchiveDone}
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
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
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
    backgroundColor: '#1a1a1a',
  },
  tabIcon: {
    fontSize: 11,
    fontWeight: '700',
  },
  tabText: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tabBadge: {
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: '#0a0a0a',
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6f6f6f',
  },
});
