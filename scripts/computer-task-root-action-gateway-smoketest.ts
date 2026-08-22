/**
 * Focused behavioral smoke for the feature-off atomic root/action gateway.
 *
 * Run: npx tsx scripts/computer-task-root-action-gateway-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  admitComputerTaskRuntimeRoot,
  consumeComputerTaskRootActionHandlerAuthority,
  createComputerTaskRootActionGateway,
  isComputerTaskRootActionGatewayRolloutEnabled,
  transitionComputerTaskRuntimeRoot,
  type ComputerTaskRootRpcClient,
  type ComputerTaskRuntimeRootBinding,
} from '../src/lib/computerTaskRootStore';

const ROOT_ROW_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CIRCLE_ID = '44444444-4444-4444-8444-444444444444';
const THREAD_ID = '55555555-5555-4555-8555-555555555555';
const CALL_ID = '66666666-6666-4666-8666-666666666666';
const CLAIM_TOKEN = '77777777-7777-4777-8777-777777777777';
const WRONG_CLAIM_TOKEN = '88888888-8888-4888-8888-888888888888';
const fp = (hex: string) => `args-v2:sha256:${hex.repeat(64)}`;
const TARGET_FINGERPRINT = fp('9');
const WRONG_TARGET_FINGERPRINT = fp('8');

type JsonRecord = Record<string, any>;
type RpcCall = Readonly<{ functionName: string; args: Record<string, unknown> }>;

function actionFromSnapshot(snapshot: JsonRecord, actionId?: string): JsonRecord {
  const actions = snapshot.acceptance?.actions as JsonRecord[] | undefined;
  const action = actions?.find((candidate) => !actionId || candidate.actionId === actionId);
  assert(action, 'snapshot contains the bound root action');
  return action;
}

function exactKeys(args: Record<string, unknown>, expected: string[]): void {
  assert.deepEqual(Object.keys(args).sort(), [...expected].sort());
}

async function main(): Promise<void> {
  const calls: RpcCall[] = [];
  let stored: JsonRecord | null = null;
  let actionMetadata: JsonRecord = {};
  let actionStateVersion = 0;
  let mode:
    | 'normal'
    | 'drift_identity'
    | 'disposition_mismatch'
    | 'claim_transport_committed'
    | 'claim_recovery'
    | 'duplicate_start'
    | 'expired_start'
    | 'transport_error'
    | 'claim_token_mismatch'
    | 'proof_required'
    | 'proof_mismatch' = 'normal';

  const makeRootEnvelope = (
    disposition: string,
    rootSnapshot: JsonRecord,
    actionCall?: JsonRecord,
  ): JsonRecord => ({
    schemaVersion: 1,
    ok: true,
    disposition,
    rootRowId: ROOT_ROW_ID,
    runId: RUN_ID,
    revision: rootSnapshot.revision,
    state: rootSnapshot.state,
    rootSnapshot,
    ...(actionCall ? { actionCall } : {}),
  });

  const makeActionCall = (input: {
    snapshot: JsonRecord;
    state: 'claimed' | 'dispatched' | 'verified' | 'failed' | 'outcome_unknown';
    disposition:
      | 'claimed'
      | 'already_claimed'
      | 'started'
      | 'finished'
      | 'duplicate';
    includeClaimToken?: boolean;
    driftRunId?: boolean;
  }): JsonRecord => {
    const action = actionFromSnapshot(input.snapshot);
    actionStateVersion += 1;
    return {
      schemaVersion: 1,
      ok: true,
      disposition: input.disposition,
      id: CALL_ID,
      state: input.state,
      userId: USER_ID,
      circleId: CIRCLE_ID,
      runId: input.driftRunId ? '88888888-8888-4888-8888-888888888888' : RUN_ID,
      tool: action.tool,
      toolUseId: action.actionId,
      actionId: action.actionId,
      toolArgsFingerprint: action.toolArgsFingerprint,
      contractFingerprint: action.acceptanceBindingFingerprint,
      idempotencyKey: action.idempotencyKey,
      ...(input.includeClaimToken ? { claimToken: CLAIM_TOKEN } : {}),
      claimedAt: '2026-08-06T12:00:04.000Z',
      expiresAt: '2026-08-06T12:02:04.000Z',
      dispatchedAt: input.state === 'claimed' || input.state === 'failed'
        ? null
        : '2026-08-06T12:00:05.000Z',
      finishedAt: input.state === 'verified' || input.state === 'failed' || input.state === 'outcome_unknown'
        ? input.snapshot.updatedAt
        : null,
      stateVersion: actionStateVersion,
      attemptCount: 1,
      metadata: actionMetadata,
    };
  };

  const client: ComputerTaskRootRpcClient = {
    async rpc(functionName, args) {
      calls.push({ functionName, args });
      if (functionName === 'admit_computer_task_root_v1') {
        if (!stored) {
          stored = args.p_root_snapshot as JsonRecord;
          return { data: makeRootEnvelope('created', stored) };
        }
        return { data: makeRootEnvelope('duplicate', stored) };
      }
      if (functionName === 'transition_computer_task_root_v1') {
        assert(stored);
        assert.equal(args.p_root_row_id, ROOT_ROW_ID);
        assert.equal(args.p_expected_revision, stored.revision);
        stored = args.p_root_snapshot as JsonRecord;
        return { data: makeRootEnvelope('transitioned', stored) };
      }
      if (functionName === 'claim_computer_task_root_action_v1') {
        exactKeys(args, [
          'p_root_row_id',
          'p_expected_revision',
          'p_action_id',
          'p_root_snapshot',
          'p_metadata',
          'p_ttl_seconds',
        ]);
        assert(stored);
        assert.equal(args.p_root_row_id, ROOT_ROW_ID);
        assert.equal(args.p_expected_revision, stored.revision);
        assert.equal(args.p_ttl_seconds, 900, 'claim TTL is clamped before SQL');
        const next = args.p_root_snapshot as JsonRecord;
        actionMetadata = args.p_metadata as JsonRecord;
        if (mode === 'claim_recovery') {
          assert.deepEqual(next, stored, 'claim recovery sends the exact current claimed root');
          return {
            data: makeRootEnvelope('already_claimed', stored, makeActionCall({
              snapshot: stored,
              state: 'claimed',
              disposition: 'already_claimed',
              includeClaimToken: true,
            })),
          };
        }
        const actionCall = makeActionCall({
          snapshot: next,
          state: 'claimed',
          disposition: 'claimed',
          includeClaimToken: true,
          driftRunId: mode === 'drift_identity',
        });
        if (mode !== 'drift_identity' && mode !== 'disposition_mismatch') stored = next;
        if (mode === 'claim_transport_committed') {
          return { data: null, error: { message: 'claim response lost after commit' } };
        }
        return {
          data: makeRootEnvelope(
            mode === 'disposition_mismatch' ? 'already_claimed' : 'claimed',
            next,
            actionCall,
          ),
        };
      }
      if (functionName === 'start_computer_task_root_action_v1') {
        exactKeys(args, [
          'p_root_row_id',
          'p_expected_revision',
          'p_action_id',
          'p_claim_token',
          'p_root_snapshot',
        ]);
        assert(stored);
        assert.equal(args.p_expected_revision, stored.revision);
        assert.equal(args.p_claim_token, CLAIM_TOKEN);
        const next = args.p_root_snapshot as JsonRecord;
        if (mode === 'expired_start') {
          return {
            data: {
              schemaVersion: 1,
              ok: false,
              code: 'claim_expired',
              message: 'The claim expired while handler entry waited for its row locks.',
            },
          };
        }
        if (mode === 'transport_error') {
          return { data: null, error: { message: 'response lost after request' } };
        }
        if (mode === 'duplicate_start') {
          return {
            data: makeRootEnvelope('duplicate', next, makeActionCall({
              snapshot: next,
              state: 'dispatched',
              disposition: 'duplicate',
            })),
          };
        }
        stored = next;
        return {
          data: makeRootEnvelope('started', next, makeActionCall({
            snapshot: next,
            state: 'dispatched',
            disposition: 'started',
          })),
        };
      }
      if (functionName === 'settle_computer_task_root_action_v1') {
        exactKeys(args, [
          'p_root_row_id',
          'p_expected_revision',
          'p_action_id',
          'p_claim_token',
          'p_final_state',
          'p_proof_fingerprint',
          'p_root_snapshot',
          'p_terminal_transition',
          'p_terminal_root_snapshot',
          'p_metadata',
        ]);
        assert(stored);
        assert.equal(args.p_expected_revision, stored.revision);
        if (
          mode === 'proof_required'
          || mode === 'proof_mismatch'
          || mode === 'claim_token_mismatch'
        ) {
          return {
            data: {
              schemaVersion: 1,
              ok: false,
              code: mode,
              message: mode === 'proof_required'
                ? 'Exact verification proof is required.'
                : mode === 'proof_mismatch'
                  ? 'Verification proof does not match the root transition.'
                  : 'The durable root-action settlement claim token does not match.',
            },
          };
        }
        const actionSnapshot = args.p_root_snapshot as JsonRecord;
        const finalSnapshot = (args.p_terminal_root_snapshot ?? actionSnapshot) as JsonRecord;
        actionMetadata = args.p_metadata as JsonRecord;
        const finalState = String(args.p_final_state) as 'verified' | 'failed' | 'outcome_unknown';
        const reconciled = args.p_claim_token === null;
        if (reconciled) {
          assert.equal(args.p_terminal_transition, 'complete');
          assert.equal(finalState, 'verified');
        } else {
          assert.equal(args.p_claim_token, CLAIM_TOKEN);
          assert.equal(args.p_terminal_transition, null);
          assert.equal(finalState, 'outcome_unknown');
        }
        stored = finalSnapshot;
        return {
          data: makeRootEnvelope(
            reconciled ? 'reconciled' : 'settled',
            finalSnapshot,
            makeActionCall({ snapshot: actionSnapshot, state: finalState, disposition: 'finished' }),
          ),
        };
      }
      return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
    },
  };

  const admissionInput = {
    schemaVersion: 1 as const,
    requestIdentity: 'atomic-gateway-photoshop-600',
    userId: USER_ID,
    circleId: CIRCLE_ID,
    threadId: THREAD_ID,
    source: 'chat' as const,
    normalizedTask: 'Open Photoshop and create a 600 x 600 blank document',
    admittedAt: '2026-08-06T12:00:00.000Z',
  };
  const admitted = await admitComputerTaskRuntimeRoot(admissionInput, {
    requireDurable: true,
    client,
  });
  assert(admitted.ok);

  const mustTransition = async (
    binding: ComputerTaskRuntimeRootBinding,
    transition: Parameters<typeof transitionComputerTaskRuntimeRoot>[2],
  ): Promise<ComputerTaskRuntimeRootBinding> => {
    const result = await transitionComputerTaskRuntimeRoot(binding, admissionInput, transition, { client });
    assert(result.ok, result.ok ? '' : result.message);
    return result.binding;
  };

  let binding = await mustTransition(admitted.binding, {
    type: 'begin_attempt',
    kind: 'compiler',
    parentAttemptId: null,
    at: '2026-08-06T12:00:01.000Z',
  });
  binding = await mustTransition(binding, {
    type: 'bind_acceptance',
    attemptId: binding.root.attempts[0].attemptId,
    actions: [{
      tool: 'desktop.photoshop_create_document',
      toolArgsFingerprint: fp('a'),
      authorizationFingerprint: fp('b'),
      mutatesState: true,
      requiresForegroundLease: true,
    }],
    predicateFingerprints: [fp('c')],
    at: '2026-08-06T12:00:02.000Z',
  });
  const actionId = binding.root.acceptance!.actions[0].actionId;
  binding = await mustTransition(binding, {
    type: 'bind_action_dispatch',
    actionId,
    source: 'compiler',
    callIdentityFingerprint: fp('d'),
    authorizationCategory: 'direct_request',
    mutationAuthority: 'action_ledger',
    policyBindingFingerprint: fp('e'),
    verifierBindingFingerprint: fp('f'),
    replayBindingFingerprint: fp('1'),
    at: '2026-08-06T12:00:03.000Z',
  });
  binding = await mustTransition(binding, {
    type: 'bind_foreground_lease',
    leaseId: `gateway-smoke:${actionId}`,
    actionId,
    targetFingerprint: TARGET_FINGERPRINT,
    expiresAt: '2026-08-06T12:02:03.500Z',
    at: '2026-08-06T12:00:03.500Z',
  });

  const gateway = createComputerTaskRootActionGateway(client);
  const rpcCountBeforeClone = calls.length;
  const cloned = await gateway.claim({
    binding: { ...binding },
    actionId,
    at: '2026-08-06T12:00:04.000Z',
  });
  assert.equal(cloned.ok, false);
  if (!cloned.ok) assert.equal(cloned.code, 'invalid_input');
  assert.equal(calls.length, rpcCountBeforeClone, 'a structural binding clone reaches no RPC');

  const memoryAdmission = await admitComputerTaskRuntimeRoot({
    ...admissionInput,
    requestIdentity: 'atomic-gateway-memory-binding',
    admittedAt: '2026-08-06T12:10:00.000Z',
  }, { requireDurable: false });
  assert(memoryAdmission.ok);
  const memoryRejected = await gateway.claim({
    binding: memoryAdmission.binding,
    actionId,
    at: '2026-08-06T12:10:01.000Z',
  });
  assert.equal(memoryRejected.ok, false);
  assert.equal(calls.length, rpcCountBeforeClone, 'a memory binding reaches no atomic RPC');

  mode = 'drift_identity';
  const identityDrift = await gateway.claim({
    binding,
    actionId,
    at: '2026-08-06T12:00:04.000Z',
    metadata: { surface: 'desktop', source: 'openswan_tool_runtime' },
    ttlSeconds: 10_000,
  });
  assert.equal(identityDrift.ok, false);
  if (!identityDrift.ok) assert.equal(identityDrift.code, 'malformed_response');

  mode = 'disposition_mismatch';
  const dispositionDrift = await gateway.claim({
    binding,
    actionId,
    at: '2026-08-06T12:00:04.000Z',
    ttlSeconds: 10_000,
  });
  assert.equal(dispositionDrift.ok, false);
  if (!dispositionDrift.ok) assert.equal(dispositionDrift.code, 'malformed_response');

  mode = 'claim_transport_committed';
  const ambiguousClaim = await gateway.claim({
    binding,
    actionId,
    at: '2026-08-06T12:00:04.000Z',
    metadata: { surface: 'desktop', source: 'openswan_tool_runtime' },
    ttlSeconds: 10_000,
  });
  assert.equal(ambiguousClaim.ok, false, 'a lost claim response grants no handler authority');
  if (!ambiguousClaim.ok) {
    assert.equal(ambiguousClaim.code, 'rpc_error');
    assert.match(ambiguousClaim.message, /durable state may have changed/i);
  }
  assert.equal('handlerAuthority' in ambiguousClaim, false);

  const refreshed = await admitComputerTaskRuntimeRoot(admissionInput, {
    requireDurable: true,
    client,
  });
  assert(refreshed.ok);
  assert.equal(refreshed.disposition, 'duplicate');
  assert.equal(refreshed.binding.root.acceptance!.actions[0].state, 'claimed');
  assert.equal(
    refreshed.binding.root.revision,
    binding.root.revision + 1,
    'refresh recovers the root revision committed before the claim response was lost',
  );

  mode = 'claim_recovery';
  const claimed = await gateway.claim({
    binding: refreshed.binding,
    actionId,
    at: '2026-08-06T12:00:04.500Z',
    metadata: { surface: 'desktop', source: 'openswan_tool_runtime' },
    ttlSeconds: 10_000,
  });
  assert(claimed.ok);
  assert.equal(claimed.disposition, 'recovered');
  assert.equal(
    claimed.binding.root.revision,
    refreshed.binding.root.revision,
    'recovering a still-live claim does not replay planned-to-claimed or bump the root revision',
  );
  assert.equal(claimed.identity.runId, RUN_ID, '§26 identity uses the universal durable runId');
  assert.equal(claimed.identity.toolUseId, actionId);
  assert.equal(claimed.identity.actionId, actionId);
  assert.equal(
    claimed.identity.contractFingerprint,
    claimed.binding.root.acceptance!.actions[0].acceptanceBindingFingerprint,
  );
  assert.equal(claimed.claimToken, CLAIM_TOKEN);
  assert.equal('handlerAuthority' in claimed, false, 'claim alone is never handler authority');
  binding = claimed.binding;

  mode = 'expired_start';
  const expiredStart = await gateway.start({
    binding,
    actionId,
    claimToken: CLAIM_TOKEN,
    at: '2026-08-06T12:00:05.000Z',
  });
  assert.equal(expiredStart.ok, false, 'a claim expired after lock wait never authorizes handler entry');
  if (!expiredStart.ok) assert.equal(expiredStart.code, 'claim_expired');
  assert.equal('handlerAuthority' in expiredStart, false);

  mode = 'duplicate_start';
  const duplicateStart = await gateway.start({
    binding,
    actionId,
    claimToken: CLAIM_TOKEN,
    at: '2026-08-06T12:00:05.000Z',
  });
  assert.equal(duplicateStart.ok, false, 'duplicate start never authorizes handler entry');
  if (!duplicateStart.ok) assert.equal(duplicateStart.code, 'state_conflict');
  assert.equal('handlerAuthority' in duplicateStart, false);

  mode = 'transport_error';
  const ambiguousStart = await gateway.start({
    binding,
    actionId,
    claimToken: CLAIM_TOKEN,
    at: '2026-08-06T12:00:05.000Z',
  });
  assert.equal(ambiguousStart.ok, false, 'a lost start response never authorizes handler entry');
  if (!ambiguousStart.ok) {
    assert.equal(ambiguousStart.code, 'rpc_error');
    assert.match(ambiguousStart.message, /durable state may have changed/i);
  }
  assert.equal('handlerAuthority' in ambiguousStart, false);

  mode = 'normal';
  const started = await gateway.start({
    binding,
    actionId,
    claimToken: CLAIM_TOKEN,
    at: '2026-08-06T12:00:05.000Z',
  });
  assert(started.ok);
  assert.equal(started.binding.root.acceptance!.actions[0].state, 'dispatched');
  const expectedHandler = Object.freeze({
    binding: started.binding,
    actionId,
    tool: 'desktop.photoshop_create_document',
    toolArgsFingerprint: fp('a'),
    targetFingerprint: TARGET_FINGERPRINT,
  });
  assert.equal(started.handlerAuthority.rootRowId, ROOT_ROW_ID);
  assert.equal(started.handlerAuthority.runId, RUN_ID);
  assert.equal(started.handlerAuthority.rootRevision, started.binding.root.revision);
  assert.equal(started.handlerAuthority.actionId, actionId);
  assert.equal(started.handlerAuthority.actionCallId, CALL_ID);
  assert.equal(started.handlerAuthority.claimToken, CLAIM_TOKEN);
  assert.equal(started.handlerAuthority.tool, expectedHandler.tool);
  assert.equal(started.handlerAuthority.toolArgsFingerprint, expectedHandler.toolArgsFingerprint);
  assert.equal(started.handlerAuthority.targetFingerprint, TARGET_FINGERPRINT);
  assert.equal(
    started.handlerAuthority.acceptanceBindingFingerprint,
    started.binding.root.acceptance!.actions[0].acceptanceBindingFingerprint,
  );
  assert.equal(
    started.handlerAuthority.dispatchCallIdentityFingerprint,
    started.binding.root.acceptance!.actions[0].dispatchBinding!.callIdentityFingerprint,
  );
  assert.equal(
    consumeComputerTaskRootActionHandlerAuthority(
      { ...started.handlerAuthority },
      expectedHandler,
    ),
    false,
    'a value-identical authority clone has no handler authority',
  );
  assert.equal(
    consumeComputerTaskRootActionHandlerAuthority(started.handlerAuthority, {
      ...expectedHandler,
      binding: { ...started.binding },
    }),
    false,
    'a clone of the issued database binding has no handler authority',
  );
  assert.equal(
    consumeComputerTaskRootActionHandlerAuthority(started.handlerAuthority, {
      ...expectedHandler,
      binding: claimed.binding,
    }),
    false,
    'a stale pre-start issued database binding has no handler authority',
  );
  for (const mismatch of [
    { ...expectedHandler, actionId: `${actionId}-other` },
    { ...expectedHandler, tool: 'desktop.photoshop_document_status' },
    { ...expectedHandler, toolArgsFingerprint: fp('0') },
    { ...expectedHandler, targetFingerprint: WRONG_TARGET_FINGERPRINT },
  ]) {
    assert.equal(
      consumeComputerTaskRootActionHandlerAuthority(started.handlerAuthority, mismatch),
      false,
      'expected handler values must exactly match the issued durable action and target',
    );
  }
  assert.equal(
    consumeComputerTaskRootActionHandlerAuthority(started.handlerAuthority, expectedHandler),
    true,
    'the exact issued binding and independently expected values consume once',
  );
  assert.equal(
    consumeComputerTaskRootActionHandlerAuthority(started.handlerAuthority, expectedHandler),
    false,
    'a successfully consumed handler authority cannot be reused',
  );
  binding = started.binding;

  mode = 'claim_token_mismatch';
  const mismatchedSettlement = await gateway.settle({
    binding,
    actionId,
    claimToken: WRONG_CLAIM_TOKEN,
    finalState: 'outcome_unknown',
    proofFingerprint: fp('2'),
    at: '2026-08-06T12:00:05.500Z',
    metadata: { surface: 'desktop', outcomeUnknown: true },
  });
  assert.equal(mismatchedSettlement.ok, false);
  if (!mismatchedSettlement.ok) {
    assert.equal(mismatchedSettlement.code, 'claim_token_mismatch');
  }
  assert.equal('handlerAuthority' in mismatchedSettlement, false);

  for (const proofFailure of ['proof_required', 'proof_mismatch'] as const) {
    mode = proofFailure;
    const rejectedProof = await gateway.settle({
      binding,
      actionId,
      claimToken: CLAIM_TOKEN,
      finalState: 'verified',
      proofFingerprint: fp('2'),
      at: '2026-08-06T12:00:06.000Z',
      metadata: { surface: 'desktop', completionVerified: true },
    });
    assert.equal(rejectedProof.ok, false);
    if (!rejectedProof.ok) assert.equal(rejectedProof.code, proofFailure);
    assert.equal('handlerAuthority' in rejectedProof, false);
  }

  mode = 'normal';
  const unknown = await gateway.settle({
    binding,
    actionId,
    claimToken: CLAIM_TOKEN,
    finalState: 'outcome_unknown',
    proofFingerprint: fp('2'),
    at: '2026-08-06T12:00:06.000Z',
    metadata: { surface: 'desktop', outcomeUnknown: true },
  });
  assert(unknown.ok);
  assert.equal(unknown.binding.root.replayPolicy, 'verification_only');
  assert.equal(unknown.binding.root.acceptance!.actions[0].state, 'outcome_unknown');
  assert.equal('handlerAuthority' in unknown, false, 'ambiguous settlement cannot re-authorize mutation');
  binding = unknown.binding;

  const reconciled = await gateway.reconcileOutcomeUnknown({
    binding,
    actionId,
    proofFingerprint: fp('3'),
    terminalTransition: { type: 'complete', proofFingerprint: fp('4') },
    at: '2026-08-06T12:00:07.000Z',
    metadata: {
      surface: 'desktop',
      completionVerified: true,
      evidenceCount: 1,
      blockerCount: 0,
    },
  });
  assert(reconciled.ok);
  assert.equal(reconciled.disposition, 'reconciled');
  assert.equal(reconciled.binding.root.state, 'completed');
  assert.equal(reconciled.binding.root.replayPolicy, 'terminal');
  assert.equal(reconciled.binding.root.acceptance!.actions[0].state, 'verified');
  assert.equal('handlerAuthority' in reconciled, false, 'verification-only reconciliation has no handler authority');

  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const runtimeSource = readFileSync(`${repoRoot}/src/lib/computerTaskRuntime.ts`, 'utf8');
  const storeSource = readFileSync(`${repoRoot}/src/lib/computerTaskRootStore.ts`, 'utf8');
  const migrationSource = readFileSync(
    `${repoRoot}/supabase/migrations/20260806_universal_computer_task_roots.sql`,
    'utf8',
  );
  const consolidatedSql = readFileSync(`${repoRoot}/docs/RUN_THIS_SQL.sql`, 'utf8');
  assert(
    consolidatedSql.includes('-- Source: 20260806_universal_computer_task_roots.sql'),
    'consolidated SQL contains the section 34 source marker',
  );
  const section34MarkerIndex = consolidatedSql.indexOf(
    '-- Source: 20260806_universal_computer_task_roots.sql',
  );
  const section35MarkerIndex = consolidatedSql.indexOf('-- §35.', section34MarkerIndex);
  const section34MigrationIndex = consolidatedSql.indexOf(migrationSource, section34MarkerIndex);
  assert(
    section34MarkerIndex >= 0
      && section35MarkerIndex > section34MarkerIndex
      && section34MigrationIndex > section34MarkerIndex
      && section34MigrationIndex + migrationSource.length <= section35MarkerIndex,
    'the bounded executable section 34 body contains its byte-identical source migration',
  );
  const gatewaySource = storeSource.slice(storeSource.indexOf('export function createComputerTaskRootActionGateway'));
  for (const rpcName of [
    'claim_computer_task_root_action_v1',
    'start_computer_task_root_action_v1',
    'settle_computer_task_root_action_v1',
  ]) {
    assert(gatewaySource.includes(`'${rpcName}'`), `gateway calls root-first combined RPC ${rpcName}`);
  }
  assert.equal(gatewaySource.includes("'claim_agent_action_call'"), false);
  assert.equal(gatewaySource.includes("'start_agent_action_call'"), false);
  assert.equal(gatewaySource.includes("'finish_agent_action_call'"), false);
  assert.equal(
    storeSource.match(/\bissueHandlerAuthority\(/g)?.length,
    2,
    'handler authority has one private definition and one issuance call',
  );
  const startGatewaySource = gatewaySource.slice(
    gatewaySource.indexOf('async start(input) {'),
    gatewaySource.indexOf('settle(input) {'),
  );
  assert(
    startGatewaySource.includes('const handlerAuthority = issueHandlerAuthority({')
      && startGatewaySource.includes('binding: parsed.binding')
      && startGatewaySource.includes('actionCall: parsed.actionCall'),
    'an exact successful atomic start is the sole handler-authority issuer',
  );
  for (const boundAuthorityField of [
    'rootRowId',
    'runId',
    'rootRevision',
    'actionId',
    'actionCallId',
    'claimToken',
    'tool',
    'toolArgsFingerprint',
    'acceptanceFingerprint',
    'acceptanceBindingFingerprint',
    'dispatchCallIdentityFingerprint',
    'targetFingerprint',
  ]) {
    assert(
      storeSource.includes(`${boundAuthorityField}:`),
      `handler authority binds ${boundAuthorityField}`,
    );
  }
  assert(
    gatewaySource.includes("const recovering = action?.state === 'claimed';")
      && gatewaySource.includes('await prepareCurrentRootSnapshot(prepared.record)'),
    'a refreshed claimed root recovers its lease without replaying planned-to-claimed',
  );
  const sqlGatewayStart = migrationSource.indexOf(
    'CREATE OR REPLACE FUNCTION public.claim_computer_task_root_action_v1(',
  );
  const sqlGatewaySource = migrationSource.slice(sqlGatewayStart);
  assert.equal(
    sqlGatewaySource.match(/v_now timestamptz;/g)?.length,
    3,
    'all three root/action wrappers declare database time without sampling before locks',
  );
  assert.equal(
    sqlGatewaySource.match(/v_now := clock_timestamp\(\);/g)?.length,
    3,
    'all three root/action wrappers refresh database time after their row locks',
  );
  assert.equal(
    sqlGatewaySource.includes('v_now timestamptz := clock_timestamp();'),
    false,
    'no root/action wrapper captures lease time before waiting for locks',
  );
  assert(
    sqlGatewaySource.includes('p_root_snapshot IS DISTINCT FROM v_root.root_snapshot')
      && sqlGatewaySource.includes(
        'The claimed action lease cannot be recovered from a non-executable root.',
      ),
    'SQL claim recovery requires the exact current root and executable owning attempt',
  );
  assert(
    sqlGatewaySource.includes(
      "(v_root.root_snapshot#>>'{foregroundLease,expiresAt}')::timestamptz\n        <= v_now",
    ),
    'queued handler entry compares a required foreground lease with fresh database time',
  );
  assert(
    sqlGatewaySource.includes("'claim_token_mismatch'")
      && sqlGatewaySource.includes(
        'The durable root-action settlement claim token does not match.',
      ),
    'settlement reports an exact claim-token mismatch before state transition',
  );
  const stopGuardStart = migrationSource.indexOf("p_transition_type = 'stop_requested'");
  const stopGuardEnd = migrationSource.indexOf(
    "p_transition_type = 'human_foreground_override'",
    stopGuardStart,
  );
  const stopGuardSource = migrationSource.slice(stopGuardStart, stopGuardEnd);
  assert(
    stopGuardSource.includes("'claimed', 'dispatched', 'outcome_unknown'"),
    'STOP cannot terminalize a root while an action still requires durable settlement',
  );
  const overrideGuardStart = migrationSource.indexOf(
    "p_transition_type = 'human_foreground_override'",
    stopGuardEnd,
  );
  const overrideGuardEnd = migrationSource.indexOf(
    "p_transition_type = 'complete'",
    overrideGuardStart,
  );
  const overrideGuardSource = migrationSource.slice(overrideGuardStart, overrideGuardEnd);
  assert(
    overrideGuardSource.includes("WHERE action.value->>'state' = 'claimed'"),
    'human foreground override cannot strand a claimed root action and its section-26 lease',
  );
  assert.equal(
    runtimeSource.includes("'claim_computer_task_root_action_v1'"),
    false,
    'live dispatch cannot bypass the typed gateway with a raw claim RPC',
  );
  assert.equal(
    runtimeSource.includes("'start_computer_task_root_action_v1'"),
    false,
    'live dispatch cannot bypass the typed gateway with a raw start RPC',
  );
  assert.equal(
    runtimeSource.includes("'settle_computer_task_root_action_v1'"),
    false,
    'live dispatch cannot bypass the typed gateway with a raw settle RPC',
  );
  const runtimeFactoryCall = runtimeSource.search(/createComputerTaskRootActionGateway\s*\(/);
  assert(runtimeFactoryCall >= 0, 'the saved runtime contains the guarded root/action gateway factory call');
  assert.equal(
    runtimeSource.match(/createComputerTaskRootActionGateway\s*\(/g)?.length,
    1,
    'the runtime has one auditable atomic gateway construction site',
  );
  const requestedGuardStart = runtimeSource.indexOf(
    'function isPhotoshopRootActionCanaryRequested(): boolean {',
  );
  const enabledGuardStart = runtimeSource.indexOf(
    'function isPhotoshopRootActionCanaryEnabled(): boolean {',
  );
  const targetMatcherStart = runtimeSource.indexOf('function exactPhotoshopTargetGuardMatches(');
  assert(requestedGuardStart >= 0 && enabledGuardStart > requestedGuardStart);
  assert(targetMatcherStart > enabledGuardStart);
  const requestedGuardSource = runtimeSource.slice(requestedGuardStart, enabledGuardStart);
  const enabledGuardSource = runtimeSource.slice(enabledGuardStart, targetMatcherStart);
  assert(
    requestedGuardSource.includes(
      "return process.env.EXPO_PUBLIC_PHOTOSHOP_ROOT_ACTION_CANARY_V1 === 'true';",
    ),
    'Photoshop root/action canary request is exact-true and therefore default-off',
  );
  assert(
    enabledGuardSource.includes('return isComputerTaskRootActionGatewayRolloutEnabled()')
      && enabledGuardSource.includes(
        "&& process.env.EXPO_PUBLIC_PHOTOSHOP_ROOT_ACTION_CANARY_V1 === 'true';",
      ),
    'Photoshop canary enablement is the conjunction of its request flag and durable gateway/root rollout',
  );
  const authorizedWrapperStart = runtimeSource.indexOf(
    'async function executeAuthorizedPhotoshopCreateDocument(input: Readonly<{',
  );
  const canaryExecutorStart = runtimeSource.indexOf(
    'async function executeFrontmostPhotoshopRootActionCanary(input: {',
  );
  const ordinaryExecutorStart = runtimeSource.indexOf(
    'async function executeAuthorizedExactSequenceProgram(input: {',
    canaryExecutorStart,
  );
  assert(authorizedWrapperStart >= 0 && canaryExecutorStart > authorizedWrapperStart);
  assert(canaryExecutorStart >= 0 && ordinaryExecutorStart > canaryExecutorStart);
  const authorizedWrapper = runtimeSource.slice(authorizedWrapperStart, canaryExecutorStart);
  const canaryExecutor = runtimeSource.slice(canaryExecutorStart, ordinaryExecutorStart);
  const canaryEnableGate = canaryExecutor.indexOf('!isPhotoshopRootActionCanaryEnabled()');
  const databaseBindingGate = canaryExecutor.indexOf("input.rootBinding.durability !== 'database'");
  const canaryFactoryCall = canaryExecutor.search(/createComputerTaskRootActionGateway\s*\(/);
  const atomicStart = canaryExecutor.indexOf('await gateway.start({');
  const authorizedAttempt = canaryExecutor.indexOf(
    'await executeAuthorizedPhotoshopCreateDocument({',
  );
  const authorityConsume = authorizedWrapper.indexOf(
    'consumeComputerTaskRootActionHandlerAuthority(',
  );
  const photoshopMutation = authorizedWrapper.indexOf(
    'await input.desktop.photoshopCreateDocument({',
  );
  assert(canaryEnableGate >= 0 && canaryEnableGate < canaryFactoryCall);
  assert(databaseBindingGate >= 0 && databaseBindingGate < canaryFactoryCall);
  assert(canaryFactoryCall >= 0 && canaryFactoryCall < atomicStart);
  assert(atomicStart < authorizedAttempt);
  assert(authorityConsume >= 0 && authorityConsume < photoshopMutation);
  for (const exactHandlerBinding of [
    'binding: input.binding',
    'actionId: input.actionId',
    "tool: 'desktop.photoshop_create_document'",
    'toolArgsFingerprint: input.toolArgsFingerprint',
    'targetFingerprint: input.targetFingerprint',
  ]) {
    assert(
      authorizedWrapper.includes(exactHandlerBinding),
      `the sole Photoshop bridge wrapper binds ${exactHandlerBinding}`,
    );
  }
  const requestBranch = runtimeSource.indexOf('if (isPhotoshopRootActionCanaryRequested()) {');
  const canaryDispatch = runtimeSource.indexOf(
    'await executeFrontmostPhotoshopRootActionCanary({',
    requestBranch,
  );
  const canaryReturn = runtimeSource.indexOf('return canaryResult;', canaryDispatch);
  const ordinaryChildRoot = runtimeSource.indexOf('await createExactSequenceRootRun({', canaryReturn);
  assert(requestBranch >= 0 && requestBranch < canaryDispatch);
  assert(canaryDispatch < canaryReturn && canaryReturn < ordinaryChildRoot);
  const rootFlag = process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1;
  const gatewayFlag = process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1;
  try {
    process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1 = 'false';
    process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1 = 'true';
    assert.equal(
      isComputerTaskRootActionGatewayRolloutEnabled(),
      false,
      'the action gateway cannot outrank the universal durable-root rollout',
    );
    process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1 = 'true';
    process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1 = 'false';
    assert.equal(isComputerTaskRootActionGatewayRolloutEnabled(), false);
    process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1 = 'true';
    assert.equal(isComputerTaskRootActionGatewayRolloutEnabled(), true);
  } finally {
    if (rootFlag === undefined) delete process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1;
    else process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1 = rootFlag;
    if (gatewayFlag === undefined) delete process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1;
    else process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1 = gatewayFlag;
  }

  const atomicCalls = calls.filter((call) => call.functionName.includes('_computer_task_root_action_v1'));
  assert.deepEqual(atomicCalls.map((call) => call.functionName), [
    'claim_computer_task_root_action_v1',
    'claim_computer_task_root_action_v1',
    'claim_computer_task_root_action_v1',
    'claim_computer_task_root_action_v1',
    'start_computer_task_root_action_v1',
    'start_computer_task_root_action_v1',
    'start_computer_task_root_action_v1',
    'start_computer_task_root_action_v1',
    'settle_computer_task_root_action_v1',
    'settle_computer_task_root_action_v1',
    'settle_computer_task_root_action_v1',
    'settle_computer_task_root_action_v1',
    'settle_computer_task_root_action_v1',
  ]);
  console.log('computer-task root/action gateway smoke: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
