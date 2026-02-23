import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  useWindowDimensions, Platform,
} from 'react-native';
import OfficeFloor, { DESK_POSITIONS, FLOOR_W, FLOOR_H } from './office/OfficeFloor';
import PixelAgent from './office/PixelAgent';
import ServerRack from './office/ServerRack';
import Whiteboard from './office/Whiteboard';
import AgentPanel from './office/AgentPanel';
import CustomizePanel, { TelegramConfig } from './office/CustomizePanel';
import OfficeChat, { OfficeCommand } from './office/OfficeChat';
import { OfficeAgent, sessionsToAgents } from '../../../lib/officeAgents';
import {
  OFFICE_THEMES, AgentAppearance, FurnitureItem, FURNITURE_CATALOG,
} from '../../../lib/officeConfig';
import {
  verifyBot, getChat, TelegramPoller, TelegramMessage,
} from '../../../lib/telegramService';
import {
  OpenClawConfig, OpenClawPoller, OpenClawSession, OpenClawUpdate,
  testConnection, listAgents, listCronJobs, CronJob,
} from '../../../lib/openclawService';
import {
  AgentConnection, loadConnections, saveConnections, migrateFromLegacy, PROVIDER_META,
} from '../../../lib/connectionManager';
import { storage } from '../../../lib/storage';
import CostDashboard from '../../../components/CostDashboard';

const STORAGE_KEY_TELEGRAM = '@office_telegram_config';
const STORAGE_KEY_AGENT_NAMES = '@office_agent_names';

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
  const [themeId, setThemeId] = useState('underground');
  const [appearances, setAppearances] = useState<Record<string, AgentAppearance>>({});
  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [furniture, setFurniture] = useState<FurnitureItem[]>([]);
  const [whiteboardNotes, setWhiteboardNotes] = useState<string[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [statusHistory, setStatusHistory] = useState<Array<OfficeAgent[]>>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<'office' | 'cost'>('office'); // Toggle between views

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
      // Load connections (or migrate from legacy single-connection)
      let conns = await loadConnections();
      if (conns.length === 0) {
        const migrated = await migrateFromLegacy();
        if (migrated) conns = [migrated];
      }
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

  const { width: winW } = useWindowDimensions();
  const isDesktop = winW > 900;
  const theme = OFFICE_THEMES[themeId] || OFFICE_THEMES.underground;

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
  const agents = rawAgents.map(a => agentNames[a.id] ? { ...a, name: agentNames[a.id] } : a);

  // Update status history when agents change
  useEffect(() => {
    if (agents.length > 0) {
      setStatusHistory(prev => [...prev, agents].slice(-10));
    }
  }, [sessionsTick]);

  // Push agent stats to parent
  useEffect(() => {
    if (onAgentStats) {
      onAgentStats({
        agentCount: agents.length,
        sessionCount: agents.filter(a => a.status === 'active').length,
        costToday: agents.reduce((s, a) => s + a.costToday, 0),
        costWeek: agents.reduce((s, a) => s + a.costWeek, 0),
        tokens: agents.reduce((s, a) => s + a.tokensUsed, 0),
      });
    }
  }, [sessionsTick, agentNames, onAgentStats]);

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
    setFurniture(prev => [...prev, { id: `f_${Date.now()}`, type: placingType as any, x, y }]);
    setPlacingType(null);
  };

  const handleFurniturePress = (id: string) => {
    if (!editMode) return;
    setFurniture(prev => prev.filter(f => f.id !== id));
  };

  const handleCommand = (cmd: OfficeCommand) => {
    if (cmd.type === 'theme') setThemeId(cmd.value);
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

  return (
    <View style={styles.container}>
      {/* Title bar */}
      <View style={styles.titleBar}>
        <View style={styles.titleInner}>
          <Pressable
            onPress={() => setViewMode(viewMode === 'office' ? 'cost' : 'office')}
            style={[styles.modeBtn, viewMode === 'cost' && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, viewMode === 'cost' && styles.modeBtnTextActive]}>
              {viewMode === 'cost' ? '💰' : '📊'}
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
                {anyConnected ? `${agents.length} live` : 'OFFICE'}
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
                  {agents.length > 0 ? `${agents.length} agents` : ''}
                </Text>
              </View>
            </>
          )}
          <Pressable onPress={() => setShowCustomize(true)} style={[styles.iconBtn,
            Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.iconBtnText}>{'⚙️'}</Text>
          </Pressable>
        </View>
      </View>

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
          {furniture.length > 0 && (
            <Pressable onPress={() => setFurniture([])} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>CLEAR ALL</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Main Content - Switch between Office and Cost views */}
      {viewMode === 'cost' ? (
        <CostDashboard
          sessions={allSessions}
          accentColor={accentColor}
        />
      ) : (
        <View style={styles.mainContent}>
        {/* Mobile: Card-based agent list */}
        {!isDesktop ? (
          <ScrollView style={styles.mobileAgentScroll} showsVerticalScrollIndicator={true} contentContainerStyle={styles.mobileAgentList}>
            {agents.length === 0 ? (
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
              agents.map((agent) => {
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
                    <OfficeFloor
                      theme={theme}
                      furniture={furniture}
                      onFloorPress={editMode ? handleFloorPress : undefined}
                      onFurniturePress={editMode ? handleFurniturePress : undefined}
                    />
                    <Whiteboard editable={editMode} notes={whiteboardNotes} onNotesChange={setWhiteboardNotes} agents={agents} statusHistory={statusHistory} cronJobs={cronJobs} />
                    <ServerRack agents={agents} />
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
                  {agents.map((agent) => (
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
        {chatVisible && (
          <View style={styles.chatPane}>
            <OfficeChat
              circleId={circleId}
              onCommand={handleCommand}
              minimized={chatMinimized}
              onToggle={() => setChatMinimized(!chatMinimized)}
              agents={agents}
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
        <AgentPanel agent={selectedAgent} onClose={() => setSelectedAgent(null)} isDesktop={isDesktop} onRenameAgent={handleRenameAgent} />
      )}

      {/* Customization panel */}
      <CustomizePanel
        visible={showCustomize}
        onClose={() => setShowCustomize(false)}
        currentTheme={themeId}
        onThemeChange={setThemeId}
        agents={agents}
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
  tgBadge: { fontSize: 10, marginRight: 2 },
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
});
