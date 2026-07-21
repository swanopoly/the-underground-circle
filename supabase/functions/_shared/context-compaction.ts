// context-compaction — DENO LOCKSTEP MIRROR of the client's tiered pre-turn
// context compaction (src/lib/agentExecutionCore.ts: stubStaleToolResultContents
// + shaveMessagesTextToHardLimit + the plan → drop → unconditional-shave wiring
// in runAgent), specialised to the SIMPLER edge message shape (tool_result
// content is always a plain string; no image parts; system prompt lives OUTSIDE
// `messages` as systemBlocks).
//
// WHY: the swanbot-v2-ai tool loop re-sends the whole message history every
// round (fresh AND resume paths), so a long multi-round coding/computer run can
// exceed the model window and die on an Anthropic 400 "prompt too long". This
// mirror gives the edge loop the same two escalations the client loop has:
//   1. tier 'drop_tool_noise' — free local stub of STALE tool_result bytes
//      (before the protected recent suffix), keeping every message/block and
//      every tool_use/tool_result id in place;
//   2. an UNCONDITIONAL hard-limit shave — text-only largest-first truncation
//      so the forwarded payload always fits `window − reservedOutput`.
// There is NO summariser on the edge, so a planned 'summarize_oldest' degrades
// to drop-only — exactly the client's behaviour when no summariser is injected.
//
// LOCKSTEP: the tier decision + clamps come from the SHARED pure core
// (contextCompactionTierCore) and the text truncation from the SHARED
// promptTokenEstimateCore — both zero-import and Deno-clean, imported directly
// (precedent: index.ts imports v2ToolSelectionCore etc. from src/lib). The
// edge-local executors below mirror the client's byte-for-byte on the common
// (string tool_result) shape; scripts/edge-context-compaction-smoketest.ts
// asserts identical stub/shave outputs against agentExecutionCore on shared
// fixtures. Do NOT import openswanContextCompactionCore or
// agentContextCompression here — their extensionless imports fail `deno check`.
//
// RESUME SAFETY: the stub swaps only a tool_result's CONTENT string and the
// shave cuts only TEXT — tool_use blocks/ids, tool_result tool_use_ids, and
// pendingToolUseIds pairing survive by construction, so a paused run's
// continuation snapshot stays resumable (and gets SMALLER when persisted).

import {
  DEFAULT_KEEP_RECENT_COUNT,
  KEEP_RECENT_MAX,
  KEEP_RECENT_MIN,
  planCompactionTier,
} from "../../../src/lib/contextCompactionTierCore.ts";
import type { CompactionTier } from "../../../src/lib/contextCompactionTierCore.ts";
import { truncateToTokenBudget } from "../../../src/lib/promptTokenEstimateCore.ts";

// ─── Edge message shape (structural match for swanbot-v2-ai/index.ts) ────────

export type EdgeCompactionContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/** Role widened to `string` so the caller's `"user" | "assistant"` union assigns. */
export type EdgeCompactionMessage = { role: string; content: string | EdgeCompactionContentBlock[] };

// ─── Constants (MIRROR agentExecutionCore / agentContextCompression) ─────────

/** Anthropic window assumed for every v2 model (Sonnet/Opus/Haiku ≥ 200k). */
export const EDGE_CONTEXT_WINDOW_TOKENS = 200_000;
/** Chars→tokens heuristic. Threshold math only — NEVER billing. */
const CHARS_PER_TOKEN = 4;
/** Marker prefix for a dropped stale tool_result. Also the idempotency guard. */
export const DROPPED_TOOL_RESULT_MARKER_PREFIX = "[tool result dropped to save context:";
/** Marker appended wherever text was hard-truncated to fit the window. */
export const HARD_TRUNCATE_MARKER_TEXT = "[truncated to fit context window]";
/** Minimal text kept on the FINAL message even in an emergency shave. */
const FINAL_MESSAGE_MIN_KEEP_TEXT_TOKENS = 64;

function droppedToolResultMarker(charsOmitted: number): string {
  return `${DROPPED_TOOL_RESULT_MARKER_PREFIX} ${charsOmitted} chars omitted — re-run the tool if needed]`;
}

function normalizeKeepRecent(keepRecentCount: number | undefined): number {
  const raw = typeof keepRecentCount === "number" && Number.isFinite(keepRecentCount)
    ? Math.floor(keepRecentCount)
    : DEFAULT_KEEP_RECENT_COUNT;
  return Math.min(KEEP_RECENT_MAX, Math.max(KEEP_RECENT_MIN, raw));
}

// ─── Token estimate (mirror of agentContextCompression.estimateMessagesTokens) ─

/** JSON length of a tool_use input; cyclic/non-serialisable counts 0, never throws. */
function safeJsonLen(value: unknown): number {
  try {
    return JSON.stringify(value ?? {}).length;
  } catch {
    return 0;
  }
}

/** Approx char length of one message's content (same per-block accounting the
 *  client uses: text chars; tool_use input JSON + name + 32; tool_result
 *  content + 32). Unknown shapes contribute 0. */
function measureEdgeContentChars(content: string | EdgeCompactionContentBlock[]): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") chars += typeof block.text === "string" ? block.text.length : 0;
    else if (block.type === "tool_use") {
      chars += safeJsonLen(block.input) + (typeof block.name === "string" ? block.name.length : 0) + 32;
    } else if (block.type === "tool_result" && typeof block.content === "string") {
      chars += block.content.length + 32;
    }
  }
  return chars;
}

/** ~4 chars/token whole-history estimate. Same math as the client estimator on
 *  the edge (string tool_result, no images) shape. Threshold triggers only. */
export function estimateEdgeMessagesTokens(messages: EdgeCompactionMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += measureEdgeContentChars(m.content);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// ─── Projection (mirror of openswanContextCompactionCore.projectMessagesForCompaction) ─

/** Per-message views for `planCompactionTier` — one per slot so indices align.
 *  `referencedLater` is false everywhere (parity with the client wiring, which
 *  projects without referenced ids and relies on structural protections). */
export function projectEdgeMessages(messages: EdgeCompactionMessage[]): Array<{
  role: string;
  contentLen: number;
  isToolResult: boolean;
  referencedLater: boolean;
}> {
  if (!Array.isArray(messages)) return [];
  const out: Array<{ role: string; contentLen: number; isToolResult: boolean; referencedLater: boolean }> = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") {
      out.push({ role: "user", contentLen: 0, isToolResult: false, referencedLater: false });
      continue;
    }
    const role = raw.role === "system" || raw.role === "assistant" || raw.role === "user" ? raw.role : "user";
    out.push({
      role,
      contentLen: measureEdgeContentChars(raw.content),
      isToolResult: Array.isArray(raw.content) &&
        raw.content.some((b) => !!b && typeof b === "object" && b.type === "tool_result"),
      referencedLater: false,
    });
  }
  return out;
}

// ─── Tier 'drop_tool_noise' executor (mirror of stubStaleToolResultContents) ──

/**
 * Replaces the CONTENT of every stale tool_result — messages BEFORE the
 * protected recent suffix — with a short "dropped to save context" marker.
 * Same keep-recent clamps and pair-guard walk-back as the tier planner (the
 * kept suffix never STARTS with a tool_result, so its tool_use can't be
 * orphaned into the compacted region). Idempotent (marker prefix guard),
 * skips net-negative stubs, REPLACES touched messages (never mutates), and
 * never removes a message or block — tool pairing survives by construction.
 */
export function stubStaleEdgeToolResults(
  messages: EdgeCompactionMessage[],
  keepRecentCount?: number,
): { stubbedIndices: number[]; freedChars: number } {
  const n = messages.length;
  const keepRecent = normalizeKeepRecent(keepRecentCount);
  const hasToolResult = (m: EdgeCompactionMessage): boolean =>
    Array.isArray(m.content) && m.content.some((b) => !!b && b.type === "tool_result");
  let recentStart = Math.max(0, n - keepRecent);
  while (recentStart > 0 && hasToolResult(messages[recentStart])) recentStart -= 1;

  const stubbedIndices: number[] = [];
  let freedChars = 0;
  for (let mi = 0; mi < recentStart; mi++) {
    const original = messages[mi];
    if (original.role === "system") continue;
    if (typeof original.content === "string") continue; // no tool_result blocks
    let changed = false;
    let freedForMsg = 0;
    const nextBlocks = original.content.map((block): EdgeCompactionContentBlock => {
      if (block.type !== "tool_result" || typeof block.content !== "string") return block;
      if (block.content.startsWith(DROPPED_TOOL_RESULT_MARKER_PREFIX)) return block;
      const marker = droppedToolResultMarker(block.content.length);
      if (block.content.length <= marker.length) return block; // net-negative stub
      changed = true;
      freedForMsg += block.content.length - marker.length;
      return { ...block, content: marker };
    });
    if (changed) {
      messages[mi] = { role: original.role, content: nextBlocks };
      stubbedIndices.push(mi);
      freedChars += freedForMsg;
    }
  }
  return { stubbedIndices, freedChars };
}

// ─── Hard-limit shave (mirror of shaveMessagesTextToHardLimit) ───────────────

/** Chars of TEXT the shave can actually cut (excludes tool_use input JSON and
 *  the per-block overheads). */
function edgeMessageShaveableTextChars(message: EdgeCompactionMessage): number {
  if (typeof message.content === "string") return message.content.length;
  let chars = 0;
  for (const block of message.content) {
    if (block.type === "text") chars += block.text.length;
    else if (block.type === "tool_result" && typeof block.content === "string") chars += block.content.length;
  }
  return chars;
}

/** COPY of `message` with its TEXT truncated to ~budgetTokens (marker appended
 *  where cut). tool_use blocks keep their exact shape — only text is shaved,
 *  so ids/pairing and block structure survive. Never mutates the input. */
function truncateEdgeMessageTextToTokenBudget(
  message: EdgeCompactionMessage,
  budgetTokens: number,
): EdgeCompactionMessage {
  let remaining = Math.max(0, Math.floor(budgetTokens));
  const cut = (text: string): string => {
    const r = truncateToTokenBudget(text, remaining);
    remaining = Math.max(0, remaining - r.estimate);
    if (!r.truncated) return text;
    return r.text ? `${r.text}\n${HARD_TRUNCATE_MARKER_TEXT}` : HARD_TRUNCATE_MARKER_TEXT;
  };
  if (typeof message.content === "string") {
    return { role: message.role, content: cut(message.content) };
  }
  const nextBlocks = message.content.map((block): EdgeCompactionContentBlock => {
    if (block.type === "text") return { ...block, text: cut(block.text) };
    if (block.type === "tool_result" && typeof block.content === "string") {
      return { ...block, content: cut(block.content) };
    }
    return block; // tool_use input is structural, never shaved
  });
  return { role: message.role, content: nextBlocks };
}

/**
 * Post-compaction SAFETY NET: shaves message TEXT until the estimate fits
 * `hardLimitTokens`. Shave order mirrors the client exactly: older non-system
 * messages first (before the keep-recent suffix), then the recent/system
 * remainder — each by estimate descending (index asc tiebreak) — and the FINAL
 * message last, keeping its 64-token minimal core. Each candidate's text
 * budget subtracts its unshaveable tokens; the 64-token margin absorbs marker
 * text + estimator drift. Returns the final live estimate ("still over" when
 * even a full shave can't fit).
 */
export function shaveEdgeMessagesTextToHardLimit(
  messages: EdgeCompactionMessage[],
  hardLimitTokens: number,
  keepRecentCount?: number,
): number {
  let est = estimateEdgeMessagesTokens(messages);
  if (!(hardLimitTokens > 0) || est <= hardLimitTokens || messages.length === 0) return est;

  const n = messages.length;
  const keepRecent = normalizeKeepRecent(keepRecentCount);
  const recentStart = Math.max(0, n - keepRecent);
  const lastIndex = n - 1;

  const order = messages
    .map((m, index) => ({
      index,
      size: estimateEdgeMessagesTokens([m]),
      group: index === lastIndex ? 2 : (m.role !== "system" && index < recentStart ? 0 : 1),
    }))
    .sort((a, b) => (a.group - b.group) || (b.size - a.size) || (a.index - b.index));

  for (const cand of order) {
    if (est <= hardLimitTokens) break;
    const single = estimateEdgeMessagesTokens([messages[cand.index]]);
    const nonTextTokens = Math.max(
      0,
      single - Math.ceil(edgeMessageShaveableTextChars(messages[cand.index]) / CHARS_PER_TOKEN),
    );
    const needed = est - hardLimitTokens;
    const minKeep = cand.index === lastIndex ? FINAL_MESSAGE_MIN_KEEP_TEXT_TOKENS : 0;
    const keepTextTokens = Math.max(minKeep, single - needed - 64 - nonTextTokens);
    messages[cand.index] = truncateEdgeMessageTextToTokenBudget(messages[cand.index], keepTextTokens);
    est = estimateEdgeMessagesTokens(messages);
  }
  return est;
}

// ─── Entry (mirror of the runAgent tiered-compaction wiring) ─────────────────

export interface EdgeCompactionOptions {
  /** Model window MINUS the system-blocks estimate (system is outside messages). */
  contextWindowTokens?: number;
  /** Per-turn max_tokens — reserved output headroom. */
  reservedOutputTokens?: number;
  /** Trailing messages preserved verbatim (default 6, clamped [2, 200]). */
  keepRecentCount?: number;
  /** Current loop iteration (proactive-drop signal past turn 40). */
  turnCount?: number;
}

export interface EdgeCompactionResult {
  /** Effective tier — 'hard_truncate' when the plan said 'none' but the safety
   *  net had to shave. 'none' ⇒ messages are byte-identical (nothing ran). */
  tier: CompactionTier;
  /** Bounded ≤240 chars, counts/tokens only — safe for agent_run_events. */
  reason: string;
  estBefore: number;
  estAfter: number;
  hardLimitTokens: number;
}

/**
 * Pre-turn compaction over the LIVE `messages` array (touched entries are
 * replaced in place, array length never changes): plan the cheapest sufficient
 * tier → free drop-tier stub when any tier fires → UNCONDITIONAL hard-limit
 * shave so the provider never receives an over-window prompt. Total: any
 * internal error degrades to a no-op 'none' result — compaction must never
 * break the loop.
 */
export function compactEdgeMessagesBeforeTurn(
  messages: EdgeCompactionMessage[],
  opts?: EdgeCompactionOptions,
): EdgeCompactionResult {
  try {
    const estBefore = estimateEdgeMessagesTokens(messages);
    const plan = planCompactionTier({
      estimatedTokens: estBefore,
      contextWindowTokens: opts?.contextWindowTokens,
      reservedOutputTokens: opts?.reservedOutputTokens,
      messages: projectEdgeMessages(messages),
      keepRecentCount: opts?.keepRecentCount,
      turnCount: opts?.turnCount,
    });
    // Every tier starts with the free local drop; no summariser exists on the
    // edge, so 'summarize_oldest' degrades to drop-only (client parity).
    if (plan.tier !== "none") stubStaleEdgeToolResults(messages, opts?.keepRecentCount);
    const preNet = estimateEdgeMessagesTokens(messages);
    const estAfter = preNet > plan.hardLimitTokens
      ? shaveEdgeMessagesTextToHardLimit(messages, plan.hardLimitTokens, opts?.keepRecentCount)
      : preNet;
    const stillOver = estAfter > plan.hardLimitTokens;
    const base = { estBefore, estAfter, hardLimitTokens: plan.hardLimitTokens };
    if (plan.tier !== "none") {
      const reason = stillOver
        ? `${plan.reason}; shave exhausted, still over hard ${plan.hardLimitTokens}t`
        : plan.reason;
      return { tier: plan.tier, reason: reason.slice(0, 240), ...base };
    }
    if (preNet > plan.hardLimitTokens) {
      // Plan said 'none' but the live estimate was over the hard limit — the
      // safety net still ran; surface it as a hard_truncate tier (client parity).
      const reason = `tier hard_truncate: safety net, plan none but est ${preNet}t over hard ` +
        `${plan.hardLimitTokens}t${stillOver ? "; shave exhausted, still over" : ""}`;
      return { tier: "hard_truncate", reason: reason.slice(0, 240), ...base };
    }
    return { tier: "none", reason: plan.reason.slice(0, 240), ...base };
  } catch {
    return { tier: "none", reason: "compaction skipped (internal error)", estBefore: 0, estAfter: 0, hardLimitTokens: 0 };
  }
}
