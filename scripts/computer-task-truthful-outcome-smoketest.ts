import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  deriveAgentTaskTerminalOutcome,
  deriveComputerTaskAdapterOutcomeStatus,
  deriveComputerTaskAgentOutcomeStatus,
  hasTerminalDesktopSequenceCompletionProof,
  mapComputerTaskOutcomeToChatStatus,
  normalizeComputerTaskOutcomeStatus,
} from '../src/lib/computerTaskOutcome';

assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: true, proofVerified: true }),
  'completed',
  'an explicitly proven successful deterministic adapter completes',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: true, proofVerified: false }),
  'partial',
  'a successful click/type sequence without after-state proof is only partial',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: true, proofVerified: true }),
  'completed',
  'a successful deterministic adapter with explicit after-state proof completes',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: false, proofVerified: false }),
  'failed',
  'a failed deterministic adapter is not completed',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: false, proofVerified: false, blocked: true }),
  'blocked',
  'an adapter stop remains blocked',
);
assert.equal(
  hasTerminalDesktopSequenceCompletionProof([
    { kind: 'output_verification', ok: true },
  ]),
  true,
  'a successful terminal after-state verification proves the sequence',
);
assert.equal(
  hasTerminalDesktopSequenceCompletionProof([
    { kind: 'output_verification', ok: true },
    { kind: 'type_text', ok: true },
  ]),
  false,
  'a later mutation invalidates earlier sequence proof',
);
assert.equal(
  hasTerminalDesktopSequenceCompletionProof([
    { kind: 'type_text', ok: true },
    { kind: 'output_verification', ok: true },
  ]),
  true,
  'a successful after-state verification after the final mutation proves the sequence',
);

assert.equal(
  deriveAgentTaskTerminalOutcome({
    transportSuccess: true,
    expectation: 'verified_task',
  }).status,
  'inconclusive',
  'a prose response is not proof that a mutation completed',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    terminalOutcomeStatus: 'inconclusive',
  }),
  'blocked',
  'an unverified agent response without task progress fails closed',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    terminalOutcomeStatus: 'inconclusive',
    partialProgress: true,
  }),
  'partial',
  'an unverified agent response preserves known adapter progress',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    terminalOutcomeStatus: 'completed',
  }),
  'completed',
  'structured agent completion is authoritative',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({ success: false }),
  'failed',
  'AgentRunResult.success=false is authoritative even when a response exists',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({ success: false, partialProgress: true }),
  'partial',
  'a failed agent run after an adapter mutation is partial',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    capabilityBuildoutStatus: 'approval_required',
  }),
  'waiting_approval',
  'capability approval prevents completed',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    capabilityBuildoutStatus: 'requested',
  }),
  'blocked',
  'a requested buildout without task progress remains blocked',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    partialProgress: true,
    capabilityBuildoutStatus: 'requested',
  }),
  'partial',
  'a requested buildout preserves real partial progress',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    capabilityBuildoutStatus: 'failed',
  }),
  'failed',
  'a failed capability buildout prevents completed',
);

assert.equal(mapComputerTaskOutcomeToChatStatus('completed'), 'completed');
assert.equal(mapComputerTaskOutcomeToChatStatus('partial'), 'blocked');
assert.equal(mapComputerTaskOutcomeToChatStatus('waiting_approval'), 'deferred');
assert.equal(mapComputerTaskOutcomeToChatStatus('cancelled'), 'blocked');
assert.equal(normalizeComputerTaskOutcomeStatus('partial'), 'partial');
assert.equal(normalizeComputerTaskOutcomeStatus('made_up'), null);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const runtimeSource = readFileSync(`${repoRoot}/src/lib/computerTaskRuntime.ts`, 'utf8');
const agentRuntimeSource = readFileSync(`${repoRoot}/src/lib/agentRuntime.ts`, 'utf8');
const stateSource = readFileSync(`${repoRoot}/src/lib/computerTaskState.ts`, 'utf8');
const stateModelSource = readFileSync(`${repoRoot}/src/lib/computerTaskStateModel.ts`, 'utf8');
const chatSource = readFileSync(`${repoRoot}/src/screens/circles/tabs/ChatTab.tsx`, 'utf8');

assert.match(
  runtimeSource,
  /export interface ComputerTaskRuntimeResult\s*\{\s*\/\*\*[\s\S]*?status: ComputerTaskOutcomeStatus;/,
  'runtime result exposes an authoritative typed status',
);
assert.match(
  agentRuntimeSource,
  /taskTerminalOutcome: terminalOutcome/,
  'agent runs persist task proof separately from transport lifecycle',
);
assert.match(
  agentRuntimeSource,
  /await updateRunStatus\(runId, 'completed'\)/,
  'a returned response completes transport without claiming task completion',
);
assert.match(
  runtimeSource,
  /terminalOutcomeStatus: retryResult\.terminalOutcome\.status/,
  'capability retry status comes from the typed task terminal outcome',
);
assert.match(
  runtimeSource,
  /terminalOutcomeStatus: result\.terminalOutcome\.status/,
  'main agent status comes from the typed task terminal outcome',
);
assert.match(runtimeSource, /completionExpectation: 'verified_task'/);
assert.match(
  runtimeSource,
  /else if \(result\.terminalOutcome\.status === 'completed'\)/,
  'inconclusive runs are not learned as successes',
);
assert.match(
  runtimeSource,
  /`inconclusive` is deliberately not learned as either success or/,
  'inconclusive runs are not learned as failures or capability-gap churn',
);
assert.equal(
  (runtimeSource.match(/retryAttempt\.terminalOutcomeStatus !== 'inconclusive'/g) || []).length,
  2,
  'both capability-buildout retry paths skip learning from inconclusive prose-only outcomes',
);
assert.match(
  runtimeSource,
  /isComputerTaskOutcomeComplete\(finalStatus\)/,
  'desktop traces only persist for authoritative completion',
);
assert.match(
  runtimeSource,
  /proofVerified: fileResult\.ok/,
  'the remaining deterministic read-only file lane passes explicit proof state into outcome derivation',
);
assert.match(
  runtimeSource,
  /App, hybrid, open-path, conversion, and file-mutation tasks never execute[\s\S]{0,300}authenticated typed loop owns all mutations/,
  'app and mutation work no longer exits through the pre-agent deterministic lane',
);
assert.doesNotMatch(
  runtimeSource,
  /isCompletedDesktopSequence\) && !readyCapabilityBuildout\) \{[\s\S]{0,400}?status: 'completed'/,
  'desktop action sequence success is not stamped completed without proof',
);

const nativeHandlerStart = chatSource.indexOf('const result = await executeComputerTaskWithAgent({');
const nativeHandlerEnd = chatSource.indexOf('\n        onOutcome:', nativeHandlerStart);
assert(nativeHandlerStart >= 0 && nativeHandlerEnd > nativeHandlerStart, 'native computer handler source is present');
const nativeHandlerSource = chatSource.slice(nativeHandlerStart, nativeHandlerEnd);
assert.match(
  nativeHandlerSource,
  /status: mapComputerTaskOutcomeToChatStatus\(result\.status\)/,
  'Chat adapts the authoritative runtime status instead of stamping completed',
);

assert.match(
  chatSource,
  /const normalizedComputerTaskStatus = normalizeComputerTaskOutcomeStatus\(extra\?\.computerTaskStatus\)/,
  'rich status is normalized once at bot-message finalization',
);
assert.match(
  chatSource,
  /computerTaskStatus: normalizedComputerTaskStatus/,
  'rich status is copied into persisted bot-message metadata',
);
assert.match(
  chatSource,
  /const computerTaskOutcomeSignal = deriveComputerTaskChatOutcomeSignal\(normalizedComputerTaskStatus\)/,
  'authoritative computer status drives flywheel and cross-surface outcome truth',
);
assert.match(
  chatSource,
  /const browserPlanOutcomeSignal = deriveBrowserPlanChatOutcomeSignal\(extra\?\.browserPlans\)/,
  'browser plan lifecycle is classified instead of treating plan existence as completion',
);
assert.match(
  chatSource,
  /const stopMessageOutcomeSignal = deriveStopMessageChatOutcomeSignal\(content\)/,
  'runtime stop copy is classified before generic prose can stamp completion',
);
assert.match(stateModelSource, /outcomeStatus\?: ComputerTaskOutcomeStatus \| null/);
assert.match(stateSource, /outcomeStatus: normalizeComputerTaskOutcomeStatus\(parsed\.outcomeStatus\)/);
assert.doesNotMatch(
  stateSource,
  /outcomeStatus = sameTask \? previous\?\.outcomeStatus/,
  'a new active transition cannot inherit a stale terminal outcome',
);
assert.match(
  stateSource,
  /outcomeStatus: normalizeComputerTaskOutcomeStatus\(record\.outcomeStatus\)/,
  'task-state writes normalize only the outcome explicitly supplied by the caller',
);
assert.match(
  chatSource,
  /outcomeStatus: computerTaskStatus/,
  'rich status is copied into durable computer task state',
);
for (const match of chatSource.matchAll(/persistComputerTaskState\(\{/g)) {
  const callEnd = chatSource.indexOf('\n      });', match.index);
  const callSource = chatSource.slice(match.index, callEnd > match.index ? callEnd : match.index + 1600);
  assert.match(
    callSource,
    /outcomeStatus:/,
    `computer task state transition at source offset ${match.index} explicitly clears or sets the outcome`,
  );
}
assert.match(
  chatSource,
  /phase: 'completed',\s*outcomeStatus: 'completed'/,
  'browser completion writes a completed terminal outcome',
);
assert.match(
  chatSource,
  /phase: 'failed',\s*outcomeStatus: 'failed'/,
  'browser and exception failures write a failed terminal outcome',
);
assert.match(
  nativeHandlerSource,
  /computerTaskStatus: result\.status/,
  'Chat preserves the full authoritative status in outcome metadata',
);
assert.doesNotMatch(
  nativeHandlerSource,
  /status:\s*['"]completed['"]/,
  'native/file/hybrid handler has no unconditional completed outcome',
);

console.log('computer task truthful outcome smoke passed');
