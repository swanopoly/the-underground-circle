import type { TaskCapabilityProfileKey } from './taskCapabilityProfiles';
import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import {
  buildComputerAppPreflight,
  type ComputerAppPreflight,
} from './computerAppPreflight';
import {
  buildComputerAppGroundingPlan,
  buildComputerAppGroundingRunbook,
  buildComputerAppGroundingTrace,
  recommendComputerAppGroundingNextStep,
  type ComputerAppGroundingNextStep,
  type ComputerAppGroundingPlan,
  type ComputerAppGroundingRunbook,
  type ComputerAppGroundingTrace,
} from './computerAppGrounding';
import { buildComputerTaskDispatchPrefix } from './computerTaskDispatch';
import {
  buildComputerTaskComplexityPlan,
  type ComputerTaskComplexityPlan,
} from './computerTaskComplexityPlan';
import { buildComputerTaskGrantPlan, type ComputerTaskGrantPlan } from './computerTaskGrants';
import {
  planComputerTaskPreview,
  summarizeComputerTaskCapabilityReadiness,
  type ComputerTaskPlanPreview,
} from './computerTaskPlanner';
import type { BusinessModelTaskPlan } from './businessModelProfileCore';

export interface ComputerTaskExecutionEnvelope {
  preview: ComputerTaskPlanPreview;
  readiness: {
    ready: boolean;
    missing: string[];
    summary: string;
  };
  dispatchPrefix: string;
  recommendedMode: 'research' | 'execute' | 'plan';
  capabilityProfile: TaskCapabilityProfileKey;
  entrypoint: 'browser_runtime' | 'agent_runtime';
  grants: ComputerTaskGrantPlan;
  preflight: ComputerAppPreflight;
  computerAppGrounding: ComputerAppGroundingPlan | null;
  computerAppGroundingRunbook: ComputerAppGroundingRunbook | null;
  computerAppGroundingNextStep: ComputerAppGroundingNextStep | null;
  computerAppGroundingTrace: ComputerAppGroundingTrace | null;
  complexityPlan: ComputerTaskComplexityPlan;
  businessModelPlan?: BusinessModelTaskPlan | null;
}

function resolveCapabilityProfile(kind: ComputerTaskPlanPreview['kind']): TaskCapabilityProfileKey {
  switch (kind) {
    case 'browser_task':
      return 'browser_qa';
    case 'hybrid_task':
      return 'computer_hybrid';
    case 'app_task':
      return 'computer_apps';
    case 'file_task':
      return 'computer_files';
    default:
      return 'research_basic';
  }
}

function resolveMode(kind: ComputerTaskPlanPreview['kind']): ComputerTaskExecutionEnvelope['recommendedMode'] {
  switch (kind) {
    case 'browser_task':
      return 'execute';
    case 'app_task':
      return 'execute';
    case 'hybrid_task':
      return 'plan';
    case 'file_task':
      return 'research';
    default:
      return 'research';
  }
}

export function prepareComputerTaskExecution(args: {
  task: string;
  audit: ComputerCapabilityAudit | null;
  grantedIds?: import('./computerTaskGrants').ComputerTaskGrantId[];
  businessModelPlan?: BusinessModelTaskPlan | null;
}): ComputerTaskExecutionEnvelope {
  const preview = planComputerTaskPreview(args.task);
  const readiness = summarizeComputerTaskCapabilityReadiness(preview, args.audit);
  const preflight = buildComputerAppPreflight({ task: args.task, audit: args.audit });
  const computerAppGrounding = buildComputerAppGroundingPlan(args.task);
  const computerAppGroundingRunbook = buildComputerAppGroundingRunbook(args.task);
  const computerAppGroundingNextStep = recommendComputerAppGroundingNextStep({
    plan: computerAppGrounding,
    observations: [],
  });
  const computerAppGroundingTrace = buildComputerAppGroundingTrace({
    plan: computerAppGrounding,
    observations: [],
    actions: [],
  });
  const complexityPlan = buildComputerTaskComplexityPlan({
    task: args.task,
    preview,
  });
  const grants = buildComputerTaskGrantPlan({
    task: args.task,
    preview,
    audit: args.audit,
    grantedIds: args.grantedIds,
  });

  return {
    preview,
    readiness,
    dispatchPrefix: buildComputerTaskDispatchPrefix({
      task: args.task,
      preview,
      readiness,
      audit: args.audit,
      grants,
      preflight,
      computerAppGrounding,
      computerAppGroundingRunbook,
      computerAppGroundingNextStep,
      computerAppGroundingTrace,
      complexityPlan,
      businessModelPlan: args.businessModelPlan,
    }),
    recommendedMode: resolveMode(preview.kind),
    capabilityProfile: resolveCapabilityProfile(preview.kind),
    entrypoint: preview.kind === 'browser_task' ? 'browser_runtime' : 'agent_runtime',
    grants,
    preflight,
    computerAppGrounding,
    computerAppGroundingRunbook,
    computerAppGroundingNextStep,
    computerAppGroundingTrace,
    complexityPlan,
    businessModelPlan: args.businessModelPlan,
  };
}
