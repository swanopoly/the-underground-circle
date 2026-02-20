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
  testConnection, listAgents, getSessionStatus, sendAgentTask,
} from '../../../lib/openclawService';

interface Props {
  circleId: string;
  accentColor: string;
}

export default function OfficeTab({ circleId, accentColor }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<OfficeAgent | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [themeId, setThemeId] = useState('underground');
  const [appearances, setAppearances] = useState<Record<string, AgentAppearance>>({});
  const [openclawEndpoint, setOpenclawEndpoint] = useState('http://localhost:18789');
  const [openclawKey, setOpenclawKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [furniture, setFurniture] = useState<FurnitureItem[]>([]);
  const [whiteboardNotes, setWhiteboardNotes] = useState<string[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);

  // Telegram state
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>({ botToken: '', chatId: '' });
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramBotName, setTelegramBotName] = useState<string | null>(null);
  const [telegramChatTitle, setTelegramChatTitle] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const pollerRef = useRef<TelegramPoller | null>(null);

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

    // Start polling
    if (pollerRef.current) pollerRef.current.stop();
    const poller = new TelegramPoller(botToken.trim(), (msgs) => {
      setTelegramMessages(prev => [...msgs, ...prev].slice(0, 50));
    });
    poller.start(5000);
    pollerRef.current = poller;

    setTelegramConnected(true);
    setTelegramConnecting(false);
  }, [telegramConfig]);

  const handleTelegramDisconnect = useCallback(() => {
    if (pollerRef.current) { pollerRef.current.stop(); pollerRef.current = null; }
    setTelegramConnected(false);
    setTelegramBotName(null);
    setTelegramChatTitle(null);
    setTelegramMessages([]);
    setTelegramError(null);
  }, []);

  // ─── OpenClaw state ──────────────────────────────
  const [openclawConnecting, setOpenclawConnecting] = useState(false);
  const [openclawError, setOpenclawError] = useState<string | null>(null);
  const [openclawSessions, setOpenclawSessions] = useState<OpenClawSession[]>([]);
  const [openclawAgentIds, setOpenclawAgentIds] = useState<string[]>([]);
  const openclawPollerRef = useRef<OpenClawPoller | null>(null);

  const handleOpenclawConnect = useCallback(async () => {
    if (!openclawEndpoint.trim()) { setOpenclawError('Endpoint is required'); return; }
    setOpenclawConnecting(true);
    setOpenclawError(null);

    const config: OpenClawConfig = { endpoint: openclawEndpoint.trim(), token: openclawKey.trim() };
    const result = await testConnection(config);

    if (!result.ok) {
      setOpenclawError(result.error || 'Connection failed');
      setOpenclawConnecting(false);
      return;
    }

    setOpenclawSessions(result.sessions || []);
    setConnected(true);

    // Fetch agent list
    const agentsResult = await listAgents(config);
    if (agentsResult.ok && agentsResult.agents) {
      setOpenclawAgentIds(agentsResult.agents);
    }

    // Start polling for live session updates
    if (openclawPollerRef.current) openclawPollerRef.current.stop();
    const poller = new OpenClawPoller(config, (update: OpenClawUpdate) => {
      setOpenclawSessions(update.sessions);
    });
    poller.start(10000);
    openclawPollerRef.current = poller;

    setOpenclawConnecting(false);
  }, [openclawEndpoint, openclawKey]);

  const handleOpenclawDisconnect = useCallback(() => {
    if (openclawPollerRef.current) { openclawPollerRef.current.stop(); openclawPollerRef.current = null; }
    setConnected(false);
    setOpenclawSessions([]);
    setOpenclawAgentIds([]);
    setOpenclawError(null);
  }, []);

  // Cleanup pollers on unmount
  useEffect(() => {
    return () => {
      if (pollerRef.current) pollerRef.current.stop();
      if (openclawPollerRef.current) openclawPollerRef.current.stop();
    };
  }, []);

  const { width: winW } = useWindowDimensions();
  const isDesktop = winW > 900;
  const theme = OFFICE_THEMES[themeId] || OFFICE_THEMES.underground;

  // Derive agents from live OpenClaw sessions (no mock data)
  const agents: OfficeAgent[] = connected ? sessionsToAgents(openclawSessions) : [];

  // Scale office floor to fit available width
  // Desktop: scale up to fill. Mobile: min 0.55x so text stays readable, scroll if needed
  const availableW = winW - 24;
  const rawScale = availableW / FLOOR_W;
  const officeScale = Math.max(0.55, rawScale);
  const scaledH = FLOOR_H * officeScale;
  const needsHScroll = rawScale < 0.55; // Mobile needs horizontal scroll

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

  return (
    <View style={styles.container}>
      {/* Title bar */}
      <View style={styles.titleBar}>
        <View style={styles.titleInner}>
          <Pressable
            onPress={() => { setEditMode(!editMode); setPlacingType(null); }}
            style={[styles.modeBtn, editMode && styles.modeBtnActive,
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.modeBtnText, editMode && styles.modeBtnTextActive]}>
              {editMode ? '✓' : '🔧'}
            </Text>
          </Pressable>
          {!isDesktop ? (
            /* Mobile: compact — just indicators + settings */
            <>
              <View style={styles.titleCenterMobile}>
                <View style={[styles.onlineIndicator, { backgroundColor: connected ? '#22c55e' : '#555' }]} />
                <Text style={styles.titleStatText}>
                  {connected ? `${agents.length} live` : 'OFFICE'}
                </Text>
                {telegramConnected && <Text style={styles.tgBadge}>✈️</Text>}
              </View>
            </>
          ) : (
            /* Desktop: full title */
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
                <View style={[styles.onlineIndicator, { backgroundColor: connected ? '#22c55e' : '#555' }]} />
                <Text style={styles.titleStatText}>
                  {connected ? `${agents.length} live` : '0 connected'}
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
      {editMode && (
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

      {/* Office viewport — full width, scaled to fit */}
      <View style={styles.mainContent}>
        <ScrollView style={styles.officeScroll} showsVerticalScrollIndicator={true}>
          <ScrollView
            horizontal={needsHScroll}
            scrollEnabled={needsHScroll}
            showsHorizontalScrollIndicator={needsHScroll}
          >
            <View style={[styles.officeScaleOuter, { height: scaledH, width: needsHScroll ? FLOOR_W * officeScale : '100%' as any }]}>
              <View style={[styles.officeWrapper, {
                width: FLOOR_W, height: FLOOR_H,
                transform: [{ scale: officeScale }],
              }]}>
              <OfficeFloor
                theme={theme}
                furniture={furniture}
                onFloorPress={editMode ? handleFloorPress : undefined}
                onFurniturePress={editMode ? handleFurniturePress : undefined}
              />
              <Whiteboard editable={editMode} notes={whiteboardNotes} onNotesChange={setWhiteboardNotes} agents={agents} />
              <ServerRack agents={agents} />
              {agents.length === 0 && (
                <View style={styles.emptyOverlay}>
                  <Text style={styles.emptyIcon}>🔗</Text>
                  <Text style={styles.emptyTitle}>No agents connected</Text>
                  <Text style={styles.emptyText}>Tap ⚙️ → Connect to link your OpenClaw gateway</Text>
                  <Text style={styles.emptySub}>Your live AI sessions will appear as pixel agents</Text>
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

        {/* Agent quick bar */}
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

        {/* Chat toggle + collapsible chat */}
        <Pressable
          onPress={() => setChatVisible(!chatVisible)}
          style={[styles.chatToggle, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={styles.chatToggleText}>
            {chatVisible ? '▼ HIDE CHAT' : '▲ SHOW CHAT'}
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
              openclawConfig={connected ? { endpoint: openclawEndpoint, token: openclawKey } : null}
              openclawConnected={connected}
              telegramConfig={telegramConnected ? telegramConfig : null}
              telegramConnected={telegramConnected}
              telegramMessages={telegramMessages}
            />
          </View>
        )}
      </View>

      {/* Agent detail panel */}
      {!editMode && (
        <AgentPanel agent={selectedAgent} onClose={() => setSelectedAgent(null)} isDesktop={isDesktop} />
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
        openclawEndpoint={openclawEndpoint}
        openclawKey={openclawKey}
        onEndpointChange={setOpenclawEndpoint}
        onKeyChange={setOpenclawKey}
        onConnect={handleOpenclawConnect}
        onDisconnect={handleOpenclawDisconnect}
        connected={connected}
        openclawConnecting={openclawConnecting}
        openclawError={openclawError}
        openclawSessionCount={openclawSessions.length}
        openclawAgents={openclawAgentIds}
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

  // Title bar
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
  titleStatText: { fontSize: 10, color: '#555', fontFamily: 'monospace' },
  modeBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  modeBtnActive: { borderColor: '#22c55e40', backgroundColor: '#22c55e15' },
  modeBtnText: { fontSize: 10, color: '#666', fontFamily: 'monospace', fontWeight: '700' },
  modeBtnTextActive: { color: '#22c55e' },
  iconBtn: {
    width: 28, height: 28, borderRadius: 6, backgroundColor: '#111118',
    borderWidth: 1, borderColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', marginLeft: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  iconBtnText: { fontSize: 12 },
  tgBadge: { fontSize: 10, marginRight: 2 },

  // Edit toolbar
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

  // Main content
  mainContent: { flex: 1 },
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

  // Quick bar
  quickBar: {
    borderTopWidth: 1, borderTopColor: '#1a1a2e', paddingVertical: 6, paddingHorizontal: 8,
  },
  quickBarInner: { gap: 6, flexDirection: 'row' },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8,
    paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
  },
  quickDot: { width: 4, height: 4, borderRadius: 2 },
  quickName: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  quickCost: { fontSize: 8, color: '#444', fontFamily: 'monospace' },

  // Chat toggle + pane
  chatToggle: {
    borderTopWidth: 1, borderTopColor: '#1a1a2e', paddingVertical: 6,
    alignItems: 'center', backgroundColor: '#0a0a12',
  },
  chatToggleText: { fontSize: 9, color: '#555', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 },
  chatPane: { minHeight: 200 },
});
