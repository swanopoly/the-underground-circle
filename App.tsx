import './src/lib/animationPatch'; // Must be first — patches Animated.loop for web
import './src/lib/pixelDesign'; // Side effect: injects the global system font stack + :root CSS vars on web
import { installErrorReporter } from './src/lib/errorReporter';
installErrorReporter(); // Register global unhandled-rejection / error handlers
import React, { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { StatusBar, View, Text, StyleSheet, Animated, Platform, TouchableOpacity } from 'react-native';
import { NavigationContainer, useNavigation, LinkingOptions } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import ErrorBoundary from './src/components/ErrorBoundary';
import AppHeader from './src/components/AppHeader';
import { acceptInvite } from './src/lib/invites';
import { buildAppActions } from './src/components/command/commandActions';
import { ToastProvider } from './src/components/Toast';
import {
  clearInvalidLocalAuthSession,
  inspectAuthSessionCandidate,
  inspectBootstrapAuthSession,
} from './src/lib/authBootstrap';
import { AuthSessionProvider } from './src/hooks/useAuth';
import { isPasswordRecoveryLocation } from './src/lib/authUiPolicy';
import { safeGetUser } from './src/lib/authSession';
import { OWNER_EMAIL } from './src/lib/officeConfig';
import { clearLocalAuthResidualAuthority } from './src/lib/authLogout';
import {
  closeOpenSwanApprovalResumeOutboxAuthorityForLogout,
  openOpenSwanApprovalResumeOutboxAuthorityForSession,
} from './src/lib/openSwanApprovalResumeOutbox';

const AuthNavigator = React.lazy(() => import('./src/navigation/AuthNavigator'));
const MainNavigator = React.lazy(() => import('./src/navigation/MainNavigator'));
const OnboardingFlow = React.lazy(() => import('./src/components/OnboardingFlow'));
const XPOverlay = React.lazy(() => import('./src/components/rpg/XPOverlay'));

// Conditionally import the web-only command palette provider
let CommandPaletteProvider: React.FC<{ children: React.ReactNode; actions: any[] }> | null = null;
if (Platform.OS === 'web') {
  try {
    CommandPaletteProvider = require('./src/components/command/CommandPalette.web').CommandPaletteProvider;
  } catch {}
}

const PENDING_INVITE_KEY = 'uc_pending_invite';
// Optional mission deep-link from a shared URL: /join/{code}?mission={id}
// Lets a recipient land directly on the mission they were invited to instead
// of the default tab. MissionsTab consumes + clears this on mount.
const PENDING_MISSION_KEY = 'uc_pending_mission_deeplink';
const ONBOARDING_KEY = 'uc_onboarding_complete';

function isOnboardingComplete(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true;
  }
}

function deferAfterFirstPaint(work: () => void) {
  if (Platform.OS !== 'web') {
    setTimeout(work, 0);
    return;
  }
  const win = typeof window !== 'undefined' ? window as any : null;
  if (win?.requestIdleCallback) {
    win.requestIdleCallback(work, { timeout: 2500 });
  } else {
    setTimeout(work, 1200);
  }
}

let agentAutoConnectLifecycleGeneration = 0;

function startAgentAutoConnectDeferred(session: Session) {
  const generation = ++agentAutoConnectLifecycleGeneration;
  const authority = {
    userId: session.user.id,
    accessToken: session.access_token,
  };
  deferAfterFirstPaint(() => {
    if (generation !== agentAutoConnectLifecycleGeneration) return;
    import('./src/lib/agentAutoConnect')
      .then((mod) => {
        if (generation === agentAutoConnectLifecycleGeneration) {
          return mod.startAgentAutoConnect(authority);
        }
      })
      .catch(() => {});
  });
}

function stopAgentAutoConnectDeferred() {
  agentAutoConnectLifecycleGeneration += 1;
  import('./src/lib/agentAutoConnect')
    .then((mod) => mod.stopAgentAutoConnect())
    .catch(() => {});
}

function setAutoConnectCircleIdDeferred(circleId: string) {
  deferAfterFirstPaint(() => {
    import('./src/lib/agentAutoConnect')
      .then((mod) => mod.setAutoConnectCircleId(circleId))
      .catch(() => {});
  });
}

function AppRouteFallback() {
  return <View style={{ flex: 1, backgroundColor: '#0A0A0A' }} />;
}

/** Redeem a pending invite token after login */
async function handlePendingInvite(_userId: string) {
  if (Platform.OS !== 'web') return;
  try {
    const token = localStorage.getItem(PENDING_INVITE_KEY);
    if (!token) return;
    localStorage.removeItem(PENDING_INVITE_KEY);

    const { circleId, error } = await acceptInvite(token);
    if (error) {
      console.warn('Invite redemption failed:', error);
      return;
    }
    if (circleId) {
      console.log('Invite redeemed, joined circle:', circleId);
      // Navigation will pick up the new circle on next render. The optional
      // mission deep-link in PENDING_MISSION_KEY (set during URL parsing) is
      // consumed by MissionsTab once the user lands in that circle.
    }
  } catch (e) {
    console.warn('handlePendingInvite error:', e);
  }
}

/** Check URL params for invite token, mission deep-link, or github_connected callback */
function getUrlParams(): {
  invite?: string;
  mission?: string;
  githubConnected?: boolean;
  circleId?: string;
} {
  if (Platform.OS !== 'web') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite') || undefined;
    const mission = params.get('mission') || undefined;
    const githubConnected = params.get('github_connected') === '1';
    const circleId = params.get('circle_id') || undefined;
    // Persist mission deep-link so it survives the login redirect / handler.
    if (mission) {
      try { localStorage.setItem(PENDING_MISSION_KEY, mission); } catch {}
    }
    // Clean URL params after reading (don't leave tokens in the URL bar)
    if (invite || githubConnected || mission) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    return { invite, mission, githubConnected, circleId };
  } catch {
    return {};
  }
}

/** Also handle /join/:code path-based invite URLs (with optional ?mission=) */
function getInviteFromPath(): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  try {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z0-9]+)$/);
    if (!match) return undefined;
    // Preserve ?mission= for the deep-link before we replace the URL.
    const params = new URLSearchParams(window.location.search);
    const mission = params.get('mission');
    if (mission) {
      try { localStorage.setItem(PENDING_MISSION_KEY, mission); } catch {}
    }
    window.history.replaceState({}, '', '/');
    return match[1];
  } catch {}
  return undefined;
}

function isPasswordRecoveryUrl(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    return isPasswordRecoveryLocation(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
  } catch {
    return false;
  }
}

function MainWithHeader() {
  const navigation = useNavigation();

  // Owner-only command palette entries (Backpack) — hidden until the auth
  // read proves the session belongs to OWNER_EMAIL. Fail closed.
  const [isOwnerAccount, setIsOwnerAccount] = useState(false);
  useEffect(() => {
    let cancelled = false;
    safeGetUser().then(({ value }) => {
      if (!cancelled) setIsOwnerAccount(value?.email === OWNER_EMAIL);
    });
    return () => { cancelled = true; };
  }, []);

  // Build command palette actions with current navigation context
  const actions = useMemo(() => {
    const nav = (screen: string, params?: any) => {
      try { (navigation as any).navigate(screen, params); } catch {}
    };
    // Try to extract circleId from current nav state
    let circleId: string | undefined;
    try {
      const state = (navigation as any).getState?.();
      if (state?.routes) {
        const current = state.routes[state.index];
        if (current?.name === 'CircleDetail') {
          circleId = (current.params as any)?.circleId;
        }
      }
    } catch {}
    return buildAppActions(nav, circleId, { showOwnerTabs: isOwnerAccount });
  }, [navigation, isOwnerAccount]);

  const content = (
    <View style={{ flex: 1 }}>
      <AppHeader navigation={navigation} />
      <Suspense fallback={<AppRouteFallback />}>
        <MainNavigator />
      </Suspense>
    </View>
  );

  // Wrap with command palette on web only
  if (Platform.OS === 'web' && CommandPaletteProvider) {
    return (
      <CommandPaletteProvider actions={actions}>
        {content}
      </CommandPaletteProvider>
    );
  }

  return content;
}

const NAV_STATE_KEY = 'uc_nav_state_v1';

/**
 * Web URLs are shareable navigation authority. A persisted stack is only a
 * convenience when the user opens the bare app root; otherwise it can carry a
 * prior account or circle over an explicit deep link. Native has no browser
 * URL to honor, so its saved stack remains authoritative on startup.
 */
export function shouldRestorePersistedNavigationState(
  platform: string,
  webLocation: string | null | undefined,
): boolean {
  return platform !== 'web' || webLocation === '/';
}

async function loadNavState() {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(NAV_STATE_KEY);
      return raw ? JSON.parse(raw) : undefined;
    }
    const raw = await AsyncStorage.getItem(NAV_STATE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

async function saveNavState(state: object) {
  try {
    const raw = JSON.stringify(state);
    if (Platform.OS === 'web') {
      localStorage.setItem(NAV_STATE_KEY, raw);
    } else {
      await AsyncStorage.setItem(NAV_STATE_KEY, raw);
    }
  } catch {
    // ignore
  }
}

// ─── Deep Linking — maps URL paths to screens ──────────────────────────────
const linking: LinkingOptions<any> = {
  prefixes: [
    'https://app.chrisswanson.xyz',
    'http://localhost:8081',
  ],
  config: {
    screens: {
      // Auth
      Login: 'login',
      SignUp: 'signup',
      PasswordRecovery: 'forgot-password',
      ResetPassword: 'reset-password',
      // Main
      CirclesList: 'circles',
      CreateCircle: 'circles/create',
      Discover: 'discover',
      JoinCircle: 'circles/join',
      CircleDetail: {
        path: 'circle/:circleId/:tab?',
        parse: { tab: (tab: string) => tab?.toUpperCase() },
      },
      CircleSettings: 'circle/:circleId/settings',
      // Profile & Social
      Profile: 'profile',
      EditProfile: 'profile/edit',
      Friends: 'friends',
      DMScreen: 'dm/:friendId',
      Agents: 'agents',
      Integrations: 'integrations',
      InviteManage: 'invites',
      // Organizations
      OrgList: 'orgs',
      OrgDetail: 'org/:orgId',
      CreateOrg: 'orgs/create',
      OrgSettings: 'org/:orgId/settings',
      Billing: 'org/:orgId/billing',
      SSOConfig: 'org/:orgId/sso',
      Goals: 'org/:orgId/goals',
      Reports: 'org/:orgId/reports',
      WhiteLabel: 'org/:orgId/white-label',
      // Schools
      Schools: 'schools',
      SchoolsTrack: 'schools/:trackId',
      SchoolsModule: 'schools/:trackId/:moduleId',
      SchoolsLesson: 'schools/:trackId/:moduleId/:lessonId',
      // Wiki
      Wiki: 'wiki',
      WikiCategory: 'wiki/:categoryId',
      WikiArticle: 'wiki/article/:articleId',
    },
  },
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [navReady, setNavReady] = useState(false);
  const [initialNavState, setInitialNavState] = useState<object | undefined>(undefined);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasCircles, setHasCircles] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryUrl);
  const [authReconnecting, setAuthReconnecting] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const retryAuthVerificationRef = useRef<() => void>(() => {});

  const retryAuthVerification = useCallback(() => {
    retryAuthVerificationRef.current();
  }, []);

  const completePasswordRecovery = useCallback(() => {
    setSession(null);
    setPasswordRecovery(false);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.history.replaceState({}, '', '/login');
    }
  }, []);

  const refreshHasCircles = async (userId: string): Promise<boolean> => {
    try {
      const { data, count } = await supabase
        .from('circle_members')
        .select('circle_id', { count: 'exact' })
        .eq('user_id', userId)
        .limit(1);
      const nextHasCircles = (count || 0) > 0;
      setHasCircles(nextHasCircles);
      // Set the first circle for agent auto-connect memory saves
      if (data && data.length > 0 && data[0].circle_id) {
        setAutoConnectCircleIdDeferred(data[0].circle_id);
      }
      return nextHasCircles;
    } catch {
      setHasCircles(false);
      return false;
    }
  };

  useEffect(() => {
    let disposed = false;
    let authRevision = 0;
    let activeUserId: string | null = null;
    let activeSession: Session | null = null;
    let authRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingAuthRetry: (() => Promise<void>) | null = null;
    let authRetryInFlight = false;
    let coldStartSettled = false;
    let coldStartEventVerificationStarted = false;
    let authBootstrapFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // Setup notifications
    import('./src/lib/notifications').then(n => {
      n.setupNotifications();
      if (Platform.OS !== 'web') {
        n.requestNotificationPermission();
      }
    }).catch(() => {});

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Navigation may become ready independently, but Auth remains
    // authoritative. A slow Auth check must never reveal the signed-out
    // navigator while a persisted session is still being verified.
    const timeout = setTimeout(() => {
      setNavReady(true);
    }, 5000);

    loadNavState().then((state) => {
      setInitialNavState(state);
      setNavReady(true);
    }).catch(() => {
      setNavReady(true);
    });

    // Check for invite token in URL
    const urlParams = getUrlParams();
    const pathInvite = getInviteFromPath();
    const inviteToken = urlParams.invite || pathInvite;
    if (inviteToken && Platform.OS === 'web') {
      try { localStorage.setItem(PENDING_INVITE_KEY, inviteToken); } catch {}
    }

    const finishUserSetup = (validatedSession: Session) => {
      handlePendingInvite(validatedSession.user.id).finally(() => {
        refreshHasCircles(validatedSession.user.id).then((userHasCircles) => {
          if (!userHasCircles && !isOnboardingComplete()) {
            setShowOnboarding(true);
          } else {
            setShowOnboarding(false);
          }
        }).catch(() => {});
      });
    };

    const cancelAuthRetry = (clearReconnectState = true) => {
      if (authRetryTimer) clearTimeout(authRetryTimer);
      authRetryTimer = null;
      pendingAuthRetry = null;
      if (clearReconnectState) setAuthReconnecting(false);
    };

    const executeAuthRetry = (retry: () => Promise<void>) => {
      if (disposed || authRetryInFlight) return;
      authRetryInFlight = true;
      pendingAuthRetry = null;
      void retry().finally(() => {
        authRetryInFlight = false;
      });
    };

    const scheduleAuthRetry = (
      retry: () => Promise<void>,
      attempt: number,
      showReconnectState: boolean,
    ) => {
      if (authRetryTimer) clearTimeout(authRetryTimer);
      pendingAuthRetry = retry;
      setAuthReconnecting(showReconnectState);
      const delayMs = Math.min(15_000, 1_000 * (2 ** Math.min(attempt, 4)));
      authRetryTimer = setTimeout(() => {
        authRetryTimer = null;
        executeAuthRetry(retry);
      }, delayMs);
    };

    retryAuthVerificationRef.current = () => {
      const retry = pendingAuthRetry;
      if (!retry || disposed) return;
      if (authRetryTimer) clearTimeout(authRetryTimer);
      authRetryTimer = null;
      executeAuthRetry(retry);
    };

    // A browser can recover from an offline transition or release a stalled
    // Auth Web Lock while this tab is hidden. Retry the existing bounded
    // verification immediately on either signal; no new attempt is created
    // when there is no pending retry or one is already in flight.
    const retryAuthWhenOnline = () => retryAuthVerificationRef.current();
    const retryAuthWhenVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        retryAuthVerificationRef.current();
      }
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', retryAuthWhenOnline);
      document.addEventListener('visibilitychange', retryAuthWhenVisible);
    }

    const commitValidatedSession = (validatedSession: Session, event: string) => {
      cancelAuthRetry();
      clearTimeout(timeout);
      if (authBootstrapFallbackTimer) clearTimeout(authBootstrapFallbackTimer);
      authBootstrapFallbackTimer = null;
      coldStartSettled = true;
      const isRecovery = event === 'PASSWORD_RECOVERY' || isPasswordRecoveryUrl();
      const opensNewApprovalAuthority = activeUserId !== validatedSession.user.id;
      if (opensNewApprovalAuthority) {
        // Re-open exact-call authority only for a newly validated account.
        // Token refreshes for the same user must not rotate the epoch out from
        // under an in-flight, Web-Locked persistence operation.
        openOpenSwanApprovalResumeOutboxAuthorityForSession();
      }
      activeSession = validatedSession;
      activeUserId = validatedSession.user.id;
      setSession(validatedSession);
      setLoading(false);
      setPasswordRecovery(isRecovery);

      // A password-recovery session is only for choosing a new password. Do
      // not mount the main application or start local agents with it.
      if (isRecovery) {
        stopAgentAutoConnectDeferred();
        return;
      }

      startAgentAutoConnectDeferred(validatedSession);
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        finishUserSetup(validatedSession);
      }
    };

    const rejectSession = (
      reason: 'missing_candidate' | 'missing_user' | 'user_mismatch' | 'auth_rejected',
    ) => {
      cancelAuthRetry();
      clearTimeout(timeout);
      if (authBootstrapFallbackTimer) clearTimeout(authBootstrapFallbackTimer);
      authBootstrapFallbackTimer = null;
      coldStartSettled = true;
      closeOpenSwanApprovalResumeOutboxAuthorityForLogout();
      activeSession = null;
      activeUserId = null;
      setSession(null);
      setLoading(false);
      setHasCircles(false);
      stopAgentAutoConnectDeferred();
      // An empty cache is the normal signed-out state. A server-confirmed
      // missing/mismatched user is the only validation result that should
      // delete persisted Auth state and emit a real SIGNED_OUT event.
      if (reason !== 'missing_candidate') void clearInvalidLocalAuthSession();
    };

    const applyValidatedSession = async (
      candidate: Session,
      event: string,
      attempt = 0,
    ) => {
      const revision = ++authRevision;
      const validation = await inspectAuthSessionCandidate(candidate);
      if (disposed || revision !== authRevision) return;

      if (validation.status === 'unavailable') {
        const retainsVerifiedSession = activeSession?.user.id === candidate.user.id;
        if (!retainsVerifiedSession) {
          activeSession = null;
          activeUserId = null;
          setSession(null);
          setHasCircles(false);
          stopAgentAutoConnectDeferred();
        }
        setLoading(false);
        scheduleAuthRetry(
          () => applyValidatedSession(candidate, event, attempt + 1),
          attempt,
          !retainsVerifiedSession,
        );
        return;
      }

      if (validation.status === 'signed_out') {
        rejectSession(validation.reason);
        return;
      }

      commitValidatedSession(validation.session, event);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (disposed) return;

      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }

      // During storage recovery Supabase can emit SIGNED_IN immediately before
      // INITIAL_SESSION. Treat the first session-bearing event as the one cold-
      // start candidate and ignore the duplicate initial notification. Its
      // exact access token is verified outside the session Web Lock. The
      // delayed getSession bootstrap below exists only if no initial event is
      // emitted at all; a late event safely supersedes it through authRevision.
      if (!coldStartSettled && (event === 'INITIAL_SESSION' || !!nextSession)) {
        if (!coldStartEventVerificationStarted) {
          coldStartEventVerificationStarted = true;
          if (authBootstrapFallbackTimer) clearTimeout(authBootstrapFallbackTimer);
          authBootstrapFallbackTimer = null;
          if (nextSession) {
            setTimeout(() => {
              if (!disposed) void applyValidatedSession(nextSession, event);
            }, 0);
          } else {
            rejectSession('missing_candidate');
          }
        }
        return;
      }

      if (nextSession) {
        // Supabase recommends keeping auth callbacks synchronous. Defer any
        // getUser call until its internal auth lock has been released.
        setTimeout(() => {
          if (!disposed) void applyValidatedSession(nextSession, event);
        }, 0);
      } else if (event === 'SIGNED_OUT') {
        cancelAuthRetry();
        clearTimeout(timeout);
        // Supabase delivers remote and cross-tab sign-outs through this path.
        // Fence replay authority synchronously before asynchronous cleanup so
        // an already-running tool gate cannot recreate an exact-call lease.
        closeOpenSwanApprovalResumeOutboxAuthorityForLogout();
        const signedOutUserId = activeUserId;
        activeSession = null;
        activeUserId = null;
        authRevision += 1;
        setSession(null);
        setLoading(false);
        setPasswordRecovery(false);
        stopAgentAutoConnectDeferred();
        void clearLocalAuthResidualAuthority(signedOutUserId);
        setShowOnboarding(false);
        setHasCircles(false);
        // Clear per-user persisted UI state so the NEXT account on this
        // browser doesn't inherit the previous user's last route (an
        // RLS-empty screen) or their onboarding-done flag.
        try {
          localStorage.removeItem(NAV_STATE_KEY);
          localStorage.removeItem(ONBOARDING_KEY);
        } catch {}
      }
    });

    // A persisted session is only a candidate. Verify it against Supabase
    // before it can select MainNavigator or start the desktop agent bridge.
    const runBootstrap = async (attempt = 0) => {
      const bootstrapRevision = ++authRevision;
      const validation = await inspectBootstrapAuthSession();
      if (disposed || bootstrapRevision !== authRevision) return;
      if (validation.status === 'unavailable') {
        setLoading(false);
        scheduleAuthRetry(
          () => runBootstrap(attempt + 1),
          attempt,
          !activeSession,
        );
        return;
      }
      if (validation.status === 'signed_out') {
        rejectSession(validation.reason);
        return;
      }
      commitValidatedSession(validation.session, 'INITIAL_SESSION');
    };
    // onAuthStateChange normally emits a recovered SIGNED_IN/INITIAL_SESSION
    // immediately. Keep a fallback for a stalled/missing initial callback,
    // but do not race getSession against the normal event path.
    authBootstrapFallbackTimer = setTimeout(() => {
      authBootstrapFallbackTimer = null;
      if (disposed || coldStartSettled || coldStartEventVerificationStarted) return;
      void runBootstrap();
    }, 1_500);

    return () => {
      disposed = true;
      authRevision += 1;
      cancelAuthRetry(false);
      if (authBootstrapFallbackTimer) clearTimeout(authBootstrapFallbackTimer);
      authBootstrapFallbackTimer = null;
      retryAuthVerificationRef.current = () => {};
      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.removeEventListener('online', retryAuthWhenOnline);
        document.removeEventListener('visibilitychange', retryAuthWhenVisible);
      }
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (loading || !navReady) {
    return (
      <View style={styles.loading}>
        <Animated.View style={[styles.logoCircle, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.logoText}>UC</Text>
        </Animated.View>
        <Text style={styles.loadingTitle}>THE UNDERGROUND CIRCLE</Text>
      </View>
    );
  }

  if (authReconnecting && !session) {
    return (
      <View style={styles.loading}>
        <Animated.View style={[styles.logoCircle, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.logoText}>UC</Text>
        </Animated.View>
        <Text style={styles.loadingTitle}>RECONNECTING SECURE SESSION</Text>
        <Text style={styles.reconnectText}>
          Your saved session has not been deleted. We are retrying the secure verification.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Retry secure session verification"
          style={styles.reconnectButton}
          onPress={retryAuthVerification}
        >
          <Text style={styles.reconnectButtonText}>RETRY NOW</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Only use saved nav state if it looks valid (has routes array)
  const validNavState = initialNavState && typeof initialNavState === 'object' && 'routes' in initialNavState
    ? initialNavState as any : undefined;
  const webNavigationLocation = Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.pathname}${window.location.search}${window.location.hash}`
    : null;
  const restorePersistedNavigation = shouldRestorePersistedNavigationState(
    Platform.OS,
    webNavigationLocation,
  );

  return (
    <AuthSessionProvider session={session} loading={loading}>
      <ErrorBoundary scope="app">
        <ToastProvider>
        <NavigationContainer
          linking={linking}
          initialState={session && !passwordRecovery && restorePersistedNavigation
            ? validNavState
            : undefined}
          onStateChange={(state) => {
            if (state && session && !passwordRecovery) saveNavState(state);
          }}
        >
          <StatusBar barStyle="light-content" />
          {session && !passwordRecovery ? (
            <MainWithHeader />
          ) : (
            <Suspense fallback={<AppRouteFallback />}>
              <AuthNavigator
                key={passwordRecovery ? 'password-recovery' : 'auth'}
                passwordRecovery={passwordRecovery}
                onPasswordRecoveryComplete={completePasswordRecovery}
              />
            </Suspense>
          )}
        </NavigationContainer>
        {showOnboarding && session && !passwordRecovery && !hasCircles && (
          <Suspense fallback={null}>
            <OnboardingFlow
              userId={session.user.id}
              onComplete={() => setShowOnboarding(false)}
            />
          </Suspense>
        )}
        {session && !passwordRecovery && (
          <Suspense fallback={null}>
            <XPOverlay />
          </Suspense>
        )}
        </ToastProvider>
      </ErrorBoundary>
    </AuthSessionProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  logoText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 3,
  },
  loadingTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 4,
  },
  reconnectText: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 420,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 24,
  },
  reconnectButton: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#4B5563',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  reconnectButtonText: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});
