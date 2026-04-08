/**
 * useKanbanData � data hook for the Kanban board
 *
 * Loads tasks grouped by column, members, agents. Provides CRUD + realtime.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { awardXP, getXPForAction } from '../lib/gamification';
import { invokeDirect } from '../lib/agentInvocation';
import { wakeAndAssignTask } from '../lib/bridgeTaskDispatcher';
import { inferTaskCapabilityProfile, getTaskCapabilityProfile } from '../lib/taskCapabilityProfiles';
import {
  createInitialTaskRunSteps, appendTaskRunStep, createTaskRunArtifact,
  ensureTaskAcceptanceChecks, evaluateTaskRunChecks, canTaskRunMarkComplete,
} from '../lib/taskExecutionRuntime';
import { loadCircleOfficeAgents, CircleOfficeAgent, createBlackSwanAgent } from '../lib/circleOffice';
import {
  KanbanTask,
  TaskComment,
  TaskAttachment,
  TaskStatus,
  TaskPriority,
  FocusChainItem,
  TasksByColumn,
  groupByColumn,
  normalizeStatus,
  TaskCompletionPolicy,
  TaskAgentAssignment,
  TaskRun,
  TaskRunOutput,
  TaskRunStatus,
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
  createTask: (fields: CreateTaskFields) => Promise<void>;
  moveTask: (taskId: string, newStatus: TaskStatus) => Promise<void>;
  updateTask: (taskId: string, fields: Partial<KanbanTask>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  approveTask: (taskId: string, agentId: string) => Promise<void>;
  requestChanges: (taskId: string) => Promise<void>;
  fetchComments: (taskId: string) => Promise<TaskComment[]>;
  addComment: (taskId: string, content: string, attachments?: TaskAttachment[]) => Promise<void>;
  uploadTaskFile: (taskId: string, file: File) => Promise<TaskAttachment | null>;
  fetchTaskRuns: (taskId: string) => Promise<TaskRun[]>;
  runAgentOnTask: (taskId: string, agentId?: string, options?: AgentRunOptions) => Promise<string | null>;
  updateFocusChain: (taskId: string, chain: FocusChainItem[]) => Promise<void>;
  toggleTaskMode: (taskId: string, mode: 'plan' | 'execute') => Promise<void>;
  recordTaskCost: (taskId: string, cost: number, tokens: number, durationMs: number) => Promise<void>;
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
  assigned_agent_ids?: string[];
  completion_policy?: TaskCompletionPolicy;
  due_date?: string | null;
  goal_id?: string | null;
  plan_id?: string | null;
  plan_step_id?: string | null;
  focus_chain?: FocusChainItem[];
  mode?: 'plan' | 'execute';
}

const TASK_RUN_MARKER_START = '[[TASK_RUN_JSON]]';
const TASK_RUN_MARKER_END = '[[/TASK_RUN_JSON]]';
const TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'peer_review', 'review', 'approved', 'done'];

function uniqueAgentIds(...sources: Array<Array<string | null | undefined> | string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const source of sources) {
    const values = Array.isArray(source) ? source : [source];
    for (const value of values) {
      const agentId = typeof value === 'string' ? value.trim() : '';
      if (!agentId || seen.has(agentId)) continue;
      seen.add(agentId);
      output.push(agentId);
    }
  }
  return output;
}

function normalizeTask(task: any): KanbanTask {
  const assignedAgentIds = uniqueAgentIds(task.assigned_agent_ids, task.assigned_agent_id);
  return {
    ...task,
    status: normalizeStatus(task.status),
    peer_approvals: Array.isArray(task.peer_approvals) ? task.peer_approvals : [],
    assigned_agent_ids: assignedAgentIds,
    completion_policy: task.completion_policy || (assignedAgentIds.length > 1 ? 'all_assigned' : 'single_owner'),
    agent_assignments: Array.isArray(task.agent_assignments) ? task.agent_assignments : [],
    recent_runs: Array.isArray(task.recent_runs) ? task.recent_runs : [],
    last_agent_run_at: task.last_agent_run_at || null,
    last_agent_run_status: task.last_agent_run_status || null,
  };
}

function normalizeTaskRun(run: any): TaskRun {
  const outputPayload = run?.output_payload && typeof run.output_payload === 'object' ? run.output_payload : {};
  return {
    ...run,
    run_kind: run?.run_kind || 'execute',
    status: (run?.status || 'running') as TaskRunStatus,
    input_payload: run?.input_payload && typeof run.input_payload === 'object' ? run.input_payload : {},
    output_payload: outputPayload,
    artifact_refs: Array.isArray(run?.artifact_refs) ? run.artifact_refs : [],
    token_count: run?.token_count || 0,
    cost: typeof run?.cost === 'number' ? run.cost : Number(run?.cost || 0),
    summary: run?.summary || (typeof outputPayload.summary === 'string' ? outputPayload.summary : null),
  };
}

function buildFallbackAssignment(task: KanbanTask): TaskAgentAssignment[] {
  if (!task.assigned_agent_id) return [];
  return [{
    id: `legacy:${task.id}:${task.assigned_agent_id}`,
    task_id: task.id,
    circle_id: task.circle_id,
    agent_id: task.assigned_agent_id,
    role: 'owner',
    assignment_type: 'legacy',
    required_for_completion: true,
    required_for_review: false,
    status: task.status === 'done'
      ? 'completed'
      : task.status === 'in_progress' || task.status === 'peer_review' || task.status === 'review' || task.status === 'approved'
        ? 'in_progress'
        : 'assigned',
    order_index: 0,
    assigned_by: task.created_by,
    assigned_at: task.created_at,
    started_at: task.status === 'in_progress' || task.status === 'peer_review' || task.status === 'review' || task.status === 'approved' || task.status === 'done'
      ? task.created_at
      : null,
    completed_at: task.status === 'done' ? task.completed_at : null,
    updated_at: task.created_at,
  }];
}

function normalizeProposedStatus(value: unknown): TaskStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeStatus(value);
  return TASK_STATUSES.includes(normalized) ? normalized : null;
}

function parseTaskRunEnvelope(response: string): { deliverable: string; output: TaskRunOutput } {
  const start = response.indexOf(TASK_RUN_MARKER_START);
  const end = response.indexOf(TASK_RUN_MARKER_END);
  let deliverable = response.trim();
  let output: TaskRunOutput = {};

  if (start >= 0 && end > start) {
    const jsonText = response.slice(start + TASK_RUN_MARKER_START.length, end).trim();
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object') output = parsed as TaskRunOutput;
    } catch {}
    deliverable = `${response.slice(0, start)}\n${response.slice(end + TASK_RUN_MARKER_END.length)}`.trim();
  }

  if (typeof output.summary !== 'string') {
    const firstLine = deliverable.split('\n').map(line => line.trim()).find(Boolean);
    if (firstLine) output.summary = firstLine.slice(0, 240);
  }
  if (!Array.isArray(output.blockers)) output.blockers = [];
  if (!Array.isArray(output.next_actions)) output.next_actions = [];
  if (!Array.isArray(output.artifacts)) output.artifacts = [];
  output.proposed_status = normalizeProposedStatus(output.proposed_status);
  if (typeof output.mark_complete !== 'boolean') output.mark_complete = false;
  if (typeof output.needs_review !== 'boolean') output.needs_review = false;
  if (!output.deliverable) output.deliverable = deliverable;

  return { deliverable, output };
}

function estimateRunCost(tokenCount?: number | null): number {
  if (!tokenCount || tokenCount <= 0) return 0;
  return Number((tokenCount * 0.0000005).toFixed(6));
}

function extractCodeAttachments(text: string): TaskAttachment[] {
  const attachments: TaskAttachment[] = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = match[1] || 'text';
    const code = match[2].trim();
    if (code.length <= 10) continue;
    attachments.push({ url: '', name: `code.${lang}`, type: 'code', language: lang });
  }
  return attachments;
}

function resolveCompletionPolicy(task: Pick<KanbanTask, 'completion_policy' | 'assigned_agent_ids' | 'assigned_agent_id'>): TaskCompletionPolicy {
  return task.completion_policy || (uniqueAgentIds(task.assigned_agent_ids, task.assigned_agent_id).length > 1 ? 'all_assigned' : 'single_owner');
}

function resolveNextStatus(task: KanbanTask, output: TaskRunOutput, mode: AgentMode, currentAgentId: string): TaskStatus | null {
  if (mode === 'plan') {
    return task.status === 'backlog' ? 'todo' : null;
  }
  if (!output.mark_complete) {
    if (task.status === 'backlog' || task.status === 'todo') return 'in_progress';
    return null;
  }

  const preferredStatus = output.proposed_status || (output.needs_review ? 'peer_review' : task.status === 'review' ? 'done' : 'peer_review');
  const completionPolicy = resolveCompletionPolicy(task);
  if (completionPolicy === 'all_assigned') {
    const requiredAgentIds = uniqueAgentIds(
      (task.agent_assignments || []).filter(a => a.required_for_completion !== false).map(a => a.agent_id),
      task.assigned_agent_ids,
      task.assigned_agent_id,
    );
    if (requiredAgentIds.length > 1) {
      const statuses = new Map<string, string>((task.agent_assignments || []).map(a => [a.agent_id, a.status]));
      statuses.set(currentAgentId, 'completed');
      if (!requiredAgentIds.every(agentId => statuses.get(agentId) === 'completed')) {
        return 'in_progress';
      }
    }
  }

  return preferredStatus;
}

export function useKanbanData(circleId: string): KanbanData {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [members, setMembers] = useState<KanbanMember[]>([]);
  const [agents, setAgents] = useState<CircleOfficeAgent[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(0);
  const assignmentSupportRef = useRef<boolean | null>(null);
  const taskRunsSupportRef = useRef<boolean | null>(null);
  const commentTaskRunSupportRef = useRef<boolean | null>(null);
  const completionPolicySupportRef = useRef<boolean | null>(null);

  const hydrateTaskTracking = useCallback(async (baseTasks: KanbanTask[]): Promise<KanbanTask[]> => {
    if (baseTasks.length === 0) return baseTasks;

    const taskIds = baseTasks.map(task => task.id);
    let nextTasks: KanbanTask[] = baseTasks.map(task => ({
      ...task,
      assigned_agent_ids: uniqueAgentIds(task.assigned_agent_ids, task.assigned_agent_id),
      agent_assignments: buildFallbackAssignment(task),
      recent_runs: task.recent_runs || [],
      last_agent_run_at: task.last_agent_run_at || null,
      last_agent_run_status: task.last_agent_run_status || null,
    }));

    if (assignmentSupportRef.current !== false) {
      const { data, error } = await supabase
        .from('task_agent_assignments')
        .select('*')
        .in('task_id', taskIds)
        .order('order_index', { ascending: true })
        .order('assigned_at', { ascending: true });

      if (error) {
        assignmentSupportRef.current = false;
        console.warn('[useKanbanData] task_agent_assignments unavailable:', error.message);
      } else {
        assignmentSupportRef.current = true;
        const assignmentsByTask = new Map<string, TaskAgentAssignment[]>();
        for (const row of data || []) {
          const list = assignmentsByTask.get(row.task_id) || [];
          list.push(row as TaskAgentAssignment);
          assignmentsByTask.set(row.task_id, list);
        }

        nextTasks = nextTasks.map(task => {
          const trackedAssignments = assignmentsByTask.get(task.id) || [];
          const finalAssignments = trackedAssignments.length > 0 ? trackedAssignments : buildFallbackAssignment(task);
          return {
            ...task,
            agent_assignments: finalAssignments,
            assigned_agent_ids: uniqueAgentIds(finalAssignments.map(a => a.agent_id), task.assigned_agent_id),
            completion_policy: task.completion_policy || (finalAssignments.length > 1 ? 'all_assigned' : 'single_owner'),
          };
        });
      }
    }

    if (taskRunsSupportRef.current !== false) {
      const { data, error } = await supabase
        .from('task_runs')
        .select('*')
        .in('task_id', taskIds)
        .order('started_at', { ascending: false })
        .limit(Math.max(taskIds.length * 4, 40));

      if (error) {
        taskRunsSupportRef.current = false;
        console.warn('[useKanbanData] task_runs unavailable:', error.message);
      } else {
        taskRunsSupportRef.current = true;
        const runsByTask = new Map<string, TaskRun[]>();
        for (const row of data || []) {
          const list = runsByTask.get(row.task_id) || [];
          if (list.length >= 5) continue;
          list.push(normalizeTaskRun(row));
          runsByTask.set(row.task_id, list);
        }

        nextTasks = nextTasks.map(task => {
          const recentRuns = runsByTask.get(task.id) || [];
          const latestRun = recentRuns[0] || null;
          return {
            ...task,
            recent_runs: recentRuns,
            last_agent_run_at: latestRun?.started_at || task.last_agent_run_at || null,
            last_agent_run_status: latestRun?.status || task.last_agent_run_status || null,
          };
        });
      }
    }

    return nextTasks;
  }, []);

  const fetchTasks = useCallback(async () => {
    const id = ++fetchRef.current;
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, creator:profiles!tasks_created_by_fkey(username, display_name), assignee:profiles!tasks_assigned_to_fkey(username, display_name), goal:goals!tasks_goal_id_fkey(id, name, status)')
        .eq('circle_id', circleId)
        .order('position', { ascending: true })
        .limit(200);

      if (id !== fetchRef.current) return;
      if (error) { console.error('fetchTasks error:', error); return; }

      const normalized = (data || []).map(normalizeTask);
      const hydrated = await hydrateTaskTracking(normalized);
      if (id !== fetchRef.current) return;
      setTasks(hydrated);
    } catch (err) {
      console.error('fetchTasks unexpected:', err);
    }
  }, [circleId, hydrateTaskTracking]);

  const fetchMembers = useCallback(async () => {
    const { data } = await supabase
      .from('circle_members')
      .select('user:profiles(id, username, display_name)')
      .eq('circle_id', circleId)
      .limit(50);

    setMembers((data || []).map((m: any) => m.user).filter(Boolean));
  }, [circleId]);

  const fetchAgents = useCallback(async () => {
    const { agents: loadedAgents } = await loadCircleOfficeAgents(circleId);
    setAgents(loadedAgents);
  }, [circleId]);

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

  const tasksByColumn = useMemo(() => groupByColumn(tasks), [tasks]);

  const syncTaskAssignments = useCallback(async (taskId: string, agentIds: string[], primaryAgentId?: string | null) => {
    const desiredAgentIds = uniqueAgentIds(agentIds, primaryAgentId);
    if (assignmentSupportRef.current === false) return;

    const { data: existingRows, error: existingError } = await supabase
      .from('task_agent_assignments')
      .select('id, agent_id, role, assignment_type, required_for_completion, required_for_review, status, order_index, assigned_by, assigned_at, started_at, completed_at')
      .eq('task_id', taskId);

    if (existingError) {
      assignmentSupportRef.current = false;
      console.warn('[useKanbanData] syncTaskAssignments unavailable:', existingError.message);
      return;
    }

    assignmentSupportRef.current = true;
    const existingMap = new Map((existingRows || []).map((row: any) => [row.agent_id, row]));
    const upsertRows = desiredAgentIds.map((agentId, index) => {
      const existing = existingMap.get(agentId);
      return {
        task_id: taskId,
        circle_id: circleId,
        agent_id: agentId,
        role: existing?.role || (index === 0 ? 'owner' : 'executor'),
        assignment_type: existing?.assignment_type || 'manual',
        required_for_completion: existing?.required_for_completion ?? true,
        required_for_review: existing?.required_for_review ?? false,
        status: existing?.status || 'assigned',
        order_index: index,
        assigned_by: existing?.assigned_by || currentUserId,
        assigned_at: existing?.assigned_at || new Date().toISOString(),
        started_at: existing?.started_at || null,
        completed_at: existing?.completed_at || null,
      };
    });
    if (upsertRows.length > 0) {
      const { error: upsertError } = await supabase
        .from('task_agent_assignments')
        .upsert(upsertRows, { onConflict: 'task_id,agent_id' });
      if (upsertError) {
        assignmentSupportRef.current = false;
        console.warn('[useKanbanData] task_agent_assignments upsert unavailable:', upsertError.message);
        return;
      }
    }

    const deleteIds = (existingRows || [])
      .filter((row: any) => !desiredAgentIds.includes(row.agent_id))
      .map((row: any) => row.id);

    if (deleteIds.length > 0) {
      const { error: deleteError } = await supabase.from('task_agent_assignments').delete().in('id', deleteIds);
      if (deleteError) console.error('syncTaskAssignments delete error:', deleteError);
    }
  }, [circleId, currentUserId]);

  const ensureTaskAssignment = useCallback(async (task: KanbanTask, agentId: string): Promise<TaskAgentAssignment | null> => {
    if (assignmentSupportRef.current === false) return null;

    const { data, error } = await supabase
      .from('task_agent_assignments')
      .select('*')
      .eq('task_id', task.id)
      .eq('agent_id', agentId)
      .maybeSingle();

    if (error) {
      assignmentSupportRef.current = false;
      console.warn('[useKanbanData] ensureTaskAssignment unavailable:', error.message);
      return null;
    }

    if (data) {
      assignmentSupportRef.current = true;
      return data as TaskAgentAssignment;
    }

    await syncTaskAssignments(task.id, uniqueAgentIds(task.assigned_agent_ids, task.assigned_agent_id, agentId), task.assigned_agent_id || agentId);
    const { data: inserted, error: insertedError } = await supabase
      .from('task_agent_assignments')
      .select('*')
      .eq('task_id', task.id)
      .eq('agent_id', agentId)
      .maybeSingle();

    if (insertedError) {
      console.error('ensureTaskAssignment refetch error:', insertedError);
      return null;
    }

    return (inserted as TaskAgentAssignment | null) || null;
  }, [syncTaskAssignments]);

  const upsertAssignmentStatus = useCallback(async (task: KanbanTask, agentId: string, status: TaskAgentAssignment['status']) => {
    if (assignmentSupportRef.current === false) return null;
    const existing = await ensureTaskAssignment(task, agentId);

    const agentOrder = Math.max(uniqueAgentIds(task.assigned_agent_ids, task.assigned_agent_id).indexOf(agentId), 0);
    const now = new Date().toISOString();
    const payload: any = {
      task_id: task.id,
      circle_id: task.circle_id,
      agent_id: agentId,
      role: existing?.role || (task.assigned_agent_id === agentId ? 'owner' : 'executor'),
      assignment_type: existing?.assignment_type || 'manual',
      required_for_completion: existing?.required_for_completion ?? true,
      required_for_review: existing?.required_for_review ?? false,
      status,
      order_index: existing?.order_index ?? agentOrder,
      assigned_by: existing?.assigned_by || currentUserId,
      assigned_at: existing?.assigned_at || task.created_at || now,
      started_at: status === 'in_progress' || status === 'completed' ? (existing?.started_at || now) : existing?.started_at || null,
      completed_at: status === 'completed' ? now : status === 'assigned' ? null : existing?.completed_at || null,
    };

    const { data, error } = await supabase
      .from('task_agent_assignments')
      .upsert(payload, { onConflict: 'task_id,agent_id' })
      .select('*')
      .maybeSingle();

    if (error) {
      assignmentSupportRef.current = false;
      console.warn('[useKanbanData] upsertAssignmentStatus unavailable:', error.message);
      return existing;
    }

    assignmentSupportRef.current = true;
    return (data as TaskAgentAssignment | null) || existing;
  }, [currentUserId, ensureTaskAssignment]);

  const createTaskRunRecord = useCallback(async (payload: Record<string, any>): Promise<string | null> => {
    if (taskRunsSupportRef.current === false) return null;
    const { data, error } = await supabase.from('task_runs').insert(payload).select('id').single();
    if (error) {
      taskRunsSupportRef.current = false;
      console.warn('[useKanbanData] task_runs insert unavailable:', error.message);
      return null;
    }
    taskRunsSupportRef.current = true;
    return data?.id || null;
  }, []);

  const updateTaskRunRecord = useCallback(async (taskRunId: string, fields: Record<string, any>) => {
    if (!taskRunId || taskRunsSupportRef.current === false) return;
    const { error } = await supabase.from('task_runs').update(fields).eq('id', taskRunId);
    if (error) {
      taskRunsSupportRef.current = false;
      console.warn('[useKanbanData] task_runs update unavailable:', error.message);
    } else {
      taskRunsSupportRef.current = true;
    }
  }, []);

  const applyTaskRunMetrics = useCallback(async (
    taskId: string,
    cost: number,
    tokens: number,
    durationMs: number,
    nextStatus?: TaskStatus | null,
  ) => {
    const { data: freshTask, error: fetchError } = await supabase
      .from('tasks')
      .select('total_cost, total_tokens, total_duration_ms, agent_runs, completed_at')
      .eq('id', taskId)
      .single();

    if (fetchError || !freshTask) {
      console.error('applyTaskRunMetrics fetch error:', fetchError);
      return;
    }

    const payload: any = {
      total_cost: (freshTask.total_cost || 0) + cost,
      total_tokens: (freshTask.total_tokens || 0) + tokens,
      total_duration_ms: (freshTask.total_duration_ms || 0) + durationMs,
      agent_runs: (freshTask.agent_runs || 0) + 1,
    };

    if (nextStatus) {
      payload.status = nextStatus;
      payload.completed_at = nextStatus === 'done' ? new Date().toISOString() : null;
    }

    const { error } = await supabase.from('tasks').update(payload).eq('id', taskId);
    if (error) console.error('applyTaskRunMetrics update error:', error);
  }, []);

  const createTask = useCallback(async (fields: CreateTaskFields) => {
    if (!currentUserId || !fields.title.trim()) return;
    const status = fields.status || 'todo';
    const desiredAgentIds = uniqueAgentIds(fields.assigned_agent_ids, fields.assigned_agent_id);
    const primaryAgentId = desiredAgentIds[0] || null;
    const completionPolicy = fields.completion_policy || (desiredAgentIds.length > 1 ? 'all_assigned' : 'single_owner');

    const colTasks = tasks.filter(t => normalizeStatus(t.status) === status);
    const maxPos = colTasks.length > 0 ? Math.max(...colTasks.map(t => t.position)) : -1;

    const payload: any = {
      circle_id: circleId,
      created_by: currentUserId,
      title: fields.title.trim(),
      description: fields.description?.trim() || null,
      image_url: fields.image_url || null,
      priority: fields.priority || 'normal',
      status,
      assigned_to: fields.assigned_to || null,
      assigned_agent_id: primaryAgentId,
      completion_policy: completionPolicy,
      due_date: fields.due_date || null,
      goal_id: fields.goal_id || null,
      plan_id: fields.plan_id || null,
      plan_step_id: fields.plan_step_id || null,
      focus_chain: fields.focus_chain || null,
      mode: fields.mode || null,
      position: maxPos + 1,
    };
    let insertResult = await supabase.from('tasks').insert(payload).select('id').single();
    if (insertResult.error && payload.completion_policy && String(insertResult.error.message || '').includes('completion_policy')) {
      completionPolicySupportRef.current = false;
      delete payload.completion_policy;
      insertResult = await supabase.from('tasks').insert(payload).select('id').single();
    } else if (!insertResult.error && payload.completion_policy) {
      completionPolicySupportRef.current = true;
    }

    if (insertResult.error) {
      console.error('createTask error:', insertResult.error);
      return;
    }

    if (desiredAgentIds.length > 0 && insertResult.data?.id) {
      await syncTaskAssignments(insertResult.data.id, desiredAgentIds, primaryAgentId);
    }

    fetchTasks();
  }, [circleId, currentUserId, fetchTasks, syncTaskAssignments, tasks]);

  const moveTask = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: newStatus, completed_at: newStatus === 'done' ? new Date().toISOString() : null } : t
    ));

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
      fetchTasks();
      return;
    }

    if (assignmentSupportRef.current !== false && newStatus === 'done') {
      await supabase.from('task_agent_assignments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('task_id', taskId);
    }

    if (newStatus === 'done' && currentUserId) {
      awardXP(currentUserId, getXPForAction('task_complete'), 'task_complete', { task_id: taskId }).catch(console.error);
    }
  }, [tasks, currentUserId, fetchTasks]);

  const updateTask = useCallback(async (taskId: string, fields: Partial<KanbanTask>) => {
    const managesAssignments = Object.prototype.hasOwnProperty.call(fields, 'assigned_agent_ids') || Object.prototype.hasOwnProperty.call(fields, 'assigned_agent_id');
    const desiredAgentIds = managesAssignments
      ? uniqueAgentIds((fields as any).assigned_agent_ids, fields.assigned_agent_id)
      : null;

    const payload: any = { ...fields };
    delete payload.assigned_agent_ids;
    delete payload.agent_assignments;
    delete payload.recent_runs;
    delete payload.last_agent_run_at;
    delete payload.last_agent_run_status;

    if (managesAssignments) {
      payload.assigned_agent_id = desiredAgentIds && desiredAgentIds.length > 0 ? desiredAgentIds[0] : null;
    }

    let updateResult = await supabase.from('tasks').update(payload).eq('id', taskId);
    if (updateResult.error && Object.prototype.hasOwnProperty.call(payload, 'completion_policy') && String(updateResult.error.message || '').includes('completion_policy')) {
      completionPolicySupportRef.current = false;
      delete payload.completion_policy;
      updateResult = await supabase.from('tasks').update(payload).eq('id', taskId);
    } else if (!updateResult.error && Object.prototype.hasOwnProperty.call(payload, 'completion_policy')) {
      completionPolicySupportRef.current = true;
    }

    if (updateResult.error) {
      console.error('updateTask error:', updateResult.error);
      return;
    }

    if (managesAssignments && desiredAgentIds) {
      await syncTaskAssignments(taskId, desiredAgentIds, desiredAgentIds[0] || null);
    }

    fetchTasks();
  }, [fetchTasks, syncTaskAssignments]);

  const deleteTask = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) {
      console.error('deleteTask error:', error);
      fetchTasks();
    }
  }, [fetchTasks]);

  const approveTask = useCallback(async (taskId: string, agentId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const current = Array.isArray(task.peer_approvals) ? task.peer_approvals : [];
    if (current.includes(agentId)) return;
    const updated = [...current, agentId];

    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, peer_approvals: updated } : t));

    const { error } = await supabase.from('tasks').update({ peer_approvals: updated }).eq('id', taskId);
    if (error) {
      console.error('approveTask error:', error);
      fetchTasks();
    }
  }, [tasks, fetchTasks]);

  const requestChanges = useCallback(async (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'in_progress', peer_approvals: [] } : t
    ));
    const { error } = await supabase.from('tasks').update({ status: 'in_progress', peer_approvals: [] }).eq('id', taskId);
    if (error) {
      console.error('requestChanges error:', error);
      fetchTasks();
    }
  }, [fetchTasks]);

  const fetchComments = useCallback(async (taskId: string): Promise<TaskComment[]> => {
    const { data, error } = await supabase
      .from('task_comments')
      .select('*, user:profiles!task_comments_user_id_fkey(username, display_name)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('fetchComments error:', error);
      return [];
    }
    return data || [];
  }, []);

  const insertTaskComment = useCallback(async ({
    taskId,
    content,
    attachments,
    agentId = null,
    taskRunId = null,
  }: {
    taskId: string;
    content: string;
    attachments?: TaskAttachment[];
    agentId?: string | null;
    taskRunId?: string | null;
  }) => {
    if (!currentUserId || !content.trim()) return;

    const insert: any = {
      task_id: taskId,
      user_id: currentUserId,
      agent_id: agentId,
      content: content.trim(),
    };
    if (attachments && attachments.length > 0) insert.attachments = attachments;
    if (taskRunId && commentTaskRunSupportRef.current !== false) insert.task_run_id = taskRunId;
    let result = await supabase.from('task_comments').insert(insert);
    if (result.error && insert.task_run_id && String(result.error.message || '').includes('task_run_id')) {
      commentTaskRunSupportRef.current = false;
      delete insert.task_run_id;
      result = await supabase.from('task_comments').insert(insert);
    } else if (!result.error && insert.task_run_id) {
      commentTaskRunSupportRef.current = true;
    }

    if (result.error) console.error('insertTaskComment error:', result.error);
  }, [currentUserId]);

  const addComment = useCallback(async (taskId: string, content: string, attachments?: TaskAttachment[]) => {
    if (!content.trim() && (!attachments || attachments.length === 0)) return;
    await insertTaskComment({ taskId, content, attachments });
  }, [insertTaskComment]);

  const uploadTaskFile = useCallback(async (taskId: string, file: File): Promise<TaskAttachment | null> => {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const path = `${taskId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('task-images')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadError) {
        console.error('uploadTaskFile error:', uploadError);
        return null;
      }
      const { data: urlData } = supabase.storage.from('task-images').getPublicUrl(path);
      if (!urlData?.publicUrl) return null;

      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
      const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yaml', 'yml', 'toml', 'sql', 'sh', 'md'];
      const type: TaskAttachment['type'] = imageExts.includes(ext) ? 'image' : codeExts.includes(ext) ? 'code' : 'file';

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

  const fetchTaskRuns = useCallback(async (taskId: string): Promise<TaskRun[]> => {
    if (taskRunsSupportRef.current === false) {
      return tasks.find(task => task.id === taskId)?.recent_runs || [];
    }

    const { data, error } = await supabase
      .from('task_runs')
      .select('*')
      .eq('task_id', taskId)
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      taskRunsSupportRef.current = false;
      console.warn('[useKanbanData] fetchTaskRuns unavailable:', error.message);
      return tasks.find(task => task.id === taskId)?.recent_runs || [];
    }

    taskRunsSupportRef.current = true;
    return (data || []).map(normalizeTaskRun);
  }, [tasks]);

  const runAgentOnTask = useCallback(async (taskId: string, agentId?: string, options?: AgentRunOptions): Promise<string | null> => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !currentUserId) return null;

    const defaultAgentId = task.assigned_agent_ids?.[0] || task.assigned_agent_id || 'blackswan-default';
    const targetAgentId = agentId || defaultAgentId;
    const targetAgent = agents.find(a => a.id === targetAgentId)
      || (targetAgentId === 'blackswan-default' ? createBlackSwanAgent(circleId) : null);
    if (!targetAgent) return null;

    const targetAgentName = targetAgent.name || 'BlackSwan';
    const thinkingLevel = options?.thinkingLevel || 'balanced';
    const model = options?.model && options.model !== 'auto' ? options.model : undefined;
    const mode = options?.mode || 'execute';
    const modelWithThinking = model && thinkingLevel !== 'balanced' ? `${model}::${thinkingLevel}` : model;

    const assignedAgents = uniqueAgentIds(
      (task.agent_assignments || []).map(assignment => assignment.agent_id),
      task.assigned_agent_ids,
      task.assigned_agent_id,
    ).map(id => agents.find(agent => agent.id === id)?.name || id);

    let assignment = await ensureTaskAssignment(task, targetAgentId);
    if (mode === 'execute') {
      assignment = await upsertAssignmentStatus(task, targetAgentId, 'in_progress');
      if (task.status === 'backlog' || task.status === 'todo') {
        await supabase.from('tasks').update({ status: 'in_progress', completed_at: null }).eq('id', taskId);
      }
    }

    let commentHistory = '';
    try {
      const existingComments = await fetchComments(taskId);
      if (existingComments.length > 0) {
        const recent = existingComments.slice(-15);
        commentHistory = '\n\n--- COMMENT HISTORY ---\n' + recent.map(comment => {
          const author = comment.agent_id ? `[Agent ${comment.agent_id}]` : (comment.user?.display_name || comment.user?.username || 'User');
          return `${author}: ${comment.content}`;
        }).join('\n');
      }
    } catch {}

    // ── Task execution runtime: infer profile ─────────────────────────
    const profileKey = (task as any).capability_profile_key || inferTaskCapabilityProfile({ title: task.title, description: task.description || undefined });
    const profile = getTaskCapabilityProfile(profileKey);

    const parts: string[] = [];
    if (mode === 'plan') {
      parts.push('You are in PLANNING MODE. Analyze the task, identify the work, and produce a concrete implementation plan.');
      parts.push('Do not claim the task is complete unless you actually finished the work.');
    } else {
      parts.push('You are executing a tracked task. Do the work and report clearly whether the task is complete or still in progress.');
    }

    parts.push('');
    parts.push('=== TASK ===');
    parts.push(`Title: ${task.title}`);
    parts.push(`Status: ${task.status}`);
    parts.push(`Priority: ${task.priority}`);
    parts.push(`Completion policy: ${resolveCompletionPolicy(task)}`);
    if (assignedAgents.length > 0) parts.push(`Assigned agents: ${assignedAgents.join(', ')}`);
    if (task.description) parts.push(`Description: ${task.description}`);
    if (task.image_url) parts.push(`Image: ${task.image_url}`);
    if (task.due_date) parts.push(`Due: ${task.due_date}`);
    if (task.assignee) parts.push(`Assigned member: ${task.assignee.display_name || task.assignee.username}`);
    if (task.goal) parts.push(`Goal: ${task.goal.name} (${task.goal.status})`);
    if (task.focus_chain && task.focus_chain.length > 0) {
      parts.push(`Focus chain: ${task.focus_chain.map(item => `${item.done ? '[x]' : '[ ]'} ${item.text}`).join(' | ')}`);
    }
    if (commentHistory) parts.push(commentHistory);

    // Task runtime context
    if (profile) {
      parts.push('');
      parts.push('=== TASK RUNTIME ===');
      parts.push(`Capability profile: ${profile.label} (${profileKey})`);
      parts.push(`Allowed capabilities: ${profile.capabilities.join(', ')}`);
      if (profile.defaults.required_artifacts?.length) {
        parts.push(`Required artifacts: ${profile.defaults.required_artifacts.join(', ')}`);
      }
      if (profile.defaults.checks?.length) {
        parts.push(`Required checks: ${profile.defaults.checks.join(', ')}`);
      }
      if (profile.defaults.approval_required) {
        parts.push('APPROVAL RULE: If you propose room writes, external publishes, or destructive operations, mark as approval-required. The system will not auto-apply without human approval.');
      }
    }

    parts.push('');
    parts.push('=== RESPONSE CONTRACT ===');
    parts.push(`At the very top of your response, output ${TASK_RUN_MARKER_START}`);
    parts.push('Then output valid JSON with this shape:');
    parts.push('{"summary":"short summary","mark_complete":false,"needs_review":false,"proposed_status":null,"blockers":[],"next_actions":[],"artifacts":[]}');
    parts.push(`Then output ${TASK_RUN_MARKER_END}`);
    parts.push('After the JSON block, provide the actual deliverable in plain text.');
    parts.push('If the task is fully completed by this run, set mark_complete=true and propose the correct next task status.');
    parts.push('If the work still needs follow-up, keep mark_complete=false and list blockers or next actions.');
    if (mode === 'plan') {
      parts.push('Because this is a planning run, return a structured plan and keep mark_complete=false unless you actually completed the requested work.');
    } else {
      parts.push('Return the actual work product, not just a summary of what you would do.');
    }

    const message = parts.join('\n');
    const taskRunId = await createTaskRunRecord({
      task_id: task.id,
      circle_id: task.circle_id,
      assignment_id: assignment?.id || null,
      agent_id: targetAgentId,
      run_kind: mode === 'plan' ? 'plan' : 'execute',
      status: 'running',
      trigger_source: 'manual',
      input_payload: {
        options: { thinkingLevel, model: modelWithThinking || null, mode },
        task_snapshot: {
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          goal_id: task.goal_id || null,
          assigned_agent_ids: uniqueAgentIds(task.assigned_agent_ids, task.assigned_agent_id),
          completion_policy: resolveCompletionPolicy(task),
        },
      },
      model_used: modelWithThinking || null,
    });

    // ── Initialize runtime steps + acceptance checks ──────────────────
    if (taskRunId) {
      createInitialTaskRunSteps(taskRunId, task.id, task.circle_id).catch(() => {});
      ensureTaskAcceptanceChecks(task.id, task.circle_id, profileKey).catch(() => {});
    }

    // ── Wake idle agent before invocation — spawns terminal session if needed ──
    const agentProvider = (targetAgent as any).providerType || (targetAgent as any).provider || '';
    if (agentProvider && agentProvider !== 'blackswan') {
      // Check if agent is idle/offline and try to wake it
      const agentStatus = (targetAgent as any).status;
      if (agentStatus === 'idle' || agentStatus === 'offline') {
        console.log(`[runAgentOnTask] Agent "${targetAgentName}" is ${agentStatus}, waking...`);
        await wakeAndAssignTask(agentProvider, targetAgentName, task.title, circleId).catch(() => {});
      }
    }

    try {
      const result = await invokeDirect({
        messageId: crypto.randomUUID(),
        circleId,
        command: message,
        senderId: currentUserId,
        targetAgentId,
        targetAgentName,
        model: modelWithThinking || null,
      }, targetAgent, targetAgent.gatewayUrl);

      if (!result.success) {
        await updateTaskRunRecord(taskRunId || '', {
          status: 'failed',
          error_message: result.error || 'Agent invocation failed',
          model_used: result.model || modelWithThinking || null,
          completed_at: new Date().toISOString(),
        });
        await upsertAssignmentStatus(task, targetAgentId, 'blocked');
        await insertTaskComment({
          taskId,
          taskRunId,
          agentId: targetAgentId,
          content: `[AGENT: ${targetAgentName}] [FAILED]\n${result.error || 'Agent returned an error.'}`,
        });
        fetchTasks();
        return null;
      }

      const response = result.responseText || 'Agent completed task (no output)';
      const parsed = parseTaskRunEnvelope(response);
      const deliverable = parsed.deliverable || response;
      const attachments = extractCodeAttachments(deliverable);
      const tokenCount = result.tokenCount || 0;
      const durationMs = result.latencyMs || 0;
      const cost = estimateRunCost(tokenCount);
      const nextStatus = resolveNextStatus(task, parsed.output, mode, targetAgentId);
      const assignmentStatus = mode === 'plan' ? 'assigned' : parsed.output.mark_complete ? 'completed' : 'in_progress';

      await upsertAssignmentStatus(task, targetAgentId, assignmentStatus);
      await applyTaskRunMetrics(taskId, cost, tokenCount, durationMs, nextStatus);
      await updateTaskRunRecord(taskRunId || '', {
        status: 'completed',
        output_payload: { ...parsed.output, deliverable },
        summary: parsed.output.summary || deliverable.slice(0, 240),
        artifact_refs: attachments.map(att => ({ name: att.name, type: att.type, url: att.url, language: att.language })),
        token_count: tokenCount,
        duration_ms: durationMs,
        cost,
        model_used: result.model || modelWithThinking || null,
        completed_at: new Date().toISOString(),
      });
      const modeTag = mode === 'plan' ? '[PLAN]' : '[EXEC]';
      const modelTag = model ? ` | ${model}` : '';
      const thinkTag = thinkingLevel !== 'balanced' ? ` | ${thinkingLevel}` : '';
      const completionTag = parsed.output.mark_complete ? ' | complete' : '';
      const summaryTag = parsed.output.summary ? `\nSummary: ${parsed.output.summary}` : '';
      await insertTaskComment({
        taskId,
        taskRunId,
        agentId: targetAgentId,
        attachments,
        content: `[AGENT: ${targetAgentName}] ${modeTag}${modelTag}${thinkTag}${completionTag}${summaryTag}\n${deliverable}`,
      });

      // ── Task execution runtime: artifacts, checks, completion gate ────
      if (taskRunId) {
        // Record execution step
        appendTaskRunStep(taskRunId, task.id, task.circle_id, 'execution', 'Agent execution complete', parsed.output.summary).catch(() => {});

        // Convert extracted attachments to typed artifacts
        for (const att of attachments) {
          const kind = att.language ? 'code_patch' : att.url ? 'link' : 'file';
          createTaskRunArtifact(taskRunId, task.id, task.circle_id, kind, att.name || 'output', undefined, att.url, att.name).catch(() => {});
        }

        // Evaluate acceptance checks
        await evaluateTaskRunChecks(taskRunId, task.id, task.circle_id);

        // Completion gate — only mark done if checks + approvals pass
        if (parsed.output.mark_complete && nextStatus === 'done') {
          const canComplete = await canTaskRunMarkComplete(taskRunId, task.id, task.circle_id);
          if (!canComplete) {
            // Agent says complete but checks/approvals block it — override to in_progress
            await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', taskId);
            appendTaskRunStep(taskRunId, task.id, task.circle_id, 'check_eval', 'Completion blocked', 'Required checks or approvals not yet passed').catch(() => {});
          }
        }

        // Finalize step
        appendTaskRunStep(taskRunId, task.id, task.circle_id, 'finalize', 'Run finalized').catch(() => {});
      }

      if (nextStatus === 'done' && currentUserId) {
        // Only award XP if completion gate actually passed
        const canComplete = taskRunId ? await canTaskRunMarkComplete(taskRunId, task.id, task.circle_id) : true;
        if (canComplete) {
          awardXP(currentUserId, getXPForAction('task_complete'), 'task_complete', { task_id: taskId }).catch(console.error);
        }
      }

      fetchTasks();
      return deliverable;
    } catch (err) {
      console.error('runAgentOnTask unexpected:', err);
      await updateTaskRunRecord(taskRunId || '', {
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Agent run failed unexpectedly',
        completed_at: new Date().toISOString(),
      });
      await upsertAssignmentStatus(task, targetAgentId, 'blocked');
      fetchTasks();
      return null;
    }
  }, [
    agents,
    applyTaskRunMetrics,
    circleId,
    createTaskRunRecord,
    currentUserId,
    ensureTaskAssignment,
    fetchComments,
    fetchTasks,
    insertTaskComment,
    tasks,
    updateTaskRunRecord,
    upsertAssignmentStatus,
  ]);

  const updateFocusChain = useCallback(async (taskId: string, chain: FocusChainItem[]) => {
    const { error } = await supabase.from('tasks').update({ focus_chain: chain }).eq('id', taskId);
    if (error) console.error('updateFocusChain error:', error);
    else fetchTasks();
  }, [fetchTasks]);

  const toggleTaskMode = useCallback(async (taskId: string, mode: 'plan' | 'execute') => {
    const { error } = await supabase.from('tasks').update({ mode }).eq('id', taskId);
    if (error) console.error('toggleTaskMode error:', error);
    else fetchTasks();
  }, [fetchTasks]);

  const recordTaskCost = useCallback(async (taskId: string, cost: number, tokens: number, durationMs: number) => {
    await applyTaskRunMetrics(taskId, cost, tokens, durationMs, null);
    fetchTasks();
  }, [applyTaskRunMetrics, fetchTasks]);

  const refresh = useCallback(() => {
    fetchTasks();
    fetchMembers();
    fetchAgents();
  }, [fetchAgents, fetchMembers, fetchTasks]);

  return {
    tasks,
    tasksByColumn,
    members,
    agents,
    currentUserId,
    loading,
    createTask,
    moveTask,
    updateTask,
    deleteTask,
    approveTask,
    requestChanges,
    fetchComments,
    addComment,
    uploadTaskFile,
    fetchTaskRuns,
    runAgentOnTask,
    updateFocusChain,
    toggleTaskMode,
    recordTaskCost,
    refresh,
  };
}
