/**
 * Rollout-safe source/behavior gate for universal-root ownership at the local
 * compiler dispatch boundary.
 *
 * Scope is deliberately narrow. The universal root is revalidated at runtime,
 * then exactly one compiler attempt may be claimed for either the exact
 * Photoshop program or the strict named-app lifecycle program. The claim is
 * after route identity and preflight checks but before any child run, bridge,
 * launch/focus, or document creation. Generic/provider/browser work does not
 * receive post-hoc root acceptance, and this stage never declares request-level
 * completion.
 *
 * Run: npx tsx scripts/computer-task-root-runtime-gate-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  admitComputerTaskRuntimeRoot,
  transitionComputerTaskRuntimeRoot,
  validateComputerTaskRuntimeRootBinding,
  type ComputerTaskRootRpcClient,
} from '../src/lib/computerTaskRootStore';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const runtimeSource = readFileSync(`${repoRoot}/src/lib/computerTaskRuntime.ts`, 'utf8');
const storeSource = readFileSync(`${repoRoot}/src/lib/computerTaskRootStore.ts`, 'utf8');
const chatSource = readFileSync(`${repoRoot}/src/screens/circles/tabs/ChatTab.tsx`, 'utf8');

let assertions = 0;
const failures: string[] = [];

function check(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) failures.push(message);
}

function sliceBetween(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(start >= 0, `${label}: start marker exists`);
  check(end > start, `${label}: end marker follows start`);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function indicesOf(source: string, pattern: RegExp): number[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  return Array.from(source.matchAll(matcher), (match) => match.index ?? -1).filter((index) => index >= 0);
}

function containsRootBindingReference(source: string, aliases: readonly string[]): boolean {
  return source.includes('universalRootValidation.binding')
    || aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(source));
}

function assertCompilerBoundary(input: {
  branch: string;
  label: string;
  childRootMarker: string;
  childExecutorMarker: string;
  bindingAliases: readonly string[];
}): void {
  const attemptMarkers = indicesOf(input.branch, /type\s*:\s*['"]begin_attempt['"]/g);
  check(attemptMarkers.length === 1, `${input.label}: exactly one universal-root begin_attempt is issued`);
  const attempt = attemptMarkers[0] ?? -1;
  const compilerKind = attempt >= 0
    ? input.branch.slice(attempt, attempt + 500).search(/kind\s*:\s*['"]compiler['"]/) >= 0
    : false;
  check(compilerKind, `${input.label}: the root attempt is compiler-owned`);

  const preflight = input.branch.indexOf('execution.preflight.blockers.length > 0');
  const identityBuild = input.branch.indexOf('buildExactSequenceRequestIdentityFingerprint({');
  const identityGuard = input.branch.indexOf('if (!EXACT_SEQUENCE_SHA256_RE.test(requestIdentityFingerprint))');
  const childRoot = input.branch.indexOf(input.childRootMarker);
  const childExecutor = input.branch.indexOf(input.childExecutorMarker);
  check(preflight >= 0, `${input.label}: preflight blocker gate exists`);
  check(identityBuild > preflight, `${input.label}: stable request identity is built after preflight`);
  check(identityGuard > identityBuild, `${input.label}: stable request identity is validated`);
  check(attempt > identityGuard, `${input.label}: root attempt starts only after preflight and identity validation`);
  check(childRoot > attempt, `${input.label}: child run/root creation follows the universal attempt claim`);
  check(childExecutor > childRoot, `${input.label}: bridge-owning child executor follows child-root creation`);

  const claimWindow = attempt >= 0 && childRoot > attempt
    ? input.branch.slice(attempt, childRoot)
    : '';
  check(
    containsRootBindingReference(claimWindow, input.bindingAliases),
    `${input.label}: attempt transition consumes the revalidated binding, never the caller-owned stale binding`,
  );
  check(/if\s*\(/.test(claimWindow), `${input.label}: attempt ownership result is checked before child dispatch`);
  check(
    /return\s+(?:exactSequenceBlockedResult|deterministicLocalCancelledResult|\{)/.test(claimWindow),
    `${input.label}: a non-owner returns before child dispatch`,
  );
  check(
    /duplicate|already|active|in[ -]?progress|owner|claim|attempt|state[_ ]?conflict/i.test(claimWindow),
    `${input.label}: duplicate/in-progress ownership loss is handled explicitly`,
  );
  check(
    /no (?:desktop |app )?(?:action|activation)|nothing (?:was |is )?(?:launched|focused|created|executed)|without (?:launch|focus|create|dispatch)/i.test(claimWindow),
    `${input.label}: loser result states that no native side effect was dispatched`,
  );
  check(
    !/photoshopCreateDocument\s*\(|executeObservedNativeAppActivation\s*\(|\.(?:launchApp|focusApp)\s*\(/.test(claimWindow),
    `${input.label}: ownership-loss handling cannot launch, focus, activate, or create`,
  );
}

function assertChildDispatchDisposition(input: {
  executor: string;
  label: string;
  durableClaimMarker: string;
}): void {
  const durableClaim = input.executor.indexOf(input.durableClaimMarker);
  check(durableClaim > 0, `${input.label}: durable §26 claim boundary exists`);
  const preClaim = durableClaim > 0 ? input.executor.slice(0, durableClaim) : '';
  const claimOrLater = durableClaim > 0 ? input.executor.slice(durableClaim) : '';
  check(
    preClaim.includes("'pre_action_claim_terminal'"),
    `${input.label}: safe terminal exits before §26 claim are explicitly retryable`,
  );
  check(
    !claimOrLater.includes("'pre_action_claim_terminal'"),
    `${input.label}: no §26 claim-or-later path can reopen the universal attempt`,
  );
  check(
    claimOrLater.includes("'action_claimed_or_later'"),
    `${input.label}: claim, prior-ledger, dispatch, and ambiguity paths retain lockout`,
  );
}

async function runBehaviorChecks(): Promise<void> {
  // A false rollout flag must stay entirely in the memory coordinator even if
  // a hostile/trap RPC client is available in options.
  const rolloutKey = 'EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1';
  const priorRollout = process.env[rolloutKey];
  let rpcCalls = 0;
  const trapClient: ComputerTaskRootRpcClient = {
    rpc: async () => {
      rpcCalls += 1;
      throw new Error('root RPC must not run while rollout is off');
    },
  };
  const admittedAt = '2026-08-06T18:00:00.000Z';
  const admissionInput = {
    schemaVersion: 1 as const,
    requestIdentity: `runtime-gate-${process.pid}`,
    userId: 'runtime-gate-user',
    circleId: 'runtime-gate-circle',
    threadId: 'runtime-gate-thread',
    source: 'chat' as const,
    normalizedTask: 'Open Photoshop and create a 600 x 600 blank document',
    admittedAt,
  };

  try {
    process.env[rolloutKey] = 'false';
    const admitted = await admitComputerTaskRuntimeRoot(admissionInput, { client: trapClient });
    check(admitted.ok, 'rollout-off runtime root admission succeeds in memory');
    if (!admitted.ok) return;
    check(admitted.binding.durability === 'memory', 'rollout-off runtime binding is explicitly memory-backed');
    check(admitted.binding.durableRecord === null, 'rollout-off runtime binding carries no durable record');
    const revalidated = await validateComputerTaskRuntimeRootBinding(admitted.binding, admissionInput);
    check(revalidated.ok, 'rollout-off runtime binding revalidates locally');
    check(rpcCalls === 0, 'rollout-off admission and revalidation perform zero root RPCs');

    // A proven bridge/preflight terminal happens before §26 claim. The runtime
    // releases that compiler attempt as failed so a ready same-request retry
    // can own a new attempt. Once that retry reaches claim-or-later, leaving
    // the attempt active blocks every duplicate and preserves no-replay truth.
    const first = await transitionComputerTaskRuntimeRoot(
      admitted.binding,
      admissionInput,
      {
        type: 'begin_attempt',
        kind: 'compiler',
        parentAttemptId: null,
        at: '2026-08-06T18:00:01.000Z',
      },
      { client: trapClient },
    );
    check(first.ok, 'the admitted root accepts its first compiler attempt');
    if (first.ok) {
      const firstAttempt = first.binding.root.attempts[0];
      check(first.binding.root.attempts.length === 1, 'the first compiler claim creates exactly one attempt');
      check(firstAttempt?.state === 'active', 'the winning compiler attempt is active');
      if (firstAttempt) {
        const bridgeBlocked = await transitionComputerTaskRuntimeRoot(
          first.binding,
          admissionInput,
          {
            type: 'finish_attempt',
            attemptId: firstAttempt.attemptId,
            outcome: 'failed',
            at: '2026-08-06T18:00:02.000Z',
          },
          { client: trapClient },
        );
        check(bridgeBlocked.ok, 'a proven pre-action-claim bridge blocker releases the owned attempt');
        if (bridgeBlocked.ok) {
          check(bridgeBlocked.binding.root.state === 'paused', 'the pre-claim terminal pauses the universal root');
          check(bridgeBlocked.binding.root.attempts[0]?.state === 'failed', 'the released pre-claim attempt is terminally failed');
          const readyRetry = await transitionComputerTaskRuntimeRoot(
            bridgeBlocked.binding,
            admissionInput,
            {
              type: 'begin_attempt',
              kind: 'compiler',
              parentAttemptId: null,
              at: '2026-08-06T18:00:03.000Z',
            },
            { client: trapClient },
          );
          check(readyRetry.ok, 'the same request can retry after its pre-claim bridge blocker clears');
          if (readyRetry.ok) {
            check(readyRetry.binding.root.attempts.length === 2, 'the ready retry appends exactly one new compiler attempt');
            check(readyRetry.binding.root.attempts[1]?.state === 'active', 'the ready retry owns the active compiler attempt');
            const claimedOrLaterDuplicate = await transitionComputerTaskRuntimeRoot(
              readyRetry.binding,
              admissionInput,
              {
                type: 'begin_attempt',
                kind: 'compiler',
                parentAttemptId: null,
                at: '2026-08-06T18:00:04.000Z',
              },
              { client: trapClient },
            );
            check(!claimedOrLaterDuplicate.ok, 'claim-or-later ownership blocks a duplicate same-request retry');
            if (!claimedOrLaterDuplicate.ok) {
              check(claimedOrLaterDuplicate.code === 'invalid_transition', 'claim-or-later lockout has a stable transition failure');
            }
            check(readyRetry.binding.root.attempts.length === 2, 'claim-or-later lockout cannot append a third attempt');
          }
        }
      }
    }
    check(rpcCalls === 0, 'pre-claim retry and claim-or-later lockout stay zero-RPC with rollout off');
  } finally {
    if (priorRollout === undefined) delete process.env[rolloutKey];
    else process.env[rolloutKey] = priorRollout;
  }
}

async function main(): Promise<void> {
  const executeStart = runtimeSource.indexOf('export async function executeComputerTaskWithAgent(args: {');
  check(executeStart >= 0, 'executeComputerTaskWithAgent exists');
  const executeSource = executeStart >= 0 ? runtimeSource.slice(executeStart) : '';

  // Runtime reauthentication is the first meaningful dependency. No route,
  // provider, planner, bridge, or child run may precede it.
  const validation = executeSource.indexOf('await validateComputerTaskRuntimeRootBinding(');
  const validationFailure = executeSource.indexOf('if (!universalRootValidation.ok)');
  const firstRouting = executeSource.indexOf('prepareComputerTaskExecution({');
  const firstProvider = executeSource.indexOf('loadCircleBusinessModelProfiles(');
  const firstClarifier = executeSource.indexOf('runComputerTaskClarifierCheck({');
  const firstChildRoot = Math.min(
    ...[
      executeSource.indexOf('await createExactSequenceRootRun({'),
      executeSource.indexOf('await createLifecycleRootRun({'),
    ].filter((index) => index >= 0),
  );
  check(validation >= 0, 'runtime revalidates the universal root');
  check(validationFailure > validation, 'runtime fails closed when universal-root revalidation fails');
  check(firstRouting > validationFailure, 'root revalidation precedes task routing/preflight');
  check(firstProvider > validationFailure, 'root revalidation precedes provider-key/business-profile reads');
  check(firstClarifier > validationFailure, 'root revalidation precedes the model clarifier');
  check(firstChildRoot > validationFailure, 'root revalidation precedes every compiler child run');

  const validationCall = validation >= 0 ? executeSource.slice(validation, validation + 900) : '';
  for (const expected of [
    'args.universalTaskRoot',
    'requestIdentity: args.requestIdentity',
    'userId: args.userId',
    'circleId: args.circleId',
    'threadId: args.threadId ?? null',
    "source: 'chat'",
    'normalizedTask: args.task',
  ]) {
    check(validationCall.includes(expected), `runtime root revalidation binds ${expected}`);
  }
  const validationFailureBlock = validation >= 0 && firstRouting > validation
    ? executeSource.slice(validationFailure, firstRouting)
    : '';
  check(
    /throw new Error\(['"]Safe computer-task root validation failed before execution\./.test(validationFailureBlock),
    'revalidation failure throws a stable fail-closed error before execution',
  );

  const aliasMatches = Array.from(
    executeSource.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*universalRootValidation\.binding\s*;/g),
    (match) => match[1],
  );

  const exactBranch = sliceBetween(
    executeSource,
    'if (sequenceProgram && exactSequenceAuthorized) {',
    'if (args.deterministicLifecycleReadProgram) {',
    'exact Photoshop compiler branch',
  );
  const lifecycleBranch = sliceBetween(
    executeSource,
    'if (args.deterministicLifecycleReadProgram) {',
    '// Learned per-app facts still gate',
    'strict named-app lifecycle branch',
  );
  const genericStart = executeSource.indexOf('// Learned per-app facts still gate');
  const genericSource = genericStart >= 0 ? executeSource.slice(genericStart) : '';

  assertCompilerBoundary({
    branch: exactBranch,
    label: 'exact Photoshop compiler branch',
    childRootMarker: 'await createExactSequenceRootRun({',
    childExecutorMarker: 'await executeAuthorizedExactSequenceProgram({',
    bindingAliases: aliasMatches,
  });
  assertCompilerBoundary({
    branch: lifecycleBranch,
    label: 'strict named-app lifecycle branch',
    childRootMarker: 'await createLifecycleRootRun({',
    childExecutorMarker: 'await executeAuthorizedDeterministicLifecycleReadProgram({',
    bindingAliases: aliasMatches,
  });

  check(
    /type CompilerChildDispatchDisposition\s*=\s*\| 'pre_action_claim_terminal'\s*\| 'action_claimed_or_later'/.test(runtimeSource),
    'compiler child execution has an explicit typed pre-claim versus claim-or-later disposition',
  );
  const exactExecutor = sliceBetween(
    runtimeSource,
    'async function executeAuthorizedExactSequenceProgram(input: {',
    '\nfunction safeExactAuthorityId(',
    'exact Photoshop child executor',
  );
  const lifecycleExecutor = sliceBetween(
    runtimeSource,
    'async function executeAuthorizedDeterministicLifecycleReadProgram(input: {',
    '/**\n * Detects whether an app-task utterance',
    'named-app lifecycle child executor',
  );
  assertChildDispatchDisposition({
    executor: exactExecutor,
    label: 'exact Photoshop child executor',
    durableClaimMarker: 'const durableClaim = await claimExactPhotoshopDurableAction({',
  });
  assertChildDispatchDisposition({
    executor: lifecycleExecutor,
    label: 'named-app lifecycle child executor',
    durableClaimMarker: 'const durableClaim = await claimLifecycleDurableAction({ root, program });',
  });
  check(
    /const exactResult = await executeAuthorizedExactSequenceProgram\(\{[\s\S]*?finishCompilerAttemptAfterPreClaimResult\(exactResult,[\s\S]*?return settleExactSequenceRootRun\(root, exactResult\)/.test(exactBranch),
    'exact caller releases only a proven pre-claim terminal before returning the unchanged child result',
  );
  check(
    /const lifecycleResult = await executeAuthorizedDeterministicLifecycleReadProgram\(\{[\s\S]*?finishCompilerAttemptAfterPreClaimResult\(lifecycleResult,[\s\S]*?return settleExactSequenceRootRun\(lifecycleRoot, lifecycleResult\)/.test(lifecycleBranch),
    'lifecycle caller releases only a proven pre-claim terminal before returning the unchanged child result',
  );
  check(
    /const finishCompilerAttemptAfterPreClaimResult = async[\s\S]*?if \(childResult\.dispatchDisposition !== 'pre_action_claim_terminal'\) return;[\s\S]*?finishCompilerAttemptAfterPreClaimTerminal\(ownedBinding, attemptId\)/.test(executeSource),
    'shared child-result settlement cannot release a claim-or-later compiler attempt',
  );

  const allAttemptMarkers = indicesOf(executeSource, /type\s*:\s*['"]begin_attempt['"]/g);
  check(allAttemptMarkers.length === 2, 'executeComputerTaskWithAgent has exactly two mutually exclusive compiler attempt callsites');
  check(
    indicesOf(executeSource, /kind\s*:\s*['"](?:deterministic|provider|connected_agent|capability_buildout|recovery)['"]/g).length === 0,
    'runtime does not mint universal attempts for generic/provider/recovery paths',
  );

  // Generic/provider work must not receive post-hoc ownership or acceptance.
  check(!/type\s*:\s*['"]begin_attempt['"]/.test(genericSource), 'generic/provider runtime has no universal-root attempt claim');
  check(!/type\s*:\s*['"]bind_acceptance['"]/.test(genericSource), 'generic/provider runtime has no post-hoc root acceptance');
  check(!/type\s*:\s*['"]complete['"]/.test(genericSource), 'generic/provider runtime cannot complete the universal request root');
  check(!/type\s*:\s*['"]bind_acceptance['"]/.test(executeSource), 'this rollout stage never binds post-hoc request acceptance');
  check(!/type\s*:\s*['"]complete['"]/.test(executeSource), 'this rollout stage never issues request-level completion');
  check(!/completionProofFingerprint\s*:/.test(executeSource), 'runtime does not synthesize a request completion proof');

  // Browser execution is correlation-only and bypasses this native compiler
  // attempt seam. Check both cloud starts and the Browser Plan projection area.
  const browserPlanStart = chatSource.indexOf('const plan = await describeComputerUsePlan({');
  const browserAutoStart = chatSource.indexOf('const autoStarted = await computerUseTask.run(trimmed, {', browserPlanStart);
  const browserApprovedStart = chatSource.indexOf('const started = await computerUseTask.run(taskToRun, {', browserAutoStart);
  check(browserPlanStart >= 0 && browserAutoStart > browserPlanStart, 'browser plan and auto-start seams exist');
  check(browserApprovedStart > browserAutoStart, 'approved browser-plan start seam exists');
  const browserSource = browserPlanStart >= 0 && browserApprovedStart > browserPlanStart
    ? chatSource.slice(browserPlanStart, browserApprovedStart + 900)
    : '';
  check(!/type\s*:\s*['"]begin_attempt['"]/.test(browserSource), 'browser plan/cloud starts do not claim a local compiler attempt');
  check(!/type\s*:\s*['"]bind_acceptance['"]/.test(browserSource), 'browser plan/cloud starts do not bind post-hoc root acceptance');
  check(!/type\s*:\s*['"]complete['"]/.test(browserSource), 'browser plan/cloud starts do not issue request-level root completion');
  check(
    /computerTaskRootPointer: (?:browserPlan|planToRun\?)\.computerTaskRootPointer/.test(browserSource),
    'browser starts carry only their inert root pointer correlation',
  );

  // The binding adapter itself must preserve the rollout split. The runtime
  // may call it by any name; source semantics and the behavior test below are
  // what this gate intentionally fixes.
  check(storeSource.includes("durability: 'memory' | 'database'"), 'runtime binding has an explicit memory/database rollout split');
  check(storeSource.includes('isDurableComputerTaskRootRolloutEnabled()'), 'durable root behavior remains behind the rollout flag');
  check(storeSource.includes("binding.durability === 'database'"), 'binding-aware store logic branches explicitly for database authority');

  await runBehaviorChecks();

  if (failures.length > 0) {
    console.error(`computer task root runtime gate failed (${failures.length}/${assertions} assertions):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`computer task root runtime gate passed (${assertions} assertions)`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
