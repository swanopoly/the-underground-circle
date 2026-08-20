import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import FlatIcon from '../../components/FlatIcon';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Animated,
  useWindowDimensions,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import type { CircleIntegrationGroupKey } from '../../lib/circleIntegrationCatalog';
import TutorialController from '../../components/onboarding/TutorialController';

import { Circle } from '../../types';
import ErrorBoundary from '../../components/ErrorBoundary';
import { LoadingScreen } from '../../components/LoadingWave';
import { recordWorkspaceTabVisit } from '../../lib/workspaceAdaptation';
import { ROOM_WORKSPACE_OPEN_EVENT } from '../../lib/roomWorkspaceLauncher';
import { rememberLastProfileCircle } from '../../lib/profileNavigation';
import { safeGetUser } from '../../lib/authSession';
import { OWNER_EMAIL } from '../../lib/officeConfig';
import { decodeEntityHandle, encodeEntityHandle } from '../../lib/entityHandleCore';
import { normalizeChatAgentFocusDraft } from '../../lib/chatAgentTargets';

// ─── Inject CSS animation for tab dot pulse (web only) ───────────────────
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('uc-tab-dot-css')) {
  const style = document.createElement('style');
  style.id = 'uc-tab-dot-css';
  style.textContent = `
    @keyframes uc-tab-dot-pulse {
      0%, 100% { transform: scaleX(1); opacity: 0.8; }
      50% { transform: scaleX(1.4); opacity: 1; }
    }
    .uc-tab-dot { animation: uc-tab-dot-pulse 2s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

const ChatTab = React.lazy(() => import('./tabs/ChatTab'));
const OfficeTab = React.lazy(() => import('./tabs/OfficeTab'));
const FeedTab = React.lazy(() => import('./tabs/FeedTab'));
const MembersTab = React.lazy(() => import('./tabs/MembersTab'));
const WalletTab = React.lazy(() => import('./tabs/WalletTab'));
const ProfileTab = React.lazy(() => import('./tabs/ProfileTab'));
const RoomsTab = React.lazy(() => import('./tabs/RoomsTab'));
const AnalyticsTab = React.lazy(() => import('./tabs/AnalyticsTab'));
const MarketplaceTab = React.lazy(() => import('./tabs/IntegrationsTab'));
const BackpackTab = React.lazy(() => import('./tabs/BackpackTab'));
const SiteCredentialVaultPanel = React.lazy(() => import('../../components/vault/SiteCredentialVaultPanel'));
const FloatingChat = React.lazy(() => import('../../components/FloatingChat'));
const SearchModal = React.lazy(() => import('../../components/SearchModal'));

// Tabs lazy-mount on first visit and now lazy-load their code chunks too.

// Gated tabs — hidden from nav until the feature is complete (see docs/NEXT_LEVEL_PLAN.md Phase 0.3)
const GATED_TABS = new Set(['WALLET']);

// Owner-only tabs — hidden (nav + content + deep links) for everyone except
// OWNER_EMAIL. Fail closed: treated as hidden until the auth read resolves.
const OWNER_ONLY_TABS = new Set(['BACKPACK']);

const TAB_META_ALL: { key: string; label: string; icon: string; flatIcon?: string; color: string }[] = [
  { key: 'CHAT', label: 'Chat', icon: '💬', flatIcon: 'chat', color: '#22c55e' },
  { key: 'ROOMS', label: 'Rooms', icon: '🏠', flatIcon: 'rooms', color: '#a855f7' },
  { key: 'OFFICE', label: 'Office', icon: '🏢', flatIcon: 'office', color: '#6366f1' },
  { key: 'FEED', label: 'Feed', icon: '🎯', flatIcon: 'feed', color: '#f59e0b' },
  { key: 'BACKPACK', label: 'Backpack', icon: '🎒', flatIcon: 'backpack', color: '#ec4899' },
  { key: 'INTEGRATIONS', label: 'Marketplace', icon: '🛍️', flatIcon: 'integrations', color: '#3b82f6' },
  { key: 'VAULT', label: 'Vault', icon: '🔐', flatIcon: 'vault', color: '#14b8a6' },
  { key: 'MEMBERS', label: 'Members', icon: '👥', flatIcon: 'members', color: '#14b8a6' },
  { key: 'ANALYTICS', label: 'Analytics', icon: '📊', flatIcon: 'analytics', color: '#6366f1' },
  { key: 'WALLET', label: 'Wallet', icon: '💰', flatIcon: 'wallet', color: '#f97316' },
  { key: 'PROFILE', label: 'Profile', icon: '👤', flatIcon: 'profile', color: '#8b5cf6' },
];

const TAB_META = TAB_META_ALL.filter(t => !GATED_TABS.has(t.key));

const TABS = TAB_META.map(t => t.key) as readonly string[];
type Tab = string;
const DEFAULT_CIRCLE_TAB: Tab = 'OFFICE';

function normalizeTabKey(value?: string | null): Tab | null {
  const upper = value?.toUpperCase();
  if (!upper) return null;
  // Preserve old shared links / stored route params after Challenges became Vault.
  if (upper === 'CHALLENGES') return 'VAULT';
  return TABS.includes(upper) ? upper : null;
}
type MarketplaceFocus = {
  itemId?: string | null;
  groupKey?: CircleIntegrationGroupKey | null;
  ts: number;
} | null;
type OfficeRunFocusRequest = {
  runId: string;
  requestId: number;
} | null;
type ChatAgentFocusRequest = {
  agentId: string;
  draft: string | null;
  requestId: number;
} | null;

// Explicit URL tabs are navigation authority. A bare circle route means the
// user just entered the workspace, so it always starts in Office instead of
// restoring stale per-circle state from an earlier visit.
function loadInitialTab(): Tab {
  try {
    if (Platform.OS === 'web') {
      // 1. Clean URL path /circle/:id/:tab — the sole source of truth.
      try {
        const parts = window.location.pathname.split('/');
        if (parts.length >= 4 && parts[1] === 'circle') {
          const urlTab = normalizeTabKey(parts[3]);
          if (urlTab) return urlTab;
        }
      } catch {}
      // 2. Legacy: ?tab= query param (older shared links).
      try {
        const urlTab = normalizeTabKey(new URLSearchParams(window.location.search).get('tab'));
        if (urlTab) return urlTab;
      } catch {}
      // Bare URL → fresh entry. Office is the workspace landing surface.
      return DEFAULT_CIRCLE_TAB;
    }
  } catch {}
  return DEFAULT_CIRCLE_TAB;
}

// Cache circle data so the screen renders instantly on refresh
const CIRCLE_CACHE_KEY = 'uc_circle_cache';
const CIRCLE_CACHE_VERSION = 1;
const CIRCLE_CACHE_TTL_MS = 300_000; // 5 minutes
function loadCachedCircle(circleId: string): { circle: Circle | null; memberCount: number } {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(`${CIRCLE_CACHE_KEY}_${circleId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.version !== CIRCLE_CACHE_VERSION) return { circle: null, memberCount: 0 };
        if (!parsed.savedAt || Date.now() - parsed.savedAt > CIRCLE_CACHE_TTL_MS) return { circle: null, memberCount: 0 };
        return { circle: parsed.circle, memberCount: parsed.memberCount };
      }
    }
  } catch {}
  return { circle: null, memberCount: 0 };
}
function cacheCircle(circleId: string, circle: Circle, memberCount: number) {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(`${CIRCLE_CACHE_KEY}_${circleId}`, JSON.stringify({ version: CIRCLE_CACHE_VERSION, savedAt: Date.now(), circle, memberCount }));
    }
  } catch {}
}

export default function CircleDetailScreen({ route, navigation }: any) {
  const { circleId, circleName, tab: routeTab, focus: routeFocus } = route.params;
  useEffect(() => {
    rememberLastProfileCircle(circleId, circleName);
  }, [circleId, circleName]);
  const [activeTab, setActiveTabRaw] = useState<Tab>(() => {
    // Route param takes priority (from CMD+K, deep links, programmatic navigation)
    const normalizedRouteTab = normalizeTabKey(routeTab);
    if (normalizedRouteTab) return normalizedRouteTab;
    return loadInitialTab();
  });
  // Circle-scoped global search modal state. Effect hooks that depend on
  // setActiveTab are declared below, after setActiveTab itself.
  const [searchOpen, setSearchOpen] = useState(false);
  const [marketplaceFocus, setMarketplaceFocus] = useState<MarketplaceFocus>(null);
  const [officeRunFocus, setOfficeRunFocus] = useState<OfficeRunFocusRequest>(null);
  const [chatAgentFocus, setChatAgentFocus] = useState<ChatAgentFocusRequest>(null);
  const officeRunFocusSequenceRef = useRef(0);
  const chatAgentFocusSequenceRef = useRef(0);
  // Cross-surface focus is deliberately allowlisted. Only a validated
  // `office:run:<id>` may open Office's run drawer and only a validated
  // `chat:agent:<id>` may select a Chat target. Malformed, mismatched, or
  // future entity kinds can still use the existing generic tab navigation but
  // cannot focus destination UI.
  const captureCrossSurfaceFocus = useCallback((rawFocus: unknown, target: Tab, rawDraft?: unknown): boolean => {
    const handle = decodeEntityHandle(rawFocus);
    if (target === 'OFFICE' && handle?.kind === 'run' && handle.surface === 'office') {
      officeRunFocusSequenceRef.current += 1;
      setOfficeRunFocus({
        runId: handle.id,
        requestId: officeRunFocusSequenceRef.current,
      });
      return true;
    }
    if (target === 'CHAT' && handle?.kind === 'agent' && handle.surface === 'chat') {
      const draft = normalizeChatAgentFocusDraft(rawDraft);
      chatAgentFocusSequenceRef.current += 1;
      setChatAgentFocus({
        agentId: handle.id,
        draft,
        requestId: chatAgentFocusSequenceRef.current,
      });
      return true;
    }
    return false;
  }, []);
  useEffect(() => {
    officeRunFocusSequenceRef.current = 0;
    setOfficeRunFocus(null);
    setChatAgentFocus(null);
  }, [circleId]);
  // Owner-only tab gate. null = auth read pending (tabs stay hidden), so a
  // non-owner never sees a Backpack flash while the session resolves.
  const [isOwnerAccount, setIsOwnerAccount] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    safeGetUser().then(({ value }) => {
      if (!cancelled) setIsOwnerAccount(value?.email === OWNER_EMAIL);
    });
    return () => { cancelled = true; };
  }, []);
  const visibleTabs = useMemo(
    () => (isOwnerAccount === true ? TAB_META : TAB_META.filter(t => !OWNER_ONLY_TABS.has(t.key))),
    [isOwnerAccount],
  );
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabRaw(tab);
    // Sync tab to URL — clean path: /circle/:id/:tab
    if (Platform.OS === 'web') {
      try {
        const tabSlug = tab.toLowerCase();
        const cleanPath = `/circle/${circleId}/${tabSlug}`;
        document.title = `${tab.charAt(0) + tab.slice(1).toLowerCase()} - ${circleName || 'Circle'}`;
        window.history.replaceState({}, '', cleanPath);
      } catch {}
    }
  }, [circleId, circleName]);
  const openOfficeRun = useCallback((runId: string) => {
    const focus = encodeEntityHandle({ kind: 'run', id: runId, surface: 'office' });
    if (!focus) return;
    captureCrossSurfaceFocus(focus, 'OFFICE');
    setActiveTab('OFFICE');
  }, [captureCrossSurfaceFocus, setActiveTab]);

  // If a non-owner lands on an owner-only tab, return them to the normal
  // circle landing surface once the auth read resolves.
  useEffect(() => {
    if (isOwnerAccount === false && OWNER_ONLY_TABS.has(activeTab)) {
      setActiveTab(DEFAULT_CIRCLE_TAB);
    }
  }, [isOwnerAccount, activeTab, setActiveTab]);

  // On mount, immediately sync the URL to the resolved active tab. Without
  // this, entering a circle via a bare URL (like `/circle/:id/?circleName=…`)
  // would leave the URL bare even though the screen is showing a specific
  // tab. On the next refresh the URL would still be bare, fall through to
  // Office, and lose the explicit current-tab state. Rewriting the URL at
  // mount time makes the URL always reflect the current tab.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const parts = window.location.pathname.split('/');
      const urlTab = parts.length >= 4 && parts[1] === 'circle' ? parts[3]?.toUpperCase() : '';
      if (urlTab !== activeTab) {
        const cleanPath = `/circle/${circleId}/${activeTab.toLowerCase()}`;
        document.title = `${activeTab.charAt(0) + activeTab.slice(1).toLowerCase()} - ${circleName || 'Circle'}`;
        window.history.replaceState({}, '', cleanPath);
      }
    } catch {}
    // Intentionally mount-only. Subsequent tab changes go through setActiveTab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global search + tab-switch listeners. Both need setActiveTab (declared
  // above) so this effect lives after that callback.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    const onToggle = () => setSearchOpen((v) => !v);
    // Chat commands (e.g. `/mission create`) dispatch uc:switch-tab so the
    // correct tab is active before the target modal tries to render.
    const onSwitchTab = (e: any) => {
      const target = normalizeTabKey((e?.detail?.tab || '').toString());
      if (!target) return;
      const marketplaceItemId = typeof e?.detail?.marketplaceItemId === 'string'
        ? e.detail.marketplaceItemId.trim()
        : '';
      if (target === 'INTEGRATIONS' && marketplaceItemId) {
        setMarketplaceFocus({ itemId: marketplaceItemId, groupKey: null, ts: Date.now() });
      }
      captureCrossSurfaceFocus(e?.detail?.focus, target, e?.detail?.draft);
      setActiveTab(target);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('uc:toggle-search', onToggle as any);
    window.addEventListener('uc:switch-tab', onSwitchTab as any);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('uc:toggle-search', onToggle as any);
      window.removeEventListener('uc:switch-tab', onSwitchTab as any);
    };
  }, [captureCrossSurfaceFocus, setActiveTab]);

  // When route params change (CMD+K, deep link), switch to the requested tab
  const tabTs = route.params?._tabTs;
  const focusTs = route.params?._focusTs;
  useEffect(() => {
    if (routeTab) {
      const target = normalizeTabKey(routeTab);
      if (target) {
        captureCrossSurfaceFocus(routeFocus, target);
        setActiveTab(target);
      }
    }
  }, [routeTab, routeFocus, tabTs, focusTs, captureCrossSurfaceFocus, setActiveTab]);
  const cached = loadCachedCircle(circleId);
  const [circle, setCircle] = useState<Circle | null>(cached.circle);
  const [memberCount, setMemberCount] = useState(cached.memberCount);
  const [activeStreakCount, setActiveStreakCount] = useState(Math.max(1, Math.floor((cached.memberCount || 1) * 0.7)));
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;
  const [onlineMembers, setOnlineMembers] = useState(Math.max(1, Math.floor((cached.memberCount || 1) * 0.5)));
  // Chat pop-out state — renders FloatingChat overlay that persists across tabs
  const [chatPopout, setChatPopout] = useState(false);
  const [chatMountKey, setChatMountKey] = useState(0);
  const openAgentInChat = useCallback((focus: string, draft?: string) => {
    if (!captureCrossSurfaceFocus(focus, 'CHAT', draft)) return;
    // The full Chat surface owns agent selection and its per-thread composer.
    // Close a floating chat first so the validated request has one destination.
    setChatPopout(false);
    setActiveTab('CHAT');
  }, [captureCrossSurfaceFocus, setActiveTab]);

  // Loading gate: show the Circle shell as soon as its data is ready. Office
  // is the default tab and handles its own queries, subscriptions, and loading
  // state without blocking the shell; an explicit link to another tab does not
  // mount Office until the user visits it.
  const [circleLoaded, setCircleLoaded] = useState(!!cached.circle);
  const loading = !circleLoaded;

  useEffect(() => {
    if (!activeTab || !TABS.includes(activeTab)) return;
    // Adaptation telemetry is best-effort. A stale browser chunk must never
    // turn a non-critical visit counter into a fatal Circle/Chat render error.
    if (typeof recordWorkspaceTabVisit !== 'function') return;
    try {
      void Promise.resolve(recordWorkspaceTabVisit(circleId, activeTab as any)).catch(() => {});
    } catch {
      // Synchronous legacy/mixed-chunk implementations are non-fatal too.
    }
  }, [circleId, activeTab]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleOpenRoomWorkspace = (event: Event) => {
      const detail = (event as CustomEvent<{ circleId?: string }>).detail;
      if (!detail?.circleId || detail.circleId !== circleId) return;
      setActiveTab('ROOMS');
    };

    window.addEventListener(ROOM_WORKSPACE_OPEN_EVENT, handleOpenRoomWorkspace as EventListener);
    return () => {
      window.removeEventListener(ROOM_WORKSPACE_OPEN_EVENT, handleOpenRoomWorkspace as EventListener);
    };
  }, [circleId, setActiveTab]);

  useEffect(() => {
    loadCircleData();
    // Escape hatch: `circleLoaded` flips in loadCircleData's finally, but
    // Promise.allSettled never SETTLES while one query hangs (allSettled is
    // rejection-proof, not hang-proof) — the workspace then spins forever
    // with no recovery. Mirror App.tsx's splash timer: after 10s, render
    // with whatever we have (cached circle or the error state).
    const escape = setTimeout(() => setCircleLoaded(true), 10_000);
    return () => clearTimeout(escape);
  }, [circleId]);


  const loadCircleData = async () => {
    try {
      const [circleRes, memberRes] = await Promise.allSettled([
        supabase.from('circles').select('*').eq('id', circleId).single(),
        supabase.from('circle_members').select('user_id').eq('circle_id', circleId),
      ]);
      const circleData = circleRes.status === 'fulfilled' ? circleRes.value.data : null;
      const memberData = memberRes.status === 'fulfilled' ? memberRes.value.data : [];
      if (circleData) {
        setCircle(circleData);
        const mc = memberData?.length || 0;
        setMemberCount(mc);
        setOnlineMembers(Math.max(1, Math.floor(mc * 0.5)));
        setActiveStreakCount(Math.max(1, Math.floor(mc * 0.7)));
        cacheCircle(circleId, circleData, mc);
      }
    } catch (error) {
      console.error('Error loading circle data:', error);
    } finally {
      setCircleLoaded(true);
    }
  };

  const accentColor = circle?.accent_color || '#6366f1';
  const circleIcon = circle?.icon || '⭕';
  const circleType = circle?.circle_type || 'custom';

  const typeLabels: Record<string, string> = {
    fitness: 'FITNESS', money: 'MONEY', learning: 'LEARNING',
    'mental-health': 'WELLNESS', relationships: 'SOCIAL', career: 'CAREER',
    productivity: 'PRODUCTIVITY', nutrition: 'NUTRITION', purpose: 'PURPOSE',
    gaming: 'GAMING', creative: 'CREATIVE', custom: 'CUSTOM',
  };

  // Office uses the shared lazy-tab wrapper so explicit links to another tab
  // do not pay its setup cost. On a bare circle entry it is the active/default
  // tab and mounts immediately. `handleOfficeReady` is
  // kept as a no-op in case OfficeTab still passes it; the loading gate
  // doesn't depend on it anymore.
  const handleOfficeReady = useCallback(() => { /* no-op — loading gate no longer blocks on Office */ }, []);
  const openMarketplace = useCallback((focus?: { itemId?: string | null; groupKey?: CircleIntegrationGroupKey | null }) => {
    setMarketplaceFocus({
      itemId: focus?.itemId || null,
      groupKey: focus?.groupKey || null,
      ts: Date.now(),
    });
    setActiveTab('INTEGRATIONS');
  }, [setActiveTab]);

  return (
    <View style={styles.container}>
      {/* Compact loading pill — shown only when circle data is still being
          fetched AND there's no cache hit. Sits at the top of the screen,
          doesn't block the app. Individual tabs handle their own loading
          states below, so the user can start interacting immediately.
          Previously this was a fullscreen opaque overlay that blocked every
          circle refresh behind a 2-5s wait. */}
      {loading && (
        <View pointerEvents="none" style={styles.loadingPill}>
          <View style={styles.loadingPillDot} />
          <Text style={styles.loadingPillText}>LOADING CIRCLE…</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <TabBarScroller
            tabs={visibleTabs}
            activeTab={activeTab}
            accentColor={accentColor}
            isMobile={isMobile}
            onTabPress={setActiveTab}
          />
        </View>
      </View>

      {/* Pop-out button — visible when Chat tab is active and not already popped out */}
      {activeTab === 'CHAT' && !chatPopout && (
        <Pressable
          onPress={() => setChatPopout(true)}
          style={[styles.popoutBtn, { borderColor: accentColor + '40' }]}
          accessibilityRole="button"
          accessibilityLabel="Pop out chat to floating window"
        >
          <Text style={[styles.popoutBtnText, { color: accentColor }]}>{'\u29C9'}</Text>
        </Pressable>
      )}

      {/* Office — now lazy-mounted like every other tab. Mounting was the
          single biggest cause of slow circle load: ~18 Supabase queries +
          realtime subscriptions + heartbeat setup were firing for every
          user who opened ANY circle, even if they went straight to Chat.
          Now it only loads when the user actually visits the Office tab. */}
      <LazyTab tabKey="OFFICE" activeTab={activeTab}>
        <OfficeTab
          circleId={circleId}
          accentColor={accentColor}
          focusRunId={officeRunFocus?.runId || null}
          focusRunRequestId={officeRunFocus?.requestId || 0}
          onOpenAgentInChat={openAgentInChat}
          onReady={handleOfficeReady}
        />
      </LazyTab>

      {/* Other tabs — lazy mount on first visit, stay mounted after */}
      {!chatPopout && (
        <LazyTab key={`chat-${chatMountKey}`} tabKey="CHAT" activeTab={activeTab}>
          <ChatTab
            circleId={circleId}
            accentColor={accentColor}
            focusAgentId={chatAgentFocus?.agentId || null}
            focusAgentDraft={chatAgentFocus?.draft || null}
            focusAgentRequestId={chatAgentFocus?.requestId || 0}
          />
        </LazyTab>
      )}
      <LazyTab tabKey="ROOMS" activeTab={activeTab}>
        <RoomsTab circleId={circleId} accentColor={accentColor} />
      </LazyTab>
      {/* BACKPACK — owner-only (OWNER_EMAIL); content never mounts for others */}
      {isOwnerAccount === true && (
        <LazyTab tabKey="BACKPACK" activeTab={activeTab}>
          <BackpackTab
            key={circleId}
            circleId={circleId}
            accentColor={accentColor}
            onOpenOffice={() => setActiveTab('OFFICE')}
          />
        </LazyTab>
      )}
      <LazyTab tabKey="FEED" activeTab={activeTab}>
        <FeedTab
          circleId={circleId}
          accentColor={accentColor}
          onOpenMarketplace={openMarketplace}
          onOpenOfficeRun={openOfficeRun}
        />
      </LazyTab>
      <LazyTab tabKey="VAULT" activeTab={activeTab}>
        <SiteCredentialVaultPanel circleId={circleId} accentColor={accentColor} fullHeight />
      </LazyTab>
      <LazyTab tabKey="MEMBERS" activeTab={activeTab}>
        <MembersTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="ANALYTICS" activeTab={activeTab}>
        <AnalyticsTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="INTEGRATIONS" activeTab={activeTab}>
        <MarketplaceTab
          circleId={circleId}
          initialFocusItemId={marketplaceFocus?.itemId || null}
          initialFocusGroup={marketplaceFocus?.groupKey || null}
          focusTs={marketplaceFocus?.ts || 0}
        />
      </LazyTab>
      {/* WALLET — gated (see docs/NEXT_LEVEL_PLAN.md Phase 0.3) */}
      {!GATED_TABS.has('WALLET') && (
        <LazyTab tabKey="WALLET" activeTab={activeTab}>
          <WalletTab circleId={circleId} />
        </LazyTab>
      )}
      <LazyTab tabKey="PROFILE" activeTab={activeTab}>
        <ProfileTab circleId={circleId} navigation={navigation} />
      </LazyTab>

      {/* Floating Chat — persists across all tabs when popped out */}
      {chatPopout && (
        <React.Suspense fallback={null}>
          <FloatingChat
            circleId={circleId}
            circleName={circleName || circle?.name || 'Circle'}
            accentColor={accentColor}
            onClose={() => { setChatPopout(false); setChatMountKey(k => k + 1); }}
          />
        </React.Suspense>
      )}

      {/* Onboarding Tutorial — floating guide for new users */}
      <TutorialController circleId={circleId} />

      {/* Global search (⌘K) — fires deeplinks that FeedTab / MissionsTab
          consume on their next render. */}
      {searchOpen && (
        <React.Suspense fallback={null}>
          <SearchModal
            circleId={circleId}
            visible={searchOpen}
            onClose={() => setSearchOpen(false)}
          />
        </React.Suspense>
      )}
    </View>
  );
}

// ─── Lazy Tab — mounts on first visit, stays mounted after ──────────────────

function LazyTab({ tabKey, activeTab, children }: { tabKey: string; activeTab: string; children: React.ReactNode }) {
  const [hasVisited, setHasVisited] = useState(false);
  const isActive = activeTab === tabKey;

  useEffect(() => {
    if (isActive && !hasVisited) setHasVisited(true);
  }, [isActive, hasVisited]);

  if (!hasVisited) return null;

  return (
    <View style={[styles.tabContent, !isActive && styles.hiddenTab]}>
      <ErrorBoundary scope={`${tabKey} tab`}>
        <React.Suspense fallback={<LoadingScreen />}>{children}</React.Suspense>
      </ErrorBoundary>
    </View>
  );
}

// ─── Tab Pill ───────────────────────────────────────────────────────

function TabPill({ icon, flatIcon, label, active, accentColor, tabColor, isMobile, onPress }: {
  icon: string; flatIcon?: string; label: string; active: boolean; accentColor: string; tabColor: string; isMobile: boolean; onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = active ? tabColor : accentColor;

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.tabPill,
        active && { backgroundColor: tabColor + '15', borderColor: tabColor + '50' },
        hovered && !active && { backgroundColor: '#ffffff08', borderColor: '#333' },
        isMobile && styles.tabPillMobile,
      ]}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      {flatIcon ? (
        <FlatIcon
          name={flatIcon}
          size={isMobile ? 16 : 18}
          mono={!hovered && !active}
          glow={active}
          style={!active && !hovered ? { opacity: 0.5 } : undefined}
        />
      ) : (
        <Text style={styles.tabPillIcon}>{icon}</Text>
      )}
      <Text style={[
        styles.tabPillText,
        { color: active ? tabColor : hovered ? '#ccc' : '#888' },
        active && { fontWeight: '800' },
      ]}>
        {label}
      </Text>
      {/* Animated dot under active tab */}
      {active && (
        Platform.OS === 'web' ? (
          <div className="uc-tab-dot" style={{
            position: 'absolute', bottom: -1, width: 14, height: 4,
            borderRadius: 2, backgroundColor: tabColor,
          }} />
        ) : (
          <View style={[styles.tabDot, { backgroundColor: tabColor }]} />
        )
      )}
    </Pressable>
  );
}

// ─── Tab Bar Scroller ────────────────────────────────────────────────────────

function TabBarScroller({ tabs, activeTab, accentColor, isMobile, onTabPress }: {
  tabs: typeof TAB_META;
  activeTab: string;
  accentColor: string;
  isMobile: boolean;
  onTabPress: (key: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollX = useRef(0);
  const contentW = useRef(0);
  const containerW = useRef(0);

  const updateArrows = useCallback(() => {
    setCanScrollLeft(scrollX.current > 4);
    setCanScrollRight(scrollX.current + containerW.current < contentW.current - 4);
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollX.current = e.nativeEvent.contentOffset.x;
    containerW.current = e.nativeEvent.layoutMeasurement.width;
    contentW.current = e.nativeEvent.contentSize.width;
    updateArrows();
  }, [updateArrows]);

  const scrollBy = useCallback((delta: number) => {
    const next = Math.max(0, scrollX.current + delta);
    scrollRef.current?.scrollTo({ x: next, animated: true });
  }, []);

  // Desktop: show all tabs in a wrapping row (no scroll)
  if (!isMobile) {
    return (
      <View style={styles.tabBarWrapper}>
        <View style={styles.tabBarDesktopWrap}>
          {tabs.map((tab) => (
            <TabPill
              key={tab.key}
              icon={tab.icon}
              flatIcon={tab.flatIcon}
              label={tab.label}
              active={activeTab === tab.key}
              accentColor={accentColor}
              tabColor={tab.color}
              isMobile={false}
              onPress={() => onTabPress(tab.key)}
            />
          ))}
        </View>
      </View>
    );
  }

  // Mobile: horizontal scroll with arrows
  return (
    <View style={styles.tabBarWrapper}>
      {canScrollLeft && (
        <Pressable
          onPress={() => scrollBy(-200)}
          style={[styles.tabArrow, styles.tabArrowLeft]}
        >
          <Text style={styles.tabArrowText}>‹</Text>
        </Pressable>
      )}

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.tabBarMobile}
        style={styles.tabBarScroll}
      >
        {tabs.map((tab) => (
          <TabPill
            key={tab.key}
            icon={tab.icon}
            flatIcon={tab.flatIcon}
            label={tab.label}
            active={activeTab === tab.key}
            accentColor={accentColor}
            tabColor={tab.color}
            isMobile={isMobile}
            onPress={() => onTabPress(tab.key)}
          />
        ))}
      </ScrollView>

      {/* Right arrow (mobile only) */}
      {canScrollRight && (
        <Pressable
          onPress={() => scrollBy(200)}
          style={[styles.tabArrow, styles.tabArrowRight]}
        >
          <Text style={styles.tabArrowText}>›</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: '#0A0A0A',
  },
  loadingPill: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 12 : 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(17, 24, 39, 0.92)',
    borderWidth: 1,
    borderColor: '#243041',
    zIndex: 120,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  loadingPillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#6366f1',
    // RN-Web 0.19+ rejects both `animation` + `animationName` in
    // StyleSheet. The `uc-tab-dot` keyframe is applied at the app
    // level via the global CSS injector (see line ~50 of this file);
    // apply via `dataSet={{ className: 'uc-tab-dot' }}` on the View
    // if you need the pulse back. Leaving the dot static on web
    // keeps the validator quiet.
  },
  loadingPillText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    fontFamily: 'monospace',
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Header
  header: {
    paddingTop: Platform.OS === 'web' ? 4 : 44,
    backgroundColor: '#0A0A0A',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    width: '100%',
    alignItems: 'center',
  },
  headerInner: {
    width: '100%',
    maxWidth: 800,
  },

  // Top row
  // Tab Bar wrapper with arrows
  tabBarWrapper: {
    position: 'relative' as any,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarScroll: {
    flex: 1,
  },

  // Tab Bar — desktop: all tabs visible, wrapping if needed
  tabBarDesktopWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 4,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexGrow: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 4,
  },

  // Tab Bar — mobile: scrollable with padding
  tabBarMobile: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexGrow: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 4,
  },

  // Arrow buttons
  tabArrow: {
    width: 24,
    height: 28,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    backgroundColor: '#0A0A0A',
    zIndex: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabArrowLeft: {},
  tabArrowRight: {},
  tabArrowText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#888',
  },

  // Fade gradients on edges
  tabFade: {
    position: 'absolute' as any,
    top: 0,
    bottom: 0,
    width: 20,
    zIndex: 5,
    pointerEvents: 'none' as any,
  },
  tabFadeLeft: {
    left: 24,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(to right, #0A0A0A, transparent)' } as any : {}),
  },
  tabFadeRight: {
    right: 24,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(to left, #0A0A0A, transparent)' } as any : {}),
  },

  // Tab pill style (replaces old underline tabs and hamburger menu)
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 28,
    gap: 4,
    ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'pointer' } as any : {}),
  },
  tabPillMobile: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  tabPillIcon: {
    fontSize: 13,
  },
  tabPillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabDot: {
    position: 'absolute' as any,
    bottom: -1,
    width: 14,
    height: 4,
    borderRadius: 2,
  },

  // Tab content
  tabContent: {
    flex: 1,
  },
  hiddenTab: {
    display: 'none' as any,
  },

  // Pop-out button
  popoutBtn: {
    position: 'absolute' as any,
    top: Platform.OS === 'web' ? 8 : 48,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a28',
    backgroundColor: '#0a0a10',
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    zIndex: 50,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  popoutBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#a0a0b0',
    fontFamily: 'monospace',
  },
});
