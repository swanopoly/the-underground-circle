/**
 * ToolCallCheckpointStrip — the Compare · Restore control rendered under
 * a destructive chat tool call (Cline research item 6+7). Given a
 * checkpoint id, renders a small strip with:
 *
 *   ● Checkpoint · {diffSummary}     [Compare]  [Restore]
 *
 * The strip is pure UI + delegated handlers — it knows how to call
 * `restoreCheckpoint(id)` and `listCheckpoints(circleId, { planId })` but
 * otherwise keeps logic in `src/lib/chatCheckpoints.ts`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  listCheckpoints,
  restoreCheckpoint,
  type ChatCheckpointRow,
} from '../lib/chatCheckpoints';

interface Props {
  circleId: string;
  threadId: string;
  /** Either a specific checkpoint id OR a planId to auto-list for. */
  checkpointId?: string;
  planId?: string;
  accentColor?: string;
  /** Opens a side-by-side before/after drawer. Caller wires it up so
   *  the strip stays free of drawer state. */
  onOpenCompare?: (row: ChatCheckpointRow) => void;
  /** Called after a successful restore (caller refreshes chat, etc.) */
  onRestored?: (row: ChatCheckpointRow) => void;
}

export default function ToolCallCheckpointStrip({
  circleId,
  threadId,
  checkpointId,
  planId,
  accentColor = '#6366f1',
  onOpenCompare,
  onRestored,
}: Props) {
  const [rows, setRows] = useState<ChatCheckpointRow[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string | null>>({});

  const refresh = useCallback(async () => {
    if (!circleId) return;
    if (checkpointId) {
      // Search a window, not just the newest row — the strip may render for
      // a checkpoint that is no longer the circle's latest.
      const all = await listCheckpoints(circleId, { threadId, limit: 25 });
      const match = all.find((r) => r.id === checkpointId);
      setRows(match ? [match] : []);
      return;
    }
    if (planId) {
      const list = await listCheckpoints(circleId, { planId, threadId });
      setRows(list);
    }
  }, [circleId, checkpointId, planId, threadId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRestore = useCallback(async (row: ChatCheckpointRow) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    setError((e) => ({ ...e, [row.id]: null }));
    const outcome = await restoreCheckpoint(row.id);
    setBusy((b) => ({ ...b, [row.id]: false }));
    if (!outcome.ok) {
      // Drift refusal is a safety feature, not a failure — say so instead of
      // echoing the raw hash-mismatch error.
      const friendly = outcome.drift
        ? 'Not restored: this was edited again after the checkpoint, so restoring would overwrite the newer change. Compare to review.'
        : `Restore failed: ${outcome.error || 'unknown error'}. Nothing was changed.`;
      setError((e) => ({ ...e, [row.id]: friendly }));
      return;
    }
    onRestored?.(row);
    refresh();
  }, [onRestored, refresh]);

  if (rows.length === 0) return null;

  return (
    <View style={styles.container}>
      {rows.map((row) => {
        const restored = !!row.restored_at;
        const busyFlag = !!busy[row.id];
        const err = error[row.id];
        return (
          <View key={row.id} style={[styles.strip, { borderColor: accentColor + '44' }]}>
            <View style={[styles.dot, { backgroundColor: restored ? '#475569' : accentColor }]} />
            <View style={styles.textCol}>
              <Text style={styles.label}>
                {restored ? 'RESTORED' : 'CHECKPOINT'}
                <Text style={styles.subtle}> · {row.diff_summary || row.tool_kind}</Text>
              </Text>
              {err ? <Text style={styles.error}>{err}</Text> : null}
            </View>
            {onOpenCompare ? (
              <Pressable
                onPress={() => onOpenCompare(row)}
                style={({ hovered }: any) => [
                  styles.btn,
                  hovered && { borderColor: accentColor + '88', backgroundColor: accentColor + '12' },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
              >
                <Text style={styles.btnText}>COMPARE</Text>
              </Pressable>
            ) : null}
            {!restored ? (
              <Pressable
                onPress={() => handleRestore(row)}
                disabled={busyFlag}
                style={({ hovered }: any) => [
                  styles.btn,
                  { borderColor: accentColor + '66', backgroundColor: accentColor + '10' },
                  hovered && !busyFlag && { backgroundColor: accentColor + '24', borderColor: accentColor },
                  busyFlag && { opacity: 0.5 },
                  Platform.OS === 'web' && ({ cursor: busyFlag ? 'wait' : 'pointer' } as any),
                ]}
              >
                <Text style={[styles.btnText, { color: accentColor }]}>
                  {busyFlag ? 'RESTORING…' : 'RESTORE'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6, marginTop: 8 },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#0a0f1c',
  },
  dot: { width: 8, height: 8, borderRadius: 999 },
  textCol: { flex: 1, gap: 2 },
  label: {
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  subtle: {
    color: '#94a3b8',
    fontWeight: '400',
    letterSpacing: 0,
  },
  error: {
    color: '#ef4444',
    fontFamily: 'monospace',
    fontSize: 9,
  },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  btnText: {
    color: '#94a3b8',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
});
