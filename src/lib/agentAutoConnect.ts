/**
 * App-level agent auto-connect service.
 * Runs detection for Claude Code bridge + OpenSwan gateway immediately on auth,
 * so agents are already connected when the user opens the Office tab.
 *
 * Resilience features:
 *  - Exponential backoff retry (5s → 10s → 20s → 30s cap)
 *  - Tries both CORS proxy (:18790) and direct gateway (:18789) for OpenSwan
 *  - Visibility-change listener: instantly retries when user switches back to tab
 *  - Poller error detection: marks connection as error after 3 consecutive failures
 *  - Singleton — safe to call start() multiple times.
 */

import { supabase } from './supabase';
import {
  ClaudeCodePoller,
  ClaudeCodeSession,
  bridgeSessionsToAgents,
  detectClaudeCodeBridge,
  publishClaudeCodeAgent,
  updateClaudeCodeAgentStatus,
  markClaudeCodeAgentOffline,
  saveSessionsToMemory as saveCCSessionsToMemory,
} from './claudeCodeDetector';
import {
  CodexPoller,
  codexSessionsToAgents,
  detectCodexBridge,
  publishCodexAgent,
  updateCodexAgentStatus,
  markCodexAgentOffline,
  saveCodexSessionsToMemory,
} from './codexDetector';
import {
  GeminiCliPoller,
  geminiSessionsToAgents,
  detectGeminiCliBridge,
  publishGeminiCliAgent,
  updateGeminiCliAgentStatus,
  markGeminiCliAgentOffline,
  saveGeminiSessionsToMemory,
} from './geminiCliDetector';
import {
  CursorPoller,
  cursorSessionsToAgents,
  detectCursorBridge,
  publishCursorAgent,
  updateCursorAgentStatus,
  markCursorAgentOffline,
  saveCursorSessionsToMemory,
} from './cursorDetector';
import {
  AgentConnection,
  loadConnections,
  saveConnections,
  autoDiscoverLocalAgents,
  probeEndpointHealth,
} from './connectionManager';
import {
  OpenSwanConfig,
  OpenSwanPoller,
  OpenSwanUpdate,
  testConnection,
} from './openswanService';
import { OfficeAgent } from './officeAgents';
import { Platform } from 'react-native';

// ── Singleton state ──────────────────────────────────────────────────────────

let _running = false;
let _connections: AgentConnection[] = [];
let _sessionsMap = new Map<string, any[]>();
let _ccPoller: ClaudeCodePoller | null = null;
let _ccPublished = false;
let _ccStarting = false;   // Prevents duplicate poller creation
let _codexPoller: CodexPoller | null = null;
let _codexPublished = false;
let _codexStarting = false; // Prevents duplicate poller creation
let _geminiPoller: GeminiCliPoller | null = null;
let _geminiPublished = false;
let _geminiStarting = false;
let _cursorPoller: CursorPoller | null = null;
let _cursorPublished = false;
let _cursorStarting = false;
let _ocPollers = new Map<string, OpenSwanPoller>();
// Memory save throttle — 30s per provider
let _lastMemorySave: Record<string, number> = {};
const MEMORY_SAVE_THROTTLE_MS = 30_000;

async function _getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id || null;
    if (!uid) console.warn('[agentAutoConnect] _getUserId: no user authenticated');
    return uid;
  } catch (err) {
    console.warn('[agentAutoConnect] _getUserId failed:', err);
    return null;
  }
}
let _retryTimer: ReturnType<typeof setInterval> | null = null;
let _ocReconnectTimer: ReturnType<typeof setInterval> | null = null;
let _circleId: string | null = null;
let _visibilityHandler: (() => void) | null = null;
let _visibilityDebounce = false; // Prevents duplicate reconnect attempts
let _retryAttempt = 0; // for exponential backoff

// Listeners that want to know when sessions/connections change
type Listener = () => void;
const _listeners = new Set<Listener>();

// ── Constants ────────────────────────────────────────────────────────────────

const RETRY_BASE_MS = 5000;      // Initial retry interval
const RETRY_MAX_MS = 30000;      // Max retry interval
const CC_DETECT_INTERVAL = 20000; // Claude Code bridge detection interval (20s)
const OC_RECONNECT_INTERVAL = 20000; // OpenSwan reconnect check interval (20s)

// Alternate OpenSwan endpoints to try (CORS proxy first, then direct gateway)
const OPENCLAW_FALLBACK_ENDPOINTS = Platform.OS === 'web'
  ? [
      'http://localhost:18790', // Web can only use the proxy safely
    ]
  : [
      'http://localhost:18790', // CORS proxy (preferred)
      'http://localhost:18789', // Direct gateway (may work if CORS is configured)
    ];

function hasAuthFailure(conn: AgentConnection): boolean {
  return typeof conn.error === 'string' && /authentication failed|wrong or missing token/i.test(conn.error);
}

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
// ── Manual reconnect (triggered by UI) ───────────────────────────────────────

export type BridgeStatus = {
  claudeCode: boolean;
  codex: boolean;
  gemini: boolean;
  cursor: boolean;
  openswanReconnected: number;
};

/**
 * Manually detect and connect all bridges. Returns status of each bridge.
 * Called from the header link button.
 */
export async function reconnectAllBridges(): Promise<BridgeStatus> {
  console.log("[agentAutoConnect] Manual bridge reconnect triggered");
  _retryAttempt = 0;

  // If auto-connect is not running yet, start it
  if (!_running) {
    await startAgentAutoConnect();
    return {
      claudeCode: !!_ccPoller,
      codex: !!_codexPoller,
      gemini: !!_geminiPoller,
      cursor: !!_cursorPoller,
      openswanReconnected: 0,
    };
  }

  // Detect all bridges in parallel
  const [ccDetected, codexDetected, geminiDetected, cursorDetected] = await Promise.all([
    detectClaudeCodeBridge().catch(() => false),
    detectCodexBridge().catch(() => false),
    detectGeminiCliBridge().catch(() => false),
    detectCursorBridge().catch(() => false),
  ]);

  // Start pollers for newly detected bridges
  if (ccDetected && !_ccPoller) _startCCPoller();
  if (codexDetected && !_codexPoller) _startCodexPoller();
  if (geminiDetected && !_geminiPoller) _startGeminiPoller();
  if (cursorDetected && !_cursorPoller) _startCursorPoller();

  // Retry failed OpenSwan connections
  let ocReconnected = 0;
  const failedConns = _connections.filter(
    c => c.enabled && (c.status === "error" || c.status === "disconnected") && !hasAuthFailure(c),
  );
  for (const conn of failedConns) {
    try {
      await _connectWithFallback(conn);
      if (_connections.find(c => c.id === conn.id)?.status === "connected") {
        ocReconnected++;
      }
    } catch {}
  }

  _notify();

  const status: BridgeStatus = {
    claudeCode: ccDetected,
    codex: codexDetected,
    gemini: geminiDetected,
    cursor: cursorDetected,
    openswanReconnected: ocReconnected,
  };
  console.log("[agentAutoConnect] Manual reconnect result:", status);
  return status;
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

  if (Platform.OS === 'web') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!_running) return;
  }

  // 1. Load saved connections
  let conns = await loadConnections();

  // 2. Auto-discover OpenSwan gateway (silently — skip if not running)
  try {
    const { discovered } = await autoDiscoverLocalAgents(conns);
    if (discovered) {
      const existingOpenSwan = conns.find(c => c.provider === 'openswan');
      if (existingOpenSwan?.token) {
        discovered.token = existingOpenSwan.token;
      }
      conns = [...conns, discovered];
      saveConnections(conns);
      console.log('[agentAutoConnect] Auto-discovered OpenSwan at', discovered.endpoint);
    }
  } catch {
    // OpenSwan not running — that's fine, skip silently
  }

  _connections = conns;
  _notify();

  // 3. Auto-connect enabled connections (skip OpenSwan if no gateway found)
  for (const conn of conns) {
    if (conn.enabled && conn.status !== 'error') {
      _connectWithFallback(conn);
    }
  }

  const [ccDetected, codexDetected, geminiDetected, cursorDetected] = await Promise.all([
    detectClaudeCodeBridge(),
    detectCodexBridge(),
    detectGeminiCliBridge(),
    detectCursorBridge(),
  ]);

  if (ccDetected) {
    _startCCPoller();
    console.log('[agentAutoConnect] Claude Code bridge detected');
  }

  if (codexDetected) {
    _startCodexPoller();
    console.log('[agentAutoConnect] Codex bridge detected');
  }

  if (geminiDetected) {
    _startGeminiPoller();
    console.log('[agentAutoConnect] Gemini CLI bridge detected');
  }

  if (cursorDetected) {
    _startCursorPoller();
    console.log('[agentAutoConnect] Cursor bridge detected');
  }

  // 6. Retry loop: re-detect bridges + reconnect failed connections
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
  if (_codexPoller) { _codexPoller.stop(); _codexPoller = null; }
  if (_geminiPoller) { _geminiPoller.stop(); _geminiPoller = null; }
  if (_cursorPoller) { _cursorPoller.stop(); _cursorPoller = null; }
  for (const [, poller] of _ocPollers) {
    poller.stop();
  }
  _ocPollers.clear();
  _connections = [];
  _sessionsMap.clear();
  _ccPublished = false;
  _ccStarting = false;
  _codexPublished = false;
  _codexStarting = false;
  _geminiPublished = false;
  _geminiStarting = false;
  _cursorPublished = false;
  _cursorStarting = false;
  _visibilityDebounce = false;
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

  // Bridge detection — every 10s, all three in parallel
  _retryTimer = setInterval(async () => {
    if (!_running) return;

    // Detect all bridges in parallel instead of sequentially
    const [ccDetected, codexDetected, geminiDetected, cursorDetected] = await Promise.all([
      detectClaudeCodeBridge().catch(() => false),
      detectCodexBridge().catch(() => false),
      detectGeminiCliBridge().catch(() => false),
      detectCursorBridge().catch(() => false),
    ]);

    // Claude Code bridge
    if (ccDetected && !_ccPoller) {
      _startCCPoller();
      _retryAttempt = 0;
      console.log('[agentAutoConnect] Claude Code bridge came online');
    } else if (!ccDetected && _ccPoller) {
      _ccPoller.stop();
      _ccPoller = null;
      _ccStarting = false;
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

    // ── Agent keepalive — prevent pg_cron sweeper from marking ANY published agent offline ──
    // Pings last_active_at for ALL published agents regardless of status
    if (_circleId) {
      const keepAliveProviders: { published: boolean; name: string }[] = [
        { published: _ccPublished, name: 'Claude Code' },
        { published: _codexPublished, name: 'Codex' },
        { published: _geminiPublished, name: 'Gemini CLI' },
        { published: _cursorPublished, name: 'Cursor' },
      ];
      for (const { published, name } of keepAliveProviders) {
        if (published) {
          supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user) return;
            // Ping ALL statuses — not just idle. The sweeper marks agents offline
            // after 3 min of no heartbeat regardless of status.
            supabase.from('circle_office_agents')
              .update({ last_active_at: new Date().toISOString() })
              .eq('circle_id', _circleId!)
              .eq('owner_id', user.id)
              .eq('name', name)
              .in('status', ['idle', 'building', 'active'])
              .then(() => {});
          }).catch(() => {});
        }
      }
    }

    // Codex bridge
    if (codexDetected && !_codexPoller) {
      _startCodexPoller();
      console.log('[agentAutoConnect] Codex bridge came online');
    } else if (!codexDetected && _codexPoller) {
      _codexPoller.stop();
      _codexPoller = null;
      _codexStarting = false;
      const existing = _sessionsMap.get('codex-auto') as OfficeAgent[] | undefined;
      if (existing && existing.length > 0) {
        const idled = existing.map(a => ({ ...a, status: 'idle' as const, activity: 'Session ended — idling' }));
        _sessionsMap.set('codex-auto', idled);
        _notify();
      }
      if (_codexPublished && _circleId) {
        markCodexAgentOffline(_circleId).catch(() => {});
      }
      console.log('[agentAutoConnect] Codex bridge went offline');
    }

    // Gemini CLI bridge
    if (geminiDetected && !_geminiPoller) {
      _startGeminiPoller();
      console.log('[agentAutoConnect] Gemini CLI bridge came online');
    } else if (!geminiDetected && _geminiPoller) {
      _geminiPoller.stop();
      _geminiPoller = null;
      _geminiStarting = false;
      const existing = _sessionsMap.get('gemini-cli-auto') as OfficeAgent[] | undefined;
      if (existing && existing.length > 0) {
        const idled = existing.map(a => ({ ...a, status: 'idle' as const, activity: 'Session ended — idling' }));
        _sessionsMap.set('gemini-cli-auto', idled);
        _notify();
      }
      if (_geminiPublished && _circleId) {
        markGeminiCliAgentOffline(_circleId).catch(() => {});
      }
      console.log('[agentAutoConnect] Gemini CLI bridge went offline');
    }

    // Cursor bridge
    if (cursorDetected && !_cursorPoller) {
      _startCursorPoller();
      console.log('[agentAutoConnect] Cursor bridge came online');
    } else if (!cursorDetected && _cursorPoller) {
      _cursorPoller.stop();
      _cursorPoller = null;
      _cursorStarting = false;
      const existing = _sessionsMap.get('cursor-auto') as OfficeAgent[] | undefined;
      if (existing && existing.length > 0) {
        const idled = existing.map(a => ({ ...a, status: 'idle' as const, activity: 'Session ended — idling' }));
        _sessionsMap.set('cursor-auto', idled);
        _notify();
      }
      if (_cursorPublished && _circleId) {
        markCursorAgentOffline(_circleId).catch(() => {});
      }
      console.log('[agentAutoConnect] Cursor bridge went offline');
    }
  }, CC_DETECT_INTERVAL);

  // OpenSwan reconnect — with backoff
  const scheduleOcReconnect = () => {
    if (_ocReconnectTimer) clearInterval(_ocReconnectTimer);
    const interval = _getRetryInterval();

    _ocReconnectTimer = setInterval(async () => {
      if (!_running) return;

      // Only retry connections that were previously connected (not ones that never connected)
      const failedConns = _connections.filter(
        c => c.enabled && (c.status === 'error' || c.status === 'disconnected') && c.lastConnected && !hasAuthFailure(c),
      );

      if (failedConns.length === 0) {
        _retryAttempt = 0;
        return;
      }

      let anySuccess = false;
      for (const conn of failedConns) {
        try {
          const healthy = await _probeWithFallbacks(conn);
          if (healthy) {
            await _connectWithFallback(conn);
            if (_connections.find(c => c.id === conn.id)?.status === 'connected') {
              anySuccess = true;
            }
          }
        } catch {
          // Silent — don't spam console with connection errors
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
    // Debounce: prevent duplicate reconnect attempts if visibility fires rapidly
    if (_visibilityDebounce) return;
    _visibilityDebounce = true;
    setTimeout(() => { _visibilityDebounce = false; }, 2000);

    console.log('[agentAutoConnect] Tab became visible — checking connections...');
    _retryAttempt = 0;

    // Check all bridges in parallel
    Promise.all([
      detectClaudeCodeBridge().catch(() => false),
      detectCodexBridge().catch(() => false),
      detectGeminiCliBridge().catch(() => false),
      detectCursorBridge().catch(() => false),
    ]).then(([cc, codex, gemini, cursor]) => {
      if (cc && !_ccPoller) {
        _startCCPoller();
        console.log('[agentAutoConnect] Claude Code bridge reconnected on tab focus');
      }
      if (codex && !_codexPoller) {
        _startCodexPoller();
        console.log('[agentAutoConnect] Codex bridge reconnected on tab focus');
      }
      if (gemini && !_geminiPoller) {
        _startGeminiPoller();
        console.log('[agentAutoConnect] Gemini CLI bridge reconnected on tab focus');
      }
      if (cursor && !_cursorPoller) {
        _startCursorPoller();
        console.log('[agentAutoConnect] Cursor bridge reconnected on tab focus');
      }
    });

    // Retry failed OpenSwan connections
    const failedConns = _connections.filter(
      c => c.enabled && (c.status === 'error' || c.status === 'disconnected') && !hasAuthFailure(c),
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
  if (_ccPoller || _ccStarting) return;
  _ccStarting = true;
  _ccPoller = new ClaudeCodePoller(sessions => {
    _sessionsMap.set('claude-code-auto', bridgeSessionsToAgents(sessions) as any);
    _notify();

    // Publish to circle DB if we have a circleId — pass sessions for multi-agent support
    if (!_ccPublished && _circleId) {
      _ccPublished = true;
      publishClaudeCodeAgent(_circleId, sessions.length, sessions).catch(err =>
        console.error('[agentAutoConnect] Failed to publish CC agent:', err),
      );
    } else if (_ccPublished && _circleId) {
      // Re-publish if session count changed (new session started) — creates new pixel agents
      publishClaudeCodeAgent(_circleId, sessions.length, sessions).catch(() => {});
    }
    if (_ccPublished && _circleId) {
      updateClaudeCodeAgentStatus(_circleId, sessions).catch(() => {});
    }
    // Auto-save session context to memory (throttled)
    if (_circleId && Date.now() - (_lastMemorySave['cc'] || 0) > MEMORY_SAVE_THROTTLE_MS) {
      _lastMemorySave['cc'] = Date.now();
      _getUserId().then(uid => {
        if (uid && _circleId) {
          saveCCSessionsToMemory(_circleId, uid, sessions).catch(err => {
            console.warn('[agentAutoConnect] Memory save failed for CC:', err);
          });
        }
      });
    }
  });
  _ccPoller.start(5000);
  _ccStarting = false;
}

// ── Internal: Codex poller ───────────────────────────────────────────────────

function _startCodexPoller() {
  if (_codexPoller || _codexStarting) return;
  _codexStarting = true;
  _codexPoller = new CodexPoller(sessions => {
    _sessionsMap.set('codex-auto', codexSessionsToAgents(sessions) as any);
    _notify();

    // Publish to circle DB if we have a circleId
    if (!_codexPublished && _circleId) {
      _codexPublished = true;
      publishCodexAgent(_circleId, sessions.length, sessions).catch(err =>
        console.error('[agentAutoConnect] Failed to publish Codex agent:', err),
      );
    } else if (_codexPublished && _circleId) {
      publishCodexAgent(_circleId, sessions.length, sessions).catch(() => {});
    }
    if (_codexPublished && _circleId) {
      updateCodexAgentStatus(_circleId, sessions).catch(() => {});
    }
    // Auto-save session context to memory (throttled)
    if (_circleId && Date.now() - (_lastMemorySave['codex'] || 0) > MEMORY_SAVE_THROTTLE_MS) {
      _lastMemorySave['codex'] = Date.now();
      _getUserId().then(uid => {
        if (uid && _circleId) {
          saveCodexSessionsToMemory(_circleId, uid, sessions).catch(err => {
            console.warn('[agentAutoConnect] Memory save failed for Codex:', err);
          });
        }
      });
    }
  });
  _codexPoller.start(5000);
  _codexStarting = false;
}

// ── Internal: Gemini CLI poller ──────────────────────────────────────────────

function _startGeminiPoller() {
  if (_geminiPoller || _geminiStarting) return;
  _geminiStarting = true;
  _geminiPoller = new GeminiCliPoller(sessions => {
    _sessionsMap.set('gemini-cli-auto', geminiSessionsToAgents(sessions) as any);
    _notify();

    // Publish to circle DB if we have a circleId
    if (!_geminiPublished && _circleId) {
      _geminiPublished = true;
      publishGeminiCliAgent(_circleId, sessions.length).catch(err =>
        console.error('[agentAutoConnect] Failed to publish Gemini CLI agent:', err),
      );
    }
    if (_geminiPublished && _circleId) {
      updateGeminiCliAgentStatus(_circleId, sessions).catch(() => {});
    }
    // Auto-save session context to memory (throttled)
    if (_circleId && Date.now() - (_lastMemorySave['gemini'] || 0) > MEMORY_SAVE_THROTTLE_MS) {
      _lastMemorySave['gemini'] = Date.now();
      _getUserId().then(uid => {
        if (uid && _circleId) {
          saveGeminiSessionsToMemory(_circleId, uid, sessions).catch(err => {
            console.warn('[agentAutoConnect] Memory save failed for Gemini:', err);
          });
        }
      });
    }
  });
  _geminiPoller.start(5000);
  _geminiStarting = false;
}

// ── Internal: Cursor poller ───────────────────────────────────────────────

function _startCursorPoller() {
  if (_cursorPoller || _cursorStarting) return;
  _cursorStarting = true;
  _cursorPoller = new CursorPoller(sessions => {
    _sessionsMap.set('cursor-auto', cursorSessionsToAgents(sessions) as any);
    _notify();

    if (!_cursorPublished && _circleId) {
      _cursorPublished = true;
      publishCursorAgent(_circleId, sessions.length).catch(err =>
        console.error('[agentAutoConnect] Failed to publish Cursor agent:', err),
      );
    }
    if (_cursorPublished && _circleId) {
      updateCursorAgentStatus(_circleId, sessions).catch(() => {});
    }
    // Auto-save session context to memory (throttled)
    if (_circleId && Date.now() - (_lastMemorySave['cursor'] || 0) > MEMORY_SAVE_THROTTLE_MS) {
      _lastMemorySave['cursor'] = Date.now();
      _getUserId().then(uid => {
        if (uid && _circleId) {
          saveCursorSessionsToMemory(_circleId, uid, sessions).catch(err => {
            console.warn('[agentAutoConnect] Memory save failed for Cursor:', err);
          });
        }
      });
    }
  });
  _cursorPoller.start(5000);
  _cursorStarting = false;
}

// ── Internal: Probe with fallback endpoints ─────────────────────────────────

async function _probeWithFallbacks(conn: AgentConnection): Promise<boolean> {
  // Try the saved endpoint first
  const primary = await probeEndpointHealth(conn.endpoint);
  if (primary) return true;

  // For OpenSwan connections, try alternate endpoints
  if (conn.provider === 'openswan') {
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
  let config: OpenSwanConfig = { endpoint: conn.endpoint, token: conn.token };
  let result = await testConnection(config);

  // If failed and this is an OpenSwan connection, try fallback endpoints
  if (!result.ok && conn.provider === 'openswan') {
    for (const fallback of OPENCLAW_FALLBACK_ENDPOINTS) {
      if (fallback === conn.endpoint) continue; // Already tried
      const fallbackConfig: OpenSwanConfig = { endpoint: fallback, token: conn.token };
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
    const isAuthFailure = result.diagnostic?.errorCode === 'auth';
    _connections = _connections.map(c =>
      c.id === conn.id
        ? {
            ...c,
            status: isAuthFailure ? 'disconnected' as const : 'error' as const,
            error: result.error || 'Connection failed',
            lastConnected: isAuthFailure ? undefined : c.lastConnected,
          }
        : c,
    );
    _notify();
    return;
  }

  // Store initial sessions
  _sessionsMap.set(conn.id, result.sessions || []);

  // Agent listing is optional and can be incompatible on some bridge/proxy
  // endpoints. Do not probe it during initial auto-connect; fetch lazily in
  // panels that actually need agent ids.
  const agentIds: string[] = [];

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

  const poller = new OpenSwanPoller(config, (update: OpenSwanUpdate) => {
    _sessionsMap.set(conn.id, update.sessions);
    _connections = _connections.map(c =>
      c.id === conn.id && c.status === 'connected'
        ? { ...c, sessionCount: update.sessions.length }
        : c,
    );
    _notify();
  }, (error: string) => {
    // Poller detected persistent failure — mark connection as error so retry timer picks it up
    const unsupported = /does not support openswan tool rpcs/i.test(error);
    if (unsupported) {
      console.log('[agentAutoConnect] Poller disabled for', conn.id, ':', error);
      _ocPollers.delete(conn.id);
      _connections = _connections.map(c =>
        c.id === conn.id
          ? {
              ...c,
              status: 'connected' as const,
              error: undefined,
            }
          : c,
      );
      _notify();
      return;
    }
    console.log('[agentAutoConnect] Poller error for', conn.id, ':', error);
    _ocPollers.delete(conn.id);
    _connections = _connections.map(c =>
      c.id === conn.id
        ? { ...c, status: 'error' as const, error }
        : c,
    );
    _notify();
  });
  poller.start(20000); // 20s polling — balances responsiveness vs CPU
  _ocPollers.set(conn.id, poller);

  _retryAttempt = 0; // Reset backoff on success
  _notify();
  console.log('[agentAutoConnect] Connected:', conn.endpoint);
}
