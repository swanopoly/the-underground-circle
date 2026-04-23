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
  | { ok: true; data: unknown }
  | { ok: false; error: string };

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
  | { kind: 'model_delta'; iteration: number; text: string }
  | { kind: 'tool_call_start'; iteration: number; toolName: string; toolUseId: string; input: unknown }
  | { kind: 'tool_call_result'; iteration: number; toolName: string; toolUseId: string; result: AgentToolResult; durationMs: number }
  | { kind: 'turn_end'; iteration: number; stop_reason: ProviderTurnResult['stop_reason']; usage?: ProviderTurnResult['usage'] }
  | { kind: 'final_response'; iteration: number; text: string }
  | { kind: 'max_iterations_exceeded'; iteration: number };

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
  } = opts;

  const emit = (e: AgentEvent) => { try { onEvent?.(e); } catch {} };

  const toolsByName = new Map<string, AgentToolDefinition>();
  for (const t of tools) toolsByName.set(t.name, t);

  const messages: AgentMessage[] = [...initialMessages];
  let lastStopReason: ProviderTurnResult['stop_reason'] = 'end_turn';
  let lastText = '';
  let iteration = 0;

  while (iteration < maxIterations) {
    if (signal?.aborted) break;
    iteration += 1;
    emit({ kind: 'turn_start', iteration });

    const turn = await provider.turn({
      messages,
      tools,
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
        try {
          result = await def.handler(use.input, ctx);
        } catch (e) {
          // Tools SHOULD NOT throw — we still catch to preserve the loop.
          const message = e instanceof Error ? e.message : String(e);
          result = { ok: false, error: `Handler threw: ${message}` };
        }
      }
      const durationMs = Date.now() - started;
      emit({ kind: 'tool_call_result', iteration, toolName: use.name, toolUseId: use.id, result, durationMs });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      };
    };

    const toolResultBlocks = await runWithConcurrency(toolUses, dispatchOne, effectiveConcurrency);

    // Tool results arrive as a single user-role message containing every
    // tool_result block, in the same order the tools were requested — this
    // is how Anthropic's Messages API expects the follow-up to be shaped.
    messages.push({ role: 'user', content: toolResultBlocks });

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
