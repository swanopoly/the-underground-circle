/**
 * fallbackChain — CA-8f. Wraps N AgentProviders so a failure on the
 * primary falls through to the next. Signatures are identical — from
 * `AgentExecutionCore`'s perspective the chain IS a single provider.
 *
 * ## Why
 *
 * Single-provider (Anthropic direct) = outage equals downtime. When
 * Anthropic hits 529 Overloaded, rate-limits, or 5xx, the chain flips
 * to the next configured provider (e.g. OpenRouter Anthropic proxy or
 * a Google / OpenAI adapter) and retries the *same* turn. Same
 * messages, same tools — the downstream loop doesn't know anything
 * changed.
 *
 * ## What counts as retryable
 *
 * Transient failures that another provider can service:
 *   - HTTP 429 (rate limit) / 529 (overloaded, Anthropic-specific)
 *   - HTTP 5xx
 *   - Network errors (ECONNRESET, timeout, abort)
 *   - Explicit `Overloaded` / `rate_limit_exceeded` / `service_unavailable`
 *     error strings from Anthropic / OpenAI / Google.
 *
 * NOT retryable (bubble immediately):
 *   - HTTP 400 — bad request; no other provider will fix malformed input
 *   - HTTP 401 / 403 — auth; credential issue specific to that provider
 *     (though we still try the NEXT provider with its own credentials —
 *     401 on Anthropic doesn't mean the Gemini key is bad)
 *   - Any tool-side error returned as a tool_result with is_error:true
 *     — those are model-surfaced, not provider failures.
 *
 * ## Observer hook
 *
 * `onFallback({ attempted, error, nextLabel })` lets callers log to
 * telemetry. Fires every time the chain advances — one event per
 * failed provider in the chain.
 *
 * ## Per-call retry within a single provider
 *
 * We do ONE attempt per provider in the chain; if Anthropic returns
 * 529 once we flip, don't thrash. Per-provider retry (exponential
 * backoff within a single provider) is a separate concern and lives
 * inside each provider adapter where it belongs.
 */

import type { AgentProvider, AgentToolDefinition, ProviderTurnResult, AgentMessage } from '../agentExecutionCore';

export interface FallbackProviderEntry {
  /** Short display name for logs / telemetry (e.g. "anthropic.direct"). */
  label: string;
  provider: AgentProvider;
}

export interface FallbackObserver {
  (event: {
    attempted: string;       // label of the provider that just failed
    nextLabel: string | null;// next provider to try, or null if chain exhausted
    error: unknown;
    errorMessage: string;
    statusCode?: number;
  }): void;
}

export interface FallbackChainOptions {
  /** Ordered list of providers — first is primary, rest are fallbacks. */
  providers: FallbackProviderEntry[];
  /** Called whenever the chain advances to the next provider. */
  onFallback?: FallbackObserver;
}

/**
 * Pure classifier — export for smoke tests. Given an unknown error
 * object thrown by a provider, decide whether we should move to the
 * next provider in the chain. Rule-of-thumb: transient = fallback,
 * structural = throw.
 */
export function isRetryableProviderError(err: unknown): boolean {
  if (!err) return false;
  const status = extractStatusCode(err);
  if (typeof status === 'number') {
    if (status === 429 || status === 529) return true;
    if (status >= 500 && status <= 599) return true;
    if (status === 408) return true; // request timeout
    if (status === 503) return true;
    if (status === 504) return true;
    // 400/401/403/404/422 → structural; don't retry
    return false;
  }
  // Network-level errors (no HTTP status).
  const msg = extractErrorMessage(err).toLowerCase();
  if (!msg) return false;
  const retryableMarkers = [
    'overloaded',
    'rate limit',
    'rate_limit',
    'service unavailable',
    'service_unavailable',
    'timeout',
    'etimedout',
    'econnreset',
    'econnrefused',
    'network',
    'fetch failed',
    'socket hang up',
    'aborted',
  ];
  return retryableMarkers.some((m) => msg.includes(m));
}

/**
 * Best-effort HTTP status extraction — different fetch clients / SDKs
 * hang the number off different fields. Checked in order of
 * specificity.
 */
export function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'httpStatus', 'code']) {
    const v = e[key];
    if (typeof v === 'number' && v >= 100 && v <= 599) return v;
  }
  // Anthropic SDK error shape: { response: { status } }
  const resp = e.response as Record<string, unknown> | undefined;
  if (resp && typeof resp.status === 'number') return resp.status;
  return undefined;
}

export function extractErrorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error === 'string') return e.error;
    const nested = e.error as Record<string, unknown> | undefined;
    if (nested && typeof nested.message === 'string') return nested.message;
  }
  try { return String(err); } catch { return ''; }
}

/**
 * Compose a chain into a single AgentProvider. Same contract as any
 * other provider — AgentExecutionCore doesn't know the chain exists.
 */
export function createFallbackProvider(options: FallbackChainOptions): AgentProvider {
  const entries = options.providers.filter((p) => p && p.provider);
  if (entries.length === 0) {
    throw new Error('createFallbackProvider: providers array is empty');
  }

  return {
    async turn(args: {
      messages: AgentMessage[];
      tools: AgentToolDefinition[];
      onDelta?: (text: string) => void;
    }): Promise<ProviderTurnResult> {
      let lastError: unknown = null;
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        try {
          const result = await entry.provider.turn(args);
          return result;
        } catch (err) {
          lastError = err;
          const nextLabel = i + 1 < entries.length ? entries[i + 1].label : null;
          const retryable = isRetryableProviderError(err);
          const isLast = i + 1 >= entries.length;

          if (options.onFallback) {
            try {
              options.onFallback({
                attempted: entry.label,
                nextLabel,
                error: err,
                errorMessage: extractErrorMessage(err),
                statusCode: extractStatusCode(err),
              });
            } catch { /* observer must never mask provider error */ }
          }

          // If the error isn't retryable, bubble immediately — no point
          // trying other providers with the same bad input.
          if (!retryable) throw err;

          // Exhausted the chain — throw the most recent error so the
          // caller can surface a real failure.
          if (isLast) throw err;

          // Continue to next provider. Loop.
        }
      }
      // Unreachable — the for-loop either returns or throws — but keep
      // a final throw to satisfy the type checker.
      throw lastError ?? new Error('fallbackChain: exhausted without result');
    },
  };
}
