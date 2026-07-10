/**
 * toolLoopStuckCore — the ZERO-IMPORT progress-based stuck-detection
 * primitives, extracted from toolLoopStuckBreaker (P61) so Deno edge
 * functions can import them under strict module resolution (the breaker
 * module also pulls appSurfaceLadder for its reminder text, which the edge
 * doesn't need and whose extensionless import Deno rejects).
 *
 * `toolLoopStuckBreaker` re-exports everything here — client consumers keep
 * their existing imports; only edge functions import this file directly.
 *
 * Pure: zero imports, deterministic, bounded, never throws.
 */

/** Max chars of the stable JSON we hash over, so a pathological giant input can
 *  neither blow up memory nor let two huge-but-different inputs collide only
 *  because they share a long identical prefix. */
export const TOOL_INPUT_HASH_MAX_CHARS = 2048;

/**
 * Stable, bounded hash of a tool input for repeat detection. Object keys are
 * sorted (so `{a,b}` and `{b,a}` collide), the JSON is length-bounded, and the
 * result is a short fixed-length string. Deterministic and side-effect free.
 */
export function hashToolInput(input: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(input ?? null, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v).sort().reduce((acc, k) => { (acc as any)[k] = (v as any)[k]; return acc; }, {} as Record<string, unknown>)
        : v,
    );
  } catch {
    json = String(input);
  }
  if (typeof json !== 'string') json = String(json);
  const bounded = json.length > TOOL_INPUT_HASH_MAX_CHARS ? json.slice(0, TOOL_INPUT_HASH_MAX_CHARS) : json;
  // FNV-1a 32-bit over the bounded canonical JSON → stable short digest. We
  // prefix the length so a truncated-prefix collision is astronomically
  // unlikely (differing lengths never collide on the length component).
  let h = 0x811c9dc5;
  for (let i = 0; i < bounded.length; i++) {
    h ^= bounded.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const digest = (h >>> 0).toString(16).padStart(8, '0');
  return `${bounded.length.toString(16)}:${digest}`;
}

/** One entry in a loop's bounded recent-call ring. */
export interface RecentToolCall {
  name: string;
  inputHash: string;
  ok: boolean;
}

export interface RepeatedFailureVerdict {
  stuck: boolean;
  reason: string;
}

/**
 * PROGRESS-based stop signal. Fires when the last `threshold` (default 3) calls
 * are ALL the SAME tool name + SAME input hash + failed. Conservative: never
 * fires on fewer calls, different calls, any success in the window, or a
 * non-contiguous repeat. Only the most recent `threshold` calls are inspected.
 */
export function detectRepeatedToolFailure(
  recentCalls: ReadonlyArray<RecentToolCall> | null | undefined,
  opts: { threshold?: number } = {},
): RepeatedFailureVerdict {
  const list = Array.isArray(recentCalls) ? recentCalls : [];
  const threshold = Math.max(2, Math.floor(opts.threshold ?? 3));
  if (list.length < threshold) return { stuck: false, reason: '' };
  const window = list.slice(-threshold);
  const [first, ...rest] = window;
  if (!first) return { stuck: false, reason: '' };
  if (first.ok) return { stuck: false, reason: '' };
  for (const call of rest) {
    if (call.ok) return { stuck: false, reason: '' };
    if (call.name !== first.name || call.inputHash !== first.inputHash) {
      return { stuck: false, reason: '' };
    }
  }
  return {
    stuck: true,
    reason: `repeated identical failing call — ${first.name} x${threshold}`,
  };
}
