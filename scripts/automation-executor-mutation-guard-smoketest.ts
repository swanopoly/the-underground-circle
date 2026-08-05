/**
 * Adversarial smoke for automation-executor model-authored mutations.
 *
 * The Deno entrypoint cannot be imported by Node because it registers a
 * server and uses URL imports. This smoke executes its dependency-free policy
 * helpers in a VM, then pins the database/dispatch ordering in source.
 *
 * Run:
 *   npx tsx scripts/automation-executor-mutation-guard-smoketest.ts
 */

import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(
  'supabase/functions/automation-executor/index.ts',
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function section(start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const helperSource = section(
  'type AutomationMutationAuthorization = {',
  'function parseRoomFileActions(aiText: string)',
);
const objectHelper = section(
  'function isPlainObject(value: unknown)',
  'function boundedString(value: unknown',
);
const compiled = ts.transpileModule(
  `${objectHelper}
${helperSource}
;(globalThis as any).__automationMutationGuard = {
  redactAutomationText,
  resolveCircleRoomId,
  validateExactMutationApprovalRecord,
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const sandbox: Record<string, unknown> = {
  crypto: webcrypto,
  TextEncoder,
};
vm.runInNewContext(compiled, sandbox);
const core = sandbox.__automationMutationGuard as {
  redactAutomationText: (value: unknown, maxLength?: number) => string;
  resolveCircleRoomId: (
    client: unknown,
    circleId: string,
    roomReference: string,
  ) => Promise<string | null>;
  validateExactMutationApprovalRecord: (
    approval: unknown,
    identity: Record<string, unknown>,
    now?: number,
  ) => string | null;
};

async function main() {
const circleA = '11111111-1111-4111-8111-111111111111';
const circleB = '22222222-2222-4222-8222-222222222222';
const roomB = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const automationId = '55555555-5555-4555-8555-555555555555';
const approvalId = '66666666-6666-4666-8666-666666666666';
const fingerprint = `args-v2:sha256:${'a'.repeat(64)}`;
const contractFingerprint = `args-v2:sha256:${'b'.repeat(64)}`;

function roomClient() {
  const filters = new Map<string, unknown>();
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    ilike: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    maybeSingle: async () => {
      const ownsRoom = filters.get('circle_id') === circleB
        && filters.get('id') === roomB;
      return { data: ownsRoom ? { id: roomB } : null, error: null };
    },
  };
  return {
    from: (table: string) => {
      assert(table === 'circle_rooms', 'room resolver only queries circle_rooms');
      return builder;
    },
    filters,
  };
}

console.log('Cross-circle UUID resolution');
{
  const wrongCircle = roomClient();
  assert(
    await core.resolveCircleRoomId(wrongCircle, circleA, roomB) === null,
    'a valid UUID from another circle resolves to no target',
  );
  assert(
    wrongCircle.filters.get('circle_id') === circleA
      && wrongCircle.filters.get('id') === roomB,
    'UUID resolution binds circle ownership and target id in one query',
  );
  const ownCircle = roomClient();
  assert(
    await core.resolveCircleRoomId(ownCircle, circleB, roomB) === roomB,
    'an active room resolves only inside its owning circle',
  );
}

console.log('Exact, fresh, single-use authority');
{
  const now = Date.parse('2026-07-27T12:00:00.000Z');
  const identity = {
    userId: '77777777-7777-4777-8777-777777777777',
    circleId: circleA,
    runId,
    automationId,
    tool: 'automation.room_file_action',
    toolUseId: 'automation-file-1',
    actionId: 'room-file-1',
    toolArgsFingerprint: fingerprint,
    contractFingerprint,
    idempotencyKey: `automation:${automationId}:${runId}:room-file-1`,
  };
  const exactApproval = {
    id: approvalId,
    run_id: runId,
    circle_id: circleA,
    approval_kind: 'file_write',
    status: 'approved',
    resolved_by: identity.userId,
    requested_at: '2026-07-27T11:58:00.000Z',
    resolved_at: '2026-07-27T11:59:00.000Z',
    timeout_seconds: 300,
    payload: {
      authorizationVersion: 1,
      automationId,
      runId,
      actionId: identity.actionId,
      tool: identity.tool,
      toolArgsFingerprint: fingerprint,
      contractFingerprint,
      redacted: true,
    },
  };
  assert(
    core.validateExactMutationApprovalRecord(exactApproval, identity, now) === null,
    'fresh approval passes only for its exact automation/run/action/fingerprints',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      { ...exactApproval, circle_id: circleB },
      identity,
      now,
    ) === 'authority_not_live',
    'cross-circle approval is rejected',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      {
        ...exactApproval,
        requested_at: '2026-07-27T11:39:00.000Z',
        resolved_at: '2026-07-27T11:40:00.000Z',
      },
      identity,
      now,
    ) === 'authority_expired',
    'stale approval is rejected',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      {
        ...exactApproval,
        payload: {
          ...exactApproval.payload,
          consumedByActionId: identity.actionId,
        },
      },
      identity,
      now,
    ) === 'authority_identity_mismatch',
    'already-consumed approval cannot be reused',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      {
        ...exactApproval,
        payload: { ...exactApproval.payload, actionId: 'room-file-2' },
      },
      identity,
      now,
    ) === 'authority_identity_mismatch',
    'generic or differently bound approval is rejected',
  );
}

console.log('Redaction behavior');
{
  const redacted = core.redactAutomationText(
    `[FILE_ACTIONS][{"action":"create","room":"secret-room","file":"/Users/alice/private.txt","content":"sk-secretvalue"}][/FILE_ACTIONS]
password=hunter2
safe summary`,
    1000,
  );
  assert(!redacted.includes('private.txt'), 'file path is removed from persisted text');
  assert(!redacted.includes('secretvalue'), 'file content/secret is removed from persisted text');
  assert(!redacted.includes('hunter2'), 'credential value is removed from persisted text');
  assert(redacted.includes('[FILE_MUTATION_REDACTED]'), 'mutation block has an explicit redaction marker');
}

console.log('Dispatch and retry source contract');
{
  const execute = section(
    'async function executeRoomFileActions(',
    '// ─── Output routing',
  );
  const approvalAt = execute.indexOf('consumeExactMutationApproval(execution, identity)');
  const claimAt = execute.indexOf('"claim_agent_action_call"');
  const startAt = execute.indexOf('"start_agent_action_call"');
  const markAt = execute.indexOf('execution.markDispatched()');
  const firstWriteAt = execute.indexOf('.update({ is_deleted: true', markAt);
  const finishAt = execute.indexOf('"finish_agent_action_call"');
  assert(
    approvalAt >= 0
      && approvalAt < claimAt
      && claimAt < startAt
      && startAt < markAt
      && markAt < firstWriteAt
      && firstWriteAt < finishAt,
    'exact authority -> fresh claim -> dispatched -> one write -> finish ordering is pinned',
  );
  assert(
    execute.includes('claim.disposition !== "claimed"')
      && execute.includes('claim.attemptCount !== 1'),
    'competing or reclaimed durable claim never dispatches',
  );
  assert(
    execute.includes('const finalState = verified ? "verified" : "outcome_unknown"')
      && execute.includes('outcome_unknown:file_mutation'),
    'ambiguous post-dispatch evidence seals outcome_unknown',
  );
  assert(
    !execute.includes('.from("room_messages")')
      && !execute.includes('results.push(`✓')
      && !execute.includes('err.message'),
    'mutation execution emits no raw path/content/error side channel or second message write',
  );

  const catchBlock = section(
    '} catch (execErr: any) {',
    'throw execErr;',
  );
  assert(
    catchBlock.includes('&& !externalMutationMayHaveDispatched')
      && catchBlock.includes('&& !mutationBlockedNoRetry')
      && catchBlock.includes('&& !requestedRunId'),
    'whole-automation retry is disabled after dispatch, safety blocks, and exact runs',
  );
  assert(
    source.includes('.is("payload->>consumedByActionId", null)')
      && source.includes('.eq("payload->>toolArgsFingerprint", identity.toolArgsFingerprint)'),
    'approval consumption uses an exact conditional single-use update',
  );
  assert(
    source.includes('.eq("circle_id", circleId)')
      && source.includes('.eq("user_id", authedUser.id)')
      && source.includes('.in("status", ["planning", "running", "waiting_approval"])'),
    'caller-supplied run authority is authenticated and circle-bound',
  );
  assert(
    source.includes('Model output is never authorization')
      && !source.includes('You have FULL ACCESS to create, update, and delete files'),
    'the model prompt cannot imply its own mutation authority',
  );
}

console.log(`automation executor mutation guard smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
