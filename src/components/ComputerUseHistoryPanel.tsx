/**
 * ComputerUseHistoryPanel — lists past Computer Use runs for a circle.
 * Ephemeral per-mount fetch with a 30s cache so moving tabs doesn't
 * refetch. Each row shows the task, status, timestamp, top finding (if
 * any), and quick actions (re-run, open live session, open run detail).
 *
 * Drop-in for ProfileTab, a chat header drawer, or a standalone screen.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  listCircleComputerUseRunsExact,
  type ComputerUseHistoryAuthorityFence,
  type ComputerUseHistoryExactAuthority,
  type ComputerUseRunRow,
} from '../lib/computerUseHistory';

interface Props {
  circleId: string;
  exactAuthority: ComputerUseHistoryExactAuthority | null;
  isExactAuthorityCurrent: ComputerUseHistoryAuthorityFence;
  accentColor?: string;
  /** Optional — lets the parent kick off a re-run / follow-up via the
   *  existing Computer Use flow. If omitted, the re-run button is hidden. */
  onRerun?: (task: string) => void;
  /** Hide the header for embedded use. */
  compact?: boolean;
  limit?: number;
}

// Tiny module-level cache so a re-mount (tab switch, parent re-render) is
// instant. Same pattern as CompletedWorkPanel.
const CACHE = new Map<string, { at: number; rows: ComputerUseRunRow[] }>();
const CACHE_TTL_MS = 30_000;

export default function ComputerUseHistoryPanel({
  circleId,
  exactAuthority,
  isExactAuthorityCurrent,
  accentColor = '#6366f1',
  onRerun,
  compact,
  limit = 20,
}: Props) {
  const [rows, setRows] = useState<ComputerUseRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const scopeKey = exactAuthority && isExactAuthorityCurrent(exactAuthority)
    ? `${exactAuthority.userId}:${exactAuthority.circleId}:${exactAuthority.generation}`
    : null;
  const visibleRows = loadedScopeKey === scopeKey ? rows : [];

  const refresh = useCallback(async (force = false) => {
    const requestedAuthority = exactAuthority;
    const requestedScopeKey = scopeKey;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const requestIsCurrent = (candidate: ComputerUseHistoryExactAuthority) => (
      requestGenerationRef.current === requestGeneration
      && requestedScopeKey !== null
      && candidate.userId === requestedAuthority?.userId
      && candidate.circleId === requestedAuthority?.circleId
      && candidate.accessToken === requestedAuthority?.accessToken
      && candidate.generation === requestedAuthority?.generation
      && isExactAuthorityCurrent(candidate)
    );
    if (!requestedAuthority || !requestedScopeKey || !requestIsCurrent(requestedAuthority)) {
      setRows([]);
      setLoadedScopeKey(null);
      setLoading(false);
      return;
    }
    const cached = CACHE.get(requestedScopeKey);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setRows(cached.rows);
      setLoadedScopeKey(requestedScopeKey);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await listCircleComputerUseRunsExact(
      circleId,
      limit,
      requestedAuthority,
      requestIsCurrent,
    );
    if (!requestIsCurrent(requestedAuthority)) return;
    const fresh = result.ok ? result.rows : [];
    if (result.ok) CACHE.set(requestedScopeKey, { at: Date.now(), rows: fresh });
    setRows(fresh);
    setLoadedScopeKey(requestedScopeKey);
    setLoading(false);
  }, [circleId, exactAuthority, isExactAuthorityCurrent, limit, scopeKey]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setRows([]);
    setLoadedScopeKey(null);
    setLoading(Boolean(scopeKey));
    void refresh();
    return () => { requestGenerationRef.current += 1; };
  }, [refresh, scopeKey]);

  return (
    <View style={[s.card, compact && { marginHorizontal: 0, marginTop: 0 }]}>
      {!compact ? (
        <View style={s.header}>
          <View style={[s.iconBox, { borderColor: `${accentColor}40`, backgroundColor: `${accentColor}15` }]}>
            <Text style={[s.iconText, { color: accentColor }]}>{'>_'}</Text>
          </View>
          <Text style={s.title}>BROWSER HISTORY</Text>
          <View style={s.countPill}>
            <Text style={s.countText}>{visibleRows.length}</Text>
          </View>
          <Pressable onPress={() => refresh(true)} style={s.refreshBtn} accessibilityRole="button">
            <Text style={s.refreshText}>↻</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && visibleRows.length === 0 ? (
        <Text style={s.hint}>LOADING…</Text>
      ) : visibleRows.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>No computer tasks yet</Text>
          <Text style={s.emptyHint}>Ask the chat to "research X" or "find top 5 Y" and your runs show up here.</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 8 }}>
            {visibleRows.map((r) => (
              <RunRow key={r.id} row={r} accentColor={accentColor} onRerun={onRerun} />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function RunRow({ row, accentColor, onRerun }: { row: ComputerUseRunRow; accentColor: string; onRerun?: (t: string) => void }) {
  const statusColor =
    row.status === 'done' ? '#22c55e' :
    row.status === 'error' ? '#ef4444' :
    row.status === 'cancelled' ? '#64748b' :
    accentColor;
  const topFinding = Array.isArray(row.findings) && row.findings.length > 0 ? row.findings[0] : null;
  return (
    <View style={s.row}>
      <View style={[s.rowDot, { backgroundColor: statusColor }]} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.rowTask} numberOfLines={2}>{row.task}</Text>
        {row.summary ? (
          <Text style={s.rowSummary} numberOfLines={2}>{row.summary}</Text>
        ) : row.error_message ? (
          <Text style={[s.rowSummary, { color: '#ef4444' }]} numberOfLines={2}>{row.error_message}</Text>
        ) : null}
        {topFinding ? (
          <Text style={s.rowFinding} numberOfLines={1}>↗ {topFinding.title}{topFinding.price ? ` · ${topFinding.price}` : ''}</Text>
        ) : null}
        <View style={s.rowMetaBar}>
          <Text style={[s.rowBadge, { color: statusColor, borderColor: `${statusColor}55` }]}>
            {row.status.toUpperCase()}
          </Text>
          <Text style={s.rowMeta}>{timeAgo(row.created_at)}</Text>
          {row.iterations > 0 ? <Text style={s.rowMeta}>{row.iterations} step{row.iterations === 1 ? '' : 's'}</Text> : null}
          {row.live_url ? (
            <Pressable onPress={() => Linking.openURL(row.live_url!)} style={s.rowAction} accessibilityRole="button">
              <Text style={[s.rowActionText, { color: '#38bdf8' }]}>OPEN ↗</Text>
            </Pressable>
          ) : null}
          {onRerun && row.status !== 'running' ? (
            <Pressable onPress={() => onRerun(row.task)} style={s.rowAction} accessibilityRole="button">
              <Text style={[s.rowActionText, { color: accentColor }]}>RE-RUN</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'NOW';
  if (mins < 60) return `${mins}M`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}D`;
  return new Date(iso).toLocaleDateString();
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '900',
  },
  title: {
    flex: 1,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  countPill: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#243041',
    alignItems: 'center',
  },
  countText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },
  refreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  refreshText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: 'monospace',
    paddingVertical: 10,
  },
  emptyBox: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0a0f1c',
    gap: 6,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyHint: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#020617',
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  rowTask: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  rowSummary: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  rowFinding: {
    color: '#38bdf8',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  rowMetaBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  rowBadge: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    fontFamily: 'monospace',
  },
  rowMeta: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 0.4,
  },
  rowAction: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  rowActionText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
});
