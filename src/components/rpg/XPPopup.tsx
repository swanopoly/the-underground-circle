/**
 * XPPopup — Flashy RPG-style XP notification card
 *
 * Slides in from the right, shows animated XP counter + source label,
 * optional LEVEL UP celebration with pulsing text and edge flash.
 * Sparkle particles float around the XP text.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, Easing, Platform, Dimensions,
} from 'react-native';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;
const { width: SCREEN_W } = Dimensions.get('window');

const SPARKLE_COUNT = 8;

interface SparkleParticle {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
}

interface Props {
  xpAmount: number;
  source: string;
  agentName?: string;
  levelUp?: boolean;
  newLevel?: number;
  newTitle?: string;
  onDismiss: () => void;
}

export default function XPPopup({
  xpAmount, source, agentName, levelUp, newLevel, newTitle, onDismiss,
}: Props) {
  const slideX = useRef(new Animated.Value(SCREEN_W)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const counterValue = useRef(new Animated.Value(0)).current;
  const levelPulse = useRef(new Animated.Value(1)).current;
  const edgeFlash = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0.4)).current;

  const [displayedXP, setDisplayedXP] = useState(0);

  // Sparkle particles
  const [sparkles] = useState<SparkleParticle[]>(() =>
    Array.from({ length: SPARKLE_COUNT }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0),
    }))
  );

  useEffect(() => {
    // Slide in
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: 0,
        duration: 400,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: false,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();

    // Animated counter
    const counterId = counterValue.addListener(({ value }) => {
      setDisplayedXP(Math.round(value));
    });
    Animated.timing(counterValue, {
      toValue: xpAmount,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Golden glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.8, duration: 600, useNativeDriver: false }),
        Animated.timing(glowOpacity, { toValue: 0.4, duration: 600, useNativeDriver: false }),
      ])
    ).start();

    // Sparkle particles
    sparkles.forEach((p, i) => {
      const delay = i * 100;
      const angle = (i / SPARKLE_COUNT) * Math.PI * 2;
      const radius = 30 + Math.random() * 20;
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(p.x, { toValue: Math.cos(angle) * radius, duration: 1200, useNativeDriver: false }),
            Animated.timing(p.y, { toValue: Math.sin(angle) * radius, duration: 1200, useNativeDriver: false }),
            Animated.timing(p.opacity, { toValue: 1, duration: 400, useNativeDriver: false }),
            Animated.timing(p.scale, { toValue: 1, duration: 400, useNativeDriver: false }),
          ]),
          Animated.parallel([
            Animated.timing(p.opacity, { toValue: 0, duration: 600, useNativeDriver: false }),
            Animated.timing(p.scale, { toValue: 0.3, duration: 600, useNativeDriver: false }),
          ]),
          Animated.parallel([
            Animated.timing(p.x, { toValue: 0, duration: 0, useNativeDriver: false }),
            Animated.timing(p.y, { toValue: 0, duration: 0, useNativeDriver: false }),
          ]),
        ])
      ).start();
    });

    // Level-up effects
    if (levelUp) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(levelPulse, { toValue: 1.15, duration: 400, useNativeDriver: false }),
          Animated.timing(levelPulse, { toValue: 1.0, duration: 400, useNativeDriver: false }),
        ])
      ).start();

      // Edge flash
      Animated.sequence([
        Animated.timing(edgeFlash, { toValue: 1, duration: 100, useNativeDriver: false }),
        Animated.timing(edgeFlash, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]).start();
    }

    // Auto-dismiss: slide out after 3s
    const dismissTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideX, {
          toValue: SCREEN_W,
          duration: 300,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(cardOpacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: false,
        }),
      ]).start(() => onDismiss());
    }, 3000);

    return () => {
      clearTimeout(dismissTimer);
      counterValue.removeListener(counterId);
    };
  }, []);

  const handlePress = () => {
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: SCREEN_W,
        duration: 200,
        useNativeDriver: false,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start(() => onDismiss());
  };

  const xpColor = levelUp ? '#fbbf24' : '#fbbf24';
  const borderColor = levelUp ? '#fbbf24' : '#6366f1';

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateX: slideX }],
          opacity: cardOpacity,
          borderColor: borderColor + '80',
        },
      ]}
    >
      {/* Edge flash overlay for level-up */}
      {levelUp && (
        <Animated.View
          style={[
            styles.edgeFlash,
            { opacity: edgeFlash, backgroundColor: '#fbbf24' },
          ]}
        />
      )}

      <Pressable onPress={handlePress} style={styles.inner}>
        {/* XP amount with sparkles */}
        <View style={styles.xpRow}>
          <View style={styles.xpContainer}>
            {/* Sparkle particles */}
            {sparkles.map((p, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.sparkle,
                  {
                    transform: [
                      { translateX: p.x },
                      { translateY: p.y },
                      { scale: p.scale },
                    ],
                    opacity: p.opacity,
                  },
                ]}
              />
            ))}

            {/* Glow behind XP text */}
            <Animated.View style={[styles.xpGlow, { opacity: glowOpacity }]} />

            <Text style={styles.xpText}>+{displayedXP} XP</Text>
          </View>

          {/* Level badge */}
          {levelUp && newLevel != null && (
            <Animated.View
              style={[
                styles.levelBadge,
                { transform: [{ scale: levelPulse }] },
              ]}
            >
              <Text style={styles.levelUpLabel}>LEVEL UP!</Text>
              <Text style={styles.levelNumber}>{newLevel}</Text>
            </Animated.View>
          )}
        </View>

        {/* Source label */}
        <Text style={styles.sourceText}>{source}</Text>

        {/* Agent name */}
        {agentName && (
          <Text style={styles.agentText}>{agentName}</Text>
        )}

        {/* New title on level up */}
        {levelUp && newTitle && (
          <View style={styles.titleRow}>
            <View style={styles.titleDivider} />
            <Text style={styles.newTitleText}>{newTitle}</Text>
            <View style={styles.titleDivider} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 240,
    backgroundColor: '#0f0f18',
    borderWidth: 2,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
    // Pixel-art isometric shadow
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #050508, 0 0 16px rgba(251,191,36,0.15)' } as any : {
      shadowColor: '#fbbf24',
      shadowOffset: { width: 4, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 0,
    }),
  },
  edgeFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  inner: {
    padding: 12,
    zIndex: 2,
  },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  xpContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  xpGlow: {
    position: 'absolute',
    width: 100,
    height: 32,
    backgroundColor: '#fbbf24',
    borderRadius: 2,
    ...(Platform.OS === 'web' ? { filter: 'blur(12px)' } as any : {}),
  },
  xpText: {
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: '900',
    color: '#fbbf24',
    letterSpacing: 2,
    textShadowColor: '#fbbf2480',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  sparkle: {
    position: 'absolute',
    width: 4,
    height: 4,
    backgroundColor: '#fbbf24',
    borderRadius: 2,
  },
  sourceText: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    color: '#8b8ba0',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  agentText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '600',
    color: '#6366f1',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  levelBadge: {
    backgroundColor: '#fbbf2418',
    borderWidth: 2,
    borderColor: '#fbbf2460',
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  levelUpLabel: {
    fontFamily: MONO,
    fontSize: 7,
    fontWeight: '900',
    color: '#fbbf24',
    letterSpacing: 2,
  },
  levelNumber: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: '900',
    color: '#fbbf24',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  titleDivider: {
    flex: 1,
    height: 1,
    backgroundColor: '#fbbf2430',
  },
  newTitleText: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '800',
    color: '#fbbf24',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
