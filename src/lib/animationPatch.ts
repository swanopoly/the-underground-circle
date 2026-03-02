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
