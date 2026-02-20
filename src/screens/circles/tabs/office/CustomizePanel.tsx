import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, Platform,
} from 'react-native';
import {
  OFFICE_THEMES, OfficeTheme,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS,
  AgentAppearance, DEFAULT_APPEARANCE,
} from '../../../../lib/officeConfig';
import { OfficeAgent } from '../../../../lib/officeAgents';

type Tab = 'theme' | 'agents' | 'connect' | 'telegram';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  currentTheme: string;
  onThemeChange: (id: string) => void;
  agents: OfficeAgent[];
  appearances: Record<string, AgentAppearance>;
  onAppearanceChange: (agentId: string, appearance: AgentAppearance) => void;
  // OpenClaw connection
  openclawEndpoint: string;
  openclawKey: string;
  onEndpointChange: (v: string) => void;
  onKeyChange: (v: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  connected: boolean;
  openclawConnecting: boolean;
  openclawError: string | null;
  openclawSessionCount: number;
  openclawAgents: string[];
  // Telegram
  telegramConfig: TelegramConfig;
  onTelegramConfigChange: (config: TelegramConfig) => void;
  telegramConnected: boolean;
  telegramBotName: string | null;
  telegramChatTitle: string | null;
  onTelegramConnect: () => void;
  onTelegramDisconnect: () => void;
  telegramError: string | null;
  telegramConnecting: boolean;
}

export default function CustomizePanel({
  visible, onClose, currentTheme, onThemeChange,
  agents, appearances, onAppearanceChange,
  openclawEndpoint, openclawKey, onEndpointChange, onKeyChange, onConnect, onDisconnect, connected,
  openclawConnecting, openclawError, openclawSessionCount, openclawAgents,
  telegramConfig, onTelegramConfigChange, telegramConnected, telegramBotName,
  telegramChatTitle, onTelegramConnect, onTelegramDisconnect, telegramError, telegramConnecting,
}: Props) {
  const [tab, setTab] = useState<Tab>('theme');
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id || '');

  if (!visible) return null;

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const currentAppearance = appearances[selectedAgentId] || {
    ...DEFAULT_APPEARANCE,
    shirtColor: selectedAgent?.color || '#6366f1',
    hairColor: selectedAgent?.color || '#1a1a1a',
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>⚙️ CUSTOMIZE OFFICE</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {(['theme', 'agents', 'connect', 'telegram'] as Tab[]).map(t => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, tab === t && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'theme' ? '🎨' : t === 'agents' ? '🤖' : t === 'connect' ? '🔗' : '✈️'}
                {' '}{t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {tab === 'theme' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>OFFICE THEME</Text>
              <View style={styles.themeGrid}>
                {Object.values(OFFICE_THEMES).map(theme => (
                  <Pressable
                    key={theme.id}
                    onPress={() => onThemeChange(theme.id)}
                    style={[
                      styles.themeCard,
                      currentTheme === theme.id && { borderColor: theme.accentGlow },
                    ]}
                  >
                    <View style={styles.themePreview}>
                      <View style={[styles.themeFloor, { backgroundColor: theme.floorColor }]} />
                      <View style={[styles.themeWall, { backgroundColor: theme.wallColor }]} />
                      <View style={[styles.themeAccent, { backgroundColor: theme.accentGlow }]} />
                    </View>
                    <Text style={[
                      styles.themeName,
                      currentTheme === theme.id && { color: theme.accentGlow },
                    ]}>{theme.name}</Text>
                    {currentTheme === theme.id && <Text style={styles.themeCheck}>✓</Text>}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {tab === 'agents' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>SELECT AGENT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentScroll}>
                {agents.map(agent => (
                  <Pressable
                    key={agent.id}
                    onPress={() => setSelectedAgentId(agent.id)}
                    style={[
                      styles.agentChip,
                      selectedAgentId === agent.id && { borderColor: agent.color, backgroundColor: agent.color + '15' },
                    ]}
                  >
                    <Text style={[styles.agentChipText, selectedAgentId === agent.id && { color: agent.color }]}>
                      {agent.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {selectedAgent && (
                <>
                  <Text style={styles.sectionTitle}>SKIN TONE</Text>
                  <View style={styles.colorRow}>
                    {SKIN_TONES.map(color => (
                      <Pressable
                        key={color}
                        onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, skinTone: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, currentAppearance.skinTone === color && styles.swatchActive]}
                      />
                    ))}
                  </View>

                  <Text style={styles.sectionTitle}>HAIR COLOR</Text>
                  <View style={styles.colorRow}>
                    {HAIR_COLORS.map(color => (
                      <Pressable
                        key={color}
                        onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hairColor: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, currentAppearance.hairColor === color && styles.swatchActive]}
                      />
                    ))}
                  </View>

                  <Text style={styles.sectionTitle}>HAIR STYLE</Text>
                  <View style={styles.optionRow}>
                    {(['flat', 'spiky', 'mohawk', 'long', 'bald'] as const).map(style => (
                      <Pressable
                        key={style}
                        onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hairStyle: style })}
                        style={[styles.optionBtn, currentAppearance.hairStyle === style && styles.optionBtnActive]}
                      >
                        <Text style={[styles.optionText, currentAppearance.hairStyle === style && styles.optionTextActive]}>
                          {style.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.sectionTitle}>SHIRT COLOR</Text>
                  <View style={styles.colorRow}>
                    {SHIRT_COLORS.map(color => (
                      <Pressable
                        key={color}
                        onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, shirtColor: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, currentAppearance.shirtColor === color && styles.swatchActive]}
                      />
                    ))}
                  </View>

                  <Text style={styles.sectionTitle}>ACCESSORY</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'glasses', 'headphones', 'bowtie'] as const).map(acc => (
                      <Pressable
                        key={acc}
                        onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, accessory: acc })}
                        style={[styles.optionBtn, currentAppearance.accessory === acc && styles.optionBtnActive]}
                      >
                        <Text style={[styles.optionText, currentAppearance.accessory === acc && styles.optionTextActive]}>
                          {acc === 'none' ? 'NONE' : acc === 'glasses' ? '👓' : acc === 'headphones' ? '🎧' : '🎀'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.sectionTitle}>HAT</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'cap', 'tophat', 'beanie', 'crown'] as const).map(hat => (
                      <Pressable
                        key={hat}
                        onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hat: hat })}
                        style={[styles.optionBtn, currentAppearance.hat === hat && styles.optionBtnActive]}
                      >
                        <Text style={[styles.optionText, currentAppearance.hat === hat && styles.optionTextActive]}>
                          {hat === 'none' ? 'NONE' : hat === 'cap' ? '🧢' : hat === 'tophat' ? '🎩' : hat === 'beanie' ? '🧶' : '👑'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.sectionTitle}>EXPRESSION</Text>
                  <View style={styles.optionRow}>
                    {(['neutral', 'happy', 'focused', 'sleepy', 'cool'] as const).map(expr => (
                      <Pressable
                        key={expr}
                        onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, expression: expr })}
                        style={[styles.optionBtn, currentAppearance.expression === expr && styles.optionBtnActive]}
                      >
                        <Text style={[styles.optionText, currentAppearance.expression === expr && styles.optionTextActive]}>
                          {expr.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {tab === 'telegram' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TELEGRAM BOT INTEGRATION</Text>

              {/* Status indicator */}
              <View style={styles.connectStatus}>
                <View style={[styles.connectDot, { backgroundColor: telegramConnected ? '#22c55e' : telegramConnecting ? '#eab308' : '#ef4444' }]} />
                <Text style={styles.connectLabel}>
                  {telegramConnecting ? 'Connecting...' : telegramConnected ? `Connected — @${telegramBotName}` : 'Not connected'}
                </Text>
              </View>

              {telegramConnected && telegramChatTitle && (
                <View style={[styles.connectInfo, { borderColor: '#22c55e30' }]}>
                  <Text style={[styles.connectInfoTitle, { color: '#22c55e' }]}>✓ Linked to: {telegramChatTitle}</Text>
                  <Text style={styles.connectInfoText}>Messages will appear in the office feed.</Text>
                </View>
              )}

              {telegramError && (
                <View style={[styles.connectInfo, { borderColor: '#ef444430' }]}>
                  <Text style={[styles.connectInfoTitle, { color: '#ef4444' }]}>Error</Text>
                  <Text style={styles.connectInfoText}>{telegramError}</Text>
                </View>
              )}

              {!telegramConnected && (
                <>
                  <View style={styles.connectInfo}>
                    <Text style={styles.connectInfoTitle}>Quick Setup (2 minutes)</Text>
                    <Text style={styles.connectInfoText}>1. Open Telegram, search for @BotFather</Text>
                    <Text style={styles.connectInfoText}>2. Send /newbot and follow the prompts</Text>
                    <Text style={styles.connectInfoText}>3. Copy the API token and paste below</Text>
                    <Text style={styles.connectInfoText}>4. Add your bot to a group chat, or use your DM</Text>
                    <Text style={styles.connectInfoText}>5. Get chat ID: forward a msg to @userinfobot</Text>
                  </View>
                </>
              )}

              <Text style={styles.inputLabel}>Bot Token</Text>
              <TextInput
                style={styles.input}
                value={telegramConfig.botToken}
                onChangeText={(v) => onTelegramConfigChange({ ...telegramConfig, botToken: v })}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                placeholderTextColor="#333"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>Chat ID</Text>
              <TextInput
                style={styles.input}
                value={telegramConfig.chatId}
                onChangeText={(v) => onTelegramConfigChange({ ...telegramConfig, chatId: v })}
                placeholder="-1001234567890 or your user ID"
                placeholderTextColor="#333"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.tgBtnRow}>
                <Pressable
                  onPress={onTelegramConnect}
                  style={[styles.connectBtn, { backgroundColor: '#0088cc', flex: 1 }, telegramConnecting && { opacity: 0.6 }]}
                  disabled={telegramConnecting}
                >
                  <Text style={styles.connectBtnText}>
                    {telegramConnecting ? 'CONNECTING...' : telegramConnected ? 'RECONNECT' : '✈️ CONNECT BOT'}
                  </Text>
                </Pressable>
                {telegramConnected && (
                  <Pressable onPress={onTelegramDisconnect} style={[styles.connectBtn, { backgroundColor: '#ef444430', marginLeft: 8 }]}>
                    <Text style={[styles.connectBtnText, { color: '#ef4444' }]}>DISCONNECT</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.connectInfo}>
                <Text style={styles.connectInfoTitle}>What you get</Text>
                <Text style={styles.connectInfoText}>📨 Live message feed in the office</Text>
                <Text style={styles.connectInfoText}>🤖 TelegramBot agent shows activity</Text>
                <Text style={styles.connectInfoText}>📊 Message stats on the whiteboard</Text>
                <Text style={styles.connectInfoText}>💬 Send messages from the office chat</Text>
              </View>
            </View>
          )}

          {tab === 'connect' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>OPENCLAW CONNECTION</Text>

              <View style={styles.connectStatus}>
                <View style={[styles.connectDot, {
                  backgroundColor: connected ? '#22c55e' : openclawConnecting ? '#eab308' : '#ef4444',
                }]} />
                <Text style={styles.connectLabel}>
                  {openclawConnecting ? 'Connecting...' : connected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>

              {connected && (
                <View style={[styles.connectInfo, { borderColor: '#22c55e30' }]}>
                  <Text style={[styles.connectInfoTitle, { color: '#22c55e' }]}>✓ Live Connection</Text>
                  <Text style={styles.connectInfoText}>📡 {openclawSessionCount} active session{openclawSessionCount !== 1 ? 's' : ''}</Text>
                  <Text style={styles.connectInfoText}>🤖 {openclawAgents.length} agent{openclawAgents.length !== 1 ? 's' : ''}: {openclawAgents.join(', ') || 'none'}</Text>
                  <Text style={styles.connectInfoText}>🔄 Polling every 10s for live updates</Text>
                </View>
              )}

              {openclawError && (
                <View style={[styles.connectInfo, { borderColor: '#ef444430' }]}>
                  <Text style={[styles.connectInfoTitle, { color: '#ef4444' }]}>Connection Error</Text>
                  <Text style={styles.connectInfoText}>{openclawError}</Text>
                </View>
              )}

              <Text style={styles.inputLabel}>Gateway Endpoint</Text>
              <TextInput
                style={styles.input}
                value={openclawEndpoint}
                onChangeText={onEndpointChange}
                placeholder="http://localhost:18789"
                placeholderTextColor="#333"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>Auth Token</Text>
              <TextInput
                style={styles.input}
                value={openclawKey}
                onChangeText={onKeyChange}
                placeholder="your gateway token"
                placeholderTextColor="#333"
                secureTextEntry
                autoCapitalize="none"
              />

              <View style={styles.tgBtnRow}>
                <Pressable
                  onPress={onConnect}
                  style={[styles.connectBtn, { flex: 1, backgroundColor: '#6366f1' }, openclawConnecting && { opacity: 0.6 }]}
                  disabled={openclawConnecting}
                >
                  <Text style={styles.connectBtnText}>
                    {openclawConnecting ? 'CONNECTING...' : connected ? 'RECONNECT' : '🔗 CONNECT'}
                  </Text>
                </Pressable>
                {connected && (
                  <Pressable onPress={onDisconnect} style={[styles.connectBtn, { backgroundColor: '#ef444430', marginLeft: 8 }]}>
                    <Text style={[styles.connectBtnText, { color: '#ef4444' }]}>DISCONNECT</Text>
                  </Pressable>
                )}
              </View>

              {!connected && (
                <View style={styles.connectInfo}>
                  <Text style={styles.connectInfoTitle}>Quick Setup</Text>
                  <Text style={styles.connectInfoText}>1. Run `openclaw gateway start` on your machine</Text>
                  <Text style={styles.connectInfoText}>2. Find your port (default: 18789) and auth token</Text>
                  <Text style={styles.connectInfoText}>3. If remote, ensure the port is accessible</Text>
                  <Text style={styles.connectInfoText}>4. Paste endpoint + token above and connect</Text>
                </View>
              )}

              <View style={styles.connectInfo}>
                <Text style={styles.connectInfoTitle}>What connects</Text>
                <Text style={styles.connectInfoText}>📡 Live sessions → office agents</Text>
                <Text style={styles.connectInfoText}>💬 Send tasks to agents from the dashboard</Text>
                <Text style={styles.connectInfoText}>📊 Real token usage, costs, and model info</Text>
                <Text style={styles.connectInfoText}>🔍 Web search, cron jobs, and tools</Text>
                <Text style={styles.connectInfoText}>📝 Session history and activity logs</Text>
              </View>

              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>API CAPABILITIES</Text>
              <View style={styles.connectInfo}>
                <Text style={styles.connectInfoText}>✅ /tools/invoke — direct tool calls</Text>
                <Text style={styles.connectInfoText}>✅ sessions_list — live session monitoring</Text>
                <Text style={styles.connectInfoText}>✅ session_status — cost & token tracking</Text>
                <Text style={styles.connectInfoText}>✅ sessions_history — message logs</Text>
                <Text style={styles.connectInfoText}>✅ web_search — research from the office</Text>
                <Text style={styles.connectInfoText}>⚡ /v1/chat/completions — send agent tasks</Text>
                <Text style={styles.connectInfoText}>⚡ cron — scheduled automation</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#00000080',
    zIndex: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  panel: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 16,
    width: '95%',
    maxWidth: 520,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ddd',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff08',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  closeBtnText: { color: '#666', fontSize: 14 },
  // Tabs
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabText: { fontSize: 11, color: '#555', fontFamily: 'monospace', fontWeight: '600' },
  tabTextActive: { color: '#ddd' },
  body: { padding: 16 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#555',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    marginTop: 8,
  },
  // Theme
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  themeCard: {
    width: '47%' as any,
    backgroundColor: '#0a0a10',
    borderWidth: 1.5,
    borderColor: '#1a1a2e',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  themePreview: {
    width: '100%',
    height: 36,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 6,
  },
  themeFloor: { flex: 1 },
  themeWall: { position: 'absolute', top: 0, left: 0, right: 0, height: 14 },
  themeAccent: { position: 'absolute', bottom: 2, left: '30%' as any, width: '40%' as any, height: 3, borderRadius: 1 },
  themeName: {
    fontSize: 9,
    color: '#888',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  themeCheck: {
    position: 'absolute',
    top: 4,
    right: 6,
    fontSize: 10,
    color: '#22c55e',
  },
  // Agent select
  agentScroll: { marginBottom: 8 },
  agentChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    backgroundColor: '#0a0a10',
    marginRight: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  agentChipText: { fontSize: 10, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  // Colors
  colorRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  swatchActive: { borderColor: '#fff', borderWidth: 2 },
  // Options
  optionRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  optionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    backgroundColor: '#0a0a10',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  optionBtnActive: { borderColor: '#6366f1', backgroundColor: '#6366f120' },
  optionText: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  optionTextActive: { color: '#ddd' },
  // Connect
  connectStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: '#0a0a10',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  connectDot: { width: 8, height: 8, borderRadius: 4 },
  connectLabel: { fontSize: 12, color: '#888', fontFamily: 'monospace', fontWeight: '600' },
  inputLabel: {
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
    marginTop: 8,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 8,
    padding: 10,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 4,
  },
  tgBtnRow: { flexDirection: 'row', marginTop: 12 },
  connectBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 0,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  connectInfo: {
    backgroundColor: '#0a0a10',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    marginTop: 8,
    gap: 4,
  },
  connectInfoTitle: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
    fontWeight: '700',
    marginBottom: 4,
  },
  connectInfoText: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
  },
});
