import './src/lib/animationPatch'; // Must be first — patches Animated.loop for web
import React, { useState, useEffect, useRef } from 'react';
import { StatusBar, View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import AuthNavigator from './src/navigation/AuthNavigator';
import MainNavigator from './src/navigation/MainNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';
import AppHeader from './src/components/AppHeader';
import { startAgentAutoConnect, stopAgentAutoConnect } from './src/lib/agentAutoConnect';
import { acceptInvite, lookupInvite } from './src/lib/invites';
import OnboardingFlow, { isOnboardingComplete } from './src/components/OnboardingFlow';

const PENDING_INVITE_KEY = 'uc_pending_invite';

/** Redeem a pending invite token after login */
async function handlePendingInvite(userId: string) {
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
      // Navigation will pick up the new circle on next render
    }
  } catch (e) {
    console.warn('handlePendingInvite error:', e);
  }
}

/** Check URL params for invite token or github_connected callback */
function getUrlParams(): { invite?: string; githubConnected?: boolean; circleId?: string } {
  if (Platform.OS !== 'web') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite') || undefined;
    const githubConnected = params.get('github_connected') === '1';
    const circleId = params.get('circle_id') || undefined;
    // Clean URL params after reading (don't leave tokens in the URL bar)
    if (invite || githubConnected) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    return { invite, githubConnected, circleId };
  } catch {
    return {};
  }
}

/** Also handle /join/:code path-based invite URLs */
function getInviteFromPath(): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  try {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z0-9]+)$/);
    if (match) {
      window.history.replaceState({}, '', '/');
      return match[1];
    }
  } catch {}
  return undefined;
}

function MainWithHeader() {
  const navigation = useNavigation();
  return (
    <View style={{ flex: 1 }}>
      <AppHeader navigation={navigation} />
      <MainNavigator />
    </View>
  );
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

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [navReady, setNavReady] = useState(false);
  const [initialNavState, setInitialNavState] = useState<object | undefined>(undefined);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
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
        startAgentAutoConnect();
        // Redeem pending invite if user just logged in with one
        handlePendingInvite(session.user.id);
        // Show onboarding for new users
        if (!isOnboardingComplete()) {
          setShowOnboarding(true);
        }
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
        startAgentAutoConnect();
        // Redeem pending invite after auth
        if (event === 'SIGNED_IN') {
          handlePendingInvite(session.user.id);
        }
      } else if (event === 'SIGNED_OUT') {
        stopAgentAutoConnect();
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
    <ErrorBoundary>
      <NavigationContainer
        initialState={session ? validNavState : undefined}
        onStateChange={(state) => {
          if (state && session) saveNavState(state);
        }}
      >
        <StatusBar barStyle="light-content" />
        {session ? <MainWithHeader /> : <AuthNavigator />}
      </NavigationContainer>
      {showOnboarding && session && (
        <OnboardingFlow
          userId={session.user.id}
          onComplete={() => setShowOnboarding(false)}
        />
      )}
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
