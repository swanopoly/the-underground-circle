/**
 * chatLaneOutcome — W5 (P39): the unified lane error boundary.
 *
 * The internal map (2026-07-09) found six-to-eight distinct result/error
 * shapes across the chat lanes — `SwanBotStructuredResponse` (no status),
 * `StreamChatResult` (complete/interrupted only), `ChatAutomationOutcome`
 * (6-value status, no recovery options), `AdvancedCommandResult`
 * ({response, success}), `ConversationalIntentResult` ({handled, message}),
 * and the recovery lane's `ChatFailureRecoveryResult` (owns recoveryOptions
 * but no status). No lane matched the plan's target
 * `{status, message, recoveryOptions}`. This module is the ONE shape plus
 * pure normalizers from every legacy shape, so callers (ChatTab catches,
 * persisted metadata, telemetry) can log and render a single envelope.
 *
 * Research grounding (verified 2026-07-09):
 *   - AutoGen's TaskResult: streaming and batch lanes terminate in one typed
 *     shape regardless of how they ended.
 *   - LangGraph's two-layer recovery: classify every failure on two axes —
 *     WHO can recover (model / system / user / none) and whether a retry is
 *     SIDE-EFFECT-SAFE. Recovery options derive from that classification,
 *     not free-form per surface.
 *   - Anthropic postmortem 2025-09 + GPT-5 router outage 2025-08: a lane
 *     that fails silently by degrading reads as global quality collapse —
 *     so the envelope records WHICH lane/model/transport actually served
 *     the turn (`servedBy`), and fallback is a visible field, never silent.
 *
 * House invariants preserved:
 *   - `interrupted` is NOT `failed` — an interrupted stream carries partial
 *     text already on screen; it must never be auto-retried
 *     (swanbotStream's never-retry-after-handshake contract) and never
 *     rendered as a whole answer.
 *   - Fail-closed default: an UNCLASSIFIED error is never marked
 *     side-effect-safe to retry.
 *   - Fail-visible: normalization never strips or rewrites the underlying
 *     error message, and model-visible error feedback (tool_result text in
 *     the loop) is a separate channel this module does not touch.
 *
 * Pure by construction: no I/O, tsx-loadable, bounded, never throws.
 */

import type { ChatAutomationOutcome } from './runChatAutomationPlan';
import type { ChatFailureRecoveryOption } from './chatFailureRecovery';
import type { StreamChatResult } from './swanbotStream';
import type { SwanBotStructuredResponse } from './swanbot';
import type { AdvancedCommandResult } from './advancedChatCommands';
import type { ConversationalIntentResult } from './conversationalRouter';
import {
  mapComputerTaskOutcomeToChatStatus,
  type ComputerTaskOutcomeStatus,
} from './computerTaskOutcome';

// ─── The unified shape ──────────────────────────────────────────────────────

/** Which chat lane produced this outcome. */
export type ChatLaneId =
  | 'stream'
  | 'batch'
  | 'openswan_v2'
  | 'automation_plan'
  | 'command'
  | 'conversational_intent'
  | 'computer_task'
  /** ChatTab's outermost sendMessage boundary — catches anything the
   *  specific lanes above did not shape themselves. */
  | 'send_message';

/** Bounded, archive-safe tag list for a lane terminal — feeds the per-lane
 *  quality signal (one degraded lane must be legible, not read as global
 *  decline). Stable `key:value` strings for session-archive/telemetry tags. */
export function buildChatLaneOutcomeTags(outcome: ChatLaneOutcome): string[] {
  const tags = [`lane:${outcome.lane}`, `lane_status:${outcome.status}`];
  if (outcome.recovery) {
    tags.push(
      `recoverable_by:${outcome.recovery.recoverableBy}`,
      `retry_safe:${outcome.recovery.retrySideEffectSafe ? 'yes' : 'no'}`,
      `failure_reason:${outcome.recovery.reason}`,
    );
  }
  if (outcome.servedBy?.fallback) tags.push('served_by_fallback:yes');
  return tags;
}

/**
 * Superset of ChatAutomationOutcome's status enum plus `interrupted` for the
 * stream lane's mid-stream drop (partial output on screen — distinct from
 * `failed`, which means the lane produced nothing usable).
 */
export type ChatLaneStatus =
  | 'completed'
  | 'interrupted'
  | 'needs_input'
  | 'deferred'
  | 'blocked'
  | 'skipped'
  | 'failed';

/** Who can act on this failure (LangGraph/OpenAI-guardrails two-axis model). */
export type ChatLaneRecoverableBy = 'model' | 'system' | 'user' | 'none';

export interface ChatLaneRecoveryClassification {
  /** Who can recover: model (feed error back into the loop), system (typed
   *  retry/backoff/reroute), user (approval, key, unblock), none (stop+report). */
  recoverableBy: ChatLaneRecoverableBy;
  /** True ONLY when an automatic retry cannot double-execute an external
   *  side effect. Unknown errors are NEVER retry-safe (fail closed). */
  retrySideEffectSafe: boolean;
  /** Short machine-readable reason for the classification. */
  reason: string;
}

/** Which lane/model/transport actually served the turn — the GPT-5-outage
 *  lesson: fallback must be visible, never a silent downgrade. */
export interface ChatLaneServedBy {
  model?: string | null;
  transport?: string | null;
  /** True when the turn landed somewhere other than the user's pick. */
  fallback?: boolean;
  fallbackReason?: string | null;
}

export interface ChatLaneOutcome {
  lane: ChatLaneId;
  status: ChatLaneStatus;
  /** Human-facing message the chat UI renders (or the assistant text on success). */
  message: string;
  /** Structured recovery actions — same shape the recovery lane already renders. */
  recoveryOptions: ChatFailureRecoveryOption[];
  /** Present on non-completed outcomes; drives auto-retry/recovery decisions. */
  recovery?: ChatLaneRecoveryClassification;
  servedBy?: ChatLaneServedBy;
  /** Optional per-lane structured payload (never rendered directly). */
  data?: Record<string, unknown>;
}

// ─── Error classification (fail-closed) ─────────────────────────────────────

const SYSTEM_TRANSIENT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/rate.?limit|429|too many requests/i, 'rate_limited'],
  [/overloaded|529|capacity/i, 'provider_overloaded'],
  // 5xx digits need status-code CONTEXT (the app's real templates are
  // `HTTP ${status}`, `returned ${status}`, `status_${status}`, `error 500`).
  // A standalone number ("under 500 characters", "503 items") must NOT match —
  // misreading it as provider_5xx would mark an unknown error retry-safe,
  // violating the fail-closed contract.
  [/\b(?:https?|status(?:\s+code)?|error|code|returned)[ :=#_/(]*(?:500|502|503|504)\b|internal server error|bad gateway|service unavailable|gateway timeout/i, 'provider_5xx'],
  [/timed? ?out|timeout|deadline/i, 'timeout'],
  [/network|fetch failed|socket|econn|broken pipe|connection/i, 'network'],
];

const USER_ACTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/not authenticated|unauthorized|401|log ?in|session expired/i, 'auth_required'],
  [/api key|missing key|invalid key|no key|credential/i, 'key_required'],
  [/quota|billing|payment required|402|insufficient credit/i, 'billing'],
  [/approval|approve|permission|denied|403/i, 'approval_or_permission'],
];

const NON_RECOVERABLE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // 'refus' alone is too greedy — "connection refused" is a network error.
  [/content.?policy|safety (?:violation|filter)|refused to (?:answer|help|comply|generate)|model refus/i, 'content_policy'],
  // Pinned to the EXACT phrasings the app's gates emit — mcpToolBridge
  // ("POLICY BLOCK: …"), swanbot/openswanToolRuntime ("Always-confirm
  // floor: …"), the sticky "approval floor", agentExecutionCore ("was
  // blocked by a user constraint and did not run"), appAutomationControl-
  // Surfaces ("a user constraint blocks this action"), and swanbot's HARD
  // constraint stop ("The user forbade … actions"). Bare "constraint" and
  // bare "floor" are deliberately NOT matched: ordinary DB errors such as
  // `violates check constraint` / `violates unique constraint` are not
  // policy blocks and must fall through (→ unclassified, not retry-safe).
  [/policy.?block|always.?confirm|approval floor|blocked by a user constraint|user constraint blocks|user forbade/i, 'policy_block'],
];

/**
 * Classify a raw error message on the two recovery axes. Pattern-based and
 * deliberately conservative: anything unrecognized is user-recoverable and
 * NOT side-effect-safe to retry — surfacing beats silent re-execution
 * (fail-closed, fail-visible).
 */
export function classifyChatLaneError(rawMessage: string | null | undefined): ChatLaneRecoveryClassification {
  const message = typeof rawMessage === 'string' ? rawMessage : '';
  for (const [pattern, reason] of NON_RECOVERABLE_PATTERNS) {
    if (pattern.test(message)) return { recoverableBy: 'none', retrySideEffectSafe: false, reason };
  }
  for (const [pattern, reason] of USER_ACTION_PATTERNS) {
    if (pattern.test(message)) return { recoverableBy: 'user', retrySideEffectSafe: false, reason };
  }
  for (const [pattern, reason] of SYSTEM_TRANSIENT_PATTERNS) {
    if (pattern.test(message)) return { recoverableBy: 'system', retrySideEffectSafe: true, reason };
  }
  return { recoverableBy: 'user', retrySideEffectSafe: false, reason: 'unclassified_error' };
}

// ─── Normalizers (one per legacy shape; never throw) ────────────────────────

const MAX_MESSAGE_CHARS = 4000;

function clipMessage(message: unknown, fallback: string): string {
  const text = typeof message === 'string' && message.trim() ? message : fallback;
  return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) : text;
}

/** `ChatAutomationOutcome` — the closest legacy shape; near-identity mapping. */
export function normalizeAutomationOutcome(outcome: ChatAutomationOutcome): ChatLaneOutcome {
  const failed = outcome.status === 'failed' || outcome.status === 'blocked';
  return {
    lane: 'automation_plan',
    status: outcome.status,
    message: clipMessage(outcome.message, '(no message)'),
    recoveryOptions: [],
    ...(failed ? { recovery: classifyChatLaneError(outcome.message) } : {}),
    data: {
      executionKind: outcome.executionKind,
      ...(outcome.runId ? { runId: outcome.runId } : {}),
      ...(outcome.approvalId ? { approvalId: outcome.approvalId } : {}),
      ...(outcome.warnings?.length ? { warnings: outcome.warnings } : {}),
    },
  };
}

export interface ComputerTaskLaneOutcomeInput {
  /** Authoritative typed task terminal. Never infer this value from prose. */
  status: ComputerTaskOutcomeStatus;
  message?: string | null;
  recoveryOptions?: ChatFailureRecoveryOption[] | null;
  servedBy?: ChatLaneServedBy;
  /** Extra bounded caller metadata. `computerTaskStatus` cannot be overridden. */
  data?: Record<string, unknown>;
}

const COMPUTER_TASK_RECOVERY_BY_STATUS: Record<
  Exclude<ComputerTaskOutcomeStatus, 'completed'>,
  ChatLaneRecoveryClassification
> = {
  partial: {
    recoverableBy: 'user',
    retrySideEffectSafe: false,
    reason: 'computer_task_partial',
  },
  blocked: {
    recoverableBy: 'user',
    retrySideEffectSafe: false,
    reason: 'computer_task_blocked',
  },
  needs_input: {
    recoverableBy: 'user',
    retrySideEffectSafe: false,
    reason: 'computer_task_needs_input',
  },
  waiting_approval: {
    recoverableBy: 'user',
    retrySideEffectSafe: false,
    reason: 'computer_task_waiting_approval',
  },
  failed: {
    recoverableBy: 'user',
    retrySideEffectSafe: false,
    reason: 'computer_task_failed',
  },
  cancelled: {
    recoverableBy: 'user',
    retrySideEffectSafe: false,
    reason: 'computer_task_cancelled',
  },
};

/**
 * Adapt the richer computer-task terminal contract to the unified chat-lane
 * envelope. The typed status is the only source of lane truth: message text is
 * presentation-only and can never turn approval, input, partial, or cancelled
 * outcomes into hard failures. The original status is always retained because
 * the chat-lane status union is intentionally coarser.
 */
export function normalizeComputerTaskLaneOutcome(
  input: ComputerTaskLaneOutcomeInput,
): ChatLaneOutcome {
  const completed = input.status === 'completed';
  const recovery = input.status === 'completed'
    ? undefined
    : COMPUTER_TASK_RECOVERY_BY_STATUS[input.status];
  return {
    lane: 'computer_task',
    status: mapComputerTaskOutcomeToChatStatus(input.status),
    message: clipMessage(input.message, completed ? '(done)' : '(computer task did not complete)'),
    recoveryOptions: input.recoveryOptions?.slice(0, 8) || [],
    ...(recovery ? { recovery } : {}),
    ...(input.servedBy ? { servedBy: { ...input.servedBy } } : {}),
    data: {
      ...(input.data || {}),
      computerTaskStatus: input.status,
    },
  };
}

/** `AdvancedCommandResult` — `{response, success}`. */
export function normalizeCommandResult(result: AdvancedCommandResult): ChatLaneOutcome {
  return {
    lane: 'command',
    status: result.success ? 'completed' : 'failed',
    message: clipMessage(result.response, result.success ? '(done)' : '(command failed)'),
    recoveryOptions: [],
    ...(result.success ? {} : { recovery: classifyChatLaneError(result.response) }),
  };
}

/** `ConversationalIntentResult` — `{handled, message} | null`. A null/unhandled
 *  result means the lane declined the message (fall through), not a failure. */
export function normalizeConversationalIntentResult(result: ConversationalIntentResult): ChatLaneOutcome {
  if (!result || !result.handled) {
    return {
      lane: 'conversational_intent',
      status: 'skipped',
      message: '',
      recoveryOptions: [],
    };
  }
  return {
    lane: 'conversational_intent',
    status: 'completed',
    message: clipMessage(result.message, '(done)'),
    recoveryOptions: [],
  };
}

/**
 * The stream lane. Three legacy terminals:
 *   - pre-handshake failure (`onError(message)` with NO result) — nothing was
 *     delivered; a normal retry lane → `failed`, system-recoverable,
 *     retry-SAFE (no partial output exists).
 *   - mid-stream interruption (`onError(message, result)` with
 *     `status:'interrupted'`) — partial text is on screen → `interrupted`,
 *     NEVER `failed`, NEVER retry-safe (the never-retry-after-handshake
 *     invariant).
 *   - clean completion → `completed`.
 */
export function normalizeStreamResult(input: {
  result?: StreamChatResult | null;
  errorMessage?: string | null;
  /** Accumulated assistant text (partial on interruption). */
  text?: string;
  model?: string | null;
}): ChatLaneOutcome {
  const { result, errorMessage } = input;
  const servedBy: ChatLaneServedBy = { model: input.model ?? null, transport: 'chat-stream' };
  if (!result) {
    // Pre-handshake failure: clean failure, standard retry layer.
    const classification = classifyChatLaneError(errorMessage);
    return {
      lane: 'stream',
      status: 'failed',
      message: clipMessage(errorMessage, 'Stream failed before any output.'),
      recoveryOptions: [],
      recovery: classification.reason === 'unclassified_error'
        ? { recoverableBy: 'system', retrySideEffectSafe: true, reason: 'pre_handshake_failure' }
        : classification,
      servedBy,
    };
  }
  if (result.status === 'interrupted') {
    return {
      lane: 'stream',
      status: 'interrupted',
      message: clipMessage(errorMessage, `Stream interrupted (${result.interruptReason || 'unknown'}).`),
      recoveryOptions: [],
      // Partial output already rendered — an automatic re-send could show the
      // answer twice / double side effects downstream. Explicit fallback only.
      recovery: {
        recoverableBy: 'user',
        retrySideEffectSafe: false,
        reason: `stream_${result.interruptReason || 'interrupted'}`,
      },
      servedBy,
      data: { stopReason: result.stopReason, toolUseCount: result.toolUses.length, incomplete: true },
    };
  }
  return {
    lane: 'stream',
    status: 'completed',
    message: clipMessage(input.text, ''),
    recoveryOptions: [],
    servedBy,
    data: { stopReason: result.stopReason, toolUseCount: result.toolUses.length },
  };
}

/** `SwanBotStructuredResponse` — the batch lane's success envelope. Routing
 *  fallback becomes a VISIBLE servedBy.fallback, never a silent downgrade. */
export function normalizeStructuredResponse(
  response: SwanBotStructuredResponse,
  opts?: { lane?: Extract<ChatLaneId, 'batch' | 'openswan_v2'> },
): ChatLaneOutcome {
  const fallback = response.routing?.routing_fallback;
  return {
    lane: opts?.lane || 'batch',
    status: 'completed',
    message: clipMessage(response.response, ''),
    recoveryOptions: [],
    servedBy: {
      model: response.routing?.provider_model || response.usage?.model || null,
      transport: response.routing?.provider_routed || 'swanbot',
      ...(fallback
        ? { fallback: true, fallbackReason: `${fallback.provider}: ${fallback.reason}` }
        : {}),
    },
    data: {
      ...(response.tool_actions?.length ? { toolActionCount: response.tool_actions.length } : {}),
      ...(response.artifacts?.length ? { artifactCount: response.artifacts.length } : {}),
    },
  };
}

/** A thrown error from any lane. */
export function normalizeThrownError(lane: ChatLaneId, error: unknown): ChatLaneOutcome {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : 'Unknown error';
  return {
    lane,
    status: 'failed',
    message: clipMessage(message, 'Unknown error'),
    recoveryOptions: [],
    recovery: classifyChatLaneError(message),
  };
}

// ─── Recovery-option attachment ─────────────────────────────────────────────

/**
 * Attach the recovery lane's structured options to an outcome (the recovery
 * flow — `startChatFailureRecovery` — stays the owner of option CONTENT;
 * this only carries them in the envelope). Non-mutating.
 */
export function withRecoveryOptions(
  outcome: ChatLaneOutcome,
  options: ChatFailureRecoveryOption[] | null | undefined,
): ChatLaneOutcome {
  if (!options || options.length === 0) return outcome;
  return { ...outcome, recoveryOptions: options.slice(0, 8) };
}

/**
 * Compact, bounded telemetry shape for persisted metadata rows (house rule:
 * keep payloads bounded). Drops the free-text message; keeps the signals the
 * flywheel needs (lane, status, who-served, recovery classification).
 */
export function summarizeChatLaneOutcomeForTelemetry(outcome: ChatLaneOutcome): {
  lane: ChatLaneId;
  status: ChatLaneStatus;
  recoverableBy?: ChatLaneRecoverableBy;
  retrySideEffectSafe?: boolean;
  reason?: string;
  model?: string | null;
  transport?: string | null;
  fallback?: boolean;
  recoveryOptionCount: number;
} {
  return {
    lane: outcome.lane,
    status: outcome.status,
    ...(outcome.recovery
      ? {
          recoverableBy: outcome.recovery.recoverableBy,
          retrySideEffectSafe: outcome.recovery.retrySideEffectSafe,
          reason: outcome.recovery.reason,
        }
      : {}),
    ...(outcome.servedBy
      ? {
          model: outcome.servedBy.model ?? null,
          transport: outcome.servedBy.transport ?? null,
          ...(outcome.servedBy.fallback ? { fallback: true } : {}),
        }
      : {}),
    recoveryOptionCount: outcome.recoveryOptions.length,
  };
}
