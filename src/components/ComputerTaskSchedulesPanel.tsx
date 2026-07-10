import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  deleteComputerTaskSchedule,
  listComputerTaskSchedules,
  setComputerTaskScheduleActive,
} from '../lib/computerTaskSchedules';
import {
  describeWatchCadence,
  type ComputerTaskScheduleRow,
} from '../lib/computerTaskScheduleModel';
import { formatChatAttentionDuration } from '../lib/chatAttentionQueue';

/**
 * ComputerTaskSchedulesPanel — the reviewable list of recurring
 * computer-task watches (Phase 6a).
 *
 * Watches ("check X daily, tell me what changed") accumulate quietly and
 * would otherwise only surface when one fires into chat. This panel gives
 * Office a standing-watches hygiene surface: what is being checked, how
 * often, when the next check lands, what changed last time, and one-tap
 * pause/resume/delete.
 */

interface Props {
  circleId: string;
  accentColor?: string;
  /** Re-load trigger; bump when a watch may have changed elsewhere. */
  refreshToken?: number;
}

export default function ComputerTaskSchedulesPanel({ circleId, accentColor = '#22c55e', refreshToken = 0 }: Props) {
  const [schedules, setSchedules] = useState<ComputerTaskScheduleRow[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSchedules(await listComputerTaskSchedules(circleId));
    } catch { /* store fails soft — panel stays empty */ }
  }, [circleId]);

  useEffect(() => { void refresh(); }, [refresh, refreshToken]);

  const handleToggleActive = useCallback(async (schedule: ComputerTaskScheduleRow) => {
    setBusyId(schedule.id);
    try {
      await setComputerTaskScheduleActive(schedule.id, !schedule.active);
      await refresh();
    } catch { /* keep the row; user can retry */ }
    setBusyId(null);
  }, [refresh]);

  const handleDelete = useCallback(async (schedule: ComputerTaskScheduleRow) => {
    setBusyId(schedule.id);
    try {
      await deleteComputerTaskSchedule(schedule.id);
      await refresh();
    } catch { /* keep the row; user can retry */ }
    setBusyId(null);
  }, [refresh]);

  if (schedules.length === 0) return null;

  const activeCount = schedules.filter((schedule) => schedule.active).length;
  const pausedCount = schedules.length - activeCount;

  return (
    <View style={[styles.container, { borderColor: accentColor + '33' }]}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel="Toggle computer-task watches list"
      >
        <Text style={styles.headerText} numberOfLines={1}>
          Watches: {activeCount} active
          {pausedCount > 0 ? ` · ${pausedCount} paused` : ''}
        </Text>
        <Text style={[styles.chevron, { color: accentColor }]}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded && schedules.map((schedule) => {
        const busy = busyId === schedule.id;
        const untilNextMs = Date.parse(schedule.next_run_at) - Date.now();
        const checkLabel = schedule.active
          ? `next check in ${formatChatAttentionDuration(Math.max(0, untilNextMs))}`
          : 'paused';
        const notifyLabel = schedule.notify_on === 'changes_only' ? 'changes only' : 'every check';
        return (
          <View key={schedule.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.taskText} numberOfLines={2}>
                🔁 {schedule.task}
              </Text>
              <Text style={styles.metaText} numberOfLines={1}>
                {describeWatchCadence(schedule.cadence)} · {checkLabel} · {notifyLabel}
              </Text>
              {schedule.last_diff_summary ? (
                <Text style={styles.diffText} numberOfLines={2}>
                  {schedule.last_diff_summary}
                </Text>
              ) : null}
            </View>
            <Pressable
              disabled={busy}
              onPress={() => { void handleToggleActive(schedule); }}
              style={({ hovered }: any) => [
                styles.pauseButton,
                hovered && { borderColor: accentColor, backgroundColor: accentColor + '18' },
                busy && { opacity: 0.5 },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              ]}
            >
              <Text style={styles.pauseText}>{schedule.active ? 'PAUSE' : 'RESUME'}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => { void handleDelete(schedule); }}
              style={({ hovered }: any) => [
                styles.deleteButton,
                hovered && { borderColor: '#ef4444', backgroundColor: '#ef444418' },
                busy && { opacity: 0.5 },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              ]}
            >
              <Text style={styles.deleteText}>DELETE</Text>
            </Pressable>
          </View>
        );
      })}
      {expanded ? (
        <Text style={styles.footer}>
          Watches run while the app is open and only report what changed. Consequential actions (pay/delete/login) are never allowed in a watch.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#0d150d',
    marginHorizontal: 12,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  headerText: {
    flex: 1,
    color: '#d9e4d3',
    fontSize: 12,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#1b271b',
    paddingVertical: 7,
    marginTop: 5,
  },
  rowText: { flex: 1 },
  taskText: {
    color: '#e6efe2',
    fontSize: 12,
    fontWeight: '700',
  },
  metaText: {
    color: '#8e9f8e',
    fontSize: 11,
    marginTop: 1,
  },
  diffText: {
    color: '#6f7f6f',
    fontSize: 10,
    marginTop: 2,
  },
  pauseButton: {
    borderWidth: 1,
    borderColor: '#263326',
    backgroundColor: '#101a10',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pauseText: {
    color: '#b7c8b0',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#3a1d1d',
    backgroundColor: '#1d0f0f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  footer: {
    color: '#6f7f6f',
    fontSize: 10,
    marginTop: 6,
  },
});
