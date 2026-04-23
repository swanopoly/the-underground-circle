/**
 * agentContextCompression — Phase CA-8a of `PHASE_CA-8_HERMES_DELTA_PLAN`.
 *
 * Before each provider turn, check whether the running message history
 * is over the configured `thresholdRatio` of `maxContextTokens`. If so,
 * summarise the oldest half via a cheap summariser (Haiku by default)
 * and replace it with a single `role: 'user'` `[context-summary]` block
 * while preserving the last `preserveLast` messages verbatim.
 *
 * Design rules:
 *   1. **Pure core, injected summariser.** The module takes a summariser
 *      callback so it's testable in Node without touching Anthropic.
 *   2. **Always preserve the tail.** The last N messages stay exact —
 *      that's where the model's current tool state + reasoning lives.
 *   3. **Never split tool_use/tool_result.** A `tool_use` with no
 *      matching `tool_result` (or vice-versa) will crash the next
 *      provider turn. We expand the split-point as needed.
 *   4. **Drop on compression failure.** If the summariser throws, we
 *      return `compressed: false` with the original messages — the
 *      caller proceeds with the uncompressed context rather than a
 *      corrupted one.
 */

import type { AgentMessage, AgentMessageContentBlock } from './agentExecutionCore';

export interface CompressContextOptions {
  /** Fraction of `maxContextTokens` that triggers compression. Default 0.50. */
  thresholdRatio?: number;
  /** Target model's context window. Default 200_000 (Sonnet / Opus). */
  maxContextTokens?: number;
  /** Tail messages preserved verbatim. Default 20. */
  preserveLast?: number;
  /**
   * Summariser — takes the messages we want to compress and returns a
   * concise plain-text recap. The caller provides this so the lib stays
   * testable offline; in production, wrap Haiku here.
   */
  summariser: (messagesToCompress: AgentMessage[]) => Promise<string>;
  /** Token counter override. Default: 4 chars/token heuristic. */
  countTokens?: (messages: AgentMessage[]) => number;
}

export interface CompressContextResult {
  compressed: boolean;
  messages: AgentMessage[];
  summary?: string;
  droppedCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

const DEFAULT_CHARS_PER_TOKEN = 4;
const MIN_DROP_COUNT = 4;  // not worth summarising fewer than this

// ─── Token counter ─────────────────────────────────────────────────────────

/** Simple char-to-token estimator. Same ~4 chars/token ratio Anthropic
 *  publishes for English. Good enough for threshold triggers; NEVER use
 *  this for billing. */
export function estimateMessagesTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
      continue;
    }
    for (const block of m.content) {
      if (block.type === 'text') chars += block.text.length;
      else if (block.type === 'tool_use') chars += JSON.stringify(block.input || {}).length + block.name.length + 32;
      else if (block.type === 'tool_result') chars += block.content.length + 32;
    }
  }
  return Math.ceil(chars / DEFAULT_CHARS_PER_TOKEN);
}

// ─── Main entry point ──────────────────────────────────────────────────────

export async function compressContextIfOversized(
  messages: AgentMessage[],
  opts: CompressContextOptions,
): Promise<CompressContextResult> {
  const thresholdRatio  = opts.thresholdRatio  ?? 0.50;
  const maxTokens       = opts.maxContextTokens ?? 200_000;
  const preserveLast    = Math.max(2, opts.preserveLast ?? 20);
  const count           = opts.countTokens ?? estimateMessagesTokens;

  const before = count(messages);
  const threshold = Math.floor(maxTokens * thresholdRatio);

  // Fast path — under threshold, nothing to do.
  if (before <= threshold) {
    return {
      compressed: false,
      messages,
      droppedCount: 0,
      tokensBefore: before,
      tokensAfter: before,
    };
  }
  // Small history but oversized individual messages — nothing we can do;
  // returning early avoids summarising a 2-message thread.
  if (messages.length <= preserveLast + MIN_DROP_COUNT) {
    return {
      compressed: false,
      messages,
      droppedCount: 0,
      tokensBefore: before,
      tokensAfter: before,
    };
  }

  // Split — everything up to `cutIndex` gets compressed; from there to
  // the end stays verbatim. Expand cutIndex as needed so we don't
  // orphan a `tool_use` from its `tool_result`.
  let cutIndex = messages.length - preserveLast;
  cutIndex = expandCutForToolPairs(messages, cutIndex);

  // If expansion consumed too much, bail.
  if (messages.length - cutIndex < 2) {
    return {
      compressed: false,
      messages,
      droppedCount: 0,
      tokensBefore: before,
      tokensAfter: before,
    };
  }

  const toCompress = messages.slice(0, cutIndex);
  const tail       = messages.slice(cutIndex);

  let summary: string;
  try {
    summary = (await opts.summariser(toCompress)).trim();
  } catch {
    return {
      compressed: false,
      messages,
      droppedCount: 0,
      tokensBefore: before,
      tokensAfter: before,
    };
  }

  if (!summary) {
    return {
      compressed: false,
      messages,
      droppedCount: 0,
      tokensBefore: before,
      tokensAfter: before,
    };
  }

  const compressedMessage: AgentMessage = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: [
          '[context-summary] The earlier portion of this conversation has been condensed to save tokens.',
          `Messages summarised: ${toCompress.length}. Preserved tail: ${tail.length}.`,
          '',
          summary,
        ].join('\n'),
      },
    ],
  };

  const nextMessages = [compressedMessage, ...tail];
  const after = count(nextMessages);

  return {
    compressed: true,
    messages: nextMessages,
    summary,
    droppedCount: toCompress.length,
    tokensBefore: before,
    tokensAfter: after,
  };
}

// ─── Tool-pair protection ──────────────────────────────────────────────────

/**
 * Walks backwards from `cutIndex` so we don't split across a
 * `tool_use` that expects a later `tool_result` (or vice-versa).
 * Preserves turn pairs by moving the cut later in the list.
 */
function expandCutForToolPairs(messages: AgentMessage[], cutIndex: number): number {
  let idx = Math.max(0, Math.min(cutIndex, messages.length));
  // The orphan-set: any tool_use id in `toCompress` whose matching
  // tool_result is in `tail`, or any tool_result in `toCompress` whose
  // matching tool_use is in `tail`. We widen `idx` forward until both
  // halves are self-contained.
  let guard = 0;
  while (guard++ < messages.length) {
    const head = messages.slice(0, idx);
    const tail = messages.slice(idx);
    const headIds = collectIds(head);
    const tailIds = collectIds(tail);
    // If any id appears in both halves, we have a split pair — slide
    // `idx` to include the offending message in the tail.
    const splitIds = new Set<string>();
    for (const id of headIds.toolUses) if (tailIds.toolResults.has(id)) splitIds.add(id);
    for (const id of headIds.toolResults) if (tailIds.toolUses.has(id)) splitIds.add(id);
    if (splitIds.size === 0) return idx;
    // Find the earliest head message that carries a split id; push idx
    // back so that message lives in the tail instead.
    let earliest = idx;
    for (let i = idx - 1; i >= 0; i--) {
      const blocks = normaliseBlocks(messages[i].content);
      for (const b of blocks) {
        if (b.type === 'tool_use' && splitIds.has(b.id)) earliest = Math.min(earliest, i);
        if (b.type === 'tool_result' && splitIds.has(b.tool_use_id)) earliest = Math.min(earliest, i);
      }
    }
    if (earliest >= idx) return idx;
    idx = earliest;
  }
  return idx;
}

function normaliseBlocks(content: AgentMessage['content']): AgentMessageContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content;
}

function collectIds(messages: AgentMessage[]): {
  toolUses: Set<string>;
  toolResults: Set<string>;
} {
  const toolUses = new Set<string>();
  const toolResults = new Set<string>();
  for (const m of messages) {
    const blocks = normaliseBlocks(m.content);
    for (const b of blocks) {
      if (b.type === 'tool_use') toolUses.add(b.id);
      else if (b.type === 'tool_result') toolResults.add(b.tool_use_id);
    }
  }
  return { toolUses, toolResults };
}
