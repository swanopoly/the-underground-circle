/**
 * Fail-closed A1…An outcome accounting for compound computer tasks.
 * Pure source-level checks only; no bridge, provider, app, or GUI is invoked.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildDeterministicReadOnlyFileRequestedActionProgress,
  buildComputerTaskRequestedActionCoverage,
  formatComputerTaskRequestedActionCoverage,
  type ComputerTaskOutcomeStatus,
} from '../src/lib/computerTaskOutcome';

function contract(
  count = 4,
  options: { capped?: boolean; requiresDecompositionBeforeMutation?: boolean } = {},
) {
  return {
    schemaVersion: 1,
    mode: 'all_actions_required',
    actionCount: count,
    capped: options.capped === true,
    requiresDecompositionBeforeMutation: options.requiresDecompositionBeforeMutation === true,
    actions: Array.from({ length: count }, (_, index) => ({ id: `A${index + 1}` })),
  } as const;
}

function coverage(
  outcomeStatus: ComputerTaskOutcomeStatus | null,
  mutationDispatched = false,
  actionContract: ReturnType<typeof contract> = contract(),
  taskCompletionVerified = outcomeStatus === 'completed',
) {
  const result = buildComputerTaskRequestedActionCoverage({
    contract: actionContract,
    outcomeStatus,
    taskCompletionVerified,
    mutationDispatched,
  });
  assert(result, `coverage exists for ${String(outcomeStatus)}`);
  return result;
}

const completed = coverage('completed');
assert.equal(completed.overallStatus, 'complete');
assert.equal(completed.source, 'verified_task_outcome');
assert.equal(completed.verifiedActionCount, 4);
assert.equal(completed.allActionsVerified, true);
assert.equal(completed.taskCompletionVerified, true);
assert.deepEqual(completed.actions.map((action) => action.status), [
  'verified', 'verified', 'verified', 'verified',
]);
assert.deepEqual(completed.unresolvedActionIds, []);
assert.equal(formatComputerTaskRequestedActionCoverage(completed), 'A1–A4 verified.');
assert(Object.isFrozen(completed));
assert(Object.isFrozen(completed.actions));
assert(completed.actions.every(Object.isFrozen));
assert(Object.isFrozen(completed.unresolvedActionIds));

const completionWithoutOuterProof = coverage('completed', true, contract(), false);
assert.equal(completionWithoutOuterProof.overallStatus, 'outcome_unknown');
assert.equal(completionWithoutOuterProof.source, 'task_proof_missing');
assert.equal(completionWithoutOuterProof.taskCompletionVerified, false);
assert(completionWithoutOuterProof.actions.every((action) => action.status === 'outcome_unknown'));
assert.match(formatComputerTaskRequestedActionCoverage(completionWithoutOuterProof), /completion is not verified/);

const verifiedCompletionAfterMutation = coverage('completed', true, contract(), true);
assert.equal(verifiedCompletionAfterMutation.overallStatus, 'complete');
assert.equal(verifiedCompletionAfterMutation.taskCompletionVerified, true);
assert(verifiedCompletionAfterMutation.actions.every((action) => action.status === 'verified'));

for (const [terminal, firstStatus, overall, copy] of [
  ['blocked', 'blocked', 'blocked', 'A1 blocked; A2–A4 pending.'],
  ['waiting_approval', 'awaiting_approval', 'awaiting_approval', 'A1 awaiting approval; A2–A4 pending.'],
  ['needs_input', 'needs_input', 'needs_input', 'A1 needs input; A2–A4 pending.'],
  ['failed', 'failed', 'failed', 'A1 failed; A2–A4 pending.'],
  ['cancelled', 'cancelled', 'cancelled', 'A1 cancelled; A2–A4 pending.'],
] as const) {
  const result = coverage(terminal);
  assert.equal(result.overallStatus, overall);
  assert.equal(result.source, 'preflight_terminal');
  assert.equal(result.actions[0]?.status, firstStatus);
  assert(result.actions.slice(1).every((action) => action.status === 'pending'));
  assert.equal(result.allActionsVerified, false);
  assert.deepEqual(result.unresolvedActionIds, ['A1', 'A2', 'A3', 'A4']);
  assert.equal(formatComputerTaskRequestedActionCoverage(result), copy);
}

const pending = coverage(null);
assert.equal(pending.overallStatus, 'pending');
assert.equal(pending.source, 'pending');
assert(pending.actions.every((action) => action.status === 'pending'));
assert.equal(formatComputerTaskRequestedActionCoverage(pending), 'A1–A4 pending.');

for (const terminal of ['partial', 'blocked', 'failed', 'cancelled', 'waiting_approval'] as const) {
  const result = coverage(terminal, true);
  assert.equal(result.overallStatus, 'outcome_unknown');
  assert.equal(result.source, 'mutation_uncertain');
  assert(result.actions.every((action) => action.status === 'outcome_unknown'));
  assert.equal(result.verifiedActionCount, 0);
  assert.equal(result.allActionsVerified, false);
  assert.match(formatComputerTaskRequestedActionCoverage(result), /completion is not verified/);
}

const partialWithoutMutationFlag = coverage('partial', false);
assert.equal(partialWithoutMutationFlag.overallStatus, 'outcome_unknown');
assert(partialWithoutMutationFlag.actions.every((action) => action.status === 'outcome_unknown'));

const deterministicReadOnlyProgress = buildDeterministicReadOnlyFileRequestedActionProgress({
  outcomeStatus: 'partial',
  actionResults: [
    { id: 'A1', ordinal: 1, status: 'verified' },
    { id: 'A2', ordinal: 2, status: 'verified' },
    { id: 'A3', ordinal: 3, status: 'incomplete' },
    { id: 'A4', ordinal: 4, status: 'pending' },
  ],
});
assert(deterministicReadOnlyProgress);
assert(Object.isFrozen(deterministicReadOnlyProgress));
assert(Object.isFrozen(deterministicReadOnlyProgress.actions));
assert.deepEqual(deterministicReadOnlyProgress.actions.map((action) => action.status), [
  'verified', 'verified', 'blocked', 'pending',
]);
const partialReadOnlyCoverage = buildComputerTaskRequestedActionCoverage({
  contract: contract(),
  outcomeStatus: 'partial',
  taskCompletionVerified: false,
  mutationDispatched: false,
  requestedActionProgress: deterministicReadOnlyProgress,
});
assert(partialReadOnlyCoverage);
assert.equal(partialReadOnlyCoverage.source, 'deterministic_read_only_progress');
assert.equal(partialReadOnlyCoverage.overallStatus, 'blocked');
assert.equal(partialReadOnlyCoverage.verifiedActionCount, 2);
assert.deepEqual(partialReadOnlyCoverage.actions.map((action) => action.status), [
  'verified', 'verified', 'blocked', 'pending',
]);
assert.equal(
  formatComputerTaskRequestedActionCoverage(partialReadOnlyCoverage),
  'A1, A2 verified; A3 blocked; A4 pending.',
);

const completedProgressWithoutOuterProof = buildDeterministicReadOnlyFileRequestedActionProgress({
  outcomeStatus: 'completed',
  actionResults: Array.from({ length: 4 }, (_, index) => ({
    id: `A${index + 1}`,
    ordinal: index + 1,
    status: 'verified',
  })),
});
assert(completedProgressWithoutOuterProof);
const progressCannotReplaceOuterProof = buildComputerTaskRequestedActionCoverage({
  contract: contract(),
  outcomeStatus: 'completed',
  taskCompletionVerified: false,
  mutationDispatched: false,
  requestedActionProgress: completedProgressWithoutOuterProof,
});
assert.equal(progressCannotReplaceOuterProof?.source, 'task_proof_missing');
assert(progressCannotReplaceOuterProof?.actions.every((action) => action.status === 'outcome_unknown'));

const progressCannotCrossMutationBoundary = buildComputerTaskRequestedActionCoverage({
  contract: contract(),
  outcomeStatus: 'partial',
  taskCompletionVerified: false,
  mutationDispatched: true,
  requestedActionProgress: deterministicReadOnlyProgress,
});
assert.equal(progressCannotCrossMutationBoundary?.source, 'mutation_uncertain');
assert(progressCannotCrossMutationBoundary?.actions.every((action) => action.status === 'outcome_unknown'));

for (const invalidProgress of [
  [
    { id: 'A1', ordinal: 1, status: 'pending' },
    { id: 'A2', ordinal: 2, status: 'blocked' },
  ],
  [
    { id: 'A1', ordinal: 1, status: 'blocked' },
    { id: 'A2', ordinal: 2, status: 'verified' },
  ],
  [
    { id: 'A1', ordinal: 1, status: 'blocked' },
    { id: 'A2', ordinal: 2, status: 'blocked' },
  ],
  [
    { id: 'A1', ordinal: 1, status: 'verified' },
    { id: 'A3', ordinal: 2, status: 'blocked' },
  ],
]) {
  assert.equal(buildDeterministicReadOnlyFileRequestedActionProgress({
    outcomeStatus: 'partial',
    actionResults: invalidProgress,
  }), null);
}

const capped = coverage('completed', false, contract(8, {
  capped: true,
  requiresDecompositionBeforeMutation: true,
}));
assert.equal(capped.overallStatus, 'requires_decomposition');
assert.equal(capped.allActionsVerified, false);
assert(capped.actions.every((action) => action.status === 'pending'));
assert.match(formatComputerTaskRequestedActionCoverage(capped), /decompose the request before any action runs/);

const violatedDecompositionGate = coverage('completed', true, contract(8, {
  capped: true,
  requiresDecompositionBeforeMutation: true,
}));
assert.equal(violatedDecompositionGate.overallStatus, 'requires_decomposition');
assert(violatedDecompositionGate.actions.every((action) => action.status === 'outcome_unknown'));
assert.match(formatComputerTaskRequestedActionCoverage(violatedDecompositionGate), /completion is not verified/);

const oversizedUntrustedLedger = buildComputerTaskRequestedActionCoverage({
  contract: {
    ...contract(8),
    actionCount: 9,
    actions: Array.from({ length: 9 }, (_, index) => ({ id: `A${index + 1}` })),
  },
  outcomeStatus: 'completed',
  taskCompletionVerified: true,
});
assert.equal(oversizedUntrustedLedger?.overallStatus, 'requires_decomposition');
assert.equal(oversizedUntrustedLedger?.allActionsVerified, false);

const truncatedUntrustedLedger = buildComputerTaskRequestedActionCoverage({
  contract: { ...contract(2), actionCount: 4 },
  outcomeStatus: 'completed',
  taskCompletionVerified: true,
});
assert.equal(truncatedUntrustedLedger?.overallStatus, 'requires_decomposition');
assert.equal(truncatedUntrustedLedger?.allActionsVerified, false);

const hostileMutationFlag = buildComputerTaskRequestedActionCoverage({
  contract: contract(),
  outcomeStatus: 'blocked',
  mutationDispatched: 'true',
});
assert.equal(hostileMutationFlag?.mutationDispatched, false, 'string truthiness cannot claim a mutation crossed');
assert.equal(hostileMutationFlag?.actions[0]?.status, 'blocked');

for (const invalid of [
  null,
  {},
  { schemaVersion: 2, mode: 'all_actions_required', actions: [{ id: 'A1' }, { id: 'A2' }] },
  { schemaVersion: 1, mode: 'best_effort', actions: [{ id: 'A1' }, { id: 'A2' }] },
  { schemaVersion: 1, mode: 'all_actions_required', actions: [{ id: 'A1' }] },
  { schemaVersion: 1, mode: 'all_actions_required', actions: [{ id: 'A1' }, { id: 'A3' }] },
  { schemaVersion: 1, mode: 'all_actions_required', actions: [{ id: 'A1' }, null] },
]) {
  assert.equal(buildComputerTaskRequestedActionCoverage({ contract: invalid as never }), null);
}

const missingA4 = buildComputerTaskRequestedActionCoverage({
  contract: {
    ...contract(),
    actions: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }, { id: 'A5' }],
  },
  outcomeStatus: 'completed',
  taskCompletionVerified: true,
});
assert.equal(missingA4, null, 'a malformed/missing A4 can never become whole-task completion');

assert.equal(formatComputerTaskRequestedActionCoverage(null), '');
assert.equal(formatComputerTaskRequestedActionCoverage(undefined), '');

const hookSource = readFileSync(
  new URL('../src/lib/useComputerUseTask.ts', import.meta.url),
  'utf8',
);
const chatSource = readFileSync(
  new URL('../src/screens/circles/tabs/ChatTab.tsx', import.meta.url),
  'utf8',
);
const hookGateIndex = hookSource.indexOf(
  'const requestedActionExecutionGate = buildChatComputerRequestedActionExecutionGate(task);',
);
const hookRemoteStartIndex = hookSource.indexOf('startComputerUseAgent({', hookGateIndex);
assert(hookGateIndex >= 0 && hookRemoteStartIndex > hookGateIndex, 'cloud hook enforces decomposition before remote start');
assert.match(hookSource, /outcomeStatus:\s*'blocked',[\s\S]{0,180}requestedActionContract/);
assert.match(hookSource, /requestedActionContract\?: ChatComputerRequestedActionContract \| null/);
assert.match(
  hookSource,
  /const taskOutcomeStatus:\s*ComputerTaskOutcomeStatus\s*=\s*requestedActionContract[\s\S]{0,100}\?\s*'partial'[\s\S]{0,60}:\s*'completed'/,
  'cloud result keeps compound coverage partial without an outer task receipt',
);
assert.match(chatSource, /const buildTerminalBrowserHandoff = \([\s\S]{0,900}requestedActionContract/);
assert.match(chatSource, /taskCompletionVerified:\s*outcome\.data\?\.taskCompletionVerified\s*===\s*true/);
assert.match(chatSource, /computerTaskStatus:\s*terminalStatus,[\s\S]{0,180}computerHandoff:\s*terminalHandoff\.metadata/);
assert.match(chatSource, /outcomeStatus\s*===\s*'partial'[\s\S]{0,100}\?\s*'partial'[\s\S]{0,80}:\s*'completed'/);
assert.match(chatSource, /terminalStatus === 'blocked'[\s\S]{0,1800}computerHandoff:\s*terminalHandoff\.metadata/);
assert.match(chatSource, /clarificationHandoffContext = buildChatComputerHandoffContext\([\s\S]{0,900}requestedActionContract: computerRequestedActionContract/);
assert.match(chatSource, /surfacePreparationHandoffContext = buildChatComputerHandoffContext\([\s\S]{0,700}requestedActionContract: requestedActionExecutionGate\.contract/);
const localExecutionStart = chatSource.indexOf('const runLocalComputerExecution = useCallback');
const localExecutionEnd = chatSource.indexOf('const cancelLocalComputerExecution = useCallback', localExecutionStart);
const localExecutionSource = chatSource.slice(localExecutionStart, localExecutionEnd);
assert(localExecutionStart >= 0 && localExecutionEnd > localExecutionStart);
const localGateIndex = localExecutionSource.indexOf(
  'const requestedActionExecutionGate = buildChatComputerRequestedActionExecutionGate(runnable.task);',
);
const localDispatchIndex = localExecutionSource.indexOf('executeComputerUsePlan(', localGateIndex);
assert(localGateIndex >= 0 && localDispatchIndex > localGateIndex, 'local browser gate precedes every plan dispatch');
assert.match(localExecutionSource, /const buildLocalBrowserHandoff = \([\s\S]{0,700}requestedActionContract/);
assert.match(localExecutionSource, /localMutationMayHaveDispatched = true/);
assert.match(localExecutionSource, /computerTaskStatus:\s*'waiting_approval',[\s\S]{0,140}computerHandoff:\s*waitingHandoff\.metadata/);
assert.match(localExecutionSource, /computerTaskStatus:\s*'blocked',[\s\S]{0,140}computerHandoff:\s*blockedHandoff\.metadata/);
assert.match(localExecutionSource, /computerTaskStatus:\s*taskOutcomeStatus,[\s\S]{0,140}computerHandoff:\s*terminalHandoff\.metadata/);
assert.match(localExecutionSource, /requestedActionCoverageNeedsVerification[\s\S]{0,400}\?\s*'partial'[\s\S]{0,80}:\s*outcomeStatus/);
assert.match(
  localExecutionSource,
  /const terminalHandoff = requestedActionCoverageNeedsVerification[\s\S]{0,180}buildLocalBrowserHandoff\(taskOutcomeStatus, mutationDispatched\)/,
  'local browser handoff status matches the outer partial task status after coverage downgrade',
);
assert.match(localExecutionSource, /replayPolicy,[\s\S]{0,180}mutationDispatched,[\s\S]{0,220}computerHandoff:\s*(?:terminalHandoff|failedHandoff)\.metadata/);

console.log('Computer task requested-action coverage smoke passed.');
