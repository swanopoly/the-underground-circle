/**
 * DesktopBridgeStatusChip — tiny composer-bar indicator for the Claude
 * Code bridge's desktop-automation state. Mounted next to the Cost
 * Footer in `ChatTab.tsx`'s `EnhancedInput` toolbar.
 *
 * Readiness states:
 *   - 🔴 OFFLINE  — bridge not reachable (host down, or pre-Phase-1a version)
 *   - 🟡 OFFLINE  — bridge is up but this platform isn't supported (e.g. Linux)
 *   - 🟡 PAIR     — bridge up + supported, but we haven't called pairDesktopBridge()
 *   - 🟢 READY    — paired + healthy
 *   - 🟡 UPDATE   — ordinary tools work, but the attachment-open capability is missing
 *   - 🔵 REFRESH  — newer source is present and health reports an idle-safe refresh
 *   - 🟠 WAIT     — refresh evidence is missing/malformed or current work blocks it
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
  type DesktopHealth,
} from '../lib/desktopBridge';
import {
  classifyDesktopBridgeHealth,
  type DesktopBridgeHealthClassification,
} from '../lib/desktopBridgeProtocol';
import {
  buildDesktopBridgeRecoveryPayload,
  type DesktopBridgeRecoveryPayload,
} from '../lib/desktopBridgeRecovery';
import { autoConnectDesktopBridge } from '../lib/desktopBridgeAutoConnect';

type ChipState =
  | { kind: 'loading' }
  | { kind: 'offline'; reason: 'unreachable' | 'unsupported' }
  | { kind: 'needs_pair' }
  | { kind: 'capability_missing'; classification: DesktopBridgeHealthClassification }
  | { kind: 'source_changed'; classification: DesktopBridgeHealthClassification }
  | { kind: 'restart_blocked'; classification: DesktopBridgeHealthClassification }
  | { kind: 'ready' };

type ChipPhase = 'starting' | 'pairing' | 'checking' | null;

interface Props {
  onMessage?: (md: string | DesktopBridgeRecoveryPayload) => void;   // pipe pairing results back to chat as localOnly message
  accentColor?: string;
}

const POLL_INTERVAL_MS = 10_000;

export default function DesktopBridgeStatusChip({ onMessage, accentColor = '#22c55e' }: Props) {
  const [state, setState] = useState<ChipState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ChipPhase>(null);

  const probe = useCallback(async () => {
    const health: DesktopHealth | null = await getDesktopBridgeHealth();
    const classification = classifyDesktopBridgeHealth(health);
    if (classification.state === 'unavailable') {
      setState({
        kind: 'offline',
        reason: classification.recoveryCode === 'platform_unsupported' ? 'unsupported' : 'unreachable',
      });
      return;
    }
    if (classification.state === 'capability_missing') {
      setState({ kind: 'capability_missing', classification });
      return;
    }
    if (classification.state === 'source_changed') {
      setState({ kind: 'source_changed', classification });
      return;
    }
    if (classification.state === 'restart_blocked') {
      setState({ kind: 'restart_blocked', classification });
      return;
    }
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
        if (state.reason === 'unsupported') {
          onMessage?.(buildDesktopBridgeRecoveryPayload('unsupported', 'Desktop automation is macOS-only in Phase 1. Windows/Linux is on the roadmap.'));
          await probe();
          return;
        }
        setPhase('starting');
        const result = await autoConnectDesktopBridge();
        onMessage?.(result.recoveryPayload ? { ...result.recoveryPayload, content: result.content } : result.content);
        setPhase('checking');
        await probe();
        return;
      }
      if (
        state.kind === 'needs_pair'
        || state.kind === 'ready'
        || state.kind === 'capability_missing'
        || state.kind === 'source_changed'
        || state.kind === 'restart_blocked'
      ) {
        setPhase(state.kind === 'needs_pair' || state.kind === 'ready' ? 'pairing' : 'checking');
        const result = await autoConnectDesktopBridge();
        onMessage?.(result.recoveryPayload ? { ...result.recoveryPayload, content: result.content } : result.content);
        setPhase('checking');
        await probe();
      }
    } finally {
      setPhase(null);
      setBusy(false);
    }
  }, [busy, state, onMessage, probe]);

  if (Platform.OS !== 'web') return null;

  const { label, dot, textColor } = visualFor(state, accentColor, phase);
  const accessibilityHint = hintFor(state);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Desktop bridge: ${label}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy }}
      style={({ hovered }: any) => [
        styles.chip,
        hovered && ({ backgroundColor: '#0f172a' } as any),
        Platform.OS === 'web' && ({ cursor: busy ? 'wait' : 'pointer' } as any),
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.labelText}>DESKTOP</Text>
      <Text style={[styles.stateText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

function hintFor(state: ChipState): string {
  switch (state.kind) {
    case 'loading':
      return 'Checking the local desktop bridge.';
    case 'offline':
      return state.reason === 'unsupported'
        ? 'Desktop automation is not supported on this platform. Activate for details.'
        : 'The local desktop bridge is offline. Activate for safe startup instructions and a health recheck.';
    case 'needs_pair':
      return 'The bridge is reachable and needs local pairing. Activate to pair it.';
    case 'capability_missing':
      return 'Ordinary desktop tools remain available, but uploaded-file opening needs a bridge update. Activate for exact recovery steps.';
    case 'source_changed':
      return 'New bridge source is ready for a user-owned supervisor restart. Activate for exact recovery steps.';
    case 'restart_blocked':
      return 'Current work or incomplete safety evidence blocks a bridge refresh. Activate to review the blocker without restarting anything.';
    case 'ready':
      return 'The current local desktop bridge is paired and ready. Activate to recheck it.';
  }
}

function visualFor(state: ChipState, accent: string, phase: ChipPhase): { label: string; dot: string; textColor: string } {
  if (phase === 'starting') return { label: 'START', dot: '#38bdf8', textColor: '#38bdf8' };
  if (phase === 'pairing') return { label: 'PAIRING', dot: '#f59e0b', textColor: '#f59e0b' };
  if (phase === 'checking') return { label: 'CHECK', dot: '#a78bfa', textColor: '#a78bfa' };
  switch (state.kind) {
    case 'loading':   return { label: '…',       dot: '#475569', textColor: '#64748b' };
    case 'offline':   return { label: 'OFFLINE', dot: '#ef4444', textColor: '#ef4444' };
    case 'needs_pair':return { label: 'PAIR',    dot: '#f59e0b', textColor: '#f59e0b' };
    case 'capability_missing': return { label: 'UPDATE', dot: '#f59e0b', textColor: '#f59e0b' };
    case 'source_changed': return { label: 'REFRESH', dot: '#38bdf8', textColor: '#38bdf8' };
    case 'restart_blocked': return { label: 'WAIT', dot: '#fb923c', textColor: '#fb923c' };
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
    minWidth: 44,
  },
});
