/**
 * audioManager.ts — Simple audio layer system for office ambience (web-only)
 *
 * Manages 4 ambient audio layers with independent volume/play controls.
 * Uses HTML5 Audio API. Persists preferences to localStorage.
 */

import { Platform } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AmbientLayer = 'typing' | 'rain' | 'coffee' | 'lofi';

export interface LayerConfig {
  id: AmbientLayer;
  label: string;
  icon: string;
  url: string;
  volume: number;
  playing: boolean;
}

interface AudioManagerState {
  layers: LayerConfig[];
  masterMuted: boolean;
  autoTyping: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@uc_ambient_audio';

const DEFAULT_LAYERS: LayerConfig[] = [
  {
    id: 'typing',
    label: 'Typing',
    icon: '>_',
    url: 'https://cdn.example.com/ambient/typing.mp3',
    volume: 0.3,
    playing: false,
  },
  {
    id: 'rain',
    label: 'Rain',
    icon: '~~',
    url: 'https://cdn.example.com/ambient/rain.mp3',
    volume: 0.4,
    playing: false,
  },
  {
    id: 'coffee',
    label: 'Coffee',
    icon: 'C]',
    url: 'https://cdn.example.com/ambient/coffee.mp3',
    volume: 0.3,
    playing: false,
  },
  {
    id: 'lofi',
    label: 'Lo-Fi',
    icon: '##',
    url: 'https://cdn.example.com/ambient/lofi.mp3',
    volume: 0.25,
    playing: false,
  },
];

// ─── Module state ─────────────────────────────────────────────────────────────

const audioElements = new Map<AmbientLayer, HTMLAudioElement>();
let state: AudioManagerState = {
  layers: [...DEFAULT_LAYERS],
  masterMuted: false,
  autoTyping: false,
};
let listeners: Array<(s: AudioManagerState) => void> = [];

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadState(): void {
  if (Platform.OS !== 'web') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AudioManagerState>;
      if (saved.layers) {
        // Merge saved preferences with default layers (preserves new layers added later)
        state.layers = DEFAULT_LAYERS.map(def => {
          const saved_layer = saved.layers?.find(s => s.id === def.id);
          return saved_layer ? { ...def, volume: saved_layer.volume, playing: saved_layer.playing } : def;
        });
      }
      if (saved.masterMuted !== undefined) state.masterMuted = saved.masterMuted;
      if (saved.autoTyping !== undefined) state.autoTyping = saved.autoTyping;
    }
  } catch {
    // Ignore
  }
}

function saveState(): void {
  if (Platform.OS !== 'web') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      layers: state.layers.map(l => ({ id: l.id, volume: l.volume, playing: l.playing })),
      masterMuted: state.masterMuted,
      autoTyping: state.autoTyping,
    }));
  } catch {
    // Ignore
  }
}

function notifyListeners(): void {
  const snapshot = { ...state, layers: state.layers.map(l => ({ ...l })) };
  listeners.forEach(fn => fn(snapshot));
}

// ─── Audio element management ─────────────────────────────────────────────────

function getOrCreateAudio(layer: LayerConfig): HTMLAudioElement | null {
  if (Platform.OS !== 'web' || typeof Audio === 'undefined') return null;

  let el = audioElements.get(layer.id);
  if (!el) {
    el = new Audio(layer.url);
    el.loop = true;
    el.preload = 'none';
    audioElements.set(layer.id, el);
  }
  return el;
}

function syncAudioElement(layer: LayerConfig): void {
  const el = getOrCreateAudio(layer);
  if (!el) return;

  const effectiveVolume = state.masterMuted ? 0 : layer.volume;
  el.volume = effectiveVolume;

  if (layer.playing && !state.masterMuted) {
    if (el.paused) {
      el.play().catch(() => {
        // Browser may block autoplay — requires user interaction first
      });
    }
  } else {
    if (!el.paused) {
      el.pause();
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initAudioManager(): void {
  loadState();
  // Don't auto-play on init — wait for user interaction
}

export function getAudioState(): AudioManagerState {
  return { ...state, layers: state.layers.map(l => ({ ...l })) };
}

export function subscribe(fn: (s: AudioManagerState) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

export function toggleLayer(layerId: AmbientLayer): void {
  state.layers = state.layers.map(l =>
    l.id === layerId ? { ...l, playing: !l.playing } : l
  );
  const layer = state.layers.find(l => l.id === layerId);
  if (layer) syncAudioElement(layer);
  saveState();
  notifyListeners();
}

export function setLayerVolume(layerId: AmbientLayer, volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  state.layers = state.layers.map(l =>
    l.id === layerId ? { ...l, volume: clamped } : l
  );
  const layer = state.layers.find(l => l.id === layerId);
  if (layer) syncAudioElement(layer);
  saveState();
  notifyListeners();
}

export function toggleMasterMute(): void {
  state.masterMuted = !state.masterMuted;
  state.layers.forEach(l => syncAudioElement(l));
  saveState();
  notifyListeners();
}

export function setAutoTyping(enabled: boolean): void {
  state.autoTyping = enabled;
  saveState();
  notifyListeners();
}

export function triggerAutoTyping(hasBuilding: boolean): void {
  if (!state.autoTyping) return;
  const typingLayer = state.layers.find(l => l.id === 'typing');
  if (!typingLayer) return;

  if (hasBuilding && !typingLayer.playing) {
    state.layers = state.layers.map(l =>
      l.id === 'typing' ? { ...l, playing: true } : l
    );
    syncAudioElement(state.layers.find(l => l.id === 'typing')!);
    notifyListeners();
  } else if (!hasBuilding && typingLayer.playing && state.autoTyping) {
    // Only auto-stop if auto-typing was responsible for starting it
    state.layers = state.layers.map(l =>
      l.id === 'typing' ? { ...l, playing: false } : l
    );
    syncAudioElement(state.layers.find(l => l.id === 'typing')!);
    notifyListeners();
  }
}

export function stopAll(): void {
  state.layers = state.layers.map(l => ({ ...l, playing: false }));
  state.layers.forEach(l => syncAudioElement(l));
  saveState();
  notifyListeners();
}

export function destroyAudioManager(): void {
  audioElements.forEach(el => {
    el.pause();
    el.src = '';
  });
  audioElements.clear();
  listeners = [];
}
