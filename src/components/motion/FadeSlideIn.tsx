/**
 * FadeSlideIn — Fades in + slides up children on mount.
 *
 * Uses React Native's built-in Animated API (no extra deps).
 * `useNativeDriver: false` for web compatibility.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

interface Props {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  slideDistance?: number;
}

export default function FadeSlideIn({
  children,
  delay = 0,
  duration = 300,
  slideDistance = 12,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(slideDistance)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: false,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: false,
        }),
      ]).start();
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, duration, slideDistance, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}
