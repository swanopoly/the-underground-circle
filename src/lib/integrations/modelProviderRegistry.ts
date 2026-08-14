/**
 * Model provider registry — bridges the marketplace catalog to the chat
 * model picker. When a circle has connected an LLM provider integration
 * (OpenRouter, Hugging Face, Replicate, Modal), the chat ⋯ menu surfaces
 * those providers' models alongside the always-available Anthropic ones.
 *
 * The picker stores the user's choice as a `model` string. Anthropic
 * models stay short ("claude-sonnet-4-6"). Provider-routed models are
 * prefixed with the integration's provider key
 * ("openrouter/anthropic/claude-sonnet-5", "huggingface/Qwen/Qwen2.5-72B-Instruct")
 * so the edge function can dispatch to the right API.
 */
import { listCircleIntegrations, type CircleIntegrationProvider } from '../circleIntegrations';
import {
  createProviderModelCatalogFallback,
  listApiKeys,
  loadProviderModelCatalogSnapshot,
  PROVIDER_MODELS,
  LIVE_MODEL_CATALOG_PROVIDERS,
  type LLMProvider,
  type ProviderModel,
  type ProviderModelCatalogSnapshot,
} from '../llmProviders';
import { getModelsByProvider, refreshModelRegistry, type RegisteredModel } from '../modelRegistry';
import { resolvePlainChatModelRoute } from '../crossProviderRouter';
import {
  buildModelCatalogReadinessProfile,
  projectProviderCatalogModels,
  type ModelCatalogReadinessProfile,
  type ModelCatalogReadinessState,
} from '../modelCatalogReadinessCore';

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
  /** Account inventory evidence behind the option. Curated fallback options
   * remain runnable but are rechecked by the provider when execution starts. */
  availability?: 'account_listed' | 'curated_fallback' | 'connection_required' | 'circle_integration';
}

export interface ModelGroup {
  provider: ModelOption['provider'];
  label: string;
  /** Whether the integration is connected (or, for anthropic, always true). */
  connected: boolean;
  /** Helper text shown when the group is collapsed/disabled. */
  hint?: string;
  /** Do not infer account verification from `connected` or model count. */
  catalogStatus: ModelCatalogReadinessState | 'circle_integration';
  catalogLabel: string;
  catalogVerifiedAt?: string;
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
  { id: 'openrouter/anthropic/claude-sonnet-5', label: 'Sonnet 5 · OpenRouter', provider: 'openrouter', description: 'Balanced Claude agent tier', contextWindow: 1_000_000 },
  { id: 'openrouter/anthropic/claude-opus-5', label: 'Opus 5 · OpenRouter', provider: 'openrouter', description: 'Premium Claude agent tier', contextWindow: 1_000_000 },
  { id: 'openrouter/openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openrouter', description: 'Deep reasoning and coding', contextWindow: 1_050_000 },
  { id: 'openrouter/openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openrouter', description: 'Balanced agentic work', contextWindow: 1_050_000 },
  { id: 'openrouter/openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openrouter', description: 'Fast low-cost worker', contextWindow: 1_050_000 },
  { id: 'openrouter/google/gemini-3.6-flash', label: 'Gemini 3.6 Flash', provider: 'openrouter', description: 'Fast multimodal agent work', contextWindow: 1_048_576 },
  { id: 'openrouter/google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'openrouter', description: 'Low-latency high-volume work', contextWindow: 1_048_576 },
  { id: 'openrouter/google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'openrouter', description: 'Current stable multimodal model' },
  { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', provider: 'openrouter', description: 'OSS frontier' },
  { id: 'openrouter/qwen/qwen3.5-397b-a17b', label: 'Qwen 3.5 397B A17B', provider: 'openrouter', description: 'Current Qwen frontier' },
  { id: 'openrouter/deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'openrouter', description: 'Current DeepSeek reasoning tier' },
];

/** Retired models remain supported by routing/capability compatibility maps so
 * saved conversations can render, but they must not be offered for new picks. */
const RETIRED_DIRECT_MODEL_IDS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1-nano',
  'o3-mini',
  'o4-mini',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-pro-preview',
  'deepseek-chat',
  'deepseek-reasoner',
]);

const DIRECT_PROVIDER_REFRESH_TTL_MS = 60 * 60_000;
const _lastDirectProviderRefresh: Partial<Record<LLMProvider, number>> = {};

const HUGGING_FACE_MODELS: Omit<ModelOption, 'ready'>[] = (PROVIDER_MODELS.huggingface || []).map((model) => ({
  id: `huggingface/${model.id}`,
  label: model.label,
  provider: 'hugging_face',
  description: `HF Router | ${model.costTier}`,
  contextWindow: model.contextWindow,
}));

// Replicate is image/deployment infrastructure in the current runtime, not a
// text-chat route through llm-proxy. Keep the Chat group empty until that
// provider has an actual text adapter; selectable dead ends are worse than a
// smaller truthful catalog.
const REPLICATE_MODELS: Omit<ModelOption, 'ready'>[] = [];

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
    userProvider: 'github-models',
    marketplaceProvider: 'github-models' as CircleIntegrationProvider,
    label: 'GitHub Models',
    hint: 'Connect a GitHub token with models:read to use the account catalog and inference API.',
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

function directModelsForProvider(
  userProvider: LLMProvider,
  marketplaceProvider: string,
  models: readonly ProviderModel[] = PROVIDER_MODELS[userProvider] || [],
): Omit<ModelOption, 'ready'>[] {
  return models.map((model) => ({
    id: `${userProvider}/${model.id}`,
    label: model.label,
    provider: marketplaceProvider,
    description: `${userProvider} · ${model.costTier}`,
    contextWindow: model.contextWindow,
  }));
}

function openRouterModelsForCatalog(models: readonly ProviderModel[]): Omit<ModelOption, 'ready'>[] {
  return models.map((model) => ({
    id: model.id.startsWith('openrouter/') ? model.id : `openrouter/${model.id}`,
    label: model.label,
    provider: 'openrouter',
    description: `${model.source === 'provider' ? 'Available to your account' : 'OpenRouter'} | ${model.costTier}`,
    contextWindow: model.contextWindow,
  }));
}

const LIVE_CATALOG_UI_TIMEOUT_MS = 3500;

async function loadProviderCatalogWithTimeout(
  provider: LLMProvider,
  circleId: string | null | undefined,
): Promise<ProviderModelCatalogSnapshot> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadProviderModelCatalogSnapshot(provider, circleId),
      new Promise<ProviderModelCatalogSnapshot>((resolve) => {
        timeoutId = setTimeout(() => resolve(
          createProviderModelCatalogFallback(provider, 'catalog_timeout'),
        ), LIVE_CATALOG_UI_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function loadConnectedProviderCatalogs(
  activeProviders: ReadonlySet<LLMProvider>,
  circleId: string | null | undefined,
): Promise<Map<LLMProvider, ProviderModelCatalogSnapshot>> {
  const providers = [...activeProviders].filter(
    (provider) => LIVE_MODEL_CATALOG_PROVIDERS.has(provider),
  );
  const pairs = await Promise.all(providers.map(async (provider) => {
    const snapshot = await loadProviderCatalogWithTimeout(provider, circleId);
    return [provider, snapshot] as const;
  }));
  return new Map(pairs);
}

function snapshotForProvider(
  provider: LLMProvider,
  snapshots: ReadonlyMap<LLMProvider, ProviderModelCatalogSnapshot>,
): ProviderModelCatalogSnapshot {
  return snapshots.get(provider)
    || createProviderModelCatalogFallback(provider, 'request_failed');
}

function providerModelsForSnapshot(
  provider: LLMProvider,
  snapshot: ProviderModelCatalogSnapshot,
): ProviderModel[] {
  return projectProviderCatalogModels(
    provider,
    PROVIDER_MODELS[provider] || [],
    snapshot,
  );
}

function optionAvailability(
  profile: ModelCatalogReadinessProfile,
): NonNullable<ModelOption['availability']> {
  if (!profile.connected) return 'connection_required';
  return profile.accountInventoryVerified ? 'account_listed' : 'curated_fallback';
}

function readyModelOptions(
  models: Array<Omit<ModelOption, 'ready'>>,
  connected: boolean,
  profile: ModelCatalogReadinessProfile,
): ModelOption[] {
  const availability = optionAvailability(profile);
  return models.map((model) => ({
    ...model,
    ready: connected,
    availability,
  }));
}

function combinedCatalogHint(
  profile: ModelCatalogReadinessProfile,
  providerHint?: string | null,
): string {
  return [profile.hint, providerHint || ''].filter(Boolean).join(' ');
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
    .filter((model) => !RETIRED_DIRECT_MODEL_IDS.has(model.model_id.toLowerCase()))
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

  // Provider-owned catalogs are account-specific, so load them through the
  // authenticated proxy only for connected keys. Every request is parallel
  // and bounded; a slow/offline provider falls back to the curated rows.
  const liveCatalogs = await loadConnectedProviderCatalogs(
    activeUserApiProviders,
    circleId,
  );

  if (activeUserApiProviders.has('openai')) maybeRefreshDirectProviderCatalog('openai');
  if (activeUserApiProviders.has('anthropic')) maybeRefreshDirectProviderCatalog('anthropic');

  const [registeredAnthropicModels, registeredOpenAIModels] = await Promise.all([
    getModelsByProvider('anthropic').catch(() => []),
    getModelsByProvider('openai').catch(() => []),
  ]);
  // Anthropic is the native default path, but it still needs the user's
  // own stored key unless the backend explicitly allows platform keys for
  // that account.
  const anthropicReady = activeUserApiProviders.has('anthropic');
  const anthropicSnapshot = snapshotForProvider('anthropic', liveCatalogs);
  const anthropicCatalogModels = anthropicReady
    ? providerModelsForSnapshot('anthropic', anthropicSnapshot)
    : PROVIDER_MODELS.anthropic;
  const liveAnthropicModels = anthropicCatalogModels.map((model) => ({
    id: model.id,
    label: model.label,
    provider: 'anthropic',
    description: `${model.source === 'provider' ? 'Listed for your key' : 'Anthropic'} | ${model.costTier}`,
    contextWindow: model.contextWindow,
  }));
  const anthropicModels = mergeModelOptions(
    mergeModelOptions(
      anthropicSnapshot.status === 'verified' ? [] : ANTHROPIC_MODELS,
      liveAnthropicModels,
    ),
    anthropicSnapshot.status === 'verified'
      ? []
      : registeredModelsToOptions(registeredAnthropicModels, 'anthropic', 'anthropic'),
  );
  const anthropicReadiness = buildModelCatalogReadinessProfile({
    connected: anthropicReady,
    snapshotStatus: anthropicSnapshot.status,
    selectableModelCount: anthropicModels.length,
  });
  groups.push({
    provider: 'anthropic',
    label: 'Anthropic',
    connected: anthropicReady,
    hint: anthropicReady
      ? combinedCatalogHint(anthropicReadiness)
      : 'Add your Anthropic key in Marketplace > Models before using Claude chat models.',
    catalogStatus: anthropicReadiness.state,
    catalogLabel: anthropicReadiness.label,
    ...(anthropicSnapshot.status === 'verified' && anthropicSnapshot.fetchedAt
      ? { catalogVerifiedAt: anthropicSnapshot.fetchedAt }
      : {}),
    models: readyModelOptions(anthropicModels, anthropicReady, anthropicReadiness),
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
    catalogStatus: 'circle_integration',
    catalogLabel: blackswanReady ? 'Circle endpoint connected' : 'Not connected',
    models: blackswanModels.map((m) => ({
      ...m,
      ready: blackswanReady,
      availability: blackswanReady ? 'circle_integration' : 'connection_required',
    })),
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
    const catalogSnapshot = snapshotForProvider(entry.userProvider, liveCatalogs);
    const catalogModels = hasUserKey
      ? providerModelsForSnapshot(entry.userProvider, catalogSnapshot)
      : PROVIDER_MODELS[entry.userProvider] || [];
    const chatReadyModels = mergeModelOptions(
      directModelsForProvider(
        entry.userProvider,
        entry.marketplaceProvider,
        catalogModels,
      ),
      entry.userProvider === 'openai_compatible'
        ? businessEndpointModelsFromKeys(userApiKeys)
        : entry.userProvider === 'openai' && catalogSnapshot.status !== 'verified'
        ? registeredModelsToOptions(registeredOpenAIModels, 'openai', 'openai')
        : [],
    ).filter((model) => resolvePlainChatModelRoute(model.id) !== null);

    const catalogReadiness = buildModelCatalogReadinessProfile({
      connected: hasUserKey,
      snapshotStatus: catalogSnapshot.status,
      selectableModelCount: chatReadyModels.length,
    });

    // This registry feeds Chat, Rooms, and agent-spawn selectors. Never show a
    // model unless the browser runtime owns an exact execution route for it.
    // Local Ollama and arbitrary OpenAI-compatible endpoints remain available
    // to guarded OpenSwan/local tools; the hosted edge rejects those targets.
    if (
      chatReadyModels.length === 0
      && !(hasUserKey && catalogSnapshot.status === 'verified')
    ) continue;
    groups.push({
      provider: entry.marketplaceProvider,
      label: hasUserKey ? entry.label : `${entry.label} - key needed`,
      connected: hasUserKey,
      hint: hasUserKey ? combinedCatalogHint(catalogReadiness, hint) : hint,
      catalogStatus: catalogReadiness.state,
      catalogLabel: catalogReadiness.label,
      ...(catalogSnapshot.status === 'verified' && catalogSnapshot.fetchedAt
        ? { catalogVerifiedAt: catalogSnapshot.fetchedAt }
        : {}),
      models: readyModelOptions(chatReadyModels, hasUserKey, catalogReadiness),
    });
  }

  // OpenRouter uses the same authenticated, fixed-endpoint, payload-bounded
  // catalog path as the other direct providers. A circle integration alone is
  // not a valid credential for the direct Chat proxy and must never make a
  // model look ready.
  const openRouterConnected = activeUserApiProviders.has('openrouter');
  const openRouterSnapshot = snapshotForProvider('openrouter', liveCatalogs);
  const openRouterCatalogModels = openRouterConnected
    ? providerModelsForSnapshot('openrouter', openRouterSnapshot)
    : PROVIDER_MODELS.openrouter;
  const projectedOpenRouterModels = openRouterModelsForCatalog(openRouterCatalogModels);
  const openRouterModels = openRouterConnected && openRouterSnapshot.status === 'verified'
    ? projectedOpenRouterModels
    : mergeModelOptions(OPENROUTER_MODELS, projectedOpenRouterModels);
  const openRouterLabel = openRouterConnected
    ? `OpenRouter (${openRouterModels.length} models)`
    : 'OpenRouter (100+ models)';
  const huggingFaceConnected = activeUserApiProviders.has('huggingface');
  const huggingFaceSnapshot = snapshotForProvider('huggingface', liveCatalogs);
  const huggingFaceCatalogModels = huggingFaceConnected
    ? providerModelsForSnapshot('huggingface', huggingFaceSnapshot)
    : PROVIDER_MODELS.huggingface;
  const projectedHuggingFaceModels = directModelsForProvider(
    'huggingface',
    'hugging_face',
    huggingFaceCatalogModels,
  );
  const huggingFaceModels = huggingFaceConnected && huggingFaceSnapshot.status === 'verified'
    ? projectedHuggingFaceModels
    : mergeModelOptions(HUGGING_FACE_MODELS, projectedHuggingFaceModels);

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
      models: huggingFaceModels,
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
    if (entry.models.length === 0) continue;
    const userProvider =
      entry.provider === 'hugging_face' ? 'huggingface'
      : entry.provider === 'replicate' ? 'replicate'
      : entry.provider === 'openrouter' ? 'openrouter'
      : null;
    // These groups route through the authenticated user's model proxy. Keep
    // circle-shared integration readiness out of this decision; otherwise the
    // picker advertises a usable model that the exact user credential lookup
    // cannot call.
    const isConnected = userProvider
      ? activeUserApiProviders.has(userProvider as LLMProvider)
      : connectedSet.has(entry.provider);
    const degradedReason = degradedMessages.get(entry.provider);
    const isDegraded = !isConnected && !!degradedReason;
    if (!isConnected && !isDegraded && !opts.includeDisconnected) continue;
    const providerHint = isDegraded
      ? `Key invalid (${degradedReason}). Re-enter in Marketplace.`
      : entry.hint;
    const catalogSnapshot = userProvider
      ? snapshotForProvider(userProvider, liveCatalogs)
      : createProviderModelCatalogFallback('replicate', 'unsupported_provider');
    const catalogReadiness = buildModelCatalogReadinessProfile({
      connected: isConnected,
      snapshotStatus: catalogSnapshot.status,
      selectableModelCount: entry.models.length,
    });
    groups.push({
      provider: entry.provider,
      label: isDegraded ? `${entry.label} — DEGRADED` : entry.label,
      connected: isConnected,
      hint: isConnected
        ? combinedCatalogHint(catalogReadiness, providerHint)
        : providerHint,
      catalogStatus: catalogReadiness.state,
      catalogLabel: catalogReadiness.label,
      ...(catalogSnapshot.status === 'verified' && catalogSnapshot.fetchedAt
        ? { catalogVerifiedAt: catalogSnapshot.fetchedAt }
        : {}),
      models: readyModelOptions(entry.models, isConnected, catalogReadiness),
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
