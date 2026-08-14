import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { OfficeFloor, OfficeTheme } from '../../../../lib/officeConfig';
import type { AgentConnection } from '../../../../lib/connectionManager';
import { getAudioState, initAudioManager, subscribe } from '../../../../lib/audioManager';
import {
  buildOfficeAddonCatalogRuntimeByType,
  OFFICE_ROOM_KITS,
  queryOfficeAddonCatalog,
  type OfficeAddonStatus,
} from '../../../../lib/officeAddonExperienceCore';
import { OFFICE_FLOOR_GRID_SIZE } from './officeFloorLayout';

export function OfficeWorkspaceSection({
  viewMode,
  floorLayoutHydrated,
  floors,
  displayAgents,
  currentFloorId,
  editMode,
  currentFloor,
  placingType,
  selectedFurnitureId,
  resolveTheme,
  connections,
  accentColor,
  savingSessionMemoryMode,
  sessionMemoryMode,
  showMcpHub,
  showGitHubFeed,
  showSoundMixer,
  showVault,
  layoutSaveState,
  layoutSaveDetail,
  floorPresets,
  floorPresetsLoading,
  floorPresetSaving,
  floorPresetStatus,
  onRetryLayoutSave,
  onSwitchFloor,
  onRenameFloor,
  onDeleteFloor,
  onAddFloor,
  onToggleEditMode,
  onReconnectAll,
  onShowRewards,
  onShowConnectAgent,
  onShowCustomize,
  onToggleSessionMemoryMode,
  onToggleMcpHub,
  onToggleGitHubFeed,
  onToggleSoundMixer,
  onToggleVault,
  onCancelPlacing,
  onClearFloorFurniture,
  onSaveFloorPreset,
  onApplyFloorPreset,
  onDeleteFloorPreset,
  setPlacingType,
  setActiveCatalogCat,
  catalogScrollRef,
  activeCatalogCat,
  isDesktop,
  selectedFurniture,
  favoriteOfficeAddonTypes,
  recentOfficeAddonTypes,
  catalogPreferencesReady,
  historyAvailability,
  onUndo,
  onRedo,
  onCatalogItemPress,
  onToggleCatalogFavorite,
  onApplyRoomKit,
  onConfigureSelected,
  onDuplicateSelected,
  onRotateSelected,
  onResetSelectedSize,
  onNudgeSelected,
  onResizeSelected,
  onMoveSelectedLayer,
  onDeleteSelected,
  onSelectFurniture,
  styles,
  FURNITURE_CATALOG,
}: any) {
  const [showToolsMenu, setShowToolsMenu] = React.useState(false);
  const [showFloorPresets, setShowFloorPresets] = React.useState(false);
  const [renamingFloorId, setRenamingFloorId] = React.useState<string | null>(null);
  const [renamingFloorName, setRenamingFloorName] = React.useState('');
  const [showRoomKits, setShowRoomKits] = React.useState(false);
  const [compactEditorPanel, setCompactEditorPanel] = React.useState<'catalog' | 'kits' | 'inspector' | null>('catalog');
  const [catalogSearch, setCatalogSearch] = React.useState('');
  const [catalogStatus, setCatalogStatus] = React.useState<'all' | OfficeAddonStatus>('all');
  const [catalogScope, setCatalogScope] = React.useState<'all' | 'favorites' | 'recent' | 'problems'>('all');
  const [floorPresetName, setFloorPresetName] = React.useState('');
  const [soundMuted, setSoundMuted] = React.useState(() => {
    initAudioManager();
    return getAudioState().masterMuted;
  });
  React.useEffect(() => {
    const unsub = subscribe((next) => {
      setSoundMuted(next.masterMuted);
    });
    return unsub;
  }, []);
  React.useEffect(() => {
    if (isDesktop || !editMode || !selectedFurniture?.id) return;
    // A successful compact placement/selection should reveal its controls,
    // while a failed catalog activation leaves the catalog visible.
    setCompactEditorPanel('inspector');
  }, [editMode, isDesktop, selectedFurniture?.id]);
  const menuButtonStyle = React.useCallback(
    ({ hovered, pressed }: any, active?: boolean, disabled?: boolean) => [
      styles.toolbarBtn,
      active && { backgroundColor: accentColor + '18', borderColor: accentColor + '40' },
      disabled && { opacity: 0.55, borderColor: '#2f2f2f', backgroundColor: '#131313' },
      hovered && Platform.OS === 'web' && ({
        backgroundColor: 'rgba(99, 102, 241, 0.12)',
        borderColor: 'rgba(168, 85, 247, 0.65)',
        boxShadow: '0 0 0 1px rgba(99, 102, 241, 0.18), 0 0 18px rgba(168, 85, 247, 0.20), inset 0 0 12px rgba(59, 130, 246, 0.08)',
        transform: 'translateY(-1px)',
      } as any),
      pressed && Platform.OS === 'web' && ({ transform: 'translateY(0px) scale(0.99)' } as any),
      Platform.OS === 'web' && { cursor: 'pointer' } as any,
    ],
    [accentColor, styles.toolbarBtn],
  );
  const renderMenuButton = React.useCallback(({
    icon,
    title,
    description,
    active = false,
    disabled = false,
    iconStyle,
    titleStyle,
    onPress,
    trailing,
  }: {
    icon: string;
    title: string;
    description?: string;
    active?: boolean;
    disabled?: boolean;
    iconStyle?: any;
    titleStyle?: any;
    onPress: () => void;
    trailing?: React.ReactNode;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ disabled, selected: active }}
      style={(state) => [
        ...menuButtonStyle(state, active, disabled),
        {
          minHeight: 44,
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          paddingVertical: 8,
          gap: 8,
        },
      ]}
    >
      <Text style={[styles.toolbarBtnIcon, { marginTop: 1 }, iconStyle]}>{icon}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.toolbarBtnText, titleStyle]}>{title}</Text>
          {trailing}
        </View>
        {description ? (
          <Text
            style={{
              marginTop: 2,
              fontSize: 9,
              lineHeight: 12,
              color: disabled ? '#6b7280' : '#8b95a7',
              fontFamily: 'monospace',
            }}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  ), [menuButtonStyle, styles.toolbarBtnIcon, styles.toolbarBtnText]);
  const EditorBodyContainer: any = isDesktop ? View : ScrollView;
  const editorBodyContainerProps = isDesktop ? {} : {
    testID: 'office-compact-editor-tray',
    style: { maxHeight: 180 },
    contentContainerStyle: { paddingBottom: 8 },
    nestedScrollEnabled: true,
    keyboardShouldPersistTaps: 'handled',
    showsVerticalScrollIndicator: true,
    accessibilityLabel: `${compactEditorPanel || 'collapsed'} editor controls`,
  };
  if (viewMode !== 'office') return null;

  if (!floorLayoutHydrated) {
    return (
      <View
        testID="office-workspace-loading"
        style={[styles.floorBar, { minHeight: 58, justifyContent: 'center', gap: 10, paddingHorizontal: 14 }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Loading and merging the Office layout"
      >
        <ActivityIndicator size="small" color={accentColor} />
        <Text style={{ color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}>
          LOADING OFFICE LAYOUT…
        </Text>
      </View>
    );
  }

  return (
    <>
      <View testID="office-workspace-ready" style={styles.floorBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floorList} style={{ flex: 1 }}>
          {[...floors].sort((a: OfficeFloor, b: OfficeFloor) => a.order - b.order).map((floor: OfficeFloor) => {
            const floorAgentCount = displayAgents.filter((agent: any) => floor.agentIds?.includes(agent.id)).length;
            const isActive = floor.id === currentFloorId;
            return (
              <View key={floor.id} style={styles.floorChipWrap}>
                {renamingFloorId === floor.id ? (
                  <View style={[styles.floorChip, isActive && styles.floorChipActive, { minHeight: 40, paddingVertical: 3 }]}>
                    <TextInput
                      testID={`office-floor-name-input-${floor.id}`}
                      value={renamingFloorName}
                      onChangeText={(value) => setRenamingFloorName(value.slice(0, 80))}
                      onSubmitEditing={() => {
                        if (onRenameFloor(floor.id, renamingFloorName) !== false) setRenamingFloorId(null);
                      }}
                      autoFocus
                      selectTextOnFocus
                      maxLength={80}
                      accessibilityLabel={`New name for ${floor.name}`}
                      style={{ minWidth: 130, color: '#f8fafc', fontFamily: 'monospace', fontSize: 11, paddingHorizontal: 4, paddingVertical: 4 }}
                    />
                    <Pressable
                      onPress={() => {
                        if (onRenameFloor(floor.id, renamingFloorName) !== false) setRenamingFloorId(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Save name for ${floor.name}`}
                      style={{ minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ color: '#86efac', fontWeight: '900' }}>✓</Text>
                    </Pressable>
                    <Pressable onPress={() => setRenamingFloorId(null)} accessibilityRole="button" accessibilityLabel="Cancel floor rename" style={{ minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#94a3b8', fontWeight: '900' }}>×</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    testID={`office-floor-switch-${floor.id}`}
                    onPress={() => onSwitchFloor(floor.id)}
                    onLongPress={() => { setRenamingFloorId(floor.id); setRenamingFloorName(floor.name); }}
                    style={[
                      styles.floorChip,
                      floors.length > 1 && styles.floorChipWithDelete,
                      isActive && styles.floorChipActive,
                      Platform.OS === 'web' && { cursor: 'pointer' } as any,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${floor.name}, ${floor.furniture.length} items, ${floorAgentCount} agents`}
                    accessibilityHint="Activate to open this floor. Long press to rename it."
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.floorChipText, isActive && styles.floorChipTextActive]}>{floor.name}</Text>
                    {floorAgentCount > 0 && (
                      <View style={styles.floorAgentBadge}>
                        <Text style={styles.floorAgentBadgeText}>{floorAgentCount}</Text>
                      </View>
                    )}
                    <View style={[styles.floorThemeDot, { backgroundColor: resolveTheme(floor.themeId).accentGlow }]} />
                  </Pressable>
                )}
                {isActive && renamingFloorId !== floor.id ? (
                  <Pressable
                    testID={`office-floor-rename-${floor.id}`}
                    onPress={() => { setRenamingFloorId(floor.id); setRenamingFloorName(floor.name); }}
                    style={{ minWidth: 36, minHeight: 36, marginLeft: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#334155' }}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename floor ${floor.name}`}
                  >
                    <Text style={{ color: '#94a3b8', fontSize: 12 }}>✎</Text>
                  </Pressable>
                ) : null}
                {floors.length > 1 && renamingFloorId !== floor.id && (
                  <Pressable
                    testID={`office-floor-delete-${floor.id}`}
                    onPress={() => { void onDeleteFloor(floor.id); }}
                    style={[styles.floorDeleteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove floor ${floor.name}`}
                    accessibilityHint="Opens a confirmation before removing the floor"
                  >
                    <Text style={styles.floorDeleteBtnText}>✕</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          <Pressable testID="office-floor-add" onPress={onAddFloor} style={[styles.floorAddBtn, { minHeight: 44, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]} accessibilityRole="button" accessibilityLabel="Add and open a new floor">
            <Text style={styles.floorAddBtnText}>+ FLOOR</Text>
          </Pressable>
          <Pressable
            testID="office-floor-presets-toggle"
            onPress={() => setShowFloorPresets((current) => !current)}
            style={[
              styles.floorAddBtn,
              { minHeight: 44, justifyContent: 'center' },
              showFloorPresets && { borderColor: accentColor + '80', backgroundColor: accentColor + '12' },
              Platform.OS === 'web' && { cursor: 'pointer' } as any,
            ]}
            accessibilityRole="button"
            accessibilityLabel={showFloorPresets ? 'Close floor presets' : 'Open floor presets'}
            accessibilityState={{ expanded: showFloorPresets }}
          >
            <Text style={[styles.floorAddBtnText, showFloorPresets && { color: accentColor }]}>★ PRESETS</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.barActions}>
          <Pressable
            testID="office-layout-save-status"
            onPress={layoutSaveState === 'error' ? onRetryLayoutSave : undefined}
            disabled={layoutSaveState !== 'error'}
            accessibilityRole={layoutSaveState === 'error' ? 'button' : undefined}
            accessibilityLabel={layoutSaveDetail || 'Office layout save status'}
            style={{
              paddingHorizontal: 9,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: layoutSaveState === 'error' ? '#ef444455' : layoutSaveState === 'saved' ? '#22c55e44' : '#38bdf844',
              backgroundColor: layoutSaveState === 'error' ? '#3f0d1233' : layoutSaveState === 'saved' ? '#052e1638' : '#082f4938',
            }}
          >
            <Text style={{
              color: layoutSaveState === 'error' ? '#fca5a5' : layoutSaveState === 'saved' ? '#86efac' : '#7dd3fc',
              fontSize: 9,
              fontWeight: '900',
              fontFamily: 'monospace',
            }}>
              {layoutSaveState === 'saving' ? '☁ SAVING…' : layoutSaveState === 'saved' ? '☁ SAVED' : layoutSaveState === 'error' ? '☁ RETRY SAVE' : '☁ LOADING'}
            </Text>
          </Pressable>
          <View style={{ position: 'relative' }}>
            <Pressable
              onPress={() => setShowToolsMenu((current) => !current)}
              style={[
                styles.toolbarBtn,
                showToolsMenu && { backgroundColor: accentColor + '18', borderColor: accentColor + '40' },
                Platform.OS === 'web' && { cursor: 'pointer' } as any,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Office tools"
              accessibilityState={{ expanded: showToolsMenu }}
            >
              <Text style={styles.toolbarBtnIcon}>☰</Text>
              <Text style={styles.toolbarBtnText}>Office Tools</Text>
              <Text style={[styles.toolbarBtnText, { color: '#9ca3af' }]}>{showToolsMenu ? '▴' : '▾'}</Text>
            </Pressable>

            {showToolsMenu ? (
              <View
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 8,
                  minWidth: 220,
                  padding: 8,
                  gap: 6,
                  backgroundColor: '#111827',
                  borderWidth: 1,
                  borderColor: '#ffffff18',
                  borderRadius: 12,
                  zIndex: 20,
                  ...(Platform.OS === 'web' ? ({ boxShadow: '0 12px 30px rgba(0,0,0,0.28)' } as any) : {}),
                }}
              >
                {connections.some((c: AgentConnection) => c.enabled && c.status !== 'connected' && c.status !== 'connecting') && (
                  renderMenuButton({
                    icon: '🔌',
                    title: 'Reconnect',
                    description: 'Retry enabled agent bridges that are offline or stale.',
                    titleStyle: { color: '#818cf8' },
                    onPress: () => {
                      setShowToolsMenu(false);
                      onReconnectAll();
                    },
                  })
                )}
                {renderMenuButton({
                  icon: editMode ? '✓' : '🪑',
                  title: editMode ? 'Done' : 'Add Items',
                  description: editMode
                    ? 'Exit placement mode and return to the normal office view.'
                    : 'Place furniture, devices, and interactive items on the floor.',
                  active: editMode,
                  titleStyle: editMode ? { color: '#22c55e' } : undefined,
                  onPress: () => {
                    setShowToolsMenu(false);
                    onToggleEditMode();
                  },
                })}
                {renderMenuButton({
                  icon: '🏆',
                  title: 'Achievements',
                  description: 'Open the rewards surface and review circle milestones.',
                  onPress: () => { setShowToolsMenu(false); onShowRewards(); },
                })}
                {renderMenuButton({
                  icon: '☁️',
                  title: 'Connect Agent',
                  description: 'Link Claude Code, Codex, Gemini, Cursor, and other agents to this circle.',
                  onPress: () => { setShowToolsMenu(false); onShowConnectAgent(); },
                })}
                {renderMenuButton({
                  icon: '🔧',
                  title: 'Customize',
                  description: 'Adjust office theme, agent appearance, budgets, idle behavior, and connections.',
                  onPress: () => { setShowToolsMenu(false); onShowCustomize(); },
                })}
                {renderMenuButton({
                  icon: savingSessionMemoryMode ? '…' : '🧠',
                  title: sessionMemoryMode === 'shared' ? 'Memory Shared' : 'Memory Private',
                  description: sessionMemoryMode === 'shared'
                    ? 'New session memory can be reused across the circle.'
                    : 'New session memory stays scoped to your own agent context.',
                  active: sessionMemoryMode === 'shared',
                  disabled: savingSessionMemoryMode,
                  titleStyle: sessionMemoryMode === 'shared' ? styles.toolbarBtnTextActiveMemory : undefined,
                  trailing: savingSessionMemoryMode ? (
                    <ActivityIndicator size="small" color="#22c55e" />
                  ) : null,
                  onPress: () => {
                    setShowToolsMenu(false);
                    onToggleSessionMemoryMode();
                  },
                })}
                {renderMenuButton({
                  icon: '🔌',
                  title: 'MCP',
                  description: 'Register external MCP servers and inspect the tools they expose.',
                  active: showMcpHub,
                  onPress: () => { setShowToolsMenu(false); onToggleMcpHub(); },
                })}
                {renderMenuButton({
                  icon: '{}',
                  title: 'GitHub',
                  description: 'Show the live GitHub activity wall for connected repos and webhooks.',
                  active: showGitHubFeed,
                  onPress: () => { setShowToolsMenu(false); onToggleGitHubFeed(); },
                })}
                {renderMenuButton({
                  icon: 'Vault',
                  title: 'Vault',
                  description: 'Store website credentials for approved agent login and posting workflows.',
                  active: showVault,
                  onPress: () => { setShowToolsMenu(false); onToggleVault(); },
                })}
                {Platform.OS === 'web' && (
                  renderMenuButton({
                    icon: soundMuted ? 'X' : ')))',
                    iconStyle: soundMuted ? { color: '#ef4444' } : undefined,
                    title: 'Sound Mixer',
                    description: soundMuted
                      ? 'Open ambient controls. Site audio is currently muted.'
                      : 'Open ambient volume, scene, and mute controls.',
                    active: showSoundMixer,
                    titleStyle: showSoundMixer ? { color: '#22c55e' } : undefined,
                    onPress: () => {
                      setShowToolsMenu(false);
                      onToggleSoundMixer();
                    },
                  })
                )}
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {floorPresetStatus ? (
        <View
          style={{ marginHorizontal: 12, marginTop: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1220' }}
          accessibilityLiveRegion="polite"
          accessibilityLabel={floorPresetStatus}
          testID="office-workspace-status"
        >
          <Text style={{ color: /failed|unavailable|invalid|cannot|could not|reached|no open|exhausted/i.test(floorPresetStatus) ? '#fca5a5' : '#94a3b8', fontSize: 10 }}>
            {floorPresetStatus}
          </Text>
        </View>
      ) : null}

      {showFloorPresets ? (
        <View style={{
          marginHorizontal: 12,
          marginTop: 8,
          padding: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: accentColor + '45',
          backgroundColor: '#0b1220',
          gap: 10,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '900' }}>COMPLETE FLOOR PRESETS</Text>
              <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>
                Saves this floor’s theme, assigned agents, furniture, connected tools, labels, and interactive state.
              </Text>
            </View>
            <Pressable
              testID="office-floor-presets-close"
              onPress={() => setShowFloorPresets(false)}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              accessibilityRole="button"
              accessibilityLabel="Close floor presets"
            >
              <Text style={{ color: '#94a3b8', fontSize: 16 }}>×</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TextInput
              value={floorPresetName}
              onChangeText={setFloorPresetName}
              placeholder={`Preset for ${currentFloor.name}`}
              placeholderTextColor="#475569"
              maxLength={80}
              accessibilityLabel={`Name for a preset of ${currentFloor.name}`}
              style={{
                flexGrow: 1,
                minWidth: 190,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#334155',
                backgroundColor: '#07101a',
                color: '#e2e8f0',
                paddingHorizontal: 10,
                paddingVertical: 8,
                fontSize: 11,
              }}
            />
            <Pressable
              disabled={floorPresetSaving || !floorPresetName.trim()}
              onPress={() => {
                const name = floorPresetName.trim();
                if (!name) return;
                void Promise.resolve(onSaveFloorPreset(name)).then((saved) => {
                  if (saved !== false) setFloorPresetName('');
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Save ${currentFloor.name} as a floor preset`}
              accessibilityState={{ disabled: floorPresetSaving || !floorPresetName.trim(), busy: floorPresetSaving }}
              style={{
                minHeight: 44,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: accentColor + '88',
                backgroundColor: accentColor + '18',
                opacity: floorPresetSaving || !floorPresetName.trim() ? 0.5 : 1,
              }}
            >
              <Text style={{ color: accentColor, fontSize: 10, fontWeight: '900' }}>
                {floorPresetSaving ? 'SAVING…' : 'SAVE CURRENT FLOOR'}
              </Text>
            </Pressable>
          </View>

          {floorPresetsLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={accentColor} />
              <Text style={{ color: '#94a3b8', fontSize: 10 }}>Loading presets…</Text>
            </View>
          ) : (floorPresets || []).length > 0 ? (
            <View style={{ gap: 7 }}>
              {(floorPresets || []).map((preset: any) => (
                <View key={preset.id} style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: 9,
                  borderRadius: 9,
                  borderWidth: 1,
                  borderColor: '#1e293b',
                  backgroundColor: '#0f172a',
                }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: '#e2e8f0', fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{preset.name}</Text>
                    <Text style={{ color: '#64748b', fontSize: 9, marginTop: 2 }}>
                      {preset.snapshot.floor.furniture.length} items/tools · {preset.snapshot.floor.agentIds.length} agents · {preset.snapshot.floor.themeId}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => { void onApplyFloorPreset(preset.id); }}
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: '#22c55e55', backgroundColor: '#052e1644' }}
                    accessibilityRole="button"
                    accessibilityLabel={`Apply floor preset ${preset.name}`}
                  >
                    <Text style={{ color: '#86efac', fontSize: 9, fontWeight: '900' }}>APPLY</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { void onDeleteFloorPreset(preset.id); }}
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: '#ef444444' }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete floor preset ${preset.name}`}
                  >
                    <Text style={{ color: '#fca5a5', fontSize: 9, fontWeight: '900' }}>DELETE</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {editMode && (
        <View testID="office-editor-open" style={styles.editToolbar}>
          <View style={[styles.editToolbarHeader, !isDesktop && { alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }]}>
            <Text style={styles.editLabel}>
              {placingType
                ? `TAP FLOOR — PLACING: ${placingType.toUpperCase()}`
                : selectedFurnitureId
                  ? isDesktop
                    ? 'ITEM SELECTED — MOVE, RESIZE, ROTATE, DUPLICATE, OR DELETE'
                    : 'ITEM SELECTED — USE THE FLOOR OR INSPECTOR'
                  : isDesktop
                    ? 'CHOOSE AN ITEM, THEN TAP THE FLOOR TO PLACE IT'
                    : 'ADD AN ITEM, THEN EDIT IT ON THE FLOOR'}
            </Text>
            <View style={[styles.editToolbarActions, !isDesktop && { flexWrap: 'wrap' }]}>
              <Pressable
                onPress={onUndo}
                disabled={!historyAvailability?.canUndo}
                style={[styles.editActionBtn, { minHeight: 36, opacity: historyAvailability?.canUndo ? 1 : 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel={historyAvailability?.undoLabel ? `Undo ${historyAvailability.undoLabel}` : 'Undo'}
                accessibilityState={{ disabled: !historyAvailability?.canUndo }}
              >
                <Text style={[styles.editActionBtnText, { color: '#c4b5fd' }]}>↶ UNDO</Text>
              </Pressable>
              <Pressable
                onPress={onRedo}
                disabled={!historyAvailability?.canRedo}
                style={[styles.editActionBtn, { minHeight: 36, opacity: historyAvailability?.canRedo ? 1 : 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel={historyAvailability?.redoLabel ? `Redo ${historyAvailability.redoLabel}` : 'Redo'}
                accessibilityState={{ disabled: !historyAvailability?.canRedo }}
              >
                <Text style={[styles.editActionBtnText, { color: '#c4b5fd' }]}>↷ REDO</Text>
              </Pressable>
              {placingType && (
                <Pressable onPress={onCancelPlacing} style={[styles.editActionBtn, { borderColor: '#ffffff25', minHeight: 36 }]}>
                  <Text style={[styles.editActionBtnText, { color: '#9e9e9e' }]}>CANCEL</Text>
                </Pressable>
              )}
              {currentFloor.furniture.length > 0 && (
                <Pressable
                  onPress={() => { void onClearFloorFurniture(); }}
                  style={[styles.editActionBtn, { borderColor: '#ef444455', minHeight: 36 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear all ${currentFloor.furniture.length} items from ${currentFloor.name}`}
                  accessibilityHint="Opens a confirmation before removing every item"
                >
                  <Text style={[styles.editActionBtnText, { color: '#9e9e9e' }]}>CLEAR ALL</Text>
                </Pressable>
              )}
            </View>
          </View>

          {!isDesktop ? (
            <View
              testID="office-compact-editor-panels"
              style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}
              accessibilityRole="tablist"
            >
              {([
                ['catalog', '＋ CATALOG', false],
                ['kits', '▦ KITS', false],
                ['inspector', `⌖ ITEMS ${currentFloor.furniture.length}`, currentFloor.furniture.length === 0],
              ] as const).map(([panel, label, disabled]) => (
                <Pressable
                  key={panel}
                  testID={`office-compact-editor-panel-${panel}`}
                  onPress={() => setCompactEditorPanel((current) => current === panel ? null : panel)}
                  disabled={disabled}
                  style={[
                    styles.editActionBtn,
                    {
                      flex: 1,
                      minHeight: 40,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: disabled ? 0.4 : 1,
                      borderColor: compactEditorPanel === panel ? '#8b5cf6aa' : '#334155',
                      backgroundColor: compactEditorPanel === panel ? '#4c1d9533' : '#020617',
                    },
                  ]}
                  accessibilityRole="tab"
                  accessibilityLabel={`Show Office ${panel}`}
                  accessibilityState={{ selected: compactEditorPanel === panel, disabled, expanded: compactEditorPanel === panel }}
                >
                  <Text style={[styles.editActionBtnText, { color: compactEditorPanel === panel ? '#ddd6fe' : '#94a3b8' }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {(isDesktop || compactEditorPanel) ? <EditorBodyContainer {...editorBodyContainerProps}>

          {(isDesktop || compactEditorPanel === 'kits') ? (
            <View style={{ marginBottom: 8 }}>
              {isDesktop ? (
                <Pressable
                  testID="office-room-kits-toggle"
                  onPress={() => setShowRoomKits((visible) => !visible)}
                  style={[styles.editActionBtn, { minHeight: 40, borderColor: '#8b5cf666', alignSelf: 'flex-start', justifyContent: 'center' }]}
                  accessibilityRole="button"
                  accessibilityLabel={showRoomKits ? 'Hide room kits' : 'Show room kits'}
                  accessibilityState={{ expanded: showRoomKits }}
                >
                  <Text style={[styles.editActionBtnText, { color: '#c4b5fd' }]}>▦ ROOM KITS</Text>
                </Pressable>
              ) : null}
              {(!isDesktop || showRoomKits) ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8, paddingRight: 12 }}>
                {OFFICE_ROOM_KITS.map((kit) => (
                  <Pressable
                    key={kit.id}
                    testID={`office-room-kit-${kit.id}`}
                    onPress={() => onApplyRoomKit(kit.id)}
                    style={[styles.editItem, { width: 150, minHeight: 90, alignItems: 'flex-start', paddingHorizontal: 10 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${kit.name} room kit`}
                    accessibilityHint={`${kit.description} Adds ${kit.items.length} items as one undoable edit.`}
                  >
                    <Text style={[styles.editItemName, { color: '#e2e8f0', textAlign: 'left' }]}>{kit.name.toUpperCase()}</Text>
                    <Text style={[styles.editItemDesc, { maxWidth: 132, textAlign: 'left', color: '#94a3b8' }]} numberOfLines={3}>{kit.description}</Text>
                    <Text style={{ color: '#a78bfa', fontSize: 8, fontFamily: 'monospace', fontWeight: '800' }}>{kit.items.length} ITEMS · UNDOABLE</Text>
                  </Pressable>
                ))}
              </ScrollView>
              ) : null}
            </View>
          ) : null}

          {(isDesktop || compactEditorPanel === 'catalog') && (!catalogPreferencesReady ? (
            <View
              testID="office-catalog-preferences-loading"
              style={{ minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#334155', borderRadius: 10 }}
              accessibilityLiveRegion="polite"
              accessibilityLabel="Loading your Office item favorites and recent items"
            >
              <ActivityIndicator size="small" color={accentColor} />
              <Text style={{ color: '#94a3b8', fontSize: 9, fontFamily: 'monospace' }}>LOADING YOUR ITEM CATALOG…</Text>
            </View>
          ) : (() => {
            const allCats = (['all', 'games', 'connected', 'vibe', 'productivity', 'fun', 'furniture'] as const).filter(
              cat => cat === 'all' || FURNITURE_CATALOG.some((f: any) => f.category === cat),
            );
            const catColors: Record<string, string> = {
              all: '#a78bfa',
              games: '#ef4444', connected: '#22c55e', vibe: '#a855f7', productivity: '#3b82f6',
              fun: '#f59e0b', furniture: '#6f6f6f',
            };
            const catIcons: Record<string, string> = {
              all: '⌕',
              games: '🃏', connected: '🔗', vibe: '✨', productivity: '📊',
              fun: '🎮', furniture: '🪑',
            };
            const cat = activeCatalogCat || 'all';
            const runtimeByType = buildOfficeAddonCatalogRuntimeByType(currentFloor.furniture, {
              nowMs: Date.now(),
              staleAfterMs: 15 * 60 * 1000,
            });
            const queriedItems = queryOfficeAddonCatalog(FURNITURE_CATALOG, {
              searchText: catalogSearch,
              categories: cat === 'all' ? [] : [cat],
              statuses: catalogScope === 'problems'
                ? ['setup_required', 'stale', 'error']
                : catalogStatus === 'all' ? [] : [catalogStatus],
              favoriteTypes: favoriteOfficeAddonTypes,
              recentTypes: recentOfficeAddonTypes,
              onlyFavorites: catalogScope === 'favorites',
              runtimeByType,
            });
            const items = catalogScope === 'recent'
              ? queriedItems.filter((item) => item.recentRank !== null)
              : queriedItems;
            const color = catColors[cat] || '#888';
            const statusLabels: Record<OfficeAddonStatus, string> = {
              decorative: 'DECOR', local: 'LOCAL', demo: 'DEMO', setup_required: 'SETUP',
              connecting: 'CONNECTING', ready: 'READY', stale: 'STALE', error: 'ERROR',
            };
            const statusColors: Record<OfficeAddonStatus, string> = {
              decorative: '#64748b', local: '#38bdf8', demo: '#f59e0b', setup_required: '#60a5fa',
              connecting: '#a78bfa', ready: '#22c55e', stale: '#f97316', error: '#ef4444',
            };
            const statusOptions: Array<{ value: 'all' | OfficeAddonStatus; label: string }> = [
              { value: 'all', label: 'ALL' }, { value: 'ready', label: 'READY' },
              { value: 'setup_required', label: 'SETUP' }, { value: 'demo', label: 'DEMO' },
              { value: 'local', label: 'LOCAL' },
            ];
            const catalogScopes: Array<{ value: typeof catalogScope; label: string; accessibilityLabel: string }> = [
              { value: 'all', label: 'ALL ITEMS', accessibilityLabel: 'Show all Office items' },
              { value: 'favorites', label: `★ FAVORITES ${favoriteOfficeAddonTypes.length || ''}`.trim(), accessibilityLabel: `Show ${favoriteOfficeAddonTypes.length} favorite Office items` },
              { value: 'recent', label: `↻ RECENT ${recentOfficeAddonTypes.length || ''}`.trim(), accessibilityLabel: `Show ${recentOfficeAddonTypes.length} recently used Office items` },
              { value: 'problems', label: '⚠ NEEDS ATTENTION', accessibilityLabel: 'Show Office items needing setup, refresh, or repair' },
            ];
            return (
              <View testID="office-catalog-ready" style={styles.editCatalogWrap}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <TextInput
                    value={catalogSearch}
                    onChangeText={(value) => {
                      setCatalogSearch(value);
                      // Search is global: do not silently inherit the last
                      // category tab (Office opens on Connected by default).
                      if (value.trim()) setActiveCatalogCat('all');
                    }}
                    placeholder={`Search ${FURNITURE_CATALOG.length} Office items…`}
                    placeholderTextColor="#64748b"
                    style={{ flexGrow: 1, minWidth: 220, minHeight: 42, borderWidth: 1, borderColor: '#334155', borderRadius: 9, color: '#f8fafc', backgroundColor: '#020617', paddingHorizontal: 12, fontFamily: 'monospace', fontSize: 11 }}
                    accessibilityLabel="Search Office items"
                  />
                  <Text style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 9 }}>{items.length} MATCH{items.length === 1 ? '' : 'ES'}</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
                  {catalogScopes.map((option) => (
                    <Pressable
                      key={option.value}
                      testID={`office-catalog-scope-${option.value}`}
                      onPress={() => {
                        setCatalogScope(option.value);
                        if (option.value === 'problems') setCatalogStatus('all');
                      }}
                      style={[
                        styles.editCatTab,
                        { minHeight: 36 },
                        catalogScope === option.value && { borderColor: '#f59e0b88', backgroundColor: '#78350f33' },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={option.accessibilityLabel}
                      accessibilityState={{ selected: catalogScope === option.value }}
                      {...(Platform.OS === 'web' ? ({ 'aria-pressed': catalogScope === option.value } as any) : {})}
                    >
                      <Text style={[styles.editCatTabText, { color: catalogScope === option.value ? '#fde68a' : '#64748b' }]}>{option.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
                  {statusOptions.map((option) => (
                    <Pressable
                      key={option.value}
                      onPress={() => { setCatalogStatus(option.value); setCatalogScope('all'); }}
                      style={[styles.editCatTab, catalogStatus === option.value && { borderColor: '#a78bfa88', backgroundColor: '#4c1d9533', minHeight: 34 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${option.label.toLowerCase()} Office items`}
                      accessibilityState={{ selected: catalogStatus === option.value }}
                    >
                      <Text style={[styles.editCatTabText, { color: catalogStatus === option.value ? '#ddd6fe' : '#64748b' }]}>{option.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editCatTabs}>
                  {allCats.map(catKey => {
                    const count = catKey === 'all' ? FURNITURE_CATALOG.length : FURNITURE_CATALOG.filter((f: any) => f.category === catKey).length;
                    return (
                      <Pressable
                        key={catKey}
                        onPress={() => { setActiveCatalogCat(catKey as any); catalogScrollRef.current?.scrollTo?.({ x: 0, animated: false }); }}
                        style={[
                          styles.editCatTab,
                          activeCatalogCat === catKey && { borderColor: catColors[catKey] + '80', backgroundColor: catColors[catKey] + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${catKey === 'all' ? 'all' : catKey} Office items, ${count} available`}
                        accessibilityState={{ selected: activeCatalogCat === catKey }}
                      >
                        <Text style={{ fontSize: 10 }}>{catIcons[catKey]}</Text>
                        <Text style={[styles.editCatTabText, { color: activeCatalogCat === catKey ? catColors[catKey] : '#666' }]}>{catKey.toUpperCase()}</Text>
                        <Text style={[styles.editCatTabCount, { color: catColors[catKey] + '80' }]}>{count}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View style={styles.editCatRowWrap}>
                  {items.length > 3 && (
                    <Pressable onPress={() => catalogScrollRef.current?.scrollTo?.({ x: 0, animated: true })} style={[styles.editScrollArrow, styles.editScrollArrowLeft, { borderColor: color + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]} accessibilityRole="button" accessibilityLabel="Scroll Office items to the beginning">
                      <Text style={[styles.editScrollArrowText, { color }]}>‹</Text>
                    </Pressable>
                  )}

                  <ScrollView ref={catalogScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editItems} style={{ flex: 1 }}>
                    {items.map((viewItem) => {
                      const item = viewItem.entry;
                      const isActive = placingType === item.type;
                      return (
                        <View key={item.type} style={{ width: 88, height: 88, position: 'relative' }}>
                          <Pressable
                            testID={`office-catalog-item-${item.type}`}
                            onPress={() => {
                              setActiveCatalogCat(cat as any);
                              onCatalogItemPress(item.type);
                            }}
                            style={[
                              styles.editItem,
                              isActive && styles.editItemActive,
                              isActive && { borderColor: color + '80', shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0.5 },
                              Platform.OS === 'web' && { cursor: 'pointer' } as any,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`${isDesktop ? 'Select' : 'Place'} ${item.name}. ${statusLabels[viewItem.status]}.`}
                            accessibilityState={{ selected: isActive }}
                            {...(Platform.OS === 'web' ? ({ 'aria-pressed': isActive } as any) : {})}
                          >
                            <Text style={styles.editItemIcon}>{item.icon}</Text>
                            <Text style={[styles.editItemName, isActive && { color: '#eee' }]}>{item.name}</Text>
                            {item.description ? <Text style={styles.editItemDesc} numberOfLines={2}>{item.description}</Text> : null}
                            <View style={{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: statusColors[viewItem.status] + '22', borderWidth: 1, borderColor: statusColors[viewItem.status] + '66' }}>
                              <Text style={{ color: statusColors[viewItem.status], fontSize: 6, lineHeight: 8, fontFamily: 'monospace', fontWeight: '900' }}>{statusLabels[viewItem.status]}</Text>
                            </View>
                          </Pressable>
                          <Pressable
                            testID={`office-catalog-favorite-${item.type}`}
                            onPress={(event) => {
                              event.stopPropagation?.();
                              onToggleCatalogFavorite(item.type);
                            }}
                            style={{ position: 'absolute', top: 2, right: 2, width: 30, height: 30, zIndex: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: viewItem.favorite ? '#f59e0b33' : '#020617cc', borderWidth: 1, borderColor: viewItem.favorite ? '#f59e0b88' : '#334155' }}
                            accessibilityRole="button"
                            accessibilityLabel={`${viewItem.favorite ? 'Remove' : 'Add'} ${item.name} ${viewItem.favorite ? 'from' : 'to'} favorites`}
                            accessibilityState={{ selected: viewItem.favorite }}
                          >
                            <Text style={{ color: viewItem.favorite ? '#fbbf24' : '#64748b', fontSize: 15 }}>{viewItem.favorite ? '★' : '☆'}</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </ScrollView>

                  {items.length > 3 && (
                    <Pressable onPress={() => catalogScrollRef.current?.scrollToEnd?.({ animated: true })} style={[styles.editScrollArrow, styles.editScrollArrowRight, { borderColor: color + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]} accessibilityRole="button" accessibilityLabel="Scroll Office items to the end">
                      <Text style={[styles.editScrollArrowText, { color }]}>›</Text>
                    </Pressable>
                  )}
                </View>
                {items.length === 0 ? (
                  <View style={{ minHeight: 84, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#334155', borderRadius: 10 }}>
                    <Text style={{ color: '#cbd5e1', fontSize: 11, fontWeight: '800' }}>No Office items match</Text>
                    <Text style={{ color: '#64748b', fontSize: 9, marginTop: 4 }}>Clear the search or choose a different filter.</Text>
                  </View>
                ) : null}
              </View>
            );
          })())}

          {!isDesktop && compactEditorPanel === 'inspector' && currentFloor.furniture.length > 0 ? (
            <View testID="office-compact-placed-items" style={{ marginBottom: 8 }}>
              <Text style={{ color: '#94a3b8', fontSize: 9, fontFamily: 'monospace', fontWeight: '900', marginBottom: 6 }}>
                PLACED ITEMS — SELECT WITHOUT TAPPING THE FLOOR
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
                {currentFloor.furniture.map((item: any) => {
                  const definition = FURNITURE_CATALOG.find((entry: any) => entry.type === item.type);
                  const active = selectedFurnitureId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      testID={`office-compact-placed-item-${item.id}`}
                      onPress={() => onSelectFurniture(item.id)}
                      style={[
                        styles.editActionBtn,
                        {
                          minWidth: 112,
                          minHeight: 44,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          borderColor: active ? '#3b82f6aa' : '#334155',
                          backgroundColor: active ? '#172554' : '#020617',
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Select placed ${definition?.name || item.type}`}
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={{ fontSize: 16 }}>{definition?.icon || '□'}</Text>
                      <Text style={[styles.editActionBtnText, { color: active ? '#bfdbfe' : '#cbd5e1' }]} numberOfLines={1}>
                        {definition?.name || item.type}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {(isDesktop || compactEditorPanel === 'inspector') && selectedFurniture ? (() => {
            const definition = FURNITURE_CATALOG.find((item: any) => item.type === selectedFurniture.type);
            return (
              <View style={{ marginTop: 10, padding: 10, borderWidth: 1, borderColor: '#3b82f655', backgroundColor: '#07111f', borderRadius: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <View>
                    <Text style={{ color: '#dbeafe', fontSize: 11, fontWeight: '900' }}>{definition?.icon} {definition?.name || selectedFurniture.type}</Text>
                    <Text style={{ color: '#64748b', fontSize: 8, fontFamily: 'monospace', marginTop: 3 }}>
                      X {selectedFurniture.x} · Y {selectedFurniture.y} · {selectedFurniture.itemWidth || definition?.width}×{selectedFurniture.itemHeight || definition?.height} · {selectedFurniture.rotation || 0}°
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {definition && (definition.configuration === 'modal' || definition.configuration === 'connection') ? (
                      <Pressable onPress={onConfigureSelected} style={[styles.editActionBtn, { minHeight: 36, justifyContent: 'center', borderColor: '#22c55e66' }]} accessibilityRole="button" accessibilityLabel={`Configure ${definition.name}`}>
                        <Text style={[styles.editActionBtnText, { color: '#86efac' }]}>CONFIGURE / OPEN</Text>
                      </Pressable>
                    ) : null}
                    {[
                      ['DUPLICATE', onDuplicateSelected], ['ROTATE 90°', onRotateSelected], ['RESET SIZE', onResetSelectedSize],
                      ['SEND BACK', () => onMoveSelectedLayer('back')], ['BRING FRONT', () => onMoveSelectedLayer('front')],
                    ].map(([label, action]: any) => (
                      <Pressable key={label} onPress={action} style={[styles.editActionBtn, { minHeight: 36, justifyContent: 'center' }]} accessibilityRole="button" accessibilityLabel={`${label.toLowerCase()} ${definition?.name || 'selected item'}`}>
                        <Text style={[styles.editActionBtnText, { color: '#bfdbfe' }]}>{label}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => { void onDeleteSelected(); }} style={[styles.editActionBtn, { minHeight: 36, borderColor: '#ef444466', justifyContent: 'center' }]} accessibilityRole="button" accessibilityLabel={`Delete ${definition?.name || 'selected item'}`}>
                      <Text style={[styles.editActionBtnText, { color: '#fca5a5' }]}>DELETE</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={{ color: '#64748b', fontSize: 8, fontFamily: 'monospace', fontWeight: '800' }}>NUDGE</Text>
                  {[
                    ['←', -OFFICE_FLOOR_GRID_SIZE, 0, 'left'], ['↑', 0, -OFFICE_FLOOR_GRID_SIZE, 'up'], ['↓', 0, OFFICE_FLOOR_GRID_SIZE, 'down'], ['→', OFFICE_FLOOR_GRID_SIZE, 0, 'right'],
                  ].map(([label, dx, dy, direction]: any) => (
                    <Pressable key={direction} onPress={() => onNudgeSelected(dx, dy)} style={[styles.editActionBtn, { width: 40, minHeight: 36, alignItems: 'center', justifyContent: 'center' }]} accessibilityRole="button" accessibilityLabel={`Move ${definition?.name || 'selected item'} ${direction}`}>
                      <Text style={[styles.editActionBtnText, { color: '#c4b5fd', fontSize: 14 }]}>{label}</Text>
                    </Pressable>
                  ))}
                  <Text style={{ color: '#64748b', fontSize: 8, fontFamily: 'monospace', fontWeight: '800', marginLeft: 6 }}>RESIZE</Text>
                  {[
                    ['W−', -OFFICE_FLOOR_GRID_SIZE, 0, 'narrower'], ['W+', OFFICE_FLOOR_GRID_SIZE, 0, 'wider'],
                    ['H−', 0, -OFFICE_FLOOR_GRID_SIZE, 'shorter'], ['H+', 0, OFFICE_FLOOR_GRID_SIZE, 'taller'],
                  ].map(([label, dw, dh, direction]: any) => (
                    <Pressable
                      key={direction}
                      onPress={() => onResizeSelected(dw, dh)}
                      style={[styles.editActionBtn, { minWidth: 40, minHeight: 36, alignItems: 'center', justifyContent: 'center' }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Make ${definition?.name || 'selected item'} ${direction}`}
                    >
                      <Text style={[styles.editActionBtnText, { color: '#93c5fd' }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })() : null}
          </EditorBodyContainer> : null}
        </View>
      )}
    </>
  );
}

export function OfficeIntelligenceSection({
  viewMode,
  showGitHubFeed,
  showSoundMixer,
  showVault,
  circleId,
  accentColor,
  styles,
  GitHubWallFeed,
  SoundMixer,
  SiteCredentialVaultPanel,
}: any) {
  if (viewMode !== 'office' || (!showGitHubFeed && !showSoundMixer && !showVault)) return null;
  return (
    <View style={styles.officeDashboardPanels}>
      {showGitHubFeed && (
        <View style={styles.officeDashboardPanel}>
          <GitHubWallFeed circleId={circleId} accentColor={accentColor} />
        </View>
      )}
      {showSoundMixer && Platform.OS === 'web' && (
        <View style={[styles.officeDashboardPanel, styles.soundPanelWrap]}>
          <SoundMixer accentColor={accentColor} />
        </View>
      )}
      {showVault && (
        <View style={styles.officeDashboardPanel}>
          <SiteCredentialVaultPanel circleId={circleId} accentColor={accentColor} fullHeight />
        </View>
      )}
    </View>
  );
}

export function OfficeRuntimeSection({
  presentationHidden = false,
  terminalSize,
  setTerminalSize,
  setTerminalInitialTab,
  styles,
  accentColor,
  OfficeTerminalView,
  terminalInitialTab,
  terminalInput,
  setTerminalInput,
  terminalTargetId,
  terminalTargetName,
  setTerminalTargetId,
  setTerminalTargetName,
  terminalModel,
  setTerminalModel,
  terminalTargetIds,
  setTerminalTargetIds,
  circleId,
  currentUserId,
  currentUserName,
  terminalAuthority,
  isTerminalAuthorityCurrent,
  mergedCircleAgents,
  handleCommandSent,
  providerKeys,
}: any) {
  // Editing can temporarily suppress the runtime chrome without unmounting an
  // open OfficeTerminal. Keeping the existing top-level surfaces avoids adding
  // a positioning ancestor around the full-screen terminal while preserving
  // its local state and realtime subscriptions.
  const hiddenPresentationProps = presentationHidden ? ({
    pointerEvents: 'none',
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
    ...(Platform.OS === 'web' ? { 'aria-hidden': true } : {}),
  } as any) : {};
  const hiddenPresentationStyle = presentationHidden ? ({ display: 'none' } as any) : null;

  return (
    <>
      <View {...hiddenPresentationProps} style={[styles.chatToggle, hiddenPresentationStyle]}>
        <View style={styles.terminalBar}>
          <Pressable
            onPress={() => { setTerminalInitialTab('commands'); setTerminalSize(terminalSize === 'closed' ? 'full' : 'closed'); }}
            style={[styles.terminalBarBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            accessibilityRole="button"
            accessibilityLabel={terminalSize === 'closed' ? 'Open terminal' : 'Close terminal'}
          >
            <Text style={styles.chatToggleText}>{terminalSize === 'closed' ? '▲ TERMINAL' : '▼ HIDE'}</Text>
          </Pressable>
          <Pressable
            onPress={() => { setTerminalInitialTab('automations'); setTerminalSize('full'); }}
            style={[styles.terminalBarBtn, { marginLeft: 4 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            accessibilityRole="button"
            accessibilityLabel="Open automations"
          >
            <Text style={[styles.chatToggleText, { color: '#f59e0b' }]}>⚡ AUTOMATIONS</Text>
          </Pressable>
          {terminalSize !== 'closed' && (
            <View style={styles.terminalSizeButtons}>
              <Pressable onPress={() => setTerminalSize('half')} style={[styles.terminalSizeBtn, terminalSize === 'half' && styles.terminalSizeBtnActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                <Text style={[styles.terminalSizeBtnText, terminalSize === 'half' && styles.terminalSizeBtnTextActive]}>▬</Text>
              </Pressable>
              <Pressable onPress={() => setTerminalSize('full')} style={[styles.terminalSizeBtn, terminalSize === 'full' && styles.terminalSizeBtnActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                <Text style={[styles.terminalSizeBtnText, terminalSize === 'full' && styles.terminalSizeBtnTextActive]}>⬜</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {terminalSize === 'half' && (
        <View {...hiddenPresentationProps} style={[styles.chatPane, hiddenPresentationStyle]}>
          {OfficeTerminalView ? (
            <OfficeTerminalView
              circleId={circleId}
              userId={currentUserId}
              userDisplayName={currentUserName}
              terminalAuthority={terminalAuthority}
              isTerminalAuthorityCurrent={isTerminalAuthorityCurrent}
              agents={mergedCircleAgents}
              myAgentIds={mergedCircleAgents.filter((a: any) => a.ownerId === currentUserId).map((a: any) => a.id)}
              sharedInput={terminalInput}
              onSharedInputChange={setTerminalInput}
              sharedTargetId={terminalTargetId}
              sharedTargetName={terminalTargetName}
              onSharedSelectTarget={(id: string, name: string) => { setTerminalTargetId(id); setTerminalTargetName(name); }}
              sharedModel={terminalModel}
              onSharedModelChange={setTerminalModel}
              sharedTargetIds={terminalTargetIds}
              onSharedSelectTargets={(ids: string[]) => setTerminalTargetIds(ids)}
              onCommandSent={handleCommandSent}
              byoProviderKeys={providerKeys}
              initialTab={terminalInitialTab}
              compact
            />
          ) : (
            <View style={styles.terminalLoader}>
              <ActivityIndicator size="small" color={accentColor} />
              <Text style={styles.terminalLoaderText}>Loading terminal…</Text>
            </View>
          )}
        </View>
      )}

      {terminalSize === 'full' && (
        <View {...hiddenPresentationProps} style={[styles.terminalFullscreen, hiddenPresentationStyle]}>
          <View style={styles.terminalFullscreenHeader}>
            <Pressable onPress={() => setTerminalSize('half')} style={[styles.terminalFullscreenBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}>
              <Text style={styles.terminalFullscreenBtnText}>▬ Half</Text>
            </Pressable>
            <Pressable onPress={() => setTerminalSize('closed')} style={[styles.terminalFullscreenBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}>
              <Text style={styles.terminalFullscreenBtnText}>✕ Close</Text>
            </Pressable>
          </View>
          {OfficeTerminalView ? (
            <OfficeTerminalView
              circleId={circleId}
              userId={currentUserId}
              userDisplayName={currentUserName}
              terminalAuthority={terminalAuthority}
              isTerminalAuthorityCurrent={isTerminalAuthorityCurrent}
              agents={mergedCircleAgents}
              myAgentIds={mergedCircleAgents.filter((a: any) => a.ownerId === currentUserId).map((a: any) => a.id)}
              sharedInput={terminalInput}
              onSharedInputChange={setTerminalInput}
              sharedTargetId={terminalTargetId}
              sharedTargetName={terminalTargetName}
              onSharedSelectTarget={(id: string, name: string) => { setTerminalTargetId(id); setTerminalTargetName(name); }}
              sharedModel={terminalModel}
              onSharedModelChange={setTerminalModel}
              sharedTargetIds={terminalTargetIds}
              onSharedSelectTargets={(ids: string[]) => setTerminalTargetIds(ids)}
              onCommandSent={handleCommandSent}
              byoProviderKeys={providerKeys}
              initialTab={terminalInitialTab}
            />
          ) : (
            <View style={styles.terminalLoader}>
              <ActivityIndicator size="small" color={accentColor} />
              <Text style={styles.terminalLoaderText}>Loading terminal…</Text>
            </View>
          )}
        </View>
      )}
    </>
  );
}
