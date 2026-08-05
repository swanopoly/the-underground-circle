import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canConsumeSwanBotContinuationDispatchClaim,
  decideSwanBotContinuationDispatchClaim,
  parseSwanBotContinuationDispatchClaim,
  SWANBOT_CONTINUATION_PROTOCOL_VERSION,
  SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS,
  SWANBOT_MAX_CLIENT_TOOL_RESULTS,
  validateSwanBotResumeToolResults,
} from '../supabase/functions/_shared/swanbot-continuation';

function ok<T>(value: { ok: true; results: T } | { ok: false; error: string }): T {
  assert.equal(value.ok, true, 'expected validation success');
  return (value as { ok: true; results: T }).results;
}

function fail(
  value: { ok: true; results: unknown } | { ok: false; error: string },
  pattern: RegExp,
  label: string,
): void {
  assert.equal(value.ok, false, `${label}: expected validation failure`);
  assert.match((value as { ok: false; error: string }).error, pattern, label);
}

const valid = ok(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_b', content: { ok: true, data: { beta: 2 } }, is_error: true },
  { tool_use_id: 'tool_a', content: '{"ok":true}' },
], ['tool_a', 'tool_b']));

assert.deepEqual(valid.map(result => result.tool_use_id), ['tool_a', 'tool_b'], 'results preserve pending tool order');
assert.equal(valid[0].content, '{"ok":true}', 'string content preserved');
assert.equal(valid[1].content, JSON.stringify({ ok: true, data: { beta: 2 } }), 'object content normalized to JSON');
assert.equal(valid[1].is_error, true, 'is_error preserved');

const alias = ok(validateSwanBotResumeToolResults([
  { id: 'tool_a', content: 'alias-id' },
], ['tool_a']));
assert.equal(alias[0].tool_use_id, 'tool_a', 'id alias accepted for client compatibility');

fail(validateSwanBotResumeToolResults(null, ['tool_a']), /array/, 'non-array toolResults rejected');
fail(validateSwanBotResumeToolResults([], []), /no pending tool ids/, 'empty pending ids rejected');
fail(validateSwanBotResumeToolResults([], ['tool_a']), /missing tool_result id/, 'missing result rejected');
fail(validateSwanBotResumeToolResults([{ tool_use_id: 'tool_x', content: '' }], ['tool_a']), /unexpected tool_result id: tool_x/, 'extra result rejected');
fail(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_a', content: 'one' },
  { tool_use_id: 'tool_a', content: 'two' },
], ['tool_a']), /duplicate tool_result id: tool_a/, 'duplicate result rejected');
fail(validateSwanBotResumeToolResults([{ content: 'missing id' }], ['tool_a']), /include tool_use_id/, 'blank result id rejected');
fail(validateSwanBotResumeToolResults([], ['tool_a', 'tool_a']), /duplicate pending tool ids/, 'duplicate pending id rejected');

const tooManyPending = Array.from({ length: SWANBOT_MAX_CLIENT_TOOL_RESULTS + 1 }, (_, i) => `tool_${i}`);
fail(validateSwanBotResumeToolResults([], tooManyPending), /too many pending client tool calls/, 'too many pending tools rejected');

const tooManyResults = Array.from({ length: SWANBOT_MAX_CLIENT_TOOL_RESULTS + 1 }, (_, i) => ({
  tool_use_id: `tool_${i}`,
  content: 'x',
}));
fail(validateSwanBotResumeToolResults(tooManyResults, ['tool_0']), /too many toolResults/, 'too many result rows rejected');

// Oversized client tool results are now SUMMARIZED (head + tail + error-signal
// lines), not hard-truncated — parity with the client loop's
// toolResultSummaryCore (LOCKSTEP: supabase/functions/_shared/tool-result-summary.ts).
// The summary keeps the tail, stays under the legacy char cap, and carries the
// summarization marker instead of the old truncation marker.
const longText = `A${'x'.repeat(SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS * 2)}TAIL`;
const capped = ok(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_a', content: longText },
], ['tool_a']));
assert(capped[0].content.length <= SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS, 'summarized result stays under the char budget');
assert.match(capped[0].content, /tool result summarized/, 'oversized result carries the summarization marker');
assert(capped[0].content.includes('TAIL'), 'summarization preserves the payload tail (unlike the old hard truncation)');

const circular: Record<string, unknown> = {};
circular.self = circular;
const circularResult = ok(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_a', content: circular },
], ['tool_a']));
assert.equal(circularResult[0].content, '[object Object]', 'circular non-string content falls back safely');

// Two-phase exact ownership: one client claim wins before dispatch, an exact
// retry is idempotent, a competitor cannot reach dispatch, and consumed
// results can never enter the model loop twice.
const continuationIdentity = '11111111-1111-4111-8111-111111111111';
const continuationNonce = '22222222-2222-4222-8222-222222222222';
const dispatchClaimId = '33333333-3333-4333-8333-333333333333';
const competingDispatchClaimId = '44444444-4444-4444-8444-444444444444';
const parsedClaim = parseSwanBotContinuationDispatchClaim({
  continuationIdentity,
  continuationVersion: SWANBOT_CONTINUATION_PROTOCOL_VERSION,
  continuationNonce,
  dispatchClaimId,
});
assert.equal(parsedClaim.ok, true, 'bounded exact dispatch claim parses');
if (!parsedClaim.ok) throw new Error(parsedClaim.error);
const pendingSnapshot = {
  continuationIdentity,
  continuationVersion: SWANBOT_CONTINUATION_PROTOCOL_VERSION,
  continuationNonce,
  resumeState: 'pending',
};
assert.deepEqual(
  decideSwanBotContinuationDispatchClaim(pendingSnapshot, parsedClaim.claim),
  { ok: true, kind: 'claim' },
  'first exact client may claim pending dispatch',
);
const dispatchClaimedSnapshot = {
  ...pendingSnapshot,
  resumeState: 'dispatch_claimed',
  dispatchClaimId,
};
assert.deepEqual(
  decideSwanBotContinuationDispatchClaim(dispatchClaimedSnapshot, parsedClaim.claim),
  { ok: true, kind: 'acknowledge' },
  'same exact dispatch claim retry acknowledges idempotently',
);
const competingClaim = parseSwanBotContinuationDispatchClaim({
  continuationIdentity,
  continuationVersion: SWANBOT_CONTINUATION_PROTOCOL_VERSION,
  continuationNonce,
  dispatchClaimId: competingDispatchClaimId,
});
assert.equal(competingClaim.ok, true);
if (!competingClaim.ok) throw new Error(competingClaim.error);
assert.equal(
  decideSwanBotContinuationDispatchClaim(
    dispatchClaimedSnapshot,
    competingClaim.claim,
  ).ok,
  false,
  'competing client cannot acquire an already-owned dispatch',
);
assert.deepEqual(
  canConsumeSwanBotContinuationDispatchClaim(
    dispatchClaimedSnapshot,
    parsedClaim.claim,
  ),
  { ok: true },
  'only the winning exact dispatch claim may submit results',
);
assert.equal(
  canConsumeSwanBotContinuationDispatchClaim({
    ...dispatchClaimedSnapshot,
    resumeState: 'results_claimed',
  }, parsedClaim.claim).ok,
  false,
  'results-claimed state cannot enter model resume a second time',
);
assert.equal(
  parseSwanBotContinuationDispatchClaim({
    continuationIdentity,
    continuationVersion: 1,
    continuationNonce,
    dispatchClaimId,
  }).ok,
  false,
  'legacy continuation protocol versions fail closed',
);

const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');
const clientSource = readFileSync('src/lib/swanbot.ts', 'utf8');
assert(
  edgeSource.includes('SWANBOT_MAX_CLIENT_TOOL_RESULTS'),
  'edge imports the pending client tool cap',
);
assert(
  edgeSource.includes('serverToolResults?: SwanBotResumeToolResult[]'),
  'continuation snapshot can carry server-side results for mixed batches',
);
assert(
  edgeSource.includes('pendingToolUseIds: clientUses.map'),
  'pending continuation stores only client-side tool ids',
);
assert(
  edgeSource.includes('const clientToolCalls = clientUses.map'),
  'pending response returns only client-side tool calls',
);
assert(
  !edgeSource.includes('const clientToolCalls = uses.map'),
  'edge does not hand the full mixed tool batch to the client',
);
assert(
  edgeSource.includes('mergeContinuationToolResults(cont, validatedResults.results)'),
  'resume merges persisted server tool results with client tool results',
);
assert(
  edgeSource.includes('Cannot pause for client-side tools because the run was not persisted.'),
  'edge fails closed before pending when no run id exists',
);
assert(
  edgeSource.includes('Too many client-side tool calls'),
  'edge caps pending client-side calls before dispatching to the client',
);
assert(
  edgeSource.includes('continuationAction === "claim_dispatch"')
    && edgeSource.includes('continuationAction === "submit_results"')
    && edgeSource.includes('"invalid_continuation_protocol"'),
  'edge requires the two explicit phases and rejects legacy mixed requests',
);
assert(
  edgeSource.includes('SWANBOT_CONTINUATION_MAX_AGE_MS') && edgeSource.includes('continuation_stale'),
  'resume rejects stale continuations before replaying tool results',
);
assert(
  edgeSource.includes('const continuationResumeIdentity = createPendingContinuationResumeIdentity()')
    && edgeSource.includes('resumeState: "pending"'),
  'every pending round receives a fresh identity/version/nonce state',
);
for (const exactCasField of [
  'continuationIdentity',
  'continuationVersion',
  'continuationNonce',
  'resumeState',
]) {
  assert(
    edgeSource.includes(`metadata->continuation->>${exactCasField}`),
    `resume compare-and-set binds ${exactCasField}`,
  );
}
assert(
  edgeSource.includes('final_stop_reason: SWANBOT_CONTINUATION_DISPATCHING_REASON')
    && edgeSource.includes('resumeState: "dispatch_claimed"')
    && edgeSource.includes('applyPendingContinuationFilters(claimQuery, dispatchClaim)'),
  'pre-dispatch claim atomically consumes pending/client_pending before local effects',
);
assert(
  edgeSource.includes('resumeState: "results_claimed"')
    && edgeSource.includes('applyDispatchClaimedContinuationFilters(claimQuery, dispatchClaim)')
    && edgeSource.includes('final_stop_reason: SWANBOT_CONTINUATION_RESUMING_REASON'),
  'result submission atomically rotates the exact dispatch claim before model resume',
);
assert(
  edgeSource.includes('applyClaimedContinuationFilters(pendingUpdate, continuationClaim)')
    && edgeSource.includes('applyClaimedContinuationFilters(terminalUpdate, continuationClaim)'),
  'only the exact claim owner can publish the next pending round or terminal result',
);
assert(
  edgeSource.includes('reason: "dispatch_lease_expired"')
    && edgeSource.includes('reason: "resume_lease_expired"')
    && edgeSource.includes('status: "outcome_unknown"')
    && edgeSource.includes('replayAllowed: false'),
  'expired dispatch/results claims seal outcome-unknown instead of reopening for replay',
);
assert(
  !edgeSource.includes('retry the SAME continuationRunId'),
  'claimed continuation failures no longer advertise unsafe same-id replay',
);
const claimInvokeIndex = clientSource.indexOf("continuationAction: 'claim_dispatch'");
const executeClientToolsIndex = clientSource.indexOf(
  'const toolResults = await executeClientToolCalls(',
  claimInvokeIndex,
);
const resultSubmitIndex = clientSource.indexOf(
  "continuationAction: 'submit_results'",
  executeClientToolsIndex,
);
assert(
  claimInvokeIndex >= 0
    && executeClientToolsIndex > claimInvokeIndex
    && resultSubmitIndex > executeClientToolsIndex,
  'client confirms dispatch claim before executing tools and submits results afterward',
);
assert(
  clientSource.includes('isExactSwanBotV2DispatchClaimConfirmation(')
    && clientSource.includes('no client tools were run')
    && clientSource.includes('attemptedClientTools = true;'),
  'client executes zero local tools unless the exact claim acknowledgement matches',
);
assert(
  clientSource.includes('continuationProtocolVersion: SWANBOT_V2_CONTINUATION_PROTOCOL_VERSION')
    && edgeSource.includes('clientContinuationProtocolVersion !== SWANBOT_CONTINUATION_PROTOCOL_VERSION')
    && edgeSource.includes('Update the app and start a fresh run; no local tools were run.'),
  'mixed old/new clients fail closed before the edge exposes executable client work',
);
assert(
  edgeSource.includes('sealSwanBotContinuationSnapshot')
    && edgeSource.includes('openSwanBotContinuationSnapshot')
    && edgeSource.includes('StoredRunContinuationEnvelope'),
  'exact continuation transcripts are sealed before durable storage and authenticated on resume',
);
assert(
  edgeSource.includes('SWANBOT_CONTINUATION_ENCRYPTION_SECRET')
    && edgeSource.includes('SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION')
    && !edgeSource.includes(
      'SWANBOT_CONTINUATION_ENCRYPTION_SECRET") || getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY',
    ),
  'continuation encryption uses a dedicated rotation-versioned deployment secret',
);
const storedEnvelopeStart = edgeSource.indexOf('type StoredRunContinuationEnvelope');
const storedEnvelopeEnd = edgeSource.indexOf('function cleanSubjectString', storedEnvelopeStart);
const storedEnvelopeSource = edgeSource.slice(storedEnvelopeStart, storedEnvelopeEnd);
assert(storedEnvelopeStart >= 0 && storedEnvelopeEnd > storedEnvelopeStart);
assert(
  storedEnvelopeSource.includes('encrypted: true')
    && storedEnvelopeSource.includes('pendingTools: SwanBotPendingClientTool[]')
    && storedEnvelopeSource.includes('expiresAt: string')
    && storedEnvelopeSource.includes('snapshot: SwanBotContinuationCryptoEnvelopeV1'),
  'circle-visible continuation metadata carries only a bounded encrypted checkpoint envelope',
);
assert(
  edgeSource.includes('continuation: storedContinuation')
    && edgeSource.includes('continuation: storedDispatchClaimedContinuation')
    && edgeSource.includes('continuation: storedClaimedContinuation')
    && !edgeSource.includes('continuation: sanitizeContinuationForStorage('),
  'every pending/claim transition writes the encrypted envelope rather than the raw transcript',
);
assert(
  edgeSource.includes('input: summarizeToolInputForPersistence(use.name, use.input)')
    && !edgeSource.includes('input: use.input'),
  'public server and client-pending events store value-free input summaries',
);
assert(
  !edgeSource.includes('error: result.ok ? undefined : result.error')
    && !edgeSource.includes('{ error: result.error }')
    && edgeSource.includes('error: result.ok ? undefined : PERSISTED_TOOL_FAILURE_TEXT'),
  'public run events and tool-call aggregates never store raw server-tool errors',
);
assert(
  edgeSource.includes('closeUnreadableContinuation')
    && edgeSource.includes('reason: "encrypted_checkpoint_unreadable"')
    && edgeSource.includes('replayAllowed: false'),
  'tampered, legacy, or unreadable checkpoints are closed without replay',
);
assert(
  edgeSource.includes('clientContinuationEncryptionAvailable !== true')
    && edgeSource.includes('activeTools.filter((tool) => tool.clientOnly !== true)'),
  'fresh turns with no encryption key withhold all client-only tools before model dispatch',
);
assert(
  edgeSource.includes('errorRedacted: true')
    && edgeSource.includes('error_code: publicFailureCode')
    && !edgeSource.includes('metadata: { error: msg'),
  'outer edge failures persist stable redacted codes instead of provider exception text',
);
for (const mutationTool of [
  'save_memory',
  'tasks.create',
  'tasks.update_status',
  'tasks.assign',
  'missions.create_task',
  'messages.create',
  'rooms.create',
  'rooms.send_message',
  'approvals.request',
]) {
  assert(
    edgeSource.includes(`  "${mutationTool}",`),
    `server-side mutation replay boundary includes ${mutationTool}`,
  );
}
const mutationLatchIndex = edgeSource.indexOf(
  'if (SERVER_SIDE_MUTATION_TOOL_NAMES.has(def.name))',
);
const handlerDispatchIndex = edgeSource.indexOf(
  'result = await def.handler(use.input, ctx);',
  mutationLatchIndex,
);
assert(
  mutationLatchIndex >= 0
    && edgeSource.indexOf('onServerMutationDispatch?.();', mutationLatchIndex)
      < handlerDispatchIndex,
  'server-side mutation ambiguity latches before handler entry',
);
assert(
  edgeSource.includes('const retryableTransient = transient && !serverMutationDispatched;')
    && edgeSource.includes('"server_mutation_outcome_unknown"')
    && edgeSource.includes('replayAllowed: false')
    && edgeSource.includes('verifyBeforeNewAction: true'),
  'a provider failure after a server-side write is non-retryable outcome-unknown',
);
const mutationResponseIndex = edgeSource.indexOf('if (serverMutationDispatched) {');
const transientResponseIndex = edgeSource.indexOf(
  'if (retryableTransient) {',
  mutationResponseIndex,
);
assert(
  mutationResponseIndex >= 0
    && transientResponseIndex > mutationResponseIndex,
  'post-mutation ambiguity returns before the retryable 503 branch',
);
assert(
  clientSource.includes('const httpBodyError = await readSwanBotInvokeErrorBody(error);')
    && clientSource.includes('if (httpBodyError) onBodyError?.(httpBodyError);'),
  'client recovers stable non-2xx edge error bodies instead of treating them as transport failure',
);
const bodyErrorStopIndex = clientSource.indexOf('if (v2.bodyError) {');
const v1FallbackIndex = clientSource.indexOf(
  "console.log('[SwanBot] v2 returned null (transport) — falling back to v1.');",
  bodyErrorStopIndex,
);
assert(
  bodyErrorStopIndex >= 0
    && clientSource.indexOf(
      'return { response: null, error: v2.bodyError };',
      bodyErrorStopIndex,
    ) < v1FallbackIndex,
  'a deliberate v2 edge stop returns before the v1 fallback path',
);
const freshTurnIdentityIndex = clientSource.indexOf(
  'const turnRequestId = createSwanBotV2DispatchClaimId();',
);
const firstV2InvokeIndex = clientSource.indexOf(
  'let response = await invokeSwanbotV2(accessToken, {',
  freshTurnIdentityIndex,
);
assert(
  freshTurnIdentityIndex >= 0
    && firstV2InvokeIndex > freshTurnIdentityIndex
    && clientSource.indexOf('turnRequestId,', firstV2InvokeIndex)
      > firstV2InvokeIndex,
  'client creates one cryptographic turn identity before the retry-wrapped initial invoke',
);
assert(
  edgeSource.includes('...(turnRequestId ? { id: turnRequestId } : {})')
    && edgeSource.includes('const { data: run, error: runInsertError }')
    && edgeSource.includes('if (runInsertError || !run) runInsertFailed = true;')
    && edgeSource.includes('"duplicate_turn_outcome_unknown"')
    && edgeSource.includes('existingMetadata.turnRequestId === turnRequestId'),
  'edge handles resolved query errors, binds the request identity to the run primary key, and stops duplicates',
);
assert(
  edgeSource.includes('serverMutationAuthorityAvailable !== true')
    && edgeSource.includes('!SERVER_SIDE_MUTATION_TOOL_NAMES.has(tool.name)')
    && edgeSource.includes('"turn_identity_required"'),
  'server writers are withheld without a valid durable retry identity',
);

console.log('swanbot-v2-continuation smoke passed');
