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
import { buildChatAutomationPlanPreview } from './chatAutomationPlanPreview';
import {
  buildChatAgentContextPack,
  type ChatAgentContextPack,
} from './chatAgentContextPack';
import { buildComputerAppToolArgsFingerprintAsync } from './computerAppGrounding';
import {
  buildComputerSequenceProgramManifest,
  compileComputerSequenceProgram,
} from './computerSequenceProgramCore';
import type { AutoApproveCategory } from './chatAutoApproveSettings';
import {
  issueChatPlanApprovalAuthorityObject,
  isIssuedChatPlanApprovalAuthorityObject,
  type ChatPlanApprovalAuthorityCore,
} from './chatPlanApprovalAuthorityCore';

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

export type ChatPlanApprovalAuthority = ChatPlanApprovalAuthorityCore<
  ChatAutomationExecutionKind,
  AutoApproveCategory
>;

export type ApprovalGatePassAuthority = Readonly<
  | {
      schemaVersion: 1;
      kind: 'claimed_approval_row';
      approvalId: string;
      approvalIntentFingerprint: string;
    }
  | {
      schemaVersion: 1;
      kind: 'policy_auto_waiver';
      approvalIntentFingerprint: string;
      policyCategory: AutoApproveCategory;
    }
>;

const CHAT_REQUEST_IDENTITY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const CHAT_APPROVAL_FINGERPRINT_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const CHAT_AUTO_APPROVE_CATEGORIES = new Set<AutoApproveCategory>([
  'memory_read',
  'memory_write',
  'skill_run',
  'skill_write',
  'automation_create',
  'automation_run',
  'browser_click',
  'external_publish',
  'desktop_action',
]);

export function normalizeChatRequestIdentity(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) return null;
  return value.trim() === value && CHAT_REQUEST_IDENTITY_RE.test(value) ? value : null;
}

/**
 * Privacy-safe stable identity for one submitted Chat request. The raw local
 * or database message id remains in memory; only this scope-bound digest may
 * enter approval/run/action metadata.
 */
export async function buildChatRequestIdentityFingerprint(input: {
  circleId: string;
  userId: string;
  threadId?: string | null;
  requestIdentity: unknown;
}): Promise<string> {
  const requestIdentity = normalizeChatRequestIdentity(input.requestIdentity);
  if (!requestIdentity) return '';
  return buildComputerAppToolArgsFingerprintAsync({
    schemaVersion: 1,
    scope: 'chat_request',
    circleId: input.circleId,
    userId: input.userId,
    threadId: input.threadId ?? null,
    requestIdentity,
  });
}

/** Complete normalized plan + exact compiler manifest binding used by both
 * the durable approval row and the in-memory dispatch capability. */
export async function buildChatPlanApprovalIntentFingerprint(
  plan: ChatAutomationPlan,
  ctx: ChatTransportContext,
): Promise<string> {
  const exactProgram = compileComputerSequenceProgram(plan.execution.commandText || '');
  const requestIdentityFingerprint = ctx.requestIdentity
    ? await buildChatRequestIdentityFingerprint({
        circleId: ctx.circleId,
        userId: ctx.userId,
        threadId: ctx.threadId,
        requestIdentity: ctx.requestIdentity,
      })
    : null;
  return buildComputerAppToolArgsFingerprintAsync({
    schemaVersion: 3,
    circleId: ctx.circleId,
    userId: ctx.userId,
    threadId: ctx.threadId ?? null,
    roomId: ctx.roomId ?? null,
    requestIdentityFingerprint,
    source: plan.source,
    intent: plan.intent,
    execution: plan.execution,
    approval: plan.approval,
    risk: plan.risk,
    confidence: plan.confidence,
    notes: plan.notes,
    exactProgramManifest: exactProgram
      ? buildComputerSequenceProgramManifest(exactProgram)
      : null,
  });
}

async function issueChatPlanApprovalAuthority(
  plan: ChatAutomationPlan,
  ctx: ChatTransportContext,
  gateAuthority: ApprovalGatePassAuthority,
): Promise<ChatPlanApprovalAuthority | null> {
  if (
    !gateAuthority
    || gateAuthority.schemaVersion !== 1
    || !['claimed_approval_row', 'policy_auto_waiver'].includes(gateAuthority.kind)
    || !CHAT_APPROVAL_FINGERPRINT_RE.test(gateAuthority.approvalIntentFingerprint)
    || (gateAuthority.kind === 'claimed_approval_row'
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gateAuthority.approvalId))
    || (gateAuthority.kind === 'policy_auto_waiver'
      && !CHAT_AUTO_APPROVE_CATEGORIES.has(gateAuthority.policyCategory))
  ) return null;
  const approvalIntentFingerprint = await buildChatPlanApprovalIntentFingerprint(plan, ctx);
  if (
    !CHAT_APPROVAL_FINGERPRINT_RE.test(approvalIntentFingerprint)
    || gateAuthority.approvalIntentFingerprint !== approvalIntentFingerprint
  ) return null;
  const requestIdentityFingerprint = await buildChatRequestIdentityFingerprint({
    circleId: ctx.circleId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    requestIdentity: ctx.requestIdentity,
  });
  const program = compileComputerSequenceProgram(plan.execution.commandText || '');
  if (
    !CHAT_APPROVAL_FINGERPRINT_RE.test(requestIdentityFingerprint)
    || !program
    || program.authorization.mode !== 'chat_plan_approval'
  ) return null;
  const programFingerprint = await buildComputerAppToolArgsFingerprintAsync(
    buildComputerSequenceProgramManifest(program),
  );
  if (!CHAT_APPROVAL_FINGERPRINT_RE.test(programFingerprint)) return null;
  return issueChatPlanApprovalAuthorityObject<ChatAutomationExecutionKind, AutoApproveCategory>({
    schemaVersion: 2,
    kind: 'chat_plan_approval',
    authorizationSource: gateAuthority.kind,
    approvalId: gateAuthority.kind === 'claimed_approval_row'
      ? gateAuthority.approvalId
      : null,
    approvalIntentFingerprint,
    requestIdentityFingerprint,
    programId: program.id,
    programFingerprint,
    circleId: ctx.circleId,
    userId: ctx.userId,
    threadId: ctx.threadId || null,
    executionKind: plan.execution.kind,
    routeId: plan.execution.routeId || null,
    policyCategory: gateAuthority.kind === 'policy_auto_waiver'
      ? gateAuthority.policyCategory
      : null,
  });
}

/** Runtime-only object-capability check. Plain objects and stale serialized
 * metadata cannot be upgraded into dispatch authority. */
export function isIssuedChatPlanApprovalAuthority(
  value: unknown,
  expected: {
    circleId: string;
    userId: string;
    threadId?: string | null;
    executionKind: ChatAutomationExecutionKind;
    approvalIntentFingerprint: string;
    requestIdentityFingerprint: string;
    programId: string;
    programFingerprint: string;
  },
): value is ChatPlanApprovalAuthority {
  return isIssuedChatPlanApprovalAuthorityObject<ChatAutomationExecutionKind, AutoApproveCategory>(
    value,
    expected,
  );
}

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

/**
 * R9 — one parked clarification for a thread. Mirrors exactly what
 * ChatTab's `pendingClarificationRef` entries hold today (the refs remain
 * the backing store; this is just the typed seam over them) so handlers can
 * park/resume clarifications without reaching into component refs.
 */
export type ChatClarificationResumePending = {
  /** The user's original (underspecified) message. */
  originalMessage: string;
  /** The conversational intent we'd run once the gap is filled. */
  pendingIntent: string | null;
  /** Which fields the planner could not resolve. */
  missingParams: string[];
  /** Epoch ms when the question was asked (freshness window on resume). */
  askedAt: number;
};

/**
 * R9 — clarification park/resume store handed to handlers through the
 * dispatch context. `ask_clarification` parks via `setPending`; the resume
 * path reads `pending` and `clearPending`s once consumed. Scoped by the
 * caller to the active thread (the ctx carries one thread's store, not the
 * whole map). Added so the upcoming `create_task` cutover — which also
 * produces clarifications — can park/resume through the same seam instead
 * of needing its own ref plumbing.
 */
export type ChatClarificationResumeStore = {
  pending?: ChatClarificationResumePending | null;
  setPending: (pending: ChatClarificationResumePending) => void;
  clearPending: () => void;
};

/** Opaque per-dispatch context. Callers populate what they have. */
export type ChatTransportContext = {
  circleId: string;
  userId: string;
  /** Stable identity of the submitted user message. Exact mutation programs
   * fail closed without it; callers must preserve it across approval resume. */
  requestIdentity?: string;
  /** Chat thread id if relevant. */
  threadId?: string;
  /** Room id when dispatching from RoomsTab. */
  roomId?: string;
  /** Currently selected model. Transports can override via plan params. */
  model?: string | null;
  /** Cancellation signal; transports should respect it. */
  signal?: AbortSignal;
  /**
   * Exact plan-level authority returned by the approval gate before handler
   * dispatch. This is intentionally distinct from generic per-tool approval:
   * only compiler-owned programs whose complete calls are already sealed may
   * consume it.
   */
  planApprovalAuthority?: ChatPlanApprovalAuthority;
  /** Active chat mode — Plan refuses destructive dispatches, Act runs
   *  everything subject to the HITL gate. Defaults to `'act'` when the
   *  caller does not specify. */
  chatMode?: ChatMode;
  /** R9 — thread-scoped clarification park/resume store (see type docs). */
  clarificationResume?: ChatClarificationResumeStore;
  /**
   * Portable, redacted plan/guardrail/proof handoff. The dispatcher builds
   * this before any approval or transport callback, so connected-agent
   * handlers can consume the same bounded context later attached to outcome.
   */
  agentContextPack?: ChatAgentContextPack;
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
 * Why a plan did not pass the approval gate. A bare `pass: false` lumps
 * together situations the caller must treat differently — waiting on a
 * human is not the same as a hard denial, and a transient lookup failure
 * is the only one worth retrying. The category lets the tool loop / UI
 * decide retry-vs-wait-vs-stop instead of guessing from the message text.
 *
 *   pending        — an existing proposal is awaiting a human decision.
 *   filed          — a NEW proposal was just filed; awaiting a human.
 *   rejected       — a human rejected it; needs a changed request to re-propose.
 *   blocked_policy — circle auto-approve policy is set to `never` for this category.
 *   error          — fail-closed: the gate could not verify/file (transient).
 */
export type ApprovalDeferralCategory =
  | 'pending'
  | 'filed'
  | 'rejected'
  | 'blocked_policy'
  | 'error';

/** True only for `error` — the sole category where re-running the same
 *  plan unchanged could succeed (the others are waiting on a human or a
 *  hard denial). Exported so callers branch on one source of truth. */
export function isApprovalDeferralRetryable(category: ApprovalDeferralCategory): boolean {
  return category === 'error';
}

/**
 * When a plan carries `approval.required = true`, dispatch consults this
 * callback to either: (a) file a pre-approval and return `deferred`, or
 * (b) confirm that an approval already exists and pass through. This
 * keeps the approval policy single-sourced in the caller (typically via
 * `hitlService`) while the dispatch envelope stays uniform.
 *
 * `deferred.category` + `deferred.retryable` are optional for backward
 * compatibility (older inline gates omit them); when present, the
 * dispatcher surfaces them on the outcome so the loop can branch.
 */
export type ApprovalGate = (
  plan: ChatAutomationPlan,
  ctx: ChatTransportContext,
) => Promise<
  | {
      pass: true;
      /**
       * User-facing note about WHY the gate passed when that isn't obvious —
       * today: "an earlier approval covered this". Silent reuse of a prior
       * approval surprised users (idempotency-key dedupe matches similar
       * requests), so the gate says so and the dispatcher surfaces it on the
       * outcome (`data.approvalNotice`).
       */
      notice?: string;
      /** The pre-existing approval row that covered this pass, when any. */
      approvalId?: string;
      /** Explicit exact authority source. Ordinary no-approval passes omit it
       * and therefore cannot authorize compiler-owned approval programs. */
      authority?: ApprovalGatePassAuthority;
    }
  | {
      pass: false;
      deferred: {
        approvalId: string;
        message: string;
        category?: ApprovalDeferralCategory;
        retryable?: boolean;
        /**
         * Epoch ms when the pending/filed proposal auto-expires, when known.
         * Lets the UI show a countdown and announce expiry instead of the
         * card silently dying (surfaced as `data.approvalExpiresAt`).
         */
        expiresAt?: number | null;
      };
    }
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

function attachPlanPreview(
  plan: ChatAutomationPlan,
  outcome: ChatAutomationOutcome,
  ctx: ChatTransportContext,
): ChatAutomationOutcome {
  return {
    ...outcome,
    data: {
      ...(outcome.data || {}),
      chatAutomationPlanPreview: buildChatAutomationPlanPreview(plan),
      chatAgentContextPack: ctx.agentContextPack || buildChatAgentContextPack(plan, {
          circleId: ctx.circleId,
          userId: ctx.userId,
          threadId: ctx.threadId,
          model: ctx.model,
          chatMode: ctx.chatMode,
        }),
    },
  };
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

export async function dispatchChatAutomationPlan(
  plan: ChatAutomationPlan,
  opts: DispatchOptions,
): Promise<ChatAutomationOutcome> {
  const started = Date.now();
  const ctx: ChatTransportContext = {
    ...opts.ctx,
    agentContextPack: buildChatAgentContextPack(plan, {
      circleId: opts.ctx.circleId,
      userId: opts.ctx.userId,
      threadId: opts.ctx.threadId,
      model: opts.ctx.model,
      chatMode: opts.ctx.chatMode,
    }),
  };

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
    const finalOutcome = attachPlanPreview(plan, outcome, ctx);
    try { await opts.onOutcome?.(plan, finalOutcome, ctx); } catch {}
    return finalOutcome;
  }

  // Approval gate first. The gate may enforce category policy even when
  // `plan.approval.required` is false (for example, a circle can set a
  // normally-safe category to "never"). If the gate defers, we short-circuit
  // and no transport runs.
  let gateNotice: string | undefined;
  let gateApprovalId: string | undefined;
  let gatePassAuthority: ApprovalGatePassAuthority | undefined;
  if (opts.approvalGate) {
    const gate = await opts.approvalGate(plan, ctx);
    if (!gate.pass) {
      // Resolve retryable: explicit flag wins; otherwise derive from the
      // category; default false (waiting on a human / hard denial).
      const category = gate.deferred.category;
      const retryable = gate.deferred.retryable
        ?? (category ? isApprovalDeferralRetryable(category) : false);
      const expiresAt = gate.deferred.expiresAt ?? null;
      const data: Record<string, unknown> = {};
      if (category) {
        data.approvalCategory = category;
        data.approvalRetryable = retryable;
      }
      if (expiresAt !== null) data.approvalExpiresAt = expiresAt;
      const outcome: ChatAutomationOutcome = {
        executionKind: 'deferred',
        status: 'deferred',
        message: gate.deferred.message,
        approvalId: gate.deferred.approvalId,
        durationMs: Date.now() - started,
        ...(Object.keys(data).length > 0 ? { data } : {}),
      };
      const finalOutcome = attachPlanPreview(plan, outcome, ctx);
      try { await opts.onOutcome?.(plan, finalOutcome, ctx); } catch {}
      return finalOutcome;
    }
    gateNotice = gate.notice;
    gateApprovalId = gate.approvalId;
    gatePassAuthority = gate.authority
      && (
        (gate.authority.kind === 'claimed_approval_row'
          && gate.approvalId === gate.authority.approvalId)
        || (gate.authority.kind === 'policy_auto_waiver'
          && gate.approvalId === undefined)
      )
      ? gate.authority
      : undefined;
  }

  // Carry the gate's pass-through transparency onto whatever outcome the
  // transport produces: the reuse notice tells the user an earlier approval
  // covered this run (instead of silent dedupe), and the approval id keeps
  // the outcome linkable to the covering row.
  const applyGateTransparency = (outcome: ChatAutomationOutcome): ChatAutomationOutcome => {
    if (gateNotice) {
      outcome.data = { ...(outcome.data || {}), approvalNotice: gateNotice };
    }
    if (gateApprovalId && outcome.approvalId === undefined) {
      outcome.approvalId = gateApprovalId;
    }
    return outcome;
  };

  const handler = opts.handlers[plan.execution.kind];
  if (!handler) {
    const outcome: ChatAutomationOutcome = {
      executionKind: 'skipped',
      status: 'skipped',
      message: `No handler registered for execution kind "${plan.execution.kind}". Falling back to caller's legacy path.`,
      durationMs: Date.now() - started,
    };
    const finalOutcome = attachPlanPreview(plan, applyGateTransparency(outcome), ctx);
    try { await opts.onOutcome?.(plan, finalOutcome, ctx); } catch {}
    return finalOutcome;
  }

  // Authority is output-only. Never trust or preserve an object supplied by a
  // caller in `ctx`; only this dispatch invocation may mint one after the gate
  // wins its exact one-shot claim.
  const {
    planApprovalAuthority: _untrustedInboundPlanApprovalAuthority,
    ...callerContext
  } = ctx;
  const planApprovalAuthority = gatePassAuthority
    ? await issueChatPlanApprovalAuthority(plan, callerContext, gatePassAuthority)
    : null;
  const handlerContext: ChatTransportContext = planApprovalAuthority
    ? { ...callerContext, planApprovalAuthority }
    : callerContext;

  let outcome: ChatAutomationOutcome;
  try {
    outcome = await handler(plan, handlerContext);
    if (outcome.durationMs === undefined) outcome.durationMs = Date.now() - started;
  } catch (err) {
    // Transports SHOULD NOT throw — but catch anyway so the dispatcher
    // never tears down the chat render path.
    outcome = {
      executionKind: plan.execution.kind,
      status: 'failed',
      // Treat arbitrary transport exceptions as untrusted: provider errors
      // can contain credentials, paths, request bodies, or typed values.
      // Persist only a bounded classification, never the raw exception.
      message: 'That automation step hit an internal error. No uncertain action was replayed.',
      warnings: ['Transport failed with a redacted internal error.'],
      data: {
        errorCode: 'transport_error',
        redacted: true,
      },
      durationMs: Date.now() - started,
    };
  }

  const finalOutcome = attachPlanPreview(plan, applyGateTransparency(outcome), ctx);
  try { await opts.onOutcome?.(plan, finalOutcome, ctx); } catch {}
  return finalOutcome;
}

// The canonical observer that writes `chatAutomationDecision` into
// `agent_runs.metadata` lives in `./runChatAutomationPlanObserver.ts` —
// split out so the pure dispatcher here stays importable from smoke tests
// without pulling Supabase / React Native into the runtime. Import it
// directly: `import { attachPlanDecisionToRun } from './runChatAutomationPlanObserver'`.
