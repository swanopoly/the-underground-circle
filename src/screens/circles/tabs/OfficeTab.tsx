import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image,
  useWindowDimensions, Platform, Linking, Modal, TextInput,
} from 'react-native';
import OfficeFloorView from './office/OfficeFloor';
import PixelAgent from './office/PixelAgent';
import AgentPanel from './office/AgentPanel';
import { OfficeIntelligenceSection, OfficeRuntimeSection, OfficeWorkspaceSection } from './office/OfficeSections';
import { OFFICE_DESK_POSITIONS, OFFICE_FLOOR_HEIGHT, OFFICE_FLOOR_WIDTH } from './office/officeFloorLayout';
import CustomizePanel, { TelegramConfig } from './office/CustomizePanel';
import McpPanel from './office/McpPanel';
import type { OfficeCommand } from './office/OfficeChat';
import {
  OfficeAgent,
  DEFAULT_AGENT,
  HUGGINGSWAN_AGENT,
  sessionsToAgents,
  getOfficeStatusColor,
  getOfficeStatusLabel,
  getOfficeStatusSortRank,
  isConnectedOfficeStatus,
} from '../../../lib/officeAgents';
import {
  OFFICE_THEMES, AgentAppearance, FurnitureItem, FurnitureType, FURNITURE_CATALOG,
  OfficeFloor, DEFAULT_FLOORS, createDefaultFloor, OfficeTheme, UC_AGENT_APPEARANCE,
  generateRandomAppearance, OWNER_EMAIL, isInteractiveFurniture,
} from '../../../lib/officeConfig';
import { validateOfficeLayout } from '../../../lib/officeValidation';
import { getBridgeUrl, getBridgeEnvironment } from '../../../lib/bridgeEnvironment';
import ConnectAllBridgesPanel, { isConnectPanelDismissed } from '../../../components/office/ConnectAllBridgesPanel';
import OfficeBridgeReadinessStrip from '../../../components/office/OfficeBridgeReadinessStrip';
import OfficeLaneHealthStrip from '../../../components/office/OfficeLaneHealthStrip';
import type { OfficeBridgeReadinessSnapshot as OfficeBridgeReadinessSnapshotModel } from '../../../lib/officeBridgeReadiness';
import { useCustomThemes, customThemeToOfficeTheme, CUSTOM_THEME_PREFIX, CustomThemeRecord } from '../../../services/customThemes';
import { enrichAgentsWithCache, enrichSessionsWithCache, takeSnapshot, loadSessionTags as loadCachedTags } from '../../../lib/sessionCache';
import { restoreAllAgents, recordAgentActivity, renameAgent as renameAgentIdentity, updateAgentIdentity, getAgentIdentityByAgent, getAgentIdentityKey, applyIdentityToAgent } from '../../../lib/agentIdentity';
import { loadAgentIdentities, seedIdentitiesIfServerEmpty, type AgentIdentity } from '../../../lib/agentIdentity';
import {
  verifyBot, getChat, TelegramPoller, TelegramMessage,
} from '../../../lib/telegramService';
import {
  OpenSwanConfig, OpenSwanPoller, OpenSwanSession, OpenSwanUpdate,
  getOpenSwanEndpointNotice, testConnection, listAgents, listCronJobs, supportsOpenSwanToolRpcEndpoint, CronJob,
} from '../../../lib/openswanService';
import {
  openOAuthPopup, checkOAuthStatus, disconnectOAuth, fetchCalendarEvents, fetchEmails,
  OAuthProvider,
} from '../../../lib/oauthConnect';
import {
  AgentConnection, ProviderType, loadConnections, saveConnections, PROVIDER_META,
  autoDiscoverLocalAgents, probeEndpointHealth, getOpenSwanEndpoint,
} from '../../../lib/connectionManager';
import { supportsOpenSwanRpc, testAgentBridgeConnection } from '../../../lib/agentBridgeSupport';
import {
  isAutoConnectRunning,
  getAutoConnectConnections,
  getAutoConnectSessions,
  subscribeAutoConnect,
} from '../../../lib/agentAutoConnectState';
import { storage } from '../../../lib/storage';
import { loadTrendingContent } from '../../../lib/trendingContent';
import AgentQuickConnect from "../../../components/AgentQuickConnect";
import SuggestedTaskChips from "../../../components/SuggestedTaskChips";
import { getEmptyStateSuggestions, type EmptyStateSuggestionAction } from '../../../lib/emptyStateSuggestions';
import {
  SessionTag, loadSessionTags, addSessionTag, removeSessionTag,
} from '../../../lib/sessionTags';
import {
  BudgetConfig, loadBudgetConfig, saveBudgetConfig, calculateBudgetAlerts,
} from '../../../lib/budgetAlerts';
import BudgetAlertBanner from '../../../components/BudgetAlertBanner';
import { calculatePeriodCosts } from '../../../lib/costCalculations';
import {
  OfficeBuildingNowCard,
  OfficeTokensCard,
  OfficeAgentLiveOpsLines,
  OfficeAgentAccountabilityLine,
  OfficeBuildingBadge,
  officeBoardHasContent,
  officeTrackerHasContent,
} from '../../../components/office/OfficeOpsBoardCards';
// officeOpsBoard is a pure model module (zero runtime imports) — safe to
// import statically for render-time helpers; data fetching stays lazy (D6).
import {
  applySyntheticAgentStatusUpgrade,
  buildAgentLiveOps,
  deriveSyntheticAgentStatusFromRuns,
  formatAccountabilityCounts,
  HUGGINGSWAN_RUN_NAME_KEYS,
  OPENSWAN_RUN_NAME_KEYS,
} from '../../../lib/officeOpsBoard';
import type {
  OfficeAgentAccountability as OfficeAgentAccountabilityModel,
  OfficeBuildingBoard,
  OfficeRunNode,
  OfficeTokenTrackerCard as OfficeTokenTrackerCardModel,
} from '../../../lib/officeOpsBoard';
import type { AgentRun } from '../../../lib/agentRunSystem';
import type { ClaudeUsageSummary, ClaudeUsageByModel } from '../../../lib/claudeUsage';
import AgentActivityFeed from '../../../components/AgentActivityFeed';
import HitlApprovalBanner from '../../../components/HitlApprovalBanner';
import ChatAttentionStrip from '../../../components/ChatAttentionStrip';
import StandingGrantsPanel from '../../../components/StandingGrantsPanel';
import ComputerTaskSchedulesPanel from '../../../components/ComputerTaskSchedulesPanel';
import RunHistoryDrawer from '../../../components/chat/RunHistoryDrawer';
import {
  buildChatAttentionState,
  resolveApprovalExpiresAt,
  type ChatAttentionAction,
  type ChatAttentionItem,
} from '../../../lib/chatAttentionQueue';
import { showAlert } from '../../../lib/alert';
import type { ComputerTaskChecklistCard } from '../../../lib/computerTaskState';
import { useAgentApprovals, useAgentControl } from '../../../services/hitlService';
import {
  CircleOfficeAgent,
  loadCircleOfficeAgents,
  publishAgentToCircle,
  subscribeToCircleOffice,
  PROVIDER_DISPLAY,
  createBlackSwanAgent,
  BLACKSWAN_AGENT_ID,
  hideAgentInOffice,
} from '../../../lib/circleOffice';
import {
  CHESS_INITIAL_BOARD, getChessLegalMoves, applyChessMove, isCheckmate, isStalemate, isInCheck,
  checkConnectFourWin, isConnectFourFull, connectFourAI,
} from '../../../lib/circleGames';
import {
  startHeartbeat,
  stopHeartbeat,
  getLastSeen,
} from '../../../lib/agentHeartbeat';
import {
  joinPresenceChannel,
  leavePresenceChannel,
  broadcastAgentUpdate,
  extractLiveAgents,
  AgentLiveState,
  ConnectionStatus,
} from '../../../lib/agentPresence';
import {
  subscribeToTerminalCommands,
  respondToCommand,
  cleanupTerminalChannels,
  updateAgentAnalytics,
  sendTerminalCommand,
  syncAgentTokenSnapshot,
  BroadcastCommandPayload,
} from '../../../lib/officeTerminal';
import {
  invokeAndStream,
  invokeAllAgents,
  invokeSelectedAgents,
} from '../../../lib/agentInvocation';
import { getCircleSessionMemoryMode, getActiveRuns } from '../../../lib/agentRunSystem';
import { buildOfficeRoster } from '../../../lib/officeRoster';
import { useUserApiKeys } from '../../../lib/llmProviders';
import { useOfficeSurfaceState } from './office/useOfficeSurfaceState';
import { getAdaptiveOfficeDefaults, loadAdaptiveWorkspaceSettings, loadCircleWorkspaceProfile, recordOfficeActivity } from '../../../lib/workspaceAdaptation';
import {
  IdleBehaviorConfig, loadIdleConfig, saveIdleConfig,
  startIdleScheduler, stopIdleScheduler, getDefaultIdleConfig,
} from '../../../lib/idleBehaviors';
import { supabase } from '../../../lib/supabase';
import { fetchNFTs } from '../../../lib/crypto';

function setAutoConnectCircleId(circleId: string) {
  import('../../../lib/agentAutoConnect')
    .then((mod) => mod.setAutoConnectCircleId(circleId))
    .catch(() => {});
}

function updateAutoConnectConnections(connections: AgentConnection[]) {
  import('../../../lib/agentAutoConnect')
    .then((mod) => mod.updateAutoConnectConnections(connections))
    .catch(() => {});
}
import { NFT } from '../../../types';
import AgentSetupWizard from '../../../components/AgentSetupWizard';
import ConnectAgentModal from '../../../components/ConnectAgentModal';
// AgentControlCard is now embedded inside AgentPanel (not used directly here)
import BadgeCelebration from '../../../components/BadgeCelebration';
import RewardsPanel from '../../../components/RewardsPanel';
import { useAllAgentPointsTracker, useUserRewards } from '../../../services/rewardService';
import { Badge, getNextBadge } from '../../../lib/badges';
import {
  RippleEffect, ConfettiEffect, RocketEffect, DiceEffect,
  PulseEffect, ShakeEffect, FireworksEffect,
} from './office/FloorEffects';
import RetroEmulator from '../../../components/RetroEmulator';
import ScrabbleGame from '../../../components/ScrabbleGame';
import PhoneMessenger from '../../../components/PhoneMessenger';
import PokerGame from '../../../components/poker/PokerGame';
import HuggingFaceExplorer from './office/HuggingFaceExplorer';
import HfToolRunner from './office/HfToolRunner';
import Marquee from '../../../components/web-effects/Marquee.web';
import StatusPicker from '../../../components/office/StatusPicker';
import XPEventFeed from '../../../components/rpg/XPEventFeed';
import StreakFlame from '../../../components/rpg/StreakFlame';
import GitHubWallFeed from '../../../components/office/GitHubWallFeed';
import WorldClockBar from '../../../components/office/WorldClockBar';
import SoundMixer from '../../../components/office/SoundMixer';
import SiteCredentialVaultPanel from '../../../components/vault/SiteCredentialVaultPanel';

const STORAGE_KEY_TELEGRAM = '@office_telegram_config';
const STORAGE_KEY_AGENT_NAMES = '@office_agent_names';
const STORAGE_KEY_FLOORS = '@office_floors';
const STORAGE_KEY_FLOORS_TS = '@office_floors_updated_at';
const STORAGE_KEY_CURRENT_FLOOR = '@office_current_floor';
const STORAGE_KEY_APPEARANCES = '@office_appearances';
const STORAGE_KEY_WHITEBOARD_NOTES = '@office_whiteboard_notes';
const publishCtaDismissedKey = (circleId: string) => `@office_publish_cta_dismissed_${circleId}`;

// Track whether Supabase profile columns exist (migrations may not be run yet)
// Reset each mount — a transient error shouldn't permanently disable sync
let _profileHasOfficeLayout = true;
let _profileHasAgentAppearance = true;
let _profileHasOfficePreferences = true;

function isMissingProfileColumnError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === 'PGRST204'
    || code === '42703'
    || message.includes('column')
    || message.includes('schema cache')
  );
}

export interface AgentStats {
  agentCount: number;
  sessionCount: number;
  costToday: number;
  costWeek: number;
  tokens: number;
  tokensTotal: number;
  messagesTotal: number;
  messagesToday: number;
  inputTokens: number;
  outputTokens: number;
}

interface Props {
  circleId: string;
  accentColor: string;
  onAgentStats?: (stats: AgentStats) => void;
  onReady?: () => void;
}

type WhiteboardModule = typeof import('./office/Whiteboard');
type ServerRackModule = typeof import('./office/ServerRack');
type OfficeTerminalModule = typeof import('../../../components/OfficeTerminal');

function runWhenIdle(task: () => void, timeoutMs = 250): () => void {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
    const id = (window as any).requestIdleCallback(task, { timeout: timeoutMs });
    return () => {
      try { (window as any).cancelIdleCallback?.(id); } catch {}
    };
  }
  const timeoutId = setTimeout(task, Math.min(timeoutMs, 32));
  return () => clearTimeout(timeoutId);
}

function isDocumentVisible(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

export default function OfficeTab({ circleId, accentColor, onAgentStats, onReady }: Props) {
  const surfaceState = useOfficeSurfaceState();
  const [selectedAgent, setSelectedAgent] = useState<OfficeAgent | null>(null);
  // Filter chips that sit above the agents list. Persisted in localStorage so
  // a user who always works in "mine" doesn't have to re-toggle every visit.
  type AgentFilterMode = 'all' | 'mine' | 'active' | 'bonded';
  const [agentFilterMode, setAgentFilterMode] = useState<AgentFilterMode>(() => {
    if (typeof window === 'undefined' || !window.localStorage) return 'all';
    const stored = window.localStorage.getItem('uc_office_agent_filter_v1');
    return (stored === 'mine' || stored === 'active' || stored === 'bonded') ? stored as AgentFilterMode : 'all';
  });
  const persistAgentFilter = useCallback((mode: AgentFilterMode) => {
    setAgentFilterMode(mode);
    try { window.localStorage?.setItem('uc_office_agent_filter_v1', mode); } catch {}
  }, []);
  // Click origin for pop-out animation (where the user clicked the agent on screen)
  const [panelOrigin, setPanelOrigin] = useState<{ x: number; y: number } | null>(null);
  const [celebrationBadge, setCelebrationBadge] = useState<Badge | null>(null);
  const [dancingAgentId, setDancingAgentId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | undefined>();
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [sessionMemoryMode, setSessionMemoryMode] = useState<'private' | 'shared'>('private');
  const [savingSessionMemoryMode, setSavingSessionMemoryMode] = useState(false);
  const pendingApprovals = useAgentApprovals(circleId);
  // showControlCard removed — controls now embedded in AgentPanel

  // Circle-wide "Needs you" strip (plan §4a/§5b) — same chatAttentionQueue
  // owner as chat: summary line with counts + soonest-expiry countdown, rows
  // for expired approvals the live banner below cannot show, and runs stuck
  // in waiting_approval/paused with how long they have been blocked. Pending
  // approvals keep their approve/reject buttons in HitlApprovalBanner; the
  // status line still counts them so the summary stays truthful.
  const [dismissedOfficeAttentionIds, setDismissedOfficeAttentionIds] = useState<Set<string>>(new Set());
  const [, setOfficeAttentionTick] = useState(0);
  const [officeBlockedRuns, setOfficeBlockedRuns] = useState<AgentRun[]>([]);
  // open_run deep-link (plan §6b): blocked-run attention items open the same
  // run drawer chat uses instead of pointing at the board with an alert.
  const [showOfficeRunDetail, setShowOfficeRunDetail] = useState(false);
  useEffect(() => {
    if (!circleId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const runs = await getActiveRuns(circleId);
        if (!cancelled) {
          setOfficeBlockedRuns(runs.filter(
            (run) => run.status === 'waiting_approval' || run.status === 'paused',
          ));
        }
      } catch { /* queue is a summary — a failed poll just shows stale data */ }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [circleId]);
  const officeAttention = buildChatAttentionState({
    approvals: pendingApprovals,
    blockedRuns: officeBlockedRuns,
  }, { dismissedIds: dismissedOfficeAttentionIds });
  const officeAttentionItems = officeAttention.items.filter((item) =>
    item.kind !== 'approval_pending'
      && item.kind !== 'approval_expiring',
  );
  const officeAttentionActive = officeAttention.statusLine !== null;
  useEffect(() => {
    if (!officeAttentionActive) return;
    const timer = setInterval(() => setOfficeAttentionTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, [officeAttentionActive]);
  const handleOfficeAttentionAction = (item: ChatAttentionItem, action: ChatAttentionAction) => {
    if (action.kind === 'dismiss') {
      setDismissedOfficeAttentionIds((prev) => new Set(prev).add(item.id));
      return;
    }
    if (action.kind === 'refile_approval') {
      // Office has no composer — re-asking happens where the request lives.
      showAlert(
        'Approval expired',
        'Resend the original request from the Chat tab and a fresh approval will be filed automatically.',
      );
      return;
    }
    if (action.kind === 'open_run') {
      setShowOfficeRunDetail(true);
    }
  };

  // D6: active computer-task card from the persisted record (main thread) —
  // Office is the away-from-chat surface, so a task paused on a question or
  // approval must be visible here too. Light poll; storage read is cheap.
  const [computerTaskCard, setComputerTaskCard] = useState<ComputerTaskChecklistCard | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { loadComputerTaskState, buildComputerTaskChecklistCard } = await import('../../../lib/computerTaskState');
        const record = await loadComputerTaskState(circleId);
        if (!cancelled) setComputerTaskCard(buildComputerTaskChecklistCard(record));
      } catch { /* dashboard extra — never break Office */ }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [circleId]);

  // ── Office ops board (Building Now + Token Tracker) ──────────────────────
  // D6 pattern: lazy-import loader, bounded pure models, silent failures.
  // Runs poll every 15s plus a realtime subscription for instant updates;
  // Claude usage (summary + by-model, 7d) refreshes at most every 60s.
  const [opsBoard, setOpsBoard] = useState<OfficeBuildingBoard | null>(null);
  const [opsTokenTracker, setOpsTokenTracker] = useState<OfficeTokenTrackerCardModel | null>(null);
  // O1 (P38): per-agent 24h accountability (last outcome + counts + cost),
  // keyed by the same lowercased agent-name seam as opsRunNodesByAgent.
  const [opsAccountability, setOpsAccountability] = useState<Map<string, OfficeAgentAccountabilityModel> | null>(null);
  // O5 (P39): main-view bridge readiness (warn/danger strip). Shares the
  // probe→snapshot owner with the Whiteboard (officeBridgeReadinessProbe).
  const [bridgeReadinessStrip, setBridgeReadinessStrip] = useState<OfficeBridgeReadinessSnapshotModel | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const { runOfficeBridgeReadinessProbe } = await import('../../../lib/officeBridgeReadinessProbe');
        const snapshot = await runOfficeBridgeReadinessProbe();
        if (!cancelled) setBridgeReadinessStrip(snapshot);
      } catch { /* dashboard extra — never break Office */ }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  const opsLiveRunsRef = useRef<AgentRun[]>([]);
  const opsUsageCacheRef = useRef<{
    summary?: ClaudeUsageSummary;
    byModel?: ClaudeUsageByModel[];
    fetchedAtMs: number;
  }>({ fetchedAtMs: 0 });
  // Synced from enrichedSessions in render (declared below) so the loader can
  // read the latest sessions without re-subscribing — same pattern as onReadyRef.
  const opsSessionsRef = useRef<OpenSwanSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeRuns: (() => void) | null = null;
    // Reset per-circle so a circle switch can't show stale spend/runs.
    opsLiveRunsRef.current = [];
    opsUsageCacheRef.current = { fetchedAtMs: 0 };

    const rebuildTracker = async () => {
      try {
        const { buildOfficeTokenTracker } = await import('../../../lib/officeOpsBoard');
        if (cancelled) return;
        const sessions = opsSessionsRef.current;
        const pc = sessions.length > 0 ? calculatePeriodCosts(sessions) : null;
        setOpsTokenTracker(buildOfficeTokenTracker({
          summary: opsUsageCacheRef.current.summary,
          byModel: opsUsageCacheRef.current.byModel,
          liveRuns: opsLiveRunsRef.current,
          periodCosts: pc ? { today: pc.today, week: pc.week } : undefined,
          nowMs: Date.now(),
        }));
      } catch { /* dashboard extra — never break Office */ }
    };

    const reloadRuns = async () => {
      try {
        const [{ listCircleLiveRuns }, { buildOfficeBuildingBoard, buildOfficeAgentAccountabilityIndex }] = await Promise.all([
          import('../../../lib/agentRunSystem'),
          import('../../../lib/officeOpsBoard'),
        ]);
        // 24h finished window (O1 accountability). The building board
        // self-filters recentlyFinished to its 10-minute window, so widening
        // the fetch only feeds the per-agent accountability index.
        const runs = await listCircleLiveRuns(circleId, { recentFinishedMs: 24 * 60 * 60 * 1000, limit: 200 });
        if (cancelled) return;
        opsLiveRunsRef.current = runs;
        setOpsBoard(buildOfficeBuildingBoard(runs, { nowMs: Date.now() }));
        setOpsAccountability(buildOfficeAgentAccountabilityIndex(runs, { nowMs: Date.now() }));
        void rebuildTracker(); // live-burn line tracks the fresh runs
      } catch { /* dashboard extra — never break Office */ }
    };

    const reloadUsage = async () => {
      // Cache: refresh Claude usage at most every 60s even if callers race.
      if (Date.now() - opsUsageCacheRef.current.fetchedAtMs < 60_000) return;
      opsUsageCacheRef.current.fetchedAtMs = Date.now(); // claim slot before await
      try {
        const { getClaudeUsageSummary, getClaudeUsageByModel } = await import('../../../lib/claudeUsage');
        const [summary, byModel] = await Promise.all([
          getClaudeUsageSummary(circleId, 7),
          getClaudeUsageByModel(circleId, 7),
        ]);
        if (cancelled) return;
        opsUsageCacheRef.current = { summary, byModel, fetchedAtMs: Date.now() };
        void rebuildTracker();
      } catch { /* dashboard extra — never break Office */ }
    };

    void reloadRuns();
    void reloadUsage();
    const runsTimer = setInterval(() => { void reloadRuns(); }, 15_000);
    const usageTimer = setInterval(() => { void reloadUsage(); }, 60_000);

    // Realtime: refetch on agent_runs INSERT/UPDATE (debounced in the lib).
    (async () => {
      try {
        const { subscribeToCircleRuns } = await import('../../../lib/agentRunSystem');
        if (cancelled) return;
        const unsub = subscribeToCircleRuns(circleId, () => { void reloadRuns(); });
        if (cancelled) { unsub(); return; } // raced with cleanup
        unsubscribeRuns = unsub;
      } catch { /* dashboard extra — never break Office */ }
    })();

    return () => {
      cancelled = true;
      clearInterval(runsTimer);
      clearInterval(usageTimer);
      try { unsubscribeRuns?.(); } catch {}
      unsubscribeRuns = null;
    };
  }, [circleId]);

  // Map building run nodes to roster agents by case-insensitive agentName.
  // Limitation: OfficeRunNode.agentName is derived from delegated_to / a
  // "Name: " title prefix / surface label, so runs without an explicit agent
  // label (e.g. "Chat agent") won't attach to a specific roster agent.
  const opsRunNodesByAgent = useMemo(() => {
    const map = new Map<string, OfficeRunNode[]>();
    const visit = (node: OfficeRunNode) => {
      const key = node.agentName.trim().toLowerCase();
      const list = map.get(key);
      if (list) list.push(node); else map.set(key, [node]);
      node.children.forEach(visit);
    };
    (opsBoard?.building ?? []).forEach(visit);
    return map;
  }, [opsBoard]);

  // Agent control hook for selected agent
  const selectedSessionKey = getAgentIdentityKey(selectedAgent);
  const agentControl = useAgentControl(circleId, selectedSessionKey);

  // Remote shell: execute command on agent's machine via bridge /exec
  const handleRunCommand = React.useCallback(async (cmd: string) => {
    if (!selectedAgent) return { ok: false, stdout: '', stderr: 'No agent selected' };

    // Determine bridge URL based on provider type
    const bridgePorts: Record<string, number> = {
      'claude-code': 7778, 'codex': 7779, 'gemini': 7780, 'cursor': 7781,
    };
    const port = bridgePorts[selectedAgent.providerType || ''];
    if (!port) return { ok: false, stdout: '', stderr: 'No bridge for this provider' };
    const bridgeUrl = getBridgeUrl(port);
    if (!bridgeUrl) {
      return {
        ok: false,
        stdout: '',
        stderr: 'Agent bridges are only reachable from the local dev machine. Run `npm run dev` or set EXPO_PUBLIC_BRIDGE_HOST to a public bridge URL.',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${bridgeUrl}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      return { ok: data.ok, stdout: data.stdout || '', stderr: data.stderr || '' };
    } catch (e: any) {
      return { ok: false, stdout: '', stderr: e.message || 'Bridge not reachable' };
    }
  }, [selectedAgent]);

  // Disconnect handler — stops poller and marks agent offline
  const handleDisconnectAgent = React.useCallback(() => {
    if (!selectedAgent) return;
    setSelectedAgent(null);
  }, [selectedAgent]);

  // Load custom themes from Supabase
  const { themes: customThemeRecords, refresh: refreshCustomThemes } = useCustomThemes(circleId);
  const customThemeLookup = React.useMemo(() => {
    const map: Record<string, OfficeTheme> = {};
    for (const rec of customThemeRecords) {
      const resolved = customThemeToOfficeTheme(rec);
      map[resolved.id] = resolved;
    }
    return map;
  }, [customThemeRecords]);

  const resolveTheme = useCallback((themeId: string): OfficeTheme => {
    return OFFICE_THEMES[themeId] || customThemeLookup[themeId] || OFFICE_THEMES.underground;
  }, [customThemeLookup]);

  // Load user ID for rewards
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id);
      setUserEmail(user?.email ?? undefined);
    }).catch(() => {});
  }, []);

  // Pre-load trending content for thought bubbles (HN + X trends, 12h cache)
  useEffect(() => {
    loadTrendingContent().catch(() => {});
  }, []);

  const [appearances, setAppearances] = useState<Record<string, AgentAppearance>>({});
  const appearancesLoadedRef = useRef(false);
  const prefsLoadedRef = useRef(false);
  // Flipped true once budget/idle have been loaded from local + server,
  // so the save useEffect doesn't fire on the initial load.
  const budgetLoadedRef = useRef(false);
  const idleLoadedRef = useRef(false);
  const remoteBudgetAppliedRef = useRef(false);
  const remoteIdleAppliedRef = useRef(false);
  const [activeCatalogCat, setActiveCatalogCat] = useState<string>('connected');
  const catalogScrollRef = useRef<ScrollView>(null);
  const [whiteboardNotes, setWhiteboardNotes] = useState<string[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [statusHistory, setStatusHistory] = useState<Array<OfficeAgent[]>>([]);
  const [enrichedAgents, setEnrichedAgents] = useState<OfficeAgent[]>([]);
  const [agentIdentities, setAgentIdentities] = useState<Map<string, AgentIdentity>>(new Map());
  const enrichedAgentsRef = useRef<OfficeAgent[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const viewMode = 'office'; // Simplified — analytics dashboards moved to Backpack tab
  const [sessionTags, setSessionTags] = useState<Map<string, SessionTag[]>>(new Map());
  const sessionTagsRef = useRef<Map<string, SessionTag[]>>(new Map());
  const [budgetConfig, setBudgetConfig] = useState<BudgetConfig>({ enabled: false });
  const [idleConfig, setIdleConfig] = useState<IdleBehaviorConfig>(getDefaultIdleConfig());
  const idleConfigRef = useRef<IdleBehaviorConfig>(getDefaultIdleConfig());

  // Keep refs in sync with state for use in intervals/callbacks
  useEffect(() => { enrichedAgentsRef.current = enrichedAgents; }, [enrichedAgents]);
  useEffect(() => { sessionTagsRef.current = sessionTags; }, [sessionTags]);
  const { keys: providerKeys, refresh: refreshProviderKeys } = useUserApiKeys();
  const [budgetAlertsDismissed, setBudgetAlertsDismissed] = useState(false);
  const [actionResult, setActionResult] = useState<string>('');
  const [showActionResult, setShowActionResult] = useState(false);
  const [enrichedSessions, setEnrichedSessions] = useState<OpenSwanSession[]>([]);
  // Keep the ops-board loader's view of sessions current without it needing
  // enrichedSessions in its effect deps (it reads via ref at rebuild time).
  opsSessionsRef.current = enrichedSessions;
  const enrichedSessionSignatureRef = useRef('');
  const {
    showCustomize, setShowCustomize,
    showMcpHub, setShowMcpHub,
    showRewards, setShowRewards,
    showSetupWizard, setShowSetupWizard,
    showConnectAgent, setShowConnectAgent,
    showGitHubFeed, setShowGitHubFeed,
    showSoundMixer, setShowSoundMixer,
    showVault, setShowVault,
    showPublishModal, setShowPublishModal,
    editMode, setEditMode,
    placingType, setPlacingType,
    selectedFurnitureId, setSelectedFurnitureId,
    terminalSize, setTerminalSize,
    terminalInitialTab, setTerminalInitialTab,
    terminalInput, setTerminalInput,
    terminalTargetId, setTerminalTargetId,
    terminalTargetName, setTerminalTargetName,
    terminalModel, setTerminalModel,
    terminalTargetIds, setTerminalTargetIds,
    nftPickerVisible, setNftPickerVisible,
    stickyEditorVisible, setStickyEditorVisible,
    emulatorVisible, setEmulatorVisible,
    scrabbleVisible, setScrabbleVisible,
    pokerVisible, setPokerVisible,
    phoneVisible, setPhoneVisible,
    hfExplorerVisible, setHfExplorerVisible,
    hfRunnerVisible, setHfRunnerVisible,
    serviceModalVisible, setServiceModalVisible,
  } = surfaceState;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadCircleWorkspaceProfile(circleId),
      loadAdaptiveWorkspaceSettings(circleId),
    ]).then(([profile, settings]) => {
      if (cancelled) return;
      const adaptive = getAdaptiveOfficeDefaults(profile, settings);
      setTerminalInitialTab(adaptive.terminalInitialTab);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [circleId, setTerminalInitialTab]);

  useEffect(() => {
    if (selectedAgent) {
      recordOfficeActivity(circleId, 'select_agent').catch(() => {});
      recordOfficeActivity(circleId, 'runtime').catch(() => {});
    }
  }, [circleId, selectedAgent]);

  useEffect(() => {
    if (editMode || placingType || selectedFurnitureId) {
      recordOfficeActivity(circleId, 'workspace').catch(() => {});
    }
  }, [circleId, editMode, placingType, selectedFurnitureId]);

  useEffect(() => {
    if (showGitHubFeed || showSoundMixer || showVault) {
      recordOfficeActivity(circleId, 'intelligence').catch(() => {});
    }
  }, [circleId, showGitHubFeed, showSoundMixer, showVault]);

  useEffect(() => {
    if (terminalSize !== 'closed') {
      recordOfficeActivity(circleId, 'runtime').catch(() => {});
      recordOfficeActivity(circleId, terminalInitialTab === 'automations' ? 'terminal_automations' : 'terminal_commands').catch(() => {});
    }
  }, [circleId, terminalInitialTab, terminalSize]);

  // ─── Multi-floor state ──────────────────────────────
  const [floors, setFloors] = useState<OfficeFloor[]>(DEFAULT_FLOORS);
  const floorsRef = useRef<OfficeFloor[]>(DEFAULT_FLOORS);
  useEffect(() => { floorsRef.current = floors; }, [floors]);
  const [currentFloorId, setCurrentFloorId] = useState<string>('floor_1');

  // ─── Image / NFT picker state ───────────────────────────────────────────
  const [nftPickerTargetId, setNftPickerTargetId] = useState<string | null>(null);
  const [userNfts, setUserNfts] = useState<NFT[]>([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [imagePickerTab, setImagePickerTab] = useState<'upload' | 'nft'>('upload');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Sticky note editor state ───────────────────────────────────────────
  const [stickyEditorTargetId, setStickyEditorTargetId] = useState<string | null>(null);
  const [stickyTab, setStickyTab] = useState<'write' | 'draw' | 'gif'>('write');
  const [stickyText, setStickyText] = useState('');
  const [stickyColor, setStickyColor] = useState('#fef08a');
  const [stickyGifUrl, setStickyGifUrl] = useState('');
  const [stickyGifSearch, setStickyGifSearch] = useState('');
  const stickyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stickyDrawingRef = useRef(false);

  // ─── Retro emulator state ────────────────────────────────────────────
  const [emulatorSystem, setEmulatorSystem] = useState<string>('gba');

  // ─── Scrabble state ────────────────────────────────────────────────

  // ─── Phone messenger state ─────────────────────────────────────────

  // ─── Hugging Face state ───────────────────────────────────────────

  // ─── Service connector state ────────────────────────────────────────────
  const [serviceModalTargetId, setServiceModalTargetId] = useState<string | null>(null);
  const [serviceModalType, setServiceModalType] = useState<string>('');
  const [serviceUrl, setServiceUrl] = useState('');
  const [serviceTvApp, setServiceTvApp] = useState('youtube');
  const [serviceTvWidth, setServiceTvWidth] = useState('120');
  const [serviceTvHeight, setServiceTvHeight] = useState('80');
  const [serviceDiscordChannel, setServiceDiscordChannel] = useState('');
  const [serviceTwitchChannel, setServiceTwitchChannel] = useState('');
  const [serviceCallProvider, setServiceCallProvider] = useState('zoom');
  const [serviceCalendarProvider, setServiceCalendarProvider] = useState('google');
  const [serviceEmailProvider, setServiceEmailProvider] = useState('outlook');
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<{ connected: boolean; email: string } | null>(null);
  const [oauthError, setOauthError] = useState('');

  // ─── Interactive furniture state ──────────────────────────────────────────
  const [interactInputId, setInteractInputId] = useState<string | null>(null);
  const [interactInputText, setInteractInputText] = useState('');
  const [interactAgentTarget, setInteractAgentTarget] = useState<string | null>(null);
  const [floorEffects, setFloorEffects] = useState<Array<{ id: string; type: string; x: number; y: number; createdAt: number }>>([]);

  // ─── Setup wizard ─────────────────────────────────────────────────────────

  // ─── Cloud agent connect modal ─────────────────────────────────────────────

  // ─── Office enhancement panels ────────────────────────────────────────────
  const [whiteboardModule, setWhiteboardModule] = useState<WhiteboardModule | null>(null);
  const [serverRackModule, setServerRackModule] = useState<ServerRackModule | null>(null);
  const [officeTerminalModule, setOfficeTerminalModule] = useState<OfficeTerminalModule | null>(null);

  // ─── Multi-connection state ──────────────────────────────
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const pollersRef = useRef<Map<string, OpenSwanPoller>>(new Map());
  const sessionsRef = useRef<Map<string, OpenSwanSession[]>>(new Map());
  const [sessionsTick, setSessionsTick] = useState(0); // force re-render on session updates

  // ─── Current user ─────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUserName, setCurrentUserName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user || cancelled) return;
        setCurrentUserId(data.user.id);

        try {
          const { data: profile } = await supabase.from('profiles')
            .select('display_name, username')
            .eq('id', data.user.id)
            .single();

          if (!cancelled) {
            setCurrentUserName(profile?.display_name || profile?.username || 'Agent');
          }
        } catch {}
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    getCircleSessionMemoryMode(circleId).then(setSessionMemoryMode).catch(() => {});
  }, [circleId]);

  const toggleSessionMemoryMode = useCallback(async () => {
    if (savingSessionMemoryMode) return;
    const nextMode: 'private' | 'shared' = sessionMemoryMode === 'shared' ? 'private' : 'shared';
    setSavingSessionMemoryMode(true);
    try {
      const { data, error } = await supabase
        .from('circles')
        .select('settings')
        .eq('id', circleId)
        .single();
      if (error) throw error;

      const { error: updateError } = await supabase
        .from('circles')
        .update({
          settings: {
            ...(data?.settings || {}),
            sessionMemoryMode: nextMode,
          },
        })
        .eq('id', circleId);
      if (updateError) throw updateError;

      setSessionMemoryMode(nextMode);
    } catch (err) {
      console.error('[OfficeTab] Failed to update session memory mode:', err);
    } finally {
      setSavingSessionMemoryMode(false);
    }
  }, [circleId, savingSessionMemoryMode, sessionMemoryMode]);

  // ─── Circle Office (shared agents from all members) ──────────────────────
  const [circleOfficeAgents, setCircleOfficeAgents] = useState<CircleOfficeAgent[]>([]);
  const [publishCtaDismissed, setPublishCtaDismissed] = useState(false);
  const [publishingToCircle, setPublishingToCircle] = useState(false);
  const readyFired = useRef(false);
  const circleOfficeLoadInFlightRef = useRef<Promise<void> | null>(null);
  const pendingCircleOfficeRefreshRef = useRef(false);
  const scheduledCircleOfficeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markOfficeReady = useCallback(() => {
    if (!readyFired.current && onReadyRef.current) {
      readyFired.current = true;
      onReadyRef.current();
    }
  }, []);

  const loadCircleOffice = useCallback(async () => {
    if (circleOfficeLoadInFlightRef.current) {
      pendingCircleOfficeRefreshRef.current = true;
      return circleOfficeLoadInFlightRef.current;
    }
    const run = (async () => {
      try {
        const { agents } = await loadCircleOfficeAgents(circleId);
        setCircleOfficeAgents(agents);
      } catch (error) {
        console.warn('[OfficeTab] loadCircleOffice failed:', error);
      } finally {
        // Shared office agents should not block the shell from rendering.
        markOfficeReady();
        circleOfficeLoadInFlightRef.current = null;
      }
    })();
    circleOfficeLoadInFlightRef.current = run;
    await run;
    if (pendingCircleOfficeRefreshRef.current) {
      pendingCircleOfficeRefreshRef.current = false;
      void loadCircleOffice();
    }
  }, [circleId, markOfficeReady]);

  const scheduleCircleOfficeRefresh = useCallback((delayMs = 0) => {
    if (scheduledCircleOfficeRefreshRef.current) {
      clearTimeout(scheduledCircleOfficeRefreshRef.current);
      scheduledCircleOfficeRefreshRef.current = null;
    }
    scheduledCircleOfficeRefreshRef.current = setTimeout(() => {
      scheduledCircleOfficeRefreshRef.current = null;
      void loadCircleOffice();
    }, delayMs);
  }, [loadCircleOffice]);

  // Keep a ref to the latest onReady so loadCircleOffice doesn't need it in
  // its useCallback deps. When onReady identity changes on the parent, we
  // don't want to recreate loadCircleOffice — that was causing the
  // subscribe/unsubscribe thrash that tanked circle-load performance (the
  // WebSocket connection failures flooding the console were a symptom).
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    setAutoConnectCircleId(circleId);
    void loadCircleOffice();
    const unsub = subscribeToCircleOffice(circleId, loadCircleOffice);
    return () => {
      if (scheduledCircleOfficeRefreshRef.current) {
        clearTimeout(scheduledCircleOfficeRefreshRef.current);
        scheduledCircleOfficeRefreshRef.current = null;
      }
      unsub();
    };
    // Intentionally omit loadCircleOffice from deps — it only needs circleId
    // to change to re-fire. Including it caused the subscribe churn above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId]);

  useEffect(() => {
    let cancelled = false;
    storage.getItem(publishCtaDismissedKey(circleId)).then((raw) => {
      if (cancelled) return;
      setPublishCtaDismissed(raw === '1');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [circleId]);

  useEffect(() => {
    if (currentUserId && circleOfficeAgents.some((agent) => agent.ownerId === currentUserId) && publishCtaDismissed) {
      setPublishCtaDismissed(false);
      storage.removeItem(publishCtaDismissedKey(circleId)).catch(() => {});
    }
  }, [circleId, circleOfficeAgents, currentUserId, publishCtaDismissed]);

  const dismissPublishCta = useCallback(() => {
    setPublishCtaDismissed(true);
    storage.setItem(publishCtaDismissedKey(circleId), '1').catch(() => {});
  }, [circleId]);

  // Live presence state — userId → isOnline flag from Supabase Realtime
  const [liveUserIds, setLiveUserIds] = useState<Set<string>>(new Set());
  const [circleConnectionStatus, setCircleConnectionStatus] = useState<ConnectionStatus>('offline');

  // Start heartbeat + join Realtime Presence when we have connected agents
  useEffect(() => {
    const connectedConns = connections.filter(c => c.status === 'connected');

    // Start idle behavior scheduler (runs alongside heartbeat)
    const isOwner = userEmail === OWNER_EMAIL;
    if (userId) {
      startIdleScheduler(circleId, userId, isOwner, () => idleConfigRef.current, (updated) => {
        setIdleConfig(updated);
        idleConfigRef.current = updated;
      });
    }

    if (connectedConns.length > 0) {
      // DB heartbeat layer
      startHeartbeat(circleId, connectedConns).then(() => scheduleCircleOfficeRefresh());

      // Build live agent states from connections
      const myAgents: AgentLiveState[] = connectedConns.map(conn => ({
        agentId: conn.id,
        name: conn.name,
        provider: conn.provider,
        toolIcon: PROVIDER_DISPLAY[conn.provider]?.icon || '🤖',
        color: conn.color || PROVIDER_DISPLAY[conn.provider]?.color || '#e8e8e8',
        status: 'idle' as const,
      }));

      // Realtime Presence layer
      setCircleConnectionStatus('connecting');
      joinPresenceChannel(circleId, myAgents, {
        onSync: (state) => {
          const live = extractLiveAgents(state);
          setLiveUserIds(new Set(live.keys()));
        },
        onJoin: (userId) => {
          setLiveUserIds(prev => new Set([...prev, userId]));
          scheduleCircleOfficeRefresh(150);
        },
        onLeave: (userId) => {
          setLiveUserIds(prev => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
          scheduleCircleOfficeRefresh(3000);
        },
        onConnectionStatus: (status) => {
          setCircleConnectionStatus(status);
        },
      });
    }

    return () => {
      stopHeartbeat(circleId);
      leavePresenceChannel(circleId);
      stopIdleScheduler(circleId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps — identity signature, not count
  }, [circleId, connections.filter(c => c.status === 'connected').map(c => c.id).join(','), scheduleCircleOfficeRefresh]);

  // ─── Direct invocation handler (called by OfficeTerminal after send) ─────
  const handleCommandSent = useCallback((params: {
    messageId: string;
    command: string;
    targetAgentId: string | null;
    targetAgentIds: string[] | null;
    targetAgentName: string;
    model: string | null;
    senderId: string;
  }) => {
    const blackSwanAgent = createBlackSwanAgent(circleId);
    const myAgents = circleOfficeAgents.filter(a => a.ownerId === currentUserId);
    // Use the actual connected endpoint, not hardcoded localhost
    const gwUrl = getOpenSwanEndpoint(connections) || undefined;

    const baseReq = {
      messageId: params.messageId,
      circleId,
      command: params.command,
      senderId: params.senderId,
      targetAgentName: params.targetAgentName,
      model: params.model,
    };

    const blackSwanTargeted =
      params.targetAgentId === BLACKSWAN_AGENT_ID
      || params.targetAgentName?.toLowerCase().includes('blackswan')
      || params.targetAgentName?.toLowerCase().includes('swan')
      || params.targetAgentIds?.includes(BLACKSWAN_AGENT_ID);

    if (params.targetAgentIds && params.targetAgentIds.length > 0) {
      if (params.targetAgentIds.includes(BLACKSWAN_AGENT_ID) || blackSwanTargeted) {
        invokeAndStream(
          { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
          blackSwanAgent,
        ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
      }
      const myTargetedAgents = myAgents.filter(a => params.targetAgentIds!.includes(a.id));
      if (myTargetedAgents.length > 0) {
        invokeSelectedAgents(
          baseReq, myTargetedAgents,
          params.targetAgentIds.filter(id => id !== BLACKSWAN_AGENT_ID),
          gwUrl,
        ).catch(err => console.error('[OfficeTab] Multi-select invocation failed:', err));
      }
    } else if (params.targetAgentId) {
      if (blackSwanTargeted) {
        invokeAndStream(
          { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
          blackSwanAgent,
        ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
      } else {
        const agent = myAgents.find(a => a.id === params.targetAgentId);
        if (agent) {
          invokeAndStream(
            { ...baseReq, targetAgentId: agent.id, targetAgentName: `@${agent.name}` },
            agent,
            gwUrl,
          ).catch(err => console.error('[OfficeTab] Invocation failed:', err));
        }
      }
    } else {
      // @all
      invokeAndStream(
        { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
        blackSwanAgent,
      ).catch(err => console.error('[OfficeTab] BlackSwan @all invocation failed:', err));
      if (myAgents.length > 0) {
        invokeAllAgents(baseReq, myAgents, gwUrl)
          .catch(err => console.error('[OfficeTab] Multi-agent invocation failed:', err));
      }
    }
  }, [circleId, currentUserId, circleOfficeAgents, connections]);

  // ─── Terminal command subscription ────────────────────────────────────────
  // Listen for commands targeting my agents + BlackSwan; invoke accordingly
  // Resolve the gateway URL from active connections (not hardcoded)
  const resolvedGatewayUrl = getOpenSwanEndpoint(connections);

  useEffect(() => {
    if (!currentUserId || !circleId) return;

    const myAgents = circleOfficeAgents.filter(a => a.ownerId === currentUserId);
    const blackSwanAgent = createBlackSwanAgent(circleId);

    // Include both my agent IDs and BlackSwan's ID in the subscription filter
    const myAgentIds = myAgents.map(a => a.id);
    const listenIds = [...myAgentIds, BLACKSWAN_AGENT_ID];

    // Need at least BlackSwan to listen (always active)
    if (listenIds.length === 0) return;

    const unsub = subscribeToTerminalCommands(circleId, listenIds, async (cmd: BroadcastCommandPayload) => {
      // Skip commands we sent ourselves — already handled via direct invocation (onCommandSent)
      if (cmd.senderId === currentUserId) return;
      const baseReq = {
        messageId: cmd.messageId,
        circleId,
        command: cmd.commandText,
        senderId: cmd.senderId,
        targetAgentName: cmd.targetAgentName,
        model: cmd.model,
      };

      // Use connection endpoint, not hardcoded localhost
      const gwUrl = resolvedGatewayUrl || undefined;

      // Helper: check if BlackSwan is targeted
      const blackSwanTargeted =
        cmd.targetAgentId === BLACKSWAN_AGENT_ID
        || cmd.targetAgentName?.toLowerCase().includes('blackswan')
        || cmd.targetAgentName?.toLowerCase().includes('swan')
        || cmd.targetAgentIds?.includes(BLACKSWAN_AGENT_ID);

      if (cmd.targetAgentIds && cmd.targetAgentIds.length > 0) {
        // Multi-select — invoke selected agents in parallel
        // Invoke BlackSwan if included
        if (cmd.targetAgentIds.includes(BLACKSWAN_AGENT_ID)) {
          invokeAndStream(
            { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
            blackSwanAgent,
          ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
        }
        // Invoke user's agents that are in the multi-select
        const myTargetedAgents = myAgents.filter(a => cmd.targetAgentIds!.includes(a.id));
        if (myTargetedAgents.length > 0) {
          invokeSelectedAgents(
            baseReq,
            myTargetedAgents,
            cmd.targetAgentIds.filter(id => id !== BLACKSWAN_AGENT_ID),
            gwUrl
          ).catch(err => console.error('[OfficeTab] Multi-select invocation failed:', err));
        }
      } else if (cmd.targetAgentId) {
        // Single agent target
        if (blackSwanTargeted) {
          invokeAndStream(
            { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
            blackSwanAgent,
          ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
        } else {
          const agent = myAgents.find(a => a.id === cmd.targetAgentId);
          if (!agent) return;

          invokeAndStream(
            { ...baseReq, targetAgentId: agent.id, targetAgentName: `@${agent.name}` },
            agent,
            gwUrl
          ).catch(err => console.error('[OfficeTab] Invocation failed:', err));
        }
      } else {
        // @all — invoke BlackSwan + all user's agents in parallel
        invokeAndStream(
          { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
          blackSwanAgent,
        ).catch(err => console.error('[OfficeTab] BlackSwan @all invocation failed:', err));

        if (myAgents.length > 0) {
          invokeAllAgents(
            { ...baseReq, targetAgentName: '@all' },
            myAgents,
            gwUrl
          ).catch(err => console.error('[OfficeTab] Multi-agent invocation failed:', err));
        }
      }
    });

    return () => {
      unsub();
      cleanupTerminalChannels(circleId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps — identity signature, not count
  }, [circleId, currentUserId, circleOfficeAgents.filter(a => a.ownerId === currentUserId).map(a => a.id).join(','), resolvedGatewayUrl]);

  // Merge live presence into circle office agents
  const mergedCircleAgents = circleOfficeAgents.map(agent => ({
    ...agent,
    // Override status with 'idle' if user is live in Presence but DB shows offline
    status: (liveUserIds.has(agent.ownerId) && agent.status === 'offline')
      ? 'idle' as const
      : agent.status,
  }));

  // Publish the user's first connection as their circle office agent
  // ─── Manual agent publish modal ──────────────────────────────────────────
  const [publishName, setPublishName] = useState('');
  const [publishProvider, setPublishProvider] = useState('openswan');

  const handleActionResult = useCallback((message: string) => {
    setActionResult(message);
    setShowActionResult(true);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setShowActionResult(false);
    }, 5000);
  }, []);

  const openPublishAgentModal = useCallback((conn?: AgentConnection) => {
    if (conn) {
      setPublishName(conn.name || '');
      setPublishProvider(conn.provider || 'openswan');
    } else {
      setPublishName(prev => prev || 'My Agent');
      setPublishProvider(prev => prev || 'openswan');
    }
    setShowPublishModal(true);
  }, [setShowPublishModal]);

  const handlePublishToCircle = useCallback(async (
    overrideName?: string,
    overrideProvider?: string
  ) => {
    if (publishingToCircle) return;

    // Prefer passed values → connected conn → modal values → defaults
    const conn = connections.find(c => c.enabled);
    const display = PROVIDER_DISPLAY[overrideProvider || publishProvider || conn?.provider || 'openswan']
      || PROVIDER_DISPLAY['generic-agent'];

    const agentName    = overrideName     || conn?.name     || publishName || 'My Agent';
    const agentProvider= overrideProvider || conn?.provider || publishProvider || 'openswan';
    const agentColor   = conn?.color      || display.color;

    setPublishingToCircle(true);
    try {
      const result = await publishAgentToCircle({
        circleId,
        provider: agentProvider,
        name: agentName,
        color: agentColor,
        toolIcon: display.icon,
      });
      if (result.error) {
        const message = result.error === 'agent_hidden'
          ? 'This agent is hidden from the Circle Office right now. Reconnect or rename it before publishing again.'
          : `Could not add your agent to the Circle Office: ${result.error}`;
        handleActionResult(message);
        return;
      }
      scheduleCircleOfficeRefresh(150);
      handleActionResult(`${agentName} is now visible in the Circle Office.`);
      setShowPublishModal(false);
    } finally {
      setPublishingToCircle(false);
    }
  }, [circleId, connections, handleActionResult, publishingToCircle, publishName, publishProvider, scheduleCircleOfficeRefresh]);

  // Auto-publish when a connection becomes connected for the first time
  const autoPublishedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const connectedConns = connections.filter(c => c.status === 'connected');
    for (const conn of connectedConns) {
      if (!autoPublishedRef.current.has(conn.id)) {
        autoPublishedRef.current.add(conn.id);
        const display = PROVIDER_DISPLAY[conn.provider] || PROVIDER_DISPLAY['generic-agent'];
        publishAgentToCircle({
          circleId,
          provider: conn.provider,
          name: conn.name,
          color: conn.color || display.color,
          toolIcon: display.icon,
        }).then(() => scheduleCircleOfficeRefresh(150));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps — identity signature, not count
  }, [circleId, connections.filter(c => c.status === 'connected').map(c => c.id).join(','), scheduleCircleOfficeRefresh]);

  // ─── Telegram state ──────────────────────────────
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>({ botToken: '', chatId: '' });
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramBotName, setTelegramBotName] = useState<string | null>(null);
  const [telegramChatTitle, setTelegramChatTitle] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const tgPollerRef = useRef<TelegramPoller | null>(null);
  const shouldSkipOpenSwanConnectionAttempt = useCallback((conn: AgentConnection) => {
    if (conn.provider !== 'openswan') return false;
    const notice = getOpenSwanEndpointNotice(conn.endpoint, conn.token);
    return !!notice && /authentication failed|wrong or missing token/i.test(notice);
  }, []);

  // ─── Connection helpers ──────────────────────────────

  const connectOne = useCallback(async (conn: AgentConnection) => {
    if (shouldSkipOpenSwanConnectionAttempt(conn)) {
      setConnections(prev => {
        const updated = prev.map(c => c.id === conn.id ? {
          ...c,
          status: 'error' as const,
          error: 'Authentication failed — wrong or missing token',
        } : c);
        updateAutoConnectConnections(updated);
        return updated;
      });
      return;
    }
    // Update status to connecting (local + singleton)
    setConnections(prev => {
      const updated = prev.map(c => c.id === conn.id ? { ...c, status: 'connecting' as const, error: undefined } : c);
      updateAutoConnectConnections(updated);
      return updated;
    });

    const result = await testAgentBridgeConnection({
      provider: conn.provider,
      endpoint: conn.endpoint,
      token: conn.token,
    });

    if (!result.ok) {
      setConnections(prev => {
        const updated = prev.map(c => c.id === conn.id ? { ...c, status: 'error' as const, error: result.error || 'Connection failed' } : c);
        updateAutoConnectConnections(updated);
        return updated;
      });
      return;
    }

    if (!supportsOpenSwanRpc(conn.provider)) {
      setConnections(prev => {
        const updated = prev.map(c => c.id === conn.id ? {
          ...c,
          status: 'connected' as const,
          error: undefined,
          sessionCount: undefined,
          agentIds: [],
          lastConnected: new Date().toISOString(),
        } : c);
        updateAutoConnectConnections(updated);
        return updated;
      });
      return;
    }

    const config: OpenSwanConfig = { endpoint: conn.endpoint, token: conn.token };

    // Store initial sessions from the successful rich-bridge test result
    sessionsRef.current.set(conn.id, result.sessions || []);

    // Fetch agent ids
    let agentIds: string[] = [];
    const agentsResult = await listAgents(config);
    if (agentsResult.ok && agentsResult.agents) agentIds = agentsResult.agents;

    // Update connection status (local + singleton)
    setConnections(prev => {
        const updated = prev.map(c => c.id === conn.id ? {
          ...c,
          status: 'connected' as const,
          error: undefined,
          sessionCount: (result.sessions || []).length,
          agentIds,
          lastConnected: new Date().toISOString(),
        } : c);
      updateAutoConnectConnections(updated);
      return updated;
    });

    // Start poller
    const oldPoller = pollersRef.current.get(conn.id);
    if (oldPoller) oldPoller.stop();

    const poller = new OpenSwanPoller(config, (update: OpenSwanUpdate) => {
      sessionsRef.current.set(conn.id, update.sessions);
      setConnections(prev => {
        const updated = prev.map(c => c.id === conn.id && c.status === 'connected' ? {
          ...c, sessionCount: update.sessions.length,
        } : c);
        updateAutoConnectConnections(updated);
        return updated;
      });
      setSessionsTick(t => t + 1);
    }, (error: string) => {
      // Poller detected persistent failure — mark as error for retry
      pollersRef.current.delete(conn.id);
      setConnections(prev => {
        const updated = prev.map(c => c.id === conn.id ? {
          ...c, status: 'error' as const, error,
        } : c);
        updateAutoConnectConnections(updated);
        return updated;
      });
    });
    poller.start(10000);
    pollersRef.current.set(conn.id, poller);

    setSessionsTick(t => t + 1);
  }, [shouldSkipOpenSwanConnectionAttempt]);

  const disconnectOne = useCallback((connId: string) => {
    const poller = pollersRef.current.get(connId);
    if (poller) { poller.stop(); pollersRef.current.delete(connId); }
    sessionsRef.current.delete(connId);
    setConnections(prev => {
      const updated = prev.map(c => c.id === connId ? {
        ...c, status: 'disconnected' as const, error: undefined, sessionCount: undefined, agentIds: undefined,
      } : c);
      updateAutoConnectConnections(updated);
      return updated;
    });
    setSessionsTick(t => t + 1);
  }, []);

  const handleAddConnection = useCallback(async (conn: AgentConnection) => {
    setConnections(prev => {
      // Upsert: replace if same ID exists (edit mode), otherwise append
      const exists = prev.some(c => c.id === conn.id);
      const updated = exists
        ? prev.map(c => c.id === conn.id ? conn : c)
        : [...prev, conn];
      saveConnections(updated);
      updateAutoConnectConnections(updated);
      return updated;
    });
    // Auto-connect
    connectOne(conn);
  }, [connectOne]);

  const handleRemoveConnection = useCallback(async (id: string) => {
    disconnectOne(id);
    setConnections(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveConnections(updated);
      updateAutoConnectConnections(updated);
      return updated;
    });
  }, [disconnectOne]);

  const handleConnectConnection = useCallback((id: string) => {
    const conn = connections.find(c => c.id === id);
    if (conn) connectOne(conn);
  }, [connections, connectOne]);

  const handleDisconnectConnection = useCallback((id: string) => {
    disconnectOne(id);
  }, [disconnectOne]);

  const handleReconnectAll = useCallback(() => {
    // Reconnect all enabled connections that aren't already connected
    const toReconnect = connections.filter(c => c.enabled && c.status !== 'connected' && c.status !== 'connecting');
    
    if (toReconnect.length > 0) {
      toReconnect.forEach(conn => connectOne(conn));
    }
  }, [connections, connectOne]);

  const getConnectionConfig = useCallback((id: string): OpenSwanConfig | null => {
    const conn = connections.find(c => c.id === id && c.status === 'connected');
    if (!conn) return null;
    return { endpoint: conn.endpoint, token: conn.token };
  }, [connections]);

  // Helper: push partial office preferences to Supabase (merges into existing JSONB)
  // Serialized via promise chain to prevent lost-update races between concurrent writes
  const prefQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pushOfficePreferences = useCallback((partial: Record<string, unknown>) => {
    if (!_profileHasOfficePreferences) return;
    prefQueueRef.current = prefQueueRef.current.then(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase.from('profiles')
          .select('office_preferences').eq('id', user.id).single();
        // Only disable sync for schema-missing errors (column doesn't exist), not transient ones
        if (error) {
          if (isMissingProfileColumnError(error)) {
            _profileHasOfficePreferences = false;
          }
          return;
        }
        const current = (data?.office_preferences || {}) as Record<string, unknown>;
        const merged = { ...current, ...partial, updatedAt: Date.now() };
        const { error: e2 } = await supabase.from('profiles')
          .update({ office_preferences: merged }).eq('id', user.id);
        if (e2 && isMissingProfileColumnError(e2)) {
          _profileHasOfficePreferences = false;
        }
      } catch {}
    });
  }, []);

  // ─── Telegram handlers ──────────────────────────────

  const handleTelegramConnect = useCallback(async () => {
    const { botToken, chatId } = telegramConfig;
    if (!botToken.trim()) { setTelegramError('Bot token is required'); return; }
    setTelegramConnecting(true);
    setTelegramError(null);

    const botResult = await verifyBot(botToken.trim());
    if (!botResult.ok) {
      setTelegramError(botResult.error || 'Invalid bot token');
      setTelegramConnecting(false);
      return;
    }
    setTelegramBotName(botResult.bot?.username || null);

    if (chatId.trim()) {
      const chatResult = await getChat(botToken.trim(), chatId.trim());
      if (chatResult.ok) setTelegramChatTitle(chatResult.title || null);
      else setTelegramChatTitle(null);
    }

    if (tgPollerRef.current) tgPollerRef.current.stop();
    const poller = new TelegramPoller(botToken.trim(), (msgs) => {
      setTelegramMessages(prev => [...msgs, ...prev].slice(0, 50));
    });
    poller.start(5000);
    tgPollerRef.current = poller;

    setTelegramConnected(true);
    setTelegramConnecting(false);

    const tgData = { botToken: botToken.trim(), chatId: chatId.trim() };
    storage.setItem(STORAGE_KEY_TELEGRAM, JSON.stringify(tgData)).catch(() => {});
    pushOfficePreferences({ telegramConfig: tgData });
  }, [telegramConfig, pushOfficePreferences]);

  const handleTelegramDisconnect = useCallback(() => {
    if (tgPollerRef.current) { tgPollerRef.current.stop(); tgPollerRef.current = null; }
    setTelegramConnected(false);
    setTelegramBotName(null);
    setTelegramChatTitle(null);
    setTelegramMessages([]);
    setTelegramError(null);
    // Clear persisted credentials — both local storage and remote profile
    storage.removeItem(STORAGE_KEY_TELEGRAM).catch(() => {});
    pushOfficePreferences({ telegramConfig: null });
  }, [pushOfficePreferences]);

  // ─── Load saved connections on mount + auto-discover ──────────────
  // Agent detection (Claude Code bridge + OpenSwan) is handled by the app-level
  // agentAutoConnect singleton (started in App.tsx on auth). OfficeTab just
  // picks up the already-connected state and subscribes for updates.

  const floorsInitializedRef = useRef(false);
  const initRef = useRef<string | null>(null);
  useEffect(() => {
    if (initRef.current === circleId) return;
    initRef.current = circleId;
    appearancesLoadedRef.current = false;
    prefsLoadedRef.current = false;
    floorsInitializedRef.current = false;
    budgetLoadedRef.current = false;
    idleLoadedRef.current = false;
    remoteBudgetAppliedRef.current = false;
    remoteIdleAppliedRef.current = false;

    // Tell the auto-connect service which circle we're in (for DB publishing)
    setAutoConnectCircleId(circleId);

    // Reset Supabase column flags each mount — transient errors shouldn't
    // permanently disable sync for the rest of the session
    _profileHasOfficeLayout = true;
    _profileHasAgentAppearance = true;
    _profileHasOfficePreferences = true;

    (async () => {
      // ── Start localStorage reads immediately (don't wait for connections) ──
      const storagePromise = Promise.all([
        storage.getItem(STORAGE_KEY_AGENT_NAMES).catch(() => null),
        storage.getItem(STORAGE_KEY_TELEGRAM).catch(() => null),
        storage.getItem(STORAGE_KEY_FLOORS).catch(() => null),
        storage.getItem(STORAGE_KEY_FLOORS_TS).catch(() => null),
        storage.getItem(STORAGE_KEY_CURRENT_FLOOR).catch(() => null),
        storage.getItem(STORAGE_KEY_APPEARANCES).catch(() => null),
        storage.getItem(STORAGE_KEY_WHITEBOARD_NOTES).catch(() => null),
      ]);

      // ── Pick up pre-connected agents from the app-level singleton ──
      if (isAutoConnectRunning()) {
        const preConns = getAutoConnectConnections();
        const preSessions = getAutoConnectSessions();
        if (preConns.length > 0) {
          setConnections(preConns);
          if (__DEV__) console.log('[OfficeTab] Loaded', preConns.length, 'pre-connected agents from auto-connect');
        }
        // Copy sessions into our local ref
        for (const [key, sessions] of preSessions) {
          sessionsRef.current.set(key, sessions);
        }
        if (preSessions.size > 0) {
          setSessionsTick(t => t + 1);
        }
      } else {
        // Fallback: singleton hasn't started yet — do legacy load
        let conns = await loadConnections();
        const { discovered } = await autoDiscoverLocalAgents(conns);
        if (discovered) {
          const existingOpenSwan = conns.find(c => c.provider === 'openswan');
          if (existingOpenSwan?.token) {
            discovered.token = existingOpenSwan.token;
          }
          conns = [...conns, discovered];
          saveConnections(conns);
        }
        setConnections(conns);
        for (const conn of conns) {
          if (conn.enabled && !shouldSkipOpenSwanConnectionAttempt(conn)) connectOne(conn);
        }
        import('../../../lib/agentAutoConnect')
          .then((mod) => mod.startAgentAutoConnect())
          .catch(() => {});
      }

      // ── Subscribe to singleton updates so OfficeTab stays in sync ──
      // Merge rather than overwrite — prefer 'connected'/'connecting' status over stale singleton data
      const unsub = subscribeAutoConnect(() => {
        const latestConns = getAutoConnectConnections();
        const latestSessions = getAutoConnectSessions();
        setConnections(prev => {
          // Build map of singleton connections by id
          const singletonMap = new Map(latestConns.map(c => [c.id, c]));
          // Merge: if local has a connection that's connected/connecting but singleton says error/disconnected,
          // keep the local version (OfficeTab's connectOne is more authoritative)
          const merged = prev.map(local => {
            const singleton = singletonMap.get(local.id);
            if (!singleton) return local;
            // If local is actively connected/connecting, don't let stale singleton state override it
            if ((local.status === 'connected' || local.status === 'connecting') &&
                (singleton.status === 'error' || singleton.status === 'disconnected')) {
              return local;
            }
            return singleton;
          });
          // Add any connections from singleton that don't exist locally
          for (const sc of latestConns) {
            if (!merged.some(m => m.id === sc.id)) {
              merged.push(sc);
            }
          }
          return merged;
        });
        for (const [key, sessions] of latestSessions) {
          sessionsRef.current.set(key, sessions);
        }
        setSessionsTick(t => t + 1);
      });
      // Store unsubscribe for cleanup
      (initRef as any)._unsub = unsub;

      // ── Await localStorage reads (started earlier, runs in parallel with connections) ──
      const [namesRaw, tgRaw, floorsRaw, tsRaw, currentFloorRaw, appearancesRaw, notesRaw] = await storagePromise;

      // Apply local-only state immediately (agent names, telegram, whiteboard)
      const localAgentNames = namesRaw ? (() => { try { return JSON.parse(namesRaw) as Record<string, string>; } catch { return {}; } })() : {};
      const localTelegramConfig = tgRaw ? (() => { try { return JSON.parse(tgRaw) as { botToken?: string; chatId?: string }; } catch { return null; } })() : null;
      const localWhiteboardNotes = notesRaw ? (() => { try { return JSON.parse(notesRaw) as string[]; } catch { return []; } })() : [];
      if (Object.keys(localAgentNames).length > 0) setAgentNames(localAgentNames);
      if (tgRaw) try {
        const tg = localTelegramConfig || {};
        if (tg.botToken || tg.chatId) setTelegramConfig({ botToken: tg.botToken || '', chatId: tg.chatId || '' });
      } catch {}
      if (localWhiteboardNotes.length > 0) setWhiteboardNotes(localWhiteboardNotes);

      // Parse local floors
      let localFloors: OfficeFloor[] = [];
      let localCurrentFloorId = currentFloorRaw || '';
      let localUpdatedAt = 0;
      if (floorsRaw) try {
        const loaded = JSON.parse(floorsRaw) as OfficeFloor[];
        if (loaded.length > 0) localFloors = loaded;
      } catch {}
      if (tsRaw) localUpdatedAt = parseInt(tsRaw, 10) || 0;

      // Parse local appearances
      const localAppearances = appearancesRaw ? (() => { try { return JSON.parse(appearancesRaw); } catch { return {}; } })() : {};

      // Apply local state immediately so the Office shell can paint from the
      // fast path while remote profile merges continue in the background.
      setAppearances(localAppearances);
      if (localFloors.length > 0) setFloors(localFloors);
      if (localCurrentFloorId) setCurrentFloorId(localCurrentFloorId);
      markOfficeReady();

      // ── Single getUser() call + parallel Supabase profile queries ──
      let bestFloors = localFloors;
      let bestFloorId = localCurrentFloorId;
      let remotePrefsRecord: Record<string, unknown> | null = null;
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          // Fetch all profile columns in parallel (wrap builders so TS sees Promise)
          const layoutP = _profileHasOfficeLayout
            ? supabase.from('profiles').select('office_layout').eq('id', authUser.id).single().then(r => r)
            : Promise.resolve({ data: null, error: null } as any);
          const appearanceP = _profileHasAgentAppearance
            ? supabase.from('profiles').select('agent_appearance').eq('id', authUser.id).single().then(r => r)
            : Promise.resolve({ data: null, error: null } as any);
          const prefsP = _profileHasOfficePreferences
            ? supabase.from('profiles').select('office_preferences').eq('id', authUser.id).single().then(r => r)
            : Promise.resolve({ data: null, error: null } as any);

          const [layoutRes, appearanceRes, prefsRes] = await Promise.all([layoutP, appearanceP, prefsP]);

          // Merge floors
          if (layoutRes.error) {
            if (isMissingProfileColumnError(layoutRes.error)) _profileHasOfficeLayout = false;
          } else if (layoutRes.data?.office_layout) {
            const remote = layoutRes.data.office_layout as { floors?: OfficeFloor[]; currentFloorId?: string; updatedAt?: number };
            if (remote?.floors && remote.floors.length > 0) {
              const remoteUpdatedAt = remote.updatedAt || 0;
              let useRemote = false;
              if (remoteUpdatedAt > localUpdatedAt) {
                useRemote = true;
              } else if (remoteUpdatedAt === localUpdatedAt) {
                const localItems = localFloors.reduce((n, f) => n + (f.furniture?.length || 0), 0);
                const remoteItems = remote.floors.reduce((n, f) => n + (f.furniture?.length || 0), 0);
                if (remoteItems > localItems) useRemote = true;
              }
              if (useRemote) {
                bestFloors = remote.floors;
                bestFloorId = remote.currentFloorId || localCurrentFloorId;
              }
            }
          }

          // Merge appearances — always call setAppearances so downstream
          // auto-assignment logic can populate missing agents
          if (appearanceRes.error) {
            if (isMissingProfileColumnError(appearanceRes.error)) _profileHasAgentAppearance = false;
          } else {
            const remoteApp = appearanceRes.data?.agent_appearance || {};
            setAppearances({ ...localAppearances, ...remoteApp });
          }

          // Merge office preferences (agent names, telegram, whiteboard)
          if (prefsRes.error) {
            if (isMissingProfileColumnError(prefsRes.error)) _profileHasOfficePreferences = false;
          } else if (prefsRes.data?.office_preferences) {
            remotePrefsRecord = prefsRes.data.office_preferences as Record<string, unknown>;
            const remote = prefsRes.data.office_preferences as {
              agentNames?: Record<string, string>;
              telegramConfig?: { botToken?: string; chatId?: string };
              whiteboardNotes?: string[];
              budgetConfig?: BudgetConfig;
              idleConfig?: IdleBehaviorConfig;
              agentFilterMode?: AgentFilterMode;
            };
            // Remote agent names override local (more durable)
            if (remote.agentNames && Object.keys(remote.agentNames).length > 0) {
              const localNames = namesRaw ? (() => { try { return JSON.parse(namesRaw); } catch { return {}; } })() : {};
              setAgentNames({ ...localNames, ...remote.agentNames });
            }
            // Remote telegram config overrides local
            if (remote.telegramConfig?.botToken || remote.telegramConfig?.chatId) {
              setTelegramConfig({
                botToken: remote.telegramConfig.botToken || '',
                chatId: remote.telegramConfig.chatId || '',
              });
            }
            // Remote whiteboard notes override local if non-empty
            if (remote.whiteboardNotes && remote.whiteboardNotes.length > 0) {
              setWhiteboardNotes(remote.whiteboardNotes);
            }
            // Remote budget config — overrides local. Set the loaded ref
            // BEFORE setBudgetConfig so the save useEffect doesn't fire
            // and re-write what we just loaded.
            if (remote.budgetConfig && typeof remote.budgetConfig === 'object') {
              remoteBudgetAppliedRef.current = true;
              budgetLoadedRef.current = true;
              setBudgetConfig(remote.budgetConfig);
            }
            // Remote idle behavior config — same load-then-flag dance.
            if (remote.idleConfig && typeof remote.idleConfig === 'object') {
              remoteIdleAppliedRef.current = true;
              idleLoadedRef.current = true;
              setIdleConfig(remote.idleConfig);
              idleConfigRef.current = remote.idleConfig;
            }
            // Agent filter mode (which subset of agents the user
            // wants to see — mine / all / active / bonded).
            if (remote.agentFilterMode &&
                ['all', 'mine', 'active', 'bonded'].includes(remote.agentFilterMode)) {
              setAgentFilterMode(remote.agentFilterMode);
              try { window.localStorage?.setItem('uc_office_agent_filter_v1', remote.agentFilterMode); } catch {}
            }
          }

          // ── Seed-up: if the columns became available this session but
          //    the server has no copy yet, push the local snapshot up so
          //    the user doesn't have to touch anything to back up. Covers
          //    the case where the user customized for weeks while the
          //    migration was missing — first reload after applying it
          //    now syncs without any further user action.
          const serverLayout = layoutRes.data?.office_layout as { floors?: OfficeFloor[] } | null | undefined;
          const serverHasNoLayout = _profileHasOfficeLayout &&
            (!serverLayout || !serverLayout.floors || serverLayout.floors.length === 0);
          if (serverHasNoLayout && bestFloors.length > 0) {
            const seedLayout = { floors: bestFloors, currentFloorId: bestFloorId, updatedAt: Date.now() };
            const validation = validateOfficeLayout(seedLayout);
            if (validation.valid) {
              supabase.from('profiles')
                .update({ office_layout: validation.sanitizedLayout })
                .eq('id', authUser.id)
                .then(({ error }) => { if (error && isMissingProfileColumnError(error)) _profileHasOfficeLayout = false; });
            }
          }
          const serverApp = appearanceRes.data?.agent_appearance as Record<string, unknown> | null | undefined;
          const serverHasNoAppearance = _profileHasAgentAppearance &&
            (!serverApp || Object.keys(serverApp).length === 0);
          if (serverHasNoAppearance && Object.keys(localAppearances).length > 0) {
            supabase.from('profiles')
              .update({ agent_appearance: localAppearances })
              .eq('id', authUser.id)
              .then(({ error }) => { if (error && isMissingProfileColumnError(error)) _profileHasAgentAppearance = false; });
          }

          // Seed agent_identities table from localStorage if the table
          // was just created (migration just applied) and the user has
          // local identity data. Single round-trip, idempotent.
          seedIdentitiesIfServerEmpty().catch(() => {});
        }
      } catch {}

      appearancesLoadedRef.current = true;
      prefsLoadedRef.current = true;
      floorsInitializedRef.current = true;
      if (_profileHasOfficePreferences) {
        const seedPrefs: Record<string, unknown> = {};
        if (!remotePrefsRecord?.agentNames && Object.keys(localAgentNames).length > 0) {
          seedPrefs.agentNames = localAgentNames;
        }
        if (!remotePrefsRecord?.telegramConfig && (localTelegramConfig?.botToken || localTelegramConfig?.chatId)) {
          seedPrefs.telegramConfig = {
            botToken: localTelegramConfig.botToken || '',
            chatId: localTelegramConfig.chatId || '',
          };
        }
        if (!remotePrefsRecord?.whiteboardNotes && localWhiteboardNotes.length > 0) {
          seedPrefs.whiteboardNotes = localWhiteboardNotes;
        }
        if (!remotePrefsRecord?.agentFilterMode && agentFilterMode !== 'all') {
          seedPrefs.agentFilterMode = agentFilterMode;
        }
        if (Object.keys(seedPrefs).length > 0) pushOfficePreferences(seedPrefs);
      }

      // Apply floors
      if (bestFloors.length > 0) setFloors(bestFloors);
      if (bestFloorId) setCurrentFloorId(bestFloorId);

      // ── Fire remaining async loads after first paint / idle time ──
      const cancelDeferredEnrichment = runWhenIdle(() => {
        Promise.all([
          loadSessionTags(),
          loadCachedTags(),
        ]).then(([primaryTags, cachedTags]) => {
          const merged = new Map(cachedTags);
          primaryTags.forEach((tags, key) => { merged.set(key, tags); });
          setSessionTags(merged);
        }).catch(() => {});

        loadBudgetConfig().then(cfg => {
          if (!remoteBudgetAppliedRef.current) setBudgetConfig(cfg);
          budgetLoadedRef.current = true;
        }).catch(() => { budgetLoadedRef.current = true; });
        loadIdleConfig().then(cfg => {
          if (!remoteIdleAppliedRef.current) {
            setIdleConfig(cfg);
            idleConfigRef.current = cfg;
          }
          idleLoadedRef.current = true;
        }).catch(() => { idleLoadedRef.current = true; });
      }, 350);

      (initRef as any)._cancelDeferredEnrichment = cancelDeferredEnrichment;
    })();

    return () => {
      (initRef as any)._cancelDeferredEnrichment?.();
      (initRef as any)._unsub?.();
    };
    // This boot path owns long-lived subscriptions/pollers. Re-running it
    // for callback identity churn tears down the office runtime, so only
    // restart when the actual circle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId]);

  // Cleanup pollers on unmount
  useEffect(() => {
    return () => {
      pollersRef.current.forEach(p => p.stop());
      pollersRef.current.clear();
      if (tgPollerRef.current) tgPollerRef.current.stop();
    };
  }, [circleId]);

  // ─── Floor management (must be defined before useEffects that use it) ──────

  // Auto-persist floors to localStorage + Supabase whenever they change
  useEffect(() => {
    if (!floorsInitializedRef.current) return; // skip first render with defaults
    const now = Date.now();
    storage.setItem(STORAGE_KEY_FLOORS, JSON.stringify(floors)).catch(() => {});
    storage.setItem(STORAGE_KEY_FLOORS_TS, now.toString()).catch(() => {});
    // Async push to Supabase (skip if column doesn't exist)
    if (_profileHasOfficeLayout) {
      const layoutData = { floors, currentFloorId, updatedAt: now };
      const validation = validateOfficeLayout(layoutData);
      if (!validation.valid) {
        console.warn('[OfficeTab] Layout validation failed, skipping save:', validation.errors);
      } else {
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) {
            supabase.from('profiles').update({
              office_layout: validation.sanitizedLayout
            }).eq('id', user.id).then(
              ({ error }) => { if (error && isMissingProfileColumnError(error)) _profileHasOfficeLayout = false; },
              () => {},
            );
          }
        }).catch(() => {});
      }
    }
  }, [floors, currentFloorId]);

  const { width: winW } = useWindowDimensions();
  const isDesktop = winW > 900;

  // Get current floor data with safety checks (must be before agent filtering)
  const matchedFloor = floors.find(f => f.id === currentFloorId);
  const currentFloor = matchedFloor || floors[0] || DEFAULT_FLOORS[0];
  const currentThemeId = currentFloor?.themeId || 'underground';
  const currentTheme = useMemo(() => resolveTheme(currentThemeId), [resolveTheme, currentThemeId]);

  // Fix stale currentFloorId that doesn't match any floor
  useEffect(() => {
    if (!matchedFloor && floors.length > 0) {
      const correctId = floors[0].id;
      setCurrentFloorId(correctId);
      storage.setItem(STORAGE_KEY_CURRENT_FLOOR, correctId).catch(() => {});
    }
  }, [matchedFloor, floors]);

  // Derive agents from ALL connected sessions
  const connectedConns = connections.filter(c => c.status === 'connected');
  const anyConnected = connectedConns.length > 0;

  const rawAgents: OfficeAgent[] = [];
  const seenSessionIds = new Set<string>();
  let indexOffset = 0;
  for (const conn of connectedConns) {
    const sessions = sessionsRef.current.get(conn.id) || [];
    const connAgents = sessionsToAgents(sessions, conn.id, conn.name, conn.provider);
    for (const a of connAgents) {
      if (!seenSessionIds.has(a.sessionKey)) {
        seenSessionIds.add(a.sessionKey);
        rawAgents.push(a);
      }
    }
    indexOffset += connAgents.length;
  }
  // Merge auto-detected sessions — deduplicate by sessionKey to prevent duplicates
  // when the same bridge is connected both manually and via auto-detect
  const autoKeys = ['claude-code-auto', 'codex-auto', 'gemini-cli-auto', 'cursor-auto'] as const;
  for (const key of autoKeys) {
    const autoAgents = sessionsRef.current.get(key) as unknown as OfficeAgent[] | undefined;
    if (autoAgents && autoAgents.length > 0) {
      for (const a of autoAgents) {
        if (!seenSessionIds.has(a.sessionKey)) {
          seenSessionIds.add(a.sessionKey);
          rawAgents.push(a);
        }
      }
    }
  }

  // Merge DB-backed agents that have no corresponding live session
  // Only show if active within the last 2 hours — stale agents are hidden
  // Skip if a live agent already exists for this provider (prevents ghost duplicates)
  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
  const now = Date.now();
  const liveAgentNames = new Set(rawAgents.map(a => a.name));
  const liveProviders = new Set(rawAgents.map(a => a.providerType));
  const myDbAgents = mergedCircleAgents.filter(a => {
    if (a.ownerId !== currentUserId) return false;
    if (liveAgentNames.has(a.name)) return false;
    // Skip if there's already a live agent for this provider type
    if (a.provider && liveProviders.has(a.provider as any)) return false;
    // Filter out stale agents — if no lastActiveAt or too old, hide them
    if (!a.lastActiveAt) return false;
    const age = now - new Date(a.lastActiveAt).getTime();
    return age < STALE_THRESHOLD_MS;
  });
  for (const dbAgent of myDbAgents) {
    rawAgents.push({
      id: `db::${dbAgent.id}`,
      name: dbAgent.name,
      role: dbAgent.provider || 'Agent',
      status: dbAgent.status,
      color: dbAgent.color,
      deskIndex: rawAgents.length,
      activity: dbAgent.currentTask || 'Idling',
      messagesProcessed: dbAgent.message_count_total || 0,
      uptimeHours: 0,
      uptime: '',
      lastActive: dbAgent.lastActiveAt || '',
      recentActions: [],
      recentMessages: [],
      costToday: dbAgent.estimated_cost_today || 0,
      costTotal: dbAgent.estimated_cost_total || 0,
      costWeek: 0,
      tokensUsed: dbAgent.token_usage_total || 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      newTokens: 0,
      turns: dbAgent.message_count_total || 0,
      sessionKey: dbAgent.id,
      model: 'unknown',
      connectionId: 'db-agent',
      connectionName: dbAgent.name,
      providerType: (dbAgent.provider || 'generic-agent') as ProviderType,
      spirit: dbAgent.spirit ?? undefined,
    });
  }

  // Enrich live agents with spirit + accumulated cost from their CircleOfficeAgent DB record
  const dbDataByKey = new Map(
    mergedCircleAgents
      .filter(a => a.ownerId === currentUserId)
      .map(a => [`${a.ownerId}::${a.name}`, a])
  );
  // Also index by provider for live agents with slug names (e.g. "Wandering Duckling" → claude-code)
  const dbDataByProvider = new Map(
    mergedCircleAgents
      .filter(a => a.ownerId === currentUserId && a.provider)
      .map(a => [a.provider!, a])
  );
  for (const agent of rawAgents) {
    const key = `${currentUserId}::${agent.name}`;
    const dbMatch = dbDataByKey.get(key) || dbDataByProvider.get(agent.providerType);
    if (dbMatch) {
      if (!agent.spirit && dbMatch.spirit) agent.spirit = dbMatch.spirit;
      // DB aggregates are durable; live bridge snapshots can reset on restart.
      agent.costToday = Math.max(agent.costToday || 0, dbMatch.estimated_cost_today || 0);
      agent.costTotal = Math.max(agent.costTotal || 0, dbMatch.estimated_cost_total || 0, agent.costToday || 0);
    }
  }

  // Apply custom names
  const allAgents = useMemo(() =>
    rawAgents.map(a => agentNames[a.id] ? { ...a, name: agentNames[a.id] } : a),
    [rawAgents, agentNames]
  );

  // Use enriched agents if available (has cached costs/tokens), fallback to fresh agents
  const userAgents = useMemo(() => {
    if (enrichedAgents.length === 0) {
      return allAgents.map(agent => applyIdentityToAgent(agent, getAgentIdentityByAgent(agentIdentities, agent)));
    }
    const enrichedById = new Map(enrichedAgents.map(agent => [agent.id, agent]));
    return allAgents.map(agent => {
      const enriched = enrichedById.get(agent.id);
      const identity = getAgentIdentityByAgent(agentIdentities, agent);
      if (!enriched) return applyIdentityToAgent(agent, identity);
      const hydrated = applyIdentityToAgent({ ...enriched, ...agent }, identity);
      return {
        ...hydrated,
        recentActions: enriched.recentActions,
        recentMessages: enriched.recentMessages,
        cachedTokens: enriched.cachedTokens,
        newTokens: enriched.newTokens,
      };
    });
  }, [agentIdentities, allAgents, enrichedAgents]);

  useEffect(() => {
    enrichedAgentsRef.current = userAgents;
  }, [userAgents]);

  useEffect(() => {
    if (!isDesktop) return;
    const warmModules = () => {
      if (!whiteboardModule) import('./office/Whiteboard').then(setWhiteboardModule).catch(() => {});
      if (!serverRackModule) import('./office/ServerRack').then(setServerRackModule).catch(() => {});
    };
    const idleHost = globalThis as any;
    if (typeof idleHost.requestIdleCallback === 'function') {
      const id = idleHost.requestIdleCallback(() => warmModules(), { timeout: 700 });
      return () => {
        if (typeof idleHost.cancelIdleCallback === 'function') idleHost.cancelIdleCallback(id);
      };
    }
    const timeoutId = setTimeout(warmModules, 180);
    return () => clearTimeout(timeoutId);
  }, [isDesktop, whiteboardModule, serverRackModule]);

  useEffect(() => {
    if (terminalSize === 'closed' || officeTerminalModule) return;
    import('../../../components/OfficeTerminal').then(setOfficeTerminalModule).catch(() => {});
  }, [terminalSize, officeTerminalModule]);

  const refreshAgentIdentities = useCallback(async () => {
    try {
      setAgentIdentities(await loadAgentIdentities());
    } catch {}
  }, []);

  const userAgentsStatusKey = useMemo(() => JSON.stringify(userAgents.map(agent => [
    agent.id,
    agent.status,
    agent.lastActive || '',
    agent.messagesProcessed || 0,
    agent.turns || 0,
  ])), [userAgents]);
  const userAgentsMetricsKey = useMemo(() => JSON.stringify(userAgents.map(agent => [
    agent.id,
    agent.status,
    agent.lastActive || '',
    agent.messagesProcessed || 0,
    agent.turns || 0,
    agent.costToday || 0,
    agent.costWeek || 0,
    agent.tokensUsed || 0,
    agent.inputTokens || 0,
    agent.outputTokens || 0,
  ])), [userAgents]);
  const displayAgents = useMemo(() => {
    const roster = buildOfficeRoster({
      agents: userAgents,
      currentUserId,
      circleAgents: mergedCircleAgents,
      connections,
      identities: agentIdentities,
      selectedAgentId: selectedAgent?.id || null,
    });
    // O8: synthetic pinned agents (OpenSwan; HuggingSwan if ever re-pinned)
    // have no session/bridge feeding their status, so mid-task they'd keep a
    // static default. Live agent_runs rows are authoritative evidence of work
    // (the Building-Now board renders the same nodes), so UPGRADE-only:
    // idle → building/active, building → active, activity → "Working: <run>".
    // No evidence and offline/error rows pass through untouched — see
    // officeOpsBoard.deriveSyntheticAgentStatusFromRuns (mirror image of the
    // O2 demote-only reconcile). Name matching uses the same lowercased
    // agentName seam as opsRunNodesByAgent.
    if (opsRunNodesByAgent.size === 0) return roster;
    const nowMs = Date.now();
    return roster.map((agent) => {
      if (!agent.isSynthetic) return agent;
      const nameKeys =
        agent.id === DEFAULT_AGENT.id ? OPENSWAN_RUN_NAME_KEYS
        : agent.id === HUGGINGSWAN_AGENT.id ? HUGGINGSWAN_RUN_NAME_KEYS
        : null;
      if (!nameKeys) return agent;
      const nodes = nameKeys.flatMap((key) => opsRunNodesByAgent.get(key) ?? []);
      const upgrade = applySyntheticAgentStatusUpgrade(
        agent.status,
        deriveSyntheticAgentStatusFromRuns(nameKeys, nodes, nowMs),
      );
      if (!upgrade.changed) return agent;
      return { ...agent, status: upgrade.status, activity: upgrade.activity ?? agent.activity };
    });
  }, [userAgents, currentUserId, mergedCircleAgents, connections, agentIdentities, selectedAgent?.id, opsRunNodesByAgent]);

  // Precompute filter counts so every chip can show its hit count inline.
  // `mine` is bridge-pushed agents owned by the current user plus the default
  // OpenSwan (which conceptually belongs to every user who looks at it).
  // `bonded` is circle_office_agents rows — anything persisted vs synthetic.
  const agentFilterCounts = useMemo(() => {
    const isMine = (a: OfficeAgent) => (
      a.id === DEFAULT_AGENT.id
      || (a as any).ownerId === currentUserId
      || (currentUserId && mergedCircleAgents.find(c => c.name === a.name && (c as any).ownerId === currentUserId))
    );
    const isBonded = (a: OfficeAgent) => !a.isSynthetic || a.id === DEFAULT_AGENT.id;
    const isActive = (a: OfficeAgent) => a.status === 'active' || a.status === 'building';
    return {
      all: displayAgents.length,
      mine: displayAgents.filter(isMine).length,
      active: displayAgents.filter(isActive).length,
      bonded: displayAgents.filter(isBonded).length,
    };
  }, [displayAgents, currentUserId, mergedCircleAgents]);

  const filteredDisplayAgents = useMemo(() => {
    if (agentFilterMode === 'all') return displayAgents;
    if (agentFilterMode === 'mine') {
      return displayAgents.filter(a => (
        a.id === DEFAULT_AGENT.id
        || (a as any).ownerId === currentUserId
        || (currentUserId && mergedCircleAgents.find(c => c.name === a.name && (c as any).ownerId === currentUserId))
      ));
    }
    if (agentFilterMode === 'active') {
      return displayAgents.filter(a => a.status === 'active' || a.status === 'building');
    }
    if (agentFilterMode === 'bonded') {
      return displayAgents.filter(a => !a.isSynthetic || a.id === DEFAULT_AGENT.id);
    }
    return displayAgents;
  }, [displayAgents, agentFilterMode, currentUserId, mergedCircleAgents]);
  const WhiteboardView = whiteboardModule?.default;
  const ServerRackView = serverRackModule?.default;
  const OfficeTerminalView = officeTerminalModule?.default;

  // Resolve appearance — lookup by id, name, then legacy provider names
  const PROVIDER_LEGACY_NAMES_LOOKUP: Record<string, string[]> = {
    'claude-code': ['Claude Code', 'CC', 'C3PO'],
    'cursor': ['Cursor'],
    'codex': ['Codex'],
    'gemini': ['Gemini', 'Gemini CLI'],
  };
  const getAppearance = useCallback((agent: OfficeAgent) => {
    const identityKey = getAgentIdentityKey(agent);
    const identityAppearance = agentIdentities.get(identityKey)?.appearance;
    if (agent.id === DEFAULT_AGENT.id) {
      return appearances[agent.id] || appearances[identityKey] || identityAppearance || appearances[agent.name] || UC_AGENT_APPEARANCE;
    }
    let result = appearances[agent.id] || appearances[identityKey] || identityAppearance || appearances[agent.name];
    if (!result && agent.providerType) {
      const legacyNames = PROVIDER_LEGACY_NAMES_LOOKUP[agent.providerType] || [];
      for (const ln of legacyNames) {
        if (appearances[ln]) { result = appearances[ln]; break; }
      }
    }
    return result;
  }, [agentIdentities, appearances]);

  // Auto-assign random outfits to new agents + backfill pets/auras for existing agents
  useEffect(() => {
    if (!appearancesLoadedRef.current) return;
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const petPool: AgentAppearance['pet'][] = ['cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones'];
    const auraPool: AgentAppearance['aura'][] = ['fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'];
    // Legacy provider-name fallbacks for appearance lookup
    const PROVIDER_LEGACY_NAMES: Record<string, string[]> = {
      'claude-code': ['Claude Code', 'CC', 'C3PO'],
      'cursor': ['Cursor'],
      'codex': ['Codex'],
      'gemini': ['Gemini', 'Gemini CLI'],
    };
    const updates: Record<string, AgentAppearance> = {};
    for (const agent of userAgents) {
      // Check by id first, then name, then legacy provider names
      const identityKey = getAgentIdentityKey(agent);
      let existing = appearances[agent.id] || appearances[identityKey] || appearances[agent.name];
      if (!existing && agent.providerType) {
        const legacyNames = PROVIDER_LEGACY_NAMES[agent.providerType] || [];
        for (const ln of legacyNames) {
          if (appearances[ln]) { existing = appearances[ln]; break; }
        }
      }
      if (!existing) {
        const generated = generateRandomAppearance();
        updates[agent.id] = generated;
        updates[identityKey] = generated;
      } else {
        // Migrate legacy name/session-key keyed appearance to id-keyed and identity-keyed
        if (!appearances[agent.id] && (appearances[agent.name] || appearances[identityKey])) {
          updates[agent.id] = existing;
        }
        if (!appearances[identityKey]) {
          updates[identityKey] = existing;
        }
        // Backfill: give existing agents a pet/aura if they don't have one
        let changed = false;
        const patched = { ...existing };
        if (!existing.pet || existing.pet === 'none') {
          patched.pet = pick(petPool);
          changed = true;
        }
        if (!existing.aura || existing.aura === 'none') {
          patched.aura = pick(auraPool);
          changed = true;
        }
        if (changed) {
          updates[agent.id] = patched;
          updates[identityKey] = patched;
        }
      }
    }
    if (Object.keys(updates).length > 0) {
      setAppearances(prev => ({ ...prev, ...updates }));
    }
  }, [userAgents.map(a => a.id).join(',')]); // re-run only when agent list changes

  // ─── Reward tracking — award points as agent turns accumulate ──────────
  const { points: userPoints } = useUserRewards(userId);
  const userXp = userPoints?.lifetime_points ?? 0;
  const nextBadge = getNextBadge(userXp);
  const xpNext = nextBadge?.pointsRequired ?? 100;

  // Track ALL agents' turns — every bot earns XP for the user
  useAllAgentPointsTracker(
    userId,
    userAgents,
    (newBadges) => {
      if (newBadges.length > 0) {
        setCelebrationBadge(newBadges[0]);
        setDancingAgentId('all');
        setTimeout(() => setDancingAgentId(null), 5000);
      }
    },
  );

  // Filter agents for current floor using explicit per-floor assignments.
  const agents = useMemo(() => {
    const floorIds = currentFloor?.agentIds;
    const hasAnyAssignments = floors.some(f => (f.agentIds?.length || 0) > 0);
    if (!hasAnyAssignments) {
      return displayAgents.slice(0, OFFICE_DESK_POSITIONS.length);
    }
    if (!floorIds || floorIds.length === 0) return [];
    const onFloor = new Set(floorIds);
    // displayAgents is already sorted by the new rules: working-first, then
    // BlackSwan, then Claude Code, then others. Preserve that order for the
    // floor subset — no re-sort needed.
    return displayAgents.filter(a => onFloor.has(a.id)).slice(0, OFFICE_DESK_POSITIONS.length);
  }, [displayAgents, currentFloor?.agentIds, floors]);

  // Auto-distribute agents across floors by desk capacity so each floor gets a unique roster.
  const prevAgentLayoutKeyRef = useRef('');
  useEffect(() => {
    if (displayAgents.length === 0 || floors.length === 0) return;
    const orderedFloors = [...floors].sort((a, b) => a.order - b.order);
    const capacity = OFFICE_DESK_POSITIONS.length;
    const nextAssignments = new Map<string, string[]>();
    orderedFloors.forEach((floor, index) => {
      const start = index * capacity;
      nextAssignments.set(floor.id, displayAgents.slice(start, start + capacity).map(agent => agent.id));
    });
    const layoutKey = orderedFloors.map(floor => `${floor.id}:${(nextAssignments.get(floor.id) || []).join(',')}`).join('|');
    if (layoutKey === prevAgentLayoutKeyRef.current) return;
    prevAgentLayoutKeyRef.current = layoutKey;
    setFloors(prev => prev.map(floor => {
      const nextIds = nextAssignments.get(floor.id) || [];
      return JSON.stringify(floor.agentIds || []) === JSON.stringify(nextIds)
        ? floor
        : { ...floor, agentIds: nextIds };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAgents, floors]);

  // Update status history when agent state materially changes
  useEffect(() => {
    if (userAgents.length === 0) return;
    setStatusHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && JSON.stringify(last.map(agent => [
        agent.id,
        agent.status,
        agent.lastActive || '',
        agent.messagesProcessed || 0,
        agent.turns || 0,
      ])) === userAgentsStatusKey) {
        return prev;
      }
      return [...prev, userAgents].slice(-10);
    });
  }, [userAgentsStatusKey]);

  // Enrich agents with cached data + restore identity
  useEffect(() => {
    let cancelled = false;
    const cancelDeferred = runWhenIdle(() => {
      const doEnrich = async () => {
        if (allAgents.length === 0) {
          if (!cancelled) setEnrichedAgents([]);
          return;
        }

        try {
          const cacheEnriched = await enrichAgentsWithCache(allAgents);
          if (cancelled) return;
          const fullyEnriched = await restoreAllAgents(cacheEnriched);
          if (cancelled) return;
          const identities = await loadAgentIdentities();
          if (cancelled) return;
          setAgentIdentities(identities);
          setEnrichedAgents(fullyEnriched);

          Promise.all([
            ...fullyEnriched.map(agent => recordAgentActivity(agent)),
            takeSnapshot(fullyEnriched, sessionTags),
          ]).catch(() => {});
        } catch (error) {
          console.error('Failed to enrich agents:', error);
          if (!cancelled) setEnrichedAgents(allAgents);
        }
      };
      void doEnrich();
    }, 250);
    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, [sessionsTick, agentNames, sessionTags]);

  useEffect(() => {
    void refreshAgentIdentities();
  }, [refreshAgentIdentities]);

  // Enrich sessions for Cost Dashboard
  useEffect(() => {
    const allSessions: OpenSwanSession[] = [];
    const sortedConnections = [...connectedConns].sort((a, b) => a.id.localeCompare(b.id));

    for (const conn of sortedConnections) {
      const sessions = sessionsRef.current.get(conn.id) || [];
      allSessions.push(...sessions);
    }

    const normalizedSessions = [...allSessions].sort((a, b) => {
      const sessionCmp = (a.sessionKey || '').localeCompare(b.sessionKey || '');
      if (sessionCmp !== 0) return sessionCmp;
      const modelCmp = (a.model || '').localeCompare(b.model || '');
      if (modelCmp !== 0) return modelCmp;
      return (a.lastActivity || '').localeCompare(b.lastActivity || '');
    });

    const signature = JSON.stringify(normalizedSessions.map(session => [
      session.sessionKey,
      session.lastActivity || '',
      session.messageCount || 0,
      session.totalCost || 0,
      session.totalInputTokens || 0,
      session.totalOutputTokens || 0,
      session.cachedTokens || 0,
      session.newTokens || 0,
      session.model || '',
    ]));

    if (signature === enrichedSessionSignatureRef.current) return;
    enrichedSessionSignatureRef.current = signature;

    if (normalizedSessions.length === 0) {
      setEnrichedSessions([]);
      return;
    }

    let cancelled = false;
    const cancelDeferred = runWhenIdle(() => {
      enrichSessionsWithCache(normalizedSessions).then(enriched => {
        if (!cancelled) setEnrichedSessions(enriched);
      }).catch(err => {
        console.error('Failed to enrich sessions:', err);
        if (!cancelled) setEnrichedSessions(normalizedSessions); // Fallback to raw sessions
      });
    }, 250);
    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, [sessionsTick]); // Only re-run when sessions actually update

  // Combined 30-second sync: snapshot + DB token sync (single interval instead of two)
  useEffect(() => {
    if (userAgents.length === 0 || !circleId) return;

    const syncAll = async () => {
      if (!isDocumentVisible()) return;
      try {
        // 1. Save local snapshot
        await takeSnapshot(enrichedAgentsRef.current, sessionTagsRef.current).catch(() => {});
        // 2. Sync tokens to DB
        const agents = enrichedAgentsRef.current;
        for (const agent of agents) {
          if (agent.tokensUsed <= 0 && agent.messagesProcessed <= 0) continue;
          if (agent.connectionId === 'db-agent') continue;
          await syncAgentTokenSnapshot(
            circleId, agent.name, agent.inputTokens, agent.outputTokens,
            agent.cachedTokens, agent.turns || agent.messagesProcessed,
            agent.sessionCostToday ?? agent.costToday, agent.model, agent.sessionKey || agent.id,
          );
        }
      } catch {}
    };
    syncAll();
    const interval = setInterval(syncAll, 30000);
    let removeVisibilityListener: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void syncAll();
      };
      document.addEventListener('visibilitychange', onVisible);
      removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisible);
    }
    return () => {
      clearInterval(interval);
      removeVisibilityListener?.();
    };
  }, [userAgents.length > 0, circleId]);

  // Push agent stats to parent using the merged live + cached view
  useEffect(() => {
    if (onAgentStats && userAgents.length > 0) {
      onAgentStats({
        agentCount: userAgents.length,
        sessionCount: userAgents.filter(a => a.status === 'active' || a.status === 'building').length,
        costToday: userAgents.reduce((s, a) => s + a.costToday, 0),
        costWeek: userAgents.reduce((s, a) => s + a.costWeek, 0),
        tokens: userAgents.reduce((s, a) => s + a.tokensUsed, 0),
        tokensTotal: userAgents.reduce((s, a) => s + a.tokensUsed, 0),
        messagesTotal: userAgents.reduce((s, a) => s + a.messagesProcessed, 0),
        messagesToday: userAgents.reduce((s, a) => s + a.turns, 0),
        inputTokens: userAgents.reduce((s, a) => s + a.inputTokens, 0),
        outputTokens: userAgents.reduce((s, a) => s + a.outputTokens, 0),
      });
    }
  }, [userAgentsMetricsKey, onAgentStats]);

  // Save appearances when changed — localStorage + Supabase
  useEffect(() => {
    if (!appearancesLoadedRef.current) return; // skip until init is done
    storage.setItem(STORAGE_KEY_APPEARANCES, JSON.stringify(appearances)).catch(() => {});
    // Async push to Supabase (skip if column doesn't exist)
    if (_profileHasAgentAppearance && Object.keys(appearances).length > 0) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase.from('profiles').update({ agent_appearance: appearances }).eq('id', user.id).then(
            ({ error }) => { if (error && isMissingProfileColumnError(error)) _profileHasAgentAppearance = false; },
            () => {},
          );
        }
      }).catch(() => {});
    }
  }, [appearances]);

  // Save whiteboard notes when changed — localStorage + Supabase
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    storage.setItem(STORAGE_KEY_WHITEBOARD_NOTES, JSON.stringify(whiteboardNotes)).catch(() => {});
    pushOfficePreferences({ whiteboardNotes });
  }, [whiteboardNotes]);

  // Save budget config to office_preferences when it changes. Local
  // copy is already maintained by handleBudgetConfigChange via
  // saveBudgetConfig — this just adds the durable copy.
  useEffect(() => {
    if (!budgetLoadedRef.current) return;
    pushOfficePreferences({ budgetConfig });
  }, [budgetConfig, pushOfficePreferences]);

  // Save idle config to office_preferences when it changes.
  useEffect(() => {
    if (!idleLoadedRef.current) return;
    pushOfficePreferences({ idleConfig });
  }, [idleConfig, pushOfficePreferences]);

  // Save agent filter mode (mine / all / active / bonded) to
  // office_preferences too so the user's preferred view persists
  // across devices.
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    pushOfficePreferences({ agentFilterMode });
  }, [agentFilterMode, pushOfficePreferences]);

  // Fetch cron jobs from all connected OpenSwan instances
  const connectedCount = connections.filter(c => c.status === 'connected').length;
  useEffect(() => {
    if (!isDesktop || !whiteboardModule) return;
    if (connectedCount === 0) return;
    const fetchCron = async () => {
      const openswanConns = connections.filter(c => c.status === 'connected' && c.provider === 'openswan');
      if (openswanConns.length === 0) return; // skip if no OpenSwan connections
      const allJobs: CronJob[] = [];
      for (const conn of openswanConns) {
        const config: OpenSwanConfig = { endpoint: conn.endpoint, token: conn.token };
        try {
          if (!supportsOpenSwanToolRpcEndpoint(config.endpoint)) continue;
          const result = await listCronJobs(config);
          if (result.ok) allJobs.push(...result.jobs);
        } catch {} // endpoint may not support cron
      }
      setCronJobs(allJobs);
    };
    fetchCron();
    const interval = setInterval(fetchCron, 300_000); // 5 min — cron data changes rarely
    return () => clearInterval(interval);
  }, [connectedCount, isDesktop, whiteboardModule]);

  // Scale
  const availableW = winW - 24;
  const rawScale = availableW / OFFICE_FLOOR_WIDTH;
  const officeScale = Math.max(0.55, rawScale);
  const scaledH = OFFICE_FLOOR_HEIGHT * officeScale;
  const needsHScroll = rawScale < 0.55;

  const handleAgentPress = useCallback((agent: OfficeAgent, event?: any) => {
    if (editMode) return;
    // Capture click coordinates for pop-out animation origin (web only)
    if (Platform.OS === 'web' && event) {
      const x = event.nativeEvent?.pageX ?? event.pageX;
      const y = event.nativeEvent?.pageY ?? event.pageY;
      if (typeof x === 'number' && typeof y === 'number') {
        setPanelOrigin({ x, y });
      }
    }
    setSelectedAgent(prev => prev?.id === agent.id ? null : agent);
  }, [editMode]);

  const handleOpenAutomate = useCallback(() => {
    setTerminalInitialTab('automations');
    setTerminalSize('half');
  }, []);

  const handleRemovePublishedAgent = useCallback(async (agent: OfficeAgent) => {
    if (!circleId || !agent?.name) return;
    if (agent.id === 'default::blackswan') return; // OpenSwan can't be removed
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      // Find the DB row for this agent (look up by circle + owner + name).
      // Bridge agents publish themselves with the live name, so name is the
      // most reliable join key across both bridge-pushed and DB-managed rows.
      const { data: rows } = await supabase
        .from('circle_office_agents')
        .select('id, name')
        .eq('circle_id', circleId)
        .eq('owner_id', auth.user.id)
        .ilike('name', agent.name);
      const matched = rows ?? [];
      // Hide first so re-publishes from the bridge poller skip during deletion
      hideAgentInOffice(circleId, agent.name);
      if (matched.length > 0) {
        const ids = matched.map(r => r.id);
        const { error } = await supabase
          .from('circle_office_agents')
          .delete()
          .in('id', ids);
        if (error) {
          console.error('[OfficeTab] Failed to remove published agent:', error);
          return;
        }
        setCircleOfficeAgents(prev => prev.filter(a => !ids.includes(a.id)));
      }
      setSelectedAgent(null);
    } catch (err) {
      console.error('[OfficeTab] Remove agent error:', err);
    }
  }, [circleId]);

  const handleFloorPress = (x: number, y: number) => {
    if (!editMode) return;
    // If something is selected and user taps floor, deselect
    if (selectedFurnitureId) { setSelectedFurnitureId(null); return; }
    if (!placingType) return;
    const catalogEntry = FURNITURE_CATALOG.find(c => c.type === placingType);
    const newFurniture = {
      id: `f_${Date.now()}`, type: placingType as any, x, y,
      itemWidth: catalogEntry?.width, itemHeight: catalogEntry?.height,
    };
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? { ...f, furniture: [...f.furniture, newFurniture] } : f
    ));
    setPlacingType(null);
  };

  const handleFurniturePress = (id: string) => {
    if (!editMode) return;
    const currentFloor = floors.find(f => f.id === currentFloorId);
    const item = currentFloor?.furniture.find(f => f.id === id);
    // Check if it's an NFT frame — open picker on first tap
    if (item?.type === 'nft_frame' && selectedFurnitureId !== id) {
      setNftPickerTargetId(id);
      setSelectedFurnitureId(id);
      setImagePickerTab('upload');
      setNftPickerVisible(true);
      return;
    }
    // Connected items — open service connector on first tap
    const connectedTypes = ['smart_tv', 'spotify_jukebox', 'discord_hub', 'twitch_stream', 'video_call', 'crypto_ticker', 'github_feed', 'calendar_widget', 'world_clock', 'music_visualizer', 'figma_board', 'email_hub'];
    if (item && connectedTypes.includes(item.type) && selectedFurnitureId !== id) {
      setServiceModalTargetId(id);
      setSelectedFurnitureId(id);
      setServiceModalType(item.type);
      setServiceUrl(item.tvContentUrl || '');
      setServiceTvApp(item.tvApp || 'youtube');
      setServiceTvWidth(String(item.tvWidth || 120));
      setServiceTvHeight(String(item.tvHeight || 80));
      setServiceDiscordChannel(item.discordChannel || '');
      setServiceTwitchChannel(item.twitchChannel || '');
      setServiceCallProvider(item.videoCallProvider || 'zoom');
      setServiceCalendarProvider(item.calendarProvider || 'google');
      setServiceEmailProvider(item.emailProvider || 'outlook');
      setOauthStatus(null);
      setOauthError('');
      setOauthConnecting(false);
      setServiceModalVisible(true);
      // Check OAuth status for calendar/email items
      if (item.type === 'calendar_widget') {
        const prov = (item.calendarProvider === 'outlook' ? 'microsoft' : 'google') as OAuthProvider;
        checkOAuthStatus(prov).then(s => setOauthStatus(s)).catch(() => {});
      } else if (item.type === 'email_hub') {
        const prov = (item.emailProvider === 'gmail' ? 'google' : item.emailProvider === 'yahoo' ? 'yahoo' : 'microsoft') as OAuthProvider;
        checkOAuthStatus(prov).then(s => setOauthStatus(s)).catch(() => {});
      }
      return;
    }
    // Sticky note — open editor on first tap
    if (item?.type === 'stickynote' && selectedFurnitureId !== id) {
      setStickyEditorTargetId(id);
      setSelectedFurnitureId(id);
      setStickyText(item.noteText || '');
      setStickyColor(item.noteColor || '#fef08a');
      setStickyGifUrl(item.noteGifUrl || '');
      setStickyGifSearch('');
      setStickyTab('write');
      setStickyEditorVisible(true);
      return;
    }
    if (selectedFurnitureId === id) {
      // Second tap on selected item = delete it
      setFloors(prev => prev.map(f =>
        f.id === currentFloorId ? { ...f, furniture: f.furniture.filter(item => item.id !== id) } : f
      ));
      setSelectedFurnitureId(null);
    } else {
      // First tap = select it (shows delete button + enables drag)
      setSelectedFurnitureId(id);
    }
  };

  const loadUserNfts = async () => {
    setNftsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNftsLoading(false); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('wallet_address_eth, wallet_address_sol')
        .eq('id', user.id)
        .single();
      if (!profile) { setNftsLoading(false); return; }
      const allNfts: NFT[] = [];
      if (profile.wallet_address_sol) {
        const solNfts = await fetchNFTs(profile.wallet_address_sol, 'solana');
        allNfts.push(...solNfts);
      }
      if (profile.wallet_address_eth) {
        const ethNfts = await fetchNFTs(profile.wallet_address_eth, 'ethereum');
        allNfts.push(...ethNfts);
      }
      setUserNfts(allNfts);
    } catch (err) {
      console.error('Failed to load NFTs:', err);
    }
    setNftsLoading(false);
  };

  const handleNftSelect = (nft: NFT | null) => {
    if (!nftPickerTargetId) return;
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? {
        ...f,
        furniture: f.furniture.map(item =>
          item.id === nftPickerTargetId ? {
            ...item,
            nftMint: nft?.mint,
            nftImageUrl: nft?.image,
            nftName: nft?.name,
            nftChain: nft?.chain as any,
            imageSource: nft ? 'nft' as const : undefined,
          } : item
        ),
      } : f
    ));
    setNftPickerVisible(false);
    setNftPickerTargetId(null);
  };

  // ── Image upload handlers ─────────────────────────────────────────────────

  const resizeImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new (window as any).Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 200;
          let w = img.width, h = img.height;
          if (w > h) { if (w > MAX) { h = h * (MAX / w); w = MAX; } }
          else { if (h > MAX) { w = w * (MAX / h); h = MAX; } }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = (base64: string, name?: string) => {
    if (!nftPickerTargetId) return;
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? {
        ...f,
        furniture: f.furniture.map(item =>
          item.id === nftPickerTargetId ? {
            ...item,
            nftMint: undefined,
            nftImageUrl: base64,
            nftName: name || 'Uploaded Image',
            nftChain: undefined,
            imageSource: 'upload' as const,
          } : item
        ),
      } : f
    ));
    setNftPickerVisible(false);
    setNftPickerTargetId(null);
  };

  const handleFileInputChange = async (event: any) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    if (!file.type?.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;
    try {
      const base64 = await resizeImageToBase64(file);
      handleImageUpload(base64, file.name?.replace(/\.[^/.]+$/, ''));
    } catch (err) {
      console.error('Failed to process image:', err);
    }
    event.target.value = '';
  };

  // ── Sticky note save ─────────────────────────────────────────────────────

  const handleStickyNoteSave = () => {
    if (!stickyEditorTargetId) return;
    // Grab drawing from canvas if on draw tab
    let drawingData: string | undefined;
    if (stickyTab === 'draw' && stickyCanvasRef.current) {
      const canvas = stickyCanvasRef.current;
      // Check if canvas has any content (not all white)
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hasContent = imgData.data.some((v, i) => i % 4 === 3 && v > 0); // check alpha
        if (hasContent) drawingData = canvas.toDataURL('image/png');
      }
    }
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? {
        ...f,
        furniture: f.furniture.map(item =>
          item.id === stickyEditorTargetId ? {
            ...item,
            noteText: stickyText || undefined,
            noteColor: stickyColor,
            noteDrawing: drawingData || (stickyTab !== 'draw' ? item.noteDrawing : undefined),
            noteGifUrl: stickyGifUrl || undefined,
          } : item
        ),
      } : f
    ));
    setStickyEditorVisible(false);
    setStickyEditorTargetId(null);
  };

  const handleServiceSave = () => {
    if (!serviceModalTargetId) return;
    const updates: Record<string, any> = {};
    switch (serviceModalType) {
      case 'smart_tv':
        updates.tvApp = serviceTvApp;
        updates.tvContentUrl = serviceUrl || undefined;
        updates.tvWidth = parseInt(serviceTvWidth) || 120;
        updates.tvHeight = parseInt(serviceTvHeight) || 80;
        updates.tvPoweredOn = true;
        break;
      case 'spotify_jukebox':
        updates.spotifyConnected = true;
        updates.spotifyTrackName = 'Connected';
        updates.spotifyArtist = 'Spotify';
        updates.spotifyPlaying = false;
        break;
      case 'discord_hub':
        updates.discordConnected = true;
        updates.discordChannel = serviceDiscordChannel || 'general';
        updates.discordStatus = 'online';
        updates.discordMemberCount = 1;
        break;
      case 'twitch_stream':
        updates.twitchChannel = serviceTwitchChannel || 'stream';
        updates.twitchLive = true;
        updates.twitchViewers = 0;
        break;
      case 'video_call':
        updates.videoCallProvider = serviceCallProvider;
        updates.videoCallLink = serviceUrl || undefined;
        break;
      case 'calendar_widget':
        updates.calendarProvider = serviceCalendarProvider;
        // Real data is applied via OAuth callback above; this is fallback
        if (!oauthStatus?.connected) {
          updates.calendarEvent = 'Tap to refresh';
          updates.calendarTime = '';
          updates.calendarEvents = 0;
        }
        break;
      case 'email_hub':
        updates.emailProvider = serviceEmailProvider;
        // Real data is applied via OAuth callback above; this is fallback
        if (!oauthStatus?.connected) {
          updates.emailConnected = false;
        }
        break;
    }
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? {
        ...f,
        furniture: f.furniture.map(item =>
          item.id === serviceModalTargetId ? { ...item, ...updates } : item
        ),
      } : f
    ));
    setServiceModalVisible(false);
    setServiceModalTargetId(null);
  };

  const handleServiceOpen = (url: string) => {
    if (!url) return;
    // Validate URL protocol to prevent javascript:/data:/file: injection
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
    } catch {
      return; // Invalid URL
    }
    if (Platform.OS === 'web') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(url);
    }
  };

  const initStickyCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || stickyCanvasRef.current === canvas) return;
    stickyCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Load existing drawing if any
    const currentFloor = floors.find(f => f.id === currentFloorId);
    const item = currentFloor?.furniture.find(f => f.id === stickyEditorTargetId);
    if (item?.noteDrawing) {
      const img = new (window as any).Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = item.noteDrawing;
    }
    // Set up drawing
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    let drawing = false;
    let lastX = 0, lastY = 0;
    canvas.onpointerdown = (e) => {
      drawing = true;
      const rect = canvas.getBoundingClientRect();
      lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
      lastY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    canvas.onpointermove = (e) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastX = x;
      lastY = y;
    };
    canvas.onpointerup = () => { drawing = false; };
    canvas.onpointerleave = () => { drawing = false; };
  };

  const handleFurnitureMove = (id: string, x: number, y: number) => {
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? {
        ...f,
        furniture: f.furniture.map(item => item.id === id ? { ...item, x, y } : item),
      } : f
    ));
  };

  const handleFurnitureResize = (id: string, w: number, h: number) => {
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? {
        ...f,
        furniture: f.furniture.map(item => item.id === id ? { ...item, itemWidth: w, itemHeight: h } : item),
      } : f
    ));
  };

  const handleFurnitureItemUpdate = (id: string, fields: Partial<FurnitureItem>) => {
    setFloors(prev => prev.map(f =>
      f.id === currentFloorId ? {
        ...f,
        furniture: f.furniture.map(item => item.id === id ? { ...item, ...fields } : item),
      } : f
    ));
  };

  // ─── Interactive furniture handler ────────────────────────────────────────
  const handleFurnitureInteract = useCallback((id: string, type: FurnitureType) => {
    const currentFloor = floorsRef.current.find(f => f.id === currentFloorId);
    const item = currentFloor?.furniture.find(f => f.id === id);
    if (!item) return;

    const updateFurnitureField = (fields: Partial<FurnitureItem>) => {
      setFloors(prev => prev.map(f =>
        f.id === currentFloorId ? {
          ...f,
          furniture: f.furniture.map(fi => fi.id === id ? { ...fi, ...fields } : fi),
        } : f
      ));
    };

    const addFloorEffect = (effectType: string) => {
      const eff = { id: `eff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: effectType, x: item.x, y: item.y, createdAt: Date.now() };
      setFloorEffects(prev => [...prev, eff]);
    };

    switch (type) {
      case 'enter_key':
      case 'command_console':
        if (interactInputId === id) {
          setInteractInputId(null);
          setInteractInputText('');
          setInteractAgentTarget(null);
        } else {
          setInteractInputId(id);
          setInteractInputText('');
          setInteractAgentTarget(type === 'command_console' ? (displayAgents[0]?.id || null) : null);
        }
        break;

      case 'button_panel': {
        const presets = item.buttonPresets?.length ? item.buttonPresets : ['Status update', 'Ship it', 'Stand up'];
        const current = (item.jukeboxTrack || 0) % presets.length;
        const cmd = presets[current];
        updateFurnitureField({ jukeboxTrack: current + 1 });
        if (currentUserId && currentUserName) {
          sendTerminalCommand({
            circleId, senderId: currentUserId, senderName: currentUserName,
            commandText: cmd, targetAgentName: '@all',
          });
        }
        break;
      }

      case 'alarm_bell':
        addFloorEffect('shake');
        break;

      case 'launch_pad':
        addFloorEffect('rocket');
        if (currentUserId && currentUserName) {
          sendTerminalCommand({
            circleId, senderId: currentUserId, senderName: currentUserName,
            commandText: 'Ship it! 🚀', targetAgentName: '@all',
          });
        }
        break;

      case 'jukebox': {
        const tracks = ['Lo-fi Beats', 'Synthwave', 'Jazz Hop', 'Deep Focus', 'Ambient'];
        const next = ((item.jukeboxTrack || 0) + 1) % tracks.length;
        updateFurnitureField({ jukeboxTrack: next, label: tracks[next] });
        addFloorEffect('pulse');
        break;
      }

      case 'dice_roller': {
        const roll = Math.floor(Math.random() * 6) + 1;
        updateFurnitureField({ lastDiceRoll: roll });
        addFloorEffect('dice');
        break;
      }

      case 'gong':
        addFloorEffect('ripple');
        break;

      case 'confetti_cannon':
        addFloorEffect('confetti');
        break;

      case 'timer_display': {
        if (item.timerEnd && item.timerEnd > Date.now()) {
          updateFurnitureField({ timerEnd: undefined });
        } else {
          updateFurnitureField({ timerEnd: Date.now() + 25 * 60 * 1000 });
        }
        break;
      }

      case 'slot_machine': {
        const symbols = ['🍒', '🔔', '💎', '7️⃣', '⭐', '🍀'];
        const r1 = Math.floor(Math.random() * symbols.length);
        const r2 = Math.floor(Math.random() * symbols.length);
        const r3 = Math.floor(Math.random() * symbols.length);
        updateFurnitureField({ slotResult: [r1, r2, r3] });
        if (r1 === r2 && r2 === r3) {
          addFloorEffect('fireworks');
        }
        break;
      }

      case 'crystal_ball': {
        const fortunes = [
          'A merge conflict approaches...', 'The CI pipeline smiles upon you',
          'Beware of scope creep', 'A refactor brings clarity', 'Ship it and iterate',
          'The bug hides in the callback', 'Your PR will be approved swiftly',
          'An unexpected dependency update looms', 'Trust the types',
          'The linter knows the way', 'A deadline approaches faster than expected',
          'Your tests will save you today', 'Rubber duck debugging reveals all',
          'The docs were wrong all along', 'A senior dev reviews your code favorably',
          'Beware the off-by-one error', 'A production incident teaches wisdom',
          'The feature flag was on all along', 'Stack overflow has the answer',
          'Your branch name tells a story',
        ];
        updateFurnitureField({ fortuneText: fortunes[Math.floor(Math.random() * fortunes.length)] });
        addFloorEffect('pulse');
        break;
      }

      case 'mood_ring':
        addFloorEffect('pulse');
        break;

      case 'boom_box':
        updateFurnitureField({ boomboxPlaying: !item.boomboxPlaying });
        break;

      case 'lava_lamp': {
        const colors = ['#ef4444', '#22c55e', '#6366f1', '#f59e0b', '#a855f7', '#22d3ee', '#ffffff'];
        const currentIdx = colors.indexOf(item.lavaColor || '#ef4444');
        const nextColor = colors[(currentIdx + 1) % colors.length];
        updateFurnitureField({ lavaColor: nextColor });
        break;
      }

      case 'whack_a_mole':
        // Handled internally by the WhackAMoleItem component
        break;

      case 'fireplace': {
        const next = ((item.fireplaceIntensity ?? 1) + 1) % 3;
        updateFurnitureField({ fireplaceIntensity: next });
        addFloorEffect('pulse');
        break;
      }

      case 'aquarium': {
        // Feed the fish! They swim to the top excitedly
        updateFurnitureField({ aquariumFed: Date.now() });
        addFloorEffect('pulse');
        break;
      }

      case 'vinyl_player':
        updateFurnitureField({ vinylPlaying: !item.vinylPlaying });
        break;

      case 'rain_window':
        // Ambient — no interaction needed
        break;

      case 'galaxy_orb':
        addFloorEffect('pulse');
        break;

      case 'terrarium': {
        // Feed the creatures! They react excitedly
        updateFurnitureField({
          terrariumFed: Date.now(),
          terrariumCreature: ((item.terrariumCreature ?? 0) + 1) % 4,
        });
        addFloorEffect('pulse');
        break;
      }

      case 'zen_garden': {
        const next = ((item.zenPattern ?? 0) + 1) % 3;
        updateFurnitureField({ zenPattern: next });
        break;
      }

      case 'focus_candle':
        updateFurnitureField({ focusBurning: !item.focusBurning });
        break;

      case 'quote_board': {
        const nextQ = ((item.quoteIndex || 0) + 1) % 10;
        updateFurnitureField({ quoteIndex: nextQ });
        break;
      }

      case 'progress_bar': {
        const nextVal = ((item.progressValue || 0) + 10) % 110;
        updateFurnitureField({ progressValue: nextVal });
        if (nextVal === 100) addFloorEffect('confetti');
        break;
      }

      case 'hologram': {
        const next = ((item.hologramShape ?? 0) + 1) % 3;
        updateFurnitureField({ hologramShape: next });
        addFloorEffect('pulse');
        break;
      }

      case 'pixel_display': {
        const next = ((item.pixelScene ?? 0) + 1) % 4;
        updateFurnitureField({ pixelScene: next });
        break;
      }

      case 'spotify_jukebox': {
        if (!item.spotifyConnected) {
          // Open Spotify auth — for now toggle connected state to demo
          updateFurnitureField({
            spotifyConnected: true,
            spotifyTrackName: 'Lo-fi Beats',
            spotifyArtist: 'ChillHop',
            spotifyPlaying: true,
            spotifyProgress: 35,
          });
        } else {
          // Toggle playback
          updateFurnitureField({ spotifyPlaying: !item.spotifyPlaying });
          if (!item.spotifyPlaying) addFloorEffect('pulse');
        }
        break;
      }

      case 'discord_hub': {
        if (!item.discordConnected) {
          updateFurnitureField({
            discordConnected: true,
            discordChannel: 'general',
            discordStatus: 'online',
            discordMemberCount: 12,
          });
        } else {
          const statuses = ['online', 'idle', 'dnd', 'offline'];
          const curIdx = statuses.indexOf(item.discordStatus || 'online');
          updateFurnitureField({ discordStatus: statuses[(curIdx + 1) % statuses.length] });
        }
        break;
      }

      case 'video_call': {
        if (!item.videoCallActive) {
          const providers = ['zoom', 'meet', 'teams'];
          const curIdx = providers.indexOf(item.videoCallProvider || 'meet');
          const provider = providers[(curIdx + 1) % providers.length];
          updateFurnitureField({
            videoCallActive: true,
            videoCallProvider: provider,
            videoCallParticipants: Math.floor(Math.random() * 4) + 2,
          });
          addFloorEffect('pulse');
        } else {
          updateFurnitureField({ videoCallActive: false, videoCallParticipants: 0 });
        }
        break;
      }

      case 'message_board': {
        setPhoneVisible(true);
        break;
      }

      case 'smart_tv': {
        if (!item.tvPoweredOn) {
          updateFurnitureField({ tvPoweredOn: true, tvApp: item.tvApp || 'youtube' });
        } else {
          // For non-embeddable apps with a URL, open in new tab on tap
          const nonEmbeddable = ['netflix', 'hulu', 'disney'];
          if (nonEmbeddable.includes(item.tvApp || '') && item.tvContentUrl) {
            if (Platform.OS === 'web') {
              window.open(item.tvContentUrl, '_blank', 'noopener,noreferrer');
            } else {
              Linking.openURL(item.tvContentUrl);
            }
          } else {
            const apps = ['youtube', 'netflix', 'hulu', 'disney', 'twitch'];
            const curIdx = apps.indexOf(item.tvApp || 'youtube');
            updateFurnitureField({ tvApp: apps[(curIdx + 1) % apps.length] });
            addFloorEffect('pulse');
          }
        }
        break;
      }

      case 'weather_station': {
        const conditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
        const curIdx = conditions.indexOf(item.weatherCondition || 'sunny');
        const cities = ['New York', 'Tokyo', 'London', 'Paris', 'Sydney', 'Dubai', 'LA'];
        const temps: Record<string, number[]> = {
          sunny: [78, 85, 92], cloudy: [62, 68, 55], rainy: [48, 52, 58], snowy: [28, 32, 18],
        };
        const nextCond = conditions[(curIdx + 1) % conditions.length];
        const tempArr = temps[nextCond];
        updateFurnitureField({
          weatherCondition: nextCond,
          weatherTemp: tempArr[Math.floor(Math.random() * tempArr.length)],
          weatherCity: cities[Math.floor(Math.random() * cities.length)],
        });
        break;
      }

      case 'twitch_stream': {
        updateFurnitureField({
          twitchLive: !item.twitchLive,
          twitchChannel: item.twitchChannel || 'stream',
          twitchViewers: item.twitchLive ? 0 : Math.floor(Math.random() * 5000) + 100,
        });
        break;
      }

      case 'pomodoro_room': {
        if (item.pomodoroBreak) {
          updateFurnitureField({ pomodoroBreak: false, pomodoroMinutes: 25 });
        } else {
          updateFurnitureField({
            pomodoroBreak: true,
            pomodoroMinutes: 5,
            pomodoroSessions: (item.pomodoroSessions || 0) + 1,
          });
          addFloorEffect('confetti');
        }
        break;
      }

      case 'retro_console': {
        setEmulatorSystem(item.emulatorSystem || 'gba');
        setEmulatorVisible(true);
        break;
      }

      case 'scrabble_board': {
        setScrabbleVisible(true);
        break;
      }

      // ─── Game Items ──────────────────────────────────────────────────

      case 'poker_table': {
        setPokerVisible(true);
        break;
      }

      case 'coin_flip': {
        const result = Math.random() > 0.5 ? 'heads' : 'tails';
        const bsActive = item.coinFlipBlackswan || item.gameBlackswanActive;
        // BlackSwan always picks opposite of the likely outcome (contrarian)
        const bsPick = result === 'heads' ? 'tails' : 'heads';
        const playerWins = true; // Player always picks the result for demo
        const prevResult = item.coinFlipResult;
        const streak = prevResult === result ? (item.coinFlipStreak || 0) + 1 : 1;
        updateFurnitureField({
          coinFlipResult: result,
          coinFlipStreak: streak,
          coinFlipWins: (item.coinFlipWins || 0) + (playerWins ? 1 : 0),
          coinFlipLosses: (item.coinFlipLosses || 0) + (playerWins ? 0 : 1),
          coinFlipBlackswan: !bsActive, // Toggle BlackSwan each flip
        });
        if (streak >= 3) addFloorEffect('fireworks');
        else addFloorEffect('pulse');
        break;
      }

      case 'roulette_wheel': {
        if (item.rouletteSpinning) break;
        // Cycle crypto type on each spin
        const cryptos = ['SOL', 'ETH', 'BTC', 'USDC', 'MATIC'];
        const curCrypto = item.rouletteCryptoType || item.gameCryptoType || 'SOL';
        const nextCrypto = cryptos[(cryptos.indexOf(curCrypto) + 1) % cryptos.length];
        updateFurnitureField({
          rouletteSpinning: true,
          rouletteBetType: item.rouletteBetType || 'red',
          rouletteCryptoType: nextCrypto,
          rouletteCryptoAmount: item.rouletteCryptoAmount || 0.1,
        });
        setTimeout(() => {
          const number = Math.floor(Math.random() * 37);
          const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
          const isRed = redNums.includes(number);
          const betType = item.rouletteBetType || 'red';
          const won = (betType === 'red' && isRed) || (betType === 'black' && !isRed && number !== 0)
            || (betType === 'odd' && number % 2 === 1) || (betType === 'even' && number % 2 === 0 && number !== 0);
          updateFurnitureField({ rouletteSpinning: false, rouletteNumber: number });
          if (won) addFloorEffect('fireworks');
          const betTypes = ['red', 'black', 'odd', 'even'];
          const nextBet = betTypes[(betTypes.indexOf(betType) + 1) % betTypes.length];
          setTimeout(() => updateFurnitureField({ rouletteBetType: nextBet }), 500);
        }, 2500);
        break;
      }

      case 'chess_board': {
        const board = item.chessBoard || CHESS_INITIAL_BOARD;
        const turn = (item.chessTurn || 'white') as 'white' | 'black';

        // If game is over, tap resets
        if (item.chessGameOver) {
          updateFurnitureField({
            chessBoard: CHESS_INITIAL_BOARD,
            chessTurn: 'white',
            chessGameOver: false,
            chessSelected: undefined,
            chessCursor: undefined,
            chessLastFrom: undefined,
            chessLastTo: undefined,
            chessMoveCount: 0,
          });
          break;
        }

        const legalMoves = getChessLegalMoves(board, turn);

        // No legal moves = checkmate or stalemate
        if (legalMoves.length === 0) {
          updateFurnitureField({ chessGameOver: true });
          break;
        }

        const cursor = item.chessCursor ?? -1;
        const nextCursor = cursor + 1;

        if (nextCursor >= legalMoves.length) {
          // Wrap — execute the last highlighted move
          const [from, to] = legalMoves[Math.max(0, cursor)];
          const newBoard = applyChessMove(board, from, to);
          const nextTurn = turn === 'white' ? 'black' : 'white';
          const gameOver = isCheckmate(newBoard, nextTurn) || isStalemate(newBoard, nextTurn);

          updateFurnitureField({
            chessBoard: newBoard,
            chessTurn: nextTurn,
            chessGameOver: gameOver,
            chessSelected: undefined,
            chessCursor: undefined,
            chessLastFrom: from,
            chessLastTo: to,
            chessMoveCount: (item.chessMoveCount || 0) + 1,
          });

          // Auto-play black after a short delay (AI opponent)
          if (!gameOver && nextTurn === 'black') {
            setTimeout(() => {
              const aiMoves = getChessLegalMoves(newBoard, 'black');
              if (aiMoves.length === 0) {
                updateFurnitureField({ chessGameOver: true });
                return;
              }
              // Simple AI: pick a random legal move (prefer captures)
              const captures = aiMoves.filter(([, t]) => newBoard[t] !== '.');
              const picked = captures.length > 0
                ? captures[Math.floor(Math.random() * captures.length)]
                : aiMoves[Math.floor(Math.random() * aiMoves.length)];
              const aiBoard = applyChessMove(newBoard, picked[0], picked[1]);
              const aiGameOver = isCheckmate(aiBoard, 'white') || isStalemate(aiBoard, 'white');
              updateFurnitureField({
                chessBoard: aiBoard,
                chessTurn: 'white',
                chessGameOver: aiGameOver,
                chessSelected: undefined,
                chessCursor: undefined,
                chessLastFrom: picked[0],
                chessLastTo: picked[1],
                chessMoveCount: (item.chessMoveCount || 0) + 2,
              });
            }, 600);
          }
          if (gameOver) addFloorEffect('fireworks');
        } else {
          // Show next legal move
          const [from, to] = legalMoves[nextCursor];
          updateFurnitureField({
            chessSelected: from,
            chessCursor: nextCursor,
            chessLastFrom: undefined,
            chessLastTo: to,
          });
        }
        break;
      }

      case 'connect_four': {
        if (item.connectFourWinner) {
          updateFurnitureField({ connectFourBoard: '', connectFourTurn: 1, connectFourWinner: 0, connectFourCol: undefined, connectFourBlackswan: !item.connectFourBlackswan });
          break;
        }
        const c4board = item.connectFourBoard || '000000000000000000000000000000000000000000';
        const c4turn = item.connectFourTurn || 1;
        const c4availCols = [0, 1, 2, 3, 4, 5, 6].filter(c => c4board[c] === '0');
        if (c4availCols.length === 0) {
          updateFurnitureField({ connectFourWinner: 3 }); // draw
          break;
        }

        const c4curCol = item.connectFourCol;
        if (c4curCol === undefined || c4curCol === null) {
          // First tap: highlight first available column
          updateFurnitureField({ connectFourCol: c4availCols[0] });
          break;
        }

        // Find next available column after current
        const c4colIdx = c4availCols.indexOf(c4curCol);
        const c4nextColIdx = c4colIdx + 1;

        if (c4nextColIdx >= c4availCols.length) {
          // Wrap — drop in current column
          const dropCol = c4curCol;
          let c4targetRow = -1;
          for (let r = 5; r >= 0; r--) {
            if (c4board[r * 7 + dropCol] === '0') { c4targetRow = r; break; }
          }
          if (c4targetRow < 0) break;

          const c4idx = c4targetRow * 7 + dropCol;
          const c4newBoard = c4board.substring(0, c4idx) + String(c4turn) + c4board.substring(c4idx + 1);

          // Check for win
          if (checkConnectFourWin(c4newBoard, c4targetRow, dropCol, c4turn)) {
            updateFurnitureField({ connectFourBoard: c4newBoard, connectFourWinner: c4turn, connectFourCol: undefined });
            addFloorEffect('fireworks');
            break;
          }
          // Check for draw
          if (isConnectFourFull(c4newBoard)) {
            updateFurnitureField({ connectFourBoard: c4newBoard, connectFourWinner: 3, connectFourCol: undefined });
            break;
          }

          const c4nextTurn = c4turn === 1 ? 2 : 1;
          updateFurnitureField({ connectFourBoard: c4newBoard, connectFourTurn: c4nextTurn, connectFourCol: undefined });

          // BlackSwan AI plays after delay
          if (item.connectFourBlackswan && c4nextTurn === 2) {
            setTimeout(() => {
              const aiCol = connectFourAI(c4newBoard, 2);
              if (aiCol < 0) return;
              let aiRow = -1;
              for (let rr = 5; rr >= 0; rr--) {
                if (c4newBoard[rr * 7 + aiCol] === '0') { aiRow = rr; break; }
              }
              if (aiRow < 0) return;
              const aiIdx = aiRow * 7 + aiCol;
              const aiBoard = c4newBoard.substring(0, aiIdx) + '2' + c4newBoard.substring(aiIdx + 1);
              if (checkConnectFourWin(aiBoard, aiRow, aiCol, 2)) {
                updateFurnitureField({ connectFourBoard: aiBoard, connectFourWinner: 2, connectFourCol: undefined });
                addFloorEffect('fireworks');
                return;
              }
              if (isConnectFourFull(aiBoard)) {
                updateFurnitureField({ connectFourBoard: aiBoard, connectFourWinner: 3, connectFourCol: undefined });
                return;
              }
              updateFurnitureField({ connectFourBoard: aiBoard, connectFourTurn: 1, connectFourCol: undefined });
            }, 600);
          }
        } else {
          // Cycle to next available column
          updateFurnitureField({ connectFourCol: c4availCols[c4nextColIdx] });
        }
        break;
      }

      case 'trivia_screen': {
        const questions = [
          { q: 'What does SOL stand for?', cat: 'crypto' },
          { q: 'Who created Bitcoin?', cat: 'crypto' },
          { q: 'What is a DAO?', cat: 'crypto' },
          { q: 'What consensus does Solana use?', cat: 'crypto' },
          { q: 'What is a DEX?', cat: 'crypto' },
          { q: 'What language is React Native in?', cat: 'tech' },
          { q: 'What does API stand for?', cat: 'tech' },
          { q: 'What is TypeScript?', cat: 'tech' },
          { q: 'What is WebSocket used for?', cat: 'tech' },
          { q: 'What does RPC stand for?', cat: 'tech' },
          { q: 'How many planets in our solar system?', cat: 'general' },
          { q: 'What year was the iPhone released?', cat: 'general' },
          { q: 'What is the speed of light?', cat: 'general' },
        ];
        const qIdx = Math.floor(Math.random() * questions.length);
        const picked = questions[qIdx];
        if (item.triviaAnswer !== undefined && item.triviaAnswer >= 0) {
          const correct = item.triviaAnswer === 0;
          updateFurnitureField({
            triviaScore: (item.triviaScore || 0) + (correct ? 1 : 0),
            triviaQuestion: picked.q,
            triviaCategory: picked.cat,
            triviaAnswer: -1,
          });
          if (correct) addFloorEffect('pulse');
        } else {
          const ans = Math.floor(Math.random() * 4);
          updateFurnitureField({ triviaAnswer: ans });
        }
        break;
      }

      case 'crypto_ticker': {
        // Cycle through crypto display — rotate which coins are shown
        const allCoins = ['SOL', 'ETH', 'BTC', 'USDC', 'MATIC'];
        const curCoinsArr = (item.cryptoTickerCoins || 'SOL,ETH,BTC').split(',');
        // Shift the display window by 1
        const startIdx = allCoins.indexOf(curCoinsArr[0] || 'SOL');
        const newStart = (startIdx + 1) % allCoins.length;
        const newCoins = [0, 1, 2].map(i => allCoins[(newStart + i) % allCoins.length]);
        // Generate mock prices
        const mockPrices: Record<string, number> = { SOL: 145.23, ETH: 3842.10, BTC: 68420.50, USDC: 1.00, MATIC: 0.89 };
        const mockChanges: Record<string, number> = { SOL: 4.2, ETH: -1.3, BTC: 2.8, USDC: 0.01, MATIC: -3.1 };
        updateFurnitureField({
          cryptoTickerCoins: newCoins.join(','),
          cryptoTickerPrices: newCoins.map(c => mockPrices[c] || 0).join(','),
          cryptoTickerChanges: newCoins.map(c => mockChanges[c] || 0).join(','),
        });
        addFloorEffect('pulse');
        break;
      }

      case 'github_feed': {
        // Cycle through demo repos
        const repos = ['swanopoly/the-underground-circle', 'vercel/next.js', 'facebook/react', 'denoland/deno'];
        const curRepo = item.githubRepo || repos[0];
        const curIdx = repos.indexOf(curRepo);
        const nextRepo = repos[(curIdx + 1) % repos.length];
        const activities = ['Push to main', 'PR merged: fix auth', 'Issue opened: bug report', 'Release v2.1.0', 'CI passed'];
        updateFurnitureField({
          githubRepo: nextRepo,
          githubActivity: activities[Math.floor(Math.random() * activities.length)],
          githubCommits: Math.floor(Math.random() * 20) + 1,
          githubPRs: Math.floor(Math.random() * 5),
        });
        break;
      }

      case 'calendar_widget': {
        // Try to fetch real calendar events
        const calProv = item.calendarProvider === 'outlook' ? 'microsoft' : 'google' as OAuthProvider;
        fetchCalendarEvents(calProv).then(calData => {
          if (calData && calData.nextEvent) {
            updateFurnitureField({
              calendarEvent: calData.nextEvent.title,
              calendarTime: calData.nextEvent.timeFormatted || '',
              calendarEvents: calData.count,
            });
          } else {
            // Fallback: cycle demo events
            const events = [
              { name: 'Team Standup', time: '10:00 AM' },
              { name: 'Design Review', time: '2:00 PM' },
              { name: 'Sprint Planning', time: '11:30 AM' },
              { name: '1:1 with Lead', time: '4:00 PM' },
              { name: 'Deploy Window', time: '6:00 PM' },
            ];
            const curIdx = events.findIndex(e => e.name === item.calendarEvent);
            const next = events[(curIdx + 1) % events.length];
            updateFurnitureField({
              calendarEvent: next.name,
              calendarTime: next.time,
              calendarEvents: Math.floor(Math.random() * 6) + 1,
            });
          }
        }).catch(() => {
          // Fallback to demo
          updateFurnitureField({
            calendarEvent: 'No connection',
            calendarTime: '',
            calendarEvents: 0,
          });
        });
        break;
      }

      case 'email_hub': {
        // Try to fetch real emails
        const emailProv = item.emailProvider === 'gmail' ? 'google' : item.emailProvider === 'outlook' ? 'microsoft' : 'yahoo' as OAuthProvider;
        fetchEmails(emailProv).then(emailData => {
          if (emailData && emailData.emails.length > 0) {
            const latest = emailData.emails[0];
            updateFurnitureField({
              emailSender: latest.sender,
              emailSubject: latest.subject,
              emailTime: latest.timeFormatted || '',
              emailUnread: emailData.unread,
              emailConnected: true,
            });
          } else {
            // Fallback: cycle demo emails
            const emails = [
              { sender: 'Team Updates', subject: 'Weekly sync notes', time: '9:30 AM' },
              { sender: 'GitHub', subject: 'PR #142 merged to main', time: '10:15 AM' },
              { sender: 'Jira', subject: 'PROJ-89 moved to In Review', time: '11:00 AM' },
              { sender: 'Design Team', subject: 'New mockups ready', time: '1:45 PM' },
              { sender: 'DevOps Alert', subject: 'Deploy succeeded: v2.4.1', time: '3:20 PM' },
            ];
            const curSender = item.emailSender || '';
            const curIdx = emails.findIndex(e => e.sender === curSender);
            const next = emails[(curIdx + 1) % emails.length];
            updateFurnitureField({
              emailSender: next.sender,
              emailSubject: next.subject,
              emailTime: next.time,
              emailUnread: Math.floor(Math.random() * 12) + 1,
            });
          }
        }).catch(() => {
          updateFurnitureField({ emailConnected: false });
        });
        break;
      }

      case 'world_clock': {
        // Cycle timezone sets
        const zoneSets = [
          { zones: 'America/New_York,Europe/London,Asia/Tokyo', labels: 'NYC,LDN,TKY' },
          { zones: 'America/Los_Angeles,Europe/Berlin,Asia/Shanghai', labels: 'LA,BER,SHG' },
          { zones: 'America/Chicago,Asia/Dubai,Australia/Sydney', labels: 'CHI,DXB,SYD' },
        ];
        const curLabels = item.worldClockLabels || 'NYC,LDN,TKY';
        const curIdx = zoneSets.findIndex(s => s.labels === curLabels);
        const next = zoneSets[(curIdx + 1) % zoneSets.length];
        updateFurnitureField({
          worldClockZones: next.zones,
          worldClockLabels: next.labels,
        });
        addFloorEffect('pulse');
        break;
      }

      case 'music_visualizer': {
        // Toggle active + cycle style (0=bars, 1=wave, 2=circle)
        const curStyle = item.musicVisualizerStyle ?? 0;
        if (item.musicVisualizerActive) {
          updateFurnitureField({ musicVisualizerStyle: (curStyle + 1) % 3 });
        } else {
          updateFurnitureField({ musicVisualizerActive: true });
        }
        addFloorEffect('pulse');
        break;
      }

      case 'figma_board': {
        // Toggle connected state
        updateFurnitureField({
          figmaBoardConnected: !item.figmaBoardConnected,
          figmaBoardUrl: item.figmaBoardUrl || 'https://figma.com/file/demo',
        });
        if (!item.figmaBoardConnected) addFloorEffect('pulse');
        break;
      }

      case 'hf_explorer':
        setHfExplorerVisible(true);
        break;

      case 'hf_runner':
        setHfRunnerVisible(true);
        break;

      default:
        break;
    }
  }, [currentFloorId, interactInputId, currentUserId, currentUserName, circleId, displayAgents]);

  // ─── Poker player action handler (legacy — game now runs in fullscreen modal) ──
  const handlePokerAction = useCallback((_id: string, _action: string, _amount?: number) => {
    // Poker actions now handled by PokerGame component
  }, []);

  const handleInteractSubmit = useCallback(() => {
    if (!interactInputId || !interactInputText.trim() || !currentUserId || !currentUserName) return;
    const currentFloor = floors.find(f => f.id === currentFloorId);
    const item = currentFloor?.furniture.find(f => f.id === interactInputId);

    const params: any = {
      circleId,
      senderId: currentUserId,
      senderName: currentUserName,
      commandText: interactInputText.trim(),
    };

    if (item?.type === 'command_console' && interactAgentTarget) {
      const agent = displayAgents.find(a => a.id === interactAgentTarget);
      if (agent) {
        params.targetAgentId = agent.id;
        params.targetAgentName = `@${agent.name}`;
        params.targetAgentIds = [agent.id];
      }
    } else {
      params.targetAgentName = '@all';
    }

    sendTerminalCommand(params);
    setInteractInputId(null);
    setInteractInputText('');
    setInteractAgentTarget(null);
  }, [interactInputId, interactInputText, currentUserId, currentUserName, circleId, floors, currentFloorId, interactAgentTarget, displayAgents]);

  const handleCommand = (cmd: OfficeCommand) => {
    if (cmd.type === 'theme') handleChangeFloorTheme(currentFloor.id, cmd.value);
    if (cmd.type === 'info') {
      const agent = agents.find(a => a.name === cmd.query);
      if (agent) setSelectedAgent(agent);
    }
  };

  const handleRenameAgent = useCallback(async (agent: OfficeAgent, newName: string) => {
    const normalizedName = newName.trim();
    if (!normalizedName) return;

    const identityKey = getAgentIdentityKey(agent);

    await renameAgentIdentity(identityKey, normalizedName);

    const updated = {
      ...agentNames,
      [agent.id]: normalizedName,
      [identityKey]: normalizedName,
    };
    setAgentNames(updated);
    storage.setItem(STORAGE_KEY_AGENT_NAMES, JSON.stringify(updated)).catch(() => {});
    pushOfficePreferences({ agentNames: updated });

    if (selectedAgent?.id === agent.id) {
      setSelectedAgent(prev => prev ? { ...prev, name: normalizedName, sessionKey: identityKey } : null);
    }

    setEnrichedAgents(prev => prev.map(existing => (
      existing.id === agent.id || existing.sessionKey === identityKey
        ? { ...existing, name: normalizedName, sessionKey: identityKey }
        : existing
    )));

    setAgentIdentities(await loadAgentIdentities());
  }, [agentNames, selectedAgent, pushOfficePreferences]);

  // ─── Floor action handlers ──────────────────────────────

  const handleAddFloor = useCallback(() => {
    setFloors(prev => {
      const nextNum = prev.length + 1;
      const newFloor = createDefaultFloor(
        `floor_${Date.now()}`,
        `${nextNum}F - New Floor`,
        'underground',
        prev.length
      );
      return [...prev, newFloor];
    });
  }, []);

  const handleDeleteFloor = useCallback((floorId: string) => {
    setFloors(prev => {
      if (prev.length <= 1) return prev;
      const updated = prev.filter(f => f.id !== floorId).map((f, i) => ({ ...f, order: i }));
      if (currentFloorId === floorId) {
        setCurrentFloorId(updated[0].id);
        storage.setItem(STORAGE_KEY_CURRENT_FLOOR, updated[0].id).catch(() => {});
      }
      return updated;
    });
  }, [currentFloorId]);

  const handleRenameFloor = useCallback((floorId: string, newName: string) => {
    setFloors(prev => prev.map(f => f.id === floorId ? { ...f, name: newName } : f));
  }, []);

  const handleChangeFloorTheme = useCallback((floorId: string, themeId: string) => {
    setFloors(prev => prev.map(f => f.id === floorId ? { ...f, themeId } : f));
  }, []);

  const handleSwitchFloor = useCallback((floorId: string) => {
    setCurrentFloorId(floorId);
    storage.setItem(STORAGE_KEY_CURRENT_FLOOR, floorId).catch(() => {});
    // Supabase sync handled by floors persistence useEffect
  }, []);

  // ─── Session tagging handlers ──────────────────────────────

  const handleAddSessionTag = useCallback(async (sessionKey: string, tag: SessionTag) => {
    const updated = await addSessionTag(sessionKey, tag, sessionTags);
    setSessionTags(updated);
  }, [sessionTags]);

  const handleRemoveSessionTag = useCallback(async (sessionKey: string, tagKey: string) => {
    const updated = await removeSessionTag(sessionKey, tagKey, sessionTags);
    setSessionTags(updated);
  }, [sessionTags]);

  // ─── Action panel handlers ──────────────────────────────

  // ─── Budget handlers ──────────────────────────────

  const handleBudgetConfigChange = useCallback(async (config: BudgetConfig) => {
    setBudgetConfig(config);
    await saveBudgetConfig(config);
    setBudgetAlertsDismissed(false); // Re-show alerts when config changes
  }, []);

  // ─── Idle behavior handlers ──────────────────────────────

  const handleIdleConfigChange = useCallback(async (config: IdleBehaviorConfig) => {
    setIdleConfig(config);
    idleConfigRef.current = config;
    await saveIdleConfig(config);
  }, []);

  // Calculate budget alerts using real session costs
  const periodCosts = calculatePeriodCosts(enrichedSessions);
  const budgetAlerts = calculateBudgetAlerts(
    budgetConfig,
    periodCosts.today,
    periodCosts.week,
    periodCosts.month
  );

  return (
    <View style={styles.container}>
      {/* Circle-wide "Needs you" summary (plan §4a) */}
      <ChatAttentionStrip
        state={officeAttention}
        items={officeAttentionItems}
        onAction={handleOfficeAttentionAction}
        accentColor={accentColor}
      />

      {/* HITL Approval Banner — expired rows are excluded (the strip above
          declares them expired; live APPROVE on a dead window is a trap). */}
      <HitlApprovalBanner
        approvals={pendingApprovals.filter((approval) => {
          const expiresAt = resolveApprovalExpiresAt(approval.requested_at, approval.timeout_seconds);
          return expiresAt === null || expiresAt > Date.now();
        })}
        circleId={circleId}
      />

      {/* Standing "always allow" grants — review + revoke (plan §4d) */}
      <StandingGrantsPanel accentColor={accentColor} userId={currentUserId} />

      {/* Recurring watches — list / pause / delete (plan §6a) */}
      <ComputerTaskSchedulesPanel circleId={circleId} accentColor={accentColor} />

      {/* Run detail drawer for open_run attention items (plan §6b) */}
      <RunHistoryDrawer
        visible={showOfficeRunDetail}
        circleId={circleId}
        currentUserId={currentUserId}
        title="Circle Runs"
        onClose={() => setShowOfficeRunDetail(false)}
      />

      {/* D6: active computer task — phase, needs-you, stage progress */}
      {computerTaskCard?.active ? (
        <View
          style={{
            marginHorizontal: 12,
            marginTop: 6,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: computerTaskCard.needsYou.length > 0 ? '#e8b33955' : '#33415555',
            backgroundColor: computerTaskCard.needsYou.length > 0 ? '#e8b33912' : '#1e293b33',
          }}
        >
          <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
            🖥 {computerTaskCard.title} — {computerTaskCard.phaseLabel}
          </Text>
          {computerTaskCard.needsYou.slice(0, 2).map((item, index) => (
            <Text key={`${item.kind}_${index}`} style={{ color: '#e8b339', fontSize: 11, marginTop: 2 }} numberOfLines={2}>
              ⚑ {item.kind === 'question' ? 'Needs your answer' : item.kind === 'approval' ? 'Needs your approval' : 'Blocked'}: {item.label}
            </Text>
          ))}
          {computerTaskCard.stages.length > 0 ? (
            <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }} numberOfLines={1}>
              {computerTaskCard.stages.map((stage) => (
                stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '✕' : '○'
              )).join(' ')} {computerTaskCard.stages.length} stages
            </Text>
          ) : null}
          {/* E1: escalation breadcrumbs — dim, latest switch only */}
          {computerTaskCard.surfaceChanges.length > 0 ? (
            <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2 }} numberOfLines={1}>
              {computerTaskCard.surfaceChanges[computerTaskCard.surfaceChanges.length - 1]}
            </Text>
          ) : null}
          {computerTaskCard.needsYou.length > 0 ? (
            <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2 }} numberOfLines={1}>
              Open Chat → Use Computer to answer or approve.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Budget Alerts */}
      {!budgetAlertsDismissed && budgetAlerts.length > 0 && (
        <BudgetAlertBanner
          alerts={budgetAlerts}
          onDismiss={() => setBudgetAlertsDismissed(true)}
          onConfigure={() => setShowCustomize(true)}
        />
      )}

      {/* O5 (P39): fail-visible bridge readiness on the main view — warns when
          the core proxy or all execution bridges are down; silent when healthy
          (the connect panel's "✓ Connected" chip owns the happy state). */}
      <OfficeBridgeReadinessStrip snapshot={bridgeReadinessStrip} />
      {/* X7 tail (P53): per-lane chat quality — warn/danger-only, silent when
          healthy; self-polls the session lane-health registry (P48). */}
      <OfficeLaneHealthStrip />
      <OfficeConnectBridgesSection circleId={circleId} />

      {/* Marquee ticker removed — too noisy for the Office view */}

      <OfficeWorkspaceSection
        viewMode={viewMode}
        floors={floors}
        displayAgents={displayAgents}
        currentFloorId={currentFloorId}
        editMode={editMode}
        currentFloor={currentFloor}
        placingType={placingType}
        selectedFurnitureId={selectedFurnitureId}
        resolveTheme={resolveTheme}
        connections={connections}
        accentColor={accentColor}
        savingSessionMemoryMode={savingSessionMemoryMode}
        sessionMemoryMode={sessionMemoryMode}
        showMcpHub={showMcpHub}
        showGitHubFeed={showGitHubFeed}
        showSoundMixer={showSoundMixer}
        showVault={showVault}
        onSwitchFloor={handleSwitchFloor}
        onDeleteFloor={handleDeleteFloor}
        onAddFloor={handleAddFloor}
        onToggleEditMode={() => { setEditMode(!editMode); setPlacingType(null); setSelectedFurnitureId(null); }}
        onReconnectAll={handleReconnectAll}
        onShowRewards={() => setShowRewards(true)}
        onShowConnectAgent={() => setShowConnectAgent(true)}
        onShowCustomize={() => setShowCustomize(true)}
        onToggleSessionMemoryMode={toggleSessionMemoryMode}
        onToggleMcpHub={() => setShowMcpHub(v => !v)}
        onToggleGitHubFeed={() => setShowGitHubFeed(!showGitHubFeed)}
        onToggleSoundMixer={() => setShowSoundMixer(!showSoundMixer)}
        onToggleVault={() => setShowVault(v => !v)}
        onCancelPlacing={() => setPlacingType(null)}
        onClearFloorFurniture={() => setFloors(prev => prev.map(f => f.id === currentFloorId ? { ...f, furniture: [] } : f))}
        setPlacingType={setPlacingType}
        setActiveCatalogCat={setActiveCatalogCat}
        catalogScrollRef={catalogScrollRef}
        activeCatalogCat={activeCatalogCat}
        styles={styles}
        FURNITURE_CATALOG={FURNITURE_CATALOG}
      />

      <OfficeIntelligenceSection
        viewMode={viewMode}
        showGitHubFeed={showGitHubFeed}
        showSoundMixer={showSoundMixer}
        showVault={showVault}
        circleId={circleId}
        accentColor={accentColor}
        styles={styles}
        GitHubWallFeed={GitHubWallFeed}
        SoundMixer={SoundMixer}
        SiteCredentialVaultPanel={SiteCredentialVaultPanel}
      />


      {/* Main Content — Office Floor View */}
      <View style={styles.mainContent}>
        {/* Mobile: Card-based agent list */}
        {!isDesktop ? (
          <ScrollView style={styles.mobileAgentScroll} showsVerticalScrollIndicator={true} contentContainerStyle={styles.mobileAgentList}>
            {/* Ops board: live builds + token spend (after the computer-task
                card above, before the agent roster). Hidden when empty. */}
            <OfficeBuildingNowCard board={opsBoard} />
            <OfficeTokensCard tracker={opsTokenTracker} />

            {/* Circle members' agents — shared office */}
            {mergedCircleAgents.length > 0 && (
              <CircleOfficePanel
                agents={mergedCircleAgents}
                onRefresh={loadCircleOffice}
                accentColor={accentColor}
                connectionStatus={circleConnectionStatus}
              />
            )}

            {/* Publish to Circle CTA — always show if user hasn't published yet */}
            {!mergedCircleAgents.some(a => a.isOwn) && !publishCtaDismissed && (
              <View style={{ position: 'relative' }}>
                <Pressable
                  onPress={() => {
                    const conn = connections.find(c => c.enabled);
                    openPublishAgentModal(conn);
                  }}
                  disabled={publishingToCircle}
                  style={[coStyles.publishBtn, { borderColor: accentColor + '44', opacity: publishingToCircle ? 0.6 : 1 }]}
                >
                  <Text style={coStyles.publishBtnIcon}>🏢</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[coStyles.publishBtnTitle, { color: accentColor }]}>
                      {publishingToCircle ? 'Publishing...' : 'Add your agent to the Circle Office'}
                    </Text>
                    <Text style={coStyles.publishBtnSub}>
                      {connections.some(c => c.enabled)
                        ? 'Let your circle see your agent and what it\'s building'
                        : 'Register your agent manually — no gateway required'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={dismissPublishCta}
                  hitSlop={10}
                  style={({ pressed }: any) => [
                    {
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                    },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '700' }}>×</Text>
                </Pressable>
              </View>
            )}
            {/* ── Agent filter chips ───────────────────────────────────── */}
            <View style={officeFilterChipStyles.row}>
              {(['all', 'mine', 'active', 'bonded'] as const).map(mode => {
                const isActive = agentFilterMode === mode;
                const count = agentFilterCounts[mode];
                return (
                  <Pressable
                    key={mode}
                    onPress={() => persistAgentFilter(mode)}
                    style={[
                      officeFilterChipStyles.chip,
                      isActive && officeFilterChipStyles.chipActive,
                      Platform.OS === 'web' && { cursor: 'pointer' } as any,
                    ]}
                  >
                    <Text style={[officeFilterChipStyles.label, isActive && officeFilterChipStyles.labelActive]}>
                      {mode === 'all' ? 'ALL' : mode === 'mine' ? 'MINE' : mode === 'active' ? 'ACTIVE' : 'BONDED'}
                    </Text>
                    <Text style={[officeFilterChipStyles.count, isActive && officeFilterChipStyles.countActive]}>
                      {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {userAgents.length === 0 ? (
              <View style={styles.mobileEmpty}>
                {(() => {
                  const connectingConns = connections.filter(c => c.status === 'connecting');
                  const errorConns = connections.filter(c => c.status === 'error');
                  const savedConns = connections.filter(c => c.enabled);

                  if (connectingConns.length > 0) {
                    return (
                      <>
                        <ActivityIndicator color="#e8e8e8" size="large" style={{ marginBottom: 16 }} />
                        <Text style={styles.mobileEmptyTitle}>Connecting...</Text>
                        <Text style={styles.mobileEmptyText}>
                          Reaching {connectingConns[0].name}
                        </Text>
                      </>
                    );
                  }
                  if (errorConns.length > 0 && savedConns.length > 0) {
                    return (
                      <>
                        <Text style={styles.mobileEmptyIcon}>⚠️</Text>
                        <Text style={styles.mobileEmptyTitle}>Connection failed</Text>
                        {errorConns.map(c => (
                          <View key={c.id} style={{ marginBottom: 8, padding: 10, backgroundColor: '#161616', borderRadius: 8, borderWidth: 1, borderColor: '#ffffff15', width: '100%' }}>
                            <Text style={{ color: '#9e9e9e', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' }}>{c.name}</Text>
                            <Text style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 2 }}>{c.error || 'Could not reach endpoint'}</Text>
                            <Text style={{ color: '#555', fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>{c.endpoint}</Text>
                          </View>
                        ))}
                        <Text style={{ color: '#555', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', marginBottom: 8 }}>
                          Make sure OpenSwan is running and the CORS proxy is active
                        </Text>
                        <Pressable
                          onPress={() => savedConns.forEach(c => connectOne(c))}
                          style={[{ backgroundColor: '#ffffff10', borderWidth: 1, borderColor: '#ffffff20', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, marginBottom: 12 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                        >
                          <Text style={{ color: '#e8e8e8', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>↻ RETRY CONNECTION</Text>
                        </Pressable>
                      </>
                    );
                  }
                  return (
                    <>
                      <AgentQuickConnect circleId={circleId} onOpenWizard={() => setShowSetupWizard(true)} compact />
                      {/* Empty-state next-action chips. "Deploy an agent"
                          (office:deploy-agent handler token) opens the setup
                          wizard in-surface; /apps and /screen are chat
                          commands, so those pick navigate to Chat via the
                          existing uc:switch-tab event (visual guidance — no
                          cross-surface composer-seed plumbing exists). */}
                      <View style={{ marginTop: 20, width: '100%' }}>
                        <SuggestedTaskChips
                          suggestions={getEmptyStateSuggestions('office')}
                          onPick={(action: EmptyStateSuggestionAction) => {
                            if (action.kind === 'seed_command' && action.value === 'office:deploy-agent') {
                              setShowSetupWizard(true);
                              return;
                            }
                            // /apps + /screen live in Chat — land the user there.
                            if (Platform.OS === 'web' && typeof window !== 'undefined') {
                              try { window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab: 'CHAT' } })); } catch {}
                            }
                          }}
                          accentColor={accentColor}
                          nativeID="section-office-empty-suggestions"
                        />
                      </View>
                    </>
                  );
                })()}
              </View>
            ) : filteredDisplayAgents.length === 0 ? (
              <View style={styles.mobileEmpty}>
                <Text style={styles.mobileEmptyIcon}>🔍</Text>
                <Text style={styles.mobileEmptyTitle}>No {agentFilterMode === 'all' ? '' : agentFilterMode} agents</Text>
                <Text style={styles.mobileEmptyText}>
                  {agentFilterMode === 'mine' ? 'You haven\'t bonded any agents yet.'
                    : agentFilterMode === 'active' ? 'No one is working right now.'
                    : agentFilterMode === 'bonded' ? 'No persisted agents in this circle.'
                    : 'No agents to show.'}
                </Text>
                <Pressable
                  onPress={() => persistAgentFilter('all')}
                  style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ffffff40', backgroundColor: '#ffffff08' }}
                >
                  <Text style={{ color: '#e8e8e8', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, fontFamily: 'monospace' }}>SHOW ALL</Text>
                </Pressable>
              </View>
            ) : (
              filteredDisplayAgents.map((agent) => {
                const statusColor = getOfficeStatusColor(agent.status);
                const statusLabel = getOfficeStatusLabel(agent.status);
                const isSelected = selectedAgent?.id === agent.id;
                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => handleAgentPress(agent)}
                    style={[styles.mobileAgentCard, isSelected && { borderColor: agent.color + '60', backgroundColor: agent.color + '08' },
                      Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    accessibilityRole="button"
                    accessibilityLabel={`${agent.name}, ${statusLabel.toLowerCase()}, ${agent.role}`}
                  >
                    <View style={styles.mobileCardRow}>
                      <View style={[styles.mobileCardAvatar, { backgroundColor: agent.color + '20', borderColor: agent.color + '50' }]}>
                        <Text style={[styles.mobileCardAvatarText, { color: agent.color }]}>{agent.name.charAt(0)}</Text>
                      </View>
                      <View style={styles.mobileCardInfo}>
                        <View style={styles.mobileCardNameRow}>
                          <Text style={styles.mobileCardName}>{agent.name}</Text>
                          {agent.isProviderMain ? (
                            <Text style={[styles.mobileCardMainBadge, { color: agent.color || accentColor }]}>MAIN</Text>
                          ) : null}
                          <View style={[styles.mobileCardStatus, { backgroundColor: statusColor }]} />
                          <Text style={[styles.mobileCardStatusText, { color: statusColor }]}>{statusLabel}</Text>
                        </View>
                        <Text style={styles.mobileCardRole}>{agent.role} · {PROVIDER_META[agent.providerType]?.icon || '⚡'} {agent.connectionName}</Text>
                        <Text style={styles.mobileCardModel}>{agent.model}</Text>
                      </View>
                      <View style={styles.mobileCardRight}>
                        <Text style={styles.mobileCardCost}>${(agent.costTotal || agent.costToday).toFixed(2)}</Text>
                        <Text style={styles.mobileCardCostLabel}>today</Text>
                      </View>
                    </View>
                    <Text style={styles.mobileCardActivity} numberOfLines={1}>{agent.activity}</Text>
                    {/* Live ops: "Now: tool" + recent tools / uptime / subagents.
                        Runs attach by case-insensitive name match — see the
                        opsRunNodesByAgent limitation note. */}
                    <OfficeAgentLiveOpsLines
                      ops={buildAgentLiveOps(
                        agent,
                        opsRunNodesByAgent.get(agent.name.trim().toLowerCase()) ?? [],
                        Date.now(),
                      )}
                      accentColor={agent.color || accentColor}
                    />
                    {/* O1/O2 (P38): last finished outcome + 24h counts/cost,
                        plus the fail-visible bridge status note when set. */}
                    <OfficeAgentAccountabilityLine
                      entry={opsAccountability?.get(agent.name.trim().toLowerCase())}
                      statusNote={agent.statusNote}
                    />
                  </Pressable>
                );
              })
            )}

            {/* Agent Activity Feed */}
            <View style={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8 }}>
              <Text style={{ color: '#6f6f6f', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
                ⚡ Agent Activity
              </Text>
              <AgentActivityFeed circleId={circleId} maxHeight={320} />
            </View>

          </ScrollView>
        ) : (
          /* Desktop: Isometric office view */
          <>
            <ScrollView style={styles.officeScroll} showsVerticalScrollIndicator={true}>
              <ScrollView horizontal={needsHScroll} scrollEnabled={needsHScroll} showsHorizontalScrollIndicator={needsHScroll}>
                <View style={[styles.officeScaleOuter, { height: scaledH, width: needsHScroll ? OFFICE_FLOOR_WIDTH * officeScale : '100%' as any }]}>
                  <View style={[styles.officeWrapper, { width: OFFICE_FLOOR_WIDTH, height: OFFICE_FLOOR_HEIGHT, transform: [{ scale: officeScale }] }]}>
                    <OfficeFloorView
                      theme={currentTheme}
                      furniture={currentFloor.furniture}
                      editMode={editMode}
                      onFloorPress={editMode ? handleFloorPress : undefined}
                      onFurniturePress={editMode ? handleFurniturePress : undefined}
                      onFurnitureMove={editMode ? handleFurnitureMove : undefined}
                      onFurnitureResize={editMode ? handleFurnitureResize : undefined}
                      onFurnitureInteract={handleFurnitureInteract}
                      onFurnitureItemUpdate={handleFurnitureItemUpdate}
                      onPokerAction={handlePokerAction}
                      agents={agents}
                      selectedFurnitureId={editMode ? selectedFurnitureId : null}
                    />
                    {WhiteboardView ? (
                      <WhiteboardView
                        editable={editMode}
                        notes={whiteboardNotes}
                        onNotesChange={setWhiteboardNotes}
                        agents={displayAgents}
                        statusHistory={statusHistory}
                        cronJobs={cronJobs}
                        circleId={circleId}
                        connectedCount={connections.filter(c => c.status === 'connected').length}
                        totalConnections={connections.length}
                        connections={connections}
                        pendingApprovals={pendingApprovals}
                        budgetAlerts={budgetAlerts}
                        periodCosts={periodCosts}
                      />
                    ) : (
                      <View style={styles.desktopWidgetPlaceholder}>
                        <Text style={styles.desktopWidgetPlaceholderTitle}>Loading whiteboard…</Text>
                      </View>
                    )}
                    {ServerRackView ? (
                      <ServerRackView agents={displayAgents} />
                    ) : (
                      <View style={[styles.desktopWidgetPlaceholder, styles.desktopWidgetPlaceholderRack]}>
                        <Text style={styles.desktopWidgetPlaceholderTitle}>Loading rack…</Text>
                      </View>
                    )}
                    {userAgents.length === 0 && !anyConnected && connections.filter(c => c.status === 'connecting').length === 0 && (
                      <View style={styles.emptyOverlay}>
                        {connections.filter(c => c.status === 'error').length > 0 ? (
                          <>
                            <Text style={{ fontSize: 28, marginBottom: 8 }}>⚠️</Text>
                            <Text style={styles.emptyTitle}>Connection failed</Text>
                            <Text style={styles.emptyText}>
                              {connections.find(c => c.status === 'error')?.error || 'Could not reach agent endpoint'}
                            </Text>
                            <Pressable
                              onPress={() => connections.filter(c => c.enabled).forEach(c => connectOne(c))}
                              style={{ marginTop: 12, backgroundColor: '#ffffff10', borderWidth: 1, borderColor: '#ffffff20', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}
                            >
                              <Text style={{ color: '#e8e8e8', fontWeight: '700', fontSize: 12, fontFamily: 'monospace' }}>↻ RETRY</Text>
                            </Pressable>
                          </>
                        ) : (
                          <AgentQuickConnect circleId={circleId} onOpenWizard={() => setShowSetupWizard(true)} />
                        )}
                      </View>
                    )}
                    {agents.map((agent, i) => {
                      const pos = OFFICE_DESK_POSITIONS[i];
                      if (!pos) return null;
                      // Ops board: small "building" badge when this agent has a
                      // matching building root or active subagents (name match —
                      // see the opsRunNodesByAgent limitation note). Sprite and
                      // its own status indicator are untouched.
                      const opsNodes = opsRunNodesByAgent.get(agent.name.trim().toLowerCase()) ?? [];
                      const opsBuilding =
                        opsNodes.some((n) => !n.isSubagent) ||
                        buildAgentLiveOps(agent, opsNodes, Date.now()).subagents.active > 0;
                      return (
                        <View key={agent.id} style={[styles.agentPosition, { left: pos.x - 2, top: pos.y - 50 }]}>
                          {opsBuilding ? <OfficeBuildingBadge /> : null}
                          <PixelAgent
                            agent={agent}
                            appearance={getAppearance(agent)}
                            environmentType={currentTheme.environmentType}
                            onPress={() => handleAgentPress(agent)}
                            selected={selectedAgent?.id === agent.id}
                            showThoughts={!editMode}
                            totalAgents={agents.length}
                            dancing={dancingAgentId === 'all' || dancingAgentId === agent.id}
                            xp={userXp}
                            xpNext={xpNext}
                            turns={agent.turns || agent.messagesProcessed || 0}
                            tokens={agent.tokensUsed || 0}
                            onAutomate={handleOpenAutomate}
                          />
                        </View>
                      );
                    })}

                    {/* Interactive furniture input overlay */}
                    {interactInputId && (() => {
                      const curFloor = floors.find(f => f.id === currentFloorId);
                      const fi = curFloor?.furniture.find(f => f.id === interactInputId);
                      if (!fi) return null;
                      const isConsole = fi.type === 'command_console';
                      return (
                        <View style={{ position: 'absolute', left: fi.x - 10, top: fi.y + (FURNITURE_CATALOG.find(c => c.type === fi.type)?.height || 50) + 4, zIndex: 50, flexDirection: 'column', gap: 3 }} pointerEvents="box-none">
                          {isConsole && (
                            <View style={{ flexDirection: 'row', gap: 2, marginBottom: 2 }}>
                              {displayAgents.slice(0, 6).map(a => (
                                <Pressable
                                  key={a.id}
                                  onPress={() => setInteractAgentTarget(a.id)}
                                  style={{
                                    paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3,
                                    backgroundColor: interactAgentTarget === a.id ? (currentTheme.accentGlow + '40') : '#161616',
                                    borderWidth: 1, borderColor: interactAgentTarget === a.id ? currentTheme.accentGlow : '#252525',
                                    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
                                  }}
                                >
                                  <Text style={{ color: interactAgentTarget === a.id ? currentTheme.accentGlow : '#9e9e9e', fontSize: 6, fontFamily: 'monospace' }}>@{a.name}</Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                          <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
                            <TextInput
                              value={interactInputText}
                              onChangeText={setInteractInputText}
                              onSubmitEditing={handleInteractSubmit}
                              placeholder={isConsole ? 'Command...' : 'Task for all agents...'}
                              placeholderTextColor="#6f6f6f"
                              autoFocus
                              style={{
                                width: 120, height: 20, fontSize: 8, fontFamily: 'monospace',
                                color: '#e8e8e8', backgroundColor: '#000000', borderWidth: 1,
                                borderColor: currentTheme.accentGlow + '60', borderRadius: 4,
                                paddingHorizontal: 4, paddingVertical: 2,
                              }}
                            />
                            <Pressable
                              onPress={handleInteractSubmit}
                              style={{
                                paddingHorizontal: 6, paddingVertical: 3, backgroundColor: currentTheme.accentGlow,
                                borderRadius: 3, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
                              }}
                            >
                              <Text style={{ color: '#000', fontSize: 7, fontWeight: '900', fontFamily: 'monospace' }}>GO</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => { setInteractInputId(null); setInteractInputText(''); }}
                              style={{ paddingHorizontal: 4, paddingVertical: 3, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}
                            >
                              <Text style={{ color: '#9e9e9e', fontSize: 7, fontWeight: '900', fontFamily: 'monospace' }}>✕</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })()}

                    {/* Floor effects overlay */}
                    {floorEffects.map(eff => {
                      const removeEffect = () => setFloorEffects(prev => prev.filter(e => e.id !== eff.id));
                      // React 19 enforces "key must be passed directly,
                      // not via spread" — so the key stays on the JSX
                      // element and the rest of the props ride the spread.
                      const props = { x: eff.x, y: eff.y, onComplete: removeEffect };
                      switch (eff.type) {
                        case 'ripple': return <RippleEffect key={eff.id} {...props} />;
                        case 'confetti': return <ConfettiEffect key={eff.id} {...props} />;
                        case 'rocket': return <RocketEffect key={eff.id} {...props} />;
                        case 'dice': return <DiceEffect key={eff.id} {...props} />;
                        case 'pulse': return <PulseEffect key={eff.id} {...props} />;
                        case 'shake': return <ShakeEffect key={eff.id} {...props} />;
                        case 'fireworks': return <FireworksEffect key={eff.id} {...props} />;
                        default: return null;
                      }
                    })}
                  </View>
                </View>
              </ScrollView>

              {/* Ops board row — live builds + token spend beneath the floor,
                  next to the whiteboard/server-rack column. Hidden when empty. */}
              {(officeBoardHasContent(opsBoard) || officeTrackerHasContent(opsTokenTracker)) ? (
                <View style={styles.opsBoardRow}>
                  <OfficeBuildingNowCard board={opsBoard} style={{ flex: 1.4, minWidth: 260 }} />
                  <OfficeTokensCard tracker={opsTokenTracker} style={{ flex: 1, minWidth: 220 }} />
                </View>
              ) : null}
            </ScrollView>

            {/* Circle Office Panel — all members' bots */}
            {!editMode && (
              <>
                {/* Desktop publish CTA — always show if not yet published */}
                {!mergedCircleAgents.some(a => a.isOwn) && !publishCtaDismissed && (
                  <View style={{ position: 'relative' }}>
                    <Pressable
                      onPress={() => {
                        const conn = connections.find(c => c.enabled);
                        openPublishAgentModal(conn);
                      }}
                      disabled={publishingToCircle}
                      style={[coStyles.publishBtn, { borderColor: accentColor + '44', opacity: publishingToCircle ? 0.6 : 1, marginHorizontal: 8, marginTop: 4 }]}
                    >
                      <Text style={coStyles.publishBtnIcon}>🏢</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[coStyles.publishBtnTitle, { color: accentColor }]}>
                          {publishingToCircle ? 'Publishing...' : 'Add your agent to the Circle Office'}
                        </Text>
                        <Text style={coStyles.publishBtnSub}>
                          {connections.some(c => c.enabled)
                            ? 'Let your circle see your agent and what it\'s building'
                            : 'Register your agent — no gateway required'}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={dismissPublishCta}
                      hitSlop={10}
                      style={({ pressed }: any) => [
                        {
                          position: 'absolute',
                          top: 14,
                          right: 18,
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                        },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '700' }}>×</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}

            {/* Desktop quick bar */}
            {!editMode && (
              <View style={styles.quickBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickBarInner}>
                  {displayAgents.map((agent) => (
                    <Pressable
                      key={agent.id}
                      onPress={() => handleAgentPress(agent)}
                      style={[styles.quickChip,
                        selectedAgent?.id === agent.id && { backgroundColor: agent.color + '20', borderColor: agent.color + '60' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <View style={[styles.quickProviderDot, { backgroundColor: PROVIDER_META[agent.providerType]?.color || '#6f6f6f' }]} />
                      {agent.isProviderMain ? <Text style={[styles.quickMainMark, { color: agent.color || accentColor }]}>★</Text> : null}
                      <View style={[styles.quickDot, {
                        backgroundColor: getOfficeStatusColor(agent.status),
                      }]} />
                      <Text style={[styles.quickName, selectedAgent?.id === agent.id && { color: agent.color }]}>{agent.name}</Text>
                      <Text style={styles.quickCost}>${(agent.costTotal || agent.costToday).toFixed(2)}</Text>
                      {/* O1 (P38): 24h finished-run counts, tone by last outcome. */}
                      {(() => {
                        const acct = opsAccountability?.get(agent.name.trim().toLowerCase());
                        const counts = formatAccountabilityCounts(acct);
                        if (!counts) return null;
                        return (
                          <Text style={[styles.quickCost, { color: acct?.tone === 'danger' ? '#ef4444' : '#22c55e' }]}>
                            {counts}
                          </Text>
                        );
                      })()}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        )}

        <OfficeRuntimeSection
          terminalSize={terminalSize}
          setTerminalSize={setTerminalSize}
          setTerminalInitialTab={setTerminalInitialTab}
          styles={styles}
          accentColor={accentColor}
          OfficeTerminalView={OfficeTerminalView}
          terminalInitialTab={terminalInitialTab}
          terminalInput={terminalInput}
          setTerminalInput={setTerminalInput}
          terminalTargetId={terminalTargetId}
          terminalTargetName={terminalTargetName}
          setTerminalTargetId={setTerminalTargetId}
          setTerminalTargetName={setTerminalTargetName}
          terminalModel={terminalModel}
          setTerminalModel={setTerminalModel}
          terminalTargetIds={terminalTargetIds}
          setTerminalTargetIds={setTerminalTargetIds}
          circleId={circleId}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          mergedCircleAgents={mergedCircleAgents}
          handleCommandSent={handleCommandSent}
          providerKeys={providerKeys}
        />
      </View>

      {/* Agent detail panel (includes bridge status + power controls + remote shell) */}
      {!editMode && (
        <AgentPanel
          agent={selectedAgent}
          onClose={() => { setSelectedAgent(null); setPanelOrigin(null); }}
          isDesktop={isDesktop}
          onRenameAgent={handleRenameAgent}
          onAgentIdentityChange={refreshAgentIdentities}
          onRemoveAgent={handleRemovePublishedAgent}
          sessionTags={sessionTags}
          onAddSessionTag={handleAddSessionTag}
          onRemoveSessionTag={handleRemoveSessionTag}
          circleId={circleId}
          appearances={appearances}
          onAppearanceChange={(id, a) => {
            const identityKey = getAgentIdentityKey(selectedAgent) || id;
            setAppearances(prev => ({ ...prev, [id]: a, [identityKey]: a }));
            void updateAgentIdentity(identityKey, { appearance: a, isCustomized: true });
          }}
          environmentType={currentTheme.environmentType}
          onRunCommand={handleRunCommand}
          popoutOrigin={panelOrigin}
        />
      )}

      {/* Action Result Toast */}
      {showActionResult && (
        <View style={styles.actionResultToast}>
          <Pressable
            onPress={() => setShowActionResult(false)}
            style={[styles.toastClose, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={styles.toastCloseText}>✕</Text>
          </Pressable>
          <Text style={styles.actionResultText}>{actionResult}</Text>
        </View>
      )}

      {/* ─── Manual Agent Publish Modal ───────────────────────────────── */}
      <Modal
        visible={showPublishModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPublishModal(false)}
      >
        <Pressable
          style={pmStyles.overlay}
          onPress={() => setShowPublishModal(false)}
        >
          <Pressable style={pmStyles.modal} onPress={() => {}}>
            <Text style={pmStyles.title}>Add Your Agent</Text>
            <Text style={pmStyles.subtitle}>Register your agent in the Circle Office. It will show as offline until your gateway connects.</Text>

            <Text style={pmStyles.label}>Agent Name</Text>
            <TextInput
              style={pmStyles.input}
              value={publishName}
              onChangeText={setPublishName}
              placeholder="e.g. BlackSwan, Claude Code, Codex..."
              placeholderTextColor="#555"
              autoFocus
              autoCapitalize="words"
            />

            <Text style={pmStyles.label}>Agent Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pmStyles.providerRow}>
              {/* O7 (P39): icon/label come from PROVIDER_META (single source —
                  this array drifted: 🦞 vs 🐾 etc.). Curated agent-type ORDER
                  stays local; 'generic-agent' keeps the friendlier "Other". */}
              {([
                'openswan', 'claude-code', 'codex', 'cursor', 'gemini', 'opencode',
                'aider', 'cline', 'windsurf', 'continue', 'amp', 'generic-agent',
              ] as const).map((key) => ({
                key,
                icon: PROVIDER_META[key]?.icon || '⚡',
                label: key === 'generic-agent' ? 'Other' : (PROVIDER_META[key]?.label || key),
              })).map(p => (
                <Pressable
                  key={p.key}
                  style={[pmStyles.providerChip, publishProvider === p.key && pmStyles.providerChipActive]}
                  onPress={() => setPublishProvider(p.key)}
                >
                  <Text style={pmStyles.providerIcon}>{p.icon}</Text>
                  <Text style={[pmStyles.providerLabel, publishProvider === p.key && pmStyles.providerLabelActive]}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              style={[pmStyles.submitBtn, (!publishName.trim() || publishingToCircle) && pmStyles.submitBtnDisabled]}
              onPress={() => handlePublishToCircle(publishName.trim(), publishProvider)}
              disabled={!publishName.trim() || publishingToCircle}
            >
              <Text style={pmStyles.submitText}>
                {publishingToCircle ? 'Publishing...' : '🏢 Add to Circle Office'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rewards Panel Modal (lazy) */}
      {showRewards && (
        <Modal visible={showRewards} animationType="slide" presentationStyle="pageSheet">
            <RewardsPanel onClose={() => setShowRewards(false)} />
        </Modal>
      )}

      {/* Badge celebration overlay (lazy) */}
      {celebrationBadge && (
          <BadgeCelebration
            badge={celebrationBadge}
            onDismiss={() => setCelebrationBadge(null)}
          />
      )}

      {/* Agent setup wizard (lazy) */}
      {showSetupWizard && (
          <AgentSetupWizard
            visible={showSetupWizard}
            onClose={() => setShowSetupWizard(false)}
            onComplete={(conn) => {
              handleAddConnection(conn);
              setShowSetupWizard(false);
            }}
          />
      )}

      {/* Cloud agent connect modal */}
      {showConnectAgent && (
        <ConnectAgentModal
          circleId={circleId}
          onClose={() => setShowConnectAgent(false)}
        />
      )}

      {/* Customization panel */}
      <CustomizePanel
        visible={showCustomize}
        onClose={() => setShowCustomize(false)}
        currentTheme={currentFloor.themeId}
        onThemeChange={(theme) => handleChangeFloorTheme(currentFloor.id, theme)}
        agents={displayAgents}
        appearances={appearances}
        onAppearanceChange={(id, a) => setAppearances(prev => ({ ...prev, [id]: a }))}
        connections={connections}
        onAddConnection={handleAddConnection}
        onRemoveConnection={handleRemoveConnection}
        onConnectConnection={handleConnectConnection}
        onDisconnectConnection={handleDisconnectConnection}
        telegramConfig={telegramConfig}
        onTelegramConfigChange={setTelegramConfig}
        telegramConnected={telegramConnected}
        telegramBotName={telegramBotName}
        telegramChatTitle={telegramChatTitle}
        onTelegramConnect={handleTelegramConnect}
        onTelegramDisconnect={handleTelegramDisconnect}
        telegramError={telegramError}
        telegramConnecting={telegramConnecting}
        providerKeys={providerKeys}
        onProviderKeysRefresh={refreshProviderKeys}
        budgetConfig={budgetConfig}
        onBudgetConfigChange={handleBudgetConfigChange}
        idleConfig={idleConfig}
        onIdleConfigChange={handleIdleConfigChange}
        customThemes={customThemeRecords}
        onCustomThemesRefresh={refreshCustomThemes}
        circleId={circleId}
        userEmail={userEmail}
      />

      {/* MCP Hub Panel */}
      {showMcpHub && (
        <Modal visible={showMcpHub} animationType="fade" transparent onRequestClose={() => setShowMcpHub(false)}>
          <Pressable style={nftStyles.overlay} onPress={() => setShowMcpHub(false)}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <McpPanel circleId={circleId} onClose={() => setShowMcpHub(false)} />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Image / NFT Picker Modal */}
      <Modal visible={nftPickerVisible} animationType="fade" transparent onRequestClose={() => { setNftPickerVisible(false); setNftPickerTargetId(null); }}>
        <Pressable style={nftStyles.overlay} onPress={() => { setNftPickerVisible(false); setNftPickerTargetId(null); }}>
          <Pressable style={nftStyles.card} onPress={(e) => e.stopPropagation()}>
            <View style={nftStyles.header}>
              <Text style={nftStyles.headerText}>SET IMAGE</Text>
              <Pressable onPress={() => { setNftPickerVisible(false); setNftPickerTargetId(null); }} style={nftStyles.closeBtn}>
                <Text style={nftStyles.closeText}>✕</Text>
              </Pressable>
            </View>

            {/* Tab Switcher */}
            <View style={imgPickerStyles.tabRow}>
              <Pressable
                onPress={() => setImagePickerTab('upload')}
                style={[imgPickerStyles.tab, imagePickerTab === 'upload' && imgPickerStyles.tabActive, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
              >
                <Text style={[imgPickerStyles.tabText, imagePickerTab === 'upload' && imgPickerStyles.tabTextActive]}>
                  📁  UPLOAD IMAGE
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setImagePickerTab('nft'); loadUserNfts(); }}
                style={[imgPickerStyles.tab, imagePickerTab === 'nft' && imgPickerStyles.tabActive, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
              >
                <Text style={[imgPickerStyles.tabText, imagePickerTab === 'nft' && imgPickerStyles.tabTextActive]}>
                  💎  CONNECT NFT
                </Text>
              </Pressable>
            </View>

            {/* Upload Tab */}
            {imagePickerTab === 'upload' && (
              <View style={imgPickerStyles.uploadArea}>
                <Text style={{ fontSize: 40 }}>📤</Text>
                <Text style={imgPickerStyles.uploadTitle}>Upload an image</Text>
                <Text style={imgPickerStyles.uploadHint}>JPG, PNG, GIF, or WebP — max 5 MB</Text>
                <Pressable
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      (fileInputRef.current as any)?.click();
                    }
                  }}
                  style={[imgPickerStyles.uploadBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                >
                  <Text style={imgPickerStyles.uploadBtnText}>CHOOSE FILE</Text>
                </Pressable>
              </View>
            )}

            {/* NFT Tab */}
            {imagePickerTab === 'nft' && (
              <>
                {nftsLoading ? (
                  <View style={nftStyles.emptyState}>
                    <ActivityIndicator color="#e8e8e8" size="large" />
                    <Text style={nftStyles.emptyText}>Loading NFTs...</Text>
                  </View>
                ) : userNfts.length === 0 ? (
                  <View style={nftStyles.emptyState}>
                    <Text style={nftStyles.emptyIcon}>🖼</Text>
                    <Text style={nftStyles.emptyText}>No NFTs found</Text>
                    <Text style={nftStyles.emptyHint}>Connect a wallet with NFTs in your profile.</Text>
                  </View>
                ) : (
                  <ScrollView style={nftStyles.grid} contentContainerStyle={nftStyles.gridContent}>
                    {userNfts.map(nft => (
                      <Pressable key={nft.mint} onPress={() => handleNftSelect(nft)} style={nftStyles.nftCard}>
                        {nft.image ? (
                          <Image source={{ uri: nft.image }} style={nftStyles.nftImage} resizeMode="cover" />
                        ) : (
                          <View style={[nftStyles.nftImage, { backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }]}>
                            <Text style={{ fontSize: 24 }}>🖼</Text>
                          </View>
                        )}
                        <Text style={nftStyles.nftName} numberOfLines={1}>{nft.name}</Text>
                        {nft.collection && <Text style={nftStyles.nftCollection} numberOfLines={1}>{nft.collection}</Text>}
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            {/* Remove image/NFT from frame */}
            {nftPickerTargetId && (() => {
              const currentFloor = floors.find(f => f.id === currentFloorId);
              const item = currentFloor?.furniture.find(f => f.id === nftPickerTargetId);
              if (item?.nftImageUrl) return (
                <Pressable onPress={() => handleNftSelect(null)} style={nftStyles.clearBtn}>
                  <Text style={nftStyles.clearText}>
                    {item.imageSource === 'upload' ? 'REMOVE IMAGE FROM FRAME' : 'REMOVE NFT FROM FRAME'}
                  </Text>
                </Pressable>
              );
              return null;
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Sticky Note Editor Modal ────────────────────────────────────── */}
      <Modal visible={stickyEditorVisible} animationType="fade" transparent onRequestClose={() => { setStickyEditorVisible(false); setStickyEditorTargetId(null); }}>
        <Pressable style={nftStyles.overlay} onPress={() => { setStickyEditorVisible(false); setStickyEditorTargetId(null); }}>
          <Pressable style={[nftStyles.card, { maxWidth: 420, maxHeight: 520 }]} onPress={(e) => e.stopPropagation()}>
            <View style={nftStyles.header}>
              <Text style={nftStyles.headerText}>STICKY NOTE</Text>
              <Pressable onPress={() => { setStickyEditorVisible(false); setStickyEditorTargetId(null); }} style={nftStyles.closeBtn}>
                <Text style={nftStyles.closeText}>✕</Text>
              </Pressable>
            </View>

            {/* Color picker row */}
            <View style={stickyStyles.colorRow}>
              {['#fef08a', '#fca5a5', '#86efac', '#93c5fd', '#c4b5fd', '#fdba74', '#f9a8d4', '#ffffff'].map(c => (
                <Pressable
                  key={c}
                  onPress={() => setStickyColor(c)}
                  style={[stickyStyles.colorDot, { backgroundColor: c }, stickyColor === c && stickyStyles.colorDotActive,
                    Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                />
              ))}
            </View>

            {/* Tab Switcher */}
            <View style={imgPickerStyles.tabRow}>
              {(['write', 'draw', 'gif'] as const).map(t => (
                <Pressable
                  key={t}
                  onPress={() => setStickyTab(t)}
                  style={[imgPickerStyles.tab, stickyTab === t && imgPickerStyles.tabActive, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                >
                  <Text style={[imgPickerStyles.tabText, stickyTab === t && imgPickerStyles.tabTextActive]}>
                    {t === 'write' ? '✏️  WRITE' : t === 'draw' ? '🎨  DRAW' : '🎞  GIF'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Write tab */}
            {stickyTab === 'write' && (
              <View style={stickyStyles.writeArea}>
                <TextInput
                  value={stickyText}
                  onChangeText={setStickyText}
                  placeholder="Type your note..."
                  placeholderTextColor="#666"
                  multiline
                  style={[stickyStyles.textInput, { backgroundColor: stickyColor }]}
                  maxLength={500}
                />
              </View>
            )}

            {/* Draw tab */}
            {stickyTab === 'draw' && Platform.OS === 'web' && (
              <View style={stickyStyles.drawArea}>
                <View style={[stickyStyles.canvasWrap, { backgroundColor: stickyColor }]}>
                  <canvas
                    ref={(el: any) => initStickyCanvas(el)}
                    width={300}
                    height={200}
                    style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair', borderRadius: 4 } as any}
                  />
                </View>
                <Pressable
                  onPress={() => {
                    if (stickyCanvasRef.current) {
                      const ctx = stickyCanvasRef.current.getContext('2d');
                      if (ctx) ctx.clearRect(0, 0, stickyCanvasRef.current.width, stickyCanvasRef.current.height);
                    }
                  }}
                  style={[stickyStyles.clearDrawBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                >
                  <Text style={stickyStyles.clearDrawText}>CLEAR DRAWING</Text>
                </Pressable>
              </View>
            )}

            {/* GIF tab */}
            {stickyTab === 'gif' && (
              <View style={stickyStyles.gifArea}>
                <TextInput
                  value={stickyGifUrl}
                  onChangeText={setStickyGifUrl}
                  placeholder="Paste a GIF URL..."
                  placeholderTextColor="#666"
                  style={stickyStyles.gifInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {stickyGifUrl ? (
                  <View style={[stickyStyles.gifPreview, { backgroundColor: stickyColor }]}>
                    <Image source={{ uri: stickyGifUrl }} style={stickyStyles.gifImage} resizeMode="contain" />
                  </View>
                ) : (
                  <View style={stickyStyles.gifHint}>
                    <Text style={{ fontSize: 32 }}>🎞</Text>
                    <Text style={stickyStyles.gifHintText}>Paste a GIF URL from Giphy, Tenor, etc.</Text>
                  </View>
                )}
              </View>
            )}

            {/* Save button */}
            <Pressable onPress={handleStickyNoteSave} style={[stickyStyles.saveBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}>
              <Text style={stickyStyles.saveBtnText}>SAVE NOTE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── Retro Emulator Modal (lazy) ──────────────────────────────── */}
      {emulatorVisible && (
          <RetroEmulator
            visible={emulatorVisible}
            onClose={() => setEmulatorVisible(false)}
            initialSystem={emulatorSystem}
          />
      )}

      {/* ─── Scrabble Game Modal (lazy) ──────────────────────────────── */}
      {scrabbleVisible && (
          <ScrabbleGame
            visible={scrabbleVisible}
            onClose={() => setScrabbleVisible(false)}
            onStateChange={(state) => {
              const fl = floors.find((f: OfficeFloor) => f.id === currentFloorId);
              const fi = fl?.furniture.find((f: FurnitureItem) => f.type === 'scrabble_board');
              if (fi) {
                fi.scrabbleActive = !state.gameOver;
                fi.scrabbleScore1 = state.score1;
                fi.scrabbleScore2 = state.score2;
                fi.scrabbleTurn = state.turn;
                fi.scrabbleWinner = state.gameOver ? state.winner : undefined;
              }
            }}
          />
      )}

      {/* ─── Poker Game Modal (lazy) ──────────────────────────────────── */}
      {pokerVisible && (
          <PokerGame
            visible={pokerVisible}
            onClose={() => setPokerVisible(false)}
            agents={displayAgents}
            circleId={circleId}
            currentUserId={currentUserId || ''}
            currentUserName={currentUserName || ''}
            onStateChange={(summary) => {
              const fl = floors.find((f: OfficeFloor) => f.id === currentFloorId);
              const fi = fl?.furniture.find((f: FurnitureItem) => f.type === 'poker_table');
              if (fi) {
                fi.pokerChips = summary.playerChips;
                fi.pokerPhase = summary.phase;
                fi.pokerHandsWon = summary.handsWon;
                fi.pokerHandsPlayed = summary.handsPlayed;
              }
            }}
          />
      )}

      {/* ─── Phone Messenger Modal (lazy) ──────────────────────────────── */}
      {phoneVisible && (
          <PhoneMessenger
            visible={phoneVisible}
            onClose={() => setPhoneVisible(false)}
            onUnreadCount={(count) => {
              const fl = floors.find((f: OfficeFloor) => f.id === currentFloorId);
              const fi = fl?.furniture.find((f: FurnitureItem) => f.type === 'message_board');
              if (fi) {
                fi.messageCount = count;
                fi.messageSource = 'imessage';
                fi.messagePreview = 'Connected via BlueBubbles';
              }
            }}
          />
      )}

      {/* ─── Hugging Face Explorer Modal (lazy) ────────────────────────── */}
      {hfExplorerVisible && (
        <Modal visible={hfExplorerVisible} animationType="slide" transparent={false}>
            <HuggingFaceExplorer
              circleId={circleId}
              onClose={() => setHfExplorerVisible(false)}
              onAdded={() => {
                setHfExplorerVisible(false);
                setHfRunnerVisible(true);
              }}
            />
        </Modal>
      )}

      {/* ─── Hugging Face Runner Modal (lazy) ─────────────────────────── */}
      {hfRunnerVisible && (
        <Modal visible={hfRunnerVisible} animationType="slide" transparent={false}>
            <HfToolRunner
              circleId={circleId}
              onClose={() => setHfRunnerVisible(false)}
            />
        </Modal>
      )}

      {/* ─── Service Connector Modal ──────────────────────────────────────── */}
      <Modal visible={serviceModalVisible} animationType="fade" transparent onRequestClose={() => { setServiceModalVisible(false); setServiceModalTargetId(null); }}>
        <Pressable style={nftStyles.overlay} onPress={() => { setServiceModalVisible(false); setServiceModalTargetId(null); }}>
          <Pressable style={[nftStyles.card, { maxHeight: 600 }]} onPress={(e) => e.stopPropagation()}>
            <View style={nftStyles.header}>
              <Text style={nftStyles.headerText}>
                {serviceModalType === 'smart_tv' ? '📺 CONNECT TV' :
                 serviceModalType === 'spotify_jukebox' ? '🎧 CONNECT SPOTIFY' :
                 serviceModalType === 'discord_hub' ? '💬 CONNECT DISCORD' :
                 serviceModalType === 'twitch_stream' ? '🟣 CONNECT TWITCH' :
                 serviceModalType === 'video_call' ? '📹 SET UP CALL' :
                 serviceModalType === 'calendar_widget' ? '📅 CONNECT CALENDAR' :
                 serviceModalType === 'email_hub' ? '📧 CONNECT EMAIL' : '🔗 CONNECT SERVICE'}
              </Text>
              <Pressable onPress={() => { setServiceModalVisible(false); setServiceModalTargetId(null); }} style={nftStyles.closeBtn}>
                <Text style={nftStyles.closeText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
              {/* ── Smart TV ── */}
              {serviceModalType === 'smart_tv' && (
                <>
                  <Text style={svcStyles.sectionLabel}>SELECT APP</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'youtube', name: 'YouTube', icon: '▶', color: '#FF0000', url: 'https://tv.youtube.com' },
                      { id: 'netflix', name: 'Netflix', icon: 'N', color: '#E50914', url: 'https://www.netflix.com' },
                      { id: 'hulu', name: 'Hulu', icon: 'H', color: '#1CE783', url: 'https://www.hulu.com' },
                      { id: 'disney', name: 'Disney+', icon: 'D+', color: '#0063e5', url: 'https://www.disneyplus.com' },
                      { id: 'twitch', name: 'Twitch', icon: '◉', color: '#9146FF', url: 'https://www.twitch.tv' },
                    ] as const).map(app => (
                      <Pressable
                        key={app.id}
                        onPress={() => { setServiceTvApp(app.id); setServiceUrl(app.url); }}
                        style={[svcStyles.appCard, serviceTvApp === app.id && { borderColor: app.color, backgroundColor: app.color + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={[svcStyles.appIcon, { color: app.color }]}>{app.icon}</Text>
                        <Text style={[svcStyles.appName, serviceTvApp === app.id && { color: app.color }]}>{app.name}</Text>
                        {serviceTvApp === app.id && <Text style={[svcStyles.appCheck, { color: app.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  <Text style={svcStyles.sectionLabel}>CONTENT URL (optional)</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={setServiceUrl}
                    placeholder="https://youtube.com/watch?v=..."
                    placeholderTextColor="#444"
                    style={svcStyles.input}
                  />

                  <Text style={svcStyles.sectionLabel}>TV SIZE</Text>
                  <View style={svcStyles.sizeRow}>
                    <View style={svcStyles.sizeField}>
                      <Text style={svcStyles.sizeLabel}>Width</Text>
                      <TextInput value={serviceTvWidth} onChangeText={setServiceTvWidth} keyboardType="number-pad" style={svcStyles.sizeInput} />
                    </View>
                    <Text style={svcStyles.sizeX}>×</Text>
                    <View style={svcStyles.sizeField}>
                      <Text style={svcStyles.sizeLabel}>Height</Text>
                      <TextInput value={serviceTvHeight} onChangeText={setServiceTvHeight} keyboardType="number-pad" style={svcStyles.sizeInput} />
                    </View>
                  </View>

                  <Pressable
                    onPress={() => serviceUrl ? handleServiceOpen(serviceUrl) : null}
                    style={[svcStyles.openBtn, !serviceUrl && { opacity: 0.4 }, Platform.OS === 'web' && { cursor: serviceUrl ? 'pointer' : 'default' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>OPEN {serviceTvApp.toUpperCase()} IN NEW TAB ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Spotify ── */}
              {serviceModalType === 'spotify_jukebox' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>🎧</Text>
                    <Text style={[svcStyles.heroTitle, { color: '#1DB954' }]}>Spotify</Text>
                    <Text style={svcStyles.heroDesc}>Connect your Spotify account to control playback from your office</Text>
                  </View>

                  <Pressable
                    onPress={() => handleServiceOpen('https://open.spotify.com')}
                    style={[svcStyles.connectBtn, { backgroundColor: '#1DB954' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.connectBtnText}>OPEN SPOTIFY ↗</Text>
                  </Pressable>

                  <Text style={svcStyles.sectionLabel}>SPOTIFY URL (playlist, track, or album)</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={setServiceUrl}
                    placeholder="https://open.spotify.com/playlist/..."
                    placeholderTextColor="#444"
                    style={svcStyles.input}
                  />
                </>
              )}

              {/* ── Discord ── */}
              {serviceModalType === 'discord_hub' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>💬</Text>
                    <Text style={[svcStyles.heroTitle, { color: '#5865F2' }]}>Discord</Text>
                    <Text style={svcStyles.heroDesc}>Connect your Discord server to show activity in your office</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>CHANNEL NAME</Text>
                  <TextInput
                    value={serviceDiscordChannel}
                    onChangeText={setServiceDiscordChannel}
                    placeholder="general"
                    placeholderTextColor="#444"
                    style={svcStyles.input}
                  />

                  <Text style={svcStyles.sectionLabel}>DISCORD INVITE OR WEBHOOK URL</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={setServiceUrl}
                    placeholder="https://discord.gg/..."
                    placeholderTextColor="#444"
                    style={svcStyles.input}
                  />

                  <Pressable
                    onPress={() => serviceUrl ? handleServiceOpen(serviceUrl) : handleServiceOpen('https://discord.com/app')}
                    style={[svcStyles.connectBtn, { backgroundColor: '#5865F2' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.connectBtnText}>{serviceUrl ? 'OPEN DISCORD LINK ↗' : 'OPEN DISCORD ↗'}</Text>
                  </Pressable>
                </>
              )}

              {/* ── Twitch ── */}
              {serviceModalType === 'twitch_stream' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>🟣</Text>
                    <Text style={[svcStyles.heroTitle, { color: '#9146FF' }]}>Twitch</Text>
                    <Text style={svcStyles.heroDesc}>Watch or display a Twitch stream in your office</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>TWITCH CHANNEL NAME</Text>
                  <TextInput
                    value={serviceTwitchChannel}
                    onChangeText={setServiceTwitchChannel}
                    placeholder="ninja"
                    placeholderTextColor="#444"
                    style={svcStyles.input}
                  />

                  <Pressable
                    onPress={() => handleServiceOpen(`https://twitch.tv/${serviceTwitchChannel || ''}`)}
                    style={[svcStyles.connectBtn, { backgroundColor: '#9146FF' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.connectBtnText}>OPEN TWITCH ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Video Call ── */}
              {serviceModalType === 'video_call' && (
                <>
                  <Text style={svcStyles.sectionLabel}>SELECT PROVIDER</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'zoom', name: 'Zoom', icon: '🔵', color: '#2D8CFF' },
                      { id: 'meet', name: 'Google Meet', icon: '🟢', color: '#00897B' },
                      { id: 'teams', name: 'MS Teams', icon: '🟣', color: '#6264A7' },
                    ] as const).map(prov => (
                      <Pressable
                        key={prov.id}
                        onPress={() => setServiceCallProvider(prov.id)}
                        style={[svcStyles.appCard, serviceCallProvider === prov.id && { borderColor: prov.color, backgroundColor: prov.color + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={svcStyles.appIcon}>{prov.icon}</Text>
                        <Text style={[svcStyles.appName, serviceCallProvider === prov.id && { color: prov.color }]}>{prov.name}</Text>
                        {serviceCallProvider === prov.id && <Text style={[svcStyles.appCheck, { color: prov.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  <Text style={svcStyles.sectionLabel}>MEETING LINK</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={setServiceUrl}
                    placeholder={serviceCallProvider === 'zoom' ? 'https://zoom.us/j/...' : serviceCallProvider === 'meet' ? 'https://meet.google.com/...' : 'https://teams.microsoft.com/...'}
                    placeholderTextColor="#444"
                    style={svcStyles.input}
                  />

                  <Pressable
                    onPress={() => serviceUrl ? handleServiceOpen(serviceUrl) : null}
                    style={[svcStyles.openBtn, !serviceUrl && { opacity: 0.4 }, Platform.OS === 'web' && { cursor: serviceUrl ? 'pointer' : 'default' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>JOIN CALL ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Google Calendar ── */}
              {serviceModalType === 'calendar_widget' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>📅</Text>
                    <Text style={[svcStyles.heroTitle, { color: serviceCalendarProvider === 'google' ? '#4285F4' : '#0078D4' }]}>
                      {serviceCalendarProvider === 'google' ? 'Google Calendar' : 'Outlook Calendar'}
                    </Text>
                    <Text style={svcStyles.heroDesc}>Connect your real calendar to see upcoming events in your office</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>SELECT PROVIDER</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'google', name: 'Google', icon: '📅', color: '#4285F4', oauth: 'google' as OAuthProvider },
                      { id: 'outlook', name: 'Outlook', icon: '📆', color: '#0078D4', oauth: 'microsoft' as OAuthProvider },
                    ] as const).map(cal => (
                      <Pressable
                        key={cal.id}
                        onPress={() => { setServiceCalendarProvider(cal.id); setOauthStatus(null); setOauthError(''); }}
                        style={[svcStyles.appCard, serviceCalendarProvider === cal.id && { borderColor: cal.color, backgroundColor: cal.color + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={svcStyles.appIcon}>{cal.icon}</Text>
                        <Text style={[svcStyles.appName, serviceCalendarProvider === cal.id && { color: cal.color }]}>{cal.name}</Text>
                        {serviceCalendarProvider === cal.id && <Text style={[svcStyles.appCheck, { color: cal.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  {oauthStatus?.connected && (
                    <View style={{ backgroundColor: '#22c55e10', borderWidth: 1, borderColor: '#22c55e25', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />
                        <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>CONNECTED</Text>
                      </View>
                      {oauthStatus.email ? <Text style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>{oauthStatus.email}</Text> : null}
                      <Pressable
                        onPress={async () => {
                          const prov = serviceCalendarProvider === 'google' ? 'google' : 'microsoft' as OAuthProvider;
                          await disconnectOAuth(prov);
                          setOauthStatus(null);
                        }}
                        style={[{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#ef444415', borderRadius: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#ef444430' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={{ color: '#ef4444', fontSize: 9, fontWeight: '800', fontFamily: 'monospace' }}>DISCONNECT</Text>
                      </Pressable>
                    </View>
                  )}

                  {oauthError ? (
                    <View style={{ backgroundColor: '#ef444410', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <Text style={{ color: '#ef4444', fontSize: 10, fontFamily: 'monospace' }}>{oauthError}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    onPress={async () => {
                      if (oauthConnecting) return;
                      setOauthConnecting(true);
                      setOauthError('');
                      try {
                        const { data: { session } } = await supabase.auth.getSession();
                        if (!session) { setOauthError('Please sign in first'); return; }
                        const prov = serviceCalendarProvider === 'google' ? 'google' : 'microsoft' as OAuthProvider;
                        const result = await openOAuthPopup(prov, 'calendar', session.access_token);
                        if (result.success) {
                          setOauthStatus({ connected: true, email: result.email });
                          // Fetch real events and update furniture
                          const calData = await fetchCalendarEvents(prov);
                          if (calData && calData.nextEvent && serviceModalTargetId) {
                            const updates: Record<string, any> = {
                              calendarProvider: serviceCalendarProvider,
                              calendarEvent: calData.nextEvent.title,
                              calendarTime: calData.nextEvent.timeFormatted || '',
                              calendarEvents: calData.count,
                            };
                            setFloors(prev => prev.map(f =>
                              f.id === currentFloorId ? { ...f, furniture: f.furniture.map(item => item.id === serviceModalTargetId ? { ...item, ...updates } : item) } : f
                            ));
                          }
                        } else if (result.error !== 'Window closed') {
                          setOauthError(result.error || 'Connection failed');
                        }
                      } catch (err: any) {
                        setOauthError(err.message || 'Connection failed');
                      } finally {
                        setOauthConnecting(false);
                      }
                    }}
                    style={[svcStyles.connectBtn, {
                      backgroundColor: oauthConnecting ? '#333' : (serviceCalendarProvider === 'google' ? '#4285F4' : '#0078D4'),
                      flexDirection: 'row', justifyContent: 'center', gap: 8,
                    }, Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any]}
                  >
                    {oauthConnecting && <ActivityIndicator size="small" color="#fff" />}
                    <Text style={svcStyles.connectBtnText}>
                      {oauthConnecting ? 'CONNECTING...' : oauthStatus?.connected ? 'RECONNECT' : `SIGN IN WITH ${serviceCalendarProvider === 'google' ? 'GOOGLE' : 'MICROSOFT'}`}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleServiceOpen(serviceCalendarProvider === 'google' ? 'https://calendar.google.com' : 'https://outlook.live.com/calendar')}
                    style={[svcStyles.openBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>OPEN {serviceCalendarProvider === 'google' ? 'GOOGLE' : 'OUTLOOK'} CALENDAR ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Email Hub ── */}
              {serviceModalType === 'email_hub' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>📧</Text>
                    <Text style={[svcStyles.heroTitle, { color: serviceEmailProvider === 'outlook' ? '#0078D4' : serviceEmailProvider === 'gmail' ? '#EA4335' : '#6001D2' }]}>
                      {serviceEmailProvider === 'outlook' ? 'Outlook' : serviceEmailProvider === 'gmail' ? 'Gmail' : 'Yahoo Mail'}
                    </Text>
                    <Text style={svcStyles.heroDesc}>Connect your real inbox to see emails and unread count in your office</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>SELECT EMAIL PROVIDER</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'outlook', name: 'Outlook', icon: '📧', color: '#0078D4', oauth: 'microsoft' as OAuthProvider, desc: 'Outlook, Hotmail, Live, Work' },
                      { id: 'gmail', name: 'Gmail', icon: '✉️', color: '#EA4335', oauth: 'google' as OAuthProvider, desc: 'Gmail, Google Workspace' },
                      { id: 'yahoo', name: 'Yahoo', icon: '📬', color: '#6001D2', oauth: 'yahoo' as OAuthProvider, desc: 'Yahoo Mail, AOL Mail' },
                    ] as const).map(em => (
                      <Pressable
                        key={em.id}
                        onPress={() => { setServiceEmailProvider(em.id); setOauthStatus(null); setOauthError(''); }}
                        style={[svcStyles.appCard, serviceEmailProvider === em.id && { borderColor: em.color, backgroundColor: em.color + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any, { minWidth: 85 }]}
                      >
                        <Text style={svcStyles.appIcon}>{em.icon}</Text>
                        <Text style={[svcStyles.appName, serviceEmailProvider === em.id && { color: em.color }]}>{em.name}</Text>
                        <Text style={{ color: '#555', fontSize: 7, fontFamily: 'monospace', marginTop: 2, textAlign: 'center' }}>{em.desc}</Text>
                        {serviceEmailProvider === em.id && <Text style={[svcStyles.appCheck, { color: em.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  {oauthStatus?.connected && (
                    <View style={{ backgroundColor: '#22c55e10', borderWidth: 1, borderColor: '#22c55e25', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />
                        <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>CONNECTED</Text>
                      </View>
                      {oauthStatus.email ? <Text style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>{oauthStatus.email}</Text> : null}
                      <Pressable
                        onPress={async () => {
                          const prov = serviceEmailProvider === 'gmail' ? 'google' : serviceEmailProvider === 'outlook' ? 'microsoft' : 'yahoo' as OAuthProvider;
                          await disconnectOAuth(prov);
                          setOauthStatus(null);
                        }}
                        style={[{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#ef444415', borderRadius: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#ef444430' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={{ color: '#ef4444', fontSize: 9, fontWeight: '800', fontFamily: 'monospace' }}>DISCONNECT</Text>
                      </Pressable>
                    </View>
                  )}

                  {oauthError ? (
                    <View style={{ backgroundColor: '#ef444410', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <Text style={{ color: '#ef4444', fontSize: 10, fontFamily: 'monospace' }}>{oauthError}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    onPress={async () => {
                      if (oauthConnecting) return;
                      setOauthConnecting(true);
                      setOauthError('');
                      try {
                        const { data: { session } } = await supabase.auth.getSession();
                        if (!session) { setOauthError('Please sign in first'); return; }
                        const prov = serviceEmailProvider === 'gmail' ? 'google' : serviceEmailProvider === 'outlook' ? 'microsoft' : 'yahoo' as OAuthProvider;
                        const result = await openOAuthPopup(prov, 'email', session.access_token);
                        if (result.success) {
                          setOauthStatus({ connected: true, email: result.email });
                          // Fetch real emails and update furniture
                          const emailData = await fetchEmails(prov);
                          if (emailData && serviceModalTargetId) {
                            const latest = emailData.emails[0];
                            const updates: Record<string, any> = {
                              emailProvider: serviceEmailProvider,
                              emailConnected: true,
                              emailUnread: emailData.unread,
                              emailSender: latest?.sender || '',
                              emailSubject: latest?.subject || 'No new mail',
                              emailTime: latest?.timeFormatted || '',
                            };
                            setFloors(prev => prev.map(f =>
                              f.id === currentFloorId ? { ...f, furniture: f.furniture.map(item => item.id === serviceModalTargetId ? { ...item, ...updates } : item) } : f
                            ));
                          }
                        } else if (result.error !== 'Window closed') {
                          setOauthError(result.error || 'Connection failed');
                        }
                      } catch (err: any) {
                        setOauthError(err.message || 'Connection failed');
                      } finally {
                        setOauthConnecting(false);
                      }
                    }}
                    style={[svcStyles.connectBtn, {
                      backgroundColor: oauthConnecting ? '#333' : (serviceEmailProvider === 'outlook' ? '#0078D4' : serviceEmailProvider === 'gmail' ? '#EA4335' : '#6001D2'),
                      flexDirection: 'row', justifyContent: 'center', gap: 8,
                    }, Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any]}
                  >
                    {oauthConnecting && <ActivityIndicator size="small" color="#fff" />}
                    <Text style={svcStyles.connectBtnText}>
                      {oauthConnecting ? 'CONNECTING...' :
                        oauthStatus?.connected ? 'RECONNECT' :
                        `SIGN IN WITH ${serviceEmailProvider === 'gmail' ? 'GOOGLE' : serviceEmailProvider === 'outlook' ? 'MICROSOFT' : 'YAHOO'}`}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleServiceOpen(
                      serviceEmailProvider === 'outlook' ? 'https://outlook.live.com' :
                      serviceEmailProvider === 'gmail' ? 'https://mail.google.com' :
                      'https://mail.yahoo.com'
                    )}
                    style={[svcStyles.openBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>
                      OPEN {serviceEmailProvider === 'outlook' ? 'OUTLOOK' : serviceEmailProvider === 'gmail' ? 'GMAIL' : 'YAHOO MAIL'} ↗
                    </Text>
                  </Pressable>
                </>
              )}
            </ScrollView>

            {/* Save button */}
            <Pressable onPress={handleServiceSave} style={[svcStyles.saveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
              <Text style={svcStyles.saveBtnText}>SAVE & CONNECT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Hidden file input for web image upload */}
      {Platform.OS === 'web' && (
        <View style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <input
            ref={fileInputRef as any}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
        </View>
      )}
    </View>
  );
}

// ─── Circle Office Panel ──────────────────────────────────────────────────────
// Shows ALL circle members' published agents with their live status.

const CONNECTION_STATUS_UI = {
  connecting:   { label: 'Connecting…',   color: '#f59e0b', dot: '🟡' },
  live:         { label: 'Live',          color: '#22c55e', dot: '🟢' },
  reconnecting: { label: 'Reconnecting…', color: '#f59e0b', dot: '🟡' },
  offline:      { label: 'Offline',       color: '#666',    dot: '⚫' },
} as const;

// Shown on production web where localhost bridges (Claude Code, Codex, Gemini,
// Cursor, OpenSwan) can't be reached. Explains *why* the agent list is empty
// instead of leaving the user staring at an unhelpful blank panel.
/**
 * OfficeConnectBridgesSection — wraps the new ConnectAllBridgesPanel
 * with the per-circle dismiss flag and falls back to the legacy
 * BridgeUnavailableBanner for environments where the bridges
 * truly cannot be reached (e.g. native mobile users on a build that
 * predates the panel).
 */
function OfficeConnectBridgesSection({ circleId }: { circleId: string }) {
  const [dismissed, setDismissed] = useState<boolean>(() => isConnectPanelDismissed(circleId));

  if (dismissed) {
    // After explicit dismiss the legacy banner still surfaces the
    // "no bridges reachable" message in case the env is unreachable.
    return <BridgeUnavailableBanner />;
  }

  return (
    <ConnectAllBridgesPanel
      circleId={circleId}
      onDismiss={() => setDismissed(true)}
    />
  );
}

function BridgeUnavailableBanner() {
  const env = getBridgeEnvironment();
  const [dismissed, setDismissed] = useState(false);
  if (env.available || dismissed) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        backgroundColor: '#161b22',
        borderWidth: 1,
        borderColor: '#30363d',
        borderLeftWidth: 3,
        borderLeftColor: '#6366f1',
        borderRadius: 6,
        padding: 12,
        marginHorizontal: 16,
        marginTop: 8,
      }}
      nativeID="section-office-bridge-unavailable"
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#e6edf3', fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
          Agent bridges can run locally or on any reachable machine
        </Text>
        <Text style={{ color: '#8b949e', fontSize: 12, lineHeight: 18 }}>
          The Office can show local bridges, public bridges, and custom agents running on a Pi,
          VPS, or another machine. On the hosted web app, raw localhost ports are not reachable,
          so purely local bridges will stay empty unless you run the app locally or expose a public bridge URL. Start the UC dev server locally
          (<Text style={{ fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string, color: '#c9d1d9' }}>npm run dev</Text>)
          to see your local agents, or set <Text style={{ fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string, color: '#c9d1d9' }}>EXPO_PUBLIC_BRIDGE_HOST</Text> or a custom public endpoint to reach agents elsewhere.
        </Text>
      </View>
      <Pressable
        onPress={() => setDismissed(true)}
        style={{ padding: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss bridge notice"
      >
        <Text style={{ color: '#8b949e', fontSize: 14 }}>×</Text>
      </Pressable>
    </View>
  );
}

function CircleOfficePanel({
  agents,
  onRefresh,
  accentColor,
  compact = false,
  connectionStatus = 'offline',
}: {
  agents: CircleOfficeAgent[];
  onRefresh: () => void;
  accentColor: string;
  compact?: boolean;
  connectionStatus?: 'connecting' | 'live' | 'reconnecting' | 'offline';
}) {
  const formatBuildMetric = (value: number): string => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 10_000) return `${Math.round(value / 1000)}K`;
    if (value >= 1_000) return `${(value / 1000).toFixed(1)}K`;
    return `${Math.max(0, Math.round(value))}`;
  };

  const getBuildMinutes = (agent: CircleOfficeAgent): number => {
    const ts = new Date(agent.lastActiveAt || agent.updatedAt || Date.now()).getTime();
    if (!Number.isFinite(ts)) return 1;
    const mins = Math.round((Date.now() - ts) / 60000);
    return Math.max(1, Math.min(45, mins));
  };

  const getBuildXp = (agent: CircleOfficeAgent): number => {
    const tokenXp = Math.round(((agent.input_tokens_today || 0) + (agent.output_tokens_today || 0) + ((agent.cached_tokens_today || 0) * 0.35)) / 180);
    const actionXp = (agent.message_count_today || 0) * 26;
    const liveXp = agent.status === 'building' ? getBuildMinutes(agent) * 8 : 0;
    return Math.max(agent.status === 'building' ? 24 : 0, tokenXp + actionXp + liveXp);
  };

  const building = agents.filter(a => a.status === 'building');
  const connected = agents.filter(a => isConnectedOfficeStatus(a.status) && a.status !== 'building');
  const offline = agents.filter(a => !isConnectedOfficeStatus(a.status));
  const totalBuildingXp = building.reduce((sum, agent) => sum + getBuildXp(agent), 0);

  if (compact) {
    // Horizontal strip for desktop — scrollable row of agent chips
    return (
      <View style={coStyles.compactBar}>
        <Text style={coStyles.compactLabel}>🏢 Circle Office</Text>
        <View style={[coStyles.connectionDot, { backgroundColor: CONNECTION_STATUS_UI[connectionStatus].color, marginRight: 4 }]} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={coStyles.compactScroll}>
          {agents.map(agent => {
            const display = PROVIDER_DISPLAY[agent.provider] || PROVIDER_DISPLAY['generic-agent'];
            const statusColor = agent.status === 'building' ? '#22c55e' : getOfficeStatusColor(agent.status);
            const buildXp = getBuildXp(agent);
            return (
              <View key={agent.id} style={[coStyles.compactChip, { borderColor: display.color + '44' }]}>
                {/* Live pulse for building */}
                {agent.status === 'building' && (
                  <View style={[coStyles.buildingDot, { backgroundColor: '#22c55e' }]} />
                )}
                <Text style={coStyles.compactIcon}>{display.icon}</Text>
                <View>
                  <Text style={coStyles.compactOwner}>{agent.ownerDisplayName}</Text>
                  <Text style={coStyles.compactAgentName} numberOfLines={1}>{agent.name}</Text>
                  {agent.status === 'building' && (
                    <Text style={coStyles.compactBuildXp}>BUILDING · +{formatBuildMetric(buildXp)} XP</Text>
                  )}
                </View>
                <View style={[coStyles.statusDot, { backgroundColor: statusColor }]} />
                {agent.status === 'building' && agent.currentTask && (
                  <Text style={coStyles.compactTask} numberOfLines={1}>{agent.currentTask}</Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // Sort: connected agents first, then unavailable, with most recent first within each group
  const sorted = [...agents].sort((a, b) => {
    const rankDiff = getOfficeStatusSortRank(a.status) - getOfficeStatusSortRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime();
  });

  const onlineCount = agents.filter(a => isConnectedOfficeStatus(a.status)).length;

  // Full card view for mobile
  return (
    <View style={coStyles.panel}>
      <View style={coStyles.panelHeader}>
        <View>
          <Text style={coStyles.panelTitle}>🏢 Circle Office</Text>
          <View style={coStyles.connectionRow}>
            <View style={[coStyles.connectionDot, { backgroundColor: CONNECTION_STATUS_UI[connectionStatus].color }]} />
            <Text style={[coStyles.connectionLabel, { color: CONNECTION_STATUS_UI[connectionStatus].color }]}>
              {CONNECTION_STATUS_UI[connectionStatus].label}
            </Text>
          </View>
        </View>
        <View style={coStyles.panelStats}>
          {building.length > 0 && <Text style={coStyles.statBuilding}>⚡ {building.length} BUILDING · +{formatBuildMetric(totalBuildingXp)} XP</Text>}
          {connected.length > 0 && <Text style={coStyles.statIdle}>🟢 {connected.length} connected</Text>}
          {offline.length > 0 && <Text style={coStyles.statOffline}>⚫ {offline.length} away</Text>}
        </View>
      </View>

      {sorted.map(agent => {
        const display = PROVIDER_DISPLAY[agent.provider] || PROVIDER_DISPLAY['generic-agent'];
        const isBuilding = agent.status === 'building';
        const isConnected = isConnectedOfficeStatus(agent.status) && !isBuilding;
        const isOffline = !isConnectedOfficeStatus(agent.status) && !isBuilding;
        const lastSeen = getLastSeen(agent.lastActiveAt);
        const buildXp = getBuildXp(agent);
        const buildMinutes = getBuildMinutes(agent);
        const buildTokens = (agent.input_tokens_today || 0) + (agent.output_tokens_today || 0) + (agent.cached_tokens_today || 0);
        const buildActions = agent.message_count_today || 0;

        return (
          <View
            key={agent.id}
            style={[
              coStyles.agentCard,
              isBuilding && coStyles.buildingAgentCard,
              { borderColor: isBuilding ? display.color + '66' : isConnected ? display.color + '33' : '#000000' },
              isBuilding && { backgroundColor: display.color + '10' },
              agent.isOwn && coStyles.ownAgentCard,
              isOffline && coStyles.offlineCard,
            ]}
          >
            {/* Header row */}
            <View style={coStyles.agentCardHeader}>
              <View style={[coStyles.providerBadge, { backgroundColor: display.color + '22', borderColor: display.color + '44' }]}>
                <Text style={coStyles.providerIcon}>{display.icon}</Text>
                <Text style={[coStyles.providerLabel, { color: display.color }]}>{display.label}</Text>
              </View>
              <View style={coStyles.statusChip}>
                <View style={[coStyles.statusDot, {
                  backgroundColor: isBuilding ? '#3b82f6' : isConnected ? '#22c55e' : '#333',
                }]} />
                <Text style={[coStyles.statusText, isBuilding && coStyles.statusTextBuilding, isOffline && { color: '#444' }]}>
                  {isBuilding ? 'BUILDING NOW' : isConnected ? 'connected' : lastSeen.text}
                </Text>
              </View>
            </View>

            {/* Owner + agent name */}
            <View style={coStyles.agentIdentity}>
              <View style={[coStyles.ownerAvatar, { backgroundColor: display.color + '33' }]}>
                <Text style={coStyles.ownerAvatarText}>{agent.ownerDisplayName[0]?.toUpperCase()}</Text>
              </View>
              <View>
                <Text style={coStyles.agentName}>{agent.name}</Text>
                <Text style={coStyles.ownerName}>
                  {agent.isOwn ? '👤 Your agent' : `👤 ${agent.ownerDisplayName}`}
                </Text>
              </View>
            </View>

            {/* Live task if building */}
            {isBuilding && agent.currentTask && (
              <View style={[coStyles.taskBlock, { borderLeftColor: display.color }]}>
                <Text style={coStyles.taskLabel}>BUILDING</Text>
                <Text style={coStyles.taskText}>{agent.currentTask}</Text>
                {agent.currentGoal && (
                  <Text style={coStyles.goalText}>🎯 {agent.currentGoal}</Text>
                )}
                <View style={coStyles.buildStatRow}>
                  <View style={[coStyles.buildStatPill, { borderColor: display.color + '55', backgroundColor: display.color + '18' }]}>
                    <Text style={coStyles.buildStatValue}>+{formatBuildMetric(buildXp)}</Text>
                    <Text style={coStyles.buildStatLabel}>BUILD XP</Text>
                  </View>
                  <View style={coStyles.buildStatPill}>
                    <Text style={coStyles.buildStatValue}>{formatBuildMetric(buildActions)}</Text>
                    <Text style={coStyles.buildStatLabel}>ACTIONS</Text>
                  </View>
                  <View style={coStyles.buildStatPill}>
                    <Text style={coStyles.buildStatValue}>{formatBuildMetric(buildTokens)}</Text>
                    <Text style={coStyles.buildStatLabel}>TOKENS</Text>
                  </View>
                  <View style={coStyles.buildStatPill}>
                    <Text style={coStyles.buildStatValue}>{buildMinutes}M</Text>
                    <Text style={coStyles.buildStatLabel}>HOT</Text>
                  </View>
                </View>
                <Text style={coStyles.buildingFlavor}>
                  BUILDING hard. The work is live and momentum is compounding.
                </Text>
              </View>
            )}

            {/* Session URL */}
            {agent.sessionUrl && (
              <Pressable onPress={() => Linking.openURL(agent.sessionUrl!)} style={coStyles.sessionLink}>
                <Text style={[coStyles.sessionLinkText, { color: display.color }]}>
                  🔗 Watch live →
                </Text>
              </Pressable>
            )}

            {agent.returnTime && isBuilding && (
              <Text style={coStyles.returnTime}>Back: {agent.returnTime}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Manual Publish Modal Styles ──────────────────────────────────────────────
const pmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000bb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#000000',
    borderRadius: 16,
    padding: 24,
    width: 340,
    maxWidth: '90%',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: '#6f6f6f',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 20,
  },
  label: {
    color: '#a3a3a3',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    marginBottom: 18,
  },
  providerRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
    marginBottom: 20,
  },
  providerChip: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    minWidth: 64,
  },
  providerChipActive: {
    backgroundColor: '#6366f115',
    borderColor: '#6366f1',
  },
  providerIcon: { fontSize: 20, marginBottom: 4 },
  providerLabel: { color: '#6f6f6f', fontSize: 10, fontWeight: '600' },
  providerLabelActive: { color: '#6366f1' },
  submitBtn: {
    backgroundColor: '#252525',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: '#2a2a2a',
    opacity: 0.6,
  },
  submitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

const coStyles = StyleSheet.create({
  // Compact (desktop)
  compactBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    backgroundColor: '#000000',
    gap: 10,
  },
  compactLabel: { color: '#444', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  compactScroll: { flexDirection: 'row', gap: 8 },
  compactChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, backgroundColor: '#0a0a0a',
    position: 'relative',
  },
  buildingDot: {
    position: 'absolute', top: 4, right: 4,
    width: 6, height: 6, borderRadius: 3,
  },
  compactIcon: { fontSize: 14 },
  compactOwner: { color: '#888', fontSize: 10 },
  compactAgentName: { color: '#ccc', fontSize: 12, fontWeight: '600', maxWidth: 80 },
  compactBuildXp: { color: '#60a5fa', fontSize: 9, fontWeight: '800', marginTop: 1, letterSpacing: 0.4 },
  compactTask: { color: '#555', fontSize: 11, maxWidth: 120, fontStyle: 'italic' },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, marginLeft: 2 },

  // Full card (mobile)
  panel: { paddingHorizontal: 4, paddingBottom: 8 },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
  },
  panelTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  connectionDot: { width: 7, height: 7, borderRadius: 3.5 },
  connectionLabel: { fontSize: 11, fontWeight: '600' },
  panelStats: { flexDirection: 'row', gap: 10 },
  statBuilding: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  statIdle: { color: '#f59e0b', fontSize: 12 },
  statOffline: { color: '#444', fontSize: 12 },

  agentCard: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 10, marginHorizontal: 4,
  },
  buildingAgentCard: {
    shadowColor: '#3b82f6',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ownAgentCard: { borderStyle: 'dashed' },
  offlineCard: { opacity: 0.6 },

  agentCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  providerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  providerIcon: { fontSize: 14 },
  providerLabel: { fontSize: 11, fontWeight: '700' },

  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { color: '#666', fontSize: 12 },
  statusTextBuilding: { color: '#60a5fa', fontWeight: '900', letterSpacing: 0.6 },

  agentIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  ownerAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  ownerAvatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  agentName: { color: '#ddd', fontSize: 14, fontWeight: '700' },
  ownerName: { color: '#555', fontSize: 12 },

  taskBlock: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 8 },
  taskLabel: { color: '#60a5fa', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginBottom: 4 },
  taskText: { color: '#ddd', fontSize: 14, lineHeight: 20 },
  goalText: { color: '#888', fontSize: 12, marginTop: 4 },
  buildStatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 8 },
  buildStatPill: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2c3344',
    backgroundColor: '#111827',
  },
  buildStatValue: { color: '#f8fafc', fontSize: 12, fontWeight: '900' },
  buildStatLabel: { color: '#7dd3fc', fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginTop: 1 },
  buildingFlavor: { color: '#93c5fd', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  sessionLink: { marginBottom: 4 },
  sessionLinkText: { fontSize: 12, fontWeight: '600' },
  returnTime: { color: '#444', fontSize: 11 },

  publishBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 8, padding: 14,
    backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1,
    borderStyle: 'dashed',
  },
  publishBtnIcon: { fontSize: 24 },
  publishBtnTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  publishBtnSub: { color: '#555', fontSize: 12 },
});

const nftStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', alignItems: 'center' },
  card: { width: 380, maxHeight: 500, backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#2a2a2a' },
  headerText: { color: '#eee', fontSize: 14, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 2 },
  closeBtn: { padding: 6 },
  closeText: { color: '#666', fontSize: 16 },
  emptyState: { padding: 40, alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: '#888', fontSize: 14, fontFamily: 'monospace', fontWeight: '700' },
  emptyHint: { color: '#555', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', lineHeight: 16 },
  grid: { maxHeight: 380 },
  gridContent: { flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 },
  nftCard: { width: '30%' as any, backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden', padding: 4, alignItems: 'center' },
  nftImage: { width: '100%' as any, aspectRatio: 1, borderRadius: 6 },
  nftName: { color: '#ccc', fontSize: 9, fontFamily: 'monospace', fontWeight: '700', marginTop: 4, textAlign: 'center' },
  nftCollection: { color: '#555', fontSize: 7, fontFamily: 'monospace', textAlign: 'center' },
  clearBtn: { margin: 12, padding: 10, backgroundColor: '#2a2a2a', borderRadius: 8, alignItems: 'center' },
  clearText: { color: '#9e9e9e', fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
});

const imgPickerStyles = StyleSheet.create({
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#2a2a2a' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#000000' },
  tabActive: { backgroundColor: '#0a0a0a', borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabText: { color: '#555', fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  tabTextActive: { color: '#eee' },
  uploadArea: { padding: 40, alignItems: 'center', gap: 12 },
  uploadTitle: { color: '#ccc', fontSize: 14, fontFamily: 'monospace', fontWeight: '700' },
  uploadHint: { color: '#555', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' },
  uploadBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#6366f1', borderRadius: 8 },
  uploadBtnText: { color: '#e8e8e8', fontSize: 11, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
});

const stickyStyles = StyleSheet.create({
  colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#2a2a2a' },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#333' },
  colorDotActive: { borderColor: '#fff', borderWidth: 3 },
  writeArea: { padding: 12, flex: 1 },
  textInput: {
    minHeight: 140, borderRadius: 6, padding: 12,
    color: '#000000', fontSize: 14, fontFamily: 'monospace',
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  drawArea: { padding: 12, alignItems: 'center', gap: 8 },
  canvasWrap: { width: '100%' as any, height: 200, borderRadius: 6, overflow: 'hidden' },
  clearDrawBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#333', backgroundColor: '#000000',
  },
  clearDrawText: { color: '#888', fontSize: 9, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  gifArea: { padding: 12, gap: 10 },
  gifInput: {
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#222',
    borderRadius: 8, padding: 10, color: '#ddd', fontSize: 12, fontFamily: 'monospace',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  gifPreview: { height: 150, borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  gifImage: { width: '100%' as any, height: '100%' as any },
  gifHint: { height: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  gifHintText: { color: '#555', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' },
  saveBtn: {
    margin: 12, paddingVertical: 12, borderRadius: 8, backgroundColor: '#252525',
    alignItems: 'center',
  },
  saveBtnText: { color: '#e8e8e8', fontSize: 12, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
});

// ─── Service Connector Modal Styles ──────────────────────────────────────────
const svcStyles = StyleSheet.create({
  sectionLabel: {
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 16,
  },
  appGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  appCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 72,
    position: 'relative',
  },
  appIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  appName: {
    color: '#aaa',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  appCheck: {
    position: 'absolute',
    top: 4,
    right: 6,
    fontSize: 12,
    fontWeight: '900',
  },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sizeField: {
    flex: 1,
    alignItems: 'center',
  },
  sizeLabel: {
    color: '#666',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 4,
  },
  sizeInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
    width: '100%',
  },
  sizeX: {
    color: '#555',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
  },
  openBtn: {
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  openBtnText: {
    color: '#e8e8e8',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  serviceHero: {
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '900',
    fontFamily: 'monospace',
    marginTop: 8,
  },
  heroDesc: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
    maxWidth: 260,
  },
  connectBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  saveBtn: {
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    color: '#e8e8e8',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  tagsActionBtn: {
    flex: 1,
    backgroundColor: '#6366f118',
    borderWidth: 1,
    borderColor: '#6366f140',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tagsActionBtnSecondary: {
    backgroundColor: '#ffffff10',
    borderColor: '#ffffff20',
  },
  tagsActionBtnText: {
    color: '#6366f1',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  tagsActionBtnTextSecondary: { color: '#6366f1' },
  toolbarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6,
    backgroundColor: '#181818', borderWidth: 1, borderColor: '#2a2a2a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  toolbarBtnActiveGreen: {
    borderColor: '#ffffff20', backgroundColor: '#ffffff10',
  },
  toolbarBtnActiveMemory: {
    backgroundColor: '#22c55e18',
    borderColor: '#22c55e40',
  },
  toolbarBtnIcon: { fontSize: 13 },
  toolbarBtnText: { fontSize: 11, fontWeight: '700', color: '#888', fontFamily: 'monospace' },
  toolbarBtnTextActiveMemory: { color: '#22c55e' },
  reconnectBtnStyle: {
    backgroundColor: '#ffffff08', borderColor: '#ffffff15',
  },
  tgBadge: { fontSize: 7, marginRight: 1 },

  // Office enhancement panels
  enhancementRow: {
    flexDirection: 'row' as const, alignItems: 'stretch' as const,
    gap: 4, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#050508',
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  feedPanel: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#050508',
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },

  // Combined floor + actions bar
  floorBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#000000',
    gap: 8,
    position: 'relative',
    zIndex: 40,
    overflow: 'visible',
  },
  floorList: { gap: 4, flexDirection: 'row', alignItems: 'center' },
  barActions: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0, zIndex: 50, overflow: 'visible' },
  officeDashboardPanels: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    flexWrap: 'wrap',
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
    zIndex: 1,
  },
  officeDashboardPanel: {
    minWidth: 220,
    maxWidth: 360,
    flexShrink: 1,
  },
  soundPanelWrap: {
    maxWidth: 220,
  },
  floorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 5, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000000',
  },
  floorChipActive: {
    borderColor: '#ffffff30', backgroundColor: '#ffffff10',
  },
  floorChipText: {
    fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: '600',
  },
  floorChipTextActive: {
    color: '#fff', fontWeight: '700',
  },
  floorThemeDot: {
    width: 7, height: 7, borderRadius: 4,
  },
  floorAgentBadge: {
    backgroundColor: '#ffffff10',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floorAgentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6366f1',
    fontFamily: 'monospace',
  },
  floorAddBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 6, borderWidth: 1, borderColor: '#6366f130', backgroundColor: '#6366f115',
  },
  floorAddBtnText: {
    fontSize: 11, color: '#6366f1', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1,
  },

  // Connections bar
  connectionsBar: {
    paddingHorizontal: 12, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a', backgroundColor: '#000000',
    flexDirection: 'row', alignItems: 'center',
  },
  connectionsToggle: { paddingRight: 8, paddingVertical: 2 },
  connectionsToggleText: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  connectionsBarInner: { gap: 8, flexDirection: 'row', alignItems: 'center', flex: 1 },
  connectionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0a0a0a',
  },
  connectionChipDot: { width: 6, height: 6, borderRadius: 3 },
  connectionChipStatus: { width: 5, height: 5, borderRadius: 3 },
  connectionChipName: { fontSize: 11, color: '#ccc', fontFamily: 'monospace', fontWeight: '600', maxWidth: 120 },
  connectionChipLabel: { fontSize: 9, fontFamily: 'monospace', fontWeight: '600' },
  connectionChipLocal: { fontSize: 10, marginLeft: 2 },
  connectionAddChip: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1,
    borderColor: '#ffffff20', backgroundColor: '#ffffff08',
    alignItems: 'center', justifyContent: 'center',
  },
  connectionAddChipText: { fontSize: 14, color: '#6366f1', fontWeight: '700' },

  editToolbar: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a',
  },
  editLabel: { fontSize: 8, color: '#888', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  editItems: { gap: 8, flexDirection: 'row', paddingRight: 12 },
  editItem: {
    alignItems: 'center', justifyContent: 'center',
    width: 88, height: 88,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#2a2a2a', backgroundColor: '#000000',
    gap: 3, paddingHorizontal: 4, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  editItemActive: {
    borderColor: '#ffffff30', backgroundColor: '#ffffff10',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 12px rgba(99,102,241,0.3)' } as any : {}),
  },
  editItemIcon: { fontSize: 28 },
  editItemName: { fontSize: 10, color: '#aaa', fontFamily: 'monospace', fontWeight: '800', textAlign: 'center' },
  editItemDesc: { fontSize: 8, color: '#555', fontFamily: 'monospace', maxWidth: 80, textAlign: 'center', lineHeight: 10 },
  editToolbarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  editToolbarActions: { flexDirection: 'row', gap: 6 },
  editActionBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  editActionBtnText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  editCatalogWrap: {
    position: 'relative' as const,
  },
  editCatTabs: {
    flexDirection: 'row' as const, gap: 6, paddingBottom: 8, paddingRight: 12,
  },
  editCatTab: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    backgroundColor: '#0a0a0a',
  },
  editCatTabText: {
    fontSize: 8, fontFamily: 'monospace', fontWeight: '800' as const, letterSpacing: 1,
  },
  editCatTabCount: {
    fontSize: 7, fontFamily: 'monospace', fontWeight: '700' as const,
  },
  editCatRowWrap: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
  },
  editScrollArrow: {
    width: 24, height: 80, borderRadius: 6, borderWidth: 1,
    backgroundColor: '#0a0a0a90', alignItems: 'center' as const, justifyContent: 'center' as const,
    zIndex: 2,
  },
  editScrollArrowLeft: { marginRight: 4 },
  editScrollArrowRight: { marginLeft: 4 },
  editScrollArrowText: {
    fontSize: 22, fontWeight: '700' as const,
  },
  floorChipWrap: { position: 'relative', flexDirection: 'row', alignItems: 'center', marginRight: 6 },
  floorChipWithDelete: { paddingRight: 18 },
  floorDeleteBtn: {
    position: 'absolute',
    right: 2,
    top: '50%',
    marginTop: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#160b0b',
    borderWidth: 1,
    borderColor: '#ef444455',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  floorDeleteBtnText: { fontSize: 8, color: '#ef4444', fontWeight: '800', lineHeight: 16 },
  clearBtn: {
    marginTop: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4,
    backgroundColor: '#ffffff10', alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  clearBtnText: { fontSize: 8, color: '#9e9e9e', fontFamily: 'monospace', fontWeight: '700' },
  mainContent: { flex: 1 },

  // Mobile agent cards
  mobileAgentScroll: { flex: 1 },
  mobileAgentList: { padding: 16, gap: 12 },
  mobileEmpty: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12,
  },
  mobileEmptyIcon: { fontSize: 40 },
  mobileEmptyTitle: { fontSize: 18, color: '#999', fontFamily: 'monospace', fontWeight: '800' },
  mobileEmptyText: { fontSize: 14, color: '#666', fontFamily: 'monospace', textAlign: 'center', paddingHorizontal: 24 },
  mobileEmptyBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#252525', minHeight: 48,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mobileEmptyBtnText: { fontSize: 14, color: '#e8e8e8', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 },
  mobileAgentCard: {
    backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 14, padding: 16, gap: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mobileCardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  mobileCardAvatar: {
    width: 48, height: 48, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  mobileCardAvatarText: { fontSize: 20, fontWeight: '900', fontFamily: 'monospace' },
  mobileCardInfo: { flex: 1, gap: 3 },
  mobileCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mobileCardName: { fontSize: 16, fontWeight: '800', color: '#eee', fontFamily: 'monospace' },
  mobileCardMainBadge: { fontSize: 10, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
  mobileCardStatus: { width: 8, height: 8, borderRadius: 4 },
  mobileCardStatusText: { fontSize: 12, fontFamily: 'monospace', fontWeight: '600', textTransform: 'uppercase' as any },
  mobileCardRole: { fontSize: 13, color: '#888', fontFamily: 'monospace' },
  mobileCardModel: { fontSize: 12, color: '#666', fontFamily: 'monospace' },
  mobileCardRight: { alignItems: 'flex-end', gap: 2 },
  mobileCardCost: { fontSize: 16, fontWeight: '900', color: '#22d3ee', fontFamily: 'monospace' },
  mobileCardCostLabel: { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  mobileCardActivity: { fontSize: 13, color: '#777', fontFamily: 'monospace', paddingLeft: 62 },
  officeScroll: { flex: 1 },
  // Ops board (Building Now + Tokens) — desktop row beneath the office floor
  opsBoardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  officeScaleOuter: { overflow: 'hidden' },
  officeWrapper: { position: 'relative', transformOrigin: 'top left' as any },
  emptyOverlay: {
    position: 'absolute', top: '35%' as any, left: 0, right: 0, alignItems: 'center', zIndex: 20, gap: 6, paddingHorizontal: 20,
  },
  emptyIcon: { fontSize: 28 },
  emptyTitle: { fontSize: 13, color: '#666', fontFamily: 'monospace', fontWeight: '800', textAlign: 'center' },
  emptyText: { fontSize: 10, color: '#555', fontFamily: 'monospace', textAlign: 'center' },
  emptySub: { fontSize: 9, color: '#444', fontFamily: 'monospace', fontStyle: 'italic', textAlign: 'center' },
  desktopWidgetPlaceholder: {
    position: 'absolute', top: 12, right: 12, minWidth: 148, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#05050bcc', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 10, zIndex: 6,
  },
  desktopWidgetPlaceholderRack: {
    top: 104,
  },
  desktopWidgetPlaceholderTitle: {
    fontSize: 10, color: '#7a7a8a', fontFamily: 'monospace', fontWeight: '700',
  },
  agentPosition: { position: 'absolute', zIndex: 10 },
  quickBar: {
    borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingVertical: 6, paddingHorizontal: 8,
  },
  quickBarInner: { gap: 6, flexDirection: 'row' },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8,
    paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000000',
  },
  quickProviderDot: { width: 4, height: 4, borderRadius: 2 },
  quickMainMark: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace' },
  quickDot: { width: 4, height: 4, borderRadius: 2 },
  quickName: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  quickCost: { fontSize: 8, color: '#444', fontFamily: 'monospace' },
  chatToggle: {
    borderTopWidth: 1, borderTopColor: '#2a2a2a',
    backgroundColor: '#0a0a0a',
  },
  terminalBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 12, gap: 12,
  },
  terminalBarBtn: {
    paddingVertical: 4, paddingHorizontal: 12,
  },
  terminalLoader: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#040409',
  },
  terminalLoaderText: {
    fontSize: 12, color: '#7a7a8a', fontFamily: 'monospace',
  },
  chatToggleText: { fontSize: 13, color: '#888', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 },
  terminalSizeButtons: {
    flexDirection: 'row', gap: 4,
  },
  terminalSizeBtn: {
    width: 32, height: 28, borderRadius: 6,
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  terminalSizeBtnActive: {
    borderColor: '#6366f1', backgroundColor: '#6366f115',
  },
  terminalSizeBtnText: {
    fontSize: 12, color: '#555',
  },
  terminalSizeBtnTextActive: {
    color: '#6366f1',
  },
  chatPane: { height: 320 },

  // Action Result Toast
  actionResultToast: {
    position: 'absolute',
    bottom: 280,
    left: 12,
    right: 12,
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    zIndex: 1000,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  toastClose: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff10',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1001,
  },
  toastCloseText: {
    fontSize: 12,
    color: '#999',
    fontWeight: '700',
  },
  actionResultText: {
    fontSize: 12,
    color: '#fff',
    fontFamily: 'monospace',
    lineHeight: 18,
    paddingRight: 32,
  },
  terminalFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    backgroundColor: '#000',
  },
  terminalFullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#000000',
  },
  terminalFullscreenBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#ffffff08',
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  terminalFullscreenBtnText: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});

// ─── Filter chip row above the agent list ───────────────────────────────────

const officeFilterChipStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#0a0a0a',
  },
  chipActive: {
    borderColor: '#ffffff',
    backgroundColor: '#141414',
  },
  label: {
    color: '#a3a3a3',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  labelActive: {
    color: '#ffffff',
  },
  count: {
    color: '#525252',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: '#000000',
    minWidth: 16,
    textAlign: 'center',
  },
  countActive: {
    color: '#ffffff',
    backgroundColor: '#1f1f1f',
  },
});
