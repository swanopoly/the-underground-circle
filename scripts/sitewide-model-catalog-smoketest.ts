/**
 * Site-wide model catalog release gate.
 *
 * Pins the authenticated live-catalog boundary, current direct-provider
 * fallbacks, user-facing selectors, exact routing endpoints, and compatibility
 * policy. This is source-level coverage; it does not claim provider-account
 * entitlement or an Edge deployment.
 *
 * Run: npm run smoke:sitewide-model-catalog
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePlainChatModelRoute } from '../src/lib/crossProviderRouter';
import { getModelCapabilities, getModelCapabilityFlags } from '../src/lib/modelCapabilities';
import { getModelContextWindow } from '../src/lib/modelContextBudgetCore';
import { resolveModelRate } from '../src/lib/modelPricing';

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

function providerBlock(text: string, provider: string): string {
  const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`\\n\\s*['"]?${escaped}['"]?: \\[([\\s\\S]*?)\\n\\s*\\],`))?.[1] || '';
}

const catalogs = source('src/lib/llmProviders.ts');
const pickerRegistry = source('src/lib/integrations/modelProviderRegistry.ts');
const offlineRegistry = source('src/lib/modelRegistry.ts');
const proxy = source('supabase/functions/llm-proxy/index.ts');
const openRouterRankings = source('supabase/functions/openrouter-rankings/index.ts');
const registryEdge = source('supabase/functions/model-registry/index.ts');
const connectionManager = source('src/lib/connectionManager.ts');
const chat = source('src/screens/circles/tabs/ChatTab.tsx');
const rooms = source('src/screens/circles/tabs/RoomsTab.tsx');
const prompts = source('src/screens/circles/tabs/office/PromptManagerPanel.tsx');
const terminal = source('src/components/OfficeTerminal.tsx');
const spawn = source('src/components/SpawnAgentPanel.tsx');
const integrations = source('src/lib/circleIntegrations.ts');
const integrationCatalog = source('src/lib/circleIntegrationCatalog.ts');
const featuredTrades = source('supabase/functions/featured-trades-generator/index.ts');
const v2Batch = source('src/lib/swanbotV2BatchRuntimeCore.ts');
const swanbotEdge = source('supabase/functions/swanbot-ai/index.ts');
const wiki = source('src/lib/wikiData.ts');
const kanbanTypes = source('src/types/kanban.ts');
const llmMarketplace = source('src/components/marketplace/LlmProviderMarketplace.tsx');

const CURRENT_BY_PROVIDER: Record<string, string[]> = {
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-mini', 'o3-pro'],
  anthropic: ['claude-opus-5', 'claude-sonnet-5'],
  groq: ['openai/gpt-oss-120b', 'groq/compound'],
  'github-models': ['openai/gpt-4.1', 'openai/gpt-4.1-mini'],
  zai: ['glm-5.1'],
  minimax: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  google_ai: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
  mistral_ai: ['mistral-medium-3-5', 'mistral-small-2603', 'codestral-2508'],
  cohere: ['command-a-plus-05-2026', 'command-a-reasoning-08-2025'],
  perplexity: ['sonar-deep-research', 'sonar-pro'],
  together_ai: ['MiniMaxAI/MiniMax-M2.7', 'deepseek-ai/DeepSeek-V4-Pro'],
  fireworks_ai: ['accounts/fireworks/models/gpt-oss-120b'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
};

for (const [provider, ids] of Object.entries(CURRENT_BY_PROVIDER)) {
  const block = providerBlock(catalogs, provider);
  assert(block.length > 0, `${provider} has a curated fallback catalog`);
  for (const id of ids) assert(block.includes(`id: '${id}'`), `${provider} includes current model ${id}`);
}

const retiredDirect = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1-nano', 'o3-mini', 'o4-mini',
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'deepseek-chat', 'deepseek-reasoner',
];
for (const id of retiredDirect) {
  const relevant = id.startsWith('gemini')
    ? providerBlock(catalogs, 'google_ai')
    : id.startsWith('deepseek')
      ? providerBlock(catalogs, 'deepseek')
      : providerBlock(catalogs, 'openai');
  assert(!relevant.includes(`id: '${id}'`), `new direct picks exclude retired ${id}`);
}

const listProviders = [
  'openai', 'anthropic', 'openrouter', 'groq', 'github-models', 'huggingface',
  'zai', 'minimax', 'google_ai', 'mistral_ai', 'cohere', 'together_ai',
  'fireworks_ai', 'deepseek',
];
for (const provider of listProviders) {
  const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert(new RegExp(`['"]?${escaped}['"]?\\s*:`).test(proxy), `llm-proxy owns a fixed ${provider} model-list endpoint`);
}
assert(proxy.includes('action?: "chat" | "list_models"'), 'llm-proxy exposes a typed model-list action');
assert(proxy.includes('verifyExactCircleMembership'), 'live catalogs remain behind exact circle membership');
assert(proxy.includes('resolveUserModelApiKey'), 'live catalogs use the authenticated user credential boundary');
assert(proxy.includes('RETIRED_DIRECT_MODELS[provider]?.has'), 'Edge live catalogs reject retired direct IDs');
assert(proxy.includes('NON_CHAT_MODEL_PATTERN.test(id)'), 'Edge live catalogs reject non-chat model families');
assert(proxy.includes('supportedGenerationMethods') && proxy.includes('generateContent'), 'Gemini live catalog requires generateContent support');
assert(proxy.includes('slice(0, 1000)') && proxy.includes('MAX_MODEL_CATALOG_RESPONSE_BYTES = 5_000_000'), 'provider catalogs are row- and payload-bounded');
assert(proxy.includes('response.body.getReader()') && proxy.includes('byteLength > MAX_MODEL_CATALOG_RESPONSE_BYTES'), 'chunked provider catalogs are bounded while streaming, not only by Content-Length');
assert(!proxy.includes('MODEL_LIST_ENDPOINTS[provider] = body'), 'callers cannot supply a model-list endpoint');
assert(openRouterRankings.includes('RETIRED_POPULAR_MODEL_IDS') && openRouterRankings.includes('isAllowedPopularModelId(candidate.id)'), 'live OpenRouter rankings cannot reintroduce known retired model ids');
assert(openRouterRankings.includes('part === "x-ai"') && openRouterRankings.includes('part.startsWith("grok-")'), 'live OpenRouter rankings preserve the project vendor exclusion before returning models');

assert(
  catalogs.includes("const cacheKey = [authority.userId, authority.circleId || '', provider]")
    && catalogs.includes('.map(part => encodeURIComponent(part))'),
  'client live-catalog cache is scoped to exact authenticated user, circle, and provider',
);
assert(catalogs.includes('invalidateProviderModelCatalog();'), 'credential changes clear live model catalogs');
assert(catalogs.includes("action: 'list_models'"), 'client loads provider models through the canonical proxy action');
assert(pickerRegistry.includes('activeUserApiProviders') && pickerRegistry.includes('loadConnectedProviderCatalogs'), 'picker loads live catalogs only from connected user providers');
assert(pickerRegistry.includes('LIVE_CATALOG_UI_TIMEOUT_MS = 3500'), 'live catalog hydration has a bounded UI wait');
assert(pickerRegistry.includes('projectProviderCatalogModels'), 'verified account catalogs and curated fallbacks project through one readiness owner');
assert(!pickerRegistry.includes("fetch('https://openrouter.ai/api/v1/models'"), 'OpenRouter discovery cannot bypass the authenticated bounded catalog proxy');
assert(pickerRegistry.includes("snapshotForProvider('openrouter', liveCatalogs)"), 'OpenRouter account inventory uses the shared typed snapshot path');
assert(pickerRegistry.includes('.filter((model) => resolvePlainChatModelRoute(model.id) !== null)'), 'site-wide selectors omit models without a truthful hosted Chat route');
assert(pickerRegistry.includes("&& !(hasUserKey && catalogSnapshot.status === 'verified')"), 'verified-empty accounts stay visible while unsupported empty providers stay hidden');
assert(offlineRegistry.includes('RETIRED_REGISTERED_MODELS') && offlineRegistry.includes('.filter(isSelectableRegisteredModel)'), 'DB registry results cannot reintroduce retired models');

assert(proxy.includes('https://models.github.ai/inference/chat/completions'), 'GitHub Models uses the current inference endpoint');
assert(connectionManager.includes('https://models.github.ai/inference'), 'connection validation uses the current GitHub Models base URL');

for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'claude-sonnet-5', 'gemini-3.6-flash']) {
  assert(getModelCapabilities(id).includes('text'), `${id} has explicit text capability metadata`);
  assert(getModelCapabilityFlags(id).toolUse, `${id} has explicit tool-use metadata`);
  assert((getModelContextWindow(id) || 0) >= 1_000_000, `${id} has current long-context metadata`);
  assert(resolveModelRate(id).label !== 'Unknown Model', `${id} has explicit cost metadata`);
}
assert(resolveModelRate('gpt-5.6-terra').inPer1M === 3.125, 'Terra UI price uses the corrected $2.50 published input plus buffer');
assert(resolveModelRate('gpt-5.6-luna').inPer1M === 1.25, 'Luna UI price uses the corrected $1.00 published input plus buffer');
assert(registryEdge.includes("id === 'gpt-5.4-mini'"), 'registry refresh prices GPT-5.4 Mini before generic family fallbacks');
assert(proxy.includes('"o3-pro": [20.00, 80.00]'), 'proxy cost telemetry recognizes o3 Pro');
assert(swanbotEdge.indexOf('slug.includes("gpt-5.5")') < swanbotEdge.indexOf('slug.includes("gpt-5") ||'), 'OpenRouter usage pricing checks exact GPT-5.5 before the generic GPT-5 family');

for (const [label, text] of [
  ['Chat', chat],
  ['Rooms playground', rooms],
  ['Office prompts', prompts],
  ['agent spawn', spawn],
] as const) {
  assert(text.includes('gpt-5.6') || text.includes('claude-sonnet-5'), `${label} exposes a current flagship family`);
}
assert(
  terminal.includes("loadModelGroups(circleId, { includeDisconnected: false })")
    && terminal.includes('group.models.filter((item) => item.ready)'),
  'Office terminal exposes current flagship models only through the shared account-checked registry',
);
assert(integrations.includes("placeholder: 'gemini-3.6-flash'"), 'Marketplace Google placeholder is current');
assert(integrations.includes("placeholder: 'deepseek-v4-flash'"), 'Marketplace DeepSeek placeholder is current');
assert(integrations.includes("placeholder: 'MiniMax-M2.7'"), 'Marketplace MiniMax placeholder is current');
assert(integrations.includes("placeholder: 'anthropic/claude-sonnet-5'"), 'Marketplace OpenRouter placeholder points at a current Claude tier');
assert(integrations.includes("placeholder: 'gpt-5.6-terra'"), 'Marketplace OpenAI placeholder points at the balanced current tier');
for (const label of ['GPT-5.6', 'Gemini 3.6 Flash', 'DeepSeek V4 Pro', 'GLM-5.1', 'MiniMax M2.7']) {
  assert(integrationCatalog.includes(label), `Marketplace discovery describes current ${label}`);
}
assert(featuredTrades.includes('GEMINI_RESEARCH_MODEL = "gemini-3.6-flash"'), 'autonomous market research uses the current Gemini model');
assert(v2Batch.includes("'claude-sonnet': 'claude-sonnet-5'") && v2Batch.includes("'claude-opus': 'claude-opus-5'"), 'typed batch floating Claude aliases match the Edge runtime');
assert(chat.includes("key: 'saved:conversation-model'") && chat.includes('Saved model for this conversation'), 'Chat keeps an exact older saved model visible without re-offering it as a new default');
assert(chat.includes("popularModelsSource === 'live' ? 'live OpenRouter weekly rankings' : 'current curated fallback'"), 'Chat never labels its offline popular shortlist as live ranking data');
assert(chat.includes('isAllowedPopularOpenRouterModel(model.id)'), 'Chat applies a second retired/vendor filter to dynamic ranking rows');
for (const label of ['Fable 5', 'Opus 5', 'Sonnet 5', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'Gemini 3.6 Flash', 'Gemini 3.5 Flash-Lite']) {
  assert(wiki.includes(label), `site knowledge cards describe current ${label}`);
}
for (const id of ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']) {
  assert(kanbanTypes.includes(`'${id}'`), `site-wide agent icon metadata recognizes ${id}`);
}
for (const provider of ['openai', 'anthropic', 'openrouter', 'groq', 'github-models', 'google_ai', 'mistral_ai', 'cohere', 'perplexity', 'together_ai', 'fireworks_ai', 'deepseek', 'zai', 'minimax']) {
  assert(llmMarketplace.includes(`id: '${provider}'`), `API-key Marketplace exposes ${provider}`);
}

assert(resolvePlainChatModelRoute('together_ai/Qwen/Qwen3.6-Plus')?.provider === 'together_ai', 'provider-qualified Qwen base pick is executable');
assert(resolvePlainChatModelRoute('mistral_ai/mistral-large-2512')?.provider === 'mistral_ai', 'provider-qualified Mistral base pick is executable');
assert(resolvePlainChatModelRoute('groq/openai/gpt-oss-120b')?.provider === 'groq', 'provider-qualified GPT-OSS base pick is executable');

// Additive rollout: exact saved IDs and the established Auto default remain
// valid. Floating family aliases may advance, but persisted exact IDs do not.
assert(resolvePlainChatModelRoute('auto')?.model === 'claude-sonnet-4-6', 'established exact Auto fallback is not silently migrated');
assert(proxy.includes('"claude-sonnet-4-6": "claude-sonnet-4-6"'), 'Edge keeps the persisted Sonnet 4.6 exact ID');
assert(proxy.includes('"claude-sonnet": "claude-sonnet-5"'), 'floating Sonnet alias advances to the current tier');

if (failed > 0) {
  console.error(`\nsitewide-model-catalog smoke: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`sitewide-model-catalog smoke: ${passed} passed, 0 failed`);
