// Advanced Agent Collaboration System - Full agent-to-agent communication
import { getAgentIdentityKey } from './agentIdentity';
import { OfficeAgent } from './officeAgents';
import { OpenSwanConfig } from './openswanService';
import { Project } from './projectManagement';
import { supabase } from './supabase';
import { storage } from './storage';

// ─── Task Management ──────────────────────────────────────

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignedTo: string[]; // Agent IDs
  status: 'pending' | 'in-progress' | 'blocked' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  updatedAt: string;
  dependencies?: string[]; // Task IDs that must complete first
  progress?: number; // 0-100
  blockedReason?: string;
}

export interface TaskUpdate {
  taskId: string;
  agentId: string;
  message: string;
  progress?: number;
  status?: Task['status'];
  timestamp: string;
}

const STORAGE_KEY_TASKS = '@office_tasks';
const STORAGE_KEY_TASK_UPDATES = '@office_task_updates';
const STORAGE_KEY_TASKS_ARCHIVE = '@office_tasks_archive';
const STORAGE_KEY_TASKS_MIGRATION = '@office_tasks_migration';
const STORAGE_KEY_TASK_UPDATES_ARCHIVE = '@office_task_updates_archive';

function mapKanbanStatusToLegacy(status?: string | null): Task['status'] {
  if (status === 'done' || status === 'approved') return 'completed';
  if (status === 'in_progress' || status === 'peer_review' || status === 'review') return 'in-progress';
  if (status === 'blocked') return 'blocked' as Task['status'];
  return 'pending';
}

function mapLegacyStatusToKanban(status?: Task['status']): string {
  if (status === 'completed') return 'done';
  if (status === 'in-progress') return 'in_progress';
  if (status === 'blocked') return 'blocked';
  return 'todo';
}

function mapLegacyPriorityToKanban(priority?: Task['priority']): string {
  if (priority === 'medium') return 'normal';
  return priority || 'normal';
}

async function resolveCircleIdForProject(projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from('project_rooms')
    .select('circle_id')
    .eq('id', projectId)
    .single();

  return data?.circle_id || null;
}

async function loadLegacyTasksFromStorage(): Promise<Task[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_TASKS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function archiveLegacyTasks(
  tasks: Task[],
  mappings: Array<{ legacyTaskId: string; taskId: string; title: string }>
): Promise<void> {
  try {
    const migratedTaskIds = new Set(mappings.map(item => item.legacyTaskId));
    const migratedTasks = tasks.filter(task => migratedTaskIds.has(task.id));
    const remainingTasks = tasks.filter(task => !migratedTaskIds.has(task.id));

    let migratedUpdates: TaskUpdate[] = [];
    let remainingUpdates: TaskUpdate[] = [];
    try {
      const rawUpdates = await storage.getItem(STORAGE_KEY_TASK_UPDATES);
      const allUpdates: TaskUpdate[] = rawUpdates ? JSON.parse(rawUpdates) : [];
      migratedUpdates = allUpdates.filter(update => migratedTaskIds.has(update.taskId));
      remainingUpdates = allUpdates.filter(update => !migratedTaskIds.has(update.taskId));
    } catch {
      migratedUpdates = [];
      remainingUpdates = [];
    }

    await storage.setItem(STORAGE_KEY_TASKS_ARCHIVE, JSON.stringify({
      archivedAt: new Date().toISOString(),
      count: migratedTasks.length,
      mappings,
      tasks: migratedTasks,
    }));
    await storage.setItem(STORAGE_KEY_TASK_UPDATES_ARCHIVE, JSON.stringify({
      archivedAt: new Date().toISOString(),
      count: migratedUpdates.length,
      mappings,
      updates: migratedUpdates,
    }));
    await storage.setItem(STORAGE_KEY_TASKS_MIGRATION, JSON.stringify({
      migratedAt: new Date().toISOString(),
      count: migratedTasks.length,
      remainingCount: remainingTasks.length,
      mappings,
    }));

    if (remainingTasks.length > 0) {
      await storage.setItem(STORAGE_KEY_TASKS, JSON.stringify(remainingTasks));
    } else {
      await storage.removeItem(STORAGE_KEY_TASKS);
    }

    if (remainingUpdates.length > 0) {
      await storage.setItem(STORAGE_KEY_TASK_UPDATES, JSON.stringify(remainingUpdates));
    } else {
      await storage.removeItem(STORAGE_KEY_TASK_UPDATES);
    }
  } catch {
    console.error('Failed to archive migrated legacy tasks');
  }
}

function normalizeAssignedTo(task: any, assignmentsByTask: Map<string, string[]>): string[] {
  const fromAssignments = assignmentsByTask.get(task.id) || [];
  if (fromAssignments.length > 0) return fromAssignments;
  const candidates = [
    ...(Array.isArray(task.assigned_agent_ids) ? task.assigned_agent_ids : []),
    task.assigned_agent_id,
    task.assigned_to,
  ].filter(Boolean).map((value: any) => String(value));
  return Array.from(new Set(candidates));
}

function mapSupabaseTaskRowToLegacy(task: any, assignmentsByTask: Map<string, string[]>): Task {
  const assignedTo = normalizeAssignedTo(task, assignmentsByTask);
  const legacyStatus = mapKanbanStatusToLegacy(task.status);
  const explicitProgress = Number(task.output_payload?.progress ?? task.progress ?? NaN);
  const progress = Number.isFinite(explicitProgress)
    ? explicitProgress
    : legacyStatus === 'completed' ? 100
      : legacyStatus === 'in-progress' ? 50
        : 0;

  return {
    id: task.id,
    projectId: task.room_id || '',
    title: task.title,
    description: task.description || '',
    assignedTo,
    status: legacyStatus,
    priority: task.priority === 'normal' ? 'medium' : (task.priority || 'medium'),
    createdAt: task.created_at,
    updatedAt: task.updated_at || task.created_at,
    progress,
    blockedReason: task.description?.includes('Blocked:') ? task.description : undefined,
  };
}

// ─── Conversation Threading ──────────────────────────────

export interface Conversation {
  id: string;
  projectId?: string;
  participants: string[]; // Agent IDs + 'user'
  subject: string;
  messages: ConversationMessage[];
  createdAt: string;
  lastActivity: string;
}

export interface ConversationMessage {
  id: string;
  from: string; // 'user' or agent ID
  content: string;
  timestamp: string;
  mentions?: string[]; // Agent IDs mentioned with @
  replyTo?: string; // Message ID being replied to
  attachments?: {
    type: 'task' | 'file' | 'link';
    data: any;
  }[];
}

let activeConversations: Map<string, Conversation> = new Map();

// ─── Agent Coordination ───────────────────────────────────

export interface CoordinationRequest {
  id: string;
  from: string; // Agent ID requesting help
  to: string; // Agent ID being asked to help
  projectId: string;
  request: string;
  status: 'pending' | 'accepted' | 'declined' | 'completed';
  createdAt: string;
  resolution?: string;
}

let coordinationRequests: CoordinationRequest[] = [];

// ─── Task Functions ───────────────────────────────────────

export async function createTask(
  projectId: string,
  title: string,
  description: string,
  assignedTo: string[],
  priority: Task['priority'] = 'medium'
): Promise<Task> {
  const circleId = await resolveCircleIdForProject(projectId);
  const { data: auth } = await supabase.auth.getUser();

  if (!circleId || !auth.user) {
    const task: Task = {
      id: `task_${Date.now()}`,
      projectId,
      title,
      description,
      assignedTo,
      status: 'pending',
      priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 0,
    };
    const tasks = await loadLegacyTasksFromStorage();
    tasks.push(task);
    await saveTasks(tasks);
    return task;
  }

  const { data: inserted, error } = await supabase
    .from('tasks')
    .insert({
      circle_id: circleId,
      room_id: projectId,
      created_by: auth.user.id,
      title,
      description,
      priority: mapLegacyPriorityToKanban(priority),
      status: 'todo',
      position: 0,
      completion_policy: assignedTo.length > 1 ? 'any_assigned' : 'single_owner',
      assigned_agent_id: assignedTo[0] || null,
    })
    .select('*')
    .single();

  if (error || !inserted) {
    throw new Error(error?.message || 'Failed to create task');
  }

  if (assignedTo.length > 0) {
    await supabase.from('task_agent_assignments').upsert(
      assignedTo.map((agentId, index) => ({
        task_id: inserted.id,
        circle_id: circleId,
        agent_id: agentId,
        role: index === 0 ? 'owner' : 'executor',
        assignment_type: 'legacy',
        required_for_completion: true,
        required_for_review: false,
        status: 'assigned',
        order_index: index,
        assigned_by: auth.user.id,
      })),
      { onConflict: 'task_id,agent_id' }
    );
  }

  return mapSupabaseTaskRowToLegacy(inserted, new Map([[inserted.id, assignedTo]]));
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>,
  agentId: string,
  message?: string
): Promise<Task | null> {
  const tasks = await loadTasks();
  const existing = tasks.find(t => t.id === taskId);
  if (!existing) return null;

  const { error } = await supabase
    .from('tasks')
    .update({
      title: updates.title ?? existing.title,
      description: updates.description ?? existing.description,
      priority: mapLegacyPriorityToKanban(updates.priority ?? existing.priority),
      status: mapLegacyStatusToKanban(updates.status ?? existing.status),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    Object.assign(existing, updates, { updatedAt: new Date().toISOString() });
    await saveTasks(tasks);
  }

  if (message) {
    await logTaskUpdate({
      taskId,
      agentId,
      message,
      progress: updates.progress,
      status: updates.status,
      timestamp: new Date().toISOString(),
    });
  }

  const refreshed = await loadTasks();
  return refreshed.find(t => t.id === taskId) || { ...existing, ...updates, updatedAt: new Date().toISOString() };
}

export async function assignTaskToAgent(taskId: string, agentId: string): Promise<boolean> {
  const { data: task } = await supabase
    .from('tasks')
    .select('id, circle_id')
    .eq('id', taskId)
    .single();

  if (!task?.id || !task.circle_id) {
    const tasks = await loadLegacyTasksFromStorage();
    const legacyTask = tasks.find(t => t.id === taskId);
    if (!legacyTask) return false;
    if (!legacyTask.assignedTo.includes(agentId)) {
      legacyTask.assignedTo.push(agentId);
      legacyTask.updatedAt = new Date().toISOString();
      await saveTasks(tasks);
    }
    return true;
  }

  await supabase.from('task_agent_assignments').upsert({
    task_id: taskId,
    circle_id: task.circle_id,
    agent_id: agentId,
    role: 'executor',
    assignment_type: 'legacy',
    required_for_completion: true,
    required_for_review: false,
    status: 'assigned',
    order_index: 999,
  }, { onConflict: 'task_id,agent_id' });

  return true;
}

export async function completeTask(taskId: string, agentId: string): Promise<Task | null> {
  return updateTask(taskId, { status: 'completed', progress: 100 }, agentId, 'Task completed!');
}

export async function blockTask(taskId: string, agentId: string, reason: string): Promise<Task | null> {
  return updateTask(taskId, { status: 'blocked', blockedReason: reason }, agentId, `Blocked: ${reason}`);
}

export async function loadTasks(): Promise<Task[]> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return loadLegacyTasksFromStorage();

    const { data: memberships } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', userId)
      .limit(10);

    const circleIds = Array.from(new Set((memberships || []).map((row: any) => row.circle_id).filter(Boolean)));
    if (circleIds.length === 0) return loadLegacyTasksFromStorage();

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, room_id, title, description, priority, status, created_at, updated_at, assigned_to, assigned_agent_id, assigned_agent_ids')
      .in('circle_id', circleIds)
      .not('room_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error || !tasks) return loadLegacyTasksFromStorage();

    const taskIds = tasks.map((task: any) => task.id);
    const assignmentsByTask = new Map<string, string[]>();

    if (taskIds.length > 0) {
      const { data: assignments } = await supabase
        .from('task_agent_assignments')
        .select('task_id, agent_id')
        .in('task_id', taskIds);

      for (const row of assignments || []) {
        const existing = assignmentsByTask.get(row.task_id) || [];
        if (!existing.includes(row.agent_id)) existing.push(row.agent_id);
        assignmentsByTask.set(row.task_id, existing);
      }
    }

    return tasks.map((task: any) => mapSupabaseTaskRowToLegacy(task, assignmentsByTask));
  } catch {
    return loadLegacyTasksFromStorage();
  }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  // Legacy compatibility only. Supabase is now the primary task store.
  try {
    await storage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
  } catch {
    console.error('Failed to save tasks');
  }
}

export async function logTaskUpdate(update: TaskUpdate): Promise<void> {
  try {
    const { data: task } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', update.taskId)
      .single();

    if (task?.id) {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user?.id) {
        await supabase.from('task_comments').insert({
          task_id: update.taskId,
          user_id: auth.user.id,
          agent_id: update.agentId === 'user' ? null : update.agentId,
          content: update.message,
        } as any);
      }
    }

    const raw = await storage.getItem(STORAGE_KEY_TASK_UPDATES);
    const updates: TaskUpdate[] = raw ? JSON.parse(raw) : [];
    updates.push(update);
    // Keep last 500 updates
    if (updates.length > 500) {
      updates.splice(0, updates.length - 500);
    }
    await storage.setItem(STORAGE_KEY_TASK_UPDATES, JSON.stringify(updates));
  } catch {
    console.error('Failed to log task update');
  }
}

export async function getTaskUpdates(taskId: string): Promise<TaskUpdate[]> {
  try {
    const { data: comments } = await supabase
      .from('task_comments')
      .select('task_id, agent_id, content, created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (comments && comments.length > 0) {
      return comments.map((comment: any) => ({
        taskId,
        agentId: comment.agent_id || 'user',
        message: comment.content,
        timestamp: comment.created_at,
      }));
    }

    const raw = await storage.getItem(STORAGE_KEY_TASK_UPDATES);
    if (!raw) return [];
    const all: TaskUpdate[] = JSON.parse(raw);
    return all.filter(u => u.taskId === taskId);
  } catch {
    return [];
  }
}

export async function migrateLegacyTasksToSupabase(projectMappings: Array<{
  legacyId: string;
  roomId: string;
}>): Promise<Array<{ legacyTaskId: string; taskId: string; title: string }>> {
  const legacyTasks = await loadLegacyTasksFromStorage();
  if (legacyTasks.length === 0 || projectMappings.length === 0) return [];

  const mappingByLegacyProject = new Map(projectMappings.map(item => [item.legacyId, item.roomId]));
  const created: Array<{ legacyTaskId: string; taskId: string; title: string }> = [];

  for (const legacyTask of legacyTasks) {
    const roomId = mappingByLegacyProject.get(legacyTask.projectId);
    if (!roomId) continue;

    const circleId = await resolveCircleIdForProject(roomId);
    const { data: auth } = await supabase.auth.getUser();
    if (!circleId || !auth.user) continue;

    const { data: existing } = await supabase
      .from('tasks')
      .select('id')
      .eq('room_id', roomId)
      .eq('title', legacyTask.title)
      .limit(1);

    if (existing && existing.length > 0) {
      created.push({ legacyTaskId: legacyTask.id, taskId: existing[0].id, title: legacyTask.title });
      continue;
    }

    const { data: inserted, error } = await supabase
      .from('tasks')
      .insert({
        circle_id: circleId,
        room_id: roomId,
        created_by: auth.user.id,
        title: legacyTask.title,
        description: legacyTask.description || null,
        priority: mapLegacyPriorityToKanban(legacyTask.priority),
        status: mapLegacyStatusToKanban(legacyTask.status),
        position: 0,
        completion_policy: legacyTask.assignedTo.length > 1 ? 'any_assigned' : 'single_owner',
        assigned_agent_id: legacyTask.assignedTo[0] || null,
      })
      .select('id')
      .single();

    if (error || !inserted) continue;

    if (legacyTask.assignedTo.length > 0) {
      await supabase.from('task_agent_assignments').upsert(
        legacyTask.assignedTo.map((agentId, index) => ({
          task_id: inserted.id,
          circle_id: circleId,
          agent_id: agentId,
          role: index === 0 ? 'owner' : 'executor',
          assignment_type: 'legacy',
          required_for_completion: true,
          required_for_review: false,
          status: legacyTask.status === 'completed' ? 'completed' : 'assigned',
          order_index: index,
          assigned_by: auth.user.id,
        })),
        { onConflict: 'task_id,agent_id' }
      );
    }

    created.push({ legacyTaskId: legacyTask.id, taskId: inserted.id, title: legacyTask.title });
  }

  if (created.length > 0) {
    await archiveLegacyTasks(legacyTasks, created);
  }

  return created;
}

export function getAgentTasks(agentId: string, tasks: Task[]): Task[] {
  return tasks.filter(t => t.assignedTo.includes(agentId));
}

export function getProjectTasks(projectId: string, tasks: Task[]): Task[] {
  return tasks.filter(t => t.projectId === projectId);
}

export function getBlockedTasks(tasks: Task[]): Task[] {
  return tasks.filter(t => t.status === 'blocked');
}

// ─── Conversation Functions ───────────────────────────────

export function createConversation(
  subject: string,
  participants: string[],
  projectId?: string
): Conversation {
  const conv: Conversation = {
    id: `conv_${Date.now()}`,
    projectId,
    participants,
    subject,
    messages: [],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };

  activeConversations.set(conv.id, conv);
  return conv;
}

export function addMessageToConversation(
  conversationId: string,
  from: string,
  content: string,
  mentions?: string[],
  replyTo?: string
): ConversationMessage | null {
  const conv = activeConversations.get(conversationId);
  if (!conv) return null;

  const msg: ConversationMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    from,
    content,
    timestamp: new Date().toISOString(),
    mentions,
    replyTo,
  };

  conv.messages.push(msg);
  conv.lastActivity = new Date().toISOString();
  
  return msg;
}

export function getActiveConversations(agentId?: string): Conversation[] {
  const convs = Array.from(activeConversations.values());
  if (agentId) {
    return convs.filter(c => c.participants.includes(agentId));
  }
  return convs;
}

export function findConversationByParticipants(participants: string[]): Conversation | null {
  const sorted = [...participants].sort();
  for (const conv of activeConversations.values()) {
    const convSorted = [...conv.participants].sort();
    if (JSON.stringify(sorted) === JSON.stringify(convSorted)) {
      return conv;
    }
  }
  return null;
}

// ─── Agent Coordination ───────────────────────────────────

export function requestAgentHelp(
  fromAgentId: string,
  toAgentId: string,
  projectId: string,
  request: string
): CoordinationRequest {
  const req: CoordinationRequest = {
    id: `coord_${Date.now()}`,
    from: fromAgentId,
    to: toAgentId,
    projectId,
    request,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  coordinationRequests.push(req);
  return req;
}

export function respondToCoordination(
  requestId: string,
  accept: boolean,
  resolution?: string
): boolean {
  const req = coordinationRequests.find(r => r.id === requestId);
  if (!req) return false;

  req.status = accept ? 'accepted' : 'declined';
  req.resolution = resolution;
  
  return true;
}

export function getCoordinationRequests(agentId: string): CoordinationRequest[] {
  return coordinationRequests.filter(r => r.to === agentId && r.status === 'pending');
}

// ─── Advanced Messaging with Context ──────────────────────

export interface MessageContext {
  projectId?: string;
  taskId?: string;
  conversationId?: string;
  replyTo?: string;
  mentions?: string[];
}

export async function sendContextualMessage(
  config: OpenSwanConfig,
  sessionKey: string,
  message: string,
  context: MessageContext,
  agents: OfficeAgent[],
  projects: Project[]
): Promise<{ ok: boolean; error?: string }> {
  // Build enhanced message with context
  let enhancedMessage = message;

  // Add project context
  if (context.projectId) {
    const project = projects.find(p => p.id === context.projectId);
    if (project) {
      const teamMembers = agents.filter(a => project.agentIds.includes(a.id));
      enhancedMessage = `[Project: ${project.name}]\n` +
        `[Team: ${teamMembers.map(a => a.name).join(', ')}]\n\n` +
        enhancedMessage;
    }
  }

  // Add task context
  if (context.taskId) {
    const tasks = await loadTasks();
    const task = tasks.find(t => t.id === context.taskId);
    if (task) {
      enhancedMessage = `[Task: ${task.title} - ${task.status}]\n` +
        `[Progress: ${task.progress}%]\n\n` +
        enhancedMessage;
    }
  }

  // Add mentions
  if (context.mentions && context.mentions.length > 0) {
    const mentionedAgents = agents.filter(a => context.mentions!.includes(a.id));
    enhancedMessage = `@${mentionedAgents.map(a => a.name).join(' @')}\n\n` + enhancedMessage;
  }

  // Send the message
  try {
    const res = await fetch(`${config.endpoint}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        tool: 'sessions_send',
        args: { sessionKey, message: enhancedMessage },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── Broadcast to All Agents ──────────────────────────────

export async function broadcastMessage(
  agents: OfficeAgent[],
  getConfig: (connectionId: string) => OpenSwanConfig | null,
  message: string
): Promise<{ ok: boolean; deliveredTo?: string[]; error?: string }> {
  const delivered: string[] = [];
  const errors: string[] = [];

  for (const agent of agents) {
    if (agent.status !== 'active' && agent.status !== 'idle') continue;
    const config = getConfig(agent.connectionId);
    if (!config) continue;

    const sessionKey = getAgentIdentityKey(agent);
    try {
      const res = await fetch(`${config.endpoint}/tools/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          tool: 'sessions_send',
          args: { sessionKey, message: `📢 [BROADCAST]\n\n${message}` },
        }),
      });
      if (res.ok) delivered.push(agent.name);
      else errors.push(`${agent.name}: HTTP ${res.status}`);
    } catch (e: any) {
      errors.push(`${agent.name}: ${e.message}`);
    }
  }

  if (delivered.length === 0 && errors.length > 0) {
    return { ok: false, error: errors.join(', ') };
  }
  return { ok: true, deliveredTo: delivered };
}

// ─── Agent-to-Agent Relay (Auto-coordination) ─────────────

export async function relayMessageBetweenAgents(
  fromAgent: OfficeAgent,
  toAgent: OfficeAgent,
  message: string,
  getConfig: (connectionId: string) => OpenSwanConfig | null,
  context?: MessageContext
): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig(toAgent.connectionId);
  if (!config) {
    return { ok: false, error: `No config for ${toAgent.name}` };
  }

  const sessionKey = getAgentIdentityKey(toAgent);
  
  // Format message to show it's from another agent
  const relayedMessage = `📨 Message from ${fromAgent.name}:\n\n${message}`;

  if (context) {
    return sendContextualMessage(config, sessionKey, relayedMessage, context, [fromAgent, toAgent], []);
  }

  try {
    const res = await fetch(`${config.endpoint}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        tool: 'sessions_send',
        args: { sessionKey, message: relayedMessage },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── Smart Task Assignment ────────────────────────────────

export interface AgentCapability {
  agentId: string;
  skills: string[]; // e.g., ['coding', 'design', 'writing']
  availability: number; // 0-100, based on current workload
  costEfficiency: number; // Based on cost per task
}

export function calculateAgentAvailability(agent: OfficeAgent, tasks: Task[]): number {
  const agentTasks = getAgentTasks(agent.id, tasks);
  const activeTasks = agentTasks.filter(t => t.status === 'in-progress').length;
  const blockedTasks = agentTasks.filter(t => t.status === 'blocked').length;

  // More active tasks = less availability
  // Blocked tasks also reduce availability (agent is waiting)
  const workload = activeTasks + (blockedTasks * 0.5);
  const maxWorkload = 5; // Assume max 5 tasks per agent

  return Math.max(0, Math.min(100, 100 - (workload / maxWorkload) * 100));
}

export function suggestAgentForTask(
  task: Task,
  agents: OfficeAgent[],
  tasks: Task[],
  project: Project
): OfficeAgent[] {
  // Filter to agents on the project
  const projectAgents = agents.filter(a => project.agentIds.includes(a.id));

  // Score each agent
  const scored = projectAgents.map(agent => {
    const availability = calculateAgentAvailability(agent, tasks);
    const isIdle = agent.status === 'idle';
    const lowCost = agent.costToday < 1.0;

    // Simple scoring: availability + idle bonus + cost bonus
    let score = availability;
    if (isIdle) score += 20;
    if (lowCost) score += 10;

    return { agent, score };
  });

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);

  return scored.map(s => s.agent);
}

// ─── Project Status Summary ───────────────────────────────

export interface ProjectStatus {
  projectId: string;
  projectName: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  agentCount: number;
  activeAgents: string[];
  idleAgents: string[];
  totalCost: number;
  recentActivity: string[];
}

export async function getProjectStatus(
  projectId: string,
  project: Project,
  agents: OfficeAgent[],
  tasks: Task[]
): Promise<ProjectStatus> {
  const projectTasks = getProjectTasks(projectId, tasks);
  const projectAgents = agents.filter(a => project.agentIds.includes(a.id));

  const completedTasks = projectTasks.filter(t => t.status === 'completed').length;
  const inProgressTasks = projectTasks.filter(t => t.status === 'in-progress').length;
  const blockedTasks = projectTasks.filter(t => t.status === 'blocked').length;

  const activeAgents = projectAgents.filter(a => a.status === 'active').map(a => a.name);
  const idleAgents = projectAgents.filter(a => a.status === 'idle').map(a => a.name);

  const totalCost = projectAgents.reduce((sum, a) => sum + a.costToday, 0);

  // Get recent activity from task updates
  const allUpdates: TaskUpdate[] = [];
  for (const task of projectTasks) {
    const updates = await getTaskUpdates(task.id);
    allUpdates.push(...updates);
  }
  allUpdates.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentActivity = allUpdates.slice(0, 5).map(u => {
    const agent = agents.find(a => a.id === u.agentId);
    return `${agent?.name || 'Agent'}: ${u.message}`;
  });

  return {
    projectId,
    projectName: project.name,
    totalTasks: projectTasks.length,
    completedTasks,
    inProgressTasks,
    blockedTasks,
    agentCount: projectAgents.length,
    activeAgents,
    idleAgents,
    totalCost,
    recentActivity,
  };
}
