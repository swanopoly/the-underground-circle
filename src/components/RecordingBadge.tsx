/**
 * RecordingBadge — visible indicator that `/record start <name>` is
 * capturing tool calls right now. Polls `getActiveSession()` every 2s
 * (localStorage read — trivial) so it picks up starts/stops from any
 * tab. Renders nothing when no session is active, so it's safe to
 * mount globally near the composer.
 *
 * Styling matches the chat's rounded-dark palette: amber accent (same
 * as the HITL approval banner) to signal "active capture", small
 * enough to not compete with the composer, clickable to show status
 * in a toast-style tooltip.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { getActiveSession, type ActiveSession } from '../lib/chatRecording';

const POLL_MS = 2_000;

export default function RecordingBadge(): React.ReactElement | null {
  const [session, setSession] = useState<ActiveSession | null>(() => getActiveSession());

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      const next = getActiveSession();
      // Referential-identity changes would rerender unnecessarily;
      // only set when id/step count changed.
      setSession((prev) => {
        if (!prev && !next) return prev;
        if (!prev || !next) return next;
        if (prev.name === next.name && prev.steps.length === next.steps.length) return prev;
        return next;
      });
    };
    const id = setInterval(refresh, POLL_MS);
    // Also listen for storage events (cross-tab); localStorage on web
    // emits `storage` when another tab writes.
    const onStorage = () => refresh();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', onStorage);
    }
    return () => {
      cancelled = true;
      clearInterval(id);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', onStorage);
      }
    };
  }, []);

  const [showDetail, setShowDetail] = useState(false);
  const toggle = useCallback(() => setShowDetail((v) => !v), []);

  if (!session) return null;

  const elapsedSec = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
  const elapsedLabel = formatElapsed(elapsedSec);
  const stepCount = session.steps.length;

  return (
    <Pressable onPress={toggle} style={({ pressed }) => [styles.container, pressed && { opacity: 0.85 }]} nativeID="recording-badge">
      <View style={styles.dot} />
      <Text style={styles.label}>REC</Text>
      <Text style={styles.name} numberOfLines={1}>{session.name}</Text>
      <Text style={styles.meta}>{stepCount} · {elapsedLabel}</Text>
      {showDetail ? (
        <View style={styles.detail}>
          <Text style={styles.detailTitle}>Recording active</Text>
          <Text style={styles.detailBody}>
            {`"${session.name}" — ${stepCount} step${stepCount === 1 ? '' : 's'} captured · ${elapsedLabel}`}
          </Text>
          <Text style={styles.detailHint}>
            `/record stop` to save · `/record abort` to discard
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#92400e',
    backgroundColor: '#422006aa',
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    marginBottom: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  label: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  name: {
    color: '#fde68a',
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 180,
  },
  meta: {
    color: '#a16207',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  detail: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    padding: 8,
    minWidth: 240,
    maxWidth: 320,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#92400e',
    backgroundColor: '#0f172af2',
    gap: 4,
    zIndex: 100,
  },
  detailTitle: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailBody: {
    color: '#e2e8f0',
    fontSize: 11,
    lineHeight: 15,
  },
  detailHint: {
    color: '#94a3b8',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
