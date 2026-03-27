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
  KanbanTask, TaskComment, TaskAttachment, TaskStatus, TaskPriority, FocusChainItem,
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
  addComment: (taskId: string, content: string, attachments?: TaskAttachment[]) => Promise<void>;
  uploadTaskFile: (taskId: string, file: File) => Promise<TaskAttachment | null>;
  // Agent
  runAgentOnTask: (taskId: string, agentId?: string, options?: AgentRunOptions) => Promise<string | null>;
  // Focus chain & planning
  updateFocusChain: (taskId: string, chain: FocusChainItem[]) => Promise<void>;
  toggleTaskMode: (taskId: string, mode: 'plan' | 'execute') => Promise<void>;
  recordTaskCost: (taskId: string, cost: number, tokens: number, durationMs: number) => Promise<void>;
  // Refresh
  refresh: () => void;
}

export type ThinkingLevel = 'fast' | 'balanced' | 'deep';
export type AgentModel = 'auto' | 'blackswan' | 'claude-haiku' | 'claude-sonnet' | 'claude-opus';
export type AgentMode = 'execute' | 'plan';

export interface AgentRunOptions {
  thinkingLevel?: ThinkingLevel;
  model?: AgentModel;
  mode?: AgentMode;
}

export interface CreateTaskFields {
  title: string;
  description?: string;
  image_url?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigned_to?: string | null;
  assigned_agent_id?: string | null;
  due_date?: string | null;
  goal_id?: string | null;
  plan_id?: string | null;
  plan_step_id?: string | null;
  focus_chain?: FocusChainItem[];
  mode?: 'plan' | 'execute';
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
      image_url: fields.image_url || null,
      priority: fields.priority || 'normal',
      status,
      assigned_to: fields.assigned_to || null,
      assigned_agent_id: fields.assigned_agent_id || null,
      due_date: fields.due_date || null,
      goal_id: fields.goal_id || null,
      plan_id: fields.plan_id || null,
      plan_step_id: fields.plan_step_id || null,
      focus_chain: fields.focus_chain || null,
      mode: fields.mode || null,
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

  const addComment = useCallback(async (taskId: string, content: string, attachments?: TaskAttachment[]) => {
    if (!currentUserId || (!content.trim() && (!attachments || attachments.length === 0))) return;
    const insert: any = {
      task_id: taskId,
      user_id: currentUserId,
      content: content.trim(),
    };
    if (attachments && attachments.length > 0) {
      insert.attachments = attachments;
    }
    const { error } = await supabase.from('task_comments').insert(insert);
    if (error) console.error('addComment error:', error);
  }, [currentUserId]);

  // ─── Upload file for task comment ─────────────────────────────────
  const uploadTaskFile = useCallback(async (taskId: string, file: File): Promise<TaskAttachment | null> => {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const path = `${taskId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('task-images')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadError) { console.error('uploadTaskFile error:', uploadError); return null; }
      const { data: urlData } = supabase.storage.from('task-images').getPublicUrl(path);
      if (!urlData?.publicUrl) return null;

      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
      const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yaml', 'yml', 'toml', 'sql', 'sh', 'md'];
      const type: TaskAttachment['type'] = imageExts.includes(ext) ? 'image'
        : codeExts.includes(ext) ? 'code' : 'file';

      return {
        url: urlData.publicUrl,
        name: file.name,
        type,
        mime: file.type || undefined,
        size: file.size || undefined,
        language: type === 'code' ? ext : undefined,
      };
    } catch (err) {
      console.error('uploadTaskFile unexpected:', err);
      return null;
    }
  }, []);

  // ─── Run agent on task ──────────────────────────────────────────────
  const runAgentOnTask = useCallback(async (taskId: string, agentId?: string, options?: AgentRunOptions): Promise<string | null> => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !currentUserId) return null;

    const targetAgentId = agentId || 'blackswan-default';
    const targetAgent = agents.find(a => a.id === targetAgentId);
    const targetAgentName = targetAgent?.name || 'BlackSwan';

    const thinkingLevel = options?.thinkingLevel || 'balanced';
    const model = options?.model && options.model !== 'auto' ? options.model : undefined;
    const mode = options?.mode || 'execute';

    // Fetch existing comments for full context
    let commentHistory = '';
    try {
      const existingComments = await fetchComments(taskId);
      if (existingComments.length > 0) {
        const recent = existingComments.slice(-15);
        commentHistory = '\n\n--- COMMENT HISTORY ---\n' + recent.map(c => {
          const author = c.agent_id ? `[Agent]` : (c.user?.display_name || c.user?.username || 'User');
          return `${author}: ${c.content}`;
        }).join('\n');
      }
    } catch {} // non-critical

    // Build rich prompt with full task context
    const parts: string[] = [];

    if (mode === 'plan') {
      parts.push(`You are in PLANNING MODE. Analyze this task and return a structured implementation plan.`);
      parts.push(`Do NOT execute — only plan. Your plan should include:`);
      parts.push(`1. A brief analysis of what needs to be done`);
      parts.push(`2. Step-by-step implementation plan with clear deliverables`);
      parts.push(`3. Dependencies or blockers`);
      parts.push(`4. Estimated complexity (simple / moderate / complex)`);
      parts.push(`5. Recommended approach and alternatives considered`);
      parts.push(`Format the plan with clear headings and numbered steps.`);
    } else {
      parts.push(`You have been assigned a task. Read it carefully, figure out what needs to be done, and provide a complete, actionable answer.`);
    }

    parts.push(``);
    parts.push(`=== TASK ===`);
    parts.push(`Title: ${task.title}`);
    parts.push(`Status: ${task.status}`);
    parts.push(`Priority: ${task.priority}`);
    if (task.description) parts.push(`Description: ${task.description}`);
    if (task.image_url) parts.push(`Image: ${task.image_url}`);
    if (task.due_date) parts.push(`Due: ${task.due_date}`);
    if (task.assignee) parts.push(`Assigned to: ${task.assignee.display_name || task.assignee.username}`);
    if (task.goal) parts.push(`Goal: ${task.goal.name} (${task.goal.status})`);
    if (commentHistory) parts.push(commentHistory);

    if (mode !== 'plan') {
      parts.push(``);
      parts.push(`=== INSTRUCTIONS ===`);
      parts.push(`1. Analyze what this task is asking for`);
      parts.push(`2. Do the work — write the code, draft the content, research the answer, build the plan, or whatever the task requires`);
      parts.push(`3. Return your complete deliverable, not just a summary of what you would do`);
      parts.push(`4. If the task asks for code, write the full working code`);
      parts.push(`5. If the task asks for content, write the full content`);
      parts.push(`6. If you need information you don't have, say exactly what's missing and provide the best answer you can with what you know`);
      parts.push(`7. Be direct. No filler. Deliver the actual work product.`);
    }

    const message = parts.join('\n');

    try {
      const { data, error } = await supabase.functions.invoke('swanbot-ai', {
        body: { message, circleId, userId: currentUserId, targetAgentName, thinkingLevel, model },
      });

      if (error) {
        console.error('runAgentOnTask error:', error);
        return null;
      }

      const response = data?.reply || data?.response || data?.message || 'Agent completed task (no output)';

      // Extract code blocks as attachments
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
      const attachments: TaskAttachment[] = [];
      let match;
      while ((match = codeBlockRegex.exec(response)) !== null) {
        const lang = match[1] || 'text';
        const code = match[2].trim();
        if (code.length > 10) {
          attachments.push({
            url: '', // inline code, no URL needed
            name: `code.${lang}`,
            type: 'code',
            language: lang,
          });
        }
      }

      // Post the response as a comment with agent attribution + attachments
      const modeTag = mode === 'plan' ? '[PLAN]' : '[EXEC]';
      const modelTag = model ? ` | ${model}` : '';
      const thinkTag = thinkingLevel !== 'balanced' ? ` | ${thinkingLevel}` : '';
      const insert: any = {
        task_id: taskId,
        user_id: currentUserId,
        agent_id: targetAgentId,
        content: `[AGENT: ${targetAgentName}] ${modeTag}${modelTag}${thinkTag}\n${response}`,
      };
      if (attachments.length > 0) insert.attachments = attachments;
      await supabase.from('task_comments').insert(insert);

      return response;
    } catch (err) {
      console.error('runAgentOnTask unexpected:', err);
      return null;
    }
  }, [tasks, agents, currentUserId, circleId, fetchComments]);

  // Update focus chain
  const updateFocusChain = useCallback(async (taskId: string, chain: FocusChainItem[]) => {
    const { error } = await supabase.from('tasks').update({ focus_chain: chain }).eq('id', taskId);
    if (error) console.error('updateFocusChain error:', error);
    else fetchTasks();
  }, [fetchTasks]);

  // Toggle task mode
  const toggleTaskMode = useCallback(async (taskId: string, mode: 'plan' | 'execute') => {
    const { error } = await supabase.from('tasks').update({ mode }).eq('id', taskId);
    if (error) console.error('toggleTaskMode error:', error);
    else fetchTasks();
  }, [fetchTasks]);

  // Record task cost (increments)
  // NOTE: This fetch-then-update pattern minimizes but does not fully eliminate
  // race conditions. A proper fix would use a Supabase RPC/database function
  // with atomic increment (e.g., SET total_cost = total_cost + $1).
  const recordTaskCost = useCallback(async (taskId: string, cost: number, tokens: number, durationMs: number) => {
    // Fetch the current task values from the database to minimize stale-data races
    const { data: freshTask, error: fetchError } = await supabase
      .from('tasks')
      .select('total_cost, total_tokens, total_duration_ms, agent_runs')
      .eq('id', taskId)
      .single();

    if (fetchError || !freshTask) {
      console.error('recordTaskCost fetch error:', fetchError);
      return;
    }

    const { error } = await supabase.from('tasks').update({
      total_cost: (freshTask.total_cost || 0) + cost,
      total_tokens: (freshTask.total_tokens || 0) + tokens,
      total_duration_ms: (freshTask.total_duration_ms || 0) + durationMs,
      agent_runs: (freshTask.agent_runs || 0) + 1,
    }).eq('id', taskId);
    if (error) console.error('recordTaskCost error:', error);
    else fetchTasks();
  }, [fetchTasks]);

  const refresh = useCallback(() => {
    fetchTasks();
    fetchMembers();
    fetchAgents();
  }, [fetchTasks, fetchMembers, fetchAgents]);

  return {
    tasks, tasksByColumn, members, agents, currentUserId, loading,
    createTask, moveTask, updateTask, deleteTask,
    approveTask, requestChanges,
    updateFocusChain, toggleTaskMode, recordTaskCost,
    fetchComments, addComment, uploadTaskFile, runAgentOnTask, refresh,
  };
}
