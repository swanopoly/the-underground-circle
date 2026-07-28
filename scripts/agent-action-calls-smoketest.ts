/**
 * Database-free smoke for the durable cross-process action-call foundation.
 *
 * Run:
 *   /Users/cswanson/.npm/_npx/fd45a72a545557e9/node_modules/.bin/tsx \
 *     scripts/agent-action-calls-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAgentActionCallIdentity,
  createAgentActionCallStore,
  parseAgentActionCallRpcResponse,
  sanitizeAgentActionCallMetadata,
  type AgentActionCallFinalState,
  type AgentActionCallIdentity,
  type AgentActionCallMetadata,
  type AgentActionCallsRpcClient,
} from '../src/lib/agentActionCalls';

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CIRCLE_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const CALL_ID = 'toolu_01_exact_call';
const ACTION_ID = 'run1:toolu_01_exact_call:guarded-v1';
const CLAIM_TOKEN = '44444444-4444-4444-8444-444444444444';
const RECORD_ID = '55555555-5555-4555-8555-555555555555';
const ARGS_FINGERPRINT = `args-v2:sha256:${'a'.repeat(64)}`;
const CONTRACT_FINGERPRINT = `args-v2:sha256:${'b'.repeat(64)}`;

const identity: AgentActionCallIdentity = Object.freeze({
  schemaVersion: 1,
  userId: USER_ID,
  circleId: CIRCLE_ID,
  runId: RUN_ID,
  tool: 'browser.set_toggle',
  toolUseId: CALL_ID,
  actionId: ACTION_ID,
  toolArgsFingerprint: ARGS_FINGERPRINT,
  contractFingerprint: CONTRACT_FINGERPRINT,
  idempotencyKey: `${ACTION_ID}:claim`,
});

type FakeRow = {
  identity: AgentActionCallIdentity;
  state: 'claimed' | 'dispatched' | 'verified' | 'failed' | 'outcome_unknown';
  claimToken: string;
  claimedAt: string;
  expiresAt: string;
  dispatchedAt: string | null;
  finishedAt: string | null;
  stateVersion: number;
  attemptCount: number;
  metadata: AgentActionCallMetadata;
};

function identityFromRpc(args: Record<string, unknown>): AgentActionCallIdentity {
  return {
    schemaVersion: 1,
    userId: String(args.p_user_id || ''),
    circleId: String(args.p_circle_id || ''),
    runId: String(args.p_run_id || ''),
    tool: String(args.p_tool_name || ''),
    toolUseId: String(args.p_tool_use_id || ''),
    actionId: String(args.p_action_id || ''),
    toolArgsFingerprint: String(args.p_tool_args_fingerprint || ''),
    contractFingerprint: String(args.p_contract_fingerprint || ''),
    idempotencyKey: String(args.p_idempotency_key || ''),
  };
}

function sameIdentity(left: AgentActionCallIdentity, right: AgentActionCallIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function successPayload(
  row: FakeRow,
  disposition: string,
  includeClaimToken = false,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    ok: true,
    disposition,
    id: RECORD_ID,
    state: row.state,
    ...row.identity,
    ...(includeClaimToken ? { claimToken: row.claimToken } : {}),
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
    dispatchedAt: row.dispatchedAt,
    finishedAt: row.finishedAt,
    stateVersion: row.stateVersion,
    attemptCount: row.attemptCount,
    metadata: row.metadata,
  };
}

function failurePayload(code: string, message: string): Record<string, unknown> {
  return { schemaVersion: 1, ok: false, code, message };
}

class FakeAtomicActionCallRpc implements AgentActionCallsRpcClient {
  row: FakeRow | null = null;
  nowMs = Date.parse('2026-07-26T12:00:00.000Z');
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  async rpc(functionName: string, args: Record<string, unknown>) {
    this.calls.push({ name: functionName, args });
    const requested = identityFromRpc(args);
    if (functionName === 'claim_agent_action_call') {
      if (this.row) {
        if (!sameIdentity(this.row.identity, requested)) {
          return {
            data: failurePayload(
              'identity_conflict',
              'This exact call identity is already bound.',
            ),
          };
        }
        if (this.row.state === 'claimed' && Date.parse(this.row.expiresAt) <= this.nowMs) {
          this.row = {
            ...this.row,
            claimToken: CLAIM_TOKEN,
            claimedAt: new Date(this.nowMs).toISOString(),
            expiresAt: new Date(this.nowMs + 120_000).toISOString(),
            stateVersion: this.row.stateVersion + 1,
            attemptCount: this.row.attemptCount + 1,
          };
          return { data: successPayload(this.row, 'claimed', true) };
        }
        return {
          data: successPayload(
            this.row,
            this.row.state === 'claimed' ? 'already_claimed' : 'duplicate',
            this.row.state === 'claimed',
          ),
        };
      }
      this.row = {
        identity: requested,
        state: 'claimed',
        claimToken: CLAIM_TOKEN,
        claimedAt: new Date(this.nowMs).toISOString(),
        expiresAt: new Date(this.nowMs + Number(args.p_ttl_seconds || 120) * 1_000).toISOString(),
        dispatchedAt: null,
        finishedAt: null,
        stateVersion: 1,
        attemptCount: 1,
        metadata: args.p_metadata as AgentActionCallMetadata,
      };
      return { data: successPayload(this.row, 'claimed', true) };
    }
    if (!this.row || !sameIdentity(this.row.identity, requested)) {
      return { data: failurePayload('claim_not_found', 'No exact claim exists.') };
    }
    if (String(args.p_claim_token || '') !== this.row.claimToken) {
      return { data: failurePayload('claim_token_mismatch', 'Claim token mismatch.') };
    }
    if (functionName === 'start_agent_action_call') {
      if (this.row.state !== 'claimed') {
        return { data: successPayload(this.row, 'duplicate', false) };
      }
      if (Date.parse(this.row.expiresAt) <= this.nowMs) {
        return { data: failurePayload('claim_expired', 'Claim expired.') };
      }
      this.row = {
        ...this.row,
        state: 'dispatched',
        dispatchedAt: new Date(this.nowMs + 1_000).toISOString(),
        expiresAt: new Date(this.nowMs + 86_400_000).toISOString(),
        stateVersion: this.row.stateVersion + 1,
      };
      return { data: successPayload(this.row, 'started', false) };
    }
    if (functionName === 'finish_agent_action_call') {
      const finalState = String(args.p_final_state || '') as AgentActionCallFinalState;
      if (['verified', 'failed', 'outcome_unknown'].includes(this.row.state)) {
        if (this.row.state === finalState) {
          return { data: successPayload(this.row, 'already_finished', false) };
        }
        return { data: failurePayload('state_conflict', 'Terminal state differs.') };
      }
      if (this.row.state === 'claimed' && finalState !== 'failed') {
        return { data: failurePayload('invalid_transition', 'Action never started.') };
      }
      if (this.row.state === 'dispatched' && finalState === 'failed') {
        return {
          data: failurePayload(
            'invalid_transition',
            'A dispatched action cannot become failed.',
          ),
        };
      }
      this.row = {
        ...this.row,
        state: finalState,
        finishedAt: new Date(this.nowMs + 2_000).toISOString(),
        expiresAt: new Date(this.nowMs + 86_400_000).toISOString(),
        stateVersion: this.row.stateVersion + 1,
        metadata: {
          ...this.row.metadata,
          ...(args.p_metadata as AgentActionCallMetadata),
        },
      };
      return { data: successPayload(this.row, 'finished', false) };
    }
    return { data: null, error: new Error('unknown RPC') };
  }
}

async function main() {
  {
    const built = await buildAgentActionCallIdentity({
      userId: USER_ID,
      circleId: CIRCLE_ID,
      runId: RUN_ID,
      toolUseId: CALL_ID,
      action: {
        schemaVersion: 1,
        actionId: ACTION_ID,
        tool: 'browser.set_toggle',
        toolArgsFingerprint: ARGS_FINGERPRINT,
        idempotencyKey: `${ACTION_ID}:claim`,
      },
      authorization: {
        allowed: true,
        actionId: ACTION_ID,
        contractBinding: '{"exact":"binding"}',
        blockers: [],
      },
    }, {
      fingerprintContractBinding: async (value) => {
        check(
          value.contractBinding === '{"exact":"binding"}',
          'identity builder fingerprints the exact runtime-issued contract binding',
        );
        return CONTRACT_FINGERPRINT;
      },
    });
    check(built.ok, 'trusted mutation/authorization pair builds a durable identity');
    check(built.ok && sameIdentity(built.value, identity), 'built identity binds every exact expected field');

    const blocked = await buildAgentActionCallIdentity({
      userId: USER_ID,
      circleId: CIRCLE_ID,
      runId: RUN_ID,
      toolUseId: CALL_ID,
      action: {
        schemaVersion: 1,
        actionId: ACTION_ID,
        tool: 'browser.set_toggle',
        toolArgsFingerprint: ARGS_FINGERPRINT,
        idempotencyKey: `${ACTION_ID}:claim`,
      },
      authorization: {
        allowed: false,
        actionId: ACTION_ID,
        contractBinding: '{"exact":"binding"}',
        blockers: [{ code: 'approval_required', detail: 'blocked', recovery: 'approve' }] as any,
      },
    }, {
      fingerprintContractBinding: async () => {
        throw new Error('blocked authorization must not be fingerprinted');
      },
    });
    check(!blocked.ok, 'blocked runtime authorization cannot create a durable claim identity');
  }

  {
    const metadata = sanitizeAgentActionCallMetadata({
      surface: 'browser',
      risk: 'medium',
      approvalId: '77777777-7777-4777-8777-777777777777',
      observationEpochId: 'uc_browser_evidence_safe_1',
      verificationKind: 'browser_dom',
      completionVerified: false,
      outcomeUnknown: true,
      evidenceCount: 2,
      blockerCount: 0,
      errorCode: 'transport_reset',
      recoveryCode: 'observe_before_retry',
      source: 'openswan_tool_runtime',
      actor: 'user_authorized_agent',
      localPath: '/Users/private/Desktop/secret.txt',
      nested: { raw: true },
    });
    check(metadata.surface === 'browser', 'safe allowlisted metadata survives');
    check(metadata.risk === 'medium', 'risk enum survives');
    check(metadata.approvalId === '77777777-7777-4777-8777-777777777777', 'UUID approval id survives');
    check(metadata.observationEpochId === 'uc_browser_evidence_safe_1', 'bounded observation id survives');
    check(metadata.verificationKind === 'browser_dom', 'verification enum survives');
    check(metadata.evidenceCount === 2, 'bounded numeric metadata survives');
    check(metadata.blockerCount === 0, 'zero count survives');
    check(metadata.completionVerified === false && metadata.outcomeUnknown === true, 'boolean outcomes survive');
    check(metadata.errorCode === 'transport_reset' && metadata.recoveryCode === 'observe_before_retry', 'bounded symbolic codes survive');
    check(metadata.source === 'openswan_tool_runtime' && metadata.actor === 'user_authorized_agent', 'controlled producer and actor enums survive');
    check(metadata.redacted === true, 'redaction is explicit');
    check(!('localPath' in metadata) && !('nested' in metadata), 'unknown and nested metadata are dropped');
    const symbolicTokens = sanitizeAgentActionCallMetadata({
      observationEpochId: 'uc_epoch:42',
      errorCode: 'bridge_error:stale',
    });
    check(
      symbolicTokens.observationEpochId === 'uc_epoch:42'
        && symbolicTokens.errorCode === 'bridge_error:stale'
        && symbolicTokens.redacted !== true,
      'non-URI symbolic colon tokens remain valid under the allowlisted token contract',
    );
    check(
      JSON.stringify(sanitizeAgentActionCallMetadata(metadata)) === JSON.stringify(metadata),
      'sanitizer output is idempotent for RPC response correlation',
    );
    check(JSON.stringify(metadata).length < 4096, 'metadata projection stays bounded');

    const adversarial: Array<{
      label: string;
      key: string;
      value: unknown;
    }> = [
      { label: 'URI', key: 'observationEpochId', value: 'https://private.example/path' },
      { label: 'opaque HTTP URI', key: 'observationEpochId', value: 'http:private' },
      { label: 'opaque SSH URI', key: 'observationEpochId', value: 'ssh:private' },
      { label: 'custom scheme URI', key: 'observationEpochId', value: 'custom+v1:private' },
      { label: 'query', key: 'recoveryCode', value: '?token=private' },
      { label: 'POSIX absolute path', key: 'errorCode', value: '/private/tmp/secret' },
      { label: 'Windows absolute path', key: 'observationEpochId', value: 'C:\\Users\\private\\secret.txt' },
      { label: 'Windows user path', key: 'observationEpochId', value: '\\Users\\private\\secret.txt' },
      { label: 'content-looking text', key: 'actor', value: 'user authorized agent content' },
      { label: 'email', key: 'source', value: 'private@example.com' },
      { label: 'secret', key: 'errorCode', value: 'password=super-secret' },
      { label: 'wrong enum', key: 'risk', value: 'extreme' },
      { label: 'wrong boolean type', key: 'completionVerified', value: 'false' },
      { label: 'fractional count', key: 'evidenceCount', value: 1.5 },
      { label: 'negative count', key: 'blockerCount', value: -1 },
      { label: 'oversized count', key: 'evidenceCount', value: 10_001 },
      { label: 'null primitive', key: 'outcomeUnknown', value: null },
    ];
    for (const item of adversarial) {
      const sanitized = sanitizeAgentActionCallMetadata({
        surface: 'browser',
        [item.key]: item.value,
      });
      check(
        sanitized.surface === 'browser'
          && !(item.key in sanitized)
          && sanitized.redacted === true,
        `${item.label} metadata is dropped and explicitly redacted`,
      );
      check(
        !JSON.stringify(sanitized).includes(String(item.value)),
        `${item.label} metadata never survives in durable output`,
      );
    }
  }

  const fake = new FakeAtomicActionCallRpc();
  const store = createAgentActionCallStore(fake);
  const claim = await store.claim({
    identity,
    ttlSeconds: 9_999,
    metadata: {
      surface: 'browser',
      risk: 'medium',
      source: 'openswan_tool_runtime',
      rawSelector: '#private',
    },
  });
  check(claim.ok && claim.disposition === 'claimed', 'first exact action atomically claims');
  check(claim.ok && claim.call.state === 'claimed', 'claim returns claimed state');
  check(claim.ok && claim.call.claimToken === CLAIM_TOKEN, 'claim returns its handler-entry token');
  check(fake.calls[0].name === 'claim_agent_action_call', 'store calls the dedicated claim RPC');
  check(fake.calls[0].args.p_ttl_seconds === 900, 'client clamps claim leases to the database maximum');
  check(
    !JSON.stringify(fake.calls[0].args.p_metadata).includes('#private'),
    'raw selector metadata never crosses the RPC boundary',
  );

  const duplicateClaim = await store.claim({ identity });
  check(
    duplicateClaim.ok && duplicateClaim.disposition === 'already_claimed',
    'same exact claim is idempotent before dispatch',
  );
  check(
    duplicateClaim.ok && duplicateClaim.call.claimToken === CLAIM_TOKEN,
    'same exact pre-dispatch claim returns the same claim token',
  );

  const swappedClaim = await store.claim({
    identity: {
      ...identity,
      toolUseId: 'toolu_02_swapped_call',
    },
  });
  check(!swappedClaim.ok && swappedClaim.code === 'identity_conflict', 'tool-use id swap cannot reuse an idempotency key');

  const wrongToken = await store.start({
    identity,
    claimToken: '66666666-6666-4666-8666-666666666666',
  });
  check(!wrongToken.ok && wrongToken.code === 'claim_token_mismatch', 'wrong worker claim token fails closed');

  const [firstStart, secondStart] = await Promise.all([
    store.start({ identity, claimToken: CLAIM_TOKEN }),
    store.start({ identity, claimToken: CLAIM_TOKEN }),
  ]);
  check(firstStart.ok && firstStart.disposition === 'started', 'one concurrent worker enters dispatched state');
  check(secondStart.ok && secondStart.disposition === 'duplicate', 'second concurrent worker cannot duplicate handler entry');
  check(firstStart.ok && firstStart.call.state === 'dispatched', 'start records irreversible handler entry');

  const unsafeDispatchedFailure = await store.finish({
    identity,
    claimToken: CLAIM_TOKEN,
    finalState: 'failed',
    metadata: { errorCode: 'other_worker_preflight_failed' },
  });
  check(
    !unsafeDispatchedFailure.ok && unsafeDispatchedFailure.code === 'invalid_transition',
    'a pre-handler loser cannot rewrite another worker dispatched action as failed',
  );
  check(fake.row?.state === 'dispatched', 'refused dispatched-to-failed transition preserves the in-flight state');

  const unknown = await store.finish({
    identity,
    claimToken: CLAIM_TOKEN,
    finalState: 'outcome_unknown',
    metadata: {
      outcomeUnknown: true,
      completionVerified: false,
      errorCode: 'transport_reset',
    },
  });
  check(unknown.ok && unknown.call.state === 'outcome_unknown', 'attempted unverified mutation records outcome_unknown');
  check(unknown.ok && unknown.disposition === 'finished', 'first terminal write finishes exactly once');

  const unknownAgain = await store.finish({
    identity,
    claimToken: CLAIM_TOKEN,
    finalState: 'outcome_unknown',
  });
  check(unknownAgain.ok && unknownAgain.disposition === 'already_finished', 'same terminal outcome is idempotent');

  const conflictingFinish = await store.finish({
    identity,
    claimToken: CLAIM_TOKEN,
    finalState: 'verified',
  });
  check(!conflictingFinish.ok && conflictingFinish.code === 'state_conflict', 'terminal outcome cannot be rewritten');

  const startAfterFinish = await store.start({ identity, claimToken: CLAIM_TOKEN });
  check(startAfterFinish.ok && startAfterFinish.disposition === 'duplicate', 'finished action can never dispatch again');
  check(
    startAfterFinish.ok
      && startAfterFinish.call.state === 'outcome_unknown'
      && startAfterFinish.call.finishedAt !== null,
    'a start duplicate preserves its genuine terminal durable state and timeline',
  );

  {
    const freshFake = new FakeAtomicActionCallRpc();
    const freshStore = createAgentActionCallStore(freshFake);
    const preDispatchClaim = await freshStore.claim({ identity });
    check(preDispatchClaim.ok, 'separate exact call can be claimed for pre-dispatch failure test');
    const failed = await freshStore.finish({
      identity,
      claimToken: CLAIM_TOKEN,
      finalState: 'failed',
      metadata: { errorCode: 'approval_revoked' },
    });
    check(failed.ok && failed.call.state === 'failed', 'known pre-dispatch failure can finish without pretending dispatch');
    check(failed.ok && failed.call.dispatchedAt === null, 'pre-dispatch failure retains dispatched=false truth');
  }

  {
    const malformedBase = successPayload({
      identity,
      state: 'claimed',
      claimToken: CLAIM_TOKEN,
      claimedAt: '2026-07-26T12:00:00.000Z',
      expiresAt: '2026-07-26T12:02:00.000Z',
      dispatchedAt: null,
      finishedAt: null,
      stateVersion: 1,
      attemptCount: 1,
      metadata: {},
    }, 'claimed', true);
    const swapped = parseAgentActionCallRpcResponse(
      { ...malformedBase, actionId: 'different-action' },
      identity,
      'claim',
    );
    check(!swapped.ok && swapped.code === 'malformed_response', 'RPC action-id swap fails closed');

    const claimedWithoutToken = { ...malformedBase };
    delete claimedWithoutToken.claimToken;
    const missingClaimToken = parseAgentActionCallRpcResponse(
      claimedWithoutToken,
      identity,
      'claim',
    );
    check(
      !missingClaimToken.ok && missingClaimToken.code === 'malformed_response',
      'claimed claim response without a claim token fails closed',
    );

    const duplicateWithToken = parseAgentActionCallRpcResponse(
      {
        ...malformedBase,
        state: 'outcome_unknown',
        disposition: 'duplicate',
        dispatchedAt: '2026-07-26T12:00:30.000Z',
        finishedAt: '2026-07-26T12:01:00.000Z',
      },
      identity,
      'claim',
    );
    check(
      !duplicateWithToken.ok && duplicateWithToken.code === 'malformed_response',
      'duplicate claim response carrying a claim token fails closed',
    );

    const startedWithMalformedToken = parseAgentActionCallRpcResponse(
      {
        ...malformedBase,
        state: 'dispatched',
        disposition: 'started',
        claimToken: 'malformed',
        dispatchedAt: '2026-07-26T12:00:30.000Z',
      },
      identity,
      'start',
    );
    check(
      !startedWithMalformedToken.ok && startedWithMalformedToken.code === 'malformed_response',
      'present malformed start claim token fails closed instead of becoming absent',
    );

    const startedWithValidToken = parseAgentActionCallRpcResponse(
      {
        ...malformedBase,
        state: 'dispatched',
        disposition: 'started',
        dispatchedAt: '2026-07-26T12:00:30.000Z',
      },
      identity,
      'start',
    );
    check(
      !startedWithValidToken.ok && startedWithValidToken.code === 'malformed_response',
      'successful start response carrying even a valid claim token fails closed',
    );

    const finishWithToken = parseAgentActionCallRpcResponse(
      {
        ...malformedBase,
        state: 'verified',
        disposition: 'finished',
        dispatchedAt: '2026-07-26T12:00:30.000Z',
        finishedAt: '2026-07-26T12:01:00.000Z',
      },
      identity,
      'finish',
    );
    check(
      !finishWithToken.ok && finishWithToken.code === 'malformed_response',
      'successful finish response carrying a claim token fails closed',
    );

    const injectedMetadata = parseAgentActionCallRpcResponse(
      { ...malformedBase, metadata: { selector: '#secret' } },
      identity,
      'claim',
    );
    check(!injectedMetadata.ok && injectedMetadata.code === 'malformed_response', 'RPC metadata outside the allowlist fails closed');

    const injectedEnvelope = parseAgentActionCallRpcResponse(
      { ...malformedBase, rawProviderPayload: 'secret' },
      identity,
      'claim',
    );
    check(!injectedEnvelope.ok && injectedEnvelope.code === 'malformed_response', 'unexpected RPC envelope fields fail closed');

    const incoherent = parseAgentActionCallRpcResponse(
      {
        ...malformedBase,
        state: 'verified',
        disposition: 'duplicate',
        dispatchedAt: null,
        finishedAt: '2026-07-26T12:01:00.000Z',
      },
      identity,
      'claim',
    );
    check(!incoherent.ok && incoherent.code === 'malformed_response', 'incoherent terminal timeline fails closed');

    const forgedFailedAfterDispatch = parseAgentActionCallRpcResponse(
      successPayload({
        identity,
        state: 'failed',
        claimToken: CLAIM_TOKEN,
        claimedAt: '2026-07-26T12:00:00.000Z',
        expiresAt: '2026-07-26T12:02:00.000Z',
        dispatchedAt: '2026-07-26T12:00:30.000Z',
        finishedAt: '2026-07-26T12:01:00.000Z',
        stateVersion: 3,
        attemptCount: 1,
        metadata: {},
      }, 'finished'),
      identity,
      'finish',
    );
    check(
      !forgedFailedAfterDispatch.ok
        && forgedFailedAfterDispatch.code === 'malformed_response',
      'forged failed-after-dispatch RPC payload fails closed',
    );
  }

  {
    const migration = readFileSync('supabase/migrations/20260726_agent_action_calls.sql', 'utf8');
    const consolidated = readFileSync('docs/RUN_THIS_SQL.sql', 'utf8');
    const source = readFileSync('src/lib/agentActionCalls.ts', 'utf8');
    check(migration.includes('CREATE TABLE IF NOT EXISTS public.agent_action_calls'), 'migration creates the dedicated action ledger');
    check(migration.includes("'claimed',") && migration.includes("'outcome_unknown'"), 'migration pins the complete action state machine');
    check(migration.includes('idx_agent_action_calls_idempotency') && migration.includes('idx_agent_action_calls_tool_use'), 'database has independent idempotency and provider-call uniqueness');
    check(migration.includes('SECURITY DEFINER') && migration.includes('auth.uid() <> p_user_id'), 'mutation RPCs bind security-definer authority to the authenticated user');
    check(migration.includes('FOR UPDATE') && migration.includes("state = 'dispatched'"), 'handler entry is an atomic locked state transition');
    check(migration.includes('claim_token = p_claim_token') && migration.includes("v_call.state <> 'claimed'"), 'claim token plus claimed-state compare prevents duplicate dispatch');
    check(
      migration.includes("v_call.state = 'dispatched' AND p_final_state = 'failed'")
        && migration.includes('A dispatched action cannot become failed')
        && migration.includes("state = 'failed'\n      AND dispatched_at IS NULL"),
      'database atomically permits failed only for a still-undispatched claimed action',
    );
    check(migration.includes('_sanitize_agent_action_call_metadata'), 'database independently sanitizes bounded metadata');
    check(
      migration.includes("(v_value #>> '{}')::numeric BETWEEN 0 AND 10000")
        && migration.includes("v_key IN (\n      'completionVerified',\n      'outcomeUnknown'")
        && migration.includes("v_text = ANY(ARRAY['low', 'medium', 'high', 'critical']::text[])"),
      'database mirrors per-key count, boolean, and enum constraints',
    );
    check(
      migration.includes("'|^[a-z][a-z0-9+.-]*:'")
        && source.includes('|^[a-z][a-z0-9+.-]*:')
        && !migration.includes("[a-z][a-z0-9+.-]{1,31}://")
        && !migration.includes('(file|data|javascript|mailto|blob|urn):')
        && migration.includes("'|(^|[?&])[a-z0-9_.~-]{1,64}=[^&[:space:]]*'")
        && migration.includes("'|^[a-z]:[\\\\/]'")
        && migration.includes("'|(^|[\\\\/])users[\\\\/][^\\\\/[:space:]]+'"),
      'TypeScript and database share the exact leading URI-scheme rule plus query and POSIX/Windows path rejection',
    );
    check(migration.includes('REVOKE ALL ON TABLE public.agent_action_calls'), 'authenticated callers cannot bypass the RPC with direct writes');
    check(!migration.includes('raw_args') && !migration.includes('selector text') && !migration.includes('url text'), 'ledger schema stores no raw args, selector, or URL');
    check(consolidated.includes('§26. Durable agent action calls'), 'consolidated SQL carries the numbered durable action section');
    check(consolidated.includes('CREATE OR REPLACE FUNCTION public.start_agent_action_call'), 'consolidated SQL includes the atomic handler-entry RPC');
    check(
      consolidated.split(migration).length === 2,
      'consolidated durable action SQL contains exactly one byte-aligned copy of its source migration',
    );
    check(!source.includes("from './supabase'"), 'client foundation has no database singleton dependency');
  }

  console.log(`agent-action-calls smoke: ${assertions} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
