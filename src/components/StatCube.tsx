/**
 * StatCube — 3D-styled stat card with perspective transforms,
 * animated entrance, and glowing accent border.
 * Inspired by Giza's depth effects + Omni's interactive tiles.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Platform } from 'react-native';

interface Props {
  label: string;
  value: string;
  icon: string;
  color: string;
  subtitle?: string;
  onPress?: () => void;
  delay?: number;
}

export default function StatCube({ label, value, icon, color, subtitle, onPress, delay = 0 }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.cubeOuter,
        {
          opacity: fadeAnim,
          transform: [
            { translateY: slideAnim },
            { scale: scaleAnim },
            ...(Platform.OS === 'web' ? [
              { perspective: 800 as any },
              { rotateX: '-3deg' as any },
              { rotateY: '3deg' as any },
            ] : []),
          ],
        },
      ]}
    >
      <Pressable onPress={onPress} style={[styles.cube, { borderBottomColor: color }]}>
        {/* Glow effect — bottom edge */}
        <View style={[styles.glowEdge, { backgroundColor: color + '30' }]} />

        {/* Top layer — shadow creates depth */}
        <View style={styles.cubeTop}>
          <View style={[styles.iconBadge, { backgroundColor: color + '18' }]}>
            <Text style={styles.icon}>{icon}</Text>
          </View>
          <Text style={styles.label}>{label}</Text>
        </View>

        {/* Value */}
        <Text style={[styles.value, { color }]}>{value}</Text>

        {/* Subtitle */}
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

        {/* Depth shadow layers */}
        <View style={[styles.shadowLayer1, { borderColor: color + '08' }]} />
        <View style={[styles.shadowLayer2, { borderColor: color + '04' }]} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cubeOuter: {
    flex: 1,
    minWidth: 140,
  },
  cube: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderBottomWidth: 3,
    borderRadius: 14,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
    // Multi-layer shadow for depth
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 4px 20px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)',
    } as any : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    }),
  },
  glowEdge: {
    position: 'absolute',
    bottom: 0,
    left: 8,
    right: 8,
    height: 12,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? {
      filter: 'blur(8px)',
    } as any : {}),
  },
  cubeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: { fontSize: 14 },
  label: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    fontSize: 24,
    fontWeight: '900',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  subtitle: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  shadowLayer1: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 13,
    borderWidth: 1,
    zIndex: -1,
  },
  shadowLayer2: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: -2,
  },
});
