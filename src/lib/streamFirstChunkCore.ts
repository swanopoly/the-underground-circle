// streamFirstChunkCore — the PURE first-flush + delta-coalescing policy for the
// chat SSE emit loop. It answers the ONE latency question the streaming path
// keeps asking: "what is the earliest meaningful thing I can put on the user's
// screen, and how do I avoid drowning the wire in one-character frames after
// that?" — so perceived time-to-first-token (TTFT) drops without the transport
// thrashing on micro-deltas.
//
// Grounding — this mirrors the real emit loop in
// `supabase/functions/chat-stream/index.ts` (the `ReadableStream.start`
// controller): today every Anthropic `content_block_delta` of type `text_delta`
// is forwarded verbatim as its own `data: {"type":"delta","text":...}` SSE frame
// (index.ts line ~250-251), and there is no early typing/ack signal even though
// the header already documents a `{"type":"phase","phase":"thinking"}` event. On
// a reasoning model the first `text_delta` can lag seconds behind the 200
// handshake, and once text flows the model emits many tiny deltas — one SSE
// frame each. The analogous typed-loop path is `agentExecutionCore.runAgent`'s
// `provider.turn({ onDelta })` → `emit({ kind:'model_delta', text })` (line
// ~709). This core is the shared, testable brain both loops can consult:
//   1. planFirstFlush     — at stream start, decide whether to emit an early
//                           ack (a thinking model is about to go quiet) and the
//                           SMALL char threshold that triggers the first content
//                           flush (small = fast first paint, but floored so a
//                           lone whitespace char doesn't thrash the render).
//   2. shouldCoalesceDelta — per delta, decide whether to keep batching (small
//                           buffer, held only briefly) or flush now (buffer big
//                           enough OR held long enough that more waiting would be
//                           perceptible). Batching collapses N micro-deltas into
//                           far fewer SSE frames with no visible lag.
//
// PURITY: zero imports, tsx-loadable (smoke: stream-first-chunk-core). Every
// export is TOTAL — null / undefined / wrong-type / huge / hostile (throwing
// getters, throwing valueOf/toString, cycles, Symbols, functions) inputs degrade
// to a safe, calm default and NEVER throw. Fully deterministic: elapsed time is
// always an INPUT (`sinceLastFlushMs`) — this module never reads the clock
// (no Date.now) and never uses randomness. Bounded (every tunable is clamped)
// and secret-safe (it only reads numbers/booleans and never interpolates raw
// input into the returned `reason` copy).

// ─── First-flush tunables (chars) ───────────────────────────────────────────

/** Absolute floor on the first-content flush threshold. Never flush a
 *  zero-length buffer; the first paint may fire as early as one real char. */
export const FIRST_FLUSH_MIN_CHARS = 1;
/** Absolute ceiling on the first-content flush threshold. The first paint must
 *  never wait for more than this many chars — TTFT is what the user perceives. */
export const FIRST_FLUSH_MAX_CHARS = 240;
/**
 * Default first-flush threshold when there is NO thinking phase. Small (~a few
 * words) so the very first content the model produces paints almost immediately,
 * but above 1 so a single stray space/punctuation delta doesn't thrash render.
 */
export const DEFAULT_FIRST_FLUSH_CHARS = 12;
/**
 * Default first-flush threshold when a thinking phase WAS detected (and an early
 * ack was therefore emitted). Slightly larger than the no-ack default: the ack
 * already covered perceived latency, so the first CONTENT flush can batch a
 * touch more and spend fewer frames. Kept >= DEFAULT_FIRST_FLUSH_CHARS so this
 * invariant is always true.
 */
export const THINKING_FIRST_FLUSH_CHARS = 24;

// ─── Coalescing tunables ────────────────────────────────────────────────────

/** Default: once this many chars are buffered, flush (stop coalescing). Keeps
 *  frames from being one char each while staying well under a sentence. */
export const DEFAULT_MAX_COALESCE_BUFFER_CHARS = 48;
/** Default: never hold a pending delta longer than this. 60ms sits below the
 *  ~100ms human-perception threshold, so coalescing adds no visible lag. */
export const DEFAULT_MAX_COALESCE_HOLD_MS = 60;
/** Hostile-input clamp: the largest buffer threshold a caller may request. */
export const COALESCE_BUFFER_CHARS_CAP = 4_096;
/** Hostile-input clamp: the longest hold a caller may request (2s absolute). */
export const COALESCE_HOLD_MS_CAP = 2_000;

// ─── Types ──────────────────────────────────────────────────────────────────

/** The decision returned by {@link planFirstFlush}. */
export interface FirstFlushPlan {
  /** Emit an immediate typing/ack signal (e.g. a `phase:"thinking"` SSE frame)
   *  before any content — true when a thinking phase will delay first content. */
  emitEarlyAck: boolean;
  /** Buffered-char count that triggers the FIRST content flush. Bounded to
   *  [FIRST_FLUSH_MIN_CHARS, FIRST_FLUSH_MAX_CHARS]. */
  flushAtChars: number;
  /** Human-readable, secret-safe explanation of the decision (static copy). */
  reason: string;
}

/** Optional tuning for {@link shouldCoalesceDelta}. */
export interface CoalesceOptions {
  /** Flush once the buffer reaches this many chars. Clamped to
   *  [1, COALESCE_BUFFER_CHARS_CAP]; invalid → DEFAULT_MAX_COALESCE_BUFFER_CHARS. */
  maxBufferChars?: number;
  /** Flush once the buffer has been held this many ms. Clamped to
   *  [1, COALESCE_HOLD_MS_CAP]; invalid → DEFAULT_MAX_COALESCE_HOLD_MS. */
  maxHoldMs?: number;
}

// ─── Internal helpers (all hostile-safe: never call user coercion methods) ───

/**
 * Read `key` off an arbitrary value without ever throwing. A hostile input can
 * be a Proxy whose getter throws, so even property access is wrapped. Non-object
 * inputs (and any read that throws) yield `undefined`.
 */
function safeGet(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Coerce to a positive (>= 1) integer, or null. Strict: only genuine finite
 * numbers are accepted (never String()/valueOf on hostile objects). Fractions
 * floor; anything that floors below 1 (incl. 0, 0.5, negatives) → null.
 */
function optPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  return floored >= 1 ? floored : null;
}

/**
 * Coerce to a non-negative (>= 0) integer, else `fallback`. Strict about type;
 * negatives and non-finite/non-number values fall back. Huge finite values pass
 * through (callers only ever COMPARE the result, never allocate against it).
 */
function nonNegInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored >= 0 ? floored : fallback;
}

/** Clamp an already-integer value into an inclusive [min, max] band. */
function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Resolve an optional bounded positive-int tunable: valid positive number →
 * clamped to [1, cap]; anything else → `fallback`.
 */
function optBoundedPositiveInt(value: unknown, fallback: number, cap: number): number {
  const parsed = optPositiveInt(value);
  if (parsed == null) return fallback;
  return parsed > cap ? cap : parsed;
}

// ─── Exports ──────────────────────────────────────────────────────────────

/**
 * Decide the earliest meaningful thing to stream at the START of a chat turn.
 *
 * `emitEarlyAck` is true iff `hasThinkingPhase === true` (strict — only the
 * literal boolean counts, so a stray truthy value can never spam an ack): a
 * reasoning model goes quiet before its first `text_delta`, so an immediate
 * typing/ack signal (e.g. `phase:"thinking"`) shows life NOW instead of an
 * apparently-dead bubble. With no thinking phase, content itself arrives fast, so
 * the ack would be redundant noise.
 *
 * `flushAtChars` is the buffered-char count that triggers the FIRST content
 * flush, always bounded to [FIRST_FLUSH_MIN_CHARS, FIRST_FLUSH_MAX_CHARS]:
 *   - `minFlushChars` (valid positive number) is an explicit caller override —
 *     the minimum chars to buffer before the first flush — used verbatim (then
 *     clamped). Lets a surface tune first-paint aggressiveness.
 *   - otherwise a phase-aware default: DEFAULT_FIRST_FLUSH_CHARS with no
 *     thinking phase (smallest → fastest first paint), THINKING_FIRST_FLUSH_CHARS
 *     when an ack already covered the wait (batch a touch more).
 *
 * `firstDeltaChars` (the size of the model's first content delta, when known) is
 * an OBSERVATION, not a policy: it never changes the numeric threshold, it only
 * sharpens `reason` — noting whether that first delta alone already meets the
 * threshold (flush immediately) or is tiny (accumulate a few more). Policy vs.
 * observation stay cleanly separated so the wiring is a plain
 * `buffered.length >= flushAtChars` check.
 *
 * TOTAL: a non-object / null / hostile `input` (throwing getters included)
 * degrades to the no-thinking default plan; never throws.
 */
export function planFirstFlush(input: {
  hasThinkingPhase?: unknown;
  firstDeltaChars?: unknown;
  minFlushChars?: unknown;
}): FirstFlushPlan {
  const hasThinking = safeGet(input, 'hasThinkingPhase') === true;
  const firstDelta = optPositiveInt(safeGet(input, 'firstDeltaChars'));
  const minFlush = optPositiveInt(safeGet(input, 'minFlushChars'));

  const emitEarlyAck = hasThinking;

  const base = minFlush != null
    ? minFlush
    : (hasThinking ? THINKING_FIRST_FLUSH_CHARS : DEFAULT_FIRST_FLUSH_CHARS);
  const flushAtChars = clampInt(base, FIRST_FLUSH_MIN_CHARS, FIRST_FLUSH_MAX_CHARS);

  let reason: string;
  if (firstDelta != null && firstDelta >= flushAtChars) {
    reason = emitEarlyAck
      ? 'thinking phase — emit early ack; first delta meets the threshold, flush immediately'
      : 'no thinking phase; first delta meets the threshold — flush immediately for fastest first paint';
  } else if (firstDelta != null) {
    reason = emitEarlyAck
      ? 'thinking phase — emit early ack; tiny first delta, accumulate to the threshold'
      : 'no thinking phase; tiny first delta — accumulate to a small threshold before the first flush';
  } else {
    reason = emitEarlyAck
      ? 'thinking phase — emit early ack; first content flush at a small threshold'
      : 'no thinking phase — first flush at a small threshold for fast first paint';
  }

  return { emitEarlyAck, flushAtChars, reason };
}

/**
 * Per-delta batching decision: should the pending buffer keep COALESCING (return
 * `true` → hold, wait for more) or FLUSH NOW (return `false` → emit the buffer as
 * one SSE frame)?
 *
 * Rules, in order:
 *   - empty/degenerate buffer (<= 0 chars, incl. hostile input) → `true` (hold).
 *     There is nothing to flush, so coalescing is the only safe action — this can
 *     never emit an empty SSE frame. As soon as real chars are buffered the two
 *     guards below guarantee a flush, so an empty buffer can't starve output.
 *   - buffer >= `maxBufferChars` → `false` (flush): enough is batched.
 *   - held >= `maxHoldMs` → `false` (flush): more waiting would be perceptible.
 *   - otherwise → `true` (coalesce): small buffer, held only briefly.
 *
 * `maxBufferChars` / `maxHoldMs` default to DEFAULT_MAX_COALESCE_BUFFER_CHARS /
 * DEFAULT_MAX_COALESCE_HOLD_MS and are clamped to their CAPs; invalid opts fall
 * back to the defaults. TOTAL — any hostile input yields a boolean, never throws.
 */
export function shouldCoalesceDelta(
  bufferedChars: unknown,
  sinceLastFlushMs: unknown,
  opts?: CoalesceOptions,
): boolean {
  const buffered = nonNegInt(bufferedChars, 0);
  // Nothing buffered → hold. Never trigger an empty flush; a real buffer is
  // always released by the maxBuffer/maxHold guards below.
  if (buffered <= 0) return true;

  const held = nonNegInt(sinceLastFlushMs, 0);
  const maxBuffer = optBoundedPositiveInt(
    safeGet(opts, 'maxBufferChars'),
    DEFAULT_MAX_COALESCE_BUFFER_CHARS,
    COALESCE_BUFFER_CHARS_CAP,
  );
  const maxHold = optBoundedPositiveInt(
    safeGet(opts, 'maxHoldMs'),
    DEFAULT_MAX_COALESCE_HOLD_MS,
    COALESCE_HOLD_MS_CAP,
  );

  if (buffered >= maxBuffer) return false; // enough batched → flush
  if (held >= maxHold) return false;       // held long enough → flush (avoid lag)
  return true;                             // small & recent → coalesce
}
