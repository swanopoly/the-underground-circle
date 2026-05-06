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
  routing?: {
    provider_routed?: string;
    provider_model?: string;
    routing_fallback?: { provider: string; reason: string };
  };
};

export function buildRoomAgentMessageMetadata(
  structured: RoomAgentStructuredPayload,
  artifacts: SwanBotStructuredArtifact[],
): Record<string, unknown> {
  // When the call routed through a marketplace integration, surface the
  // actual provider model in the chip metadata (e.g. "openrouter/openai/gpt-5")
  // so the team sees "the model you picked actually answered" instead of
  // a generic Sonnet stand-in. Falls back to the usage-reported model
  // (the raw upstream id) if no marketplace routing happened.
  const routing = structured.routing;
  const routedModel = routing?.provider_routed && routing?.provider_model
    ? `${routing.provider_routed === 'hugging_face' ? 'huggingface' : routing.provider_routed}/${routing.provider_model}`
    : null;
  return {
    bot: true,
    bot_name: 'Agent',
    model: routedModel || structured.usage?.model || null,
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
    routing: structured.routing || null,
  };
}
