import { buildStreamableSystemPrompt, executeToolUseLoop, type SwanBotStructuredToolAction } from './swanbot';
import type { BrowserPlanCardData } from './computerUse';
import type { OpenSwanExecutionStatus } from './openswanExecution';
import type { OpenSwanTaskKind, OpenSwanToolName } from './openswanTaskPlanner';
import type { OpenSwanToolSurface, OpenSwanRuntimeToolName } from './openswanToolRuntime';

export type OpenSwanRuntimeToolLoopOptions = {
  circleId: string;
  userId: string;
  runId?: string | null;
  message: string;
  draftResponse: string;
  model?: string | null;
  userName?: string;
  chatHistory?: string;
  activeSoulKey?: string | null;
  activePluginIds?: string[];
  taskKind?: OpenSwanTaskKind;
  surface?: OpenSwanToolSurface;
  preferredToolNames?: OpenSwanToolName[];
};

export type OpenSwanRuntimeToolLoopResult = {
  response: string;
  toolActions: SwanBotStructuredToolAction[];
};

function inferRequestedTools(opts: OpenSwanRuntimeToolLoopOptions): OpenSwanRuntimeToolName[] {
  const haystack = `${opts.message}\n${opts.draftResponse}`.toLowerCase();
  const tools = new Set<OpenSwanRuntimeToolName>();

  for (const tool of opts.preferredToolNames || []) {
    tools.add(tool);
  }

  if (/\b(remember|memory|what do we know|what did i say|previously|earlier|past decision)\b/i.test(haystack)) {
    tools.add('search_memories');
  }
  if (/\b(browser|browserbase|stagehand|computer[- ]use|open a site|website|web site|fill out|click through|login|dashboard)\b/i.test(haystack)) {
    tools.add('browser.plan_task');
  }
  if (
    /\b(fetch|look up|lookup|read this link|open this link|check this url|docs|documentation|research)\b/i.test(haystack) ||
    /https?:\/\//i.test(haystack) ||
    opts.taskKind === 'research'
  ) {
    tools.add('fetch_url');
  }
  if (/\b(who is in|who's in|list members|circle members|team members|who can help|assign to)\b/i.test(haystack)) {
    tools.add('list_circle_members');
  }
  if (
    /\b(schedule|queue|remind|post to|send to slack|tweet|email|webhook|automation)\b/i.test(haystack) ||
    opts.taskKind === 'automation'
  ) {
    tools.add('schedule_action');
  }
  if (/\b(task|tasks|todo|kanban|backlog|in progress|peer review|approved|done|assign)\b/i.test(haystack)) {
    tools.add('tasks.list');
    if (/\b(create|make|add|new)\b/i.test(haystack)) tools.add('tasks.create');
    if (/\b(assign|owner|delegate)\b/i.test(haystack)) tools.add('tasks.assign');
    if (/\b(move|mark|complete|done|start|status)\b/i.test(haystack)) tools.add('tasks.update_status');
    if (/\b(comment|note|update the task|leave a note|reply on task)\b/i.test(haystack)) tools.add('tasks.comment');
    if (/\b(artifact|attach|deliverable|proof|link this)\b/i.test(haystack)) tools.add('tasks.add_artifact');
  }
  if (/\b(goal|goals|okr|objective|key result|north star)\b/i.test(haystack)) {
    tools.add('goals.list');
    if (/\b(create|make|add|new)\b/i.test(haystack)) tools.add('goals.create');
    if (/\b(progress|percent|update progress|advance)\b/i.test(haystack)) tools.add('goals.update_progress');
    if (/\b(status|pause|active|complete|archive)\b/i.test(haystack)) tools.add('goals.update_status');
  }
  if (/\b(mission|missions|proof of work|pow)\b/i.test(haystack)) {
    tools.add('missions.list');
    if (/\b(add task|create task|new task)\b/i.test(haystack)) tools.add('missions.create_task');
    if (/\b(complete|done|close)\b/i.test(haystack)) tools.add('missions.complete_task');
  }
  if (/\b(chat|message history|recent messages|thread|conversation)\b/i.test(haystack)) {
    tools.add('messages.list');
    if (/\b(post|send|say|announce|reply)\b/i.test(haystack)) tools.add('messages.create');
  }
  if (/\b(check-?in|standup|daily update|streak)\b/i.test(haystack)) {
    tools.add('check_ins.list');
  }
  if (/\b(research|digest|paper|report|findings|corpus)\b/i.test(haystack)) {
    tools.add('research.search');
  }
  if (/\b(save research|store research|capture finding)\b/i.test(haystack)) {
    tools.add('research.save');
  }
  if (/\b(room|rooms|workspace|project files|room files)\b/i.test(haystack)) {
    tools.add('rooms.list');
    if (/\b(create room|new room|make room)\b/i.test(haystack)) tools.add('rooms.create');
    if (/\b(post in room|send to room|tell the room|message the room)\b/i.test(haystack)) tools.add('rooms.send_message');
    if (/\b(room task|room tasks|automation task|runner)\b/i.test(haystack)) tools.add('rooms.list_tasks');
    if (/\b(create room task|new room task|add room task)\b/i.test(haystack)) tools.add('rooms.create_task');
    if (/\b(create file|new file|write file|generate file)\b/i.test(haystack)) tools.add('rooms.create_file');
    if (/\b(edit file|update file|patch file|modify file)\b/i.test(haystack)) tools.add('rooms.update_file');
    tools.add('rooms.list_files');
    if (/\bread\b/i.test(haystack)) tools.add('rooms.read_file');
  }
  if (/\b(github|repo|repository|pull request|pr|branch)\b/i.test(haystack)) {
    tools.add('github.list_repos');
    if (/\bread file|open file|show file\b/i.test(haystack)) tools.add('github.read_file');
  }
  if (/\b(integration|integrations|connector|provider|browserbase|figma|slack|teams)\b/i.test(haystack)) {
    tools.add('integrations.list');
  }
  if (/\b(office agent|office agents|published agents|who is active|active agents|circle office)\b/i.test(haystack)) {
    tools.add('office.list_agents');
  }
  if (/\b(approval|approvals|approve|approved|reject|rejected|needs approval|pending approval)\b/i.test(haystack)) {
    tools.add('approvals.list');
    if (/\b(request|ask for|needs)\b/i.test(haystack)) tools.add('approvals.request');
    if (/\bapprove|approved|reject|rejected|deny\b/i.test(haystack)) tools.add('approvals.resolve');
  }
  if (/\b(save this|remember this|make note)\b/i.test(haystack)) {
    tools.add('save_memory');
  }

  return Array.from(tools);
}

function mapToolActionStatus(status: OpenSwanExecutionStatus): SwanBotStructuredToolAction['status'] {
  switch (status) {
    case 'passed':
      return 'completed';
    case 'manual_required':
      return 'manual_required';
    case 'blocked':
      return 'blocked';
    case 'planned':
    case 'running':
    case 'failed':
    default:
      return 'failed';
  }
}

function toToolActions(toolEvents: Array<{ tool: string; input: unknown; result: string; status: OpenSwanExecutionStatus; metadata?: Record<string, unknown> }>): SwanBotStructuredToolAction[] {
  return toolEvents.map((event) => ({
    kind: 'tool',
    tool_name: event.tool,
    title: event.tool.replace(/_/g, ' '),
    status: mapToolActionStatus(event.status),
    input_preview: JSON.stringify(event.input ?? {}).slice(0, 500),
    output_preview: event.result.slice(0, 1200),
    metadata: {
      source: 'openswan_runtime_tool_loop',
      ...(event.metadata || {}),
    },
  }));
}

export function extractBrowserPlansFromToolActions(toolActions: SwanBotStructuredToolAction[]): BrowserPlanCardData[] {
  return toolActions
    .map((action) => action.metadata?.browserPlan as BrowserPlanCardData | null | undefined)
    .filter((plan): plan is BrowserPlanCardData => !!plan && typeof plan === 'object' && Array.isArray(plan.actions));
}

export async function runOpenSwanRuntimeToolLoop(
  opts: OpenSwanRuntimeToolLoopOptions,
): Promise<OpenSwanRuntimeToolLoopResult> {
  const requestedTools = inferRequestedTools(opts);
  if (requestedTools.length === 0) {
    return {
      response: opts.draftResponse,
      toolActions: [],
    };
  }

  const systemPrompt = await buildStreamableSystemPrompt({
    circleId: opts.circleId,
    userId: opts.userId,
    currentMessage: opts.message,
    model: opts.model,
    userName: opts.userName,
    chatHistory: opts.chatHistory,
  });

  const toolResult = await executeToolUseLoop({
    systemPrompt,
    userMessage: [
      opts.message,
      '',
      'You already have this draft response.',
      'Use only the allowed tools when they materially improve correctness or actionability.',
      'If tool results are weak or unnecessary, keep the draft response mostly intact.',
      '',
      'Draft response:',
      opts.draftResponse,
    ].join('\n'),
    model: opts.model || 'claude-haiku-4-5-20251001',
    circleId: opts.circleId,
    userId: opts.userId,
    runId: opts.runId || undefined,
    activeSoulKey: opts.activeSoulKey || undefined,
    activePluginIds: opts.activePluginIds,
    allowedToolNames: requestedTools,
    surface: opts.surface || 'main_chat',
  });

  const toolActions = toToolActions(toolResult.toolEvents);
  return {
    response: toolResult.response || opts.draftResponse,
    toolActions,
  };
}
