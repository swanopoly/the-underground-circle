// streamHealthCore — the PURE byte-truth transport state machine for the pending
// chat bubble. It answers ONE question the streaming UI keeps asking during an
// unbounded wait: "what is the transport actually doing right now?" — so the
// bubble tells the truth instead of rotating a decorative "pondering…" verb over
// a connection that silently hung after the 200 SSE handshake (see the run loop
// in src/lib/swanbotStream.ts).
//
// The machine watches three transport signals and nothing else:
//   - `handshake`  — the SSE 200 arrived and a readable body exists. We are now
//                    connected and WAITING for the first token.
//   - `byte`       — any assistant text arrived (a `delta` in swanbotStream).
//                    The first byte proves the model is producing; every byte
//                    re-stamps the idle clock so an inter-token gap can be seen.
//   - `idle_tick`  — a timer fired with no byte since the last one. The elapsed
//                    idle time is compared against a budget to escalate the
//                    health: healthy → slow → stalled.
//
// Two budgets, because a silent gap means different things before vs. after the
// first token. BEFORE the first token a reasoning model can legitimately think
// for a while, so the pre-first-token ("TTFT") budget is deliberately MORE
// generous — we don't cry "slow"/"stalled" on a model that is still reasoning.
// AFTER tokens have started, a long silent gap is genuinely unusual, so the
// inter-token budget is tighter.
//
// PURITY: zero imports, tsx-loadable (smoke: stream-health-core). Every function
// is TOTAL — null / undefined / wrong-type / hostile (Proxy with throwing
// getters) / huge inputs degrade to a safe, calm default and NEVER throw. `nowMs`
// is always an INPUT: this module never reads the clock (no Date.now) and never
// uses randomness, so it is fully deterministic and replayable in a smoke.

/** The transport's health, most-optimistic → most-alarming. */
export type StreamHealth =
  | 'opening' // fetch in flight; no 200/body yet
  | 'waiting_first_token' // connected (200 handshake); no assistant byte yet
  | 'streaming' // bytes are flowing
  | 'slow' // idle past the slow budget for the current phase
  | 'stalled'; // idle past the stalled budget — likely hung, offer a retry

/**
 * The full transport state. Additive/serializable — a caller can persist it and
 * feed it back into {@link advanceStreamHealth}.
 */
export interface StreamHealthState {
  /** Current health bucket. */
  health: StreamHealth;
  /** True once any assistant byte has been observed (selects the idle budget). */
  sawFirstToken: boolean;
  /**
   * Epoch-ms zero-point of the idle clock: the last transport activity we could
   * timestamp (the handshake, then each byte). `null` means "no usable reference
   * yet" — idle ticks then cannot measure and leave the health untouched.
   */
  lastByteAtMs: number | null;
}

/** A single transport signal fed to {@link advanceStreamHealth}. `nowMs` is the
 *  caller's clock read (kept an input so the core stays pure/deterministic). */
export interface StreamHealthEvent {
  kind: 'handshake' | 'byte' | 'idle_tick';
  nowMs: number;
}

// ── Budgets (all epoch-ms durations) ────────────────────────────────────────
/** Inter-token idle after the first token before we say "slow". */
export const STREAM_SLOW_MS = 20_000;
/** Inter-token idle after the first token before we say "stalled". */
export const STREAM_STALLED_MS = 60_000;
/**
 * Pre-first-token idle before we say "slow" — the generous TTFT budget. A
 * reasoning model can think this long before emitting a single byte, so the
 * whole pre-first-token budget is shifted later by
 * `STREAM_TTFT_SLOW_MS - STREAM_SLOW_MS` (the "stalled" line moves out by the
 * same offset). Must be >= STREAM_SLOW_MS to actually be more generous.
 */
export const STREAM_TTFT_SLOW_MS = 40_000;

// ── User-facing copy (one calm sentence per health) ─────────────────────────
const HEALTH_COPY: Readonly<Record<StreamHealth, string>> = Object.freeze({
  opening: 'Connecting…',
  waiting_first_token: 'Thinking…',
  streaming: 'Writing…',
  slow: 'Still working…',
  stalled: 'Connection seems stalled — say "continue" to retry',
});

const HEALTHS: readonly StreamHealth[] = [
  'opening',
  'waiting_first_token',
  'streaming',
  'slow',
  'stalled',
];

// ── Internal guards (all total) ─────────────────────────────────────────────
function isStreamHealth(x: unknown): x is StreamHealth {
  return typeof x === 'string' && (HEALTHS as readonly string[]).indexOf(x) !== -1;
}

function coerceTime(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/**
 * Coerce any value into a valid {@link StreamHealthState}. Hostile shapes (a
 * Proxy whose getters throw) are caught and degrade to a fresh init state — the
 * safe neutral. `sawFirstToken` is only honored when strictly `true`, and
 * `lastByteAtMs` only when a finite number; anything else is discarded.
 */
function normalizeState(s: unknown): StreamHealthState {
  try {
    if (!s || typeof s !== 'object') return initStreamHealth();
    const o = s as Record<string, unknown>;
    const health = isStreamHealth(o.health) ? o.health : 'opening';
    const sawFirstToken = o.sawFirstToken === true;
    const raw = o.lastByteAtMs;
    const lastByteAtMs = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    return { health, sawFirstToken, lastByteAtMs };
  } catch {
    return initStreamHealth();
  }
}

/** The slow/stalled idle thresholds for the current phase. */
function idleBudgets(sawFirstToken: boolean): { slowMs: number; stalledMs: number } {
  if (sawFirstToken) return { slowMs: STREAM_SLOW_MS, stalledMs: STREAM_STALLED_MS };
  // Pre-first-token: shift BOTH lines later by the TTFT generosity offset.
  const offset = Math.max(0, STREAM_TTFT_SLOW_MS - STREAM_SLOW_MS);
  return { slowMs: STREAM_TTFT_SLOW_MS, stalledMs: STREAM_STALLED_MS + offset };
}

/** A calm, freshly-connected-nothing-yet state. Returns a NEW object each call. */
export function initStreamHealth(): StreamHealthState {
  return { health: 'opening', sawFirstToken: false, lastByteAtMs: null };
}

/**
 * Advance the transport state by one signal. Pure: it reads no clock and mutates
 * nothing — it returns a NEW state. Transitions:
 *
 *   handshake  → 'waiting_first_token'; stamp the idle clock at `nowMs`; clears
 *                sawFirstToken (a handshake (re)opens a stream, so we owe a first
 *                token again).
 *   byte       → 'streaming'; set sawFirstToken; re-stamp the idle clock. Also
 *                the RECOVERY edge: a byte arriving in 'slow'/'stalled' snaps
 *                back to 'streaming'.
 *   idle_tick  → measure `nowMs - lastByteAtMs` and escalate against the current
 *                phase's budget: >= stalled → 'stalled', else >= slow → 'slow',
 *                else the healthy waiting state ('streaming' post-first-token,
 *                'waiting_first_token' before it). Does NOT re-stamp the clock
 *                (no byte arrived) and does NOT change sawFirstToken. With no
 *                usable reference (`lastByteAtMs` null, e.g. still 'opening', or
 *                `nowMs` not finite) it leaves the state untouched — we never
 *                invent a stall we cannot measure.
 *
 * Totality: a garbage `state` is normalized to a valid state first; a hostile /
 * malformed `event` is a no-op on that normalized state; an unknown `kind` is a
 * no-op. Never throws.
 */
export function advanceStreamHealth(
  state: StreamHealthState,
  event: { kind: 'handshake' | 'byte' | 'idle_tick'; nowMs: number },
): StreamHealthState {
  const s = normalizeState(state);

  let kind: unknown;
  let nowRaw: unknown;
  try {
    kind = (event as { kind?: unknown } | null | undefined)?.kind;
    nowRaw = (event as { nowMs?: unknown } | null | undefined)?.nowMs;
  } catch {
    return s; // hostile event (throwing getter) → no-op on normalized state
  }

  const now = coerceTime(nowRaw);

  if (kind === 'handshake') {
    return { health: 'waiting_first_token', sawFirstToken: false, lastByteAtMs: now };
  }

  if (kind === 'byte') {
    return { health: 'streaming', sawFirstToken: true, lastByteAtMs: now };
  }

  if (kind === 'idle_tick') {
    if (now === null || s.lastByteAtMs === null) return s; // nothing to measure
    const idle = Math.max(0, now - s.lastByteAtMs);
    const { slowMs, stalledMs } = idleBudgets(s.sawFirstToken);
    let health: StreamHealth;
    if (idle >= stalledMs) health = 'stalled';
    else if (idle >= slowMs) health = 'slow';
    else health = s.sawFirstToken ? 'streaming' : 'waiting_first_token';
    return { health, sawFirstToken: s.sawFirstToken, lastByteAtMs: s.lastByteAtMs };
  }

  // Unknown / malformed kind → no-op.
  return s;
}

/**
 * The one-line user copy for a health bucket. Total: any out-of-domain value
 * degrades to the calm 'opening' copy rather than throwing or inventing text.
 */
export function describeStreamHealth(h: StreamHealth): string {
  try {
    return isStreamHealth(h) ? HEALTH_COPY[h] : HEALTH_COPY.opening;
  } catch {
    return HEALTH_COPY.opening;
  }
}
