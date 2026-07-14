import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { OfficeFloor, OfficeTheme } from '../../../../lib/officeConfig';
import type { AgentConnection } from '../../../../lib/connectionManager';
import { getAudioState, initAudioManager, subscribe, toggleMasterMute } from '../../../../lib/audioManager';

export function OfficeWorkspaceSection({
  viewMode,
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
  onSwitchFloor,
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
  setPlacingType,
  setActiveCatalogCat,
  catalogScrollRef,
  activeCatalogCat,
  styles,
  FURNITURE_CATALOG,
}: any) {
  const [showToolsMenu, setShowToolsMenu] = React.useState(false);
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
  const menuButtonStyle = React.useCallback(
    ({ hovered, pressed }: any, active?: boolean, disabled?: boolean) => [
      styles.toolbarBtn,
      active && { backgroundColor: accentColor + '18', borderColor: accentColor + '40' },
      disabled && { opacity: 0.55, borderColor: '#2f2f2f', backgroundColor: '#131313' },
      hovered && Platform.OS === 'web' && ({
        backgroundColor: 'rgba(34, 211, 238, 0.12)',
        borderColor: 'rgba(168, 85, 247, 0.65)',
        boxShadow: '0 0 0 1px rgba(34, 211, 238, 0.18), 0 0 18px rgba(168, 85, 247, 0.20), inset 0 0 12px rgba(59, 130, 246, 0.08)',
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
  if (viewMode !== 'office') return null;

  return (
    <>
      <View style={styles.floorBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floorList} style={{ flex: 1 }}>
          {[...floors].sort((a: OfficeFloor, b: OfficeFloor) => a.order - b.order).map((floor: OfficeFloor) => {
            const floorAgentCount = displayAgents.filter((agent: any) => floor.agentIds?.includes(agent.id)).length;
            const isActive = floor.id === currentFloorId;
            return (
              <View key={floor.id} style={styles.floorChipWrap}>
                <Pressable
                  onPress={() => onSwitchFloor(floor.id)}
                  style={[
                    styles.floorChip,
                    floors.length > 1 && styles.floorChipWithDelete,
                    isActive && styles.floorChipActive,
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={[styles.floorChipText, isActive && styles.floorChipTextActive]}>{floor.name}</Text>
                  {floorAgentCount > 0 && (
                    <View style={styles.floorAgentBadge}>
                      <Text style={styles.floorAgentBadgeText}>{floorAgentCount}</Text>
                    </View>
                  )}
                  <View style={[styles.floorThemeDot, { backgroundColor: resolveTheme(floor.themeId).accentGlow }]} />
                </Pressable>
                {floors.length > 1 && (
                  <Pressable
                    onPress={() => {
                      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                        const ok = window.confirm(`Remove floor "${floor.name}"? Agents and furniture on this floor will be lost.`);
                        if (!ok) return;
                      }
                      onDeleteFloor(floor.id);
                    }}
                    style={[styles.floorDeleteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    accessibilityLabel={`Remove floor ${floor.name}`}
                  >
                    <Text style={styles.floorDeleteBtnText}>✕</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          <Pressable onPress={onAddFloor} style={[styles.floorAddBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.floorAddBtnText}>+ FLOOR</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.barActions}>
          <View style={{ position: 'relative' }}>
            <Pressable
              onPress={() => setShowToolsMenu((current) => !current)}
              style={[
                styles.toolbarBtn,
                showToolsMenu && { backgroundColor: accentColor + '18', borderColor: accentColor + '40' },
                Platform.OS === 'web' && { cursor: 'pointer' } as any,
              ]}
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
                    title: soundMuted ? 'Sound Muted' : 'Sound On',
                    description: soundMuted
                      ? 'The current window is muted. Click to restore site audio.'
                      : 'Mute the current window without opening any extra panel.',
                    active: soundMuted,
                    titleStyle: soundMuted ? { color: '#ef4444' } : undefined,
                    onPress: () => {
                      setShowToolsMenu(false);
                      if (showSoundMixer) onToggleSoundMixer();
                      toggleMasterMute();
                    },
                  })
                )}
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {editMode && (
        <View style={styles.editToolbar}>
          <View style={styles.editToolbarHeader}>
            <Text style={styles.editLabel}>
              {placingType ? `TAP FLOOR — PLACING: ${(FURNITURE_CATALOG.find((f: any) => f.type === placingType)?.name || placingType).toUpperCase()}` : selectedFurnitureId ? 'DRAG TO MOVE · CORNERS TO RESIZE · TAP DELETE TO REMOVE' : 'SELECT ITEM BELOW, TAP TO PLACE · DRAG TO MOVE'}
            </Text>
            <View style={styles.editToolbarActions}>
              {placingType && (
                <Pressable onPress={onCancelPlacing} style={[styles.editActionBtn, { borderColor: '#ffffff25' }]}>
                  <Text style={[styles.editActionBtnText, { color: '#9e9e9e' }]}>CANCEL</Text>
                </Pressable>
              )}
              {currentFloor.furniture.length > 0 && (
                <Pressable onPress={onClearFloorFurniture} style={[styles.editActionBtn, { borderColor: '#ffffff25' }]}>
                  <Text style={[styles.editActionBtnText, { color: '#9e9e9e' }]}>CLEAR ALL</Text>
                </Pressable>
              )}
            </View>
          </View>

          {(() => {
            const allCats = (['games', 'connected', 'vibe', 'productivity', 'fun', 'furniture'] as const).filter(
              cat => FURNITURE_CATALOG.some((f: any) => f.category === cat),
            );
            const catColors: Record<string, string> = {
              games: '#ef4444', connected: '#22c55e', vibe: '#a855f7', productivity: '#3b82f6',
              fun: '#f59e0b', furniture: '#6f6f6f',
            };
            const catIcons: Record<string, string> = {
              games: '🃏', connected: '🔗', vibe: '✨', productivity: '📊',
              fun: '🎮', furniture: '🪑',
            };
            const cat = activeCatalogCat || 'connected';
            const items = FURNITURE_CATALOG.filter((f: any) => f.category === cat);
            const color = catColors[cat] || '#888';
            return (
              <View style={styles.editCatalogWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editCatTabs}>
                  {allCats.map(catKey => {
                    const count = FURNITURE_CATALOG.filter((f: any) => f.category === catKey).length;
                    return (
                      <Pressable
                        key={catKey}
                        onPress={() => { setActiveCatalogCat(catKey as any); catalogScrollRef.current?.scrollTo?.({ x: 0, animated: false }); }}
                        style={[
                          styles.editCatTab,
                          activeCatalogCat === catKey && { borderColor: catColors[catKey] + '80', backgroundColor: catColors[catKey] + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any,
                        ]}
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
                    <Pressable onPress={() => catalogScrollRef.current?.scrollTo?.({ x: 0, animated: true })} style={[styles.editScrollArrow, styles.editScrollArrowLeft, { borderColor: color + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={[styles.editScrollArrowText, { color }]}>‹</Text>
                    </Pressable>
                  )}

                  <ScrollView ref={catalogScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editItems} style={{ flex: 1 }}>
                    {items.map((item: any) => {
                      const isActive = placingType === item.type;
                      return (
                        <Pressable
                          key={item.type}
                          onPress={() => {
                            setActiveCatalogCat(cat as any);
                            setPlacingType(isActive ? null : item.type);
                          }}
                          style={[
                            styles.editItem,
                            isActive && styles.editItemActive,
                            isActive && { borderColor: color + '80', shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0.5 },
                            Platform.OS === 'web' && { cursor: 'pointer' } as any,
                          ]}
                        >
                          <Text style={styles.editItemIcon}>{item.icon}</Text>
                          <Text style={[styles.editItemName, isActive && { color: '#eee' }]}>{item.name}</Text>
                          {item.description ? <Text style={styles.editItemDesc} numberOfLines={2}>{item.description}</Text> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {items.length > 3 && (
                    <Pressable onPress={() => catalogScrollRef.current?.scrollToEnd?.({ animated: true })} style={[styles.editScrollArrow, styles.editScrollArrowRight, { borderColor: color + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={[styles.editScrollArrowText, { color }]}>›</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })()}
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
  mergedCircleAgents,
  handleCommandSent,
  providerKeys,
}: any) {
  return (
    <>
      <View style={styles.chatToggle}>
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
        <View style={styles.chatPane}>
          {OfficeTerminalView ? (
            <OfficeTerminalView
              circleId={circleId}
              userId={currentUserId}
              userDisplayName={currentUserName}
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
        <View style={styles.terminalFullscreen}>
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
