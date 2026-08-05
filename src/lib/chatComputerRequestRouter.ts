import type { ChatCommandRouteId } from './chatCommandRegistry';
import { classifyBrowserbaseWorkflow } from './browserbaseWorkflowIntent';
import { buildAgentRunLedgerPreview, type AgentRunLedgerPreview } from './agentRunLedger';
import {
  buildComputerAppTaskStrategy,
  detectWordPressTrashPostIntent,
  type ComputerAppStrategyId,
  type ComputerAppTaskStrategy,
} from './computerAppTaskStrategy';
import {
  isDirectLocalImageFormatConversionTask,
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
import { formatDataTransferPrecisionRulesBlock } from './computerTaskComplexityPlan';
import {
  classifyDesktopTaskAiNeed,
  type DesktopTaskAiNeedClassification,
} from './desktopTaskAiNeed';
import {
  applyStickyScopes,
  extractStickyTaskTargets,
  formatStickyScopeAppliedNotice,
  getActiveStickyScopes,
  STICKY_FLOOR_CATEGORIES,
  type StickyAllowScope,
  type StickyScopeAppliedSummary,
  type StickyScopeTaskTarget,
} from './computerGrantGate';
import {
  buildUserTaskPipelineDecision,
  getBestUserTaskPipeline,
  summarizeUserTaskPipelineMatch,
  type UserTaskPipelineDecision,
  type UserTaskPipelineId,
  type UserTaskPipelineRisk,
  type UserTaskPipelineSummary,
} from './userTaskPipelines';
import {
  buildAppOpenPlan,
  detectTaskAppCategory,
  findKnownAppInText,
  matchKnownApp,
  pickRecoveryAppFallback,
  resolveMacLaunchName,
  resolveBestAppForTask,
  type AppTaskResolution,
  type ResolveBestAppContext,
  type ResolvedAppOption,
  type TaskAppCategory,
} from './knownAppShortcuts';
import {
  compileComputerSequenceProgram,
  type ComputerSequenceProgram,
} from './computerSequenceProgramCore';
import {
  classifyGenericAppTaskFamily,
  hasStrictNamedAppLifecycleCommandShape,
  parseStrictNamedAppLifecycleIntent,
  setStrictNamedAppLifecycleObservedNames,
} from './genericAppNavigator';

export type ChatComputerRequestRouteKind =
  | 'browser'
  | 'desktop_app'
  | 'local_file'
  | 'hybrid'
  | 'agent_buildout';

/**
 * User-stated constraints parsed from the request (D3). These are hard
 * guardrails the user expressed in natural language — "don't submit the
 * form", "ask me before deleting anything", "stop if it needs MFA" — that
 * previously were silently ignored. They are injected into the prompt as
 * rules AND enforceable pre-dispatch via `constraintBlocksToolCall` (the
 * R11 tool approval gate). Categories are small and verb-anchored on
 * purpose: a missed constraint phrasing degrades to prompt-only guidance,
 * never to a wrong block.
 */
export type ChatComputerConstraintCategory =
  | 'submit'
  | 'send'
  | 'publish'
  | 'pay'
  | 'delete'
  | 'download'
  | 'upload'
  | 'save'
  | 'login'
  /** Account/authorization grants — OAuth consent, "authorize", linking accounts (T7). */
  | 'grant';

export interface ChatComputerUserConstraints {
  /** Action categories the user prohibited outright ("don't submit"). */
  forbidden: ChatComputerConstraintCategory[];
  /** Categories requiring a fresh per-step ask ("ask me before deleting"). */
  approvalBefore: ChatComputerConstraintCategory[];
  /** Conditions that must stop the task and hand back ("stop if MFA"). */
  stopConditions: string[];
  /** The user phrasings that produced the constraints, for display/audit. */
  sourcePhrases: string[];
}

// ─── Task→best-app resolution (wave-2) ──────────────────────────────────────

/**
 * In-memory app-resolution context registry. Same pattern as the T7 sticky
 * "always allow" registry in `computerGrantGate`: ChatTab hydrates it
 * asynchronously (mount + top of `executeSharedComputerTask`) from the
 * desktop bridge probes and the per-circle preferred-app store; the
 * synchronous route build below consumes it. It lives HERE (not in
 * `knownAppShortcuts`) because this router is the only sync consumer and
 * `knownAppShortcuts` stays a pure catalog. The unhydrated default fails
 * honest: `bridgeOnline: false` means desktop candidates rank unavailable
 * and known-good web apps win — never an optimistic "probably installed".
 */
let appResolutionContextRegistry: ResolveBestAppContext = { bridgeOnline: false };

function observedLifecycleAppNames(ctx: ResolveBestAppContext | null | undefined): string[] {
  if (!ctx?.bridgeOnline) return [];
  return [
    ...(Array.isArray(ctx.runningApps) ? ctx.runningApps : []),
    ...(Array.isArray(ctx.installedApps) ? ctx.installedApps : []),
  ].filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
}

export function setAppResolutionContext(ctx: ResolveBestAppContext): void {
  appResolutionContextRegistry = {
    ...ctx,
    bridgeOnline: Boolean(ctx?.bridgeOnline),
  };
  setStrictNamedAppLifecycleObservedNames(observedLifecycleAppNames(appResolutionContextRegistry));
}

export function getAppResolutionContext(): ResolveBestAppContext {
  return appResolutionContextRegistry;
}

/** Persisted-compatible compact form of one resolved app option. */
export interface ChatComputerAppResolutionOption {
  appId: string;
  displayName: string;
  surface: 'desktop' | 'browser';
  openVia: 'desktop_launch' | 'url_scheme' | 'browser_url';
  openTarget: string;
  reason: string;
  /**
   * AR: how confidently the option can be opened right now — 'installed'
   * (confirmed desktop), 'maybe' (bridge online, probe unavailable), 'web'
   * (browser, always launchable). Optional so routes persisted before this
   * field keep parsing.
   */
  availability?: 'installed' | 'maybe' | 'web';
}

/**
 * Compact task→best-app resolution stamped on the route (wave-2). Bounded
 * and JSON-safe so it survives persisted chat rows; optional so routes
 * persisted before this field keep parsing.
 */
export interface ChatComputerAppResolution {
  category: TaskAppCategory;
  best: ChatComputerAppResolutionOption;
  /** ≤3 entries, each "displayName — reason". */
  alternativesSummary: string[];
  explicitAppNamed: boolean;
  /** Human-readable open-first steps (≤3), derived from `buildAppOpenPlan`. */
  openStepLines: string[];
  /**
   * AR: the exact app the user named, when `explicitAppNamed` is true (the
   * matched alias). Preserved so recovery can say "you asked for Pixelmator"
   * instead of a generic "missing app capability". Optional/bounded.
   */
  namedAppIntent?: string | null;
  /**
   * AR: the next-best CONFIDENTLY-launchable app to try if the chosen app
   * fails to open (prefers a full web app over another desktop guess).
   * Structured so the dispatch contract and recovery walk the same ladder
   * instead of re-parsing `alternativesSummary`. Null when there is none.
   */
  recoveryFallback?: ChatComputerAppResolutionOption | null;
}

/** First reason segment only — "installed on this Mac; already running" → "installed on this Mac". */
function shortAppReason(reason: string): string {
  return String(reason || '').split(';')[0].trim().slice(0, 80);
}

/**
 * Human-readable open-first step lines for a resolved option, mirrored from
 * the real `buildAppOpenPlan` tool steps so prompts, route solution steps,
 * and the complexity-plan app-choice contract all share one wording.
 */
export function buildAppOpenStepLines(option: ResolvedAppOption): string[] {
  const lines: string[] = [];
  for (const step of buildAppOpenPlan(option).steps) {
    switch (step.tool) {
      case 'desktop.launch_app':
        lines.push(`Open ${option.displayName} (${shortAppReason(option.reason)}) — launch it on the desktop first.`);
        break;
      case 'desktop.focus_app':
        lines.push(`Focus ${option.displayName} — it is already running.`);
        break;
      case 'desktop.wait_for_app':
        lines.push(`Wait for ${option.displayName} to be ready and frontmost before acting in it.`);
        break;
      case 'desktop.open_url':
        lines.push(`Open the ${option.displayName} deep link (${option.openTarget}).`);
        break;
      case 'browser.open_url':
        lines.push(`Open ${option.displayName} in the browser (${option.openTarget}) and wait for it to load first.`);
        break;
    }
  }
  return lines.slice(0, 3).map((line) => line.slice(0, 140));
}

function compactAppOption(option: ResolvedAppOption): ChatComputerAppResolutionOption {
  return {
    appId: String(option.appId).slice(0, 60),
    displayName: String(option.displayName).slice(0, 80),
    surface: option.surface,
    openVia: option.openVia,
    openTarget: String(option.openTarget).slice(0, 200),
    reason: String(option.reason).slice(0, 160),
    ...(option.availability ? { availability: option.availability } : {}),
  };
}

function summarizeAppResolution(resolution: AppTaskResolution): ChatComputerAppResolution {
  const best = resolution.best;
  const recoveryFallback = pickRecoveryAppFallback(resolution);
  return {
    category: resolution.category,
    best: compactAppOption(best),
    alternativesSummary: resolution.alternatives
      .slice(0, 3)
      .map((alt) => `${alt.displayName} — ${shortAppReason(alt.reason)}`.slice(0, 120)),
    explicitAppNamed: resolution.explicitAppNamed,
    openStepLines: buildAppOpenStepLines(best),
    namedAppIntent: resolution.explicitAppNamed
      ? String(resolution.matchedPhrase || best.displayName).slice(0, 80)
      : null,
    recoveryFallback: recoveryFallback ? compactAppOption(recoveryFallback) : null,
  };
}

/**
 * Categories where a high-confidence detection alone is enough to CREATE a
 * computer route ("edit this photo" → open Photoshop/Photopea first). These
 * are app-workbench tasks the user cannot finish in plain chat. The
 * conversational categories (email, notes, chat_messaging, calendar,
 * task_management, document_writing, code_editing, meetings, web_browsing)
 * are deliberately excluded: chat drafts those directly today and existing
 * integrations own them — a resolution there only STAMPS a route that other
 * signals already created, never invents one.
 */
const APP_WORKBENCH_TASK_CATEGORIES: ReadonlySet<TaskAppCategory> = new Set<TaskAppCategory>([
  'photo_editing',
  'image_design',
  'vector_design',
  'video_editing',
  'audio_music',
  'spreadsheet',
  'presentation',
  'pdf',
  'cad_3d',
  'data_analysis',
  'file_management',
]);

/**
 * Conservative override parse (wave-2 preference learning): after a route
 * carried an app resolution, "use Pixelmator", "switch to Photopea", or
 * "open it in Affinity Photo" against the SAME category records the user's
 * preferred app. Verb-anchored and whole-message-shaped on purpose — a
 * missed parse just means no preference is learned, never a wrong action.
 */
export interface ChatComputerAppOverrideChoice {
  category: TaskAppCategory;
  appId: string;
  displayName: string;
}

const APP_OVERRIDE_RE = /^(?:no[,.]?\s+|ok(?:ay)?[,.]?\s+|please\s+|actually[,.]?\s+|can you\s+|lets?\s+|let's\s+)*(?:use|switch to|open (?:it|this|that) in|do (?:it|this|that) in)\s+(.{2,50}?)(?:\s+instead(?:\s+of\s+.{1,40})?)?\s*[.!]*$/i;

export type ChatComputerRequestActionSurface =
  | 'browser'
  | 'desktop_app'
  | 'local_file'
  | 'approval'
  | 'verification'
  | 'support';

export interface ChatComputerRequestActionItem {
  id: string;
  surface: ChatComputerRequestActionSurface;
  tool: string;
  label: string;
  proof: string | null;
  requiresApproval?: boolean;
}

export function parseAppOverrideChoice(
  message: string,
  previous: Pick<ChatComputerAppResolution, 'category' | 'best'> | null | undefined,
): ChatComputerAppOverrideChoice | null {
  if (!previous) return null;
  const text = String(message || '').trim();
  if (!text || text.length > 90) return null;
  const match = text.match(APP_OVERRIDE_RE);
  if (!match) return null;
  const named = findKnownAppInText(match[1]);
  if (!named) return null;
  if (named.app.id === previous.best.appId) return null;
  if (!named.app.taskCategories || !named.app.taskCategories.includes(previous.category)) return null;
  return {
    category: previous.category,
    appId: named.app.id,
    displayName: named.app.displayName,
  };
}

export interface ChatComputerRequestRoute {
  sourceMessage?: string;
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
  aiNeed?: DesktopTaskAiNeedClassification;
  /**
   * Immutable local lifecycle program for a strict named-app
   * open/launch/focus command. Chat dispatches this through the existing
   * observe-first native activation adapter, without calling an AI relay.
   */
  deterministicLifecycleReadProgram?: ChatComputerDeterministicLifecycleReadProgram | null;
  /**
   * How the selected chat model should coordinate with SwanBot/OpenSwan,
   * desktop/browser tools, and optional multi-agent fan-out. This prevents
   * "selected model" from becoming a raw-chat bypass around the runtime.
   */
  modelOrchestration?: ChatComputerModelOrchestration;
  /**
   * Ordered, executable checklist derived from the selected desktop/browser
   * tools. This is what the model should DO, not a broad phased plan. Optional
   * so routes persisted before this field keep parsing.
   */
  actionItems?: ChatComputerRequestActionItem[];
  evidenceContract?: ComputerTaskEvidenceContract | null;
  userConstraints: ChatComputerUserConstraints | null;
  /**
   * T7: always-confirm floor categories detected in this task. When
   * non-empty, `approvalRequired` is forced true and the prompt block carries
   * the floor rule — EXCEPT (WI-2) for browser routes, where the pay floor
   * (pay/purchase/buy/checkout/charge) is stamped here for per-step
   * enforcement via `constraintBlocksToolCall` but no longer forces route-level
   * `approvalRequired=true`; the single commit confirmation fires mid-run at
   * the payment floor. login/grant/delete floor categories still force route
   * approval on every route, including browser. Optional so routes persisted
   * before T7 keep parsing.
   */
  alwaysConfirmFloor?: ChatComputerConstraintCategory[];
  /**
   * T7 UX: set when an unexpired, unrevoked sticky "always allow" scope for
   * the task's target site/app covered every detected non-floor approval
   * category and downgraded `approvalRequired` to false. Floor categories,
   * destructive risk, stop-conditions, and user constraints are never
   * downgraded. Optional so routes persisted before this field keep parsing.
   */
  stickyScopeApplied?: StickyScopeAppliedSummary | null;
  /**
   * Wave-2: compact task→best-app resolution ("edit this photo" →
   * Photoshop if installed / Photopea in the browser). When set, the
   * route's solution steps open the chosen app FIRST. Optional so routes
   * persisted before this field keep parsing.
   */
  appResolution?: ChatComputerAppResolution | null;
  notes: string[];
}

export interface ChatComputerModelOrchestration {
  mode: 'deterministic_local_program' | 'model_guided_tools' | 'multi_agent_model_guided_tools';
  coordinator: 'chat_plan_then_local_program' | 'selected_chat_model_then_openswan';
  selectedModelRole: string;
  activationPath: string[];
  modelSelectionHint: string;
  multiAgentHint?: string;
}

export interface ChatComputerDeterministicLifecycleReadStep {
  tool: 'desktop.observe_app' | 'desktop.launch_app' | 'desktop.wait_for_app' | 'desktop.focus_app';
  args: Record<string, unknown>;
  when: 'always' | 'if_not_running' | 'if_launched' | 'if_not_frontmost';
  note: string;
}

export interface ChatComputerDeterministicLifecycleReadProgram {
  id: 'named_app_lifecycle_read';
  operation: 'open_or_launch' | 'focus';
  targetAppName: string;
  /** Exact local bundle/process name handed to the typed desktop bridge. */
  dispatchAppName: string;
  authorization: {
    mode: 'direct_user_request';
    reason: string;
  };
  steps: ChatComputerDeterministicLifecycleReadStep[];
}

function narrowStrategyForExactComputerSequence(
  strategy: ComputerAppTaskStrategy | null,
  program: ComputerSequenceProgram | null,
): ComputerAppTaskStrategy | null {
  if (!strategy || program?.id !== 'photoshop_new_document') return strategy;
  const createStep = program.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
  const widthPx = Number(createStep?.args.widthPx);
  const heightPx = Number(createStep?.args.heightPx);
  const sizeLabel = Number.isFinite(widthPx) && Number.isFinite(heightPx)
    ? `${widthPx}x${heightPx}`
    : 'requested-size';
  const directRequestAuthorized = program.authorization.mode === 'direct_user_request';
  return {
    ...strategy,
    label: 'Photoshop Blank Document Control Loop',
    summary: `Execute the compiled app-native sequence to create one blank ${sizeLabel} Photoshop document; no source file, layer edit, export, or generic UI planning is involved.`,
    observeFirst: [
      'desktop.photoshop_document_status for running/scriptable and active-document state',
      'no active document is the expected from-scratch starting state',
    ],
    actionOrder: [
      'desktop.photoshop_document_status',
      'desktop.launch_app only when appRunning:false',
      'desktop.photoshop_document_status until scriptable',
      `desktop.photoshop_create_document widthPx=${widthPx} heightPx=${heightPx}`,
      'desktop.photoshop_document_status for final proof',
    ],
    verificationOrder: [
      `final app-native document status reports an active ${sizeLabel} document`,
      'final app-native status includes created document name and dimensions',
    ],
    recoveryPolicy: [
      'Retry only Photoshop document status during the bounded cold-start window.',
      `Stop on bridge/install/license/login/permission/modal/${directRequestAuthorized ? '' : 'approval/'}create failure or final dimension mismatch.`,
      'Do not fall back to file, layer, screenshot, a11y, menu, keyboard, coordinate, or connected-agent planning.',
    ],
    approvalCheckpoints: directRequestAuthorized
      ? []
      : ['One Chat plan-level approval authorizes the oversized Photoshop blank-document allocation before dispatch.'],
    stopConditions: [
      `active ${sizeLabel} document verified`,
      ...(!directRequestAuthorized ? ['Chat plan-level approval rejected'] : []),
      'Photoshop or the dedicated bridge tool is unavailable',
      'final document status does not match the requested dimensions',
    ],
    recommendedTools: [
      'desktop.photoshop_document_status',
      'desktop.launch_app',
      'desktop.photoshop_create_document',
    ],
    bridgeRequirements: [
      'local desktop bridge with Photoshop UXP/app API tools',
      'Adobe Photoshop installed and scriptable',
    ],
    maxBlindActions: 0,
  };
}

function wantsMaximumAgentFanout(message: string): boolean {
  const text = String(message || '').toLowerCase();
  return /\b(?:use|deploy|spawn|run|assign|have|put)\s+(?:as\s+many|all|multiple|parallel)\s+agents?\b/.test(text)
    || /\bas\s+many\s+agents?\s+(?:as\s+possible|work\s+on\s+it)\b/.test(text)
    || /\bagents?\s+work\s+on\s+it\s+as\s+possible\b/.test(text)
    || /\bwith\s+as\s+many\s+agents?\s+as\s+possible\b/.test(text);
}

function buildChatComputerModelOrchestration(input: {
  message: string;
  kind: ChatComputerRequestRouteKind;
  recommendedTools: string[];
  aiNeed: DesktopTaskAiNeedClassification;
  exactProgramAuthorization?: ComputerSequenceProgram['authorization'] | null;
  deterministicLifecycleReadProgram?: ChatComputerDeterministicLifecycleReadProgram | null;
}): ChatComputerModelOrchestration {
  if (input.exactProgramAuthorization) {
    const directRequest = input.exactProgramAuthorization.mode === 'direct_user_request';
    return {
      mode: 'deterministic_local_program',
      coordinator: 'chat_plan_then_local_program',
      selectedModelRole: 'No execution model is needed after deterministic classification; the immutable program runs through the local desktop bridge.',
      activationPath: [
        'compile the exact desktop program',
        directRequest
          ? 'accept the current direct user command as authority for the bounded unsaved draft'
          : 'bind and consume one Chat plan approval',
        'execute the local program once',
        'verify fresh app-native document status',
      ],
      modelSelectionHint: 'Do not call the AI relay for this exact task; return only verified proof or the exact local blocker.',
    };
  }
  if (input.deterministicLifecycleReadProgram) {
    const program = input.deterministicLifecycleReadProgram;
    return {
      mode: 'deterministic_local_program',
      coordinator: 'chat_plan_then_local_program',
      selectedModelRole: 'No execution model is needed; the strict named-app lifecycle program runs through the local observe-first activation adapter.',
      activationPath: [
        `compile strict ${program.operation === 'focus' ? 'focus' : 'open/launch'} program for ${program.targetAppName}`,
        'dispatch through the paired local desktop bridge',
        program.operation === 'open_or_launch' ? 'launch only when not running' : 'require the app to already be running',
        'focus when not frontmost',
        'verify fresh exact process and foreground proof',
      ],
      modelSelectionHint: 'Do not call the selected-model or SwanBot AI relay; return only verified lifecycle proof, cancellation, or the exact local blocker.',
    };
  }
  const multiAgent = wantsMaximumAgentFanout(input.message);
  const toolSurface = input.kind === 'browser'
    ? 'browser tools'
    : input.kind === 'local_file'
      ? 'local file tools'
      : input.kind === 'desktop_app'
        ? 'desktop/app bridge tools'
        : 'hybrid browser/desktop tools';
  return {
    mode: multiAgent ? 'multi_agent_model_guided_tools' : 'model_guided_tools',
    coordinator: 'selected_chat_model_then_openswan',
    selectedModelRole: `Use the selected chat model to understand the request, pick the right app/tool path, and decide when AI reasoning is needed; do not use raw chat as the final executor when ${toolSurface} are available.`,
    activationPath: [
      'resolve selected model or Auto profile',
      'run SwanBot/OpenSwan planner with the route metadata',
      `execute through ${toolSurface}`,
      'collect proof or a bounded blocker',
    ],
    modelSelectionHint: input.aiNeed.level === 'none'
      ? 'Prefer deterministic tools and use the model only to summarize proof or blockers.'
      : input.aiNeed.level === 'assistive'
        ? 'Use the model to choose controls, interpret screenshots, and keep execution bounded by evidence.'
        : 'Use a strong connected reasoning/coding model, then hand execution to SwanBot/OpenSwan tools instead of answering only in prose.',
    multiAgentHint: multiAgent
      ? 'If multiple agents are available, create a multi-agent plan first and keep each agent on a bounded role; approvals/evidence still gate tool execution.'
      : undefined,
  };
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
  return /\b(publish|go live|send|invite|post|upload|import|checkout|pay|purchase|buy|book|reserve|charge|refund|delete|remove|cancel|install|activate|deactivate|configure)\b/i.test(message);
}

function hasDestructiveIntent(message: string): boolean {
  return /\b(permanently delete|delete forever|erase|wipe|drop table|destroy|overwrite source|replace original)\b/i.test(message);
}

function hasMutationIntent(message: string): boolean {
  return /\b(open|launch|focus|click|type|paste|press|select|choose|fill|set|create|make|build|edit|update|change|replace|resize|crop|retouch|draw|design|generate|export|save|package|render|encode|upload|download|import|send|publish|submit|delete|remove|move|copy|rename)\b/i.test(message);
}

function hasLocalFileMutationIntent(message: string): boolean {
  const text = String(message || '');
  return /\b(?:copy|duplicate|rename|change|delete|remove|trash)\b[\s\S]{0,180}\b(?:file|folder|directory|image|photo|picture|document|desktop|downloads?|documents?|pictures?|photos?|[A-Za-z0-9][A-Za-z0-9 ._@()+-]{0,120}\.[A-Za-z0-9]{1,12})\b/i.test(text)
    || /\b(?:write|save|create|make|new|append)\b[\s\S]{0,140}\b(?:text\s+file|file|folder|directory|txt|markdown|md|json|csv)\b/i.test(text)
    || /\b(?:move)\b[\s\S]{0,160}\bto\s+trash\b/i.test(text);
}

function hasExplicitApprovalIntent(message: string): boolean {
  return /\b(after i approve|after approval|with approval|ask me before|once i approve|before you (?:send|submit|publish|save|export|delete|overwrite|run)|require approval)\b/i.test(message);
}

// ─── User constraints (D3) ──────────────────────────────────────────────────

/**
 * Verb anchors per constraint category. Used both for parsing the user's
 * sentence and for matching tool calls at enforcement time. Word-boundary
 * regexes — a category never matches on substrings ("resend" ≠ "send" is
 * NOT guaranteed by \b, so the riskier verbs list their safe variants).
 */
const CONSTRAINT_CATEGORY_VERBS: Record<ChatComputerConstraintCategory, RegExp> = {
  submit: /\b(submit|submitting)\b/i,
  send: /\b(send|sending|email|emailing|message|messaging)\b/i,
  publish: /\b(publish|publishing|post|posting|go live)\b/i,
  pay: /\b(pay|paying|purchase|purchasing|buy|buying|checkout|charge|charging)\b/i,
  delete: /\b(delete|deleting|remove|removing|erase|erasing|wipe|wiping|trash|trashing)\b/i,
  download: /\b(download|downloading)\b/i,
  upload: /\b(upload|uploading|attach|attaching)\b/i,
  save: /\b(save|saving|overwrite|overwriting|export|exporting)\b/i,
  login: /\b(log ?in(?:to)?|logging ?in(?:to)?|sign ?in(?:to)?|signing ?in(?:to)?|authenticate|enter (?:my )?(?:password|credentials))\b/i,
  grant: /\b(authorize|authorizing|grant(?:ing)?\s+(?:access|permission|consent)|connect (?:my |the |your )?account|link (?:my |the |your )?account|oauth)\b/i,
};

const CONSTRAINT_CATEGORIES = Object.keys(CONSTRAINT_CATEGORY_VERBS) as ChatComputerConstraintCategory[];

function categoriesInText(text: string): ChatComputerConstraintCategory[] {
  return CONSTRAINT_CATEGORIES.filter((category) => CONSTRAINT_CATEGORY_VERBS[category].test(text));
}

/**
 * Public category detection over raw task text — used by the sticky-allow
 * permissions surface to derive the post-task "always allow X on Y" offer
 * from the same verb anchors routing uses (T7 UX).
 */
export function detectChatComputerConstraintCategories(text: string): ChatComputerConstraintCategory[] {
  return categoriesInText(String(text || ''));
}

/**
 * Parse user-stated constraints from the request. Pure; returns null when
 * nothing constraint-shaped is present so callers can skip the field
 * cheaply. Patterns are deliberately conservative: each must name a
 * prohibition/ask/stop AND a recognized action verb within a short window.
 */
export function parseChatComputerUserConstraints(message: string): ChatComputerUserConstraints | null {
  const text = String(message || '');
  if (!text.trim()) return null;

  const forbidden = new Set<ChatComputerConstraintCategory>();
  const approvalBefore = new Set<ChatComputerConstraintCategory>();
  const stopConditions = new Set<string>();
  const sourcePhrases = new Set<string>();

  const capture = (re: RegExp, into: Set<ChatComputerConstraintCategory>) => {
    for (const match of text.matchAll(re)) {
      const phrase = match[0];
      const cats = categoriesInText(phrase);
      if (cats.length === 0) continue;
      cats.forEach((c) => into.add(c));
      sourcePhrases.add(phrase.trim());
    }
  };

  // "don't submit", "do not send the email", "never delete", "without saving"
  capture(/\b(?:don'?t|do not|never)\s+(?:\w+\s+){0,4}?\w+(?:\s+\w+){0,5}/gi, forbidden);
  capture(/\bwithout\s+(?:\w+ing)(?:\s+\w+){0,4}/gi, forbidden);
  // "ask (me) before deleting", "check with me before you publish",
  // "get my approval before sending"
  capture(/\b(?:ask(?: me)?|check with me|get my approval|confirm with me)\s+(?:first\s+)?before\s+(?:you\s+)?(?:\w+\s+){0,4}?\w+/gi, approvalBefore);

  // "stop if you hit MFA", "stop if it asks for a captcha/login/password",
  // "pause if anything looks wrong"
  for (const match of text.matchAll(/\b(?:stop|pause|halt)\s+(?:and ask\s+)?if\s+(?:you\s+|it\s+|anything\s+)?(?:\w+\s+){0,5}?(mfa|2fa|two[- ]factor|captcha|log ?in|password|credentials?|error|looks wrong|unexpected)\b/gi)) {
    stopConditions.add(match[1].toLowerCase().replace(/\s+/g, ' '));
    sourcePhrases.add(match[0].trim());
  }

  // A category the user explicitly forbade dominates a per-step ask.
  for (const c of forbidden) approvalBefore.delete(c);

  if (forbidden.size === 0 && approvalBefore.size === 0 && stopConditions.size === 0) return null;
  return {
    forbidden: Array.from(forbidden),
    approvalBefore: Array.from(approvalBefore),
    stopConditions: Array.from(stopConditions),
    sourcePhrases: Array.from(sourcePhrases).slice(0, 6),
  };
}

// ─── Always-confirm category floor (T7) ─────────────────────────────────────

/**
 * Hard always-confirm category floor (T7). Tasks that involve these action
 * categories ALWAYS require explicit user confirmation before the sensitive
 * step — regardless of autonomy mode, sticky grants, constraint parsing, or
 * user-stated "don't ask me" instructions. Pattern validated against Claude
 * in Chrome's shipped permission model (TOOLTREE_DESKTOP_RESEARCH §2.6):
 * purchases/financial transactions, permanent deletions, credential entry,
 * and account/authorization grants are never auto-approved. The floor is
 * policy, not preference: it is not user-disableable. A missed detection
 * degrades to current behavior; a match adds an ask, never a hard block.
 *
 * The canonical value lives in `computerGrantGate.STICKY_FLOOR_CATEGORIES`
 * (the sticky-allow module must reject these at scope creation), re-exported
 * here so the floor and the sticky-grant exclusion list can never drift.
 */
export const ALWAYS_CONFIRM_FLOOR: readonly ChatComputerConstraintCategory[] = STICKY_FLOOR_CATEGORIES;

/**
 * Verb anchors for detecting floor categories in raw task text and tool
 * calls. Reuses the D3 category anchors except where they would over-trigger
 * on full task prose: bare "remove"/"trash" (benign edits like "remove the
 * background") do not count as permanent destruction — only
 * delete/erase/wipe/permanently-remove do.
 */
const FLOOR_CATEGORY_VERBS: Partial<Record<ChatComputerConstraintCategory, RegExp>> = {
  pay: CONSTRAINT_CATEGORY_VERBS.pay,
  delete: /\b(delete|deleting|erase|erasing|wipe|wiping|permanently remove|remove permanently)\b/i,
  login: CONSTRAINT_CATEGORY_VERBS.login,
  grant: CONSTRAINT_CATEGORY_VERBS.grant,
};

/**
 * WI-2: STEP-LEVEL pay verbs. Superset of the route-level pay floor verbs that
 * additionally counts `book`/`reserve` (and their submit forms) as a pay-class
 * commit. This list is consumed ONLY by `constraintBlocksToolCall` — the
 * per-step enforcement backstop — so a `submit_booking`/`confirm_reservation`
 * tool call fires the one-time payment-floor confirmation. It is deliberately
 * NOT wired into `detectAlwaysConfirmFloorCategories`, so a plain "book me a
 * hotel" message does NOT stamp `pay` at route-build time (route stays
 * zero-tap); the floor lands at the actual submission step instead. Matches the
 * canonical pay floor category (`computerGrantGate` pay) which stays
 * never-grantable — this only widens WHEN the confirm fires, never removes it.
 */
const STEP_LEVEL_PAY_VERBS = /\b(pay|paying|purchase|purchasing|buy|buying|checkout|check ?out|charge|charging|book|booking|reserve|reserving|reservation|place ?order|placeorder|complete ?(?:the )?(?:order|purchase|booking|reservation))\b/i;

/**
 * Detect floor categories present in the task text. Pure and conservative
 * (verb-anchored, same posture as D3): unrelated tasks return []. Used at
 * route-build time to force `approvalRequired` and inject the floor prompt
 * line.
 */
export function detectAlwaysConfirmFloorCategories(text: string): ChatComputerConstraintCategory[] {
  const value = String(text || '');
  if (!value.trim()) return [];
  return ALWAYS_CONFIRM_FLOOR.filter((category) => FLOOR_CATEGORY_VERBS[category]?.test(value));
}

/** Compact prompt line for the floor — injected as a non-negotiable rule. */
export function formatAlwaysConfirmFloorPromptLine(
  categories: ChatComputerConstraintCategory[] | null | undefined,
): string | null {
  if (!categories || categories.length === 0) return null;
  return `Always-confirm floor (HARD policy): ${categories.join(', ')} actions require explicit user confirmation even in autonomous mode — no autonomy setting, sticky grant, or user instruction ("don't ask me") disables this. Stop and ask before each such action.`;
}

/**
 * Enforcement backstop for the pre-dispatch tool approval gate (R11).
 * Returns a block verdict when a tool call clearly matches a FORBIDDEN
 * category — matching on the tool name plus a bounded slice of its
 * stringified input. Conservative by design: prompt rules are the primary
 * defense; this only hard-stops unambiguous matches so a fuzzy match can
 * never block legitimate work.
 *
 * T7: independently of user constraints (even when `constraints` is null),
 * a call matching an ALWAYS_CONFIRM_FLOOR category returns
 * `floorConfirmRequired: true` with `blocked: false` — the gate should
 * request fresh user confirmation, not hard-block. A forbidden-constraint
 * block takes precedence over a floor confirm for the same call.
 */
export interface ChatComputerToolCallConstraintVerdict {
  blocked: boolean;
  category?: ChatComputerConstraintCategory;
  reason?: string;
  /** T7 floor: request explicit user confirmation before dispatching this call. */
  floorConfirmRequired?: boolean;
  floorCategory?: ChatComputerConstraintCategory;
}

export function constraintBlocksToolCall(
  constraints: ChatComputerUserConstraints | null | undefined,
  toolName: string,
  input: unknown,
): ChatComputerToolCallConstraintVerdict {
  // Tool names use ./_/- separators ("browser.submit_form") which are word
  // chars to \b — normalize to spaces so verb anchors match name segments.
  const name = String(toolName || '').replace(/[._-]+/g, ' ');
  let inputSlice = '';
  try { inputSlice = JSON.stringify(input ?? {}).slice(0, 600); } catch { inputSlice = ''; }
  for (const category of constraints?.forbidden || []) {
    const verbs = CONSTRAINT_CATEGORY_VERBS[category];
    if (verbs.test(name) || verbs.test(inputSlice)) {
      return {
        blocked: true,
        category,
        reason: `The user forbade "${category}" actions for this task. Stop and report instead of performing it.`,
      };
    }
  }
  for (const category of ALWAYS_CONFIRM_FLOOR) {
    // WI-2: at the STEP (tool-call) level the pay floor also fires on
    // book/reserve/checkout-submit calls — the final booking submission is a
    // pay-class commit even when the route text said "book" (not a route floor
    // verb). Other floor categories use their standard verb anchors.
    const verbs = category === 'pay' ? STEP_LEVEL_PAY_VERBS : FLOOR_CATEGORY_VERBS[category];
    if (verbs && (verbs.test(name) || verbs.test(inputSlice))) {
      return {
        blocked: false,
        floorConfirmRequired: true,
        floorCategory: category,
        reason: `Always-confirm floor: "${category}" actions require explicit user confirmation before this call runs, in every autonomy mode.`,
      };
    }
  }
  return { blocked: false };
}

/**
 * The exact pair of pre-dispatch enforcement inputs a tool loop needs from a
 * chat turn — `route.userConstraints` and `route.alwaysConfirmFloor` — resolved
 * WITHOUT building the full (heavier) route and, crucially, WITHOUT the route's
 * "is this a computer task" null-gating.
 *
 * QW1: the always-confirm floor is policy, not preference. It must fire on a
 * bare "delete everything" turn that never matched a pipeline (where
 * `buildChatComputerRequestRoute` returns null) exactly as it does on a full
 * desktop/browser route. Parsed user "never do X" constraints are handled the
 * same way. So the loop calls THIS to feed `constraintBlocksToolCall`, rather
 * than reaching through a route object that may be null.
 *
 * Both fields degrade to their empty/absent form when the message carries no
 * constraint phrasing and no floor verb — the caller's per-block check then
 * short-circuits to a no-op (see `hasChatComputerConstraintInputs`).
 */
export interface ChatComputerConstraintInputs {
  userConstraints: ChatComputerUserConstraints | null;
  alwaysConfirmFloor: ChatComputerConstraintCategory[];
}

export function resolveChatComputerConstraintInputs(
  message: string,
): ChatComputerConstraintInputs {
  return {
    userConstraints: parseChatComputerUserConstraints(message),
    alwaysConfirmFloor: detectAlwaysConfirmFloorCategories(message),
  };
}

/**
 * True when either enforcement input is present — lets the loop skip the
 * per-block `constraintBlocksToolCall` entirely on ordinary no-constraint,
 * no-floor turns (the common case), keeping the hot path allocation-free.
 */
export function hasChatComputerConstraintInputs(
  inputs: ChatComputerConstraintInputs | null | undefined,
): boolean {
  if (!inputs) return false;
  return Boolean(inputs.userConstraints?.forbidden.length) || inputs.alwaysConfirmFloor.length > 0;
}

/** Compact prompt lines for the constraints — injected as hard rules. */
export function formatChatComputerUserConstraintsPromptLines(
  constraints: ChatComputerUserConstraints | null | undefined,
): string[] {
  if (!constraints) return [];
  const lines: string[] = [];
  if (constraints.forbidden.length) {
    lines.push(`User constraint (HARD): never perform ${constraints.forbidden.join(', ')} actions in this task — stop and report instead.`);
  }
  if (constraints.approvalBefore.length) {
    lines.push(`User constraint: ask the user before any ${constraints.approvalBefore.join(', ')} action, even if the route is otherwise approved.`);
  }
  if (constraints.stopConditions.length) {
    lines.push(`User constraint: stop and hand back to the user if the task hits: ${constraints.stopConditions.join(', ')}.`);
  }
  return lines;
}

export interface ChatComputerUsePolicyInputs {
  userConstraints: string[];
  alwaysConfirmCategories: Array<
    'opaque_target'
    | 'credentials'
    | 'external_side_effect'
  >;
}

/**
 * Preserve the chat router's deterministic constraint/floor analysis when a
 * browser task crosses into the cloud Computer Use loop.
 *
 * Native Computer Use actions identify targets by coordinates/current focus,
 * so every run carries `opaque_target`. The coarser edge categories are an
 * additional fail-closed floor; the bounded user-authored constraint lines
 * remain the source-of-truth context for the exact run.
 */
export function buildChatComputerUsePolicyInputs(
  message: string,
  options?: { booking?: boolean },
): ChatComputerUsePolicyInputs {
  const inputs = resolveChatComputerConstraintInputs(message);
  const categories = new Set<ChatComputerUsePolicyInputs['alwaysConfirmCategories'][number]>([
    'opaque_target',
  ]);
  const constraintCategories = [
    ...(inputs.userConstraints?.forbidden || []),
    ...(inputs.userConstraints?.approvalBefore || []),
  ];
  if (
    inputs.alwaysConfirmFloor.includes('login')
    || constraintCategories.includes('login')
  ) {
    categories.add('credentials');
  }
  if (
    options?.booking
    || inputs.alwaysConfirmFloor.length > 0
    || constraintCategories.length > 0
  ) {
    categories.add('external_side_effect');
  }
  return {
    userConstraints: formatChatComputerUserConstraintsPromptLines(inputs.userConstraints),
    alwaysConfirmCategories: Array.from(categories),
  };
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
  // Rescue browser-operation phrasings from being mistaken for "build a page"
  // chit-chat: operating a page (book/reserve/log in/navigate/scrape …) is a
  // browser task, not a build request. The added verbs are chosen to not
  // substring-collide with build nouns ("booking page", "navigation menu").
  return !/\b(browser|desktop|computer|app|application|window|file|folder|shopify|wordpress|wp[-\s]?admin|wp[-\s]?login|admin|webflow|wix|squarespace|open|launch|click|type|press|fill|upload|download|export|use computer|book|reserve|purchase|navigate|scrape|visit|go ?to|log ?in(?:to)?|sign ?in(?:to)?)\b/i.test(message);
}

function isSimpleWordpressConversationalIntent(message: string, pipeline?: UserTaskPipelineSummary | null): boolean {
  if (pipeline?.id !== 'wordpress_cms' && !/\b(wordpress|wp|blog)\b/i.test(message)) return false;
  if (!/\b(post|publish|schedule|draft|list|show)\b/i.test(message)) return false;
  if (/\b(dealer\s+inspire|dealerinspire|di\s+slides?|di_slide|flavor_di_slides|sliders?|quick edit|expiration(?:_date)?|inventory|admin\.php|reload cache)\b/i.test(message)) return false;
  return !/\b(admin|log ?in|sign ?in|media library|upload|attach|download|export|desktop|file|image|product page|theme|dashboard|open|browser|use computer)\b/i.test(message);
}

function isWorkflowRecordingRequest(message: string): boolean {
  return /\b(record workflow|workflow recording|record and replay|replay workflow|saved workflow|automation template|macro|turn (?:this|these) .* into automation)\b/i.test(message)
    || /\b(record|capture|save)\b[\s\S]{0,120}\b(steps|workflow|process|routine|browser flow|desktop flow)\b/i.test(message)
    || /\b(replay|rerun|repeat|reuse)\b[\s\S]{0,120}\b(workflow|steps|process|task|routine|flow)\b/i.test(message);
}

function isWordPressAdminBrowserTask(message: string, strategy: ComputerAppTaskStrategy | null): boolean {
  if (!strategy?.label.includes('WordPress')) return false;
  return (
    /\b(log ?in|sign ?in|open|show|go ?to|install|activate|deactivate|configure|edit|update|change|upload|attach|create|add|remove|delete|trash|archive|publish|schedule|draft)\b/i.test(message) &&
    /\b(wordpress|wp[-\s]?admin|wp[-\s]?login|dashboard|admin|plugin|theme|customi[sz]er?|settings?|menus?|navigation|users?|roles?|permissions?|woocommerce|products?|orders?|coupons?|forms?|seo|cache|reload cache|media library|gutenberg|editor|pages?|posts?|dealer\s+inspire|dealerinspire|di\s+slides?|di_slide|flavor_di_slides|sliders?|quick edit|expiration(?:_date)?|inventory|admin\.php)\b/i.test(message)
  ) || detectWordPressTrashPostIntent(message);
}

/**
 * WI-6: transactional / travel-commerce web intent. Mirrors the transactional
 * pattern in `computerUseIntent.ts` ("book|order|buy|reserve|schedule … flight|
 * hotel|room|ticket|table|rental|appointment"), plus a browse/find variant
 * ("find|search|look up … hotel|flight|room … on <site>") so plain discovery
 * phrasing about bookable inventory routes to the browser. Verb-anchored and
 * paired with a bookable-noun so ordinary chit-chat ("book club", "buy-in") and
 * build requests ("booking page") don't over-trigger.
 */
const BOOKABLE_NOUN = /(flight|flights|hotel|hotels|motel|lodging|room|rooms|ticket|tickets|table|reservation|rental|rentals|car\s*rental|appointment|seat|seats|stay|cruise|tour|rid(?:e|es))/i
  .source;

// Bug #6: deliberation/modal frame directly ahead of a commerce/discovery verb
// ("should I book…", "wondering whether to buy…", "which is better to rent…").
// These are the user asking us to help them *decide*, not a command to launch a
// browser run. When such a frame precedes the transactional verb we bail out of
// `hasTransactionalWebIntent` on BOTH the imperative and discovery branches.
// Kept conservative: it only fires when the frame word sits within a short
// window before the verb, so genuine commands ("book me a hotel in Chicago",
// "go to marriott.com and book a hotel", "find me hotels … on marriott.com")
// have no deliberation frame and still return true.
const DELIBERATION_FRAMED_COMMERCE =
  /\b(should|shall|would|could|do|does|is\s+it\s+worth|whether\s+to|thinking\s+(?:of|about)|wondering\s+(?:if|whether)|help\s+me\s+decide|which\s+is\s+better)\b[\s\S]{0,40}?\b(book|order|buy|purchase|reserve|schedule|rent|find|search|compare)\b/i;

function hasTransactionalWebIntent(message: string): boolean {
  const text = String(message || '');
  // Deliberation questions ("should I book a hotel or an airbnb?") are requests
  // to help the user decide, not commands — never auto-launch a browser run.
  if (DELIBERATION_FRAMED_COMMERCE.test(text)) {
    return false;
  }
  // Imperative commerce verb + bookable noun: "book me a hotel", "reserve a table",
  // "order 2 tickets", "buy a plane ticket".
  if (new RegExp(`\\b(book|order|buy|purchase|reserve|reserving|schedule|rent)\\b[\\s\\S]{0,80}\\b${BOOKABLE_NOUN}\\b`, 'i').test(text)) {
    return true;
  }
  // Discovery verb + bookable noun ("find me hotels …", "search for flights …").
  if (new RegExp(`\\b(find|search|look\\s*up|show\\s*me|get\\s*me|compare)\\b[\\s\\S]{0,80}\\b${BOOKABLE_NOUN}\\b`, 'i').test(text)) {
    return true;
  }
  // Add-to-cart phrasing is inherently web-transactional — "add a phone
  // charger to my cart", "add it to the basket", "put X in my amazon cart".
  // (P23: "go to amazon and add X to my cart" previously fell to plain chat
  // because no commerce verb from the set above matched.)
  if (/\b(?:add|put|throw|drop)\b[\s\S]{0,80}\b(?:in|into|to)\s+(?:my\s+|the\s+)?(?:[a-z][a-z0-9 .-]{0,24}\s+)?(?:cart|basket|bag)\b/i.test(text)) {
    return true;
  }
  // Generic purchase verb + explicit site/URL ("buy a laptop stand on
  // amazon.com", "order X from bestbuy.com"). The site anchor keeps this from
  // over-triggering on conversational "buy" ("should I buy a house?").
  if (/\b(buy|order|purchase)\b[\s\S]{0,80}\b(?:on|from|at|via)\s+(?:(?:https?:\/\/|www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|amazon|ebay|walmart|etsy)\b/i.test(text)) {
    return true;
  }
  return false;
}

function hasExplicitWebsiteOperation(message: string): boolean {
  const text = String(message || '');
  return EXPLICIT_WEB_TARGET_RE.test(text)
    && /\b(?:browse|buy|click|download|fill|find|go\s+to|log\s*in|navigate|open|order|purchase|reserve|search|submit|upload|visit)\b/i.test(text);
}

/**
 * One strongly framed request to operate a named app. This intentionally does
 * not try to maintain a catalog of every desktop product: long-tail apps are
 * exactly where the generic desktop navigator is supposed to take over.
 * Browser products and web-only apps remain explicit browser requests.
 */
interface ExplicitNamedAppAction {
  appName: string;
  /** Bridge-observed exact identity for long-tail lowercase dispatch. */
  dispatchAppName?: string;
  surface: 'desktop_app' | 'browser' | 'local_file';
  intent: 'launch_or_read' | 'mutation';
}

const NAMED_APP_ACTION_VERB = '(?:accept|activate|add|adjust|animate|apply|authenticate|authorize|bring|browse|build|cancel|change|charge|check|choose|click|close|color|colour|complete|configure|confirm|connect|continue|copy|create|crop|delete|design|disconnect|dismiss|download|draw|edit|email|encode|enter|erase|export|fill|find|focus|generate|go|grant|import|inspect|insert|invite|launch|link|list|load|log\\s*in|login|look(?:\\s+at)?|make|maximize|minimize|model|move|mute|navigate|open|overwrite|package|paint|paste|pause|play|post|press|print|publish|put|read|record|remove|rename|render|replace|report|resize|resume|retouch|run|save|search|select|send|set|show|sign\\s*in|split|start|stop|submit|summari[sz]e|switch|sync|tell|toggle|trim|turn|type|unmute|update|upload|verify|view|visit|wipe|write)';
const NAMED_APP_COMMAND_LEAD = '(?:please\\s+)?(?:(?:(?:can|could|would|will)\\s+you(?:\\s+please)?(?:\\s+to)?|i\\s+(?:want|need|would\\s+like)\\s+you\\s+to)\\s+)?';
const NAMED_APP_PREFIX_RE = new RegExp(
  `^${NAMED_APP_COMMAND_LEAD}(?:use|open(?:\\s+up)?|launch|start|focus|switch(?:\\s+over)?\\s+to)\\s+(?:the\\s+)?(.{1,72}?)(?:\\s+(?:app|application|program))?(?:\\s*[,;:]\\s*|\\s+(?:and|to)\\s+)${NAMED_APP_ACTION_VERB}\\b`,
  'i',
);
const NAMED_APP_CONTEXT_RE = new RegExp(
  `^${NAMED_APP_COMMAND_LEAD}(?:in|inside|using|with)\\s+(?:the\\s+)?(.{1,72}?)(?:\\s+(?:app|application|program))?(?:\\s*[,;:]\\s*|\\s+to\\s+)${NAMED_APP_ACTION_VERB}\\b`,
  'i',
);
const IMPERATIVE_APP_ACTION_RE = new RegExp(`^${NAMED_APP_COMMAND_LEAD}${NAMED_APP_ACTION_VERB}\\b`, 'i');

function hasExplicitNamedAppFraming(message: string): boolean {
  const text = String(message || '').trim();
  return Boolean(parseStrictNamedAppLifecycleIntent(text))
    || NAMED_APP_PREFIX_RE.test(text)
    || NAMED_APP_CONTEXT_RE.test(text);
}

const GENERIC_NON_APP_TARGETS = new Set([
  'a browser', 'browser', 'the browser', 'a website', 'website', 'site', 'webpage', 'web page',
  'a file', 'file', 'folder', 'document', 'image', 'photo', 'video', 'audio', 'project', 'task',
  'computer', 'desktop', 'logic', 'reasoning', 'this', 'that', 'it', 'something', 'anything', 'any app',
]);

const BROWSER_APP_IDS = new Set(['chrome', 'safari']);
const LOCAL_FILE_APP_IDS = new Set(['finder', 'preview', 'textedit']);
const LOCAL_FILE_APP_NAMES = new Set(['finder', 'preview', 'apple preview', 'textedit', 'text edit']);
const BROWSER_APP_NAMES = new Set([
  'arc', 'arc browser', 'brave', 'brave browser', 'chrome', 'chromium', 'comet browser',
  'edge', 'firefox', 'google chrome', 'microsoft edge', 'opera', 'opera browser', 'orion',
  'safari', 'vivaldi', 'web browser', 'browser',
]);
const BROWSER_PLATFORM_NAMES = new Set([
  'bigcommerce', 'framer', 'google docs', 'google sheets', 'google slides', 'shopify',
  'squarespace', 'webflow', 'wix', 'woocommerce', 'wordpress', 'wordpress admin', 'wp admin',
]);
const SHORT_NATIVE_APP_NAMES = new Set(['mpv', 'obs', 'r', 'vlc', 'zed']);
const EXPLICIT_WEB_TARGET_RE = /\b(?:https?:\/\/|www\.)\S+|(?<!@)\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\.(?:com|org|net|io|app|dev|ai|co|us|gov|edu)(?:\/\S*)?/i;
const BROWSERBASE_DATA_SIDE_EFFECT_RE = /\b(?:authenticate|authorize|buy|checkout|delete|download|edit|export|fill|grant|log\s*in|login|order|pay|post|publish|purchase|remove|save|send|sign\s*in|submit|update|upload)\b/i;
const NAMED_APP_MUTATION_RE = /\b(?:accept|add|adjust|animate|apply|authenticate|authorize|build|cancel|change|charge|choose|click|close|color|colour|complete|configure|confirm|connect|continue|copy|create|crop|delete|design|disconnect|dismiss|download|draw|edit|email|encode|enter|erase|export|fill|generate|grant|import|insert|invite|link|log\s*in|login|make|maximize|minimize|model|move|mute|overwrite|package|paint|paste|pause|play|post|press|print|publish|put|record|remove|rename|render|replace|resize|resume|retouch|run|save|select|send|set|sign\s*in|split|stop|submit|sync|toggle|trim|turn|type|unmute|update|upload|wipe|write)\b/i;

function cleanNamedAppCandidate(value: string): string {
  return String(value || '')
    .replace(/^[\s'"`]+|[\s'"`]+$/g, '')
    .replace(/^an?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
}

function isLikelyNamedAppCandidate(value: string): boolean {
  const candidate = cleanNamedAppCandidate(value);
  if (!candidate) return false;
  const lower = candidate.toLowerCase();
  if (GENERIC_NON_APP_TARGETS.has(lower)) return false;
  // A filename/path between "Open" and the next action is a local artifact,
  // not an unfamiliar application name (for example, "Open image.png from
  // the Desktop and make it a jpg"). Let the direct-file planner own it.
  if (/\.(?:avif|bmp|csv|docx?|gif|heic|jpe?g|json|md|mov|mp3|mp4|pdf|png|psd|svg|tiff?|txt|wav|xlsx?)\b/i.test(candidate)) return false;
  if (/\bfrom\s+(?:the\s+)?(?:desktop|downloads?|documents?|folder|directory)\b/i.test(candidate)) return false;
  const words = candidate.split(/\s+/);
  if (words.length > 6) return false;
  if (!words.every((word) => /^[A-Za-z0-9][A-Za-z0-9+._'’-]*$/.test(word))) return false;
  if (words.length === 1 && candidate.length <= 3) {
    const shortName = candidate.toLowerCase();
    if (!findKnownAppInText(candidate) && !SHORT_NATIVE_APP_NAMES.has(shortName)) return false;
  }
  return candidate.length >= 2 || SHORT_NATIVE_APP_NAMES.has(candidate.toLowerCase());
}

function isAppGuidanceOrChoiceQuestion(message: string): boolean {
  const text = String(message || '').trim();
  return /^(?:should|would|could|can|may|might|do)\s+i\b/i.test(text)
    || /^(?:what|why|which|when|where)\b/i.test(text)
    || /^(?:is|are|does|do)\s+(?:the\s+)?[A-Za-z0-9][\s\S]{0,70}\?$/i.test(text);
}

function detectExplicitNamedAppAction(
  message: string,
  observedAppNames?: readonly string[],
): ExplicitNamedAppAction | null {
  const text = String(message || '').trim();
  if (!text || isAppGuidanceOrChoiceQuestion(text)) return null;

  const strictLifecycle = parseStrictNamedAppLifecycleIntent(text, { observedAppNames });
  const knownInMessage = findKnownAppInText(text);
  const framed = strictLifecycle
    ? null
    : text.match(NAMED_APP_PREFIX_RE)
      || text.match(NAMED_APP_CONTEXT_RE);
  const framedCandidate = strictLifecycle?.appName || cleanNamedAppCandidate(framed?.[1] || '');
  let candidate = framedCandidate;

  // A leading task verb plus a catalogued app also proves action intent:
  // "Edit the title slide in PowerPoint and save it". Unknown apps require
  // the stronger Use/Open/In framing above to avoid treating prose nouns as
  // application names.
  if (!candidate && knownInMessage && IMPERATIVE_APP_ACTION_RE.test(text)) {
    candidate = knownInMessage.app.displayName;
  }
  if (!isLikelyNamedAppCandidate(candidate)) return null;

  const knownCandidate = findKnownAppInText(candidate)?.app || matchKnownApp(candidate);
  const normalizedCandidate = candidate.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const localFileEvidenceText = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ');
  const framedCandidateIndex = framedCandidate
    ? text.toLowerCase().indexOf(framedCandidate.toLowerCase())
    : -1;
  const actionScope = framedCandidateIndex >= 0
    ? text.slice(framedCandidateIndex + framedCandidate.length)
    : text;
  const intent = strictLifecycle
    ? 'launch_or_read'
    : NAMED_APP_MUTATION_RE.test(actionScope) ? 'mutation' : 'launch_or_read';
  // A strict launch-only request names the installed native product even when
  // that product is a browser. URL/navigation/follow-up work still routes to
  // browser automation; web-only products can never enter native lifecycle.
  const strictNativeLifecycle = Boolean(strictLifecycle) && !knownCandidate?.webOnly;
  const browserSurface = Boolean(
    !strictNativeLifecycle
    && (
      knownCandidate?.webOnly
      || (knownCandidate && BROWSER_APP_IDS.has(knownCandidate.id))
      || BROWSER_APP_NAMES.has(normalizedCandidate)
      || BROWSER_PLATFORM_NAMES.has(normalizedCandidate)
      || /^(?:browser|web)\s+(?:computer\s+use\s+)?task\b/i.test(normalizedCandidate)
      || (!knownCandidate && EXPLICIT_WEB_TARGET_RE.test(text) && /\b(?:browse|go\s+to|navigate|open|visit)\b/i.test(text))
    ),
  );
  const localFileSurface = Boolean(
    (knownCandidate && LOCAL_FILE_APP_IDS.has(knownCandidate.id) || LOCAL_FILE_APP_NAMES.has(normalizedCandidate))
    && (
      /(?:~\/|\/Users\/|\b(?:desktop|downloads?|documents?|file|folder|directory)\b|\.[a-z0-9]{1,12}\b)/i.test(localFileEvidenceText)
      || (/\bpreview\b/i.test(normalizedCandidate) && /\b(?:document|page|pdf)\b/i.test(localFileEvidenceText))
    ),
  );
  return {
    appName: strictLifecycle?.appName || knownCandidate?.displayName || candidate,
    ...(strictLifecycle?.observedAppName ? { dispatchAppName: strictLifecycle.observedAppName } : {}),
    surface: browserSurface ? 'browser' : localFileSurface ? 'local_file' : 'desktop_app',
    intent,
  };
}

/**
 * Compile only the strict, single-intent named-app lifecycle grammar into a
 * local program. Requests that append inspection, interpretation, or any
 * mutation remain outside this compiler and keep their normal model/tool
 * route. This whitelist prevents an `aiNeed:none` route from accidentally
 * falling through to the SwanBot AI relay.
 */
export function buildDeterministicNamedAppLifecycleReadProgram(
  message: string,
  action: ExplicitNamedAppAction | null,
  observedAppNames?: readonly string[],
): ChatComputerDeterministicLifecycleReadProgram | null {
  const text = String(message || '').trim();
  const lifecycleIntent = parseStrictNamedAppLifecycleIntent(text, { observedAppNames });
  if (
    action?.surface !== 'desktop_app'
    || action.intent !== 'launch_or_read'
    || !lifecycleIntent
  ) return null;

  const exactNamedPhrase = lifecycleIntent.appName;
  const knownApp = matchKnownApp(exactNamedPhrase)
    || findKnownAppInText(action.appName)?.app
    || null;
  const dispatchAppName = String(
    knownApp ? resolveMacLaunchName(knownApp) : action.dispatchAppName || lifecycleIntent.observedAppName || action.appName,
  ).trim();
  if (
    !dispatchAppName
    || dispatchAppName.length > 120
    || !/^[A-Za-z0-9 .\-_()]+$/.test(dispatchAppName)
  ) return null;

  const operation = lifecycleIntent.operation;
  const observeStep = (note: string): ChatComputerDeterministicLifecycleReadStep => ({
    tool: 'desktop.observe_app',
    args: { appName: dispatchAppName, maxDepth: 1, maxNodes: 1 },
    when: 'always',
    note,
  });
  const steps: ChatComputerDeterministicLifecycleReadStep[] = [
    observeStep(`Observe ${exactNamedPhrase} process and foreground state before lifecycle dispatch.`),
    ...(operation === 'open_or_launch'
      ? [
          {
            tool: 'desktop.launch_app' as const,
            args: { appName: dispatchAppName },
            when: 'if_not_running' as const,
            note: `Launch ${exactNamedPhrase} only when the fresh observation reports it is not running.`,
          },
          {
            tool: 'desktop.wait_for_app' as const,
            args: { appName: dispatchAppName, timeoutMs: 8_000 },
            when: 'if_launched' as const,
            note: `Wait a bounded interval for ${exactNamedPhrase} only after launch.`,
          },
        ]
      : []),
    {
      tool: 'desktop.focus_app',
      args: { appName: dispatchAppName },
      when: 'if_not_frontmost',
      note: `Focus ${exactNamedPhrase} when it is running but not frontmost.`,
    },
    observeStep(`Verify ${exactNamedPhrase} is running and frontmost; otherwise return the exact local blocker.`),
  ];
  return {
    id: 'named_app_lifecycle_read',
    operation,
    // User-visible identity stays exactly as phrased. Catalog/bundle
    // canonicalization is confined to dispatchAppName below.
    targetAppName: exactNamedPhrase,
    dispatchAppName,
    authorization: {
      mode: 'direct_user_request',
      reason: 'The exact command authorizes only a reversible local app launch/focus plus read-only process and foreground verification.',
    },
    steps,
  };
}

const NAMED_APP_DESTRUCTIVE_RE = /\b(?:erase|wipe)\b|\b(?:delete|remove)\b[\s\S]{0,100}\b(?:forever|permanent(?:ly)?|irreversible|without\s+(?:undo|recovery)|cannot\s+be\s+undone)\b|\b(?:permanent(?:ly)?|forever)\b[\s\S]{0,80}\b(?:delete|erase|remove|wipe)\b/i;
const NAMED_APP_REMOTE_SIDE_EFFECT_RE = /\b(?:email|invite|post|publish|send|submit|upload)\b[\s\S]{0,120}\b(?:account|alert|announcement|customer|message|person|response|report|team|update|workspace)\b/i;
const NAMED_APP_CREDENTIAL_OR_GRANT_RE = /\b(?:authenticate|authorize|connect|credentials?|grant|link|log\s*in|login|oauth|password|permission|sign\s*in|consent)\b/i;

function normalizeNamedDesktopRisk(
  message: string,
  action: ExplicitNamedAppAction | null,
  baselineRisk: UserTaskPipelineRisk,
): UserTaskPipelineRisk {
  if (action?.surface === 'local_file') {
    if (baselineRisk === 'destructive' || baselineRisk === 'external_side_effect') return baselineRisk;
    return action.intent === 'launch_or_read' ? 'safe' : maxRisk(baselineRisk, 'review');
  }
  if (action?.surface !== 'desktop_app') return baselineRisk;
  if (NAMED_APP_DESTRUCTIVE_RE.test(message)) return 'destructive';
  if (NAMED_APP_REMOTE_SIDE_EFFECT_RE.test(message)) return 'external_side_effect';
  if (action.intent === 'launch_or_read') return 'safe';
  // Credential and grant tasks keep any stronger classification while their
  // non-grantable login/grant floor owns the mandatory confirmation.
  if (NAMED_APP_CREDENTIAL_OR_GRANT_RE.test(message)) return maxRisk(baselineRisk, 'review');
  // Named-app field/menu/toggle/dialog/canvas/timeline edits are local. Some
  // broad keyword pipelines label "confirm", "track", or "response" as an
  // external side effect; cap those false positives at review unless an
  // explicit remote or destructive verb above proved the stronger boundary.
  return 'review';
}

function explicitComputerSurfaceRequested(
  message: string,
  preview: ComputerTaskPlanPreview,
  strategy: ComputerAppTaskStrategy | null,
  designPipeline: DesignAppExecutionPipelinePlan | null,
  namedAppAction: ExplicitNamedAppAction | null = null,
): boolean {
  if (namedAppAction) return true;
  if (preview.kind !== 'unknown') return true;
  if (classifyBrowserbaseWorkflow(message).kind !== 'general_browser') return true;
  if (designPipeline) return true;
  // WI-6: URL-less (or plain-web) transactional booking/shopping intent routes
  // to the browser even without an explicit "use computer / open browser"
  // surface verb. Mirrors computerUseIntent.ts's transactional pattern
  // (book|order|buy|reserve|schedule|find|search … flight|hotel|room|ticket|…)
  // so "find me hotels in chicago this weekend on marriott.com" and
  // "book me a hotel in chicago" reach the browser runtime (both verified null
  // before this). Independent of `strategy` so pure discovery phrasings that
  // resolve no app strategy still route.
  if (hasTransactionalWebIntent(message)) return true;
  if (!strategy) return false;
  if (isWordPressAdminBrowserTask(message, strategy)) return true;
  return /\b(use|open|launch|focus|control|drive|automate|take over|click|type|paste|press|select|choose|fill|set|create|make|build|edit|update|change|replace|export|save|render|encode|package)\b[\s\S]{0,160}\b(app|application|desktop|computer|browser|website|site|page|window|file|folder|photoshop|indesign|illustrator|figma|canva|autocad|solidworks|fusion\s*360|matlab|simulink|ableton|slack|notion|mail|calendar|shopify|webflow|wix|wordpress)\b/i.test(message)
    || /\b(?:in|inside|on|with|using)\s+(?:the\s+)?(?:[A-Za-z][A-Za-z0-9._+-]{1,40}(?:\s+[A-Za-z0-9][A-Za-z0-9._+-]{1,40}){0,4})\s+(?:app|application|window|program)\b/i.test(message);
}

function isStagedBrowserFileTransferIntoDesktopApp(
  message: string,
  strategy: ComputerAppTaskStrategy | null,
): boolean {
  if (strategy?.id !== 'browser_file_transfer') return false;
  const text = String(message || '');
  if (!/\b(download|export|save|retrieve|get|pull)\b[\s\S]{0,220}\b(?:then|and then|after that)\b[\s\S]{0,180}\b(import|open|load|place|insert|bring)\b/i.test(text)) {
    return false;
  }
  if (/\b(wordpress|wp[-\s]?admin|shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|admin|website|webpage|browser)\b[\s\S]{0,120}\b(import|upload|attach|media library)\b/i.test(text)) {
    return false;
  }
  return /\b(?:into|in|inside|with|using)\s+(?:the\s+)?(?:(?:spreadsheet|excel|numbers|matlab|simulink|autocad|solidworks|fusion\s*360|photoshop|illustrator|indesign|figma|canva|acrobat|word|pages|keynote|powerpoint)\b|(?:[A-Za-z][A-Za-z0-9._+-]{1,40}(?:\s+[A-Za-z0-9][A-Za-z0-9._+-]{1,40}){0,4})\s+(?:app|application|desktop app|program|window)\b)/i.test(text);
}

function resolveKind(
  preview: ComputerTaskPlanPreview,
  strategy: ComputerAppTaskStrategy | null,
  designPipeline: DesignAppExecutionPipelinePlan | null,
  message: string,
): ChatComputerRequestRouteKind {
  if (strategy?.id === 'agent_asset_acquisition') return 'agent_buildout';
  if (designPipeline || (strategy && APP_STRATEGIES.has(strategy.id))) return 'desktop_app';
  if (strategy && BROWSER_STRATEGIES.has(strategy.id)) return 'browser';
  if (strategy && FILE_STRATEGIES.has(strategy.id)) return 'local_file';
  if (preview.kind === 'hybrid_task') return 'hybrid';
  if (preview.kind === 'app_task') return 'desktop_app';
  if (preview.kind === 'file_task') return 'local_file';
  if (preview.kind === 'browser_task') return 'browser';
  // WI-6: URL-less transactional booking/shopping phrasings the planner leaves
  // `unknown` ("book me a hotel in chicago", "find me hotels … on marriott.com")
  // are web tasks — route them to the browser runtime (not the hybrid fallback)
  // so the zero-tap browser path and WI-2 mid-run payment floor apply.
  if (preview.kind === 'unknown' && !strategy && hasTransactionalWebIntent(message)) return 'browser';
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
    : kind === 'browser'
      ? ['browser.open_url', 'browser.dom_snapshot', 'browser.click_role', 'browser.fill_field']
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

const DESKTOP_NATIVE_PIPELINE_IDS = new Set<UserTaskPipelineId>([
  'desktop_app_control',
  'creative_layout_design',
  'adobe_creative_cloud',
  'terminal_agents',
]);

const NAMED_DESKTOP_BASE_TOOLS = [
  'desktop.list_running_apps',
  'desktop.launch_app',
  'desktop.wait_for_app',
  'desktop.window_state',
  'desktop.read_a11y_tree',
  'desktop.menu_click',
  'desktop.click_element',
  'desktop.set_element_value',
  'desktop.press_keys',
  'desktop.type_text',
  'desktop.screenshot',
  'tools.search',
  'research.search',
  'fetch_url',
  'agent.build_app_capability',
];

const NAMED_DESKTOP_READ_TOOLS = [
  'desktop.app_reachability',
  'desktop.observe_app',
  'desktop.list_running_apps',
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.wait_for_app',
  'desktop.window_state',
  'desktop.read_a11y_tree',
  'desktop.menu_inventory',
  'desktop.screenshot',
  'desktop.screen_size',
];

function namedDesktopReadToolsFor(appName: string): string[] {
  return uniqueStrings([
    ...NAMED_DESKTOP_READ_TOOLS,
    /photoshop/i.test(appName) ? 'desktop.photoshop_document_status' : null,
    /indesign/i.test(appName) ? 'desktop.indesign_document_status' : null,
  ]);
}

function isBrowserExecutionTool(tool: string): boolean {
  return /^(?:browser|browserbase)\./i.test(String(tool || ''))
    || /^capability\.browser(?:_|\b)/i.test(String(tool || ''));
}

function requestHasExplicitLocalArtifact(message: string): boolean {
  return /(?:^|\s)(?:~\/|\/Users\/|\/[A-Za-z0-9._-]+\/)|\b(?:downloads?|documents?|files?|folders?|directory|path|local computer|hard drive|finder|desktop folder)\b|\.(?:avif|bmp|csv|docx?|gif|heic|jpe?g|json|md|mov|mp3|mp4|pdf|png|psd|psb|svg|tiff?|txt|wav|webp|xlsx?)\b/i.test(String(message || ''));
}

/**
 * A named native app must enter the desktop execution profile even when a
 * generic visual/file classifier happened to rank a web or local-file
 * pipeline first. Keep genuinely native specialist profiles (Adobe/design,
 * terminal) but replace browser/file profiles with the universal desktop
 * control loop and strip browser executable tools.
 */
function buildNamedDesktopPipelineSummary(input: {
  appName: string;
  base: UserTaskPipelineSummary;
  risk: UserTaskPipelineRisk;
  confidence: number;
  intent: ExplicitNamedAppAction['intent'];
}): UserTaskPipelineSummary {
  if (input.intent === 'launch_or_read') {
    return {
      id: 'desktop_app_control',
      title: `${input.appName} Launch And Read`,
      category: 'desktop',
      routeId: null,
      executionKind: 'run_computer_task',
      risk: input.risk,
      confidence: Number(Math.max(input.base.confidence, input.confidence).toFixed(2)),
      recommendedTools: namedDesktopReadToolsFor(input.appName),
      executionRequirements: [
        `local desktop bridge able to launch, focus, wait for, and observe ${input.appName}`,
        `exact ${input.appName} process/window identity before returning state`,
      ],
      solutionSteps: [
        `Observe whether ${input.appName} is running and identify its window.`,
        `Launch ${input.appName} only when it is not already running, then wait until it is ready.`,
        'Return only the requested app-native, window, accessibility, menu, or visible state.',
      ],
      completionCriteria: [
        `${input.appName} is running/focused as requested and the requested read-only state is returned, or an exact blocker is reported`,
      ],
      approvalTriggers: [],
      persistenceTargets: ['computer_task_state', 'run_ledger', 'chat_message'],
    };
  }
  const keepNativeProfile = DESKTOP_NATIVE_PIPELINE_IDS.has(input.base.id);
  const recommendedTools = uniqueStrings([
    ...NAMED_DESKTOP_BASE_TOOLS,
    ...(input.base.recommendedTools || []).filter((tool) => !isBrowserExecutionTool(tool)),
  ]).slice(0, 20);

  if (keepNativeProfile) {
    return {
      ...input.base,
      category: 'desktop',
      routeId: null,
      executionKind: 'run_computer_task',
      risk: maxRisk(input.base.risk, input.risk),
      confidence: Number(Math.max(input.base.confidence, input.confidence).toFixed(2)),
      recommendedTools,
    };
  }

  return {
    id: 'desktop_app_control',
    title: `${input.appName} Desktop App Control`,
    category: 'desktop',
    routeId: null,
    executionKind: 'run_computer_task',
    risk: input.risk,
    confidence: Number(input.confidence.toFixed(2)),
    recommendedTools,
    executionRequirements: [
      `local desktop bridge able to launch and observe ${input.appName}`,
      'fresh running-app, window, and accessibility state before mutation',
      'app-native API, script, command, menu, or semantic control when available',
    ],
    solutionSteps: [
      `Observe whether ${input.appName} is running and identify its active window/document.`,
      `Launch ${input.appName} only when it is not already running, then wait until it is ready.`,
      'Inspect app-native state or the accessibility tree before choosing a control.',
      'Perform the smallest requested semantic action; refresh observation after any failed action before one bounded retry.',
      'Verify the changed app state or output artifact before reporting completion.',
      'If the app lacks a safe control surface, research official docs and build one reusable capability for the exact missing step.',
    ],
    completionCriteria: [
      `the requested result is verified in ${input.appName}, or an exact install/license/permission/control blocker is reported`,
    ],
    approvalTriggers: (input.base.approvalTriggers || []).length
      ? input.base.approvalTriggers.slice(0, 8)
      : ['desktop document mutation, save, export, overwrite, delete, send, publish, upload, or new script/plugin execution'],
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
  if (detectWordPressTrashPostIntent(input.message)) return maxRisk(input.selectedPipeline?.risk, 'external_side_effect');
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
  if (input.kind === 'local_file' && hasLocalFileMutationIntent(input.message)) return maxRisk(input.selectedPipeline?.risk, 'review');
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

/**
 * WI-2: A browser route whose commit step is a *plain-web* transaction or
 * upload (browse/book/buy/upload on a public site) defers its single
 * side-effect confirm to the exact mid-run tool call, so the route no longer
 * stops the user up front.
 * Credentialed website-admin routes (WordPress/Dealer Inspire admin, other
 * login-gated platform control) and desktop mutations are explicitly excluded
 * so their route-level approval checkpoint survives — the credential/login
 * floor and admin-mutation gates stay put.
 */
export function isCredentialedWebsiteAdminRoute(
  strategy: ComputerAppTaskStrategy | null,
  message: string,
): boolean {
  // `credentialed_browser` is the login-walled platform-control strategy
  // (WordPress/CMS admin, form-submission-behind-login). It keeps its up-front
  // approval checkpoint. `approval_sensitive_browser` (travel_booking,
  // procurement_shopping, support/finance/social) is a *plain-web* commit
  // category — it is exactly the booking/shopping flow WI-2 makes zero-tap, so
  // it is NOT excluded here; its single commit fires mid-run at the payment
  // floor, and any actual login step trips the login floor separately.
  if (strategy?.id === 'credentialed_browser') return true;
  if (isWordPressAdminBrowserTask(message, strategy)) return true;
  return false;
}

/**
 * WI-2: which floor categories, when detected in the route text, still force a
 * route-level `required=true` for a *browser* route. The pay floor
 * (pay/purchase/buy/checkout/charge) is deliberately absent: for browser routes
 * it enforces per-step via `constraintBlocksToolCall` at the mid-run payment
 * floor instead of stopping the user before the run starts. login/grant (the
 * credential floor) and delete (permanent destruction) still stop up front on
 * every route, including browser.
 */
const BROWSER_ROUTE_LEVEL_FLOOR_CATEGORIES = new Set<ChatComputerConstraintCategory>([
  'login',
  'grant',
  'delete',
]);

function buildApproval(input: {
  message: string;
  risk: UserTaskPipelineRisk;
  kind: ChatComputerRequestRouteKind;
  strategy: ComputerAppTaskStrategy | null;
  userConstraints?: ChatComputerUserConstraints | null;
  alwaysConfirmFloor?: ChatComputerConstraintCategory[];
  stickyScopes?: StickyAllowScope[] | null;
  taskTargets?: StickyScopeTaskTarget | null;
  requestedCategories?: ChatComputerConstraintCategory[];
  /**
   * A compiler-owned program whose complete effect is one new unsaved local
   * draft. The current direct user command is sufficient authority only after
   * destructive floors and explicit ask-before constraints are checked.
   */
  directUserAuthorizedLocalDraft?: boolean;
}): { required: boolean; reason: string | null; stickyApplied: StickyScopeAppliedSummary | null } {
  // T7 UX sticky-grant candidate — computed BEFORE the floor check so the
  // floor (and destructive risk, explicit "ask me" intent, and user
  // ask-before constraints) still override it: a candidate only downgrades
  // approval in the eligible branches below the hard gates. Eligibility:
  // the task's target site/app matches an unexpired, unrevoked scope and
  // that scope covers ALL detected non-floor approval-driving categories.
  const stickyApplied: StickyScopeAppliedSummary | null = (() => {
    const scopes = input.stickyScopes || [];
    if (!scopes.length) return null;
    if (input.risk === 'destructive') return null;
    if (input.alwaysConfirmFloor?.length) return null;
    if (input.userConstraints?.approvalBefore.length) return null;
    if (hasExplicitApprovalIntent(input.message)) return null;
    if (input.strategy?.id === 'agent_asset_acquisition' || input.kind === 'agent_buildout') return null;
    const application = applyStickyScopes(scopes, input.taskTargets || {}, input.requestedCategories || []);
    if (application.usedScopeIds.length === 0 || application.stillRequired.length > 0) return null;
    const scope = scopes.find((item) => item.id === application.usedScopeIds[0]);
    if (!scope) return null;
    return {
      scopeId: scope.id,
      scopeKey: scope.scopeKey,
      scopeKind: scope.scopeKind,
      categories: application.autoApproved,
    };
  })();

  if (input.risk === 'destructive') {
    return { required: true, reason: 'The request includes destructive computer/app actions.', stickyApplied: null };
  }
  // WI-2: a plain-web browser route defers its single commit confirm to the
  // exact mid-run tool call. Upload joins the existing booking/purchase path:
  // `browser.upload_file` is itself approvalMode:'ask', so a route-level gate
  // would ask twice. Credentialed website-admin routes and non-browser routes
  // are excluded so their up-front approval checkpoint survives.
  const browserRouteDefersFloor = input.kind === 'browser'
    && !isCredentialedWebsiteAdminRoute(input.strategy, input.message)
    && (
      hasTransactionalWebIntent(input.message)
      || Boolean(input.alwaysConfirmFloor?.includes('pay'))
      || Boolean(input.requestedCategories?.includes('upload'))
    );
  // T7 floor: checked before every downgrade path (low-risk exports,
  // read-only routing, autonomy, sticky grants) so nothing below can return
  // required=false for a delete/login/grant task. Not user-disableable
  // by design — a sticky scope can never carry or cover floor categories.
  //
  // WI-2: for browser routes, the PAY floor (pay/purchase/buy/checkout/charge)
  // no longer forces a route-level stop — it is still stamped onto
  // `route.alwaysConfirmFloor` (see caller) so `constraintBlocksToolCall`
  // enforces it per-step at the actual payment submission. login/grant/delete
  // floor categories still stop up front on every route.
  if (input.alwaysConfirmFloor?.length) {
    const enforcingFloor = browserRouteDefersFloor
      ? input.alwaysConfirmFloor.filter((category) => BROWSER_ROUTE_LEVEL_FLOOR_CATEGORIES.has(category))
      : input.alwaysConfirmFloor;
    if (enforcingFloor.length) {
      return {
        required: true,
        reason: `Always-confirm policy: ${enforcingFloor.join(', ')} actions need explicit user confirmation in every mode.`,
        stickyApplied: null,
      };
    }
  }
  if (input.userConstraints?.approvalBefore.length) {
    return {
      required: true,
      reason: `The user asked to be checked with before: ${input.userConstraints.approvalBefore.join(', ')}.`,
      stickyApplied: null,
    };
  }
  if (hasExplicitApprovalIntent(input.message)) {
    return { required: true, reason: 'The user explicitly requested approval before execution.', stickyApplied: null };
  }
  if (input.risk === 'external_side_effect') {
    // WI-2: a plain-web browser route (book/order/upload) does not stop the
    // user up front for external side effects — its single commit confirmation
    // fires on the exact mutating tool call. The pay floor is enforced by
    // `constraintBlocksToolCall`; upload is enforced by browser.upload_file's
    // approvalMode:'ask' runtime policy. Credentialed website-admin routes and
    // desktop/app routes still require route-level approval here.
    if (browserRouteDefersFloor) {
      return { required: false, reason: 'exact browser commit step is confirmation-gated mid-run', stickyApplied };
    }
    if (stickyApplied) return { required: false, reason: null, stickyApplied };
    return { required: true, reason: 'The selected computer/browser path can affect external systems or user files.', stickyApplied: null };
  }
  if (
    input.directUserAuthorizedLocalDraft
    && input.kind === 'desktop_app'
    && input.risk === 'review'
  ) {
    return { required: false, reason: null, stickyApplied: null };
  }
  if (input.kind === 'local_file' && isLowRiskLocalImageExportTask(input.message)) {
    return { required: false, reason: null, stickyApplied: null };
  }
  if (input.strategy?.id === 'agent_asset_acquisition' || input.kind === 'agent_buildout') {
    return { required: true, reason: 'Connected-agent asset acquisition can download, generate, install, or write local files.', stickyApplied: null };
  }
  if (input.risk === 'review' && input.kind === 'local_file' && hasLocalFileMutationIntent(input.message)) {
    if (stickyApplied) return { required: false, reason: null, stickyApplied };
    return { required: true, reason: 'Local file changes require approval before execution.', stickyApplied: null };
  }
  if (input.risk === 'review' && (input.kind === 'desktop_app' || input.kind === 'hybrid')) {
    if (stickyApplied) return { required: false, reason: null, stickyApplied };
    return { required: true, reason: input.strategy?.approvalCheckpoints[0] || 'Desktop/app control requires user-visible approval before mutation.', stickyApplied: null };
  }
  return { required: false, reason: null, stickyApplied: null };
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

function firstTool(tools: string[], candidates: string[]): string | null {
  return candidates.find((tool) => tools.includes(tool)) || null;
}

function inferLocalFileActionToolFromMessage(message: string, tools: string[]): string | null {
  const text = String(message || '');
  const candidates: Array<[string, RegExp]> = [
    ['desktop.file_write_text', /\b(?:write|save|create|make)\b[\s\S]{0,140}\b(?:text\s+file|file|txt|markdown|md)\b/i],
    ['desktop.file_write_text', /\b(?:called|named)\s+[^.]+\.(?:txt|md|json|csv)\b[\s\S]{0,120}\b(?:with|containing|that says|saying)\b/i],
    ['desktop.file_mkdir', /\b(?:create|make|new)\b[\s\S]{0,80}\b(?:folder|directory)\b/i],
    ['desktop.file_copy', /\b(?:copy|duplicate|make a copy of)\b/i],
    ['desktop.file_trash', /\b(?:delete|remove|trash|move\s+[\s\S]{1,120}\s+to\s+trash)\b/i],
    ['desktop.file_rename', /\b(?:rename|change)\b[\s\S]{0,140}\b(?:to|as)\b/i],
  ];
  return candidates.find(([tool, pattern]) => tools.includes(tool) && pattern.test(text))?.[0] || null;
}

function inferLocalFileReadToolFromMessage(message: string, tools: string[]): string | null {
  const text = String(message || '');
  const candidates: Array<[string, RegExp]> = [
    ['desktop.open_path', /\b(?:open|show|preview|view|reveal|browse|display)\b[\s\S]{0,160}\b(?:~\/|\/Users\/|\/|desktop|downloads?|documents?|pictures?|photos|finder|preview|textedit|\.[A-Za-z0-9]{1,12}\b)/i],
    ['desktop.file_read', /\b(?:read|summari[sz]e|inspect)\b[\s\S]{0,140}\b(?:~\/|\/Users\/|\/|file|document|txt|md|json|csv|pdf|\.[A-Za-z0-9]{1,12}\b)/i],
    ['desktop.file_list', /\b(?:list|browse|show)\b[\s\S]{0,120}\b(?:files?|folders?|directory|desktop|downloads?|documents?|pictures?|photos)\b/i],
  ];
  return candidates.find(([tool, pattern]) => tools.includes(tool) && pattern.test(text))?.[0] || null;
}

function inferBrowserSemanticActionToolFromMessage(message: string, tools: string[]): string | null {
  const text = String(message || '');
  const candidates: Array<[string, RegExp]> = [
    ['browser.set_toggle', /\b(?:check|choose|select|toggle|turn\s+(?:on|off)|uncheck)\b[\s\S]{0,100}\b(?:checkbox|dark\s+mode|dropdown|option|radio|setting|switch|theme)\b/i],
    ['browser.fill_field', /\b(?:enter|fill|paste|search\s+for|type|write)\b/i],
    ['browser.click_role', /\b(?:click|open|press|select)\b[\s\S]{0,120}\b(?:button|link|menu|tab)\b/i],
    ['browser.dom_snapshot', /\b(?:extract|inspect|list|read|report|show|summari[sz]e|tell\s+me|view)\b/i],
  ];
  return candidates.find(([tool, pattern]) => tools.includes(tool) && pattern.test(text))?.[0] || null;
}

function inferWordPressActionToolFromMessage(message: string, tools: string[]): string | null {
  const text = String(message || '');
  const contentMutation = /\b(?:post|page|blog|article|draft|publish|schedule|slug|excerpt|featured image|featured media|content|title|di\s+slides?|di_slide|flavor_di_slides|slide|slider|expiration(?:_date)?|quick edit|menu order|media library|attach|upload)\b/i.test(text);
  const adminUiOnly = /\b(?:open|log\s*in|sign\s*in|dashboard|wp-admin|plugin|plugins|theme|themes|customi[sz]er|settings?|users?|roles?|editor user|woocommerce|product price|site title|menu|menus|forms?|gravity forms?|cache|reload cache)\b/i.test(text)
    && !/\b(?:post|page|blog|article|di\s+slides?|di_slide|flavor_di_slides|slide|slider|expiration(?:_date)?|featured image|featured media|attach|upload)\b/i.test(text);

  if (tools.includes('wp.trash_post') && /\b(?:trash|delete|remove|archive)\b/i.test(text) && contentMutation) return 'wp.trash_post';
  if (tools.includes('wp.create_slide') && /\b(?:create|add|new|draft)\b[\s\S]{0,120}\b(?:di\s+slides?|di_slide|flavor_di_slides|slide)\b/i.test(text)) return 'wp.create_slide';
  if (tools.includes('wp.upload_media') && /\b(?:upload|attach|media library|featured image|featured media)\b/i.test(text)) return 'wp.upload_media';
  if (tools.includes('wp.update_post') && contentMutation && !adminUiOnly) return 'wp.update_post';
  if (tools.includes('browser.upload_file') && /\b(?:upload|attach|choose file|select file)\b/i.test(text)) return 'browser.upload_file';
  if (
    tools.includes('browser.set_toggle')
    && /\b(?:check|uncheck|checkbox|toggle|switch|turn (?:on|off)|enable|disable|opt (?:in|out)|radio)\b/i.test(text)
  ) {
    return 'browser.set_toggle';
  }
  // A toggle is safe only when the user's wording proves a toggle-shaped
  // target. Do not let catalog ordering turn every generic admin mutation
  // (text fields, buttons, plugin actions) into a fabricated checkbox.
  return firstTool(tools, ['browser.click_role', 'browser.fill_field', 'browser.set_toggle']);
}

function buildActionItem(args: {
  id: string;
  surface: ChatComputerRequestActionSurface;
  tool: string;
  label: string;
  proof?: string | null;
  requiresApproval?: boolean;
}): ChatComputerRequestActionItem {
  return {
    id: args.id,
    surface: args.surface,
    tool: args.tool,
    label: args.label.slice(0, 180),
    proof: args.proof ? args.proof.slice(0, 180) : null,
    ...(args.requiresApproval ? { requiresApproval: true } : {}),
  };
}

function addUniqueActionItem(
  items: ChatComputerRequestActionItem[],
  item: ChatComputerRequestActionItem | null,
): void {
  if (!item) return;
  if (items.some((existing) => existing.id === item.id || (existing.tool === item.tool && existing.label === item.label))) return;
  items.push(item);
}

function buildChatComputerRequestActionItems(route: ChatComputerRequestRoute): ChatComputerRequestActionItem[] {
  const tools = route.recommendedTools || [];
  const proof = route.completionProof || [];
  const items: ChatComputerRequestActionItem[] = [];
  const exactProgram = compileComputerSequenceProgram(route.sourceMessage);
  const readOnlyDesktopRoute = route.kind === 'desktop_app'
    && !route.approvalRequired
    && (
      route.appAutomationRouteDecision?.taskFamily === 'app launch/read observation'
      || /\bLaunch And Read$/i.test(route.selectedPipeline?.title || '')
      || classifyGenericAppTaskFamily(route.sourceMessage || '') === 'launch_or_read'
    );

  if (exactProgram?.id === 'photoshop_new_document') {
    return exactProgram.steps.map((step, index) => {
      const isFinalStatus = step.tool === 'desktop.photoshop_document_status'
        && index === exactProgram.steps.length - 1;
      return buildActionItem({
        id: `exact-${index + 1}-${step.tool.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        surface: isFinalStatus ? 'verification' : 'desktop_app',
        tool: step.tool,
        label: step.note,
        proof: isFinalStatus
          ? route.evidenceContract?.proofAfter?.[0] || 'Final Photoshop document status with exact dimensions.'
          : step.tool === 'desktop.photoshop_create_document'
            ? 'App-native receipt for the directly requested unsaved blank document.'
            : 'App-native Photoshop status/launch receipt.',
      });
    });
  }

  if (route.deterministicLifecycleReadProgram) {
    const program = route.deterministicLifecycleReadProgram;
    return program.steps.map((step, index) => {
      const isFinalObservation = step.tool === 'desktop.observe_app'
        && index === program.steps.length - 1;
      return buildActionItem({
        id: `lifecycle-${index + 1}-${step.tool.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        surface: isFinalObservation ? 'verification' : 'desktop_app',
        tool: step.tool,
        label: step.note,
        proof: isFinalObservation
          ? route.evidenceContract?.proofAfter?.[0] || `Fresh ${program.targetAppName} process and foreground proof.`
          : `Bounded ${program.targetAppName} lifecycle receipt (${step.when}).`,
      });
    });
  }

  if (route.kind === 'local_file') {
    if (tools.includes('desktop.file_search')) {
      addUniqueActionItem(items, buildActionItem({
        id: 'resolve-source-file',
        surface: 'local_file',
        tool: 'desktop.file_search',
        label: 'Resolve the exact source file from the user phrase before doing anything else.',
        proof: 'Source basename and matched path identity.',
      }));
    }
    if (tools.includes('desktop.file_stat')) {
      addUniqueActionItem(items, buildActionItem({
        id: 'stat-source-file',
        surface: 'local_file',
        tool: 'desktop.file_stat',
        label: 'Confirm the source file exists and capture size/modified metadata.',
        proof: 'Source file_stat result.',
      }));
    }
    if (tools.includes('desktop.convert_image')) {
      addUniqueActionItem(items, buildActionItem({
        id: 'convert-image-format',
        surface: 'local_file',
        tool: 'desktop.convert_image',
        label: 'Convert the resolved image directly with the bridge, avoiding Photoshop or Preview save dialogs.',
        proof: 'Output path, format, and byte size.',
      }));
    } else {
      const fileMutationTool = inferLocalFileActionToolFromMessage(route.sourceMessage || '', tools);
      const fileReadTool = inferLocalFileReadToolFromMessage(route.sourceMessage || '', tools);
      if (fileMutationTool) {
        addUniqueActionItem(items, buildActionItem({
          id: 'perform-file-action',
          surface: 'local_file',
          tool: fileMutationTool,
          label: 'Perform the smallest exact local-file action requested.',
          proof: 'Affected path and file metadata after the action.',
          requiresApproval: route.approvalRequired,
        }));
      } else if (fileReadTool) {
        addUniqueActionItem(items, buildActionItem({
          id: 'perform-file-read',
          surface: 'local_file',
          tool: fileReadTool,
          label: 'Read, list, or open only the resolved file scope needed for the request.',
          proof: 'Requested file result or exact path blocker.',
        }));
      }
    }
    if (tools.includes('desktop.file_stat')) {
      addUniqueActionItem(items, buildActionItem({
        id: 'verify-local-output',
        surface: 'verification',
        tool: 'desktop.file_stat',
        label: 'Verify the output or affected local file before reporting completion.',
        proof: proof.find((item) => /stat|byte|basename|path/i.test(item)) || 'Final output file_stat.',
      }));
    }
  }

  if (route.kind === 'desktop_app' || route.kind === 'hybrid') {
    const openTool = firstTool(tools, ['desktop.launch_app', 'desktop.focus_app', 'desktop.open_path', 'desktop.open_url']);
    if (openTool) {
      addUniqueActionItem(items, buildActionItem({
        id: 'open-target-app',
        surface: 'desktop_app',
        tool: openTool,
        label: route.appResolution?.openStepLines[0] || `Open or focus the target desktop app using ${openTool}.`,
        proof: 'Target app/window is reachable.',
      }));
    }
    if (tools.includes('desktop.wait_for_app')) {
      addUniqueActionItem(items, buildActionItem({
        id: 'wait-for-target-app',
        surface: 'desktop_app',
        tool: 'desktop.wait_for_app',
        label: route.appResolution?.openStepLines.find((line) => /wait/i.test(line)) || 'Wait until the target app is running and frontmost.',
        proof: 'Running-app observation confirms readiness.',
      }));
    }

    const observeTool = firstTool(tools, [
      'desktop.photoshop_document_status',
      'desktop.indesign_document_status',
      'desktop.window_state',
      'desktop.read_a11y_tree',
      'desktop.screenshot',
    ]);
    if (observeTool) {
      addUniqueActionItem(items, buildActionItem({
        id: 'observe-app-state',
        surface: 'desktop_app',
        tool: observeTool,
        label: readOnlyDesktopRoute
          ? 'Read the requested app/window state with the smallest available observation tool.'
          : 'Observe the app/document/window state with the strongest available desktop tool before mutation.',
        proof: route.evidenceContract?.observeBefore?.[0] || 'Fresh app/window state.',
      }));
    }

    if (route.approvalRequired) {
      addUniqueActionItem(items, buildActionItem({
        id: 'pause-for-approval',
        surface: 'approval',
        tool: 'approvals.request',
        label: route.approvalReason || 'Pause once before the app mutation or side effect.',
        proof: 'Approval record or user rejection.',
        requiresApproval: true,
      }));
    }

    const actionTool = readOnlyDesktopRoute ? null : firstTool(tools, [
      'desktop.run_applescript',
      'desktop.photoshop_update_text_layer',
      'desktop.photoshop_set_layer_state',
      'desktop.photoshop_place_asset',
      'desktop.photoshop_export_proof',
      'desktop.indesign_batch_update_text_layers',
      'desktop.indesign_update_text_layer',
      'desktop.indesign_set_layer_state',
      'desktop.indesign_relink_asset',
      'desktop.indesign_export_proof',
      'desktop.indesign_package_document',
      'desktop.set_element_value',
      'desktop.click_element',
      'desktop.menu_click',
      'desktop.paste_text',
      'desktop.press_keys',
      'desktop.mouse_click',
    ]);
    if (actionTool) {
      addUniqueActionItem(items, buildActionItem({
        id: 'execute-desktop-action',
        surface: 'desktop_app',
        tool: actionTool,
        label: 'Execute the requested desktop-app action with the highest-confidence native, menu, or accessibility control.',
        proof: 'Action receipt or changed app state.',
        requiresApproval: route.approvalRequired,
      }));
    }

    const verifyTool = firstTool(tools, [
      'desktop.photoshop_layer_inventory',
      'desktop.indesign_text_inventory',
      'desktop.photoshop_document_status',
      'desktop.indesign_document_status',
      'desktop.observe_app',
      'desktop.window_state',
      'desktop.read_a11y_tree',
      'desktop.menu_inventory',
      'desktop.screenshot',
      'desktop.file_stat',
    ]);
    if (verifyTool) {
      addUniqueActionItem(items, buildActionItem({
        id: 'verify-desktop-result',
        surface: 'verification',
        tool: verifyTool,
        label: readOnlyDesktopRoute
          ? 'Confirm the requested read-only desktop-app state after launch or focus.'
          : 'Verify the requested desktop-app state immediately after the action.',
        proof: proof[0] || route.evidenceContract?.proofAfter?.[0] || 'Fresh verification state.',
      }));
    }
  }

  if (route.kind === 'browser') {
    const isWordPressBrowser = route.appStrategy?.label.includes('WordPress');
    if (isWordPressBrowser) {
      if (tools.includes('browser.open_url')) {
        addUniqueActionItem(items, buildActionItem({
          id: 'resolve-wordpress-admin',
          surface: 'browser',
          tool: 'browser.open_url',
          label: 'Resolve and open the canonical WordPress wp-admin or requested admin section before acting.',
          proof: 'Verified WordPress admin URL and origin.',
        }));
      }
      if (tools.includes('browser.verification_state')) {
        addUniqueActionItem(items, buildActionItem({
          id: 'verify-wordpress-session',
          surface: 'browser',
          tool: 'browser.verification_state',
          label: 'Verify WordPress login/session, MFA/CAPTCHA state, and allowed origin before credential or admin actions.',
          proof: 'WordPress session state or exact auth blocker.',
        }));
      }
      const sourceIntelligenceTool = firstTool(tools, ['browser.wp_admin_source_intelligence', 'browser.dom_snapshot']);
      if (sourceIntelligenceTool) {
        addUniqueActionItem(items, buildActionItem({
          id: 'inspect-wordpress-admin-source',
          surface: 'browser',
          tool: sourceIntelligenceTool,
          label: sourceIntelligenceTool === 'browser.wp_admin_source_intelligence'
            ? 'Read bounded/redacted WordPress admin source intelligence for menus, custom post type, row actions, fields, plugin surfaces, and session-expired markers before choosing REST or wp-admin UI.'
            : 'Inspect WordPress admin DOM facts for menus, custom post type, row actions, fields, plugin surfaces, and session-expired markers before choosing REST or wp-admin UI.',
          proof: 'Structured WordPress admin source facts, or exact blocker.',
        }));
      }
      if (tools.includes('desktop.file_search')) {
        addUniqueActionItem(items, buildActionItem({
          id: 'locate-wordpress-upload-source',
          surface: 'local_file',
          tool: 'desktop.file_search',
          label: 'Resolve the exact local media/file source before any WordPress upload.',
          proof: 'Source file path candidate.',
        }));
      }
      if (tools.includes('desktop.file_stat')) {
        addUniqueActionItem(items, buildActionItem({
          id: 'verify-wordpress-upload-source',
          surface: 'local_file',
          tool: 'desktop.file_stat',
          label: 'Verify the upload source file metadata before attaching it to WordPress.',
          proof: 'Source file_stat with basename and byte size.',
        }));
      }
      if (route.approvalRequired) {
        addUniqueActionItem(items, buildActionItem({
          id: 'pause-for-wordpress-approval',
          surface: 'approval',
          tool: 'approvals.request',
          label: route.approvalReason || 'Pause before the WordPress credentialed, public, upload, plugin/theme, settings, user/role, ecommerce, or destructive change.',
          proof: 'Approval record or user rejection.',
          requiresApproval: true,
        }));
      }
      const wordpressActionTool = inferWordPressActionToolFromMessage(route.sourceMessage || '', tools);
      if (wordpressActionTool) {
        const isTrashPostAction = wordpressActionTool === 'wp.trash_post';
        const isUiFallbackAction = wordpressActionTool === 'browser.click_role' || wordpressActionTool === 'browser.fill_field';
        addUniqueActionItem(items, buildActionItem({
          id: 'execute-wordpress-admin-step',
          surface: 'browser',
          tool: wordpressActionTool,
          label: isTrashPostAction
            ? 'Trash the exact approved WordPress post, page, or DI Slide target with wp.trash_post after discovery/list proof; do not use this for ordinary updates, uploads, or listing.'
            : isUiFallbackAction
              ? 'Perform the dashboard-only WordPress admin action with semantic wp-admin UI controls after source intelligence confirms the current screen and available fields.'
              : 'Perform one WordPress REST/admin action, preferring wp.update_post/wp.* tools before wp-admin UI fallback where supported; for Dealer Inspire slides, use discovered di_slide/flavor_di_slides facts, draft-first updates, slider/expiration proof, and cache/public verification.',
          proof: isTrashPostAction ? 'WordPress trash receipt plus target status proof.' : 'WordPress action receipt or changed admin state.',
          requiresApproval: route.approvalRequired,
        }));
      }
      const verifyTool = firstTool(tools, ['browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'browser.screenshot']);
      if (verifyTool) {
        addUniqueActionItem(items, buildActionItem({
          id: 'verify-wordpress-result',
          surface: 'verification',
          tool: verifyTool,
          label: verifyTool === 'browser.wp_admin_source_intelligence'
            ? 'Verify WordPress saved state, media URL/id, plugin/theme/settings status, editor state, public URL, or exact blocker with bounded/redacted admin source facts.'
            : 'Verify WordPress saved state, media URL/id, plugin/theme/settings status, editor state, public URL, or exact blocker.',
          proof: proof[0] || 'WordPress admin/public proof or exact blocker.',
        }));
      }
    } else {
      const openTool = tools.includes('browser.open_url') ? 'browser.open_url' : null;
      if (openTool) {
        addUniqueActionItem(items, buildActionItem({
          id: 'open-browser-target',
          surface: 'browser',
          tool: openTool,
          label: 'Open the explicit URL or requested browser target and verify the origin before operating the page.',
          proof: 'Verified URL, origin, page title, or exact navigation blocker.',
        }));
      }
      const semanticTool = inferBrowserSemanticActionToolFromMessage(route.sourceMessage || '', tools)
        || (!openTool ? firstTool(tools, ['browser.dom_snapshot', 'browser.set_toggle', 'browser.click_role', 'browser.fill_field']) : null);
      if (semanticTool) {
        addUniqueActionItem(items, buildActionItem({
          id: 'execute-browser-action',
          surface: 'browser',
          tool: semanticTool,
          label: semanticTool === 'browser.dom_snapshot'
            ? 'Read the requested page content from a fresh semantic DOM/ARIA snapshot after navigation.'
            : 'Perform the requested semantic browser operation with role, label, or field actionability checks after navigation.',
          proof: proof[0] || 'Requested browser state or exact blocker.',
          requiresApproval: route.approvalRequired,
        }));
      }
    }
  }

  if (route.kind === 'agent_buildout') {
    addUniqueActionItem(items, buildActionItem({
      id: 'build-missing-capability',
      surface: 'support',
      tool: 'agent.build_app_capability',
      label: 'Build only the missing app adapter or recipe, then retry the original task once with fresh evidence.',
      proof: 'Changed files, focused smoke, and ready-to-retry result.',
      requiresApproval: true,
    }));
  }

  return route.kind === 'browser' && route.appStrategy?.label.includes('WordPress')
    ? items.slice(0, 8)
    : items.slice(0, 6);
}

/**
 * Meta-questions about automation capability/safety — the user is asking
 * ABOUT the feature, not asking for an action. Interrogative anchors are
 * deliberately narrow: "can you open amazon?" is a real request and must
 * NOT match.
 */
// P23: "how do I ..." / "where do I ..." setup/instruction questions are asks
// for GUIDANCE, not commands — "how do I connect my wordpress site?" was
// being routed into browser automation. Kept as interrogative-START anchors
// so imperatives ("connect my wordpress site") still route to automation.
const AUTOMATION_META_QUESTION_RE = /^(?:is it (?:safe|ok|okay|secure)|how safe is|what happens (?:if|when)|should i (?:let|allow|trust)|can i trust|do i need to worry|what are the risks|how (?:do|can|would|should) i\b|where do i\b|what(?:'s| is) the best way to\b)/i;

export function isAutomationMetaQuestion(message: string): boolean {
  return AUTOMATION_META_QUESTION_RE.test(String(message || '').trim());
}

export function buildChatComputerRequestRoute(
  message: string,
  opts: {
    pipelineDecision?: UserTaskPipelineDecision | null;
    /**
     * T7 UX: sticky "always allow" scopes to consider for an approval
     * downgrade. Defaults to the in-memory registry hydrated by
     * `computerGrantGateStore` — an unhydrated registry fails closed
     * (approval keeps being asked).
     */
    stickyScopes?: StickyAllowScope[] | null;
    /**
     * Wave-2: app-resolution context override for tests. Defaults to the
     * in-memory registry hydrated by ChatTab — an unhydrated registry fails
     * honest (bridge treated as offline, web apps win).
     */
    appResolutionContext?: ResolveBestAppContext | null;
  } = {},
): ChatComputerRequestRoute | null {
  const normalized = String(message || '').trim();
  if (!normalized) return null;
  // P12 (novice persona finding): questions ABOUT automation — "is it safe
  // to let an AI use my browser?" — must stay conversational, not spawn a
  // computer route. High-precision interrogative anchors only, so real
  // requests ("can you open amazon…") are untouched.
  if (isAutomationMetaQuestion(normalized)) return null;
  if (isAppGuidanceOrChoiceQuestion(normalized)) return null;

  const appResolutionContext = opts.appResolutionContext ?? getAppResolutionContext();
  const lifecycleObservedNames = observedLifecycleAppNames(appResolutionContext);
  const exactProgram = compileComputerSequenceProgram(normalized);
  let namedAppAction = detectExplicitNamedAppAction(normalized, lifecycleObservedNames);
  // A lifecycle-shaped phrase whose target failed the shared named-app guard
  // is not permission to invent an app identity through generic strategy
  // inference (for example, "Open the door" or "Open task manager").
  if (!namedAppAction && !exactProgram && hasStrictNamedAppLifecycleCommandShape(normalized)) return null;

  const bestMatch = getBestUserTaskPipeline(normalized, { includeFallback: false });
  const initialPipeline = bestMatch ? summarizeUserTaskPipelineMatch(bestMatch) : null;
  if (!namedAppAction && isPureCreativeGeneration(normalized)) return null;
  if (!namedAppAction && isPlainBuildDiscoveryRequest(normalized)) return null;
  if (isSimpleWordpressConversationalIntent(normalized, initialPipeline)) return null;
  if (initialPipeline?.id === 'bridge_troubleshooting') return null;
  if (initialPipeline?.id === 'workflow_recording_replay' && isWorkflowRecordingRequest(normalized)) return null;
  // Aggregate inbox/notification triage can mention several products without
  // asking Chat to drive any one native app. Keep that higher-level OpenSwan
  // integration workflow intact. A strongly framed command such as "Open
  // Mail and read..." or "Use Slack to..." still opts into native control.
  if (
    initialPipeline?.id === 'inbox_notifications'
    && initialPipeline.executionKind === 'run_openswan'
    && !hasExplicitNamedAppFraming(normalized)
    && !/\b(?:browser|webpage|website)\b/i.test(normalized)
    && !EXPLICIT_WEB_TARGET_RE.test(normalized)
  ) return null;

  const pipelineDecision = opts.pipelineDecision ?? buildUserTaskPipelineDecision(normalized, { includeFallback: false });
  const preview = planComputerTaskPreview(normalized);
  // "Export as PNG" is a direct file conversion only when the user did not
  // explicitly choose an app. In "Open Pixelmator Pro and export…", app
  // identity is a hard surface constraint, not a hint to bypass the app.
  const directImageConversion = namedAppAction?.surface !== 'desktop_app'
    && isDirectLocalImageFormatConversionTask(normalized);
  const rawStrategy = buildComputerAppTaskStrategy(normalized, pipelineDecision);
  const transactionalWebRequest = hasTransactionalWebIntent(normalized);
  const browserbaseWorkflow = classifyBrowserbaseWorkflow(normalized);
  // A literal URL is stronger evidence than any alias discovered inside that
  // URL (for example, "developer" in developer.example.com must not launch
  // the macOS Developer app). Multi-surface download/import workflows are
  // restored to hybrid by the staged-transfer check below.
  const explicitWebsiteRequest = hasExplicitWebsiteOperation(normalized);
  const explicitBrowserTaskRequest = /^(?:browser|web)\s+(?:computer\s+use\s+)?task\s*:/i.test(normalized);
  const explicitBrowserbaseWebWorkflow = browserbaseWorkflow.kind !== 'general_browser'
    && EXPLICIT_WEB_TARGET_RE.test(normalized);
  const browserSurfaceRequest = transactionalWebRequest
    || explicitWebsiteRequest
    || explicitBrowserTaskRequest
    || explicitBrowserbaseWebWorkflow;
  const isWordPressRoute = initialPipeline?.id === 'wordpress_cms' || isWordPressAdminBrowserTask(normalized, rawStrategy);
  const isDealerInspireWordPressRoute = initialPipeline?.id === 'wordpress_cms' && /\b(dealer\s+inspire|dealerinspire|di\s+slides?|di_slide|flavor_di_slides|quick edit|expiration(?:_date)?|reload cache|admin\.php)\b/i.test(normalized);
  // Explicit transactional/WordPress web evidence outranks a generic app-name
  // parse. This prevents phrases such as "Open Amazon and buy…" or "Open the
  // WordPress customizer…" from being treated as native long-tail apps.
  if (namedAppAction && (browserSurfaceRequest || isWordPressRoute)) {
    namedAppAction = { ...namedAppAction, surface: 'browser' };
  }
  const selectedRawStrategy = shouldPreferLocalFilePreview(normalized, preview, rawStrategy) ? null : rawStrategy;
  const narrowedStrategy = narrowStrategyForExactComputerSequence(selectedRawStrategy, exactProgram);
  const strategy = browserSurfaceRequest
    ? narrowedStrategy && BROWSER_STRATEGIES.has(narrowedStrategy.id) ? narrowedStrategy : null
    : namedAppAction?.surface === 'desktop_app'
    ? narrowedStrategy && APP_STRATEGIES.has(narrowedStrategy.id) ? narrowedStrategy : null
    : namedAppAction?.surface === 'browser'
      ? narrowedStrategy && BROWSER_STRATEGIES.has(narrowedStrategy.id) ? narrowedStrategy : null
      : namedAppAction?.surface === 'local_file'
        ? narrowedStrategy && FILE_STRATEGIES.has(narrowedStrategy.id) ? narrowedStrategy : null
      : narrowedStrategy;
  const designPipeline = directImageConversion || isWordPressRoute ? null : buildDesignAppExecutionPipelinePlan(normalized);

  // Wave-2 task→best-app resolution. URL-bearing and generic web-browsing
  // intents keep today's direct browser routing untouched — stamping
  // "Browser" as an app choice adds noise without changing behavior.
  const rawAppResolution = resolveBestAppForTask(normalized, appResolutionContext);
  let appResolution = rawAppResolution && rawAppResolution.category !== 'web_browsing'
    ? summarizeAppResolution(rawAppResolution)
    : null;
  // A strongly named surface owns opening. The generic resolver is allowed to
  // choose an alternative only when the user did not name an app; otherwise
  // its offline web fallback can silently turn "Use Affinity Photo" into
  // Photopea/browser execution.
  if (namedAppAction) {
    const resolutionMatchesNamedSurface = Boolean(
      appResolution?.explicitAppNamed
      && (
        (namedAppAction.surface === 'desktop_app' && appResolution.best.surface === 'desktop')
        || (namedAppAction.surface === 'browser' && appResolution.best.surface === 'browser')
      ),
    );
    if (!resolutionMatchesNamedSurface) appResolution = null;
  }
  // A resolution CREATES a route only for high-confidence app-workbench
  // detections ("edit this photo"). Named apps and conversational
  // categories only stamp routes other signals built: operative named-app
  // phrasings already pass the surface gate below, and a bare app mention
  // inside a workflow request ("provision Slack access") must keep its
  // existing pipeline routing.
  const resolutionCreatesRoute = Boolean(appResolution)
    && APP_WORKBENCH_TASK_CATEGORIES.has(appResolution!.category)
    && detectTaskAppCategory(normalized)?.confidence === 'high';

  if (!resolutionCreatesRoute && !explicitComputerSurfaceRequested(normalized, preview, strategy, designPipeline, namedAppAction)) return null;

  const stagedBrowserTransferIntoDesktopApp = isStagedBrowserFileTransferIntoDesktopApp(normalized, strategy);
  let kind = directImageConversion ? 'local_file' as const : resolveKind(preview, strategy, designPipeline, normalized);
  if (namedAppAction?.surface === 'desktop_app') kind = 'desktop_app';
  if (namedAppAction?.surface === 'browser') kind = 'browser';
  if (namedAppAction?.surface === 'local_file') kind = 'local_file';
  if (browserSurfaceRequest) kind = 'browser';
  if (stagedBrowserTransferIntoDesktopApp) kind = 'hybrid';
  if (appResolution && !appResolution.explicitAppNamed) {
    // Keep the surface consistent with the resolver's pick: an installed
    // desktop app wins over a generic browser guess and a known-good web
    // app wins over an unavailable desktop one. Explicitly named apps/URLs
    // never override the router's existing kind — the resolver already
    // handled naming. Hybrid is only collapsed for resolution-created
    // routes (preview unknown); genuine multi-surface tasks keep 'hybrid'.
    if (kind === 'desktop_app' && appResolution.best.surface === 'browser') kind = 'browser';
    else if (kind === 'browser' && appResolution.best.surface === 'desktop') kind = 'desktop_app';
    else if (kind === 'hybrid' && preview.kind === 'unknown' && !stagedBrowserTransferIntoDesktopApp) {
      kind = appResolution.best.surface === 'browser' ? 'browser' : 'desktop_app';
    }
  }
  // Named-app desktop routes never get a browser web-fallback stamped: the
  // resolver only falls to the named app's web variant when the bridge looks
  // offline, and surfaces that never hydrate the registry (swanbot/openswan
  // prompt blocks) would otherwise prepend a contradictory "open it in the
  // browser" step ahead of the desktop/design pipeline.
  if (appResolution && appResolution.explicitAppNamed && appResolution.best.surface === 'browser' && kind === 'desktop_app') {
    appResolution = null;
  }
  // Pure local-file work must never inherit a resolver's web substitute. A
  // filename conversion that happens to mention Photoshop is still a scoped
  // file operation; opening Photoshop Web/Photopea would steal focus and
  // violate the route's desktop-bridge-only evidence contract. A genuinely
  // installed native app remains valid when it is part of the requested path,
  // but its browser recovery fallback is removed from this local-only route.
  if (kind === 'local_file' && appResolution?.best.surface === 'browser') {
    appResolution = null;
  } else if (kind === 'local_file' && appResolution?.recoveryFallback?.surface === 'browser') {
    appResolution = { ...appResolution, recoveryFallback: null };
  }
  const confidence = Number(Math.max(0.78, Math.min(0.96, Math.max(
    initialPipeline?.confidence || 0,
    pipelineDecision?.confidence || 0,
    preview.kind === 'unknown' ? 0.74 : 0.86,
    strategy ? 0.88 : 0,
    designPipeline ? 0.94 : 0,
  ))).toFixed(2));
  const baselineRisk = resolveRisk({
    message: normalized,
    kind,
    preview,
    selectedPipeline: kind === 'local_file' ? null : initialPipeline,
    strategy,
  });
  // A fixed, bounded unsaved blank-document allocation has no persistent file
  // or external side effect. Preserve stronger classifications, but do not
  // label this exact direct-request program as generic review work.
  const risk = exactProgram?.authorization.mode === 'direct_user_request'
    && baselineRisk === 'review'
    ? 'safe'
    : kind === 'browser'
      && explicitBrowserbaseWebWorkflow
      && browserbaseWorkflow.kind === 'web_data_retrieval'
      && !BROWSERBASE_DATA_SIDE_EFFECT_RE.test(normalized)
      ? 'safe'
    : kind === 'browser'
      && baselineRisk === 'external_side_effect'
      && !hasExternalSideEffectIntent(normalized)
      && !NAMED_APP_CREDENTIAL_OR_GRANT_RE.test(normalized)
      && !isCredentialedWebsiteAdminRoute(strategy, normalized)
      ? 'review'
    : normalizeNamedDesktopRisk(normalized, namedAppAction, baselineRisk);
  const selectedPipelineCandidate: UserTaskPipelineSummary = initialPipeline && initialPipeline.executionKind === 'run_computer_task'
    ? { ...initialPipeline, risk: maxRisk(initialPipeline.risk, risk) }
    : initialPipeline && (
      initialPipeline.id === 'desktop_app_control' ||
      initialPipeline.id === 'creative_layout_design' ||
      initialPipeline.id === 'adobe_creative_cloud' ||
      initialPipeline.id === 'browser_navigation' ||
      initialPipeline.id === 'browser_data_retrieval' ||
      initialPipeline.id === 'browser_form_submission' ||
      initialPipeline.id === 'website_platform_admin' ||
      isDealerInspireWordPressRoute ||
      initialPipeline.id === 'local_files' ||
      initialPipeline.id === 'human_verification'
    )
      ? { ...initialPipeline, executionKind: 'run_computer_task' as const, routeId: isDealerInspireWordPressRoute || kind === 'browser' ? 'browser' : initialPipeline.routeId || null, risk: maxRisk(initialPipeline.risk, risk) }
      : synthesizePipelineSummary(kind, strategy, preview, risk, confidence);
  const selectedPipelineBase: UserTaskPipelineSummary = !exactProgram
    && namedAppAction?.surface === 'desktop_app'
    && kind === 'desktop_app'
      ? buildNamedDesktopPipelineSummary({
        appName: namedAppAction.appName,
        base: selectedPipelineCandidate,
        risk,
        confidence,
        intent: namedAppAction.intent,
      })
    : !exactProgram && namedAppAction?.surface === 'local_file' && kind === 'local_file'
      ? synthesizePipelineSummary('local_file', strategy, preview, risk, confidence)
    : !exactProgram && kind === 'browser'
      && explicitBrowserbaseWebWorkflow
      && browserbaseWorkflow.kind === 'web_data_retrieval'
      ? {
          ...synthesizePipelineSummary('browser', null, preview, risk, confidence),
          id: 'browser_data_retrieval',
          title: browserbaseWorkflow.label,
          recommendedTools: ['browser.open_url', 'browser.dom_snapshot', 'browser.screenshot', 'fetch_url'],
          executionRequirements: browserbaseWorkflow.safetyNotes.slice(0, 8),
          solutionSteps: browserbaseWorkflow.completionCriteria.slice(0, 8),
          completionCriteria: ['Requested structured web data is returned with source context, or an exact browser blocker is reported.'],
        }
    : !exactProgram && kind === 'browser' && !strategy && !isWordPressRoute
      && (namedAppAction?.surface === 'browser' || browserSurfaceRequest)
      ? synthesizePipelineSummary('browser', strategy, preview, risk, confidence)
      : selectedPipelineCandidate;
  // Wave-2: the chosen app is opened FIRST — prepend the open-first steps to
  // the route's solution steps so plan previews and prompts lead with it.
  const selectedPipeline: UserTaskPipelineSummary = exactProgram
    ? {
        ...selectedPipelineBase,
        title: exactProgram.title,
        solutionSteps: exactProgram.steps.map((step) => `${step.tool} ${JSON.stringify(step.args)} — ${step.note}`).slice(0, 8),
        recommendedTools: uniqueStrings(exactProgram.steps.map((step) => step.tool)),
        executionRequirements: [
          'local desktop bridge with the dedicated Photoshop status, launch, and create-document tools',
          exactProgram.authorization.mode === 'direct_user_request'
            ? 'the current direct user command authorizes only this new unsaved blank document'
            : 'one enclosing Chat plan-level approval before the oversized blank-document allocation',
        ],
        completionCriteria: [
          'final Photoshop document status reports an active document with the exact requested dimensions',
        ],
        approvalTriggers: exactProgram.authorization.mode === 'direct_user_request'
          ? []
          : ['one Chat plan-level approval before dispatching the complete exact program'],
      }
    : appResolution
    ? {
        ...selectedPipelineBase,
        solutionSteps: uniqueStrings([
          ...appResolution.openStepLines,
          ...selectedPipelineBase.solutionSteps,
        ]).slice(0, 8),
      }
    : selectedPipelineBase;
  // An exact native program is not a browser command. Leaving the synthesized
  // creative pipeline's legacy `browser` route id attached made approval rows
  // look like `chat.run_computer_task.browser`, even though every executable
  // call targets the local Photoshop bridge.
  const routeId: ChatCommandRouteId | null = exactProgram || kind === 'desktop_app' || kind === 'local_file'
    ? null
    : selectedPipeline.routeId || 'browser';
  // A compiled sequence is already the complete executable surface plan.
  // Running it through the generic surface planner is what reintroduced file,
  // design-inventory, and fallback requirements into this simple request.
  const surfacePlan = exactProgram
    ? null
    : buildExecutionSurfacePlan({
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
  const appAutomationRouteDecision = exactProgram || kind === 'local_file' || kind === 'agent_buildout' || strategy?.id === 'agent_asset_acquisition'
    ? null
    : buildAppAutomationRouteDecision(normalized, {
        preferred: namedAppAction?.surface === 'desktop_app'
          ? {
              targetName: namedAppAction.appName,
              taskFamily: namedAppAction.intent === 'launch_or_read'
                ? 'app launch/read observation'
                : undefined,
            }
          : undefined,
      });
  const userConstraints = parseChatComputerUserConstraints(normalized);
  const alwaysConfirmFloor = detectAlwaysConfirmFloorCategories(normalized);
  const stickyScopes = opts.stickyScopes ?? getActiveStickyScopes();
  const extractedTargets = extractStickyTaskTargets(normalized);
  const taskTargets: StickyScopeTaskTarget = {
    hostname: extractedTargets.hostname,
    appName: extractedTargets.appName || namedAppAction?.appName || designPipeline?.appName || null,
  };
  const approval = buildApproval({
    message: normalized,
    risk,
    kind,
    strategy,
    userConstraints,
    alwaysConfirmFloor,
    stickyScopes,
    taskTargets,
    requestedCategories: categoriesInText(normalized),
    directUserAuthorizedLocalDraft: exactProgram?.authorization.mode === 'direct_user_request',
  });
  const approvalFreeDesktopRead = !exactProgram
    && kind === 'desktop_app'
    && namedAppAction?.surface === 'desktop_app'
    && namedAppAction.intent === 'launch_or_read'
    && !approval.required;
  const deterministicLifecycleReadProgram = approvalFreeDesktopRead
    ? buildDeterministicNamedAppLifecycleReadProgram(normalized, namedAppAction, lifecycleObservedNames)
    : null;
  const desktopProductWithoutFileWork = kind === 'desktop_app'
    && /\bdesktop$/i.test(namedAppAction?.appName || '')
    && !requestHasExplicitLocalArtifact(normalized);
  const recommendedToolCandidates = exactProgram
    ? uniqueStrings(exactProgram.steps.map((step) => step.tool))
    : uniqueStrings([
        ...(directImageConversion ? ['desktop.convert_image', 'desktop.file_search', 'desktop.file_stat'] : []),
        ...(stagedBrowserTransferIntoDesktopApp
          ? ['browser.open_url', 'desktop.file_search', 'desktop.file_stat', 'desktop.launch_app', 'desktop.wait_for_app', 'desktop.window_state', 'desktop.read_a11y_tree']
          : []),
        ...(appResolution && rawAppResolution
          ? buildAppOpenPlan(rawAppResolution.best).steps.map((step) => step.tool)
          : []),
        ...(strategy?.recommendedTools || []),
        ...(designPipeline?.requiredToolSequence || []),
        ...(selectedPipeline.recommendedTools || []),
        ...(approval.required ? ['approvals.request'] : []),
      ]);
  const recommendedTools = deterministicLifecycleReadProgram
    ? uniqueStrings(deterministicLifecycleReadProgram.steps.map((step) => step.tool))
    : approvalFreeDesktopRead
      ? namedDesktopReadToolsFor(namedAppAction?.appName || '').slice(0, 28)
    : (!exactProgram && namedAppAction?.surface === 'desktop_app' && kind === 'desktop_app'
    ? uniqueStrings([
        ...NAMED_DESKTOP_BASE_TOOLS,
        ...recommendedToolCandidates.filter((tool) => (
          !isBrowserExecutionTool(tool)
          && (tool !== 'approvals.request' || approval.required)
          && (!desktopProductWithoutFileWork || (!tool.startsWith('desktop.file_') && tool !== 'desktop.open_path'))
        )),
      ])
    : kind === 'local_file'
      ? recommendedToolCandidates.filter((tool) => !isBrowserExecutionTool(tool))
    : recommendedToolCandidates).slice(0, 28);
  const completionProof = exactProgram
    ? [
        `final desktop.photoshop_document_status reports the requested active document dimensions`,
        'created Photoshop document name and dimensions from app-native status',
      ]
    : approvalFreeDesktopRead
      ? [
          `exact ${namedAppAction?.appName || 'desktop app'} process/window identity after launch or focus`,
          'requested app-native status, accessibility value, menu state, or visible window observation',
        ]
      : uniqueStrings([
        ...(directImageConversion ? ['converted output file_stat', 'output basename and byte size'] : []),
        ...(stagedBrowserTransferIntoDesktopApp ? ['downloaded artifact file_stat', 'target app/window state after import'] : []),
        ...(surfacePlan?.completionProof || []),
        ...(strategy?.verificationOrder || []),
        ...(designPipeline ? ['design document inventory', 'proof screenshot or exported proof', 'output file stats'] : []),
        ]).slice(0, 12);
  const fallbackPipelineIds = exactProgram || deterministicLifecycleReadProgram
    ? []
    : uniqueStrings([
        ...(pipelineDecision?.supporting.map((item) => item.id) || []),
        selectedPipeline.id !== 'desktop_app_control' && kind === 'desktop_app' ? 'desktop_app_control' : null,
        selectedPipeline.id !== 'local_files' && kind === 'local_file' ? 'local_files' : null,
        selectedPipeline.id !== 'browser_navigation' && kind === 'browser' ? 'browser_navigation' : null,
      ]) as UserTaskPipelineId[];
  const bestPath = exactProgram
    ? `desktop app: ${exactProgram.title} exact program`
    : namedAppAction && kind !== 'hybrid'
      ? `${kind.replace(/_/g, ' ')}: ${namedAppAction.appName}${selectedPipeline.title !== namedAppAction.appName ? ` via ${selectedPipeline.title}` : ''}`
    : buildBestPath({ kind, preview, strategy, designPipeline, pipeline: selectedPipeline });
  const classifiedAiNeed = classifyDesktopTaskAiNeed({
    message: normalized,
    kind,
    strategyId: strategy?.id || null,
    risk,
    hasDesignPipeline: Boolean(designPipeline),
    recommendedTools,
  });
  // Only the strict single-intent open/launch/focus grammar is safe to run as
  // a no-model local program. A request that also asks Chat to interpret app
  // state keeps the read-only tool surface but must not claim `aiNeed:none`
  // and then fall through to an unavailable relay by accident.
  const aiNeed: DesktopTaskAiNeedClassification = deterministicLifecycleReadProgram
    ? {
        level: 'none',
        label: 'No AI needed',
        reason: 'The strict named-app lifecycle request compiles to an immutable local observe, launch/focus, and verification program.',
        deterministicTools: recommendedTools,
        aiSurfaces: [],
      }
    : approvalFreeDesktopRead && classifiedAiNeed.level === 'none'
      ? {
          level: 'assistive',
          label: 'AI assisted',
          reason: 'The app lifecycle is deterministic, but interpreting the requested app state requires the selected semantic read loop.',
          deterministicTools: classifiedAiNeed.deterministicTools,
          aiSurfaces: ['read-only app state interpretation'],
        }
      : classifiedAiNeed;
  const modelOrchestration = buildChatComputerModelOrchestration({
    message: normalized,
    kind,
    recommendedTools,
    aiNeed,
    exactProgramAuthorization: exactProgram?.authorization || null,
    deterministicLifecycleReadProgram,
  });
  const notes = uniqueStrings([
    `Computer request route: ${bestPath}.`,
    exactProgram ? `Exact program owns execution: ${exactProgram.steps.map((step) => step.tool).join(' -> ')}.` : null,
    deterministicLifecycleReadProgram
      ? `Deterministic lifecycle program owns execution: ${deterministicLifecycleReadProgram.steps.map((step) => step.tool).join(' -> ')}.`
      : null,
    `Preview kind: ${preview.kind}.`,
    `AI need: ${aiNeed.label} — ${aiNeed.reason}`,
    `Model orchestration: ${modelOrchestration.mode}; ${modelOrchestration.modelSelectionHint}`,
    !exactProgram && appResolution
      ? `App choice: ${appResolution.best.displayName} (${shortAppReason(appResolution.best.reason)}); alternatives: ${appResolution.alternativesSummary.map((alt) => alt.split(' — ')[0]).join(', ') || 'none'}.`
      : null,
    userConstraints
      ? `User constraints: forbidden=${userConstraints.forbidden.join(',') || 'none'}; ask-before=${userConstraints.approvalBefore.join(',') || 'none'}; stop-on=${userConstraints.stopConditions.join(',') || 'none'}.`
      : null,
    alwaysConfirmFloor.length ? `Always-confirm floor: ${alwaysConfirmFloor.join(', ')} (not user-disableable).` : null,
    approval.stickyApplied ? formatStickyScopeAppliedNotice(approval.stickyApplied) : null,
    strategy ? `Strategy: ${strategy.label} (${strategy.id}).` : null,
    appAutomationRouteDecision ? `App route decision: ${appAutomationRouteDecision.status} via ${appAutomationRouteDecision.chosenSurface.label} for ${appAutomationRouteDecision.taskFamily}.` : null,
    designPipeline ? `Design execution phases: ${designPipeline.phases.map((phase) => phase.id).join(' -> ')}.` : null,
    surfacePlan ? `Primary surface: ${surfacePlan.primarySurface}; fallbacks: ${surfacePlan.fallbackSurfaces.join(' -> ') || 'none'}.` : null,
    approval.required
      ? `Approval required: ${approval.reason}.`
      : approval.stickyApplied
        ? `Approval not required: standing grant for ${approval.stickyApplied.scopeKey} covers this task.`
        : exactProgram?.authorization.mode === 'direct_user_request'
          ? 'Approval not required: the current command authorizes one bounded new unsaved blank document.'
        : isLowRiskLocalImageExportTask(normalized)
          ? 'Approval not required for this bounded local image export.'
          : 'Approval not required before read-only routing.',
  ]).slice(0, 10);

  const route: ChatComputerRequestRoute = {
    sourceMessage: normalized,
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
    aiNeed,
    modelOrchestration,
    deterministicLifecycleReadProgram,
    actionItems: [],
    evidenceContract: null,
    userConstraints,
    alwaysConfirmFloor,
    stickyScopeApplied: approval.stickyApplied,
    appResolution: exactProgram || deterministicLifecycleReadProgram ? null : appResolution,
    notes,
  };
  route.evidenceContract = buildComputerTaskEvidenceContract(route);
  route.completionProof = uniqueStrings([
    ...route.completionProof,
    ...route.evidenceContract.proofAfter,
  ]).slice(0, 12);
  route.actionItems = buildChatComputerRequestActionItems(route);
  return route;
}

/**
 * E4: the data-transfer & precision rules apply to routes that drive a local
 * desktop app, hybrid flow, or local files — surfaces where the model can be
 * tempted to read or retype precise strings from screenshots. Pure-cloud
 * browser routes are excluded: the Browserbase edge loop carries its own
 * transfer rules in the edge prompt.
 */
function routeNeedsDataTransferPrecisionRules(kind: ChatComputerRequestRouteKind): boolean {
  return kind === 'desktop_app' || kind === 'hybrid' || kind === 'local_file';
}

export function buildChatComputerRequestRoutePromptBlock(message: string): string | null {
  const route = buildChatComputerRequestRoute(message);
  if (!route) return null;
  const exactProgram = compileComputerSequenceProgram(route.sourceMessage);
  if (exactProgram?.id === 'photoshop_new_document') {
    return [
      '## Chat Computer Request Route — Exact Program',
      `Best path: ${route.bestPath}`,
      `Request kind: ${route.kind}; execution=${route.executionKind}; route=${route.routeId || 'computer'}`,
      `Risk: ${route.risk}; approval=${route.approvalRequired ? route.approvalReason || 'required before dispatch' : 'not required for this bounded unsaved draft'}`,
      route.approvalRequired
        ? 'Approval model: consume the one unified Chat plan-level approval before dispatching this complete program.'
        : 'Authorization model: the current direct user command authorizes this one compiler-owned unsaved blank document. Saving, exporting, editing existing content, or external actions are outside this program.',
      exactProgram.promptBlock,
      route.evidenceContract ? formatComputerTaskEvidenceContractPromptBlock(route.evidenceContract) : null,
      `Actionable desktop items: ${(route.actionItems || []).map((item, index) => `${index + 1}. ${item.label} [${item.tool}]`).join(' | ') || 'none'}`,
      `Recommended tools: ${route.recommendedTools.join(' | ') || 'none'}`,
      `Completion proof: ${route.completionProof.join(' | ') || 'exact blocker or final answer'}`,
      'Execution rule: execute this one compiled program in order. No file/source/layer/export/buildout planning and no generic fallback pipeline applies.',
    ].filter(Boolean).join('\n');
  }
  if (route.deterministicLifecycleReadProgram) {
    const program = route.deterministicLifecycleReadProgram;
    return [
      '## Chat Computer Request Route — Deterministic Local Lifecycle',
      `Target app: ${program.targetAppName}`,
      `Dispatch app identity: ${program.dispatchAppName}`,
      `Operation: ${program.operation}; approval=not required`,
      `Program: ${program.steps.map((step, index) => `${index + 1}. ${step.tool} (${step.when})`).join(' -> ')}`,
      `Completion proof: ${route.completionProof.join(' | ')}`,
      'Execution rule: dispatch through the local observe-first native activation adapter. Do not call a selected-model, SwanBot, or text-only AI relay.',
    ].join('\n');
  }
  return [
    '## Chat Computer Request Route',
    `Best path: ${route.bestPath}`,
    `Request kind: ${route.kind}; execution=${route.executionKind}; route=${route.routeId || 'computer'}`,
    `Risk: ${route.risk}; approval=${route.approvalRequired ? route.approvalReason || 'required' : 'not required before read-only execution'}`,
    route.selectedPipeline ? `Selected pipeline: ${route.selectedPipeline.title} (${route.selectedPipeline.id})` : null,
    route.appStrategy ? `App/browser strategy: ${route.appStrategy.label} (${route.appStrategy.id})` : null,
    route.appStrategy?.label.includes('WordPress')
      ? 'WordPress operating rule: prefer /wp or wp.* REST tools for supported content/media work, including wp.update_post for known post/page/CPT IDs and wp.trash_post only for explicit delete/trash/remove/archive of posts, pages, or DI Slides; use browser.wp_admin_source_intelligence before wp-admin UI decisions so current admin facts are bounded/redacted and raw HTML never reaches the model; use wp-admin browser automation only for dashboard-only workflows such as editor panels, plugins, themes, users, menus, settings, WooCommerce, forms, Dealer Inspire admin.php pages, DI Slides/di_slide fields, Quick Edit expiration_date, slider assignment, clone/new-draft, cache reload, or plugin pages. Stop for MFA/CAPTCHA/security checks and require approval before public, credentialed, destructive, plugin/theme, settings, user/role, media upload, DI slide status/slider/expiration/order/cache, or ecommerce changes.'
      : null,
    route.appStrategy?.id === 'universal_app_control'
      ? 'Professional app autonomy: open/focus the target app, observe window and accessibility state, research the official control surface when unfamiliar, prefer app-native APIs/scripts/DOM before UI fallback, take one verified step at a time, and build a reusable adapter if generic control is not enough.'
      : null,
    route.aiNeed
      ? `AI need: ${route.aiNeed.label} — ${route.aiNeed.reason}${route.aiNeed.deterministicTools.length ? ` Deterministic tools: ${route.aiNeed.deterministicTools.join(' | ')}.` : ''}${route.aiNeed.aiSurfaces.length ? ` AI surfaces: ${route.aiNeed.aiSurfaces.join(' | ')}.` : ''}`
      : null,
    route.modelOrchestration
      ? `Model/app orchestration: ${route.modelOrchestration.selectedModelRole} Activation path: ${route.modelOrchestration.activationPath.join(' -> ')}. ${route.modelOrchestration.modelSelectionHint}${route.modelOrchestration.multiAgentHint ? ` ${route.modelOrchestration.multiAgentHint}` : ''}`
      : null,
    route.appResolution
      ? `App choice: ${route.appResolution.best.displayName} — ${route.appResolution.best.reason}. Open it first before the task (${route.appResolution.openStepLines[0] || route.appResolution.best.openVia}). If the user objects, switch to: ${route.appResolution.alternativesSummary.join('; ') || 'no ranked alternative — ask the user'}.`
      : null,
    ...formatChatComputerUserConstraintsPromptLines(route.userConstraints),
    formatAlwaysConfirmFloorPromptLine(route.alwaysConfirmFloor),
    route.stickyScopeApplied
      ? `Standing grant applied: ${formatStickyScopeAppliedNotice(route.stickyScopeApplied)} The always-confirm floor (pay, delete, login, grant) still requires fresh confirmation.`
      : null,
    routeNeedsDataTransferPrecisionRules(route.kind) ? formatDataTransferPrecisionRulesBlock() : null,
    formatChatComputerTaskAutonomyPromptBlock(route),
    route.appAutomationRouteDecision ? formatAppAutomationRouteDecisionPromptBlock(route.appAutomationRouteDecision) : null,
    route.designExecutionPipeline ? `Design pipeline phases: ${route.designExecutionPipeline.phases.map((phase) => phase.id).join(' -> ')}` : null,
    route.surfacePlan ? `Surface order: ${[route.surfacePlan.primarySurface, ...route.surfacePlan.fallbackSurfaces].join(' -> ')}` : null,
    route.evidenceContract ? formatComputerTaskEvidenceContractPromptBlock(route.evidenceContract) : null,
    `Actionable desktop items: ${(route.actionItems || []).map((item, index) => `${index + 1}. ${item.label} [${item.tool}]`).join(' | ') || 'none'}`,
    `Recommended tools: ${route.recommendedTools.join(' | ') || 'none'}`,
    `Completion proof: ${route.completionProof.join(' | ') || 'exact blocker or final answer'}`,
    `Fallback pipelines: ${route.fallbackPipelineIds.join(' | ') || 'none'}`,
    'Use this route before generic chat. Execute actionable items in order; do not restate them as a phased plan or ask the user to confirm readiness when user effort is none. Keep the user view quiet unless approval, proof, or an actionable blocker is needed.',
  ].filter(Boolean).join('\n');
}
