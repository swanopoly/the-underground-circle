import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

const WAVE_COLORS = ['#6366f1', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#22d3ee'];
let _waveStyleInjected = false;

export default function LoadingWave() {
  useEffect(() => {
    if (Platform.OS !== 'web' || _waveStyleInjected) return;
    _waveStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes uc-wave {
        0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
        30% { transform: translateY(-18px) scale(1.3); opacity: 1; }
        60% { transform: translateY(4px) scale(0.9); opacity: 0.7; }
      }
      .uc-wave-dot {
        width: 10px; height: 10px; border-radius: 50%;
        animation: uc-wave 1.4s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
  }, []);

  if (Platform.OS === 'web') {
    return (
      <View style={s.dotsRow}>
        {WAVE_COLORS.map((color, i) => (
          <div
            key={i}
            className="uc-wave-dot"
            style={{
              backgroundColor: color,
              animationDelay: `${i * 0.12}s`,
              boxShadow: `0 0 12px ${color}60`,
            }}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={s.dotsRow}>
      {WAVE_COLORS.map((color, i) => (
        <View key={i} style={[s.nativeDot, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

/** Full-screen centered wave loader — drop-in replacement for loading screens */
export function LoadingScreen() {
  return (
    <View style={s.screen}>
      <LoadingWave />
    </View>
  );
}

const s = StyleSheet.create({
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
  },
  nativeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  screen: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
