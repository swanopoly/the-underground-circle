/**
 * Focused STOP-race smoke for exact OpenSwan approval continuations.
 *
 * Covers the two timing windows that matter after a user approves an exact
 * call:
 *   1. STOP after runtime custody is accepted but before the first dispatch;
 *   2. STOP while the first dispatch promise is awaited, which must set the
 *      cancellation bit and prevent every later approved call from entering.
 *
 * The session runtime is intentionally too dependency-heavy to import here,
 * so its LegacyToolLoopResult handoff and the final browser/native entry
 * fences are checked as source-ordered contracts. The exact-call authority
 * itself and the generic legacy abort mapping are exercised behaviorally.
 *
 * Run with:
 *   npx tsx scripts/openswan-approval-resume-stop-race-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deleteOpenSwanApprovalResumeExactCallLeases,
  executeOpenSwanApprovalResumeExactCalls,
  inspectOpenSwanApprovalResumeExactCallLease,
  registerOpenSwanApprovalResumeExactCallLease,
} from '../src/lib/openSwanApprovalResumeAuthority';
import { buildLegacyToolLoopResult } from '../src/lib/openswanSessionRuntimeAdapters';
import { buildOpenSwanApprovalResumeBindingV1 } from '../src/lib/openswanToolApprovals';

const SOURCE_RUN = '10000000-0000-4000-8000-000000000011';
const CURRENT_RUN = '10000000-0000-4000-8000-000000000012';
const USER_ID = '20000000-0000-4000-8000-000000000011';
const CIRCLE_ID = '30000000-0000-4000-8000-000000000011';
const THREAD_ID = '40000000-0000-4000-8000-000000000011';
const SOURCE_MESSAGE_ID = '40000000-0000-4000-8000-000000000012';
const NOW_MS = 1_800_000_000_000;

let checks = 0;

function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  checks += 1;
}

function digest(character: string): string {
  return `approval-v2:sha256:${character.repeat(64)}`;
}

function buildBinding(
  approvals: ReadonlyArray<Readonly<{
    approvalId: string;
    toolName: string;
    toolApprovalDigest: string;
  }>>,
) {
  const value = buildOpenSwanApprovalResumeBindingV1({
    sourceRunId: SOURCE_RUN,
    userId: USER_ID,
    circleId: CIRCLE_ID,
    threadId: THREAD_ID,
    approvals,
  });
  assert.ok(value, 'test binding must be valid');
  return value;
}

function registerCall(input: Readonly<{
  approvalId: string;
  digestCharacter: string;
  ordinal: number;
}>): void {
  check(registerOpenSwanApprovalResumeExactCallLease({
    approvalId: input.approvalId,
    sourceRunId: SOURCE_RUN,
    userId: USER_ID,
    circleId: CIRCLE_ID,
    threadId: THREAD_ID,
    sourceUserMessageId: SOURCE_MESSAGE_ID,
    toolName: 'rooms.rename',
    toolApprovalDigest: digest(input.digestCharacter),
    sourceToolUseId: `source-call:${input.approvalId}`,
    sourceIteration: 1,
    sourceCallOrdinal: input.ordinal,
    args: { roomId: `room-${input.ordinal}`, name: `Renamed ${input.ordinal}` },
    expiresAtMs: NOW_MS + 300_000,
  }, NOW_MS), `registered exact call ${input.ordinal}`);
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source end marker: ${endMarker}`);
  return source.slice(start, end);
}

function checkOrdered(source: string, markers: readonly string[], message: string): void {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${marker}`);
    assert.ok(next > cursor, `${message}: ${marker} is out of order`);
    cursor = next;
  }
  checks += 1;
}

async function custodyStopBeforeDispatch(): Promise<void> {
  const approvalId = '50000000-0000-4000-8000-000000000011';
  registerCall({ approvalId, digestCharacter: 'a', ordinal: 1 });
  const controller = new AbortController();
  let acceptCount = 0;
  let dispatchCount = 0;

  const result = await executeOpenSwanApprovalResumeExactCalls({
    binding: buildBinding([{
      approvalId,
      toolName: 'rooms.rename',
      toolApprovalDigest: digest('a'),
    }]),
    currentRunId: CURRENT_RUN,
    sourceUserMessageId: SOURCE_MESSAGE_ID,
    nowMs: NOW_MS + 1,
    signal: controller.signal,
    accept: (summary) => {
      acceptCount += 1;
      equal(summary.runId, CURRENT_RUN, 'custody acceptance is bound to the continuation run');
      equal([...summary.approvalIds], [approvalId], 'custody acceptance names the exact approval set');
      controller.abort();
    },
    dispatch: async () => {
      dispatchCount += 1;
      return { status: 'passed' as const, value: 'unexpected' };
    },
  });

  equal(acceptCount, 1, 'runtime custody is accepted once');
  equal(dispatchCount, 0, 'STOP in the custody callback prevents first dispatch');
  check(result.cancelled, 'custody-window STOP sets the execution cancellation bit');
  equal(result.disposition.state, 'incomplete', 'custody-window STOP is incomplete');
  equal(result.disposition.items[0]?.state, 'blocked', 'undispatched exact call is blocked');
  equal(result.executions.length, 0, 'custody-window STOP produces no execution value');
  check(
    !inspectOpenSwanApprovalResumeExactCallLease(approvalId, NOW_MS + 1).present,
    'accepted runtime custody consumes the process lease even when STOP wins before dispatch',
  );
}

async function stopDuringAwaitedDispatch(): Promise<void> {
  const firstApprovalId = '50000000-0000-4000-8000-000000000012';
  const secondApprovalId = '50000000-0000-4000-8000-000000000013';
  registerCall({ approvalId: firstApprovalId, digestCharacter: 'b', ordinal: 1 });
  registerCall({ approvalId: secondApprovalId, digestCharacter: 'c', ordinal: 2 });

  const controller = new AbortController();
  const dispatchEntered = deferred<void>();
  const releaseDispatch = deferred<void>();
  const dispatchedApprovals: string[] = [];

  const executionPromise = executeOpenSwanApprovalResumeExactCalls({
    binding: buildBinding([
      {
        approvalId: firstApprovalId,
        toolName: 'rooms.rename',
        toolApprovalDigest: digest('b'),
      },
      {
        approvalId: secondApprovalId,
        toolName: 'rooms.rename',
        toolApprovalDigest: digest('c'),
      },
    ]),
    currentRunId: CURRENT_RUN,
    sourceUserMessageId: SOURCE_MESSAGE_ID,
    nowMs: NOW_MS + 2,
    signal: controller.signal,
    dispatch: async (call) => {
      dispatchedApprovals.push(call.approvalId);
      dispatchEntered.resolve();
      await releaseDispatch.promise;
      return { status: 'passed' as const, value: call.approvalId };
    },
  });

  await dispatchEntered.promise;
  controller.abort();
  releaseDispatch.resolve();
  const result = await executionPromise;

  equal(dispatchedApprovals, [firstApprovalId], 'STOP during an awaited dispatch prevents the later call from entering');
  check(result.cancelled, 'STOP observed after the awaited dispatch sets cancellation truth');
  equal(result.disposition.state, 'incomplete', 'mid-dispatch STOP cannot report the whole batch satisfied');
  equal(result.disposition.items.map((item) => item.state), ['satisfied', 'blocked'], 'settled first result is retained while the later call stays blocked');
  equal(result.executions, [firstApprovalId], 'only the already-settled dispatch value is returned');
}

function legacyAndSessionCancellationContracts(): void {
  const legacy = buildLegacyToolLoopResult({
    runResult: {
      text: 'partial work',
      messages: [],
      iterations: 1,
      stopReason: 'tool_use',
      hitMaxIterations: false,
      aborted: true,
    },
    toolEvents: [{
      tool: 'rooms.rename',
      toolUseId: 'approval-resume:test',
      providerIteration: 1,
      input: {},
      result: 'partial result',
      status: 'passed',
    }],
    maxRounds: 4,
  });
  check(legacy.incomplete === true, 'generic legacy adapter maps an abort to incomplete');
  equal(legacy.incompleteReason, 'cancelled', 'generic legacy adapter labels an abort as cancelled');
  check(legacy.response.includes('Stopped at your request'), 'generic legacy adapter returns honest STOP copy');

  const sessionSource = readFileSync('src/lib/openswanSessionRuntime.ts', 'utf8');
  const boundResume = section(
    sessionSource,
    'async function runBoundOpenSwanApprovalResume',
    'async function runTypedCoreToolLoop',
  );
  checkOrdered(boundResume, [
    'const execution = await executeOpenSwanApprovalResumeExactCalls',
    '...(execution.cancelled',
    'cancelled: true',
    'incomplete: true',
    "incompleteReason: 'cancelled'",
  ], 'bound approval continuation maps exact execution cancellation into LegacyToolLoopResult');
  checkOrdered(sessionSource, [
    'toolLoopResult = opts.approvalResumeBinding != null',
    'signal: opts.signal',
    'turnCancelled = toolLoopResult.cancelled === true',
    'turnIncomplete = toolLoopResult.incomplete === true',
  ], 'session consumes bound continuation cancellation before terminal finalization');
}

function finalEntryFenceContracts(): void {
  const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
  const browserSource = readFileSync('src/lib/browserBridge.ts', 'utf8');

  const durableDispatch = section(
    runtimeSource,
    'async function dispatchDurableComputerAppMutation',
    'async function executeGuardedBrowserOpenUrl',
  );
  check(
    durableDispatch.includes('shouldEnterHandler: () => !isOpenSwanApprovalResumeStopped(input.context)'),
    'shared durable dispatcher refuses handler entry when the continuation is already stopped',
  );
  checkOrdered(durableDispatch, [
    'const started = await lease.store.start',
    'if (isOpenSwanApprovalResumeStopped(input.context))',
    'return input.handler(sealedArgs)',
  ], 'shared durable dispatcher rechecks STOP after awaited durable start and before every app handler');

  const browserOpen = section(
    runtimeSource,
    'async function executeGuardedBrowserOpenUrl',
    'async function executeGuardedBrowserFill',
  );
  checkOrdered(browserOpen, [
    'const entryBinding = await bindOpenSwanBrowserOpenUrlHealth',
    'if (isOpenSwanApprovalResumeStopped(context))',
    'const opened = await openUrl',
  ], 'browser navigation rechecks STOP after final health read and before navigation');

  const guardedBrowserHandlers = [
    section(runtimeSource, 'async function executeGuardedBrowserFill', 'async function executeGuardedBrowserToggle'),
    section(runtimeSource, 'async function executeGuardedBrowserToggle', 'async function executeGuardedBrowserSelect'),
    section(runtimeSource, 'async function executeGuardedBrowserSelect', 'function hasExactOpenSwanRuntimeCallIdentity'),
  ];
  for (const [index, handler] of guardedBrowserHandlers.entries()) {
    check(
      handler.includes('shouldContinue: () => !isOpenSwanApprovalResumeStopped(context)'),
      `guarded browser mutator ${index + 1} threads runtime-private STOP authority to its bridge client`,
    );
  }

  const browserClientContracts = [
    {
      body: section(browserSource, 'export async function setGuardedBrowserToggleState', 'export async function observeGuardedBrowserSelectTarget'),
      gate: 'const gate = await preMutationVerificationGate<BrowserToggleProof>',
      mutation: "const raw = await callBrowser<BrowserToggleProof>('POST', '/browser/set_toggle'",
      label: 'browser toggle',
    },
    {
      body: section(browserSource, 'export async function setGuardedBrowserSelectOption', 'export async function observeGuardedNonSecretFillTarget'),
      gate: 'const gate = await preMutationVerificationGate<BrowserSelectProof>',
      mutation: "const raw = await callBrowser<BrowserSelectProof>('POST', '/browser/select'",
      label: 'browser select',
    },
    {
      body: section(browserSource, 'export async function fillGuardedNonSecretField', 'export async function uploadFile'),
      gate: 'const gate = await preMutationVerificationGate<BrowserFillProof>',
      mutation: "const raw = await callBrowser<BrowserFillProof>('POST', '/browser/fill'",
      label: 'browser fill',
    },
  ] as const;
  for (const contract of browserClientContracts) {
    checkOrdered(contract.body, [
      contract.gate,
      'if (args.shouldContinue && args.shouldContinue() !== true)',
      contract.mutation,
    ], `${contract.label} checks STOP after its last awaited read and before bridge mutation`);
  }

  const genericNative = section(
    runtimeSource,
    'async function executeGuardedGenericNativeUiMutation',
    'export async function executeOpenSwanRuntimeTool',
  );
  checkOrdered(genericNative, [
    'const freshTarget = await prepared.observationDeps.captureFreshTargetGuard()',
    'if (isOpenSwanApprovalResumeStopped(context))',
    'return dispatchGenericNativeUiBridgeMutation',
  ], 'generic native UI rechecks STOP after final exact-target read and before bridge mutation');

  const runtimeEntryStart = runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool');
  assert.notEqual(runtimeEntryStart, -1, 'missing OpenSwan runtime chokepoint');
  const runtimeEntry = runtimeSource.slice(runtimeEntryStart);
  checkOrdered(runtimeEntry, [
    'const approvalResumeWasStopped = ()',
    'if (approvalResumeWasStopped()) return stoppedApprovalResumeResult()',
    'const initialDispatchPolicy = getOpenSwanToolPolicy',
  ], 'runtime chokepoint rejects a stopped continuation before tool preparation or approval work');
}

async function main(): Promise<void> {
  deleteOpenSwanApprovalResumeExactCallLeases();
  try {
    await custodyStopBeforeDispatch();
    await stopDuringAwaitedDispatch();
    legacyAndSessionCancellationContracts();
    finalEntryFenceContracts();
  } finally {
    deleteOpenSwanApprovalResumeExactCallLeases();
  }
  console.log(`openswan approval resume STOP-race smoke passed (${checks} checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
