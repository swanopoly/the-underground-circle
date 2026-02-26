import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  useWindowDimensions, Platform, Linking, Modal, TextInput,
} from 'react-native';
import OfficeFloorView, { DESK_POSITIONS, FLOOR_W, FLOOR_H } from './office/OfficeFloor';
import PixelAgent from './office/PixelAgent';
import ServerRack from './office/ServerRack';
import Whiteboard from './office/Whiteboard';
import AgentPanel from './office/AgentPanel';
import CustomizePanel, { TelegramConfig } from './office/CustomizePanel';
import OfficeChat, { OfficeCommand } from './office/OfficeChat';
import { OfficeAgent, sessionsToAgents } from '../../../lib/officeAgents';
import {
  OFFICE_THEMES, AgentAppearance, FurnitureItem, FURNITURE_CATALOG,
  OfficeFloor, DEFAULT_FLOORS, createDefaultFloor,
} from '../../../lib/officeConfig';
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
import { storage } from '../../../lib/storage';
import CostDashboard from '../../../components/CostDashboard';
import SessionTagsDashboard from '../../../components/SessionTagsDashboard';
import ProjectRoomsPanel from '../../../components/ProjectRoomsPanel';
import AgentPerformanceMetrics from '../../../components/AgentPerformanceMetrics';
import {
  SessionTag, loadSessionTags, addSessionTag, removeSessionTag,
} from '../../../lib/sessionTags';
import {
  BudgetConfig, loadBudgetConfig, saveBudgetConfig, calculateBudgetAlerts,
} from '../../../lib/budgetAlerts';
import BudgetAlertBanner from '../../../components/BudgetAlertBanner';
import { calculatePeriodCosts } from '../../../lib/costCalculations';
import OfficeActionPanel from '../../../components/OfficeActionPanel';
import FarmHealthDashboard from '../../../components/FarmHealthDashboard';
import AgentActivityFeed from '../../../components/AgentActivityFeed';
import HitlApprovalBanner from '../../../components/HitlApprovalBanner';
import SharedMemoryPanel from '../../../components/SharedMemoryPanel';
import { useAgentApprovals } from '../../../services/hitlService';
import ByoaPanel from './office/ByoaPanel';
import AgentTemplates from './office/AgentTemplates';
import {
  CircleOfficeAgent,
  loadCircleOfficeAgents,
  publishAgentToCircle,
  subscribeToCircleOffice,
  PROVIDER_DISPLAY,
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
import PixelOfficeCanvas from '../../../components/PixelOfficeCanvas';
import OfficeAnalyticsPanel from '../../../components/OfficeAnalyticsPanel';
import OfficeTerminal from '../../../components/OfficeTerminal';
import {
  subscribeToTerminalCommands,
  respondToCommand,
  cleanupTerminalChannels,
  updateAgentAnalytics,
  BroadcastCommandPayload,
} from '../../../lib/officeTerminal';
import {
  invokeAndStream,
  invokeAllAgents,
} from '../../../lib/agentInvocation';
import { supabase } from '../../../lib/supabase';
import AgentSetupWizard from '../../../components/AgentSetupWizard';

const STORAGE_KEY_TELEGRAM = '@office_telegram_config';
const STORAGE_KEY_AGENT_NAMES = '@office_agent_names';
const STORAGE_KEY_FLOORS = '@office_floors';
const STORAGE_KEY_CURRENT_FLOOR = '@office_current_floor';
const STORAGE_KEY_APPEARANCES = '@office_appearances';
const STORAGE_KEY_WHITEBOARD_NOTES = '@office_whiteboard_notes';

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
  const [showByoa, setShowByoa] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const pendingApprovals = useAgentApprovals(circleId);
  const [appearances, setAppearances] = useState<Record<string, AgentAppearance>>({});
  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [whiteboardNotes, setWhiteboardNotes] = useState<string[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [terminalSize, setTerminalSize] = useState<'closed' | 'half' | 'full'>('closed');
  // ─── Shared terminal state — both the tab view and the bottom drawer
  //     use these so input/target stay in sync (true mirror behaviour) ──────
  const [terminalInput, setTerminalInput]         = useState('');
  const [terminalTargetId, setTerminalTargetId]   = useState<string | null>(null);
  const [terminalTargetName, setTerminalTargetName] = useState('@all');
  const [statusHistory, setStatusHistory] = useState<Array<OfficeAgent[]>>([]);
  const [enrichedAgents, setEnrichedAgents] = useState<OfficeAgent[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<'office' | 'cost' | 'tags' | 'metrics' | 'farm' | 'canvas' | 'analytics' | 'terminal'>('office'); // Toggle between views
  const [sessionTags, setSessionTags] = useState<Map<string, SessionTag[]>>(new Map());
  const [budgetConfig, setBudgetConfig] = useState<BudgetConfig>({ enabled: false });
  const [budgetAlertsDismissed, setBudgetAlertsDismissed] = useState(false);
  const [actionResult, setActionResult] = useState<string>('');
  const [showActionResult, setShowActionResult] = useState(false);
  const [enrichedSessions, setEnrichedSessions] = useState<OpenClawSession[]>([]);

  // ─── Multi-floor state ──────────────────────────────
  const [floors, setFloors] = useState<OfficeFloor[]>(DEFAULT_FLOORS);
  const [currentFloorId, setCurrentFloorId] = useState<string>('floor_1');

  // ─── Setup wizard ─────────────────────────────────────────────────────────
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  // ─── Multi-connection state ──────────────────────────────
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const pollersRef = useRef<Map<string, OpenClawPoller>>(new Map());
  const sessionsRef = useRef<Map<string, OpenClawSession[]>>(new Map());
  const [sessionsTick, setSessionsTick] = useState(0); // force re-render on session updates

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
    };
  }, [circleId, connections.filter(c => c.status === 'connected').length]);

  // ─── Terminal command subscription ────────────────────────────────────────
  // Listen for commands targeting my agents; respond with a stub (Phase 3 = real bridge)
  useEffect(() => {
    if (!currentUserId || !circleId) return;

    const myAgents = circleOfficeAgents.filter(a => a.ownerId === currentUserId);
    if (myAgents.length === 0) return;

    const myAgentIds = myAgents.map(a => a.id);

    const unsub = subscribeToTerminalCommands(circleId, myAgentIds, async (cmd: BroadcastCommandPayload) => {
      // Phase 3: Real agent invocation
      // For @all: invoke all online agents in parallel
      // For targeted: invoke specific agent

      if (cmd.targetAgentId) {
        // Single agent — invoke directly
        const agent = myAgents.find(a => a.id === cmd.targetAgentId);
        if (!agent) return;

        // Fire off the invocation (don't await — let it stream)
        invokeAndStream(
          {
            messageId: cmd.messageId,
            circleId,
            command: cmd.commandText,
            targetAgentId: agent.id,
            targetAgentName: `@${agent.name}`,
          },
          agent,
          'http://localhost:18790'
        ).catch(err => {
          console.error('[OfficeTab] Invocation failed:', err);
        });
      } else {
        // @all command — invoke all agents in parallel
        invokeAllAgents(
          {
            messageId: cmd.messageId,
            circleId,
            command: cmd.commandText,
            targetAgentName: '@all',
          },
          myAgents,
          'http://localhost:18790'
        ).catch(err => {
          console.error('[OfficeTab] Multi-agent invocation failed:', err);
        });
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

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      // Load connections
      const conns = await loadConnections();
      setConnections(conns);

      // Auto-connect all enabled connections (skip localhost on production)
      const isProduction = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
      for (const conn of conns) {
        if (conn.enabled) {
          // Skip localhost endpoints on production
          const isLocalhost = conn.endpoint.includes('localhost') || conn.endpoint.includes('127.0.0.1');
          if (isProduction && isLocalhost) {
            console.log(`Skipping localhost connection "${conn.name}" on production`);
            continue;
          }
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

      // Load floors
      try {
        const floorsRaw = await storage.getItem(STORAGE_KEY_FLOORS);
        if (floorsRaw) {
          const loadedFloors = JSON.parse(floorsRaw) as OfficeFloor[];
          if (loadedFloors.length > 0) setFloors(loadedFloors);
        }
      } catch {}

      // Load current floor
      try {
        const currentFloorRaw = await storage.getItem(STORAGE_KEY_CURRENT_FLOOR);
        if (currentFloorRaw) setCurrentFloorId(currentFloorRaw);
      } catch {}

      // Load agent appearances
      try {
        const appearancesRaw = await storage.getItem(STORAGE_KEY_APPEARANCES);
        if (appearancesRaw) setAppearances(JSON.parse(appearancesRaw));
      } catch {}

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

      // Load budget config
      loadBudgetConfig().then(setBudgetConfig);
    })();
  }, [connectOne]);

  // Cleanup pollers on unmount
  useEffect(() => {
    return () => {
      pollersRef.current.forEach(p => p.stop());
      pollersRef.current.clear();
      if (tgPollerRef.current) tgPollerRef.current.stop();
    };
  }, []);

  // ─── Floor management (must be defined before useEffects that use it) ──────
  
  const saveFloors = useCallback((updatedFloors: OfficeFloor[]) => {
    setFloors(updatedFloors);
    storage.setItem(STORAGE_KEY_FLOORS, JSON.stringify(updatedFloors)).catch(() => {});
  }, []);

  const { width: winW } = useWindowDimensions();
  const isDesktop = winW > 900;

  // Get current floor data with safety checks (must be before agent filtering)
  const currentFloor = floors.find(f => f.id === currentFloorId) || floors[0] || DEFAULT_FLOORS[0];
  const currentTheme = OFFICE_THEMES[currentFloor?.themeId] || OFFICE_THEMES.underground;

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
  // Apply custom names
  const allAgents = rawAgents.map(a => agentNames[a.id] ? { ...a, name: agentNames[a.id] } : a);

  // Use enriched agents if available (has cached costs/tokens), fallback to fresh agents
  const displayAgents = enrichedAgents.length > 0 ? enrichedAgents : allAgents;

  // Filter agents for current floor only (with safety check)
  const agents = displayAgents.filter(a => currentFloor?.agentIds?.includes(a.id));

  // Auto-assign new agents to first floor
  useEffect(() => {
    if (displayAgents.length === 0 || floors.length === 0) return;
    
    const allAgentIds = displayAgents.map(a => a.id);
    const assignedIds = new Set(floors.flatMap(f => f.agentIds));
    const unassignedIds = allAgentIds.filter(id => !assignedIds.has(id));
    
    if (unassignedIds.length > 0) {
      // Assign unassigned agents to the first floor
      const updated = floors.map((f, i) => 
        i === 0 ? { ...f, agentIds: [...f.agentIds, ...unassignedIds] } : f
      );
      saveFloors(updated);
    }
  }, [displayAgents.length, floors, saveFloors]);

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

  // Save appearances when changed
  useEffect(() => {
    if (Object.keys(appearances).length > 0) {
      storage.setItem(STORAGE_KEY_APPEARANCES, JSON.stringify(appearances)).catch(() => {});
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
    if (!editMode || !placingType) return;
    const newFurniture = { id: `f_${Date.now()}`, type: placingType as any, x, y };
    const updated = floors.map(f => 
      f.id === currentFloorId ? { ...f, furniture: [...f.furniture, newFurniture] } : f
    );
    saveFloors(updated);
    setPlacingType(null);
  };

  const handleFurniturePress = (id: string) => {
    if (!editMode) return;
    const updated = floors.map(f =>
      f.id === currentFloorId ? { ...f, furniture: f.furniture.filter(item => item.id !== id) } : f
    );
    saveFloors(updated);
  };

  const handleCommand = (cmd: OfficeCommand) => {
    if (cmd.type === 'theme') handleChangeFloorTheme(currentFloorId, cmd.value);
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
    const nextNum = floors.length + 1;
    const newFloor = createDefaultFloor(
      `floor_${Date.now()}`,
      `${nextNum}F - New Floor`,
      'underground',
      floors.length
    );
    saveFloors([...floors, newFloor]);
  }, [floors, saveFloors]);

  const handleDeleteFloor = useCallback((floorId: string) => {
    if (floors.length <= 1) return; // Keep at least one floor
    const updated = floors.filter(f => f.id !== floorId).map((f, i) => ({ ...f, order: i }));
    saveFloors(updated);
    if (currentFloorId === floorId) {
      setCurrentFloorId(updated[0].id);
      storage.setItem(STORAGE_KEY_CURRENT_FLOOR, updated[0].id).catch(() => {});
    }
  }, [floors, currentFloorId, saveFloors]);

  const handleRenameFloor = useCallback((floorId: string, newName: string) => {
    const updated = floors.map(f => f.id === floorId ? { ...f, name: newName } : f);
    saveFloors(updated);
  }, [floors, saveFloors]);

  const handleChangeFloorTheme = useCallback((floorId: string, themeId: string) => {
    const updated = floors.map(f => f.id === floorId ? { ...f, themeId } : f);
    saveFloors(updated);
  }, [floors, saveFloors]);

  const handleSwitchFloor = useCallback((floorId: string) => {
    setCurrentFloorId(floorId);
    storage.setItem(STORAGE_KEY_CURRENT_FLOOR, floorId).catch(() => {});
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
          <Pressable
            onPress={() => {
              setViewMode(viewMode === 'cost' ? 'office' : 'cost');
            }}
            style={[styles.modeBtn, viewMode === 'cost' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'cost' && styles.modeBtnTextActive]}>
              📊
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setViewMode(viewMode === 'tags' ? 'office' : 'tags');
            }}
            style={[styles.modeBtn, viewMode === 'tags' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'tags' && styles.modeBtnTextActive]}>
              🏷️
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setViewMode(viewMode === 'metrics' ? 'office' : 'metrics');
            }}
            style={[styles.modeBtn, viewMode === 'metrics' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'metrics' && styles.modeBtnTextActive]}>
              🏆
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setViewMode(viewMode === 'farm' ? 'office' : 'farm');
            }}
            style={[styles.modeBtn, viewMode === 'farm' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'farm' && styles.modeBtnTextActive]}>
              🏥
            </Text>
          </Pressable>
          {/* ─── New: Pixel Canvas / Analytics / Terminal ─── */}
          <Pressable
            onPress={() => setViewMode(viewMode === 'canvas' ? 'office' : 'canvas')}
            style={[styles.modeBtn, viewMode === 'canvas' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'canvas' && styles.modeBtnTextActive]}>
              🖥️
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode(viewMode === 'analytics' ? 'office' : 'analytics')}
            style={[styles.modeBtn, viewMode === 'analytics' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'analytics' && styles.modeBtnTextActive]}>
              📈
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode(viewMode === 'terminal' ? 'office' : 'terminal')}
            style={[styles.modeBtn, viewMode === 'terminal' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'terminal' && styles.modeBtnTextActive]}>
              ⌨️
            </Text>
          </Pressable>
          {viewMode === 'office' && (
            <Pressable
              onPress={() => { setEditMode(!editMode); setPlacingType(null); }}
              style={[styles.modeBtn, editMode && styles.modeBtnActive,
                Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[styles.modeBtnText, editMode && styles.modeBtnTextActive]}>
                {editMode ? '✓' : '🔧'}
              </Text>
            </Pressable>
          )}
          {!isDesktop ? (
            <View style={styles.titleCenterMobile}>
              {connectedConns.map(c => (
                <View key={c.id} style={[styles.connMiniDot, { backgroundColor: PROVIDER_META[c.provider].color }]} />
              ))}
              <Text style={styles.titleStatText}>
                {anyConnected ? `${displayAgents.length} live` : 'OFFICE'}
              </Text>
              {telegramConnected && <Text style={styles.tgBadge}>✈️</Text>}
            </View>
          ) : (
            <>
              <View style={styles.titleCenter}>
                <Text style={styles.titleIcon}>{'🏢'}</Text>
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
                  {displayAgents.length > 0 ? `${displayAgents.length} agents` : ''}
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
            {floors.sort((a, b) => a.order - b.order).map((floor) => {
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
                    <View style={[styles.floorThemeDot, { backgroundColor: OFFICE_THEMES[floor.themeId]?.accentGlow || '#6366f1' }]} />
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
              {placingType ? `TAP FLOOR — PLACING: ${placingType.toUpperCase()}` : 'ADD TO OFFICE'}
            </Text>
            <View style={styles.editToolbarActions}>
              {placingType && (
                <Pressable onPress={() => setPlacingType(null)} style={[styles.editActionBtn, { borderColor: '#f59e0b55' }]}>
                  <Text style={[styles.editActionBtnText, { color: '#f59e0b' }]}>CANCEL</Text>
                </Pressable>
              )}
              {currentFloor.furniture.length > 0 && (
                <Pressable onPress={() => {
                  const updated = floors.map(f => f.id === currentFloorId ? { ...f, furniture: [] } : f);
                  saveFloors(updated);
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

      {/* Connections Bar - always visible when connections exist */}
      {connections.length > 0 && viewMode === 'office' && (
        <View style={styles.connectionsBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.connectionsBarInner}>
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
          </ScrollView>
        </View>
      )}

      {/* ─── New views: Pixel Canvas / Analytics / Terminal ─── */}
      {viewMode === 'canvas' ? (
        <PixelOfficeCanvas
          agents={mergedCircleAgents}
          currentUserId={currentUserId}
        />
      ) : viewMode === 'analytics' ? (
        <OfficeAnalyticsPanel
          circleId={circleId}
          userId={currentUserId}
          agents={mergedCircleAgents}
        />
      ) : viewMode === 'terminal' ? (
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
        />
      ) : null}

      {/* Main Content - Switch between Office, Cost, Tags, Metrics, and Farm views */}
      {(viewMode === 'canvas' || viewMode === 'analytics' || viewMode === 'terminal') ? null : viewMode === 'cost' ? (
        <CostDashboard
          sessions={enrichedSessions}
          agents={enrichedAgents}
          sessionTags={sessionTags}
          accentColor={accentColor}
        />
      ) : viewMode === 'tags' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
          {/* BYOA + Deploy buttons */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
            <Pressable
              style={styles.tagsActionBtn}
              onPress={() => setShowTemplates(true)}
            >
              <Text style={styles.tagsActionBtnText}>+ DEPLOY AGENT</Text>
            </Pressable>
            <Pressable
              style={[styles.tagsActionBtn, styles.tagsActionBtnSecondary]}
              onPress={() => setShowByoa(true)}
            >
              <Text style={[styles.tagsActionBtnText, styles.tagsActionBtnTextSecondary]}>BYOA SETUP</Text>
            </Pressable>
          </View>
          {/* Shared Memory */}
          <SharedMemoryPanel circleId={circleId} />
          <ProjectRoomsPanel circleId={circleId} />
          <SessionTagsDashboard
            agents={displayAgents}
            sessionTags={sessionTags}
          />
        </ScrollView>
      ) : viewMode === 'metrics' ? (
        <AgentPerformanceMetrics
          agents={enrichedAgents}
          sessions={enrichedSessions}
          accentColor={accentColor}
        />
      ) : viewMode === 'farm' ? (
        <FarmHealthDashboard
          agents={enrichedAgents}
          sessions={enrichedSessions}
          accentColor={accentColor}
        />
      ) : (
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
            {displayAgents.length === 0 ? (
              <View style={styles.mobileEmpty}>
                <Text style={styles.mobileEmptyIcon}>🔗</Text>
                <Text style={styles.mobileEmptyTitle}>No agents connected</Text>
                {(() => {
                  const isProduction = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
                  const hasLocalhost = connections.some(c => c.endpoint.includes('localhost') || c.endpoint.includes('127.0.0.1'));
                  const hasOnlyLocalhost = connections.length > 0 && connections.every(c => c.endpoint.includes('localhost') || c.endpoint.includes('127.0.0.1'));
                  
                  if (isProduction && hasOnlyLocalhost) {
                    // User has connections, but they're all localhost (skipped on production)
                    return (
                      <>
                        <Text style={styles.mobileEmptyText}>Your saved connections use localhost and can't be reached from this domain.</Text>
                        <View style={{ marginTop: 12, padding: 12, backgroundColor: '#1a1a2e', borderRadius: 8, borderWidth: 1, borderColor: '#333' }}>
                          <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '700', marginBottom: 6 }}>💡 The Office connects to LOCAL AI agents</Text>
                          <Text style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>Your connections work when running on localhost, but production can't access them due to browser security (CSP).</Text>
                        </View>
                      </>
                    );
                  } else if (isProduction) {
                    // Production, no connections or some non-localhost
                    return (
                      <>
                        <Text style={styles.mobileEmptyText}>The Office dashboard connects to your local AI agents</Text>
                        <View style={{ marginTop: 12, padding: 12, backgroundColor: '#1a1a2e', borderRadius: 8, borderWidth: 1, borderColor: '#333' }}>
                          <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '700', marginBottom: 8 }}>📋 Setup Guide</Text>
                          <Text style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>1️⃣ Install OpenClaw on your computer</Text>
                          <Text style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>2️⃣ Run it locally (it starts a server)</Text>
                          <Text style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>3️⃣ Tap ⚙️ → Connections to add endpoint</Text>
                          <Text style={{ color: '#666', fontSize: 10, marginTop: 6, fontStyle: 'italic' }}>Or use a remote OpenClaw/agent endpoint</Text>
                        </View>
                      </>
                    );
                  } else {
                    // Localhost
                    return <Text style={styles.mobileEmptyText}>Tap ⚙️ → Connections to add your agent endpoints</Text>;
                  }
                })()}
                <Pressable
                  onPress={() => setShowSetupWizard(true)}
                  style={[styles.mobileEmptyBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  accessibilityRole="button"
                  accessibilityLabel="Connect agent"
                >
                  <Text style={styles.mobileEmptyBtnText}>🤖 CONNECT AGENT</Text>
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
                    />
                    <Whiteboard editable={editMode} notes={whiteboardNotes} onNotesChange={setWhiteboardNotes} agents={displayAgents} statusHistory={statusHistory} cronJobs={cronJobs} circleId={circleId} />
                    <ServerRack agents={displayAgents} />
                    {agents.length === 0 && (
                      <View style={styles.emptyOverlay}>
                        <Text style={{ fontSize: 36, marginBottom: 12 }}>🤖</Text>
                        <Text style={styles.emptyTitle}>No agents connected</Text>
                        <Text style={styles.emptyText}>Connect your AI agent to show up in the circle office</Text>
                        <Pressable
                          onPress={() => setShowSetupWizard(true)}
                          style={{ marginTop: 16, backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Connect Agent →</Text>
                        </Pressable>
                      </View>
                    )}
                    {agents.map((agent, i) => {
                      const pos = DESK_POSITIONS[i];
                      if (!pos) return null;
                      return (
                        <View key={agent.id} style={[styles.agentPosition, { left: pos.x - 2, top: pos.y - 50 }]}>
                          <PixelAgent
                            agent={agent}
                            appearance={appearances[agent.id]}
                            onPress={() => handleAgentPress(agent)}
                            selected={selectedAgent?.id === agent.id}
                            showThoughts={!editMode} // Show thoughts when not in edit mode
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
                {mergedCircleAgents.length > 0 && (
                  <CircleOfficePanel
                    agents={mergedCircleAgents}
                    onRefresh={loadCircleOffice}
                    accentColor={accentColor}
                    connectionStatus={circleConnectionStatus}
                    compact
                  />
                )}
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
              compact
            />
          </View>
        )}

        {/* Terminal - fullscreen overlay (same mirror) */}
        {terminalSize === 'full' && (
          <View style={styles.terminalFullscreen}>
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
            />
          </View>
        )}
      </View>
      )}

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
              placeholder="e.g. SwanBot, Claude Code, Codex..."
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

      {/* BYOA Panel Modal */}
      <Modal visible={showByoa} animationType="slide" presentationStyle="pageSheet">
        <ByoaPanel
          circleId={circleId}
          onClose={() => setShowByoa(false)}
        />
      </Modal>

      {/* Agent Templates Modal */}
      <Modal visible={showTemplates} animationType="slide" presentationStyle="pageSheet">
        <AgentTemplates
          circleId={circleId}
          onClose={() => setShowTemplates(false)}
          onDeployed={() => setShowTemplates(false)}
        />
      </Modal>

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
        onThemeChange={(theme) => handleChangeFloorTheme(currentFloorId, theme)}
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
        budgetConfig={budgetConfig}
        onBudgetConfigChange={handleBudgetConfigChange}
      />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  titleBar: {
    alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  titleInner: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 8 },
  titleCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  titleCenterMobile: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  titleRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  titleIcon: { fontSize: 14 },
  titleText: { fontSize: 12, fontWeight: '900', color: '#888', fontFamily: 'monospace', letterSpacing: 3 },
  onlineIndicator: { width: 6, height: 6, borderRadius: 3 },
  connMiniDot: { width: 5, height: 5, borderRadius: 3 },
  titleStatText: { fontSize: 13, color: '#888', fontFamily: 'monospace' },
  modeBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
    minWidth: 44, minHeight: 44, alignItems: 'center' as any, justifyContent: 'center' as any,
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
    width: 44, height: 44, borderRadius: 10, backgroundColor: '#111118',
    borderWidth: 1, borderColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', marginLeft: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  iconBtnText: { fontSize: 18 },
  reconnectBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: '#6366f115',
    borderWidth: 1, borderColor: '#6366f140', alignItems: 'center', justifyContent: 'center', marginLeft: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  reconnectBtnText: { fontSize: 16 },
  tgBadge: { fontSize: 10, marginRight: 2 },

  // Floor selector
  floorBar: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e', backgroundColor: '#08080d',
  },
  floorList: { gap: 6, flexDirection: 'row', alignItems: 'center' },
  floorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
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
    paddingHorizontal: 12, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e', backgroundColor: '#08080d',
  },
  connectionsBarInner: { gap: 8, flexDirection: 'row', alignItems: 'center' },
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
});
