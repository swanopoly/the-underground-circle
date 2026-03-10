/**
 * App-level agent auto-connect service.
 * Runs detection for Claude Code bridge + OpenClaw gateway immediately on auth,
 * so agents are already connected when the user opens the Office tab.
 *
 * Singleton — safe to call start() multiple times.
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

// Listeners that want to know when sessions/connections change
type Listener = () => void;
const _listeners = new Set<Listener>();

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

// ── Start (called once from App.tsx after auth) ──────────────────────────────

export async function startAgentAutoConnect() {
  if (_running) return;
  _running = true;
  console.log('[agentAutoConnect] Starting app-level agent detection...');

  // 1. Load saved connections
  let conns = await loadConnections();

  // 2. Auto-discover OpenClaw gateway
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

  // 3. Auto-connect all enabled OpenClaw connections
  for (const conn of conns) {
    if (conn.enabled && conn.provider === 'openclaw') {
      _connectOpenClaw(conn);
    }
  }

  // 4. Detect Claude Code bridge
  const ccDetected = await detectClaudeCodeBridge();
  if (ccDetected) {
    _startCCPoller();
    console.log('[agentAutoConnect] Claude Code bridge detected');
  }

  // 5. Retry loop: re-detect Claude Code bridge every 15s
  _retryTimer = setInterval(async () => {
    const detected = await detectClaudeCodeBridge();

    if (detected && !_ccPoller) {
      _startCCPoller();
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
  }, 15000);

  // 6. Reconnect failed OpenClaw connections every 30s
  _ocReconnectTimer = setInterval(async () => {
    const failedConns = _connections.filter(
      c => c.enabled && c.provider === 'openclaw' && (c.status === 'error' || c.status === 'disconnected'),
    );
    for (const conn of failedConns) {
      const healthy = await probeEndpointHealth(conn.endpoint);
      if (healthy) {
        _connectOpenClaw(conn);
      }
    }
  }, 30000);
}

// ── Stop (called on logout) ──────────────────────────────────────────────────

export function stopAgentAutoConnect() {
  if (!_running) return;
  _running = false;

  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
  if (_ocReconnectTimer) { clearInterval(_ocReconnectTimer); _ocReconnectTimer = null; }
  if (_ccPoller) { _ccPoller.stop(); _ccPoller = null; }
  for (const [id, poller] of _ocPollers) {
    poller.stop();
  }
  _ocPollers.clear();
  _connections = [];
  _sessionsMap.clear();
  _ccPublished = false;
  _circleId = null;
  _listeners.clear();
  console.log('[agentAutoConnect] Stopped');
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

// ── Internal: OpenClaw connect ───────────────────────────────────────────────

async function _connectOpenClaw(conn: AgentConnection) {
  // Update status to connecting
  _connections = _connections.map(c =>
    c.id === conn.id ? { ...c, status: 'connecting' as const, error: undefined } : c,
  );
  _notify();

  const config: OpenClawConfig = { endpoint: conn.endpoint, token: conn.token };
  const result = await testConnection(config);

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
  });
  poller.start(10000);
  _ocPollers.set(conn.id, poller);

  _notify();
  console.log('[agentAutoConnect] OpenClaw connected:', conn.endpoint);
}
