/**
 * providerHealthRegistry — health-aware PRE-selection for the
 * cross-provider router (CHAT_AGENT_ARCHITECTURE_IMPROVEMENT_PLAN #9,
 * "provider fallback kit"; LiteLLM / OpenRouter cooldown patterns).
 *
 * ─── What this does ─────────────────────────────────────────────────
 * Keeps a small in-memory record of how each provider has behaved
 * recently, so the router can put a provider that *just* failed at the
 * BACK of the try order for the next request. That is all: it changes
 * ORDER, it never removes a provider and it never suppresses an error.
 *
 * ─── The house invariant it must NOT break: FAIL-VISIBLE ────────────
 * The app surfaces provider errors to the user. This registry is used
 * for **PRE-selection only** — choosing a healthier provider order
 * BEFORE a request goes out. It is explicitly NOT a silent
 * mid-request failover layer:
 *
 *   - It observes outcomes AFTER a call is made (via
 *     `recordProviderOutcome`, wired at the call site).
 *   - It reorders FUTURE attempts (via `excludeCoolingProviders`).
 *   - A surfaced provider error is STILL surfaced. Nothing here
 *     catches, swallows, retries, or hides an error from the caller.
 *
 * The router's real runtime consumer (`universalInvoke.executeRouteChain`)
 * keeps re-throwing the last error exactly as before. This module only
 * influences the ORDER of the route list that consumer walks.
 *
 * ─── Purity / testability ───────────────────────────────────────────
 * No I/O, no imports of react-native, no `Date.now()` reads inside the
 * hot logic — every function that cares about time takes an explicit
 * `nowMs`. That keeps it deterministically smoke-testable (see
 * `scripts/fallback-chain-smoketest.ts`). The one convenience helper
 * that reads the wall clock (`recordProviderOutcomeNow`) is a thin
 * shim callers may use in production; tests use the injectable form.
 */

/**
 * How we bucket a provider failure. The class decides whether the
 * failure is a *provider-health* signal (cool the provider down) or a
 * *request-specific* signal (do NOT cool down — a different request
 * may well succeed on the same provider).
 */
import { backoffWindowMs } from './providerBackoffCore';

export type ProviderErrorClass =
  | 'rate_limit'       // 429 / "rate limit" — provider is throttling us right now
  | 'overload'         // 529 / 503 / "overloaded" — provider is saturated
  | 'context_overflow' // input too large for the model — request-specific, NOT health
  | 'content_policy'   // safety refusal / moderation — request-specific, NOT health
  | 'auth'             // 401 / 403 / bad key — config problem, NOT transient health
  | 'transient'        // 5xx / timeout / network reset — provider-side wobble
  | 'other';           // unclassified

/**
 * class → cooldown decision table. `true` means "a failure of this
 * class means the provider itself is unhealthy right now, so
 * deprioritize it for the cooldown window". `false` means "this failure
 * is about THIS request, not the provider's health — leave the
 * provider's order alone so an unrelated request isn't penalized".
 *
 *   rate_limit       → cool down  (provider is throttling us)
 *   overload         → cool down  (provider is saturated)
 *   transient        → cool down  (provider-side 5xx / network wobble)
 *   context_overflow → NO         (our prompt was too big — provider is fine)
 *   content_policy   → NO         (moderation refusal — request-specific)
 *   auth             → NO         (bad/again-missing key — reordering won't help,
 *                                  and every request would hit it; surface it)
 *   other            → NO         (unknown — don't punish on a signal we can't read)
 */
export const COOLDOWN_BY_CLASS: Readonly<Record<ProviderErrorClass, boolean>> = Object.freeze({
  rate_limit: true,
  overload: true,
  transient: true,
  context_overflow: false,
  content_policy: false,
  auth: false,
  other: false,
});

/** Default cooldown window. A provider that had a disqualifying
 *  failure within this many ms of `nowMs` is considered "cooling down"
 *  and gets pushed to the back of the try order. ~30s per the
 *  LiteLLM/OpenRouter pattern and the plan note. */
export const DEFAULT_COOLDOWN_MS = 30_000;

/** Registry caps — bound memory hard. We never track more than
 *  MAX_PROVIDERS distinct providers, and we keep at most
 *  MAX_EVENTS_PER_PROVIDER recent events each (a ring buffer). Both are
 *  small: the provider set is finite and we only need the most recent
 *  failures to answer "is this cooling down right now?". */
export const MAX_PROVIDERS = 64;
export const MAX_EVENTS_PER_PROVIDER = 16;

export interface ProviderOutcome {
  ok: boolean;
  /** Present when `ok === false`. Omitted / ignored on success. */
  errorClass?: ProviderErrorClass;
}

interface HealthEvent {
  atMs: number;
  ok: boolean;
  errorClass?: ProviderErrorClass;
}

/** provider id → bounded ring of recent events (newest last). */
const registry = new Map<string, HealthEvent[]>();

/**
 * Record one observed provider outcome. Call this from the code that
 * ALREADY sees success/failure per route (the router's runtime
 * consumer). Pure w.r.t. time — caller injects `nowMs`.
 *
 * NOTE (fail-visible): recording an outcome does not change what the
 * caller does with an error. The caller still surfaces the error. This
 * only updates the health ring so the NEXT request can be ordered
 * better.
 */
export function recordProviderOutcome(
  provider: string,
  outcome: ProviderOutcome,
  nowMs: number,
): void {
  const key = (provider || '').trim();
  if (!key) return;

  let ring = registry.get(key);
  if (!ring) {
    // Enforce the provider cap. If we're at the ceiling and this is a
    // brand-new provider, evict the provider whose newest event is
    // oldest (least-recently-active) to make room — keeps the map
    // bounded without unbounded growth on churny provider ids.
    if (registry.size >= MAX_PROVIDERS) {
      evictStalestProvider(nowMs);
    }
    ring = [];
    registry.set(key, ring);
  }

  ring.push({
    atMs: nowMs,
    ok: outcome.ok,
    errorClass: outcome.ok ? undefined : (outcome.errorClass ?? 'other'),
  });

  // Ring-buffer trim: keep only the most recent MAX_EVENTS_PER_PROVIDER.
  if (ring.length > MAX_EVENTS_PER_PROVIDER) {
    ring.splice(0, ring.length - MAX_EVENTS_PER_PROVIDER);
  }
}

/** Convenience wall-clock shim for production callers that don't have a
 *  clock to inject. Tests should prefer the injectable `recordProviderOutcome`. */
export function recordProviderOutcomeNow(provider: string, outcome: ProviderOutcome): void {
  recordProviderOutcome(provider, outcome, Date.now());
}

function evictStalestProvider(nowMs: number): void {
  let stalestKey: string | null = null;
  let stalestNewest = Infinity;
  for (const [key, ring] of registry) {
    const newest = ring.length ? ring[ring.length - 1].atMs : -Infinity;
    if (newest < stalestNewest) {
      stalestNewest = newest;
      stalestKey = key;
    }
  }
  if (stalestKey != null) registry.delete(stalestKey);
  // Guard: if somehow nothing was chosen (empty map), no-op. nowMs is
  // accepted for signature symmetry / future decay policy.
  void nowMs;
}

export interface CoolingOptions {
  /** Cooldown window in ms (default DEFAULT_COOLDOWN_MS). */
  cooldownMs?: number;
}

/**
 * True when `provider` had a *disqualifying* (health-class) failure
 * within the cooldown window ending at `nowMs`. A later success does
 * NOT by itself clear the window early — but because success/failure
 * events are timestamped, an event that has aged out of the window no
 * longer counts. Request-specific classes (content_policy, auth,
 * context_overflow, other) never mark a provider as cooling down.
 */
export function isProviderCoolingDown(
  provider: string,
  nowMs: number,
  opts?: CoolingOptions,
): boolean {
  const key = (provider || '').trim();
  if (!key) return false;
  const ring = registry.get(key);
  if (!ring || ring.length === 0) return false;

  // Consecutive-failure backoff (audit): a provider that keeps failing gets an
  // exponentially longer cooldown (clamped) instead of a flat window — so a
  // durably-dead provider stops getting retried head-of-line every turn.
  // Count consecutive recent cooldown-class failures (newest→oldest, stop at a
  // success or a non-cooldown failure).
  const baseWindowMs = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  let consecutiveFailures = 0;
  for (let i = ring.length - 1; i >= 0; i -= 1) {
    const ev = ring[i];
    if (ev.atMs > nowMs) continue; // future event (clock skew)
    if (ev.ok) break;
    if (COOLDOWN_BY_CLASS[ev.errorClass ?? 'other']) consecutiveFailures += 1;
    else break;
  }
  const windowMs = backoffWindowMs(consecutiveFailures, baseWindowMs);
  const floor = nowMs - windowMs;

  // Walk newest→oldest; stop as soon as we fall out of the window.
  for (let i = ring.length - 1; i >= 0; i -= 1) {
    const ev = ring[i];
    if (ev.atMs < floor) break;      // aged out — nothing older can qualify
    if (ev.atMs > nowMs) continue;   // future event (clock skew) — ignore
    if (ev.ok) continue;             // a success is not a cooldown signal
    if (COOLDOWN_BY_CLASS[ev.errorClass ?? 'other']) return true;
  }
  return false;
}

/**
 * Map an arbitrary thrown error / error-shaped object to a
 * ProviderErrorClass. Complements `isTransientProviderError` in
 * crossProviderRouter (that predicate answers the narrower
 * "should the existing chain fall through?" question; this returns the
 * finer-grained class the health registry needs).
 *
 * Pure — no time, no I/O.
 */
export function classifyProviderError(err: unknown): ProviderErrorClass {
  if (err == null) return 'other';
  const anyErr = err as any;

  const status = typeof anyErr.status === 'number' ? anyErr.status
    : typeof anyErr.statusCode === 'number' ? anyErr.statusCode
    : typeof anyErr?.response?.status === 'number' ? anyErr.response.status
    : undefined;

  const msg = String(
    anyErr?.message
    ?? (typeof anyErr === 'string' ? anyErr : '')
    ?? '',
  ).toLowerCase();

  // ── Status-code first (most reliable) ──
  if (typeof status === 'number') {
    if (status === 429) return 'rate_limit';
    if (status === 529 || status === 503) return 'overload';
    if (status === 401 || status === 403) return 'auth';
    if (status === 400 || status === 413 || status === 422) {
      // 4xx bad-request family — could be an oversized prompt. Only
      // call it context_overflow when the message says so; otherwise
      // it's a request-specific 'other' (still NOT a cooldown signal).
      if (isContextOverflowMessage(msg)) return 'context_overflow';
      if (isContentPolicyMessage(msg)) return 'content_policy';
      return 'other';
    }
    if (status === 408) return 'transient';
    if (status >= 500 && status <= 599) return 'transient';
    // Any other explicit status: fall through to message heuristics.
  }

  // ── Message heuristics (no / non-numeric status) ──
  if (isContextOverflowMessage(msg)) return 'context_overflow';
  if (isContentPolicyMessage(msg)) return 'content_policy';
  if (/\brate.?limit/.test(msg) || msg.includes('too many requests') || msg.includes('quota')) {
    return 'rate_limit';
  }
  if (msg.includes('overloaded') || msg.includes('service unavailable') || msg.includes('service_unavailable') || msg.includes('capacity')) {
    return 'overload';
  }
  if (msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('invalid_api_key')
    || msg.includes('forbidden') || msg.includes('authentication')) {
    return 'auth';
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnreset')
    || msg.includes('fetch failed') || msg.includes('network') || msg.includes('aborted')
    || msg.includes('socket hang up')) {
    return 'transient';
  }
  return 'other';
}

function isContextOverflowMessage(msg: string): boolean {
  return msg.includes('context length') || msg.includes('context_length')
    || msg.includes('maximum context') || msg.includes('too many tokens')
    || msg.includes('too long') || msg.includes('reduce the length')
    || msg.includes('context window') || msg.includes('input is too large');
}

function isContentPolicyMessage(msg: string): boolean {
  return msg.includes('content policy') || msg.includes('content_policy')
    || msg.includes('safety') || msg.includes('moderation')
    || msg.includes('flagged') || msg.includes('content_filter')
    || msg.includes('responsible ai') || msg.includes('violates');
}

export interface ExcludeCoolingResult<T extends string> {
  /** The input list, reordered so cooling-down providers are at the
   *  BACK, in their original relative order. Same length as input,
   *  same elements — NOTHING is dropped. */
  ordered: T[];
  /** The providers that were deprioritized (moved to the back),
   *  newest-cool-signal irrelevant here — just which ones. Bounded to
   *  the input length. Useful for a quiet telemetry note. */
  deprioritized: T[];
}

/**
 * PRE-SELECTION reorder: move any provider that is cooling down to the
 * BACK of `orderedProviders`, preserving relative order within the
 * healthy group and within the cooling group. Never removes an entry —
 * degrade order, don't drop options (so the try list can never reach
 * zero because of health; worst case the order is unchanged).
 *
 * This is the ONLY thing the router calls. It is fail-VISIBLE-safe:
 * it changes the ORDER future attempts are made in, and does not touch
 * error handling or surfacing.
 *
 * Duplicates in the input are preserved (stable partition).
 */
export function excludeCoolingProviders<T extends string>(
  orderedProviders: readonly T[],
  nowMs: number,
  opts?: CoolingOptions,
): ExcludeCoolingResult<T> {
  const healthy: T[] = [];
  const cooling: T[] = [];
  for (const p of orderedProviders) {
    if (isProviderCoolingDown(p, nowMs, opts)) cooling.push(p);
    else healthy.push(p);
  }
  return { ordered: [...healthy, ...cooling], deprioritized: cooling };
}

/** Test hook — wipe all recorded health. */
export function resetProviderHealth(): void {
  registry.clear();
}

/** Introspection hook (tests / diagnostics): how many providers are
 *  currently tracked, and the event count for one provider. Read-only. */
export function providerHealthDebug(provider?: string): { providers: number; events: number } {
  if (provider != null) {
    const ring = registry.get(provider.trim());
    return { providers: registry.size, events: ring ? ring.length : 0 };
  }
  return { providers: registry.size, events: 0 };
}
