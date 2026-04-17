import React from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { OfficeAgent } from '../../../../lib/officeAgents';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { AgentPanelTab, AgentPanelTabKey } from './AgentPanelTabs';
import { MONO } from './AgentPanelShared';

// ── Per-tab error boundary ──────────────────────────────────────────────────
// Wraps the active tab's rendered content so a single tab that throws (e.g.
// memory query fails, a module import returned undefined, a bad shape comes
// back from the DB) cannot blow up the entire panel. The boundary resets
// whenever the user switches tabs by keying on `tabKey`.
interface TabErrorBoundaryProps {
  tabKey: string;
  accentColor: string;
  children: React.ReactNode;
}
interface TabErrorBoundaryState {
  error: Error | null;
}
class TabErrorBoundary extends React.Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  state: TabErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AgentPanel] Tab threw:', this.props.tabKey, error, info);
  }

  componentDidUpdate(prevProps: TabErrorBoundaryProps) {
    // Auto-reset when the user switches tabs so a failed tab doesn't stick.
    if (prevProps.tabKey !== this.props.tabKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || 'Unknown error';
      return (
        <View style={styles.errorFallback}>
          <Text style={styles.errorFallbackTitle}>TAB CRASHED</Text>
          <Text style={styles.errorFallbackMessage} numberOfLines={4}>{msg}</Text>
          <Text style={styles.errorFallbackHint}>
            Switch tabs to reset, or close the panel and reopen it.
          </Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            style={[
              styles.errorFallbackBtn,
              { borderColor: this.props.accentColor + '55', backgroundColor: this.props.accentColor + '14' },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <Text style={[styles.errorFallbackBtnText, { color: this.props.accentColor }]}>TRY AGAIN</Text>
          </Pressable>
        </View>
      );
    }
    return <>{this.props.children}</>;
  }
}

type PanelMode = 'center' | 'side';

interface Props {
  agent: OfficeAgent;
  isDesktop: boolean;
  panelMode: PanelMode;
  panelGeometry: { width: number; height: number; left: number; top: number };
  scaleAnim: Animated.Value;
  opacityAnim: Animated.Value;
  slideAnim: Animated.Value;
  backdropOpacity: number;
  panelTransition: string;
  statusColor: string;
  statusLabel: string;
  editing: boolean;
  editName: string;
  setEditName: (value: string) => void;
  onStartRename: () => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onClose: () => void;
  onToggleMode: () => void;
  onStartSideResize: (pageX: number) => void;
  canRemoveAgent: boolean;
  removingAgent: boolean;
  onRemoveAgent: () => Promise<void>;
  tabs: AgentPanelTab[];
  panelTab: AgentPanelTabKey;
  setPanelTab: (tabKey: AgentPanelTabKey) => void;
  children: React.ReactNode;
}

// Same color palette as the loading indicator dots
const TAB_DOT_COLORS = ['#6366f1', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#22d3ee'];

// ── Open animation ──────────────────────────────────────────────────────────
// One-shot CSS keyframe fade. GPU-accelerated, no React re-renders during the
// animation (the previous Animated.Value approach felt laggy because it set
// transform/opacity inline every frame). 110ms is short enough to feel snappy
// while still cueing "this is a modal opening" rather than snap-appearing.
const OPEN_ANIM_STYLE_ID = 'uc-agent-panel-open-anim';
function ensureOpenAnimStyle() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(OPEN_ANIM_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = OPEN_ANIM_STYLE_ID;
  style.textContent = `
    @keyframes uc-agent-panel-open {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    .uc-agent-panel-open {
      animation: uc-agent-panel-open 110ms ease-out;
      will-change: opacity;
    }
  `;
  document.head.appendChild(style);
}

function TabNavigationDots({ count, activeIndex, accentColor }: { count: number; activeIndex: number; accentColor: string }) {
  return (
    <View style={styles.tabDotsRow}>
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === activeIndex;
        const color = isActive ? accentColor : TAB_DOT_COLORS[i % TAB_DOT_COLORS.length];
        return (
          <View
            key={i}
            style={{
              width: isActive ? 10 : 7,
              height: isActive ? 10 : 7,
              borderRadius: 99,
              backgroundColor: color,
              opacity: isActive ? 1 : 0.5,
            }}
          />
        );
      })}
    </View>
  );
}

export default function AgentPanelShell({
  agent,
  isDesktop,
  panelMode,
  panelGeometry,
  scaleAnim,
  opacityAnim,
  slideAnim,
  backdropOpacity,
  panelTransition,
  statusColor,
  statusLabel,
  editing,
  editName,
  setEditName,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onClose,
  onToggleMode,
  onStartSideResize,
  canRemoveAgent,
  removingAgent,
  onRemoveAgent,
  tabs,
  panelTab,
  setPanelTab,
  children,
}: Props) {
  React.useEffect(() => {
    if (!isDesktop || Platform.OS !== 'web') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDesktop, onClose]);

  // Inject the open-animation keyframes once. ensureOpenAnimStyle is a no-op
  // on native and idempotent on web (checks document.getElementById first).
  ensureOpenAnimStyle();

  const currentTabIndex = tabs.findIndex(tab => tab.key === panelTab);
  const activeTab = currentTabIndex >= 0 ? tabs[currentTabIndex] : null;
  const prevTab = currentTabIndex > 0 ? tabs[currentTabIndex - 1] : null;
  const nextTab = currentTabIndex >= 0 && currentTabIndex < tabs.length - 1 ? tabs[currentTabIndex + 1] : null;
  const providerMeta = PROVIDER_META[agent.providerType];

  const renderRemoveButton = (desktop = false) => canRemoveAgent ? (
    <View style={desktop ? styles.desktopActionRow : styles.mobileActionRow}>
      <Pressable
        onPress={onRemoveAgent}
        style={[styles.removeButton, removingAgent && { opacity: 0.65 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={styles.removeButtonText}>
          {removingAgent ? 'REMOVING...' : 'REMOVE AGENT'}
        </Text>
      </Pressable>
    </View>
  ) : null;

  const renderTabNavigation = (desktop = false) => (
    <View
      style={[styles.tabNavShell, desktop && styles.tabNavShellDesktop]}
      accessibilityRole={desktop ? 'tablist' : undefined}
    >
      {!desktop && (
        <Pressable
          onPress={() => prevTab && setPanelTab(prevTab.key)}
          disabled={!prevTab}
          accessibilityRole="button"
          accessibilityLabel={prevTab ? `Go to ${prevTab.label} tab` : 'No previous tab'}
          style={[styles.tabNavArrow, { opacity: prevTab ? 1 : 0.2 }, Platform.OS === 'web' && { cursor: prevTab ? 'pointer' : 'default' } as any]}
          hitSlop={8}
        >
          <Text style={styles.tabNavArrowText}>{'<'}</Text>
        </Pressable>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabNavScroller} contentContainerStyle={styles.tabNavContent}>
        {tabs.map(tab => (
          <Pressable
            key={tab.key}
            onPress={() => setPanelTab(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.label} tab`}
            accessibilityState={{ selected: panelTab === tab.key }}
            style={[
              styles.tabNavItem,
              panelTab === tab.key && { borderBottomColor: agent.color || '#6366f1', backgroundColor: (agent.color || '#6366f1') + '12' },
              ...(Platform.OS === 'web' ? [{ cursor: 'pointer', transition: 'all 0.15s ease' } as any] : []),
            ]}
          >
            <Text style={[styles.tabNavItemText, panelTab === tab.key && styles.tabNavItemTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {!desktop && (
        <Pressable
          onPress={() => nextTab && setPanelTab(nextTab.key)}
          disabled={!nextTab}
          accessibilityRole="button"
          accessibilityLabel={nextTab ? `Go to ${nextTab.label} tab` : 'No next tab'}
          style={[styles.tabNavArrow, { opacity: nextTab ? 1 : 0.2 }, Platform.OS === 'web' && { cursor: nextTab ? 'pointer' : 'default' } as any]}
          hitSlop={8}
        >
          <Text style={styles.tabNavArrowText}>{'>'}</Text>
        </Pressable>
      )}
    </View>
  );

  const renderDesktopControls = () => (
    <View style={styles.desktopControlStrip}>
      <View style={styles.desktopControlGroup}>
        <Text style={styles.desktopControlLabel}>Layout</Text>
        <Pressable
          onPress={() => panelMode === 'side' && onToggleMode()}
          accessibilityRole="button"
          accessibilityLabel="Switch to popup layout"
          accessibilityState={{ selected: panelMode === 'center' }}
          style={[
            styles.desktopControlBtn,
            panelMode === 'center' && styles.desktopControlBtnActive,
            Platform.OS === 'web' && ({ cursor: panelMode === 'center' ? 'default' : 'pointer' } as any),
          ]}
        >
          <Text style={[styles.desktopControlBtnText, panelMode === 'center' && styles.desktopControlBtnTextActive]}>POPUP</Text>
        </Pressable>
        <Pressable
          onPress={() => panelMode === 'center' && onToggleMode()}
          accessibilityRole="button"
          accessibilityLabel="Dock panel to side"
          accessibilityState={{ selected: panelMode === 'side' }}
          style={[
            styles.desktopControlBtn,
            panelMode === 'side' && styles.desktopControlBtnActive,
            Platform.OS === 'web' && ({ cursor: panelMode === 'side' ? 'default' : 'pointer' } as any),
          ]}
        >
          <Text style={[styles.desktopControlBtnText, panelMode === 'side' && styles.desktopControlBtnTextActive]}>DOCKED</Text>
        </Pressable>
      </View>

      <View style={styles.desktopControlGroupRight}>
        {panelMode === 'side' ? (
          <Text style={styles.desktopControlHint}>Press `Esc` to close</Text>
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close panel"
          style={[
            styles.desktopCloseBtn,
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
          ]}
        >
          <Text style={styles.desktopCloseBtnText}>CLOSE</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      {isDesktop && Platform.OS === 'web' && (
        <View
          pointerEvents={panelMode === 'center' ? 'auto' : 'none'}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            zIndex: 99,
            opacity: backdropOpacity,
            transition: 'opacity 280ms cubic-bezier(0.4, 0, 0.2, 1)',
            cursor: panelMode === 'center' ? 'pointer' : 'default',
          } as any}
          // onClick is a web-only RN Web extension; spread to bypass typing
          {...({ onClick: onClose } as any)}
        />
      )}

      <Animated.View
        nativeID="uc-agent-panel-root"
        // The CSS keyframe (uc-agent-panel-open) drives the open fade on web.
        // scaleAnim/opacityAnim values are pinned to 1/1 by AgentPanel during
        // open, so they're no-ops here unless the close animation runs them
        // back down to 0. className is a web-only RN Web extension so we
        // spread it via `as any` to avoid TypeScript noise.
        {...(isDesktop && Platform.OS === 'web' ? ({ className: 'uc-agent-panel-open' } as any) : {})}
        style={[
        styles.panel,
        isDesktop
          ? {
              transform: [{ scale: scaleAnim }],
              opacity: opacityAnim,
              width: panelGeometry.width,
              height: panelGeometry.height,
              left: panelGeometry.left,
              top: panelGeometry.top,
            }
          : { transform: [{ translateY: slideAnim }] },
        isDesktop && styles.panelDesktop,
        isDesktop && panelMode === 'side' && styles.panelSide,
        isDesktop && Platform.OS === 'web' ? ({ transition: panelTransition } as any) : null,
      ]}>
        {isDesktop && Platform.OS === 'web' && panelMode === 'side' && (
          <View
            onPointerDown={(e: any) => onStartSideResize(e.nativeEvent?.pageX || e.pageX || 0)}
            style={styles.sideResizeHandle as any}
          >
            <View style={styles.sideResizeGrip} />
          </View>
        )}

        {isDesktop ? (
          <View style={styles.desktopHeader}>
            <View style={styles.desktopHeaderLeft}>
              <View style={[styles.desktopHeaderAvatar, { backgroundColor: agent.color + '22', borderColor: agent.color }]}>
                <Text style={[styles.desktopHeaderAvatarText, { color: agent.color }]}>{agent.name.charAt(0).toUpperCase()}</Text>
              </View>
              {editing ? (
                <View style={styles.desktopHeaderEditingRow}>
                  <TextInput
                    style={styles.desktopHeaderNameInput}
                    value={editName}
                    onChangeText={setEditName}
                    autoFocus
                    onBlur={() => {
                      const trimmed = editName.trim();
                      if (trimmed && trimmed !== agent.name) onSubmitRename();
                      else onCancelRename();
                    }}
                    onSubmitEditing={onSubmitRename}
                    placeholder={agent.name}
                    placeholderTextColor="#555"
                  />
                  <Pressable
                    onPress={onSubmitRename}
                    style={[styles.desktopRenameAction, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                    accessibilityLabel="Save agent name"
                  >
                    <Text style={styles.desktopRenameActionText}>Save</Text>
                  </Pressable>
                  <Pressable
                    onPress={onCancelRename}
                    style={[styles.desktopRenameAction, styles.desktopRenameCancelAction, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                    accessibilityLabel="Cancel rename"
                  >
                    <Text style={[styles.desktopRenameActionText, styles.desktopRenameCancelActionText]}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.desktopHeaderNameWrap}>
                  <Pressable
                    onPress={onStartRename}
                    style={[
                      { flexShrink: 1, minWidth: 0 },
                      Platform.OS === 'web' ? ({ cursor: 'text' } as any) : null,
                    ]}
                    accessibilityLabel="Rename agent"
                  >
                    <Text style={styles.desktopHeaderName} numberOfLines={1}>{agent.name}</Text>
                  </Pressable>
                  <Pressable
                    onPress={onStartRename}
                    style={[styles.desktopRenameChip, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                    accessibilityLabel="Rename agent"
                  >
                    <Text style={styles.desktopRenameChipText}>Rename</Text>
                  </Pressable>
                </View>
              )}
              <View style={[styles.desktopHeaderStatus, { borderColor: statusColor + '55', backgroundColor: statusColor + '14' }]}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor, marginRight: 6 }} />
                <Text style={[styles.desktopHeaderStatusText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>
            <View style={styles.desktopHeaderRight}>
              <Pressable
                onPress={onToggleMode}
                style={({ hovered }: any) => [
                  styles.desktopIconBtn,
                  hovered && styles.desktopIconBtnHover,
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
                accessibilityLabel={panelMode === 'center' ? 'Dock to right side' : 'Center panel'}
                hitSlop={8}
              >
                <Text style={styles.desktopIconBtnText}>{panelMode === 'center' ? '⇥' : '⇤'}</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                style={({ hovered }: any) => [
                  styles.desktopIconBtn,
                  hovered && styles.desktopIconBtnHover,
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
                accessibilityLabel="Close panel"
                hitSlop={8}
              >
                <Text style={styles.desktopIconBtnText}>✕</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={onClose} style={styles.handleArea}>
            <View style={styles.handle} />
          </Pressable>
        )}

        {isDesktop && (
          <>
            <View style={styles.desktopSubtitle}>
              {agent.role ? (
                <View style={styles.desktopMetaChip}>
                  <Text style={styles.desktopMetaChipLabel}>ROLE</Text>
                  <Text style={styles.desktopMetaChipValue} numberOfLines={1}>{agent.role}</Text>
                </View>
              ) : null}
              {agent.model ? (
                <View style={styles.desktopMetaChip}>
                  <Text style={styles.desktopMetaChipLabel}>MODEL</Text>
                  <Text style={styles.desktopMetaChipValue} numberOfLines={1}>{agent.model}</Text>
                </View>
              ) : null}
              <View style={styles.desktopMetaChip}>
                <Text style={styles.desktopMetaChipLabel}>PROVIDER</Text>
                <View style={styles.desktopMetaChipInline}>
                  <Text style={styles.desktopSubtitleIcon}>{providerMeta?.icon || '📡'}</Text>
                  <Text style={[styles.desktopMetaChipValue, { color: providerMeta?.color || '#888' }]} numberOfLines={1}>
                    {agent.connectionName}
                  </Text>
                </View>
              </View>
              {activeTab ? (
                <View style={styles.desktopMetaChip}>
                  <Text style={styles.desktopMetaChipLabel}>TAB</Text>
                  <Text style={styles.desktopMetaChipValue}>{activeTab.label}</Text>
                </View>
              ) : null}
              <View style={[styles.desktopMetaChip, styles.desktopMetaChipMode]}>
                <Text style={styles.desktopMetaChipLabel}>LAYOUT</Text>
                <Text style={styles.desktopMetaChipValue}>{panelMode === 'center' ? 'Centered' : 'Docked'}</Text>
              </View>
            </View>
            {renderDesktopControls()}
            {renderRemoveButton(true)}
            {renderTabNavigation(true)}
            {activeTab ? (
              <View style={styles.activeTabDescription}>
                <Text style={styles.activeTabDescriptionLabel}>CURRENT TAB</Text>
                <Text style={styles.activeTabDescriptionText}>{activeTab.description}</Text>
              </View>
            ) : null}
            <TabNavigationDots count={tabs.length} activeIndex={Math.max(currentTabIndex, 0)} accentColor={agent.color || '#6366f1'} />
          </>
        )}

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={isDesktop ? styles.desktopScrollContent : undefined}
          showsVerticalScrollIndicator={false}
        >
          {!isDesktop && (
            <>
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={[styles.avatar, { backgroundColor: agent.color + '20', borderColor: agent.color }]}>
                    <Text style={[styles.avatarText, { color: agent.color }]}>{agent.name.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    {editing ? (
                      <View style={styles.renameRow}>
                        <TextInput
                          style={styles.renameInput}
                          value={editName}
                          onChangeText={setEditName}
                          autoFocus
                          onSubmitEditing={onSubmitRename}
                        />
                        <Pressable onPress={onSubmitRename} style={[styles.renameSaveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.renameSaveText}>✓</Text>
                        </Pressable>
                        <Pressable onPress={onCancelRename} style={[styles.renameCancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                          <Text style={styles.renameCancelText}>✕</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={onStartRename} style={[Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <View style={styles.nameRow}>
                          <Text style={styles.name}>{agent.name}</Text>
                          <Text style={styles.renameHint}>✏️</Text>
                        </View>
                      </Pressable>
                    )}
                    <View style={styles.roleRow}>
                      <Text style={styles.role}>{agent.role}</Text>
                      <View style={styles.modelBadge}>
                        <Text style={styles.modelText}>{agent.model}</Text>
                      </View>
                    </View>
                  </View>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
                  <View style={[styles.statusDotSmall, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                </View>
              </View>

              <View style={styles.connectionRow}>
                <Text style={styles.connectionIcon}>{PROVIDER_META[agent.providerType]?.icon || '📡'}</Text>
                <Text style={[styles.connectionName, { color: PROVIDER_META[agent.providerType]?.color || '#888' }]}>{agent.connectionName}</Text>
                <Text style={styles.connectionType}>{PROVIDER_META[agent.providerType]?.label || agent.providerType}</Text>
              </View>

              {renderRemoveButton(false)}
              {renderTabNavigation(false)}
              <TabNavigationDots count={tabs.length} activeIndex={Math.max(currentTabIndex, 0)} accentColor={agent.color || '#6366f1'} />
            </>
          )}

          <TabErrorBoundary tabKey={panelTab} accentColor={agent.color || '#6366f1'}>
            {children}
          </TabErrorBoundary>
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1e1e3a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: '70%' as any,
  },
  panelDesktop: {
    bottom: 'auto' as any,
    right: 'auto' as any,
    maxHeight: 'none' as any,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    paddingHorizontal: 0,
    paddingBottom: 0,
    overflow: 'hidden' as any,
    ...(Platform.OS === 'web' ? {
      position: 'fixed',
      zIndex: 100,
      boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset',
    } as any : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.5,
      shadowRadius: 30,
      elevation: 24,
    }),
  },
  panelSide: {
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
    ...(Platform.OS === 'web' ? {
      boxShadow: '-16px 0 48px rgba(0,0,0,0.55), -4px 0 16px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset',
    } as any : {}),
  },
  sideResizeHandle: {
    position: 'absolute',
    left: -3,
    top: 0,
    bottom: 0,
    width: 8,
    zIndex: 12,
    cursor: 'col-resize' as any,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sideResizeGrip: {
    width: 2,
    height: 48,
    borderRadius: 1,
    backgroundColor: '#2a2a3e',
  },
  desktopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e3a',
    backgroundColor: '#08080c',
    gap: 10,
  },
  desktopHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  desktopHeaderAvatar: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopHeaderAvatarText: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: MONO,
  },
  desktopHeaderName: {
    color: '#e8e8ef',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  desktopHeaderNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flexShrink: 1,
  },
  desktopHeaderEditingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  desktopHeaderNameInput: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 0.3,
    backgroundColor: '#0f0f18',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 1,
    minWidth: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  desktopRenameAction: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#2c3f2f',
    backgroundColor: '#102016',
  },
  desktopRenameActionText: {
    color: '#9ae6b4',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    fontFamily: MONO,
  },
  desktopRenameCancelAction: {
    borderColor: '#2a2a36',
    backgroundColor: '#111118',
  },
  desktopRenameCancelActionText: {
    color: '#a0a0b0',
  },
  desktopHeaderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  desktopHeaderStatusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: MONO,
  },
  desktopRenameChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#272733',
    backgroundColor: '#12121a',
  },
  desktopRenameChipText: {
    color: '#9fa0ad',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    fontFamily: MONO,
  },
  desktopHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  desktopIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ffffff12',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { transition: 'background-color 140ms ease, border-color 140ms ease, color 140ms ease' } as any : {}),
  },
  desktopIconBtnHover: {
    backgroundColor: '#ffffff0c',
    borderColor: '#ffffff1f',
  },
  desktopIconBtnText: {
    color: '#9a9aa8',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: MONO,
  },
  desktopSubtitle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#14141c',
    backgroundColor: '#070709',
  },
  desktopMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#20202a',
    backgroundColor: '#101016',
  },
  desktopMetaChipMode: {
    marginLeft: 'auto',
  },
  desktopMetaChipInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  desktopMetaChipLabel: {
    color: '#5f5f6b',
    fontSize: 10,
    fontFamily: MONO,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  desktopMetaChipValue: {
    color: '#b3b3bf',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '700',
    flexShrink: 1,
  },
  desktopSubtitleIcon: {
    fontSize: 12,
  },
  desktopActionRow: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#070709',
    borderBottomWidth: 1,
    borderBottomColor: '#14141c',
  },
  desktopControlStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#070709',
    borderBottomWidth: 1,
    borderBottomColor: '#14141c',
  },
  desktopControlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  desktopControlGroupRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 'auto',
  },
  desktopControlLabel: {
    color: '#6d6d78',
    fontSize: 10,
    fontFamily: MONO,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  desktopControlBtn: {
    minWidth: 78,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#242432',
    backgroundColor: '#101016',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { transition: 'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease' } as any : {}),
  },
  desktopControlBtnActive: {
    borderColor: '#6366f155',
    backgroundColor: '#6366f118',
  },
  desktopControlBtnText: {
    color: '#9b9baa',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  desktopControlBtnTextActive: {
    color: '#ececf3',
  },
  desktopControlHint: {
    color: '#6d6d78',
    fontSize: 11,
    fontFamily: MONO,
  },
  desktopCloseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef444438',
    backgroundColor: '#ef444410',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { transition: 'background-color 140ms ease, border-color 140ms ease' } as any : {}),
  },
  desktopCloseBtnText: {
    color: '#f87171',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  mobileActionRow: {
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  removeButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#ef444414',
  },
  removeButtonText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: MONO,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
  },
  scrollContent: {
    flex: 1,
  },
  desktopScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  activeTabDescription: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#232338',
    backgroundColor: '#0c0c14',
  },
  activeTabDescriptionLabel: {
    color: '#71718a',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: MONO,
    marginBottom: 4,
  },
  activeTabDescriptionText: {
    color: '#b8b8c7',
    fontSize: 12,
    lineHeight: 18,
  },
  tabNavShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
    marginBottom: 8,
  },
  tabNavShellDesktop: {
    marginBottom: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: '#08080b',
    borderBottomColor: '#14141c',
  },
  tabNavArrow: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  tabNavArrowText: {
    color: '#909098',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: MONO,
  },
  tabNavScroller: {
    flex: 1,
    maxHeight: 44,
  },
  tabNavContent: {
    gap: 4,
  },
  tabNavItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    borderRadius: 6,
    minHeight: 40,
    justifyContent: 'center',
  },
  tabNavItemText: {
    color: '#a2a2ae',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: MONO,
    letterSpacing: 0.2,
  },
  tabNavItemTextActive: {
    color: '#f7f7fb',
    fontWeight: '800',
  },
  tabDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    marginTop: 6,
    minHeight: 12,
  },
  errorFallback: {
    margin: 12,
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#18080a',
    gap: 8,
    alignItems: 'flex-start',
  },
  errorFallbackTitle: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: MONO,
  },
  errorFallbackMessage: {
    color: '#e0d0d0',
    fontSize: 12,
    fontFamily: MONO,
    lineHeight: 18,
  },
  errorFallbackHint: {
    color: '#808090',
    fontSize: 11,
    fontFamily: MONO,
    lineHeight: 16,
  },
  errorFallbackBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    marginTop: 4,
  },
  errorFallbackBtnText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: MONO,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '900',
    fontFamily: MONO,
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    fontFamily: MONO,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameHint: {
    fontSize: 13,
    opacity: 0.4,
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameInput: {
    flex: 1,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: '#eee',
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: '800',
  },
  renameSaveBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameSaveText: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '800',
  },
  renameCancelBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ef444420',
    borderWidth: 1,
    borderColor: '#ef444440',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameCancelText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  role: {
    fontSize: 12,
    fontWeight: '700',
    color: '#a1a1aa',
    fontFamily: MONO,
    textTransform: 'uppercase',
  },
  modelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  modelText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ddd',
    fontFamily: MONO,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: MONO,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  connectionIcon: {
    fontSize: 14,
  },
  connectionName: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    flexShrink: 1,
  },
  connectionType: {
    fontSize: 11,
    color: '#666',
    fontFamily: MONO,
    marginLeft: 'auto',
  },
});
