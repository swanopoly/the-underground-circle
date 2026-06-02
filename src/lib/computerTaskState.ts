import { storage } from './storage';
import {
  buildComputerTaskStateSteps,
  compactComputerTaskCheckpointRecovery,
  compactComputerTaskCheckpointEvidenceReadiness,
  compactComputerTaskComplexityPlan,
  evaluateComputerTaskCheckpointEvidenceReadiness,
  markComputerTaskCheckpointRecoveryObserved,
  type ComputerTaskCapabilityBuildout,
  type ComputerTaskCapabilityBuildoutStatus,
  type ComputerTaskPhase,
  type ComputerTaskStateCheckpoint,
  type ComputerTaskStateCheckpointRecovery,
  type ComputerTaskStateRecord,
  type ComputerTaskStateStep,
  type ComputerTaskStepStatus,
} from './computerTaskStateModel';

export {
  buildComputerTaskStateSteps,
  compactComputerTaskCheckpointRecovery,
  compactComputerTaskCheckpointEvidenceReadiness,
  compactComputerTaskComplexityPlan,
  evaluateComputerTaskCheckpointEvidenceReadiness,
  markComputerTaskCheckpointRecoveryObserved,
};

export type {
  ComputerTaskCapabilityBuildout,
  ComputerTaskCapabilityBuildoutStatus,
  ComputerTaskCheckpointEvidenceObservation,
  ComputerTaskCheckpointEvidenceReadiness,
  ComputerTaskPhase,
  ComputerTaskStateCheckpoint,
  ComputerTaskStateCheckpointRecovery,
  ComputerTaskStateComplexity,
  ComputerTaskStateGrounding,
  ComputerTaskStateRecord,
  ComputerTaskStateStep,
  ComputerTaskStepStatus,
} from './computerTaskStateModel';

const STORAGE_PREFIX = 'computer_task_state_v1';

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
      capabilityBuildout: parsed.capabilityBuildout && typeof parsed.capabilityBuildout === 'object'
        ? {
            status: (parsed.capabilityBuildout.status || 'requested') as ComputerTaskCapabilityBuildoutStatus,
            message: String(parsed.capabilityBuildout.message || ''),
            appName: parsed.capabilityBuildout.appName ? String(parsed.capabilityBuildout.appName) : null,
            buildoutKind: parsed.capabilityBuildout.buildoutKind ? String(parsed.capabilityBuildout.buildoutKind) : null,
            risk: parsed.capabilityBuildout.risk ? String(parsed.capabilityBuildout.risk) : null,
            sessionId: parsed.capabilityBuildout.sessionId ? String(parsed.capabilityBuildout.sessionId) : null,
            launched: typeof parsed.capabilityBuildout.launched === 'boolean' ? parsed.capabilityBuildout.launched : null,
            approvalId: parsed.capabilityBuildout.approvalId ? String(parsed.capabilityBuildout.approvalId) : null,
            retryPlan: parsed.capabilityBuildout.retryPlan ? String(parsed.capabilityBuildout.retryPlan) : null,
            summary: parsed.capabilityBuildout.summary ? String(parsed.capabilityBuildout.summary) : null,
            controlSurface: parsed.capabilityBuildout.controlSurface ? String(parsed.capabilityBuildout.controlSurface) : null,
            sourceRefs: Array.isArray(parsed.capabilityBuildout.sourceRefs) ? parsed.capabilityBuildout.sourceRefs.map(String).filter(Boolean).slice(0, 12) : [],
            filesChanged: Array.isArray(parsed.capabilityBuildout.filesChanged) ? parsed.capabilityBuildout.filesChanged.map(String).filter(Boolean).slice(0, 40) : [],
            verification: parsed.capabilityBuildout.verification ? String(parsed.capabilityBuildout.verification) : null,
            userActionNeeded: parsed.capabilityBuildout.userActionNeeded ? String(parsed.capabilityBuildout.userActionNeeded) : null,
            missingEvidence: Array.isArray(parsed.capabilityBuildout.missingEvidence) ? parsed.capabilityBuildout.missingEvidence.map(String).filter(Boolean).slice(0, 8) : [],
            autoRetryStatus: parsed.capabilityBuildout.autoRetryStatus ? String(parsed.capabilityBuildout.autoRetryStatus) as ComputerTaskCapabilityBuildout['autoRetryStatus'] : null,
            autoRetryAttemptedAt: parsed.capabilityBuildout.autoRetryAttemptedAt ? String(parsed.capabilityBuildout.autoRetryAttemptedAt) : null,
            autoRetryCompletedAt: parsed.capabilityBuildout.autoRetryCompletedAt ? String(parsed.capabilityBuildout.autoRetryCompletedAt) : null,
            autoRetryRunId: parsed.capabilityBuildout.autoRetryRunId ? String(parsed.capabilityBuildout.autoRetryRunId) : null,
            updatedAt: String(parsed.capabilityBuildout.updatedAt || nowIso()),
          }
        : null,
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
      updatedAt: String(parsed.updatedAt || nowIso()),
    };
  } catch {
    return null;
  }
}

export async function loadComputerTaskState(circleId: string, threadId?: string | null): Promise<ComputerTaskStateRecord | null> {
  return normalizeRecord(await storage.getItem(storageKey(circleId, threadId)));
}

export async function saveComputerTaskState(record: ComputerTaskStateRecord): Promise<void> {
  await storage.setItem(storageKey(record.circleId, record.threadId), JSON.stringify({
    ...record,
    updatedAt: record.updatedAt || nowIso(),
  }));
}

export async function clearComputerTaskState(circleId: string, threadId?: string | null): Promise<void> {
  await storage.removeItem(storageKey(circleId, threadId));
}
