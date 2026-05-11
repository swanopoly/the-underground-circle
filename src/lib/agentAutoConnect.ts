/**
 * App-level agent auto-connect service.
 * Runs detection for Claude Code bridge + OpenSwan gateway immediately on auth,
 * so agents are already connected when the user opens the Office tab.
 *
 * Resilience features:
 *  - Exponential backoff retry (5s → 10s → 20s → 30s cap)
 *  - Connects to OpenSwan gateway directly (:18789)
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
import { areBridgesAvailable } from './bridgeEnvironment';
import { Platform } from 'react-native';
import { devLog } from './devLog';
import { safeGetUserId } from './authSession';
import {
  clearAutoConnectStateListeners,
  publishAutoConnectSnapshot,
  setAutoConnectCircleContext,
} from './agentAutoConnectState';

export {
  getAutoConnectConnections,
  getAutoConnectSessions,
  isAutoConnectRunning,
  subscribeAutoConnect,
} from './agentAutoConnectState';

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

// Cached user id. Previously each of the 4 bridge pollers fired its own
// `supabase.auth.getUser()` every time it considered a memory save — that's
// up to 4 auth fetches per 30s window even though the identity doesn't
// change within a session. Cache for 60s, refresh on miss.
let _cachedUserId: string | null = null;
let _cachedUserIdAt = 0;
const USER_ID_CACHE_MS = 60_000;

async function _getUserId(): Promise<string | null> {
  if (_cachedUserId && Date.now() - _cachedUserIdAt < USER_ID_CACHE_MS) {
    return _cachedUserId;
  }
  const uid = await safeGetUserId();
  if (uid) {
    _cachedUserId = uid;
    _cachedUserIdAt = Date.now();
  } else {
    console.warn('[agentAutoConnect] _getUserId: no user authenticated');
  }
  return uid;
}

/**
 * Shared throttled memory-save path. Before this, each of the 4 bridges
 * (CC, Codex, Gemini, Cursor) had an identical 10-line inline block with
 * its own provider key and save function — drift-prone and redundant.
 * Now they all funnel through here, so:
 *   - throttle policy changes in exactly one place
 *   - warn-on-failure logging is uniform across providers
 *   - `_getUserId` is only called when the throttle allows a save, not on
 *     every poll tick
 */
function _maybeSaveBridgeMemory<S>(
  provider: 'cc' | 'codex' | 'gemini' | 'cursor',
  sessions: S[],
  saveFn: (circleId: string, userId: string, sessions: S[]) => Promise<unknown>,
): void {
  if (!_circleId) return;
  const now = Date.now();
  if (now - (_lastMemorySave[provider] || 0) <= MEMORY_SAVE_THROTTLE_MS) return;
  _lastMemorySave[provider] = now;

  void _getUserId().then((uid) => {
    if (!uid || !_circleId) return;
    Promise.resolve(saveFn(_circleId, uid, sessions)).catch((err) => {
      console.warn(`[agentAutoConnect] Memory save failed for ${provider}:`, err);
    });
  });
}
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _ocReconnectTimer: ReturnType<typeof setInterval> | null = null;
let _circleId: string | null = null;
let _visibilityHandler: (() => void) | null = null;
let _visibilityDebounce = false; // Prevents duplicate reconnect attempts
let _retryAttempt = 0; // for exponential backoff
// Tracks how many consecutive bridge-detection ticks found NOTHING. Used to
// back off the retry cadence when a user is on the deployed site without
// any local bridges running — no reason to fire 24 fetches/min into the
// void. Resets the moment any bridge is detected.
let _bridgeMissCount = 0;
// Consecutive reconnect-cycle failures (resets on any success). Separate
// from `_retryAttempt` (which caps at 4 to bound the backoff ceiling) so we
// can detect "this has been failing for real time" independently of the
// exponential cap.
let _consecutiveReconnectFailures = 0;
let _hasWarnedPersistentReconnectFailure = false;
const PERSISTENT_RECONNECT_WARN_AFTER = 20; // ~10 min at the 30 s cap

// ── Constants ────────────────────────────────────────────────────────────────

const RETRY_BASE_MS = 5000;      // Initial retry interval
const RETRY_MAX_MS = 30000;      // Max retry interval
const CC_DETECT_INTERVAL = 20000; // Claude Code bridge detection interval (20s)
const OC_RECONNECT_INTERVAL = 20000; // OpenSwan reconnect check interval (20s)
// Cadence for each local-CLI bridge poller (Claude Code, Codex, Gemini, Cursor).
// These are localhost HTTP fetches that re-scan JSONL session files on disk —
// 10s is frequent enough to feel live when a user opens a new terminal
// session and cuts request volume in half vs the old 5s default.
const BRIDGE_POLL_INTERVAL_MS = 10000;

// OpenSwan endpoints to try (direct gateway — CORS proxy removed)
const OPENCLAW_FALLBACK_ENDPOINTS = [
  'http://localhost:18789', // Direct gateway
];

function hasAuthFailure(conn: AgentConnection): boolean {
  return typeof conn.error === 'string' && /authentication failed|wrong or missing token/i.test(conn.error);
}

function _notify() {
  publishAutoConnectSnapshot({
    running: _running,
    connections: _connections,
    sessionsMap: _sessionsMap,
    circleId: _circleId,
  });
}

/** Allow OfficeTab to set the circleId once it knows it, so we can publish to DB */
export function setAutoConnectCircleId(circleId: string) {
  _circleId = circleId;
  setAutoConnectCircleContext(circleId);
}

/** Allow OfficeTab to update connections (e.g. user adds/removes) */
export function updateAutoConnectConnections(conns: AgentConnection[]) {
  for (const [connId, poller] of _ocPollers.entries()) {
    const nextConn = conns.find((conn) => conn.id === connId);
    if (!nextConn || nextConn.provider !== 'openswan' || nextConn.enabled === false || nextConn.status === 'disconnected') {
      poller.stop();
      _ocPollers.delete(connId);
      _sessionsMap.delete(connId);
    }
  }
  _connections = conns;
  _notify();
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
  _notify();
  console.log('[agentAutoConnect] Starting app-level agent detection...');

  if (Platform.OS === 'web') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!_running) return;
  }

  // Skip all localhost probing on production web where bridges can't be
  // reached. Users running a dev setup (or who opted in via localStorage)
  // still get the full auto-connect flow; everyone else avoids 20s of
  // failed requests per retry cycle plus noisy console warnings.
  if (!areBridgesAvailable()) {
    console.log('[agentAutoConnect] Bridges unavailable in this environment — skipping probe. Run locally or set EXPO_PUBLIC_BRIDGE_HOST to enable.');
    _connections = await loadConnections();
    _notify();
    return;
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

  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
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
  setAutoConnectCircleContext(null);
  _retryAttempt = 0;
  _stopVisibilityListener();
  _notify();
  clearAutoConnectStateListeners();
  console.log('[agentAutoConnect] Stopped');
}

// ── Internal: Unified retry loop ────────────────────────────────────────────

function _startRetryLoop() {
  // Clear any existing timers
  if (_retryTimer) clearTimeout(_retryTimer);
  if (_ocReconnectTimer) clearInterval(_ocReconnectTimer);

  // Bridge detection — self-rescheduling setTimeout with exponential
  // backoff. When the user is on the deployed site without local bridges
  // running, this prevents 24 fetches/min from hammering localhost
  // forever. Cadence:
  //   miss 0-2  → 10s   (initial discovery / brief offline period)
  //   miss 3-5  → 30s
  //   miss 6-10 → 60s
  //   miss 11+  → 300s  (5-min ceiling — keeps recovery feel reasonable)
  // Resets to 10s the moment ANY bridge is detected.
  function nextBridgeProbeDelay(): number {
    if (_bridgeMissCount <= 2)  return 10_000;
    if (_bridgeMissCount <= 5)  return 30_000;
    if (_bridgeMissCount <= 10) return 60_000;
    return 300_000;
  }

  const tickBridgeProbe = async () => {
    if (!_running) return;

    // Detect all bridges in parallel instead of sequentially
    const [ccDetected, codexDetected, geminiDetected, cursorDetected] = await Promise.all([
      detectClaudeCodeBridge().catch(() => false),
      detectCodexBridge().catch(() => false),
      detectGeminiCliBridge().catch(() => false),
      detectCursorBridge().catch(() => false),
    ]);

    // Track miss/hit for backoff. Reset on ANY hit.
    if (ccDetected || codexDetected || geminiDetected || cursorDetected) {
      _bridgeMissCount = 0;
    } else {
      _bridgeMissCount += 1;
    }

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

    // Schedule the next probe with backoff-aware delay.
    if (_running) {
      _retryTimer = setTimeout(tickBridgeProbe, nextBridgeProbeDelay());
    }
  };

  // Kick off the first probe immediately (no delay) — discovery feels
  // instant. Subsequent ticks are scheduled at the end of each run.
  _retryTimer = setTimeout(tickBridgeProbe, 0);
  // CC_DETECT_INTERVAL is no longer the cadence (kept as a constant for
  // any other consumers); the function nextBridgeProbeDelay() above owns
  // pacing.
  void CC_DETECT_INTERVAL;

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
        _consecutiveReconnectFailures = 0;
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
        _consecutiveReconnectFailures = 0;
        _hasWarnedPersistentReconnectFailure = false;
        scheduleOcReconnect(); // Reschedule with faster interval
      } else {
        _retryAttempt = Math.min(_retryAttempt + 1, 4); // Increase backoff (cap at 4 = 30s)
        _consecutiveReconnectFailures++;
        // Surface once when auto-reconnect has been failing for ~10 minutes
        // of real time (20 cycles × cap 30 s). Previously this loop spun
        // forever in silence and there was no signal to check the gateway.
        // We keep retrying after the warning — auto-recovery should still
        // work when the user comes back online — but at least the state is
        // visible to anyone looking at the console.
        if (
          !_hasWarnedPersistentReconnectFailure &&
          _consecutiveReconnectFailures >= PERSISTENT_RECONNECT_WARN_AFTER
        ) {
          _hasWarnedPersistentReconnectFailure = true;
          console.warn(
            `[agentAutoConnect] OpenSwan gateway still unreachable after ` +
            `${_consecutiveReconnectFailures} retry cycles (~${PERSISTENT_RECONNECT_WARN_AFTER * 30}s). ` +
            `Will keep trying in the background; check that the gateway is ` +
            `running and the token in ~/.openswan/openswan.json is current.`
          );
        }
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

/**
 * Stops every active bridge + OpenSwan poller and nulls the refs. Used
 * when the tab goes hidden — leaving pollers running on an invisible tab
 * wastes battery on mobile and API quota across the board. When the tab
 * comes back, the visible branch re-detects bridges and restarts pollers
 * cleanly (same code path as the original "tab focus" reconnect).
 */
function _stopAllBridgePollersForBackground() {
  try { _ccPoller?.stop(); } catch {} _ccPoller = null; _ccStarting = false;
  try { _codexPoller?.stop(); } catch {} _codexPoller = null; _codexStarting = false;
  try { _geminiPoller?.stop(); } catch {} _geminiPoller = null; _geminiStarting = false;
  try { _cursorPoller?.stop(); } catch {} _cursorPoller = null; _cursorStarting = false;
  for (const [, poller] of _ocPollers) {
    try { poller.stop(); } catch {}
  }
  _ocPollers.clear();
}

function _startVisibilityListener() {
  if (Platform.OS !== 'web') return;
  if (_visibilityHandler) return;

  _visibilityHandler = () => {
    if (!_running) return;

    // Tab went to background: stop pollers so we don't burn battery /
    // API quota polling for a user who can't see the result. Pollers
    // keep no important state — when the tab comes back, the visible
    // branch detects bridges and restarts fresh.
    if (document.visibilityState === 'hidden') {
      devLog.trace('[agentAutoConnect] Tab hidden — pausing pollers');
      _stopAllBridgePollersForBackground();
      return;
    }

    if (document.visibilityState !== 'visible') return;
    // Debounce: prevent duplicate reconnect attempts if visibility fires rapidly
    if (_visibilityDebounce) return;
    _visibilityDebounce = true;
    setTimeout(() => { _visibilityDebounce = false; }, 2000);

    devLog.trace('[agentAutoConnect] Tab became visible — checking connections...');
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
    _maybeSaveBridgeMemory('cc', sessions, saveCCSessionsToMemory);
  });
  _ccPoller.start(BRIDGE_POLL_INTERVAL_MS);
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
    _maybeSaveBridgeMemory('codex', sessions, saveCodexSessionsToMemory);
  });
  _codexPoller.start(BRIDGE_POLL_INTERVAL_MS);
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
      publishGeminiCliAgent(_circleId, sessions.length, sessions).catch(err =>
        console.error('[agentAutoConnect] Failed to publish Gemini CLI agent:', err),
      );
    } else if (_geminiPublished && _circleId) {
      publishGeminiCliAgent(_circleId, sessions.length, sessions).catch(() => {});
    }
    if (_geminiPublished && _circleId) {
      updateGeminiCliAgentStatus(_circleId, sessions).catch(() => {});
    }
    _maybeSaveBridgeMemory('gemini', sessions, saveGeminiSessionsToMemory);
  });
  _geminiPoller.start(BRIDGE_POLL_INTERVAL_MS);
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
    _maybeSaveBridgeMemory('cursor', sessions, saveCursorSessionsToMemory);
  });
  _cursorPoller.start(BRIDGE_POLL_INTERVAL_MS);
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
