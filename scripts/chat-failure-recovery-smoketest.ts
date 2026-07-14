/**
 * chat-failure-recovery-smoketest
 *
 * Locks the small helper that turns main-chat runtime failures into a bounded
 * connected-agent recovery handoff and a visible user-facing failure message.
 *
 * Run: npm run smoke:chat-failure-recovery
 */

import {
  buildChatFailureRecoveryArchive,
  buildChatFailureRecoveryFingerprint,
  buildChatFailureRecoveryInput,
  buildChatFailureRecoveryOptions,
  buildChatFailureRecoveryVerificationPlan,
  buildChatFailureRecoveryExecutionPlan,
  deriveChatFailureRecoveryExecutionPolicy,
  formatActiveChatBlockerContextForPrompt,
  formatCompletedChatTaskContextForPrompt,
  formatChatFailureRecoveryExecutionPlanForPrompt,
  formatChatFailureRecoveryOptionSelection,
  formatChatFailureRecoveryOptionSelectionForPrompt,
  formatChatFailureRecoveryUserMessage,
  formatChatFailureRecoveryDetail,
  parseChatFailureRecoveryOptionSelection,
  resolveChatFailureRecoveryOptionFollowup,
  shouldSuppressDuplicateChatFailureHandoff,
  startChatFailureRecovery,
  stripChatFailureRecoveryOptionsText,
  summarizeChatFailureRecoveryOptionForArchive,
  type ChatFailureRecoveryOption,
} from '../src/lib/chatFailureRecovery';
import {
  buildAgentFailureRecoveryPolicy,
  type AgentFailureRecoveryStartResult,
} from '../src/lib/agentFailureRecovery';
import {
  buildChatRecoveryActionIntent,
  formatChatRecoveryActionDisplayText,
} from '../src/lib/chatRecoveryActionIntent';
import type { ComputerTaskCheckpointRecoveryContext } from '../src/lib/computerTaskCheckpointRecovery';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  const checkpointRecovery: ComputerTaskCheckpointRecoveryContext = {
    level: 'complex',
    complexityScore: 9,
    failedCheckpointId: 'observe-desktop',
    failedCheckpointLabel: 'Observe desktop/app state',
    surface: 'desktop',
    requiresApproval: false,
    confidence: 'high',
    reason: 'The desktop accessibility tree was unavailable before an app action.',
    safeNextStep: 'Refresh app/window focus, accessibility, and screenshot state before retrying.',
    remainingCheckpointIds: ['execute-in-small-steps', 'final-proof', 'bounded-recovery'],
    retryPolicy: {
      failureFingerprint: 'checkpoint:observe-desktop:smoke',
      repeatCount: 1,
      retryLimit: 1,
      canRetry: true,
      nextAction: 'Refresh app/window focus, accessibility, and screenshot state before retrying.',
      stopReason: null,
      requiredEvidence: [
        {
          id: 'desktop-a11y',
          tool: 'desktop.read_a11y_tree',
          summary: 'Ground desktop actions in accessibility state.',
          freshnessMs: 15000,
          required: true,
        },
        {
          id: 'desktop-screenshot',
          tool: 'desktop.screenshot',
          summary: 'Capture screenshot proof before retrying.',
          freshnessMs: 5000,
          required: true,
        },
      ],
      forbiddenActions: ['No keyboard, mouse, menu, coordinate, canvas, CAD, or document action until window, a11y, and screenshot evidence are fresh.'],
      resumeInstruction: 'Collect fresh evidence, then retry only checkpoint "observe-desktop" once. Stop on the same failure fingerprint.',
    },
  };

  const agentInput = buildChatFailureRecoveryInput({
    task: 'Create a room and add the launch tasks',
    failureMessage: 'new row for relation "messages" violates check constraint "messages_content_check"',
    executionKind: 'run_openswan',
    source: 'main_chat_openswan_batch',
    selectedModel: 'claude-haiku-4-5',
    activePluginIds: ['github', 'browser'],
    checkpointRecovery,
    circleId: 'circle-1',
    userId: 'user-1',
  });

  assert(agentInput.task === 'Create a room and add the launch tasks', 'agent input preserves task');
  assert(agentInput.executionKind === 'run_openswan', 'agent input preserves execution kind');
  assert(agentInput.source === 'main_chat_openswan_batch', 'agent input preserves source');
  assert(agentInput.planSummary?.includes('Selected chat model: claude-haiku-4-5'), 'agent input includes selected model context');
  assert(agentInput.planSummary?.includes('Active plugins: github, browser'), 'agent input includes active plugin context');
  assert(agentInput.planSummary?.includes('failed checkpoint: observe-desktop'), 'agent input includes checkpoint recovery context');
  assert(agentInput.planSummary?.includes('required fresh evidence'), 'agent input includes checkpoint evidence requirements');
  assert(agentInput.planSummary?.includes('desktop.read_a11y_tree'), 'agent input includes desktop evidence tool');
  assert(agentInput.planSummary?.includes('Suggested verification commands:'), 'agent input includes verification command plan');
  assert(agentInput.planSummary?.includes('npm run smoke:openswan-task-planner'), 'agent input includes OpenSwan verification smoke');
  assert(agentInput.planSummary?.includes('npm run typecheck'), 'agent input includes typecheck verification');

  const browserPlan = buildChatFailureRecoveryVerificationPlan({
    task: 'Click the submit button',
    failureMessage: 'Browser bridge offline while running computer use task.',
    executionKind: 'browser_computer_use',
    source: 'computer_use_agent_error',
    checkpointRecovery,
  });
  assert(browserPlan.commands.includes('npm run smoke:browser-bridge'), 'browser verification includes browser bridge smoke');
  assert(browserPlan.commands.includes('npm run smoke:computer-task-runtime'), 'browser verification includes computer task runtime smoke');
  assert(browserPlan.commands.includes('npm run smoke:computer-task-complexity'), 'checkpoint recovery verification includes complexity smoke');
  assert(browserPlan.checks.some((check) => check.includes('failed computer-task checkpoint')), 'checkpoint recovery verification includes checkpoint check');
  const inferredEvidencePlan = buildChatFailureRecoveryVerificationPlan({
    task: 'Open Photoshop and update the headline text layer, then export a proof png',
    failureMessage: 'Photoshop layer inventory was missing before the text mutation.',
    executionKind: 'run_computer_task',
    source: 'computer_task_outcome',
  });
  assert(inferredEvidencePlan.commands.includes('npm run smoke:computer-task-evidence-recovery'), 'computer task recovery infers evidence contract from task text');
  assert(inferredEvidencePlan.checks.some((check) => /route evidence contract/i.test(check)), 'inferred evidence recovery includes route evidence check');
  const vagueBrowserEvidencePlan = buildChatFailureRecoveryVerificationPlan({
    task: 'Click the submit button',
    failureMessage: 'Locator timed out before the submit button passed actionability checks.',
    executionKind: 'browser_computer_use',
    source: 'computer_use_agent_error',
  });
  assert(vagueBrowserEvidencePlan.commands.includes('npm run smoke:computer-task-evidence-recovery'), 'vague browser computer-use failure infers evidence contract from source context');
  const vagueDesktopEvidencePlan = buildChatFailureRecoveryVerificationPlan({
    task: 'Click the save button',
    failureMessage: 'Desktop app window was unavailable before the save action.',
    executionKind: 'run_computer_task',
    source: 'desktop_app_adapter_error',
    preflightSummary: 'Desktop app task failed in the app adapter with missing window state.',
  });
  assert(vagueDesktopEvidencePlan.commands.includes('npm run smoke:desktop-runtime-wiring'), 'vague desktop app failure prioritizes desktop runtime verification');
  assert(vagueDesktopEvidencePlan.commands.includes('npm run smoke:computer-app-preflight'), 'vague desktop app failure verifies app preflight blockers');
  assert(!vagueDesktopEvidencePlan.commands.includes('npm run smoke:browser-bridge'), 'vague desktop app failure does not route verification through browser bridge');
  assert(!vagueDesktopEvidencePlan.commands.includes('npm run smoke:agent-pipeline-evals'), 'single-surface desktop app recovery is not treated as complex pipeline recovery');
  const vagueLocalFileEvidencePlan = buildChatFailureRecoveryVerificationPlan({
    task: 'Find the invoice',
    failureMessage: 'File adapter could not resolve a scoped path before reading.',
    executionKind: 'run_computer_task',
    source: 'file_adapter_error',
    preflightSummary: 'Local file adapter failed before file search.',
  });
  assert(vagueLocalFileEvidencePlan.commands.includes('npm run smoke:computer-task-runtime'), 'vague local-file failure keeps computer task runtime verification');
  assert(vagueLocalFileEvidencePlan.commands.includes('npm run smoke:computer-grant-gate'), 'vague local-file failure verifies scoped grant gates');
  assert(vagueLocalFileEvidencePlan.commands.includes('npm run smoke:chat-desktop-attachment-routing'), 'vague local-file failure verifies attachment/file routing');
  assert(!vagueLocalFileEvidencePlan.commands.includes('npm run smoke:browser-bridge'), 'vague local-file failure does not route verification through browser bridge');

  const complexPlan = buildChatFailureRecoveryVerificationPlan({
    task: 'Research in browser, update desktop file, save memory, schedule follow-up, then verify',
    failureMessage: 'Complex workflow failed after provider fallback and desktop bridge checkpoint.',
    executionKind: 'run_openswan',
    source: 'multi_agent_complex_task',
    planSummary: 'complexity: complex; surfaces: browser, desktop, provider, memory, schedule; phase 3 failed',
  });
  assert(complexPlan.commands.includes('npm run smoke:agent-pipeline-evals'), 'complex verification includes agent pipeline evals');
  assert(complexPlan.commands.includes('npm run typecheck'), 'complex verification preserves typecheck despite command cap');
  assert(complexPlan.commands.includes('git diff --check'), 'complex verification preserves diff check despite command cap');
  assert(complexPlan.checks.some((check) => check.includes('independently verifiable subtasks')), 'complex verification asks for subtask checkpoint evidence');

  const fakePolicy = buildAgentFailureRecoveryPolicy({
    task: agentInput.task,
    failureMessage: agentInput.failureMessage,
    executionKind: agentInput.executionKind,
    source: agentInput.source,
  });
  const fakeRecovery: AgentFailureRecoveryStartResult = {
    ok: true,
    provider: 'codex',
    launched: true,
    recoveryAction: 'patch_app_code',
    assessment: {
      failureClass: 'constraint_violation',
      severity: 'error',
      surface: 'integration_api',
      retryable: false,
      userActionRequired: false,
      recommendedRecovery: 'Patch the database write path or migration so app payloads match constraints.',
      signals: ['constraint'],
    },
    runbook: fakePolicy.runbook,
    message: 'Launched Codex failure recovery.',
  };
  const userMessage = formatChatFailureRecoveryUserMessage({
    task: agentInput.task,
    failureMessage: agentInput.failureMessage,
    checkpointRecovery,
  }, fakeRecovery);
  const detailMessage = formatChatFailureRecoveryDetail({
    task: agentInput.task,
    failureMessage: agentInput.failureMessage,
    checkpointRecovery,
  }, fakeRecovery);
  const recoveryOptions = buildChatFailureRecoveryOptions({
    task: agentInput.task,
    failureMessage: agentInput.failureMessage,
    checkpointRecovery,
  }, fakeRecovery);
  // Chat bubble is TERSE: a one-line reason + the recovery status, no diagnosis dump.
  assert(userMessage.startsWith("Couldn't finish:"), 'terse chat message leads with a one-line reason');
  assert(userMessage.includes('Launched Codex failure recovery.'), 'terse message reports the delegated recovery');
  assert(!userMessage.includes('Failed checkpoint:') && !userMessage.includes('Classified as'), 'terse message omits the internal diagnosis dump');
  assert(userMessage.split('\n').length <= 3, 'terse message is at most a couple of lines');
  // The full breakdown is preserved on the detail formatter (archive/debug).
  assert(detailMessage.includes('The chat task failed:'), 'detail message includes visible failure context');
  assert(detailMessage.includes('Connected agent recovery started'), 'detail message reports delegated recovery');
  assert(detailMessage.includes('constraint_violation'), 'detail message includes failure class');
  assert(detailMessage.includes('Next actor: `connected_agent`'), 'detail message includes runbook next actor');
  assert(detailMessage.includes('Next step:'), 'detail message includes actionable runbook step');
  assert(detailMessage.includes('Failed checkpoint: `observe-desktop`'), 'detail message includes failed checkpoint');
  assert(detailMessage.includes('Options:'), 'detail message includes recovery options');
  assert(detailMessage.includes('Retry after fresh evidence'), 'detail message includes fresh-evidence retry option');
  assert(detailMessage.includes('Let codex repair it'), 'detail message includes connected-agent repair option');
  const inferredEvidenceAgentInput = buildChatFailureRecoveryInput({
    task: 'Open Photoshop and update the headline text layer, then export a proof png',
    failureMessage: 'Photoshop layer inventory was missing before the text mutation.',
    executionKind: 'run_computer_task',
    source: 'computer_task_outcome',
  });
  assert(inferredEvidenceAgentInput.planSummary?.includes('Computer task evidence recovery:'), 'agent input infers evidence recovery without explicit contract');
  assert(inferredEvidenceAgentInput.planSummary?.includes('app route decision: needs_observation'), 'inferred evidence recovery preserves app route decision');
  const vagueBrowserAgentInput = buildChatFailureRecoveryInput({
    task: 'Click the submit button',
    failureMessage: 'Locator timed out before the submit button passed actionability checks.',
    executionKind: 'browser_computer_use',
    source: 'computer_use_agent_error',
  });
  assert(vagueBrowserAgentInput.planSummary?.includes('Computer task evidence recovery:'), 'vague browser recovery infers evidence context');
  assert(vagueBrowserAgentInput.planSummary?.includes('browser.locator_actionability'), 'vague browser recovery requires locator actionability evidence');
  const vagueDesktopAgentInput = buildChatFailureRecoveryInput({
    task: 'Click the save button',
    failureMessage: 'Desktop app window was unavailable before the save action.',
    executionKind: 'run_computer_task',
    source: 'desktop_app_adapter_error',
    preflightSummary: 'Desktop app task failed in the app adapter with missing window state.',
  });
  assert(vagueDesktopAgentInput.planSummary?.includes('Computer task evidence recovery:'), 'vague desktop recovery infers evidence context');
  assert(vagueDesktopAgentInput.planSummary?.includes('desktop.window_state'), 'vague desktop recovery requires window state evidence');
  assert(vagueDesktopAgentInput.planSummary?.includes('app route decision: needs_observation'), 'vague desktop recovery preserves app route observation state');
  assert(!vagueDesktopAgentInput.planSummary?.includes('npm run smoke:browser-bridge'), 'vague desktop recovery does not suggest browser verification');
  const vagueLocalFileAgentInput = buildChatFailureRecoveryInput({
    task: 'Find the invoice',
    failureMessage: 'File adapter could not resolve a scoped path before reading.',
    executionKind: 'run_computer_task',
    source: 'file_adapter_error',
    preflightSummary: 'Local file adapter failed before file search.',
  });
  assert(vagueLocalFileAgentInput.planSummary?.includes('Computer task evidence recovery:'), 'vague local-file recovery infers evidence context');
  assert(vagueLocalFileAgentInput.planSummary?.includes('desktop.file_search'), 'vague local-file recovery requires file search evidence');
  assert(vagueLocalFileAgentInput.planSummary?.includes('npm run smoke:computer-grant-gate'), 'vague local-file recovery suggests grant gate verification');
  assert(!vagueLocalFileAgentInput.planSummary?.includes('npm run smoke:browser-bridge'), 'vague local-file recovery does not suggest browser verification');
  const inferredEvidenceOptions = buildChatFailureRecoveryOptions({
    task: 'Open Photoshop and update the headline text layer, then export a proof png',
    failureMessage: 'Photoshop layer inventory was missing before the text mutation.',
    executionKind: 'run_computer_task',
    source: 'computer_task_outcome',
  }, fakeRecovery);
  assert(inferredEvidenceOptions.some((option) => option.source === 'evidence_contract'), 'inferred evidence recovery produces evidence-contract options');
  const cardOnlyVisibleMessage = stripChatFailureRecoveryOptionsText(detailMessage);
  assert(!cardOnlyVisibleMessage.includes('Options:'), 'card renderer can strip duplicate recovery option text');
  assert(cardOnlyVisibleMessage.includes('The chat task failed:'), 'stripped recovery message keeps failure context');
  assert(cardOnlyVisibleMessage.includes('Failed checkpoint: `observe-desktop`'), 'stripped recovery message keeps checkpoint context');
  assert(recoveryOptions.some((option) => option.id === 'retry_with_fresh_evidence' && option.actor === 'openswan'), 'options include openswan retry with evidence');
  assert(recoveryOptions.some((option) => option.id === 'let_connected_agent_repair' && option.actor === 'connected_agent'), 'options include connected agent repair');
  const legacyEvidenceOptions = buildChatFailureRecoveryOptions({
    task: 'Retry desktop click after selector timeout',
    failureMessage: 'Selector timed out before the retry could collect fresh evidence.',
    evidenceRecovery: {
      schemaVersion: 1,
      targetName: 'Desktop bridge',
      kind: 'desktop',
      taskFamily: 'desktop',
      failureArea: 'actionability',
      retryAllowed: true,
      userActionRequired: false,
      connectedAgentAllowed: false,
      recommendedOptionId: 'retry_with_fresh_evidence',
      resumeInstruction: 'Refresh the desktop evidence before retrying.',
    } as any,
  }, fakeRecovery);
  assert(legacyEvidenceOptions.some((option) => option.id === 'retry_with_fresh_evidence'), 'legacy partial evidence recovery still builds retry option');
  assert(legacyEvidenceOptions.some((option) => option.detail.includes('Refresh the desktop evidence')), 'legacy partial evidence recovery falls back to resume instruction');
  const legacyEvidenceMessage = formatChatFailureRecoveryUserMessage({
    task: 'Retry desktop click after selector timeout',
    failureMessage: 'Selector timed out before the retry could collect fresh evidence.',
    evidenceRecovery: {
      schemaVersion: 1,
      targetName: 'Desktop bridge',
      kind: 'desktop',
      taskFamily: 'desktop',
      failureArea: 'actionability',
      retryAllowed: true,
      userActionRequired: false,
      connectedAgentAllowed: false,
      recommendedOptionId: 'retry_with_fresh_evidence',
      resumeInstruction: 'Refresh the desktop evidence before retrying.',
    } as any,
  }, fakeRecovery);
  assert(!legacyEvidenceMessage.includes('undefined'), 'legacy partial evidence recovery message avoids undefined fields');
  const recommendedFollowup = resolveChatFailureRecoveryOptionFollowup('use the recommended option', recoveryOptions);
  assert(recommendedFollowup?.option.id === recoveryOptions.find((option) => option.recommended)?.id, 'natural follow-up selects recommended recovery option');
  const numberedFollowup = resolveChatFailureRecoveryOptionFollowup('try option 2', recoveryOptions);
  assert(numberedFollowup?.option.id === recoveryOptions[1]?.id, 'natural follow-up selects numbered recovery option');
  const evidenceFollowup = resolveChatFailureRecoveryOptionFollowup('retry after fresh evidence', recoveryOptions);
  assert(evidenceFollowup?.option.id === 'retry_with_fresh_evidence', 'natural follow-up selects fresh-evidence retry option');
  const repairFollowup = resolveChatFailureRecoveryOptionFollowup('let codex repair the runtime', recoveryOptions);
  assert(repairFollowup?.option.id === 'let_connected_agent_repair', 'natural follow-up selects connected-agent repair option');
  assert(!resolveChatFailureRecoveryOptionFollowup('what model did you use?', recoveryOptions), 'natural follow-up ignores unrelated chat');
  const contractBlockerOptions: ChatFailureRecoveryOption[] = [
    { id: 'resolve_contract_blocker', label: 'Resolve the contract blocker', detail: 'Stop automation and follow the app route decision.', actor: 'user', recommended: true, source: 'evidence_contract' },
    { id: 'user_unblock', label: 'I will unblock it', detail: 'Ask the user to unblock the task before any automated retry.', actor: 'user', recommended: false, source: 'evidence_contract' },
  ];
  const exactLabelFollowup = resolveChatFailureRecoveryOptionFollowup('Resolve the contract blocker', contractBlockerOptions);
  assert(exactLabelFollowup?.option.id === 'resolve_contract_blocker', 'retyping an option label with no generic keywords still resolves that option');
  const selectedOptionText = formatChatFailureRecoveryOptionSelection(recoveryOptions[0], {
    messageId: 'bot-failure-1',
    runId: 'run-1',
    sourceSurface: 'main_chat_computer_task',
    failureExcerpt: 'Use Computer failed because the desktop screenshot was stale before the retry.',
  });
  const selectedOption = parseChatFailureRecoveryOptionSelection(selectedOptionText);
  assert(selectedOption?.optionId === recoveryOptions[0].id, 'recovery option selection preserves option id');
  assert(selectedOption?.actor === recoveryOptions[0].actor, 'recovery option selection preserves actor');
  assert(selectedOption?.source === recoveryOptions[0].source, 'recovery option selection preserves source');
  assert(selectedOption?.detail.includes(recoveryOptions[0].detail.slice(0, 40)), 'recovery option selection preserves detail');
  assert(selectedOption?.context?.messageId === 'bot-failure-1', 'recovery option selection preserves failed message id');
  assert(selectedOption?.context?.runId === 'run-1', 'recovery option selection preserves run id');
  assert(selectedOption?.context?.sourceSurface === 'main_chat_computer_task', 'recovery option selection preserves source surface');
  assert(selectedOption?.context?.failureExcerpt?.includes('desktop screenshot was stale'), 'recovery option selection preserves failure excerpt');
  const selectedOptionPrompt = formatChatFailureRecoveryOptionSelectionForPrompt(selectedOption);
  assert(selectedOptionPrompt.includes('## Selected Failure Recovery Option'), 'selected recovery prompt has explicit recovery heading');
  assert(selectedOptionPrompt.includes('failed_message_id: bot-failure-1'), 'selected recovery prompt includes failed message id');
  assert(selectedOptionPrompt.includes('run_id: run-1'), 'selected recovery prompt includes run id');
  assert(selectedOptionPrompt.includes('recovery_action: retry_with_fresh_evidence'), 'selected recovery prompt includes typed recovery action');
  assert(selectedOptionPrompt.includes('requires_fresh_evidence: yes'), 'selected recovery prompt includes fresh-evidence policy');
  assert(selectedOptionPrompt.includes('allow_browser_desktop_retry: yes'), 'selected recovery prompt includes bounded retry permission');
  assert(selectedOptionPrompt.includes('recovery_user_summary:'), 'selected recovery prompt includes user-safe execution summary');
  assert(selectedOptionPrompt.includes('recovery_step_1:'), 'selected recovery prompt includes explicit recovery step');
  assert(selectedOptionPrompt.includes('recovery_stop_1:'), 'selected recovery prompt includes stop condition');
  assert(selectedOptionPrompt.includes('do not repeat blind browser/desktop actions'), 'selected recovery prompt includes safe retry rule');
  const selectedPolicy = deriveChatFailureRecoveryExecutionPolicy(selectedOption);
  assert(selectedPolicy.action === 'retry_with_fresh_evidence', 'selected recovery policy derives fresh-evidence retry action');
  assert(selectedPolicy.requiresApproval === true, 'selected recovery policy requires approval for automated retry');
  assert(selectedPolicy.requiresFreshEvidence === true, 'selected recovery policy requires fresh evidence');
  assert(selectedPolicy.allowConnectedAgent === false, 'selected recovery policy does not silently allow connected-agent repair');
  assert(selectedPolicy.allowBrowserDesktopRetry === true, 'selected recovery policy allows only bounded browser/desktop retry');
  assert(selectedPolicy.maxAttempts === 1, 'selected recovery policy caps retry attempts');
  const selectedExecutionPlan = buildChatFailureRecoveryExecutionPlan(selectedOption);
  assert(selectedExecutionPlan.userSummary.includes('fresh evidence'), 'selected recovery execution plan summarizes fresh evidence');
  assert(selectedExecutionPlan.nextSteps.some((step) => step.includes('Retry only')), 'selected recovery execution plan includes bounded retry step');
  assert(selectedExecutionPlan.stopConditions.some((condition) => condition.includes('missing or stale')), 'selected recovery execution plan includes stale-evidence stop condition');
  if (selectedOption) {
    const selectedAction = buildChatRecoveryActionIntent(selectedOption, { platform: 'web' });
    const selectedDisplay = formatChatRecoveryActionDisplayText(selectedOption, selectedAction);
    assert(selectedAction.kind === 'run_recovery', 'selected recovery action intent accepts parsed selections');
    assert(selectedDisplay.startsWith('Run recovery:'), 'selected recovery display accepts parsed selections');
    assert(!selectedDisplay.includes('failed_message_id'), 'selected recovery display hides parsed selection context');
  }
  const selectedExecutionPlanPrompt = formatChatFailureRecoveryExecutionPlanForPrompt(selectedExecutionPlan);
  assert(selectedExecutionPlanPrompt.includes('recovery_hidden_rule_1'), 'selected recovery execution plan formats hidden rule for prompt');
  const archiveOptionSummary = summarizeChatFailureRecoveryOptionForArchive(recoveryOptions[0]);
  assert(archiveOptionSummary.includes('fresh evidence'), 'recovery option archive summary includes fresh-evidence policy');
  assert(archiveOptionSummary.includes('1 try'), 'recovery option archive summary includes retry cap');
  assert(archiveOptionSummary.length <= 360, 'recovery option archive summary is bounded');
  const stopOption = {
    id: 'stop_and_report',
    label: 'Stop and show details',
    detail: 'Do not retry.',
    actor: 'none',
    source: 'safety_stop',
    recommended: false,
  } as const;
  const stopPolicy = deriveChatFailureRecoveryExecutionPolicy(stopOption);
  assert(stopPolicy.action === 'stop_and_report', 'stop option derives stop action');
  assert(stopPolicy.requiresApproval === false, 'stop option does not require approval');
  assert(stopPolicy.allowBrowserDesktopRetry === false, 'stop option forbids browser/desktop retry');
  assert(stopPolicy.allowRuntimePatch === false, 'stop option forbids runtime patching');
  const stopPlan = buildChatFailureRecoveryExecutionPlan({
    optionId: stopOption.id,
    label: 'Stop and show details',
    detail: 'Do not retry.',
    actor: 'none',
    source: 'safety_stop',
    recommended: false,
  });
  assert(stopPlan.userSummary.includes('Stop'), 'stop option execution plan stays diagnostic');
  assert(stopPlan.nextSteps.some((step) => step.includes('Do not retry')), 'stop option execution plan forbids retry');
  const userBridgeOption = {
    id: 'repair_or_restart_bridge',
    label: 'Repair the bridge path',
    detail: 'Restart the local bridge.',
    actor: 'user',
    source: 'recovery_policy',
    recommended: true,
  } as const;
  const userBridgePolicy = deriveChatFailureRecoveryExecutionPolicy(userBridgeOption);
  assert(userBridgePolicy.action === 'repair_or_restart_bridge', 'user bridge repair keeps bridge-specific action');
  assert(userBridgePolicy.userActionRequired === true, 'user bridge repair requires user action');
  assert(userBridgePolicy.allowConnectedAgent === false, 'user bridge repair does not launch connected agent');
  const freshEvidenceAction = buildChatRecoveryActionIntent(recoveryOptions[0], { sourceSurface: 'main_chat_computer_task', platform: 'web' });
  assert(freshEvidenceAction.kind === 'run_recovery', 'recovery action intent auto-runs fresh evidence retry');
  assert(freshEvidenceAction.label === 'RUN', 'recovery action intent labels fresh evidence as run');
  assert(freshEvidenceAction.autoSendsPrompt === true, 'recovery action intent sends runnable recovery prompt');
  const freshEvidenceDisplay = formatChatRecoveryActionDisplayText(recoveryOptions[0], freshEvidenceAction);
  assert(freshEvidenceDisplay.startsWith('Run recovery:'), 'recovery action display hides structured recovery prompt');
  assert(!freshEvidenceDisplay.includes('## Selected Failure Recovery Option'), 'recovery action display is user-safe');
  const longFreshEvidenceDisplay = formatChatRecoveryActionDisplayText({
    ...recoveryOptions[0],
    label: `Retry with fresh evidence ${'and verify the desktop/browser state '.repeat(10)}`,
  }, freshEvidenceAction);
  assert(longFreshEvidenceDisplay.length <= 160, 'recovery action display is bounded for chat history');
  assert(longFreshEvidenceDisplay.endsWith('...'), 'recovery action display truncates oversized labels predictably');
  const connectedRepairOption = recoveryOptions.find((option) => option.id === 'let_connected_agent_repair');
  const connectedRepairAction = connectedRepairOption
    ? buildChatRecoveryActionIntent(connectedRepairOption, { sourceSurface: 'main_chat_computer_task', platform: 'web' })
    : null;
  assert(connectedRepairAction?.kind === 'run_recovery', 'recovery action intent auto-runs connected-agent repair');
  assert(connectedRepairAction?.label === 'REPAIR', 'recovery action intent labels connected-agent repair clearly');
  if (connectedRepairOption && connectedRepairAction) {
    assert(formatChatRecoveryActionDisplayText(connectedRepairOption, connectedRepairAction).startsWith('Repair this with a connected agent:'), 'recovery action display names connected-agent repair');
  }
  const bridgeCardAction = buildChatRecoveryActionIntent(userBridgeOption, { sourceSurface: 'desktop_bridge_status_chip', platform: 'web' });
  assert(bridgeCardAction.kind === 'connect_desktop_bridge', 'recovery action intent directly repairs desktop bridge from chip');
  assert(bridgeCardAction.label === 'START', 'recovery action intent labels bridge repair as start');
  const bridgeChatAction = buildChatRecoveryActionIntent(userBridgeOption, { sourceSurface: 'main_chat_desktop_bridge', platform: 'web' });
  assert(bridgeChatAction.kind === 'connect_desktop_bridge', 'recovery action intent directly repairs desktop bridge from bridge chat messages');
  const bridgePromptAction = buildChatRecoveryActionIntent(userBridgeOption, { sourceSurface: 'main_chat', platform: 'web' });
  assert(bridgePromptAction.kind === 'show_user_step', 'recovery action intent keeps generic bridge repair as user step');
  const stopAction = buildChatRecoveryActionIntent(stopOption, { sourceSurface: 'main_chat', platform: 'web' });
  assert(stopAction.kind === 'show_details', 'recovery action intent keeps stop option diagnostic');
  assert(stopAction.autoSendsPrompt === false, 'recovery action intent does not auto-send stop option');

  const archive = buildChatFailureRecoveryArchive({
    task: agentInput.task,
    failureMessage: agentInput.failureMessage,
    executionKind: agentInput.executionKind,
    source: agentInput.source,
    runId: 'run-1',
    checkpointRecovery,
  }, fakeRecovery);
  assert(archive.archiveSummary.includes('delegated'), 'archive summary records delegated recovery');
  assert(archive.archiveTouched.includes('surface:main_chat'), 'archive touched includes main chat surface');
  assert(archive.archiveTouched.includes('surface:failure_recovery'), 'archive touched includes recovery surface');
  assert(archive.archiveMetadata.failureClass === 'constraint_violation', 'archive metadata includes failure class');
  assert(archive.archiveMetadata.runId === 'run-1', 'archive metadata includes run id');
  assert(typeof archive.archiveMetadata.recoveryRunbook === 'object', 'archive metadata includes machine-readable runbook');
  assert(typeof archive.archiveMetadata.recoveryComplexity === 'object', 'archive metadata includes recovery complexity');
  assert(typeof archive.archiveMetadata.coordinationMode === 'string', 'archive metadata includes coordination mode');
  assert((archive.archiveMetadata.checkpointRecovery as any)?.failedCheckpointId === 'observe-desktop', 'archive metadata includes checkpoint recovery context');
  assert(Array.isArray(archive.archiveMetadata.recoveryOptions), 'archive metadata includes recovery options');
  assert(Array.isArray(archive.archiveMetadata.verificationCommands), 'archive metadata includes verification commands');
  assert(typeof archive.archiveMetadata.recoveryReliability === 'object', 'archive metadata includes recovery reliability summary');

  const vagueDesktopArchive = buildChatFailureRecoveryArchive({
    task: 'Click the save button',
    failureMessage: 'Desktop app window was unavailable before the save action.',
    executionKind: 'run_computer_task',
    source: 'desktop_app_adapter_error',
    preflightSummary: 'Desktop app task failed in the app adapter with missing window state.',
  }, fakeRecovery);
  const vagueDesktopReliability = vagueDesktopArchive.archiveMetadata.recoveryReliability as any;
  assert(vagueDesktopReliability?.surfaceKind === 'desktop_app', 'desktop archive reliability records surface kind');
  assert(vagueDesktopReliability?.failureArea === 'fresh_evidence', 'desktop archive reliability records failure area');
  assert(vagueDesktopReliability?.readinessStatus === 'missing', 'desktop archive reliability records readiness status');
  assert(vagueDesktopReliability?.nextEvidenceTools?.includes('desktop.window_state'), 'desktop archive reliability records next evidence tools');
  assert(vagueDesktopReliability?.verificationCommands?.includes('npm run smoke:desktop-runtime-wiring'), 'desktop archive reliability records surface verification commands');
  assert(vagueDesktopArchive.archiveTouched.includes('recovery_surface:desktop_app'), 'desktop archive touched includes recovery surface');
  assert(vagueDesktopArchive.archiveTouched.includes('recovery_tool:desktop.window_state'), 'desktop archive touched includes required evidence tool');
  assert(!vagueDesktopArchive.archiveTouched.includes('recovery_tool:browser.dom_snapshot'), 'desktop archive touched avoids browser evidence tools');

  const vagueLocalFileArchive = buildChatFailureRecoveryArchive({
    task: 'Find the invoice',
    failureMessage: 'File adapter could not resolve a scoped path before reading.',
    executionKind: 'run_computer_task',
    source: 'file_adapter_error',
    preflightSummary: 'Local file adapter failed before file search.',
  }, fakeRecovery);
  const vagueLocalFileReliability = vagueLocalFileArchive.archiveMetadata.recoveryReliability as any;
  assert(vagueLocalFileReliability?.surfaceKind === 'local_file', 'local-file archive reliability records surface kind');
  assert(vagueLocalFileReliability?.nextEvidenceTools?.includes('desktop.file_search'), 'local-file archive reliability records file search evidence');
  assert(vagueLocalFileReliability?.verificationCommands?.includes('npm run smoke:computer-grant-gate'), 'local-file archive reliability records grant verification');
  assert(vagueLocalFileArchive.archiveTouched.includes('recovery_surface:local_file'), 'local-file archive touched includes recovery surface');
  assert(vagueLocalFileArchive.archiveTouched.includes('recovery_tool:desktop.file_search'), 'local-file archive touched includes required file evidence tool');
  assert(!vagueLocalFileArchive.archiveTouched.includes('recovery_tool:browser.dom_snapshot'), 'local-file archive touched avoids browser evidence tools');

  const firstFingerprint = buildChatFailureRecoveryFingerprint({
    task: 'Create a room and add the launch tasks',
    failureMessage: 'Request 123456 failed for row 550e8400-e29b-41d4-a716-446655440000: messages_content_check',
    executionKind: 'run_openswan',
    source: 'main_chat_openswan_batch',
  });
  const secondFingerprint = buildChatFailureRecoveryFingerprint({
    task: 'Create a room and add the launch tasks',
    failureMessage: 'Request 987654 failed for row 11111111-2222-3333-4444-555555555555: messages_content_check',
    executionKind: 'run_openswan',
    source: 'main_chat_openswan_batch',
  });
  assert(firstFingerprint === secondFingerprint, 'fingerprint normalizes volatile ids and numbers');
  assert(!shouldSuppressDuplicateChatFailureHandoff({
    recentRepeat: true,
    repeatCount: 2,
    lastSuccessfulHandoffAt: null,
    nowMs: 1_000,
    repeatWindowMs: 10_000,
  }), 'duplicate handoff is not suppressed before a successful recovery handoff');
  assert(shouldSuppressDuplicateChatFailureHandoff({
    recentRepeat: true,
    repeatCount: 2,
    lastSuccessfulHandoffAt: 900,
    nowMs: 1_000,
    repeatWindowMs: 10_000,
  }), 'duplicate handoff is suppressed after a recent successful recovery handoff');

  const suppressed = await startChatFailureRecovery({
    task: 'Create a room and add the launch tasks',
    failureMessage: 'new row for relation "messages" violates check constraint "messages_content_check"',
    executionKind: 'run_openswan',
    source: 'main_chat_openswan_batch',
    recoveryFingerprint: firstFingerprint,
    repeatCount: 3,
    suppressConnectedHandoff: true,
    suppressionReason: 'matching failure already delegated recently',
  });
  assert(!suppressed.recovery.ok, 'suppressed duplicate recovery does not call connected agent');
  assert(suppressed.recovery.launched === false, 'suppressed duplicate recovery does not launch Codex');
  assert(suppressed.userMessage.startsWith("Couldn't finish:"), 'suppressed duplicate chat message is terse');
  assert(suppressed.detail.includes('Duplicate handoff suppressed'), 'suppressed duplicate detail explains dedupe');
  assert(suppressed.detail.includes('Options:'), 'suppressed duplicate detail still shows options');
  assert(suppressed.recoveryOptions.some((option) => option.id === 'let_connected_agent_repair'), 'suppressed duplicate preserves connected-agent option context');
  assert(suppressed.archiveSummary.includes('suppressed'), 'suppressed duplicate archive summary is explicit');
  assert(suppressed.archiveMetadata.suppressed === true, 'suppressed duplicate archive metadata is explicit');
  assert(suppressed.archiveMetadata.repeatCount === 3, 'suppressed duplicate archive metadata includes repeat count');
  assert(suppressed.archiveMetadata.fingerprint === firstFingerprint, 'suppressed duplicate archive metadata includes fingerprint');
  assert(typeof suppressed.archiveMetadata.recoveryRunbook === 'object', 'suppressed duplicate archive metadata includes runbook');
  assert(suppressed.archiveTouched.includes(`fingerprint:${firstFingerprint}`), 'suppressed duplicate archive touched includes fingerprint');
  assert(suppressed.verificationPlan.commands.includes('npm run smoke:openswan-task-planner'), 'suppressed duplicate result preserves verification plan');
  assert(suppressed.runbook.nextActor === 'connected_agent', 'suppressed duplicate result preserves runbook');

  const blocked = await startChatFailureRecovery({
    task: 'Log into a site and finish onboarding',
    failureMessage: 'Cloudflare human verification requires checking the not a robot box.',
    executionKind: 'browser_computer_use',
    source: 'computer_use_agent_error',
    launchIfMissing: true,
  });
  assert(!blocked.recovery.ok, 'human-verification chat recovery returns blocked result');
  assert(blocked.recovery.launched === false, 'human-verification chat recovery does not launch Codex');
  assert(blocked.runbook.nextActor === 'user', 'human-verification chat recovery returns user-action runbook');
  assert(blocked.userMessage.startsWith("Couldn't finish:"), 'blocked chat message is terse');
  assert(blocked.detail.includes('did not launch'), 'blocked detail explains no launch');
  assert(blocked.detail.includes('Options:'), 'blocked detail gives options');
  assert(blocked.recoveryOptions.some((option) => option.id === 'user_unblock' && option.actor === 'user'), 'blocked recovery offers user unblock option');
  assert(blocked.archiveMetadata.failureClass === 'human_verification_required', 'blocked archive metadata includes human verification class');

  const complexRecovery = await startChatFailureRecovery({
    task: 'Research in browser, update desktop file, save memory, schedule follow-up, then verify',
    failureMessage: 'Provider 429 while browser task was waiting for desktop bridge checkpoint evidence.',
    executionKind: 'run_openswan',
    source: 'multi_agent_complex_task',
    planSummary: 'Route intent: run_computer_task; complexity: complex; surfaces: browser, desktop, provider, memory, schedule.',
    launchIfMissing: false,
    suppressConnectedHandoff: true,
    suppressionReason: 'smoketest avoids launching a connected agent',
  });
  assert(complexRecovery.runbook.complexity.level === 'complex', 'complex chat recovery returns complex runbook');
  assert(complexRecovery.runbook.coordinationMode === 'decompose_then_recover', 'complex chat recovery returns decomposition coordination');
  assert(complexRecovery.detail.includes('Complexity: `complex`'), 'complex chat recovery detail includes complexity');
  assert(complexRecovery.archiveMetadata.coordinationMode === 'decompose_then_recover', 'complex chat recovery archives coordination mode');

  assert(formatActiveChatBlockerContextForPrompt(null) === '', 'active blocker context is a no-op on null input');
  assert(
    formatActiveChatBlockerContextForPrompt({ recoveryOptions: [], computerHandoffBlockers: [], planPreview: null }) === '',
    'active blocker context is a no-op when nothing is actually blocked'
  );
  const blockerContext = formatActiveChatBlockerContextForPrompt({
    recoveryOptions: [{ id: 'resolve_contract_blocker', label: 'Resolve the contract blocker', recommended: true }],
    computerHandoffBlockers: ['fresh DOM/ARIA snapshot before retry'],
    planPreview: { title: 'Browser Semantic Control Loop', routeLabel: 'Desktop app', evidenceGaps: ['dom snapshot'] },
  });
  assert(blockerContext.startsWith('## Active Blocked Task'), 'active blocker context includes its section header');
  assert(blockerContext.includes('Browser Semantic Control Loop'), 'active blocker context includes the plan title');
  assert(blockerContext.includes('resolve_contract_blocker'), 'active blocker context includes the recovery option id');
  assert(blockerContext.includes('Resolve the contract blocker'), 'active blocker context includes the recovery option label');
  assert(blockerContext.includes('(recommended)'), 'active blocker context marks the recommended option');
  assert(blockerContext.includes('fresh DOM/ARIA snapshot before retry'), 'active blocker context includes the blocker reason');
  assert(blockerContext.includes('dom snapshot'), 'active blocker context includes the evidence gap');

  assert(formatCompletedChatTaskContextForPrompt(null) === '', 'completed-task context is a no-op on null input');
  assert(
    formatCompletedChatTaskContextForPrompt({ outcomeSignal: { verdict: 'success' }, computerFindings: null, artifacts: null, browserPlans: null }) === '',
    'completed-task context is a no-op when there are no findings, artifacts, or plans even with an outcome verdict'
  );
  const completedContext = formatCompletedChatTaskContextForPrompt({
    outcomeSignal: { verdict: 'success' },
    computerFindings: { items: [{ title: 'Blue Widget', price: '$19.99', rating: '4.5 stars' }] },
    artifacts: [{ kind: 'document', title: 'Trip Itinerary' }],
    browserPlans: [
      { task: 'Book flight', status: 'completed', backendLabel: 'Browserbase' },
      { task: 'Check weather', status: 'running' },
    ],
  });
  assert(completedContext.startsWith('## Last Completed Task Result'), 'completed-task context includes its section header');
  assert(completedContext.includes('outcome: success'), 'completed-task context includes the outcome verdict');
  assert(completedContext.includes('Blue Widget') && completedContext.includes('$19.99'), 'completed-task context includes finding details');
  assert(completedContext.includes('Trip Itinerary'), 'completed-task context includes artifact titles');
  assert(completedContext.includes('Book flight (completed, Browserbase)'), 'completed-task context includes a completed browser-plan summary');
  assert(!completedContext.includes('Check weather'), 'completed-task context excludes still-running browser plans');

  if (failures > 0) {
    console.error(`\n${failures} chat failure recovery smoke-test failure(s)`);
    process.exit(1);
  }

  console.log('\nAll chat failure recovery smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
