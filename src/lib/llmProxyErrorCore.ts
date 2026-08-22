/**
 * Safe client-side normalization for non-2xx `llm-proxy` responses.
 *
 * supabase-js exposes the JSON response on `FunctionsHttpError.context`, while
 * `error.message` is only the generic "Edge Function returned a non-2xx status
 * code" string. Keep the public Edge error code and bounded recovery copy so
 * Chat can distinguish provider setup from an application/runtime defect.
 */

export type LLMProxyErrorCode =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'key_missing'
  | 'credential_unreadable'
  | 'provider_credential_rejected'
  | 'provider_billing_unavailable'
  | 'unsupported_provider'
  | 'upstream_error'
  | 'internal';

/**
 * Provider ids that may be used as Marketplace navigation targets.
 *
 * Keep this list intentionally closed: provider data comes from an HTTP error
 * body, so an arbitrary response value must never become a route/item id.
 */
export type LLMProxyProviderId =
  | 'openai'
  | 'openai_compatible'
  | 'anthropic'
  | 'openrouter'
  | 'groq'
  | 'ollama'
  | 'replicate'
  | 'github-models'
  | 'huggingface'
  | 'zai'
  | 'minimax'
  | 'google_ai'
  | 'mistral_ai'
  | 'cohere'
  | 'perplexity'
  | 'together_ai'
  | 'fireworks_ai'
  | 'deepseek';

export interface LLMProxyErrorDetails {
  message: string;
  code?: LLMProxyErrorCode;
  status?: number;
  /** Safe, allowlisted Marketplace provider id when the request route is known. */
  provider?: LLMProxyProviderId;
}

/**
 * Whether one bounded client retry can plausibly recover the request.
 *
 * Setup, authorization, and validation failures require user or operator
 * action, so retrying them only creates duplicate 4xx traffic. An error with
 * no HTTP status/code is treated as a transport failure and may be retried
 * once by callers that already bound their retry count.
 */
export function shouldRetryLLMProxyFailure(
  details: Pick<LLMProxyErrorDetails, 'code' | 'status'>,
): boolean {
  if (
    details.code === 'validation'
    || details.code === 'unauthenticated'
    || details.code === 'forbidden'
    || details.code === 'key_missing'
    || details.code === 'credential_unreadable'
    || details.code === 'provider_credential_rejected'
    || details.code === 'provider_billing_unavailable'
    || details.code === 'unsupported_provider'
  ) {
    return false;
  }
  if (details.status === 429 || (typeof details.status === 'number' && details.status >= 500)) {
    return true;
  }
  if (details.code === 'upstream_error' || details.code === 'internal') {
    return true;
  }
  return details.status === undefined && details.code === undefined;
}

export interface LLMProxyCredentialRecoveryPresentation {
  message: string;
  actionLabel: string;
  /** Provider to focus after opening Marketplace. Null for an unknown route. */
  providerId: LLMProxyProviderId | null;
  /** Current Marketplace cards use the provider id as their item id. */
  itemId: LLMProxyProviderId | null;
}

export interface LLMProxyProviderAvailabilityPresentation {
  message: string;
  /** Safe, allowlisted provider whose finite cooldown should be applied. */
  providerId: LLMProxyProviderId | null;
}

export type LLMProxyProviderQuarantineKind = 'credential' | 'billing';

const KNOWN_CODES = new Set<LLMProxyErrorCode>([
  'validation',
  'unauthenticated',
  'forbidden',
  'key_missing',
  'credential_unreadable',
  'provider_credential_rejected',
  'provider_billing_unavailable',
  'unsupported_provider',
  'upstream_error',
  'internal',
]);

const KNOWN_PROVIDERS = new Set<LLMProxyProviderId>([
  'openai',
  'openai_compatible',
  'anthropic',
  'openrouter',
  'groq',
  'ollama',
  'replicate',
  'github-models',
  'huggingface',
  'zai',
  'minimax',
  'google_ai',
  'mistral_ai',
  'cohere',
  'perplexity',
  'together_ai',
  'fireworks_ai',
  'deepseek',
]);

const PROVIDER_LABELS: Record<LLMProxyProviderId, string> = {
  openai: 'OpenAI',
  openai_compatible: 'Business Models',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  ollama: 'Ollama',
  replicate: 'Replicate',
  'github-models': 'GitHub Models',
  huggingface: 'Hugging Face',
  zai: 'Z.AI',
  minimax: 'MiniMax',
  google_ai: 'Google AI',
  mistral_ai: 'Mistral AI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  together_ai: 'Together AI',
  fireworks_ai: 'Fireworks AI',
  deepseek: 'DeepSeek',
};

function safeStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function safeCode(value: unknown): LLMProxyErrorCode | undefined {
  return typeof value === 'string' && KNOWN_CODES.has(value as LLMProxyErrorCode)
    ? value as LLMProxyErrorCode
    : undefined;
}

function safeProvider(value: unknown): LLMProxyProviderId | undefined {
  return typeof value === 'string' && KNOWN_PROVIDERS.has(value as LLMProxyProviderId)
    ? value as LLMProxyProviderId
    : undefined;
}

function safePublicMessage(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value : fallback;
  const bounded = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\b(?:sk|ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/gi, '[redacted]')
    .replace(/\bAIza[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}\b/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9+\/_-]{48,}={0,2}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return bounded || 'The model request could not be completed.';
}

export function normalizeLLMProxyErrorPayload(
  payload: unknown,
  fallbackMessage = 'The model request could not be completed.',
  status?: number,
  provider?: unknown,
): LLMProxyErrorDetails {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  return {
    message: safePublicMessage(record?.error ?? record?.message, fallbackMessage),
    code: safeCode(record?.code),
    status: safeStatus(status),
    // An explicit request-route provider is authoritative. Only fall back to a
    // body field when the caller does not know the route.
    provider: safeProvider(provider) ?? safeProvider(record?.provider),
  };
}

/**
 * Parse a bounded HTTP response body and normalize it through the same safe
 * contract used by `supabase.functions.invoke` errors. This keeps direct-fetch
 * clients (notably chat-stream) from losing code/status/provider metadata.
 */
export function normalizeLLMProxyErrorResponseText(
  bodyText: unknown,
  fallbackMessage = 'The model request could not be completed.',
  status?: number,
  provider?: unknown,
): LLMProxyErrorDetails {
  if (typeof bodyText !== 'string' || !bodyText.trim()) {
    return normalizeLLMProxyErrorPayload(null, fallbackMessage, status, provider);
  }

  try {
    return normalizeLLMProxyErrorPayload(JSON.parse(bodyText), fallbackMessage, status, provider);
  } catch {
    return normalizeLLMProxyErrorPayload(null, bodyText, status, provider);
  }
}

/**
 * Convert credential setup failures into stable, secret-free Marketplace UI
 * copy. Other failures return null so callers do not mislabel transport or
 * upstream errors as credential setup problems.
 */
export function getLLMProxyCredentialRecoveryPresentation(
  details: Pick<LLMProxyErrorDetails, 'code' | 'provider'>,
): LLMProxyCredentialRecoveryPresentation | null {
  if (
    details.code !== 'key_missing'
    && details.code !== 'credential_unreadable'
    && details.code !== 'provider_credential_rejected'
  ) return null;

  const providerId = safeProvider(details.provider) ?? null;
  const providerLabel = providerId ? PROVIDER_LABELS[providerId] : 'model provider';
  const unreadable = details.code === 'credential_unreadable';
  const rejected = details.code === 'provider_credential_rejected';

  return {
    message: unreadable
      ? `Your saved ${providerLabel} credential can no longer be read. Reconnect it in Marketplace → AI Models & APIs, then retry.`
      : rejected
        ? `Your saved ${providerLabel} credential was rejected. Reconnect it in Marketplace → AI Models & APIs, then retry.`
      : `Connect your ${providerLabel} API key in Marketplace → AI Models & APIs, then retry.`,
    actionLabel: unreadable || rejected
      ? providerId ? `Reconnect ${providerLabel}` : 'Reconnect provider'
      : providerId ? `Connect ${providerLabel}` : 'Open Marketplace',
    providerId,
    itemId: providerId,
  };
}

/**
 * Present a provider-account billing refusal without mislabeling a valid key
 * as disconnected. The failed turn remains terminal; Chat may exclude this
 * exact provider for a finite period before selecting a different ready route
 * on a new turn.
 */
export function getLLMProxyProviderAvailabilityPresentation(
  details: Pick<LLMProxyErrorDetails, 'code' | 'provider'>,
): LLMProxyProviderAvailabilityPresentation | null {
  if (details.code !== 'provider_billing_unavailable') return null;
  const providerId = safeProvider(details.provider) ?? null;
  const providerLabel = providerId ? PROVIDER_LABELS[providerId] : 'The selected model provider';
  return {
    message: `${providerLabel} could not accept this request because the connected account has no available billing capacity. No other provider was tried in this turn. Send the request again and Chat will prefer another ready connected model when one is available.`,
    providerId,
  };
}

/** Stable credentials stay excluded until the key changes; billing refusals
 * receive a finite cooldown so a newly funded account can recover naturally. */
export function getLLMProxyProviderQuarantineKind(
  details: Pick<LLMProxyErrorDetails, 'code'>,
): LLMProxyProviderQuarantineKind | null {
  if (
    details.code === 'key_missing'
    || details.code === 'credential_unreadable'
    || details.code === 'provider_credential_rejected'
  ) return 'credential';
  return details.code === 'provider_billing_unavailable' ? 'billing' : null;
}

export async function readLLMProxyInvokeError(
  error: unknown,
  provider?: unknown,
): Promise<LLMProxyErrorDetails> {
  const record = error && typeof error === 'object' ? error as Record<string, any> : null;
  const fallbackMessage = safePublicMessage(record?.message, 'The model request could not be completed.');
  const context = record?.context;
  const status = safeStatus(context?.status) || safeStatus(record?.status);

  try {
    const payload = typeof context?.clone === 'function'
      ? await context.clone().json()
      : typeof context?.json === 'function'
        ? await context.json()
        : null;
    return normalizeLLMProxyErrorPayload(payload, fallbackMessage, status, provider);
  } catch {
    return { message: fallbackMessage, status, provider: safeProvider(provider) };
  }
}

export class LLMProxyInvocationError extends Error {
  readonly code?: LLMProxyErrorCode;
  readonly status?: number;
  readonly provider?: LLMProxyProviderId;

  constructor(details: LLMProxyErrorDetails) {
    super(details.code ? `${details.code}: ${details.message}` : details.message);
    this.name = 'LLMProxyInvocationError';
    this.code = details.code;
    this.status = details.status;
    this.provider = details.provider;
  }
}
