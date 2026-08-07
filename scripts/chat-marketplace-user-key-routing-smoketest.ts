import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

let passed = 0;
function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
}

const registry = read('src/lib/integrations/modelProviderRegistry.ts');
const marketplace = read('src/screens/circles/tabs/IntegrationsTab.tsx');
const providers = read('src/lib/llmProviders.ts');

check(
  registry.includes("const openRouterConnected = activeUserApiProviders.has('openrouter');"),
  'OpenRouter Chat readiness comes from the current user key',
);
check(
  !registry.includes("connectedSet.has('openrouter') || activeUserApiProviders.has('openrouter')"),
  'a circle integration alone cannot advertise OpenRouter as Chat-ready',
);
check(
  /const isConnected = userProvider\s*\? activeUserApiProviders\.has\(userProvider as LLMProvider\)\s*:\s*connectedSet\.has\(entry\.provider\)/s.test(registry),
  'provider-routed Chat groups require the current user key when one exists',
);

const anthropicBranchStart = marketplace.indexOf("if (provider === 'anthropic')");
const genericConnectStart = marketplace.indexOf('const integration = await connectGenericCircleIntegration', anthropicBranchStart);
check(anthropicBranchStart >= 0, 'Marketplace has a dedicated personal Anthropic connection path');
check(genericConnectStart > anthropicBranchStart, 'personal Anthropic handling precedes the circle integration path');
const anthropicBranch = marketplace.slice(anthropicBranchStart, genericConnectStart);
check(
  anthropicBranch.includes("testApiKey(") && anthropicBranch.includes("'claude-sonnet-4-6'"),
  'Anthropic is preflighted against Claude Sonnet 4.6 before storage',
);
check(
  anthropicBranch.includes("storeApiKey('anthropic', apiKey, 'default', undefined, { notify: false })"),
  'Anthropic is stored under the signed-in user default label',
);
check(
  anthropicBranch.includes("testStoredApiKey(") && anthropicBranch.includes('circleId'),
  'Marketplace probes the stored credential through the authenticated Chat boundary',
);
check(
  anthropicBranch.indexOf('notifyUserApiKeyChanges()') > anthropicBranch.indexOf('testStoredApiKey('),
  'Chat provider readiness refreshes only after the stored-key probe succeeds',
);
check(
  !anthropicBranch.includes('connectGenericCircleIntegration'),
  'the personal Anthropic key is not duplicated into circle integration secrets',
);

check(
  /export async function testStoredApiKey\([\s\S]*?await invokeLLMProxy\(\{[\s\S]*?provider,[\s\S]*?model:/m.test(providers),
  'stored-key validation reuses the normal model proxy',
);
const storedProbe = providers.slice(
  providers.indexOf('export async function testStoredApiKey'),
  providers.indexOf('function getDefaultModel'),
);
check(!storedProbe.includes('api_key'), 'stored-key validation never resends a raw credential');

console.log(`chat-marketplace-user-key-routing smoke: ${passed} passed`);
