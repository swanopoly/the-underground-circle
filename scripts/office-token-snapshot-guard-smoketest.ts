/**
 * Focused smoke for the client-side Office token snapshot trust boundary.
 *
 * Executes only the dependency-free snapshot section in a VM so malformed
 * bridge telemetry and per-key overflow circuit breaking can be verified
 * without a live Supabase project.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/officeTerminal.ts', 'utf8');
const start = source.indexOf('// ─── Sync agent token snapshot to DB');
const end = source.indexOf('// ─── Update agent position', start);
assert(start >= 0 && end > start, 'Office token snapshot source section exists');

const section = source.slice(start, end).replace(/\bexport\s+/g, '');
const compiled = ts.transpileModule(
  `${section}
;(globalThis as any).__tokenSnapshotGuard = {
  normalizeTokenSnapshotKey,
  validateTokenSnapshotUsage,
  loadOfficeAgentUsageProfilesExact,
  syncAgentTokenSnapshot,
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

type RpcResult = { data?: unknown; error: Record<string, unknown> | null };

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CIRCLE_ID = '22222222-2222-4222-8222-222222222222';
const OBSERVED_AT = '2026-08-21T12:00:00.000Z';

function successReceipt(params: Record<string, unknown>) {
  const now = '2026-08-21T12:00:00.000Z';
  return {
    schemaVersion: 1,
    userId: OWNER_ID,
    circleId: CIRCLE_ID,
    sessionKey: params.p_session_key,
    observationDisposition: 'applied',
    officeAgentRowCount: 0,
    publicProjectionDisposition: 'not_found',
    publicProjectionApplied: false,
    profile: {
      owner_id: OWNER_ID,
      session_key: params.p_session_key,
      agent_name: params.p_agent_name,
      provider_type: params.p_provider_type,
      model_name: params.p_model,
      lifetime_tokens: Number(params.p_input_tokens) + Number(params.p_output_tokens),
      lifetime_input_tokens: params.p_input_tokens,
      lifetime_output_tokens: params.p_output_tokens,
      lifetime_cached_tokens: params.p_cached_tokens,
      lifetime_messages: params.p_message_count,
      lifetime_cost: params.p_estimated_cost,
      session_count: 1,
      last_observed_at: params.p_observed_at,
      first_seen_at: now,
      last_seen_at: now,
      updated_at: now,
    },
  };
}

function createHarness(
  results: RpcResult[] = [],
  profileRead: { data: unknown[] | null; error: unknown; count: number | null } = {
    data: [],
    error: null,
    count: 0,
  },
) {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const warnings: string[] = [];
  let authCalls = 0;
  const sandbox: Record<string, unknown> = {
    console: {
      warn: (...values: unknown[]) => warnings.push(values.map(String).join(' ')),
    },
    AbortController,
    normalizeTerminalExactAuthority: (authority: any) => authority,
    createTerminalAuthorityOperationFence: (authority: any, isCurrent: (value: any) => boolean) => {
      if (!authority || !isCurrent(authority)) return null;
      const controller = new AbortController();
      return {
        authority,
        signal: controller.signal,
        isCurrent: () => isCurrent(authority),
        stop: () => {},
      };
    },
    safeGetUserForAccessToken: async () => {
      authCalls += 1;
      return { value: { id: OWNER_ID }, error: null };
    },
    getSupabaseClientForAccessToken: () => ({
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          limit: () => builder,
          abortSignal: async () => profileRead,
        };
        return builder;
      },
      rpc: (name: string, params: Record<string, unknown>) => ({
        abortSignal: async () => {
        rpcCalls.push({ name, params });
          const result = results.shift() || { error: null };
          return {
            data: result.data ?? (result.error ? null : successReceipt(params)),
            error: result.error,
          };
        },
      }),
    }),
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    core: sandbox.__tokenSnapshotGuard as {
      normalizeTokenSnapshotKey: (agentName: string, snapshotKey?: string) => string;
      validateTokenSnapshotUsage: (
        inputTokens: number,
        outputTokens: number,
        cachedTokens: number,
        messageCount: number,
        estimatedCost: number,
      ) => { valid: boolean; field?: string };
      loadOfficeAgentUsageProfilesExact: (
        authority: { userId: string; circleId: string; accessToken: string; generation: number },
        isCurrent: (authority: unknown) => boolean,
      ) => Promise<{ ok: boolean; profiles?: Map<string, unknown> }>;
      syncAgentTokenSnapshot: (
        input: {
          authority: { userId: string; circleId: string; accessToken: string; generation: number };
          isCurrent: (authority: unknown) => boolean;
          agentName: string;
          providerType: string;
          inputTokens: number;
          outputTokens: number;
          cachedTokens: number;
          messageCount: number;
          estimatedCost: number;
          model?: string;
          snapshotKey: string;
          observedAt: string;
        },
      ) => Promise<{ ok: boolean }>;
    },
    rpcCalls,
    warnings,
    authCalls: () => authCalls,
  };
}

async function main() {
const authority = { userId: OWNER_ID, circleId: CIRCLE_ID, accessToken: 'access-token', generation: 1 };
const current = () => true;
const validation = createHarness();
assert.equal(validation.core.normalizeTokenSnapshotKey('Codex Agent', '  session-1  '), 'session-1');
assert.equal(validation.core.normalizeTokenSnapshotKey('Codex Agent', '   '), 'codex agent');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, 0.25).valid, true);
assert.equal(validation.core.validateTokenSnapshotUsage(Number.NaN, 2, 3, 4, 0.25).field, 'inputTokens');
assert.equal(validation.core.validateTokenSnapshotUsage(1, Number.POSITIVE_INFINITY, 3, 4, 0.25).field, 'outputTokens');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, -1, 4, 0.25).field, 'cachedTokens');
assert.equal(
  validation.core.validateTokenSnapshotUsage(Number.MAX_SAFE_INTEGER + 1, 0, 0, 0, 0).field,
  'inputTokens',
);
assert.equal(
  validation.core.validateTokenSnapshotUsage(Number.MAX_SAFE_INTEGER, 1, 0, 0, 0).field,
  'outputTokens',
);
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 2_147_483_648, 0).field, 'messageCount');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, Number.POSITIVE_INFINITY).field, 'estimatedCost');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, 1_000_000).field, 'estimatedCost');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, 999_999.999_999).valid, true);

const loaderProfile = successReceipt({
  p_session_key: 'loaded-session',
  p_agent_name: 'Loaded Agent',
  p_provider_type: 'codex',
  p_model: 'openai/gpt-5.6-sol',
  p_input_tokens: 10,
  p_output_tokens: 5,
  p_cached_tokens: 2,
  p_message_count: 3,
  p_estimated_cost: 0.12,
  p_observed_at: OBSERVED_AT,
}).profile;
const countCompleteLoader = createHarness([], { data: [loaderProfile], error: null, count: 1 });
const loadedProfiles = await countCompleteLoader.core.loadOfficeAgentUsageProfilesExact(authority, current);
assert.equal(loadedProfiles.ok, true, 'a count-complete exact owner lifetime snapshot loads');
assert.equal(loadedProfiles.profiles?.has('loaded-session'), true, 'the loader keys rows by exact session');
const incompleteLoader = createHarness([], { data: [loaderProfile], error: null, count: 2 });
assert.equal(
  (await incompleteLoader.core.loadOfficeAgentUsageProfilesExact(authority, current)).ok,
  false,
  'an incomplete lifetime snapshot fails closed',
);
const wrongOwnerLoader = createHarness([], {
  data: [{ ...loaderProfile, owner_id: '33333333-3333-4333-8333-333333333333' }],
  error: null,
  count: 1,
});
assert.equal(
  (await wrongOwnerLoader.core.loadOfficeAgentUsageProfilesExact(authority, current)).ok,
  false,
  'a cross-owner lifetime row fails closed even if the server returned it',
);

const invalidInput = {
  authority,
  isCurrent: current,
  agentName: 'Invalid Agent',
  providerType: 'codex',
  inputTokens: Number.NaN,
  outputTokens: 0,
  cachedTokens: 0,
  messageCount: 0,
  estimatedCost: 0,
  snapshotKey: 'invalid-key',
  observedAt: OBSERVED_AT,
};
await validation.core.syncAgentTokenSnapshot(invalidInput);
await validation.core.syncAgentTokenSnapshot(invalidInput);
assert.equal(validation.authCalls(), 0, 'invalid telemetry is rejected before auth or RPC work');
assert.equal(validation.rpcCalls.length, 0, 'invalid telemetry is never sent to Supabase');
assert.equal(validation.warnings.length, 1, 'an invalid snapshot emits one bounded warning per identity');
const invalidObservation = await validation.core.syncAgentTokenSnapshot({
  ...invalidInput,
  inputTokens: 1,
  observedAt: 'not-a-date',
});
assert.equal(invalidObservation.ok, false, 'an invalid observation timestamp fails closed');
assert.equal(validation.authCalls(), 0, 'an invalid observation timestamp is rejected before auth');

const overflow = createHarness([
  { error: { code: '22003', message: 'value out of range' } },
  { error: null },
]);
const syncValid = (key: string) => overflow.core.syncAgentTokenSnapshot({
  authority,
  isCurrent: current,
  agentName: 'Codex Agent',
  providerType: 'codex',
  inputTokens: 100,
  outputTokens: 50,
  cachedTokens: 10,
  messageCount: 2,
  estimatedCost: 0.123456,
  model: 'model-name',
  snapshotKey: key,
  observedAt: OBSERVED_AT,
});
await syncValid('overflow-key');
await syncValid('overflow-key');
const healthyResult = await syncValid('healthy-key');
assert.equal(overflow.rpcCalls.length, 2, 'only the overflowing normalized snapshot identity is disabled');
assert.equal(overflow.rpcCalls[0].params.p_session_key, 'overflow-key');
assert.equal(overflow.rpcCalls[1].params.p_session_key, 'healthy-key');
assert.equal(overflow.rpcCalls[1].params.p_observed_at, OBSERVED_AT);
assert.equal(healthyResult.ok, true, 'a strict structured lifetime receipt is accepted');
assert.equal(overflow.warnings.length, 1, 'SQLSTATE 22003 emits one warning and does not retry the bad key');
assert.match(overflow.warnings[0], /other agent snapshots will continue/i);
assert.match(overflow.warnings[0], /No usage values were clamped or written/i);

const messageOverflow = createHarness([
  { error: { message: 'numeric field overflow' } },
]);
await messageOverflow.core.syncAgentTokenSnapshot({
  authority,
  isCurrent: current,
  agentName: 'Claude Agent',
  providerType: 'claude-code',
  inputTokens: 1,
  outputTokens: 1,
  cachedTokens: 0,
  messageCount: 1,
  estimatedCost: 1,
  snapshotKey: 'message-overflow-key',
  observedAt: OBSERVED_AT,
});
assert.equal(messageOverflow.rpcCalls.length, 1, 'numeric field overflow is not replayed through the legacy signature');
assert.equal(messageOverflow.warnings.length, 1, 'numeric field overflow emits one bounded diagnostic');

const malformedReceipt = createHarness([{
  error: null,
  data: {
    ...successReceipt({
      p_session_key: 'bad-receipt',
      p_agent_name: 'Codex Agent',
      p_provider_type: 'codex',
      p_model: null,
      p_input_tokens: 1,
      p_output_tokens: 1,
      p_cached_tokens: 0,
      p_message_count: 1,
      p_estimated_cost: 0.01,
      p_observed_at: OBSERVED_AT,
    }),
    officeAgentRowCount: 1,
    publicProjectionDisposition: 'applied',
    publicProjectionApplied: false,
  },
}]);
const malformedResult = await malformedReceipt.core.syncAgentTokenSnapshot({
  authority,
  isCurrent: current,
  agentName: 'Codex Agent',
  providerType: 'codex',
  inputTokens: 1,
  outputTokens: 1,
  cachedTokens: 0,
  messageCount: 1,
  estimatedCost: 0.01,
  snapshotKey: 'bad-receipt',
  observedAt: OBSERVED_AT,
});
assert.equal(malformedResult.ok, false, 'a contradictory projection receipt fails closed');

console.log('office token snapshot guard smoke passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
