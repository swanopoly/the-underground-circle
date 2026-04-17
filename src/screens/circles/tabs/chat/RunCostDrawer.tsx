/**
 * RunCostDrawer — Phase C6. Expandable inline drawer under an assistant
 * message showing tokens, cost, latency, and cache-hit stats for that
 * turn. Reads from `user_ai_usage` by timestamp window.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../../lib/supabase';

interface UsageRow {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  estimated_cost: number;
  source: string;
  created_at: string;
}

interface Props {
  userId: string;
  messageTimestamp: string;
  nextMessageTimestamp?: string;
}

let userAiUsageMissing = false;
let userAiUsageAvailabilityChecked = false;
let userAiUsageAvailabilityPromise: Promise<boolean> | null = null;

function isMissingRelationError(error: any, relation: string): boolean {
  if (!error) return false;
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST205'
    || error?.status === 404
    || message.includes(`'public.${relation.toLowerCase()}'`)
    || message.includes(relation.toLowerCase());
}

function formatCost(cost: number): string {
  if (cost < 0.001) return '<$0.001';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

async function ensureUserAiUsageAvailable(): Promise<boolean> {
  if (userAiUsageMissing) return false;
  if (userAiUsageAvailabilityChecked) return true;
  if (userAiUsageAvailabilityPromise) return userAiUsageAvailabilityPromise;

  userAiUsageAvailabilityPromise = (async () => {
    try {
      const { error } = await supabase
        .from('user_ai_usage')
        .select('created_at')
        .limit(1);
      if (error) {
        if (isMissingRelationError(error, 'user_ai_usage')) {
          userAiUsageMissing = true;
          return false;
        }
        return true;
      }
      userAiUsageAvailabilityChecked = true;
      return true;
    } catch {
      return true;
    } finally {
      userAiUsageAvailabilityPromise = null;
    }
  })();

  return userAiUsageAvailabilityPromise;
}

export default function RunCostDrawer({ userId, messageTimestamp, nextMessageTimestamp }: Props) {
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !messageTimestamp || userAiUsageMissing) return;
    try {
      const available = await ensureUserAiUsageAvailable();
      if (!available) return;
      const startMs = new Date(messageTimestamp).getTime();
      if (!Number.isFinite(startMs)) return;
      const rawEndMs = nextMessageTimestamp ? new Date(nextMessageTimestamp).getTime() : startMs + 30_000;
      const endMs = Number.isFinite(rawEndMs) ? Math.max(startMs, rawEndMs) : startMs + 30_000;
      const before = new Date(endMs).toISOString();
      const { data, error } = await supabase
        .from('user_ai_usage')
        .select('model, provider, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, estimated_cost, source, created_at')
        .eq('user_id', userId)
        .gte('created_at', messageTimestamp)
        .lte('created_at', before)
        .order('created_at', { ascending: true })
        .limit(10);
      if (error) {
        if (isMissingRelationError(error, 'user_ai_usage')) {
          userAiUsageMissing = true;
          return;
        }
        return;
      }
      if (!error && data && data.length > 0) {
        setUsage(data as UsageRow[]);
      }
    } catch { /* table may not exist */ }
  }, [userId, messageTimestamp, nextMessageTimestamp]);

  useEffect(() => { void load(); }, [load]);

  if (!usage || usage.length === 0) return null;

  const totalCost = usage.reduce((s, r) => s + (r.estimated_cost || 0), 0);
  const totalInput = usage.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOutput = usage.reduce((s, r) => s + (r.output_tokens || 0), 0);
  const totalCache = usage.reduce((s, r) => s + (r.cache_read_tokens || 0), 0);
  const primaryModel = usage[0]?.model || '';

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setExpanded(v => !v)} style={styles.pill}>
        <Text style={styles.pillText}>
          {formatCost(totalCost)} · {formatTokens(totalInput + totalOutput)} tok · {primaryModel.split('-').slice(-2).join('-')}
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.drawer}>
          {usage.map((row, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.rowModel}>{row.model}</Text>
              <View style={styles.rowStats}>
                <Text style={styles.stat}>IN {formatTokens(row.input_tokens)}</Text>
                <Text style={styles.stat}>OUT {formatTokens(row.output_tokens)}</Text>
                {row.cache_read_tokens > 0 && (
                  <Text style={[styles.stat, { color: '#22c55e' }]}>CACHE {formatTokens(row.cache_read_tokens)}</Text>
                )}
                <Text style={styles.statCost}>{formatCost(row.estimated_cost)}</Text>
              </View>
              <Text style={styles.rowSource}>{row.source} · {row.provider}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>
              {formatTokens(totalInput)} in · {formatTokens(totalOutput)} out
              {totalCache > 0 ? ` · ${formatTokens(totalCache)} cached` : ''}
              {' · '}{formatCost(totalCost)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 2 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  pillText: { fontSize: 9, fontWeight: '700', color: '#475569', fontFamily: 'monospace' },
  drawer: { marginTop: 4, gap: 4, paddingLeft: 4 },
  row: {
    padding: 6, borderRadius: 4, borderWidth: 1, borderColor: '#152032',
    backgroundColor: '#0a0f17', gap: 2,
  },
  rowModel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', fontFamily: 'monospace' },
  rowStats: { flexDirection: 'row', gap: 10 },
  stat: { fontSize: 9, fontWeight: '700', color: '#64748b', fontFamily: 'monospace' },
  statCost: { fontSize: 9, fontWeight: '900', color: '#f59e0b', fontFamily: 'monospace' },
  rowSource: { fontSize: 8, color: '#475569', fontFamily: 'monospace' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 4, borderTopWidth: 1, borderTopColor: '#1e293b',
  },
  totalLabel: { fontSize: 9, fontWeight: '900', color: '#94a3b8', fontFamily: 'monospace', letterSpacing: 1 },
  totalValue: { fontSize: 9, fontWeight: '700', color: '#cbd5e1', fontFamily: 'monospace' },
});
