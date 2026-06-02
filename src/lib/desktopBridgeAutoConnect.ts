import type { DesktopHealth } from './desktopBridge';
import type { BrowserHealth } from './browserBridge';
import {
  buildDesktopBridgeRecoveryPayload,
  type DesktopBridgeRecoveryPayload,
} from './desktopBridgeRecovery';
import type { ChatFailureRecoveryOptionSelection } from './chatFailureRecovery';

export type DesktopBridgeAutoConnectStatus =
  | 'ready'
  | 'paired'
  | 'started_and_paired'
  | 'unsupported'
  | 'pair_failed'
  | 'starter_unavailable'
  | 'starter_failed';

export interface DesktopBridgeAutoConnectResult {
  ok: boolean;
  status: DesktopBridgeAutoConnectStatus;
  content: string;
  health?: DesktopHealth | null;
  readiness?: DesktopBrowserReadiness;
  recoveryPayload?: DesktopBridgeRecoveryPayload;
  detail?: string;
  userActionRequired?: boolean;
}

export interface DesktopBrowserReadiness {
  desktop: {
    ready: boolean;
    platform: string;
    supported: boolean;
    toolCount: number;
  };
  browser: {
    ready: boolean;
    contextOpen: boolean;
    currentTitle: string | null;
    currentUrl: string | null;
    detail: string;
  };
}

interface LocalStarterResult {
  ok: boolean;
  attempted: boolean;
  detail: string;
}

const DESKTOP_BRIDGE_PORT = 7778;
const START_WAIT_DELAYS_MS = [500, 900, 1400, 2200, 3200];

function compact(value: unknown, max = 500): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildDesktopBridgeBackgroundStartCommand(port = DESKTOP_BRIDGE_PORT): string {
  const repairCommand = [
    'sleep 0.5',
    `if lsof -ti:${port} >/dev/null 2>&1; then lsof -ti:${port} | xargs kill 2>/dev/null || true; fi`,
    'npm run bridge',
  ].join(' && ');
  const nodeScript = [
    "const { spawn } = require('child_process');",
    `const child = spawn(process.env.SHELL || 'sh', ['-lc', ${JSON.stringify(repairCommand)}], { cwd: process.cwd(), detached: true, stdio: 'ignore' });`,
    'child.unref();',
    "console.log('STARTED');",
  ].join(' ');
  return `node -e ${shellQuote(nodeScript)}`;
}

export const buildDesktopBridgeTerminalStartCommand = buildDesktopBridgeBackgroundStartCommand;

export function isDesktopBridgeRecoverySelection(
  selection: ChatFailureRecoveryOptionSelection | null | undefined,
): boolean {
  if (!selection || selection.optionId !== 'repair_or_restart_bridge') return false;
  const surface = compact(selection.context?.sourceSurface, 160);
  return surface === 'desktop_bridge'
    || surface === 'main_chat_desktop_bridge'
    || surface.startsWith('desktop_bridge_');
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 3000,
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' as RequestCache });
    const text = await res.text().catch(() => '');
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForDesktopBridgeHealth(): Promise<DesktopHealth | null> {
  const { getDesktopBridgeHealth } = await import('./desktopBridge');
  for (const delay of START_WAIT_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const health = await getDesktopBridgeHealth();
    if (health) return health;
  }
  return null;
}

async function getBrowserReadiness(): Promise<BrowserHealth | null> {
  try {
    const { getBrowserHealth } = await import('./browserBridge');
    return await getBrowserHealth();
  } catch {
    return null;
  }
}

export function buildDesktopBrowserReadiness(
  desktopHealth: DesktopHealth,
  browserHealth?: BrowserHealth | null,
): DesktopBrowserReadiness {
  const browserReady = !!browserHealth?.ok;
  const title = compact(browserHealth?.currentTitle || '', 100) || null;
  const url = compact(browserHealth?.currentUrl || '', 160) || null;
  return {
    desktop: {
      ready: !!desktopHealth?.ok && !!desktopHealth.supported,
      platform: compact(desktopHealth?.platform || 'unknown', 40),
      supported: !!desktopHealth?.supported,
      toolCount: Array.isArray(desktopHealth?.tools) ? desktopHealth.tools.length : 0,
    },
    browser: {
      ready: browserReady,
      contextOpen: !!browserHealth?.contextOpen,
      currentTitle: title,
      currentUrl: url,
      detail: browserReady
        ? browserHealth?.contextOpen
          ? `UC browser is open${title ? ` on ${title}` : ''}.`
          : 'UC browser bridge is ready and will open a page when a browser task starts.'
        : 'Browser bridge is not available yet; desktop tools can still run.',
    },
  };
}

export function renderDesktopBridgeConnectedMessage(
  status: Extract<DesktopBridgeAutoConnectStatus, 'ready' | 'paired' | 'started_and_paired'>,
  wasPaired: boolean,
  readiness: DesktopBrowserReadiness,
): string {
  const title = status === 'started_and_paired'
    ? '**Desktop bridge started and paired.**'
    : wasPaired
      ? '**Desktop bridge connected.**'
      : '**Desktop bridge paired.**';
  const desktopLine = readiness.desktop.ready
    ? `Desktop: ready (${readiness.desktop.toolCount} tools).`
    : 'Desktop: connected, but this platform is not supported for desktop automation.';
  const browserLine = readiness.browser.ready
    ? `Browser: ${readiness.browser.contextOpen ? 'ready with an open UC browser session.' : 'ready; opens on first browser task.'}`
    : 'Browser: not ready yet; desktop tasks can still run.';
  const permissionLine = wasPaired && status !== 'started_and_paired'
    ? 'Pairing token refreshed. Sensitive desktop/browser actions still ask for approval.'
    : 'Sensitive desktop/browser actions still ask for approval. First desktop/browser use may trigger macOS permission prompts.';

  return [
    title,
    '',
    desktopLine,
    browserLine,
    permissionLine,
  ].join('\n');
}

async function pairReachableBridge(
  health: DesktopHealth,
  status: Extract<DesktopBridgeAutoConnectStatus, 'ready' | 'paired' | 'started_and_paired'>,
): Promise<DesktopBridgeAutoConnectResult> {
  const { isDesktopBridgePaired, pairDesktopBridge } = await import('./desktopBridge');
  if (!health.supported) {
    const payload = buildDesktopBridgeRecoveryPayload(
      'unsupported',
      `Bridge is on ${health.platform} - desktop automation is macOS-only in this phase.`,
    );
    return {
      ok: false,
      status: 'unsupported',
      content: payload.content,
      health,
      recoveryPayload: payload,
      userActionRequired: true,
    };
  }

  const wasPaired = isDesktopBridgePaired();
  const paired = await pairDesktopBridge();
  if (!paired.ok) {
    const payload = buildDesktopBridgeRecoveryPayload('pair_failed', paired.error || 'unknown error');
    return {
      ok: false,
      status: 'pair_failed',
      content: payload.content,
      health,
      recoveryPayload: payload,
      detail: paired.error || 'pair failed',
      userActionRequired: true,
    };
  }

  const browserHealth = await getBrowserReadiness();
  const readiness = buildDesktopBrowserReadiness(health, browserHealth);
  return {
    ok: true,
    status,
    content: renderDesktopBridgeConnectedMessage(status, wasPaired, readiness),
    health,
    readiness,
  };
}

async function tryStartViaReachableBridge(): Promise<LocalStarterResult> {
  const { getDesktopBridgeBaseUrl } = await import('./desktopBridge');
  const base = getDesktopBridgeBaseUrl();
  if (!base) {
    return {
      ok: false,
      attempted: false,
      detail: 'Bridge probing is disabled for this runtime.',
    };
  }

  let health: { ok: boolean; status: number; json: any; text: string };
  try {
    health = await fetchJsonWithTimeout(`${base}/health`, {}, 2200);
  } catch (error: any) {
    return {
      ok: false,
      attempted: false,
      detail: error?.name === 'AbortError'
        ? 'No local bridge process answered before timeout.'
        : 'No local bridge process is reachable to receive a startup command.',
    };
  }

  if (!health.ok || health.json?.ok !== true) {
    return {
      ok: false,
      attempted: false,
      detail: `Bridge starter endpoint is not healthy${health.status ? ` (HTTP ${health.status})` : ''}.`,
    };
  }

  const capabilities = Array.isArray(health.json?.capabilities) ? health.json.capabilities.map(String) : [];
  if (!capabilities.includes('exec')) {
    return {
      ok: false,
      attempted: false,
      detail: 'The reachable local bridge does not expose the restricted /exec repair endpoint.',
    };
  }

  const command = buildDesktopBridgeBackgroundStartCommand(DESKTOP_BRIDGE_PORT);
  try {
    const result = await fetchJsonWithTimeout(`${base}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    }, 5000);
    if (result.ok && result.json?.ok !== false) {
      return {
        ok: true,
        attempted: true,
        detail: 'Started npm run bridge in the background.',
      };
    }
    return {
      ok: false,
      attempted: true,
      detail: compact(result.json?.error || result.text || `HTTP ${result.status}`, 360),
    };
  } catch (error: any) {
    return {
      ok: false,
      attempted: true,
      detail: error?.message || 'Bridge starter request failed.',
    };
  }
}

function unavailableResult(detail: string): DesktopBridgeAutoConnectResult {
  const payload = buildDesktopBridgeRecoveryPayload('unreachable', detail);
  return {
    ok: false,
    status: 'starter_unavailable',
    content: [
      '**Desktop bridge is still offline.**',
      '',
      'I tried to connect it from chat, but no local bridge/starter endpoint is reachable. A browser-only page cannot launch a new Terminal process when nothing local is listening.',
      '',
      'Start this app with `npm run start` or run `npm run bridge` once. After the bridge is listening, tap **DESKTOP** again and it will pair itself.',
    ].join('\n'),
    recoveryPayload: {
      ...payload,
      content: [
        '**Desktop bridge is still offline.**',
        '',
        'I tried to connect it from chat, but no local bridge/starter endpoint is reachable. A browser-only page cannot launch a new Terminal process when nothing local is listening.',
        '',
        'Start this app with `npm run start` or run `npm run bridge` once. After the bridge is listening, tap **DESKTOP** again and it will pair itself.',
      ].join('\n'),
    },
    detail,
    userActionRequired: true,
  };
}

export async function autoConnectDesktopBridge(): Promise<DesktopBridgeAutoConnectResult> {
  const { getDesktopBridgeHealth } = await import('./desktopBridge');
  const initialHealth = await getDesktopBridgeHealth();
  if (initialHealth) {
    return pairReachableBridge(initialHealth, 'paired');
  }

  const starter = await tryStartViaReachableBridge();
  if (!starter.ok) {
    if (!starter.attempted) return unavailableResult(starter.detail);
    const payload = buildDesktopBridgeRecoveryPayload('unreachable', starter.detail);
    return {
      ok: false,
      status: 'starter_failed',
      content: [
        '**Desktop bridge start failed.**',
        '',
        compact(starter.detail) || 'The local bridge starter returned an error.',
        '',
        'Run `npm run bridge` once, then tap **DESKTOP** again.',
      ].join('\n'),
      recoveryPayload: payload,
      detail: starter.detail,
      userActionRequired: true,
    };
  }

  const startedHealth = await waitForDesktopBridgeHealth();
  if (!startedHealth) {
    return unavailableResult('Started Terminal, but localhost:7778 did not become healthy before timeout.');
  }
  return pairReachableBridge(startedHealth, 'started_and_paired');
}
