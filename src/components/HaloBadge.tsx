/**
 * HaloBadge — renders a single badge in Xbox Halo style
 * Hexagonal/shield shape with tier glow, center icon, and name plate
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { Badge, TIER_COLORS } from '../lib/badges';

interface Props {
  badge: Badge;
  earned?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean; // pulse glow on earn
}

const SIZES = {
  sm: { outer: 54, inner: 42, icon: 18, name: 7 },
  md: { outer: 80, inner: 62, icon: 26, name: 9 },
  lg: { outer: 120, inner: 94, icon: 40, name: 11 },
};

export default function HaloBadge({ badge, earned = true, size = 'md', animate = false }: Props) {
  const tier = TIER_COLORS[badge.tier];
  const dim = SIZES[size];
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animate || !earned) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, earned]);

  useEffect(() => {
    if (!animate) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      from: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 8,
    } as any).start();
  }, [animate]);

  const opacity = earned ? 1 : 0.25;

  return (
    <View style={[styles.wrapper, { width: dim.outer, height: dim.outer, opacity }]}>
      {/* Glow ring */}
      {earned && (
        <Animated.View
          style={[
            styles.glowRing,
            {
              width: dim.outer + 8,
              height: dim.outer + 8,
              borderRadius: (dim.outer + 8) / 2,
              backgroundColor: tier.glow,
              opacity: glowAnim,
            },
          ]}
        />
      )}

      {/* Outer hexagon shell */}
      <Animated.View
        style={[
          styles.outer,
          {
            width: dim.outer,
            height: dim.outer,
            borderRadius: badge.shape === 'circle' ? dim.outer / 2
              : badge.shape === 'diamond' ? 4
              : badge.shape === 'star' ? 12
              : badge.shape === 'shield' ? 10
              : 10, // hexagon
            backgroundColor: tier.bg,
            borderColor: tier.border,
            transform: [
              { scale: scaleAnim },
              ...(badge.shape === 'diamond' ? [{ rotate: '45deg' }] : []),
            ],
          },
        ]}
      >
        {/* Inner plate */}
        <View
          style={[
            styles.inner,
            {
              width: dim.inner,
              height: dim.inner,
              borderRadius: badge.shape === 'circle' ? dim.inner / 2
                : badge.shape === 'diamond' ? 2
                : 6,
              backgroundColor: earned ? tier.border + '18' : '#111',
              borderColor: tier.border + '40',
              transform: badge.shape === 'diamond' ? [{ rotate: '-45deg' }] : [],
            },
          ]}
        >
          {/* Center glyph */}
          <Text style={[
            styles.icon,
            { fontSize: dim.icon },
            badge.shape === 'diamond' && { transform: [{ rotate: '-45deg' }] },
          ]}>
            {badge.icon}
          </Text>
        </View>
      </Animated.View>

      {/* Tier label strip */}
      <View style={[styles.tierStrip, { backgroundColor: tier.border + '20', borderColor: tier.border + '50' }]}>
        <Text style={[styles.tierText, { color: tier.border, fontSize: dim.name }]}>
          {TIER_COLORS[badge.tier].label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    top: -4,
    left: -4,
  },
  outer: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
  inner: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    textAlign: 'center',
  },
  tierStrip: {
    position: 'absolute',
    bottom: -2,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  tierText: {
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});
