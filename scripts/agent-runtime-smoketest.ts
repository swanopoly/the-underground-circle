/**
 * agent-runtime-smoketest — locks in the pure runtime pieces we built
 * on top of the planner:
 *
 *   1. `dispatchChatAutomationPlan` — executor envelope (pass / defer /
 *      skipped / failed / completed).
 *   2. `detectRepeatedFlows` — "save as automation" suggestion scoring
 *      over synthetic `chatAutomationDecision` rows.
 *
 * These are pure: no Supabase, no React Native. The smoke suite
 * synthesises plans + decision rows and checks the output matches the
 * documented contract.
 *
 * Run: `npm run smoke:agent-runtime`
 */

import {
  dispatchChatAutomationPlan,
  type ChatAutomationOutcome,
  type ChatTransportContext,
  type ChatTransportHandler,
} from '../src/lib/runChatAutomationPlan';
import type { ChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { detectRepeatedFlows } from '../src/lib/repeatedFlowDetection';
import type { ChatAutomationDecisionRow } from '../src/lib/chatAutomationDecisions';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
  else pass(name);
}
function assert(ok: boolean, name: string) {
  if (!ok) fail(name); else pass(name);
}

// ─── Plan + ctx fixtures ────────────────────────────────────────────────────

const baseCtx: ChatTransportContext = {
  circleId: 'c1',
  userId: 'u1',
};

function makePlan(overrides: Partial<ChatAutomationPlan> = {}): ChatAutomationPlan {
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: 'hello' },
    execution: { kind: 'run_openswan', routeId: null, commandText: 'hello' },
    risk: 'safe',
    approval: { required: false, reason: null },
    confidence: 0.4,
    notes: ['test'],
    ...overrides,
  };
}

async function runDispatchCases() {
  // ─── dispatch: completed path ─────────────────────────────────────────────
  {
    const handler: ChatTransportHandler = async () => ({
      executionKind: 'run_openswan',
      status: 'completed',
      message: 'did the thing',
    });
    const outcome = await dispatchChatAutomationPlan(makePlan(), {
      handlers: { run_openswan: handler },
      ctx: baseCtx,
    });
    assertEqual(outcome.status, 'completed', 'dispatch: completed status');
    assertEqual(outcome.executionKind, 'run_openswan', 'dispatch: echoes execution kind');
    assert(outcome.durationMs !== undefined && outcome.durationMs >= 0, 'dispatch: durationMs populated');
  }

  // ─── dispatch: skipped when no handler ──────────────────────────────────
  {
    const outcome = await dispatchChatAutomationPlan(makePlan({
      execution: { kind: 'run_browser_plan', routeId: 'browser', commandText: 'do it' },
    }), {
      handlers: {},
      ctx: baseCtx,
    });
    assertEqual(outcome.status, 'skipped', 'dispatch: skipped when no handler');
    assertEqual(outcome.executionKind, 'skipped', 'dispatch: skipped executionKind');
    assert(outcome.message.toLowerCase().includes('no handler'), 'dispatch: skipped message explains why');
  }

  // ─── dispatch: failed when handler throws ───────────────────────────────
  {
    const handler: ChatTransportHandler = async () => {
      throw new Error('kaboom');
    };
    const outcome = await dispatchChatAutomationPlan(makePlan(), {
      handlers: { run_openswan: handler },
      ctx: baseCtx,
    });
    assertEqual(outcome.status, 'failed', 'dispatch: failed when handler throws');
    assert(outcome.message.includes('kaboom'), 'dispatch: surfaces thrown message');
  }

  // ─── dispatch: deferred when approvalGate refuses ──────────────────────
  {
    const outcome = await dispatchChatAutomationPlan(
      makePlan({
        approval: { required: true, reason: 'external side effect' },
      }),
      {
        handlers: {
          run_openswan: async () => ({ executionKind: 'run_openswan', status: 'completed', message: 'ran' }),
        },
        ctx: baseCtx,
        approvalGate: async () => ({
          pass: false,
          deferred: { approvalId: 'a1', message: 'pending review' },
        }),
      },
    );
    assertEqual(outcome.status, 'deferred', 'dispatch: deferred when gate denies');
    assertEqual(outcome.approvalId, 'a1', 'dispatch: approvalId passthrough');
    assert(outcome.message === 'pending review', 'dispatch: deferred message passthrough');
    // Backward-compat: a gate that omits category emits no approvalCategory.
    assert(outcome.data === undefined || (outcome.data as any).approvalCategory === undefined,
      'dispatch: no category when gate omits it');
  }

  // ─── dispatch: deferral category + retryable propagate (C7) ────────────
  {
    // A retryable transient error category should surface retryable=true.
    const errOutcome = await dispatchChatAutomationPlan(
      makePlan({ approval: { required: true, reason: 'side effect' } }),
      {
        handlers: { run_openswan: async () => ({ executionKind: 'run_openswan', status: 'completed', message: 'ran' }) },
        ctx: baseCtx,
        approvalGate: async () => ({
          pass: false,
          deferred: { approvalId: '', message: 'lookup failed', category: 'error' as const },
        }),
      },
    );
    assertEqual(errOutcome.status, 'deferred', 'dispatch(C7): error category still defers');
    assertEqual((errOutcome.data as any)?.approvalCategory, 'error', 'dispatch(C7): error category surfaced');
    assertEqual((errOutcome.data as any)?.approvalRetryable, true, 'dispatch(C7): error derives retryable=true');

    // A human-decision category (rejected) must NOT be retryable.
    const rejOutcome = await dispatchChatAutomationPlan(
      makePlan({ approval: { required: true, reason: 'side effect' } }),
      {
        handlers: { run_openswan: async () => ({ executionKind: 'run_openswan', status: 'completed', message: 'ran' }) },
        ctx: baseCtx,
        approvalGate: async () => ({
          pass: false,
          deferred: { approvalId: 'r1', message: 'rejected by human', category: 'rejected' as const },
        }),
      },
    );
    assertEqual((rejOutcome.data as any)?.approvalCategory, 'rejected', 'dispatch(C7): rejected category surfaced');
    assertEqual((rejOutcome.data as any)?.approvalRetryable, false, 'dispatch(C7): rejected derives retryable=false');
  }

  // ─── dispatch: pass when approvalGate approves ─────────────────────────
  {
    let ran = false;
    const outcome = await dispatchChatAutomationPlan(
      makePlan({ approval: { required: true, reason: 'ok' } }),
      {
        handlers: {
          run_openswan: async () => {
            ran = true;
            return { executionKind: 'run_openswan', status: 'completed', message: 'approved' };
          },
        },
        ctx: baseCtx,
        approvalGate: async () => ({ pass: true }),
      },
    );
    assert(ran, 'dispatch: handler ran when gate passed');
    assertEqual(outcome.status, 'completed', 'dispatch: completed after gate pass');
  }

  // ─── dispatch: gate can enforce policy even when plan approval is false ─
  {
    let ran = false;
    const outcome = await dispatchChatAutomationPlan(
      makePlan({ approval: { required: false, reason: null } }),
      {
        handlers: {
          run_openswan: async () => {
            ran = true;
            return { executionKind: 'run_openswan', status: 'completed', message: 'should not run' };
          },
        },
        ctx: baseCtx,
        approvalGate: async () => ({
          pass: false,
          deferred: {
            approvalId: '',
            message: 'blocked by category policy',
            category: 'blocked_policy' as const,
            retryable: false,
          },
        }),
      },
    );
    assertEqual(ran, false, 'dispatch(C7): safe plan gate can prevent handler');
    assertEqual(outcome.status, 'deferred', 'dispatch(C7): safe plan policy block defers');
    assertEqual((outcome.data as any)?.approvalCategory, 'blocked_policy', 'dispatch(C7): safe plan policy category surfaced');
  }

  // ─── dispatch: observer fires for every path ──────────────────────────
  {
    const seen: Array<{ planKind: string; outcomeStatus: ChatAutomationOutcome['status'] }> = [];
    await dispatchChatAutomationPlan(makePlan(), {
      handlers: { run_openswan: async () => ({ executionKind: 'run_openswan', status: 'completed', message: 'x' }) },
      ctx: baseCtx,
      onOutcome: (plan, outcome) => {
        seen.push({ planKind: plan.execution.kind, outcomeStatus: outcome.status });
      },
    });
    await dispatchChatAutomationPlan(
      makePlan({ execution: { kind: 'run_browser_plan', routeId: 'browser', commandText: '' } }),
      {
        handlers: {},
        ctx: baseCtx,
        onOutcome: (plan, outcome) => {
          seen.push({ planKind: plan.execution.kind, outcomeStatus: outcome.status });
        },
      },
    );
    assertEqual(seen.length, 2, 'observer: fired for both dispatches');
    assertEqual(seen[0], { planKind: 'run_openswan',     outcomeStatus: 'completed' }, 'observer: first entry');
    assertEqual(seen[1], { planKind: 'run_browser_plan', outcomeStatus: 'skipped'   }, 'observer: second entry');
  }
}

// ─── detectRepeatedFlows: no false positives ────────────────────────────────

function makeRow(opts: {
  runId: string;
  kind: string;
  routeId?: string | null;
  commandText?: string;
  startedAt: string;
  outcome?: string;
}): ChatAutomationDecisionRow {
  return {
    runId: opts.runId,
    circleId: 'c1',
    userId: 'u1',
    surface: 'main_chat',
    mode: null,
    title: 'x',
    startedAt: opts.startedAt,
    completedAt: opts.startedAt,
    status: 'completed',
    decision: {
      executionKind: opts.kind,
      routeId: opts.routeId ?? null,
      commandText: opts.commandText ?? '',
    },
    outcomeStatus: opts.outcome ?? 'completed',
    outcomeDurationMs: 500,
    approvalId: null,
  };
}

// One-off rows don't trigger suggestions.
{
  const rows: ChatAutomationDecisionRow[] = [
    makeRow({ runId: 'r1', kind: 'run_openswan', commandText: 'hi',  startedAt: '2026-04-20T10:00:00Z' }),
    makeRow({ runId: 'r2', kind: 'run_openswan', commandText: 'hey', startedAt: '2026-04-20T11:00:00Z' }),
  ];
  const suggestions = detectRepeatedFlows(rows);
  assertEqual(suggestions.length, 0, 'detector: ignores low-frequency patterns');
}

// Repeated run_command_handler → flagged with cadence + score.
{
  const rows: ChatAutomationDecisionRow[] = [
    makeRow({ runId: 'r1', kind: 'run_command_handler', routeId: 'mission', commandText: '/summary', startedAt: '2026-04-18T09:00:00Z' }),
    makeRow({ runId: 'r2', kind: 'run_command_handler', routeId: 'mission', commandText: '/summary', startedAt: '2026-04-19T09:05:00Z' }),
    makeRow({ runId: 'r3', kind: 'run_command_handler', routeId: 'mission', commandText: '/summary', startedAt: '2026-04-20T09:10:00Z' }),
    makeRow({ runId: 'r4', kind: 'run_command_handler', routeId: 'mission', commandText: '/summary', startedAt: '2026-04-21T09:15:00Z' }),
  ];
  const suggestions = detectRepeatedFlows(rows);
  assertEqual(suggestions.length, 1, 'detector: flags 4 daily summary runs');
  const s = suggestions[0];
  assertEqual(s.executionKind,       'run_command_handler', 'detector: executionKind preserved');
  assertEqual(s.routeId,             'mission',             'detector: routeId preserved');
  assertEqual(s.commandFingerprint,  '/summary',            'detector: commandFingerprint preserved');
  assertEqual(s.occurrences,         4,                     'detector: occurrences counted');
  assertEqual(s.completedCount,      4,                     'detector: completed counted');
  assertEqual(s.cadence,             'daily',               'detector: daily cadence classified');
  assert(s.score > 40, 'detector: score reflects frequency + cadence');
  assertEqual(s.exampleRunIds, ['r1', 'r2', 'r3', 'r4'],    'detector: exampleRunIds captured');
}

// Low success rate gets filtered.
{
  const rows: ChatAutomationDecisionRow[] = Array.from({ length: 5 }, (_, i) =>
    makeRow({
      runId: `r${i}`,
      kind: 'run_browser_plan',
      commandText: 'open x',
      startedAt: `2026-04-2${i}T09:00:00Z`,
      outcome: i < 2 ? 'completed' : 'failed',  // 2/5 success = 40%
    }),
  );
  const suggestions = detectRepeatedFlows(rows);
  assertEqual(suggestions.length, 0, 'detector: filters low success-rate patterns');
}

// Local replies excluded from detection even if frequent.
{
  const rows: ChatAutomationDecisionRow[] = Array.from({ length: 6 }, (_, i) =>
    makeRow({
      runId: `r${i}`,
      kind: 'local_reply',
      commandText: 'thanks',
      startedAt: `2026-04-2${i}T09:00:00Z`,
    }),
  );
  const suggestions = detectRepeatedFlows(rows);
  assertEqual(suggestions.length, 0, 'detector: excludes local_reply noise');
}

// maxSuggestions bound respected.
{
  const rows: ChatAutomationDecisionRow[] = [];
  // 3 distinct patterns x 3 runs each = 9 rows → should yield 3 suggestions,
  // capped to 2 via option.
  for (const kind of ['run_openswan', 'run_command_handler', 'run_build_discovery']) {
    for (let i = 0; i < 3; i++) {
      rows.push(makeRow({
        runId: `${kind}-${i}`,
        kind,
        commandText: kind,
        startedAt: `2026-04-${18 + i}T09:00:00Z`,
      }));
    }
  }
  const suggestions = detectRepeatedFlows(rows, { maxSuggestions: 2 });
  assertEqual(suggestions.length, 2, 'detector: maxSuggestions cap applied');
}

// ─── Entrypoint ─────────────────────────────────────────────────────────────
// tsx transforms to CJS, which doesn't allow top-level await. Wrap the
// async dispatch suite in a main() and run it.

runDispatchCases()
  .catch((err) => {
    console.error('runtime smoke crashed:', err);
    process.exit(1);
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n${failures} runtime smoke failure(s)`);
      process.exit(1);
    }
    console.log('\nAll agent-runtime smoke cases passed.');
  });
