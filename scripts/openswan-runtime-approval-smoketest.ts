/**
 * OpenSwan approval intent + single-use authority smoke.
 *
 * Durable rows carry only structural metadata and SHA-256 bindings. An
 * approved intent is not dispatch authority until one authenticated provider
 * call atomically consumes it.
 */

import { readFileSync } from 'node:fs';
import {
  buildOpenSwanApprovalAuditPayload,
  buildOpenSwanApprovalAuthorityBindingDigest,
  buildOpenSwanToolApprovalDigest,
  buildOpenSwanToolApprovalKey,
  createOpenSwanRuntimeApprovalReceipt,
  isOpenSwanApprovalAuditPayload,
  resolveOpenSwanRuntimeApprovalDecision,
  stableApprovalJson,
  type OpenSwanRuntimeApprovalCallIdentity,
  type OpenSwanRuntimeApprovalRow,
} from '../src/lib/openswanToolApprovals';
import {
  constraintBlocksToolCall,
  resolveChatComputerConstraintInputs,
} from '../src/lib/chatComputerRequestRouter';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log('pass:', message);
  else {
    failures += 1;
    console.error('FAIL:', `${message}${detail ? ` - ${detail}` : ''}`);
  }
}

async function main() {
const APPROVAL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CIRCLE_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_RUN_ID = '55555555-5555-4555-8555-555555555555';
const NOW = Date.parse('2026-07-27T12:00:00.000Z');
const REQUESTED_AT = '2026-07-27T11:59:00.000Z';
const tool = 'desktop.click_element';
const args = {
  appName: 'Safari',
  targetLabel: 'Send',
  meta: {
    retries: 1,
    safe: true,
    longTail: `${'x'.repeat(20_000)}-tail-a`,
  },
};
const reorderedArgs = {
  targetLabel: 'Send',
  meta: {
    longTail: `${'x'.repeat(20_000)}-tail-a`,
    safe: true,
    retries: 1,
  },
  appName: 'Safari',
};
const oneByteChangedArgs = {
  ...reorderedArgs,
  meta: {
    ...reorderedArgs.meta,
    longTail: `${'x'.repeat(20_000)}-tail-b`,
  },
};

const key = buildOpenSwanToolApprovalKey(tool, args);
const digest = await buildOpenSwanToolApprovalDigest(tool, args);
const reorderedDigest = await buildOpenSwanToolApprovalDigest(tool, reorderedArgs);
const changedDigest = await buildOpenSwanToolApprovalDigest(tool, oneByteChangedArgs);

assert(
  stableApprovalJson({ b: 2, a: { d: 4, c: 3 } })
    === stableApprovalJson({ a: { c: 3, d: 4 }, b: 2 }),
  'canonical JSON sorts nested object keys',
);
assert(
  key === buildOpenSwanToolApprovalKey(tool, reorderedArgs),
  'ephemeral exact intent key is stable across argument key order',
);
assert(
  /^approval-v2:sha256:[0-9a-f]{64}$/.test(digest)
    && digest === reorderedDigest,
  'durable exact intent uses a stable SHA-256 digest',
);
assert(
  digest !== changedDigest,
  'a one-byte change after a 20,000-character common prefix changes authority',
);

const safePayload = buildOpenSwanApprovalAuditPayload({
  toolName: tool,
  approvalDigest: digest,
  policyFamily: 'browser',
  approvalMode: 'ask',
  mutatesState: true,
  externalSideEffect: false,
});
assert(safePayload !== null, 'safe structural approval payload builds');
assert(
  isOpenSwanApprovalAuditPayload(safePayload),
  'safe structural approval payload validates',
);

function row(
  status: string,
  payload: Record<string, unknown> | null = safePayload,
  overrides: Partial<OpenSwanRuntimeApprovalRow> = {},
): OpenSwanRuntimeApprovalRow {
  return {
    id: APPROVAL_ID,
    run_id: RUN_ID,
    circle_id: CIRCLE_ID,
    requested_by: USER_ID,
    requested_at: REQUESTED_AT,
    timeout_seconds: 300,
    status,
    payload,
    ...overrides,
  };
}

const pending = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('pending')],
  nowMs: NOW,
});
assert(pending.kind === 'defer', 'pending exact approval defers execution');

const approved = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('approved')],
  nowMs: NOW,
});
assert(
  approved.kind === 'pass'
    && approved.approvalId === APPROVAL_ID
    && approved.authority.approvalDigest === digest,
  'approved exact intent is only an unconsumed authority candidate',
);

const changedArgsDecision = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: changedDigest,
  rows: [row('approved')],
  nowMs: NOW,
});
assert(
  changedArgsDecision.kind === 'new',
  'approved authority cannot cover a long-tail argument change',
);

const consumedPayload = buildOpenSwanApprovalAuditPayload({
  toolName: tool,
  approvalDigest: digest,
  policyFamily: 'browser',
  approvalMode: 'ask',
  mutatesState: true,
  externalSideEffect: false,
  dispatchBindingDigest: `authority-v2:sha256:${'a'.repeat(64)}`,
  dispatchConsumedAt: '2026-07-27T11:59:30.000Z',
});
const sameRunReplay = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('approved', consumedPayload)],
  nowMs: NOW,
});
assert(
  sameRunReplay.kind === 'block',
  'same-run replay of a consumed approval is blocked',
);

const categoryAutoFirstUse = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('auto_approved')],
  nowMs: NOW,
});
const categoryAutoReplay = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('auto_approved', consumedPayload)],
  nowMs: NOW,
});
assert(
  categoryAutoFirstUse.kind === 'pass' && categoryAutoReplay.kind === 'block',
  'category auto-approval remains single-use',
);

const expired = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('approved', safePayload, { requested_at: '2026-07-27T11:40:00.000Z' })],
  nowMs: NOW,
});
assert(expired.kind === 'block', 'time-expired approval blocks dispatch');

const rejected = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('rejected')],
  nowMs: NOW,
});
assert(rejected.kind === 'block', 'rejected exact approval blocks dispatch');

const legacyApproved = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('approved', { tool, args, toolApprovalKey: key })],
  nowMs: NOW,
});
assert(legacyApproved.kind === 'block', 'legacy raw-args approval can never authorize v2 dispatch');

const malformedExtraField = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('approved', { ...safePayload, previewDetail: '/Users/example/secret.txt' })],
  nowMs: NOW,
});
assert(malformedExtraField.kind === 'block', 'payload outside the structural allowlist is rejected');

const malformedOptionalField = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  approvalDigest: digest,
  rows: [row('approved', { ...safePayload, autoApproveCategory: 42 })],
  nowMs: NOW,
});
assert(
  malformedOptionalField.kind === 'block',
  'allowlisted optional approval fields must still match the canonical schema exactly',
);

const identity: OpenSwanRuntimeApprovalCallIdentity = {
  userId: USER_ID,
  circleId: CIRCLE_ID,
  runId: RUN_ID,
  toolName: tool,
  toolUseId: 'provider-call-1',
  iteration: 3,
};
const binding = await buildOpenSwanApprovalAuthorityBindingDigest({
  approvalId: APPROVAL_ID,
  approvalRunId: RUN_ID,
  approvalDigest: digest,
  status: 'approved',
  source: 'run_scoped',
  identity,
});
const otherCallBinding = await buildOpenSwanApprovalAuthorityBindingDigest({
  approvalId: APPROVAL_ID,
  approvalRunId: RUN_ID,
  approvalDigest: digest,
  status: 'approved',
  source: 'run_scoped',
  identity: { ...identity, runId: OTHER_RUN_ID, toolUseId: 'provider-call-2' },
});
assert(
  /^authority-v2:sha256:[0-9a-f]{64}$/.test(binding)
    && binding !== otherCallBinding,
  'authority receipt digest binds run and provider tool-call identity',
);

const receipt = createOpenSwanRuntimeApprovalReceipt({
  approvalId: APPROVAL_ID,
  approvalRunId: RUN_ID,
  approvalKey: key,
  approvalDigest: digest,
  authorityBindingDigest: binding,
  status: 'approved',
  source: 'run_scoped',
  consumedAt: '2026-07-27T11:59:30.000Z',
  identity,
});
assert(
  receipt?.schemaVersion === 2
    && receipt.approvalRunId === RUN_ID
    && receipt.runId === RUN_ID
    && receipt.approvalDigest === digest
    && receipt.toolUseId === 'provider-call-1'
    && receipt.iteration === 3,
  'runtime receipt carries exact cryptographic intent and call identity',
);
assert(
  createOpenSwanRuntimeApprovalReceipt({
    approvalId: APPROVAL_ID,
    approvalRunId: RUN_ID,
    approvalKey: key,
    approvalDigest: digest,
    authorityBindingDigest: binding,
    status: 'approved',
    source: 'run_scoped',
    consumedAt: '2026-07-27T11:59:30.000Z',
    identity: { ...identity, toolUseId: '' },
  }) === null,
  'receipt factory rejects missing provider call identity',
);

const retryIdentity: OpenSwanRuntimeApprovalCallIdentity = {
  ...identity,
  runId: OTHER_RUN_ID,
  toolUseId: 'provider-call-retry',
  iteration: 1,
};
const crossRunBinding = await buildOpenSwanApprovalAuthorityBindingDigest({
  approvalId: APPROVAL_ID,
  approvalRunId: RUN_ID,
  approvalDigest: digest,
  status: 'approved',
  source: 'cross_run',
  identity: retryIdentity,
});
const wrongApprovalRunBinding = await buildOpenSwanApprovalAuthorityBindingDigest({
  approvalId: APPROVAL_ID,
  approvalRunId: OTHER_RUN_ID,
  approvalDigest: digest,
  status: 'approved',
  source: 'cross_run',
  identity: retryIdentity,
});
const crossRunReceipt = createOpenSwanRuntimeApprovalReceipt({
  approvalId: APPROVAL_ID,
  approvalRunId: RUN_ID,
  approvalKey: key,
  approvalDigest: digest,
  authorityBindingDigest: crossRunBinding,
  status: 'approved',
  source: 'cross_run',
  consumedAt: '2026-07-27T11:59:30.000Z',
  identity: retryIdentity,
});
assert(
  crossRunReceipt?.approvalRunId === RUN_ID
    && crossRunReceipt.runId === OTHER_RUN_ID
    && crossRunReceipt.source === 'cross_run'
    && crossRunBinding !== wrongApprovalRunBinding,
  'approve-then-retry receipt separately binds prior approval run and current dispatch run',
);

const secretArgs = {
  command: 'send --token super-secret',
  path: '/Users/example/private/report.txt',
  credential: 'password123',
  url: 'https://example.test/action?token=raw-query-secret',
  typedValue: 'private draft text',
  previewDetail: 'never persist this',
};
const secretDigest = await buildOpenSwanToolApprovalDigest('desktop.type_text', secretArgs);
const redactedPayload = buildOpenSwanApprovalAuditPayload({
  toolName: 'desktop.type_text',
  approvalDigest: secretDigest,
  policyFamily: 'browser',
  approvalMode: 'ask',
  mutatesState: true,
  externalSideEffect: false,
});
const durableJson = JSON.stringify(redactedPayload);
assert(
  Boolean(redactedPayload)
    && !durableJson.includes('super-secret')
    && !durableJson.includes('/Users/')
    && !durableJson.includes('raw-query-secret')
    && !durableJson.includes('private draft')
    && !durableJson.includes('previewDetail')
    && /^approval-v2:sha256:[0-9a-f]{64}$/.test(String(redactedPayload?.toolApprovalDigest || '')),
  'durable approval payload persists digests and structural metadata only',
);

// Session-path constraint hydration remains pinned beside the approval gate.
const sessionConstraintInputs = resolveChatComputerConstraintInputs(
  'Update the draft but never send any emails while doing it.',
);
assert(
  sessionConstraintInputs.userConstraints !== null
    && sessionConstraintInputs.userConstraints.forbidden.includes('send'),
  'session turn parses a forbidden send constraint',
);
assert(
  constraintBlocksToolCall(
    sessionConstraintInputs.userConstraints,
    'browser.click_element',
    { targetLabel: 'Send email' },
  ).blocked === true,
  'hydrated session constraints block a send tool call',
);
const sessionRuntimeSource = readFileSync('src/lib/openswanSessionRuntime.ts', 'utf8');
assert(
  sessionRuntimeSource.includes(
    'userConstraints: resolveChatComputerConstraintInputs(args.userMessage).userConstraints',
  ),
  'session runtime hydrates tool-context user constraints',
);

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
assert(
  runtimeSource.includes(".is('payload->>dispatchBindingDigest', null)")
    && runtimeSource.includes('data.length !== 1')
    && runtimeSource.includes(".eq('payload->>toolApprovalDigest', exactDigest)")
    && runtimeSource.includes(".eq('requested_by', input.context.userId)")
    && runtimeSource.includes(".eq('status', input.authority.status)"),
  'single-use compare-and-set loses competing cross-run and same-run races closed',
);
assert(
  runtimeSource.includes('hasAuthenticatedPersistedOpenSwanCallIdentity(input.tool, input.context)')
    && runtimeSource.includes("source: 'cross_run'")
    && runtimeSource.includes("source: 'category_auto'")
    && runtimeSource.includes("const approvalRunId = String(row.run_id || '')")
    && runtimeSource.includes('approvalRunId,\n    approvalDigest: exactDigest'),
  'run-scoped, cross-run, and category-auto receipts require persisted authenticated identity with approval-run binding',
);
assert(
  !runtimeSource.includes('consumedByRunId')
    && !runtimeSource.includes('honoredCrossRunApprovalId')
    && !runtimeSource.includes('approvalPreview: {')
    && runtimeSource.includes('payload: approvalPayload')
    && runtimeSource.includes('payload: safePayload'),
  'legacy reusable authority and raw approval preview persistence are gone',
);
assert(
  runtimeSource.includes('stopped at the raw mutation dispatcher')
    && runtimeSource.includes('approvalReceipt.toolUseId !== context.toolUseId')
    && runtimeSource.includes('approvalReceipt.iteration !== context.iteration'),
  'generic ask-gated mutations require an exact consumed receipt at dispatch',
);
assert(
  runtimeSource.includes('sealOpenSwanRuntimeMutationArgs(tool, incomingArgs)')
    && runtimeSource.includes('deepFreezeOpenSwanApprovalArgs(canonical.args)')
    && runtimeSource.includes('dispatchOpenSwanRuntimeTool(\n    tool,\n    runtimeArgs,\n    context,\n    approvalReceipt,'),
  'caller-owned mutation args are canonically cloned and frozen before approval I/O',
);
assert(
  runtimeSource.includes('approvalKeyDigest: receipt.approvalDigest')
    && runtimeSource.includes('delete rawRecord.metadata')
    && runtimeSource.includes('issuedOpenSwanApprovalReceiptMetadata.has(approvalCandidate as object)'),
  'only digest-safe runtime-issued receipt metadata survives output splitting',
);
assert(
  runtimeSource.includes("approvalReceipt: toolName === 'custom_api.request'")
    && runtimeSource.includes("buildOpenSwanEdgeApprovalReceipt(\n              'messaging.notify'")
    && runtimeSource.includes('const { approvalKey: _ephemeralApprovalKey, ...safeReceipt } = receipt')
    && !runtimeSource.includes('approvalReceipt: approvalReceipt,'),
  'only a redacted exact-call receipt reaches the two outbound edge mutations',
);
assert(
  runtimeSource.includes('The approval service could not verify ${tool}. Nothing was run; retry after the service is healthy.')
    && !runtimeSource.includes('Approval lookup failed for ${tool}: ${existingError.message}'),
  'approval lookup failures expose no raw database error text',
);
assert(
  runtimeSource.includes("if (tool.startsWith('wp.'))")
    && /approvalMode:\s*readOnly \? 'auto' : 'ask'/.test(runtimeSource)
    && /approvalKind:\s*readOnly \? undefined : 'publish'/.test(runtimeSource),
  'mutating WordPress runtime tools remain ask-gated',
);
assert(
  runtimeSource.includes('a run cannot approve its own gated action')
    && /status === 'approved' && context\.runId/.test(runtimeSource),
  'a run still cannot approve its own gated action',
);
assert(
  runtimeSource.includes("tool === 'automations.list' ||"),
  'automations.list remains read-only',
);
assert(
  runtimeSource.includes("name: 'browser.fill_credential_field'")
    && runtimeSource.includes('without returning raw secret values to the model'),
  'credential fill remains cataloged with its no-secret-return policy',
);

if (failures > 0) {
  console.error(`\n${failures} OpenSwan runtime approval smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll OpenSwan runtime approval smoke cases passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
