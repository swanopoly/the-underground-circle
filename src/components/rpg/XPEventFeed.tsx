/**
 * XPEventFeed — Compact live feed of recent XP events
 *
 * Shown in the Office dashboard. Loads from progression_events table,
 * subscribes to realtime inserts. Color-coded: bond=green, mastery=purple.
 * Each row ~32px, monospace text, max 20 events.
 */

import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing, Platform, Pressable, AccessibilityInfo,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { eventKindToLabel } from '../../lib/rpgEvents';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from '../../lib/connectionManager';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

function useReducedMotionPreference(): boolean {
  // Start static until the preference read resolves so a reduce-motion user
  // never sees a one-frame entrance animation during mount.
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        if (mounted) setReduceMotion(true);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

interface Props {
  circleId: string;
  userId: string;
  limit?: number;
  agentIds?: string[];
  identityAuthority: OfficeConnectionExactAuthority;
  isIdentityAuthorityCurrent: OfficeConnectionAuthorityFence;
}

interface FeedEvent {
  id: string;
  circle_id?: string;
  user_id?: string;
  agent_id: string;
  event_kind: string;
  xp_type: 'bond' | 'mastery';
  effective_amount: number;
  created_at: string;
}

function isMissingProgressionTable(error: any): boolean {
  if (!error) return false;
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST205'
    || error?.status === 404
    || message.includes("'public.progression_events'")
    || message.includes('progression_events');
}

// ─── Animated Row ───────────────────────────────────────────────────────────

function FeedRow({ event, isNew, reduceMotion }: { event: FeedEvent; isNew: boolean; reduceMotion: boolean }) {
  const slideY = useRef(new Animated.Value(isNew && !reduceMotion ? -20 : 0)).current;
  const rowOpacity = useRef(new Animated.Value(isNew && !reduceMotion ? 0 : 1)).current;

  useEffect(() => {
    slideY.stopAnimation();
    rowOpacity.stopAnimation();
    if (!isNew || reduceMotion) {
      slideY.setValue(0);
      rowOpacity.setValue(1);
      return;
    }
    slideY.setValue(-20);
    rowOpacity.setValue(0);
    const entranceAnimation = Animated.parallel([
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
    ]);
    entranceAnimation.start();
    return () => entranceAnimation.stop();
  }, [isNew, reduceMotion, rowOpacity, slideY]);

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

export default function XPEventFeed({
  circleId,
  userId,
  limit = 20,
  agentIds,
  identityAuthority,
  isIdentityAuthorityCurrent,
}: Props) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const reduceMotion = useReducedMotionPreference();
  const agentIdKey = (agentIds || []).map(value => String(value || '').trim()).filter(Boolean).sort().join('\u0000');
  const exactAgentIds = useMemo(
    () => Array.from(new Set(agentIdKey.split('\u0000').filter(Boolean))),
    [agentIdKey],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      setEvents([]);
      setLoadState('loading');
      if (
        identityAuthority.userId !== userId
        || identityAuthority.circleId !== circleId
        || !isIdentityAuthorityCurrent(identityAuthority)
      ) {
        if (!cancelled) setLoadState('error');
        return;
      }
      let query = supabase
        .from('progression_events')
        .select('id, circle_id, user_id, agent_id, event_kind, xp_type, effective_amount, created_at')
        .eq('circle_id', circleId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (exactAgentIds.length === 1) query = query.eq('agent_id', exactAgentIds[0]);
      else if (exactAgentIds.length > 1) query = query.in('agent_id', exactAgentIds);
      const { data, error } = await query
        .limit(limit)
        .setHeader('Authorization', `Bearer ${identityAuthority.accessToken}`);

      if (cancelled || !isIdentityAuthorityCurrent(identityAuthority)) return;

      if (isMissingProgressionTable(error)) {
        setLoadState('error');
        return;
      }

      if (error || !Array.isArray(data)) {
        setLoadState('error');
        return;
      }
      if (data.some(row => (
        String(row?.user_id || '') !== userId
        || String(row?.circle_id || '') !== circleId
        || (exactAgentIds.length > 0 && !exactAgentIds.includes(String(row?.agent_id || '')))
      ))) {
        setLoadState('error');
        return;
      }
      if (!cancelled) {
        setEvents(data as FeedEvent[]);
        setLoadState('ready');
      }
    }

    loadEvents();
    return () => { cancelled = true; };
  }, [agentIdKey, circleId, identityAuthority, isIdentityAuthorityCurrent, limit, reloadGeneration, userId]);

  // Realtime subscription
  useEffect(() => {
    if (!isIdentityAuthorityCurrent(identityAuthority)) return;
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
          if (!isIdentityAuthorityCurrent(identityAuthority)) return;
          if (newEvent.user_id !== userId) return;
          if (exactAgentIds.length > 0 && !exactAgentIds.includes(newEvent.agent_id)) return;

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
  }, [agentIdKey, circleId, exactAgentIds, identityAuthority, isIdentityAuthorityCurrent, userId, limit]);

  return (
    <View style={styles.container} nativeID="section-xp-event-feed">
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerDot} />
        <Text style={styles.headerText}>XP FEED</Text>
        <Text style={styles.headerCount}>{events.length}</Text>
      </View>

      {/* Events list */}
      {loadState === 'loading' ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Loading XP events…</Text>
        </View>
      ) : loadState === 'error' ? (
        <View accessibilityRole="alert" style={[styles.empty, { gap: 8 }]}>
          <Text style={[styles.emptyText, { color: '#fca5a5' }]}>XP events could not be loaded</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading XP events"
            onPress={() => setReloadGeneration(value => value + 1)}
            style={{ minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444466', justifyContent: 'center' }}
          >
            <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '700' }}>TRY AGAIN</Text>
          </Pressable>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No XP events yet</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          accessibilityLabel="Recent XP events"
        >
          {events.map(event => (
            <FeedRow
              key={event.id}
              event={event}
              isNew={newIds.has(event.id)}
              reduceMotion={reduceMotion}
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
