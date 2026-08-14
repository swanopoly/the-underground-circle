import { strict as nodeAssert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OPEN_SWAN_APPROVAL_RESUME_MAX_ITEMS,
  buildOpenSwanApprovalAuditPayload,
  buildOpenSwanApprovalResumeBindingV1,
  findOpenSwanApprovalResumeItem,
  normalizeOpenSwanApprovalResumeBindingV1,
  projectOpenSwanApprovalResumeItemV1,
  resolveOpenSwanRuntimeApprovalDecision,
} from '../src/lib/openswanToolApprovals';

let assertionCount = 0;
const assert = new Proxy(nodeAssert, {
  apply(target, thisArg, args) {
    assertionCount += 1;
    return Reflect.apply(target, thisArg, args);
  },
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      assertionCount += 1;
      return Reflect.apply(value, target, args);
    };
  },
}) as typeof nodeAssert;

const sourceRunId = '11111111-1111-4111-8111-111111111111';
const currentRunId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const circleId = '44444444-4444-4444-8444-444444444444';
const threadId = '55555555-5555-4555-8555-555555555555';
const approvalId = '66666666-6666-4666-8666-666666666666';
const otherApprovalId = '77777777-7777-4777-8777-777777777777';
const toolName = 'desktop.type_text';
const digest = `approval-v2:sha256:${'a'.repeat(64)}`;
const otherDigest = `approval-v2:sha256:${'b'.repeat(64)}`;

const item = Object.freeze({ approvalId, toolName, toolApprovalDigest: digest });
const binding = buildOpenSwanApprovalResumeBindingV1({
  sourceRunId,
  userId,
  circleId,
  threadId,
  approvals: [item],
});
assert(binding, 'exact schema-v1 binding should build');
assert(Object.isFrozen(binding));
assert(Object.isFrozen(binding.approvals));
assert(Object.isFrozen(binding.approvals[0]));
assert.deepEqual(Object.keys(binding).sort(), [
  'approvals',
  'circleId',
  'schemaVersion',
  'sourceRunId',
  'threadId',
  'userId',
]);
assert.deepEqual(Object.keys(binding.approvals[0]).sort(), [
  'approvalId',
  'toolApprovalDigest',
  'toolName',
]);

const normalized = normalizeOpenSwanApprovalResumeBindingV1(binding);
assert(normalized);
assert.notEqual(normalized, binding, 'normalization must clone untrusted input');
assert.deepEqual(normalized, binding);
assert.equal(buildOpenSwanApprovalResumeBindingV1({
  sourceRunId,
  userId,
  circleId,
  threadId,
  approvals: [],
}), null, 'empty approval sets are not continuation authority');

const uuidAt = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
assert.equal(buildOpenSwanApprovalResumeBindingV1({
  sourceRunId,
  userId,
  circleId,
  threadId,
  approvals: Array.from({ length: OPEN_SWAN_APPROVAL_RESUME_MAX_ITEMS + 1 }, (_, index) => ({
    approvalId: uuidAt(index + 1),
    toolName,
    toolApprovalDigest: digest,
  })),
}), null, 'bindings must cap approval ids at eight');
assert.equal(buildOpenSwanApprovalResumeBindingV1({
  sourceRunId,
  userId,
  circleId,
  threadId,
  approvals: [item, item],
}), null, 'duplicate approval ids must fail closed');

const malformedCases: unknown[] = [
  { ...binding, schemaVersion: 2 },
  { ...binding, sourceRunId: 'not-a-uuid' },
  { ...binding, approvals: [{ ...item, approvalId: 'not-a-uuid' }] },
  { ...binding, approvals: [{ ...item, toolName: 'tool with spaces' }] },
  { ...binding, approvals: [{ ...item, toolApprovalDigest: 'raw-args' }] },
  { ...binding, approvals: [{ ...item, args: { text: 'secret' } }] },
  { ...binding, approvalKey: '{"raw":"args"}' },
];
for (const candidate of malformedCases) {
  assert.equal(normalizeOpenSwanApprovalResumeBindingV1(candidate), null);
}

let accessorRead = false;
const accessorItem: Record<string, unknown> = { approvalId, toolApprovalDigest: digest };
Object.defineProperty(accessorItem, 'toolName', {
  enumerable: true,
  get() {
    accessorRead = true;
    return toolName;
  },
});
assert.equal(normalizeOpenSwanApprovalResumeBindingV1({ ...binding, approvals: [accessorItem] }), null);
assert.equal(accessorRead, false, 'strict normalization must not invoke accessors');

const sparseApprovals = new Array(1);
assert.equal(normalizeOpenSwanApprovalResumeBindingV1({ ...binding, approvals: sparseApprovals }), null);

const exactMatch = findOpenSwanApprovalResumeItem(binding, {
  approvalId,
  sourceRunId,
  toolName,
  digest,
  userId,
  circleId,
  threadId,
});
assert.deepEqual(exactMatch, item);
assert.equal(findOpenSwanApprovalResumeItem(binding, {
  approvalId: otherApprovalId,
  sourceRunId,
  toolName,
  digest,
  userId,
  circleId,
  threadId,
}), null, 'same digest must never substitute a different approval id');
for (const mismatch of [
  { sourceRunId: currentRunId },
  { toolName: 'desktop.paste_text' },
  { digest: otherDigest },
  { userId: currentRunId },
  { circleId: currentRunId },
  { threadId: currentRunId },
]) {
  assert.equal(findOpenSwanApprovalResumeItem(binding, {
    approvalId,
    sourceRunId,
    toolName,
    digest,
    userId,
    circleId,
    threadId,
    ...mismatch,
  }), null);
}
assert(findOpenSwanApprovalResumeItem(binding, {
  sourceRunId,
  toolName,
  digest,
  userId,
  circleId,
  threadId,
}), 'omitting the id is safe only for one exact matching item');
const ambiguousBinding = buildOpenSwanApprovalResumeBindingV1({
  sourceRunId,
  userId,
  circleId,
  threadId,
  approvals: [item, { ...item, approvalId: otherApprovalId }],
});
assert(ambiguousBinding);
assert.equal(findOpenSwanApprovalResumeItem(ambiguousBinding, {
  sourceRunId,
  toolName,
  digest,
  userId,
  circleId,
  threadId,
}), null, 'id-less matching must reject ambiguous same-tool/digest rows');

const auditPayload = buildOpenSwanApprovalAuditPayload({
  toolName,
  approvalDigest: digest,
  policyFamily: 'desktop',
  approvalMode: 'ask',
  mutatesState: true,
  externalSideEffect: true,
});
assert(auditPayload);
const resolvedRow = {
  id: approvalId,
  run_id: sourceRunId,
  circle_id: circleId,
  requested_by: userId,
  status: 'approved',
  requested_at: new Date().toISOString(),
  timeout_seconds: 300,
  payload: auditPayload,
};
const projected = projectOpenSwanApprovalResumeItemV1(resolvedRow, {
  approvalId,
  sourceRunId,
  userId,
  circleId,
});
assert.deepEqual(projected, item);
assert(projected && Object.isFrozen(projected));
assert.deepEqual(projected && Object.keys(projected).sort(), [
  'approvalId',
  'toolApprovalDigest',
  'toolName',
]);
for (const scope of [
  { approvalId: otherApprovalId, sourceRunId, userId, circleId },
  { approvalId, sourceRunId: currentRunId, userId, circleId },
  { approvalId, sourceRunId, userId: currentRunId, circleId },
  { approvalId, sourceRunId, userId, circleId: currentRunId },
]) {
  assert.equal(projectOpenSwanApprovalResumeItemV1(resolvedRow, scope), null);
}
assert.equal(projectOpenSwanApprovalResumeItemV1({
  ...resolvedRow,
  payload: { ...auditPayload, rawArgs: { text: 'secret' } },
}, { approvalId, sourceRunId, userId, circleId }), null);

let payloadAccessorRead = false;
const accessorPayload = { ...auditPayload };
Object.defineProperty(accessorPayload, 'toolName', {
  enumerable: true,
  get() {
    payloadAccessorRead = true;
    return toolName;
  },
});
assert.equal(projectOpenSwanApprovalResumeItemV1({ ...resolvedRow, payload: accessorPayload }, {
  approvalId,
  sourceRunId,
  userId,
  circleId,
}), null);
assert.equal(payloadAccessorRead, false, 'row projection must not invoke payload accessors');

const nowMs = Date.now();
const expiredDecision = resolveOpenSwanRuntimeApprovalDecision({
  tool: toolName,
  approvalDigest: digest,
  nowMs,
  rows: [{
    ...resolvedRow,
    requested_at: new Date(nowMs - 120_000).toISOString(),
    timeout_seconds: 60,
  }],
});
assert.equal(expiredDecision.kind, 'block');
assert.match(expiredDecision.message, /expired/i);
const exactDecision = resolveOpenSwanRuntimeApprovalDecision({
  tool: toolName,
  approvalDigest: digest,
  nowMs,
  rows: [{
    ...resolvedRow,
    requested_at: new Date(nowMs - 1_000).toISOString(),
    timeout_seconds: 60,
  }],
});
assert.equal(exactDecision.kind, 'pass');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const typedRuntime = readFileSync(`${repoRoot}/src/lib/openswanToolRuntime.ts`, 'utf8');
const swanBot = readFileSync(`${repoRoot}/src/lib/swanbot.ts`, 'utf8');
for (const source of [typedRuntime, swanBot]) {
  assert.match(source, /normalizeOpenSwanApprovalResumeBindingV1\(input\.context\.approvalResumeBinding\)/);
  assert.match(source, /\.eq\('run_id', resumeBinding\.sourceRunId\)/);
  assert.match(source, /\.in\('id', matchingBoundItems\.map\(\(item\) => item\.approvalId\)\)/);
  assert.match(source, /approvalId: decision\.authority\.approvalId,[\s\S]{0,220}sourceRunId:/);
  assert.match(source, /input\.source === 'cross_run'[\s\S]{0,180}approvalResumeBinding/);
}
assert(
  typedRuntime.indexOf('const boundCrossRunPass = await findCrossRunApprovedToolPass')
    < typedRuntime.indexOf('if (categoryAuto && autoApproveCategory)'),
  'bound resume must be resolved before category auto can mint substitute authority',
);
assert.match(swanBot, /approvalResumeBinding: context\?\.approvalResumeBinding \|\| null/);
assert.match(swanBot, /approvalResumeBinding: opts\.approvalResumeBinding \|\| null/);

console.log(`OpenSwan approval-resume binding smoke passed (${assertionCount} assertions).`);
