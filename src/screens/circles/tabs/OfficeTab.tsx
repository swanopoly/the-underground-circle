import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  useWindowDimensions, Platform,
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
import { enrichAgentsWithCache, takeSnapshot, loadSessionTags as loadCachedTags } from '../../../lib/sessionCache';
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
import {
  SessionTag, loadSessionTags, addSessionTag, removeSessionTag,
} from '../../../lib/sessionTags';
import {
  BudgetConfig, loadBudgetConfig, saveBudgetConfig, calculateBudgetAlerts,
} from '../../../lib/budgetAlerts';
import BudgetAlertBanner from '../../../components/BudgetAlertBanner';
import { calculatePeriodCosts } from '../../../lib/costCalculations';
import OfficeActionPanel from '../../../components/OfficeActionPanel';

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
  const [appearances, setAppearances] = useState<Record<string, AgentAppearance>>({});
  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [whiteboardNotes, setWhiteboardNotes] = useState<string[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [statusHistory, setStatusHistory] = useState<Array<OfficeAgent[]>>([]);
  const [enrichedAgents, setEnrichedAgents] = useState<OfficeAgent[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<'office' | 'cost' | 'tags'>('office'); // Toggle between views
  const [sessionTags, setSessionTags] = useState<Map<string, SessionTag[]>>(new Map());
  const [budgetConfig, setBudgetConfig] = useState<BudgetConfig>({ enabled: false });
  const [budgetAlertsDismissed, setBudgetAlertsDismissed] = useState(false);
  const [actionResult, setActionResult] = useState<string>('');
  const [showActionResult, setShowActionResult] = useState(false);

  // ─── Multi-floor state ──────────────────────────────
  const [floors, setFloors] = useState<OfficeFloor[]>(DEFAULT_FLOORS);
  const [currentFloorId, setCurrentFloorId] = useState<string>('floor_1');

  // ─── Multi-connection state ──────────────────────────────
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const pollersRef = useRef<Map<string, OpenClawPoller>>(new Map());
  const sessionsRef = useRef<Map<string, OpenClawSession[]>>(new Map());
  const [sessionsTick, setSessionsTick] = useState(0); // force re-render on session updates

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
    const updated = [...connections, conn];
    setConnections(updated);
    await saveConnections(updated);
    // Auto-connect
    connectOne(conn);
  }, [connections, connectOne]);

  const handleRemoveConnection = useCallback(async (id: string) => {
    disconnectOne(id);
    const updated = connections.filter(c => c.id !== id);
    setConnections(updated);
    await saveConnections(updated);
  }, [connections, disconnectOne]);

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
      console.log(`🔌 Reconnecting ${toReconnect.length} connection${toReconnect.length !== 1 ? 's' : ''}:`, 
        toReconnect.map(c => c.name).join(', '));
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

      // Auto-connect all enabled connections
      for (const conn of conns) {
        if (conn.enabled) connectOne(conn);
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
    const connAgents = sessionsToAgents(sessions, conn.id, conn.name, conn.provider, indexOffset);
    rawAgents.push(...connAgents);
    indexOffset += connAgents.length;
  }
  // Apply custom names
  const allAgents = rawAgents.map(a => agentNames[a.id] ? { ...a, name: agentNames[a.id] } : a);

  // Use enriched agents if available (has cached costs/tokens), fallback to fresh agents
  const displayAgents = enrichedAgents.length > 0 ? enrichedAgents : allAgents;

  // Filter agents for current floor only (with safety check)
  const agents = displayAgents.filter(a => currentFloor?.agentIds?.includes(a.id));

  // Aggregate all sessions for cost dashboard
  const allSessions: OpenClawSession[] = [];
  for (const conn of connectedConns) {
    const sessions = sessionsRef.current.get(conn.id) || [];
    allSessions.push(...sessions);
  }

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

  // Enrich agents with cached data
  useEffect(() => {
    const doEnrich = async () => {
      if (allAgents.length === 0) {
        setEnrichedAgents([]);
        return;
      }
      
      try {
        const enriched = await enrichAgentsWithCache(allAgents);
        setEnrichedAgents(enriched);
      } catch (error) {
        console.error('Failed to enrich agents:', error);
        setEnrichedAgents(allAgents);
      }
    };
    doEnrich();
  }, [sessionsTick, agentNames]);

  // Periodic snapshot save (every 30 seconds)
  useEffect(() => {
    if (enrichedAgents.length === 0) return;
    
    const interval = setInterval(async () => {
      try {
        await takeSnapshot(enrichedAgents, sessionTags);
        console.log('💾 Session snapshot saved (including tags)');
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

  const handleRenameAgent = useCallback((agentId: string, newName: string) => {
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
  const periodCosts = calculatePeriodCosts(allSessions);
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
              if (viewMode === 'office') setViewMode('cost');
              else if (viewMode === 'cost') setViewMode('tags');
              else setViewMode('office');
            }}
            style={[styles.modeBtn, viewMode !== 'office' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode !== 'office' && styles.modeBtnTextActive]}>
              {viewMode === 'office' ? '📊' : viewMode === 'cost' ? '🏷️' : '🏢'}
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
              return (
                <Pressable
                  key={floor.id}
                  onPress={() => handleSwitchFloor(floor.id)}
                  style={[
                    styles.floorChip,
                    floor.id === currentFloorId && styles.floorChipActive,
                    Platform.OS === 'web' && { cursor: 'pointer' } as any
                  ]}
                >
                  <Text style={[styles.floorChipText, floor.id === currentFloorId && styles.floorChipTextActive]}>
                    {floor.name}
                  </Text>
                  {floorAgentCount > 0 && (
                    <View style={styles.floorAgentBadge}>
                      <Text style={styles.floorAgentBadgeText}>{floorAgentCount}</Text>
                    </View>
                  )}
                  <View style={[styles.floorThemeDot, { backgroundColor: OFFICE_THEMES[floor.themeId]?.accentGlow || '#6366f1' }]} />
                </Pressable>
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
          <Text style={styles.editLabel}>
            {placingType ? `TAP FLOOR TO PLACE ${placingType.toUpperCase()}` : 'SELECT ITEM:'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editItems}>
            {FURNITURE_CATALOG.filter(f => !['desk', 'whiteboard', 'server'].includes(f.type)).map(item => (
              <Pressable
                key={item.type}
                onPress={() => setPlacingType(placingType === item.type ? null : item.type)}
                style={[styles.editItem, placingType === item.type && styles.editItemActive,
                  Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={styles.editItemIcon}>{item.icon}</Text>
                <Text style={styles.editItemName}>{item.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {currentFloor.furniture.length > 0 && (
            <Pressable onPress={() => {
              const updated = floors.map(f => f.id === currentFloorId ? { ...f, furniture: [] } : f);
              saveFloors(updated);
            }} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>CLEAR ALL</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Main Content - Switch between Office, Cost, and Tags views */}
      {viewMode === 'cost' ? (
        <CostDashboard
          sessions={allSessions}
          accentColor={accentColor}
        />
      ) : viewMode === 'tags' ? (
        <SessionTagsDashboard
          agents={displayAgents}
          sessionTags={sessionTags}
        />
      ) : (
        <View style={styles.mainContent}>
        {/* Mobile: Card-based agent list */}
        {!isDesktop ? (
          <ScrollView style={styles.mobileAgentScroll} showsVerticalScrollIndicator={true} contentContainerStyle={styles.mobileAgentList}>
            {displayAgents.length === 0 ? (
              <View style={styles.mobileEmpty}>
                <Text style={styles.mobileEmptyIcon}>🔗</Text>
                <Text style={styles.mobileEmptyTitle}>No agents connected</Text>
                <Text style={styles.mobileEmptyText}>Tap ⚙️ → Connections to add your agent endpoints</Text>
                <Pressable
                  onPress={() => setShowCustomize(true)}
                  style={[styles.mobileEmptyBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  accessibilityRole="button"
                  accessibilityLabel="Add connection"
                >
                  <Text style={styles.mobileEmptyBtnText}>+ ADD CONNECTION</Text>
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
                      onFloorPress={editMode ? handleFloorPress : undefined}
                      onFurniturePress={editMode ? handleFurniturePress : undefined}
                    />
                    <Whiteboard editable={editMode} notes={whiteboardNotes} onNotesChange={setWhiteboardNotes} agents={displayAgents} statusHistory={statusHistory} cronJobs={cronJobs} />
                    <ServerRack agents={displayAgents} />
                    {agents.length === 0 && (
                      <View style={styles.emptyOverlay}>
                        <Text style={styles.emptyIcon}>🔗</Text>
                        <Text style={styles.emptyTitle}>No agents connected</Text>
                        <Text style={styles.emptyText}>Tap ⚙️ → Connections to add your agent endpoints</Text>
                        <Text style={styles.emptySub}>Supports OpenClaw, Claude Code, and generic APIs</Text>
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

        {/* Action Panel - Quick collaboration buttons */}
        {!editMode && anyConnected && (
          <OfficeActionPanel
            agents={displayAgents}
            getConfig={getConnectionConfig}
            onResult={handleActionResult}
          />
        )}

        {/* Chat toggle */}
        <Pressable
          onPress={() => setChatVisible(!chatVisible)}
          style={[styles.chatToggle, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          accessibilityRole="button"
          accessibilityLabel={chatVisible ? 'Hide chat' : 'Show chat'}
        >
          <Text style={styles.chatToggleText}>
            {chatVisible ? '▼ HIDE TERMINAL' : '▲ TERMINAL'}
          </Text>
        </Pressable>
        {chatVisible && !chatFullscreen && (
          <View style={styles.chatPane}>
            <OfficeChat
              circleId={circleId}
              onCommand={handleCommand}
              minimized={chatMinimized}
              onToggle={() => setChatMinimized(!chatMinimized)}
              fullscreen={false}
              onFullscreenToggle={() => setChatFullscreen(true)}
              agents={displayAgents}
              connections={connections}
              getConnectionConfig={getConnectionConfig}
              telegramConfig={telegramConnected ? telegramConfig : null}
              telegramConnected={telegramConnected}
              telegramMessages={telegramMessages}
            />
          </View>
        )}
        
        {/* Fullscreen terminal overlay */}
        {chatFullscreen && (
          <View style={styles.terminalFullscreen}>
            <OfficeChat
              circleId={circleId}
              onCommand={handleCommand}
              minimized={false}
              onToggle={() => {}}
              fullscreen={true}
              onFullscreenToggle={() => setChatFullscreen(false)}
              agents={displayAgents}
              connections={connections}
              getConnectionConfig={getConnectionConfig}
              telegramConfig={telegramConnected ? telegramConfig : null}
              telegramConnected={telegramConnected}
              telegramMessages={telegramMessages}
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
    borderTopWidth: 1, borderTopColor: '#1a1a2e', paddingVertical: 12,
    alignItems: 'center', backgroundColor: '#0a0a12', minHeight: 48,
    justifyContent: 'center',
  },
  chatToggleText: { fontSize: 13, color: '#888', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 },
  chatPane: { minHeight: 240 },

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
