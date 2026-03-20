/**
 * HaloBadge — renders a single badge in Xbox Halo style
 * Hexagonal/shield shape with tier glow, center icon, and name plate
 *
 * Tier-based animation hierarchy:
 *   Bronze:    Subtle pulse glow
 *   Silver:    Pulse glow + shimmer sweep
 *   Gold:      Pulse glow + orbiting ring
 *   Platinum:  Pulse glow + sparkle particles
 *   Legendary: Rainbow glow + floating bob + particle trail + larger size
 *
 * Layout: wrapper is a COLUMN (badge + tier strip stacked), not overlapping.
 * This prevents the tier strip from bleeding outside the declared height.
 */
import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Badge, TIER_COLORS } from '../lib/badges';
import PixelBadgeIcon, { hasPixelSprite } from './PixelBadgeIcon';

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

// Rainbow colors for legendary tier
const RAINBOW_COLORS = ['#FF0000', '#FF7700', '#FFD700', '#00FF9C', '#00BFFF', '#8B5CF6', '#FF00FF'];

export default function HaloBadge({ badge, earned = true, size = 'md', animate = false }: Props) {
  const tier = TIER_COLORS[badge.tier];
  const isLegendary = badge.tier === 'legendary';
  const dim = isLegendary && earned
    ? {
        outer: Math.round(SIZES[size].outer * 1.12),
        inner: Math.round(SIZES[size].inner * 1.12),
        icon: Math.round(SIZES[size].icon * 1.12),
        name: SIZES[size].name,
        strip: SIZES[size].strip,
      }
    : SIZES[size];

  // ── Shared animations ──────────────────────────────────────────────────────
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const scaleAnim = useRef(new Animated.Value(animate ? 0 : 1)).current;

  // ── Silver: shimmer sweep ──────────────────────────────────────────────────
  const shimmerAnim = useRef(new Animated.Value(-dim.outer)).current;

  // ── Gold: orbit ring rotation ──────────────────────────────────────────────
  const orbitAnim = useRef(new Animated.Value(0)).current;

  // ── Platinum: sparkle particles (4 sparkles) ──────────────────────────────
  const sparkleAnims = useMemo(() =>
    Array.from({ length: 4 }, () => ({
      opacity: new Animated.Value(0),
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
    })),
  []);

  // ── Legendary: rainbow glow + float bob ───────────────────────────────────
  const rainbowAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const legendaryGlowOpacity = useRef(new Animated.Value(0.3)).current;

  // ── Start animations ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!animate || !earned) return;

    const animations: Animated.CompositeAnimation[] = [];

    // Base glow pulse (all tiers)
    animations.push(
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
        ]),
      ),
    );

    // Silver: shimmer sweep every 3s
    if (badge.tier === 'silver') {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(shimmerAnim, {
              toValue: dim.outer * 1.5,
              duration: 800,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.delay(2200),
            Animated.timing(shimmerAnim, {
              toValue: -dim.outer,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ),
      );
    }

    // Gold: orbiting ring
    if (badge.tier === 'gold') {
      animations.push(
        Animated.loop(
          Animated.timing(orbitAnim, {
            toValue: 1,
            duration: 4000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ),
      );
    }

    // Platinum + Legendary: sparkle particles (platinum gets white, legendary gets green)
    if (badge.tier === 'platinum' || badge.tier === 'legendary') {
      sparkleAnims.forEach((sparkle, i) => {
        const startDelay = i * 600;
        const runSparkle = () => {
          // Random offset from center
          const angle = Math.random() * Math.PI * 2;
          const radius = dim.outer * 0.35 + Math.random() * dim.outer * 0.25;
          const tx = Math.cos(angle) * radius;
          const ty = Math.sin(angle) * radius;

          sparkle.translateX.setValue(tx);
          sparkle.translateY.setValue(ty);

          Animated.sequence([
            Animated.delay(startDelay),
            Animated.timing(sparkle.opacity, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(sparkle.opacity, {
              toValue: 0,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.delay(800),
          ]).start(() => runSparkle());
        };
        runSparkle();
      });
    }

    // Legendary: rainbow cycle + floating bob + glow pulse
    if (badge.tier === 'legendary') {
      animations.push(
        Animated.loop(
          Animated.timing(rainbowAnim, {
            toValue: RAINBOW_COLORS.length,
            duration: RAINBOW_COLORS.length * 800,
            easing: Easing.linear,
            useNativeDriver: false, // backgroundColor needs JS driver
          }),
        ),
      );

      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(floatAnim, {
              toValue: -4,
              duration: 1500,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(floatAnim, {
              toValue: 4,
              duration: 1500,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(legendaryGlowOpacity, {
              toValue: 0.8,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(legendaryGlowOpacity, {
              toValue: 0.3,
              duration: 1000,
              useNativeDriver: true,
            }),
          ]),
        ),
      );
    }

    animations.forEach(a => a.start());

    return () => {
      animations.forEach(a => a.stop());
      // Also stop recursive sparkle animations
      sparkleAnims.forEach(s => {
        s.opacity.stopAnimation();
        s.translateX.stopAnimation();
        s.translateY.stopAnimation();
      });
    };
  }, [animate, earned, badge.tier]);

  // Entry scale animation
  useEffect(() => {
    if (!animate) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 8,
    } as any).start();
  }, [animate]);

  // Interpolations
  const orbitRotation = orbitAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const rainbowColor = rainbowAnim.interpolate({
    inputRange: RAINBOW_COLORS.map((_, i) => i),
    outputRange: RAINBOW_COLORS,
    extrapolate: 'clamp',
  });

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

  // The outer badge area needs extra room for effects
  const effectPadding = isLegendary && earned ? 12 : badge.tier === 'platinum' && earned ? 8 : 0;

  return (
    // Column wrapper: badge body on top, tier strip below — no absolute positioning
    <View style={[st.col, { opacity: earned ? 1 : 0.28 }]}>
      {/* Glow ring — absolute inside this column row */}
      <View style={[st.badgeArea, {
        width: dim.outer + effectPadding * 2,
        height: dim.outer + effectPadding * 2,
      }]}>

        {/* ── Legendary: rainbow glow ring ── */}
        {earned && badge.tier === 'legendary' && (
          <Animated.View
            style={[
              st.rainbowGlow,
              {
                width: dim.outer + 18,
                height: dim.outer + 18,
                borderRadius: (dim.outer + 18) / 2,
                backgroundColor: rainbowColor,
                opacity: legendaryGlowOpacity,
                top: effectPadding - 9,
                left: effectPadding - 9,
              },
            ]}
          />
        )}

        {/* ── Standard glow ring (non-legendary) ── */}
        {earned && badge.tier !== 'legendary' && (
          <Animated.View
            style={[
              st.glowRing,
              {
                width: dim.outer + 10,
                height: dim.outer + 10,
                borderRadius: (dim.outer + 10) / 2,
                backgroundColor: tier.glow,
                opacity: glowAnim,
                top: effectPadding - 5,
                left: effectPadding - 5,
              },
            ]}
          />
        )}

        {/* ── Gold: orbiting ring ── */}
        {earned && badge.tier === 'gold' && (
          <Animated.View
            style={[
              st.orbitRing,
              {
                width: dim.outer + 14,
                height: dim.outer + 14,
                top: effectPadding - 7,
                left: effectPadding - 7,
                transform: [{ rotate: orbitRotation }],
              },
            ]}
          >
            <View style={[st.orbitDot, { backgroundColor: '#ffd700' }]} />
          </Animated.View>
        )}

        {/* ── Platinum: sparkle particles ── */}
        {earned && badge.tier === 'platinum' && sparkleAnims.map((s, i) => (
          <Animated.View
            key={i}
            style={[
              st.sparkle,
              {
                opacity: s.opacity,
                transform: [
                  { translateX: s.translateX },
                  { translateY: s.translateY },
                ],
                top: dim.outer / 2 + effectPadding,
                left: dim.outer / 2 + effectPadding,
              },
            ]}
          />
        ))}

        {/* ── Legendary: floating particle trail ── */}
        {earned && badge.tier === 'legendary' && sparkleAnims.map((s, i) => (
          <Animated.View
            key={`leg-${i}`}
            style={[
              st.legendaryParticle,
              {
                opacity: s.opacity,
                transform: [
                  { translateX: s.translateX },
                  { translateY: s.translateY },
                ],
                top: dim.outer / 2 + effectPadding,
                left: dim.outer / 2 + effectPadding,
              },
            ]}
          />
        ))}

        {/* Outer shell — wrapped in float anim for legendary */}
        <Animated.View
          style={[
            st.outer,
            {
              width: dim.outer,
              height: dim.outer,
              borderRadius,
              backgroundColor: tier.bg,
              borderColor: earned ? tier.border : '#333',
              marginTop: effectPadding,
              marginLeft: effectPadding,
              transform: [
                { scale: scaleAnim },
                ...(badge.shape === 'diamond' ? [{ rotate: '45deg' as const }] : []),
                ...(earned && badge.tier === 'legendary' ? [{ translateY: floatAnim }] : []),
              ],
            },
          ]}
        >
          {/* ── Silver: shimmer overlay ── */}
          {earned && badge.tier === 'silver' && (
            <Animated.View
              style={[
                st.shimmer,
                {
                  height: dim.outer,
                  transform: [{ translateX: shimmerAnim }],
                },
              ]}
            />
          )}

          {/* Inner plate */}
          <View
            style={[
              st.inner,
              {
                width: dim.inner,
                height: dim.inner,
                borderRadius: innerRadius,
                backgroundColor: earned ? tier.border + '18' : '#000000',
                borderColor: earned ? tier.border + '44' : '#222',
                transform: badge.shape === 'diamond' ? [{ rotate: '-45deg' }] : [],
              },
            ]}
          >
            {hasPixelSprite(badge.id) ? (
              <View style={badge.shape === 'diamond' ? { transform: [{ rotate: '-45deg' }] } : undefined}>
                <PixelBadgeIcon
                  badgeId={badge.id}
                  tier={badge.tier}
                  size={dim.inner - 8}
                  animate={animate && earned}
                  earned={earned}
                />
              </View>
            ) : (
              <Text
                style={[
                  st.icon,
                  { fontSize: dim.icon },
                  badge.shape === 'diamond' && { transform: [{ rotate: '-45deg' }] },
                ]}
              >
                {badge.icon}
              </Text>
            )}
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

// ── Legendary particle spawner (reuses sparkle logic) ──────────────────────
// The legendary tier also starts sparkle animations for its particle trail
// This is handled in the main useEffect via the sparkleAnims check for legendary

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
  rainbowGlow: {
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
    overflow: 'hidden', // clip shimmer inside badge
  },
  inner: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2, // above shimmer
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

  // ── Silver: shimmer sweep ────────────────────────────────────────────────
  shimmer: {
    position: 'absolute',
    top: 0,
    width: 20,
    backgroundColor: '#ffffff',
    opacity: 0.18,
    zIndex: 1,
  },

  // ── Gold: orbit ring + dot ───────────────────────────────────────────────
  orbitRing: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  orbitDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: -2,
    shadowColor: '#ffd700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 6,
  },

  // ── Platinum: sparkle particles ──────────────────────────────────────────
  sparkle: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e4e2',
    shadowColor: '#e5e4e2',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 4,
  },

  // ── Legendary: glowing particle trail ────────────────────────────────────
  legendaryParticle: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#00FF9C',
    shadowColor: '#00FF9C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 6,
  },
});
