/**
 * edgeInvokeRetry — classify + back off transient failures of the tool loop's
 * per-round edge-function call.
 *
 * The loop's `supabase.functions.invoke('swanbot-ai', …)` fetches the model's
 * next message; tools are dispatched client-side AFTER it returns. So the call
 * is idempotent — retrying it can never double-execute a tool — which makes a
 * bounded retry safe and worthwhile: a single edge cold-start / network blip
 * shouldn't abort a multi-step task mid-loop with "Tool-use call failed."
 *
 * Retry only TRANSIENT failures (network/relay/5xx/429/empty). A clean 4xx or a
 * deterministic edge error is returned immediately — retrying it just wastes
 * time. Pure + side-effect free (except the random jitter) → smoke testable.
 */

export const EDGE_INVOKE_RETRIES = 2; // up to 2 extra attempts after the first

export interface EdgeFailureSignal {
  /** Whether a usable response body came back (a body means: not transient). */
  hasData: boolean;
  errorName?: string | null;
  errorMessage?: string | null;
  status?: number | null;
}

export function isRetryableEdgeFailure(signal: EdgeFailureSignal): boolean {
  if (signal.hasData) return false; // got a response — let the caller handle it
  const name = String(signal.errorName || '');
  const msg = String(signal.errorMessage || '').toLowerCase();
  if (typeof signal.status === 'number') {
    return signal.status >= 500 || signal.status === 429;
  }
  // supabase-js transient classes: FunctionsFetchError (network) / FunctionsRelayError.
  if (/fetch\s*error|relay\s*error/i.test(name)) return true;
  if (/network|timeout|timed out|fetch failed|econn|socket|unavailable|temporar|503|502|504|429|rate limit/i.test(msg)) return true;
  // Empty failure (no data, no usable error info) — treat as a transient blip.
  return !signal.errorName && !signal.errorMessage;
}

/** Exponential backoff with jitter, bounded. attempt is 0-based. */
export function edgeRetryBackoffMs(attempt: number, randomFn: () => number = Math.random): number {
  const base = Math.min(2000, 250 * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(randomFn() * 150);
  return base + jitter;
}
