/**
 * FlatIcon — renders icons from Flaticon/Freepik CDN
 *
 * Uses cdn-icons-png.freepik.com URLs for fast, cached delivery.
 * Premium account — no attribution required.
 *
 * Usage:
 *   <FlatIcon name="chat" size={20} />
 *   <FlatIcon name="office" size={24} glow />
 *   <FlatIcon name="rocket" size={28} pulse />
 */

import React, { useEffect, useRef } from 'react';
import { Image, View, StyleSheet, Platform, Animated, Easing } from 'react-native';

// ── Icon catalog — curated set from Freepik CDN ──────────────────────────────

const ICON_CATALOG: Record<string, number> = {
  // Tab bar
  chat:          7959346,
  office:        1209313,
  rooms:         12602918,
  backpack:      2542524,
  feed:          7854714,
  challenges:    12281613,
  members:       3839469,
  analytics:     646249,
  integrations:  4013278,
  wallet:        7322711,
  profile:       6645221,

  // Header menu
  circles:       1654315,
  create:        15999657,
  join:          1635581,
  friends:       3220788,
  organizations: 17204765,
  schools:       3164143,
  agents:        1693881,
  settings:      1323403,

  // Misc
  rocket:        2449848,
  code:          2092621,
  security:      2592258,
  brain:         15557942,
  robot:         3398643,
  workspace:     1599808,
  connection:    13963737,
};

function getCdnUrl(iconId: number, size: 128 | 256 | 512 = 128): string {
  return `https://cdn-icons-png.freepik.com/${size}/${Math.floor(iconId / 1000)}/${iconId}.png`;
}

// ── Component ────────────────────────────────────────────────────────────────

interface FlatIconProps {
  name: keyof typeof ICON_CATALOG | string;
  size?: number;
  style?: any;
  glow?: boolean;     // subtle blue glow behind icon
  pulse?: boolean;    // gentle pulse animation
  bounce?: boolean;   // entrance bounce
  mono?: boolean;     // black & white (white on dark backgrounds)
  tintColor?: string; // optional tint (web only)
}

export default function FlatIcon({
  name, size = 20, style, glow, pulse, bounce, mono, tintColor,
}: FlatIconProps) {
  const iconId = ICON_CATALOG[name];
  const scaleAnim = useRef(new Animated.Value(bounce ? 0.3 : 1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Bounce entrance
  useEffect(() => {
    if (bounce) {
      Animated.spring(scaleAnim, {
        toValue: 1, tension: 200, friction: 12,
        useNativeDriver: false,
      }).start();
    }
  }, [bounce, scaleAnim]);

  // Pulse loop
  useEffect(() => {
    if (!pulse) return;
    let stopped = false;
    const run = () => {
      if (stopped) return;
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15, duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1, duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]).start(({ finished }) => { if (finished && !stopped) run(); });
    };
    run();
    return () => { stopped = true; };
  }, [pulse, pulseAnim]);

  if (!iconId) {
    // Fallback: render the name as emoji text (backwards compat)
    return (
      <View style={[{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }, style]}>
        <Animated.Text style={{ fontSize: size * 0.8, transform: [{ scale: bounce ? scaleAnim : 1 }] }}>
          {name}
        </Animated.Text>
      </View>
    );
  }

  const cdnSize = size > 64 ? 256 : 128;
  const uri = getCdnUrl(iconId, cdnSize);

  // Build CSS filter chain (web only)
  const filters: string[] = [];
  if (mono && Platform.OS === 'web') filters.push('brightness(0) invert(1)');
  if (tintColor && Platform.OS === 'web') filters.push(`drop-shadow(0 0 0 ${tintColor})`);
  if (glow && Platform.OS === 'web') filters.push('drop-shadow(0 0 6px rgba(99, 102, 241, 0.4))');

  const imageStyle: any = {
    width: size,
    height: size,
    ...(filters.length > 0 ? { filter: filters.join(' ') } : {}),
  };

  const wrapperStyle: any = [
    { width: size, height: size, justifyContent: 'center', alignItems: 'center' },
    style,
  ];

  const animatedScale = pulse ? pulseAnim : bounce ? scaleAnim : undefined;

  if (animatedScale) {
    return (
      <Animated.View style={[...wrapperStyle, { transform: [{ scale: animatedScale }] }]}>
        <Image source={{ uri }} style={imageStyle} resizeMode="contain" />
      </Animated.View>
    );
  }

  return (
    <View style={wrapperStyle}>
      <Image source={{ uri }} style={imageStyle} resizeMode="contain" />
    </View>
  );
}

// ── Inline helper for quick icon URLs ────────────────────────────────────────

export function flatIconUrl(name: string, size: 128 | 256 | 512 = 128): string | null {
  const id = ICON_CATALOG[name];
  return id ? getCdnUrl(id, size) : null;
}

export { ICON_CATALOG };
