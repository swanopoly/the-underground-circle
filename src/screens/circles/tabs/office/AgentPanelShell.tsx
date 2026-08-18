import React from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { OfficeAgent } from '../../../../lib/officeAgents';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import {
  getAgentPanelGroupForTab,
  type AgentPanelGroup,
  type AgentPanelTab,
  type AgentPanelTabKey,
} from './AgentPanelTabs';

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
  failed: boolean;
}
class TabErrorBoundary extends React.Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  state: TabErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): TabErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, info: React.ErrorInfo) {
    console.error('[AgentPanel] Section render failed:', this.props.tabKey, info.componentStack);
  }

  componentDidUpdate(prevProps: TabErrorBoundaryProps) {
    // Auto-reset when the user switches tabs so a failed tab doesn't stick.
    if (prevProps.tabKey !== this.props.tabKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={styles.errorFallback}>
          <Text style={styles.errorFallbackTitle}>This section could not load</Text>
          <Text style={styles.errorFallbackHint}>
            Try again, switch sections, or reopen the agent panel. No private error details are displayed here.
          </Text>
          <Pressable
            onPress={() => this.setState({ failed: false })}
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
  reduceMotion: boolean;
  backdropOpacity: number;
  panelTransition: string;
  statusColor: string;
  statusLabel: string;
  editing: boolean;
  editName: string;
  setEditName: (value: string) => void;
  onStartRename: () => void;
  onSubmitRename: () => Promise<void>;
  onCancelRename: () => void;
  canRenameAgent: boolean;
  renameBusy: boolean;
  actionNotice: { kind: 'success' | 'error'; message: string } | null;
  onClose: () => void;
  onToggleMode: () => void;
  onStartSideResize: (pageX: number) => void;
  onResizeSideBy: (delta: number) => void;
  canRemoveAgent: boolean;
  removingAgent: boolean;
  onRemoveAgent: () => Promise<void>;
  tabs: AgentPanelTab[];
  tabGroups: AgentPanelGroup[];
  panelTab: AgentPanelTabKey;
  setPanelTab: (tabKey: AgentPanelTabKey) => void;
  contentKey: string;
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
    @media (prefers-reduced-motion: reduce) {
      .uc-agent-panel-open {
        animation: none !important;
        transition: none !important;
        will-change: auto;
      }
      .uc-agent-panel-backdrop {
        transition: none !important;
      }
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
  reduceMotion,
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
  renameBusy,
  actionNotice,
  onClose,
  onToggleMode,
  onStartSideResize,
  onResizeSideBy,
  canRemoveAgent,
  removingAgent,
  onRemoveAgent,
  tabs,
  tabGroups,
  panelTab,
  setPanelTab,
  contentKey,
  children,
}: Props) {
  // AgentPanel owns the single Escape/focus-trap listener. Keeping a second
  // listener here used to close twice and could dismiss the panel while the
  // user was editing a field. Style injection is also an effect, never a DOM
  // mutation during render.
  React.useEffect(() => {
    ensureOpenAnimStyle();
  }, []);

  const providerMeta = PROVIDER_META[agent.providerType];
  const activeGroup = getAgentPanelGroupForTab(tabGroups, panelTab) || tabGroups[0] || null;
  const activeTab = tabs.find(tab => tab.key === panelTab) || activeGroup?.tabs[0] || null;
  const hasContextualTabs = (activeGroup?.tabs.length || 0) > 1;
  const activeTabLabelId = hasContextualTabs
    ? `uc-agent-panel-route-${panelTab}`
    : `uc-agent-panel-destination-${activeGroup?.key || 'overview'}`;

  const focusWebTab = (nativeId: string) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const focus = () => document.getElementById(nativeId)?.focus({ preventScroll: true });
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
    else focus();
  };

  const handleArrowNavigation = (
    event: any,
    keys: readonly string[],
    currentKey: string,
    nativeIdForKey: (key: string) => string,
  ) => {
    const key = event?.nativeEvent?.key || event?.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key) || keys.length < 2) return;
    event.preventDefault?.();
    const currentIndex = Math.max(0, keys.indexOf(currentKey));
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? keys.length - 1
        : key === 'ArrowLeft'
          ? (currentIndex - 1 + keys.length) % keys.length
          : (currentIndex + 1) % keys.length;
    const nextKey = keys[nextIndex];
    // These routes lazy-load, so follow the WAI-ARIA manual-activation model:
    // arrows move focus without fetching or replacing the active panel. The
    // focused Pressable activates through Enter/Space (or a pointer press).
    focusWebTab(nativeIdForKey(nextKey));
  };

  const renderRemoveButton = (desktop = false) => canRemoveAgent ? (
    <View style={desktop ? styles.desktopActionRow : styles.mobileActionRow}>
      <Pressable
        onPress={onRemoveAgent}
        disabled={removingAgent || renameBusy}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${agent.name} from this Office`}
        accessibilityHint="Removes the published Office agent after confirmation. It does not stop the local runtime."
        accessibilityState={{ disabled: removingAgent || renameBusy, busy: removingAgent }}
        style={[
          styles.removeButton,
          (removingAgent || renameBusy) && { opacity: 0.65 },
          Platform.OS === 'web' && { cursor: removingAgent ? 'wait' : renameBusy ? 'not-allowed' : 'pointer' } as any,
        ]}
      >
        <Text style={styles.removeButtonText}>
          {removingAgent ? 'Removing…' : 'Remove agent'}
        </Text>
      </Pressable>
    </View>
  ) : null;

  const renderTabNavigation = (desktop = false) => {
    const groupKeys = tabGroups.map(group => group.key);
    const selectGroupKey = (groupKey: string) => {
      const group = tabGroups.find(candidate => candidate.key === groupKey);
      if (!group) return;
      const currentRoute = group.tabs.find(tab => tab.key === panelTab);
      setPanelTab((currentRoute || group.tabs[0]).key);
    };
    const routeKeys = activeGroup?.tabs.map(tab => tab.key) || [];

    return (
      <View style={[styles.navigationShell, desktop && styles.navigationShellDesktop]}>
        <View
          style={styles.tabNavShell}
          accessibilityRole="tablist"
          {...(Platform.OS === 'web' ? ({ role: 'tablist', 'aria-label': 'Agent panel destinations' } as any) : {})}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabNavScroller}
            contentContainerStyle={styles.primaryTabNavContent}
          >
            {tabGroups.map(group => {
              const selected = activeGroup?.key === group.key;
              const nativeId = `uc-agent-panel-destination-${group.key}`;
              return (
                <Pressable
                  key={group.key}
                  nativeID={nativeId}
                  onPress={() => selectGroupKey(group.key)}
                  accessibilityRole="tab"
                  accessibilityLabel={`${group.label} destination`}
                  accessibilityHint={group.description}
                  accessibilityState={{ selected }}
                  {...(Platform.OS === 'web' ? ({
                    role: 'tab',
                    'aria-selected': selected,
                    'aria-controls': 'uc-agent-panel-tabpanel',
                    tabIndex: selected ? 0 : -1,
                    onKeyDown: (event: any) => handleArrowNavigation(
                      event,
                      groupKeys,
                      group.key,
                      key => `uc-agent-panel-destination-${key}`,
                    ),
                  } as any) : {})}
                  style={[
                    styles.primaryTabNavItem,
                    selected && {
                      borderBottomColor: agent.color || '#6366f1',
                      backgroundColor: (agent.color || '#6366f1') + '12',
                    },
                    Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                  ]}
                >
                  <Text style={[styles.primaryTabNavItemText, selected && styles.tabNavItemTextActive]}>
                    {group.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {hasContextualTabs && activeGroup ? (
          <View
            style={styles.contextualTabNavShell}
            accessibilityRole="tablist"
            {...(Platform.OS === 'web' ? ({ role: 'tablist', 'aria-label': `${activeGroup.label} sections` } as any) : {})}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tabNavScroller}
              contentContainerStyle={styles.contextualTabNavContent}
            >
              {activeGroup.tabs.map(tab => {
                const selected = panelTab === tab.key;
                const nativeId = `uc-agent-panel-route-${tab.key}`;
                return (
                  <Pressable
                    key={tab.key}
                    nativeID={nativeId}
                    onPress={() => setPanelTab(tab.key)}
                    accessibilityRole="tab"
                    accessibilityLabel={`${tab.label} tab`}
                    accessibilityHint={tab.description}
                    accessibilityState={{ selected }}
                    {...(Platform.OS === 'web' ? ({
                      role: 'tab',
                      'aria-selected': selected,
                      'aria-controls': 'uc-agent-panel-tabpanel',
                      tabIndex: selected ? 0 : -1,
                      onKeyDown: (event: any) => handleArrowNavigation(
                        event,
                        routeKeys,
                        tab.key,
                        key => `uc-agent-panel-route-${key}`,
                      ),
                    } as any) : {})}
                    style={[
                      styles.contextualTabNavItem,
                      selected && {
                        borderColor: (agent.color || '#6366f1') + '70',
                        backgroundColor: (agent.color || '#6366f1') + '14',
                      },
                      Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                    ]}
                  >
                    <Text style={[styles.contextualTabNavItemText, selected && styles.tabNavItemTextActive]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>
    );
  };

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
                editable={!renameBusy}
                autoFocus
                onSubmitEditing={onSubmitRename}
                placeholder={agent.name}
                placeholderTextColor="#484f58"
                accessibilityLabel="Agent name"
                accessibilityState={{ disabled: renameBusy, busy: renameBusy }}
              />
              <Pressable
                onPress={onSubmitRename}
                disabled={renameBusy || !editName.trim()}
                style={[
                  styles.desktopRenameAction,
                  (renameBusy || !editName.trim()) && styles.commandActionDisabled,
                  Platform.OS === 'web' ? ({ cursor: renameBusy ? 'wait' : !editName.trim() ? 'not-allowed' : 'pointer' } as any) : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save agent name"
                accessibilityState={{ disabled: renameBusy || !editName.trim(), busy: renameBusy }}
              >
                <Text style={styles.desktopRenameActionText}>{renameBusy ? 'Saving…' : 'Save'}</Text>
              </Pressable>
              <Pressable
                onPress={onCancelRename}
                disabled={renameBusy}
                style={[
                  styles.desktopRenameAction,
                  styles.desktopRenameCancelAction,
                  renameBusy && styles.commandActionDisabled,
                  Platform.OS === 'web' ? ({ cursor: renameBusy ? 'not-allowed' : 'pointer' } as any) : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cancel rename"
                accessibilityState={{ disabled: renameBusy }}
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
        {isDesktop && Platform.OS === 'web' ? (
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

  const panelLayer = (
    <>
      {panelMode === 'center' && (
        <Pressable
          onPress={onClose}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          {...(Platform.OS === 'web' ? ({ className: 'uc-agent-panel-backdrop' } as any) : {})}
          style={[
            styles.modalBackdrop,
            { opacity: backdropOpacity },
            Platform.OS === 'web' && ({
              position: 'fixed',
              transition: 'opacity 280ms cubic-bezier(0.4, 0, 0.2, 1)',
              cursor: 'pointer',
            } as any),
          ]}
        />
      )}

      <Animated.View
        nativeID="uc-agent-panel-root"
        accessibilityViewIsModal={panelMode === 'center'}
        importantForAccessibility={panelMode === 'center' ? 'yes' : 'auto'}
        // The CSS keyframe (uc-agent-panel-open) drives the open fade on web.
        // scaleAnim/opacityAnim values are pinned to 1/1 by AgentPanel during
        // open, so they're no-ops here unless the close animation runs them
        // back down to 0. className is a web-only RN Web extension so we
        // spread it via `as any` to avoid TypeScript noise.
        {...(Platform.OS === 'web' ? ({
          className: 'uc-agent-panel-open',
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
          <Pressable
            onPointerDown={(e: any) => onStartSideResize(e.nativeEvent?.pageX || e.pageX || 0)}
            accessibilityRole="adjustable"
            accessibilityLabel="Resize docked agent panel"
            accessibilityValue={{ min: 380, max: 720, now: Math.round(panelGeometry.width), text: `${Math.round(panelGeometry.width)} pixels wide` }}
            accessibilityActions={[{ name: 'increment', label: 'Make panel wider' }, { name: 'decrement', label: 'Make panel narrower' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') onResizeSideBy(24);
              if (event.nativeEvent.actionName === 'decrement') onResizeSideBy(-24);
            }}
            {...({
              tabIndex: 0,
              onKeyDown: (event: any) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault?.();
                  onResizeSideBy(24);
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault?.();
                  onResizeSideBy(-24);
                }
              },
            } as any)}
            style={styles.sideResizeHandle as any}
          >
            <View style={styles.sideResizeGrip} />
          </Pressable>
        )}

        {!isDesktop ? (
          <View style={styles.handleArea} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.handle} />
          </View>
        ) : null}

        {renderHeader()}
        {actionNotice ? (
          <View
            style={[
              styles.commandNotice,
              actionNotice.kind === 'error' ? styles.commandNoticeError : styles.commandNoticeSuccess,
            ]}
            accessibilityRole={actionNotice.kind === 'error' ? 'alert' : undefined}
            accessibilityLiveRegion={actionNotice.kind === 'error' ? 'assertive' : 'polite'}
          >
            <Text
              style={[
                styles.commandNoticeText,
                actionNotice.kind === 'error' ? styles.commandNoticeErrorText : styles.commandNoticeSuccessText,
              ]}
            >
              {actionNotice.message}
            </Text>
          </View>
        ) : null}
        {renderTabNavigation(isDesktop)}

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={isDesktop ? styles.desktopScrollContent : styles.mobileScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TabErrorBoundary key={contentKey} tabKey={panelTab} accentColor={agent.color || '#6366f1'}>
            <View
              nativeID="uc-agent-panel-tabpanel"
              accessibilityRole={'tabpanel' as any}
              accessibilityLabel={activeTab ? `${activeTab.label} section` : 'Agent section'}
              {...(Platform.OS === 'web' ? ({
                role: 'tabpanel',
                'aria-labelledby': activeTabLabelId,
                tabIndex: 0,
              } as any) : {})}
            >
              {children}
            </View>
          </TabErrorBoundary>
          {panelTab === 'overview' ? renderRemoveButton(isDesktop) : null}
        </ScrollView>
      </Animated.View>
    </>
  );

  // Native Modal creates a separate accessibility/window boundary: TalkBack
  // cannot walk into the Office behind the compact sheet, and Android hardware
  // Back is routed through onRequestClose. RN Web keeps the existing dialog and
  // docked-inspector DOM so its focus trap/restoration behavior is unchanged.
  if (Platform.OS !== 'web' && panelMode === 'center') {
    return (
      <Modal
        visible
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <View style={styles.nativeModalRoot}>{panelLayer}</View>
      </Modal>
    );
  }

  return panelLayer;
}

const styles = StyleSheet.create({
  nativeModalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
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
    left: -8,
    top: 0,
    bottom: 0,
    width: 16,
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
  commandActionDisabled: {
    opacity: 0.6,
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
  commandNotice: {
    minHeight: 36,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  commandNoticeError: {
    backgroundColor: '#f8514910',
    borderBottomColor: '#f8514938',
  },
  commandNoticeSuccess: {
    backgroundColor: '#22c55e10',
    borderBottomColor: '#22c55e38',
  },
  commandNoticeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  commandNoticeErrorText: {
    color: '#ff7b72',
  },
  commandNoticeSuccessText: {
    color: '#3fb950',
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
  navigationShell: {
    backgroundColor: '#161b22',
  },
  navigationShellDesktop: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  tabNavShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
    backgroundColor: '#161b22',
  },
  tabNavScroller: {
    flex: 1,
  },
  primaryTabNavContent: {
    flexGrow: 1,
    gap: 2,
  },
  primaryTabNavItem: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryTabNavItemText: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '500',
  },
  contextualTabNavShell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
    backgroundColor: '#0d1117',
  },
  contextualTabNavContent: {
    gap: 6,
  },
  contextualTabNavItem: {
    minHeight: 36,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    justifyContent: 'center',
  },
  contextualTabNavItemText: {
    color: '#8b949e',
    fontSize: 12,
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
