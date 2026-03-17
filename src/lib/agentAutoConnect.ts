/**
 * App-level agent auto-connect service.
 * Runs detection for Claude Code bridge + OpenClaw gateway immediately on auth,
 * so agents are already connected when the user opens the Office tab.
 *
 * Resilience features:
 *  - Exponential backoff retry (5s → 10s → 20s → 30s cap)
 *  - Tries both CORS proxy (:18790) and direct gateway (:18789) for OpenClaw
 *  - Visibility-change listener: instantly retries when user switches back to tab
 *  - Poller error detection: marks connection as error after 3 consecutive failures
 *  - Singleton — safe to call start() multiple times.
 */

import {
  ClaudeCodePoller,
  ClaudeCodeSession,
  bridgeSessionsToAgents,
  detectClaudeCodeBridge,
  publishClaudeCodeAgent,
  updateClaudeCodeAgentStatus,
  markClaudeCodeAgentOffline,
} from './claudeCodeDetector';
import {
  AgentConnection,
  loadConnections,
  saveConnections,
  autoDiscoverLocalAgents,
  probeEndpointHealth,
} from './connectionManager';
import {
  OpenClawConfig,
  OpenClawPoller,
  OpenClawUpdate,
  testConnection,
  listAgents,
} from './openclawService';
import { OfficeAgent } from './officeAgents';
import { Platform } from 'react-native';

// ── Singleton state ──────────────────────────────────────────────────────────

let _running = false;
let _connections: AgentConnection[] = [];
let _sessionsMap = new Map<string, any[]>();
let _ccPoller: ClaudeCodePoller | null = null;
let _ccPublished = false;
let _ocPollers = new Map<string, OpenClawPoller>();
let _retryTimer: ReturnType<typeof setInterval> | null = null;
let _ocReconnectTimer: ReturnType<typeof setInterval> | null = null;
let _circleId: string | null = null;
let _visibilityHandler: (() => void) | null = null;
let _retryAttempt = 0; // for exponential backoff

// Listeners that want to know when sessions/connections change
type Listener = () => void;
const _listeners = new Set<Listener>();

// ── Constants ────────────────────────────────────────────────────────────────

const RETRY_BASE_MS = 5000;      // Initial retry interval
const RETRY_MAX_MS = 30000;      // Max retry interval
const CC_DETECT_INTERVAL = 10000; // Claude Code bridge detection interval
const OC_RECONNECT_INTERVAL = 10000; // OpenClaw reconnect check interval

// Alternate OpenClaw endpoints to try (CORS proxy first, then direct gateway)
const OPENCLAW_FALLBACK_ENDPOINTS = [
  'http://localhost:18790', // CORS proxy (preferred)
  'http://localhost:18789', // Direct gateway (may work if CORS is configured)
];

// ── Public getters ───────────────────────────────────────────────────────────

export function isAutoConnectRunning(): boolean {
  return _running;
}

export function getAutoConnectConnections(): AgentConnection[] {
  return _connections;
}

export function getAutoConnectSessions(): Map<string, any[]> {
  return _sessionsMap;
}

/** Subscribe to state changes. Returns unsubscribe fn. */
export function subscribeAutoConnect(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function _notify() {
  for (const fn of _listeners) {
    try { fn(); } catch {}
  }
}

/** Allow OfficeTab to set the circleId once it knows it, so we can publish to DB */
export function setAutoConnectCircleId(circleId: string) {
  _circleId = circleId;
}

/** Allow OfficeTab to update connections (e.g. user adds/removes) */
export function updateAutoConnectConnections(conns: AgentConnection[]) {
  _connections = conns;
}

// ── Backoff helper ──────────────────────────────────────────────────────────

function _getRetryInterval(): number {
  // Exponential backoff: 5s, 10s, 20s, 30s (cap)
  const interval = Math.min(RETRY_BASE_MS * Math.pow(2, _retryAttempt), RETRY_MAX_MS);
  return interval;
}

// ── Start (called once from App.tsx after auth) ──────────────────────────────

export async function startAgentAutoConnect() {
  if (_running) return;
  _running = true;
  _retryAttempt = 0;
  console.log('[agentAutoConnect] Starting app-level agent detection...');

  // 1. Load saved connections
  let conns = await loadConnections();

  // 2. Auto-discover OpenClaw gateway (tries both proxy and direct endpoints)
  const { discovered } = await autoDiscoverLocalAgents(conns);
  if (discovered) {
    const existingOpenClaw = conns.find(c => c.provider === 'openclaw');
    if (existingOpenClaw?.token) {
      discovered.token = existingOpenClaw.token;
    }
    conns = [...conns, discovered];
    saveConnections(conns);
    console.log('[agentAutoConnect] Auto-discovered OpenClaw at', discovered.endpoint);
  }

  _connections = conns;
  _notify();

  // 3. Auto-connect all enabled connections
  for (const conn of conns) {
    if (conn.enabled) {
      _connectWithFallback(conn);
    }
  }

  // 4. Detect Claude Code bridge
  const ccDetected = await detectClaudeCodeBridge();
  if (ccDetected) {
    _startCCPoller();
    console.log('[agentAutoConnect] Claude Code bridge detected');
  }

  // 5. Retry loop: re-detect Claude Code bridge + reconnect failed connections
  _startRetryLoop();

  // 6. Listen for visibility changes — instantly retry when user comes back to tab
  _startVisibilityListener();
}

// ── Stop (called on logout) ──────────────────────────────────────────────────

export function stopAgentAutoConnect() {
  if (!_running) return;
  _running = false;

  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
  if (_ocReconnectTimer) { clearInterval(_ocReconnectTimer); _ocReconnectTimer = null; }
  if (_ccPoller) { _ccPoller.stop(); _ccPoller = null; }
  for (const [, poller] of _ocPollers) {
    poller.stop();
  }
  _ocPollers.clear();
  _connections = [];
  _sessionsMap.clear();
  _ccPublished = false;
  _circleId = null;
  _retryAttempt = 0;
  _stopVisibilityListener();
  _listeners.clear();
  console.log('[agentAutoConnect] Stopped');
}

// ── Internal: Unified retry loop ────────────────────────────────────────────

function _startRetryLoop() {
  // Clear any existing timers
  if (_retryTimer) clearInterval(_retryTimer);
  if (_ocReconnectTimer) clearInterval(_ocReconnectTimer);

  // Claude Code bridge detection — every 10s
  _retryTimer = setInterval(async () => {
    if (!_running) return;
    const detected = await detectClaudeCodeBridge();

    if (detected && !_ccPoller) {
      _startCCPoller();
      _retryAttempt = 0; // Reset backoff on success
      console.log('[agentAutoConnect] Claude Code bridge came online');
    } else if (!detected && _ccPoller) {
      _ccPoller.stop();
      _ccPoller = null;
      // Mark existing CC sessions as idle (not remove)
      const existing = _sessionsMap.get('claude-code-auto') as OfficeAgent[] | undefined;
      if (existing && existing.length > 0) {
        const idled = existing.map(a => ({ ...a, status: 'idle' as const, activity: 'Session ended — idling' }));
        _sessionsMap.set('claude-code-auto', idled);
        _notify();
      }
      if (_ccPublished && _circleId) {
        markClaudeCodeAgentOffline(_circleId).catch(() => {});
      }
      console.log('[agentAutoConnect] Claude Code bridge went offline');
    }
  }, CC_DETECT_INTERVAL);

  // OpenClaw reconnect — with backoff
  const scheduleOcReconnect = () => {
    if (_ocReconnectTimer) clearInterval(_ocReconnectTimer);
    const interval = _getRetryInterval();

    _ocReconnectTimer = setInterval(async () => {
      if (!_running) return;

      const failedConns = _connections.filter(
        c => c.enabled && (c.status === 'error' || c.status === 'disconnected'),
      );

      if (failedConns.length === 0) {
        _retryAttempt = 0; // All connected, reset backoff
        return;
      }

      let anySuccess = false;
      for (const conn of failedConns) {
        // Try the saved endpoint first, then fallbacks
        const healthy = await _probeWithFallbacks(conn);
        if (healthy) {
          await _connectWithFallback(conn);
          if (_connections.find(c => c.id === conn.id)?.status === 'connected') {
            anySuccess = true;
          }
        }
      }

      if (anySuccess) {
        _retryAttempt = 0; // Reset backoff on success
        scheduleOcReconnect(); // Reschedule with faster interval
      } else {
        _retryAttempt = Math.min(_retryAttempt + 1, 4); // Increase backoff (cap at 4 = 30s)
        const newInterval = _getRetryInterval();
        if (newInterval !== interval) {
          scheduleOcReconnect(); // Reschedule with new interval
        }
      }
    }, interval);
  };

  scheduleOcReconnect();
}

// ── Internal: Visibility change listener ────────────────────────────────────

function _startVisibilityListener() {
  if (Platform.OS !== 'web') return;
  if (_visibilityHandler) return;

  _visibilityHandler = () => {
    if (document.visibilityState !== 'visible') return;
    if (!_running) return;

    console.log('[agentAutoConnect] Tab became visible — checking connections...');
    _retryAttempt = 0; // Reset backoff immediately

    // Immediately check Claude Code bridge
    detectClaudeCodeBridge().then(detected => {
      if (detected && !_ccPoller) {
        _startCCPoller();
        console.log('[agentAutoConnect] Claude Code bridge reconnected on tab focus');
      }
    });

    // Immediately retry failed OpenClaw connections
    const failedConns = _connections.filter(
      c => c.enabled && (c.status === 'error' || c.status === 'disconnected'),
    );
    for (const conn of failedConns) {
      _connectWithFallback(conn);
    }
  };

  document.addEventListener('visibilitychange', _visibilityHandler);
}

function _stopVisibilityListener() {
  if (Platform.OS !== 'web') return;
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }
}

// ── Internal: Claude Code poller ─────────────────────────────────────────────

function _startCCPoller() {
  if (_ccPoller) return;
  _ccPoller = new ClaudeCodePoller(sessions => {
    _sessionsMap.set('claude-code-auto', bridgeSessionsToAgents(sessions) as any);
    _notify();

    // Publish to circle DB if we have a circleId
    if (!_ccPublished && _circleId) {
      _ccPublished = true;
      publishClaudeCodeAgent(_circleId, sessions.length).catch(err =>
        console.error('[agentAutoConnect] Failed to publish CC agent:', err),
      );
    }
    if (_ccPublished && _circleId) {
      updateClaudeCodeAgentStatus(_circleId, sessions).catch(() => {});
    }
  });
  _ccPoller.start(5000);
}

// ── Internal: Probe with fallback endpoints ─────────────────────────────────

async function _probeWithFallbacks(conn: AgentConnection): Promise<boolean> {
  // Try the saved endpoint first
  const primary = await probeEndpointHealth(conn.endpoint);
  if (primary) return true;

  // For OpenClaw connections, try alternate endpoints
  if (conn.provider === 'openclaw') {
    for (const fallback of OPENCLAW_FALLBACK_ENDPOINTS) {
      if (fallback === conn.endpoint) continue; // Already tried
      const ok = await probeEndpointHealth(fallback);
      if (ok) {
        // Update the connection's endpoint to the working one
        console.log('[agentAutoConnect] Switching endpoint:', conn.endpoint, '→', fallback);
        conn.endpoint = fallback;
        _connections = _connections.map(c =>
          c.id === conn.id ? { ...c, endpoint: fallback } : c,
        );
        saveConnections(_connections);
        _notify();
        return true;
      }
    }
  }

  return false;
}

// ── Internal: Connect with endpoint fallback ─────────────────────────────────

async function _connectWithFallback(conn: AgentConnection) {
  // Update status to connecting
  _connections = _connections.map(c =>
    c.id === conn.id ? { ...c, status: 'connecting' as const, error: undefined } : c,
  );
  _notify();

  // Try the saved endpoint
  let config: OpenClawConfig = { endpoint: conn.endpoint, token: conn.token };
  let result = await testConnection(config);

  // If failed and this is an OpenClaw connection, try fallback endpoints
  if (!result.ok && conn.provider === 'openclaw') {
    for (const fallback of OPENCLAW_FALLBACK_ENDPOINTS) {
      if (fallback === conn.endpoint) continue; // Already tried
      const fallbackConfig: OpenClawConfig = { endpoint: fallback, token: conn.token };
      const fallbackResult = await testConnection(fallbackConfig);
      if (fallbackResult.ok) {
        console.log('[agentAutoConnect] Connected via fallback endpoint:', fallback);
        // Update connection to use the working endpoint
        conn = { ...conn, endpoint: fallback };
        _connections = _connections.map(c =>
          c.id === conn.id ? { ...c, endpoint: fallback } : c,
        );
        saveConnections(_connections);
        config = fallbackConfig;
        result = fallbackResult;
        break;
      }
    }
  }

  if (!result.ok) {
    _connections = _connections.map(c =>
      c.id === conn.id ? { ...c, status: 'error' as const, error: result.error || 'Connection failed' } : c,
    );
    _notify();
    return;
  }

  // Store initial sessions
  _sessionsMap.set(conn.id, result.sessions || []);

  // Fetch agent ids
  let agentIds: string[] = [];
  const agentsResult = await listAgents(config);
  if (agentsResult.ok && agentsResult.agents) agentIds = agentsResult.agents;

  // Update connection status
  _connections = _connections.map(c =>
    c.id === conn.id
      ? {
          ...c,
          status: 'connected' as const,
          error: undefined,
          sessionCount: (result.sessions || []).length,
          agentIds,
          lastConnected: new Date().toISOString(),
        }
      : c,
  );

  // Start poller
  const oldPoller = _ocPollers.get(conn.id);
  if (oldPoller) oldPoller.stop();

  const poller = new OpenClawPoller(config, (update: OpenClawUpdate) => {
    _sessionsMap.set(conn.id, update.sessions);
    _connections = _connections.map(c =>
      c.id === conn.id && c.status === 'connected'
        ? { ...c, sessionCount: update.sessions.length }
        : c,
    );
    _notify();
  }, (error: string) => {
    // Poller detected persistent failure — mark connection as error so retry timer picks it up
    console.log('[agentAutoConnect] Poller error for', conn.id, ':', error);
    _ocPollers.delete(conn.id);
    _connections = _connections.map(c =>
      c.id === conn.id
        ? { ...c, status: 'error' as const, error }
        : c,
    );
    _notify();
  });
  poller.start(10000);
  _ocPollers.set(conn.id, poller);

  _retryAttempt = 0; // Reset backoff on success
  _notify();
  console.log('[agentAutoConnect] Connected:', conn.endpoint);
}
