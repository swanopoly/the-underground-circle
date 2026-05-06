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
import { getBridgeUrl } from './bridgeEnvironment';

export type ComputerUsePermission = 'none' | 'ask_every_time' | 'ask_for_new_sites' | 'trusted';
export type ComputerUseBackend = 'playwright_bridge' | 'browserbase_stagehand';

export interface BrowserAction {
  id: string;
  type: 'navigate' | 'click' | 'fill' | 'screenshot' | 'select' | 'press_key' | 'wait' | 'scroll';
  target?: string;
  value?: string;
  description: string;
  requiresApproval: boolean;
  approvalReason?: string;
  blockedReason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  screenshotBefore?: string;
  screenshotAfter?: string;
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
  actions: BrowserAction[];
  requiresApproval: boolean;
  summaryText: string;
  recommendedPermission: ComputerUsePermission;
}

export interface BrowserPlanCardData {
  planId: string;
  task: string;
  intent?: BrowserTaskIntent;
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  requiresApproval: boolean;
  recommendedPermission?: ComputerUsePermission;
  status: 'planned' | 'approval_requested' | 'launched' | 'completed' | 'failed';
  launchedAt?: string;
  completedAt?: string;
  backendSessionId?: string;
  backendLiveUrl?: string;
  actions: Array<Pick<BrowserAction, 'id' | 'type' | 'target' | 'value' | 'description' | 'requiresApproval' | 'approvalReason' | 'blockedReason'>>;
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

  if (intent.requiresLogin && (action.type === 'fill' || action.type === 'press_key')) {
    return {
      requiresApproval: true,
      approvalReason: 'This step may enter credentials or interact with an authenticated session.',
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

async function resolveComputerUseBackend(circleId?: string): Promise<ComputerUseBackendContext> {
  if (!circleId) {
    return { backend: 'playwright_bridge', label: 'Local Playwright Bridge', details: 'No circle context provided' };
  }

  const integration = await getCircleIntegration(circleId, 'browserbase');
  if (!integration || integration.is_active === false || integration.status === 'disabled') {
    return { backend: 'playwright_bridge', label: 'Local Playwright Bridge' };
  }

  const secrets = await getCircleIntegrationSecretValues(integration.id);
  const apiKey = String(secrets.api_key || '').trim();
  const projectId = String(secrets.project_id || '').trim();
  const region = String(secrets.session_region || '').trim() || undefined;

  if (!apiKey || !projectId) {
    return {
      backend: 'playwright_bridge',
      label: 'Local Playwright Bridge',
      details: 'Browserbase connected, but api_key/project_id are incomplete',
    };
  }

  return {
    backend: 'browserbase_stagehand',
    label: 'Browserbase Stagehand',
    details: integration.display_name || String(integration.metadata?.workspaceName || 'Connected Browserbase workspace'),
    browserbase: { apiKey, projectId, region },
  };
}

export async function createSession(
  agentName: string,
  task: string,
  permission: ComputerUsePermission,
  opts?: { circleId?: string; intent?: BrowserTaskIntent; recommendedPermission?: ComputerUsePermission }
): Promise<ComputerUseSession> {
  const backend = await resolveComputerUseBackend(opts?.circleId);
  return {
    id: generateId(),
    agentName,
    task,
    intent: opts?.intent || analyzeBrowserTask(task),
    permission,
    actions: [],
    status: 'planning',
    startedAt: new Date().toISOString(),
    approvedDomains: opts?.intent?.allowedDomains ? [...opts.intent.allowedDomains] : [],
    circleId: opts?.circleId,
    backend: backend.backend,
    backendLabel: backend.label,
    backendDetails: backend.details,
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

Valid types: navigate, click, fill, screenshot, select, press_key, wait, scroll

Rules:
- Prefer the explicit start URL when one is present.
- Keep actions inside the allowed domains unless the task clearly requires otherwise.
- For web data retrieval, keep the action plan narrow: navigate, wait for rendered content when needed, capture/check the source page, and return structured data in the final agent summary.
- For Stagehand-style tasks, write action descriptions as semantic browser instructions that can be passed to Stagehand's act/extract flow.
- For form submission, include field-filling steps, a review screenshot before submit, and a post-submit verification step.
- If the task appears transactional or login-related, stop before final submission and add a screenshot step near the end.
- If the task is read-only or extract-focused, end with a screenshot after reaching the requested result.

Example:
[
  {"type":"navigate","target":"https://example.com","description":"Open example.com"},
  {"type":"click","target":"#login-button","description":"Click the login button"},
  {"type":"fill","target":"#email","value":"user@test.com","description":"Enter email address"},
  {"type":"screenshot","description":"Capture the result"}
]

Return ONLY the JSON array:`;

  const aiResponse = await getAIResponse(planPrompt, {
    userId: 'computer-use-planner',
    circleId: undefined,
    userName: 'ComputerUse',
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
      const base = {
        id: `action_${Date.now()}_${index}`,
        type: item.type || 'navigate',
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

  const fallbackTarget = analyzedIntent.startUrls[0]
    || (analyzedIntent.allowedDomains[0] ? `https://${analyzedIntent.allowedDomains[0]}` : '')
    || task;
  const fallback: BrowserAction[] = [
    {
      id: `action_${Date.now()}_0`,
      type: 'navigate',
      target: fallbackTarget,
      description: analyzedIntent.startUrls[0]
        ? `Open ${analyzedIntent.startUrls[0]}`
        : `Open the browser target for: ${task}`,
      requiresApproval: true,
      approvalReason: analyzedIntent.allowedDomains.length > 0 ? `Keep execution scoped to ${analyzedIntent.allowedDomains.join(', ')}` : undefined,
      status: 'pending',
    },
  ];
  if (analyzedIntent.requiresLogin) {
    fallback.push({
      id: `action_${Date.now()}_1`,
      type: 'wait',
      value: '1500',
      description: 'Pause for login or account review before continuing',
      requiresApproval: true,
      approvalReason: 'Explicit review before interacting with authenticated state.',
      status: 'pending',
    });
  }
  fallback.push({
    id: `action_${Date.now()}_${fallback.length}`,
    type: 'screenshot',
    description: analyzedIntent.mode === 'extract'
      ? 'Capture the page that contains the requested information'
      : 'Capture the browser state for review',
    requiresApproval: false,
    status: 'pending',
  });
  return fallback;
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT);
    const res = await fetch(`${bridgeUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      return res.json();
    }
  } catch {
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
    `Playwright MCP not available at ${bridgeUrl}/mcp. Install @playwright/mcp and wire it into the bridge, or enable Browserbase Stagehand for this circle.`,
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
  const backend = await resolveComputerUseBackend(session.circleId);
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
  const backend = await resolveComputerUseBackend(session.circleId);
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

  try {
    const beforeShot = await takeScreenshot(session);
    if (beforeShot) updated.screenshotBefore = beforeShot;

    if (session?.backend === 'browserbase_stagehand') {
      switch (action.type) {
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
        case 'navigate':
          await callPlaywrightMCP('mcp__playwright__browser_navigate', { url: action.target || '' });
          if (session && action.target) session.currentUrl = action.target;
          break;
        case 'click':
          await callPlaywrightMCP('mcp__playwright__browser_click', {
            selector: action.target || '',
            element: action.target || '',
          });
          break;
        case 'fill':
          await callPlaywrightMCP('mcp__playwright__browser_fill_form', {
            selector: action.target || '',
            value: action.value || '',
          });
          break;
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
        case 'select':
          await callPlaywrightMCP('mcp__playwright__browser_select_option', {
            selector: action.target || '',
            value: action.value || '',
          });
          break;
        case 'press_key':
          await callPlaywrightMCP('mcp__playwright__browser_press_key', {
            key: action.value || action.target || '',
          });
          break;
        case 'wait': {
          const ms = parseInt(action.value || '1000', 10);
          await new Promise(resolve => setTimeout(resolve, Math.min(ms, 10000)));
          break;
        }
        case 'scroll':
          await callPlaywrightMCP('mcp__playwright__browser_press_key', {
            key: action.value === 'up' ? 'PageUp' : 'PageDown',
          });
          break;
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
  return {
    success: allCompleted,
    message: allCompleted
      ? `Completed ${results.filter(a => a.status === 'completed').length} actions successfully`
      : `Completed ${results.filter(a => a.status === 'completed').length}/${results.length} actions`,
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
}): Promise<ComputerUsePlanSummary> {
  const task = opts.task.trim();
  const intent = analyzeBrowserTask(task);
  const session = await createSession(
    opts.agentName || 'OpenSwan',
    task,
    intent.suggestedPermission,
    { circleId: opts.circleId, intent, recommendedPermission: intent.suggestedPermission },
  );
  const actions = await planActions(task, undefined, intent);
  session.actions = actions;

  const summaryText = [
    `Browser backend: ${session.backendLabel}${session.backendDetails ? ` (${session.backendDetails})` : ''}`,
    `Mode: ${intent.mode.replace(/_/g, ' ')} · Risk: ${intent.risk.toUpperCase()} · Recommended permission: ${intent.suggestedPermission.replace(/_/g, ' ')}`,
    intent.allowedDomains.length > 0 ? `Domains: ${intent.allowedDomains.join(', ')}` : 'Domains: not specified',
    intent.requiresLogin ? 'Requires login or account access' : 'No login signals detected',
    intent.hasSideEffects ? 'This plan may change external state' : 'This plan is read-oriented',
    `Browserbase workflow: ${intent.browserbaseWorkflow.label} — ${intent.browserbaseWorkflow.summary}`,
    intent.browserbaseWorkflow.expectsStructuredOutput ? 'Structured output expected from the final browser result' : '',
    intent.browserbaseWorkflow.requiresSubmissionVerification ? 'Final submission must be verified with visible proof or validation errors' : '',
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
    actions,
    requiresApproval: true,
    summaryText,
    recommendedPermission: intent.suggestedPermission,
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
    requiresApproval: plan.requiresApproval,
    recommendedPermission: plan.recommendedPermission,
    status: 'planned',
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
