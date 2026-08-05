import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import {
  buildLegacyPersistedChatFallback,
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
} from '../src/lib/persistedChatMetadata';
import {
  applyChatDesignTaskTimelineDisposition,
  buildChatDesignTaskCardModel,
  classifyChatDesignTaskTimeline,
  findSupersededChatDesignTaskMessageIds,
  supersedeChatDesignTaskCardModel,
  type ChatDesignTaskTimelineMessage,
} from '../src/lib/chatDesignTaskCard';

function photoshopBlankDocumentHandoff(
  size: string,
  outcomeStatus: 'waiting_approval' | 'completed' | 'blocked',
  runId: string,
) {
  return buildChatComputerHandoffContext({
    task: `Open Photoshop and start a new project ${size}`,
    entrypoint: 'agent_runtime',
    adapterId: 'desktop_app_adapter',
    taskKind: 'app_task',
    taskLabel: `Photoshop new ${size.replace(/\s+/g, '')} document exact program`,
    runId,
    outcomeStatus,
    preflightStatus: 'ready',
    groundingStatus: outcomeStatus === 'completed' ? 'completed' : 'needs_observation',
    groundingSummary: outcomeStatus === 'completed'
      ? `Final Photoshop document status verified ${size}.`
      : 'Observe photoshop-document-status.',
    approvalSummary: outcomeStatus === 'waiting_approval'
      ? 'Approve the exact blank-document program before dispatch.'
      : null,
    blockers: outcomeStatus === 'blocked' ? ['Photoshop is not scriptable.'] : [],
  }).metadata;
}

const waitingRunA = photoshopBlankDocumentHandoff('600 x 600', 'waiting_approval', 'run-a');
const waitingSharedRun = photoshopBlankDocumentHandoff('600 x 600', 'waiting_approval', 'shared-run');
const completedRunB = photoshopBlankDocumentHandoff('600 x 600', 'completed', 'run-b');
const completedSharedRun = photoshopBlankDocumentHandoff('600 x 600', 'completed', 'shared-run');
const blockedRun = photoshopBlankDocumentHandoff('600 x 600', 'blocked', 'blocked-run');

const sameRunTimeline: ChatDesignTaskTimelineMessage[] = [
  {
    id: 'same-run-request',
    isBot: false,
    isUser: true,
    authorId: 'user-a',
    content: 'Open Photoshop and start a new project 600 x 600',
  },
  {
    id: 'same-run-waiting',
    isBot: true,
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingSharedRun,
    runId: 'shared-run',
  },
  {
    id: 'same-run-completion',
    isBot: true,
    computerTaskStatus: 'completed',
    computerHandoff: completedSharedRun,
    runId: 'shared-run',
  },
];

const sameRunDisposition = classifyChatDesignTaskTimeline(sameRunTimeline);
assert.equal(
  sameRunDisposition.get('same-run-waiting'),
  'superseded',
  'the same exact immutable run id supersedes its older actionable card',
);
assert.equal(sameRunDisposition.get('same-run-completion'), 'current');
assert.deepEqual(
  [...findSupersededChatDesignTaskMessageIds(sameRunTimeline)],
  ['same-run-waiting'],
  'the compatibility projection includes exact supersession only',
);

const sameRequestLineage = classifyChatDesignTaskTimeline([
  {
    id: 'request-lineage-id',
    isBot: false,
    isUser: true,
    content: 'Open Photoshop and start a new project 600 x 600',
  },
  {
    id: 'request-lineage-waiting',
    isBot: true,
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingRunA,
    runId: 'run-a',
  },
  {
    id: 'request-lineage-completion',
    isBot: true,
    computerTaskStatus: 'completed',
    computerHandoff: completedRunB,
    runId: 'run-b',
  },
]);
assert.equal(
  sameRequestLineage.get('request-lineage-waiting'),
  'current',
  'a shared human turn cannot conflate two distinct task run ids',
);

const explicitRequestLineage = classifyChatDesignTaskTimeline([
  {
    id: 'multi-task-user-turn',
    isBot: false,
    isUser: true,
    content: 'Prepare both app tasks',
  },
  {
    id: 'request-id-waiting',
    isBot: true,
    requestId: 'request-lineage-1',
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingRunA,
  },
  {
    id: 'request-id-completion',
    isBot: true,
    requestId: 'request-lineage-1',
    computerTaskStatus: 'completed',
    computerHandoff: completedRunB,
  },
]);
assert.equal(
  explicitRequestLineage.get('request-id-waiting'),
  'superseded',
  'an explicit immutable request id preserves lineage when a continuation creates a new run id',
);

const repeatedWordsDifferentTurn = classifyChatDesignTaskTimeline([
  {
    id: 'first-identical-request',
    isBot: false,
    isUser: true,
    authorId: 'user-a',
    content: 'Open Photoshop and start a new project 600 x 600',
  },
  {
    id: 'first-identical-waiting',
    isBot: true,
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingRunA,
    runId: 'run-a',
  },
  {
    id: 'second-identical-request',
    isBot: false,
    isUser: true,
    authorId: 'user-a',
    content: 'Open Photoshop and start a new project 600 x 600',
  },
  {
    id: 'second-identical-completion',
    isBot: true,
    computerTaskStatus: 'completed',
    computerHandoff: completedRunB,
    runId: 'run-b',
  },
]);
assert.equal(
  repeatedWordsDifferentTurn.get('first-identical-waiting'),
  'historical',
  'identical prompt wording from a separate human turn is historical, never exact-superseded',
);

const otherMemberTurn = classifyChatDesignTaskTimeline([
  {
    id: 'owner-request',
    isBot: false,
    isUser: true,
    authorId: 'member-a',
    content: 'Prepare a Photoshop task',
  },
  {
    id: 'owner-waiting',
    isBot: true,
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingRunA,
  },
  {
    id: 'other-member-request',
    isBot: false,
    isUser: false,
    authorId: 'member-b',
    content: 'Start a different task for the circle',
  },
]);
assert.equal(
  otherMemberTurn.get('owner-waiting'),
  'current',
  'another circle member cannot deactivate the first member\'s pending task',
);

const sameOtherMemberTurn = classifyChatDesignTaskTimeline([
  {
    id: 'member-a-request',
    isBot: false,
    isUser: false,
    authorId: 'member-a',
    content: 'Prepare a Photoshop task',
  },
  {
    id: 'member-a-waiting',
    isBot: true,
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingRunA,
  },
  {
    id: 'member-a-new-turn',
    isBot: false,
    isUser: false,
    authorId: 'member-a',
    content: 'Move on to my next task',
  },
]);
assert.equal(
  sameOtherMemberTurn.get('member-a-waiting'),
  'historical',
  'stable author identity works even when the current viewer did not author either turn',
);

const interleavedSharedThread = classifyChatDesignTaskTimeline([
  {
    id: 'interleaved-a-request',
    isBot: false,
    authorId: 'member-a',
    content: 'Prepare my Photoshop task',
  },
  {
    id: 'interleaved-b-request',
    isBot: false,
    authorId: 'member-b',
    content: 'Prepare a separate browser task',
  },
  {
    id: 'interleaved-a-plan',
    isBot: true,
    requestAuthorId: 'member-a',
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingRunA,
  },
  {
    id: 'interleaved-b-next-turn',
    isBot: false,
    authorId: 'member-b',
    content: 'Continue my browser task',
  },
]);
assert.equal(
  interleavedSharedThread.get('interleaved-a-plan'),
  'current',
  'durable requester lineage prevents another member from aging an interleaved plan',
);

const interleavedOwnerMovesOn = classifyChatDesignTaskTimeline([
  ...Array.from([
    { id: 'interleaved-a-request', isBot: false, authorId: 'member-a' },
    { id: 'interleaved-b-request', isBot: false, authorId: 'member-b' },
    {
      id: 'interleaved-a-plan',
      isBot: true,
      requestAuthorId: 'member-a',
      computerTaskStatus: 'waiting_approval',
      computerHandoff: waitingRunA,
    },
  ] satisfies ChatDesignTaskTimelineMessage[]),
  { id: 'interleaved-a-next-turn', isBot: false, authorId: 'member-a' },
]);
assert.equal(
  interleavedOwnerMovesOn.get('interleaved-a-plan'),
  'historical',
  'the actual requester can still age their interleaved plan',
);

const ambiguousLegacySharedThread = classifyChatDesignTaskTimeline([
  { id: 'legacy-a-request', isBot: false, authorId: 'member-a' },
  { id: 'legacy-b-request', isBot: false, authorId: 'member-b' },
  {
    id: 'ambiguous-legacy-plan',
    isBot: true,
    content: 'Ready for review. Approve desktop run with the app-native tool.',
  },
  { id: 'legacy-b-next-turn', isBot: false, authorId: 'member-b' },
]);
assert.equal(
  ambiguousLegacySharedThread.get('ambiguous-legacy-plan'),
  'current',
  'metadata-free shared-thread ownership fails open instead of disabling the wrong member task',
);

const proseOnly = classifyChatDesignTaskTimeline([
  sameRunTimeline[0],
  sameRunTimeline[1],
  {
    id: 'prose-only',
    isBot: true,
    content: 'Done - Photoshop is open and the document was created.',
    computerHandoff: completedSharedRun,
  },
]);
assert.equal(
  proseOnly.get('same-run-waiting'),
  'current',
  'success prose without structured terminal status cannot supersede a card',
);

const statusOnly = classifyChatDesignTaskTimeline([
  sameRunTimeline[0],
  sameRunTimeline[1],
  {
    id: 'status-only',
    isBot: true,
    computerTaskStatus: 'completed',
    computerHandoff: { ...completedSharedRun, outcomeStatus: null },
    runId: 'shared-run',
  },
]);
assert.equal(
  statusOnly.get('same-run-waiting'),
  'current',
  'message status without completed handoff status cannot supersede a card',
);

const compactTrustedCompletion = classifyChatDesignTaskTimeline([
  sameRunTimeline[0],
  sameRunTimeline[1],
  {
    id: 'compact-trusted-completion',
    isBot: true,
    runId: 'shared-run',
    computerTaskStatus: 'completed',
    source: { surface: 'main_chat_computer_task' },
  },
]);
assert.equal(
  compactTrustedCompletion.get('same-run-waiting'),
  'superseded',
  'canonical compact completion uses the same immutable run lineage',
);

const compactForeignCompletion = classifyChatDesignTaskTimeline([
  sameRunTimeline[0],
  sameRunTimeline[1],
  {
    id: 'compact-foreign-completion',
    isBot: true,
    computerTaskStatus: 'completed',
    source: { surface: 'office_terminal' },
  },
]);
assert.equal(
  compactForeignCompletion.get('same-run-waiting'),
  'current',
  'handoff-free completion from another surface cannot supersede Chat history',
);

const legacyCappedCompletion = buildLegacyPersistedChatFallback(
  formatPersistedChatBotMessage(
    'OpenSwan',
    'Opened Photoshop and verified the requested document. '.repeat(12),
    {
      localMessageId: 'legacy-capped-completion',
      runId: 'shared-run',
      source: { actor: 'OpenSwan', surface: 'main_chat_computer_task' },
      computerTaskStatus: 'completed',
      computerHandoff: completedSharedRun,
    },
  ),
  1000,
);
const legacyCappedMetadata = readPersistedChatBotMetadata(legacyCappedCompletion.content);
assert.equal(legacyCappedCompletion.metadataRoundTrips, true);
assert(legacyCappedMetadata, 'the legacy-cap completion envelope reloads as parseable metadata');
assert.equal(
  buildChatDesignTaskCardModel(legacyCappedMetadata.computerHandoff),
  null,
  'the legacy envelope deliberately omits verbose design-card metadata',
);
const legacyCappedDisposition = classifyChatDesignTaskTimeline([
  sameRunTimeline[0],
  sameRunTimeline[1],
  {
    id: 'legacy-capped-completion',
    isBot: true,
    runId: legacyCappedMetadata.runId,
    source: legacyCappedMetadata.source,
    computerTaskStatus: legacyCappedMetadata.computerTaskStatus,
    computerHandoff: legacyCappedMetadata.computerHandoff,
  },
]);
assert.equal(
  legacyCappedDisposition.get('same-run-waiting'),
  'superseded',
  'a parseable status-only 1,000-character fallback still closes its exact pending run after reload',
);

const blockedHistory = classifyChatDesignTaskTimeline([
  {
    id: 'blocked-request',
    isBot: false,
    isUser: true,
    content: 'Open Photoshop and start a new project 600 x 600',
  },
  {
    id: 'blocked-card',
    isBot: true,
    computerTaskStatus: 'blocked',
    computerHandoff: blockedRun,
    runId: 'blocked-run',
  },
  {
    id: 'newer-human-turn',
    isBot: false,
    isUser: true,
    content: 'Try something else instead',
  },
  {
    id: 'unrelated-completion',
    isBot: true,
    computerTaskStatus: 'completed',
    computerHandoff: completedRunB,
    runId: 'run-b',
  },
]);
assert.equal(
  blockedHistory.get('blocked-card'),
  'current',
  'blocked history stays unchanged as evidence instead of being rewritten',
);

const noTranscriptStructuralGuess = classifyChatDesignTaskTimeline([
  {
    id: 'prompt-missing-waiting',
    isBot: true,
    computerTaskStatus: 'waiting_approval',
    computerHandoff: waitingRunA,
    runId: 'run-a',
  },
  {
    id: 'prompt-missing-completion',
    isBot: true,
    computerTaskStatus: 'completed',
    computerHandoff: completedRunB,
    runId: 'run-b',
  },
]);
assert.equal(
  noTranscriptStructuralGuess.get('prompt-missing-waiting'),
  'current',
  'matching task structure without immutable run/request lineage cannot supersede',
);

const exactVisibleLegacyApprovalCopy = [
  'I found the exact Photoshop blank-document path. After one approval, I will read Photoshop status, launch it only if needed, create the requested document with the app-native tool, and verify its dimensions.',
  'Approve desktop run: One Chat plan-level approval authorizes the complete exact Photoshop blank-document program before dispatch.',
].join('\n');

const historicalLegacyPlan = classifyChatDesignTaskTimeline([
  {
    id: 'legacy-human-request',
    isBot: false,
    isUser: true,
    authorId: 'legacy-owner',
    content: 'Open Photoshop and start a new project 600 x 600',
  },
  {
    id: 'legacy-approval-plan',
    isBot: true,
    content: exactVisibleLegacyApprovalCopy,
  },
  {
    id: 'legacy-newer-human-turn',
    isBot: false,
    isUser: false,
    authorId: 'legacy-owner',
    content: 'Move on to the next task.',
  },
]);
assert.equal(
  historicalLegacyPlan.get('legacy-approval-plan'),
  'historical',
  'exact visible legacy desktop-approval copy becomes Historical after a newer human turn',
);

const currentLegacyPlan = classifyChatDesignTaskTimeline([
  {
    id: 'current-legacy-request',
    isBot: false,
    isUser: true,
    authorId: 'legacy-owner',
    content: 'Open Photoshop and start a new project 600 x 600',
  },
  {
    id: 'current-legacy-plan',
    isBot: true,
    content: exactVisibleLegacyApprovalCopy,
  },
]);
assert.equal(
  currentLegacyPlan.get('current-legacy-plan'),
  'current',
  'the latest legacy desktop approval plan remains current and actionable',
);

const legacyNearMisses: Array<{
  id: string;
  content: string;
  computerTaskStatus?: string;
}> = [
  {
    id: 'ready-review-prose',
    content: 'Ready for review - the homepage copy and spacing look polished.',
  },
  {
    id: 'desktop-word-only',
    content: 'Ready for review - the desktop wallpaper looks good.',
  },
  {
    id: 'control-without-approval',
    content: 'I found the desktop-app path and can explain the app-native tool.',
  },
  {
    id: 'failed-legacy-plan',
    content: "Couldn't finish. Approval needed. Approve desktop run after fixing the bridge.",
  },
  {
    id: 'blocked-status-legacy-plan',
    content: exactVisibleLegacyApprovalCopy,
    computerTaskStatus: 'blocked',
  },
];
const legacyNearMissTimeline = classifyChatDesignTaskTimeline([
  ...legacyNearMisses.map((message) => ({ ...message, isBot: true })),
  {
    id: 'newer-human-after-near-misses',
    isBot: false,
    isUser: true,
    content: 'Continue.',
  },
]);
for (const nearMiss of legacyNearMisses) {
  assert.equal(
    legacyNearMissTimeline.has(nearMiss.id),
    false,
    `${nearMiss.id} is ordinary or failed prose, not a legacy actionable desktop plan`,
  );
}

const waitingCard = buildChatDesignTaskCardModel(waitingRunA);
assert(waitingCard, 'waiting handoff builds a card');

const historicalCard = applyChatDesignTaskTimelineDisposition(waitingCard, 'historical');
assert.equal(historicalCard.statusTone, 'historical');
assert.equal(historicalCard.statusLabel, 'Historical');
assert.equal(historicalCard.timelineDisposition, 'historical');
assert.equal(historicalCard.timelineActionsEnabled, false);
assert.equal(historicalCard.isHistorical, true);
assert.equal(historicalCard.isSuperseded, false);
assert.match(historicalCard.nextAction, /earlier chat turn/i);
assert(
  !historicalCard.phases.some((phase) => phase.state === 'current' || phase.state === 'blocked'),
  'historical card exposes no current or blocked phase',
);
assert.deepEqual(
  historicalCard.proofSignals,
  waitingCard.proofSignals,
  'historical marker preserves proof requirements',
);
assert.deepEqual(
  historicalCard.reviewChecklist,
  waitingCard.reviewChecklist,
  'historical marker preserves review evidence',
);
assert.deepEqual(
  historicalCard.operations,
  waitingCard.operations,
  'historical marker preserves the requested operation inventory',
);
assert.deepEqual(
  historicalCard.phases.map(({ id, label, detail }) => ({ id, label, detail })),
  waitingCard.phases.map(({ id, label, detail }) => ({ id, label, detail })),
  'historical marker preserves phase labels and evidence details while neutralizing action state',
);

const supersededCard = supersedeChatDesignTaskCardModel(waitingCard);
assert.equal(supersededCard.statusTone, 'superseded');
assert.equal(supersededCard.statusLabel, 'Superseded');
assert.equal(supersededCard.timelineDisposition, 'superseded');
assert.equal(supersededCard.timelineActionsEnabled, false);
assert.equal(supersededCard.isSuperseded, true);
assert.equal(supersededCard.isHistorical, false);
assert.deepEqual(
  supersededCard.proofSignals,
  waitingCard.proofSignals,
  'superseded marker preserves proof requirements',
);
assert.deepEqual(
  supersededCard.reviewChecklist,
  waitingCard.reviewChecklist,
  'superseded marker preserves review evidence',
);
assert.deepEqual(
  supersededCard.operations,
  waitingCard.operations,
  'superseded marker preserves the requested operation inventory',
);
assert.deepEqual(
  supersededCard.phases.map(({ id, label, detail }) => ({ id, label, detail })),
  waitingCard.phases.map(({ id, label, detail }) => ({ id, label, detail })),
  'superseded marker preserves phase labels and evidence details while neutralizing action state',
);
assert.equal(waitingCard.statusTone, 'approval', 'timeline helpers do not mutate the original card');

const currentCard = applyChatDesignTaskTimelineDisposition(waitingCard, 'current');
assert.equal(currentCard.timelineDisposition, 'current');
assert.equal(currentCard.timelineActionsEnabled, true);

const chatTabSource = fs.readFileSync(
  path.join(process.cwd(), 'src/screens/circles/tabs/ChatTab.tsx'),
  'utf8',
);

function componentSource(source: string, componentName: string, fromIndex = 0): string {
  const start = source.indexOf(`<${componentName}`, fromIndex);
  assert.notEqual(start, -1, `${componentName} is rendered by ChatTab`);
  const end = source.indexOf('/>', start);
  assert.notEqual(end, -1, `${componentName} render has a bounded JSX body`);
  return source.slice(start, end + 2);
}

assert.match(
  chatTabSource,
  /classifyChatDesignTaskTimeline\(messages\)/,
  'Chat classifies the complete chronological transcript once per message update',
);
assert.match(
  chatTabSource,
  /const isInactiveDesignTask = isInactiveDesignTaskMessage\(item\)/,
  'Chat derives one inactive-history guard from the classified timeline',
);
assert.match(
  chatTabSource,
  /const hasRecoveryOptions = !isInactiveDesignTask/,
  'historical and superseded rows cannot keep recovery-driven retry state',
);
assert.match(
  chatTabSource,
  /recoveryOptions: isInactiveDesignTask \|\| mutationReplayBlocked \? undefined : item\.recoveryOptions/,
  'historical, superseded, and non-replayable receipts cannot expose recovery actions',
);
assert.match(
  chatTabSource,
  /!isInactiveDesignTask && !mutationReplayBlocked && item\.recoveryOptions/,
  'historical, superseded, and non-replayable transcript rows do not render recovery buttons',
);
assert.match(
  chatTabSource,
  /if \(isInactiveDesignTaskMessage\(item\) \|\| isMutationReplayBlockedMessage\(item\)\) return \[\]/,
  'historical, superseded, and non-replayable rows cannot expose cross-surface approval or retry chips',
);
assert.match(
  chatTabSource,
  /readOnly=\{isInactiveDesignTaskMessage\(item\) \|\| mutationReplayBlocked\}/,
  'historical, superseded, and non-replayable rows keep preflight evidence but render it read-only',
);
assert.match(
  chatTabSource,
  /!isInactiveDesignTaskMessage\(item\)\s*&& !mutationReplayBlocked\s*&& item\.quickReplies/,
  'historical, superseded, and non-replayable rows cannot expose stale quick replies',
);
assert.match(
  chatTabSource,
  /!isInactiveDesignTask && !mutationReplayBlocked && appChoiceCard\.alternatives\.length > 0/,
  'historical, superseded, and non-replayable rows cannot expose app-switch actions',
);
const designTaskBlockStart = chatTabSource.indexOf('const designTaskBlock = designTaskCard ? (');
const designTaskBlockEnd = chatTabSource.indexOf('// Render block-level markdown', designTaskBlockStart);
assert(designTaskBlockStart >= 0 && designTaskBlockEnd > designTaskBlockStart, 'Chat design-task JSX block is source-addressable');
const designTaskBlockSource = chatTabSource.slice(designTaskBlockStart, designTaskBlockEnd);
const inactiveTimelineGate = designTaskBlockSource.indexOf('designTaskCard.timelineActionsEnabled === false ? (');
const inactiveTimelineCopyEnd = designTaskBlockSource.indexOf('</Text>', inactiveTimelineGate);
assert(inactiveTimelineGate >= 0 && inactiveTimelineCopyEnd > inactiveTimelineGate, 'inactive task status copy is source-addressable');
assert.match(
  designTaskBlockSource.slice(inactiveTimelineCopyEnd + '</Text>'.length, inactiveTimelineCopyEnd + 80),
  /^\s*\)\s*:\s*null\}/,
  'inactive task status copy is additive instead of replacing the evidence branch',
);
for (const [token, label] of [
  ['designTaskCard.phases.map', 'phase'],
  ['designTaskCard.proofSignals', 'proof'],
  ['designTaskCard.reviewChecklist', 'review'],
] as const) {
  assert(
    designTaskBlockSource.indexOf(token, inactiveTimelineCopyEnd) > inactiveTimelineCopyEnd,
    `inactive task status copy does not replace the read-only ${label} evidence`,
  );
}

const runExecutionCardSource = componentSource(chatTabSource, 'RunExecutionCard');
for (const [prop, callbackPattern] of [
  ['onLaunchBrowserPlan', /onLaunchBrowserPlan=\{isInactiveDesignTask \|\| mutationReplayBlocked\s*\?\s*undefined\s*:/],
  ['onRetryCheck', /onRetryCheck=\{isInactiveDesignTask \|\| mutationReplayBlocked\s*\?\s*undefined\s*:/],
] as const) {
  assert.match(
    runExecutionCardSource,
    callbackPattern,
    `inactive and non-replayable task rows pass no executable ${prop} callback to RunExecutionCard`,
  );
}
assert.match(
  runExecutionCardSource,
  /onOpenBrowserSession=\{handleOpenBrowserSession\}/,
  'inactive task rows retain read-only access to browser-session evidence',
);
assert.match(
  runExecutionCardSource,
  /onOpenBrowserSessionHistory=\{setSelectedBrowserSession\}/,
  'inactive task rows retain read-only access to browser-session history',
);

const runTraceCardSource = componentSource(chatTabSource, 'RunTraceCard');
assert.match(
  runTraceCardSource,
  /readOnly=\{isInactiveDesignTaskMessage\(item\) \|\| mutationReplayBlocked\}/,
  'inactive and non-replayable task RunTraceCard is explicitly read-only',
);
assert.match(
  runTraceCardSource,
  /onRunAgain=\{isInactiveDesignTaskMessage\(item\) \|\| mutationReplayBlocked\s*\?\s*undefined\s*:/,
  'inactive and non-replayable task rows keep RunTraceCard evidence without a Run again callback',
);
assert.match(
  chatTabSource,
  /\.\.\.hydratePersistedChatBotMetadata\(botMetadata\)/,
  'realtime and initial rows use the same metadata hydration path',
);
assert.match(
  chatTabSource,
  /requestAuthorId: metadata\.requestAuthorId \|\| undefined/,
  'hydration restores durable requester lineage before timeline reconciliation',
);
assert.match(
  chatTabSource,
  /computerTaskStatus: normalizeComputerTaskOutcomeStatus\(metadata\.computerTaskStatus\)/,
  'shared hydration restores structured computer-task terminal status',
);
assert.match(
  chatTabSource,
  /requestAuthorId: messageRequestAuthorId/,
  'new bot rows stamp the stable human requester instead of inferring from proximity',
);
assert.match(
  chatTabSource,
  /onPickOption=\{isInactiveDesignTaskMessage\(item\)[\s\S]*?\? undefined/,
  'historical findings remain visible without booking actions',
);
assert.match(
  chatTabSource,
  /onAdopt=\{isInactiveDesignTaskMessage\(item\)[\s\S]*?\? undefined/,
  'historical Best-of-N evidence remains visible without adoption actions',
);

console.log('All chat design-task timeline classification smoke cases passed.');
