/**
 * delegationGate — CA-8d. Guards subagent delegation against the two
 * runaway patterns that blow up cost:
 *
 *   1. **Recursion depth.** Child can't spawn grandchildren past
 *      a hard ceiling. Hermes ships depth ≤ 2 (root → child → grandchild);
 *      we match. Past that, `canDelegate` returns `{ ok: false,
 *      reason: 'depth_exceeded' }` and the parent must continue in-line.
 *
 *   2. **Concurrency.** A single circle can't fan out 20 parallel
 *      subagents in one turn. Cap at 3 in-flight delegations per
 *      circle — anything above that queues or rejects.
 *
 * Also handles the Hermes summary-only contract: the parent sees only
 * `summary` from the child, not the full transcript. The Run Ledger
 * still has the full tree for operator debugging (separate table,
 * separate UI), but the parent's context window stays clean.
 *
 * Pure module — no Supabase client, no timers. Callers inject the
 * current in-flight count via `delegationCount`, and the pure
 * `canDelegate` returns a decision. The `redactSubagentOutput` helper
 * trims a full transcript to the summary payload the parent receives.
 *
 * Exported for the (future) subagentRegistry migration that moves
 * off `runOpenSwanRuntimeToolLoop` onto `agentExecutionCore`.
 */

export const MAX_DELEGATION_DEPTH = 2;
export const MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE = 3;

export type DelegationGateReason =
  | 'depth_exceeded'
  | 'concurrency_exceeded'
  | 'invalid_input'
  | 'ok';

export interface DelegationGateDecision {
  ok: boolean;
  reason: DelegationGateReason;
  detail?: string;
  /** How many more concurrent delegations this circle may spawn after
   *  the one proposed here. Surfaces in the Run Ledger so operators
   *  see the cap approaching. */
  remainingSlots: number;
}

export interface DelegationRequest {
  /** Depth of the PROPOSED child. Root call = 0, child = 1, grandchild = 2.
   *  Callers compute this from the parent's depth + 1. */
  proposedDepth: number;
  /** How many delegations are currently running for this circle
   *  (queried from `agent_runs` where status='running' AND
   *  parent_run_id IS NOT NULL for this circle). */
  inFlight: number;
  /** For debug logs + Run Ledger — does not affect the gate decision. */
  circleId?: string;
  parentRunId?: string;
}

/**
 * Pure gate. Decides whether a proposed delegation should proceed.
 * No side effects; the caller is responsible for counting in-flight
 * children + actually spawning the child.
 */
export function canDelegate(req: DelegationRequest): DelegationGateDecision {
  // `Number.isFinite` rejects NaN + Infinity which would otherwise
  // squeak past a naive `< 0` check (NaN compares false with every
  // ordering op).
  if (!Number.isFinite(req.proposedDepth) || req.proposedDepth < 0) {
    return { ok: false, reason: 'invalid_input', detail: 'proposedDepth must be a finite number ≥ 0', remainingSlots: 0 };
  }
  if (!Number.isFinite(req.inFlight) || req.inFlight < 0) {
    return { ok: false, reason: 'invalid_input', detail: 'inFlight must be a finite number ≥ 0', remainingSlots: 0 };
  }

  if (req.proposedDepth > MAX_DELEGATION_DEPTH) {
    return {
      ok: false,
      reason: 'depth_exceeded',
      detail: `proposed depth ${req.proposedDepth} exceeds max ${MAX_DELEGATION_DEPTH} — continue in-line instead of spawning another subagent`,
      remainingSlots: 0,
    };
  }

  if (req.inFlight >= MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE) {
    return {
      ok: false,
      reason: 'concurrency_exceeded',
      detail: `${req.inFlight} delegations already running for this circle — cap is ${MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE}`,
      remainingSlots: 0,
    };
  }

  return {
    ok: true,
    reason: 'ok',
    remainingSlots: MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE - req.inFlight - 1,
  };
}

// ─── Summary-only contract ───────────────────────────────────────────

export interface SubagentTranscript {
  /** Full tool-call history from the child run. Stays in the Run
   *  Ledger for operator view but MUST NOT be handed to the parent. */
  toolCalls: Array<{ name: string; input?: unknown; ok?: boolean; durationMs?: number }>;
  /** Final assistant text from the child. */
  finalText: string;
  /** Usage telemetry for cost accounting. */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  /** The child's stop_reason. Used to distinguish "child finished
   *  cleanly" from "child hit max iterations" — the parent should
   *  know either way. */
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  /** Optional explicit summary the child's prompt asked it to write.
   *  When present, this takes priority over the final text. */
  explicitSummary?: string;
}

export interface SubagentSummaryPayload {
  /** Human-readable summary the parent sees in its tool_result. */
  summary: string;
  /** How many tool calls the child made. The parent learns volume
   *  without seeing the full trace. */
  toolCallCount: number;
  /** Boolean flag — was this a clean completion or a capped run?
   *  Helps the parent decide whether to retry or accept partial. */
  completed: boolean;
  /** Cost delta from this child run — the parent rolls this into its
   *  own total. Present when `usage` was provided. */
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Redact a full subagent transcript into the summary-only payload the
 * parent should actually see. Keeps the full trace available for the
 * Run Ledger (caller persists separately). Summary priority:
 *   explicitSummary > finalText (trimmed to 1200 chars) > "no output"
 *
 * The 1200-char cap matches the existing tool_result trimming we use
 * across the edge fn — bigger summaries cost real tokens AND the
 * whole point of summary-only is that the child boils down its own
 * work.
 */
export function redactSubagentOutput(transcript: SubagentTranscript): SubagentSummaryPayload {
  const explicit = String(transcript.explicitSummary || '').trim();
  const final = String(transcript.finalText || '').trim();
  const raw = explicit || final || 'Subagent returned no output.';
  const summary = raw.length > 1200 ? raw.slice(0, 1197) + '...' : raw;

  const completed = transcript.stopReason === 'end_turn';

  const payload: SubagentSummaryPayload = {
    summary,
    toolCallCount: Array.isArray(transcript.toolCalls) ? transcript.toolCalls.length : 0,
    completed,
  };

  const usage = transcript.usage;
  if (usage) {
    if (typeof usage.input_tokens === 'number') payload.inputTokens = usage.input_tokens;
    if (typeof usage.output_tokens === 'number') payload.outputTokens = usage.output_tokens;
  }

  return payload;
}

/**
 * Compose a tool_result content block from a subagent summary payload.
 * The format mirrors our v2 tool_result shape: `{ ok: true, data: {...} }`
 * string so the parent model parses it the same way as any other
 * tool result. Not injecting it directly — callers hand this back to
 * the content_block builder.
 */
export function serializeSubagentSummaryForParent(payload: SubagentSummaryPayload): string {
  return JSON.stringify({
    ok: true,
    data: {
      summary: payload.summary,
      tool_calls: payload.toolCallCount,
      completed: payload.completed,
      usage: {
        input_tokens: payload.inputTokens ?? null,
        output_tokens: payload.outputTokens ?? null,
      },
    },
  });
}
