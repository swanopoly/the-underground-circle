import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Platform, ActivityIndicator } from 'react-native';
import { getAgentIdentityKey, type AgentIdentityExactAuthority } from '../../../../lib/agentIdentity';
import { OfficeAgent, getOfficeStatusColor, getOfficeStatusLabel } from '../../../../lib/officeAgents';
import { SessionTag, type OfficeSessionStorageScope } from '../../../../lib/sessionTags';
import AgentPanelShell from './AgentPanelShell';
import { getAgentPanelTabs, getFallbackAgentPanelTab, type AgentPanelTabKey } from './AgentPanelTabs';
import { useAgentPanelLayout } from './useAgentPanelLayout';
import AgentOverviewPanel from './AgentOverviewPanel';
import AgentActivityPanel from './AgentActivityPanel';
import {
  AgentAppearance, EnvironmentType,
} from '../../../../lib/officeConfig';
import { buildAgentRuntimeSubject, isUuidLike } from '../../../../lib/agentRuntimeSubject';
import { showConfirm } from '../../../../lib/alert';
interface Props {
  agent: OfficeAgent | null;
  onClose: () => void;
  isDesktop?: boolean;
  onRenameAgent?: (agent: OfficeAgent, newName: string) => Promise<void> | void;
  onAgentIdentityChange?: () => void;
  onRemoveAgent?: (agent: OfficeAgent) => Promise<void> | void;
  sessionTags?: Map<string, SessionTag[]>;
  onAddSessionTag?: (sessionKey: string, tag: SessionTag) => void;
  onRemoveSessionTag?: (sessionKey: string, tagKey: string) => void;
  sessionStorageScope?: OfficeSessionStorageScope;
  circleId?: string;
  identityAuthority?: AgentIdentityExactAuthority | null;
  appearances?: Record<string, AgentAppearance>;
  onAppearanceChange?: (id: string, appearance: AgentAppearance) => void;
  environmentType?: EnvironmentType;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}

type GatewayPanelsModule = typeof import('./AgentGatewayPanels');
type TerminalPanelsModule = typeof import('./AgentTerminalPanels');
type MemoryPanelModule = typeof import('./AgentMemoryPanel');
type RunsPanelModule = typeof import('./AgentRunsPanel');
type CustomizePanelModule = typeof import('./AgentCustomizePanel');
type EvolutionPanelModule = typeof import('./AgentEvolutionPanel');
type SpiritPanelModule = typeof import('./AgentSpiritPanel');

// ── SECTION: agent-remote-shell — Run shell commands on the agent's machine ──

// ═════════════════════════════════════════════════════════════════════════════

export default function AgentPanel({
  agent, onClose, isDesktop, onRenameAgent,
  onAgentIdentityChange,
  onRemoveAgent,
  sessionTags, onAddSessionTag, onRemoveSessionTag, sessionStorageScope, circleId,
  identityAuthority,
  appearances, onAppearanceChange, environmentType, onRunCommand,
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
  } = useAgentPanelLayout();
  // A saved desktop dock preference must never turn the compact bottom sheet
  // into a non-modal inspector. Keep the preference for the next desktop
  // visit, but use centered dialog semantics at compact widths.
  const effectivePanelMode = isDesktop ? panelMode : 'center';
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [panelTab, setPanelTab] = useState<AgentPanelTabKey>('overview');
  // Office supplies one immutable user/circle/bearer snapshot. Never recover
  // a replacement identity authority from the mutable global auth client.
  const exactIdentityAuthority = useMemo<AgentIdentityExactAuthority | null>(() => {
    const userId = identityAuthority?.userId?.trim();
    const authorityCircleId = identityAuthority?.circleId?.trim();
    const accessToken = identityAuthority?.accessToken?.trim();
    if (!userId || !circleId || !authorityCircleId || authorityCircleId !== circleId || !accessToken) return null;
    return { userId, circleId: authorityCircleId, accessToken };
  }, [
    circleId,
    identityAuthority?.accessToken,
    identityAuthority?.circleId,
    identityAuthority?.userId,
  ]);
  const userId = exactIdentityAuthority?.userId || null;
  const [removingAgent, setRemovingAgent] = useState(false);
  const [gatewayPanelsModule, setGatewayPanelsModule] = useState<GatewayPanelsModule | null>(null);
  const [terminalPanelsModule, setTerminalPanelsModule] = useState<TerminalPanelsModule | null>(null);
  const [memoryPanelModule, setMemoryPanelModule] = useState<MemoryPanelModule | null>(null);
  const [runsPanelModule, setRunsPanelModule] = useState<RunsPanelModule | null>(null);
  const [customizePanelModule, setCustomizePanelModule] = useState<CustomizePanelModule | null>(null);
  const [evolutionPanelModule, setEvolutionPanelModule] = useState<EvolutionPanelModule | null>(null);
  const [spiritPanelModule, setSpiritPanelModule] = useState<SpiritPanelModule | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Open: pure CSS keyframe (see openAnimClass below) — no JS-driven Animated.
  // Close: Animated.Value 1 → 0 because the parent unmounts on `agent === null`
  // and we want the fade-out to finish before the panel disappears.
  // Initialize at 1/1 so the open frame paints fully visible immediately.
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
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

  useEffect(() => {
    if (!agent) return;
    const nextTab = getFallbackAgentPanelTab(agent, panelTab);
    if (nextTab !== panelTab) setPanelTab(nextTab);
  }, [agent, panelTab]);

  useEffect(() => {
    if (!(panelTab === 'openswan' || panelTab === 'cron') || gatewayPanelsModule) return;
    import('./AgentGatewayPanels').then(setGatewayPanelsModule).catch(err => console.warn('[AgentPanel] Failed to load AgentGatewayPanels chunk:', err));
  }, [gatewayPanelsModule, panelTab]);

  useEffect(() => {
    if (panelTab !== 'terminal' || terminalPanelsModule) return;
    import('./AgentTerminalPanels').then(setTerminalPanelsModule).catch(err => console.warn('[AgentPanel] Failed to load AgentTerminalPanels chunk:', err));
  }, [panelTab, terminalPanelsModule]);

  useEffect(() => {
    if (panelTab !== 'memory' || memoryPanelModule) return;
    import('./AgentMemoryPanel').then(setMemoryPanelModule).catch(err => console.warn('[AgentPanel] Failed to load AgentMemoryPanel chunk:', err));
  }, [memoryPanelModule, panelTab]);

  useEffect(() => {
    if (panelTab !== 'runs' || runsPanelModule) return;
    import('./AgentRunsPanel').then(setRunsPanelModule).catch(err => console.warn('[AgentPanel] Failed to load AgentRunsPanel chunk:', err));
  }, [panelTab, runsPanelModule]);

  useEffect(() => {
    if (panelTab !== 'customize' || customizePanelModule) return;
    import('./AgentCustomizePanel').then(setCustomizePanelModule).catch(err => console.warn('[AgentPanel] Failed to load AgentCustomizePanel chunk:', err));
  }, [customizePanelModule, panelTab]);

  useEffect(() => {
    if (panelTab !== 'evolution' || evolutionPanelModule) return;
    import('./AgentEvolutionPanel').then(setEvolutionPanelModule).catch(err => console.warn('[AgentPanel] Failed to load AgentEvolutionPanel chunk:', err));
  }, [evolutionPanelModule, panelTab]);

  useEffect(() => {
    if (panelTab !== 'spirit' || spiritPanelModule) return;
    import('./AgentSpiritPanel').then(setSpiritPanelModule).catch(err => console.warn('[AgentPanel] Failed to load AgentSpiritPanel chunk:', err));
  }, [panelTab, spiritPanelModule]);

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
  // ESC         → close panel
  // ⌘/Ctrl + \  → toggle center/side mode
  // Tab/Shift+Tab wraps only in centered pop-up mode. A docked inspector must
  // not make the Office behind it unreachable to keyboard users.
  // Ignored when focus is inside an editable element for ESC/mode toggle so
  // typing isn't disrupted (Tab trap still applies).
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
      if (ev.key === 'Escape' && !isEditing(ev.target)) {
        ev.preventDefault();
        onClose();
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
    window.addEventListener('keydown', onKey);
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
      window.removeEventListener('keydown', onKey);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [agent, effectivePanelMode, onClose, toggleMode]);

  useEffect(() => {
    let rafId: number | null = null;
    let timerId: any = null;
    if (agent) {
      // Open: render at full opacity/scale and let CSS keyframes handle the
      // entrance feel on web. The previous Animated.Value-driven scale+fade
      // re-rendered the entire panel tree on every frame and felt laggy.
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
      setBackdropOn(false);
      if (typeof requestAnimationFrame !== 'undefined') {
        rafId = requestAnimationFrame(() => setBackdropOn(true));
      } else {
        timerId = setTimeout(() => setBackdropOn(true), 16);
      }
      // Mobile bottom sheet slide — uses native driver via Animated, fast
      if (!isDesktop) {
        slideAnim.setValue(400);
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: Platform.OS !== 'web',
          tension: 180,
          friction: 20,
        }).start();
      }
    } else {
      setBackdropOn(false);
      // Close: brief Animated fade so the panel doesn't snap-disappear before
      // the parent unmounts it. ~80ms is short enough not to feel laggy.
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 0.97, duration: 80, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 80, useNativeDriver: Platform.OS !== 'web' }),
      ]).start();
      if (!isDesktop) {
        Animated.timing(slideAnim, { toValue: 400, duration: 120, useNativeDriver: Platform.OS !== 'web' }).start();
      }
    }
    return () => {
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [agent, isDesktop]);

  // Extract sessionKey early so hooks always run in same order
  const sessionKey = agent ? getAgentIdentityKey(agent) : undefined;

  useEffect(() => {
    setEditing(false);
    setEditName('');
  }, [agent?.id]);

  const tabs = agent ? getAgentPanelTabs(agent) : [];

  if (!agent) return null;

  const statusColor = getOfficeStatusColor(agent.status);
  const statusLabel = getOfficeStatusLabel(agent.status);
  const currentTags = sessionTags?.get(sessionKey!) || [];
  const canRemoveAgent = !!onRemoveAgent
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
      backdropOpacity={backdropOpacity}
      panelTransition={panelTransition}
      statusColor={statusColor}
      statusLabel={statusLabel}
      editing={editing}
      editName={editName}
      setEditName={setEditName}
      onStartRename={() => {
        if (!onRenameAgent || !exactIdentityAuthority) return;
        setEditName(agent.name);
        setEditing(true);
      }}
      onSubmitRename={() => {
        if (editName.trim() && onRenameAgent && exactIdentityAuthority) onRenameAgent(agent, editName.trim());
        setEditing(false);
      }}
      onCancelRename={() => setEditing(false)}
      canRenameAgent={!!onRenameAgent && !!exactIdentityAuthority}
      onClose={onClose}
      onToggleMode={toggleMode}
      onStartSideResize={startSideResize}
      canRemoveAgent={canRemoveAgent}
      removingAgent={removingAgent}
      onRemoveAgent={async () => {
        if (removingAgent || !onRemoveAgent) return;
        const confirmed = await showConfirm({
          title: `Remove ${agent.name} from this Office?`,
          message: 'This removes the published Office agent. It does not stop a local runtime or delete its files.',
          confirmLabel: 'Remove agent',
          destructive: true,
        });
        if (!confirmed) return;
        setRemovingAgent(true);
        try {
          await onRemoveAgent(agent);
        } finally {
          setRemovingAgent(false);
        }
      }}
      tabs={tabs}
      panelTab={panelTab}
      setPanelTab={setPanelTab}
    >

      {/* ── OVERVIEW TAB — one-stop agent command center ── */}
      {panelTab === 'overview' && (
        <AgentOverviewPanel
          key={`${exactIdentityAuthority?.userId || 'locked'}::${exactIdentityAuthority?.circleId || circleId || 'none'}::${agent.id}`}
          agent={agent}
          circleId={circleId}
          identityAuthority={exactIdentityAuthority}
          onClose={onClose}
          onRenameAgent={onRenameAgent}
          onAgentIdentityChange={onAgentIdentityChange}
          onRunCommand={onRunCommand}
        />
      )}

      {panelTab === 'openswan' && (agent.providerType === 'openswan' || agent.providerType === 'blackswan-local') && (
        gatewayPanelsModule?.OpenSwanFrontendPanel ? (
          <gatewayPanelsModule.OpenSwanFrontendPanel
            key={`${agent.connectionId}::${agent.sessionKey}`}
            agent={agent}
            accentColor={agent.color || '#6366f1'}
            circleId={circleId}
            userId={userId || undefined}
          />
        ) : (
          <View style={{ paddingHorizontal: 12, paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
          </View>
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
              onRenameAgent={onRenameAgent}
              onIdentityChange={onAgentIdentityChange}
            />
          )}
          {onRunCommand && terminalPanelsModule?.AgentRemoteShell && (
            <terminalPanelsModule.AgentRemoteShell onRunCommand={onRunCommand} />
          )}
          {circleId && terminalPanelsModule?.AgentQuickTerminal && (
            <terminalPanelsModule.AgentQuickTerminal
              key={`${exactIdentityAuthority?.userId || 'locked'}::${exactIdentityAuthority?.circleId || circleId}::${agent.id}::${agent.sessionKey}`}
              agentName={agent.name}
              agentId={agent.id}
              circleId={circleId}
              providerType={agent.providerType}
              sessionKey={agent.sessionKey}
              identityAuthority={exactIdentityAuthority}
            />
          )}
          {!terminalPanelsModule && (
            <View style={{ paddingHorizontal: 12, paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
            </View>
          )}
        </>
      )}

      {/* ── EVOLUTION TAB ── */}
      {panelTab === 'evolution' && (
        evolutionPanelModule?.default ? (
          <evolutionPanelModule.default
            agentId={dbAgentId || agent.id}
            agentName={agent.name}
            accentColor={agent.color || '#6366f1'}
            circleId={circleId}
            userId={userId}
          />
        ) : (
          <View style={{ paddingHorizontal: 12, paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
          </View>
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
          />
        ) : (
          <View style={{ paddingHorizontal: 12, paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
          </View>
        )
      )}
      {/* ── MEMORY TAB — view and edit agent memories ── */}
      {panelTab === 'memory' && circleId && (
        <View nativeID="section-agent-memory" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {memoryPanelModule?.default ? (
            <memoryPanelModule.default
              circleId={circleId}
              userId={userId || undefined}
              agentId={agentSubject?.memoryAgentId || agent.id}
              agentAliases={agentSubject?.memoryAgentAliases || [agent.id]}
              agentName={agent.name}
              accentColor={agent.color || '#6366f1'}
            />
          ) : (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
            </View>
          )}
        </View>
      )}

      {/* ── RUNS TAB — recent agent runs and their status ── */}
      {panelTab === 'runs' && circleId && (
        <View nativeID="section-agent-runs" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {runsPanelModule?.default ? (
            <runsPanelModule.default
              circleId={circleId}
              agentId={agentSubject?.runAgentId || agent.id}
              agentAliases={agentSubject?.runAgentAliases || [agent.id]}
              agentName={agent.name}
              accentColor={agent.color || '#6366f1'}
            />
          ) : (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
            </View>
          )}
        </View>
      )}

      {/* ── CRON JOBS TAB ── */}
      {panelTab === 'cron' && circleId && (
        <View nativeID="section-agent-cron" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {gatewayPanelsModule?.CronJobsPanel ? (
            <gatewayPanelsModule.CronJobsPanel agent={agent} circleId={circleId} accentColor={agent.color || '#6366f1'} />
          ) : (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
            </View>
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
            agent={agent}
            appearances={appearances}
            onAppearanceChange={onAppearanceChange}
            environmentType={environmentType}
          />
        ) : (
          <View style={{ paddingHorizontal: 12, paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={agent.color || '#6366f1'} />
          </View>
        )
      )}

    </AgentPanelShell>
  );
}
