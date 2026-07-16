/**
 * Smoke: src/lib/v2AgentEventActivityCore.ts
 *
 * House harness (numbered groups incl. a hostile no-throw group; 50+ asserts;
 * process.exit(1) on any failure). Verifies the loop-convergence Core C
 * (ADR-0002 §198-210, LOOP_CONVERGENCE_RUNBOOK §2.8): the pure
 * AgentEvent → UX-activity-row mapper that keeps client-loop progress narration
 * at parity with what the swanbot-v2-ai edge surfaced. Checks against the REAL
 * AgentEvent union in src/lib/agentExecutionCore.ts and the edge usage shape in
 * supabase/functions/swanbot-v2-ai/index.ts.
 *
 * Run: npx tsx scripts/v2-agent-event-activity-core-smoketest.ts
 */

import {
  agentEventToActivity,
  buildActivityStreamFromEvents,
  accumulateUsageFromEvents,
  V2_AGENT_ACTIVITY_LABELS,
  V2_AGENT_ACTIVITY_LIMITS,
  MAX_ACTIVITY_DETAIL_CHARS,
  type AgentActivityRow,
} from '../src/lib/v2AgentEventActivityCore';
import { MAX_ACTIVITY_LABEL_CHARS, FALLBACK_ACTIVITY_LABEL } from '../src/lib/toolActivityLabelCore';

let passes = 0;
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = Object.is(actual, expected);
  if (!ok) console.error(`    actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  assert(ok, msg);
}
function group(n: number, title: string): void {
  console.log(`\n[${n}] ${title}`);
}
function noThrow(label: string, fn: () => unknown): unknown {
  try {
    const v = fn();
    passes += 1;
    return v;
  } catch (e) {
    failures += 1;
    console.error(`  ✗ THREW: ${label}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** A control character (BEL) for injection tests, built ASCII-safe. */
const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);

function main(): void {
  // ── 1. turn_start → thinking ────────────────────────────────────────────────
  group(1, 'turn_start → thinking row');
  {
    const r = agentEventToActivity({ kind: 'turn_start', iteration: 1 });
    assert(r !== null, 'turn_start produces a row');
    assertEq(r!.kind, 'thinking', 'kind is thinking');
    assertEq(r!.label, V2_AGENT_ACTIVITY_LABELS.thinking, 'label is the thinking constant');
    assertEq('detail' in r!, false, 'no detail on a thinking row');
  }

  // ── 2. tool_call_start → tool row via toolActivityLabel + tool-name detail ──
  group(2, 'tool_call_start → tool row');
  {
    const r = agentEventToActivity({
      kind: 'tool_call_start', iteration: 1,
      toolName: 'desktop.read_a11y_tree', toolUseId: 'tu1', input: {},
    });
    assertEq(r!.kind, 'tool', 'kind is tool');
    assertEq(r!.label, 'Reading the screen…', 'label from toolActivityLabel map');
    assertEq(r!.detail, 'desktop.read_a11y_tree', 'detail is the tool name');
    // Unknown tool → family/verb fallback still yields a usable label.
    const r2 = agentEventToActivity({ kind: 'tool_call_start', iteration: 1, toolName: 'widgets.create', toolUseId: 't', input: {} });
    assertEq(r2!.label, 'Creating…', 'unknown tool derives a verb label');
    assertEq(r2!.detail, 'widgets.create', 'detail preserved for unknown tool');
    // Non-string tool name → fallback label, no detail.
    const r3 = agentEventToActivity({ kind: 'tool_call_start', iteration: 1, toolName: 42, toolUseId: 't', input: {} });
    assertEq(r3!.label, FALLBACK_ACTIVITY_LABEL, 'numeric tool name → fallback label');
    assertEq('detail' in r3!, false, 'numeric tool name → no detail');
  }

  // ── 3. tool_call_result: ok:false → tool_error; ok:true / malformed → null ──
  group(3, 'tool_call_result mapping');
  {
    const err = agentEventToActivity({
      kind: 'tool_call_result', iteration: 1, toolName: 'local.run_shell', toolUseId: 't',
      result: { ok: false, error: 'command failed' }, durationMs: 12,
    });
    assertEq(err!.kind, 'tool_error', 'ok:false → tool_error kind');
    assertEq(err!.label, V2_AGENT_ACTIVITY_LABELS.toolError, 'tool_error label');
    assertEq(err!.detail, 'local.run_shell', 'tool_error detail is the tool name');
    const ok = agentEventToActivity({
      kind: 'tool_call_result', iteration: 1, toolName: 'x', toolUseId: 't',
      result: { ok: true, data: { fine: 1 } }, durationMs: 3,
    });
    assertEq(ok, null, 'ok:true → null (superseded by next step)');
    // Missing / malformed result → null (can't confidently narrate).
    assertEq(agentEventToActivity({ kind: 'tool_call_result', iteration: 1, toolName: 'x', toolUseId: 't' }), null, 'absent result → null');
    assertEq(agentEventToActivity({ kind: 'tool_call_result', iteration: 1, toolName: 'x', toolUseId: 't', result: 'nope' }), null, 'non-object result → null');
  }

  // ── 4. status events (compaction / solver / steering / cap) ─────────────────
  group(4, 'status lifecycle events');
  {
    const comp = agentEventToActivity({ kind: 'context_compressed', iteration: 2, droppedCount: 3, tokensBefore: 9, tokensAfter: 4 });
    assertEq(comp!.kind, 'status', 'context_compressed → status');
    assertEq(comp!.label, V2_AGENT_ACTIVITY_LABELS.contextCompressed, 'compaction label');
    const solv = agentEventToActivity({ kind: 'solver_consultation', iteration: 2, reason: 'x' });
    assertEq(solv!.label, V2_AGENT_ACTIVITY_LABELS.solverConsultation, 'solver label');
    const steer = agentEventToActivity({ kind: 'steering_applied', iteration: 2, note: 'go faster' });
    assertEq(steer!.label, V2_AGENT_ACTIVITY_LABELS.steeringApplied, 'steering label');
    assertEq('detail' in steer!, false, 'steering note is NOT surfaced as detail (untrusted user text)');
    const cap = agentEventToActivity({ kind: 'max_iterations_exceeded', iteration: 5 });
    assertEq(cap!.label, V2_AGENT_ACTIVITY_LABELS.maxIterations, 'max-iterations label');
  }

  // ── 5. loop_stopped_no_progress → status + sanitised reason detail ──────────
  group(5, 'loop_stopped_no_progress → status + reason');
  {
    const r = agentEventToActivity({ kind: 'loop_stopped_no_progress', iteration: 4, reason: 'repeated identical failing call — desktop.click x3' });
    assertEq(r!.kind, 'status', 'kind is status');
    assertEq(r!.label, V2_AGENT_ACTIVITY_LABELS.loopStopped, 'stopped label');
    assert(typeof r!.detail === 'string' && r!.detail.includes('repeated identical'), 'reason carried as detail');
    // Non-string reason → no detail, still a valid status row.
    const r2 = agentEventToActivity({ kind: 'loop_stopped_no_progress', iteration: 4, reason: { not: 'a string' } });
    assertEq(r2!.kind, 'status', 'still a status row without a usable reason');
    assertEq('detail' in r2!, false, 'non-string reason → no detail');
  }

  // ── 6. non-narration events → null ──────────────────────────────────────────
  group(6, 'non-narration events → null');
  {
    assertEq(agentEventToActivity({ kind: 'model_delta', iteration: 1, text: 'partial' }), null, 'model_delta → null');
    assertEq(agentEventToActivity({ kind: 'turn_end', iteration: 1, stop_reason: 'tool_use' }), null, 'turn_end → null');
    assertEq(agentEventToActivity({ kind: 'iteration_complete', iteration: 1, messages: [] }), null, 'iteration_complete → null');
    assertEq(agentEventToActivity({ kind: 'final_response', iteration: 1, text: 'the answer' }), null, 'final_response → null');
    assertEq(agentEventToActivity({ kind: 'totally_unknown_kind' }), null, 'unknown kind → null');
  }

  // ── 7. secret-safety: input / error text never leaks into a row ─────────────
  group(7, 'secret-safety: no raw input / error / delta leakage');
  {
    const SECRET = 'sk-live-DEADBEEFsecrettoken';
    // tool_call_start with a secret buried in structured input → label ignores it.
    const start = agentEventToActivity({
      kind: 'tool_call_start', iteration: 1, toolName: 'gmail.write', toolUseId: 't',
      input: { to: 'a@b.co', apiKey: SECRET, body: SECRET },
    });
    assertEq(start!.label, 'Sending the email…', 'gmail.write → static map label (input ignored)');
    assert(!JSON.stringify(start).includes(SECRET), 'secret in input never reaches the row');
    // local.run_shell surfaces only whitelisted command fragments, not secrets.
    const shell = agentEventToActivity({
      kind: 'tool_call_start', iteration: 1, toolName: 'local.run_shell', toolUseId: 't',
      input: { command: `deploy --token=${SECRET}` },
    });
    assert(!JSON.stringify(shell).includes(SECRET), 'run_shell secret token stripped from label');
    assert(shell!.label.startsWith('Running'), 'run_shell still narrates the verb');
    // tool_call_result error text (may hold secrets/paths) is NEVER surfaced.
    const errRow = agentEventToActivity({
      kind: 'tool_call_result', iteration: 1, toolName: 'x', toolUseId: 't',
      result: { ok: false, error: `login failed for ${SECRET} at /Users/secret/.env` },
    });
    assert(!JSON.stringify(errRow).includes(SECRET), 'error secret not in the tool_error row');
    assert(!JSON.stringify(errRow).includes('/Users/secret'), 'error path not in the tool_error row');
  }

  // ── 8. bounds: label ≤ cap (control-free), detail ≤ cap ─────────────────────
  group(8, 'bounds: label + detail clamping');
  {
    // Huge, control-char-laden reason → detail clamped + stripped.
    const bigReason = `${BEL}danger${NUL} ` + 'z'.repeat(500);
    const r = agentEventToActivity({ kind: 'loop_stopped_no_progress', iteration: 1, reason: bigReason });
    assert(r!.detail!.length <= MAX_ACTIVITY_DETAIL_CHARS, 'detail clamped to MAX_ACTIVITY_DETAIL_CHARS');
    assert(!new RegExp('[' + NUL + BEL + ']').test(r!.detail!), 'control chars stripped from detail');
    // Every produced row across the union has a bounded, control-free label.
    const kinds = [
      { kind: 'turn_start', iteration: 1 },
      { kind: 'tool_call_start', iteration: 1, toolName: 'x'.repeat(400), toolUseId: 't', input: {} },
      { kind: 'tool_call_result', iteration: 1, toolName: 'x', toolUseId: 't', result: { ok: false, error: 'e' } },
      { kind: 'context_compressed', iteration: 1, droppedCount: 0, tokensBefore: 0, tokensAfter: 0 },
      { kind: 'max_iterations_exceeded', iteration: 1 },
    ];
    for (const ev of kinds) {
      const out = agentEventToActivity(ev);
      if (!out) continue;
      assert(out.label.length > 0 && out.label.length <= MAX_ACTIVITY_LABEL_CHARS, `label bounded for ${ev.kind}`);
      assert(!new RegExp('[' + NUL + BEL + ']').test(out.label), `label control-free for ${ev.kind}`);
    }
  }

  // ── 9. buildActivityStreamFromEvents: order, filtering, dedup ───────────────
  group(9, 'buildActivityStreamFromEvents: shape');
  {
    const events = [
      { kind: 'turn_start', iteration: 1 },
      { kind: 'model_delta', iteration: 1, text: 'thinking...' },       // dropped
      { kind: 'tool_call_start', iteration: 1, toolName: 'verification.tests', toolUseId: 'a', input: {} },
      { kind: 'tool_call_result', iteration: 1, toolName: 'verification.tests', toolUseId: 'a', result: { ok: true, data: {} } }, // dropped
      { kind: 'iteration_complete', iteration: 1, messages: [] },       // dropped
      { kind: 'turn_start', iteration: 2 },
      { kind: 'turn_start', iteration: 3 },                              // consecutive dup collapsed
      { kind: 'tool_call_start', iteration: 3, toolName: 'git.run', toolUseId: 'b', input: { verb: 'commit' } },
      { kind: 'final_response', iteration: 3, text: 'done' },           // dropped
    ];
    const rows = buildActivityStreamFromEvents(events);
    assert(Array.isArray(rows), 'returns an array');
    const labels = rows.map((r) => r.label);
    assertEq(JSON.stringify(labels), JSON.stringify(['Thinking…', 'Running tests…', 'Thinking…', 'git commit…']), 'nulls filtered, consecutive dup collapsed, order preserved');
    assertEq(rows[0].kind, 'thinking', 'first row is thinking');
    assertEq(rows[1].kind, 'tool', 'second row is tool');
    assertEq(rows[3].detail, 'git.run', 'git.run detail carried');
    // Two DIFFERENT tools back-to-back are NOT collapsed.
    const two = buildActivityStreamFromEvents([
      { kind: 'tool_call_start', iteration: 1, toolName: 'codebase.search', toolUseId: '1', input: {} },
      { kind: 'tool_call_start', iteration: 1, toolName: 'code.generate', toolUseId: '2', input: {} },
    ]);
    assertEq(two.length, 2, 'distinct consecutive tool rows both kept');
  }

  // ── 10. buildActivityStreamFromEvents: bounds + non-array ───────────────────
  group(10, 'buildActivityStreamFromEvents: bounds');
  {
    // Alternating distinct rows so dedup never collapses — forces the row cap.
    const many: unknown[] = [];
    for (let i = 0; i < V2_AGENT_ACTIVITY_LIMITS.maxStreamRows + 500; i++) {
      many.push(i % 2 === 0
        ? { kind: 'turn_start', iteration: i }
        : { kind: 'context_compressed', iteration: i, droppedCount: 0, tokensBefore: 0, tokensAfter: 0 });
    }
    const capped = buildActivityStreamFromEvents(many);
    assertEq(capped.length, V2_AGENT_ACTIVITY_LIMITS.maxStreamRows, 'output capped at maxStreamRows');
    // Non-array / garbage → [].
    assertEq(JSON.stringify(buildActivityStreamFromEvents(null)), '[]', 'null → []');
    assertEq(JSON.stringify(buildActivityStreamFromEvents(undefined)), '[]', 'undefined → []');
    assertEq(JSON.stringify(buildActivityStreamFromEvents('nope')), '[]', 'string → []');
    assertEq(JSON.stringify(buildActivityStreamFromEvents({ kind: 'turn_start' })), '[]', 'object → []');
    assertEq(JSON.stringify(buildActivityStreamFromEvents([])), '[]', 'empty array → []');
    // Array of garbage elements → all skipped, [].
    assertEq(JSON.stringify(buildActivityStreamFromEvents([1, 'x', null, true, {}, { kind: 'model_delta' }])), '[]', 'garbage/no-row elements → []');
  }

  // ── 11. accumulateUsageFromEvents: turn_end rollup mirrors the edge ─────────
  group(11, 'accumulateUsageFromEvents');
  {
    const events = [
      { kind: 'turn_start', iteration: 1 },
      { kind: 'turn_end', iteration: 1, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 } },
      { kind: 'tool_call_start', iteration: 1, toolName: 'x', toolUseId: 't', input: {} },
      { kind: 'turn_end', iteration: 2, stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 2 } },
    ];
    const u = accumulateUsageFromEvents(events);
    assertEq(u.inputTokens, 150, 'input_tokens summed across turn_end events');
    assertEq(u.outputTokens, 30, 'output_tokens summed');
    assertEq(u.cachedTokens, 10, 'cache_read + cache_creation summed (5+3+2)');
    // No usage / non-turn_end events → zeros.
    const z = accumulateUsageFromEvents([{ kind: 'turn_start', iteration: 1 }, { kind: 'turn_end', iteration: 1, stop_reason: 'end_turn' }]);
    assertEq(JSON.stringify(z), '{"inputTokens":0,"outputTokens":0,"cachedTokens":0}', 'no usage → zeroed rollup');
    // Floor + clamp ≥ 0 (edge parity with agentRunTokenUsageFields).
    const messy = accumulateUsageFromEvents([
      { kind: 'turn_end', usage: { input_tokens: 10.9, output_tokens: -5, cache_read_input_tokens: NaN, cache_creation_input_tokens: Infinity } },
    ]);
    assertEq(messy.inputTokens, 10, 'fractional input floored');
    assertEq(messy.outputTokens, 0, 'negative output clamped to 0');
    assertEq(messy.cachedTokens, 0, 'NaN/Infinity cache → 0');
    // Non-array → zeros.
    assertEq(JSON.stringify(accumulateUsageFromEvents(null)), '{"inputTokens":0,"outputTokens":0,"cachedTokens":0}', 'null → zeroed rollup');
  }

  // ── 12. HOSTILE no-throw group: null/garbage/throwing/cyclic/huge ───────────
  group(12, 'HOSTILE: total, never throws');
  {
    // agentEventToActivity never throws and returns null on non-events.
    assertEq(noThrow('event(null)', () => agentEventToActivity(null)), null, 'agentEventToActivity(null) → null');
    assertEq(noThrow('event(undefined)', () => agentEventToActivity(undefined)), null, 'agentEventToActivity(undefined) → null');
    assertEq(noThrow('event(number)', () => agentEventToActivity(42)), null, 'agentEventToActivity(42) → null');
    assertEq(noThrow('event(string)', () => agentEventToActivity('turn_start')), null, 'agentEventToActivity(string) → null');
    assertEq(noThrow('event(array)', () => agentEventToActivity([1, 2, 3])), null, 'agentEventToActivity(array) → null');
    assertEq(noThrow('event({})', () => agentEventToActivity({})), null, 'agentEventToActivity({}) → null (no kind)');
    assertEq(noThrow('event(kind:number)', () => agentEventToActivity({ kind: 5 })), null, 'non-string kind → null');

    // Throwing getters on the hot fields must be swallowed.
    const throwKind = new Proxy({}, { get(_t, p) { if (p === 'kind') throw new Error('kind boom'); return undefined; } });
    assertEq(noThrow('throwing kind getter', () => agentEventToActivity(throwKind)), null, 'throwing kind getter → null');
    const throwInput = { kind: 'tool_call_start', toolName: 'x', toolUseId: 't', get input() { throw new Error('input boom'); } };
    assertEq(noThrow('throwing input getter', () => agentEventToActivity(throwInput)), null, 'throwing input getter → null');
    const throwName = { kind: 'tool_call_start', get toolName() { throw new Error('name boom'); }, toolUseId: 't', input: {} };
    assertEq(noThrow('throwing toolName getter', () => agentEventToActivity(throwName)), null, 'throwing toolName getter → null');
    const throwResult = { kind: 'tool_call_result', toolName: 'x', toolUseId: 't', get result() { throw new Error('result boom'); } };
    assertEq(noThrow('throwing result getter', () => agentEventToActivity(throwResult)), null, 'throwing result getter → null');

    // Cyclic input on a tool_call_start must not hang or throw.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    noThrow('cyclic tool input', () => agentEventToActivity({ kind: 'tool_call_start', toolName: 'local.run_shell', toolUseId: 't', input: cyclic }));

    // buildActivityStreamFromEvents over a mixed hostile array — never throws.
    const hostileArr = [null, undefined, 1, 'x', true, {}, { kind: 'turn_start' }, throwKind, throwInput, { kind: 'tool_call_result', result: null }];
    const hs = noThrow('stream(hostile array)', () => buildActivityStreamFromEvents(hostileArr)) as AgentActivityRow[];
    assert(Array.isArray(hs), 'stream(hostile array) returns an array');
    assert(hs.every((r) => typeof r.label === 'string' && r.label.length <= MAX_ACTIVITY_LABEL_CHARS), 'every survivor row has a bounded label');

    // An array whose length getter is hostile / huge sparse array — bounded scan.
    const sparse = new Array(1_000_000);
    sparse[0] = { kind: 'turn_start', iteration: 1 };
    const sp = noThrow('stream(huge sparse)', () => buildActivityStreamFromEvents(sparse)) as AgentActivityRow[];
    assert(Array.isArray(sp) && sp.length <= V2_AGENT_ACTIVITY_LIMITS.maxStreamRows, 'huge sparse array stays bounded, no throw');

    // accumulateUsageFromEvents over hostile input — never throws, returns zeros-ish.
    const au = noThrow('usage(hostile)', () => accumulateUsageFromEvents([null, 1, 'x', { kind: 'turn_end', usage: null }, { kind: 'turn_end', get usage() { throw new Error('u'); } }])) as { inputTokens: number };
    assert(au && typeof au.inputTokens === 'number', 'usage(hostile) returns a numeric rollup');
    noThrow('usage(number)', () => accumulateUsageFromEvents(999));
    noThrow('usage(string)', () => accumulateUsageFromEvents('nope'));
    noThrow('usage(object)', () => accumulateUsageFromEvents({ kind: 'turn_end' }));

    // Frozen constants must not be mutable in a way that corrupts later calls.
    noThrow('labels frozen', () => { try { (V2_AGENT_ACTIVITY_LABELS as Record<string, string>).thinking = 'x'; } catch { /* strict-mode throw is fine */ } });
    assertEq(V2_AGENT_ACTIVITY_LABELS.thinking, 'Thinking…', 'labels constant unchanged after mutation attempt');
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  if (failures > 0) {
    console.error(`✗ v2AgentEventActivityCore smoke FAILED: ${passes} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`✓ v2AgentEventActivityCore smoke PASSED: ${passes} assertions, 0 failures`);
}

main();
