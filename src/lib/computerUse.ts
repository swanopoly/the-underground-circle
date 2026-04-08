/**
 * computerUse.ts — Computer-Use Engine
 *
 * Manages permissions, executes browser actions via Playwright MCP,
 * and captures screenshots for AI agent feedback loops.
 *
 * Bridge: localhost:7778 (/exec for shell, /mcp for MCP tool calls)
 * Playwright MCP tools: browser_navigate, browser_click, browser_fill_form,
 *   browser_take_screenshot, browser_press_key, browser_select_option, browser_wait_for
 */

import { getSwanBotResponse as getAIResponse } from './swanbot';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComputerUsePermission = 'none' | 'ask_every_time' | 'ask_for_new_sites' | 'trusted';

export interface BrowserAction {
  id: string;
  type: 'navigate' | 'click' | 'fill' | 'screenshot' | 'select' | 'press_key' | 'wait' | 'scroll';
  target?: string;      // URL, selector, or element description
  value?: string;       // text to fill, key to press
  description: string;  // human-readable description of what this action does
  requiresApproval: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  screenshotBefore?: string; // base64
  screenshotAfter?: string;  // base64
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
}

export interface ComputerUseResult {
  success: boolean;
  message: string;
  screenshotUrl?: string;
  actions: BrowserAction[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BRIDGE_URL = 'http://localhost:7778';
const BRIDGE_TIMEOUT = 15000;

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Creates a new computer-use session.
 */
export function createSession(
  agentName: string,
  task: string,
  permission: ComputerUsePermission
): ComputerUseSession {
  return {
    id: generateId(),
    agentName,
    task,
    permission,
    actions: [],
    status: 'planning',
    startedAt: new Date().toISOString(),
    approvedDomains: [],
  };
}

/**
 * Uses AI to plan a series of browser actions for the task.
 * Calls getSwanBotResponse with a structured prompt, then parses JSON output.
 */
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

  // Extract JSON array from the response
  let parsed: any[] = [];
  try {
    // Try direct parse first
    parsed = JSON.parse(aiResponse);
  } catch {
    // Try to extract JSON from markdown code blocks or mixed text
    const jsonMatch = aiResponse.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Fall back to a single navigate action
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

  // Convert to BrowserAction[]
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

/**
 * Low-level helper that calls Playwright MCP via the bridge's /mcp endpoint.
 * Falls back to /exec with playwright CLI if /mcp is unavailable.
 */
export async function callPlaywrightMCP(
  toolName: string,
  params: Record<string, any>
): Promise<any> {
  const online = await probeBridge();
  if (!online) {
    throw new Error('Bridge not reachable at localhost:7778');
  }

  // Try /mcp endpoint first
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
      const data = await res.json();
      return data;
    }
  } catch {
    // /mcp not available, fall through to /exec fallback
  }

  // Fallback: Use /exec to run playwright CLI commands
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

  const execRes = await fetch(`${BRIDGE_URL}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });

  if (!execRes.ok) {
    throw new Error(`Bridge /exec failed: ${execRes.status}`);
  }

  return execRes.json();
}

/**
 * Takes a screenshot and returns base64 data.
 * Tries Playwright MCP first, falls back to screencapture on Mac.
 */
export async function takeScreenshot(): Promise<string | null> {
  // Try Playwright MCP screenshot
  try {
    const result = await callPlaywrightMCP('mcp__playwright__browser_take_screenshot', {});
    if (result && result.screenshot) {
      return result.screenshot;
    }
    if (result && typeof result === 'string') {
      return result;
    }
  } catch {
    // Playwright MCP failed, try shell fallback
  }

  // Fallback: macOS screencapture
  try {
    const ts = Date.now();
    const path = `/tmp/cu_screenshot_${ts}.png`;
    const res = await fetch(`${BRIDGE_URL}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: `screencapture -x ${path} && base64 ${path} && rm ${path}` }),
    });
    if (res.ok) {
      const data = await res.json();
      const output = data.output || data.stdout || '';
      if (output && output.length > 100) {
        return output.trim();
      }
    }
  } catch {
    // Both methods failed
  }

  return null;
}

/**
 * Executes a single browser action via the bridge.
 * Returns the updated action with status + screenshot.
 */
export async function executeAction(action: BrowserAction): Promise<BrowserAction> {
  const updated: BrowserAction = { ...action, status: 'executing', executedAt: new Date().toISOString() };

  try {
    // Take screenshot before action
    const beforeShot = await takeScreenshot();
    if (beforeShot) {
      updated.screenshotBefore = beforeShot;
    }

    // Execute the action
    switch (action.type) {
      case 'navigate': {
        await callPlaywrightMCP('mcp__playwright__browser_navigate', {
          url: action.target || '',
        });
        break;
      }
      case 'click': {
        await callPlaywrightMCP('mcp__playwright__browser_click', {
          selector: action.target || '',
          element: action.target || '',
        });
        break;
      }
      case 'fill': {
        await callPlaywrightMCP('mcp__playwright__browser_fill_form', {
          selector: action.target || '',
          value: action.value || '',
        });
        break;
      }
      case 'screenshot': {
        const shot = await takeScreenshot();
        if (shot) {
          updated.screenshotAfter = shot;
        }
        updated.status = 'completed';
        return updated;
      }
      case 'select': {
        await callPlaywrightMCP('mcp__playwright__browser_select_option', {
          selector: action.target || '',
          value: action.value || '',
        });
        break;
      }
      case 'press_key': {
        await callPlaywrightMCP('mcp__playwright__browser_press_key', {
          key: action.value || action.target || '',
        });
        break;
      }
      case 'wait': {
        const ms = parseInt(action.value || '1000', 10);
        await new Promise(resolve => setTimeout(resolve, Math.min(ms, 10000)));
        break;
      }
      case 'scroll': {
        await callPlaywrightMCP('mcp__playwright__browser_press_key', {
          key: action.value === 'up' ? 'PageUp' : 'PageDown',
        });
        break;
      }
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    // Take screenshot after action
    const afterShot = await takeScreenshot();
    if (afterShot) {
      updated.screenshotAfter = afterShot;
    }

    updated.status = 'completed';
  } catch (err: any) {
    updated.status = 'failed';
    updated.error = err.message || 'Unknown error';
  }

  return updated;
}

/**
 * Checks whether an action can execute without explicit user approval.
 */
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
      // Allow if it's not a navigate action
      if (action.type !== 'navigate') return true;
      // Check if the domain is already approved
      const domain = extractDomain(action.target || '');
      return session.approvedDomains.includes(domain);
    }
    default:
      return false;
  }
}

/**
 * Executes all approved actions in sequence.
 * Calls onActionComplete after each one for live UI updates.
 * Takes a screenshot before and after each action.
 */
export async function executePlan(
  session: ComputerUseSession,
  onActionComplete: (action: BrowserAction, index: number) => void
): Promise<ComputerUseResult> {
  const results: BrowserAction[] = [];
  let lastScreenshot: string | undefined;

  for (let i = 0; i < session.actions.length; i++) {
    const action = session.actions[i];

    // Skip rejected or already completed actions
    if (action.status === 'rejected' || action.status === 'completed') {
      results.push(action);
      continue;
    }

    // Check if action is approved
    if (action.status !== 'approved') {
      // Check auto-approval based on permission level
      if (!checkPermission(session, action)) {
        results.push({ ...action, status: 'pending' });
        continue;
      }
    }

    // Execute the action
    const result = await executeAction(action);
    results.push(result);
    onActionComplete(result, i);

    if (result.screenshotAfter) {
      lastScreenshot = result.screenshotAfter;
    }

    // If action failed, stop execution
    if (result.status === 'failed') {
      return {
        success: false,
        message: `Failed at step ${i + 1}: ${result.error || 'Unknown error'}`,
        screenshotUrl: lastScreenshot ? `data:image/png;base64,${lastScreenshot}` : undefined,
        actions: results,
      };
    }

    // Track approved domains for ask_for_new_sites permission
    if (action.type === 'navigate' && action.target) {
      const domain = extractDomain(action.target);
      if (!session.approvedDomains.includes(domain)) {
        session.approvedDomains.push(domain);
      }
    }

    // Small delay between actions for stability
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const allCompleted = results.every(
    a => a.status === 'completed' || a.status === 'rejected'
  );

  return {
    success: allCompleted,
    message: allCompleted
      ? `Completed ${results.filter(a => a.status === 'completed').length} actions successfully`
      : `Completed ${results.filter(a => a.status === 'completed').length}/${results.length} actions`,
    screenshotUrl: lastScreenshot ? `data:image/png;base64,${lastScreenshot}` : undefined,
    actions: results,
  };
}
