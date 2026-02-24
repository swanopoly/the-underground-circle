import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, Platform,
} from 'react-native';
import {
  OFFICE_THEMES,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS,
  AgentAppearance, DEFAULT_APPEARANCE,
} from '../../../../lib/officeConfig';
import { OfficeAgent } from '../../../../lib/officeAgents';
import {
  AgentConnection, ProviderType, PROVIDER_META, generateId,
} from '../../../../lib/connectionManager';

type Tab = 'theme' | 'agents' | 'connections' | 'telegram';

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
  // Multi-connection management
  connections: AgentConnection[];
  onAddConnection: (conn: AgentConnection) => void;
  onRemoveConnection: (id: string) => void;
  onConnectConnection: (id: string) => void;
  onDisconnectConnection: (id: string) => void;
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

type AddStep = 'list' | 'pick-provider' | 'form';

export default function CustomizePanel({
  visible, onClose, currentTheme, onThemeChange,
  agents, appearances, onAppearanceChange,
  connections, onAddConnection, onRemoveConnection, onConnectConnection, onDisconnectConnection,
  telegramConfig, onTelegramConfigChange, telegramConnected, telegramBotName,
  telegramChatTitle, onTelegramConnect, onTelegramDisconnect, telegramError, telegramConnecting,
}: Props) {
  const [tab, setTab] = useState<Tab>('theme');
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id || '');

  // Add connection state
  const [addStep, setAddStep] = useState<AddStep>('list');
  const [newProvider, setNewProvider] = useState<ProviderType>('openclaw');
  const [newName, setNewName] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [newToken, setNewToken] = useState('');

  if (!visible) return null;

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const currentAppearance = appearances[selectedAgentId] || {
    ...DEFAULT_APPEARANCE,
    shirtColor: selectedAgent?.color || '#6366f1',
    hairColor: selectedAgent?.color || '#1a1a1a',
  };

  const connectedCount = connections.filter(c => c.status === 'connected').length;

  const resetAddForm = () => {
    setAddStep('list');
    setNewProvider('openclaw');
    setNewName('');
    setNewEndpoint('');
    setNewToken('');
  };

  const handlePickProvider = (provider: ProviderType) => {
    setNewProvider(provider);
    setNewEndpoint(PROVIDER_META[provider].defaultEndpoint);
    setNewName('');
    setNewToken('');
    setAddStep('form');
  };

  const handleSaveConnection = () => {
    if (!newName.trim() || !newEndpoint.trim()) return;
    const conn: AgentConnection = {
      id: generateId(),
      name: newName.trim(),
      provider: newProvider,
      endpoint: newEndpoint.trim(),
      token: newToken.trim(),
      enabled: true,
      status: 'disconnected',
      color: PROVIDER_META[newProvider].color,
    };
    onAddConnection(conn);
    resetAddForm();
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>⚙️ CUSTOMIZE OFFICE</Text>
          <Pressable onPress={() => { onClose(); resetAddForm(); }} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {(['theme', 'agents', 'connections', 'telegram'] as Tab[]).map(t => (
            <Pressable
              key={t}
              onPress={() => { setTab(t); if (t !== 'connections') resetAddForm(); }}
              style={[styles.tab, tab === t && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'theme' ? '🎨' : t === 'agents' ? '🤖' : t === 'connections' ? '🔗' : '✈️'}
                {' '}{t === 'connections' ? 'Connect' : t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'connections' && connections.length > 0 ? ` (${connectedCount}/${connections.length})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {/* ─── Theme Tab ─── */}
          {tab === 'theme' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>OFFICE THEME</Text>
              <View style={styles.themeGrid}>
                {Object.values(OFFICE_THEMES).map(theme => (
                  <Pressable
                    key={theme.id}
                    onPress={() => onThemeChange(theme.id)}
                    style={[styles.themeCard, currentTheme === theme.id && { borderColor: theme.accentGlow }]}
                  >
                    <View style={styles.themePreview}>
                      <View style={[styles.themeFloor, { backgroundColor: theme.floorColor }]} />
                      <View style={[styles.themeWall, { backgroundColor: theme.wallColor }]} />
                      <View style={[styles.themeAccent, { backgroundColor: theme.accentGlow }]} />
                    </View>
                    <Text style={[styles.themeName, currentTheme === theme.id && { color: theme.accentGlow }]}>{theme.name}</Text>
                    {currentTheme === theme.id && <Text style={styles.themeCheck}>✓</Text>}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* ─── Agents Tab ─── */}
          {tab === 'agents' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>SELECT AGENT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentScroll}>
                {agents.map(agent => (
                  <Pressable
                    key={agent.id}
                    onPress={() => setSelectedAgentId(agent.id)}
                    style={[styles.agentChip, selectedAgentId === agent.id && { borderColor: agent.color, backgroundColor: agent.color + '15' }]}
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
                      <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, skinTone: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, currentAppearance.skinTone === color && styles.swatchActive]} />
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>HAIR COLOR</Text>
                  <View style={styles.colorRow}>
                    {HAIR_COLORS.map(color => (
                      <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hairColor: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, currentAppearance.hairColor === color && styles.swatchActive]} />
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>HAIR STYLE</Text>
                  <View style={styles.optionRow}>
                    {(['flat', 'spiky', 'mohawk', 'long', 'bald'] as const).map(style => (
                      <Pressable key={style} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hairStyle: style })}
                        style={[styles.optionBtn, currentAppearance.hairStyle === style && styles.optionBtnActive]}>
                        <Text style={[styles.optionText, currentAppearance.hairStyle === style && styles.optionTextActive]}>{style.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>SHIRT COLOR</Text>
                  <View style={styles.colorRow}>
                    {SHIRT_COLORS.map(color => (
                      <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, shirtColor: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, currentAppearance.shirtColor === color && styles.swatchActive]} />
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>ACCESSORY</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'glasses', 'headphones', 'bowtie'] as const).map(acc => (
                      <Pressable key={acc} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, accessory: acc })}
                        style={[styles.optionBtn, currentAppearance.accessory === acc && styles.optionBtnActive]}>
                        <Text style={[styles.optionText, currentAppearance.accessory === acc && styles.optionTextActive]}>
                          {acc === 'none' ? 'NONE' : acc === 'glasses' ? '👓' : acc === 'headphones' ? '🎧' : '🎀'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>HAT</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'cap', 'tophat', 'beanie', 'crown'] as const).map(hat => (
                      <Pressable key={hat} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hat: hat })}
                        style={[styles.optionBtn, currentAppearance.hat === hat && styles.optionBtnActive]}>
                        <Text style={[styles.optionText, currentAppearance.hat === hat && styles.optionTextActive]}>
                          {hat === 'none' ? 'NONE' : hat === 'cap' ? '🧢' : hat === 'tophat' ? '🎩' : hat === 'beanie' ? '🧶' : '👑'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>EXPRESSION</Text>
                  <View style={styles.optionRow}>
                    {(['neutral', 'happy', 'focused', 'sleepy', 'cool'] as const).map(expr => (
                      <Pressable key={expr} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, expression: expr })}
                        style={[styles.optionBtn, currentAppearance.expression === expr && styles.optionBtnActive]}>
                        <Text style={[styles.optionText, currentAppearance.expression === expr && styles.optionTextActive]}>{expr.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* ─── Connections Tab ─── */}
          {tab === 'connections' && (
            <View style={styles.section}>
              {addStep === 'list' && (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>CONNECTIONS</Text>
                    {connections.some(c => c.enabled && c.status !== 'connected' && c.status !== 'connecting') && (
                      <Pressable
                        onPress={() => {
                          const toReconnect = connections.filter(c => c.enabled && c.status !== 'connected' && c.status !== 'connecting');
                          console.log(`🔌 Reconnecting ${toReconnect.length} connection${toReconnect.length !== 1 ? 's' : ''}...`);
                          toReconnect.forEach(c => onConnectConnection(c.id));
                        }}
                        style={styles.quickConnectBtn}
                      >
                        <Text style={styles.quickConnectText}>🔌 RECONNECT ALL</Text>
                      </Pressable>
                    )}
                  </View>

                  {connections.length > 0 && (
                    <Text style={styles.connectionHint}>
                      💡 Connections marked "Auto-Connect" will reconnect when you open the Office
                    </Text>
                  )}

                  {connections.length === 0 && (
                    <View style={styles.connectInfo}>
                      <Text style={styles.connectInfoTitle}>No connections yet</Text>
                      <Text style={styles.connectInfoText}>Add your first connection to see live agents in the office.</Text>
                      <Text style={styles.connectInfoText}>Supports OpenClaw, Claude Code, and generic APIs.</Text>
                    </View>
                  )}

                  {connections.map(conn => {
                    const meta = PROVIDER_META[conn.provider];
                    const statusColor = conn.status === 'connected' ? '#22c55e'
                      : conn.status === 'connecting' ? '#eab308'
                      : conn.status === 'error' ? '#ef4444' : '#6b7280';
                    return (
                      <View key={conn.id} style={[styles.connCard, { borderColor: conn.status === 'connected' ? meta.color + '40' : '#1a1a2e' }]}>
                        <View style={styles.connCardHeader}>
                          <Text style={styles.connProviderIcon}>{meta.icon}</Text>
                          <View style={styles.connCardInfo}>
                            <View style={styles.connCardNameRow}>
                              <Text style={[styles.connCardName, { color: conn.status === 'connected' ? meta.color : '#aaa' }]}>{conn.name}</Text>
                              {conn.enabled && (
                                <View style={styles.autoConnectBadge}>
                                  <Text style={styles.autoConnectText}>AUTO</Text>
                                </View>
                              )}
                              <View style={[styles.statusBadge, {
                                backgroundColor: conn.status === 'connected' ? '#22c55e20'
                                  : conn.status === 'connecting' ? '#eab30820'
                                  : conn.status === 'error' ? '#ef444420' : '#33333320'
                              }]}>
                                <View style={[styles.connStatusDot, { backgroundColor: statusColor }]} />
                                <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                                  {conn.status.toUpperCase()}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.connCardEndpoint} numberOfLines={1}>{conn.endpoint}</Text>
                          </View>
                        </View>

                        {conn.status === 'connected' && (
                          <View style={styles.connCardStats}>
                            <Text style={styles.connCardStat}>📡 {conn.sessionCount ?? 0} sessions</Text>
                            <Text style={styles.connCardStat}>🤖 {conn.agentIds?.length ?? 0} agents</Text>
                          </View>
                        )}

                        {conn.error && (
                          <View style={styles.connCardErrorBox}>
                            <Text style={styles.connCardErrorIcon}>⚠️</Text>
                            <Text style={styles.connCardError}>{conn.error}</Text>
                          </View>
                        )}

                        <View style={styles.connCardActions}>
                          {conn.status === 'connected' ? (
                            <Pressable
                              onPress={() => onDisconnectConnection(conn.id)}
                              style={[styles.connActionBtn, styles.connActionDisconnect]}
                            >
                              <Text style={[styles.connActionText, { color: '#ef4444' }]}>DISCONNECT</Text>
                            </Pressable>
                          ) : conn.status === 'connecting' ? (
                            <View style={[styles.connActionBtn, { opacity: 0.5 }]}>
                              <Text style={styles.connActionText}>CONNECTING...</Text>
                            </View>
                          ) : (
                            <Pressable
                              onPress={() => onConnectConnection(conn.id)}
                              style={[styles.connActionBtn, { backgroundColor: meta.color + '20', borderColor: meta.color + '40' }]}
                            >
                              <Text style={[styles.connActionText, { color: meta.color }]}>CONNECT</Text>
                            </Pressable>
                          )}
                          <Pressable
                            onPress={() => onRemoveConnection(conn.id)}
                            style={[styles.connActionBtn, styles.connActionRemove]}
                          >
                            <Text style={[styles.connActionText, { color: '#666' }]}>✕</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}

                  <Pressable onPress={() => setAddStep('pick-provider')} style={styles.addConnBtn}>
                    <Text style={styles.addConnBtnText}>➕ ADD CONNECTION</Text>
                  </Pressable>

                  {connections.length > 0 && (
                    <View style={styles.connectInfo}>
                      <Text style={styles.connectInfoTitle}>Multi-Connection Dashboard</Text>
                      <Text style={styles.connectInfoText}>📡 All connections feed agents into the office</Text>
                      <Text style={styles.connectInfoText}>🎯 Route tasks to specific connections by name</Text>
                      <Text style={styles.connectInfoText}>📊 Unified cost & token tracking across all</Text>
                      <Text style={styles.connectInfoText}>🔄 Each connection polls independently</Text>
                    </View>
                  )}
                </>
              )}

              {addStep === 'pick-provider' && (
                <>
                  <Pressable onPress={resetAddForm} style={styles.backBtn}>
                    <Text style={styles.backBtnText}>← BACK</Text>
                  </Pressable>
                  <Text style={styles.sectionTitle}>CHOOSE PROVIDER</Text>

                  {(Object.keys(PROVIDER_META) as ProviderType[]).map(provider => {
                    const meta = PROVIDER_META[provider];
                    return (
                      <Pressable
                        key={provider}
                        onPress={() => handlePickProvider(provider)}
                        style={[styles.providerCard, { borderColor: meta.color + '30' }]}
                      >
                        <Text style={styles.providerIcon}>{meta.icon}</Text>
                        <View style={styles.providerInfo}>
                          <Text style={[styles.providerName, { color: meta.color }]}>{meta.label}</Text>
                          <Text style={styles.providerDesc}>{meta.description}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </>
              )}

              {addStep === 'form' && (
                <>
                  <Pressable onPress={() => setAddStep('pick-provider')} style={styles.backBtn}>
                    <Text style={styles.backBtnText}>← BACK</Text>
                  </Pressable>

                  <View style={[styles.formHeader, { borderColor: PROVIDER_META[newProvider].color + '30' }]}>
                    <Text style={styles.formHeaderIcon}>{PROVIDER_META[newProvider].icon}</Text>
                    <Text style={[styles.formHeaderText, { color: PROVIDER_META[newProvider].color }]}>
                      NEW {PROVIDER_META[newProvider].label.toUpperCase()} CONNECTION
                    </Text>
                  </View>

                  <Text style={styles.inputLabel}>Connection Name</Text>
                  <TextInput
                    style={styles.input}
                    value={newName}
                    onChangeText={setNewName}
                    placeholder={`My ${PROVIDER_META[newProvider].label}`}
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                  />

                  <Text style={styles.inputLabel}>Endpoint</Text>
                  <TextInput
                    style={styles.input}
                    value={newEndpoint}
                    onChangeText={setNewEndpoint}
                    placeholder={PROVIDER_META[newProvider].defaultEndpoint}
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.inputLabel}>Auth Token</Text>
                  <TextInput
                    style={styles.input}
                    value={newToken}
                    onChangeText={setNewToken}
                    placeholder="your auth token"
                    placeholderTextColor="#666"
                    secureTextEntry
                    autoCapitalize="none"
                  />

                  <Pressable
                    onPress={handleSaveConnection}
                    style={[styles.saveConnBtn, { backgroundColor: PROVIDER_META[newProvider].color },
                      (!newName.trim() || !newEndpoint.trim()) && { opacity: 0.4 }]}
                    disabled={!newName.trim() || !newEndpoint.trim()}
                  >
                    <Text style={styles.saveConnBtnText}>💾 SAVE & CONNECT</Text>
                  </Pressable>

                  {newProvider === 'openclaw' && (
                    <View style={styles.connectInfo}>
                      <Text style={styles.connectInfoTitle}>OpenClaw Setup</Text>
                      <Text style={styles.connectInfoText}>1. Run CORS proxy: node openclaw-proxy.js</Text>
                      <Text style={styles.connectInfoText}>2. Default port: 18790 (proxy adds CORS headers)</Text>
                      <Text style={styles.connectInfoText}>3. Find token in ~/.openclaw/openclaw.json</Text>
                      <Text style={styles.connectInfoText}>4. Gateway runs on port 18789 internally</Text>
                    </View>
                  )}

                  {newProvider === 'claude-code' && (
                    <View style={styles.connectInfo}>
                      <Text style={styles.connectInfoTitle}>Claude Code Setup</Text>
                      <Text style={styles.connectInfoText}>Enter the HTTP endpoint for your Claude Code instance.</Text>
                      <Text style={styles.connectInfoText}>API integration is coming soon — for now this tracks the connection.</Text>
                    </View>
                  )}

                  {newProvider === 'generic-agent' && (
                    <View style={styles.connectInfo}>
                      <Text style={styles.connectInfoTitle}>Generic Agent</Text>
                      <Text style={styles.connectInfoText}>Any OpenAI-compatible API endpoint.</Text>
                      <Text style={styles.connectInfoText}>Uses the same protocol as OpenClaw's /tools/invoke.</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {/* ─── Telegram Tab ─── */}
          {tab === 'telegram' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TELEGRAM BOT INTEGRATION</Text>

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
                <View style={styles.connectInfo}>
                  <Text style={styles.connectInfoTitle}>Quick Setup (2 minutes)</Text>
                  <Text style={styles.connectInfoText}>1. Open Telegram, search for @BotFather</Text>
                  <Text style={styles.connectInfoText}>2. Send /newbot and follow the prompts</Text>
                  <Text style={styles.connectInfoText}>3. Copy the API token and paste below</Text>
                  <Text style={styles.connectInfoText}>4. Add your bot to a group chat, or use your DM</Text>
                  <Text style={styles.connectInfoText}>5. Get chat ID: forward a msg to @userinfobot</Text>
                </View>
              )}

              <Text style={styles.inputLabel}>Bot Token</Text>
              <TextInput
                style={styles.input}
                value={telegramConfig.botToken}
                onChangeText={(v) => onTelegramConfigChange({ ...telegramConfig, botToken: v })}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>Chat ID</Text>
              <TextInput
                style={styles.input}
                value={telegramConfig.chatId}
                onChangeText={(v) => onTelegramConfigChange({ ...telegramConfig, chatId: v })}
                placeholder="-1001234567890 or your user ID"
                placeholderTextColor="#666"
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
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#00000080', zIndex: 200, justifyContent: 'center', alignItems: 'center',
  },
  panel: {
    backgroundColor: '#0d0d14', borderWidth: 1, borderColor: '#1a1a2e',
    borderRadius: 16, width: '95%', maxWidth: 520, maxHeight: '95%', overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  title: { fontSize: 14, fontWeight: '800', color: '#ddd', fontFamily: 'monospace', letterSpacing: 1 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#ffffff08',
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  closeBtnText: { color: '#666', fontSize: 14 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  tab: {
    flex: 1, paddingVertical: 14, alignItems: 'center', minHeight: 48,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabText: { fontSize: 12, color: '#888', fontFamily: 'monospace', fontWeight: '600' },
  tabTextActive: { color: '#ddd' },
  body: { padding: 16 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 9, fontWeight: '800', color: '#555', fontFamily: 'monospace',
    letterSpacing: 1.5, marginTop: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
  },
  quickConnectBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  quickConnectText: {
    fontSize: 9, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1,
  },
  connectionHint: {
    fontSize: 9, color: '#888', fontFamily: 'monospace', fontStyle: 'italic',
    marginBottom: 12, lineHeight: 14,
  },

  // Theme
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  themeCard: {
    width: '47%' as any, backgroundColor: '#0a0a10', borderWidth: 1.5, borderColor: '#1a1a2e',
    borderRadius: 10, padding: 8, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  themePreview: { width: '100%', height: 36, borderRadius: 4, overflow: 'hidden', position: 'relative', marginBottom: 6 },
  themeFloor: { flex: 1 },
  themeWall: { position: 'absolute', top: 0, left: 0, right: 0, height: 14 },
  themeAccent: { position: 'absolute', bottom: 2, left: '30%' as any, width: '40%' as any, height: 3, borderRadius: 1 },
  themeName: { fontSize: 9, color: '#888', fontFamily: 'monospace', fontWeight: '700' },
  themeCheck: { position: 'absolute', top: 4, right: 6, fontSize: 10, color: '#22c55e' },

  // Agent select
  agentScroll: { marginBottom: 8 },
  agentChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1,
    borderColor: '#1a1a2e', backgroundColor: '#0a0a10', marginRight: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  agentChipText: { fontSize: 10, color: '#666', fontFamily: 'monospace', fontWeight: '600' },

  // Colors & options
  colorRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  colorSwatch: {
    width: 36, height: 36, borderRadius: 8, borderWidth: 2, borderColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  swatchActive: { borderColor: '#fff', borderWidth: 2 },
  optionRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  optionBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
    borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  optionBtnActive: { borderColor: '#6366f1', backgroundColor: '#6366f120' },
  optionText: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  optionTextActive: { color: '#ddd' },

  // Connection cards
  connCard: {
    backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e',
    borderRadius: 10, padding: 12, gap: 8,
  },
  connCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  connProviderIcon: { fontSize: 20 },
  connCardInfo: { flex: 1, gap: 2 },
  connCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connCardName: { fontSize: 12, fontWeight: '800', fontFamily: 'monospace', color: '#aaa' },
  autoConnectBadge: {
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
    backgroundColor: '#22c55e20', borderWidth: 1, borderColor: '#22c55e40',
  },
  autoConnectText: {
    fontSize: 7, color: '#22c55e', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5,
  },
  connCardEndpoint: { fontSize: 9, color: '#555', fontFamily: 'monospace' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 7, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5,
  },
  connStatusDot: { width: 6, height: 6, borderRadius: 3 },
  connCardStats: { flexDirection: 'row', gap: 12, paddingLeft: 30 },
  connCardStat: { fontSize: 9, color: '#666', fontFamily: 'monospace' },
  connCardErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 30, paddingRight: 8, paddingVertical: 6,
    backgroundColor: '#ef444410', borderLeftWidth: 2, borderLeftColor: '#ef4444',
    borderRadius: 4,
  },
  connCardErrorIcon: { fontSize: 12 },
  connCardError: { fontSize: 9, color: '#ef4444', fontFamily: 'monospace', flex: 1 },
  connCardActions: { flexDirection: 'row', gap: 6, paddingLeft: 30 },
  connActionBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1,
    borderColor: '#1a1a2e', backgroundColor: '#0a0a10', minHeight: 40,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  connActionDisconnect: { backgroundColor: '#ef444415', borderColor: '#ef444430' },
  connActionRemove: { backgroundColor: '#ffffff05', borderColor: '#1a1a2e' },
  connActionText: { fontSize: 12, color: '#888', fontFamily: 'monospace', fontWeight: '700' },

  // Add connection
  addConnBtn: {
    borderWidth: 1, borderColor: '#6366f140', borderStyle: 'dashed' as any,
    borderRadius: 10, paddingVertical: 14, alignItems: 'center', backgroundColor: '#6366f108',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addConnBtnText: { fontSize: 11, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 },

  // Provider picker
  backBtn: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 6, backgroundColor: '#ffffff08', marginBottom: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  backBtnText: { fontSize: 10, color: '#888', fontFamily: 'monospace', fontWeight: '700' },
  providerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  providerIcon: { fontSize: 28 },
  providerInfo: { flex: 1, gap: 2 },
  providerName: { fontSize: 13, fontWeight: '800', fontFamily: 'monospace' },
  providerDesc: { fontSize: 9, color: '#666', fontFamily: 'monospace' },

  // Form
  formHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10,
    backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 8,
  },
  formHeaderIcon: { fontSize: 18 },
  formHeaderText: { fontSize: 11, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  inputLabel: {
    fontSize: 9, color: '#555', fontFamily: 'monospace', fontWeight: '700',
    marginTop: 8, letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: '#ddd', fontFamily: 'monospace', fontSize: 14, marginTop: 4, minHeight: 48,
  },
  saveConnBtn: {
    borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  saveConnBtnText: { color: '#fff', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },

  // Shared
  connectStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10,
    backgroundColor: '#0a0a10', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a2e',
  },
  connectDot: { width: 8, height: 8, borderRadius: 4 },
  connectLabel: { fontSize: 12, color: '#888', fontFamily: 'monospace', fontWeight: '600' },
  tgBtnRow: { flexDirection: 'row', marginTop: 12 },
  connectBtn: {
    backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 10, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  connectBtnText: { color: '#fff', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  connectInfo: {
    backgroundColor: '#0a0a10', borderRadius: 8, padding: 12, borderWidth: 1,
    borderColor: '#1a1a2e', marginTop: 8, gap: 4,
  },
  connectInfoTitle: { fontSize: 10, color: '#888', fontFamily: 'monospace', fontWeight: '700', marginBottom: 4 },
  connectInfoText: { fontSize: 10, color: '#555', fontFamily: 'monospace' },
});
