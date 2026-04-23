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

// ─── Run all ────────────────────────────────────────────────────────────────

async function main() {
  const cases: Array<[string, () => Promise<void>]> = [
    ['case1_simpleText',           case1_simpleText],
    ['case2_toolRoundtrip',        case2_toolRoundtrip],
    ['case3_toolThrows',           case3_toolThrows],
    ['case4_interactiveSequential', case4_interactiveSequential],
    ['case5_maxIterations',        case5_maxIterations],
    ['case6_unknownTool',          case6_unknownTool],
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
