import { storage } from './storage';
import { safeGetUserForAccessToken } from './authSession';
import { normalizeComputerTaskOutcomeStatus } from './computerTaskOutcome';
import { compactExactPlanApprovalCorrelation } from './exactPlanApprovalContinuityCore';
import {
  acknowledgeComputerTaskNotifications,
  appendComputerTaskNotification,
  appendComputerTaskSurfaceEscalations,
  buildComputerTaskChecklistCard,
  buildComputerTaskStateSteps,
  compactComputerTaskActionTrace,
  compactComputerTaskCapabilityBuildout,
  compactComputerTaskCheckpointRecovery,
  compactComputerTaskCheckpointEvidenceReadiness,
  compactComputerTaskComplexityPlan,
  compactComputerTaskNotifications,
  compactComputerTaskPendingQuestions,
  compactComputerTaskSurfaceEscalations,
  computerTaskNotificationSnapshot,
  deriveComputerTaskNotification,
  evaluateComputerTaskCheckpointEvidenceReadiness,
  fireComputerTaskWebNotification,
  formatComputerTaskChecklistCard,
  listOpenComputerTaskQuestions,
  listUnacknowledgedComputerTaskNotifications,
  markComputerTaskCheckpointRecoveryObserved,
  resolveComputerTaskPendingQuestion,
  upsertComputerTaskPendingQuestion,
  COMPUTER_TASK_NOTIFICATION_GLYPHS,
  type ComputerTaskNotification,
  type ComputerTaskPendingQuestion,
  type ComputerTaskPhase,
  type ComputerTaskStateCheckpoint,
  type ComputerTaskStateCheckpointRecovery,
  type ComputerTaskStateRecord,
  type ComputerTaskStateStep,
  type ComputerTaskStepStatus,
  type ComputerTaskSurfaceEscalationBreadcrumb,
} from './computerTaskStateModel';

export {
  acknowledgeComputerTaskNotifications,
  appendComputerTaskNotification,
  appendComputerTaskSurfaceEscalations,
  buildComputerTaskChecklistCard,
  buildComputerTaskStateSteps,
  compactComputerTaskActionTrace,
  compactComputerTaskCapabilityBuildout,
  compactComputerTaskCheckpointRecovery,
  compactComputerTaskCheckpointEvidenceReadiness,
  compactComputerTaskComplexityPlan,
  compactComputerTaskNotifications,
  compactComputerTaskPendingQuestions,
  compactComputerTaskSurfaceEscalations,
  computerTaskNotificationSnapshot,
  deriveComputerTaskNotification,
  evaluateComputerTaskCheckpointEvidenceReadiness,
  fireComputerTaskWebNotification,
  formatComputerTaskChecklistCard,
  listOpenComputerTaskQuestions,
  listUnacknowledgedComputerTaskNotifications,
  markComputerTaskCheckpointRecoveryObserved,
  resolveComputerTaskPendingQuestion,
  upsertComputerTaskPendingQuestion,
  COMPUTER_TASK_NOTIFICATION_GLYPHS,
};

export type {
  ComputerTaskActionTrace,
  ComputerTaskActionTraceStep,
  ComputerTaskCapabilityBuildout,
  ComputerTaskCapabilityBuildoutStatus,
  ComputerTaskCheckpointEvidenceObservation,
  ComputerTaskCheckpointEvidenceReadiness,
  ComputerTaskChecklistCard,
  ComputerTaskChecklistNeedsYouItem,
  ComputerTaskChecklistStage,
  ComputerTaskNotification,
  ComputerTaskNotificationKind,
  ComputerTaskNotificationSnapshot,
  ComputerTaskPendingQuestion,
  ComputerTaskPhase,
  ComputerTaskStateCheckpoint,
  ComputerTaskStateCheckpointRecovery,
  ComputerTaskStateComplexity,
  ComputerTaskStateGrounding,
  ComputerTaskStateRecord,
  ComputerTaskStateStep,
  ComputerTaskStepStatus,
  ComputerTaskSurfaceEscalationBreadcrumb,
} from './computerTaskStateModel';

const STORAGE_PREFIX = 'computer_task_state_v1';
const EXACT_STORAGE_PREFIX = `${STORAGE_PREFIX}_exact_v2`;
const EXACT_STORAGE_SCHEMA_VERSION = 2;
const MAX_EXACT_SCOPE_PART_LENGTH = 240;
const MAX_EXACT_ACCESS_TOKEN_LENGTH = 16_384;

/**
 * Immutable account/circle authority for the private computer-task cache.
 * The bearer is used only to prove the captured user; it is never persisted
 * or included in a storage key.
 */
export type ComputerTaskStateExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type ComputerTaskStateAuthorityFence = (
  authority: ComputerTaskStateExactAuthority,
) => boolean;

export type ComputerTaskStateExactError =
  | 'invalid_authority'
  | 'authority_mismatch'
  | 'authority_retired'
  | 'record_mismatch'
  | 'storage_error';

export type ComputerTaskStateExactLoadResult = Readonly<{
  ok: boolean;
  record: ComputerTaskStateRecord | null;
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: ComputerTaskStateExactError;
}>;

export type ComputerTaskStateExactMutationResult = Readonly<{
  ok: boolean;
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: ComputerTaskStateExactError;
}>;

type ComputerTaskStateExactEnvelope = Readonly<{
  schemaVersion: typeof EXACT_STORAGE_SCHEMA_VERSION;
  userId: string;
  circleId: string;
  threadId: string | null;
  record: ComputerTaskStateRecord;
}>;

function normalizeExactScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_EXACT_SCOPE_PART_LENGTH) return null;
  return normalized;
}

function normalizeExactThreadId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return normalizeExactScopePart(value) || undefined;
}

function normalizeComputerTaskStateExactAuthority(
  input: ComputerTaskStateExactAuthority | null | undefined,
): ComputerTaskStateExactAuthority | null {
  const userId = normalizeExactScopePart(input?.userId);
  const circleId = normalizeExactScopePart(input?.circleId);
  const accessToken = typeof input?.accessToken === 'string' ? input.accessToken.trim() : '';
  const generation = input?.generation;
  if (
    !userId
    || !circleId
    || !accessToken
    || accessToken.length > MAX_EXACT_ACCESS_TOKEN_LENGTH
    || !Number.isSafeInteger(generation)
    || Number(generation) <= 0
  ) return null;
  return Object.freeze({
    userId,
    circleId,
    accessToken,
    generation: Number(generation),
  });
}

function computerTaskStateAuthorityIsCurrent(
  authority: ComputerTaskStateExactAuthority,
  fence: ComputerTaskStateAuthorityFence | null | undefined,
): boolean {
  if (!fence) return false;
  try {
    return fence(authority) === true;
  } catch {
    return false;
  }
}

async function resolveComputerTaskStateExactAuthority(
  input: ComputerTaskStateExactAuthority | null | undefined,
  fence: ComputerTaskStateAuthorityFence | null | undefined,
): Promise<
  | { ok: true; authority: ComputerTaskStateExactAuthority }
  | { ok: false; authority: ComputerTaskStateExactAuthority | null; error: ComputerTaskStateExactError }
> {
  const authority = normalizeComputerTaskStateExactAuthority(input);
  if (!authority) return { ok: false, authority: null, error: 'invalid_authority' };
  if (!computerTaskStateAuthorityIsCurrent(authority, fence)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (!computerTaskStateAuthorityIsCurrent(authority, fence)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  if (verifiedUser?.id !== authority.userId) {
    return { ok: false, authority, error: 'authority_mismatch' };
  }
  return { ok: true, authority };
}

/** Exact user/circle/thread key. Bearer material and generation never enter storage. */
export function computerTaskStateExactStorageKey(
  authorityInput: ComputerTaskStateExactAuthority | null | undefined,
  threadId?: string | null,
): string | null {
  const authority = normalizeComputerTaskStateExactAuthority(authorityInput);
  const normalizedThreadId = normalizeExactThreadId(threadId);
  if (!authority || normalizedThreadId === undefined) return null;
  return [
    EXACT_STORAGE_PREFIX,
    'user', encodeURIComponent(authority.userId),
    'circle', encodeURIComponent(authority.circleId),
    'thread', encodeURIComponent(normalizedThreadId || 'main'),
  ].join(':');
}

function storageKey(circleId: string, threadId?: string | null): string {
  return `${STORAGE_PREFIX}_${circleId}_${threadId || 'main'}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRecord(raw: string | null): ComputerTaskStateRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      id: String(parsed.id || ''),
      circleId: String(parsed.circleId || ''),
      threadId: parsed.threadId ? String(parsed.threadId) : null,
      requestIdentity: typeof parsed.requestIdentity === 'string'
        && parsed.requestIdentity.trim().length > 0
        && parsed.requestIdentity.trim().length <= 240
        && !/[\u0000-\u001f\u007f]/.test(parsed.requestIdentity)
        ? parsed.requestIdentity.trim()
        : null,
      exactPlanApproval: compactExactPlanApprovalCorrelation(parsed.exactPlanApproval),
      task: String(parsed.task || ''),
      taskKind: String(parsed.taskKind || 'unknown'),
      taskLabel: String(parsed.taskLabel || 'Computer task'),
      adapterId: parsed.adapterId ? String(parsed.adapterId) : null,
      phase: (parsed.phase || 'planning') as ComputerTaskPhase,
      currentStep: parsed.currentStep ? String(parsed.currentStep) : null,
      steps: Array.isArray(parsed.steps)
        ? parsed.steps.map((step: any) => ({
            id: String(step?.id || ''),
            label: String(step?.label || ''),
            status: (step?.status || 'pending') as ComputerTaskStepStatus,
          })).filter((step: ComputerTaskStateStep) => step.id && step.label)
        : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String).filter(Boolean) : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String).filter(Boolean) : [],
      grantedAccess: Array.isArray(parsed.grantedAccess) ? parsed.grantedAccess.map(String).filter(Boolean) : [],
      accessPlan: parsed.accessPlan ? String(parsed.accessPlan) : null,
      runId: parsed.runId ? String(parsed.runId) : null,
      sessionId: parsed.sessionId ? String(parsed.sessionId) : null,
      liveUrl: parsed.liveUrl ? String(parsed.liveUrl) : null,
      outcomeStatus: normalizeComputerTaskOutcomeStatus(parsed.outcomeStatus),
      grounding: parsed.grounding && typeof parsed.grounding === 'object'
        ? {
            status: String(parsed.grounding.status || ''),
            strategyId: parsed.grounding.strategyId ? String(parsed.grounding.strategyId) : null,
            strategyLabel: parsed.grounding.strategyLabel ? String(parsed.grounding.strategyLabel) : null,
            primarySurface: parsed.grounding.primarySurface ? String(parsed.grounding.primarySurface) : null,
            summary: parsed.grounding.summary ? String(parsed.grounding.summary) : null,
            nextAction: parsed.grounding.nextAction ? String(parsed.grounding.nextAction) : null,
            badges: Array.isArray(parsed.grounding.badges) ? parsed.grounding.badges.map(String).filter(Boolean).slice(0, 8) : [],
            blockers: Array.isArray(parsed.grounding.blockers) ? parsed.grounding.blockers.map(String).filter(Boolean).slice(0, 8) : [],
          }
        : null,
      capabilityBuildout: compactComputerTaskCapabilityBuildout(parsed.capabilityBuildout),
      complexity: parsed.complexity && typeof parsed.complexity === 'object'
        ? {
            level: String(parsed.complexity.level || ''),
            score: Number(parsed.complexity.score || 0),
            reasons: Array.isArray(parsed.complexity.reasons) ? parsed.complexity.reasons.map(String).filter(Boolean).slice(0, 6) : [],
            checkpoints: Array.isArray(parsed.complexity.checkpoints)
              ? parsed.complexity.checkpoints.map((checkpoint: any) => ({
                  id: String(checkpoint?.id || ''),
                  label: String(checkpoint?.label || ''),
                  surface: String(checkpoint?.surface || 'verification'),
                  requiresApproval: Boolean(checkpoint?.requiresApproval),
                })).filter((checkpoint: ComputerTaskStateCheckpoint) => checkpoint.id && checkpoint.label).slice(0, 8)
              : [],
            stages: Array.isArray(parsed.complexity.stages)
              ? parsed.complexity.stages.map((stage: any) => ({
                  id: String(stage?.id || '').slice(0, 60),
                  ordinal: Number(stage?.ordinal || 0),
                  surface: String(stage?.surface || '').slice(0, 30),
                  goal: String(stage?.goal || '').slice(0, 160),
                })).filter((stage: { id: string; goal: string }) => stage.id && stage.goal).slice(0, 4)
              : null,
          }
        : null,
      checkpointRecovery: compactComputerTaskCheckpointRecovery(
        parsed.checkpointRecovery && typeof parsed.checkpointRecovery === 'object'
          ? {
              level: String(parsed.checkpointRecovery.level || ''),
              complexityScore: Number(parsed.checkpointRecovery.complexityScore || 0),
              failedCheckpointId: String(parsed.checkpointRecovery.failedCheckpointId || ''),
              failedCheckpointLabel: String(parsed.checkpointRecovery.failedCheckpointLabel || ''),
              surface: String(parsed.checkpointRecovery.surface || 'unknown'),
              requiresApproval: Boolean(parsed.checkpointRecovery.requiresApproval),
              confidence: String(parsed.checkpointRecovery.confidence || 'low'),
              reason: String(parsed.checkpointRecovery.reason || ''),
              safeNextStep: String(parsed.checkpointRecovery.safeNextStep || ''),
              remainingCheckpointIds: Array.isArray(parsed.checkpointRecovery.remainingCheckpointIds)
                ? parsed.checkpointRecovery.remainingCheckpointIds.map(String).filter(Boolean)
                : [],
              failedStageId: parsed.checkpointRecovery.failedStageId ? String(parsed.checkpointRecovery.failedStageId) : null,
              completedStageIds: Array.isArray(parsed.checkpointRecovery.completedStageIds)
                ? parsed.checkpointRecovery.completedStageIds.map(String).filter(Boolean)
                : [],
              retryPolicy: parsed.checkpointRecovery.retryPolicy && typeof parsed.checkpointRecovery.retryPolicy === 'object'
                ? {
                    failureFingerprint: String(parsed.checkpointRecovery.retryPolicy.failureFingerprint || ''),
                    repeatCount: Number(parsed.checkpointRecovery.retryPolicy.repeatCount || 1),
                    retryLimit: Number(parsed.checkpointRecovery.retryPolicy.retryLimit || 0),
                    canRetry: Boolean(parsed.checkpointRecovery.retryPolicy.canRetry),
                    nextAction: String(parsed.checkpointRecovery.retryPolicy.nextAction || ''),
                    stopReason: parsed.checkpointRecovery.retryPolicy.stopReason ? String(parsed.checkpointRecovery.retryPolicy.stopReason) : null,
                    requiredEvidence: Array.isArray(parsed.checkpointRecovery.retryPolicy.requiredEvidence)
                      ? parsed.checkpointRecovery.retryPolicy.requiredEvidence.map((item: any) => ({
                          id: String(item?.id || ''),
                          tool: String(item?.tool || ''),
                          summary: String(item?.summary || ''),
                          freshnessMs: Number(item?.freshnessMs || 15_000),
                          required: item?.required !== false,
                        }))
                      : [],
                    forbiddenActions: Array.isArray(parsed.checkpointRecovery.retryPolicy.forbiddenActions)
                      ? parsed.checkpointRecovery.retryPolicy.forbiddenActions.map(String).filter(Boolean)
                      : [],
                    resumeInstruction: String(parsed.checkpointRecovery.retryPolicy.resumeInstruction || ''),
                    evidenceReadiness: parsed.checkpointRecovery.retryPolicy.evidenceReadiness && typeof parsed.checkpointRecovery.retryPolicy.evidenceReadiness === 'object'
                      ? {
                          ready: Boolean(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.ready),
                          status: String(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.status || 'missing') as any,
                          checkedAt: String(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.checkedAt || nowIso()),
                          satisfiedEvidenceIds: Array.isArray(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.satisfiedEvidenceIds)
                            ? parsed.checkpointRecovery.retryPolicy.evidenceReadiness.satisfiedEvidenceIds.map(String).filter(Boolean)
                            : [],
                          missingEvidenceIds: Array.isArray(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.missingEvidenceIds)
                            ? parsed.checkpointRecovery.retryPolicy.evidenceReadiness.missingEvidenceIds.map(String).filter(Boolean)
                            : [],
                          staleEvidenceIds: Array.isArray(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.staleEvidenceIds)
                            ? parsed.checkpointRecovery.retryPolicy.evidenceReadiness.staleEvidenceIds.map(String).filter(Boolean)
                            : [],
                          nextEvidenceTools: Array.isArray(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.nextEvidenceTools)
                            ? parsed.checkpointRecovery.retryPolicy.evidenceReadiness.nextEvidenceTools.map(String).filter(Boolean)
                            : [],
                          summary: String(parsed.checkpointRecovery.retryPolicy.evidenceReadiness.summary || ''),
                        }
                      : null,
                  }
                : null,
            } as ComputerTaskStateCheckpointRecovery
          : null,
      ),
      pendingQuestions: compactComputerTaskPendingQuestions(parsed.pendingQuestions),
      // D6 notifications: persisted-compatible — old records without the
      // field normalize to an empty list.
      notifications: compactComputerTaskNotifications(parsed.notifications),
      // E1 escalation breadcrumbs: same persisted-compat discipline (≤3).
      surfaceEscalations: compactComputerTaskSurfaceEscalations(parsed.surfaceEscalations),
      // L2 action trace: persisted-compatible — old records without the
      // field normalize to null; bounded ≤40 redacted actions.
      actionTrace: compactComputerTaskActionTrace(parsed.actionTrace),
      updatedAt: String(parsed.updatedAt || nowIso()),
    };
  } catch {
    return null;
  }
}

function normalizeExactEnvelope(
  raw: string | null,
  authority: ComputerTaskStateExactAuthority,
  threadId: string | null,
): ComputerTaskStateRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ComputerTaskStateExactEnvelope>;
    if (
      parsed?.schemaVersion !== EXACT_STORAGE_SCHEMA_VERSION
      || parsed.userId !== authority.userId
      || parsed.circleId !== authority.circleId
      || parsed.threadId !== threadId
      || !parsed.record
      || typeof parsed.record !== 'object'
    ) return null;
    const record = normalizeRecord(JSON.stringify(parsed.record));
    if (
      !record
      || record.circleId !== authority.circleId
      || record.threadId !== threadId
    ) return null;
    return record;
  } catch {
    return null;
  }
}

function prepareComputerTaskStateForStorage(
  record: ComputerTaskStateRecord,
  previous: ComputerTaskStateRecord | null,
): ComputerTaskStateRecord {
  const sameTask = !!previous && previous.task === record.task;
  const surfaceEscalations = record.surfaceEscalations === undefined
    ? sameTask ? previous?.surfaceEscalations || [] : []
    : record.surfaceEscalations;
  const actionTrace = record.actionTrace === undefined
    ? sameTask ? previous?.actionTrace || null : null
    : record.actionTrace;
  const requestIdentity = record.requestIdentity === undefined
    ? sameTask ? previous?.requestIdentity || null : null
    : record.requestIdentity;
  const boundedRequestIdentity = typeof requestIdentity === 'string'
    && requestIdentity.trim().length > 0
    && requestIdentity.trim().length <= 240
    && !/[\u0000-\u001f\u007f]/.test(requestIdentity)
    ? requestIdentity.trim()
    : null;
  return {
    ...record,
    requestIdentity: boundedRequestIdentity,
    exactPlanApproval: compactExactPlanApprovalCorrelation(record.exactPlanApproval),
    surfaceEscalations,
    actionTrace,
    capabilityBuildout: compactComputerTaskCapabilityBuildout(record.capabilityBuildout),
    outcomeStatus: normalizeComputerTaskOutcomeStatus(record.outcomeStatus),
    updatedAt: record.updatedAt || nowIso(),
  };
}

export async function loadComputerTaskState(circleId: string, threadId?: string | null): Promise<ComputerTaskStateRecord | null> {
  const record = normalizeRecord(await storage.getItem(storageKey(circleId, threadId)));
  if (!record) return null;
  return record.circleId === circleId && record.threadId === (threadId || null)
    ? record
    : null;
}

export async function saveComputerTaskState(record: ComputerTaskStateRecord): Promise<void> {
  // E1 breadcrumb carry-over: ChatTab's persist path rebuilds the record
  // from scratch on every phase transition and does not know about the
  // surfaceEscalations field (it stays `undefined` there). Like the D6
  // notification carry-over, the durable copy must survive those rewrites —
  // so when the caller did not provide the field, preserve what is already
  // stored for the SAME task (a new task text starts a clean trail).
  // L2 action trace gets the same carry-over treatment: rebuilt records
  // that don't know about the field must not wipe the persisted trace.
  // `outcomeStatus` deliberately does NOT carry over: omission on a new
  // planning/executing transition must clear a prior terminal result even
  // when the user reruns identical task text.
  let surfaceEscalations = record.surfaceEscalations;
  let actionTrace = record.actionTrace;
  let requestIdentity = record.requestIdentity;
  if (surfaceEscalations === undefined || actionTrace === undefined || requestIdentity === undefined) {
    let previous: ComputerTaskStateRecord | null = null;
    try {
      previous = normalizeRecord(await storage.getItem(storageKey(record.circleId, record.threadId)));
    } catch {}
    const sameTask = !!previous && previous.task === record.task;
    if (surfaceEscalations === undefined) {
      surfaceEscalations = sameTask ? previous?.surfaceEscalations || [] : [];
    }
    if (actionTrace === undefined) {
      actionTrace = sameTask ? previous?.actionTrace || null : null;
    }
    if (requestIdentity === undefined) {
      requestIdentity = sameTask ? previous?.requestIdentity || null : null;
    }
  }
  const boundedRequestIdentity = typeof requestIdentity === 'string'
    && requestIdentity.trim().length > 0
    && requestIdentity.trim().length <= 240
    && !/[\u0000-\u001f\u007f]/.test(requestIdentity)
    ? requestIdentity.trim()
    : null;
  await storage.setItem(storageKey(record.circleId, record.threadId), JSON.stringify({
    ...record,
    requestIdentity: boundedRequestIdentity,
    exactPlanApproval: compactExactPlanApprovalCorrelation(record.exactPlanApproval),
    surfaceEscalations,
    actionTrace,
    capabilityBuildout: compactComputerTaskCapabilityBuildout(record.capabilityBuildout),
    outcomeStatus: normalizeComputerTaskOutcomeStatus(record.outcomeStatus),
    updatedAt: record.updatedAt || nowIso(),
  }));
}

export async function clearComputerTaskState(circleId: string, threadId?: string | null): Promise<void> {
  await storage.removeItem(storageKey(circleId, threadId));
}

function exactLoadFailure(
  authority: ComputerTaskStateExactAuthority | null,
  error: ComputerTaskStateExactError,
): ComputerTaskStateExactLoadResult {
  return {
    ok: false,
    record: null,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function exactMutationFailure(
  authority: ComputerTaskStateExactAuthority | null,
  error: ComputerTaskStateExactError,
): ComputerTaskStateExactMutationResult {
  return {
    ok: false,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

/**
 * Read a computer-task checkpoint from one exact authenticated local lane.
 * A stale async read can never be returned after its owning UI generation is
 * retired, and an envelope from another account/circle/thread fails closed.
 */
export async function loadComputerTaskStateExact(
  authorityInput: ComputerTaskStateExactAuthority,
  threadId: string | null | undefined,
  isCurrent: ComputerTaskStateAuthorityFence,
): Promise<ComputerTaskStateExactLoadResult> {
  const resolved = await resolveComputerTaskStateExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactLoadFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedThreadId = normalizeExactThreadId(threadId);
  const key = computerTaskStateExactStorageKey(authority, threadId);
  if (normalizedThreadId === undefined || !key) return exactLoadFailure(authority, 'invalid_authority');
  try {
    const raw = await storage.getItem(key);
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactLoadFailure(authority, 'authority_retired');
    }
    const record = normalizeExactEnvelope(raw, authority, normalizedThreadId);
    return {
      ok: true,
      record,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactLoadFailure(authority, 'storage_error');
  }
}

/**
 * Save to one exact authenticated local lane and require a byte-identical
 * readback receipt. Legacy ownerless cache contents are never imported.
 */
export async function saveComputerTaskStateExact(
  record: ComputerTaskStateRecord,
  authorityInput: ComputerTaskStateExactAuthority,
  isCurrent: ComputerTaskStateAuthorityFence,
): Promise<ComputerTaskStateExactMutationResult> {
  const resolved = await resolveComputerTaskStateExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactMutationFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedThreadId = normalizeExactThreadId(record.threadId);
  const key = computerTaskStateExactStorageKey(authority, record.threadId);
  if (
    normalizedThreadId === undefined
    || !key
    || record.circleId !== authority.circleId
    || record.threadId !== normalizedThreadId
  ) return exactMutationFailure(authority, 'record_mismatch');

  try {
    const previousRaw = await storage.getItem(key);
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    const previous = normalizeExactEnvelope(previousRaw, authority, normalizedThreadId);
    const persistedRecord = prepareComputerTaskStateForStorage(record, previous);
    const envelope: ComputerTaskStateExactEnvelope = {
      schemaVersion: EXACT_STORAGE_SCHEMA_VERSION,
      userId: authority.userId,
      circleId: authority.circleId,
      threadId: normalizedThreadId,
      record: persistedRecord,
    };
    const serialized = JSON.stringify(envelope);
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    await storage.setItem(key, serialized);
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    const receipt = await storage.getItem(key);
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    if (receipt !== serialized) return exactMutationFailure(authority, 'storage_error');
    return {
      ok: true,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactMutationFailure(authority, 'storage_error');
  }
}

/** Remove only the captured user's exact circle/thread lane, with readback proof. */
export async function clearComputerTaskStateExact(
  authorityInput: ComputerTaskStateExactAuthority,
  threadId: string | null | undefined,
  isCurrent: ComputerTaskStateAuthorityFence,
): Promise<ComputerTaskStateExactMutationResult> {
  const resolved = await resolveComputerTaskStateExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactMutationFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedThreadId = normalizeExactThreadId(threadId);
  const key = computerTaskStateExactStorageKey(authority, threadId);
  if (normalizedThreadId === undefined || !key) return exactMutationFailure(authority, 'invalid_authority');
  try {
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    await storage.removeItem(key);
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    const receipt = await storage.getItem(key);
    if (!computerTaskStateAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    if (receipt !== null) return exactMutationFailure(authority, 'storage_error');
    return {
      ok: true,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactMutationFailure(authority, 'storage_error');
  }
}

/**
 * Persist a mid-task user question onto the durable record (D2). No-op
 * when no record exists yet — a question without a task to resume is not
 * actionable after reload anyway. Fire-and-forget safe: never throws.
 */
export async function recordComputerTaskPendingQuestion(
  circleId: string,
  threadId: string | null | undefined,
  question: ComputerTaskPendingQuestion,
): Promise<void> {
  try {
    const record = await loadComputerTaskState(circleId, threadId);
    if (!record) return;
    const next: ComputerTaskStateRecord = {
      ...record,
      pendingQuestions: upsertComputerTaskPendingQuestion(record.pendingQuestions, question),
      updatedAt: nowIso(),
    };
    // D6: a NEW open question is a needs-you transition — append the
    // notification so the walked-away user sees it on return.
    const notification = deriveComputerTaskNotification(next, computerTaskNotificationSnapshot(record));
    await saveComputerTaskState({
      ...next,
      notifications: appendComputerTaskNotification(record.notifications, notification),
    });
  } catch {}
}

/**
 * D6/D8: a bounded stop handed back partial progress — persist a
 * `partial_result` notification on the durable record so the user learns
 * what WAS done without opening the console. Fire-and-forget safe.
 */
export async function recordComputerTaskPartialResultNotification(
  circleId: string,
  threadId: string | null | undefined,
  args: { summary: string; runId?: string | null },
): Promise<void> {
  try {
    if (!args.summary?.trim()) return;
    const record = await loadComputerTaskState(circleId, threadId);
    if (!record) return;
    const notification = deriveComputerTaskNotification(
      { ...record, runId: args.runId || record.runId || null },
      computerTaskNotificationSnapshot(record),
      { partialResultSummary: args.summary },
    );
    if (!notification) return;
    await saveComputerTaskState({
      ...record,
      notifications: appendComputerTaskNotification(record.notifications, notification),
      updatedAt: nowIso(),
    });
  } catch {}
}

/**
 * D6: mark every persisted notification acknowledged (banner dismissed or
 * console opened). Returns the updated record so callers can refresh their
 * mount-loaded copy. Never throws.
 */
export async function acknowledgeComputerTaskNotificationsState(
  circleId: string,
  threadId?: string | null,
): Promise<ComputerTaskStateRecord | null> {
  try {
    const record = await loadComputerTaskState(circleId, threadId);
    if (!record) return null;
    if (!record.notifications?.some((item) => !item.acknowledged)) return record;
    const next = { ...acknowledgeComputerTaskNotifications(record), updatedAt: nowIso() };
    await saveComputerTaskState(next);
    return next;
  } catch {
    return null;
  }
}

/**
 * E1 follow-up: persist surface-escalation breadcrumbs from a runtime result
 * onto the durable record ("↳ switched to screenshot control: a11y tree
 * empty"). Merge is deduped and bounded ≤3 (oldest dropped) — same
 * discipline as D6 notifications. No-op when no record exists yet.
 * Fire-and-forget safe: never throws.
 */
export async function recordComputerTaskSurfaceEscalations(
  circleId: string,
  threadId: string | null | undefined,
  escalations: Array<Partial<ComputerTaskSurfaceEscalationBreadcrumb>> | null | undefined,
): Promise<void> {
  try {
    if (!escalations?.length) return;
    const record = await loadComputerTaskState(circleId, threadId);
    if (!record) return;
    await saveComputerTaskState({
      ...record,
      surfaceEscalations: appendComputerTaskSurfaceEscalations(record.surfaceEscalations, escalations),
      updatedAt: nowIso(),
    });
  } catch {}
}

/** Mark a persisted question answered (or expired when `answer` is null). Never throws. */
export async function resolveComputerTaskPendingQuestionState(
  circleId: string,
  threadId: string | null | undefined,
  questionId: string,
  answer: string | null,
): Promise<void> {
  try {
    const record = await loadComputerTaskState(circleId, threadId);
    if (!record?.pendingQuestions?.length) return;
    await saveComputerTaskState({
      ...record,
      pendingQuestions: resolveComputerTaskPendingQuestion(record.pendingQuestions, questionId, answer, nowIso()),
      updatedAt: nowIso(),
    });
  } catch {}
}
