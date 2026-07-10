/**
 * chatAttentionQueue — single owner for "what is waiting on the user"
 * across the chat surface (Phase 1a of
 * `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * Today, blocked states hide in four unrelated places: pending
 * `agent_approvals` rows (which expire silently), the thread-scoped
 * clarification resume store, a live computer task's pending question,
 * and recovery options stranded on an old failed message. This module
 * folds them into one ranked, typed list so ChatTab (and later Office's
 * circle-wide "Needs you" queue) render a single strip instead of each
 * caller inventing its own copy.
 *
 * Pure module: `import type` only, no Supabase/React Native, clock is
 * injectable — smoke-testable via tsx (`npm run smoke:chat-attention-queue`).
 * The module decides wording + ranking + urgency; the UI only renders the
 * typed action descriptors. Approval-floor semantics are untouched: this
 * file never approves anything, it only makes waiting visible.
 */

import type { ChatClarificationResumePending } from './runChatAutomationPlan';
import type { PersistedChatRecoveryOption } from './persistedChatMetadata';

// ─── Inputs ─────────────────────────────────────────────────────────────────

/**
 * Structural mirror of the `agent_approvals` fields we need. `AgentApproval`
 * rows from `services/hitlService` satisfy this shape directly; kept local so
 * the module never imports a Supabase-touching file at runtime.
 */
export type ChatAttentionApprovalInput = {
  id: string;
  action_type: string;
  description: string;
  status: string;
  requested_at: string;
  timeout_seconds: number;
};

/** Structural mirror of `useComputerUseTask`'s `PendingConfirmation`. */
export type ChatAttentionTaskQuestionInput = {
  id: string | null;
  question: string;
  options: string[];
  timeoutSec: number;
  askedAt: number;
};

/** A provider/runtime blocker the user must fix outside chat. */
export type ChatAttentionProviderBlockerInput = {
  provider: string;
  reason: string;
};

/**
 * Structural mirror of an `agent_runs` row for the circle-wide queue
 * (plan §5b) — only runs blocked on a human (`waiting_approval` /
 * `paused`) produce items; other statuses are ignored so callers can pass
 * `getActiveRuns()` output unfiltered.
 */
export type ChatAttentionBlockedRunInput = {
  id: string;
  title: string;
  status: string;
  surface?: string | null;
  started_at?: string | null;
  created_at?: string | null;
};

export type ChatAttentionInputs = {
  approvals?: ChatAttentionApprovalInput[] | null;
  pendingClarification?: ChatClarificationResumePending | null;
  pendingTaskQuestion?: ChatAttentionTaskQuestionInput | null;
  /** Unresolved recovery options from the most recent failed run. */
  recoveryOptions?: PersistedChatRecoveryOption[] | null;
  /** Short label for what the recovery options belong to ("WordPress publish"). */
  recoveryContextLabel?: string | null;
  /**
   * Stable id of the failure the options belong to (message/run id). Keys
   * the item id so dismissing one failure's recovery never hides the next
   * failure's options.
   */
  recoveryRefId?: string | null;
  providerBlockers?: ChatAttentionProviderBlockerInput[] | null;
  /** Circle runs; only waiting_approval/paused rows become items (§5b). */
  blockedRuns?: ChatAttentionBlockedRunInput[] | null;
};

export type ChatAttentionOptions = {
  /** Epoch ms "now". Injectable for deterministic smoke tests. */
  now?: number;
  /** Approvals expiring within this window rank as urgent. Default 5 min. */
  expiringThresholdMs?: number;
  /**
   * Expired approvals older than this stop being surfaced (the moment has
   * passed; nagging about a stale row is noise). Default 60 min.
   */
  expiredVisibilityMs?: number;
  /**
   * Item ids the user dismissed this session. Filtered BEFORE the status
   * line + urgency roll-up so the summary never counts rows the user can't
   * see (previously the strip filtered after, leaving "1 question for you"
   * pointing at nothing).
   */
  dismissedIds?: ReadonlySet<string>;
};

// ─── Output model ───────────────────────────────────────────────────────────

export type ChatAttentionKind =
  | 'approval_pending'
  | 'approval_expiring'
  | 'approval_expired'
  | 'clarification_waiting'
  | 'task_question_waiting'
  | 'recovery_available'
  | 'provider_blocked'
  | 'run_blocked';

export type ChatAttentionActionKind =
  | 'review_approval'
  | 'refile_approval'
  | 'answer_clarification'
  | 'answer_task_question'
  | 'choose_recovery'
  | 'open_marketplace'
  | 'open_run'
  | 'cancel_task'
  | 'dismiss';

export type ChatAttentionAction = {
  kind: ChatAttentionActionKind;
  label: string;
};

export type ChatAttentionUrgency = 'now' | 'soon' | 'idle';

export type ChatAttentionItem = {
  /** Stable id for list rendering + dismissal ("approval:<uuid>"). */
  id: string;
  kind: ChatAttentionKind;
  title: string;
  detail: string;
  urgency: ChatAttentionUrgency;
  /** How long this has been waiting on the user (the key triage signal). */
  waitingMs: number | null;
  /** Epoch ms when this stops being actionable, when known. */
  expiresAt: number | null;
  primaryAction: ChatAttentionAction;
  secondaryActions: ChatAttentionAction[];
  /** Underlying row/confirmation id the action targets, when there is one. */
  refId: string | null;
};

export type ChatAttentionState = {
  items: ChatAttentionItem[];
  /** One-line summary for the status strip; null when nothing needs the user. */
  statusLine: string | null;
  /** True when at least one item is urgency `now` (expiring / live question). */
  hasUrgent: boolean;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_EXPIRING_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRED_VISIBILITY_MS = 60 * 60 * 1000;
const URGENCY_RANK: Record<ChatAttentionUrgency, number> = { now: 0, soon: 1, idle: 2 };

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Epoch ms at which a proposal row stops being approvable. */
export function resolveApprovalExpiresAt(requestedAt: string, timeoutSeconds: number): number | null {
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(requested)) return null;
  const timeout = Number(timeoutSeconds);
  if (!Number.isFinite(timeout) || timeout <= 0) return null;
  return requested + timeout * 1000;
}

/** "just now" / "3m" / "2h 10m" — compact wait/countdown wording. */
export function formatChatAttentionDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Human label for an approval `action_type` ("chat.run_computer_task.browser" → "run computer task · browser"). */
function humanizeActionType(actionType: string): string {
  const parts = String(actionType || '').split('.').filter(Boolean);
  const withoutPrefix = parts[0] === 'chat' ? parts.slice(1) : parts;
  if (withoutPrefix.length === 0) return 'chat action';
  return withoutPrefix.map((part) => part.replace(/_/g, ' ')).join(' · ');
}

function clampText(value: string, max: number): string {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

// ─── Item builders ──────────────────────────────────────────────────────────

function approvalItems(
  approvals: ChatAttentionApprovalInput[],
  now: number,
  expiringThresholdMs: number,
  expiredVisibilityMs: number,
): ChatAttentionItem[] {
  const items: ChatAttentionItem[] = [];
  for (const approval of approvals) {
    if (!approval || String(approval.status) !== 'pending') continue;
    const expiresAt = resolveApprovalExpiresAt(approval.requested_at, approval.timeout_seconds);
    const requestedAt = Date.parse(approval.requested_at);
    const waitingMs = Number.isFinite(requestedAt) ? Math.max(0, now - requestedAt) : null;
    const what = humanizeActionType(approval.action_type);
    const detail = clampText(approval.description, 160);

    if (expiresAt !== null && expiresAt <= now) {
      // Row timed out but the poller hasn't flipped status yet — treat as
      // expired so the user learns the window closed instead of tapping a
      // dead card. Old expirations age out entirely.
      if (now - expiresAt > expiredVisibilityMs) continue;
      items.push({
        id: `approval:${approval.id}`,
        kind: 'approval_expired',
        title: `Approval expired: ${what}`,
        detail: detail
          ? `${detail} — the approval window closed before anyone decided.`
          : 'The approval window closed before anyone decided.',
        urgency: 'soon',
        waitingMs,
        expiresAt,
        primaryAction: { kind: 'refile_approval', label: 'Ask again' },
        secondaryActions: [{ kind: 'dismiss', label: 'Dismiss' }],
        refId: approval.id,
      });
      continue;
    }

    const expiringSoon = expiresAt !== null && expiresAt - now <= expiringThresholdMs;
    const countdown = expiresAt !== null ? formatChatAttentionDuration(expiresAt - now) : null;
    items.push({
      id: `approval:${approval.id}`,
      kind: expiringSoon ? 'approval_expiring' : 'approval_pending',
      title: expiringSoon && countdown
        ? `Approval needed (expires in ${countdown}): ${what}`
        : `Approval needed: ${what}`,
      detail,
      urgency: expiringSoon ? 'now' : 'soon',
      waitingMs,
      expiresAt,
      primaryAction: { kind: 'review_approval', label: 'Review & decide' },
      secondaryActions: [{ kind: 'cancel_task', label: 'Cancel request' }],
      refId: approval.id,
    });
  }
  return items;
}

function clarificationItem(
  pending: ChatClarificationResumePending,
  now: number,
): ChatAttentionItem {
  const missing = (pending.missingParams || []).filter(Boolean);
  const missingLabel = missing.length > 0 ? missing.join(', ').replace(/_/g, ' ') : 'a detail';
  const waitingMs = Number.isFinite(pending.askedAt) ? Math.max(0, now - pending.askedAt) : null;
  return {
    // Keyed by askedAt so dismissing one parked clarification never hides
    // the NEXT one (a static id blinded the strip for the whole session).
    id: `clarification:${Number.isFinite(pending.askedAt) ? pending.askedAt : 'pending'}`,
    kind: 'clarification_waiting',
    title: `Waiting on you: ${missingLabel}`,
    detail: pending.originalMessage
      ? `Your request "${clampText(pending.originalMessage, 90)}" is parked until you fill this in. Reply in chat to continue.`
      : 'Your last request is parked until you fill this in. Reply in chat to continue.',
    urgency: 'soon',
    waitingMs,
    expiresAt: null,
    primaryAction: { kind: 'answer_clarification', label: 'Answer' },
    secondaryActions: [{ kind: 'dismiss', label: 'Drop request' }],
    refId: null,
  };
}

function taskQuestionItem(
  question: ChatAttentionTaskQuestionInput,
  now: number,
): ChatAttentionItem {
  const expiresAt = Number.isFinite(question.askedAt) && question.timeoutSec > 0
    ? question.askedAt + question.timeoutSec * 1000
    : null;
  const waitingMs = Number.isFinite(question.askedAt) ? Math.max(0, now - question.askedAt) : null;
  const optionsSuffix = question.options.length > 0
    ? ` Options: ${clampText(question.options.join(' / '), 120)}`
    : '';
  const countdown = expiresAt !== null && expiresAt > now
    ? formatChatAttentionDuration(expiresAt - now)
    : null;
  return {
    id: `task_question:${question.id ?? 'live'}`,
    kind: 'task_question_waiting',
    title: countdown
      ? `The running task is asking you (answer within ${countdown})`
      : 'The running task is asking you',
    detail: `${clampText(question.question, 160)}${optionsSuffix}`,
    urgency: 'now',
    waitingMs,
    expiresAt,
    primaryAction: { kind: 'answer_task_question', label: 'Answer now' },
    secondaryActions: [{ kind: 'cancel_task', label: 'Stop task' }],
    refId: question.id,
  };
}

function recoveryItem(
  options: PersistedChatRecoveryOption[],
  contextLabel: string | null | undefined,
  refId: string | null | undefined,
): ChatAttentionItem {
  const recommended = options.find((option) => option.recommended) ?? options[0];
  const what = contextLabel ? clampText(contextLabel, 60) : 'the failed task';
  return {
    id: `recovery:${refId || 'latest'}`,
    kind: 'recovery_available',
    title: `Pick how to recover ${what}`,
    detail: recommended
      ? `Recommended: ${clampText(recommended.label, 80)}. ${options.length} option${options.length === 1 ? '' : 's'} available.`
      : `${options.length} recovery option${options.length === 1 ? '' : 's'} available.`,
    urgency: 'soon',
    waitingMs: null,
    expiresAt: null,
    primaryAction: {
      kind: 'choose_recovery',
      label: recommended ? clampText(recommended.label, 40) : 'Choose recovery',
    },
    secondaryActions: [{ kind: 'dismiss', label: 'Leave it' }],
    refId: recommended ? recommended.id : null,
  };
}

function blockedRunItem(run: ChatAttentionBlockedRunInput, now: number): ChatAttentionItem {
  const since = Date.parse(String(run.started_at || run.created_at || ''));
  const waitingMs = Number.isFinite(since) ? Math.max(0, now - since) : null;
  const waitLabel = waitingMs !== null ? ` — blocked ${formatChatAttentionDuration(waitingMs)}` : '';
  const isPaused = String(run.status) === 'paused';
  return {
    id: `run:${run.id}`,
    kind: 'run_blocked',
    title: isPaused
      ? `Run paused: ${clampText(run.title || 'untitled run', 70)}`
      : `Run waiting on a decision: ${clampText(run.title || 'untitled run', 70)}`,
    detail: `${run.surface ? `${String(run.surface).replace(/_/g, ' ')} · ` : ''}nobody has unblocked it yet${waitLabel}.`,
    urgency: 'soon',
    waitingMs,
    expiresAt: null,
    primaryAction: { kind: 'open_run', label: 'View run' },
    secondaryActions: [{ kind: 'dismiss', label: 'Dismiss' }],
    refId: run.id,
  };
}

function providerBlockerItem(blocker: ChatAttentionProviderBlockerInput, index: number): ChatAttentionItem {
  return {
    id: `provider:${blocker.provider || index}`,
    kind: 'provider_blocked',
    title: `${blocker.provider} needs setup before this can run`,
    detail: clampText(blocker.reason, 160),
    urgency: 'soon',
    waitingMs: null,
    expiresAt: null,
    primaryAction: { kind: 'open_marketplace', label: 'Open Marketplace' },
    secondaryActions: [{ kind: 'dismiss', label: 'Dismiss' }],
    refId: blocker.provider || null,
  };
}

// ─── Status line ────────────────────────────────────────────────────────────

function buildStatusLine(items: ChatAttentionItem[], now: number): string | null {
  if (items.length === 0) return null;
  const segments: string[] = [];

  const liveApprovals = items.filter(
    (item) => item.kind === 'approval_pending' || item.kind === 'approval_expiring',
  );
  if (liveApprovals.length > 0) {
    const soonest = liveApprovals
      .map((item) => item.expiresAt)
      .filter((value): value is number => value !== null && value > now)
      .sort((a, b) => a - b)[0];
    const countdown = soonest !== undefined ? ` (next expires in ${formatChatAttentionDuration(soonest - now)})` : '';
    segments.push(`${liveApprovals.length} approval${liveApprovals.length === 1 ? '' : 's'}${countdown}`);
  }

  const expired = items.filter((item) => item.kind === 'approval_expired').length;
  if (expired > 0) segments.push(`${expired} expired approval${expired === 1 ? '' : 's'}`);

  const questions = items.filter(
    (item) => item.kind === 'task_question_waiting' || item.kind === 'clarification_waiting',
  ).length;
  if (questions > 0) segments.push(`${questions} question${questions === 1 ? '' : 's'} for you`);

  if (items.some((item) => item.kind === 'recovery_available')) segments.push('recovery choice');

  const providers = items.filter((item) => item.kind === 'provider_blocked').length;
  if (providers > 0) segments.push(`${providers} provider${providers === 1 ? '' : 's'} to set up`);

  const blockedRuns = items.filter((item) => item.kind === 'run_blocked').length;
  if (blockedRuns > 0) segments.push(`${blockedRuns} run${blockedRuns === 1 ? '' : 's'} blocked`);

  return `Needs you: ${segments.join(' · ')}`;
}

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildChatAttentionState(
  inputs: ChatAttentionInputs,
  opts: ChatAttentionOptions = {},
): ChatAttentionState {
  const now = opts.now ?? Date.now();
  const expiringThresholdMs = opts.expiringThresholdMs ?? DEFAULT_EXPIRING_THRESHOLD_MS;
  const expiredVisibilityMs = opts.expiredVisibilityMs ?? DEFAULT_EXPIRED_VISIBILITY_MS;

  const items: ChatAttentionItem[] = [];

  items.push(...approvalItems(inputs.approvals ?? [], now, expiringThresholdMs, expiredVisibilityMs));
  if (inputs.pendingClarification) items.push(clarificationItem(inputs.pendingClarification, now));
  if (inputs.pendingTaskQuestion) items.push(taskQuestionItem(inputs.pendingTaskQuestion, now));
  const recoveryOptions = (inputs.recoveryOptions ?? []).filter(Boolean);
  if (recoveryOptions.length > 0) {
    items.push(recoveryItem(recoveryOptions, inputs.recoveryContextLabel, inputs.recoveryRefId));
  }
  (inputs.providerBlockers ?? []).forEach((blocker, index) => {
    if (blocker && (blocker.provider || blocker.reason)) items.push(providerBlockerItem(blocker, index));
  });
  for (const run of inputs.blockedRuns ?? []) {
    if (!run || !run.id) continue;
    const status = String(run.status || '');
    if (status !== 'waiting_approval' && status !== 'paused') continue;
    items.push(blockedRunItem(run, now));
  }

  // Dismissals filter BEFORE ranking/status so counts match what renders.
  const visibleItems = opts.dismissedIds && opts.dismissedIds.size > 0
    ? items.filter((item) => !opts.dismissedIds!.has(item.id))
    : items;

  // Rank: urgent first, then soonest expiry, then longest wait — the agent
  // that has been blocked longest is the one most owed an answer.
  visibleItems.sort((a, b) => {
    const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (urgency !== 0) return urgency;
    const aExpiry = a.expiresAt ?? Number.POSITIVE_INFINITY;
    const bExpiry = b.expiresAt ?? Number.POSITIVE_INFINITY;
    if (aExpiry !== bExpiry) return aExpiry - bExpiry;
    return (b.waitingMs ?? 0) - (a.waitingMs ?? 0);
  });

  return {
    items: visibleItems,
    statusLine: buildStatusLine(visibleItems, now),
    hasUrgent: visibleItems.some((item) => item.urgency === 'now'),
  };
}
