/**
 * HaloBadge — renders a single badge in Xbox Halo style
 * Hexagonal/shield shape with tier glow, center icon, and name plate
 *
 * Layout: wrapper is a COLUMN (badge + tier strip stacked), not overlapping.
 * This prevents the tier strip from bleeding outside the declared height.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Badge, TIER_COLORS } from '../lib/badges';

interface Props {
  badge: Badge;
  earned?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
}

const SIZES = {
  sm: { outer: 48, inner: 36, icon: 16, name: 6,  strip: 14 },
  md: { outer: 72, inner: 56, icon: 24, name: 8,  strip: 18 },
  lg: { outer: 110, inner: 86, icon: 38, name: 10, strip: 22 },
};

export default function HaloBadge({ badge, earned = true, size = 'md', animate = false }: Props) {
  const tier = TIER_COLORS[badge.tier];
  const dim = SIZES[size];
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const scaleAnim = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate || !earned) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1,   duration: 1200, useNativeDriver: true }),
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
      useNativeDriver: true,
      tension: 80,
      friction: 8,
    } as any).start();
  }, [animate]);

  const borderRadius =
    badge.shape === 'circle'  ? dim.outer / 2 :
    badge.shape === 'diamond' ? 4 :
    badge.shape === 'star'    ? 12 :
    badge.shape === 'shield'  ? 10 :
    10; // hexagon

  const innerRadius =
    badge.shape === 'circle'  ? dim.inner / 2 :
    badge.shape === 'diamond' ? 2 :
    6;

  return (
    // Column wrapper: badge body on top, tier strip below — no absolute positioning
    <View style={[st.col, { opacity: earned ? 1 : 0.28 }]}>
      {/* Glow ring — absolute inside this column row */}
      <View style={[st.badgeArea, { width: dim.outer, height: dim.outer }]}>
        {earned && (
          <Animated.View
            style={[
              st.glowRing,
              {
                width: dim.outer + 10,
                height: dim.outer + 10,
                borderRadius: (dim.outer + 10) / 2,
                backgroundColor: tier.glow,
                opacity: glowAnim,
                top: -5, left: -5,
              },
            ]}
          />
        )}

        {/* Outer shell */}
        <Animated.View
          style={[
            st.outer,
            {
              width: dim.outer,
              height: dim.outer,
              borderRadius,
              backgroundColor: tier.bg,
              borderColor: earned ? tier.border : '#333',
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
              st.inner,
              {
                width: dim.inner,
                height: dim.inner,
                borderRadius: innerRadius,
                backgroundColor: earned ? tier.border + '18' : '#0a0a0a',
                borderColor: earned ? tier.border + '44' : '#222',
                transform: badge.shape === 'diamond' ? [{ rotate: '-45deg' }] : [],
              },
            ]}
          >
            <Text
              style={[
                st.icon,
                { fontSize: dim.icon },
                badge.shape === 'diamond' && { transform: [{ rotate: '-45deg' }] },
              ]}
            >
              {badge.icon}
            </Text>
          </View>
        </Animated.View>
      </View>

      {/* Tier strip — normal flow, sits below the badge, no overlap */}
      <View
        style={[
          st.tierStrip,
          {
            backgroundColor: earned ? tier.border + '22' : '#111',
            borderColor: earned ? tier.border + '55' : '#222',
            marginTop: 5,
            paddingHorizontal: size === 'lg' ? 8 : size === 'md' ? 6 : 4,
            paddingVertical: size === 'lg' ? 2 : 1,
          },
        ]}
      >
        <Text style={[st.tierText, { color: earned ? tier.border : '#333', fontSize: dim.name }]}>
          {tier.label}
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  col: {
    alignItems: 'center',
  },
  badgeArea: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowRing: {
    position: 'absolute',
  },
  outer: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 8,
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
    borderWidth: 1,
    borderRadius: 4,
  },
  tierText: {
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});
