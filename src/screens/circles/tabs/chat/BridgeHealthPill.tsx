/**
 * BridgeHealthPill — tiny live indicator showing whether the local
 * claude-bridge is reachable. Surfaces the dependency that /run, /sh,
 * /cd, and the RUN buttons all rely on.
 *
 * Hidden when status is unknown (initial mount, before the first probe
 * completes) to avoid a flicker. Tap to force-refresh.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { useBridgeHealth } from '../../../../lib/useBridgeHealth';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  compact?: boolean;
}

export default function BridgeHealthPill({ compact = false }: Props) {
  const { status, refresh } = useBridgeHealth();
  if (status === 'unknown') return null;

  const isOnline = status === 'online';
  const dotColor = isOnline ? '#22c55e' : '#ef4444';
  const labelColor = isOnline ? '#22c55e' : '#ef4444';
  const label = isOnline
    ? (compact ? 'BRIDGE' : 'BRIDGE ONLINE')
    : (compact ? 'OFFLINE' : 'BRIDGE OFFLINE');

  return (
    <Pressable onPress={refresh} style={[s.pill, { borderColor: dotColor + '40' }]} hitSlop={6}>
      <View style={[s.dot, { backgroundColor: dotColor }]} />
      <Text style={[s.label, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#0a0f1c',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    fontFamily: MONO,
  },
});
