import { DESKTOP_ATTACHMENT_TASK_MARKER, parseDesktopAttachmentTaskFiles } from './chatDesktopAttachmentRouting';
import {
  buildDesignAppAutomationPlan,
  type DesignAppAutomationAppId,
  type DesignAppAutomationOperation,
} from './designAppAutomation';
import {
  buildDesignAppCreativeAiPlan,
  type DesignAppCreativeAiCapabilityId,
  buildDesignAppCreativeAiRecipePlan,
  type DesignAppCreativeAiRecipeId,
} from './designAppCreativeAi';
import { buildDesignAppAdapterGapPlan } from './designAppAdapterGaps';
import {
  buildDesignAppExecutionPipelinePlan,
  type DesignAppExecutionPipelinePhaseId,
  type DesignAppExecutionPipelineVisibility,
} from './designAppExecutionPipeline';
import {
  buildDesignAppObjectManifestPlan,
  summarizeDesignAppObjectManifestArtifact,
  type DesignAppObjectManifestArtifact,
  type DesignAppObjectManifestArtifactSummary,
} from './designAppObjectManifest';
import { buildDesignAppOperationRunbookPlan } from './designAppOperationRunbooks';
import { buildDesignAppProofReviewPlan, type DesignAppProofReviewPlan } from './designAppProofReview';
import {
  buildEngineeringCadOperationRunbookPlan,
  type EngineeringCadOperation,
} from './engineeringCadOperationRunbooks';
import {
  formatChatComputerRequestUserNotice,
  type ChatComputerRequestUserNotice,
} from './chatComputerRequestUx';
import type {
  AppAutomationControlSurfaceId,
  AppAutomationRouteDecision,
  AppAutomationRouteDecisionStatus,
} from './appAutomationControlSurfaces';
import {
  formatStickyScopeAppliedNotice,
  type StickyScopeAppliedSummary,
} from './computerGrantGate';
import type { ComputerTaskEvidenceContract } from './computerTaskEvidenceContract';
import { getModelCapabilityFlags, normalizeModelId } from './modelCapabilities';
import type { ComputerTaskOutcomeStatus, ComputerTaskReplayPolicy } from './computerTaskOutcome';

export type ChatComputerSurfaceKind = 'browser' | 'desktop' | 'local_files' | 'computer';

/** Stable, value-free identity for the one read-only check allowed after an
 * uncertain mutation. Persisting this with the handoff prevents refresh from
 * silently retargeting the check to whichever app or file is current later. */
export interface ChatComputerVerificationTarget {
  appName?: string | null;
  browserIdentity?: {
    browserProcessId: string;
    browserContextId: string;
    pageId: string;
    url: string;
  } | null;
  expectedDocumentName?: string | null;
  expectedWidthPx?: number | null;
  expectedHeightPx?: number | null;
  filePath?: string | null;
}

export interface ChatComputerHandoffContextInput {
  task: string;
  entrypoint?: string | null;
  adapterId?: string | null;
  taskKind?: string | null;
  taskLabel?: string | null;
  capabilityProfile?: string | null;
  recommendedMode?: string | null;
  grantSummary?: string | null;
  approvalSummary?: string | null;
  browserPlanId?: string | null;
  browserActionCount?: number | null;
  runId?: string | null;
  outcomeStatus?: ComputerTaskOutcomeStatus | null;
  replayPolicy?: ComputerTaskReplayPolicy | null;
  mutationDispatched?: boolean;
  verificationOnlyTools?: string[];
  verificationBridgeInstanceId?: string | null;
  verificationTarget?: ChatComputerVerificationTarget | null;
  preflightStatus?: string | null;
  preflightSummary?: string | null;
  groundingStatus?: string | null;
  groundingSummary?: string | null;
  designObjectManifestArtifact?: DesignAppObjectManifestArtifact | null;
  requestNotice?: ChatComputerRequestUserNotice | null;
  evidenceContract?: ComputerTaskEvidenceContract | null;
  appAutomationRouteDecision?: AppAutomationRouteDecision | null;
  /**
   * T7 sticky allow scopes: set when the route's `stickyScopeApplied` stamp
   * downgraded approval via a standing grant, so handoff metadata and the
   * compact route summary carry the visible notice + scope id. Optional and
   * persisted-compatible — rows written before this field keep parsing.
   */
  stickyScopeApplied?: Pick<StickyScopeAppliedSummary, 'scopeId' | 'scopeKey'> | null;
  warnings?: string[];
  rawWarnings?: string[];
  blockers?: string[];
}

export interface ChatDesignAppTaskSummary {
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: string;
  documentSignals: string[];
  operations: DesignAppAutomationOperation[];
  requiredInventory: string[];
  approvalGates: string[];
  verificationSignals: string[];
  recommendedTools: string[];
  creativeAiCapabilities?: DesignAppCreativeAiCapabilityId[];
}

export interface ChatComputerHandoffMetadata {
  surface: ChatComputerSurfaceKind;
  entrypoint?: string | null;
  adapterId?: string | null;
  taskKind?: string | null;
  taskLabel?: string | null;
  capabilityProfile?: string | null;
  recommendedMode?: string | null;
  browserPlanId?: string | null;
  browserActionCount?: number | null;
  runId?: string | null;
  outcomeStatus?: ComputerTaskOutcomeStatus | null;
  replayPolicy?: ComputerTaskReplayPolicy | null;
  mutationDispatched?: boolean;
  verificationOnlyTools?: string[];
  verificationBridgeInstanceId?: string | null;
  verificationTarget?: ChatComputerVerificationTarget | null;
  preflightStatus?: string | null;
  preflightSummary?: string | null;
  groundingStatus?: string | null;
  groundingSummary?: string | null;
  warningCount: number;
  blockerCount: number;
  warnings: string[];
  rawWarnings?: string[];
  blockers: string[];
  grantSummary?: string | null;
  approvalSummary?: string | null;
  desktopAttachmentPackage?: {
    fileCount: number;
    primaryFileCount: number;
    stageDirectory?: string | null;
    manifestPath?: string | null;
    sha256Count: number;
    files: Array<{
      name: string;
      localPath: string;
      appName?: string | null;
      sha256?: string | null;
    }>;
  } | null;
  designAppTask?: ChatDesignAppTaskSummary | null;
  designProofReview?: {
    reviewTitle: string;
    userVisibleSummary: string;
    checklist: string[];
    requiredEvidence: string[];
    approvalBefore: string[];
    passCriteria: string[];
    failClosedConditions: string[];
    artifactKinds: string[];
  } | null;
  designCreativeAi?: {
    capabilities: Array<{
      id: DesignAppCreativeAiCapabilityId;
      label: string;
      creativeOutcome: string;
      controlSurface: string;
      gapTool: string;
      buildoutTrigger: string;
    }>;
    recipes: Array<{
      id: DesignAppCreativeAiRecipeId;
      capabilityId: DesignAppCreativeAiCapabilityId;
      label: string;
      userVisibleSummary: string;
      approvalSummary: string;
      verificationSummary: string;
      buildoutTool: string;
      recoveryHint: string;
    }>;
    userVisibleOptions: string[];
    creativeBriefSignals: string[];
    approvalGates: string[];
    verificationSignals: string[];
    buildoutTools: string[];
    recoveryHints: string[];
    failClosedRules: string[];
    sourceRefs: string[];
  } | null;
  designOperationRunbooks?: Array<{
    operation: DesignAppAutomationOperation;
    label: string;
    risk: string;
    controlSurface: string;
    requiredInputs: string[];
    approvalBefore: string[];
    successCriteria: string[];
    failClosedConditions: string[];
  }> | null;
  engineeringCadOperationRunbooks?: Array<{
    operation: EngineeringCadOperation;
    label: string;
    risk: string;
    controlSurface: string;
    requiredInputs: string[];
    approvalBefore: string[];
    successCriteria: string[];
    failClosedConditions: string[];
  }> | null;
  designExecutionPipeline?: {
    quietUserSummary: string;
    nextVisibleAction: string;
    requiredToolSequence: string[];
    approvalTools: string[];
    mutationTools: string[];
    proofTools: string[];
    buildoutTools: string[];
    creativeAiRecipeIds: DesignAppCreativeAiRecipeId[];
    adapterGapOperations: DesignAppAutomationOperation[];
    failClosedRules: string[];
    phases: Array<{
      id: DesignAppExecutionPipelinePhaseId;
      label: string;
      operations: DesignAppAutomationOperation[];
      tools: string[];
      approvalRequired: boolean;
      userVisibleWhen: DesignAppExecutionPipelineVisibility;
      requiredEvidence: string[];
      recoveryAction: string;
    }>;
  } | null;
  designAdapterGaps?: Array<{
    operation: DesignAppAutomationOperation;
    adapterId: string;
    controlSurface: string;
    missingBridgeTools: string[];
    requiredBridgeToolsBeforeRetry: string[];
    requiredEvidence: string[];
    focusedSmokeCases: string[];
    failClosedRules: string[];
  }> | null;
  designObjectManifest?: {
    schemaVersion: 1;
    artifactKind: 'design_object_manifest';
    beforeSnapshotTools: string[];
    afterSnapshotTools: string[];
    entityKinds: string[];
    comparisons: string[];
    approvalEvidence: string[];
    failClosedConditions: string[];
    redactionRules: string[];
  } | null;
  designObjectManifestArtifact?: DesignAppObjectManifestArtifactSummary | null;
  requestNotice?: ChatComputerRequestUserNotice | null;
  evidenceContract?: ComputerTaskEvidenceContract | null;
  appRouteDecision?: ChatComputerAppRouteDecisionSummary | null;
  /** T7: standing-grant stamp (scope id + bounded user-visible notice). */
  standingGrant?: { scopeId: string; scopeKey: string; notice: string } | null;
}

export interface ChatComputerAppRouteDecisionSummary {
  status: AppAutomationRouteDecisionStatus;
  targetName: string;
  taskFamily: string;
  chosenSurfaceId: AppAutomationControlSurfaceId;
  chosenSurfaceLabel: string;
  chosenSurfaceFit: string;
  score: number;
  missingConfirmations: string[];
  missingApprovals: string[];
  userActionBlockers: string[];
  nextSteps: string[];
  sourceRefs: Array<{
    label: string;
    url: string;
  }>;
}

export interface ChatComputerHandoffContext {
  surface: ChatComputerSurfaceKind;
  surfaceLabel: string;
  adapterLabel: string;
  routeLabel: string;
  recoveryLabel: string;
  touched: string[];
  metadata: ChatComputerHandoffMetadata;
  chatLines: string[];
}

/**
 * Per-string bound for anything persisted into handoff metadata. This is the
 * persistence boundary into chat message rows, so it MUST fail closed on
 * oversized/secret-bearing input rather than trust the caller: grounding /
 * preflight summaries and warning items are derived from app observations
 * (untrusted per CLAUDE.md) and are stored verbatim otherwise. Diagnostic
 * summaries get a slightly longer cap than one-line approval/grant notices.
 */
const HANDOFF_TEXT_MAX = 600;
const HANDOFF_LINE_MAX = 240;

function boundedText(value: string | null | undefined, max = HANDOFF_TEXT_MAX): string | null {
  const text = String(value || '').replace(/\r/g, '').trim();
  return text ? text.slice(0, max) : null;
}

function compactList(values: Array<string | null | undefined>, max = 3, itemMax = HANDOFF_LINE_MAX): string[] {
  return Array.from(new Set(
    values.map((value) => String(value || '').trim().slice(0, itemMax)).filter(Boolean),
  )).slice(0, max);
}

function boundedVerificationDimension(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 100_000 ? number : null;
}

function buildVerificationTarget(
  input: ChatComputerHandoffContextInput,
  designAppTask: ChatDesignAppTaskSummary | null,
  appRouteDecision: ChatComputerAppRouteDecisionSummary | null,
  attachedFiles: ReturnType<typeof parseDesktopAttachmentTaskFiles>,
): ChatComputerVerificationTarget | null {
  if (input.replayPolicy !== 'manual_verify_only' || input.mutationDispatched !== true) return null;
  const supplied = input.verificationTarget || {};
  const onlyFile = attachedFiles.length === 1 ? attachedFiles[0] : null;
  const appName = boundedText(
    supplied.appName || designAppTask?.appName || appRouteDecision?.targetName || null,
    160,
  );
  const browserIdentity = supplied.browserIdentity
    && boundedText(supplied.browserIdentity.browserProcessId, 160)
    && boundedText(supplied.browserIdentity.browserContextId, 160)
    && boundedText(supplied.browserIdentity.pageId, 160)
    && /^uc_browser_url_[a-f0-9]{64}$/.test(String(supplied.browserIdentity.url || ''))
    ? {
        browserProcessId: boundedText(supplied.browserIdentity.browserProcessId, 160)!,
        browserContextId: boundedText(supplied.browserIdentity.browserContextId, 160)!,
        pageId: boundedText(supplied.browserIdentity.pageId, 160)!,
        url: supplied.browserIdentity.url,
      }
    : null;
  const expectedDocumentName = boundedText(
    supplied.expectedDocumentName
      || (designAppTask?.appId === 'adobe_photoshop' && onlyFile ? onlyFile.name : null),
    240,
  );
  const expectedWidthPx = boundedVerificationDimension(supplied.expectedWidthPx);
  const expectedHeightPx = boundedVerificationDimension(supplied.expectedHeightPx);
  const dimensionsArePaired = expectedWidthPx != null && expectedHeightPx != null;
  const filePath = boundedText(supplied.filePath || onlyFile?.localPath || null, 4_096);
  const target: ChatComputerVerificationTarget = {
    appName,
    browserIdentity,
    expectedDocumentName,
    expectedWidthPx: dimensionsArePaired ? expectedWidthPx : null,
    expectedHeightPx: dimensionsArePaired ? expectedHeightPx : null,
    filePath,
  };
  return Object.values(target).some((value) => value != null) ? target : null;
}

function summarizeAppAutomationRouteDecision(
  decision: AppAutomationRouteDecision | null | undefined,
): ChatComputerAppRouteDecisionSummary | null {
  if (!decision) return null;
  return {
    status: decision.status,
    targetName: decision.targetName,
    taskFamily: decision.taskFamily,
    chosenSurfaceId: decision.chosenSurface.id,
    chosenSurfaceLabel: decision.chosenSurface.label,
    chosenSurfaceFit: decision.chosenSurface.fit,
    score: decision.score,
    missingConfirmations: decision.missingConfirmations.slice(0, 6),
    missingApprovals: decision.missingApprovals.slice(0, 6),
    userActionBlockers: decision.userActionBlockers.slice(0, 4),
    nextSteps: decision.nextSteps.slice(0, 4),
    sourceRefs: decision.sourceRefs.slice(0, 5).map((ref) => ({
      label: ref.label,
      url: ref.url,
    })),
  };
}

function inferSurface(input: ChatComputerHandoffContextInput): ChatComputerSurfaceKind {
  if (input.entrypoint === 'browser_runtime' || input.adapterId === 'browser_adapter') return 'browser';
  if (input.adapterId === 'file_adapter' || input.taskKind === 'file_task') return 'local_files';
  if (input.task.includes(DESKTOP_ATTACHMENT_TASK_MARKER) || input.adapterId === 'app_adapter' || input.taskKind === 'app_task' || input.taskKind === 'hybrid_task') return 'desktop';
  return 'computer';
}

function adapterLabel(input: ChatComputerHandoffContextInput, surface: ChatComputerSurfaceKind): string {
  if (input.adapterId === 'browser_adapter' || surface === 'browser') return 'Browser computer-use runtime';
  if (input.adapterId === 'file_adapter') return 'Local file adapter';
  if (input.adapterId === 'app_adapter') return 'Desktop app adapter';
  if (input.adapterId === 'hybrid_adapter') return 'Desktop hybrid adapter';
  if (surface === 'desktop') return 'Desktop bridge + OpenSwan runtime';
  if (surface === 'local_files') return 'Local file runtime';
  return 'Shared computer runtime';
}

function surfaceLabel(surface: ChatComputerSurfaceKind): string {
  switch (surface) {
    case 'browser': return 'Browser';
    case 'desktop': return 'Desktop app';
    case 'local_files': return 'Local files';
    default: return 'Computer';
  }
}

function touchedForSurface(surface: ChatComputerSurfaceKind, task: string): string[] {
  const touched = ['surface:computer_use', `computer_task:${task}`];
  if (surface === 'browser') touched.push('surface:browser');
  if (surface === 'desktop') touched.push('surface:desktop_bridge');
  if (surface === 'local_files') touched.push('surface:local_files');
  return touched;
}

export function buildChatComputerHandoffContext(input: ChatComputerHandoffContextInput): ChatComputerHandoffContext {
  const surface = inferSurface(input);
  const attachedFiles = parseDesktopAttachmentTaskFiles(input.task);
  const designPlan = buildDesignAppAutomationPlan(input.task);
  const creativeAiPlan = buildDesignAppCreativeAiPlan(input.task);
  const creativeAiRecipePlan = buildDesignAppCreativeAiRecipePlan(input.task);
  const objectManifestPlan = buildDesignAppObjectManifestPlan(input.task);
  const objectManifestArtifact = summarizeDesignAppObjectManifestArtifact(input.designObjectManifestArtifact);
  const operationRunbookPlan = buildDesignAppOperationRunbookPlan(input.task);
  const engineeringCadRunbookPlan = buildEngineeringCadOperationRunbookPlan(input.task);
  const executionPipelinePlan = buildDesignAppExecutionPipelinePlan(input.task);
  const adapterGapPlan = buildDesignAppAdapterGapPlan(input.task);
  const proofReviewPlan: DesignAppProofReviewPlan | null = buildDesignAppProofReviewPlan(input.task);
  const appRouteDecision = summarizeAppAutomationRouteDecision(input.appAutomationRouteDecision);
  const designAppTask: ChatDesignAppTaskSummary | null = designPlan
    ? {
        appId: designPlan.appId,
        appName: designPlan.appName,
        taskKind: designPlan.taskKind,
        documentSignals: designPlan.documentSignals.slice(0, 5),
        operations: designPlan.operations.slice(0, 7),
        requiredInventory: designPlan.requiredInventory.slice(0, 5),
        approvalGates: designPlan.approvalGates.slice(0, 5),
        verificationSignals: designPlan.verificationSignals.slice(0, 5),
        recommendedTools: designPlan.recommendedTools.slice(0, 12),
        creativeAiCapabilities: designPlan.creativeAiCapabilities?.slice(0, 6),
      }
    : null;
  const stageDirectory = compactList(attachedFiles.map((file) => file.stageDirectory), 1)[0] || null;
  const manifestPath = compactList(attachedFiles.map((file) => file.manifestPath), 1)[0] || null;
  const filesWithHashes = attachedFiles.filter((file) => Boolean(file.sha256));
  const packageSummary = attachedFiles.length > 0
    ? {
        fileCount: attachedFiles.length,
        primaryFileCount: attachedFiles.filter((file) => !/\.(zip|rar|7z|tar|gz|jpg|jpeg|png|gif|webp|heic|bmp|tif|tiff|otf|ttf|woff|woff2)$/i.test(file.name)).length || 1,
        stageDirectory,
        manifestPath,
        sha256Count: filesWithHashes.length,
        files: attachedFiles.slice(0, 10).map((file) => ({
          name: file.name,
          localPath: file.localPath,
          appName: file.appName,
          sha256: file.sha256,
        })),
      }
    : null;
  const verificationTarget = buildVerificationTarget(
    input,
    designAppTask,
    appRouteDecision,
    attachedFiles,
  );
  const verificationBridgeInstanceId = input.replayPolicy === 'manual_verify_only'
    && input.mutationDispatched === true
    ? boundedText(input.verificationBridgeInstanceId, 128)
    : null;
  const warnings = compactList(input.warnings || [], 4);
  const rawWarnings = compactList(input.rawWarnings || input.warnings || [], 8);
  const blockers = compactList(input.blockers || [], 4);
  const standingGrant = input.stickyScopeApplied?.scopeId && input.stickyScopeApplied.scopeKey
    ? {
        scopeId: String(input.stickyScopeApplied.scopeId).slice(0, 80),
        scopeKey: String(input.stickyScopeApplied.scopeKey).slice(0, 120),
        notice: formatStickyScopeAppliedNotice({ scopeKey: String(input.stickyScopeApplied.scopeKey).slice(0, 120) }).slice(0, 240),
      }
    : null;
  // Bound the caller-supplied text fields ONCE (grounding/preflight summaries
  // are untrusted app-observation text and were otherwise stored verbatim);
  // both the visible chatLines and the persisted metadata read these.
  const taskLabelText = boundedText(input.taskLabel, HANDOFF_LINE_MAX);
  const preflightStatusText = boundedText(input.preflightStatus, HANDOFF_LINE_MAX);
  const preflightSummaryText = boundedText(input.preflightSummary);
  const groundingStatusText = boundedText(input.groundingStatus, HANDOFF_LINE_MAX);
  const groundingSummaryText = boundedText(input.groundingSummary);
  const grantSummaryText = boundedText(input.grantSummary, HANDOFF_LINE_MAX);
  const approvalSummaryText = boundedText(input.approvalSummary, HANDOFF_LINE_MAX);
  const chatLines = [
    `- Surface: ${surfaceLabel(surface)} via ${adapterLabel(input, surface)}`,
    taskLabelText ? `- Task: ${taskLabelText}` : null,
    designAppTask ? `- Design app: ${designAppTask.appName}` : null,
    designAppTask ? `- Design operations: ${designAppTask.operations.join(', ')}` : null,
    executionPipelinePlan ? `- Design pipeline: ${executionPipelinePlan.phases.map((phase) => phase.label).join(' -> ')}` : null,
    creativeAiPlan?.capabilities.length ? `- Creative AI: ${creativeAiPlan.capabilities.map((capability) => capability.label).join(', ')}` : null,
    creativeAiRecipePlan?.recipes.length ? `- Creative AI recipes: ${creativeAiRecipePlan.recipes.map((recipe) => recipe.label).join(', ')}` : null,
    adapterGapPlan?.gaps.length ? `- Hidden adapter gaps: ${adapterGapPlan.gaps.map((gap) => gap.operation).join(', ')}` : null,
    engineeringCadRunbookPlan ? `- CAD runbooks: ${engineeringCadRunbookPlan.operations.join(', ')}` : null,
    designAppTask ? `- Design proof: ${designAppTask.verificationSignals.slice(0, 2).join('; ')}` : null,
    input.browserPlanId ? `- Browser plan: ${input.browserPlanId}${Number.isFinite(input.browserActionCount || NaN) ? ` (${input.browserActionCount} actions)` : ''}` : null,
    packageSummary?.manifestPath ? `- Package manifest: ${packageSummary.manifestPath}` : null,
    packageSummary ? `- Package files: ${packageSummary.fileCount}${packageSummary.sha256Count ? ` (${packageSummary.sha256Count} hashed)` : ''}` : null,
    preflightStatusText ? `- Preflight: ${preflightStatusText}` : null,
    appRouteDecision ? `- App route decision: ${appRouteDecision.status} via ${appRouteDecision.chosenSurfaceLabel} for ${appRouteDecision.taskFamily}` : null,
    groundingStatusText ? `- Grounding: ${groundingStatusText}` : null,
    input.outcomeStatus ? `- Outcome: ${input.outcomeStatus.replace(/_/g, ' ')}` : null,
    input.replayPolicy === 'manual_verify_only' ? '- Replay: blocked; read-only verification only' : null,
    approvalSummaryText ? `- Approval: ${approvalSummaryText}` : null,
    standingGrant ? `- Standing grant: ${standingGrant.scopeKey}` : null,
    warnings.length ? `- Warnings: ${warnings.join('; ')}` : null,
    blockers.length ? `- Blockers: ${blockers.join('; ')}` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    surface,
    surfaceLabel: surfaceLabel(surface),
    adapterLabel: adapterLabel(input, surface),
    routeLabel: `${surfaceLabel(surface)} -> ${adapterLabel(input, surface)}`,
    recoveryLabel: surface === 'browser'
      ? 'Recover through browser plan/session state and approval history.'
      : surface === 'desktop'
        ? 'Recover through desktop bridge state, package manifest, app observations, and local run logs.'
        : 'Recover through local file/task state and exact path access.',
    touched: Array.from(new Set([
      ...touchedForSurface(surface, input.task),
      ...(designAppTask ? ['surface:design_app', `app:${designAppTask.appId}`] : []),
    ])),
    metadata: {
      surface,
      entrypoint: input.entrypoint || null,
      adapterId: input.adapterId || null,
      taskKind: input.taskKind || null,
      taskLabel: taskLabelText,
      capabilityProfile: input.capabilityProfile || null,
      recommendedMode: input.recommendedMode || null,
      browserPlanId: input.browserPlanId || null,
      browserActionCount: input.browserActionCount ?? null,
      runId: input.runId || null,
      outcomeStatus: input.outcomeStatus || null,
      replayPolicy: input.replayPolicy || 'normal',
      mutationDispatched: input.mutationDispatched === true,
      verificationOnlyTools: compactList(input.verificationOnlyTools || [], 4),
      verificationBridgeInstanceId,
      verificationTarget,
      preflightStatus: preflightStatusText,
      preflightSummary: preflightSummaryText,
      groundingStatus: groundingStatusText,
      groundingSummary: groundingSummaryText,
      warningCount: warnings.length,
      blockerCount: blockers.length,
      warnings,
      rawWarnings,
      blockers,
      grantSummary: grantSummaryText,
      approvalSummary: approvalSummaryText,
      desktopAttachmentPackage: packageSummary,
      designAppTask,
      designCreativeAi: creativeAiPlan
        ? {
            capabilities: creativeAiPlan.capabilities.slice(0, 6).map((capability) => ({
              id: capability.id,
              label: capability.label,
              creativeOutcome: capability.creativeOutcome,
              controlSurface: capability.controlSurface,
              gapTool: capability.gapTool,
              buildoutTrigger: capability.buildoutTrigger,
            })),
            recipes: (creativeAiRecipePlan?.recipes || []).slice(0, 6).map((recipe) => ({
              id: recipe.id,
              capabilityId: recipe.capabilityId,
              label: recipe.label,
              userVisibleSummary: recipe.userVisibleSummary,
              approvalSummary: recipe.approvalSummary,
              verificationSummary: recipe.verificationSummary,
              buildoutTool: recipe.buildoutTool,
              recoveryHint: recipe.recoveryHint,
            })),
            userVisibleOptions: (creativeAiRecipePlan?.userVisibleOptions || []).slice(0, 6),
            creativeBriefSignals: creativeAiPlan.creativeBriefSignals.slice(0, 6),
            approvalGates: creativeAiPlan.approvalGates.slice(0, 6),
            verificationSignals: creativeAiPlan.verificationSignals.slice(0, 6),
            buildoutTools: (creativeAiRecipePlan?.buildoutTools || []).slice(0, 6),
            recoveryHints: (creativeAiRecipePlan?.recoveryHints || []).slice(0, 6),
            failClosedRules: creativeAiPlan.failClosedRules.slice(0, 6),
            sourceRefs: creativeAiPlan.sourceRefs.slice(0, 6).map((ref) => `${ref.label}: ${ref.url}`),
          }
        : null,
      designOperationRunbooks: operationRunbookPlan
        ? operationRunbookPlan.runbooks.slice(0, 6).map((runbook) => ({
            operation: runbook.operation,
            label: runbook.label,
            risk: runbook.risk,
            controlSurface: runbook.controlSurface,
            requiredInputs: runbook.requiredInputs.slice(0, 5),
            approvalBefore: runbook.approvalBefore.slice(0, 5),
            successCriteria: runbook.successCriteria.slice(0, 5),
            failClosedConditions: runbook.failClosedConditions.slice(0, 5),
          }))
        : null,
      engineeringCadOperationRunbooks: engineeringCadRunbookPlan
        ? engineeringCadRunbookPlan.runbooks.slice(0, 6).map((runbook) => ({
            operation: runbook.operation,
            label: runbook.label,
            risk: runbook.risk,
            controlSurface: runbook.controlSurface,
            requiredInputs: runbook.requiredInputs.slice(0, 5),
            approvalBefore: runbook.approvalBefore.slice(0, 5),
            successCriteria: runbook.successCriteria.slice(0, 5),
            failClosedConditions: runbook.failClosedConditions.slice(0, 5),
          }))
        : null,
      designExecutionPipeline: executionPipelinePlan
        ? {
            quietUserSummary: executionPipelinePlan.quietUserSummary,
            nextVisibleAction: executionPipelinePlan.nextVisibleAction,
            requiredToolSequence: executionPipelinePlan.requiredToolSequence.slice(0, 18),
            approvalTools: executionPipelinePlan.approvalTools.slice(0, 8),
            mutationTools: executionPipelinePlan.mutationTools.slice(0, 12),
            proofTools: executionPipelinePlan.proofTools.slice(0, 12),
            buildoutTools: executionPipelinePlan.buildoutTools.slice(0, 12),
            creativeAiRecipeIds: executionPipelinePlan.creativeAiRecipeIds.slice(0, 8),
            adapterGapOperations: executionPipelinePlan.adapterGapOperations.slice(0, 8),
            failClosedRules: executionPipelinePlan.failClosedRules.slice(0, 8),
            phases: executionPipelinePlan.phases.slice(0, 8).map((phase) => ({
              id: phase.id,
              label: phase.label,
              operations: phase.operations.slice(0, 6),
              tools: phase.tools.slice(0, 10),
              approvalRequired: phase.approvalRequired,
              userVisibleWhen: phase.userVisibleWhen,
              requiredEvidence: phase.requiredEvidence.slice(0, 6),
              recoveryAction: phase.recoveryAction,
            })),
          }
        : null,
      designAdapterGaps: adapterGapPlan
        ? adapterGapPlan.gaps.slice(0, 6).map((gap) => ({
            operation: gap.operation,
            adapterId: gap.adapterId,
            controlSurface: gap.controlSurface,
            missingBridgeTools: gap.missingBridgeTools.slice(0, 4),
            requiredBridgeToolsBeforeRetry: gap.requiredBridgeToolsBeforeRetry.slice(0, 6),
            requiredEvidence: gap.requiredEvidence.slice(0, 5),
            focusedSmokeCases: gap.focusedSmokeCases.slice(0, 5),
            failClosedRules: gap.failClosedRules.slice(0, 5),
          }))
        : null,
      designObjectManifest: objectManifestPlan
        ? {
            schemaVersion: objectManifestPlan.schemaVersion,
            artifactKind: objectManifestPlan.manifestArtifactKind,
            beforeSnapshotTools: objectManifestPlan.beforeSnapshotTools.slice(0, 8),
            afterSnapshotTools: objectManifestPlan.afterSnapshotTools.slice(0, 8),
            entityKinds: objectManifestPlan.entities.map((entity) => entity.kind).slice(0, 10),
            comparisons: objectManifestPlan.comparisons.slice(0, 8),
            approvalEvidence: objectManifestPlan.approvalEvidence.slice(0, 8),
            failClosedConditions: objectManifestPlan.failClosedConditions.slice(0, 6),
            redactionRules: objectManifestPlan.redactionRules.slice(0, 4),
          }
        : null,
      designObjectManifestArtifact: objectManifestArtifact,
      requestNotice: input.requestNotice || null,
      evidenceContract: input.evidenceContract || null,
      appRouteDecision,
      standingGrant,
      designProofReview: proofReviewPlan
        ? {
            reviewTitle: proofReviewPlan.reviewTitle,
            userVisibleSummary: proofReviewPlan.userVisibleSummary,
            checklist: proofReviewPlan.checklist.slice(0, 5),
            requiredEvidence: proofReviewPlan.requiredEvidence.slice(0, 6),
            approvalBefore: proofReviewPlan.approvalBefore.slice(0, 6),
            passCriteria: proofReviewPlan.passCriteria.slice(0, 5),
            failClosedConditions: proofReviewPlan.failClosedConditions.slice(0, 5),
            artifactKinds: proofReviewPlan.artifactKinds.slice(0, 6),
          }
        : null,
    },
    chatLines,
  };
}

export type ChatComputerHandoffVisibility = 'auto' | 'approval' | 'problem' | 'debug' | 'hidden';

export interface FormatChatComputerHandoffOptions {
  visibility?: ChatComputerHandoffVisibility;
  includeTechnicalPaths?: boolean;
}

function problemLines(context: ChatComputerHandoffContext, includeTechnicalPaths: boolean): string[] {
  const design = context.metadata.designAppTask;
  const routeDecision = context.metadata.appRouteDecision;
  const lines = [
    `- ${context.surfaceLabel}: ${context.adapterLabel}`,
    design ? `- ${design.appName}: ${design.operations.slice(0, 4).join(', ')}` : null,
    routeDecision && routeDecision.status !== 'ready_to_execute'
      ? `- Route: ${routeDecision.status.replace(/_/g, ' ')} via ${routeDecision.chosenSurfaceLabel} for ${routeDecision.taskFamily}.`
      : null,
    ...context.metadata.blockers.map((blocker) => `- Blocked by: ${blocker}`),
    ...context.metadata.warnings.map((warning) => `- Note: ${warning}`),
  ].filter((line): line is string => Boolean(line));
  if (context.metadata.preflightSummary && context.metadata.blockerCount > 0) {
    lines.push(`- Preflight: ${context.metadata.preflightSummary}`);
  }
  const pkg = context.metadata.desktopAttachmentPackage;
  if (pkg && includeTechnicalPaths && pkg.manifestPath) {
    lines.push(`- Uploaded package manifest: ${pkg.manifestPath}`);
  } else if (pkg && context.metadata.blockerCount > 0) {
    lines.push(`- Uploaded package is preserved for retry/recovery (${pkg.fileCount} files${pkg.sha256Count ? `, ${pkg.sha256Count} hashed` : ''}).`);
  }
  return lines.slice(0, 8);
}

function approvalLines(context: ChatComputerHandoffContext): string[] {
  const standingGrantLine = context.metadata.standingGrant
    ? `- ${context.metadata.standingGrant.notice}`
    : null;
  const notice = context.metadata.requestNotice;
  if (notice?.visibility === 'user' && notice.tone !== 'attention') {
    const formatted = formatChatComputerRequestUserNotice(notice);
    const noticeLines = formatted
      .split('\n')
      .filter((line) => line.trim() && !/^\*\*[^*]+\*\*$/.test(line.trim()))
      .slice(0, 5);
    return standingGrantLine ? [...noticeLines, standingGrantLine].slice(0, 6) : noticeLines;
  }
  const design = context.metadata.designAppTask;
  const lines = [
    `- ${context.surfaceLabel}: ready for review.`,
  ];
  if (design) {
    lines.push(`- ${design.appName}: ${design.operations.slice(0, 4).join(', ')}.`);
    lines.push(design.appId === 'adobe_photoshop'
      ? '- First proof path: document status, layer inventory, selection/mask state, then raster proof after changes.'
      : '- First proof path: document status, text inventory, then visible proof after changes.');
  }
  if (context.metadata.browserPlanId) {
    lines.push(`- Browser plan staged${Number.isFinite(context.metadata.browserActionCount || NaN) ? ` (${context.metadata.browserActionCount} actions)` : ''}.`);
  }
  if (context.metadata.approvalSummary) {
    lines.push(`- ${context.metadata.approvalSummary}`);
  }
  if (standingGrantLine) {
    lines.push(standingGrantLine);
  }
  return lines.slice(0, 6);
}

export function formatChatComputerHandoffForMessage(
  context: ChatComputerHandoffContext,
  options: FormatChatComputerHandoffOptions = {},
): string {
  const visibility = options.visibility || 'auto';
  if (visibility === 'hidden') return '';
  if (visibility === 'debug') {
    if (context.chatLines.length === 0) return '';
    return `\n\n**Execution details**\n${context.chatLines.join('\n')}`;
  }

  // Only real BLOCKERS (things the user must act on) trigger the verbose
  // "Needs attention" block. WARNINGS are internal agent guidance — research
  // surface order, "inventory required" reminders, preflight notes — which
  // belong in metadata, not the chat bubble (user feedback: "too much info").
  // A warning-only task with an approval/notice falls through to the terse
  // "Ready for review", or stays hidden.
  const resolvedVisibility = visibility === 'auto'
    ? context.metadata.blockerCount > 0
      ? 'problem'
      : context.metadata.requestNotice?.visibility === 'user' || context.metadata.approvalSummary || context.metadata.browserPlanId
        ? 'approval'
        : 'hidden'
    : visibility;

  if (resolvedVisibility === 'hidden') return '';
  if (resolvedVisibility === 'approval') {
    const lines = approvalLines(context);
    return lines.length ? `\n\n**Ready for review**\n${lines.join('\n')}` : '';
  }

  const lines = problemLines(context, Boolean(options.includeTechnicalPaths));
  return lines.length ? `\n\n**Needs attention**\n${lines.join('\n')}` : '';
}

// ─── Model substitution visibility (2.5) ────────────────────────────────────
//
// The native screenshot/action computer-use loop requires a Sonnet-class
// model, so `supabase/functions/computer-use-agent/index.ts` pins
// `claude-sonnet-4-6` when the requested model can't drive it (that pin —
// `resolveComputerUseModel` — is the owner and stays unchanged). These
// helpers make that substitution VISIBLE instead of silent: a deterministic
// client-side mirror of the edge coercion (the edge also emits a typed
// `model_resolved` SSE event with the same shape) plus the one compact
// user-facing notice line. Text-only planner/validator steps always keep the
// user's selected model — only the native loop pins Sonnet.

/** The Sonnet model the native computer-use loop pins when the requested
 *  model cannot drive it. Keep in lockstep with DEFAULT_AGENT_MODEL in
 *  supabase/functions/computer-use-agent/index.ts. */
export const COMPUTER_USE_PINNED_LOOP_MODEL = 'claude-sonnet-4-6';

/** Matches the `model_resolved` SSE event payload from the edge loop
 *  (plus the derived `substituted` convenience flag). */
export interface ComputerTaskModelResolution {
  /** The model the user/caller asked for ('' when none was requested). */
  requestedModel: string;
  /** The model the native screenshot/action loop actually runs on. */
  resolvedModel: string;
  /** True only when a requested model was swapped for the Sonnet pin. */
  substituted: boolean;
  reason: 'computer_use_requires_sonnet' | null;
}

/**
 * Deterministic mirror of the edge loop's model coercion. Capability flags
 * own the decision (unknown ids fail closed to computerUse:false → pin);
 * the sonnet-family regex is exact parity with the edge's
 * `resolveComputerUseModel`, so legacy sonnet ids the flags table does not
 * list never produce a false substitution notice. No requested model is a
 * plain default, not a substitution.
 */
export function resolveComputerTaskLoopModel(model?: string | null): ComputerTaskModelResolution {
  const requestedModel = String(model || '').trim();
  if (!requestedModel) {
    return {
      requestedModel: '',
      resolvedModel: COMPUTER_USE_PINNED_LOOP_MODEL,
      substituted: false,
      reason: null,
    };
  }
  const normalized = requestedModel.startsWith('anthropic/')
    ? requestedModel.slice('anthropic/'.length)
    : requestedModel;
  const canDriveNativeLoop = getModelCapabilityFlags(requestedModel).computerUse
    || /^claude-.*sonnet/i.test(normalized);
  if (canDriveNativeLoop) {
    return { requestedModel, resolvedModel: normalized, substituted: false, reason: null };
  }
  return {
    requestedModel,
    resolvedModel: COMPUTER_USE_PINNED_LOOP_MODEL,
    substituted: true,
    reason: 'computer_use_requires_sonnet',
  };
}

/** Bounded display name for a model id: provider prefixes stripped, short. */
function shortModelName(modelId: string): string {
  const normalized = normalizeModelId(modelId) || String(modelId || '').trim().toLowerCase();
  return (normalized || 'default model').slice(0, 48);
}

/**
 * The one compact user-facing line for a model substitution. Empty string
 * when nothing was substituted (computer-use-capable models never get a
 * notice), so callers can `filter(Boolean)` it into existing notice lists.
 * Phase 2b wording: says WHY the swap happened and that the user's pick
 * still participates — the terse "(X plans/verifies)" read as a bug.
 */
export function formatComputerTaskModelResolutionNotice(
  resolution: Pick<ComputerTaskModelResolution, 'requestedModel' | 'resolvedModel' | 'substituted'>,
): string {
  if (!resolution.substituted) return '';
  return `Screen loop needs computer-use, so it runs on ${shortModelName(resolution.resolvedModel)}; your pick (${shortModelName(resolution.requestedModel)}) still plans and verifies.`;
}
