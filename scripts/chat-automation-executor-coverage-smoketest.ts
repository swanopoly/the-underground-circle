/**
 * chat-automation-executor-coverage-smoketest
 *
 * Locks the Phase 1b migration matrix: every high-value Chat automation
 * prompt must classify through `buildChatAutomationPlan`, have a registered
 * executor kind, and dispatch through `dispatchChatAutomationPlan`.
 *
 * Run: `npm run smoke:chat-automation-executor-coverage`
 */

import {
  CHAT_AUTOMATION_EXECUTOR_COVERAGE_CASES,
  evaluateChatAutomationExecutorCoverage,
  getChatAutomationExecutorRequiredKinds,
} from '../src/lib/chatAutomationExecutorCoverage';
import {
  createChatTransportHandlers,
  type ChatTransportDep,
  type ChatTransportDeps,
} from '../src/lib/chatTransportHandlers';
import { buildChatAutomationPlan, type ChatAutomationExecutionKind } from '../src/lib/chatAutomationPlanner';
import { dispatchChatAutomationPlan, type ApprovalGate, type ChatTransportContext } from '../src/lib/runChatAutomationPlan';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assert(ok: boolean, name: string) { if (!ok) fail(name); else pass(name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
  else pass(name);
}

const ctx: ChatTransportContext = { circleId: 'circle-1', userId: 'user-1', chatMode: 'act' };
const approvalGate: ApprovalGate = async () => ({ pass: true });

function buildDeps(kinds: ChatAutomationExecutionKind[]): ChatTransportDeps {
  const deps: Partial<Record<ChatAutomationExecutionKind, ChatTransportDep>> = {};
  for (const kind of kinds) {
    deps[kind] = async () => ({
      status: 'completed',
      message: `handled:${kind}`,
      data: { handledByCoverageSmoke: true },
    });
  }
  return deps as ChatTransportDeps;
}

async function main() {
  const requiredKinds = getChatAutomationExecutorRequiredKinds();
  const handlers = createChatTransportHandlers(buildDeps(requiredKinds));
  const handlerKinds = Object.keys(handlers) as ChatAutomationExecutionKind[];
  const report = evaluateChatAutomationExecutorCoverage({ handlerKinds });

  assertEqual(report.total, CHAT_AUTOMATION_EXECUTOR_COVERAGE_CASES.length, 'report: includes every coverage case');
  assertEqual(report.requiredHandlerKinds, requiredKinds, 'report: required handler kinds stable');
  assertEqual(report.plannerMismatches, 0, 'report: no planner mismatches');
  assertEqual(report.missingHandlers, 0, 'report: no missing handlers when all required deps are present');
  assertEqual(report.covered, report.total, 'report: all cases covered');

  for (const testCase of CHAT_AUTOMATION_EXECUTOR_COVERAGE_CASES) {
    const plan = buildChatAutomationPlan(testCase.input);
    const outcome = await dispatchChatAutomationPlan(plan, {
      handlers,
      ctx,
      approvalGate,
    });
    assertEqual(
      outcome.status,
      'completed',
      `dispatch:${testCase.id}: completed through executor`,
    );
    assertEqual(
      outcome.executionKind,
      plan.execution.kind,
      `dispatch:${testCase.id}: execution kind preserved`,
    );
    assert(
      Boolean(outcome.data?.chatAutomationPlanPreview),
      `dispatch:${testCase.id}: plan preview attached to outcome`,
    );
  }

  {
    const gatedPlan = buildChatAutomationPlan({ message: 'Publish the homepage update to WordPress' });
    const outcome = await dispatchChatAutomationPlan(gatedPlan, {
      handlers,
      ctx,
      approvalGate: async () => ({
        pass: false,
        deferred: {
          approvalId: 'approval-1',
          message: 'Waiting for approval.',
          category: 'filed',
        },
      }),
    });
    assertEqual(outcome.status, 'deferred', 'dispatch: approval gate defers before handler');
    assert(
      Boolean(outcome.data?.chatAutomationPlanPreview),
      'dispatch: deferred approval outcome carries plan preview',
    );
  }

  const missingComputerReport = evaluateChatAutomationExecutorCoverage({
    handlerKinds: requiredKinds.filter((kind) => kind !== 'run_computer_task'),
  });
  assert(
    missingComputerReport.missingHandlers > 0,
    'report: missing run_computer_task handler is detected',
  );
  assert(
    missingComputerReport.results.some((result) => (
      result.status === 'missing_handler'
      && result.handlerKind === 'run_computer_task'
      && result.id.includes('professional_app_task')
    )),
    'report: professional app routes depend on run_computer_task handler coverage',
  );

  const missingPlainChatReport = evaluateChatAutomationExecutorCoverage({
    handlerKinds: requiredKinds.filter((kind) => kind !== 'run_plain_chat'),
  });
  assert(
    missingPlainChatReport.results.some((result) => (
      result.status === 'missing_handler'
      && result.handlerKind === 'run_plain_chat'
      && result.id === 'plain_chat_model'
    )),
    'report: plain chat route depends on run_plain_chat handler coverage',
  );

  const missingOpenSwanReport = evaluateChatAutomationExecutorCoverage({
    handlerKinds: requiredKinds.filter((kind) => kind !== 'run_openswan'),
  });
  assert(
    missingOpenSwanReport.results.some((result) => (
      result.status === 'missing_handler'
      && result.handlerKind === 'run_openswan'
      && result.id === 'openswan_mode_chat'
    )),
    'report: selected OpenSwan route depends on run_openswan handler coverage',
  );

  const mismatchReport = evaluateChatAutomationExecutorCoverage({
    cases: [{
      id: 'intentional_mismatch',
      title: 'Intentional mismatch',
      priority: 'p0',
      input: { message: 'hello there' },
      expected: {
        executionKind: 'run_command_handler',
        routeId: 'help',
      },
      userExperienceGoal: 'Prove planner drift is visible.',
      migrationOwner: 'single_executor',
    }],
    handlerKinds: requiredKinds,
  });
  assertEqual(mismatchReport.plannerMismatches, 1, 'report: planner mismatches are detected');

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-automation-executor-coverage smoke cases passed.');
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
