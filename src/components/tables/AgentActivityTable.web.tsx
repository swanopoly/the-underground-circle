/**
 * AgentActivityTable — Concrete table showing agent activity for a circle.
 *
 * Uses DataTable + @tanstack/react-table under the hood.
 * Loads the last 100 rows from the `agent_activity` Supabase table,
 * sorted by timestamp descending.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { supabase } from '../../lib/supabase';
import { DataTable, type ColumnDef } from './DataTable.web';

interface AgentActivityRow {
  agent_name: string;
  title: string;
  body: string;
  created_at: string;
}

interface AgentActivityTableProps {
  circleId: string;
  accentColor: string;
}

const columns: ColumnDef<AgentActivityRow, any>[] = [
  {
    accessorKey: 'agent_name',
    header: 'Agent Name',
    size: 160,
  },
  {
    accessorKey: 'title',
    header: 'Title',
    size: 140,
  },
  {
    accessorKey: 'body',
    header: 'Detail',
    size: 320,
  },
  {
    accessorKey: 'created_at',
    header: 'Timestamp',
    size: 200,
    cell: (info) => {
      const raw = info.getValue() as string;
      if (!raw) return '-';
      const d = new Date(raw);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    },
    sortingFn: 'datetime',
  },
];

export default function AgentActivityTable({ circleId, accentColor }: AgentActivityTableProps) {
  // Web-only guard
  if (Platform.OS !== 'web') return null;

  const [data, setData] = useState<AgentActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchActivity() {
      setLoading(true);
      setError(null);

      const { data: rows, error: err } = await supabase
        .from('agent_activity')
        .select('agent_name, title, body, created_at')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (cancelled) return;

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      setData((rows as AgentActivityRow[]) || []);
      setLoading(false);
    }

    fetchActivity();
    return () => { cancelled = true; };
  }, [circleId]);

  if (loading) {
    return (
      <View style={styles.status}>
        <Text style={styles.statusText}>Loading agent activity...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.status}>
        <Text style={[styles.statusText, { color: '#f87171' }]}>Error: {error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} nativeID="section-agent-activity-table">
      <View style={styles.header}>
        <Text style={styles.headerText}>Agent Activity</Text>
        <Text style={styles.countText}>{data.length} events</Text>
      </View>
      <DataTable<AgentActivityRow>
        data={data}
        columns={columns}
        pageSize={20}
        searchable
        accentColor={accentColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#f0f0f5',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  countText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#666',
  },
  status: {
    padding: 24,
    alignItems: 'center',
  },
  statusText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#666',
  },
});
