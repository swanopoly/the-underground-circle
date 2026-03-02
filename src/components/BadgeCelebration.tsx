/**
 * BadgeCelebration — full-screen celebration overlay when a badge is earned
 * Confetti particles + Halo badge reveal + agent dance trigger
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, Platform, Dimensions,
} from 'react-native';
import { Badge, TIER_COLORS } from '../lib/badges';
import HaloBadge from './HaloBadge';
interface Props {
  badge: Badge | null;
  onDismiss: () => void;
}

const { width: SW, height: SH } = Dimensions.get('window');
const PARTICLE_COUNT = 60;

interface Particle {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  rotate: Animated.Value;
  scale: Animated.Value;
  color: string;
  emoji: string;
  startX: number;
}

const CONFETTI_COLORS = ['#ffd700', '#00FF9C', '#6366f1', '#f59e0b', '#ef4444', '#06b6d4', '#e5e4e2'];
const CONFETTI_EMOJIS = ['⭐', '✨', '💫', '🌟', '⚡', '🎯', '🔥'];

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    opacity: new Animated.Value(1),
    rotate: new Animated.Value(0),
    scale: new Animated.Value(1),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    emoji: CONFETTI_EMOJIS[i % CONFETTI_EMOJIS.length],
    startX: (SW / PARTICLE_COUNT) * i,
  }));
}

export default function BadgeCelebration({ badge, onDismiss }: Props) {
  const [particles] = useState<Particle[]>(makeParticles);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(40)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const shockwaveScale = useRef(new Animated.Value(0.3)).current;
  const shockwaveOpacity = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (!badge) return;

    // Backdrop
    Animated.timing(backdropOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Shockwave ring
    Animated.parallel([
      Animated.timing(shockwaveScale, { toValue: 3, duration: 800, useNativeDriver: true }),
      Animated.timing(shockwaveOpacity, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start();

    // Badge entrance — bouncy
    Animated.spring(badgeScale, {
      toValue: 1,
      tension: 60,
      friction: 6,
      useNativeDriver: true,
      delay: 200,
    } as any).start();
    Animated.timing(badgeOpacity, { toValue: 1, duration: 200, delay: 200, useNativeDriver: true }).start();

    // Title slide up
    Animated.parallel([
      Animated.timing(titleY, { toValue: 0, duration: 400, delay: 600, useNativeDriver: true }),
      Animated.timing(titleOpacity, { toValue: 1, duration: 400, delay: 600, useNativeDriver: true }),
    ]).start();

    // Confetti burst
    particles.forEach((p, i) => {
      const delay = Math.random() * 400;
      const destX = (Math.random() - 0.5) * SW * 1.5;
      const destY = SH * 0.6 + Math.random() * SH * 0.4;
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(p.x, { toValue: destX, duration: 1800, useNativeDriver: true }),
          Animated.timing(p.y, { toValue: destY, duration: 1800, useNativeDriver: true }),
          Animated.timing(p.opacity, { toValue: 0, duration: 1800, useNativeDriver: true }),
          Animated.timing(p.rotate, { toValue: Math.random() * 720 - 360, duration: 1800, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(p.scale, { toValue: 1.5, duration: 300, useNativeDriver: true }),
            Animated.timing(p.scale, { toValue: 0.5, duration: 1500, useNativeDriver: true }),
          ]),
        ]),
      ]).start();
    });

    // Auto-dismiss after 5s
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [badge]);

  if (!badge) return null;

  const tier = TIER_COLORS[badge.tier];

  return (
    <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
      {/* Confetti particles */}
      {particles.map((p, i) => (
        <Animated.Text
          key={i}
          style={[
            styles.particle,
            {
              left: p.startX,
              top: SH * 0.35,
              opacity: p.opacity,
              transform: [
                { translateX: p.x },
                { translateY: p.y },
                { rotate: p.rotate.interpolate({ inputRange: [-720, 720], outputRange: ['-720deg', '720deg'] }) },
                { scale: p.scale },
              ],
            },
          ]}
        >
          {p.emoji}
        </Animated.Text>
      ))}

      {/* Shockwave */}
      <Animated.View
        style={[
          styles.shockwave,
          {
            borderColor: tier.border,
            opacity: shockwaveOpacity,
            transform: [{ scale: shockwaveScale }],
          },
        ]}
      />

      {/* Main content */}
      <Pressable style={styles.content} onPress={onDismiss}>

        {/* BADGE UNLOCKED header */}
        <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleY }] }}>
          <Text style={styles.headerLabel}>BADGE UNLOCKED</Text>
        </Animated.View>

        {/* The badge */}
        <Animated.View style={{
          transform: [{ scale: badgeScale }],
          opacity: badgeOpacity,
          marginVertical: 32,
        }}>
          <HaloBadge badge={badge} earned size="lg" animate />
        </Animated.View>

        {/* Badge name + tier */}
        <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleY }], alignItems: 'center' }}>
          <Text style={[styles.badgeName, { color: tier.border }]}>{badge.name.toUpperCase()}</Text>
          <Text style={styles.badgeDesc}>{badge.description}</Text>
          <Text style={[styles.badgeLore, { color: tier.border + 'cc' }]}>{badge.lore}</Text>
        </Animated.View>

        {/* Dismiss hint */}
        <Text style={styles.dismissHint}>Tap to continue</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    fontSize: 16,
  },
  shockwave: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 4,
    opacity: 0,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  headerLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: 4,
  },
  badgeName: {
    fontSize: 28,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: 8,
  },
  badgeDesc: {
    color: '#aaa',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 16,
  },
  badgeLore: {
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  dismissHint: {
    position: 'absolute',
    bottom: -80,
    color: '#444',
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});
