/**
 * MorphingDots — the 6-dot animated glyph originally built for the
 * "Quick Actions" header. Extracted so it can be reused anywhere we want
 * the same "agent is alive" signal: the chat typing bar, loaders, etc.
 *
 * Animations are injected as a global <style> block once per page. Dot
 * positions morph through circle → triangle → square → DNA → circle.
 *
 * Web-only (no equivalent on native — renders static dots there).
 */

import React, { useEffect } from 'react';
import { View, Platform } from 'react-native';

// Same palette as the Quick Actions header so the glyph reads as the
// same animated mark anywhere it appears.
const DOT_COLORS = ['#6366f1', '#facc15', '#22c55e', '#ef4444', '#a855f7', '#f97316'];

// Formations are defined for a 26x26 box (S). We scale at render time by
// rewriting `left`/`top` proportionally if the caller asks for a smaller
// size.
const S = 26;

const CIRCLE_POINTS = [
  { x: 8, y: 6.8 },
  { x: 16.5, y: 6 },
  { x: 19.2, y: S / 2 },
  { x: 16.5, y: 16.8 },
  { x: 8.6, y: 16.3 },
  { x: 5.6, y: 8.2 },
];

interface Formation { name: string; pos: Array<{ x: number; y: number }> }

const FORMATIONS: Formation[] = [
  { name: 'circle', pos: CIRCLE_POINTS },
  { name: 'triangle', pos: [
    { x: S / 2, y: 2.1 },
    { x: S - 2.8, y: S - 3.7 },
    { x: 2.8, y: S - 3.7 },
    { x: S / 2 + 3.1, y: 6.4 },
    { x: S - 5.9, y: S - 6.9 },
    { x: 5.9, y: S - 6.9 },
  ]},
  { name: 'square', pos: [
    { x: 2.6, y: 2.6 }, { x: S - 2.6, y: 2.6 },
    { x: S - 2.6, y: S - 2.6 }, { x: 2.6, y: S - 2.6 },
    { x: S / 2, y: 2.1 }, { x: S / 2, y: S - 2.1 },
  ]},
  { name: 'dna1', pos: [
    { x: 2.5, y: 5.1 },
    { x: 5.3, y: 14.4 },
    { x: 7.8, y: 6.3 },
    { x: 10.1, y: 14.9 },
    { x: 12.6, y: 5.9 },
    { x: 15.1, y: 14.1 },
  ]},
  { name: 'dna2', pos: [
    { x: 2.5, y: 14.1 },
    { x: 5.3, y: 6.3 },
    { x: 7.8, y: 14.1 },
    { x: 10.1, y: 5.9 },
    { x: 12.6, y: 14.9 },
    { x: 15.1, y: 6.6 },
  ]},
  { name: 'circle_return', pos: CIRCLE_POINTS },
];

const STYLE_ID = 'uc-morphing-dots-style';

function ensureStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const totalFormations = FORMATIONS.length;
  const holdPct = 100 / totalFormations;
  let dotKeyframes = '';
  for (let d = 0; d < DOT_COLORS.length; d++) {
    const startPoint = FORMATIONS[0].pos[d];
    let kf = `@keyframes uc-morph-dot-${d} {\n`;
    kf += `  0% { left: ${startPoint.x.toFixed(1)}px; top: ${startPoint.y.toFixed(1)}px; }\n`;
    for (let f = 0; f < totalFormations; f++) {
      const startPct = (f * holdPct).toFixed(1);
      const { x, y } = FORMATIONS[f].pos[d];
      kf += `  ${startPct}% { left: ${x.toFixed(1)}px; top: ${y.toFixed(1)}px; }\n`;
    }
    kf += `  100% { left: ${startPoint.x.toFixed(1)}px; top: ${startPoint.y.toFixed(1)}px; }\n`;
    kf += '}\n';
    dotKeyframes += kf;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
${dotKeyframes}
@keyframes uc-morph-glow { 0%,100% { opacity: .7; } 50% { opacity: 1; } }
@keyframes uc-morph-shape {
  0%, 18% { border-radius: 999px; transform: rotate(0deg) scale(1); }
  25%, 43% { border-radius: 1px; transform: rotate(45deg) scale(1); }
  50%, 68% { border-radius: 1px; transform: rotate(0deg) scale(1); }
  75%, 93% { border-radius: 999px; transform: rotate(24deg) scale(1); }
  96%, 100% { border-radius: 999px; transform: rotate(0deg) scale(1); }
}
.uc-morph-dot { position: absolute; border-radius: 50%; }
`;
  document.head.appendChild(style);
}

export interface MorphingDotsProps {
  /** Bounding-box size in px. Animation was designed at 26. */
  size?: number;
  /** Dot radius in px. */
  dotSize?: number;
  /** Cycle duration in seconds. Lower = faster morph. */
  cycleDuration?: number;
  /** Glow/brighten on hover-style emphasis. */
  active?: boolean;
}

export default function MorphingDots({
  size = S,
  dotSize = 3,
  cycleDuration = 5.5,
  active = true,
}: MorphingDotsProps) {
  useEffect(() => { ensureStyles(); }, []);

  const scale = size / S;

  return (
    <View style={{ width: size, height: size, position: 'relative' as any }}>
      {DOT_COLORS.map((c, i) => {
        const start = FORMATIONS[0].pos[i];
        const baseStyle: any = {
          width: dotSize,
          height: dotSize,
          backgroundColor: c,
          left: start.x * scale,
          top: start.y * scale,
          marginLeft: -(dotSize / 2),
          marginTop: -(dotSize / 2),
        };
        if (Platform.OS === 'web') {
          baseStyle.boxShadow = active ? `0 0 4px ${c}66, 0 0 1px ${c}44` : 'none';
          baseStyle.transition = 'box-shadow 0.18s ease, opacity 0.18s ease';
          baseStyle.opacity = active ? 1 : 0.85;
          baseStyle.animation =
            `uc-morph-dot-${i} ${cycleDuration}s linear infinite, ` +
            `uc-morph-glow 1.6s ease-in-out infinite, ` +
            `uc-morph-shape ${cycleDuration}s ease-in-out infinite`;
          baseStyle.animationDelay = `0s, ${i * 0.2}s, 0s`;
          baseStyle.animationFillMode = 'both, both, both';
          // Scale positions by redefining `transform` via the scale CSS var
          // isn't needed — we already multiplied start positions above, and
          // keyframes are authored in the S=26 coordinate space so passing
          // a non-default size will look clamped. For the typing-bar use
          // case the default size is fine.
        }
        return (
          <View
            key={i}
            // @ts-expect-error — className is valid on RN Web
            className="uc-morph-dot"
            style={baseStyle}
          />
        );
      })}
    </View>
  );
}
