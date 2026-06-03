import { classifyAgentFailure, isHumanTakeoverFailure, type AgentFailureAssessment } from './agentFailureTaxonomy';
import { applyAgentDevelopmentStandardsToPrompt } from './agentDevelopmentStandards';
import type { ConnectedAgentProvider } from './connectedAgentDispatch';

export type AgentFailureRecoveryAction =
  | 'diagnose_only'
  | 'patch_app_code'
  | 'restart_or_update_bridge'
  | 'switch_route_or_model'
  | 'retry_with_grounding'
  | 'request_user_action';

export type AgentFailureRecoveryNextActor = 'connected_agent' | 'openswan' | 'user' | 'none';

export type AgentFailureRecoveryComplexityLevel = 'single_step' | 'multi_step' | 'complex';

export type AgentFailureRecoveryCoordinationMode =
  | 'direct_repair'
  | 'checkpointed_recovery'
  | 'decompose_then_recover'
  | 'user_unblock';

export type AgentFailureRecoveryStepKind =
  | 'inspect'
  | 'decompose'
  | 'checkpoint'
  | 'patch'
  | 'restart'
  | 'retry'
  | 'ask_user'
  | 'verify'
  | 'stop';

export interface AgentFailureRecoveryRunbookStep {
  id: string;
  kind: AgentFailureRecoveryStepKind;
  title: string;
  detail: string;
  required: boolean;
  command?: string;
}

export interface AgentFailureRecoveryRunbook {
  action: AgentFailureRecoveryAction;
  nextActor: AgentFailureRecoveryNextActor;
  complexity: AgentFailureRecoveryComplexityAssessment;
  coordinationMode: AgentFailureRecoveryCoordinationMode;
  maxAttempts: number;
  autoFixAllowed: boolean;
  userActionRequired: boolean;
  steps: AgentFailureRecoveryRunbookStep[];
  stopConditions: string[];
}

export interface AgentFailureRecoveryComplexityAssessment {
  level: AgentFailureRecoveryComplexityLevel;
  score: number;
  surfaces: string[];
  signals: string[];
  requiresDecomposition: boolean;
  verificationDepth: 'focused' | 'expanded';
}

export interface AgentFailureRecoveryInput {
  task: string;
  failureMessage: string;
  failureStack?: string | null;
  outcomeStatus?: string | null;
  executionKind?: string | null;
  runId?: string | null;
  planSummary?: string | null;
  groundingSummary?: string | null;
  preflightSummary?: string | null;
  source?: string | null;
  sessionId?: string | null;
  launchIfMissing?: boolean;
  circleId?: string;
  userId?: string;
}

export interface AgentFailureRecoveryPolicy {
  assessment: AgentFailureAssessment;
  action: AgentFailureRecoveryAction;
  autoFixAllowed: boolean;
  needsUserAction: boolean;
  retryLimit: number;
  guardrails: string[];
  verification: string[];
  runbook: AgentFailureRecoveryRunbook;
  prompt: string;
}

export interface AgentFailureRecoveryStartResult {
  ok: boolean;
  /** Which connected agent ran the recovery (null when none was dispatched). */
  provider: ConnectedAgentProvider | null;
  sessionId?: string;
  displayName?: string;
  launched?: boolean;
  recoveryAction: AgentFailureRecoveryAction;
  assessment: AgentFailureAssessment;
  runbook: AgentFailureRecoveryRunbook;
  message: string;
}

function clean(value: unknown, max = 6_000): string {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function addUnique(target: string[], value: string) {
  const cleanValue = clean(value, 160);
  if (cleanValue && !target.includes(cleanValue)) target.push(cleanValue);
}

function assessRecoveryComplexity(input: AgentFailureRecoveryInput, assessment: AgentFailureAssessment): AgentFailureRecoveryComplexityAssessment {
  const text = [
    input.task,
    input.failureMessage,
    input.failureStack,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
    input.executionKind,
    input.source,
  ].map((value) => clean(value, 1_200).toLowerCase()).join('\n');
  const signals: string[] = [];
  const surfaces: string[] = [];
  let score = 0;

  addUnique(surfaces, String(assessment.surface || 'unknown'));

  const surfaceRules: Array<[string, RegExp]> = [
    ['browser', /\b(browser|browserbase|stagehand|dom|aria|selector|web page|tab)\b/i],
    ['desktop', /\b(desktop|macos|bridge|a11y|screenshot|window|clipboard|photoshop|indesign|finder)\b/i],
    ['terminal', /\b(terminal|cli|codex|claude|gemini|shell|command)\b/i],
    ['provider', /\b(provider|model|openrouter|anthropic|openai|hugging|groq|mistral|fallback|rate limit)\b/i],
    ['memory', /\b(memory|remember|archive|session archive|metadata)\b/i],
    ['schedule', /\b(schedule|cron|automation|recurring)\b/i],
    ['mission', /\b(mission|room|assign|multi-agent|agent plan|delegation)\b/i],
    ['data', /\b(database|supabase|constraint|migration|sql|row|table)\b/i],
    ['file', /\b(file|folder|path|upload|download|asset|artifact)\b/i],
  ];
  for (const [surface, pattern] of surfaceRules) {
    if (pattern.test(text)) addUnique(surfaces, surface);
  }

  if (surfaces.length > 1) {
    score += surfaces.length - 1;
    signals.push(`cross_surface:${surfaces.slice(0, 6).join('+')}`);
  }
  if (/\b(complexity|profile)\s*:\s*(complex|advanced|high)\b/i.test(text) || /\bcomplex\b/i.test(clean(input.planSummary, 600))) {
    score += 3;
    signals.push('route_marked_complex');
  }
  if (/\b(first|then|after that|next|finally|step\s+\d|phase\s+\d|end[- ]to[- ]end|workflow|pipeline|sequence)\b/i.test(text)) {
    score += 2;
    signals.push('multi_step_language');
  }
  if (/\b(and|plus|also)\b/i.test(clean(input.task, 1_000)) && clean(input.task, 1_000).length > 120) {
    score += 1;
    signals.push('compound_task');
  }
  if (/\b(multi[- ]agent|delegate|handoff|parallel|coordinate|subtask|sub-agent)\b/i.test(text)) {
    score += 2;
    signals.push('agent_coordination');
  }
  if (/\b(verify|test|typecheck|smoke|audit|proof|receipt|ledger)\b/i.test(text)) {
    score += 1;
    signals.push('explicit_verification');
  }
  if (clean(input.task, 2_000).length > 240) {
    score += 1;
    signals.push('long_task');
  }

  const level: AgentFailureRecoveryComplexityLevel = score >= 5 || surfaces.length >= 4
    ? 'complex'
    : score >= 2 || surfaces.length >= 3
      ? 'multi_step'
      : 'single_step';

  return {
    level,
    score,
    surfaces,
    signals,
    requiresDecomposition: level === 'complex',
    verificationDepth: level === 'single_step' ? 'focused' : 'expanded',
  };
}

function chooseRecoveryAction(assessment: AgentFailureAssessment): AgentFailureRecoveryAction {
  switch (assessment.failureClass) {
    case 'cors_preflight_blocked':
    case 'bridge_endpoint_missing':
    case 'desktop_bridge_offline':
    case 'browser_bridge_offline':
    case 'terminal_bridge_offline':
    case 'token_rejected':
      return 'restart_or_update_bridge';
    case 'constraint_violation':
    case 'duplicate_event':
    case 'model_identity_leak':
      return 'patch_app_code';
    case 'model_tool_unsupported':
    case 'provider_unavailable':
    case 'provider_rate_limited':
      return 'switch_route_or_model';
    case 'selector_not_found':
    case 'uncertain_ui_target':
    case 'a11y_tree_unavailable':
    case 'screenshot_unavailable':
    case 'file_not_found':
    case 'network_error':
    case 'server_error':
    case 'timeout':
      return 'retry_with_grounding';
    case 'missing_user_key':
    case 'vault_grant_missing':
    case 'origin_not_allowed':
    case 'missing_permission':
    case 'permission_denied':
    case 'auth_required':
    case 'auth_expired':
    case 'browser_dialog_blocked':
    case 'human_verification_required':
    case 'mfa_required':
    case 'otp_required':
    case 'budget_exceeded':
      return 'request_user_action';
    default:
      return assessment.retryable && !assessment.userActionRequired ? 'diagnose_only' : 'request_user_action';
  }
}

function canAutoFix(action: AgentFailureRecoveryAction, assessment: AgentFailureAssessment): boolean {
  if (assessment.userActionRequired || isHumanTakeoverFailure(assessment.failureClass)) return false;
  return action === 'patch_app_code'
    || action === 'restart_or_update_bridge'
    || action === 'switch_route_or_model'
    || action === 'retry_with_grounding'
    || action === 'diagnose_only';
}

function buildGuardrails(action: AgentFailureRecoveryAction): string[] {
  const guardrails = [
    'Do not use credentials, bypass CAPTCHA/MFA, access private accounts, or take external side-effect actions.',
    'Prefer a minimal root-cause diagnosis before editing code or retrying a workflow.',
    'Do not run destructive git commands, delete user files, or reset unrelated work.',
    'If the blocker needs a human permission, API key, MFA, CAPTCHA, budget approval, or exact credential grant, stop and write the exact user action instead of attempting a workaround.',
    'Keep changes scoped to the failed route, bridge, planner, runtime, or test that caused the failure.',
  ];
  if (action === 'patch_app_code') {
    guardrails.push('When patching app code, inspect the touched modules first, make the smallest compatible patch, and run targeted smoke/type checks.');
  }
  if (action === 'restart_or_update_bridge') {
    guardrails.push('When bridge mismatch is suspected, identify the missing endpoint/version first; prefer code/config patch plus restart instructions over blind restarts.');
  }
  if (action === 'retry_with_grounding') {
    guardrails.push('Before retrying a desktop/browser action, require fresh DOM/a11y/screenshot/file observations and stop after two repeated failures.');
  }
  return guardrails;
}

function buildVerification(
  action: AgentFailureRecoveryAction,
  complexity?: AgentFailureRecoveryComplexityAssessment,
): string[] {
  const base = [
    'Summarize root cause and exact failed surface.',
    'List files changed or state changed, if any.',
    'State the verification command/tool used and the result.',
    'Provide the exact retry instruction OpenSwan should run next, or the exact human action required.',
  ];
  if (action === 'patch_app_code') {
    base.push('Run the narrowest relevant smoke test and typecheck when code is touched.');
  }
  if (action === 'retry_with_grounding') {
    base.push('Show the fresh observation source that makes the retry safe.');
  }
  if (action === 'switch_route_or_model') {
    base.push('Run the provider/router or fallback-chain smoke that proves the new route can satisfy the tool mode.');
  }
  if (complexity?.verificationDepth === 'expanded') {
    base.push('For each decomposed subtask, record owner surface, checkpoint state, verification evidence, and remaining blocker if any.');
  }
  return base;
}

function chooseRunbookNextActor(
  action: AgentFailureRecoveryAction,
  autoFixAllowed: boolean,
  userActionRequired: boolean,
): AgentFailureRecoveryNextActor {
  if (userActionRequired || action === 'request_user_action') return 'user';
  if (!autoFixAllowed) return 'none';
  if (action === 'retry_with_grounding' || action === 'switch_route_or_model') return 'openswan';
  return 'connected_agent';
}

function buildRecoveryRunbookStep(
  id: string,
  kind: AgentFailureRecoveryStepKind,
  title: string,
  detail: string,
  required = true,
  command?: string,
): AgentFailureRecoveryRunbookStep {
  const step: AgentFailureRecoveryRunbookStep = { id, kind, title, detail, required };
  if (command) step.command = command;
  return step;
}

function chooseCoordinationMode(
  action: AgentFailureRecoveryAction,
  userActionRequired: boolean,
  complexity: AgentFailureRecoveryComplexityAssessment,
): AgentFailureRecoveryCoordinationMode {
  if (userActionRequired || action === 'request_user_action') return 'user_unblock';
  if (complexity.requiresDecomposition) return 'decompose_then_recover';
  if (complexity.level === 'multi_step') return 'checkpointed_recovery';
  return 'direct_repair';
}

function buildRecoveryRunbook(
  input: AgentFailureRecoveryInput,
  assessment: AgentFailureAssessment,
  action: AgentFailureRecoveryAction,
  autoFixAllowed: boolean,
  retryLimit: number,
  complexity: AgentFailureRecoveryComplexityAssessment,
): AgentFailureRecoveryRunbook {
  const userActionRequired = assessment.userActionRequired || action === 'request_user_action';
  const nextActor = chooseRunbookNextActor(action, autoFixAllowed, userActionRequired);
  const coordinationMode = chooseCoordinationMode(action, userActionRequired, complexity);
  const steps: AgentFailureRecoveryRunbookStep[] = [
    buildRecoveryRunbookStep(
      'capture-failure',
      'inspect',
      'Capture the failed surface',
      `Preserve the raw ${clean(input.source || input.executionKind || 'chat')} failure, class ${assessment.failureClass}, run id ${clean(input.runId || 'none', 120)}, and the user task before changing anything.`,
    ),
  ];

  if (complexity.level !== 'single_step') {
    steps.push(buildRecoveryRunbookStep(
      'map-surfaces',
      'decompose',
      'Map involved surfaces',
      `Split the failed task by surface before repairing: ${complexity.surfaces.slice(0, 8).join(', ') || 'unknown'}.`,
    ));
  }
  if (complexity.requiresDecomposition) {
    steps.push(
      buildRecoveryRunbookStep('decompose-complex-task', 'decompose', 'Decompose the complex task', 'Break the original request into independently verifiable subtasks with one owner surface each before retrying or patching.'),
      buildRecoveryRunbookStep('establish-checkpoints', 'checkpoint', 'Establish recovery checkpoints', 'Record the last known good state, the next subtask boundary, and the rollback/stop condition before any side-effect action.'),
    );
  }

  if (action === 'patch_app_code') {
    steps.push(
      buildRecoveryRunbookStep('inspect-owner', 'inspect', 'Inspect the owning modules', 'Read the roadmap ownership entry and the failing route/runtime/test before editing.'),
      buildRecoveryRunbookStep('apply-small-patch', 'patch', 'Apply the smallest compatible patch', 'Patch only the failing app/runtime/migration path; preserve unrelated local work and public contracts.'),
      buildRecoveryRunbookStep('verify-patch', 'verify', 'Run targeted verification', 'Run the narrowest smoke that covers the failing path, then run typecheck and diff whitespace checks.'),
    );
  } else if (action === 'restart_or_update_bridge') {
    steps.push(
      buildRecoveryRunbookStep('compare-bridge-contract', 'inspect', 'Compare app and bridge contracts', 'Check the requested endpoint/header/tool against the local bridge implementation and advertised health routes.'),
      userActionRequired
        ? buildRecoveryRunbookStep('ask-reconnect-bridge', 'ask_user', 'Ask for bridge restart or permission', 'Tell the user the exact bridge, browser, or macOS permission action needed before retrying.')
        : buildRecoveryRunbookStep('patch-bridge-contract', 'patch', 'Patch the bridge mismatch', 'Update the bridge/app route or header compatibility instead of repeatedly retrying a stale bridge.'),
      buildRecoveryRunbookStep('verify-bridge', 'verify', 'Verify bridge health', 'Run the relevant bridge/runtime smoke and confirm the health probe or endpoint is reachable.'),
    );
  } else if (action === 'retry_with_grounding') {
    if (userActionRequired) {
      steps.push(buildRecoveryRunbookStep('ask-target-confirmation', 'ask_user', 'Ask for the missing target or permission', 'Get the exact path, UI target, browser session, or local permission before retrying.'));
    }
    steps.push(
      buildRecoveryRunbookStep('refresh-grounding', 'inspect', 'Refresh grounding', 'Collect fresh DOM, accessibility tree, screenshot, file stat/search, or runtime state before another side-effect action.'),
      buildRecoveryRunbookStep('retry-once-bounded', 'retry', 'Retry with bounded attempts', `Retry no more than ${retryLimit} time${retryLimit === 1 ? '' : 's'}; switch to blocked recovery if the same failure repeats.`),
      buildRecoveryRunbookStep('verify-state', 'verify', 'Verify resulting state', 'Confirm the intended UI/file/browser/app state changed before reporting success.'),
    );
  } else if (action === 'switch_route_or_model') {
    steps.push(
      buildRecoveryRunbookStep('inspect-capability-gap', 'inspect', 'Inspect capability mismatch', 'Identify the missing tool/model capability and the current selected provider route.'),
      buildRecoveryRunbookStep('select-safe-route', 'retry', 'Select a compatible route', 'Switch only to a configured provider/model/bridge that supports the required tool mode and user-key policy.'),
      buildRecoveryRunbookStep('verify-route', 'verify', 'Verify routed execution', 'Run the provider/router smoke that covers the selected route.'),
    );
  } else if (action === 'request_user_action') {
    steps.push(
      buildRecoveryRunbookStep('explain-user-action', 'ask_user', 'Request exact user action', assessment.recommendedRecovery),
      buildRecoveryRunbookStep('wait-for-confirmation', 'stop', 'Stop until confirmed', 'Do not retry or launch a connected repair agent until the user confirms the required action is done.'),
    );
  } else {
    steps.push(
      buildRecoveryRunbookStep('diagnose-root-cause', 'inspect', 'Diagnose root cause', 'Trace the failing route enough to name the root cause and the smallest safe next step.'),
      buildRecoveryRunbookStep('produce-retry-plan', 'verify', 'Produce retry plan', 'Return an exact retry, patch, or user-action plan with evidence.'),
    );
  }

  const stopConditions = [
    'Stop if the next step needs credentials, CAPTCHA, MFA, OTP, budget approval, or a new user permission.',
    'Stop if the same failure fingerprint appears again after the allowed retry count.',
    'Stop before destructive git commands, permanent file deletion, or unrelated workspace cleanup.',
  ];
  if (complexity.requiresDecomposition) {
    stopConditions.push('Stop if the task cannot be split into independently verifiable subtasks.');
  }
  if (isHumanTakeoverFailure(assessment.failureClass)) {
    stopConditions.unshift('Never bypass CAPTCHA, MFA, OTP, or human-verification challenges.');
  }

  return {
    action,
    nextActor,
    complexity,
    coordinationMode,
    maxAttempts: Math.max(0, retryLimit),
    autoFixAllowed,
    userActionRequired,
    steps,
    stopConditions,
  };
}

function formatRunbookForPrompt(runbook: AgentFailureRecoveryRunbook): string[] {
  return [
    `- next actor: ${runbook.nextActor}`,
    `- coordination mode: ${runbook.coordinationMode}`,
    `- complexity: ${runbook.complexity.level} (score ${runbook.complexity.score}; surfaces ${runbook.complexity.surfaces.join(', ') || 'unknown'})`,
    `- max attempts: ${runbook.maxAttempts}`,
    ...runbook.steps.map((step, index) => (
      `- step ${index + 1} [${step.kind}] ${step.title}: ${step.detail}${step.command ? ` Command: ${step.command}` : ''}`
    )),
    '- stop conditions:',
    ...runbook.stopConditions.map((condition) => `  - ${condition}`),
  ];
}

export function buildAgentFailureRecoveryPolicy(input: AgentFailureRecoveryInput): AgentFailureRecoveryPolicy {
  const failureText = [
    input.failureMessage,
    input.failureStack,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
  ].filter(Boolean).join('\n\n');
  const assessment = classifyAgentFailure(failureText);
  const action = chooseRecoveryAction(assessment);
  const autoFixAllowed = canAutoFix(action, assessment);
  const complexity = assessRecoveryComplexity(input, assessment);
  const guardrails = buildGuardrails(action);
  const verification = buildVerification(action, complexity);
  const retryLimit = action === 'retry_with_grounding' ? 2 : action === 'request_user_action' ? 0 : 1;
  const runbook = buildRecoveryRunbook(input, assessment, action, autoFixAllowed, retryLimit, complexity);
  const basePrompt = [
    'You are Codex connected to The Underground Circle app as the failure-recovery agent.',
    'Your job is to diagnose why the user-requested chat/computer/browser/app task failed and either fix the app/runtime issue or produce the exact safe recovery step.',
    '',
    `Original task: ${clean(input.task, 2_000)}`,
    `Outcome status: ${clean(input.outcomeStatus || 'failed', 200)}`,
    `Execution kind: ${clean(input.executionKind || 'unknown', 200)}`,
    input.runId ? `Run id: ${input.runId}` : '',
    input.source ? `Failure source: ${input.source}` : '',
    '',
    'Failure classification:',
    `- class: ${assessment.failureClass}`,
    `- severity: ${assessment.severity}`,
    `- surface: ${assessment.surface}`,
    `- retryable: ${assessment.retryable}`,
    `- user action required: ${assessment.userActionRequired}`,
    `- recommended recovery: ${assessment.recommendedRecovery}`,
    `- selected recovery action: ${action}`,
    `- auto-fix allowed: ${autoFixAllowed}`,
    `- retry limit: ${retryLimit}`,
    `- complexity: ${complexity.level}`,
    `- coordination mode: ${runbook.coordinationMode}`,
    `- involved surfaces: ${complexity.surfaces.join(', ') || 'unknown'}`,
    '',
    input.preflightSummary ? `Preflight summary:\n${clean(input.preflightSummary)}` : '',
    input.groundingSummary ? `Grounding summary:\n${clean(input.groundingSummary)}` : '',
    input.planSummary ? `Plan summary:\n${clean(input.planSummary)}` : '',
    `Failure message:\n${clean(input.failureMessage)}`,
    input.failureStack ? `Failure stack:\n${clean(input.failureStack, 4_000)}` : '',
    '',
    'Guardrails:',
    ...guardrails.map((item) => `- ${item}`),
    '',
    'Recovery runbook:',
    ...formatRunbookForPrompt(runbook),
    '',
    'Verification contract:',
    ...verification.map((item) => `- ${item}`),
    '',
    'Output format:',
    '- ROOT_CAUSE: one concise paragraph.',
    '- FIX_APPLIED: yes/no and changed files, if any.',
    '- VERIFICATION: commands/tools run and pass/fail.',
    '- RETRY_NEXT: exact safe next step for OpenSwan/user.',
    '- RUNBOOK_STATUS: completed/blocked and the last runbook step reached.',
    '- CHECKPOINTS: for multi-step or complex tasks, list each subtask boundary and verification evidence.',
    '- BLOCKER: only if user action is required or auto-fix is unsafe.',
  ].filter(Boolean).join('\n');
  const prompt = applyAgentDevelopmentStandardsToPrompt(basePrompt, {
    taskDescription: [
      input.task,
      input.failureMessage,
      input.executionKind || '',
      'TypeScript app/runtime code failure recovery for browser desktop app automation.',
    ].filter(Boolean).join('\n'),
    label: 'The connected failure-recovery agent must follow these repo standards.',
  });

  return {
    assessment,
    action,
    autoFixAllowed,
    needsUserAction: assessment.userActionRequired || action === 'request_user_action',
    retryLimit,
    guardrails,
    verification,
    runbook,
    prompt,
  };
}

export function summarizeAgentFailureRecoveryPolicy(policy: AgentFailureRecoveryPolicy): string {
  return [
    `Failure recovery: ${policy.assessment.failureClass} on ${policy.assessment.surface}.`,
    `Action: ${policy.action}.`,
    `Next actor: ${policy.runbook.nextActor}.`,
    `Complexity: ${policy.runbook.complexity.level}.`,
    policy.autoFixAllowed ? 'Connected agent may diagnose/fix within guardrails.' : 'Connected agent should diagnose and request user action.',
    `Recovery: ${policy.assessment.recommendedRecovery}`,
  ].join(' ');
}

export function shouldLaunchConnectedAgentRecovery(policy: AgentFailureRecoveryPolicy): boolean {
  return policy.autoFixAllowed && !policy.needsUserAction;
}

export async function startConnectedAgentFailureRecovery(
  input: AgentFailureRecoveryInput,
): Promise<AgentFailureRecoveryStartResult> {
  const policy = buildAgentFailureRecoveryPolicy(input);
  if (!shouldLaunchConnectedAgentRecovery(policy)) {
    return {
      ok: false,
      provider: null,
      launched: false,
      recoveryAction: policy.action,
      assessment: policy.assessment,
      runbook: policy.runbook,
      message: `Connected agent recovery not launched. ${summarizeAgentFailureRecoveryPolicy(policy)}`,
    };
  }
  try {
    // Provider-agnostic: hand recovery to whichever connected agent is
    // available (Codex / Claude Code / Gemini / Cursor), not just Codex.
    const { dispatchConnectedAgentTask } = await import('./connectedAgentDispatch');
    const dispatch = await dispatchConnectedAgentTask({
      prompt: policy.prompt,
      sessionName: 'Failure Recovery',
      sessionId: input.sessionId,
      launchIfMissing: input.launchIfMissing,
      circleId: input.circleId,
      userId: input.userId,
    });
    return {
      ok: dispatch.ok,
      provider: dispatch.provider,
      sessionId: dispatch.sessionId,
      launched: dispatch.launched,
      recoveryAction: policy.action,
      assessment: policy.assessment,
      runbook: policy.runbook,
      message: dispatch.ok
        ? `${dispatch.resultsText} ${summarizeAgentFailureRecoveryPolicy(policy)}`
        : dispatch.resultsText,
    };
  } catch (error: any) {
    return {
      ok: false,
      provider: null,
      recoveryAction: policy.action,
      assessment: policy.assessment,
      runbook: policy.runbook,
      message: error?.message || 'Failure recovery handoff failed.',
    };
  }
}
