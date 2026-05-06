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

export interface ModelOption {
  /** Identifier passed all the way to the edge function. */
  id: string;
  label: string;
  /** Provider key — matches the integration's provider id. */
  provider: 'anthropic' | CircleIntegrationProvider;
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

const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', provider: 'anthropic', description: 'Fast, low cost', contextWindow: 200_000, ready: true },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'anthropic', description: 'Balanced', contextWindow: 1_000_000, ready: true },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', provider: 'anthropic', description: 'Deep reasoning', contextWindow: 1_000_000, ready: true },
];

// Curated OpenRouter shortlist — full catalog is 200+ but a chat picker
// shouldn't be a search box on first hit. The user can paste a custom
// OpenRouter slug into the chat composer if they want a niche model.
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

const HUGGING_FACE_MODELS: Omit<ModelOption, 'ready'>[] = [
  { id: 'huggingface/Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B', provider: 'hugging_face', description: 'Inference Endpoints' },
  { id: 'huggingface/meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', provider: 'hugging_face', description: 'Inference Endpoints' },
];

const REPLICATE_MODELS: Omit<ModelOption, 'ready'>[] = [
  { id: 'replicate/meta/meta-llama-3.1-405b-instruct', label: 'Llama 3.1 405B', provider: 'replicate', description: 'Frontier OSS' },
  { id: 'replicate/anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', provider: 'replicate', description: 'Anthropic via Replicate' },
];

interface RegistryOpts {
  /** When true, providers without a connected integration are still shown
   *  but with `ready=false` so the picker can grey them out instead of
   *  hiding entirely (helpful for "go connect this" affordances). */
  includeDisconnected?: boolean;
}

export async function loadModelGroups(circleId: string | null | undefined, opts: RegistryOpts = {}): Promise<ModelGroup[]> {
  const groups: ModelGroup[] = [];

  // Anthropic always available — the platform key is what the chat has
  // historically used and the existing edge function path stays unchanged.
  groups.push({
    provider: 'anthropic',
    label: 'Anthropic',
    connected: true,
    models: ANTHROPIC_MODELS,
  });

  if (!circleId) return groups;

  const integrations = await listCircleIntegrations(circleId);
  const connectedSet = new Set(
    integrations
      .filter((i) => i.is_active !== false && i.status === 'connected')
      .map((i) => i.provider),
  );

  const providerHydrators: Array<{
    provider: CircleIntegrationProvider;
    label: string;
    models: Omit<ModelOption, 'ready'>[];
    hint: string;
  }> = [
    {
      provider: 'openrouter',
      label: 'OpenRouter (100+ models)',
      models: OPENROUTER_MODELS,
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
    const isConnected = connectedSet.has(entry.provider);
    if (!isConnected && !opts.includeDisconnected) continue;
    groups.push({
      provider: entry.provider,
      label: entry.label,
      connected: isConnected,
      hint: entry.hint,
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
