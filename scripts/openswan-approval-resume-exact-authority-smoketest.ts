import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deleteOpenSwanApprovalResumeExactCallLeases,
  executeOpenSwanApprovalResumeExactCalls,
  inspectOpenSwanApprovalResumeExactCallLease,
  registerOpenSwanApprovalResumeExactCallLease,
} from '../src/lib/openSwanApprovalResumeAuthority';
import { buildOpenSwanApprovalResumeBindingV1 } from '../src/lib/openswanToolApprovals';

const SOURCE_RUN = '10000000-0000-4000-8000-000000000001';
const CURRENT_RUN = '10000000-0000-4000-8000-000000000002';
const USER = '20000000-0000-4000-8000-000000000001';
const CIRCLE = '30000000-0000-4000-8000-000000000001';
const THREAD = '40000000-0000-4000-8000-000000000001';
const SOURCE_MESSAGE = '40000000-0000-4000-8000-000000000002';
const NOW = 1_800_000_000_000;
const digest = (character: string) => `approval-v2:sha256:${character.repeat(64)}`;

let assertions = 0;
function check(value: unknown, message: string): void {
  assert.ok(value, message);
  assertions += 1;
}

function binding(items: Array<{ approvalId: string; toolName: string; toolApprovalDigest: string }>) {
  const value = buildOpenSwanApprovalResumeBindingV1({
    sourceRunId: SOURCE_RUN,
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    approvals: items,
  });
  assert.ok(value);
  return value;
}

async function main(): Promise<void> {
const approvalOne = '50000000-0000-4000-8000-000000000001';
const approvalTwo = '50000000-0000-4000-8000-000000000002';
const rawOne = { roomId: 'room-original', nested: { title: 'Ship it' } };
const rawTwo = { roomId: 'room-two', nested: { title: 'Ship it too' } };
for (const [approvalId, toolApprovalDigest, args, sourceCallOrdinal] of [
  [approvalOne, digest('a'), rawOne, 1],
  [approvalTwo, digest('b'), rawTwo, 2],
] as const) {
  check(registerOpenSwanApprovalResumeExactCallLease({
    approvalId,
    sourceRunId: SOURCE_RUN,
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    toolName: 'rooms.rename',
    toolApprovalDigest,
    sourceToolUseId: `source-call:${approvalId}`,
    sourceIteration: 1,
    sourceCallOrdinal,
    args,
    expiresAtMs: NOW + 300_000,
  }, NOW), `registered ${approvalId}`);
}

rawOne.roomId = 'attacker-mutated';
rawOne.nested.title = 'attacker-mutated';
const calls: Array<{ approvalId: string; roomId: unknown; title: unknown; toolUseId: string; iteration: number }> = [];
let modelCalls = 0;
const exactResult = await executeOpenSwanApprovalResumeExactCalls({
  binding: binding([
    { approvalId: approvalTwo, toolName: 'rooms.rename', toolApprovalDigest: digest('b') },
    { approvalId: approvalOne, toolName: 'rooms.rename', toolApprovalDigest: digest('a') },
  ]),
  currentRunId: CURRENT_RUN,
  sourceUserMessageId: SOURCE_MESSAGE,
  nowMs: NOW + 1,
  dispatch: async (call, identity) => {
    calls.push({
      approvalId: call.approvalId,
      roomId: call.args.roomId,
      title: (call.args.nested as { title?: unknown })?.title,
      toolUseId: identity.toolUseId,
      iteration: identity.iteration,
    });
    return { status: 'passed' as const, value: call.approvalId };
  },
});
check(exactResult.disposition.state === 'satisfied', 'two exact calls satisfied');
check(exactResult.disposition.items.length === 2, 'every binding id has disposition');
check(exactResult.executions.length === 2, 'two same-tool approvals both execute');
check(calls.length === 2, 'two calls dispatched once');
check(calls[0]?.approvalId === approvalOne && calls[1]?.approvalId === approvalTwo, 'newest-first binding is canonicalized to original provider call order');
check(calls[0]?.roomId === 'room-original', 'post-registration root mutation cannot change call');
check(calls[0]?.title === 'Ship it', 'post-registration nested mutation cannot change call');
check(Object.isFrozen((calls as unknown[])) === false, 'smoke observer remains mutable');
check(calls[0]?.toolUseId === `approval-resume:${approvalOne}`, 'runtime-owned exact tool use id');
check(calls[1]?.iteration === 2, 'runtime-owned ordered iteration');
check(modelCalls === 0, 'no model call was needed to reconstruct approved args');

const replay = await executeOpenSwanApprovalResumeExactCalls({
  binding: binding([
    { approvalId: approvalTwo, toolName: 'rooms.rename', toolApprovalDigest: digest('b') },
    { approvalId: approvalOne, toolName: 'rooms.rename', toolApprovalDigest: digest('a') },
  ]),
  currentRunId: CURRENT_RUN,
  sourceUserMessageId: SOURCE_MESSAGE,
  nowMs: NOW + 2,
  dispatch: async () => {
    modelCalls += 1;
    return { status: 'passed' as const, value: 'unexpected' };
  },
});
check(replay.disposition.state === 'incomplete', 'claimed calls cannot replay');
check(replay.executions.length === 0, 'replay dispatch count zero');
check(modelCalls === 0, 'replay cannot reach reconstruction callback');

const retainedId = '50000000-0000-4000-8000-000000000003';
check(registerOpenSwanApprovalResumeExactCallLease({
  approvalId: retainedId,
  sourceRunId: SOURCE_RUN,
  userId: USER,
  circleId: CIRCLE,
  threadId: THREAD,
  sourceUserMessageId: SOURCE_MESSAGE,
  toolName: 'rooms.rename',
  toolApprovalDigest: digest('c'),
  sourceToolUseId: `source-call:${retainedId}`,
  sourceIteration: 1,
  sourceCallOrdinal: 1,
  args: { roomId: 'retained' },
  expiresAtMs: NOW + 300_000,
}, NOW), 'run-failure lease registered');
const noRun = await executeOpenSwanApprovalResumeExactCalls({
  binding: binding([{ approvalId: retainedId, toolName: 'rooms.rename', toolApprovalDigest: digest('c') }]),
  currentRunId: '',
  sourceUserMessageId: SOURCE_MESSAGE,
  nowMs: NOW + 1,
  dispatch: async () => {
    modelCalls += 1;
    return { status: 'passed' as const, value: 'unexpected' };
  },
});
check(noRun.disposition.state === 'incomplete', 'run creation failure is incomplete');
check(noRun.executions.length === 0, 'run creation failure executes nothing');
check(inspectOpenSwanApprovalResumeExactCallLease(retainedId, NOW + 1).present, 'run creation failure retains lease');

const missingId = '50000000-0000-4000-8000-000000000004';
const allOrNone = await executeOpenSwanApprovalResumeExactCalls({
  binding: binding([
    { approvalId: retainedId, toolName: 'rooms.rename', toolApprovalDigest: digest('c') },
    { approvalId: missingId, toolName: 'rooms.rename', toolApprovalDigest: digest('d') },
  ]),
  currentRunId: CURRENT_RUN,
  sourceUserMessageId: SOURCE_MESSAGE,
  nowMs: NOW + 2,
  dispatch: async () => {
    modelCalls += 1;
    return { status: 'passed' as const, value: 'unexpected' };
  },
});
check(allOrNone.disposition.state === 'incomplete', 'missing lease keeps terminal partial');
check(allOrNone.disposition.items.some((item) => item.approvalId === missingId && item.state === 'missing'), 'missing id reported exactly');
check(allOrNone.executions.length === 0, 'batch claim is all-or-nothing');
check(inspectOpenSwanApprovalResumeExactCallLease(retainedId, NOW + 2).present, 'available peer retained when batch peer missing');

const failureOne = '50000000-0000-4000-8000-000000000005';
const failureTwo = '50000000-0000-4000-8000-000000000006';
for (const [approvalId, character] of [[failureOne, 'e'], [failureTwo, 'f']] as const) {
  check(registerOpenSwanApprovalResumeExactCallLease({
    approvalId,
    sourceRunId: SOURCE_RUN,
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    toolName: 'rooms.rename',
    toolApprovalDigest: digest(character),
    sourceToolUseId: `source-call:${approvalId}`,
    sourceIteration: 1,
    sourceCallOrdinal: approvalId === failureOne ? 1 : 2,
    args: { roomId: approvalId },
    expiresAtMs: NOW + 300_000,
  }, NOW), 'failure ordering lease registered');
}
let failureDispatches = 0;
const stopped = await executeOpenSwanApprovalResumeExactCalls({
  binding: binding([
    { approvalId: failureOne, toolName: 'rooms.rename', toolApprovalDigest: digest('e') },
    { approvalId: failureTwo, toolName: 'rooms.rename', toolApprovalDigest: digest('f') },
  ]),
  currentRunId: CURRENT_RUN,
  sourceUserMessageId: SOURCE_MESSAGE,
  nowMs: NOW + 3,
  dispatch: async () => {
    failureDispatches += 1;
    return { status: 'failed' as const, value: 'outcome unknown' };
  },
});
check(failureDispatches === 1, 'first failure stops later approved call dispatch');
check(stopped.disposition.state === 'failed', 'first failed call controls terminal truth');
check(stopped.disposition.items[1]?.state === 'blocked', 'undispatched later call is explicitly blocked');

const acceptId = '50000000-0000-4000-8000-000000000007';
check(registerOpenSwanApprovalResumeExactCallLease({
  approvalId: acceptId,
  sourceRunId: SOURCE_RUN,
  userId: USER,
  circleId: CIRCLE,
  threadId: THREAD,
  sourceUserMessageId: SOURCE_MESSAGE,
  toolName: 'rooms.rename',
  toolApprovalDigest: digest('7'),
  sourceToolUseId: `source-call:${acceptId}`,
  sourceIteration: 1,
  sourceCallOrdinal: 1,
  args: { roomId: 'accept-throws' },
  expiresAtMs: NOW + 300_000,
}, NOW), 'acceptance failure lease registered');
let acceptedDispatches = 0;
const acceptanceFailure = await executeOpenSwanApprovalResumeExactCalls({
  binding: binding([{ approvalId: acceptId, toolName: 'rooms.rename', toolApprovalDigest: digest('7') }]),
  currentRunId: CURRENT_RUN,
  sourceUserMessageId: SOURCE_MESSAGE,
  nowMs: NOW + 4,
  accept: () => { throw new Error('ui custody rejected'); },
  dispatch: async () => {
    acceptedDispatches += 1;
    return { status: 'passed' as const, value: 'unexpected' };
  },
});
check(acceptanceFailure.disposition.state === 'incomplete', 'accept callback failure is incomplete');
check(acceptedDispatches === 0, 'accept callback failure dispatches nothing');
check(inspectOpenSwanApprovalResumeExactCallLease(acceptId, NOW + 4).present, 'accept callback failure retains lease');

const ambiguousOne = '50000000-0000-4000-8000-000000000008';
const ambiguousTwo = '50000000-0000-4000-8000-000000000009';
for (const [approvalId, character] of [[ambiguousOne, '8'], [ambiguousTwo, '9']] as const) {
  check(registerOpenSwanApprovalResumeExactCallLease({
    approvalId,
    sourceRunId: SOURCE_RUN,
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    toolName: 'rooms.rename',
    toolApprovalDigest: digest(character),
    sourceToolUseId: `source-call:${approvalId}`,
    sourceIteration: 2,
    sourceCallOrdinal: 1,
    args: { roomId: approvalId },
    expiresAtMs: NOW + 300_000,
  }, NOW), 'ambiguous source-position lease registered');
}
let ambiguousDispatches = 0;
const ambiguousOrder = await executeOpenSwanApprovalResumeExactCalls({
  binding: binding([
    { approvalId: ambiguousTwo, toolName: 'rooms.rename', toolApprovalDigest: digest('9') },
    { approvalId: ambiguousOne, toolName: 'rooms.rename', toolApprovalDigest: digest('8') },
  ]),
  currentRunId: CURRENT_RUN,
  sourceUserMessageId: SOURCE_MESSAGE,
  nowMs: NOW + 5,
  dispatch: async () => {
    ambiguousDispatches += 1;
    return { status: 'passed' as const, value: 'unexpected' };
  },
});
check(ambiguousOrder.disposition.state === 'incomplete', 'duplicate provider positions fail combined claim closed');
check(ambiguousDispatches === 0, 'ambiguous provider order dispatches nothing');
check(inspectOpenSwanApprovalResumeExactCallLease(ambiguousOne, NOW + 5).present, 'ambiguous claim retains first lease');
check(inspectOpenSwanApprovalResumeExactCallLease(ambiguousTwo, NOW + 5).present, 'ambiguous claim retains second lease');

check(deleteOpenSwanApprovalResumeExactCallLeases([ambiguousOne, ambiguousTwo]) === 2, 'targeted cleanup revokes exact leases');
check(!inspectOpenSwanApprovalResumeExactCallLease(ambiguousOne, NOW + 5).present, 'targeted cleanup removes first lease');

const source = readFileSync('src/lib/openswanSessionRuntime.ts', 'utf8');
check(source.includes('runBoundOpenSwanApprovalResume'), 'session owns direct resume path');
check(source.includes('opts.approvalResumeBinding != null\n          ? await runBoundOpenSwanApprovalResume'), 'bound turn bypasses typed and legacy model loops');
check(source.includes('No model replay was attempted'), 'bound error fallback is non-model');
check(source.includes('trustedReceipt.source === \'cross_run\''), 'success requires trusted cross-run approval receipt');
check(source.includes('trustedReceipt.approvalRunId === call.sourceRunId'), 'receipt is source-run bound');
check(source.includes('trustedReceipt.toolUseId === identity.toolUseId'), 'receipt is current exact-call bound');
check(source.includes('opts.approvalResumeBinding != null\n    || shouldSuppressPreLoopDelegationForAttachmentTurn'), 'bound continuation suppresses pre-loop delegation');
check(source.includes('onAccepted: opts.onApprovalResumeAccepted'), 'session passes post-run custody callback into atomic claim');
check(source.includes('registerOpenSwanApprovalSourceCallOrdinal'), 'typed path retains original provider block ordinal');
const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
check(runtimeSource.includes('registerOpenSwanApprovalResumeExactCallLease'), 'approval gate retains exact call');
check(runtimeSource.includes('originalRuntimeArgs'), 'prepared approval digest is distinct from original runtime args');
check(runtimeSource.includes('sourceCallOrdinal: retainedSourceCallOrdinal!'), 'lease carries proven source call ordinal');
const swanbotSource = readFileSync('src/lib/swanbot.ts', 'utf8');
check(swanbotSource.includes('dispatchRequestedTool(block, bi + 1)'), 'legacy path propagates provider block ordinal');

console.log(`openswan approval resume exact authority smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
