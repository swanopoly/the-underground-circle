import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { OfficeFloor, OfficeTheme } from '../../../../lib/officeConfig';
import type { AgentConnection } from '../../../../lib/connectionManager';

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
  onCancelPlacing,
  onClearFloorFurniture,
  setPlacingType,
  setActiveCatalogCat,
  catalogScrollRef,
  activeCatalogCat,
  styles,
  FURNITURE_CATALOG,
}: any) {
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
                    editMode && floors.length > 1 && styles.floorChipWithDelete,
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
                {editMode && floors.length > 1 && (
                  <Pressable
                    onPress={() => onDeleteFloor(floor.id)}
                    style={[styles.floorDeleteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
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
          {connections.some((c: AgentConnection) => c.enabled && c.status !== 'connected' && c.status !== 'connecting') && (
            <Pressable onPress={onReconnectAll} style={[styles.toolbarBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
              <Text style={styles.toolbarBtnIcon}>🔌</Text>
              <Text style={[styles.toolbarBtnText, { color: '#6366f1' }]}>Reconnect</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onToggleEditMode}
            style={[editMode ? [styles.toolbarBtn, styles.toolbarBtnActiveGreen] : styles.toolbarBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            {editMode ? (
              <Text style={[styles.toolbarBtnText, { color: '#22c55e' }]}>✓ Done</Text>
            ) : (
              <>
                <Text style={styles.toolbarBtnIcon}>🪑</Text>
                <Text style={styles.toolbarBtnText}>Add Items</Text>
              </>
            )}
          </Pressable>
          <Pressable onPress={onShowRewards} style={[styles.toolbarBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.toolbarBtnIcon}>🏆</Text>
            <Text style={styles.toolbarBtnText}>Achievements</Text>
          </Pressable>
          <Pressable onPress={onShowConnectAgent} style={[styles.toolbarBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.toolbarBtnIcon}>☁️</Text>
            <Text style={styles.toolbarBtnText}>Connect Agent</Text>
          </Pressable>
          <Pressable onPress={onShowCustomize} style={[styles.toolbarBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.toolbarBtnIcon}>🔧</Text>
            <Text style={styles.toolbarBtnText}>Customize</Text>
          </Pressable>
          <Pressable
            onPress={onToggleSessionMemoryMode}
            disabled={savingSessionMemoryMode}
            style={[
              styles.toolbarBtn,
              sessionMemoryMode === 'shared' && styles.toolbarBtnActiveMemory,
              savingSessionMemoryMode && { opacity: 0.7 },
              Platform.OS === 'web' && { cursor: 'pointer' } as any,
            ]}
          >
            <Text style={styles.toolbarBtnIcon}>{savingSessionMemoryMode ? '…' : '🧠'}</Text>
            <Text style={[styles.toolbarBtnText, sessionMemoryMode === 'shared' && styles.toolbarBtnTextActiveMemory]}>
              {sessionMemoryMode === 'shared' ? 'Memory Shared' : 'Memory Private'}
            </Text>
          </Pressable>
          <Pressable onPress={onToggleMcpHub} style={[styles.toolbarBtn, showMcpHub && { backgroundColor: accentColor + '18', borderColor: accentColor + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.toolbarBtnIcon}>🔌</Text>
            <Text style={styles.toolbarBtnText}>MCP</Text>
          </Pressable>
          <Pressable onPress={onToggleGitHubFeed} style={[styles.toolbarBtn, showGitHubFeed && { backgroundColor: accentColor + '18', borderColor: accentColor + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.toolbarBtnIcon}>{'{}'}</Text>
            <Text style={styles.toolbarBtnText}>GitHub</Text>
          </Pressable>
          {Platform.OS === 'web' && (
            <Pressable onPress={onToggleSoundMixer} style={[styles.toolbarBtn, showSoundMixer && { backgroundColor: accentColor + '18', borderColor: accentColor + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
              <Text style={styles.toolbarBtnIcon}>{'(('}</Text>
              <Text style={styles.toolbarBtnText}>Sound</Text>
            </Pressable>
          )}
        </View>
      </View>

      {editMode && (
        <View style={styles.editToolbar}>
          <View style={styles.editToolbarHeader}>
            <Text style={styles.editLabel}>
              {placingType ? `TAP FLOOR — PLACING: ${placingType.toUpperCase()}` : selectedFurnitureId ? 'DRAG TO MOVE · CORNERS TO RESIZE · TAP DELETE TO REMOVE' : 'SELECT ITEM BELOW, TAP TO PLACE · DRAG TO MOVE'}
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
  circleId,
  accentColor,
  styles,
  GitHubWallFeed,
  SoundMixer,
}: any) {
  if (viewMode !== 'office' || (!showGitHubFeed && !showSoundMixer)) return null;
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
