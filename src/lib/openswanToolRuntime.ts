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
  // ── Circle / Agent / Office editing (chat-driven UI mutations) ────
  // Anything a user can edit in Circle Settings / Office Customize
  // should be invokable by name from chat. Policy = 'auto' because
  // these mutations are reversible from the same UI.
  | 'circle.update_settings'
  | 'circle.update_budget_caps'
  | 'circle.update_office_theme'
  | 'agent.update_appearance'
  | 'agent.rename'
  | 'rooms.rename'
  | 'rooms.archive'
  | 'rooms.unarchive'
  | 'missions.create'
  | 'missions.assign_agent'
  | 'missions.unassign_agent'
  | 'missions.update_status'
  | 'memory.pin'
  | 'memory.unpin'
  | 'memory.forget'
  | 'circle.toggle_public'
  | 'check_ins.log'
  | 'automations.list'
  | 'automations.toggle_enabled'
  | 'missions.remove_task'
  | 'missions.update_task'
  | 'agent.set_spirit'
  | 'approvals.list'
  | 'approvals.request'
  | 'approvals.resolve'
  // ── Desktop automation (Phase 1b — local Claude Code bridge) ──────
  | 'desktop.launch_app'
  | 'desktop.focus_app'
  | 'desktop.type_text'
  | 'desktop.press_keys'
  | 'desktop.list_running_apps'
  | 'desktop.wait_for_app'
  | 'desktop.screenshot'
  | 'desktop.open_url'
  | 'desktop.open_path'
  | 'desktop.click_at'
  | 'desktop.screen_size';

export type OpenSwanToolDefinition = {
  name: OpenSwanRuntimeToolName;
  label: string;
  surfaces: OpenSwanToolSurface[];
  description: string;
  inputSchema?: Record<string, unknown>;
  /**
   * Optional chat-mode allowlist. When present, the tool is only exposed
   * to the model on turns running in one of these modes. When omitted,
   * the tool is mode-agnostic (available in every mode) — which matches
   * legacy behavior, so adding `modes` to a tool is purely additive.
   *
   * Mode keys come from `OPENSWAN_MODE_POLICIES` in
   * `openswanModePolicy.ts`. Use this to enforce mode semantics —
   * e.g. `review` mode should not hand the model write tools.
   */
  modes?: string[];
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
  'desktop.launch_app':      { appName: string };
  'desktop.focus_app':       { appName: string };
  'desktop.type_text':       { text: string };
  'desktop.press_keys':      { combo: string };
  'desktop.list_running_apps': Record<string, never>;
  'desktop.wait_for_app':      { appName: string; timeoutMs?: number };
  'desktop.screenshot':        Record<string, never>;
  'desktop.open_url':          { url: string };
  'desktop.open_path':         { path: string };
  'desktop.click_at':          { x: number; y: number };
  'desktop.screen_size':       Record<string, never>;
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
  'circle.update_settings':    { ok: boolean; resultsText: string };
  'circle.update_budget_caps': { ok: boolean; resultsText: string };
  'circle.update_office_theme':{ ok: boolean; resultsText: string };
  'agent.update_appearance':   { ok: boolean; resultsText: string };
  'agent.rename':              { ok: boolean; resultsText: string };
  'rooms.rename':              { ok: boolean; resultsText: string };
  'rooms.archive':             { ok: boolean; resultsText: string };
  'rooms.unarchive':           { ok: boolean; resultsText: string };
  'missions.create':           { ok: boolean; resultsText: string };
  'missions.assign_agent':     { ok: boolean; resultsText: string };
  'missions.unassign_agent':   { ok: boolean; resultsText: string };
  'missions.update_status':    { ok: boolean; resultsText: string };
  'circle.toggle_public':      { ok: boolean; resultsText: string };
  'memory.pin':                { ok: boolean; resultsText: string };
  'memory.unpin':              { ok: boolean; resultsText: string };
  'memory.forget':             { ok: boolean; resultsText: string };
  'check_ins.log':             { ok: boolean; resultsText: string };
  'automations.list':          { ok: boolean; resultsText: string };
  'automations.toggle_enabled':{ ok: boolean; resultsText: string };
  'missions.remove_task':      { ok: boolean; resultsText: string };
  'missions.update_task':      { ok: boolean; resultsText: string };
  'agent.set_spirit':          { ok: boolean; resultsText: string };
  'approvals.list': { ok: boolean; resultsText: string };
  'approvals.request': { ok: boolean; resultsText: string };
  'approvals.resolve': { ok: boolean; resultsText: string };
  'desktop.launch_app':        { ok: boolean; resultsText: string };
  'desktop.focus_app':         { ok: boolean; resultsText: string };
  'desktop.type_text':         { ok: boolean; resultsText: string };
  'desktop.press_keys':        { ok: boolean; resultsText: string };
  'desktop.list_running_apps': { ok: boolean; resultsText: string };
  'desktop.wait_for_app':      { ok: boolean; resultsText: string };
  'desktop.screenshot':        { ok: boolean; resultsText: string; base64?: string; mimeType?: string; sizeBytes?: number };
  'desktop.open_url':          { ok: boolean; resultsText: string };
  'desktop.open_path':         { ok: boolean; resultsText: string };
  'desktop.click_at':          { ok: boolean; resultsText: string };
  'desktop.screen_size':       { ok: boolean; resultsText: string; width?: number; height?: number };
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
  // ── Circle / Agent / Office editing tools ────────────────────────
  {
    name: 'circle.update_settings',
    label: 'Update Circle Settings',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update a circle\'s top-level settings: name, description, icon, accent color, vibe, or tags. Only fields that are passed get updated. Matches what the user can edit in Circle Settings → Name & Description.',
    inputSchema: {
      type: 'object',
      properties: {
        name:         { type: 'string',  description: 'New circle name (trimmed).' },
        description:  { type: 'string',  description: 'New circle description.' },
        icon:         { type: 'string',  description: 'Emoji or glyph to use as circle icon.' },
        accent_color: { type: 'string',  description: 'Hex color like #6366f1 — the per-circle accent used for UI tints.' },
        vibe:         { type: 'string',  description: 'Short vibe string (the "GRINDING MODE 🔥" line).' },
        tags:         { type: 'array',   description: 'Replacement tag list.', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'circle.update_budget_caps',
    label: 'Update Budget Caps',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update the circle\'s three budget caps: per-run Computer Use, 24h Automation, and 24h Claude total umbrella. Pass only the fields to change — the others are preserved. Pass a number in USD.',
    inputSchema: {
      type: 'object',
      properties: {
        computer_use_max_cost_usd: { type: 'number', description: 'Per-run Computer Use cap in USD. Default $2.' },
        automation_max_cost_usd:   { type: 'number', description: 'Rolling 24h automation cap in USD. Default $1.' },
        claude_total_max_cost_usd: { type: 'number', description: 'Umbrella 24h Claude total cap across every agent. Default $10.' },
      },
    },
  },
  {
    name: 'circle.update_office_theme',
    label: 'Update Office Theme',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Switch the circle\'s Office theme. `theme_id` is one of the built-in keys (office | ship | castle | station | submarine | mansion | lair | cabin | arctic | cyber | garden | temple) or a custom theme id prefixed with custom_.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_id:         { type: 'string', description: 'Theme id — built-in key or custom_<uuid>.' },
        environment_type: { type: 'string', description: 'Optional environment_type override if the theme doesn\'t already set it.' },
      },
      required: ['theme_id'],
    },
  },
  {
    name: 'agent.update_appearance',
    label: 'Update Agent Appearance',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update a single agent\'s pixel-art customization. Pass the agent name (e.g. "BlackSwan") and a `patch` with any of the 14 appearance properties: skinTone, hairStyle, hairColor, shirtColor, pantsColor, shoeColor, accessory, hat, expression, backItem, eyeColor, facialHair, pet, aura. Only patched props change; everything else stays.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: { type: 'string', description: 'The agent to update (must match agent.name exactly, e.g. "BlackSwan").' },
        patch:      { type: 'object', description: 'Partial AgentAppearance — any subset of the 14 customization props.' },
      },
      required: ['agent_name', 'patch'],
    },
  },
  {
    name: 'agent.rename',
    label: 'Rename Agent',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Rename a published office agent. Pass the current agent id and the new name (1–32 chars, no slashes).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent\'s id from `circle_office_agents`.' },
        new_name: { type: 'string', description: 'New display name for the agent.' },
      },
      required: ['agent_id', 'new_name'],
    },
  },
  {
    name: 'rooms.rename',
    label: 'Rename Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Rename an existing room in this circle. Reversible — call again with any other name to undo.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'The room\'s id.' },
        name:    { type: 'string', description: 'New room name.' },
      },
      required: ['room_id', 'name'],
    },
  },
  {
    name: 'rooms.archive',
    label: 'Archive Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Archive a room. Hidden from the active rooms list but not deleted — call rooms.unarchive to restore.',
    inputSchema: {
      type: 'object',
      properties: { room_id: { type: 'string' } },
      required: ['room_id'],
    },
  },
  {
    name: 'rooms.unarchive',
    label: 'Unarchive Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Restore a previously-archived room to the active list.',
    inputSchema: {
      type: 'object',
      properties: { room_id: { type: 'string' } },
      required: ['room_id'],
    },
  },
  {
    name: 'missions.create',
    label: 'Create Mission',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a new circle mission. Missions are the core accountability loop — title + optional description + optional ISO deadline. The creator becomes the owner; they can reassign later in the UI.',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Mission title — short and verb-first (e.g. "Ship wallet v2 by Friday").' },
        description: { type: 'string', description: 'Optional longer description of what success looks like.' },
        deadline:    { type: 'string', description: 'Optional ISO-8601 deadline.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'missions.assign_agent',
    label: 'Assign Agent to Mission',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Add an agent to a mission\'s assigned roster. Role defaults to "executor"; pass "reviewer" / "designer" / "strategist" for other roles.',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id: { type: 'string' },
        agent_name: { type: 'string', description: 'Agent name (e.g. "BlackSwan", "Jon Snow").' },
        role:       { type: 'string', description: 'Role — executor | reviewer | designer | strategist | analyst | writer. Default executor.' },
      },
      required: ['mission_id', 'agent_name'],
    },
  },
  {
    name: 'missions.unassign_agent',
    label: 'Remove Agent from Mission',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Remove an agent from a mission\'s assigned roster. Reversible via missions.assign_agent.',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id: { type: 'string' },
        agent_name: { type: 'string' },
      },
      required: ['mission_id', 'agent_name'],
    },
  },
  {
    name: 'missions.update_status',
    label: 'Update Mission Status',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Change a mission\'s status. Valid values: active | completed | paused | cancelled. Also accepts title / description / deadline patches in the same call.',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id:  { type: 'string' },
        status:      { type: 'string', description: 'active | completed | paused | cancelled' },
        title:       { type: 'string' },
        description: { type: 'string' },
        deadline:    { type: 'string', description: 'ISO-8601 deadline, or empty string to clear.' },
      },
      required: ['mission_id'],
    },
  },
  {
    name: 'circle.toggle_public',
    label: 'Toggle Circle Public/Private',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Toggle the circle\'s `is_public` flag — when true, the circle appears in /discover so anyone can join. Pass explicit true/false.',
    inputSchema: {
      type: 'object',
      properties: { is_public: { type: 'boolean', description: 'true = appear in /discover, false = hidden' } },
      required: ['is_public'],
    },
  },
  {
    name: 'memory.forget',
    label: 'Forget Memory',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Soft-delete a memory entry so agents stop retrieving it. Reversible — the row is flagged inactive, not dropped. Pass the memory entry id from search_memories / the memory inbox.',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string' } },
      required: ['memory_id'],
    },
  },
  {
    name: 'check_ins.log',
    label: 'Log Check-In',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Post a daily check-in on behalf of the user. Content is free-form text. Optional metric is a JSON object for numeric check-ins (e.g. {reps: 50, distance_km: 3.2}).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Check-in content (what the user did today).' },
        metric:  { type: 'object', description: 'Optional structured metric { key: value }.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'automations.list',
    label: 'List Circle Automations',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List all automations configured for this circle with their enabled flag, trigger type, last run time, and last error (if any).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'automations.toggle_enabled',
    label: 'Toggle Automation Enabled',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Pause or resume a single automation. Pass the automation id and a boolean `enabled`. Reversible.',
    inputSchema: {
      type: 'object',
      properties: {
        automation_id: { type: 'string' },
        enabled:       { type: 'boolean' },
      },
      required: ['automation_id', 'enabled'],
    },
  },
  {
    name: 'missions.remove_task',
    label: 'Remove Mission Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Remove a task from a mission. Hard delete — for soft-archival use missions.update_task to patch status to cancelled.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'missions.update_task',
    label: 'Update Mission Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Edit a mission task — title / description / priority / due_date / assignee / status. Pass only the fields you want to change.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:     { type: 'string' },
        title:       { type: 'string' },
        description: { type: 'string' },
        priority:    { type: 'string', description: 'low | normal | high' },
        due_date:    { type: 'string', description: 'ISO date, or empty string to clear.' },
        assigned_to: { type: 'string', description: 'User id or agent name to assign. Empty string clears.' },
        status:      { type: 'string', description: 'pending | running | done | blocked | cancelled' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'agent.set_spirit',
    label: 'Set Agent Spirit',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Set the "spirit" (personality mode / persona animation) for a published office agent. Pass the agent id and spirit key (or empty string to clear).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        spirit:   { type: 'string', description: 'Spirit key — or "" to clear.' },
      },
      required: ['agent_id', 'spirit'],
    },
  },
  {
    name: 'memory.pin',
    label: 'Pin Memory',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Pin a memory entry so it stays in context across sessions. Pass the memory entry id (from `search_memories` results or the memory inbox).',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string' } },
      required: ['memory_id'],
    },
  },
  {
    name: 'memory.unpin',
    label: 'Unpin Memory',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Unpin a previously pinned memory. It stays in the library but won\'t auto-load on every session.',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string' } },
      required: ['memory_id'],
    },
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
  // ─── Desktop automation (Phase 1b — Claude Code bridge) ─────────────────
  {
    name: 'desktop.launch_app',
    label: 'Launch Desktop App',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Opens a native desktop application by name on the user's Mac via the " +
      "local Claude Code bridge. Requires the bridge running and the desktop " +
      "token paired. Example appNames: \"Zoom\", \"Slack\", \"Notion\", " +
      "\"Visual Studio Code\". Use desktop.list_running_apps first to see " +
      "what's already open. HITL-gated via the `desktop_action` category.",
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Exact .app name as in /Applications. Letters/numbers/space/.-_() only.' },
      },
      required: ['appName'],
    },
  },
  {
    name: 'desktop.focus_app',
    label: 'Focus Desktop App',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: "Brings an already-running app to the foreground. Prefer desktop.launch_app if the app isn't running (launch also focuses).",
    inputSchema: {
      type: 'object',
      properties: { appName: { type: 'string' } },
      required: ['appName'],
    },
  },
  {
    name: 'desktop.type_text',
    label: 'Type Text on Desktop',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Types text into whatever app has focus. Use desktop.focus_app first. " +
      "Max 4000 chars per call. For explicit Return/Enter, call " +
      "desktop.press_keys with combo=\"Return\".",
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type. ≤4000 chars per call.' } },
      required: ['text'],
    },
  },
  {
    name: 'desktop.press_keys',
    label: 'Press Desktop Keys',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Presses a key combo. Modifiers: Cmd/Shift/Opt/Alt/Ctrl/Fn. Terminal " +
      "keys: a-z, 0-9, or named keys Return/Tab/Space/Escape/Delete/Left/" +
      "Right/Up/Down/F1-F12. Chain calls for multi-step actions.",
    inputSchema: {
      type: 'object',
      properties: { combo: { type: 'string', description: 'Examples: "Cmd+T", "Cmd+Shift+N", "Return", "Escape".' } },
      required: ['combo'],
    },
  },
  {
    name: 'desktop.list_running_apps',
    label: 'List Running Desktop Apps',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: "Lists foreground apps currently running on the user's Mac. Read-only — returns names, no window contents.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.wait_for_app',
    label: 'Wait for Desktop App',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Polls the running-app list every 250ms until `appName` appears, or timeout expires (default 5s, max 30s). " +
      "Use this AFTER desktop.launch_app and BEFORE desktop.type_text / desktop.press_keys — ensures keystrokes " +
      "land in the newly-launched app instead of whichever app was frontmost when launch fired.",
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string' },
        timeoutMs: { type: 'number', description: 'Max milliseconds to wait. 500..30000; default 5000.' },
      },
      required: ['appName'],
    },
  },
  {
    name: 'desktop.screenshot',
    label: 'Screenshot Desktop',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Captures a full-screen PNG via macOS `screencapture`. Returns base64 + size. Use this to verify that a " +
      "previous action took effect (e.g. app is open, dialog is showing, form field is focused). Requires Screen " +
      "Recording permission granted to the Terminal running the bridge.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.open_url',
    label: 'Open URL',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Opens a URL in the user's default browser via `open`. Accepts http / https / file / mailto schemes only. " +
      "Safer and more direct than desktop.launch_app('Safari') when the user wants a specific page — no " +
      "additional navigation needed.",
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL. http / https / file / mailto only.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'desktop.open_path',
    label: 'Open File or Folder',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Runs `open <path>` — launches a file with its default app or reveals a folder in Finder. Rejects paths " +
      "containing shell metacharacters. Use for \"open ~/Downloads\", \"open the README.md in my repo\", etc.",
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute or ~-relative path. No shell metacharacters.' } },
      required: ['path'],
    },
  },
  {
    name: 'desktop.click_at',
    label: 'Mouse Click at Coords',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Clicks at absolute screen coordinates (x, y). Uses `cliclick` when installed (reliable), falls back to " +
      "AppleScript System Events click-at-coords (best-effort — often fails silently on macOS 13+). Call " +
      "desktop.screen_size first so coords stay in bounds; read the /desktop/health `optional.cliclick` flag to " +
      "know whether to attempt. Prefer desktop.press_keys for keyboard-reachable actions.",
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop.screen_size',
    label: 'Primary Screen Size',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Returns { width, height } of the primary display in pixels. Call this before desktop.click_at to bound " +
      "coordinates or before desktop.screenshot to know the dimensions of the image you'll receive.",
    inputSchema: { type: 'object', properties: {} },
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

  if (tool.startsWith('desktop.')) {
    // Read-only tools (list apps, screen size, screenshot, wait_for_app)
    // auto-approve — they observe state, they don't change it. Every
    // write path (launch/focus/type/keys/click/open_url/open_path)
    // routes through HITL via the `desktop_action` auto-approve
    // category which the user can opt into 'auto' via the banner.
    const readOnlyTools = new Set([
      'desktop.list_running_apps',
      'desktop.screen_size',
      'desktop.screenshot',
      'desktop.wait_for_app',
    ]);
    const readOnly = readOnlyTools.has(tool);
    return {
      family: 'browser',  // re-use the browser family so existing banners render
      approvalMode: readOnly ? 'auto' : 'ask',
      mutatesState: !readOnly,
      externalSideEffect: !readOnly,
      approvalKind: readOnly ? undefined : 'browser_action',
      summary: readOnly
        ? 'Observes local desktop state via the Claude Code bridge (list apps, screen size, screenshot, wait).'
        : 'Drives the user\'s local desktop (launch / focus / type / keys / click / open) via the Claude Code bridge. HITL-gated.',
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
  // App-edit tools (Phase 1-4) — let BlackSwan modify anything the user can edit
  'circle.update_settings',
  'circle.update_budget_caps',
  'circle.update_office_theme',
  'circle.toggle_public',
  'agent.update_appearance',
  'agent.rename',
  'agent.set_spirit',
  'rooms.rename',
  'rooms.archive',
  'rooms.unarchive',
  'missions.create',
  'missions.assign_agent',
  'missions.unassign_agent',
  'missions.update_status',
  'missions.remove_task',
  'missions.update_task',
  'memory.pin',
  'memory.unpin',
  'memory.forget',
  'check_ins.log',
  'automations.list',
  'automations.toggle_enabled',
]);

export function listOpenSwanToolsForSurface(surface: OpenSwanToolSurface): OpenSwanToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) => tool.surfaces.includes(surface));
}

export function listOpenSwanAnthropicToolsForSurface(
  surface: OpenSwanToolSurface,
  allowedToolNames?: OpenSwanRuntimeToolName[],
  mode?: string | null,
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const allow = allowedToolNames?.length ? new Set(allowedToolNames) : null;
  const modeKey = typeof mode === 'string' && mode ? mode : null;
  return TOOL_DEFINITIONS
    .filter((tool) => tool.surfaces.includes(surface))
    .filter((tool) => TOOL_LOOP_SAFE_NAMES.has(tool.name))
    .filter((tool) => !allow || allow.has(tool.name))
    // Mode filter: tools without `modes` are mode-agnostic (pass). Tools
    // with `modes` only appear if the current mode is in their list.
    // When no mode is passed, skip this filter entirely (legacy callers).
    .filter((tool) => !modeKey || !tool.modes || tool.modes.includes(modeKey))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || { type: 'object', properties: {} },
    }));
}

/**
 * Diagnostic / inspector helper — returns the same filtered list the model
 * would see, but as full definitions (not Anthropic-schema form) so UI
 * surfaces can render counts, labels, approval modes, and mode tags
 * alongside the model-facing descriptions. Used by the OpenSwan Console.
 */
export function previewOpenSwanToolsForSurface(
  surface: OpenSwanToolSurface,
  mode?: string | null,
  allowedToolNames?: OpenSwanRuntimeToolName[],
): OpenSwanToolDefinition[] {
  const allow = allowedToolNames?.length ? new Set(allowedToolNames) : null;
  const modeKey = typeof mode === 'string' && mode ? mode : null;
  return TOOL_DEFINITIONS
    .filter((tool) => tool.surfaces.includes(surface))
    .filter((tool) => TOOL_LOOP_SAFE_NAMES.has(tool.name))
    .filter((tool) => !allow || allow.has(tool.name))
    .filter((tool) => !modeKey || !tool.modes || tool.modes.includes(modeKey));
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

// Surface actionable hints for desktop-bridge failure modes so the agent
// doesn't just report "permission denied" and give up. Matches the
// errorCode set in `src/lib/desktopBridgeProtocol.ts`.
function describeDesktopFailure(error?: string, code?: string): string {
  const base = error || 'Desktop action failed.';
  switch (code) {
    case 'bridge_offline':
      return `${base} The Claude Code bridge is not reachable at localhost:7778 — start it with \`node scripts/claude-bridge.js\`.`;
    case 'not_paired':
      return `${base} The desktop bridge is running but not paired with this browser. Tell the user to tap "Pair Desktop Bridge" in the Chat Actions menu.`;
    case 'permission_denied':
      return `${base} macOS Accessibility permission is required for keystrokes and key combos. Open System Settings → Privacy & Security → Accessibility and enable it for whichever shell/terminal is running the bridge (usually Terminal.app or iTerm). After granting, the user should re-run the same command.`;
    case 'platform_unsupported':
      return `${base} Desktop automation is macOS-only in Phase 1. Windows/Linux support is on the roadmap.`;
    case 'app_not_found':
      return `${base} That app isn't installed under /Applications or the name doesn't match the .app bundle. Call desktop.list_running_apps to see exact names.`;
    case 'invalid_input':
      return `${base} Check the tool's argument schema.`;
    default:
      return base;
  }
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
    case 'circle.update_settings':
    case 'circle.update_budget_caps':
    case 'circle.update_office_theme':
    case 'agent.update_appearance':
    case 'agent.rename':
    case 'rooms.rename':
    case 'rooms.archive':
    case 'rooms.unarchive':
    case 'missions.create':
    case 'missions.assign_agent':
    case 'missions.unassign_agent':
    case 'missions.update_status':
    case 'circle.toggle_public':
    case 'memory.pin':
    case 'memory.unpin':
    case 'memory.forget':
    case 'check_ins.log':
    case 'automations.list':
    case 'automations.toggle_enabled':
    case 'missions.remove_task':
    case 'missions.update_task':
    case 'agent.set_spirit':
    case 'approvals.list':
    case 'approvals.request':
    case 'approvals.resolve':
    case 'desktop.launch_app':
    case 'desktop.focus_app':
    case 'desktop.type_text':
    case 'desktop.press_keys':
    case 'desktop.list_running_apps':
    case 'desktop.wait_for_app':
    case 'desktop.screenshot':
    case 'desktop.open_url':
    case 'desktop.open_path':
    case 'desktop.click_at':
    case 'desktop.screen_size':
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
    // ── Circle / Agent / Office editing — chat-driven UI mutations ──
    case 'circle.update_settings': {
      try {
        const a = args as any;
        // Whitelist the columns — agent can't write to anything else
        // on the circles row (like id or created_at) via this tool.
        const patch: Record<string, any> = {};
        if (typeof a.name === 'string')         patch.name         = a.name.trim();
        if (typeof a.description === 'string')  patch.description  = a.description;
        if (typeof a.icon === 'string')         patch.icon         = a.icon;
        if (typeof a.accent_color === 'string') patch.accent_color = a.accent_color;
        if (typeof a.vibe === 'string')         patch.vibe         = a.vibe;
        if (Array.isArray(a.tags))              patch.tags         = a.tags.filter((t: unknown) => typeof t === 'string');
        if (Object.keys(patch).length === 0) {
          return { ok: false, resultsText: 'Nothing to update — pass at least one field (name / description / icon / accent_color / vibe / tags).' } as any;
        }
        const { error } = await supabase.from('circles').update(patch).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Circle update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Updated circle: ${Object.keys(patch).join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'circle.update_budget_caps': {
      try {
        const a = args as any;
        // Merge into the circles.settings JSONB so we preserve other
        // settings (sessionMemoryMode, automation, etc.).
        const { data: existing } = await supabase
          .from('circles').select('settings').eq('id', context.circleId).maybeSingle();
        const current = (existing?.settings as any) || {};
        const patch: Record<string, any> = { ...current };
        const touched: string[] = [];
        if (typeof a.computer_use_max_cost_usd === 'number' && a.computer_use_max_cost_usd > 0) {
          patch.computer_use_max_cost_usd = a.computer_use_max_cost_usd; touched.push('computer_use');
        }
        if (typeof a.automation_max_cost_usd === 'number' && a.automation_max_cost_usd > 0) {
          patch.automation_max_cost_usd = a.automation_max_cost_usd; touched.push('automation');
        }
        if (typeof a.claude_total_max_cost_usd === 'number' && a.claude_total_max_cost_usd > 0) {
          patch.claude_total_max_cost_usd = a.claude_total_max_cost_usd; touched.push('claude_total');
        }
        if (touched.length === 0) {
          return { ok: false, resultsText: 'Pass at least one of computer_use_max_cost_usd / automation_max_cost_usd / claude_total_max_cost_usd as a positive number.' } as any;
        }
        const { error } = await supabase.from('circles').update({ settings: patch }).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Budget update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Updated budget caps: ${touched.join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'circle.update_office_theme': {
      try {
        const a = args as any;
        if (typeof a.theme_id !== 'string' || !a.theme_id.trim()) {
          return { ok: false, resultsText: 'theme_id is required.' } as any;
        }
        const { data: existing } = await supabase
          .from('circles').select('settings').eq('id', context.circleId).maybeSingle();
        const current = (existing?.settings as any) || {};
        const patch: Record<string, any> = { ...current, office_theme_id: a.theme_id.trim() };
        if (typeof a.environment_type === 'string' && a.environment_type.trim()) {
          patch.office_environment_type = a.environment_type.trim();
        }
        const { error } = await supabase.from('circles').update({ settings: patch }).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Theme update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Switched office theme to "${a.theme_id}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'agent.update_appearance': {
      try {
        const a = args as any;
        const agentName = typeof a.agent_name === 'string' ? a.agent_name.trim() : '';
        const patch = (a.patch && typeof a.patch === 'object') ? a.patch : null;
        if (!agentName || !patch || Object.keys(patch).length === 0) {
          return { ok: false, resultsText: 'agent_name and a non-empty patch are required.' } as any;
        }
        // Appearance lives on the invoking user's profile — each user's
        // agents customize independently. Fetch current, merge, write.
        const { data: profile, error: readErr } = await supabase
          .from('profiles').select('agent_appearance').eq('id', context.userId).maybeSingle();
        if (readErr) return { ok: false, resultsText: `Profile read failed: ${readErr.message}` } as any;
        const appearances = ((profile?.agent_appearance as any) || {}) as Record<string, any>;
        const existingForAgent = (appearances[agentName] && typeof appearances[agentName] === 'object') ? appearances[agentName] : {};
        const nextForAgent = { ...existingForAgent, ...patch };
        const nextAppearances = { ...appearances, [agentName]: nextForAgent };
        const { error: writeErr } = await supabase
          .from('profiles').update({ agent_appearance: nextAppearances }).eq('id', context.userId);
        if (writeErr) return { ok: false, resultsText: `Appearance update failed: ${writeErr.message}` } as any;
        return {
          ok: true,
          resultsText: `Updated ${agentName}'s appearance: ${Object.keys(patch).join(', ')}.`,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'agent.rename': {
      try {
        const a = args as any;
        const agentId = typeof a.agent_id === 'string' ? a.agent_id.trim() : '';
        const newName = typeof a.new_name === 'string' ? a.new_name.trim() : '';
        if (!agentId || !newName || newName.length > 32 || newName.includes('/')) {
          return { ok: false, resultsText: 'agent_id + new_name (1–32 chars, no slashes) are required.' } as any;
        }
        const { error } = await supabase
          .from('circle_office_agents')
          .update({ name: newName, updated_at: new Date().toISOString() })
          .eq('id', agentId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Rename failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Renamed agent to "${newName}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.rename': {
      try {
        const a = args as any;
        const roomId = typeof a.room_id === 'string' ? a.room_id.trim() : '';
        const name   = typeof a.name    === 'string' ? a.name.trim()    : '';
        if (!roomId || !name) return { ok: false, resultsText: 'room_id and name are required.' } as any;
        const { error } = await supabase
          .from('project_rooms')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', roomId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Rename failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Renamed room to "${name}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.archive':
    case 'rooms.unarchive': {
      try {
        const a = args as any;
        const roomId = typeof a.room_id === 'string' ? a.room_id.trim() : '';
        if (!roomId) return { ok: false, resultsText: 'room_id is required.' } as any;
        const isActive = tool === 'rooms.unarchive';
        const { error } = await supabase
          .from('project_rooms')
          .update({ is_active: isActive, updated_at: new Date().toISOString() })
          .eq('id', roomId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Update failed: ${error.message}` } as any;
        return { ok: true, resultsText: isActive ? 'Unarchived room.' : 'Archived room.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.create': {
      try {
        const { createMission } = await import('./missions');
        const a = args as any;
        const title = typeof a.title === 'string' ? a.title.trim() : '';
        if (!title) return { ok: false, resultsText: 'Mission title is required.' } as any;
        const { mission, error } = await createMission(
          context.circleId,
          context.userId,
          title,
          typeof a.description === 'string' ? a.description : undefined,
          typeof a.deadline === 'string' ? a.deadline : undefined,
        );
        if (error || !mission) return { ok: false, resultsText: `Mission create failed: ${error || 'unknown'}` } as any;
        return { ok: true, resultsText: `Created mission "${title}" (id: ${mission.id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.assign_agent': {
      try {
        const { assignAgent } = await import('./missions');
        const a = args as any;
        const missionId = typeof a.mission_id === 'string' ? a.mission_id.trim() : '';
        const agentName = typeof a.agent_name === 'string' ? a.agent_name.trim() : '';
        if (!missionId || !agentName) return { ok: false, resultsText: 'mission_id and agent_name are required.' } as any;
        const role = typeof a.role === 'string' ? a.role : 'executor';
        const { error } = await assignAgent(missionId, agentName, role as any);
        if (error) return { ok: false, resultsText: `Assign failed: ${error}` } as any;
        return { ok: true, resultsText: `Assigned ${agentName} to mission (${role}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.unassign_agent': {
      try {
        const { unassignAgent } = await import('./missions');
        const a = args as any;
        const missionId = typeof a.mission_id === 'string' ? a.mission_id.trim() : '';
        const agentName = typeof a.agent_name === 'string' ? a.agent_name.trim() : '';
        if (!missionId || !agentName) return { ok: false, resultsText: 'mission_id and agent_name are required.' } as any;
        const { error } = await unassignAgent(missionId, agentName);
        if (error) return { ok: false, resultsText: `Unassign failed: ${error}` } as any;
        return { ok: true, resultsText: `Removed ${agentName} from mission.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.update_status': {
      try {
        const { updateMission } = await import('./missions');
        const a = args as any;
        const missionId = typeof a.mission_id === 'string' ? a.mission_id.trim() : '';
        if (!missionId) return { ok: false, resultsText: 'mission_id is required.' } as any;
        const patch: Record<string, any> = {};
        const touched: string[] = [];
        if (typeof a.status === 'string') {
          const s = a.status.trim();
          if (!['active', 'completed', 'paused', 'cancelled'].includes(s)) {
            return { ok: false, resultsText: 'status must be active | completed | paused | cancelled.' } as any;
          }
          patch.status = s; touched.push('status');
        }
        if (typeof a.title === 'string' && a.title.trim()) { patch.title = a.title.trim(); touched.push('title'); }
        if (typeof a.description === 'string')             { patch.description = a.description; touched.push('description'); }
        if (typeof a.deadline === 'string') {
          patch.deadline = a.deadline.trim() === '' ? null : a.deadline.trim();
          touched.push('deadline');
        }
        if (touched.length === 0) {
          return { ok: false, resultsText: 'Pass at least one of status / title / description / deadline.' } as any;
        }
        const { error } = await updateMission(missionId, patch);
        if (error) return { ok: false, resultsText: `Mission update failed: ${error}` } as any;
        return { ok: true, resultsText: `Updated mission: ${touched.join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'circle.toggle_public': {
      try {
        const a = args as any;
        if (typeof a.is_public !== 'boolean') {
          return { ok: false, resultsText: 'is_public must be a boolean (true or false).' } as any;
        }
        const { error } = await supabase
          .from('circles').update({ is_public: a.is_public }).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Toggle failed: ${error.message}` } as any;
        return { ok: true, resultsText: a.is_public ? 'Circle is now public (visible in /discover).' : 'Circle is now private.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'check_ins.log': {
      try {
        const a = args as any;
        const content = typeof a.content === 'string' ? a.content.trim() : '';
        if (!content) return { ok: false, resultsText: 'content is required.' } as any;
        const row: Record<string, any> = {
          circle_id: context.circleId,
          user_id:   context.userId,
          content,
          created_at: new Date().toISOString(),
        };
        if (a.metric && typeof a.metric === 'object') row.metric = a.metric;
        const { error, data } = await supabase.from('check_ins').insert(row).select('id').single();
        if (error) return { ok: false, resultsText: `Check-in failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Logged check-in (id: ${(data?.id as string || '').slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'automations.list': {
      try {
        const { data, error } = await supabase
          .from('circle_automations')
          .select('id, name, trigger_type, schedule, enabled, last_run_at, last_error')
          .eq('circle_id', context.circleId)
          .order('enabled', { ascending: false })
          .order('last_run_at', { ascending: false, nullsFirst: false })
          .limit(30);
        if (error) return { ok: false, resultsText: `List failed: ${error.message}` } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No automations configured.' } as any;
        const lines = (data as any[]).map((a) => {
          const flag = a.enabled ? '●' : '○';
          const err  = a.last_error ? ` — ERR: ${String(a.last_error).slice(0, 60)}` : '';
          const last = a.last_run_at ? ` — last: ${a.last_run_at}` : '';
          return `${flag} ${a.name} [${a.trigger_type}${a.schedule ? ` · ${a.schedule}` : ''}]${last}${err} — id: ${String(a.id).slice(0, 8)}`;
        });
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'automations.toggle_enabled': {
      try {
        const a = args as any;
        const automationId = typeof a.automation_id === 'string' ? a.automation_id.trim() : '';
        if (!automationId || typeof a.enabled !== 'boolean') {
          return { ok: false, resultsText: 'automation_id + enabled (boolean) are required.' } as any;
        }
        const { error } = await supabase
          .from('circle_automations')
          .update({ enabled: a.enabled })
          .eq('id', automationId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Toggle failed: ${error.message}` } as any;
        return { ok: true, resultsText: a.enabled ? 'Automation resumed.' : 'Automation paused.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.remove_task': {
      try {
        const a = args as any;
        const taskId = typeof a.task_id === 'string' ? a.task_id.trim() : '';
        if (!taskId) return { ok: false, resultsText: 'task_id is required.' } as any;
        const { error } = await supabase.from('mission_tasks').delete().eq('id', taskId);
        if (error) return { ok: false, resultsText: `Remove failed: ${error.message}` } as any;
        return { ok: true, resultsText: 'Removed mission task.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.update_task': {
      try {
        const a = args as any;
        const taskId = typeof a.task_id === 'string' ? a.task_id.trim() : '';
        if (!taskId) return { ok: false, resultsText: 'task_id is required.' } as any;
        const patch: Record<string, any> = {};
        const touched: string[] = [];
        if (typeof a.title === 'string' && a.title.trim())        { patch.title = a.title.trim();             touched.push('title'); }
        if (typeof a.description === 'string')                    { patch.description = a.description;        touched.push('description'); }
        if (typeof a.priority === 'string' && a.priority.trim())  { patch.priority = a.priority.trim();       touched.push('priority'); }
        if (typeof a.due_date === 'string')                       { patch.due_date = a.due_date.trim() || null; touched.push('due_date'); }
        if (typeof a.assigned_to === 'string')                    { patch.assigned_to = a.assigned_to.trim() || null; touched.push('assigned_to'); }
        if (typeof a.status === 'string' && a.status.trim()) {
          const s = a.status.trim();
          if (!['pending', 'running', 'done', 'blocked', 'cancelled'].includes(s)) {
            return { ok: false, resultsText: 'status must be pending | running | done | blocked | cancelled.' } as any;
          }
          patch.status = s;
          touched.push('status');
        }
        if (touched.length === 0) return { ok: false, resultsText: 'Pass at least one field to update.' } as any;
        const { error } = await supabase.from('mission_tasks').update(patch).eq('id', taskId);
        if (error) return { ok: false, resultsText: `Update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Updated mission task: ${touched.join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'agent.set_spirit': {
      try {
        const a = args as any;
        const agentId = typeof a.agent_id === 'string' ? a.agent_id.trim() : '';
        if (!agentId || typeof a.spirit !== 'string') {
          return { ok: false, resultsText: 'agent_id and spirit are required.' } as any;
        }
        const spirit = a.spirit.trim();
        const { error } = await supabase
          .from('circle_office_agents')
          .update({ spirit: spirit || null, updated_at: new Date().toISOString() })
          .eq('id', agentId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Set spirit failed: ${error.message}` } as any;
        return { ok: true, resultsText: spirit ? `Agent spirit set to "${spirit}".` : 'Agent spirit cleared.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'memory.pin':
    case 'memory.unpin': {
      try {
        const { pinMemory, unpinMemory } = await import('./memoryActions');
        const a = args as any;
        const memoryId = typeof a.memory_id === 'string' ? a.memory_id.trim() : '';
        if (!memoryId) return { ok: false, resultsText: 'memory_id is required.' } as any;
        const ok = tool === 'memory.pin' ? await pinMemory(memoryId) : await unpinMemory(memoryId);
        if (!ok) return { ok: false, resultsText: `Memory ${tool === 'memory.pin' ? 'pin' : 'unpin'} failed.` } as any;
        return { ok: true, resultsText: tool === 'memory.pin' ? 'Pinned memory.' : 'Unpinned memory.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'memory.forget': {
      try {
        const { softDeleteMemory } = await import('./memoryActions');
        const a = args as any;
        const memoryId = typeof a.memory_id === 'string' ? a.memory_id.trim() : '';
        if (!memoryId) return { ok: false, resultsText: 'memory_id is required.' } as any;
        const ok = await softDeleteMemory(memoryId, context.userId, 'agent_tool_forget');
        if (!ok) return { ok: false, resultsText: 'Forget failed.' } as any;
        return { ok: true, resultsText: 'Memory marked as forgotten (soft-deleted; recoverable).' } as any;
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
    // ── Desktop automation (Claude Code bridge) ─────────────────────────
    case 'desktop.launch_app': {
      try {
        const { launchApp, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline. Start it with `node scripts/claude-bridge.js` and pair once from the UC app.' } as any;
        }
        const r = await launchApp(String((args as any).appName || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Launched ${(r.data?.appName) || 'app'}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.focus_app': {
      try {
        const { focusApp, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await focusApp(String((args as any).appName || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Focused ${(r.data?.appName) || 'app'}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.type_text': {
      try {
        const { typeText, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await typeText(String((args as any).text || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Typed ${r.data?.chars ?? 0} chars into focused app.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.press_keys': {
      try {
        const { pressKeys, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await pressKeys(String((args as any).combo || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Pressed ${r.data?.combo || ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.list_running_apps': {
      try {
        const { listRunningApps, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await listRunningApps();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const apps = r.data || [];
        return { ok: true, resultsText: apps.length ? `Running apps (${apps.length}): ${apps.join(', ')}` : 'No foreground apps reported.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.wait_for_app': {
      try {
        const { waitForApp, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const a = args as any;
        const r = await waitForApp(String(a.appName || ''), typeof a.timeoutMs === 'number' ? a.timeoutMs : undefined);
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `App ${r.data?.appName} ready (${r.data?.elapsedMs ?? 0}ms).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.screenshot': {
      try {
        const { takeScreenshot, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await takeScreenshot();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return {
          ok: true,
          resultsText: `Captured screenshot (${Math.round((r.data?.sizeBytes ?? 0) / 1024)} KB PNG). base64 length: ${(r.data?.base64 || '').length} chars.`,
          base64: r.data?.base64,
          mimeType: r.data?.mimeType,
          sizeBytes: r.data?.sizeBytes,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.open_url': {
      try {
        const { openUrl, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await openUrl(String((args as any).url || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Opened ${r.data?.url} (${r.data?.scheme}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.open_path': {
      try {
        const { openPath, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await openPath(String((args as any).path || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Opened ${r.data?.path}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.click_at': {
      try {
        const { clickAt, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const a = args as any;
        const r = await clickAt(Number(a.x), Number(a.y));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Clicked at (${r.data?.x}, ${r.data?.y}) via ${r.data?.via}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.screen_size': {
      try {
        const { getScreenSize, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await getScreenSize();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Screen size: ${r.data?.width} × ${r.data?.height}.`, width: r.data?.width, height: r.data?.height } as any;
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
