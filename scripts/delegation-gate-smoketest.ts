/**
 * delegation-gate-smoketest — CA-8d. Pins the depth + concurrency
 * gate plus the summary-only redaction contract. Both are pure
 * functions — runner smoke-tests subagent flow with no Supabase.
 *
 * Run: npm run smoke:delegation-gate
 */

import {
  MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE,
  MAX_DELEGATION_DEPTH,
  SUBAGENT_TYPED_CORE_FLAG,
  buildSubagentChildRunOptions,
  buildSubagentLoopSummary,
  buildSubagentParentSummary,
  canDelegate,
  isSubagentTypedCoreEnabled,
  redactSubagentOutput,
  serializeSubagentSummaryForParent,
  type SubagentTranscript,
} from '../src/lib/delegationGate';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Constants pinned ───────────────────────────────────────────
  assert(MAX_DELEGATION_DEPTH === 2, `constant: depth limit is 2 (got ${MAX_DELEGATION_DEPTH})`);
  assert(MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE === 3,
    `constant: concurrency limit is 3 (got ${MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE})`);

  // ─── canDelegate happy path ─────────────────────────────────────
  {
    const d = canDelegate({ proposedDepth: 1, inFlight: 0 });
    assert(d.ok, 'gate: root→child (depth 1, 0 in-flight) allowed');
    assert(d.reason === 'ok', 'gate: reason="ok" on allow');
    assert(d.remainingSlots === 2, `gate: remainingSlots=2 (got ${d.remainingSlots})`);
  }

  // At exact depth limit
  {
    const d = canDelegate({ proposedDepth: 2, inFlight: 0 });
    assert(d.ok, 'gate: depth exactly 2 (grandchild) allowed');
    assert(d.remainingSlots === 2, 'gate: remainingSlots=2 at depth 2');
  }

  // Just past depth limit
  {
    const d = canDelegate({ proposedDepth: 3, inFlight: 0 });
    assert(!d.ok, 'gate: depth 3 (great-grandchild) rejected');
    assert(d.reason === 'depth_exceeded', 'gate: reason=depth_exceeded');
    assert(d.detail?.includes('3') && d.detail?.includes('2'), 'gate: detail names actual+max depth');
    assert(d.remainingSlots === 0, 'gate: remainingSlots=0 on depth reject');
  }

  // Extreme depth
  {
    const d = canDelegate({ proposedDepth: 99, inFlight: 0 });
    assert(!d.ok && d.reason === 'depth_exceeded', 'gate: very deep → rejected');
  }

  // ─── Concurrency limit ──────────────────────────────────────────
  {
    // Just below cap
    const d = canDelegate({ proposedDepth: 1, inFlight: 2 });
    assert(d.ok, 'gate: 2 in-flight + 1 proposed (= 3) still allowed');
    assert(d.remainingSlots === 0, 'gate: remainingSlots=0 when filling the last slot');
  }
  {
    // At cap
    const d = canDelegate({ proposedDepth: 1, inFlight: 3 });
    assert(!d.ok, 'gate: 3 in-flight → reject new');
    assert(d.reason === 'concurrency_exceeded', 'gate: reason=concurrency_exceeded');
    assert(d.detail?.includes('3'), 'gate: detail names in-flight count');
  }
  {
    // Over cap
    const d = canDelegate({ proposedDepth: 1, inFlight: 10 });
    assert(!d.ok && d.reason === 'concurrency_exceeded', 'gate: way over cap still rejects');
  }

  // Depth + concurrency both violated — depth wins (checked first)
  {
    const d = canDelegate({ proposedDepth: 5, inFlight: 5 });
    assert(!d.ok, 'gate: both violated → rejected');
    assert(d.reason === 'depth_exceeded', 'gate: depth reason takes priority');
  }

  // ─── O4: daily spend limit ──────────────────────────────────────
  {
    const d = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: 12.5, dailySpendLimitUsd: 10 });
    assert(!d.ok, 'gate: spend over limit rejected');
    assert(d.reason === 'spend_limit_exceeded', 'gate: reason=spend_limit_exceeded');
    assert(d.detail?.includes('$12.50') && d.detail?.includes('$10.00'), 'gate: detail names spend + limit');
    assert(d.remainingSlots === 0, 'gate: remainingSlots=0 on spend reject');
  }
  {
    const d = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: 10, dailySpendLimitUsd: 10 });
    assert(!d.ok && d.reason === 'spend_limit_exceeded', 'gate: spend exactly at limit rejected (>=)');
  }
  {
    const d = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: 4.2, dailySpendLimitUsd: 10 });
    assert(d.ok, 'gate: spend under limit allowed');
  }
  {
    const d = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: 0, dailySpendLimitUsd: 0 });
    assert(!d.ok && d.reason === 'spend_limit_exceeded', 'gate: explicit $0 limit blocks every spawn');
  }
  {
    // Fail-open: missing telemetry or missing limit skips the check.
    const noSpend = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: null, dailySpendLimitUsd: 10 });
    assert(noSpend.ok, 'gate: null spend (telemetry unavailable) fails open');
    const noLimit = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: 999, dailySpendLimitUsd: null });
    assert(noLimit.ok, 'gate: null limit (unconfigured circle) fails open');
    const nan = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: NaN, dailySpendLimitUsd: 10 });
    assert(nan.ok, 'gate: NaN spend fails open');
    const negative = canDelegate({ proposedDepth: 1, inFlight: 0, dailySpendUsd: -3, dailySpendLimitUsd: 10 });
    assert(negative.ok, 'gate: negative spend (bad telemetry) fails open');
  }
  {
    // Depth/concurrency still win over the spend check (checked first).
    const d = canDelegate({ proposedDepth: 3, inFlight: 0, dailySpendUsd: 999, dailySpendLimitUsd: 10 });
    assert(d.reason === 'depth_exceeded', 'gate: depth reason beats spend reason');
  }

  // ─── Invalid input ──────────────────────────────────────────────
  {
    const d = canDelegate({ proposedDepth: -1, inFlight: 0 });
    assert(!d.ok && d.reason === 'invalid_input', 'gate: negative depth rejected');
  }
  {
    const d = canDelegate({ proposedDepth: 1, inFlight: -5 });
    assert(!d.ok && d.reason === 'invalid_input', 'gate: negative in-flight rejected');
  }
  {
    const d = canDelegate({ proposedDepth: NaN as any, inFlight: 0 });
    assert(!d.ok && d.reason === 'invalid_input', 'gate: NaN depth rejected');
  }

  // ─── redactSubagentOutput: explicit summary wins ────────────────
  {
    const t: SubagentTranscript = {
      toolCalls: [{ name: 'tasks.list' }, { name: 'missions.list' }],
      finalText: 'A long final text the model wrote without summarising.',
      explicitSummary: 'Found 3 open tasks.',
      stopReason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 200 },
    };
    const redacted = redactSubagentOutput(t);
    assert(redacted.summary === 'Found 3 open tasks.', 'redact: explicitSummary wins');
    assert(redacted.toolCallCount === 2, 'redact: tool count preserved');
    assert(redacted.completed === true, 'redact: stop_reason=end_turn → completed');
    assert(redacted.inputTokens === 1000, 'redact: input tokens carried');
    assert(redacted.outputTokens === 200, 'redact: output tokens carried');
  }

  // Fall back to finalText
  {
    const t: SubagentTranscript = {
      toolCalls: [],
      finalText: 'A shorter final reply.',
      stopReason: 'end_turn',
    };
    const redacted = redactSubagentOutput(t);
    assert(redacted.summary === 'A shorter final reply.', 'redact: finalText used when no explicitSummary');
    assert(redacted.toolCallCount === 0, 'redact: zero tool calls');
  }

  // Both empty
  {
    const t: SubagentTranscript = { toolCalls: [], finalText: '', stopReason: 'end_turn' };
    const redacted = redactSubagentOutput(t);
    assert(redacted.summary === 'Subagent returned no output.', 'redact: empty → placeholder');
  }

  // Cap at 1200 chars
  {
    const big = 'a'.repeat(2000);
    const t: SubagentTranscript = { toolCalls: [], finalText: big, stopReason: 'end_turn' };
    const redacted = redactSubagentOutput(t);
    assert(redacted.summary.length === 1200, `redact: capped at 1200 (got ${redacted.summary.length})`);
    assert(redacted.summary.endsWith('...'), 'redact: ellipsis on truncation');
  }

  // Just under cap — no truncation
  {
    const t: SubagentTranscript = { toolCalls: [], finalText: 'x'.repeat(1199), stopReason: 'end_turn' };
    const redacted = redactSubagentOutput(t);
    assert(redacted.summary.length === 1199, 'redact: 1199 chars preserved (under cap)');
    assert(!redacted.summary.endsWith('...'), 'redact: no ellipsis when under cap');
  }

  // Stop reasons other than end_turn → not completed
  {
    const t: SubagentTranscript = { toolCalls: [], finalText: 'stopped early', stopReason: 'max_tokens' };
    const redacted = redactSubagentOutput(t);
    assert(!redacted.completed, 'redact: max_tokens → not completed');
  }
  {
    const t: SubagentTranscript = { toolCalls: [], finalText: 'still going', stopReason: 'tool_use' };
    const redacted = redactSubagentOutput(t);
    assert(!redacted.completed, 'redact: tool_use (unfinished) → not completed');
  }

  // Missing usage — omitted from payload (not 0)
  {
    const t: SubagentTranscript = { toolCalls: [], finalText: 'x', stopReason: 'end_turn' };
    const redacted = redactSubagentOutput(t);
    assert(redacted.inputTokens === undefined, 'redact: missing input_tokens → undefined (not 0)');
    assert(redacted.outputTokens === undefined, 'redact: missing output_tokens → undefined');
  }

  // ─── serializeSubagentSummaryForParent ─────────────────────────
  {
    const payload = redactSubagentOutput({
      toolCalls: [{ name: 'a' }, { name: 'b' }],
      finalText: 'done',
      stopReason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    const serialized = serializeSubagentSummaryForParent(payload);
    const parsed = JSON.parse(serialized);
    assert(parsed.ok === true, 'serialize: ok=true');
    assert(parsed.data.summary === 'done', 'serialize: summary nested under data');
    assert(parsed.data.tool_calls === 2, 'serialize: tool_calls count');
    assert(parsed.data.completed === true, 'serialize: completed flag');
    assert(parsed.data.usage.input_tokens === 50, 'serialize: usage carried');
  }

  // Serialized usage null when omitted
  {
    const payload = redactSubagentOutput({
      toolCalls: [],
      finalText: 'done',
      stopReason: 'end_turn',
    });
    const parsed = JSON.parse(serializeSubagentSummaryForParent(payload));
    assert(parsed.data.usage.input_tokens === null, 'serialize: missing usage → null in output');
    assert(parsed.data.usage.output_tokens === null, 'serialize: missing output_tokens → null');
  }

  // ─── DelegationResult composition (task #109) ───────────────────
  // Mirrors the transcript construction in subagentRegistry's
  // delegateToSubagent success path. If this smoke breaks, the
  // parent LLM will start seeing full child transcripts again —
  // exactly the regression CA-8d is supposed to prevent.
  {
    type ToolAction = { tool_name: string; status: 'completed' | 'failed' | 'blocked' | 'manual_required' };
    const bigResponse = 'x'.repeat(3000);
    const toolActions: ToolAction[] = [
      { tool_name: 'fs.read', status: 'completed' },
      { tool_name: 'fs.write', status: 'failed' },
      { tool_name: 'shell', status: 'completed' },
    ];
    const transcript = {
      finalText: bigResponse,
      toolCalls: toolActions.map((action) => ({
        name: action.tool_name,
        input: undefined,
        ok: action.status === 'completed',
      })),
      stopReason: 'end_turn' as const,
    };
    const payload = redactSubagentOutput(transcript);
    assert(payload.summary.length <= 1200, 'delegation: long response truncated to ≤1200 chars');
    assert(payload.summary.endsWith('...'), 'delegation: truncation adds "..." marker');
    assert(payload.toolCallCount === 3, 'delegation: tool-call count preserved');
    assert(payload.completed === true, 'delegation: end_turn → completed=true');
  }

  // Empty response path — parent sees "no output" marker instead
  // of empty string (which would confuse the LLM).
  {
    const payload = redactSubagentOutput({ finalText: '', toolCalls: [], stopReason: 'end_turn' });
    assert(payload.summary === 'Subagent returned no output.', 'delegation: empty response → no-output marker');
    assert(payload.toolCallCount === 0, 'delegation: zero tool calls preserved');
  }

  // Max-tokens / hit cap → completed=false (parent can choose to
  // retry or accept partial).
  {
    const payload = redactSubagentOutput({ finalText: 'partial', toolCalls: [], stopReason: 'max_tokens' });
    assert(payload.completed === false, 'delegation: stopReason=max_tokens → completed=false');
  }

  // ─── O3: gate context fields are decision-neutral ───────────────
  {
    const plain = canDelegate({ proposedDepth: 1, inFlight: 0 });
    const withCtx = canDelegate({
      proposedDepth: 1,
      inFlight: 0,
      requestedRole: 'coder',
      taskPreview: 'Implement the primary solution for this task',
    });
    assert(withCtx.ok === plain.ok && withCtx.reason === plain.reason
      && withCtx.remainingSlots === plain.remainingSlots,
      'O3 gate: requestedRole/taskPreview do not change the decision');
    const rejected = canDelegate({ proposedDepth: 9, inFlight: 0, requestedRole: 'coder', taskPreview: 'x' });
    assert(!rejected.ok && rejected.reason === 'depth_exceeded',
      'O3 gate: refusal shape unchanged with context fields');
  }

  // ─── O3: escape-hatch flag (uc_subagent_typed_core) ─────────────
  {
    const g = globalThis as { localStorage?: { getItem?: (k: string) => string | null } };
    const original = g.localStorage;
    const withStore = (value: string | null) => {
      g.localStorage = { getItem: (k: string) => (k === SUBAGENT_TYPED_CORE_FLAG ? value : null) };
    };
    try {
      delete g.localStorage;
      assert(isSubagentTypedCoreEnabled() === true, 'O3 flag: no storage → default ON');
      withStore(null);
      assert(isSubagentTypedCoreEnabled() === true, 'O3 flag: key absent → ON');
      withStore('0');
      assert(isSubagentTypedCoreEnabled() === false, "O3 flag: '0' → legacy path");
      withStore('false');
      assert(isSubagentTypedCoreEnabled() === false, "O3 flag: 'false' → legacy path");
      withStore('off');
      assert(isSubagentTypedCoreEnabled() === false, "O3 flag: 'off' → legacy path");
      withStore('1');
      assert(isSubagentTypedCoreEnabled() === true, "O3 flag: '1' → typed core");
      g.localStorage = { getItem: () => { throw new Error('storage exploded'); } };
      assert(isSubagentTypedCoreEnabled() === true, 'O3 flag: storage throw → default ON');
    } finally {
      if (original === undefined) delete g.localStorage;
      else g.localStorage = original;
    }
  }

  // ─── O3: buildSubagentLoopSummary (uniform summary builder) ─────
  {
    const payload = buildSubagentLoopSummary({
      finalText: 'y'.repeat(3000),
      toolCalls: [{ name: 'tasks.list', ok: true }, { name: 'fs.write', ok: false }],
      completedCleanly: true,
      usage: { input_tokens: 1234, output_tokens: 567 },
    });
    assert(payload.summary.length === 1200 && payload.summary.endsWith('...'),
      'O3 loop summary: bounded with truncation marker');
    assert(payload.toolCallCount === 2, 'O3 loop summary: toolCallCount accurate');
    assert(payload.completed === true, 'O3 loop summary: completedCleanly → completed');
    assert(payload.inputTokens === 1234 && payload.outputTokens === 567,
      'O3 loop summary: usage carried into tokens');
  }
  {
    const payload = buildSubagentLoopSummary({
      finalText: 'partial work before cap',
      toolCalls: [{ name: 'a' }],
      completedCleanly: false,
    });
    assert(payload.completed === false, 'O3 loop summary: cap/edge failure → completed=false');
    assert(payload.inputTokens === undefined && payload.outputTokens === undefined,
      'O3 loop summary: no usage → tokens omitted (legacy path parity)');
  }

  // ─── O3: buildSubagentParentSummary (parent-visible contract) ───
  {
    const parent = buildSubagentParentSummary({
      payload: { summary: 'did the thing', toolCallCount: 3, completed: true, inputTokens: 10, outputTokens: 4 },
      status: 'completed',
      runId: 'run-1',
    });
    assert(JSON.stringify(Object.keys(parent).sort())
      === JSON.stringify(['runId', 'status', 'summary', 'tokens', 'toolCallCount']),
      `O3 parent summary: EXACT key set (got ${Object.keys(parent).sort().join(',')})`);
    assert(parent.tokens.input === 10 && parent.tokens.output === 4, 'O3 parent summary: tokens accurate');
    assert(parent.status === 'completed' && parent.runId === 'run-1', 'O3 parent summary: status + runId carried');
  }
  {
    const parent = buildSubagentParentSummary({
      payload: { summary: 'blocked', toolCallCount: 0, completed: false },
      status: 'blocked',
    });
    assert(parent.tokens.input === null && parent.tokens.output === null,
      'O3 parent summary: missing usage → null tokens (never fabricated 0)');
    assert(!('runId' in parent), 'O3 parent summary: runId omitted when absent');
  }

  // ─── O3: child run persistence options (parentRunId pin) ────────
  {
    const longTask = 't'.repeat(200);
    const options = buildSubagentChildRunOptions({
      circleId: 'c1',
      userId: 'u1',
      surface: 'main_chat',
      subagentRole: 'coder',
      subagentDisplayName: 'Coder',
      task: longTask,
      model: 'claude-haiku-4-5',
      roomId: 'room-9',
      parentRunId: 'parent-run-7',
      delegationDepth: 2,
      runtimePlanVersion: 3,
    });
    assert(options.parentRunId === 'parent-run-7', 'O3 child run: parentRunId carried to createPersistedRun');
    assert(options.metadata.delegationDepth === 2, 'O3 child run: delegationDepth stamped (grandchild gate input)');
    assert(options.metadata.delegatedToRole === 'coder', 'O3 child run: role rides metadata');
    assert(options.metadata.runtimePlanVersion === 3, 'O3 child run: runtimePlanVersion stamped');
    assert(options.title === `Coder: ${'t'.repeat(80)}`, 'O3 child run: legacy title format (80-char slice)');
    assert(options.mode === 'coder' && options.model === 'claude-haiku-4-5' && options.roomId === 'room-9',
      'O3 child run: mode/model/roomId preserved');
  }
  {
    const options = buildSubagentChildRunOptions({
      circleId: 'c1',
      userId: 'u1',
      surface: 'room_chat',
      subagentRole: 'reviewer',
      subagentDisplayName: 'Reviewer',
      task: 'short',
      delegationDepth: 1,
    });
    assert(!('parentRunId' in options), 'O3 child run: root delegation omits parentRunId');
    assert(!('model' in options) && !('roomId' in options), 'O3 child run: optional fields omitted, not undefined');
  }

  if (failures > 0) {
    console.error(`\n${failures} delegation-gate smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll delegation-gate smoke cases passed.');
}

main();
