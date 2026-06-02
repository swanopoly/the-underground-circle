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
  updatedAt: string;
}

export function compactComputerTaskComplexityPlan(plan?: ComputerTaskComplexityPlan | null): ComputerTaskStateComplexity | null {
  if (!plan || plan.level === 'simple') return null;
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
