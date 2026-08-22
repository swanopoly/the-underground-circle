import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildComputerTaskRequestedActionCoverage } from '../src/lib/computerTaskOutcome';

const runtimePath = resolve(process.cwd(), 'src/lib/computerTaskRuntime.ts');
const runtime = readFileSync(runtimePath, 'utf8');

function section(start: string, end: string): string {
  const startIndex = runtime.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source section start: ${start}`);
  const endIndex = runtime.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source section end: ${end}`);
  return runtime.slice(startIndex, endIndex);
}

const authorityCore = section(
  'type ExactComputerTaskCompletionAuthoritySource',
  'function exactSequenceManualVerificationResult',
);
assert.match(authorityCore, /new WeakSet<object>\(\)/);
assert.match(authorityCore, /issuedExactComputerTaskCompletionAuthorities\.add\(authority\)/);
assert.match(authorityCore, /issuedExactComputerTaskCompletionAuthorities\.has\(authority as object\)/);
assert.match(authorityCore, /consumedExactComputerTaskCompletionAuthorities\.has\(authority as object\)/);
assert.match(authorityCore, /result\.status !== 'completed'/);
assert.match(authorityCore, /taskCompletionVerified: true/);
assert.match(authorityCore, /consumedExactComputerTaskCompletionAuthorities\.add\(authority\)/);
assert.equal(
  (runtime.match(/taskCompletionVerified:\s*true/g) || []).length,
  1,
  'only the single-use exact authority applier may assert whole-task completion',
);

const exactPrior = section(
  'function exactPhotoshopDurablePriorResult',
  'async function finishExactPhotoshopDurableAction',
);
assert.match(exactPrior, /prior\.state === 'verified'/);
assert.match(exactPrior, /prior\.metadata\.completionVerified === true/);
assert.match(exactPrior, /Number\(prior\.metadata\.evidenceCount \|\| 0\) > 0/);
assert.match(exactPrior, /Number\(prior\.metadata\.blockerCount \|\| 0\) === 0/);
assert.match(exactPrior, /issueExactComputerTaskCompletionAuthority\('durable_exact_action_verified'\)/);
assert.match(exactPrior, /applyExactComputerTaskCompletionAuthority/);

const lifecyclePrior = section(
  'function lifecycleDurablePriorResult',
  'async function finishLifecycleDurableAction',
);
assert.match(lifecyclePrior, /prior\.state === 'verified'/);
assert.match(lifecyclePrior, /prior\.metadata\.completionVerified === true/);
assert.match(lifecyclePrior, /issueExactComputerTaskCompletionAuthority\('durable_lifecycle_action_verified'\)/);
assert.match(lifecyclePrior, /applyExactComputerTaskCompletionAuthority/);

const atomicCanary = section(
  'async function executeFrontmostPhotoshopRootActionCanary',
  'async function executeAuthorizedExactSequenceProgram',
);
assert.match(atomicCanary, /!completed\.ok \|\| completed\.disposition !== 'completed'/);
assert.match(atomicCanary, /issueExactComputerTaskCompletionAuthority\('atomic_root_action_completed'\)/);
assert.match(atomicCanary, /applyExactComputerTaskCompletionAuthority/);

const exactSequence = section(
  'async function executeAuthorizedExactSequenceProgram',
  'function safeExactAuthorityId',
);
assert.match(exactSequence, /const durableVerified = await finishExactPhotoshopDurableAction/);
assert.match(exactSequence, /if \(!durableVerified\)[\s\S]*?exactSequenceManualVerificationResult/);
assert.match(exactSequence, /issueExactComputerTaskCompletionAuthority\('durable_exact_action_verified'\)/);
assert.match(exactSequence, /applyExactComputerTaskCompletionAuthority/);

const lifecycleSequence = section(
  'async function executeAuthorizedDeterministicLifecycleReadProgram',
  'export function hasFollowUpIntent',
);
assert.match(lifecycleSequence, /const completionVerified = lifecycleActivationCompletionVerified\(activation\)/);
assert.match(lifecycleSequence, /const durableVerified = await finishLifecycleDurableAction/);
assert.match(lifecycleSequence, /if \(!durableVerified\)[\s\S]*?exactSequenceManualVerificationResult/);
assert.match(lifecycleSequence, /issueExactComputerTaskCompletionAuthority\('durable_lifecycle_action_verified'\)/);
assert.match(lifecycleSequence, /applyExactComputerTaskCompletionAuthority/);

const runtimeEntry = section(
  'export async function executeComputerTaskWithAgent',
  '// Learned per-app facts still gate read-only trace/example context.',
);
assert.equal(
  (runtimeEntry.match(/issueExactComputerTaskCompletionAuthority\('authenticated_completed_root'\)/g) || []).length,
  2,
  'both authenticated completed-root resume exits must mint exact completion authority',
);
assert.equal(
  (runtimeEntry.match(/applyExactComputerTaskCompletionAuthority/g) || []).length >= 2,
  true,
  'authenticated completed-root resume exits apply exact completion authority',
);

const manualResult = section(
  'function exactSequenceManualVerificationResult',
  'type ExactPhotoshopForegroundResult',
);
assert.doesNotMatch(manualResult, /taskCompletionVerified:\s*true/);
assert.doesNotMatch(manualResult, /issueExactComputerTaskCompletionAuthority/);

const genericFinal = section(
  'const finalStatus = turnReplayGuard.manualVerifyOnly',
  '\n}\n',
);
assert.match(
  genericFinal,
  /taskCompletionVerified: result\.taskTurnEvidence\?\.taskCompletionVerified === true\s*&& result\.taskTurnEvidence\.status === 'completed'/,
  'generic model-driven tasks remain bound to their request-level acceptance receipt',
);

const exactContract = {
  schemaVersion: 1 as const,
  mode: 'all_actions_required' as const,
  actionCount: 2,
  capped: false,
  requiresDecompositionBeforeMutation: false,
  actions: [
    { id: 'A1', text: 'Open Photoshop', verb: 'open', connective: 'start' as const },
    { id: 'A2', text: 'Create a 600 x 600 document', verb: 'create', connective: 'and' as const },
  ],
};
const verified = buildComputerTaskRequestedActionCoverage({
  contract: exactContract,
  outcomeStatus: 'completed',
  taskCompletionVerified: true,
  mutationDispatched: true,
});
assert.equal(verified?.allActionsVerified, true);
assert.deepEqual(verified?.actions.map((action) => action.status), ['verified', 'verified']);

const unproven = buildComputerTaskRequestedActionCoverage({
  contract: exactContract,
  outcomeStatus: 'completed',
  taskCompletionVerified: false,
  mutationDispatched: true,
});
assert.equal(unproven?.allActionsVerified, false);
assert.deepEqual(unproven?.actions.map((action) => action.status), ['outcome_unknown', 'outcome_unknown']);

console.log('computer-task exact completion proof smoke: all assertions passed');
