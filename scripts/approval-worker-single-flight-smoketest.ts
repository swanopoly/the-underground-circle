/**
 * Regression contract for worker-owned `agent_approvals` execution.
 *
 * Covers process-local coalescing, the durable one-winner claim seam, and
 * source-order pins proving every handler validates/preflights before it claims
 * and claims before its first mutation or transport.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  claimApprovalExecution,
  type ApprovalExecutionClaimWrite,
} from '../src/lib/approvalExecutionClaim';
import { createApprovalSingleFlight } from '../src/lib/approvalSingleFlight';

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`approval worker smoke failed: ${message}`);
}

function section(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker);
  check(start >= 0, `source marker exists: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  check(end >= 0, `source marker exists: ${endMarker || '<eof>'}`);
  return source.slice(start, end);
}

function ordered(source: string, markers: string[], message: string): void {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1);
    check(current > previous, `${message}: ${marker}`);
    previous = current;
  }
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

async function main(): Promise<void> {
  // Same-process UI + sweep calls share one promise. This reduces duplicate
  // preflight work, but the durable claim below remains the safety boundary.
  const singleFlight = createApprovalSingleFlight<string>();
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const task = async () => {
    calls += 1;
    await blocked;
    return 'applied';
  };

  const first = singleFlight('approval-1', task);
  const second = singleFlight('approval-1', task);
  check(first === second, 'concurrent calls for one approval share the same promise');
  await Promise.resolve();
  check(calls === 1, 'concurrent same-process calls invoke the task once');
  release();
  check((await first) === 'applied' && (await second) === 'applied', 'coalesced callers share the result');

  let retryCalls = 0;
  const retrying = createApprovalSingleFlight<string>();
  const failOnce = async () => {
    retryCalls += 1;
    if (retryCalls === 1) throw new Error('pre-dispatch validation failed');
    return 'retried';
  };
  await retrying('approval-2', failOnce).catch(() => undefined);
  check(await retrying('approval-2', failOnce) === 'retried', 'pre-dispatch failure clears process-local flight');
  check(retryCalls === 2, 'explicit retry can re-run after pre-dispatch failure');

  // Two independent callers (representing different tabs/processes) both pass
  // the snapshot read, but an atomic writer lets exactly one null->timestamp
  // transition win.
  const durableRow = {
    id: 'approval-race',
    actionType: 'chat.review_comment',
    status: 'approved',
    appliedAt: null as string | null,
  };
  let durableWrites = 0;
  const atomicWriter: ApprovalExecutionClaimWrite = async (input) => {
    durableWrites += 1;
    check(input.executableStatuses.includes('approved'), 'claim writer receives approved status floor');
    check(input.executableStatuses.includes('auto_approved'), 'claim writer receives auto-approved status floor');
    if (
      input.approvalId !== durableRow.id
      || input.expectedActionType !== durableRow.actionType
      || !input.executableStatuses.includes(durableRow.status as 'approved')
      || durableRow.appliedAt !== null
    ) {
      return { data: [], error: null };
    }
    durableRow.appliedAt = input.claimedAt;
    return { data: [{ id: durableRow.id }], error: null };
  };
  const race = await Promise.all([
    claimApprovalExecution(durableRow.id, durableRow.actionType, atomicWriter),
    claimApprovalExecution(durableRow.id, durableRow.actionType, atomicWriter),
  ]);
  check(race.filter((item) => item.ok && item.claimed).length === 1, 'durable race has exactly one winner');
  check(race.filter((item) => item.ok && !item.claimed).length === 1, 'durable race has exactly one loser');
  check(durableWrites === 2, 'independent contenders both reach the durable CAS');
  check(typeof durableRow.appliedAt === 'string', 'winning CAS records its dispatch claim');

  const changedStatusWriter: ApprovalExecutionClaimWrite = async () => ({ data: [], error: null });
  const changedStatus = await claimApprovalExecution('approval-status', 'skill.create', changedStatusWriter);
  check(changedStatus.ok && !changedStatus.claimed, 'zero-row status/action/null mismatch loses without dispatch');
  const dbError = await claimApprovalExecution('approval-error', 'skill.create', async () => ({
    data: null,
    error: { message: 'private database detail' },
  }));
  check(!dbError.ok && !dbError.error.includes('private database detail'), 'claim DB errors fail closed and stay redacted');
  const thrown = await claimApprovalExecution('approval-throw', 'skill.create', async () => {
    throw new Error('private thrown detail');
  });
  check(!thrown.ok && !thrown.error.includes('private thrown detail'), 'claim exceptions fail closed and stay redacted');
  const invalidRows = await claimApprovalExecution('approval-invalid', 'skill.create', async () => ({
    data: [{ id: 'approval-invalid' }, { id: 'approval-invalid' }],
    error: null,
  }));
  check(!invalidRows.ok, 'claim requires exactly one returned row');
  let missingIdentityWrites = 0;
  const missingIdentity = await claimApprovalExecution('', '', async () => {
    missingIdentityWrites += 1;
    return { data: [], error: null };
  });
  check(!missingIdentity.ok && missingIdentityWrites === 0, 'missing claim identity fails before database access');

  const worker = fs.readFileSync(path.join(process.cwd(), 'src/lib/agentApprovalsWorker.ts'), 'utf8');
  const skill = fs.readFileSync(path.join(process.cwd(), 'src/lib/skillLibraryWrite.ts'), 'utf8');
  const memory = fs.readFileSync(path.join(process.cwd(), 'src/lib/circleMemoryCompaction.ts'), 'utf8');
  const sharedMemory = fs.readFileSync(path.join(process.cwd(), 'src/services/sharedMemory.ts'), 'utf8');
  const claim = fs.readFileSync(path.join(process.cwd(), 'src/lib/approvalExecutionClaim.ts'), 'utf8');

  const workerPreamble = section(
    worker,
    'async function applyApprovedActionOnce(',
    '// Route by action_type prefix',
  );
  check(!workerPreamble.includes('.update({ applied_at'), 'dispatcher does not pre-claim before handler validation');
  const knownRoutes = section(worker, '// Route by action_type prefix', '// Unknown kind');
  check(knownRoutes.includes('await applyApprovedSkillAction(approvalId)'), 'skill route remains wired');
  check(knownRoutes.includes('await applyApprovedMemoryCompaction(approvalId)'), 'memory route remains wired');
  check(knownRoutes.includes('await applyApprovedUserMemoryAction(approvalId, data)'), 'user-memory route remains wired');
  check(knownRoutes.includes('await applyApprovedReviewCommentAction(approvalId, data)'), 'review-comment route remains wired');

  ordered(claim, [
    ".update({ applied_at: input.claimedAt })",
    ".eq('id', input.approvalId)",
    ".eq('action_type', input.expectedActionType)",
    ".in('status', [...input.executableStatuses])",
    ".is('applied_at', null)",
    ".select('id')",
  ], 'durable claim binds id/action/status/null and returns the winner');
  check(claim.includes('result.data.length !== 1'), 'durable claim requires exactly one returned row');

  const unknownRoute = section(worker, '// Unknown kind', '} catch (e)');
  check(unknownRoute.includes(".eq('action_type', actionType)"), 'unknown terminal skip binds action type');
  check(unknownRoute.includes(".in('status', ['approved', 'auto_approved'])"), 'unknown terminal skip binds executable status');
  check(unknownRoute.includes(".is('applied_at', null)"), 'unknown terminal skip is a one-winner CAS');

  const skillApply = section(skill, 'export async function applyApprovedSkillAction(');
  check(skillApply.includes(".select('id, action_type, status, payload, applied_at')"), 'skill handler reloads action identity');
  check(skillApply.includes('approval.action_type !== expectedActionType'), 'skill payload action must match durable action_type');
  check(
    count(skillApply, 'claimApprovalExecution(approvalId, expectedActionType)') === 5,
    'all five skill mutation variants own a claim boundary',
  );
  const skillCreate = section(skillApply, "if (action === 'create')", "} else if (action === 'patch')");
  ordered(skillCreate, ['if (!content)', 'if (!description)', 'claimApprovalExecution(', ".from('circle_skills')", '.insert({'], 'skill.create validates then claims then inserts');
  const skillPatch = section(skillApply, "} else if (action === 'patch')", "} else if (action === 'delete')");
  ordered(skillPatch, ['Object.keys(updates).length === 1', 'claimApprovalExecution(', ".from('circle_skills')", '.update(updates)'], 'skill.patch validates then claims then updates');
  const skillDelete = section(skillApply, "} else if (action === 'delete')", "} else if (action === 'write_file' || action === 'remove_file')");
  ordered(skillDelete, ['claimApprovalExecution(', ".from('circle_skills')", '.delete()'], 'skill.delete claims immediately before delete');
  const skillSubfiles = section(
    skillApply,
    "} else if (action === 'write_file' || action === 'remove_file')",
    "} else {\n      return { ok: false, error: `unknown action",
  );
  const writeFile = section(skillSubfiles, "if (action === 'write_file')", 'const { data: removed');
  ordered(skillSubfiles, ['if (!relpath)', 'if (lookupErr)', "if (action === 'write_file')"], 'skill subfiles finish parent lookup before either claim');
  ordered(writeFile, ['content.length === 0', 'const mimeType', 'claimApprovalExecution(', ".from('circle_skill_files')", '.upsert({'], 'skill.write_file validates then claims then upserts');
  const removeFile = section(skillSubfiles, '      } else {');
  ordered(removeFile, ['claimApprovalExecution(', ".from('circle_skill_files')", '.delete()'], 'skill.remove_file claims immediately before delete');
  check(!skillApply.includes('.update({ applied_at:'), 'skill handler has no post-write unguarded stamp');

  const memoryApply = section(memory, 'export async function applyApprovedMemoryCompaction(', '// ─── Default summarizer');
  check(memoryApply.includes("approval.action_type !== 'memory.compact'"), 'memory handler binds the exact action type');
  ordered(memoryApply, ['const guardBaseContent', 'const claimBeforeMutation', 'const writeResult = await updateMemoryDoc('], 'memory validates before constructing its guarded write');
  check(memoryApply.includes('beforeMutation: claimBeforeMutation'), 'memory passes its claim into the canonical write planner');
  check(!memoryApply.includes('.update({ applied_at:'), 'memory handler has no post-write unguarded stamp');

  const sharedWrite = section(sharedMemory, 'export async function updateMemoryDoc(', 'export async function getMemoryHistory(');
  const firstMutationGate = sharedWrite.indexOf('const gateFailure = await authorizeFirstMutation');
  check(sharedWrite.indexOf("if (plan.action === 'refuse')") < firstMutationGate, 'memory refusal exits before claim');
  check(sharedWrite.indexOf("if (plan.action === 'noop')") < firstMutationGate, 'memory no-op exits before claim');
  check(firstMutationGate < sharedWrite.indexOf(".from('circle_memory').insert"), 'memory insert claims immediately before first write');
  check(count(sharedWrite, 'const gateFailure = await authorizeFirstMutation') === 2, 'insert and update plans both reach the one-shot gate');
  const updatePlan = section(sharedWrite, "// action === 'update'", 'let updateQuery = supabase');
  ordered(updatePlan, ['authorizeFirstMutation', ".from('circle_memory_history')", '.insert('], 'memory update claims before history side effect');
  check(sharedWrite.includes('let mutationAuthorized = !opts?.beforeMutation'), 'memory retries reuse one winning claim');

  const userMemory = section(worker, 'async function applyApprovedUserMemoryAction(', '// ─── chat.review_comment apply path');
  ordered(userMemory, [
    'row.action_type !== expectedActionType',
    'looksLikeCredentialMemoryContent',
    'USER_MEMORY_HARD_CAP',
    ".from('user_memory')",
    '.maybeSingle()',
    'claimApprovalExecution(approvalId, expectedActionType)',
  ], 'user-memory validation and lookup precede its claim');
  const userClaim = userMemory.indexOf('claimApprovalExecution(approvalId, expectedActionType)');
  check(userClaim < userMemory.indexOf('.update({ content:'), 'user-memory replace update happens after claim');
  check(userClaim < userMemory.indexOf('.insert({ user_id:'), 'user-memory replace insert happens after claim');
  check(userClaim < userMemory.indexOf('.delete()'), 'user-memory delete happens after claim');
  check(!userMemory.includes('.update({ applied_at:'), 'user-memory handler has no post-write unguarded stamp');

  const review = section(worker, 'export async function applyApprovedReviewCommentAction(');
  ordered(review, [
    'row.action_type !== REVIEW_COMMENT_ACTION_TYPE',
    'validateReviewCommentApprovalPayload',
    'if (!circleId)',
    'token = await resolveToken',
    'if (!token)',
    'const commentBody = composeReviewCommentBody',
    'claimApprovalExecution(approvalId, REVIEW_COMMENT_ACTION_TYPE)',
    'posted = await postComment',
  ], 'review validates and resolves credentials before claim, then posts');
  check(!review.includes('.update({ applied_at:'), 'review handler has no post-transport unguarded stamp');
  check(review.includes('has an unknown outcome and was not retried automatically'), 'review transport exception remains consumed and non-retryable');

  console.log(`approval worker execution-claim smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
