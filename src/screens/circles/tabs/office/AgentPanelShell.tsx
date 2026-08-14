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
          <Text style={styles.errorFallbackTitle}>This section could not load</Text>
          <Text style={styles.errorFallbackMessage} numberOfLines={4}>{msg}</Text>
          <Text style={styles.errorFallbackHint}>
            Try again, switch sections, or reopen the agent panel.
          </Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            accessibilityRole="button"
            accessibilityLabel="Try loading this agent section again"
            style={[
              styles.errorFallbackBtn,
              { borderColor: this.props.accentColor + '55', backgroundColor: this.props.accentColor + '14' },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <Text style={[styles.errorFallbackBtnText, { color: this.props.accentColor }]}>Try again</Text>
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
  canRenameAgent: boolean;
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
  canRenameAgent,
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
  // AgentPanel owns the single Escape/focus-trap listener. Keeping a second
  // listener here used to close twice and could dismiss the panel while the
  // user was editing a field. Style injection is also an effect, never a DOM
  // mutation during render.
  React.useEffect(() => {
    ensureOpenAnimStyle();
  }, []);

  const currentTabIndex = tabs.findIndex(tab => tab.key === panelTab);
  const prevTab = currentTabIndex > 0 ? tabs[currentTabIndex - 1] : null;
  const nextTab = currentTabIndex >= 0 && currentTabIndex < tabs.length - 1 ? tabs[currentTabIndex + 1] : null;
  const providerMeta = PROVIDER_META[agent.providerType];

  const renderRemoveButton = (desktop = false) => canRemoveAgent ? (
    <View style={desktop ? styles.desktopActionRow : styles.mobileActionRow}>
      <Pressable
        onPress={onRemoveAgent}
        disabled={removingAgent}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${agent.name} from this Office`}
        accessibilityHint="Removes the published Office agent after confirmation. It does not stop the local runtime."
        accessibilityState={{ disabled: removingAgent, busy: removingAgent }}
        style={[
          styles.removeButton,
          removingAgent && { opacity: 0.65 },
          Platform.OS === 'web' && { cursor: removingAgent ? 'wait' : 'pointer' } as any,
        ]}
      >
        <Text style={styles.removeButtonText}>
          {removingAgent ? 'Removing…' : 'Remove agent'}
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
          accessibilityLabel={prevTab ? `Previous tab: ${prevTab.label}` : 'Previous tab unavailable'}
          accessibilityState={{ disabled: !prevTab }}
          style={[styles.tabNavArrow, { opacity: prevTab ? 1 : 0.2 }, Platform.OS === 'web' && { cursor: prevTab ? 'pointer' : 'default' } as any]}
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
            accessibilityHint={tab.description}
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
          accessibilityLabel={nextTab ? `Next tab: ${nextTab.label}` : 'Next tab unavailable'}
          accessibilityState={{ disabled: !nextTab }}
          style={[styles.tabNavArrow, { opacity: nextTab ? 1 : 0.2 }, Platform.OS === 'web' && { cursor: nextTab ? 'pointer' : 'default' } as any]}
        >
          <Text style={styles.tabNavArrowText}>{'>'}</Text>
        </Pressable>
      )}
    </View>
  );

  const headerMeta = [
    agent.role || null,
    providerMeta?.label || agent.providerType || null,
    agent.model && agent.model !== 'unknown' ? agent.model : null,
  ].filter((value): value is string => !!value).join(' · ');

  const renderHeader = () => (
    <View style={styles.desktopHeader} accessibilityRole="header">
      <View style={styles.desktopHeaderLeft}>
        <View style={[styles.desktopHeaderAvatar, { backgroundColor: agent.color + '20', borderColor: agent.color + '70' }]}>
          <Text style={[styles.desktopHeaderAvatarText, { color: agent.color }]}>{agent.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.desktopHeaderIdentity}>
          {editing ? (
            <View style={styles.desktopHeaderEditingRow}>
              <TextInput
                style={styles.desktopHeaderNameInput}
                value={editName}
                onChangeText={setEditName}
                autoFocus
                onSubmitEditing={onSubmitRename}
                placeholder={agent.name}
                placeholderTextColor="#484f58"
                accessibilityLabel="Agent name"
              />
              <Pressable
                onPress={onSubmitRename}
                style={[styles.desktopRenameAction, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                accessibilityRole="button"
                accessibilityLabel="Save agent name"
              >
                <Text style={styles.desktopRenameActionText}>Save</Text>
              </Pressable>
              <Pressable
                onPress={onCancelRename}
                style={[styles.desktopRenameAction, styles.desktopRenameCancelAction, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                accessibilityRole="button"
                accessibilityLabel="Cancel rename"
              >
                <Text style={[styles.desktopRenameActionText, styles.desktopRenameCancelActionText]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.desktopHeaderNameWrap}>
              <Text nativeID="uc-agent-panel-title" style={styles.desktopHeaderName} numberOfLines={1}>{agent.name}</Text>
              {canRenameAgent ? (
                <Pressable
                  onPress={onStartRename}
                  style={[styles.desktopRenameChip, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${agent.name}`}
                >
                  <Text style={styles.desktopRenameChipText}>Rename</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          <View style={styles.desktopHeaderMeta}>
            <View
              style={[styles.desktopHeaderStatus, { borderColor: statusColor + '38', backgroundColor: statusColor + '12' }]}
              accessibilityLiveRegion="polite"
            >
              <View style={[styles.desktopHeaderStatusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.desktopHeaderStatusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {headerMeta ? <Text style={styles.desktopHeaderMetaText} numberOfLines={1}>{headerMeta}</Text> : null}
          </View>
        </View>
      </View>
      <View style={styles.desktopHeaderRight}>
        {isDesktop ? (
          <Pressable
            onPress={onToggleMode}
            style={({ hovered }: any) => [
              styles.desktopIconBtn,
              hovered && styles.desktopIconBtnHover,
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
            accessibilityRole="button"
            accessibilityLabel={panelMode === 'center' ? 'Dock agent panel to the right' : 'Open agent panel as a centered pop-up'}
          >
            <Text style={styles.desktopIconBtnText}>{panelMode === 'center' ? 'Dock' : 'Pop out'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onClose}
          style={({ hovered }: any) => [
            styles.desktopCloseIconBtn,
            hovered && styles.desktopIconBtnHover,
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
          ]}
          accessibilityRole="button"
          accessibilityLabel="Close agent panel"
        >
          <Text style={styles.desktopCloseIconText}>×</Text>
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
        accessibilityViewIsModal={panelMode === 'center'}
        // The CSS keyframe (uc-agent-panel-open) drives the open fade on web.
        // scaleAnim/opacityAnim values are pinned to 1/1 by AgentPanel during
        // open, so they're no-ops here unless the close animation runs them
        // back down to 0. className is a web-only RN Web extension so we
        // spread it via `as any` to avoid TypeScript noise.
        {...(Platform.OS === 'web' ? ({
          className: isDesktop ? 'uc-agent-panel-open' : undefined,
          role: 'dialog',
          'aria-modal': panelMode === 'center' ? true : undefined,
          'aria-labelledby': 'uc-agent-panel-title',
        } as any) : {})}
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

        {!isDesktop ? (
          <View style={styles.handleArea} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.handle} />
          </View>
        ) : null}

        {renderHeader()}
        {renderTabNavigation(isDesktop)}

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={isDesktop ? styles.desktopScrollContent : styles.mobileScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TabErrorBoundary tabKey={panelTab} accentColor={agent.color || '#6366f1'}>
            {children}
          </TabErrorBoundary>
          {panelTab === 'overview' ? renderRemoveButton(isDesktop) : null}
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    zIndex: 100,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#161b22',
    borderTopWidth: 1,
    borderTopColor: '#30363d',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 0,
    paddingBottom: 0,
    maxHeight: '88%' as any,
    overflow: 'hidden' as any,
  },
  panelDesktop: {
    bottom: 'auto' as any,
    right: 'auto' as any,
    maxHeight: 'none' as any,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingHorizontal: 0,
    paddingBottom: 0,
    overflow: 'hidden' as any,
    ...(Platform.OS === 'web' ? {
      position: 'fixed',
      zIndex: 100,
      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    } as any : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.4,
      shadowRadius: 24,
      elevation: 18,
    }),
  },
  panelSide: {
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
    ...(Platform.OS === 'web' ? {
      boxShadow: '-8px 0 28px rgba(0,0,0,0.38)',
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
    backgroundColor: '#484f58',
  },
  desktopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
    backgroundColor: '#161b22',
    gap: 12,
    minHeight: 68,
  },
  desktopHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  desktopHeaderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopHeaderAvatarText: {
    fontSize: 15,
    fontWeight: '600',
  },
  desktopHeaderIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  desktopHeaderName: {
    color: '#e6edf3',
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  desktopHeaderNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    flex: 1,
  },
  desktopHeaderEditingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  desktopHeaderNameInput: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flex: 1,
    minWidth: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  desktopRenameAction: {
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopRenameActionText: {
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '600',
  },
  desktopRenameCancelAction: {
    borderColor: '#30363d',
    backgroundColor: 'transparent',
  },
  desktopRenameCancelActionText: {
    color: '#8b949e',
  },
  desktopHeaderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  desktopHeaderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
    flexShrink: 0,
  },
  desktopHeaderStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  desktopHeaderStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  desktopHeaderMetaText: {
    color: '#8b949e',
    fontSize: 12,
    flex: 1,
    minWidth: 0,
  },
  desktopRenameChip: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopRenameChipText: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '500',
  },
  desktopHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  desktopIconBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { transition: 'background-color 140ms ease, border-color 140ms ease, color 140ms ease' } as any : {}),
  },
  desktopIconBtnHover: {
    backgroundColor: '#30363d',
    borderColor: '#8b949e',
  },
  desktopIconBtnText: {
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '600',
  },
  desktopCloseIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopCloseIconText: {
    color: '#8b949e',
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 26,
  },
  desktopActionRow: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
  },
  mobileActionRow: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
  },
  removeButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f8514948',
    backgroundColor: '#f8514910',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#f85149',
    fontSize: 13,
    fontWeight: '600',
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#161b22',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#484f58',
    borderRadius: 2,
  },
  scrollContent: {
    flex: 1,
  },
  desktopScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  mobileScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  tabNavShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
    marginBottom: 0,
    backgroundColor: '#161b22',
  },
  tabNavShellDesktop: {
    marginBottom: 0,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
    backgroundColor: '#161b22',
    borderBottomColor: '#21262d',
  },
  tabNavArrow: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabNavArrowText: {
    color: '#8b949e',
    fontSize: 16,
    fontWeight: '600',
  },
  tabNavScroller: {
    flex: 1,
    maxHeight: 44,
  },
  tabNavContent: {
    gap: 2,
  },
  tabNavItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabNavItemText: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '500',
  },
  tabNavItemTextActive: {
    color: '#e6edf3',
    fontWeight: '600',
  },
  errorFallback: {
    margin: 0,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f8514948',
    backgroundColor: '#f8514910',
    gap: 8,
    alignItems: 'flex-start',
  },
  errorFallbackTitle: {
    color: '#f85149',
    fontSize: 14,
    fontWeight: '600',
  },
  errorFallbackMessage: {
    color: '#e6edf3',
    fontSize: 12,
    fontFamily: MONO,
    lineHeight: 18,
  },
  errorFallbackHint: {
    color: '#8b949e',
    fontSize: 12,
    lineHeight: 18,
  },
  errorFallbackBtn: {
    paddingHorizontal: 12,
    minHeight: 44,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 4,
  },
  errorFallbackBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
