/**
 * agent-core-smoketest — pure TS smoke test for AgentExecutionCore.
 *
 * Exercises the loop against a hand-rolled mock provider so we catch
 * regressions before they reach real Anthropic traffic. Intentionally
 * framework-free: runnable via `tsx scripts/agent-core-smoketest.ts` or
 * compiled with `npx tsc --outDir .tmp --module esnext ... && node`.
 *
 * What it covers:
 *   1. Single-turn text response → AgentRunResult.text populated.
 *   2. Two-turn tool_use → tool_result → end_turn flow.
 *   3. Tool handler that throws is caught; loop continues.
 *   4. Interactive tool forces sequential dispatch (no parallelism).
 *   5. maxIterations guard fires and reports hitMaxIterations: true.
 *   6. Event stream ordering matches expectations.
 *   7. Dependency-aware tool parallelism (T8/O6) — `toolParallelPolicyProvider`
 *      partitions a round into ordered groups; absent provider = legacy.
 *   8. `onRoundComplete` round-boundary hook (O1 nudge parity) — note appended
 *      between rounds, skipped on the final round, errors swallowed, async ok.
 *
 * Run with: `npx tsx scripts/agent-core-smoketest.ts`
 *
 * Exit code 0 = all cases passed; 1 = any failure (prints the failing
 * case name + delta).
 */

import {
  runAgent,
  type AgentEvent,
  type AgentMessage,
  type AgentMessageContentBlock,
  type AgentProvider,
  type AgentToolDefinition,
  type ProviderTurnResult,
} from '../src/lib/agentExecutionCore';

let failures = 0;

function assert(ok: boolean, msg: string) {
  if (!ok) {
    failures += 1;
    console.error('FAIL:', msg);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

/** Mock provider — given a scripted list of turns, returns them in order. */
function scriptedProvider(turns: ProviderTurnResult[]): AgentProvider {
  let i = 0;
  return {
    async turn() {
      if (i >= turns.length) {
        throw new Error(`scriptedProvider: out of scripted turns at index ${i}`);
      }
      return turns[i++];
    },
  };
}

// ─── Case 1 — single-turn text ──────────────────────────────────────────────

async function case1_simpleText() {
  const events: AgentEvent[] = [];
  const result = await runAgent({
    initialMessages: [{ role: 'user', content: 'hi' }],
    tools: [],
    provider: scriptedProvider([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hello back' }],
      },
    ]),
    onEvent: (e) => events.push(e),
  });
  assertEqual(result.text, 'hello back', 'case1: text equals');
  assertEqual(result.stopReason, 'end_turn', 'case1: stopReason');
  assertEqual(result.iterations, 1, 'case1: iterations');
  assertEqual(result.hitMaxIterations, false, 'case1: not hit max');
  const kinds = events.map((e) => e.kind);
  assertEqual(kinds, ['turn_start', 'turn_end', 'final_response'], 'case1: event kinds');
}

// ─── Case 2 — tool_use → tool_result → end_turn ─────────────────────────────

async function case2_toolRoundtrip() {
  const tool: AgentToolDefinition = {
    name: 'echo',
    description: 'echoes input.text',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    async handler(input) {
      const t = (input as { text?: string }).text;
      return { ok: true, data: { echoed: t } };
    },
  };

  const toolUse: AgentMessageContentBlock = {
    type: 'tool_use',
    id: 'tu_1',
    name: 'echo',
    input: { text: 'ping' },
  };

  const events: AgentEvent[] = [];
  const result = await runAgent({
    initialMessages: [{ role: 'user', content: 'use echo' }],
    tools: [tool],
    provider: scriptedProvider([
      { stop_reason: 'tool_use', content: [toolUse] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]),
    onEvent: (e) => events.push(e),
  });
  assertEqual(result.text, 'done', 'case2: text');
  assertEqual(result.iterations, 2, 'case2: iterations');

  // Sanity-check the message history: user → assistant(tool_use) → user(tool_result) → assistant(text)
  const roles = result.messages.map((m) => m.role);
  assertEqual(roles, ['user', 'assistant', 'user', 'assistant'], 'case2: message roles');

  const toolResult = (result.messages[2].content as AgentMessageContentBlock[])[0];
  assert(toolResult.type === 'tool_result', 'case2: third message is tool_result');
  if (toolResult.type === 'tool_result') {
    assertEqual(toolResult.tool_use_id, 'tu_1', 'case2: tool_use_id matches');
    assert(toolResult.content.includes('"ok":true'), 'case2: tool result ok=true');
  }
  // Event stream must have fired tool_call_start and tool_call_result.
  const hasStart  = events.some((e) => e.kind === 'tool_call_start'  && e.toolUseId === 'tu_1');
  const hasResult = events.some((e) => e.kind === 'tool_call_result' && e.toolUseId === 'tu_1' && e.result.ok === true);
  assert(hasStart,  'case2: tool_call_start fired');
  assert(hasResult, 'case2: tool_call_result fired with ok=true');
}

// ─── Case 3 — tool handler throws → caught, loop continues ─────────────────

async function case3_toolThrows() {
  const tool: AgentToolDefinition = {
    name: 'boom',
    description: 'always throws',
    input_schema: { type: 'object', properties: {} },
    async handler() {
      throw new Error('kaboom');
    },
  };
  const toolUse: AgentMessageContentBlock = { type: 'tool_use', id: 'tu_2', name: 'boom', input: {} };
  const result = await runAgent({
    initialMessages: [{ role: 'user', content: 'call boom' }],
    tools: [tool],
    provider: scriptedProvider([
      { stop_reason: 'tool_use', content: [toolUse] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'recovered' }] },
    ]),
  });
  assertEqual(result.text, 'recovered', 'case3: loop recovered');
  const toolResult = (result.messages[2].content as AgentMessageContentBlock[])[0];
  assert(toolResult.type === 'tool_result', 'case3: tool_result emitted');
  if (toolResult.type === 'tool_result') {
    assertEqual(toolResult.is_error, true, 'case3: is_error flag set');
    assert(toolResult.content.includes('"ok":false'), 'case3: ok=false');
    assert(toolResult.content.includes('kaboom'), 'case3: error message propagated');
  }
}

// ─── Case 4 — interactive tool forces sequential dispatch ──────────────────

async function case4_interactiveSequential() {
  const order: string[] = [];
  const tool: AgentToolDefinition = {
    name: 'clarify',
    description: 'interactive',
    interactive: true,
    input_schema: { type: 'object', properties: { id: { type: 'string' } } },
    async handler(input) {
      const id = (input as { id?: string }).id || '?';
      order.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${id}`);
      return { ok: true, data: { id } };
    },
  };
  const use1: AgentMessageContentBlock = { type: 'tool_use', id: 'ia', name: 'clarify', input: { id: 'a' } };
  const use2: AgentMessageContentBlock = { type: 'tool_use', id: 'ib', name: 'clarify', input: { id: 'b' } };
  await runAgent({
    initialMessages: [{ role: 'user', content: 'double clarify' }],
    tools: [tool],
    provider: scriptedProvider([
      { stop_reason: 'tool_use', content: [use1, use2] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]),
    parallelToolConcurrency: 4,
  });
  // If sequential, order is [start:a, end:a, start:b, end:b]. If parallel,
  // we would see [start:a, start:b, end:a, end:b] (or interleaved).
  assertEqual(order, ['start:a', 'end:a', 'start:b', 'end:b'], 'case4: interactive tools ran sequentially');
}

// ─── Case 5 — maxIterations guard ──────────────────────────────────────────

async function case5_maxIterations() {
  const tool: AgentToolDefinition = {
    name: 'loop',
    description: 'will be called forever',
    input_schema: { type: 'object', properties: {} },
    async handler() { return { ok: true, data: null }; },
  };
  // Always respond with tool_use → forces the loop to bail.
  const scripted = Array.from({ length: 5 }, () => ({
    stop_reason: 'tool_use' as const,
    content: [{ type: 'tool_use' as const, id: `tu_${Math.random()}`, name: 'loop', input: {} }],
  }));
  const result = await runAgent({
    initialMessages: [{ role: 'user', content: 'loop' }],
    tools: [tool],
    provider: scriptedProvider(scripted),
    maxIterations: 3,
  });
  assertEqual(result.hitMaxIterations, true, 'case5: hitMaxIterations true');
  assertEqual(result.iterations, 3, 'case5: stopped at max');
}

// ─── Case 6 — unregistered tool call returns ok:false, loop continues ──────

async function case6_unknownTool() {
  const ghostUse: AgentMessageContentBlock = {
    type: 'tool_use',
    id: 'tu_ghost',
    name: 'doesNotExist',
    input: {},
  };
  const result = await runAgent({
    initialMessages: [{ role: 'user', content: 'call ghost' }],
    tools: [],
    provider: scriptedProvider([
      { stop_reason: 'tool_use', content: [ghostUse] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'skipped' }] },
    ]),
  });
  const toolResult = (result.messages[2].content as AgentMessageContentBlock[])[0];
  assert(toolResult.type === 'tool_result', 'case6: tool_result emitted');
  if (toolResult.type === 'tool_result') {
    assert(toolResult.content.includes('not registered'), 'case6: unregistered error surfaced');
  }
}

// ─── Case 7 — pre-turn compaction fires + emits context_compressed ─────────

async function case7_compactionPreTurn() {
  // Build an oversized history (many short messages) so the compaction
  // threshold trips on the first turn. preserveLast=4 keeps the tail; the
  // injected summariser is deterministic so the assertion is stable.
  const bulk: AgentMessage[] = [];
  for (let i = 0; i < 60; i++) {
    bulk.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(200) });
  }
  const events: AgentEvent[] = [];
  let summariserCalls = 0;
  const result = await runAgent({
    initialMessages: bulk,
    tools: [],
    provider: scriptedProvider([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]),
    onEvent: (e) => events.push(e),
    compaction: {
      // Tiny window so 60×200 chars (~3k tokens) is over 50% of it.
      maxContextTokens: 2_000,
      preserveLast: 4,
      summariser: async () => { summariserCalls += 1; return 'CONDENSED RECAP'; },
    },
  });
  assertEqual(result.text, 'ok', 'case7: final text');
  assert(summariserCalls === 1, 'case7: summariser invoked once');
  const compEvent = events.find((e) => e.kind === 'context_compressed');
  assert(!!compEvent, 'case7: context_compressed event emitted');
  if (compEvent && compEvent.kind === 'context_compressed') {
    assert(compEvent.droppedCount > 0, 'case7: dropped messages > 0');
    assert(compEvent.tokensAfter < compEvent.tokensBefore, 'case7: tokens reduced');
  }
}

// ─── Case 8 — pre-dispatch approval gate (R11) ──────────────────────────────

async function case8_toolApprovalGate() {
  let handlerCalls = 0;
  const tool: AgentToolDefinition = {
    name: 'guarded',
    description: 'gated tool',
    input_schema: { type: 'object', properties: { n: { type: 'number' } } },
    async handler(input) {
      handlerCalls += 1;
      return { ok: true, data: { n: (input as { n?: number }).n } };
    },
  };
  const useApproved: AgentMessageContentBlock = { type: 'tool_use', id: 'tu_ok',  name: 'guarded', input: { n: 1 } };
  const useRejected: AgentMessageContentBlock = { type: 'tool_use', id: 'tu_no',  name: 'guarded', input: { n: 2 } };
  const useGateBoom: AgentMessageContentBlock = { type: 'tool_use', id: 'tu_err', name: 'guarded', input: { n: 3 } };

  const result = await runAgent({
    initialMessages: [{ role: 'user', content: 'gate test' }],
    tools: [tool],
    provider: scriptedProvider([
      { stop_reason: 'tool_use', content: [useApproved, useRejected, useGateBoom] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'gated' }] },
    ]),
    toolApprovalGate: async ({ toolUseId }) => {
      if (toolUseId === 'tu_ok') return { decision: 'approve' };
      if (toolUseId === 'tu_no') return { decision: 'reject', reason: 'circle policy' };
      throw new Error('gate exploded'); // tu_err — must fail CLOSED (reject)
    },
  });

  assertEqual(result.text, 'gated', 'case8: loop completed');
  assertEqual(handlerCalls, 1, 'case8: only the approved call ran the handler');

  const blocks = result.messages[2].content as AgentMessageContentBlock[];
  const byId = (id: string) => blocks.find((b) => b.type === 'tool_result' && b.tool_use_id === id);
  const ok = byId('tu_ok'); const no = byId('tu_no'); const err = byId('tu_err');
  assert(!!ok && ok.type === 'tool_result' && ok.is_error !== true, 'case8: approved call succeeded');
  if (no && no.type === 'tool_result') {
    assertEqual(no.is_error, true, 'case8: rejected call is_error');
    assert(no.content.includes('blocked by policy'), 'case8: rejection reads as policy block');
    assert(no.content.includes('circle policy'), 'case8: rejection carries the reason');
    assert(no.content.includes('Do not retry'), 'case8: rejection tells model not to retry');
  } else { assert(false, 'case8: rejected tool_result missing'); }
  if (err && err.type === 'tool_result') {
    assertEqual(err.is_error, true, 'case8: gate throw fails closed');
    assert(err.content.includes('approval gate failed'), 'case8: gate failure reason surfaced');
  } else { assert(false, 'case8: gate-throw tool_result missing'); }
}

// ─── Case 9 — iteration_complete checkpoint + metadata side channel ─────────

async function case9_checkpointAndMetadata() {
  const tool: AgentToolDefinition = {
    name: 'capture',
    description: 'returns hidden metadata',
    input_schema: { type: 'object', properties: {} },
    async handler() {
      return {
        ok: true,
        data: { visible: 'yes' },
        metadata: { hiddenManifest: 'design-capture-7' },
      };
    },
  };
  const use: AgentMessageContentBlock = { type: 'tool_use', id: 'tu_meta', name: 'capture', input: {} };
  const events: AgentEvent[] = [];
  const result = await runAgent({
    initialMessages: [{ role: 'user', content: 'capture' }],
    tools: [tool],
    provider: scriptedProvider([
      { stop_reason: 'tool_use', content: [use] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]),
    onEvent: (e) => events.push(e),
  });

  // R14 — metadata flows through the event…
  const resultEvent = events.find((e) => e.kind === 'tool_call_result' && e.toolUseId === 'tu_meta');
  assert(!!resultEvent, 'case9: tool_call_result fired');
  if (resultEvent && resultEvent.kind === 'tool_call_result' && resultEvent.result.ok) {
    assertEqual(
      resultEvent.result.metadata,
      { hiddenManifest: 'design-capture-7' },
      'case9: event carries metadata',
    );
  }
  // …but is STRIPPED from the model-visible tool_result content.
  const toolResult = (result.messages[2].content as AgentMessageContentBlock[])[0];
  assert(toolResult.type === 'tool_result', 'case9: tool_result emitted');
  if (toolResult.type === 'tool_result') {
    assert(!toolResult.content.includes('hiddenManifest'), 'case9: metadata hidden from model');
    assert(toolResult.content.includes('visible'), 'case9: data still model-visible');
  }

  // R12 — iteration_complete fired after the round with a consistent snapshot
  // (user → assistant(tool_use) → user(tool_result) = 3 messages), and the
  // snapshot does not alias the live history (final history has 4).
  const checkpoint = events.find((e) => e.kind === 'iteration_complete');
  assert(!!checkpoint, 'case9: iteration_complete emitted');
  if (checkpoint && checkpoint.kind === 'iteration_complete') {
    assertEqual(checkpoint.iteration, 1, 'case9: checkpoint at iteration 1');
    assertEqual(checkpoint.messages.length, 3, 'case9: snapshot taken at the round boundary');
    const last = checkpoint.messages[checkpoint.messages.length - 1];
    const lastBlocks = last.content as AgentMessageContentBlock[];
    assert(lastBlocks[0]?.type === 'tool_result', 'case9: snapshot ends with closed tool_result pair');
  }
  assertEqual(result.messages.length, 4, 'case9: final history unaffected');
}

// ─── Case 10 — dependency-aware tool parallelism (T8/O6) ───────────────────

async function case10_dependencyAwareParallelism() {
  // Three auto-approved writers: A writes domain x, B writes domain y,
  // C writes domain x. With the policy provider, the round must partition
  // into [A, B] (disjoint → parallel-eligible) then [C] (conflicts with A).
  const makeWriter = (name: string, order: string[]): AgentToolDefinition => ({
    name,
    description: `writer ${name}`,
    input_schema: { type: 'object', properties: {} },
    async handler() {
      order.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
      order.push(`end:${name}`);
      return { ok: true, data: { name } };
    },
  });
  const policies: Record<string, { mutatesState: boolean; externalSideEffect: boolean; approvalMode: string; mutationTargets: string[] }> = {
    writeA: { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['x'] },
    writeB: { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['y'] },
    writeC: { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['x'] },
  };
  const uses: AgentMessageContentBlock[] = [
    { type: 'tool_use', id: 'tu_a', name: 'writeA', input: {} },
    { type: 'tool_use', id: 'tu_b', name: 'writeB', input: {} },
    { type: 'tool_use', id: 'tu_c', name: 'writeC', input: {} },
  ];
  const turns = (): ProviderTurnResult[] => ([
    { stop_reason: 'tool_use', content: uses },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  ]);

  // WITH provider: A+B overlap; C starts only after both finished.
  const orderWith: string[] = [];
  const resultWith = await runAgent({
    initialMessages: [{ role: 'user', content: 'write things' }],
    tools: ['writeA', 'writeB', 'writeC'].map((n) => makeWriter(n, orderWith)),
    provider: scriptedProvider(turns()),
    parallelToolConcurrency: 4,
    toolParallelPolicyProvider: (toolName) => policies[toolName] ?? null,
  });
  const idx = (entry: string) => orderWith.indexOf(entry);
  assert(idx('start:writeB') >= 0 && idx('start:writeB') < idx('end:writeA'),
    'case10: A and B overlapped (same parallel group)');
  assert(idx('start:writeC') > idx('end:writeA') && idx('start:writeC') > idx('end:writeB'),
    'case10: C waited for the whole first group (write-conflict barrier)');
  // Result blocks must come back in original tool_use order regardless of grouping.
  const blocksWith = resultWith.messages[2].content as AgentMessageContentBlock[];
  assertEqual(
    blocksWith.map((b) => (b.type === 'tool_result' ? b.tool_use_id : b.type)),
    ['tu_a', 'tu_b', 'tu_c'],
    'case10: tool_result blocks in original request order',
  );
  assert(blocksWith.every((b) => b.type === 'tool_result' && b.is_error !== true),
    'case10: all three writers succeeded');

  // WITHOUT provider: legacy behavior — the whole round dispatches under
  // parallelToolConcurrency, so C overlaps the others too.
  const orderWithout: string[] = [];
  const resultWithout = await runAgent({
    initialMessages: [{ role: 'user', content: 'write things' }],
    tools: ['writeA', 'writeB', 'writeC'].map((n) => makeWriter(n, orderWithout)),
    provider: scriptedProvider(turns()),
    parallelToolConcurrency: 4,
  });
  const idx2 = (entry: string) => orderWithout.indexOf(entry);
  assert(idx2('start:writeC') < idx2('end:writeA'),
    'case10: absent provider keeps legacy full-round parallel dispatch');
  const blocksWithout = resultWithout.messages[2].content as AgentMessageContentBlock[];
  assertEqual(
    blocksWithout.map((b) => (b.type === 'tool_result' ? b.tool_use_id : b.type)),
    ['tu_a', 'tu_b', 'tu_c'],
    'case10: legacy path result order unchanged',
  );

  // WITH provider AND an approval gate: every tool becomes its own group
  // (sequential), preserving R11's pre-dispatch review semantics.
  const orderGated: string[] = [];
  await runAgent({
    initialMessages: [{ role: 'user', content: 'write things' }],
    tools: ['writeA', 'writeB', 'writeC'].map((n) => makeWriter(n, orderGated)),
    provider: scriptedProvider(turns()),
    parallelToolConcurrency: 4,
    toolParallelPolicyProvider: (toolName) => policies[toolName] ?? null,
    toolApprovalGate: () => ({ decision: 'approve' }),
  });
  assertEqual(
    orderGated,
    ['start:writeA', 'end:writeA', 'start:writeB', 'end:writeB', 'start:writeC', 'end:writeC'],
    'case10: approval gate forces strict sequential dispatch even with provider',
  );

  // Unknown tool (provider returns null) is a singleton barrier: B cannot
  // overlap the unknown tool before it, even though B itself is eligible.
  const orderUnknown: string[] = [];
  await runAgent({
    initialMessages: [{ role: 'user', content: 'write things' }],
    tools: ['writeA', 'writeB'].map((n) => makeWriter(n, orderUnknown)),
    provider: scriptedProvider([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_a2', name: 'writeA', input: {} },
          { type: 'tool_use', id: 'tu_b2', name: 'writeB', input: {} },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]),
    parallelToolConcurrency: 4,
    toolParallelPolicyProvider: (toolName) => (toolName === 'writeB' ? policies.writeB : null),
  });
  assertEqual(
    orderUnknown,
    ['start:writeA', 'end:writeA', 'start:writeB', 'end:writeB'],
    'case10: null policy makes the tool an unsafe sequential barrier',
  );
}

// ─── Case 11 — onRoundComplete round-boundary hook (O1 nudge parity) ────────

async function case11_onRoundCompleteHook() {
  const okTool: AgentToolDefinition = {
    name: 'probe',
    description: 'returns ok',
    input_schema: { type: 'object', properties: {} },
    async handler() { return { ok: true, data: { seen: true } }; },
  };
  const badTool: AgentToolDefinition = {
    name: 'breaker',
    description: 'always fails',
    input_schema: { type: 'object', properties: {} },
    async handler() { return { ok: false, error: 'nope' }; },
  };
  const use = (id: string, name: string): AgentMessageContentBlock =>
    ({ type: 'tool_use', id, name, input: {} });
  const toolTurn = (id: string, name = 'probe'): ProviderTurnResult =>
    ({ stop_reason: 'tool_use', content: [use(id, name)] });
  const endTurn: ProviderTurnResult =
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };

  // a) Note appended between rounds, after the tool_result message, and the
  //    next provider turn sees it. Hook ctx carries iteration/max/toolResults.
  const hookCtxs: Array<{ iteration: number; maxIterations: number; toolResults: Array<{ toolName: string; ok: boolean; resultText?: string }> }> = [];
  const providerSawNote: boolean[] = [];
  const scripted = scriptedProvider([toolTurn('tu_h1'), toolTurn('tu_h2', 'breaker'), endTurn]);
  const watchingProvider: AgentProvider = {
    async turn(args) {
      const last = args.messages[args.messages.length - 1];
      providerSawNote.push(typeof last?.content === 'string' && last.content === 'NOTE round 1');
      return scripted.turn(args as any);
    },
  };
  const resultA = await runAgent({
    initialMessages: [{ role: 'user', content: 'go' }],
    tools: [okTool, badTool],
    provider: watchingProvider,
    maxIterations: 5,
    onRoundComplete: (ctx) => {
      hookCtxs.push({ iteration: ctx.iteration, maxIterations: ctx.maxIterations, toolResults: ctx.toolResults });
      return ctx.iteration === 1 ? { appendUserNote: 'NOTE round 1' } : undefined;
    },
  });
  assertEqual(resultA.text, 'done', 'case11a: run completes');
  // History: user, assistant(tu1), user(tool_result), user(NOTE),
  //          assistant(tu2), user(tool_result), assistant(done) = 7
  assertEqual(resultA.messages.length, 7, 'case11a: exactly one note message added');
  const noteMsg = resultA.messages[3];
  assert(noteMsg.role === 'user' && noteMsg.content === 'NOTE round 1',
    'case11a: note is a user-role text message after the tool_result');
  const beforeNote = resultA.messages[2].content as AgentMessageContentBlock[];
  assert(Array.isArray(beforeNote) && beforeNote[0]?.type === 'tool_result',
    'case11a: note sits directly after the tool_result message');
  assertEqual(providerSawNote, [false, true, false],
    'case11a: the NEXT provider turn (and only it) sees the note as the last message');
  assertEqual(hookCtxs.length, 2, 'case11a: hook fired once per tool round');
  assertEqual(hookCtxs[0].iteration, 1, 'case11a: ctx.iteration is 1-indexed');
  assertEqual(hookCtxs[0].maxIterations, 5, 'case11a: ctx.maxIterations forwarded');
  assertEqual(hookCtxs[0].toolResults.map((t) => ({ toolName: t.toolName, ok: t.ok })),
    [{ toolName: 'probe', ok: true }], 'case11a: round 1 toolResults summarized');
  assert(typeof hookCtxs[0].toolResults[0].resultText === 'string'
    && hookCtxs[0].toolResults[0].resultText!.includes('seen'),
    'case11a: resultText carries the model-visible content');
  assertEqual(hookCtxs[1].toolResults.map((t) => ({ toolName: t.toolName, ok: t.ok })),
    [{ toolName: 'breaker', ok: false }], 'case11a: failed tool reported ok:false');

  // b) Not fired on the final round (no next turn to guide).
  let finalRoundCalls = 0;
  const resultB = await runAgent({
    initialMessages: [{ role: 'user', content: 'go' }],
    tools: [okTool],
    provider: scriptedProvider([toolTurn('tu_f1'), toolTurn('tu_f2')]),
    maxIterations: 2,
    onRoundComplete: () => { finalRoundCalls += 1; return { appendUserNote: 'late note' }; },
  });
  assertEqual(resultB.hitMaxIterations, true, 'case11b: run hit the cap');
  assertEqual(finalRoundCalls, 1, 'case11b: hook skipped on the final round');
  assert(!resultB.messages.some((m) => m.content === 'late note' && resultB.messages.indexOf(m) > 4),
    'case11b: no note after the final round');

  // c) Hook errors are swallowed (sync throw + async reject) — loop unaffected.
  const resultC = await runAgent({
    initialMessages: [{ role: 'user', content: 'go' }],
    tools: [okTool],
    provider: scriptedProvider([toolTurn('tu_e1'), toolTurn('tu_e2'), endTurn]),
    maxIterations: 5,
    onRoundComplete: (ctx) => {
      if (ctx.iteration === 1) throw new Error('boom');
      return Promise.reject(new Error('async boom'));
    },
  });
  assertEqual(resultC.text, 'done', 'case11c: hook errors never break the loop');
  assertEqual(resultC.messages.length, 6, 'case11c: no note messages on error');

  // d) Async hook supported; empty/whitespace notes are not appended.
  const resultD = await runAgent({
    initialMessages: [{ role: 'user', content: 'go' }],
    tools: [okTool],
    provider: scriptedProvider([toolTurn('tu_a1'), toolTurn('tu_a2'), endTurn]),
    maxIterations: 5,
    onRoundComplete: async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ctx.iteration === 1 ? { appendUserNote: 'async note' } : { appendUserNote: '   ' };
    },
  });
  assertEqual(resultD.text, 'done', 'case11d: async hook completes');
  assert(resultD.messages.some((m) => m.role === 'user' && m.content === 'async note'),
    'case11d: awaited note appended');
  assertEqual(resultD.messages.length, 7, 'case11d: whitespace-only note NOT appended');
}

// ─── Case 12 — aborted run is NOT mislabeled as cap-exhausted (backlog #7) ──

async function case12_abortedNotCapExhausted() {
  const tool: AgentToolDefinition = {
    name: 'step',
    description: 'always asks to run again',
    input_schema: { type: 'object', properties: {} },
    async handler() { return { ok: true, data: null }; },
  };
  // Provider that always requests another tool round — left to run it would
  // hit the cap, so this isolates cap-exhaustion vs. abort as the only
  // difference between (a) and the real-cap control below.
  const loopingTurns = (n: number): ProviderTurnResult[] =>
    Array.from({ length: n }, (_, i) => ({
      stop_reason: 'tool_use' as const,
      content: [{ type: 'tool_use' as const, id: `tu_step_${i}`, name: 'step', input: {} }],
    }));

  // (a) Abort fires at a loop boundary (after round 1's tool_result +
  //     iteration_complete): deterministic — the controller aborts inside the
  //     onEvent handler when the first iteration_complete checkpoint lands, so
  //     the NEXT `while` guard sees signal.aborted and breaks. No wall-clock.
  const controller = new AbortController();
  const eventsA: AgentEvent[] = [];
  const resultA = await runAgent({
    initialMessages: [{ role: 'user', content: 'go' }],
    tools: [tool],
    provider: scriptedProvider(loopingTurns(5)),
    maxIterations: 5,
    signal: controller.signal,
    onEvent: (e) => {
      eventsA.push(e);
      // Cancel exactly once, at the first round boundary — the next loop
      // iteration's `if (signal?.aborted) break;` then exits via the aborted
      // path, well before maxIterations is reached.
      if (e.kind === 'iteration_complete' && e.iteration === 1) controller.abort();
    },
  });
  assertEqual(resultA.aborted, true, 'case12a: aborted flag set');
  assertEqual(resultA.hitMaxIterations, false, 'case12a: aborted is NOT hitMaxIterations');
  assert(resultA.iterations < 5, 'case12a: exited before the cap (not exhaustion)');
  assert(!eventsA.some((e) => e.kind === 'max_iterations_exceeded'),
    'case12a: aborted run does NOT emit the cap-exhausted event');

  // (b) Already-aborted signal on entry: breaks immediately (iteration 0),
  //     still honest — aborted, not cap-exhausted.
  const preAborted = AbortSignal.abort();
  const eventsB: AgentEvent[] = [];
  const resultB = await runAgent({
    initialMessages: [{ role: 'user', content: 'go' }],
    tools: [tool],
    provider: scriptedProvider(loopingTurns(1)),
    maxIterations: 3,
    signal: preAborted,
    onEvent: (e) => eventsB.push(e),
  });
  assertEqual(resultB.aborted, true, 'case12b: pre-aborted run flagged aborted');
  assertEqual(resultB.hitMaxIterations, false, 'case12b: pre-aborted is NOT hitMaxIterations');
  assertEqual(resultB.iterations, 0, 'case12b: no provider turn ran');
  assert(!eventsB.some((e) => e.kind === 'max_iterations_exceeded'),
    'case12b: pre-aborted run does NOT emit the cap-exhausted event');

  // (c) CONTROL — a genuine cap exhaustion (no signal) still reports
  //     hitMaxIterations AND emits max_iterations_exceeded, and is NOT aborted.
  //     This is the distinct behavior backlog #7 must preserve.
  const eventsC: AgentEvent[] = [];
  const resultC = await runAgent({
    initialMessages: [{ role: 'user', content: 'go' }],
    tools: [tool],
    provider: scriptedProvider(loopingTurns(3)),
    maxIterations: 3,
    onEvent: (e) => eventsC.push(e),
  });
  assertEqual(resultC.hitMaxIterations, true, 'case12c: real cap still hitMaxIterations');
  assert(resultC.aborted !== true, 'case12c: real cap is NOT flagged aborted');
  assertEqual(resultC.iterations, 3, 'case12c: ran to the cap');
  assert(eventsC.some((e) => e.kind === 'max_iterations_exceeded'),
    'case12c: real cap still emits the cap-exhausted event');
}

// ─── Run all ────────────────────────────────────────────────────────────────

async function main() {
  const cases: Array<[string, () => Promise<void>]> = [
    ['case1_simpleText',           case1_simpleText],
    ['case2_toolRoundtrip',        case2_toolRoundtrip],
    ['case3_toolThrows',           case3_toolThrows],
    ['case4_interactiveSequential', case4_interactiveSequential],
    ['case5_maxIterations',        case5_maxIterations],
    ['case6_unknownTool',          case6_unknownTool],
    ['case7_compactionPreTurn',    case7_compactionPreTurn],
    ['case8_toolApprovalGate',     case8_toolApprovalGate],
    ['case9_checkpointAndMetadata', case9_checkpointAndMetadata],
    ['case10_dependencyAwareParallelism', case10_dependencyAwareParallelism],
    ['case11_onRoundCompleteHook',  case11_onRoundCompleteHook],
    ['case12_abortedNotCapExhausted', case12_abortedNotCapExhausted],
  ];
  for (const [name, fn] of cases) {
    const before = failures;
    try { await fn(); }
    catch (e) {
      failures += 1;
      console.error(`FAIL: ${name} threw:`, e);
    }
    const after = failures;
    console.log(`${after === before ? 'pass' : 'fail'}: ${name}`);
  }
  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} cases passed.`);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
