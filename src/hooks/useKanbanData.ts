/**
 * useKanbanData — data hook for the Kanban board
 *
 * Loads tasks grouped by column, members, agents. Provides CRUD + realtime.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { awardXP, getXPForAction } from '../lib/gamification';
import { loadCircleOfficeAgents, CircleOfficeAgent } from '../lib/circleOffice';
import {
  KanbanTask, TaskComment, TaskStatus, TaskPriority,
  TasksByColumn, groupByColumn, normalizeStatus,
} from '../types/kanban';

export interface KanbanMember {
  id: string;
  username: string;
  display_name: string;
}

export interface KanbanData {
  tasks: KanbanTask[];
  tasksByColumn: TasksByColumn;
  members: KanbanMember[];
  agents: CircleOfficeAgent[];
  currentUserId: string | null;
  loading: boolean;
  // CRUD
  createTask: (fields: CreateTaskFields) => Promise<void>;
  moveTask: (taskId: string, newStatus: TaskStatus) => Promise<void>;
  updateTask: (taskId: string, fields: Partial<KanbanTask>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  // Peer review
  approveTask: (taskId: string, agentId: string) => Promise<void>;
  requestChanges: (taskId: string) => Promise<void>;
  // Comments
  fetchComments: (taskId: string) => Promise<TaskComment[]>;
  addComment: (taskId: string, content: string) => Promise<void>;
  // Refresh
  refresh: () => void;
}

export interface CreateTaskFields {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigned_to?: string | null;
  assigned_agent_id?: string | null;
  due_date?: string | null;
  goal_id?: string | null;
}

export function useKanbanData(circleId: string): KanbanData {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [members, setMembers] = useState<KanbanMember[]>([]);
  const [agents, setAgents] = useState<CircleOfficeAgent[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(0);

  // ─── Fetch tasks ─────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    const id = ++fetchRef.current;
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, creator:profiles!tasks_created_by_fkey(username, display_name), assignee:profiles!tasks_assigned_to_fkey(username, display_name), goal:goals!tasks_goal_id_fkey(id, name, status)')
        .eq('circle_id', circleId)
        .order('position', { ascending: true })
        .limit(200);

      if (id !== fetchRef.current) return; // stale
      if (error) { console.error('fetchTasks error:', error); return; }

      setTasks((data || []).map(t => ({
        ...t,
        status: normalizeStatus(t.status),
        peer_approvals: Array.isArray(t.peer_approvals) ? t.peer_approvals : [],
      })));
    } catch (err) {
      console.error('fetchTasks unexpected:', err);
    }
  }, [circleId]);

  // ─── Fetch members ──────────────────────────────────────────────────────
  const fetchMembers = useCallback(async () => {
    const { data } = await supabase
      .from('circle_members')
      .select('user:profiles(id, username, display_name)')
      .eq('circle_id', circleId)
      .limit(50);

    setMembers((data || []).map((m: any) => m.user).filter(Boolean));
  }, [circleId]);

  // ─── Fetch agents ──────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    const { agents: a } = await loadCircleOfficeAgents(circleId);
    setAgents(a);
  }, [circleId]);

  // ─── Initial load + auth ────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (mounted && user) setCurrentUserId(user.id);
      await Promise.all([fetchTasks(), fetchMembers(), fetchAgents()]);
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [fetchTasks, fetchMembers, fetchAgents]);

  // ─── Realtime subscription ──────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`tasks-kanban-${circleId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tasks',
        filter: `circle_id=eq.${circleId}`,
      }, () => fetchTasks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId, fetchTasks]);

  // ─── Grouped data ──────────────────────────────────────────────────────
  const tasksByColumn = useMemo(() => groupByColumn(tasks), [tasks]);

  // ─── Create task ───────────────────────────────────────────────────────
  const createTask = useCallback(async (fields: CreateTaskFields) => {
    if (!currentUserId || !fields.title.trim()) return;
    const status = fields.status || 'todo';

    // Position: append to end of target column
    const colTasks = tasks.filter(t => normalizeStatus(t.status) === status);
    const maxPos = colTasks.length > 0 ? Math.max(...colTasks.map(t => t.position)) : -1;

    await supabase.from('tasks').insert({
      circle_id: circleId,
      created_by: currentUserId,
      title: fields.title.trim(),
      description: fields.description?.trim() || null,
      priority: fields.priority || 'normal',
      status,
      assigned_to: fields.assigned_to || null,
      assigned_agent_id: fields.assigned_agent_id || null,
      due_date: fields.due_date || null,
      goal_id: fields.goal_id || null,
      position: maxPos + 1,
    });
  }, [circleId, currentUserId, tasks]);

  // ─── Move task ─────────────────────────────────────────────────────────
  const moveTask = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    // Optimistic: move locally first
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: newStatus, completed_at: newStatus === 'done' ? new Date().toISOString() : null } : t
    ));

    // Position: append to end of target column
    const colTasks = tasks.filter(t => normalizeStatus(t.status) === newStatus && t.id !== taskId);
    const maxPos = colTasks.length > 0 ? Math.max(...colTasks.map(t => t.position)) : -1;

    const update: any = {
      status: newStatus,
      position: maxPos + 1,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
    };

    const { error } = await supabase.from('tasks').update(update).eq('id', taskId);
    if (error) {
      console.error('moveTask error:', error);
      fetchTasks(); // revert optimistic
      return;
    }

    // Award XP when moved to done
    if (newStatus === 'done' && currentUserId) {
      awardXP(currentUserId, getXPForAction('task_complete'), 'task_complete', { task_id: taskId }).catch(console.error);
    }
  }, [tasks, currentUserId, fetchTasks]);

  // ─── Update task ───────────────────────────────────────────────────────
  const updateTask = useCallback(async (taskId: string, fields: Partial<KanbanTask>) => {
    const { error } = await supabase.from('tasks').update(fields).eq('id', taskId);
    if (error) console.error('updateTask error:', error);
    else fetchTasks();
  }, [fetchTasks]);

  // ─── Delete task ───────────────────────────────────────────────────────
  const deleteTask = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) { console.error('deleteTask error:', error); fetchTasks(); }
  }, [fetchTasks]);

  // ─── Approve task (peer review) ────────────────────────────────────────
  const approveTask = useCallback(async (taskId: string, agentId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const current: string[] = Array.isArray(task.peer_approvals) ? task.peer_approvals : [];
    if (current.includes(agentId)) return; // already approved
    const updated = [...current, agentId];

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, peer_approvals: updated } : t));

    const { error } = await supabase
      .from('tasks')
      .update({ peer_approvals: updated })
      .eq('id', taskId);
    if (error) { console.error('approveTask error:', error); fetchTasks(); }
  }, [tasks, fetchTasks]);

  // ─── Request changes (send back to in_progress, clear approvals) ─────
  const requestChanges = useCallback(async (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'in_progress' as TaskStatus, peer_approvals: [] } : t
    ));
    const { error } = await supabase
      .from('tasks')
      .update({ status: 'in_progress', peer_approvals: [] })
      .eq('id', taskId);
    if (error) { console.error('requestChanges error:', error); fetchTasks(); }
  }, [fetchTasks]);

  // ─── Comments ──────────────────────────────────────────────────────────
  const fetchComments = useCallback(async (taskId: string): Promise<TaskComment[]> => {
    const { data, error } = await supabase
      .from('task_comments')
      .select('*, user:profiles!task_comments_user_id_fkey(username, display_name)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (error) { console.error('fetchComments error:', error); return []; }
    return data || [];
  }, []);

  const addComment = useCallback(async (taskId: string, content: string) => {
    if (!currentUserId || !content.trim()) return;
    const { error } = await supabase.from('task_comments').insert({
      task_id: taskId,
      user_id: currentUserId,
      content: content.trim(),
    });
    if (error) console.error('addComment error:', error);
  }, [currentUserId]);

  const refresh = useCallback(() => {
    fetchTasks();
    fetchMembers();
    fetchAgents();
  }, [fetchTasks, fetchMembers, fetchAgents]);

  return {
    tasks, tasksByColumn, members, agents, currentUserId, loading,
    createTask, moveTask, updateTask, deleteTask,
    approveTask, requestChanges,
    fetchComments, addComment, refresh,
  };
}
