/**
 * RoomHeader — Displays room name, status pill, description, and back button.
 *
 * Sits at the top of the workspace shell when a room is selected.
 */

import React from 'react';
import {
  View, Text, Pressable, StyleSheet, Platform,
} from 'react-native';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  room: {
    id: string;
    name: string;
    description?: string | null;
    status: string;
  };
  onBack: () => void;
  accentColor: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active:   { color: '#22c55e', label: 'ACTIVE' },
  paused:   { color: '#f59e0b', label: 'PAUSED' },
  archived: { color: '#606075', label: 'ARCHIVED' },
};

// ─── Component ──────────────────────────────────────────────────────────────

function RoomHeader({ room, onBack, accentColor }: Props) {
  const statusInfo = STATUS_CONFIG[room.status] || STATUS_CONFIG.active;

  return (
    <View style={styles.container} nativeID="section-room-header">
      {/* ── Back button ── */}
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back to room list"
        style={({ hovered }: any) => [
          styles.backBtn,
          hovered && Platform.OS === 'web' && styles.backBtnHover,
        ]}
      >
        <Text style={styles.backArrow}>{'<-'}</Text>
      </Pressable>

      {/* ── Room info ── */}
      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {room.name}
          </Text>

          {/* ── Status pill ── */}
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: statusInfo.color + '18',
                borderColor: statusInfo.color + '50',
              },
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: statusInfo.color }]}
            />
            <Text
              style={[styles.statusText, { color: statusInfo.color }]}
            >
              {statusInfo.label}
            </Text>
          </View>
        </View>

        {room.description ? (
          <Text style={styles.description} numberOfLines={1}>
            {room.description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0a0a10',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
    gap: 12,
  },
  backBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#0f0f18',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  backBtnHover: {
    backgroundColor: '#1a1a28',
    borderColor: '#3a3a4e',
  },
  backArrow: {
    color: '#a0a0b0',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    color: '#f0f0f5',
    fontSize: 16,
    fontWeight: '900',
    fontFamily: MONO,
    letterSpacing: 1,
    flexShrink: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1,
  },
  description: {
    color: '#606075',
    fontSize: 12,
    fontFamily: MONO,
    lineHeight: 16,
  },
});

export default RoomHeader;
