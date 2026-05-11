import './src/lib/animationPatch'; // Must be first — patches Animated.loop for web
import './src/lib/pixelDesign'; // Side effect: injects the global system font stack + :root CSS vars on web
import { installErrorReporter } from './src/lib/errorReporter';
installErrorReporter(); // Register global unhandled-rejection / error handlers
import React, { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import { StatusBar, View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { NavigationContainer, useNavigation, LinkingOptions } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import ErrorBoundary from './src/components/ErrorBoundary';
import AppHeader from './src/components/AppHeader';
import { acceptInvite, lookupInvite } from './src/lib/invites';
import { buildAppActions } from './src/components/command/commandActions';
import { ToastProvider } from './src/components/Toast';

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

function startAgentAutoConnectDeferred() {
  deferAfterFirstPaint(() => {
    import('./src/lib/agentAutoConnect')
      .then((mod) => mod.startAgentAutoConnect())
      .catch(() => {});
  });
}

function stopAgentAutoConnectDeferred() {
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
  return <View style={{ flex: 1, backgroundColor: '#000' }} />;
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

function MainWithHeader() {
  const navigation = useNavigation();

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
    return buildAppActions(nav, circleId);
  }, [navigation]);

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
  const pulseAnim = useRef(new Animated.Value(1)).current;

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

    // Hard timeout — never stay on splash for more than 5 seconds
    const timeout = setTimeout(() => {
      setNavReady(true);
      setLoading(false);
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

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      // Start agent auto-connect immediately if already logged in
      if (session) {
        startAgentAutoConnectDeferred();
        // Redeem pending invite if user just logged in with one
        handlePendingInvite(session.user.id).finally(() => {
          refreshHasCircles(session.user.id).then((userHasCircles) => {
            if (!userHasCircles && !isOnboardingComplete()) {
              setShowOnboarding(true);
            }
          }).catch(() => {});
        });
      } else {
        setHasCircles(false);
      }
    }).catch(() => {
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      // Start agent auto-connect when user logs in
      // Only stop on explicit SIGNED_OUT — token refresh events can briefly have null session
      // which was killing all agent connections
      if (session) {
        startAgentAutoConnectDeferred();
        // Redeem pending invite after auth
        if (event === 'SIGNED_IN') {
          handlePendingInvite(session.user.id).finally(() => {
            refreshHasCircles(session.user.id).then((userHasCircles) => {
              if (!userHasCircles && !isOnboardingComplete()) {
                setShowOnboarding(true);
              } else {
                setShowOnboarding(false);
              }
            }).catch(() => {});
          });
        }
      } else if (event === 'SIGNED_OUT') {
        stopAgentAutoConnectDeferred();
        setShowOnboarding(false);
        setHasCircles(false);
      }
    });

    return () => {
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

  // Only use saved nav state if it looks valid (has routes array)
  const validNavState = initialNavState && typeof initialNavState === 'object' && 'routes' in initialNavState
    ? initialNavState as any : undefined;

  return (
    <ErrorBoundary scope="app">
      <ToastProvider>
        <NavigationContainer
          linking={linking}
          initialState={session ? validNavState : undefined}
          onStateChange={(state) => {
            if (state && session) saveNavState(state);
          }}
        >
          <StatusBar barStyle="light-content" />
          {session ? (
            <MainWithHeader />
          ) : (
            <Suspense fallback={<AppRouteFallback />}>
              <AuthNavigator />
            </Suspense>
          )}
        </NavigationContainer>
        {showOnboarding && session && !hasCircles && (
          <Suspense fallback={null}>
            <OnboardingFlow
              userId={session.user.id}
              onComplete={() => setShowOnboarding(false)}
            />
          </Suspense>
        )}
        {session && (
          <Suspense fallback={null}>
            <XPOverlay />
          </Suspense>
        )}
      </ToastProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#000000',
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
});
