/**
 * RoomCard — Card component for the room list view.
 *
 * Displays room name, description, status accent stripe, stat pills,
 * and relative last-activity time.
 */

import React, { useMemo } from 'react';
import {
  View, Text, Pressable, StyleSheet, Platform,
} from 'react-native';
import type { RoomSummary } from './roomTypes';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  room: RoomSummary;
  onPress: () => void;
  accentColor: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const STATUS_COLORS: Record<string, string> = {
  active:   '#22c55e',
  paused:   '#f59e0b',
  archived: '#606075',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'no activity';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ─── Stat Pill ──────────────────────────────────────────────────────────────

function StatPill({ icon, value, color }: { icon: string; value: number; color: string }) {
  return (
    <View style={[styles.statPill, { borderColor: color + '30' }]}>
      <Text style={[styles.statIcon, { color }]}>{icon}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

function RoomCard({ room, onPress, accentColor }: Props) {
  const stripeColor = STATUS_COLORS[room.status] || accentColor;
  const lastActivity = useMemo(() => timeAgo(room.lastActivityAt), [room.lastActivityAt]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open room ${room.name}`}
      style={({ hovered }: any) => [
        styles.card,
        hovered && Platform.OS === 'web' && styles.cardHover,
      ]}
      nativeID={`room-card-${room.id}`}
    >
      {/* ── Left accent stripe ── */}
      <View style={[styles.stripe, { backgroundColor: stripeColor }]} />

      {/* ── Content ── */}
      <View style={styles.content}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{room.name}</Text>
          <Text style={styles.time}>{lastActivity}</Text>
        </View>

        {/* Description */}
        {room.description ? (
          <Text style={styles.description} numberOfLines={1}>
            {room.description}
          </Text>
        ) : null}

        {/* ── Stats row ── */}
        <View style={styles.statsRow}>
          <StatPill icon="[]" value={room.fileCount} color="#6366f1" />
          <StatPill icon="//" value={room.taskCount} color="#f59e0b" />
          <StatPill icon=">#" value={room.messageCount} color="#22d3ee" />
          <StatPill icon="@" value={room.activeAgentCount} color="#22c55e" />
        </View>
      </View>
    </Pressable>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    overflow: 'hidden',
    minWidth: 260,
    maxWidth: 440,
    flex: 1,
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: '4px 4px 0px #050508',
    } as any : {}),
  },
  cardHover: {
    borderColor: '#2a2a3e',
    backgroundColor: '#0f0f18',
  },
  stripe: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    color: '#f0f0f5',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: MONO,
    flex: 1,
    letterSpacing: 0.5,
  },
  time: {
    color: '#606075',
    fontSize: 10,
    fontFamily: MONO,
    flexShrink: 0,
  },
  description: {
    color: '#606075',
    fontSize: 11,
    fontFamily: MONO,
    lineHeight: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: '#050508',
  },
  statIcon: {
    fontSize: 9,
    fontWeight: '900',
    fontFamily: MONO,
  },
  statValue: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
  },
});

export default RoomCard;
