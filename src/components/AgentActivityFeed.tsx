import React, { useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useAgentActivity, AgentActivity, ActivitySource } from '../services/agentActivityLogger';

interface Props {
  circleId: string | null;
  maxHeight?: number;
}

const SOURCE_ICONS: Record<ActivitySource, string> = {
  discord: '🎮',
  webchat: '💻',
  cron: '⏰',
  system: '⚙️',
};

const SOURCE_LABELS: Record<ActivitySource, string> = {
  discord: 'Discord',
  webchat: 'Web',
  cron: 'Cron',
  system: 'System',
};

const STATUS_COLORS: Record<string, string> = {
  running: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ActivityCard({ item }: { item: AgentActivity }) {
  const statusColor = STATUS_COLORS[item.status] ?? '#6B7280';
  const sourceIcon = SOURCE_ICONS[item.source] ?? '📡';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.sourceRow}>
          <Text style={styles.sourceIcon}>{sourceIcon}</Text>
          <Text style={styles.sourceLabel}>
            {SOURCE_LABELS[item.source]}
            {item.source_detail ? ` · ${item.source_detail}` : ''}
          </Text>
        </View>
        <View style={styles.rightMeta}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.timestamp}>{timeAgo(item.created_at)}</Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      {!!item.body && (
        <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
      )}
    </View>
  );
}

export default function AgentActivityFeed({ circleId, maxHeight = 400 }: Props) {
  const { activities, isLoading, refresh } = useAgentActivity(circleId);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#00FF9C" size="small" />
      </View>
    );
  }

  if (activities.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyIcon}>🦢</Text>
        <Text style={styles.emptyText}>SwanBot is standing by...</Text>
        <Pressable onPress={refresh} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={activities}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ActivityCard item={item} />}
      style={[styles.list, { maxHeight }]}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      onRefresh={refresh}
      refreshing={isLoading}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    width: '100%',
  },
  listContent: {
    gap: 6,
    paddingBottom: 8,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
    gap: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sourceIcon: {
    fontSize: 12,
  },
  sourceLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontFamily: 'monospace',
  },
  rightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  timestamp: {
    fontSize: 10,
    color: '#4B5563',
    fontFamily: 'monospace',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  body: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 17,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  emptyIcon: {
    fontSize: 28,
  },
  emptyText: {
    fontSize: 13,
    color: '#6B7280',
    fontFamily: 'monospace',
  },
  refreshBtn: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#1F2937',
    borderRadius: 6,
  },
  refreshText: {
    fontSize: 12,
    color: '#00FF9C',
  },
});
