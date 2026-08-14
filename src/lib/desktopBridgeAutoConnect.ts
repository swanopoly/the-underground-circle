import type { DesktopHealth } from './desktopBridge';
import type { BrowserHealth } from './browserBridge';
import {
  classifyDesktopBridgeHealth,
  type DesktopBridgeHealthClassification,
  type DesktopBridgeReadinessState,
} from './desktopBridgeProtocol';
import {
  buildDesktopBridgeRecoveryPayload,
  type DesktopBridgeRecoveryPayload,
} from './desktopBridgeRecovery';
import type { ChatFailureRecoveryOptionSelection } from './chatFailureRecovery';

export type DesktopBridgeAutoConnectStatus =
  | 'ready'
  | 'paired'
  | 'started_and_paired'
  | 'capability_missing'
  | 'source_changed'
  | 'restart_blocked'
  | 'unavailable'
  | 'unsupported'
  | 'pair_failed'
  | 'starter_unavailable'
  | 'starter_failed';

export interface DesktopBridgeAutoConnectResult {
  ok: boolean;
  status: DesktopBridgeAutoConnectStatus;
  content: string;
  health?: DesktopHealth | null;
  bridgeReadiness?: DesktopBridgeHealthClassification;
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
    bridgeState: DesktopBridgeReadinessState;
    attachmentOpenReady: boolean;
    sourceChanged: boolean | null;
    safeToRefresh: boolean | null;
    missingTools: readonly string[];
    classification: DesktopBridgeHealthClassification;
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
  const classification = classifyDesktopBridgeHealth(desktopHealth);
  const browserReady = !!browserHealth?.ok;
  const title = compact(browserHealth?.currentTitle || '', 100) || null;
  const url = compact(browserHealth?.currentUrl || '', 160) || null;
  return {
    desktop: {
      // Generic desktop/file tools stay usable when only the newer private
      // attachment capability or restart evidence is missing.
      ready: classification.genericToolsReady,
      platform: compact(desktopHealth?.platform || 'unknown', 40),
      supported: classification.supported,
      toolCount: classification.advertisedTools.length,
      bridgeState: classification.state,
      attachmentOpenReady: classification.attachmentOpenReady,
      sourceChanged: classification.sourceChanged,
      safeToRefresh: classification.safeToRefresh,
      missingTools: classification.missingTools,
      classification,
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
  status: Extract<DesktopBridgeAutoConnectStatus,
    | 'ready'
    | 'paired'
    | 'started_and_paired'
    | 'capability_missing'
    | 'source_changed'
    | 'restart_blocked'>,
  wasPaired: boolean,
  readiness: DesktopBrowserReadiness,
): string {
  const bridgeState = readiness.desktop.bridgeState;
  const title = bridgeState === 'capability_missing'
    ? '**Desktop bridge connected with limited uploaded-file support.**'
    : bridgeState === 'source_changed'
      ? '**Desktop bridge connected; newer local source is ready.**'
      : bridgeState === 'restart_blocked'
        ? '**Desktop bridge connected; refresh safety needs attention.**'
        : status === 'started_and_paired'
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
    ? 'Existing pairing token reused. Sensitive desktop/browser actions still ask for approval.'
    : 'Sensitive desktop/browser actions still ask for approval. First desktop/browser use may trigger macOS permission prompts.';

  const readinessLines = bridgeState === 'capability_missing'
    ? [
        'Uploaded-file opening: this running bridge is missing the private attachment capability; ordinary desktop tools remain available.',
        readiness.desktop.sourceChanged === false
          ? 'This process reports source-current, so install or update to the current app source before restarting the local supervisor. Then tap **DESKTOP** to recheck. Nothing was restarted automatically.'
          : 'Finish any current desktop work, restart the local supervisor that owns this bridge, then tap **DESKTOP** to recheck. Nothing was restarted automatically.',
      ]
    : bridgeState === 'source_changed'
      ? [
          'Bridge update: newer local source is available and health reports an idle-safe refresh opportunity.',
          'Restart the local supervisor, then tap **DESKTOP** to recheck. Nothing was restarted automatically.',
        ]
      : bridgeState === 'restart_blocked'
        ? [
            readiness.desktop.classification.detail,
            'Keep current work intact. When it is safe, restart the local supervisor and tap **DESKTOP** to recheck; this client will not restart it.',
          ]
        : [];

  return [
    title,
    '',
    desktopLine,
    ...readinessLines,
    browserLine,
    permissionLine,
  ].join('\n');
}

const RESTART_BLOCKER_LABELS: Record<string, string> = {
  possibly_active_sessions: 'possibly active sessions',
  session_state_unknown: 'unknown session state',
  live_spawned_children: 'live agent child processes',
  spawned_child_state_unknown: 'unknown child-process state',
  pending_private_capabilities: 'pending private attachment capabilities',
  private_capability_request_in_flight: 'a private attachment request in flight',
  session_mutation_request_in_flight: 'a session mutation in flight',
  bridge_work_request_in_flight: 'bridge work in flight',
  aborted_bridge_work_outcome_unknown: 'an interrupted request with unknown outcome',
  browser_runtime_active: 'an active browser runtime',
  browser_runtime_state_unknown: 'unknown browser-runtime state',
  refresh_drain_active: 'an existing refresh drain',
  manual_process_owner: 'a manually owned bridge process',
  supervisor_state_unknown: 'unknown supervisor state',
  supervisor_not_alive: 'an unavailable supervisor',
  supervisor_ipc_unavailable: 'an unavailable supervisor control channel',
  supervisor_ack_stale: 'stale supervisor acknowledgement',
  supervisor_replacement_not_ready: 'a replacement process that is not ready',
  current_source_validation_required: 'source validation that is not current',
  current_source_syntax_invalid: 'invalid current source syntax',
  current_source_dependency_load_failed: 'a source dependency that did not load',
  current_source_main_load_failed: 'the bridge entrypoint that did not load',
  current_source_dependency_missing: 'a missing bridge source dependency',
  current_source_invalid: 'an invalid bridge source file',
  current_source_not_quiet: 'source files that are still changing',
  current_source_unstable: 'unstable bridge source files',
};

function humanizeRestartBlockers(blockers: readonly string[]): string {
  return blockers
    .slice(0, 6)
    .map((blocker) => RESTART_BLOCKER_LABELS[blocker] || blocker.replace(/_/g, ' '))
    .join(', ');
}

/** Build a Chat-compatible, typed recovery card from read-only bridge health.
 * The action is deliberately a recheck after a user-owned supervisor restart;
 * selecting it never calls `/desktop/refresh_if_idle` or process controls. */
export function buildDesktopBridgeReadinessRecoveryPayload(
  classification: DesktopBridgeHealthClassification,
): DesktopBridgeRecoveryPayload {
  const state = classification.state;
  const blockerText = humanizeRestartBlockers(classification.blockers);
  const content = state === 'capability_missing'
    ? [
        '**Desktop bridge update needed for uploaded-file opening.**',
        '',
        'The running bridge still supports its advertised ordinary desktop and file tools, but it does not expose the private attachment-open capability.',
        classification.sourceChanged === true
          ? 'Health confirms newer local source is available.'
          : classification.sourceChanged === false
            ? 'This process reports source-current, so its installed source does not include the required capability.'
            : 'This older health contract cannot prove whether local source changed.',
        '',
        classification.sourceChanged === false
          ? 'Install or update to the current app source first. Then restart the same local supervisor that owns this bridge (`npm run start`, or `npm run bridge` when the bridge is run separately) and tap **DESKTOP** to recheck. This client did not restart anything.'
          : 'Finish any current desktop work, restart the same local supervisor that owns this bridge (`npm run start`, or `npm run bridge` when the bridge is run separately), then tap **DESKTOP** to recheck. This client did not restart anything.',
      ].join('\n')
    : state === 'source_changed'
      ? [
          '**Desktop bridge update ready.**',
          '',
          'The bridge advertises the required capability and reports an idle-safe source refresh opportunity.',
          '',
          'Restart the same local supervisor that owns the bridge, then tap **DESKTOP** to recheck. This client did not restart anything.',
        ].join('\n')
      : state === 'restart_blocked'
        ? [
            '**Desktop bridge refresh is not safe yet.**',
            '',
            blockerText
              ? `Health reports ${blockerText}.`
              : classification.detail,
            '',
            'Keep current work intact. After the blocker clears, restart the same local supervisor and tap **DESKTOP** to recheck. This client will not restart or interrupt the bridge.',
          ].join('\n')
        : state === 'unavailable'
          ? classification.recoveryCode === 'platform_unsupported'
            ? `**Desktop bridge platform not supported.**\n\n${classification.detail}\n\nUse a supported macOS desktop environment, then recheck.`
            : `**Desktop bridge is not ready.**\n\n${classification.detail}\n\nStart the app with \`npm run start\` (or the bridge alone with \`npm run bridge\`), then tap **DESKTOP** to recheck.`
          : '**Desktop bridge is current.**\n\nNo bridge recovery is needed.';
  const recheckLabel = state === 'restart_blocked'
    ? 'Recheck bridge safety'
    : state === 'unavailable'
      ? 'Recheck bridge connection'
      : 'Recheck after restarting';
  const recoveryOptions: DesktopBridgeRecoveryPayload['recoveryOptions'] = state === 'current'
    ? []
    : classification.recoveryCode === 'platform_unsupported'
      ? [{
          id: 'stop_and_report',
          label: 'Show desktop support details',
          detail: 'Local desktop automation currently requires a supported macOS environment.',
          actor: 'none',
          recommended: true,
          source: 'safety_stop',
        }]
      : [
          {
            id: 'repair_or_restart_bridge',
            label: recheckLabel,
            detail: state === 'restart_blocked'
              ? 'Let the reported work or uncertainty clear first. This action only rechecks health and pairing; it does not restart the process.'
              : 'Restart the user-owned local supervisor first when instructed, then use this action to recheck health and pairing.',
            actor: 'user',
            recommended: true,
            source: 'recovery_policy',
          },
          {
            id: 'let_connected_agent_repair',
            label: 'Inspect bridge readiness',
            detail: `Have a connected agent inspect the typed ${classification.recoveryCode} state without restarting or interrupting current work.`,
            actor: 'connected_agent',
            recommended: false,
            source: 'connected_agent_runbook',
          },
          {
            id: 'stop_and_report',
            label: 'Keep current work running',
            detail: 'Make no bridge change and keep the current readiness limitation visible.',
            actor: 'none',
            recommended: false,
            source: 'safety_stop',
          },
        ];

  return {
    content,
    recoveryOptions,
    touched: [
      'surface:desktop_bridge',
      `desktop_bridge:${state}`,
      `desktop_bridge_recovery:${classification.recoveryCode}`,
    ],
  };
}

async function pairReachableBridge(
  health: DesktopHealth,
  status: Extract<DesktopBridgeAutoConnectStatus, 'ready' | 'paired' | 'started_and_paired'>,
): Promise<DesktopBridgeAutoConnectResult> {
  const { ensureDesktopBridgePaired, isDesktopBridgePaired } = await import('./desktopBridge');
  const classification = classifyDesktopBridgeHealth(health);
  if (!classification.supported) {
    if (classification.recoveryCode !== 'platform_unsupported') {
      const payload = buildDesktopBridgeReadinessRecoveryPayload(classification);
      return {
        ok: false,
        status: 'unavailable',
        content: payload.content,
        health,
        bridgeReadiness: classification,
        recoveryPayload: payload,
        detail: classification.detail,
        userActionRequired: true,
      };
    }
    const payload = buildDesktopBridgeRecoveryPayload(
      'unsupported',
      `Bridge is on ${health.platform} - desktop automation is macOS-only in this phase.`,
    );
    return {
      ok: false,
      status: 'unsupported',
      content: payload.content,
      health,
      bridgeReadiness: classification,
      recoveryPayload: payload,
      userActionRequired: true,
    };
  }

  const wasPaired = isDesktopBridgePaired();
  // Reuse the cached/secondary pairing token when it is still present. A
  // direct pair call always starts a fresh challenge exchange and produced a
  // harmless but noisy 428 in the console on every Chat app task. Bridge calls
  // already repair a stale cached token after a 401, so this keeps recovery
  // intact without forcing a new challenge up front.
  const paired = await ensureDesktopBridgePaired();
  if (!paired.ok) {
    const payload = buildDesktopBridgeRecoveryPayload('pair_failed', paired.error || 'unknown error');
    return {
      ok: false,
      status: 'pair_failed',
      content: payload.content,
      health,
      bridgeReadiness: classification,
      recoveryPayload: payload,
      detail: paired.error || 'pair failed',
      userActionRequired: true,
    };
  }

  const browserHealth = await getBrowserReadiness();
  const readiness = buildDesktopBrowserReadiness(health, browserHealth);
  const bridgeState = readiness.desktop.bridgeState;
  const resultStatus: DesktopBridgeAutoConnectStatus = bridgeState === 'current'
    ? status
    : bridgeState;
  const recoveryPayload = bridgeState === 'current'
    ? undefined
    : buildDesktopBridgeReadinessRecoveryPayload(readiness.desktop.classification);
  return {
    // Pairing and ordinary advertised tools remain usable even when the
    // attachment-specific readiness state needs recovery.
    ok: readiness.desktop.ready,
    status: resultStatus,
    content: renderDesktopBridgeConnectedMessage(
      resultStatus === 'unavailable' ? 'restart_blocked' : resultStatus,
      wasPaired,
      readiness,
    ),
    health,
    bridgeReadiness: readiness.desktop.classification,
    readiness,
    recoveryPayload,
    detail: bridgeState === 'current' ? undefined : readiness.desktop.classification.detail,
    userActionRequired: bridgeState === 'current' ? undefined : true,
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

  return {
    ok: false,
    attempted: false,
    detail: 'Automatic shell-based bridge restart is disabled. Restart the local supervisor manually, then retry pairing.',
  };
}

function unavailableResult(detail: string): DesktopBridgeAutoConnectResult {
  const bridgeReadiness = classifyDesktopBridgeHealth(null);
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
    bridgeReadiness,
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
      bridgeReadiness: classifyDesktopBridgeHealth(null),
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
