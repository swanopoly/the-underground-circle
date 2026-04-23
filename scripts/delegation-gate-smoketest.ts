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
  canDelegate,
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

  if (failures > 0) {
    console.error(`\n${failures} delegation-gate smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll delegation-gate smoke cases passed.');
}

main();
