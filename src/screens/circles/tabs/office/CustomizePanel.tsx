import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, Platform, Modal,
} from 'react-native';
import {
  OFFICE_THEMES, OfficeTheme,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS,
  PANTS_COLORS, SHOE_COLORS, EYE_COLORS,
  AgentAppearance, DEFAULT_APPEARANCE,
  EnvironmentType, ENVIRONMENT_OPTIONS,
  THEME_COLOR_PROPERTIES, COLOR_SWATCHES,
} from '../../../../lib/officeConfig';
import { OfficeAgent } from '../../../../lib/officeAgents';
import PixelAgent from './PixelAgent';
import {
  AgentConnection, ProviderType, PROVIDER_META, generateId,
} from '../../../../lib/connectionManager';
import { BudgetConfig } from '../../../../lib/budgetAlerts';
import {
  CustomThemeRecord, saveCustomTheme, deleteCustomTheme,
  CUSTOM_THEME_PREFIX, customThemeToOfficeTheme,
} from '../../../../services/customThemes';

type Tab = 'theme' | 'agents' | 'connections' | 'telegram' | 'budget';

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
  // Budget
  budgetConfig: BudgetConfig;
  onBudgetConfigChange: (config: BudgetConfig) => void;
  // Custom themes
  customThemes?: CustomThemeRecord[];
  onCustomThemesRefresh?: () => void;
  circleId?: string;
}

type AddStep = 'list' | 'pick-provider' | 'form';

export default function CustomizePanel({
  visible, onClose, currentTheme, onThemeChange,
  agents, appearances, onAppearanceChange,
  connections, onAddConnection, onRemoveConnection, onConnectConnection, onDisconnectConnection,
  telegramConfig, onTelegramConfigChange, telegramConnected, telegramBotName,
  telegramChatTitle, onTelegramConnect, onTelegramDisconnect, telegramError, telegramConnecting,
  budgetConfig, onBudgetConfigChange,
  customThemes = [], onCustomThemesRefresh, circleId,
}: Props) {
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
          {(['theme', 'agents', 'connections', 'telegram', 'budget'] as Tab[]).map(t => (
            <Pressable
              key={t}
              onPress={() => { setTab(t); if (t !== 'connections') resetAddForm(); }}
              style={[styles.tab, tab === t && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'theme' ? '🎨' : t === 'agents' ? '🤖' : t === 'connections' ? '🔗' : t === 'telegram' ? '✈️' : '💰'}
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
                    {(['flat', 'spiky', 'mohawk', 'long', 'curly', 'ponytail', 'cap', 'bald'] as const).map(style => (
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
                  <Text style={styles.sectionTitle}>PANTS COLOR</Text>
                  <View style={styles.colorRow}>
                    {PANTS_COLORS.map(color => (
                      <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, pantsColor: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, currentAppearance.pantsColor === color && styles.swatchActive]} />
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>SHOE COLOR</Text>
                  <View style={styles.colorRow}>
                    {SHOE_COLORS.map(color => (
                      <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, shoeColor: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, (currentAppearance.shoeColor || '#1a1a1a') === color && styles.swatchActive]} />
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>ACCESSORY</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana'] as const).map(acc => {
                      const labels: Record<string, string> = { none: 'NONE', glasses: '👓', headphones: '🎧', bowtie: '🎀', scarf: '🧣', hoodie: '🧥', mask: '😷', monocle: '🧐', eyepatch: '🏴‍☠️', bandana: '🥷' };
                      return (
                        <Pressable key={acc} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, accessory: acc })}
                          style={[styles.optionBtn, currentAppearance.accessory === acc && styles.optionBtnActive]}>
                          <Text style={[styles.optionText, currentAppearance.accessory === acc && styles.optionTextActive]}>
                            {labels[acc]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.sectionTitle}>HAT</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', 'space_helmet', 'wizard_hat', 'halo', 'antenna'] as const).map(hat => {
                      const labels: Record<string, string> = { none: 'NONE', cap: '🧢', tophat: '🎩', beanie: '🧶', crown: '👑', helmet: '⛑️', horns: '😈', space_helmet: '🪖 SPACE', wizard_hat: '🧙 WIZARD', halo: '😇 HALO', antenna: '👽 ANTENNA' };
                      return (
                        <Pressable key={hat} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, hat: hat })}
                          style={[styles.optionBtn, currentAppearance.hat === hat && styles.optionBtnActive]}>
                          <Text style={[styles.optionText, currentAppearance.hat === hat && styles.optionTextActive]}>
                            {labels[hat]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.sectionTitle}>EXPRESSION</Text>
                  <View style={styles.optionRow}>
                    {(['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry'] as const).map(expr => (
                      <Pressable key={expr} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, expression: expr })}
                        style={[styles.optionBtn, currentAppearance.expression === expr && styles.optionBtnActive]}>
                        <Text style={[styles.optionText, currentAppearance.expression === expr && styles.optionTextActive]}>{expr.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>BACK ITEM</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver'] as const).map(item => {
                      const labels: Record<string, string> = { none: 'NONE', cape: '🦸 CAPE', backpack: '🎒 PACK', wings: '🪽 WINGS', jetpack: '🚀 JETPACK', shield: '🛡️ SHIELD', sword: '⚔️ SWORD', quiver: '🏹 QUIVER' };
                      return (
                        <Pressable key={item} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, backItem: item })}
                          style={[styles.optionBtn, (currentAppearance.backItem || 'none') === item && styles.optionBtnActive]}>
                          <Text style={[styles.optionText, (currentAppearance.backItem || 'none') === item && styles.optionTextActive]}>
                            {labels[item]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.sectionTitle}>EYE COLOR</Text>
                  <View style={styles.colorRow}>
                    {EYE_COLORS.map(color => (
                      <Pressable key={color} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, eyeColor: color })}
                        style={[styles.colorSwatch, { backgroundColor: color }, (currentAppearance.eyeColor || '#1a1a1a') === color && styles.swatchActive]} />
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>FACIAL HAIR</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'stubble', 'beard', 'mustache', 'goatee'] as const).map(fh => {
                      const labels: Record<string, string> = { none: 'NONE', stubble: '🔘 STUBBLE', beard: '🧔 BEARD', mustache: '👨 STACHE', goatee: '🐐 GOATEE' };
                      return (
                        <Pressable key={fh} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, facialHair: fh })}
                          style={[styles.optionBtn, (currentAppearance.facialHair || 'none') === fh && styles.optionBtnActive]}>
                          <Text style={[styles.optionText, (currentAppearance.facialHair || 'none') === fh && styles.optionTextActive]}>
                            {labels[fh]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.sectionTitle}>PET</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien'] as const).map(pet => {
                      const labels: Record<string, string> = { none: 'NONE', cat: '🐱 CAT', dog: '🐕 DOG', bird: '🐦 BIRD', robot: '🤖 ROBOT', dragon: '🐉 DRAGON', alien: '👽 ALIEN' };
                      return (
                        <Pressable key={pet} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, pet: pet })}
                          style={[styles.optionBtn, (currentAppearance.pet || 'none') === pet && styles.optionBtnActive]}>
                          <Text style={[styles.optionText, (currentAppearance.pet || 'none') === pet && styles.optionTextActive]}>
                            {labels[pet]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.sectionTitle}>AURA</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic'] as const).map(aura => {
                      const labels: Record<string, string> = { none: 'NONE', fire: '🔥 FIRE', ice: '🧊 ICE', electric: '⚡ BOLT', nature: '🌿 LEAF', shadow: '🌑 SHADOW', rainbow: '🌈 RAINBOW', glitch: '📟 GLITCH', cosmic: '✨ COSMIC' };
                      return (
                        <Pressable key={aura} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, aura: aura })}
                          style={[styles.optionBtn, (currentAppearance.aura || 'none') === aura && styles.optionBtnActive]}>
                          <Text style={[styles.optionText, (currentAppearance.aura || 'none') === aura && styles.optionTextActive]}>
                            {labels[aura]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.sectionTitle}>HAND ITEM</Text>
                  <View style={styles.optionRow}>
                    {(['none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand'] as const).map(item => {
                      const labels: Record<string, string> = { none: 'NONE', lightsaber: '⚔️ SABER', coffee: '☕ COFFEE', laptop: '💻 LAPTOP', flag: '🚩 FLAG', wand: '🪄 WAND' };
                      return (
                        <Pressable key={item} onPress={() => onAppearanceChange(selectedAgentId, { ...currentAppearance, handItem: item })}
                          style={[styles.optionBtn, (currentAppearance.handItem || 'none') === item && styles.optionBtnActive]}>
                          <Text style={[styles.optionText, (currentAppearance.handItem || 'none') === item && styles.optionTextActive]}>
                            {labels[item]}
                          </Text>
                        </Pressable>
                      );
                    })}
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
        </ScrollView>
      </View>
    </View>
    </Modal>
  );
}

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
});
