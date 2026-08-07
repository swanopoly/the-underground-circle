/**
 * Adversarial regression smoke for SwanBot v2 terminal truthfulness.
 *
 * Executes the actual pure decision cores extracted from the edge/client
 * sources, then pins their wiring. This catches the two dangerous regressions:
 * an unverified local mutation followed by model end_turn becoming completed,
 * and a user cancellation being mistaken for transport failure and replayed
 * through v1.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  buildSwanBotClientToolPersistenceEntries,
  type SwanBotClientToolReceiptMetadata,
} from '../supabase/functions/_shared/swanbot-continuation.ts';

const edgePath = 'supabase/functions/swanbot-v2-ai/index.ts';
const clientPath = 'src/lib/swanbot.ts';
const edgeSource = readFileSync(edgePath, 'utf8');
const clientSource = readFileSync(clientPath, 'utf8');

let assertions = 0;
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  assertions += 1;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

function loadMarkedCore(
  source: string,
  startMarker: string,
  endMarker: string,
  exportNames: string[],
): Record<string, (...args: any[]) => any> {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(start >= 0 && end > start, `found executable core ${startMarker}`);
  const block = source.slice(start + startMarker.length, end);
  const assignment = `\n(globalThis as any).__ucExports = { ${exportNames.join(', ')} };\n`;
  const transpiled = ts.transpileModule(block + assignment, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  });
  const realm: Record<string, unknown> = {};
  Function('globalThis', transpiled.outputText)(realm);
  const exports = realm.__ucExports;
  check(Boolean(exports && typeof exports === 'object'), `loaded executable core ${startMarker}`);
  return exports as Record<string, (...args: any[]) => any>;
}

const edgeCore = loadMarkedCore(
  edgeSource,
  '// TERMINAL_INTEGRITY_CORE_START',
  '// TERMINAL_INTEGRITY_CORE_END',
  [
    'classifySwanBotClientMutationTerminalIntegrity',
    'classifySwanBotTerminalStatus',
    'classifySwanBotFreshTerminalPersistence',
    'classifySwanBotContinuationTerminalPersistence',
    'projectSwanBotImmutableTurnIdentityMetadata',
  ],
);
const classifyMutation = edgeCore.classifySwanBotClientMutationTerminalIntegrity;
const classifyTerminal = edgeCore.classifySwanBotTerminalStatus;
const classifyFreshPersistence = edgeCore.classifySwanBotFreshTerminalPersistence;
const classifyContinuationPersistence =
  edgeCore.classifySwanBotContinuationTerminalPersistence;
const projectImmutableTurnIdentity =
  edgeCore.projectSwanBotImmutableTurnIdentityMetadata;

const AUTHORIZED_AT = '2026-07-27T12:00:00.000Z';
const DISPATCHED_AT = '2026-07-27T12:00:01.000Z';
const CHECKED_AT = '2026-07-27T12:00:02.000Z';

function receiptMetadata(
  tool: string,
  verification?: 'verified' | 'inconclusive',
): SwanBotClientToolReceiptMetadata {
  const slug = tool.replace(/[^a-z0-9_.:-]/gi, '-');
  const actionId = `action:${slug}`;
  const epochId = `before:${slug}`;
  return {
    mutationDispatchReceipt: {
      schemaVersion: 1,
      actionId,
      tool,
      epochId,
      authorizedAt: AUTHORIZED_AT,
      dispatchedAt: DISPATCHED_AT,
    },
    ...(verification
      ? {
          computerAppVerificationReceipt: {
            schemaVersion: 1,
            actionId,
            beforeEpochId: epochId,
            afterEpochId: verification === 'verified' ? `after:${slug}` : null,
            status: verification,
            checkedAt: CHECKED_AT,
            canComplete: verification === 'verified',
            evidenceCount: verification === 'verified' ? 1 : 0,
            blockerCount: verification === 'verified' ? 0 : 1,
          },
        }
      : {}),
  };
}

function livePersistedToolCalls(input: {
  id: string;
  tool: string;
  isError: boolean;
  receipt?: SwanBotClientToolReceiptMetadata;
}): unknown[] {
  const persisted = buildSwanBotClientToolPersistenceEntries({
    pendingTools: [{ id: input.id, name: input.tool }],
    results: [{
      tool_use_id: input.id,
      content: input.isError ? '{"ok":false}' : '{"ok":true}',
      ...(input.isError ? { is_error: true } : {}),
      ...(input.receipt ? { receipt_metadata: input.receipt } : {}),
    }],
    iteration: 2,
  });
  check(persisted.ok, `live persistence builder accepted ${input.tool}`);
  return persisted.ok ? persisted.entries.map((entry) => entry.toolCall) : [];
}

const genericNativeOutcomeUnknown = livePersistedToolCalls({
  id: 'tool-native-unknown',
  tool: 'desktop.type_text',
  isError: true,
  receipt: receiptMetadata('desktop.type_text'),
});
const unknownIntegrity = classifyMutation(genericNativeOutcomeUnknown);
equal(unknownIntegrity, {
  status: 'outcome_unknown',
  reason: 'client_mutation_unverified',
  replayAllowed: false,
}, 'dispatched generic native failure is stable outcome_unknown and no-replay');
equal(classifyTerminal({
  cancelled: false,
  finalStopReason: 'end_turn',
  clientMutationIntegrity: unknownIntegrity,
}), 'failed', 'model end_turn cannot complete an outcome-unknown native mutation');

const incompleteVerification = classifyMutation(livePersistedToolCalls({
  id: 'tool-inconclusive',
  tool: 'desktop.open_path',
  isError: false,
  receipt: receiptMetadata('desktop.open_path', 'inconclusive'),
}));
equal(incompleteVerification.status, 'outcome_unknown', 'completionVerified:false remains non-completable');

const verifiedIntegrity = classifyMutation(livePersistedToolCalls({
  id: 'tool-verified',
  tool: 'desktop.open_path',
  isError: false,
  receipt: receiptMetadata('desktop.open_path', 'verified'),
}));
equal(verifiedIntegrity, { status: 'clear', replayAllowed: true }, 'verified client mutation may complete');
equal(classifyTerminal({
  cancelled: false,
  finalStopReason: 'end_turn',
  clientMutationIntegrity: verifiedIntegrity,
}), 'completed', 'verified mutation plus end_turn remains completed');

const harmlessReadFailure = classifyMutation(livePersistedToolCalls({
  id: 'tool-read-failure',
  tool: 'desktop.screenshot',
  isError: true,
}));
equal(harmlessReadFailure, { status: 'clear', replayAllowed: true }, 'read-only failure is not side-effect ambiguity');
equal(classifyTerminal({
  cancelled: false,
  finalStopReason: 'end_turn',
  clientMutationIntegrity: harmlessReadFailure,
}), 'completed', 'harmless read failure does not falsely become outcome_unknown');

const wordpressFailure = classifyMutation(livePersistedToolCalls({
  id: 'tool-wp-failure',
  tool: 'wp.update_post',
  isError: true,
  receipt: receiptMetadata('wp.update_post'),
}));
equal(wordpressFailure.status, 'outcome_unknown', 'live WP mutation failure is replay-blocked');

const workspaceUnverified = classifyMutation(livePersistedToolCalls({
  id: 'tool-workspace-unverified',
  tool: 'workspace.open_preview',
  isError: false,
  receipt: receiptMetadata('workspace.open_preview'),
}));
equal(workspaceUnverified.status, 'outcome_unknown', 'unverified workspace mutation cannot complete');

const wordpressPredispatchBlock = classifyMutation(livePersistedToolCalls({
  id: 'tool-wp-predispatch',
  tool: 'wp.update_post',
  isError: true,
}));
equal(
  wordpressPredispatchBlock,
  { status: 'clear', replayAllowed: true },
  'WP approval/validation block before dispatch remains a no-mutation failure',
);

equal(classifyFreshPersistence({
  writeConfirmed: false,
  rereadStatus: 'cancelled',
  expectedStatus: 'completed',
}), 'late_cancelled', 'late cancellation wins a missed fresh terminal CAS');
equal(classifyFreshPersistence({
  writeConfirmed: false,
  rereadStatus: 'running',
  expectedStatus: 'completed',
}), 'outcome_unknown', 'unconfirmed fresh terminal write fails closed');
equal(classifyFreshPersistence({
  writeConfirmed: false,
  rereadStatus: 'failed',
  expectedStatus: 'failed',
  rereadMatchesExpectedTerminal: true,
}), 'confirmed', 'exact terminal reread resolves a lost write acknowledgement');
equal(classifyContinuationPersistence({
  writeConfirmed: false,
  rereadStatus: 'cancelled',
}), 'late_cancelled', 'resumed terminal CAS recognizes a durable cancellation winner');
equal(classifyContinuationPersistence({
  writeConfirmed: false,
  rereadStatus: 'running',
}), 'outcome_unknown', 'other resumed claim ambiguity remains outcome_unknown');

const TURN_A = '11111111-1111-4111-8111-111111111111';
const TURN_B = '22222222-2222-4222-8222-222222222222';
equal(projectImmutableTurnIdentity(TURN_A), {
  turnRequestId: TURN_A,
  turnRequestIdentityVersion: 1,
}, 'fresh terminal metadata keeps the request identity');
equal(projectImmutableTurnIdentity(TURN_B, {
  turnRequestId: TURN_A,
  turnRequestIdentityVersion: 1,
}), {
  turnRequestId: TURN_A,
  turnRequestIdentityVersion: 1,
}, 'durable request identity cannot be rotated by a later writer');

const clientCore = loadMarkedCore(
  clientSource,
  '// SWANBOT_V2_CLIENT_TERMINAL_CORE_START',
  '// SWANBOT_V2_CLIENT_TERMINAL_CORE_END',
  [
    'projectSwanBotV2TransportFailure',
    'projectSwanBotV2TerminalResponse',
    'classifySwanBotV2CallDisposition',
    'shouldFallbackSwanBotV2ToV1',
  ],
);
const projectTransportFailure = clientCore.projectSwanBotV2TransportFailure;
const projectTerminal = clientCore.projectSwanBotV2TerminalResponse;
const classifyDisposition = clientCore.classifySwanBotV2CallDisposition;
const shouldFallback = clientCore.shouldFallbackSwanBotV2ToV1;

const emptyCancellation = projectTerminal({ cancelled: true, text: '' });
check(emptyCancellation.cancelled === true, 'empty cancellation propagates cancelled:true');
check(typeof emptyCancellation.text === 'string' && emptyCancellation.text.length > 20, 'empty cancellation gets neutral non-empty terminal copy');
equal(classifyDisposition(emptyCancellation), 'cancelled', 'empty cancellation is a neutral terminal disposition');
equal(shouldFallback(emptyCancellation), false, 'empty cancellation never falls back to v1');

const emptyReachedTerminal = projectTerminal({ text: '' });
equal(emptyReachedTerminal.reachedEdgeTerminal, true, 'empty authenticated edge terminal retains reached-edge authority');
equal(
  classifyDisposition(emptyReachedTerminal),
  'terminal_without_payload',
  'empty reached-edge terminal is distinct from transport failure',
);
equal(shouldFallback(emptyReachedTerminal), false, 'empty reached-edge terminal never falls back to v1');

const nonemptyCancellation = projectTerminal({
  cancelled: true,
  text: 'Partial model tail that must not look complete',
});
equal(nonemptyCancellation.cancelled, true, 'nonempty cancellation propagates cancelled:true');
equal(nonemptyCancellation.text, emptyCancellation.text, 'partial model tail is replaced by neutral cancellation copy');
equal(shouldFallback(nonemptyCancellation), false, 'nonempty cancellation never falls back to v1');

const preDispatchTransportFailure = projectTransportFailure({
  mutationCapablePostAttempted: false,
});
equal(preDispatchTransportFailure, {
  text: null,
  v1FallbackSafeBeforeDispatch: true,
}, 'pre-dispatch transport failure carries explicit safe fallback authority');
equal(
  classifyDisposition(preDispatchTransportFailure),
  'transport_failure',
  'pre-dispatch transport failure still contributes to breaker health',
);
equal(shouldFallback(preDispatchTransportFailure), true, 'proved pre-dispatch failure may use v1 fallback');

// Adversarial case: the edge committed a server-side mutation and every HTTP
// response (including transport retries) was lost. The client can observe only
// a null response, so the attempted mutation-capable POST must be treated as
// outcome-unknown and must never replay the turn through v1.
const lostAllResponsesAfterServerWrite = projectTransportFailure({
  mutationCapablePostAttempted: true,
});
equal(lostAllResponsesAfterServerWrite, {
  text: null,
  mutationCapablePostOutcomeUnknown: true,
}, 'lost response after a mutation-capable edge POST is outcome-unknown');
equal(
  classifyDisposition(lostAllResponsesAfterServerWrite),
  'transport_failure',
  'ambiguous post-response loss still contributes to breaker health',
);
equal(
  shouldFallback(lostAllResponsesAfterServerWrite),
  false,
  'lost all responses after a possible server write cannot replay through v1',
);
equal(
  shouldFallback({ text: null }),
  false,
  'unmarked null transport results cannot implicitly authorize v1 replay',
);
equal(shouldFallback({
  text: 'generic continuation stop copy',
  bodyError: { code: 'client_mutation_outcome_unknown', message: 'blocked' },
}), false, 'structured mutation terminal never falls back to v1');
equal(classifyDisposition({
  text: 'generic continuation stop copy',
  bodyError: { code: 'client_mutation_outcome_unknown', message: 'blocked' },
}), 'body_error', 'structured mutation terminal is not mislabeled success by stop copy');

check(
  edgeSource.includes('clientMutationOutcomeUnknown?: true')
    && edgeSource.includes('batchMutationIntegrity.status === "outcome_unknown"')
    && edgeSource.includes('resumeFrom?.clientMutationOutcomeUnknown === true'),
  'outcome-unknown mutation latch survives continuation rounds and capped tool ledgers',
);
check(
  edgeSource.includes('clientMutationTerminalOutcome: terminalMutationIntegrity')
    && edgeSource.includes('"client_mutation_outcome_unknown"')
    && edgeSource.includes('status: expectedTerminalStatus'),
  'edge persists the no-replay terminal outcome and returns a structured stop',
);
check(
  clientSource.includes("const DIRECT_CLIENT_MUTATION_TOOL_NAMES = new Set([")
    && clientSource.includes("'workspace.apply_artifacts'")
    && clientSource.includes("'wp.update_post'")
    && clientSource.includes('claimDirectClientMutationDispatch(markDispatched)'),
  'WP/workspace live dispatchers establish receipts at their exact mutation boundary',
);
check(
  edgeSource.includes('...projectSwanBotImmutableTurnIdentityMetadata(')
    && edgeSource.includes('existing.turnRequestIdentityVersion === 1'),
  'fresh pending/terminal/failure metadata retains immutable lost-response identity',
);
check(
  edgeSource.includes('if (terminalPersisted?.error || !terminalPersisted?.data)')
    && edgeSource.includes('freshDecision === "late_cancelled"')
    && edgeSource.includes('continuationDecision === "late_cancelled"')
    && edgeSource.includes('await finalizeCancelledRun()')
    && edgeSource.includes('"terminal_transition_outcome_unknown"'),
  'fresh terminal CAS is inspected and late cancellation cannot publish completion',
);
check(
  edgeSource.includes('if (!cancelled) {')
    && edgeSource.includes('activityType: feedActivityStatus === "failed" ? "task_failed" : "message_out"')
    && edgeSource.includes('cancelled: true'),
  'cancelled terminals suppress Feed publication while mutation ambiguity publishes failure only',
);
const cancelledBranch = clientSource.indexOf("if (disposition === 'cancelled')");
const fallbackLog = clientSource.indexOf("falling back to v1.", cancelledBranch);
check(
  clientSource.includes('...projectSwanBotV2TerminalResponse(response, bodyError)')
    && clientSource.includes('const mayFallbackToV1 = shouldFallbackSwanBotV2ToV1(v2)')
    && cancelledBranch >= 0
    && fallbackLog > cancelledBranch,
  'client propagates cancellation and returns before the only v1 fallback branch',
);
const initialV2PostLatch = clientSource.indexOf('mutationCapableV2PostAttempted = true;');
const initialV2Invoke = clientSource.indexOf('let response = await invokeSwanbotV2(', initialV2PostLatch);
const initialLostResponseProjection = clientSource.indexOf(
  'return projectSwanBotV2TransportFailure({',
  initialV2Invoke,
);
check(
  initialV2PostLatch >= 0
    && initialV2Invoke > initialV2PostLatch
    && initialLostResponseProjection > initialV2Invoke
    && clientSource.includes("'v2_transport_outcome_unknown'")
    && clientSource.includes('v1FallbackSafeBeforeDispatch === true'),
  'initial mutation-capable POST is latched before dispatch and total response loss is surfaced without v1 replay',
);

console.log(`swanbot-v2-terminal-integrity smoke passed (${assertions} assertions)`);
