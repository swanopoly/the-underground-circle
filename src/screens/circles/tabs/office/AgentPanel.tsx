import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Platform, ActivityIndicator } from 'react-native';
import { getAgentIdentityKey } from '../../../../lib/agentIdentity';
import { OfficeAgent, getOfficeStatusColor, getOfficeStatusLabel } from '../../../../lib/officeAgents';
import { SessionTag } from '../../../../lib/sessionTags';
import AgentPanelShell from './AgentPanelShell';
import { getAgentPanelTabs, getFallbackAgentPanelTab, type AgentPanelTabKey } from './AgentPanelTabs';
import { useAgentPanelLayout } from './useAgentPanelLayout';
import AgentOverviewPanel from './AgentOverviewPanel';
import AgentActivityPanel from './AgentActivityPanel';
import {
  AgentAppearance, EnvironmentType,
} from '../../../../lib/officeConfig';
import { supabase } from '../../../../lib/supabase';
import { buildAgentRuntimeSubject } from '../../../../lib/agentRuntimeSubject';
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
  circleId?: string;
  appearances?: Record<string, AgentAppearance>;
  onAppearanceChange?: (id: string, appearance: AgentAppearance) => void;
  environmentType?: EnvironmentType;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
  popoutOrigin?: { x: number; y: number } | null;  // click origin for pop-out animation
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
  sessionTags, onAddSessionTag, onRemoveSessionTag, circleId,
  appearances, onAppearanceChange, environmentType, onRunCommand, popoutOrigin,
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
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [panelTab, setPanelTab] = useState<AgentPanelTabKey>('overview');
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => setUserId(data.user?.id || null))
      .catch(err => console.warn('[AgentPanel] Failed to resolve auth user:', err));
  }, []);
  const [dbAgentId, setDbAgentId] = useState<string | null>(null);
  const [removingAgent, setRemovingAgent] = useState(false);
  const [gatewayPanelsModule, setGatewayPanelsModule] = useState<GatewayPanelsModule | null>(null);
  const [terminalPanelsModule, setTerminalPanelsModule] = useState<TerminalPanelsModule | null>(null);
  const [memoryPanelModule, setMemoryPanelModule] = useState<MemoryPanelModule | null>(null);
  const [runsPanelModule, setRunsPanelModule] = useState<RunsPanelModule | null>(null);
  const [customizePanelModule, setCustomizePanelModule] = useState<CustomizePanelModule | null>(null);
  const [evolutionPanelModule, setEvolutionPanelModule] = useState<EvolutionPanelModule | null>(null);
  const [spiritPanelModule, setSpiritPanelModule] = useState<SpiritPanelModule | null>(null);

  // Open: pure CSS keyframe (see openAnimClass below) — no JS-driven Animated.
  // Close: Animated.Value 1 → 0 because the parent unmounts on `agent === null`
  // and we want the fade-out to finish before the panel disappears.
  // Initialize at 1/1 so the open frame paints fully visible immediately.
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const isOverviewTabActive = panelTab === 'overview';
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

  useEffect(() => {
    if (!agent) return;
    // Speculative warm-up of tab chunks during idle time — a failure here is
    // harmless (the real on-demand loader will retry), but we still log once
    // per chunk so persistent failures (network, deploy mismatch) are visible.
    const warmCatch = (label: string) => (err: unknown) =>
      console.warn(`[AgentPanel] Warm-up import failed (${label}):`, err);
    const warmModules = () => {
      if (!memoryPanelModule) import('./AgentMemoryPanel').then(setMemoryPanelModule).catch(warmCatch('AgentMemoryPanel'));
      if (!spiritPanelModule) import('./AgentSpiritPanel').then(setSpiritPanelModule).catch(warmCatch('AgentSpiritPanel'));
      if (!runsPanelModule) import('./AgentRunsPanel').then(setRunsPanelModule).catch(warmCatch('AgentRunsPanel'));
      if (!gatewayPanelsModule && (agent.providerType === 'openswan' || agent.providerType === 'blackswan-local')) {
        import('./AgentGatewayPanels').then(setGatewayPanelsModule).catch(warmCatch('AgentGatewayPanels'));
      }
    };
    const idleHost = globalThis as any;
    if (typeof idleHost.requestIdleCallback === 'function') {
      const id = idleHost.requestIdleCallback(() => warmModules(), { timeout: 500 });
      return () => {
        if (typeof idleHost.cancelIdleCallback === 'function') {
          idleHost.cancelIdleCallback(id);
        }
      };
    }
    const timeoutId = setTimeout(warmModules, 120);
    return () => clearTimeout(timeoutId);
  }, [agent, gatewayPanelsModule, memoryPanelModule, runsPanelModule, spiritPanelModule]);

  // ── Keyboard shortcuts + focus trap (web only, while panel is open) ───────
  // ESC         → close panel
  // ⌘/Ctrl + \  → toggle center/side mode
  // Tab/Shift+Tab inside the panel wraps within the panel's focusable elements
  // so keyboard users can't accidentally tab into the backdrop/app behind it.
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
      if (ev.key === '\\' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        toggleMode();
        return;
      }
      if (ev.key === 'Tab') {
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
    // Move focus into the panel on open so the trap has something to cycle.
    // requestAnimationFrame defers one frame so the panel is actually in the DOM.
    const rafId = requestAnimationFrame(() => {
      const root = document.getElementById('uc-agent-panel-root');
      if (!root) return;
      const focusables = getFocusable(root);
      if (focusables.length > 0 && !root.contains(document.activeElement)) {
        focusables[0].focus({ preventScroll: true });
      }
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(rafId);
    };
  }, [agent, onClose, toggleMode]);

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

  // Load or create DB agent row when panel opens
  const ensureDbAgent = useCallback(async (): Promise<string | null> => {
    if (dbAgentId) return dbAgentId;
    if (!agent || !circleId) return null;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    // Try to find existing row
    const { data } = await supabase
      .from('circle_office_agents')
      .select('id, spirit, spirit_emoji')
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .ilike('name', agent.name)
      .maybeSingle();
    if (data) {
      setDbAgentId(data.id);
      return data.id;
    }
    // Auto-create if missing
    const { data: created, error } = await supabase
      .from('circle_office_agents')
      .upsert({
        circle_id: circleId,
        owner_id: auth.user.id,
        name: agent.name,
        provider: agent.providerType || 'claude-code',
        status: agent.status || 'idle',
        color: agent.color || '#6366f1',
      }, { onConflict: 'circle_id,owner_id,name' })
      .select('id')
      .single();
    if (created && !error) {
      setDbAgentId(created.id);
      return created.id;
    }
    return null;
  }, [dbAgentId, agent, circleId]);

  useEffect(() => {
    setDbAgentId(null);
    setEditing(false);
    setEditName('');
  }, [agent?.id]);

  useEffect(() => {
    if (!(isOverviewTabActive || panelTab === 'memory' || panelTab === 'runs' || panelTab === 'evolution' || !!onRemoveAgent)) return;
    ensureDbAgent();
  }, [ensureDbAgent, isOverviewTabActive, onRemoveAgent, panelTab]);

  const tabs = agent ? getAgentPanelTabs(agent) : [];

  if (!agent) return null;

  const statusColor = getOfficeStatusColor(agent.status);
  const statusLabel = getOfficeStatusLabel(agent.status).toUpperCase();
  const currentTags = sessionTags?.get(sessionKey!) || [];
  const canRemoveAgent = !!onRemoveAgent && !!dbAgentId && agent.id !== 'default::blackswan';

  return (
    <AgentPanelShell
      agent={agent}
      isDesktop={!!isDesktop}
      panelMode={panelMode}
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
        if (!onRenameAgent) return;
        setEditName(agent.name);
        setEditing(true);
      }}
      onSubmitRename={() => {
        if (editName.trim() && onRenameAgent) onRenameAgent(agent, editName.trim());
        setEditing(false);
      }}
      onCancelRename={() => setEditing(false)}
      onClose={onClose}
      onToggleMode={toggleMode}
      onStartSideResize={startSideResize}
      canRemoveAgent={canRemoveAgent}
      removingAgent={removingAgent}
      onRemoveAgent={async () => {
        if (removingAgent || !onRemoveAgent) return;
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
          agent={agent}
          circleId={circleId}
          userId={userId}
          statusColor={statusColor}
          statusLabel={statusLabel}
          onClose={onClose}
          onRenameAgent={onRenameAgent}
          onAgentIdentityChange={onAgentIdentityChange}
          onRunCommand={onRunCommand}
        />
      )}

      {panelTab === 'openswan' && (agent.providerType === 'openswan' || agent.providerType === 'blackswan-local') && (
        gatewayPanelsModule?.OpenSwanFrontendPanel ? (
          <gatewayPanelsModule.OpenSwanFrontendPanel
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
              agent={agent}
              circleId={circleId}
              userId={userId}
              onRenameAgent={onRenameAgent}
              onIdentityChange={onAgentIdentityChange}
            />
          )}
          {onRunCommand && terminalPanelsModule?.AgentRemoteShell && (
            <terminalPanelsModule.AgentRemoteShell onRunCommand={onRunCommand} />
          )}
          {circleId && terminalPanelsModule?.AgentQuickTerminal && (
            <terminalPanelsModule.AgentQuickTerminal
              agentName={agent.name}
              agentId={agent.id}
              circleId={circleId}
              providerType={agent.providerType}
              sessionKey={agent.sessionKey}
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
            agent={agent}
            circleId={circleId}
            sessionKey={sessionKey}
            onAgentIdentityChange={onAgentIdentityChange}
            currentTags={currentTags}
            onAddSessionTag={onAddSessionTag}
            onRemoveSessionTag={onRemoveSessionTag}
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
