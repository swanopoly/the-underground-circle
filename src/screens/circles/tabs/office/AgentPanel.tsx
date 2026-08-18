import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Platform, ActivityIndicator, Pressable, Text, AccessibilityInfo } from 'react-native';
import {
  getAgentIdentityKey,
  type AgentIdentityExactAuthority,
  type AgentIdentityExactSaveResult,
} from '../../../../lib/agentIdentity';
import { OfficeAgent, getOfficeStatusColor, getOfficeStatusLabel } from '../../../../lib/officeAgents';
import { SessionTag, type OfficeSessionStorageScope } from '../../../../lib/sessionTags';
import AgentPanelShell from './AgentPanelShell';
import {
  getAgentPanelGroups,
  getAgentPanelTabs,
  getFallbackAgentPanelTab,
  type AgentPanelCapabilities,
  type AgentPanelTabKey,
} from './AgentPanelTabs';
import { useAgentPanelLayout } from './useAgentPanelLayout';
import AgentOverviewPanel from './AgentOverviewPanel';
import AgentActivityPanel from './AgentActivityPanel';
import {
  AgentAppearance, EnvironmentType,
} from '../../../../lib/officeConfig';
import { buildAgentRuntimeSubject, isUuidLike } from '../../../../lib/agentRuntimeSubject';
import { chatAgentTargetIdFromOfficeAgentId } from '../../../../lib/chatAgentTargets';
import { showConfirm } from '../../../../lib/alert';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from '../../../../lib/connectionManager';
export type AgentPanelIdentityAuthority = AgentIdentityExactAuthority & {
  generation?: number;
};

interface Props {
  agent: OfficeAgent | null;
  onClose: () => void;
  isDesktop?: boolean;
  onRenameAgent?: (agent: OfficeAgent, newName: string) => Promise<AgentIdentityExactSaveResult>;
  onAgentIdentityChange?: () => Promise<boolean>;
  onRemoveAgent?: (agent: OfficeAgent) => Promise<boolean>;
  sessionTags?: Map<string, SessionTag[]>;
  onAddSessionTag?: (sessionKey: string, tag: SessionTag) => void;
  onRemoveSessionTag?: (sessionKey: string, tagKey: string) => void;
  sessionStorageScope?: OfficeSessionStorageScope;
  circleId?: string;
  // Compatibility marker for exact-authority source contracts:
  // identityAuthority?: AgentIdentityExactAuthority | null;
  identityAuthority?: AgentPanelIdentityAuthority | null;
  runtimeConnectionId?: string | null;
  appearances?: Record<string, AgentAppearance>;
  onAppearanceChange?: (id: string, appearance: AgentAppearance) => Promise<AgentIdentityExactSaveResult>;
  environmentType?: EnvironmentType;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
  onOpenAgentInChat?: (agentId: string, draft?: string) => void;
}

export type AgentPanelActionNotice = {
  kind: 'success' | 'warning' | 'error';
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
} | null;

type GatewayPanelsModule = typeof import('./AgentGatewayPanels');
type TerminalPanelsModule = typeof import('./AgentTerminalPanels');
type MemoryPanelModule = typeof import('./AgentMemoryPanel');
type RunsPanelModule = typeof import('./AgentRunsPanel');
type CustomizePanelModule = typeof import('./AgentCustomizePanel');
type EvolutionPanelModule = typeof import('./AgentEvolutionPanel');
type SpiritPanelModule = typeof import('./AgentSpiritPanel');

type LazyPanelModuleState<T> =
  | { status: 'idle' | 'loading' | 'error'; module: null }
  | { status: 'ready'; module: T };

type LazyPanelModuleResult<T> = LazyPanelModuleState<T> & {
  retry: () => void;
};

const loadGatewayPanelsModule = () => import('./AgentGatewayPanels');
const loadTerminalPanelsModule = () => import('./AgentTerminalPanels');
const loadMemoryPanelModule = () => import('./AgentMemoryPanel');
const loadRunsPanelModule = () => import('./AgentRunsPanel');
const loadCustomizePanelModule = () => import('./AgentCustomizePanel');
const loadEvolutionPanelModule = () => import('./AgentEvolutionPanel');
const loadSpiritPanelModule = () => import('./AgentSpiritPanel');

function useLazyPanelModule<T>(
  active: boolean,
  loader: () => Promise<T>,
): LazyPanelModuleResult<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LazyPanelModuleState<T>>({ status: 'idle', module: null });
  const loadedModuleRef = useRef<T | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    if (!active) return;
    if (loadedModuleRef.current) {
      setState({ status: 'ready', module: loadedModuleRef.current });
      return;
    }

    setState({ status: 'loading', module: null });
    void loader().then(module => {
      if (requestGenerationRef.current !== requestGeneration) return;
      loadedModuleRef.current = module;
      setState({ status: 'ready', module });
    }).catch(() => {
      if (requestGenerationRef.current !== requestGeneration) return;
      setState({ status: 'error', module: null });
    });

    return () => {
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current = requestGeneration + 1;
      }
    };
  }, [active, attempt, loader]);

  const retry = useCallback(() => {
    loadedModuleRef.current = null;
    setAttempt(current => current + 1);
  }, []);

  return { ...state, retry } as LazyPanelModuleResult<T>;
}

function LazySectionState({
  label,
  status,
  accentColor,
  onRetry,
}: {
  label: string;
  status: 'idle' | 'loading' | 'error';
  accentColor: string;
  onRetry: () => void;
}) {
  if (status !== 'error') {
    return (
      <View
        style={{ paddingHorizontal: 12, paddingVertical: 24, alignItems: 'center', gap: 10 }}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator size="small" color={accentColor} />
        <Text style={{ color: '#8b949e', fontSize: 12 }}>Loading {label}…</Text>
      </View>
    );
  }

  return (
    <View
      style={{ paddingHorizontal: 12, paddingVertical: 20, alignItems: 'flex-start', gap: 10 }}
      accessibilityLiveRegion="polite"
    >
      <Text style={{ color: '#e6edf3', fontSize: 14, fontWeight: '600' }}>
        This section could not load
      </Text>
      <Text style={{ color: '#8b949e', fontSize: 12, lineHeight: 18 }}>
        Check the connection, then try loading it again.
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={`Retry loading ${label}`}
        style={[
          {
            minHeight: 44,
            paddingHorizontal: 12,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: accentColor + '55',
            backgroundColor: accentColor + '14',
            justifyContent: 'center',
          },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
        ]}
      >
        <Text style={{ color: accentColor, fontSize: 12, fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function tokenFingerprint(value: string | undefined): string {
  let hash = 2166136261;
  for (let index = 0; index < (value?.length || 0); index += 1) {
    hash ^= value!.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ── SECTION: agent-remote-shell — Run shell commands on the agent's machine ──

// ═════════════════════════════════════════════════════════════════════════════

export default function AgentPanel({
  agent, onClose, isDesktop, onRenameAgent,
  onAgentIdentityChange,
  onRemoveAgent,
  sessionTags, onAddSessionTag, onRemoveSessionTag, sessionStorageScope, circleId,
  identityAuthority,
  runtimeConnectionId,
  appearances, onAppearanceChange, environmentType, onRunCommand,
  onOpenAgentInChat,
}: Props) {
  const slideAnim = useRef(new Animated.Value(400)).current;

  const {
    panelMode,
    panelGeometry,
    panelTransition,
    backdropOpacity,
    setBackdropOn,
    toggleMode,
    startSideResize,
    resizeSideBy,
  } = useAgentPanelLayout();
  // Docking is a web-only inspector affordance. A wide native tablet still
  // needs the React Native Modal window, hardware-Back handling, and modal
  // accessibility isolation; never let its desktop breakpoint expose the
  // persisted web side-panel mode.
  const supportsDockedPanel = !!isDesktop && Platform.OS === 'web';
  // A saved desktop dock preference must never turn a compact or native sheet
  // into a non-modal inspector. Keep the preference for the next web desktop
  // visit, but use centered dialog semantics everywhere else.
  const effectivePanelMode = supportsDockedPanel ? panelMode : 'center';
  // Office supplies one immutable user/circle/bearer snapshot. Never recover
  // a replacement identity authority from the mutable global auth client.
  const exactIdentityAuthority = useMemo<OfficeConnectionExactAuthority | null>(() => {
    const userId = identityAuthority?.userId?.trim();
    const authorityCircleId = identityAuthority?.circleId?.trim();
    const accessToken = identityAuthority?.accessToken?.trim();
    const generation = Number(identityAuthority?.generation);
    if (
      !userId
      || !circleId
      || !authorityCircleId
      || authorityCircleId !== circleId
      || !accessToken
      || !Number.isSafeInteger(generation)
      || generation <= 0
    ) return null;
    return { userId, circleId: authorityCircleId, accessToken, generation };
  }, [
    circleId,
    identityAuthority?.accessToken,
    identityAuthority?.circleId,
    identityAuthority?.generation,
    identityAuthority?.userId,
  ]);
  const authorityGeneration = useMemo(() => {
    const generation = Number(identityAuthority?.generation);
    return Number.isSafeInteger(generation) && generation > 0 ? generation : null;
  }, [identityAuthority?.generation]);
  const latestExactIdentityAuthorityRef = useRef<OfficeConnectionExactAuthority | null>(exactIdentityAuthority);
  latestExactIdentityAuthorityRef.current = exactIdentityAuthority;
  const isExactIdentityAuthorityCurrent = useCallback<OfficeConnectionAuthorityFence>((candidate) => {
    const current = latestExactIdentityAuthorityRef.current;
    return !!current
      && current.userId === candidate.userId
      && current.circleId === candidate.circleId
      && current.accessToken === candidate.accessToken
      && current.generation === candidate.generation;
  }, []);
  useEffect(() => () => {
    latestExactIdentityAuthorityRef.current = null;
  }, []);
  const userId = exactIdentityAuthority?.userId || null;
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // `null` means the platform preference has not resolved yet. Treat unknown
  // (and a failed read) as reduced motion so native never flashes an entrance
  // animation before it knows the user's accessibility preference.
  const [reduceMotionPreference, setReduceMotionPreference] = useState<boolean | null>(null);
  const reduceMotion = reduceMotionPreference !== false;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotionPreference(enabled);
    }).catch(() => {
      if (mounted) setReduceMotionPreference(true);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionPreference);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Web open uses the Shell's CSS keyframe; native compact open uses the
  // retained slide animation below. The parent owns visibility and removes the
  // panel as soon as `agent` becomes null, so this component deliberately does
  // not claim or start an invisible close animation.
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const panelAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const previouslyOpenAgentRef = useRef<OfficeAgent | null>(null);
  const stopPanelAnimation = useCallback(() => {
    panelAnimationRef.current?.stop();
    panelAnimationRef.current = null;
    scaleAnim.stopAnimation();
    opacityAnim.stopAnimation();
    slideAnim.stopAnimation();
  }, [opacityAnim, scaleAnim, slideAnim]);
  const startPanelAnimation = useCallback((animation: Animated.CompositeAnimation) => {
    stopPanelAnimation();
    panelAnimationRef.current = animation;
    animation.start(() => {
      if (panelAnimationRef.current === animation) panelAnimationRef.current = null;
    });
  }, [stopPanelAnimation]);
  // A published Office row already carries its exact UUID as the db-agent
  // session key. Never create or name-match a durable agent merely because a
  // read-only panel opened; live runtime sessions keep their own exact subject.
  const dbAgentId = useMemo(
    () => agent?.connectionId === 'db-agent' && isUuidLike(agent.sessionKey)
      ? agent.sessionKey
      : null,
    [agent?.connectionId, agent?.sessionKey],
  );
  const agentSubject = useMemo(
    () => agent ? buildAgentRuntimeSubject(agent, { dbAgentId }) : null,
    [agent, dbAgentId],
  );

  const panelScopeKey = useMemo(() => {
    const subjectScope = agent
      ? `${agentSubject?.subjectKey || agent.id}:${agent.id}`
      : 'closed';
    const authorityScope = exactIdentityAuthority
      ? `${exactIdentityAuthority.userId}:${exactIdentityAuthority.circleId}:generation:${authorityGeneration ?? `legacy-${tokenFingerprint(exactIdentityAuthority.accessToken)}`}`
      : `locked:generation:${authorityGeneration ?? `legacy-${tokenFingerprint(identityAuthority?.accessToken)}`}`;
    return `${subjectScope}:${authorityScope}:runtime:${runtimeConnectionId || 'none'}`;
  }, [
    agent,
    agentSubject?.subjectKey,
    authorityGeneration,
    exactIdentityAuthority,
    identityAuthority?.accessToken,
    runtimeConnectionId,
  ]);
  const [renameDraft, setRenameDraft] = useState<{ scopeKey: string; name: string } | null>(null);
  const [renameBusyScopeKey, setRenameBusyScopeKey] = useState<string | null>(null);
  const [removeBusyScopeKey, setRemoveBusyScopeKey] = useState<string | null>(null);
  const [scopedActionNotice, setScopedActionNotice] = useState<(
    NonNullable<AgentPanelActionNotice> & { scopeKey: string }
  ) | null>(null);
  const latestPanelScopeKeyRef = useRef(panelScopeKey);
  latestPanelScopeKeyRef.current = panelScopeKey;
  const renameInFlightRef = useRef(false);
  const identityRefreshInFlightRef = useRef(false);
  const removeInFlightRef = useRef(false);
  const renameRequestGenerationRef = useRef(0);
  const removeRequestGenerationRef = useRef(0);
  const editing = renameDraft?.scopeKey === panelScopeKey;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const editName = editing ? renameDraft.name : '';
  const renameBusy = renameBusyScopeKey === panelScopeKey;
  const removingAgent = removeBusyScopeKey === panelScopeKey;
  const actionNotice = scopedActionNotice?.scopeKey === panelScopeKey
    ? scopedActionNotice
    : null;
  const reloadIdentityForNotice = useCallback(async () => {
    const capturedScopeKey = panelScopeKey;
    if (!onAgentIdentityChange || identityRefreshInFlightRef.current) return;
    identityRefreshInFlightRef.current = true;
    setScopedActionNotice({
      scopeKey: capturedScopeKey,
      kind: 'warning',
      message: 'Reloading the exact agent identity…',
    });
    try {
      const refreshed = await onAgentIdentityChange();
      if (latestPanelScopeKeyRef.current !== capturedScopeKey) return;
      setScopedActionNotice(refreshed ? {
        scopeKey: capturedScopeKey,
        kind: 'success',
        message: 'Agent identity refreshed from the server.',
      } : {
        scopeKey: capturedScopeKey,
        kind: 'warning',
        message: 'Agent identity could not be refreshed yet. Close and reopen Office after connectivity returns; do not repeat the save.',
      });
    } catch {
      if (latestPanelScopeKeyRef.current !== capturedScopeKey) return;
      setScopedActionNotice({
        scopeKey: capturedScopeKey,
        kind: 'warning',
        message: 'Agent identity could not be refreshed yet. Close and reopen Office after connectivity returns; do not repeat the save.',
      });
    } finally {
      identityRefreshInFlightRef.current = false;
    }
  }, [onAgentIdentityChange, panelScopeKey]);
  const setEditName = useCallback((name: string) => {
    setRenameDraft(current => current?.scopeKey === panelScopeKey
      ? { ...current, name }
      : current);
  }, [panelScopeKey]);
  const panelCapabilities = useMemo<AgentPanelCapabilities>(() => ({
    hasCircleContext: !!circleId,
    hasIdentityAuthority: !!exactIdentityAuthority,
    canCustomize: !!onAppearanceChange,
    hasRuntimeConnection: !!agent && !!runtimeConnectionId,
  }), [agent, circleId, exactIdentityAuthority, onAppearanceChange, runtimeConnectionId]);
  const tabs = useMemo(
    () => agent ? getAgentPanelTabs(agent, panelCapabilities) : [],
    [agent, panelCapabilities],
  );
  const tabGroups = useMemo(() => getAgentPanelGroups(tabs), [tabs]);
  const [panelRoute, setPanelRoute] = useState<{
    scopeKey: string;
    tab: AgentPanelTabKey;
  }>(() => ({ scopeKey: panelScopeKey, tab: 'overview' }));
  // Never expose a prior scope's active route, even for the render before the
  // reset effect commits. The scoped setter similarly captures one authority.
  const panelTab = panelRoute.scopeKey === panelScopeKey ? panelRoute.tab : 'overview';
  const setPanelTab = useCallback((tab: AgentPanelTabKey) => {
    setPanelRoute({ scopeKey: panelScopeKey, tab });
  }, [panelScopeKey]);
  const contentKey = `${panelScopeKey}:${panelTab}`;

  useEffect(() => {
    setPanelRoute(current => current.scopeKey === panelScopeKey
      ? current
      : { scopeKey: panelScopeKey, tab: 'overview' });
  }, [panelScopeKey]);

  useEffect(() => {
    if (!agent) return;
    const nextTab = getFallbackAgentPanelTab(agent, panelTab, panelCapabilities);
    if (nextTab !== panelTab) setPanelTab(nextTab);
  }, [agent, panelCapabilities, panelTab, setPanelTab]);

  const gatewayPanels = useLazyPanelModule<GatewayPanelsModule>(
    panelTab === 'openswan' || panelTab === 'cron',
    loadGatewayPanelsModule,
  );
  const terminalPanels = useLazyPanelModule<TerminalPanelsModule>(panelTab === 'terminal', loadTerminalPanelsModule);
  const memoryPanel = useLazyPanelModule<MemoryPanelModule>(panelTab === 'memory', loadMemoryPanelModule);
  const runsPanel = useLazyPanelModule<RunsPanelModule>(panelTab === 'runs', loadRunsPanelModule);
  const customizePanel = useLazyPanelModule<CustomizePanelModule>(panelTab === 'customize', loadCustomizePanelModule);
  const evolutionPanel = useLazyPanelModule<EvolutionPanelModule>(panelTab === 'evolution', loadEvolutionPanelModule);
  const spiritPanel = useLazyPanelModule<SpiritPanelModule>(panelTab === 'spirit', loadSpiritPanelModule);
  const gatewayPanelsModule = gatewayPanels.module;
  const terminalPanelsModule = terminalPanels.module;
  const memoryPanelModule = memoryPanel.module;
  const runsPanelModule = runsPanel.module;
  const customizePanelModule = customizePanel.module;
  const evolutionPanelModule = evolutionPanel.module;
  const spiritPanelModule = spiritPanel.module;

  // Legacy focused-smoke intent retained while loading is now retryable and
  // generation-fenced:
  // if (!(panelTab === 'openswan' || panelTab === 'cron') || gatewayPanelsModule) return;
  // if (panelTab !== 'terminal' || terminalPanelsModule) return;
  // if (panelTab !== 'memory' || memoryPanelModule) return;

  // Preserve the invoking Office control so closing the pop-up returns keyboard
  // users to the agent they were inspecting. Docked mode is intentionally
  // non-modal and leaves the rest of the Office reachable.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !agent) return;
    const activeElement = document.activeElement;
    const triggerLabel = `Open ${agent.name} agent panel`;
    const findMatchingTriggers = () => Array.from(document.querySelectorAll<HTMLElement>('[aria-label]'))
      .filter(element => element.getAttribute('aria-label') === triggerLabel);
    const matchingTriggers = findMatchingTriggers();
    const exactActiveTrigger = activeElement instanceof HTMLElement
      ? matchingTriggers.find(element => element === activeElement || element.contains(activeElement))
      : null;
    const visibleTrigger = matchingTriggers.find(element => element.offsetParent !== null);
    // Touch-style RN Web presses can leave document.body active. In that case,
    // retain the exact visible semantic opener instead of losing the user's
    // place when the sheet closes.
    returnFocusRef.current = exactActiveTrigger
      || visibleTrigger
      || (activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null);
    return () => {
      let target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (!target?.isConnected) {
        target = findMatchingTriggers().find(element => element.offsetParent !== null) || null;
      }
      if (!target || typeof requestAnimationFrame === 'undefined') return;
      requestAnimationFrame(() => {
        const liveTarget = target?.isConnected
          ? target
          : findMatchingTriggers().find(element => element.offsetParent !== null);
        liveTarget?.focus({ preventScroll: true });
      });
    };
  }, [agent?.id]);

  // ── Keyboard shortcuts + modal focus trap (web only) ─────────────────────
  // ESC         → cancel Rename first; otherwise close panel
  // ⌘/Ctrl + \  → toggle center/side mode
  // Tab/Shift+Tab wraps only in centered pop-up mode. A docked inspector must
  // not make the Office behind it unreachable to keyboard users.
  // Mode toggle is ignored inside editable fields; Escape remains the modal
  // escape hatch unless an IME composition is active.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !agent) return;
    const isEditing = (t: EventTarget | null): boolean => {
      if (!t || !(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.isContentEditable) return true;
      return false;
    };
    const getFocusable = (root: HTMLElement): HTMLElement[] => {
      const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(root.querySelectorAll<HTMLElement>(selector))
        .filter(el => !el.hasAttribute('aria-hidden') && el.offsetParent !== null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (effectivePanelMode === 'center'
        && ev.key.toLowerCase() === 'k'
        && (ev.metaKey || ev.ctrlKey)) {
        // The Circle-level Search shortcut is another modal owner. A centered
        // Agent dialog wins until it closes; never stack two focus traps.
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      if (ev.key === 'Escape') {
        if (ev.isComposing) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (editingRef.current) {
          if (!renameInFlightRef.current) setRenameDraft(null);
        } else {
          onClose();
        }
        return;
      }
      // ⌘\ on Mac, Ctrl+\ elsewhere
      if (ev.key === '\\' && (ev.metaKey || ev.ctrlKey) && !isEditing(ev.target)) {
        ev.preventDefault();
        toggleMode();
        return;
      }
      if (ev.key === 'Tab' && effectivePanelMode === 'center') {
        const root = document.getElementById('uc-agent-panel-root');
        if (!root) return;
        const focusables = getFocusable(root);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        // If focus is outside the panel entirely, pull it in.
        if (!active || !root.contains(active)) {
          ev.preventDefault();
          first.focus();
          return;
        }
        if (ev.shiftKey && active === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    // A docked inspector is supplemental UI, so opening it must not steal focus
    // from the floor. The centered pop-up receives focus after it is mounted.
    const rafId = effectivePanelMode === 'center' ? requestAnimationFrame(() => {
      const root = document.getElementById('uc-agent-panel-root');
      if (!root) return;
      const focusables = getFocusable(root);
      if (focusables.length > 0 && !root.contains(document.activeElement)) {
        focusables[0].focus({ preventScroll: true });
      }
    }) : null;
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [agent, effectivePanelMode, onClose, toggleMode]);

  useEffect(() => {
    let rafId: number | null = null;
    let timerId: any = null;
    const wasOpen = previouslyOpenAgentRef.current !== null;
    const isOpening = !!agent && !wasOpen;
    previouslyOpenAgentRef.current = agent;
    stopPanelAnimation();
    if (agent) {
      // Open: render at full opacity/scale and let CSS keyframes handle the
      // entrance feel on web. The previous Animated.Value-driven scale+fade
      // re-rendered the entire panel tree on every frame and felt laggy.
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
      setBackdropOn(reduceMotion || !isOpening);
      if (!reduceMotion && isOpening && typeof requestAnimationFrame !== 'undefined') {
        rafId = requestAnimationFrame(() => setBackdropOn(true));
      } else if (!reduceMotion && isOpening) {
        timerId = setTimeout(() => setBackdropOn(true), 16);
      }
      // Mobile bottom sheet slide — uses native driver via Animated, fast
      if (!isDesktop) {
        if (reduceMotion || !isOpening) {
          slideAnim.setValue(0);
        } else {
          slideAnim.setValue(400);
          startPanelAnimation(Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: Platform.OS !== 'web',
            tension: 180,
            friction: 20,
          }));
        }
      }
    } else {
      setBackdropOn(false);
      // There is no rendered close frame once the parent clears `agent`.
      // Prepare stable values for the next open instead: web/desktop paints at
      // full opacity, while a motion-enabled compact sheet begins off-screen.
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
      slideAnim.setValue(reduceMotion ? 0 : 400);
    }
    return () => {
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
      if (timerId !== null) clearTimeout(timerId);
      stopPanelAnimation();
    };
  }, [agent, isDesktop, reduceMotion, setBackdropOn, startPanelAnimation, stopPanelAnimation]);

  // Extract sessionKey early so hooks always run in same order
  const sessionKey = agent ? getAgentIdentityKey(agent) : undefined;

  useEffect(() => {
    setRenameDraft(null);
    setRenameBusyScopeKey(null);
    setRemoveBusyScopeKey(null);
    setScopedActionNotice(null);
    renameInFlightRef.current = false;
    removeInFlightRef.current = false;
    renameRequestGenerationRef.current += 1;
    removeRequestGenerationRef.current += 1;
  }, [panelScopeKey]);

  useEffect(() => () => {
    latestPanelScopeKeyRef.current = 'closed';
    renameRequestGenerationRef.current += 1;
    removeRequestGenerationRef.current += 1;
    renameInFlightRef.current = false;
    removeInFlightRef.current = false;
  }, []);

  if (!agent) return null;

  const statusColor = getOfficeStatusColor(agent.status);
  const statusLabel = getOfficeStatusLabel(agent.status);
  const chatAgentId = dbAgentId || agent.id;
  const openAgentInChat = onOpenAgentInChat && chatAgentTargetIdFromOfficeAgentId(chatAgentId)
    ? (draft?: string) => onOpenAgentInChat(chatAgentId, draft)
    : undefined;
  const runtimeIdentityAuthority = exactIdentityAuthority;
  const currentTags = sessionTags?.get(sessionKey!) || [];
  const canRemoveAgent = !!onRemoveAgent
    && !!exactIdentityAuthority
    && !!dbAgentId
    && agent.id !== 'default::blackswan'
    && agent.id !== 'blackswan-default'
    && agent.providerType !== 'blackswan-local';

  return (
    <AgentPanelShell
      agent={agent}
      isDesktop={!!isDesktop}
      panelMode={effectivePanelMode}
      panelGeometry={panelGeometry}
      scaleAnim={scaleAnim}
      opacityAnim={opacityAnim}
      slideAnim={slideAnim}
      reduceMotion={reduceMotion}
      backdropOpacity={backdropOpacity}
      panelTransition={panelTransition}
      statusColor={statusColor}
      statusLabel={statusLabel}
      editing={editing}
      editName={editName}
      setEditName={setEditName}
      onStartRename={() => {
        if (!onRenameAgent || !exactIdentityAuthority || renameInFlightRef.current) return;
        setScopedActionNotice(null);
        setRenameDraft({ scopeKey: panelScopeKey, name: agent.name });
      }}
      onSubmitRename={async () => {
        const normalizedName = editName.trim();
        const capturedAuthority = exactIdentityAuthority;
        const capturedScopeKey = panelScopeKey;
        if (
          !normalizedName
          || !onRenameAgent
          || !capturedAuthority
          || renameInFlightRef.current
          || !isExactIdentityAuthorityCurrent(capturedAuthority)
        ) return;
        renameInFlightRef.current = true;
        const requestGeneration = renameRequestGenerationRef.current + 1;
        renameRequestGenerationRef.current = requestGeneration;
        setRenameBusyScopeKey(capturedScopeKey);
        setScopedActionNotice(null);
        try {
          const receipt = await onRenameAgent(agent, normalizedName);
          if (
            latestPanelScopeKeyRef.current !== capturedScopeKey
            || renameRequestGenerationRef.current !== requestGeneration
            || !isExactIdentityAuthorityCurrent(capturedAuthority)
          ) return;
          if (receipt.error === 'outcome_unknown' || receipt.serverSaved === null) {
            setRenameDraft(null);
            setScopedActionNotice({
              scopeKey: capturedScopeKey,
              kind: 'warning',
              message: 'Agent-name outcome could not be verified. Reload this agent before retrying the rename.',
              actionLabel: 'Reload identity',
              onAction: reloadIdentityForNotice,
            });
            return;
          }
          if (receipt.serverSaved === true && !receipt.localSaved) {
            setRenameDraft(null);
            setScopedActionNotice({
              scopeKey: capturedScopeKey,
              kind: 'warning',
              message: 'Agent name was saved on the server, but this view could not refresh. Reload the identity; do not save the name again.',
              actionLabel: 'Reload identity',
              onAction: reloadIdentityForNotice,
            });
            return;
          }
          if (!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true) {
            setScopedActionNotice({
              scopeKey: capturedScopeKey,
              kind: 'error',
              message: 'Agent name was not saved. Try again.',
            });
            return;
          }
          setRenameDraft(null);
          setScopedActionNotice({
            scopeKey: capturedScopeKey,
            kind: 'success',
            message: 'Agent name saved.',
          });
        } catch (err) {
          console.warn('[AgentPanel] Rename failed:', err);
          if (
            latestPanelScopeKeyRef.current === capturedScopeKey
            && renameRequestGenerationRef.current === requestGeneration
            && isExactIdentityAuthorityCurrent(capturedAuthority)
          ) {
            setScopedActionNotice({
              scopeKey: capturedScopeKey,
              kind: 'error',
              message: 'Agent name was not saved. Try again.',
            });
          }
        } finally {
          if (renameRequestGenerationRef.current === requestGeneration) {
            renameInFlightRef.current = false;
            if (latestPanelScopeKeyRef.current === capturedScopeKey) setRenameBusyScopeKey(null);
          }
        }
      }}
      onCancelRename={() => {
        if (renameInFlightRef.current) return;
        setRenameDraft(null);
      }}
      canRenameAgent={!!onRenameAgent && !!exactIdentityAuthority}
      renameBusy={renameBusy}
      actionNotice={actionNotice}
      onClose={onClose}
      onToggleMode={toggleMode}
      onStartSideResize={startSideResize}
      onResizeSideBy={resizeSideBy}
      canRemoveAgent={canRemoveAgent}
      removingAgent={removingAgent}
      onRemoveAgent={async () => {
        const capturedAuthority = exactIdentityAuthority;
        const capturedScopeKey = panelScopeKey;
        if (
          removeInFlightRef.current
          || !onRemoveAgent
          || !capturedAuthority
          || !isExactIdentityAuthorityCurrent(capturedAuthority)
        ) return;
        removeInFlightRef.current = true;
        const requestGeneration = removeRequestGenerationRef.current + 1;
        removeRequestGenerationRef.current = requestGeneration;
        try {
          const confirmed = await showConfirm({
            title: `Remove ${agent.name} from this Office?`,
            message: 'This removes the published Office agent. It does not stop a local runtime or delete its files.',
            confirmLabel: 'Remove agent',
            destructive: true,
          });
          if (
            !confirmed
            || latestPanelScopeKeyRef.current !== capturedScopeKey
            || removeRequestGenerationRef.current !== requestGeneration
            || !isExactIdentityAuthorityCurrent(capturedAuthority)
          ) return;
          setRemoveBusyScopeKey(capturedScopeKey);
          setScopedActionNotice(null);
          const removed = await onRemoveAgent(agent);
          if (
            latestPanelScopeKeyRef.current !== capturedScopeKey
            || removeRequestGenerationRef.current !== requestGeneration
            || !isExactIdentityAuthorityCurrent(capturedAuthority)
          ) return;
          if (removed !== true) {
            setScopedActionNotice({
              scopeKey: capturedScopeKey,
              kind: 'error',
              message: 'Agent could not be removed. Try again.',
            });
            return;
          }
          onClose();
        } catch (err) {
          console.warn('[AgentPanel] Agent removal failed:', err);
          if (
            latestPanelScopeKeyRef.current === capturedScopeKey
            && removeRequestGenerationRef.current === requestGeneration
            && isExactIdentityAuthorityCurrent(capturedAuthority)
          ) {
            setScopedActionNotice({
              scopeKey: capturedScopeKey,
              kind: 'error',
              message: 'Agent could not be removed. Try again.',
            });
          }
        } finally {
          if (removeRequestGenerationRef.current === requestGeneration) {
            removeInFlightRef.current = false;
            if (latestPanelScopeKeyRef.current === capturedScopeKey) setRemoveBusyScopeKey(null);
          }
        }
      }}
      tabs={tabs}
      tabGroups={tabGroups}
      panelTab={panelTab}
      setPanelTab={setPanelTab}
      contentKey={contentKey}
    >

      {/* ── OVERVIEW TAB — one-stop agent command center ── */}
      {panelTab === 'overview' && (
        <AgentOverviewPanel
          key={`${exactIdentityAuthority?.userId || 'locked'}::${exactIdentityAuthority?.circleId || circleId || 'none'}::${agent.id}`}
          agent={agent}
          circleId={circleId}
          runtimeConnectionId={runtimeConnectionId}
          identityAuthority={exactIdentityAuthority}
          isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
          onClose={onClose}
          onAgentIdentityChange={onAgentIdentityChange}
          onRunCommand={onRunCommand}
          onOpenInChat={openAgentInChat}
        />
      )}

      {panelTab === 'openswan' && runtimeConnectionId && (agent.providerType === 'openswan' || agent.providerType === 'blackswan-local') && (
        gatewayPanelsModule?.OpenSwanFrontendPanel ? (
          <gatewayPanelsModule.OpenSwanFrontendPanel
            key={`${runtimeConnectionId}::${agent.sessionKey}`}
            agent={agent}
            accentColor={agent.color || '#6366f1'}
            circleId={circleId}
            userId={userId || undefined}
            runtimeConnectionId={runtimeConnectionId}
            identityAuthority={runtimeIdentityAuthority}
            isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
            onOpenInChat={openAgentInChat}
          />
        ) : (
          <LazySectionState
            label="OpenSwan runtime"
            status={gatewayPanels.status === 'ready' ? 'error' : gatewayPanels.status}
            accentColor={agent.color || '#6366f1'}
            onRetry={gatewayPanels.retry}
          />
        )
      )}

      {/* ── TERMINAL TAB — Remote Shell + AI Terminal ── */}
      {panelTab === 'terminal' && (
        <>
          {terminalPanelsModule?.AgentTerminalProfilePanel && (
            <terminalPanelsModule.AgentTerminalProfilePanel
              key={`${exactIdentityAuthority?.userId || 'locked'}::${exactIdentityAuthority?.circleId || circleId || 'none'}::${agent.id}`}
              agent={agent}
              circleId={circleId}
              identityAuthority={exactIdentityAuthority}
              isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
              onIdentityChange={onAgentIdentityChange}
              onOpenInChat={openAgentInChat}
            />
          )}
          {agent.providerType === 'claude-code' && onRunCommand && terminalPanelsModule?.AgentRemoteShell && (
            <terminalPanelsModule.AgentRemoteShell onRunCommand={onRunCommand} />
          )}
          {circleId && terminalPanelsModule?.AgentQuickTerminal && (
            <terminalPanelsModule.AgentQuickTerminal
              key={`${exactIdentityAuthority?.userId || 'locked'}::${exactIdentityAuthority?.circleId || circleId}::${agent.id}::${agent.sessionKey}`}
              agentName={agent.name}
              circleId={circleId}
              identityAuthority={exactIdentityAuthority}
              isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
              onOpenInChat={openAgentInChat}
            />
          )}
          {!terminalPanelsModule && (
            <LazySectionState
              label="Terminal"
              status={terminalPanels.status}
              accentColor={agent.color || '#6366f1'}
              onRetry={terminalPanels.retry}
            />
          )}
        </>
      )}

      {/* ── EVOLUTION TAB ── */}
      {panelTab === 'evolution' && (
        evolutionPanelModule?.default ? (
          <evolutionPanelModule.default
            key={panelScopeKey}
            agentId={dbAgentId || agent.id}
            agentAliases={agentSubject?.runAgentAliases || [agent.id]}
            agentName={agent.name}
            accentColor={agent.color || '#6366f1'}
            circleId={circleId}
            userId={userId}
            identityAuthority={runtimeIdentityAuthority}
            isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
          />
        ) : (
          <LazySectionState
            label="XP and achievements"
            status={evolutionPanel.status === 'ready' ? 'error' : evolutionPanel.status}
            accentColor={agent.color || '#6366f1'}
            onRetry={evolutionPanel.retry}
          />
        )
      )}

      {/* ── SPIRIT TAB ── */}
      {panelTab === 'spirit' && (
        spiritPanelModule?.default ? (
          <spiritPanelModule.default
            key={`${exactIdentityAuthority?.userId || 'locked'}::${exactIdentityAuthority?.circleId || circleId || 'none'}::${agent.id}`}
            agent={agent}
            circleId={circleId}
            sessionKey={sessionKey}
            onAgentIdentityChange={onAgentIdentityChange}
            currentTags={currentTags}
            onAddSessionTag={onAddSessionTag}
            onRemoveSessionTag={onRemoveSessionTag}
            sessionStorageScope={sessionStorageScope}
            identityAuthority={exactIdentityAuthority}
            isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
            onOpenInChat={openAgentInChat}
          />
        ) : (
          <LazySectionState
            label="Spirit"
            status={spiritPanel.status === 'ready' ? 'error' : spiritPanel.status}
            accentColor={agent.color || '#6366f1'}
            onRetry={spiritPanel.retry}
          />
        )
      )}
      {/* ── MEMORY TAB — view and edit agent memories ── */}
      {panelTab === 'memory' && circleId && (
        <View nativeID="section-agent-memory" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {memoryPanelModule?.default ? (
            <memoryPanelModule.default
              key={panelScopeKey}
              circleId={circleId}
              userId={userId || undefined}
              agentId={agentSubject?.memoryAgentId || agent.id}
              agentAliases={agentSubject?.memoryAgentAliases || [agent.id]}
              agentName={agent.name}
              accentColor={agent.color || '#6366f1'}
              identityAuthority={exactIdentityAuthority}
              isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
              onOpenInChat={openAgentInChat}
            />
          ) : (
            <LazySectionState
              label="Memory"
              status={memoryPanel.status === 'ready' ? 'error' : memoryPanel.status}
              accentColor={agent.color || '#6366f1'}
              onRetry={memoryPanel.retry}
            />
          )}
        </View>
      )}

      {/* ── RUNS TAB — recent agent runs and their status ── */}
      {panelTab === 'runs' && circleId && (
        <View nativeID="section-agent-runs" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {runsPanelModule?.default ? (
            <runsPanelModule.default
              key={panelScopeKey}
              circleId={circleId}
              agentId={agentSubject?.runAgentId || agent.id}
              agentAliases={agentSubject?.runAgentAliases || [agent.id]}
              agentName={agent.name}
              accentColor={agent.color || '#6366f1'}
              identityAuthority={runtimeIdentityAuthority}
              isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
            />
          ) : (
            <LazySectionState
              label="Runs"
              status={runsPanel.status === 'ready' ? 'error' : runsPanel.status}
              accentColor={agent.color || '#6366f1'}
              onRetry={runsPanel.retry}
            />
          )}
        </View>
      )}

      {/* ── CRON JOBS TAB ── */}
      {panelTab === 'cron' && circleId && runtimeConnectionId && (
        <View nativeID="section-agent-cron" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {gatewayPanelsModule?.CronJobsPanel ? (
            <gatewayPanelsModule.CronJobsPanel
              agent={agent}
              circleId={circleId}
              accentColor={agent.color || '#6366f1'}
              runtimeConnectionId={runtimeConnectionId}
              identityAuthority={runtimeIdentityAuthority}
              isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}
            />
          ) : (
            <LazySectionState
              label="Cron jobs"
              status={gatewayPanels.status === 'ready' ? 'error' : gatewayPanels.status}
              accentColor={agent.color || '#6366f1'}
              onRetry={gatewayPanels.retry}
            />
          )}
        </View>
      )}

      {/* ── ACTIVITY TAB — comprehensive agent telemetry ── */}
      {panelTab === 'activity' && (
        <AgentActivityPanel agent={agent} statusColor={statusColor} statusLabel={statusLabel} />
      )}

      {panelTab === 'customize' && onAppearanceChange && (
        customizePanelModule?.default ? (
          <customizePanelModule.default
            key={panelScopeKey}
            agent={agent}
            appearances={appearances}
            onAppearanceChange={onAppearanceChange}
            onIdentityRefresh={onAgentIdentityChange}
            environmentType={environmentType}
            reduceMotion={reduceMotion}
          />
        ) : (
          <LazySectionState
            label="Customize"
            status={customizePanel.status === 'ready' ? 'error' : customizePanel.status}
            accentColor={agent.color || '#6366f1'}
            onRetry={customizePanel.retry}
          />
        )
      )}

    </AgentPanelShell>
  );
}
