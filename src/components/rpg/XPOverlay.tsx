/**
 * XPOverlay — App-wide overlay that listens for XP events and renders XPPopup instances
 *
 * Self-contained: uses the rpgEvents event bus. Renders as fixed overlay
 * at top-right of screen. Queues popups, stacked vertically.
 * Maximum 3 visible at once (older ones slide out).
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useXPEvents, XPEvent } from '../../lib/rpgEvents';
import { eventKindToLabel } from '../../lib/rpgEvents';
import XPPopup from './XPPopup';

const MAX_VISIBLE = 3;

export default function XPOverlay() {
  const { events, dismissEvent } = useXPEvents();

  // Only show the most recent MAX_VISIBLE events
  const visibleEvents = events.slice(0, MAX_VISIBLE);

  if (visibleEvents.length === 0) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none" nativeID="section-xp-overlay">
      <View style={styles.stack} pointerEvents="box-none">
        {visibleEvents.map((event) => (
          <XPPopup
            key={event.id}
            xpAmount={event.xpAmount}
            source={eventKindToLabel(event.source)}
            agentName={event.agentName}
            levelUp={event.levelUp}
            newLevel={event.newLevel}
            newTitle={event.newTitle}
            onDismiss={() => dismissEvent(event.id)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9000,
    // Don't block touches on the rest of the app
    ...(Platform.OS === 'web' ? { pointerEvents: 'none' } as any : {}),
  },
  stack: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 60,
    right: 16,
    alignItems: 'flex-end',
    gap: 0,
  },
});
