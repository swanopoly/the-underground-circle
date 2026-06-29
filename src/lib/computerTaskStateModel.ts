import type { ComputerTaskCheckpointSurface, ComputerTaskComplexityPlan } from './computerTaskComplexityPlan';

export type ComputerTaskPhase =
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_capability_approval'
  | 'building_capability'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'blocked';

export type ComputerTaskStepStatus = 'pending' | 'active' | 'completed' | 'blocked';
export type ComputerTaskCapabilityBuildoutStatus =
  | 'approval_required'
  | 'requested'
  | 'ready_to_retry'
  | 'incomplete'
  | 'blocked'
  | 'failed';

export interface ComputerTaskStateStep {
  id: string;
  label: string;
  status: ComputerTaskStepStatus;
}

export interface ComputerTaskStateGrounding {
  status: string;
  strategyId: string | null;
  strategyLabel: string | null;
  primarySurface: string | null;
  summary: string | null;
  nextAction: string | null;
  badges: string[];
  blockers: string[];
}

export interface ComputerTaskCapabilityBuildout {
  status: ComputerTaskCapabilityBuildoutStatus;
  message: string;
  appName?: string | null;
  buildoutKind?: string | null;
  risk?: string | null;
  sessionId?: string | null;
  launched?: boolean | null;
  approvalId?: string | null;
  retryPlan?: string | null;
  summary?: string | null;
  controlSurface?: string | null;
  sourceRefs?: string[];
  filesChanged?: string[];
  verification?: string | null;
  userActionNeeded?: string | null;
  missingEvidence?: string[];
  autoRetryStatus?: 'running' | 'completed' | 'failed' | null;
  autoRetryAttemptedAt?: string | null;
  autoRetryCompletedAt?: string | null;
  autoRetryRunId?: string | null;
  updatedAt: string;
}

export interface ComputerTaskStateCheckpoint {
  id: string;
  label: string;
  surface: ComputerTaskCheckpointSurface | string;
  requiresApproval: boolean;
}

export interface ComputerTaskStateComplexity {
  level: string;
  score: number;
  reasons: string[];
  checkpoints: ComputerTaskStateCheckpoint[];
  /** Compact D4 stages — present only for multi-surface staged tasks. */
  stages?: Array<{ id: string; ordinal: number; surface: string; goal: string }> | null;
}

export interface ComputerTaskStateCheckpointRecovery {
  level: string;
  complexityScore: number;
  failedCheckpointId: string;
  failedCheckpointLabel: string;
  surface: string;
  requiresApproval: boolean;
  confidence: string;
  reason: string;
  safeNextStep: string;
  remainingCheckpointIds: string[];
  /** D4b stage-aware recovery — which stage failed, which are done. */
  failedStageId?: string | null;
  completedStageIds?: string[];
  retryPolicy?: {
    failureFingerprint: string;
    repeatCount: number;
    retryLimit: number;
    canRetry: boolean;
    nextAction: string;
    stopReason: string | null;
    requiredEvidence: Array<{
      id: string;
      tool: string;
      summary: string;
      freshnessMs: number;
      required: boolean;
    }>;
    forbiddenActions: string[];
    resumeInstruction: string;
    evidenceReadiness?: ComputerTaskCheckpointEvidenceReadiness | null;
  } | null;
}

export interface ComputerTaskCheckpointEvidenceObservation {
  id?: string | null;
  ruleId?: string | null;
  tool: string;
  capturedAt: string | number;
  summary?: string | null;
}

export interface ComputerTaskCheckpointEvidenceReadiness {
  ready: boolean;
  status: 'ready' | 'missing' | 'stale' | 'blocked';
  checkedAt: string;
  satisfiedEvidenceIds: string[];
  missingEvidenceIds: string[];
  staleEvidenceIds: string[];
  nextEvidenceTools: string[];
  summary: string;
}

/**
 * A question the agent asked mid-task that needs a user answer (D2:
 * MFA, ambiguity, approval choice). Previously these lived only in React
 * hook state and were lost on reload — persisting them on the durable
 * task record makes them survivable and answerable later: the record
 * carries sessionId/runId so a fresh client can resume the paused
 * session instead of restarting the task.
 */
export interface ComputerTaskPendingQuestion {
  id: string;
  question: string;
  options: string[];
  context: string | null;
  askedAt: string;
  sessionId: string | null;
  runId: string | null;
  status: 'pending' | 'answered' | 'expired';
  answer: string | null;
  resolvedAt: string | null;
}

/**
 * A completion/blocked/needs-you notification for a computer task (D6) —
 * the "you walked away, here is what happened" record. Derived only on
 * state TRANSITIONS (never re-fired for the same state) and persisted on
 * the durable task record so a user who returns after the task finished,
 * failed, or got stuck learns about it without opening the console.
 */
export type ComputerTaskNotificationKind =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'needs_you'
  | 'partial_result';

export interface ComputerTaskNotification {
  id: string;
  kind: ComputerTaskNotificationKind;
  /** Bounded ≤80 chars. */
  title: string;
  /** Bounded ≤200 chars; includes top blocker/question or result summary. */
  body: string;
  createdAtIso: string;
  taskRunId?: string | null;
  acknowledged?: boolean;
}

/**
 * E1 surface-escalation breadcrumb (durable copy) — "the run switched from
 * rung X to rung Y because Z". Structurally identical to
 * `ComputerTaskSurfaceEscalation` in `appAutomationControlSurfaces.ts` but
 * defined locally so this model stays dependency-light for smoke tests.
 * Bounded ≤3 with the same persistence discipline as D6 notifications.
 */
export interface ComputerTaskSurfaceEscalationBreadcrumb {
  fromSurface: string;
  toSurface: string;
  /** Bounded ≤300 chars. */
  reason: string;
  atIso: string;
  appName?: string | null;
  failureCode?: string | null;
}

/**
 * L2 hybrid recipes: one recorded tool action from a successful run. The
 * producer (computerTaskRuntime — owned by another agent right now) captures
 * these at execution time, credential-redacted and bounded, and sets them on
 * the durable record. This model only normalizes/consumes them.
 */
export interface ComputerTaskActionTraceStep {
  tool: string;
  input?: Record<string, unknown> | null;
}

/** Versioned trace envelope persisted on the durable task record. */
export interface ComputerTaskActionTrace {
  v: 1;
  actions: ComputerTaskActionTraceStep[];
}

export interface ComputerTaskStateRecord {
  id: string;
  circleId: string;
  threadId: string | null;
  task: string;
  taskKind: string;
  taskLabel: string;
  adapterId?: string | null;
  phase: ComputerTaskPhase;
  currentStep: string | null;
  steps: ComputerTaskStateStep[];
  blockers: string[];
  nextSteps: string[];
  grantedAccess: string[];
  accessPlan: string | null;
  runId?: string | null;
  sessionId?: string | null;
  liveUrl?: string | null;
  grounding?: ComputerTaskStateGrounding | null;
  capabilityBuildout?: ComputerTaskCapabilityBuildout | null;
  complexity?: ComputerTaskStateComplexity | null;
  checkpointRecovery?: ComputerTaskStateCheckpointRecovery | null;
  pendingQuestions?: ComputerTaskPendingQuestion[] | null;
  /** D6 completion/blocked notifications — bounded ≤5, newest first. */
  notifications?: ComputerTaskNotification[] | null;
  /** E1 surface-escalation breadcrumbs — bounded ≤3, oldest first.
   *  Persisted-compatible: old records without the field normalize to []. */
  surfaceEscalations?: ComputerTaskSurfaceEscalationBreadcrumb[] | null;
  /** L2 hybrid recipes: redacted tool-action trace from a successful run —
   *  bounded ≤40 actions. Persisted-compatible: old records without the
   *  field normalize to null. PRODUCER: `computerTaskRuntime` (owned by
   *  another agent) sets this on run completion; "Save as recipe" passes it
   *  into `buildComputerTaskRecipeDraft` so the recipe embeds the verified
   *  step sequence. */
  actionTrace?: ComputerTaskActionTrace | null;
  updatedAt: string;
}

// ─── Surface-escalation breadcrumbs (E1 follow-up) ──────────────────────────

const SURFACE_ESCALATION_LIMIT = 3;

/** Drop malformed entries, bound strings, keep order, cap at 3 (newest kept). */
export function compactComputerTaskSurfaceEscalations(
  list?: Array<Partial<ComputerTaskSurfaceEscalationBreadcrumb>> | null,
): ComputerTaskSurfaceEscalationBreadcrumb[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item
      && String(item.fromSurface || '').trim()
      && String(item.toSurface || '').trim()
      && String(item.reason || '').trim())
    .map((item): ComputerTaskSurfaceEscalationBreadcrumb => ({
      fromSurface: String(item.fromSurface).slice(0, 60),
      toSurface: String(item.toSurface).slice(0, 60),
      reason: String(item.reason).slice(0, 300),
      atIso: String(item.atIso || ''),
      appName: item.appName ? String(item.appName).slice(0, 80) : null,
      failureCode: item.failureCode ? String(item.failureCode).slice(0, 60) : null,
    }))
    .slice(-SURFACE_ESCALATION_LIMIT);
}

/**
 * Merge new runtime breadcrumbs onto the persisted list — dedupes identical
 * from+to+reason entries (the same descent persisted by two write paths must
 * not double up), keeps chronological order, bounded ≤3 (oldest dropped).
 * Pure; smoke-testable.
 */
export function appendComputerTaskSurfaceEscalations(
  existing: Array<Partial<ComputerTaskSurfaceEscalationBreadcrumb>> | null | undefined,
  incoming: Array<Partial<ComputerTaskSurfaceEscalationBreadcrumb>> | null | undefined,
): ComputerTaskSurfaceEscalationBreadcrumb[] {
  const base = compactComputerTaskSurfaceEscalations(existing);
  const merged = [...base];
  for (const entry of compactComputerTaskSurfaceEscalations(incoming)) {
    const duplicate = merged.some((item) => (
      item.fromSurface === entry.fromSurface
      && item.toSurface === entry.toSurface
      && item.reason === entry.reason
    ));
    if (!duplicate) merged.push(entry);
  }
  return merged.slice(-SURFACE_ESCALATION_LIMIT);
}

function humanizeSurfaceToken(value: string): string {
  return String(value || '').replace(/_/g, ' ').trim();
}

/**
 * Compact one-line rendering of an escalation breadcrumb for task cards:
 * `↳ switched to screenshot control: a11y tree empty (Photoshop)`.
 * Prefers the structured failure code over the long reason text.
 */
export function formatComputerTaskSurfaceEscalationLine(
  entry: ComputerTaskSurfaceEscalationBreadcrumb,
): string {
  const cause = entry.failureCode
    ? humanizeSurfaceToken(entry.failureCode)
    : entry.reason.slice(0, 80);
  const app = entry.appName ? ` (${entry.appName})` : '';
  return `↳ switched to ${humanizeSurfaceToken(entry.toSurface)}: ${cause}${app}`;
}

export function compactComputerTaskPendingQuestions(
  list?: Array<Partial<ComputerTaskPendingQuestion>> | null,
): ComputerTaskPendingQuestion[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && String(item.id || '').trim() && String(item.question || '').trim())
    .map((item): ComputerTaskPendingQuestion => {
      const status: ComputerTaskPendingQuestion['status'] =
        item.status === 'answered' || item.status === 'expired' ? item.status : 'pending';
      return {
        id: String(item.id).slice(0, 80),
        question: String(item.question).slice(0, 500),
        options: Array.isArray(item.options) ? item.options.map(String).filter(Boolean).slice(0, 6) : [],
        context: item.context ? String(item.context).slice(0, 300) : null,
        askedAt: String(item.askedAt || ''),
        sessionId: item.sessionId ? String(item.sessionId).slice(0, 120) : null,
        runId: item.runId ? String(item.runId).slice(0, 120) : null,
        status,
        answer: item.answer ? String(item.answer).slice(0, 500) : null,
        resolvedAt: item.resolvedAt ? String(item.resolvedAt) : null,
      };
    })
    .slice(0, 5);
}

/** Add or replace (by id) a pending question. Keeps the list bounded. */
export function upsertComputerTaskPendingQuestion(
  list: ComputerTaskPendingQuestion[] | null | undefined,
  question: ComputerTaskPendingQuestion,
): ComputerTaskPendingQuestion[] {
  const compactQuestion = compactComputerTaskPendingQuestions([question])[0];
  if (!compactQuestion) return compactComputerTaskPendingQuestions(list);
  const rest = compactComputerTaskPendingQuestions(list).filter((item) => item.id !== compactQuestion.id);
  return [...rest, compactQuestion].slice(-5);
}

/** Mark a question answered (or expired when `answer` is null). */
export function resolveComputerTaskPendingQuestion(
  list: ComputerTaskPendingQuestion[] | null | undefined,
  id: string,
  answer: string | null,
  resolvedAtIso: string,
): ComputerTaskPendingQuestion[] {
  return compactComputerTaskPendingQuestions(list).map((item) => (
    item.id === id && item.status === 'pending'
      ? { ...item, status: answer === null ? 'expired' as const : 'answered' as const, answer, resolvedAt: resolvedAtIso }
      : item
  ));
}

/** The questions still waiting on the user — the "needs you" surface. */
export function listOpenComputerTaskQuestions(
  record: Pick<ComputerTaskStateRecord, 'pendingQuestions'> | null | undefined,
): ComputerTaskPendingQuestion[] {
  return compactComputerTaskPendingQuestions(record?.pendingQuestions).filter((item) => item.status === 'pending');
}

// ─── Completion/blocked notifications (D6) ──────────────────────────────────

const NOTIFICATION_KINDS: ComputerTaskNotificationKind[] = [
  'completed',
  'failed',
  'blocked',
  'needs_you',
  'partial_result',
];

const NOTIFICATION_LIMIT = 5;

/** Drop malformed entries, bound strings, keep newest-first order, cap at 5. */
export function compactComputerTaskNotifications(
  list?: Array<Partial<ComputerTaskNotification>> | null,
): ComputerTaskNotification[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item
      && NOTIFICATION_KINDS.includes(item.kind as ComputerTaskNotificationKind)
      && String(item.title || '').trim())
    .map((item): ComputerTaskNotification => ({
      id: String(item.id || `ctn_${item.kind}_${item.createdAtIso || ''}`).slice(0, 80),
      kind: item.kind as ComputerTaskNotificationKind,
      title: String(item.title).slice(0, 80),
      body: String(item.body || '').slice(0, 200),
      createdAtIso: String(item.createdAtIso || ''),
      taskRunId: item.taskRunId ? String(item.taskRunId).slice(0, 120) : null,
      acknowledged: Boolean(item.acknowledged),
    }))
    .slice(0, NOTIFICATION_LIMIT);
}

/**
 * Compact snapshot of the notification-relevant state used to detect
 * transitions. Callers capture it from the PREVIOUS record before a write
 * and pass it to `deriveComputerTaskNotification` with the NEXT record.
 */
export interface ComputerTaskNotificationSnapshot {
  phase?: ComputerTaskPhase | string | null;
  openQuestionCount?: number;
  blockerCount?: number;
}

export function computerTaskNotificationSnapshot(
  record: Pick<ComputerTaskStateRecord, 'phase' | 'pendingQuestions' | 'blockers'> | null | undefined,
): ComputerTaskNotificationSnapshot {
  if (!record) return { phase: null, openQuestionCount: 0, blockerCount: 0 };
  return {
    phase: record.phase,
    openQuestionCount: listOpenComputerTaskQuestions(record).length,
    blockerCount: Array.isArray(record.blockers) ? record.blockers.filter(Boolean).length : 0,
  };
}

/**
 * Derive a notification for a state TRANSITION (D6): running→completed/
 * failed/blocked, blocker count 0→n, a new open question, awaiting
 * approval, or an explicit partial result on a bounded stop. Returns null
 * when nothing newly notification-worthy happened — calling it twice with
 * the same record/snapshot never repeats. Pure; smoke-testable.
 */
export function deriveComputerTaskNotification(
  record: ComputerTaskStateRecord | null | undefined,
  prevSnapshot?: ComputerTaskNotificationSnapshot | null,
  opts?: {
    nowIso?: string;
    /** Final result summary — used as the completed/failed body when present. */
    resultSummary?: string | null;
    /** A bounded stop handed back partial progress (D8) — fires `partial_result`. */
    partialResultSummary?: string | null;
  },
): ComputerTaskNotification | null {
  if (!record || !record.id) return null;
  const createdAtIso = opts?.nowIso || new Date().toISOString();
  const taskLabel = String(record.taskLabel || record.task || 'Computer task').slice(0, 60);
  const prevPhase = prevSnapshot?.phase ?? null;
  const prevQuestionCount = Math.max(0, Math.floor(prevSnapshot?.openQuestionCount ?? 0));
  const prevBlockerCount = Math.max(0, Math.floor(prevSnapshot?.blockerCount ?? 0));
  const openQuestions = listOpenComputerTaskQuestions(record);
  const blockers = (record.blockers || []).map(String).filter(Boolean);
  const make = (kind: ComputerTaskNotificationKind, title: string, body: string): ComputerTaskNotification => ({
    id: `ctn_${kind}_${createdAtIso}`.slice(0, 80),
    kind,
    title: title.slice(0, 80),
    body: String(body || '').slice(0, 200),
    createdAtIso,
    taskRunId: record.runId || null,
    acknowledged: false,
  });

  if (opts?.partialResultSummary && record.phase !== 'completed') {
    return make('partial_result', `${taskLabel} stopped with partial progress`, opts.partialResultSummary);
  }
  if (record.phase === 'completed' && prevPhase !== 'completed') {
    return make('completed', `${taskLabel} finished`, opts?.resultSummary || `Done: ${record.task}`);
  }
  if (record.phase === 'failed' && prevPhase !== 'failed') {
    const body = blockers[0] || record.checkpointRecovery?.reason || opts?.resultSummary || `The task failed: ${record.task}`;
    return make('failed', `${taskLabel} failed`, body);
  }
  if (record.phase === 'blocked' && prevPhase !== 'blocked') {
    const body = blockers[0] || record.checkpointRecovery?.reason || record.nextSteps[0] || 'The task is blocked and needs attention.';
    return make('blocked', `${taskLabel} is blocked`, body);
  }
  if (openQuestions.length > prevQuestionCount) {
    const newest = openQuestions[openQuestions.length - 1];
    return make('needs_you', `${taskLabel} needs your answer`, newest.question);
  }
  if ((record.phase === 'awaiting_approval' || record.phase === 'awaiting_capability_approval') && prevPhase !== record.phase) {
    const body = record.capabilityBuildout?.message || record.accessPlan || 'The task is paused waiting for your approval.';
    return make('needs_you', `${taskLabel} needs your approval`, body);
  }
  if (blockers.length > 0 && prevBlockerCount === 0 && record.phase !== 'completed') {
    return make('blocked', `${taskLabel} hit a blocker`, blockers[0]);
  }
  return null;
}

/**
 * Prepend a derived notification to the bounded list (newest first, ≤5).
 * Dedupes an identical kind+title+body so the same state never produces a
 * second banner even if two write paths derive it.
 */
export function appendComputerTaskNotification(
  list: Array<Partial<ComputerTaskNotification>> | null | undefined,
  notification: ComputerTaskNotification | null | undefined,
): ComputerTaskNotification[] {
  const existing = compactComputerTaskNotifications(list);
  const compact = notification ? compactComputerTaskNotifications([notification])[0] : null;
  if (!compact) return existing;
  if (existing.some((item) => item.kind === compact.kind && item.title === compact.title && item.body === compact.body)) {
    return existing;
  }
  return [compact, ...existing].slice(0, NOTIFICATION_LIMIT);
}

/** The notifications the user has not seen/dismissed yet — newest first. */
export function listUnacknowledgedComputerTaskNotifications(
  record: Pick<ComputerTaskStateRecord, 'notifications'> | null | undefined,
): ComputerTaskNotification[] {
  return compactComputerTaskNotifications(record?.notifications).filter((item) => !item.acknowledged);
}

/** Mark every persisted notification acknowledged (banner dismissed/seen). */
export function acknowledgeComputerTaskNotifications(
  record: ComputerTaskStateRecord,
): ComputerTaskStateRecord {
  const notifications = compactComputerTaskNotifications(record.notifications)
    .map((item) => ({ ...item, acknowledged: true }));
  return { ...record, notifications };
}

export const COMPUTER_TASK_NOTIFICATION_GLYPHS: Record<ComputerTaskNotificationKind, string> = {
  completed: '✓',
  failed: '✕',
  blocked: '⛔',
  needs_you: '🙋',
  partial_result: '◐',
};

/**
 * Progressive enhancement: fire a native web Notification for a terminal
 * transition observed by the LIVE task hook, but only when the page is
 * hidden and the browser permission was ALREADY granted (never requests
 * permission). Silent no-op everywhere else (native, denied, unsupported).
 */
export function fireComputerTaskWebNotification(
  notification: Pick<ComputerTaskNotification, 'kind' | 'title' | 'body'> | null | undefined,
): boolean {
  try {
    if (!notification) return false;
    if (notification.kind !== 'completed' && notification.kind !== 'failed' && notification.kind !== 'blocked') return false;
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return false;
    const NotificationCtor = typeof window !== 'undefined' ? (window as any).Notification : undefined;
    if (typeof NotificationCtor !== 'function' || NotificationCtor.permission !== 'granted') return false;
    // eslint-disable-next-line no-new
    new NotificationCtor(String(notification.title).slice(0, 80), {
      body: String(notification.body || '').slice(0, 200),
      tag: 'uc-computer-task',
    });
    return true;
  } catch {
    return false;
  }
}

export function compactComputerTaskComplexityPlan(plan?: ComputerTaskComplexityPlan | null): ComputerTaskStateComplexity | null {
  if (!plan || plan.level === 'simple') return null;
  const stages = Array.isArray(plan.stages)
    ? plan.stages.map((stage) => ({
        id: String(stage.id || '').slice(0, 60),
        ordinal: Number.isFinite(stage.ordinal) ? stage.ordinal : 0,
        surface: String(stage.surface || '').slice(0, 30),
        goal: String(stage.goal || '').slice(0, 160),
      })).filter((stage) => stage.id && stage.goal).slice(0, 4)
    : [];
  return {
    level: plan.level,
    score: Number.isFinite(plan.score) ? plan.score : 0,
    reasons: plan.reasons.map(String).filter(Boolean).slice(0, 6),
    checkpoints: plan.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      label: checkpoint.label,
      surface: checkpoint.surface,
      requiresApproval: checkpoint.requiresApproval,
    })).filter((checkpoint) => checkpoint.id && checkpoint.label).slice(0, 8),
    stages: stages.length >= 2 ? stages : null,
  };
}

export function compactComputerTaskCheckpointRecovery(recovery?: ComputerTaskStateCheckpointRecovery | null): ComputerTaskStateCheckpointRecovery | null {
  if (!recovery || !recovery.failedCheckpointId || !recovery.failedCheckpointLabel) return null;
  const evidenceReadiness = compactComputerTaskCheckpointEvidenceReadiness(recovery.retryPolicy?.evidenceReadiness || null);
  const retryPolicy = recovery.retryPolicy && typeof recovery.retryPolicy === 'object'
    ? {
        failureFingerprint: String(recovery.retryPolicy.failureFingerprint || '').slice(0, 180),
        repeatCount: Number.isFinite(recovery.retryPolicy.repeatCount) ? Math.max(1, Math.min(99, Math.floor(recovery.retryPolicy.repeatCount))) : 1,
        retryLimit: Number.isFinite(recovery.retryPolicy.retryLimit) ? Math.max(0, Math.min(5, Math.floor(recovery.retryPolicy.retryLimit))) : 1,
        canRetry: Boolean(recovery.retryPolicy.canRetry),
        nextAction: String(recovery.retryPolicy.nextAction || '').slice(0, 500),
        stopReason: recovery.retryPolicy.stopReason ? String(recovery.retryPolicy.stopReason).slice(0, 500) : null,
        requiredEvidence: Array.isArray(recovery.retryPolicy.requiredEvidence)
          ? recovery.retryPolicy.requiredEvidence.map((item) => ({
              id: String(item?.id || '').slice(0, 80),
              tool: String(item?.tool || '').slice(0, 120),
              summary: String(item?.summary || '').slice(0, 300),
              freshnessMs: Number.isFinite(item?.freshnessMs) ? Math.max(0, Math.min(120_000, Math.floor(item.freshnessMs))) : 15_000,
              required: item?.required !== false,
            })).filter((item) => item.id && item.tool).slice(0, 6)
          : [],
        forbiddenActions: Array.isArray(recovery.retryPolicy.forbiddenActions)
          ? recovery.retryPolicy.forbiddenActions.map(String).filter(Boolean).slice(0, 4)
          : [],
        resumeInstruction: String(recovery.retryPolicy.resumeInstruction || '').slice(0, 700),
        evidenceReadiness,
      }
    : null;
  return {
    level: String(recovery.level || ''),
    complexityScore: Number.isFinite(recovery.complexityScore) ? recovery.complexityScore : 0,
    failedCheckpointId: String(recovery.failedCheckpointId || '').slice(0, 120),
    failedCheckpointLabel: String(recovery.failedCheckpointLabel || '').slice(0, 160),
    surface: String(recovery.surface || 'unknown').slice(0, 80),
    requiresApproval: Boolean(recovery.requiresApproval),
    confidence: String(recovery.confidence || 'low').slice(0, 40),
    reason: String(recovery.reason || '').slice(0, 500),
    safeNextStep: String(recovery.safeNextStep || '').slice(0, 500),
    remainingCheckpointIds: Array.isArray(recovery.remainingCheckpointIds)
      ? recovery.remainingCheckpointIds.map(String).filter(Boolean).slice(0, 8)
      : [],
    failedStageId: recovery.failedStageId ? String(recovery.failedStageId).slice(0, 60) : null,
    completedStageIds: Array.isArray(recovery.completedStageIds)
      ? recovery.completedStageIds.map(String).filter(Boolean).slice(0, 4)
      : [],
    retryPolicy,
  };
}

export function compactComputerTaskCheckpointEvidenceReadiness(readiness?: ComputerTaskCheckpointEvidenceReadiness | null): ComputerTaskCheckpointEvidenceReadiness | null {
  if (!readiness || typeof readiness !== 'object') return null;
  const status = ['ready', 'missing', 'stale', 'blocked'].includes(String(readiness.status))
    ? readiness.status
    : readiness.ready ? 'ready' : 'missing';
  return {
    ready: Boolean(readiness.ready),
    status,
    checkedAt: String(readiness.checkedAt || new Date().toISOString()),
    satisfiedEvidenceIds: Array.isArray(readiness.satisfiedEvidenceIds) ? readiness.satisfiedEvidenceIds.map(String).filter(Boolean).slice(0, 8) : [],
    missingEvidenceIds: Array.isArray(readiness.missingEvidenceIds) ? readiness.missingEvidenceIds.map(String).filter(Boolean).slice(0, 8) : [],
    staleEvidenceIds: Array.isArray(readiness.staleEvidenceIds) ? readiness.staleEvidenceIds.map(String).filter(Boolean).slice(0, 8) : [],
    nextEvidenceTools: Array.isArray(readiness.nextEvidenceTools) ? readiness.nextEvidenceTools.map(String).filter(Boolean).slice(0, 8) : [],
    summary: String(readiness.summary || '').slice(0, 500),
  };
}

function observationTimeMs(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function observationSatisfiesRequirement(observation: ComputerTaskCheckpointEvidenceObservation, requirement: { id: string; tool: string }): boolean {
  return observation.tool === requirement.tool
    || observation.id === requirement.id
    || observation.ruleId === requirement.id;
}

export function evaluateComputerTaskCheckpointEvidenceReadiness(args: {
  recovery?: ComputerTaskStateCheckpointRecovery | null;
  observations?: ComputerTaskCheckpointEvidenceObservation[];
  nowMs?: number;
}): ComputerTaskCheckpointEvidenceReadiness | null {
  const recovery = compactComputerTaskCheckpointRecovery(args.recovery || null);
  if (!recovery?.retryPolicy) return null;
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const checkedAt = new Date(nowMs).toISOString();
  if (!recovery.retryPolicy.canRetry) {
    return {
      ready: false,
      status: 'blocked',
      checkedAt,
      satisfiedEvidenceIds: [],
      missingEvidenceIds: [],
      staleEvidenceIds: [],
      nextEvidenceTools: [],
      summary: recovery.retryPolicy.stopReason || 'Retry is blocked by the checkpoint recovery guard.',
    };
  }

  const required = recovery.retryPolicy.requiredEvidence.filter((item) => item.required);
  const observations = (args.observations || []).filter((item) => item && item.tool);
  const satisfiedEvidenceIds: string[] = [];
  const missingEvidenceIds: string[] = [];
  const staleEvidenceIds: string[] = [];
  const nextEvidenceTools: string[] = [];

  for (const requirement of required) {
    const matching = observations
      .filter((observation) => observationSatisfiesRequirement(observation, requirement))
      .map((observation) => {
        const capturedAt = observationTimeMs(observation.capturedAt);
        const ageMs = capturedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - capturedAt);
        return { observation, ageMs };
      })
      .sort((a, b) => a.ageMs - b.ageMs);
    const fresh = matching.find((item) => item.ageMs <= requirement.freshnessMs);
    if (fresh) {
      satisfiedEvidenceIds.push(requirement.id);
    } else if (matching.length > 0) {
      staleEvidenceIds.push(requirement.id);
      nextEvidenceTools.push(requirement.tool);
    } else {
      missingEvidenceIds.push(requirement.id);
      nextEvidenceTools.push(requirement.tool);
    }
  }

  const ready = required.length === 0 || (missingEvidenceIds.length === 0 && staleEvidenceIds.length === 0);
  const status = ready ? 'ready' : staleEvidenceIds.length > 0 ? 'stale' : 'missing';
  const missingText = missingEvidenceIds.length ? `missing ${missingEvidenceIds.join(', ')}` : '';
  const staleText = staleEvidenceIds.length ? `stale ${staleEvidenceIds.join(', ')}` : '';
  const summary = ready
    ? 'Required checkpoint evidence is fresh enough for the bounded retry.'
    : `Checkpoint retry is not ready: ${[missingText, staleText].filter(Boolean).join('; ')}.`;

  return {
    ready,
    status,
    checkedAt,
    satisfiedEvidenceIds: Array.from(new Set(satisfiedEvidenceIds)).slice(0, 8),
    missingEvidenceIds: Array.from(new Set(missingEvidenceIds)).slice(0, 8),
    staleEvidenceIds: Array.from(new Set(staleEvidenceIds)).slice(0, 8),
    nextEvidenceTools: Array.from(new Set(nextEvidenceTools)).slice(0, 8),
    summary,
  };
}

export function markComputerTaskCheckpointRecoveryObserved(
  previous: ComputerTaskStateCheckpointRecovery | null | undefined,
  recovery: ComputerTaskStateCheckpointRecovery | null | undefined,
  observations: ComputerTaskCheckpointEvidenceObservation[] = [],
  nowMs = Date.now(),
): ComputerTaskStateCheckpointRecovery | null {
  const compactRecovery = compactComputerTaskCheckpointRecovery(recovery || null);
  if (!compactRecovery) return null;
  const previousRecovery = compactComputerTaskCheckpointRecovery(previous || null);
  const approvalRequiredForRetry = compactRecovery.failedCheckpointId === 'approval-before-side-effect';
  const basePolicy = compactRecovery.retryPolicy || {
    failureFingerprint: [
      'checkpoint',
      compactRecovery.failedCheckpointId,
      compactRecovery.reason,
    ].filter(Boolean).join(':').slice(0, 180),
    repeatCount: 1,
    retryLimit: approvalRequiredForRetry ? 0 : 1,
    canRetry: !approvalRequiredForRetry,
    nextAction: compactRecovery.safeNextStep,
    stopReason: approvalRequiredForRetry
      ? 'Approval is required before retrying this checkpoint or any final side effect.'
      : null,
    requiredEvidence: [],
    forbiddenActions: [],
    resumeInstruction: compactRecovery.safeNextStep,
  };
  const sameFingerprint = Boolean(
    previousRecovery?.retryPolicy?.failureFingerprint
    && basePolicy.failureFingerprint
    && previousRecovery.retryPolicy.failureFingerprint === basePolicy.failureFingerprint,
  );
  const repeatCount = sameFingerprint
    ? Math.min(99, Math.max(1, previousRecovery?.retryPolicy?.repeatCount || 1) + 1)
    : Math.max(1, basePolicy.repeatCount || 1);
  const retryLimit = Math.max(0, basePolicy.retryLimit ?? (approvalRequiredForRetry ? 0 : 1));
  const approvalStop = approvalRequiredForRetry
    ? 'Approval is required before retrying this checkpoint or any final side effect.'
    : null;
  const repeatedStop = repeatCount > retryLimit
    ? 'The same checkpoint failure repeated; stop and ask for a new observation, route, or user action before retrying again.'
    : null;
  const stopReason = approvalStop || repeatedStop || basePolicy.stopReason || null;
  const canRetry = !stopReason && retryLimit > 0;
  const nextRecovery = {
    ...compactRecovery,
    retryPolicy: {
      failureFingerprint: basePolicy.failureFingerprint,
      repeatCount,
      retryLimit,
      canRetry,
      nextAction: canRetry ? (basePolicy.nextAction || compactRecovery.safeNextStep) : (stopReason || compactRecovery.safeNextStep),
      stopReason,
      requiredEvidence: basePolicy.requiredEvidence || [],
      forbiddenActions: basePolicy.forbiddenActions || [],
      resumeInstruction: basePolicy.resumeInstruction || compactRecovery.safeNextStep,
    },
  };
  const evidenceReadiness = evaluateComputerTaskCheckpointEvidenceReadiness({
    recovery: nextRecovery,
    observations,
    nowMs,
  });
  return {
    ...nextRecovery,
    retryPolicy: nextRecovery.retryPolicy
      ? {
          ...nextRecovery.retryPolicy,
          evidenceReadiness,
        }
      : null,
  };
}

// ─── Task checklist projection (D6) ─────────────────────────────────────────

export interface ComputerTaskChecklistNeedsYouItem {
  kind: 'question' | 'approval' | 'blocker';
  label: string;
  detail: string | null;
  /** Set for kind 'question' — the persisted pending-question id (D2). */
  questionId: string | null;
}

export interface ComputerTaskChecklistStage {
  id: string;
  ordinal: number;
  surface: string;
  goal: string;
  status: 'completed' | 'failed' | 'pending';
}

export interface ComputerTaskChecklistCard {
  title: string;
  phaseLabel: string;
  /** True when the task is still going or can be picked back up. */
  active: boolean;
  items: ComputerTaskStateStep[];
  /** D4 stage progress — empty for single-surface tasks. Statuses derive
   *  from stage-aware recovery (D4b): completed stages must not be redone,
   *  the failed stage is where resume starts. */
  stages: ComputerTaskChecklistStage[];
  /** E1 escalation breadcrumbs as compact display lines — ≤3, oldest first.
   *  Empty for tasks that never switched control surfaces. */
  surfaceChanges: string[];
  /** Everything waiting on the user, most actionable first. */
  needsYou: ComputerTaskChecklistNeedsYouItem[];
  /** Browser session is replayable — a fresh client can resume it. */
  resumable: boolean;
  liveUrl: string | null;
  updatedAt: string;
}

const PHASE_LABELS: Record<ComputerTaskPhase, string> = {
  planning: 'Planning',
  awaiting_approval: 'Waiting for your approval',
  awaiting_capability_approval: 'Waiting for buildout approval',
  building_capability: 'Building missing capability',
  executing: 'Working',
  completed: 'Done',
  failed: 'Failed',
  blocked: 'Blocked',
};

/**
 * Project the durable task record into the user-facing checklist card —
 * the "what is it doing / what does it need from me / can I resume it"
 * surface for chat and Office. Pure; safe for smoke tests and for
 * rendering after a reload (everything comes from the persisted record,
 * including D2 pending questions).
 */
export function buildComputerTaskChecklistCard(
  record: ComputerTaskStateRecord | null | undefined,
): ComputerTaskChecklistCard | null {
  if (!record || !record.id) return null;
  const needsYou: ComputerTaskChecklistNeedsYouItem[] = [];
  for (const question of listOpenComputerTaskQuestions(record)) {
    needsYou.push({
      kind: 'question',
      label: question.question,
      detail: question.options.length ? `Options: ${question.options.join(' / ')}` : question.context,
      questionId: question.id,
    });
  }
  if (record.phase === 'awaiting_approval' || record.phase === 'awaiting_capability_approval') {
    needsYou.push({
      kind: 'approval',
      label: PHASE_LABELS[record.phase],
      detail: record.capabilityBuildout?.message || record.accessPlan || null,
      questionId: null,
    });
  }
  for (const blocker of record.blockers.slice(0, 3)) {
    needsYou.push({ kind: 'blocker', label: blocker, detail: null, questionId: null });
  }
  const active = record.phase !== 'completed' && record.phase !== 'failed';

  // Stage progress (D4): completed/failed statuses come from stage-aware
  // recovery; a finished task marks every stage completed; otherwise
  // stages are pending until a failure pins them down (no live tracking yet).
  const completedStageIds = new Set(record.checkpointRecovery?.completedStageIds || []);
  const failedStageId = record.checkpointRecovery?.failedStageId || null;
  const stages: ComputerTaskChecklistStage[] = (record.complexity?.stages || []).map((stage) => ({
    id: stage.id,
    ordinal: stage.ordinal,
    surface: stage.surface,
    goal: stage.goal,
    status: record.phase === 'completed'
      ? 'completed'
      : completedStageIds.has(stage.id)
        ? 'completed'
        : stage.id === failedStageId
          ? 'failed'
          : 'pending',
  }));

  return {
    title: record.taskLabel || record.task.slice(0, 80) || 'Computer task',
    phaseLabel: PHASE_LABELS[record.phase] || String(record.phase),
    active,
    items: record.steps.slice(0, 8),
    stages,
    surfaceChanges: compactComputerTaskSurfaceEscalations(record.surfaceEscalations)
      .map(formatComputerTaskSurfaceEscalationLine),
    needsYou: needsYou.slice(0, 5),
    resumable: Boolean(record.sessionId) && record.phase !== 'completed',
    liveUrl: record.liveUrl || null,
    updatedAt: record.updatedAt,
  };
}

const CHECKLIST_GLYPHS: Record<ComputerTaskStepStatus, string> = {
  completed: '✓',
  active: '▸',
  pending: '○',
  blocked: '✕',
};

/** Compact chat/console rendering of the checklist card. */
export function formatComputerTaskChecklistCard(card: ComputerTaskChecklistCard | null): string {
  if (!card) return '';
  const lines: string[] = [`**${card.title}** — ${card.phaseLabel}`];
  for (const item of card.needsYou) {
    const prefix = item.kind === 'question' ? 'Needs your answer' : item.kind === 'approval' ? 'Needs your approval' : 'Blocked';
    lines.push(`⚑ ${prefix}: ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
  }
  for (const stage of card.stages) {
    const glyph = stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '✕' : '○';
    lines.push(`${glyph} Stage ${stage.ordinal} [${stage.surface.replace(/_/g, ' ')}]: ${stage.goal.slice(0, 80)}`);
  }
  // E1 escalation breadcrumbs — compact "surface changes" trail.
  for (const change of card.surfaceChanges) {
    lines.push(change);
  }
  // Step rows are redundant when stages carry the progress story.
  if (card.stages.length === 0) {
    for (const step of card.items) {
      lines.push(`${CHECKLIST_GLYPHS[step.status] || '○'} ${step.label}`);
    }
  }
  if (card.resumable && card.liveUrl) lines.push(`Resumable session: ${card.liveUrl}`);
  return lines.join('\n');
}

// ─── Action trace (L2 hybrid recipes) ───────────────────────────────────────

const ACTION_TRACE_LIMIT = 40;
const ACTION_TRACE_INPUT_KEYS_LIMIT = 12;
const ACTION_TRACE_STRING_LIMIT = 200;

/**
 * Normalize a persisted/incoming action trace: drop malformed steps, bound
 * tool names, keep only plain-object inputs with primitive values (strings
 * bounded ≤200), cap at 40 actions (first 40 kept — replay order matters).
 * Returns null when nothing usable remains, so old records without the
 * field stay persisted-compatible. Pure; smoke-testable.
 */
export function compactComputerTaskActionTrace(
  raw?: { v?: number; actions?: Array<Partial<ComputerTaskActionTraceStep>> | null } | null,
): ComputerTaskActionTrace | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.actions)) return null;
  const actions: ComputerTaskActionTraceStep[] = [];
  for (const step of raw.actions) {
    if (actions.length >= ACTION_TRACE_LIMIT) break;
    const tool = String(step?.tool || '').trim().slice(0, 80);
    if (!tool) continue;
    let input: Record<string, unknown> | null = null;
    if (step?.input && typeof step.input === 'object' && !Array.isArray(step.input)) {
      input = {};
      for (const [key, value] of Object.entries(step.input).slice(0, ACTION_TRACE_INPUT_KEYS_LIMIT)) {
        if (typeof value === 'string') input[key.slice(0, 60)] = value.slice(0, ACTION_TRACE_STRING_LIMIT);
        else if (typeof value === 'number' || typeof value === 'boolean' || value === null) input[key.slice(0, 60)] = value;
        // objects/arrays/functions dropped — traces stay flat and bounded.
      }
      if (Object.keys(input).length === 0) input = null;
    }
    actions.push({ tool, input });
  }
  return actions.length > 0 ? { v: 1, actions } : null;
}

/** Compact one-line `tool(key=value, …)` rendering, bounded ≤120 chars. */
function formatActionTraceStep(step: ComputerTaskActionTraceStep): string {
  const parts = step.input
    ? Object.entries(step.input).map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
    : [];
  const summary = parts.join(', ');
  const bounded = summary.length > 120 ? `${summary.slice(0, 119)}…` : summary;
  return `${step.tool}(${bounded})`;
}

interface DetectedRecipeParameter {
  placeholder: string;
  example: string;
}

/**
 * Heuristic parameter-slot detection over trace input values (verified
 * finding 1: parameterized procedures beat prose/raw traces). Task-specific-
 * looking values — URLs, file paths, ISO dates, name/query-like fields —
 * become `<param>` placeholders with the run's value as the example.
 */
function detectRecipeParameters(trace: ComputerTaskActionTrace): DetectedRecipeParameter[] {
  const found = new Map<string, string>();
  const add = (placeholder: string, example: string) => {
    if (!found.has(placeholder)) found.set(placeholder, example.slice(0, 120));
  };
  const NAME_KEYS = new Set(['name', 'filename', 'file_name', 'title', 'query', 'search', 'subject', 'project']);
  for (const step of trace.actions) {
    if (!step.input) continue;
    for (const [key, value] of Object.entries(step.input)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      if (/^https?:\/\//i.test(value)) {
        add('<url>', value);
      } else if (/^(~|\/|[A-Za-z]:[\\/])/.test(value) || (/[\\/]/.test(value) && /\.[a-z0-9]{1,5}$/i.test(value))) {
        add('<file_path>', value);
      } else if (NAME_KEYS.has(key.toLowerCase())) {
        add(`<${key.toLowerCase()}>`, value);
      }
      const date = value.match(/\b\d{4}-\d{2}-\d{2}\b/);
      if (date) add('<date>', date[0]);
    }
  }
  return Array.from(found.entries()).slice(0, 8).map(([placeholder, example]) => ({ placeholder, example }));
}

// ─── Task → recipe (D7 + L2 hybrid trace embedding) ─────────────────────────

export interface ComputerTaskRecipeDraft {
  name: string;
  description: string;
  tags: string[];
  /** Full SKILL.md content (agentskills.io frontmatter + body). */
  content: string;
}

function kebab(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Total recipe content budget — the trace is trimmed first to stay under. */
const RECIPE_CONTENT_LIMIT = 6000;

/**
 * Turn a COMPLETED task record into a reusable SKILL.md recipe draft (D7)
 * — "that worked, save it so I can run it again". Pure; the caller files
 * it through the HITL skill-write proposal path (`skillLibraryWrite`), so
 * a circle member still approves before anything lands in the library.
 * Returns null unless the task actually completed: failed runs make bad
 * recipes.
 *
 * L2 hybrid recipes: when an `actionTrace` is provided (explicitly, or via
 * `record.actionTrace`), the draft also embeds a `## Deterministic replay`
 * section (the verified tool steps from the source run, prefixed by the
 * recorded-steps-are-hypotheses rule — verified finding 3) and a
 * `## Parameters` section with detected parameter slots (finding 1:
 * parameterized procedures beat prose and raw traces). The procedural
 * sections stay — they are the adaptive fallback when replay mismatches.
 * Total content is bounded ~6k chars; the trace is trimmed first.
 */
export function buildComputerTaskRecipeDraft(
  record: ComputerTaskStateRecord | null | undefined,
  actionTrace?: { v: 1; actions: Array<{ tool: string; input?: Record<string, unknown> | null }> } | null,
): ComputerTaskRecipeDraft | null {
  if (!record || record.phase !== 'completed' || !record.task.trim()) return null;
  const label = record.taskLabel || record.task.slice(0, 60);
  const name = `recipe-${kebab(label)}` || 'recipe-computer-task';
  const description = `Reusable computer-task recipe: ${record.task.slice(0, 160)}`;
  const stages = record.complexity?.stages || [];
  const surfaceTags = Array.from(new Set(stages.map((stage) => stage.surface))).slice(0, 3);
  const tags = ['recipe', 'computer-task', record.taskKind, ...surfaceTags].filter(Boolean).slice(0, 6);

  const body: string[] = [
    `# ${label}`,
    '',
    '## Goal',
    record.task.slice(0, 500),
    '',
  ];
  if (stages.length >= 2) {
    body.push('## Stages (complete and verify each before the next)');
    for (const stage of stages) {
      body.push(`${stage.ordinal}. [${stage.surface.replace(/_/g, ' ')}] ${stage.goal}`);
    }
    body.push('');
    body.push('Hand off the exact artifacts produced (paths, filenames, URLs, ids) between stages.');
  } else if (record.steps.length > 0) {
    body.push('## Steps');
    for (const step of record.steps) body.push(`- ${step.label}`);
  }
  body.push('');
  body.push('## Rules');
  body.push('- Observe before acting; verify after each mutation.');
  body.push('- Pause for approval before any submit, publish, payment, upload, delete, or credential step.');
  body.push('- Finish with proof (screenshot, file stats, or page state) — never declare done without it.');

  const assemble = (extra: string[]): string => [
    '---',
    `name: ${name}`,
    `description: ${description.replace(/\n/g, ' ')}`,
    'version: 1.0.0',
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
    ...body,
    ...extra,
  ].join('\n');

  // L2: embed the verified trace as a deterministic-replay section with
  // parameter slots. Explicit argument wins; otherwise use the trace the
  // runtime persisted on the record. Compaction drops malformed/oversized
  // input, so a junk trace degrades to the plain procedural recipe.
  const trace = compactComputerTaskActionTrace(actionTrace !== undefined ? actionTrace : record.actionTrace);
  if (!trace) {
    return { name, description, tags, content: assemble([]) };
  }

  const parameters = detectRecipeParameters(trace);
  const buildTraceSection = (keepSteps: number): string[] => {
    const lines: string[] = [
      '',
      '## Deterministic replay (verified steps from the source run)',
      'Recorded steps are hypotheses from one successful run, not guarantees:',
      'verify the target still exists/enabled before each step; on mismatch stop',
      'replaying and follow the Procedure section above instead.',
      '',
    ];
    trace.actions.slice(0, keepSteps).forEach((step, index) => {
      lines.push(`${index + 1}. ${formatActionTraceStep(step)}`);
    });
    if (keepSteps < trace.actions.length) {
      lines.push(`… ${trace.actions.length - keepSteps} more steps trimmed to fit the recipe size budget — follow the Procedure section from here.`);
    }
    if (parameters.length > 0) {
      lines.push('');
      lines.push('## Parameters');
      lines.push('Substitute these slots when reusing the recipe — the examples are the values from the source run:');
      for (const param of parameters) {
        lines.push(`- ${param.placeholder} — example: ${param.example}`);
      }
    }
    return lines;
  };

  // Bound total content ~6k chars: trim trace steps first (procedural
  // sections and parameters are the durable knowledge; the trace is the
  // optimization).
  let keepSteps = trace.actions.length;
  let content = assemble(buildTraceSection(keepSteps));
  while (content.length > RECIPE_CONTENT_LIMIT && keepSteps > 0) {
    keepSteps -= 1;
    content = assemble(keepSteps === 0 ? [] : buildTraceSection(keepSteps));
  }

  return { name, description, tags, content };
}

export function buildComputerTaskStateSteps(args: {
  taskKind: string;
  phase: ComputerTaskPhase;
  capabilityBuildout?: ComputerTaskCapabilityBuildout | null;
  complexity?: ComputerTaskStateComplexity | null;
}): ComputerTaskStateStep[] {
  const plan = { id: 'plan', label: 'Plan task', status: 'completed' as ComputerTaskStepStatus };
  if (args.phase === 'planning') {
    plan.status = 'active';
  }

  const needsApproval = args.taskKind === 'browser_task';
  const approval = needsApproval
    ? {
        id: 'approval',
        label: 'Approve access',
        status: args.phase === 'awaiting_approval'
          ? 'active' as ComputerTaskStepStatus
          : args.phase === 'executing' || args.phase === 'completed'
            ? 'completed' as ComputerTaskStepStatus
            : 'pending' as ComputerTaskStepStatus,
      }
    : null;

  const capabilityBuildout = args.capabilityBuildout
    ? {
        id: 'capability_buildout',
        label: args.capabilityBuildout.status === 'approval_required'
          ? 'Approve app capability buildout'
          : 'Build missing app capability',
        status: args.phase === 'awaiting_capability_approval' || args.phase === 'building_capability'
          ? 'active' as ComputerTaskStepStatus
          : args.phase === 'completed' || args.phase === 'executing' || args.capabilityBuildout.status === 'ready_to_retry'
            ? 'completed' as ComputerTaskStepStatus
            : args.phase === 'failed' || args.phase === 'blocked'
              ? 'blocked' as ComputerTaskStepStatus
              : 'pending' as ComputerTaskStepStatus,
      }
    : null;

  const checkpoints = args.complexity
    ? {
        id: 'checkpoints',
        label: args.complexity.level === 'complex'
          ? 'Run complex checkpoints'
          : 'Use task checkpoints',
        status: args.phase === 'executing'
          ? 'active' as ComputerTaskStepStatus
          : args.phase === 'completed'
            ? 'completed' as ComputerTaskStepStatus
            : args.phase === 'failed' || args.phase === 'blocked'
              ? 'blocked' as ComputerTaskStepStatus
              : 'pending' as ComputerTaskStepStatus,
      }
    : null;

  const execute: ComputerTaskStateStep = {
    id: 'execute',
    label: args.taskKind === 'hybrid_task' ? 'Run staged computer workflow' : 'Execute task',
    status: args.phase === 'executing'
      ? 'active'
      : args.phase === 'completed'
        ? 'completed'
        : args.phase === 'failed' || args.phase === 'blocked'
          || args.phase === 'awaiting_capability_approval'
          || args.phase === 'building_capability'
          ? 'blocked'
          : 'pending',
  };

  const summarize: ComputerTaskStateStep = {
    id: 'summarize',
    label: 'Summarize result',
    status: args.phase === 'completed'
      ? 'completed'
      : args.phase === 'failed' || args.phase === 'blocked'
        ? 'blocked'
        : 'pending',
  };

  return [plan, ...(approval ? [approval] : []), ...(capabilityBuildout ? [capabilityBuildout] : []), ...(checkpoints ? [checkpoints] : []), execute, summarize];
}
