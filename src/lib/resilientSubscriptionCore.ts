/**
 * resilientSubscriptionCore — the PURE reconnect / silent-staleness brain for
 * Supabase Realtime channels.
 *
 * ─── Why this exists (next-gaps FINDING 1) ──────────────────────────────
 * The app opens ~76 realtime `.subscribe()` channels across Chat/Office/Feed,
 * but exactly ONE file (`agentPresence.ts`) handles channel drop. After a
 * network blip, laptop sleep/wake, or a Supabase socket timeout, every other
 * dropped channel never re-subscribes and its surface shows STALE DATA FOREVER
 * with no error and no recovery. The gold-standard reconnect machinery already
 * exists but is trapped in presence:
 *   • `agentPresence.ts:145-160`  — SUBSCRIBED → live / CHANNEL_ERROR|TIMED_OUT
 *                                    → reconnecting → scheduleReconnect.
 *   • `agentPresence.ts:272-297`  — exponential backoff 1s→2s→4s… capped 5min,
 *                                    via the PRIVATE (exported-nowhere)
 *                                    `scheduleReconnect`.
 *
 * This module lifts that policy out into a reusable, deterministic decision
 * layer so a shared `useResilientSubscription` hook (and the bare-`.subscribe()`
 * Feed/Office panels) can recover instead of silently freezing. The actual
 * `supabase.channel()` / `.subscribe()` call stays the CALLER's — this file only
 * answers two questions:
 *
 *   1. planReconnect            — should we (re)connect this channel, and after
 *                                 what backoff delay? (error/closed/timed-out
 *                                 warrant it; a healthy channel does not).
 *   2. assessSubscriptionHealth — is a channel that CLAIMS to be subscribed
 *                                 actually stale (no event within the heartbeat
 *                                 window)? — the silent-staleness case.
 *
 * ─── Purity ─────────────────────────────────────────────────────────────
 * ZERO imports. No `Date.now()` / `Math.random()` anywhere — callers inject
 * `nowMs` / `lastAttemptMs` / `lastEventMs` so every function is deterministic
 * and smoke-testable under tsx (mirrors `providerBackoffCore` / `deadlineSlaCore`).
 * Every export is TOTAL: null / undefined / wrong-type / huge / hostile / cyclic
 * input collapses to a safe neutral and NEVER throws. Bounded, secret-free.
 *
 * NOTE (fail-visible, never fail-silent): a dropped channel must surface as
 * `error`/`closed`/`reconnecting` or `staleMs != null`, never a frozen board
 * that still looks live. Intentional teardown (unsubscribe / removeChannel) is
 * the caller's concern — the caller stops consulting this core on purpose-close.
 */

// ─── Canonical channel state ────────────────────────────────────────────────
// Deliberately mirrors Supabase's RealtimeSubscribeStates surface (SUBSCRIBED /
// CHANNEL_ERROR / TIMED_OUT / CLOSED) plus our own 'connecting' (SUBSCRIBING)
// and synthetic 'reconnecting' (a retry is pending). TIMED_OUT folds into
// 'error' — both warrant a reconnect and there is no distinct member for it.
export type SubscriptionState =
  | 'connecting'
  | 'subscribed'
  | 'error'
  | 'closed'
  | 'reconnecting';

export interface SubscriptionHealth {
  /** Normalized current channel state. */
  state: SubscriptionState;
  /** Back-to-back failures so far (bounded, ≥0). Drives the backoff exponent. */
  consecutiveFailures: number;
  /** Epoch ms of the last realtime event seen, or null if never / unmeasurable. */
  lastEventMs: number | null;
  /** How long (ms) a 'subscribed' channel has been SILENT past the heartbeat
   *  window — the silent-staleness signal. null = fresh / not measurable /
   *  not 'subscribed'. `staleMs != null` IS the "is stale" flag. */
  staleMs: number | null;
}

export interface ReconnectPlan {
  /** True when the state warrants a (re)connect (error / closed / reconnecting). */
  shouldReconnect: boolean;
  /** Ms from `nowMs` until the reconnect should fire. Scheduler callers (omit
   *  lastAttemptMs) get the FULL backoff window; poll callers (pass
   *  lastAttemptMs + nowMs) get the REMAINING wait — 0 once the window elapsed. */
  delayMs: number;
  /** Short, secret-free human sentence naming the decision. */
  reason: string;
}

// ─── Constants (mirror agentPresence's battle-tested numbers) ───────────────
/** First backoff delay — 1s. Grows 2× per consecutive failure. (agentPresence
 *  hardcodes `1000 * 2^(attempts-1)`.) Not caller-overridable, like presence. */
export const RECONNECT_BASE_DELAY_MS = 1_000;
/** Absolute backoff ceiling — 5 min. A channel is NEVER deprioritized longer
 *  than this, no matter the failure count (agentPresence caps at `300_000`).
 *  The reconnect-forever floor: keep retrying, just cap the gap. */
export const RECONNECT_MAX_BACKOFF_MS = 300_000;
/** Default silence window before a 'subscribed' channel is judged stale — 30s,
 *  matching the `ActivityFeedPanel` 30s poll floor the doc calls "the floor
 *  everywhere". Callers should set ~1.5–2× their own heartbeat interval. */
export const DEFAULT_HEARTBEAT_MS = 30_000;

/** Cap on the backoff exponent. Past this the delay is already pinned to the
 *  ceiling, so a larger exponent is meaningless; capping keeps `Math.pow` away
 *  from pathological territory even though `Math.min` is Infinity-safe. */
const MAX_FAILURE_EXPONENT = 1024;

// ─── Numeric guards ─────────────────────────────────────────────────────────
function toFiniteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Unknown → non-negative, bounded integer failure count. */
function toSafeCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  const n = Math.floor(v);
  return n > MAX_FAILURE_EXPONENT ? MAX_FAILURE_EXPONENT : n;
}

/** Non-negative finite window/ceiling, else `fallback`. 0 is allowed (a caller
 *  opting the window off / demanding immediate staleness), mirroring
 *  providerBackoffCore.toSafeWindow; negatives / NaN / non-numbers fall back. */
function toSafeWindow(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fallback;
  return v;
}

// ─── Rough, human-friendly delay phrasing (status text, not a stopwatch) ─────
function roughDelay(ms: unknown): string {
  const m = Math.max(0, Math.floor(typeof ms === 'number' && Number.isFinite(ms) ? ms : 0));
  if (m < 1_000) return `~${m}ms`;
  const sec = Math.round(m / 1_000);
  if (sec < 90) return `~${sec}s`;
  const min = Math.round(m / 60_000);
  return `~${min}m`;
}

/**
 * Coerce an unknown status into a canonical `SubscriptionState`. Recognizes our
 * five members AND the raw Supabase statuses a `.subscribe()` callback emits
 * (`SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` / `SUBSCRIBING`) plus
 * common casing / separator variants, so a caller can pass whatever it has. Any
 * unrecognized / non-string input degrades to the safe-neutral 'connecting'
 * (not-yet-established → never a false stale alarm, never a spurious reconnect).
 * TOTAL: never throws.
 */
export function normalizeSubscriptionState(v: unknown): SubscriptionState {
  if (typeof v !== 'string') return 'connecting';
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (s) {
    case 'subscribed':
    case 'joined':
      return 'subscribed';
    case 'error':
    case 'channel_error':
    case 'errored':
    case 'timed_out':
    case 'timedout':
    case 'timeout':
      return 'error';
    case 'closed':
    case 'closing':
    case 'leaving':
    case 'left':
      return 'closed';
    case 'reconnecting':
      return 'reconnecting';
    case 'connecting':
    case 'subscribing':
    case 'joining':
      return 'connecting';
    default:
      return 'connecting';
  }
}

/** Exponential backoff window for `consecutiveFailures` back-to-back failures:
 *    window = clamp( base * 2^max(0, n-1), 0, ceilingMs )
 *  n≤1 → base (1s, the first reconnect); doubles each further failure; always
 *  clamped to the ceiling. Math.min is Infinity-safe so an overflowing 2^n pins
 *  to the ceiling rather than exploding. Always finite in [0, ceilingMs]. */
function computeBackoffMs(consecutiveFailures: number, ceilingMs: number): number {
  const exponent = consecutiveFailures <= 1 ? 0 : consecutiveFailures - 1;
  const raw = RECONNECT_BASE_DELAY_MS * Math.pow(2, exponent);
  let delay = Math.min(raw, ceilingMs);
  if (!Number.isFinite(delay) || delay < 0) delay = ceilingMs;
  if (delay > ceilingMs) delay = ceilingMs;
  return delay;
}

/**
 * Decide whether a channel should (re)connect and after what delay.
 *
 * `shouldReconnect` is TIMING-INDEPENDENT: it is true exactly when the state is
 * one that needs reconnecting — 'error', 'closed', or 'reconnecting' (a retry
 * already in flight) — and false while 'subscribed' (healthy) or 'connecting'
 * (a connect is already in progress). "Not while healthy."
 *
 * `delayMs` is how long from `nowMs` until the reconnect should actually FIRE:
 *   • Scheduler callers (omit `lastAttemptMs`) get the FULL backoff window and
 *     do `setTimeout(reconnect, delayMs)` — exactly agentPresence's shape.
 *   • Poll callers (pass `lastAttemptMs` + `nowMs`) get the REMAINING wait:
 *     `max(0, window - (nowMs - lastAttemptMs))`, so it counts down to 0 and
 *     then the caller reconnects immediately on the next tick.
 *
 * DETERMINISTIC (no jitter — jitter, if wanted, is the caller's) and TOTAL:
 * every hostile input collapses to `{ shouldReconnect:false, delayMs:0 }`.
 */
export function planReconnect(input: {
  state?: unknown;
  consecutiveFailures?: unknown;
  nowMs?: unknown;
  lastAttemptMs?: unknown;
  maxBackoffMs?: number;
}): ReconnectPlan {
  try {
    const src =
      input == null || typeof input !== 'object' ? {} : (input as Record<string, unknown>);

    const state = normalizeSubscriptionState(src.state);
    const warrants = state === 'error' || state === 'closed' || state === 'reconnecting';

    if (!warrants) {
      const reason =
        state === 'subscribed'
          ? 'subscribed — healthy, no reconnect'
          : 'connecting — no reconnect';
      return { shouldReconnect: false, delayMs: 0, reason };
    }

    const n = toSafeCount(src.consecutiveFailures);
    const ceiling = toSafeWindow(src.maxBackoffMs, RECONNECT_MAX_BACKOFF_MS);
    const backoff = computeBackoffMs(n, ceiling);

    // Remaining wait: scheduler model (no lastAttempt) → full window; poll model
    // → window minus time already elapsed since the last attempt. A future
    // lastAttempt (clock skew) can only push the wait UP to the full window.
    const now = toFiniteOrNull(src.nowMs);
    const last = toFiniteOrNull(src.lastAttemptMs);
    let delayMs = backoff;
    if (now != null && last != null) {
      let remaining = backoff - (now - last);
      if (!Number.isFinite(remaining) || remaining < 0) remaining = 0;
      if (remaining > backoff) remaining = backoff;
      delayMs = remaining;
    }

    const attemptNo = n < 1 ? 1 : n;
    const stem =
      state === 'error' ? 'channel error' : state === 'closed' ? 'channel closed' : 'reconnecting';
    const reason =
      delayMs <= 0
        ? `${stem} — reconnecting now (attempt ${attemptNo})`
        : `${stem} — retry in ${roughDelay(delayMs)} (attempt ${attemptNo})`;

    return { shouldReconnect: true, delayMs, reason };
  } catch {
    return { shouldReconnect: false, delayMs: 0, reason: 'unusable input — no reconnect' };
  }
}

/**
 * Assess a channel's live health, catching the SILENT-STALENESS case: a channel
 * that reports 'subscribed' but has not seen an event within the heartbeat
 * window is stale even though it still looks live (the exact bug FINDING 1
 * describes — a check that finishes after the socket drops shows "running"
 * forever). `staleMs` is populated (non-null) ONLY for a 'subscribed' channel
 * whose silence exceeds `heartbeatMs`; its value is the total ms since the last
 * event. For every other state staleMs is null — a channel already reporting
 * error/closed/reconnecting/connecting is unhealthy for a reason the caller
 * already surfaces, so staleness would be redundant, not news.
 *
 * `consecutiveFailures` (optional) is passed straight through, bounded, into the
 * health record so a caller can carry it alongside the derived freshness.
 * TOTAL: never throws; unmeasurable timing → staleMs null.
 */
export function assessSubscriptionHealth(input: {
  state?: unknown;
  lastEventMs?: unknown;
  nowMs?: unknown;
  heartbeatMs?: unknown;
  consecutiveFailures?: unknown;
}): SubscriptionHealth {
  try {
    const src =
      input == null || typeof input !== 'object' ? {} : (input as Record<string, unknown>);

    const state = normalizeSubscriptionState(src.state);
    const consecutiveFailures = toSafeCount(src.consecutiveFailures);
    const lastEventMs = toFiniteOrNull(src.lastEventMs);
    const now = toFiniteOrNull(src.nowMs);
    const heartbeatMs = toSafeWindow(src.heartbeatMs, DEFAULT_HEARTBEAT_MS);

    let staleMs: number | null = null;
    if (state === 'subscribed' && lastEventMs != null && now != null) {
      const gap = now - lastEventMs;
      // gap > heartbeatMs (≥0) implies gap > 0, so a future lastEvent (skew,
      // gap < 0) can never be flagged stale — it simply falls through.
      if (Number.isFinite(gap) && gap > heartbeatMs) staleMs = gap;
    }

    return { state, consecutiveFailures, lastEventMs, staleMs };
  } catch {
    return { state: 'connecting', consecutiveFailures: 0, lastEventMs: null, staleMs: null };
  }
}

/**
 * One-line, secret-free status label for a `SubscriptionHealth` — the copy
 * FINDING 5 wants for a shared "live / reconnecting / stale (Ns ago)" strip.
 * Re-normalizes defensively so it is TOTAL even on a hand-built object; a
 * malformed health degrades to 'connecting…'.
 */
export function describeHealth(health: SubscriptionHealth): string {
  try {
    const h = (health ?? {}) as Partial<SubscriptionHealth>;
    const state = normalizeSubscriptionState(h.state);
    const staleMs = toFiniteOrNull(h.staleMs);
    if (state === 'subscribed') {
      return staleMs != null ? `stale (${roughDelay(staleMs)} ago)` : 'live';
    }
    switch (state) {
      case 'reconnecting':
        return 'reconnecting…';
      case 'error':
        return 'connection error';
      case 'closed':
        return 'offline';
      default:
        return 'connecting…';
    }
  } catch {
    return 'connecting…';
  }
}
