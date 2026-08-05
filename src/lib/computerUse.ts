/**
 * computerUse.ts — Computer-Use Engine
 *
 * Plans browser work, executes only read-only observations through a
 * bridge-backed runtime, and hands every mutation to the typed OpenSwan loop.
 * The local Playwright bridge remains the default observation backend, while
 * Browserbase Stagehand is restricted to observe/extract/screenshot.
 */

import { getCircleIntegration, getCircleIntegrationSecretValues } from './circleIntegrations';
import { getSwanBotResponse as getAIResponse } from './swanbot';
import { analyzeBrowserTask, type BrowserTaskIntent } from './browserTaskIntent';
import { buildBrowserbaseWorkflowPromptBlock } from './browserbaseWorkflowIntent';
import { buildFallbackBrowserActions as buildPureFallbackBrowserActions } from './browserActionFallback';
import { chooseBrowserAutomationBackendPreference, type BrowserAutomationBackendPreference } from './browserAutomationBackend';
import { getBridgeUrl } from './bridgeEnvironment';
import { fetchBridgeAuthenticated } from './bridgeAuth';
import { ensureDesktopBridgePaired } from './desktopBridge';
import { detectAutomationVerificationGate } from './desktopAutomationSafety';
import type { ComputerAppPreflight } from './computerAppPreflight';
import {
  buildComputerAppGroundingPlan,
  buildComputerAppGroundingTrace,
  type ComputerAppGroundingTrace,
} from './computerAppGrounding';
import {
  describeDomSnapshotTruncation,
  domSnapshot as localBrowserDomSnapshot,
  renderBrowserTree,
  screenshot as localBrowserScreenshot,
} from './browserBridge';

export type ComputerUsePermission = 'none' | 'ask_every_time' | 'ask_for_new_sites' | 'trusted';
export type ComputerUseBackend = 'playwright_bridge' | 'browserbase_stagehand';

export type BrowserMutationActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'press_key'
  | 'scroll';

export type BrowserReadOnlyActionType =
  | 'observe'
  | 'extract'
  | 'screenshot'
  | 'wait';

export type BrowserMutationRuntimeTool =
  | 'browser.open_url'
  | 'browser.click_role'
  | 'browser.fill_field'
  | 'browser.select_option'
  | 'browser.press_key';

export type BrowserMutationRuntimeRequirement =
  | 'authenticated_user_id'
  | 'circle_id'
  | 'persisted_agent_run_id'
  | 'provider_tool_use_id'
  | 'tool_iteration'
  | 'exact_openswan_runtime_approval';

/** Compatibility alias for callers that adopted the first select-only handoff. */
export type BrowserSelectRuntimeRequirement = BrowserMutationRuntimeRequirement;

export interface BrowserActionRuntimeHandoff {
  kind: 'openswan_typed_tool';
  tool: BrowserMutationRuntimeTool;
  legacyActionType: BrowserMutationActionType;
  credentialTool?: 'browser.fill_credential_field';
  sourceLane: 'legacy_computer_use';
  reasonCode: 'sealed_runtime_identity_required';
  executable: false;
  carriesRawInput: false;
  requiredContext: BrowserMutationRuntimeRequirement[];
  message: string;
}

export interface BrowserAction {
  id: string;
  type: BrowserMutationActionType | BrowserReadOnlyActionType;
  target?: string;
  value?: string;
  description: string;
  requiresApproval: boolean;
  approvalReason?: string;
  blockedReason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  screenshotBefore?: string;
  screenshotAfter?: string;
  output?: string;
  error?: string;
  executedAt?: string;
  runtimeHandoff?: BrowserActionRuntimeHandoff;
}

export interface ComputerUseSession {
  id: string;
  agentName: string;
  task: string;
  intent?: BrowserTaskIntent;
  permission: ComputerUsePermission;
  actions: BrowserAction[];
  status: 'planning' | 'awaiting_approval' | 'executing' | 'paused' | 'completed' | 'failed';
  currentUrl?: string;
  startedAt: string;
  approvedDomains: string[];
  circleId?: string;
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  backendPreference?: BrowserAutomationBackendPreference;
  backendSessionId?: string;
  backendLiveUrl?: string;
  sourceMessageId?: string;
  sourceRunId?: string | null;
  sourcePlanId?: string;
  recommendedPermission?: ComputerUsePermission;
}

export interface ComputerUseResult {
  success: boolean;
  message: string;
  screenshotUrl?: string;
  actions: BrowserAction[];
  currentUrl?: string;
  backendSessionId?: string;
  backendLiveUrl?: string;
  /**
   * Set when executePlan halted at the first unapproved step instead of
   * finishing. The plan is resumable: approve the referenced action in the
   * Computer Use panel and resume — completed steps are skipped on re-run.
   * Consumers that ignore this field still see `success: false` with the
   * pause message (terminal-pending, never a silent partial run).
   */
  pendingApproval?: { index: number; actionId: string; description: string };
}

export interface ComputerUsePlanSummary {
  ok: boolean;
  task: string;
  intent: BrowserTaskIntent;
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  backendPreference?: BrowserAutomationBackendPreference;
  actions: BrowserAction[];
  requiresApproval: boolean;
  summaryText: string;
  recommendedPermission: ComputerUsePermission;
  computerAppPreflight?: ComputerAppPreflight | null;
  computerAppGroundingTrace?: ComputerAppGroundingTrace | null;
}

export interface BrowserPlanCardData {
  planId: string;
  task: string;
  intent?: BrowserTaskIntent;
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  backendPreference?: BrowserAutomationBackendPreference;
  requiresApproval: boolean;
  recommendedPermission?: ComputerUsePermission;
  status: 'planned' | 'approval_requested' | 'launched' | 'completed' | 'failed';
  launchedAt?: string;
  completedAt?: string;
  backendSessionId?: string;
  backendLiveUrl?: string;
  actions: Array<Pick<BrowserAction, 'id' | 'type' | 'target' | 'value' | 'description' | 'requiresApproval' | 'approvalReason' | 'blockedReason' | 'runtimeHandoff'>>;
  computerAppPreflight?: ComputerAppPreflight | null;
  computerAppGroundingTrace?: ComputerAppGroundingTrace | null;
}

export type BrowserPlanEventKind =
  | 'planned'
  | 'approval_requested'
  | 'launched'
  | 'completed'
  | 'failed'
  | 'opened_live_session'
  | 'cancelled';

export interface BrowserPlanEvent {
  id: string;
  planId: string;
  kind: BrowserPlanEventKind;
  at: string;
  summary: string;
  backend?: ComputerUseBackend;
  backendLabel?: string;
  backendSessionId?: string;
  backendLiveUrl?: string;
}

export interface BrowserSessionRecord {
  id: string;
  planId?: string;
  task: string;
  intent?: BrowserTaskIntent;
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  backendPreference?: BrowserAutomationBackendPreference;
  status: ComputerUseSession['status'];
  startedAt: string;
  completedAt?: string;
  currentUrl?: string;
  backendSessionId?: string;
  backendLiveUrl?: string;
  recommendedPermission?: ComputerUsePermission;
  actions: BrowserAction[];
}

interface ComputerUseBackendContext {
  backend: ComputerUseBackend;
  label: string;
  details?: string;
  browserbase?: {
    apiKey: string;
    projectId: string;
    region?: string;
  };
}

interface StagehandRunnerPayload {
  mode: 'init' | 'action' | 'screenshot';
  apiKey: string;
  projectId: string;
  region?: string;
  sessionId?: string;
  action?: Pick<BrowserAction, 'target' | 'value' | 'description'> & {
    type: Extract<BrowserReadOnlyActionType, 'observe' | 'extract'>;
  };
}

interface StagehandRunnerResponse {
  ok: boolean;
  error?: string;
  sessionId?: string;
  currentUrl?: string;
  screenshot?: string | null;
  output?: string | null;
}

type BrowserActionSafetyAssessment = {
  requiresApproval: boolean;
  approvalReason?: string;
  blockedReason?: string;
};

const BRIDGE_PORT = 7778;
const BRIDGE_TIMEOUT = 15000;
const STAGEHAND_TIMEOUT = 120000;
const LEGACY_SELECT_BLOCKED_REASON =
  'Dropdown selection is unavailable in the legacy Computer Use lane. Continue through the typed OpenSwan browser.select_option tool so it can freshly observe one native select, obtain exact approval, claim the durable action call, dispatch once, and verify the selected option.';
const LEGACY_MUTATION_ACTION_TYPES = new Set<BrowserMutationActionType>([
  'navigate',
  'click',
  'fill',
  'select',
  'press_key',
  'scroll',
]);
const LEGACY_MUTATION_TOOL_BY_ACTION: Readonly<Record<
  BrowserMutationActionType,
  BrowserMutationRuntimeTool
>> = Object.freeze({
  navigate: 'browser.open_url',
  click: 'browser.click_role',
  fill: 'browser.fill_field',
  select: 'browser.select_option',
  press_key: 'browser.press_key',
  scroll: 'browser.press_key',
});
const LEGACY_MUTATION_MESSAGE_BY_ACTION: Readonly<Record<
  BrowserMutationActionType,
  string
>> = Object.freeze({
  navigate:
    'Navigation is unavailable in the legacy Computer Use lane. Continue through the typed OpenSwan browser.open_url tool with current authenticated run and approval context.',
  click:
    'Browser clicking is unavailable in the legacy Computer Use lane. Continue through the typed OpenSwan browser.click_role tool after a fresh DOM observation and exact approval.',
  fill:
    'Browser field input is unavailable in the legacy Computer Use lane. Continue through typed OpenSwan browser.fill_field after a fresh DOM observation and exact approval. Credential input must be recollected through the sealed vault-backed browser.fill_credential_field path; this handoff carries no raw value.',
  select: LEGACY_SELECT_BLOCKED_REASON,
  press_key:
    'Browser key input is unavailable in the legacy Computer Use lane. Continue through the typed OpenSwan browser.press_key tool with current authenticated run, provider-call, and approval context.',
  scroll:
    'Browser scrolling is unavailable in the legacy Computer Use lane. Re-plan the exact direction as a typed OpenSwan browser.press_key PageUp/PageDown call with current authenticated run and approval context.',
});
const LEGACY_MUTATION_REQUIRED_CONTEXT: BrowserMutationRuntimeRequirement[] = [
  'authenticated_user_id',
  'circle_id',
  'persisted_agent_run_id',
  'provider_tool_use_id',
  'tool_iteration',
  'exact_openswan_runtime_approval',
];

export function isComputerUseMutationActionType(
  value: unknown,
): value is BrowserMutationActionType {
  return typeof value === 'string'
    && LEGACY_MUTATION_ACTION_TYPES.has(value as BrowserMutationActionType);
}

export function buildComputerUseMutationRuntimeHandoff(
  actionType: BrowserMutationActionType,
): BrowserActionRuntimeHandoff {
  if (!isComputerUseMutationActionType(actionType)) {
    throw new Error('Unsupported legacy Computer Use mutation handoff type.');
  }
  return {
    kind: 'openswan_typed_tool',
    tool: LEGACY_MUTATION_TOOL_BY_ACTION[actionType],
    legacyActionType: actionType,
    ...(actionType === 'fill'
      ? { credentialTool: 'browser.fill_credential_field' as const }
      : {}),
    sourceLane: 'legacy_computer_use',
    reasonCode: 'sealed_runtime_identity_required',
    executable: false,
    carriesRawInput: false,
    requiredContext: [...LEGACY_MUTATION_REQUIRED_CONTEXT],
    message: LEGACY_MUTATION_MESSAGE_BY_ACTION[actionType],
  };
}

/** Compatibility wrapper for the original select-only handoff API. */
export function buildComputerUseSelectRuntimeHandoff(): BrowserActionRuntimeHandoff {
  return buildComputerUseMutationRuntimeHandoff('select');
}

function generateId(): string {
  return `cu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function assessBrowserActionSafety(
  intent: BrowserTaskIntent | undefined,
  action: Pick<BrowserAction, 'type' | 'description' | 'target' | 'value'>,
): BrowserActionSafetyAssessment {
  if (isComputerUseMutationActionType(action.type)) {
    const runtimeHandoff = buildComputerUseMutationRuntimeHandoff(action.type);
    return {
      requiresApproval: false,
      blockedReason: runtimeHandoff.message,
    };
  }

  const verificationGate = detectAutomationVerificationGate([
    action.description,
    action.target,
    action.value,
  ]);
  if (verificationGate) {
    return {
      requiresApproval: false,
      blockedReason: `${verificationGate.label}: ${verificationGate.pauseInstruction}`,
    };
  }

  const targetDomain = action.target && /^https?:\/\//i.test(action.target) ? extractDomain(action.target) : null;
  if (intent?.allowedDomains?.length && targetDomain && !intent.allowedDomains.includes(targetDomain)) {
    return {
      requiresApproval: false,
      blockedReason: `Navigation outside approved domains is blocked (${targetDomain})`,
    };
  }

  if (!intent) {
    return { requiresApproval: false };
  }

  if (intent.requiresLogin && (action.type === 'observe' || action.type === 'extract')) {
    return {
      requiresApproval: true,
      approvalReason: 'This step may enter credentials, read account data, or interact with an authenticated session.',
    };
  }

  return { requiresApproval: false };
}

async function probeBridge(): Promise<boolean> {
  const bridgeUrl = getBridgeUrl(BRIDGE_PORT);
  if (!bridgeUrl) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${bridgeUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveComputerUseBackend(circleId?: string, intent?: BrowserTaskIntent): Promise<ComputerUseBackendContext> {
  if (!circleId) {
    return { backend: 'playwright_bridge', label: 'Local Browser Bridge', details: 'No circle context provided' };
  }

  const integration = await getCircleIntegration(circleId, 'browserbase');
  if (!integration || integration.is_active === false || integration.status === 'disabled') {
    return { backend: 'playwright_bridge', label: 'Local Browser Bridge' };
  }

  const secrets = await getCircleIntegrationSecretValues(integration.id);
  const apiKey = String(secrets.api_key || '').trim();
  const projectId = String(secrets.project_id || '').trim();
  const region = String(secrets.session_region || '').trim() || undefined;

  if (!apiKey || !projectId) {
    return {
      backend: 'playwright_bridge',
      label: 'Local Browser Bridge',
      details: 'Browserbase connected, but api_key/project_id are incomplete',
    };
  }

  const browserbaseDecision = chooseBrowserAutomationBackendPreference(intent);
  if (browserbaseDecision.backend !== 'browserbase_stagehand') {
    return {
      backend: 'playwright_bridge',
      label: 'Local Browser Bridge',
      details: `Browserbase connected; local selected for cost control. ${browserbaseDecision.reason}`,
    };
  }

  return {
    backend: 'browserbase_stagehand',
    label: 'Browserbase Stagehand',
    details: `${integration.display_name || String(integration.metadata?.workspaceName || 'Connected Browserbase workspace')} — ${browserbaseDecision.reason}`,
    browserbase: { apiKey, projectId, region },
  };
}

export async function createSession(
  agentName: string,
  task: string,
  permission: ComputerUsePermission,
  opts?: { circleId?: string; intent?: BrowserTaskIntent; recommendedPermission?: ComputerUsePermission }
): Promise<ComputerUseSession> {
  const intent = opts?.intent || analyzeBrowserTask(task);
  const backend = await resolveComputerUseBackend(opts?.circleId, intent);
  const backendPreference = chooseBrowserAutomationBackendPreference(intent);
  return {
    id: generateId(),
    agentName,
    task,
    intent,
    permission,
    actions: [],
    status: 'planning',
    startedAt: new Date().toISOString(),
    approvedDomains: intent.allowedDomains ? [...intent.allowedDomains] : [],
    circleId: opts?.circleId,
    backend: backend.backend,
    backendLabel: backend.label,
    backendDetails: backend.details,
    backendPreference,
    recommendedPermission: opts?.recommendedPermission,
  };
}

const COMPUTER_USE_ACTION_TYPES = new Set<BrowserAction['type']>([
  'navigate',
  'observe',
  'extract',
  'click',
  'fill',
  'screenshot',
  'select',
  'press_key',
  'wait',
  'scroll',
]);

type BrowserActionPlanInput = Partial<
  Pick<
    BrowserAction,
    'id' | 'type' | 'target' | 'value' | 'description' | 'approvalReason' | 'blockedReason'
  >
> & {
  type?: unknown;
  target?: unknown;
  value?: unknown;
  description?: unknown;
};

function optionalPlanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function withoutPersistedMutationInput(action: BrowserAction): BrowserAction {
  if (!isComputerUseMutationActionType(action.type)) return action;
  return {
    ...action,
    // A legacy value can be a password, token, typed draft, option, or key
    // sequence. The typed runtime must re-derive it from the current user turn
    // or vault; a plan card/session must never become a secret-bearing relay.
    value: undefined,
    runtimeHandoff: buildComputerUseMutationRuntimeHandoff(action.type),
  };
}

function normalizeComputerUsePlannedAction(
  rawAction: BrowserActionPlanInput,
  index: number,
  intent?: BrowserTaskIntent,
): BrowserAction {
  const actionType = COMPUTER_USE_ACTION_TYPES.has(rawAction.type as BrowserAction['type'])
    ? rawAction.type as BrowserAction['type']
    : 'navigate';
  const target = optionalPlanText(rawAction.target);
  const value = isComputerUseMutationActionType(actionType)
    ? undefined
    : optionalPlanText(rawAction.value);
  const base: Pick<BrowserAction, 'type' | 'target' | 'value' | 'description'> = {
    type: actionType,
    target,
    value,
    description: optionalPlanText(rawAction.description) || `Step ${index + 1}`,
  };
  const safety = assessBrowserActionSafety(intent, base);
  const blockedReason = safety.blockedReason || optionalPlanText(rawAction.blockedReason);
  const normalized: BrowserAction = {
    id: optionalPlanText(rawAction.id) || `action_${Date.now()}_${index}`,
    ...base,
    requiresApproval: safety.requiresApproval,
    approvalReason: safety.approvalReason || optionalPlanText(rawAction.approvalReason),
    blockedReason,
    status: blockedReason ? 'rejected' : 'pending',
    runtimeHandoff: isComputerUseMutationActionType(actionType)
      ? buildComputerUseMutationRuntimeHandoff(actionType)
      : undefined,
  };
  return withoutPersistedMutationInput(normalized);
}

export async function createSessionFromBrowserPlan(
  agentName: string,
  permission: ComputerUsePermission,
  plan: BrowserPlanCardData,
  opts?: { circleId?: string; sourceMessageId?: string; sourceRunId?: string | null },
): Promise<ComputerUseSession> {
  const session = await createSession(agentName, plan.task, permission, {
    circleId: opts?.circleId,
    intent: plan.intent,
    recommendedPermission: plan.recommendedPermission,
  });
  session.backend = plan.backend;
  session.backendLabel = plan.backendLabel;
  session.backendDetails = plan.backendDetails;
  session.backendPreference = plan.backendPreference;
  session.actions = plan.actions.map((action, index) => {
    // Rebuild safety and handoff metadata from the action type. Persisted
    // runtimeHandoff/value fields are never trusted or replayed.
    const normalized = normalizeComputerUsePlannedAction(action, index, plan.intent);
    const status =
      normalized.blockedReason
        ? 'rejected'
        : permission === 'trusted' && !normalized.requiresApproval
          ? 'approved'
          : 'pending';
    return {
      ...normalized,
      status,
    };
  });
  session.status = session.actions.some((action) => action.status === 'pending')
    ? 'awaiting_approval'
    : permission === 'trusted'
      ? 'executing'
      : 'awaiting_approval';
  session.sourceMessageId = opts?.sourceMessageId;
  session.sourceRunId = opts?.sourceRunId || null;
  session.sourcePlanId = plan.planId;
  session.recommendedPermission = plan.recommendedPermission;
  return session;
}

export async function planActions(
  task: string,
  context?: string,
  intent?: BrowserTaskIntent,
  opts?: { circleId?: string; userId?: string; model?: string | null },
): Promise<BrowserAction[]> {
  const analyzedIntent = intent || analyzeBrowserTask(task);
  const planPrompt = `You are a browser automation planner. You need to complete this task using a web browser.

TASK: ${task}
${context ? `\nCONTEXT: ${context}` : ''}
INTENT:
${JSON.stringify({
  mode: analyzedIntent.mode,
  risk: analyzedIntent.risk,
  requiresLogin: analyzedIntent.requiresLogin,
  hasSideEffects: analyzedIntent.hasSideEffects,
  allowedDomains: analyzedIntent.allowedDomains,
  startUrls: analyzedIntent.startUrls,
  completionCriteria: analyzedIntent.completionCriteria,
  browserbaseWorkflow: {
    kind: analyzedIntent.browserbaseWorkflow.kind,
    label: analyzedIntent.browserbaseWorkflow.label,
    recommendedBackend: analyzedIntent.browserbaseWorkflow.recommendedBackend,
    expectsStructuredOutput: analyzedIntent.browserbaseWorkflow.expectsStructuredOutput,
    requiresSubmissionVerification: analyzedIntent.browserbaseWorkflow.requiresSubmissionVerification,
  },
}, null, 2)}

${buildBrowserbaseWorkflowPromptBlock(analyzedIntent.browserbaseWorkflow)}

Break this into specific browser actions. Return ONLY a JSON array (no markdown, no explanation).
Each action has: type, target, value (optional), description.

Valid executable read-only types: observe, extract, screenshot, wait
Valid NON-EXECUTABLE mutation handoff markers: navigate, click, fill, select, press_key, scroll

Rules:
- Follow any Computer/App Grounding section in CONTEXT before proposing mutation handoffs.
- If CONTEXT says the next safe action is an observation, start with observe/extract/screenshot instead of mutation.
- This planner cannot execute navigate, click, fill, select, press_key, or scroll because it does not carry authenticated typed-loop user/circle/run/provider-call identity, a fresh exact observation, or exact OpenSwan approval. Represent each as a NON-EXECUTABLE marker. Execution stops visibly at the first marker and must continue through browser.open_url, browser.click_role, browser.fill_field (or vault-backed browser.fill_credential_field), browser.select_option, or browser.press_key.
- Never include passwords, tokens, credentials, or text-to-enter in a mutation marker. Omit value for fill/select/key/scroll markers; the typed runtime must re-derive exact arguments from the current user request or approved vault entry.
- Never plan to solve CAPTCHA, MFA, OTP, Cloudflare, Turnstile, or "I am not a robot"; plan a pause/blocked step instead.
- Prefer the explicit start URL when one is present.
- Keep actions inside the allowed domains unless the task clearly requires otherwise.
- For web data retrieval, keep the plan narrow: navigation handoff, wait for rendered content when needed, extract the requested fields, and add a screenshot only when visual proof matters.
- Stagehand is read-only in this lane: use it only for observe/extract/screenshot. Represent every action-sized change as a typed-tool handoff.
- For form submission, include field-input handoff markers, a review screenshot before the final submit handoff, and a post-submit observation step for the typed runtime to perform.
- If the task appears transactional or login-related, stop before final submission and add a screenshot step near the end.
- If the task is read-only or extract-focused, end with a screenshot after reaching the requested result.

Example:
[
  {"type":"navigate","target":"https://example.com","description":"Open example.com"},
  {"type":"observe","description":"Observe the visible navigation and form controls"},
  {"type":"click","target":"#login-button","description":"Click the login button"},
  {"type":"fill","target":"#email","description":"Continue the requested email field input in typed OpenSwan; value omitted"},
  {"type":"extract","description":"Extract the requested records as structured JSON"},
  {"type":"screenshot","description":"Capture the result"}
]

Return ONLY the JSON array:`;

  let parsed: any[] = [];
  const planningUserId = optionalPlanText(opts?.userId);
  if (planningUserId) {
    const aiResponse = await getAIResponse(planPrompt, {
      userId: planningUserId,
      circleId: opts?.circleId,
      userName: 'ComputerUse',
      model: opts?.model || undefined,
    });
    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      const jsonMatch = aiResponse.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = [];
        }
      } else {
        parsed = [];
      }
    }
  }

  const normalized = parsed
    .filter(Boolean)
    .map((item: any, index: number) =>
      normalizeComputerUsePlannedAction(item, index, analyzedIntent));

  if (normalized.length > 0) return normalized;

  return buildPureFallbackBrowserActions(task, analyzedIntent)
    .map((action, index) =>
      normalizeComputerUsePlannedAction(action, index, analyzedIntent));
}

export async function callPlaywrightMCP(
  toolName: string,
  params: Record<string, any>
): Promise<any> {
  const bridgeUrl = getBridgeUrl(BRIDGE_PORT);
  if (!bridgeUrl) {
    throw new Error('Bridge unavailable in this environment');
  }
  const online = await probeBridge();
  if (!online) {
    throw new Error(`Bridge not reachable at ${bridgeUrl}`);
  }

  let mcpError: any = null;
  try {
    const paired = await ensureDesktopBridgePaired();
    if (!paired.ok || !paired.data?.token) {
      throw new Error(paired.error || 'Desktop bridge not paired.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT);
    const res = await fetch(`${bridgeUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-UC-Desktop-Token': paired.data.token,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `computer-use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: params,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const json = await res.json();
      if (json?.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      return json?.result ?? json;
    }
    const text = await res.text().catch(() => '');
    throw new Error(text || `Bridge /mcp failed: ${res.status}`);
  } catch (err) {
    mcpError = err;
    // Fall through to the structured-backend error below.
  }

  throw new Error(
    `Playwright MCP not available at ${bridgeUrl}/mcp. ${mcpError?.message ? `Last error: ${mcpError.message}. ` : ''}Install @playwright/mcp and wire it into the bridge, or enable Browserbase Stagehand for this circle.`,
  );
}

async function callStagehandRunner(payload: StagehandRunnerPayload): Promise<StagehandRunnerResponse> {
  const bridgeUrl = getBridgeUrl(BRIDGE_PORT);
  if (!bridgeUrl) throw new Error('Bridge unavailable in this environment');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STAGEHAND_TIMEOUT);
  try {
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/stagehand/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
      signal: controller.signal,
    });
    const parsed = await res.json().catch(() => null) as StagehandRunnerResponse | null;
    if (res.ok && parsed?.ok) return parsed;
    throw new Error(parsed?.error || `Stagehand bridge failed: HTTP ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureStagehandSession(session: ComputerUseSession): Promise<void> {
  if (session.backend !== 'browserbase_stagehand' || session.backendSessionId) return;
  const backend = await resolveComputerUseBackend(session.circleId, session.intent);
  if (backend.backend !== 'browserbase_stagehand' || !backend.browserbase) {
    throw new Error('Browserbase Stagehand is not configured for this circle');
  }
  const init = await callStagehandRunner({
    mode: 'init',
    apiKey: backend.browserbase.apiKey,
    projectId: backend.browserbase.projectId,
    region: backend.browserbase.region,
  });
  if (!init.sessionId) {
    throw new Error('Stagehand did not return a Browserbase session id');
  }
  session.backendSessionId = init.sessionId;
  session.backendLiveUrl = `https://www.browserbase.com/sessions/${init.sessionId}`;
  session.currentUrl = init.currentUrl || session.currentUrl;
}

async function runStagehandSessionCommand(
  session: ComputerUseSession,
  mode: 'action' | 'screenshot',
  action?: NonNullable<StagehandRunnerPayload['action']>,
): Promise<StagehandRunnerResponse> {
  if (
    mode === 'action'
    && (!action || (action.type !== 'observe' && action.type !== 'extract'))
  ) {
    throw new Error(
      'Stagehand mutation refused: legacy Computer Use permits only observe/extract action mode.',
    );
  }
  if (mode === 'screenshot' && action) {
    throw new Error('Stagehand screenshot mode does not accept an action payload.');
  }
  const backend = await resolveComputerUseBackend(session.circleId, session.intent);
  if (backend.backend !== 'browserbase_stagehand' || !backend.browserbase) {
    throw new Error('Browserbase Stagehand is not configured for this circle');
  }
  await ensureStagehandSession(session);
  const response = await callStagehandRunner({
    mode,
    apiKey: backend.browserbase.apiKey,
    projectId: backend.browserbase.projectId,
    region: backend.browserbase.region,
    sessionId: session.backendSessionId,
    action,
  });
  if (response.sessionId) {
    session.backendSessionId = response.sessionId;
    session.backendLiveUrl = `https://www.browserbase.com/sessions/${response.sessionId}`;
  }
  if (response.currentUrl) {
    session.currentUrl = response.currentUrl;
  }
  return response;
}

async function runPlaywrightReadAction(action: BrowserAction): Promise<string> {
  const toolCandidates = action.type === 'observe'
    ? ['mcp__playwright__browser_snapshot', 'mcp__playwright__browser_get_page_snapshot']
    : ['mcp__playwright__browser_snapshot', 'mcp__playwright__browser_get_page_snapshot'];
  let lastError: any = null;
  for (const toolName of toolCandidates) {
    try {
      const result = await callPlaywrightMCP(toolName, {});
      const serialized = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      if (serialized && serialized !== '{}') return serialized.slice(0, 20000);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('No browser read/snapshot tool is available for observe/extract.');
}

async function runLocalBrowserReadAction(action: BrowserAction): Promise<string> {
  const maxNodes = action.type === 'extract' ? 300 : 180;
  const result = await localBrowserDomSnapshot({ maxNodes, interestingOnly: true });
  if (!result.ok || !result.data) {
    throw new Error(result.error || 'Browser DOM snapshot failed.');
  }
  const treeText = renderBrowserTree(result.data.tree).join('\n');
  // The snapshot-level truncation note (node budget hit on the bridge)
  // is appended LAST so it survives the local 20k character cap — the
  // model must see "page continues past this tree", not infer absence.
  const snapshotTruncationNote = describeDomSnapshotTruncation(result.data);
  return [
    `URL: ${result.data.url}`,
    `Title: ${result.data.title || '(untitled)'}`,
    `Nodes: ${result.data.nodeCount}`,
    '',
    treeText.slice(0, 20000),
    treeText.length > 20000 ? '\n...truncated' : '',
    snapshotTruncationNote || '',
  ].filter(Boolean).join('\n');
}

export async function takeScreenshot(session?: ComputerUseSession): Promise<string | null> {
  if (session?.backend === 'browserbase_stagehand') {
    try {
      const result = await runStagehandSessionCommand(session, 'screenshot');
      if (result.screenshot) return result.screenshot;
    } catch {
      // Fall through to bridge fallback if Stagehand screenshot fails
    }
  }

  try {
    const result = await localBrowserScreenshot({ fullPage: false });
    if (result.ok && result.data?.base64) {
      return result.data.base64;
    }
  } catch {
    // Fall through to legacy MCP/shell capture paths.
  }

  try {
    const result = await callPlaywrightMCP('mcp__playwright__browser_take_screenshot', {});
    if (result && result.screenshot) {
      return result.screenshot;
    }
    if (result && typeof result === 'string') {
      return result;
    }
  } catch {
    // No shell fallback: structured browser/desktop capture must succeed.
  }

  return null;
}

export async function executeAction(
  action: BrowserAction,
  session?: ComputerUseSession,
): Promise<BrowserAction> {
  const safeAction = withoutPersistedMutationInput(action);
  const updated: BrowserAction = {
    ...safeAction,
    status: 'executing',
    executedAt: new Date().toISOString(),
  };
  if (isComputerUseMutationActionType(action.type)) {
    // This is the first executable boundary. Rebuild the handoff from the
    // action type and return before screenshots, Stagehand session creation,
    // Playwright MCP, or any local bridge call.
    const runtimeHandoff = buildComputerUseMutationRuntimeHandoff(action.type);
    return {
      ...updated,
      status: 'failed',
      requiresApproval: false,
      blockedReason: runtimeHandoff.message,
      error: runtimeHandoff.message,
      runtimeHandoff,
    };
  }

  try {
    const beforeShot = await takeScreenshot(session);
    if (beforeShot) updated.screenshotBefore = beforeShot;

    if (session?.backend === 'browserbase_stagehand') {
      switch (action.type) {
        case 'observe':
        case 'extract': {
          const result = await runStagehandSessionCommand(session, 'action', {
            type: action.type === 'observe' ? 'observe' : 'extract',
            target: action.target,
            value: action.value,
            description: action.description,
          });
          updated.output = result.output || undefined;
          updated.status = 'completed';
          return updated;
        }
        case 'screenshot': {
          const shot = await takeScreenshot(session);
          if (!shot) {
            // Previously we unconditionally marked screenshot actions
            // "completed" even when every capture path failed, which hid the
            // real error and made the UI lie about what happened.
            updated.status = 'failed';
            updated.error = 'Could not capture screenshot via Stagehand or bridge';
            return updated;
          }
          updated.screenshotAfter = shot;
          updated.status = 'completed';
          return updated;
        }
        case 'wait': {
          const ms = parseInt(action.value || '1000', 10);
          await new Promise(resolve => setTimeout(resolve, Math.min(ms, 10000)));
          break;
        }
        default:
          throw new Error(`Stagehand legacy action type is not read-only: ${action.type}`);
      }
    } else {
      switch (action.type) {
        case 'observe':
        case 'extract': {
          try {
            updated.output = await runLocalBrowserReadAction(action);
          } catch {
            updated.output = await runPlaywrightReadAction(action);
          }
          updated.status = 'completed';
          return updated;
        }
        case 'screenshot': {
          const shot = await takeScreenshot(session);
          if (!shot) {
            // Same bug as the Stagehand branch above — a screenshot step
            // that captured nothing was being reported as completed.
            updated.status = 'failed';
            updated.error = 'Could not capture screenshot via Playwright MCP or bridge';
            return updated;
          }
          updated.screenshotAfter = shot;
          updated.status = 'completed';
          return updated;
        }
        case 'wait': {
          const ms = parseInt(action.value || '1000', 10);
          await new Promise(resolve => setTimeout(resolve, Math.min(ms, 10000)));
          break;
        }
        default:
          throw new Error(`Legacy browser action type is not read-only: ${action.type}`);
      }
    }

    const afterShot = await takeScreenshot(session);
    if (afterShot) updated.screenshotAfter = afterShot;
    updated.status = 'completed';
  } catch (err: any) {
    updated.status = 'failed';
    updated.error = err?.message || 'Unknown error';
  }

  return updated;
}

export function checkPermission(
  session: ComputerUseSession,
  action: BrowserAction
): boolean {
  if (isComputerUseMutationActionType(action.type)) return false;
  if (action.blockedReason) return false;
  if (action.requiresApproval) return action.status === 'approved';
  switch (session.permission) {
    case 'none':
      return false;
    case 'trusted':
      return true;
    case 'ask_every_time':
      return false;
    case 'ask_for_new_sites':
      return true;
    default:
      return false;
  }
}

export async function executePlan(
  session: ComputerUseSession,
  onActionComplete: (action: BrowserAction, index: number) => void
): Promise<ComputerUseResult> {
  const results: BrowserAction[] = [];
  let lastScreenshot: string | undefined;
  // Direct/legacy callers can bypass planner hydration. Redact every mutation
  // value and rebuild every handoff before any result, pause, or persistence
  // path can expose the session.
  session.actions = session.actions.map(withoutPersistedMutationInput);

  for (let i = 0; i < session.actions.length; i += 1) {
    const action = session.actions[i];

    if (isComputerUseMutationActionType(action.type)) {
      // Halt on the first mutation marker even if a legacy/saved caller marked
      // it approved or completed. executeAction rebuilds a fresh, non-secret
      // handoff and returns before all observation/backend I/O.
      const halted = await executeAction(action, session);
      results.push(halted);
      results.push(
        ...session.actions.slice(i + 1).map(withoutPersistedMutationInput),
      );
      onActionComplete(halted, i);
      return {
        success: false,
        message: `Stopped at step ${i + 1}: ${halted.error || halted.blockedReason || 'Typed OpenSwan mutation handoff required.'}`,
        screenshotUrl: lastScreenshot ? `data:image/png;base64,${lastScreenshot}` : undefined,
        actions: results,
        currentUrl: session.currentUrl,
        backendSessionId: session.backendSessionId,
        backendLiveUrl: session.backendLiveUrl,
      };
    }

    if (action.status === 'rejected' || action.status === 'completed') {
      results.push(action);
      if (action.blockedReason) {
        return {
          success: false,
          message: action.blockedReason,
          screenshotUrl: lastScreenshot ? `data:image/png;base64,${lastScreenshot}` : undefined,
          actions: results,
          currentUrl: session.currentUrl,
          backendSessionId: session.backendSessionId,
          backendLiveUrl: session.backendLiveUrl,
        };
      }
      continue;
    }

    if (action.status !== 'approved' && !checkPermission(session, action)) {
      // HALT at the first unapproved step — never skip past it. Skipping and
      // continuing could mutate external state on partial inputs (e.g. click
      // a submit button whose credential fills were skipped). Later steps are
      // returned untouched so the session stays resumable after approval.
      const halted: BrowserAction = { ...action, status: action.blockedReason ? 'rejected' : 'pending' };
      results.push(halted);
      results.push(...session.actions.slice(i + 1));
      return {
        success: false,
        message: action.blockedReason
          ? `Stopped at step ${i + 1}: ${action.blockedReason}`
          : `Paused at step ${i + 1} (${action.description || action.type}) — this step needs approval before it can run. Approve it in the Computer Use panel and resume; later steps were not executed.`,
        screenshotUrl: lastScreenshot ? `data:image/png;base64,${lastScreenshot}` : undefined,
        actions: results,
        currentUrl: session.currentUrl,
        backendSessionId: session.backendSessionId,
        backendLiveUrl: session.backendLiveUrl,
        pendingApproval: action.blockedReason
          ? undefined
          : { index: i, actionId: action.id, description: action.description },
      };
    }

    const result = await executeAction(action, session);
    results.push(result);
    onActionComplete(result, i);

    if (result.screenshotAfter) {
      lastScreenshot = result.screenshotAfter;
    }

    if (result.status === 'failed') {
      return {
        success: false,
        message: `Failed at step ${i + 1}: ${result.error || 'Unknown error'}`,
        screenshotUrl: lastScreenshot ? `data:image/png;base64,${lastScreenshot}` : undefined,
        actions: results,
        currentUrl: session.currentUrl,
        backendSessionId: session.backendSessionId,
        backendLiveUrl: session.backendLiveUrl,
      };
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const allCompleted = results.every(a => a.status === 'completed' || a.status === 'rejected');
  const outputs = results
    .filter(a => a.output)
    .map((a, index) => `Output ${index + 1} (${a.type}):\n${String(a.output).slice(0, 4000)}`);
  return {
    success: allCompleted,
    message: [
      allCompleted
        ? `Completed ${results.filter(a => a.status === 'completed').length} actions successfully`
        : `Completed ${results.filter(a => a.status === 'completed').length}/${results.length} actions`,
      outputs.length ? outputs.join('\n\n') : '',
    ].filter(Boolean).join('\n\n'),
    screenshotUrl: lastScreenshot ? `data:image/png;base64,${lastScreenshot}` : undefined,
    actions: results,
    currentUrl: session.currentUrl,
    backendSessionId: session.backendSessionId,
    backendLiveUrl: session.backendLiveUrl,
  };
}

export async function describeComputerUsePlan(opts: {
  task: string;
  circleId?: string;
  agentName?: string;
  userId?: string;
  model?: string | null;
  planningContext?: string | null;
  computerAppPreflight?: ComputerAppPreflight | null;
  computerAppGroundingTrace?: ComputerAppGroundingTrace | null;
  /**
   * WI-1: route-derived approval signal. When the caller (ChatTab's
   * `browser_runtime` branch) has already decided this run auto-starts with
   * no permission dialog, it passes `false` so the plan summary and the
   * downstream browser plan card do not falsely advertise "requires
   * approval". Defaults to `true` when omitted so every legacy call site and
   * every route without an explicit signal keeps the pre-existing behavior —
   * nothing regresses.
   */
  requiresApproval?: boolean;
}): Promise<ComputerUsePlanSummary> {
  const requiresApproval = opts.requiresApproval ?? true;
  const task = opts.task.trim();
  const intent = analyzeBrowserTask(task);
  const computerAppGroundingTrace = opts.computerAppGroundingTrace || buildComputerAppGroundingTrace({
    plan: buildComputerAppGroundingPlan(task),
    observations: [],
    actions: [],
  });
  const session = await createSession(
    opts.agentName || 'OpenSwan',
    task,
    intent.suggestedPermission,
    { circleId: opts.circleId, intent, recommendedPermission: intent.suggestedPermission },
  );
  const effectivePlanningContext = [
    opts.planningContext || '',
    computerAppGroundingTrace
      ? [
          'Browser plan grounding trace:',
          `status=${computerAppGroundingTrace.status}`,
          `nextAction=${computerAppGroundingTrace.display.nextAction}`,
          `summary=${computerAppGroundingTrace.display.summary}`,
          computerAppGroundingTrace.display.blockers.length
            ? `blockers=${computerAppGroundingTrace.display.blockers.join(' | ')}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
  ].filter(Boolean).join('\n\n');
  const actions = await planActions(task, effectivePlanningContext || undefined, intent, {
    circleId: opts.circleId,
    userId: opts.userId,
    model: opts.model,
  });
  session.actions = actions;
  const backendPreference = session.backendPreference || chooseBrowserAutomationBackendPreference(intent);
  const runtimeHandoffTools = Array.from(new Set(
    actions
      .map((action) => action.runtimeHandoff?.tool)
      .filter((tool): tool is BrowserMutationRuntimeTool => Boolean(tool)),
  ));

  const summaryText = [
    `Browser backend: ${session.backendLabel}${session.backendDetails ? ` (${session.backendDetails})` : ''}`,
    `Backend policy: ${backendPreference.costTier === 'free_local' ? 'local/free' : 'metered remote'} — ${backendPreference.reason}`,
    `Mode: ${intent.mode.replace(/_/g, ' ')} · Risk: ${intent.risk.toUpperCase()} · Recommended permission: ${intent.suggestedPermission.replace(/_/g, ' ')}`,
    intent.allowedDomains.length > 0 ? `Domains: ${intent.allowedDomains.join(', ')}` : 'Domains: not specified',
    intent.requiresLogin ? 'Requires login or account access' : 'No login signals detected',
    intent.hasSideEffects ? 'This plan may change external state' : 'This plan is read-oriented',
    `Browserbase workflow: ${intent.browserbaseWorkflow.label} — ${intent.browserbaseWorkflow.summary}`,
    intent.browserbaseWorkflow.expectsStructuredOutput ? 'Structured output expected from the final browser result' : '',
    intent.browserbaseWorkflow.requiresSubmissionVerification ? 'Final submission must be verified with visible proof or validation errors' : '',
    intent.verificationGate ? `${intent.verificationGate.label}: human must complete this step manually before automation continues` : '',
    opts.computerAppPreflight ? `Computer/app preflight: ${opts.computerAppPreflight.status} — ${opts.computerAppPreflight.summary}` : '',
    computerAppGroundingTrace ? `Grounding trace: ${computerAppGroundingTrace.status} — ${computerAppGroundingTrace.display.nextAction}` : '',
    computerAppGroundingTrace?.display.blockers.length
      ? `Grounding blockers: ${computerAppGroundingTrace.display.blockers.join(' | ')}`
      : '',
    `Planned actions: ${actions.length}`,
    ...actions.slice(0, 8).map((action, index) =>
      `${index + 1}. ${action.type.toUpperCase()}${action.target ? ` ${action.target}` : ''} — ${action.description}`),
    actions.length > 8 ? `...and ${actions.length - 8} more action(s)` : '',
    runtimeHandoffTools.length > 0
      ? `Legacy Computer Use will stop at its first mutation marker. Continue in Chat/OpenSwan through: ${runtimeHandoffTools.join(', ')}. No raw mutation value or sealed runtime identity is carried by this plan.`
      : '',
    runtimeHandoffTools.includes('browser.select_option')
      ? 'Dropdown selection is blocked in this legacy plan. Continue that exact step in Chat/OpenSwan through browser.select_option; do not retry it through Computer Use or a raw bridge.'
      : '',
    `Completion: ${intent.completionCriteria.join(' | ')}`,
    requiresApproval
      ? 'This plan requires user approval before live browser execution.'
      : 'This plan auto-starts (zero-tap browser run); the mid-run payment floor still confirms before any pay/book submission.',
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    task,
    intent,
    backend: session.backend,
    backendLabel: session.backendLabel,
    backendDetails: session.backendDetails,
    backendPreference,
    actions,
    requiresApproval,
    summaryText,
    recommendedPermission: intent.suggestedPermission,
    computerAppPreflight: opts.computerAppPreflight || null,
    computerAppGroundingTrace,
  };
}

export function toBrowserSessionRecord(
  session: ComputerUseSession,
  result?: ComputerUseResult | { success: boolean },
): BrowserSessionRecord {
  const isTerminal = !!result;
  return {
    id: session.backendSessionId || session.id,
    planId: session.sourcePlanId,
    task: session.task,
    intent: session.intent,
    backend: session.backend,
    backendLabel: session.backendLabel,
    backendDetails: session.backendDetails,
    backendPreference: session.backendPreference,
    status: isTerminal
      ? (result.success ? 'completed' : 'failed')
      : session.status,
    startedAt: session.startedAt,
    completedAt: isTerminal ? new Date().toISOString() : undefined,
    currentUrl: session.currentUrl,
    backendSessionId: session.backendSessionId,
    backendLiveUrl: session.backendLiveUrl,
    recommendedPermission: session.recommendedPermission,
    actions: session.actions.map(withoutPersistedMutationInput),
  };
}

export function toBrowserPlanCardData(plan: ComputerUsePlanSummary): BrowserPlanCardData {
  return {
    planId: `browser-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    task: plan.task,
    intent: plan.intent,
    backend: plan.backend,
    backendLabel: plan.backendLabel,
    backendDetails: plan.backendDetails,
    backendPreference: plan.backendPreference,
    requiresApproval: plan.requiresApproval,
    recommendedPermission: plan.recommendedPermission,
    status: 'planned',
    computerAppPreflight: plan.computerAppPreflight || null,
    computerAppGroundingTrace: plan.computerAppGroundingTrace || null,
    actions: plan.actions.map((action) => {
      const safeAction = withoutPersistedMutationInput(action);
      return {
        id: safeAction.id,
        type: safeAction.type,
        target: safeAction.target,
        value: safeAction.value,
        description: safeAction.description,
        requiresApproval: safeAction.requiresApproval,
        approvalReason: safeAction.approvalReason,
        blockedReason: safeAction.blockedReason,
        runtimeHandoff: safeAction.runtimeHandoff,
      };
    }),
  };
}
