/**
 * Smoke: src/lib/swanbotV2BatchRuntimeCore.ts
 *
 * House harness (numbered groups incl. a hostile no-throw group; 50+ asserts;
 * process.exit(1) on any failure). Verifies the loop-convergence batch runtime's
 * PURE helpers — the fail-closed model gate (runbook §2.1) and the telemetry-
 * parity terminal-row builders (runbook §3) — against the REAL edge shapes in
 * supabase/functions/swanbot-v2-ai/index.ts (MODEL_MAP :2778, model gate :2922,
 * terminal write :3002-3012, error branch :3093-3106, agentRunTokenUsageFields
 * :2402-2412).
 *
 * Run: npx tsx scripts/swanbot-v2-batch-runtime-core-smoketest.ts
 */

import {
  resolveV2BatchModel,
  resolveV2BatchMode,
  buildV2BatchRunTitle,
  buildV2BatchTerminalRow,
  buildV2BatchErrorRow,
  v2BatchTerminalStatus,
  V2_BATCH_MODEL_MAP,
  V2_BATCH_RUN_VERSION,
  V2_BATCH_RUN_SURFACE,
  V2_BATCH_DEFAULT_TARGET_AGENT,
  V2_BATCH_MAX_ITERATIONS,
  V2_BATCH_MODEL_UNSUPPORTED_CODE,
  V2_BATCH_MODEL_UNSUPPORTED_MESSAGE,
  V2_BATCH_DEFAULT_MODEL_KEY,
} from '../src/lib/swanbotV2BatchRuntimeCore';

let passes = 0;
let failures = 0;
function ok(cond: boolean, label: string): void {
  if (cond) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}
function group(name: string): void {
  console.log(`\n${name}`);
}

// Narrow helpers for the resolution union.
function asModel(r: ReturnType<typeof resolveV2BatchModel>): string | null {
  return 'model' in r ? r.model : null;
}
function asBodyError(r: ReturnType<typeof resolveV2BatchModel>) {
  return 'bodyError' in r ? r.bodyError : null;
}

// ── 1. Cohort/constant parity ────────────────────────────────────────────────
group('1. Cohort constants (telemetry parity §3)');
ok(V2_BATCH_RUN_VERSION === 'swanbot-v2-ai', 'version tag is the EXACT edge cohort tag');
ok(V2_BATCH_RUN_SURFACE === 'main_chat', 'surface is main_chat');
ok(V2_BATCH_DEFAULT_TARGET_AGENT === 'BlackSwan', 'default target agent BlackSwan');
ok(V2_BATCH_MAX_ITERATIONS === 5, 'batch cap mirrors edge MAX_ITERATIONS=5');
ok(V2_BATCH_DEFAULT_MODEL_KEY === 'claude-haiku', 'default model key claude-haiku');
ok(V2_BATCH_MODEL_UNSUPPORTED_CODE === 'model_unsupported_on_v2', 'reject code matches edge');
ok(
  V2_BATCH_MODEL_UNSUPPORTED_MESSAGE ===
    'This model is not supported on the v2 typed loop; route via swanbot-ai/llm-proxy.',
  'reject message byte-identical to edge',
);

// ── 2. Model gate — allowlist aliases resolve to concrete ids ────────────────
group('2. resolveV2BatchModel — MODEL_MAP aliases');
ok(asModel(resolveV2BatchModel('claude-haiku')) === 'claude-haiku-4-5-20251001', 'claude-haiku alias');
ok(asModel(resolveV2BatchModel('claude-sonnet')) === 'claude-sonnet-4-6', 'claude-sonnet alias');
ok(asModel(resolveV2BatchModel('claude-opus')) === 'claude-opus-4-8', 'claude-opus alias');
ok(asModel(resolveV2BatchModel('claude-fable')) === 'claude-fable-5', 'claude-fable alias');
// Every MODEL_MAP entry resolves to its mapped value (lockstep with the edge map).
for (const [alias, expected] of Object.entries(V2_BATCH_MODEL_MAP)) {
  ok(asModel(resolveV2BatchModel(alias)) === expected, `MODEL_MAP[${alias}] → ${expected}`);
}

// ── 3. Model gate — already-qualified claude-* ids pass through ──────────────
group('3. resolveV2BatchModel — qualified claude-* passthrough');
ok(asModel(resolveV2BatchModel('claude-opus-4-8')) === 'claude-opus-4-8', 'qualified opus passes');
ok(asModel(resolveV2BatchModel('claude-3-5-sonnet-latest')) === 'claude-3-5-sonnet-latest', 'any claude-* passes');
ok(asModel(resolveV2BatchModel('  claude-sonnet-4-6  ')) === 'claude-sonnet-4-6', 'trims before matching');

// ── 4. Model gate — fail closed for non-Anthropic (R4) ───────────────────────
group('4. resolveV2BatchModel — fail closed (R4 no silent widening)');
for (const bad of ['gpt-4o', 'openrouter/auto', 'google_ai/gemini-2.5-pro', 'blackswan', 'auto', 'deepseek/deepseek-reasoner', 'llama-3']) {
  const r = resolveV2BatchModel(bad);
  ok(asModel(r) === null, `non-anthropic "${bad}" rejected`);
  ok(asBodyError(r)?.code === V2_BATCH_MODEL_UNSUPPORTED_CODE, `"${bad}" carries model_unsupported_on_v2`);
  ok(asBodyError(r)?.message === V2_BATCH_MODEL_UNSUPPORTED_MESSAGE, `"${bad}" carries edge message`);
}

// ── 5. Model gate — null/empty defaults to claude-haiku (edge parity) ────────
group('5. resolveV2BatchModel — default key parity');
ok(asModel(resolveV2BatchModel(null)) === 'claude-haiku-4-5-20251001', 'null → claude-haiku default');
ok(asModel(resolveV2BatchModel(undefined)) === 'claude-haiku-4-5-20251001', 'undefined → default');
ok(asModel(resolveV2BatchModel('')) === 'claude-haiku-4-5-20251001', 'empty string → default');
ok(asModel(resolveV2BatchModel('   ')) === 'claude-haiku-4-5-20251001', 'whitespace → default');

// ── 6. mode + title helpers (edge parity) ────────────────────────────────────
group('6. resolveV2BatchMode + buildV2BatchRunTitle');
ok(resolveV2BatchMode('fast') === 'talk', 'fast → talk');
ok(resolveV2BatchMode('balanced') === 'build', 'balanced → build');
ok(resolveV2BatchMode('deep') === 'build', 'deep → build');
ok(resolveV2BatchMode(undefined) === 'build', 'undefined → build');
ok(buildV2BatchRunTitle('build', 'Fix the login bug') === 'v2 build: Fix the login bug', 'title shape');
ok(buildV2BatchRunTitle('talk', 'x'.repeat(200)).length === 'v2 talk: '.length + 80, 'title slices message to 80');

// ── 7. Terminal status mapping (edge index.ts:3000) ──────────────────────────
group('7. v2BatchTerminalStatus');
ok(v2BatchTerminalStatus('end_turn') === 'completed', 'end_turn → completed');
ok(v2BatchTerminalStatus('max_tokens') === 'failed', 'max_tokens → failed');
ok(v2BatchTerminalStatus('error') === 'failed', 'error → failed');
ok(v2BatchTerminalStatus('stop_sequence') === 'failed', 'raw stop_sequence → failed (only normalized end_turn completes)');

// ── 8. Terminal row shape (telemetry parity §3) ──────────────────────────────
group('8. buildV2BatchTerminalRow');
const now = '2026-07-16T00:00:00.000Z';
const termRow = buildV2BatchTerminalRow({
  toolCalls: [{ toolName: 'codebase.search', toolUseId: 't1', ok: true }],
  iterations: 3,
  finalStopReason: 'end_turn',
  usage: { inputTokens: 100, outputTokens: 40, cachedTokens: 12 },
  targetAgentName: 'BlackSwan',
  rawStopReason: 'end_turn',
  completedAt: now,
});
ok(termRow.status === 'completed', 'end_turn row → completed');
ok(termRow.final_stop_reason === 'end_turn', 'final_stop_reason normalized');
ok(termRow.iteration_count === 3, 'iteration_count carried');
ok(termRow.input_tokens === 100 && termRow.output_tokens === 40 && termRow.cached_tokens === 12, 'token fields');
ok(Array.isArray(termRow.tool_calls) && (termRow.tool_calls as unknown[]).length === 1, 'tool_calls carried');
ok(termRow.completed_at === now, 'completed_at is caller-injected timestamp');
const tMeta = termRow.metadata as Record<string, unknown>;
ok(tMeta.version === V2_BATCH_RUN_VERSION, 'metadata.version cohort tag present (DE-RISK: no cohort loss)');
ok(tMeta.targetAgent === 'BlackSwan', 'metadata.targetAgent carried');
ok(tMeta.rawStopReason === 'end_turn', 'metadata.rawStopReason carried');
ok(!('continuation' in tMeta), 'no continuation blob (client loop never pauses)');

// A cap-exhausted run is NOT a completion (understatement bug the edge avoids).
const capRow = buildV2BatchTerminalRow({
  toolCalls: [],
  iterations: 5,
  finalStopReason: 'max_tokens',
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
  targetAgentName: 'BlackSwan',
  rawStopReason: 'tool_use',
  completedAt: now,
});
ok(capRow.status === 'failed', 'max_tokens row → failed');
ok((capRow.metadata as Record<string, unknown>).rawStopReason === 'tool_use', 'raw tool_use preserved in metadata only');

// ── 9. Error row shape (DE-RISK #2 / edge index.ts:3093-3106) ────────────────
group('9. buildV2BatchErrorRow (orphan finalizer)');
const errRow = buildV2BatchErrorRow({ targetAgentName: 'BlackSwan', errorMessage: new Error('boom'), completedAt: now });
ok(errRow.status === 'failed', 'error row status failed');
ok(errRow.final_stop_reason === 'error', 'error row final_stop_reason error');
ok(errRow.input_tokens === 0 && errRow.output_tokens === 0 && errRow.cached_tokens === 0, 'error row zeroes usage');
ok(errRow.iteration_count === 1, 'error row iteration_count 1 (edge parity)');
ok(Array.isArray(errRow.tool_calls) && (errRow.tool_calls as unknown[]).length === 0, 'error row empty tool_calls');
ok((errRow.metadata as Record<string, unknown>).version === V2_BATCH_RUN_VERSION, 'error row KEEPS cohort tag (DE-RISK #2)');
ok((errRow.metadata as Record<string, unknown>).error === 'boom', 'error message captured from Error');
ok(
  typeof (buildV2BatchErrorRow({ targetAgentName: 'X', errorMessage: 'z'.repeat(9999), completedAt: now }).metadata as Record<string, unknown>).error === 'string' &&
    ((buildV2BatchErrorRow({ targetAgentName: 'X', errorMessage: 'z'.repeat(9999), completedAt: now }).metadata as Record<string, unknown>).error as string).length <= 500,
  'error message clamped to 500 chars',
);

// ── 10. Token clamping (edge agentRunTokenUsageFields parity) ─────────────────
group('10. token clamping — negatives/NaN/Infinity/floats');
const clampRow = buildV2BatchTerminalRow({
  toolCalls: 'not-an-array' as unknown,
  iterations: -4,
  finalStopReason: 'end_turn',
  usage: { inputTokens: -10, outputTokens: 3.9, cachedTokens: Number.POSITIVE_INFINITY },
  targetAgentName: 'BlackSwan',
  rawStopReason: 'end_turn',
  completedAt: now,
});
ok(clampRow.input_tokens === 0, 'negative input clamps to 0');
ok(clampRow.output_tokens === 3, 'float output floored');
ok(clampRow.cached_tokens === 0, 'Infinity cached clamps to 0');
ok(clampRow.iteration_count === 0, 'negative iterations clamps to 0');
ok(Array.isArray(clampRow.tool_calls) && (clampRow.tool_calls as unknown[]).length === 0, 'non-array toolCalls → []');

// ── 11. Hostile totality (never throws) ──────────────────────────────────────
group('11. hostile input — never throws');
const hostile: unknown[] = [null, undefined, 123, {}, [], NaN, Symbol('s'), () => {}, { toString() { throw new Error('x'); } }];
for (let hi = 0; hi < hostile.length; hi++) {
  const h = hostile[hi];
  try {
    resolveV2BatchModel(h as unknown);
    resolveV2BatchMode(h as unknown);
    buildV2BatchRunTitle('build', h as unknown);
    v2BatchTerminalStatus(h as unknown);
    buildV2BatchTerminalRow({
      toolCalls: h as unknown,
      iterations: h as unknown,
      finalStopReason: h as unknown as string,
      usage: h as unknown as { inputTokens: number; outputTokens: number; cachedTokens: number },
      targetAgentName: 'X',
      rawStopReason: 'end_turn',
      completedAt: now,
    });
    buildV2BatchErrorRow({ targetAgentName: 'X', errorMessage: h as unknown, completedAt: now });
    ok(true, `hostile input #${hi} handled without throw`);
  } catch (e) {
    ok(false, `threw on hostile input #${hi}: ${(e as Error).message}`);
  }
}
// Hostile usage object (missing fields) still yields zeroed, finite token fields.
const hostileUsageRow = buildV2BatchTerminalRow({
  toolCalls: [],
  iterations: 1,
  finalStopReason: 'end_turn',
  usage: {} as { inputTokens: number; outputTokens: number; cachedTokens: number },
  targetAgentName: 'X',
  rawStopReason: 'end_turn',
  completedAt: now,
});
ok(hostileUsageRow.input_tokens === 0 && hostileUsageRow.output_tokens === 0 && hostileUsageRow.cached_tokens === 0, 'missing usage fields → 0');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`swanbotV2BatchRuntimeCore smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
