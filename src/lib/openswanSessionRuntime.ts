import { buildAgenticCodingPrompt, detectAgenticCodingProfile, type AgenticCodingProfile, type AgenticCodingSurface } from './agenticCodingProfile';
import { addArtifact, addStep, createRun, mergeRunMetadata, type ArtifactKind, type RunSurface, updateRunStatus } from './agentRunSystem';
import { buildOpenSwanExecutionStream, type OpenSwanExecutionContract } from './openswanExecution';
import { buildOpenSwanMemoryRecommendations, captureOpenSwanOutcomeMemory, recordArchiveDerivedMemorySuccess, recordArchiveDerivedMemoryWeakSignal, type OpenSwanMemoryRecommendation, type PromptMemoryReference } from './memoryService';
import { buildOpenSwanObservedEvalSummary } from './openswanObservedEvals';
import { extractBrowserPlansFromToolActions } from './openswanRuntimeToolLoop';
import { buildOpenSwanTaskPlan, type OpenSwanTaskPlan } from './openswanTaskPlanner';
import {
  buildOpenSwanToolBrief,
  getOpenSwanToolPolicy,
  listToolsHiddenByMode,
  previewOpenSwanToolsForSurface,
  type OpenSwanRuntimeToolContext,
  type OpenSwanRuntimeToolName,
} from './openswanToolRuntime';
import { runAgent, type AgentProvider, type AgentToolDefinition } from './agentExecutionCore';
import { getOpenSwanToolsForSurface } from './openswanBridge';
import { dispatchToolDetailed, MAX_TOOL_ROUNDS } from './openswanTools/index';
import { EDGE_INVOKE_RETRIES, edgeRetryBackoffMs, isRetryableEdgeFailure } from './edgeInvokeRetry';
import { extractAssistantText } from './toolLoopProgress';
import { getFreshAccessToken } from './authSession';
import { supabase } from './supabase';
import {
  accumulateLoopUsage,
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
import { appendOpenSwanTranscriptEvent, buildOpenSwanTranscriptKey, upsertOpenSwanTranscriptHeader, type OpenSwanSessionTranscript } from './openswanTranscripts';
import { executeOpenSwanVerificationPlan, type OpenSwanVerificationResult } from './openswanVerificationRuntime';
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
import { buildChatComputerRequestRoutePromptBlock } from './chatComputerRequestRouter';
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
  stripDesignAppRuntimeCaptureMetadata,
} from './designAppRuntimeManifest';
import { persistAgentRunLedgerPreview, persistRuntimeToolActions } from './agentRunLedgerPersistence';

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

function emitStage(callbacks: OpenSwanRunCallbacks, stage: OpenSwanRunStage, label: string) {
  callbacks.onStageChange?.(stage, label);
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
  toolApprovalGate?: LegacyToolApprovalGate;
  onStage?: (stage: OpenSwanRunStage, label: string) => void;
}): Promise<LegacyToolLoopResult> {
  const toolCtx: OpenSwanRuntimeToolContext = {
    circleId: args.circleId,
    userId: args.userId,
    threadId: args.threadId,
    runId: args.runId,
    activeSoulKey: args.activeSoulKey,
    activePluginIds: args.activePluginIds,
    surface: args.surface,
  };
  const bridgeTools = getOpenSwanToolsForSurface(args.surface, toolCtx, {
    allowedToolNames: args.allowedToolNames as OpenSwanRuntimeToolName[],
    mode: args.mode,
  });
  // O1 follow-up flip (T2/T8): see plan doc un-darking checklist
  // const { tools: progressiveTools, resolveAdditionalTools } = getProgressiveOpenSwanTools(args.surface, toolCtx);
  if (bridgeTools.length === 0) {
    // Legacy parity: no advertised tools → no model round.
    return { response: '', toolEvents: [] };
  }

  const toolEvents: LegacyToolEvent[] = [];
  const rejectedToolUseIds = new Set<string>();
  const pendingToolInputs = new Map<string, unknown>();
  const usageAcc = createLoopUsageAccumulator();
  let routing: LegacyToolLoopResult['routing'];
  let edgeFailed = false;

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

  const provider: AgentProvider = {
    turn: async ({ messages, tools }) => {
      const { data, error } = await invokeSwanbotToolTurn(buildSwanbotToolTurnBody({
        userMessage: args.userMessage,
        circleId: args.circleId,
        userId: args.userId,
        model: args.model,
        systemPrompt: args.systemPrompt,
        tools: toAnthropicToolShapes(tools),
        messages,
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
  const onRoundComplete = createLegacyRoundNudgeHook({
    toolEvents,
    hasApprovalGate: !!args.toolApprovalGate,
    dispatchObservation: async (observationTool) => {
      const obs = await dispatchToolDetailed(observationTool, {}, toolCtx);
      return { text: obs.text, status: String(obs.status) };
    },
  });

  const runResult = await runAgent({
    initialMessages: buildSnapshotAwareInitialMessages({
      userMessage: args.userMessage,
      snapshotContextMessage: args.snapshotContextMessage,
    }),
    tools: assembledTools,
    provider,
    maxIterations: maxRounds,
    // The legacy loop only parallelized all-read-only, ungated rounds;
    // until the T8 policy provider is flipped on, dispatch sequentially
    // (safe superset of legacy ordering, incl. approval prompts).
    parallelToolConcurrency: 1,
    toolApprovalGate: args.toolApprovalGate
      ? createLegacyApprovalGateAdapter(args.toolApprovalGate, (toolUseId) => rejectedToolUseIds.add(toolUseId))
      : undefined,
    onRoundComplete,
    onEvent: (event) => {
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
      const stage = mapAgentEventToOpenSwanStage(event);
      if (stage) args.onStage?.(stage.stage, stage.label);
    },
    // O1 follow-up flip (T2/T8): see plan doc un-darking checklist
    // resolveAdditionalTools,
    // toolParallelPolicyProvider: createOpenSwanToolParallelPolicyProvider({ activePluginIds: args.activePluginIds }),
  });

  // Legacy parity: the cap was hit on a pure tool_use round — the final
  // round's results were pushed to history but no turn consumed them, so the
  // model never answered. Give it one no-tools finalization call. Fail-safe:
  // any error falls back to the limit note in buildLegacyToolLoopResult.
  let finalizationText: string | null = null;
  if (!edgeFailed && needsCapExhaustionFinalization(runResult)) {
    try {
      const finalToken = await getFreshAccessToken();
      const { data: finalData } = await supabase.functions.invoke('swanbot-ai', {
        headers: finalToken ? { Authorization: `Bearer ${finalToken}` } : undefined,
        body: {
          message: args.userMessage,
          circleId: args.circleId,
          userId: args.userId,
          model: args.model,
          tools: [],
          tool_messages: runResult.messages.map((m) => ({ role: m.role, content: m.content })),
          system_override: args.systemPrompt,
        },
      });
      finalizationText = extractAssistantText((finalData as any)?.content)
        || String((finalData as any)?.response || '');
    } catch { /* fall back to the limit note */ }
  }

  return buildLegacyToolLoopResult({
    runResult,
    toolEvents,
    routing,
    maxRounds,
    edgeFailed,
    finalizationText,
    usage: finalizeLoopUsage(usageAcc),
  });
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
  );
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
        },
      })
    : null;

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
    await updateRunStatus(run.id, 'running', { current_step_index: 0, total_steps: totalSteps });
    await mergeRunMetadata(run.id, {
      openswanTranscriptKey: transcriptKey,
      openswanTranscriptEventCount: transcript.events.length,
      openswanTranscriptUpdatedAt: transcript.updatedAt,
    });
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
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
    });
  }

  emitStage(opts, 'loading_context', 'Loading context');
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
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
      stepIndex: 1,
      stepKind: 'context_edit',
      title: 'Context assembled',
      body: (opts.context.chatHistory || '').slice(0, 5000),
    });
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
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
    });
    await updateRunStatus(run.id, 'running', { current_step_index: 2, total_steps: totalSteps });
  }

  let delegationSummary = '';
  if (delegationSpecs.length > 0 && opts.context.circleId) {
    opts.onDelegationPlan?.(delegatedAgents);
    emitStage(opts, 'delegating', `Delegating to ${delegationSpecs.map((spec) => spec.subagent.displayName).join(', ')}`);
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
      await updateRunStatus(run.id, 'running', { current_step_index: 3, total_steps: totalSteps });
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
      parentAgentId: opts.context.agentId || undefined,
      parentMode: opts.mode || null,
    });

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
        })),
        delegatedArtifactSummary: delegatedArtifacts,
      });
      await updateRunStatus(run.id, 'running', { current_step_index: 4 + delegated.results.length, total_steps: totalSteps });
    }
  }

  emitStage(opts, 'reasoning', 'Reasoning over the task');
  const memoryBundle = await buildOpenSwanMemoryStores({
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    query: cleanMessage,
    roomId: opts.roomId,
    agentId: opts.context.agentId,
    agentName: opts.context.agentName,
    spiritId: opts.context.spiritId,
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
    await mergeRunMetadata(run.id, {
      runtimePlanVersion: OPENSWAN_RUNTIME_PLAN_VERSION,
      memoryReferences: summarizeMemoryReferences(memoryBundle.references),
      memoriesUsed: memoryBundle.references.map((ref) => ref.title),
      memoryContextPreview: memoryBundle.combined.slice(0, 1200),
      spiritId: opts.context.spiritId || null,
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
    });
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
        currentMessage: prompt,
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
        chatHistory: [
          opts.context.chatHistory || '',
          delegationSummary ? `## Specialist Sub-Agent Results\n${delegationSummary}` : '',
          memoryBundle.combined ? `## Memory Context\n${memoryBundle.combined}` : '',
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

      // O1 cutover: the typed agentExecutionCore loop is the default; the
      // legacy executeToolUseLoop stays callable behind the manual revert
      // flag (`uc_openswan_typed_core` = '0'). Both paths return the same
      // contract, so everything below is path-agnostic.
      const toolLoopResult: LegacyToolLoopResult = typedCoreEnabled
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
            onStage: (stage, label) => emitStage(opts, stage, label),
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
            toolApprovalGate: opts.onToolApproval,
          });

      const designManifestLedgerActions = buildDesignAppRuntimeManifestLedgerActions({
        task: cleanMessage,
        toolEvents: toolLoopResult.toolEvents,
        runId: run?.id,
      });

      // Map tool events to the SwanBotStructuredToolAction shape expected downstream.
      // Design-app captures are intentionally hidden: they are used only to
      // create the redacted design.object_manifest ledger action below.
      runtimeToolActions = toolLoopResult.toolEvents.map((evt) => {
        const status: 'completed' | 'failed' | 'manual_required' | 'blocked' =
          evt.status === 'passed' ? 'completed' : evt.status === 'manual_required' ? 'manual_required' : evt.status === 'blocked' ? 'blocked' : 'failed';
        return {
          kind: 'tool' as const,
          tool_name: evt.tool,
          title: evt.tool.replace(/_/g, ' ').replace(/\./g, ' > '),
          status,
          input_preview: typeof evt.input === 'string' ? evt.input.slice(0, 500) : JSON.stringify(evt.input).slice(0, 500),
          output_preview: typeof evt.result === 'string' ? evt.result.slice(0, 1200) : '',
          metadata: stripDesignAppRuntimeCaptureMetadata(evt.metadata || {}),
        };
      });
      runtimeToolActions.push(...designManifestLedgerActions.map((action) => ({
        kind: 'tool' as const,
        tool_name: action.tool_name || 'design.object_manifest',
        title: action.title || 'Design object manifest',
        status: action.status === 'completed' || action.status === 'blocked' ? action.status : 'failed',
        input_preview: action.input_preview || null,
        output_preview: action.output_preview || null,
        artifact_refs: action.artifact_refs || [],
        metadata: action.metadata || {},
      })));

      browserPlans = extractBrowserPlansFromToolActions(runtimeToolActions);
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

      // The tool loop hit its per-turn step cap before producing a final
      // answer. Record it so the run transcript shows the result is partial
      // rather than a clean finish.
      if (toolLoopResult.incomplete) {
        const checkpoint = toolLoopResult.checkpoint || null;
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'tool_activity',
          title: 'Tool-step limit reached',
          summary: checkpoint
            ? `Hit the per-turn step cap after ${checkpoint.stepCount} step(s); partial and resumable. ${checkpoint.resumeHint}`
            : 'The tool loop hit its per-turn step cap before finishing — the response may be partial and can be continued.',
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
          summary: action.output_preview || action.title,
        })),
        verificationResults: [],
      });
    }
  } catch (toolErr) {
    console.warn('[OpenSwanRuntime] Tool-use loop failed, falling back to text-only:', toolErr);
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
      summary: `Tool loop failed; answered without tools. Reason: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`,
    })) || transcript;
  }

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
            artifactRefs: action.artifact_refs || null,
            browserPlan: action.metadata?.browserPlan || null,
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
    await updateRunStatus(run.id, 'running', { current_step_index: actualAssistantResponseStepIndex, total_steps: totalSteps });
  }

  emitStage(opts, 'rendering_artifacts', 'Rendering artifacts');
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
    await updateRunStatus(run.id, 'running', { current_step_index: currentStepIndex, total_steps: totalSteps });
  }

  emitStage(opts, 'finalizing', 'Finalizing run');
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
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: finalStepIndex,
        stepKind: 'finalize',
        title: 'Run finalized',
        body: [
          `${structured.artifacts?.length || 0} artifact(s) ready`,
          '',
          'Verification checklist:',
          ...taskPlan.verification.map((check) => `- ${check.label}`),
          ...(verificationResults?.length ? ['', 'Verification results:', ...verificationResults.map((result) => `- ${result.summary}`)] : []),
        ].join('\n').slice(0, 5000),
      });
      await updateRunStatus(run.id, 'completed', {
        current_step_index: finalStepIndex,
        total_steps: finalTotalSteps,
        input_tokens: structured.usage?.input_tokens || 0,
        output_tokens: structured.usage?.output_tokens || 0,
        cached_tokens: structured.usage?.total_tokens
          ? Math.max(0, structured.usage.total_tokens - ((structured.usage.input_tokens || 0) + (structured.usage.output_tokens || 0)))
          : 0,
      });

      memoryRecommendations = buildOpenSwanMemoryRecommendations({
        taskKind: taskPlan.kind,
        profile: taskPlan.profile,
        prompt: cleanMessage,
        response: structured.response,
        spiritId: opts.context.spiritId || null,
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

      const runtimeAgentId = opts.context.agentId || `openswan:${opts.surface}`;
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
        browserPlans,
        browserPlanEvents,
        memoryRecommendations,
        modeOutcomeSummary,
        observedEval,
        openswanTranscriptKey: transcriptKey,
        openswanTranscriptEventCount: transcript.events.length,
        openswanTranscriptUpdatedAt: transcript.updatedAt,
      });
      void captureOpenSwanOutcomeMemory({
        circleId: opts.context.circleId,
        userId: opts.context.userId,
        agentId: runtimeAgentId,
        agentName: opts.context.agentName || 'OpenSwan',
        spiritId: opts.context.spiritId || null,
        taskKind: taskPlan.kind,
        profile: taskPlan.profile,
        title: opts.title || cleanMessage.slice(0, 100) || 'OpenSwan Session',
        prompt: cleanMessage,
        response: structured.response,
        artifacts: (structured.artifacts || []).map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
        verificationResults,
      }).catch(() => {});
    }
  }
  if (memoryRecommendations.length === 0) {
    memoryRecommendations = buildOpenSwanMemoryRecommendations({
      taskKind: taskPlan.kind,
      profile: taskPlan.profile,
      prompt: cleanMessage,
      response: structured.response,
      spiritId: opts.context.spiritId || null,
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
    toolEvents: runtimeToolActions.map((action) => ({
      tool: action.tool_name,
      input: action.input_preview || null,
      result: action.output_preview || action.title || '',
      status: action.status,
      summary: action.output_preview || action.title || action.tool_name,
    })),
  };
}
