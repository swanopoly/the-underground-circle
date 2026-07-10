/**
 * swanbotV2Retry — bounded transient-retry for the SwanBot v2 (M2)
 * client-delegation loop (S4 of `SWANBOT_OPENSWAN_CHAT_NEXT_PLAN`).
 *
 * ## Why
 *
 * `callSwanBotV2` runs a continuation loop: the edge returns
 * `{ pending, clientToolCalls }`, the client executes the tools, then
 * POSTs the results back. Before S4, ANY error on a continuation invoke
 * (a one-off 429/5xx/network blip) collapsed the whole in-flight turn to
 * `null` and fell back to v1 — discarding the server's work AND the
 * client tool execution that already ran. A transient blip should be
 * retried, not thrown away.
 *
 * ## What this module is
 *
 * Two pure pieces so the live `swanbot.ts` change stays tiny and the
 * logic is fully smoke-testable (no Supabase, no React Native):
 *
 *   1. `isRetryableInvokeError` — classify a `supabase.functions.invoke`
 *      error as transient (retry) vs structural (bubble). Reuses the
 *      shared provider classifier and adds Supabase-specific shapes.
 *   2. `runWithTransientRetry` — orchestrate bounded exponential-backoff
 *      retry given an attempt that returns a discriminated outcome. The
 *      sleeper is injected so smokes run instantly.
 *
 * Terminal failures (the edge ran and returned an error body, a 4xx, or
 * exhausted retries) resolve to `null` — exactly the value the existing
 * caller already treats as "fall back to v1".
 */

import { isRetryableProviderError } from './agentProviders/fallbackChain';

export type RetryAttemptResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      retryable: boolean;
      /**
       * Optional server `Retry-After` hint (ms) for the NEXT wait. Only used
       * when `retryable` is true; clamped to the cap by the backoff. Omit to
       * fall back to full-jitter exponential backoff.
       */
      retryAfterMs?: number | null;
    };

/**
 * Hard ceiling on any single backoff wait. Even at high attempt counts (or a
 * hostile `Retry-After`) one sleep can never exceed this — keeps the total
 * turn latency bounded. AWS's "Exponential Backoff And Jitter" analysis found
 * *full* jitter (`random(0, cap)`) cut contended call volume by >50% vs. fixed
 * or partial backoff, so that's the schedule we use.
 */
export const TRANSIENT_RETRY_CAP_MS = 20_000;

export interface TransientRetryOptions {
  /** Max RETRIES after the first try. Default 2 (up to 3 attempts total). */
  maxRetries?: number;
  /**
   * Base backoff in ms. The uncapped ceiling for retry n (0-indexed) is
   * `baseDelayMs * 2^n`; the actual wait is `random(0, min(cap, ceiling))`
   * (full jitter). Default 400.
   */
  baseDelayMs?: number;
  /** Hard cap on any single wait. Default {@link TRANSIENT_RETRY_CAP_MS}. */
  capMs?: number;
  /**
   * Jitter source, `[0, 1)`. Injectable so smokes are deterministic; defaults
   * to `Math.random`. Full jitter multiplies this by the capped ceiling.
   */
  rng?: () => number;
  /** Injected sleeper so smoke tests run instantly. Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Fired before each retry sleep with the upcoming (1-based) attempt + delay. */
  onRetry?: (info: { attempt: number; delayMs: number }) => void;
}

/**
 * Full-jitter capped exponential backoff. Pure — exported so smokes can pin
 * the envelope without sleeping. The ceiling doubles per attempt (`base * 2^n`)
 * then plateaus at `cap`; the returned wait is a uniform sample in
 * `[0, min(cap, ceiling)]`. A finite non-negative `retryAfterMs` (server
 * `Retry-After` hint) overrides the computed value but is still clamped to
 * `cap` so a hostile header can't hang the caller.
 */
export function transientBackoffMs(
  attempt: number,
  opts: { baseDelayMs?: number; capMs?: number; rng?: () => number; retryAfterMs?: number | null } = {},
): number {
  const base = Math.max(0, opts.baseDelayMs ?? 400);
  const cap = Math.max(0, opts.capMs ?? TRANSIENT_RETRY_CAP_MS);
  // Server hint wins when present + usable — but never past our own ceiling.
  if (typeof opts.retryAfterMs === 'number' && Number.isFinite(opts.retryAfterMs) && opts.retryAfterMs >= 0) {
    return Math.min(opts.retryAfterMs, cap);
  }
  const rng = opts.rng ?? Math.random;
  const n = Math.max(0, Math.floor(attempt));
  // `2 ** n` can overflow to Infinity at large n; Math.min collapses it to cap.
  const ceiling = Math.min(cap, base * 2 ** n);
  const r = rng();
  const unit = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  return Math.floor(unit * ceiling);
}

/**
 * Run `attempt` with bounded full-jitter exponential-backoff retry on
 * RETRYABLE failures. Returns the success value, or `null` when the attempt
 * fails terminally (non-retryable) or all retries are exhausted. `attempt`
 * receives the 0-based try index and may return a `retryAfterMs` on a
 * retryable failure to honor a server `Retry-After` hint for the next wait.
 * Pure aside from the injected sleeper + jitter source.
 */
export async function runWithTransientRetry<T>(
  attempt: (tryIndex: number) => Promise<RetryAttemptResult<T>>,
  opts: TransientRetryOptions = {},
): Promise<T | null> {
  const maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? 2));
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 400);
  const capMs = Math.max(0, opts.capMs ?? TRANSIENT_RETRY_CAP_MS);
  const rng = opts.rng ?? Math.random;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let tryIndex = 0; tryIndex <= maxRetries; tryIndex += 1) {
    const result = await attempt(tryIndex);
    if (result.ok) return result.value;
    if (!result.retryable) return null;        // structural — don't retry
    if (tryIndex === maxRetries) return null;  // exhausted

    const delayMs = transientBackoffMs(tryIndex, {
      baseDelayMs,
      capMs,
      rng,
      retryAfterMs: result.retryAfterMs,
    });
    try { opts.onRetry?.({ attempt: tryIndex + 1, delayMs }); } catch { /* observer never blocks retry */ }
    await sleep(delayMs);
  }
  return null;
}

/**
 * Classify a `supabase.functions.invoke` error for retry. Transient →
 * `true` (retry); structural → `false` (bubble to null / fall back).
 *
 * Layers, most-specific first:
 *   1. Shared provider classifier (HTTP status fields + message markers).
 *   2. Supabase function-error class names — FunctionsFetchError (network)
 *      and FunctionsRelayError (relay) are transient by nature.
 *   3. FunctionsHttpError carries the Response on `.context`; classify by
 *      its status (429/529/408/5xx retryable; other 4xx structural).
 *   4. Message-level fallback for the Supabase fetch failure string.
 */
export function isRetryableInvokeError(error: unknown): boolean {
  if (!error) return false;
  if (isRetryableProviderError(error)) return true;

  const e = error as { name?: unknown; message?: unknown; context?: unknown };

  const name = typeof e.name === 'string' ? e.name : '';
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return true;

  const ctx = e.context as { status?: unknown } | undefined;
  const status = ctx && typeof ctx.status === 'number' ? ctx.status : undefined;
  if (typeof status === 'number') {
    if (status === 429 || status === 529 || status === 408) return true;
    if (status >= 500 && status <= 599) return true;
    return false; // other 4xx — structural
  }

  const msg = (typeof e.message === 'string' ? e.message : '').toLowerCase();
  if (msg.includes('failed to send a request')) return true; // Supabase network failure

  return false;
}
