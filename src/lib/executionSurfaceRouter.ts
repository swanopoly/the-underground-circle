import type { UserTaskPipelineDecision, UserTaskPipelineSummary } from './userTaskPipelines';
import { getScenarioPolicy, type ExecutionSurface, type ScenarioPolicy } from './scenarioPolicies';
import { classifyAgentFailure, type AgentFailureAssessment } from './agentFailureTaxonomy';

export type SurfaceReadinessValue = boolean | 'unknown';

export type ExecutionSurfaceReadiness = Partial<Record<ExecutionSurface, SurfaceReadinessValue>> & {
  integrationAvailable?: SurfaceReadinessValue;
  browserBridgeHealthy?: SurfaceReadinessValue;
  browserbaseAvailable?: SurfaceReadinessValue;
  desktopBridgeHealthy?: SurfaceReadinessValue;
  desktopAccessibilityReady?: SurfaceReadinessValue;
  desktopVisionReady?: SurfaceReadinessValue;
  terminalBridgeHealthy?: SurfaceReadinessValue;
  vaultGrantAvailable?: SurfaceReadinessValue;
  officeRuntimeAvailable?: SurfaceReadinessValue;
  memoryAvailable?: SurfaceReadinessValue;
  codeToolsAvailable?: SurfaceReadinessValue;
  humanAvailable?: SurfaceReadinessValue;
};

export type ExecutionSurfaceReadinessFinding = {
  surface: ExecutionSurface;
  status: 'ready' | 'unknown' | 'blocked';
  reason: string;
};

export type ExecutionSurfacePlan = {
  scenarioId: string;
  primarySurface: ExecutionSurface;
  fallbackSurfaces: ExecutionSurface[];
  status: 'ready' | 'needs_readiness_check' | 'blocked' | 'human_takeover_required';
  readinessFindings: ExecutionSurfaceReadinessFinding[];
  requiredApprovals: string[];
  stopConditions: string[];
  completionProof: string[];
  modelBudget: ScenarioPolicy['modelBudget'];
  credentialPolicy: ScenarioPolicy['credentialPolicy'];
  policy: ScenarioPolicy;
  failureAssessment?: AgentFailureAssessment | null;
};

function readinessForSurface(surface: ExecutionSurface, readiness: ExecutionSurfaceReadiness): SurfaceReadinessValue {
  if (readiness[surface] !== undefined) return readiness[surface];
  switch (surface) {
    case 'integration_api':
      return readiness.integrationAvailable ?? 'unknown';
    case 'browser_semantic':
      return readiness.browserBridgeHealthy ?? 'unknown';
    case 'browser_stagehand':
    case 'browser_remote':
      return readiness.browserbaseAvailable ?? readiness.browserBridgeHealthy ?? 'unknown';
    case 'desktop_bridge':
      return readiness.desktopBridgeHealthy ?? 'unknown';
    case 'desktop_a11y':
      return readiness.desktopAccessibilityReady ?? readiness.desktopBridgeHealthy ?? 'unknown';
    case 'desktop_vision':
      return readiness.desktopVisionReady ?? readiness.desktopBridgeHealthy ?? 'unknown';
    case 'terminal_bridge':
      return readiness.terminalBridgeHealthy ?? 'unknown';
    case 'vault':
      return readiness.vaultGrantAvailable ?? 'unknown';
    case 'office':
      return readiness.officeRuntimeAvailable ?? 'unknown';
    case 'memory':
      return readiness.memoryAvailable ?? 'unknown';
    case 'code_tools':
      return readiness.codeToolsAvailable ?? 'unknown';
    case 'human_takeover':
      return readiness.humanAvailable ?? 'unknown';
    case 'model_only':
    default:
      return readiness[surface] ?? true;
  }
}

function findingForSurface(surface: ExecutionSurface, readiness: ExecutionSurfaceReadiness): ExecutionSurfaceReadinessFinding {
  const value = readinessForSurface(surface, readiness);
  if (value === true) {
    return { surface, status: 'ready', reason: `${surface} is available.` };
  }
  if (value === false) {
    return { surface, status: 'blocked', reason: `${surface} is not available for this run.` };
  }
  return { surface, status: 'unknown', reason: `${surface} needs a readiness check before execution.` };
}

function buildRequiredApprovals(policy: ScenarioPolicy): string[] {
  const approvals = [...policy.approvalTriggers];
  if (policy.credentialPolicy.mode === 'required' || policy.credentialPolicy.vaultGrantRequired) {
    approvals.push('Scoped vault credential grant.');
  }
  if (policy.modelBudget.allowComputerUseModel) {
    approvals.push('Vision/computer-use model escalation if semantic tools fail.');
  }
  return Array.from(new Set(approvals.filter(Boolean)));
}

function buildStopConditions(policy: ScenarioPolicy): string[] {
  const stops = [
    ...policy.blockedActions.map((action) => `Stop before ${action.replace(/_/g, ' ')}.`),
  ];
  if (policy.credentialPolicy.rawSecretExposureAllowed === false) {
    stops.push('Stop if raw secrets would be shown to a model, chat message, log, or screenshot.');
  }
  if (policy.credentialPolicy.allowedOriginsRequired) {
    stops.push('Stop if the target origin does not match the scoped credential grant.');
  }
  return Array.from(new Set(stops));
}

function choosePrimarySurface(
  policy: ScenarioPolicy,
  findings: ExecutionSurfaceReadinessFinding[],
): ExecutionSurface {
  const ready = findings.find((finding) => finding.status === 'ready');
  if (ready) return ready.surface;
  const unknown = findings.find((finding) => finding.status === 'unknown');
  if (unknown) return unknown.surface;
  return policy.preferredSurfaceOrder[0] || policy.allowedSurfaces[0] || 'model_only';
}

function buildStatus(
  primary: ExecutionSurface,
  findings: ExecutionSurfaceReadinessFinding[],
  failureAssessment?: AgentFailureAssessment | null,
): ExecutionSurfacePlan['status'] {
  if (failureAssessment?.userActionRequired && failureAssessment.surface === 'human_takeover') return 'human_takeover_required';
  if (failureAssessment && failureAssessment.failureClass !== 'unknown') return 'blocked';
  const primaryFinding = findings.find((finding) => finding.surface === primary);
  if (primaryFinding?.status === 'ready') return 'ready';
  if (primaryFinding?.status === 'blocked') return 'blocked';
  return 'needs_readiness_check';
}

export function buildExecutionSurfacePlan(input: {
  message: string;
  pipeline?: UserTaskPipelineSummary | null;
  pipelineDecision?: UserTaskPipelineDecision | null;
  readiness?: ExecutionSurfaceReadiness;
  failureInput?: unknown;
}): ExecutionSurfacePlan | null {
  const pipeline = input.pipeline || input.pipelineDecision?.primary || null;
  if (!pipeline) return null;
  const policy = getScenarioPolicy(pipeline);
  const readiness = input.readiness || {};
  const findings = policy.preferredSurfaceOrder.map((surface) => findingForSurface(surface, readiness));
  const failureAssessment = input.failureInput ? classifyAgentFailure(input.failureInput) : null;
  const primarySurface = choosePrimarySurface(policy, findings);
  return {
    scenarioId: policy.id,
    primarySurface,
    fallbackSurfaces: policy.preferredSurfaceOrder.filter((surface) => surface !== primarySurface),
    status: buildStatus(primarySurface, findings, failureAssessment),
    readinessFindings: findings,
    requiredApprovals: buildRequiredApprovals(policy),
    stopConditions: buildStopConditions(policy),
    completionProof: policy.completionProof,
    modelBudget: policy.modelBudget,
    credentialPolicy: policy.credentialPolicy,
    policy,
    failureAssessment,
  };
}

export function summarizeExecutionSurfacePlan(plan: ExecutionSurfacePlan | null): string {
  if (!plan) return 'No execution surface plan.';
  return [
    `${plan.scenarioId}: ${plan.status}`,
    `primary=${plan.primarySurface}`,
    `fallbacks=${plan.fallbackSurfaces.join('>') || 'none'}`,
    `budget=$${plan.modelBudget.maxUsd.toFixed(2)}/${plan.modelBudget.maxSteps} steps`,
  ].join(' ');
}
