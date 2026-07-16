/**
 * providerBackoffCore — pure, deterministic CONSECUTIVE-failure (exponential)
 * backoff math for provider-health cooldown windows.
 *
 * ─── Why this exists (provider opt v5) ──────────────────────────────
 * `providerHealthRegistry.isProviderCoolingDown` currently uses a FLAT
 * cooldown window (`DEFAULT_COOLDOWN_MS`, ~30s): every disqualifying
 * failure cools a provider for the SAME fixed window. A provider that is
 * *durably* dead (repeated back-to-back failures) therefore ages out of
 * the flat window and gets retried head-of-line again on the next turn,
 * burning a request slot each time before failing over.
 *
 * This module supplies the pure math for a consecutive-failure backoff:
 * the cooldown window grows ~2^n with the number of back-to-back
 * disqualifying failures, so a durably-dead provider is deprioritized for
 * progressively longer instead of being retried every window.
 *
 * ─── Two independent clamps (safety) ────────────────────────────────
 * Growth is bounded by BOTH:
 *   1. a multiplier ceiling      (maxMultiplier, default 8) — caps 2^n, and
 *   2. an absolute window ceiling (maxWindowMs, default 8 min).
 * The absolute ceiling is the important guard: it guarantees that even a
 * hostile / huge `baseWindowMs` (or `maxMultiplier`) override can NEVER
 * freeze a provider out for hours — the effective window is capped at the
 * ceiling. `isCoolingDown` does not even expose the clamp overrides, so its
 * window is always ≤ PROVIDER_BACKOFF_MAX_WINDOW_MS.
 *
 * ─── Purity ─────────────────────────────────────────────────────────
 * No imports, no I/O, no `Date.now()` / `Math.random()` at module scope —
 * callers inject `nowMs`. Every export is TOTAL: null / undefined /
 * wrong-type / huge / hostile / cyclic inputs collapse to a safe neutral
 * and never throw. Bounded, deterministically smoke-testable under tsx.
 */

/** 2^n multiplier ceiling — caps how large the exponential growth can get. */
export const PROVIDER_BACKOFF_MAX_MULTIPLIER = 8;

/** Absolute cooldown-window ceiling (8 minutes). A provider can never be
 *  deprioritized for longer than this, no matter the failure count or a
 *  large `baseWindowMs` override — the head-of-line-retry fix must not turn
 *  into an "offline forever" bug. */
export const PROVIDER_BACKOFF_MAX_WINDOW_MS = 8 * 60_000;

/** Fallback base window when a caller doesn't supply one. Mirrors
 *  providerHealthRegistry.DEFAULT_COOLDOWN_MS, kept as a local literal so
 *  this core stays import-free (no cycle with the registry that consumes it). */
export const PROVIDER_BACKOFF_DEFAULT_BASE_WINDOW_MS = 30_000;

/** Hard cap on the failure exponent. Past this the multiplier is already
 *  clamped, so a bigger exponent is meaningless; capping keeps Math.pow away
 *  from pathological territory even though Math.min is Infinity-safe. */
const MAX_FAILURE_EXPONENT = 1024;

/** Coerce an unknown failure count to a non-negative, bounded integer. */
function toSafeCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  const n = Math.floor(v);
  return n > MAX_FAILURE_EXPONENT ? MAX_FAILURE_EXPONENT : n;
}

/** Non-negative finite window, else `fallback`. 0 is allowed (a caller opting
 *  a window off); negatives / NaN / non-numbers fall back to a live default. */
function toSafeWindow(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fallback;
  return v;
}

/** Multiplier is floored at 1 (a backoff must never SHRINK below base) and
 *  must be finite; non-finite / non-number falls back to `fallback`. */
function toSafeMultiplier(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < 1 ? 1 : v;
}

function toFiniteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Exponential-ish backoff window for a provider with `consecutiveFailures`
 * back-to-back disqualifying failures:
 *
 *   window = clamp( base * min(2^n, maxMultiplier), 0, maxWindowMs )
 *
 * • 0 failures → base (2^0 = 1×), assuming base ≤ ceiling.
 * • Grows 2× per consecutive failure until the multiplier hits maxMultiplier.
 * • Always clamped to maxWindowMs, so a huge base / multiplier can't freeze a
 *   provider for hours.
 *
 * TOTAL: any hostile input collapses to a safe finite window; never throws.
 */
export function backoffWindowMs(
  consecutiveFailures: unknown,
  baseWindowMs: unknown,
  opts?: { maxMultiplier?: number; maxWindowMs?: number },
): number {
  try {
    const base = toSafeWindow(baseWindowMs, PROVIDER_BACKOFF_DEFAULT_BASE_WINDOW_MS);
    const n = toSafeCount(consecutiveFailures);
    const maxMult = toSafeMultiplier(opts?.maxMultiplier, PROVIDER_BACKOFF_MAX_MULTIPLIER);
    const ceiling = toSafeWindow(opts?.maxWindowMs, PROVIDER_BACKOFF_MAX_WINDOW_MS);

    // 2^n, clamped to the multiplier ceiling. Math.min is Infinity-safe, so an
    // overflowing 2^n (large n) simply pins to maxMult rather than exploding.
    const multiplier = Math.min(maxMult, Math.pow(2, n));
    let windowMs = base * multiplier;

    if (!Number.isFinite(windowMs) || windowMs < 0) windowMs = ceiling;
    if (windowMs > ceiling) windowMs = ceiling;
    return windowMs;
  } catch {
    return PROVIDER_BACKOFF_DEFAULT_BASE_WINDOW_MS;
  }
}

/**
 * True when a provider that last failed at `lastFailureAtMs` with
 * `consecutiveFailures` back-to-back disqualifying failures is still inside
 * its (escalating) backoff window as of `nowMs`:
 *
 *   nowMs - lastFailureAtMs < backoffWindowMs(consecutiveFailures, base)
 *
 * Uses only the default clamps, so the window is always
 * ≤ PROVIDER_BACKOFF_MAX_WINDOW_MS even for a huge `baseWindowMs`.
 *
 * Safe-neutral (returns false → "not cooling", provider stays eligible) when:
 * the input is missing / non-object, the timestamps are non-numeric, there are
 * no failures, or the failure timestamp is in the future (clock skew).
 * TOTAL: never throws.
 */
export function isCoolingDown(input: {
  lastFailureAtMs: unknown;
  consecutiveFailures: unknown;
  nowMs: unknown;
  baseWindowMs?: unknown;
}): boolean {
  try {
    if (input == null || typeof input !== 'object') return false;

    const now = toFiniteOrNull(input.nowMs);
    const last = toFiniteOrNull(input.lastFailureAtMs);
    if (now == null || last == null) return false;

    const n = toSafeCount(input.consecutiveFailures);
    if (n <= 0) return false; // no disqualifying failure → nothing to cool

    const elapsed = now - last;
    if (elapsed < 0) return false; // future failure (clock skew) → not cooling

    // backoffWindowMs sanitizes an unknown baseWindowMs (undefined / hostile →
    // default) and applies the default clamps internally.
    return elapsed < backoffWindowMs(n, input.baseWindowMs);
  } catch {
    return false;
  }
}
