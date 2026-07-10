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
 * O3 (2026-06): the subagentRegistry migration landed. The typed-core
 * child loop wrapper (`runSubagentTypedCoreLoop`), the uniform summary
 * builders (`buildSubagentLoopSummary` / `buildSubagentParentSummary`),
 * the child-run persistence options builder
 * (`buildSubagentChildRunOptions`), and the escape-hatch flag
 * (`isSubagentTypedCoreEnabled`) live at the bottom of this file so the
 * delegation smokes can pin the REAL production composition with a mock
 * provider (subagentRegistry itself imports supabase → react-native and
 * is not tsx-loadable). The only value import is `agentExecutionCore`,
 * which is itself a pure smoke-tested module — this file stays free of
 * Supabase clients and timers.
 */

import { runAgent } from './agentExecutionCore';
import type {
  AgentEvent,
  AgentProvider,
  AgentRoundCompleteHook,
  AgentRunResult,
  AgentToolDefinition,
} from './agentExecutionCore';

export const MAX_DELEGATION_DEPTH = 2;
export const MAX_CONCURRENT_DELEGATIONS_PER_CIRCLE = 3;

export type DelegationGateReason =
  | 'depth_exceeded'
  | 'concurrency_exceeded'
  | 'spend_limit_exceeded'
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
  /** O3: requested specialist role (e.g. 'coder'). Debug/ledger context
   *  only — the decision stays a pure depth/concurrency function. */
  requestedRole?: string;
  /** O3: short preview of the delegated task text. Debug/ledger only. */
  taskPreview?: string;
  /** O4: the circle's model spend over the last 24h in USD (from
   *  `claude_api_usage` via `get_claude_usage_summary`). Omit/null when
   *  telemetry is unavailable — the spend check is then SKIPPED (budget
   *  guard fails open; depth/concurrency still apply). */
  dailySpendUsd?: number | null;
  /** O4: the most restrictive `agent_controls.spending_limit_daily`
   *  configured on the circle, in USD. Omit/null when no control row
   *  exists — no limit is enforced. An explicit 0 means "no delegation
   *  budget" and blocks every spawn. */
  dailySpendLimitUsd?: number | null;
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

  // O4: daily spend limit. Enforced only when BOTH numbers are present —
  // a failed telemetry read or an unconfigured circle never blocks
  // delegation (budget guard, not a security gate). `spend >= limit`
  // means an explicit limit of 0 blocks every spawn.
  const spend = req.dailySpendUsd;
  const limit = req.dailySpendLimitUsd;
  if (
    typeof spend === 'number' && Number.isFinite(spend) && spend >= 0
    && typeof limit === 'number' && Number.isFinite(limit) && limit >= 0
    && spend >= limit
  ) {
    return {
      ok: false,
      reason: 'spend_limit_exceeded',
      detail: `circle spent $${spend.toFixed(2)} of its $${limit.toFixed(2)} daily limit — no new subagents until spend resets; continue in-line instead`,
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

// ─── O3: typed-core child loop ───────────────────────────────────────
//
// subagentRegistry's child execution moved off the legacy
// `executeToolUseLoop` (swanbot.ts) onto `agentExecutionCore.runAgent`,
// the same migration O1 did for the parent session runtime. The pure
// composition lives HERE so the delegation smokes can run the real
// production loop against a mock provider; subagentRegistry only
// assembles the impure dependencies (bridge tools, swanbot-ai edge
// provider, run persistence, observation dispatch) and injects them.

export const SUBAGENT_TYPED_CORE_FLAG = 'uc_subagent_typed_core';

/**
 * O3 cutover switch — a MANUAL revert lever only, never an auto-fallback
 * (flipping paths mid-run would risk double-executing tools). Defaults ON.
 * Web: `localStorage.setItem('uc_subagent_typed_core', '0')` reverts the
 * next delegation to the legacy `executeToolUseLoop`; remove the key (or
 * set '1') to re-enable. Native has no localStorage — the try/catch
 * leaves the default. Mirrors O1's `uc_openswan_typed_core` lever.
 */
export function isSubagentTypedCoreEnabled(): boolean {
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(SUBAGENT_TYPED_CORE_FLAG);
    if (value === '0' || value === 'false' || value === 'off') return false;
  } catch { /* storage unavailable (native) → default ON */ }
  return true;
}

export type SubagentToolCallRecord = {
  name: string;
  ok: boolean;
  durationMs: number;
};

export type SubagentTypedCoreLoopArgs = {
  /** The fully composed specialist prompt (system prompt rides the provider). */
  userMessage: string;
  /** Already-wrapped tool definitions — the caller owns tool scoping, so a
   *  child can never gain a wider surface than the caller advertised. */
  tools: AgentToolDefinition[];
  provider: AgentProvider;
  /** Child round cap. subagentRegistry passes the legacy MAX_TOOL_ROUNDS. */
  maxIterations: number;
  session?: Record<string, unknown>;
  /** Event sink — chain `createPersistedRun(...).onEvent` here so child
   *  events land in agent_run_events. Errors are swallowed. */
  onEvent?: (event: AgentEvent) => void;
  /** Round-boundary nudge hook (legacy reliability-nudge parity). */
  onRoundComplete?: AgentRoundCompleteHook;
};

export type SubagentTypedCoreLoopOutcome = {
  runResult: AgentRunResult;
  /** One record per model-requested dispatch (auto-observe reads excluded —
   *  unlike the legacy event list, this is the accurate tool_call count). */
  toolCalls: SubagentToolCallRecord[];
  /** Aggregated across every turn; undefined when the provider reported
   *  none (legacy-loop parity: it reported no usage at all). `total`
   *  includes cache read/creation tokens, matching the O1 accumulator.
   *  GAP-2: `cache_read_tokens` / `cache_creation_tokens` carry the split so
   *  the delegated-usage rollup in the session runtime preserves the
   *  cache-discipline ratio (additive alongside total_tokens). */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
};

/**
 * Runs one subagent child turn on the typed core. Thin by design: tool
 * dispatch order, approval semantics (the legacy child path had NO
 * approval gate — none is added here), and event mapping all come from
 * `runAgent` + the caller's wrapped tools. Collects the two things the
 * summary-only contract needs that the legacy result shape lacked:
 * accurate tool-call records and aggregated token usage.
 */
export async function runSubagentTypedCoreLoop(
  args: SubagentTypedCoreLoopArgs,
): Promise<SubagentTypedCoreLoopOutcome> {
  const toolCalls: SubagentToolCallRecord[] = [];
  // GAP-2: track cache reads vs creation separately (not just an aggregate)
  // so the split survives into the delegated-usage rollup.
  const usageAcc = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, saw: false };

  const runResult = await runAgent({
    initialMessages: [{ role: 'user', content: args.userMessage }],
    tools: args.tools,
    provider: args.provider,
    maxIterations: Math.max(1, args.maxIterations),
    // Legacy child loop only parallelized all-read-only rounds; sequential
    // dispatch is the safe superset of that ordering (same call O1 made).
    parallelToolConcurrency: 1,
    session: args.session,
    onRoundComplete: args.onRoundComplete,
    onEvent: (event) => {
      if (event.kind === 'tool_call_result') {
        toolCalls.push({
          name: event.toolName,
          ok: event.result.ok,
          durationMs: event.durationMs,
        });
      } else if (event.kind === 'turn_end' && event.usage) {
        usageAcc.saw = true;
        usageAcc.input += event.usage.input_tokens || 0;
        usageAcc.output += event.usage.output_tokens || 0;
        usageAcc.cacheRead += event.usage.cache_read_input_tokens || 0;
        usageAcc.cacheCreation += event.usage.cache_creation_input_tokens || 0;
      }
      try { args.onEvent?.(event); } catch { /* persistence is best-effort */ }
    },
  });

  return {
    runResult,
    toolCalls,
    usage: usageAcc.saw
      ? {
          input_tokens: usageAcc.input,
          output_tokens: usageAcc.output,
          total_tokens: usageAcc.input + usageAcc.output + usageAcc.cacheRead + usageAcc.cacheCreation,
          cache_read_tokens: usageAcc.cacheRead,
          cache_creation_tokens: usageAcc.cacheCreation,
        }
      : undefined,
  };
}

/**
 * Builds the redacted summary payload from a finished child loop. Used by
 * BOTH the typed and the legacy escape-hatch path in subagentRegistry so
 * the parent contract stays uniform: `completedCleanly: false` (cap hit /
 * edge failure) maps to a non-end_turn stop reason → `completed: false`,
 * and usage flows into the token fields when the loop reported it.
 */
export function buildSubagentLoopSummary(args: {
  /** The child's FINAL user-facing text (incl. any cap-limit note). */
  finalText: string;
  toolCalls: Array<{ name: string; ok?: boolean }>;
  completedCleanly: boolean;
  usage?: { input_tokens?: number; output_tokens?: number };
}): SubagentSummaryPayload {
  const transcript: SubagentTranscript = {
    finalText: args.finalText,
    toolCalls: args.toolCalls.map((call) => ({
      name: call.name,
      input: undefined,
      ok: call.ok,
    })),
    stopReason: args.completedCleanly ? 'end_turn' : 'max_tokens',
    ...(args.usage
      && (typeof args.usage.input_tokens === 'number' || typeof args.usage.output_tokens === 'number')
      ? {
          usage: {
            ...(typeof args.usage.input_tokens === 'number' ? { input_tokens: args.usage.input_tokens } : {}),
            ...(typeof args.usage.output_tokens === 'number' ? { output_tokens: args.usage.output_tokens } : {}),
          },
        }
      : {}),
  };
  return redactSubagentOutput(transcript);
}

// ─── O3: parent-visible summary contract ─────────────────────────────

export type SubagentParentStatus = 'completed' | 'incomplete' | 'blocked' | 'failed';

/**
 * The ONLY shape parent-turn composers should inject into the parent's
 * context for a delegation. The child's full transcript/response never
 * rides this object — it stays on the child's run row for the ledger.
 */
export interface SubagentParentSummary {
  /** Redacted digest (`redactSubagentOutput` output — bounded, with a
   *  `...` truncation marker when capped). */
  summary: string;
  status: SubagentParentStatus;
  /** Child run id, when persistence succeeded. */
  runId?: string;
  /** null = the loop reported no usage (legacy path), never fabricated 0. */
  tokens: { input: number | null; output: number | null };
  toolCallCount: number;
}

export function buildSubagentParentSummary(args: {
  payload: SubagentSummaryPayload;
  status: SubagentParentStatus;
  runId?: string;
}): SubagentParentSummary {
  return {
    summary: args.payload.summary,
    status: args.status,
    ...(args.runId ? { runId: args.runId } : {}),
    tokens: {
      input: typeof args.payload.inputTokens === 'number' ? args.payload.inputTokens : null,
      output: typeof args.payload.outputTokens === 'number' ? args.payload.outputTokens : null,
    },
    toolCallCount: args.payload.toolCallCount,
  };
}

// ─── O3: child run persistence options ───────────────────────────────

/**
 * Shapes the `createPersistedRun(...)` options for a child delegation run
 * so the parentRunId linkage + delegation-depth stamp can't drift between
 * call sites (and so the smoke can pin them without importing supabase).
 * `delegatedToRole` rides metadata because `createPersistedRun` has no
 * `delegatedTo` passthrough; subagentRegistry backfills the column
 * best-effort after creation.
 */
export function buildSubagentChildRunOptions<S extends string>(args: {
  circleId: string;
  userId: string;
  surface: S;
  subagentRole: string;
  subagentDisplayName: string;
  task: string;
  model?: string;
  roomId?: string;
  parentRunId?: string;
  /** The PROPOSED child depth (parent depth + 1) — same value the gate saw. */
  delegationDepth: number;
  runtimePlanVersion?: string | number;
}): {
  circleId: string;
  userId: string;
  surface: S;
  title: string;
  mode: string;
  model?: string;
  roomId?: string;
  parentRunId?: string;
  metadata: Record<string, unknown>;
} {
  return {
    circleId: args.circleId,
    userId: args.userId,
    surface: args.surface,
    // Legacy title format preserved (run-list UI groups on it).
    title: `${args.subagentDisplayName}: ${args.task.slice(0, 80)}`,
    mode: args.subagentRole,
    ...(args.model ? { model: args.model } : {}),
    ...(args.roomId ? { roomId: args.roomId } : {}),
    ...(args.parentRunId ? { parentRunId: args.parentRunId } : {}),
    metadata: {
      ...(args.runtimePlanVersion !== undefined ? { runtimePlanVersion: args.runtimePlanVersion } : {}),
      delegationDepth: args.delegationDepth,
      delegatedToRole: args.subagentRole,
    },
  };
}
