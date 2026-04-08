/**
 * StreakFlame — Visual streak indicator that intensifies with consecutive days
 *
 * Tiers:
 *   1-3 days:   Small amber flame
 *   4-7 days:   Medium orange flame with subtle pulse
 *   8-14 days:  Large red-orange flame with particles
 *   15-30 days: Large fire with blue core + floating embers
 *   30+ days:   Legendary purple-gold flame with ring
 *
 * All built with Animated values. Fits 32x32, scales up to 48x48 for large.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, Platform,
} from 'react-native';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;
const EMBER_COUNT = 5;

interface Props {
  streakDays: number;
  accentColor?: string;
}

interface Ember {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
}

type FlameTier = 'small' | 'medium' | 'large' | 'epic' | 'legendary';

function getFlameTier(days: number): FlameTier {
  if (days >= 30) return 'legendary';
  if (days >= 15) return 'epic';
  if (days >= 8) return 'large';
  if (days >= 4) return 'medium';
  return 'small';
}

const TIER_COLORS: Record<FlameTier, { outer: string; inner: string; core: string; glow: string }> = {
  small:     { outer: '#f59e0b', inner: '#fbbf24', core: '#fef3c7', glow: '#f59e0b40' },
  medium:    { outer: '#f97316', inner: '#fb923c', core: '#fef3c7', glow: '#f9731640' },
  large:     { outer: '#ef4444', inner: '#f97316', core: '#fbbf24', glow: '#ef444440' },
  epic:      { outer: '#ef4444', inner: '#f97316', core: '#3b82f6', glow: '#3b82f640' },
  legendary: { outer: '#a855f7', inner: '#fbbf24', core: '#fbbf24', glow: '#a855f780' },
};

export default function StreakFlame({ streakDays, accentColor }: Props) {
  const tier = getFlameTier(streakDays);
  const colors = TIER_COLORS[tier];

  // Size: 32 for small/medium, 40 for large/epic, 48 for legendary
  const size = tier === 'legendary' ? 48 : tier === 'large' || tier === 'epic' ? 40 : 32;

  // Animations
  const pulseScale = useRef(new Animated.Value(1)).current;
  const flicker = useRef(new Animated.Value(0)).current;
  const coreGlow = useRef(new Animated.Value(0.6)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const floatY = useRef(new Animated.Value(0)).current;

  // Embers (for large+ tiers)
  const [embers] = useState<Ember[]>(() =>
    Array.from({ length: EMBER_COUNT }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0),
    }))
  );

  useEffect(() => {
    // Base floating motion for all tiers
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -2, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(floatY, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    ).start();

    // Flicker for all tiers
    Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1, duration: 150 + Math.random() * 200, useNativeDriver: false }),
        Animated.timing(flicker, { toValue: 0, duration: 150 + Math.random() * 200, useNativeDriver: false }),
      ])
    ).start();

    // Pulse for medium+
    if (tier !== 'small') {
      const pulseDuration = tier === 'legendary' ? 600 : tier === 'epic' ? 700 : 800;
      const pulseMax = tier === 'legendary' ? 1.15 : tier === 'epic' ? 1.1 : 1.06;
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: pulseMax, duration: pulseDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(pulseScale, { toValue: 1, duration: pulseDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        ])
      ).start();
    }

    // Core glow for epic+
    if (tier === 'epic' || tier === 'legendary') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(coreGlow, { toValue: 1, duration: 400, useNativeDriver: false }),
          Animated.timing(coreGlow, { toValue: 0.5, duration: 400, useNativeDriver: false }),
        ])
      ).start();
    }

    // Ring rotation for legendary
    if (tier === 'legendary') {
      Animated.loop(
        Animated.timing(ringRotate, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false })
      ).start();
    }

    // Embers for large+
    if (tier === 'large' || tier === 'epic' || tier === 'legendary') {
      embers.forEach((ember, i) => {
        const startDelay = i * 300;
        Animated.loop(
          Animated.sequence([
            Animated.delay(startDelay),
            // Reset
            Animated.parallel([
              Animated.timing(ember.x, { toValue: 0, duration: 0, useNativeDriver: false }),
              Animated.timing(ember.y, { toValue: 0, duration: 0, useNativeDriver: false }),
              Animated.timing(ember.opacity, { toValue: 0, duration: 0, useNativeDriver: false }),
              Animated.timing(ember.scale, { toValue: 0.5, duration: 0, useNativeDriver: false }),
            ]),
            // Float up and fade
            Animated.parallel([
              Animated.timing(ember.x, {
                toValue: (Math.random() - 0.5) * (size * 0.8),
                duration: 1200,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
              }),
              Animated.timing(ember.y, {
                toValue: -(size * 0.6 + Math.random() * size * 0.4),
                duration: 1200,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
              }),
              Animated.sequence([
                Animated.timing(ember.opacity, { toValue: 0.9, duration: 200, useNativeDriver: false }),
                Animated.timing(ember.opacity, { toValue: 0, duration: 1000, useNativeDriver: false }),
              ]),
              Animated.sequence([
                Animated.timing(ember.scale, { toValue: 1, duration: 200, useNativeDriver: false }),
                Animated.timing(ember.scale, { toValue: 0.2, duration: 1000, useNativeDriver: false }),
              ]),
            ]),
          ])
        ).start();
      });
    }
  }, [tier]);

  const flameSize = size * 0.6;
  const innerSize = flameSize * 0.6;
  const coreSize = innerSize * 0.5;

  const ringDeg = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Legendary ring */}
      {tier === 'legendary' && (
        <Animated.View
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderColor: colors.outer + '80',
              borderRadius: size / 2,
              transform: [{ rotate: ringDeg }],
            },
          ]}
        />
      )}

      {/* Glow backdrop */}
      <Animated.View
        style={[
          styles.glow,
          {
            width: size * 0.9,
            height: size * 0.9,
            backgroundColor: colors.glow,
            borderRadius: size * 0.45,
            transform: [{ scale: pulseScale }],
          },
        ]}
      />

      {/* Main flame body */}
      <Animated.View
        style={[
          styles.flame,
          {
            width: flameSize,
            height: flameSize,
            backgroundColor: colors.outer,
            borderRadius: flameSize * 0.35,
            transform: [
              { translateY: floatY },
              { scale: pulseScale },
              { rotate: flicker.interpolate({
                inputRange: [0, 1],
                outputRange: ['-3deg', '3deg'],
              })},
            ],
          },
        ]}
      >
        {/* Inner flame */}
        <Animated.View
          style={[
            styles.flameInner,
            {
              width: innerSize,
              height: innerSize,
              backgroundColor: colors.inner,
              borderRadius: innerSize * 0.35,
              opacity: flicker.interpolate({
                inputRange: [0, 1],
                outputRange: [0.8, 1],
              }),
            },
          ]}
        />

        {/* Core (for epic+) */}
        {(tier === 'epic' || tier === 'legendary') && (
          <Animated.View
            style={[
              styles.flameCore,
              {
                width: coreSize,
                height: coreSize,
                backgroundColor: colors.core,
                borderRadius: coreSize * 0.35,
                opacity: coreGlow,
              },
            ]}
          />
        )}
      </Animated.View>

      {/* Embers */}
      {(tier === 'large' || tier === 'epic' || tier === 'legendary') &&
        embers.map((ember, i) => (
          <Animated.View
            key={i}
            style={[
              styles.ember,
              {
                backgroundColor: i % 2 === 0 ? colors.inner : colors.outer,
                transform: [
                  { translateX: ember.x },
                  { translateY: ember.y },
                  { scale: ember.scale },
                ],
                opacity: ember.opacity,
              },
            ]}
          />
        ))
      }

      {/* Streak day count */}
      <View style={styles.countBadge}>
        <Text style={[styles.countText, { color: colors.outer }]}>{streakDays}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  glow: {
    position: 'absolute',
    ...(Platform.OS === 'web' ? { filter: 'blur(8px)' } as any : {}),
  },
  flame: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00000020',
  },
  flameInner: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flameCore: {
    position: 'absolute',
  },
  ember: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  countBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#0a0a0f',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    paddingHorizontal: 3,
    paddingVertical: 1,
    minWidth: 14,
    alignItems: 'center',
  },
  countText: {
    fontFamily: MONO,
    fontSize: 7,
    fontWeight: '900',
  },
});
