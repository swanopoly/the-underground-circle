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
  updatedAt: string;
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
  // Step rows are redundant when stages carry the progress story.
  if (card.stages.length === 0) {
    for (const step of card.items) {
      lines.push(`${CHECKLIST_GLYPHS[step.status] || '○'} ${step.label}`);
    }
  }
  if (card.resumable && card.liveUrl) lines.push(`Resumable session: ${card.liveUrl}`);
  return lines.join('\n');
}

// ─── Task → recipe (D7) ─────────────────────────────────────────────────────

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

/**
 * Turn a COMPLETED task record into a reusable SKILL.md recipe draft (D7)
 * — "that worked, save it so I can run it again". Pure; the caller files
 * it through the HITL skill-write proposal path (`skillLibraryWrite`), so
 * a circle member still approves before anything lands in the library.
 * Returns null unless the task actually completed: failed runs make bad
 * recipes.
 */
export function buildComputerTaskRecipeDraft(
  record: ComputerTaskStateRecord | null | undefined,
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

  const content = [
    '---',
    `name: ${name}`,
    `description: ${description.replace(/\n/g, ' ')}`,
    'version: 1.0.0',
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
    ...body,
  ].join('\n');

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
