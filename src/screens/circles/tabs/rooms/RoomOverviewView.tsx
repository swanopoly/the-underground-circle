/**
 * RoomOverviewView — Overview section showing room summary, stats, recent activity.
 *
 * Displays description card, 4-stat grid, recent activity feed,
 * and room health / integration status.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  roomId: string;
  circleId: string;
  accentColor: string;
}

interface RoomInfo {
  name: string;
  description: string | null;
  is_active: boolean;
}

interface RecentMessage {
  id: string;
  content: string;
  message_type: string;
  agent_name: string | null;
  created_at: string;
}

interface StatCard {
  label: string;
  icon: string;
  value: number;
  color: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Component ──────────────────────────────────────────────────────────────

function RoomOverviewView({ roomId, circleId, accentColor }: Props) {
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [agentCount, setAgentCount] = useState(0);
  const [recentMessages, setRecentMessages] = useState<RecentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasGitHub, setHasGitHub] = useState(false);

  // ── Fetch all data on mount ──
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const [roomRes, filesRes, tasksRes, msgsRes, agentsRes, activityRes, ghRes] =
        await Promise.all([
          supabase.from('project_rooms').select('name, description, is_active')
            .eq('id', roomId).single(),
          supabase.from('room_files').select('id', { count: 'exact', head: true })
            .eq('room_id', roomId).eq('is_deleted', false),
          supabase.from('room_tasks').select('id', { count: 'exact', head: true })
            .eq('room_id', roomId),
          supabase.from('room_messages').select('id', { count: 'exact', head: true })
            .eq('room_id', roomId),
          supabase.from('project_room_agents').select('id', { count: 'exact', head: true })
            .eq('room_id', roomId),
          supabase.from('room_messages')
            .select('id, content, message_type, agent_name, created_at')
            .eq('room_id', roomId)
            .order('created_at', { ascending: false })
            .limit(10),
          supabase.from('circle_github_connections')
            .select('id', { count: 'exact', head: true })
            .eq('circle_id', circleId),
        ]);

      if (cancelled) return;

      if (roomRes.data) setRoom(roomRes.data);
      setFileCount(filesRes.count ?? 0);
      setTaskCount(tasksRes.count ?? 0);
      setMessageCount(msgsRes.count ?? 0);
      setAgentCount(agentsRes.count ?? 0);
      setRecentMessages(activityRes.data ?? []);
      setHasGitHub((ghRes.count ?? 0) > 0);
      setLoading(false);
    }

    load().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [roomId, circleId]);

  // ── Stats grid data ──
  const stats: StatCard[] = useMemo(() => [
    { label: 'FILES',    icon: '[]', value: fileCount,    color: '#6366f1' },
    { label: 'TASKS',    icon: '//', value: taskCount,    color: '#f59e0b' },
    { label: 'MESSAGES', icon: '>#', value: messageCount, color: '#22d3ee' },
    { label: 'AGENTS',   icon: '@',  value: agentCount,   color: '#22c55e' },
  ], [fileCount, taskCount, messageCount, agentCount]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={accentColor} size="small" />
        <Text style={styles.loadingText}>Loading overview...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      nativeID="section-room-overview"
    >
      {/* ── SECTION: Description Card ── */}
      {room?.description ? (
        <View style={styles.descCard}>
          <Text style={styles.descLabel}>DESCRIPTION</Text>
          <Text style={styles.descText}>{room.description}</Text>
        </View>
      ) : null}

      {/* ── SECTION: Stats Grid ── */}
      <View style={styles.statsGrid} nativeID="section-room-overview-stats">
        {stats.map((stat) => (
          <View key={stat.label} style={styles.statCard}>
            <View style={[styles.statIconBox, { borderColor: stat.color + '40', backgroundColor: stat.color + '10' }]}>
              <Text style={[styles.statIcon, { color: stat.color }]}>{stat.icon}</Text>
            </View>
            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* ── SECTION: Recent Activity Feed ── */}
      <View style={styles.section} nativeID="section-room-overview-activity">
        <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
        {recentMessages.length === 0 ? (
          <Text style={styles.emptyText}>No activity yet</Text>
        ) : (
          recentMessages.map((msg) => {
            const isSystem = msg.message_type === 'system';
            const isAgent = msg.message_type === 'agent_output';
            const typeColor = isSystem ? '#606075' : isAgent ? '#22c55e' : '#a0a0b0';
            return (
              <View key={msg.id} style={styles.activityRow}>
                <View style={[styles.activityDot, { backgroundColor: typeColor }]} />
                <View style={styles.activityContent}>
                  <View style={styles.activityMeta}>
                    {msg.agent_name ? (
                      <Text style={[styles.activityAgent, { color: '#22c55e' }]}>
                        {msg.agent_name}
                      </Text>
                    ) : (
                      <Text style={[styles.activityAgent, { color: '#a0a0b0' }]}>
                        user
                      </Text>
                    )}
                    <Text style={styles.activityType}>{msg.message_type}</Text>
                    <Text style={styles.activityTime}>{timeAgo(msg.created_at)}</Text>
                  </View>
                  <Text style={styles.activityText} numberOfLines={2}>
                    {msg.content}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* ── SECTION: Room Health ── */}
      <View style={styles.section} nativeID="section-room-overview-health">
        <Text style={styles.sectionTitle}>ROOM HEALTH</Text>
        <View style={styles.healthGrid}>
          {/* GitHub integration status */}
          <View style={styles.healthItem}>
            <View style={[
              styles.healthDot,
              { backgroundColor: hasGitHub ? '#22c55e' : '#606075' },
            ]} />
            <Text style={styles.healthLabel}>GitHub</Text>
            <Text style={[
              styles.healthStatus,
              { color: hasGitHub ? '#22c55e' : '#606075' },
            ]}>
              {hasGitHub ? 'CONNECTED' : 'NOT CONNECTED'}
            </Text>
          </View>

          {/* Room status */}
          <View style={styles.healthItem}>
            <View style={[
              styles.healthDot,
              { backgroundColor: room?.is_active ? '#22c55e' : '#f59e0b' },
            ]} />
            <Text style={styles.healthLabel}>Status</Text>
            <Text style={[
              styles.healthStatus,
              { color: room?.is_active ? '#22c55e' : '#f59e0b' },
            ]}>
              {room?.is_active ? 'ACTIVE' : 'INACTIVE'}
            </Text>
          </View>

          {/* Agent coverage */}
          <View style={styles.healthItem}>
            <View style={[
              styles.healthDot,
              { backgroundColor: agentCount > 0 ? '#22c55e' : '#606075' },
            ]} />
            <Text style={styles.healthLabel}>Agents</Text>
            <Text style={[
              styles.healthStatus,
              { color: agentCount > 0 ? '#22c55e' : '#606075' },
            ]}>
              {agentCount > 0 ? `${agentCount} ONLINE` : 'NONE'}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050508',
    gap: 8,
  },
  loadingText: {
    color: '#606075',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Description card
  descCard: {
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 14,
    gap: 6,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #050508' } as any : {}),
  },
  descLabel: {
    color: '#606075',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1,
  },
  descText: {
    color: '#a0a0b0',
    fontSize: 13,
    fontFamily: MONO,
    lineHeight: 20,
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: 80,
    alignItems: 'center',
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 14,
    gap: 6,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #050508' } as any : {}),
  },
  statIconBox: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 2,
  },
  statIcon: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: MONO,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    fontFamily: MONO,
  },
  statLabel: {
    color: '#606075',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 0.5,
  },

  // Section
  section: {
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 14,
    gap: 10,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #050508' } as any : {}),
  },
  sectionTitle: {
    color: '#606075',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1,
    marginBottom: 2,
  },
  emptyText: {
    color: '#606075',
    fontSize: 12,
    fontFamily: MONO,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },

  // Activity feed
  activityRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  activityContent: {
    flex: 1,
    gap: 3,
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activityAgent: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: MONO,
  },
  activityType: {
    color: '#606075',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as any,
  },
  activityTime: {
    color: '#606075',
    fontSize: 9,
    fontFamily: MONO,
  },
  activityText: {
    color: '#a0a0b0',
    fontSize: 12,
    fontFamily: MONO,
    lineHeight: 17,
  },

  // Health
  healthGrid: {
    gap: 8,
  },
  healthItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  healthLabel: {
    color: '#a0a0b0',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    flex: 1,
  },
  healthStatus: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 0.5,
  },
});

export default RoomOverviewView;
