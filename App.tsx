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

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      // Start agent auto-connect immediately if already logged in
      if (session) {
        startAgentAutoConnect();
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
