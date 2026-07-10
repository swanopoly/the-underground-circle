/**
 * integration-action-composer-smoketest — guards the AI integration-action
 * composer (src/lib/integrationActionComposer.ts): the "tell me what you want
 * and the AI figures out the API call" path for connected Custom-API
 * integrations.
 *
 *  1. shouldComposeIntegrationAction gating: write + connected custom_api with
 *     baseUrl/allowedMethods → yes; read-only goal / unconnected / messaging /
 *     non-custom_api / no baseUrl / read-only method list → no.
 *  2. buildIntegrationActionPrompt: bounded (≤2500), contains the non-secret
 *     metadata + goal + allowed methods, includes the never-include-auth
 *     instruction, and a priorError repair block when given.
 *  3. parseIntegrationActionProposal: valid → ok; method-not-allowed → reject;
 *     absolute/foreign-host path → reject; ".." traversal → reject; secret key
 *     in body/query → stripped; unparseable → error; tolerant of prose/fence.
 *  4. buildCustomApiRequestArgsFromProposal maps to the exact custom_api.request
 *     args (integrationId + method/path/query/body + taskContext).
 *  5. describeProposedIntegrationAction is a no-secret one-liner.
 *  6. Degenerate inputs never throw.
 *
 * Pure module — no supabase, no react-native. Run:
 *   npx tsx scripts/integration-action-composer-smoketest.ts
 */

import {
  INTEGRATION_ACTION_METHODS,
  MAX_INTEGRATION_PROMPT_LENGTH,
  buildCustomApiRequestArgsFromProposal,
  buildIntegrationActionPrompt,
  describeProposedIntegrationAction,
  effectiveActionMethods,
  parseIntegrationActionProposal,
  shouldComposeIntegrationAction,
  type IntegrationActionMethod,
} from '../src/lib/integrationActionComposer';

let failures = 0;
let passes = 0;
function pass(message: string): void {
  passes += 1;
  console.log('pass:', message);
}
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, message, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const connectedCustomApi = {
  id: 'int_linear_1',
  provider: 'custom_api' as const,
  status: 'connected' as const,
  display_name: 'Linear',
  label: 'Custom API',
  capability_flags: ['custom_api', 'write_data', 'automation_action'],
  metadata: {
    apiName: 'Linear',
    baseUrl: 'https://api.linear.app',
    apiDocsUrl: 'https://developers.linear.app',
    defaultEndpoint: '/graphql',
    allowedMethods: 'GET, POST',
    authScheme: 'bearer',
    toolNamespace: 'linear',
  },
};

const readOnlyMethodApi = {
  ...connectedCustomApi,
  id: 'int_readonly',
  metadata: { ...connectedCustomApi.metadata, allowedMethods: 'GET, HEAD' },
};

const noBaseUrlApi = {
  ...connectedCustomApi,
  id: 'int_nobase',
  metadata: { apiName: 'Nope', allowedMethods: 'POST' } as Record<string, unknown>,
};

const disconnectedApi = { ...connectedCustomApi, id: 'int_disc', status: 'disabled' as const };

const messagingIntegration = {
  id: 'int_slack',
  provider: 'slack' as const,
  status: 'connected' as const,
  display_name: 'Slack',
  label: 'Slack',
  capability_flags: ['send_message'],
  metadata: {},
};

const nonCustomProvider = {
  id: 'int_stripe',
  provider: 'stripe' as const,
  status: 'connected' as const,
  display_name: 'Stripe',
  label: 'Stripe',
  capability_flags: ['manage_payments'],
  metadata: { baseUrl: 'https://api.stripe.com', allowedMethods: 'GET, POST' },
};

function main(): void {
  // ─── (1) shouldComposeIntegrationAction gating ───────────────────────────
  assertEqual(
    shouldComposeIntegrationAction({ integration: connectedCustomApi, goal: 'create an issue titled Fix login' }),
    true,
    '(1) write goal + connected custom_api + metadata → compose',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: connectedCustomApi, goal: 'submit a new bug report' }),
    true,
    '(1) "submit" is write-ish → compose',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: connectedCustomApi, goal: 'update the ticket status to done' }),
    true,
    '(1) "update" is write-ish → compose',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: connectedCustomApi, goal: 'list all my open issues' }),
    false,
    '(1) read-only "list" goal → no (use custom_api.read)',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: connectedCustomApi, goal: 'show me recent customers' }),
    false,
    '(1) read-only "show" goal → no',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: connectedCustomApi, goal: 'how many tickets are open?' }),
    false,
    '(1) read-only question → no',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: disconnectedApi, goal: 'create an issue' }),
    false,
    '(1) unconnected integration → no',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: messagingIntegration, goal: 'send a message to the team' }),
    false,
    '(1) messaging provider → no (use messaging.notify)',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: nonCustomProvider, goal: 'create a customer' }),
    false,
    '(1) non-custom_api provider → no',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: noBaseUrlApi, goal: 'create an issue' }),
    false,
    '(1) no baseUrl metadata → no',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: readOnlyMethodApi, goal: 'create an issue' }),
    false,
    '(1) only read methods (GET/HEAD) allowed → no',
  );
  assertEqual(
    shouldComposeIntegrationAction({ integration: connectedCustomApi, goal: '' }),
    false,
    '(1) empty goal → no',
  );

  // effectiveActionMethods: parsed write subset, and full set when unspecified
  assert(
    JSON.stringify(effectiveActionMethods(connectedCustomApi)) === JSON.stringify(['POST']),
    '(1) effectiveActionMethods parses "GET, POST" → [POST]',
    JSON.stringify(effectiveActionMethods(connectedCustomApi)),
  );
  assertEqual(effectiveActionMethods(readOnlyMethodApi).length, 0, '(1) read-only method list → 0 write methods');
  assertEqual(
    effectiveActionMethods({ metadata: { baseUrl: 'https://x.dev' } }).length,
    INTEGRATION_ACTION_METHODS.length,
    '(1) no allowedMethods configured → full write set',
  );

  // ─── (2) buildIntegrationActionPrompt ────────────────────────────────────
  const prompt = buildIntegrationActionPrompt({
    integration: connectedCustomApi,
    goal: 'create an issue titled Fix login on the ENG team',
  });
  assert(prompt.length <= MAX_INTEGRATION_PROMPT_LENGTH, '(2) prompt ≤2500 chars', `${prompt.length} chars`);
  assert(prompt.includes('https://api.linear.app'), '(2) prompt contains baseUrl');
  assert(prompt.includes('developers.linear.app'), '(2) prompt contains apiDocsUrl');
  assert(prompt.includes('/graphql'), '(2) prompt contains defaultEndpoint');
  assert(prompt.includes('Linear'), '(2) prompt contains the API name');
  assert(prompt.includes('POST'), '(2) prompt lists the allowed method');
  assert(!prompt.includes('GET'), '(2) prompt does NOT offer the read-only GET method as writable');
  assert(prompt.includes('create an issue titled Fix login'), '(2) prompt contains the user goal');
  assert(/never include/i.test(prompt) && /auth/i.test(prompt), '(2) prompt has the never-include-auth instruction');
  assert(/relative path/i.test(prompt), '(2) prompt requires a relative path');
  assert(/"summary"|summary/i.test(prompt), '(2) prompt asks for a summary field');

  const repairPrompt = buildIntegrationActionPrompt({
    integration: connectedCustomApi,
    goal: 'create an issue',
    priorError: 'method PATCH is not allowed',
  });
  assert(/REJECTED/i.test(repairPrompt) && repairPrompt.includes('PATCH is not allowed'), '(2) priorError → repair block');
  assert(repairPrompt.length <= MAX_INTEGRATION_PROMPT_LENGTH, '(2) repair prompt still ≤2500', `${repairPrompt.length}`);

  const allowed = effectiveActionMethods(connectedCustomApi);

  // ─── (3) parseIntegrationActionProposal ──────────────────────────────────
  const valid = parseIntegrationActionProposal(
    '{"method":"POST","path":"/issues","body":{"title":"Fix login"},"summary":"Create an issue titled Fix login"}',
    { allowedMethods: allowed },
  );
  assert(valid.ok, '(3) valid proposal → ok');
  if (valid.ok) {
    assertEqual(valid.proposal.method, 'POST', '(3) parsed method');
    assertEqual(valid.proposal.path, '/issues', '(3) parsed path');
    assertEqual((valid.proposal.body as any)?.title, 'Fix login', '(3) parsed body');
    assert(valid.proposal.summary.length > 0, '(3) parsed summary non-empty');
  }

  // tolerant: prose + code fence around the JSON
  const fenced = parseIntegrationActionProposal(
    'Sure! Here is the request:\n```json\n{"method":"POST","path":"issues","summary":"make it"}\n```\nHope that helps.',
    { allowedMethods: allowed },
  );
  assert(fenced.ok, '(3) tolerant parse: JSON inside prose + fence → ok');
  if (fenced.ok) assertEqual(fenced.proposal.path, 'issues', '(3) tolerant parse keeps relative path');

  // method not in allowlist → reject
  const badMethod = parseIntegrationActionProposal('{"method":"DELETE","path":"/x","summary":"del"}', {
    allowedMethods: ['POST'],
  });
  assert(!badMethod.ok, '(3) method not in allowlist → reject');
  if (!badMethod.ok) assert(/not in the allowed/i.test(badMethod.error), '(3) reject explains allowlist', badMethod.error);

  // not-a-write-method at all → reject
  const getMethod = parseIntegrationActionProposal('{"method":"GET","path":"/x","summary":"read"}', {
    allowedMethods: ['POST'],
  });
  assert(!getMethod.ok, '(3) GET is not a write-like method → reject');

  // absolute foreign-host URL as path → reject
  const foreignHost = parseIntegrationActionProposal(
    '{"method":"POST","path":"https://evil.example.com/steal","summary":"x"}',
    { allowedMethods: allowed },
  );
  assert(!foreignHost.ok, '(3) absolute foreign-host path → reject');
  if (!foreignHost.ok) assert(/relative|absolute url/i.test(foreignHost.error), '(3) reject explains relative-only', foreignHost.error);

  // protocol-relative //host → reject
  const protoRel = parseIntegrationActionProposal('{"method":"POST","path":"//evil.com/x","summary":"x"}', {
    allowedMethods: allowed,
  });
  assert(!protoRel.ok, '(3) protocol-relative //host path → reject');

  // ".." traversal → reject
  const traversal = parseIntegrationActionProposal('{"method":"POST","path":"/a/../../etc/passwd","summary":"x"}', {
    allowedMethods: allowed,
  });
  assert(!traversal.ok, '(3) ".." traversal path → reject');
  if (!traversal.ok) assert(/\.\./.test(traversal.error), '(3) reject mentions traversal', traversal.error);

  // secret-shaped key in BODY → stripped, proposal still ok
  const secretBody = parseIntegrationActionProposal(
    '{"method":"POST","path":"/issues","body":{"title":"x","api_key":"sk-should-be-stripped","authorization":"Bearer leak","nested":{"password":"p","keep":"ok"}},"summary":"x"}',
    { allowedMethods: allowed },
  );
  assert(secretBody.ok, '(3) proposal with secret body keys → still ok (stripped, not rejected)');
  if (secretBody.ok) {
    const body = secretBody.proposal.body as any;
    assert(!('api_key' in body), '(3) top-level api_key stripped from body');
    assert(!('authorization' in body), '(3) authorization stripped from body');
    assert(!('password' in (body.nested || {})), '(3) nested password stripped from body');
    assertEqual(body.title, 'x', '(3) non-secret body field survives');
    assertEqual(body.nested?.keep, 'ok', '(3) non-secret nested field survives');
    const serialized = JSON.stringify(secretBody.proposal);
    assert(!/sk-should-be-stripped/.test(serialized) && !/Bearer leak/.test(serialized), '(3) no stripped secret leaks into proposal');
  }

  // secret-shaped key in QUERY → stripped
  const secretQuery = parseIntegrationActionProposal(
    '{"method":"POST","path":"/issues","query":{"token":"leak","page":2,"active":true},"summary":"x"}',
    { allowedMethods: allowed },
  );
  assert(secretQuery.ok, '(3) proposal with secret query key → still ok');
  if (secretQuery.ok) {
    assert(!secretQuery.proposal.query || !('token' in secretQuery.proposal.query), '(3) secret query key stripped');
    assertEqual(secretQuery.proposal.query?.page, 2, '(3) scalar query number kept');
    assertEqual(secretQuery.proposal.query?.active, true, '(3) scalar query boolean kept');
  }

  // unparseable → error
  const garbage = parseIntegrationActionProposal('I refuse to output JSON, sorry.', { allowedMethods: allowed });
  assert(!garbage.ok, '(3) no JSON in reply → error');
  const brokenJson = parseIntegrationActionProposal('{"method":"POST", "path": ', { allowedMethods: allowed });
  assert(!brokenJson.ok, '(3) truncated/invalid JSON → error');

  // empty allowlist → error
  const noAllowed = parseIntegrationActionProposal('{"method":"POST","path":"/x","summary":"x"}', {
    allowedMethods: [] as IntegrationActionMethod[],
  });
  assert(!noAllowed.ok, '(3) empty allowlist → error');

  // ─── (4) buildCustomApiRequestArgsFromProposal ───────────────────────────
  const proposalForArgs = {
    method: 'POST' as IntegrationActionMethod,
    path: '/issues',
    query: { page: 1 },
    body: { title: 'Fix login' },
    summary: 'Create an issue titled Fix login',
  };
  const args = buildCustomApiRequestArgsFromProposal(connectedCustomApi, proposalForArgs);
  assertEqual(args.integrationId, 'int_linear_1', '(4) args carry integrationId (routes through existing tool)');
  assertEqual(args.method, 'POST', '(4) args method');
  assertEqual(args.path, '/issues', '(4) args path');
  assertEqual((args.body as any)?.title, 'Fix login', '(4) args body');
  assertEqual(args.query?.page, 1, '(4) args query');
  assertEqual(args.apiName, 'Linear', '(4) args carry apiName from metadata');
  assertEqual(args.toolNamespace, 'linear', '(4) args carry toolNamespace from metadata');
  assertEqual(args.taskContext, proposalForArgs.summary, '(4) args taskContext = summary for approval/audit');

  // ─── (5) describeProposedIntegrationAction ───────────────────────────────
  const desc = describeProposedIntegrationAction(connectedCustomApi, proposalForArgs);
  assert(desc.startsWith('POST /issues on Linear'), '(5) describe starts "POST /issues on Linear"', desc);
  assert(desc.includes('Create an issue titled Fix login'), '(5) describe includes summary');
  assert(!desc.includes('\n'), '(5) describe is a single line');

  const descRedacts = describeProposedIntegrationAction(connectedCustomApi, {
    method: 'POST',
    path: '/x',
    summary: 'do it with token=sk-leak12345 please',
  });
  assert(!/sk-leak12345/.test(descRedacts), '(5) describe redacts a leaked token in the summary', descRedacts);

  // ─── (5b) integration.compose_action tool-handler chain ──────────────────
  // Mirrors the pure core of the openswanToolRuntime `integration.compose_action`
  // handler: the model's structured proposal is JSON-stringified, validated
  // against the integration's effective write methods, then mapped to
  // approval-ready custom_api.request args + a preview. (The handler adds the
  // supabase integration-load, which is not tsx-loadable and tested elsewhere.)
  {
    const allowed = effectiveActionMethods(connectedCustomApi);
    assert(allowed.length > 0 && allowed.includes('POST'), '(5b) connected api exposes write methods');
    const goodText = JSON.stringify({ method: 'POST', path: '/issues', body: { title: 'Fix login' }, summary: 'Create an issue' });
    const good = parseIntegrationActionProposal(goodText, { allowedMethods: allowed });
    assert(good.ok, '(5b) valid structured proposal validates');
    if (good.ok) {
      const reqArgs = buildCustomApiRequestArgsFromProposal(connectedCustomApi, good.proposal);
      assertEqual(reqArgs.integrationId, 'int_linear_1', '(5b) request args pin the integration id');
      assertEqual(reqArgs.method, 'POST', '(5b) request args carry the method');
      assertEqual(reqArgs.path, '/issues', '(5b) request args carry the path');
      assertEqual(reqArgs.apiName, 'Linear', '(5b) request args carry apiName');
      const preview = describeProposedIntegrationAction(connectedCustomApi, good.proposal);
      assert(/POST \/issues on Linear/.test(preview), '(5b) preview names the call + api', preview);
    }
    const badHost = parseIntegrationActionProposal(
      JSON.stringify({ method: 'POST', path: 'https://evil.example.com/x', summary: 'x' }),
      { allowedMethods: allowed },
    );
    assert(!badHost.ok, '(5b) absolute-URL path rejected (corrective error)');
    const badMethod = parseIntegrationActionProposal(
      JSON.stringify({ method: 'DELETE', path: '/issues', summary: 'x' }),
      { allowedMethods: ['POST'] as IntegrationActionMethod[] },
    );
    assert(!badMethod.ok, '(5b) method outside allowlist rejected (corrective error)');
    assertEqual(effectiveActionMethods(readOnlyMethodApi).length, 0, '(5b) read-only integration has no write methods → handler blocks');
  }

  // ─── (6) degenerate inputs never throw ───────────────────────────────────
  try {
    // @ts-expect-error intentional bad input
    shouldComposeIntegrationAction(undefined);
    // @ts-expect-error intentional bad input
    shouldComposeIntegrationAction({});
    // @ts-expect-error intentional bad input
    buildIntegrationActionPrompt({ integration: {}, goal: undefined });
    parseIntegrationActionProposal('', { allowedMethods: allowed });
    // @ts-expect-error intentional bad input
    parseIntegrationActionProposal(null, { allowedMethods: allowed });
    // @ts-expect-error intentional bad input
    buildCustomApiRequestArgsFromProposal({ metadata: undefined }, { method: 'POST', path: '/x', summary: 's' });
    // @ts-expect-error intentional bad input
    describeProposedIntegrationAction({}, { method: 'POST', path: '/x', summary: 's' });
    pass('(6) degenerate inputs never throw');
  } catch (err) {
    fail(`(6) degenerate inputs threw: ${(err as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll integration-action-composer smoke cases passed (${passes} passed).`);
}

main();
