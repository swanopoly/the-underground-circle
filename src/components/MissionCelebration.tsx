/**
 * MissionCelebration — overlay animation when a mission is completed
 * Lighter than BadgeCelebration — quick burst of particles + mission title
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Platform, Dimensions } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');
const PARTICLE_COUNT = 30;

const COLORS = ['#22c55e', '#6366f1', '#f59e0b', '#6366f1', '#a855f7', '#ec4899'];

interface Props {
  missionTitle: string;
  taskCount: number;
  onDismiss: () => void;
}

export default function MissionCelebration({ missionTitle, taskCount, onDismiss }: Props) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.5)).current;
  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      x: new Animated.Value(SW / 2),
      y: new Animated.Value(SH / 2),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(0),
      color: COLORS[i % COLORS.length],
    }))
  ).current;

  useEffect(() => {
    // Fade in overlay
    Animated.timing(fadeIn, { toValue: 1, duration: 300, useNativeDriver: false }).start();

    // Title bounce in
    Animated.spring(titleScale, { toValue: 1, friction: 5, tension: 100, useNativeDriver: false }).start();

    // Explode particles outward from center
    const anims = particles.map((p, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const distance = 80 + Math.random() * 160;
      const targetX = SW / 2 + Math.cos(angle) * distance;
      const targetY = SH / 2 + Math.sin(angle) * distance - 100;

      return Animated.parallel([
        Animated.timing(p.x, { toValue: targetX, duration: 600 + Math.random() * 400, useNativeDriver: false }),
        Animated.timing(p.y, { toValue: targetY - 50, duration: 600 + Math.random() * 400, useNativeDriver: false }),
        Animated.sequence([
          Animated.timing(p.scale, { toValue: 1 + Math.random() * 0.5, duration: 200, useNativeDriver: false }),
          Animated.timing(p.scale, { toValue: 0, duration: 800, useNativeDriver: false }),
        ]),
        Animated.sequence([
          Animated.delay(400),
          Animated.timing(p.opacity, { toValue: 0, duration: 600, useNativeDriver: false }),
        ]),
      ]);
    });

    Animated.parallel(anims).start();

    // Auto-dismiss after 3s
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <Pressable style={styles.overlay} onPress={onDismiss}>
      <Animated.View style={[styles.backdrop, { opacity: fadeIn }]} />

      {/* Particles */}
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[styles.particle, {
            backgroundColor: p.color,
            left: p.x,
            top: p.y,
            opacity: p.opacity,
            transform: [{ scale: p.scale }],
          }]}
        />
      ))}

      {/* Title card */}
      <Animated.View style={[styles.card, { transform: [{ scale: titleScale }] }]}>
        <Text style={styles.checkmark}>OK</Text>
        <Text style={styles.title}>MISSION COMPLETE</Text>
        <Text style={styles.missionName}>{missionTitle}</Text>
        <Text style={styles.stats}>{taskCount} task{taskCount !== 1 ? 's' : ''} shipped</Text>
        <Text style={styles.tap}>tap to dismiss</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  particle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  card: {
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  checkmark: {
    color: '#22c55e',
    fontSize: 32,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8,
    borderWidth: 3,
    borderColor: '#22c55e',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  missionName: {
    color: '#6366f1',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  stats: {
    color: '#888',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tap: {
    color: '#444',
    fontSize: 11,
    marginTop: 16,
  },
});
