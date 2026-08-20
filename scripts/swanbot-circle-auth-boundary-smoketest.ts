/**
 * Fail-closed source/core smoke for SwanBot v1 circle authorization.
 *
 * The Edge entrypoint cannot be imported in Node because it registers a Deno
 * server and uses URL imports. Extract the dependency-light membership helper
 * into a VM, then pin its position before every service-role/provider side
 * effect in the request handler.
 *
 * Run: npx tsx scripts/swanbot-circle-auth-boundary-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync('supabase/functions/swanbot-ai/index.ts', 'utf8');
let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function sourceSection(start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const helperSource = sourceSection(
  'async function requireSwanBotCircleMembership(',
  'Deno.serve(async (req: Request) => {',
);
const compiledHelper = stripTypeScriptTypes(
  `${helperSource}
;(globalThis as any).__requireMembership = requireSwanBotCircleMembership;
;(globalThis as any).__readBoundedSwanBotRequest = readBoundedSwanBotRequest;`,
  { mode: 'strip' },
);

const sandbox: Record<string, unknown> = {
  errResponse: (status: number, code: string, message: string) => ({ status, code, message }),
  Headers,
  ReadableStream,
  Request,
  TextDecoder,
  TextEncoder,
  URL,
};
vm.runInNewContext(compiledHelper, sandbox);
const requireMembership = sandbox.__requireMembership as (
  client: unknown,
  input: { circleId: string; userId: string },
) => Promise<{ status: number; code: string; message: string } | null>;
const readBoundedSwanBotRequest = sandbox.__readBoundedSwanBotRequest as (
  request: Request,
) => Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: { status: number; code: string; message: string } }
>;

const circleId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

const policyHelpers = stripTypeScriptTypes(
  `${sourceSection('const UUID_PATTERN =', 'const BLACKSWAN_TOOLS =')}
${sourceSection('type MarketplaceProviderKey =', 'function userApiProviderForMarketplaceProvider')}
${sourceSection('function getTrustedReplicatePollUrl(', 'async function callReplicateProvider(')}
;(globalThis as any).__swanbotHostedPolicy = {
  validateTaskUpdateInput,
  getTrustedHostedMarketplaceEndpoint,
  isHostedCustomEndpointModel,
  getTrustedReplicatePollUrl,
};`,
  { mode: 'strip' },
);
vm.runInNewContext(policyHelpers, sandbox);
const hostedPolicy = sandbox.__swanbotHostedPolicy as {
  validateTaskUpdateInput: (input: unknown) =>
    | { ok: true; taskId: string; changes: Record<string, string | null> }
    | { ok: false; code: string };
  getTrustedHostedMarketplaceEndpoint: (provider: string) => string | null;
  isHostedCustomEndpointModel: (model: unknown) => boolean;
  getTrustedReplicatePollUrl: (value: unknown) => string | null;
};

function membershipClient(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = {
    select(column: string) {
      calls.push(['select', column]);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.push(['eq', column, value]);
      return builder;
    },
    async maybeSingle() {
      calls.push(['maybeSingle']);
      return result;
    },
  };
  return {
    calls,
    from(table: string) {
      calls.push(['from', table]);
      return builder;
    },
  };
}

async function main(): Promise<void> {
  console.log('Hosted egress and task-mutation policies');
  {
    const taskId = '33333333-3333-4333-8333-333333333333';
    const valid = hostedPolicy.validateTaskUpdateInput({
      task_id: taskId.toUpperCase(),
      status: 'done',
      priority: 'high',
      assigned_agent_id: null,
    });
    assert(
      valid.ok
        && valid.taskId === taskId
        && valid.changes.status === 'done'
        && valid.changes.priority === 'high'
        && valid.changes.assigned_agent_id === null,
      'task updates accept only a bounded exact identity and supported changes',
    );
    for (const [label, input] of [
      ['invalid UUID', { task_id: 'not-a-task', status: 'done' }],
      ['no changes', { task_id: taskId }],
      ['unknown field', { task_id: taskId, status: 'done', circle_id: circleId }],
      ['invalid status', { task_id: taskId, status: 'deleted' }],
      ['control characters', { task_id: taskId, assigned_agent_id: 'agent\u0000evil' }],
    ] as const) {
      assert(!hostedPolicy.validateTaskUpdateInput(input).ok, `${label} task update fails closed`);
    }
    assert(
      hostedPolicy.validateTaskUpdateInput({ task_id: taskId, status: 'approved' }).ok,
      'current Kanban approved status remains supported',
    );

    assert(
      hostedPolicy.getTrustedHostedMarketplaceEndpoint('openai')
        === 'https://api.openai.com/v1/chat/completions',
      'OpenAI dispatch resolves to its exact code-owned HTTPS endpoint',
    );
    assert(
      hostedPolicy.getTrustedHostedMarketplaceEndpoint('openai_compatible') === null
        && hostedPolicy.getTrustedHostedMarketplaceEndpoint('ollama') === null,
      'custom and local providers have no hosted endpoint',
    );
    for (const model of [
      'openai_compatible/https://169.254.169.254/latest/meta-data',
      'ollama/http://127.0.0.1:11434/model',
      'huggingface_endpoint/https://attacker.example/model',
    ]) {
      assert(hostedPolicy.isHostedCustomEndpointModel(model), `${model.split('/')[0]} is blocked at request ingress`);
    }

    assert(
      hostedPolicy.getTrustedReplicatePollUrl(
        'https://api.replicate.com/v1/predictions/prediction_123',
      ) === 'https://api.replicate.com/v1/predictions/prediction_123',
      'Replicate polling accepts only its exact prediction URL shape',
    );
    const credentialedReplicateUrl = `https://${['user', 'pass'].join(':')}@api.replicate.com/v1/predictions/prediction_123`;
    for (const url of [
      'https://attacker.example/v1/predictions/prediction_123',
      'https://api.replicate.com.evil.example/v1/predictions/prediction_123',
      credentialedReplicateUrl,
      'https://api.replicate.com/v1/predictions/prediction_123?next=https://evil.example',
      'https://api.replicate.com/v1/predictions/prediction_123/extra',
    ]) {
      assert(hostedPolicy.getTrustedReplicatePollUrl(url) === null, `Replicate rejects ${url}`);
    }

    const smallRequest = new Request('https://example.test/swanbot', {
      method: 'POST',
      body: JSON.stringify({ message: 'hello', circleId }),
    });
    const smallRead = await readBoundedSwanBotRequest(smallRequest);
    assert(smallRead.ok && smallRead.body.message === 'hello', 'small UTF-8 SwanBot JSON is parsed');

    const oversizedRequest = {
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2_000_001));
          controller.close();
        },
      }),
    } as Request;
    const oversizedRead = await readBoundedSwanBotRequest(oversizedRequest);
    assert(
      !oversizedRead.ok && oversizedRead.response.status === 413,
      'chunked SwanBot bodies are stopped at the actual byte cap',
    );
  }

  console.log('Exact membership helper');
  const memberClient = membershipClient({ data: { user_id: userId }, error: null });
  assert(
    await requireMembership(memberClient, { circleId, userId }) === null,
    'an exact membership row authorizes downstream work',
  );
  assert(
    JSON.stringify(memberClient.calls) === JSON.stringify([
      ['from', 'circle_members'],
      ['select', 'user_id'],
      ['eq', 'circle_id', circleId],
      ['eq', 'user_id', userId],
      ['maybeSingle'],
    ]),
    'membership lookup binds the authenticated user and requested circle in one query',
  );

  for (const [label, result] of [
    ['missing membership', { data: null, error: null }],
    ['lookup error', { data: null, error: { message: 'database unavailable' } }],
  ] as const) {
    const client = membershipClient(result);
    const rejection = await requireMembership(client, { circleId, userId });
    assert(
      rejection?.status === 403
        && rejection.code === 'forbidden'
        && rejection.message === 'Not authorized for this circle.',
      `${label} fails closed with the same non-enumerating response`,
    );
  }

  console.log('Handler ordering and zero-side-effect rejection');
  const handlerStart = source.indexOf('Deno.serve(async (req: Request) => {');
  assert(handlerStart >= 0, 'SwanBot v1 request handler is present');
  const handler = source.slice(handlerStart);
  const authAt = handler.indexOf('const user = await getAuthenticatedUser(req);');
  const bodyReadAt = handler.indexOf('await readBoundedSwanBotRequest(req)');
  const serviceClientAt = handler.indexOf('const supabase = createServiceRoleClient();');
  const gateAt = handler.indexOf('const membershipRejection = await requireSwanBotCircleMembership');
  const immediateReturnAt = handler.indexOf('if (membershipRejection) return membershipRejection;', gateAt);
  assert(
    authAt >= 0 && bodyReadAt > authAt && serviceClientAt > bodyReadAt,
    'JWT identity is established before bounded body parsing and service-role access',
  );
  assert(gateAt > serviceClientAt, 'exact circle authorization immediately follows service-client creation');
  assert(immediateReturnAt > gateAt, 'a rejected membership returns immediately');

  const firstAuthorizedStateAt = handler.indexOf('swanBotV1RunSupabase = supabase;');
  assert(
    immediateReturnAt < firstAuthorizedStateAt,
    'failure bookkeeping receives no service client before membership succeeds',
  );

  const sensitiveMarkers = [
    'maybeCircleClaudeBudgetExceededResponse(supabase, circleId)',
    'resolveUserModelApiKey({',
    'const relayToolsDisabled =',
    'loadCircleBlackswanRouting(supabase, circleId)',
    'loadCircleOllamaBaseUrl(supabase, circleId)',
    'loadMarketplaceProviderCredential(supabase, circleId, userId, providerKey)',
    'loadCircleProviderApiKey(supabase, circleId, "blackswan", "api_token")',
    'loadMarketplaceProviderApiKey(supabase, circleId, userId, providerKey)',
    'callMarketplaceProviderWithTools({',
    'fetch("https://api.anthropic.com/v1/messages"',
    'createSwanBotV1Run(supabase, {',
    'const context: any = await gatherCircleContext(',
  ];
  for (const marker of sensitiveMarkers) {
    const markerAt = handler.indexOf(marker);
    assert(markerAt >= 0, `sensitive path remains present: ${marker}`);
    assert(immediateReturnAt < markerAt, `membership rejection precedes: ${marker}`);
  }

  const preGate = handler.slice(0, gateAt);
  for (const forbidden of [
    'maybeCircleClaudeBudgetExceededResponse',
    'resolveUserModelApiKey',
    'loadCircleBlackswanRouting',
    'loadMarketplaceProviderApiKey',
    'callMarketplaceProviderWithTools',
    'createSwanBotV1Run',
    'gatherCircleContext',
    'logClaudeUsage',
    'logMarketplaceUsage',
  ]) {
    assert(!preGate.includes(forbidden), `pre-authorization handler has no ${forbidden} call`);
  }
  assert(
    !handler.slice(immediateReturnAt).includes('const { data: membership } = await supabase'),
    'the former relay-bypassable late membership query is gone',
  );

  console.log('Source-level containment contract');
  const toolsSchema = sourceSection('const BLACKSWAN_TOOLS =', 'async function executeToolCall(');
  assert(!toolsSchema.includes('name: "fetch_url"'), 'hosted tool schema does not advertise arbitrary URL fetch');
  const fetchUrlCase = sourceSection('case "fetch_url": {', 'case "store_memory": {');
  assert(
    fetchUrlCase.includes('hosted_fetch_url_disabled') && !fetchUrlCase.includes('fetch('),
    'stale fetch_url tool replays fail closed without network access',
  );
  const blackSwanRoute = sourceSection('async function callBlackSwanLLM(', '// ─── Call Claude');
  assert(
    blackSwanRoute.includes('return null') && !blackSwanRoute.includes('fetch('),
    'hosted BlackSwan fallback cannot fetch a configured endpoint',
  );
  const taskUpdateCase = sourceSection('case "update_task": {', 'case "post_activity": {');
  assert(
    taskUpdateCase.includes('.eq("id", validated.taskId)')
      && taskUpdateCase.includes('.eq("circle_id", circleId)')
      && taskUpdateCase.includes('.maybeSingle()')
      && taskUpdateCase.includes('task_not_found_or_unavailable'),
    'task mutation binds task and circle in one non-enumerating update',
  );
  const marketplace = sourceSection('async function callMarketplaceProvider(opts:', '// ── Tool-shape translators');
  const marketplaceTools = sourceSection('async function callMarketplaceProviderWithTools(opts:', 'async function callClaude(');
  for (const [label, providerSource] of [
    ['single-shot marketplace', marketplace],
    ['tool-aware marketplace', marketplaceTools],
  ] as const) {
    const rejectAt = providerSource.indexOf('hosted_custom_endpoint_blocked');
    const endpointAt = providerSource.indexOf('getTrustedHostedMarketplaceEndpoint(provider)');
    const fetchAt = providerSource.indexOf('fetch(endpoint');
    assert(
      rejectAt >= 0 && endpointAt > rejectAt && fetchAt > endpointAt
        && providerSource.includes('redirect: "manual"'),
      `${label} rejects overrides before fixed-host dispatch and disables redirects`,
    );
  }
  assert(
    !source.includes('BLACKSWAN_API_URL') && !source.includes('GITBOOK_DOCS_URL'),
    'hosted SwanBot has no operator-configured public egress URL fallback',
  );
  assert(
    (source.match(/\bfetch\(/g) || []).length
      === (source.match(/redirect:\s*"manual"/g) || []).length,
    'every remaining SwanBot fetch explicitly disables redirects',
  );

  console.log(`\nswanbot-circle-auth-boundary-smoketest: ${assertions} assertions passed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
