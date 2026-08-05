/**
 * computer-plan-approval-floor-smoketest
 *
 * Locks two approval hard-stops:
 *
 *   1. `computerUse.executePlan` HALTS every legacy mutation at a sealed,
 *      non-executable typed OpenSwan handoff before generic permission or
 *      `pendingApproval` handling. Raw mutation values are stripped, saved
 *      statuses cannot bypass the boundary, and later steps stay untouched.
 *      Read-only permission waits still return the resumable
 *      `pendingApproval` contract.
 *
 *   2. `chatApprovalGate`'s per-category `'auto'` waiver cannot waive the
 *      destructive floor (pay / delete / login / grant — the same category
 *      list as `computerGrantGate.STICKY_FLOOR_CATEGORIES`). Floor plans
 *      route through the confirm/proposal flow; ordinary reads still pass.
 *
 * Both modules transitively import react-native via the supabase singleton,
 * which tsx/esbuild cannot parse — the native specifiers are stubbed with
 * `node:module.registerHooks` (same technique as
 * progressive-tool-disclosure-smoketest) and the REAL modules are imported
 * dynamically. No test touches the network: every executePlan case halts
 * before any action would execute.
 *
 * Run: npx tsx scripts/computer-plan-approval-floor-smoketest.ts
 */

import { registerHooks } from 'node:module';

// The supabase singleton creates a client at import time — give it inert
// values BEFORE any app module loads. Never points at a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://approval-floor-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'approval-floor-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Type-only imports are erased at compile time — safe before the hooks run.
import type { BrowserAction, ComputerUseSession } from '../src/lib/computerUse';
import type { ChatAutomationPlan } from '../src/lib/chatAutomationPlanner';

let assertions = 0;
let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  assertions += 1;
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

function makeAction(overrides: Partial<BrowserAction> & Pick<BrowserAction, 'id' | 'type' | 'description'>): BrowserAction {
  return {
    requiresApproval: false,
    status: 'pending',
    ...overrides,
  };
}

function makeSession(actions: BrowserAction[], permission: ComputerUseSession['permission']): ComputerUseSession {
  return {
    id: 'smoke-session',
    agentName: 'Smoke',
    task: 'smoke task',
    permission,
    actions,
    status: 'executing',
    startedAt: new Date().toISOString(),
    approvedDomains: [],
    backend: 'playwright_bridge',
    backendLabel: 'Local browser bridge',
  };
}

function makePlan(overrides: {
  commandText?: string | null;
  message: string;
  routeId?: ChatAutomationPlan['execution']['routeId'];
  approvalRequired?: boolean;
}): ChatAutomationPlan {
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: overrides.message },
    execution: {
      kind: 'run_browser_plan',
      routeId: overrides.routeId ?? 'browser',
      commandText: overrides.commandText ?? null,
    },
    risk: 'review',
    approval: overrides.approvalRequired
      ? { required: true, reason: 'planner flagged review' }
      : { required: false, reason: null },
    confidence: 0.9,
    notes: [],
  };
}

async function main() {
  const computerUse = await import('../src/lib/computerUse');
  const gate = await import('../src/lib/chatApprovalGate');

  // ── executePlan: sealed handoff before approval/status handling ────────────
  const fill = makeAction({
    id: 'a-fill',
    type: 'fill',
    target: '#password',
    value: 'secret',
    description: 'Fill credential field',
    requiresApproval: true,
    approvalReason: 'Credential entry needs explicit approval.',
  });
  const submit = makeAction({
    id: 'a-submit',
    type: 'click',
    target: '#submit',
    description: 'Click Submit',
  });

  const completions: string[] = [];
  const halted = await computerUse.executePlan(
    makeSession([fill, submit], 'trusted'),
    (action) => { completions.push(action.id); },
  );
  const fillHandoff = halted.actions[0]?.runtimeHandoff;
  assert(halted.success === false, 'legacy fill halts the plan (success=false)');
  assert(
    completions.length === 1 && completions[0] === 'a-fill',
    'completion callback reports only the halted fill handoff (no mutation executed)',
  );
  assert(
    halted.actions[0]?.status === 'failed',
    'legacy fill is returned as a failed/non-executable handoff marker',
  );
  assert(
    fillHandoff?.kind === 'openswan_typed_tool'
      && fillHandoff.tool === 'browser.fill_field'
      && fillHandoff.credentialTool === 'browser.fill_credential_field',
    'fill handoff identifies the typed field tool and sealed credential tool',
  );
  assert(
    fillHandoff?.sourceLane === 'legacy_computer_use'
      && fillHandoff.reasonCode === 'sealed_runtime_identity_required'
      && fillHandoff.executable === false
      && fillHandoff.carriesRawInput === false,
    'fill handoff is explicitly non-executable and carries no raw input',
  );
  assert(
    fillHandoff?.requiredContext.includes('authenticated_user_id')
      && fillHandoff.requiredContext.includes('circle_id')
      && fillHandoff.requiredContext.includes('persisted_agent_run_id')
      && fillHandoff.requiredContext.includes('provider_tool_use_id')
      && fillHandoff.requiredContext.includes('tool_iteration')
      && fillHandoff.requiredContext.includes('exact_openswan_runtime_approval'),
    'fill handoff requires authenticated run, provider-call, and exact-approval context',
  );
  assert(
    halted.actions[0]?.value === undefined && !JSON.stringify(halted).includes('secret'),
    'raw credential value is stripped from the entire halt result',
  );
  assert(
    halted.pendingApproval === undefined,
    'legacy mutation handoff occurs before generic pendingApproval handling',
  );
  assert(halted.actions.length === 2, 'halt result carries every plan step (resumable session state)');
  assert(
    halted.actions[1]?.id === 'a-submit'
      && halted.actions[1]?.status === 'pending'
      && !halted.actions[1]?.executedAt
      && halted.actions[1]?.runtimeHandoff?.tool === 'browser.click_role',
    'later steps are returned untouched — not skipped, not executed',
  );
  assert(
    /Stopped at step 1/.test(halted.message) && /typed OpenSwan/.test(halted.message),
    'halt message names the stopped step and typed OpenSwan continuation',
  );

  // A persisted legacy status is untrusted: even "completed" cannot skip the
  // sealed mutation boundary or expose a later mutation.
  const completedFill = { ...fill, status: 'completed' as const };
  const unapprovedPay = makeAction({
    id: 'a-pay',
    type: 'click',
    target: '#place-order',
    description: 'Click Place order',
    requiresApproval: true,
    approvalReason: 'Payment step.',
  });
  const resumed = await computerUse.executePlan(
    makeSession([completedFill, unapprovedPay], 'trusted'),
    (action) => { completions.push(action.id); },
  );
  assert(
    resumed.success === false
      && resumed.pendingApproval === undefined
      && resumed.actions[0]?.status === 'failed'
      && resumed.actions[0]?.runtimeHandoff?.tool === 'browser.fill_field',
    'saved completed status cannot bypass the first legacy mutation handoff',
  );
  assert(
    resumed.actions[1]?.id === 'a-pay'
      && resumed.actions[1]?.status === 'pending'
      && !resumed.actions[1]?.executedAt,
    'saved-status bypass attempt leaves the later payment step untouched',
  );

  // Mutation sealing precedes permission handling, including ask_every_time.
  const plainClick = makeAction({ id: 'a-click', type: 'click', target: '#next', description: 'Click Next' });
  const askEveryTime = await computerUse.executePlan(
    makeSession([plainClick], 'ask_every_time'),
    (action) => { completions.push(action.id); },
  );
  assert(
    askEveryTime.success === false
      && askEveryTime.pendingApproval === undefined
      && askEveryTime.actions[0]?.runtimeHandoff?.tool === 'browser.click_role',
    'ask_every_time mutation still returns the typed handoff before pendingApproval',
  );

  // Read-only permission waits retain the resumable pendingApproval contract
  // and stop before observation/backend I/O.
  const observe = makeAction({
    id: 'a-observe',
    type: 'observe',
    description: 'Observe the current page',
  });
  const readOnlyPause = await computerUse.executePlan(
    makeSession([observe], 'ask_every_time'),
    (action) => { completions.push(action.id); },
  );
  assert(
    readOnlyPause.success === false
      && readOnlyPause.pendingApproval?.index === 0
      && readOnlyPause.pendingApproval?.actionId === 'a-observe',
    'ask_every_time read-only step returns a resumable pendingApproval',
  );
  assert(
    computerUse.deriveComputerUseResultOutcomeStatus(readOnlyPause) === 'waiting_approval',
    'read-only pendingApproval projects to typed waiting_approval, never failed',
  );
  const waitingRecord = computerUse.toBrowserSessionRecord(
    { ...makeSession(readOnlyPause.actions, 'ask_every_time'), status: 'awaiting_approval' },
    readOnlyPause,
  );
  assert(
    waitingRecord.status === 'awaiting_approval' && waitingRecord.completedAt === undefined,
    'pendingApproval persists as a resumable awaiting_approval browser session',
  );
  assert(
    readOnlyPause.actions[0]?.status === 'pending'
      && readOnlyPause.actions[0]?.runtimeHandoff === undefined,
    'read-only permission pause stays pending and carries no mutation handoff',
  );
  assert(
    /Paused at step 1/.test(readOnlyPause.message),
    'read-only pendingApproval message names the paused step',
  );
  assert(
    completions.join(',') === 'a-fill,a-fill,a-click',
    'callbacks report exactly three mutation handoffs; no read-only action or backend ran',
  );

  // An explicit rejection is a prerequisite stop, never a skippable step.
  // Later actions remain untouched and the result projects as blocked rather
  // than a successful partial plan.
  const rejectedCompletions: string[] = [];
  const rejectedObserve = makeAction({
    id: 'a-rejected-observe',
    type: 'observe',
    description: 'Observe account details',
    status: 'rejected',
  });
  const afterRejected = makeAction({
    id: 'a-after-rejection',
    type: 'extract',
    description: 'Extract account details',
  });
  const rejectedSession = makeSession([rejectedObserve, afterRejected], 'trusted');
  const rejectedResult = await computerUse.executePlan(
    rejectedSession,
    (action) => { rejectedCompletions.push(action.id); },
  );
  assert(
    rejectedResult.success === false
      && rejectedResult.blocked?.reason === 'action_rejected'
      && rejectedResult.blocked?.actionId === 'a-rejected-observe'
      && computerUse.deriveComputerUseResultOutcomeStatus(rejectedResult) === 'blocked',
    'rejected prerequisite halts with a typed blocked outcome',
  );
  assert(
    rejectedCompletions.length === 0
      && rejectedResult.actions[1]?.id === 'a-after-rejection'
      && rejectedResult.actions[1]?.status === 'pending'
      && !rejectedResult.actions[1]?.executedAt,
    'rejected prerequisite leaves every later action untouched',
  );
  assert(
    /Stopped at step 1/.test(rejectedResult.message)
      && /Later steps were not executed/.test(rejectedResult.message),
    'rejected prerequisite explains the fail-closed review/replan requirement',
  );
  const blockedRecord = computerUse.toBrowserSessionRecord(rejectedSession, rejectedResult);
  assert(
    blockedRecord.status === 'blocked' && !!blockedRecord.completedAt,
    'rejected prerequisite persists as blocked, never completed or failed',
  );

  const laterRejectedCompletions: string[] = [];
  const laterRejectedResult = await computerUse.executePlan(
    makeSession([
      makeAction({ id: 'a-pending-before-reject', type: 'observe', description: 'Observe first' }),
      makeAction({ id: 'a-rejected-second', type: 'extract', description: 'Rejected second step', status: 'rejected' }),
    ], 'trusted'),
    (action) => { laterRejectedCompletions.push(action.id); },
  );
  assert(
    laterRejectedResult.blocked?.actionId === 'a-rejected-second'
      && laterRejectedResult.blocked?.index === 1
      && laterRejectedCompletions.length === 0,
    'later rejected step preflights the whole plan before an earlier action can run',
  );
  assert(
    laterRejectedResult.actions[0]?.status === 'pending'
      && !laterRejectedResult.actions[0]?.executedAt,
    'earlier pending action stays untouched when a later prerequisite was rejected',
  );

  const rejectedMutationCompletions: string[] = [];
  const rejectedMutation = makeAction({
    id: 'a-rejected-fill',
    type: 'fill',
    target: '#secret',
    value: 'must-not-survive',
    description: 'Fill a declined field',
    status: 'rejected',
  });
  const rejectedMutationResult = await computerUse.executePlan(
    makeSession([
      rejectedMutation,
      makeAction({ id: 'a-after-rejected-fill', type: 'observe', description: 'Observe later' }),
    ], 'trusted'),
    (action) => { rejectedMutationCompletions.push(action.id); },
  );
  assert(
    rejectedMutationResult.blocked?.actionId === 'a-rejected-fill'
      && rejectedMutationCompletions.length === 0,
    'rejected mutation halts before executeAction or its completion callback',
  );
  assert(
    rejectedMutationResult.actions[0]?.status === 'rejected'
      && rejectedMutationResult.actions[0]?.runtimeHandoff === undefined
      && rejectedMutationResult.actions[0]?.value === undefined
      && !JSON.stringify(rejectedMutationResult).includes('must-not-survive'),
    'rejected mutation is redacted without preparing a runtime handoff',
  );

  const contradictoryCompleted = makeAction({
    id: 'a-completed-with-blocker',
    type: 'observe',
    description: 'Observe a guarded resource',
    status: 'completed',
    blockedReason: 'Required evidence was never collected.',
  });
  const contradictoryCompletions: string[] = [];
  const contradictoryResult = await computerUse.executePlan(
    makeSession([
      contradictoryCompleted,
      makeAction({ id: 'a-after-contradiction', type: 'extract', description: 'Extract later' }),
    ], 'trusted'),
    (action) => { contradictoryCompletions.push(action.id); },
  );
  assert(
    contradictoryResult.blocked?.actionId === 'a-completed-with-blocker'
      && contradictoryResult.actions[0]?.status === 'rejected'
      && contradictoryCompletions.length === 0,
    'completed plus blockedReason fails closed as a rejected prerequisite',
  );
  assert(
    contradictoryResult.actions[1]?.status === 'pending'
      && !contradictoryResult.actions[1]?.executedAt,
    'contradictory completed blocker leaves later actions untouched',
  );

  // Cancellation is a neutral typed outcome. A pre-aborted run must not
  // enter an action or invoke its completion callback, and its projection
  // must never turn into failed.
  const preAbortController = new AbortController();
  preAbortController.abort();
  const preAbortCompletions: string[] = [];
  const preAbortedSession = makeSession([
    makeAction({ id: 'a-never-entered', type: 'wait', value: '5000', description: 'Wait' }),
  ], 'trusted');
  const preAborted = await computerUse.executePlan(
    preAbortedSession,
    (action) => { preAbortCompletions.push(action.id); },
    { signal: preAbortController.signal },
  );
  assert(
    preAborted.cancelled === true
      && computerUse.deriveComputerUseResultOutcomeStatus(preAborted) === 'cancelled',
    'pre-aborted local plan returns a typed cancelled result',
  );
  assert(
    preAbortCompletions.length === 0
      && preAborted.actions[0]?.id === 'a-never-entered'
      && preAborted.actions[0]?.status === 'pending'
      && !preAborted.actions[0]?.executedAt,
    'pre-aborted plan invokes no callback and leaves the action untouched',
  );
  const cancelledRecord = computerUse.toBrowserSessionRecord(preAbortedSession, preAborted);
  assert(
    cancelledRecord.status === 'cancelled' && !!cancelledRecord.completedAt,
    'cancelled result persists as cancelled, never failed',
  );

  // Mid-step cancellation must interrupt the abort-aware wait promptly and
  // must not let this or a later action report completion.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  try {
    const midAbortController = new AbortController();
    const midAbortCompletions: string[] = [];
    const midAbortSession = makeSession([
      makeAction({ id: 'a-long-wait', type: 'wait', value: '5000', description: 'Wait five seconds' }),
      makeAction({ id: 'a-after-wait', type: 'observe', description: 'Observe after wait' }),
    ], 'trusted');
    const startedAt = Date.now();
    const pendingRun = computerUse.executePlan(
      midAbortSession,
      (action) => { midAbortCompletions.push(action.id); },
      { signal: midAbortController.signal },
    );
    setTimeout(() => midAbortController.abort(), 10);
    const midAborted = await pendingRun;
    assert(
      midAborted.cancelled === true && Date.now() - startedAt < 1000,
      'mid-wait abort returns cancelled promptly instead of waiting five seconds',
    );
    assert(
      midAbortCompletions.length === 0
        && midAborted.actions[1]?.id === 'a-after-wait'
        && midAborted.actions[1]?.status === 'pending'
        && !midAborted.actions[1]?.executedAt,
      'mid-wait abort publishes no late completion and leaves later steps untouched',
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  // ── chatApprovalGate: 'auto' cannot waive the destructive floor ────────────
  const payPlan = makePlan({
    commandText: '/browser buy the standing desk and check out',
    message: 'buy the standing desk and check out',
  });
  const deletePlan = makePlan({
    commandText: null,
    message: 'permanently delete all the old backups',
  });
  const loginPlan = makePlan({
    commandText: '/browser log into the vendor portal',
    message: 'log into the vendor portal',
  });
  const readPlan = makePlan({
    commandText: '/memory show',
    message: 'show my memories',
    routeId: 'memory',
  });

  assert(gate.destructiveFloorCategoryForPlan(payPlan) === 'pay', 'pay/purchase plan maps to the pay floor category');
  assert(gate.destructiveFloorCategoryForPlan(deletePlan) === 'delete', 'delete plan maps to the delete floor category');
  assert(gate.destructiveFloorCategoryForPlan(loginPlan) === 'login', 'login plan maps to the login floor category');
  assert(gate.destructiveFloorCategoryForPlan(readPlan) === null, 'memory read plan carries no floor category');

  assert(gate.resolveAutoApproveWaiver('auto', payPlan) === 'confirm_required', "'auto' + pay plan requires confirmation");
  assert(gate.resolveAutoApproveWaiver('auto', deletePlan) === 'confirm_required', "'auto' + delete plan requires confirmation");
  assert(gate.resolveAutoApproveWaiver('auto', loginPlan) === 'confirm_required', "'auto' + login plan requires confirmation");
  assert(gate.resolveAutoApproveWaiver('auto', readPlan) === 'pass', "'auto' + memory read plan still passes");
  assert(gate.resolveAutoApproveWaiver('ask', payPlan) === 'default', "'ask' decision keeps the existing flow");
  assert(gate.resolveAutoApproveWaiver('never', payPlan) === 'default', "'never' decision keeps the existing (block) flow");

  if (failures > 0) {
    console.error(`\n${failures} computer plan approval floor smoke-test failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll computer plan approval floor smoke cases passed (${assertions} assertions).`);
}

main().catch((error) => {
  console.error('FAIL: smoke harness error:', error);
  process.exit(1);
});
