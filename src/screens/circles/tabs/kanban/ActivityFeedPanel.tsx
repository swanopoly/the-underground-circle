/**
 * ActivityFeedPanel — live agent activity feed for the HQ Dashboard
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';

interface Props {
  circleId: string;
  agents: CircleOfficeAgent[];
}

interface ActivityItem {
  id: string;
  agent_name: string;
  activity_type: string;
  title: string | null;
  body: string | null;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ActivityFeedPanel({ circleId, agents }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchActivity = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('agent_activity')
        .select('id, agent_name, activity_type, title, body, created_at')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(60);

      if (!error && data) {
        setItems(data);
      }
    } catch (err) {
      console.error('ActivityFeed fetch error:', err);
    }
  }, [circleId]);

  useEffect(() => {
    fetchActivity();

    // Realtime subscription
    const channel = supabase
      .channel(`activity-feed-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'agent_activity',
        filter: `circle_id=eq.${circleId}`,
      }, () => fetchActivity())
      .subscribe();

    // Fallback poll every 30s
    pollRef.current = setInterval(fetchActivity, 30000);

    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [circleId, fetchActivity]);

  const getAgentColor = (name: string): string => {
    const agent = agents.find(a => a.name === name);
    return agent?.color || '#6366f1';
  };

  const getAgentIcon = (name: string): string => {
    const agent = agents.find(a => a.name === name);
    return agent?.toolIcon || '>>';
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerBolt}>&#x26A1;</Text>
          <Text style={s.headerTitle}>ACTIVITY</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{items.length}</Text>
          </View>
        </View>
      </View>

      {/* Feed */}
      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
        {items.map(item => {
          const color = getAgentColor(item.agent_name);
          const icon = getAgentIcon(item.agent_name);
          const isExpanded = expanded[item.id];
          const detail = item.body || item.title;
          const hasLongDetail = (detail?.length || 0) > 80;

          return (
            <View key={item.id} style={s.item}>
              <View style={s.itemRow}>
                <View style={[s.iconCircle, { backgroundColor: color + '20' }]}>
                  <Text style={[s.iconText, { color }]}>{icon}</Text>
                </View>
                <View style={s.itemContent}>
                  <View style={s.itemNameRow}>
                    <Text style={s.itemAgent}>{item.agent_name}</Text>
                    <View style={s.readDot} />
                  </View>
                  <Text style={s.itemAction}>{item.title || item.activity_type}</Text>
                  {item.body && (
                    <Text
                      style={s.itemDetail}
                      numberOfLines={isExpanded ? undefined : 2}
                    >
                      {item.body}
                    </Text>
                  )}
                  {hasLongDetail && !isExpanded && (
                    <Text
                      style={s.moreLink}
                      onPress={() => setExpanded(p => ({ ...p, [item.id]: true }))}
                    >
                      more...
                    </Text>
                  )}
                  <Text style={s.timestamp}>{timeAgo(item.created_at)}</Text>
                </View>
              </View>
            </View>
          );
        })}

        {items.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>&#x26A1;</Text>
            <Text style={s.emptyText}>No activity yet</Text>
            <Text style={s.emptySubtext}>Agent actions will appear here</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    width: 260,
    backgroundColor: '#0d0d16',
    borderRightWidth: 1,
    borderRightColor: '#15151e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBolt: {
    fontSize: 13,
  },
  headerTitle: {
    color: '#9090a8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  countBadge: {
    backgroundColor: '#1a1a28',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 8,
    gap: 2,
  },
  item: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#15151e08',
  },
  itemRow: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemAgent: {
    color: '#e4e4ed',
    fontSize: 12,
    fontWeight: '700',
  },
  readDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#333348',
  },
  itemAction: {
    color: '#9090a8',
    fontSize: 11,
    lineHeight: 15,
  },
  itemDetail: {
    color: '#6b6b80',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  moreLink: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  timestamp: {
    color: '#444455',
    fontSize: 10,
    marginTop: 3,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 6,
  },
  emptyIcon: {
    fontSize: 20,
    opacity: 0.3,
  },
  emptyText: {
    color: '#333348',
    fontSize: 12,
    fontWeight: '500',
  },
  emptySubtext: {
    color: '#2a2a3e',
    fontSize: 11,
  },
});
