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
  | 'unsupported_provider'
  | 'upstream_error'
  | 'internal';

export interface LLMProxyErrorDetails {
  message: string;
  code?: LLMProxyErrorCode;
  status?: number;
}

const KNOWN_CODES = new Set<LLMProxyErrorCode>([
  'validation',
  'unauthenticated',
  'forbidden',
  'key_missing',
  'credential_unreadable',
  'unsupported_provider',
  'upstream_error',
  'internal',
]);

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

function safePublicMessage(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value : fallback;
  const bounded = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b(?:sk|ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/gi, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}\b/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return bounded || 'The model request could not be completed.';
}

export function normalizeLLMProxyErrorPayload(
  payload: unknown,
  fallbackMessage = 'The model request could not be completed.',
  status?: number,
): LLMProxyErrorDetails {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  return {
    message: safePublicMessage(record?.error, fallbackMessage),
    code: safeCode(record?.code),
    status: safeStatus(status),
  };
}

export async function readLLMProxyInvokeError(error: unknown): Promise<LLMProxyErrorDetails> {
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
    return normalizeLLMProxyErrorPayload(payload, fallbackMessage, status);
  } catch {
    return { message: fallbackMessage, status };
  }
}

export class LLMProxyInvocationError extends Error {
  readonly code?: LLMProxyErrorCode;
  readonly status?: number;

  constructor(details: LLMProxyErrorDetails) {
    super(details.code ? `${details.code}: ${details.message}` : details.message);
    this.name = 'LLMProxyInvocationError';
    this.code = details.code;
    this.status = details.status;
  }
}
