/**
 * TaskNextActionPanel — surfaces the durable "next recommended action" that an
 * agent run already computed and persisted for a task, but that until now was
 * only ever read server-side into a hidden "TASK RESUME CONTEXT" prompt string
 * and rendered in zero UI.
 *
 * Backing data (all real, nothing fabricated):
 *   - `saveTaskRunResumeSnapshot` (src/lib/taskExecutionRuntime.ts) inserts one
 *     row per checkpoint into `task_run_context_snapshots` with `next_actions`,
 *     `blockers`, `summary`, and `deliverable_excerpt`.
 *   - The server prompt builder reads it back with exactly the select mirrored
 *     below (taskExecutionRuntime.ts, `=== TASK RESUME CONTEXT ===`), taking the
 *     latest checkpoint per run. This panel reads the same rows under the same
 *     RLS SELECT policy (authenticated circle members) — a pure read, no new
 *     write path, no schema change, no secrets.
 *
 * It takes the run ids TaskDetailModal already loads (`taskRuns`), finds the
 * single most recent snapshot across them (newest `created_at`, then highest
 * `checkpoint_index`), and shows that run's next recommended action, remaining
 * follow-ups, blockers, and deliverable excerpt.
 *
 * Follows the FileLeasePanel shell: collapsed by default, a silent count badge
 * (number of pending next actions) so it is discoverable without expanding, a
 * one-line preview of the top action while collapsed, and an honest empty state
 * when a run exists but never recorded a resume snapshot. It renders nothing at
 * all when there are no runs to read — genuinely silent when there is nothing
 * to show. A read error fails soft to the empty state; it must never break the
 * task modal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Platform } from 'react-native';
import { supabase } from '../../../../lib/supabase';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const ACCENT = '#38bdf8';

interface Props {
  /** Run ids for this task (TaskDetailModal's `taskRuns.map(r => r.id)`).
   *  The panel reads the latest persisted resume snapshot across these runs. */
  runIds: string[];
}

interface LatestSnapshot {
  summary: string;
  nextActions: string[];
  blockers: string[];
  deliverable: string;
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

export default function TaskNextActionPanel({ runIds }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<LatestSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Stable dependency key so the effect does not re-run on every render just
  // because the `runIds` array identity changed.
  const runIdsKey = useMemo(
    () => runIds.filter((id) => typeof id === 'string' && id.length > 0).join(','),
    [runIds],
  );

  const load = useCallback(async () => {
    const ids = runIdsKey ? runIdsKey.split(',') : [];
    if (ids.length === 0) {
      setSnapshot(null);
      setLoading(false);
      setHasLoadedOnce(true);
      return;
    }
    try {
      // Mirrors the server read in taskExecutionRuntime.ts (`TASK RESUME
      // CONTEXT`), but ordered to the single most-recent checkpoint across the
      // task's runs — that is the current "what to do next".
      const { data } = await supabase
        .from('task_run_context_snapshots')
        .select('summary, blockers, next_actions, deliverable_excerpt, created_at, checkpoint_index')
        .in('task_run_id', ids)
        .order('created_at', { ascending: false })
        .order('checkpoint_index', { ascending: false })
        .limit(1);

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        setSnapshot(null);
      } else {
        setSnapshot({
          summary: typeof row.summary === 'string' ? row.summary : '',
          nextActions: toStringList(row.next_actions),
          blockers: toStringList(row.blockers),
          deliverable: typeof row.deliverable_excerpt === 'string' ? row.deliverable_excerpt : '',
        });
      }
    } catch {
      // Observability only — a snapshot read error must never break the modal.
      setSnapshot(null);
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [runIdsKey]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Nothing to ever show for a task with no runs — stay genuinely silent.
  if (!runIdsKey) return null;

  const nextActions = snapshot?.nextActions ?? [];
  const blockers = snapshot?.blockers ?? [];
  const deliverable = snapshot?.deliverable ?? '';
  const hasContent = nextActions.length > 0 || blockers.length > 0 || deliverable.length > 0;
  const topAction = nextActions[0] || '';
  const followUps = nextActions.slice(1);

  return (
    <View style={styles.wrap} nativeID="section-task-next-action">
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Toggle next recommended action"
      >
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>➜</Text>
          <Text style={styles.headerTitle}>NEXT STEP</Text>
          {nextActions.length > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{nextActions.length}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          {loading && !hasLoadedOnce ? <ActivityIndicator size="small" color="#6f6f6f" /> : null}
          <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
        </View>
      </Pressable>

      {/* One-line preview of the top action so it is glanceable while collapsed. */}
      {!expanded && topAction ? (
        <Text style={styles.preview} numberOfLines={1}>{topAction}</Text>
      ) : null}

      {expanded ? (
        <View style={styles.body}>
          {loading && !hasLoadedOnce ? (
            <ActivityIndicator size="small" color="#e8e8e8" style={{ marginTop: 4 }} />
          ) : !hasContent ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No recommended next action recorded yet.</Text>
              <Text style={styles.emptySubtext}>
                This appears after an agent run checkpoints its progress on this task.
              </Text>
            </View>
          ) : (
            <>
              {topAction ? (
                <View style={styles.actionCard}>
                  <Text style={styles.actionLabel}>Next recommended action</Text>
                  <Text style={styles.actionText}>{topAction}</Text>
                </View>
              ) : null}

              {followUps.length > 0 ? (
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>Then</Text>
                  {followUps.map((action, index) => (
                    <View key={`${index}-${action}`} style={styles.bulletRow}>
                      <Text style={styles.bulletMark}>{index + 2}.</Text>
                      <Text style={styles.bulletText}>{action}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {blockers.length > 0 ? (
                <View style={styles.group}>
                  <Text style={[styles.groupLabel, styles.blockerLabel]}>Blockers</Text>
                  {blockers.map((blocker, index) => (
                    <View key={`${index}-${blocker}`} style={styles.bulletRow}>
                      <Text style={[styles.bulletMark, styles.blockerMark]}>•</Text>
                      <Text style={styles.bulletText}>{blocker}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {deliverable ? (
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>Latest deliverable</Text>
                  <Text style={styles.deliverableText}>{deliverable}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '800',
  },
  headerTitle: {
    color: '#9e9e9e',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  countBadge: {
    backgroundColor: `${ACCENT}25`,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
  },
  countBadgeText: {
    color: '#7dd3fc',
    fontSize: 10,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevron: {
    color: '#6f6f6f',
    fontSize: 12,
  },
  preview: {
    color: '#b5b5b5',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 10,
    marginTop: -2,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  empty: {
    padding: 14,
    alignItems: 'center',
    backgroundColor: '#16161640',
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#252525',
  },
  emptyText: {
    color: '#8b949e',
    fontSize: 12,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#6f6f6f',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  actionCard: {
    backgroundColor: `${ACCENT}12`,
    borderWidth: 1,
    borderColor: `${ACCENT}33`,
    borderRadius: 8,
    padding: 10,
  },
  actionLabel: {
    color: '#7dd3fc',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  actionText: {
    color: '#e8e8e8',
    fontSize: 13,
    lineHeight: 19,
  },
  group: {
    marginTop: 12,
  },
  groupLabel: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  blockerLabel: {
    color: '#f59e0b',
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  bulletMark: {
    color: '#6f6f6f',
    fontSize: 12,
    lineHeight: 18,
    minWidth: 16,
  },
  blockerMark: {
    color: '#f59e0b',
  },
  bulletText: {
    color: '#b5b5b5',
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  deliverableText: {
    color: '#b5b5b5',
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
