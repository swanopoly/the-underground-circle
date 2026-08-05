/**
 * openswanContextCompactionCore — the PURE decision core for WHEN + WHAT to
 * compact during a long OpenSwan tool loop, so a multi-round run stays under the
 * model's context window instead of growing until the next relay call 400s.
 *
 * WHY THIS EXISTS (the growth problem this fixes):
 *   `agentExecutionCore.runAgent` re-sends the WHOLE `messages: AgentMessage[]`
 *   history on every provider turn (see the loop in agentExecutionCore.ts). A
 *   long `openswanSessionRuntime` session (build/debug/execute lanes) appends an
 *   assistant tool_use turn + a bulky user tool_result turn every round; after a
 *   dozen rounds most of the request is stale tool_result bytes. Anthropic ships
 *   two server-side answers to this (see anthropicContextManagement.ts):
 *   `clear_tool_uses` DROPS old tool results, `compact_20260112` SUMMARISES old
 *   history. This core is the CLIENT-SIDE decision that unifies both: it decides,
 *   from a cheap running token estimate, WHICH message indices to keep verbatim,
 *   which to fold into a summary, and which to drop outright — before the next
 *   round is forwarded.
 *
 * WHAT IT IS (and is NOT):
 *   - A pure planner over a lightweight per-message PROJECTION
 *     ({role, contentLen, isToolResult, referencedLater}) of the real
 *     `AgentMessage[]`. It returns index sets; it never touches message bytes.
 *   - NOT the applier. The caller (openswanSessionRuntime's provider.turn)
 *     applies keep/summarize/drop to the messages it forwards, and — because it
 *     holds the real tool_use/tool_result ids — is responsible for preserving
 *     tool_use↔tool_result pairing when it rebuilds the array (mirroring
 *     agentContextCompression.expandCutForToolPairs) and for flagging
 *     `referencedLater` on any tool_result whose tool_use stays. This core
 *     adds ONE structural pairing guard it CAN make id-free: it never lets the
 *     kept recent suffix START with a tool_result (whose tool_use would sit in
 *     the compacted region → orphan), pulling the boundary back to include it.
 *
 * INVARIANTS (all smoke-pinned):
 *   - TOTAL: every export returns a safe, well-formed value on
 *     null/undefined/wrong-type/huge/hostile/cyclic input and NEVER throws.
 *   - keepIndices ∪ summarizeIndices ∪ dropIndices is an exact partition of
 *     [0, messages.length); each array is sorted ascending (ORDER-PRESERVING).
 *   - NEVER drops (or summarises) the system message, the most-recent
 *     `keepRecentCount` messages, or any `referencedLater` message.
 *   - Under the safety threshold → shouldCompact=false and keepIndices = ALL.
 *   - shouldCompact=true ⟺ over threshold AND at least one message is actually
 *     compactable (so a caller `if (plan.shouldCompact)` is never told to do a
 *     no-op).
 *   - BOUNDED: single O(n) pass; the reason string is length-capped.
 *   - SECRET-SAFE: the reason carries only counts and token numbers, never
 *     message content.
 *
 * PURITY: type-only import (AgentMessage/AgentMessageContentBlock) — tsx-loadable,
 * no runtime deps, no Date.now()/Math.random() at module scope.
 * Smoke: scripts/openswan-context-compaction-core-smoketest.ts.
 */

import type { AgentMessage, AgentMessageContentBlock } from './agentExecutionCore';

// ── Tunables (exported so the loop wiring shares the exact same policy) ─────────

/** Fraction of the context window at/above which compaction is TRIGGERED. 0.75
 *  leaves a comfortable margin so a clear happens BEFORE the window is exhausted,
 *  not after (the same posture as anthropicContextManagement's trigger < window). */
export const CONTEXT_SAFETY_FRACTION = 0.75;

/** Fraction of the window we compact DOWN to once triggered. Must be < the
 *  safety fraction so a single compaction meaningfully drops below the trigger
 *  (avoids re-triggering every round). Freeing stops as soon as the running
 *  estimate reaches this — so only the OLDEST low-value messages are touched. */
export const CONTEXT_TARGET_FRACTION = 0.55;

/** Window used when the caller gives no (or a nonsensical) contextWindowTokens.
 *  200k = Sonnet/Opus default; deliberately conservative. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
/** Clamp bounds for a caller-supplied window (a 4k tiny model … a 2M frontier). */
export const CONTEXT_WINDOW_MIN = 4_000;
export const CONTEXT_WINDOW_MAX = 2_000_000;

/** Most-recent messages preserved verbatim when nothing else is specified.
 *  ~3 user/assistant pairs — enough live tool state for the model to continue. */
export const DEFAULT_KEEP_RECENT_COUNT = 6;
/** Never protect fewer than a live turn's worth, never so many nothing frees. */
export const KEEP_RECENT_MIN = 2;
export const KEEP_RECENT_MAX = 200;

/** Chars→tokens heuristic (Anthropic's published ~4 chars/token for English).
 *  Matches agentContextCompression.DEFAULT_CHARS_PER_TOKEN. Threshold math only —
 *  NEVER for billing. */
export const CHARS_PER_TOKEN = 4;

/** A summarised message is assumed to shrink to ~this fraction of its size, so
 *  summarising frees (1 - this) of its chars. A drop frees all of them. */
export const SUMMARY_KEEP_FRACTION = 0.2;

/** Fixed char weight for one Anthropic image block (P21 screenshot side channel).
 *  ≈ IMAGE_BLOCK_TOKEN_ESTIMATE (1100) × CHARS_PER_TOKEN — a base64 payload must
 *  never be counted by its literal length (which would be ~50× too high). */
export const IMAGE_BLOCK_CHAR_ESTIMATE = 4_400;

/** Reason strings are capped so a pathological run can't bloat telemetry. */
export const MAX_REASON_CHARS = 240;

// ── Public shapes ───────────────────────────────────────────────────────────────

/**
 * Lightweight per-message projection the planner reasons over. Derived from a
 * real `AgentMessage` by `projectMessagesForCompaction`, or hand-built by any
 * caller. All fields optional/loosely typed — the planner normalises every one.
 */
export interface CompactionMessageView {
  /** 'system' is always protected; any other value is treated as compactable. */
  role?: string;
  /** Approx char length of the message content (drives per-message freed est). */
  contentLen?: number;
  /** True when the message carries tool_result block(s) — the bulky, droppable
   *  kind (vs. narrative text/reasoning, which is summarised). */
  isToolResult?: boolean;
  /** True when a message that will REMAIN in context still depends on this one
   *  (e.g. a tool_result whose tool_use stays). Such a message is never dropped
   *  or summarised. The caller (which holds real ids) owns this flag. */
  referencedLater?: boolean;
}

/** Planner input — every field is `unknown` and defensively normalised. */
export interface CompactionInput {
  /** Running token estimate for the whole history. When missing/invalid it is
   *  derived from the sum of `contentLen` values (÷ CHARS_PER_TOKEN). */
  estimatedTokens?: unknown;
  /** The target model's context window (tokens). Clamped; default 200k. */
  contextWindowTokens?: unknown;
  /** The message projections, in order. Non-array → treated as empty. */
  messages?: unknown;
  /** How many trailing messages to preserve verbatim. Clamped [2, 200]; def 6. */
  keepRecentCount?: unknown;
}

/** Planner output — a partition of message indices plus a bounded reason. */
export interface CompactionPlan {
  /** True only when compaction is BOTH warranted (over threshold) and actionable
   *  (at least one message is compactable). */
  shouldCompact: boolean;
  /** Indices to forward verbatim (ascending). When not compacting: ALL indices. */
  keepIndices: number[];
  /** Indices whose content should be folded into a summary block (ascending). */
  summarizeIndices: number[];
  /** Indices to remove outright (ascending). */
  dropIndices: number[];
  /** Human-readable, secret-safe (counts/tokens only), length-capped. */
  reason: string;
}

// ── Internal normalisation ───────────────────────────────────────────────────────

interface NormMsg {
  index: number;
  isSystem: boolean;
  contentLen: number;
  isToolResult: boolean;
  referencedLater: boolean;
}

/** Coerce to a finite number, else `fallback`. Tolerates numeric strings. */
function toFiniteOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function normalizeWindow(value: unknown): number {
  const n = toFiniteOr(value, NaN);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  return clamp(Math.floor(n), CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX);
}

function normalizeKeepRecent(value: unknown): number {
  const n = toFiniteOr(value, NaN);
  if (!Number.isFinite(n)) return DEFAULT_KEEP_RECENT_COUNT;
  return clamp(Math.floor(n), KEEP_RECENT_MIN, KEEP_RECENT_MAX);
}

/**
 * Normalise the messages payload into one NormMsg PER ARRAY SLOT — junk entries
 * become a safe default view (non-system, empty, compactable) rather than being
 * dropped, so returned indices always align with the caller's real array.
 */
function normalizeViews(raw: unknown): NormMsg[] {
  if (!Array.isArray(raw)) return [];
  const out: NormMsg[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const m = raw[i];
    const obj = (m && typeof m === 'object') ? (m as CompactionMessageView) : null;
    const role = obj && typeof obj.role === 'string' ? obj.role.trim().toLowerCase() : '';
    out.push({
      index: i,
      isSystem: role === 'system',
      contentLen: Math.max(0, Math.floor(toFiniteOr(obj ? obj.contentLen : 0, 0))),
      isToolResult: !!(obj && obj.isToolResult === true),
      referencedLater: !!(obj && obj.referencedLater === true),
    });
  }
  return out;
}

function boundedReason(s: string): string {
  return s.length > MAX_REASON_CHARS ? s.slice(0, MAX_REASON_CHARS) : s;
}

// ── Main decision ─────────────────────────────────────────────────────────────────

/**
 * Decide WHEN + WHAT to compact. See the module header for the full contract.
 * Total: never throws; returns a keep-all no-op for empty/degenerate input.
 */
export function planContextCompaction(input: CompactionInput | null | undefined): CompactionPlan {
  const inObj = (input && typeof input === 'object') ? input : {};
  const views = normalizeViews((inObj as CompactionInput).messages);
  const n = views.length;

  const allIndices = (): number[] => {
    const a: number[] = [];
    for (let i = 0; i < n; i += 1) a.push(i);
    return a;
  };
  const keepAll = (reason: string): CompactionPlan => ({
    shouldCompact: false,
    keepIndices: allIndices(),
    summarizeIndices: [],
    dropIndices: [],
    reason: boundedReason(reason),
  });

  // Empty → no-op.
  if (n === 0) {
    return { shouldCompact: false, keepIndices: [], summarizeIndices: [], dropIndices: [], reason: 'no messages to compact' };
  }

  const window = normalizeWindow((inObj as CompactionInput).contextWindowTokens);
  const keepRecent = normalizeKeepRecent((inObj as CompactionInput).keepRecentCount);

  // Running token estimate: caller-supplied, else derived from the views.
  let totalChars = 0;
  for (const v of views) totalChars += v.contentLen;
  let est = toFiniteOr((inObj as CompactionInput).estimatedTokens, NaN);
  if (!Number.isFinite(est) || est < 0) est = Math.ceil(totalChars / CHARS_PER_TOKEN);
  est = Math.max(0, Math.floor(est));

  const trigger = Math.floor(window * CONTEXT_SAFETY_FRACTION);
  const target = Math.floor(window * CONTEXT_TARGET_FRACTION);

  // Under threshold → keep everything.
  if (est <= trigger) {
    return keepAll(`context ${est}t within safety trigger ${trigger}t (window ${window}t) — keeping all ${n} message(s)`);
  }

  // Protected recent suffix. Pair guard: never let the kept suffix START with a
  // tool_result (its tool_use would be in the compacted region → orphaned kept
  // tool_result). Pull the boundary back to include the preceding tool_use.
  let recentStart = Math.max(0, n - keepRecent);
  while (recentStart > 0 && views[recentStart].isToolResult) recentStart -= 1;

  const isProtected = (v: NormMsg): boolean => v.isSystem || v.index >= recentStart || v.referencedLater;

  const candidates: NormMsg[] = [];
  for (const v of views) if (!isProtected(v)) candidates.push(v);

  // Over threshold but nothing compactable (all system/recent/referenced).
  if (candidates.length === 0) {
    return keepAll(`context ${est}t over trigger ${trigger}t but all ${n} message(s) protected (system/last ${keepRecent}/referenced) — nothing to compact`);
  }

  // Free the OLDEST low-value messages first, stopping once the running estimate
  // reaches the target (est > trigger > target guarantees ≥1 candidate is taken).
  // Policy: stale tool_result → DROP (all bytes gone, like clear_tool_uses);
  // narrative text/reasoning → SUMMARISE (fold the gist, like compaction).
  const dropSet = new Set<number>();
  const summarizeSet = new Set<number>();
  let freedChars = 0;
  for (const v of candidates) {
    if (v.isToolResult) {
      dropSet.add(v.index);
      freedChars += v.contentLen;
    } else {
      summarizeSet.add(v.index);
      freedChars += v.contentLen * (1 - SUMMARY_KEEP_FRACTION);
    }
    const running = est - Math.floor(freedChars / CHARS_PER_TOKEN);
    if (running <= target) break;
  }

  // Emit an exact ascending partition.
  const keepIndices: number[] = [];
  const summarizeIndices: number[] = [];
  const dropIndices: number[] = [];
  let refCount = 0;
  for (let i = 0; i < n; i += 1) {
    if (dropSet.has(i)) dropIndices.push(i);
    else if (summarizeSet.has(i)) summarizeIndices.push(i);
    else keepIndices.push(i);
    if (views[i].referencedLater) refCount += 1;
  }

  const shouldCompact = (summarizeIndices.length + dropIndices.length) > 0;
  return {
    shouldCompact,
    keepIndices,
    summarizeIndices,
    dropIndices,
    reason: boundedReason(
      `context ${est}t over trigger ${trigger}t (window ${window}t) — summarize ${summarizeIndices.length}, drop ${dropIndices.length}, keep ${keepIndices.length} (system + last ${keepRecent} + ${refCount} referenced)`,
    ),
  };
}

// ── Real-message adapter (grounds the projection in AgentMessage) ─────────────────

function safeJsonLen(value: unknown): number {
  try {
    return JSON.stringify(value ?? {}).length;
  } catch {
    return 0; // cyclic / non-serialisable input — count nothing rather than throw
  }
}

/**
 * Approx char length of one AgentMessage's content — mirrors the char accounting
 * in agentContextCompression.estimateMessagesTokens (but returns CHARS, and
 * weights an image block by the fixed IMAGE_BLOCK_CHAR_ESTIMATE, never its
 * base64 length). Total: unknown shapes contribute 0.
 */
function measureContentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as AgentMessageContentBlock;
    if (b.type === 'text') {
      chars += typeof b.text === 'string' ? b.text.length : 0;
    } else if (b.type === 'tool_use') {
      chars += safeJsonLen((b as { input?: unknown }).input) + (typeof b.name === 'string' ? b.name.length : 0) + 32;
    } else if (b.type === 'tool_result') {
      const c = (b as { content?: unknown }).content;
      if (typeof c === 'string') {
        chars += c.length + 32;
      } else if (Array.isArray(c)) {
        chars += 32;
        for (const part of c) {
          if (!part || typeof part !== 'object') continue;
          const p = part as { type?: unknown; text?: unknown };
          if (p.type === 'text') chars += typeof p.text === 'string' ? p.text.length : 0;
          else if (p.type === 'image') chars += IMAGE_BLOCK_CHAR_ESTIMATE;
        }
      }
    }
  }
  return chars;
}

function contentHasToolResult(content: unknown): boolean {
  return Array.isArray(content)
    && content.some((b) => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'tool_result');
}

function messageReferences(content: unknown, refIds: Set<string>): boolean {
  if (refIds.size === 0 || !Array.isArray(content)) return false;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; id?: unknown; tool_use_id?: unknown };
    if (b.type === 'tool_result' && typeof b.tool_use_id === 'string' && refIds.has(b.tool_use_id)) return true;
    if (b.type === 'tool_use' && typeof b.id === 'string' && refIds.has(b.id)) return true;
  }
  return false;
}

function collectRefIds(opts: { referencedToolUseIds?: Iterable<string> } | null | undefined): Set<string> {
  const set = new Set<string>();
  const ids = opts && typeof opts === 'object' ? opts.referencedToolUseIds : undefined;
  if (ids && typeof (ids as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    try {
      for (const id of ids as Iterable<unknown>) {
        if (typeof id === 'string' && id) set.add(id);
      }
    } catch {
      /* hostile iterator — ignore, treat as no referenced ids */
    }
  }
  return set;
}

/**
 * Adapter: project a real `AgentMessage[]` into `CompactionMessageView[]` for
 * `planContextCompaction`. One view per input slot (junk entries → safe default),
 * so indices align with the source array. `referencedLater` is set only for
 * messages whose tool_use/tool_result id is in `opts.referencedToolUseIds` (the
 * caller derives that set from ids it intends to keep); with no ids it is false
 * everywhere and the planner relies on its structural protections. Total: a
 * non-array (or null/undefined) returns [].
 */
export function projectMessagesForCompaction(
  messages: readonly AgentMessage[] | null | undefined,
  opts?: { referencedToolUseIds?: Iterable<string> } | null,
): CompactionMessageView[] {
  if (!Array.isArray(messages)) return [];
  const refIds = collectRefIds(opts);
  const out: CompactionMessageView[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') {
      out.push({ role: 'user', contentLen: 0, isToolResult: false, referencedLater: false });
      continue;
    }
    const m = raw as AgentMessage;
    const role = m.role === 'system' || m.role === 'assistant' || m.role === 'user' ? m.role : 'user';
    const content = (m as { content?: unknown }).content;
    out.push({
      role,
      contentLen: measureContentChars(content),
      isToolResult: contentHasToolResult(content),
      referencedLater: messageReferences(content, refIds),
    });
  }
  return out;
}
