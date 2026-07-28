/**
 * GitHubWallFeed.tsx — Compact live GitHub event feed for the Office wall
 *
 * Displays recent GitHub events (pushes, PRs, issues, CI, releases) as a
 * scrolling list. Subscribes to realtime INSERTs for live updates.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform, Animated,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { subscribeWithReconnect } from '../../lib/subscribeWithReconnect';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  accentColor: string;
  maxEvents?: number;
}

interface GitHubEvent {
  id: string;
  event_type: string;
  payload: any;
  created_at: string;
}

interface DisplayEvent {
  id: string;
  type: string;
  icon: string;
  color: string;
  author: string;
  title: string;
  time: string;
  rawTime: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { icon: string; color: string }> = {
  push:           { icon: '>', color: '#22c55e' },
  pull_request:   { icon: '<>', color: '#3b82f6' },
  pull_request_merged: { icon: '<>', color: '#a855f7' },
  issues:         { icon: '!', color: '#f59e0b' },
  issue_comment:  { icon: '!', color: '#f59e0b' },
  release:        { icon: 'R', color: '#22d3ee' },
  workflow_run:   { icon: 'CI', color: '#ef4444' },
  workflow_run_success: { icon: 'CI', color: '#22c55e' },
  create:         { icon: '+', color: '#22c55e' },
  delete:         { icon: '-', color: '#ef4444' },
};

const DEFAULT_EVENT_CONFIG = { icon: '*', color: '#6b7280' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function parseEvent(raw: GitHubEvent): DisplayEvent {
  const payload = raw.payload || {};
  let eventType = raw.event_type || 'unknown';

  // Refine type based on payload
  if (eventType === 'pull_request' && payload.action === 'closed' && payload.pull_request?.merged) {
    eventType = 'pull_request_merged';
  }
  if (eventType === 'workflow_run' && payload.workflow_run?.conclusion === 'success') {
    eventType = 'workflow_run_success';
  }

  const config = EVENT_CONFIG[eventType] || DEFAULT_EVENT_CONFIG;

  // Extract author
  const author = payload.sender?.login
    || payload.pusher?.name
    || payload.head_commit?.author?.username
    || 'unknown';

  // Extract title
  let title = '';
  if (eventType === 'push') {
    const commits = payload.commits || [];
    title = commits.length > 0
      ? commits[commits.length - 1]?.message?.split('\n')[0] || `${commits.length} commits`
      : 'push';
  } else if (eventType.startsWith('pull_request')) {
    title = payload.pull_request?.title || 'PR';
  } else if (eventType === 'issues' || eventType === 'issue_comment') {
    title = payload.issue?.title || 'Issue';
  } else if (eventType === 'release') {
    title = payload.release?.name || payload.release?.tag_name || 'Release';
  } else if (eventType.startsWith('workflow_run')) {
    title = payload.workflow_run?.name || 'CI';
  } else {
    title = payload.ref || payload.description || eventType;
  }

  // Truncate title
  if (title.length > 50) title = title.slice(0, 47) + '...';

  return {
    id: raw.id,
    type: eventType,
    icon: config.icon,
    color: config.color,
    author: author.length > 12 ? author.slice(0, 10) + '..' : author,
    title,
    time: relativeTime(raw.created_at),
    rawTime: new Date(raw.created_at).getTime(),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GitHubWallFeed({ circleId, accentColor, maxEvents = 15 }: Props) {
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const fadeAnims = useRef<Map<string, Animated.Value>>(new Map());

  // ─── Load events (initial + realtime catch-up) ────────────────────────────
  // Extracted so the resilient subscription can replay it after a reconnect:
  // inserts that landed while the socket was down never arrive as events, so
  // without this the wall silently misses whatever shipped during the gap.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('circle_github_events')
        .select('id, event_type, payload, created_at')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(maxEvents);

      if (mountedRef.current && data) {
        const parsed = data.map(parseEvent).reverse();
        setEvents(parsed);
        // Initialize fade anims
        parsed.forEach(e => {
          if (!fadeAnims.current.has(e.id)) {
            fadeAnims.current.set(e.id, new Animated.Value(1));
          }
        });
      }
    } catch {
      // Table may not exist
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [circleId, maxEvents]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  // ─── Subscribe to realtime inserts ────────────────────────────────────────
  useEffect(() => {
    const handle = subscribeWithReconnect({
      channelName: `github-events-${circleId}`,
      onCatchUp: () => { void loadEvents(); },
      setup: (channel) => channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'circle_github_events',
          filter: `circle_id=eq.${circleId}`,
        },
        (payload) => {
          const raw = payload.new as GitHubEvent;
          const parsed = parseEvent(raw);

          // Fade-in animation for new event
          const fadeIn = new Animated.Value(0);
          fadeAnims.current.set(parsed.id, fadeIn);
          Animated.timing(fadeIn, {
            toValue: 1,
            duration: 400,
            useNativeDriver: false,
          }).start();

          setEvents(prev => {
            const updated = [...prev, parsed];
            // Trim old events
            if (updated.length > maxEvents) {
              const removed = updated.splice(0, updated.length - maxEvents);
              removed.forEach(r => fadeAnims.current.delete(r.id));
            }
            return updated;
          });

          // Auto-scroll to bottom
          setTimeout(() => {
            scrollRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      ),
    });

    return () => {
      handle.unsubscribe();
    };
  }, [circleId, maxEvents, loadEvents]);

  // ─── Time ticker — update relative times every 30s ────────────────────────
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Recalculate relative times on tick
  const displayEvents = events.map(e => ({
    ...e,
    time: relativeTime(new Date(e.rawTime).toISOString()),
  }));

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View nativeID="section-github-wall-feed" style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.headerIcon, { color: accentColor }]}>{'{}'}</Text>
          <Text style={styles.headerText}>GITHUB FEED</Text>
        </View>
        <Text style={styles.loadingText}>Loading events...</Text>
      </View>
    );
  }

  return (
    <View nativeID="section-github-wall-feed" style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.headerIcon, { color: accentColor }]}>{'{}'}</Text>
        <Text style={styles.headerText}>GITHUB FEED</Text>
        <Text style={styles.eventCount}>{events.length}</Text>
      </View>

      {events.length === 0 ? (
        <Text style={styles.emptyText}>No events yet. Connect a GitHub repo to see activity.</Text>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {displayEvents.map((event, idx) => {
            const opacity = fadeAnims.current.get(event.id) || new Animated.Value(1);
            // Fade out older events (first few in the list)
            const ageFactor = Math.max(0.4, 1 - (displayEvents.length - 1 - idx) * 0.04);

            return (
              <Animated.View
                key={event.id}
                style={[styles.eventRow, { opacity: Animated.multiply(opacity, ageFactor) }]}
              >
                <View style={[styles.eventDot, { backgroundColor: event.color }]}>
                  <Text style={styles.eventIcon}>{event.icon}</Text>
                </View>
                <Text style={[styles.eventAuthor, { color: event.color }]} numberOfLines={1}>
                  {event.author}
                </Text>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {event.title}
                </Text>
                <Text style={styles.eventTime}>{event.time}</Text>
              </Animated.View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
    backgroundColor: '#050508',
  },
  headerIcon: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  headerText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: '#888',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  eventCount: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: '#555',
    backgroundColor: '#111118',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
  },
  loadingText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#555',
    padding: 12,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#444',
    padding: 12,
    textAlign: 'center',
  },
  scrollArea: {
    maxHeight: 200,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#0f0f15',
  },
  eventDot: {
    width: 20,
    height: 16,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eventIcon: {
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    color: '#050508',
  },
  eventAuthor: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    width: 80,
    flexShrink: 0,
  },
  eventTitle: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#999',
    flex: 1,
  },
  eventTime: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#555',
    fontWeight: '700',
    flexShrink: 0,
    minWidth: 24,
    textAlign: 'right',
  },
});
