/**
 * Adversarial smoke for Office invocation account-switch retirement.
 *
 * Runs the pure exact-authority helpers and claimant wrapper in a VM, then
 * pins bearer-bound RPCs, provider I/O fences, abort propagation, and fan-out
 * propagation in the production source.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/agentInvocation.ts', 'utf8');

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

const authorityCore = section(
  'const OFFICE_INVOCATION_AUTHORITY_RETIRED',
  '// ─── DB: Create response row (atomic)',
);
const claimSource = section(
  'export async function invokeAgent(',
  '// ─── DB: Stream response updates',
);
const budgetConfigCore = section(
  'function normalizeInvocationBudgetConfig(',
  'function buildInvocationBudgetWindow(',
);
const budgetUsagePureCore = section(
  'function buildInvocationBudgetWindow(',
  'async function loadInvocationBudgetSpend(',
);
const budgetSpendCore = section(
  'async function loadInvocationBudgetSpend(',
  'function buildOfficeBudgetPreflightFailure(',
);

const runtimeSource = `
let verifiedUserId = '22222222-2222-4222-8222-222222222222';
let verifyHook = () => {};
let preferenceHook = () => {};
let preferenceResult = { ok: true, preferences: null, revision: 0 };
let legacyBudgetConfig = { enabled: false };
let usagePages = [];
let usagePageIndex = 0;
let usageHook = () => {};
function isUuidLike(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function safeGetUserForAccessToken(accessToken) {
  globalThis.__observed.verifiedBearer = accessToken;
  verifyHook();
  return { value: verifiedUserId ? { id: verifiedUserId } : null, error: null };
}
async function loadOfficeUserPreferences(circleId, authScope) {
  globalThis.__observed.preferenceCircleId = circleId;
  globalThis.__observed.preferenceScope = authScope;
  globalThis.__observed.preferenceCalls += 1;
  preferenceHook();
  return preferenceResult;
}
async function loadBudgetConfig() {
  globalThis.__observed.legacyBudgetCalls += 1;
  return legacyBudgetConfig;
}
function isBlackSwanAgent() { return false; }
function isInvokeAgentV2Unavailable() { return false; }
const supabase = {
  rpc(name, args) {
    globalThis.__observed.rpcName = name;
    globalThis.__observed.rpcArgs = args;
    const builder = {
      setHeader(headerName, value) {
        globalThis.__observed.headers[headerName] = value;
        return builder;
      },
      then(resolve, reject) {
        globalThis.__onClaimAwait();
        return Promise.resolve({ data: globalThis.__claimRow, error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
  from(table) {
    globalThis.__observed.usageTables.push(table);
    const builder = {
      select(columns, options) {
        globalThis.__observed.usageSelect = { columns, options };
        return builder;
      },
      eq(column, value) { globalThis.__observed.usageFilters.push(['eq', column, value]); return builder; },
      gte(column, value) { globalThis.__observed.usageFilters.push(['gte', column, value]); return builder; },
      lt(column, value) { globalThis.__observed.usageFilters.push(['lt', column, value]); return builder; },
      order(column, options) { globalThis.__observed.usageOrders.push([column, options]); return builder; },
      range(from, to) { globalThis.__observed.usageRanges.push([from, to]); return builder; },
      setHeader(name, value) { globalThis.__observed.usageHeaders.push([name, value]); return builder; },
      abortSignal(value) { globalThis.__observed.usageAbortSignals.push(value); return builder; },
      then(resolve, reject) {
        const page = usagePages[usagePageIndex] || { data: [], error: null, count: 0 };
        usagePageIndex += 1;
        usageHook(usagePageIndex);
        return Promise.resolve(page).then(resolve, reject);
      },
    };
    return builder;
  },
};
${authorityCore}
${claimSource}
${budgetConfigCore}
${budgetUsagePureCore}
${budgetSpendCore}
globalThis.__core = {
  normalizeOfficeInvocationExactAuthority,
  officeInvocationExecutionIsCurrent,
  resolveOfficeInvocationExactExecution,
  buildOfficeInvocationAuthorityUnavailableResult,
  buildOfficeInvocationRetiredAfterClaimResult,
  invokeAgent,
  normalizeInvocationBudgetConfig,
  readCanonicalOfficeBudgetConfig,
  loadInvocationBudgetConfig,
  buildInvocationBudgetWindow,
  accumulateInvocationBudgetUsagePage,
  loadInvocationBudgetSpend,
  bindExact(req, execution) { exactExecutionByInvocationRequest.set(req, execution); },
  setVerifiedUserId(value) { verifiedUserId = value; },
  setVerifyHook(value) { verifyHook = value; },
  setPreferenceHook(value) { preferenceHook = value; },
  setPreferenceResult(value) { preferenceResult = value; },
  setLegacyBudgetConfig(value) { legacyBudgetConfig = value; },
  setUsagePages(value) { usagePages = value; usagePageIndex = 0; },
  setUsageHook(value) { usageHook = value; },
};
`;

const compiled = ts.transpileModule(runtimeSource.replace(/\bexport\s+/g, ''), {
  compilerOptions: {
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const circleId = '11111111-1111-4111-8111-111111111111';
const userA = '22222222-2222-4222-8222-222222222222';
const userB = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';
const agentId = '55555555-5555-4555-8555-555555555555';
const responseId = '66666666-6666-4666-8666-666666666666';
const observed = {
  verifiedBearer: '',
  rpcName: '',
  rpcArgs: null as Record<string, unknown> | null,
  headers: {} as Record<string, string>,
  preferenceCircleId: '',
  preferenceScope: null as Record<string, unknown> | null,
  preferenceCalls: 0,
  legacyBudgetCalls: 0,
  usageTables: [] as string[],
  usageSelect: null as Record<string, unknown> | null,
  usageFilters: [] as unknown[][],
  usageOrders: [] as unknown[][],
  usageRanges: [] as number[][],
  usageHeaders: [] as string[][],
  usageAbortSignals: [] as AbortSignal[],
};
const sandbox: Record<string, any> = {
  __observed: observed,
  __onClaimAwait: () => {},
  __claimRow: {
    claim_disposition: 'claimed',
    response_id: responseId,
    canonical_message_id: messageId,
    canonical_circle_id: circleId,
    canonical_sender_id: userB,
    canonical_command_text: 'inspect the repo',
    canonical_agent_id: agentId,
    canonical_agent_subject_key: `office-agent:${agentId}`,
    canonical_agent_name: 'Claude Code',
    canonical_target_agent_id: agentId,
    canonical_target_agent_ids: null,
    canonical_target_agent_name: '@Claude Code',
    canonical_model: null,
  },
  AbortController,
  console,
};
vm.runInNewContext(compiled, sandbox);
const core = sandbox.__core as any;

async function main(): Promise<void> {
  console.log('Exact authority resolution');
  const authority = Object.freeze({
    userId: userA,
    circleId,
    accessToken: 'jwt-account-a',
    generation: 7,
  });
  let current = true;
  const execution = {
    authority,
    isCurrent: () => current,
    signal: new AbortController().signal,
  };
  const remoteSenderRequest = {
    messageId,
    circleId,
    command: 'inspect the repo',
    senderId: userB,
    targetAgentName: '@Claude Code',
  };

  const normalized = core.normalizeOfficeInvocationExactAuthority(authority);
  assert(normalized?.userId === userA && Object.isFrozen(normalized), 'valid authority normalizes immutably');
  assert(
    core.normalizeOfficeInvocationExactAuthority({ ...authority, accessToken: '' }) === null,
    'missing bearer fails closed',
  );
  assert(
    core.normalizeOfficeInvocationExactAuthority({ ...authority, generation: 0 }) === null,
    'retired generation fails closed',
  );
  const resolved = await core.resolveOfficeInvocationExactExecution(execution, remoteSenderRequest);
  assert(resolved?.authority.userId === userA, 'captured bearer subject resolves for the executor');
  assert(observed.verifiedBearer === authority.accessToken, 'resolution verifies the captured bearer');
  assert(
    await core.resolveOfficeInvocationExactExecution(
      execution,
      { ...remoteSenderRequest, circleId: '77777777-7777-4777-8777-777777777777' },
    ) === null,
    'cross-circle authority fails before a claim',
  );
  core.setVerifiedUserId(userB);
  assert(
    await core.resolveOfficeInvocationExactExecution(execution, remoteSenderRequest) === null,
    'bearer subject mismatch fails closed',
  );
  core.setVerifiedUserId(userA);
  current = true;
  core.setVerifyHook(() => { current = false; });
  assert(
    await core.resolveOfficeInvocationExactExecution(execution, remoteSenderRequest) === null,
    'retirement during bearer verification fails before claim',
  );
  core.setVerifyHook(() => {});
  current = true;
  const aborted = new AbortController();
  aborted.abort();
  assert(
    !core.officeInvocationExecutionIsCurrent({ ...execution, signal: aborted.signal }),
    'aborted execution is retired synchronously',
  );
  assert(
    !core.officeInvocationExecutionIsCurrent({ ...execution, isCurrent: () => { throw new Error('boom'); } }),
    'throwing current guard fails closed',
  );

  console.log('Exact budget preference authority');
  current = true;
  core.setPreferenceResult({
    ok: true,
    preferences: {
      budgetConfig: { enabled: true, hardLimit: true, daily: 2, weekly: 8, monthly: 20 },
    },
    revision: 4,
  });
  const exactBudget = await core.loadInvocationBudgetConfig(circleId, execution);
  assert(exactBudget.ok && exactBudget.config.daily === 2, 'exact canonical budget config is accepted');
  assert(observed.preferenceCircleId === circleId, 'budget preferences use the captured circle');
  assert(
    observed.preferenceScope?.userId === userA
      && observed.preferenceScope?.accessToken === authority.accessToken,
    'budget preferences use the captured user and bearer',
  );
  assert(observed.legacyBudgetCalls === 0, 'exact execution never reads device-local budget storage');
  core.setPreferenceHook(() => { current = false; });
  const retiredBudget = await core.loadInvocationBudgetConfig(circleId, execution);
  assert(!retiredBudget.ok && retiredBudget.reason === 'authority', 'retirement during preference load fails closed');
  core.setPreferenceHook(() => {});
  current = true;
  core.setPreferenceResult({ ok: false, preferences: null, revision: 0, error: 'offline' });
  const unavailableBudget = await core.loadInvocationBudgetConfig(circleId, execution);
  assert(!unavailableBudget.ok && unavailableBudget.reason === 'settings', 'unverifiable canonical settings fail closed');
  assert(
    core.readCanonicalOfficeBudgetConfig(null)?.enabled === false,
    'an absent canonical preference record means budgets are disabled',
  );
  assert(
    core.normalizeInvocationBudgetConfig({ enabled: true, hardLimit: true, daily: -1 }) === null,
    'invalid hard-limit amounts are rejected instead of disabling the cap',
  );
  core.setLegacyBudgetConfig({ enabled: true, hardLimit: false, daily: 5 });
  const legacyBudget = await core.loadInvocationBudgetConfig(circleId);
  assert(legacyBudget.ok && legacyBudget.config.daily === 5, 'legacy callers retain unscoped device-local config');
  assert(observed.legacyBudgetCalls === 1, 'legacy budget read does not invent account scope');

  console.log('Budget usage math');
  const budgetNow = Date.parse('2026-08-17T12:00:00.000Z');
  const budgetWindow = core.buildInvocationBudgetWindow(budgetNow);
  const usage = core.accumulateInvocationBudgetUsagePage([
    { id: '77777777-7777-4777-8777-777777777771', circle_id: circleId, status: 'done', token_count: 1_000_000, created_at: '2026-08-17T08:00:00.000Z' },
    { id: '77777777-7777-4777-8777-777777777772', circle_id: circleId, status: 'done', token_count: '2000000', created_at: '2026-08-16T08:00:00.000Z' },
    { id: '77777777-7777-4777-8777-777777777773', circle_id: circleId, status: 'done', token_count: 4_000_000, created_at: '2026-08-07T08:00:00.000Z' },
    { id: '77777777-7777-4777-8777-777777777774', circle_id: circleId, status: 'pending', token_count: 9_000_000, created_at: '2026-08-17T09:00:00.000Z' },
  ], circleId, budgetWindow);
  assert(
    usage?.today === 5 && usage.week === 6 && usage.month === 8,
    'all recorded token usage accumulates into local-calendar daily, seven-day, and monthly windows',
  );
  assert(
    core.accumulateInvocationBudgetUsagePage([
      { id: '77777777-7777-4777-8777-777777777775', circle_id: circleId, status: 'done', token_count: '9007199254740992', created_at: '2026-08-17T08:00:00.000Z' },
    ], circleId, budgetWindow) === null,
    'unsafe token totals invalidate the usage snapshot instead of undercounting',
  );

  console.log('Paginated budget usage authority');
  const usageNow = Date.now();
  const usageRows = [
    { id: '88888888-8888-4888-8888-888888888881', circle_id: circleId, status: 'done', token_count: 1_000_000, created_at: new Date(usageNow - 60_000).toISOString() },
    { id: '88888888-8888-4888-8888-888888888882', circle_id: circleId, status: 'done', token_count: 2_000_000, created_at: new Date(usageNow - 86_400_000).toISOString() },
    { id: '88888888-8888-4888-8888-888888888883', circle_id: circleId, status: 'pending', token_count: 9_000_000, created_at: new Date(usageNow - 120_000).toISOString() },
  ];
  observed.usageRanges = [];
  observed.usageHeaders = [];
  core.setUsagePages([
    { data: usageRows.slice(0, 2), error: null, count: 3 },
    { data: usageRows.slice(2), error: null, count: 3 },
  ]);
  const pagedSpend = await core.loadInvocationBudgetSpend(circleId, execution);
  assert(pagedSpend.ok && pagedSpend.spend.month === 6, 'all counted usage pages and statuses contribute to spend');
  assert(
    JSON.stringify(observed.usageRanges) === JSON.stringify([[0, 999], [2, 1001]]),
    'pagination advances by returned rows when a server page is smaller than the request',
  );
  assert(
    observed.usageHeaders.every((entry) => entry[1] === `Bearer ${authority.accessToken}`),
    'every usage page binds the captured bearer',
  );
  assert(
    observed.usageAbortSignals.every((value) => value === execution.signal),
    'every usage page carries the captured abort signal',
  );
  core.setUsagePages([{ data: null, error: { message: 'offline' }, count: null }]);
  const failedSpend = await core.loadInvocationBudgetSpend(circleId, execution);
  assert(!failedSpend.ok && failedSpend.reason === 'usage', 'a usage query error fails the hard-limit preflight closed');
  current = true;
  core.setUsageHook(() => { current = false; });
  core.setUsagePages([{ data: [], error: null, count: 0 }]);
  const retiredSpend = await core.loadInvocationBudgetSpend(circleId, execution);
  assert(!retiredSpend.ok && retiredSpend.reason === 'authority', 'retirement during a usage page fails closed');
  core.setUsageHook(() => {});
  current = true;

  console.log('Claim bearer and post-claim retirement');
  current = true;
  observed.headers = {};
  sandbox.__onClaimAwait = () => { current = false; };
  core.bindExact(remoteSenderRequest, execution);
  const claim = await core.invokeAgent(remoteSenderRequest, {
    id: agentId,
    name: 'Claude Code',
    provider: 'claude-code',
  });
  assert(observed.rpcName === 'invoke_agent', 'claim uses the canonical atomic RPC');
  assert(
    observed.headers.Authorization === `Bearer ${authority.accessToken}`,
    'claim RPC is explicitly bound to the captured bearer',
  );
  assert(claim?.responseId === responseId, 'valid canonical claim is retained');
  assert(claim?.authorityRetiredAfterClaim === true, 'retirement after claim is carried to orchestration');
  assert(
    core.buildOfficeInvocationRetiredAfterClaimResult(responseId).disposition === 'outcome_unknown',
    'retired claimed work is non-replayable outcome_unknown',
  );

  console.log('Production source fences');
  const dbSection = section(
    'export async function invokeAgent(',
    '// ─── BlackSwan: Invoke via swanbot-ai edge function',
  );
  assert(
    dbSection.includes("claimRpc.setHeader(")
      && dbSection.includes('exactExecution.authority.accessToken')
      && dbSection.includes("fallbackClaimRpc.setHeader("),
    'primary and safe fallback claims carry captured Authorization',
  );
  assert(
    dbSection.includes('authorityRetiredAfterClaim')
      && dbSection.includes('officeInvocationExecutionIsCurrent(exactExecution)'),
    'claim detects lifecycle retirement after its await',
  );
  assert(
    dbSection.includes("responseRpc.setHeader(")
      && dbSection.includes("completionRpc.setHeader("),
    'response and completion RPCs carry captured Authorization',
  );

  const orchestration = section(
    'export async function invokeAndStream(',
    '// ─── Multi-Agent: Invoke all agents in parallel',
  );
  assert(
    orchestration.includes('exactExecutionInput?: OfficeInvocationExactExecution'),
    'invokeAndStream exposes an opt-in exact execution contract',
  );
  const budgetConfigReadSource = section(
    'async function loadInvocationBudgetConfig(',
    'function buildInvocationBudgetWindow(',
  );
  assert(
    budgetConfigReadSource.includes('await loadOfficeUserPreferences(')
      && budgetConfigReadSource.includes('exactExecution.authority.userId')
      && budgetConfigReadSource.includes('exactExecution.authority.accessToken'),
    'exact dispatch loads canonical user-and-circle Office budget preferences',
  );
  assert(
    budgetConfigReadSource.indexOf('await loadOfficeUserPreferences(')
      < budgetConfigReadSource.lastIndexOf('officeInvocationExecutionIsCurrent(exactExecution)'),
    'budget preference authority is rechecked after its await',
  );
  const budgetSpendReadSource = section(
    'async function loadInvocationBudgetSpend(',
    'function buildOfficeBudgetPreflightFailure(',
  );
  assert(
    budgetSpendReadSource.includes("{ count: 'exact' }")
      && budgetSpendReadSource.includes('.range(offset, offset + OFFICE_BUDGET_USAGE_PAGE_SIZE - 1)')
      && budgetSpendReadSource.includes('offset += data.length'),
    'usage totals page through the exact result count without assuming the server row cap',
  );
  assert(
    budgetSpendReadSource.includes('if (\n      error')
      && budgetSpendReadSource.indexOf('const { data, error, count } = await query;')
        < budgetSpendReadSource.indexOf('officeInvocationExecutionIsCurrent(exactExecution)', budgetSpendReadSource.indexOf('const { data, error, count } = await query;')),
    'every usage page checks query errors and authority after its await',
  );
  assert(
    orchestration.includes('await loadInvocationBudgetConfig(req.circleId, exactExecution)')
      && orchestration.includes('await loadInvocationBudgetSpend(req.circleId, exactExecution)')
      && orchestration.includes('OFFICE_BUDGET_SETTINGS_UNAVAILABLE')
      && orchestration.includes('OFFICE_BUDGET_USAGE_UNAVAILABLE')
      && !orchestration.includes("console.warn('[agentInvocation] budget_check_unavailable')"),
    'unverifiable enabled hard limits return non-dispatch failures instead of failing open',
  );
  assert(
    orchestration.includes('const claim = await invokeAgent(req, agent);'),
    'legacy claimant call shape remains intact',
  );
  assert(
    orchestration.includes('claim.authorityRetiredAfterClaim')
      && orchestration.includes('buildOfficeInvocationRetiredAfterClaimResult(claim.responseId)'),
    'post-claim retirement suppresses provider continuation without replay',
  );
  const providerFence = orchestration.indexOf(
    'if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution))',
    orchestration.indexOf('let result: AgentInvocationResult;'),
  );
  const providerRoute = orchestration.indexOf('if (blackSwan)', providerFence);
  assert(providerFence >= 0 && providerFence < providerRoute, 'current guard runs immediately before provider routing');
  assert(
    orchestration.includes('invokeClaudeCode(canonicalReq.command, resolvedUrl, exactExecution)')
      && orchestration.includes('invokeGeminiCli(canonicalReq.command, geminiUrl, exactExecution)'),
    'local bridge routes receive abortable exact execution',
  );
  assert(
    orchestration.indexOf(
      'if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution))',
      orchestration.indexOf('result = await invokeBYOLLM('),
    ) > orchestration.indexOf('result = await invokeBYOLLM('),
    'current guard re-runs after provider await',
  );

  const blackSwan = section('async function invokeBlackSwan(', '// ─── Claude Code:');
  const byo = section('async function invokeBYOLLM(', '// ─── OpenSwan Gateway:');
  assert(
    blackSwan.includes('Authorization: `Bearer ${exactExecution.authority.accessToken}`')
      && blackSwan.includes('signal: exactExecution.signal'),
    'BlackSwan edge invocation binds bearer and AbortSignal',
  );
  assert(
    byo.includes('Authorization: `Bearer ${exactExecution.authority.accessToken}`')
      && byo.includes('signal: exactExecution.signal'),
    'BYO edge invocation binds bearer and AbortSignal',
  );
  const claude = section('async function invokeClaudeCode(', '// ─── Gemini CLI:');
  const gemini = section('async function invokeGeminiCli(', '// ─── BYO LLM:');
  assert(
    claude.includes("addEventListener('abort', retire")
      && claude.includes('signal: controller.signal')
      && claude.includes("removeEventListener('abort', retire)"),
    'Claude bridge links and releases the lifecycle AbortSignal',
  );
  assert(
    gemini.includes("addEventListener('abort', retire")
      && gemini.includes('signal: controller.signal')
      && gemini.includes("removeEventListener('abort', retire)"),
    'Gemini bridge links and releases the lifecycle AbortSignal',
  );
  const openSwan = section('export async function callOpenSwanAgent(', '// ─── Fallback: Estimate tokens');
  assert(
    openSwan.indexOf('officeInvocationExecutionIsCurrent(exactExecution)')
      < openSwan.indexOf('await sendSessionMessage('),
    'OpenSwan session send is fenced immediately before transport I/O',
  );

  const fanout = source.slice(source.indexOf('export async function invokeAllAgents('));
  assert(
    fanout.match(/officeSessionSnapshot,\s+exactExecution,/g)?.length === 2,
    'all-agent and selected-agent fan-out propagate exact execution',
  );

  console.log(`office-invocation-exact-authority-smoketest: ${assertions} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
