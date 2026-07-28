import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSwanBotClientToolPersistenceEntries,
  mergeSwanBotDurableToolCalls,
  projectSwanBotResumeToolResultsForModel,
  sanitizeSwanBotClientToolReceiptMetadata,
  SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS,
  SWANBOT_MAX_DURABLE_TOOL_CALLS,
  validateSwanBotResumeToolResults,
  type SwanBotClientToolReceiptMetadata,
} from '../supabase/functions/_shared/swanbot-continuation';
import { serializeSwanBotClientToolResult } from '../src/lib/swanbotClientToolDispatcher';

let assertions = 0;
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  assertions += 1;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

const validReceipt = {
  mutationDispatchReceipt: {
    schemaVersion: 1,
    actionId: 'action-toggle-1',
    tool: 'browser.set_toggle',
    epochId: 'epoch-before-1',
    authorizedAt: '2026-07-25T14:00:00.000Z',
    dispatchedAt: '2026-07-25T14:00:01.000Z',
    contractBinding: 'must-not-persist',
    policyBinding: 'must-not-persist',
    raw: { selector: '#private-control' },
  },
  computerAppVerificationReceipt: {
    schemaVersion: 1,
    actionId: 'action-toggle-1',
    beforeEpochId: 'epoch-before-1',
    afterEpochId: 'epoch-after-1',
    status: 'verified',
    checkedAt: '2026-07-25T14:00:02.000Z',
    canComplete: true,
    evidenceCount: 2,
    blockerCount: 0,
    predicate: 'must-not-persist',
    evidenceIds: ['private-proof-id'],
    blockers: [],
  },
  arbitraryNamespace: {
    authorization: `Bearer ${'a'.repeat(40)}`,
    localPath: '/Users/private/account.txt',
  },
};

const sanitized = sanitizeSwanBotClientToolReceiptMetadata(
  validReceipt,
  'browser.set_toggle',
);
check(sanitized, 'valid exact receipt metadata survives');
equal(sanitized, {
  mutationDispatchReceipt: {
    schemaVersion: 1,
    actionId: 'action-toggle-1',
    tool: 'browser.set_toggle',
    epochId: 'epoch-before-1',
    authorizedAt: '2026-07-25T14:00:00.000Z',
    dispatchedAt: '2026-07-25T14:00:01.000Z',
  },
  computerAppVerificationReceipt: {
    schemaVersion: 1,
    actionId: 'action-toggle-1',
    beforeEpochId: 'epoch-before-1',
    afterEpochId: 'epoch-after-1',
    status: 'verified',
    checkedAt: '2026-07-25T14:00:02.000Z',
    canComplete: true,
    evidenceCount: 2,
    blockerCount: 0,
  },
}, 'only allowlisted primitive receipt fields survive');

const serializedSanitized = JSON.stringify(sanitized);
check(!serializedSanitized.includes('contractBinding'), 'contract binding is stripped');
check(!serializedSanitized.includes('policyBinding'), 'policy binding is stripped');
check(!serializedSanitized.includes('#private-control'), 'raw selector is stripped');
check(!serializedSanitized.includes('/Users/'), 'private paths are stripped');
check(!serializedSanitized.includes('Bearer '), 'arbitrary secret metadata is stripped');
check(
  serializedSanitized.length < 2_000,
  'the complete durable receipt projection has a small total bound',
);

equal(
  sanitizeSwanBotClientToolReceiptMetadata(validReceipt, 'browser.fill_field'),
  undefined,
  'receipt tool must match the exact pending client call',
);
equal(
  sanitizeSwanBotClientToolReceiptMetadata({
    ...validReceipt,
    mutationDispatchReceipt: {
      ...validReceipt.mutationDispatchReceipt,
      actionId: `sk-ant-${'A'.repeat(32)}`,
    },
  }, 'browser.set_toggle'),
  undefined,
  'secret-shaped allowlisted identifiers reject the complete receipt',
);
equal(
  sanitizeSwanBotClientToolReceiptMetadata({
    ...validReceipt,
    mutationDispatchReceipt: {
      ...validReceipt.mutationDispatchReceipt,
      actionId: 'x'.repeat(SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS + 1),
    },
  }, 'browser.set_toggle'),
  undefined,
  'oversized exact identifiers are rejected instead of truncated',
);

const mismatchedVerification = sanitizeSwanBotClientToolReceiptMetadata({
  ...validReceipt,
  computerAppVerificationReceipt: {
    ...validReceipt.computerAppVerificationReceipt,
    actionId: 'different-action',
  },
}, 'browser.set_toggle');
check(mismatchedVerification?.mutationDispatchReceipt, 'valid dispatch proof remains when verification is malformed');
check(!mismatchedVerification?.computerAppVerificationReceipt, 'verification with a different action id is stripped');

const contradictoryVerification = sanitizeSwanBotClientToolReceiptMetadata({
  ...validReceipt,
  computerAppVerificationReceipt: {
    ...validReceipt.computerAppVerificationReceipt,
    status: 'verified',
    canComplete: false,
  },
}, 'browser.set_toggle');
check(!contradictoryVerification?.computerAppVerificationReceipt, 'contradictory completion proof is stripped');

const hostileReceipt: Record<string, unknown> = {};
Object.defineProperty(hostileReceipt, 'mutationDispatchReceipt', {
  enumerable: true,
  get() {
    throw new Error('hostile getter');
  },
});
assert.doesNotThrow(() => sanitizeSwanBotClientToolReceiptMetadata(hostileReceipt));
assertions += 1;

const validated = validateSwanBotResumeToolResults([
  {
    tool_use_id: 'tool-b',
    content: { ok: false, error: 'visible model feedback' },
    is_error: true,
  },
  {
    tool_use_id: 'tool-a',
    content: '{"ok":true}',
    receipt_metadata: {
      ...validReceipt,
      injected: { token: `sk-${'B'.repeat(32)}` },
    },
    metadata: { raw: 'unknown top-level metadata must not survive' },
  },
], ['tool-a', 'tool-b'], [
  { id: 'tool-a', name: 'browser.set_toggle' },
  { id: 'tool-b', name: 'desktop.screenshot' },
]);
check(validated.ok, 'new and old client result shapes validate together');
if (!validated.ok) throw new Error(validated.error);
equal(
  validated.results.map((result) => result.tool_use_id),
  ['tool-a', 'tool-b'],
  'validated results are correlated in exact pending order',
);
check(validated.results[0].receipt_metadata, 'valid receipt side channel is retained');
check(!validated.results[1].receipt_metadata, 'old-client result remains valid without receipt metadata');
check(
  !JSON.stringify(validated.results).includes('unknown top-level metadata'),
  'arbitrary top-level result metadata is dropped',
);

const modelProjection = projectSwanBotResumeToolResultsForModel(validated.results);
check(
  !JSON.stringify(modelProjection).includes('receipt_metadata'),
  'receipt metadata never enters the model tool_result projection',
);
check(
  JSON.stringify(modelProjection).includes('visible model feedback'),
  'model-visible tool content is preserved independently',
);
const clientVisibleContent = serializeSwanBotClientToolResult({
  ok: true,
  data: { completionVerified: true },
  receipt_metadata: validReceipt,
} as never);
check(
  !clientVisibleContent.includes('receipt_metadata') &&
    !clientVisibleContent.includes('mutationDispatchReceipt'),
  'client result serialization also excludes the durable receipt side channel',
);

const persisted = buildSwanBotClientToolPersistenceEntries({
  pendingTools: [
    { id: 'tool-a', name: 'browser.set_toggle' },
    { id: 'tool-b', name: 'desktop.screenshot' },
  ],
  results: [...validated.results].reverse(),
  iteration: 3,
});
check(persisted.ok, 'exact pending/result batch builds durable entries');
if (!persisted.ok) throw new Error(persisted.error);
equal(
  persisted.entries.map((entry) => entry.toolUseId),
  ['tool-a', 'tool-b'],
  'durable entries follow pending order even when client result order differs',
);
equal(persisted.entries[0].eventPayload.tool, 'browser.set_toggle', 'event uses authoritative saved tool name');
equal(persisted.entries[0].eventPayload.dispatched, true, 'trusted dispatch receipt records handler-entry truth');
equal(persisted.entries[1].eventPayload.dispatched, null, 'missing trusted dispatch proof remains unknown');
equal(persisted.entries[1].eventPayload.error, 'client_tool_error', 'raw client error content is replaced by a stable code');
check(
  !JSON.stringify(persisted.entries).includes('visible model feedback'),
  'durable event and aggregate summaries never persist raw model-visible result content',
);

const badCorrelation = buildSwanBotClientToolPersistenceEntries({
  pendingTools: [{ id: 'tool-a', name: 'browser.set_toggle' }],
  results: [{ tool_use_id: 'tool-other', content: 'x' }],
  iteration: 1,
});
check(!badCorrelation.ok, 'unexpected result id fails exact persistence correlation');

const firstMerge = mergeSwanBotDurableToolCalls([], persisted.entries);
const replayMerge = mergeSwanBotDurableToolCalls(firstMerge, persisted.entries);
equal(
  replayMerge.filter((entry) =>
    typeof entry === 'object'
    && entry !== null
    && (entry as Record<string, unknown>).toolUseId === 'tool-a'
  ).length,
  1,
  'retrying the same continuation does not duplicate its run aggregate entry',
);

const manyExisting = Array.from({ length: SWANBOT_MAX_DURABLE_TOOL_CALLS + 20 }, (_, index) => ({
  toolName: 'desktop.screenshot',
  toolUseId: `old-${index}`,
  ok: true,
}));
const boundedAggregate = mergeSwanBotDurableToolCalls(manyExisting, persisted.entries);
equal(boundedAggregate.length, SWANBOT_MAX_DURABLE_TOOL_CALLS, 'run aggregate has a hard item ceiling');
check(
  boundedAggregate.some((entry) =>
    typeof entry === 'object'
    && entry !== null
    && (entry as Record<string, unknown>).toolUseId === 'tool-a'
  ),
  'aggregate cap retains the newly closed pending call',
);

const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');
const clientSource = readFileSync('src/lib/swanbot.ts', 'utf8');
check(
  clientSource.includes('runtime.splitOpenSwanRuntimeToolResultMetadata(result)') &&
    clientSource.includes('sanitizeToolResultMetadataForPersistence(split.metadata)'),
  'client accepts receipts only through trusted runtime split plus persistence sanitization',
);
check(
  clientSource.includes('? { receipt_metadata: result.receipt_metadata }') &&
    clientSource.includes('never serialized') &&
    clientSource.includes('mutationDispatchReceipt: persistedMetadata.mutationDispatchReceipt') &&
    clientSource.includes('computerAppVerificationReceipt: persistedMetadata.computerAppVerificationReceipt'),
  'client sends only the two allowlisted namespaces beside model content',
);
check(
  edgeSource.includes('projectSwanBotResumeToolResultsForModel') &&
    edgeSource.includes('Explicit projection strips the durable-only `receipt_metadata`'),
  'edge uses the explicit model-hidden projection',
);
check(
  edgeSource.includes('resolvePendingClientTools(cont)') &&
    edgeSource.includes('pending tool id is not present in the saved assistant turn'),
  'edge derives tool identity from the saved assistant tool_use turn',
);
check(
  edgeSource.includes('kind: "tool_call_result"') &&
    edgeSource.includes('ignoreDuplicates: true') &&
    edgeSource.includes('deterministicClientToolResultEventId'),
  'resume durably and idempotently writes client tool_call_result events',
);
check(
  edgeSource.includes('tool_calls: toolCalls') &&
    edgeSource.includes('let storedClaimedContinuation: StoredRunContinuationEnvelope') &&
    edgeSource.includes('storedClaimedContinuation = await buildStoredContinuationEnvelope(') &&
    edgeSource.includes('continuation: storedClaimedContinuation') &&
    edgeSource.includes('resumeState: "results_claimed"') &&
    !edgeSource.includes('sanitizeContinuationForStorage('),
  'result submission atomically stores the sealed results-claimed continuation and never restores plaintext persistence',
);
check(
  edgeSource.includes('.eq("final_stop_reason", SWANBOT_CONTINUATION_DISPATCHING_REASON)') &&
    edgeSource.includes('applyDispatchClaimedContinuationFilters(claimQuery, dispatchClaim)') &&
    edgeSource.includes('final_stop_reason: SWANBOT_CONTINUATION_RESUMING_REASON'),
  'durable result claim compares and rotates the exact pre-dispatch owner before model resume',
);
check(
  clientSource.indexOf("continuationAction: 'claim_dispatch'")
    < clientSource.indexOf('const toolResults = await executeClientToolCalls(')
    && clientSource.indexOf('const toolResults = await executeClientToolCalls(')
      < clientSource.indexOf("continuationAction: 'submit_results'"),
  'client result persistence is downstream of confirmed dispatch ownership',
);

console.log(`swanbot-v2-client-result-persistence smoke passed (${assertions} assertions)`);
