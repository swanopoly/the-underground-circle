import { buildStreamableSystemPrompt, executeToolUseLoop, type SwanBotStructuredToolAction } from './swanbot';
import type { BrowserPlanCardData } from './computerUse';
import type { OpenSwanExecutionStatus } from './openswanExecution';
import { buildOpenSwanTaskPlan, type OpenSwanTaskKind, type OpenSwanToolName } from './openswanTaskPlanner';
import type { OpenSwanToolSurface, OpenSwanRuntimeToolName } from './openswanToolRuntime';
import { analyzeMessageRouting } from './messageRouting';

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
  const tools = new Set<OpenSwanRuntimeToolName>();

  for (const tool of opts.preferredToolNames || []) {
    tools.add(tool);
  }

  const analysis = analyzeMessageRouting(
    opts.message,
    opts.surface === 'room_chat' ? 'room_chat' : 'main_chat',
  );
  const taskPlan = buildOpenSwanTaskPlan(opts.message, analysis.route.profile, analysis.entities);
  for (const item of taskPlan.recommendedTools) {
    tools.add(item.tool);
  }

  // Respect explicit compatibility hints from callers that still know the
  // intended task kind even when the planner sees an underspecified prompt.
  if (opts.taskKind === 'research') {
    tools.add('research.search');
    tools.add('fetch_url');
  } else if (opts.taskKind === 'automation') {
    tools.add('schedule_action');
  } else if (opts.taskKind === 'debug') {
    tools.add('verification.typecheck');
    tools.add('verification.tests');
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
