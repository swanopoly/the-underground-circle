import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, Platform, Modal, Linking,
} from 'react-native';
import {
  OFFICE_THEMES, OfficeTheme,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS,
  PANTS_COLORS, SHOE_COLORS, EYE_COLORS,
  AgentAppearance, DEFAULT_APPEARANCE,
  EnvironmentType, ENVIRONMENT_OPTIONS,
  THEME_COLOR_PROPERTIES, COLOR_SWATCHES,
  OWNER_EMAIL, NEON_SKIN_TONES, generateRandomAppearance,
} from '../../../../lib/officeConfig';
import { OfficeAgent } from '../../../../lib/officeAgents';
import PixelAgent from './PixelAgent';
import {
  AgentConnection, ProviderType, PROVIDER_META, generateId,
} from '../../../../lib/connectionManager';
import {
  ProviderKey, LLMProvider, PROVIDER_MODELS, PROVIDER_HELP,
  storeApiKey, deleteApiKey, testApiKey, listApiKeys,
} from '../../../../lib/llmProviders';
import { BudgetConfig } from '../../../../lib/budgetAlerts';
import { IDLE_BEHAVIORS, IdleBehaviorConfig, IdleBehaviorDef } from '../../../../lib/idleBehaviors';
import { supabase } from '../../../../lib/supabase';
import {
  CustomThemeRecord, saveCustomTheme, deleteCustomTheme,
  CUSTOM_THEME_PREFIX, customThemeToOfficeTheme,
} from '../../../../services/customThemes';
import {
  SoulTemplate, SoulCategory, SOUL_CATEGORIES,
  getTemplatesByCategory, detectTemplate,
} from '../../../../lib/soulTemplates';

type Tab = 'theme' | 'agents' | 'connections' | 'api-keys' | 'telegram' | 'budget' | 'idle';

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
  // BYO API Keys
  providerKeys?: ProviderKey[];
  onProviderKeysRefresh?: () => void;
  // Budget
  budgetConfig: BudgetConfig;
  onBudgetConfigChange: (config: BudgetConfig) => void;
  // Idle Behaviors
  idleConfig?: IdleBehaviorConfig;
  onIdleConfigChange?: (config: IdleBehaviorConfig) => void;
  // Custom themes
  customThemes?: CustomThemeRecord[];
  onCustomThemesRefresh?: () => void;
  circleId?: string;
  // Owner gating
  userEmail?: string;
}

type AddStep = 'list' | 'pick-provider' | 'form';

export default function CustomizePanel({
  visible, onClose, currentTheme, onThemeChange,
  agents, appearances, onAppearanceChange,
  connections, onAddConnection, onRemoveConnection, onConnectConnection, onDisconnectConnection,
  telegramConfig, onTelegramConfigChange, telegramConnected, telegramBotName,
  telegramChatTitle, onTelegramConnect, onTelegramDisconnect, telegramError, telegramConnecting,
  providerKeys = [], onProviderKeysRefresh,
  budgetConfig, onBudgetConfigChange,
  idleConfig, onIdleConfigChange,
  customThemes = [], onCustomThemesRefresh, circleId,
  userEmail,
}: Props) {
  const isOwner = userEmail === OWNER_EMAIL;
  const [tab, setTab] = useState<Tab>('theme');
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.name || '');

  // Add connection state
  const [addStep, setAddStep] = useState<AddStep>('list');
  const [newProvider, setNewProvider] = useState<ProviderType>('openclaw');
  const [newName, setNewName] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [newToken, setNewToken] = useState('');
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [visibleTokenIds, setVisibleTokenIds] = useState<Set<string>>(new Set());
  const [showRemoteControl, setShowRemoteControl] = useState(false);

  // API Key management state
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [apiKeyEndpoints, setApiKeyEndpoints] = useState<Record<string, string>>({});
  const [apiKeyTesting, setApiKeyTesting] = useState<Record<string, boolean>>({});
  const [apiKeySaving, setApiKeySaving] = useState<Record<string, boolean>>({});
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // Agent personality state
  const [personalityText, setPersonalityText] = useState('');
  const [personalitySaving, setPersonalitySaving] = useState(false);
  const [personalityStatus, setPersonalityStatus] = useState('');
  const [personalityLoaded, setPersonalityLoaded] = useState(false);
  const [soulCategory, setSoulCategory] = useState<SoulCategory>('role');
  const [showSoulTemplates, setShowSoulTemplates] = useState(true);

  // Load personality when agents tab is selected
  useEffect(() => {
    if (tab !== 'agents' || personalityLoaded || !circleId) return;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('agent_personalities')
        .select('personality')
        .eq('user_id', auth.user.id)
        .eq('circle_id', circleId)
        .maybeSingle();
      if (data?.personality) setPersonalityText(data.personality);
      setPersonalityLoaded(true);
    })();
  }, [tab, personalityLoaded, circleId]);

  const handleSavePersonality = async () => {
    if (!circleId) return;
    setPersonalitySaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setPersonalitySaving(false); return; }
    const { error } = await supabase
      .from('agent_personalities')
      .upsert({
        user_id: auth.user.id,
        circle_id: circleId,
        agent_name: 'default',
        personality: personalityText.trim(),
      }, { onConflict: 'user_id,circle_id,agent_name' });
    setPersonalityStatus(error ? `Error: ${error.message}` : 'Personality saved!');
    setPersonalitySaving(false);
    setTimeout(() => setPersonalityStatus(''), 3000);
  };

  const LLM_PROVIDERS: LLMProvider[] = ['openai', 'anthropic', 'openrouter', 'groq', 'ollama', 'replicate'];

  const hasKeyForProvider = (p: LLMProvider) => providerKeys.some(k => k.provider === p && k.isActive);
  const getKeyForProvider = (p: LLMProvider) => providerKeys.find(k => k.provider === p && k.isActive);

  const handleSaveApiKey = async (provider: LLMProvider) => {
    const key = apiKeyInputs[provider]?.trim();
    if (!key) return;
    setApiKeySaving(prev => ({ ...prev, [provider]: true }));
    setApiKeyStatus(prev => ({ ...prev, [provider]: { ok: false, msg: '' } }));
    const endpoint = apiKeyEndpoints[provider]?.trim() || undefined;
    const result = await storeApiKey(provider, key, 'default', endpoint);
    if (result.error) {
      setApiKeyStatus(prev => ({ ...prev, [provider]: { ok: false, msg: result.error! } }));
    } else {
      setApiKeyStatus(prev => ({ ...prev, [provider]: { ok: true, msg: 'Key saved!' } }));
      setApiKeyInputs(prev => ({ ...prev, [provider]: '' }));
      onProviderKeysRefresh?.();
    }
    setApiKeySaving(prev => ({ ...prev, [provider]: false }));
  };

  const handleTestApiKey = async (provider: LLMProvider) => {
    const key = apiKeyInputs[provider]?.trim();
    if (!key) return;
    setApiKeyTesting(prev => ({ ...prev, [provider]: true }));
    setApiKeyStatus(prev => ({ ...prev, [provider]: { ok: false, msg: '' } }));
    const result = await testApiKey(provider, key);
    setApiKeyStatus(prev => ({
      ...prev,
      [provider]: result.success ? { ok: true, msg: 'Key works!' } : { ok: false, msg: result.error || 'Test failed' },
    }));
    setApiKeyTesting(prev => ({ ...prev, [provider]: false }));
  };

  const handleDeleteApiKey = async (provider: LLMProvider) => {
    const existing = getKeyForProvider(provider);
    if (!existing) return;
    const result = await deleteApiKey(existing.id);
    if (result.error) {
      setApiKeyStatus(prev => ({ ...prev, [provider]: { ok: false, msg: result.error! } }));
    } else {
      setApiKeyStatus(prev => ({ ...prev, [provider]: { ok: true, msg: 'Key deleted' } }));
      onProviderKeysRefresh?.();
    }
  };

  // Custom theme editor state
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState('My Theme');
  const [editorEnv, setEditorEnv] = useState<EnvironmentType>('office');
  const [editorColors, setEditorColors] = useState<Record<string, string>>({});
  const [editorShared, setEditorShared] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);

  const openNewThemeEditor = () => {
    setEditingThemeId(null);
    setEditorName('My Theme');
    setEditorEnv('office');
    setEditorColors({});
    setEditorShared(false);
    setShowThemeEditor(true);
  };

  const openEditThemeEditor = (rec: CustomThemeRecord) => {
    setEditingThemeId(rec.id);
    setEditorName(rec.name);
    setEditorEnv(rec.environment_type);
    setEditorColors(rec.colors as Record<string, string>);
    setEditorShared(rec.is_shared);
    setShowThemeEditor(true);
  };

  const handleSaveCustomTheme = async () => {
    setEditorSaving(true);
    const result = await saveCustomTheme({
      id: editingThemeId || undefined,
      name: editorName,
      environment_type: editorEnv,
      colors: editorColors,
      circle_id: circleId || null,
      is_shared: editorShared,
    });
    setEditorSaving(false);
    if (result) {
      setShowThemeEditor(false);
      onCustomThemesRefresh?.();
      onThemeChange(CUSTOM_THEME_PREFIX + result.id);
    }
  };

  const handleDeleteCustomTheme = async (id: string) => {
    const ok = await deleteCustomTheme(id);
    if (ok) {
      onCustomThemesRefresh?.();
      if (currentTheme === CUSTOM_THEME_PREFIX + id) {
        onThemeChange('underground');
      }
    }
  };

  const getEditorPreviewTheme = (): OfficeTheme => {
    const base = Object.values(OFFICE_THEMES).find(t => t.environmentType === editorEnv) || OFFICE_THEMES.underground;
    return { ...base, id: 'preview', name: editorName, ...editorColors };
  };


  const selectedAgent = agents.find(a => a.name === selectedAgentId);
  const currentAppearance = visible ? (appearances[selectedAgentId] || {
    ...DEFAULT_APPEARANCE,
    shirtColor: selectedAgent?.color || '#6366f1',
    hairColor: selectedAgent?.color || '#1a1a1a',
  }) : DEFAULT_APPEARANCE;

  const connectedCount = connections.filter(c => c.status === 'connected').length;

  const resetAddForm = () => {
    setAddStep('list');
    setNewProvider('openclaw');
    setNewName('');
    setNewEndpoint('');
    setNewToken('');
    setEditingConnectionId(null);
    setShowToken(false);
  };

  const handlePickProvider = (provider: ProviderType) => {
    setNewProvider(provider);
    setNewEndpoint(PROVIDER_META[provider].defaultEndpoint);
    setNewName('');
    setNewToken('');
    setAddStep('form');
  };

  const handleEditConnection = (conn: AgentConnection) => {
    setEditingConnectionId(conn.id);
    setNewProvider(conn.provider);
    setNewName(conn.name);
    setNewEndpoint(conn.endpoint);
    setNewToken(conn.token || '');
    setAddStep('form');
  };

  const handleSaveConnection = () => {
    if (!newName.trim() || !newEndpoint.trim()) return;
    
    if (editingConnectionId) {
      // Edit mode: upsert via onAddConnection (handles replace by ID)
      const oldConn = connections.find(c => c.id === editingConnectionId);
      const conn: AgentConnection = {
        id: editingConnectionId,
        name: newName.trim(),
        provider: newProvider,
        endpoint: newEndpoint.trim(),
        token: newToken.trim(),
        enabled: oldConn?.enabled ?? true,
        status: 'disconnected',
        color: PROVIDER_META[newProvider].color,
      };
      onAddConnection(conn);
    } else {
      // Add mode: create new connection
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
    }
    
    resetAddForm();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => { onClose(); resetAddForm(); }}>
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
          {(['theme', 'agents', 'connections', 'api-keys', 'telegram', 'budget', 'idle'] as Tab[]).map(t => (
            <Pressable
              key={t}
              onPress={() => { setTab(t); if (t !== 'connections') resetAddForm(); }}
              style={[styles.tab, tab === t && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'theme' ? '🎨' : t === 'agents' ? '🤖' : t === 'connections' ? '🔗' : t === 'api-keys' ? '🔑' : t === 'telegram' ? '✈️' : t === 'budget' ? '💰' : '⚙️'}
                {' '}{t === 'connections' ? 'Connect' : t === 'api-keys' ? 'Keys' : t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'connections' && connections.length > 0 ? ` (${connectedCount}/${connections.length})` : ''}
                {t === 'api-keys' && providerKeys.length > 0 ? ` (${providerKeys.filter(k => k.isActive).length})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {/* ─── Theme Tab ─── */}
          {tab === 'theme' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>BUILT-IN THEMES</Text>
              <View style={styles.themeGrid}>
                {Object.values(OFFICE_THEMES).filter(t => t.environmentType !== 'office').map(theme => (
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

              {/* ─── Custom Themes ─── */}
              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>YOUR THEMES</Text>
              {customThemes.length > 0 && (
                <View style={styles.themeGrid}>
                  {customThemes.map(rec => {
                    const resolved = customThemeToOfficeTheme(rec);
                    const isActive = currentTheme === resolved.id;
                    return (
                      <Pressable
                        key={rec.id}
                        onPress={() => onThemeChange(resolved.id)}
                        style={[styles.themeCard, isActive && { borderColor: resolved.accentGlow }]}
                      >
                        <View style={styles.themePreview}>
                          <View style={[styles.themeFloor, { backgroundColor: resolved.floorColor }]} />
                          <View style={[styles.themeWall, { backgroundColor: resolved.wallColor }]} />
                          <View style={[styles.themeAccent, { backgroundColor: resolved.accentGlow }]} />
                        </View>
                        <Text style={[styles.themeName, isActive && { color: resolved.accentGlow }]}>
                          {rec.name}
                        </Text>
                        {isActive && <Text style={styles.themeCheck}>✓</Text>}
                        {rec.is_shared && (
                          <Text style={styles.cteSharedBadge}>SHARED</Text>
                        )}
                        {/* Edit / Delete buttons */}
                        <View style={styles.cteCardActions}>
                          <Pressable onPress={() => openEditThemeEditor(rec)} style={styles.cteSmallBtn}>
                            <Text style={styles.cteSmallBtnText}>Edit</Text>
                          </Pressable>
                          <Pressable onPress={() => handleDeleteCustomTheme(rec.id)} style={[styles.cteSmallBtn, styles.cteDeleteBtn]}>
                            <Text style={[styles.cteSmallBtnText, { color: '#ef4444' }]}>Del</Text>
                          </Pressable>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Create button */}
              {!showThemeEditor && (
                <Pressable onPress={openNewThemeEditor} style={styles.cteCreateBtn}>
                  <Text style={styles.cteCreateBtnText}>+ CREATE CUSTOM THEME</Text>
                </Pressable>
              )}

              {/* ─── Theme Editor ─── */}
              {showThemeEditor && (
                <View style={styles.cteEditor}>
                  <Text style={styles.sectionTitle}>
                    {editingThemeId ? 'EDIT THEME' : 'NEW THEME'}
                  </Text>

                  {/* Theme name */}
                  <Text style={styles.inputLabel}>THEME NAME</Text>
                  <TextInput
                    style={styles.input}
                    value={editorName}
                    onChangeText={setEditorName}
                    placeholder="My Custom Theme"
                    placeholderTextColor="#444"
                  />

                  {/* Environment type picker */}
                  <Text style={[styles.inputLabel, { marginTop: 12 }]}>ENVIRONMENT</Text>
                  <View style={styles.cteEnvRow}>
                    {ENVIRONMENT_OPTIONS.map(opt => (
                      <Pressable
                        key={opt.value}
                        onPress={() => setEditorEnv(opt.value)}
                        style={[styles.cteEnvChip, editorEnv === opt.value && styles.cteEnvChipActive]}
                      >
                        <Text style={styles.cteEnvIcon}>{opt.icon}</Text>
                        <Text style={[styles.cteEnvLabel, editorEnv === opt.value && { color: '#ddd' }]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Color properties grouped by category */}
                  {(['floor', 'walls', 'furniture', 'window'] as const).map(group => (
                    <View key={group} style={{ marginTop: 12 }}>
                      <Text style={styles.sectionTitle}>{group.toUpperCase()} COLORS</Text>
                      {THEME_COLOR_PROPERTIES.filter(p => p.group === group).map(prop => {
                        const preview = getEditorPreviewTheme();
                        const currentVal = (editorColors[prop.key] || preview[prop.key]) as string;
                        const swatches = COLOR_SWATCHES[group] || [];
                        return (
                          <View key={prop.key} style={styles.cteColorRow}>
                            <Text style={styles.cteColorLabel}>{prop.label}</Text>
                            <View style={[styles.cteCurrentColor, { backgroundColor: currentVal }]} />
                            <View style={styles.cteSwatchRow}>
                              {swatches.map((color, i) => (
                                <Pressable
                                  key={i}
                                  onPress={() => setEditorColors(prev => ({ ...prev, [prop.key]: color }))}
                                  style={[
                                    styles.cteSwatch,
                                    { backgroundColor: color },
                                    currentVal === color && styles.cteSwatchActive,
                                  ]}
                                />
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}

                  {/* Mini preview */}
                  <Text style={[styles.inputLabel, { marginTop: 12 }]}>PREVIEW</Text>
                  <View style={styles.cteMiniPreview}>
                    {(() => {
                      const p = getEditorPreviewTheme();
                      return (
                        <>
                          <View style={[styles.cteMiniFloor, { backgroundColor: p.floorColor }]} />
                          <View style={[styles.cteMiniWall, { backgroundColor: p.wallColor, borderBottomColor: p.wallBorder }]} />
                          <View style={[styles.cteMiniWindow, { backgroundColor: p.windowSkyColor, borderColor: p.wallBorder }]}>
                            <View style={{ flex: 1, backgroundColor: p.windowCityColor, position: 'absolute', bottom: 0, left: 0, right: 0, height: 12 }} />
                          </View>
                          <View style={[styles.cteMiniDesk, { backgroundColor: p.deskColor, borderColor: p.deskBorder }]} />
                          <View style={[styles.cteMiniChair, { backgroundColor: p.chairColor, borderColor: p.chairBorder }]} />
                          <View style={[styles.cteMiniRug, { backgroundColor: p.rugColor, borderColor: p.rugBorder }]} />
                          <View style={[styles.cteMiniAccent, { backgroundColor: p.accentGlow }]} />
                        </>
                      );
                    })()}
                  </View>

                  {/* Share toggle */}
                  <View style={[styles.budgetToggle, { marginTop: 12 }]}>
                    <Text style={styles.budgetToggleLabel}>Share with circle</Text>
                    <Pressable
                      onPress={() => setEditorShared(!editorShared)}
                      style={[styles.toggle, editorShared && styles.toggleActive]}
                    >
                      <View style={[styles.toggleKnob, editorShared && styles.toggleKnobActive]} />
                    </Pressable>
                  </View>

                  {/* Save / Cancel */}
                  <View style={styles.cteActionRow}>
                    <Pressable
                      onPress={() => setShowThemeEditor(false)}
                      style={[styles.cteActionBtn, styles.cteCancelBtn]}
                    >
                      <Text style={styles.cteActionBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveCustomTheme}
                      disabled={editorSaving || !editorName.trim()}
                      style={[styles.cteActionBtn, styles.cteSaveBtn, editorSaving && { opacity: 0.5 }]}
                    >
                      <Text style={[styles.cteActionBtnText, { color: '#fff' }]}>
                        {editorSaving ? 'Saving...' : editingThemeId ? 'Update' : 'Save'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Reset theme to default */}
              {currentTheme !== 'underground' && (
                <Pressable
                  onPress={() => onThemeChange('underground')}
                  style={styles.resetBtn}
                >
                  <Text style={styles.resetBtnText}>↺ RESET TO DEFAULT</Text>
                </Pressable>
              )}
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
                    onPress={() => setSelectedAgentId(agent.name)}
                    style={[styles.agentChip, selectedAgentId === agent.name && { borderColor: agent.color, backgroundColor: agent.color + '15' }]}
                  >
                    <Text style={[styles.agentChipText, selectedAgentId === agent.name && { color: agent.color }]}>
                      {agent.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {selectedAgent && (
                <>
                  {/* Live preview */}
                  <View style={styles.previewRow}>
                    <PixelAgent
                      agent={selectedAgent}
                      appearance={currentAppearance}
                      onPress={() => {}}
                      selected={false}
                      scale={1.8}
                    />
                  </View>

                  {/* Reset / Randomize buttons */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                    <Pressable
                      onPress={() => onAppearanceChange(selectedAgentId, { ...DEFAULT_APPEARANCE })}
                      style={[styles.resetBtn, { flex: 1, marginBottom: 0 }]}
                    >
                      <Text style={styles.resetBtnText}>↺ RESET</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onAppearanceChange(selectedAgentId, generateRandomAppearance())}
                      style={[styles.resetBtn, { flex: 1, marginBottom: 0, backgroundColor: '#6366f120', borderColor: '#6366f1' }]}
                    >
                      <Text style={[styles.resetBtnText, { color: '#6366f1' }]}>🎲 RANDOMIZE</Text>
                    </Pressable>
                  </View>

                  {/* ── Scrollable single-row appearance sections ── */}

                  <Text style={styles.itemSectionTitle}>SKIN TONE</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {SKIN_TONES.map(color => {
                      const active = currentAppearance.skinTone === color;
                      const isNeon = NEON_SKIN_TONES.includes(color);
                      return (
                        <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, skinTone: color })}
                          style={[styles.itemSwatch, { backgroundColor: color }, isNeon && { shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0.9 }, active && styles.itemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          {active && <Text style={styles.itemSwatchCheck}>✓</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>HAIR COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {HAIR_COLORS.map(color => {
                      const active = currentAppearance.hairColor === color;
                      return (
                        <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hairColor: color })}
                          style={[styles.itemSwatch, { backgroundColor: color }, active && styles.itemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          {active && <Text style={styles.itemSwatchCheck}>✓</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>HAIR STYLE</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['flat', 'spiky', 'mohawk', 'long', 'curly', 'ponytail', 'cap', 'bald', 'buzzcut', 'afro', 'undercut', 'pigtails'] as const).map(style => {
                      const active = currentAppearance.hairStyle === style;
                      const emojis: Record<string, string> = { flat: '➡️', spiky: '⬆️', mohawk: '🔱', long: '💇', curly: '🌀', ponytail: '🎀', cap: '🧢', bald: '🥚', buzzcut: '✂️', afro: '🟤', undercut: '💈', pigtails: '🎗️' };
                      return (
                        <Pressable key={style} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hairStyle: style })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[style]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{style.toUpperCase()}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>EYE COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {EYE_COLORS.map(color => {
                      const active = (currentAppearance.eyeColor || '#1a1a1a') === color;
                      return (
                        <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, eyeColor: color })}
                          style={[styles.itemSwatch, { backgroundColor: color }, active && styles.itemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          {active && <Text style={styles.itemSwatchCheck}>✓</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>SHIRT COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {SHIRT_COLORS.map(color => {
                      const active = currentAppearance.shirtColor === color;
                      return (
                        <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, shirtColor: color })}
                          style={[styles.itemSwatch, { backgroundColor: color }, active && styles.itemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          {active && <Text style={styles.itemSwatchCheck}>✓</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>PANTS COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {PANTS_COLORS.map(color => {
                      const active = currentAppearance.pantsColor === color;
                      return (
                        <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, pantsColor: color })}
                          style={[styles.itemSwatch, { backgroundColor: color }, active && styles.itemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          {active && <Text style={styles.itemSwatchCheck}>✓</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>SHOE COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {SHOE_COLORS.map(color => {
                      const active = (currentAppearance.shoeColor || '#1a1a1a') === color;
                      return (
                        <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, shoeColor: color })}
                          style={[styles.itemSwatch, { backgroundColor: color }, active && styles.itemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          {active && <Text style={styles.itemSwatchCheck}>✓</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>EXPRESSION</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry', 'surprised', 'smirk', 'crying'] as const).map(expr => {
                      const active = currentAppearance.expression === expr;
                      const emojis: Record<string, string> = { neutral: '😐', happy: '😊', focused: '🤨', sleepy: '😴', cool: '😎', angry: '😠', surprised: '😲', smirk: '😏', crying: '😢' };
                      return (
                        <Pressable key={expr} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, expression: expr })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[expr]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{expr.toUpperCase()}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>HAT</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', ...(isOwner ? ['space_helmet'] as const : []), 'wizard_hat', 'halo', 'antenna', 'crab_helmet', 'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'] as const).map(hat => {
                      const active = currentAppearance.hat === hat;
                      const emojis: Record<string, string> = { none: '🚫', cap: '🧢', tophat: '🎩', beanie: '🧶', crown: '👑', helmet: '⛑️', horns: '😈', space_helmet: '🚀', wizard_hat: '🧙', halo: '😇', antenna: '👽', crab_helmet: '🦀', pirate_hat: '🏴‍☠️', cowboy_hat: '🤠', fez: '🎖️', mohawk_spikes: '🔩' };
                      const names: Record<string, string> = { none: 'NONE', cap: 'CAP', tophat: 'TOP HAT', beanie: 'BEANIE', crown: 'CROWN', helmet: 'HELMET', horns: 'HORNS', space_helmet: 'SPACE', wizard_hat: 'WIZARD', halo: 'HALO', antenna: 'ANTENNA', crab_helmet: 'CRAB', pirate_hat: 'PIRATE', cowboy_hat: 'COWBOY', fez: 'FEZ', mohawk_spikes: 'SPIKES' };
                      return (
                        <Pressable key={hat} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hat })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[hat]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{names[hat]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>ACCESSORY</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing', 'visor_shades', 'gas_mask'] as const).map(acc => {
                      const active = currentAppearance.accessory === acc;
                      const emojis: Record<string, string> = { none: '🚫', glasses: '👓', headphones: '🎧', bowtie: '🎀', scarf: '🧣', hoodie: '🧥', mask: '😷', monocle: '🧐', eyepatch: '🏴‍☠️', bandana: '🥷', chain: '⛓️', piercing: '💎', visor_shades: '🕶️', gas_mask: '☣️' };
                      const names: Record<string, string> = { none: 'NONE', glasses: 'GLASSES', headphones: 'PHONES', bowtie: 'BOWTIE', scarf: 'SCARF', hoodie: 'HOODIE', mask: 'MASK', monocle: 'MONOCLE', eyepatch: 'PATCH', bandana: 'BANDANA', chain: 'CHAIN', piercing: 'PIERCE', visor_shades: 'VISOR', gas_mask: 'GAS MASK' };
                      return (
                        <Pressable key={acc} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, accessory: acc })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[acc]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{names[acc]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>FACIAL HAIR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu', 'sideburns', 'soul_patch'] as const).map(fh => {
                      const active = (currentAppearance.facialHair || 'none') === fh;
                      const emojis: Record<string, string> = { none: '🚫', stubble: '🔘', beard: '🧔', mustache: '👨', goatee: '🐐', fu_manchu: '🐉', sideburns: '🔲', soul_patch: '▪️' };
                      const names: Record<string, string> = { none: 'NONE', stubble: 'STUBBLE', beard: 'BEARD', mustache: 'STACHE', goatee: 'GOATEE', fu_manchu: 'FU MANCHU', sideburns: 'BURNS', soul_patch: 'PATCH' };
                      return (
                        <Pressable key={fh} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, facialHair: fh })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[fh]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{names[fh]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>BACK ITEM</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket', 'scroll', 'boombox'] as const).map(item => {
                      const active = (currentAppearance.backItem || 'none') === item;
                      const emojis: Record<string, string> = { none: '🚫', cape: '🦸', backpack: '🎒', wings: '🪽', jetpack: '🚀', shield: '🛡️', sword: '⚔️', quiver: '🏹', crab_shell: '🦀', tentacles: '🐙', rocket: '🚀', scroll: '📜', boombox: '📻' };
                      const names: Record<string, string> = { none: 'NONE', cape: 'CAPE', backpack: 'PACK', wings: 'WINGS', jetpack: 'JETPACK', shield: 'SHIELD', sword: 'SWORD', quiver: 'QUIVER', crab_shell: 'SHELL', tentacles: 'TENTACLES', rocket: 'ROCKET', scroll: 'SCROLL', boombox: 'BOOMBOX' };
                      return (
                        <Pressable key={item} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, backItem: item })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[item]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{names[item]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>PET</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones'] as const).map(pet => {
                      const active = (currentAppearance.pet || 'none') === pet;
                      const emojis: Record<string, string> = { none: '🚫', cat: '🐱', dog: '🐕', bird: '🐦', robot: '🤖', dragon: '🐉', alien: '👽', crab: '🦀', snake: '🐍', bat: '🦇', skull: '💀', mushroom: '🍄', spider: '🕷️', shark: '🦈', bones: '🦴' };
                      const names: Record<string, string> = { none: 'NONE', cat: 'CAT', dog: 'DOG', bird: 'BIRD', robot: 'ROBOT', dragon: 'DRAGON', alien: 'ALIEN', crab: 'CRAB', snake: 'SNAKE', bat: 'BAT', skull: 'SKULL', mushroom: 'SHROOM', spider: 'SPIDER', shark: 'SHARK', bones: 'BONES' };
                      return (
                        <Pressable key={pet} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, pet })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[pet]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{names[pet]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>AURA</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'] as const).map(aura => {
                      const active = (currentAppearance.aura || 'none') === aura;
                      const emojis: Record<string, string> = { none: '🚫', fire: '🔥', ice: '🧊', electric: '⚡', nature: '🌿', shadow: '🌑', rainbow: '🌈', glitch: '📟', cosmic: '✨', toxic: '☢️', holy: '🕊️', void: '🕳️', galaxy: '🌌' };
                      const names: Record<string, string> = { none: 'NONE', fire: 'FIRE', ice: 'ICE', electric: 'BOLT', nature: 'LEAF', shadow: 'SHADOW', rainbow: 'RAINBOW', glitch: 'GLITCH', cosmic: 'COSMIC', toxic: 'TOXIC', holy: 'HOLY', void: 'VOID', galaxy: 'GALAXY' };
                      const glowColors: Record<string, string> = { fire: '#ff6600', ice: '#00bfff', electric: '#ffff00', nature: '#22c55e', shadow: '#6b21a8', rainbow: '#ff69b4', cosmic: '#c084fc', toxic: '#22c55e', holy: '#ffd700', galaxy: '#818cf8' };
                      return (
                        <Pressable key={aura} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, aura })}
                          style={[styles.itemCard, active && styles.itemCardActive, active && glowColors[aura] && { shadowColor: glowColors[aura], shadowOffset: { width: 0, height: 0 }, shadowRadius: 10, shadowOpacity: 0.8 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[aura]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{names[aura]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.itemSectionTitle}>HAND ITEM</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroll}>
                    {(['none', ...(isOwner ? ['lightsaber'] as const : []), 'coffee', 'laptop', 'flag', 'wand', 'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'] as const).map(item => {
                      const active = (currentAppearance.handItem || 'none') === item;
                      const emojis: Record<string, string> = { none: '🚫', lightsaber: '⚔️', coffee: '☕', laptop: '💻', flag: '🚩', wand: '🪄', crab_claws: '🦞', sword_hand: '🗡️', pizza: '🍕', microphone: '🎤', torch: '🔦' };
                      const names: Record<string, string> = { none: 'NONE', lightsaber: 'SABER', coffee: 'COFFEE', laptop: 'LAPTOP', flag: 'FLAG', wand: 'WAND', crab_claws: 'CLAWS', sword_hand: 'SWORD', pizza: 'PIZZA', microphone: 'MIC', torch: 'TORCH' };
                      return (
                        <Pressable key={item} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, handItem: item })}
                          style={[styles.itemCard, active && styles.itemCardActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.itemEmoji}>{emojis[item]}</Text>
                          <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{names[item]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              )}

              {/* Agent Personality / SOUL.md Editor */}
              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>AGENT SOUL</Text>
              <Text style={styles.connectionHint}>
                Pick a template or write your own. This personality is prepended to the system prompt for all LLM calls.
              </Text>

              {/* Template browser toggle */}
              <Pressable
                onPress={() => setShowSoulTemplates(!showSoulTemplates)}
                style={[styles.soulToggle, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={styles.soulToggleText}>
                  {showSoulTemplates ? '▼' : '▶'} SOUL TEMPLATES
                </Text>
                {(() => {
                  const active = detectTemplate(personalityText);
                  return active ? (
                    <View style={[styles.soulActiveBadge, { borderColor: SOUL_CATEGORIES.find(c => c.key === active.category)?.color + '60' }]}>
                      <Text style={styles.soulActiveBadgeText}>{active.emoji} {active.name}</Text>
                    </View>
                  ) : null;
                })()}
              </Pressable>

              {showSoulTemplates && (
                <View style={styles.soulTemplateSection}>
                  {/* Category tabs */}
                  <View style={styles.soulCategoryRow}>
                    {SOUL_CATEGORIES.map(cat => (
                      <Pressable
                        key={cat.key}
                        onPress={() => setSoulCategory(cat.key)}
                        style={[
                          styles.soulCategoryTab,
                          soulCategory === cat.key && { borderColor: cat.color, backgroundColor: cat.color + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any,
                        ]}
                      >
                        <Text style={[
                          styles.soulCategoryText,
                          soulCategory === cat.key && { color: cat.color },
                        ]}>
                          {cat.icon} {cat.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Template grid */}
                  <View style={styles.soulGrid}>
                    {getTemplatesByCategory(soulCategory).map(tmpl => {
                      const isActive = detectTemplate(personalityText)?.id === tmpl.id;
                      const catColor = SOUL_CATEGORIES.find(c => c.key === tmpl.category)?.color || '#6366f1';
                      return (
                        <Pressable
                          key={tmpl.id}
                          onPress={() => setPersonalityText(tmpl.soulText)}
                          style={[
                            styles.soulCard,
                            isActive && { borderColor: catColor, backgroundColor: catColor + '10' },
                            Platform.OS === 'web' && { cursor: 'pointer' } as any,
                          ]}
                        >
                          <View style={styles.soulCardHeader}>
                            <Text style={styles.soulCardEmoji}>{tmpl.emoji}</Text>
                            <Text style={[styles.soulCardName, isActive && { color: '#eee' }]}>{tmpl.name}</Text>
                            {isActive && <Text style={{ fontSize: 8, color: catColor }}>ACTIVE</Text>}
                          </View>
                          <Text style={styles.soulCardDesc} numberOfLines={2}>{tmpl.description}</Text>
                          <View style={styles.soulTagRow}>
                            {tmpl.tags.slice(0, 3).map(tag => (
                              <View key={tag} style={styles.soulTag}>
                                <Text style={styles.soulTagText}>{tag}</Text>
                              </View>
                            ))}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Editable text area */}
              <TextInput
                style={[styles.input, { minHeight: 120, textAlignVertical: 'top', marginTop: 8 }]}
                value={personalityText}
                onChangeText={setPersonalityText}
                placeholder="Pick a template above or write your own SOUL.md..."
                placeholderTextColor="#555"
                multiline
                numberOfLines={6}
              />
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <Pressable
                  onPress={handleSavePersonality}
                  disabled={personalitySaving}
                  style={[styles.quickConnectBtn, { opacity: personalitySaving ? 0.4 : 1 }]}
                >
                  <Text style={styles.quickConnectText}>{personalitySaving ? 'SAVING...' : 'SAVE SOUL'}</Text>
                </Pressable>
                {personalityText.trim() ? (
                  <Pressable
                    onPress={() => setPersonalityText('')}
                    style={[styles.quickConnectBtn, { backgroundColor: '#ef444420', borderColor: '#ef444440' }]}
                  >
                    <Text style={[styles.quickConnectText, { color: '#ef4444' }]}>CLEAR</Text>
                  </Pressable>
                ) : null}
                {personalityStatus ? (
                  <Text style={{ fontSize: 9, color: personalityStatus.startsWith('Error') ? '#ff5555' : '#22c55e', fontFamily: 'monospace' }}>
                    {personalityStatus}
                  </Text>
                ) : null}
              </View>
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
                            {conn.token ? (
                              <Pressable
                                onPress={() => setVisibleTokenIds(prev => {
                                  const next = new Set(prev);
                                  next.has(conn.id) ? next.delete(conn.id) : next.add(conn.id);
                                  return next;
                                })}
                                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}
                              >
                                <Text style={{ color: '#666', fontSize: 11 }}>
                                  🔑 {visibleTokenIds.has(conn.id) ? conn.token : '••••••••••••'}
                                </Text>
                                <Text style={{ color: '#6366f1', fontSize: 10, marginLeft: 6 }}>
                                  {visibleTokenIds.has(conn.id) ? 'HIDE' : 'SHOW'}
                                </Text>
                              </Pressable>
                            ) : null}
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
                            <View style={{ flex: 1 }}>
                              <Text style={styles.connCardError}>{conn.error}</Text>
                              {conn.error.includes('localhost') || conn.error.includes('CORS') ? (
                                <Text style={{ color: '#f59e0b', fontSize: 10, marginTop: 3 }}>
                                  💡 Try: node openclaw-proxy.js
                                </Text>
                              ) : conn.error.includes('refused') || conn.error.includes('reach') ? (
                                <Text style={{ color: '#f59e0b', fontSize: 10, marginTop: 3 }}>
                                  💡 Try: openclaw gateway start
                                </Text>
                              ) : conn.error.includes('auth') || conn.error.includes('token') ? (
                                <Text style={{ color: '#f59e0b', fontSize: 10, marginTop: 3 }}>
                                  💡 Check token in ~/.openclaw/openclaw.json
                                </Text>
                              ) : null}
                            </View>
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
                              <Text style={[styles.connActionText, { color: meta.color }]}>
                                {conn.status === 'error' ? '↻ RECONNECT' : 'CONNECT'}
                              </Text>
                            </Pressable>
                          )}
                          <Pressable
                            onPress={() => handleEditConnection(conn)}
                            style={[styles.connActionBtn, { backgroundColor: '#3b82f620', borderColor: '#3b82f640' }]}
                          >
                            <Text style={[styles.connActionText, { color: '#3b82f6' }]}>✏️ EDIT</Text>
                          </Pressable>
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
                          <Text style={styles.providerDesc}>{meta.label}</Text>
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
                      {editingConnectionId ? 'EDIT' : 'NEW'} {PROVIDER_META[newProvider].label.toUpperCase()} CONNECTION
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

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.inputLabel}>Auth Token</Text>
                    <Pressable onPress={() => setShowToken(!showToken)}>
                      <Text style={{ color: '#6366f1', fontSize: 12 }}>{showToken ? '🙈 HIDE' : '👁️ SHOW'}</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    style={styles.input}
                    value={newToken}
                    onChangeText={setNewToken}
                    placeholder="your auth token"
                    placeholderTextColor="#666"
                    secureTextEntry={!showToken}
                    autoCapitalize="none"
                  />
                  
                  <View style={styles.securityWarning}>
                    <Text style={styles.securityWarningText}>
                      ⚠️ Tokens are stored locally in your browser. Keep your device secure.
                    </Text>
                  </View>

                  <Pressable
                    onPress={handleSaveConnection}
                    style={[styles.saveConnBtn, { backgroundColor: PROVIDER_META[newProvider].color },
                      (!newName.trim() || !newEndpoint.trim()) && { opacity: 0.4 }]}
                    disabled={!newName.trim() || !newEndpoint.trim()}
                  >
                    <Text style={styles.saveConnBtnText}>
                      {editingConnectionId ? '💾 UPDATE CONNECTION' : '💾 SAVE & CONNECT'}
                    </Text>
                  </Pressable>

                  {editingConnectionId && (
                    <View style={[styles.connectInfo, { borderColor: '#f59e0b30' }]}>
                      <Text style={[styles.connectInfoTitle, { color: '#f59e0b' }]}>⚠️ Editing Connection</Text>
                      <Text style={styles.connectInfoText}>After updating, you'll need to reconnect to apply changes.</Text>
                    </View>
                  )}

                  {newProvider === 'openclaw' && !editingConnectionId && (
                    <View style={styles.connectInfo}>
                      <Text style={styles.connectInfoTitle}>OpenClaw Setup</Text>
                      <Text style={styles.connectInfoText}>1. Your gateway is on port 18789 (use proxy port 18790)</Text>
                      <Text style={styles.connectInfoText}>2. No proxy needed - direct connection works</Text>
                      <Text style={styles.connectInfoText}>3. Find token in ~/.openclaw/openclaw.json</Text>
                      <Text style={styles.connectInfoText}>4. Use http://localhost:18790 as endpoint (CORS proxy)</Text>
                    </View>
                  )}

                  {/* ─── Claude Code Remote Control ─── */}
                  {(newProvider === 'openclaw' || newProvider === 'claude-code') && !editingConnectionId && (
                    <>
                      <Pressable
                        onPress={() => setShowRemoteControl(v => !v)}
                        style={styles.collapsibleHeader}
                      >
                        <Text style={styles.collapsibleHeaderText}>🖥️ Claude Code Remote Control</Text>
                        <Text style={styles.collapsibleChevron}>{showRemoteControl ? '▼' : '▶'}</Text>
                      </Pressable>
                      {showRemoteControl && (
                        <View style={styles.collapsibleBody}>
                          <Text style={styles.connectInfoText}>Start a remote session from your terminal:</Text>
                          <Text style={styles.codeSnippet}>  claude remote-control</Text>
                          <Text style={styles.connectInfoText}>Or from inside an existing session:</Text>
                          <Text style={styles.codeSnippet}>  /remote-control  (or /rc)</Text>
                          <Text style={[styles.connectInfoText, { marginTop: 6 }]}>Your session stays on your machine. Pick it up from:</Text>
                          <Text style={styles.connectInfoText}>• claude.ai/code</Text>
                          <Text style={styles.connectInfoText}>• Claude iOS / Android app</Text>
                          <Text style={styles.connectInfoText}>• Scan the QR code shown in your terminal</Text>
                          <Text style={[styles.connectInfoText, { marginTop: 6, color: '#6366f1' }]}>
                            Enable for all sessions: run /config inside Claude Code → set "Enable Remote Control for all sessions" to true
                          </Text>
                        </View>
                      )}

                      <Text style={[styles.connectInfoText, { color: '#3f3f46', fontSize: 10, marginTop: 4 }]}>
                        💡 Tip: set <Text style={{ fontFamily: 'monospace' }}>CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1</Text> for parallel agent runs
                      </Text>
                    </>
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

              {/* Figma Integration */}
              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>FIGMA</Text>
              <View style={styles.connCard}>
                <View style={styles.connCardHeader}>
                  <Text style={styles.connProviderIcon}>🎨</Text>
                  <View style={styles.connCardInfo}>
                    <Text style={styles.connCardName}>Figma</Text>
                    <Text style={styles.connCardEndpoint}>Connect your Figma account via OAuth</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => {
                    // Start Figma OAuth flow
                    (async () => {
                      const { data: auth } = await supabase.auth.getSession();
                      const token = auth.session?.access_token || '';
                      const url = `${supabase.supabaseUrl}/functions/v1/figma-oauth/authorize?state=${encodeURIComponent(token)}`;
                      Linking.openURL(url);
                    })();
                  }}
                  style={[styles.quickConnectBtn, { alignSelf: 'flex-start' }]}
                >
                  <Text style={styles.quickConnectText}>CONNECT FIGMA</Text>
                </Pressable>
                <View style={styles.connectInfo}>
                  <Text style={styles.connectInfoTitle}>What you get</Text>
                  <Text style={styles.connectInfoText}>🎨 Link Figma files to circle tasks</Text>
                  <Text style={styles.connectInfoText}>🖼️ Auto-render design thumbnails</Text>
                  <Text style={styles.connectInfoText}>🔗 OAuth — no manual API keys needed</Text>
                </View>
              </View>
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

          {/* ─── API Keys Tab ─── */}
          {tab === 'api-keys' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>BYO API KEYS</Text>
              <Text style={styles.connectionHint}>
                Add your own LLM API keys to use any model directly in the Terminal.
                Keys are encrypted and stored securely.
              </Text>

              {LLM_PROVIDERS.map(provider => {
                const meta = PROVIDER_META[provider as keyof typeof PROVIDER_META];
                const help = PROVIDER_HELP[provider];
                const hasKey = hasKeyForProvider(provider);
                const existing = getKeyForProvider(provider);
                const status = apiKeyStatus[provider];
                const isTesting = apiKeyTesting[provider];
                const isSaving = apiKeySaving[provider];
                const models = PROVIDER_MODELS[provider] || [];

                return (
                  <View key={provider} style={styles.connCard}>
                    <View style={styles.connCardHeader}>
                      <Text style={styles.connProviderIcon}>{meta?.icon || '🤖'}</Text>
                      <View style={styles.connCardInfo}>
                        <View style={styles.connCardNameRow}>
                          <Text style={styles.connCardName}>{meta?.label || provider}</Text>
                          {hasKey && (
                            <View style={[styles.autoConnectBadge, { backgroundColor: '#22c55e20', borderColor: '#22c55e40' }]}>
                              <Text style={[styles.autoConnectText, { color: '#22c55e' }]}>KEY STORED</Text>
                            </View>
                          )}
                          {!hasKey && (
                            <View style={[styles.autoConnectBadge, { backgroundColor: '#ff555520', borderColor: '#ff555540' }]}>
                              <Text style={[styles.autoConnectText, { color: '#ff5555' }]}>NO KEY</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.connCardEndpoint}>{help?.hint}</Text>
                      </View>
                    </View>

                    {/* Key input */}
                    {!hasKey && (
                      <>
                        <TextInput
                          style={styles.input}
                          value={apiKeyInputs[provider] || ''}
                          onChangeText={(v) => setApiKeyInputs(prev => ({ ...prev, [provider]: v }))}
                          placeholder={provider === 'ollama' ? 'Not required for Ollama' : `sk-... or your ${meta?.label} API key`}
                          placeholderTextColor="#666"
                          secureTextEntry={provider !== 'ollama'}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {provider === 'ollama' && (
                          <>
                            <Text style={styles.inputLabel}>Ollama Endpoint</Text>
                            <TextInput
                              style={styles.input}
                              value={apiKeyEndpoints[provider] || ''}
                              onChangeText={(v) => setApiKeyEndpoints(prev => ({ ...prev, [provider]: v }))}
                              placeholder="http://localhost:11434"
                              placeholderTextColor="#666"
                              autoCapitalize="none"
                              autoCorrect={false}
                            />
                          </>
                        )}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                          <Pressable
                            onPress={() => handleSaveApiKey(provider)}
                            disabled={isSaving || !apiKeyInputs[provider]?.trim()}
                            style={[styles.quickConnectBtn, { opacity: isSaving || !apiKeyInputs[provider]?.trim() ? 0.4 : 1 }]}
                          >
                            <Text style={styles.quickConnectText}>{isSaving ? 'SAVING...' : 'SAVE KEY'}</Text>
                          </Pressable>
                          {provider !== 'ollama' && (
                            <Pressable
                              onPress={() => handleTestApiKey(provider)}
                              disabled={isTesting || !apiKeyInputs[provider]?.trim()}
                              style={[styles.quickConnectBtn, { opacity: isTesting || !apiKeyInputs[provider]?.trim() ? 0.4 : 1, borderColor: '#22c55e40', backgroundColor: '#22c55e10' }]}
                            >
                              <Text style={[styles.quickConnectText, { color: '#22c55e' }]}>{isTesting ? 'TESTING...' : 'TEST'}</Text>
                            </Pressable>
                          )}
                          <Pressable
                            onPress={() => help?.url && Linking.openURL(help.url)}
                            style={[styles.quickConnectBtn, { borderColor: '#0ea5e940', backgroundColor: '#0ea5e910' }]}
                          >
                            <Text style={[styles.quickConnectText, { color: '#0ea5e9' }]}>GET KEY</Text>
                          </Pressable>
                        </View>
                      </>
                    )}

                    {/* Key stored — show models + delete */}
                    {hasKey && (
                      <>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                          {models.slice(0, 4).map(m => (
                            <View key={m.id} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#6366f115', borderWidth: 1, borderColor: '#6366f130' }}>
                              <Text style={{ fontSize: 9, color: '#8888cc', fontFamily: 'monospace' }}>{m.label}</Text>
                            </View>
                          ))}
                          {models.length > 4 && (
                            <Text style={{ fontSize: 9, color: '#666', fontFamily: 'monospace', alignSelf: 'center' }}>+{models.length - 4} more</Text>
                          )}
                        </View>
                        <Pressable
                          onPress={() => handleDeleteApiKey(provider)}
                          style={[styles.quickConnectBtn, { borderColor: '#ff555540', backgroundColor: '#ff555510', alignSelf: 'flex-start', marginTop: 4 }]}
                        >
                          <Text style={[styles.quickConnectText, { color: '#ff5555' }]}>DELETE KEY</Text>
                        </Pressable>
                      </>
                    )}

                    {/* Status message */}
                    {status?.msg ? (
                      <Text style={{ fontSize: 9, color: status.ok ? '#22c55e' : '#ff5555', fontFamily: 'monospace', marginTop: 2 }}>
                        {status.msg}
                      </Text>
                    ) : null}
                  </View>
                );
              })}

              <View style={styles.connectInfo}>
                <Text style={styles.connectInfoTitle}>How It Works</Text>
                <Text style={styles.connectInfoText}>🔑 Add your own API keys for any supported provider</Text>
                <Text style={styles.connectInfoText}>🤖 Models appear in the Terminal's model selector</Text>
                <Text style={styles.connectInfoText}>🔒 Keys are encrypted at rest — never visible after saving</Text>
                <Text style={styles.connectInfoText}>💰 Usage billed to YOUR API key, not the platform</Text>
              </View>
            </View>
          )}

          {/* ─── Budget Tab ─── */}
          {tab === 'budget' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>BUDGET LIMITS</Text>

              <View style={styles.budgetToggle}>
                <Text style={styles.budgetToggleLabel}>Enable Budget Alerts</Text>
                <Pressable
                  onPress={() => onBudgetConfigChange({ ...budgetConfig, enabled: !budgetConfig.enabled })}
                  style={[styles.toggle, budgetConfig.enabled && styles.toggleActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <View style={[styles.toggleKnob, budgetConfig.enabled && styles.toggleKnobActive]} />
                </Pressable>
              </View>

              {budgetConfig.enabled && (
                <>
                  <Text style={styles.inputLabel}>Daily Budget (USD)</Text>
                  <TextInput
                    style={styles.input}
                    value={budgetConfig.daily?.toString() || ''}
                    onChangeText={(v) => {
                      const num = parseFloat(v) || undefined;
                      onBudgetConfigChange({ ...budgetConfig, daily: num });
                    }}
                    placeholder="50.00"
                    placeholderTextColor="#666"
                    keyboardType="numeric"
                  />

                  <Text style={styles.inputLabel}>Weekly Budget (USD)</Text>
                  <TextInput
                    style={styles.input}
                    value={budgetConfig.weekly?.toString() || ''}
                    onChangeText={(v) => {
                      const num = parseFloat(v) || undefined;
                      onBudgetConfigChange({ ...budgetConfig, weekly: num });
                    }}
                    placeholder="300.00"
                    placeholderTextColor="#666"
                    keyboardType="numeric"
                  />

                  <Text style={styles.inputLabel}>Monthly Budget (USD)</Text>
                  <TextInput
                    style={styles.input}
                    value={budgetConfig.monthly?.toString() || ''}
                    onChangeText={(v) => {
                      const num = parseFloat(v) || undefined;
                      onBudgetConfigChange({ ...budgetConfig, monthly: num });
                    }}
                    placeholder="1000.00"
                    placeholderTextColor="#666"
                    keyboardType="numeric"
                  />
                </>
              )}

              <View style={styles.connectInfo}>
                <Text style={styles.connectInfoTitle}>How It Works</Text>
                <Text style={styles.connectInfoText}>📊 Set spending limits for daily, weekly, or monthly periods</Text>
                <Text style={styles.connectInfoText}>⚠️ Get alerts at 50%, 75%, 90%, and 100% of budget</Text>
                <Text style={styles.connectInfoText}>🚨 Banner appears at top of Office when approaching limits</Text>
                <Text style={styles.connectInfoText}>💡 Helps avoid surprise bills and optimize agent usage</Text>
              </View>
            </View>
          )}

          {/* ─── Idle Behaviors Tab ─── */}
          {tab === 'idle' && idleConfig && onIdleConfigChange && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>IDLE AGENT BEHAVIORS</Text>
              <Text style={[styles.connectInfoText, { marginBottom: 12 }]}>
                Agents do useful work in the background when idle — checking streaks, scanning tasks, curating knowledge.
              </Text>

              {/* Master toggle */}
              <View style={styles.budgetToggle}>
                <Text style={styles.budgetToggleLabel}>Enable Idle Behaviors</Text>
                <Pressable
                  onPress={() => onIdleConfigChange({ ...idleConfig, masterEnabled: !idleConfig.masterEnabled })}
                  style={[styles.toggle, idleConfig.masterEnabled && styles.toggleActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <View style={[styles.toggleKnob, idleConfig.masterEnabled && styles.toggleKnobActive]} />
                </Pressable>
              </View>

              {idleConfig.masterEnabled && (
                <>
                  {/* Tier 1 — Automated */}
                  <Text style={[styles.sectionTitle, { marginTop: 16, color: '#22c55e' }]}>AUTOMATED</Text>
                  <Text style={[styles.connectInfoText, { marginBottom: 8 }]}>No AI cost — pure data checks</Text>
                  {IDLE_BEHAVIORS.filter(b => b.tier === 1).map(b => {
                    const state = idleConfig.behaviors[b.id];
                    if (!state) return null;
                    return (
                      <View key={b.id} style={idleStyles.behaviorRow}>
                        <View style={idleStyles.behaviorInfo}>
                          <Text style={idleStyles.behaviorName}>{b.icon} {b.name}</Text>
                          <Text style={idleStyles.behaviorDesc}>{b.description}</Text>
                          <Text style={idleStyles.behaviorMeta}>
                            Cooldown: {b.defaultCooldownMinutes >= 1440 ? `${Math.round(b.defaultCooldownMinutes / 1440)}d` : b.defaultCooldownMinutes >= 60 ? `${Math.round(b.defaultCooldownMinutes / 60)}h` : `${b.defaultCooldownMinutes}m`}
                            {state.lastRanAt ? ` · Last: ${formatLastRan(state.lastRanAt)}` : ' · Never ran'}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            onIdleConfigChange({
                              ...idleConfig,
                              behaviors: { ...idleConfig.behaviors, [b.id]: { ...state, enabled: !state.enabled } },
                            });
                          }}
                          style={[styles.toggle, state.enabled && styles.toggleActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                        >
                          <View style={[styles.toggleKnob, state.enabled && styles.toggleKnobActive]} />
                        </Pressable>
                      </View>
                    );
                  })}

                  {/* Tier 2 — AI-Powered */}
                  <Text style={[styles.sectionTitle, { marginTop: 20, color: '#6366f1' }]}>AI-POWERED</Text>
                  <Text style={[styles.connectInfoText, { marginBottom: 8 }]}>Uses Claude Haiku — minimal cost per run</Text>
                  {IDLE_BEHAVIORS.filter(b => b.tier === 2).map(b => {
                    const state = idleConfig.behaviors[b.id];
                    if (!state) return null;
                    return (
                      <View key={b.id} style={idleStyles.behaviorRow}>
                        <View style={idleStyles.behaviorInfo}>
                          <Text style={idleStyles.behaviorName}>{b.icon} {b.name}</Text>
                          <Text style={idleStyles.behaviorDesc}>{b.description}</Text>
                          <Text style={idleStyles.behaviorMeta}>
                            Cooldown: {b.defaultCooldownMinutes >= 1440 ? `${Math.round(b.defaultCooldownMinutes / 1440)}d` : `${Math.round(b.defaultCooldownMinutes / 60)}h`}
                            {state.lastRanAt ? ` · Last: ${formatLastRan(state.lastRanAt)}` : ' · Never ran'}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            onIdleConfigChange({
                              ...idleConfig,
                              behaviors: { ...idleConfig.behaviors, [b.id]: { ...state, enabled: !state.enabled } },
                            });
                          }}
                          style={[styles.toggle, state.enabled && styles.toggleActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                        >
                          <View style={[styles.toggleKnob, state.enabled && styles.toggleKnobActive]} />
                        </Pressable>
                      </View>
                    );
                  })}

                  {/* Tier 3 — Owner Only */}
                  {isOwner && (
                    <>
                      <View style={idleStyles.ownerDivider}>
                        <View style={idleStyles.ownerDividerLine} />
                        <Text style={idleStyles.ownerDividerText}>🔒 OWNER ONLY</Text>
                        <View style={idleStyles.ownerDividerLine} />
                      </View>
                      <Text style={[styles.connectInfoText, { marginBottom: 8 }]}>Uses Claude Code bridge or AI analysis — only visible to you</Text>
                      {IDLE_BEHAVIORS.filter(b => b.tier === 3).map(b => {
                        const state = idleConfig.behaviors[b.id];
                        if (!state) return null;
                        return (
                          <View key={b.id} style={idleStyles.behaviorRow}>
                            <View style={idleStyles.behaviorInfo}>
                              <Text style={idleStyles.behaviorName}>{b.icon} {b.name}</Text>
                              <Text style={idleStyles.behaviorDesc}>{b.description}</Text>
                              <Text style={idleStyles.behaviorMeta}>
                                Cooldown: {b.defaultCooldownMinutes >= 1440 ? `${Math.round(b.defaultCooldownMinutes / 1440)}d` : `${Math.round(b.defaultCooldownMinutes / 60)}h`}
                                {state.lastRanAt ? ` · Last: ${formatLastRan(state.lastRanAt)}` : ' · Never ran'}
                                {b.requiresBridge ? ' · Needs bridge' : ''}
                              </Text>
                            </View>
                            <Pressable
                              onPress={() => {
                                onIdleConfigChange({
                                  ...idleConfig,
                                  behaviors: { ...idleConfig.behaviors, [b.id]: { ...state, enabled: !state.enabled } },
                                });
                              }}
                              style={[styles.toggle, state.enabled && styles.toggleActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                            >
                              <View style={[styles.toggleKnob, state.enabled && styles.toggleKnobActive]} />
                            </Pressable>
                          </View>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
    </Modal>
  );
}

function formatLastRan(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const idleStyles = StyleSheet.create({
  behaviorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff08',
  },
  behaviorInfo: { flex: 1, marginRight: 12 },
  behaviorName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ddd',
    fontFamily: 'monospace',
  },
  behaviorDesc: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  behaviorMeta: {
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
    marginTop: 3,
  },
  ownerDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
  },
  ownerDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#f5920040',
  },
  ownerDividerText: {
    fontSize: 10,
    color: '#f59200',
    fontFamily: 'monospace',
    fontWeight: '800',
    marginHorizontal: 8,
  },
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000080', justifyContent: 'center', alignItems: 'center',
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
  body: { flex: 1, padding: 16 },
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

  // Agent preview
  previewRow: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
    marginBottom: 4, backgroundColor: '#0a0a10', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a2e',
  },

  // Item sections — scrollable single-row layout
  itemSectionTitle: {
    fontSize: 11, fontWeight: '900', color: '#888', fontFamily: 'monospace',
    letterSpacing: 1.5, marginTop: 10, marginBottom: 4,
  },
  itemScroll: {
    marginBottom: 2,
  },
  itemSwatch: {
    width: 44, height: 44, borderRadius: 10, borderWidth: 2.5, borderColor: 'transparent',
    marginRight: 8, alignItems: 'center', justifyContent: 'center',
  },
  itemSwatchActive: {
    borderColor: '#fff', borderWidth: 2.5,
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 10px rgba(255,255,255,0.4)' } as any : {}),
  },
  itemSwatchCheck: {
    fontSize: 16, color: '#fff', fontWeight: '900',
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  itemCard: {
    width: 72, height: 72, borderRadius: 12, borderWidth: 1.5,
    borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
    alignItems: 'center', justifyContent: 'center', marginRight: 8, gap: 2,
  },
  itemCardActive: {
    borderColor: '#6366f1', backgroundColor: '#6366f120',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 12px rgba(99,102,241,0.3)' } as any : {}),
  },
  itemEmoji: {
    fontSize: 24,
  },
  itemLabel: {
    fontSize: 8, color: '#666', fontFamily: 'monospace', fontWeight: '700',
    letterSpacing: 0.5, textAlign: 'center',
  },
  itemLabelActive: {
    color: '#ddd',
  },
  // Legacy — kept for compatibility with non-appearance option rows
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
  collapsibleHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6,
    marginTop: 6,
  },
  collapsibleHeaderText: { fontSize: 10, color: '#6366f1', fontFamily: 'monospace', fontWeight: '700', flex: 1 },
  collapsibleChevron: { fontSize: 9, color: '#6366f1', marginLeft: 4 },
  collapsibleBody: {
    backgroundColor: '#12122a', borderRadius: 4, padding: 8, marginTop: 2,
    borderLeftWidth: 2, borderLeftColor: '#6366f1',
  },
  codeSnippet: {
    fontSize: 10, color: '#a5b4fc', fontFamily: 'monospace',
    backgroundColor: '#0d0d1f', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 3,
    marginVertical: 3,
  },
  connectInfo: {
    backgroundColor: '#0a0a10', borderRadius: 8, padding: 12, borderWidth: 1,
    borderColor: '#1a1a2e', marginTop: 8, gap: 4,
  },
  connectInfoTitle: { fontSize: 10, color: '#888', fontFamily: 'monospace', fontWeight: '700', marginBottom: 4 },
  connectInfoText: { fontSize: 10, color: '#555', fontFamily: 'monospace' },
  
  // Security warning
  securityWarning: {
    backgroundColor: '#2a1a1510',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#f59e0b30',
    marginTop: 8,
  },
  securityWarningText: {
    fontSize: 11,
    color: '#f59e0b',
    fontFamily: 'monospace',
    textAlign: 'center',
  },

  // Budget
  budgetToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  budgetToggleLabel: {
    fontSize: 12,
    color: '#ddd',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#333',
    padding: 2,
    justifyContent: 'center',
  },
  toggleActive: {
    backgroundColor: '#22c55e40',
  },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#666',
  },
  toggleKnobActive: {
    backgroundColor: '#22c55e',
    transform: [{ translateX: 20 }],
  },

  // Custom Theme Editor
  cteSharedBadge: {
    position: 'absolute', top: 4, left: 6, fontSize: 7, color: '#22c55e',
    fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5,
  },
  cteCardActions: {
    flexDirection: 'row', gap: 4, marginTop: 4,
  },
  cteSmallBtn: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
    backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#1a1a2e',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cteDeleteBtn: { borderColor: '#ef444430' },
  cteSmallBtnText: {
    fontSize: 8, color: '#888', fontFamily: 'monospace', fontWeight: '700',
  },
  cteCreateBtn: {
    borderWidth: 1, borderColor: '#6366f140', borderStyle: 'dashed' as any,
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    backgroundColor: '#6366f108', marginTop: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cteCreateBtnText: {
    fontSize: 11, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1,
  },
  cteEditor: {
    marginTop: 12, padding: 12, backgroundColor: '#0a0a10',
    borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 10, gap: 4,
  },
  cteEnvRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4,
  },
  cteEnvChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#06060a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cteEnvChipActive: { borderColor: '#6366f1', backgroundColor: '#6366f120' },
  cteEnvIcon: { fontSize: 12 },
  cteEnvLabel: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '700' },
  cteColorRow: {
    marginTop: 6, gap: 4,
  },
  cteColorLabel: {
    fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '700',
  },
  cteCurrentColor: {
    width: 24, height: 12, borderRadius: 3, borderWidth: 1, borderColor: '#333',
  },
  cteSwatchRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4,
  },
  cteSwatch: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cteSwatchActive: { borderColor: '#fff' },
  cteMiniPreview: {
    width: '100%' as any, height: 100, borderRadius: 6, overflow: 'hidden',
    position: 'relative', marginTop: 4, backgroundColor: '#000',
  },
  cteMiniFloor: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  cteMiniWall: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 30,
    borderBottomWidth: 1,
  },
  cteMiniWindow: {
    position: 'absolute', top: 5, right: 20, width: 30, height: 18,
    borderWidth: 1, borderRadius: 1, overflow: 'hidden',
  },
  cteMiniDesk: {
    position: 'absolute', top: 45, left: 20, width: 40, height: 14,
    borderWidth: 1, borderRadius: 1,
  },
  cteMiniChair: {
    position: 'absolute', top: 58, left: 28, width: 16, height: 8,
    borderWidth: 1, borderRadius: 2,
  },
  cteMiniRug: {
    position: 'absolute', bottom: 15, left: '30%' as any, width: '40%' as any, height: 14,
    borderWidth: 1, borderRadius: 1, opacity: 0.5,
  },
  cteMiniAccent: {
    position: 'absolute', bottom: 5, left: '35%' as any, width: '30%' as any, height: 3,
    borderRadius: 1,
  },
  cteActionRow: {
    flexDirection: 'row', gap: 8, marginTop: 12,
  },
  cteActionBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cteCancelBtn: { backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#1a1a2e' },
  cteSaveBtn: { backgroundColor: '#6366f1' },
  cteActionBtnText: {
    fontSize: 12, color: '#888', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1,
  },
  resetBtn: {
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 8, borderWidth: 1, borderColor: '#ef444440',
    backgroundColor: '#ef444410', alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  resetBtnText: {
    fontSize: 11, color: '#ef4444', fontFamily: 'monospace',
    fontWeight: '800', letterSpacing: 1,
  },

  // Soul templates
  soulToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, marginTop: 4,
  },
  soulToggleText: {
    fontSize: 10, fontWeight: '800', color: '#888', fontFamily: 'monospace', letterSpacing: 1,
  },
  soulActiveBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f110',
  },
  soulActiveBadgeText: {
    fontSize: 8, color: '#aaa', fontFamily: 'monospace', fontWeight: '700',
  },
  soulTemplateSection: {
    gap: 8, marginTop: 4,
  },
  soulCategoryRow: {
    flexDirection: 'row', gap: 6,
  },
  soulCategoryTab: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: '#0a0a10',
    alignItems: 'center',
  },
  soulCategoryText: {
    fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '700',
  },
  soulGrid: {
    gap: 6,
  },
  soulCard: {
    backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e',
    borderRadius: 8, padding: 10, gap: 4,
  },
  soulCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  soulCardEmoji: {
    fontSize: 14,
  },
  soulCardName: {
    fontSize: 11, fontWeight: '800', color: '#aaa', fontFamily: 'monospace', flex: 1,
  },
  soulCardDesc: {
    fontSize: 9, color: '#666', fontFamily: 'monospace', lineHeight: 13,
  },
  soulTagRow: {
    flexDirection: 'row', gap: 4, marginTop: 2,
  },
  soulTag: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: '#ffffff08',
  },
  soulTagText: {
    fontSize: 7, color: '#555', fontFamily: 'monospace', fontWeight: '600',
  },
});
