/**
 * computerUse.ts — Computer-Use Engine
 *
 * Plans browser actions, checks permissions, and executes them through
 * a bridge-backed browser runtime. The local Playwright MCP bridge remains
 * the default backend, and Browserbase Stagehand is used when a connected
 * Browserbase integration is available for the active circle.
 */

import { getCircleIntegration, getCircleIntegrationSecretValues } from './circleIntegrations';
import { getSwanBotResponse as getAIResponse } from './swanbot';
import { analyzeBrowserTask, type BrowserTaskIntent } from './browserTaskIntent';
import { buildBrowserbaseWorkflowPromptBlock } from './browserbaseWorkflowIntent';
import { buildFallbackBrowserActions as buildPureFallbackBrowserActions } from './browserActionFallback';
import { chooseBrowserAutomationBackendPreference, type BrowserAutomationBackendPreference } from './browserAutomationBackend';
import { getBridgeUrl } from './bridgeEnvironment';
import { ensureDesktopBridgePaired } from './desktopBridge';
import { detectAutomationVerificationGate } from './desktopAutomationSafety';
import type { ComputerAppPreflight } from './computerAppPreflight';
import {
  buildComputerAppGroundingPlan,
  buildComputerAppGroundingTrace,
  type ComputerAppGroundingTrace,
} from './computerAppGrounding';
import {
  clickRole as localBrowserClickRole,
  describeDomSnapshotTruncation,
  domSnapshot as localBrowserDomSnapshot,
  fillField as localBrowserFillField,
  openUrl as localBrowserOpenUrl,
  pressKey as localBrowserPressKey,
  renderBrowserTree,
  screenshot as localBrowserScreenshot,
  selectOption as localBrowserSelectOption,
} from './browserBridge';

export type ComputerUsePermission = 'none' | 'ask_every_time' | 'ask_for_new_sites' | 'trusted';
export type ComputerUseBackend = 'playwright_bridge' | 'browserbase_stagehand';

export interface BrowserAction {
  id: string;
  type: 'navigate' | 'observe' | 'extract' | 'click' | 'fill' | 'screenshot' | 'select' | 'press_key' | 'wait' | 'scroll';
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
  actions: Array<Pick<BrowserAction, 'id' | 'type' | 'target' | 'value' | 'description' | 'requiresApproval' | 'approvalReason' | 'blockedReason'>>;
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
  action?: Pick<BrowserAction, 'type' | 'target' | 'value' | 'description'>;
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
const STAGEHAND_RUNNER = 'node scripts/stagehand-runner.mjs';

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

function isSubmissionLikeAction(action: Pick<BrowserAction, 'type' | 'description' | 'target' | 'value'>): boolean {
  const haystack = `${action.description || ''} ${action.target || ''} ${action.value || ''}`.toLowerCase();
  return /\b(submit|confirm|place order|checkout|purchase|pay|send|publish|post|delete|remove|save changes|book|reserve|transfer|wire|invite|create account)\b/.test(haystack);
}

function assessBrowserActionSafety(
  intent: BrowserTaskIntent | undefined,
  action: Pick<BrowserAction, 'type' | 'description' | 'target' | 'value'>,
): BrowserActionSafetyAssessment {
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

  const explicitApproval = action.type === 'navigate' || action.type === 'fill';
  if (!intent) {
    return { requiresApproval: explicitApproval };
  }

  if (intent.requiresLogin && (action.type === 'fill' || action.type === 'press_key' || action.type === 'observe' || action.type === 'extract')) {
    return {
      requiresApproval: true,
      approvalReason: 'This step may enter credentials, read account data, or interact with an authenticated session.',
    };
  }

  if (intent.hasSideEffects && isSubmissionLikeAction(action)) {
    return {
      requiresApproval: true,
      approvalReason: 'This step appears to submit or change external state.',
    };
  }

  if (intent.risk === 'high' && (action.type === 'click' || action.type === 'select')) {
    return {
      requiresApproval: true,
      approvalReason: 'High-risk workflow step requires explicit approval.',
    };
  }

  return { requiresApproval: explicitApproval };
}

function encodeBase64(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    const bufferCtor = (globalThis as any).Buffer;
    if (bufferCtor) return bufferCtor.from(value, 'utf8').toString('base64');
    throw new Error('Base64 encoding unavailable in this environment');
  }
}

function parseJsonFromExecOutput(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        continue;
      }
    }
  }
  return null;
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

async function callBridgeExec(command: string, timeoutMs: number = BRIDGE_TIMEOUT): Promise<any> {
  const bridgeUrl = getBridgeUrl(BRIDGE_PORT);
  if (!bridgeUrl) {
    throw new Error('Bridge unavailable in this environment');
  }
  const online = await probeBridge();
  if (!online) {
    throw new Error(`Bridge not reachable at ${bridgeUrl}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${bridgeUrl}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) {
    throw new Error(`Bridge /exec failed: ${res.status}`);
  }
  return res.json();
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
  session.actions = plan.actions.map((action) => {
    const safety = assessBrowserActionSafety(plan.intent, action);
    const status =
      safety.blockedReason
        ? 'rejected'
        : permission === 'trusted' && !safety.requiresApproval
          ? 'approved'
          : 'pending';
    return {
      id: action.id,
      type: action.type,
      target: action.target,
      value: action.value,
      description: action.description,
      requiresApproval: safety.requiresApproval,
      approvalReason: safety.approvalReason || action.approvalReason,
      blockedReason: safety.blockedReason || action.blockedReason,
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

Valid types: navigate, observe, extract, click, fill, screenshot, select, press_key, wait, scroll

Rules:
- Follow any Computer/App Grounding section in CONTEXT before choosing click/fill/submit actions.
- If CONTEXT says the next safe action is an observation, start with observe/extract/screenshot instead of mutation.
- Never plan to solve CAPTCHA, MFA, OTP, Cloudflare, Turnstile, or "I am not a robot"; plan a pause/blocked step instead.
- Prefer the explicit start URL when one is present.
- Keep actions inside the allowed domains unless the task clearly requires otherwise.
- For web data retrieval, keep the action plan narrow: navigate, wait for rendered content when needed, extract the requested fields, and add a screenshot only when visual proof matters.
- For Stagehand-style tasks, use observe before ambiguous UI choices, act-sized click/fill steps for changes, and extract for requested data.
- For form submission, include field-filling steps, a review screenshot before submit, and a post-submit verification step.
- If the task appears transactional or login-related, stop before final submission and add a screenshot step near the end.
- If the task is read-only or extract-focused, end with a screenshot after reaching the requested result.

Example:
[
  {"type":"navigate","target":"https://example.com","description":"Open example.com"},
  {"type":"observe","description":"Observe the visible navigation and form controls"},
  {"type":"click","target":"#login-button","description":"Click the login button"},
  {"type":"fill","target":"#email","value":"user@test.com","description":"Enter email address"},
  {"type":"extract","description":"Extract the requested records as structured JSON"},
  {"type":"screenshot","description":"Capture the result"}
]

Return ONLY the JSON array:`;

  const aiResponse = await getAIResponse(planPrompt, {
    userId: opts?.userId || '00000000-0000-0000-0000-000000000000',
    circleId: opts?.circleId,
    userName: 'ComputerUse',
    model: opts?.model || undefined,
  });

  let parsed: any[] = [];
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

  const normalized = parsed
    .filter(Boolean)
    .map((item: any, index: number) => {
      const allowedTypes = new Set<BrowserAction['type']>([
        'navigate', 'observe', 'extract', 'click', 'fill', 'screenshot', 'select', 'press_key', 'wait', 'scroll',
      ]);
      const itemType = allowedTypes.has(item.type) ? item.type : 'navigate';
      const base = {
        id: `action_${Date.now()}_${index}`,
        type: itemType,
        target: item.target || undefined,
        value: item.value || undefined,
        description: item.description || `Step ${index + 1}`,
      };
      const safety = assessBrowserActionSafety(analyzedIntent, base);
      return {
        ...base,
        requiresApproval: safety.requiresApproval,
        approvalReason: safety.approvalReason,
        blockedReason: safety.blockedReason,
        status: safety.blockedReason ? 'rejected' as const : 'pending' as const,
      };
    });

  if (normalized.length > 0) return normalized;

  return buildPureFallbackBrowserActions(task, analyzedIntent) as BrowserAction[];
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
    // Fall through to /exec fallback
  }

  // The exec fallback can only meaningfully emulate screenshot via
  // `screencapture`. For navigate/click/fill/select/press_key there is no
  // real shell equivalent — `npx playwright open` just opens codegen, it
  // doesn't drive our session. Previously these commands returned a resolved
  // promise with empty stdout, which the caller treated as success and the
  // UI showed "COMPLETED" for actions that never ran.
  if (toolName === 'mcp__playwright__browser_take_screenshot') {
    const ts = Date.now();
    const path = `/tmp/cu_screenshot_${ts}.png`;
    const command = `screencapture -x ${path} && base64 ${path} && rm ${path}`;
    return callBridgeExec(command);
  }

  throw new Error(
    `Playwright MCP not available at ${bridgeUrl}/mcp. ${mcpError?.message ? `Last error: ${mcpError.message}. ` : ''}Install @playwright/mcp and wire it into the bridge, or enable Browserbase Stagehand for this circle.`,
  );
}

async function callStagehandRunner(payload: StagehandRunnerPayload): Promise<StagehandRunnerResponse> {
  const encoded = encodeBase64(JSON.stringify(payload));
  const result = await callBridgeExec(`${STAGEHAND_RUNNER} '${encoded}'`, STAGEHAND_TIMEOUT);
  const raw = `${result?.stdout || result?.output || result?.stderr || ''}`;
  const parsed = parseJsonFromExecOutput(raw) as StagehandRunnerResponse | null;
  if (parsed?.ok) return parsed;
  if (parsed && !parsed.ok) {
    throw new Error(parsed.error || 'Stagehand runner failed');
  }
  throw new Error(raw.trim() || 'Stagehand runner returned no structured output');
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
  action?: Pick<BrowserAction, 'type' | 'target' | 'value' | 'description'>,
): Promise<StagehandRunnerResponse> {
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

function looksLikeBrowserSelector(value?: string): boolean {
  const text = String(value || '').trim();
  return !!text && (
    /^[#.]/.test(text)
    || /\[[\w-]+\s*([~|^$*]?=|\])/.test(text)
    || /:nth-(?:child|of-type|last-child)/.test(text)
    || /^[a-z][\w-]*\s*[>+~]/i.test(text)
    || /^[a-z][\w-]*\s*\[/i.test(text)
    || /^[a-z][\w-]*\s*\.[\w-]/i.test(text)
  );
}

function extractQuotedLabel(value?: string): string | undefined {
  const match = String(value || '').match(/["'“”‘’]([^"'“”‘’]{1,120})["'“”‘’]/);
  return match?.[1]?.trim() || undefined;
}

function inferBrowserRole(action: BrowserAction, fallback: string): string {
  const text = `${action.target || ''} ${action.description || ''}`.toLowerCase();
  if (/\blink\b|href|anchor/.test(text)) return 'link';
  if (/\btab\b/.test(text)) return 'tab';
  if (/\bcheckbox\b|check box/.test(text)) return 'checkbox';
  if (/\bradio\b/.test(text)) return 'radio';
  if (/\bcombo|dropdown|drop down|select\b/.test(text)) return 'combobox';
  if (/\btextbox|text box|input|field|email|password|search\b/.test(text)) return 'textbox';
  return fallback;
}

function buildLocalBrowserLocatorArgs(
  action: BrowserAction,
  fallbackRole: string,
): { role: string; name?: string; selector?: string; exact?: boolean; timeoutMs?: number } {
  const target = String(action.target || '').trim();
  const role = inferBrowserRole(action, fallbackRole);
  if (looksLikeBrowserSelector(target)) {
    return { role, selector: target, timeoutMs: 10000 };
  }
  const name = target || extractQuotedLabel(action.description);
  if (!name) {
    throw new Error(`${action.type} action needs a target selector or accessible name.`);
  }
  return { role, name, timeoutMs: 10000 };
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
    // Try shell fallback
  }

  try {
    const ts = Date.now();
    const path = `/tmp/cu_screenshot_${ts}.png`;
    const res = await callBridgeExec(`screencapture -x ${path} && base64 ${path} && rm ${path}`);
    const output = res.output || res.stdout || '';
    if (output && output.length > 100) {
      return output.trim();
    }
  } catch {
    // Ignore
  }

  return null;
}

export async function executeAction(
  action: BrowserAction,
  session?: ComputerUseSession,
): Promise<BrowserAction> {
  const updated: BrowserAction = { ...action, status: 'executing', executedAt: new Date().toISOString() };
  const browserTaskContext = [
    session?.task,
    action.description,
    action.target,
  ].filter(Boolean).join('\n');

  try {
    const beforeShot = await takeScreenshot(session);
    if (beforeShot) updated.screenshotBefore = beforeShot;

    if (session?.backend === 'browserbase_stagehand') {
      switch (action.type) {
        case 'observe':
        case 'extract': {
          const result = await runStagehandSessionCommand(session, 'action', action);
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
        default: {
          await runStagehandSessionCommand(session, 'action', action);
          break;
        }
      }
    } else {
      switch (action.type) {
        case 'navigate': {
          const result = await localBrowserOpenUrl(action.target || '', { waitUntil: 'domcontentloaded', taskContext: browserTaskContext });
          if (!result.ok) throw new Error(result.error || 'Local browser navigation failed.');
          if (session) session.currentUrl = result.data?.url || action.target;
          break;
        }
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
        case 'click': {
          const result = await localBrowserClickRole({ ...buildLocalBrowserLocatorArgs(action, 'button'), taskContext: browserTaskContext });
          if (!result.ok) throw new Error(result.error || 'Local browser click failed.');
          break;
        }
        case 'fill': {
          const result = await localBrowserFillField({
            ...buildLocalBrowserLocatorArgs(action, 'textbox'),
            text: action.value || '',
            taskContext: browserTaskContext,
          });
          if (!result.ok) throw new Error(result.error || 'Local browser fill failed.');
          break;
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
        case 'select': {
          const result = await localBrowserSelectOption({
            ...buildLocalBrowserLocatorArgs(action, 'combobox'),
            value: action.value || '',
            taskContext: browserTaskContext,
          });
          if (!result.ok) throw new Error(result.error || 'Local browser select failed.');
          break;
        }
        case 'press_key': {
          const result = await localBrowserPressKey(action.value || action.target || '', { taskContext: browserTaskContext });
          if (!result.ok) throw new Error(result.error || 'Local browser key press failed.');
          break;
        }
        case 'wait': {
          const ms = parseInt(action.value || '1000', 10);
          await new Promise(resolve => setTimeout(resolve, Math.min(ms, 10000)));
          break;
        }
        case 'scroll': {
          const result = await localBrowserPressKey(action.value === 'up' ? 'PageUp' : 'PageDown');
          if (!result.ok) throw new Error(result.error || 'Local browser scroll failed.');
          break;
        }
        default:
          throw new Error(`Unknown action type: ${action.type}`);
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
  if (action.blockedReason) return false;
  if (action.requiresApproval) return action.status === 'approved';
  switch (session.permission) {
    case 'none':
      return false;
    case 'trusted':
      return true;
    case 'ask_every_time':
      return false;
    case 'ask_for_new_sites': {
      if (action.type !== 'navigate') return true;
      const domain = extractDomain(action.target || '');
      return session.approvedDomains.includes(domain);
    }
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

  for (let i = 0; i < session.actions.length; i += 1) {
    const action = session.actions[i];

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
      results.push({ ...action, status: action.blockedReason ? 'rejected' : 'pending' });
      continue;
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

    if (action.type === 'navigate' && action.target) {
      const domain = extractDomain(action.target);
      if (!session.approvedDomains.includes(domain)) {
        session.approvedDomains.push(domain);
      }
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
}): Promise<ComputerUsePlanSummary> {
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
    `Completion: ${intent.completionCriteria.join(' | ')}`,
    'This plan requires user approval before live browser execution.',
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
    requiresApproval: true,
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
    actions: session.actions,
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
    actions: plan.actions.map((action) => ({
      id: action.id,
      type: action.type,
      target: action.target,
      value: action.value,
      description: action.description,
      requiresApproval: action.requiresApproval,
      approvalReason: action.approvalReason,
      blockedReason: action.blockedReason,
    })),
  };
}
