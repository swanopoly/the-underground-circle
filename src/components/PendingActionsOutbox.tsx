/**
 * PendingActionsOutbox
 *
 * Shows every queued `scheduled_action` for the current user (optionally
 * scoped to a circle). Compact row-per-action with cancel/retry affordances.
 * Embed anywhere — Office Overview, Chat header, a dedicated "Outbox" tab.
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  type ScheduledAction,
  cancelAction,
  describeAction,
  kindLabel,
  retryAction,
  usePendingActions,
} from '../lib/scheduledActions';

interface Props {
  circleId?: string;
  maxHeight?: number;
}

export default function PendingActionsOutbox({ circleId, maxHeight = 320 }: Props) {
  const { actions, loading } = usePendingActions(circleId);

  const buckets = useMemo(() => {
    const outcomeUnknown = actions.filter(a => a.status === 'outcome_unknown');
    const failed = actions.filter(a => a.status === 'failed');
    const running = actions.filter(a => a.status === 'running');
    const pending = actions.filter(a => a.status === 'pending');
    return { outcomeUnknown, failed, running, pending };
  }, [actions]);

  if (loading && actions.length === 0) {
    return (
      <View style={styles.shell}>
        <Text style={styles.header}>OUTBOX</Text>
        <Text style={styles.empty}>Loading…</Text>
      </View>
    );
  }

  const total = actions.length;

  return (
    <View style={styles.shell}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>OUTBOX</Text>
        <Text style={styles.counterText}>
          {total === 0 ? 'nothing queued' : `${total} in flight`}
        </Text>
      </View>

      {total === 0 ? (
        <Text style={styles.empty}>
          Nothing queued. Ask OpenSwan to post to Bluesky, draft an email, or send a webhook — it'll land here.
        </Text>
      ) : (
        <ScrollView style={{ maxHeight }} contentContainerStyle={{ paddingVertical: 4 }}>
          {buckets.outcomeUnknown.length > 0 && (
            <Section title="VERIFY — OUTCOME UNKNOWN" tone="#f59e0b">
              {buckets.outcomeUnknown.map(a => <ActionRow key={a.id} action={a} />)}
            </Section>
          )}
          {buckets.failed.length > 0 && (
            <Section title="FAILED — tap retry" tone="#ef4444">
              {buckets.failed.map(a => <ActionRow key={a.id} action={a} />)}
            </Section>
          )}
          {buckets.running.length > 0 && (
            <Section title="RUNNING NOW" tone="#22d3ee">
              {buckets.running.map(a => <ActionRow key={a.id} action={a} />)}
            </Section>
          )}
          {buckets.pending.length > 0 && (
            <Section title="QUEUED" tone="#a3a3a3">
              {buckets.pending.map(a => <ActionRow key={a.id} action={a} />)}
            </Section>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Section({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: tone }]}>{title}</Text>
      {children}
    </View>
  );
}

function ActionRow({ action }: { action: ScheduledAction }) {
  const summary = describeAction(action);
  const when = formatWhen(action.scheduled_for);
  const statusMessage = action.status === 'outcome_unknown'
    ? 'This may have completed. Verify the destination before creating a new action; automatic replay is disabled.'
    : action.status === 'failed'
      ? 'Blocked before dispatch. Review the action, then retry to request fresh approval.'
      : null;
  const badgeColor = action.status === 'outcome_unknown' ? '#f59e0b'
    : action.status === 'failed' ? '#ef4444'
    : action.status === 'running' ? '#22d3ee'
    : '#a3a3a3';

  const canCancel = action.status === 'pending';
  const canRetry = action.status === 'failed';

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.rowTopLine}>
          <Text style={[styles.rowKind, { color: badgeColor, borderColor: badgeColor }]}>
            {kindLabel(action.kind).toUpperCase()}
          </Text>
          <Text style={styles.rowWhen}>{when}</Text>
        </View>
        <Text style={styles.rowSummary} numberOfLines={2}>{summary}</Text>
        {statusMessage && (
          <Text
            style={action.status === 'outcome_unknown' ? styles.rowWarning : styles.rowError}
            numberOfLines={3}
          >
            {action.status === 'outcome_unknown' ? '⚠ ' : '✗ '}{statusMessage}
          </Text>
        )}
      </View>

      <View style={styles.rowActions}>
        {canCancel && (
          <Pressable
            onPress={async () => { try { await cancelAction(action.id); } catch { console.warn('[Outbox] cancel_failed'); } }}
            style={styles.rowBtn}
          >
            <Text style={styles.rowBtnText}>CANCEL</Text>
          </Pressable>
        )}
        {canRetry && (
          <Pressable
            onPress={async () => { try { await retryAction(action.id); } catch { console.warn('[Outbox] retry_failed'); } }}
            style={[styles.rowBtn, styles.rowBtnPrimary]}
          >
            <Text style={[styles.rowBtnText, styles.rowBtnTextPrimary]}>RETRY</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function formatWhen(iso: string): string {
  const t = new Date(iso).getTime();
  const delta = t - Date.now();
  const absMin = Math.abs(delta) / 60_000;
  if (delta > 60_000) {
    if (absMin < 60) return `in ${Math.round(absMin)}m`;
    if (absMin < 60 * 24) return `in ${Math.round(absMin / 60)}h`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (delta > -60_000) return 'now';
  if (absMin < 60) return `${Math.round(absMin)}m ago`;
  if (absMin < 60 * 24) return `${Math.round(absMin / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 4,
    padding: 12,
    gap: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  header: {
    color: '#d6d6e1',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    fontFamily: 'monospace',
  },
  counterText: {
    color: '#606075',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  empty: {
    color: '#606075',
    fontSize: 12,
    lineHeight: 17,
  },
  section: { marginBottom: 8, gap: 4 },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: 'monospace',
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 3,
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#1a1a28',
    marginBottom: 4,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowKind: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
  },
  rowWhen: { color: '#606075', fontSize: 10, fontFamily: 'monospace' },
  rowSummary: { color: '#d6d6e1', fontSize: 12, lineHeight: 16 },
  rowError: { color: '#ef4444', fontSize: 11, fontFamily: 'monospace' },
  rowWarning: { color: '#f59e0b', fontSize: 11, lineHeight: 15, fontFamily: 'monospace' },
  rowActions: { flexDirection: 'row', gap: 4 },
  rowBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#0a0a10',
  },
  rowBtnPrimary: { borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#22d3ee18' },
  rowBtnText: {
    color: '#a3a3a3',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  rowBtnTextPrimary: { color: '#22d3ee' },
});
