import type { TaskCapabilityProfileKey } from './taskCapabilityProfiles';
import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import { buildComputerTaskDispatchPrefix } from './computerTaskDispatch';
import { buildComputerTaskGrantPlan, type ComputerTaskGrantPlan } from './computerTaskGrants';
import {
  planComputerTaskPreview,
  summarizeComputerTaskCapabilityReadiness,
  type ComputerTaskPlanPreview,
} from './computerTaskPlanner';

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
}): ComputerTaskExecutionEnvelope {
  const preview = planComputerTaskPreview(args.task);
  const readiness = summarizeComputerTaskCapabilityReadiness(preview, args.audit);
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
    }),
    recommendedMode: resolveMode(preview.kind),
    capabilityProfile: resolveCapabilityProfile(preview.kind),
    entrypoint: preview.kind === 'browser_task' ? 'browser_runtime' : 'agent_runtime',
    grants,
  };
}
