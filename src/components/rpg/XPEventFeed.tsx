/**
 * XPEventFeed — Compact live feed of recent XP events
 *
 * Shown in the Office dashboard. Loads from progression_events table,
 * subscribes to realtime inserts. Color-coded: bond=green, mastery=purple.
 * Each row ~32px, monospace text, max 20 events.
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing, Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { eventKindToLabel } from '../../lib/rpgEvents';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

interface Props {
  circleId: string;
  userId: string;
  limit?: number;
}

interface FeedEvent {
  id: string;
  user_id?: string;
  agent_id: string;
  event_kind: string;
  xp_type: 'bond' | 'mastery';
  effective_amount: number;
  created_at: string;
}

let progressionFeedUnavailable = false;
function isMissingProgressionTable(error: any): boolean {
  if (!error) return false;
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST205'
    || error?.status === 404
    || message.includes("'public.progression_events'")
    || message.includes('progression_events');
}

// ─── Animated Row ───────────────────────────────────────────────────────────

function FeedRow({ event, isNew }: { event: FeedEvent; isNew: boolean }) {
  const slideY = useRef(new Animated.Value(isNew ? -20 : 0)).current;
  const rowOpacity = useRef(new Animated.Value(isNew ? 0 : 1)).current;

  useEffect(() => {
    if (isNew) {
      Animated.parallel([
        Animated.timing(slideY, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(rowOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, []);

  const isBond = event.xp_type === 'bond';
  const xpColor = isBond ? '#22c55e' : '#a855f7';
  const typeLabel = isBond ? 'B' : 'M';

  const ts = new Date(event.created_at);
  const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  // Extract agent short name from agent_id
  const agentShort = event.agent_id.includes('::')
    ? event.agent_id.split('::')[1]?.slice(0, 8) || '??'
    : event.agent_id.slice(0, 8);

  return (
    <Animated.View
      style={[
        rowStyles.row,
        {
          transform: [{ translateY: slideY }],
          opacity: rowOpacity,
        },
      ]}
    >
      {/* Timestamp */}
      <Text style={rowStyles.time}>{timeStr}</Text>

      {/* Type indicator */}
      <View style={[rowStyles.typeDot, { backgroundColor: xpColor + '30', borderColor: xpColor + '60' }]}>
        <Text style={[rowStyles.typeText, { color: xpColor }]}>{typeLabel}</Text>
      </View>

      {/* Agent icon */}
      <Text style={rowStyles.agent}>{agentShort}</Text>

      {/* XP amount */}
      <Text style={[rowStyles.xp, { color: xpColor }]}>
        +{event.effective_amount}
      </Text>

      {/* Source description */}
      <Text style={rowStyles.source} numberOfLines={1}>
        {eventKindToLabel(event.event_kind)}
      </Text>
    </Animated.View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderColor: '#111118',
  },
  time: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '600',
    color: '#3a3a4e',
    width: 36,
  },
  typeDot: {
    width: 16,
    height: 16,
    borderWidth: 1,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeText: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '900',
  },
  agent: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '700',
    color: '#6b6b80',
    width: 52,
  },
  xp: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '900',
    width: 36,
    textAlign: 'right',
  },
  source: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '600',
    color: '#6b6b80',
    flex: 1,
  },
});

// ─── Main Component ─────────────────────────────────────────────────────────

export default function XPEventFeed({ circleId, userId, limit = 20 }: Props) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      if (progressionFeedUnavailable) {
        if (!cancelled) setEvents([]);
        return;
      }
      const { data, error } = await supabase
        .from('progression_events')
        .select('id, agent_id, event_kind, xp_type, effective_amount, created_at')
        .eq('circle_id', circleId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (isMissingProgressionTable(error)) {
        progressionFeedUnavailable = true;
        if (!cancelled) setEvents([]);
        return;
      }

      if (!cancelled && data && !error) {
        setEvents(data as FeedEvent[]);
      }
    }

    loadEvents();
    return () => { cancelled = true; };
  }, [circleId, userId, limit]);

  // Realtime subscription
  useEffect(() => {
    if (progressionFeedUnavailable) return;
    const channel = supabase
      .channel(`xp-feed-${circleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'progression_events',
          filter: `circle_id=eq.${circleId}`,
        },
        (payload) => {
          const newEvent = payload.new as FeedEvent;
          if (newEvent.user_id !== userId) return;

          setNewIds(prev => new Set(prev).add(newEvent.id));
          setEvents(prev => {
            const next = [newEvent, ...prev];
            return next.slice(0, limit);
          });

          // Clear "new" state after animation
          setTimeout(() => {
            setNewIds(prev => {
              const next = new Set(prev);
              next.delete(newEvent.id);
              return next;
            });
          }, 500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, userId, limit]);

  return (
    <View style={styles.container} nativeID="section-xp-event-feed">
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerDot} />
        <Text style={styles.headerText}>XP FEED</Text>
        <Text style={styles.headerCount}>{events.length}</Text>
      </View>

      {/* Events list */}
      {events.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No XP events yet</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {events.map(event => (
            <FeedRow
              key={event.id}
              event={event}
              isNew={newIds.has(event.id)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    overflow: 'hidden',
    maxHeight: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderColor: '#1a1a2e',
    backgroundColor: '#0c0c14',
  },
  headerDot: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: '#fbbf24',
  },
  headerText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '900',
    color: '#6b6b80',
    letterSpacing: 2,
    flex: 1,
  },
  headerCount: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
    color: '#3a3a4e',
  },
  scroll: {
    flex: 1,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '600',
    color: '#2a2a3e',
    letterSpacing: 1,
  },
});
