/**
 * DesktopBridgeStatusChip — tiny composer-bar indicator for the Claude
 * Code bridge's desktop-automation state. Mounted next to the Cost
 * Footer in `ChatTab.tsx`'s `EnhancedInput` toolbar.
 *
 * Three states:
 *   - 🔴 OFFLINE  — bridge not reachable (host down, or pre-Phase-1a version)
 *   - 🟡 OFFLINE  — bridge is up but this platform isn't supported (e.g. Linux)
 *   - 🟡 PAIR     — bridge up + supported, but we haven't called pairDesktopBridge()
 *   - 🟢 READY    — paired + healthy
 *
 * Tapping the chip triggers the pairing flow + opens diagnostics when
 * offline. Polls health every 10s so the chip reflects state after the
 * user restarts the bridge without a full reload.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  getDesktopBridgeHealth,
  isDesktopBridgePaired,
  pairDesktopBridge,
  type DesktopHealth,
} from '../lib/desktopBridge';

type ChipState =
  | { kind: 'loading' }
  | { kind: 'offline'; reason: 'unreachable' | 'unsupported' }
  | { kind: 'needs_pair' }
  | { kind: 'ready' };

interface Props {
  onMessage?: (md: string) => void;   // pipe pairing results back to chat as localOnly message
  accentColor?: string;
}

const POLL_INTERVAL_MS = 10_000;

export default function DesktopBridgeStatusChip({ onMessage, accentColor = '#22c55e' }: Props) {
  const [state, setState] = useState<ChipState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    const health: DesktopHealth | null = await getDesktopBridgeHealth();
    if (!health) { setState({ kind: 'offline', reason: 'unreachable' }); return; }
    if (!health.supported) { setState({ kind: 'offline', reason: 'unsupported' }); return; }
    if (!isDesktopBridgePaired()) { setState({ kind: 'needs_pair' }); return; }
    setState({ kind: 'ready' });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    let consecutiveOffline = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = setTimeout(run, ms);
    };

    const run = async () => {
      await probe();
      if (cancelled) return;
      setState((prev) => {
        if (prev.kind === 'offline') {
          consecutiveOffline++;
        } else {
          consecutiveOffline = 0;
        }
        // Back off to every 2min once we've seen 3 straight offline
        // probes — this is a dev-only bridge, no need to flood the
        // console with 404s when the user isn't running it.
        const delay = consecutiveOffline >= 3 ? 120_000 : POLL_INTERVAL_MS;
        schedule(delay);
        return prev;
      });
    };

    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [probe]);

  const handlePress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state.kind === 'offline') {
        onMessage?.(
          state.reason === 'unreachable'
            ? '**Desktop bridge unreachable.** Start it in a terminal:\n\n```\nnode scripts/claude-bridge.js\n```\n\nThen tap the 🔴 chip again.'
            : `**Bridge is on a platform we do not support.** Desktop automation is macOS-only in Phase 1. Windows/Linux is on the roadmap.`,
        );
        await probe();
        return;
      }
      if (state.kind === 'needs_pair' || state.kind === 'ready') {
        const r = await pairDesktopBridge();
        if (!r.ok) {
          onMessage?.(`**Pair failed:** ${r.error || 'unknown error'}`);
        } else {
          onMessage?.(
            state.kind === 'needs_pair'
              ? '**Desktop bridge paired.** Agent can now launch apps, type text, and send key combos (HITL-gated). First keystroke may prompt for macOS Accessibility permission.'
              : '**Desktop bridge re-paired.** Token refreshed.',
          );
        }
        await probe();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, state, onMessage, probe]);

  if (Platform.OS !== 'web') return null;

  const { label, dot, textColor } = visualFor(state, accentColor);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Desktop bridge: ${label}`}
      style={({ hovered }: any) => [
        styles.chip,
        hovered && ({ backgroundColor: '#0f172a' } as any),
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.labelText}>DESKTOP</Text>
      <Text style={[styles.stateText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

function visualFor(state: ChipState, accent: string): { label: string; dot: string; textColor: string } {
  switch (state.kind) {
    case 'loading':   return { label: '…',       dot: '#475569', textColor: '#64748b' };
    case 'offline':   return { label: 'OFFLINE', dot: '#ef4444', textColor: '#ef4444' };
    case 'needs_pair':return { label: 'PAIR',    dot: '#f59e0b', textColor: '#f59e0b' };
    case 'ready':     return { label: 'READY',   dot: accent,    textColor: accent };
  }
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 999 },
  labelText: {
    color: '#475569',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  stateText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
