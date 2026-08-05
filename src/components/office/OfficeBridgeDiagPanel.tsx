/**
 * OfficeBridgeDiagPanel — passive bridge/pairing status on the MAIN Office
 * view. Complement of OfficeBridgeReadinessStrip: that strip is deliberately
 * warn/danger-only (silent when healthy), and per-bridge detail previously
 * existed only behind the `/desktop diag` chat command. This panel ALWAYS
 * renders — passive visibility even when everything is green — but stays one
 * line tall collapsed ('BRIDGES 4/5 ✓ · codex offline · 30s ago'); tap to
 * expand per-bridge rows.
 *
 * Self-polling (OfficeLaneHealthStrip pattern): owns its own ~30s interval
 * with a mounted-guard, takes no OfficeTab state. All impure deps
 * (bridgeEnvironment, bridgeHealthDiag) are lazy-imported inside the effect;
 * the render model comes from the pure officeBridgeDiagPanelCore, which
 * bounds and secret-scrubs every detail string.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  buildBridgeDiagPanelModel,
  type BridgeDiagPanelModel,
  type BridgeDiagRowStatus,
} from '../../lib/officeBridgeDiagPanelCore';

const POLL_MS = 30_000;

const TONE_COLORS = {
  ok: '#4ade80',
  warn: '#e8b339',
  danger: '#ef4444',
} as const;

const ROW_STATUS_COLORS: Record<BridgeDiagRowStatus, string> = {
  ok: '#4ade80',
  offline: '#ef4444',
  unpaired: '#e8b339',
  error: '#e8b339',
};

export default function OfficeBridgeDiagPanel() {
  const [model, setModel] = useState<BridgeDiagPanelModel | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const read = async () => {
      try {
        const { getBridgeEnvironment, getBridgeUrl } = await import('../../lib/bridgeEnvironment');
        if (!getBridgeEnvironment().available) {
          // Production web without opt-in: bridges aren't applicable here,
          // so a permanent 0/5 panel would be noise, not visibility.
          if (mounted) setModel(null);
          return;
        }
        const { probeBridges } = await import('../../lib/bridgeHealthDiag');
        const results = await probeBridges({
          timeoutMs: 1500,
          urlForPort: (port) => getBridgeUrl(port),
        });
        if (!mounted) return;
        const probedAtMs = Date.now();
        const stamped = results.map((r) => ({ ...r, raw: undefined, probedAtMs }));
        const next = buildBridgeDiagPanelModel(stamped, probedAtMs);
        setModel((prev) => {
          // Avoid re-render churn: only update when rendered text changes.
          if (
            prev &&
            prev.collapsedLine === next.collapsedLine &&
            JSON.stringify(prev.rows) === JSON.stringify(next.rows)
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        // Observability only — a probe error must never break Office. Show a
        // total, honest "no probe results" state instead of going blank.
        if (mounted) setModel((prev) => prev ?? buildBridgeDiagPanelModel([], Date.now()));
      }
    };

    read();
    timer = setInterval(read, POLL_MS);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (!model) return null;

  const color = TONE_COLORS[model.summary.tone];

  return (
    <View style={[styles.panel, { borderColor: color + '55' }]}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`Bridge status: ${model.collapsedLine}. Tap to ${expanded ? 'collapse' : 'expand'}.`}
      >
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.headline, { color }]} numberOfLines={1}>
          {model.collapsedLine}
        </Text>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.rows}>
          {model.rows.map((row) => (
            <View key={row.name} style={styles.row}>
              <View style={[styles.rowDot, { backgroundColor: ROW_STATUS_COLORS[row.status] }]} />
              <Text style={styles.rowName} numberOfLines={1}>{row.label}</Text>
              <Text style={[styles.rowStatus, { color: ROW_STATUS_COLORS[row.status] }]}>
                {row.status}
              </Text>
              <Text style={styles.rowDetail} numberOfLines={1}>
                {row.detail}{row.probedAgoLabel !== '—' ? ` · ${row.probedAgoLabel}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headline: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  chevron: {
    fontSize: 11,
    color: '#9e9e9e',
    fontFamily: 'monospace',
  },
  rows: {
    marginTop: 8,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowName: {
    width: 104,
    fontSize: 11,
    color: '#e0e0e0',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  rowStatus: {
    width: 64,
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  rowDetail: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    color: '#9e9e9e',
    fontFamily: 'monospace',
  },
});
