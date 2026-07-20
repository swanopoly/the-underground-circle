/**
 * Web animation safety patch
 *
 * On React Native Web, Animated with useNativeDriver: true causes
 * "Maximum update depth exceeded" because every animation frame triggers:
 * AnimatedValue._updateValue → _flush → AnimatedProps.update →
 * useAnimatedProps → dispatchReducerAction (setState)
 *
 * With multiple simultaneous animations this cascades past React's limit.
 *
 * Fix: On web, force useNativeDriver: false for all animations AND
 * disable Animated.loop entirely (all loops are cosmetic).
 *
 * Import once at app startup (App.tsx) before any components mount.
 */
import { Animated, Platform } from 'react-native';

// ─── Instant dark background — eliminates white flash on page load ──────────
// This runs before ANY React rendering happens (imported first in App.tsx).
if (typeof document !== 'undefined') {
  const s = document.documentElement.style;
  s.backgroundColor = '#0A0A0A';
  s.margin = '0';
  s.padding = '0';
  s.minHeight = '100vh';
  document.body.style.backgroundColor = '#0A0A0A';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  // Also set root div if it exists
  const root = document.getElementById('root');
  if (root) {
    root.style.backgroundColor = '#0A0A0A';
    root.style.minHeight = '100vh';
  }
}

if (Platform.OS === 'web') {
  // Suppress known RN 0.81 deprecation warnings for shadow/textShadow/pointerEvents.
  // These are cosmetic-only — styles still render fine. Hundreds of shadow props exist
  // across PixelAgent.tsx and other pixel art components; wrapping each is impractical.
  const SUPPRESSED = [
    '"shadow*" style props are deprecated',
    '"textShadow*" style props are deprecated',
    'props.pointerEvents is deprecated',
    'Cannot record touch end without a touch start.',
    'Multiple instances of Three.js being imported.',
  ];
  const origWarn = console.warn;
  console.warn = function (...args: any[]) {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (SUPPRESSED.some(s => msg.includes(s))) return;
    origWarn.apply(console, args);
  };
}

if (Platform.OS === 'web') {
  // 1. Kill all Animated.loop — return no-op
  const noopAnim: Animated.CompositeAnimation = {
    start: (cb?: Animated.EndCallback) => { cb?.({ finished: true }); },
    stop: () => {},
    reset: () => {},
  };

  (Animated as any).loop = function (): Animated.CompositeAnimation {
    return noopAnim;
  };

  // 2. Force useNativeDriver: false on all timing/spring/decay to
  //    prevent the useAnimatedProps cascade
  const origTiming = Animated.timing;
  (Animated as any).timing = function (
    value: Animated.Value | Animated.ValueXY,
    config: Animated.TimingAnimationConfig,
  ) {
    return origTiming(value, { ...config, useNativeDriver: false });
  };

  const origSpring = Animated.spring;
  (Animated as any).spring = function (
    value: Animated.Value | Animated.ValueXY,
    config: Animated.SpringAnimationConfig,
  ) {
    return origSpring(value, { ...config, useNativeDriver: false });
  };

  const origDecay = Animated.decay;
  (Animated as any).decay = function (
    value: Animated.Value | Animated.ValueXY,
    config: Animated.DecayAnimationConfig,
  ) {
    return origDecay(value, { ...config, useNativeDriver: false });
  };
}
