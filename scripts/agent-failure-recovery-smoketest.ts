/**
 * agent-failure-recovery-smoketest
 *
 * Locks the policy that turns failed chat/computer/browser tasks into a
 * bounded Codex recovery handoff instead of a dead-end error.
 *
 * Run: npm run smoke:agent-failure-recovery
 */

import {
  buildAgentFailureRecoveryPolicy,
  shouldLaunchConnectedAgentRecovery,
  startConnectedAgentFailureRecovery,
} from '../src/lib/agentFailureRecovery';

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

function policyFor(failureMessage: string) {
  return buildAgentFailureRecoveryPolicy({
    task: 'Open Photoshop and save the active image as test-it.jpg',
    failureMessage,
    executionKind: 'run_computer_task',
    source: 'smoketest',
  });
}

async function main() {
  const cors = policyFor('Access-Control-Allow-Headers blocked x-uc-desktop-token during CORS preflight.');
  assert(cors.assessment.failureClass === 'cors_preflight_blocked', 'CORS token header failure is classified');
  assert(cors.action === 'restart_or_update_bridge', 'CORS token header failure routes to bridge recovery');
  assert(cors.autoFixAllowed, 'CORS token header recovery can be auto-fixed by a connected agent');
  assert(cors.runbook.nextActor === 'connected_agent', 'CORS token header runbook delegates bridge repair to connected agent');
  assert(cors.runbook.steps.some((step) => step.id === 'verify-bridge'), 'CORS token header runbook includes bridge verification');
  assert(shouldLaunchConnectedAgentRecovery(cors), 'CORS token header recovery may launch a connected agent');

  // Regression: the computer-app readiness "preflight" must NOT be misread as
  // a CORS preflight. A failed Photoshop task that emitted "preflight: partial"
  // warnings was getting mislabeled cors_preflight_blocked → wrong "restart the
  // bridge" advice when CORS was fine; the real failure was file resolution.
  const appPreflight = policyFor('Adobe Photoshop Layered Creative Control Loop preflight: partial. 4 warnings before execution. Could not resolve the file pearsoncdjr-img inside the granted roots.');
  assert(appPreflight.assessment.failureClass !== 'cors_preflight_blocked', 'app readiness "preflight" is NOT misclassified as a CORS preflight', appPreflight.assessment.failureClass);

  const token = policyFor('Browser action failed (token_rejected): Token rejected. Next: Re-pair the local desktop bridge.');
  assert(token.assessment.failureClass === 'token_rejected', 'browser token rejection is classified');
  assert(token.action === 'restart_or_update_bridge', 'browser token rejection routes to bridge recovery');
  assert(token.runbook.nextActor === 'connected_agent', 'browser token rejection can use connected bridge repair');

  const constraint = policyFor('new row for relation "messages" violates check constraint "messages_content_check"');
  assert(constraint.assessment.failureClass === 'constraint_violation', 'database constraint failure is classified');
  assert(constraint.action === 'patch_app_code', 'database constraint failure routes to app-code patching');
  assert(constraint.runbook.steps.some((step) => step.kind === 'patch'), 'database constraint runbook includes a patch step');
  assert(constraint.prompt.includes('ROOT_CAUSE') && constraint.prompt.includes('RUNBOOK_STATUS'), 'recovery prompt includes output contract and runbook status');
  assert(constraint.prompt.includes('=== AGENT DEVELOPMENT STANDARDS ==='), 'recovery prompt carries agent development standards block');
  assert(constraint.prompt.includes('docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md'), 'recovery prompt carries TypeScript app standards');

  const selector = policyFor('Stopped at step 7/8: I read InDesign but could not find a field matching Change.');
  assert(selector.action === 'retry_with_grounding', 'UI target failure routes to grounded retry');
  assert(selector.retryLimit === 2, 'grounded retry has bounded retry limit');
  assert(selector.runbook.nextActor === 'openswan', 'grounded retry runbook returns control to OpenSwan after fresh grounding');
  assert(selector.runbook.steps.some((step) => step.id === 'refresh-grounding'), 'grounded retry runbook requires fresh grounding');

  const navigationTimeout = policyFor('Browser action failed (timeout): page.goto: Timeout 30000ms exceeded while waiting for load.');
  assert(navigationTimeout.assessment.failureClass === 'timeout', 'browser navigation timeout is classified separately from selector failure');
  assert(navigationTimeout.action === 'retry_with_grounding', 'browser navigation timeout routes to grounded retry');
  assert(navigationTimeout.runbook.steps.some((step) => step.id === 'refresh-grounding'), 'browser navigation timeout requires fresh browser state');

  const browserDialog = policyFor('Browser dialog blocked: "lmao.png" already exists. Decision: requested output not confirmed.');
  assert(browserDialog.assessment.failureClass === 'browser_dialog_blocked', 'browser popup failure is classified');
  assert(browserDialog.action === 'request_user_action', 'browser popup blocker requests a user decision');
  assert(!browserDialog.autoFixAllowed, 'browser popup blocker does not auto-launch connected recovery');
  assert(browserDialog.runbook.nextActor === 'user', 'browser popup blocker assigns next action to user');

  const toolUnsupported = policyFor('Selected model does not support tool types computer_20250124 for this task.');
  assert(toolUnsupported.assessment.failureClass === 'model_tool_unsupported', 'tool unsupported failure is classified');
  assert(toolUnsupported.action === 'switch_route_or_model', 'tool unsupported failure routes to model or route switching');
  assert(toolUnsupported.autoFixAllowed, 'tool unsupported route switch can be handled automatically');
  assert(toolUnsupported.runbook.nextActor === 'openswan', 'tool unsupported runbook returns control to OpenSwan route selection');
  assert(toolUnsupported.runbook.steps.some((step) => step.id === 'select-safe-route'), 'tool unsupported runbook includes safe route selection');

  const complex = buildAgentFailureRecoveryPolicy({
    task: 'Research the launch page in the browser, update the local design file on desktop, save proof to memory, schedule a follow-up automation, then verify the full workflow.',
    failureMessage: 'Provider 429 while browser task was waiting for desktop bridge checkpoint evidence.',
    executionKind: 'run_openswan',
    source: 'complex_task_smoketest',
    planSummary: 'Route intent: run_computer_task; complexity: complex; surfaces: browser, desktop, provider, memory, schedule; requires multi-agent checkpoint recovery.',
  });
  assert(complex.runbook.complexity.level === 'complex', 'complex cross-surface task is classified as complex');
  assert(complex.runbook.coordinationMode === 'decompose_then_recover', 'complex cross-surface task requires decomposition before recovery');
  assert(complex.runbook.steps.some((step) => step.id === 'decompose-complex-task'), 'complex runbook includes decomposition step');
  assert(complex.runbook.steps.some((step) => step.id === 'establish-checkpoints'), 'complex runbook includes checkpoint step');
  assert(complex.verification.some((item) => item.includes('decomposed subtask')), 'complex recovery requires per-subtask verification evidence');
  assert(complex.prompt.includes('CHECKPOINTS'), 'complex recovery prompt asks for checkpoint output');

  const captcha = policyFor('Cloudflare human verification requires checking the not a robot box.');
  assert(captcha.assessment.failureClass === 'human_verification_required', 'human verification is classified');
  assert(captcha.action === 'request_user_action', 'human verification requests user action');
  assert(!captcha.autoFixAllowed, 'human verification cannot be auto-fixed');
  assert(captcha.runbook.nextActor === 'user', 'human verification runbook assigns next action to user');
  assert(captcha.runbook.stopConditions.some((condition) => condition.includes('Never bypass')), 'human verification runbook forbids bypass');
  assert(!shouldLaunchConnectedAgentRecovery(captcha), 'human verification does not launch a connected agent');
  assert(captcha.prompt.includes('Do not use credentials, bypass CAPTCHA/MFA'), 'recovery guardrails forbid CAPTCHA/MFA bypass');

  const blockedLaunch = await startConnectedAgentFailureRecovery({
    task: 'Log into a site and finish onboarding',
    failureMessage: 'Cloudflare human verification requires checking the not a robot box.',
    executionKind: 'run_computer_task',
    source: 'smoketest',
  });
  assert(!blockedLaunch.ok, 'protected user-action failure returns a blocked launch result');
  assert(blockedLaunch.launched === false, 'protected user-action failure does not launch Codex');
  assert(blockedLaunch.runbook.nextActor === 'user', 'blocked launch result keeps machine-readable user action');
  assert(blockedLaunch.message.includes('not launched'), 'blocked launch result explains that recovery was not launched');

  // ─── Approval gate: a would-handoff failure must NOT auto-launch a terminal ──
  // Regression guard for "open the notes app spawned a Codex terminal": when
  // the policy WOULD hand off to a connected agent, automatic recovery (no
  // explicit approval) must NOT launch or commandeer an agent — it prepares
  // and waits for the user to approve the repair option.
  const capabilityFailure = {
    task: 'Resize the InDesign banner layout',
    failureMessage: 'Missing adapter: no InDesign resize/layout bridge tool is implemented for this command.',
    executionKind: 'run_computer_task',
    source: 'smoketest',
  };
  const wouldHandoff = buildAgentFailureRecoveryPolicy(capabilityFailure);
  assert(shouldLaunchConnectedAgentRecovery(wouldHandoff), 'capability-gap failure would hand off to a connected agent');

  const gated = await startConnectedAgentFailureRecovery(capabilityFailure);
  assert(!gated.ok, 'connected-agent recovery is not auto-started without explicit approval');
  assert(gated.launched === false, 'connected-agent recovery does NOT launch a terminal without approval (the surprise-terminal guard)');
  assert(/approve the repair option/i.test(gated.message), 'gated message points the user to the approval option');
  assert(gated.runbook.nextActor === 'connected_agent', 'gated result still records connected_agent as the next actor for the approval option');

  if (failures > 0) {
    console.error(`\n${failures} agent failure recovery smoke-test failure(s)`);
    process.exit(1);
  }

  console.log('\nAll agent failure recovery smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
