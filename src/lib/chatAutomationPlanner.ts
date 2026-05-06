import { inferChatCommandExecution, matchesChatCommandRoute, type ChatCommandDecisionSource, type ChatCommandRouteId } from './chatCommandRegistry';
import { planComputerTaskPreview } from './computerTaskPlanner';
import { classifyBrowserbaseWorkflow } from './browserbaseWorkflowIntent';

export type PlannerConversationalIntent =
  | { type: 'wordpress_publish'; title?: string; imageUrl?: string; status: 'draft' | 'publish' }
  | { type: 'wordpress_list' }
  | { type: 'wordpress_schedule'; date?: string; title?: string }
  | { type: 'create_task'; title: string; description?: string }
  | { type: 'office_agent_task'; agentName: string; modelName?: string; taskTarget: 'latest_user_task' | 'latest_circle_task' }
  | { type: 'remember'; content: string }
  | { type: 'forget'; query: string }
  | { type: 'show_memories' }
  | { type: 'generate_image'; prompt: string }
  | { type: 'build_webpage'; description: string }
  | { type: 'none' };

export type ChatAutomationIntent =
  | { kind: 'slash_command'; routeId: ChatCommandRouteId; commandText: string }
  | { kind: 'quick_action'; routeId: ChatCommandRouteId | null; actionText: string; mode: 'send' | 'prefill' | 'special' }
  | { kind: 'natural_command'; routeId: ChatCommandRouteId; commandText: string }
  | { kind: 'conversational_action'; intent: PlannerConversationalIntent; routeId: ChatCommandRouteId | null }
  | { kind: 'direct_chat'; message: string };

export type ChatAutomationExecutionKind =
  | 'local_reply'
  | 'run_plain_chat'
  | 'open_modal'
  | 'run_command_handler'
  | 'run_openswan'
  | 'run_computer_task'
  | 'run_build_discovery'
  | 'run_browser_plan'
  | 'run_circle_automation'
  | 'create_circle_automation'
  | 'suggest_automation_conversion';

export type ChatAutomationRisk =
  | 'safe'
  | 'review'
  | 'external_side_effect'
  | 'destructive';

export type ChatAutomationApproval =
  | { required: false; reason: null }
  | { required: true; reason: string };

export type ChatAutomationPlan = {
  source: ChatCommandDecisionSource | 'conversational_intent' | 'plain_chat';
  intent: ChatAutomationIntent;
  execution: {
    kind: ChatAutomationExecutionKind;
    routeId: ChatCommandRouteId | null;
    commandText?: string | null;
    modalKey?: string | null;
  };
  risk: ChatAutomationRisk;
  approval: ChatAutomationApproval;
  confidence: number;
  notes: string[];
};

export type BuildChatAutomationPlanInput = {
  message: string;
  attachments?: Array<{ uri?: string; type?: string; id?: string }>;
  quickActionText?: string | null;
  selectedMode?: string | null;
};

function mapConversationalIntentToRouteId(intentType: PlannerConversationalIntent['type']): ChatCommandRouteId | null {
  switch (intentType) {
    case 'create_task':
    case 'office_agent_task':
      return 'mission';
    case 'wordpress_publish':
    case 'wordpress_list':
    case 'wordpress_schedule':
      return 'wordpress';
    case 'remember':
    case 'forget':
    case 'show_memories':
      return 'memory';
    case 'build_webpage':
      return 'build_page';
    case 'generate_image':
      return 'hf_tools';
    case 'none':
    default:
      return null;
  }
}

function detectPlannerConversationalIntent(
  message: string,
  attachments?: Array<{ uri?: string; type?: string; id?: string }>,
): PlannerConversationalIntent {
  const lower = message.toLowerCase();

  if (/\b(post|publish|upload|send)\b.*\b(wordpress|wp|blog|site)\b/i.test(message)) {
    return {
      type: 'wordpress_publish',
      title: message.slice(0, 80),
      imageUrl: attachments?.find((item) => String(item.type || '').startsWith('image/'))?.uri,
      status: /\b(publish|go live|put it live)\b/i.test(lower) ? 'publish' : 'draft',
    };
  }
  if (/\b(show|list|see)\b.*\b(wordpress|wp|blog)\b.*\b(posts?|drafts?|pages?)\b/i.test(message)) {
    return { type: 'wordpress_list' };
  }
  if (/\b(schedule|queue|plan)\b.*\b(post|article|blog)\b/i.test(message)) {
    return { type: 'wordpress_schedule', title: message.slice(0, 80) };
  }
  if (/\b(create|add|make|open)\b.*\b(task|todo|ticket|issue)\b/i.test(message)) {
    return { type: 'create_task', title: message.slice(0, 120) };
  }
  if (/\b(spin up|create|make)\b.*\b(agent|pixel agent)\b/i.test(message) && /\btask\b/i.test(message)) {
    return {
      type: 'office_agent_task',
      agentName: 'Agent',
      taskTarget: /\btask\s+we\s+just\s+made\b/i.test(message) ? 'latest_user_task' : 'latest_circle_task',
    };
  }
  if (/\bremember\b/i.test(message)) {
    return { type: 'remember', content: message.replace(/^(please\s+)?remember\s+/i, '').trim() || message };
  }
  if (/\b(forget|remove|delete|clear)\b.*\b(memory|what you know)\b/i.test(message)) {
    return { type: 'forget', query: message.replace(/^(please\s+)?(forget|remove|delete|clear)\s+/i, '').trim() || message };
  }
  if (/\bwhat do you remember\b|\bshow\b.*\bmemories\b/i.test(message)) {
    return { type: 'show_memories' };
  }
  if (/\b(generate|create|make|draw|design)\b.*\b(image|picture|photo|illustration|artwork|logo|banner|icon)\b/i.test(message)) {
    return { type: 'generate_image', prompt: message };
  }
  return { type: 'none' };
}

function buildRiskForRoute(routeId: ChatCommandRouteId | null): ChatAutomationRisk {
  switch (routeId) {
    case 'wordpress':
    case 'schedule':
      return 'external_side_effect';
    case 'browser':
    case 'github':
    case 'governance':
      return 'review';
    default:
      return 'safe';
  }
}

function buildApproval(routeId: ChatCommandRouteId | null, risk: ChatAutomationRisk): ChatAutomationApproval {
  if (risk === 'external_side_effect') {
    return { required: true, reason: `Route ${routeId || 'unknown'} can affect external systems.` };
  }
  if (routeId === 'browser') {
    return { required: true, reason: 'Browser tasks may require manual approval before side effects.' };
  }
  return { required: false, reason: null };
}

function looksLikeComputerTask(message: string): boolean {
  const lower = String(message || '').trim().toLowerCase();
  if (!lower) return false;
  if (/\b(use computer|on my computer|check my computer|search my computer|find on my computer)\b/i.test(lower)) {
    return true;
  }
  const preview = planComputerTaskPreview(message);
  return preview.kind !== 'unknown';
}

function looksLikeBrowserbaseWorkflow(message: string): boolean {
  return classifyBrowserbaseWorkflow(message).kind !== 'general_browser';
}

function resolvePlannerQuickActionExecution(text: string): { text: string; mode: 'send' | 'prefill' | 'special'; routeId: ChatCommandRouteId | null } {
  switch (text) {
    case '__COMPUTER_USE__':
      return { text, mode: 'special', routeId: 'browser' };
    case '__TIP__':
      return { text, mode: 'special', routeId: null };
    case '__ASSIGN_AGENT__':
    case '__SPAWN_AGENT__':
    case '__SPAWN_AGENTS__':
    case '__LOG_PROOF__':
    case '__STEP_AWAY__':
    case '__OPEN_SEARCH__':
    case '__OPEN_GAMES__':
    case '__SEND_CRYPTO__':
    case '__NUKE__':
      return { text, mode: 'special', routeId: null };
    default:
      if (text.startsWith('/')) {
        const routeIds: ChatCommandRouteId[] = [
          'help', 'summary', 'schedule', 'mission', 'room', 'github', 'wordpress', 'browser', 'build_page', 'hf_tools', 'local_knowledge', 'memory', 'governance', 'search',
        ];
        const matchedRoute = routeIds.find((routeId) => matchesChatCommandRoute(text, routeId)) || null;
        return { text, mode: 'send', routeId: matchedRoute };
      }
      return { text, mode: 'send', routeId: null };
  }
}

export function buildChatAutomationPlan(input: BuildChatAutomationPlanInput): ChatAutomationPlan {
  const normalized = input.message.trim();
  const lower = normalized.toLowerCase();

  if (input.quickActionText) {
    const execution = resolvePlannerQuickActionExecution(input.quickActionText);
    const routeId = execution.routeId || null;
    const risk = buildRiskForRoute(routeId);
    return {
      source: 'quick_action',
      intent: {
        kind: 'quick_action',
        routeId,
        actionText: execution.text,
        mode: execution.mode || 'send',
      },
      execution: execution.mode === 'special'
        ? { kind: 'open_modal', routeId, modalKey: execution.text }
        : routeId === 'browser'
          ? { kind: 'run_browser_plan', routeId, commandText: execution.text }
          : { kind: 'run_command_handler', routeId, commandText: execution.text },
      risk,
      approval: buildApproval(routeId, risk),
      confidence: 1,
      notes: ['Planned from quick action registry.'],
    };
  }

  if (lower.startsWith('/')) {
    const routeIds: ChatCommandRouteId[] = [
      'help', 'summary', 'schedule', 'mission', 'room', 'github', 'wordpress', 'browser', 'build_page', 'hf_tools', 'local_knowledge', 'memory', 'governance', 'search',
    ];
    const matchedRoute = routeIds.find((routeId) => matchesChatCommandRoute(normalized, routeId)) || null;
    const risk = buildRiskForRoute(matchedRoute);
    return {
      source: 'slash',
      intent: {
        kind: 'slash_command',
        routeId: matchedRoute || 'help',
        commandText: normalized,
      },
      execution: matchedRoute === 'browser'
        ? { kind: 'run_browser_plan', routeId: matchedRoute, commandText: normalized }
        : matchedRoute === 'build_page'
          ? { kind: 'run_build_discovery', routeId: matchedRoute, commandText: normalized }
          : { kind: 'run_command_handler', routeId: matchedRoute, commandText: normalized },
      risk,
      approval: buildApproval(matchedRoute, risk),
      confidence: matchedRoute ? 1 : 0.6,
      notes: matchedRoute ? ['Matched explicit slash command route.'] : ['Slash command did not map cleanly; defaulted to handler path.'],
    };
  }

  const conversationalIntent = detectPlannerConversationalIntent(normalized, input.attachments);
  if (conversationalIntent.type !== 'none') {
    const routeId = mapConversationalIntentToRouteId(conversationalIntent.type);
    const risk = buildRiskForRoute(routeId);
    return {
      source: 'conversational_intent',
      intent: {
        kind: 'conversational_action',
        intent: conversationalIntent,
        routeId,
      },
      execution:
        conversationalIntent.type === 'build_webpage'
          ? { kind: 'run_build_discovery', routeId, commandText: normalized }
          : { kind: 'run_command_handler', routeId, commandText: normalized },
      risk,
      approval: buildApproval(routeId, risk),
      confidence: 0.85,
      notes: ['Matched conversational intent router.'],
    };
  }

  if (looksLikeBrowserbaseWorkflow(normalized)) {
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: {
        kind: 'run_computer_task',
        routeId: 'browser',
        commandText: normalized,
      },
      risk: /\b(delete|remove|overwrite|publish|submit|send|transfer|checkout|pay|apply|register)\b/i.test(normalized)
        ? 'review'
        : 'safe',
      approval: { required: false, reason: null },
      confidence: 0.82,
      notes: ['Detected as a Browserbase workflow: web data retrieval, Stagehand semantic browser action, or form submission.'],
    };
  }

  const commandExecution = inferChatCommandExecution(normalized);
  if (commandExecution) {
    const risk = buildRiskForRoute(commandExecution.routeId);
    return {
      source: 'natural_language',
      intent: {
        kind: 'natural_command',
        routeId: commandExecution.routeId,
        commandText: commandExecution.commandText,
      },
      execution: commandExecution.routeId === 'browser'
        ? { kind: 'run_browser_plan', routeId: commandExecution.routeId, commandText: commandExecution.commandText }
        : { kind: 'run_command_handler', routeId: commandExecution.routeId, commandText: commandExecution.commandText },
      risk,
      approval: buildApproval(commandExecution.routeId, risk),
      confidence: 0.75,
      notes: ['Matched natural-language command rewrite.'],
    };
  }

  const buildish = /\b(build|landing page|website|site|web app|page)\b/i.test(normalized);
  // Explicit page/site/build phrasing should win over the generic
  // computer-task heuristic — otherwise "build me a landing page" gets
  // misclassified as a hybrid computer task. Only fall through to the
  // computer-task branch when the buildish terms are NOT present.
  if (!buildish && looksLikeComputerTask(normalized)) {
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: {
        kind: 'run_computer_task',
        routeId: 'browser',
        commandText: normalized,
      },
      risk: /\b(delete|remove|overwrite|publish|submit|send|transfer|checkout|pay)\b/i.test(normalized)
        ? 'review'
        : 'safe',
      approval: { required: false, reason: null },
      confidence: 0.72,
      notes: ['Detected as a computer task request spanning browser, files, apps, or hybrid work.'],
    };
  }

  if (buildish) {
    const explicitModeSelected = Boolean(input.selectedMode && input.selectedMode !== 'none');
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: explicitModeSelected
        ? { kind: 'run_openswan', routeId: 'build_page', commandText: normalized }
        : { kind: 'run_build_discovery', routeId: 'build_page', commandText: normalized },
      risk: 'safe',
      approval: { required: false, reason: null },
      confidence: 0.55,
      notes: explicitModeSelected
        ? ['Build-like request respects the explicitly selected OpenSwan mode.']
        : ['Build-like request should enter conversational build discovery.'],
    };
  }

  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: normalized },
    execution: {
      kind: input.selectedMode && input.selectedMode !== 'none' ? 'run_openswan' : 'run_plain_chat',
      routeId: null,
      commandText: normalized,
    },
    risk: 'safe',
    approval: { required: false, reason: null },
    confidence: 0.4,
    notes: ['Default direct chat path.'],
  };
}

// ─── Plan vs Act mode (Cline research item 1) ──────────────────────────────
//
// In Plan mode the executor must refuse anything that would mutate external
// state. We base the decision on `execution.kind` + `risk` so it is cheap
// and deterministic (no need to re-inspect the command text).
//
// Allowlist is intentionally tight: read-only kinds + the `suggest_*`
// family. Opening a modal is allowed because the modal itself does not
// side-effect — it just shows UI; the actual run inside the modal is a
// separate plan dispatch that will re-check this gate.

export type ChatMode = 'plan' | 'act';

const READ_ONLY_EXECUTION_KINDS = new Set<ChatAutomationExecutionKind>([
  'local_reply',
  'run_plain_chat',
  'open_modal',
  'suggest_automation_conversion',
]);

export function isPlanSafeForPlanMode(plan: ChatAutomationPlan): boolean {
  if (READ_ONLY_EXECUTION_KINDS.has(plan.execution.kind)) return true;
  // Command handlers and openswan turns with safe risk are allowed — these
  // are things like `/help`, `/memory list`, or a plain model chat routed
  // through OpenSwan. Anything with non-safe risk is refused.
  if (
    (plan.execution.kind === 'run_command_handler' || plan.execution.kind === 'run_openswan') &&
    plan.risk === 'safe'
  ) {
    return true;
  }
  return false;
}

/** Short reason string for the UI when Plan mode refuses a dispatch. */
export function describePlanModeRefusal(plan: ChatAutomationPlan): string {
  const route = plan.execution.routeId ? ` (${plan.execution.routeId})` : '';
  switch (plan.execution.kind) {
    case 'run_browser_plan':
      return `Plan mode can't launch browser automations${route}. Switch to Act to continue.`;
    case 'run_build_discovery':
      return `Plan mode can't publish or build pages${route}. Switch to Act to continue.`;
    case 'run_circle_automation':
    case 'create_circle_automation':
      return `Plan mode can't create or run automations${route}. Switch to Act to continue.`;
    default:
      return `Plan mode is read-only. Switch to Act to run this.`;
  }
}

export function summarisePlanForTelemetry(plan: ChatAutomationPlan): Record<string, unknown> {
  return {
    source:         plan.source,
    intentKind:     plan.intent.kind,
    executionKind:  plan.execution.kind,
    routeId:        plan.execution.routeId ?? null,
    risk:           plan.risk,
    approvalRequired: plan.approval.required,
    confidence:     plan.confidence,
    notes:          plan.notes,
  };
}
