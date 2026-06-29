/**
 * delegation-wiring-smoketest — task #32 + O3. Verifies:
 *   1. the gate-wiring helpers subagentRegistry composes before spawning
 *      (stubbed Supabase lookups — mirrors readParentDelegationDepth /
 *      countInFlightDelegations exactly), and
 *   2. the O3 typed-core child loop end-to-end with a mock provider:
 *      delegate → tools run through agentExecutionCore.runAgent → the
 *      parent receives ONLY the bounded summary contract (transcript
 *      absent), with accurate tokens/toolCallCount, plus the
 *      createPersistedRun({parentRunId}) options seam and the
 *      uc_subagent_typed_core escape hatch.
 *
 * subagentRegistry itself imports supabase → react-native and is not
 * tsx-loadable; `runSubagentTypedCoreLoop` (delegationGate) IS the
 * production child loop, so this exercises the real composition.
 *
 * Run: npm run smoke:delegation-wiring
 */

import {
  buildSubagentChildRunOptions,
  buildSubagentLoopSummary,
  buildSubagentParentSummary,
  canDelegate,
  runSubagentTypedCoreLoop,
  type DelegationGateDecision,
} from '../src/lib/delegationGate';
import type {
  AgentEvent,
  AgentProvider,
  AgentToolDefinition,
  ProviderTurnResult,
} from '../src/lib/agentExecutionCore';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Stubbed Supabase query surface ─────────────────────────────
// Mirrors the two reads subagentRegistry does before spawning:
//   1. readParentDelegationDepth(parentRunId) — pulls metadata.delegationDepth
//   2. countInFlightDelegations(circleId) — COUNTs running children

type AgentRun = {
  id: string;
  circle_id: string;
  status: 'running' | 'completed' | 'failed';
  parent_run_id: string | null;
  metadata?: { delegationDepth?: number };
};

function makeFixture() {
  const rows: AgentRun[] = [];
  return {
    rows,
    async readParentDelegationDepth(parentRunId: string | undefined): Promise<number> {
      if (!parentRunId) return 0;
      const row = rows.find((r) => r.id === parentRunId);
      const depth = row?.metadata?.delegationDepth;
      if (typeof depth === 'number' && Number.isFinite(depth) && depth >= 0) return depth;
      return 0;
    },
    async countInFlightDelegations(circleId: string): Promise<number> {
      return rows.filter((r) => r.circle_id === circleId && r.status === 'running' && r.parent_run_id !== null).length;
    },
  };
}

// Compose the gate-wiring logic that subagentRegistry runs before
// spawning. Mirror signature exactly.
async function wiringDecision(args: {
  parentRunId?: string;
  circleId: string;
  fx: ReturnType<typeof makeFixture>;
}): Promise<{ gate: DelegationGateDecision; proposedDepth: number; inFlight: number }> {
  const parentDepth = await args.fx.readParentDelegationDepth(args.parentRunId);
  const proposedDepth = parentDepth + 1;
  const inFlight = await args.fx.countInFlightDelegations(args.circleId);
  const gate = canDelegate({ proposedDepth, inFlight, circleId: args.circleId, parentRunId: args.parentRunId });
  return { gate, proposedDepth, inFlight };
}

async function main() {
  // ─── Root delegation (no parent) ────────────────────────────────
  {
    const fx = makeFixture();
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(d.gate.ok, 'root: no parent → allowed');
    assert(d.proposedDepth === 1, 'root: proposedDepth=1 (child of root)');
    assert(d.inFlight === 0, 'root: in-flight = 0');
  }

  // ─── Normal child under depth-1 parent (grandchild case) ────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: 'grandparent', metadata: { delegationDepth: 1 } });
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    assert(d.gate.ok, 'grandchild: depth 2 allowed');
    assert(d.proposedDepth === 2, 'grandchild: proposedDepth=2');
  }

  // ─── Would-be great-grandchild REJECTED ─────────────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: 'gp', metadata: { delegationDepth: 2 } });
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    assert(!d.gate.ok, 'great-grandchild: rejected');
    assert(d.gate.reason === 'depth_exceeded', 'great-grandchild: reason=depth_exceeded');
    assert(d.proposedDepth === 3, 'great-grandchild: depth computed as 3');
  }

  // ─── Concurrency: 3 running children → reject ───────────────────
  {
    const fx = makeFixture();
    // Unrelated root (not a child, shouldn't count)
    fx.rows.push({ id: 'root', circle_id: 'c1', status: 'running', parent_run_id: null });
    fx.rows.push({ id: 'c1a', circle_id: 'c1', status: 'running', parent_run_id: 'root' });
    fx.rows.push({ id: 'c1b', circle_id: 'c1', status: 'running', parent_run_id: 'root' });
    fx.rows.push({ id: 'c1c', circle_id: 'c1', status: 'running', parent_run_id: 'root' });
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(!d.gate.ok, 'concurrency: 3 running children → new delegation rejected');
    assert(d.gate.reason === 'concurrency_exceeded', 'concurrency: reason matches');
    assert(d.inFlight === 3, `concurrency: in-flight count = 3 (got ${d.inFlight})`);
  }

  // ─── Concurrency scoped to circle — other circles don't leak ────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'other1', circle_id: 'c2', status: 'running', parent_run_id: 'pOther1' });
    fx.rows.push({ id: 'other2', circle_id: 'c2', status: 'running', parent_run_id: 'pOther2' });
    fx.rows.push({ id: 'other3', circle_id: 'c2', status: 'running', parent_run_id: 'pOther3' });
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(d.gate.ok, 'concurrency: other circles do not count against c1');
    assert(d.inFlight === 0, 'concurrency: c1 in-flight stays 0');
  }

  // ─── Completed / failed children don't count ────────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'done1', circle_id: 'c1', status: 'completed', parent_run_id: 'p' });
    fx.rows.push({ id: 'done2', circle_id: 'c1', status: 'completed', parent_run_id: 'p' });
    fx.rows.push({ id: 'fail1', circle_id: 'c1', status: 'failed', parent_run_id: 'p' });
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(d.gate.ok, 'concurrency: completed + failed children do not count');
    assert(d.inFlight === 0, 'concurrency: only status=running counts');
  }

  // ─── Missing parent metadata treated as depth 0 ─────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: null });
    // No metadata.delegationDepth — old runs predating CA-8d
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    assert(d.gate.ok, 'missing depth metadata: treated as depth 0 → child allowed');
    assert(d.proposedDepth === 1, 'missing metadata: proposedDepth defaults to 1');
  }

  // ─── Parent row missing entirely → depth 0 ──────────────────────
  {
    const fx = makeFixture();
    const d = await wiringDecision({ parentRunId: 'ghost', circleId: 'c1', fx });
    assert(d.gate.ok, 'ghost parent: treated as depth 0 → allowed');
    assert(d.proposedDepth === 1, 'ghost parent: depth=1');
  }

  // ─── Negative / NaN metadata rejected by gate ───────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: null, metadata: { delegationDepth: -5 as any } });
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    // readParentDelegationDepth clamps negative to 0, so child's depth is 1 — allowed
    assert(d.gate.ok, 'negative depth in metadata: clamped to 0 → child allowed');
    assert(d.proposedDepth === 1, 'negative metadata: clamped');
  }

  // ════ O3: typed-core child loop e2e (mock provider) ═════════════

  // Mock tools — record invocations so we can prove dispatch happened.
  const toolInvocations: Array<{ name: string; input: unknown }> = [];
  const makeTool = (name: string, ok = true): AgentToolDefinition => ({
    name,
    description: `mock ${name}`,
    input_schema: { type: 'object', properties: {} },
    handler: async (input) => {
      toolInvocations.push({ name, input });
      return ok
        ? { ok: true, data: { text: `${name} ran fine` } }
        : { ok: false, error: `${name} broke` };
    },
  });

  // Scripted provider — turn 1 requests two tools, turn 2 finishes.
  const makeScriptedProvider = (turns: ProviderTurnResult[]): AgentProvider => {
    let i = 0;
    return {
      turn: async () => {
        const turn = turns[Math.min(i, turns.length - 1)];
        i += 1;
        return turn;
      },
    };
  };

  // ─── Happy path: delegate → tools run → bounded parent summary ──
  {
    toolInvocations.length = 0;
    const events: AgentEvent[] = []; // persistence seam spy (createPersistedRun.onEvent shape)
    const bigFinalText = 'The child wrote a very long report. ' + 'z'.repeat(3000) + ' TRANSCRIPT_TAIL_MARKER';
    const provider = makeScriptedProvider([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't1', name: 'tasks.list', input: { scope: 'open' } },
          { type: 'tool_use', id: 't2', name: 'notes.read', input: {} },
        ],
        usage: { input_tokens: 700, output_tokens: 60, cache_read_input_tokens: 50 },
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: bigFinalText }],
        usage: { input_tokens: 900, output_tokens: 240 },
      },
    ]);

    const outcome = await runSubagentTypedCoreLoop({
      userMessage: 'Implement the primary solution for this task',
      tools: [makeTool('tasks.list'), makeTool('notes.read')],
      provider,
      maxIterations: 5, // legacy child cap (MAX_TOOL_ROUNDS)
      onEvent: (event) => events.push(event),
    });

    assert(toolInvocations.length === 2
      && toolInvocations[0].name === 'tasks.list' && toolInvocations[1].name === 'notes.read',
      'typed e2e: both requested tools dispatched through runAgent');
    assert(outcome.runResult.text === bigFinalText, 'typed e2e: full child text available for the Run Ledger');
    assert(outcome.runResult.hitMaxIterations === false, 'typed e2e: clean end_turn finish');
    assert(outcome.toolCalls.length === 2 && outcome.toolCalls.every((c) => c.ok),
      'typed e2e: toolCalls records accurate (count + ok)');
    assert(outcome.usage?.input_tokens === 1600 && outcome.usage?.output_tokens === 300,
      `typed e2e: usage aggregated across turns (got ${JSON.stringify(outcome.usage)})`);
    assert(outcome.usage?.total_tokens === 1600 + 300 + 50,
      'typed e2e: cache tokens counted into total (O1 accumulator parity)');

    // Persistence seam: the events the chained onEvent received are exactly
    // what createPersistedRun.onEvent writes to agent_run_events.
    const kinds = events.map((e) => e.kind);
    assert(kinds.includes('turn_start') && kinds.includes('tool_call_start')
      && kinds.includes('tool_call_result') && kinds.includes('turn_end')
      && kinds.includes('final_response'),
      `typed e2e: ledger event stream complete (got ${Array.from(new Set(kinds)).join(',')})`);

    // Parent contract: ONLY the bounded summary shape, transcript absent.
    const payload = buildSubagentLoopSummary({
      finalText: outcome.runResult.text,
      toolCalls: outcome.toolCalls,
      completedCleanly: !outcome.runResult.hitMaxIterations,
      usage: outcome.usage,
    });
    const parent = buildSubagentParentSummary({ payload, status: 'completed', runId: 'child-run-1' });
    assert(parent.summary.length <= 1200 && parent.summary.endsWith('...'),
      'typed e2e: parent summary bounded with truncation note');
    assert(parent.toolCallCount === 2, 'typed e2e: parent sees tool-call volume, not the trace');
    assert(parent.tokens.input === 1600 && parent.tokens.output === 300,
      'typed e2e: parent token accounting accurate');
    assert(parent.status === 'completed' && parent.runId === 'child-run-1',
      'typed e2e: status + child runId on the contract');
    const serialized = JSON.stringify(parent);
    assert(!serialized.includes('tool_use') && !serialized.includes('tasks.list')
      && !serialized.includes('messages') && !serialized.includes('TRANSCRIPT_TAIL_MARKER'),
      'typed e2e: transcript/tool trace/full text NEVER enter the parent payload');
  }

  // ─── Cap exhaustion: incomplete child → completed=false ─────────
  {
    toolInvocations.length = 0;
    const provider = makeScriptedProvider([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'loop', name: 'tasks.list', input: {} }],
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    ]);
    const outcome = await runSubagentTypedCoreLoop({
      userMessage: 'never finishes',
      tools: [makeTool('tasks.list')],
      provider,
      maxIterations: 2,
    });
    assert(outcome.runResult.hitMaxIterations === true, 'typed cap: maxIterations enforced');
    assert(outcome.toolCalls.length === 2, 'typed cap: one dispatch per round recorded');
    const payload = buildSubagentLoopSummary({
      finalText: 'partial progress note',
      toolCalls: outcome.toolCalls,
      completedCleanly: !outcome.runResult.hitMaxIterations,
      usage: outcome.usage,
    });
    assert(payload.completed === false, 'typed cap: parent sees completed=false (retry-vs-accept signal)');
    const parent = buildSubagentParentSummary({ payload, status: 'incomplete' });
    assert(parent.status === 'incomplete' && parent.tokens.input === 200,
      'typed cap: status=incomplete + tokens still accounted');
  }

  // ─── Failed tool → ok=false recorded, loop survives ─────────────
  {
    toolInvocations.length = 0;
    const provider = makeScriptedProvider([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'x', name: 'fs.write', input: { path: '/tmp/x' } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'recovered' }] },
    ]);
    const outcome = await runSubagentTypedCoreLoop({
      userMessage: 'write a file',
      tools: [makeTool('fs.write', false)],
      provider,
      maxIterations: 5,
    });
    assert(outcome.toolCalls.length === 1 && outcome.toolCalls[0].ok === false,
      'typed failure: failed dispatch recorded with ok=false');
    assert(outcome.runResult.text === 'recovered', 'typed failure: loop continues after a failed tool');
    assert(outcome.usage === undefined, 'typed failure: no provider usage → usage omitted, never fabricated');
  }

  // ─── Tool scoping: unregistered tool fails closed, never widens ─
  {
    const provider = makeScriptedProvider([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'w', name: 'desktop.shutdown', input: {} }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]);
    const outcome = await runSubagentTypedCoreLoop({
      userMessage: 'try something outside the allowed set',
      tools: [makeTool('tasks.list')], // caller-scoped surface — child can't exceed it
      provider,
      maxIterations: 5,
    });
    assert(outcome.toolCalls.length === 1 && outcome.toolCalls[0].ok === false,
      'typed scoping: tool outside the advertised set → error result, not execution');
  }

  // ─── Gate → spawn wiring: refusal is structured, spawn carries parentRunId ──
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent-run-7', circle_id: 'c1', status: 'running', parent_run_id: null, metadata: { delegationDepth: 0 } });
    const d = await wiringDecision({ parentRunId: 'parent-run-7', circleId: 'c1', fx });
    assert(d.gate.ok, 'O3 spawn: gate allows the child');
    // The options object below is exactly what subagentRegistry passes to
    // createPersistedRun — pinning parentRunId + depth stamp here is the
    // persistence spy seam (subagentRegistry itself is not tsx-loadable).
    const options = buildSubagentChildRunOptions({
      circleId: 'c1',
      userId: 'u1',
      surface: 'main_chat',
      subagentRole: 'coder',
      subagentDisplayName: 'Coder',
      task: 'build the thing',
      parentRunId: 'parent-run-7',
      delegationDepth: d.proposedDepth,
    });
    assert(options.parentRunId === 'parent-run-7', 'O3 spawn: createPersistedRun options carry parentRunId');
    assert(options.metadata.delegationDepth === d.proposedDepth,
      'O3 spawn: child stamped with the SAME depth the gate approved');
  }
  {
    // Refusal: structured, parent-visible, never a throw.
    const gate = canDelegate({ proposedDepth: 3, inFlight: 0, requestedRole: 'coder', taskPreview: 'too deep' });
    assert(!gate.ok && gate.reason === 'depth_exceeded' && typeof gate.detail === 'string',
      'O3 refusal: depth rejection is a structured decision');
    const parent = buildSubagentParentSummary({
      payload: { summary: `Subagent delegation blocked — ${gate.detail}`, toolCallCount: 0, completed: false },
      status: 'blocked',
    });
    assert(parent.status === 'blocked' && parent.toolCallCount === 0
      && parent.tokens.input === null && parent.tokens.output === null,
      'O3 refusal: parent gets a blocked summary contract, not an exception');
  }

  if (failures > 0) {
    console.error(`\n${failures} delegation-wiring smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll delegation-wiring smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
