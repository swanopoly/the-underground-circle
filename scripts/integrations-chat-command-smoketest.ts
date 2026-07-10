/**
 * integrations-chat-command-smoketest — guards the `/integrations` chat
 * surface (src/lib/integrationsChatCommand.ts).
 *
 *  1. parse matrix: bare `/integrations` + `/integration` alias → list;
 *     `connect <name>` → connect; `act <goal>` + `do <goal>` alias → act;
 *     trailing `on <name>` → integrationHint; whole-token only
 *     (`/integrationsx` → null); unknown subcommand + missing arg fail closed;
 *     oversized goal fails closed.
 *  2. buildIntegrationsListReply: bounded, groups connected vs not-ready,
 *     honest counts from the records only, no-secret wording, empty case.
 *  3. buildIntegrationsConnectGuide: bounded, uses the injected provider
 *     definition (required keys, honest hints), generic-but-honest fallback
 *     when no definition, and always says secrets go in Marketplace not chat.
 *
 * Pure module — no supabase, no react-native. Run:
 *   npx tsx scripts/integrations-chat-command-smoketest.ts
 */

import {
  MAX_INTEGRATIONS_CONNECT_GUIDE_LENGTH,
  MAX_INTEGRATIONS_GOAL_LENGTH,
  MAX_INTEGRATIONS_LIST_REPLY_LENGTH,
  buildIntegrationsConnectGuide,
  buildIntegrationsListReply,
  parseIntegrationsCommand,
} from '../src/lib/integrationsChatCommand';

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

function main(): void {
  // ─── (1) parse matrix ────────────────────────────────────────────────────
  // list
  const bare = parseIntegrationsCommand('/integrations');
  assert(bare && bare.ok && bare.kind === 'list', '(1) bare /integrations → list');
  const bareAlias = parseIntegrationsCommand('/integration');
  assert(bareAlias && bareAlias.ok && bareAlias.kind === 'list', '(1) /integration alias → list');
  const listVerb = parseIntegrationsCommand('/integrations list');
  assert(listVerb && listVerb.ok && listVerb.kind === 'list', '(1) /integrations list → list');
  const listWhitespace = parseIntegrationsCommand('  /integrations   ');
  assert(listWhitespace && listWhitespace.ok && listWhitespace.kind === 'list', '(1) surrounding whitespace tolerated');

  // whole-token only
  assertEqual(parseIntegrationsCommand('/integrationsx'), null, '(1) /integrationsx → null (not our token)');
  assertEqual(parseIntegrationsCommand('/integrationz act x'), null, '(1) /integrationz → null');
  assertEqual(parseIntegrationsCommand('talking about /integrations'), null, '(1) non-command text → null');
  assertEqual(parseIntegrationsCommand(''), null, '(1) empty input → null');
  assertEqual(parseIntegrationsCommand('/other thing'), null, '(1) different command → null');

  // connect
  const connect = parseIntegrationsCommand('/integrations connect linear');
  assert(connect && connect.ok && connect.kind === 'connect', '(1) connect subcommand → connect');
  if (connect && connect.ok && connect.kind === 'connect') {
    assertEqual(connect.query, 'linear', '(1) connect query captured');
  }
  const connectMulti = parseIntegrationsCommand('/integrations connect my custom crm');
  assert(
    connectMulti && connectMulti.ok && connectMulti.kind === 'connect' && connectMulti.query === 'my custom crm',
    '(1) connect keeps multi-word name',
  );
  const connectNoArg = parseIntegrationsCommand('/integrations connect');
  assert(connectNoArg && !connectNoArg.ok, '(1) connect with no name → fail closed');
  if (connectNoArg && !connectNoArg.ok) assert(/which integration/i.test(connectNoArg.error), '(1) connect error is helpful');

  // act + do alias
  const act = parseIntegrationsCommand('/integrations act create a Linear issue titled Fix login');
  assert(act && act.ok && act.kind === 'act', '(1) act subcommand → act');
  if (act && act.ok && act.kind === 'act') {
    assert(act.goal.includes('create a Linear issue'), '(1) act goal captured');
  }
  const doAlias = parseIntegrationsCommand('/integrations do post a new deploy note');
  assert(doAlias && doAlias.ok && doAlias.kind === 'act', '(1) do alias → act');
  if (doAlias && doAlias.ok && doAlias.kind === 'act') {
    assert(doAlias.goal.includes('post a new deploy note'), '(1) do-alias goal captured');
  }
  const actNoArg = parseIntegrationsCommand('/integrations act');
  assert(actNoArg && !actNoArg.ok, '(1) act with no goal → fail closed');

  // integrationHint tail
  const actHint = parseIntegrationsCommand('/integrations act create an issue on Linear');
  assert(actHint && actHint.ok && actHint.kind === 'act', '(1) act with "on <name>" → act');
  if (actHint && actHint.ok && actHint.kind === 'act') {
    assertEqual(actHint.integrationHint, 'Linear', '(1) trailing "on Linear" → integrationHint');
    assertEqual(actHint.goal, 'create an issue', '(1) hint split out of goal');
  }
  const actNoHint = parseIntegrationsCommand('/integrations act create a report on the sales pipeline for last quarter');
  assert(
    actNoHint && actNoHint.ok && actNoHint.kind === 'act' && actNoHint.integrationHint === undefined,
    '(1) long clause after "on" is NOT treated as a hint',
  );

  // unknown subcommand → fail closed (not guess)
  const unknown = parseIntegrationsCommand('/integrations frobnicate everything');
  assert(unknown && !unknown.ok, '(1) unknown subcommand → fail closed');
  if (unknown && !unknown.ok) assert(/don't recognize|connect|act/i.test(unknown.error), '(1) unknown error shows grammar');

  // oversized goal → fail closed
  const bigGoal = parseIntegrationsCommand(`/integrations act ${'x'.repeat(MAX_INTEGRATIONS_GOAL_LENGTH + 50)}`);
  assert(bigGoal && !bigGoal.ok, '(1) oversized act goal → fail closed');
  if (bigGoal && !bigGoal.ok) assert(/too long/i.test(bigGoal.error), '(1) oversized goal error mentions length');

  // ─── (2) buildIntegrationsListReply ──────────────────────────────────────
  const empty = buildIntegrationsListReply([]);
  assert(empty.length <= MAX_INTEGRATIONS_LIST_REPLY_LENGTH, '(2) empty list reply bounded');
  assert(/none connected/i.test(empty), '(2) empty list is honest about zero connected');
  assert(/Marketplace/i.test(empty), '(2) empty list points to Marketplace');

  const records = [
    { provider: 'custom_api', display_name: 'Linear', label: 'Custom API', status: 'connected', capability_flags: ['write_data'] },
    { provider: 'stripe', display_name: 'Stripe', label: 'Stripe', status: 'connected', capability_flags: ['manage_payments'] },
    { provider: 'github', display_name: 'GitHub', label: 'GitHub', status: 'degraded', capability_flags: ['read_repos'] },
    { provider: 'notion', display_name: 'Notion', label: 'Notion', status: 'planned', capability_flags: [] },
  ] as any;
  const listReply = buildIntegrationsListReply(records);
  assert(listReply.length <= MAX_INTEGRATIONS_LIST_REPLY_LENGTH, '(2) list reply bounded');
  assert(/2 connected of 4/.test(listReply), '(2) list reply has honest counts (2/4)', listReply.slice(0, 60));
  assert(/Connected/.test(listReply) && /Not ready/.test(listReply), '(2) list groups connected vs not-ready');
  assert(listReply.includes('Linear') && listReply.includes('Stripe'), '(2) connected names shown');
  assert(listReply.includes('GitHub') && listReply.includes('Notion'), '(2) not-ready names shown');
  assert(/never in chat|not in chat|Marketplace/i.test(listReply), '(2) list reply keeps secrets-in-Marketplace wording');
  // honest: no invented providers — only names present in records
  assert(!/Salesforce|Shopify|HubSpot/.test(listReply), '(2) list does NOT invent providers not in records');

  // ─── (3) buildIntegrationsConnectGuide ───────────────────────────────────
  const withMeta = buildIntegrationsConnectGuide('linear', {
    provider: 'linear',
    label: 'Linear',
    description: 'Issue tracker for modern dev teams.',
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    validationHints: ['Personal API key from Linear Settings → API. Pin teamKey so issues land in the right team.'],
  });
  assert(withMeta.length <= MAX_INTEGRATIONS_CONNECT_GUIDE_LENGTH, '(3) connect guide bounded');
  assert(withMeta.includes('Linear'), '(3) connect guide names the provider');
  assert(withMeta.includes('api_key'), '(3) connect guide lists the required secret key');
  assert(/Linear Settings/.test(withMeta), '(3) connect guide surfaces the honest validation hint');
  assert(/Marketplace/i.test(withMeta), '(3) connect guide points to Marketplace');
  assert(/never in chat|injected server-side|never sees/i.test(withMeta), '(3) connect guide says secrets never go in chat');

  const noSecretMeta = buildIntegrationsConnectGuide('custom api', {
    provider: 'custom_api',
    label: 'Custom API',
    description: 'Connect any REST API.',
    requiredSecretKeys: [],
    optionalSecretKeys: ['api_key', 'bearer_token'],
    validationHints: ['Start read-only: add base URL and docs first.'],
  });
  assert(noSecretMeta.includes('Custom API'), '(3) custom-api connect guide names it');
  assert(/base URL|connection fields|No required secret/i.test(noSecretMeta), '(3) no-required-secret path handled honestly');
  assert(noSecretMeta.length <= MAX_INTEGRATIONS_CONNECT_GUIDE_LENGTH, '(3) custom-api connect guide bounded');

  const fallback = buildIntegrationsConnectGuide('some-obscure-thing', null);
  assert(fallback.length <= MAX_INTEGRATIONS_CONNECT_GUIDE_LENGTH, '(3) fallback connect guide bounded');
  assert(/Marketplace/i.test(fallback), '(3) fallback still points to Marketplace');
  assert(/never in chat|injected server-side/i.test(fallback), '(3) fallback keeps secrets-off-chat wording');
  assert(/don't have a built-in guide|general flow/i.test(fallback), '(3) fallback is honest that it is generic');
  assert(fallback.includes('some-obscure-thing'), '(3) fallback echoes the requested name');

  // degenerate: never throw
  try {
    buildIntegrationsListReply(undefined as any);
    buildIntegrationsConnectGuide('', undefined);
    parseIntegrationsCommand(undefined as any);
    pass('(3) degenerate inputs never throw');
  } catch (err) {
    fail(`(3) degenerate inputs threw: ${(err as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll integrations-chat-command smoke cases passed (${passes} passed).`);
}

main();
