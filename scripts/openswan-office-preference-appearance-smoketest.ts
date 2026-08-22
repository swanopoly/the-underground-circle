import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import {
  buildOpenSwanAgentAppearance,
  normalizeOpenSwanAgentAppearancePatch,
} from '../src/lib/openswanOfficePreferenceAppearanceCore';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://appearance-runtime.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'appearance-runtime-anon-key';
// This smoke explicitly exercises the reviewed §45 RPC path. Production builds
// remain default-off until that migration is applied and verified.
process.env.EXPO_PUBLIC_OFFICE_USER_PREFERENCES_STORAGE_V1 = 'true';

const NATIVE_STUBS = new Set([
  'react-native',
  '@react-native-async-storage/async-storage',
]);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) {
      return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const root = resolve(__dirname, '..');
const runtime = readFileSync(resolve(root, 'src/lib/openswanToolRuntime.ts'), 'utf8');
const session = readFileSync(resolve(root, 'src/lib/openswanSessionRuntime.ts'), 'utf8');
const legacy = readFileSync(resolve(root, 'src/lib/swanbot.ts'), 'utf8');
const shim = readFileSync(resolve(root, 'src/lib/openswanTools/index.ts'), 'utf8');
const chat = readFileSync(resolve(root, 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8');

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

const validPatch = normalizeOpenSwanAgentAppearancePatch({
  shirtColor: '#112233',
  aura: 'galaxy',
  handItem: 'coffee',
});
check(validPatch?.shirtColor === '#112233', 'valid color patch survives normalization');
check(validPatch?.aura === 'galaxy', 'valid enum patch survives normalization');
check(validPatch?.handItem === 'coffee', 'the fifteenth appearance field is supported');
check(normalizeOpenSwanAgentAppearancePatch({}) === null, 'empty model patch is rejected');
check(normalizeOpenSwanAgentAppearancePatch({ shirtColor: 'red' }) === null, 'non-hex color is rejected');
check(normalizeOpenSwanAgentAppearancePatch({ aura: 'secret' }) === null, 'unknown enum is rejected');
check(normalizeOpenSwanAgentAppearancePatch({ unexpected: 'value' }) === null, 'unknown field is rejected');

const complete = buildOpenSwanAgentAppearance(
  { pet: 'swan', shirtColor: '#abcdef', unexpected: 'drop-me' },
  validPatch!,
);
check(Object.keys(complete).length === 15, 'server document has exactly fifteen appearance fields');
check(complete.pet === 'swan', 'untouched valid existing fields are preserved');
check(complete.shirtColor === '#112233', 'validated patch wins its exact field');
check(!('unexpected' in complete), 'unreviewed existing fields are not projected');

const handlerStart = runtime.indexOf("case 'agent.update_appearance': {");
const handlerEnd = runtime.indexOf("case 'agent.rename':", handlerStart);
const handler = runtime.slice(handlerStart, handlerEnd);
check(handlerStart >= 0 && handlerEnd > handlerStart, 'appearance handler has exact source boundaries');
check(
  handler.includes('loadOfficeUserPreferences(authority.circleId, authScope)')
    && handler.includes('patchOfficeUserPreferences('),
  'appearance uses the canonical private Office preference read and patch path',
);
check(
  !handler.includes(".from('profiles')")
    && !handler.includes('agent_appearance'),
  'appearance no longer reads or writes peer-readable legacy profile fields',
);
check(
  (handler.match(/resolveOpenSwanExactOfficePreferenceAuthority\(context\)/g) || []).length >= 4,
  'authority is checked before read, after read, before mutation, and after receipt',
);
check(
  handler.includes('userId: authority.userId')
    && handler.includes('accessToken: authority.accessToken'),
  'the canonical preference client receives the captured user and bearer',
);
check(
  handler.includes('private preference revision ${receipt.revision}')
    && handler.includes('Office accepted preference revision ${receipt.revision}'),
  'success and late-retirement outcomes are based on an exact server revision receipt',
);
check(
  runtime.includes("'agent.update_appearance': { writes: ['office_user_preferences'] }"),
  'the mutation manifest names the canonical private preference store',
);
check(
  runtime.slice(
    runtime.indexOf('const ACTION_LEDGER_MUTATION_TOOLS = ['),
    runtime.indexOf('const PROPOSAL_ONLY_MUTATION_TOOLS = ['),
  ).includes("'agent.update_appearance'")
    && !runtime.slice(
      runtime.indexOf('const UNSUPPORTED_MUTATION_TOOLS = ['),
      runtime.indexOf('const OPEN_SWAN_CATALOG_TOOL_NAMES'),
    ).includes("'agent.update_appearance'"),
  'appearance is executable only through the durable action-ledger authority lane',
);
check(
  runtime.includes('claimDurableOfficeAppearanceAction({')
    && handler.includes('lease.store.start({')
    && handler.includes("finishDurableAgentAction(lease, 'verified'")
    && handler.includes("finishDurableAgentAction(lease, 'outcome_unknown'"),
  'the adapter claims exact-call authority, starts immediately before dispatch, and seals verified or unknown terminal truth',
);
check(
  runtime.includes('observedRevision: loaded.revision')
    && runtime.includes("operation: 'patch_my_office_preferences_v1:appearances'")
    && runtime.includes('idempotencyKey: `office-appearance-v1:${exactCallDigest}`'),
  'the durable identity binds the observed revision, canonical mutation contract, and exact-call idempotency key',
);

for (const [source, label] of [
  [runtime, 'runtime context'],
  [session, 'typed and approval-resume session paths'],
  [legacy, 'legacy tool loop'],
  [shim, 'legacy compatibility shim'],
  [chat, 'Chat owner'],
] as const) {
  check(source.includes('exactCircleAuthority'), `${label} carries the exact authority snapshot`);
  check(source.includes('isExactCircleAuthorityCurrent'), `${label} carries the live authority fence`);
}
check(
  session.includes('exactCircleAuthority: opts.exactCircleAuthority')
    && session.includes('exactCircleAuthority: args.exactCircleAuthority'),
  'both session option and typed loop context preserve exact authority',
);
check(
  legacy.includes('exactCircleAuthority: opts.exactCircleAuthority'),
  'manual legacy-loop rollback retains the same exact authority',
);
check(
  chat.includes('exactCircleAuthority: runHistoryExactAuthority')
    && chat.includes('isExactCircleAuthorityCurrent: isRunHistoryExactAuthorityCurrent'),
  'Chat supplies its existing exact Circle authority owner',
);

const swanBotContextStart = legacy.indexOf('export type SwanBotContext = {');
const swanBotContextEnd = legacy.indexOf('\n};', swanBotContextStart);
const swanBotContext = legacy.slice(swanBotContextStart, swanBotContextEnd);
check(
  !swanBotContext.includes('exactCircleAuthority')
    && !swanBotContext.includes('accessToken'),
  'bearer authority stays outside model/prompt SwanBotContext',
);

const USER_ID = '22222222-2222-4222-8222-222222222222';
const CIRCLE_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const RECORD_ID = '55555555-5555-4555-8555-555555555555';
const CLAIM_TOKEN = '66666666-6666-4666-8666-666666666666';
const ACCESS_TOKEN = 'appearance-exact-access-token';

type LedgerState = 'none' | 'claimed' | 'dispatched' | 'verified' | 'outcome_unknown';

async function runRuntimeBehavior(): Promise<void> {
  let ledgerState: LedgerState = 'none';
  let stateVersion = 0;
  let identity: Record<string, unknown> | null = null;
  let ledgerMetadata: Record<string, unknown> = {};
  let authorityCurrent = true;
  let retireAuthorityAfterPatch = false;
  let preferenceRevision = 7;
  let preferenceDocument: Record<string, unknown> = {
    appearances: {
      BlackSwan: { pet: 'swan', shirtColor: '#abcdef' },
    },
  };
  const rpcOrder: string[] = [];
  const preferencePatches: Record<string, unknown>[] = [];

  const identityFromBody = (body: Record<string, unknown>) => ({
    userId: body.p_user_id,
    circleId: body.p_circle_id,
    runId: body.p_run_id,
    tool: body.p_tool_name,
    toolUseId: body.p_tool_use_id,
    actionId: body.p_action_id,
    toolArgsFingerprint: body.p_tool_args_fingerprint,
    contractFingerprint: body.p_contract_fingerprint,
    idempotencyKey: body.p_idempotency_key,
  });
  const ledgerPayload = (
    disposition: 'claimed' | 'started' | 'finished' | 'duplicate',
    includeClaimToken: boolean,
  ) => {
    assert(identity, 'ledger identity must be captured before a response');
    const dispatched = ledgerState === 'dispatched'
      || ledgerState === 'verified'
      || ledgerState === 'outcome_unknown';
    const finished = ledgerState === 'verified' || ledgerState === 'outcome_unknown';
    return {
      schemaVersion: 1,
      ok: true,
      disposition,
      id: RECORD_ID,
      state: ledgerState,
      ...identity,
      ...(includeClaimToken ? { claimToken: CLAIM_TOKEN } : {}),
      claimedAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-21T12:00:00.000Z',
      dispatchedAt: dispatched ? '2026-08-20T12:00:01.000Z' : null,
      finishedAt: finished ? '2026-08-20T12:00:02.000Z' : null,
      stateVersion,
      attemptCount: 1,
      metadata: ledgerMetadata,
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const rpcName = url.pathname.split('/').pop() || '';
    const bodyText = await request.text();
    const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};
    check(
      request.headers.get('authorization') === `Bearer ${ACCESS_TOKEN}`,
      `${rpcName} uses the captured exact bearer`,
    );
    rpcOrder.push(rpcName);

    let responseBody: unknown;
    if (rpcName === 'read_my_office_preferences_v1') {
      responseBody = [{
        preferences: preferenceDocument,
        revision: preferenceRevision,
      }];
    } else if (rpcName === 'claim_agent_action_call') {
      const requestedIdentity = identityFromBody(body);
      if (ledgerState === 'verified' || ledgerState === 'outcome_unknown') {
        responseBody = JSON.stringify(requestedIdentity) === JSON.stringify(identity)
          ? ledgerPayload('duplicate', false)
          : {
              schemaVersion: 1,
              ok: false,
              code: 'identity_conflict',
              message: 'This tool call is already bound to another durable identity.',
            };
      } else {
        identity = requestedIdentity;
        ledgerMetadata = body.p_metadata as Record<string, unknown>;
        ledgerState = 'claimed';
        stateVersion = 1;
        responseBody = ledgerPayload('claimed', true);
      }
    } else if (rpcName === 'start_agent_action_call') {
      check(body.p_claim_token === CLAIM_TOKEN, 'durable start carries the exact one-shot claim token');
      ledgerState = 'dispatched';
      stateVersion = 2;
      responseBody = ledgerPayload('started', false);
    } else if (rpcName === 'patch_my_office_preferences_v1') {
      preferencePatches.push(body);
      const partial = body.p_patch;
      if (partial && typeof partial === 'object' && !Array.isArray(partial)) {
        preferenceDocument = {
          ...preferenceDocument,
          ...(partial as Record<string, unknown>),
        };
      }
      preferenceRevision += 1;
      if (retireAuthorityAfterPatch) authorityCurrent = false;
      responseBody = [{ accepted: true, revision: preferenceRevision, updated_at: '2026-08-20T12:00:01.500Z' }];
    } else if (rpcName === 'finish_agent_action_call') {
      check(body.p_final_state === 'verified', 'accepted §45 receipt finalizes the durable call as verified');
      ledgerMetadata = { ...ledgerMetadata, ...(body.p_metadata as Record<string, unknown>) };
      ledgerState = body.p_final_state as LedgerState;
      stateVersion = 3;
      responseBody = ledgerPayload('finished', false);
    } else {
      return new Response(JSON.stringify({ message: `unexpected request ${url.pathname}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const imported = await import('../src/lib/openswanToolRuntime');
    const liveRuntime = ((imported as { default?: typeof imported }).default || imported);
    const authority = Object.freeze({
      userId: USER_ID,
      circleId: CIRCLE_ID,
      accessToken: ACCESS_TOKEN,
      generation: 9,
    });
    const context = {
      userId: USER_ID,
      circleId: CIRCLE_ID,
      runId: RUN_ID,
      toolName: 'agent.update_appearance',
      toolUseId: 'appearance-call-1',
      iteration: 1,
      surface: 'main_chat',
      mode: 'execute',
      exactCircleAuthority: authority,
      isExactCircleAuthorityCurrent: (candidate: unknown) => (
        authorityCurrent && candidate === authority
      ),
    };
    const toolArgs = {
      agent_name: 'BlackSwan',
      patch: { shirtColor: '#112233', aura: 'galaxy' },
    };

    const result = await (liveRuntime.executeOpenSwanRuntimeTool as any)(
      'agent.update_appearance',
      toolArgs,
      context,
    );
    check(result.ok === true, 'the public typed runtime reaches the real appearance adapter');
    check(result.completionVerified === true && result.outcomeUnknown === false, 'accepted §45 revision is reported as verified completion');
    check(/private preference revision 8/.test(result.resultsText), 'the visible result is derived from the exact accepted revision');
    check(
      rpcOrder.join(',') === 'read_my_office_preferences_v1,claim_agent_action_call,start_agent_action_call,patch_my_office_preferences_v1,finish_agent_action_call',
      'read-only observation precedes claim, durable start immediately precedes the one §45 mutation, and verified finish follows its receipt',
    );
    const sentPatch = preferencePatches[0]?.p_patch as {
      appearances?: Record<string, Record<string, unknown>>;
    } | undefined;
    check(Object.keys(sentPatch?.appearances?.BlackSwan || {}).length === 15, 'the reached adapter sends the complete fifteen-field appearance document');
    check(sentPatch?.appearances?.BlackSwan?.pet === 'swan', 'the reached adapter preserves an untouched observed field');
    check(sentPatch?.appearances?.BlackSwan?.shirtColor === '#112233', 'the reached adapter applies the normalized requested field');

    const callsBeforeReplay = rpcOrder.length;
    const replayResult = await (liveRuntime.executeOpenSwanRuntimeTool as any)(
      'agent.update_appearance',
      toolArgs,
      context,
    );
    check(replayResult.ok === false, 'an exact repeated provider call is not presented as a second success');
    check(/identity_conflict/i.test(replayResult.resultsText), 'the exact repeat reports the real §26 identity conflict after the observed revision advances');
    check(preferencePatches.length === 1, 'the exact repeated provider call cannot increment the §45 revision twice');
    check(
      rpcOrder.slice(callsBeforeReplay).join(',') === 'read_my_office_preferences_v1,claim_agent_action_call',
      'a replay stops at the durable identity-conflict claim before start or mutation',
    );

    ledgerState = 'none';
    stateVersion = 0;
    identity = null;
    ledgerMetadata = {};
    authorityCurrent = true;
    retireAuthorityAfterPatch = true;
    const callsBeforeLateRetirement = rpcOrder.length;
    const retiredAfterReceiptResult = await (liveRuntime.executeOpenSwanRuntimeTool as any)(
      'agent.update_appearance',
      toolArgs,
      { ...context, toolUseId: 'appearance-call-late-retirement' },
    );
    check(retiredAfterReceiptResult.ok === true, 'an accepted revision remains truthful success after the owning surface retires');
    check(
      retiredAfterReceiptResult.completionVerified === true
        && retiredAfterReceiptResult.outcomeUnknown === false,
      'late authority retirement cannot erase accepted completion truth',
    );
    check(/durably replay-blocked/i.test(retiredAfterReceiptResult.resultsText), 'late retirement reports replay protection without exposing private state');
    check(ledgerState === 'verified', 'late retirement still finalizes the accepted revision as verified');
    check(preferencePatches.length === 2, 'late retirement does not cause a duplicate preference mutation');
    check(
      rpcOrder.slice(callsBeforeLateRetirement).join(',') === 'read_my_office_preferences_v1,claim_agent_action_call,start_agent_action_call,patch_my_office_preferences_v1,finish_agent_action_call',
      'accepted completion is durably finalized before the retired surface result is returned',
    );

    retireAuthorityAfterPatch = false;
    authorityCurrent = true;
    let hashingWindowFenceChecks = 0;
    const callsBeforeHashingWindowRetirement = rpcOrder.length;
    const hashingWindowRetiredResult = await (liveRuntime.executeOpenSwanRuntimeTool as any)(
      'agent.update_appearance',
      toolArgs,
      {
        ...context,
        toolUseId: 'appearance-call-hashing-window-retired',
        isExactCircleAuthorityCurrent: (candidate: unknown) => {
          hashingWindowFenceChecks += 1;
          return candidate === authority && hashingWindowFenceChecks <= 2;
        },
      },
    );
    check(hashingWindowRetiredResult.ok === false, 'authority retired during mutation hashing is rejected');
    check(/before the durable appearance claim/i.test(hashingWindowRetiredResult.resultsText), 'the post-hash pre-claim fence reports the exact blocked boundary');
    check(
      rpcOrder.slice(callsBeforeHashingWindowRetirement).join(',') === 'read_my_office_preferences_v1',
      'authority retirement during async hashing cannot write even a §26 claim row',
    );

    retireAuthorityAfterPatch = false;
    authorityCurrent = false;
    const requestsBeforeDeniedAuthority = rpcOrder.length;
    const deniedResult = await (liveRuntime.executeOpenSwanRuntimeTool as any)(
      'agent.update_appearance',
      toolArgs,
      {
        ...context,
        toolUseId: 'appearance-call-denied',
      },
    );
    check(deniedResult.ok === false, 'retired exact authority is rejected');
    check(/exact signed-in user and Circle authority is unavailable or changed/i.test(deniedResult.resultsText), 'authority denial is explicit and bounded');
    check(rpcOrder.length === requestsBeforeDeniedAuthority, 'authority rejection performs no read, claim, start, or mutation request');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runRuntimeBehavior()
  .then(() => {
    console.log(`OpenSwan Office preference appearance smoke passed (${assertions} assertions).`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
