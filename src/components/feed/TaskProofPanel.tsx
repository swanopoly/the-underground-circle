/**
 * TaskProofPanel — task ↔ proof-of-work back-link panel for TaskDetailModal.
 *
 * proof_of_work rows carry their task linkage only inside `detail.task_id`
 * (JSONB — not indexable without a migration), so this panel mirrors
 * ActivityFeedPanel's query style: one bounded circle-scoped select
 * (order created_at desc, limit 100) via the singleton supabase client, then
 * client-side filtering through the pure `taskProofQueryCore`.
 *
 * Renders a 'PROOF (N) · last verified ✓/✗' header plus each matched row via
 * the existing shared AgentRunProofDetail reader (verified badge, secret-safe
 * bullets, GitHub reference chips). Empty result or ANY error → renders null
 * (silent) — this panel is additive evidence, never a blocker.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '../../lib/supabase';
import AgentRunProofDetail from './AgentRunProofDetail';
import {
  filterProofRowsForTask,
  summarizeTaskProof,
  type TaskProofMatch,
} from '../../lib/taskProofQueryCore';

interface Props {
  circleId: string;
  taskId: string;
}

/** Compact relative time (mirrors the modal's timeSince idiom). */
function timeSince(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function TaskProofPanel({ circleId, taskId }: Props) {
  const [matches, setMatches] = useState<TaskProofMatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await supabase
          .from('proof_of_work')
          .select('id, pow_type, title, agent_name, created_at, detail')
          .eq('circle_id', circleId)
          .order('created_at', { ascending: false })
          .limit(100);
        if (cancelled) return;
        if (res.error || !res.data) {
          setMatches([]);
          return;
        }
        setMatches(filterProofRowsForTask(res.data, taskId));
      } catch {
        if (!cancelled) setMatches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [circleId, taskId]);

  if (matches.length === 0) return null;

  const summary = summarizeTaskProof(matches);

  return (
    <View style={s.wrap}>
      <Text style={s.sectionLabel}>
        {`PROOF (${summary.count})`}
        {summary.latestVerified !== null && (
          <Text style={{ color: summary.latestVerified ? '#22c55e' : '#f59e0b' }}>
            {`  ·  last verified ${summary.latestVerified ? '✓' : '✗'}`}
          </Text>
        )}
      </Text>
      {matches.map((m, i) => (
        <View key={m.id || i} style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle} numberOfLines={2}>
              {m.title || 'Agent run proof'}
            </Text>
            <Text style={s.cardTime}>{timeSince(m.createdAt)}</Text>
          </View>
          {m.agentName ? <Text style={s.agentName}>{m.agentName}</Text> : null}
          <AgentRunProofDetail detail={m.detail} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#6f6f6f',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  card: {
    backgroundColor: '#12121c',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    color: '#e8e8e8',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  cardTime: {
    color: '#6f6f6f',
    fontSize: 11,
  },
  agentName: {
    color: '#8a8a9e',
    fontSize: 11,
    marginTop: 2,
  },
});
