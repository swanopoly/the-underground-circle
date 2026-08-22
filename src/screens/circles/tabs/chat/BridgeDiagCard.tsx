/**
 * BridgeDiagCard — `/diag` panel showing the health of every local
 * bridge (Claude Code, Codex, Gemini CLI, Cursor, OpenSwan proxy)
 * with status dots, session counts, and copy-able restart commands
 * for offline bridges.
 *
 * Old behavior: `/diag` didn't exist. Users had to run
 * `npm run bridges:doctor` from the terminal to know what was up.
 * This brings the same info into chat where they're already typing.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import type { BridgeProbeResult, BridgeStatus } from '../../../../lib/bridgeHealthDiag';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const STATUS_COLOR: Record<BridgeStatus, string> = {
  healthy:  '#22c55e',
  degraded: '#f59e0b',
  offline:  '#ef4444',
};

const STATUS_LABEL: Record<BridgeStatus, string> = {
  healthy:  'HEALTHY',
  degraded: 'DEGRADED',
  offline:  'OFFLINE',
};

interface Props {
  results: BridgeProbeResult[];
  onRefresh?: () => void;
  refreshing?: boolean;
  accentColor?: string;
}

export default function BridgeDiagCard({ results, onRefresh, refreshing, accentColor = '#6366f1' }: Props) {
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const healthyCount = results.filter(r => r.status === 'healthy').length;

  const copyCommand = (key: string, cmd: string) => {
    if (Platform.OS !== 'web') return;
    try {
      // @ts-ignore — navigator.clipboard exists on web
      navigator.clipboard?.writeText(cmd);
      setCopiedFor(key);
      setTimeout(() => setCopiedFor((curr) => (curr === key ? null : curr)), 1500);
    } catch {}
  };

  return (
    <View style={[s.card, { borderColor: accentColor + '40' }]} nativeID="section-chat-bridge-diag">
      <View style={s.header}>
        <Text style={[s.kicker, { color: accentColor }]}>BRIDGE DIAGNOSTICS</Text>
        <View style={s.headerRight}>
          <Text style={s.summary}>{healthyCount} / {results.length} healthy</Text>
          {onRefresh ? (
            <Pressable
              onPress={onRefresh}
              disabled={refreshing}
              style={({ pressed }) => [
                s.refreshBtn,
                { borderColor: accentColor + '60' },
                pressed && { backgroundColor: accentColor + '20' },
                refreshing && { opacity: 0.5 },
              ]}
              accessibilityLabel="Re-probe bridges"
            >
              <Text style={[s.refreshText, { color: accentColor }]}>{refreshing ? '…' : '↻'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={s.rows}>
        {results.map((r) => {
          const tone = STATUS_COLOR[r.status];
          const showRestart = r.status === 'offline' && r.hint;
          const cmdMatch = r.hint?.match(/Restart with:\s*(.+)$/);
          const cmd = cmdMatch ? cmdMatch[1].trim() : null;
          const key = `${r.name}:${r.port}`;
          return (
            <View key={key} style={[s.row, { borderColor: tone + '30' }]}>
              <View style={s.rowMain}>
                <View style={[s.dot, { backgroundColor: tone }]} />
                <View style={{ flex: 1 }}>
                  <View style={s.rowHead}>
                    <Text style={s.label}>{r.label}</Text>
                    <Text style={[s.statusText, { color: tone }]}>{STATUS_LABEL[r.status]}</Text>
                  </View>
                  <Text style={s.detail} numberOfLines={2}>
                    :{r.port}{r.sessionCount !== undefined ? ` · ${r.sessionCount} session${r.sessionCount === 1 ? '' : 's'}` : ''} · {r.detail}
                  </Text>
                </View>
              </View>
              {showRestart && cmd ? (
                <Pressable
                  onPress={() => copyCommand(key, cmd)}
                  style={({ pressed }) => [
                    s.cmdRow,
                    { borderColor: tone + '40' },
                    pressed && { backgroundColor: tone + '14' },
                  ]}
                  accessibilityLabel="Copy restart command"
                >
                  <Text style={s.cmdLabel}>{copiedFor === key ? 'copied' : 'restart'}</Text>
                  <Text style={s.cmdText} numberOfLines={1}>{cmd}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  summary: { fontSize: 9, color: '#64748b', fontFamily: MONO },
  refreshBtn: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  refreshText: { fontSize: 12, fontWeight: '900' },
  rows: { gap: 6 },
  row: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 6,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  statusText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: MONO },
  detail: { color: '#94a3b8', fontSize: 10.5, marginTop: 1 },
  cmdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#020617',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 8,
  },
  cmdLabel: {
    color: '#64748b',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: MONO,
  },
  cmdText: { color: '#cbd5e1', fontSize: 10.5, fontFamily: MONO, flex: 1 },
});
