// Advanced Agent Collaboration System - Full agent-to-agent communication
import { OfficeAgent } from './officeAgents';
import { OpenClawConfig, OpenClawSession } from './openclawService';
import { Project, getProjectAgentIds } from './projectManagement';
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

  const tasks = await loadTasks();
  tasks.push(task);
  await saveTasks(tasks);

  return task;
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>,
  agentId: string,
  message?: string
): Promise<Task | null> {
  const tasks = await loadTasks();
  const task = tasks.find(t => t.id === taskId);
  
  if (!task) return null;

  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
  await saveTasks(tasks);

  // Log the update
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

  return task;
}

export async function assignTaskToAgent(taskId: string, agentId: string): Promise<boolean> {
  const tasks = await loadTasks();
  const task = tasks.find(t => t.id === taskId);
  
  if (!task) return false;

  if (!task.assignedTo.includes(agentId)) {
    task.assignedTo.push(agentId);
    task.updatedAt = new Date().toISOString();
    await saveTasks(tasks);
  }

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
    const raw = await storage.getItem(STORAGE_KEY_TASKS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
  } catch {
    console.error('Failed to save tasks');
  }
}

export async function logTaskUpdate(update: TaskUpdate): Promise<void> {
  try {
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
    const raw = await storage.getItem(STORAGE_KEY_TASK_UPDATES);
    if (!raw) return [];
    const all: TaskUpdate[] = JSON.parse(raw);
    return all.filter(u => u.taskId === taskId);
  } catch {
    return [];
  }
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
  config: OpenClawConfig,
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
  getConfig: (connectionId: string) => OpenClawConfig | null,
  message: string
): Promise<{ ok: boolean; deliveredTo?: string[]; error?: string }> {
  const delivered: string[] = [];
  const errors: string[] = [];

  for (const agent of agents) {
    if (agent.status !== 'active' && agent.status !== 'idle') continue;
    const config = getConfig(agent.connectionId);
    if (!config) continue;

    const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
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
  getConfig: (connectionId: string) => OpenClawConfig | null,
  context?: MessageContext
): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig(toAgent.connectionId);
  if (!config) {
    return { ok: false, error: `No config for ${toAgent.name}` };
  }

  const sessionKey = toAgent.id.includes('::') ? toAgent.id.split('::')[1] : toAgent.id;
  
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
