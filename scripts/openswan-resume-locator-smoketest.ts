/**
 * OpenSwan exact-resume locator smoke.
 *
 * A persisted Continue chip is an address, not a new natural-language turn.
 * This suite proves that the address resolves only the checkpoint owned by the
 * message that rendered the chip, fails closed across identity/transcript
 * boundaries, and is synchronously single-claimed before dispatch.
 *
 * Run:
 *   npx tsx scripts/openswan-resume-locator-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createOpenSwanResumeClaimGate,
  projectOpenSwanResumeLocator,
  resolveOpenSwanResumeLocator,
  type OpenSwanResumeLocator,
} from '../src/lib/toolLoopResume';
import type { ToolLoopCheckpoint } from '../src/lib/toolLoopProgress';

const root = process.cwd();
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');
const runtimePath = resolve(root, 'src/lib/openswanSessionRuntime.ts');
const persistedPath = resolve(root, 'src/lib/persistedChatMetadata.ts');
const messageTypesPath = resolve(root, 'src/lib/chatMessageTypes.ts');

const chat = readFileSync(chatPath, 'utf8');
const runtime = readFileSync(runtimePath, 'utf8');
const persisted = readFileSync(persistedPath, 'utf8');
const messageTypes = readFileSync(messageTypesPath, 'utf8');

const checkpointA: ToolLoopCheckpoint = {
  schemaVersion: 1,
  stepCount: 2,
  maxRounds: 4,
  completedSteps: [{ tool: 'desktop.observe_app', ok: true }],
  lastObservation: { tool: 'desktop.observe_app', summary: 'Observed document A.' },
  lastFailure: { tool: 'desktop.click_element', ok: false, reason: 'A stopped.' },
  resumeHint: 'Resume only task A.',
};

const checkpointB: ToolLoopCheckpoint = {
  schemaVersion: 1,
  stepCount: 5,
  maxRounds: 6,
  completedSteps: [{ tool: 'browser.dom_snapshot', ok: true }],
  lastObservation: { tool: 'browser.dom_snapshot', summary: 'Observed page B.' },
  lastFailure: { tool: 'browser.click_role', ok: false, reason: 'B stopped.' },
  resumeHint: 'Resume only task B.',
};

const locatorA: OpenSwanResumeLocator = {
  version: 1,
  eventId: 'checkpoint-event-a',
  circleId: 'circle-a',
  userId: 'user-a',
  threadId: 'thread-a',
  runId: 'run-a',
  messageId: 'assistant-message-a',
};

const locatorB: OpenSwanResumeLocator = {
  version: 1,
  eventId: 'checkpoint-event-b',
  circleId: 'circle-a',
  userId: 'user-a',
  threadId: 'thread-a',
  runId: 'run-b',
  messageId: 'assistant-message-b',
};

const partialTerminal = {
  state: 'partial',
  reason: 'step_cap',
  completionVerified: false,
  resumable: true,
};

const succeededTerminal = {
  state: 'succeeded',
  reason: 'clean_end_turn',
  completionVerified: true,
  resumable: false,
};

function checkpointEvent(locator: OpenSwanResumeLocator, checkpoint: ToolLoopCheckpoint) {
  return {
    id: locator.eventId,
    at: locator.runId === 'run-a' ? '2026-08-12T12:00:00.000Z' : '2026-08-12T12:05:00.000Z',
    kind: 'tool_activity',
    title: 'Tool-step limit reached',
    data: {
      checkpoint,
      resumeLocator: locator,
      runId: locator.runId,
      messageId: locator.messageId,
    },
  };
}

function finalEvent(
  locator: OpenSwanResumeLocator,
  terminal: typeof partialTerminal | typeof succeededTerminal,
  at: string,
) {
  return {
    id: `final-${locator.runId}`,
    at,
    kind: 'run_finalized',
    title: terminal.state === 'succeeded' ? 'Run completed' : 'Run stopped at step cap',
    data: {
      runId: locator.runId,
      messageId: locator.messageId,
      terminal,
      resumeLocator: locator,
    },
  };
}

function turnBoundaryEvents(locator: OpenSwanResumeLocator, atPrefix: string) {
  return [
    {
      id: `session-${locator.runId}`,
      at: `${atPrefix}:00.000Z`,
      kind: 'session_started',
      title: 'OpenSwan session started',
      data: { runId: locator.runId, messageId: locator.messageId },
    },
    {
      id: `user-${locator.runId}`,
      at: `${atPrefix}:01.000Z`,
      kind: 'user_turn',
      title: 'User request received',
      data: { runId: locator.runId, messageId: locator.messageId },
    },
  ];
}

function transcript(events: Array<Record<string, unknown>>) {
  return {
    key: 'chat:thread-a',
    runId: 'run-b',
    chatSessionId: 'thread-a',
    circleId: 'circle-a',
    userId: 'user-a',
    surface: 'main_chat',
    createdAt: '2026-08-12T11:59:00.000Z',
    updatedAt: '2026-08-12T12:06:00.000Z',
    events,
  };
}

const scopeA = {
  circleId: 'circle-a',
  userId: 'user-a',
  threadId: 'thread-a',
  runId: 'run-a',
  messageId: 'assistant-message-a',
};

function assertMatchedCheckpoint(
  result: ReturnType<typeof resolveOpenSwanResumeLocator>,
  expected: ToolLoopCheckpoint,
  label: string,
): void {
  assert.equal(result.status, 'matched', `${label}: exact locator matches`);
  if (result.status !== 'matched') return;
  assert.deepEqual(result.checkpoint, expected, `${label}: exact checkpoint returned`);
}

// Once B begins, the older A chip is unavailable. It must never silently
// retarget to B; only B's own exact chip may resolve. Supporting multiple
// paused mutation branches would require isolated per-run transcripts.
const twoHistoricalStops = transcript([
  ...turnBoundaryEvents(locatorA, '2026-08-12T12:00'),
  checkpointEvent(locatorA, checkpointA),
  finalEvent(locatorA, partialTerminal, '2026-08-12T12:01:00.000Z'),
  ...turnBoundaryEvents(locatorB, '2026-08-12T12:05'),
  checkpointEvent(locatorB, checkpointB),
  finalEvent(locatorB, partialTerminal, '2026-08-12T12:06:00.000Z'),
]);
const staleAAfterB = resolveOpenSwanResumeLocator({
  locator: locatorA,
  scope: scopeA,
  transcript: twoHistoricalStops,
});
assert.equal(staleAAfterB.status, 'unavailable', 'historical A is unavailable after newer B begins');
if (staleAAfterB.status === 'matched') {
  assert.notDeepEqual(staleAAfterB.checkpoint, checkpointB, 'stale A never retargets to newer B');
}
assertMatchedCheckpoint(resolveOpenSwanResumeLocator({
  locator: locatorB,
  scope: { ...scopeA, runId: 'run-b', messageId: 'assistant-message-b' },
  transcript: twoHistoricalStops,
}), checkpointB, 'newer B');

// A later verified completion closes the older address. It must not resurrect
// A merely because the old checkpoint event remains in the bounded transcript.
const completedLater = resolveOpenSwanResumeLocator({
  locator: locatorA,
  scope: scopeA,
  transcript: transcript([
    ...turnBoundaryEvents(locatorA, '2026-08-12T12:00'),
    checkpointEvent(locatorA, checkpointA),
    finalEvent(locatorA, partialTerminal, '2026-08-12T12:01:00.000Z'),
    ...turnBoundaryEvents(
      { ...locatorA, runId: 'run-c', messageId: 'assistant-message-c' },
      '2026-08-12T12:09',
    ),
    {
      ...finalEvent(
        { ...locatorA, runId: 'run-c', messageId: 'assistant-message-c' },
        succeededTerminal,
        '2026-08-12T12:10:00.000Z',
      ),
      id: 'final-run-c',
    },
  ]),
});
assert.equal(completedLater.status, 'unavailable', 'a later completed turn closes an older checkpoint');

// Cross-device/local-storage loss is a normal unavailable state, never a scan
// for some other checkpoint and never an invitation to send a model turn.
assert.equal(resolveOpenSwanResumeLocator({
  locator: locatorA,
  scope: scopeA,
  transcript: null,
}).status, 'unavailable', 'missing local transcript fails closed');
assert.equal(resolveOpenSwanResumeLocator({
  locator: locatorA,
  scope: scopeA,
  transcript: transcript([checkpointEvent(locatorB, checkpointB)]),
}).status, 'unavailable', 'missing exact checkpoint event fails closed');

// Every supplied identity field is binding. None may be treated as a display
// hint or repaired by latest-message/latest-run lookup.
for (const [field, badValue] of [
  ['circleId', 'circle-b'],
  ['userId', 'user-b'],
  ['threadId', 'thread-b'],
  ['runId', 'run-b'],
  ['messageId', 'assistant-message-b'],
] as const) {
  const result = resolveOpenSwanResumeLocator({
    locator: locatorA,
    scope: { ...scopeA, [field]: badValue },
    transcript: twoHistoricalStops,
  });
  assert.equal(result.status, 'mismatch', `wrong ${field} fails as a scope mismatch`);
}

// Persistence may replace the visual row key with a database UUID. The
// locator is intentionally bound to metadata.localMessageId, the immutable
// pending-message id that the runtime received. Hydrating the exact row keeps
// that identity; copying the locator onto another local message fails.
assertMatchedCheckpoint(resolveOpenSwanResumeLocator({
  locator: locatorA,
  scope: {
    ...scopeA,
    messageId: 'assistant-message-a', // metadata.localMessageId after reload
  },
  transcript: transcript([
    ...turnBoundaryEvents(locatorA, '2026-08-12T12:00'),
    checkpointEvent(locatorA, checkpointA),
    finalEvent(locatorA, partialTerminal, '2026-08-12T12:01:00.000Z'),
  ]),
}), checkpointA, 'reloaded DB row with canonical localMessageId');
assert.equal(resolveOpenSwanResumeLocator({
  locator: locatorA,
  scope: { ...scopeA, messageId: 'copied-local-message' },
  transcript: twoHistoricalStops,
}).status, 'mismatch', 'copied locator on another local message fails closed');

// The persisted boundary is enum/id-only and rejects malformed or oversized
// addresses. A checkpoint payload must never survive projection.
assert.deepEqual(projectOpenSwanResumeLocator(locatorA), locatorA, 'exact bounded locator projects');
for (const malformed of [
  null,
  '',
  {},
  { ...locatorA, version: 2 },
  { ...locatorA, eventId: '' },
  { ...locatorA, eventId: 'x'.repeat(1000) },
  { ...locatorA, circleId: 'x'.repeat(1000) },
  { ...locatorA, userId: 'x'.repeat(1000) },
  { ...locatorA, threadId: 'x'.repeat(1000) },
  { ...locatorA, runId: 'x'.repeat(1000) },
  { ...locatorA, messageId: 'x'.repeat(1000) },
  { ...locatorA, eventId: 'checkpoint\nevent' },
] as const) {
  assert.equal(projectOpenSwanResumeLocator(malformed), null, `malformed locator rejected: ${JSON.stringify(malformed).slice(0, 120)}`);
}
const projectedWithHostilePayload = projectOpenSwanResumeLocator({
  ...locatorA,
  checkpoint: checkpointA,
  resumeHint: checkpointA.resumeHint,
  secret: 'do-not-persist',
});
assert.deepEqual(projectedWithHostilePayload, locatorA, 'projection drops unknown and checkpoint fields');
assert(!JSON.stringify(projectedWithHostilePayload).includes('Resume only task A'), 'projected locator contains no checkpoint payload');

// The claim is synchronous: the first click owns dispatch before its first
// await; a same-tick second click sees claimed and cannot invoke anything.
const claimGate = createOpenSwanResumeClaimGate();
let dispatchCount = 0;
const firstClaim = claimGate.claim(locatorA);
if (firstClaim === 'claimed') dispatchCount += 1;
const secondClaim = claimGate.claim(locatorA);
if (secondClaim === 'claimed') dispatchCount += 1;
assert.equal(firstClaim, 'claimed', 'first exact click wins the claim');
assert.equal(secondClaim, 'already_claimed', 'synchronous second click sees the existing claim');
assert.equal(dispatchCount, 1, 'double click can dispatch exactly once');

// Source integration pins: a bound Continue is handled with its originating
// message/locator before the generic prose quick-reply path; the persisted
// shape has no checkpoint; and an explicit runtime locator cannot enter the
// legacy latest-checkpoint scan when resolution is unavailable.
assert.match(messageTypes, /openSwanResumeLocator/, 'Chat message carries the bounded resume locator');
assert.match(persisted, /openSwanResumeLocator/, 'persisted Chat metadata carries the bounded resume locator');
assert.match(persisted, /projectOpenSwanResumeLocator/, 'persistence uses the strict locator projector');
assert.match(
  persisted,
  /localMessageId[\s\S]{0,2400}openSwanResumeLocator|openSwanResumeLocator[\s\S]{0,2400}localMessageId/,
  'persisted metadata keeps canonical localMessageId beside the resume locator',
);
assert.match(
  persisted,
  /openSwanResumeLocator\??:\s*OpenSwanResumeLocator\s*\|\s*null/,
  'persisted locator field uses the bounded value-free locator type',
);
const persistedLocatorProjectorStart = persisted.indexOf('export function projectPersistedOpenSwanResumeLocator');
assert(persistedLocatorProjectorStart >= 0, 'persisted locator projector exists');
const persistedLocatorProjector = persisted.slice(persistedLocatorProjectorStart, persistedLocatorProjectorStart + 500);
assert.match(persistedLocatorProjector, /projectOpenSwanResumeLocator\(locator\)/, 'persisted locator reuses strict projection');
assert.doesNotMatch(persistedLocatorProjector, /checkpoint|resumeHint|secret/, 'persisted locator projector never copies checkpoint content');

const quickReplySectionStart = chat.indexOf('<QuickReplyChips');
assert(quickReplySectionStart >= 0, 'Chat quick-reply renderer exists');
const quickReplySection = chat.slice(quickReplySectionStart, quickReplySectionStart + 2400);
assert.match(quickReplySection, /openSwanResumeLocator/, 'bound Continue inspects the originating message locator');
assert.match(quickReplySection, /handleOpenSwanResume/, 'bound Continue uses the dedicated resume handler');
assert.match(
  quickReplySection,
  /localMessageId|item\.id/,
  'bound Continue passes the originating canonical message identity',
);
assert.match(
  quickReplySection,
  /handleOpenSwanResume[\s\S]*return;[\s\S]*sendMessage\(reply\)/,
  'bound Continue returns before the generic sendMessage(reply) path',
);
assert.match(
  chat,
  /claim\([^)]+\)\s*!==\s*['"]claimed['"]|claim\([^)]+\)\s*===\s*['"]already_claimed['"]/,
  'Chat synchronously claims the exact locator before dispatch',
);
assert.match(
  chat,
  /setOpenSwanResumeAvailability\([\s\S]{0,800}\[message\.id\]\s*:\s*false|\[message\.id\]\s*=\s*false/,
  'the handler marks the originating message unavailable synchronously',
);
assert.match(
  chat,
  /isClaimed\(locator\)/,
  'async availability reconciliation excludes already-claimed locators',
);
const resumeAvailabilityEffectStart = chat.indexOf('openSwanResumeClaimGateRef.current.clear()');
assert(resumeAvailabilityEffectStart >= 0, 'resume claim gate has a scope-reset effect');
const resumeAvailabilityEffect = chat.slice(resumeAvailabilityEffectStart, resumeAvailabilityEffectStart + 3600);
const resumeAvailabilityDeps = resumeAvailabilityEffect.match(/\},\s*\[([^\]]*)\]\);/s)?.[1] || '';
assert(!/\bmessages\b/.test(resumeAvailabilityDeps), 'message changes cannot clear and reopen a claimed locator');
assert(/activeThreadId|circleId|currentUserId/.test(resumeAvailabilityDeps), 'claim reset is bound to chat scope identity');

const structuredSnapshotStart = chat.indexOf('const structuredMessageSnapshot: ChatMessage = {');
assert(structuredSnapshotStart >= 0, 'structured OpenSwan snapshot exists');
const structuredSnapshot = chat.slice(structuredSnapshotStart, structuredSnapshotStart + 4200);
assert.match(structuredSnapshot, /openSwanResumeLocator/, 'structured snapshot carries the runtime locator');
assert.doesNotMatch(
  structuredSnapshot,
  /quickReplies:\s*structured\.terminal\.resumable[\s\S]{0,300}\['Continue'\]/,
  'locator-backed terminal does not also create a generic Continue quick reply',
);
assert.match(
  chat,
  /openSwanTerminal\?\.resumable[\s\S]{0,300}openSwanResumeLocator|openSwanResumeLocator[\s\S]{0,300}openSwanTerminal\?\.resumable/,
  'a persisted terminal renders Continue only when an exact locator is present',
);

assert.match(runtime, /resumeLocator\??:/, 'runtime accepts an explicit resume locator');
const explicitResumeStart = runtime.indexOf('opts.resumeLocator');
assert(explicitResumeStart >= 0, 'runtime branches on the explicit locator');
const explicitResumeSection = runtime.slice(explicitResumeStart, explicitResumeStart + 3600);
assert.match(explicitResumeSection, /resolveOpenSwanResumeLocator/, 'runtime resolves the exact supplied locator');
assert.match(
  explicitResumeSection,
  /status\s*!==\s*['"]matched['"][\s\S]*(?:return|throw)/,
  'unavailable or mismatched locator returns before model/tool execution',
);
assert.match(
  runtime,
  /const resumeCheckpoint = hasExplicitResumeLocator\s*\? explicitResumeCheckpoint\s*:\s*findPendingResumeCheckpoint\(transcript\.events\)/,
  'latest-checkpoint scanning is reachable only when no explicit locator was supplied',
);

const runtimeTurnStart = runtime.indexOf('export async function runOpenSwanSessionTurn');
assert(runtimeTurnStart >= 0, 'OpenSwan turn entrypoint exists');
const runtimeTurn = runtime.slice(runtimeTurnStart);
const exactResolveIndex = runtimeTurn.indexOf('resolveOpenSwanResumeLocator({');
const transcriptHeaderWriteIndex = runtimeTurn.indexOf('await upsertOpenSwanTranscriptHeader({');
const sessionStartedAppendIndex = runtimeTurn.indexOf("kind: 'session_started'");
const userTurnAppendIndex = runtimeTurn.indexOf("kind: 'user_turn'");
assert(exactResolveIndex >= 0, 'turn entrypoint resolves an explicit source locator');
assert(transcriptHeaderWriteIndex >= 0, 'turn entrypoint writes its current-run transcript header');
assert(sessionStartedAppendIndex >= 0 && userTurnAppendIndex >= 0, 'turn entrypoint appends current continuation events');
assert(
  exactResolveIndex < transcriptHeaderWriteIndex,
  'source locator resolves before the new run overwrites the thread transcript header',
);
assert(
  exactResolveIndex < sessionStartedAppendIndex && exactResolveIndex < userTurnAppendIndex,
  'source locator resolves before current continuation events are appended',
);
for (const dispatchMarker of [
  'await delegateToSubagents(',
  'await buildOpenSwanMemoryStores({',
  'await runTextOnlyResponse()',
  'await runTypedCoreToolLoop({',
] as const) {
  const dispatchIndex = runtimeTurn.indexOf(dispatchMarker);
  assert(dispatchIndex > exactResolveIndex, `exact resolution precedes ${dispatchMarker}`);
}

console.log('All OpenSwan resume locator smoke cases passed.');
