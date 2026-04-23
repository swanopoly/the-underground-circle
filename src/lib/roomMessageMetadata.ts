import type { SwanBotStructuredArtifact } from './swanbot';
import type { BrowserPlanCardData, BrowserPlanEvent } from './computerUse';
import type { PromptMemoryReference } from './memoryService';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { OpenSwanToolEvent } from './openswanSessionRuntime';
import type { OpenSwanTaskPlan } from './openswanTaskPlanner';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';

type RoomAgentStructuredPayload = {
  usage?: { model?: string | null } | null;
  runId?: string | null;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  delegatedSubagents?: string[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  memoriesUsed?: string[];
  memoryReferences?: PromptMemoryReference[];
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints: string[];
    blockers: string[];
  } | null;
  observedEval?: OpenSwanObservedEvalSummary | null;
};

export function buildRoomAgentMessageMetadata(
  structured: RoomAgentStructuredPayload,
  artifacts: SwanBotStructuredArtifact[],
): Record<string, unknown> {
  return {
    bot: true,
    bot_name: 'Agent',
    model: structured.usage?.model || null,
    artifacts,
    artifact_count: artifacts.length,
    run_id: structured.runId || null,
    task_plan: structured.taskPlan,
    tool_events: structured.toolEvents || [],
    verification_results: structured.verificationResults || [],
    delegated_subagents: structured.delegatedSubagents || [],
    browserPlans: structured.browserPlans || [],
    browserPlanEvents: structured.browserPlanEvents || [],
    memories_used: structured.memoriesUsed || [],
    memory_references: structured.memoryReferences || [],
    modeOutcomeSummary: structured.modeOutcomeSummary || null,
    observedEval: structured.observedEval || null,
  };
}
