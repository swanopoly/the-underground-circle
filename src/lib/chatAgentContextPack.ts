import type {
  ChatAutomationExecutionKind,
  ChatAutomationPlan,
  ChatAutomationRisk,
} from './chatAutomationPlanner';

export type ChatAgentContextPackVersion = 'chat_agent_context_pack_v1';

export type ChatAgentContextPackTarget =
  | 'swanbot'
  | 'openswan'
  | 'codex'
  | 'claude_code'
  | 'cursor'
  | 'generic_agent';

export type ChatAgentContextPack = {
  version: ChatAgentContextPackVersion;
  goal: string;
  source: ChatAutomationPlan['source'];
  intentLabel: string;
  executionKind: ChatAutomationExecutionKind;
  routeId: string | null;
  commandText: string | null;
  confidence: number;
  risk: ChatAutomationRisk;
  approval: {
    required: boolean;
    reason: string | null;
  };
  lane: {
    pipelineId: string | null;
    pipelineTitle: string | null;
    category: string | null;
    pattern: string | null;
    primarySurface: string | null;
    fallbackSurfaces: string[];
    surfaceStatus: string | null;
  };
  recommendedTools: string[];
  requiredInputs: string[];
  acceptanceCriteria: string[];
  proofRequirements: string[];
  guardrails: string[];
  stopConditions: string[];
  recovery: string[];
  persistenceTargets: string[];
  suggestedTargets: ChatAgentContextPackTarget[];
  humanReviewRequired: boolean;
  canDispatchToConnectedAgent: boolean;
  allowParallelAgents: boolean;
  dispatchContext: {
    circleId?: string;
    userId?: string;
    threadId?: string;
    model?: string | null;
    chatMode?: string;
  };
  compactPrompt: string;
};

export type BuildChatAgentContextPackOptions = {
  circleId?: string;
  userId?: string;
  threadId?: string;
  model?: string | null;
  chatMode?: string;
  maxPromptChars?: number;
};

const VERSION: ChatAgentContextPackVersion = 'chat_agent_context_pack_v1';
const DEFAULT_PROMPT_MAX = 2600;
const TEXT_MAX = 220;
const SHORT_TEXT_MAX = 90;

const SECRET_PATTERNS: RegExp[] = [
  /\bAuthorization\s*[:=]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|private[_-]?key|credential|auth[_-]?token|session[_-]?(?:id|token)|x[_-]?api[_-]?key)\b\s*[:=]\s*["']?[^\s"',;)]{4,}["']?/gi,
  /\bsk-ant-[A-Za-z0-9._-]{12,}/g,
  /\bsk-[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi,
  /\bhf_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}/g,
];

function redactPotentialSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    try { out = out.replace(pattern, '[redacted]'); } catch {}
  }
  return out;
}

function compactText(value: unknown, max = TEXT_MAX): string {
  const text = redactPotentialSecrets(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 15)).trimEnd()}...[truncated]`;
}

function compactStringList(
  values: ReadonlyArray<unknown> | null | undefined,
  limit: number,
  max = TEXT_MAX,
): string[] {
  const out: string[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = compactText(value, max);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function deepFreezeContextValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeContextValue(child);
  }
  return Object.freeze(value);
}

function getGoal(plan: ChatAutomationPlan): string {
  if (plan.intent.kind === 'direct_chat') return compactText(plan.intent.message, 360);
  if (plan.intent.kind === 'slash_command' || plan.intent.kind === 'natural_command') {
    return compactText(plan.intent.commandText, 360);
  }
  if (plan.intent.kind === 'quick_action') return compactText(plan.intent.actionText, 220);
  if (plan.intent.kind === 'conversational_action') {
    const label = plan.intent.intent.type.replace(/_/g, ' ');
    return compactText(plan.execution.commandText || label, 360);
  }
  return compactText(plan.execution.commandText || 'Chat request', 360);
}

function getIntentLabel(plan: ChatAutomationPlan): string {
  if (plan.intent.kind === 'conversational_action') return plan.intent.intent.type.replace(/_/g, ' ');
  if (plan.intent.kind === 'quick_action') return compactText(plan.intent.actionText, SHORT_TEXT_MAX) || 'quick action';
  if (plan.intent.kind === 'slash_command' || plan.intent.kind === 'natural_command') {
    return compactText(plan.intent.commandText, SHORT_TEXT_MAX) || 'command';
  }
  return 'chat request';
}

function getPipelineId(plan: ChatAutomationPlan): string | null {
  return plan.pipeline?.id || plan.pipelineDecision?.primary?.id || null;
}

function suggestTargets(plan: ChatAutomationPlan): ChatAgentContextPackTarget[] {
  const targets = new Set<ChatAgentContextPackTarget>();
  const pipeline = plan.pipeline || plan.pipelineDecision?.primary || null;
  const pipelineId = pipeline?.id || '';
  const category = pipeline?.category || '';

  if (plan.execution.kind === 'run_plain_chat') targets.add('swanbot');
  if (plan.execution.kind === 'run_openswan' || plan.execution.kind === 'run_computer_task' || plan.execution.kind === 'run_browser_plan') {
    targets.add('openswan');
  }
  if (plan.execution.kind === 'run_build_discovery' || plan.execution.routeId === 'build_page') {
    targets.add('openswan');
    targets.add('codex');
    targets.add('claude_code');
    targets.add('cursor');
  }
  if (
    category === 'code'
    || pipelineId === 'coding_build'
    || pipelineId === 'debug_fix'
    || pipelineId === 'code_review'
    || pipelineId === 'qa_testing'
    || pipelineId === 'cloud_devops'
  ) {
    targets.add('openswan');
    targets.add('codex');
    targets.add('claude_code');
    targets.add('cursor');
  }
  if (pipelineId === 'terminal_agents') {
    targets.add('codex');
    targets.add('claude_code');
    targets.add('cursor');
    targets.add('generic_agent');
  }
  if (targets.size === 0) targets.add('openswan');
  return Array.from(targets);
}

function buildGuardrails(plan: ChatAutomationPlan): string[] {
  const requestedActions = plan.computerRequestRoute?.requestedActionContract;
  return compactStringList([
    requestedActions
      ? `All ${requestedActions.actionCount} requested action IDs must be accounted for; partial coverage is never whole-task completion.`
      : null,
    requestedActions?.requiresDecompositionBeforeMutation
      ? 'The requested-action detector capped the list; decompose the intact request before any mutation.'
      : null,
    plan.approval.required ? `Wait for approval before acting: ${plan.approval.reason || 'approval required'}` : null,
    plan.risk === 'external_side_effect' ? 'Do not send, publish, purchase, submit, or mutate an external system until approval covers the exact action.' : null,
    plan.risk === 'destructive' ? 'Do not perform destructive actions without explicit human confirmation and rollback/proof steps.' : null,
    ...(plan.surfacePlan?.requiredApprovals || []).map((item) => `Approval boundary: ${item}`),
    ...(plan.pipeline?.approvalTriggers || []).map((item) => `Approval trigger: ${item}`),
    ...(plan.computerRequestRoute?.evidenceContract?.approvalBefore || []).map((item) => `Approval before: ${item}`),
    ...(plan.computerRequestRoute?.evidenceContract?.failClosedRules || []).map((item) => `Fail closed: ${item}`),
  ], 8, 220);
}

function buildRecovery(plan: ChatAutomationPlan): string[] {
  return compactStringList([
    plan.recoveryExecutionPlan?.userSummary,
    ...(plan.recoveryExecutionPlan?.nextSteps || []),
    plan.computerRequestRoute ? 'Collect fresh observation before retrying a browser, desktop, or app mutation.' : null,
    plan.computerRequestRoute ? 'If deterministic tools are missing, route to connected-agent capability buildout before coordinate-heavy retries.' : null,
    'Report the exact blocker, evidence gap, and next safe move if the task cannot proceed.',
  ], 6, 220);
}

function buildAcceptanceCriteria(plan: ChatAutomationPlan): string[] {
  const requestedActions = plan.computerRequestRoute?.requestedActionContract;
  const routeCompletionProof = (plan.computerRequestRoute?.completionProof || [])
    .filter((item) => !/^A\d+\s+independently verified\b/.test(item));
  return compactStringList([
    ...(requestedActions?.actions || []).map((action) => `${action.id} independently verified: ${action.text}`),
    ...(plan.pipeline?.completionCriteria || []),
    ...(plan.pipelineDecision?.primary?.completionCriteria || []),
    ...routeCompletionProof,
    plan.execution.kind === 'run_plain_chat' ? 'Return a clear final answer.' : null,
    plan.execution.kind === 'run_openswan' ? 'Return an agent run summary with proof or blockers.' : null,
    plan.execution.kind === 'run_build_discovery' ? 'Capture the build goal, missing details, and launch-ready next action.' : null,
    plan.execution.kind === 'ask_clarification' ? 'Ask only for the missing decision-relevant fields.' : null,
  ], 12, 220);
}

function buildProofRequirements(plan: ChatAutomationPlan): string[] {
  return compactStringList([
    ...(plan.surfacePlan?.completionProof || []),
    ...(plan.computerRequestRoute?.evidenceContract?.proofAfter || []),
    ...(plan.ledgerPreview?.events || [])
      .filter((event) => event.eventType === 'verified')
      .map((event) => compactText(event.metadata?.proof || event.metadata?.summary || 'verification receipt', 160)),
    plan.execution.kind === 'run_plain_chat' ? 'final answer' : null,
    plan.execution.kind === 'run_openswan' ? 'agent run receipt' : null,
  ], 7, 180);
}

function buildRequiredInputs(plan: ChatAutomationPlan): string[] {
  return compactStringList([
    ...(plan.pipeline?.executionRequirements || []),
    ...(plan.pipelineDecision?.executionRequirements || []),
    ...(plan.computerRequestRoute?.evidenceContract?.observeBefore || []).map((item) => `Observe: ${item}`),
    ...(plan.execution.clarification?.missingParams || []).map((item) => `Missing: ${item}`),
  ], 7, 200);
}

function buildRecommendedTools(plan: ChatAutomationPlan): string[] {
  return compactStringList([
    ...(plan.computerRequestRoute?.recommendedTools || []),
    ...(plan.pipeline?.recommendedTools || []),
    ...(plan.pipelineDecision?.primary?.recommendedTools || []),
  ], 12, 100);
}

function buildStopConditions(plan: ChatAutomationPlan): string[] {
  return compactStringList([
    ...(plan.surfacePlan?.stopConditions || []),
    ...(plan.computerRequestRoute?.evidenceContract?.failClosedRules || []),
    plan.approval.required ? 'Stop if the approval is missing, rejected, expired, or does not cover the exact action.' : null,
    plan.computerRequestRoute ? 'Stop on stale observation, ambiguous target, MFA/CAPTCHA, credential prompt, payment, destructive confirmation, or unsaved-change prompt.' : null,
  ], 7, 220);
}

function formatList(label: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [label, ...values.map((value) => `- ${value}`)];
}

function buildCompactPrompt(pack: Omit<ChatAgentContextPack, 'compactPrompt'>, maxChars: number): string {
  const lines = [
    'UC CHAT AGENT CONTEXT PACK',
    `Goal: ${pack.goal || 'Chat request'}`,
    `Intent: ${pack.intentLabel}`,
    `Execution: ${pack.executionKind}${pack.routeId ? ` via ${pack.routeId}` : ''}`,
    `Risk: ${pack.risk}`,
    `Approval: ${pack.approval.required ? pack.approval.reason || 'required' : 'not required before this step'}`,
    pack.lane.pipelineId ? `Pipeline: ${pack.lane.pipelineTitle || pack.lane.pipelineId} (${pack.lane.pipelineId})` : '',
    pack.lane.primarySurface ? `Primary surface: ${pack.lane.primarySurface}${pack.lane.surfaceStatus ? ` (${pack.lane.surfaceStatus})` : ''}` : '',
    `Suggested targets: ${pack.suggestedTargets.join(', ')}`,
    // Request coverage and fail-closed policy outrank optional tool hints in a
    // bounded handoff. This ordering prevents prompt truncation from dropping
    // A7/A8 while leaving a generic tool list intact.
    ...formatList('Acceptance criteria:', pack.acceptanceCriteria),
    ...formatList('Guardrails:', pack.guardrails),
    ...formatList('Stop conditions:', pack.stopConditions),
    ...formatList('Required inputs:', pack.requiredInputs),
    ...formatList('Recommended tools:', pack.recommendedTools),
    ...formatList('Proof required:', pack.proofRequirements),
    ...formatList('Recovery:', pack.recovery),
    'Report back with: status, changed systems/files, proof, blockers, and the next safe action.',
  ].filter(Boolean);
  const prompt = lines.join('\n');
  return prompt.length <= maxChars ? prompt : `${prompt.slice(0, Math.max(1, maxChars - 15)).trimEnd()}...[truncated]`;
}

export function buildChatAgentContextPack(
  plan: ChatAutomationPlan,
  opts: BuildChatAgentContextPackOptions = {},
): ChatAgentContextPack {
  const pipeline = plan.pipeline || plan.pipelineDecision?.primary || null;
  const surfacePlan = plan.surfacePlan || null;
  const suggestedTargets = suggestTargets(plan);
  const approvalRequired = plan.approval.required === true;
  const riskRequiresReview = plan.risk !== 'safe';

  const base = {
    version: VERSION,
    goal: getGoal(plan),
    source: plan.source,
    intentLabel: getIntentLabel(plan),
    executionKind: plan.execution.kind,
    routeId: plan.execution.routeId || null,
    commandText: plan.execution.commandText ? compactText(plan.execution.commandText, 360) : null,
    confidence: Number.isFinite(plan.confidence) ? Math.round(plan.confidence * 100) / 100 : 0,
    risk: plan.risk,
    approval: {
      required: approvalRequired,
      reason: approvalRequired ? compactText(plan.approval.reason || 'Approval required before action', 180) : null,
    },
    lane: {
      pipelineId: getPipelineId(plan),
      pipelineTitle: pipeline?.title ? compactText(pipeline.title, SHORT_TEXT_MAX) : null,
      category: pipeline?.category || null,
      pattern: plan.pipelineDecision?.pattern || null,
      primarySurface: surfacePlan?.primarySurface || null,
      fallbackSurfaces: compactStringList(surfacePlan?.fallbackSurfaces || [], 6, 80),
      surfaceStatus: surfacePlan?.status || null,
    },
    recommendedTools: buildRecommendedTools(plan),
    requiredInputs: buildRequiredInputs(plan),
    acceptanceCriteria: buildAcceptanceCriteria(plan),
    proofRequirements: buildProofRequirements(plan),
    guardrails: buildGuardrails(plan),
    stopConditions: buildStopConditions(plan),
    recovery: buildRecovery(plan),
    persistenceTargets: compactStringList([
      ...(plan.pipeline?.persistenceTargets || []),
      ...(plan.pipelineDecision?.persistenceTargets || []),
    ], 8, 100),
    suggestedTargets,
    humanReviewRequired: approvalRequired || riskRequiresReview,
    canDispatchToConnectedAgent: suggestedTargets.some((target) => target !== 'swanbot'),
    allowParallelAgents: (
      suggestedTargets.some((target) => target === 'codex' || target === 'claude_code' || target === 'cursor')
      && plan.risk === 'safe'
      && !approvalRequired
    ),
    dispatchContext: {
      ...(opts.circleId ? { circleId: compactText(opts.circleId, 120) } : {}),
      ...(opts.userId ? { userId: compactText(opts.userId, 120) } : {}),
      ...(opts.threadId ? { threadId: compactText(opts.threadId, 120) } : {}),
      ...(opts.model !== undefined ? { model: opts.model ? compactText(opts.model, 120) : null } : {}),
      ...(opts.chatMode ? { chatMode: compactText(opts.chatMode, 40) } : {}),
    },
  } satisfies Omit<ChatAgentContextPack, 'compactPrompt'>;

  return deepFreezeContextValue({
    ...base,
    compactPrompt: buildCompactPrompt(base, opts.maxPromptChars || DEFAULT_PROMPT_MAX),
  });
}
