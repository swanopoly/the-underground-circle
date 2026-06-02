/**
 * runChatAutomationPlan — Phase CA-3 of `docs/CHAT_AUTOMATION_AUDIT_PLAN`.
 *
 * The shared **executor contract** that sits between `buildChatAutomationPlan`
 * (which classifies intent) and the app-specific transports (chat-stream,
 * browser plan, OpenSwan runtime, command handlers, etc.).
 *
 *   build plan ── dispatch() ──> transport ──> normalized outcome
 *
 * Today's ChatTab has six sequential routers, each returning a different
 * shape. This contract gives every transport ONE outcome envelope so the
 * run metadata, approval gate, and observability layers only need to
 * understand one thing. The actual transports stay in their current
 * files; this module is the dispatcher.
 *
 * Keep this file transport-agnostic. It imports types + the planner, and
 * exposes a `dispatchChatAutomationPlan` that the caller wires to
 * transport handlers. No direct calls to `agentExecutionCore`,
 * `swanbot.ts`, or `chat-stream`.
 */

import type {
  ChatAutomationPlan,
  ChatAutomationExecutionKind,
  ChatMode,
} from './chatAutomationPlanner';
import { isPlanSafeForPlanMode, describePlanModeRefusal } from './chatAutomationPlanner';

/**
 * Outcome each transport reports back. Normalised so the caller can log
 * one shape and render one UI envelope regardless of which path ran.
 */
export type ChatAutomationOutcome = {
  /** Which transport ran (matches plan.execution.kind on success). */
  executionKind: ChatAutomationExecutionKind | 'skipped' | 'deferred' | 'needs_input';
  /**
   * Coarse-grained status. `deferred` = HITL required, nothing ran yet.
   * `needs_input` = the request was underspecified; a clarifying question was
   * surfaced and nothing ran (the caller should wait for the user's reply).
   */
  status: 'completed' | 'failed' | 'blocked' | 'deferred' | 'skipped' | 'needs_input';
  /** Human-facing message the chat UI renders. */
  message: string;
  /** Optional structured payload — per-transport shape, documented there. */
  data?: Record<string, unknown>;
  /** Non-fatal warnings surfaced to the UI (e.g. "tool not available"). */
  warnings?: string[];
  /** Wall-clock duration of the transport, ms. Populated by dispatch. */
  durationMs?: number;
  /** `agent_runs.id` if the transport created one. */
  runId?: string | null;
  /** `agent_approvals.id` if the plan was gated behind HITL. */
  approvalId?: string | null;
};

/**
 * Transport handler signature. One per `ChatAutomationExecutionKind`. All
 * transports take the same inputs (plan + context) and return the same
 * outcome shape. Transports own their own error handling and should
 * NEVER throw across this boundary — return `status: 'failed'` instead.
 */
export type ChatTransportHandler = (
  plan: ChatAutomationPlan,
  ctx: ChatTransportContext,
) => Promise<ChatAutomationOutcome>;

/** Opaque per-dispatch context. Callers populate what they have. */
export type ChatTransportContext = {
  circleId: string;
  userId: string;
  /** Chat thread id if relevant. */
  threadId?: string;
  /** Room id when dispatching from RoomsTab. */
  roomId?: string;
  /** Currently selected model. Transports can override via plan params. */
  model?: string | null;
  /** Cancellation signal; transports should respect it. */
  signal?: AbortSignal;
  /** Active chat mode — Plan refuses destructive dispatches, Act runs
   *  everything subject to the HITL gate. Defaults to `'act'` when the
   *  caller does not specify. */
  chatMode?: ChatMode;
  /** Caller supplies app-specific extras (nav functions, state setters). */
  extras?: Record<string, unknown>;
};

/**
 * The map of handlers. Callers provide one per kind; `dispatchChatAutomationPlan`
 * picks by `plan.execution.kind`. Missing handlers yield `status: 'skipped'`
 * with a clear message rather than an error — that way a partially-migrated
 * ChatTab can still run legacy flows for kinds it hasn't yet connected.
 */
export type ChatTransportHandlers = Partial<
  Record<ChatAutomationExecutionKind, ChatTransportHandler>
>;

/**
 * When a plan carries `approval.required = true`, dispatch consults this
 * callback to either: (a) file a pre-approval and return `deferred`, or
 * (b) confirm that an approval already exists and pass through. This
 * keeps the approval policy single-sourced in the caller (typically via
 * `hitlService`) while the dispatch envelope stays uniform.
 */
export type ApprovalGate = (
  plan: ChatAutomationPlan,
  ctx: ChatTransportContext,
) => Promise<
  | { pass: true }
  | { pass: false; deferred: { approvalId: string; message: string } }
>;

/**
 * Observability hook. Called once per dispatch with the final outcome.
 * Wire this to `agent_run_events` or whatever dashboard you use. Never
 * blocks the return — caller decides whether to await.
 */
export type ChatAutomationObserver = (
  plan: ChatAutomationPlan,
  outcome: ChatAutomationOutcome,
  ctx: ChatTransportContext,
) => void | Promise<void>;

export type DispatchOptions = {
  handlers: ChatTransportHandlers;
  ctx: ChatTransportContext;
  approvalGate?: ApprovalGate;
  onOutcome?: ChatAutomationObserver;
};

// ─── Dispatch ───────────────────────────────────────────────────────────────

export async function dispatchChatAutomationPlan(
  plan: ChatAutomationPlan,
  opts: DispatchOptions,
): Promise<ChatAutomationOutcome> {
  const started = Date.now();
  const ctx = opts.ctx;

  // Plan vs Act mode gate — refuses destructive dispatches up-front,
  // BEFORE the HITL approval gate so plan-mode never even files a
  // proposal. Read-only kinds pass through regardless of mode.
  if (ctx.chatMode === 'plan' && !isPlanSafeForPlanMode(plan)) {
    const outcome: ChatAutomationOutcome = {
      executionKind: 'skipped',
      status: 'skipped',
      message: describePlanModeRefusal(plan),
      data: { planModeRefusal: true, executionKind: plan.execution.kind, risk: plan.risk },
      durationMs: Date.now() - started,
    };
    try { await opts.onOutcome?.(plan, outcome, ctx); } catch {}
    return outcome;
  }

  // Approval gate first. If the plan requires approval and the gate
  // defers, we short-circuit — no transport runs.
  if (plan.approval.required && opts.approvalGate) {
    const gate = await opts.approvalGate(plan, ctx);
    if (!gate.pass) {
      const outcome: ChatAutomationOutcome = {
        executionKind: 'deferred',
        status: 'deferred',
        message: gate.deferred.message,
        approvalId: gate.deferred.approvalId,
        durationMs: Date.now() - started,
      };
      try { await opts.onOutcome?.(plan, outcome, ctx); } catch {}
      return outcome;
    }
  }

  const handler = opts.handlers[plan.execution.kind];
  if (!handler) {
    const outcome: ChatAutomationOutcome = {
      executionKind: 'skipped',
      status: 'skipped',
      message: `No handler registered for execution kind "${plan.execution.kind}". Falling back to caller's legacy path.`,
      durationMs: Date.now() - started,
    };
    try { await opts.onOutcome?.(plan, outcome, ctx); } catch {}
    return outcome;
  }

  let outcome: ChatAutomationOutcome;
  try {
    outcome = await handler(plan, ctx);
    if (outcome.durationMs === undefined) outcome.durationMs = Date.now() - started;
  } catch (err) {
    // Transports SHOULD NOT throw — but catch anyway so the dispatcher
    // never tears down the chat render path.
    outcome = {
      executionKind: plan.execution.kind,
      status: 'failed',
      message: `Transport threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - started,
    };
  }

  try { await opts.onOutcome?.(plan, outcome, ctx); } catch {}
  return outcome;
}

// The canonical observer that writes `chatAutomationDecision` into
// `agent_runs.metadata` lives in `./runChatAutomationPlanObserver.ts` —
// split out so the pure dispatcher here stays importable from smoke tests
// without pulling Supabase / React Native into the runtime. Import it
// directly: `import { attachPlanDecisionToRun } from './runChatAutomationPlanObserver'`.
