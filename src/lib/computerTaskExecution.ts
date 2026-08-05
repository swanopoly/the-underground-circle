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
  validateComputerTaskStageSurfaces,
  type ComputerTaskComplexityPlan,
  type ComputerTaskStagePreflightBlocker,
} from './computerTaskComplexityPlan';
import { buildComputerTaskGrantPlan, type ComputerTaskGrantPlan } from './computerTaskGrants';
import {
  planComputerTaskPreview,
  summarizeComputerTaskCapabilityReadiness,
  type ComputerTaskPlanPreview,
} from './computerTaskPlanner';
import type { BusinessModelTaskPlan } from './businessModelProfileCore';
import {
  buildComputerTaskActivationPlan,
  formatComputerTaskActivationBlock,
  type ComputerTaskActivationPlan,
} from './computerTaskActivation';

export interface ComputerTaskExecutionEnvelope {
  preview: ComputerTaskPlanPreview;
  readiness: {
    ready: boolean;
    missing: string[];
    summary: string;
  };
  dispatchPrefix: string;
  /** P58: the consolidated bridge→grants→app→target→observe sequence whose
   *  formatted block is already appended to dispatchPrefix; exposed for
   *  cards/telemetry. */
  activation: ComputerTaskActivationPlan;
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
  /** Staged pre-flight blockers (D4) — surfaces a later stage needs that
   *  are unavailable NOW, so the task fails at launch, not at step 9. */
  stagePreflightBlockers: ComputerTaskStagePreflightBlocker[];
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
  /** Route-level app choice (task→best-app resolution). When present the
   *  complexity plan's dispatch block carries the App-choice contract
   *  (open chosen app first, verify frontmost, one named fallback). */
  appResolution?: import('./computerTaskComplexityPlan').ComputerTaskAppChoiceResolution | null;
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
    appResolution: args.appResolution ?? null,
  });
  const stagePreflightBlockers = validateComputerTaskStageSurfaces(complexityPlan.stages, args.audit);
  // A stage whose surface is unavailable makes the WHOLE task not ready —
  // running earlier stages would do work the task cannot finish.
  const stagedReadiness = stagePreflightBlockers.length > 0
    ? {
        ready: false,
        missing: Array.from(new Set([
          ...readiness.missing,
          ...stagePreflightBlockers.flatMap((blocker) => blocker.missing),
        ])),
        summary: stagePreflightBlockers[0].message
          + (stagePreflightBlockers.length > 1 ? ` (+${stagePreflightBlockers.length - 1} more stage blocker(s))` : ''),
      }
    : readiness;
  const grants = buildComputerTaskGrantPlan({
    task: args.task,
    preview,
    audit: args.audit,
    grantedIds: args.grantedIds,
  });

  // P58: the consolidated activation sequence — bridge → grants → app/session
  // → target → observe — derived from the route facts and injected at the
  // head of the dispatch prefix, so BOTH lanes (agent prompt + browser
  // planner context) front-load prerequisite checks instead of discovering
  // them via mid-loop failures.
  const activation = buildComputerTaskActivationPlan({
    kind: preview.kind,
    appResolution: args.appResolution?.best
      ? {
          displayName: args.appResolution.best.displayName,
          openVia: args.appResolution.best.openVia,
          openTarget: args.appResolution.best.openTarget,
          availability: args.appResolution.best.availability,
        }
      : null,
    outstandingGrantLabels: grants.outstanding.map((grant) => grant.label),
    preflightBlockerLabels: preflight.blockers.map((item) => item.label),
  });

  return {
    preview,
    readiness: stagedReadiness,
    activation,
    dispatchPrefix: [
      buildComputerTaskDispatchPrefix({
        task: args.task,
        preview,
        readiness: stagedReadiness,
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
      formatComputerTaskActivationBlock(activation),
    ].filter(Boolean).join('\n\n'),
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
    stagePreflightBlockers,
    businessModelPlan: args.businessModelPlan,
  };
}
