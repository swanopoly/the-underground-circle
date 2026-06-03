import {
  buildAppAutomationControlSurfacePlan,
  buildAppAutomationResearchPromptBlock,
  buildAppAutomationRouteDecision,
  formatAppAutomationRouteDecisionPromptBlock,
} from './appAutomationControlSurfaces';
import {
  buildAppAdapterGapPlan,
  formatAppAdapterGapPromptBlock,
} from './appAdapterGapContract';
import {
  buildDesignAppAdapterGapPlan,
  buildDesignAppAdapterGapPromptBlock,
} from './designAppAdapterGaps';
import {
  buildDesignAppCreativeAiRecipePlan,
  buildDesignAppCreativeAiRecipePromptBlock,
} from './designAppCreativeAi';
import {
  buildDesignAppExecutionPipelinePlan,
  buildDesignAppExecutionPipelinePromptBlock,
} from './designAppExecutionPipeline';
import { applyAgentDevelopmentStandardsToPrompt } from './agentDevelopmentStandards';
import { buildGenericAppNavigatorRouteContext } from './genericAppNavigator';

export type AgentAppCapabilityBuildoutKind =
  | 'app_recipe'
  | 'desktop_adapter'
  | 'bridge_tool'
  | 'pipeline_strategy'
  | 'smoke_coverage'
  | 'unknown';

export type AgentAppCapabilityBuildoutRisk = 'low' | 'medium' | 'high';

export interface AgentAppCapabilityBuildoutInput {
  task: string;
  appName?: string;
  capabilityGap?: string;
  desiredOutcome?: string;
  currentPlanSummary?: string;
}

export interface AgentAppCapabilityBuildoutPolicy {
  kind: AgentAppCapabilityBuildoutKind;
  risk: AgentAppCapabilityBuildoutRisk;
  appName?: string;
  task: string;
  capabilityGap: string;
  desiredOutcome?: string;
  capabilityLadder: string[];
  researchChecklist: string[];
  guardrails: string[];
  verification: string[];
  outputContract: string[];
  prompt: string;
}

export type AgentAppCapabilityBuildoutResultStatus =
  | 'ready_to_retry'
  | 'blocked'
  | 'incomplete'
  | 'unknown';

export interface AgentAppCapabilityBuildoutResult {
  status: AgentAppCapabilityBuildoutResultStatus;
  summary: string | null;
  controlSurface: string | null;
  sourceRefs: string[];
  filesChanged: string[];
  retryPlan: string | null;
  verification: string | null;
  userActionNeeded: string | null;
  blockers: string[];
  missingEvidence: string[];
  verified: boolean;
  raw: string;
}

export interface AgentAppCapabilityOutcomeInput {
  strategyId?: string | null;
  previewLabel?: string | null;
  previewKind?: string | null;
  appAdapterMessage?: string | null;
  agentResponse?: string | null;
  errorMessage?: string | null;
  warnings?: string[];
}

export interface AgentAppCapabilityBuildoutStateHintInput {
  status?: string | null;
  message?: string | null;
  retryPlan?: string | null;
  userActionNeeded?: string | null;
  missingEvidence?: string[];
}

export interface AgentAppCapabilityBuildoutStateHints {
  phase: 'awaiting_capability_approval' | 'building_capability' | 'completed' | 'blocked' | null;
  nextSteps: string[];
  blockers: string[];
  suppressGenericRecovery: boolean;
}

export interface AgentAppCapabilityRetryPromptInput {
  task: string;
  appName?: string | null;
  summary?: string | null;
  controlSurface?: string | null;
  sourceRefs?: string[];
  filesChanged?: string[];
  retryPlan?: string | null;
  verification?: string | null;
  appAdapterMessage?: string | null;
  dispatchPrefix?: string | null;
}

export interface AgentAppCapabilityBuildoutSessionLike {
  sessionId?: string | null;
  task?: string | null;
  prompt?: string | null;
  recentActions?: string[] | null;
  lastAssistantMessage?: string | null;
  appCapabilityResultText?: string | null;
}

export interface AgentAppCapabilityBuildoutUserSummaryInput {
  status?: string | null;
  appName?: string | null;
  approvalId?: string | null;
  sessionId?: string | null;
  message?: string | null;
  summary?: string | null;
  retryPlan?: string | null;
  verification?: string | null;
  userActionNeeded?: string | null;
  missingEvidence?: string[];
  autoRetryStatus?: string | null;
}

export interface FormatAgentAppCapabilityBuildoutForUserOptions {
  includeTechnicalDetails?: boolean;
}

function clean(value: unknown, max = 6_000): string {
  return String(value || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMultiline(value: unknown, max = 6_000): string {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function inferAppNameForCapabilityBuildout(task: string, explicitAppName?: string): string | undefined {
  const provided = clean(explicitAppName, 120);
  if (provided) return provided;

  const text = clean(task, 500);
  const genericContext = buildGenericAppNavigatorRouteContext(text);
  if (genericContext.targetAppName !== 'Unfamiliar desktop app') return genericContext.targetAppName;
  const patterns = [
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 ._+-]{1,80}?)(?:\s+(?:app|application|window|program))?\s+(?:and|then|to|for|with)\b/i,
    /\b(?:in|inside|on|with|using)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 ._+-]{1,80}?)(?:\s+(?:app|application|window|program))?\s+(?:create|make|build|edit|update|export|save|click|type|fill|draw|design|run)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = clean(match?.[1], 80)
      .replace(/\b(?:a|an|the|my|this|that|current|active|desktop|native)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (candidate && !/\b(browser|website|webpage|site|page|file|folder|document|computer)\b/i.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

// Capability-gap language in an agent response: the run reports it lacks the
// adapter/tool/recipe to finish, so we escalate to building that capability.
const CAPABILITY_GAP_RE = /\b(?:unsupported|no (?:app )?(?:adapter|recipe|pipeline|connector|bridge|tool|capability)|missing (?:an? )?(?:app )?(?:adapter|recipe|pipeline|connector|bridge|tool|capability)|do(?:es)? not have|don'?t have|need(?:s|ed)? (?:an? )?(?:app )?(?:adapter|recipe|pipeline|connector|bridge|tool|capability))\b/i;
const CAPABILITY_BLOCKED_RE = /\b(?:can'?t|cannot|unable)\b.{0,120}\b(?:continue|complete|finish|control|execute|automate|use)\b/i;

// Strategies that should NOT escalate to building an app capability: read-only
// inspection has nothing to build, and asset acquisition owns its own dedicated
// connected-agent flow.
const NON_BUILDOUT_STRATEGIES = new Set(['desktop_readonly', 'agent_asset_acquisition']);

export function shouldRequestAgentAppCapabilityBuildoutFromOutcome(input: AgentAppCapabilityOutcomeInput): boolean {
  const strategyId = clean(input.strategyId);
  if (!strategyId || NON_BUILDOUT_STRATEGIES.has(strategyId)) return false;

  const hasError = Boolean(clean(input.errorMessage));
  const response = clean(input.agentResponse);
  const adapterMessage = clean(input.appAdapterMessage);

  // Strong, EXPLICIT capability-gap signal ("no adapter / missing tool /
  // unsupported"). Checked in both the agent response and the app-adapter
  // result, so a generic-app adapter that dead-ends routes to buildout even if
  // the agent never echoed it.
  const strongGap = (text: string) => !!text && CAPABILITY_GAP_RE.test(text);
  // Looser "can't continue/complete" hedge — only trusted for the generic
  // last-resort strategy. On a SPECIFIC strategy a successful run may hedge
  // ("couldn't use the official API, did it via the UI — done"), so trusting
  // the loose phrase there would spuriously trigger a buildout.
  const looseBlocked = (text: string) => !!text && CAPABILITY_BLOCKED_RE.test(text);

  // `universal_app_control` is the generic last-resort runtime: any failure —
  // empty response, a loose hedge, or an explicit gap — means the generic path
  // could not do it, so escalate to a purpose-built capability.
  if (strategyId === 'universal_app_control') {
    return hasError || !response
      || strongGap(response) || strongGap(adapterMessage)
      || looseBlocked(response) || looseBlocked(adapterMessage);
  }

  // Every other actionable app/desktop/browser strategy: escalate only on a
  // concrete failure or an EXPLICIT capability-gap signal — never on a loose
  // hedge in an otherwise-successful response. This lets a specific-but-
  // incomplete strategy (a creative, CAD, ops, or browser flow whose exact
  // adapter/recipe is missing) BUILD the capability and fulfil the request,
  // without false-triggering when the run actually succeeded.
  return hasError || strongGap(response) || strongGap(adapterMessage);
}

export function buildAgentAppCapabilityGapSummary(input: AgentAppCapabilityOutcomeInput): string {
  const parts = [
    'Computer task could not complete an unfamiliar app workflow through the existing generic app runtime.',
    `Strategy: ${clean(input.strategyId) || 'unknown'}.`,
    input.previewLabel || input.previewKind
      ? `Preview: ${[clean(input.previewLabel), clean(input.previewKind)].filter(Boolean).join(' ')}.`
      : '',
    input.appAdapterMessage ? `App adapter result: ${clean(input.appAdapterMessage, 800)}` : '',
    input.errorMessage ? `Agent/runtime error: ${clean(input.errorMessage, 800)}` : '',
    input.agentResponse ? `Agent response: ${clean(input.agentResponse, 800)}` : '',
    input.warnings && input.warnings.length > 0 ? `Warnings: ${input.warnings.slice(0, 4).map((item) => clean(item, 240)).filter(Boolean).join(' | ')}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function isNoneLike(value: string | null | undefined): boolean {
  const text = clean(value, 500).toLowerCase();
  return !text || /^(none|n\/a|na|not needed|no user action needed|nothing needed|no blockers?|not applicable)$/i.test(text);
}

function stripBuildoutTechnicalNoise(value: string | null | undefined, max = 320): string {
  const text = clean(value, 2_000)
    .replace(/\bAPP_CAPABILITY_(?:RESULT_JSON|SUMMARY|STATUS|CONTROL_SURFACE|SOURCE_REFS|FILES_CHANGED|RETRY_PLAN|VERIFICATION|USER_ACTION_NEEDED)\b:?/gi, '')
    .replace(/\b(?:session|approval)\s*(?:id)?\s*[:#]?\s*[a-z0-9_-]{8,}\b/gi, '')
    .replace(/\bConnected agents checked:.*$/i, '')
    .replace(/\bSent Codex app capability buildout task to\s+[^\s.]+\.?/i, 'Started a connected app capability buildout.')
    .replace(/\bLaunched Codex app capability buildout session(?:\s*\([^)]*\))?\.?/i, 'Started a connected app capability buildout.')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max).trim();
}

function appLabel(appName?: string | null): string {
  return clean(appName, 120) || 'this app';
}

export function formatAgentAppCapabilityBuildoutForUser(
  input: AgentAppCapabilityBuildoutUserSummaryInput | null | undefined,
  options: FormatAgentAppCapabilityBuildoutForUserOptions = {},
): string {
  if (!input?.status) return '';
  const status = clean(input.status, 80);
  const target = appLabel(input.appName);
  const userAction = isNoneLike(input.userActionNeeded) ? '' : stripBuildoutTechnicalNoise(input.userActionNeeded, 420);
  const summary = stripBuildoutTechnicalNoise(input.summary || input.message, 420);
  const retryPlan = isNoneLike(input.retryPlan) ? '' : stripBuildoutTechnicalNoise(input.retryPlan, 360);
  const technicalSuffix = options.includeTechnicalDetails
    ? [
        input.sessionId ? `- Session: ${clean(input.sessionId, 120)}` : '',
        input.approvalId ? `- Approval: ${clean(input.approvalId, 120)}` : '',
        input.verification ? `- Verification: ${stripBuildoutTechnicalNoise(input.verification, 360)}` : '',
      ].filter(Boolean).join('\n')
    : '';

  if (status === 'ready_to_retry') {
    if (input.autoRetryStatus === 'completed') return '';
    const lines = input.autoRetryStatus === 'running'
      ? [`- Added missing support for ${target}.`, '- Retrying now.']
      : [`- Added missing support for ${target}.`, retryPlan ? `- ${retryPlan}` : '- Ready to retry the task.'];
    return `**Use Computer**\n${lines.filter(Boolean).join('\n')}${technicalSuffix ? `\n${technicalSuffix}` : ''}`;
  }

  if (status === 'approval_required') {
    const lines = [
      `- ${target} needs a missing app capability before I can finish this task.`,
      '- Review the app capability buildout approval. After it is approved, I can retry.',
    ];
    return `**App support needs approval**\n${lines.join('\n')}${technicalSuffix ? `\n${technicalSuffix}` : ''}`;
  }

  if (status === 'requested') {
    const lines = [
      `- I handed the missing ${target} capability to a connected agent.`,
      '- I will retry when it reports that the capability is ready.',
    ];
    return `**App support is being built**\n${lines.join('\n')}${technicalSuffix ? `\n${technicalSuffix}` : ''}`;
  }

  if (status === 'blocked') {
    const lines = [
      userAction || summary || `I need user action before I can continue in ${target}.`,
      retryPlan,
    ].filter(Boolean).map((line) => `- ${line}`);
    return `**Needs attention**\n${lines.join('\n')}${technicalSuffix ? `\n${technicalSuffix}` : ''}`;
  }

  if (status === 'incomplete') {
    const missing = (input.missingEvidence || []).map((item) => stripBuildoutTechnicalNoise(item, 180)).filter(Boolean);
    const missingText = missing.length > 0
      ? `Missing: ${missing.join(', ')}.`
      : 'The connected buildout result is missing required proof.';
    const lines = [
      summary || `${target} support is not ready to retry yet.`,
      missingText,
      retryPlan || 'Ask the connected agent for source refs, chosen control surface, passing verification, and the retry plan.',
    ].filter(Boolean).map((line) => `- ${line}`);
    return `**Needs attention**\n${lines.join('\n')}${technicalSuffix ? `\n${technicalSuffix}` : ''}`;
  }

  if (status === 'failed') {
    const lines = [
      summary || `I could not start the missing ${target} app support buildout.`,
      retryPlan || 'Fix the blocker, then retry the same task.',
    ].filter(Boolean).map((line) => `- ${line}`);
    return `**Needs attention**\n${lines.join('\n')}${technicalSuffix ? `\n${technicalSuffix}` : ''}`;
  }

  return '';
}

function extractBuildoutSection(text: string, label: string): string | null {
  const labels = [
    'APP_CAPABILITY_SUMMARY',
    'APP_CAPABILITY_CONTROL_SURFACE',
    'APP_CAPABILITY_SOURCE_REFS',
    'FILES_CHANGED',
    'RETRY_PLAN',
    'VERIFICATION',
    'USER_ACTION_NEEDED',
    'APP_CAPABILITY_RESULT_JSON',
  ];
  const escaped = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*(?:${escaped})\\s*:?|$)`, 'i');
  const match = text.match(pattern);
  return match ? cleanMultiline(match[1], 4_000) : null;
}

function parseBuildoutList(value: unknown, maxItems = 40): string[] {
  const text = cleanMultiline(value, 2_000);
  if (isNoneLike(text)) return [];
  return text
    .split(/\n|,|;/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .map((line) => line.replace(/^`|`$/g, '').trim())
    .filter(Boolean)
    .filter((line) => !isNoneLike(line))
    .slice(0, maxItems);
}

function parseFilesChanged(value: unknown): string[] {
  return parseBuildoutList(value, 40);
}

function parseSourceRefs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return clean(item, 400);
        if (item && typeof item === 'object') {
          const label = clean((item as any).label || (item as any).title || (item as any).name, 160);
          const url = clean((item as any).url || (item as any).href || (item as any).sourceUrl, 240);
          return [label, url].filter(Boolean).join(' - ');
        }
        return '';
      })
      .filter(Boolean)
      .slice(0, 12);
  }
  return parseBuildoutList(value, 12);
}

function hasCredibleSourceRef(sourceRefs: string[]): boolean {
  return sourceRefs.some((ref) => (
    /^https?:\/\//i.test(ref)
    || /\b(?:official|docs?|documentation|manual|reference|api|sdk|source refs?)\b/i.test(ref)
    || /\b(?:src|docs|scripts|supabase|app|packages?)\//i.test(ref)
  ));
}

function parseJsonResult(text: string): Partial<AgentAppCapabilityBuildoutResult> | null {
  const rawJson = extractBuildoutSection(text, 'APP_CAPABILITY_RESULT_JSON');
  if (!rawJson) return null;
  const trimmed = rawJson.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      summary: clean((parsed as any).summary || (parsed as any).appCapabilitySummary, 2_000) || null,
      controlSurface: clean((parsed as any).controlSurface || (parsed as any).chosenControlSurface || (parsed as any).automationSurface, 1_000) || null,
      sourceRefs: parseSourceRefs((parsed as any).sourceRefs || (parsed as any).sourceReferences || (parsed as any).sources),
      filesChanged: Array.isArray((parsed as any).filesChanged)
        ? (parsed as any).filesChanged.map((item: unknown) => clean(item, 300)).filter(Boolean).slice(0, 40)
        : parseFilesChanged((parsed as any).filesChanged),
      retryPlan: clean((parsed as any).retryPlan, 2_000) || null,
      verification: clean((parsed as any).verification, 2_000) || null,
      userActionNeeded: clean((parsed as any).userActionNeeded, 2_000) || null,
    };
  } catch {
    return null;
  }
}

export function parseAgentAppCapabilityBuildoutResult(output: string): AgentAppCapabilityBuildoutResult {
  const raw = String(output || '');
  const json = parseJsonResult(raw);
  const summary = json?.summary || extractBuildoutSection(raw, 'APP_CAPABILITY_SUMMARY');
  const controlSurface = json?.controlSurface || extractBuildoutSection(raw, 'APP_CAPABILITY_CONTROL_SURFACE');
  const sourceRefs = json?.sourceRefs?.length ? json.sourceRefs : parseSourceRefs(extractBuildoutSection(raw, 'APP_CAPABILITY_SOURCE_REFS'));
  const filesChanged = json?.filesChanged?.length ? json.filesChanged : parseFilesChanged(extractBuildoutSection(raw, 'FILES_CHANGED'));
  const retryPlan = json?.retryPlan || extractBuildoutSection(raw, 'RETRY_PLAN');
  const verification = json?.verification || extractBuildoutSection(raw, 'VERIFICATION');
  const userActionNeeded = json?.userActionNeeded || extractBuildoutSection(raw, 'USER_ACTION_NEEDED');

  const blockers: string[] = [];
  if (!isNoneLike(userActionNeeded)) blockers.push(userActionNeeded as string);
  const verificationText = clean(verification, 2_000);
  const verificationBlocked = /\b(fail(?:ed|ure)?|blocked|blocker|error|not run|could not|cannot|unable|missing|needs? user|permission|license|login|credential|mfa|captcha)\b/i.test(verificationText);
  if (verificationText && verificationBlocked) blockers.push(verificationText);

  const verified = Boolean(verificationText)
    && !verificationBlocked
    && /\b(pass(?:ed)?|verified|success|succeeded|clean|ok|green)\b/i.test(verificationText);
  const hasRetryPlan = !isNoneLike(retryPlan);
  const hasControlSurface = !isNoneLike(controlSurface);
  const hasSourceEvidence = hasCredibleSourceRef(sourceRefs);
  const missingEvidence = [
    hasControlSurface ? '' : 'chosen control surface',
    hasSourceEvidence ? '' : 'official or repo source refs',
    hasRetryPlan ? '' : 'retry plan',
    verificationText ? '' : 'verification result',
    verificationText && !verified && !verificationBlocked ? 'passing verification result' : '',
  ].filter(Boolean);
  const hasAnyContract = Boolean(summary || controlSurface || sourceRefs.length > 0 || filesChanged.length > 0 || retryPlan || verification || userActionNeeded);
  const status: AgentAppCapabilityBuildoutResultStatus = blockers.length > 0
    ? 'blocked'
    : verified && hasRetryPlan && hasControlSurface && hasSourceEvidence
      ? 'ready_to_retry'
      : hasAnyContract
        ? 'incomplete'
        : 'unknown';

  return {
    status,
    summary: summary || null,
    controlSurface: clean(controlSurface, 1_000) || null,
    sourceRefs,
    filesChanged,
    retryPlan: hasRetryPlan ? clean(retryPlan, 2_000) : null,
    verification: verificationText || null,
    userActionNeeded: isNoneLike(userActionNeeded) ? null : clean(userActionNeeded, 2_000),
    blockers: Array.from(new Set(blockers.map((item) => clean(item, 800)).filter(Boolean))).slice(0, 6),
    missingEvidence: Array.from(new Set(missingEvidence.map((item) => clean(item, 160)).filter(Boolean))).slice(0, 6),
    verified,
    raw: clean(raw, 8_000),
  };
}

export function parseAgentAppCapabilityBuildoutResultFromSession(
  session: AgentAppCapabilityBuildoutSessionLike | null | undefined,
): AgentAppCapabilityBuildoutResult | null {
  if (!session) return null;
  const candidates = [
    session.appCapabilityResultText,
    session.lastAssistantMessage,
    ...(Array.isArray(session.recentActions) ? session.recentActions : []),
    session.task,
    session.prompt,
  ].map((item) => cleanMultiline(item, 8_000)).filter(Boolean);

  for (const candidate of candidates) {
    const parsed = parseAgentAppCapabilityBuildoutResult(candidate);
    if (parsed.status !== 'unknown') return parsed;
  }
  return null;
}

export function buildAgentAppCapabilityBuildoutStateHints(input: AgentAppCapabilityBuildoutStateHintInput): AgentAppCapabilityBuildoutStateHints {
  const status = clean(input.status, 80);
  const retryPlan = clean(input.retryPlan, 500) || 'Retry the same chat task after the missing capability is available.';
  const message = clean(input.message, 800);
  const userActionNeeded = clean(input.userActionNeeded, 500);
  if (status === 'approval_required') {
    return {
      phase: 'awaiting_capability_approval',
      nextSteps: ['Approve the app capability buildout request', retryPlan],
      blockers: ['Connected-agent app capability buildout is waiting for approval'],
      suppressGenericRecovery: true,
    };
  }
  if (status === 'requested') {
    return {
      phase: 'building_capability',
      nextSteps: ['Wait for the connected Codex buildout result', retryPlan],
      blockers: [],
      suppressGenericRecovery: true,
    };
  }
  if (status === 'failed') {
    return {
      phase: 'blocked',
      nextSteps: ['Fix the connected-agent buildout handoff blocker', retryPlan],
      blockers: [message || 'Connected-agent app capability buildout handoff failed'],
      suppressGenericRecovery: false,
    };
  }
  if (status === 'ready_to_retry') {
    return {
      phase: 'completed',
      nextSteps: [retryPlan],
      blockers: [],
      suppressGenericRecovery: true,
    };
  }
  if (status === 'incomplete') {
    const missing = (input.missingEvidence || []).map((item) => clean(item, 160)).filter(Boolean);
    return {
      phase: 'blocked',
      nextSteps: [
        'Ask the connected app-capability agent to return the missing proof contract',
        retryPlan,
      ],
      blockers: [
        missing.length > 0
          ? `Connected-agent app capability result is missing: ${missing.join(', ')}`
          : message || 'Connected-agent app capability result is incomplete',
      ],
      suppressGenericRecovery: false,
    };
  }
  if (status === 'blocked') {
    return {
      phase: 'blocked',
      nextSteps: [userActionNeeded || retryPlan],
      blockers: [userActionNeeded || message || 'Connected-agent app capability buildout is blocked'],
      suppressGenericRecovery: false,
    };
  }
  return {
    phase: null,
    nextSteps: [],
    blockers: [],
    suppressGenericRecovery: false,
  };
}

export function buildAgentAppCapabilityRetryPrompt(input: AgentAppCapabilityRetryPromptInput): string {
  const task = clean(input.task);
  const appName = clean(input.appName, 160);
  const summary = clean(input.summary, 1_200);
  const controlSurface = clean(input.controlSurface, 1_000);
  const retryPlan = clean(input.retryPlan, 1_200);
  const verification = clean(input.verification, 1_200);
  const appAdapterMessage = clean(input.appAdapterMessage, 1_200);
  const dispatchPrefix = cleanMultiline(input.dispatchPrefix, 4_000);
  const sourceRefs = (input.sourceRefs || []).map((item) => clean(item, 300)).filter(Boolean).slice(0, 8);
  const filesChanged = (input.filesChanged || []).map((item) => clean(item, 240)).filter(Boolean).slice(0, 12);

  return [
    dispatchPrefix,
    'CONNECTED APP CAPABILITY BUILDOUT READY',
    'A connected Codex agent reported that the missing desktop/app capability has been added or made available. Retry the user task once using the new recipe, adapter, bridge tool, or planner route.',
    appName ? `Target app: ${appName}` : '',
    summary ? `Buildout summary: ${summary}` : '',
    controlSurface ? `Chosen control surface: ${controlSurface}` : '',
    sourceRefs.length > 0 ? `Source refs: ${sourceRefs.join(' | ')}` : '',
    filesChanged.length > 0 ? `Files changed: ${filesChanged.join(', ')}` : '',
    verification ? `Buildout verification: ${verification}` : '',
    retryPlan ? `Retry plan: ${retryPlan}` : '',
    appAdapterMessage ? `Prior app adapter context: ${appAdapterMessage}` : '',
    '',
    'Retry constraints:',
    '- Re-observe app/window/a11y/screenshot state before any click, type, key, file, or bridge mutation.',
    '- Use approval-gated tools for side effects and stop if the app requires a login, license, private file, OS permission, payment, or destructive action.',
    '- Do not call agent.build_app_capability again during this retry; report the exact blocker instead.',
    '- If the new capability works, complete the task and summarize proof. If it does not, return the smallest concrete blocker and next change needed.',
    '',
    `USER COMPUTER TASK\n${task}`,
  ].filter(Boolean).join('\n');
}

export function classifyAgentAppCapabilityBuildout(input: AgentAppCapabilityBuildoutInput): AgentAppCapabilityBuildoutKind {
  const text = [input.task, input.capabilityGap, input.desiredOutcome, input.currentPlanSummary].map((value) => clean(value).toLowerCase()).join('\n');
  if (/\b(test|smoke|coverage|assert|regression)\b/.test(text)) return 'smoke_coverage';
  if (/\b(bridge|endpoint|desktop tool|a11y|accessibility|screenshot|mouse|keyboard|menu)\b/.test(text)) return 'bridge_tool';
  if (/\b(adapter|runtime|executecomputerapptask|computer app adapter|local intent|macro|recipe)\b/.test(text)) return 'desktop_adapter';
  if (/\b(strategy|planner|pipeline|routing|preflight|grounding)\b/.test(text)) return 'pipeline_strategy';
  if (/\b(app recipe|runbook|playbook|instructions|steps)\b/.test(text)) return 'app_recipe';
  return 'unknown';
}

function riskForBuildout(kind: AgentAppCapabilityBuildoutKind, text: string): AgentAppCapabilityBuildoutRisk {
  if (/\b(credentials?|password|secret|mfa|captcha|payment|purchase|delete|destructive|production|client|permit|manufacturing)\b/i.test(text)) return 'high';
  if (kind === 'bridge_tool' || kind === 'desktop_adapter' || kind === 'pipeline_strategy') return 'medium';
  return 'low';
}

function buildGuardrails(kind: AgentAppCapabilityBuildoutKind): string[] {
  const guardrails = [
    'Do not use credentials, bypass CAPTCHA/MFA, access private accounts, or take external side-effect actions in the target app.',
    'Do not run destructive git commands, reset unrelated work, delete user files, or overwrite app/runtime code outside the scoped capability.',
    'Preserve unrelated local changes and inspect existing roadmap ownership before adding new canonical paths.',
    'Prefer a generic, reusable app-control recipe before app-specific hardcoding.',
    'Keep any new app action read-first: observe app/window/a11y/screenshot state before click/type/key actions.',
    'If the target app requires a human license, login, private file, or OS permission, stop with the exact user action needed.',
  ];
  if (kind === 'desktop_adapter' || kind === 'bridge_tool') {
    guardrails.push('When adding desktop actions, gate mutations behind approval and include screenshot/a11y/file verification where relevant.');
  }
  if (kind === 'pipeline_strategy') {
    guardrails.push('When changing routing or planner code, add a smoke case that proves the unknown app prompt no longer falls back to plain chat.');
  }
  return guardrails;
}

function buildCapabilityLadder(kind: AgentAppCapabilityBuildoutKind): string[] {
  const ladder = [
    'Prefer structured app/vendor APIs, scripting surfaces, command interfaces, file formats, or plugin APIs before UI automation.',
    'For browser surfaces, prefer DOM/ARIA locators and Playwright-style role/name actions before selectors, screenshots, or coordinates.',
    'For native desktop surfaces, prefer accessibility tree, native menus, named fields, shortcuts, and app command lines before screenshots or coordinates.',
    'Use screenshot/vision only to inspect visual or canvas state, then convert the finding into the most semantic available action.',
    'Use coordinate mouse actions only after fresh screenshot and screen-size evidence, and only for the smallest reversible step.',
    'If no deterministic route exists, build a reusable recipe/adapter/bridge tool with focused smoke coverage before retrying the user task.',
  ];
  if (kind === 'bridge_tool') {
    ladder.unshift('Before adding a bridge endpoint, check whether the app already exposes a documented script/API command that can be called from the existing bridge.');
  }
  if (kind === 'desktop_adapter') {
    ladder.unshift('Before adding an app adapter branch, check whether the existing universal app strategy, grounding, or local intent macros can express the task generically.');
  }
  if (kind === 'pipeline_strategy') {
    ladder.unshift('Before changing routing, prove the current planner cannot route the task through an existing browser, desktop, file, or hybrid strategy.');
  }
  return ladder;
}

function buildResearchChecklist(kind: AgentAppCapabilityBuildoutKind, appName?: string): string[] {
  const target = appName ? `${appName} ` : '';
  const checklist = [
    `Search existing repo docs and code for a ${target}recipe, adapter, bridge endpoint, smoke, or app macro before creating new paths.`,
    `When network access is available, prefer official vendor, OS, or framework documentation for ${target}automation/scripting/control APIs before blogs or examples.`,
    'Check whether the app supports a documented scripting API, plugin API, AppleScript/Shortcuts action, CLI, command palette, file format, or import/export API.',
    'Record the chosen control surface and why lower-level UI automation was or was not needed.',
  ];
  if (kind === 'bridge_tool' || kind === 'desktop_adapter') {
    checklist.push('If adding a bridge or adapter, include the exact observation, action, verification, and failure shape that chat can reuse on the next retry.');
  }
  if (kind === 'app_recipe') {
    checklist.push('If producing a recipe only, include observe, act, verify, recover, stop, approval, and permission steps.');
  }
  return checklist;
}

function buildVerification(kind: AgentAppCapabilityBuildoutKind): string[] {
  const checks = [
    'Add or update a focused smoke test for the exact app-capability gap.',
    'Run the narrow smoke test and report pass/fail with the command.',
    'Run typecheck for touched TypeScript surfaces when code changed.',
    'Run git diff --check before handoff.',
  ];
  if (kind === 'desktop_adapter' || kind === 'bridge_tool') {
    checks.unshift('Verify the adapter refuses blind coordinate actions and requests fresh observations before mutation.');
  }
  if (kind === 'app_recipe') {
    checks.unshift('Produce a reusable app recipe/runbook with observe, act, verify, recover, and stop phases.');
  }
  return checks;
}

export function buildAgentAppCapabilityBuildoutPolicy(input: AgentAppCapabilityBuildoutInput): AgentAppCapabilityBuildoutPolicy {
  const task = clean(input.task);
  const appName = inferAppNameForCapabilityBuildout(task, input.appName);
  const capabilityGap = clean(input.capabilityGap) || 'The chat/app runtime does not yet have a reliable app-specific pipeline, adapter, recipe, or tool mapping for this requested task.';
  const desiredOutcome = clean(input.desiredOutcome) || undefined;
  const currentPlanSummary = clean(input.currentPlanSummary) || undefined;
  const kind = classifyAgentAppCapabilityBuildout({ ...input, task, appName, capabilityGap, desiredOutcome, currentPlanSummary });
  const risk = riskForBuildout(kind, [task, capabilityGap, desiredOutcome, currentPlanSummary].filter(Boolean).join('\n'));
  const controlSurfacePlan = buildAppAutomationControlSurfacePlan(task, appName ? { targetName: appName } : undefined);
  const routeDecision = buildAppAutomationRouteDecision(task, {
    preferred: appName ? { targetName: appName } : undefined,
    availableSurfaceIds: ['connected_agent_buildout'],
    allowConnectedAgentBuildout: true,
  });
  const appAutomationResearchPromptBlock = buildAppAutomationResearchPromptBlock(task, {
    preferred: appName ? { targetName: appName } : undefined,
  });
  const designAdapterGapPlan = buildDesignAppAdapterGapPlan(task);
  const designAdapterGapPromptBlock = buildDesignAppAdapterGapPromptBlock(task, { maxGaps: 4 });
  // Generic, app-agnostic gap contract — the fallback for any non-Adobe app so
  // the chat can still navigate/find/research/act + drive a structured buildout
  // (P3.4). Adobe tasks keep their richer design-specific contract above.
  const genericAppGapPlan = designAdapterGapPlan
    ? null
    : buildAppAdapterGapPlan(task, appName ? { appName } : undefined);
  const genericAppGapPromptBlock = formatAppAdapterGapPromptBlock(genericAppGapPlan);
  const designCreativeAiRecipePlan = buildDesignAppCreativeAiRecipePlan(task);
  const designCreativeAiRecipePromptBlock = buildDesignAppCreativeAiRecipePromptBlock(task, { maxRecipes: 4 });
  const designExecutionPipelinePlan = buildDesignAppExecutionPipelinePlan(task);
  const designExecutionPipelinePromptBlock = buildDesignAppExecutionPipelinePromptBlock(task, { maxPhases: 8 });
  const capabilityLadder = buildCapabilityLadder(kind);
  const researchChecklist = uniqueStrings([
    ...buildResearchChecklist(kind, appName),
    ...controlSurfacePlan.buildoutChecklist,
    ...controlSurfacePlan.sourceRefs.map((ref) => `Use source ref: ${ref.label} - ${ref.url} (${ref.takeaway})`),
    ...(designAdapterGapPlan?.sourceRefs || []).map((ref) => `Use design-app gap source ref: ${ref.label} - ${ref.url} (${ref.takeaway})`),
    ...(genericAppGapPlan?.sourceRefs || []).map((ref) => `Use app-control gap source ref: ${ref.label} - ${ref.url} (${ref.takeaway})`),
    ...(genericAppGapPlan ? genericAppGapPlan.contract.researchPlan.map((item) => `Research before guessing: ${item}`) : []),
    ...(designCreativeAiRecipePlan?.buildoutTools || []).map((tool) => `Satisfy creative-AI recipe buildout tool: ${tool}`),
    ...(designCreativeAiRecipePlan?.recoveryHints || []).map((hint) => `Carry creative-AI recovery hint into retry behavior: ${hint}`),
    ...(designExecutionPipelinePlan?.requiredToolSequence || []).map((tool) => `Preserve design execution pipeline tool order around: ${tool}`),
  ]);
  const guardrails = buildGuardrails(kind);
  const verification = uniqueStrings([
    ...buildVerification(kind),
    ...(designCreativeAiRecipePlan
      ? ['Verify the creative-AI recipe with generation/action receipt, app inventory, proof export, and fail-closed recovery evidence.']
      : []),
  ]);
  const outputContract = [
    'APP_CAPABILITY_SUMMARY: what was missing and what was added or proposed.',
    'APP_CAPABILITY_CONTROL_SURFACE: the chosen deterministic control surface, such as official API, script, CLI, app command line, accessibility tree, menu/shortcut recipe, browser DOM/ARIA, or screenshot/coordinate fallback.',
    'APP_CAPABILITY_SOURCE_REFS: source refs used to choose the control surface; prefer official/vendor/OS/framework docs or existing repo paths.',
    'FILES_CHANGED: exact repo paths changed, or "none" if this is a recipe-only response.',
    'RETRY_PLAN: exact user/chat prompt that should be retried after the capability is available.',
    'VERIFICATION: commands run and their results, or exact blockers.',
    'USER_ACTION_NEEDED: permissions, app install/login/license, private file, or approval needed before execution can continue.',
    'APP_CAPABILITY_RESULT_JSON: compact JSON with keys summary, controlSurface, sourceRefs, filesChanged, retryPlan, verification, userActionNeeded.',
  ];

  const basePrompt = [
    'You are Codex attached to The Underground Circle app.',
    'Task: build or propose the missing app-control capability needed so chat/SwanBot can complete a user request in an unfamiliar desktop/native app.',
    `Original user task: ${task}`,
    appName ? `Target app: ${appName}` : 'Target app: infer from the task and state your confidence.',
    `Capability gap: ${capabilityGap}`,
    desiredOutcome ? `Desired outcome: ${desiredOutcome}` : '',
    currentPlanSummary ? `Current planner/runtime summary: ${currentPlanSummary}` : '',
    `Classified buildout kind: ${kind}`,
    `Risk tier: ${risk}`,
    designAdapterGapPromptBlock ? `\n${designAdapterGapPromptBlock}` : '',
    genericAppGapPromptBlock ? `\n${genericAppGapPromptBlock}` : '',
    designCreativeAiRecipePromptBlock ? `\n${designCreativeAiRecipePromptBlock}` : '',
    designExecutionPipelinePromptBlock ? `\n${designExecutionPipelinePromptBlock}` : '',
    '',
    'Guardrails:',
    ...guardrails.map((item) => `- ${item}`),
    '',
    'Implementation guidance:',
    '- Read AGENTS.md and docs/AGENTS_ROADMAP.md ownership before adding files.',
    '- Prefer extending existing app-control strategy, preflight, grounding, local desktop intent, app adapter, or OpenSwan tool routing.',
    '- If the app can be handled generically, add a reusable generic path instead of a one-off app branch.',
    '- If code changes are too risky or blocked, produce a precise recipe and smoke-test plan for the next run.',
    '',
    'Capability ladder:',
    ...capabilityLadder.map((item) => `- ${item}`),
    '',
    'Research-backed control surface order:',
    `- Target: ${controlSurfacePlan.targetName}`,
    `- Task family: ${controlSurfacePlan.taskFamily}`,
    ...controlSurfacePlan.candidates.map((candidate, index) => `- ${index + 1}. ${candidate.label}: ${candidate.bestFor.join('; ')}`),
    '',
    'Control-surface fail-safe rules:',
    ...controlSurfacePlan.failSafeRules.map((item) => `- ${item}`),
    '',
    formatAppAutomationRouteDecisionPromptBlock(routeDecision),
    '',
    'Official-source research checklist:',
    ...researchChecklist.map((item) => `- ${item}`),
    '',
    appAutomationResearchPromptBlock,
    '',
    'Verification requirements:',
    ...verification.map((item) => `- ${item}`),
    '',
    'Output contract:',
    ...outputContract.map((item) => `- ${item}`),
  ].filter(Boolean).join('\n');
  const prompt = applyAgentDevelopmentStandardsToPrompt(basePrompt, {
    taskDescription: [
      task,
      capabilityGap,
      desiredOutcome || '',
      'TypeScript app/runtime code buildout for local desktop/app automation.',
    ].filter(Boolean).join('\n'),
    label: 'The connected app-capability buildout agent must follow these repo standards.',
  });

  return {
    kind,
    risk,
    appName,
    task,
    capabilityGap,
    desiredOutcome,
    capabilityLadder,
    researchChecklist,
    guardrails,
    verification,
    outputContract,
    prompt,
  };
}

export function formatAgentAppCapabilityBuildoutPolicySummary(policy: AgentAppCapabilityBuildoutPolicy): string {
  return [
    `App capability buildout: ${policy.kind} (${policy.risk} risk).`,
    policy.appName ? `Target app: ${policy.appName}.` : 'Target app: infer from task.',
    `Verify with: ${policy.verification.slice(-3).join(' | ')}.`,
  ].join(' ');
}
