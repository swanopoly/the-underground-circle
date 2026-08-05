/**
 * chatStopMessageCore — pure user-facing stop-message resolver for SwanBot chat.
 *
 * Today, failed/capped/stuck turns end with raw dead-end strings — some
 * ADDRESSED TO THE MODEL but shown to the user verbatim ("Ask me to continue
 * and I will start from fresh evidence."), some bare dev jargon ("Tool-use
 * call failed.", "Too many client-side continuation rounds.") — and none
 * carry an actionable follow-up. This core maps every stop reason to a
 * friendly 1-2 sentence user message plus quick-reply labels and a
 * canContinue flag, and provides detection + humanization for legacy
 * model-directed / internal stop text arriving from the edges.
 *
 * Callers (wiring):
 *  - `swanBotV2ClientToolStopMessage` in src/lib/swanbot.ts (~line 1081):
 *    delegate to resolveChatStopMessage('continuation_failed' |
 *    'continuation_cap') — aliases are accepted — and surface
 *    quickReplies/canContinue to the chat UI.
 *  - src/lib/swanbot.ts (~line 4202): replace
 *    `data?.response || 'Tool-use call failed.'` with
 *    `humanizeStopText(data?.response, 'tool_use_failed')`.
 *
 * PURITY (load-bearing — smoke runs under tsx/esbuild):
 *  - Zero runtime imports; zero side effects at import; deterministic
 *    (no Date.now/Math.random anywhere).
 *  - Every export is TOTAL: never throws on null/undefined/wrong-type/huge
 *    input; output is bounded (messages < 280 chars, <= 3 quick replies).
 */

export type ChatStopReason =
  | 'v2_continuation_failed'
  | 'v2_continuation_cap'
  | 'step_cap'
  | 'truncated_tool_call'
  | 'interrupted_stream'
  | 'tool_use_failed'
  | 'stuck_loop'
  | 'edge_unreachable';

export interface ChatStopResolution {
  /** Friendly user-facing stop message, 1-2 sentences, always < 280 chars. */
  message: string;
  /** Actionable quick-reply button labels, at most 3, each <= 40 chars. */
  quickReplies: string[];
  /** True when resuming the same run makes sense (Continue is offered). */
  canContinue: boolean;
}

/** Canonical quick-reply labels so chat UI buttons stay consistent. */
export const CHAT_STOP_QUICK_REPLIES: { continue: string; retry: string; fresh: string } =
  Object.freeze({
    continue: 'Continue',
    retry: 'Try again',
    fresh: 'Start fresh',
  });

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Hard cap on any surfaced message: strictly under 280 chars. */
const MESSAGE_MAX = 279;
const QUICK_REPLIES_MAX = 3;
const LABEL_MAX = 40;
const TOOL_NAME_MAX = 48;
const DETAIL_MAX = 120;
/** Bounded scan window for cue matching / inference on huge inputs. */
const SCAN_MAX = 4000;

// ---------------------------------------------------------------------------
// Cue lists
// ---------------------------------------------------------------------------

/** Phrases that read as an instruction to the MODEL, never fit for users. */
const MODEL_DIRECTED_CUES: readonly string[] = [
  'you should',
  'you must',
  'ask me to continue',
  'the model',
  'the assistant',
  'fresh observation',
  'do not repeat',
  'i stopped instead of',
  'falling back to legacy',
  'client-tool continuation',
];

/** Raw internal/dev dead-end strings that must never reach the user as-is. */
const INTERNAL_DEAD_END_CUES: readonly string[] = [
  'tool-use call failed',
  'client-side continuation',
  'continuation rounds',
  'continuation limit',
  'continuation run',
  'legacy swanbot',
  'swanbot v2',
];

// ---------------------------------------------------------------------------
// Small total helpers
// ---------------------------------------------------------------------------

function collapseWs(s: string): string {
  return s
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cap text to `max` chars; when truncated, end with a single '…'. */
function capText(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).replace(/\s+$/, '')}…`;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Lowercased, whitespace-collapsed, bounded scan text ('' for non-strings). */
function scanText(text: unknown): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  return collapseWs(text.slice(0, SCAN_MAX)).toLowerCase();
}

function containsAnyCue(scan: string, cues: readonly string[]): boolean {
  if (!scan) return false;
  for (const cue of cues) {
    if (scan.includes(cue)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-reason specs
// ---------------------------------------------------------------------------

interface StopSpec {
  message: string;
  /** Optional template when a sanitized tool name is available. */
  withTool?: (tool: string) => string;
  canContinue: boolean;
  quickReplies: readonly string[];
}

const CONTINUE_REPLIES: readonly string[] = [
  CHAT_STOP_QUICK_REPLIES.continue,
  CHAT_STOP_QUICK_REPLIES.fresh,
];
const RETRY_REPLIES: readonly string[] = [CHAT_STOP_QUICK_REPLIES.retry];

const GENERIC_SPEC: StopSpec = {
  message:
    'This turn stopped before I could finish. Try again in a moment — if it keeps happening, start a fresh chat.',
  canContinue: false,
  quickReplies: RETRY_REPLIES,
};

const STOP_SPECS: Record<ChatStopReason, StopSpec> = {
  v2_continuation_failed: {
    message:
      "I finished a local tool step, but the follow-up request didn't complete, so I paused to avoid repeating any actions. Tap Continue and I'll pick up from the latest state.",
    canContinue: true,
    quickReplies: CONTINUE_REPLIES,
  },
  v2_continuation_cap: {
    message:
      'This turn hit its limit of back-to-back tool rounds, so I paused before repeating any desktop or browser actions. Tap Continue to resume, or start fresh.',
    canContinue: true,
    quickReplies: CONTINUE_REPLIES,
  },
  step_cap: {
    message:
      'I reached the step limit for a single turn before finishing. Tap Continue to keep going from here, or start fresh to reset.',
    canContinue: true,
    quickReplies: CONTINUE_REPLIES,
  },
  truncated_tool_call: {
    message:
      "My last action was cut off before it finished sending. Tap Continue and I'll redo just that step.",
    withTool: (tool) =>
      `The ${tool} step was cut off before it finished sending. Tap Continue and I'll redo just that step.`,
    canContinue: true,
    quickReplies: CONTINUE_REPLIES,
  },
  interrupted_stream: {
    message:
      "The connection dropped while I was writing my reply. Tap Continue and I'll pick up where it left off.",
    canContinue: true,
    quickReplies: CONTINUE_REPLIES,
  },
  tool_use_failed: {
    message:
      'A tool step failed, so I stopped this turn early. Try again in a moment, or tell me to take a different approach.',
    withTool: (tool) =>
      `The ${tool} step failed, so I stopped this turn early. Try again in a moment, or tell me to take a different approach.`,
    canContinue: false,
    quickReplies: RETRY_REPLIES,
  },
  stuck_loop: {
    message:
      "I stopped because my last few attempts weren't making progress, and repeating them wouldn't help. Try again with a bit more detail, or start fresh.",
    canContinue: false,
    quickReplies: [CHAT_STOP_QUICK_REPLIES.retry, CHAT_STOP_QUICK_REPLIES.fresh],
  },
  edge_unreachable: {
    message:
      "I couldn't reach the server to finish this turn. Check your connection and try again in a moment.",
    canContinue: false,
    quickReplies: RETRY_REPLIES,
  },
};

/** Runtime aliases so existing internal reason ids wire in without renames. */
const REASON_ALIASES: Record<string, ChatStopReason> = {
  continuation_failed: 'v2_continuation_failed',
  continuation_cap: 'v2_continuation_cap',
  max_iterations: 'step_cap',
  hit_max_iterations: 'step_cap',
  max_steps: 'step_cap',
  loop_stopped_no_progress: 'stuck_loop',
  no_progress: 'stuck_loop',
  tool_failed: 'tool_use_failed',
  stream_interrupted: 'interrupted_stream',
  max_tokens: 'truncated_tool_call',
  edge_failed: 'edge_unreachable',
  network_error: 'edge_unreachable',
};

function normalizeStopReason(reason: unknown): ChatStopReason | null {
  if (typeof reason !== 'string' || reason.length === 0) return null;
  const key = reason.slice(0, 64).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  if (hasOwn(STOP_SPECS, key)) return key as ChatStopReason;
  if (hasOwn(REASON_ALIASES, key)) return REASON_ALIASES[key] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Option sanitizers
// ---------------------------------------------------------------------------

function sanitizeToolName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const cleaned = collapseWs(v.slice(0, 200)).replace(/[^\w ./:-]+/g, '').trim();
  if (!cleaned) return null;
  return capText(cleaned, TOOL_NAME_MAX);
}

function sanitizeDetail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const cleaned = collapseWs(v.slice(0, 600));
  if (!cleaned) return null;
  const scan = cleaned.toLowerCase();
  // Never surface model-directed notes or raw internal jargon as detail.
  if (containsAnyCue(scan, MODEL_DIRECTED_CUES)) return null;
  if (containsAnyCue(scan, INTERNAL_DEAD_END_CUES)) return null;
  return capText(cleaned, DETAIL_MAX);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Resolve a stop reason (canonical id, known internal alias, or anything
 * else) into the user-facing message + quick replies + canContinue flag.
 * Unknown/garbage reasons yield the safe generic resolution. Never throws.
 */
export function resolveChatStopMessage(
  reason: ChatStopReason | string,
  opts?: { toolName?: string; detail?: string },
): ChatStopResolution {
  const normalized = normalizeStopReason(reason);
  const spec = normalized ? (STOP_SPECS[normalized] ?? GENERIC_SPEC) : GENERIC_SPEC;

  // Hostile opts objects (throwing getters, non-objects) must not break us.
  let toolNameRaw: unknown;
  let detailRaw: unknown;
  if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
    try {
      toolNameRaw = (opts as { toolName?: unknown }).toolName;
      detailRaw = (opts as { detail?: unknown }).detail;
    } catch {
      toolNameRaw = undefined;
      detailRaw = undefined;
    }
  }

  const tool = sanitizeToolName(toolNameRaw);
  let message = tool && spec.withTool ? spec.withTool(tool) : spec.message;
  const detail = sanitizeDetail(detailRaw);
  if (detail) message = `${message} (${detail})`;

  return {
    message: capText(message, MESSAGE_MAX),
    quickReplies: spec.quickReplies.slice(0, QUICK_REPLIES_MAX).map((l) => capText(l, LABEL_MAX)),
    canContinue: spec.canContinue === true,
  };
}

/**
 * True when the text reads as an instruction to the MODEL rather than a
 * message for the user ("you should", "ask me to continue", "the model",
 * "fresh observation", "do not repeat", "I stopped instead of", ...).
 * Non-strings and empty strings are false. Never throws.
 */
export function isLikelyModelDirectedNote(text: unknown): boolean {
  return containsAnyCue(scanText(text), MODEL_DIRECTED_CUES);
}

// Distinctive prefixes of every generated stop message — enough to identify a
// resolution the pipeline emitted (detail/tool variants only APPEND), so the
// UI can attach the matching recovery chips. Long + specific → no false hits.
const STOP_MESSAGE_SIGNATURES: ReadonlyArray<{ prefix: string; reason: ChatStopReason }> = [
  { prefix: "I finished a local tool step, but the follow-up", reason: 'v2_continuation_failed' },
  { prefix: 'This turn hit its limit of back-to-back tool rounds', reason: 'v2_continuation_cap' },
  { prefix: 'I reached the step limit for a single turn', reason: 'step_cap' },
  { prefix: 'My last action was cut off', reason: 'truncated_tool_call' },
  { prefix: 'The ', reason: 'truncated_tool_call' }, // withTool variants ("The <tool> step was cut off / failed …")
  { prefix: 'The connection dropped while I was writing', reason: 'interrupted_stream' },
  { prefix: 'A tool step failed, so I stopped', reason: 'tool_use_failed' },
  { prefix: "I stopped because my last few attempts", reason: 'stuck_loop' },
  { prefix: "I couldn't reach the server to finish", reason: 'edge_unreachable' },
  { prefix: 'This turn stopped before I could finish', reason: 'stuck_loop' }, // GENERIC → retry/fresh
];

/**
 * If `text` is a message this core generated (a stop resolution), return that
 * resolution so the UI can attach the recovery quick-replies; else null. The
 * 'The ' prefix only matches when the sentence also reads like a cut-off/failed
 * step, to avoid catching ordinary answers that begin with "The". Never throws.
 */
export function matchStopResolution(text: unknown): ChatStopResolution | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t.length < 24 || t.length > MESSAGE_MAX + 8) return null; // stop copy is one short paragraph
  for (const sig of STOP_MESSAGE_SIGNATURES) {
    if (!t.startsWith(sig.prefix)) continue;
    if (sig.prefix === 'The ') {
      const lower = t.toLowerCase();
      // The two withTool variants share "The <tool> step …"; route by each
      // template's distinctive tail so 'cut off' → truncated_tool_call and
      // 'failed' → tool_use_failed (non-continuable — so a failed turn doesn't
      // get a 'Continue' chip), and ordinary answers lacking these exact tails
      // fall through instead of all matching truncated_tool_call.
      if (lower.includes('step was cut off before it finished sending')) {
        return resolveChatStopMessage('truncated_tool_call');
      }
      if (lower.includes('step failed, so i stopped this turn early')) {
        return resolveChatStopMessage('tool_use_failed');
      }
      continue;
    }
    return resolveChatStopMessage(sig.reason);
  }
  return null;
}

/** Internal: raw dev/edge dead-end strings that should never reach the user. */
function isInternalDeadEndText(text: unknown): boolean {
  return containsAnyCue(scanText(text), INTERNAL_DEAD_END_CUES);
}

/** Best-effort stop-reason inference from legacy stop text (internal). */
function inferStopReason(scan: string): ChatStopReason | null {
  if (!scan) return null;
  if (scan.includes('continuation')) {
    if (
      scan.includes('cap') ||
      scan.includes('limit') ||
      scan.includes('too many') ||
      scan.includes('rounds')
    ) {
      return 'v2_continuation_cap';
    }
    return 'v2_continuation_failed';
  }
  if (scan.includes('tool-use call failed') || (scan.includes('tool') && scan.includes('fail'))) {
    return 'tool_use_failed';
  }
  if (scan.includes('no progress') || scan.includes('stuck')) return 'stuck_loop';
  if (scan.includes('max iterations') || scan.includes('iteration limit') || scan.includes('step limit')) {
    return 'step_cap';
  }
  return null;
}

/**
 * Make arbitrary stop text safe to show the user. Model-directed notes, raw
 * internal dead-end strings, and empty/non-string input are replaced with a
 * clean sentence via resolveChatStopMessage (using fallbackReason when given,
 * else a bounded inference from the text, else the generic resolution).
 * Clean text passes through trimmed and bounded (< 280 chars). Never throws.
 */
export function humanizeStopText(text: unknown, fallbackReason?: ChatStopReason): string {
  const raw = typeof text === 'string' ? text.slice(0, SCAN_MAX).trim() : '';
  const scan = scanText(raw);
  const unsafe =
    !scan ||
    containsAnyCue(scan, MODEL_DIRECTED_CUES) ||
    containsAnyCue(scan, INTERNAL_DEAD_END_CUES);
  if (unsafe) {
    const reason = normalizeStopReason(fallbackReason) ?? inferStopReason(scan);
    return resolveChatStopMessage(reason ?? '').message;
  }
  return capText(raw, MESSAGE_MAX);
}
