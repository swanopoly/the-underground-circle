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

export type ComputerUsePermission = 'none' | 'ask_every_time' | 'ask_for_new_sites' | 'trusted';
export type ComputerUseBackend = 'playwright_bridge' | 'browserbase_stagehand';

export interface BrowserAction {
  id: string;
  type: 'navigate' | 'click' | 'fill' | 'screenshot' | 'select' | 'press_key' | 'wait' | 'scroll';
  target?: string;
  value?: string;
  description: string;
  requiresApproval: boolean;
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
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  actions: BrowserAction[];
  requiresApproval: boolean;
  summaryText: string;
}

export interface BrowserPlanCardData {
  planId: string;
  task: string;
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  requiresApproval: boolean;
  status: 'planned' | 'approval_requested' | 'launched' | 'completed' | 'failed';
  launchedAt?: string;
  completedAt?: string;
  backendSessionId?: string;
  backendLiveUrl?: string;
  actions: Array<Pick<BrowserAction, 'id' | 'type' | 'target' | 'value' | 'description' | 'requiresApproval'>>;
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
  backend: ComputerUseBackend;
  backendLabel: string;
  backendDetails?: string;
  status: ComputerUseSession['status'];
  startedAt: string;
  completedAt?: string;
  currentUrl?: string;
  backendSessionId?: string;
  backendLiveUrl?: string;
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

const BRIDGE_URL = 'http://localhost:7778';
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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function callBridgeExec(command: string, timeoutMs: number = BRIDGE_TIMEOUT): Promise<any> {
  const online = await probeBridge();
  if (!online) {
    throw new Error('Bridge not reachable at localhost:7778');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${BRIDGE_URL}/exec`, {
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
  opts?: { circleId?: string }
): Promise<ComputerUseSession> {
  const backend = await resolveComputerUseBackend(opts?.circleId);
  return {
    id: generateId(),
    agentName,
    task,
    permission,
    actions: [],
    status: 'planning',
    startedAt: new Date().toISOString(),
    approvedDomains: [],
    circleId: opts?.circleId,
    backend: backend.backend,
    backendLabel: backend.label,
    backendDetails: backend.details,
  };
}

export async function createSessionFromBrowserPlan(
  agentName: string,
  permission: ComputerUsePermission,
  plan: BrowserPlanCardData,
  opts?: { circleId?: string; sourceMessageId?: string; sourceRunId?: string | null },
): Promise<ComputerUseSession> {
  const session = await createSession(agentName, plan.task, permission, opts);
  session.backend = plan.backend;
  session.backendLabel = plan.backendLabel;
  session.backendDetails = plan.backendDetails;
  session.actions = plan.actions.map((action) => ({
    id: action.id,
    type: action.type,
    target: action.target,
    value: action.value,
    description: action.description,
    requiresApproval: action.requiresApproval,
    status: permission === 'trusted' ? 'approved' : 'pending',
  }));
  session.status = permission === 'trusted' ? 'executing' : 'awaiting_approval';
  session.sourceMessageId = opts?.sourceMessageId;
  session.sourceRunId = opts?.sourceRunId || null;
  session.sourcePlanId = plan.planId;
  return session;
}

export async function planActions(
  task: string,
  context?: string
): Promise<BrowserAction[]> {
  const planPrompt = `You are a browser automation planner. You need to complete this task using a web browser.

TASK: ${task}
${context ? `\nCONTEXT: ${context}` : ''}

Break this into specific browser actions. Return ONLY a JSON array (no markdown, no explanation).
Each action has: type, target, value (optional), description.

Valid types: navigate, click, fill, screenshot, select, press_key, wait, scroll

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
        parsed = [
          { type: 'navigate', target: task, description: `Navigate to: ${task}` },
          { type: 'screenshot', description: 'Capture the page' },
        ];
      }
    } else {
      parsed = [
        { type: 'navigate', target: task, description: `Navigate to: ${task}` },
        { type: 'screenshot', description: 'Capture the page' },
      ];
    }
  }

  return parsed.map((item: any, index: number) => ({
    id: `action_${Date.now()}_${index}`,
    type: item.type || 'navigate',
    target: item.target || undefined,
    value: item.value || undefined,
    description: item.description || `Step ${index + 1}`,
    requiresApproval: item.type === 'navigate' || item.type === 'fill',
    status: 'pending' as const,
  }));
}

export async function callPlaywrightMCP(
  toolName: string,
  params: Record<string, any>
): Promise<any> {
  const online = await probeBridge();
  if (!online) {
    throw new Error('Bridge not reachable at localhost:7778');
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT);
    const res = await fetch(`${BRIDGE_URL}/mcp`, {
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

  let command = '';
  switch (toolName) {
    case 'mcp__playwright__browser_navigate':
      command = `npx playwright open "${params.url || ''}" 2>&1 || true`;
      break;
    case 'mcp__playwright__browser_click':
      command = `echo "click ${params.selector || params.element || ''}" | npx playwright 2>&1 || true`;
      break;
    case 'mcp__playwright__browser_take_screenshot':
      command = `screencapture -x /tmp/cu_screenshot_${Date.now()}.png 2>&1 && base64 /tmp/cu_screenshot_${Date.now()}.png`;
      break;
    default:
      command = `echo "Unsupported MCP tool: ${toolName}"`;
  }

  return callBridgeExec(command);
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
          if (shot) updated.screenshotAfter = shot;
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
          if (shot) updated.screenshotAfter = shot;
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
      continue;
    }

    if (action.status !== 'approved' && !checkPermission(session, action)) {
      results.push({ ...action, status: 'pending' });
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
  const session = await createSession(
    opts.agentName || 'OpenSwan',
    task,
    'ask_every_time',
    { circleId: opts.circleId },
  );
  const actions = await planActions(task);
  session.actions = actions;

  const summaryText = [
    `Browser backend: ${session.backendLabel}${session.backendDetails ? ` (${session.backendDetails})` : ''}`,
    `Planned actions: ${actions.length}`,
    ...actions.slice(0, 8).map((action, index) =>
      `${index + 1}. ${action.type.toUpperCase()}${action.target ? ` ${action.target}` : ''} — ${action.description}`),
    actions.length > 8 ? `...and ${actions.length - 8} more action(s)` : '',
    'This plan requires user approval before live browser execution.',
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    task,
    backend: session.backend,
    backendLabel: session.backendLabel,
    backendDetails: session.backendDetails,
    actions,
    requiresApproval: true,
    summaryText,
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
    actions: session.actions,
  };
}

export function toBrowserPlanCardData(plan: ComputerUsePlanSummary): BrowserPlanCardData {
  return {
    planId: `browser-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    task: plan.task,
    backend: plan.backend,
    backendLabel: plan.backendLabel,
    backendDetails: plan.backendDetails,
    requiresApproval: plan.requiresApproval,
    status: 'planned',
    actions: plan.actions.map((action) => ({
      id: action.id,
      type: action.type,
      target: action.target,
      value: action.value,
      description: action.description,
      requiresApproval: action.requiresApproval,
    })),
  };
}
