/**
 * Adversarial smoke for authenticated agent-identity storage and transport.
 *
 * The exact authority core is executed with a fake auth client, while source
 * boundaries pin local cache isolation and explicit PostgREST bearer binding.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/agentIdentity.ts', 'utf8');
const spiritAssignmentSql = fs.readFileSync(
  'supabase/migrations/20260817140000_agent_spirit_assignment_rpc.sql',
  'utf8',
);
let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

function section(start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const authorityPrelude = section(
  "const STORAGE_KEY_AGENT_IDENTITY = '@agent_identity_store';",
  "export type TerminalLaunchMode = 'safe' | 'auto' | 'full-auto';",
).replace(/\bexport\s+/g, '');
const verifySource = section(
  'async function verifyAgentIdentityExactAuthority',
  '/**\n * Read only the cache owned by the exact verified user/circle authority.',
);
const cacheParserSource = section(
  'function isAgentIdentityNonNegativeFiniteNumber',
  'async function verifyAgentIdentityExactAuthority',
);
const compiled = ts.transpileModule(
  `${authorityPrelude}\n${cacheParserSource}\n${verifySource}\n;(globalThis as any).__exact = { agentIdentityExactStorageKey, normalizeAgentIdentityExactAuthority, parseExactAgentIdentityCache, isAgentIdentityServerNonNegativeSafeInteger, verifyAgentIdentityExactAuthority };`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const authCalls: string[] = [];
let mutableGlobalUser = 'user-a';
let releaseVerification: (() => void) | null = null;
let verificationGate: Promise<void> | null = null;
const sandbox: Record<string, unknown> = {
  safeGetUserForAccessToken: async (token: string) => {
    authCalls.push(token);
    if (verificationGate) await verificationGate;
    const tokenOwner = token === 'token-a' ? 'user-a' : token === 'token-b' ? 'user-b' : null;
    return tokenOwner
      ? { value: { id: tokenOwner }, error: null }
      : { value: null, error: new Error('invalid token') };
  },
  supabase: {
    auth: {
      getUser: async (token: string) => {
        authCalls.push(token);
        if (verificationGate) await verificationGate;
        const tokenOwner = token === 'token-a' ? 'user-a' : token === 'token-b' ? 'user-b' : null;
        return tokenOwner
          ? { data: { user: { id: tokenOwner } }, error: null }
          : { data: { user: null }, error: new Error('invalid token') };
      },
      getSession: async () => ({
        data: { session: { user: { id: mutableGlobalUser }, access_token: `token-${mutableGlobalUser}` } },
        error: null,
      }),
    },
  },
};
vm.runInNewContext(compiled, sandbox);
const exact = sandbox.__exact as {
  agentIdentityExactStorageKey: (authority: unknown) => string | null;
  normalizeAgentIdentityExactAuthority: (authority: unknown) => {
    userId: string;
    circleId: string | null;
    accessToken: string;
  } | null;
  verifyAgentIdentityExactAuthority: (authority: unknown) => Promise<{
    userId: string;
    circleId: string | null;
    accessToken: string;
  } | null>;
  parseExactAgentIdentityCache: (raw: string | null) => Map<string, unknown> | null;
  isAgentIdentityServerNonNegativeSafeInteger: (value: unknown) => boolean;
};

const writeModeSource = section(
  'function agentIdentityExactServerWriteMode',
  'async function persistIdentitiesToServerExact',
);
const writeModeSandbox: Record<string, unknown> = {};
vm.runInNewContext(
  ts.transpileModule(
    `${writeModeSource}\n;(globalThis as any).__writeMode = agentIdentityExactServerWriteMode;`,
    { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  writeModeSandbox,
);
const exactWriteMode = writeModeSandbox.__writeMode as (
  versions: ReadonlyMap<string, string>,
  sessionKey: string,
) => 'update' | 'insert';

const primaryReceiptParserSource = section(
  'function parseAgentIdentityPrimaryRpcReceipt',
  'function agentIdentityExactServerWriteMode',
);
const primaryReceiptSandbox: Record<string, unknown> = {
  MAX_AGENT_IDENTITIES_PER_SCOPE: 5_000,
  MAX_AGENT_IDENTITY_CACHE_BYTES: 4 * 1024 * 1024,
  normalizeAgentIdentityScopePart: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= 200 ? normalized : null;
  },
  isAgentIdentityUuidLike: (value: unknown) => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value),
  rowToIdentity: (row: Record<string, unknown>) => ({
    sessionKey: row.session_key,
    totalCostAllTime: Number(row.total_cost_all_time),
    totalTokensAllTime: Number(row.total_tokens_all_time),
    totalSessionsAllTime: Number(row.total_sessions_all_time),
    firstSeen: new Date(String(row.first_seen)).getTime(),
    lastSeen: new Date(String(row.last_seen)).getTime(),
    totalMessages: Number(row.total_messages),
    totalTurns: Number(row.total_turns),
    isPrimary: row.is_primary,
    boundAiProvider: row.bound_ai_provider,
  }),
  parseExactAgentIdentityCache: (raw: string) => {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map(Object.entries(parsed));
  },
};
vm.runInNewContext(
  ts.transpileModule(
    `${primaryReceiptParserSource}\n;(globalThis as any).__parsePrimaryReceipt = parseAgentIdentityPrimaryRpcReceipt;`,
    { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  primaryReceiptSandbox,
);
const parsePrimaryReceipt = primaryReceiptSandbox.__parsePrimaryReceipt as (
  data: unknown,
  authority: { userId: string },
  sessionKey: string,
  providerType: string,
) => { providerIdentities: Map<string, unknown> } | null;

const spiritReceiptParserSource = section(
  'function parseCustomProfileDeleteRpcReceipt',
  'function agentIdentityExactServerWriteMode',
);
const spiritReceiptSandbox: Record<string, unknown> = {
  MAX_AGENT_IDENTITY_CACHE_BYTES: 4 * 1024 * 1024,
  normalizeAgentIdentityScopePart: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= 200 ? normalized : null;
  },
  isAgentIdentityUuidLike: (value: unknown) => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value),
  rowToIdentity: (row: Record<string, unknown>) => ({
    sessionKey: row.session_key,
    spiritId: row.spirit_id,
    spiritEmoji: row.spirit_emoji,
    customProfileId: row.custom_profile_id,
    customProfileName: row.custom_profile_name,
    isCustomized: row.is_customized,
    totalCostAllTime: Number(row.total_cost_all_time),
    totalTokensAllTime: Number(row.total_tokens_all_time),
    totalSessionsAllTime: Number(row.total_sessions_all_time),
    firstSeen: new Date(String(row.first_seen)).getTime(),
    lastSeen: new Date(String(row.last_seen)).getTime(),
    totalMessages: Number(row.total_messages),
    totalTurns: Number(row.total_turns),
  }),
  parseExactAgentIdentityCache: (raw: string) => new Map(Object.entries(JSON.parse(raw))),
};
vm.runInNewContext(
  ts.transpileModule(
    `${spiritReceiptParserSource}\n;(globalThis as any).__spiritReceipts = { parsePublishedAgentSpiritRpcReceipt, parseCustomProfileDeleteRpcReceipt };`,
    { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  spiritReceiptSandbox,
);
const spiritReceipts = spiritReceiptSandbox.__spiritReceipts as {
  parsePublishedAgentSpiritRpcReceipt: (
    data: unknown,
    authority: { userId: string; circleId: string },
    input: Record<string, unknown>,
  ) => { identity: Record<string, unknown> } | null;
  parseCustomProfileDeleteRpcReceipt: (
    data: unknown,
    authority: { userId: string },
    profileId: string,
  ) => boolean;
};

const exactPrimaryFunctionSource = section(
  'export async function setMainAgentForProviderExact',
  '// ─── Customize Agent Appearance',
).replace(/^export\s+/u, '');
const exactSpiritFunctionSource = section(
  'export async function updatePublishedAgentSpiritExact',
  '/** Delete one owner profile only after the server proves it is unreferenced. */',
).replace(/^export\s+/u, '');
const commandEpochSource = section(
  'type AgentIdentityExactCommandEpoch',
  '/**\n * Exact cache key used by authenticated callers.',
);
const exactProfileDeleteFunctionSource = section(
  'export async function deleteUnreferencedCustomAgentProfileExact',
  '// ─── Record Agent Activity',
).replace(/^export\s+/u, '');

function makePrimaryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_id: 'user-a',
    session_key: 'agent-a',
    bound_ai_provider: 'openswan',
    is_primary: true,
    first_seen: '2026-08-17T12:00:00.000Z',
    last_seen: '2026-08-17T12:01:00.000Z',
    updated_at: '2026-08-17T12:01:00.000Z',
    total_cost_all_time: 0,
    total_tokens_all_time: 0,
    total_sessions_all_time: 0,
    total_messages: 0,
    total_turns: 0,
    ...overrides,
  };
}

function makePrimaryReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    userId: 'user-a',
    providerType: 'openswan',
    requestedSessionKey: 'agent-a',
    primarySessionKey: 'agent-a',
    primaryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    primaryUpdatedAt: '2026-08-17T12:01:00.000Z',
    inserted: false,
    clearedCount: 1,
    targetRowCount: 1,
    rowCount: 1,
    rows: [makePrimaryRow()],
    ...overrides,
  };
}

const spiritOfficeAgentId = '10000000-0000-4000-8000-000000000001';
const spiritProfileId = 'c0000000-0000-4000-8000-000000000001';
function makeSpiritIdentityRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd0000000-0000-4000-8000-000000000001',
    user_id: 'user-a',
    session_key: spiritOfficeAgentId,
    spirit_id: 'builder',
    spirit_emoji: 'tool',
    custom_profile_id: null,
    custom_profile_name: null,
    is_customized: true,
    first_seen: '2026-08-17T12:00:00.000Z',
    last_seen: '2026-08-17T12:01:00.000Z',
    updated_at: '2026-08-17T12:01:00.000Z',
    total_cost_all_time: 0,
    total_tokens_all_time: 0,
    total_sessions_all_time: 0,
    total_messages: 0,
    total_turns: 0,
    ...overrides,
  };
}
function makeSpiritReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    userId: 'user-a',
    circleId: 'circle-a',
    officeAgentId: spiritOfficeAgentId,
    sessionKey: spiritOfficeAgentId,
    spiritId: 'builder',
    spiritEmoji: 'tool',
    customProfileId: null,
    customProfileName: null,
    officeRowCount: 1,
    identityRowCount: 1,
    officeAgent: {
      id: spiritOfficeAgentId,
      circle_id: 'circle-a',
      owner_id: 'user-a',
      is_published: true,
      spirit: 'builder',
      spirit_emoji: 'tool',
      updated_at: '2026-08-17T12:01:00.000Z',
    },
    identity: makeSpiritIdentityRow(),
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('Exact cache namespace');
  const scopeA = { userId: ' user-a ', circleId: ' circle-a ', accessToken: ' token-a ' };
  const scopeB = { userId: 'user-b', circleId: 'circle-a', accessToken: 'token-b' };
  const circleB = { userId: 'user-a', circleId: 'circle-b', accessToken: 'token-a' };
  const keyA = exact.agentIdentityExactStorageKey(scopeA);
  assert(keyA === '@agent_identity_store_v2:user:user-a:circle:circle-a', 'user and circle produce one normalized exact key');
  assert(exact.agentIdentityExactStorageKey(scopeB) !== keyA, 'another owner cannot alias the cache key');
  assert(exact.agentIdentityExactStorageKey(circleB) !== keyA, 'another circle cannot alias the cache key');
  assert(
    exact.agentIdentityExactStorageKey({ userId: 'user-a', accessToken: 'token-a' })
      === '@agent_identity_store_v2:user:user-a:account',
    'an intentionally account-wide scope has an explicit namespace',
  );
  assert(
    exact.agentIdentityExactStorageKey({ userId: 'user-a', circleId: 'account', accessToken: 'token-a' })
      !== exact.agentIdentityExactStorageKey({ userId: 'user-a', accessToken: 'token-a' }),
    'a circle name cannot collide with the account-wide namespace',
  );
  assert(keyA !== '@agent_identity_store', 'exact storage never aliases the ownerless legacy key');
  assert(!keyA?.includes('token-a'), 'bearer material is never embedded in a cache key');
  assert(exact.agentIdentityExactStorageKey({ userId: '', circleId: 'circle-a', accessToken: 'token-a' }) === null, 'empty owner fails closed');
  assert(exact.agentIdentityExactStorageKey({ userId: 'user-a', circleId: '', accessToken: 'token-a' }) === null, 'an explicitly empty circle fails closed');
  assert(exact.agentIdentityExactStorageKey({ userId: 'user-a', circleId: 'circle-a', accessToken: '' }) === null, 'empty bearer fails closed');
  assert(
    exact.agentIdentityExactStorageKey({ userId: 'user-a', accessToken: 'x'.repeat(16_385) }) === null,
    'oversized bearer fails closed',
  );

  console.log('First-device cache truth');
  assert(exact.parseExactAgentIdentityCache(null)?.size === 0, 'a missing first-device cache is a verified empty Map');
  assert(exact.parseExactAgentIdentityCache('') === null, 'present empty cache bytes are malformed, not verified empty');
  assert(exact.parseExactAgentIdentityCache('{broken') === null, 'malformed cache bytes fail closed');
  const validCachedIdentity = {
    sessionKey: 'agent-a',
    totalCostAllTime: 0.25,
    totalTokensAllTime: 10,
    totalSessionsAllTime: 1,
    firstSeen: 1_700_000_000_000,
    lastSeen: 1_700_000_001_000,
    totalMessages: 2,
    totalTurns: 3,
  };
  assert(
    exact.parseExactAgentIdentityCache(JSON.stringify({ 'agent-a': validCachedIdentity }))?.size === 1,
    'finite cost plus safe integer counters form one valid exact cache row',
  );
  assert(
    exact.parseExactAgentIdentityCache(JSON.stringify({
      'agent-a': { ...validCachedIdentity, totalMessages: 1.5 },
    })) === null,
    'fractional integer counters cannot enter the exact cache',
  );
  assert(
    exact.parseExactAgentIdentityCache(JSON.stringify({
      'agent-a': { ...validCachedIdentity, totalTokensAllTime: Number.MAX_SAFE_INTEGER + 1 },
    })) === null,
    'unsafe integer totals cannot lose precision in the exact cache',
  );
  assert(!exact.isAgentIdentityServerNonNegativeSafeInteger(' 10'), 'whitespace-padded server counters fail closed');
  assert(!exact.isAgentIdentityServerNonNegativeSafeInteger('1.5'), 'fractional server integer counters fail closed');
  assert(
    exactWriteMode(new Map([['agent-a', '2026-08-17T12:00:00.000Z']]), 'agent-a') === 'update',
    'a first-device cache with an existing server row takes the narrow CAS update path',
  );
  assert(
    exactWriteMode(new Map(), 'agent-new') === 'insert',
    'a first-device cache with no server row takes the exact insert path',
  );

  console.log('Captured bearer verification');
  assert(
    verifySource.includes('safeGetUserForAccessToken(authority.accessToken)')
      && !verifySource.includes('supabase.auth.getUser'),
    'captured bearer verification uses the bounded explicit-token auth helper',
  );
  authCalls.length = 0;
  const verifiedA = await exact.verifyAgentIdentityExactAuthority(scopeA);
  assert(verifiedA?.userId === 'user-a' && verifiedA.circleId === 'circle-a', 'matching bearer verifies the captured scope');
  assert(authCalls.length === 1 && authCalls[0] === 'token-a', 'verification checks exactly the captured bearer');
  const mismatch = await exact.verifyAgentIdentityExactAuthority({ userId: 'user-a', circleId: 'circle-a', accessToken: 'token-b' });
  assert(mismatch === null, 'a bearer belonging to another owner fails closed');

  authCalls.length = 0;
  verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve; });
  mutableGlobalUser = 'user-a';
  const inFlight = exact.verifyAgentIdentityExactAuthority(scopeA);
  mutableGlobalUser = 'user-b';
  releaseVerification?.();
  const afterGlobalChange = await inFlight;
  verificationGate = null;
  assert(afterGlobalChange?.userId === 'user-a', 'a late global-session change cannot retarget captured authority');
  assert(authCalls.length === 1 && authCalls[0] === 'token-a', 'in-flight verification still uses only the original bearer');

  console.log('Exact local and server source boundaries');
  const exactLoad = section(
    'export async function loadAgentIdentitiesExact',
    '/**\n * Fetch the durable owner-global identities',
  );
  assert(exactLoad.includes('verifyAgentIdentityExactAuthority(capturedAuthority, fence)'), 'fenced local read verifies exact authority first');
  assert(exactLoad.includes('agentIdentityExactStorageKey(authority)'), 'local read derives only the exact scoped key');
  assert(!exactLoad.includes('STORAGE_KEY_AGENT_IDENTITY)'), 'local read never reaches the ownerless legacy key');

  const exactSync = section(
    'async function fetchAgentIdentitiesServerSnapshotExact',
    'export async function syncAgentIdentitiesFromServerExact',
  );
  assert(exactSync.includes(".eq('user_id', authority.userId)"), 'server read filters the captured owner');
  assert(
    exactSync.includes('getSupabaseClientForAccessToken(authority.accessToken)')
      && exactSync.includes('let query = exactClient')
      && !exactSync.includes('.setHeader(')
      && !exactSync.includes('supabase.from'),
    'server read uses the pinned captured-bearer client without mutable-session header merging',
  );
  assert(exactSync.includes('row?.user_id !== authority.userId'), 'foreign-owner response rows fail the whole read');
  assert(exactSync.includes(".select('*', { count: 'exact' })"), 'server read proves full-snapshot completeness');
  assert(exactSync.includes('.abortSignal(signal)'), 'publication server read accepts a bounded abort signal');
  assert(!exactSync.includes('auth.getSession'), 'server read never obtains replacement global auth');
  const exactSyncEntry = section(
    'export async function syncAgentIdentitiesFromServerExact',
    '/**\n * Seed-up:',
  );
  assert(exactSyncEntry.includes('signal?.aborted'), 'exact sync fails closed when its route deadline aborts');
  assert(exactSyncEntry.includes('verifyAgentIdentityExactAuthority(syntacticAuthority, fence)'), 'exact sync carries the current lifecycle fence through bearer verification');
  assert(exactSyncEntry.includes("error: 'authority_retired'"), 'an authority retired during a bounded sync cannot publish or reach the caller as current truth');

  const rowWriters = section(
    'function identityToRow',
    '// Session-level kill switch.',
  );
  assert(!rowWriters.includes('is_primary:'), 'ordinary identity row serialization never authors primary authority');
  assert(rowWriters.includes('bound_ai_provider: identity.boundAiProvider ?? null'), 'exact targeted rows can carry non-primary provider metadata');
  assert(rowWriters.includes('function identityToCompatibilityRow'), 'compatibility writers have a dedicated reduced row shape');
  assert(rowWriters.includes('const { bound_ai_provider: _boundAiProvider, ...row }'), 'full-row compatibility saves strip provider authority');
  const legacySeed = section('export async function seedIdentitiesIfServerEmpty', 'export async function saveAgentIdentities');
  assert(legacySeed.includes('identityToCompatibilityRow(user.id, id)'), 'first-device compatibility seeding strips provider and primary authority');
  const ambientPersist = section('async function persistIdentitiesToServer(', 'type AgentIdentityExactMutationLoadResult');
  assert(ambientPersist.includes('identityToCompatibilityRow(user.id, id)'), 'ambient full-row persistence strips provider and primary authority');
  const exactUpdate = section('export async function updateAgentIdentityExact(', '// ─── Record Agent Activity');
  assert(exactUpdate.includes("hasOwnProperty.call(updates, 'isPrimary')"), 'generic exact updates cannot bypass the primary RPC');
  const privateGuardStart = spiritAssignmentSql.indexOf(
    'CREATE OR REPLACE FUNCTION public.guard_published_agent_identity_spirit_columns_v1()',
  );
  const privateGuardEnd = spiritAssignmentSql.indexOf(
    'DROP TRIGGER IF EXISTS circle_office_agent_spirit_columns_guard',
    privateGuardStart,
  );
  assert(privateGuardStart >= 0 && privateGuardEnd > privateGuardStart, '§48 private Spirit guard source is bounded');
  const privateSpiritGuard = spiritAssignmentSql.slice(privateGuardStart, privateGuardEnd);
  assert(
    privateSpiritGuard.includes('profile.user_id = NEW.user_id')
      && privateSpiritGuard.includes('FOR KEY SHARE;'),
    'generic exact private custom assignments lock one exact same-owner profile against deletion',
  );
  assert(
    privateSpiritGuard.includes("NEW.spirit_id IS DISTINCT FROM\n       'custom::' || v_custom_profile_uuid::text")
      && privateSpiritGuard.includes('NEW.custom_profile_name IS DISTINCT FROM v_expected_profile_name')
      && privateSpiritGuard.includes('NEW.spirit_emoji IS DISTINCT FROM v_expected_profile_emoji'),
    'generic exact private custom assignments require coherent id, name, and emoji projections',
  );
  const legacyPrimary = section('export async function setMainAgentForProvider(', 'export async function setMainAgentForProviderExact');
  assert(legacyPrimary.includes('setMainAgentForProviderExact requires captured Office authority'), 'ownerless primary selection is retired fail closed');

  const exactMutationBase = section(
    'async function loadAgentIdentityMutationBaseExact',
    'type AgentIdentityRow = ReturnType<typeof identityToRow>;',
  );
  assert(
    exactMutationBase.includes('const exactClient = getSupabaseClientForAccessToken(authority.accessToken);')
      && exactMutationBase.includes('let query = exactClient')
      && !exactMutationBase.includes('.setHeader(')
      && !/\bsupabase\s*\./u.test(exactMutationBase),
    'mutation-base reads use only a captured-token client after bounded authority verification',
  );
  assert(
    exactMutationBase.indexOf('verifyAgentIdentityExactAuthority(syntacticAuthority, fence)')
      < exactMutationBase.indexOf('getSupabaseClientForAccessToken(authority.accessToken)'),
    'mutation-base bearer verification precedes creation of its exact database client',
  );

  const exactPersist = section(
    'async function persistIdentitiesToServerExact',
    '/**\n * Persist an exact scope synchronously',
  );
  assert(exactPersist.includes('identityToRow(authority.userId, identity)'), 'server rows are stamped with the captured owner');
  assert(
    exactPersist.includes('const exactClient = getSupabaseClientForAccessToken(authority.accessToken);')
      && (exactPersist.match(/await exactClient/g)?.length || 0) >= 3
      && !exactPersist.includes('.setHeader(')
      && !/\bsupabase\s*\./u.test(exactPersist),
    'CAS update, first-device insert, and batch paths all use one captured-token client without header mutation',
  );
  assert(exactPersist.includes(".eq('updated_at', serverVersion)"), 'existing rows use the just-read server version as a CAS fence');
  assert(exactPersist.includes('.update(patch)') && exactPersist.includes('.insert(row)'), 'first-device server rows update narrowly while truly new rows insert exactly once');
  assert(exactPersist.includes(".select('*')"), 'every durable mutation requests a returned server receipt');
  assert(exactPersist.includes('validateIdentityServerReceipts('), 'durable success requires validated returned rows');
  assert(!exactPersist.includes('auth.getUser'), 'server persistence cannot swap authority after verification');
  assert(!exactPersist.includes('auth.getSession'), 'server persistence never reads mutable global session state');

  const exactSave = section(
    'export async function saveAgentIdentitiesExact',
    '// ─── Update Agent Identity',
  );
  assert(exactSave.includes('loadAgentIdentityMutationBaseExact(authority, fence, null)'), 'batch saves read exact server versions before mutation');
  assert(exactSave.includes('mutationBase.serverVersions'), 'batch saves preserve optimistic concurrency versions');
  assert(exactSave.includes('saveAgentIdentityMapExact('), 'batch saves delegate to the server-first receipt path');
  assert(!exactSave.includes('void persistIdentitiesToServer'), 'exact save returns a truthful awaited server receipt');

  const exactMapSave = section(
    'async function saveAgentIdentityMapExact',
    '/**\n * Persist an exact scope synchronously',
  );
  const serverWriteAt = exactMapSave.indexOf('await persistIdentitiesToServerExact(');
  const localWriteAt = exactMapSave.indexOf('publishCurrentAgentIdentityServerTruthExact(authority, fence)');
  assert(serverWriteAt >= 0 && localWriteAt > serverWriteAt, 'server receipt precedes cross-realm server-truth cache publication');
  assert(
    !exactMapSave.includes('verifyAgentIdentityExactAuthority('),
    'the private map saver reuses the mutation base verification instead of repeating an auth round trip',
  );
  assert(
    exactMapSave.includes('verifiedAuthority: VerifiedAgentIdentityExactWriteAuthority'),
    'the private map saver accepts only the module-branded verified authority type',
  );
  assert(
    exactMapSave.includes('loadAgentIdentityMutationBaseExact has verified the captured bearer'),
    'the no-repeat-auth invariant stays explicit at the private helper boundary',
  );
  assert((exactMapSave.match(/isAgentIdentityExactAuthorityCurrent\(/g) || []).length >= 2, 'the live generation fence surrounds the durable mutation phase');

  const exactPrimary = section(
    'export async function setMainAgentForProviderExact',
    '// ─── Customize Agent Appearance',
  );
  assert(exactPrimary.includes(".rpc('set_main_agent_for_provider_v1'"), 'primary-agent update uses the one transactional server writer');
  assert(
    exactPrimary.includes('const exactClient = getSupabaseClientForAccessToken(verifiedAuthority.accessToken);')
      && exactPrimary.includes('const response = await exactClient')
      && !exactPrimary.includes('.setHeader(')
      && !/\bsupabase\s*\./u.test(exactPrimary),
    'primary-agent RPC uses only the verified captured-token client',
  );
  assert(exactPrimary.includes('parseAgentIdentityPrimaryRpcReceipt('), 'primary-agent success requires the versioned exact RPC receipt');
  assert(exactPrimary.includes('publishCurrentAgentIdentityServerTruthExact('), 'validated primary receipt publishes only a fresh cross-realm server snapshot');
  assert((exactPrimary.match(/isAgentIdentityExactAuthorityCurrent\(/g) || []).length >= 6, 'primary-agent generation is fenced before and after every awaited phase');
  assert(
    !exactPrimary.includes(".from('agent_identities')")
      && !exactPrimary.includes('loadAgentIdentityMutationBaseExact(')
      && !exactPrimary.includes('saveAgentIdentityMapExact(')
      && !exactPrimary.includes('.update(')
      && !exactPrimary.includes('.upsert('),
    'primary-agent update has no residual multi-request client writer',
  );

  const exactPublishedSpirit = section(
    'export async function updatePublishedAgentSpiritExact',
    '/** Delete one owner profile only after the server proves it is unreferenced. */',
  );
  const exactProfileDelete = section(
    'export async function deleteUnreferencedCustomAgentProfileExact',
    '// ─── Record Agent Activity',
  );
  for (const [label, exactRpc] of [
    ['published-Spirit assignment', exactPublishedSpirit],
    ['custom-profile deletion', exactProfileDelete],
  ] as const) {
    assert(
      exactRpc.includes('const exactClient = getSupabaseClientForAccessToken(verifiedAuthority.accessToken);')
        && exactRpc.includes('const response = await exactClient')
        && !exactRpc.includes('.setHeader(')
        && !/\bsupabase\s*\./u.test(exactRpc),
      `${label} RPC uses only the verified captured-token client`,
    );
  }

  console.log('Transactional primary-agent receipt validation');
  const validPrimaryReceipt = makePrimaryReceipt();
  assert(
    parsePrimaryReceipt(validPrimaryReceipt, { userId: 'user-a' }, 'agent-a', 'openswan')
      ?.providerIdentities.get('agent-a') !== undefined,
    'one exact owner/provider/session primary receipt is accepted',
  );
  assert(
    parsePrimaryReceipt(
      makePrimaryReceipt({ userId: 'user-b' }),
      { userId: 'user-a' },
      'agent-a',
      'openswan',
    ) === null,
    'a foreign-owner receipt fails closed',
  );
  assert(
    parsePrimaryReceipt(
      makePrimaryReceipt({ rows: [makePrimaryRow(), makePrimaryRow({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        session_key: 'agent-b',
      })], rowCount: 2 }),
      { userId: 'user-a' },
      'agent-a',
      'openswan',
    ) === null,
    'a two-primary receipt fails closed',
  );
  assert(
    parsePrimaryReceipt(
      makePrimaryReceipt({ primaryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      { userId: 'user-a' },
      'agent-a',
      'openswan',
    ) === null,
    'a mismatched primary-row id fails closed',
  );
  assert(
    parsePrimaryReceipt(
      { ...makePrimaryReceipt(), unexpected: true },
      { userId: 'user-a' },
      'agent-a',
      'openswan',
    ) === null,
    'an unversioned receipt shape extension fails closed',
  );

  console.log('Transactional published-Spirit and profile-delete receipt validation');
  const spiritInput = {
    officeAgentId: spiritOfficeAgentId,
    sessionKey: spiritOfficeAgentId,
    spiritId: 'builder',
    spiritEmoji: 'tool',
    customProfileId: null,
  };
  assert(
    spiritReceipts.parsePublishedAgentSpiritRpcReceipt(
      makeSpiritReceipt(),
      { userId: 'user-a', circleId: 'circle-a' },
      spiritInput,
    )?.identity.sessionKey === spiritOfficeAgentId,
    'one exact public/private Spirit receipt is accepted',
  );
  assert(
    spiritReceipts.parsePublishedAgentSpiritRpcReceipt(
      makeSpiritReceipt({ officeAgent: { ...(makeSpiritReceipt().officeAgent as Record<string, unknown>), owner_id: 'user-b' } }),
      { userId: 'user-a', circleId: 'circle-a' },
      spiritInput,
    ) === null,
    'a foreign-owner public Spirit row fails closed',
  );
  assert(
    spiritReceipts.parsePublishedAgentSpiritRpcReceipt(
      makeSpiritReceipt({ identity: makeSpiritIdentityRow({ spirit_id: 'mismatch' }) }),
      { userId: 'user-a', circleId: 'circle-a' },
      spiritInput,
    ) === null,
    'a split private Spirit row fails closed',
  );
  assert(
    spiritReceipts.parsePublishedAgentSpiritRpcReceipt(
      makeSpiritReceipt({ identityRowCount: 0 }),
      { userId: 'user-a', circleId: 'circle-a' },
      spiritInput,
    ) === null,
    'a zero-row private receipt fails closed',
  );
  const validDeleteReceipt = {
    schemaVersion: 1,
    userId: 'user-a',
    profileId: spiritProfileId,
    deletedRowCount: 1,
    profile: { id: spiritProfileId, user_id: 'user-a', name: 'Builder' },
  };
  assert(
    spiritReceipts.parseCustomProfileDeleteRpcReceipt(
      validDeleteReceipt,
      { userId: 'user-a' },
      spiritProfileId,
    ),
    'one exact owner profile-delete receipt is accepted',
  );
  assert(
    !spiritReceipts.parseCustomProfileDeleteRpcReceipt(
      { ...validDeleteReceipt, deletedRowCount: 0 },
      { userId: 'user-a' },
      spiritProfileId,
    ),
    'a zero-row profile-delete receipt fails closed',
  );
  assert(
    !spiritReceipts.parseCustomProfileDeleteRpcReceipt(
      { ...validDeleteReceipt, profile: { id: spiritProfileId, user_id: 'user-b' } },
      { userId: 'user-a' },
      spiritProfileId,
    ),
    'a foreign-owner profile-delete receipt fails closed',
  );
  assert(
    !spiritReceipts.parseCustomProfileDeleteRpcReceipt(
      { ...validDeleteReceipt, unexpected: true },
      { userId: 'user-a' },
      spiritProfileId,
    ),
    'an extended profile-delete receipt shape fails closed',
  );

  let malformedCache = true;
  let spiritReceiptValid = true;
  let concurrentSpiritRpcMode = false;
  let concurrentSpiritRpcCalls = 0;
  let markFirstSpiritRpcStarted: (() => void) | null = null;
  let releaseFirstSpiritRpc: (() => void) | null = null;
  let firstSpiritRpcStarted = Promise.resolve();
  let firstSpiritRpcGate = Promise.resolve();
  let recoveryCalls = 0;
  let spiritPublicationCalls = 0;
  let publishedCacheSize = 0;
  const spiritExactClientTokens: string[] = [];
  let spiritSharedRpcCalls = 0;
  let spiritPublishResult: Record<string, unknown> = {
    ok: true,
    localSaved: true,
    serverSaved: true,
  };
  const spiritWriterSandbox: Record<string, unknown> = {
    _identitiesPersistDisabled: false,
    normalizeAgentIdentityExactWriteAuthority: (value: unknown) => value,
    normalizeAgentIdentityScopePart: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null,
    isAgentIdentityUuidLike: (value: unknown) => typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value),
    isAgentIdentityExactAuthorityCurrent: (_authority: unknown, fence: (authority: unknown) => boolean) => fence(_authority),
    verifyAgentIdentityExactAuthority: async (value: unknown) => value,
    shouldDisableIdentityPersistence: () => false,
    disableIdentityPersistenceForSession: () => undefined,
    parsePublishedAgentSpiritRpcReceipt: () => spiritReceiptValid ? ({
      identity: { sessionKey: spiritOfficeAgentId },
    }) : null,
    agentIdentityExactStorageKey: () => 'exact-key',
    parseExactAgentIdentityCache: () => malformedCache ? null : new Map(),
    syncAgentIdentitiesFromServerExact: async () => {
      recoveryCalls += 1;
      return { ok: true, identities: new Map([['other-agent', { sessionKey: 'other-agent' }]]) };
    },
    publishVerifiedAgentIdentityCacheExact: async (identities: Map<string, unknown>) => {
      spiritPublicationCalls += 1;
      publishedCacheSize = identities.size;
      return spiritPublishResult;
    },
    publishCurrentAgentIdentityServerTruthExact: async () => {
      recoveryCalls += 1;
      spiritPublicationCalls += 1;
      publishedCacheSize = 2;
      return spiritPublishResult;
    },
    storage: { getItem: async () => malformedCache ? '{broken' : null },
    getSupabaseClientForAccessToken: (token: string) => {
      spiritExactClientTokens.push(token);
      return {
        rpc: async () => {
          if (concurrentSpiritRpcMode) {
            concurrentSpiritRpcCalls += 1;
            if (concurrentSpiritRpcCalls === 1) {
              markFirstSpiritRpcStarted?.();
              await firstSpiritRpcGate;
            }
          }
          return { data: makeSpiritReceipt(), error: null };
        },
      };
    },
    supabase: {
      rpc: () => {
        spiritSharedRpcCalls += 1;
        throw new Error('exact Spirit writer touched the shared client');
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      `${commandEpochSource}\n${exactSpiritFunctionSource}\n;(globalThis as any).__setSpirit = updatePublishedAgentSpiritExact;`,
      { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    spiritWriterSandbox,
  );
  const runExactSpirit = spiritWriterSandbox.__setSpirit as (
    input: Record<string, unknown>,
    authority: Record<string, unknown>,
    fence: () => boolean,
  ) => Promise<Record<string, unknown>>;
  const exactSpiritInput = {
    officeAgentId: spiritOfficeAgentId,
    sessionKey: spiritOfficeAgentId,
    spiritId: 'builder',
    spiritEmoji: 'tool',
    customProfileId: null,
  };
  const recoveredSpirit = await runExactSpirit(
    exactSpiritInput,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => true,
  );
  assert(recoveredSpirit.ok === true && recoveryCalls === 1, 'a valid Spirit receipt refreshes the exact cache from captured server truth');
  assert(
    spiritExactClientTokens.length === 1
      && spiritExactClientTokens[0] === 'token-a'
      && spiritSharedRpcCalls === 0,
    'Spirit assignment dispatches through only the captured-token client',
  );
  assert(publishedCacheSize === 2, 'Spirit cache publication uses the complete verified server snapshot');
  malformedCache = false;
  spiritPublishResult = { ok: false, localSaved: false, serverSaved: true, error: 'local_write_failed' };
  const partialSpirit = await runExactSpirit(
    exactSpiritInput,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => true,
  );
  assert(
    partialSpirit.ok === false
      && partialSpirit.serverSaved === true
      && partialSpirit.localSaved === false
      && partialSpirit.error === 'local_write_failed',
    'a durable Spirit receipt plus local cache failure remains an explicit server-saved partial outcome',
  );
  const readsBeforeUnknownSpirit = recoveryCalls;
  const publicationsBeforeUnknownSpirit = spiritPublicationCalls;
  spiritReceiptValid = false;
  const unknownSpirit = await runExactSpirit(
    exactSpiritInput,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => true,
  );
  assert(
    unknownSpirit.ok === false
      && unknownSpirit.serverSaved === null
      && unknownSpirit.localSaved === false
      && unknownSpirit.error === 'outcome_unknown',
    'a 2xx Spirit response with an unverifiable receipt reports outcome_unknown instead of false failure',
  );
  assert(
    recoveryCalls === readsBeforeUnknownSpirit && spiritPublicationCalls === publicationsBeforeUnknownSpirit,
    'an unknown Spirit outcome cannot read or publish speculative local state',
  );
  spiritReceiptValid = true;
  spiritPublishResult = { ok: true, localSaved: true, serverSaved: true };
  concurrentSpiritRpcMode = true;
  concurrentSpiritRpcCalls = 0;
  firstSpiritRpcStarted = new Promise<void>(resolve => { markFirstSpiritRpcStarted = resolve; });
  firstSpiritRpcGate = new Promise<void>(resolve => { releaseFirstSpiritRpc = resolve; });
  const publicationsBeforeConcurrentSpirit = spiritPublicationCalls;
  const olderSpiritPromise = runExactSpirit(
    exactSpiritInput,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => true,
  );
  await firstSpiritRpcStarted;
  const newerSpirit = await runExactSpirit(
    exactSpiritInput,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => true,
  );
  releaseFirstSpiritRpc?.();
  const olderSpirit = await olderSpiritPromise;
  concurrentSpiritRpcMode = false;
  assert(
    newerSpirit.ok === true
      && olderSpirit.ok === false
      && olderSpirit.serverSaved === true
      && olderSpirit.error === 'mutation_superseded',
    'a newer same-agent Spirit command supersedes an older late server completion without false durable failure',
  );
  assert(
    spiritPublicationCalls === publicationsBeforeConcurrentSpirit + 1,
    'only the newest same-agent Spirit completion publishes the in-process exact cache',
  );

  let profileDeleteReceiptValid = false;
  let profileDeleteFenceCurrent = true;
  let retireOnProfileDelete = false;
  let concurrentProfileDeleteMode = false;
  let concurrentProfileDeleteCalls = 0;
  let markFirstProfileDeleteStarted: (() => void) | null = null;
  let releaseFirstProfileDelete: (() => void) | null = null;
  let firstProfileDeleteStarted = Promise.resolve();
  let firstProfileDeleteGate = Promise.resolve();
  const profileDeleteExactClientTokens: string[] = [];
  let profileDeleteSharedRpcCalls = 0;
  const profileDeleteSandbox: Record<string, unknown> = {
    normalizeAgentIdentityExactWriteAuthority: (value: unknown) => value,
    isAgentIdentityUuidLike: (value: unknown) => typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value),
    isAgentIdentityExactAuthorityCurrent: (_authority: unknown, authorityFence: (authority: unknown) => boolean) =>
      authorityFence(_authority),
    verifyAgentIdentityExactAuthority: async (value: unknown) => value,
    parseCustomProfileDeleteRpcReceipt: () => profileDeleteReceiptValid,
    getSupabaseClientForAccessToken: (token: string) => {
      profileDeleteExactClientTokens.push(token);
      return {
        rpc: async () => {
          if (concurrentProfileDeleteMode) {
            concurrentProfileDeleteCalls += 1;
            if (concurrentProfileDeleteCalls === 1) {
              markFirstProfileDeleteStarted?.();
              await firstProfileDeleteGate;
            }
          }
          if (retireOnProfileDelete) profileDeleteFenceCurrent = false;
          return { data: validDeleteReceipt, error: null };
        },
      };
    },
    supabase: {
      rpc: () => {
        profileDeleteSharedRpcCalls += 1;
        throw new Error('exact profile deletion touched the shared client');
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      `${commandEpochSource}\n${exactProfileDeleteFunctionSource}\n;(globalThis as any).__deleteProfile = deleteUnreferencedCustomAgentProfileExact;`,
      { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    profileDeleteSandbox,
  );
  const runUnknownProfileDelete = profileDeleteSandbox.__deleteProfile as (
    profileId: string,
    authority: unknown,
    fence: (authority: unknown) => boolean,
  ) => Promise<Record<string, unknown>>;
  const unknownDelete = await runUnknownProfileDelete(
    spiritProfileId,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => profileDeleteFenceCurrent,
  );
  assert(
    unknownDelete.ok === false
      && unknownDelete.serverDeleted === null
      && unknownDelete.error === 'outcome_unknown',
    'a 2xx profile-delete response with an unverifiable receipt reports outcome_unknown instead of false deletion',
  );
  assert(
    profileDeleteExactClientTokens.length === 1
      && profileDeleteExactClientTokens[0] === 'token-a'
      && profileDeleteSharedRpcCalls === 0,
    'profile deletion dispatches through only the captured-token client',
  );
  profileDeleteReceiptValid = true;
  concurrentProfileDeleteMode = true;
  concurrentProfileDeleteCalls = 0;
  firstProfileDeleteStarted = new Promise<void>(resolve => { markFirstProfileDeleteStarted = resolve; });
  firstProfileDeleteGate = new Promise<void>(resolve => { releaseFirstProfileDelete = resolve; });
  const olderDeletePromise = runUnknownProfileDelete(
    spiritProfileId,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => profileDeleteFenceCurrent,
  );
  await firstProfileDeleteStarted;
  const newerDelete = await runUnknownProfileDelete(
    spiritProfileId,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => profileDeleteFenceCurrent,
  );
  releaseFirstProfileDelete?.();
  const olderDelete = await olderDeletePromise;
  concurrentProfileDeleteMode = false;
  assert(
    newerDelete.ok === true
      && olderDelete.ok === false
      && olderDelete.serverDeleted === true
      && olderDelete.error === 'mutation_superseded',
    'a newer exact profile-delete command supersedes an older late receipt in this JS realm',
  );
  retireOnProfileDelete = true;
  const retiredDelete = await runUnknownProfileDelete(
    spiritProfileId,
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 8 },
    () => profileDeleteFenceCurrent,
  );
  assert(
    retiredDelete.ok === false
      && retiredDelete.serverDeleted === true
      && retiredDelete.error === 'authority_retired',
    'a profile deletion retired after one exact receipt preserves durable deletion truth without stale local success',
  );

  let staleFenceCurrent = true;
  let retireOnPrimaryRpc = false;
  let primaryReceiptValid = false;
  let concurrentPrimaryRpcMode = false;
  let concurrentPrimaryRpcCalls = 0;
  let markFirstPrimaryRpcStarted: (() => void) | null = null;
  let releaseFirstPrimaryRpc: (() => void) | null = null;
  let firstPrimaryRpcStarted = Promise.resolve();
  let firstPrimaryRpcGate = Promise.resolve();
  const primaryExactClientTokens: string[] = [];
  let primarySharedRpcCalls = 0;
  let staleLocalReads = 0;
  let stalePublications = 0;
  const stalePrimarySandbox: Record<string, unknown> = {
    _identitiesPersistDisabled: false,
    normalizeAgentIdentityScopePart: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null,
    normalizeAgentIdentityExactWriteAuthority: (value: unknown) => value,
    isAgentIdentityExactAuthorityCurrent: (_authority: unknown, authorityFence: (authority: unknown) => boolean) =>
      authorityFence(_authority),
    verifyAgentIdentityExactAuthority: async (value: unknown) => value,
    shouldDisableIdentityPersistence: () => false,
    disableIdentityPersistenceForSession: () => undefined,
    parseAgentIdentityPrimaryRpcReceipt: () => primaryReceiptValid
      ? ({ providerIdentities: new Map() })
      : null,
    agentIdentityExactStorageKey: () => 'exact-key',
    parseExactAgentIdentityCache: () => new Map(),
    publishVerifiedAgentIdentityCacheExact: async () => {
      stalePublications += 1;
      return { ok: true, localSaved: true, serverSaved: true };
    },
    publishCurrentAgentIdentityServerTruthExact: async () => {
      stalePublications += 1;
      return { ok: true, localSaved: true, serverSaved: true };
    },
    storage: {
      getItem: async () => {
        staleLocalReads += 1;
        return null;
      },
    },
    getSupabaseClientForAccessToken: (token: string) => {
      primaryExactClientTokens.push(token);
      return {
        rpc: async () => {
          if (concurrentPrimaryRpcMode) {
            concurrentPrimaryRpcCalls += 1;
            if (concurrentPrimaryRpcCalls === 1) {
              markFirstPrimaryRpcStarted?.();
              await firstPrimaryRpcGate;
            }
          }
          if (retireOnPrimaryRpc) staleFenceCurrent = false;
          return { data: makePrimaryReceipt(), error: null };
        },
      };
    },
    supabase: {
      rpc: () => {
        primarySharedRpcCalls += 1;
        throw new Error('exact primary mutation touched the shared client');
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      `${commandEpochSource}\n${exactPrimaryFunctionSource}\n;(globalThis as any).__setPrimary = setMainAgentForProviderExact;`,
      { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    stalePrimarySandbox,
  );
  const runStalePrimary = stalePrimarySandbox.__setPrimary as (
    sessionKey: string,
    providerType: string,
    authority: unknown,
    fence: (authority: unknown) => boolean,
  ) => Promise<Record<string, unknown>>;
  const unknownPrimary = await runStalePrimary(
    'agent-a',
    'openswan',
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 7 },
    () => staleFenceCurrent,
  );
  assert(
    unknownPrimary.ok === false
      && unknownPrimary.serverSaved === null
      && unknownPrimary.localSaved === false
      && unknownPrimary.error === 'outcome_unknown',
    'a 2xx primary response with an unverifiable receipt reports outcome_unknown instead of false failure',
  );
  assert(staleLocalReads === 0 && stalePublications === 0, 'an unknown primary outcome cannot publish speculative cache state');
  primaryReceiptValid = true;
  concurrentPrimaryRpcMode = true;
  concurrentPrimaryRpcCalls = 0;
  firstPrimaryRpcStarted = new Promise<void>(resolve => { markFirstPrimaryRpcStarted = resolve; });
  firstPrimaryRpcGate = new Promise<void>(resolve => { releaseFirstPrimaryRpc = resolve; });
  const olderPrimaryPromise = runStalePrimary(
    'agent-a',
    'openswan',
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 7 },
    () => staleFenceCurrent,
  );
  await firstPrimaryRpcStarted;
  const newerPrimary = await runStalePrimary(
    'agent-b',
    'openswan',
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 7 },
    () => staleFenceCurrent,
  );
  releaseFirstPrimaryRpc?.();
  const olderPrimary = await olderPrimaryPromise;
  concurrentPrimaryRpcMode = false;
  assert(
    newerPrimary.ok === true
      && olderPrimary.ok === false
      && olderPrimary.serverSaved === true
      && olderPrimary.error === 'mutation_superseded',
    'a newer provider-primary command supersedes an older late RPC completion',
  );
  assert(stalePublications === 1, 'only the newest provider-primary completion publishes the in-process exact cache');
  const readsBeforeRetiredPrimary = staleLocalReads;
  const publicationsBeforeRetiredPrimary = stalePublications;
  retireOnPrimaryRpc = true;
  const staleResult = await runStalePrimary(
    'agent-a',
    'openswan',
    { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 7 },
    () => staleFenceCurrent,
  );
  assert(
    primaryExactClientTokens.length === 4
      && primaryExactClientTokens.every(token => token === 'token-a')
      && primarySharedRpcCalls === 0,
    'every primary RPC, including a retiring request, dispatches only through the captured-token client',
  );
  assert(
    staleResult.ok === false
      && staleResult.error === 'authority_retired'
      && staleResult.serverSaved === true,
    'a generation retired after an exact server receipt reports stale authority without false local success',
  );
  assert(
    staleLocalReads === readsBeforeRetiredPrimary
      && stalePublications === publicationsBeforeRetiredPrimary,
    'retired authority cannot read or publish the current cache lane',
  );

  console.log(`\nPASS: ${assertions} agent-identity exact-authority assertions`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
