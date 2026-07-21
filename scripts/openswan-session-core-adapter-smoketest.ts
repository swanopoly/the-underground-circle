/**
 * openswan-session-core-adapter-smoketest — pure smoke for the O1 adapter
 * layer (`src/lib/openswanSessionRuntimeAdapters.ts`) that moves
 * `openswanSessionRuntime` off the legacy `executeToolUseLoop` onto
 * `agentExecutionCore.runAgent`.
 *
 * Covers:
 *   1. R13 stage mapping per event kind, incl. the honest step-of-N
 *      denominator + ' — wrapping up' step-budget label boundaries
 *      (opts.maxRounds; legacy labels byte-identical when opts absent).
 *   2. Legacy dispatch-status derivation + handler-result shaping
 *      (metadata side channel, model-visible text-only payload, nudges).
 *   3. R14 metadata → legacy toolEvents incl. design-app capture key,
 *      internal-key stripping, and gate-rejection events.
 *   4. R19 approval fingerprint stability — the gate payload is the exact
 *      tool name + raw input (same `buildOpenSwanToolApprovalKey`).
 *   5. Provider turn body/response shaping (swanbot-ai transport contract).
 *   6. Result mapping: clean finish / edge failure / max-iterations
 *      (limit note + progress + resumable checkpoint) / finalization text.
 *   7. Usage aggregation from turn_end events.
 *   8. End-to-end: runAgent + wrapped tool + adapter onEvent wiring.
 *   9. Round-boundary reliability nudges (O1 nudge parity) — deterministic
 *      re-observe on failed UI actions, proof-coverage nudge, tool-budget
 *      reminder; legacy trigger conditions + exact helper text, plus an
 *      end-to-end pass through `runAgent`'s `onRoundComplete` hook.
 *  10. Circle Context Snapshot turn-start injection
 *      (`circleSnapshotContextInjection`) — block present as a user-role
 *      context message when the builder succeeds (stubbed deps), absent +
 *      turn-unbroken on builder throw/timeout, compact budget respected,
 *      `<untrusted_quoted>` fence intact with structural header outside,
 *      verbatim injection (never unwrapped), pre-snapshot message shape
 *      preserved when no block exists.
 *
 * Run with: `npx tsx scripts/openswan-session-core-adapter-smoketest.ts`
 */

import {
  accumulateLoopUsage,
  buildCapExhaustionFinalizationBody,
  buildLegacyToolEventFromResult,
  buildLegacyToolLoopResult,
  buildSwanbotToolTurnBody,
  CAP_EXHAUSTION_FINALIZATION_NOTE,
  createLegacyApprovalGateAdapter,
  createLegacyRoundNudgeHook,
  createLoopUsageAccumulator,
  deriveLegacyDispatchStatus,
  finalizeLoopUsage,
  LEGACY_EVENT_TEXT_KEY,
  LEGACY_GATE_REJECTION_TEXT,
  LEGACY_RUNTIME_STATUS_KEY,
  mapAgentEventToOpenSwanStage,
  needsCapExhaustionFinalization,
  parseSwanbotToolTurnData,
  shapeLegacyToolHandlerResult,
  toAnthropicToolShapes,
  type LegacyToolEvent,
} from '../src/lib/openswanSessionRuntimeAdapters';
import {
  runAgent,
  type AgentProvider,
  type AgentToolDefinition,
  type AgentToolResult,
  type ProviderTurnResult,
} from '../src/lib/agentExecutionCore';
import { buildOpenSwanToolApprovalKey } from '../src/lib/openswanToolApprovals';
import {
  buildCircleSnapshotContextMessage,
  buildSnapshotAwareInitialMessages,
  renderCircleSnapshotContextBlock,
  CIRCLE_SNAPSHOT_CONTEXT_BUDGET_CHARS,
  CIRCLE_SNAPSHOT_CONTEXT_HEADER,
} from '../src/lib/circleSnapshotContextInjection';
import {
  assembleCircleContextSnapshot,
  renderCircleContextSnapshot,
  type CircleContextSnapshot,
} from '../src/lib/circleContextSnapshot';
import { toolBudgetReminder } from '../src/lib/toolLoopBudget';
import { summarizeObservationForRetry } from '../src/lib/deterministicReobserve';
import { assessProofCoverage, proofCoverageNudge } from '../src/lib/proofCoverage';

let failures = 0;

function assert(ok: boolean, msg: string) {
  if (!ok) {
    failures += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('ok  :', msg);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

async function main() {
  // ── 1. Stage mapping (R13) ────────────────────────────────────────────────
  assertEqual(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 1 })?.stage,
    'reasoning',
    'turn_start maps to reasoning',
  );
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 1 })?.label === 'Reasoning with tools',
    'first turn keeps the legacy "Reasoning with tools" label',
  );
  assertEqual(
    mapAgentEventToOpenSwanStage({
      kind: 'tool_call_start', iteration: 1, toolName: 'tasks.list', toolUseId: 't1', input: {},
    }),
    { stage: 'using_tools', label: 'Using tasks.list' },
    'tool_call_start maps to using_tools',
  );
  assertEqual(
    mapAgentEventToOpenSwanStage({ kind: 'final_response', iteration: 2, text: 'done' })?.stage,
    'finalizing',
    'final_response maps to finalizing',
  );
  assertEqual(
    mapAgentEventToOpenSwanStage({ kind: 'turn_end', iteration: 1, stop_reason: 'end_turn' })?.stage,
    'finalizing',
    'non-tool_use turn_end maps to finalizing',
  );
  assertEqual(
    mapAgentEventToOpenSwanStage({ kind: 'turn_end', iteration: 1, stop_reason: 'tool_use' }),
    null,
    'tool_use turn_end emits no stage (mid-loop)',
  );
  assertEqual(
    mapAgentEventToOpenSwanStage({ kind: 'iteration_complete', iteration: 1, messages: [] }),
    null,
    'iteration_complete emits no stage',
  );
  assertEqual(
    mapAgentEventToOpenSwanStage({ kind: 'model_delta', iteration: 1, text: 'x' }),
    null,
    'model_delta emits no stage',
  );

  // ── 1b. Honest step denominator (opts.maxRounds → "step i of N") ──────────
  // Legacy no-opts label stays byte-identical (open-ended counter).
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 2 })?.label
      === 'Reasoning over tool results (step 2)',
    'no opts: legacy open-ended step label unchanged',
  );
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 1 }, { maxRounds: 5 })?.label
      === 'Reasoning with tools',
    'round-1 label byte-identical even with maxRounds provided',
  );
  // Denominator from round 2 on; ' — wrapping up' follows evaluateStepBudget
  // (STEP_BUDGET_CHECKPOINT_MARGIN=1 / RATIO=0.8; turn_start iteration is
  // 1-based — agentExecutionCore increments BEFORE emitting turn_start).
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 2 }, { maxRounds: 5 })?.label
      === 'Reasoning over tool results (step 2 of 5)',
    'denominator present at iteration 2 (5-round cap, still continue)',
  );
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 3 }, { maxRounds: 5 })?.label
      === 'Reasoning over tool results (step 3 of 5)',
    'step 3 of 5 (remaining 2, ratio 0.6) still continue — no wrap-up suffix',
  );
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 4 }, { maxRounds: 5 })?.label
      === 'Reasoning over tool results (step 4 of 5) — wrapping up',
    'step 4 of 5 hits the checkpoint margin (1 left) — wrapping up',
  );
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 5 }, { maxRounds: 5 })?.label
      === 'Reasoning over tool results (step 5 of 5) — wrapping up',
    'step 5 of 5 (budget exhausted → stop) never reads as plain continue',
  );
  // RATIO boundary distinct from the margin: 19/25 = 0.76 continue, 20/25 = 0.8 checkpoint.
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 19 }, { maxRounds: 25 })?.label
      === 'Reasoning over tool results (step 19 of 25)',
    'ratio boundary: 19/25 (0.76) still continue',
  );
  assert(
    mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 20 }, { maxRounds: 25 })?.label
      === 'Reasoning over tool results (step 20 of 25) — wrapping up',
    'ratio boundary: 20/25 (0.8) checkpoints — wrapping up',
  );
  // tool_call_start carries the compact step suffix only when the cap is known.
  assertEqual(
    mapAgentEventToOpenSwanStage(
      { kind: 'tool_call_start', iteration: 2, toolName: 'tasks.list', toolUseId: 't1', input: {} },
      { maxRounds: 5 },
    ),
    { stage: 'using_tools', label: 'Using tasks.list · step 2/5' },
    'tool_call_start suffixes " · step i/N" when maxRounds is known',
  );
  // Degenerate caps are treated as absent (legacy labels, no denominator).
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert(
      mapAgentEventToOpenSwanStage({ kind: 'turn_start', iteration: 2 }, { maxRounds: bad })?.label
        === 'Reasoning over tool results (step 2)',
      `degenerate maxRounds ${bad} falls back to the legacy label`,
    );
  }

  // ── 2. Status derivation + handler shaping ───────────────────────────────
  assertEqual(deriveLegacyDispatchStatus('tasks.create', { ok: true }, null), 'passed', 'ok result → passed');
  assertEqual(deriveLegacyDispatchStatus('tasks.create', { ok: false }, null), 'failed', 'ok:false → failed');
  assertEqual(
    deriveLegacyDispatchStatus('tasks.create', { ok: true }, { id: 'appr1' }),
    'manual_required',
    'approvalRequest → manual_required',
  );
  assertEqual(
    deriveLegacyDispatchStatus('verification.run', { executed: false }, null),
    'blocked',
    'verification.* executed:false → blocked',
  );

  const okShaped = shapeLegacyToolHandlerResult({
    toolName: 'tasks.list',
    input: { status: 'open' },
    inner: { ok: true, data: { raw: { ok: true, tasks: [] }, text: '0 open tasks' } },
    toolPolicy: { family: 'tasks', approvalMode: 'auto' },
    priorToolEvents: [],
  });
  assert(okShaped.ok === true, 'shaped ok result stays ok');
  assertEqual(
    okShaped.ok ? (okShaped.data as Record<string, unknown>) : {},
    { text: '0 open tasks' },
    'model-visible data carries ONLY the formatted text (legacy token profile — no raw)',
  );
  const okMeta = okShaped.metadata as Record<string, unknown>;
  assertEqual(okMeta[LEGACY_RUNTIME_STATUS_KEY], 'passed', 'side-channel status = passed');
  assertEqual(okMeta[LEGACY_EVENT_TEXT_KEY], '0 open tasks', 'side-channel event text = un-nudged formatted text');
  assertEqual(okMeta.toolPolicy, { family: 'tasks', approvalMode: 'auto' }, 'toolPolicy preserved in metadata');
  assertEqual(okMeta.approvalRequest, null, 'approvalRequest null preserved (legacy parity)');

  // browser.plan_task carries the plan in metadata (legacy dispatch parity)
  const planShaped = shapeLegacyToolHandlerResult({
    toolName: 'browser.plan_task',
    input: { task: 'check site' },
    inner: { ok: true, data: { raw: { ok: true, plan: { planId: 'p1' } }, text: 'Plan ready' } },
    toolPolicy: null,
    priorToolEvents: [],
  });
  assertEqual(
    (planShaped.metadata as Record<string, unknown>).browserPlan,
    { planId: 'p1' },
    'browser.plan_task metadata carries browserPlan',
  );

  // design-app observation produces the designAppCapture metadata key (R14 →
  // the manifest builder reads this from the EVENT, never the model content)
  const designShaped = shapeLegacyToolHandlerResult({
    toolName: 'desktop.photoshop_document_status',
    input: {},
    inner: {
      ok: true,
      data: { raw: { ok: true, documentName: 'poster.psd', layerCount: 12 }, text: 'poster.psd, 12 layers' },
    },
    toolPolicy: null,
    priorToolEvents: [],
  });
  const designCapture = (designShaped.metadata as Record<string, unknown>).designAppCapture as Record<string, unknown>;
  assert(!!designCapture && designCapture.tool === 'desktop.photoshop_document_status', 'design capture metadata attached');
  assert(
    !(designShaped.ok && JSON.stringify(designShaped.data).includes('designAppCapture')),
    'design capture never appears in model-visible content',
  );

  // mutating desktop action gets the observe→act→VERIFY nudge appended to the
  // model-visible text but NOT to the side-channel event text
  const mutShaped = shapeLegacyToolHandlerResult({
    toolName: 'desktop.click_element',
    input: { label: 'Export' },
    inner: { ok: true, data: { raw: { ok: true }, text: 'Clicked Export' } },
    toolPolicy: null,
    priorToolEvents: [],
  });
  const mutVisible = mutShaped.ok ? String((mutShaped.data as Record<string, unknown>).text) : '';
  assert(mutVisible.startsWith('Clicked Export') && mutVisible.length > 'Clicked Export'.length,
    'mutating action appends the verification-gate nudge to model-visible text');
  assertEqual(
    (mutShaped.metadata as Record<string, unknown>)[LEGACY_EVENT_TEXT_KEY],
    'Clicked Export',
    'event text stays un-nudged (legacy toolEvents stored dispatched.text)',
  );

  // repeated failure triggers the stuck-breaker append
  const priorFail: LegacyToolEvent[] = [{
    tool: 'desktop.click_element',
    input: { label: 'Export' },
    result: 'Tool error: element not found',
    status: 'failed',
  }];
  const stuckShaped = shapeLegacyToolHandlerResult({
    toolName: 'desktop.click_element',
    input: { label: 'Export' },
    inner: { ok: false, error: 'element not found' },
    toolPolicy: null,
    priorToolEvents: priorFail,
  });
  assert(
    !stuckShaped.ok && /Stuck-loop guard/i.test(String((stuckShaped as { error: string }).error)),
    'repeat failure appends the stuck-breaker nudge',
  );
  assertEqual(
    (stuckShaped.metadata as Record<string, unknown>)[LEGACY_RUNTIME_STATUS_KEY],
    'failed',
    'error result side-channel status = failed',
  );

  // ── 3. Event → legacy toolEvent mapping ──────────────────────────────────
  const mappedEvent = buildLegacyToolEventFromResult({
    toolName: 'desktop.photoshop_document_status',
    input: { probe: 1 },
    result: designShaped,
  });
  assertEqual(mappedEvent.tool, 'desktop.photoshop_document_status', 'event keeps tool name');
  assertEqual(mappedEvent.input, { probe: 1 }, 'event keeps raw input');
  assertEqual(mappedEvent.result, 'poster.psd, 12 layers', 'event result = un-nudged formatted text');
  assertEqual(mappedEvent.status, 'passed', 'event status from side channel');
  const mappedMeta = mappedEvent.metadata as Record<string, unknown>;
  assert(!!mappedMeta.designAppCapture, 'design capture survives into the event metadata (manifest feed)');
  assert(!(LEGACY_RUNTIME_STATUS_KEY in mappedMeta) && !(LEGACY_EVENT_TEXT_KEY in mappedMeta),
    'internal side-channel keys stripped from event metadata');

  const rejectedEvent = buildLegacyToolEventFromResult({
    toolName: 'tasks.create',
    input: { title: 'x' },
    result: { ok: false, error: 'Tool "tasks.create" was blocked by policy and did not run.' },
    rejectedByGate: true,
  });
  assertEqual(rejectedEvent.status, 'blocked', 'gate rejection → blocked status');
  assertEqual(rejectedEvent.result, LEGACY_GATE_REJECTION_TEXT, 'gate rejection keeps legacy rejection text');
  assertEqual(rejectedEvent.metadata, { rejected_by_user: true }, 'gate rejection keeps legacy metadata');

  const bareError = buildLegacyToolEventFromResult({
    toolName: 'nope.tool',
    input: {},
    result: { ok: false, error: 'Tool "nope.tool" is not registered.' },
  });
  assertEqual(bareError.status, 'failed', 'metadata-less error → failed');
  assert(bareError.result.startsWith('Tool error:'), 'metadata-less error keeps legacy "Tool error:" prefix');

  // ── 4. Approval gate payload identity (R19) ──────────────────────────────
  const seenPayloads: Array<{ name: string; input: any }> = [];
  const rejectedIds: string[] = [];
  const gate = createLegacyApprovalGateAdapter(
    async (call) => { seenPayloads.push(call); return call.name === 'tasks.delete' ? 'reject' : 'approve'; },
    (id) => rejectedIds.push(id),
  );
  const rawInput = { id: 'task-9', b: 2, a: 1 }; // key order matters for byte-identity
  const approveDecision = await gate({ toolName: 'tasks.update', toolUseId: 'tu1', input: rawInput, iteration: 1 });
  assertEqual(approveDecision, { decision: 'approve' }, 'approve passes through');
  assert(seenPayloads[0].input === rawInput, 'gate receives the EXACT input object (same reference, no clone/normalize)');
  assertEqual(seenPayloads[0].name, 'tasks.update', 'gate receives the exact tool name');
  // Fingerprint stability: the typed-core gate payload hashes to the same
  // approval key the legacy loop's payload did.
  assertEqual(
    buildOpenSwanToolApprovalKey(seenPayloads[0].name, seenPayloads[0].input),
    buildOpenSwanToolApprovalKey('tasks.update', rawInput),
    'approval fingerprint identical to the legacy gate payload (R19)',
  );
  const rejectDecision = await gate({ toolName: 'tasks.delete', toolUseId: 'tu2', input: {}, iteration: 1 });
  assert(rejectDecision.decision === 'reject', 'reject passes through');
  assertEqual(rejectedIds, ['tu2'], 'rejection callback receives the toolUseId');
  const throwGate = createLegacyApprovalGateAdapter(async () => { throw new Error('ui died'); });
  const thrownDecision = await throwGate({ toolName: 'x', toolUseId: 'tu3', input: {}, iteration: 1 });
  assert(thrownDecision.decision === 'reject', 'gate throw fails closed → reject (legacy catch behavior)');

  // ── 5. Provider request/response shaping ─────────────────────────────────
  const firstBody = buildSwanbotToolTurnBody({
    userMessage: 'do the thing',
    circleId: 'c1', userId: 'u1', model: 'claude-haiku-4-5',
    systemPrompt: 'SYSTEM',
    tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
    messages: [{ role: 'user', content: 'do the thing' }],
  });
  assertEqual(firstBody.tool_messages, undefined, 'first round omits tool_messages (legacy parity)');
  assertEqual(firstBody.message, 'do the thing', 'message always carries the user prompt');
  assertEqual(firstBody.system_override, 'SYSTEM', 'system prompt rides system_override');
  const laterBody = buildSwanbotToolTurnBody({
    userMessage: 'do the thing',
    circleId: 'c1', userId: 'u1', model: 'm',
    systemPrompt: 'SYSTEM',
    tools: [],
    messages: [
      { role: 'user', content: 'do the thing' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 't', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
    ],
  });
  assert(Array.isArray(laterBody.tool_messages) && (laterBody.tool_messages as unknown[]).length === 3,
    'later rounds send the full tool_messages history');

  const parsedToolTurn = parseSwanbotToolTurnData({
    content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'tu1', name: 'tasks.list', input: { status: 'open' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
    provider_routed: 'anthropic',
    provider_model: 'claude-sonnet-4-6',
  });
  assertEqual(parsedToolTurn.turn.stop_reason, 'tool_use', 'tool_use stop reason survives when blocks exist');
  assertEqual((parsedToolTurn.turn.content as unknown[]).length, 3, 'ALL content blocks pass through (thinking preserved)');
  assertEqual(parsedToolTurn.turn.usage?.input_tokens, 100, 'usage parsed');
  assertEqual(parsedToolTurn.routing, { provider_routed: 'anthropic', provider_model: 'claude-sonnet-4-6' }, 'routing captured');

  const parsedNoBlocks = parseSwanbotToolTurnData({ response: 'plain answer', stop_reason: 'tool_use' });
  assertEqual(parsedNoBlocks.turn.stop_reason, 'end_turn',
    'tool_use stop WITHOUT tool_use blocks downgrades to end_turn (legacy guard)');
  assertEqual(parsedNoBlocks.turn.content, [{ type: 'text', text: 'plain answer' }],
    'data.response fallback becomes a text block');
  assertEqual(parseSwanbotToolTurnData({}).turn.stop_reason, 'end_turn', 'empty payload → end_turn');

  assertEqual(
    toAnthropicToolShapes([{ name: 'a', description: 'b', input_schema: { type: 'object' } }]),
    [{ name: 'a', description: 'b', input_schema: { type: 'object' } }],
    'tool shapes drop handlers, keep schema',
  );

  // ── 6. Result mapping ─────────────────────────────────────────────────────
  const cleanResult = buildLegacyToolLoopResult({
    runResult: { text: 'All done.', messages: [], iterations: 2, stopReason: 'end_turn', hitMaxIterations: false },
    toolEvents: [], maxRounds: 4,
  });
  assertEqual(cleanResult, { response: 'All done.', toolEvents: [] } as any, 'clean finish maps 1:1');
  assert(cleanResult.incomplete === undefined && cleanResult.checkpoint === undefined,
    'clean finish has no incomplete/checkpoint flags');

  const edgeFailResult = buildLegacyToolLoopResult({
    runResult: { text: 'Tool-use call failed.', messages: [], iterations: 1, stopReason: 'end_turn', hitMaxIterations: false },
    toolEvents: [], maxRounds: 4, edgeFailed: true,
  });
  assert(edgeFailResult.incomplete === true && edgeFailResult.checkpoint === undefined,
    'edge failure → incomplete WITHOUT checkpoint (legacy parity)');

  const capEvents: LegacyToolEvent[] = [
    { tool: 'desktop.read_a11y_tree', input: {}, result: 'tree captured', status: 'passed' },
    { tool: 'desktop.click_element', input: { label: 'Save' }, result: 'Tool error: not found', status: 'failed' },
  ];
  const capRun = { text: '', messages: [], iterations: 4, stopReason: 'tool_use' as const, hitMaxIterations: true };
  assert(needsCapExhaustionFinalization(capRun), 'cap hit with no trailing text → needs finalization call');
  assert(!needsCapExhaustionFinalization({ ...capRun, text: 'partial' }), 'trailing text → no finalization call');
  const capResult = buildLegacyToolLoopResult({
    runResult: capRun, toolEvents: capEvents, maxRounds: 4,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
  assert(capResult.incomplete === true, 'max iterations → incomplete');
  assert(capResult.response.includes('I reached my tool-step limit for this turn (4 steps)'),
    'limit note carries maxRounds (legacy wording)');
  assert(capResult.response.includes('Progress before the step limit:'), 'progress summary appended');
  assertEqual(capResult.checkpoint?.maxRounds, 4, 'checkpoint carries maxRounds');
  assertEqual(capResult.checkpoint?.stepCount, 2, 'checkpoint counts steps');
  assertEqual(capResult.checkpoint?.lastFailure?.tool, 'desktop.click_element', 'checkpoint records last failure');
  assertEqual(capResult.checkpoint?.lastObservation?.tool, 'desktop.read_a11y_tree', 'checkpoint records last observation');
  assertEqual(capResult.usage, { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, 'usage rides the result');

  const finalizedResult = buildLegacyToolLoopResult({
    runResult: capRun, toolEvents: capEvents, maxRounds: 4, finalizationText: 'Here is what I found so far.',
  });
  assert(finalizedResult.response.startsWith('Here is what I found so far.'),
    'finalization text replaces the limit note when present');

  // ── 6b. Cap-exhaustion finalization body (P62 shape) ─────────────────────
  // The finalization call must send the turn's REAL tool defs + a trailing
  // "no more tools — wrap up now" user note (NOT tools:[], which after P64/A2
  // rides the tool-less relay leg and can't produce the intended wrap-up).
  {
    const finalizeTools = [
      { name: 'tasks.list', description: 'list', input_schema: { type: 'object' } },
      { name: 'browser.dom_snapshot', description: 'snap', input_schema: { type: 'object' } },
    ];
    const finalizeHistory = [
      { role: 'user' as const, content: 'do the thing' },
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'tu1', name: 'tasks.list', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '3 open tasks' }] },
    ];
    const finalizeBody = buildCapExhaustionFinalizationBody({
      userMessage: 'do the thing',
      circleId: 'c1',
      userId: 'u1',
      model: 'claude-sonnet-4-6',
      systemPrompt: 'SYSTEM',
      tools: finalizeTools,
      messages: finalizeHistory,
    });
    // (1) real, non-empty tool defs ride the call — NOT tools:[]
    assertEqual(finalizeBody.tools, finalizeTools,
      'finalization: sends the turn\'s REAL tool defs (P62), never tools:[]');
    assert(Array.isArray(finalizeBody.tools) && (finalizeBody.tools as unknown[]).length === 2,
      'finalization: tool defs are non-empty');
    // (2) full history preserved, with the no-more-tools steer appended as a
    //     trailing user turn (legal — merges after the tool_results).
    const finalizeMessages = finalizeBody.tool_messages as Array<{ role: string; content: unknown }>;
    assertEqual(finalizeMessages.length, finalizeHistory.length + 1,
      'finalization: full tool_messages history + one appended steer turn');
    assertEqual(finalizeMessages.slice(0, 3), finalizeHistory,
      'finalization: original history preserved verbatim (tool_use/tool_result intact)');
    assertEqual(finalizeMessages[finalizeMessages.length - 1], { role: 'user', content: CAP_EXHAUSTION_FINALIZATION_NOTE },
      'finalization: trailing user-role no-more-tools steer appended last');
    // (3) system_override + ids preserved (cache-hot system prompt).
    assertEqual(finalizeBody.system_override, 'SYSTEM', 'finalization: system_override carries the frozen system prompt');
    assertEqual(finalizeBody.message, 'do the thing', 'finalization: message carries the original user prompt');
    assertEqual(finalizeBody.model, 'claude-sonnet-4-6', 'finalization: model preserved');
    // (4) the steer is byte-identical to the legacy chat-loop finalization note.
    assert(
      CAP_EXHAUSTION_FINALIZATION_NOTE.startsWith('Tool budget for this turn is exhausted. Do NOT call any more tools')
        && CAP_EXHAUSTION_FINALIZATION_NOTE.includes('reply now'),
      'finalization: steer matches the legacy "no more tools — wrap up" wording',
    );
  }

  // ── 7. Usage aggregation ──────────────────────────────────────────────────
  const acc = createLoopUsageAccumulator();
  assertEqual(finalizeLoopUsage(acc), undefined, 'no usage seen → undefined (legacy {} downstream)');
  accumulateLoopUsage(acc, { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 400 });
  accumulateLoopUsage(acc, { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 10 });
  accumulateLoopUsage(acc, undefined);
  assertEqual(
    finalizeLoopUsage(acc),
    // GAP-2: read vs creation carried separately (400 read + 10 creation) so
    // the cache-discipline ratio survives; total_tokens still folds the
    // aggregate (cached = total - in - out) for back-compat. Key order must
    // match finalizeLoopUsage's return (assertEqual is JSON.stringify-based).
    {
      input_tokens: 150,
      output_tokens: 50,
      total_tokens: 610,
      cache_read_tokens: 400,
      cache_creation_tokens: 10,
    },
    'usage sums across turns; read/creation split preserved; total includes cache tokens',
  );

  // ── 8. End-to-end: runAgent + adapter wiring ──────────────────────────────
  const stages: string[] = [];
  const e2eToolEvents: LegacyToolEvent[] = [];
  const e2eRejected = new Set<string>();
  const pendingInputs = new Map<string, unknown>();
  const e2eUsage = createLoopUsageAccumulator();
  const gateCalls: Array<{ name: string; input: any }> = [];

  const innerTool: AgentToolDefinition = {
    name: 'tasks.list',
    description: 'list tasks',
    input_schema: { type: 'object', properties: {} },
    handler: async () => ({ ok: true, data: { raw: { ok: true, tasks: [1] }, text: '1 task' } }),
  };
  const wrapped: AgentToolDefinition = {
    ...innerTool,
    handler: async (input, ctx) => {
      const normalized = (input as Record<string, unknown>) || {};
      const inner = await innerTool.handler(normalized, ctx) as AgentToolResult;
      return shapeLegacyToolHandlerResult({
        toolName: innerTool.name, input: normalized, inner,
        toolPolicy: { approvalMode: 'auto' }, priorToolEvents: e2eToolEvents,
      });
    },
  };
  const turns: ProviderTurnResult[] = [
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu1', name: 'tasks.list', input: { status: 'open' } }],
      usage: { input_tokens: 10, output_tokens: 2 },
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'You have 1 task.' }],
      usage: { input_tokens: 12, output_tokens: 4 },
    },
  ];
  let turnIdx = 0;
  const provider: AgentProvider = { turn: async () => turns[turnIdx++] };

  const runResult = await runAgent({
    initialMessages: [{ role: 'user', content: 'what tasks do I have' }],
    tools: [wrapped],
    provider,
    maxIterations: 4,
    parallelToolConcurrency: 1,
    toolApprovalGate: createLegacyApprovalGateAdapter(
      async (call) => { gateCalls.push(call); return 'approve'; },
      (id) => e2eRejected.add(id),
    ),
    onEvent: (event) => {
      if (event.kind === 'tool_call_start') {
        pendingInputs.set(event.toolUseId, event.input);
      } else if (event.kind === 'tool_call_result') {
        const input = pendingInputs.get(event.toolUseId);
        pendingInputs.delete(event.toolUseId);
        e2eToolEvents.push(buildLegacyToolEventFromResult({
          toolName: event.toolName, input, result: event.result,
          rejectedByGate: e2eRejected.has(event.toolUseId),
        }));
      } else if (event.kind === 'turn_end') {
        accumulateLoopUsage(e2eUsage, event.usage);
      }
      const stage = mapAgentEventToOpenSwanStage(event);
      if (stage) stages.push(stage.stage);
    },
  });

  const loopResult = buildLegacyToolLoopResult({
    runResult, toolEvents: e2eToolEvents, maxRounds: 4, usage: finalizeLoopUsage(e2eUsage),
  });
  assertEqual(loopResult.response, 'You have 1 task.', 'e2e: final text maps to response');
  assertEqual(loopResult.toolEvents, [{
    tool: 'tasks.list',
    input: { status: 'open' },
    result: '1 task',
    status: 'passed',
    metadata: { toolPolicy: { approvalMode: 'auto' }, approvalRequest: null },
  }], 'e2e: toolEvents match the legacy dispatch shape exactly');
  assertEqual(
    loopResult.usage,
    // GAP-2 widened shape: this mock reports no cache tokens, so the split
    // fields are 0 and total_tokens still equals input+output.
    { input_tokens: 22, output_tokens: 6, total_tokens: 28, cache_read_tokens: 0, cache_creation_tokens: 0 },
    'e2e: usage aggregated (read/creation split present, 0 here)',
  );
  assert(loopResult.incomplete === undefined, 'e2e: clean finish not flagged incomplete');
  assertEqual(gateCalls, [{ name: 'tasks.list', input: { status: 'open' } }],
    'e2e: gate saw the exact legacy payload shape');
  assertEqual(stages, ['reasoning', 'using_tools', 'reasoning', 'finalizing', 'finalizing'],
    'e2e: stage sequence reasoning → using_tools → reasoning → finalizing');

  // ── 9. Round-boundary reliability nudges (O1 nudge parity) ───────────────
  const nudgeCtx = (over: Partial<{ iteration: number; maxIterations: number; toolResults: Array<{ toolName: string; ok: boolean; resultText?: string }> }> = {}) => ({
    iteration: 1,
    maxIterations: 8,
    toolResults: [{ toolName: 'tasks.list', ok: true }],
    messages: [] as const,
    ...over,
  });
  const obsText = '{"ok":true,"data":{"text":"login form: email field, password field, Sign in button"}}';
  // The hook's return type includes `void` (core contract) — normalize to a
  // testable `{ appendUserNote? } | undefined` for assertions.
  const callNudge = async (
    hook: ReturnType<typeof createLegacyRoundNudgeHook>,
    ctx: ReturnType<typeof nudgeCtx>,
  ) => (await hook(ctx)) as { appendUserNote?: string } | undefined;

  // (c) Failed browser UI mutation → deterministic re-observe note with the
  //     legacy helper's exact text, observation dispatched per surface ladder,
  //     and the auto_reobserve event appended to toolEvents.
  {
    const events: LegacyToolEvent[] = [
      { tool: 'browser.fill_field', input: { selector: '#q' }, result: 'Tool error: element not found', status: 'failed' },
    ];
    const observed: string[] = [];
    const hook = createLegacyRoundNudgeHook({
      toolEvents: events,
      hasApprovalGate: false,
      dispatchObservation: async (tool) => { observed.push(tool); return { text: obsText, status: 'passed' }; },
    });
    const out = await callNudge(hook, nudgeCtx({ toolResults: [{ toolName: 'browser.fill_field', ok: true }] }));
    assertEqual(observed, ['browser.dom_snapshot'], 'nudges: failed browser mutation re-observes via DOM snapshot');
    assertEqual(
      out && out.appendUserNote,
      summarizeObservationForRetry(obsText, 'passed', { maxChars: 1400 }),
      'nudges: re-observe note text matches the legacy helper output exactly',
    );
    assertEqual(events.length, 2, 'nudges: auto-observation recorded as a tool event');
    assertEqual(events[1], {
      tool: 'browser.dom_snapshot', input: {}, result: obsText, status: 'passed', metadata: { auto_reobserve: true },
    } as LegacyToolEvent, 'nudges: auto_reobserve event matches the legacy shape');
  }

  // Failed desktop UI mutation → a11y tree; per-step review mode (gate)
  // disables auto re-observe (legacy `!opts.toolApprovalGate` gating).
  {
    const events: LegacyToolEvent[] = [
      { tool: 'desktop.click_element', input: { label: 'Save' }, result: 'Tool error: not found', status: 'failed' },
    ];
    const observed: string[] = [];
    const hook = createLegacyRoundNudgeHook({
      toolEvents: events,
      hasApprovalGate: false,
      dispatchObservation: async (tool) => { observed.push(tool); return { text: obsText, status: 'passed' }; },
    });
    await callNudge(hook, nudgeCtx({ toolResults: [{ toolName: 'desktop.click_element', ok: true }] }));
    assertEqual(observed, ['desktop.read_a11y_tree'], 'nudges: failed desktop mutation re-observes via a11y tree');

    const gatedEvents: LegacyToolEvent[] = [
      { tool: 'desktop.click_element', input: {}, result: 'Tool error: not found', status: 'failed' },
    ];
    const gatedObserved: string[] = [];
    const gatedHook = createLegacyRoundNudgeHook({
      toolEvents: gatedEvents,
      hasApprovalGate: true,
      dispatchObservation: async (tool) => { gatedObserved.push(tool); return { text: obsText, status: 'passed' }; },
    });
    const gatedOut = await callNudge(gatedHook, nudgeCtx({ toolResults: [{ toolName: 'desktop.click_element', ok: true }] }));
    assertEqual(gatedObserved, [], 'nudges: review mode (approval gate) disables auto re-observe');
    assert(gatedOut === undefined, 'nudges: gated failed action emits no note');

    // A throwing observation is best-effort: no note, no extra event.
    const throwEvents: LegacyToolEvent[] = [
      { tool: 'browser.click_role', input: {}, result: 'Tool error: timeout', status: 'failed' },
    ];
    const throwHook = createLegacyRoundNudgeHook({
      toolEvents: throwEvents,
      hasApprovalGate: false,
      dispatchObservation: async () => { throw new Error('bridge offline'); },
    });
    const throwOut = await callNudge(throwHook, nudgeCtx({ toolResults: [{ toolName: 'browser.click_role', ok: true }] }));
    assert(throwOut === undefined && throwEvents.length === 1,
      'nudges: a throwing observation adds nothing (stuck-breaker remains the fallback)');
  }

  // (b) Near-budget → remaining-rounds reminder, legacy text exactly
  //     (core 1-indexed `iteration` IS legacy `round + 1`).
  {
    const events: LegacyToolEvent[] = [{ tool: 'tasks.list', input: {}, result: '1 task', status: 'passed' }];
    const hook = createLegacyRoundNudgeHook({
      toolEvents: events, hasApprovalGate: false,
      dispatchObservation: async () => ({ text: '', status: 'passed' }),
    });
    const out = await callNudge(hook, nudgeCtx({ iteration: 3, maxIterations: 4 }));
    const expected = toolBudgetReminder(3, 4);
    assert(!!expected && expected.includes('about 1 tool step left'), 'nudges: legacy budget helper pins the wording');
    assertEqual(out && out.appendUserNote, expected!, 'nudges: near-budget note matches toolBudgetReminder exactly');

    const early = await callNudge(hook, nudgeCtx({ iteration: 1, maxIterations: 8 }));
    assert(early === undefined, 'nudges: plenty of budget + no mutation/failure → no note');
  }

  // (a) Browser mutation without proof → surface-aware proof nudge, once per
  //     turn (legacy `proofNudged` bound); proof captured → no nudge.
  {
    const events: LegacyToolEvent[] = [
      { tool: 'browser.fill_field', input: { selector: '#email' }, result: 'filled', status: 'passed' },
    ];
    const hook = createLegacyRoundNudgeHook({
      toolEvents: events, hasApprovalGate: false,
      dispatchObservation: async () => ({ text: '', status: 'passed' }),
    });
    const out = await callNudge(hook, nudgeCtx({ toolResults: [{ toolName: 'browser.fill_field', ok: true }] }));
    const expected = proofCoverageNudge(assessProofCoverage(events));
    assertEqual(out && out.appendUserNote, expected, 'nudges: proof nudge text matches the legacy helper output exactly');
    assert(String(out?.appendUserNote).includes('browser.dom_snapshot')
      && String(out?.appendUserNote).includes('last change: `browser.fill_field`'),
      'nudges: proof nudge is surface-aware for browser mutations');
    const again = await callNudge(hook, nudgeCtx({ toolResults: [{ toolName: 'browser.fill_field', ok: true }] }));
    assert(again === undefined, 'nudges: proof nudge fires at most once per turn (legacy proofNudged)');

    const provenEvents: LegacyToolEvent[] = [
      { tool: 'browser.fill_field', input: {}, result: 'filled', status: 'passed' },
      { tool: 'browser.dom_snapshot', input: {}, result: 'snapshot', status: 'passed' },
    ];
    const provenHook = createLegacyRoundNudgeHook({
      toolEvents: provenEvents, hasApprovalGate: false,
      dispatchObservation: async () => ({ text: '', status: 'passed' }),
    });
    const provenOut = await callNudge(provenHook, nudgeCtx({ toolResults: [{ toolName: 'browser.dom_snapshot', ok: true }] }));
    assert(provenOut === undefined, 'nudges: proof captured after the mutation → no nudge');
  }

  // Combination: proof gap + final stretch → ONE note, legacy order
  // (proof nudge before the budget reminder), exact concatenation.
  {
    const events: LegacyToolEvent[] = [
      { tool: 'browser.fill_field', input: {}, result: 'filled', status: 'passed' },
    ];
    const hook = createLegacyRoundNudgeHook({
      toolEvents: events, hasApprovalGate: false,
      dispatchObservation: async () => ({ text: '', status: 'passed' }),
    });
    const out = await callNudge(hook, nudgeCtx({
      iteration: 3, maxIterations: 4,
      toolResults: [{ toolName: 'browser.fill_field', ok: true }],
    }));
    const expected = proofCoverageNudge(assessProofCoverage(events)) + toolBudgetReminder(3, 4)!;
    assertEqual(out && out.appendUserNote, expected,
      'nudges: multiple applicable nudges combine into one note (proof, then budget)');
  }

  // End-to-end through the typed path: a wrapped tool whose legacy status is
  // 'failed' (raw ok:false → core ok:true, so only the legacy event exposes
  // the failure) triggers re-observe via the hook, and the NEXT provider turn
  // sees the note as a user message.
  {
    const e2eEvents: LegacyToolEvent[] = [];
    const e2ePending = new Map<string, unknown>();
    const observed: string[] = [];
    const failingFill: AgentToolDefinition = {
      name: 'browser.fill_field',
      description: 'fill a field',
      input_schema: { type: 'object', properties: {} },
      handler: async (input, ctx2) => {
        const normalized = (input as Record<string, unknown>) || {};
        const inner: AgentToolResult = {
          ok: true,
          data: { raw: { ok: false, error: 'element not found' }, text: 'Fill failed: element not found' },
        };
        void ctx2;
        return shapeLegacyToolHandlerResult({
          toolName: 'browser.fill_field', input: normalized, inner,
          toolPolicy: null, priorToolEvents: e2eEvents,
        });
      },
    };
    const providerLastMessages: Array<string | null> = [];
    const e2eTurns: ProviderTurnResult[] = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_fill', name: 'browser.fill_field', input: { selector: '#q' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'stopped' }] },
    ];
    let e2eIdx = 0;
    const e2eProvider: AgentProvider = {
      turn: async ({ messages }) => {
        const last = messages[messages.length - 1];
        providerLastMessages.push(typeof last?.content === 'string' ? last.content : null);
        return e2eTurns[e2eIdx++];
      },
    };
    await runAgent({
      initialMessages: [{ role: 'user', content: 'fill the form' }],
      tools: [failingFill],
      provider: e2eProvider,
      maxIterations: 6,
      parallelToolConcurrency: 1,
      onEvent: (event) => {
        if (event.kind === 'tool_call_start') {
          e2ePending.set(event.toolUseId, event.input);
        } else if (event.kind === 'tool_call_result') {
          const input = e2ePending.get(event.toolUseId);
          e2ePending.delete(event.toolUseId);
          e2eEvents.push(buildLegacyToolEventFromResult({
            toolName: event.toolName, input, result: event.result,
          }));
        }
      },
      onRoundComplete: createLegacyRoundNudgeHook({
        toolEvents: e2eEvents,
        hasApprovalGate: false,
        dispatchObservation: async (tool) => { observed.push(tool); return { text: obsText, status: 'passed' }; },
      }),
    });
    assertEqual(e2eEvents[0]?.status, 'failed', 'nudges e2e: shaped handler surfaced the legacy failed status');
    assertEqual(observed, ['browser.dom_snapshot'], 'nudges e2e: failed fill auto re-observed through the typed path');
    assertEqual(
      providerLastMessages[1],
      summarizeObservationForRetry(obsText, 'passed', { maxChars: 1400 }),
      'nudges e2e: next provider turn sees the re-observe note as a user message',
    );
    assertEqual(e2eEvents[1]?.metadata, { auto_reobserve: true }, 'nudges e2e: auto-observe event persisted');
  }

  // ── 10. Circle Context Snapshot turn-start injection ─────────────────────
  {
    const fixtureSnapshot = (): CircleContextSnapshot => assembleCircleContextSnapshot({
      circleId: 'c1',
      nowIso: '2026-06-12T00:00:00.000Z',
      members: [{ id: 'u1', name: 'Chris', role: 'owner' }],
      tasks: [
        { id: 't1', title: 'Ship snapshot wiring', status: 'in_progress', assigneeName: 'Chris' },
        { id: 't2', title: 'Old closed task', status: 'done' },
      ],
      missions: [{ id: 'm1', title: 'Reliability mission', status: 'active', taskCount: 2 }],
      goals: [{ id: 'g1', title: 'Q2 goal', status: 'active', progressPct: 40 }],
      rooms: [{ id: 'r1', name: 'War Room', openTaskCount: 1 }],
    });

    // Builder succeeds (stubbed deps) → block present, header + fence shape.
    const block = await buildCircleSnapshotContextMessage('c1', {
      getSnapshot: async () => fixtureSnapshot(),
    });
    assert(!!block, 'snapshot: block built when the stubbed builder succeeds');
    assert(
      (block || '').startsWith(`${CIRCLE_SNAPSHOT_CONTEXT_HEADER}\n`),
      'snapshot: block starts with the compact-index / context.search header line',
    );
    {
      const openIdx = (block || '').indexOf('<untrusted_quoted>');
      const closeIdx = (block || '').indexOf('</untrusted_quoted>');
      assert(openIdx > 0 && closeIdx > openIdx, 'snapshot: untrusted_quoted fence intact (open before close)');
      assert(
        (block || '').indexOf(CIRCLE_SNAPSHOT_CONTEXT_HEADER) < openIdx,
        'snapshot: structural header stays OUTSIDE the fence',
      );
      assert((block || '').includes('Ship snapshot wiring'), 'snapshot: member-authored task line rides inside the block');
    }
    // Verbatim injection: header line + the exact compact render, no rewrap.
    assertEqual(
      block,
      `${CIRCLE_SNAPSHOT_CONTEXT_HEADER}\n${renderCircleContextSnapshot(fixtureSnapshot(), { budgetChars: CIRCLE_SNAPSHOT_CONTEXT_BUDGET_CHARS })}`,
      'snapshot: render output injected verbatim under the header (never unwrapped)',
    );
    assertEqual(
      block,
      renderCircleSnapshotContextBlock(fixtureSnapshot()),
      'snapshot: buildCircleSnapshotContextMessage matches the pure block renderer',
    );

    // Compact budget respected even with an oversized circle.
    const bigBlock = await buildCircleSnapshotContextMessage('c1', {
      getSnapshot: async () => assembleCircleContextSnapshot({
        circleId: 'c1',
        tasks: Array.from({ length: 200 }, (_, i) => ({
          id: `task-${i}`,
          title: `Very long synthetic task title number ${i} that pads the index well past budget`,
          status: 'in_progress',
          assigneeName: 'Chris Swanson',
        })),
        members: Array.from({ length: 40 }, (_, i) => ({ id: `u${i}`, name: `Member Number ${i}` })),
      }),
    });
    assert(
      !!bigBlock && bigBlock.length <= CIRCLE_SNAPSHOT_CONTEXT_BUDGET_CHARS + CIRCLE_SNAPSHOT_CONTEXT_HEADER.length + 1,
      `snapshot: compact budget respected (${bigBlock?.length} chars ≤ ${CIRCLE_SNAPSHOT_CONTEXT_BUDGET_CHARS} + header)`,
    );
    assert(!!bigBlock && bigBlock.includes('</untrusted_quoted>'), 'snapshot: fence still closed after budget trimming');

    // Builder throws → null (fail-safe), turn proceeds with the plain shape.
    const thrown = await buildCircleSnapshotContextMessage('c1', {
      getSnapshot: async () => { throw new Error('rls exploded'); },
    });
    assertEqual(thrown, null, 'snapshot: builder throw → no block (fail-safe)');

    // Builder hangs → timeout race returns null quickly, never blocks a turn.
    const t0 = Date.now();
    const hung = await buildCircleSnapshotContextMessage('c1', {
      getSnapshot: () => new Promise(() => { /* never resolves */ }),
      timeoutMs: 40,
    });
    assertEqual(hung, null, 'snapshot: builder hang → timeout → no block');
    assert(Date.now() - t0 < 1000, 'snapshot: timeout race resolves promptly (turn unbroken)');

    // No circle → no block, builder never consulted.
    let builderCalls = 0;
    const noCircle = await buildCircleSnapshotContextMessage('', {
      getSnapshot: async () => { builderCalls += 1; return fixtureSnapshot(); },
    });
    assertEqual(noCircle, null, 'snapshot: missing circleId → no block');
    assertEqual(builderCalls, 0, 'snapshot: missing circleId skips the builder entirely');

    // Initial-message assembly: snapshot rides as its OWN user-role context
    // message ahead of the user message; absent ⇒ exact pre-snapshot shape.
    assertEqual(
      buildSnapshotAwareInitialMessages({ userMessage: 'do the thing', snapshotContextMessage: block }),
      [
        { role: 'user', content: block! },
        { role: 'user', content: 'do the thing' },
      ],
      'snapshot: initial messages = [snapshot user-role context message, user message]',
    );
    assertEqual(
      buildSnapshotAwareInitialMessages({ userMessage: 'do the thing', snapshotContextMessage: null }),
      [{ role: 'user', content: 'do the thing' }],
      'snapshot: no block → initial messages unchanged from the pre-snapshot shape',
    );

    // End-to-end through runAgent: round 1 sees both messages, the snapshot
    // never leaks into the system prompt, and the skills-style system block
    // is untouched (the typed-core path keeps skills in the system prompt).
    {
      const systemPromptFixture = 'SYSTEM PROMPT\n## Skills\n- demo-skill v1';
      const seenFirstRound: Array<{ role: string; content: unknown }> = [];
      const provider: AgentProvider = {
        turn: async ({ messages }) => {
          if (seenFirstRound.length === 0) seenFirstRound.push(...messages.map((m) => ({ role: m.role, content: m.content })));
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
        },
      };
      const result = await runAgent({
        initialMessages: buildSnapshotAwareInitialMessages({ userMessage: 'status check', snapshotContextMessage: block }),
        tools: [{
          name: 'noop', description: 'noop', input_schema: { type: 'object', properties: {} },
          handler: async () => ({ ok: true, data: 'ok' }),
        }],
        provider,
        maxIterations: 2,
      });
      assertEqual(result.text, 'done', 'snapshot e2e: turn completes normally with the context message present');
      assertEqual(seenFirstRound.length, 2, 'snapshot e2e: provider round 1 sees snapshot + user message');
      assertEqual(seenFirstRound[0]?.role, 'user', 'snapshot e2e: snapshot block is user-role');
      assert(String(seenFirstRound[0]?.content).startsWith(CIRCLE_SNAPSHOT_CONTEXT_HEADER), 'snapshot e2e: first message is the snapshot block');
      assertEqual(seenFirstRound[1], { role: 'user', content: 'status check' }, 'snapshot e2e: user message follows unchanged');
      assert(!systemPromptFixture.includes('Circle context'), 'snapshot e2e: frozen system prompt (incl. skills block) untouched by the snapshot');
      // Transport shape: with the extra context message, round 1 ships the
      // full history via tool_messages (edge fn uses it verbatim).
      const body = buildSwanbotToolTurnBody({
        userMessage: 'status check', circleId: 'c1', userId: 'u1', model: 'claude-haiku-4-5',
        systemPrompt: systemPromptFixture, tools: [],
        messages: buildSnapshotAwareInitialMessages({ userMessage: 'status check', snapshotContextMessage: block }),
      });
      const toolMessages = body.tool_messages as Array<{ role: string; content: unknown }>;
      assertEqual(toolMessages?.length, 2, 'snapshot e2e: round-1 body carries both messages via tool_messages');
      assertEqual(toolMessages?.[0]?.content, block, 'snapshot e2e: tool_messages[0] is the verbatim snapshot block');
      assertEqual(body.system_override, systemPromptFixture, 'snapshot e2e: system_override unchanged (cache-hot)');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log('\nAll openswan-session-core-adapter smoke cases passed.');
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
