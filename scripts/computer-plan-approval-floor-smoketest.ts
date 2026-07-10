/**
 * computer-plan-approval-floor-smoketest
 *
 * Locks two approval hard-stops:
 *
 *   1. `computerUse.executePlan` HALTS at the first unapproved step instead
 *      of skipping past it — skipping could mutate external state on partial
 *      inputs (e.g. click a submit button whose credential fills were
 *      skipped). The halt returns a resumable terminal-pending result
 *      (`success: false` + `pendingApproval`) with later steps untouched.
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

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
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

  // ── executePlan: halt at the first unapproved step ─────────────────────────
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
  assert(halted.success === false, 'unapproved fill halts the plan (success=false)');
  assert(completions.length === 0, 'no action executed after the halt (submit never ran)');
  assert(
    halted.pendingApproval?.index === 0 && halted.pendingApproval?.actionId === 'a-fill',
    'halt result points at the unapproved step for resume',
  );
  assert(halted.actions.length === 2, 'halt result carries every plan step (resumable session state)');
  assert(
    halted.actions[1]?.id === 'a-submit'
      && halted.actions[1]?.status === 'pending'
      && !halted.actions[1]?.executedAt,
    'later steps are returned untouched — not skipped, not executed',
  );
  assert(/Paused at step 1/.test(halted.message), 'halt message names the paused step');

  // Resume mechanics: completed steps are skipped, the halt lands on the
  // NEXT unapproved step — a re-run after approval continues, not restarts.
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
    resumed.success === false && resumed.pendingApproval?.index === 1 && resumed.pendingApproval?.actionId === 'a-pay',
    're-run skips completed steps and halts on the next unapproved step',
  );

  // ask_every_time: even a no-approval-flag step halts (permission denies it).
  const plainClick = makeAction({ id: 'a-click', type: 'click', target: '#next', description: 'Click Next' });
  const askEveryTime = await computerUse.executePlan(
    makeSession([plainClick], 'ask_every_time'),
    (action) => { completions.push(action.id); },
  );
  assert(
    askEveryTime.success === false && askEveryTime.pendingApproval?.actionId === 'a-click',
    'ask_every_time permission halts pending steps instead of skipping them',
  );
  assert(completions.length === 0, 'no halt case ever executed an action');

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
  console.log('\nAll computer plan approval floor smoke cases passed.');
}

main().catch((error) => {
  console.error('FAIL: smoke harness error:', error);
  process.exit(1);
});
