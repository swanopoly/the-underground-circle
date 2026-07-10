/**
 * tool-loop-stuck-breaker-smoketest
 *
 * Covers three layers:
 *   1. The nudge guard (`appendStuckBreaker`/`detectStuckRepeat`): a tool call
 *      whose (name+input) signature already failed gets a "do something
 *      different" reminder appended to its tool_result.
 *   2. The progress-based stop primitives (`hashToolInput`,
 *      `detectRepeatedToolFailure`): stable key-sorted bounded hashing, and a
 *      deterministic "3 identical failing calls in a row → stop" signal.
 *   3. The runAgent WIRING: the typed loop stops before re-running an identical
 *      failing call a ~3rd time and emits `loop_stopped_no_progress`, while
 *      repeated-DIFFERENT and repeated-SUCCESSFUL rounds run unimpeded.
 *
 * Run: npm run smoke:tool-loop-stuck-breaker
 */

import assert from 'node:assert/strict';

import {
  toolCallSignature,
  detectStuckRepeat,
  stuckBreakerReminder,
  appendStuckBreaker,
  hashToolInput,
  detectRepeatedToolFailure,
  TOOL_INPUT_HASH_MAX_CHARS,
  type ToolCallRecord,
  type RecentToolCall,
} from '../src/lib/toolLoopStuckBreaker';
import {
  runAgent,
  type AgentEvent,
  type AgentMessageContentBlock,
  type AgentProvider,
  type AgentToolDefinition,
  type ProviderTurnResult,
} from '../src/lib/agentExecutionCore';

// ── toolCallSignature: key order doesn't matter, different inputs differ ─────
assert.equal(
  toolCallSignature('desktop.click_element', { label: 'Export', app: 'Photoshop' }),
  toolCallSignature('desktop.click_element', { app: 'Photoshop', label: 'Export' }),
  'object key order is normalized',
);
assert.notEqual(
  toolCallSignature('desktop.click_element', { label: 'Export' }),
  toolCallSignature('desktop.click_element', { label: 'Save' }),
  'different inputs → different signatures',
);
assert.notEqual(
  toolCallSignature('desktop.click_element', { label: 'Export' }),
  toolCallSignature('desktop.menu_click', { label: 'Export' }),
  'different tool → different signature',
);

// ── detectStuckRepeat ────────────────────────────────────────────────────────
const history: ToolCallRecord[] = [
  { tool: 'desktop.read_a11y_tree', input: {}, status: 'success', result: '{"ok":true}' },
  { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'error', result: '{"ok":false,"error":"element not found: Export"}' },
];

// Same call that already failed → flagged with the prior reason.
const repeat = detectStuckRepeat(history, { tool: 'desktop.click_element', input: { label: 'Export' } });
assert.equal(repeat.isRepeat, true, 'exact repeat of a failed call is detected');
assert.equal(repeat.priorFailures, 1, 'counts one prior failure');
assert(repeat.lastReason && repeat.lastReason.includes('element not found'), 'carries the prior failure reason');

// Changed input (model fixed its approach) → NOT flagged.
const fixed = detectStuckRepeat(history, { tool: 'desktop.click_element', input: { label: 'File' } });
assert.equal(fixed.isRepeat, false, 'a changed input is not treated as stuck');

// A call that only ever succeeded → NOT flagged.
const successOnly = detectStuckRepeat(history, { tool: 'desktop.read_a11y_tree', input: {} });
assert.equal(successOnly.isRepeat, false, 'a previously-successful call is not flagged');

// Two prior failures accumulate.
const history2: ToolCallRecord[] = [
  ...history,
  { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'failed', result: 'still not found' },
];
assert.equal(detectStuckRepeat(history2, { tool: 'desktop.click_element', input: { label: 'Export' } }).priorFailures, 2);

// Lookback window bounds the scan (old failure beyond the window is ignored).
const padded: ToolCallRecord[] = [
  { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'error', result: 'old failure' },
  ...Array.from({ length: 30 }, (_, i) => ({ tool: `desktop.noop_${i}`, input: {}, status: 'success', result: 'ok' })),
];
assert.equal(
  detectStuckRepeat(padded, { tool: 'desktop.click_element', input: { label: 'Export' } }, { lookback: 5 }).isRepeat,
  false,
  'failures older than the lookback window are not counted',
);

// ── stuckBreakerReminder content ─────────────────────────────────────────────
const reminder = stuckBreakerReminder('desktop.click_element', 1, 'element not found: Export');
assert(/Stuck-loop guard/i.test(reminder), 'has the guard header');
assert(reminder.includes('failed 2 times'), 'reports total attempt count (prior + current)');
assert(reminder.includes('element not found: Export'), 'names the last error');
assert(/Re-observe/i.test(reminder) && /stop and report/i.test(reminder), 'lists re-observe + stop alternatives');
// A known UI-action tool → escalation names the concrete next surfaces.
assert(reminder.includes('desktop.menu_click') && reminder.includes('desktop.click_at'), 'escalation names the specific next surfaces for click_element');
assert(/Do NOT call it again unchanged/i.test(reminder), 'forbids the identical retry');

// A non-UI-action tool (no surface ladder) → generic ladder wording.
const genericReminder = stuckBreakerReminder('desktop.file_stat', 1, 'no such file');
assert(/Escalate the surface ladder/i.test(genericReminder), 'a non-action tool falls back to the generic ladder line');
assert(!genericReminder.includes('desktop.menu_click'), 'no fabricated next tool for a non-action tool');

// ── appendStuckBreaker: only augments a repeated failure ─────────────────────
const base = '{"ok":false,"error":"element not found: Export"}';
const augmented = appendStuckBreaker(base, history, { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'error' });
assert(augmented.startsWith(base), 'keeps the original tool_result content');
assert(augmented.includes('Stuck-loop guard'), 'appends the breaker when the failing call repeats a prior failure');

// First-time failure (no prior) → unchanged.
const firstFail = appendStuckBreaker('{"ok":false,"error":"x"}', history, { tool: 'desktop.menu_click', input: { label: 'New' }, status: 'error' });
assert.equal(firstFail, '{"ok":false,"error":"x"}', 'a first-time failure is not nudged (it might just need a retry)');

// A successful repeat → unchanged (only failures are nudged).
const okRepeat = appendStuckBreaker('{"ok":true}', history, { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'success' });
assert.equal(okRepeat, '{"ok":true}', 'a now-succeeding call is never nudged');

// ── hashToolInput: stable, key-order-independent, bounded ────────────────────
assert.equal(
  hashToolInput({ label: 'Export', app: 'Photoshop' }),
  hashToolInput({ app: 'Photoshop', label: 'Export' }),
  'hash: object key order is normalized',
);
assert.equal(
  hashToolInput({ a: 1, nested: { x: 1, y: 2 } }),
  hashToolInput({ nested: { y: 2, x: 1 }, a: 1 }),
  'hash: nested object key order is normalized',
);
assert.notEqual(
  hashToolInput({ label: 'Export' }),
  hashToolInput({ label: 'Save' }),
  'hash: different inputs → different hashes',
);
assert.notEqual(
  hashToolInput({ label: 'Export' }),
  hashToolInput({ label: 'Exports' }),
  'hash: a near-identical input still differs',
);
assert.equal(hashToolInput(undefined), hashToolInput(null), 'hash: undefined and null both canonicalize to null');
assert.equal(typeof hashToolInput({ a: 1 }), 'string', 'hash: returns a string');
assert.equal(hashToolInput({ a: 1 }), hashToolInput({ a: 1 }), 'hash: deterministic across calls');
// Array order is significant (unlike object keys).
assert.notEqual(hashToolInput([1, 2, 3]), hashToolInput([3, 2, 1]), 'hash: array order is significant');
// Bounded: a giant input is hashed over a bounded prefix but still produces a
// short digest, and two giant inputs that differ only past the bound may share
// a digest — that is the accepted trade-off (documented) and must not throw.
{
  const bigA = { blob: 'x'.repeat(TOOL_INPUT_HASH_MAX_CHARS * 4) };
  // Differs from bigA only PAST the hash bound → accepted-collision trade-off.
  const bigBeyondBound = { blob: 'x'.repeat(TOOL_INPUT_HASH_MAX_CHARS * 4) + 'DIFFERENT_TAIL' };
  const hA = hashToolInput(bigA);
  assert.ok(hA.length < 64, 'hash: digest stays short even for a huge input');
  assert.equal(hA, hashToolInput(bigA), 'hash: huge input is deterministic');
  assert.equal(hA, hashToolInput(bigBeyondBound), 'hash: inputs differing only past the bound collide (documented trade-off)');
  // Inputs that differ WITHIN the bound are still distinguished.
  const bigDiffInBound = { blob: 'y' + 'x'.repeat(TOOL_INPUT_HASH_MAX_CHARS * 4) };
  assert.notEqual(hA, hashToolInput(bigDiffInBound), 'hash: a difference within the bound is still distinguished');
}
// Circular structures fail closed to a string form rather than throwing.
{
  const cyc: any = { a: 1 };
  cyc.self = cyc;
  assert.equal(typeof hashToolInput(cyc), 'string', 'hash: circular input does not throw');
}

// ── detectRepeatedToolFailure: progress-based stop signal ────────────────────
const sig = (name: string, input: unknown, ok: boolean): RecentToolCall =>
  ({ name, inputHash: hashToolInput(input), ok });

// Fires on exactly 3 identical failing calls (default threshold).
{
  const calls = [
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
  ];
  const v = detectRepeatedToolFailure(calls);
  assert.equal(v.stuck, true, 'stuck: 3 identical failing calls trip the guard');
  assert.ok(v.reason.includes('desktop.click_element'), 'stuck: reason names the tool');
  assert.ok(/x3/.test(v.reason), 'stuck: reason states the repeat count');
}

// BOUNDARY: exactly 2 identical failures do NOT trip (threshold is 3).
{
  const calls = [
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
  ];
  assert.equal(detectRepeatedToolFailure(calls).stuck, false, 'boundary: 2 identical failures do NOT trip');
}

// BOUNDARY: only the LAST 3 are inspected — a leading failure followed by
// success then 2 more identical failures is NOT 3-in-a-row.
{
  const calls = [
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.read_a11y_tree', {}, true),
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
  ];
  assert.equal(detectRepeatedToolFailure(calls).stuck, false, 'boundary: window must be the contiguous last 3');
}

// A DIFFERENT input in the window does NOT trip (model changed its approach).
{
  const calls = [
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'File' }, false),
  ];
  assert.equal(detectRepeatedToolFailure(calls).stuck, false, 'different input in the window → not stuck');
}

// A DIFFERENT tool in the window does NOT trip.
{
  const calls = [
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.menu_click', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
  ];
  assert.equal(detectRepeatedToolFailure(calls).stuck, false, 'different tool in the window → not stuck');
}

// SUCCESSES never trip — even 3 identical successful calls are legitimate.
{
  const calls = [
    sig('desktop.read_a11y_tree', {}, true),
    sig('desktop.read_a11y_tree', {}, true),
    sig('desktop.read_a11y_tree', {}, true),
  ];
  assert.equal(detectRepeatedToolFailure(calls).stuck, false, '3 identical SUCCESSES → not stuck');
}

// A single success among the last 3 failing-identical calls breaks the streak.
{
  const calls = [
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, true),
    sig('desktop.click_element', { label: 'Export' }, false),
  ];
  assert.equal(detectRepeatedToolFailure(calls).stuck, false, 'a success in the window breaks the failing streak');
}

// Fewer than threshold calls (0/1) never trip.
assert.equal(detectRepeatedToolFailure([]).stuck, false, 'empty ring → not stuck');
assert.equal(detectRepeatedToolFailure(null).stuck, false, 'null ring → not stuck');
assert.equal(
  detectRepeatedToolFailure([sig('t', {}, false)]).stuck,
  false,
  'single failing call → not stuck',
);

// A longer ring where only the last 3 are identical failures DOES trip
// (older, unrelated calls before the streak are ignored).
{
  const calls = [
    sig('desktop.read_a11y_tree', {}, true),
    sig('desktop.menu_click', { label: 'File' }, true),
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
    sig('desktop.click_element', { label: 'Export' }, false),
  ];
  assert.equal(detectRepeatedToolFailure(calls).stuck, true, 'last-3 identical failures trip regardless of earlier history');
}

// Custom threshold is honored (and floored at 2).
{
  const four = Array.from({ length: 4 }, () => sig('t', { x: 1 }, false));
  assert.equal(detectRepeatedToolFailure(four.slice(0, 3), { threshold: 4 }).stuck, false, 'threshold 4: 3 identical failures not yet stuck');
  assert.equal(detectRepeatedToolFailure(four, { threshold: 4 }).stuck, true, 'threshold 4: 4 identical failures trip');
  const two = [sig('t', { x: 1 }, false), sig('t', { x: 1 }, false)];
  assert.equal(detectRepeatedToolFailure(two, { threshold: 2 }).stuck, true, 'threshold 2 honored');
}

// ── runAgent WIRING: progress-based stop inside the typed loop ───────────────

function scriptedProvider(turns: ProviderTurnResult[]): AgentProvider {
  let i = 0;
  return { async turn() { return turns[Math.min(i++, turns.length - 1)]; } };
}
/** A provider that always asks to run `tool` with `input` (an infinite loop of
 *  the same call) — the exact runaway shape the guard must interrupt. */
function foreverToolProvider(tool: string, input: unknown): AgentProvider {
  let n = 0;
  return {
    async turn() {
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_${n++}`, name: tool, input }] };
    },
  };
}
const alwaysFail: AgentToolDefinition = {
  name: 'failer',
  description: 'always fails',
  input_schema: { type: 'object', properties: {} },
  async handler() { return { ok: false, error: 'element not found: Export' }; },
};

async function runAgentWiring() {
  // a) Identical failing call is NOT run a 3rd time; the loop stops with a
  //    progress-based terminal note + event, well under the iteration cap.
  {
    let handlerCalls = 0;
    const countingFailer: AgentToolDefinition = {
      ...alwaysFail,
      async handler() { handlerCalls += 1; return { ok: false, error: 'element not found: Export' }; },
    };
    const events: AgentEvent[] = [];
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [countingFailer],
      provider: foreverToolProvider('failer', { label: 'Export' }),
      maxIterations: 20,
      onEvent: (e) => events.push(e),
    });
    assert.equal(handlerCalls, 2, 'wiring: identical failing call ran only twice (3rd refused before dispatch)');
    assert.equal(result.hitMaxIterations, false, 'wiring: stopped on progress, NOT the iteration cap');
    assert.ok(result.iterations < 20, 'wiring: exited well before maxIterations');
    const stopEvent = events.find((e) => e.kind === 'loop_stopped_no_progress');
    assert.ok(stopEvent, 'wiring: loop_stopped_no_progress emitted');
    if (stopEvent && stopEvent.kind === 'loop_stopped_no_progress') {
      assert.ok(stopEvent.reason.includes('failer') && /x3/.test(stopEvent.reason), 'wiring: stop event names the tool + count');
    }
    assert.ok(/^stopped:/.test(result.text), 'wiring: terminal text explains the stop');
    // Transcript stays well-formed: the final assistant tool_use is closed by a
    // terminal tool_result (no dangling tool_use).
    const last = result.messages[result.messages.length - 1];
    const lastBlocks = last.content as AgentMessageContentBlock[];
    assert.ok(last.role === 'user' && lastBlocks[0]?.type === 'tool_result' && lastBlocks[0].is_error === true,
      'wiring: dangling tool_use is closed by a terminal error tool_result');
  }

  // b) The error tool_result the model sees is led by the classified recovery
  //    hint (not a raw error) — the anti-apology-loop upgrade.
  {
    const captured: AgentMessageContentBlock[][] = [];
    const provider: AgentProvider = {
      async turn(args) {
        captured.push(JSON.parse(JSON.stringify(args.messages.map((m) => m.content))) as any);
        return foreverToolProvider('failer', { label: 'Export' }).turn(args as any);
      },
    };
    await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [alwaysFail],
      provider,
      maxIterations: 20,
    });
    // The 2nd provider turn saw the 1st failure's tool_result.
    const secondTurn = captured[1];
    const trMsg = secondTurn[secondTurn.length - 1] as unknown as AgentMessageContentBlock[];
    const tr = Array.isArray(trMsg) ? trMsg.find((b) => b.type === 'tool_result') : null;
    assert.ok(tr && tr.type === 'tool_result' && typeof tr.content === 'string', 'wiring: error tool_result present');
    if (tr && tr.type === 'tool_result' && typeof tr.content === 'string') {
      assert.ok(tr.content.startsWith('[recovery] '), 'wiring: error content leads with the recovery hint');
      assert.ok(tr.content.includes('element not found'), 'wiring: original error still visible to the model');
      assert.ok(tr.content.includes('"ok":false'), 'wiring: legacy error envelope preserved for downstream parsers');
    }
  }

  // c) Repeated DIFFERENT failing calls are NOT interrupted (the model is
  //    exploring, not stuck) — it runs until it succeeds.
  {
    let handlerCalls = 0;
    const differ: AgentToolDefinition = {
      name: 'differ',
      description: 'fails unless label=ok',
      input_schema: { type: 'object', properties: { label: { type: 'string' } } },
      async handler(input) {
        handlerCalls += 1;
        const label = (input as { label?: string }).label;
        return label === 'ok' ? { ok: true, data: { done: true } } : { ok: false, error: 'element not found' };
      },
    };
    const provider = scriptedProvider([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'differ', input: { label: 'A' } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'differ', input: { label: 'B' } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'differ', input: { label: 'C' } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't4', name: 'differ', input: { label: 'ok' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [differ],
      provider,
      maxIterations: 20,
      onEvent: (e) => events.push(e),
    });
    assert.equal(handlerCalls, 4, 'wiring: different-input failures all ran (not interrupted)');
    assert.equal(result.text, 'done', 'wiring: exploration reached success');
    assert.ok(!events.some((e) => e.kind === 'loop_stopped_no_progress'), 'wiring: no false stop on different inputs');
  }

  // d) Repeated SUCCESSFUL identical calls are NOT interrupted.
  {
    let handlerCalls = 0;
    const okTool: AgentToolDefinition = {
      name: 'poll',
      description: 'always ok',
      input_schema: { type: 'object', properties: {} },
      async handler() { handlerCalls += 1; return { ok: true, data: { n: handlerCalls } }; },
    };
    const provider = scriptedProvider([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p1', name: 'poll', input: {} }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p2', name: 'poll', input: {} }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p3', name: 'poll', input: {} }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p4', name: 'poll', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'polled' }] },
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'poll it' }],
      tools: [okTool],
      provider,
      maxIterations: 20,
      onEvent: (e) => events.push(e),
    });
    assert.equal(handlerCalls, 4, 'wiring: identical SUCCESSFUL calls all ran');
    assert.equal(result.text, 'polled', 'wiring: successful polling completes');
    assert.ok(!events.some((e) => e.kind === 'loop_stopped_no_progress'), 'wiring: no false stop on repeated successes');
  }

  // e) A multi-tool round is never blocked by the single-tool guard, even when
  //    both fail — the guard targets a single re-sampled failing call.
  {
    let handlerCalls = 0;
    const multiFail: AgentToolDefinition = {
      name: 'mf',
      description: 'fails',
      input_schema: { type: 'object', properties: { k: { type: 'string' } } },
      async handler() { handlerCalls += 1; return { ok: false, error: 'element not found' }; },
    };
    const twoUses: AgentMessageContentBlock[] = [
      { type: 'tool_use', id: 'm1', name: 'mf', input: { k: 'a' } },
      { type: 'tool_use', id: 'm2', name: 'mf', input: { k: 'b' } },
    ];
    const provider = scriptedProvider([
      { stop_reason: 'tool_use', content: twoUses },
      { stop_reason: 'tool_use', content: twoUses },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [multiFail],
      provider,
      maxIterations: 20,
      onEvent: (e) => events.push(e),
    });
    assert.equal(handlerCalls, 4, 'wiring: multi-tool rounds are not interrupted by the single-call guard');
    assert.equal(result.text, 'ok', 'wiring: multi-tool run completes normally');
    assert.ok(!events.some((e) => e.kind === 'loop_stopped_no_progress'), 'wiring: no stop event for a multi-tool round');
  }
}

runAgentWiring()
  .then(() => console.log('All tool loop stuck-breaker smoke cases passed.'))
  .catch((err) => { console.error('FAIL:', err); process.exit(1); });
