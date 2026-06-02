import type { ExecutionSurfacePlan } from './executionSurfaceRouter';
import type { ScenarioPolicy } from './scenarioPolicies';
import type { UserTaskPipelineDecision, UserTaskPipelineSummary } from './userTaskPipelines';

export type AgentRunLedgerActor = 'user' | 'swanbot' | 'openswan' | 'tool' | 'terminal_agent' | 'human';

export type AgentRunLedgerEventType =
  | 'planned'
  | 'tool_started'
  | 'tool_finished'
  | 'approval_requested'
  | 'approval_resolved'
  | 'blocked'
  | 'verified'
  | 'completed'
  | 'failed';

export type AgentRunLedgerStatus = 'planned' | 'running' | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled';

export type AgentRunLedgerEvent = {
  runId: string;
  circleId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  scenarioId: string;
  actor: AgentRunLedgerActor;
  eventType: AgentRunLedgerEventType;
  toolName?: string | null;
  risk: ScenarioPolicy['risk'];
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type AgentRunLedgerBudget = {
  maxUsd: number;
  maxSteps: number;
  routerModelTier: ScenarioPolicy['modelBudget']['routerModelTier'];
  plannerModelTier: ScenarioPolicy['modelBudget']['plannerModelTier'];
  executorModelTier: ScenarioPolicy['modelBudget']['executorModelTier'];
  preferCheapModels: boolean;
  allowComputerUseModel: boolean;
};

export type AgentRunLedgerPreview = {
  runId: string;
  status: AgentRunLedgerStatus;
  scenarioId: string;
  risk: ScenarioPolicy['risk'];
  primarySurface?: string | null;
  budget: AgentRunLedgerBudget;
  approvalsRequired: string[];
  persistenceTargets: string[];
  events: AgentRunLedgerEvent[];
};

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildAgentRunId(input: {
  scenarioId: string;
  message: string;
  sessionId?: string | null;
  createdAt?: string;
}): string {
  const seed = [input.scenarioId, input.sessionId || 'session', input.message.slice(0, 500), input.createdAt || 'preview'].join('|');
  return `run_${stableHash(seed)}`;
}

function event(input: {
  runId: string;
  scenarioId: string;
  risk: ScenarioPolicy['risk'];
  actor: AgentRunLedgerActor;
  eventType: AgentRunLedgerEventType;
  createdAt: string;
  messageId?: string | null;
  sessionId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}): AgentRunLedgerEvent {
  return {
    runId: input.runId,
    circleId: input.circleId ?? null,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    messageId: input.messageId ?? null,
    scenarioId: input.scenarioId,
    actor: input.actor,
    eventType: input.eventType,
    risk: input.risk,
    metadata: input.metadata,
    createdAt: input.createdAt,
  };
}

export function buildAgentRunLedgerPreview(input: {
  message: string;
  pipeline?: UserTaskPipelineSummary | null;
  pipelineDecision?: UserTaskPipelineDecision | null;
  surfacePlan?: ExecutionSurfacePlan | null;
  runId?: string;
  sessionId?: string | null;
  messageId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  createdAt?: string;
}): AgentRunLedgerPreview | null {
  const pipeline = input.pipeline || input.pipelineDecision?.primary || null;
  const surfacePlan = input.surfacePlan || null;
  if (!pipeline || !surfacePlan) return null;
  const policy = surfacePlan.policy;

  const createdAt = input.createdAt || new Date().toISOString();
  const runId = input.runId || buildAgentRunId({
    scenarioId: pipeline.id,
    message: input.message,
    sessionId: input.sessionId,
    createdAt,
  });
  const status: AgentRunLedgerStatus = surfacePlan?.status === 'blocked'
    ? 'blocked'
    : surfacePlan?.status === 'human_takeover_required'
      ? 'paused'
      : 'planned';
  const events: AgentRunLedgerEvent[] = [
    event({
      runId,
      scenarioId: pipeline.id,
      risk: policy.risk,
      actor: 'swanbot',
      eventType: 'planned',
      createdAt,
      sessionId: input.sessionId,
      messageId: input.messageId,
      circleId: input.circleId,
      userId: input.userId,
      metadata: {
        pipeline,
        surfacePlan: {
          status: surfacePlan.status,
          primarySurface: surfacePlan.primarySurface,
          fallbackSurfaces: surfacePlan.fallbackSurfaces,
          requiredApprovals: surfacePlan.requiredApprovals,
        },
      },
    }),
  ];

  if (surfacePlan.requiredApprovals.length > 0) {
    events.push(event({
      runId,
      scenarioId: pipeline.id,
      risk: policy.risk,
      actor: 'openswan',
      eventType: 'approval_requested',
      createdAt,
      sessionId: input.sessionId,
      messageId: input.messageId,
      circleId: input.circleId,
      userId: input.userId,
      metadata: { approvals: surfacePlan.requiredApprovals },
    }));
  }

  if (surfacePlan.failureAssessment) {
    events.push(event({
      runId,
      scenarioId: pipeline.id,
      risk: policy.risk,
      actor: 'tool',
      eventType: surfacePlan.failureAssessment.severity === 'critical' ? 'failed' : 'blocked',
      createdAt,
      sessionId: input.sessionId,
      messageId: input.messageId,
      circleId: input.circleId,
      userId: input.userId,
      metadata: { failureAssessment: surfacePlan.failureAssessment },
    }));
  }

  return {
    runId,
    status,
    scenarioId: pipeline.id,
    risk: policy.risk,
    primarySurface: surfacePlan.primarySurface,
    budget: {
      maxUsd: policy.modelBudget.maxUsd,
      maxSteps: policy.modelBudget.maxSteps,
      routerModelTier: policy.modelBudget.routerModelTier,
      plannerModelTier: policy.modelBudget.plannerModelTier,
      executorModelTier: policy.modelBudget.executorModelTier,
      preferCheapModels: policy.modelBudget.preferCheapModels,
      allowComputerUseModel: policy.modelBudget.allowComputerUseModel,
    },
    approvalsRequired: surfacePlan.requiredApprovals,
    persistenceTargets: policy.persistenceTargets,
    events,
  };
}

export function summarizeAgentRunLedgerPreview(preview: AgentRunLedgerPreview | null): string {
  if (!preview) return 'No run ledger preview.';
  return [
    `${preview.runId}: ${preview.status}`,
    `scenario=${preview.scenarioId}`,
    `surface=${preview.primarySurface || 'unknown'}`,
    `budget=$${preview.budget.maxUsd.toFixed(2)}/${preview.budget.maxSteps} steps`,
    `events=${preview.events.length}`,
  ].join(' ');
}
