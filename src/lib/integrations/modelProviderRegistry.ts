/**
 * Model provider registry — bridges the marketplace catalog to the chat
 * model picker. When a circle has connected an LLM provider integration
 * (OpenRouter, Hugging Face, Replicate, Modal), the chat ⋯ menu surfaces
 * those providers' models alongside the always-available Anthropic ones.
 *
 * The picker stores the user's choice as a `model` string. Anthropic
 * models stay short ("claude-sonnet-4-6"). Provider-routed models are
 * prefixed with the integration's provider key
 * ("openrouter/anthropic/claude-sonnet-4", "huggingface/Qwen/Qwen2.5-72B-Instruct")
 * so the edge function can dispatch to the right API.
 */
import { listCircleIntegrations, type CircleIntegrationProvider } from '../circleIntegrations';
import { listApiKeys, PROVIDER_MODELS, type LLMProvider } from '../llmProviders';
import { getModelsByProvider, refreshModelRegistry, type RegisteredModel } from '../modelRegistry';

export interface ModelOption {
  /** Identifier passed all the way to the edge function. */
  id: string;
  label: string;
  /** Provider key — matches the integration's provider id. */
  provider: string;
  description?: string;
  contextWindow?: number;
  /** True when the underlying credential is wired up. */
  ready: boolean;
}

export interface ModelGroup {
  provider: ModelOption['provider'];
  label: string;
  /** Whether the integration is connected (or, for anthropic, always true). */
  connected: boolean;
  /** Helper text shown when the group is collapsed/disabled. */
  hint?: string;
  models: ModelOption[];
}

const ANTHROPIC_MODELS: Omit<ModelOption, 'ready'>[] = (PROVIDER_MODELS.anthropic || []).map((model) => ({
  id: model.id,
  label: model.label,
  provider: 'anthropic',
  description: `Anthropic | ${model.costTier}`,
  contextWindow: model.contextWindow,
}));

// BlackSwan — our own custom Qwen3.5-4B fine-tune hosted at
// huggingface.co/cswan801/BlackSwan-v5. Routes through the HF
// Inference API endpoint using whatever Hugging Face key the team
// connected in Marketplace, so picking it actually answers from the
// fine-tuned weights (not platform Anthropic). The provider key
// MUST stay "hugging_face" so the edge function's marketplace router
// dispatches it correctly; the group label and visual treatment are
// what make it read as BlackSwan in the picker.
const BLACKSWAN_MODELS: Omit<ModelOption, 'ready'>[] = [
  {
    id: 'huggingface/cswan801/BlackSwan-v5',
    label: 'BlackSwan v5',
    provider: 'hugging_face',
    description: 'Our custom Qwen3.5-4B fine-tune · trained on app data',
    contextWindow: 32_768,
  },
];

// Curated OpenRouter shortlist — used as a fallback if the live catalog
// fetch fails. When the integration is connected we replace this with the
// real catalog (200+ models) fetched from openrouter.ai.
const OPENROUTER_MODELS: Omit<ModelOption, 'ready'>[] = [
  { id: 'openrouter/anthropic/claude-sonnet-4', label: 'Sonnet 4 · OpenRouter', provider: 'openrouter', description: 'Anthropic via OR', contextWindow: 200_000 },
  { id: 'openrouter/anthropic/claude-opus-4', label: 'Opus 4 · OpenRouter', provider: 'openrouter', description: 'Anthropic via OR', contextWindow: 200_000 },
  { id: 'openrouter/openai/gpt-5', label: 'GPT-5', provider: 'openrouter', description: 'OpenAI flagship' },
  { id: 'openrouter/openai/gpt-5-mini', label: 'GPT-5 mini', provider: 'openrouter', description: 'Cheaper, fast' },
  { id: 'openrouter/google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'openrouter', description: 'Long context' },
  { id: 'openrouter/google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'openrouter', description: 'Fast, cheap' },
  { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', provider: 'openrouter', description: 'OSS frontier' },
  { id: 'openrouter/qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B', provider: 'openrouter', description: 'OSS frontier' },
  { id: 'openrouter/x-ai/grok-2', label: 'Grok 2', provider: 'openrouter', description: 'xAI' },
  { id: 'openrouter/deepseek/deepseek-r1', label: 'DeepSeek R1', provider: 'openrouter', description: 'Reasoning OSS' },
];

// 5-minute module-level cache so flipping circles doesn't refetch on every
// open. The catalog is public (no auth required), but it's still ~200KB so
// caching matters for picker latency.
let _openRouterCatalogCache: { fetchedAt: number; models: Omit<ModelOption, 'ready'>[] } | null = null;
const OPENROUTER_CATALOG_TTL_MS = 5 * 60_000;

const OR_PRIMARY_FAMILIES = ['anthropic', 'openai', 'google', 'meta-llama', 'qwen', 'mistralai', 'deepseek', 'x-ai'];
const DIRECT_PROVIDER_REFRESH_TTL_MS = 60 * 60_000;
const _lastDirectProviderRefresh: Partial<Record<LLMProvider, number>> = {};

async function loadLiveOpenRouterCatalog(): Promise<Omit<ModelOption, 'ready'>[] | null> {
  const now = Date.now();
  if (_openRouterCatalogCache && now - _openRouterCatalogCache.fetchedAt < OPENROUTER_CATALOG_TTL_MS) {
    return _openRouterCatalogCache.models;
  }
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) return null;
    const json = await resp.json() as { data?: Array<{
      id: string;
      name?: string;
      description?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }> };
    if (!Array.isArray(json.data)) return null;

    // 200+ models in one flat list overwhelms a chat picker. We rank by
    // family to surface household-name providers first, then alphabetise
    // within each family. Niche/community models still appear — they
    // just sort to the bottom of their family.
    const familyRank = (id: string): number => {
      const family = id.split('/')[0];
      const idx = OR_PRIMARY_FAMILIES.indexOf(family);
      return idx >= 0 ? idx : 999;
    };

    const sorted = [...json.data].sort((a, b) => {
      const ra = familyRank(a.id);
      const rb = familyRank(b.id);
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });

    const fmtPrice = (s?: string): string | null => {
      if (!s) return null;
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n) || n === 0) return null;
      const perM = n * 1_000_000;
      return perM >= 1 ? `$${perM.toFixed(2)}/M` : `$${perM.toFixed(3)}/M`;
    };

    const models: Omit<ModelOption, 'ready'>[] = sorted.map((m) => {
      const family = m.id.split('/')[0];
      const inP = fmtPrice(m.pricing?.prompt);
      const outP = fmtPrice(m.pricing?.completion);
      const priceTag = inP && outP ? `${inP}→${outP}` : inP || outP || '';
      return {
        id: `openrouter/${m.id}`,
        label: m.name || m.id,
        provider: 'openrouter' as const,
        description: priceTag ? `${family} · ${priceTag}` : family,
        contextWindow: m.context_length,
      };
    });

    _openRouterCatalogCache = { fetchedAt: now, models };
    return models;
  } catch {
    return null;
  }
}

const HUGGING_FACE_MODELS: Omit<ModelOption, 'ready'>[] = (PROVIDER_MODELS.huggingface || []).map((model) => ({
  id: `huggingface/${model.id}`,
  label: model.label,
  provider: 'hugging_face',
  description: `HF Router | ${model.costTier}`,
  contextWindow: model.contextWindow,
}));

const REPLICATE_MODELS: Omit<ModelOption, 'ready'>[] = [
  { id: 'replicate/meta/meta-llama-3.1-405b-instruct', label: 'Llama 3.1 405B', provider: 'replicate', description: 'Frontier OSS' },
  { id: 'replicate/anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', provider: 'replicate', description: 'Anthropic via Replicate' },
];

const DIRECT_BYOK_PROVIDERS: Array<{
  userProvider: LLMProvider;
  marketplaceProvider: CircleIntegrationProvider;
  label: string;
  hint: string;
}> = [
  {
    userProvider: 'openai_compatible',
    marketplaceProvider: 'openai_compatible' as CircleIntegrationProvider,
    label: 'Business Models',
    hint: 'Connect a business/self-hosted OpenAI-compatible endpoint in Marketplace for private task and agent models.',
  },
  {
    userProvider: 'openai',
    marketplaceProvider: 'openai',
    label: 'OpenAI',
    hint: 'Connect OpenAI in Marketplace to use GPT and reasoning models with the user-owned key.',
  },
  {
    userProvider: 'groq',
    marketplaceProvider: 'groq',
    label: 'Groq',
    hint: 'Connect Groq in Marketplace for low-latency Llama and Mixtral models.',
  },
  {
    userProvider: 'google_ai',
    marketplaceProvider: 'google_ai',
    label: 'Google AI',
    hint: 'Connect Google AI in Marketplace for Gemini models.',
  },
  {
    userProvider: 'mistral_ai',
    marketplaceProvider: 'mistral_ai',
    label: 'Mistral AI',
    hint: 'Connect Mistral AI in Marketplace for Mistral and Codestral models.',
  },
  {
    userProvider: 'cohere',
    marketplaceProvider: 'cohere',
    label: 'Cohere',
    hint: 'Connect Cohere in Marketplace for Command models, embeddings, and rerank workflows.',
  },
  {
    userProvider: 'perplexity',
    marketplaceProvider: 'perplexity',
    label: 'Perplexity',
    hint: 'Connect Perplexity in Marketplace for Sonar search-grounded models.',
  },
  {
    userProvider: 'together_ai',
    marketplaceProvider: 'together_ai',
    label: 'Together AI',
    hint: 'Connect Together AI in Marketplace for hosted OSS models.',
  },
  {
    userProvider: 'fireworks_ai',
    marketplaceProvider: 'fireworks_ai',
    label: 'Fireworks AI',
    hint: 'Connect Fireworks AI in Marketplace for low-latency OSS inference.',
  },
  {
    userProvider: 'deepseek',
    marketplaceProvider: 'deepseek',
    label: 'DeepSeek',
    hint: 'Connect DeepSeek in Marketplace for chat and reasoner models.',
  },
  {
    userProvider: 'zai',
    marketplaceProvider: 'z_ai',
    label: 'Z.AI / GLM',
    hint: 'Connect Z.AI / GLM in Marketplace for GLM chat models.',
  },
  {
    userProvider: 'minimax',
    marketplaceProvider: 'minimax',
    label: 'MiniMax',
    hint: 'Connect MiniMax in Marketplace for long-context multilingual models.',
  },
  {
    userProvider: 'ollama',
    marketplaceProvider: 'ollama',
    label: 'Ollama',
    hint: 'Connect Ollama in Marketplace with a local base URL for no-cloud model runs.',
  },
];

function directModelsForProvider(userProvider: LLMProvider, marketplaceProvider: string): Omit<ModelOption, 'ready'>[] {
  return (PROVIDER_MODELS[userProvider] || []).map((model) => ({
    id: `${userProvider}/${model.id}`,
    label: model.label,
    provider: marketplaceProvider,
    description: `${userProvider} · ${model.costTier}`,
    contextWindow: model.contextWindow,
  }));
}

function registeredModelsToOptions(
  models: RegisteredModel[],
  userProvider: LLMProvider,
  marketplaceProvider: string,
): Omit<ModelOption, 'ready'>[] {
  const skipRuntimeFamilies = ['transcribe', 'tts', 'realtime', 'audio', 'embedding', 'moderation', 'image', 'dall-e', 'whisper'];
  return models
    .filter((model) => model.category === 'chat' || model.category === 'reasoning' || model.category === 'code')
    .filter((model) => !skipRuntimeFamilies.some((pattern) => model.model_id.toLowerCase().includes(pattern)))
    .map((model) => ({
      id: marketplaceProvider === 'anthropic' ? model.model_id : `${userProvider}/${model.model_id}`,
      label: model.label,
      provider: marketplaceProvider,
      description: `${model.tier}${model.released_at ? ` | released ${model.released_at.slice(0, 10)}` : ''}${model.last_verified_at ? ` | verified ${model.last_verified_at.slice(0, 10)}` : ''}`,
      contextWindow: model.context_window,
    }));
}

function mergeModelOptions<T extends Omit<ModelOption, 'ready'>>(baseModels: T[], liveModels: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const model of [...baseModels, ...liveModels]) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }
  return merged;
}

function businessEndpointModelsFromKeys(keys: Array<{ provider: LLMProvider; label: string | null; endpoint: string | null }>): Omit<ModelOption, 'ready'>[] {
  const endpointHost = (endpoint: string | null): string | null => {
    if (!endpoint) return null;
    try { return new URL(endpoint).host; } catch { return null; }
  };
  return keys
    .filter((key) => key.provider === 'openai_compatible' && !!key.label && key.label !== 'default')
    .map((key) => ({
      id: `openai_compatible/${key.label}`,
      label: key.label || 'Business Model',
      provider: 'openai_compatible',
      description: endpointHost(key.endpoint) ? `Business endpoint | ${endpointHost(key.endpoint)}` : 'Business endpoint',
      contextWindow: 128000,
    }));
}

function maybeRefreshDirectProviderCatalog(provider: LLMProvider) {
  const now = Date.now();
  if (_lastDirectProviderRefresh[provider] && now - _lastDirectProviderRefresh[provider]! < DIRECT_PROVIDER_REFRESH_TTL_MS) {
    return;
  }
  _lastDirectProviderRefresh[provider] = now;
  void refreshModelRegistry(provider).catch(() => {
    // Non-blocking: the static catalog remains available and the next
    // successful refresh will populate model_registry.
  });
}

interface RegistryOpts {
  /** When true, providers without a connected integration are still shown
   *  but with `ready=false` so the picker can grey them out instead of
   *  hiding entirely (helpful for "go connect this" affordances). */
  includeDisconnected?: boolean;
}

export async function loadModelGroups(circleId: string | null | undefined, opts: RegistryOpts = {}): Promise<ModelGroup[]> {
  const groups: ModelGroup[] = [];
  const userApiKeys = await listApiKeys().catch(() => []);
  const activeUserApiProviders = new Set(
    userApiKeys
      .filter((key) => key.isActive)
      .map((key) => key.provider),
  );
  // Accept legacy marketplace provider names if they were saved before
  // the user_api_keys provider catalog was normalised.
  if (activeUserApiProviders.has('hugging_face' as LLMProvider)) activeUserApiProviders.add('huggingface');
  if (activeUserApiProviders.has('z_ai' as LLMProvider)) activeUserApiProviders.add('zai');

  if (activeUserApiProviders.has('openai')) maybeRefreshDirectProviderCatalog('openai');
  if (activeUserApiProviders.has('anthropic')) maybeRefreshDirectProviderCatalog('anthropic');

  const [registeredAnthropicModels, registeredOpenAIModels] = await Promise.all([
    getModelsByProvider('anthropic').catch(() => []),
    getModelsByProvider('openai').catch(() => []),
  ]);
  const anthropicModels = mergeModelOptions(
    ANTHROPIC_MODELS,
    registeredModelsToOptions(registeredAnthropicModels, 'anthropic', 'anthropic'),
  );

  // Anthropic is the native default path, but it still needs the user's
  // own stored key unless the backend explicitly allows platform keys for
  // that account.
  const anthropicReady = activeUserApiProviders.has('anthropic');
  groups.push({
    provider: 'anthropic',
    label: 'Anthropic',
    connected: anthropicReady,
    hint: anthropicReady ? undefined : 'Add your Anthropic key in Marketplace > Models before using Claude chat models.',
    models: anthropicModels.map((model) => ({ ...model, ready: anthropicReady })),
  });

  if (!circleId) return groups;

  const integrations = await listCircleIntegrations(circleId);

  // BlackSwan group — sources from its OWN dedicated Marketplace
  // integration (`blackswan` provider). Connect once, every circle
  // member can chat with the model. The integration carries:
  //   - api_token       (HF user token used to call the endpoint)
  //   - endpoint_url    (dedicated HF Inference Endpoint host)
  //   - model_id        (defaults to cswan801/BlackSwan-v5)
  // Falls back to the HF integration's old `blackswan_endpoint_url`
  // metadata field for circles that wired BlackSwan via the
  // pre-dedicated-card flow — keeps existing setups working.
  const blackswanIntegration = integrations.find(
    (i) => i.provider === 'blackswan' && i.is_active !== false && i.status === 'connected',
  );
  const hfIntegration = integrations.find(
    (i) => i.provider === 'hugging_face' && i.is_active !== false && i.status === 'connected',
  );
  const blackswanEndpointUrl: string | null = (() => {
    const fromBs = blackswanIntegration && (blackswanIntegration.metadata as any)?.endpoint_url;
    if (typeof fromBs === 'string' && fromBs.trim().length > 0) return fromBs.trim();
    const fromHf = hfIntegration && (hfIntegration.metadata as any)?.blackswan_endpoint_url;
    if (typeof fromHf === 'string' && fromHf.trim().length > 0) return fromHf.trim();
    return null;
  })();
  const blackswanModelId: string = (
    (blackswanIntegration && (blackswanIntegration.metadata as any)?.model_id)
    || 'cswan801/BlackSwan-v5'
  );
  // Connected state: the BlackSwan card is the canonical source. If
  // it's connected we're ready. If it's not but the HF fallback
  // covered the URL, we're still ready (legacy setups).
  const blackswanReady = !!blackswanIntegration || (!!hfIntegration && !!blackswanEndpointUrl);

  const blackswanModels: Omit<ModelOption, 'ready'>[] = [
    {
      id: `huggingface/${blackswanModelId}`,
      label: 'BlackSwan v5',
      provider: 'hugging_face',
      description: 'Public Inference API · free, ~30s cold start',
      contextWindow: 32_768,
    },
  ];
  if (blackswanEndpointUrl) {
    blackswanModels.push({
      id: `huggingface_endpoint/${blackswanModelId}`,
      label: 'BlackSwan v5 (Endpoint)',
      provider: 'hugging_face',
      description: 'Dedicated Inference Endpoint · instant, no cold start',
      contextWindow: 32_768,
    });
  }

  groups.push({
    provider: 'blackswan',
    label: 'BlackSwan',
    connected: blackswanReady,
    hint: blackswanReady
      ? (blackswanEndpointUrl
          ? 'Your circle\'s custom-trained model. Endpoint variant is instant; Inference API variant is free with cold-start.'
          : 'Your circle\'s custom-trained model. Add the Endpoint URL in Marketplace → BlackSwan to enable the instant variant.')
      : 'Connect BlackSwan in Marketplace — paste your HF token and the Endpoint URL once and every circle member can chat with the model.',
    models: blackswanModels.map((m) => ({ ...m, ready: blackswanReady })),
  });

  // Three states matter for the picker: connected (ready to use),
  // degraded (connected but the key probe failed — re-validate in the
  // Marketplace), and not-connected (group greyed out with a connect
  // hint). Hiding degraded looks like the user never connected, which
  // is the wrong story.
  const connectedSet = new Set(
    integrations
      .filter((i) => i.is_active !== false && i.status === 'connected')
      .map((i) => i.provider),
  );
  const degradedMessages = new Map<string, string>();
  for (const i of integrations) {
    if (i.is_active !== false && i.status === 'degraded') {
      const reason = (i.metadata as any)?.last_validation_error || 'connection check failed';
      degradedMessages.set(i.provider, reason);
    }
  }

  for (const entry of DIRECT_BYOK_PROVIDERS) {
    const hasUserKey = activeUserApiProviders.has(entry.userProvider);
    const hasCircleIntegration = connectedSet.has(entry.marketplaceProvider);
    const degradedReason = degradedMessages.get(entry.marketplaceProvider);
    const isDegraded = !hasUserKey && !!degradedReason;
    if (!hasUserKey && !hasCircleIntegration && !isDegraded && !opts.includeDisconnected) continue;
    const hint = hasUserKey
      ? 'Uses your encrypted user API key for chat, agents, and model tools.'
      : hasCircleIntegration
        ? 'Circle integration exists, but this user still needs to save their own API key before chat can bill their account.'
        : isDegraded
          ? `Key invalid (${degradedReason}). Re-enter in Marketplace.`
          : entry.hint;
    groups.push({
      provider: entry.marketplaceProvider,
      label: hasUserKey ? entry.label : `${entry.label} - key needed`,
      connected: hasUserKey,
      hint,
      models: mergeModelOptions(
        directModelsForProvider(entry.userProvider, entry.marketplaceProvider),
        entry.userProvider === 'openai_compatible'
          ? businessEndpointModelsFromKeys(userApiKeys)
          : entry.userProvider === 'openai'
          ? registeredModelsToOptions(registeredOpenAIModels, 'openai', 'openai')
          : [],
      ).map((model) => ({ ...model, ready: hasUserKey })),
    });
  }

  // Pull the live OpenRouter catalog when the integration is connected so
  // the picker reflects the real ~200-model lineup (and current prices)
  // rather than a stale 10-item shortlist. Catalog is public, so no auth
  // is needed — we only fetch when the team has actually connected the
  // integration to keep the request budget tight.
  const openRouterConnected = connectedSet.has('openrouter') || activeUserApiProviders.has('openrouter');
  const openRouterModels = openRouterConnected
    ? (await loadLiveOpenRouterCatalog()) || OPENROUTER_MODELS
    : OPENROUTER_MODELS;
  const openRouterLabel = openRouterConnected
    ? `OpenRouter (${openRouterModels.length} models)`
    : 'OpenRouter (100+ models)';

  const providerHydrators: Array<{
    provider: CircleIntegrationProvider;
    label: string;
    models: Omit<ModelOption, 'ready'>[];
    hint: string;
  }> = [
    {
      provider: 'openrouter',
      label: openRouterLabel,
      models: openRouterModels,
      hint: 'Connect OpenRouter in Marketplace to route across Anthropic / OpenAI / Google / OSS via one key.',
    },
    {
      provider: 'hugging_face',
      label: 'Hugging Face',
      models: HUGGING_FACE_MODELS,
      hint: 'Connect Hugging Face in Marketplace for Inference Endpoints.',
    },
    {
      provider: 'replicate',
      label: 'Replicate',
      models: REPLICATE_MODELS,
      hint: 'Connect Replicate in Marketplace for hosted inference.',
    },
  ];

  for (const entry of providerHydrators) {
    const userProvider =
      entry.provider === 'hugging_face' ? 'huggingface'
      : entry.provider === 'replicate' ? 'replicate'
      : entry.provider === 'openrouter' ? 'openrouter'
      : null;
    const isConnected = connectedSet.has(entry.provider) || (userProvider ? activeUserApiProviders.has(userProvider as LLMProvider) : false);
    const degradedReason = degradedMessages.get(entry.provider);
    const isDegraded = !isConnected && !!degradedReason;
    if (!isConnected && !isDegraded && !opts.includeDisconnected) continue;
    const hint = isDegraded
      ? `Key invalid (${degradedReason}). Re-enter in Marketplace.`
      : entry.hint;
    groups.push({
      provider: entry.provider,
      label: isDegraded ? `${entry.label} — DEGRADED` : entry.label,
      connected: isConnected,
      hint,
      models: entry.models.map((m) => ({ ...m, ready: isConnected })),
    });
  }

  return groups;
}

/**
 * Quick lookup: does a model id route through the standard Anthropic
 * platform path (true) or via a provider-specific integration (false)?
 */
export function isAnthropicPlatformModel(modelId: string | null | undefined): boolean {
  if (!modelId || modelId === 'auto') return true;
  return modelId.startsWith('claude-') && !modelId.includes('/');
}

/**
 * Pull the integration provider out of a prefixed model id —
 * "openrouter/anthropic/claude-sonnet-4" → "openrouter".
 * Returns null for native Anthropic models.
 */
export function providerForModel(modelId: string): CircleIntegrationProvider | null {
  if (!modelId || isAnthropicPlatformModel(modelId)) return null;
  const slash = modelId.indexOf('/');
  if (slash <= 0) return null;
  const head = modelId.slice(0, slash);
  return head as CircleIntegrationProvider;
}
