/**
 * BridgeStatusPanel — live dashboard for all 5 local bridges.
 *
 * Replaces the old "is the agent loading?" mystery with a one-glance
 * grid: each bridge gets a row showing port, status, session count (or
 * auth state), and an actionable hint. Polls /health every 30s when
 * everything's healthy, every 5s when anything is broken so recovery
 * is felt fast.
 *
 * Mountable wherever you want bridge visibility — designed for the
 * Control Panel diagnostics surface, but also useful as a standalone
 * popover from the composer's existing DesktopBridgeStatusChip.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { probeBridges, type BridgeProbeResult } from '../../../../lib/bridgeHealthDiag';

interface Props {
  accentColor?: string;
  /** When set, tapping a row that has a fix command surfaces it via
   *  this callback so the host (e.g. ChatTab) can decide whether to
   *  show as a localOnly message, copy to clipboard, or otherwise. */
  onCopyFix?: (command: string, bridgeLabel: string) => void;
  /** When false, suppresses the auto-refresh interval (tests). */
  autoRefresh?: boolean;
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const STATUS_COLORS: Record<BridgeProbeResult['status'], string> = {
  healthy: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
};

function formatSecondsAgo(ms: number | null): string {
  if (ms == null) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function BridgeStatusPanel({
  accentColor = '#22d3ee',
  onCopyFix,
  autoRefresh = true,
}: Props) {
  const [results, setResults] = useState<BridgeProbeResult[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const cancelledRef = useRef(false);

  const probe = useCallback(async () => {
    if (cancelledRef.current) return;
    setRefreshing(true);
    try {
      const r = await probeBridges({ timeoutMs: 2500 });
      if (!cancelledRef.current) {
        setResults(r);
        setLastChecked(Date.now());
      }
    } finally {
      if (!cancelledRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void probe();
    if (!autoRefresh) {
      return () => { cancelledRef.current = true; };
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      // Faster polling while broken so recovery shows up quickly.
      const broken = (results || []).some(r => r.status === 'offline');
      const delay = broken ? 5_000 : 30_000;
      timer = setTimeout(async () => {
        await probe();
        if (!cancelledRef.current) schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, autoRefresh, probe]);

  const counts = results ? {
    healthy: results.filter(r => r.status === 'healthy').length,
    degraded: results.filter(r => r.status === 'degraded').length,
    offline: results.filter(r => r.status === 'offline').length,
  } : null;

  return (
    <View style={[s.card, { borderColor: accentColor + '30' }]} nativeID="section-bridge-status">
      <View style={s.headerRow}>
        <Text style={s.title}>BRIDGE STATUS</Text>
        <Pressable onPress={() => { void probe(); }} hitSlop={8} style={[s.refreshBtn, { borderColor: accentColor + '40' }]}>
          <Text style={[s.refreshText, { color: accentColor }]}>{refreshing ? '…' : '↻'}</Text>
        </Pressable>
      </View>

      {!results ? (
        <Text style={s.muted}>Probing…</Text>
      ) : (
        <>
          <View style={s.summaryRow}>
            <Text style={[s.summaryItem, { color: STATUS_COLORS.healthy }]}>{counts!.healthy} healthy</Text>
            <Text style={[s.summaryItem, { color: STATUS_COLORS.degraded }]}>{counts!.degraded} degraded</Text>
            <Text style={[s.summaryItem, { color: STATUS_COLORS.offline }]}>{counts!.offline} offline</Text>
            <Text style={s.lastChecked}>checked {formatSecondsAgo(lastChecked)}</Text>
          </View>

          <View style={s.list}>
            {results.map(r => (
              <View key={r.name} style={[s.row, { borderColor: STATUS_COLORS[r.status] + '40' }]}>
                <View style={s.rowHeader}>
                  <View style={[s.dot, { backgroundColor: STATUS_COLORS[r.status] }]} />
                  <Text style={s.rowLabel}>{r.label}</Text>
                  <Text style={s.rowPort}>:{r.port}</Text>
                  <Text style={[s.rowStatus, { color: STATUS_COLORS[r.status] }]}>{r.status.toUpperCase()}</Text>
                </View>
                <Text style={s.rowDetail}>{r.detail}</Text>
                {typeof r.sessionCount === 'number' && r.sessionCount >= 0 ? (
                  <Text style={s.rowMeta}>{r.sessionCount} session{r.sessionCount === 1 ? '' : 's'}</Text>
                ) : null}
                {r.hint ? (
                  <View style={s.hintRow}>
                    <Text style={s.rowHint} numberOfLines={2}>{r.hint}</Text>
                    {onCopyFix ? (
                      <Pressable onPress={() => onCopyFix(r.hint!, r.label)} style={[s.fixBtn, { borderColor: accentColor + '60' }]}>
                        <Text style={[s.fixBtnText, { color: accentColor }]}>copy</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
          </View>

          {counts!.offline > 0 ? (
            <Text style={s.footer}>
              For deeper diagnosis (foreign-user wedges, etc.), run{' '}
              <Text style={s.footerCode}>npm run bridges:doctor</Text>{' '}
              in your shell.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#909098', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, fontFamily: MONO },
  muted: { color: '#6f6f6f', fontSize: 11, fontFamily: MONO },
  refreshBtn: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: '#1e293b',
  },
  refreshText: { fontSize: 11, fontWeight: '800', fontFamily: MONO, color: '#9e9e9e' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  summaryItem: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: MONO },
  lastChecked: { fontSize: 9, color: '#475569', fontFamily: MONO, marginLeft: 'auto' },
  list: { gap: 6 },
  row: {
    backgroundColor: '#0f172a',
    borderWidth: 1, borderRadius: 6, padding: 10, gap: 4,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  rowPort: { color: '#64748b', fontSize: 10, fontFamily: MONO },
  rowStatus: { fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: MONO, marginLeft: 'auto' },
  rowDetail: { color: '#94a3b8', fontSize: 11, fontFamily: MONO },
  rowMeta: { color: '#64748b', fontSize: 10, fontFamily: MONO },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  rowHint: { flex: 1, color: '#cbd5e1', fontSize: 10, lineHeight: 14, fontFamily: MONO },
  fixBtn: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
    borderWidth: 1, backgroundColor: '#0a0f1c',
  },
  fixBtnText: { fontSize: 9, fontWeight: '800', fontFamily: MONO },
  footer: {
    color: '#64748b', fontSize: 10, lineHeight: 14, fontFamily: MONO,
    paddingTop: 4, borderTopWidth: 1, borderTopColor: '#1e293b',
  },
  footerCode: { color: '#22d3ee', fontFamily: MONO },
});
