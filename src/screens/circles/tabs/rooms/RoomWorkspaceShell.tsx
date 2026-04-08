/**
 * RoomWorkspaceShell — Main workspace shell rendered when a room is selected.
 *
 * Replaces the giant inline rendering from RoomsTab.
 * Composes RoomHeader, RoomSectionNav, and the active section view.
 */

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Platform,
} from 'react-native';
import { useRoom, useRoomSection } from './roomHooks';
import RoomHeader from './RoomHeader';
import RoomSectionNav from './RoomSectionNav';
import RoomOverviewView from './RoomOverviewView';
import RoomChatView from './RoomChatView';
import type { RoomSection } from './roomTypes';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  roomId: string;
  circleId: string;
  accentColor: string;
  onBack: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── Placeholder View ───────────────────────────────────────────────────────

function PlaceholderView({ section, accentColor }: { section: string; accentColor: string }) {
  return (
    <View style={styles.placeholder} nativeID={`section-room-${section}-placeholder`}>
      <View style={[styles.placeholderIcon, { borderColor: accentColor + '30' }]}>
        <Text style={[styles.placeholderIconText, { color: accentColor }]}>{'{ }'}</Text>
      </View>
      <Text style={styles.placeholderTitle}>
        {section.charAt(0).toUpperCase() + section.slice(1)}
      </Text>
      <Text style={styles.placeholderSub}>
        Coming soon
      </Text>
    </View>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

function RoomWorkspaceShell({ roomId, circleId, accentColor, onBack }: Props) {
  const { room } = useRoom(roomId);
  const { activeSection, setSection } = useRoomSection();

  // ── Build room header data ──
  const roomHeaderData = useMemo(() => {
    if (!room) return null;
    return {
      id: room.id,
      name: room.name,
      description: room.description ?? null,
      status: room.status,
    };
  }, [room]);

  // ── Render active section ──
  const renderSection = (): React.ReactNode => {
    switch (activeSection) {
      case 'overview':
        return (
          <RoomOverviewView
            roomId={roomId}
            circleId={circleId}
            accentColor={accentColor}
          />
        );

      case 'chat':
        return (
          <RoomChatView
            roomId={roomId}
            circleId={circleId}
            accentColor={accentColor}
          />
        );

      case 'files':
        return <PlaceholderView section="files" accentColor={accentColor} />;

      case 'runs':
        return <PlaceholderView section="runs" accentColor={accentColor} />;

      case 'tasks':
        return <PlaceholderView section="tasks" accentColor={accentColor} />;

      case 'integrations':
        return <PlaceholderView section="integrations" accentColor={accentColor} />;

      case 'settings':
        return <PlaceholderView section="settings" accentColor={accentColor} />;

      default:
        return <PlaceholderView section={activeSection} accentColor={accentColor} />;
    }
  };

  // ── Loading state when room data is still fetching ──
  if (!roomHeaderData) {
    return (
      <View style={styles.loading} nativeID="section-room-workspace-loading">
        <Text style={styles.loadingText}>Loading room...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} nativeID="section-room-workspace">
      {/* ── Room Header ── */}
      <RoomHeader
        room={roomHeaderData}
        onBack={onBack}
        accentColor={accentColor}
      />

      {/* ── Section Navigation ── */}
      <RoomSectionNav
        activeSection={activeSection}
        onSectionChange={setSection}
        accentColor={accentColor}
      />

      {/* ── Active Section View ── */}
      <View style={styles.sectionContent} nativeID="section-room-active-view">
        {renderSection()}
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
    flexDirection: 'column',
  },
  sectionContent: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050508',
  },
  loadingText: {
    color: '#606075',
    fontSize: 12,
    fontFamily: MONO,
  },

  // Placeholder
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#050508',
  },
  placeholderIcon: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 2,
    backgroundColor: '#0a0a10',
    marginBottom: 4,
  },
  placeholderIconText: {
    fontSize: 14,
    fontWeight: '900',
    fontFamily: MONO,
  },
  placeholderTitle: {
    color: '#a0a0b0',
    fontSize: 14,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  placeholderSub: {
    color: '#606075',
    fontSize: 12,
    fontFamily: MONO,
  },
});

export default RoomWorkspaceShell;
