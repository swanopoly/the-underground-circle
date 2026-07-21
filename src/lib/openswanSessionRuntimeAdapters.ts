/**
 * openswanSessionRuntimeAdapters — pure adapter layer for O1: the
 * `openswanSessionRuntime` cutover from the legacy `executeToolUseLoop`
 * (swanbot.ts) onto the typed `agentExecutionCore.runAgent` core.
 *
 * Everything here is dependency-light and side-effect free (smoke:
 * `scripts/openswan-session-core-adapter-smoketest.ts`); the impure pieces
 * (supabase edge invoke, tool policy lookup, emitStage wiring) stay in
 * `openswanSessionRuntime.runTypedCoreToolLoop` and inject into these
 * functions.
 *
 * Contract this layer preserves (legacy `executeToolUseLoop` parity):
 *   - The approval gate receives the EXACT `{ name, input }` payload the
 *     legacy loop passed (R19 — approval fingerprints hash tool+args via
 *     `stableApprovalJson`; any normalization here would invalidate every
 *     cached approval).
 *   - Tool events keep the legacy shape `{ tool, input, result, status,
 *     metadata }` with the legacy status vocabulary
 *     (passed/failed/manual_required/blocked) and the legacy metadata keys
 *     (toolPolicy, approvalRequest, browserPlan, design-app capture) so
 *     design-manifest capture, browser-plan extraction, ledger persistence,
 *     and run metadata stay byte-compatible.
 *   - The loop result keeps the legacy shape `{ response, toolEvents,
 *     routing?, incomplete?, checkpoint? }` including the cap-exhaustion
 *     limit note + progress summary + resumable checkpoint.
 *   - Stage mapping follows the R13 decision: turn_start → reasoning,
 *     tool_call_start → using_tools, final_response / non-tool_use turn_end
 *     → finalizing. Pre/post-loop stages (booting, loading_context,
 *     delegating, rendering_artifacts) stay with their existing emitStage
 *     callsites in the session runtime.
 */

import type {
  AgentEvent,
  AgentMessage,
  AgentMessageContentBlock,
  AgentRoundCompleteHook,
  AgentRunResult,
  AgentToolApprovalGate,
  AgentToolDefinition,
  AgentToolResult,
  ProviderTurnResult,
} from './agentExecutionCore';
import type { OpenSwanExecutionStatus } from './openswanExecution';
import {
  buildToolLoopCheckpoint,
  summarizeToolLoopProgress,
  type ToolLoopCheckpoint,
} from './toolLoopProgress';
import { appendAppActionVerificationGate } from './appActionVerificationGate';
import { appendStuckBreaker } from './toolLoopStuckBreaker';
import { toolBudgetReminder } from './toolLoopBudget';
import { evaluateStepBudget } from './openswanStepBudgetCore';
import { planDeterministicReobserve, summarizeObservationForRetry } from './deterministicReobserve';
import { assessProofCoverage, proofCoverageNudge } from './proofCoverage';
import {
  buildDesignAppRuntimeToolCaptureMetadata,
  withDesignAppRuntimeCaptureMetadata,
} from './designAppRuntimeManifest';
import type { AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';
import { formatVerificationReceipt } from './verificationReceiptCore';
import type { VerificationReceipt } from './verificationReceiptCore';

// ─── Shared shapes ──────────────────────────────────────────────────────────

/** Legacy tool-event shape consumed by the session runtime's post-loop code
 *  (design-manifest ledger, runtimeToolActions mapping, browser plans). */
export type LegacyToolEvent = {
  tool: string;
  input: unknown;
  result: string;
  status: OpenSwanExecutionStatus;
  metadata?: Record<string, unknown>;
};

export type SwanBotRoutingInfo = {
  provider_routed?: string;
  provider_model?: string;
  routing_fallback?: { provider: string; reason: string };
};

export type SwanbotRelaySubjectFields = {
  targetAgentName?: string | null;
  targetAgentSubjectKey?: string | null;
  targetAgentDbId?: string | null;
  targetAgentLegacyIds?: string[] | null;
  agentSubject?: AgentRuntimeSubjectMetadata | null;
  agentSubjectKey?: string | null;
  agentDbId?: string | null;
  agentLegacyIds?: string[] | null;
};

/** Legacy `executeToolUseLoop` return shape (+ optional aggregated usage —
 *  the legacy loop reported none, so `usage` only appears on the typed path). */
export type LegacyToolLoopResult = {
  response: string;
  toolEvents: LegacyToolEvent[];
  routing?: SwanBotRoutingInfo;
  incomplete?: boolean;
  checkpoint?: ToolLoopCheckpoint;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    // GAP-2: cache read vs creation kept separate (the ratio that proves cache
    // discipline works). Additive alongside total_tokens for back-compat.
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  /** Coding-lane proof-of-work receipt ("edited N files · checks passed ·
   *  committed sha") assembled by the typed-core runtime from this turn's tool
   *  events. Optional/additive: the legacy loop and subagentRegistry never set
   *  it, and no consumer requires it. */
  verificationReceipt?: VerificationReceipt;
};

/** Legacy gate signature (OpenSwanRunCallbacks.onToolApproval). */
export type LegacyToolApprovalGate = (call: { name: string; input: any }) => Promise<'approve' | 'reject'>;

// Internal side-channel keys on AgentToolResult.metadata. The core strips
// metadata from model-visible tool_result content (R14); the event mapper
// strips these two keys before metadata reaches persisted tool events, so
// they never leak anywhere.
export const LEGACY_RUNTIME_STATUS_KEY = '__o1RuntimeStatus';
export const LEGACY_EVENT_TEXT_KEY = '__o1EventText';

/** Legacy rejection text fed back as the tool event result (parity with
 *  executeToolUseLoop's gate-reject branch). */
export const LEGACY_GATE_REJECTION_TEXT =
  'User declined this tool call. Try a different approach or ask the user how to proceed.';

export const TOOL_LOOP_EDGE_FAILURE_TEXT = 'Tool-use call failed.';

// ─── Approval gate (R11 + R19) ──────────────────────────────────────────────

/**
 * Adapts the legacy `onToolApproval` gate to `runAgent`'s pre-dispatch
 * `AgentToolApprovalGate`. R19: the payload passed to the legacy gate is the
 * exact `{ name: toolName, input }` object pair the legacy loop used —
 * `input` is forwarded by reference, untouched, so approval fingerprints
 * (`stableApprovalJson` over tool+args) remain byte-identical.
 *
 * A gate throw maps to reject (the legacy loop's catch → 'reject' behavior;
 * the typed core would also fail closed on a throw — this just keeps the
 * decision deterministic at one layer).
 */
export function createLegacyApprovalGateAdapter(
  gate: LegacyToolApprovalGate,
  onRejected?: (toolUseId: string) => void,
): AgentToolApprovalGate {
  return async (req) => {
    let decision: 'approve' | 'reject';
    try {
      decision = await gate({ name: req.toolName, input: req.input });
    } catch {
      decision = 'reject';
    }
    if (decision === 'reject') {
      onRejected?.(req.toolUseId);
      return { decision: 'reject', reason: LEGACY_GATE_REJECTION_TEXT };
    }
    return { decision: 'approve' };
  };
}

// ─── Stage mapping (R13) ────────────────────────────────────────────────────

/** Subset of OpenSwanRunStage the in-loop mapper can emit. */
export type OpenSwanLoopStage = 'reasoning' | 'using_tools' | 'finalizing';

/**
 * Maps a core loop event to the OpenSwan stage + user-visible label.
 *
 * Honest step denominator: when the caller shares the turn's round cap
 * (`opts.maxRounds` — openswanSessionRuntime's resolved `maxRounds`), labels
 * from round 2 on read "step i of N" instead of an open-ended counter, and the
 * pure step-budget guard (`evaluateStepBudget`) decides when the label should
 * admit the cap is imminent/reached (checkpoint/stop ⇒ ' — wrapping up').
 * Round-1 labels and every no-opts call stay byte-identical to the legacy
 * mapper; a degenerate cap (non-finite / <= 0) is treated as absent.
 */
export function mapAgentEventToOpenSwanStage(
  event: AgentEvent,
  opts?: { maxRounds?: number },
): { stage: OpenSwanLoopStage; label: string } | null {
  const maxRounds =
    typeof opts?.maxRounds === 'number' && Number.isFinite(opts.maxRounds) && opts.maxRounds > 0
      ? Math.floor(opts.maxRounds)
      : null;
  switch (event.kind) {
    case 'turn_start': {
      if (event.iteration <= 1) {
        return { stage: 'reasoning', label: 'Reasoning with tools' };
      }
      if (maxRounds === null) {
        return { stage: 'reasoning', label: `Reasoning over tool results (step ${event.iteration})` };
      }
      const wrappingUp =
        evaluateStepBudget({ stepsUsed: event.iteration, maxSteps: maxRounds }).action !== 'continue'
          ? ' — wrapping up'
          : '';
      return {
        stage: 'reasoning',
        label: `Reasoning over tool results (step ${event.iteration} of ${maxRounds})${wrappingUp}`,
      };
    }
    case 'tool_call_start':
      return {
        stage: 'using_tools',
        label: maxRounds === null
          ? `Using ${event.toolName}`
          : `Using ${event.toolName} · step ${event.iteration}/${maxRounds}`,
      };
    case 'final_response':
      return { stage: 'finalizing', label: 'Finalizing response' };
    case 'turn_end':
      // turn_end fires every iteration; only a non-tool_use stop means the
      // model is done (a tool_use turn_end is mid-loop — stage stays put).
      return event.stop_reason === 'tool_use'
        ? null
        : { stage: 'finalizing', label: 'Finalizing response' };
    default:
      return null;
  }
}

// ─── Tool handler shaping (legacy dispatchToolDetailed parity) ─────────────

/** Status derivation copied from `openswanTools/index.dispatchToolDetailed`. */
export function deriveLegacyDispatchStatus(
  toolName: string,
  raw: unknown,
  approvalRequest: unknown,
): OpenSwanExecutionStatus {
  if (approvalRequest) return 'manual_required';
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (toolName.startsWith('verification.') && rec?.executed === false) return 'blocked';
  if (rec?.ok === false) return 'failed';
  return 'passed';
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) || '';
  } catch {
    return String(value ?? '');
  }
}

/**
 * Wraps a bridge tool handler result (`{ok, data: {raw, text}}`) into the
 * shape the typed loop + legacy consumers need:
 *   - model-visible `data.text` = formatted result + the legacy in-loop
 *     nudges (observe→act→VERIFY gate, stuck-loop breaker) — the raw
 *     structured payload is moved off the model path into metadata-driven
 *     events, matching the legacy loop's token profile.
 *   - `metadata` = legacy dispatch metadata (toolPolicy, approvalRequest,
 *     browserPlan for browser.plan_task, design-app capture) plus the two
 *     internal side-channel keys the event mapper consumes (R14: metadata
 *     rides events, never the model-visible content).
 */
export function shapeLegacyToolHandlerResult(args: {
  toolName: string;
  input: unknown;
  inner: AgentToolResult;
  /** Injected by the runtime (impure catalog lookup); null if lookup failed. */
  toolPolicy?: Record<string, unknown> | null;
  /** Shared accumulating event list — read-only here (stuck-repeat detection). */
  priorToolEvents: LegacyToolEvent[];
}): AgentToolResult {
  const { toolName, inner } = args;
  const data = inner.ok ? (inner.data as Record<string, unknown> | undefined) : undefined;
  const raw = data?.raw;
  const formattedText = inner.ok
    ? (typeof data?.text === 'string' && data.text ? data.text : safeStringify(raw ?? data))
    : `Tool error: ${inner.error}`;
  const approvalRequest = (raw as Record<string, unknown> | undefined)?.approvalRequest || null;
  const status: OpenSwanExecutionStatus = inner.ok
    ? deriveLegacyDispatchStatus(toolName, raw, approvalRequest)
    : 'failed';
  const capture = inner.ok
    ? buildDesignAppRuntimeToolCaptureMetadata(toolName, raw, args.input)
    : null;
  const metadata = withDesignAppRuntimeCaptureMetadata(
    {
      ...(toolName === 'browser.plan_task'
        ? { browserPlan: (raw as Record<string, unknown> | undefined)?.plan || null }
        : {}),
      ...(args.toolPolicy ? { toolPolicy: args.toolPolicy } : {}),
      approvalRequest,
      [LEGACY_RUNTIME_STATUS_KEY]: status,
      [LEGACY_EVENT_TEXT_KEY]: formattedText,
    },
    capture,
  );

  // Legacy in-loop reliability nudges (model-visible only — the tool EVENT
  // keeps the un-nudged formatted text, same as the legacy loop).
  let shaped = appendAppActionVerificationGate(formattedText, toolName, String(status));
  shaped = appendStuckBreaker(shaped, args.priorToolEvents, {
    tool: toolName,
    input: args.input,
    status: String(status),
  });

  return inner.ok
    ? { ok: true, data: { text: shaped }, metadata }
    : { ok: false, error: shaped, metadata };
}

// ─── Tool event mapping (R14 → legacy toolEvents) ───────────────────────────

/**
 * Builds the legacy tool-event record from a `tool_call_result` event.
 * Strips the internal side-channel keys so persisted metadata matches the
 * legacy dispatch metadata exactly.
 */
export function buildLegacyToolEventFromResult(args: {
  toolName: string;
  input: unknown;
  result: AgentToolResult;
  rejectedByGate?: boolean;
}): LegacyToolEvent {
  if (args.rejectedByGate) {
    return {
      tool: args.toolName,
      input: args.input,
      result: LEGACY_GATE_REJECTION_TEXT,
      status: 'blocked',
      metadata: { rejected_by_user: true },
    };
  }
  const meta = (args.result.metadata || {}) as Record<string, unknown>;
  const {
    [LEGACY_RUNTIME_STATUS_KEY]: runtimeStatus,
    [LEGACY_EVENT_TEXT_KEY]: eventText,
    ...rest
  } = meta;
  const text = typeof eventText === 'string'
    ? eventText
    : args.result.ok
      ? (() => {
          const d = args.result.data as Record<string, unknown> | undefined;
          return typeof d?.text === 'string' ? d.text : safeStringify(d);
        })()
      : `Tool error: ${(args.result as { error: string }).error}`;
  const status = (
    typeof runtimeStatus === 'string' && runtimeStatus
      ? runtimeStatus
      : args.result.ok ? 'passed' : 'failed'
  ) as OpenSwanExecutionStatus;
  return {
    tool: args.toolName,
    input: args.input,
    result: text,
    status,
    ...(Object.keys(rest).length > 0 ? { metadata: rest } : {}),
  };
}

// ─── Round-boundary reliability nudges (O1 nudge parity) ────────────────────

/** Legacy `dispatchToolDetailed` essentials for the auto re-observe read —
 *  injected by the runtime (impure dispatch stays out of this pure layer). */
export type LegacyObservationDispatch = (
  observationTool: string,
) => Promise<{ text: string; status: string }>;

/**
 * The three loop-internal reliability nudges from the legacy
 * `executeToolUseLoop` (swanbot.ts), re-homed onto `runAgent`'s generic
 * `onRoundComplete` hook. Reuses the SAME pure helpers the legacy loop calls
 * (`deterministicReobserve`, `proofCoverage`, `toolLoopBudget` — each pinned
 * by its own smoke), so trigger conditions and injected text stay identical.
 *
 * Per round (legacy order — re-observe rode the failed tool_result, the
 * budget note rode the LAST tool_result; legacy could emit both in one
 * round, so they combine here too):
 *
 *   1. Deterministic re-observe — a FAILED browser/desktop UI action
 *      auto-captures fresh ground truth (DOM snapshot / a11y tree) and
 *      injects it so the retry is grounded in current state. Legacy gating
 *      preserved: skipped in per-step review mode (`hasApprovalGate`) — there
 *      the model can request the read as its next reviewed step. The
 *      observation also lands in `toolEvents` with `auto_reobserve: true`.
 *   2. Proof-coverage nudge — the turn mutated an app but captured no proof
 *      after the last successful mutation → surface-aware "capture proof"
 *      nudge (browser mutations get browser proof options). Same assessment
 *      + text + once-per-turn bound (`proofNudged`) as legacy. Delta vs
 *      legacy, documented: the legacy loop intercepted the model's DONE
 *      response and injected this before accepting it; `runAgent` has no
 *      done-branch seam, so the typed path fires it proactively at the round
 *      boundary instead. The final-round skip (legacy `round < maxRounds-1`)
 *      is enforced by the core (the hook never fires on the final round).
 *   3. Tool-budget reminder — final-stretch "converge now" note with the
 *      remaining round count (legacy `toolBudgetReminder(round+1, maxRounds)`;
 *      the core's 1-indexed `iteration` IS legacy `round+1`).
 *
 * All notes concatenate into ONE user message (each helper's text already
 * carries its own leading separation, same as the legacy `${content}${note}`
 * appends). Re-observe stays best-effort: a throwing/empty observation adds
 * nothing and the stuck-breaker's "re-observe" nudge remains the fallback.
 */
export function createLegacyRoundNudgeHook(args: {
  /** Shared accumulating legacy event list — read for triggers (statuses the
   *  core's ok-flag can't see) and appended to for auto-observe events. */
  toolEvents: LegacyToolEvent[];
  /** Legacy parity: per-step review mode disables auto re-observe. */
  hasApprovalGate: boolean;
  dispatchObservation: LegacyObservationDispatch;
}): AgentRoundCompleteHook {
  // Legacy `let proofNudged = false` — at most one proof nudge per turn so a
  // model that truly can't produce proof still terminates.
  let proofNudged = false;
  return async (ctx) => {
    const notes: string[] = [];

    // 1. Deterministic re-observe for this round's failed UI actions. The
    //    round's legacy events are the last N pushed (one per tool_use, in
    //    order) — sliced BEFORE auto-observe events are appended.
    if (!args.hasApprovalGate) {
      const roundEvents = args.toolEvents.slice(
        Math.max(0, args.toolEvents.length - ctx.toolResults.length),
      );
      for (const event of roundEvents) {
        const reobserve = planDeterministicReobserve(event.tool, String(event.status));
        if (!reobserve) continue;
        try {
          const obs = await args.dispatchObservation(reobserve.observationTool);
          const note = summarizeObservationForRetry(obs?.text, String(obs?.status), { maxChars: 1400 });
          if (note) {
            notes.push(note);
            args.toolEvents.push({
              tool: reobserve.observationTool,
              input: {},
              result: obs.text,
              status: obs.status as OpenSwanExecutionStatus,
              metadata: { auto_reobserve: true },
            });
          }
        } catch { /* observation is best-effort; never break the loop */ }
      }
    }

    // 2. Proof-coverage nudge (once per turn, full-turn assessment).
    if (!proofNudged) {
      const coverage = assessProofCoverage(args.toolEvents);
      if (coverage.missingProof) {
        proofNudged = true;
        notes.push(proofCoverageNudge(coverage));
      }
    }

    // 3. Step-budget convergence reminder for the final stretch.
    const budgetNote = toolBudgetReminder(ctx.iteration, ctx.maxIterations);
    if (budgetNote) notes.push(budgetNote);

    if (notes.length === 0) return;
    return { appendUserNote: notes.join('') };
  };
}

// ─── Usage aggregation ──────────────────────────────────────────────────────

export type LoopUsageAccumulator = {
  input_tokens: number;
  output_tokens: number;
  /** Aggregate cache tokens (read + creation) — kept for back-compat. */
  cache_tokens: number;
  // GAP-2: cache reads vs creation accumulated SEPARATELY. The read:creation
  // ratio is the exact signal that proves the P26 cache breakpoints work
  // (high reads = the history/system prefix is being served from cache); the
  // old single `cache_tokens` sum discarded it. `parseSwanbotToolTurnData`
  // already reads both fields off each turn's usage — we just stop collapsing
  // them here.
  cache_read_tokens: number;
  cache_creation_tokens: number;
  sawUsage: boolean;
};

export function createLoopUsageAccumulator(): LoopUsageAccumulator {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    sawUsage: false,
  };
}

/** Feed each `turn_end` event's usage into the accumulator. */
export function accumulateLoopUsage(
  acc: LoopUsageAccumulator,
  usage?: ProviderTurnResult['usage'],
): void {
  if (!usage || typeof usage !== 'object') return;
  acc.sawUsage = true;
  acc.input_tokens += usage.input_tokens || 0;
  acc.output_tokens += usage.output_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const creation = usage.cache_creation_input_tokens || 0;
  acc.cache_read_tokens += read;
  acc.cache_creation_tokens += creation;
  acc.cache_tokens += read + creation;
}

/**
 * Final usage in the SwanBotStructuredResponse shape. `total_tokens`
 * includes cache reads/creation so the run-status math
 * (`cached = total - (input + output)`) yields the cache token count.
 * `cache_read_tokens` / `cache_creation_tokens` carry the split through to
 * persistence (GAP-2) alongside the aggregate. Returns undefined when the
 * edge never reported usage (legacy parity: {}).
 */
export function finalizeLoopUsage(
  acc: LoopUsageAccumulator,
):
  | {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
    }
  | undefined {
  if (!acc.sawUsage) return undefined;
  return {
    input_tokens: acc.input_tokens,
    output_tokens: acc.output_tokens,
    total_tokens: acc.input_tokens + acc.output_tokens + acc.cache_tokens,
    cache_read_tokens: acc.cache_read_tokens,
    cache_creation_tokens: acc.cache_creation_tokens,
  };
}

// ─── Provider request/response shaping (swanbot-ai edge transport) ─────────

/** Anthropic tool shapes the edge fn expects (definition minus handler). */
export function toAnthropicToolShapes(
  tools: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'input_schema' | 'input_examples'>>,
): Array<{ name: string; description: string; input_schema: Record<string, unknown>; input_examples?: Array<Record<string, unknown>> }> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    // X4 (P47): forward curated input_examples when present (GA, no header;
    // the edge relay forwards tools verbatim to Anthropic).
    ...(t.input_examples ? { input_examples: t.input_examples } : {}),
  }));
}

function cleanRelaySubjectString(value: string | null | undefined): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}

function cleanRelaySubjectArray(values: string[] | null | undefined): string[] | undefined {
  const out = Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
  return out.length > 0 ? out : undefined;
}

function buildRelaySubjectPayload(args: SwanbotRelaySubjectFields): Record<string, unknown> {
  const subject = args.agentSubject || null;
  const targetAgentName = cleanRelaySubjectString(args.targetAgentName)
    || cleanRelaySubjectString(subject?.agentDisplayName);
  const subjectKey = cleanRelaySubjectString(args.targetAgentSubjectKey)
    || cleanRelaySubjectString(args.agentSubjectKey)
    || cleanRelaySubjectString(subject?.agentSubjectKey);
  const dbId = cleanRelaySubjectString(args.targetAgentDbId)
    || cleanRelaySubjectString(args.agentDbId)
    || cleanRelaySubjectString(subject?.agentDbId || undefined);
  const legacyIds = cleanRelaySubjectArray(args.targetAgentLegacyIds)
    || cleanRelaySubjectArray(args.agentLegacyIds)
    || cleanRelaySubjectArray(subject?.legacyAgentIds);
  return {
    ...(targetAgentName ? { targetAgentName } : {}),
    ...(subjectKey ? { targetAgentSubjectKey: subjectKey, agentSubjectKey: subjectKey } : {}),
    ...(dbId ? { targetAgentDbId: dbId, agentDbId: dbId } : {}),
    ...(legacyIds ? { targetAgentLegacyIds: legacyIds, agentLegacyIds: legacyIds } : {}),
    ...(subject ? { agentSubject: subject } : {}),
  };
}

/**
 * Builds the exact `swanbot-ai` invoke body the legacy loop sent per round:
 * `message` always carries the original user prompt; `tool_messages` only
 * appears once the history has grown past the initial user message.
 */
export function buildSwanbotToolTurnBody(args: {
  userMessage: string;
  circleId: string;
  userId: string;
  model: string;
  systemPrompt: string;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  messages: AgentMessage[];
} & SwanbotRelaySubjectFields): Record<string, unknown> {
  return {
    message: args.userMessage,
    circleId: args.circleId,
    userId: args.userId,
    model: args.model,
    tools: args.tools,
    tool_messages: args.messages.length > 1
      ? args.messages.map((m) => ({ role: m.role, content: m.content }))
      : undefined,
    system_override: args.systemPrompt,
    ...buildRelaySubjectPayload(args),
  };
}

/**
 * Maps a `swanbot-ai` edge response onto a ProviderTurnResult + routing.
 * Content blocks pass through UNFILTERED (thinking/unknown blocks must ride
 * along in the assistant message so the next round's API call stays valid),
 * mirroring the legacy loop's `messages.push({ role: 'assistant', content })`.
 * `stop_reason: 'tool_use'` only survives when actual tool_use blocks exist
 * (legacy: `toolUseBlocks.length === 0 || stop_reason !== 'tool_use'` → final).
 */
export function parseSwanbotToolTurnData(data: unknown): {
  turn: ProviderTurnResult;
  routing?: SwanBotRoutingInfo;
} {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  let blocks = (Array.isArray(d.content) ? d.content : []) as AgentMessageContentBlock[];
  const hasToolUse = blocks.some((b) => (b as { type?: string })?.type === 'tool_use');
  if (blocks.length === 0 && typeof d.response === 'string' && d.response) {
    blocks = [{ type: 'text', text: d.response }];
  }
  const stop: ProviderTurnResult['stop_reason'] =
    d.stop_reason === 'tool_use' && hasToolUse
      ? 'tool_use'
      : d.stop_reason === 'max_tokens'
        ? 'max_tokens'
        : d.stop_reason === 'stop_sequence'
          ? 'stop_sequence'
          : 'end_turn';
  const rawUsage = (d.usage && typeof d.usage === 'object' ? d.usage : null) as
    | Record<string, unknown>
    | null;
  const usage: ProviderTurnResult['usage'] | undefined = rawUsage
    ? {
        input_tokens: Number(rawUsage.input_tokens) || 0,
        output_tokens: Number(rawUsage.output_tokens) || 0,
        cache_read_input_tokens: Number(rawUsage.cache_read_input_tokens) || 0,
        cache_creation_input_tokens: Number(rawUsage.cache_creation_input_tokens) || 0,
      }
    : undefined;
  let routing: SwanBotRoutingInfo | undefined;
  if (d.provider_routed || d.routing_fallback) {
    routing = {};
    if (d.provider_routed) routing.provider_routed = String(d.provider_routed);
    if (d.provider_model) routing.provider_model = String(d.provider_model);
    if (d.routing_fallback) {
      routing.routing_fallback = d.routing_fallback as SwanBotRoutingInfo['routing_fallback'];
    }
  }
  return {
    turn: { stop_reason: stop, content: blocks, ...(usage ? { usage } : {}) },
    routing,
  };
}

// ─── Result mapping (AgentRunResult → legacy loop result) ───────────────────

/** True when the runtime should make the legacy one-shot finalization call
 *  (cap hit on a pure tool_use round → no trailing text). */
export function needsCapExhaustionFinalization(runResult: AgentRunResult): boolean {
  return runResult.hitMaxIterations && !runResult.text;
}

/**
 * The explicit "no more tools — wrap up now" steer appended as a trailing
 * user-role turn on the cap-exhaustion finalization call. Byte-identical to
 * the legacy chat loop's finalization note (swanbot.ts `executeToolUseLoop`)
 * so both surfaces produce the same clean final message.
 */
export const CAP_EXHAUSTION_FINALIZATION_NOTE =
  'Tool budget for this turn is exhausted. Do NOT call any more tools — reply now with your best final answer summarizing what the results above established, and name anything that remains unfinished.';

/**
 * Builds the `swanbot-ai` invoke body for the cap-exhaustion finalization
 * call in true P62 shape. The cap was hit on a pure tool_use round: the final
 * round's tool_results were pushed to history but no turn ever consumed them,
 * so the model never produced a final message.
 *
 * Two wire constraints (both broken by the old `tools: []` body — see
 * swanbot.ts:4212-4221) shape this call:
 *   1. The swanbot-ai relay only engages on a NON-EMPTY `tools` array — an
 *      empty one falls through to a different (tool-less) leg. After P64/A2
 *      an empty array is fail-visible rather than silently mis-routed, but it
 *      still can't produce the intended clean wrap-up, and any native tool-
 *      search reference in the history has no tools to resolve against.
 *   2. So we send the turn's REAL tool defs (the exact defs advertised in the
 *      loop) and steer to a text answer with an explicit final instruction
 *      appended as a trailing same-role user turn (legal — it merges after the
 *      tool_results). If the model still emits tool_use there is no text to
 *      extract and the caller falls back to the limit note (same fail-safe as
 *      before).
 *
 * `tools` must be the turn's real (non-empty) Anthropic tool shapes; callers
 * already guarantee a non-empty advertised set before the loop runs, and
 * `needsCapExhaustionFinalization` gates this call, so an empty `tools` here
 * would be a caller bug. `system_override` carries the caller's frozen system
 * prompt (cache-hot). Everything preserved from the legacy body: `message`
 * (original user prompt), full `tool_messages` history, `model`, ids.
 */
export function buildCapExhaustionFinalizationBody(args: {
  userMessage: string;
  circleId: string;
  userId: string;
  model: string;
  systemPrompt: string;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown>; input_examples?: Array<Record<string, unknown>> }>;
  messages: AgentMessage[];
} & SwanbotRelaySubjectFields): Record<string, unknown> {
  return {
    message: args.userMessage,
    circleId: args.circleId,
    userId: args.userId,
    model: args.model,
    tools: args.tools,
    tool_messages: [
      ...args.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: CAP_EXHAUSTION_FINALIZATION_NOTE },
    ],
    system_override: args.systemPrompt,
    ...buildRelaySubjectPayload(args),
  };
}

/**
 * Maps the typed-core result onto the legacy `executeToolUseLoop` return
 * contract the session runtime consumes:
 *   - clean finish → `{ response, toolEvents, routing }`
 *   - edge transport failure (legacy: `error || !data`) → `incomplete: true`,
 *     NO checkpoint (legacy parity)
 *   - hitMaxIterations → legacy limit note + progress summary + resumable
 *     checkpoint (`buildToolLoopCheckpoint`, same shape `toolLoopResume`
 *     reads back out of the transcript)
 */
export function buildLegacyToolLoopResult(args: {
  runResult: AgentRunResult;
  toolEvents: LegacyToolEvent[];
  routing?: SwanBotRoutingInfo;
  maxRounds: number;
  edgeFailed?: boolean;
  /** Result of the runtime's no-tools finalization call, when it ran. */
  finalizationText?: string | null;
  usage?: LegacyToolLoopResult['usage'];
  /** Proof-of-work receipt from the runtime's verification-receipt pass. */
  verificationReceipt?: VerificationReceipt | null;
}): LegacyToolLoopResult {
  const base = {
    toolEvents: args.toolEvents,
    ...(args.routing ? { routing: args.routing } : {}),
    ...(args.usage ? { usage: args.usage } : {}),
  };
  // On non-clean terminals (edge failure, user abort, cap exhaustion) a
  // '✓ Verified' verdict would render a success headline above an error/stop
  // body — downgrade it to 'unverified' (summary regenerated) so partial work
  // never reads as a clean success. 'failed'/'unverified' verdicts are already
  // honest and pass through unchanged. The agent_run_events audit insert
  // already recorded the raw receipt before this mapping runs.
  const incompleteReceipt = (): { verificationReceipt: VerificationReceipt } | Record<string, never> => {
    const receipt = args.verificationReceipt;
    if (!receipt) return {};
    if (receipt.verdict !== 'verified') return { verificationReceipt: receipt };
    const downgraded: VerificationReceipt = { ...receipt, verdict: 'unverified', summary: '' };
    downgraded.summary = formatVerificationReceipt(downgraded);
    return { verificationReceipt: downgraded };
  };
  if (args.edgeFailed) {
    return {
      response: args.runResult.text || TOOL_LOOP_EDGE_FAILURE_TEXT,
      ...base,
      ...incompleteReceipt(),
      incomplete: true,
    };
  }
  // STOP button: a user-cancelled run must read as user-stopped/incomplete —
  // NOT a clean completion (hitMaxIterations is false on an abort) and NOT
  // cap-exhaustion. Return the partial work + a resumable checkpoint so
  // "continue" picks up from here.
  if (args.runResult.aborted) {
    const progress = summarizeToolLoopProgress(args.toolEvents);
    const stopNote = 'Stopped at your request — the work so far is saved. Tell me to continue to pick up from here.';
    return {
      response: [args.runResult.text || '', stopNote, progress].filter(Boolean).join('\n\n'),
      ...base,
      ...incompleteReceipt(),
      incomplete: true,
      checkpoint: buildToolLoopCheckpoint(args.toolEvents, { maxRounds: args.maxRounds }),
    };
  }
  if (!args.runResult.hitMaxIterations) {
    return {
      response: args.runResult.text,
      ...base,
      ...(args.verificationReceipt ? { verificationReceipt: args.verificationReceipt } : {}),
    };
  }
  const finalText = args.runResult.text || args.finalizationText || '';
  const limitNote = `I reached my tool-step limit for this turn (${args.maxRounds} steps) before finishing. Tell me to continue and I'll pick up where I left off.`;
  const progress = summarizeToolLoopProgress(args.toolEvents);
  return {
    response: [finalText || limitNote, progress].filter(Boolean).join('\n\n'),
    ...base,
    ...incompleteReceipt(),
    incomplete: true,
    checkpoint: buildToolLoopCheckpoint(args.toolEvents, { maxRounds: args.maxRounds }),
  };
}
