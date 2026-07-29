import { buildAgenticCodingPrompt, detectAgenticCodingProfile, type AgenticCodingProfile, type AgenticCodingSurface } from './agenticCodingProfile';
import { getChatPromptLaneSpec } from './chatPromptAssembly';
import { addArtifact, addStep, completeRunUnlessCancelled, createRun, failRunUnlessCancelled, mergeRunMetadata, type ArtifactKind, type RunSurface, updateRunProgressUnlessCancelled, updateRunStatus } from './agentRunSystem';
import { planTelemetrySchedule } from './openswanTelemetryDeferCore';
import {
  sanitizeToolActionMetadataForPersistence,
  startRunHeartbeat,
} from './agentRunPersistence';
import { buildOpenSwanExecutionStream, type OpenSwanExecutionContract } from './openswanExecution';
import { buildOpenSwanMemoryRecommendations, captureOpenSwanOutcomeMemory, recordArchiveDerivedMemorySuccess, recordArchiveDerivedMemoryWeakSignal, type OpenSwanMemoryRecommendation, type PromptMemoryReference } from './memoryService';
import { buildOpenSwanObservedEvalSummary } from './openswanObservedEvals';
import { extractBrowserPlansFromToolActions } from './openswanRuntimeToolLoop';
import { buildOpenSwanTaskPlan, type OpenSwanTaskPlan, type OpenSwanVerificationCheck } from './openswanTaskPlanner';
import {
  drainOpenSwanSteeringNotes,
  registerOpenSwanSteeringScope,
  unregisterOpenSwanSteeringScope,
} from './openswanSteering';
import {
  buildBlackSwanGroundingBlock,
  isBlackSwanModel,
  resolveOpenSwanToolLoopModel,
} from './blackswanRouting';
import {
  buildOpenSwanToolBrief,
  getOpenSwanToolPolicy,
  listToolsHiddenByMode,
  previewOpenSwanToolsForSurface,
  type OpenSwanRuntimeToolContext,
  type OpenSwanRuntimeToolName,
} from './openswanToolRuntime';
import { runAgent, type AgentProvider, type AgentToolDefinition } from './agentExecutionCore';
import { getOpenSwanToolsForSurface, getProgressiveOpenSwanTools, createOpenSwanToolParallelPolicyProvider } from './openswanBridge';
import { dispatchToolDetailed, MAX_TOOL_ROUNDS } from './openswanTools/index';
import { EDGE_INVOKE_RETRIES, edgeRetryBackoffMs, isRetryableEdgeFailure } from './edgeInvokeRetry';
import { extractAssistantText } from './toolLoopProgress';
import { getFreshAccessToken } from './authSession';
import { supabase } from './supabase';
import {
  accumulateLoopUsage,
  buildCapExhaustionFinalizationBody,
  buildLegacyToolEventFromResult,
  buildLegacyToolLoopResult,
  buildSwanbotToolTurnBody,
  createLegacyApprovalGateAdapter,
  createLegacyRoundNudgeHook,
  createLoopUsageAccumulator,
  finalizeLoopUsage,
  mapAgentEventToOpenSwanStage,
  needsCapExhaustionFinalization,
  parseSwanbotToolTurnData,
  shapeLegacyToolHandlerResult,
  toAnthropicToolShapes,
  type LegacyToolApprovalGate,
  type LegacyToolEvent,
  type LegacyToolLoopResult,
} from './openswanSessionRuntimeAdapters';
import { createRunAndFixGateState, foldRunAndFixRound, markNudgeSent, planVerificationNudge } from './runAndFixGateCore';
import { buildUserActionReceipt } from './userActionReceiptCore';
import { estimateRunCostUsd } from './runCostRollupCore';
import {
  PERSISTED_TOOL_FAILURE_TEXT,
  summarizeToolInputForPersistence,
  summarizeToolResultForPersistence,
} from './eventBoundCore';
import { resolveCapabilityFallback } from './capabilityFallbackCore';
import { getModelCapabilityFlags, getModelCodingTier } from './modelCapabilities';
import { getModelContextWindow } from './modelContextBudgetCore';
import { evaluateTurnSpend } from './turnSpendGovernorCore';
import { assessStreamDegeneracy } from './streamDegeneracyCore';
import { appendOpenSwanTranscriptEvent, buildOpenSwanTranscriptKey, upsertOpenSwanTranscriptHeader, type OpenSwanSessionTranscript } from './openswanTranscripts';
import { executeOpenSwanVerificationPlan, type OpenSwanVerificationResult } from './openswanVerificationRuntime';
import { planVerificationDepth } from './verificationDepthPolicyCore';
import { getSwanBotStructuredResponse, executeToolUseLoop, buildStreamableSystemPrompt, type SwanBotContext, type SwanBotStructuredArtifact, type SwanBotStructuredResponse } from './swanbot';
import { findPendingResumeCheckpoint, buildResumeContextBlock } from './toolLoopResume';
import { buildSnapshotAwareInitialMessages } from './circleSnapshotContextInjection';
import { delegateToSubagents, planSubagentDelegation, shouldDelegateToSubagents } from './subagentRegistry';
import { resolveEffectiveDelegationMode, type SessionDelegationMode } from './chatSessionProfile';
import { buildOpenSwanModeResponseContract, getOpenSwanModePolicy } from './openswanModePolicy';
import type { BrowserPlanCardData, BrowserPlanEvent } from './computerUse';
import { buildOpenSwanMemoryStores } from './openswanMemoryStores';
import { OPENSWAN_RUNTIME_PLAN_VERSION } from './openswanRuntimePlan';
import type { ConnectedProviderSet } from './serviceProfileSouls';
import { buildUserTaskPipelinePromptBlock } from './userTaskPipelines';
import { buildComputerAppTaskStrategyPromptBlock } from './computerAppTaskStrategy';
import { buildChatComputerRequestRoutePromptBlock, resolveChatComputerConstraintInputs } from './chatComputerRequestRouter';
import { buildComputerAppGroundingPromptBlock } from './computerAppGrounding';
import { buildComputerAppExecutionReceiptPromptBlock } from './computerAppExecutionReceipts';
import { buildDesignAppAutomationPromptBlock } from './designAppAutomation';
import { buildDesignAppExecutionPipelinePromptBlock } from './designAppExecutionPipeline';
import {
  buildDesignAppCreativeAiPromptBlock,
  buildDesignAppCreativeAiRecipePromptBlock,
} from './designAppCreativeAi';
import { buildDesignAppObjectManifestPromptBlock } from './designAppObjectManifest';
import { buildDesignAppOperationRunbookPromptBlock } from './designAppOperationRunbooks';
import { buildDesignAppProofReviewPromptBlock } from './designAppProofReview';
import { buildEngineeringCadOperationRunbookPromptBlock } from './engineeringCadOperationRunbooks';
import {
  buildRelevantAgentDevelopmentStandardsPromptBlock,
  summarizeRelevantAgentDevelopmentStandards,
} from './agentDevelopmentStandards';
import {
  buildDesignAppRuntimeManifestLedgerActions,
} from './designAppRuntimeManifest';
import {
  persistAgentRunLedgerPreview,
  persistRuntimeToolActions,
  sanitizeArtifactRefsForPersistence,
} from './agentRunLedgerPersistence';
import { buildRouteDecisionRecordFromRuntime, buildRouteDecisionTelemetryPayload } from './routeDecisionTelemetry';
import { buildAgentRuntimeSubject, type AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';

export type OpenSwanRunStage =
  | 'booting'
  | 'loading_context'
  | 'delegating'
  | 'reasoning'
  | 'using_tools'
  | 'rendering_artifacts'
  | 'finalizing';

export type OpenSwanRunCallbacks = {
  onStageChange?: (stage: OpenSwanRunStage, label: string) => void;
  onDelegationPlan?: (subagents: OpenSwanDelegatedAgentDescriptor[]) => void;
  /**
   * Pre-execution gate fired before every Anthropic tool_use dispatch.
   * Resolves to 'approve' or 'reject'. Rejection feeds a decline tool_result
   * back to the model so it can adjust. ChatPanel uses this to surface
   * an inline approval prompt when the user has flipped on review mode.
   */
  onToolApproval?: (call: { name: string; input: any }) => Promise<'approve' | 'reject'>;
};

export type OpenSwanDelegatedAgentDescriptor = {
  name: string;
  icon: string;
  color: string;
  role: string;
};

export type OpenSwanTurnOptions = {
  message: string;
  context: SwanBotContext;
  connectedProviders?: ConnectedProviderSet | string[];
  surface: AgenticCodingSurface;
  runSurface?: RunSurface;
  taskId?: string;
  sessionProfile?: AgenticCodingProfile;
  delegationMode?: SessionDelegationMode;
  activePluginIds?: string[];
  roomId?: string;
  chatSessionId?: string | null;
  mode?: string;
  title?: string;
  goal?: string;
  metadata?: Record<string, unknown>;
  autoExecuteVerification?: boolean;
  /** User-cancel signal — aborts the typed-core turn at the next loop
   *  boundary and returns the partial work as an honest 'stopped' result.
   *  The capability is built into agentExecutionCore; this threads it. */
  signal?: AbortSignal;
} & OpenSwanRunCallbacks;

function normalizeConnectedProviders(value?: ConnectedProviderSet | string[]): ConnectedProviderSet | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value : Array.from(value);
  return new Set(raw.map((provider) => {
    if (provider === 'hugging_face') return 'huggingface';
    if (provider === 'z_ai') return 'zai';
    return provider;
  }));
}

export type OpenSwanToolEvent = {
  tool: string;
  input: unknown;
  result: string;
  status: 'completed' | 'failed' | 'manual_required' | 'blocked';
  summary: string;
};

export type OpenSwanTurnResult = SwanBotStructuredResponse & {
  runId?: string | null;
  prompt: string;
  stage: OpenSwanRunStage;
  taskPlan: OpenSwanTaskPlan;
  verificationResults?: OpenSwanVerificationResult[];
  delegatedSubagents?: string[];
  memoriesUsed?: string[];
  memoryReferences?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  toolEvents?: OpenSwanToolEvent[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  modeOutcomeSummary?: OpenSwanModeOutcomeSummary | null;
  observedEval?: import('./openswanObservedEvals').OpenSwanObservedEvalSummary | null;
  /** Coding-lane proof-of-work receipt ("edited N files · checks passed ·
   *  committed sha") from the typed tool loop, when the turn produced one. */
  verificationReceipt?: import('./verificationReceiptCore').VerificationReceipt | null;
};

function buildInitialBrowserPlanEvents(plans: BrowserPlanCardData[]): BrowserPlanEvent[] {
  const timestamp = new Date().toISOString();
  return plans.map((plan) => ({
    id: `${plan.planId}:planned`,
    planId: plan.planId,
    kind: 'planned',
    at: timestamp,
    summary: `Browser plan prepared via ${plan.backendLabel}`,
    backend: plan.backend,
    backendLabel: plan.backendLabel,
  }));
}

function getOpenSwanReasoningSettings(
  taskPlan: OpenSwanTaskPlan,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
): {
  thinkingLevel: 'fast' | 'balanced' | 'deep';
  maxTokens: number;
} {
  // Complexity-first: if smart routing detected complexity, use that as primary signal
  if (complexity === 'trivial') return { thinkingLevel: 'fast', maxTokens: 1024 };
  if (complexity === 'simple') return { thinkingLevel: 'fast', maxTokens: 2048 };

  // For moderate+complex, refine by task kind
  if (taskPlan.kind === 'build') {
    const hasPreview = taskPlan.verification.some((check) => check.kind === 'preview');
    return {
      thinkingLevel: complexity === 'complex' ? 'deep' : 'balanced',
      maxTokens: hasPreview ? 6144 : complexity === 'complex' ? 8192 : 4096,
    };
  }

  if (taskPlan.kind === 'architect' || taskPlan.kind === 'research') {
    return {
      thinkingLevel: complexity === 'complex' ? 'deep' : 'balanced',
      maxTokens: complexity === 'complex' ? 8192 : 4096,
    };
  }

  if (taskPlan.kind === 'debug') {
    return {
      thinkingLevel: complexity === 'complex' ? 'deep' : 'balanced',
      maxTokens: complexity === 'complex' ? 6144 : 4096,
    };
  }

  if (taskPlan.kind === 'review') {
    return {
      thinkingLevel: complexity === 'complex' ? 'deep' : 'balanced',
      maxTokens: complexity === 'complex' ? 4096 : 3072,
    };
  }

  return {
    thinkingLevel: complexity === 'complex' ? 'balanced' : 'fast',
    maxTokens: complexity === 'complex' ? 3072 : 2048,
  };
}

function selectRuntimeToolNames(
  taskPlan: OpenSwanTaskPlan,
  mode?: string | null,
): string[] {
  const codeRelevantKinds = new Set(['build', 'debug', 'review', 'architect']);
  const isCodeRelevant = codeRelevantKinds.has(taskPlan.kind);
  const names = taskPlan.recommendedTools
    .filter((item) => item.tool !== 'code.inspect' || isCodeRelevant)
    .map((item) => item.tool);
  const unique = Array.from(new Set(names));

  // A default-only "inspect" recommendation should not force an extra
  // model/tool round for plain talk or support. Concrete tools (vault,
  // browser, desktop, rooms, tasks, etc.) still run.
  if (unique.length === 0) return [];

  const modeKey = mode || 'talk';
  const cap =
    modeKey === 'execute' ? 10 :
    modeKey === 'build' || modeKey === 'plan' ? 8 :
    modeKey === 'research' ? 6 :
    modeKey === 'review' || modeKey === 'support' ? 5 :
    4;
  return unique.slice(0, cap);
}

function getToolRoundBudget(taskPlan: OpenSwanTaskPlan, mode?: string | null): number {
  const modeKey = mode || 'talk';
  if (modeKey === 'execute') return taskPlan.kind === 'automation' ? 5 : 4;
  if (modeKey === 'build') return 4;
  if (modeKey === 'plan') return 3;
  if (modeKey === 'research') return 3;
  if (modeKey === 'review' || modeKey === 'support') return 2;
  return 2;
}

// Last live_stage label published per run — dedups the fire-and-forget
// agent_runs metadata write below so an unchanged stage never costs a
// redundant read+write. mergeRunMetadata writes only {metadata, updated_at}
// (never status), so publishing a stage can never resurrect a STOPped /
// cancelled run to 'running' (honest-STOP-safe). Bounded so a long app
// session can't grow it without limit; evicting an active run's entry is
// harmless (at most one extra write on that run's next stage).
const lastPublishedStageLabelByRun = new Map<string, string>();

function emitStage(
  callbacks: OpenSwanRunCallbacks,
  stage: OpenSwanRunStage,
  label: string,
  runId?: string,
): Promise<unknown> | undefined {
  callbacks.onStageChange?.(stage, label);
  // Fire-and-forget (void, never awaited → no added turn latency): publish the
  // live stage to the run row so the console (subscribed to agent_runs) can
  // show it beside "step N/M". Skipped entirely before the run exists (runId
  // undefined, e.g. the pre-createRun 'booting' emit).
  // RETURNS the merge promise (already .catch-guarded) so a caller emitting a
  // stage CONCURRENT with the terminal metadata merges — i.e. after the
  // telemetry join barrier — can await it first: mergeRunMetadata is a
  // non-atomic read-merge-write, so an in-flight stage write racing a terminal
  // merge would lost-update-drop the terminal keys.
  if (runId && lastPublishedStageLabelByRun.get(runId) !== label) {
    if (lastPublishedStageLabelByRun.size >= 256) {
      const oldest = lastPublishedStageLabelByRun.keys().next().value;
      if (oldest !== undefined) lastPublishedStageLabelByRun.delete(oldest);
    }
    lastPublishedStageLabelByRun.set(runId, label);
    return mergeRunMetadata(runId, {
      live_stage: label.slice(0, 120),
      live_stage_at: new Date().toISOString(),
    }).catch(() => {});
  }
  return undefined;
}

function mapStructuredArtifactKind(kind: SwanBotStructuredArtifact['kind']): ArtifactKind {
  switch (kind) {
    case 'code':
      return 'code_patch';
    case 'webpage':
      return 'webpage';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'translation':
      return 'translation';
    case 'classification':
      return 'classification';
    case 'summary':
    case 'vision':
    default:
      return 'report';
  }
}

function summarizeDelegatedArtifacts(artifacts: SwanBotStructuredArtifact[]): string[] {
  if (!artifacts.length) return [];
  return [
    'Artifacts:',
    ...artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.title}`),
  ];
}

function summarizeMemoryReferences(references: PromptMemoryReference[]): Array<Record<string, unknown>> {
  return references.map((ref) => ({
    id: ref.id,
    title: ref.title,
    scope: ref.scope,
    memoryKind: ref.memoryKind,
    soulKey: ref.soulKey || null,
    importance: ref.importance ?? null,
    retrievalMode: ref.retrievalMode ?? null,
    updatedAt: ref.updatedAt || null,
    lastAccessedAt: ref.lastAccessedAt || null,
    confidence: ref.confidence ?? null,
    score: ref.score ?? null,
    taskFit: ref.taskFit ?? null,
    matchReason: ref.matchReason ?? null,
    source: typeof ref.metadata?.source === 'string' ? ref.metadata.source : null,
  }));
}

type OpenSwanModeOutcomeSummary = {
  headline: string;
  bulletPoints: string[];
  blockers: string[];
};

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));
}

function buildModeOutcomeSummary(args: {
  mode?: string | null;
  taskKind: string;
  response: string;
  artifacts: SwanBotStructuredArtifact[];
  verificationResults?: OpenSwanVerificationResult[];
  browserPlans: BrowserPlanCardData[];
  runtimeToolActions: Array<{ status?: string | null; title?: string | null; output_preview?: string | null }>;
}): OpenSwanModeOutcomeSummary | null {
  const mode = args.mode || null;
  if (!mode || mode === 'talk' || mode === 'none') return null;

  const verificationResults = args.verificationResults || [];
  const failedChecks = verificationResults.filter((result) => (
    !result.ok || result.status === 'manual_required' || result.status === 'blocked'
  ));
  const failedToolActions = args.runtimeToolActions.filter((action) => (
    action.status === 'failed' || action.status === 'blocked' || action.status === 'manual_required'
  ));
  const blockers = uniqueNonEmpty([
    ...failedChecks.map((result) => result.summary),
    ...failedToolActions.map((action) => action.output_preview || action.title || ''),
  ]).slice(0, 5);

  if (mode === 'research') {
    return {
      headline: `Research run produced ${args.artifacts.length} artifact(s), ${verificationResults.length} verification result(s), and ${args.browserPlans.length} browser investigation plan(s).`,
      bulletPoints: uniqueNonEmpty([
        ...args.artifacts.map((artifact) => `${artifact.kind}: ${artifact.title}`),
        ...verificationResults.map((result) => result.summary),
        ...args.browserPlans.map((plan) => `Browser plan: ${plan.task}`),
      ]).slice(0, 6),
      blockers,
    };
  }

  if (mode === 'design') {
    return {
      headline: `Design run captured ${args.artifacts.length} artifact(s) and ${args.browserPlans.length} preview/browser plan(s) for UI direction and handoff.`,
      bulletPoints: uniqueNonEmpty([
        ...args.artifacts.map((artifact) => `${artifact.kind}: ${artifact.title}`),
        ...args.browserPlans.map((plan) => `Preview plan: ${plan.task}`),
        ...verificationResults.map((result) => result.summary),
      ]).slice(0, 6),
      blockers,
    };
  }

  if (mode === 'support') {
    return {
      headline: blockers.length > 0
        ? `Support run identified ${blockers.length} blocker(s) and focused on the fastest recovery path.`
        : `Support run completed with ${verificationResults.length} verification result(s) and no active blockers recorded.`,
      bulletPoints: uniqueNonEmpty([
        ...blockers,
        ...verificationResults.map((result) => result.summary),
        ...args.browserPlans.map((plan) => `Browser step: ${plan.task}`),
      ]).slice(0, 6),
      blockers,
    };
  }

  if (mode === 'build') {
    return {
      headline: `Build run produced ${args.artifacts.length} artifact(s) with ${verificationResults.length} verification result(s).`,
      bulletPoints: uniqueNonEmpty([
        ...args.artifacts.map((artifact) => `${artifact.kind}: ${artifact.title}`),
        ...verificationResults.map((result) => result.summary),
      ]).slice(0, 6),
      blockers,
    };
  }

  return {
    headline: `${mode} run completed for task kind ${args.taskKind}.`,
    bulletPoints: uniqueNonEmpty([
      ...args.artifacts.map((artifact) => `${artifact.kind}: ${artifact.title}`),
      ...verificationResults.map((result) => result.summary),
    ]).slice(0, 6),
    blockers,
  };
}

function buildModeSummaryArtifacts(args: {
  mode?: string | null;
  summary: OpenSwanModeOutcomeSummary | null;
  response: string;
  browserPlans: BrowserPlanCardData[];
  verificationResults?: OpenSwanVerificationResult[];
}): Array<{ artifactKind: ArtifactKind; title: string; content: string; metadata: Record<string, unknown> }> {
  const mode = args.mode || null;
  if (!mode || !args.summary) return [];

  const sections = [
    `Headline: ${args.summary.headline}`,
    args.summary.bulletPoints.length ? ['', 'Highlights:', ...args.summary.bulletPoints.map((item) => `- ${item}`)] : [],
    args.summary.blockers.length ? ['', 'Blockers:', ...args.summary.blockers.map((item) => `- ${item}`)] : [],
    args.browserPlans.length ? ['', 'Browser plans:', ...args.browserPlans.map((plan) => `- ${plan.task}`)] : [],
    args.verificationResults?.length ? ['', 'Verification:', ...args.verificationResults.map((result) => `- ${result.summary}`)] : [],
    ['', 'Response excerpt:', args.response.slice(0, 1600)],
  ].flat().filter(Boolean).join('\n');

  if (mode === 'research') {
    return [{
      artifactKind: 'research_brief',
      title: 'Research Brief',
      content: sections,
      metadata: { source: 'openswan_mode_summary', mode },
    }];
  }

  if (mode === 'design') {
    return [{
      artifactKind: 'design_spec',
      title: 'Design Handoff Summary',
      content: sections,
      metadata: { source: 'openswan_mode_summary', mode },
    }];
  }

  if (mode === 'support') {
    return [{
      artifactKind: 'checklist',
      title: 'Support Recovery Checklist',
      content: sections,
      metadata: { source: 'openswan_mode_summary', mode },
    }];
  }

  return [];
}

async function appendTranscriptEvent(
  transcriptKey: string,
  event: Parameters<typeof appendOpenSwanTranscriptEvent>[0]['event'],
): Promise<OpenSwanSessionTranscript | null> {
  try {
    return await appendOpenSwanTranscriptEvent({ transcriptKey, event });
  } catch (error) {
    console.warn('[OpenSwanRuntime] Transcript append failed (non-fatal):', error);
    return null;
  }
}

// ─── O1: typed-core tool loop (agentExecutionCore.runAgent) ─────────────────

const OPENSWAN_TYPED_CORE_FLAG = 'uc_openswan_typed_core';

/**
 * O1 cutover switch — a MANUAL revert lever only, never an auto-fallback
 * (flipping paths mid-run would risk double-executing tools). Defaults ON.
 * Web: `localStorage.setItem('uc_openswan_typed_core', '0')` reverts the next
 * turn to the legacy `executeToolUseLoop`; remove the key (or set '1') to
 * re-enable. Native has no localStorage — the try/catch leaves the default.
 */
function isOpenSwanTypedCoreEnabled(): boolean {
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(OPENSWAN_TYPED_CORE_FLAG);
    if (value === '0' || value === 'false' || value === 'off') return false;
  } catch { /* storage unavailable (native) → default ON */ }
  return true;
}

// ─── T2→P25: progressive tool disclosure (DEFAULT ON) ───────────────────────

const OPENSWAN_TOOLS_FIRST_FLAG = 'uc_openswan_tools_first';

/**
 * P25 cutover: progressive (pinned-core + `tools.search`) disclosure is the
 * DEFAULT — the ~160-tool full catalog is 3-5x past the documented tool-
 * selection degradation threshold, and deferred loading measurably RAISES
 * accuracy while cutting prompt tokens (see
 * docs/CHAT_AGENT_ARCHITECTURE_IMPROVEMENT_PLAN.md item 1; search-ranking
 * quality gate hardened in P24). Explicit opt-out reverts to the legacy
 * full-catalog path: `localStorage.setItem('uc_openswan_tools_first', '0')`
 * (or 'false'/'off'). Native has no localStorage — default ON. Setup
 * failures in the progressive path fall back to the full catalog per turn
 * (see runTypedCoreToolLoop).
 */
function isOpenSwanToolsFirstEnabled(): boolean {
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(OPENSWAN_TOOLS_FIRST_FLAG);
    if (value === '0' || value === 'false' || value === 'off') return false;
  } catch { /* storage unavailable (native) → default ON */ }
  return true;
}

/**
 * Runs the session turn's tool loop on `agentExecutionCore.runAgent` while
 * preserving the legacy `executeToolUseLoop` contract end-to-end:
 *
 *   - transport: the SAME `swanbot-ai` edge invoke the legacy loop used
 *     (per-round fresh JWT + bounded transient retry via edgeInvokeRetry;
 *     same body shape: message / tools / tool_messages / system_override),
 *   - tools: the openswanBridge full-catalog adapter filtered to the same
 *     `allowedToolNames` + mode the legacy loop advertised,
 *   - approval gate: `opts.onToolApproval` payloads stay byte-identical
 *     (R19 — see createLegacyApprovalGateAdapter),
 *   - events: R13 stage mapping + R14 metadata-fed legacy toolEvents,
 *   - result: legacy `{ response, toolEvents, routing, incomplete,
 *     checkpoint }` shape incl. the cap-exhaustion finalization call.
 */
async function runTypedCoreToolLoop(args: {
  systemPrompt: string;
  userMessage: string;
  /**
   * Compact Circle Context Snapshot block (circleSnapshotContextInjection) —
   * injected as a user-role context message AHEAD of the user message so the
   * volatile index never touches the frozen/cached system prompt (R15/O7).
   * `null`/absent ⇒ initial messages are exactly the pre-snapshot shape.
   */
  snapshotContextMessage?: string | null;
  model: string;
  circleId: string;
  userId: string;
  threadId?: string;
  runId?: string;
  activeSoulKey?: string;
  activePluginIds?: string[];
  allowedToolNames: string[];
  surface: 'main_chat' | 'room_chat';
  mode?: string | null;
  maxToolRounds?: number;
  agentSubject?: AgentRuntimeSubjectMetadata | null;
  toolApprovalGate?: LegacyToolApprovalGate;
  onStage?: (stage: OpenSwanRunStage, label: string) => void;
  /**
   * Coding-agent P5 plan/execute split. When present, a strong PLANNER model
   * runs one text-only turn first (no tools) to produce an implementation
   * plan, which is injected as a handoff note ahead of the user message; the
   * tool loop then runs on the FAST EXECUTOR (`executorModelId`). Absent ⇒
   * today's single-model path (byte-identical). Decided by
   * `codingModelSplitPolicy.decideCodingModelSplit` in the session turn.
   */
  codingPlanSplit?: {
    plannerModelId: string;
    executorModelId: string;
    plannerPrompt: string;
    reason: string;
  } | null;
  /** User-cancel signal, threaded to runAgent (STOP button). */
  signal?: AbortSignal;
}): Promise<LegacyToolLoopResult & { cancelled?: boolean }> {
  // BlackSwan collaboration split (P8 — the CLAUDE.md contract, previously
  // unwired on this path): the typed loop always carries runtime tools and
  // BlackSwan cannot reliably drive native tool calling, so the loop runs
  // on the tool executor while BlackSwan stays in the prompt as the
  // app-grounding voice. Non-BlackSwan models pass through unchanged.
  // P5: when a coding plan/execute split is active the loop runs on the
  // chosen fast executor (the split decider already required a strong,
  // non-BlackSwan planner, so the BlackSwan swap never applies here).
  const baseLoopModel = args.codingPlanSplit
    ? args.codingPlanSplit.executorModelId
    : resolveOpenSwanToolLoopModel(args.model, args.allowedToolNames);
  // Capability fallback: if the resolved executor model lacks a needed capability
  // (here: tool use — the headline hazard is a user picking a no-tool model while
  // tools are enabled), swap to a tool-capable platform default. Fail-open: returns
  // the same model unchanged when there's no gap — the same operation class as the
  // BlackSwan grounding swap resolveOpenSwanToolLoopModel already performs.
  // Substitute STRENGTH matches the user's pick: derive a coding-tier floor from
  // the picked model so a strong no-tool reasoner (deepseek-r1, tier 'strong')
  // lands on claude-sonnet-4-6 instead of the basic-tier Haiku default. Tier
  // 'none' (sonar / deepseek-reasoner) imposes no floor and still resolves to
  // Haiku — but now VISIBLY (see substitutionNotice). ('none' ⇒ omit the field ⇒
  // no coding-tier requirement.)
  const baseLoopCodingTier = getModelCodingTier(baseLoopModel);
  const capabilityFallback = resolveCapabilityFallback(
    {
      model: baseLoopModel,
      flags: getModelCapabilityFlags(baseLoopModel),
      contextWindow: getModelContextWindow(baseLoopModel),
    },
    {
      toolUse: true,
      ...(baseLoopCodingTier === 'none' ? {} : { minCodingTier: baseLoopCodingTier }),
    },
  );
  const loopModel = capabilityFallback.model;
  // FAIL-VISIBLE (CLAUDE.md): a silent model swap is exactly the "it got dumber"
  // failure mode. When we actually substituted (always a DIFFERENT model — the
  // core never reports substituted for an identity), surface a one-line notice —
  // mirroring the main-chat delegate-executor notice (buildDelegateExecutorNotice
  // in swanbot.ts) — so the user sees their picked model was replaced, and thread
  // it into route_decision telemetry below.
  const substitutionNotice = capabilityFallback.substituted
    ? `${baseLoopModel} can't use tools here — running this on ${loopModel} instead.`
    : null;
  const blackswanGroundingBlock = isBlackSwanModel(args.model)
    ? buildBlackSwanGroundingBlock({
        model: args.model,
        source: args.surface === 'room_chat' ? 'room_chat' : 'openswan',
      })
    : '';

  const toolCtx: OpenSwanRuntimeToolContext = {
    circleId: args.circleId,
    userId: args.userId,
    threadId: args.threadId,
    runId: args.runId,
    activeSoulKey: args.activeSoulKey,
    activePluginIds: args.activePluginIds,
    surface: args.surface,
    // Session-path parity with chat preflight (swanbot.ts): parse the turn's
    // "never do X" constraints from the SAME source the chat loop uses so the
    // runtime dispatch backstop (constraintBlocksToolCall in
    // openswanToolRuntime) enforces them on this path too. Without this the
    // backstop read `context.userConstraints ?? null` is always null here.
    userConstraints: resolveChatComputerConstraintInputs(args.userMessage).userConstraints,
  };
  // T2 progressive disclosure (DEFAULT OFF). While OFF this is the exact
  // legacy path: advertise the full allowed-names catalog up front and apply
  // `allowedToolNames` as a HARD gate (empty ⇒ no model round). While ON,
  // advertise only the pinned high-frequency core + `tools.search`, let the
  // model unlock the rest mid-run via `resolveAdditionalTools` (wired into
  // runAgent below), and treat `selectRuntimeToolNames`/`allowedToolNames` as
  // a hint rather than a hard gate (progressive disclosure owns the palette).
  const toolsFirstEnabled = isOpenSwanToolsFirstEnabled();
  let bridgeTools: AgentToolDefinition[];
  let resolveAdditionalTools:
    | ((ctx: { session: Record<string, unknown>; iteration: number }) => AgentToolDefinition[])
    | undefined;
  if (toolsFirstEnabled) {
    try {
      const progressive = getProgressiveOpenSwanTools(args.surface, toolCtx, { mode: args.mode });
      bridgeTools = progressive.tools;
      resolveAdditionalTools = progressive.resolveAdditionalTools;
    } catch {
      // P25 fail-safe: a progressive-setup failure must never cost the turn —
      // fall back to the legacy full-catalog path for this turn only.
      bridgeTools = getOpenSwanToolsForSurface(args.surface, toolCtx, {
        allowedToolNames: args.allowedToolNames as OpenSwanRuntimeToolName[],
        mode: args.mode,
      });
      if (bridgeTools.length === 0) {
        return { response: '', toolEvents: [] };
      }
    }
  } else {
    bridgeTools = getOpenSwanToolsForSurface(args.surface, toolCtx, {
      allowedToolNames: args.allowedToolNames as OpenSwanRuntimeToolName[],
      mode: args.mode,
    });
    if (bridgeTools.length === 0) {
      // Legacy parity: no advertised tools → no model round.
      return { response: '', toolEvents: [] };
    }
  }

  const toolEvents: LegacyToolEvent[] = [];
  const rejectedToolUseIds = new Set<string>();
  const pendingToolInputs = new Map<string, unknown>();
  const usageAcc = createLoopUsageAccumulator();
  let routing: LegacyToolLoopResult['routing'];
  let edgeFailed = false;
  // Route-decision telemetry (silent-mis-classification defense): emit ONCE
  // per run, at the first loop event, so a lane flip or low-confidence spike
  // is visible in the run event stream (see routeDecisionTelemetry.ts). The
  // full ChatAutomationPlan does not reach this far downstream — only the
  // resolved loop model + the surface/mode lane are known here — so we use the
  // runtime-primitive adapter rather than fabricate a plan.
  let emittedRouteDecision = false;

  // Wrap each bridge handler so its result carries the legacy dispatch
  // metadata/status side channel (R14) and the legacy in-loop nudges,
  // while the approval gate (below) still sees the RAW model input (R19).
  const wrappedTools: AgentToolDefinition[] = bridgeTools.map((tool) => ({
    ...tool,
    handler: async (input, handlerCtx) => {
      // Legacy dispatch normalized missing input to {} (`block.input || {}`).
      const normalizedInput = (input as Record<string, unknown>) || {};
      const inner = await tool.handler(normalizedInput, handlerCtx);
      let toolPolicy: Record<string, unknown> | null = null;
      try {
        toolPolicy = getOpenSwanToolPolicy(
          tool.name as OpenSwanRuntimeToolName,
          args.activePluginIds,
        ) as unknown as Record<string, unknown>;
      } catch { /* policy lookup is best-effort metadata */ }
      return shapeLegacyToolHandlerResult({
        toolName: tool.name,
        input: normalizedInput,
        inner,
        toolPolicy,
        priorToolEvents: toolEvents,
      });
    },
  }));

  // T6: append the circle's external MCP tools (policy-gated via
  // mcpToolBridge) to the advertised tool set. TYPED-CORE ONLY — the legacy
  // executeToolUseLoop dispatches by name through openswanTools'
  // dispatchToolDetailed, which has no handlers for mcp__* names, so the
  // legacy (escape-hatch) path never sees these tools. Notes:
  //  - fetched ONCE per turn here (tool assembly runs once; runAgent reuses
  //    the same tools array across every round), never per round;
  //  - trust comes from circles.settings.mcpTrustedServerIds (resolved inside
  //    getMcpToolsForCircle; read failure ⇒ nothing trusted ⇒ every MCP tool
  //    is approval-gated, fail closed);
  //  - approvals flow through the SAME opts.onToolApproval gate as catalog
  //    'ask' tools, with the server identity mapped into the gate payload;
  //  - bounded ≤ MAX_MCP_TOOLS_PER_TURN in deterministic name order, with
  //    catalog-name collisions skipped (namespacing makes them impossible,
  //    asserted anyway);
  //  - any failure (no MCP servers, fetch/trust errors) is silent: zero MCP
  //    tools, the turn proceeds on catalog tools alone. MCP tools are not
  //    wrapped in shapeLegacyToolHandlerResult — the bridge handlers already
  //    enforce approval, fail-closed errors, and untrusted-result fencing.
  let assembledTools: AgentToolDefinition[] = wrappedTools;
  try {
    const { getMcpToolsForCircle, mergeMcpToolsIntoCatalog, adaptLegacyToolApprovalGate } = await import('./mcpToolBridge');
    const mcpTools = await getMcpToolsForCircle(args.circleId, {
      approvalGate: args.toolApprovalGate ? adaptLegacyToolApprovalGate(args.toolApprovalGate) : undefined,
    });
    if (mcpTools.length > 0) {
      const merged = mergeMcpToolsIntoCatalog(wrappedTools, mcpTools);
      assembledTools = merged.tools;
      if (merged.skippedCollisions.length > 0) {
        console.warn('[OpenSwanRuntime] MCP tools skipped (catalog name collision):', merged.skippedCollisions.join(', '));
      }
      if (merged.overflow.length > 0) {
        console.warn(`[OpenSwanRuntime] MCP tool cap reached — dropped ${merged.overflow.length} tool(s):`, merged.overflow.join(', '));
      }
    }
  } catch { /* MCP tools are additive — never break the turn */ }

  // Same transport as the legacy loop: swanbot-ai edge fn, fresh JWT per
  // round, bounded transient retry. The invoke is idempotent (it returns the
  // model's next message; tools run client-side after), so a retry can never
  // double-execute a tool.
  const invokeSwanbotToolTurn = async (
    body: Record<string, unknown>,
  ): Promise<{ data: any; error: any }> => {
    let data: any = null;
    let error: any = null;
    for (let attempt = 0; attempt <= EDGE_INVOKE_RETRIES; attempt++) {
      const accessToken = await getFreshAccessToken();
      ({ data, error } = await supabase.functions.invoke('swanbot-ai', {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body,
      }));
      if (data && !error) break;
      if (attempt < EDGE_INVOKE_RETRIES && isRetryableEdgeFailure({
        hasData: !!data,
        errorName: (error as any)?.name,
        errorMessage: (error as any)?.message,
        status: (error as any)?.context?.status ?? (error as any)?.status,
      })) {
        await new Promise((resolve) => setTimeout(resolve, edgeRetryBackoffMs(attempt)));
        continue;
      }
      break;
    }
    return { data, error };
  };

  // P5 plan/execute split: run ONE text-only planner turn on the strong model
  // before the executor loop. Text-only (no tools) so it cannot mutate state;
  // the plan becomes a handoff note ahead of the user message. Fails soft — a
  // planner error just proceeds to the single-model executor path.
  let planHandoffNote = '';
  if (args.codingPlanSplit) {
    try {
      args.onStage?.('reasoning', `${args.codingPlanSplit.plannerModelId} planning the implementation`);
      const { data: planData, error: planError } = await invokeSwanbotToolTurn(buildSwanbotToolTurnBody({
        userMessage: args.codingPlanSplit.plannerPrompt,
        circleId: args.circleId,
        userId: args.userId,
        model: args.codingPlanSplit.plannerModelId,
        systemPrompt: args.systemPrompt,
        tools: [],
        messages: [{ role: 'user', content: args.codingPlanSplit.plannerPrompt }],
        agentSubject: args.agentSubject,
      }));
      if (!planError && planData) {
        const planParsed = parseSwanbotToolTurnData(planData);
        const planText = (planParsed.turn.content || [])
          .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
          .map((b: any) => b.text)
          .join('\n')
          .trim();
        if (planText) {
          const { buildCodingPlanHandoffNote } = await import('./codingModelSplitPolicy');
          planHandoffNote = buildCodingPlanHandoffNote({
            planText,
            plannerModelId: args.codingPlanSplit.plannerModelId,
            executorModelId: args.codingPlanSplit.executorModelId,
          });
        }
      }
    } catch { /* planner is best-effort — fall through to the executor loop */ }
  }

  const provider: AgentProvider = {
    turn: async ({ messages, tools }) => {
      const { data, error } = await invokeSwanbotToolTurn(buildSwanbotToolTurnBody({
        userMessage: args.userMessage,
        circleId: args.circleId,
        userId: args.userId,
        model: loopModel,
        systemPrompt: args.systemPrompt,
        tools: toAnthropicToolShapes(tools),
        messages,
        agentSubject: args.agentSubject,
      }));
      if (error || !data) {
        // Legacy parity: a terminal edge failure ends the turn with the
        // partial text and flags the loop result `incomplete` — it must NOT
        // throw, or already-executed tool work would be lost to the
        // text-only fallback (and re-answered without its results).
        edgeFailed = true;
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: String((data as any)?.response || 'Tool-use call failed.') }],
        };
      }
      const parsed = parseSwanbotToolTurnData(data);
      // Routing is fixed for the turn — capture the first round's report.
      if (!routing && parsed.routing) routing = parsed.routing;
      return parsed.turn;
    },
  };

  const maxRounds = Math.max(1, Math.min(MAX_TOOL_ROUNDS, args.maxToolRounds ?? MAX_TOOL_ROUNDS));

  // O1 nudge parity: the legacy loop's three loop-internal reliability nudges
  // (deterministic re-observe on failed UI actions, proof-coverage nudge,
  // tool-budget reminder) ride the core's round-complete hook — same pure
  // helpers, same trigger conditions/text (see createLegacyRoundNudgeHook).
  // The auto re-observe read uses the legacy dispatcher directly (NOT the
  // allowed-tools-filtered bridge set) — legacy parity: the observation tool
  // need not be advertised to the model to be auto-dispatched.
  const legacyRoundNudgeHook = createLegacyRoundNudgeHook({
    toolEvents,
    hasApprovalGate: !!args.toolApprovalGate,
    dispatchObservation: async (observationTool) => {
      const obs = await dispatchToolDetailed(observationTool, {}, toolCtx);
      return { text: obs.text, status: String(obs.status) };
    },
  });

  // Coding-agent P6 run-and-fix verification gate: fold every round's tool
  // calls into the pure gate state (runAndFixGateCore, smoke-tested); when a
  // round left edited files unverified — or a verification.* run failed —
  // append ONE deterministic nudge telling the model to run/fix verification
  // before finishing. The legacy reliability nudges keep priority (one note
  // per round), and the gate self-caps per run.
  let runAndFixState = createRunAndFixGateState();

  // Honest STOP (user cancel): the loop's effective signal is a LOCAL
  // controller composed manually with the caller's signal (no AbortSignal.any —
  // unreliable on Hermes). Two abort sources feed it: (a) the ChatTab/console
  // STOP button via args.signal, and (b) the console's DB-side cancel — the
  // console flips agent_runs.status to 'cancelled' without holding this
  // closure's signal, so onRoundComplete polls the row once per round boundary
  // and aborts locally when it reads 'cancelled'. Either path surfaces a
  // distinct `cancelled: true` on the loop result (separate from
  // cap-exhaustion `incomplete`) so finalization can write an honest
  // 'cancelled' status instead of overwriting it with 'completed'.
  const localAbort = new AbortController();
  if (args.signal) {
    if (args.signal.aborted) localAbort.abort();
    else args.signal.addEventListener('abort', () => localAbort.abort(), { once: true });
  }
  let dbCancelled = false;

  const onRoundComplete: ReturnType<typeof createLegacyRoundNudgeHook> = async (round) => {
    // DB-cancel poll (cheap, fail-open): only when this turn has a run row.
    if (args.runId && !dbCancelled) {
      try {
        const { data: runRow } = await supabase
          .from('agent_runs')
          .select('status')
          .eq('id', args.runId)
          .maybeSingle();
        if ((runRow as { status?: string } | null)?.status === 'cancelled') {
          dbCancelled = true;
          localAbort.abort();
        }
      } catch { /* poll failure must never break the loop */ }
    }
    runAndFixState = foldRunAndFixRound(
      runAndFixState,
      (round.toolResults || []).map((r) => ({ name: r.toolName, ok: r.ok, input: r.input })),
    );
    const legacy = await legacyRoundNudgeHook(round);
    const legacyNote = legacy && typeof legacy === 'object' && typeof legacy.appendUserNote === 'string'
      ? legacy.appendUserNote.trim()
      : '';
    if (legacyNote) return legacy;
    const nudge = planVerificationNudge(runAndFixState);
    if (nudge.shouldNudge) {
      runAndFixState = markNudgeSent(runAndFixState);
      return { appendUserNote: nudge.note };
    }
    // Turn-spend backstop (lowest-priority nudge, after legacy + run-and-fix): price
    // this turn's accrued burn and, if it breaches the turn cap or the next round is
    // projected to, append ONE soft steer to wrap up. With no per-turn/circle budget
    // threaded here it only fires the $50 absolute backstop + next-round-breach —
    // inert on normal cent-level turns; a genuine runaway-turn safety net.
    const spendUsage = finalizeLoopUsage(usageAcc);
    const accruedTurnUsd = spendUsage
      ? estimateRunCostUsd({
          model: loopModel,
          inputTokens: spendUsage.input_tokens,
          outputTokens: spendUsage.output_tokens,
          cachedTokens: spendUsage.cache_read_tokens,
        })
      : 0;
    const gov = evaluateTurnSpend({ accruedTurnUsd, roundsCompleted: round.iteration });
    if (gov.action !== 'continue') return { appendUserNote: gov.reason };
    return legacy;
  };

  // Run-reaper heartbeat (timer-driven): this runtime never goes through
  // agentRunPersistence.createPersistedRun (onEvent above writes
  // agent_run_events directly), and event-side bumps starve during one long
  // model/tool await anyway — so beat agent_runs.updated_at on wall-clock time
  // for the whole typed-loop invocation. `.finally` stops the timer on throw
  // and abort paths too, so it never keeps beating for a finished turn.
  const stopLoopHeartbeat = args.runId ? startRunHeartbeat(args.runId) : null;
  const runResult = await runAgent({
    initialMessages: buildSnapshotAwareInitialMessages({
      userMessage: args.userMessage,
      // BlackSwan grounding + the P5 plan handoff note ride the volatile
      // context message (same slot as the circle snapshot) so the
      // frozen/cached system prompt is untouched (R15/O7 cache discipline).
      snapshotContextMessage: [blackswanGroundingBlock, planHandoffNote, args.snapshotContextMessage || '']
        .filter(Boolean)
        .join('\n\n---\n\n') || null,
    }),
    tools: assembledTools,
    provider,
    maxIterations: maxRounds,
    // Mid-run steering (P7b): the UI pushes notes onto the thread-scoped
    // in-memory bus (openswanSteering); the core drains them at iteration
    // boundaries. Notes arrive pre-framed as guidance-only — approval gates
    // are untouched. Scope registration happens at the turn call site.
    steering: args.threadId
      ? { drain: () => drainOpenSwanSteeringNotes(args.threadId!) }
      : undefined,
    // STOP button: the user-cancel signal aborts at the next loop boundary and
    // returns the partial work as an honest 'aborted' result (adapters mark it
    // incomplete, not cap-exhausted). Composed locally so the DB-side console
    // cancel (onRoundComplete poll above) can abort the same loop.
    signal: localAbort.signal,
    // R1 flip: partitioned groups from partitionParallelSafeBatch may now
    // dispatch up to 4 calls concurrently WITHIN a group; groups still run
    // sequentially in emitted order, and approval-gated/interactive/unknown
    // tools remain sequential barriers (their groups are size 1). Ordering
    // to the model is preserved by index reassembly — agentExecutionCore
    // reassembles results by original tool_use index and runWithConcurrency
    // is an index-stable pool. Interactive rounds (loop-level approval gate
    // present) force concurrency 1 in the core, so gated lanes like RoomsTab
    // stay fully sequential.
    parallelToolConcurrency: 4,
    toolApprovalGate: args.toolApprovalGate
      ? createLegacyApprovalGateAdapter(args.toolApprovalGate, (toolUseId) => rejectedToolUseIds.add(toolUseId))
      : undefined,
    onRoundComplete,
    onEvent: (event) => {
      // Flywheel telemetry (P11 fix): the agent_run_events adapter
      // (agentRunPersistence.createPersistedRun) was never wired to this
      // live loop — the table sat EMPTY in production, so the BlackSwan
      // tool-trace exporter had nothing to read. Persist the three trace
      // kinds here, fire-and-forget; payload shapes are in LOCKSTEP with
      // scripts/blackswan-llm/export_tool_traces.py (pairing by
      // tool_use_id) and agentRunPersistence's documented shapes.
      if (args.runId) {
        try {
          // Route-decision telemetry, emitted exactly once per run at the
          // first event (fire-and-forget, same discipline as the trace
          // inserts below). `loopModel` is the resolved executor model and
          // `args.surface`/`args.mode` are the lane facts known at this seam;
          // confidence is unknown here (no plan) → band 'unknown', which is
          // honest. This makes silent route mis-classification observable.
          if (!emittedRouteDecision) {
            emittedRouteDecision = true;
            const routeRecord = buildRouteDecisionRecordFromRuntime({
              lane: args.mode ? `${args.surface}:${args.mode}` : args.surface,
              executionKind: 'run_openswan',
              model: loopModel,
              confidence: null,
              source: 'openswan_session_runtime',
              // Make the (previously silent) capability swap observable in the
              // run event stream. capabilityFallback.reason is already bounded +
              // secret-safe (gap enums + the safe substitute literal only — never
              // the raw picked id), so it's safe to persist here.
              note: capabilityFallback.substituted
                ? `${capabilityFallback.reason}; allowed tools: ${args.allowedToolNames.length}`
                : `allowed tools: ${args.allowedToolNames.length}`,
            });
            void supabase.from('agent_run_events').insert({
              run_id: args.runId,
              kind: 'route_decision',
              payload: buildRouteDecisionTelemetryPayload(routeRecord),
            }).then(() => {}, () => {});
          }
          if (event.kind === 'tool_call_start') {
            void supabase.from('agent_run_events').insert({
              run_id: args.runId,
              kind: 'tool_call_start',
              payload: {
                iteration: event.iteration,
                tool: event.toolName,
                tool_use_id: event.toolUseId,
                input: summarizeToolInputForPersistence(event.toolName, event.input),
              },
            }).then(() => {}, () => {});
          } else if (event.kind === 'tool_call_result') {
            const traceResult = event.result as { ok?: boolean; error?: string } | undefined;
            void supabase.from('agent_run_events').insert({
              run_id: args.runId,
              kind: 'tool_call_result',
              payload: {
                iteration: event.iteration,
                tool: event.toolName,
                tool_use_id: event.toolUseId,
                ok: traceResult?.ok === true,
                duration_ms: event.durationMs,
                ...(traceResult && traceResult.ok !== true && traceResult.error
                  ? {
                      error: PERSISTED_TOOL_FAILURE_TEXT,
                      error_code: 'tool_call_failed',
                      redacted: true,
                    }
                  : {}),
              },
            }).then(() => {}, () => {});
          } else if (event.kind === 'final_response') {
            void supabase.from('agent_run_events').insert({
              run_id: args.runId,
              kind: 'final_response',
              payload: {
                iteration: event.iteration,
                text: String(event.text || '').slice(0, 1500),
              },
            }).then(() => {}, () => {});
          }
        } catch { /* telemetry must never break the loop */ }
      }
      if (event.kind === 'tool_call_start') {
        pendingToolInputs.set(event.toolUseId, event.input);
      } else if (event.kind === 'tool_call_result') {
        const input = pendingToolInputs.get(event.toolUseId);
        pendingToolInputs.delete(event.toolUseId);
        toolEvents.push(buildLegacyToolEventFromResult({
          toolName: event.toolName,
          input,
          result: event.result,
          rejectedByGate: rejectedToolUseIds.has(event.toolUseId),
        }));
      } else if (event.kind === 'turn_end') {
        accumulateLoopUsage(usageAcc, event.usage);
      }
      // R12 note: `iteration_complete` message snapshots are available here;
      // the resumable checkpoint the transcript persists is built from
      // toolEvents on cap exhaustion (buildLegacyToolLoopResult), matching
      // what the legacy loop stored and what toolLoopResume reads back.
      // Honest step denominator: share the turn's resolved round cap so run
      // labels read "step i of N" (+ ' — wrapping up' near/at the cap) instead
      // of an open-ended counter. Label-only — no loop behavior change.
      const stage = mapAgentEventToOpenSwanStage(event, { maxRounds });
      if (stage) args.onStage?.(stage.stage, stage.label);
    },
    // T2 progressive disclosure: when tools-first is ON this resolver returns
    // the deferred tools the model has unlocked via `tools.search` so far and
    // runAgent merges them additively each turn; when OFF it is `undefined`
    // (set above) and runAgent skips it entirely — exact legacy behavior.
    resolveAdditionalTools,
    // T8 policy provider — serves BOTH duties since the R1 flip above:
    // (1) replay safety — each tool's catalog side-effect policy feeds the
    // core's replay-safety gate, so an outcome-unknown failure of a mutating
    // tool gets "verify first / do not replay" instead of "a single retry is
    // OK"; and (2) parallel partitioning — partitionParallelSafeBatch uses
    // the same policies to group only auto-approved, no-external-side-effect,
    // read-only-or-disjoint-domain calls for concurrent dispatch (up to 4).
    toolParallelPolicyProvider: createOpenSwanToolParallelPolicyProvider({ activePluginIds: args.activePluginIds }),
  }).finally(() => { stopLoopHeartbeat?.(); });

  // Legacy parity: the cap was hit on a pure tool_use round — the final
  // round's results were pushed to history but no turn consumed them, so the
  // model never answered. Give it one finalization call in true P62 shape:
  // the turn's REAL tool defs (the exact `assembledTools` advertised in the
  // loop — always non-empty; both progressive and full-catalog branches above
  // return early when empty) PLUS an explicit "no more tools — wrap up now"
  // steer, so the model produces a clean final message referencing the
  // completed results instead of being handed `tools: []` (which after P64/A2
  // rides the tool-less relay leg and can't produce the intended wrap-up).
  // Fail-safe: any error (or a model that still emits tool_use, leaving no
  // text) falls back to the limit note in buildLegacyToolLoopResult.
  let finalizationText: string | null = null;
  if (!edgeFailed && needsCapExhaustionFinalization(runResult)) {
    try {
      const finalToken = await getFreshAccessToken();
      const { data: finalData } = await supabase.functions.invoke('swanbot-ai', {
        headers: finalToken ? { Authorization: `Bearer ${finalToken}` } : undefined,
        body: buildCapExhaustionFinalizationBody({
          userMessage: args.userMessage,
          circleId: args.circleId,
          userId: args.userId,
          model: loopModel,
          systemPrompt: args.systemPrompt,
          tools: toAnthropicToolShapes(assembledTools),
          messages: runResult.messages,
          agentSubject: args.agentSubject,
        }),
      });
      finalizationText = extractAssistantText((finalData as any)?.content)
        || String((finalData as any)?.response || '');
    } catch { /* fall back to the limit note */ }
  }

  // Verification receipt (audit + user-facing): assemble a coding-lane
  // proof-of-work summary (files edited, checks passed, committed) from this
  // run's tool events. Emitted as best-effort telemetry AND surfaced on the
  // loop result so the chat message can show an honest receipt line.
  // Boolean-only, secret-safe, never blocks.
  let verificationReceipt: import('./verificationReceiptCore').VerificationReceipt | null = null;
  try {
    const { buildVerificationReceipt } = await import('./verificationReceiptCore');
    const receipt = buildVerificationReceipt({ editedFiles: toolEvents, checks: toolEvents, commit: toolEvents });
    if (receipt.editedFiles.length > 0 || receipt.checks.length > 0) {
      verificationReceipt = receipt;
      if (args.runId) {
        void supabase.from('agent_run_events').insert({
          run_id: args.runId,
          kind: 'verification_receipt',
          payload: {
            verdict: receipt.verdict,
            editedFiles: receipt.editedFiles.slice(0, 40),
            checks: receipt.checks.slice(0, 20),
            committed: receipt.committed,
            ...(receipt.commitRef ? { commitRef: receipt.commitRef } : {}),
            summary: receipt.summary,
          },
        }).then(() => {}, () => {});
      }
    }
  } catch { /* receipt is best-effort — never break the turn */ }

  const legacyResult = buildLegacyToolLoopResult({
    runResult,
    toolEvents,
    routing,
    maxRounds,
    edgeFailed,
    finalizationText,
    usage: finalizeLoopUsage(usageAcc),
    verificationReceipt,
  });
  // FAIL-VISIBLE: prepend the capability-substitution notice (blank-line
  // separated, mirroring the main-chat delegate-executor notice) so a swapped
  // model is never silent to the user. filter(Boolean) keeps an empty / edge-fail
  // response from leaving a dangling separator (notice stands alone).
  const withNotice: LegacyToolLoopResult = substitutionNotice
    ? { ...legacyResult, response: [substitutionNotice, legacyResult.response].filter(Boolean).join('\n\n') }
    : legacyResult;
  // Honest STOP: a user cancel (signal abort or DB-side console cancel) is a
  // distinct outcome from cap-exhaustion `incomplete` — surface it so the
  // session finalization writes 'cancelled' instead of 'completed'.
  return runResult.aborted === true || dbCancelled
    ? { ...withNotice, cancelled: true }
    : withNotice;
}

type OpenSwanUsageLike = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  // GAP-2: cache read vs creation split (present on the typed-loop usage from
  // finalizeLoopUsage; absent on legacy/delegated usage shapes).
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
} | null | undefined;

type OpenSwanTokenTotals = {
  input: number;
  output: number;
  cached: number;
  // GAP-2: preserve the read/creation split for run metadata. `cached` stays
  // the aggregate for the existing cached_tokens column.
  cacheRead: number;
  cacheCreation: number;
};

function emptyOpenSwanTokenTotals(): OpenSwanTokenTotals {
  return { input: 0, output: 0, cached: 0, cacheRead: 0, cacheCreation: 0 };
}

function addOpenSwanUsageTotals(target: OpenSwanTokenTotals, usage: OpenSwanUsageLike): void {
  if (!usage) return;
  const input = Math.max(0, Math.floor(usage.input_tokens || 0));
  const output = Math.max(0, Math.floor(usage.output_tokens || 0));
  const total = typeof usage.total_tokens === 'number' && Number.isFinite(usage.total_tokens)
    ? Math.max(0, Math.floor(usage.total_tokens))
    : null;
  target.input += input;
  target.output += output;
  target.cached += total == null ? 0 : Math.max(0, total - input - output);
  target.cacheRead += Math.max(0, Math.floor(usage.cache_read_tokens || 0));
  target.cacheCreation += Math.max(0, Math.floor(usage.cache_creation_tokens || 0));
}

export async function runOpenSwanSessionTurn(opts: OpenSwanTurnOptions): Promise<OpenSwanTurnResult> {
  const cleanMessage = opts.message.replace(/@(agent|blackswan|swanbot|swan)\s*/gi, '').trim() || opts.message;
  const { analyzeMessageRouting } = await import('./messageRouting');
  const { entities, route: runtimeRoute } = analyzeMessageRouting(
    cleanMessage,
    opts.surface === 'main_chat' ? 'main_chat' : 'room_chat',
  );
  const profile = opts.sessionProfile || detectAgenticCodingProfile(cleanMessage, opts.surface);
  const effectiveDelegationMode = resolveEffectiveDelegationMode(opts.delegationMode || 'auto', profile);
  const modePolicy = getOpenSwanModePolicy(opts.mode || 'talk');
  const modeResponseContract = buildOpenSwanModeResponseContract(opts.mode || 'talk');
  const agentDevelopmentStandards = summarizeRelevantAgentDevelopmentStandards(cleanMessage, { mode: opts.mode || null });
  const standardsPrompt = buildRelevantAgentDevelopmentStandardsPromptBlock(cleanMessage, { mode: opts.mode || null });
  const pipelinePrompt = buildUserTaskPipelinePromptBlock(cleanMessage, { limit: 3 });
  const computerRequestRoutePrompt = buildChatComputerRequestRoutePromptBlock(cleanMessage);
  const computerAppStrategyPrompt = buildComputerAppTaskStrategyPromptBlock(cleanMessage);
  const computerAppGroundingPrompt = buildComputerAppGroundingPromptBlock(cleanMessage);
  const computerAppReceiptPrompt = buildComputerAppExecutionReceiptPromptBlock(cleanMessage);
  const designAppAutomationPrompt = buildDesignAppAutomationPromptBlock(cleanMessage);
  const designExecutionPipelinePrompt = buildDesignAppExecutionPipelinePromptBlock(cleanMessage);
  const designCreativeAiPrompt = buildDesignAppCreativeAiPromptBlock(cleanMessage);
  const designCreativeAiRecipePrompt = buildDesignAppCreativeAiRecipePromptBlock(cleanMessage);
  const designObjectManifestPrompt = buildDesignAppObjectManifestPromptBlock(cleanMessage);
  const designOperationRunbookPrompt = buildDesignAppOperationRunbookPromptBlock(cleanMessage);
  const designProofReviewPrompt = buildDesignAppProofReviewPromptBlock(cleanMessage);
  const engineeringCadOperationRunbookPrompt = buildEngineeringCadOperationRunbookPromptBlock(cleanMessage);
  const prompt = [
    modeResponseContract,
    standardsPrompt,
    pipelinePrompt,
    computerRequestRoutePrompt,
    computerAppStrategyPrompt,
    computerAppGroundingPrompt,
    computerAppReceiptPrompt,
    designAppAutomationPrompt,
    designExecutionPipelinePrompt,
    designCreativeAiPrompt,
    designCreativeAiRecipePrompt,
    designObjectManifestPrompt,
    designOperationRunbookPrompt,
    designProofReviewPrompt,
    engineeringCadOperationRunbookPrompt,
    buildAgenticCodingPrompt(cleanMessage, { surface: opts.surface, profile }),
  ].filter(Boolean).join('\n\n');
  const runSurface = opts.runSurface || opts.surface;
  const runtimeSubject = buildAgentRuntimeSubject({
    id: opts.context.agentSubjectKey || opts.context.agentId || `openswan:${opts.surface}`,
    name: opts.context.agentName || 'OpenSwan',
    sessionKey: opts.context.agentSessionKey || opts.context.agentSubjectKey || opts.context.agentId || undefined,
    providerType: 'openswan' as any,
    spirit: opts.context.spiritId || undefined,
  }, {
    dbAgentId: opts.context.agentDbId || null,
  });
  const runtimeMemoryAliases = Array.from(new Set([
    ...runtimeSubject.memoryAgentAliases,
    ...(opts.context.agentLegacyIds || []),
  ].map(value => String(value || '').trim()).filter(Boolean)));
  const runtimeRunAliases = Array.from(new Set([
    ...runtimeSubject.runAgentAliases,
    ...(opts.context.agentLegacyIds || []),
  ].map(value => String(value || '').trim()).filter(Boolean)));
  const taskPlan = buildOpenSwanTaskPlan(cleanMessage, profile, entities);
  const runtimeToolNames = selectRuntimeToolNames(taskPlan, opts.mode || null);
  const toolRoundBudget = getToolRoundBudget(taskPlan, opts.mode || null);
  const { resolveModelForProfile } = await import('./serviceProfileSouls');
  const connectedProviders = normalizeConnectedProviders(opts.connectedProviders);
  const resolvedModel = resolveModelForProfile(
    profile as any,
    opts.context.model,
    runtimeRoute.intent,
    connectedProviders,
    runtimeRoute.complexity,
    undefined,
    // P27: raw message activates the BlackSwan reliability guard on the
    // EXECUTION model — the hard subset of the grounded lane escalates to frontier.
    cleanMessage,
  );
  // Coding-agent P5 plan/execute split: when a COMPLEX build/debug/review turn
  // lands on a strong-coder model (and the user didn't pin a model), run a
  // text-only planner turn on that strong model, then drive the tool loop on a
  // fast executor. Fail-closed to today's single-model path (flag default ON;
  // the decider gates on intent/complexity/tools/tier/explicit-pick).
  const { decideCodingModelSplit, buildCodingPlannerPrompt } = await import('./codingModelSplitPolicy');
  const codingSplitDecision = decideCodingModelSplit({
    intent: runtimeRoute.intent,
    complexity: runtimeRoute.complexity,
    selectedModel: opts.context.model,
    resolvedModel: resolvedModel || 'claude-haiku-4-5',
    allowedToolNames: runtimeToolNames,
    connectedProviders,
  });
  const codingPlanSplit = codingSplitDecision.mode === 'plan_then_execute'
    ? {
        plannerModelId: codingSplitDecision.plannerModelId!,
        executorModelId: codingSplitDecision.executorModelId!,
        plannerPrompt: buildCodingPlannerPrompt({ message: cleanMessage, profile }),
        reason: codingSplitDecision.reason,
      }
    : null;
  const toolBrief = buildOpenSwanToolBrief(
    opts.surface === 'main_chat' ? 'main_chat' : 'room_chat',
    taskPlan,
    opts.activePluginIds,
  );
  const reasoningSettings = getOpenSwanReasoningSettings(taskPlan, runtimeRoute.complexity);
  const { soulKeyForProfile } = await import('./serviceProfileSouls');
  const activeSoulKey = soulKeyForProfile(profile);
  const { resolveOpenSwanSkills } = await import('./openswanSkills');
  const skillResolution = await resolveOpenSwanSkills({
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    soulKey: activeSoulKey,
    mode: opts.mode || 'talk',
    taskKind: taskPlan.kind,
    query: prompt,
    maxSkills: taskPlan.kind === 'research' ? 8 : 6,
  });
  const delegationSpecs =
    effectiveDelegationMode === 'focused'
      ? []
      : effectiveDelegationMode === 'parallel'
        ? planSubagentDelegation(cleanMessage, taskPlan, { activePluginIds: opts.activePluginIds })
        : shouldDelegateToSubagents(cleanMessage, taskPlan)
          ? planSubagentDelegation(cleanMessage, taskPlan, { activePluginIds: opts.activePluginIds })
          : [];
  const delegatedAgents: OpenSwanDelegatedAgentDescriptor[] = delegationSpecs.map((spec) => ({
    name: spec.subagent.displayName,
    icon: spec.subagent.icon,
    color: spec.subagent.color,
    role: spec.subagent.role,
  }));
  const totalSteps = 7 + delegationSpecs.length;

  emitStage(opts, 'booting', 'Booting OpenSwan session');

  const run = opts.context.circleId
    ? await createRun({
        circleId: opts.context.circleId,
        userId: opts.context.userId,
        surface: runSurface,
        roomId: opts.roomId,
        taskId: opts.taskId,
        chatSessionId: opts.chatSessionId || undefined,
        title: opts.title || cleanMessage.slice(0, 100) || 'OpenSwan Session',
        goal: opts.goal || cleanMessage.slice(0, 500),
        mode: opts.mode || 'talk',
        model: resolvedModel || undefined,
        provider: 'openswan',
        metadata: {
          runtimePlanVersion: OPENSWAN_RUNTIME_PLAN_VERSION,
          surface: opts.surface,
          profile,
          explicitMode: modePolicy.key,
          modeLabel: modePolicy.label,
          modeDescription: modePolicy.description,
          modeOutcome: modePolicy.outcome,
          modeResponseContract: modePolicy.responseContract || null,
          agentDevelopmentStandards,
          taskKind: taskPlan.kind,
          taskPipeline: taskPlan.pipeline || null,
          taskPipelineDecision: taskPlan.pipelineDecision || null,
          scenarioPolicy: taskPlan.scenarioPolicy || null,
          surfacePlan: taskPlan.surfacePlan || null,
          ledgerPreview: taskPlan.ledgerPreview || null,
          failureAssessment: taskPlan.failureAssessment || null,
          computerAppStrategy: taskPlan.computerAppStrategy || null,
          computerAppGrounding: taskPlan.computerAppGrounding || null,
          computerAppGroundingRunbook: taskPlan.computerAppGroundingRunbook || null,
          computerAppGroundingNextStep: taskPlan.computerAppGroundingNextStep || null,
          computerAppGroundingTrace: taskPlan.computerAppGroundingTrace || null,
          runtimeToolNames,
          toolRoundBudget,
          activeSkills: skillResolution.skills.map((skill) => ({
            name: skill.name,
            displayName: skill.displayName,
            source: skill.source,
          })),
          delegationMode: effectiveDelegationMode,
          verificationPlan: taskPlan.verification,
          recommendedTools: taskPlan.recommendedTools,
          connectedProviders: connectedProviders ? Array.from(connectedProviders) : [],
          ...(opts.metadata || {}),
          // Run-reaper opt-in (fail-safe floor): mark this run reap-eligible so
          // the dashboard reapers (OpenSwanConsole / AgentRunsPanel, both gated
          // on metadata.heartbeat===true) may flip a dead-heartbeat zombie to
          // 'failed'. Placed AFTER the opts spread so a caller can't clear it.
          // The lifetime heartbeat started right after createRun keeps
          // updated_at fresh for the WHOLE turn so a live run is never reaped.
          heartbeat: true,
          agentSubjectKey: runtimeSubject.subjectKey,
          agentId: runtimeSubject.runAgentId,
          agentName: runtimeSubject.displayName,
          agentDisplayName: runtimeSubject.displayName,
          agentDbId: runtimeSubject.dbAgentId,
          agentSessionKey: runtimeSubject.sessionKey,
          legacyAgentIds: runtimeSubject.legacyIds,
          agentLegacyIds: runtimeSubject.legacyIds,
          runAgentAliases: runtimeRunAliases,
          memoryAgentAliases: runtimeMemoryAliases,
          agentSubject: runtimeSubject.metadata,
        },
      })
    : null;

  // Deferred-telemetry handles, declared at function scope so BOTH the normal
  // join barrier (inside the try) and the outer catch's finalize-on-throw can
  // settle any in-flight 'running' status write before the terminal write —
  // otherwise a late updateRunProgressUnlessCancelled could resurrect the row.
  const pendingTelemetry: Array<Promise<unknown>> = [];

  // ── Run-reaper wire (lifetime heartbeat + finalize-on-throw) ──────────────
  // This runtime does NOT go through agentRunPersistence.createPersistedRun, and
  // the tool-loop heartbeat (in runTypedCoreToolLoop) only covers the loop
  // itself — the pre-loop delegateToSubagents + buildOpenSwanMemoryStores
  // windows can legally outlast RUN_STALL_DEAD_MS with no write, so a reaper
  // could false-kill a genuinely live long-delegating run. Beat
  // agent_runs.updated_at on wall-clock time for the WHOLE turn lifetime,
  // stopped in the outer finally on every exit (return / throw). Pairs with
  // metadata.heartbeat:true above (reaper opt-in). The try/catch below finalizes
  // a thrown turn as 'failed' (cancel-guarded) instead of leaving the row stuck
  // at 'running'. NOTE: the wrapped body keeps its original indentation to make
  // this a surgical wrap (single-exit function; repo has no formatter).
  const stopRunHeartbeat = run ? startRunHeartbeat(run.id) : null;
  try {

  // ── Telemetry defer (hot-path R2): take the ~7 serial pre-loop Supabase
  // telemetry writes off time-to-first-token. planTelemetrySchedule (pure
  // core, openswanTelemetryDeferCore) decides per write: blocking
  // (fail-closed), ordered chain, or loose fire-and-forget. The static
  // descriptor list below yields two ordered chains — status step0→step2
  // (whole-column status writes on the same row must not reorder) and
  // metadata transcript_ptr→posture (mergeRunMetadata is a non-atomic
  // read-merge-write; concurrent merges drop keys) — plus 3 independent
  // addStep inserts that fire loose.
  //
  // Deferral = NOT AWAITED, not delayed: each write STARTS immediately at its
  // original call site (keeping today's cancel-race window identical), and
  // the join barrier right after the tool loop awaits them all BEFORE any
  // finalization write, so no deferred 'running' status or metadata merge can
  // land after/concurrent with the terminal writes.
  const telemetrySchedule = planTelemetrySchedule([
    { id: 'status_step0', kind: 'update_status' },
    { id: 'merge_transcript_ptr', kind: 'merge_metadata' },
    { id: 'step_plan', kind: 'add_step' },
    { id: 'step_context', kind: 'add_step' },
    { id: 'step_thinking', kind: 'add_step' },
    { id: 'status_step2', kind: 'update_status', dependsOn: ['status_step0'] },
    { id: 'merge_posture', kind: 'merge_metadata', dependsOn: ['merge_transcript_ptr'] },
  ]);
  const telemetryBlockingIds = new Set(telemetrySchedule.blocking);
  const telemetryLooseIds = new Set(telemetrySchedule.fireAndForget);
  const telemetryChainByWriteId = new Map<string, number>();
  telemetrySchedule.deferredOrdered.forEach((chain, chainIndex) => {
    for (const writeId of chain) telemetryChainByWriteId.set(writeId, chainIndex);
  });
  const telemetryChainTails = new Map<number, Promise<unknown>>();
  /**
   * Start a telemetry write per the schedule. Returns a promise the call site
   * awaits: for deferred writes it resolves immediately (write started, not
   * awaited); for anything the core classified as blocking — or any id the
   * schedule does not know — it returns the write itself (fail-closed).
   */
  const deferTelemetry = (writeId: string, write: () => Promise<unknown>): Promise<unknown> => {
    const chainIndex = telemetryChainByWriteId.get(writeId);
    if (telemetryBlockingIds.has(writeId) || (chainIndex === undefined && !telemetryLooseIds.has(writeId))) {
      return write();
    }
    let started: Promise<unknown>;
    if (chainIndex !== undefined) {
      const tail = telemetryChainTails.get(chainIndex) || Promise.resolve();
      started = tail.then(() => write()).catch(() => undefined);
      telemetryChainTails.set(chainIndex, started);
    } else {
      started = write().catch(() => undefined);
    }
    pendingTelemetry.push(started);
    return Promise.resolve();
  };
  /**
   * Settle a deferred chain up to (and including) the named write before an
   * awaited same-row write runs, so a still-in-flight chained write cannot
   * land after — and clobber — the awaited one (step-index regression /
   * dropped mergeRunMetadata keys). Chain promises already swallow errors via
   * .catch, so this never throws.
   */
  const awaitTelemetryChain = (writeId: string): Promise<unknown> => {
    const chainIndex = telemetryChainByWriteId.get(writeId);
    if (chainIndex === undefined) return Promise.resolve();
    return telemetryChainTails.get(chainIndex) ?? Promise.resolve();
  };

  if (run && opts.context.circleId) {
    void persistAgentRunLedgerPreview({
      preview: taskPlan.ledgerPreview,
      actualRunId: run.id,
      circleId: opts.context.circleId,
      userId: opts.context.userId,
      outcomeStatus: 'running',
      source: 'openswan_session_start',
    }).catch(() => undefined);
  }

  const transcriptKey = buildOpenSwanTranscriptKey({
    runId: run?.id,
    chatSessionId: opts.chatSessionId || null,
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    surface: runSurface,
  });
  let transcript = await upsertOpenSwanTranscriptHeader({
    transcriptKey,
    runId: run?.id,
    chatSessionId: opts.chatSessionId || null,
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    surface: runSurface,
    taskKind: taskPlan.kind,
    profile,
    title: opts.title || cleanMessage.slice(0, 100) || 'OpenSwan Session',
  });
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'session_started',
    title: 'OpenSwan session started',
    summary: `Profile ${profile} / task ${taskPlan.kind}`,
    data: {
      runId: run?.id || null,
      recommendedTools: taskPlan.recommendedTools.map((tool) => tool.tool),
      taskPipeline: taskPlan.pipeline || null,
      taskPipelineDecision: taskPlan.pipelineDecision || null,
      computerAppStrategy: taskPlan.computerAppStrategy || null,
      computerAppGrounding: taskPlan.computerAppGrounding || null,
      computerAppGroundingRunbook: taskPlan.computerAppGroundingRunbook || null,
      computerAppGroundingNextStep: taskPlan.computerAppGroundingNextStep || null,
      computerAppGroundingTrace: taskPlan.computerAppGroundingTrace || null,
      agentDevelopmentStandards,
      verificationPlan: taskPlan.verification.map((check) => ({
        label: check.label,
        kind: check.kind,
        required: check.required,
      })),
    },
  })) || transcript;
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'user_turn',
    title: 'User request received',
    summary: cleanMessage.slice(0, 280),
    data: {
      originalMessage: opts.message.slice(0, 2000),
    },
  })) || transcript;

  if (run && opts.context.circleId) {
    const runId = run.id;
    await deferTelemetry('status_step0', () =>
      updateRunProgressUnlessCancelled(runId, { current_step_index: 0, total_steps: totalSteps }));
    // Snapshot the payload NOW — the deferred closure must not read transcript
    // state mutated by later appends.
    const transcriptPtr = {
      openswanTranscriptKey: transcriptKey,
      openswanTranscriptEventCount: transcript.events.length,
      openswanTranscriptUpdatedAt: transcript.updatedAt,
    };
    await deferTelemetry('merge_transcript_ptr', () => mergeRunMetadata(runId, transcriptPtr));
    const stepPlanCircleId = opts.context.circleId;
    await deferTelemetry('step_plan', () => addStep({
      runId,
      circleId: stepPlanCircleId,
      stepIndex: 0,
      stepKind: 'plan',
      title: 'OpenSwan session turn',
      body: [
        cleanMessage.slice(0, 2500),
        '',
        `Task profile: ${taskPlan.summary}`,
        '',
        ...(agentDevelopmentStandards
          ? [
              'Agent development standards:',
              `- ${agentDevelopmentStandards.title}`,
              ...agentDevelopmentStandards.standardDocPaths.map((docPath) => `- ${docPath}`),
              '',
            ]
          : []),
        '',
        'Verification plan:',
        ...taskPlan.verification.map((check) => `- ${check.required ? '[required]' : '[optional]'} ${check.label}: ${check.reason}`),
        '',
        toolBrief,
      ].join('\n').slice(0, 5000),
    }));
  }

  emitStage(opts, 'loading_context', 'Loading context', run?.id);
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'context_loaded',
    title: 'Context assembled',
    summary: `${taskPlan.recommendedTools.length} recommended tool(s), ${taskPlan.verification.length} verification check(s)`,
    data: {
      recommendedTools: taskPlan.recommendedTools.map((tool) => ({
        tool: tool.tool,
        priority: tool.priority,
      })),
      verification: taskPlan.verification.map((check) => ({
        label: check.label,
        required: check.required,
      })),
      agentDevelopmentStandards,
    },
  })) || transcript;
  if (run && opts.context.circleId) {
    const runId = run.id;
    const circleId = opts.context.circleId;
    const contextBody = (opts.context.chatHistory || '').slice(0, 5000);
    await deferTelemetry('step_context', () => addStep({
      runId,
      circleId,
      stepIndex: 1,
      stepKind: 'context_edit',
      title: 'Context assembled',
      body: contextBody,
    }));
    await deferTelemetry('step_thinking', () => addStep({
      runId,
      circleId,
      stepIndex: 2,
      stepKind: 'thinking',
      title: 'Task and verification plan',
      body: [
        `Task kind: ${taskPlan.kind}`,
        `Profile: ${taskPlan.profile}`,
        taskPlan.pipeline ? `Pipeline: ${taskPlan.pipeline.title} (${taskPlan.pipeline.id})` : 'Pipeline: none',
        taskPlan.pipelineDecision ? `Pipeline pattern: ${taskPlan.pipelineDecision.pattern} / risk ${taskPlan.pipelineDecision.aggregateRisk}` : '',
        taskPlan.computerAppStrategy ? `Computer/app strategy: ${taskPlan.computerAppStrategy.label} (${taskPlan.computerAppStrategy.id})` : '',
        taskPlan.computerAppGrounding ? `Grounding: ${taskPlan.computerAppGrounding.primarySurface} / ${taskPlan.computerAppGrounding.observationRules.map((item) => item.tool).join(', ')}` : '',
        taskPlan.computerAppGroundingRunbook ? `Grounding runbook steps: ${taskPlan.computerAppGroundingRunbook.steps.length}` : '',
        taskPlan.computerAppGroundingNextStep ? `Grounding next step: ${taskPlan.computerAppGroundingNextStep.kind} ${taskPlan.computerAppGroundingNextStep.tool || ''}` : '',
        taskPlan.computerAppGroundingTrace ? `Grounding trace status: ${taskPlan.computerAppGroundingTrace.status}` : '',
        '',
        'Recommended tools:',
        ...taskPlan.recommendedTools.map((tool) => `- ${tool.tool} [${tool.priority}]: ${tool.reason}`),
      ].join('\n').slice(0, 5000),
    }));
    await deferTelemetry('status_step2', () =>
      updateRunProgressUnlessCancelled(runId, { current_step_index: 2, total_steps: totalSteps }));
  }

  let delegationSummary = '';
  const delegatedUsageTotals = emptyOpenSwanTokenTotals();
  if (delegationSpecs.length > 0 && opts.context.circleId) {
    opts.onDelegationPlan?.(delegatedAgents);
    emitStage(opts, 'delegating', `Delegating to ${delegationSpecs.map((spec) => spec.subagent.displayName).join(', ')}`, run?.id);
    transcript = (await appendTranscriptEvent(transcriptKey, {
      kind: 'delegation_planned',
      title: 'Delegation planned',
      summary: delegationSpecs.map((spec) => spec.subagent.displayName).join(', '),
      data: {
        specs: delegationSpecs.map((spec) => ({
          displayName: spec.subagent.displayName,
          role: spec.subagent.role,
          reason: spec.reason,
        })),
      },
    })) || transcript;

    if (run) {
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: 3,
        stepKind: 'delegation',
        title: 'Sub-agent delegation plan',
        body: delegationSpecs.map((spec) => `- ${spec.subagent.displayName}: ${spec.reason}`).join('\n').slice(0, 5000),
      });
      // Settle the deferred status chain (step0→step2) first so a
      // still-in-flight chained write cannot land after this awaited write
      // and regress current_step_index from 3 back to 2 (or 0).
      await awaitTelemetryChain('status_step2');
      await updateRunProgressUnlessCancelled(run.id, { current_step_index: 3, total_steps: totalSteps });
    }

    const delegated = await delegateToSubagents({
      circleId: opts.context.circleId,
      userId: opts.context.userId,
      userName: opts.context.userName,
      surface: runSurface,
      message: cleanMessage,
      specs: delegationSpecs,
      parentRunId: run?.id,
      model: opts.context.model || undefined,
      chatHistory: opts.context.chatHistory,
      roomId: opts.roomId,
      parentAgentId: runtimeSubject.runAgentId,
      parentMode: opts.mode || null,
    });
    for (const result of delegated.results) {
      addOpenSwanUsageTotals(delegatedUsageTotals, result.usage);
    }

    // CA-8d summary-only contract: use each child's redacted `summary`
    // (≤1200 chars) rather than the full `response`. The full response
    // lives in the Run Ledger via addStep below — operators get the
    // full trace, the parent LLM gets the digest. Without this cap a
    // single verbose child could blow the 12000-char slice and starve
    // the others.
    delegationSummary = delegated.results.map((result, index) => {
      const spec = delegated.specs[index];
      return [
        `### ${spec.subagent.displayName}`,
        `Reason: ${spec.reason}`,
        result.summary ?? result.response,
        ...summarizeDelegatedArtifacts(result.artifacts || []),
      ].join('\n');
    }).join('\n\n').slice(0, 12000);
    transcript = (await appendTranscriptEvent(transcriptKey, {
      kind: 'delegation_completed',
      title: 'Delegation completed',
      summary: `${delegated.results.length} sub-agent result(s) merged`,
      data: {
        results: delegated.results.map((result) => ({
          role: result.subagent.role,
          displayName: result.subagent.displayName,
          runId: result.runId || null,
          artifactCount: result.artifacts?.length || 0,
          toolActionCount: result.toolActions?.length || 0,
        })),
      },
    })) || transcript;

    if (run) {
      const delegatedArtifacts: Array<{ role: string; title: string; kind: SwanBotStructuredArtifact['kind'] }> = [];
      for (let index = 0; index < delegated.results.length; index += 1) {
        const result = delegated.results[index];
        const spec = delegated.specs[index];
        await addStep({
          runId: run.id,
          circleId: opts.context.circleId,
          stepIndex: 4 + index,
          stepKind: 'delegation',
          title: `${spec.subagent.displayName} completed`,
          body: [
            result.response.slice(0, 2200),
            ...(result.toolActions?.length
              ? [
                  '',
                  'Tool activity:',
                  ...result.toolActions.map((action) => `- [${action.status}] ${action.title || action.tool_name}`),
                ]
              : []),
            ...((result.artifacts || []).length
              ? [
                  '',
                  'Artifacts:',
                  ...(result.artifacts || []).map((artifact) => `- ${artifact.kind}: ${artifact.title}`),
                ]
              : []),
          ].join('\n').slice(0, 2500),
          delegatedTo: spec.subagent.role,
          childRunId: result.runId,
          status: 'completed',
        });
        for (const artifact of result.artifacts || []) {
          delegatedArtifacts.push({
            role: spec.subagent.role,
            title: artifact.title,
            kind: artifact.kind,
          });
          await addArtifact({
            runId: run.id,
            circleId: opts.context.circleId,
            artifactKind: mapStructuredArtifactKind(artifact.kind),
            title: `${spec.subagent.displayName}: ${artifact.title}`,
            content: artifact.content || undefined,
            url: artifact.url || undefined,
            metadata: {
              ...(artifact.metadata || {}),
              source: 'delegated_subagent',
              delegatedTo: spec.subagent.role,
              childRunId: result.runId || null,
            },
          });
        }
      }
      // Settle the deferred metadata chain (transcript_ptr) first —
      // mergeRunMetadata is a non-atomic read-merge-write, so an in-flight
      // deferred merge interleaving with this awaited one would silently drop
      // keys from one side (delegation results or the transcript pointer).
      await awaitTelemetryChain('merge_transcript_ptr');
      await mergeRunMetadata(run.id, {
        delegatedSubagentResults: delegated.results.map((result) => ({
          role: result.subagent.role,
          displayName: result.subagent.displayName,
          runId: result.runId || null,
          responsePreview: result.response.slice(0, 500),
          artifacts: (result.artifacts || []).map((artifact) => ({
            kind: artifact.kind,
            title: artifact.title,
          })),
          toolActions: (result.toolActions || []).map((action) => ({
            tool: action.tool_name,
            title: action.title,
            status: action.status,
          })),
          memoryReferences: summarizeMemoryReferences(result.memoryReferences || []),
          usage: result.usage || null,
        })),
        delegatedArtifactSummary: delegatedArtifacts,
      });
      await updateRunProgressUnlessCancelled(run.id, { current_step_index: 4 + delegated.results.length, total_steps: totalSteps });
    }
  }

  emitStage(opts, 'reasoning', 'Reasoning over the task', run?.id);
  const memoryBundle = await buildOpenSwanMemoryStores({
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    query: cleanMessage,
    roomId: opts.roomId,
    agentId: runtimeSubject.memoryAgentId,
    agentAliases: runtimeMemoryAliases,
    agentName: runtimeSubject.displayName,
    spiritId: runtimeSubject.spiritId || opts.context.spiritId,
    surface: opts.surface,
    taskKind: taskPlan.kind,
    profile,
    runId: run?.id,
    limit: 8,
  });
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'memory_loaded',
    title: 'Memory bundle loaded',
    summary: `${memoryBundle.references.length} memory reference(s) applied`,
    data: {
      memoryReferences: summarizeMemoryReferences(memoryBundle.references),
    },
  })) || transcript;
  if (run) {
    // Posture snapshot — capture what the agent was given (mode, tools,
    // memory, subagents) so a completed run can be audited later:
    // "why did the agent refuse that" / "which tools did it see". The
    // Control Panel shows the same shape live; this persists it.
    const postureSurface: 'main_chat' | 'room_chat' | 'office' | 'task_run' =
      opts.surface === 'main_chat' ? 'main_chat'
      : opts.surface === 'room_chat' ? 'room_chat'
      : opts.surface === 'feed_task' ? 'task_run'
      : 'main_chat';
    const exposedTools = previewOpenSwanToolsForSurface(postureSurface, opts.mode || null);
    const hiddenTools = listToolsHiddenByMode(postureSurface, opts.mode || null);
    const postureRunId = run.id;
    await deferTelemetry('merge_posture', () => mergeRunMetadata(postureRunId, {
      runtimePlanVersion: OPENSWAN_RUNTIME_PLAN_VERSION,
      memoryReferences: summarizeMemoryReferences(memoryBundle.references),
      memoriesUsed: memoryBundle.references.map((ref) => ref.title),
      memoryContextPreview: memoryBundle.combined.slice(0, 1200),
      spiritId: runtimeSubject.spiritId || opts.context.spiritId || null,
      posture: {
        mode: opts.mode || null,
        surface: postureSurface,
        toolsExposed: exposedTools.length,
        toolsHiddenByMode: hiddenTools.length,
        hiddenToolNames: hiddenTools.map((t) => t.name),
        subagentsPlanned: delegationSpecs.length,
        subagentRoles: delegationSpecs.map((s) => s.subagent.role),
        runtimeToolNames,
        toolRoundBudget,
      },
    }));
  }
  const assistantResponseStepIndex = delegationSpecs.length > 0 ? 4 + delegationSpecs.length : 3;

  // ── Stage 4+5 merged: Authoritative tool-calling loop ──────────────
  // Uses Anthropic native tool_use as the primary execution mechanism.
  // The model decides which tools to call mid-turn; the client dispatches
  // them locally via the 52+ tool registry in openswanToolRuntime.
  const surfaceForTools: 'main_chat' | 'room_chat' = opts.surface === 'main_chat' ? 'main_chat' : 'room_chat';

  let structured: SwanBotStructuredResponse;
  let runtimeToolActions: SwanBotStructuredResponse['tool_actions'] & any[] = [];
  let browserPlans: BrowserPlanCardData[] = [];
  let browserPlanEvents: BrowserPlanEvent[] = [];
  let executionStream = buildOpenSwanExecutionStream({ toolEvents: [], verificationResults: [] });
  // Honest STOP: true when the tool loop ended on a user cancel (STOP signal
  // or DB-side console cancel). Finalization then writes status 'cancelled'
  // (keeping token/cost extras) instead of overwriting the row as 'completed'.
  let turnCancelled = false;
  // Honest partial: true when the tool loop hit its per-turn step cap before a
  // final answer. The Feed proof publication then carries stopReason
  // 'max_iterations' — a failure-family stop — so a capped turn can never be
  // published as a clean completion.
  let turnIncomplete = false;
  // Proof-of-work receipt from the typed tool loop (files edited / checks /
  // commit) — surfaced on the turn result so chat can render an honest
  // receipt line instead of burying it in agent_run_events.
  let turnVerificationReceipt: import('./verificationReceiptCore').VerificationReceipt | null = null;
  // Captured while toolLoopResult is in scope: toolEvents is present on BOTH
  // loop paths (typed-core AND legacy), unlike verificationReceipt which only
  // the typed core sets. The verification-depth seam below derives its
  // changed-file set from this so depth escalation works — and the run's proof
  // is honest — even when the operator reverts to the legacy loop.
  let turnToolEvents: LegacyToolEvent[] = [];

  const runTextOnlyResponse = async () => getSwanBotStructuredResponse(prompt, {
    ...opts.context,
    model: resolvedModel,
    thinkingLevel: opts.context.thinkingLevel || reasoningSettings.thinkingLevel,
    maxTokens: opts.context.maxTokens || reasoningSettings.maxTokens,
    modeKey: opts.mode || 'talk',
    taskKind: taskPlan.kind,
    sessionProfile: taskPlan.profile,
    resolvedSkills: skillResolution.skills,
    resolvedSkillsPromptBlock: skillResolution.promptBlock,
    memoryContext: memoryBundle.combined,
    memoryStores: memoryBundle,
    memoryRefs: memoryBundle.references,
    chatHistory: [
      opts.context.chatHistory || '',
      delegationSummary ? `## Specialist Sub-Agent Results\n${delegationSummary}` : '',
    ].filter(Boolean).join('\n\n'),
  });

  try {
    emitStage(
      opts,
      'reasoning',
      runtimeToolNames.length > 0 ? 'Reasoning with tools' : 'Reasoning without tool loop',
    );

    if (runtimeToolNames.length === 0) {
      structured = await runTextOnlyResponse();
    } else {
      // Decide the loop path ONCE so the snapshot context placement matches:
      // typed-core gets the snapshot as a user-role context message (below),
      // so its system prompt suppresses the v1 dynamic-tail copy; the legacy
      // revert path keeps the v1 system-prompt injection instead.
      const typedCoreEnabled = isOpenSwanTypedCoreEnabled();

      // Circle Context Snapshot — pre-built index injected as a USER-ROLE
      // context message (R15/O7: volatile 60s-TTL data must stay out of the
      // frozen system prompt; mirrors skillPromptInjection). Fail-safe: any
      // build error/timeout (~1.5s) ⇒ null ⇒ the turn proceeds unchanged.
      const snapshotContextMessage = typedCoreEnabled
        ? await import('./circleSnapshotContextInjection')
            .then(({ buildCircleSnapshotContextMessage }) =>
              buildCircleSnapshotContextMessage(opts.context.circleId))
            .catch(() => null)
        : null;

      // Build the full system prompt (Blocks A-E: SOUL, wisdom, memory, attachments, skills)
      const systemPrompt = await buildStreamableSystemPrompt({
        circleId: opts.context.circleId!,
        userId: opts.context.userId,
        // X1 (P44): the assembler sees the USER'S message, not the block
        // ladder — routing complexity, retrieval/skills queries, and the
        // collaboration seam all right-size to real intent instead of ladder
        // text. The ladder stays the tool loop's userMessage below.
        currentMessage: cleanMessage,
        // The v2 lane's turns always warrant at least the moderate context
        // stack (memory/wisdom/missions) even for a short message.
        complexityFloor: 'moderate',
        model: resolvedModel || opts.context.model,
        userName: opts.context.userName,
        modeKey: opts.mode || 'talk',
        taskKind: taskPlan.kind,
        sessionProfile: taskPlan.profile,
        resolvedSkills: skillResolution.skills,
        resolvedSkillsPromptBlock: skillResolution.promptBlock,
        // Avoid double-injection: typed-core carries the snapshot as a
        // user-role message, so the v1 dynamic-tail block is suppressed.
        omitCircleContextSnapshot: typedCoreEnabled,
        // X1 single-recall: hand the assembler THIS turn's already-resolved
        // stores so it emits the fenced memory sections (incl. the P43
        // memory_user_notes section) without a second recall round-trip.
        memoryStores: memoryBundle,
        // X1 ladder dedupe: this lane carries the computer/design/pipeline
        // blocks in the user-message ladder above, so the assembler omits its
        // message-derived copies of exactly those sections (typed debt list).
        omitSections: getChatPromptLaneSpec('openswan_v2').duplicateSectionDebt,
        chatHistory: [
          opts.context.chatHistory || '',
          delegationSummary ? `## Specialist Sub-Agent Results\n${delegationSummary}` : '',
          // P43 retired the interim userNotes injection that lived here —
          // notes now arrive exactly once on every lane via the assembler's
          // fenced memory_user_notes section (from memoryStores above).
        ].filter(Boolean).join('\n\n'),
      });

      // Auto-resume: if the immediately-preceding turn hit the step cap, pull
      // its checkpoint forward so this turn continues from the last confirmed
      // observation + the failed step instead of re-deriving from the transcript.
      // (The current turn hasn't appended its own assistant_response yet, so the
      // scan correctly inspects the previous turn.) Defers to the user's new
      // message if they've moved on — see buildResumeContextBlock.
      const resumeBlock = buildResumeContextBlock(findPendingResumeCheckpoint(transcript.events));
      const systemPromptWithResume = resumeBlock ? `${systemPrompt}\n\n${resumeBlock}` : systemPrompt;

      // Mid-run steering scope (P7b): active for the duration of the typed
      // loop so ChatTab's steering bar can push notes to THIS turn only.
      // Thread-scoped; registration clears stale notes from a prior turn.
      const steeringScopeKey = typedCoreEnabled ? (opts.chatSessionId || null) : null;
      if (steeringScopeKey) registerOpenSwanSteeringScope(steeringScopeKey);

      // O1 cutover: the typed agentExecutionCore loop is the default; the
      // legacy executeToolUseLoop stays callable behind the manual revert
      // flag (`uc_openswan_typed_core` = '0'). Both paths return the same
      // contract, so everything below is path-agnostic.
      let toolLoopResult: LegacyToolLoopResult & { cancelled?: boolean };
      try {
        toolLoopResult = typedCoreEnabled
          ? await runTypedCoreToolLoop({
              systemPrompt: systemPromptWithResume,
              userMessage: prompt,
              snapshotContextMessage,
              model: resolvedModel || 'claude-haiku-4-5',
              circleId: opts.context.circleId!,
              userId: opts.context.userId,
              threadId: opts.chatSessionId || undefined,
              runId: run?.id,
              activeSoulKey,
              activePluginIds: opts.activePluginIds,
              allowedToolNames: runtimeToolNames,
              surface: surfaceForTools,
              mode: opts.mode || null,
              maxToolRounds: toolRoundBudget,
              toolApprovalGate: opts.onToolApproval,
              onStage: (stage, label) => emitStage(opts, stage, label, run?.id),
              codingPlanSplit,
              agentSubject: runtimeSubject.metadata,
              signal: opts.signal,
            })
          : await executeToolUseLoop({
              systemPrompt: systemPromptWithResume,
              userMessage: prompt,
              model: resolvedModel || 'claude-haiku-4-5',
              circleId: opts.context.circleId!,
              userId: opts.context.userId,
              threadId: opts.chatSessionId || undefined,
              runId: run?.id,
              activeSoulKey,
              activePluginIds: opts.activePluginIds,
              allowedToolNames: runtimeToolNames,
              surface: surfaceForTools,
              mode: opts.mode || null,
              maxToolRounds: toolRoundBudget,
              agentSubject: runtimeSubject.metadata,
              toolApprovalGate: opts.onToolApproval,
            });
      } finally {
        // Steering scope closes with the loop on EVERY exit — a normal return
        // OR a throw into the catch(toolErr) text-only fallback below. Closing
        // it here (rather than after the loop) means that during that fallback
        // the scope is already inactive, so pushOpenSwanSteeringNote fails
        // cleanly ("No live run to steer" — the steering bar keeps the text and
        // the user re-sends it as a regular message) instead of silently
        // queuing into a dead scope that reported "Sent" but is never drained.
        // (The old skip-on-throw was NOT safe: botTyping stays true through the
        // whole fallback, so the bar does not hide on its own.) Idempotent Map
        // delete; register stays OUTSIDE this try and still clears stale
        // prior-turn notes on the next turn, so there is no double-register.
        if (steeringScopeKey) unregisterOpenSwanSteeringScope(steeringScopeKey);
      }

      // Honest STOP: a user-cancelled loop must finalize the run as
      // 'cancelled', never 'completed'. (Legacy loop never sets this flag.)
      turnCancelled = toolLoopResult.cancelled === true;
      turnIncomplete = toolLoopResult.incomplete === true;
      turnVerificationReceipt = toolLoopResult.verificationReceipt || null;
      turnToolEvents = toolLoopResult.toolEvents ?? [];

      const designManifestLedgerActions = buildDesignAppRuntimeManifestLedgerActions({
        task: cleanMessage,
        toolEvents: toolLoopResult.toolEvents,
        runId: run?.id,
      });

      // Map tool events to the SwanBotStructuredToolAction shape expected downstream.
      // Design-app captures are intentionally hidden: they are used only to
      // create the redacted design.object_manifest ledger action below.
      const transientToolActions = toolLoopResult.toolEvents.map((evt) => {
        const status: 'completed' | 'failed' | 'manual_required' | 'blocked' =
          evt.status === 'passed' ? 'completed' : evt.status === 'manual_required' ? 'manual_required' : evt.status === 'blocked' ? 'blocked' : 'failed';
        return {
          kind: 'tool' as const,
          tool_name: evt.tool,
          title: evt.tool.replace(/_/g, ' ').replace(/\./g, ' > '),
          status,
          input_preview: JSON.stringify(
            summarizeToolInputForPersistence(evt.tool, evt.input),
          ).slice(0, 500),
          output_preview: status === 'failed'
            ? PERSISTED_TOOL_FAILURE_TEXT
            : JSON.stringify(
                summarizeToolResultForPersistence(evt.tool, evt.result, status),
              ).slice(0, 1200),
          // Browser plans remain available just long enough for the dedicated
          // typed extraction below. No hidden metadata object crosses the
          // durable action boundary wholesale.
          metadata: evt.metadata || {},
        };
      });
      browserPlans = extractBrowserPlansFromToolActions(transientToolActions);
      runtimeToolActions = transientToolActions.map((action) => ({
        ...action,
        metadata: {
          source: 'openswan_session_runtime',
          ...(sanitizeToolActionMetadataForPersistence(action.metadata) || {}),
        },
      }));
      runtimeToolActions.push(...designManifestLedgerActions.map((action) => ({
        kind: 'tool' as const,
        tool_name: action.tool_name || 'design.object_manifest',
        title: action.title || 'Design object manifest',
        status: action.status === 'completed' || action.status === 'blocked' ? action.status : 'failed',
        input_preview: action.input_preview || null,
        output_preview: action.status === 'failed'
          ? PERSISTED_TOOL_FAILURE_TEXT
          : JSON.stringify(
              summarizeToolResultForPersistence(
                action.tool_name || 'design.object_manifest',
                action.output_preview,
                action.status,
              ),
            ).slice(0, 1200),
        artifact_refs: action.artifact_refs || [],
        metadata: action.metadata || {},
      })));

      browserPlanEvents = buildInitialBrowserPlanEvents(browserPlans);

      structured = {
        response: toolLoopResult.response,
        tool_actions: runtimeToolActions,
        artifacts: [],
        // Legacy loop reported no usage ({}); the typed core aggregates
        // per-turn edge usage (O1) so run token totals stop reading 0.
        usage: toolLoopResult.usage || {},
        ...(toolLoopResult.routing ? { routing: toolLoopResult.routing } : {}),
      };

      // Degenerate-response safety net: assess the finished answer for a content-based
      // degenerate loop (char-run / phrase-loop / low-diversity) — the flowing-but-looping
      // failure a smaller model (e.g. BlackSwan) can emit. This path is a non-streaming
      // edge invoke, so it runs on the finished text (the disjoint content half of the
      // stream-health timing watch). Surfaced in the run transcript for observability;
      // never mutates the response.
      const responseDegeneracy = assessStreamDegeneracy(toolLoopResult.response);
      if (responseDegeneracy.degenerate) {
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'tool_activity',
          title: 'Degenerate response detected',
          summary: `The answer looks degenerate (${responseDegeneracy.kind}) — ${responseDegeneracy.reason}. Likely a repetition loop; consider regenerating.`,
        })) || transcript;
      }

      // The turn ended without a clean finish. Record it so the run transcript
      // shows the result is partial rather than complete — and say WHY. This
      // used to hardcode "Tool-step limit reached", which is only true for the
      // cap branch: an aborted run and a runtime guard stop (no-progress,
      // oscillation, bad tool-call identity, tool-result boundary) both arrive
      // here too and were reported as a step-cap hit they never hit.
      if (toolLoopResult.incomplete) {
        const checkpoint = toolLoopResult.checkpoint || null;
        const reason = toolLoopResult.incompleteReason ?? 'cap';
        const incompleteTitle = reason === 'cancelled'
          ? 'Run stopped by user'
          : reason === 'guard'
            ? 'Stopped before finishing'
            : reason === 'edge_failure'
              ? 'Tool call failed'
              : 'Tool-step limit reached';
        const incompleteSummary = reason === 'cancelled'
          ? 'You stopped this run — the work so far is saved and can be continued.'
          : reason === 'guard'
            ? 'The run stopped on a safety/progress guard before finishing; the response explains what blocked it.'
            : reason === 'edge_failure'
              ? 'The tool-use call failed before the turn could finish — the response may be partial.'
              : 'The tool loop hit its per-turn step cap before finishing — the response may be partial and can be continued.';
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'tool_activity',
          title: incompleteTitle,
          summary: checkpoint && reason === 'cap'
            ? `Hit the per-turn step cap after ${checkpoint.stepCount} step(s); partial and resumable. ${checkpoint.resumeHint}`
            : checkpoint
              ? `${incompleteSummary} ${checkpoint.resumeHint}`
              : incompleteSummary,
          // Machine-readable resume snapshot so a continuation turn (or the UI)
          // can resume with context instead of re-deriving from scratch.
          ...(checkpoint ? { data: { checkpoint } } : {}),
        })) || transcript;
      }
    }

    // Log tool activity to transcript
    if (runtimeToolActions.length > 0) {
      transcript = (await appendTranscriptEvent(transcriptKey, {
        kind: 'tool_activity',
        title: 'Runtime tool activity',
        summary: `${runtimeToolActions.length} tool action(s) executed via native tool_use`,
        data: {
          toolActions: runtimeToolActions.map((action) => ({
            tool: action.tool_name,
            status: action.status,
            title: action.title,
            outputPreview: action.output_preview || null,
          })),
        },
      })) || transcript;
      if (browserPlans.length > 0) {
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'browser_plans',
          title: 'Browser plans prepared',
          summary: `${browserPlans.length} browser plan(s) ready`,
          data: {
            browserPlans: browserPlans.map((plan) => ({
              planId: plan.planId,
              task: plan.task,
              backend: plan.backend,
              backendLabel: plan.backendLabel,
            })),
          },
        })) || transcript;
      }
      executionStream = buildOpenSwanExecutionStream({
        toolEvents: runtimeToolActions.map((action) => ({
          tool: action.tool_name as any,
          status:
            action.status === 'completed'
              ? 'passed'
              : action.status === 'manual_required'
                ? 'manual_required'
                : action.status === 'blocked'
                  ? 'blocked'
                  : 'failed',
          // User-facing receipt ("Created room X", "Ran npm test — passed")
          // instead of a raw 1200-char JSON output_preview blob.
          summary: buildUserActionReceipt(action.tool_name, action.output_preview, action.status === 'completed')
            || action.title,
        })),
        verificationResults: [],
      });
    }
  } catch {
    console.warn('[OpenSwanRuntime] tool_loop_failed_text_fallback');
    // Fallback: use the old text-only path if the tool loop fails. Make the
    // degradation visible instead of silently answering without tools — emit a
    // stage update and record it in the transcript so the run shows it ran in a
    // reduced mode and why.
    emitStage(opts, 'reasoning', 'Tool loop failed — answering in text-only mode');
    structured = await runTextOnlyResponse();
    runtimeToolActions = structured.tool_actions || [];
    transcript = (await appendTranscriptEvent(transcriptKey, {
      kind: 'tool_activity',
      title: 'Degraded to text-only mode',
      summary: 'Tool loop failed; answered without tools. Details were redacted.',
    })) || transcript;
  }

  // ── Telemetry join barrier ── every deferred pre-loop write must settle
  // BEFORE any finalization write: a late deferred 'running' status or
  // metadata merge landing after/concurrent with the terminal writes would
  // resurrect a finished/cancelled row (mergeRunMetadata is a non-atomic
  // read-merge-write). allSettled — deferred failures were already swallowed.
  await Promise.allSettled(pendingTelemetry);

  const toolStepIndex = assistantResponseStepIndex;
  const actualAssistantResponseStepIndex = assistantResponseStepIndex + (runtimeToolActions.length > 0 ? 1 : 0);
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'assistant_response',
    title: 'Assistant response drafted',
    summary: structured.response.slice(0, 280),
    data: {
      artifactCount: structured.artifacts?.length || 0,
      toolActionCount: runtimeToolActions.length,
    },
  })) || transcript;
  if (run && opts.context.circleId) {
    if (runtimeToolActions.length > 0) {
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: toolStepIndex,
        stepKind: 'tool_call',
        title: 'Runtime tool activity',
        body: runtimeToolActions
          .map((action) => `- [${action.status}] ${action.title || action.tool_name}${action.output_preview ? `: ${action.output_preview}` : ''}`)
          .join('\n')
          .slice(0, 5000),
        metadata: {
          executions: runtimeToolActions.map((action) => ({
            status:
              action.status === 'completed'
                ? 'passed'
                : action.status === 'manual_required'
                  ? 'manual_required'
                  : action.status === 'blocked'
                    ? 'blocked'
                    : 'failed',
            mode:
              action.status === 'manual_required'
                ? 'manual'
                : action.status === 'blocked'
                  ? 'blocked'
                  : 'automatic',
            summary: action.output_preview || action.title,
            toolName: action.tool_name,
            executed: action.status === 'completed' || action.status === 'failed',
            error: action.status === 'failed' || action.status === 'blocked' ? action.output_preview || null : null,
          } satisfies OpenSwanExecutionContract)),
          browserPlanEvents,
        },
      });
        await mergeRunMetadata(run.id, {
          runtimeToolActions: runtimeToolActions.map((action) => ({
            tool: action.tool_name,
            title: action.title,
            status: action.status,
            outputPreview: action.output_preview || null,
            artifactRefs: sanitizeArtifactRefsForPersistence(action.artifact_refs),
            toolPolicy: action.metadata?.toolPolicy || null,
            approvalRequest: action.metadata?.approvalRequest || null,
            ledgerArtifactKind: action.metadata?.ledgerArtifactKind || null,
          })),
          browserPlans,
          browserPlanEvents,
          execution_stream: executionStream,
        });
        void persistRuntimeToolActions({
          runId: run.id,
          circleId: opts.context.circleId,
          userId: opts.context.userId,
          scenarioId: taskPlan.pipeline?.id || null,
          surface: taskPlan.surfacePlan?.primarySurface || opts.surface,
          risk: taskPlan.scenarioPolicy?.risk || taskPlan.pipeline?.risk || null,
          actions: runtimeToolActions,
        }).catch(() => undefined);
    }
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
      stepIndex: actualAssistantResponseStepIndex,
      stepKind: 'message',
      title: 'Assistant response',
      body: structured.response.slice(0, 5000),
      tokensUsed: (structured.usage?.input_tokens || 0) + (structured.usage?.output_tokens || 0),
    });
    // Honest STOP: once the loop reported a user cancel, the row must never
    // leave the cancelled state — write step progress under 'cancelled'
    // instead of flipping a cancelled run back to 'running' mid-finalization.
    await updateRunStatus(run.id, turnCancelled ? 'cancelled' : 'running', { current_step_index: actualAssistantResponseStepIndex, total_steps: totalSteps });
  }

  const stageWriteArtifacts = emitStage(opts, 'rendering_artifacts', 'Rendering artifacts', run?.id);
  if ((structured.artifacts || []).length > 0) {
    transcript = (await appendTranscriptEvent(transcriptKey, {
      kind: 'artifacts_rendered',
      title: 'Artifacts rendered',
      summary: `${structured.artifacts?.length || 0} artifact(s) prepared`,
      data: {
        artifacts: (structured.artifacts || []).map((artifact) => ({
          kind: artifact.kind,
          title: artifact.title,
        })),
      },
    })) || transcript;
  }
  if (run && opts.context.circleId) {
    const artifactStepIndex = actualAssistantResponseStepIndex + 1;
    let currentStepIndex = actualAssistantResponseStepIndex;
    for (const artifact of structured.artifacts || []) {
      await addArtifact({
        runId: run.id,
        circleId: opts.context.circleId,
        artifactKind: mapStructuredArtifactKind(artifact.kind),
        title: artifact.title,
        content: artifact.content || undefined,
        url: artifact.url || undefined,
        metadata: artifact.metadata || {},
      });
    }
    if ((structured.artifacts || []).length > 0) {
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: artifactStepIndex,
        stepKind: 'artifact_create',
        title: 'Artifacts prepared',
        body: (structured.artifacts || []).map((artifact) => `- ${artifact.kind}: ${artifact.title}`).join('\n').slice(0, 5000),
      });
      currentStepIndex = artifactStepIndex;
    }
    // Honest STOP: same guard as above — a cancelled run must not reappear as
    // 'running' during the artifact phase.
    await updateRunStatus(run.id, turnCancelled ? 'cancelled' : 'running', { current_step_index: currentStepIndex, total_steps: totalSteps });
  }

  const stageWriteFinalizing = emitStage(opts, 'finalizing', 'Finalizing run', run?.id);
  // Serialize the two finalization-phase stage writes ahead of the terminal
  // metadata merges below (verification_results / posture / transcript pointer).
  // All hit agent_runs.metadata via mergeRunMetadata (a non-atomic
  // read-merge-write), so a stage write still in flight during a terminal merge
  // would lost-update-drop the terminal keys. Pre-barrier stage writes settled
  // long ago during the tool loop; only these two are temporally close.
  await Promise.allSettled([stageWriteArtifacts, stageWriteFinalizing].filter(Boolean));
  let verificationResults: OpenSwanVerificationResult[] | undefined;
  let memoryRecommendations: OpenSwanMemoryRecommendation[] = [];
  let modeOutcomeSummary: OpenSwanModeOutcomeSummary | null = null;
  let observedEval: import('./openswanObservedEvals').OpenSwanObservedEvalSummary | null = null;
  if (run) {
    if (opts.context.circleId) {
      const verificationStepIndex = actualAssistantResponseStepIndex + ((structured.artifacts || []).length > 0 ? 2 : 1);
      const finalStepIndex = verificationStepIndex + (opts.autoExecuteVerification ? 1 : 0);
      const finalTotalSteps = finalStepIndex + 1;
      if (opts.autoExecuteVerification) {
        // Verification DEPTH dial (R1): before running the plan, escalate the
        // REQUIRED check set to the risk/blast-radius of what this run actually
        // touched (schema/auth/payments/edge/routing/config + breadth). Strictly
        // MORE conservative — it only upgrades planned checks required→true and
        // ADDS auto-runnable checks (typecheck/tests/lint); it never removes or
        // downgrades one. changedFiles reuses THIS turn's already-built receipt:
        // turnVerificationReceipt.editedFiles is the identical output of the
        // buildVerificationReceipt primitive run at the tool-loop tail, and the
        // loop's own toolLoopResult is block-scoped out of reach here. Any
        // failure leaves the planner's checks byte-unchanged (fail-safe no-op).
        let verificationDepth: { riskTier: string; reason: string; manualReviewKinds: string[] } | null = null;
        try {
          // Derive the changed-file set from turnToolEvents (present on BOTH loop
          // paths) rather than turnVerificationReceipt (typed-core only), so depth
          // escalation fires — and the 'risk' proof stamped below is honest — even
          // on the legacy loop. parseEditedFiles reads the shared toolEvent shape.
          const { buildVerificationReceipt } = await import('./verificationReceiptCore');
          const changed = buildVerificationReceipt({ editedFiles: turnToolEvents }).editedFiles;
          const depth = planVerificationDepth({
            changedFiles: changed,
            taskKind: taskPlan.kind,
            plannedChecks: taskPlan.verification,
            // destructiveOps omitted: deletes aren't represented in editedFiles.
            // The tier is still driven by breadth + category (safe degradation).
          });
          const upgradeSet = new Set(depth.upgradeIndices);
          const upgraded: OpenSwanVerificationCheck[] = taskPlan.verification.map((check, idx) =>
            upgradeSet.has(idx) ? { ...check, required: true } : check,
          );
          // Only the auto-executor's runnable kinds (typecheck/tests/lint) may be
          // ADDED as required. 'build' is explicitly skipped: the auto-executor
          // can't run it, so a required 'build' would silently degrade to
          // manual_required rather than actually gating the run.
          const AUTO_ADDABLE = new Set<string>(['typecheck', 'tests', 'lint']);
          for (const kind of depth.missingKinds) {
            if (!AUTO_ADDABLE.has(kind)) continue; // skip 'build' etc.
            upgraded.push({
              id: `depth-${kind}`,
              kind: kind as OpenSwanVerificationCheck['kind'],
              required: true,
              label: `Run ${kind} (risk: ${depth.riskTier})`,
              reason: depth.reason,
            });
          }
          taskPlan.verification = upgraded;
          verificationDepth = { riskTier: depth.riskTier, reason: depth.reason, manualReviewKinds: depth.manualReviewKinds };
        } catch { /* depth policy is advisory — never block finalization */ }
        verificationResults = await executeOpenSwanVerificationPlan(taskPlan);
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'verification_completed',
          title: 'Verification completed',
          summary: `${verificationResults.length} verification result(s) recorded`,
          data: {
            verificationResults: verificationResults.map((result) => ({
              label: result.check.label,
              status: result.execution.status,
              summary: result.summary,
            })),
            // R1: surface the risk tier, path-free reason, and advisory manual
            // follow-ups so Feed proof shows the DEPTH the checks ran at.
            ...(verificationDepth ? { verificationDepth } : {}),
          },
        })) || transcript;
        executionStream = buildOpenSwanExecutionStream({
          toolEvents: runtimeToolActions.map((action) => ({
            tool: action.tool_name as any,
            status: action.status === 'completed' ? 'passed' : 'failed',
            summary: action.output_preview || action.title,
          })),
          verificationResults,
        });
        await addStep({
          runId: run.id,
          circleId: opts.context.circleId,
          stepIndex: verificationStepIndex,
          stepKind: 'finalize',
          title: 'Verification results',
          body: verificationResults.map((result) => `- ${result.summary}`).join('\n').slice(0, 5000),
          metadata: {
            executions: verificationResults.map((result) => result.execution),
          },
        });
      }
      // Honest STOP (late cancel): the round-boundary poll only runs between
      // tool rounds, so a console STOP that lands during the final model round
      // or during finalization (assistant-response step, artifacts,
      // verification above) — or on a run that never called a tool — is
      // invisible to the loop. Re-check the row once here so a late cancel
      // still gets the honest 'cancelled' receipt with partial usage/cost.
      if (!turnCancelled) {
        try {
          const { data: lateRunRow } = await supabase
            .from('agent_runs')
            .select('status')
            .eq('id', run.id)
            .maybeSingle();
          if ((lateRunRow as { status?: string } | null)?.status === 'cancelled') turnCancelled = true;
        } catch { /* re-check failure must never break finalization */ }
      }
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: finalStepIndex,
        stepKind: 'finalize',
        // Honest STOP: a user-cancelled run is finalized as cancelled with its
        // partial work, not presented as a clean finish.
        title: turnCancelled ? 'Run cancelled by user' : 'Run finalized',
        body: [
          ...(turnCancelled ? ['Stopped at the user\'s request — partial work and usage below are preserved.', ''] : []),
          `${structured.artifacts?.length || 0} artifact(s) ready`,
          '',
          'Verification checklist:',
          ...taskPlan.verification.map((check) => `- ${check.label}`),
          ...(verificationResults?.length ? ['', 'Verification results:', ...verificationResults.map((result) => `- ${result.summary}`)] : []),
        ].join('\n').slice(0, 5000),
      });
      const finalUsageTotals = emptyOpenSwanTokenTotals();
      addOpenSwanUsageTotals(finalUsageTotals, structured.usage);
      finalUsageTotals.input += delegatedUsageTotals.input;
      finalUsageTotals.output += delegatedUsageTotals.output;
      finalUsageTotals.cached += delegatedUsageTotals.cached;
      finalUsageTotals.cacheRead += delegatedUsageTotals.cacheRead;
      finalUsageTotals.cacheCreation += delegatedUsageTotals.cacheCreation;
      // Honest STOP: a user cancel finalizes the row as 'cancelled' — never
      // overwritten to 'completed' — while keeping the token/cost extras as an
      // honest partial-work receipt. Pure cap-exhaustion still completes.
      // The completed path uses the .neq('status','cancelled')-guarded helper
      // to close the re-check→write race: a cancel landing after the
      // re-select above can never be promoted back to 'completed'.
      const finalRunExtras = {
        current_step_index: finalStepIndex,
        total_steps: finalTotalSteps,
        input_tokens: finalUsageTotals.input,
        output_tokens: finalUsageTotals.output,
        cached_tokens: finalUsageTotals.cached,
        // Cost attribution (audit): light up the dead estimated_cost column so
        // the ops board reads real dollars for the main OpenSwan session path.
        estimated_cost: estimateRunCostUsd({
          model: run.model,
          inputTokens: finalUsageTotals.input,
          outputTokens: finalUsageTotals.output,
          cachedTokens: finalUsageTotals.cached,
        }),
      };
      if (turnCancelled) {
        await updateRunStatus(run.id, 'cancelled', finalRunExtras);
      } else {
        await completeRunUnlessCancelled(run.id, finalRunExtras);
      }
      // Accountability (proof-of-work): a chat/room OpenSwan turn that actually
      // mutated something — edited files, a git commit, canonical github refs,
      // or produced artifacts — becomes visible to the team Feed as a durable
      // proof_of_work row plus a realtime agent_activity row. The gate lives in
      // decideOpenSwanTurnProofPublication: cancelled turns publish nothing,
      // feed_task runs are excluded (the Kanban completion path in
      // useKanbanData.runAgentOnTask already publishes its richer proof — this
      // guard prevents a double-post), and read-only Q&A turns stay quiet.
      // Mirrors the Kanban block: fire-and-forget / non-fatal — a publish
      // failure never affects run finalization. Payloads stay bounded and
      // secret-safe via the publisher core's caps (headline ≤120, ≤8 bullets,
      // body ≤700, basenames only, masked tokens, github.com-scoped URLs).
      {
        const publishRunId = run.id;
        const publishCircleId = opts.context.circleId;
        const publishStartedAt = run.started_at || run.created_at || null;
        void (async () => {
          try {
            const {
              buildRunProofPublication,
              decideOpenSwanTurnProofPublication,
              mapRuntimeToolActionsToProofEvents,
            } = await import('./agentRunProofPublisherCore');
            const proofEvents = mapRuntimeToolActionsToProofEvents(runtimeToolActions);
            const gateInput = {
              runSurface,
              cancelled: turnCancelled,
              incomplete: turnIncomplete,
              receipt: turnVerificationReceipt,
              toolEvents: proofEvents,
              artifactCount: (structured.artifacts || []).length,
            };
            // stopReason depends only on cancelled/incomplete — take it from a
            // pre-pass so the proof card carries the honest stop family, then
            // re-gate publish once the git references are known.
            const preDecision = decideOpenSwanTurnProofPublication({ ...gateInput, gitRefCount: 0 });
            const nowMs = Date.now();
            const startedMs = publishStartedAt ? Date.parse(publishStartedAt) : NaN;
            const pub = buildRunProofPublication({
              runId: publishRunId,
              taskId: opts.taskId,
              toolsUsed: proofEvents,
              toolEvents: proofEvents,
              filesTouched: turnVerificationReceipt?.editedFiles,
              verification: verificationResults,
              stopReason: preDecision.stopReason,
              durationMs: Number.isFinite(startedMs) ? Math.max(0, nowMs - startedMs) : undefined,
              outputSummary: structured.response?.slice(0, 240),
              deliverable: structured.response,
              nowMs,
            });
            // Publication gate: count git references from REAL TOOL OUTPUT
            // only (git.run commit/push output → proofEvents[].result), NEVER
            // from pub.gitReferences — which ALSO scans the untrusted model
            // `deliverable` prose, so a chat turn that merely NAMES a PR ("what
            // changed in PR #128?") or quotes a github.com URL would otherwise
            // trip a false task_completed proof. Real mutations still publish
            // via edited-files / committed / artifacts; a genuine commit/push
            // still publishes because its output flows through proofEvents.
            // pub.gitReferences (deliverable + tool) stays the display-only
            // "Linked:" label on turns that legitimately published.
            const { extractGitReferences } = await import('./taskPRLinkageCore');
            const toolGitRefs = extractGitReferences({ toolEvents: proofEvents });
            const decision = decideOpenSwanTurnProofPublication({
              ...gateInput,
              gitRefCount: toolGitRefs.length,
            });
            if (!decision.publish) return;
            const { addProofOfWork } = await import('./missions');
            const { logActivity } = await import('../services/agentActivityLogger');
            await addProofOfWork({
              circle_id: publishCircleId,
              user_id: opts.context.userId || undefined,
              agent_name: runtimeSubject.displayName,
              pow_type: (pub.proofRow as any).pow_type,
              title: String((pub.proofRow as any).title || 'OpenSwan run'),
              detail: {
                ...pub.proofRow,
                ...(turnVerificationReceipt ? { receipt_verdict: turnVerificationReceipt.verdict } : {}),
                surface: runSurface,
              },
            });
            // A failed coding receipt never tallies a 'task_completed' activity;
            // honest failures ('task_failed') always ride the realtime Feed.
            if (
              (pub.activityRow as any).activity_type === 'task_failed'
              || !decision.suppressCompletedActivity
            ) {
              await logActivity({
                circle_id: publishCircleId,
                agent_name: runtimeSubject.displayName,
                ...(pub.activityRow as any),
              });
            }
          } catch (e) {
            console.warn('[OpenSwanRuntime] proof-of-work publish failed (non-fatal):', e);
          }
        })();
      }
      if (turnCancelled) {
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'tool_activity',
          title: 'Run cancelled by user',
          summary: 'The user stopped this run. Partial work, token usage, and cost are recorded; the run is finalized as cancelled, not completed.',
        })) || transcript;
      }
      // GAP-2: agent_runs has no read/creation columns, so the cache split (the
      // read:creation ratio that proves the P26 breakpoints work) rides the
      // metadata JSON blob. Use mergeRunMetadata — updateRunStatus's `metadata`
      // is a whole-column replace and would clobber the run metadata
      // accumulated across the run. Bounded ints; only written when the loop
      // reported cache activity so runs with no caching stay clean.
      if (finalUsageTotals.cacheRead > 0 || finalUsageTotals.cacheCreation > 0) {
        await mergeRunMetadata(run.id, {
          cache_read_tokens: finalUsageTotals.cacheRead,
          cache_creation_tokens: finalUsageTotals.cacheCreation,
        });
      }

      memoryRecommendations = buildOpenSwanMemoryRecommendations({
        taskKind: taskPlan.kind,
        profile: taskPlan.profile,
        prompt: cleanMessage,
        response: structured.response,
        spiritId: runtimeSubject.spiritId || opts.context.spiritId || null,
        memoryReferences: memoryBundle.references,
        verificationResults,
        artifacts: (structured.artifacts || []).map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
      });
      modeOutcomeSummary = buildModeOutcomeSummary({
        mode: opts.mode || null,
        taskKind: taskPlan.kind,
        response: structured.response,
        artifacts: structured.artifacts || [],
        verificationResults,
        browserPlans,
        runtimeToolActions,
      });
      transcript = (await appendTranscriptEvent(transcriptKey, {
        kind: 'memory_recommendations',
        title: 'Memory recommendations generated',
        summary: `${memoryRecommendations.length} recommendation(s) prepared`,
          data: {
            memoryRecommendations: memoryRecommendations.map((recommendation) => ({
              kind: recommendation.memoryKind,
              title: recommendation.title,
              target: recommendation.target,
            })),
          },
        })) || transcript;

      const modeSummaryArtifacts = buildModeSummaryArtifacts({
        mode: opts.mode || null,
        summary: modeOutcomeSummary,
        response: structured.response,
        browserPlans,
        verificationResults,
      });
      observedEval = buildOpenSwanObservedEvalSummary({
        run: {
          status: 'completed',
          mode: opts.mode || 'talk',
          provider: 'openswan',
          metadata: {
            explicitMode: opts.mode || null,
            resolvedSessionProfile: taskPlan.profile,
            routingIntent: runtimeRoute.intent,
            taskKind: taskPlan.kind,
            agentSubjectKey: runtimeSubject.subjectKey,
            agentSubject: runtimeSubject.metadata,
            verificationPlan: taskPlan.verification,
            modeOutcomeSummary,
            runtimeToolActions,
          },
        },
        artifacts: [...(structured.artifacts || []), ...modeSummaryArtifacts].map((artifact) => ({
          artifact_kind: 'artifactKind' in artifact ? artifact.artifactKind : mapStructuredArtifactKind(artifact.kind),
          title: artifact.title,
        })),
        verificationResults,
        toolActions: runtimeToolActions,
        responseText: structured.response,
      });
      void Promise.all([
        recordArchiveDerivedMemorySuccess({
          memoryReferences: memoryBundle.references,
          observedEval,
          userId: opts.context.userId,
          source: 'openswan_runtime_passive_success',
          runId: run.id,
        }),
        recordArchiveDerivedMemoryWeakSignal({
          memoryReferences: memoryBundle.references,
          observedEval,
          userId: opts.context.userId,
          source: 'openswan_runtime_passive_weak_signal',
          runId: run.id,
        }),
      ]).catch(() => {});
      for (const artifact of modeSummaryArtifacts) {
        await addArtifact({
          runId: run.id,
          circleId: opts.context.circleId,
          artifactKind: artifact.artifactKind,
          title: artifact.title,
          content: artifact.content,
          metadata: artifact.metadata,
        });
      }
      await mergeRunMetadata(run.id, {
        execution_stream: executionStream,
        verification_results: verificationResults || [],
        // Bounded scalar projection of the full receipt so console run rows can
        // surface a verdict + one-line summary WITHOUT persisting the ~30KB
        // editedFiles[]/checks[] blob. verdict is a 3-value enum, summary ≤400
        // chars (formatVerificationReceipt), editedFiles a count, committed a bool.
        ...(turnVerificationReceipt
          ? {
              verificationReceipt: {
                verdict: turnVerificationReceipt.verdict,
                summary: turnVerificationReceipt.summary,
                editedFiles: turnVerificationReceipt.editedFiles.length,
                committed: turnVerificationReceipt.committed,
              },
            }
          : {}),
        browserPlans,
        browserPlanEvents,
        memoryRecommendations,
        modeOutcomeSummary,
        observedEval,
        openswanTranscriptKey: transcriptKey,
        openswanTranscriptEventCount: transcript.events.length,
        openswanTranscriptUpdatedAt: transcript.updatedAt,
        agentSubjectKey: runtimeSubject.subjectKey,
        agentSubject: runtimeSubject.metadata,
        runAgentAliases: runtimeRunAliases,
        memoryAgentAliases: runtimeMemoryAliases,
      });
      void captureOpenSwanOutcomeMemory({
        circleId: opts.context.circleId,
        userId: opts.context.userId,
        agentId: runtimeSubject.memoryAgentId,
        agentName: runtimeSubject.displayName,
        spiritId: runtimeSubject.spiritId || opts.context.spiritId || null,
        taskKind: taskPlan.kind,
        profile: taskPlan.profile,
        title: opts.title || cleanMessage.slice(0, 100) || 'OpenSwan Session',
        prompt: cleanMessage,
        response: structured.response,
        artifacts: (structured.artifacts || []).map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
        verificationResults,
        // Real provenance. A live check on 2026-07-28 found source_run_id NULL
        // on all 4,716 active memories because this chain never carried a run
        // id; `run` is already in scope here (mergeRunMetadata uses it above).
        sourceRunId: run?.id,
        // The honest surface. saveAgentMemory used to hardcode 'feed_task' for
        // every caller, so an OpenSwan session outcome was rendered back to the
        // model as `src:feed_task`.
        sourceSurface: 'openswan_session',
      }).catch(() => {});
    }
  }
  if (memoryRecommendations.length === 0) {
    memoryRecommendations = buildOpenSwanMemoryRecommendations({
      taskKind: taskPlan.kind,
      profile: taskPlan.profile,
      prompt: cleanMessage,
      response: structured.response,
      spiritId: runtimeSubject.spiritId || opts.context.spiritId || null,
      memoryReferences: memoryBundle.references,
      verificationResults,
      artifacts: (structured.artifacts || []).map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
    });
  }
  if (!modeOutcomeSummary) {
    modeOutcomeSummary = buildModeOutcomeSummary({
      mode: opts.mode || null,
      taskKind: taskPlan.kind,
      response: structured.response,
      artifacts: structured.artifacts || [],
      verificationResults,
      browserPlans,
      runtimeToolActions,
    });
  }
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'run_finalized',
    title: 'Run finalized',
    summary: `${runtimeToolActions.length} tool action(s), ${structured.artifacts?.length || 0} artifact(s), ${memoryRecommendations.length} memory recommendation(s)`,
    data: {
      runId: run?.id || null,
      browserPlanCount: browserPlans.length,
      verificationCount: verificationResults?.length || 0,
      executionStreamCount: executionStream.length,
      modeOutcomeSummary,
    },
  })) || transcript;
  if (run) {
    await mergeRunMetadata(run.id, {
      openswanTranscriptKey: transcriptKey,
      openswanTranscriptEventCount: transcript.events.length,
      openswanTranscriptUpdatedAt: transcript.updatedAt,
    });
  }

  return {
    ...structured,
    runId: run?.id || null,
    prompt,
    stage: 'finalizing',
    taskPlan,
    verificationResults,
    delegatedSubagents: delegationSpecs.map((spec) => spec.subagent.displayName),
    memoriesUsed: memoryBundle.references.map((ref) => ref.title),
    memoryReferences: memoryBundle.references,
    memoryRecommendations,
    browserPlans,
    browserPlanEvents,
    modeOutcomeSummary,
    observedEval,
    ...(turnVerificationReceipt ? { verificationReceipt: turnVerificationReceipt } : {}),
    toolEvents: runtimeToolActions.map((action) => ({
      tool: action.tool_name,
      input: action.input_preview || null,
      result: action.output_preview || action.title || '',
      status: action.status,
      summary: action.output_preview || action.title || action.tool_name,
    })),
  };
  } catch (turnErr) {
    // Finalize-on-throw: without this, a throw at delegateToSubagents /
    // buildOpenSwanMemoryStores / the text-only fallback leaves the row stuck at
    // 'running' until a reaper claims it ~RUN_STALL_DEAD_MS later. Record the
    // reason WITHOUT clobbering the metadata column (mergeRunMetadata is a
    // read-merge-write; a whole-column .update({metadata}) would wipe
    // agentSubject/posture/delegation keys accumulated during the run), flip
    // status to 'failed' cancel-guarded so a concurrent user STOP still wins,
    // then re-throw to preserve the caller's error semantics.
    if (run) {
      // Settle in-flight deferred telemetry FIRST (mirrors the normal-path join
      // barrier) so a late 'running' status write can't land after — and
      // resurrect — the 'failed' terminal write below.
      await Promise.allSettled(pendingTelemetry);
      await mergeRunMetadata(run.id, {
        runtime_error: 'openswan_turn_failed',
        runtime_error_redacted: true,
      }).catch(() => undefined);
      await failRunUnlessCancelled(run.id).catch(() => undefined);
    }
    throw turnErr;
  } finally {
    // Stop the lifetime heartbeat on EVERY exit (normal return above or throw)
    // so the timer never keeps beating updated_at for a finished run.
    stopRunHeartbeat?.();
  }
}
