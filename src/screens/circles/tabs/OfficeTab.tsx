import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image,
  useWindowDimensions, Platform, Linking, Modal, TextInput,
} from 'react-native';
import OfficeFloorView, { DESK_POSITIONS, FLOOR_W, FLOOR_H } from './office/OfficeFloor';
import PixelAgent from './office/PixelAgent';
import ServerRack from './office/ServerRack';
import Whiteboard from './office/Whiteboard';
import AgentPanel from './office/AgentPanel';
import CustomizePanel, { TelegramConfig } from './office/CustomizePanel';
import type { OfficeCommand } from './office/OfficeChat';
import { OfficeAgent, DEFAULT_AGENT, sessionsToAgents } from '../../../lib/officeAgents';
import {
  OFFICE_THEMES, AgentAppearance, FurnitureItem, FURNITURE_CATALOG,
  OfficeFloor, DEFAULT_FLOORS, createDefaultFloor, OfficeTheme, UC_AGENT_APPEARANCE,
  generateRandomAppearance, OWNER_EMAIL,
} from '../../../lib/officeConfig';
import { useCustomThemes, customThemeToOfficeTheme, CUSTOM_THEME_PREFIX, CustomThemeRecord } from '../../../services/customThemes';
import { enrichAgentsWithCache, enrichSessionsWithCache, takeSnapshot, loadSessionTags as loadCachedTags } from '../../../lib/sessionCache';
import { restoreAllAgents, recordAgentActivity, renameAgent as renameAgentIdentity } from '../../../lib/agentIdentity';
import {
  verifyBot, getChat, TelegramPoller, TelegramMessage,
} from '../../../lib/telegramService';
import {
  OpenClawConfig, OpenClawPoller, OpenClawSession, OpenClawUpdate,
  testConnection, listAgents, listCronJobs, CronJob,
} from '../../../lib/openclawService';
import {
  AgentConnection, loadConnections, saveConnections, PROVIDER_META,
} from '../../../lib/connectionManager';
import {
  ClaudeCodePoller, bridgeSessionsToAgents, detectClaudeCodeBridge,
  publishClaudeCodeAgent, updateClaudeCodeAgentStatus, markClaudeCodeAgentOffline,
} from '../../../lib/claudeCodeDetector';
import { storage } from '../../../lib/storage';
import { loadTrendingContent } from '../../../lib/trendingContent';
import {
  SessionTag, loadSessionTags, addSessionTag, removeSessionTag,
} from '../../../lib/sessionTags';
import {
  BudgetConfig, loadBudgetConfig, saveBudgetConfig, calculateBudgetAlerts,
} from '../../../lib/budgetAlerts';
import BudgetAlertBanner from '../../../components/BudgetAlertBanner';
import { calculatePeriodCosts } from '../../../lib/costCalculations';
import OfficeActionPanel from '../../../components/OfficeActionPanel';
import AgentActivityFeed from '../../../components/AgentActivityFeed';
import HitlApprovalBanner from '../../../components/HitlApprovalBanner';
import { useAgentApprovals } from '../../../services/hitlService';
import {
  CircleOfficeAgent,
  loadCircleOfficeAgents,
  publishAgentToCircle,
  subscribeToCircleOffice,
  PROVIDER_DISPLAY,
  createBlackSwanAgent,
  BLACKSWAN_AGENT_ID,
} from '../../../lib/circleOffice';
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
import OfficeTerminal from '../../../components/OfficeTerminal';
import {
  subscribeToTerminalCommands,
  respondToCommand,
  cleanupTerminalChannels,
  updateAgentAnalytics,
  sendTerminalCommand,
  BroadcastCommandPayload,
} from '../../../lib/officeTerminal';
import {
  invokeAndStream,
  invokeAllAgents,
  invokeSelectedAgents,
} from '../../../lib/agentInvocation';
import { useUserApiKeys } from '../../../lib/llmProviders';
import {
  IdleBehaviorConfig, loadIdleConfig, saveIdleConfig,
  startIdleScheduler, stopIdleScheduler, getDefaultIdleConfig,
} from '../../../lib/idleBehaviors';
import { supabase } from '../../../lib/supabase';
import { fetchNFTs } from '../../../lib/crypto';
import { NFT } from '../../../types';
import AgentSetupWizard from '../../../components/AgentSetupWizard';
import BadgeCelebration from '../../../components/BadgeCelebration';
import RewardsPanel from '../../../components/RewardsPanel';
import { useAllAgentPointsTracker, useUserRewards } from '../../../services/rewardService';
import { Badge, getNextBadge } from '../../../lib/badges';

const STORAGE_KEY_TELEGRAM = '@office_telegram_config';
const STORAGE_KEY_AGENT_NAMES = '@office_agent_names';
const STORAGE_KEY_FLOORS = '@office_floors';
const STORAGE_KEY_FLOORS_TS = '@office_floors_updated_at';
const STORAGE_KEY_CURRENT_FLOOR = '@office_current_floor';
const STORAGE_KEY_APPEARANCES = '@office_appearances';
const STORAGE_KEY_WHITEBOARD_NOTES = '@office_whiteboard_notes';

// Track whether Supabase profile columns exist (migrations may not be run yet)
// Once a write fails with 400, stop retrying to avoid console spam
let _profileHasOfficeLayout = true;
let _profileHasAgentAppearance = true;

export interface AgentStats {
  agentCount: number;
  sessionCount: number;
  costToday: number;
  costWeek: number;
  tokens: number;
}

interface Props {
  circleId: string;
  accentColor: string;
  onAgentStats?: (stats: AgentStats) => void;
}

export default function OfficeTab({ circleId, accentColor, onAgentStats }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<OfficeAgent | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [celebrationBadge, setCelebrationBadge] = useState<Badge | null>(null);
  const [dancingAgentId, setDancingAgentId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | undefined>();
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const pendingApprovals = useAgentApprovals(circleId);

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
  const [connectionsCollapsed, setConnectionsCollapsed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [whiteboardNotes, setWhiteboardNotes] = useState<string[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [terminalSize, setTerminalSize] = useState<'closed' | 'half' | 'full'>('closed');
  // ─── Shared terminal state — both the tab view and the bottom drawer
  //     use these so input/target stay in sync (true mirror behaviour) ──────
  const [terminalInput, setTerminalInput]         = useState('');
  const [terminalTargetId, setTerminalTargetId]   = useState<string | null>('blackswan-default');
  const [terminalTargetName, setTerminalTargetName] = useState('@BlackSwan');
  const [terminalModel, setTerminalModel]         = useState<string | null>('blackswan');
  const [terminalTargetIds, setTerminalTargetIds] = useState<string[] | null>(['blackswan-default']);
  const [statusHistory, setStatusHistory] = useState<Array<OfficeAgent[]>>([]);
  const [enrichedAgents, setEnrichedAgents] = useState<OfficeAgent[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const viewMode = 'office'; // Simplified — analytics dashboards moved to Backpack tab
  const [sessionTags, setSessionTags] = useState<Map<string, SessionTag[]>>(new Map());
  const [budgetConfig, setBudgetConfig] = useState<BudgetConfig>({ enabled: false });
  const [idleConfig, setIdleConfig] = useState<IdleBehaviorConfig>(getDefaultIdleConfig());
  const idleConfigRef = useRef<IdleBehaviorConfig>(getDefaultIdleConfig());
  const { keys: providerKeys, refresh: refreshProviderKeys } = useUserApiKeys();
  const [budgetAlertsDismissed, setBudgetAlertsDismissed] = useState(false);
  const [actionResult, setActionResult] = useState<string>('');
  const [showActionResult, setShowActionResult] = useState(false);
  const [enrichedSessions, setEnrichedSessions] = useState<OpenClawSession[]>([]);

  // ─── Multi-floor state ──────────────────────────────
  const [floors, setFloors] = useState<OfficeFloor[]>(DEFAULT_FLOORS);
  const [currentFloorId, setCurrentFloorId] = useState<string>('floor_1');

  // ─── Image / NFT picker state ───────────────────────────────────────────
  const [nftPickerVisible, setNftPickerVisible] = useState(false);
  const [nftPickerTargetId, setNftPickerTargetId] = useState<string | null>(null);
  const [userNfts, setUserNfts] = useState<NFT[]>([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [imagePickerTab, setImagePickerTab] = useState<'upload' | 'nft'>('upload');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Sticky note editor state ───────────────────────────────────────────
  const [stickyEditorVisible, setStickyEditorVisible] = useState(false);
  const [stickyEditorTargetId, setStickyEditorTargetId] = useState<string | null>(null);
  const [stickyTab, setStickyTab] = useState<'write' | 'draw' | 'gif'>('write');
  const [stickyText, setStickyText] = useState('');
  const [stickyColor, setStickyColor] = useState('#fef08a');
  const [stickyGifUrl, setStickyGifUrl] = useState('');
  const [stickyGifSearch, setStickyGifSearch] = useState('');
  const stickyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stickyDrawingRef = useRef(false);

  // ─── Setup wizard ─────────────────────────────────────────────────────────
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  // ─── Multi-connection state ──────────────────────────────
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const pollersRef = useRef<Map<string, OpenClawPoller>>(new Map());
  const sessionsRef = useRef<Map<string, OpenClawSession[]>>(new Map());
  const [sessionsTick, setSessionsTick] = useState(0); // force re-render on session updates
  const ccPollerRef = useRef<ClaudeCodePoller | null>(null);
  const ccPublishedRef = useRef(false);

  // ─── Current user ─────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUserName, setCurrentUserName] = useState<string>('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
        supabase.from('profiles')
          .select('display_name, username')
          .eq('id', data.user.id)
          .single()
          .then(({ data: profile }) => {
            setCurrentUserName(profile?.display_name || profile?.username || 'Agent');
          });
      }
    });
  }, []);

  // ─── Circle Office (shared agents from all members) ──────────────────────
  const [circleOfficeAgents, setCircleOfficeAgents] = useState<CircleOfficeAgent[]>([]);
  const [publishingToCircle, setPublishingToCircle] = useState(false);

  const loadCircleOffice = useCallback(async () => {
    const { agents } = await loadCircleOfficeAgents(circleId);
    setCircleOfficeAgents(agents);
  }, [circleId]);

  useEffect(() => {
    loadCircleOffice();
    const unsub = subscribeToCircleOffice(circleId, loadCircleOffice);
    return unsub;
  }, [circleId, loadCircleOffice]);

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
      startHeartbeat(circleId, connectedConns).then(() => loadCircleOffice());

      // Build live agent states from connections
      const myAgents: AgentLiveState[] = connectedConns.map(conn => ({
        agentId: conn.id,
        name: conn.name,
        provider: conn.provider,
        toolIcon: PROVIDER_DISPLAY[conn.provider]?.icon || '🤖',
        color: conn.color || PROVIDER_DISPLAY[conn.provider]?.color || '#6366f1',
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
          loadCircleOffice();
        },
        onLeave: (userId) => {
          setLiveUserIds(prev => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
          setTimeout(() => loadCircleOffice(), 3000);
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
  }, [circleId, connections.filter(c => c.status === 'connected').length]);

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
        invokeAllAgents(baseReq, myAgents)
          .catch(err => console.error('[OfficeTab] Multi-agent invocation failed:', err));
      }
    }
  }, [circleId, currentUserId, circleOfficeAgents]);

  // ─── Terminal command subscription ────────────────────────────────────────
  // Listen for commands targeting my agents + BlackSwan; invoke accordingly
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
      const baseReq = {
        messageId: cmd.messageId,
        circleId,
        command: cmd.commandText,
        senderId: cmd.senderId,
        targetAgentName: cmd.targetAgentName,
        model: cmd.model,
      };

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
            'http://localhost:18790'
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
            'http://localhost:18790'
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
            'http://localhost:18790'
          ).catch(err => console.error('[OfficeTab] Multi-agent invocation failed:', err));
        }
      }
    });

    return () => {
      unsub();
      cleanupTerminalChannels(circleId);
    };
  }, [circleId, currentUserId, circleOfficeAgents.filter(a => a.ownerId === currentUserId).length]);

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
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishProvider, setPublishProvider] = useState('openclaw');

  const handlePublishToCircle = useCallback(async (
    overrideName?: string,
    overrideProvider?: string
  ) => {
    if (publishingToCircle) return;

    // Prefer passed values → connected conn → modal values → defaults
    const conn = connections.find(c => c.enabled);
    const display = PROVIDER_DISPLAY[overrideProvider || publishProvider || conn?.provider || 'openclaw']
      || PROVIDER_DISPLAY['generic-agent'];

    const agentName    = overrideName     || conn?.name     || publishName || 'My Agent';
    const agentProvider= overrideProvider || conn?.provider || publishProvider || 'openclaw';
    const agentColor   = conn?.color      || display.color;

    setPublishingToCircle(true);
    try {
      await publishAgentToCircle({
        circleId,
        provider: agentProvider,
        name: agentName,
        color: agentColor,
        toolIcon: display.icon,
      });
      await loadCircleOffice();
      setShowPublishModal(false);
    } finally {
      setPublishingToCircle(false);
    }
  }, [circleId, connections, publishingToCircle, loadCircleOffice, publishName, publishProvider]);

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
        }).then(() => loadCircleOffice());
      }
    }
  }, [circleId, connections.filter(c => c.status === 'connected').length, loadCircleOffice]);

  // ─── Telegram state ──────────────────────────────
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>({ botToken: '', chatId: '' });
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramBotName, setTelegramBotName] = useState<string | null>(null);
  const [telegramChatTitle, setTelegramChatTitle] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const tgPollerRef = useRef<TelegramPoller | null>(null);

  // ─── Connection helpers ──────────────────────────────

  const connectOne = useCallback(async (conn: AgentConnection) => {
    // Update status to connecting
    setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, status: 'connecting' as const, error: undefined } : c));

    const config: OpenClawConfig = { endpoint: conn.endpoint, token: conn.token };
    const result = await testConnection(config);

    if (!result.ok) {
      setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, status: 'error' as const, error: result.error || 'Connection failed' } : c));
      return;
    }

    // Store initial sessions
    sessionsRef.current.set(conn.id, result.sessions || []);

    // Fetch agent ids
    let agentIds: string[] = [];
    const agentsResult = await listAgents(config);
    if (agentsResult.ok && agentsResult.agents) agentIds = agentsResult.agents;

    // Update connection status
    setConnections(prev => prev.map(c => c.id === conn.id ? {
      ...c,
      status: 'connected' as const,
      error: undefined,
      sessionCount: (result.sessions || []).length,
      agentIds,
      lastConnected: new Date().toISOString(),
    } : c));

    // Start poller
    const oldPoller = pollersRef.current.get(conn.id);
    if (oldPoller) oldPoller.stop();

    const poller = new OpenClawPoller(config, (update: OpenClawUpdate) => {
      sessionsRef.current.set(conn.id, update.sessions);
      setConnections(prev => prev.map(c => c.id === conn.id && c.status === 'connected' ? {
        ...c, sessionCount: update.sessions.length,
      } : c));
      setSessionsTick(t => t + 1);
    });
    poller.start(10000);
    pollersRef.current.set(conn.id, poller);

    setSessionsTick(t => t + 1);
  }, []);

  const disconnectOne = useCallback((connId: string) => {
    const poller = pollersRef.current.get(connId);
    if (poller) { poller.stop(); pollersRef.current.delete(connId); }
    sessionsRef.current.delete(connId);
    setConnections(prev => prev.map(c => c.id === connId ? {
      ...c, status: 'disconnected' as const, error: undefined, sessionCount: undefined, agentIds: undefined,
    } : c));
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

  const getConnectionConfig = useCallback((id: string): OpenClawConfig | null => {
    const conn = connections.find(c => c.id === id && c.status === 'connected');
    if (!conn) return null;
    return { endpoint: conn.endpoint, token: conn.token };
  }, [connections]);

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

    storage.setItem(STORAGE_KEY_TELEGRAM, JSON.stringify({
      botToken: botToken.trim(), chatId: chatId.trim(),
    })).catch(() => {});
  }, [telegramConfig]);

  const handleTelegramDisconnect = useCallback(() => {
    if (tgPollerRef.current) { tgPollerRef.current.stop(); tgPollerRef.current = null; }
    setTelegramConnected(false);
    setTelegramBotName(null);
    setTelegramChatTitle(null);
    setTelegramMessages([]);
    setTelegramError(null);
  }, []);

  // ─── Load saved connections on mount ──────────────────────────────

  const floorsInitializedRef = useRef(false);
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      // Load connections
      const conns = await loadConnections();
      setConnections(conns);

      // Auto-connect all enabled connections
      // NOTE: We always attempt localhost connections — when the user browses from
      // their own machine, localhost in the browser points to their local proxy.
      for (const conn of conns) {
        if (conn.enabled) {
          connectOne(conn);
        }
      }

      // Load custom agent names
      try {
        const namesRaw = await storage.getItem(STORAGE_KEY_AGENT_NAMES);
        if (namesRaw) setAgentNames(JSON.parse(namesRaw));
      } catch {}

      // Load Telegram config
      try {
        const tgRaw = await storage.getItem(STORAGE_KEY_TELEGRAM);
        if (tgRaw) {
          const tg = JSON.parse(tgRaw);
          if (tg.botToken || tg.chatId) {
            setTelegramConfig({ botToken: tg.botToken || '', chatId: tg.chatId || '' });
          }
        }
      } catch {}

      // Load floors — localStorage + Supabase merge (newest wins by timestamp)
      let localFloors: OfficeFloor[] = [];
      let localCurrentFloorId = '';
      let localUpdatedAt = 0;
      try {
        const floorsRaw = await storage.getItem(STORAGE_KEY_FLOORS);
        if (floorsRaw) {
          const loadedFloors = JSON.parse(floorsRaw) as OfficeFloor[];
          if (loadedFloors.length > 0) {
            localFloors = loadedFloors;
          }
        }
        const tsRaw = await storage.getItem(STORAGE_KEY_FLOORS_TS);
        if (tsRaw) localUpdatedAt = parseInt(tsRaw, 10) || 0;
      } catch {}

      // Load current floor
      try {
        const currentFloorRaw = await storage.getItem(STORAGE_KEY_CURRENT_FLOOR);
        if (currentFloorRaw) {
          localCurrentFloorId = currentFloorRaw;
        }
      } catch {}

      // Try loading from Supabase — compare timestamps, newest wins
      // Column may not exist yet — detect and disable future attempts
      let bestFloors = localFloors;
      let bestFloorId = localCurrentFloorId;
      try {
        const { data: { user: floorUser } } = await supabase.auth.getUser();
        if (floorUser && _profileHasOfficeLayout) {
          const { data: layoutData, error: layoutErr } = await supabase.from('profiles').select('office_layout').eq('id', floorUser.id).single();
          if (layoutErr) {
            _profileHasOfficeLayout = false;
          } else {
            const remote = layoutData?.office_layout as { floors?: OfficeFloor[]; currentFloorId?: string; updatedAt?: number } | null;
            if (remote?.floors && remote.floors.length > 0) {
              const remoteUpdatedAt = remote.updatedAt || 0;
              // Use remote only if it has a strictly newer timestamp
              // If timestamps match or are both missing, prefer whichever has more furniture
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
        }
      } catch {}

      // Apply the winning data
      if (bestFloors.length > 0) setFloors(bestFloors);
      if (bestFloorId) setCurrentFloorId(bestFloorId);

      // Floors are now loaded — enable persistence useEffect
      floorsInitializedRef.current = true;

      // Load agent appearances — Supabase + localStorage merge
      // Column may not exist yet — detect and disable future attempts
      try {
        const appearancesRaw = await storage.getItem(STORAGE_KEY_APPEARANCES);
        const local = appearancesRaw ? JSON.parse(appearancesRaw) : {};
        const { data: { user } } = await supabase.auth.getUser();
        if (user && _profileHasAgentAppearance) {
          const { data, error: appErr } = await supabase.from('profiles').select('agent_appearance').eq('id', user.id).single();
          if (appErr) {
            _profileHasAgentAppearance = false;
            if (Object.keys(local).length > 0) setAppearances(local);
          } else {
            const remote = data?.agent_appearance || {};
            const merged = { ...local, ...remote };
            setAppearances(merged);
          }
        } else if (Object.keys(local).length > 0) {
          setAppearances(local);
        }
      } catch {
        try {
          const appearancesRaw = await storage.getItem(STORAGE_KEY_APPEARANCES);
          if (appearancesRaw) setAppearances(JSON.parse(appearancesRaw));
        } catch {}
      }
      appearancesLoadedRef.current = true;

      // Load whiteboard notes
      try {
        const notesRaw = await storage.getItem(STORAGE_KEY_WHITEBOARD_NOTES);
        if (notesRaw) setWhiteboardNotes(JSON.parse(notesRaw));
      } catch {}

      // Load session tags from both sources and merge
      Promise.all([
        loadSessionTags(),
        loadCachedTags()
      ]).then(([primaryTags, cachedTags]) => {
        // Merge: primary tags take precedence
        const merged = new Map(cachedTags);
        primaryTags.forEach((tags, key) => {
          merged.set(key, tags);
        });
        setSessionTags(merged);
      });

      // Load budget config + idle behaviors config
      loadBudgetConfig().then(setBudgetConfig);
      loadIdleConfig().then(cfg => { setIdleConfig(cfg); idleConfigRef.current = cfg; });

      // Auto-detect Claude Code bridge (zero config — no OpenClaw needed)
      detectClaudeCodeBridge().then(detected => {
        if (detected && !ccPollerRef.current) {
          ccPollerRef.current = new ClaudeCodePoller(sessions => {
            sessionsRef.current.set('claude-code-auto', bridgeSessionsToAgents(sessions) as any);
            setSessionsTick(t => t + 1);
            // Publish to circle_office_agents DB on first detection
            if (!ccPublishedRef.current && circleId) {
              ccPublishedRef.current = true;
              publishClaudeCodeAgent(circleId, sessions.length)
                .then(() => loadCircleOffice())
                .catch(err => console.error('[OfficeTab] Failed to publish Claude Code agent:', err));
            }
            // Update live status on each poll
            if (ccPublishedRef.current && circleId) {
              updateClaudeCodeAgentStatus(circleId, sessions).catch(() => {});
            }
          });
          ccPollerRef.current.start(5000);
        }
      });
    })();
  }, [connectOne]);

  // Retry Claude Code bridge detection every 30s (user may start bridge after app)
  // Also detects bridge going offline and marks agent accordingly
  useEffect(() => {
    const retryInterval = setInterval(async () => {
      const detected = await detectClaudeCodeBridge();

      if (detected && !ccPollerRef.current) {
        // Bridge came online — start poller
        ccPollerRef.current = new ClaudeCodePoller(sessions => {
          sessionsRef.current.set('claude-code-auto', bridgeSessionsToAgents(sessions) as any);
          setSessionsTick(t => t + 1);
          if (!ccPublishedRef.current && circleId) {
            ccPublishedRef.current = true;
            publishClaudeCodeAgent(circleId, sessions.length)
              .then(() => loadCircleOffice())
              .catch(err => console.error('[OfficeTab] Failed to publish Claude Code agent:', err));
          }
          if (ccPublishedRef.current && circleId) {
            updateClaudeCodeAgentStatus(circleId, sessions).catch(() => {});
          }
        });
        ccPollerRef.current.start(5000);
      } else if (!detected && ccPollerRef.current) {
        // Bridge went offline — stop poller, keep agent visible as idle
        ccPollerRef.current.stop();
        ccPollerRef.current = null;
        // Don't remove from sessionsRef — keep the pixel agent showing as idle
        // Just update all agents to idle status
        const existing = sessionsRef.current.get('claude-code-auto') as unknown as OfficeAgent[] | undefined;
        if (existing && existing.length > 0) {
          const idled = existing.map(a => ({ ...a, status: 'idle' as const, activity: 'Session ended — idling' }));
          sessionsRef.current.set('claude-code-auto', idled as any);
          setSessionsTick(t => t + 1);
        }
        if (ccPublishedRef.current && circleId) {
          markClaudeCodeAgentOffline(circleId)
            .then(() => loadCircleOffice())
            .catch(() => {});
        }
      }
    }, 30000);
    return () => clearInterval(retryInterval);
  }, [circleId, loadCircleOffice]);

  // Cleanup pollers on unmount
  useEffect(() => {
    return () => {
      pollersRef.current.forEach(p => p.stop());
      pollersRef.current.clear();
      if (tgPollerRef.current) tgPollerRef.current.stop();
      if (ccPollerRef.current) {
        ccPollerRef.current.stop();
        ccPollerRef.current = null;
      }
      // Mark Claude Code agent idle (not offline) when tab unmounts — stays visible for 1 hour
      if (ccPublishedRef.current && circleId) {
        markClaudeCodeAgentOffline(circleId).catch(() => {});
      }
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
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase.from('profiles').update({
            office_layout: { floors, currentFloorId, updatedAt: now }
          }).eq('id', user.id).then(
            ({ error }) => { if (error) _profileHasOfficeLayout = false; },
            () => { _profileHasOfficeLayout = false; },
          );
        }
      }).catch(() => {});
    }
  }, [floors, currentFloorId]);

  const { width: winW } = useWindowDimensions();
  const isDesktop = winW > 900;

  // Get current floor data with safety checks (must be before agent filtering)
  const matchedFloor = floors.find(f => f.id === currentFloorId);
  const currentFloor = matchedFloor || floors[0] || DEFAULT_FLOORS[0];
  const currentTheme = resolveTheme(currentFloor?.themeId || 'underground');

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
  let indexOffset = 0;
  for (const conn of connectedConns) {
    const sessions = sessionsRef.current.get(conn.id) || [];
    const connAgents = sessionsToAgents(sessions, conn.id, conn.name, conn.provider);
    rawAgents.push(...connAgents);
    indexOffset += connAgents.length;
  }
  // Merge auto-detected Claude Code sessions (bridge on localhost:7778)
  const ccAutoAgents = sessionsRef.current.get('claude-code-auto') as unknown as OfficeAgent[] | undefined;
  if (ccAutoAgents && ccAutoAgents.length > 0) {
    rawAgents.push(...ccAutoAgents);
  }

  // Merge DB-backed agents that have no corresponding live session
  // This keeps idle/building agents visible as pixel agents even when the bridge disconnects
  const liveAgentNames = new Set(rawAgents.map(a => a.name));
  const myDbAgents = mergedCircleAgents.filter(a =>
    a.ownerId === currentUserId && a.status !== 'offline' && !liveAgentNames.has(a.name)
  );
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
      costToday: 0,
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
    });
  }

  // Apply custom names
  const allAgents = rawAgents.map(a => agentNames[a.id] ? { ...a, name: agentNames[a.id] } : a);

  // Use enriched agents if available (has cached costs/tokens), fallback to fresh agents
  const userAgents = enrichedAgents.length > 0 ? enrichedAgents : allAgents;
  // Always include the default UC Agent alongside user agents
  const displayAgents = [DEFAULT_AGENT, ...userAgents];

  // Resolve appearance — UC Agent gets crab look, user agents use stored appearances
  const getAppearance = (agent: OfficeAgent) =>
    agent.id === DEFAULT_AGENT.id ? (appearances[agent.name] || UC_AGENT_APPEARANCE) : appearances[agent.name];

  // Auto-assign random outfits to new agents (only after appearances have loaded from storage)
  useEffect(() => {
    if (!appearancesLoadedRef.current) return;
    const newAppearances: Record<string, AgentAppearance> = {};
    for (const agent of userAgents) {
      if (!appearances[agent.name]) {
        newAppearances[agent.name] = generateRandomAppearance();
      }
    }
    if (Object.keys(newAppearances).length > 0) {
      setAppearances(prev => ({ ...prev, ...newAppearances }));
    }
  }, [userAgents.map(a => a.name).join(',')]); // re-run only when agent list changes

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

  // Filter agents for current floor — but if none are assigned yet, show all on current floor
  const floorFilteredAgents = displayAgents.filter(a => currentFloor?.agentIds?.includes(a.id));
  const agents = floorFilteredAgents.length > 0 ? floorFilteredAgents : displayAgents;

  // Auto-assign new agents to first floor (runs only when agent count changes)
  const prevAgentCountRef = useRef(0);
  useEffect(() => {
    if (displayAgents.length === 0 || floors.length === 0) return;
    if (displayAgents.length === prevAgentCountRef.current) return;
    prevAgentCountRef.current = displayAgents.length;

    const allAgentIds = displayAgents.map(a => a.id);
    const assignedIds = new Set(floors.flatMap(f => f.agentIds));
    const unassignedIds = allAgentIds.filter(id => !assignedIds.has(id));

    if (unassignedIds.length > 0) {
      setFloors(prev => {
        const targetFloorId = prev.some(f => f.id === currentFloorId) ? currentFloorId : prev[0].id;
        return prev.map((f) =>
          f.id === targetFloorId ? { ...f, agentIds: [...f.agentIds, ...unassignedIds] } : f
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAgents.length]);

  // Update status history when agents change
  useEffect(() => {
    if (enrichedAgents.length > 0) {
      setStatusHistory(prev => [...prev, enrichedAgents].slice(-10));
    }
  }, [enrichedAgents]);

  // Enrich agents with cached data + restore identity
  useEffect(() => {
    const doEnrich = async () => {
      if (allAgents.length === 0) {
        setEnrichedAgents([]);
        return;
      }
      
      try {
        // Step 1: Enrich with session cache (costs/tokens from current session)
        const cacheEnriched = await enrichAgentsWithCache(allAgents);
        
        // Step 2: Restore persistent identity (all-time data, custom names, etc.)
        const fullyEnriched = await restoreAllAgents(cacheEnriched);
        
        setEnrichedAgents(fullyEnriched);
        
        // Step 3: Record activity for each agent (updates identity store)
        for (const agent of fullyEnriched) {
          await recordAgentActivity(agent);
        }
        
        // Step 4: Save snapshot to cache
        await takeSnapshot(fullyEnriched, sessionTags);
      } catch (error) {
        console.error('Failed to enrich agents:', error);
        setEnrichedAgents(allAgents);
      }
    };
    doEnrich();
  }, [sessionsTick, agentNames, sessionTags]);

  // Enrich sessions for Cost Dashboard
  useEffect(() => {
    const allSessions: OpenClawSession[] = [];
    for (const conn of connectedConns) {
      const sessions = sessionsRef.current.get(conn.id) || [];
      allSessions.push(...sessions);
    }

    if (allSessions.length === 0) {
      setEnrichedSessions([]);
      return;
    }

    enrichSessionsWithCache(allSessions).then(enriched => {
      setEnrichedSessions(enriched);
    }).catch(err => {
      console.error('Failed to enrich sessions:', err);
      setEnrichedSessions(allSessions); // Fallback to raw sessions
    });
  }, [sessionsTick]); // Only re-run when sessions actually update

  // Periodic snapshot save (every 30 seconds)
  useEffect(() => {
    if (enrichedAgents.length === 0) return;
    
    const interval = setInterval(async () => {
      try {
        await takeSnapshot(enrichedAgents, sessionTags);
      } catch (error) {
        console.error('Failed to save snapshot:', error);
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [enrichedAgents]);

  // Push agent stats to parent (use enrichedAgents for accurate totals)
  useEffect(() => {
    if (onAgentStats && enrichedAgents.length > 0) {
      onAgentStats({
        agentCount: enrichedAgents.length,
        sessionCount: enrichedAgents.filter(a => a.status === 'active').length,
        costToday: enrichedAgents.reduce((s, a) => s + a.costToday, 0),
        costWeek: enrichedAgents.reduce((s, a) => s + a.costWeek, 0),
        tokens: enrichedAgents.reduce((s, a) => s + a.tokensUsed, 0),
      });
    }
  }, [enrichedAgents, onAgentStats]);

  // Save appearances when changed — localStorage + Supabase
  useEffect(() => {
    if (Object.keys(appearances).length > 0) {
      storage.setItem(STORAGE_KEY_APPEARANCES, JSON.stringify(appearances)).catch(() => {});
      // Async push to Supabase (skip if column doesn't exist)
      if (_profileHasAgentAppearance) {
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) {
            supabase.from('profiles').update({ agent_appearance: appearances }).eq('id', user.id).then(
              ({ error }) => { if (error) _profileHasAgentAppearance = false; },
              () => { _profileHasAgentAppearance = false; },
            );
          }
        }).catch(() => {});
      }
    }
  }, [appearances]);

  // Save whiteboard notes when changed
  useEffect(() => {
    if (whiteboardNotes.length > 0) {
      storage.setItem(STORAGE_KEY_WHITEBOARD_NOTES, JSON.stringify(whiteboardNotes)).catch(() => {});
    }
  }, [whiteboardNotes]);

  // Fetch cron jobs from all connected OpenClaw instances
  const connectedCount = connections.filter(c => c.status === 'connected').length;
  useEffect(() => {
    if (connectedCount === 0) return;
    const fetchCron = async () => {
      const allJobs: CronJob[] = [];
      for (const conn of connections.filter(c => c.status === 'connected')) {
        if (conn.provider !== 'openclaw') continue;
        const config: OpenClawConfig = { endpoint: conn.endpoint, token: conn.token };
        const result = await listCronJobs(config);
        if (result.ok) allJobs.push(...result.jobs);
      }
      setCronJobs(allJobs);
    };
    fetchCron();
    const interval = setInterval(fetchCron, 60_000);
    return () => clearInterval(interval);
  }, [connectedCount]);

  // Scale
  const availableW = winW - 24;
  const rawScale = availableW / FLOOR_W;
  const officeScale = Math.max(0.55, rawScale);
  const scaledH = FLOOR_H * officeScale;
  const needsHScroll = rawScale < 0.55;

  const handleAgentPress = (agent: OfficeAgent) => {
    if (editMode) return;
    setSelectedAgent(prev => prev?.id === agent.id ? null : agent);
  };

  const handleFloorPress = (x: number, y: number) => {
    if (!editMode) return;
    // If something is selected and user taps floor, deselect
    if (selectedFurnitureId) { setSelectedFurnitureId(null); return; }
    if (!placingType) return;
    const newFurniture = { id: `f_${Date.now()}`, type: placingType as any, x, y };
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
    ctx.strokeStyle = '#1a1a1a';
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

  const handleCommand = (cmd: OfficeCommand) => {
    if (cmd.type === 'theme') handleChangeFloorTheme(currentFloor.id, cmd.value);
    if (cmd.type === 'info') {
      const agent = agents.find(a => a.name === cmd.query);
      if (agent) setSelectedAgent(agent);
    }
  };

  const handleRenameAgent = useCallback(async (agentId: string, newName: string) => {
    // Extract sessionKey from agentId
    const sessionKey = agentId.includes('::') ? agentId.split('::')[1] : agentId;
    
    // Save to agent identity system (persistent across reconnections)
    await renameAgentIdentity(sessionKey, newName);
    
    // Also update legacy agentNames for backward compatibility
    const updated = { ...agentNames, [agentId]: newName };
    setAgentNames(updated);
    storage.setItem(STORAGE_KEY_AGENT_NAMES, JSON.stringify(updated)).catch(() => {});
    
    // Update selected agent if it's the one being renamed
    if (selectedAgent?.id === agentId) {
      setSelectedAgent(prev => prev ? { ...prev, name: newName } : null);
    }
  }, [agentNames, selectedAgent]);

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

  const handleActionResult = useCallback((message: string) => {
    setActionResult(message);
    setShowActionResult(true);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setShowActionResult(false);
    }, 5000);
  }, []);

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
      {/* Title bar */}
      <View style={styles.titleBar}>
        <View style={styles.titleInner}>
          {/* Edit mode toggle */}
          <Pressable
            onPress={() => { setEditMode(!editMode); setPlacingType(null); setSelectedFurnitureId(null); }}
            style={[styles.modeBtn, editMode && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, editMode && styles.modeBtnTextActive]}>
              {editMode ? '✓' : '🔧'}
            </Text>
          </Pressable>
          {!isDesktop ? (
            <View style={styles.titleCenterMobile}>
              <Text style={{ fontSize: 14 }}>🏢</Text>
              {connectedConns.map(c => (
                <View key={c.id} style={[styles.connMiniDot, { backgroundColor: PROVIDER_META[c.provider].color }]} />
              ))}
              <Text style={styles.titleStatText}>
                {anyConnected ? `${userAgents.length} live` : 'OFFICE'}
              </Text>
              {telegramConnected && <Text style={styles.tgBadge}>✈️</Text>}
            </View>
          ) : (
            <>
              <View style={styles.titleCenter}>
                <Text style={{ fontSize: 16 }}>🏢</Text>
                <Text style={styles.titleText}>THE OFFICE</Text>
              </View>
              <View style={styles.titleRight}>
                {telegramConnected && (
                  <>
                    <Text style={styles.tgBadge}>✈️</Text>
                    <Text style={styles.titleStatText}>{telegramMessages.length} msgs</Text>
                  </>
                )}
                {connectedConns.map(c => (
                  <View key={c.id} style={[styles.connMiniDot, { backgroundColor: PROVIDER_META[c.provider].color }]} />
                ))}
                <Text style={styles.titleStatText}>
                  {connections.length > 0 ? `${connectedCount}/${connections.length} connected` : '0 connected'}
                </Text>
                <Text style={styles.titleStatText}>
                  {userAgents.length > 0 ? `${userAgents.length} agents` : ''}
                </Text>
              </View>
            </>
          )}
          {/* Reconnect All button (show when there are disconnected enabled connections) */}
          {connections.some(c => c.enabled && c.status !== 'connected' && c.status !== 'connecting') && (
            <Pressable
              onPress={handleReconnectAll}
              style={[styles.reconnectBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.reconnectBtnText}>🔌</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setShowRewards(true)} style={[styles.iconBtn,
            Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.iconBtnText}>🏆</Text>
          </Pressable>
          <Pressable onPress={() => setShowCustomize(true)} style={[styles.iconBtn,
            Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.iconBtnText}>{'⚙️'}</Text>
          </Pressable>
        </View>
      </View>

      {/* HITL Approval Banner */}
      <HitlApprovalBanner approvals={pendingApprovals} circleId={circleId} />

      {/* Budget Alerts */}
      {!budgetAlertsDismissed && budgetAlerts.length > 0 && (
        <BudgetAlertBanner
          alerts={budgetAlerts}
          onDismiss={() => setBudgetAlertsDismissed(true)}
          onConfigure={() => setShowCustomize(true)}
        />
      )}

      {/* Floor Selector */}
      {viewMode === 'office' && (
        <View style={styles.floorBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floorList}>
            {[...floors].sort((a, b) => a.order - b.order).map((floor) => {
              const floorAgentCount = displayAgents.filter(a => floor.agentIds?.includes(a.id)).length;
              const isActive = floor.id === currentFloorId;
              return (
                <View key={floor.id} style={styles.floorChipWrap}>
                  <Pressable
                    onPress={() => handleSwitchFloor(floor.id)}
                    style={[
                      styles.floorChip,
                      isActive && styles.floorChipActive,
                      Platform.OS === 'web' && { cursor: 'pointer' } as any
                    ]}
                  >
                    <Text style={[styles.floorChipText, isActive && styles.floorChipTextActive]}>
                      {floor.name}
                    </Text>
                    {floorAgentCount > 0 && (
                      <View style={styles.floorAgentBadge}>
                        <Text style={styles.floorAgentBadgeText}>{floorAgentCount}</Text>
                      </View>
                    )}
                    <View style={[styles.floorThemeDot, { backgroundColor: resolveTheme(floor.themeId).accentGlow }]} />
                  </Pressable>
                  {/* Delete button — only show in edit mode and when >1 floor */}
                  {editMode && floors.length > 1 && (
                    <Pressable
                      onPress={() => handleDeleteFloor(floor.id)}
                      style={[styles.floorDeleteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={styles.floorDeleteBtnText}>✕</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Pressable
              onPress={handleAddFloor}
              style={[styles.floorAddBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.floorAddBtnText}>+ FLOOR</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {/* Edit toolbar */}
      {viewMode === 'office' && editMode && (
        <View style={styles.editToolbar}>
          <View style={styles.editToolbarHeader}>
            <Text style={styles.editLabel}>
              {placingType ? `TAP FLOOR — PLACING: ${placingType.toUpperCase()}` : selectedFurnitureId ? 'DRAG TO MOVE · TAP DELETE TO REMOVE' : 'SELECT ITEM BELOW, TAP TO PLACE · DRAG TO MOVE'}
            </Text>
            <View style={styles.editToolbarActions}>
              {placingType && (
                <Pressable onPress={() => setPlacingType(null)} style={[styles.editActionBtn, { borderColor: '#f59e0b55' }]}>
                  <Text style={[styles.editActionBtnText, { color: '#f59e0b' }]}>CANCEL</Text>
                </Pressable>
              )}
              {currentFloor.furniture.length > 0 && (
                <Pressable onPress={() => {
                  setFloors(prev => prev.map(f => f.id === currentFloorId ? { ...f, furniture: [] } : f));
                }} style={[styles.editActionBtn, { borderColor: '#ef444455' }]}>
                  <Text style={[styles.editActionBtnText, { color: '#ef4444' }]}>CLEAR ALL</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Category rows */}
          {(['work', 'lounge', 'tech', 'decor'] as const).map(cat => {
            const items = FURNITURE_CATALOG.filter(f => f.category === cat && !['desk'].includes(f.type));
            if (items.length === 0) return null;
            return (
              <View key={cat} style={styles.editCategoryRow}>
                <Text style={styles.editCategoryLabel}>{cat.toUpperCase()}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editItems}>
                  {items.map(item => (
                    <Pressable
                      key={item.type}
                      onPress={() => setPlacingType(placingType === item.type ? null : item.type as any)}
                      style={[styles.editItem, placingType === item.type && styles.editItemActive,
                        Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={styles.editItemIcon}>{item.icon}</Text>
                      <Text style={styles.editItemName}>{item.name}</Text>
                      {item.description ? <Text style={styles.editItemDesc} numberOfLines={1}>{item.description}</Text> : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            );
          })}
        </View>
      )}

      {/* Connections Bar - collapsible */}
      {connections.length > 0 && viewMode === 'office' && (
        <View style={styles.connectionsBar}>
          <Pressable onPress={() => setConnectionsCollapsed(!connectionsCollapsed)} style={styles.connectionsToggle}>
            <Text style={styles.connectionsToggleText}>{connectionsCollapsed ? '▶' : '▼'} {connections.filter(c => c.status === 'connected').length}/{connections.length}</Text>
          </Pressable>
          {!connectionsCollapsed && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.connectionsBarInner}>
            {connections.map(conn => {
              const isLocal = conn.endpoint.includes('localhost') || conn.endpoint.includes('127.0.0.1');
              const isProduction = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
              const skipped = isProduction && isLocal;
              const statusColor = conn.status === 'connected' ? '#22c55e'
                : conn.status === 'connecting' ? '#eab308'
                : conn.status === 'error' ? '#ef4444'
                : skipped ? '#f59e0b'
                : '#6b7280';
              const statusLabel = skipped ? 'local only'
                : conn.status === 'connected' ? `${conn.sessionCount ?? 0} sessions`
                : conn.status === 'connecting' ? 'connecting...'
                : conn.status === 'error' ? 'error'
                : 'offline';
              return (
                <Pressable
                  key={conn.id}
                  onPress={() => {
                    if (skipped || conn.status === 'disconnected' || conn.status === 'error') {
                      setShowCustomize(true);
                    }
                  }}
                  style={[styles.connectionChip, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <View style={[styles.connectionChipDot, { backgroundColor: PROVIDER_META[conn.provider].color }]} />
                  <View style={[styles.connectionChipStatus, { backgroundColor: statusColor }]} />
                  <Text style={styles.connectionChipName} numberOfLines={1}>{conn.name}</Text>
                  <Text style={[styles.connectionChipLabel, { color: statusColor }]}>{statusLabel}</Text>
                  {skipped && <Text style={styles.connectionChipLocal}>🏠</Text>}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setShowCustomize(true)}
              style={[styles.connectionAddChip, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.connectionAddChipText}>+</Text>
            </Pressable>
          </ScrollView>}
        </View>
      )}

      {/* Main Content — Office Floor View */}
      <View style={styles.mainContent}>
        {/* Mobile: Card-based agent list */}
        {!isDesktop ? (
          <ScrollView style={styles.mobileAgentScroll} showsVerticalScrollIndicator={true} contentContainerStyle={styles.mobileAgentList}>
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
            {!mergedCircleAgents.some(a => a.isOwn) && (
              <Pressable
                onPress={() => {
                  const conn = connections.find(c => c.enabled);
                  if (conn) {
                    // Has a connection — publish directly
                    handlePublishToCircle(conn.name, conn.provider);
                  } else {
                    // No connection — open manual form
                    setShowPublishModal(true);
                  }
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
            )}
            {userAgents.length === 0 ? (
              <View style={styles.mobileEmpty}>
                {(() => {
                  const connectingConns = connections.filter(c => c.status === 'connecting');
                  const errorConns = connections.filter(c => c.status === 'error');
                  const savedConns = connections.filter(c => c.enabled);

                  if (connectingConns.length > 0) {
                    return (
                      <>
                        <ActivityIndicator color="#6366f1" size="large" style={{ marginBottom: 16 }} />
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
                          <View key={c.id} style={{ marginBottom: 8, padding: 10, backgroundColor: '#1a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#ef444430', width: '100%' }}>
                            <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' }}>{c.name}</Text>
                            <Text style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 2 }}>{c.error || 'Could not reach endpoint'}</Text>
                            <Text style={{ color: '#555', fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>{c.endpoint}</Text>
                          </View>
                        ))}
                        <Text style={{ color: '#555', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', marginBottom: 8 }}>
                          Make sure OpenClaw is running and the CORS proxy is active
                        </Text>
                        <Pressable
                          onPress={() => savedConns.forEach(c => connectOne(c))}
                          style={[{ backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, marginBottom: 12 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                        >
                          <Text style={{ color: '#6366f1', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>↻ RETRY CONNECTION</Text>
                        </Pressable>
                      </>
                    );
                  }
                  return (
                    <>
                      <Text style={{ fontSize: 48, marginBottom: 8 }}>🤖</Text>
                      <Text style={styles.mobileEmptyTitle}>No agents connected</Text>
                      <Text style={styles.mobileEmptyText}>
                        Connect your AI agent to show up in the circle office
                      </Text>
                    </>
                  );
                })()}
                <Pressable
                  onPress={() => setShowSetupWizard(true)}
                  style={[styles.mobileEmptyBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  accessibilityRole="button"
                  accessibilityLabel="Connect agent"
                >
                  <Text style={styles.mobileEmptyBtnText}>CONNECT AGENT →</Text>
                </Pressable>
              </View>
            ) : (
              displayAgents.map((agent) => {
                const statusColor = agent.status === 'active' ? '#22c55e' : agent.status === 'idle' ? '#eab308' : agent.status === 'error' ? '#ef4444' : '#6b7280';
                const isSelected = selectedAgent?.id === agent.id;
                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => handleAgentPress(agent)}
                    style={[styles.mobileAgentCard, isSelected && { borderColor: agent.color + '60', backgroundColor: agent.color + '08' },
                      Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    accessibilityRole="button"
                    accessibilityLabel={`${agent.name}, ${agent.status}, ${agent.role}`}
                  >
                    <View style={styles.mobileCardRow}>
                      <View style={[styles.mobileCardAvatar, { backgroundColor: agent.color + '20', borderColor: agent.color + '50' }]}>
                        <Text style={[styles.mobileCardAvatarText, { color: agent.color }]}>{agent.name.charAt(0)}</Text>
                      </View>
                      <View style={styles.mobileCardInfo}>
                        <View style={styles.mobileCardNameRow}>
                          <Text style={styles.mobileCardName}>{agent.name}</Text>
                          <View style={[styles.mobileCardStatus, { backgroundColor: statusColor }]} />
                          <Text style={[styles.mobileCardStatusText, { color: statusColor }]}>{agent.status}</Text>
                        </View>
                        <Text style={styles.mobileCardRole}>{agent.role} · {PROVIDER_META[agent.providerType].icon} {agent.connectionName}</Text>
                        <Text style={styles.mobileCardModel}>{agent.model}</Text>
                      </View>
                      <View style={styles.mobileCardRight}>
                        <Text style={styles.mobileCardCost}>${agent.costToday.toFixed(2)}</Text>
                        <Text style={styles.mobileCardCostLabel}>today</Text>
                      </View>
                    </View>
                    <Text style={styles.mobileCardActivity} numberOfLines={1}>{agent.activity}</Text>
                  </Pressable>
                );
              })
            )}

            {/* Agent Activity Feed */}
            <View style={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8 }}>
              <Text style={{ color: '#6B7280', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
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
                <View style={[styles.officeScaleOuter, { height: scaledH, width: needsHScroll ? FLOOR_W * officeScale : '100%' as any }]}>
                  <View style={[styles.officeWrapper, { width: FLOOR_W, height: FLOOR_H, transform: [{ scale: officeScale }] }]}>
                    <OfficeFloorView
                      theme={currentTheme}
                      furniture={currentFloor.furniture}
                      editMode={editMode}
                      onFloorPress={editMode ? handleFloorPress : undefined}
                      onFurniturePress={editMode ? handleFurniturePress : undefined}
                      onFurnitureMove={editMode ? handleFurnitureMove : undefined}
                      selectedFurnitureId={editMode ? selectedFurnitureId : null}
                    />
                    <Whiteboard editable={editMode} notes={whiteboardNotes} onNotesChange={setWhiteboardNotes} agents={displayAgents} statusHistory={statusHistory} cronJobs={cronJobs} circleId={circleId} connectedCount={connections.filter(c => c.status === 'connected').length} totalConnections={connections.length} />
                    <ServerRack agents={displayAgents} />
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
                              style={{ marginTop: 12, backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}
                            >
                              <Text style={{ color: '#6366f1', fontWeight: '700', fontSize: 12, fontFamily: 'monospace' }}>↻ RETRY</Text>
                            </Pressable>
                          </>
                        ) : (
                          <>
                            <Text style={{ fontSize: 56, marginBottom: 8 }}>🤖</Text>
                            <Text style={styles.emptyTitle}>No agents connected</Text>
                            <Text style={styles.emptyText}>Connect your AI agent to show up in the circle office</Text>
                            <Pressable
                              onPress={() => setShowSetupWizard(true)}
                              style={{ marginTop: 16, backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}
                            >
                              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Connect Agent →</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    )}
                    {agents.map((agent, i) => {
                      const pos = DESK_POSITIONS[i];
                      if (!pos) return null;
                      return (
                        <View key={agent.id} style={[styles.agentPosition, { left: pos.x - 2, top: pos.y - 50 }]}>
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
                            onAutomate={(taskText) => {
                              sendTerminalCommand({
                                circleId,
                                senderId: currentUserId,
                                senderName: currentUserName,
                                commandText: taskText,
                                targetAgentId: agent.id,
                                targetAgentName: `@${agent.name}`,
                                targetAgentIds: [agent.id],
                              }).then(result => {
                                if (result.messageId) {
                                  handleCommandSent({
                                    messageId: result.messageId,
                                    command: taskText,
                                    targetAgentId: agent.id,
                                    targetAgentIds: [agent.id],
                                    targetAgentName: `@${agent.name}`,
                                    model: null,
                                    senderId: currentUserId,
                                  });
                                }
                              });
                            }}
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>
            </ScrollView>

            {/* Circle Office Panel — all members' bots */}
            {!editMode && (
              <>
                {/* Desktop publish CTA — always show if not yet published */}
                {!mergedCircleAgents.some(a => a.isOwn) && (
                  <Pressable
                    onPress={() => {
                      const conn = connections.find(c => c.enabled);
                      if (conn) {
                        handlePublishToCircle(conn.name, conn.provider);
                      } else {
                        setShowPublishModal(true);
                      }
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
                      <View style={[styles.quickProviderDot, { backgroundColor: PROVIDER_META[agent.providerType].color }]} />
                      <View style={[styles.quickDot, {
                        backgroundColor: agent.status === 'active' ? '#22c55e' : agent.status === 'idle' ? '#eab308' : agent.status === 'error' ? '#ef4444' : '#6b7280',
                      }]} />
                      <Text style={[styles.quickName, selectedAgent?.id === agent.id && { color: agent.color }]}>{agent.name}</Text>
                      <Text style={styles.quickCost}>${agent.costToday.toFixed(2)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        )}

        {/* Terminal toggle bar */}
        <View style={styles.chatToggle}>
          <View style={styles.terminalBar}>
            <Pressable
              onPress={() => setTerminalSize(terminalSize === 'closed' ? 'half' : 'closed')}
              style={[styles.terminalBarBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              accessibilityRole="button"
              accessibilityLabel={terminalSize === 'closed' ? 'Open terminal' : 'Close terminal'}
            >
              <Text style={styles.chatToggleText}>
                {terminalSize === 'closed' ? '▲ TERMINAL' : '▼ HIDE'}
              </Text>
            </Pressable>
            {terminalSize !== 'closed' && (
              <View style={styles.terminalSizeButtons}>
                <Pressable
                  onPress={() => setTerminalSize('half')}
                  style={[styles.terminalSizeBtn, terminalSize === 'half' && styles.terminalSizeBtnActive,
                    Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[styles.terminalSizeBtnText, terminalSize === 'half' && styles.terminalSizeBtnTextActive]}>▬</Text>
                </Pressable>
                <Pressable
                  onPress={() => setTerminalSize('full')}
                  style={[styles.terminalSizeBtn, terminalSize === 'full' && styles.terminalSizeBtnActive,
                    Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[styles.terminalSizeBtnText, terminalSize === 'full' && styles.terminalSizeBtnTextActive]}>⬜</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {/* Terminal - half size (mirrors the Terminal tab — shared state) */}
        {terminalSize === 'half' && (
          <View style={styles.chatPane}>
            <OfficeTerminal
              circleId={circleId}
              userId={currentUserId}
              userDisplayName={currentUserName}
              agents={mergedCircleAgents}
              myAgentIds={mergedCircleAgents.filter(a => a.ownerId === currentUserId).map(a => a.id)}
              sharedInput={terminalInput}
              onSharedInputChange={setTerminalInput}
              sharedTargetId={terminalTargetId}
              sharedTargetName={terminalTargetName}
              onSharedSelectTarget={(id, name) => { setTerminalTargetId(id); setTerminalTargetName(name); }}
              sharedModel={terminalModel}
              onSharedModelChange={setTerminalModel}
              sharedTargetIds={terminalTargetIds}
              onSharedSelectTargets={(ids, _names) => setTerminalTargetIds(ids)}
              onCommandSent={handleCommandSent}
              byoProviderKeys={providerKeys}
              compact
            />
          </View>
        )}

        {/* Terminal - fullscreen overlay (same mirror) */}
        {terminalSize === 'full' && (
          <View style={styles.terminalFullscreen}>
            {/* Exit fullscreen button */}
            <View style={styles.terminalFullscreenHeader}>
              <Pressable
                onPress={() => setTerminalSize('half')}
                style={[styles.terminalFullscreenBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
              >
                <Text style={styles.terminalFullscreenBtnText}>▬ Half</Text>
              </Pressable>
              <Pressable
                onPress={() => setTerminalSize('closed')}
                style={[styles.terminalFullscreenBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
              >
                <Text style={styles.terminalFullscreenBtnText}>✕ Close</Text>
              </Pressable>
            </View>
            <OfficeTerminal
              circleId={circleId}
              userId={currentUserId}
              userDisplayName={currentUserName}
              agents={mergedCircleAgents}
              myAgentIds={mergedCircleAgents.filter(a => a.ownerId === currentUserId).map(a => a.id)}
              sharedInput={terminalInput}
              onSharedInputChange={setTerminalInput}
              sharedTargetId={terminalTargetId}
              sharedTargetName={terminalTargetName}
              onSharedSelectTarget={(id, name) => { setTerminalTargetId(id); setTerminalTargetName(name); }}
              sharedModel={terminalModel}
              onSharedModelChange={setTerminalModel}
              sharedTargetIds={terminalTargetIds}
              onSharedSelectTargets={(ids, _names) => setTerminalTargetIds(ids)}
              onCommandSent={handleCommandSent}
              byoProviderKeys={providerKeys}
            />
          </View>
        )}
      </View>

      {/* Agent detail panel */}
      {!editMode && (
        <AgentPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          isDesktop={isDesktop}
          onRenameAgent={handleRenameAgent}
          sessionTags={sessionTags}
          onAddSessionTag={handleAddSessionTag}
          onRemoveSessionTag={handleRemoveSessionTag}
          circleId={circleId}
          appearances={appearances}
          onAppearanceChange={(id, a) => setAppearances(prev => ({ ...prev, [id]: a }))}
          environmentType={currentTheme.environmentType}
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
              {[
                { key: 'openclaw',      icon: '🦞', label: 'OpenClaw' },
                { key: 'claude-code',   icon: '🤖', label: 'Claude Code' },
                { key: 'codex',         icon: '🧠', label: 'Codex' },
                { key: 'cursor',        icon: '🖱️', label: 'Cursor' },
                { key: 'gemini',        icon: '♊', label: 'Gemini' },
                { key: 'generic-agent', icon: '⚡', label: 'Other' },
              ].map(p => (
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

      {/* Rewards Panel Modal */}
      <Modal visible={showRewards} animationType="slide" presentationStyle="pageSheet">
        <RewardsPanel onClose={() => setShowRewards(false)} />
      </Modal>

      {/* Badge celebration overlay — rendered outside Modal so it covers everything */}
      <BadgeCelebration
        badge={celebrationBadge}
        onDismiss={() => setCelebrationBadge(null)}
      />

      {/* Agent setup wizard */}
      <AgentSetupWizard
        visible={showSetupWizard}
        onClose={() => setShowSetupWizard(false)}
        onComplete={(conn) => {
          handleAddConnection(conn);
          setShowSetupWizard(false);
        }}
      />

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

      {/* Image / NFT Picker Modal */}
      <Modal visible={nftPickerVisible} animationType="fade" transparent>
        <View style={nftStyles.overlay}>
          <View style={nftStyles.card}>
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
                    <ActivityIndicator color="#6366f1" size="large" />
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
                          <View style={[nftStyles.nftImage, { backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' }]}>
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
          </View>
        </View>
      </Modal>

      {/* ── Sticky Note Editor Modal ────────────────────────────────────── */}
      <Modal visible={stickyEditorVisible} animationType="fade" transparent>
        <View style={nftStyles.overlay}>
          <View style={[nftStyles.card, { maxWidth: 420, maxHeight: 520 }]}>
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
          </View>
        </View>
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
  const building = agents.filter(a => a.status === 'building');
  const idle = agents.filter(a => a.status === 'idle');
  const offline = agents.filter(a => a.status === 'offline');

  if (compact) {
    // Horizontal strip for desktop — scrollable row of agent chips
    return (
      <View style={coStyles.compactBar}>
        <Text style={coStyles.compactLabel}>🏢 Circle Office</Text>
        <View style={[coStyles.connectionDot, { backgroundColor: CONNECTION_STATUS_UI[connectionStatus].color, marginRight: 4 }]} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={coStyles.compactScroll}>
          {agents.map(agent => {
            const display = PROVIDER_DISPLAY[agent.provider] || PROVIDER_DISPLAY['generic-agent'];
            const statusColor = agent.status === 'building' ? '#22c55e' : agent.status === 'idle' ? '#eab308' : '#444';
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

  // Sort: building first, then idle (online), then offline by last seen
  const sorted = [...agents].sort((a, b) => {
    const rank = (s: string) => s === 'building' ? 0 : s === 'idle' ? 1 : 2;
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    // Within same status, most recently active first
    return new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime();
  });

  const onlineCount = agents.filter(a => a.status !== 'offline').length;

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
          {building.length > 0 && <Text style={coStyles.statBuilding}>⚡ {building.length} building</Text>}
          {idle.length > 0 && <Text style={coStyles.statIdle}>🟢 {idle.length} online</Text>}
          {offline.length > 0 && <Text style={coStyles.statOffline}>⚫ {offline.length} away</Text>}
        </View>
      </View>

      {sorted.map(agent => {
        const display = PROVIDER_DISPLAY[agent.provider] || PROVIDER_DISPLAY['generic-agent'];
        const isBuilding = agent.status === 'building';
        const isOnline = agent.status === 'idle';
        const isOffline = agent.status === 'offline';
        const lastSeen = getLastSeen(agent.lastActiveAt);

        return (
          <View
            key={agent.id}
            style={[
              coStyles.agentCard,
              { borderColor: isBuilding ? display.color + '66' : isOnline ? display.color + '33' : '#1a1a1a' },
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
                  backgroundColor: isBuilding ? '#22c55e' : isOnline ? '#22c55e' : '#333',
                }]} />
                <Text style={[coStyles.statusText, isOffline && { color: '#444' }]}>
                  {isBuilding ? 'building' : isOnline ? 'online' : lastSeen.text}
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
    backgroundColor: '#1a1a1a',
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
    color: '#71717a',
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
  providerLabel: { color: '#71717a', fontSize: 10, fontWeight: '600' },
  providerLabelActive: { color: '#6366f1' },
  submitBtn: {
    backgroundColor: '#6366f1',
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
    borderTopWidth: 1, borderTopColor: '#1a1a2a',
    backgroundColor: '#080810',
    gap: 10,
  },
  compactLabel: { color: '#444', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  compactScroll: { flexDirection: 'row', gap: 8 },
  compactChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, backgroundColor: '#0d0d1a',
    position: 'relative',
  },
  buildingDot: {
    position: 'absolute', top: 4, right: 4,
    width: 6, height: 6, borderRadius: 3,
  },
  compactIcon: { fontSize: 14 },
  compactOwner: { color: '#888', fontSize: 10 },
  compactAgentName: { color: '#ccc', fontSize: 12, fontWeight: '600', maxWidth: 80 },
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
  statIdle: { color: '#22c55e', fontSize: 12 },
  statOffline: { color: '#444', fontSize: 12 },

  agentCard: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 10, marginHorizontal: 4,
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

  agentIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  ownerAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  ownerAvatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  agentName: { color: '#ddd', fontSize: 14, fontWeight: '700' },
  ownerName: { color: '#555', fontSize: 12 },

  taskBlock: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 8 },
  taskLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  taskText: { color: '#ddd', fontSize: 14, lineHeight: 20 },
  goalText: { color: '#888', fontSize: 12, marginTop: 4 },

  sessionLink: { marginBottom: 4 },
  sessionLinkText: { fontSize: 12, fontWeight: '600' },
  returnTime: { color: '#444', fontSize: 11 },

  publishBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 8, padding: 14,
    backgroundColor: '#0d0d1a', borderRadius: 12, borderWidth: 1,
    borderStyle: 'dashed',
  },
  publishBtnIcon: { fontSize: 24 },
  publishBtnTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  publishBtnSub: { color: '#555', fontSize: 12 },
});

const nftStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', alignItems: 'center' },
  card: { width: 380, maxHeight: 500, backgroundColor: '#0d0d14', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#1a1a2e' },
  headerText: { color: '#eee', fontSize: 14, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 2 },
  closeBtn: { padding: 6 },
  closeText: { color: '#666', fontSize: 16 },
  emptyState: { padding: 40, alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: '#888', fontSize: 14, fontFamily: 'monospace', fontWeight: '700' },
  emptyHint: { color: '#555', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', lineHeight: 16 },
  grid: { maxHeight: 380 },
  gridContent: { flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 },
  nftCard: { width: '30%' as any, backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a2e', overflow: 'hidden', padding: 4, alignItems: 'center' },
  nftImage: { width: '100%' as any, aspectRatio: 1, borderRadius: 6 },
  nftName: { color: '#ccc', fontSize: 9, fontFamily: 'monospace', fontWeight: '700', marginTop: 4, textAlign: 'center' },
  nftCollection: { color: '#555', fontSize: 7, fontFamily: 'monospace', textAlign: 'center' },
  clearBtn: { margin: 12, padding: 10, backgroundColor: '#1a1a2e', borderRadius: 8, alignItems: 'center' },
  clearText: { color: '#ef4444', fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
});

const imgPickerStyles = StyleSheet.create({
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#1a1a2e' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#0a0a10' },
  tabActive: { backgroundColor: '#0d0d14', borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabText: { color: '#555', fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  tabTextActive: { color: '#eee' },
  uploadArea: { padding: 40, alignItems: 'center', gap: 12 },
  uploadTitle: { color: '#ccc', fontSize: 14, fontFamily: 'monospace', fontWeight: '700' },
  uploadHint: { color: '#555', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' },
  uploadBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#6366f1', borderRadius: 8 },
  uploadBtnText: { color: '#fff', fontSize: 11, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
});

const stickyStyles = StyleSheet.create({
  colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#1a1a2e' },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#333' },
  colorDotActive: { borderColor: '#fff', borderWidth: 3 },
  writeArea: { padding: 12, flex: 1 },
  textInput: {
    minHeight: 140, borderRadius: 6, padding: 12,
    color: '#1a1a1a', fontSize: 14, fontFamily: 'monospace',
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  drawArea: { padding: 12, alignItems: 'center', gap: 8 },
  canvasWrap: { width: '100%' as any, height: 200, borderRadius: 6, overflow: 'hidden' },
  clearDrawBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#333', backgroundColor: '#0a0a10',
  },
  clearDrawText: { color: '#888', fontSize: 9, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  gifArea: { padding: 12, gap: 10 },
  gifInput: {
    backgroundColor: '#0d0d14', borderWidth: 1, borderColor: '#222',
    borderRadius: 8, padding: 10, color: '#ddd', fontSize: 12, fontFamily: 'monospace',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  gifPreview: { height: 150, borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  gifImage: { width: '100%' as any, height: '100%' as any },
  gifHint: { height: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  gifHintText: { color: '#555', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' },
  saveBtn: {
    margin: 12, paddingVertical: 12, borderRadius: 8, backgroundColor: '#6366f1',
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 12, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  titleBar: {
    alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  titleInner: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 3 },
  titleCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  titleCenterMobile: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  titleRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  titleIcon: { fontSize: 12 },
  titleText: { fontSize: 10, fontWeight: '900', color: '#888', fontFamily: 'monospace', letterSpacing: 2 },
  onlineIndicator: { width: 5, height: 5, borderRadius: 2.5 },
  connMiniDot: { width: 4, height: 4, borderRadius: 2 },
  titleStatText: { fontSize: 10, color: '#888', fontFamily: 'monospace' },
  modeBtn: {
    paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
    minWidth: 28, minHeight: 28, alignItems: 'center' as any, justifyContent: 'center' as any,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  modeBtnActive: { borderColor: '#22c55e40', backgroundColor: '#22c55e15' },
  modeBtnText: { fontSize: 10, color: '#666', fontFamily: 'monospace', fontWeight: '700' },
  modeBtnTextActive: { color: '#22c55e' },
  tagsActionBtn: {
    flex: 1,
    backgroundColor: '#00FF9C18',
    borderWidth: 1,
    borderColor: '#00FF9C40',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tagsActionBtnSecondary: {
    backgroundColor: '#6366f118',
    borderColor: '#6366f140',
  },
  tagsActionBtnText: {
    color: '#00FF9C',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  tagsActionBtnTextSecondary: { color: '#6366f1' },
  iconBtn: {
    width: 30, height: 30, borderRadius: 7, backgroundColor: '#111118',
    borderWidth: 1, borderColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', marginLeft: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  iconBtnText: { fontSize: 14 },
  reconnectBtn: {
    width: 30, height: 30, borderRadius: 7, backgroundColor: '#6366f115',
    borderWidth: 1, borderColor: '#6366f140', alignItems: 'center', justifyContent: 'center', marginLeft: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  reconnectBtnText: { fontSize: 13 },
  tgBadge: { fontSize: 9, marginRight: 1 },

  // Floor selector
  floorBar: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e', backgroundColor: '#08080d',
  },
  floorList: { gap: 4, flexDirection: 'row', alignItems: 'center' },
  floorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
  },
  floorChipActive: {
    borderColor: '#6366f160', backgroundColor: '#6366f115',
  },
  floorChipText: {
    fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: '600',
  },
  floorChipTextActive: {
    color: '#fff', fontWeight: '700',
  },
  floorThemeDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  floorAgentBadge: {
    backgroundColor: '#22c55e20',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floorAgentBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#22c55e',
    fontFamily: 'monospace',
  },
  floorAddBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#22c55e40', backgroundColor: '#22c55e10',
  },
  floorAddBtnText: {
    fontSize: 9, color: '#22c55e', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1,
  },

  // Connections bar
  connectionsBar: {
    paddingHorizontal: 12, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e', backgroundColor: '#08080d',
    flexDirection: 'row', alignItems: 'center',
  },
  connectionsToggle: { paddingRight: 8, paddingVertical: 2 },
  connectionsToggleText: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  connectionsBarInner: { gap: 8, flexDirection: 'row', alignItems: 'center', flex: 1 },
  connectionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0d0d14',
  },
  connectionChipDot: { width: 6, height: 6, borderRadius: 3 },
  connectionChipStatus: { width: 5, height: 5, borderRadius: 3 },
  connectionChipName: { fontSize: 11, color: '#ccc', fontFamily: 'monospace', fontWeight: '600', maxWidth: 120 },
  connectionChipLabel: { fontSize: 9, fontFamily: 'monospace', fontWeight: '600' },
  connectionChipLocal: { fontSize: 10, marginLeft: 2 },
  connectionAddChip: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1,
    borderColor: '#22c55e40', backgroundColor: '#22c55e10',
    alignItems: 'center', justifyContent: 'center',
  },
  connectionAddChipText: { fontSize: 14, color: '#22c55e', fontWeight: '700' },

  editToolbar: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e', backgroundColor: '#0a0a12',
  },
  editLabel: { fontSize: 9, color: '#888', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  editItems: { gap: 6, flexDirection: 'row' },
  editItem: {
    alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10', gap: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  editItemActive: { borderColor: '#6366f160', backgroundColor: '#6366f115' },
  editItemIcon: { fontSize: 16 },
  editItemName: { fontSize: 7, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  editItemDesc: { fontSize: 5.5, color: '#999', fontFamily: 'monospace', maxWidth: 60, textAlign: 'center' },
  editToolbarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  editToolbarActions: { flexDirection: 'row', gap: 6 },
  editActionBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  editActionBtnText: { fontSize: 8, fontWeight: '700', fontFamily: 'monospace' },
  editCategoryRow: { marginBottom: 6 },
  editCategoryLabel: { fontSize: 6, color: '#888', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5, marginBottom: 4 },
  floorChipWrap: { flexDirection: 'row', alignItems: 'center', marginRight: 4 },
  floorDeleteBtn: { marginLeft: -2, marginRight: 6, width: 14, height: 14, borderRadius: 7, backgroundColor: '#ef444422', borderWidth: 1, borderColor: '#ef444444', alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  floorDeleteBtnText: { fontSize: 7, color: '#ef4444', fontWeight: '800', lineHeight: 14 },
  clearBtn: {
    marginTop: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4,
    backgroundColor: '#ef444420', alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  clearBtnText: { fontSize: 8, color: '#ef4444', fontFamily: 'monospace', fontWeight: '700' },
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
    backgroundColor: '#6366f1', minHeight: 48,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mobileEmptyBtnText: { fontSize: 14, color: '#fff', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 },
  mobileAgentCard: {
    backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a2e',
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
  mobileCardStatus: { width: 8, height: 8, borderRadius: 4 },
  mobileCardStatusText: { fontSize: 12, fontFamily: 'monospace', fontWeight: '600', textTransform: 'uppercase' as any },
  mobileCardRole: { fontSize: 13, color: '#888', fontFamily: 'monospace' },
  mobileCardModel: { fontSize: 12, color: '#666', fontFamily: 'monospace' },
  mobileCardRight: { alignItems: 'flex-end', gap: 2 },
  mobileCardCost: { fontSize: 16, fontWeight: '900', color: '#22c55e', fontFamily: 'monospace' },
  mobileCardCostLabel: { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  mobileCardActivity: { fontSize: 13, color: '#777', fontFamily: 'monospace', paddingLeft: 62 },
  officeScroll: { flex: 1 },
  officeScaleOuter: { overflow: 'hidden' },
  officeWrapper: { position: 'relative', transformOrigin: 'top left' as any },
  emptyOverlay: {
    position: 'absolute', top: '35%' as any, left: 0, right: 0, alignItems: 'center', zIndex: 20, gap: 6, paddingHorizontal: 20,
  },
  emptyIcon: { fontSize: 28 },
  emptyTitle: { fontSize: 13, color: '#666', fontFamily: 'monospace', fontWeight: '800', textAlign: 'center' },
  emptyText: { fontSize: 10, color: '#555', fontFamily: 'monospace', textAlign: 'center' },
  emptySub: { fontSize: 9, color: '#444', fontFamily: 'monospace', fontStyle: 'italic', textAlign: 'center' },
  agentPosition: { position: 'absolute', zIndex: 10 },
  quickBar: {
    borderTopWidth: 1, borderTopColor: '#1a1a2e', paddingVertical: 6, paddingHorizontal: 8,
  },
  quickBarInner: { gap: 6, flexDirection: 'row' },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8,
    paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
  },
  quickProviderDot: { width: 4, height: 4, borderRadius: 2 },
  quickDot: { width: 4, height: 4, borderRadius: 2 },
  quickName: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  quickCost: { fontSize: 8, color: '#444', fontFamily: 'monospace' },
  chatToggle: {
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
    backgroundColor: '#0a0a12',
  },
  terminalBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 12, gap: 12,
  },
  terminalBarBtn: {
    paddingVertical: 4, paddingHorizontal: 12,
  },
  chatToggleText: { fontSize: 13, color: '#888', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 },
  terminalSizeButtons: {
    flexDirection: 'row', gap: 4,
  },
  terminalSizeBtn: {
    width: 32, height: 28, borderRadius: 6,
    backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e',
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
    backgroundColor: '#0d0d14',
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
    borderBottomColor: '#1a1a2e',
    backgroundColor: '#0a0a0f',
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
