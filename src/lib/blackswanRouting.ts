import type { MessageComplexity, MessageIntent } from './agenticCodingProfile';
import type { PromptMemoryReference } from './memoryService';

export const BLACKSWAN_MODEL_ID = 'cswan801/BlackSwan-v5';
export const BLACKSWAN_PUBLIC_MODEL_ID = `huggingface/${BLACKSWAN_MODEL_ID}`;
export const BLACKSWAN_ENDPOINT_MODEL_ID = `huggingface_endpoint/${BLACKSWAN_MODEL_ID}`;
export const BLACKSWAN_TOOL_EXECUTOR_MODEL_ID = 'claude-haiku-4-5';

/**
 * Canonical set of every model id that means "BlackSwan" across the app.
 * Centralizing these here means a future app-trained checkpoint only has to
 * be registered in one place (add its id + classify it as local/hosted) and
 * every BlackSwan-aware code path picks it up.
 *
 * Two distinct routing classes live behind the BlackSwan brand:
 *   - LOCAL: the on-device Ollama `blackswan` weight (runs through the local
 *     `blackswanLLM` bridge, only available on native/desktop).
 *   - HOSTED: the HuggingFace public model + dedicated inference endpoint
 *     (`cswan801/BlackSwan-v5`), which must NOT take the local-Ollama path.
 */
export const BLACKSWAN_LOCAL_OLLAMA_MODEL_IDS = new Set<string>([
  'blackswan',
  'ollama/blackswan',
]);

export const BLACKSWAN_HOSTED_MODEL_IDS = new Set<string>([
  BLACKSWAN_MODEL_ID.toLowerCase(),
  BLACKSWAN_PUBLIC_MODEL_ID.toLowerCase(),
  BLACKSWAN_ENDPOINT_MODEL_ID.toLowerCase(),
]);

/** Every known BlackSwan id (local + hosted), for callers that just need
 *  "is this BlackSwan in any form?" membership without re-deriving it. */
export const BLACKSWAN_MODEL_IDS: ReadonlySet<string> = new Set<string>([
  ...BLACKSWAN_LOCAL_OLLAMA_MODEL_IDS,
  ...BLACKSWAN_HOSTED_MODEL_IDS,
]);

const MARKETPLACE_PREFIX_RE = /^(openai|openai_compatible|openrouter|huggingface|huggingface_endpoint|replicate|github-models|groq|google_ai|mistral_ai|cohere|perplexity|together_ai|fireworks_ai|deepseek|zai|z_ai|minimax|ollama)\//i;

/**
 * True only for the LOCAL Ollama BlackSwan weight. Use this to gate the
 * local `blackswanLLM` bridge path so the HOSTED HuggingFace endpoint id
 * stops being misrouted through on-device Ollama.
 */
export function isLocalOllamaBlackSwan(modelId: string | null | undefined): boolean {
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  if (BLACKSWAN_LOCAL_OLLAMA_MODEL_IDS.has(normalized)) return true;
  // A bare `ollama/<...>blackswan...>` weight is also local, but never treat a
  // huggingface(_endpoint)/ id as local even though it contains "blackswan".
  if (normalized.startsWith('huggingface/') || normalized.startsWith('huggingface_endpoint/')) {
    return false;
  }
  return normalized.startsWith('ollama/') && normalized.includes('blackswan');
}

/**
 * True for the HOSTED BlackSwan model: the HuggingFace public model, the
 * dedicated inference endpoint, or the bare `cswan801/BlackSwan-v5` repo id.
 */
export function isHostedBlackSwanModel(modelId: string | null | undefined): boolean {
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  if (BLACKSWAN_HOSTED_MODEL_IDS.has(normalized)) return true;
  if (normalized.startsWith('huggingface/') || normalized.startsWith('huggingface_endpoint/')) {
    return normalized.includes('blackswan');
  }
  // Bare repo form, e.g. `cswan801/blackswan-v5` (no provider prefix).
  return normalized.includes('cswan801/blackswan');
}

export function isBlackSwanModel(modelId: string | null | undefined): boolean {
  if (isLocalOllamaBlackSwan(modelId) || isHostedBlackSwanModel(modelId)) return true;
  // Backward-compat: the original greedy matcher treated any `*/blackswan*`
  // or `*cswan801/blackswan*` id as BlackSwan. Preserve that so existing
  // callers of this union predicate never lose a match after the split.
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes('/blackswan') || normalized.includes('cswan801/blackswan');
}

export function isMarketplaceRoutedModel(modelId: string | null | undefined): boolean {
  return MARKETPLACE_PREFIX_RE.test((modelId || '').trim());
}

export function isNativeAnthropicModel(modelId: string | null | undefined): boolean {
  return /^claude-/i.test((modelId || '').trim());
}

export function canUseAnthropicChatStream(modelId: string | null | undefined): boolean {
  return isNativeAnthropicModel(modelId) && !isMarketplaceRoutedModel(modelId);
}

export function externalProviderForModel(modelId: string | null | undefined): string | null {
  const model = (modelId || '').trim();
  if (!model || model === 'auto' || model === 'blackswan') return null;
  if (isNativeAnthropicModel(model)) return 'anthropic';
  const slashIdx = model.indexOf('/');
  if (slashIdx > 0) {
    const head = model.slice(0, slashIdx);
    if (head === 'huggingface_endpoint' || head === 'huggingface') return 'huggingface';
    if (head === 'z_ai') return 'zai';
    return head;
  }
  if (/^(gpt-|o\d|codex)/i.test(model)) return 'openai';
  if (/^(gemini|google)/i.test(model)) return 'google_ai';
  if (/^glm-/i.test(model)) return 'zai';
  if (/^minimax/i.test(model)) return 'minimax';
  return 'anthropic';
}

export function shouldUseBlackSwanForAuto(
  intent?: MessageIntent | null,
  complexity?: MessageComplexity | null,
): boolean {
  const level = complexity || 'simple';
  const isLight = level === 'trivial' || level === 'simple';
  const taskIntent = intent || 'question';

  if (taskIntent === 'casual' || taskIntent === 'social' || taskIntent === 'status' || taskIntent === 'memory') {
    return true;
  }

  if (taskIntent === 'question') return isLight;
  if (taskIntent === 'support' || taskIntent === 'task_mgmt') return isLight;

  // Tool-heavy and high-reasoning work should stay on frontier models; BlackSwan
  // can still be injected as context, but should not drive the execution loop.
  return false;
}

export function shouldUseToolExecutorInsteadOfBlackSwan(
  modelId: string | null | undefined,
  runtimeToolNames?: string[] | null,
): boolean {
  return isBlackSwanModel(modelId) && !!runtimeToolNames?.length;
}

export function resolveOpenSwanToolLoopModel(
  modelId: string | null | undefined,
  runtimeToolNames?: string[] | null,
): string {
  if (shouldUseToolExecutorInsteadOfBlackSwan(modelId, runtimeToolNames)) {
    return BLACKSWAN_TOOL_EXECUTOR_MODEL_ID;
  }
  return modelId || BLACKSWAN_TOOL_EXECUTOR_MODEL_ID;
}

export function buildBlackSwanRoutingMetadata(opts: {
  selectedModel?: string | null;
  resolvedModel?: string | null;
  toolLoopModel?: string | null;
  runtimeToolNames?: string[] | null;
}) {
  const blackSwanRequested = isBlackSwanModel(opts.selectedModel) || isBlackSwanModel(opts.resolvedModel);
  const toolExecutorUsed = blackSwanRequested
    && !!opts.runtimeToolNames?.length
    && !!opts.toolLoopModel
    && !isBlackSwanModel(opts.toolLoopModel);

  return {
    selectedModel: opts.selectedModel || null,
    resolvedModel: opts.resolvedModel || null,
    toolLoopModel: opts.toolLoopModel || null,
    blackSwanRequested,
    blackSwanRole: blackSwanRequested
      ? (toolExecutorUsed ? 'grounding_context' : 'primary_model')
      : 'not_used',
    toolExecutorUsed,
    toolExecutorReason: toolExecutorUsed
      ? 'OpenSwan runtime tools require a model with reliable native tool/function calling; BlackSwan remains in the grounding context.'
      : null,
  };
}

export function buildBlackSwanGroundingBlock(opts: {
  model?: string | null;
  intent?: MessageIntent | string | null;
  complexity?: MessageComplexity | string | null;
  memoryReferences?: PromptMemoryReference[] | null;
  source?: 'main_chat' | 'openswan' | 'office' | 'room_chat' | 'task_run';
}): string {
  const refs = (opts.memoryReferences || [])
    .filter((ref) => ref?.title)
    .slice(0, 8);
  const usingBlackSwan = isBlackSwanModel(opts.model);
  const shouldGround = usingBlackSwan || refs.length > 0 || opts.intent === 'status' || opts.intent === 'memory';
  if (!shouldGround) return '';

  const lines = [
    '## BlackSwan App-Grounding Contract',
    `Runtime route: ${opts.model || 'auto'}${usingBlackSwan ? ' (BlackSwan)' : ''}. Surface: ${opts.source || 'main_chat'}.`,
    'Use Underground Circle app data, memory references, mission state, and tool outputs as the highest-priority facts.',
    'Do not invent app state. If a fact is not present in context or tool output, say what is missing or ask to look it up.',
    'Never expose secrets, API keys, vault values, or integration tokens. Mention only connection status and safe metadata.',
  ];

  if (refs.length > 0) {
    lines.push('Memory/source references available this turn:');
    for (const ref of refs) {
      const score = typeof ref.score === 'number' ? ` score=${ref.score.toFixed(2)}` : '';
      const confidence = typeof ref.confidence === 'number' ? ` confidence=${ref.confidence.toFixed(2)}` : '';
      lines.push(`- ${ref.title} [${ref.memoryKind || 'memory'} · ${ref.scope || 'scope'}${score}${confidence}]`);
    }
  }

  return lines.join('\n');
}
