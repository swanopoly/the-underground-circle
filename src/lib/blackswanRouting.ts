import type { MessageComplexity, MessageIntent } from './agenticCodingProfile';
import type { PromptMemoryReference } from './memoryService';

export const BLACKSWAN_MODEL_ID = 'cswan801/BlackSwan-v5';
export const BLACKSWAN_PUBLIC_MODEL_ID = `huggingface/${BLACKSWAN_MODEL_ID}`;
export const BLACKSWAN_ENDPOINT_MODEL_ID = `huggingface_endpoint/${BLACKSWAN_MODEL_ID}`;
export const BLACKSWAN_TOOL_EXECUTOR_MODEL_ID = 'claude-haiku-4-5';

const MARKETPLACE_PREFIX_RE = /^(openai|openrouter|huggingface|huggingface_endpoint|replicate|groq|google_ai|mistral_ai|cohere|perplexity|together_ai|fireworks_ai|deepseek|zai|z_ai|minimax|ollama)\//i;

export function isBlackSwanModel(modelId: string | null | undefined): boolean {
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'blackswan'
    || normalized === 'ollama/blackswan'
    || normalized.includes('/blackswan')
    || normalized.includes('cswan801/blackswan');
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
