/**
 * custom-api-marketplace-smoketest — pins the universal Custom API connector
 * across the marketplace catalog, validation registry, prompt context, and DB
 * migration guardrail.
 *
 * Run: npm run smoke:custom-api-marketplace
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CIRCLE_INTEGRATION_CATALOG } from '../src/lib/circleIntegrationCatalog';
import { getIntegration, getIntegrationsByCategory, isValidProvider } from '../src/lib/integrations/registry';

let failures = 0;
const root = process.cwd();

function fail(message: string, detail?: unknown) {
  failures += 1;
  console.error('FAIL:', message);
  if (detail !== undefined) console.error('  detail:', JSON.stringify(detail));
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: unknown) {
  if (condition) pass(message);
  else fail(message, detail);
}

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function main() {
  const circleIntegrations = source('src/lib/circleIntegrations.ts');
  const marketplacePrompt = source('src/lib/marketplaceIntegrationContext.ts');
  const swanbotAi = source('supabase/functions/swanbot-ai/index.ts');
  const swanbotV2Ai = source('supabase/functions/swanbot-v2-ai/index.ts');
  const integrationsTab = source('src/screens/circles/tabs/IntegrationsTab.tsx');
  const openswanPlanner = source('src/lib/openswanTaskPlanner.ts');
  const openswanTools = source('src/lib/openswanToolRuntime.ts');
  const recommendations = source('src/lib/marketplaceRecommendations.ts');
  const customApiProxy = source('supabase/functions/custom-api-proxy/index.ts');
  const migrationPath = 'supabase/migrations/20260630_circle_integrations_open_custom_api_provider.sql';
  const migration = source(migrationPath);

  const customApiCatalogItem = CIRCLE_INTEGRATION_CATALOG.find((item) => item.platformKey === 'custom_api');
  const customApiDefinition = getIntegration('custom_api');

  assert(customApiCatalogItem?.id === 'custom-api', 'Catalog exposes Custom API as a marketplace card', customApiCatalogItem);
  assert(customApiCatalogItem?.group === 'workflow_automation', 'Custom API is grouped under workflow automation', customApiCatalogItem);
  assert(isValidProvider('custom_api'), 'Registry accepts custom_api as a valid provider');
  assert(customApiDefinition?.status === 'beta', 'Registry marks Custom API as beta/live-usable', customApiDefinition);
  assert(getIntegrationsByCategory('workflow_automation').some((item) => item.id === 'custom_api'), 'Registry category lookup returns Custom API');

  assert(circleIntegrations.includes("| 'custom_api'"), 'CircleIntegrationProvider union includes custom_api');
  assert(circleIntegrations.includes("custom_api: {"), 'INTEGRATION_DEFINITIONS includes custom_api');
  assert(circleIntegrations.includes("optionalSecretKeys: ['api_key', 'bearer_token'"), 'Custom API secrets are stored as secret keys');
  assert(circleIntegrations.includes("requiredCapabilities.add('custom_api')"), 'Requirement inference recognizes custom API tasks');
  assert(circleIntegrations.includes("warnings.push('Base URL should be a full HTTPS URL"), 'Custom API metadata validates HTTPS base URLs');
  assert(circleIntegrations.includes("authScheme") && circleIntegrations.includes("apiKeyHeaderName"), 'Custom API metadata captures auth scheme and API key header name');
  assert(circleIntegrations.includes("opts.provider === 'custom_api'") && circleIntegrations.includes("initialStatus = 'degraded'"), 'Custom API saves incomplete setup as degraded');
  assert(circleIntegrations.includes("item.provider === 'custom_api'") && circleIntegrations.includes("item.status === 'connected'"), 'Capability preflight only counts connected Custom API integrations');

  assert(integrationsTab.includes("'custom_api'"), 'IntegrationsTab generic marketplace providers include custom_api');
  assert(recommendations.includes("custom_api: 'custom-api'"), 'Marketplace recommendations map custom_api requirements to the card');
  assert(recommendations.includes("custom_api: 'custom_api'"), 'Marketplace recommendations map custom_api to platform key');

  for (const key of ['apiName', 'baseUrl', 'apiDocsUrl', 'defaultEndpoint', 'defaultMethod', 'allowedMethods', 'authScheme', 'apiKeyHeaderName', 'toolNamespace', 'dataBoundary', 'rateLimitPolicy']) {
    assert(marketplacePrompt.includes(`'${key}'`), `Client prompt context allowlists ${key}`);
    assert(swanbotAi.includes(`"${key}"`), `SwanBot edge prompt context allowlists ${key}`);
    assert(swanbotV2Ai.includes(`"${key}"`), `SwanBot v2 integrations.list allowlists ${key}`);
  }

  assert(marketplacePrompt.includes("integration.provider !== 'custom_api'"), 'Client prompt context gives Custom API an ordered metadata summary');
  assert(marketplacePrompt.includes('untrusted_quoted-tag-removed') && marketplacePrompt.includes('replace(/[\\r\\n\\t]+/g'), 'Client prompt context strips metadata fence markers and newlines');
  assert(swanbotAi.includes('provider !== "custom_api"'), 'SwanBot edge prompt context gives Custom API an ordered metadata summary');
  assert(swanbotAi.includes('untrusted_quoted-tag-removed') && swanbotAi.includes('replace(/[\\r\\n\\t]+/g'), 'SwanBot edge prompt context strips metadata fence markers and newlines');
  assert(swanbotV2Ai.includes('untrusted_quoted-tag-removed') && swanbotV2Ai.includes('replace(/[\\r\\n\\t]+/g'), 'SwanBot v2 integrations.list strips metadata fence markers and newlines');
  assert(openswanPlanner.includes('custom api|api connector|rest api|http api'), 'OpenSwan planner recognizes custom API intent');
  assert(openswanPlanner.includes("'custom_api.read'") && openswanPlanner.includes("'custom_api.request'"), 'OpenSwan planner recommends Custom API runtime tools');
  assert(openswanTools.includes("provider === 'custom_api'"), 'OpenSwan integrations.list formats Custom API metadata');
  assert(openswanTools.includes('untrusted_quoted-tag-removed') && openswanTools.includes("replace(/[\\r\\n\\t]+/g"), 'OpenSwan integrations.list strips metadata fence markers and newlines');
  assert(openswanTools.includes('secretishKeyRe'), 'OpenSwan integrations.list redacts secret-shaped metadata keys');
  assert(openswanTools.includes("case 'custom_api.read'") && openswanTools.includes("case 'custom_api.request'"), 'OpenSwan runtime dispatches Custom API proxy tools');
  assert(openswanTools.includes("supabase.functions.invoke('custom-api-proxy'"), 'OpenSwan runtime invokes guarded Custom API proxy');
  assert(openswanTools.includes('fenceUntrustedObservationText(truncateText(preview'), 'OpenSwan runtime fences Custom API response previews');
  assert(swanbotV2Ai.includes('capability_flags, metadata, is_active'), 'SwanBot v2 integrations.list reads the current circle_integrations shape');
  assert(swanbotV2Ai.includes('secretishKeyRe'), 'SwanBot v2 integrations.list redacts secret-shaped metadata keys');

  assert(customApiProxy.includes('Custom API baseUrl must use HTTPS'), 'Custom API proxy enforces HTTPS base URLs');
  assert(customApiProxy.includes('isBlockedHostname'), 'Custom API proxy blocks private/local destinations');
  assert(
    customApiProxy.includes('requireConsumedToolReceipt')
      && customApiProxy.includes('claim_agent_action_call')
      && customApiProxy.includes('dispatchBindingDigest === receipt.authorityBindingDigest'),
    'Custom API proxy verifies and durably claims a consumed v2 approval before write-like requests',
  );
  assert(
    customApiProxy.includes('const approvalReceipt = !readOnly')
      && customApiProxy.includes(': null;')
      && customApiProxy.includes('const dispatchLease = approvalReceipt'),
    'Custom API GET/HEAD stays read-only without consuming or claiming mutation authority',
  );
  assert(customApiProxy.includes('bodyPreview') && customApiProxy.includes('maxBytes'), 'Custom API proxy caps response previews');
  assert(customApiProxy.includes('authorization') && customApiProxy.includes('secret not returned') === false, 'Custom API proxy injects auth server-side without returning secret values');

  assert(existsSync(join(root, migrationPath)), 'Forward migration exists for open-ended circle integration providers');
  assert(migration.includes('DROP CONSTRAINT IF EXISTS circle_integrations_provider_check'), 'Migration drops rigid provider CHECK constraint');
  assert(migration.includes('idx_circle_integrations_provider_lookup'), 'Migration keeps provider lookup indexed');

  if (failures > 0) {
    console.error(`\n${failures} custom-api marketplace smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll custom-api marketplace smoke cases passed.');
}

main();
