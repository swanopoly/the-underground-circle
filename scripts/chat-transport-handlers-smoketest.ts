/**
 * chat-transport-handlers-smoketest — locks in the C1 "single executor
 * handler map" factory (`createChatTransportHandlers`) and its integration
 * with the real `dispatchChatAutomationPlan`.
 *
 * Pure: no Supabase, no React Native — deps are mocked.
 * Run: `npm run smoke:chat-transport-handlers`
 */

import {
  createChatTransportHandlers,
  type ChatTransportDeps,
} from '../src/lib/chatTransportHandlers';
import {
  dispatchChatAutomationPlan,
  type ChatTransportContext,
} from '../src/lib/runChatAutomationPlan';
import type {
  ChatAutomationPlan,
  ChatAutomationExecutionKind,
} from '../src/lib/chatAutomationPlanner';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assert(ok: boolean, name: string) { if (!ok) fail(name); else pass(name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`); else pass(name);
}

const ctx: ChatTransportContext = { circleId: 'c1', userId: 'u1' };

function planFor(kind: ChatAutomationExecutionKind, overrides: Partial<ChatAutomationPlan> = {}): ChatAutomationPlan {
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: 'hi' },
    execution: { kind, routeId: null, commandText: 'hi' },
    risk: 'safe',
    approval: { required: false, reason: null },
    confidence: 0.5,
    notes: [],
    ...overrides,
  };
}

async function main() {
  // ─── only provided kinds appear in the map ─────────────────────────────
  {
    const handlers = createChatTransportHandlers({
      run_openswan: async () => ({ message: 'ran' }),
      local_reply: async () => ({ message: 'local' }),
    });
    const keys = Object.keys(handlers).sort();
    assertEqual(keys, ['local_reply', 'run_openswan'], 'map: only provided kinds present');
  }

  // ─── handler routes to its dep + returns completed ─────────────────────
  {
    let seenMessage = '';
    const handlers = createChatTransportHandlers({
      run_openswan: async (plan) => {
        seenMessage = plan.execution.commandText || '';
        return { message: 'done', runId: 'r1' };
      },
    });
    const outcome = await handlers.run_openswan!(planFor('run_openswan'), ctx);
    assertEqual(outcome.status, 'completed', 'handler: completed status');
    assertEqual(outcome.executionKind, 'run_openswan', 'handler: executionKind echoed');
    assertEqual(outcome.message, 'done', 'handler: message passthrough');
    assertEqual(outcome.runId, 'r1', 'handler: runId passthrough');
    assertEqual(seenMessage, 'hi', 'handler: dep received the plan');
  }

  // ─── dep returning handled:false → skipped (legacy fallback) ───────────
  {
    const handlers = createChatTransportHandlers({
      run_computer_task: async () => ({ handled: false }),
    });
    const outcome = await handlers.run_computer_task!(planFor('run_computer_task'), ctx);
    assertEqual(outcome.status, 'skipped', 'decline: skipped status');
    assertEqual(outcome.executionKind, 'skipped', 'decline: executionKind skipped');
  }

  // ─── dep that throws → failed (never throws across boundary) ───────────
  {
    const handlers = createChatTransportHandlers({
      run_openswan: async () => { throw new Error('boom'); },
    });
    let threw = false;
    let outcome;
    try { outcome = await handlers.run_openswan!(planFor('run_openswan'), ctx); }
    catch { threw = true; }
    assert(!threw, 'throw: handler did not rethrow');
    assertEqual(outcome?.status, 'failed', 'throw: failed status');
    assert(!!outcome && outcome.message.includes('boom'), 'throw: error message surfaced');
  }

  // ─── custom status + data/warnings passthrough ─────────────────────────
  {
    const handlers = createChatTransportHandlers({
      run_circle_automation: async () => ({
        status: 'deferred', message: 'awaiting', data: { x: 1 }, warnings: ['w'], approvalId: 'a1',
      }),
    });
    const outcome = await handlers.run_circle_automation!(planFor('run_circle_automation'), ctx);
    assertEqual(outcome.status, 'deferred', 'custom: status passthrough');
    assertEqual((outcome.data as any)?.x, 1, 'custom: data passthrough');
    assertEqual(outcome.warnings, ['w'], 'custom: warnings passthrough');
    assertEqual(outcome.approvalId, 'a1', 'custom: approvalId passthrough');
  }

  // ─── integration: dispatcher picks the right handler by kind ───────────
  {
    let ranKind = '';
    const handlers = createChatTransportHandlers({
      run_openswan: async () => { ranKind = 'run_openswan'; return { message: 'ok' }; },
      local_reply: async () => { ranKind = 'local_reply'; return { message: 'local' }; },
    });
    const outcome = await dispatchChatAutomationPlan(planFor('run_openswan'), { handlers, ctx });
    assertEqual(ranKind, 'run_openswan', 'dispatch: routed to run_openswan dep');
    assertEqual(outcome.status, 'completed', 'dispatch: completed');
    assert(typeof outcome.durationMs === 'number', 'dispatch: durationMs stamped');
  }

  // ─── integration: un-wired kind → dispatcher skipped (legacy fallback) ─
  {
    const handlers = createChatTransportHandlers({ run_openswan: async () => ({ message: 'ok' }) });
    const outcome = await dispatchChatAutomationPlan(planFor('run_browser_plan'), { handlers, ctx });
    assertEqual(outcome.status, 'skipped', 'dispatch: unwired kind → skipped');
    assert(outcome.message.toLowerCase().includes('no handler'), 'dispatch: skip message explains fallback');
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nAll chat-transport-handlers smoke cases passed.');
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
