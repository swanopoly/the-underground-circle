/**
 * SoundMixer.tsx — Compact site audio + ambient sound controls for the Office toolbar
 *
 * 4 layer toggles with volume sliders + master mute. Web-only.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Platform,
} from 'react-native';
import {
  getAudioState,
  subscribe,
  toggleLayer,
  setLayerVolume,
  toggleMasterMute,
  initAudioManager,
  hasConfiguredAmbientAudio,
  type AmbientLayer,
  type LayerConfig,
} from '../../lib/audioManager';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  accentColor: string;
}

// ─── Web-only volume slider ─────────────────────────────────────────────────

function VolumeSlider({ value, onChange, color }: { value: number; onChange: (v: number) => void; color: string }) {
  if (Platform.OS !== 'web') return null;

  return (
    <View style={sliderStyles.track}>
      <View
        style={[
          sliderStyles.fill,
          { width: `${Math.round(value * 100)}%` as any, backgroundColor: color },
        ]}
      />
      {/* Clickable overlay for web */}
      <Pressable
        style={[sliderStyles.hitArea, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        onPress={(e: any) => {
          if (Platform.OS !== 'web') return;
          const nativeEvent = e.nativeEvent;
          const rect = (nativeEvent.target as HTMLElement)?.getBoundingClientRect?.();
          if (rect) {
            const x = nativeEvent.pageX - rect.left;
            const pct = Math.max(0, Math.min(1, x / rect.width));
            onChange(pct);
          }
        }}
      />
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  track: {
    height: 4,
    backgroundColor: '#1a1a2e',
    borderRadius: 1,
    flex: 1,
    position: 'relative' as any,
    overflow: 'hidden',
  },
  fill: {
    height: '100%' as any,
    borderRadius: 1,
  },
  hitArea: {
    position: 'absolute' as any,
    top: -6,
    left: 0,
    right: 0,
    bottom: -6,
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function SoundMixer({ accentColor }: Props) {
  // Web-only guard
  if (Platform.OS !== 'web') {
    return null;
  }

  return <SoundMixerInner accentColor={accentColor} />;
}

function SoundMixerInner({ accentColor }: Props) {
  const audioConfigured = hasConfiguredAmbientAudio();
  const [audioState, setAudioState] = useState(() => {
    initAudioManager();
    return getAudioState();
  });

  useEffect(() => {
    const unsub = subscribe(setAudioState);
    return unsub;
  }, []);

  const handleToggle = useCallback((id: AmbientLayer) => {
    toggleLayer(id);
  }, []);

  const handleVolume = useCallback((id: AmbientLayer, vol: number) => {
    setLayerVolume(id, vol);
  }, []);

  const handleMasterMute = useCallback(() => {
    toggleMasterMute();
  }, []);

  const anyPlaying = audioState.layers.some(l => l.playing);

  if (!audioConfigured) {
    return (
      <View nativeID="section-sound-mixer" style={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={handleMasterMute}
            style={[styles.muteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[
              styles.muteIcon,
              audioState.masterMuted ? { color: '#ef4444' } : { color: accentColor },
            ]}>
              {audioState.masterMuted ? 'X' : ')))'}
            </Text>
          </Pressable>
          <Text style={styles.headerText}>SITE AUDIO</Text>
        </View>
        <Text style={styles.unavailableText}>
          {audioState.masterMuted ? 'The site is muted.' : 'Mute or unmute the entire site from here.'}
        </Text>
        <Text style={styles.unavailableHint}>
          Ambient layers are not configured for this build yet, but the master toggle still controls page audio.
        </Text>
      </View>
    );
  }

  return (
    <View nativeID="section-sound-mixer" style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleMasterMute}
          style={[styles.muteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={[
            styles.muteIcon,
            audioState.masterMuted && { color: '#ef4444' },
            !audioState.masterMuted && anyPlaying && { color: accentColor },
          ]}>
            {audioState.masterMuted ? 'X' : anyPlaying ? ')))' : '((' }
          </Text>
        </Pressable>
        <Text style={styles.headerText}>SITE AUDIO</Text>
      </View>

      <Text style={styles.unavailableHint}>
        Master toggle mutes or unmutes the whole site. Layer controls below only affect ambient office audio.
      </Text>

      {/* Layer controls */}
      <View style={styles.layerList}>
        {audioState.layers.map((layer: LayerConfig) => {
          const isActive = layer.playing && !audioState.masterMuted;
          const layerColor = isActive ? accentColor : '#555';

          return (
            <View key={layer.id} style={styles.layerRow}>
              <Pressable
                onPress={() => handleToggle(layer.id)}
                style={[
                  styles.layerToggle,
                  isActive && {
                    backgroundColor: accentColor + '20',
                    borderColor: accentColor + '60',
                    ...(Platform.OS === 'web' ? { boxShadow: `0 0 6px ${accentColor}40` } as any : {}),
                  },
                  Platform.OS === 'web' && { cursor: 'pointer' } as any,
                ]}
              >
                <Text style={[styles.layerIcon, { color: layerColor }]}>
                  {layer.icon}
                </Text>
              </Pressable>
              <VolumeSlider
                value={layer.volume}
                onChange={(v) => handleVolume(layer.id, v)}
                color={isActive ? accentColor : '#333'}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0f',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 6,
    gap: 4,
    minWidth: 140,
  },
  unavailableText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#d1d5db',
    lineHeight: 14,
  },
  unavailableHint: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#6b7280',
    lineHeight: 13,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  muteBtn: {
    width: 24,
    height: 18,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111118',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteIcon: {
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    color: '#666',
  },
  headerText: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  layerList: {
    gap: 3,
  },
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 20,
  },
  layerToggle: {
    width: 24,
    height: 18,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111118',
    alignItems: 'center',
    justifyContent: 'center',
  },
  layerIcon: {
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
});
