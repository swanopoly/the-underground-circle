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

import { compressContextIfOversized, estimateMessagesTokens, PRUNED_IMAGE_PLACEHOLDER_TEXT } from './agentContextCompression';
import {
  planCompactionTier,
  DEFAULT_KEEP_RECENT_COUNT,
  KEEP_RECENT_MIN,
  KEEP_RECENT_MAX,
} from './contextCompactionTierCore';
import type { CompactionTier, CompactionTierPlan } from './contextCompactionTierCore';
import { projectMessagesForCompaction } from './openswanContextCompactionCore';
import { truncateToTokenBudget } from './promptTokenEstimateCore';
import { partitionParallelSafeBatch } from './toolBatchParallelism';
import type { ToolParallelPolicy } from './toolBatchParallelism';
import { buildToolFailureFeedback } from './toolFailureFeedback';
import { decideToolReplaySafety } from './toolReplaySafetyCore';
import { detectRepeatedToolFailure, hashToolInput, type RecentToolCall } from './toolLoopStuckBreaker';
import { detectOscillatingFailure } from './oscillationDetectorCore';
import { buildSolverConsultationMessage, previewToolInput, shouldConsultSolver } from './toolLoopSolver';
import { summarizeToolResultForModel } from './toolResultSummaryCore';

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
  /**
   * Exact model-requested tool name for this handler entry. `runAgent`
   * guarantees it; optional only for compatibility with direct handler tests
   * and legacy callers that execute a definition outside the model loop.
   */
  toolName?: string;
  /**
   * Exact model-issued tool-use id for this handler entry. `runAgent`
   * guarantees it and never synthesizes one; direct legacy calls may omit it.
   */
  toolUseId?: string;
  /** Monotonic provider-turn counter (1-indexed). */
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

export type AgentRoundToolResult = {
  toolName: string;
  toolUseId: string;
  ok: boolean;
  resultText?: string;
  /**
   * Metadata-stripped, base64-scrubbed result envelope before deterministic
   * context summarization. Safety predicates may inspect this so a condition
   * buried in the omitted middle of a large result cannot be bypassed.
   */
  enforcementText?: string;
  input?: unknown;
};

export type AgentToolResultStopDecision =
  | { stop?: false }
  | { stop: true; reason: string; responseText?: string }
  | void
  | undefined;

/**
 * Generic post-result safety interlock. The presence of this guard forces tool
 * calls within a provider turn to dispatch sequentially. It runs after each
 * requested call has produced a result but BEFORE the next handler can enter.
 *
 * A `{ stop: true }` verdict prevents all remaining handlers in that turn from
 * entering. The core synthesizes explicit `dispatched:false` error results for
 * those skipped requests, closes every tool_use/tool_result pair, emits the
 * resumable `iteration_complete` checkpoint, and only then ends the run. A
 * thrown guard fails CLOSED with generic stop copy. Omit the hook for
 * byte-compatible legacy dispatch behavior.
 */
export type AgentToolResultStopGuard = (ctx: {
  iteration: number;
  maxIterations: number;
  latestToolResult: AgentRoundToolResult;
  completedToolResults: readonly AgentRoundToolResult[];
}) => AgentToolResultStopDecision | Promise<AgentToolResultStopDecision>;

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
  /** This round's requested tools/results, in original tool_use order
   *  (including pre-dispatch policy blocks). `input` is the raw tool input —
   *  the run-and-fix gate uses it to classify local.run_shell / git.run calls
   *  as verification vs mutation. */
  toolResults: AgentRoundToolResult[];
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
  | {
      kind: 'tool_call_result';
      iteration: number;
      toolName: string;
      toolUseId: string;
      result: AgentToolResult;
      durationMs: number;
      /**
       * True only after the registered handler was actually entered. Optional
       * solely for compatibility with events persisted before this field
       * existed; current `runAgent` emissions always carry a boolean.
       */
      dispatched?: boolean;
    }
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
   * A runtime-owned post-tool boundary guard stopped the loop after all
   * tool_use/tool_result pairs were closed. `reason` is bounded for telemetry;
   * the user-facing text is emitted separately via `final_response`.
   */
  | { kind: 'round_boundary_stopped'; iteration: number; reason: string }
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
  | { kind: 'steering_applied'; iteration: number; note: string }
  /**
   * Tiered pre-turn context compaction (contextCompactionTierCore) executed a
   * non-'none' tier before this provider turn. `reason` is the selector's
   * bounded, secret-safe explanation (counts/token numbers only, ≤240 chars);
   * `freedTokensApprox` is the estimate delta the tier's actions achieved.
   * Never fired with tier 'none' (small contexts stay byte-identical); if the
   * post-compaction safety net has to shave on a 'none' plan, the event is
   * reported as tier 'hard_truncate' with a "safety net" reason.
   */
  | { kind: 'context_compaction_tier'; iteration: number; tier: CompactionTier; reason: string; estimatedTokens: number; freedTokensApprox: number };

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
   * Optional fail-closed per-result safety interlock (see
   * `AgentToolResultStopGuard`). Forces sequential handler entry within a
   * provider turn and can skip all remaining calls after any result. The core
   * still closes the complete requested round before returning. Omit to
   * preserve legacy parallel dispatch behavior.
   */
  toolResultStopGuard?: AgentToolResultStopGuard;
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
  /**
   * Tiered pre-turn context compaction (contextCompactionTierCore) — the
   * escalation ladder that keeps a LONG tool loop under the model's context
   * window: drop stale tool_result noise (free, local) → summarize oldest
   * history (only when `compaction.summariser` is injected; otherwise degrades
   * to drop-only) → hard-truncate protected message TEXT (emergency, so the
   * provider never 400s "prompt too long" on a single giant recent result).
   * Default ON with a 200k-window / 8k-reserved-output / keep-6-recent
   * posture — the selector is identity below 0.75× the window (unless the
   * ≥40-turn proactive gate trips), so normal runs stay byte-identical.
   * Pass `false` to opt out, mirroring `toolResultSummarization`. When the
   * `compaction` seam is also configured, `contextWindowTokens` /
   * `keepRecentCount` default to its `maxContextTokens` / `preserveLast`.
   */
  tieredCompaction?: false | {
    /** Target model's context window (tokens). Default `compaction.maxContextTokens` ?? 200_000. */
    contextWindowTokens?: number;
    /** Headroom reserved for the model's OUTPUT; hardLimit = window − this. Default 8_000. */
    reservedOutputTokens?: number;
    /** Most-recent messages protected verbatim. Default `compaction.preserveLast` ?? 6. */
    keepRecentCount?: number;
  };
  /**
   * Deterministic per-tool-result summarization (coding-agent P6). A tool
   * result whose model-visible text exceeds the threshold (default
   * TOOL_RESULT_SUMMARY_THRESHOLD_CHARS, 20k chars) is compacted to
   * head + tail + error-signal lines from the omitted middle
   * (`toolResultSummaryCore.ts` — pure, smoke-tested) instead of flooding
   * the context. Distinct from `compaction`, which summarises old HISTORY
   * with a model; this clamps a single oversized result, deterministically,
   * the moment it is produced. Default ON; pass `false` to keep the legacy
   * byte-identical envelopes.
   */
  toolResultSummarization?: false | { thresholdChars?: number };
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
  /**
   * True if the run exited because its `signal` was aborted (user cancel /
   * caller teardown) at a loop boundary, NOT because it exhausted the
   * iteration cap. Mutually exclusive with `hitMaxIterations`: an aborted run
   * is honest telemetry — it must never read as cap-exhaustion. Absent (falsy)
   * for every non-aborted exit, so existing consumers are unaffected.
   */
  aborted?: boolean;
  /**
   * True if the run ended EARLY on a runtime guard instead of finishing its
   * work: an invalid/reused tool-call identity, a repeated-failure or
   * oscillation no-progress stop, or a tool-result boundary stop.
   *
   * Those exits deliberately report `stopReason: 'end_turn'` and
   * `hitMaxIterations: false`, because they are NOT cap exhaustion (pinned by
   * agent-core case14a/14b and the stuck-breaker smoke). But that pair is also
   * exactly what a genuine completion looks like — so every consumer that asks
   * "did it finish?" as `!hitMaxIterations` read a run that GAVE UP as a clean
   * success: `buildLegacyToolLoopResult` dropped `incomplete`, the parent's
   * subagent summary said `completed: true`, and the '✓ Verified' receipt
   * downgrade meant to catch exactly this never ran.
   *
   * Absent (falsy) on every normal exit, so existing consumers are unaffected
   * — the same contract as `aborted`.
   */
  stoppedEarly?: boolean;
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

// ─── Tiered compaction executors (contextCompactionTierCore wiring) ─────────

/** Marker prefix for a dropped stale tool_result (tier 'drop_tool_noise').
 *  Also the idempotency guard: an already-stubbed result is never re-stubbed. */
export const DROPPED_TOOL_RESULT_MARKER_PREFIX = '[tool result dropped to save context:';

function droppedToolResultMarker(charsOmitted: number): string {
  return `${DROPPED_TOOL_RESULT_MARKER_PREFIX} ${charsOmitted} chars omitted — re-run the tool if needed]`;
}

/** Marker appended when a protected message's text is hard-truncated to fit
 *  the hard context limit (tier 'hard_truncate'). */
export const HARD_TRUNCATE_MARKER_TEXT = '[truncated to fit context window]';

/**
 * Tier 'drop_tool_noise' executor. Replaces the CONTENT of every stale
 * tool_result — non-system messages BEFORE the protected recent suffix —
 * with a short "dropped to save context" marker, freeing the bulky bytes
 * while keeping every message and block in place.
 *
 * Lockstep contract with `contextCompactionTierCore.planCompactionTier`:
 * `keepRecentCount` is normalised with the SAME clamps (default 6, [2, 200])
 * and `recentStart` uses the SAME pair-guard walk-back (never let the kept
 * suffix START with a tool_result), so the set of stubbed messages matches
 * exactly the set the selector counted as `freeableByDropTokens`
 * (`referencedLater` is false everywhere for projections built without ids).
 *
 * Structural guarantees:
 *   - NEVER removes a message or a block — tool_use/tool_result pairing is
 *     preserved by construction (only a tool_result's content is swapped).
 *   - NEVER mutates in place: touched messages are REPLACED with fresh
 *     objects (same checkpoint-aliasing contract as
 *     `pruneStaleToolResultImages` — R12 `iteration_complete` snapshots that
 *     share message objects keep their original contents).
 *   - Image parts inside content-array tool_results are left untouched
 *     (their budget is owned by `pruneStaleToolResultImages`); text parts
 *     are stubbed. Stubs that would GROW the message (content shorter than
 *     the marker) are skipped.
 *
 * Returns the replaced message indices (ascending) plus the chars freed.
 */
export function stubStaleToolResultContents(
  messages: AgentMessage[],
  keepRecentCount?: number,
): { stubbedIndices: number[]; freedChars: number } {
  const n = messages.length;
  const rawKeep = typeof keepRecentCount === 'number' && Number.isFinite(keepRecentCount)
    ? Math.floor(keepRecentCount)
    : DEFAULT_KEEP_RECENT_COUNT;
  const keepRecent = Math.min(KEEP_RECENT_MAX, Math.max(KEEP_RECENT_MIN, rawKeep));
  const hasToolResult = (m: AgentMessage): boolean =>
    Array.isArray(m.content) && m.content.some((b) => !!b && b.type === 'tool_result');
  // Pair-guard walk-back (mirrors the tier core's protection rule).
  let recentStart = Math.max(0, n - keepRecent);
  while (recentStart > 0 && hasToolResult(messages[recentStart])) recentStart -= 1;

  const stubbedIndices: number[] = [];
  let freedChars = 0;
  for (let mi = 0; mi < recentStart; mi++) {
    const original = messages[mi];
    if (original.role === 'system') continue;
    if (typeof original.content === 'string') continue; // no tool_result blocks
    let changed = false;
    let freedForMsg = 0;
    const nextBlocks = original.content.map((block): AgentMessageContentBlock => {
      if (block.type !== 'tool_result') return block;
      if (typeof block.content === 'string') {
        if (block.content.startsWith(DROPPED_TOOL_RESULT_MARKER_PREFIX)) return block;
        const marker = droppedToolResultMarker(block.content.length);
        if (block.content.length <= marker.length) return block; // net-negative stub
        changed = true;
        freedForMsg += block.content.length - marker.length;
        return { ...block, content: marker };
      }
      // Content-array tool_result: stub text parts, keep image parts' shape.
      let partChanged = false;
      const nextParts = block.content.map((part) => {
        if (part.type !== 'text') return part;
        if (part.text.startsWith(DROPPED_TOOL_RESULT_MARKER_PREFIX)) return part;
        const marker = droppedToolResultMarker(part.text.length);
        if (part.text.length <= marker.length) return part;
        partChanged = true;
        freedForMsg += part.text.length - marker.length;
        return { type: 'text' as const, text: marker };
      });
      if (!partChanged) return block;
      changed = true;
      return { ...block, content: nextParts };
    });
    if (changed) {
      messages[mi] = { role: original.role, content: nextBlocks };
      stubbedIndices.push(mi);
      freedChars += freedForMsg;
    }
  }
  return { stubbedIndices, freedChars };
}

/**
 * Tier 'hard_truncate' per-message shave: returns a COPY of `message` whose
 * TEXT content (string content, text blocks, tool_result string content and
 * text parts) is truncated so it fits ~`budgetTokens`, with a truncation
 * marker appended wherever text was cut. Blocks and image/tool_use parts keep
 * their exact shape — only text is shaved, so tool pairing and block
 * structure survive. Never mutates the input.
 */
function truncateMessageTextToTokenBudget(message: AgentMessage, budgetTokens: number): AgentMessage {
  let remaining = Math.max(0, Math.floor(budgetTokens));
  const cut = (text: string): string => {
    const r = truncateToTokenBudget(text, remaining);
    remaining = Math.max(0, remaining - r.estimate);
    if (!r.truncated) return text;
    return r.text ? `${r.text}\n${HARD_TRUNCATE_MARKER_TEXT}` : HARD_TRUNCATE_MARKER_TEXT;
  };
  if (typeof message.content === 'string') {
    return { role: message.role, content: cut(message.content) };
  }
  const nextBlocks = message.content.map((block): AgentMessageContentBlock => {
    if (block.type === 'text') return { ...block, text: cut(block.text) };
    if (block.type === 'tool_result') {
      if (typeof block.content === 'string') return { ...block, content: cut(block.content) };
      const nextParts = block.content.map((part) =>
        part.type === 'text' ? { ...part, text: cut(part.text) } : part,
      );
      return { ...block, content: nextParts };
    }
    return block; // tool_use input is structural, never shaved
  });
  return { role: message.role, content: nextBlocks };
}

/** Chars of TEXT that `truncateMessageTextToTokenBudget` can actually shave:
 *  string content, text blocks, tool_result string content and text parts.
 *  Excludes tool_use input JSON, image blocks, and per-block overheads. */
function messageShaveableTextChars(message: AgentMessage): number {
  if (typeof message.content === 'string') return message.content.length;
  let chars = 0;
  for (const block of message.content) {
    if (block.type === 'text') chars += block.text.length;
    else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') chars += block.content.length;
      else for (const part of block.content) { if (part.type === 'text') chars += part.text.length; }
    }
  }
  return chars;
}

/** Minimal text core kept on the FINAL message even in an emergency shave, so
 *  the turn's driving instruction never disappears entirely. */
const FINAL_MESSAGE_MIN_KEEP_TEXT_TOKENS = 64;

/**
 * Post-compaction SAFETY NET: shaves message TEXT largest-first across the
 * WHOLE live history until the estimate fits `hardLimitTokens`. Runs
 * unconditionally after the planned tier executes because the plan's tier
 * choice projects summariser savings that don't materialise when no
 * summariser is injected (all current callers), and its
 * `hardTruncateCandidates` are only populated on the 'hard_truncate' tier —
 * so e.g. a prose-dominated over-hardLimit history planned as
 * 'summarize_oldest' would otherwise be forwarded verbatim and 400.
 *
 * Shave order: older non-system messages first (before the keep-recent
 * suffix), then the protected/recent/system remainder — each group by
 * current estimate descending (index asc tiebreak) — and the FINAL message
 * last, keeping its minimal text core. Text-only shaving never removes a
 * message or block, so tool_use/tool_result pairing and block shape are
 * preserved; touched messages are REPLACED, never mutated (R12 checkpoint
 * snapshots keep their originals).
 *
 * Each candidate's text budget subtracts its UNshaveable tokens (image
 * blocks at IMAGE_BLOCK_TOKEN_ESTIMATE each, tool_use input JSON, per-block
 * overheads) computed in `estimateMessagesTokens`'s own chars/4 units, so an
 * image- or tool_use-heavy message gets a real text cut instead of an
 * over-allocated budget that frees nothing. The 64-token margin absorbs
 * marker text + estimator drift.
 *
 * Returns the final live estimate so callers can detect "still over".
 */
export function shaveMessagesTextToHardLimit(
  messages: AgentMessage[],
  hardLimitTokens: number,
  keepRecentCount?: number,
): number {
  let est = estimateMessagesTokens(messages);
  if (!(hardLimitTokens > 0) || est <= hardLimitTokens || messages.length === 0) return est;

  const n = messages.length;
  const rawKeep = typeof keepRecentCount === 'number' && Number.isFinite(keepRecentCount)
    ? Math.floor(keepRecentCount)
    : DEFAULT_KEEP_RECENT_COUNT;
  const keepRecent = Math.min(KEEP_RECENT_MAX, Math.max(KEEP_RECENT_MIN, rawKeep));
  const recentStart = Math.max(0, n - keepRecent);
  const lastIndex = n - 1;

  const order = messages
    .map((m, index) => ({
      index,
      size: estimateMessagesTokens([m]),
      group: index === lastIndex ? 2 : (m.role !== 'system' && index < recentStart ? 0 : 1),
    }))
    .sort((a, b) => (a.group - b.group) || (b.size - a.size) || (a.index - b.index));

  for (const cand of order) {
    if (est <= hardLimitTokens) break;
    const single = estimateMessagesTokens([messages[cand.index]]);
    // Unshaveable tokens in the SAME units as `single` (its 4-chars/token
    // heuristic + fixed image estimates), so the text budget below is the
    // true shaveable complement rather than the whole-message remainder.
    const nonTextTokens = Math.max(
      0,
      single - Math.ceil(messageShaveableTextChars(messages[cand.index]) / 4),
    );
    const needed = est - hardLimitTokens;
    const minKeep = cand.index === lastIndex ? FINAL_MESSAGE_MIN_KEEP_TEXT_TOKENS : 0;
    // 64-token safety margin absorbs marker text + estimator drift so the
    // shaved payload actually lands under the limit.
    const keepTextTokens = Math.max(minKeep, single - needed - 64 - nonTextTokens);
    messages[cand.index] = truncateMessageTextToTokenBudget(messages[cand.index], keepTextTokens);
    est = estimateMessagesTokens(messages);
  }
  return est;
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

function isValidToolUseId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 180
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
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
    toolResultStopGuard,
    onRoundComplete,
    steering,
    toolResultSummarization,
    tieredCompaction,
  } = opts;

  const emit = (e: AgentEvent) => { try { onEvent?.(e); } catch {} };

  // P6 deterministic result clamp — identity for small results and when the
  // caller opted out, so sub-threshold envelopes stay byte-identical.
  const summarizeResultText = (text: string): string =>
    toolResultSummarization === false
      ? text
      : summarizeToolResultForModel(text, toolResultSummarization || undefined);

  // `advertisedTools` is what the provider sees; it starts as the caller's
  // tool set and only ever GROWS via `resolveAdditionalTools` (T2).
  const advertisedTools: AgentToolDefinition[] = [...tools];
  const toolsByName = new Map<string, AgentToolDefinition>();
  for (const t of advertisedTools) toolsByName.set(t.name, t);

  const messages: AgentMessage[] = [...initialMessages];
  // Tool-use ids are provider-issued call capabilities. They must remain
  // unique for the complete run because mutation action/idempotency keys and
  // tool_result transcript pairing bind to them. Seed from resumed history so
  // a later provider turn cannot reuse a prior call id.
  const usedToolUseIds = new Set<string>();
  for (const message of initialMessages) {
    for (const block of ensureBlocks(message.content)) {
      if (block.type === 'tool_use' && isValidToolUseId(block.id)) {
        usedToolUseIds.add(block.id);
      }
    }
  }
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

  // Distinguishes the two ways the `while` can terminate that both fall
  // through to the terminal block below: a `signal.aborted` break (user cancel
  // / caller teardown) vs. genuine iteration-cap exhaustion. Without this the
  // aborted break emitted `max_iterations_exceeded` and returned
  // `hitMaxIterations: true`, so a cancelled run read as cap-exhausted in
  // telemetry and to callers (backlog #7). The in-loop early returns
  // (end_turn, empty-tool_use, progress-stop) never reach that block.
  let abortedExit = false;

  while (iteration < maxIterations) {
    if (signal?.aborted) { abortedExit = true; break; }
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

    // Tiered pre-turn context compaction (default ON; `tieredCompaction: false`
    // opts out). `planCompactionTier` picks the CHEAPEST sufficient tier from
    // token pressure: 'none' → identity (below 0.75× the window, unless the
    // ≥40-turn proactive gate trips — small contexts stay byte-identical);
    // 'drop_tool_noise' → free local stub of stale tool_result bytes;
    // 'summarize_oldest' → drop + the injected `compaction.summariser` (no
    // summariser → degrades to drop-only); 'hard_truncate' → emergency shave
    // of message TEXT. After the planned tier runs, an UNCONDITIONAL safety
    // net (`shaveMessagesTextToHardLimit`) re-checks the live estimate and
    // shaves regardless of the planned tier, so the provider never receives
    // an over-hardLimit prompt and 400s. Errors are swallowed — compaction
    // must never break the loop.
    if (tieredCompaction !== false) {
      try {
        const tierKeepRecent = tieredCompaction?.keepRecentCount ?? compaction?.preserveLast;
        const tierWindow = tieredCompaction?.contextWindowTokens ?? compaction?.maxContextTokens;
        const tierPlan: CompactionTierPlan = planCompactionTier({
          estimatedTokens: estimateMessagesTokens(messages),
          contextWindowTokens: tierWindow,
          reservedOutputTokens: tieredCompaction?.reservedOutputTokens,
          messages: projectMessagesForCompaction(messages),
          keepRecentCount: tierKeepRecent,
          turnCount: iteration,
        });
        if (tierPlan.tier !== 'none') {
          // Every tier starts with the free local drop. Messages are REPLACED,
          // never mutated — earlier R12 checkpoint snapshots keep originals.
          stubStaleToolResultContents(messages, tierKeepRecent);
          // Escalation: summarize the oldest history with the injected
          // summariser (same seam + event as the `compaction` block above).
          // All current callers inject none, so this degrades to drop-only.
          if (tierPlan.tier !== 'drop_tool_noise' && compaction?.summariser) {
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
        }
        // UNCONDITIONAL post-compaction safety net (subsumes the old
        // tier==='hard_truncate' shave): whatever tier ran — including
        // 'none' — never forward an over-hardLimit payload. The plan's
        // tier choice projects summariser savings that don't materialise
        // when no summariser is injected (all current callers), so e.g. a
        // prose-dominated history planned as 'summarize_oldest' can still
        // be far over the hard limit here; re-check the LIVE estimate and
        // shave text largest-first across the whole history until it fits.
        const preNetTokens = estimateMessagesTokens(messages);
        const liveTokens = preNetTokens > tierPlan.hardLimitTokens
          ? shaveMessagesTextToHardLimit(messages, tierPlan.hardLimitTokens, tierKeepRecent)
          : preNetTokens;
        const stillOver = liveTokens > tierPlan.hardLimitTokens;
        if (tierPlan.tier !== 'none') {
          emit({
            kind: 'context_compaction_tier',
            iteration,
            tier: tierPlan.tier,
            reason: (stillOver
              ? `${tierPlan.reason}; shave exhausted, still over hard ${tierPlan.hardLimitTokens}t`
              : tierPlan.reason).slice(0, 240),
            estimatedTokens: tierPlan.estimatedTokens,
            freedTokensApprox: Math.max(0, tierPlan.estimatedTokens - liveTokens),
          });
        } else if (preNetTokens > tierPlan.hardLimitTokens) {
          // The plan said 'none' but the live estimate was over the hard
          // limit (e.g. large reserved output under the soft trigger, or
          // nothing the plan believed compactable). The safety net still
          // ran — report it as a hard_truncate tier event so the emergency
          // stays observable.
          emit({
            kind: 'context_compaction_tier',
            iteration,
            tier: 'hard_truncate',
            reason: (`tier hard_truncate: safety net, plan none but est ${preNetTokens}t over hard `
              + `${tierPlan.hardLimitTokens}t${stillOver ? '; shave exhausted, still over' : ''}`).slice(0, 240),
            estimatedTokens: preNetTokens,
            freedTokensApprox: Math.max(0, preNetTokens - liveTokens),
          });
        }
      } catch { /* tiered compaction must never break the loop */ }
    }

    const turn = await provider.turn({
      messages,
      tools: advertisedTools,
      onDelta: (text) => emit({ kind: 'model_delta', iteration, text }),
    });
    lastStopReason = turn.stop_reason;

    emit({ kind: 'turn_end', iteration, stop_reason: turn.stop_reason, usage: turn.usage });

    if (turn.stop_reason !== 'tool_use') {
      messages.push({ role: 'assistant', content: turn.content });
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

    // Validate the whole requested round before recording it or entering any
    // handler. Empty, oversized, control-character, same-round duplicate, or
    // run-wide reused ids make tool_result pairing and mutation idempotency
    // ambiguous. Never fabricate a replacement id; fail closed without adding
    // the malformed assistant turn to the resumable transcript.
    const roundToolUseIds = new Set<string>();
    let hasInvalidToolUseId = false;
    for (const use of toolUses) {
      if (
        !isValidToolUseId(use.id)
        || roundToolUseIds.has(use.id)
        || usedToolUseIds.has(use.id)
      ) {
        hasInvalidToolUseId = true;
        break;
      }
      roundToolUseIds.add(use.id);
    }
    if (hasInvalidToolUseId) {
      lastText = 'Stopped before tool dispatch because the model returned a missing, invalid, or reused tool-call identity. No requested tool was run; start a fresh model turn before retrying.';
      emit({ kind: 'final_response', iteration, text: lastText });
      return {
        text: lastText,
        messages,
        iterations: iteration,
        stopReason: 'end_turn',
        hitMaxIterations: false,
        stoppedEarly: true,
      };
    }
    for (const id of roundToolUseIds) usedToolUseIds.add(id);

    // Record only a structurally valid assistant tool-use turn. Every id is
    // now bounded and reserved run-wide before the first handler can enter.
    messages.push({ role: 'assistant', content: turn.content });

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
      // A consultation is only useful when a NEXT provider turn exists to
      // answer it — the same final-round gating steering/onRoundComplete use.
      // Without this gate, a stuck verdict on the FINAL iteration pushed a
      // consultation nobody would ever consume, burned the run's one consult,
      // and exited via `max_iterations_exceeded` with EMPTY result text (the
      // last assistant turn is pure tool_use). Falling through to the hard
      // progress-stop below returns the informative terminal note instead.
      const nextTurnExists = iteration < maxIterations;
      if (projected.stuck && nextTurnExists && shouldConsultSolver({ stuck: true, alreadyConsulted: solverConsulted })) {
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
        // Fresh 3-strike window after the consultation (edge/legacy loop
        // parity): clearing the ring lets even the IDENTICAL call dispatch
        // once more — so a transient failure ("not ready yet", a bridge the
        // user just started, an approval just granted) can succeed on the
        // post-consultation attempt instead of being killed undispatched.
        // If it keeps failing, two more real failures plus the projected
        // third re-trip the verdict with the consultation spent → hard stop.
        recentToolCalls.length = 0;
        continue;
      }
      if (projected.stuck) {
        // We do NOT run the failing call again. Close the just-recorded
        // assistant tool_use with a terminal tool_result (keeps the transcript
        // well-formed / resumable — no dangling tool_use), stamp `result.text`
        // with the human-readable stop reason, and end the run. This is a
        // progress-based exit, distinct from `hitMaxIterations`. When the P56
        // solver consultation already ran, say so — the blocker is real.
        // (The consultation may have addressed an EARLIER stuck episode —
        // "spent" is the accurate claim, not "this exact call was consulted
        // on".)
        const note = solverConsulted
          ? `stopped: ${projected.reason} — no progress and the run's one solver consultation is already spent; report the blocker to the user.`
          : `stopped: ${projected.reason} — same failing call not retried; re-observe or ask the user before trying a different approach.`;
        emit({ kind: 'loop_stopped_no_progress', iteration, reason: projected.reason });
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUses[0].id, content: note, is_error: true }],
        });
        lastText = note;
        emit({ kind: 'final_response', iteration, text: lastText });
        return {
          text: lastText, messages, iterations: iteration,
          stopReason: 'end_turn', hitMaxIterations: false, stoppedEarly: true,
        };
      }
    }

    // Partition interactive tools — those must run sequentially and in the
    // order the model requested, matching Hermes' behaviour for `clarify`.
    const hasInteractive = toolUses.some(u => toolsByName.get(u.name)?.interactive);
    const effectiveConcurrency = hasInteractive ? 1 : parallelToolConcurrency;

    // Replay-safety gate (toolReplaySafetyCore): computed ONCE per round —
    // true iff a pure-read tool is advertised this round, so a failed
    // outcome-unknown mutate can be told "re-observe first, then retry only
    // if it did not land" (verify_first) instead of degrading straight to
    // unsafe_replay/escalate. No policy provider → gate stays off entirely
    // (fail open; failure envelopes byte-identical to before).
    const freshVerificationAvailable = toolParallelPolicyProvider
      ? advertisedTools.some((t) => {
          try {
            const p = toolParallelPolicyProvider(t.name);
            return p?.mutatesState === false && p.externalSideEffect === false;
          } catch { return false; }
        })
      : false;

    const enforcementTextByToolUseId = new Map<string, string>();
    const dispatchOne = async (use: typeof toolUses[number]): Promise<AgentMessageContentBlock> => {
      emit({ kind: 'tool_call_start', iteration, toolName: use.name, toolUseId: use.id, input: use.input });
      const started = Date.now();
      const def = toolsByName.get(use.name);
      let result: AgentToolResult;
      // Replay-safety scope guard: only failures whose request may have
      // actually reached the target (handler invoked, incl. "Handler threw")
      // are candidates for the replay-safety appendix below. Pre-dispatch
      // blocks (unregistered tool, constraint/floor block, approval reject)
      // provably never ran — appending "may have landed" there is false and
      // contradicts their fail-closed do-not-retry instruction.
      let dispatched = false;
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
              // Construct the tool context only at handler entry from the
              // exact provider-requested call. A shared round context cannot
              // honestly identify same-round calls and would make mutation
              // receipts/idempotency keys collide or rely on fabricated IDs.
              const handlerCtx: AgentToolContext = {
                session,
                toolName: use.name,
                toolUseId: use.id,
                iteration,
              };
              dispatched = true;
              result = await def.handler(use.input, handlerCtx);
            } catch (e) {
              // Tools SHOULD NOT throw — we still catch to preserve the loop.
              const message = e instanceof Error ? e.message : String(e);
              result = { ok: false, error: `Handler threw: ${message}` };
            }
          }
        }
      }
      const durationMs = Date.now() - started;
      emit({
        kind: 'tool_call_result',
        iteration,
        toolName: use.name,
        toolUseId: use.id,
        result,
        durationMs,
        dispatched,
      });
      // Metadata (R14) is a side channel for runtime consumers (design-app
      // manifest capture, audit ledgers) — it flows through the event above
      // but is STRIPPED from the model-visible tool_result content so hidden
      // captures never leak into the conversation.
      const modelVisible: AgentToolResult = result.ok
        ? { ok: true, data: result.data }
        : { ok: false, error: result.error };
      try {
        enforcementTextByToolUseId.set(
          use.id,
          JSON.stringify(stripBase64Payloads(modelVisible)),
        );
      } catch {
        // Tool data is expected to be JSON-safe, but enforcement must remain
        // total if a custom handler returns a pathological value. The visible
        // result path below retains its existing behavior.
        enforcementTextByToolUseId.set(use.id, '');
      }
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
        let failureContent = buildToolFailureFeedback(use.name, summarizeResultText(JSON.stringify(modelVisible)));
        // Replay-safety gate: the recovery template above can say "a single
        // retry is OK" — but for a non-idempotent side-effecting tool whose
        // failure is outcome-unknown (timeout / 5xx / reset after the request
        // may have landed), a blind replay risks DOUBLING the effect
        // (duplicate email/row/commit/push). When the caller supplied a
        // policy provider, append the core's bounded, secret-safe verdict so
        // the model verifies-or-escalates instead of replaying as-is.
        // replay_safe verdicts append nothing; no provider → byte-identical.
        // Gated on `dispatched`: pre-dispatch blocks never sent a request, so
        // their outcome is KNOWN (nothing ran) and no verdict is appended.
        if (toolParallelPolicyProvider && dispatched) {
          try {
            let policy: ToolParallelPolicy | null = null;
            try { policy = toolParallelPolicyProvider(use.name); } catch { policy = null; }
            const replay = decideToolReplaySafety({
              sideEffect: policy,
              disposition: result.error,
              freshVerificationAvailable,
              toolName: use.name,
            });
            if (replay.safety === 'verify_first' || replay.safety === 'unsafe_replay') {
              failureContent += '\n[replay-safety] ' + replay.reason.slice(0, 200);
            }
          } catch { /* replay-safety must never break the failure envelope */ }
        }
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: failureContent,
          is_error: true,
        };
      }
      // P6: sub-threshold results stay byte-identical to the legacy envelope;
      // an oversized one is deterministically clamped (head + tail + signal
      // lines) by summarizeResultText before it enters the transcript.
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: summarizeResultText(JSON.stringify(modelVisible)),
        is_error: false,
      };
    };

    const toRoundToolResult = (
      use: typeof toolUses[number],
      block: AgentMessageContentBlock | undefined,
    ): AgentRoundToolResult => {
      const tr = block?.type === 'tool_result' ? block : null;
      const resultText = typeof tr?.content === 'string'
        ? tr.content
        : Array.isArray(tr?.content)
          ? tr.content
              .filter((part): part is Extract<AgentToolResultContentPart, { type: 'text' }> => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
          : '';
      const enforcementText = enforcementTextByToolUseId.get(use.id);
      return {
        toolName: use.name,
        toolUseId: use.id,
        ok: tr?.is_error !== true,
        input: use.input,
        ...(resultText ? { resultText } : {}),
        ...(enforcementText ? { enforcementText } : {}),
      };
    };

    const skipAfterToolResultStop = (
      use: typeof toolUses[number],
      reason: string,
    ): AgentMessageContentBlock => {
      const result: AgentToolResult = {
        ok: false,
        error: `Tool "${use.name}" was not run because an earlier tool result triggered a safety stop. ${reason} Do not retry until the user clears the stop condition.`,
      };
      // There is deliberately no tool_call_start: the requested handler never
      // started. The result event closes telemetry with authoritative
      // dispatched:false semantics, matching the synthetic transcript block.
      emit({
        kind: 'tool_call_result',
        iteration,
        toolName: use.name,
        toolUseId: use.id,
        result,
        durationMs: 0,
        dispatched: false,
      });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
        is_error: true,
      };
    };

    // Dependency-aware dispatch (T8/O6): when the caller supplied a policy
    // provider and the round has no interactive tool, partition the round
    // into ordered groups — parallel within a group, sequential between.
    // Unknown tools (null policy / provider throw) fail closed as singleton
    // barriers. Result blocks are reassembled in original tool_use order so
    // the follow-up user message is byte-identical to the sequential shape.
    let toolResultBlocks: AgentMessageContentBlock[];
    let toolResultStopDecision: AgentToolResultStopDecision = undefined;
    if (toolResultStopGuard) {
      // A post-result stop policy cannot coexist safely with same-round
      // parallel handler entry: result #1 must be checked before handler #2
      // starts. Force strict original-order dispatch whenever this hook exists.
      toolResultBlocks = [];
      const completedToolResults: AgentRoundToolResult[] = [];
      for (const use of toolUses) {
        if (toolResultStopDecision && toolResultStopDecision.stop === true) {
          const reason = String(toolResultStopDecision.reason || 'a safety stop condition matched')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 240);
          const skipped = skipAfterToolResultStop(use, reason);
          toolResultBlocks.push(skipped);
          completedToolResults.push(toRoundToolResult(use, skipped));
          continue;
        }

        const block = await dispatchOne(use);
        toolResultBlocks.push(block);
        const latestToolResult = toRoundToolResult(use, block);
        completedToolResults.push(latestToolResult);
        try {
          toolResultStopDecision = await toolResultStopGuard({
            iteration,
            maxIterations,
            latestToolResult,
            completedToolResults: [...completedToolResults],
          });
        } catch {
          toolResultStopDecision = {
            stop: true,
            reason: 'tool-result safety guard failed',
            responseText: 'Stopped at a completed tool boundary because the safety check could not verify that it was safe to continue.',
          };
        }
      }
    } else if (toolParallelPolicyProvider && !hasInteractive) {
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

    const roundToolResults: AgentRoundToolResult[] = toolUses.map(
      (use, i) => toRoundToolResult(use, toolResultBlocks[i]),
    );

    // Resumable-checkpoint boundary (R12): every tool_use in this provider
    // turn now has a matching tool_result. A per-result stop decision is held
    // until after this emit so it always leaves a durable, well-formed
    // checkpoint, including on the final iteration.
    emit({ kind: 'iteration_complete', iteration, messages: [...messages] });

    // A per-result stop decision was already made BEFORE any later handler
    // could enter. We waited to return until now so every remaining tool_use
    // has an explicit skipped result and this checkpoint is fully resumable.
    if (toolResultStopDecision && toolResultStopDecision.stop === true) {
      const reason = String(toolResultStopDecision.reason || 'tool-result safety condition matched')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      lastText = typeof toolResultStopDecision.responseText === 'string' && toolResultStopDecision.responseText.trim()
        ? toolResultStopDecision.responseText.trim().slice(0, 1_200)
        : `Stopped at a completed tool boundary: ${reason}.`;
      emit({ kind: 'round_boundary_stopped', iteration, reason });
      emit({ kind: 'final_response', iteration, text: lastText });
      return {
        text: lastText,
        messages,
        iterations: iteration,
        stopReason: 'end_turn',
        hitMaxIterations: false,
        stoppedEarly: true,
      };
    }

    // Oscillation stop (audit): the pre-dispatch guard above only catches the
    // SAME single call repeating. This catches cross-round A-B-A-B failure
    // thrash — alternating failing tools that make no progress, which that
    // guard misses. Only fires after a round that had a failure, only when a
    // next provider turn exists to otherwise consume the result, and the pure
    // detector ignores exact-repeat (handled above) and any round with a
    // success. The transcript is well-formed here (tool_use/tool_result closed
    // by the push above), so the hard-stop is resumable — same shape as the
    // exact-repeat stop.
    if (iteration < maxIterations
      && toolResultBlocks.some((b) => b?.type === 'tool_result' && b.is_error === true)) {
      const osc = detectOscillatingFailure(
        recentToolCalls.map((c) => ({ name: c.name, ok: c.ok, argsKey: c.inputHash })),
      );
      if (osc.stuck) {
        // P56 parity: give the oscillation (A-B-A-B thrash) exit the SAME one
        // fresh-eyes solver consultation the exact-repeat exit already gets,
        // before hard-stopping — a cross-tool cycle is the failure mode most
        // likely to respond to a forced re-plan. The transcript is already
        // well-formed here (every tool_use is closed by the tool_result push
        // above), so nothing needs closing: inject the consultation as a plain
        // user turn and `continue`. The SHARED `solverConsulted` flag preserves
        // the <=1-consult-per-run bound — a consult already spent (here OR at
        // the exact-repeat exit) falls straight through to the hard stop below.
        // Every post-consultation dispatch still passes the same
        // constraint/approval gates: this changes the plan, not permissions.
        if (shouldConsultSolver({ stuck: true, alreadyConsulted: solverConsulted })) {
          solverConsulted = true;
          emit({ kind: 'solver_consultation', iteration, reason: osc.reason });
          // The oscillation is a CROSS-tool cycle, so there is no single
          // "requested" call to name — seed the consultation with the most
          // recent failing tool from the ring. The raw input is not
          // reconstructable from the ring (name + hash only), so `inputPreview`
          // is omitted (it is optional on SolverFailureContext).
          const lastFailing = [...recentToolCalls].reverse().find((c) => c.ok === false);
          messages.push({
            role: 'user',
            content: buildSolverConsultationMessage({
              tool: lastFailing?.name ?? 'the last tool',
              stuckReason: osc.reason,
              lastError: lastToolErrorText,
              availableTools: Array.from(toolsByName.keys()),
            }),
          });
          // Fresh window (edge/legacy loop parity — mirrors the exact-repeat
          // exit's ring clear) so the re-planned approach is judged on its own
          // outcomes, not re-tripped instantly by the pre-consultation thrash.
          recentToolCalls.length = 0;
          continue;
        }
        const note = `stopped: ${osc.reason} — the last several tool attempts are cycling without progress; re-observe or ask the user before trying a different approach.`;
        emit({ kind: 'loop_stopped_no_progress', iteration, reason: osc.reason });
        lastText = note;
        emit({ kind: 'final_response', iteration, text: lastText });
        return {
          text: lastText, messages, iterations: iteration,
          stopReason: 'end_turn', hitMaxIterations: false, stoppedEarly: true,
        };
      }
    }

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

  // Loop terminated at a boundary. Recover the last assistant text either way.
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  lastText = lastAssistant ? extractText(ensureBlocks(lastAssistant.content)) : '';

  // Aborted exit (signal cancelled): honest terminal signal — NOT cap
  // exhaustion. We deliberately do NOT emit `max_iterations_exceeded` here (it
  // would mislabel the run in telemetry / to `agentRunPersistence.finalize`,
  // which reads `hitMaxIterations`). There is no dedicated `run_aborted` event
  // kind in AgentEvent today, so we surface the abort via the result flag
  // only; a dedicated emit kind is a recommended follow-up (out of territory).
  if (abortedExit) {
    return {
      text: lastText,
      messages,
      iterations: iteration,
      // Keep the last real model stop reason (defaults to 'end_turn'); the
      // constrained union has no 'aborted' member and widening it would ripple
      // to out-of-territory consumers. `aborted: true` carries the true reason.
      stopReason: lastStopReason,
      hitMaxIterations: false,
      aborted: true,
    };
  }

  // Exited via max-iterations guard (genuine cap exhaustion).
  emit({ kind: 'max_iterations_exceeded', iteration });
  return {
    text: lastText,
    messages,
    iterations: iteration,
    stopReason: lastStopReason,
    hitMaxIterations: true,
  };
}
