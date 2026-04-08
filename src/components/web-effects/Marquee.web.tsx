import React, { useEffect, useRef } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';

interface MarqueeProps {
  items: string[];
  speed?: number;
  gap?: number;
  accentColor?: string;
  direction?: 'left' | 'right';
}

const KEYFRAME_ID = 'uc-marquee-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes uc-marquee {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }
    @keyframes uc-marquee-reverse {
      from { transform: translateX(-50%); }
      to { transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
}

export default function Marquee({
  items,
  speed = 30,
  gap = 16,
  accentColor = '#6366f1',
  direction = 'left',
}: MarqueeProps) {
  if (Platform.OS !== 'web') return null;

  useEffect(() => {
    injectKeyframes();
  }, []);

  if (!items || items.length === 0) return null;

  const animationName = direction === 'left' ? 'uc-marquee' : 'uc-marquee-reverse';
  const duration = `${speed}s`;

  // Duplicate items for seamless loop
  const allItems = [...items, ...items];

  return (
    <View style={styles.container} nativeID="section-marquee-ticker">
      {/* Left fade gradient */}
      <View
        style={[
          styles.fadeEdge,
          styles.fadeLeft,
        ]}
      />

      {/* Scrolling content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: gap,
          animation: `${animationName} ${duration} linear infinite`,
          whiteSpace: 'nowrap',
          willChange: 'transform',
        } as React.CSSProperties}
      >
        {allItems.map((item, i) => (
          <div
            key={`${i}-${item}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              backgroundColor: '#0e0e18',
              border: '1px solid #1a1a28',
              borderRadius: 2,
              padding: '4px 12px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: '#7a7a90',
                fontFamily: 'monospace',
                fontSize: 11,
                letterSpacing: 0.5,
                whiteSpace: 'nowrap',
              }}
            >
              {item}
            </span>
          </div>
        ))}
      </div>

      {/* Right fade gradient */}
      <View
        style={[
          styles.fadeEdge,
          styles.fadeRight,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative' as any,
    paddingVertical: 6,
  },
  fadeEdge: {
    position: 'absolute' as any,
    top: 0,
    bottom: 0,
    width: 40,
    zIndex: 2,
  },
  fadeLeft: {
    left: 0,
    // @ts-ignore web-only
    background: 'linear-gradient(to right, #050508 0%, transparent 100%)',
  },
  fadeRight: {
    right: 0,
    // @ts-ignore web-only
    background: 'linear-gradient(to left, #050508 0%, transparent 100%)',
  },
});
