/**
 * ThinkingDots — the same morphing-dot animation used on the Quick
 * Actions accordion header. Extracted so both the RunStatusBar and the
 * chat typing indicator can mount it inline next to the rotating verb.
 *
 * Six dots morph through five formations (circle → triangle → square →
 * dna1 → dna2) with a glow pulse and a shape pulse layered on top. On
 * native (where CSS keyframes aren't a thing) we fall back to a static
 * arrangement — still shows the colored constellation, just doesn't
 * move. The RunStatusBar keeps its own Animated-driven `ActivityDots`
 * fallback there too.
 */

import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';

// Keep these in lock-step with the Quick Actions header
// (src/screens/circles/tabs/ChatTab.tsx). If you change them here,
// change them there — or better, extract shared tokens.
const QA_DOT_COLORS = ['#22d3ee', '#facc15', '#22c55e', '#ef4444', '#a855f7', '#f97316'];
const S = 26;
const C = S / 2;
const QA_CIRCLE_POINTS = [
  { x: 8,    y: 6.8 },
  { x: 16.5, y: 6 },
  { x: 19.2, y: C },
  { x: 16.5, y: 16.8 },
  { x: 8.6,  y: 16.3 },
  { x: 5.6,  y: 8.2 },
];

const qaFormations: Array<{ name: string; pos: Array<{ x: number; y: number }> }> = [
  { name: 'circle', pos: QA_CIRCLE_POINTS },
  { name: 'triangle', pos: [
    { x: C,       y: 2.1 },
    { x: S - 2.8, y: S - 3.7 },
    { x: 2.8,     y: S - 3.7 },
    { x: C + 3.1, y: 6.4 },
    { x: S - 5.9, y: S - 6.9 },
    { x: 5.9,     y: S - 6.9 },
  ]},
  { name: 'square', pos: [
    { x: 2.6,     y: 2.6 }, { x: S - 2.6, y: 2.6 },
    { x: S - 2.6, y: S - 2.6 }, { x: 2.6, y: S - 2.6 },
    { x: C,       y: 2.1 }, { x: C,       y: S - 2.1 },
  ]},
  { name: 'dna1', pos: [
    { x: 2.5,  y: 5.1 },
    { x: 5.3,  y: 14.4 },
    { x: 7.8,  y: 6.3 },
    { x: 10.1, y: 14.9 },
    { x: 12.6, y: 5.9 },
    { x: 15.1, y: 14.1 },
  ]},
  { name: 'dna2', pos: [
    { x: 2.5,  y: 14.1 },
    { x: 5.3,  y: 6.3 },
    { x: 7.8,  y: 14.1 },
    { x: 10.1, y: 5.9 },
    { x: 12.6, y: 14.9 },
    { x: 15.1, y: 6.6 },
  ]},
];

/** Injects the shared QA keyframes into <head> on first use. Idempotent —
 *  safe to call from every render, but we only do it once in useEffect. */
function ensureThinkingDotStyles() {
  if (typeof document === 'undefined') return;
  const ID = 'uc-qa-header-style';
  // Reuse the same stylesheet the QuickActionsHeader already installs.
  // If that component hasn't rendered yet, we install it here — the
  // keyframes are interchangeable.
  let el = document.getElementById(ID) as HTMLStyleElement | null;
  if (el && el.textContent && el.textContent.length > 0) return;
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
    document.head.appendChild(el);
  }
  const totalFormations = qaFormations.length;
  const holdPct = 100 / totalFormations;
  let dotKeyframes = '';
  for (let d = 0; d < QA_DOT_COLORS.length; d++) {
    let kf = `@keyframes uc-qa-morph-${d} {\n`;
    for (let f = 0; f < totalFormations; f++) {
      const startPct = (f * holdPct).toFixed(1);
      const { x, y } = qaFormations[f].pos[d];
      kf += `  ${startPct}% { left: ${x.toFixed(1)}px; top: ${y.toFixed(1)}px; }\n`;
    }
    kf += `  100% { left: ${qaFormations[0].pos[d].x.toFixed(1)}px; top: ${qaFormations[0].pos[d].y.toFixed(1)}px; }\n`;
    kf += '}\n';
    dotKeyframes += kf;
  }
  el.textContent = `
${dotKeyframes}
@keyframes uc-qa-glow { 0%,100% { opacity:.68; transform:scale(1); } 50% { opacity:1; transform:scale(1.22); } }
@keyframes uc-qa-shape {
  0%   { width: 3px; height: 3px; border-radius: 999px; transform: rotate(0deg); }
  20%  { width: 3px; height: 3px; border-radius: 999px; transform: rotate(0deg); }
  40%  { width: 3px; height: 3px; border-radius: 1px;   transform: rotate(45deg); }
  60%  { width: 3px; height: 3px; border-radius: 1px;   transform: rotate(0deg); }
  80%  { width: 2px; height: 4.2px; border-radius: 999px; transform: rotate(24deg); }
  100% { width: 3px; height: 3px; border-radius: 999px; transform: rotate(0deg); }
}
`;
}

export interface ThinkingDotsProps {
  /** Slightly larger or smaller scale. Default 1. */
  scale?: number;
  /** Cycle duration in seconds. Lower = more frantic. Default 5.5. */
  cycleDuration?: number;
  /** Extra glow on hover. Default false. */
  glow?: boolean;
}

export default function ThinkingDots({ scale = 1, cycleDuration = 5.5, glow = false }: ThinkingDotsProps) {
  useEffect(() => {
    if (Platform.OS === 'web') ensureThinkingDotStyles();
  }, []);

  const size = S * scale;
  const dotSize = 3 * scale;

  // Web path: drop into raw DOM so RN Web's style validator doesn't
  // warn on the `animation` shorthand — it only understands the
  // `animationKeyframes`/`animationDuration` split form and logs a
  // noisy warning for every other `animation:` key we pass. Plain
  // DOM accepts the shorthand natively without complaint.
  if (Platform.OS === 'web') {
    return React.createElement(
      'div',
      { style: { width: size, height: size, position: 'relative' } },
      QA_DOT_COLORS.map((c, i) =>
        React.createElement('div', {
          key: i,
          style: {
            position: 'absolute',
            width: dotSize,
            height: dotSize,
            backgroundColor: c,
            left: qaFormations[0].pos[i].x * scale,
            top: qaFormations[0].pos[i].y * scale,
            marginLeft: -(dotSize / 2),
            marginTop: -(dotSize / 2),
            borderRadius: 999,
            boxShadow: glow ? `0 0 6px ${c}88, 0 0 2px ${c}66` : `0 0 3px ${c}33`,
            transition: 'box-shadow 0.18s ease, opacity 0.18s ease',
            opacity: 1,
            animation: `uc-qa-morph-${i} ${cycleDuration}s ease-in-out infinite, uc-qa-glow 1.6s ease-in-out infinite, uc-qa-shape ${cycleDuration}s ease-in-out infinite`,
            animationDelay: `0s, ${i * 0.2}s, 0s`,
          } as React.CSSProperties,
        }),
      ),
    );
  }

  return (
    <View style={{ width: size, height: size, position: 'relative' as any }}>
      {QA_DOT_COLORS.map((c, i) => (
        <View
          key={i}
          style={{
            position: 'absolute' as any,
            width: dotSize,
            height: dotSize,
            backgroundColor: c,
            borderRadius: dotSize / 2,
            left: qaFormations[0].pos[i].x * scale,
            top: qaFormations[0].pos[i].y * scale,
            marginLeft: -(dotSize / 2),
            marginTop: -(dotSize / 2),
          }}
        />
      ))}
    </View>
  );
}
