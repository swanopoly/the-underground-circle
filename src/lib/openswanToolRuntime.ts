import { supabase } from './supabase';
import { semanticSearchMemories } from './memoryEmbeddings';
import { nextCronOccurrence, parseRecurrence, scheduleAction } from './scheduledActions';
import type { OpenSwanExecutionStatus } from './openswanExecution';
import type { OpenSwanTaskPlan, OpenSwanToolName } from './openswanTaskPlanner';
import type { SwanBotStructuredArtifact } from './swanbot';
import type { ApprovalKind } from './agentRunSystem';
import { createFilesInRoomFromArtifact, createWorkspaceFromArtifact, type RoomArtifactApplyResult, type WorkspaceCreationResult } from './chatWorkspace';
import { focusRoomWorkspaceFile, primeRoomWorkspaceLaunch } from './roomWorkspaceLauncher';
import { detectClaudeCodeBridge, execBridgeCommand } from './claudeCodeDetector';
import { describeComputerUsePlan, toBrowserPlanCardData, type BrowserPlanCardData } from './computerUse';
import { getPlugin } from './pluginRegistry';

export type OpenSwanToolSurface = 'main_chat' | 'room_chat' | 'office' | 'task_run';
export type OpenSwanRuntimeToolName =
  | OpenSwanToolName
  | 'browser.plan_task'
  | 'search_memories'
  | 'save_memory'
  | 'fetch_url'
  | 'list_circle_members'
  | 'schedule_action'
  | 'missions.list'
  | 'missions.create_task'
  | 'missions.complete_task'
  | 'github.list_repos'
  | 'github.read_file'
  | 'tasks.list'
  | 'tasks.get'
  | 'tasks.create'
  | 'tasks.update_status'
  | 'tasks.assign'
  | 'wp.discover_types'
  | 'wp.upload_media'
  | 'wp.create_slide'
  | 'wp.list_posts'
  | 'credentials.get'
  | 'tasks.comment'
  | 'tasks.add_artifact'
  | 'goals.list'
  | 'goals.create'
  | 'goals.update_progress'
  | 'goals.update_status'
  | 'messages.list'
  | 'messages.create'
  | 'check_ins.list'
  | 'research.search'
  | 'research.save'
  | 'rooms.list'
  | 'rooms.create'
  | 'rooms.send_message'
  | 'rooms.list_tasks'
  | 'rooms.create_task'
  | 'rooms.create_file'
  | 'rooms.update_file'
  | 'rooms.list_files'
  | 'rooms.read_file'
  | 'integrations.list'
  | 'office.list_agents'
  | 'approvals.list'
  | 'approvals.request'
  | 'approvals.resolve';

export type OpenSwanToolDefinition = {
  name: OpenSwanRuntimeToolName;
  label: string;
  surfaces: OpenSwanToolSurface[];
  description: string;
  inputSchema?: Record<string, unknown>;
};

export type OpenSwanToolPolicyFamily =
  | 'code'
  | 'verification'
  | 'memory'
  | 'knowledge'
  | 'coordination'
  | 'browser'
  | 'workspace'
  | 'approval';

export type OpenSwanToolApprovalMode = 'auto' | 'ask';

export type OpenSwanToolPolicy = {
  family: OpenSwanToolPolicyFamily;
  approvalMode: OpenSwanToolApprovalMode;
  mutatesState: boolean;
  externalSideEffect: boolean;
  approvalKind?: ApprovalKind;
  summary: string;
};

export type OpenSwanToolEvent = {
  tool: OpenSwanRuntimeToolName;
  status: OpenSwanExecutionStatus;
  summary: string;
  command?: string;
  metadata?: Record<string, unknown>;
};

export type OpenSwanRuntimeToolContext = {
  circleId: string;
  userId: string;
  surface?: OpenSwanToolSurface;
  threadId?: string;
  activeSoulKey?: string;
  runId?: string;
  activePluginIds?: string[];
};

type CreateRoomWorkspaceArgs = {
  circleId: string;
  artifact: SwanBotStructuredArtifact;
};

type ApplyArtifactsArgs = {
  roomId: string;
  artifact: SwanBotStructuredArtifact;
};

type OpenPreviewArgs =
  | {
      circleId: string;
      roomId: string;
      primaryFileId?: string | null;
      preferredPanel?: 'chat' | 'playground';
    }
  | {
      roomId: string;
      primaryFileId?: string | null;
      preferredPanel?: 'chat' | 'playground';
    };

type VerificationCommandArgs = {
  command?: string;
};

type BrowserPlanTaskArgs = {
  task: string;
};

type SearchMemoriesArgs = {
  query: string;
  limit?: number;
};

type FetchUrlArgs = {
  url: string;
};

type ScheduleActionArgs = {
  kind: string;
  payload: Record<string, unknown>;
  scheduled_for?: string;
  recurrence?: string;
};

export type OpenSwanToolExecutionArgs = {
  'workspace.create_room': CreateRoomWorkspaceArgs;
  'workspace.apply_artifacts': ApplyArtifactsArgs;
  'workspace.open_preview': OpenPreviewArgs;
  'code.inspect': { note?: string };
  'code.generate': { note?: string };
  'code.review': { note?: string };
  'verification.typecheck': VerificationCommandArgs;
  'verification.tests': VerificationCommandArgs;
  'verification.lint': VerificationCommandArgs;
  'verification.preview': { note?: string };
  'browser.plan_task': BrowserPlanTaskArgs;
  search_memories: SearchMemoriesArgs;
  save_memory: { title: string; content: string; kind?: string };
  fetch_url: FetchUrlArgs;
  list_circle_members: Record<string, never>;
  schedule_action: ScheduleActionArgs;
  'missions.list': { status?: string };
  'missions.create_task': { missionId: string; title: string; description?: string; assigneeId?: string };
  'missions.complete_task': { taskId: string };
  'github.list_repos': Record<string, never>;
  'github.read_file': { owner: string; repo: string; path: string; branch?: string };
  'tasks.list': { status?: string };
  'tasks.get': { taskId: string };
  'tasks.create': { title: string; description?: string; priority?: string; assigneeId?: string };
  'tasks.update_status': { taskId: string; status: string };
  'tasks.assign': { taskId: string; assigneeId: string };
  'tasks.comment': { taskId: string; content: string; taskRunId?: string };
  'tasks.add_artifact': { runId: string; taskId: string; artifactKind: string; label: string; content?: string; url?: string; filePath?: string; metadata?: Record<string, unknown> };
  'goals.list': { activeOnly?: boolean };
  'goals.create': { title: string; description?: string; goalType?: string; targetValue?: number; unit?: string; dueDate?: string; ownerId?: string };
  'goals.update_progress': { goalId: string; currentValue: number };
  'goals.update_status': { goalId: string; status: string };
  'messages.list': { limit?: number };
  'messages.create': { content: string; threadId?: string; replyToId?: string };
  'check_ins.list': { limit?: number; since?: string };
  'research.search': { query: string; limit?: number };
  'research.save': { title: string; summary?: string; content?: string; domainKey?: string; tags?: string[]; sourceUrl?: string };
  'rooms.list': Record<string, never>;
  'rooms.create': { name: string; description?: string };
  'rooms.send_message': { roomId: string; content: string; messageType?: string };
  'rooms.list_tasks': { roomId: string };
  'rooms.create_task': { roomId: string; name: string; prompt: string; schedule?: string; agent?: string; taskType?: string };
  'rooms.create_file': { roomId: string; name: string; content: string; fileType?: string };
  'rooms.update_file': { fileId: string; content: string };
  'rooms.list_files': { roomId: string };
  'rooms.read_file': { fileId: string };
  'integrations.list': Record<string, never>;
  'office.list_agents': Record<string, never>;
  'approvals.list': Record<string, never>;
  'approvals.request': { runId: string; approvalKind: string; title: string; description?: string; payload?: Record<string, unknown>; timeoutSeconds?: number };
  'approvals.resolve': { approvalId: string; status: 'approved' | 'rejected' };
  [key: string]: Record<string, unknown>;
};

type VerificationExecutionResult = {
  ok: boolean;
  executed: boolean;
  command: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export type OpenSwanToolExecutionResultMap = {
  'workspace.create_room': WorkspaceCreationResult;
  'workspace.apply_artifacts': RoomArtifactApplyResult;
  'workspace.open_preview': { ok: true };
  'code.inspect': { ok: true; planned: true };
  'code.generate': { ok: true; planned: true };
  'code.review': { ok: true; planned: true };
  'verification.typecheck': VerificationExecutionResult;
  'verification.tests': VerificationExecutionResult;
  'verification.lint': VerificationExecutionResult;
  'verification.preview': { ok: true; planned: true };
  'browser.plan_task': { ok: true; summaryText: string; backend: string; actionCount: number; requiresApproval: boolean; plan: BrowserPlanCardData };
  search_memories: { ok: boolean; resultsText: string };
  save_memory: { ok: boolean; resultsText: string };
  'missions.list': { ok: boolean; resultsText: string };
  'missions.create_task': { ok: boolean; resultsText: string };
  'missions.complete_task': { ok: boolean; resultsText: string };
  'github.list_repos': { ok: boolean; resultsText: string };
  'github.read_file': { ok: boolean; resultsText: string };
  'tasks.list': { ok: boolean; resultsText: string };
  'tasks.get': { ok: boolean; resultsText: string };
  'tasks.create': { ok: boolean; resultsText: string };
  'tasks.update_status': { ok: boolean; resultsText: string };
  'tasks.assign': { ok: boolean; resultsText: string };
  'tasks.comment': { ok: boolean; resultsText: string };
  'tasks.add_artifact': { ok: boolean; resultsText: string };
  'goals.list': { ok: boolean; resultsText: string };
  'goals.create': { ok: boolean; resultsText: string };
  'goals.update_progress': { ok: boolean; resultsText: string };
  'goals.update_status': { ok: boolean; resultsText: string };
  'messages.list': { ok: boolean; resultsText: string };
  'messages.create': { ok: boolean; resultsText: string };
  'check_ins.list': { ok: boolean; resultsText: string };
  'research.search': { ok: boolean; resultsText: string };
  'research.save': { ok: boolean; resultsText: string };
  'rooms.list': { ok: boolean; resultsText: string };
  'rooms.create': { ok: boolean; resultsText: string };
  'rooms.send_message': { ok: boolean; resultsText: string };
  'rooms.list_tasks': { ok: boolean; resultsText: string };
  'rooms.create_task': { ok: boolean; resultsText: string };
  'rooms.create_file': { ok: boolean; resultsText: string };
  'rooms.update_file': { ok: boolean; resultsText: string };
  'rooms.list_files': { ok: boolean; resultsText: string };
  'rooms.read_file': { ok: boolean; resultsText: string };
  'integrations.list': { ok: boolean; resultsText: string };
  'office.list_agents': { ok: boolean; resultsText: string };
  'approvals.list': { ok: boolean; resultsText: string };
  'approvals.request': { ok: boolean; resultsText: string };
  'approvals.resolve': { ok: boolean; resultsText: string };
  fetch_url: { ok: boolean; content: string; status?: number; statusText?: string; error?: string };
  list_circle_members: { ok: true; resultsText: string };
  schedule_action: { ok: boolean; resultText: string; actionId?: string; error?: string };
  [key: string]: Record<string, unknown>;
};

const DEFAULT_VERIFICATION_COMMANDS: Record<'verification.typecheck' | 'verification.tests' | 'verification.lint', string> = {
  'verification.typecheck': 'npm run typecheck:app',
  'verification.tests': 'npm test',
  'verification.lint': 'npm run lint',
};

const TOOL_DEFINITIONS: OpenSwanToolDefinition[] = [
  {
    name: 'workspace.create_room',
    label: 'Create Room Workspace',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Create or switch into a room-backed workspace for multi-file iteration.',
  },
  {
    name: 'workspace.apply_artifacts',
    label: 'Apply Artifacts',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Turn generated artifacts into room files and workspace state.',
  },
  {
    name: 'workspace.open_preview',
    label: 'Open Preview',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Open a generated UI or webpage in a room preview/sandbox.',
  },
  {
    name: 'browser.plan_task',
    label: 'Plan Browser Task',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Plan a browser automation task, choose the right backend, and explain the required approval path.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The browser task to plan.' },
      },
      required: ['task'],
    },
  },
  {
    name: 'code.inspect',
    label: 'Inspect Code',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Read and inspect relevant code or surrounding context before taking action.',
  },
  {
    name: 'code.generate',
    label: 'Generate Code',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Produce implementation-ready code, files, or structured artifacts.',
  },
  {
    name: 'code.review',
    label: 'Review Code',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Produce a severity-ranked code review with concrete findings.',
  },
  {
    name: 'verification.typecheck',
    label: 'Typecheck',
    surfaces: ['room_chat', 'task_run', 'office'],
    description: 'Validate that code compiles and type contracts still hold.',
  },
  {
    name: 'verification.tests',
    label: 'Run Tests',
    surfaces: ['room_chat', 'task_run', 'office'],
    description: 'Run or recommend tests and regression checks for the current task.',
  },
  {
    name: 'verification.lint',
    label: 'Lint',
    surfaces: ['room_chat', 'task_run', 'office'],
    description: 'Check style and static-analysis quality expectations.',
  },
  {
    name: 'verification.preview',
    label: 'Preview',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Preview generated UI or webpage output.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Optional note about what should be previewed.' },
      },
    },
  },
  {
    name: 'search_memories',
    label: 'Search Memories',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Search the circle memory store for relevant decisions, facts, and prior context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in memory.' },
        limit: { type: 'number', description: 'Maximum results to return.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    label: 'Fetch URL',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Fetch a public URL and return its text content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_circle_members',
    label: 'List Circle Members',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'List the members of the current circle.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'schedule_action',
    label: 'Schedule Action',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Queue an automated action such as a tweet, Slack post, email, webhook, or reminder.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Action kind (tweet, slack_post, webhook, reminder, etc.)' },
        payload: { type: 'object', description: 'Action-specific payload.' },
        scheduled_for: { type: 'string', description: 'Optional ISO timestamp for execution.' },
        recurrence: { type: 'string', description: 'Optional cron expression or natural-language recurrence.' },
      },
      required: ['kind', 'payload'],
    },
  },
  // ── Missions ──────────────────────────────────────────────────────────────
  {
    name: 'missions.list',
    label: 'List Missions',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List active missions in this circle with progress, tasks, and deadlines.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status: active, completed, archived. Default: active.' } } },
  },
  {
    name: 'missions.create_task',
    label: 'Create Mission Task',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Add a new task to an existing mission.',
    inputSchema: { type: 'object', properties: { missionId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, assigneeId: { type: 'string' } }, required: ['missionId', 'title'] },
  },
  {
    name: 'missions.complete_task',
    label: 'Complete Mission Task',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Mark a mission task as done.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  // ── GitHub ────────────────────────────────────────────────────────────────
  {
    name: 'github.list_repos',
    label: 'List GitHub Repos',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List repositories connected to this circle via GitHub.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'github.read_file',
    label: 'Read GitHub File',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Read the contents of a file from a GitHub repository.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, branch: { type: 'string' } }, required: ['owner', 'repo', 'path'] },
  },
  // ── Tasks (Kanban) ────────────────────────────────────────────────────────
  {
    name: 'tasks.list',
    label: 'List Tasks',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List kanban tasks in this circle, optionally filtered by status.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'backlog, todo, in_progress, peer_review, review, approved, done, mine, open, or all.' } } },
  },
  {
    name: 'tasks.get',
    label: 'Get Task',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Load one task with status, priority, assignee, and description.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'tasks.create',
    label: 'Create Task',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Create a new kanban task in this circle.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string' }, assigneeId: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'tasks.update_status',
    label: 'Update Task Status',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Move a task to a new kanban status.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' } }, required: ['taskId', 'status'] },
  },
  {
    name: 'tasks.assign',
    label: 'Assign Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Assign an existing task to a circle member.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, assigneeId: { type: 'string' } }, required: ['taskId', 'assigneeId'] },
  },
  {
    name: 'tasks.comment',
    label: 'Comment On Task',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Add a comment or progress note to a task.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, content: { type: 'string' }, taskRunId: { type: 'string' } }, required: ['taskId', 'content'] },
  },
  {
    name: 'tasks.add_artifact',
    label: 'Add Task Artifact',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Attach a durable artifact to a task run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        taskId: { type: 'string' },
        artifactKind: { type: 'string' },
        label: { type: 'string' },
        content: { type: 'string' },
        url: { type: 'string' },
        filePath: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['runId', 'taskId', 'artifactKind', 'label'],
    },
  },
  // ── Goals ─────────────────────────────────────────────────────────────────
  {
    name: 'goals.list',
    label: 'List Goals',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List circle goals and current progress.',
    inputSchema: { type: 'object', properties: { activeOnly: { type: 'boolean' } } },
  },
  {
    name: 'goals.create',
    label: 'Create Goal',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a new circle goal.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        goalType: { type: 'string' },
        targetValue: { type: 'number' },
        unit: { type: 'string' },
        dueDate: { type: 'string' },
        ownerId: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'goals.update_progress',
    label: 'Update Goal Progress',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update the numeric progress of a goal.',
    inputSchema: { type: 'object', properties: { goalId: { type: 'string' }, currentValue: { type: 'number' } }, required: ['goalId', 'currentValue'] },
  },
  {
    name: 'goals.update_status',
    label: 'Update Goal Status',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Change a goal status such as active, paused, completed, or archived.',
    inputSchema: { type: 'object', properties: { goalId: { type: 'string' }, status: { type: 'string' } }, required: ['goalId', 'status'] },
  },
  // ── Chat + Check-ins ──────────────────────────────────────────────────────
  {
    name: 'messages.list',
    label: 'List Messages',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List recent circle chat messages for context.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'messages.create',
    label: 'Post Message',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Post a new message into the current circle chat thread.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        threadId: { type: 'string' },
        replyToId: { type: 'string' },
      },
      required: ['content'],
    },
  },
  {
    name: 'check_ins.list',
    label: 'List Check-Ins',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List recent circle check-ins and daily updates.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, since: { type: 'string' } } },
  },
  // ── Research ──────────────────────────────────────────────────────────────
  {
    name: 'research.search',
    label: 'Search Research',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Search the curated research corpus for relevant digests, reports, and notes.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'research.save',
    label: 'Save Research',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Persist a new research note or finding into the research corpus.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
        domainKey: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        sourceUrl: { type: 'string' },
      },
      required: ['title'],
    },
  },
  // ── Rooms ─────────────────────────────────────────────────────────────────
  {
    name: 'rooms.list',
    label: 'List Rooms',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List rooms/projects in this circle.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'rooms.create',
    label: 'Create Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a new room/project in this circle.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'rooms.send_message',
    label: 'Send Room Message',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Post a message into a room conversation.',
    inputSchema: { type: 'object', properties: { roomId: { type: 'string' }, content: { type: 'string' }, messageType: { type: 'string' } }, required: ['roomId', 'content'] },
  },
  {
    name: 'rooms.list_tasks',
    label: 'List Room Tasks',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List automation or runner tasks attached to a room.',
    inputSchema: { type: 'object', properties: { roomId: { type: 'string' } }, required: ['roomId'] },
  },
  {
    name: 'rooms.create_task',
    label: 'Create Room Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a room automation/task runner entry.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        name: { type: 'string' },
        prompt: { type: 'string' },
        schedule: { type: 'string' },
        agent: { type: 'string' },
        taskType: { type: 'string' },
      },
      required: ['roomId', 'name', 'prompt'],
    },
  },
  {
    name: 'rooms.create_file',
    label: 'Create Room File',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Create a file inside an existing room.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        name: { type: 'string' },
        content: { type: 'string' },
        fileType: { type: 'string' },
      },
      required: ['roomId', 'name', 'content'],
    },
  },
  {
    name: 'rooms.update_file',
    label: 'Update Room File',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Update the content of an existing room file.',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, content: { type: 'string' } }, required: ['fileId', 'content'] },
  },
  // ── Room Files ────────────────────────────────────────────────────────────
  {
    name: 'rooms.list_files',
    label: 'List Room Files',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List files in a project room.',
    inputSchema: { type: 'object', properties: { roomId: { type: 'string' } }, required: ['roomId'] },
  },
  {
    name: 'rooms.read_file',
    label: 'Read Room File',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Read the contents of a file in a project room.',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] },
  },
  // ── Memory Write ──────────────────────────────────────────────────────────
  {
    name: 'save_memory',
    label: 'Save Memory',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Save a new memory (fact, decision, preference, instruction) to the circle memory store.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, kind: { type: 'string', description: 'preference, fact, decision, finding, instruction' } }, required: ['title', 'content'] },
  },
  // ── WordPress Admin ──────────────────────────────────────────────────────
  {
    name: 'wp.discover_types',
    label: 'WP Discover Types',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List available post types on a WordPress site — discovers if plugins like DI Slides register REST endpoints.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string', description: 'WordPress site URL e.g. https://example.com/wp' }, onePasswordItem: { type: 'string', description: '1Password item name with WP credentials' } }, required: ['siteUrl', 'onePasswordItem'] },
  },
  {
    name: 'wp.upload_media',
    label: 'WP Upload Media',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Upload an image or file from chat attachments to a WordPress site media library.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, onePasswordItem: { type: 'string' }, storagePath: { type: 'string', description: 'Supabase Storage path of the attachment' }, fileName: { type: 'string' }, mimeType: { type: 'string' } }, required: ['siteUrl', 'onePasswordItem', 'storagePath', 'fileName'] },
  },
  {
    name: 'wp.create_slide',
    label: 'WP Create Slide',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Upload an image and create a DI Slides slide on a WordPress site in one step.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, onePasswordItem: { type: 'string' }, storagePath: { type: 'string' }, fileName: { type: 'string' }, mimeType: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', description: 'draft or publish' } }, required: ['siteUrl', 'onePasswordItem', 'storagePath', 'fileName'] },
  },
  {
    name: 'wp.list_posts',
    label: 'WP List Posts',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List posts or custom post type items from a WordPress site.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, onePasswordItem: { type: 'string' }, postType: { type: 'string', description: 'e.g. posts, pages, flavor_di_slides' }, perPage: { type: 'number' } }, required: ['siteUrl', 'onePasswordItem'] },
  },
  {
    name: 'credentials.get',
    label: 'Get Credentials',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Fetch credentials from 1Password. Returns field values for the named item. Never exposes credentials to the user.',
    inputSchema: { type: 'object', properties: { item: { type: 'string', description: '1Password item name' }, vault: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } }, required: ['item'] },
  },
  // ── Integrations + Office ─────────────────────────────────────────────────
  {
    name: 'integrations.list',
    label: 'List Integrations',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List installed circle integrations and capability flags.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'office.list_agents',
    label: 'List Office Agents',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List published office agents and their current live status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'approvals.list',
    label: 'List Approvals',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'List pending run approvals in the current circle.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'approvals.request',
    label: 'Request Approval',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Create a pending approval request for a run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        approvalKind: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        payload: { type: 'object' },
        timeoutSeconds: { type: 'number' },
      },
      required: ['runId', 'approvalKind', 'title'],
    },
  },
  {
    name: 'approvals.resolve',
    label: 'Resolve Approval',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Approve or reject a pending approval request.',
    inputSchema: { type: 'object', properties: { approvalId: { type: 'string' }, status: { type: 'string' } }, required: ['approvalId', 'status'] },
  },
];

function getBaseOpenSwanToolPolicy(tool: OpenSwanRuntimeToolName): OpenSwanToolPolicy {
  if (tool.startsWith('code.')) {
    return {
      family: 'code',
      approvalMode: 'auto',
      mutatesState: tool === 'code.generate',
      externalSideEffect: false,
      summary: tool === 'code.generate'
        ? 'Generates implementation-ready code or artifact content.'
        : 'Inspects or reviews code without touching external systems.',
    };
  }

  if (tool.startsWith('verification.')) {
    return {
      family: 'verification',
      approvalMode: 'auto',
      mutatesState: false,
      externalSideEffect: false,
      summary: 'Runs or plans local verification checks for correctness.',
    };
  }

  if (tool === 'browser.plan_task') {
    return {
      family: 'browser',
      approvalMode: 'auto',
      mutatesState: false,
      externalSideEffect: false,
      approvalKind: 'browser_action',
      summary: 'Plans browser work and explains approval requirements without executing live actions.',
    };
  }

  if (tool === 'workspace.create_room' || tool === 'workspace.apply_artifacts' || tool === 'workspace.open_preview') {
    return {
      family: 'workspace',
      approvalMode: 'auto',
      mutatesState: tool !== 'workspace.open_preview',
      externalSideEffect: false,
      approvalKind: tool === 'workspace.open_preview' ? undefined : 'file_write',
      summary: tool === 'workspace.open_preview'
        ? 'Opens or focuses a preview surface.'
        : 'Changes room workspace state or project files.',
    };
  }

  if (tool === 'search_memories' || tool === 'save_memory') {
    return {
      family: 'memory',
      approvalMode: tool === 'save_memory' ? 'auto' : 'auto',
      mutatesState: tool === 'save_memory',
      externalSideEffect: false,
      summary: tool === 'save_memory'
        ? 'Writes durable memory into the circle knowledge graph.'
        : 'Reads prior decisions, preferences, and context from memory.',
    };
  }

  if (
    tool === 'fetch_url' ||
    tool === 'list_circle_members' ||
    tool === 'github.list_repos' ||
    tool === 'github.read_file' ||
    tool === 'integrations.list' ||
    tool === 'office.list_agents' ||
    tool === 'messages.list' ||
    tool === 'check_ins.list' ||
    tool === 'rooms.list' ||
    tool === 'rooms.list_tasks' ||
    tool === 'rooms.list_files' ||
    tool === 'rooms.read_file' ||
    tool === 'tasks.list' ||
    tool === 'tasks.get' ||
    tool === 'goals.list' ||
    tool === 'missions.list' ||
    tool === 'research.search' ||
    tool === 'approvals.list'
  ) {
    return {
      family: 'knowledge',
      approvalMode: 'auto',
      mutatesState: false,
      externalSideEffect: tool === 'fetch_url',
      summary: tool === 'fetch_url'
        ? 'Reads a public external URL.'
        : 'Reads app, repo, research, or approval state without mutating it.',
    };
  }

  if (tool === 'schedule_action') {
    return {
      family: 'coordination',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: true,
      approvalKind: 'external_send',
      summary: 'Queues an outbound automation or scheduled action that can affect external systems.',
    };
  }

  if (tool.startsWith('approvals.')) {
    return {
      family: 'approval',
      approvalMode: 'auto',
      mutatesState: true,
      externalSideEffect: false,
      approvalKind: 'plan_approval',
      summary: 'Mutates approval state for a gated action.',
    };
  }

  return {
    family: 'coordination',
    approvalMode: 'auto',
    mutatesState: true,
    externalSideEffect: false,
    approvalKind: 'privileged_action',
    summary: 'Coordinates app state and work execution inside the circle.',
  };
}

function resolveApprovalModeOverride(
  tool: OpenSwanRuntimeToolName,
  family: OpenSwanToolPolicyFamily,
  activePluginIds?: string[],
): OpenSwanToolApprovalMode | null {
  for (const pluginId of activePluginIds || []) {
    const plugin = getPlugin(pluginId);
    const override = plugin?.approvalDefaults?.[tool] || plugin?.approvalDefaults?.[family];
    if (override === 'auto' || override === 'ask') return override;
  }
  return null;
}

export function getOpenSwanToolPolicy(
  tool: OpenSwanRuntimeToolName,
  activePluginIds?: string[],
): OpenSwanToolPolicy {
  const base = getBaseOpenSwanToolPolicy(tool);
  const override = resolveApprovalModeOverride(tool, base.family, activePluginIds);
  return override ? { ...base, approvalMode: override } : base;
}

const TOOL_LOOP_SAFE_NAMES = new Set<OpenSwanRuntimeToolName>([
  'code.inspect',
  'browser.plan_task',
  'code.generate',
  'code.review',
  'verification.typecheck',
  'verification.tests',
  'verification.lint',
  'verification.preview',
  'search_memories',
  'save_memory',
  'fetch_url',
  'list_circle_members',
  'schedule_action',
  'missions.list',
  'missions.create_task',
  'missions.complete_task',
  'github.list_repos',
  'github.read_file',
  'tasks.list',
  'tasks.get',
  'tasks.create',
  'tasks.update_status',
  'tasks.assign',
  'tasks.comment',
  'tasks.add_artifact',
  'goals.list',
  'goals.create',
  'goals.update_progress',
  'goals.update_status',
  'messages.list',
  'messages.create',
  'check_ins.list',
  'research.search',
  'research.save',
  'rooms.list',
  'rooms.create',
  'rooms.send_message',
  'rooms.list_tasks',
  'rooms.create_task',
  'rooms.create_file',
  'rooms.update_file',
  'rooms.list_files',
  'rooms.read_file',
  'integrations.list',
  'office.list_agents',
  'approvals.list',
  'approvals.request',
  'approvals.resolve',
]);

export function listOpenSwanToolsForSurface(surface: OpenSwanToolSurface): OpenSwanToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) => tool.surfaces.includes(surface));
}

export function listOpenSwanAnthropicToolsForSurface(
  surface: OpenSwanToolSurface,
  allowedToolNames?: OpenSwanRuntimeToolName[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const allow = allowedToolNames?.length ? new Set(allowedToolNames) : null;
  return TOOL_DEFINITIONS
    .filter((tool) => tool.surfaces.includes(surface))
    .filter((tool) => TOOL_LOOP_SAFE_NAMES.has(tool.name))
    .filter((tool) => !allow || allow.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || { type: 'object', properties: {} },
    }));
}

export function buildOpenSwanToolBrief(
  surface: OpenSwanToolSurface,
  taskPlan: OpenSwanTaskPlan,
  activePluginIds?: string[],
): string {
  const toolLookup = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
  const lines = taskPlan.recommendedTools
    .filter((item) => toolLookup.get(item.tool)?.surfaces.includes(surface))
    .map((item) => {
      const tool = toolLookup.get(item.tool);
      const policy = getOpenSwanToolPolicy(item.tool, activePluginIds);
      return `- ${tool?.label || item.tool} [${item.priority}] [${policy.family}] [${policy.approvalMode.toUpperCase()}]: ${item.reason}`;
    });

  if (lines.length === 0) {
    return 'No specialized tools recommended for this surface yet.';
  }

  return `Recommended tools for this turn:\n${lines.join('\n')}`;
}

function stringifyMemoryResults(results: Awaited<ReturnType<typeof semanticSearchMemories>>): string {
  if (results.length === 0) return 'No matching memories found.';
  return results.map((r, i) =>
    `${i + 1}. [${r.memory_kind}] ${r.title}: ${r.content} (similarity: ${r.similarity.toFixed(2)})`
  ).join('\n');
}

function normalizeTaskStatusInput(status?: string | null): string | null {
  if (!status) return null;
  const normalized = status.trim().toLowerCase();
  if (['open', 'active'].includes(normalized)) return 'todo';
  if (['in progress', 'in-progress', 'doing'].includes(normalized)) return 'in_progress';
  if (['peer review', 'peer-review'].includes(normalized)) return 'peer_review';
  return normalized;
}

function renderTaskLine(task: Record<string, any>): string {
  return `- [${task.status}] ${task.title}${task.priority ? ` (${task.priority})` : ''}${task.assigned_to ? ` — assignee: ${task.assigned_to}` : ''} — id: ${String(task.id).slice(0, 8)}`;
}

async function maybeRequestToolApproval(
  tool: OpenSwanRuntimeToolName,
  args: Record<string, unknown>,
  context: OpenSwanRuntimeToolContext,
): Promise<{ approvalId: string; message: string } | null> {
  const policy = getOpenSwanToolPolicy(tool, context.activePluginIds);
  if (policy.approvalMode !== 'ask' || !context.runId || tool.startsWith('approvals.')) {
    return null;
  }

  const title = `OpenSwan approval required: ${tool}`;
  const { data: existing, error: existingError } = await supabase
    .from('agent_run_approvals')
    .select('id')
    .eq('run_id', context.runId)
    .eq('status', 'pending')
    .eq('title', title)
    .limit(1);

  if (!existingError && existing && existing.length > 0) {
    return {
      approvalId: String(existing[0].id),
      message: `Approval already pending for ${tool} (id: ${String(existing[0].id).slice(0, 8)}).`,
    };
  }

  const { requestRunApproval } = await import('./agentRunSystem');
  const approval = await requestRunApproval({
    runId: context.runId,
    circleId: context.circleId,
    approvalKind: policy.approvalKind || 'privileged_action',
    title,
    description: `${policy.summary} Review the requested tool input before continuing.`,
    requestedBy: context.userId,
    payload: {
      tool,
      args,
      policyFamily: policy.family,
      approvalMode: policy.approvalMode,
      mutatesState: policy.mutatesState,
      externalSideEffect: policy.externalSideEffect,
    },
  });

  if (!approval) {
    return {
      approvalId: '',
      message: `Approval required for ${tool}, but the request could not be created.`,
    };
  }

  return {
    approvalId: approval.id,
    message: `Approval requested for ${tool} (id: ${approval.id.slice(0, 8)}).`,
  };
}

export function formatOpenSwanRuntimeToolResult<T extends OpenSwanRuntimeToolName>(
  tool: T,
  result: OpenSwanToolExecutionResultMap[T],
): string {
  switch (tool) {
    case 'search_memories':
      return (result as OpenSwanToolExecutionResultMap['search_memories']).resultsText;
    case 'save_memory':
    case 'missions.list':
    case 'missions.create_task':
    case 'missions.complete_task':
    case 'github.list_repos':
    case 'github.read_file':
    case 'tasks.list':
    case 'tasks.get':
    case 'tasks.create':
    case 'tasks.update_status':
    case 'tasks.assign':
    case 'tasks.comment':
    case 'tasks.add_artifact':
    case 'goals.list':
    case 'goals.create':
    case 'goals.update_progress':
    case 'goals.update_status':
    case 'messages.list':
    case 'messages.create':
    case 'check_ins.list':
    case 'research.search':
    case 'research.save':
    case 'rooms.list':
    case 'rooms.create':
    case 'rooms.send_message':
    case 'rooms.list_tasks':
    case 'rooms.create_task':
    case 'rooms.create_file':
    case 'rooms.update_file':
    case 'rooms.list_files':
    case 'rooms.read_file':
    case 'integrations.list':
    case 'office.list_agents':
    case 'approvals.list':
    case 'approvals.request':
    case 'approvals.resolve':
      return (result as { resultsText: string }).resultsText;
    case 'browser.plan_task': {
      const browserResult = result as OpenSwanToolExecutionResultMap['browser.plan_task'];
      return browserResult.summaryText;
    }
    case 'fetch_url': {
      const fetchResult = result as OpenSwanToolExecutionResultMap['fetch_url'];
      if (!fetchResult.ok) {
        return fetchResult.error || 'Fetch failed.';
      }
      return fetchResult.content;
    }
    case 'list_circle_members':
      return (result as OpenSwanToolExecutionResultMap['list_circle_members']).resultsText;
    case 'schedule_action': {
      const scheduleResult = result as OpenSwanToolExecutionResultMap['schedule_action'];
      return scheduleResult.resultText;
    }
    case 'verification.typecheck':
    case 'verification.tests':
    case 'verification.lint': {
      const verificationResult = result as VerificationExecutionResult;
      if (!verificationResult.executed) {
        return verificationResult.error || 'Verification not executed.';
      }
      if (!verificationResult.ok) {
        return verificationResult.error || verificationResult.stderr || 'Verification failed.';
      }
      return verificationResult.stdout || `${tool} passed.`;
    }
    default:
      return JSON.stringify(result);
  }
}

export async function executeOpenSwanTool<T extends OpenSwanToolName>(
  tool: T,
  args: OpenSwanToolExecutionArgs[T],
): Promise<OpenSwanToolExecutionResultMap[T]> {
  switch (tool) {
    case 'workspace.create_room':
      return await createWorkspaceFromArtifact(
        (args as OpenSwanToolExecutionArgs['workspace.create_room']).circleId,
        (args as OpenSwanToolExecutionArgs['workspace.create_room']).artifact,
      ) as OpenSwanToolExecutionResultMap[T];
    case 'workspace.apply_artifacts':
      return await createFilesInRoomFromArtifact(
        (args as OpenSwanToolExecutionArgs['workspace.apply_artifacts']).roomId,
        (args as OpenSwanToolExecutionArgs['workspace.apply_artifacts']).artifact,
      ) as OpenSwanToolExecutionResultMap[T];
    case 'workspace.open_preview': {
      const previewArgs = args as OpenSwanToolExecutionArgs['workspace.open_preview'];
      if ('circleId' in previewArgs) {
        primeRoomWorkspaceLaunch({
          circleId: previewArgs.circleId,
          roomId: previewArgs.roomId,
          primaryFileId: previewArgs.primaryFileId || null,
          preferredPanel: previewArgs.preferredPanel || 'playground',
        });
      } else {
        focusRoomWorkspaceFile({
          roomId: previewArgs.roomId,
          primaryFileId: previewArgs.primaryFileId || null,
          preferredPanel: previewArgs.preferredPanel || 'playground',
        });
      }
      return { ok: true } as OpenSwanToolExecutionResultMap[T];
    }
    case 'verification.typecheck':
    case 'verification.tests':
    case 'verification.lint': {
      const verificationTool = tool as 'verification.typecheck' | 'verification.tests' | 'verification.lint';
      const command = (args as VerificationCommandArgs).command || DEFAULT_VERIFICATION_COMMANDS[verificationTool];
      const bridgeOk = await detectClaudeCodeBridge();
      if (!bridgeOk) {
        return {
          ok: false,
          executed: false,
          command,
          error: 'Local coding bridge unavailable',
        } as OpenSwanToolExecutionResultMap[T];
      }
      const result = await execBridgeCommand(command);
      return {
        ok: result.ok,
        executed: true,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      } as OpenSwanToolExecutionResultMap[T];
    }
    default:
      return { ok: true, planned: true } as OpenSwanToolExecutionResultMap[T];
  }
}

export async function executeOpenSwanRuntimeTool<T extends OpenSwanRuntimeToolName>(
  tool: T,
  args: OpenSwanToolExecutionArgs[T],
  context: OpenSwanRuntimeToolContext,
): Promise<OpenSwanToolExecutionResultMap[T]> {
  const approvalGate = await maybeRequestToolApproval(tool, (args || {}) as Record<string, unknown>, context);
  if (approvalGate) {
    if (tool === 'schedule_action') {
      return {
        ok: false,
        resultText: approvalGate.message,
        error: approvalGate.message,
        approvalRequest: { id: approvalGate.approvalId, required: true },
      } as unknown as OpenSwanToolExecutionResultMap[T];
    }
    return {
      ok: false,
      resultsText: approvalGate.message,
      approvalRequest: { id: approvalGate.approvalId, required: true },
    } as unknown as OpenSwanToolExecutionResultMap[T];
  }

  switch (tool) {
    case 'search_memories': {
      const results = await semanticSearchMemories({
        queryText: String((args as SearchMemoriesArgs).query || ''),
        circleId: context.circleId,
        soulKey: context.activeSoulKey,
        limit: Math.min(Number((args as SearchMemoriesArgs).limit) || 8, 20),
        matchThreshold: 0.5,
      });
      return {
        ok: true,
        resultsText: stringifyMemoryResults(results),
      } as OpenSwanToolExecutionResultMap[T];
    }
    case 'browser.plan_task': {
      const browserPlan = await describeComputerUsePlan({
        task: String((args as BrowserPlanTaskArgs).task || ''),
        circleId: context.circleId,
        agentName: 'OpenSwan',
      });
      return {
        ok: true,
        summaryText: browserPlan.summaryText,
        backend: browserPlan.backendLabel,
        actionCount: browserPlan.actions.length,
        requiresApproval: browserPlan.requiresApproval,
        plan: toBrowserPlanCardData(browserPlan),
      } as OpenSwanToolExecutionResultMap[T];
    }
    case 'fetch_url': {
      const url = String((args as FetchUrlArgs).url || '');
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
          ok: false,
          content: '',
          error: 'Invalid URL — must start with http:// or https://',
        } as OpenSwanToolExecutionResultMap[T];
      }
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'OpenSwan/1.0 (The Underground Circle)' },
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        if (!res.ok) {
          return {
            ok: false,
            content: '',
            status: res.status,
            statusText: res.statusText,
            error: `HTTP ${res.status}: ${res.statusText}`,
          } as OpenSwanToolExecutionResultMap[T];
        }
        return {
          ok: true,
          content: text.slice(0, 8000) + (text.length > 8000 ? '\n...(truncated)' : ''),
          status: res.status,
          statusText: res.statusText,
        } as OpenSwanToolExecutionResultMap[T];
      } catch (error) {
        return {
          ok: false,
          content: '',
          error: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        } as OpenSwanToolExecutionResultMap[T];
      }
    }
    case 'list_circle_members': {
      const { data } = await supabase
        .from('circle_members')
        .select('user:profiles(display_name, username)')
        .eq('circle_id', context.circleId);
      const resultsText = !data || data.length === 0
        ? 'No members found.'
        : (data as any[])
            .map((row, index) => `${index + 1}. ${row.user?.display_name || row.user?.username || 'Unknown'}`)
            .join('\n');
      return {
        ok: true,
        resultsText,
      } as OpenSwanToolExecutionResultMap[T];
    }
    case 'schedule_action': {
      try {
        const recurrence = (args as ScheduleActionArgs).recurrence
          ? parseRecurrence(String((args as ScheduleActionArgs).recurrence))
          : null;
        const scheduledFor = (args as ScheduleActionArgs).scheduled_for
          ? String((args as ScheduleActionArgs).scheduled_for)
          : recurrence
            ? nextCronOccurrence(recurrence.cron).toISOString()
            : undefined;
        const result = await scheduleAction({
          kind: String((args as ScheduleActionArgs).kind) as any,
          circleId: context.circleId || null,
          payload: ((args as ScheduleActionArgs).payload || {}) as Record<string, unknown>,
          scheduledFor,
          recurrence: recurrence?.cron,
          recurrenceLabel: recurrence?.label,
        } as any);
        return {
          ok: true,
          actionId: result.id,
          resultText: recurrence
            ? `Recurring action queued (id: ${result.id}). ${recurrence.label}. Next: ${new Date(result.scheduled_for).toLocaleString()}.`
            : `Action queued (id: ${result.id}). Check the Outbox for status.`,
        } as OpenSwanToolExecutionResultMap[T];
      } catch (error) {
        return {
          ok: false,
          resultText: `Schedule failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        } as OpenSwanToolExecutionResultMap[T];
      }
    }
    // ── Missions ──────────────────────────────────────────────────────────
    case 'missions.list': {
      try {
        const { getMissions, getMissionTasks, missionProgress } = await import('./missions');
        const status = (args as any).status || 'active';
        const missions = await getMissions(context.circleId);
        const filtered = status === 'all' ? missions : missions.filter(m => m.status === status);
        const lines: string[] = [];
        for (const m of filtered.slice(0, 10)) {
          const tasks = await getMissionTasks(m.id);
          const pct = missionProgress(tasks);
          const done = tasks.filter(t => t.status === 'done').length;
          lines.push(`- **${m.title}** [${m.status}] ${pct}% (${done}/${tasks.length} tasks)${m.deadline ? ` due ${m.deadline}` : ''}`);
        }
        return { ok: true, resultsText: lines.length > 0 ? lines.join('\n') : 'No missions found.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.create_task': {
      try {
        const { createMissionTask } = await import('./missions');
        const a = args as any;
        const { task, error } = await createMissionTask(a.missionId, a.title, { description: a.description, assigneeId: a.assigneeId });
        if (error || !task) return { ok: false, resultsText: error || 'Failed to create task.' } as any;
        return { ok: true, resultsText: `Created task "${task.title}" (id: ${task.id})` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.complete_task': {
      try {
        const { updateMissionTask } = await import('./missions');
        const { error } = await updateMissionTask((args as any).taskId, { status: 'done' });
        if (error) return { ok: false, resultsText: error } as any;
        return { ok: true, resultsText: `Task marked as done.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── GitHub ────────────────────────────────────────────────────────────
    case 'github.list_repos': {
      try {
        const { getStoredToken, listRepos } = await import('./github');
        const token = await getStoredToken(context.circleId);
        if (!token) return { ok: false, resultsText: 'No GitHub token stored for this circle.' } as any;
        const { repos } = await listRepos(token, 1);
        const lines = repos.slice(0, 20).map(r => `- ${r.full_name} (${r.private ? 'private' : 'public'}, ${r.language || 'unknown'})`);
        return { ok: true, resultsText: lines.length > 0 ? lines.join('\n') : 'No repos found.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'github.read_file': {
      try {
        const { getStoredToken, getFileContent } = await import('./github');
        const token = await getStoredToken(context.circleId);
        if (!token) return { ok: false, resultsText: 'No GitHub token stored.' } as any;
        const a = args as any;
        const { content, error } = await getFileContent(token, a.owner, a.repo, a.path);
        if (error) return { ok: false, resultsText: error } as any;
        return { ok: true, resultsText: content.slice(0, 8000) } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Tasks (Kanban) ──────────────────────────────────────────────────
    case 'tasks.list': {
      try {
        const requestedStatus = String((args as any).status || 'all').toLowerCase();
        let q = supabase
          .from('tasks')
          .select('id, title, status, priority, assigned_to, created_at')
          .eq('circle_id', context.circleId)
          .order('created_at', { ascending: false })
          .limit(30);
        if (requestedStatus === 'mine') {
          q = q.or(`assigned_to.eq.${context.userId},created_by.eq.${context.userId}`);
        } else if (requestedStatus !== 'all') {
          const normalized = normalizeTaskStatusInput(requestedStatus);
          if (normalized) q = q.eq('status', normalized);
        }
        const { data } = await q;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No tasks found.' } as any;
        const lines = data.map((t: any) => renderTaskLine(t));
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.get': {
      try {
        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, description, status, priority, assigned_to, due_date, created_at, room_id, goal_id')
          .eq('id', (args as any).taskId)
          .single();
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data) return { ok: false, resultsText: 'Task not found.' } as any;
        const lines = [
          `Task: ${data.title}`,
          `Status: ${data.status}`,
          `Priority: ${data.priority || 'normal'}`,
          data.assigned_to ? `Assigned to: ${data.assigned_to}` : '',
          data.due_date ? `Due: ${data.due_date}` : '',
          data.room_id ? `Room: ${data.room_id}` : '',
          data.goal_id ? `Goal: ${data.goal_id}` : '',
          data.description ? `Description: ${data.description}` : '',
        ].filter(Boolean);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.create': {
      try {
        const a = args as any;
        const { data, error } = await supabase.from('tasks').insert({
          circle_id: context.circleId,
          title: a.title,
          description: a.description || null,
          priority: a.priority || 'normal',
          assigned_to: a.assigneeId || null,
          created_by: context.userId,
          status: 'todo',
        }).select('id, title').single();
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Created task "${data.title}" (id: ${data.id.slice(0, 8)})` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.update_status': {
      try {
        const a = args as any;
        const normalizedStatus = normalizeTaskStatusInput(a.status);
        if (!normalizedStatus) return { ok: false, resultsText: 'Invalid task status.' } as any;
        const update: Record<string, unknown> = { status: normalizedStatus, updated_at: new Date().toISOString() };
        if (normalizedStatus === 'done') update.completed_at = new Date().toISOString();
        const { error } = await supabase.from('tasks').update(update).eq('id', a.taskId);
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Task ${a.taskId.slice(0, 8)} moved to ${normalizedStatus}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.assign': {
      try {
        const a = args as any;
        const { error } = await supabase
          .from('tasks')
          .update({ assigned_to: a.assigneeId, updated_at: new Date().toISOString() })
          .eq('id', a.taskId);
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Task ${String(a.taskId).slice(0, 8)} assigned to ${a.assigneeId}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.comment': {
      try {
        const a = args as any;
        const insert: any = {
          task_id: a.taskId,
          user_id: context.userId,
          content: String(a.content || '').trim(),
        };
        if (a.taskRunId) insert.task_run_id = a.taskRunId;
        let result = await supabase.from('task_comments').insert(insert);
        if (result.error && insert.task_run_id && String(result.error.message || '').includes('task_run_id')) {
          delete insert.task_run_id;
          result = await supabase.from('task_comments').insert(insert);
        }
        if (result.error) return { ok: false, resultsText: result.error.message } as any;
        return { ok: true, resultsText: `Added comment to task ${String(a.taskId).slice(0, 8)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.add_artifact': {
      try {
        const { createTaskRunArtifact } = await import('./taskExecutionRuntime');
        const a = args as any;
        const { error } = await createTaskRunArtifact(
          a.runId,
          a.taskId,
          context.circleId,
          a.artifactKind,
          a.label,
          a.content,
          a.url,
          a.filePath,
          a.metadata,
        );
        if (error) return { ok: false, resultsText: error.message || String(error) } as any;
        return { ok: true, resultsText: `Attached artifact "${a.label}" to task run ${String(a.runId).slice(0, 8)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Goals ──────────────────────────────────────────────────────────
    case 'goals.list': {
      try {
        const { getCircleGoals, getGoalProgress } = await import('./goals');
        const goals = await getCircleGoals(context.circleId);
        const activeOnly = (args as any).activeOnly !== false;
        const filtered = activeOnly ? goals.filter((goal: any) => goal.status === 'active') : goals;
        if (filtered.length === 0) return { ok: true, resultsText: 'No goals found.' } as any;
        const lines = filtered.slice(0, 20).map((goal: any) => `- ${goal.title} [${goal.goal_type}] ${goal.status} — ${Math.round(getGoalProgress(goal))}%`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'goals.create': {
      try {
        const { supabase: authSupabase } = await import('./supabase');
        const { data: profile } = await authSupabase.from('profiles').select('org_id').eq('id', context.userId).single();
        const orgId = profile?.org_id;
        if (!orgId) return { ok: false, resultsText: 'No org_id found for current user, cannot create circle goal.' } as any;
        const { createGoal } = await import('./goals');
        const a = args as any;
        const result = await createGoal({
          orgId,
          goalType: (a.goalType || 'circle_goal') as any,
          title: a.title,
          description: a.description,
          circleId: context.circleId,
          ownerId: a.ownerId || context.userId,
          targetValue: typeof a.targetValue === 'number' ? a.targetValue : undefined,
          unit: a.unit,
          dueDate: a.dueDate,
        });
        if (result.error || !result.data) return { ok: false, resultsText: result.error || 'Failed to create goal.' } as any;
        return { ok: true, resultsText: `Created goal "${result.data.title}" (${result.data.goal_type}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'goals.update_progress': {
      try {
        const { updateGoalProgress } = await import('./goals');
        const result = await updateGoalProgress((args as any).goalId, Number((args as any).currentValue));
        if (result.error) return { ok: false, resultsText: result.error } as any;
        return { ok: true, resultsText: `Goal ${String((args as any).goalId).slice(0, 8)} progress updated to ${Number((args as any).currentValue)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'goals.update_status': {
      try {
        const { updateGoalStatus } = await import('./goals');
        const result = await updateGoalStatus((args as any).goalId, (args as any).status);
        if (result.error) return { ok: false, resultsText: result.error } as any;
        return { ok: true, resultsText: `Goal ${(args as any).goalId.slice(0, 8)} moved to ${(args as any).status}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Messages + Check-ins ───────────────────────────────────────────
    case 'messages.list': {
      try {
        const limit = Math.min(Number((args as any).limit) || 12, 30);
        const { data, error } = await supabase
          .from('messages')
          .select('id, content, created_at, user:profiles(display_name, username)')
          .eq('circle_id', context.circleId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No recent messages found.' } as any;
        const lines = (data as any[]).map((row, index) => `${index + 1}. ${(row.user?.display_name || row.user?.username || 'Unknown')}: ${String(row.content || '').replace(/\s+/g, ' ').slice(0, 180)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'messages.create': {
      try {
        const { persistChatMessage } = await import('./chatService');
        const a = args as any;
        const id = await persistChatMessage({
          circleId: context.circleId,
          userId: context.userId,
          content: String(a.content || '').trim(),
          threadId: a.threadId || context.threadId || null,
          replyToId: a.replyToId || null,
          isBot: false,
        });
        if (!id) return { ok: false, resultsText: 'Failed to post message.' } as any;
        return { ok: true, resultsText: `Posted message (id: ${id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'check_ins.list': {
      try {
        const limit = Math.min(Number((args as any).limit) || 10, 25);
        const since = (args as any).since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from('check_ins')
          .select('id, content, created_at, user:profiles(display_name, username)')
          .eq('circle_id', context.circleId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No recent check-ins found.' } as any;
        const lines = (data as any[]).map((row, index) => `${index + 1}. ${(row.user?.display_name || row.user?.username || 'Unknown')}: ${String(row.content || '').replace(/\s+/g, ' ').slice(0, 200)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Research ───────────────────────────────────────────────────────
    case 'research.search': {
      try {
        const { buildResearchSearchResponse } = await import('./researchKnowledge');
        const text = await buildResearchSearchResponse({
          query: String((args as any).query || ''),
          circleId: context.circleId,
          limit: Math.min(Number((args as any).limit) || 5, 10),
        });
        return { ok: true, resultsText: text } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'research.save': {
      try {
        const { saveResearchDocument } = await import('./researchKnowledge');
        const a = args as any;
        const doc = await saveResearchDocument({
          circleId: context.circleId,
          title: a.title,
          summary: a.summary,
          content: a.content,
          domainKey: a.domainKey,
          tags: Array.isArray(a.tags) ? a.tags : [],
          sourceUrl: a.sourceUrl,
        });
        if (!doc) return { ok: false, resultsText: 'Failed to save research document.' } as any;
        return { ok: true, resultsText: `Saved research document "${doc.title}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Rooms ──────────────────────────────────────────────────────────
    case 'rooms.list': {
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('id, name, status, color, created_at')
          .eq('circle_id', context.circleId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No rooms found.' } as any;
        const lines = (data as any[]).map((room) => `- ${room.name} [${room.status || 'unknown'}] — id: ${String(room.id).slice(0, 8)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.create': {
      try {
        const { createRoom } = await import('../screens/circles/tabs/rooms/roomRepository');
        const a = args as any;
        const roomId = await createRoom(context.circleId, String(a.name || '').trim(), a.description || undefined);
        if (!roomId) return { ok: false, resultsText: 'Failed to create room.' } as any;
        return { ok: true, resultsText: `Created room "${String(a.name || '').trim()}" (id: ${roomId.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.send_message': {
      try {
        const { sendMessage } = await import('../screens/circles/tabs/rooms/roomRepository');
        const a = args as any;
        const messageId = await sendMessage(a.roomId, context.userId, String(a.content || '').trim(), a.messageType || 'chat');
        if (!messageId) return { ok: false, resultsText: 'Failed to send room message.' } as any;
        return { ok: true, resultsText: `Posted room message (id: ${messageId.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.list_tasks': {
      try {
        const { loadTasks } = await import('../screens/circles/tabs/rooms/roomRepository');
        const tasks = await loadTasks((args as any).roomId);
        if (tasks.length === 0) return { ok: true, resultsText: 'No room tasks found.' } as any;
        const lines = tasks.map((task) => `- ${task.title} [${task.status}]${task.assignedTo ? ` — ${task.assignedTo}` : ''} — id: ${task.id.slice(0, 8)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.create_task': {
      try {
        const a = args as any;
        const { data: auth } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from('room_tasks')
          .insert({
            room_id: a.roomId,
            name: String(a.name || '').trim(),
            schedule: a.schedule?.trim?.() || 'once',
            agent: a.agent?.trim?.() || 'Assistant',
            prompt: String(a.prompt || '').trim(),
            enabled: true,
            task_type: a.taskType || 'general',
            created_by: auth.user?.id || context.userId,
          })
          .select('id, name')
          .single();
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Created room task "${data.name}" (id: ${data.id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.create_file': {
      try {
        const { createFile } = await import('../screens/circles/tabs/rooms/roomRepository');
        const a = args as any;
        const inferredType = typeof a.fileType === 'string' && a.fileType.trim()
          ? a.fileType.trim()
          : (String(a.name || '').split('.').pop() || 'plaintext');
        const fileId = await createFile(a.roomId, a.name, a.content, inferredType);
        if (!fileId) return { ok: false, resultsText: 'Failed to create room file.' } as any;
        return { ok: true, resultsText: `Created file "${a.name}" (id: ${fileId.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.update_file': {
      try {
        const { updateFileContent } = await import('../screens/circles/tabs/rooms/roomRepository');
        const ok = await updateFileContent((args as any).fileId, String((args as any).content || ''));
        if (!ok) return { ok: false, resultsText: 'Failed to update room file.' } as any;
        return { ok: true, resultsText: `Updated file ${String((args as any).fileId).slice(0, 8)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Room Files ──────────────────────────────────────────────────────
    case 'rooms.list_files': {
      try {
        const { data } = await supabase.from('room_files').select('id, name, folder, file_type, size_bytes')
          .eq('room_id', (args as any).roomId).eq('is_deleted', false).order('folder').order('name');
        if (!data || data.length === 0) return { ok: true, resultsText: 'No files in this room.' } as any;
        const lines = data.map((f: any) => `- ${f.folder}/${f.name} (${f.file_type}, ${f.size_bytes}B)`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.read_file': {
      try {
        const { data } = await supabase.from('room_files').select('name, content, file_type, size_bytes')
          .eq('id', (args as any).fileId).single();
        if (!data) return { ok: false, resultsText: 'File not found.' } as any;
        return { ok: true, resultsText: `## ${data.name}\n\`\`\`\n${(data.content || '').slice(0, 8000)}\n\`\`\`` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Integrations + Office ──────────────────────────────────────────
    case 'integrations.list': {
      try {
        const { listCircleIntegrations } = await import('./circleIntegrations');
        const integrations = await listCircleIntegrations(context.circleId);
        if (integrations.length === 0) return { ok: true, resultsText: 'No integrations connected.' } as any;
        const lines = integrations.map((integration) => `- ${integration.label} [${integration.provider}] ${integration.status}${integration.capability_flags?.length ? ` — ${integration.capability_flags.join(', ')}` : ''}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'office.list_agents': {
      try {
        const { data, error } = await supabase
          .from('circle_office_agents')
          .select('id, name, provider, status, spirit, owner_display_name')
          .eq('circle_id', context.circleId)
          .eq('is_published', true)
          .order('created_at', { ascending: true });
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No published office agents found.' } as any;
        const lines = (data as any[]).map((agent) => `- ${agent.name} [${agent.provider}] ${agent.status}${agent.spirit ? ` — spirit: ${agent.spirit}` : ''}${agent.owner_display_name ? ` — owner: ${agent.owner_display_name}` : ''}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'approvals.list': {
      try {
        const { getPendingApprovals } = await import('./agentRunSystem');
        const approvals = await getPendingApprovals(context.circleId);
        if (approvals.length === 0) return { ok: true, resultsText: 'No pending approvals.' } as any;
        const lines = approvals.slice(0, 20).map((approval) => `- ${approval.title} [${approval.approval_kind}] — id: ${approval.id.slice(0, 8)} — status: ${approval.status}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'approvals.request': {
      try {
        const { requestRunApproval } = await import('./agentRunSystem');
        const a = args as any;
        const approval = await requestRunApproval({
          runId: a.runId,
          circleId: context.circleId,
          approvalKind: a.approvalKind,
          title: a.title,
          description: a.description,
          requestedBy: context.userId,
          payload: a.payload || {},
          timeoutSeconds: typeof a.timeoutSeconds === 'number' ? a.timeoutSeconds : undefined,
        });
        if (!approval) return { ok: false, resultsText: 'Failed to request approval.' } as any;
        return { ok: true, resultsText: `Requested approval "${approval.title}" (id: ${approval.id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'approvals.resolve': {
      try {
        const { resolveRunApproval } = await import('./agentRunSystem');
        const ok = await resolveRunApproval((args as any).approvalId, (args as any).status, context.userId);
        if (!ok) return { ok: false, resultsText: 'Failed to resolve approval.' } as any;
        return { ok: true, resultsText: `Approval ${String((args as any).approvalId).slice(0, 8)} marked ${(args as any).status}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Memory Save ─────────────────────────────────────────────────────
    case 'save_memory': {
      try {
        const { saveMemory } = await import('./agentRunSystem');
        const a = args as any;
        const kind = ['preference', 'fact', 'decision', 'finding', 'instruction'].includes(a.kind) ? a.kind : 'fact';
        const mem = await saveMemory({
          scope: 'circle',
          circleId: context.circleId,
          memoryKind: kind,
          title: a.title,
          content: a.content,
          sourceSurface: context.surface || 'main_chat',
          importance: kind === 'instruction' ? 0.9 : kind === 'decision' ? 0.8 : 0.6,
          visibility: 'circle_shared',
        });
        if (!mem) return { ok: false, resultsText: 'Failed to save memory.' } as any;
        return { ok: true, resultsText: `Saved memory: "${a.title}" [${kind}]` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── WordPress Admin ──────────────────────────────────────────────────
    case 'wp.discover_types': {
      try {
        const { discoverPostTypes } = await import('./wpAdmin');
        const a = args as any;
        const types = await discoverPostTypes({ siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem, onePasswordVault: a.vault });
        const lines = Object.entries(types).map(([slug, t]: [string, any]) => `- ${t.name} (${slug}) → REST: /wp/v2/${t.rest_base}`);
        return { ok: true, resultsText: lines.join('\n') || 'No post types found.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'wp.upload_media': {
      try {
        const { uploadMediaFromStorage } = await import('./wpAdmin');
        const a = args as any;
        const media = await uploadMediaFromStorage(
          { siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem },
          a.storagePath, a.fileName, a.mimeType || 'image/jpeg',
        );
        return { ok: true, resultsText: `Uploaded: ${media.title?.rendered || a.fileName} (ID: ${media.id})\nURL: ${media.source_url}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'wp.create_slide': {
      try {
        const { uploadImageAndCreateSlide } = await import('./wpAdmin');
        const a = args as any;
        const { media, slide } = await uploadImageAndCreateSlide(
          { siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem },
          { storagePath: a.storagePath, fileName: a.fileName, mimeType: a.mimeType || 'image/jpeg' },
          { title: a.title, status: a.status || 'publish', slideType: a.slideType },
        );
        return { ok: true, resultsText: `Slide created: "${slide.title?.rendered}" (ID: ${slide.id})\nImage: ${media.source_url}\nSlide: ${slide.link}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'wp.list_posts': {
      try {
        const { listPosts } = await import('./wpAdmin');
        const a = args as any;
        const posts = await listPosts(
          { siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem },
          { postType: a.postType, perPage: a.perPage },
        );
        if (posts.length === 0) return { ok: true, resultsText: 'No items found.' } as any;
        const lines = posts.map((p: any) => `- [${p.status}] ${p.title?.rendered || 'Untitled'} (ID: ${p.id})`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'credentials.get': {
      try {
        const { getCredentials: getCreds } = await import('./credentialService');
        const a = args as any;
        const { ok, fields, error } = await getCreds({ item: a.item, vault: a.vault, fields: a.fields });
        if (!ok) return { ok: false, resultsText: error || 'Failed to fetch credentials' } as any;
        const keys = Object.keys(fields);
        return { ok: true, resultsText: `Retrieved ${keys.length} field(s) for "${a.item}": ${keys.join(', ')}. Credentials are available for use.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    default:
      return executeOpenSwanTool(
        tool as OpenSwanToolName,
        args as OpenSwanToolExecutionArgs[OpenSwanToolName],
      ) as Promise<OpenSwanToolExecutionResultMap[T]>;
  }
}
