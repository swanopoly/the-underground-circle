/**
 * SpotlightCard — Aceternity-inspired radial gradient spotlight that follows the cursor.
 *
 * Web-only, CSS-only (no framer-motion). Falls back to a plain View on native.
 * Wraps children in a dark card with a subtle mouse-tracking light effect.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, Platform, StyleSheet } from 'react-native';

interface SpotlightCardProps {
  children: React.ReactNode;
  /** Spotlight color (hex). Defaults to indigo #6366f1 */
  color?: string;
  /** Spotlight radius in px. Defaults to 200 */
  radius?: number;
}

export default function SpotlightCard({
  children,
  color = '#6366f1',
  radius = 200,
}: SpotlightCardProps) {
  // Native fallback — just render children in a plain View
  if (Platform.OS !== 'web') {
    return <View style={styles.card}>{children}</View>;
  }

  const [spotlight, setSpotlight] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<View>(null);

  const handleMouseMove = useCallback((e: any) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSpotlight({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setSpotlight(null);
  }, []);

  const overlayStyle = spotlight
    ? {
        position: 'absolute' as const,
        inset: 0,
        borderRadius: 12,
        pointerEvents: 'none' as const,
        background: `radial-gradient(circle ${radius}px at ${spotlight.x}px ${spotlight.y}px, ${color}15, transparent)`,
        transition: 'opacity 0.15s ease',
        opacity: 1,
        zIndex: 1,
      }
    : {
        position: 'absolute' as const,
        inset: 0,
        borderRadius: 12,
        pointerEvents: 'none' as const,
        opacity: 0,
        zIndex: 1,
      };

  return (
    <View
      ref={cardRef}
      style={styles.card}
      // @ts-ignore — web-only mouse events
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Spotlight overlay */}
      <div style={overlayStyle as any} />
      {/* Card content */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    backgroundColor: '#0a0a10',
    // @ts-ignore — web shadow
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  },
  content: {
    position: 'relative',
    zIndex: 2,
  },
});
