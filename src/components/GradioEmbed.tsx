/**
 * GradioEmbed — Embed any HuggingFace Gradio Space in the app
 *
 * Uses iframe to render the Space UI directly. Works for any public
 * or protected Gradio/Streamlit/Docker Space.
 *
 * Usage:
 *   <GradioEmbed spaceId="black-forest-labs/FLUX.1-schnell" />
 *   <GradioEmbed spaceId="Qwen/Qwen3-TTS" height={500} />
 */

import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Platform, ActivityIndicator,
} from 'react-native';

interface Props {
  spaceId: string;       // e.g. "black-forest-labs/FLUX.1-schnell"
  height?: number;
  onClose?: () => void;
  title?: string;
}

function spaceIdToUrl(spaceId: string): string {
  // Convert "owner/space-name" to "https://owner-space-name.hf.space"
  return `https://${spaceId.replace('/', '-')}.hf.space`;
}

export default function GradioEmbed({ spaceId, height = 450, onClose, title }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const url = spaceIdToUrl(spaceId);

  if (Platform.OS !== 'web') {
    return (
      <View style={s.container}>
        <Text style={s.fallbackText}>
          Gradio Spaces require a web browser.{'\n'}
          Open: {url}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerIcon}>🤗</Text>
        <Text style={s.headerTitle}>{title || spaceId}</Text>
        <Pressable
          onPress={() => {
            if (typeof window !== 'undefined') window.open(url, '_blank');
          }}
          style={s.externalBtn}
        >
          <Text style={s.externalBtnText}>Open ↗</Text>
        </Pressable>
        {onClose && (
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeBtnText}>X</Text>
          </Pressable>
        )}
      </View>

      {/* Loading overlay */}
      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color="#8b5cf6" />
          <Text style={s.loadingText}>Loading Space...</Text>
        </View>
      )}

      {/* iframe */}
      <iframe
        src={url}
        style={{
          width: '100%',
          height: height,
          border: 'none',
          borderRadius: 8,
          backgroundColor: '#0a0a0a',
        }}
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
        allow="microphone; camera; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>Failed to load Space. It may be private or paused.</Text>
          <Pressable onPress={() => { if (typeof window !== 'undefined') window.open(url, '_blank'); }}>
            <Text style={[s.errorText, { color: '#6366f1' }]}>Try opening directly →</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── Popular Spaces for quick access ──────────────────────────────────────────

export const POPULAR_SPACES = [
  { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX Image Gen', icon: '🎨', category: 'image' },
  { id: 'Qwen/Qwen3-TTS', label: 'Qwen TTS', icon: '🔊', category: 'audio' },
  { id: 'not-lain/background-removal', label: 'Background Remove', icon: '✂️', category: 'image' },
  { id: 'akhaliq/anycoder', label: 'AnyCoder', icon: '💻', category: 'code' },
  { id: 'microsoft/TRELLIS.2', label: '3D Generation', icon: '🧊', category: '3d' },
  { id: 'mrfakename/Z-Image-Turbo', label: 'Image Turbo', icon: '⚡', category: 'image' },
  { id: 'open-llm-leaderboard/open_llm_leaderboard', label: 'LLM Leaderboard', icon: '🏆', category: 'tools' },
  { id: 'selfit-camera/Omni-Image-Editor', label: 'Image Editor', icon: '🖌️', category: 'image' },
];

const s = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#111827',
    gap: 6,
  },
  headerIcon: { fontSize: 14 },
  headerTitle: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    flex: 1,
  },
  externalBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  externalBtnText: {
    color: '#9ca3af',
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
  loadingOverlay: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 60,
    zIndex: 10,
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 8,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  fallbackText: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    padding: 24,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  errorBox: {
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
});
