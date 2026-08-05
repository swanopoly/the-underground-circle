import {
  buildChatAutomationPlan,
  type BuildChatAutomationPlanInput,
  type ChatAutomationExecutionKind,
  type ChatAutomationPlan,
  type ChatAutomationRisk,
} from './chatAutomationPlanner';
import type { ChatCommandDecisionSource, ChatCommandRouteId } from './chatCommandRegistry';

export type ChatAutomationExecutorCoveragePriority = 'p0' | 'p1' | 'p2';

export interface ChatAutomationExecutorCoverageExpected {
  source?: ChatAutomationPlan['source'];
  executionKind: ChatAutomationExecutionKind;
  routeId?: ChatCommandRouteId | null;
  risk?: ChatAutomationRisk;
  approvalRequired?: boolean;
  minConfidence?: number;
}

export interface ChatAutomationExecutorCoverageCase {
  id: string;
  title: string;
  priority: ChatAutomationExecutorCoveragePriority;
  input: BuildChatAutomationPlanInput;
  expected: ChatAutomationExecutorCoverageExpected;
  userExperienceGoal: string;
  migrationOwner: 'single_executor' | 'plan_card' | 'app_adapter' | 'repeated_flow';
}

export interface ChatAutomationExecutorCoverageResult {
  id: string;
  title: string;
  priority: ChatAutomationExecutorCoveragePriority;
  status: 'covered' | 'missing_handler' | 'planner_mismatch';
  handlerKind: ChatAutomationExecutionKind;
  source: ChatAutomationPlan['source'];
  routeId: ChatCommandRouteId | null;
  risk: ChatAutomationRisk;
  approvalRequired: boolean;
  confidence: number;
  mismatches: string[];
  userExperienceGoal: string;
  migrationOwner: ChatAutomationExecutorCoverageCase['migrationOwner'];
}

export interface ChatAutomationExecutorCoverageReport {
  total: number;
  covered: number;
  missingHandlers: number;
  plannerMismatches: number;
  requiredHandlerKinds: ChatAutomationExecutionKind[];
  results: ChatAutomationExecutorCoverageResult[];
}

export const CHAT_AUTOMATION_EXECUTOR_COVERAGE_CASES: ChatAutomationExecutorCoverageCase[] = [
  {
    id: 'slash_help_command',
    title: 'Slash help command',
    priority: 'p0',
    input: { message: '/help' },
    expected: {
      source: 'slash',
      executionKind: 'run_command_handler',
      routeId: 'help',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.9,
    },
    userExperienceGoal: 'Keep command help deterministic and executor-backed.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'quick_computer_modal',
    title: 'Computer Use quick action',
    priority: 'p0',
    input: { message: '', quickActionText: '__COMPUTER_USE__' },
    expected: {
      source: 'quick_action',
      executionKind: 'open_modal',
      routeId: 'browser',
      risk: 'review',
      approvalRequired: true,
      minConfidence: 1,
    },
    userExperienceGoal: 'Open the governed computer-use surface instead of starting hidden work.',
    migrationOwner: 'plan_card',
  },
  {
    id: 'plain_chat_model',
    title: 'Plain model chat',
    priority: 'p0',
    input: { message: 'hello there' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_plain_chat',
      routeId: null,
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.4,
    },
    userExperienceGoal: 'Keep ordinary chat on the same dispatcher without forcing automation.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'openswan_mode_chat',
    title: 'Pinned OpenSwan mode',
    priority: 'p0',
    input: { message: 'review the latest office run', selectedMode: 'review' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_openswan',
      routeId: null,
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.4,
    },
    userExperienceGoal: 'Route selected-agent chat through the executor before the agent runtime.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'custom_api_action_request',
    title: 'Custom API action request',
    priority: 'p0',
    input: { message: 'Create a custom API action that calls POST /orders from the marketplace connector' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_openswan',
      routeId: null,
      risk: 'review',
      approvalRequired: false,
      minConfidence: 0.8,
    },
    userExperienceGoal: 'Use OpenSwan tools for API action setup/execution instead of no-tool plain chat.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'control_panel_repeat_automation_seed',
    title: 'Control Panel repeat automation seed',
    priority: 'p0',
    input: {
      message: 'Turn this into a repeatable automation: draft a WordPress weekly update, preview it, and ask before publishing.',
      selectedMode: 'plan',
    },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_openswan',
      routeId: null,
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.7,
    },
    userExperienceGoal: 'Keep sidebar Automations launch in OpenSwan planning posture instead of direct app/browser execution.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'browser_plan_command',
    title: 'Browser slash command',
    priority: 'p0',
    input: { message: '/browser open https://example.com and collect the docs links' },
    expected: {
      source: 'slash',
      executionKind: 'run_browser_plan',
      routeId: 'browser',
      risk: 'review',
      approvalRequired: true,
      minConfidence: 0.9,
    },
    userExperienceGoal: 'Preview browser work and approval before any remote session starts.',
    migrationOwner: 'plan_card',
  },
  {
    id: 'stagehand_browser_task',
    title: 'Stagehand browser task',
    priority: 'p0',
    input: { message: 'Use Stagehand to open https://example.com and click the docs link' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_computer_task',
      routeId: 'browser',
      risk: 'review',
      approvalRequired: false,
      minConfidence: 0.7,
    },
    userExperienceGoal: 'Send semantic browser tasks through computer-task routing and proof rules.',
    migrationOwner: 'app_adapter',
  },
  {
    id: 'notes_native_app_task',
    title: 'Notes native app task',
    priority: 'p0',
    input: { message: 'Open Notes and create a note called Project Plan with the text hello' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_computer_task',
      routeId: null,
      risk: 'review',
      approvalRequired: true,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Use observe-first native app automation instead of generic file writing.',
    migrationOwner: 'app_adapter',
  },
  {
    id: 'autocad_professional_app_task',
    title: 'AutoCAD professional app task',
    priority: 'p0',
    input: { message: 'Open AutoCAD and measure the area of the current drawing and export a PDF proof' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_computer_task',
      routeId: null,
      risk: 'review',
      approvalRequired: true,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Keep engineering app work on the app/control-surface ladder.',
    migrationOwner: 'app_adapter',
  },
  {
    id: 'matlab_professional_app_task',
    title: 'MATLAB professional app task',
    priority: 'p0',
    input: { message: 'Open MATLAB, run the current script, inspect the workspace, and export the plot' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_computer_task',
      routeId: null,
      risk: 'review',
      approvalRequired: true,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Route MATLAB work toward script/workspace evidence before UI fallback.',
    migrationOwner: 'app_adapter',
  },
  {
    id: 'solidworks_professional_app_task',
    title: 'SolidWorks professional app task',
    priority: 'p0',
    input: { message: 'Open SolidWorks and inspect the model features then export a drawing proof' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_computer_task',
      routeId: null,
      risk: 'review',
      approvalRequired: true,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Route SolidWorks work toward native/macro evidence before UI fallback.',
    migrationOwner: 'app_adapter',
  },
  {
    id: 'create_task_conversation',
    title: 'Create task from chat',
    priority: 'p0',
    input: { message: 'Create a task to review the invoice' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'mission',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.8,
    },
    userExperienceGoal: 'Create mission work through the planner instead of a duplicate router.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'ask_clarification_create_task',
    title: 'Ask clarification for underspecified task',
    priority: 'p0',
    input: { message: 'create a task' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'ask_clarification',
      routeId: null,
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Ask for the missing task title before creating mission work.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'remember_conversation',
    title: 'Remember from chat',
    priority: 'p0',
    input: { message: 'Remember that Chris prefers Go' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'memory',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Write user memory through the detected-intent executor without reclassification.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'forget_conversation',
    title: 'Forget from chat',
    priority: 'p0',
    input: { message: 'Forget what you know about the old stack' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'memory',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Delete matching memories through the same executor path as memory reads.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'show_memories_conversation',
    title: 'Show memories from chat',
    priority: 'p0',
    input: { message: 'show my memories' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'memory',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Open the memory viewer from the executor instead of a duplicate UI branch.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'office_agent_task_conversation',
    title: 'Create and assign office agent from chat',
    priority: 'p0',
    input: { message: 'Create an agent named Scout with Opus and add it to the task we just made' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'mission',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Create and assign office agents through the mission executor seam.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'generate_image_conversation',
    title: 'Generate image from chat',
    priority: 'p1',
    input: { message: 'Generate an image of a neon swan' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'hf_tools',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.8,
    },
    userExperienceGoal: 'Keep generated assets on the single executor before provider dispatch.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'build_webpage_conversation',
    title: 'Build webpage from chat',
    priority: 'p1',
    input: { message: 'Build me a landing page for recruits' },
    expected: {
      source: 'plain_chat',
      executionKind: 'run_build_discovery',
      routeId: 'build_page',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.55,
    },
    userExperienceGoal: 'Start build discovery through the same plan/dispatch contract.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'wordpress_publish',
    title: 'WordPress publish request',
    priority: 'p0',
    input: { message: 'Publish the homepage update to WordPress' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'wordpress',
      risk: 'external_side_effect',
      approvalRequired: true,
      minConfidence: 0.8,
    },
    userExperienceGoal: 'Gate external publishing before the WordPress handler runs.',
    migrationOwner: 'plan_card',
  },
  {
    id: 'wordpress_schedule',
    title: 'WordPress schedule request',
    priority: 'p0',
    input: { message: 'Schedule a WordPress post about launch recap for 2026-07-01' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'wordpress',
      risk: 'external_side_effect',
      approvalRequired: true,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Gate scheduled WordPress work before converting it into a draft/schedule action.',
    migrationOwner: 'plan_card',
  },
  {
    id: 'wordpress_list',
    title: 'WordPress list request',
    priority: 'p0',
    input: { message: 'Show my WordPress posts' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'wordpress',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Keep read-only WordPress list requests in the unified executor.',
    migrationOwner: 'single_executor',
  },
  {
    id: 'wordpress_list_pages_phrase_order',
    title: 'WordPress list pages phrase order',
    priority: 'p1',
    input: { message: 'List pages in WordPress' },
    expected: {
      source: 'conversational_intent',
      executionKind: 'run_command_handler',
      routeId: 'wordpress',
      risk: 'safe',
      approvalRequired: false,
      minConfidence: 0.85,
    },
    userExperienceGoal: 'Recognize normal phrasing where the target appears before WordPress.',
    migrationOwner: 'single_executor',
  },
];

export function getChatAutomationExecutorRequiredKinds(
  cases: ChatAutomationExecutorCoverageCase[] = CHAT_AUTOMATION_EXECUTOR_COVERAGE_CASES,
): ChatAutomationExecutionKind[] {
  return Array.from(new Set(cases.map((testCase) => testCase.expected.executionKind))).sort();
}

function normalizeHandlerKinds(
  handlerKinds?: Iterable<ChatAutomationExecutionKind> | Partial<Record<ChatAutomationExecutionKind, unknown>>,
): Set<ChatAutomationExecutionKind> {
  if (!handlerKinds) return new Set(getChatAutomationExecutorRequiredKinds());
  if (Symbol.iterator in Object(handlerKinds)) {
    return new Set(handlerKinds as Iterable<ChatAutomationExecutionKind>);
  }
  return new Set(
    Object.entries(handlerKinds)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key as ChatAutomationExecutionKind),
  );
}

function expectedValue<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function evaluateChatAutomationExecutorCoverage(options: {
  cases?: ChatAutomationExecutorCoverageCase[];
  handlerKinds?: Iterable<ChatAutomationExecutionKind> | Partial<Record<ChatAutomationExecutionKind, unknown>>;
} = {}): ChatAutomationExecutorCoverageReport {
  const cases = options.cases || CHAT_AUTOMATION_EXECUTOR_COVERAGE_CASES;
  const handlerKinds = normalizeHandlerKinds(options.handlerKinds);
  const results = cases.map((testCase): ChatAutomationExecutorCoverageResult => {
    const plan = buildChatAutomationPlan(testCase.input);
    const expected = testCase.expected;
    const mismatches: string[] = [];

    if (expectedValue(expected.source) && plan.source !== expected.source) {
      mismatches.push(`source expected ${expected.source}, got ${plan.source}`);
    }
    if (plan.execution.kind !== expected.executionKind) {
      mismatches.push(`execution.kind expected ${expected.executionKind}, got ${plan.execution.kind}`);
    }
    if (expectedValue(expected.routeId) && plan.execution.routeId !== expected.routeId) {
      mismatches.push(`routeId expected ${expected.routeId}, got ${plan.execution.routeId}`);
    }
    if (expectedValue(expected.risk) && plan.risk !== expected.risk) {
      mismatches.push(`risk expected ${expected.risk}, got ${plan.risk}`);
    }
    if (
      expectedValue(expected.approvalRequired)
      && plan.approval.required !== expected.approvalRequired
    ) {
      mismatches.push(`approval.required expected ${expected.approvalRequired}, got ${plan.approval.required}`);
    }
    if (expected.minConfidence !== undefined && plan.confidence < expected.minConfidence) {
      mismatches.push(`confidence expected >= ${expected.minConfidence}, got ${plan.confidence}`);
    }

    const hasHandler = handlerKinds.has(plan.execution.kind);
    const status = mismatches.length
      ? 'planner_mismatch'
      : hasHandler
        ? 'covered'
        : 'missing_handler';

    return {
      id: testCase.id,
      title: testCase.title,
      priority: testCase.priority,
      status,
      handlerKind: plan.execution.kind,
      source: plan.source,
      routeId: plan.execution.routeId,
      risk: plan.risk,
      approvalRequired: plan.approval.required,
      confidence: plan.confidence,
      mismatches,
      userExperienceGoal: testCase.userExperienceGoal,
      migrationOwner: testCase.migrationOwner,
    };
  });

  return {
    total: results.length,
    covered: results.filter((result) => result.status === 'covered').length,
    missingHandlers: results.filter((result) => result.status === 'missing_handler').length,
    plannerMismatches: results.filter((result) => result.status === 'planner_mismatch').length,
    requiredHandlerKinds: getChatAutomationExecutorRequiredKinds(cases),
    results,
  };
}
