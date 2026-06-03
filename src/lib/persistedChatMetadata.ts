import type { ChatCommandDecision } from './chatCommandRegistry';
import type { AgentPlanDraft } from './agentPlanMode';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type {
  ChatComputerAppRouteDecisionSummary,
  ChatComputerHandoffMetadata,
} from './chatComputerHandoffContext';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { OpenSwanTaskPlan } from './openswanTaskPlanner';
import type { OpenSwanToolEvent } from './openswanToolRuntime';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';
import type { ResearchDocumentReference } from './researchControl';
import type { SwanBotStructuredArtifact, SwanBotStructuredResponse } from './swanbot';
import type { WikiArticleReference } from './wikiData';

const LEGACY_CROWN_PREFIX = /^👑 \*\*OpenSwan:\*\* /u;
const BOT_PREFIX = /^(🦢|🤖) \*\*[^*]{1,80}:\*\* /u;
export const BOT_META_MARKER = '\n[[UC_CHAT_META]]';
const MAX_PERSISTED_BOT_MESSAGE_CHARS = 9000;
const MAX_PERSISTED_RESPONSE_CHARS = 6400;

export type PersistedChatRecoveryOption = {
  id: string;
  label: string;
  detail: string;
  actor: 'user' | 'openswan' | 'connected_agent' | 'llm' | 'none';
  recommended: boolean;
  source: 'checkpoint_guard' | 'evidence_contract' | 'connected_agent_runbook' | 'recovery_policy' | 'safety_stop';
};

export type PersistedChatRecoveryReliabilitySummary = {
  surfaceKind?: string | null;
  targetName?: string | null;
  taskFamily?: string | null;
  failureArea?: string | null;
  retryAllowed?: boolean;
  userActionRequired?: boolean;
  connectedAgentAllowed?: boolean;
  recommendedOptionId?: string | null;
  readinessStatus?: string | null;
  nextEvidenceTools?: string[];
  requiredEvidenceTools?: string[];
  requiredFreshEvidence?: string[];
  requiredProof?: string[];
  approvalBoundaries?: string[];
  failClosedRules?: string[];
  routeDecisionStatus?: string | null;
  routeDecisionSurface?: string | null;
  selectedRecoveryOptionId?: string | null;
  verificationCommands?: string[];
};

export type PersistedChatBotMetadata = {
  localMessageId?: string;
  source?: {
    actor?: string;
    surface?: string;
    selectedModel?: string | null;
    effectiveModel?: string | null;
    provider?: string | null;
  };
  usage?: SwanBotStructuredResponse['usage'] | null;
  commandDecisions?: ChatCommandDecision[];
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: PersistedChatRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerHandoff?: ChatComputerHandoffMetadata | null;
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints?: string[];
    blockers?: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary | null;
  routing?: SwanBotStructuredResponse['routing'] | null;
};

function normalizeChatAgentName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'Agent') return 'OpenSwan';
  return trimmed;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 36)).trimEnd()}\n\n[truncated for saved chat]`;
}

function compactRecoveryOptions(
  options?: PersistedChatRecoveryOption[],
  limit = 5,
): PersistedChatRecoveryOption[] | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  return options.slice(0, limit)
    .map((option: any) => ({
      id: truncateText(String(option?.id || option?.label || 'recovery_option'), 80),
      label: truncateText(String(option?.label || 'Recovery option'), 120),
      detail: truncateText(String(option?.detail || ''), 360),
      actor: option?.actor === 'user'
        || option?.actor === 'openswan'
        || option?.actor === 'connected_agent'
        || option?.actor === 'llm'
        || option?.actor === 'none'
        ? option.actor
        : 'none',
      recommended: option?.recommended === true,
      source: option?.source === 'checkpoint_guard'
        || option?.source === 'evidence_contract'
        || option?.source === 'connected_agent_runbook'
        || option?.source === 'recovery_policy'
        || option?.source === 'safety_stop'
        ? option.source
        : 'recovery_policy',
    }))
    .filter((option) => option.id && option.label) as PersistedChatRecoveryOption[];
}

function compactStringList(value: unknown, limit: number, maxChars: number): string[] {
  return Array.isArray(value)
    ? value.slice(0, limit).map((item) => truncateText(String(item || ''), maxChars)).filter(Boolean)
    : [];
}

function compactRecoveryReliability(
  summary?: PersistedChatRecoveryReliabilitySummary | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): PersistedChatRecoveryReliabilitySummary | undefined {
  if (!summary || typeof summary !== 'object') return undefined;
  const itemLimit = mode === 'full' ? 5 : mode === 'minimal' ? 3 : 2;
  const textLimit = mode === 'full' ? 180 : mode === 'minimal' ? 130 : 90;
  const compacted: PersistedChatRecoveryReliabilitySummary = {
    surfaceKind: summary.surfaceKind ? truncateText(String(summary.surfaceKind), 60) : null,
    targetName: summary.targetName ? truncateText(String(summary.targetName), 120) : null,
    taskFamily: summary.taskFamily ? truncateText(String(summary.taskFamily), 120) : null,
    failureArea: summary.failureArea ? truncateText(String(summary.failureArea), 80) : null,
    retryAllowed: summary.retryAllowed === true,
    userActionRequired: summary.userActionRequired === true,
    connectedAgentAllowed: summary.connectedAgentAllowed === true,
    recommendedOptionId: summary.recommendedOptionId ? truncateText(String(summary.recommendedOptionId), 100) : null,
    readinessStatus: summary.readinessStatus ? truncateText(String(summary.readinessStatus), 60) : null,
    nextEvidenceTools: compactStringList(summary.nextEvidenceTools, itemLimit, 120),
    requiredEvidenceTools: compactStringList(summary.requiredEvidenceTools, itemLimit, 120),
    requiredFreshEvidence: compactStringList(summary.requiredFreshEvidence, itemLimit, textLimit),
    requiredProof: compactStringList(summary.requiredProof, itemLimit, textLimit),
    approvalBoundaries: compactStringList(summary.approvalBoundaries, itemLimit, textLimit),
    failClosedRules: compactStringList(summary.failClosedRules, itemLimit, textLimit),
    routeDecisionStatus: summary.routeDecisionStatus ? truncateText(String(summary.routeDecisionStatus), 80) : null,
    routeDecisionSurface: summary.routeDecisionSurface ? truncateText(String(summary.routeDecisionSurface), 140) : null,
    selectedRecoveryOptionId: summary.selectedRecoveryOptionId ? truncateText(String(summary.selectedRecoveryOptionId), 100) : null,
    verificationCommands: compactStringList(summary.verificationCommands, mode === 'full' ? 8 : 4, 160),
  };
  return compacted.surfaceKind
    || compacted.failureArea
    || compacted.readinessStatus
    || compacted.nextEvidenceTools?.length
    || compacted.requiredEvidenceTools?.length
    ? compacted
    : undefined;
}

function compactComputerRequestNotice(
  notice?: ChatComputerHandoffMetadata['requestNotice'] | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerHandoffMetadata['requestNotice'] | null {
  if (!notice) return null;
  const maxSummary = mode === 'tiny' ? 160 : mode === 'minimal' ? 220 : 360;
  const maxDetail = mode === 'tiny' ? 140 : mode === 'minimal' ? 180 : 260;
  const autonomy = notice.autonomy || {
    userEffort: notice.visibility === 'hidden' ? 'none' : notice.tone === 'attention' ? 'unblock' : notice.primaryAction ? 'approve' : 'review',
    shouldShowUserNotice: notice.visibility === 'user',
    canRunQuietly: notice.visibility === 'hidden',
    canAutoPrepare: false,
    autoPreparationTargets: [],
    primaryUserAction: notice.primaryAction?.detail || null,
    hiddenReason: notice.hiddenReason || null,
    reason: notice.primaryAction?.detail || notice.hiddenReason || 'Saved chat notice predates autonomy metadata.',
    userActionBlockers: [],
    guardrails: [],
    automationSteps: [],
  };
  return {
    visibility: notice.visibility,
    tone: notice.tone,
    title: truncateText(String(notice.title || ''), 80),
    summary: truncateText(String(notice.summary || ''), maxSummary),
    autonomy: {
      userEffort: autonomy.userEffort,
      shouldShowUserNotice: autonomy.shouldShowUserNotice === true,
      canRunQuietly: autonomy.canRunQuietly === true,
      canAutoPrepare: autonomy.canAutoPrepare === true,
      autoPreparationTargets: compactStringList(autonomy.autoPreparationTargets, mode === 'full' ? 5 : 3, 100),
      primaryUserAction: autonomy.primaryUserAction ? truncateText(String(autonomy.primaryUserAction), maxDetail) : null,
      hiddenReason: autonomy.hiddenReason ? truncateText(String(autonomy.hiddenReason), maxDetail) : null,
      reason: truncateText(String(autonomy.reason || ''), maxDetail),
      userActionBlockers: compactStringList(autonomy.userActionBlockers, mode === 'full' ? 3 : 1, maxDetail),
      guardrails: compactStringList(autonomy.guardrails, mode === 'full' ? 4 : 2, maxDetail),
      automationSteps: compactStringList(autonomy.automationSteps, mode === 'full' ? 4 : 2, maxDetail),
    },
    primaryAction: notice.primaryAction
      ? {
          kind: notice.primaryAction.kind,
          label: truncateText(String(notice.primaryAction.label || ''), 120),
          detail: truncateText(String(notice.primaryAction.detail || ''), maxDetail),
        }
      : null,
    secondaryActions: mode === 'full'
      ? (notice.secondaryActions || []).slice(0, 2).map((action) => ({
          kind: action.kind,
          label: truncateText(String(action.label || ''), 120),
          detail: truncateText(String(action.detail || ''), 220),
        }))
      : [],
    badges: (notice.badges || []).slice(0, mode === 'full' ? 5 : 3).map((value) => truncateText(String(value), 80)),
    proof: (notice.proof || []).slice(0, mode === 'full' ? 3 : 2).map((value) => truncateText(String(value), mode === 'tiny' ? 120 : 220)),
    hiddenReason: notice.hiddenReason ? truncateText(String(notice.hiddenReason), maxDetail) : null,
  };
}

function compactComputerTaskEvidenceContract(
  contract?: ChatComputerHandoffMetadata['evidenceContract'] | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerHandoffMetadata['evidenceContract'] | null {
  if (!contract) return null;
  const itemLimit = mode === 'full' ? 5 : mode === 'minimal' ? 3 : 2;
  const textLimit = mode === 'full' ? 180 : mode === 'minimal' ? 140 : 100;
  return {
    schemaVersion: 1,
    kind: contract.kind,
    targetName: truncateText(String(contract.targetName || ''), 120),
    taskFamily: truncateText(String(contract.taskFamily || ''), 120),
    observeBefore: (contract.observeBefore || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    actionabilityChecks: (contract.actionabilityChecks || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    approvalBefore: (contract.approvalBefore || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    mutationGuardrails: (contract.mutationGuardrails || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    proofAfter: (contract.proofAfter || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    failClosedRules: (contract.failClosedRules || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    freshEvidenceRequired: (contract.freshEvidenceRequired || []).slice(0, mode === 'full' ? 4 : 2).map((value) => truncateText(String(value), textLimit)),
    sourceRefs: mode === 'tiny'
      ? []
      : (contract.sourceRefs || []).slice(0, mode === 'full' ? 5 : 3).map((ref) => ({
          label: truncateText(String(ref.label || ''), 120),
          url: truncateText(String(ref.url || ''), 220),
          takeaway: truncateText(String(ref.takeaway || ''), 180),
        })),
    userSummary: truncateText(String(contract.userSummary || ''), mode === 'full' ? 260 : 160),
  };
}

function compactComputerAppRouteDecision(
  decision?: ChatComputerAppRouteDecisionSummary | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerAppRouteDecisionSummary | null {
  if (!decision) return null;
  const itemLimit = mode === 'full' ? 5 : mode === 'minimal' ? 3 : 2;
  const textLimit = mode === 'full' ? 180 : mode === 'minimal' ? 140 : 100;
  return {
    status: decision.status,
    targetName: truncateText(String(decision.targetName || ''), 120),
    taskFamily: truncateText(String(decision.taskFamily || ''), 120),
    chosenSurfaceId: decision.chosenSurfaceId,
    chosenSurfaceLabel: truncateText(String(decision.chosenSurfaceLabel || ''), 140),
    chosenSurfaceFit: truncateText(String(decision.chosenSurfaceFit || ''), 40),
    score: Number.isFinite(decision.score) ? decision.score : 0,
    missingConfirmations: (decision.missingConfirmations || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    missingApprovals: (decision.missingApprovals || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    userActionBlockers: (decision.userActionBlockers || []).slice(0, mode === 'full' ? 4 : 2).map((value) => truncateText(String(value), textLimit)),
    nextSteps: (decision.nextSteps || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    sourceRefs: mode === 'tiny'
      ? []
      : (decision.sourceRefs || []).slice(0, mode === 'full' ? 5 : 3).map((ref) => ({
          label: truncateText(String(ref.label || ''), 120),
          url: truncateText(String(ref.url || ''), 220),
        })),
  };
}

function hasPersistedMetadata(metadata?: PersistedChatBotMetadata): boolean {
  return !!metadata && (
    !!metadata.localMessageId ||
    !!metadata.source ||
    !!metadata.usage ||
    (metadata.commandDecisions?.length || 0) > 0 ||
    (metadata.artifacts?.length || 0) > 0 ||
    (metadata.wikiRefs?.length || 0) > 0 ||
    (metadata.researchRefs?.length || 0) > 0 ||
    (metadata.memoriesUsed?.length || 0) > 0 ||
    (metadata.memoryRefs?.length || 0) > 0 ||
    (metadata.memoryRecommendations?.length || 0) > 0 ||
    (metadata.executionStream?.length || 0) > 0 ||
    !!metadata.agentPlan ||
    !!metadata.taskPlan ||
    (metadata.toolEvents?.length || 0) > 0 ||
    (metadata.verificationResults?.length || 0) > 0 ||
    (metadata.browserPlans?.length || 0) > 0 ||
    (metadata.browserPlanEvents?.length || 0) > 0 ||
    (metadata.browserSessions?.length || 0) > 0 ||
    (metadata.recoveryOptions?.length || 0) > 0 ||
    !!metadata.recoveryReliability ||
    !!metadata.computerHandoff ||
    !!metadata.modeOutcomeSummary?.headline ||
    !!metadata.observedEval ||
    !!metadata.routing
  );
}

// Highest-risk / proof-bearing operations first, so a tight slice at a low
// persistence tier keeps the operations that matter most for accountability.
function sortDesignRunbooksByRisk<T extends { risk?: unknown; operation?: unknown }>(runbooks: readonly T[]): T[] {
  return runbooks.slice().sort((a, b) => {
    const score = (item: T) => {
      let value = item.risk === 'high' ? 30 : item.risk === 'review' ? 20 : 10;
      if (/generative|destructive|relink|asset|package|export|proof/i.test(String(item.operation))) value += 5;
      return value;
    };
    return score(b) - score(a);
  });
}

function compactComputerHandoff(
  handoff?: ChatComputerHandoffMetadata | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerHandoffMetadata | undefined {
  if (!handoff) return undefined;
  if (mode === 'tiny') {
    return {
      surface: handoff.surface,
      entrypoint: handoff.entrypoint || null,
      adapterId: handoff.adapterId || null,
      taskKind: handoff.taskKind || null,
      taskLabel: handoff.taskLabel ? truncateText(String(handoff.taskLabel), 120) : null,
      capabilityProfile: handoff.capabilityProfile || null,
      recommendedMode: handoff.recommendedMode || null,
      browserPlanId: null,
      browserActionCount: handoff.browserActionCount ?? null,
      runId: null,
      preflightStatus: handoff.preflightStatus || null,
      preflightSummary: handoff.preflightSummary ? truncateText(String(handoff.preflightSummary), 120) : null,
      groundingStatus: handoff.groundingStatus || null,
      groundingSummary: handoff.groundingSummary ? truncateText(String(handoff.groundingSummary), 120) : null,
      warningCount: handoff.warningCount || 0,
      blockerCount: handoff.blockerCount || 0,
      warnings: (handoff.warnings || []).slice(0, 1).map((value) => truncateText(String(value), 140)),
      blockers: (handoff.blockers || []).slice(0, 1).map((value) => truncateText(String(value), 140)),
      grantSummary: null,
      approvalSummary: handoff.approvalSummary ? truncateText(String(handoff.approvalSummary), 140) : null,
      desktopAttachmentPackage: handoff.desktopAttachmentPackage
        ? {
            fileCount: handoff.desktopAttachmentPackage.fileCount,
            primaryFileCount: handoff.desktopAttachmentPackage.primaryFileCount,
            stageDirectory: null,
            manifestPath: null,
            sha256Count: handoff.desktopAttachmentPackage.sha256Count,
            files: [],
          }
        : null,
      designAppTask: handoff.designAppTask
        ? {
            appId: handoff.designAppTask.appId,
            appName: handoff.designAppTask.appName,
            taskKind: truncateText(String(handoff.designAppTask.taskKind || ''), 80),
            documentSignals: handoff.designAppTask.documentSignals.slice(0, 2).map((value) => truncateText(String(value), 80)),
            operations: handoff.designAppTask.operations.slice(0, 5),
            requiredInventory: [],
            approvalGates: [],
            verificationSignals: [],
            recommendedTools: handoff.designAppTask.recommendedTools.slice(0, 5),
            creativeAiCapabilities: handoff.designAppTask.creativeAiCapabilities?.slice(0, 4),
          }
        : null,
      designCreativeAi: handoff.designCreativeAi
        ? {
            capabilities: (handoff.designCreativeAi.capabilities || []).slice(0, 2).map((capability) => ({
              id: capability.id,
              label: truncateText(String(capability.label || ''), 80),
              creativeOutcome: '',
              controlSurface: '',
              gapTool: truncateText(String(capability.gapTool || ''), 100),
              buildoutTrigger: '',
            })),
            recipes: (handoff.designCreativeAi.recipes || []).slice(0, 2).map((recipe) => ({
              id: recipe.id,
              capabilityId: recipe.capabilityId,
              label: truncateText(String(recipe.label || ''), 100),
              userVisibleSummary: truncateText(String(recipe.userVisibleSummary || ''), 120),
              approvalSummary: '',
              verificationSummary: '',
              buildoutTool: truncateText(String(recipe.buildoutTool || ''), 100),
              recoveryHint: truncateText(String(recipe.recoveryHint || ''), 120),
            })),
            userVisibleOptions: [],
            creativeBriefSignals: [],
            approvalGates: [],
            verificationSignals: [],
            buildoutTools: (handoff.designCreativeAi.buildoutTools || []).slice(0, 3).map((value) => truncateText(String(value), 100)),
            recoveryHints: (handoff.designCreativeAi.recoveryHints || []).slice(0, 2).map((value) => truncateText(String(value), 120)),
            failClosedRules: [],
            sourceRefs: [],
          }
        : null,
      designExecutionPipeline: handoff.designExecutionPipeline
        ? {
            quietUserSummary: truncateText(String(handoff.designExecutionPipeline.quietUserSummary || ''), 160),
            nextVisibleAction: truncateText(String(handoff.designExecutionPipeline.nextVisibleAction || ''), 140),
            requiredToolSequence: handoff.designExecutionPipeline.requiredToolSequence.slice(0, 6).map((value) => truncateText(String(value), 100)),
            approvalTools: handoff.designExecutionPipeline.approvalTools.slice(0, 2).map((value) => truncateText(String(value), 100)),
            mutationTools: handoff.designExecutionPipeline.mutationTools.slice(0, 4).map((value) => truncateText(String(value), 100)),
            proofTools: handoff.designExecutionPipeline.proofTools.slice(0, 4).map((value) => truncateText(String(value), 100)),
            buildoutTools: handoff.designExecutionPipeline.buildoutTools.slice(0, 4).map((value) => truncateText(String(value), 100)),
            creativeAiRecipeIds: handoff.designExecutionPipeline.creativeAiRecipeIds.slice(0, 4),
            adapterGapOperations: handoff.designExecutionPipeline.adapterGapOperations.slice(0, 4),
            failClosedRules: [],
            phases: handoff.designExecutionPipeline.phases.slice(0, 6).map((phase) => ({
              id: phase.id,
              label: truncateText(String(phase.label || ''), 90),
              operations: phase.operations.slice(0, 3),
              tools: phase.tools.slice(0, 3).map((value) => truncateText(String(value), 100)),
              approvalRequired: phase.approvalRequired === true,
              userVisibleWhen: phase.userVisibleWhen,
              requiredEvidence: [],
              recoveryAction: truncateText(String(phase.recoveryAction || ''), 100),
            })),
          }
        : null,
      designOperationRunbooks: handoff.designOperationRunbooks?.length
        ? sortDesignRunbooksByRisk(handoff.designOperationRunbooks).slice(0, 3).map((runbook) => ({
            operation: runbook.operation,
            label: truncateText(String(runbook.label || ''), 90),
            risk: truncateText(String(runbook.risk || ''), 60),
            controlSurface: '',
            requiredInputs: [],
            approvalBefore: (runbook.approvalBefore || []).slice(0, 1).map((value) => truncateText(String(value), 90)),
            successCriteria: [],
            failClosedConditions: [],
          }))
        : null,
      engineeringCadOperationRunbooks: null,
      designAdapterGaps: handoff.designAdapterGaps?.length
        ? handoff.designAdapterGaps.slice(0, 2).map((gap) => ({
            operation: gap.operation,
            adapterId: truncateText(String(gap.adapterId || ''), 90),
            controlSurface: '',
            missingBridgeTools: gap.missingBridgeTools.slice(0, 2).map((value) => truncateText(String(value), 100)),
            requiredBridgeToolsBeforeRetry: [],
            requiredEvidence: [],
            focusedSmokeCases: [],
            failClosedRules: [],
          }))
        : null,
      designObjectManifest: handoff.designObjectManifest
        ? {
            schemaVersion: 1,
            artifactKind: 'design_object_manifest',
            beforeSnapshotTools: handoff.designObjectManifest.beforeSnapshotTools.slice(0, 4),
            afterSnapshotTools: handoff.designObjectManifest.afterSnapshotTools.slice(0, 4),
            entityKinds: handoff.designObjectManifest.entityKinds.slice(0, 10).map((value) => truncateText(String(value), 80)),
            comparisons: [],
            approvalEvidence: [],
            failClosedConditions: handoff.designObjectManifest.failClosedConditions.slice(0, 2).map((value) => truncateText(String(value), 140)),
            redactionRules: handoff.designObjectManifest.redactionRules.slice(0, 2).map((value) => truncateText(String(value), 140)),
          }
        : null,
      designObjectManifestArtifact: null,
      requestNotice: compactComputerRequestNotice(handoff.requestNotice, 'tiny'),
      evidenceContract: compactComputerTaskEvidenceContract(handoff.evidenceContract, 'tiny'),
      appRouteDecision: compactComputerAppRouteDecision(handoff.appRouteDecision, 'tiny'),
      designProofReview: handoff.designProofReview
        ? {
            reviewTitle: truncateText(String(handoff.designProofReview.reviewTitle || ''), 120),
            userVisibleSummary: truncateText(String(handoff.designProofReview.userVisibleSummary || ''), 140),
            checklist: [],
            requiredEvidence: handoff.designProofReview.requiredEvidence.slice(0, 2).map((value) => truncateText(String(value), 140)),
            approvalBefore: [],
            passCriteria: handoff.designProofReview.passCriteria.slice(0, 2).map((value) => truncateText(String(value), 140)),
            failClosedConditions: [],
            artifactKinds: handoff.designProofReview.artifactKinds.slice(0, 3).map((value) => truncateText(String(value), 80)),
          }
        : null,
    };
  }
  const designRunbooks = sortDesignRunbooksByRisk(handoff.designOperationRunbooks || []);
  const cadRunbooks = (handoff.engineeringCadOperationRunbooks || [])
    .slice()
    .sort((a, b) => {
      const score = (item: typeof a) => {
        let value = item.risk === 'high' ? 30 : item.risk === 'review' ? 20 : 10;
        if (/model|bim|batch|convert|export|plot|draft/i.test(String(item.operation))) value += 5;
        return value;
      };
      return score(b) - score(a);
    });
  const files = handoff.desktopAttachmentPackage?.files?.slice(0, mode === 'minimal' ? 3 : 8).map((file) => ({
    name: truncateText(String(file.name || ''), 160),
    localPath: mode === 'minimal' ? '' : truncateText(String(file.localPath || ''), 320),
    appName: file.appName || null,
    sha256: file.sha256 ? String(file.sha256).slice(0, 16) : undefined,
  }));
  return {
    surface: handoff.surface,
    entrypoint: handoff.entrypoint || null,
    adapterId: handoff.adapterId || null,
    taskKind: handoff.taskKind || null,
    taskLabel: handoff.taskLabel ? truncateText(String(handoff.taskLabel), 160) : null,
    capabilityProfile: handoff.capabilityProfile || null,
    recommendedMode: handoff.recommendedMode || null,
    browserPlanId: mode === 'minimal' ? null : handoff.browserPlanId || null,
    browserActionCount: handoff.browserActionCount ?? null,
    runId: mode === 'minimal' ? null : handoff.runId || null,
    preflightStatus: handoff.preflightStatus || null,
    preflightSummary: handoff.preflightSummary ? truncateText(String(handoff.preflightSummary), mode === 'minimal' ? 160 : 360) : null,
    groundingStatus: handoff.groundingStatus || null,
    groundingSummary: handoff.groundingSummary ? truncateText(String(handoff.groundingSummary), mode === 'minimal' ? 160 : 360) : null,
    warningCount: handoff.warningCount || 0,
    blockerCount: handoff.blockerCount || 0,
    warnings: (handoff.warnings || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 260)),
    blockers: (handoff.blockers || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 260)),
    grantSummary: handoff.grantSummary ? truncateText(String(handoff.grantSummary), mode === 'minimal' ? 180 : 360) : null,
    approvalSummary: handoff.approvalSummary ? truncateText(String(handoff.approvalSummary), mode === 'minimal' ? 180 : 360) : null,
    desktopAttachmentPackage: handoff.desktopAttachmentPackage
      ? {
          fileCount: handoff.desktopAttachmentPackage.fileCount,
          primaryFileCount: handoff.desktopAttachmentPackage.primaryFileCount,
          stageDirectory: mode === 'minimal' ? null : handoff.desktopAttachmentPackage.stageDirectory || null,
          manifestPath: mode === 'minimal' ? null : handoff.desktopAttachmentPackage.manifestPath || null,
          sha256Count: handoff.desktopAttachmentPackage.sha256Count,
          files: files || [],
        }
      : null,
    designAppTask: handoff.designAppTask
      ? {
          appId: handoff.designAppTask.appId,
          appName: handoff.designAppTask.appName,
          taskKind: truncateText(String(handoff.designAppTask.taskKind || ''), 80),
          documentSignals: handoff.designAppTask.documentSignals.slice(0, 4).map((value) => truncateText(String(value), 120)),
          operations: handoff.designAppTask.operations.slice(0, 6),
          requiredInventory: handoff.designAppTask.requiredInventory.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          approvalGates: handoff.designAppTask.approvalGates.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          verificationSignals: handoff.designAppTask.verificationSignals.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          recommendedTools: handoff.designAppTask.recommendedTools.slice(0, mode === 'minimal' ? 6 : 10),
        }
      : null,
    designCreativeAi: handoff.designCreativeAi
      ? {
          capabilities: (handoff.designCreativeAi.capabilities || []).slice(0, mode === 'minimal' ? 2 : 4).map((capability) => ({
            id: capability.id,
            label: truncateText(String(capability.label || ''), 120),
            creativeOutcome: truncateText(String(capability.creativeOutcome || ''), mode === 'minimal' ? 120 : 180),
            controlSurface: truncateText(String(capability.controlSurface || ''), mode === 'minimal' ? 120 : 180),
            gapTool: truncateText(String(capability.gapTool || ''), 120),
            buildoutTrigger: truncateText(String(capability.buildoutTrigger || ''), mode === 'minimal' ? 140 : 240),
          })),
          recipes: (handoff.designCreativeAi.recipes || []).slice(0, mode === 'minimal' ? 2 : 4).map((recipe) => ({
            id: recipe.id,
            capabilityId: recipe.capabilityId,
            label: truncateText(String(recipe.label || ''), 120),
            userVisibleSummary: truncateText(String(recipe.userVisibleSummary || ''), mode === 'minimal' ? 140 : 220),
            approvalSummary: truncateText(String(recipe.approvalSummary || ''), mode === 'minimal' ? 120 : 220),
            verificationSummary: truncateText(String(recipe.verificationSummary || ''), mode === 'minimal' ? 120 : 220),
            buildoutTool: truncateText(String(recipe.buildoutTool || ''), 120),
            recoveryHint: truncateText(String(recipe.recoveryHint || ''), mode === 'minimal' ? 120 : 220),
          })),
          userVisibleOptions: (handoff.designCreativeAi.userVisibleOptions || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 140 : 220)),
          creativeBriefSignals: (handoff.designCreativeAi.creativeBriefSignals || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 120)),
          approvalGates: (handoff.designCreativeAi.approvalGates || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          verificationSignals: (handoff.designCreativeAi.verificationSignals || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          buildoutTools: (handoff.designCreativeAi.buildoutTools || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 120)),
          recoveryHints: (handoff.designCreativeAi.recoveryHints || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          failClosedRules: (handoff.designCreativeAi.failClosedRules || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          sourceRefs: (handoff.designCreativeAi.sourceRefs || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 180)),
        }
      : null,
    designExecutionPipeline: handoff.designExecutionPipeline
      ? {
          quietUserSummary: truncateText(String(handoff.designExecutionPipeline.quietUserSummary || ''), 240),
          nextVisibleAction: truncateText(String(handoff.designExecutionPipeline.nextVisibleAction || ''), 220),
          requiredToolSequence: handoff.designExecutionPipeline.requiredToolSequence.slice(0, mode === 'minimal' ? 6 : 12).map((value) => truncateText(String(value), 120)),
          approvalTools: handoff.designExecutionPipeline.approvalTools.slice(0, mode === 'minimal' ? 3 : 6).map((value) => truncateText(String(value), 120)),
          mutationTools: handoff.designExecutionPipeline.mutationTools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
          proofTools: handoff.designExecutionPipeline.proofTools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
          buildoutTools: handoff.designExecutionPipeline.buildoutTools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
          creativeAiRecipeIds: handoff.designExecutionPipeline.creativeAiRecipeIds.slice(0, mode === 'minimal' ? 4 : 8),
          adapterGapOperations: handoff.designExecutionPipeline.adapterGapOperations.slice(0, mode === 'minimal' ? 4 : 8),
          failClosedRules: handoff.designExecutionPipeline.failClosedRules.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 220)),
          phases: handoff.designExecutionPipeline.phases.slice(0, mode === 'minimal' ? 4 : 6).map((phase) => ({
            id: phase.id,
            label: truncateText(String(phase.label || ''), 120),
            operations: phase.operations.slice(0, mode === 'minimal' ? 3 : 5),
            tools: phase.tools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
            approvalRequired: phase.approvalRequired === true,
            userVisibleWhen: phase.userVisibleWhen,
            requiredEvidence: phase.requiredEvidence.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 160)),
            recoveryAction: truncateText(String(phase.recoveryAction || ''), mode === 'minimal' ? 120 : 220),
          })),
        }
      : null,
    designObjectManifest: handoff.designObjectManifest && mode !== 'minimal'
      ? {
          schemaVersion: 1,
          artifactKind: 'design_object_manifest',
          beforeSnapshotTools: handoff.designObjectManifest.beforeSnapshotTools.slice(0, 8),
          afterSnapshotTools: handoff.designObjectManifest.afterSnapshotTools.slice(0, 8),
          entityKinds: handoff.designObjectManifest.entityKinds.slice(0, 10).map((value) => truncateText(String(value), 80)),
          comparisons: handoff.designObjectManifest.comparisons.slice(0, 8).map((value) => truncateText(String(value), 180)),
          approvalEvidence: handoff.designObjectManifest.approvalEvidence.slice(0, 8).map((value) => truncateText(String(value), 180)),
          failClosedConditions: handoff.designObjectManifest.failClosedConditions.slice(0, 6).map((value) => truncateText(String(value), 180)),
          redactionRules: handoff.designObjectManifest.redactionRules.slice(0, 4).map((value) => truncateText(String(value), 180)),
        }
      : null,
    designObjectManifestArtifact: handoff.designObjectManifestArtifact
      ? {
          schemaVersion: 1,
          artifactKind: 'design_object_manifest',
          appId: handoff.designObjectManifestArtifact.appId,
          appName: truncateText(String(handoff.designObjectManifestArtifact.appName || ''), 120),
          taskKind: handoff.designObjectManifestArtifact.taskKind,
          operations: handoff.designObjectManifestArtifact.operations.slice(0, mode === 'minimal' ? 6 : 10),
          generatedAt: truncateText(String(handoff.designObjectManifestArtifact.generatedAt || ''), 80),
          auditOk: handoff.designObjectManifestArtifact.auditOk === true,
          blockerCount: handoff.designObjectManifestArtifact.blockerCount || 0,
          warningCount: handoff.designObjectManifestArtifact.warningCount || 0,
          beforeToolCount: handoff.designObjectManifestArtifact.beforeToolCount || 0,
          afterToolCount: handoff.designObjectManifestArtifact.afterToolCount || 0,
          actionCount: handoff.designObjectManifestArtifact.actionCount || 0,
          artifactCount: handoff.designObjectManifestArtifact.artifactCount || 0,
          activeDocumentName: handoff.designObjectManifestArtifact.activeDocumentName
            ? truncateText(String(handoff.designObjectManifestArtifact.activeDocumentName), 160)
            : null,
          activeDocumentBasename: handoff.designObjectManifestArtifact.activeDocumentBasename
            ? truncateText(String(handoff.designObjectManifestArtifact.activeDocumentBasename), 160)
            : null,
          changedEntityKinds: handoff.designObjectManifestArtifact.changedEntityKinds.slice(0, mode === 'minimal' ? 6 : 10),
          artifactKinds: handoff.designObjectManifestArtifact.artifactKinds.slice(0, mode === 'minimal' ? 6 : 10),
          comparisonStatuses: handoff.designObjectManifestArtifact.comparisonStatuses.slice(0, mode === 'minimal' ? 5 : 10).map((item) => ({
            label: truncateText(String(item.label || ''), 160),
            status: item.status,
          })),
          proofArtifacts: handoff.designObjectManifestArtifact.proofArtifacts.slice(0, mode === 'minimal' ? 3 : 6).map((item) => ({
            label: truncateText(String(item.label || ''), 120),
            basename: item.basename ? truncateText(String(item.basename), 160) : null,
            format: item.format || null,
            sizeBytes: item.sizeBytes ?? null,
            widthPx: item.widthPx ?? null,
            heightPx: item.heightPx ?? null,
            pageCount: item.pageCount ?? null,
          })),
          packageArtifacts: handoff.designObjectManifestArtifact.packageArtifacts.slice(0, mode === 'minimal' ? 2 : 4).map((item) => ({
            label: truncateText(String(item.label || ''), 120),
            basename: item.basename ? truncateText(String(item.basename), 160) : null,
            sizeBytes: item.sizeBytes ?? null,
          })),
          blockers: handoff.designObjectManifestArtifact.blockers.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 220)),
          warnings: handoff.designObjectManifestArtifact.warnings.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 220)),
          redaction: 'basename_hash_only',
        }
      : null,
    designOperationRunbooks: designRunbooks.length
      ? designRunbooks.slice(0, mode === 'minimal' ? 2 : 4).map((runbook) => ({
          operation: runbook.operation,
          label: truncateText(String(runbook.label || ''), mode === 'minimal' ? 100 : 140),
          risk: truncateText(String(runbook.risk || ''), 60),
          controlSurface: truncateText(String(runbook.controlSurface || ''), mode === 'minimal' ? 100 : 160),
          requiredInputs: runbook.requiredInputs.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          approvalBefore: runbook.approvalBefore.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          successCriteria: runbook.successCriteria.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          failClosedConditions: runbook.failClosedConditions.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
        }))
      : null,
    engineeringCadOperationRunbooks: cadRunbooks.length
      ? cadRunbooks.slice(0, mode === 'minimal' ? 2 : 4).map((runbook) => ({
          operation: runbook.operation,
          label: truncateText(String(runbook.label || ''), mode === 'minimal' ? 100 : 140),
          risk: truncateText(String(runbook.risk || ''), 60),
          controlSurface: truncateText(String(runbook.controlSurface || ''), mode === 'minimal' ? 100 : 160),
          requiredInputs: runbook.requiredInputs.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          approvalBefore: runbook.approvalBefore.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          successCriteria: runbook.successCriteria.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          failClosedConditions: runbook.failClosedConditions.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
        }))
      : null,
    designAdapterGaps: handoff.designAdapterGaps?.length
      ? handoff.designAdapterGaps.slice(0, mode === 'minimal' ? 2 : 4).map((gap) => ({
          operation: gap.operation,
          adapterId: truncateText(String(gap.adapterId || ''), 120),
          controlSurface: truncateText(String(gap.controlSurface || ''), mode === 'minimal' ? 100 : 180),
          missingBridgeTools: gap.missingBridgeTools.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 120)),
          requiredBridgeToolsBeforeRetry: gap.requiredBridgeToolsBeforeRetry.slice(0, mode === 'minimal' ? 2 : 5).map((value) => truncateText(String(value), 120)),
          requiredEvidence: gap.requiredEvidence.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 160)),
          focusedSmokeCases: gap.focusedSmokeCases.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 160)),
          failClosedRules: gap.failClosedRules.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 180)),
        }))
      : null,
    requestNotice: compactComputerRequestNotice(handoff.requestNotice, mode),
    evidenceContract: compactComputerTaskEvidenceContract(handoff.evidenceContract, mode),
    appRouteDecision: compactComputerAppRouteDecision(handoff.appRouteDecision, mode),
    designProofReview: handoff.designProofReview
      ? {
          reviewTitle: truncateText(String(handoff.designProofReview.reviewTitle || ''), 140),
          userVisibleSummary: truncateText(String(handoff.designProofReview.userVisibleSummary || ''), 240),
          checklist: handoff.designProofReview.checklist.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          requiredEvidence: handoff.designProofReview.requiredEvidence.slice(0, mode === 'minimal' ? 4 : 6).map((value) => truncateText(String(value), 180)),
          approvalBefore: handoff.designProofReview.approvalBefore.slice(0, mode === 'minimal' ? 4 : 6).map((value) => truncateText(String(value), 180)),
          passCriteria: handoff.designProofReview.passCriteria.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          failClosedConditions: handoff.designProofReview.failClosedConditions.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          artifactKinds: handoff.designProofReview.artifactKinds.slice(0, mode === 'minimal' ? 4 : 6).map((value) => truncateText(String(value), 80)),
        }
      : null,
  };
}

function compactPersistedMetadata(metadata?: PersistedChatBotMetadata): PersistedChatBotMetadata | undefined {
  if (!metadata) return undefined;
  return {
    localMessageId: metadata.localMessageId,
    source: metadata.source,
    usage: metadata.usage,
    commandDecisions: metadata.commandDecisions?.slice(0, 8),
    artifacts: metadata.artifacts?.slice(0, 8).map((artifact) => ({
      ...artifact,
      content: artifact.content ? truncateText(artifact.content, 1200) : artifact.content,
    })),
    wikiRefs: metadata.wikiRefs?.slice(0, 5),
    researchRefs: metadata.researchRefs?.slice(0, 5),
    memoriesUsed: metadata.memoriesUsed?.slice(0, 12),
    memoryRefs: metadata.memoryRefs?.slice(0, 8),
    memoryRecommendations: metadata.memoryRecommendations?.slice(0, 6),
    executionStream: metadata.executionStream?.slice(0, 12).map((step: any) => ({
      ...step,
      body: typeof step?.body === 'string' ? truncateText(step.body, 800) : step?.body,
      summary: typeof step?.summary === 'string' ? truncateText(step.summary, 800) : step?.summary,
    })) as any,
    agentPlan: metadata.agentPlan ? {
      id: (metadata.agentPlan as any).id || null,
      title: truncateText(String((metadata.agentPlan as any).title || 'Agent plan'), 180),
      task: truncateText(String((metadata.agentPlan as any).task || ''), 500),
      mode: (metadata.agentPlan as any).mode,
      status: (metadata.agentPlan as any).status,
      risk: (metadata.agentPlan as any).risk,
      buildReady: !!(metadata.agentPlan as any).buildReady,
      stepCount: Array.isArray((metadata.agentPlan as any).steps) ? (metadata.agentPlan as any).steps.length : (metadata.agentPlan as any).stepCount,
      questionCount: Array.isArray((metadata.agentPlan as any).questions) ? (metadata.agentPlan as any).questions.length : (metadata.agentPlan as any).questionCount,
      flow: (metadata.agentPlan as any).flow,
      steps: Array.isArray((metadata.agentPlan as any).steps)
        ? (metadata.agentPlan as any).steps.slice(0, 8).map((step: any) => ({
            order: step.order,
            kind: step.kind,
            title: truncateText(String(step.title || ''), 180),
            requiresApproval: !!step.requiresApproval,
            toolNames: Array.isArray(step.toolNames) ? step.toolNames.slice(0, 8) : [],
          }))
        : undefined,
      questions: Array.isArray((metadata.agentPlan as any).questions)
        ? (metadata.agentPlan as any).questions.slice(0, 5).map((question: any) => ({
            order: question.order,
            question: truncateText(String(question.question || ''), 240),
            status: question.status,
          }))
        : undefined,
    } as any : undefined,
    taskPlan: metadata.taskPlan ? {
      kind: metadata.taskPlan.kind,
      profile: metadata.taskPlan.profile,
      summary: truncateText(String(metadata.taskPlan.summary || ''), 800),
      recommendedTools: metadata.taskPlan.recommendedTools?.slice(0, 12),
      verification: metadata.taskPlan.verification?.slice(0, 12).map((check) => ({
        ...check,
        reason: truncateText(String(check.reason || ''), 300),
      })),
    } as any : undefined,
    toolEvents: metadata.toolEvents?.slice(-16).map((event) => ({
      tool: event.tool,
      status: event.status,
      summary: truncateText(String(event.summary || ''), 700),
      command: event.command ? truncateText(event.command, 500) : undefined,
      metadata: event.metadata,
    })) as any,
    verificationResults: metadata.verificationResults?.slice(-12).map((result) => ({
      check: result.check,
      status: result.status,
      ok: result.ok,
      executed: result.executed,
      summary: truncateText(String(result.summary || ''), 700),
      command: result.command ? truncateText(result.command, 500) : undefined,
      stdout: result.stdout ? truncateText(result.stdout, 500) : undefined,
      stderr: result.stderr ? truncateText(result.stderr, 500) : undefined,
      error: result.error ? truncateText(result.error, 500) : undefined,
      execution: result.execution ? {
        ...result.execution,
        summary: truncateText(String(result.execution.summary || ''), 500),
        command: result.execution.command ? truncateText(result.execution.command, 400) : undefined,
        error: result.execution.error ? truncateText(String(result.execution.error), 400) : result.execution.error,
      } : result.execution,
    })) as any,
    browserPlans: metadata.browserPlans?.slice(0, 3).map((plan: any) => ({
      planId: plan.planId,
      task: truncateText(String(plan.task || ''), 500),
      backend: plan.backend,
      backendLabel: plan.backendLabel,
      backendDetails: plan.backendDetails,
      requiresApproval: plan.requiresApproval,
      recommendedPermission: plan.recommendedPermission,
      status: plan.status,
      launchedAt: plan.launchedAt,
      completedAt: plan.completedAt,
      backendSessionId: plan.backendSessionId,
      backendLiveUrl: plan.backendLiveUrl,
      actions: Array.isArray(plan.actions)
        ? plan.actions.slice(0, 10).map((action: any) => ({
            id: action.id,
            type: action.type,
            target: typeof action.target === 'string' ? truncateText(action.target, 240) : action.target,
            value: typeof action.value === 'string' ? truncateText(action.value, 160) : action.value,
            description: typeof action.description === 'string' ? truncateText(action.description, 300) : action.description,
            requiresApproval: action.requiresApproval,
            approvalReason: action.approvalReason,
            blockedReason: action.blockedReason,
          }))
        : [],
    })) as any,
    browserPlanEvents: metadata.browserPlanEvents?.slice(-12),
    browserSessions: metadata.browserSessions?.slice(-3).map((session: any) => ({
      id: session.id,
      planId: session.planId,
      task: truncateText(String(session.task || ''), 500),
      backend: session.backend,
      backendLabel: session.backendLabel,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      currentUrl: session.currentUrl,
      backendSessionId: session.backendSessionId,
      backendLiveUrl: session.backendLiveUrl,
      recommendedPermission: session.recommendedPermission,
      actions: Array.isArray(session.actions) ? session.actions.slice(0, 10) : [],
    })) as any,
    recoveryOptions: compactRecoveryOptions(metadata.recoveryOptions, 5),
    recoveryReliability: compactRecoveryReliability(metadata.recoveryReliability),
    computerHandoff: compactComputerHandoff(metadata.computerHandoff),
    modeOutcomeSummary: metadata.modeOutcomeSummary,
    observedEval: metadata.observedEval,
    routing: metadata.routing,
  };
}

function minimalPersistedMetadata(metadata?: PersistedChatBotMetadata): PersistedChatBotMetadata | undefined {
  if (!metadata) return undefined;
  return {
    localMessageId: metadata.localMessageId,
    source: metadata.source,
    usage: metadata.usage,
    artifacts: metadata.artifacts?.slice(0, 4).map((artifact) => ({
      kind: artifact.kind,
      title: artifact.title,
      url: artifact.url,
      metadata: artifact.metadata,
    })),
    wikiRefs: metadata.wikiRefs?.slice(0, 3),
    researchRefs: metadata.researchRefs?.slice(0, 3),
    memoriesUsed: metadata.memoriesUsed?.slice(0, 6),
    memoryRefs: metadata.memoryRefs?.slice(0, 4),
    memoryRecommendations: metadata.memoryRecommendations?.slice(0, 3),
    executionStream: metadata.executionStream?.slice(-6).map((step: any) => ({
      id: step?.id,
      status: step?.status,
      title: step?.title,
      kind: step?.kind,
      label: step?.label,
    })) as any,
    agentPlan: metadata.agentPlan ? {
      id: (metadata.agentPlan as any).id || null,
      title: truncateText(String((metadata.agentPlan as any).title || 'Agent plan'), 140),
      mode: (metadata.agentPlan as any).mode,
      status: (metadata.agentPlan as any).status,
      risk: (metadata.agentPlan as any).risk,
      buildReady: !!(metadata.agentPlan as any).buildReady,
      stepCount: Array.isArray((metadata.agentPlan as any).steps) ? (metadata.agentPlan as any).steps.length : (metadata.agentPlan as any).stepCount,
      questionCount: Array.isArray((metadata.agentPlan as any).questions) ? (metadata.agentPlan as any).questions.length : (metadata.agentPlan as any).questionCount,
    } as any : undefined,
    taskPlan: metadata.taskPlan ? {
      kind: metadata.taskPlan.kind,
      profile: metadata.taskPlan.profile,
      summary: truncateText(String(metadata.taskPlan.summary || ''), 240),
    } as any : undefined,
    toolEvents: metadata.toolEvents?.slice(-6).map((event) => ({
      tool: event.tool,
      status: event.status,
      summary: truncateText(String(event.summary || ''), 240),
    })) as any,
    verificationResults: metadata.verificationResults?.slice(-4).map((result) => ({
      check: result.check ? {
        id: result.check.id,
        label: result.check.label,
        kind: result.check.kind,
        required: result.check.required,
      } : result.check,
      status: result.status,
      ok: result.ok,
      executed: result.executed,
      summary: truncateText(String(result.summary || ''), 240),
    })) as any,
    browserPlans: metadata.browserPlans?.slice(0, 2).map((plan: any) => ({
      planId: plan.planId,
      task: truncateText(String(plan.task || ''), 240),
      backend: plan.backend,
      backendLabel: plan.backendLabel,
      requiresApproval: plan.requiresApproval,
      status: plan.status,
      backendSessionId: plan.backendSessionId,
      backendLiveUrl: plan.backendLiveUrl,
      actions: Array.isArray(plan.actions)
        ? plan.actions.slice(0, 5).map((action: any) => ({
            id: action.id,
            type: action.type,
            target: typeof action.target === 'string' ? truncateText(action.target, 120) : action.target,
            description: typeof action.description === 'string' ? truncateText(action.description, 160) : action.description,
            requiresApproval: action.requiresApproval,
          }))
        : [],
    })) as any,
    browserPlanEvents: metadata.browserPlanEvents?.slice(-6),
    browserSessions: metadata.browserSessions?.slice(-2).map((session: any) => ({
      id: session.id,
      planId: session.planId,
      task: truncateText(String(session.task || ''), 240),
      backend: session.backend,
      backendLabel: session.backendLabel,
      status: session.status,
      backendSessionId: session.backendSessionId,
      backendLiveUrl: session.backendLiveUrl,
    })) as any,
    recoveryOptions: compactRecoveryOptions(metadata.recoveryOptions, 3),
    recoveryReliability: compactRecoveryReliability(metadata.recoveryReliability, 'minimal'),
    computerHandoff: compactComputerHandoff(metadata.computerHandoff, 'minimal'),
    modeOutcomeSummary: metadata.modeOutcomeSummary,
    observedEval: metadata.observedEval ? {
      outcome: (metadata.observedEval as any).outcome,
      responseQuality: (metadata.observedEval as any).responseQuality,
      verification: (metadata.observedEval as any).verification,
    } as any : metadata.observedEval,
    routing: metadata.routing,
  };
}

export function isPersistedChatBotMessage(content: string | null | undefined, isBotFlag = false): boolean {
  if (isBotFlag) return true;
  const value = content || '';
  return BOT_PREFIX.test(value) || LEGACY_CROWN_PREFIX.test(value);
}

export function stripPersistedChatBotPrefix(content: string | null | undefined): string {
  const value = content || '';
  const withoutPrefix = value.replace(BOT_PREFIX, '').replace(LEGACY_CROWN_PREFIX, '');
  const metaIndex = withoutPrefix.indexOf(BOT_META_MARKER);
  return metaIndex >= 0 ? withoutPrefix.slice(0, metaIndex) : withoutPrefix;
}

export function readPersistedChatBotMetadata(content: string | null | undefined): PersistedChatBotMetadata | null {
  const value = content || '';
  const metaIndex = value.indexOf(BOT_META_MARKER);
  if (metaIndex < 0) return null;
  const raw = value.slice(metaIndex + BOT_META_MARKER.length).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedChatBotMetadata;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function formatPersistedChatBotMessage(
  agentName: string,
  content: string,
  metadata?: PersistedChatBotMetadata,
): string {
  const visibleContent = truncateText(content || '', MAX_PERSISTED_RESPONSE_CHARS);
  const base = `🦢 **${normalizeChatAgentName(agentName)}:** ${visibleContent}`;
  if (!hasPersistedMetadata(metadata)) return base;
  const normalizedMetadata = metadata
    ? {
        ...metadata,
        recoveryOptions: compactRecoveryOptions(metadata.recoveryOptions, 5),
        recoveryReliability: compactRecoveryReliability(metadata.recoveryReliability),
        computerHandoff: compactComputerHandoff(metadata.computerHandoff),
      }
    : undefined;

  // The 'tiny' tier now carries the proof-critical design fields (object
  // manifest, operation runbooks, proof review) packed alongside the narrative,
  // so large design tasks persist their evidence instead of dropping it. The
  // narrative-only variant follows as a guaranteed-smaller fallback: if the
  // evidence-bearing tier still exceeds the byte cap, we fall back to today's
  // behavior rather than collapsing straight to no metadata.
  const tinyHandoff = normalizedMetadata?.computerHandoff
    ? compactComputerHandoff(normalizedMetadata.computerHandoff, 'tiny')
    : undefined;
  const candidates = [
    normalizedMetadata,
    compactPersistedMetadata(normalizedMetadata),
    minimalPersistedMetadata(normalizedMetadata),
    tinyHandoff
      ? { ...minimalPersistedMetadata(normalizedMetadata), computerHandoff: tinyHandoff }
      : undefined,
    tinyHandoff
      ? {
          ...minimalPersistedMetadata(normalizedMetadata),
          computerHandoff: {
            ...tinyHandoff,
            designObjectManifest: null,
            designOperationRunbooks: null,
            designProofReview: null,
          },
        }
      : undefined,
    undefined,
  ];

  for (const candidate of candidates) {
    const message = candidate && hasPersistedMetadata(candidate)
      ? `${base}${BOT_META_MARKER}${JSON.stringify(candidate)}`
      : base;
    if (message.length <= MAX_PERSISTED_BOT_MESSAGE_CHARS) return message;
  }

  return truncateText(base, MAX_PERSISTED_BOT_MESSAGE_CHARS);
}
