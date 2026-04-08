import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

const WAVE_COLORS = ['#6366f1', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#22d3ee'];
const DOT_COUNT = WAVE_COLORS.length;
const R = 22;          // radius for circle + star shapes
const DOT_SIZE = 9;
const CENTER = R + DOT_SIZE; // center point in the container
let _waveStyleInjected = false;

// ─── Shape generators (return [x, y] for each dot index) ─────────────────

function circlePos(i: number): [number, number] {
  const angle = (i / DOT_COUNT) * Math.PI * 2 - Math.PI / 2;
  return [CENTER + Math.cos(angle) * R, CENTER + Math.sin(angle) * R];
}

function wavePos(i: number): [number, number] {
  // Horizontal wave — dots spread left-to-right with sine offset on Y
  const spread = (R * 2) / (DOT_COUNT - 1);
  const x = CENTER - R + i * spread;
  const phase = (i / DOT_COUNT) * Math.PI * 2;
  const y = CENTER + Math.sin(phase) * (R * 0.7);
  return [x, y];
}

function starPos(i: number): [number, number] {
  // 7-pointed star — alternating inner/outer radii
  const angle = (i / DOT_COUNT) * Math.PI * 2 - Math.PI / 2;
  const outerR = R * 1.1;
  const innerR = R * 0.4;
  const radius = i % 2 === 0 ? outerR : innerR;
  return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius];
}

export default function LoadingWave() {
  useEffect(() => {
    if (Platform.OS !== 'web' || _waveStyleInjected) return;
    _waveStyleInjected = true;

    // Generate unique keyframes for each dot — morphing through 3 shapes
    // Timing: 0-33% circle, 33-66% wave, 66-100% star, then loops back to circle
    let dotKeyframes = '';
    for (let i = 0; i < DOT_COUNT; i++) {
      const [cx, cy] = circlePos(i);
      const [wx, wy] = wavePos(i);
      const [sx, sy] = starPos(i);
      dotKeyframes += `
        @keyframes uc-morph-${i} {
          0%, 5%   { left: ${cx}px; top: ${cy}px; }
          30%, 38% { left: ${wx}px; top: ${wy}px; }
          63%, 71% { left: ${sx}px; top: ${sy}px; }
          95%, 100%{ left: ${cx}px; top: ${cy}px; }
        }
      `;
    }

    const style = document.createElement('style');
    style.id = 'uc-loading-circle-css';
    style.textContent = `
      ${dotKeyframes}
      @keyframes uc-dot-glow {
        0%, 100% { transform: scale(0.7); opacity: 0.4; }
        50% { transform: scale(1.25); opacity: 1; }
      }
      @keyframes uc-slow-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .uc-circle-loader {
        position: relative;
        width: ${CENTER * 2}px;
        height: ${CENTER * 2}px;
        animation: uc-slow-spin 8s linear infinite;
      }
      .uc-circle-dot {
        position: absolute;
        width: ${DOT_SIZE}px;
        height: ${DOT_SIZE}px;
        border-radius: 50%;
        animation-timing-function: cubic-bezier(0.45, 0.05, 0.55, 0.95);
        animation-fill-mode: both;
        animation-iteration-count: infinite;
      }
    `;
    document.head.appendChild(style);
  }, []);

  if (Platform.OS === 'web') {
    return (
      <View style={s.wrapper}>
        <div className="uc-circle-loader">
          {WAVE_COLORS.map((color, i) => {
            const [cx, cy] = circlePos(i);
            return (
              <div
                key={i}
                className="uc-circle-dot"
                style={{
                  backgroundColor: color,
                  left: cx,
                  top: cy,
                  boxShadow: `0 0 10px ${color}70`,
                  animation: `uc-morph-${i} 4.5s cubic-bezier(0.45,0.05,0.55,0.95) infinite, uc-dot-glow 1.4s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            );
          })}
        </div>
      </View>
    );
  }

  // Native fallback — static circle
  const dotPositions = WAVE_COLORS.map((color, i) => {
    const [x, y] = circlePos(i);
    return { color, x, y };
  });

  return (
    <View style={s.wrapper}>
      <View style={s.circleContainer}>
        {dotPositions.map((dot, i) => (
          <View
            key={i}
            style={[s.nativeDot, { backgroundColor: dot.color, left: dot.x, top: dot.y }]}
          />
        ))}
      </View>
    </View>
  );
}

/** Full-screen centered loader — drop-in replacement for loading screens */
export function LoadingScreen() {
  return (
    <View style={s.screen}>
      <LoadingWave />
    </View>
  );
}

const containerSize = CENTER * 2;

const s = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    height: containerSize + 20,
  },
  circleContainer: {
    width: containerSize,
    height: containerSize,
    position: 'relative',
  },
  nativeDot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  screen: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
