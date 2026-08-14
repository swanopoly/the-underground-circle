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

const runtimeSource = `
let verifiedUserId = '22222222-2222-4222-8222-222222222222';
let verifyHook = () => {};
function isUuidLike(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function safeGetUserForAccessToken(accessToken) {
  globalThis.__observed.verifiedBearer = accessToken;
  verifyHook();
  return { value: verifiedUserId ? { id: verifiedUserId } : null, error: null };
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
};
${authorityCore}
${claimSource}
globalThis.__core = {
  normalizeOfficeInvocationExactAuthority,
  officeInvocationExecutionIsCurrent,
  resolveOfficeInvocationExactExecution,
  buildOfficeInvocationAuthorityUnavailableResult,
  buildOfficeInvocationRetiredAfterClaimResult,
  invokeAgent,
  bindExact(req, execution) { exactExecutionByInvocationRequest.set(req, execution); },
  setVerifiedUserId(value) { verifiedUserId = value; },
  setVerifyHook(value) { verifyHook = value; },
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
