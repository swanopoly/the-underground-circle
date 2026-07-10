/**
 * AgentExecutionCore — typed tool-use loop. Phase 1 of the Hermes-inspired
 * OpenSwan rewrite (see `docs/HERMES_INTEGRATION_PLAN.md`).
 *
 * What it does:
 *   1. Takes a provider that implements `streamTurn(messages, tools)`.
 *   2. Loops up to `maxIterations` times. On each turn:
 *      - Calls the provider.
 *      - If the provider returns tool_use blocks: dispatches each tool in
 *        parallel (or sequentially if the tool is marked interactive),
 *        appends `tool_result` blocks, and re-calls.
 *      - If the provider returns a plain text response: returns it.
 *   3. Emits events to the caller-supplied `onEvent` handler so the UI /
 *      edge function can stream progress into chat.
 *
 * What it does NOT do:
 *   - Talk to Anthropic / OpenAI directly. The provider is injected so this
 *     file stays testable with a mock and reusable across surfaces
 *     (edge functions, client-side bridge, Node tests).
 *   - Manage memory, skills, verification, or subagents. Those live in
 *     their own modules and are composed via tools the caller registers
 *     in the shared `openswanToolRuntime` registry.
 *
 * Hermes parity notes:
 *   - Parallel dispatch mirrors Hermes' `ThreadPoolExecutor(max_workers=8)`
 *     model; here we use Promise.all with a simple concurrency cap.
 *   - Tool results are JSON envelopes `{ok, data}` or `{ok: false, error}` —
 *     we never let a tool throw across the provider boundary, matching
 *     Hermes' registry.dispatch contract.
 *   - Max-iterations escape hatch mirrors Hermes' default 90-iter cap (we
 *     start at 25; edge-function consumers can lower to 8 for Haiku).
 */

import { compressContextIfOversized, PRUNED_IMAGE_PLACEHOLDER_TEXT } from './agentContextCompression';
import { partitionParallelSafeBatch } from './toolBatchParallelism';
import type { ToolParallelPolicy } from './toolBatchParallelism';
import { buildToolFailureFeedback } from './toolFailureFeedback';
import { detectRepeatedToolFailure, hashToolInput, type RecentToolCall } from './toolLoopStuckBreaker';
import { buildSolverConsultationMessage, previewToolInput, shouldConsultSolver } from './toolLoopSolver';

/** Bounded recent-call ring size for progress-based stuck detection. Big enough
 *  to hold the last few rounds' calls, small enough to stay cheap. */
const RECENT_TOOL_CALL_RING_MAX = 24;

/**
 * tool_result content part — EXACT Anthropic Messages API shape (P21 image
 * side channel). Providers that relay messages verbatim (the swanbot-ai
 * transport, agentProviders/anthropic) can pass these through untouched and
 * the model sees real pixels instead of a JSON-stringified base64 bomb.
 */
export type AgentToolResultContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export type AgentMessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | AgentToolResultContentPart[]; is_error?: boolean };

export type AgentMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string | AgentMessageContentBlock[];
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema (subset) for input validation and provider tool advertising. */
  input_schema: Record<string, unknown>;
  /** Optional Anthropic `input_examples` (X4/P47) — schema-validated example
   *  inputs advertised alongside the schema; providers forward when present. */
  input_examples?: Array<Record<string, unknown>>;
  /** Dispatch handler. MUST NOT throw — wrap errors as `{ok: false, error}`. */
  handler: (input: unknown, ctx: AgentToolContext) => Promise<AgentToolResult>;
  /**
   * Interactive tools (e.g. a `clarify` prompt) must not run in parallel
   * with anything else since they block on user input. Default false.
   */
  interactive?: boolean;
};

export type AgentToolContext = {
  /** Opaque, caller-supplied. Persist circleId, userId, auth, etc. here. */
  session: Record<string, unknown>;
  /** Monotonic iteration counter (0-indexed). */
  iteration: number;
};

export type AgentToolResult =
  | { ok: true; data: unknown; metadata?: Record<string, unknown> }
  | { ok: false; error: string; metadata?: Record<string, unknown> };

export type AgentToolApprovalDecision =
  | { decision: 'approve' }
  | { decision: 'reject'; reason?: string };

/**
 * Pre-dispatch approval gate (R11). Runs AFTER the model requests a tool but
 * BEFORE the handler executes, preserving the fail-closed pre-dispatch
 * semantics `openswanSessionRuntime`'s legacy loop has (its gate at the
 * `executeToolUseLoop` boundary). A rejection produces a tool_result that
 * reads as a POLICY BLOCK — not a transient error — so the model does not
 * retry the same call. If the gate itself throws, the tool is rejected
 * (fail closed), never silently approved.
 */
export type AgentToolApprovalGate = (req: {
  toolName: string;
  toolUseId: string;
  input: unknown;
  iteration: number;
}) => AgentToolApprovalDecision | Promise<AgentToolApprovalDecision>;

/**
 * QW1 (mirror of `executeToolUseLoop`'s always-on constraint/floor check). A
 * HARD pre-dispatch verdict computed BEFORE the approval gate — the loop-level
 * enforcement of the user's "never do X" constraints and the always-confirm
 * floor (pay/delete/login/grant), rather than trusting prompt rules alone.
 *
 * This core stays provider- and product-agnostic, so the actual verdict is
 * injected: the chat/session adapter wires it to
 * `chatComputerRequestRouter.constraintBlocksToolCall` (with the turn's
 * `userConstraints` + `alwaysConfirmFloor`). Return:
 *   - `{ block: true, reason }` → the tool is refused with a POLICY-BLOCK
 *     tool_result (not a transient error) so the model does not retry it;
 *   - `{ requireApproval: true, reason }` → the always-confirm floor tripped;
 *     the tool is refused with a "confirmation required, not performed"
 *     tool_result. (This core has no approval-pause primitive of its own — the
 *     adapter that owns `agent_run_approvals` requests the actual approval; here
 *     we fail closed so the floored action never runs unconfirmed.)
 *   - `undefined` / `{ block: false }` → allow (then the approval gate runs).
 * A guard that throws fails closed (blocks) — never a silent allow.
 */
export type AgentToolConstraintVerdict =
  | { block?: false; requireApproval?: false }
  | { block: true; reason?: string }
  | { block?: false; requireApproval: true; reason?: string }
  | void
  | undefined;

export type AgentToolConstraintGuard = (req: {
  toolName: string;
  toolUseId: string;
  input: unknown;
  iteration: number;
}) => AgentToolConstraintVerdict | Promise<AgentToolConstraintVerdict>;

/**
 * Round-boundary hook (O1 nudge parity). Fired after a tool round's results
 * are appended (and `iteration_complete` is emitted) but BEFORE the next
 * provider turn, so adapters can inject round-boundary guidance the way the
 * legacy `executeToolUseLoop` did inside its loop body (tool-budget reminder,
 * proof-coverage nudge, deterministic re-observe note). Returning
 * `appendUserNote` makes the core append exactly ONE user-role text message
 * after the tool_result message — the next provider turn sees it as fresh
 * user guidance. Contract:
 *   - NOT fired after the final round (there is no next turn to guide —
 *     matches the legacy `round < maxRounds - 1` gating on its nudges).
 *   - Hook errors are swallowed: a nudge must never break the loop.
 *   - `toolResults` summarizes this round only; `messages` is a snapshot of
 *     the full history at the boundary (do not mutate).
 */
export type AgentRoundCompleteHook = (ctx: {
  /** 1-indexed provider-turn counter for the round that just completed. */
  iteration: number;
  maxIterations: number;
  /** This round's dispatched tools, in original tool_use order. */
  toolResults: Array<{ toolName: string; ok: boolean; resultText?: string }>;
  messages: readonly AgentMessage[];
}) => { appendUserNote?: string } | void | Promise<{ appendUserNote?: string } | void>;

export type ProviderTurnResult = {
  /** Stop reason from the model. `end_turn` means the assistant is done. */
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  /** Content blocks produced by the model. */
  content: AgentMessageContentBlock[];
  /** Optional usage telemetry — forwarded in events if provided. */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

export type AgentProvider = {
  /**
   * Single model turn. The provider is responsible for prompt-caching,
   * streaming-to-UI, retries, etc. We only care about the final structured
   * output + stop_reason.
   */
  turn(args: {
    messages: AgentMessage[];
    tools: AgentToolDefinition[];
    /** Called incrementally with streamed text deltas, when available. */
    onDelta?: (text: string) => void;
  }): Promise<ProviderTurnResult>;
};

export type AgentEvent =
  | { kind: 'turn_start'; iteration: number }
  | { kind: 'context_compressed'; iteration: number; droppedCount: number; tokensBefore: number; tokensAfter: number }
  | { kind: 'model_delta'; iteration: number; text: string }
  | { kind: 'tool_call_start'; iteration: number; toolName: string; toolUseId: string; input: unknown }
  | { kind: 'tool_call_result'; iteration: number; toolName: string; toolUseId: string; result: AgentToolResult; durationMs: number }
  | { kind: 'turn_end'; iteration: number; stop_reason: ProviderTurnResult['stop_reason']; usage?: ProviderTurnResult['usage'] }
  | { kind: 'final_response'; iteration: number; text: string }
  | { kind: 'max_iterations_exceeded'; iteration: number }
  /**
   * Progress-based loop exit (not iteration-cap based). Fired when the loop
   * detects it is re-sampling the SAME failing tool call with the SAME input
   * ~3 rounds in a row and stops BEFORE running it again — raising the cap
   * would just make the runaway more expensive, so the exit is progress-based.
   * `reason` is the human-readable "repeated identical failing call — <tool> x3".
   */
  | { kind: 'loop_stopped_no_progress'; iteration: number; reason: string }
  /**
   * P56: the stuck point injected ONE fresh-eyes solver consultation instead
   * of stopping — the model must produce a root-cause hypothesis + two
   * different approaches (or a blocker report). Fired at most once per run;
   * a second stuck verdict after this proceeds to `loop_stopped_no_progress`.
   */
  | { kind: 'solver_consultation'; iteration: number; reason: string }
  /**
   * Fired after each completed tool round (R12), BEFORE the next provider
   * turn. `messages` is a shallow snapshot of the full history at this
   * boundary — callers can persist it as a resumable checkpoint (the
   * legacy `executeToolUseLoop` returned an equivalent via `incomplete` +
   * checkpoint). Persistence adapters should store counts, not the
   * messages themselves (they can be large).
   */
  | { kind: 'iteration_complete'; iteration: number; messages: AgentMessage[] }
  /** Mid-run steering (P7b): a drained note was injected as a user message at this iteration boundary (`note` truncated to 200 chars). */
  | { kind: 'steering_applied'; iteration: number; note: string };

export type AgentRunOptions = {
  initialMessages: AgentMessage[];
  tools: AgentToolDefinition[];
  provider: AgentProvider;
  /** Max provider turns before we give up. Default 25. Haiku edge fn: use 8. */
  maxIterations?: number;
  /** Per-turn parallel tool dispatch cap. Default 4. */
  parallelToolConcurrency?: number;
  /** Opaque session blob passed into every tool handler. */
  session?: Record<string, unknown>;
  /** Progress event sink. Fired for every loop phase. */
  onEvent?: (event: AgentEvent) => void;
  /** Cancellation signal — aborts at the next loop boundary. */
  signal?: AbortSignal;
  /**
   * Optional pre-dispatch tool approval gate (R11). When provided, every
   * tool_use is offered to the gate before its handler runs; `reject`
   * short-circuits the handler with a policy-block tool_result. Omit to
   * keep existing behavior (all registered tools dispatch).
   */
  toolApprovalGate?: AgentToolApprovalGate;
  /**
   * Optional HARD pre-dispatch constraint/floor guard (QW1 — see
   * `AgentToolConstraintGuard`). Runs BEFORE `toolApprovalGate`: a `block`
   * verdict refuses the tool as a policy block; a `requireApproval` verdict
   * refuses a floored (pay/delete/login/grant) action as "confirmation
   * required, not performed" — both fail closed. Omit to keep existing
   * behavior (no constraint enforcement in this core).
   */
  toolConstraintGuard?: AgentToolConstraintGuard;
  /**
   * Optional per-turn dynamic tool expansion (T2 progressive disclosure).
   * Re-evaluated at the start of every turn BEFORE the provider call; any
   * returned definitions whose names are not already registered are merged
   * into both the advertised tool array and the dispatch registry.
   * Additions only — initial tools are never removed or overridden, so a
   * misbehaving resolver can widen but never narrow the tool surface
   * mid-run (resolver errors are swallowed and the current set is kept).
   * Omit to keep a static tool set (existing callers are unaffected).
   */
  resolveAdditionalTools?: (ctx: { session: Record<string, unknown>; iteration: number }) => AgentToolDefinition[];
  /**
   * Optional dependency-aware parallelism (T8/O6). When provided, each
   * non-interactive tool round is partitioned with
   * `partitionParallelSafeBatch`: tools whose policies declare disjoint
   * write/read footprints may dispatch concurrently within a group, while
   * conflicting/unknown tools become sequential barriers. An unknown tool
   * (provider returns `null`, or the provider throws) is treated as an
   * unsafe singleton barrier — fail closed, never reordered. Result blocks
   * always come back in the original tool_use order. Omit to keep today's
   * behavior (whole round dispatched via `parallelToolConcurrency`).
   */
  toolParallelPolicyProvider?: (toolName: string) => ToolParallelPolicy | null;
  /**
   * Optional round-boundary guidance hook (O1 nudge parity — see
   * `AgentRoundCompleteHook`). The legacy `executeToolUseLoop` injected
   * loop-internal reliability nudges between rounds; `runAgent` itself stays
   * nudge-agnostic and exposes this single generic seam instead. Omit to keep
   * existing behavior (no injected notes).
   */
  onRoundComplete?: AgentRoundCompleteHook;
  /**
   * Mid-run steering (P7b): drained at each iteration boundary — after tool
   * results and the iteration_complete checkpoint, before the next model
   * turn. Notes arrive ALREADY normalized + framed by the steering bus
   * (openswanSteering.drainOpenSwanSteeringNotes wraps them in the
   * guidance-only "NOT an approval" framing), so the core injects them
   * verbatim as user messages — mirroring the appendUserNote precedent.
   * Guidance only: tool approval gates are untouched.
   */
  steering?: { drain: () => string[] };
  /**
   * Optional pre-turn context compression (Phase CA-8a). When provided,
   * the running message history is summarised before each provider turn
   * once it crosses the threshold. The `summariser` is injected so this
   * module stays provider-agnostic — wrap Haiku (or any cheap model) at
   * the call site. Omit to disable (existing callers are unaffected).
   */
  compaction?: {
    summariser: (messagesToCompress: AgentMessage[]) => Promise<string>;
    /** Fraction of `maxContextTokens` that triggers compression. Default 0.50. */
    thresholdRatio?: number;
    /** Target model's context window. Default 200_000. */
    maxContextTokens?: number;
    /** Tail messages preserved verbatim. Default 20. */
    preserveLast?: number;
  };
};

export type AgentRunResult = {
  /** Full final assistant message text, concatenated from text blocks. */
  text: string;
  /** All messages produced during the run, including tool_result messages. */
  messages: AgentMessage[];
  /** How many provider turns were used (1-indexed, final turn inclusive). */
  iterations: number;
  /** Final stop reason reported by the provider. */
  stopReason: ProviderTurnResult['stop_reason'];
  /** True if we hit maxIterations without a clean end_turn. */
  hitMaxIterations: boolean;
};

// ─── Image side channel + binary hygiene (P21) ──────────────────────────────
//
// Protocol, in LOCKSTEP across three seams:
//   1. PRODUCER — `openswanBridge` (and any other tool adapter): a runtime
//      tool result carrying a large string `base64` field publishes it as
//      `data.image = { base64, mimeType }` and replaces the field inside
//      `data.raw` with `binaryOmittedMarker(len)` (never a silent delete —
//      the model should still know a capture happened).
//   2. RESHAPERS — `openswanSessionRuntimeAdapters.shapeLegacyToolHandlerResult`
//      forwards `data.image` untouched while keeping event text/metadata
//      image-free.
//   3. CONSUMER — `dispatchOne` below lifts `data.image` into a REAL
//      Anthropic image block and HARD-strips the payload from the JSON text
//      portion (smoke-pinned guarantee: the stringified envelope never
//      contains a base64 payload).

/** Live-image budget: before each provider turn, image blocks beyond the
 *  most recent N are replaced with `PRUNED_IMAGE_PLACEHOLDER_TEXT`. Two keeps
 *  a before/after screenshot pair actionable while bounding request size. */
export const MAX_LIVE_IMAGES = 2;

/** Binary-payload threshold (chars). Anything at or under this stays inline —
 *  tiny data-URI icons aren't worth an image block; real captures are 100s of KB. */
export const BINARY_SIDE_CHANNEL_MIN_CHARS = 512;

/** Anthropic-accepted media types; anything else normalizes to image/png
 *  (what the desktop/browser capture bridges actually emit). */
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function normalizeImageMediaType(mimeType: unknown): string {
  return typeof mimeType === 'string' && SUPPORTED_IMAGE_MEDIA_TYPES.has(mimeType)
    ? mimeType
    : 'image/png';
}

/** Replacement text for an omitted binary payload. Marker (not deletion) so
 *  the model knows the capture happened and how big it was. */
export function binaryOmittedMarker(charCount: number): string {
  return `[binary omitted: ${charCount} chars]`;
}

/**
 * PRODUCER-side extraction (generic binary-hygiene rule, tool-name agnostic):
 * if a raw runtime tool result has a string `base64` field longer than
 * `BINARY_SIDE_CHANNEL_MIN_CHARS`, return the image side channel plus a
 * shallow-copied result with the payload replaced by the omission marker.
 * Returns null when the rule doesn't apply (result untouched).
 */
export function extractToolResultImageSideChannel(result: unknown): {
  image: { base64: string; mimeType: string };
  sanitizedRaw: Record<string, unknown>;
} | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const rec = result as Record<string, unknown>;
  const base64 = typeof rec.base64 === 'string' ? rec.base64 : null;
  if (!base64 || base64.length <= BINARY_SIDE_CHANNEL_MIN_CHARS) return null;
  return {
    image: { base64, mimeType: normalizeImageMediaType(rec.mimeType) },
    sanitizedRaw: { ...rec, base64: binaryOmittedMarker(base64.length) },
  };
}

/**
 * CONSUMER-side read: does this tool result `data` carry a usable image side
 * channel? (Any non-empty string base64 counts here — the producer owns the
 * size threshold.) Used by `dispatchOne` and by the session adapters'
 * passthrough so all layers agree on what "an image result" is.
 */
export function readToolResultImageSideChannel(
  data: unknown,
): { base64: string; mimeType: string } | null {
  if (!data || typeof data !== 'object') return null;
  const image = (data as Record<string, unknown>).image;
  if (!image || typeof image !== 'object') return null;
  const rec = image as Record<string, unknown>;
  if (typeof rec.base64 !== 'string' || !rec.base64) return null;
  return { base64: rec.base64, mimeType: normalizeImageMediaType(rec.mimeType) };
}

/**
 * Defensive deep scrub: returns a copy of `value` with EVERY string property
 * named `base64` longer than `BINARY_SIDE_CHANNEL_MIN_CHARS` replaced by the
 * omission marker (the producer's short marker strings survive re-scrubbing).
 * Fail-closed: past the depth cap or on a cycle it returns a placeholder
 * string rather than the raw subtree, so a pathological result can never
 * smuggle a payload through. Used for the image-path text envelope and for
 * telemetry payload hygiene (openswanSessionRuntimeAdapters).
 */
export function stripBase64Payloads(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return value;
  }
  if (typeof value !== 'object') return value;
  if (depth > 8) return '[omitted: nesting too deep]';
  const tracker = seen ?? new WeakSet<object>();
  if (tracker.has(value as object)) return '[omitted: circular]';
  tracker.add(value as object);
  if (Array.isArray(value)) {
    return value.map((item) => stripBase64Payloads(item, depth + 1, tracker));
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'base64' && typeof v === 'string' && v.length > BINARY_SIDE_CHANNEL_MIN_CHARS) {
      out[key] = binaryOmittedMarker(v.length);
    } else {
      out[key] = stripBase64Payloads(v, depth + 1, tracker);
    }
  }
  return out;
}

/**
 * Live-image pruning (P21 image economics). Walks the history and replaces
 * every image block inside tool_result content arrays EXCEPT the
 * `maxLiveImages` most recent (counted from the end — deterministic) with a
 * `PRUNED_IMAGE_PLACEHOLDER_TEXT` text block.
 *
 * Mutation contract: the live `messages` ARRAY is updated in place (same
 * convention as the loop's push/compaction writes), but pruned entries are
 * REPLACED with fresh message objects — a message's existing content array is
 * never mutated. That matters because R12 `iteration_complete` checkpoints
 * (and `onRoundComplete` snapshots) are shallow copies (`[...messages]`) that
 * SHARE message objects with the live array: replacing (not mutating) means
 * earlier snapshots keep their full original images and stay coherent.
 *
 * tool_use/tool_result pairing is untouched — only parts INSIDE a
 * tool_result's content array are swapped, never the block itself.
 * Returns the number of image blocks pruned.
 */
export function pruneStaleToolResultImages(messages: AgentMessage[], maxLiveImages: number): number {
  // Reverse scan: count image blocks newest→oldest; everything past the
  // budget is a prune target, addressed as "messageIdx → blockIdx:partIdx".
  let liveSeen = 0;
  const targets = new Map<number, Set<string>>();
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const content = messages[mi].content;
    if (typeof content === 'string') continue;
    for (let bi = content.length - 1; bi >= 0; bi--) {
      const block = content[bi];
      if (block.type !== 'tool_result' || typeof block.content === 'string') continue;
      for (let pi = block.content.length - 1; pi >= 0; pi--) {
        if (block.content[pi].type !== 'image') continue;
        liveSeen += 1;
        if (liveSeen > maxLiveImages) {
          if (!targets.has(mi)) targets.set(mi, new Set());
          targets.get(mi)!.add(`${bi}:${pi}`);
        }
      }
    }
  }
  if (targets.size === 0) return 0;
  let pruned = 0;
  for (const [mi, coords] of targets) {
    const original = messages[mi];
    const blocks = original.content as AgentMessageContentBlock[];
    const nextBlocks = blocks.map((block, bi) => {
      if (block.type !== 'tool_result' || typeof block.content === 'string') return block;
      let changed = false;
      const nextParts = block.content.map((part, pi) => {
        if (part.type === 'image' && coords.has(`${bi}:${pi}`)) {
          changed = true;
          pruned += 1;
          return { type: 'text' as const, text: PRUNED_IMAGE_PLACEHOLDER_TEXT };
        }
        return part;
      });
      return changed ? { ...block, content: nextParts } : block;
    });
    messages[mi] = { role: original.role, content: nextBlocks };
  }
  return pruned;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function ensureBlocks(content: AgentMessage['content']): AgentMessageContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content;
}

function extractText(blocks: AgentMessageContentBlock[]): string {
  let out = '';
  for (const b of blocks) {
    if (b.type === 'text') out += b.text;
  }
  return out;
}

function extractToolUses(blocks: AgentMessageContentBlock[]): Array<Extract<AgentMessageContentBlock, { type: 'tool_use' }>> {
  const out: Array<Extract<AgentMessageContentBlock, { type: 'tool_use' }>> = [];
  for (const b of blocks) {
    if (b.type === 'tool_use') out.push(b);
  }
  return out;
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  if (items.length === 0) return [];
  if (concurrency <= 1) {
    const out: R[] = [];
    for (let i = 0; i < items.length; i++) out.push(await worker(items[i], i));
    return out;
  }
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push((async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

// ─── Public entry ───────────────────────────────────────────────────────────

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const {
    initialMessages,
    tools,
    provider,
    maxIterations = 25,
    parallelToolConcurrency = 4,
    session = {},
    onEvent,
    signal,
    compaction,
    toolApprovalGate,
    toolConstraintGuard,
    resolveAdditionalTools,
    toolParallelPolicyProvider,
    onRoundComplete,
    steering,
  } = opts;

  const emit = (e: AgentEvent) => { try { onEvent?.(e); } catch {} };

  // `advertisedTools` is what the provider sees; it starts as the caller's
  // tool set and only ever GROWS via `resolveAdditionalTools` (T2).
  const advertisedTools: AgentToolDefinition[] = [...tools];
  const toolsByName = new Map<string, AgentToolDefinition>();
  for (const t of advertisedTools) toolsByName.set(t.name, t);

  const messages: AgentMessage[] = [...initialMessages];
  let lastStopReason: ProviderTurnResult['stop_reason'] = 'end_turn';
  let lastText = '';
  let iteration = 0;

  // Progress-based stuck detection (loop-reliability upgrade). A bounded ring
  // of the most recent dispatched calls (name + stable input hash + ok). When
  // the loop is about to re-sample the SAME failing (name+input) call a ~3rd
  // time, `detectRepeatedToolFailure` trips and we STOP-or-replan instead of
  // running it again — raising the iteration cap would only make a runaway
  // more expensive. NOT temperature handling: at temperature 0 the model
  // re-samples the identical action and reproduces the identical failure, so
  // the exit must be progress-based, not a re-sample retry.
  // P56: the stuck point consults the solver ONCE per run before stopping;
  // `lastToolErrorText` carries the most recent failure text (bounded) so the
  // consultation can quote the real error.
  let solverConsulted = false;
  let lastToolErrorText: string | null = null;

  const recentToolCalls: RecentToolCall[] = [];
  const pushRecentCall = (call: RecentToolCall) => {
    recentToolCalls.push(call);
    if (recentToolCalls.length > RECENT_TOOL_CALL_RING_MAX) {
      recentToolCalls.splice(0, recentToolCalls.length - RECENT_TOOL_CALL_RING_MAX);
    }
  };

  while (iteration < maxIterations) {
    if (signal?.aborted) break;
    iteration += 1;
    emit({ kind: 'turn_start', iteration });

    // Per-turn dynamic tool expansion (T2). Merge by name, additions only —
    // never removes or overrides a tool already advertised. Fail open on
    // resolver errors: the run continues with the current tool set.
    if (resolveAdditionalTools) {
      try {
        for (const added of resolveAdditionalTools({ session, iteration }) || []) {
          if (!added?.name || toolsByName.has(added.name)) continue;
          advertisedTools.push(added);
          toolsByName.set(added.name, added);
        }
      } catch { /* keep the current tool set */ }
    }

    // Pre-turn context compression. Summarise the oldest half of the
    // history when it crosses the threshold, preserving the tail and never
    // splitting a tool_use/tool_result pair. Failures fall back to the
    // uncompressed history (compressContextIfOversized returns the original).
    if (compaction) {
      const compressed = await compressContextIfOversized(messages, {
        summariser: compaction.summariser,
        thresholdRatio: compaction.thresholdRatio,
        maxContextTokens: compaction.maxContextTokens,
        preserveLast: compaction.preserveLast,
      });
      if (compressed.compressed) {
        messages.length = 0;
        messages.push(...compressed.messages);
        emit({
          kind: 'context_compressed',
          iteration,
          droppedCount: compressed.droppedCount,
          tokensBefore: compressed.tokensBefore,
          tokensAfter: compressed.tokensAfter,
        });
      }
    }

    // P21 image economics: keep only the MAX_LIVE_IMAGES most recent image
    // blocks live in the request; older ones become placeholder text. Runs
    // before EVERY provider turn (pruned entries are replaced, not mutated,
    // so R12 checkpoint snapshots keep their originals — see the fn's
    // mutation contract).
    pruneStaleToolResultImages(messages, MAX_LIVE_IMAGES);

    const turn = await provider.turn({
      messages,
      tools: advertisedTools,
      onDelta: (text) => emit({ kind: 'model_delta', iteration, text }),
    });
    lastStopReason = turn.stop_reason;

    emit({ kind: 'turn_end', iteration, stop_reason: turn.stop_reason, usage: turn.usage });

    // Always record the assistant turn in the message history, whether it
    // ended in text or tool_use. The provider is expected to include tool_use
    // blocks so we can dispatch them and reference their ids in tool_result.
    messages.push({ role: 'assistant', content: turn.content });

    if (turn.stop_reason !== 'tool_use') {
      lastText = extractText(turn.content);
      emit({ kind: 'final_response', iteration, text: lastText });
      return { text: lastText, messages, iterations: iteration, stopReason: turn.stop_reason, hitMaxIterations: false };
    }

    // Tool dispatch phase
    const toolUses = extractToolUses(turn.content);
    if (toolUses.length === 0) {
      // Provider claimed tool_use but produced no tool_use blocks — treat as
      // end_turn to avoid a loop.
      lastText = extractText(turn.content);
      emit({ kind: 'final_response', iteration, text: lastText });
      return { text: lastText, messages, iterations: iteration, stopReason: 'end_turn', hitMaxIterations: false };
    }

    // Progress-based stuck-loop exit (BEFORE dispatching this round). If the
    // model is asking to re-run the SAME single tool with the SAME input that
    // already failed the last (threshold-1) times, running it again would just
    // reproduce the identical failure. We project the requested call onto the
    // recent-call ring as a hypothetical failure and, if that trips
    // `detectRepeatedToolFailure`, STOP-or-replan instead of dispatching it a
    // ~3rd time. Guarded to a single-tool round so a legitimate multi-tool
    // round (or a round mixing different/succeeding calls) is never blocked.
    if (toolUses.length === 1) {
      const requested: RecentToolCall = {
        name: toolUses[0].name,
        inputHash: hashToolInput(toolUses[0].input),
        ok: false, // hypothesis: "if we run it and it fails like before…"
      };
      const projected = detectRepeatedToolFailure([...recentToolCalls, requested]);
      if (projected.stuck && shouldConsultSolver({ stuck: true, alreadyConsulted: solverConsulted })) {
        // P56: before giving up, inject ONE structured fresh-eyes
        // consultation. The requested call is NOT dispatched (it would fail
        // identically); its tool_use is closed with an explanatory error
        // result (transcript stays well-formed), then a solver user message
        // forces a root-cause + two-different-approaches re-plan. Gates and
        // constraints are untouched — this changes the plan, not permissions.
        solverConsulted = true;
        emit({ kind: 'solver_consultation', iteration, reason: projected.reason });
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUses[0].id,
            content: `not executed — this exact call already failed repeatedly (${projected.reason}); a solver consultation follows.`,
            is_error: true,
          }],
        });
        messages.push({
          role: 'user',
          content: buildSolverConsultationMessage({
            tool: toolUses[0].name,
            inputPreview: previewToolInput(toolUses[0].input),
            stuckReason: projected.reason,
            lastError: lastToolErrorText,
            availableTools: Array.from(toolsByName.keys()),
          }),
        });
        continue;
      }
      if (projected.stuck) {
        // We do NOT run the failing call again. Close the just-recorded
        // assistant tool_use with a terminal tool_result (keeps the transcript
        // well-formed / resumable — no dangling tool_use), stamp `result.text`
        // with the human-readable stop reason, and end the run. This is a
        // progress-based exit, distinct from `hitMaxIterations`. When the P56
        // solver consultation already ran, say so — the blocker is real.
        const note = solverConsulted
          ? `stopped: ${projected.reason} — still stuck after a solver consultation; report the blocker to the user.`
          : `stopped: ${projected.reason} — same failing call not retried; re-observe or ask the user before trying a different approach.`;
        emit({ kind: 'loop_stopped_no_progress', iteration, reason: projected.reason });
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUses[0].id, content: note, is_error: true }],
        });
        lastText = note;
        emit({ kind: 'final_response', iteration, text: lastText });
        return { text: lastText, messages, iterations: iteration, stopReason: 'end_turn', hitMaxIterations: false };
      }
    }

    const ctx: AgentToolContext = { session, iteration };

    // Partition interactive tools — those must run sequentially and in the
    // order the model requested, matching Hermes' behaviour for `clarify`.
    const hasInteractive = toolUses.some(u => toolsByName.get(u.name)?.interactive);
    const effectiveConcurrency = hasInteractive ? 1 : parallelToolConcurrency;

    const dispatchOne = async (use: typeof toolUses[number]): Promise<AgentMessageContentBlock> => {
      emit({ kind: 'tool_call_start', iteration, toolName: use.name, toolUseId: use.id, input: use.input });
      const started = Date.now();
      const def = toolsByName.get(use.name);
      let result: AgentToolResult;
      if (!def) {
        result = { ok: false, error: `Tool "${use.name}" is not registered.` };
      } else {
        // QW1: HARD pre-dispatch constraint/floor guard — runs BEFORE the
        // approval gate and the handler. Fail closed: a guard error blocks. A
        // `block` verdict (user forbade the category) or a `requireApproval`
        // verdict (always-confirm floor tripped) refuses the tool without
        // running it, as a policy block the model must not blindly retry.
        let constraintVerdict: AgentToolConstraintVerdict = undefined;
        if (toolConstraintGuard) {
          try {
            constraintVerdict = await toolConstraintGuard({
              toolName: use.name,
              toolUseId: use.id,
              input: use.input,
              iteration,
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            constraintVerdict = { block: true, reason: `constraint guard failed (${message})` };
          }
        }
        const blockedByConstraint = !!constraintVerdict
          && (constraintVerdict.block === true || (constraintVerdict as { requireApproval?: boolean }).requireApproval === true);
        // Pre-dispatch approval gate — fail closed: a gate error rejects.
        let approval: AgentToolApprovalDecision = { decision: 'approve' };
        if (blockedByConstraint) {
          const reason = constraintVerdict && 'reason' in constraintVerdict && constraintVerdict.reason
            ? ` Reason: ${constraintVerdict.reason}`
            : '';
          const kind = (constraintVerdict as { requireApproval?: boolean }).requireApproval === true
            ? 'requires explicit user confirmation and was not performed'
            : 'was blocked by a user constraint and did not run';
          result = {
            ok: false,
            error: `Tool "${use.name}" ${kind}.${reason} Do not retry the same call — stop and ask the user, or choose a different approach.`,
          };
        } else {
          if (toolApprovalGate) {
            try {
              approval = await toolApprovalGate({
                toolName: use.name,
                toolUseId: use.id,
                input: use.input,
                iteration,
              });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              approval = { decision: 'reject', reason: `approval gate failed (${message})` };
            }
          }
          if (approval.decision === 'reject') {
            const reason = approval.reason ? ` Reason: ${approval.reason}` : '';
            result = {
              ok: false,
              error: `Tool "${use.name}" was blocked by policy and did not run.${reason} Do not retry the same call — choose a different approach or ask the user.`,
            };
          } else {
            try {
              result = await def.handler(use.input, ctx);
            } catch (e) {
              // Tools SHOULD NOT throw — we still catch to preserve the loop.
              const message = e instanceof Error ? e.message : String(e);
              result = { ok: false, error: `Handler threw: ${message}` };
            }
          }
        }
      }
      const durationMs = Date.now() - started;
      emit({ kind: 'tool_call_result', iteration, toolName: use.name, toolUseId: use.id, result, durationMs });
      // Metadata (R14) is a side channel for runtime consumers (design-app
      // manifest capture, audit ledgers) — it flows through the event above
      // but is STRIPPED from the model-visible tool_result content so hidden
      // captures never leak into the conversation.
      const modelVisible: AgentToolResult = result.ok
        ? { ok: true, data: result.data }
        : { ok: false, error: result.error };
      // P21 image side channel (CONSUMER seam): a tool result carrying
      // `data.image` becomes a REAL Anthropic image block so the model can
      // see captures, while the text envelope is deep-scrubbed so the
      // stringified JSON can never contain a base64 payload (smoke-pinned).
      // Non-image results keep the exact legacy string shape.
      const sideChannelImage = result.ok ? readToolResultImageSideChannel(result.data) : null;
      if (sideChannelImage && result.ok) {
        const { image: _omitted, ...dataSansImage } = (result.data ?? {}) as Record<string, unknown>;
        const scrubbedVisible = stripBase64Payloads({ ok: true, data: dataSansImage });
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: [
            { type: 'text', text: JSON.stringify(scrubbedVisible) },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: normalizeImageMediaType(sideChannelImage.mimeType),
                data: sideChannelImage.base64,
              },
            },
          ],
          is_error: false,
        };
      }
      // Error path (loop-reliability upgrade): a RAW error fed straight back
      // makes the model apologize and retry the identical failing call —
      // especially smaller models. Lead the tool_result with a CLASSIFIED,
      // ACTIONABLE recovery template at MAX RECENCY ("re-observe the screen"
      // beats "try again"), followed by the original (clamped) error envelope
      // so the model still sees exactly what failed. We keep the legacy
      // `{"ok":false,"error":...}` JSON as the echoed error body so any
      // downstream parser still finds it — only a recovery preamble is added.
      // The block SHAPE is unchanged (same `tool_use_id`, `is_error: true`,
      // string content); SUCCESS results below are byte-identical to before.
      if (!result.ok) {
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: buildToolFailureFeedback(use.name, JSON.stringify(modelVisible)),
          is_error: true,
        };
      }
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(modelVisible),
        is_error: false,
      };
    };

    // Dependency-aware dispatch (T8/O6): when the caller supplied a policy
    // provider and the round has no interactive tool, partition the round
    // into ordered groups — parallel within a group, sequential between.
    // Unknown tools (null policy / provider throw) fail closed as singleton
    // barriers. Result blocks are reassembled in original tool_use order so
    // the follow-up user message is byte-identical to the sequential shape.
    let toolResultBlocks: AgentMessageContentBlock[];
    if (toolParallelPolicyProvider && !hasInteractive) {
      const policies: Array<ToolParallelPolicy | null> = toolUses.map((use) => {
        try { return toolParallelPolicyProvider(use.name); } catch { return null; }
      });
      const groups = partitionParallelSafeBatch(policies, { hasApprovalGate: !!toolApprovalGate });
      const ordered: AgentMessageContentBlock[] = new Array(toolUses.length);
      for (const group of groups) {
        const groupResults = await runWithConcurrency(
          group.map((idx) => toolUses[idx]),
          dispatchOne,
          parallelToolConcurrency,
        );
        group.forEach((originalIndex, k) => { ordered[originalIndex] = groupResults[k]; });
      }
      toolResultBlocks = ordered;
    } else {
      toolResultBlocks = await runWithConcurrency(toolUses, dispatchOne, effectiveConcurrency);
    }

    // Record this round's calls into the progress-based stuck-detection ring
    // (name + stable input hash + ok), in original tool_use order. `ok` is read
    // from the emitted tool_result block's `is_error` so it matches exactly
    // what the model saw (a policy-blocked / gate-rejected / thrown call all
    // count as a failure here). The pre-dispatch check above uses this to stop
    // before re-running an identical failing call a ~3rd time.
    for (let i = 0; i < toolUses.length; i++) {
      const block = toolResultBlocks[i];
      const ok = !(block?.type === 'tool_result' && block.is_error === true);
      pushRecentCall({ name: toolUses[i].name, inputHash: hashToolInput(toolUses[i].input), ok });
      // P56: keep the latest failure text (bounded) for the solver
      // consultation — prefer the readable `.error` when the content is the
      // JSON envelope, so the consultation quotes the actual message instead
      // of escaped JSON.
      if (!ok && block?.type === 'tool_result' && typeof block.content === 'string') {
        let text = block.content;
        // Failure content = recovery preamble + the `{"ok":false,"error":…}`
        // envelope — pull the readable error out of the embedded JSON
        // (escape-aware, then JSON-unescaped) so the consultation quotes the
        // actual message, not preamble or escaped bytes.
        const embedded = text.match(/"error"\s*:\s*"((?:[^"\\]|\\.){1,300})"/);
        if (embedded) {
          try { text = JSON.parse(`"${embedded[1]}"`); } catch { text = embedded[1]; }
        }
        lastToolErrorText = text.slice(0, 300);
      }
    }

    // Tool results arrive as a single user-role message containing every
    // tool_result block, in the same order the tools were requested — this
    // is how Anthropic's Messages API expects the follow-up to be shaped.
    messages.push({ role: 'user', content: toolResultBlocks });

    // Resumable-checkpoint boundary (R12): the round is complete and the
    // history is consistent (tool_use/tool_result pairs closed). Snapshot
    // so later mutation of `messages` doesn't alias into the handler.
    emit({ kind: 'iteration_complete', iteration, messages: [...messages] });

    // Mid-run steering (P7b): drain queued user guidance and inject each note
    // VERBATIM as a user message — the same shape as onRoundComplete's
    // appendUserNote below (the bus owns normalization + framing). Skipped on
    // the final round (no next provider turn to consume it). Best-effort: a
    // drain throw must never break the loop. Guidance only — tool approval
    // gates are untouched.
    if (steering && iteration < maxIterations) {
      try {
        for (const note of steering.drain()) {
          if (typeof note !== 'string' || !note.trim()) continue;
          messages.push({ role: 'user', content: note });
          emit({ kind: 'steering_applied', iteration, note: note.slice(0, 200) });
        }
      } catch { /* steering is best-effort — never break the loop */ }
    }

    // Round-boundary guidance (O1 nudge parity). Skipped on the final round:
    // there is no next provider turn to consume the note, matching the legacy
    // loop's `round < maxRounds - 1` gating. Errors are swallowed — a nudge
    // hook must never break the loop.
    if (onRoundComplete && iteration < maxIterations) {
      try {
        const roundToolResults = toolUses.map((use, i) => {
          const block = toolResultBlocks[i];
          const tr = block?.type === 'tool_result' ? block : null;
          return {
            toolName: use.name,
            ok: !tr?.is_error,
            ...(typeof tr?.content === 'string' ? { resultText: tr.content } : {}),
          };
        });
        const outcome = await onRoundComplete({
          iteration,
          maxIterations,
          toolResults: roundToolResults,
          messages: [...messages],
        });
        const note = outcome && typeof outcome === 'object' && typeof outcome.appendUserNote === 'string'
          ? outcome.appendUserNote
          : '';
        if (note.trim()) messages.push({ role: 'user', content: note });
      } catch { /* nudge hooks are best-effort — never break the loop */ }
    }

    // Loop re-enters provider.turn() with the updated message history.
  }

  // Exited via max-iterations guard.
  emit({ kind: 'max_iterations_exceeded', iteration });
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  lastText = lastAssistant ? extractText(ensureBlocks(lastAssistant.content)) : '';
  return {
    text: lastText,
    messages,
    iterations: iteration,
    stopReason: lastStopReason,
    hitMaxIterations: true,
  };
}
