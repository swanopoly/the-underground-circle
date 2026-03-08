/**
 * KanbanBoard — layout with drag-and-drop between columns (7 columns)
 * Desktop: horizontal scroll, all columns visible
 * Mobile: column tabs + single active column
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { KanbanTask, KanbanColumnDef, TaskStatus, TaskPriority, TasksByColumn, PRIORITY_LABELS } from '../../../../types/kanban';
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
  searchInputRef?: React.RefObject<TextInput | null>;
  onBatchMove?: (taskIds: string[], newStatus: TaskStatus) => void;
  onArchiveDone?: (taskIds: string[]) => void;
}

const MOBILE_BREAKPOINT = 768;

export default function KanbanBoard({
  columns, tasksByColumn, agents, goals,
  onCardPress, onMoveTask, onQuickAdd, onAddTask,
  searchInputRef, onBatchMove, onArchiveDone,
}: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const [activeColumn, setActiveColumn] = useState<TaskStatus>('todo');

  // Search & filter state
  const [searchText, setSearchText] = useState('');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | null>(null);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);

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
            if (t.assigned_agent_id !== filterAssignee.slice(6)) return false;
          } else {
            if (t.assigned_to !== filterAssignee) return false;
          }
        }
        return true;
      });
    }
    return result;
  }, [tasksByColumn, searchText, filterPriority, filterAssignee]);

  // Collect unique assignees for filter chips
  const assigneeOptions = useMemo(() => {
    const opts: { id: string; label: string; color: string }[] = [];
    const seen = new Set<string>();
    const allTasks = Object.values(tasksByColumn).flat();
    for (const t of allTasks) {
      if (t.assigned_agent_id && !seen.has('agent:' + t.assigned_agent_id)) {
        seen.add('agent:' + t.assigned_agent_id);
        const agent = agents.find(a => a.id === t.assigned_agent_id);
        opts.push({ id: 'agent:' + t.assigned_agent_id, label: agent?.name || 'Agent', color: agent?.color || '#6366f1' });
      }
      if (t.assigned_to && !seen.has(t.assigned_to)) {
        seen.add(t.assigned_to);
        opts.push({ id: t.assigned_to, label: t.assignee?.display_name || t.assignee?.username || 'User', color: '#6366f1' });
      }
    }
    return opts;
  }, [tasksByColumn, agents]);

  const hasActiveFilters = searchText || filterPriority || filterAssignee;

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
  const totalTasks = Object.values(filteredTasksByColumn).reduce((sum, arr) => sum + arr.length, 0);

  // Search & filter bar (shared between desktop + mobile)
  const filterBar = (
    <View style={s.filterBar}>
      <View style={s.searchRow}>
        <Text style={s.searchIcon}>/</Text>
        <TextInput
          ref={searchInputRef as any}
          style={s.searchInput}
          placeholder="Search tasks..."
          placeholderTextColor="#444455"
          value={searchText}
          onChangeText={setSearchText}
          maxLength={100}
        />
        {hasActiveFilters && (
          <Pressable onPress={() => { setSearchText(''); setFilterPriority(null); setFilterAssignee(null); }} style={s.clearBtn}>
            <Text style={s.clearBtnText}>Clear</Text>
          </Pressable>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterChips}>
        {(['urgent', 'high', 'normal', 'low'] as TaskPriority[]).map(p => {
          const active = filterPriority === p;
          return (
            <Pressable key={p} onPress={() => setFilterPriority(active ? null : p)} style={[s.filterChip, active && s.filterChipActive]}>
              <Text style={[s.filterChipText, active && { color: '#e4e4ed' }]}>{PRIORITY_LABELS[p]}</Text>
            </Pressable>
          );
        })}
        {assigneeOptions.map(opt => {
          const active = filterAssignee === opt.id;
          return (
            <Pressable key={opt.id} onPress={() => setFilterAssignee(active ? null : opt.id)} style={[s.filterChip, active && { backgroundColor: opt.color + '18', borderColor: opt.color + '30' }]}>
              <View style={[s.filterChipDot, { backgroundColor: opt.color }]} />
              <Text style={[s.filterChipText, active && { color: opt.color }]} numberOfLines={1}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  if (isMobile) {
    const col = columns.find(c => c.key === activeColumn) || columns[1];
    return (
      <View style={s.mobileContainer}>
        {filterBar}
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
      {filterBar}
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
  // Filter bar
  filterBar: {
    backgroundColor: '#0a0a12',
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111119',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a28',
    paddingHorizontal: 8,
  },
  searchIcon: {
    color: '#444455',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    color: '#c0c0d0',
    fontSize: 12,
    paddingVertical: 7,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  clearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1e1e2e',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  clearBtnText: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '600',
  },
  filterChips: {
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 2,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    backgroundColor: '#0c0c14',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  filterChipActive: {
    backgroundColor: '#1a1a28',
    borderColor: '#3a3a50',
  },
  filterChipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  filterChipText: {
    color: '#555566',
    fontSize: 10,
    fontWeight: '600',
  },
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
