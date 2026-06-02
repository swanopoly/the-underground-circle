import type { ChatCommandRouteId } from './chatCommandRegistry';
import { classifyBrowserbaseWorkflow } from './browserbaseWorkflowIntent';
import { buildAgentRunLedgerPreview, type AgentRunLedgerPreview } from './agentRunLedger';
import {
  buildComputerAppTaskStrategy,
  type ComputerAppStrategyId,
  type ComputerAppTaskStrategy,
} from './computerAppTaskStrategy';
import {
  isLowRiskLocalImageExportTask,
  planComputerTaskPreview,
  type ComputerTaskPlanPreview,
} from './computerTaskPlanner';
import {
  buildDesignAppExecutionPipelinePlan,
  type DesignAppExecutionPipelinePlan,
} from './designAppExecutionPipeline';
import {
  buildComputerTaskEvidenceContract,
  formatComputerTaskEvidenceContractPromptBlock,
  type ComputerTaskEvidenceContract,
} from './computerTaskEvidenceContract';
import { formatChatComputerTaskAutonomyPromptBlock } from './chatComputerTaskAutonomy';
import {
  buildAppAutomationRouteDecision,
  formatAppAutomationRouteDecisionPromptBlock,
  type AppAutomationRouteDecision,
} from './appAutomationControlSurfaces';
import { buildExecutionSurfacePlan, type ExecutionSurfacePlan } from './executionSurfaceRouter';
import {
  buildUserTaskPipelineDecision,
  getBestUserTaskPipeline,
  summarizeUserTaskPipelineMatch,
  type UserTaskPipelineDecision,
  type UserTaskPipelineId,
  type UserTaskPipelineRisk,
  type UserTaskPipelineSummary,
} from './userTaskPipelines';

export type ChatComputerRequestRouteKind =
  | 'browser'
  | 'desktop_app'
  | 'local_file'
  | 'hybrid'
  | 'agent_buildout';

export interface ChatComputerRequestRoute {
  kind: ChatComputerRequestRouteKind;
  executionKind: 'run_computer_task';
  routeId: ChatCommandRouteId | null;
  risk: UserTaskPipelineRisk;
  approvalRequired: boolean;
  approvalReason: string | null;
  confidence: number;
  bestPath: string;
  selectedPipeline: UserTaskPipelineSummary | null;
  pipelineDecision: UserTaskPipelineDecision | null;
  surfacePlan: ExecutionSurfacePlan | null;
  ledgerPreview: AgentRunLedgerPreview | null;
  computerPreview: ComputerTaskPlanPreview;
  appStrategy: ComputerAppTaskStrategy | null;
  appAutomationRouteDecision: AppAutomationRouteDecision | null;
  designExecutionPipeline: DesignAppExecutionPipelinePlan | null;
  fallbackPipelineIds: UserTaskPipelineId[];
  recommendedTools: string[];
  completionProof: string[];
  evidenceContract?: ComputerTaskEvidenceContract | null;
  notes: string[];
}

const BROWSER_STRATEGIES = new Set<ComputerAppStrategyId>([
  'browser_semantic',
  'credentialed_browser',
  'approval_sensitive_browser',
  'browser_file_transfer',
  'human_verification_pause',
]);

const APP_STRATEGIES = new Set<ComputerAppStrategyId>([
  'desktop_readonly',
  'desktop_semantic',
  'productivity_app_control',
  'desktop_canvas_vision',
  'creative_layout_control',
  'adobe_cc_control',
  'engineering_cad_control',
  'universal_app_control',
  'terminal_agent_orchestration',
]);

const FILE_STRATEGIES = new Set<ComputerAppStrategyId>([
  'file_readonly',
  'document_data_workbench',
]);

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function riskWeight(risk: UserTaskPipelineRisk): number {
  switch (risk) {
    case 'destructive':
      return 3;
    case 'external_side_effect':
      return 2;
    case 'review':
      return 1;
    case 'safe':
    default:
      return 0;
  }
}

function maxRisk(...risks: Array<UserTaskPipelineRisk | null | undefined>): UserTaskPipelineRisk {
  return risks.reduce<UserTaskPipelineRisk>((max, risk) => (
    risk && riskWeight(risk) > riskWeight(max) ? risk : max
  ), 'safe');
}

function hasExternalSideEffectIntent(message: string): boolean {
  return /\b(publish|go live|send|invite|post|upload|import|checkout|pay|purchase|buy|book|reserve|charge|refund|delete|remove|cancel)\b/i.test(message);
}

function hasDestructiveIntent(message: string): boolean {
  return /\b(permanently delete|delete forever|erase|wipe|drop table|destroy|overwrite source|replace original)\b/i.test(message);
}

function hasMutationIntent(message: string): boolean {
  return /\b(open|launch|focus|click|type|paste|press|select|choose|fill|set|create|make|build|edit|update|change|replace|resize|crop|retouch|draw|design|generate|export|save|package|render|encode|upload|download|import|send|publish|submit|delete|remove|move|copy|rename)\b/i.test(message);
}

function hasExplicitApprovalIntent(message: string): boolean {
  return /\b(after i approve|after approval|with approval|ask me before|once i approve|before you (?:send|submit|publish|save|export|delete|overwrite|run)|require approval)\b/i.test(message);
}

function isPureCreativeGeneration(message: string): boolean {
  const text = String(message || '');
  if (!/\b(generate|create|make|draw|design)\b[\s\S]{0,120}\b(image|picture|photo|illustration|artwork|logo|icon|banner|mockup)\b/i.test(text)) {
    return false;
  }
  return !/\b(photoshop|indesign|illustrator|figma|canva|lightroom|premiere|after effects|acrobat|creative cloud|desktop|computer|app|application|file|folder|downloads?|documents?|open|launch|use|click|type|press|save|export|edit|update|replace|crop|retouch|mask|layers?|\.psd\b|\.psb\b|\.indd\b|\.idml\b)\b/i.test(text);
}

function isPlainBuildDiscoveryRequest(message: string): boolean {
  if (!/\b(build|landing page|website|site|web app|page)\b/i.test(message)) return false;
  return !/\b(browser|desktop|computer|app|application|window|file|folder|shopify|wordpress|webflow|wix|squarespace|open|launch|click|type|press|fill|upload|download|export|use computer)\b/i.test(message);
}

function isSimpleWordpressConversationalIntent(message: string, pipeline?: UserTaskPipelineSummary | null): boolean {
  if (pipeline?.id !== 'wordpress_cms' && !/\b(wordpress|wp|blog)\b/i.test(message)) return false;
  if (!/\b(post|publish|schedule|draft|list|show)\b/i.test(message)) return false;
  return !/\b(admin|log ?in|sign ?in|media library|upload|attach|download|export|desktop|file|image|product page|theme|dashboard|open|browser|use computer)\b/i.test(message);
}

function isWorkflowRecordingRequest(message: string): boolean {
  return /\b(record workflow|workflow recording|record and replay|replay workflow|saved workflow|automation template|macro|turn (?:this|these) .* into automation)\b/i.test(message)
    || /\b(record|capture|save)\b[\s\S]{0,120}\b(steps|workflow|process|routine|browser flow|desktop flow)\b/i.test(message)
    || /\b(replay|rerun|repeat|reuse)\b[\s\S]{0,120}\b(workflow|steps|process|task|routine|flow)\b/i.test(message);
}

function explicitComputerSurfaceRequested(
  message: string,
  preview: ComputerTaskPlanPreview,
  strategy: ComputerAppTaskStrategy | null,
  designPipeline: DesignAppExecutionPipelinePlan | null,
): boolean {
  if (preview.kind !== 'unknown') return true;
  if (classifyBrowserbaseWorkflow(message).kind !== 'general_browser') return true;
  if (designPipeline) return true;
  if (!strategy) return false;
  return /\b(use|open|launch|focus|control|drive|automate|take over|click|type|paste|press|select|choose|fill|set|create|make|build|edit|update|change|replace|export|save|render|encode|package)\b[\s\S]{0,160}\b(app|application|desktop|computer|browser|website|site|page|window|file|folder|photoshop|indesign|illustrator|figma|canva|autocad|solidworks|fusion\s*360|ableton|slack|notion|mail|calendar|shopify|webflow|wix|wordpress)\b/i.test(message)
    || /\b(?:in|inside|on|with|using)\s+(?:the\s+)?(?:[A-Za-z][A-Za-z0-9._+-]{1,40}(?:\s+[A-Za-z0-9][A-Za-z0-9._+-]{1,40}){0,4})\s+(?:app|application|window|program)\b/i.test(message);
}

function resolveKind(
  preview: ComputerTaskPlanPreview,
  strategy: ComputerAppTaskStrategy | null,
  designPipeline: DesignAppExecutionPipelinePlan | null,
): ChatComputerRequestRouteKind {
  if (strategy?.id === 'agent_asset_acquisition') return 'agent_buildout';
  if (designPipeline || (strategy && APP_STRATEGIES.has(strategy.id))) return 'desktop_app';
  if (strategy && BROWSER_STRATEGIES.has(strategy.id)) return 'browser';
  if (strategy && FILE_STRATEGIES.has(strategy.id)) return 'local_file';
  if (preview.kind === 'hybrid_task') return 'hybrid';
  if (preview.kind === 'app_task') return 'desktop_app';
  if (preview.kind === 'file_task') return 'local_file';
  if (preview.kind === 'browser_task') return 'browser';
  return 'hybrid';
}

function syntheticPipelineIdForRoute(
  kind: ChatComputerRequestRouteKind,
  strategy: ComputerAppTaskStrategy | null,
): UserTaskPipelineId {
  if (strategy?.id === 'human_verification_pause') return 'human_verification';
  if (strategy?.id === 'browser_file_transfer') return 'data_import_export';
  if (strategy?.id === 'credentialed_browser' || strategy?.id === 'approval_sensitive_browser') return 'website_platform_admin';
  if (strategy?.id === 'terminal_agent_orchestration') return 'terminal_agents';
  if (strategy?.id === 'creative_layout_control') return 'creative_layout_design';
  if (strategy?.id === 'adobe_cc_control') return 'adobe_creative_cloud';
  if (strategy?.id === 'agent_asset_acquisition') return 'desktop_app_control';
  if (kind === 'browser') return 'browser_navigation';
  if (kind === 'local_file') return 'local_files';
  return 'desktop_app_control';
}

function synthesizePipelineSummary(
  kind: ChatComputerRequestRouteKind,
  strategy: ComputerAppTaskStrategy | null,
  preview: ComputerTaskPlanPreview,
  risk: UserTaskPipelineRisk,
  confidence: number,
): UserTaskPipelineSummary {
  const id = syntheticPipelineIdForRoute(kind, strategy);
  const routeId: ChatCommandRouteId | null = kind === 'browser' || kind === 'hybrid' || strategy?.id === 'browser_file_transfer'
    ? 'browser'
    : null;
  const fallbackTools = kind === 'local_file'
    ? ['desktop.file_search', 'desktop.file_stat', 'desktop.file_read']
    : preview.requiredCapabilities.map((item) => `capability.${item}`);
  return {
    id,
    title: displayStrategyTargetLabel(strategy) || preview.label || 'Computer/App Request',
    category: kind === 'browser' ? 'browser' : kind === 'local_file' ? 'desktop' : 'desktop',
    routeId,
    executionKind: 'run_computer_task',
    risk,
    confidence: Number(confidence.toFixed(2)),
    recommendedTools: (strategy?.recommendedTools || fallbackTools).slice(0, 8),
    executionRequirements: (strategy?.bridgeRequirements || []).slice(0, 8),
    solutionSteps: (strategy?.actionOrder || [preview.detail]).slice(0, 8),
    completionCriteria: strategy?.stopConditions?.length
      ? [strategy.stopConditions[0]]
      : [preview.detail || 'Requested computer/app state is completed or an exact blocker is reported.'],
    approvalTriggers: (strategy?.approvalCheckpoints || []).slice(0, 8),
    persistenceTargets: ['computer_task_state', 'run_ledger', 'chat_message'],
  };
}

function shouldPreferLocalFilePreview(
  message: string,
  preview: ComputerTaskPlanPreview,
  strategy: ComputerAppTaskStrategy | null,
): boolean {
  if (preview.kind !== 'file_task') return false;
  if (!strategy || strategy.id === 'file_readonly' || strategy.id === 'document_data_workbench') return false;
  if (strategy.id !== 'approval_sensitive_browser' && strategy.id !== 'credentialed_browser') return false;
  return !/\b(browser|website|webpage|site|shopify|wordpress|wp admin|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|checkout|form|login|log ?in|sign ?in)\b/i.test(message);
}

function displayStrategyTargetLabel(strategy: ComputerAppTaskStrategy | null): string | null {
  if (!strategy?.label) return null;
  if (strategy.id === 'universal_app_control') {
    return strategy.label
      .replace(/\s+Generic App Navigator$/i, '')
      .replace(/\s+And Buildout Loop$/i, '')
      .trim();
  }
  return strategy.label;
}

function resolveRisk(input: {
  message: string;
  kind: ChatComputerRequestRouteKind;
  preview: ComputerTaskPlanPreview;
  selectedPipeline: UserTaskPipelineSummary | null;
  strategy: ComputerAppTaskStrategy | null;
}): UserTaskPipelineRisk {
  if (hasDestructiveIntent(input.message)) return 'destructive';
  if (input.strategy?.id === 'agent_asset_acquisition') return 'review';
  if (
    input.strategy?.id === 'browser_file_transfer' &&
    /\b(download|export|save (?:this )?(?:page|webpage|site|report|csv|pdf)|save as pdf|print to pdf)\b/i.test(input.message) &&
    !/\b(upload|attach|choose file|select file|import|publish|submit|send|checkout|pay|purchase)\b/i.test(input.message)
  ) {
    return 'review';
  }
  if (isLowRiskLocalImageExportTask(input.message)) return 'safe';
  if (hasExternalSideEffectIntent(input.message)) return 'external_side_effect';
  if (input.strategy?.id === 'human_verification_pause') return 'review';
  if (
    input.strategy?.id === 'desktop_readonly' ||
    input.strategy?.id === 'file_readonly' ||
    (!hasMutationIntent(input.message) && (input.preview.kind === 'file_task' || input.preview.kind === 'browser_task'))
  ) {
    return maxRisk(input.selectedPipeline?.risk, 'safe');
  }
  if (input.kind === 'desktop_app' || input.kind === 'hybrid' || input.preview.kind === 'app_task') {
    return maxRisk(input.selectedPipeline?.risk, 'review');
  }
  if (hasMutationIntent(input.message)) return maxRisk(input.selectedPipeline?.risk, 'review');
  return maxRisk(input.selectedPipeline?.risk, 'safe');
}

function buildApproval(input: {
  message: string;
  risk: UserTaskPipelineRisk;
  kind: ChatComputerRequestRouteKind;
  strategy: ComputerAppTaskStrategy | null;
}): { required: boolean; reason: string | null } {
  if (input.risk === 'destructive') {
    return { required: true, reason: 'The request includes destructive computer/app actions.' };
  }
  if (input.risk === 'external_side_effect') {
    return { required: true, reason: 'The selected computer/browser path can affect external systems or user files.' };
  }
  if (hasExplicitApprovalIntent(input.message)) {
    return { required: true, reason: 'The user explicitly requested approval before execution.' };
  }
  if (isLowRiskLocalImageExportTask(input.message)) {
    return { required: false, reason: null };
  }
  if (input.strategy?.id === 'agent_asset_acquisition' || input.kind === 'agent_buildout') {
    return { required: true, reason: 'Connected-agent asset acquisition can download, generate, install, or write local files.' };
  }
  if (input.risk === 'review' && (input.kind === 'desktop_app' || input.kind === 'hybrid')) {
    return { required: true, reason: input.strategy?.approvalCheckpoints[0] || 'Desktop/app control requires user-visible approval before mutation.' };
  }
  return { required: false, reason: null };
}

function buildBestPath(input: {
  kind: ChatComputerRequestRouteKind;
  preview: ComputerTaskPlanPreview;
  strategy: ComputerAppTaskStrategy | null;
  designPipeline: DesignAppExecutionPipelinePlan | null;
  pipeline: UserTaskPipelineSummary | null;
}): string {
  const target = input.designPipeline
    ? `${input.designPipeline.appName} ordered design pipeline`
    : displayStrategyTargetLabel(input.strategy) || input.preview.label;
  const surface = input.kind.replace(/_/g, ' ');
  const pipeline = input.pipeline && input.pipeline.title !== target ? ` via ${input.pipeline.title}` : '';
  return `${surface}: ${target}${pipeline}`;
}

export function buildChatComputerRequestRoute(
  message: string,
  opts: { pipelineDecision?: UserTaskPipelineDecision | null } = {},
): ChatComputerRequestRoute | null {
  const normalized = String(message || '').trim();
  if (!normalized) return null;

  const bestMatch = getBestUserTaskPipeline(normalized, { includeFallback: false });
  const initialPipeline = bestMatch ? summarizeUserTaskPipelineMatch(bestMatch) : null;
  if (isPureCreativeGeneration(normalized)) return null;
  if (isPlainBuildDiscoveryRequest(normalized)) return null;
  if (isSimpleWordpressConversationalIntent(normalized, initialPipeline)) return null;
  if (initialPipeline?.id === 'bridge_troubleshooting') return null;
  if (initialPipeline?.id === 'workflow_recording_replay' && isWorkflowRecordingRequest(normalized)) return null;

  const pipelineDecision = opts.pipelineDecision ?? buildUserTaskPipelineDecision(normalized, { includeFallback: false });
  const preview = planComputerTaskPreview(normalized);
  const rawStrategy = buildComputerAppTaskStrategy(normalized, pipelineDecision);
  const strategy = shouldPreferLocalFilePreview(normalized, preview, rawStrategy) ? null : rawStrategy;
  const designPipeline = buildDesignAppExecutionPipelinePlan(normalized);

  if (!explicitComputerSurfaceRequested(normalized, preview, strategy, designPipeline)) return null;

  const kind = resolveKind(preview, strategy, designPipeline);
  const confidence = Number(Math.max(0.78, Math.min(0.96, Math.max(
    initialPipeline?.confidence || 0,
    pipelineDecision?.confidence || 0,
    preview.kind === 'unknown' ? 0.74 : 0.86,
    strategy ? 0.88 : 0,
    designPipeline ? 0.94 : 0,
  ))).toFixed(2));
  const risk = resolveRisk({
    message: normalized,
    kind,
    preview,
    selectedPipeline: kind === 'local_file' ? null : initialPipeline,
    strategy,
  });
  const selectedPipeline: UserTaskPipelineSummary = initialPipeline && initialPipeline.executionKind === 'run_computer_task'
    ? { ...initialPipeline, risk: maxRisk(initialPipeline.risk, risk) }
    : initialPipeline && (
      initialPipeline.id === 'desktop_app_control' ||
      initialPipeline.id === 'creative_layout_design' ||
      initialPipeline.id === 'adobe_creative_cloud' ||
      initialPipeline.id === 'browser_navigation' ||
      initialPipeline.id === 'browser_data_retrieval' ||
      initialPipeline.id === 'browser_form_submission' ||
      initialPipeline.id === 'website_platform_admin' ||
      initialPipeline.id === 'local_files' ||
      initialPipeline.id === 'human_verification'
    )
      ? { ...initialPipeline, executionKind: 'run_computer_task' as const, routeId: initialPipeline.routeId || (kind === 'browser' ? 'browser' : null), risk: maxRisk(initialPipeline.risk, risk) }
      : synthesizePipelineSummary(kind, strategy, preview, risk, confidence);
  const routeId: ChatCommandRouteId | null = selectedPipeline.routeId || 'browser';
  const surfacePlan = buildExecutionSurfacePlan({
    message: normalized,
    pipeline: selectedPipeline,
    pipelineDecision: pipelineDecision || null,
  });
  const ledgerPreview = buildAgentRunLedgerPreview({
    message: normalized,
    pipeline: selectedPipeline,
    pipelineDecision: pipelineDecision || null,
    surfacePlan,
  });
  const appAutomationRouteDecision = kind === 'local_file' || kind === 'agent_buildout' || strategy?.id === 'agent_asset_acquisition'
    ? null
    : buildAppAutomationRouteDecision(normalized);
  const approval = buildApproval({ message: normalized, risk, kind, strategy });
  const recommendedTools = uniqueStrings([
    ...(strategy?.recommendedTools || []),
    ...(designPipeline?.requiredToolSequence || []),
    ...(selectedPipeline.recommendedTools || []),
    ...(surfacePlan?.requiredApprovals.length ? ['approvals.request'] : []),
  ]).slice(0, 28);
  const completionProof = uniqueStrings([
    ...(surfacePlan?.completionProof || []),
    ...(strategy?.verificationOrder || []),
    ...(designPipeline ? ['design document inventory', 'proof screenshot or exported proof', 'output file stats'] : []),
  ]).slice(0, 12);
  const fallbackPipelineIds = uniqueStrings([
    ...(pipelineDecision?.supporting.map((item) => item.id) || []),
    selectedPipeline.id !== 'desktop_app_control' && kind === 'desktop_app' ? 'desktop_app_control' : null,
    selectedPipeline.id !== 'local_files' && kind === 'local_file' ? 'local_files' : null,
    selectedPipeline.id !== 'browser_navigation' && kind === 'browser' ? 'browser_navigation' : null,
  ]) as UserTaskPipelineId[];
  const bestPath = buildBestPath({ kind, preview, strategy, designPipeline, pipeline: selectedPipeline });
  const notes = uniqueStrings([
    `Computer request route: ${bestPath}.`,
    `Preview kind: ${preview.kind}.`,
    strategy ? `Strategy: ${strategy.label} (${strategy.id}).` : null,
    appAutomationRouteDecision ? `App route decision: ${appAutomationRouteDecision.status} via ${appAutomationRouteDecision.chosenSurface.label} for ${appAutomationRouteDecision.taskFamily}.` : null,
    designPipeline ? `Design execution phases: ${designPipeline.phases.map((phase) => phase.id).join(' -> ')}.` : null,
    surfacePlan ? `Primary surface: ${surfacePlan.primarySurface}; fallbacks: ${surfacePlan.fallbackSurfaces.join(' -> ') || 'none'}.` : null,
    approval.required
      ? `Approval required: ${approval.reason}.`
      : isLowRiskLocalImageExportTask(normalized)
        ? 'Approval not required for this bounded local image export.'
        : 'Approval not required before read-only routing.',
  ]).slice(0, 8);

  const route: ChatComputerRequestRoute = {
    kind,
    executionKind: 'run_computer_task',
    routeId,
    risk,
    approvalRequired: approval.required,
    approvalReason: approval.reason,
    confidence,
    bestPath,
    selectedPipeline,
    pipelineDecision: pipelineDecision || null,
    surfacePlan,
    ledgerPreview,
    computerPreview: preview,
    appStrategy: strategy,
    appAutomationRouteDecision,
    designExecutionPipeline: designPipeline,
    fallbackPipelineIds,
    recommendedTools,
    completionProof,
    evidenceContract: null,
    notes,
  };
  route.evidenceContract = buildComputerTaskEvidenceContract(route);
  route.completionProof = uniqueStrings([
    ...route.completionProof,
    ...route.evidenceContract.proofAfter,
  ]).slice(0, 12);
  return route;
}

export function buildChatComputerRequestRoutePromptBlock(message: string): string | null {
  const route = buildChatComputerRequestRoute(message);
  if (!route) return null;
  return [
    '## Chat Computer Request Route',
    `Best path: ${route.bestPath}`,
    `Request kind: ${route.kind}; execution=${route.executionKind}; route=${route.routeId || 'computer'}`,
    `Risk: ${route.risk}; approval=${route.approvalRequired ? route.approvalReason || 'required' : 'not required before read-only execution'}`,
    route.selectedPipeline ? `Selected pipeline: ${route.selectedPipeline.title} (${route.selectedPipeline.id})` : null,
    route.appStrategy ? `App/browser strategy: ${route.appStrategy.label} (${route.appStrategy.id})` : null,
    formatChatComputerTaskAutonomyPromptBlock(route),
    route.appAutomationRouteDecision ? formatAppAutomationRouteDecisionPromptBlock(route.appAutomationRouteDecision) : null,
    route.designExecutionPipeline ? `Design pipeline phases: ${route.designExecutionPipeline.phases.map((phase) => phase.id).join(' -> ')}` : null,
    route.surfacePlan ? `Surface order: ${[route.surfacePlan.primarySurface, ...route.surfacePlan.fallbackSurfaces].join(' -> ')}` : null,
    route.evidenceContract ? formatComputerTaskEvidenceContractPromptBlock(route.evidenceContract) : null,
    `Recommended tools: ${route.recommendedTools.join(' | ') || 'none'}`,
    `Completion proof: ${route.completionProof.join(' | ') || 'exact blocker or final answer'}`,
    `Fallback pipelines: ${route.fallbackPipelineIds.join(' | ') || 'none'}`,
    'Use this route before generic chat. Keep the user view quiet unless approval, proof, or an actionable blocker is needed.',
  ].filter(Boolean).join('\n');
}
