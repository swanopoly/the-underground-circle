/**
 * TiltCard — Aceternity-inspired 3D perspective tilt that follows the cursor.
 *
 * Web-only, CSS-only (no framer-motion). Falls back to a plain View on native.
 * Applies a smooth CSS transform with perspective, rotateX/Y, and optional scale.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, Platform, StyleSheet } from 'react-native';

interface TiltCardProps {
  children: React.ReactNode;
  /** Maximum tilt angle in degrees. Defaults to 15 */
  maxTilt?: number;
  /** CSS perspective value in px. Defaults to 1000 */
  perspective?: number;
  /** Scale factor on hover. Defaults to 1.02 */
  scale?: number;
}

export default function TiltCard({
  children,
  maxTilt = 15,
  perspective = 1000,
  scale = 1.02,
}: TiltCardProps) {
  // Native fallback — just render children in a plain View
  if (Platform.OS !== 'web') {
    return <View style={styles.card}>{children}</View>;
  }

  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<View>(null);

  const handleMouseMove = useCallback(
    (e: any) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      // Normalize mouse position to -0.5..+0.5
      const normalX = (e.clientX - rect.left) / w - 0.5;
      const normalY = (e.clientY - rect.top) / h - 0.5;
      // tiltX rotates around Y axis, tiltY rotates around X axis
      setTilt({
        x: normalX * maxTilt,
        y: -normalY * maxTilt,
      });
    },
    [maxTilt],
  );

  const handleMouseLeave = useCallback(() => {
    setTilt(null);
  }, []);

  const transform = tilt
    ? `perspective(${perspective}px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg) scale(${scale})`
    : `perspective(${perspective}px) rotateX(0deg) rotateY(0deg) scale(1)`;

  return (
    <div
      // @ts-ignore
      ref={cardRef}
      style={{
        transform,
        transition: 'transform 0.2s ease',
        borderRadius: 12,
        willChange: 'transform',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <View style={styles.card}>{children}</View>
    </div>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    backgroundColor: '#0a0a10',
    overflow: 'hidden',
  },
});
