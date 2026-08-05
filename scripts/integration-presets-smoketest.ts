/**
 * integration-presets-smoketest — the popular-API preset catalog
 * (src/lib/integrationPresets.ts) + its two integration points:
 *   - /integrations connect <known api> → accurate preset guide
 *   - a preset-backed custom_api integration → composer prompt gets real endpoints
 *
 * Enforces the safety envelope: presets only use auth schemes + secret keys the
 * guarded custom-api-proxy actually supports, carry NO secret values, and every
 * example path is relative (no host, no "..").
 *
 * Pure — loads under tsx (integrationPresets + integrationActionComposer +
 * integrationsChatCommand are all import-type-only / pure-data modules).
 */

import {
  INTEGRATION_PRESETS,
  listIntegrationPresets,
  resolveIntegrationPreset,
  matchPresetForApi,
  presetToCustomApiMetadata,
  buildPresetConnectGuide,
  buildPresetEndpointHint,
  describeIntegrationPresetCatalog,
  type IntegrationPreset,
  type PresetAuthScheme,
} from '../src/lib/integrationPresets';
import {
  shouldComposeIntegrationAction,
  buildIntegrationActionPrompt,
} from '../src/lib/integrationActionComposer';
import { buildIntegrationsConnectGuide } from '../src/lib/integrationsChatCommand';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  assert(actual === expected, msg, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

// The ONLY secret keys the guarded proxy reads (custom-api-proxy applyAuth).
const SUPPORTED_AUTH: PresetAuthScheme[] = ['bearer', 'x-api-key', 'basic'];
const SECRET_KEYS_BY_SCHEME: Record<PresetAuthScheme, string[]> = {
  bearer: ['bearer_token'],
  'x-api-key': ['api_key'],
  basic: ['basic_username', 'basic_password'],
};
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function main(): void {
  const all = listIntegrationPresets();

  // ─── (1) catalog integrity + safety envelope ─────────────────────────────
  assert(all.length >= 8, '(1) catalog has a useful number of presets', String(all.length));

  for (const p of all) {
    const tag = `preset ${p.slug}`;
    assert(!!p.slug && p.slug === p.slug.toLowerCase(), `(1) ${tag}: slug is lowercase`);
    assertEqual(INTEGRATION_PRESETS[p.slug], p, `(1) ${tag}: registered under its slug`);
    assert(!!p.label, `(1) ${tag}: has a label`);
    assert(/^https:\/\//.test(p.baseUrl), `(1) ${tag}: baseUrl is https`, p.baseUrl);
    assert(/^https:\/\//.test(p.apiDocsUrl), `(1) ${tag}: apiDocsUrl is https`);
    assert(SUPPORTED_AUTH.includes(p.authScheme), `(1) ${tag}: authScheme is proxy-supported`, p.authScheme);

    // secret keys must match the scheme AND be within the proxy's known set
    assertEqual(
      JSON.stringify(p.requiredSecretKeys),
      JSON.stringify(SECRET_KEYS_BY_SCHEME[p.authScheme]),
      `(1) ${tag}: requiredSecretKeys match the auth scheme`,
    );

    // methods valid; readOnly ⇒ no write methods
    for (const m of p.allowedMethods) assert(VALID_METHODS.has(m), `(1) ${tag}: method ${m} valid`);
    if (p.readOnly) assertEqual(p.allowedMethods.length, 0, `(1) ${tag}: readOnly has no write methods`);

    // placeholder consistency
    if (p.baseUrlPlaceholder) {
      assert(p.baseUrl.includes(p.baseUrlPlaceholder), `(1) ${tag}: placeholder appears in baseUrl`);
    }

    // example endpoints: relative, no host, no traversal
    assert(p.commonActions.length > 0, `(1) ${tag}: has example endpoints`);
    for (const a of p.commonActions) {
      assert(VALID_METHODS.has(a.method), `(1) ${tag}: action method ${a.method} valid`);
      assert(!/^https?:\/\//i.test(a.path), `(1) ${tag}: action path is not a full URL`, a.path);
      assert(!a.path.includes('..'), `(1) ${tag}: action path has no ".."`, a.path);
    }
  }

  // ─── (2) resolveIntegrationPreset ─────────────────────────────────────────
  assertEqual(resolveIntegrationPreset('github')?.slug, 'github', '(2) exact slug');
  assertEqual(resolveIntegrationPreset('GitHub')?.slug, 'github', '(2) label case-insensitive');
  assertEqual(resolveIntegrationPreset('gh')?.slug, 'github', '(2) alias gh');
  assertEqual(resolveIntegrationPreset('jira cloud')?.slug, 'jira', '(2) multiword label');
  assertEqual(resolveIntegrationPreset('atlassian')?.slug, 'jira', '(2) alias atlassian');
  assertEqual(resolveIntegrationPreset('zen desk')?.slug, 'zendesk', '(2) alias zen desk');
  assertEqual(resolveIntegrationPreset('hub spot')?.slug, 'hubspot', '(2) alias hub spot');
  assertEqual(resolveIntegrationPreset('slack web')?.slug, 'slack_web', '(2) slack web api');
  assertEqual(resolveIntegrationPreset('zzz-nope'), null, '(2) unknown → null');
  assertEqual(resolveIntegrationPreset(''), null, '(2) empty → null');
  assertEqual(resolveIntegrationPreset('   '), null, '(2) whitespace → null');

  // ─── (3) presetToCustomApiMetadata (matches proxy + composer contract) ────
  const gh = presetToCustomApiMetadata(INTEGRATION_PRESETS.github);
  assertEqual(gh.authScheme, 'bearer', '(3) github authScheme');
  assertEqual(gh.apiName, 'GitHub', '(3) github apiName');
  assertEqual(gh.baseUrl, 'https://api.github.com', '(3) github baseUrl');
  assert(/\bPOST\b/.test(gh.allowedMethods), '(3) github allowedMethods carries POST', gh.allowedMethods);
  assert(!!gh.defaultEndpoint, '(3) github defaultEndpoint present');
  assert(!!gh.apiDocsUrl, '(3) github apiDocsUrl present');
  // no secret VALUES/keys ever land in metadata
  for (const k of Object.keys(gh)) {
    assert(
      k === 'apiKeyHeaderName' || !SECRET_KEYS_BY_SCHEME.bearer.includes(k),
      '(3) metadata carries no secret key',
      k,
    );
  }

  const stripe = presetToCustomApiMetadata(INTEGRATION_PRESETS.stripe);
  assertEqual(stripe.allowedMethods, 'GET', '(3) stripe (readOnly) → GET only');
  assertEqual(stripe.defaultMethod, 'GET', '(3) stripe defaultMethod GET');
  assertEqual(presetToCustomApiMetadata(INTEGRATION_PRESETS.jira).authScheme, 'basic', '(3) jira basic');

  // ─── (4) matchPresetForApi ────────────────────────────────────────────────
  assertEqual(matchPresetForApi({ baseUrl: 'https://api.github.com/repos/x/y/issues' })?.slug, 'github', '(4) match by host');
  assertEqual(matchPresetForApi({ baseUrl: 'https://acme.atlassian.net/rest/api/3' })?.slug, 'jira', '(4) match placeholder host');
  assertEqual(matchPresetForApi({ apiName: 'Sentry' })?.slug, 'sentry', '(4) match by apiName');
  assertEqual(matchPresetForApi({ baseUrl: 'https://unknown.example.com/v1' }), null, '(4) unknown host → null');
  assertEqual(matchPresetForApi({}), null, '(4) empty → null');

  // ─── (4b) buildPresetEndpointHint (the LIVE integrations.list injection) ──
  const ghHint = buildPresetEndpointHint({ baseUrl: 'https://api.github.com/repos/x/y' });
  assert(!!ghHint && /known GitHub endpoints/i.test(ghHint), '(4b) github hint names the API');
  assert(!!ghHint && /\/repos\//.test(ghHint), '(4b) github hint carries a real path');
  assert(!!ghHint && ghHint.length <= 220, '(4b) hint bounded');
  assert(!!buildPresetEndpointHint({ apiName: 'Sentry' }), '(4b) hint resolves by apiName');
  assertEqual(buildPresetEndpointHint({ baseUrl: 'https://unknown.example.com' }), null, '(4b) unknown → null');
  assertEqual(buildPresetEndpointHint({}), null, '(4b) empty → null');
  assert(!/\b(sk|xox[bp]|ghp|glpat)[-_][A-Za-z0-9]{6,}/.test(ghHint || ''), '(4b) hint has no secret-shaped value');

  // ─── (5) buildPresetConnectGuide ──────────────────────────────────────────
  const ghGuide = buildPresetConnectGuide(INTEGRATION_PRESETS.github);
  assert(ghGuide.length <= 1600, '(5) guide bounded');
  assert(ghGuide.includes('https://api.github.com'), '(5) guide shows base URL');
  assert(ghGuide.includes('bearer_token'), '(5) guide shows the required secret key');
  assert(/Marketplace/i.test(ghGuide), '(5) guide points to Marketplace');
  assert(/never in chat/i.test(ghGuide), '(5) guide keeps secrets off chat');
  assert(/\/repos\/\{owner\}\/\{repo\}\/issues/.test(ghGuide), '(5) guide includes an example endpoint');
  assert(ghGuide.includes('docs.github.com'), '(5) guide links docs');

  const jiraGuide = buildPresetConnectGuide(INTEGRATION_PRESETS.jira);
  assert(/\{site\}/.test(jiraGuide), '(5) jira guide flags the {site} placeholder');
  assert(jiraGuide.includes('basic_username') && jiraGuide.includes('basic_password'), '(5) jira guide lists basic keys');

  const stripeGuide = buildPresetConnectGuide(INTEGRATION_PRESETS.stripe);
  assert(/read-?only|GET/i.test(stripeGuide), '(5) stripe guide signals read-first');

  // no guide leaks a secret-shaped VALUE (there are none — this pins it stays so)
  for (const p of all) {
    const guide = buildPresetConnectGuide(p);
    assert(!/\b(sk|xox[bp]|ghp|Bearer)[-_][A-Za-z0-9]{6,}/.test(guide), `(5) ${p.slug} guide has no secret-shaped value`);
  }

  // ─── (6) describeIntegrationPresetCatalog ─────────────────────────────────
  const catalog = describeIntegrationPresetCatalog();
  assert(catalog.includes('GitHub') && catalog.includes('Stripe'), '(6) catalog lists presets');
  assert(/connect <name>/.test(catalog), '(6) catalog tells you how to get steps');

  // ─── (7) connect-guide integration: preset is a FALLBACK behind providerMeta
  // no providerMeta + known api → preset guide
  const connectGh = buildIntegrationsConnectGuide('github', null);
  assert(connectGh.includes('https://api.github.com'), '(7) connect github (no def) → preset guide');
  // providerMeta present → first-class def wins (preset NOT used)
  const connectWithDef = buildIntegrationsConnectGuide('github', {
    provider: 'custom_api',
    label: 'My GitHub',
    description: 'first-class def',
    requiredSecretKeys: ['api_key'],
  } as any);
  assert(connectWithDef.includes('api_key'), '(7) providerMeta wins over preset');
  // unknown + no def → honest generic
  const connectUnknown = buildIntegrationsConnectGuide('totally-unknown-xyz', null);
  assert(/general flow|don't have a built-in guide/i.test(connectUnknown), '(7) unknown → generic flow');

  // ─── (8) composer integration: preset-backed metadata → endpoints in prompt
  const ghIntegration = {
    provider: 'custom_api' as const,
    status: 'connected' as const,
    metadata: presetToCustomApiMetadata(INTEGRATION_PRESETS.github),
    capability_flags: ['custom_api'],
    display_name: 'GitHub',
    label: 'GitHub',
  };
  assert(
    shouldComposeIntegrationAction({ integration: ghIntegration, goal: 'create an issue about the flaky login test' }),
    '(8) write goal on preset-backed github → compose',
  );
  const prompt = buildIntegrationActionPrompt({
    integration: ghIntegration,
    goal: 'create an issue about the flaky login test',
  });
  assert(/Example endpoints for GitHub/i.test(prompt), '(8) prompt enriched with GitHub endpoints');
  assert(/\/repos\/\{owner\}\/\{repo\}\/issues/.test(prompt), '(8) prompt carries a concrete GitHub path');
  // The prompt names auth words as INSTRUCTIONS ("never include tokens/bearer");
  // the real invariant is that no concrete secret VALUE is present.
  assert(!/\b(sk|xox[bp]|ghp|glpat)[-_][A-Za-z0-9]{6,}/.test(prompt), '(8) prompt carries no secret-shaped value');
  assert(/DO NOT include any auth value|NEVER include Authorization/i.test(prompt), '(8) prompt still forbids auth values');

  // degenerate: never throw
  try {
    buildPresetConnectGuide(INTEGRATION_PRESETS.github);
    presetToCustomApiMetadata(INTEGRATION_PRESETS.stripe);
    resolveIntegrationPreset(undefined as any);
    matchPresetForApi(undefined as any);
    pass('(8) degenerate inputs never throw');
  } catch (err) {
    failures += 1;
    console.error(`FAIL: (8) degenerate inputs threw: ${(err as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll integration-presets smoke cases passed (${passes} passed).`);
}

function pass(_msg: string): void {
  passes += 1;
}

main();
