/**
 * current-model-family-smoketest — one release gate for the exact production
 * model families introduced in August 2026.
 *
 * It intentionally checks every existing owner instead of inventing another
 * catalog: picker, provider catalogs, aliases, capabilities, context, pricing,
 * Auto recommendations, edge allowlists, and Chat's effective-model wiring.
 *
 * Run: npm run smoke:current-model-family
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findAliasKey,
  resolvePlainChatModelRoute,
  resolveProviderRoutes,
} from '../src/lib/crossProviderRouter';
import {
  getModelCapabilities,
  getModelCapabilityFlags,
} from '../src/lib/modelCapabilities';
import { getModelContextWindow } from '../src/lib/modelContextBudgetCore';
import { resolveModelRate } from '../src/lib/modelPricing';
import { resolveModelForSoul } from '../src/lib/serviceProfileSouls';

const root = process.cwd();
let passed = 0;
let failed = 0;

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition: unknown, message: string, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
  if (detail !== undefined) console.error('  detail:', detail);
}

const llmProviders = source('src/lib/llmProviders.ts');
const chat = source('src/screens/circles/tabs/ChatTab.tsx');
const registry = source('src/lib/modelRegistry.ts');
const proxy = source('supabase/functions/llm-proxy/index.ts');
const registryEdge = source('supabase/functions/model-registry/index.ts');
const claudePricing = source('supabase/functions/_claude/anthropic.ts');
const chatStream = source('supabase/functions/chat-stream/index.ts');
const swanbot = source('supabase/functions/swanbot-ai/index.ts');
const swanbotV2 = source('supabase/functions/swanbot-v2-ai/index.ts');
const batchCore = source('src/lib/swanbotV2BatchRuntimeCore.ts');

const CURRENT_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'claude-opus-5',
  'claude-sonnet-5',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
] as const;

for (const id of CURRENT_MODELS) {
  assert(llmProviders.includes(`id: '${id}'`), `${id} exists in the provider catalog`);
  assert(chat.includes(`id: '${id}'`), `${id} exists in the Chat picker`);
  assert(registry.includes(`model_id: '${id}'`), `${id} exists in the registry fallback`);
  assert(findAliasKey(id) === id, `${id} has an exact cross-provider alias`, findAliasKey(id));
  assert(getModelCapabilities(id).includes('text'), `${id} has explicit text capabilities`);
  assert(getModelCapabilityFlags(id).toolUse, `${id} is explicitly tool-capable`);
  assert((getModelContextWindow(id) || 0) >= 1_000_000, `${id} has its verified long context window`, getModelContextWindow(id));
  assert(resolveModelRate(id).label !== 'Unknown Model', `${id} has a non-default price row`);
}

assert(getModelContextWindow('gpt-5.6-sol') === 1_050_000, 'GPT-5.6 context is 1.05M');
assert(getModelContextWindow('gemini-3.6-flash') === 1_048_576, 'Gemini 3.6 context uses the exact published window');
assert(getModelContextWindow('claude-sonnet-5') === 1_000_000, 'Sonnet 5 context is 1M');
assert(getModelCapabilityFlags('claude-sonnet-5').computerUse, 'Sonnet 5 is eligible for the native Claude computer-use loop');
assert(!getModelCapabilityFlags('gpt-5.6-sol').computerUse, 'GPT-5.6 does not claim the Anthropic-only native computer loop');
assert(!getModelCapabilityFlags('gemini-3.6-flash').computerUse, 'Gemini 3.6 does not claim the Anthropic-only native computer loop');

const solRate = resolveModelRate('openrouter/openai/gpt-5.6-sol');
assert(solRate.inPer1M === 6.25 && solRate.outPer1M === 37.5, 'GPT-5.6 Sol UI cost keeps the 25% safety buffer', solRate);
const terraRate = resolveModelRate('gpt-5.6-terra');
assert(terraRate.inPer1M === 3.125 && terraRate.outPer1M === 18.75, 'GPT-5.6 Terra UI cost keeps the 25% safety buffer', terraRate);
const lunaRate = resolveModelRate('gpt-5.6-luna');
assert(lunaRate.inPer1M === 1.25 && lunaRate.outPer1M === 7.5, 'GPT-5.6 Luna UI cost keeps the 25% safety buffer', lunaRate);
const liteRate = resolveModelRate('google/gemini-3.5-flash-lite');
assert(liteRate.inPer1M === 0.375 && liteRate.outPer1M === 3.125, 'Gemini Flash-Lite UI cost keeps the 25% safety buffer', liteRate);

for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const) {
  const routes = resolveProviderRoutes(id, { available: new Set(['openai', 'openrouter']) });
  assert(routes.some((route) => route.provider === 'openai' && route.modelId === id), `${id} has a direct OpenAI route`, routes);
  assert(routes.some((route) => route.provider === 'openrouter' && route.modelId === `openai/${id}`), `${id} has an OpenRouter route`, routes);
}

assert(resolvePlainChatModelRoute('auto')?.model === 'claude-sonnet-4-6', 'existing Chat Auto fallback remains Sonnet 4.6');
assert(
  resolveModelForSoul('sr-engineer', 'claude-sonnet-4-6', 'build', 'complex') === 'claude-sonnet-4-6',
  'a persisted legacy model remains pinned',
);
assert(
  resolveModelForSoul('sr-engineer', 'claude-sonnet-5', 'build', 'complex') === 'claude-sonnet-5',
  'a user-selected current model remains pinned',
);
assert(
  resolveModelForSoul('sr-engineer', 'auto', 'build', 'complex', false, false, new Set(['openai'])) === 'openai/gpt-5.6-sol',
  'connected OpenAI Auto uses Sol for complex builds',
);
assert(
  resolveModelForSoul('writer', 'auto', 'question', 'simple', false, false, new Set(['openai'])) === 'openai/gpt-5.6-terra',
  'connected OpenAI Auto uses Terra for ordinary questions',
);
assert(
  resolveModelForSoul('writer', 'auto', 'casual', 'trivial', false, false, new Set(['openai'])) === 'openai/gpt-5.6-luna',
  'connected OpenAI Auto uses Luna for lightweight turns',
);

const resolvedModelDeclaration = chat.indexOf('let resolvedTurnModel = requestedTurnModel;');
const capabilityCall = chat.indexOf('const capResult = await routeByCapability(');
const sendAssignment = chat.indexOf('let sendModel = resolvedTurnModel;');
assert(resolvedModelDeclaration >= 0, 'Chat resolves one concrete, catalog-replaceable model before dispatch');
assert(capabilityCall > resolvedModelDeclaration, 'capability routing happens after concrete model resolution');
assert(sendAssignment > capabilityCall, 'transport starts from the already-resolved model before the immutable dispatch seal');
const capabilitySlice = chat.slice(capabilityCall, capabilityCall + 280);
assert(capabilitySlice.includes('resolvedTurnModel || effectiveSelectedModel'), 'capability routing never receives raw Auto when resolution succeeds');
assert(chat.includes('m.content.slice(-2000)'), 'latest assistant context keeps its tail for continuation');
assert(!chat.includes('m.content.slice(0, mi === lastBotMessageIdx ? 2000 : 300)'), 'the stale latest-message prefix bug is gone');

for (const id of ['claude-opus-5', 'claude-sonnet-5']) {
  for (const [label, text] of [
    ['llm-proxy', proxy],
    ['chat-stream', chatStream],
    ['swanbot-ai', swanbot],
    ['swanbot-v2-ai', swanbotV2],
    ['v2 batch mirror', batchCore],
    ['shared Claude pricing', claudePricing],
  ] as const) {
    assert(text.includes(id), `${label} recognizes ${id}`);
  }
}

for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
  assert(proxy.includes(`"${id}"`), `llm-proxy has exact cost metadata for ${id}`);
  assert(registryEdge.includes(`id === '${id}'`), `registry refresh has exact pricing for ${id}`);
}
assert(proxy.includes('const isDirectGpt56 = provider === "openai"'), 'direct GPT-5.6 uses a provider-specific request adapter');
assert(proxy.includes('requestBody.reasoning_effort'), 'direct GPT-5.6 maps UC thinking level to reasoning effort');
assert(proxy.includes('requestBody.temperature = temperature'), 'legacy/OpenAI-compatible models retain the existing temperature path');
assert(proxy.includes('} else if (provider !== "google_ai") {'), 'current Gemini requests omit deprecated temperature and sampling controls');

if (failed > 0) {
  console.error(`\ncurrent-model-family smoke: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`current-model-family smoke: ${passed} passed, 0 failed`);
