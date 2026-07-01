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

import { compressContextIfOversized } from './agentContextCompression';
import { partitionParallelSafeBatch } from './toolBatchParallelism';
import type { ToolParallelPolicy } from './toolBatchParallelism';

export type AgentMessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export type AgentMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string | AgentMessageContentBlock[];
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema (subset) for input validation and provider tool advertising. */
  input_schema: Record<string, unknown>;
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
   * Fired after each completed tool round (R12), BEFORE the next provider
   * turn. `messages` is a shallow snapshot of the full history at this
   * boundary — callers can persist it as a resumable checkpoint (the
   * legacy `executeToolUseLoop` returned an equivalent via `incomplete` +
   * checkpoint). Persistence adapters should store counts, not the
   * messages themselves (they can be large).
   */
  | { kind: 'iteration_complete'; iteration: number; messages: AgentMessage[] };

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
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(modelVisible),
        is_error: !result.ok,
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

    // Tool results arrive as a single user-role message containing every
    // tool_result block, in the same order the tools were requested — this
    // is how Anthropic's Messages API expects the follow-up to be shaped.
    messages.push({ role: 'user', content: toolResultBlocks });

    // Resumable-checkpoint boundary (R12): the round is complete and the
    // history is consistent (tool_use/tool_result pairs closed). Snapshot
    // so later mutation of `messages` doesn't alias into the handler.
    emit({ kind: 'iteration_complete', iteration, messages: [...messages] });

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
