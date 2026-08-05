/**
 * promptCacheSplitCore — de-risks OPTIMIZE #1 of
 * docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md: "Make the prompt cache
 * boundary real" (the single highest-leverage move).
 *
 * The problem this exists to solve
 * --------------------------------
 * `chatPromptAssembly.composeChatSystemPrompt` returns ONE blob —
 *   `base + CHAT_PROMPT_CACHE_BOUNDARY + dynamicExtras` — and the chat-stream
 * edge wraps that whole blob in a single trailing `cache_control` block
 * (`supabase/functions/chat-stream/index.ts`). Because Anthropic prompt caching
 * is a PREFIX match (any byte change anywhere in the prefix invalidates
 * everything after the breakpoint), putting the one breakpoint at the very end
 * caches the volatile per-turn tail too — so the cache key differs every turn
 * and the ~90% input-cost saving is never captured. The boundary is modelled
 * but inert.
 *
 * The fix, as testable pure logic
 * -------------------------------
 * A lane must emit TWO system blocks: a FROZEN prefix (stable personality /
 * rules / capabilities) carrying `cache_control: {type:'ephemeral'}`, and a
 * DYNAMIC tail (per-turn context) with NO cache_control. This module owns:
 *   1. splitPromptAtCacheBoundary  — cut a composed blob at the boundary marker.
 *   2. buildCacheableSystemBlocks  — render the Anthropic system-blocks wire
 *      shape (cache_control ONLY on the frozen block, empty blocks skipped).
 *   3. isVolatileAboveBoundary     — cache-poisoning guard: detect volatile
 *      sections ('## Current Context', chat history, the response directive)
 *      that wrongly sit ABOVE the boundary (swanbot.ts buildSystemPrompt today)
 *      and therefore defeat the cache until they are moved into the tail.
 *
 * Purity contract: zero runtime imports (no `import type` needed), tsx-loadable,
 * bounded (huge/hostile inputs are clamped), secret-safe (only slices strings —
 * never logs, never inspects credential shapes), and TOTAL — every export
 * returns a safe neutral for null/undefined/wrong-type/huge/hostile/cyclic
 * input and never throws. No Date.now()/Math.random() at module scope.
 */

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * The real boundary marker — kept byte-identical with
 * `CHAT_PROMPT_CACHE_BOUNDARY` in `src/lib/chatPromptAssembly.ts` (its line
 * 258-259). Copied rather than imported so this core stays dependency-free /
 * tsx-loadable; the two must move in lockstep. Everything ABOVE this marker in
 * a composed prompt is the cacheable frozen prefix; everything BELOW is the
 * per-turn dynamic tail.
 */
export const DEFAULT_CACHE_BOUNDARY_MARKER =
  '\n\n---\n<!-- dynamic context below — changes per turn -->\n';

/**
 * Section headers / field cues that MUST live in the dynamic tail (they change
 * per turn). If any of these appears in the frozen prefix, the ephemeral cache
 * is poisoned — the prefix bytes differ every turn and never hit. Mirrors the
 * volatile fields swanbot.ts buildSystemPrompt currently emits above the
 * boundary: the live circle/member/task snapshot ('## Current Context'), the
 * recent chat transcript (context.chatHistory → '## Recent Chat Context'), and
 * the per-intent response directive ('## How to Respond').
 */
export const DEFAULT_VOLATILE_MARKERS: readonly string[] = [
  '## Current Context',
  '## Recent Chat Context',
  'chatHistory',
  '## How to Respond',
];

/** Generous upper bound on a system prompt (~2MB) — clamps hostile huge input. */
const MAX_PROMPT_CHARS = 2_000_000;
/** Bound on how many custom markers we scan / return. */
const MAX_MARKERS = 64;
/** Bound on the length of any single scanned marker. */
const MAX_MARKER_CHARS = 512;

// ─── Types ────────────────────────────────────────────────────────────────

export interface PromptCacheSplit {
  /** Everything above the boundary — the cacheable frozen prefix. */
  frozenPrefix: string;
  /** Everything below the boundary — the per-turn dynamic tail. */
  dynamicTail: string;
  /** True when the boundary marker was found and an actual split happened. */
  splitApplied: boolean;
}

/** Anthropic Messages-API system block wire shape. */
export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/**
 * Coerce arbitrary input to a bounded string. Only genuine strings pass
 * through (a non-string "composed prompt" is invalid → safe neutral ''); this
 * deliberately avoids String()/toString() on arbitrary/cyclic/hostile objects
 * so the function can never throw. Huge strings are clamped.
 */
function coerceString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length > MAX_PROMPT_CHARS ? value.slice(0, MAX_PROMPT_CHARS) : value;
}

/**
 * Resolve the volatile-marker list. `undefined`/`null`/non-array → the default
 * set; an explicit array (even empty) is respected and filtered to valid,
 * bounded string markers.
 */
function sanitizeMarkers(markers: unknown): string[] {
  if (!Array.isArray(markers)) return DEFAULT_VOLATILE_MARKERS.slice();
  const out: string[] = [];
  for (const m of markers) {
    if (out.length >= MAX_MARKERS) break;
    if (typeof m !== 'string' || m.length === 0) continue;
    out.push(m.length > MAX_MARKER_CHARS ? m.slice(0, MAX_MARKER_CHARS) : m);
  }
  return out;
}

// ─── Exports ──────────────────────────────────────────────────────────────

/**
 * Split a composed system prompt at the cache boundary. `frozenPrefix` is
 * everything before the marker, `dynamicTail` everything after (the marker
 * itself is a cosmetic separator and is dropped from both). When the marker is
 * absent the whole prompt is treated as frozen with an empty tail and
 * `splitApplied: false` — the safe default, since a prompt with no modelled
 * boundary has no verified-stable/volatile split to trust. The first marker
 * occurrence is used so the frozen prefix stays maximal-yet-stable.
 *
 * Total & bounded: non-string / null / huge / hostile input coerces to '' and
 * yields `{ '', '', false }`.
 */
export function splitPromptAtCacheBoundary(
  composedPrompt: unknown,
  opts?: { boundaryMarker?: string },
): PromptCacheSplit {
  const prompt = coerceString(composedPrompt);
  const rawMarker = opts && typeof opts.boundaryMarker === 'string' ? opts.boundaryMarker : '';
  // Empty/whitespace-free-degenerate markers are ignored (indexOf('') === 0
  // would split at position 0 and hand the whole prompt to the tail).
  const marker = rawMarker.length > 0 ? rawMarker : DEFAULT_CACHE_BOUNDARY_MARKER;

  if (!prompt) return { frozenPrefix: '', dynamicTail: '', splitApplied: false };

  const idx = prompt.indexOf(marker);
  if (idx < 0) return { frozenPrefix: prompt, dynamicTail: '', splitApplied: false };

  return {
    frozenPrefix: prompt.slice(0, idx),
    dynamicTail: prompt.slice(idx + marker.length),
    splitApplied: true,
  };
}

/**
 * Render the Anthropic system-blocks array the chat-stream edge should send:
 * the frozen block carries `cache_control: {type:'ephemeral'}` (the cache
 * breakpoint); the dynamic block carries NONE. Empty/whitespace-only blocks are
 * skipped — so an empty tail yields a single frozen block, an empty frozen
 * prefix yields a single un-cached dynamic block, and both-empty yields `[]`.
 *
 * Total: any non-string input coerces to '' and is skipped.
 */
export function buildCacheableSystemBlocks(
  frozenPrefix: unknown,
  dynamicTail: unknown,
): AnthropicSystemBlock[] {
  const frozen = coerceString(frozenPrefix);
  const tail = coerceString(dynamicTail);
  const blocks: AnthropicSystemBlock[] = [];
  if (frozen.trim().length > 0) {
    blocks.push({ type: 'text', text: frozen, cache_control: { type: 'ephemeral' } });
  }
  if (tail.trim().length > 0) {
    blocks.push({ type: 'text', text: tail });
  }
  return blocks;
}

/**
 * Cache-poisoning guard. Returns the volatile markers that wrongly appear in
 * the frozen prefix (they must be moved below the boundary or the cache never
 * hits). Empty array = the prefix is clean and safe to cache. Order follows the
 * marker list; duplicates in the marker list are reported once.
 *
 * `volatileMarkers` defaults to DEFAULT_VOLATILE_MARKERS; pass an explicit list
 * to check lane-specific fields. Total & bounded for hostile input.
 */
export function isVolatileAboveBoundary(
  frozenPrefix: unknown,
  volatileMarkers?: string[],
): string[] {
  const frozen = coerceString(frozenPrefix);
  if (!frozen) return [];
  const markers = sanitizeMarkers(volatileMarkers);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const marker of markers) {
    if (seen.has(marker)) continue;
    seen.add(marker);
    if (frozen.includes(marker)) found.push(marker);
  }
  return found;
}
