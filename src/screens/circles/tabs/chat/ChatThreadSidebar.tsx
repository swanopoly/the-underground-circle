/**
 * ChatThreadSidebar
 *
 * Collapsible left rail listing the circle's chat threads:
 *   - "Circle Chat" pinned at top (default circle-wide thread)
 *   - User's own private + shared threads grouped by recency
 *   - "+ New chat" button creates a private thread for the current user
 *
 * Visual: pure black + white. The Circle Chat icon is an animated rotating
 * ring of colored dots (the only chromatic accent allowed in this rail).
 *
 * Collapse state persists in localStorage. Collapsed = icon-only strip.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  type CircleChatThread,
  deleteThread,
  groupThreadsByDate,
  useThreads,
} from '../../../../lib/circleChatThreads';

const STORAGE_KEY = 'uc_chat_thread_sidebar_collapsed_v1';

interface Props {
  circleId: string;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onDeleteThread?: (threadId: string) => void;
  refreshToken?: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function getInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

export function persistSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
}

// ─── Animated rainbow-dot ring ───────────────────────────────────────────────
// On web we use a CSS keyframe (Animated.loop is patched to no-op for safety).
// On native we drive an Animated rotation. Six dots positioned on the ring;
// each dot pulses opacity slightly out-of-phase so the whole thing breathes.

const DOT_COLORS = ['#22d3ee', '#facc15', '#22c55e', '#ef4444', '#a855f7', '#f97316'];
const RING_SIZE = 22;
const RING_RADIUS = 8;
const DOT_SIZE = 4;

function ensureSpinKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('uc-circle-chat-spin-style')) return;
  const el = document.createElement('style');
  el.id = 'uc-circle-chat-spin-style';
  el.textContent = `
@keyframes uc-circle-chat-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes uc-circle-chat-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
.uc-circle-chat-ring { animation: uc-circle-chat-spin 6s linear infinite; will-change: transform; }
.uc-circle-chat-dot  { animation: uc-circle-chat-pulse 1.6s ease-in-out infinite; }
`;
  document.head.appendChild(el);
}

function AnimatedCircleAvatar({ size = RING_SIZE }: { size?: number }) {
  const radius = (size / 2) - 3;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS === 'web') {
      ensureSpinKeyframes();
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotateAnim]);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const dots = useMemo(() =>
    DOT_COLORS.map((color, i) => {
      const angle = (i / DOT_COLORS.length) * 2 * Math.PI;
      const x = (size / 2) + Math.cos(angle) * radius - DOT_SIZE / 2;
      const y = (size / 2) + Math.sin(angle) * radius - DOT_SIZE / 2;
      return { color, x, y, delay: (i * 0.25).toFixed(2) };
    }), [radius, size]);

  const containerStyle = {
    width: size,
    height: size,
    position: 'relative' as const,
  };

  const Ring = (
    <View style={containerStyle}>
      {dots.map((d, i) => {
        const dotStyle = {
          position: 'absolute' as const,
          left: d.x,
          top: d.y,
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: d.color,
          shadowColor: d.color,
          shadowOpacity: 0.9,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 0 },
        };
        if (Platform.OS === 'web') {
          return (
            <View
              key={i}
              style={dotStyle}
              {...({ className: 'uc-circle-chat-dot', style: { ...dotStyle, animationDelay: `${d.delay}s` } } as any)}
            />
          );
        }
        return <View key={i} style={dotStyle} />;
      })}
    </View>
  );

  if (Platform.OS === 'web') {
    return (
      <View
        {...({ className: 'uc-circle-chat-ring', style: { width: size, height: size } } as any)}
      >
        {Ring}
      </View>
    );
  }
  return <Animated.View style={[containerStyle, { transform: [{ rotate: spin }] }]}>{Ring}</Animated.View>;
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export default function ChatThreadSidebar({
  circleId, activeThreadId, onSelectThread, onNewThread, onDeleteThread, refreshToken = 0, collapsed, onToggleCollapsed,
}: Props) {
  const { threads, loading } = useThreads(circleId, refreshToken);

  const circleThread = threads.find(t => t.visibility === 'circle') || null;
  const userThreads = useMemo(
    () => threads.filter(t => t.visibility !== 'circle'),
    [threads],
  );
  const groups = useMemo(() => groupThreadsByDate(userThreads), [userThreads]);

  if (collapsed) {
    return (
      <View style={styles.railCollapsed}>
        <Pressable onPress={onToggleCollapsed} style={styles.iconBtn}>
          <Text style={styles.iconText}>›</Text>
        </Pressable>
        <Pressable onPress={onNewThread} style={styles.iconBtn}>
          <Text style={styles.iconText}>+</Text>
        </Pressable>
        {circleThread && (
          <Pressable
            onPress={() => onSelectThread(circleThread.id)}
            style={[styles.iconBtn, activeThreadId === circleThread.id && styles.iconBtnActive]}
          >
            <AnimatedCircleAvatar size={18} />
          </Pressable>
        )}
        {userThreads.slice(0, 8).map(t => (
          <Pressable
            key={t.id}
            onPress={() => onSelectThread(t.id)}
            style={[styles.iconBtn, activeThreadId === t.id && styles.iconBtnActive]}
          >
            <Text style={styles.iconDot}>•</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.rail}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CHATS</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={onNewThread} style={styles.headerNewBtn}>
            <Text style={styles.headerNewBtnText}>+ NEW</Text>
          </Pressable>
          <Pressable onPress={onToggleCollapsed} style={styles.headerCollapseBtn}>
            <Text style={styles.headerCollapseBtnText}>‹</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {circleThread && (
          <View style={styles.section}>
            <ThreadRow
              thread={circleThread}
              isActive={activeThreadId === circleThread.id}
              onPress={() => onSelectThread(circleThread.id)}
              starred
            />
          </View>
        )}

        {loading && threads.length === 0 ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : groups.length === 0 ? (
          <Text style={styles.empty}>No personal chats yet. Start a new one to think alone or with a friend.</Text>
        ) : (
          groups.map(group => (
            <View key={group.label} style={styles.section}>
              <Text style={styles.sectionLabel}>{group.label}</Text>
              {group.items.map(t => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  isActive={activeThreadId === t.id}
                  onPress={() => onSelectThread(t.id)}
                  onDelete={() => onDeleteThread?.(t.id)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ThreadRow({
  thread, isActive, onPress, onDelete, starred,
}: {
  thread: CircleChatThread;
  isActive: boolean;
  onPress: () => void;
  onDelete?: () => void;
  starred?: boolean;
}) {
  const sessionFlavor = starred
    ? 'Circle stream'
    : thread.default_model && thread.default_model !== 'auto' && thread.default_model !== 'openswan'
      ? `OpenSwan · ${thread.default_model}`
      : 'OpenSwan private session';
  const subtitle = thread.last_message_preview || sessionFlavor;
  const visibilityBadge =
    thread.visibility === 'shared' ? 'SHARED'
    : thread.visibility === 'circle' ? 'CIRCLE'
    : 'PRIVATE';
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered }: any) => [
        styles.row,
        isActive && styles.rowActive,
        Platform.OS === 'web' && { transition: 'all 0.12s ease' },
        hovered && !isActive && { backgroundColor: '#0a0a0a' },
      ]}
    >
      <View style={styles.rowHeader}>
        {starred && (
          <View style={styles.rowAvatar}>
            <AnimatedCircleAvatar size={18} />
          </View>
        )}
        <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
          {thread.title}
        </Text>
        <Text style={[styles.rowBadge, isActive && styles.rowBadgeActive]}>{visibilityBadge}</Text>
        {onDelete && !starred && (
          <Pressable
            onPress={(e) => { e.stopPropagation(); onDelete(); }}
            style={({ hovered: h, pressed }: any) => [
              {
                width: 20, height: 20, borderRadius: 4,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: '#262626', backgroundColor: 'transparent',
                marginLeft: 2,
              },
              Platform.OS === 'web' && { transition: 'all 0.12s ease' },
              h && { backgroundColor: '#ef444420', borderColor: '#ef444450' },
              pressed && { transform: [{ scale: 0.9 }] },
            ]}
            hitSlop={4}
          >
            <Text style={{ color: '#737373', fontSize: 11, fontWeight: '900', lineHeight: 11 }}>x</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
    </Pressable>
  );
}

// ─── Styles — strict black + white, only the rotating ring is colored ───────

const styles = StyleSheet.create({
  rail: {
    width: 280,
    backgroundColor: '#000000',
    borderRightWidth: 1,
    borderRightColor: '#1a1a1a',
  },
  railCollapsed: {
    width: 48,
    backgroundColor: '#000000',
    borderRightWidth: 1,
    borderRightColor: '#1a1a1a',
    paddingTop: 12,
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#262626',
    backgroundColor: '#000000',
  },
  iconBtnActive: { borderColor: '#ffffff', backgroundColor: '#0a0a0a' },
  iconText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  iconDot: { color: '#737373', fontSize: 18 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    color: '#ffffff', fontSize: 11, fontWeight: '900',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  headerActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  headerNewBtn: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1, borderColor: '#ffffff',
    backgroundColor: '#000000',
  },
  headerNewBtnText: { color: '#ffffff', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  headerCollapseBtn: {
    width: 24, height: 24, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#262626', backgroundColor: '#000000',
  },
  headerCollapseBtnText: { color: '#a3a3a3', fontWeight: '900', fontSize: 14, lineHeight: 14 },

  scroll: { flex: 1 },
  scrollContent: { paddingVertical: 8, paddingHorizontal: 8, gap: 12 },

  section: { gap: 4 },
  sectionLabel: {
    color: '#525252', fontSize: 10, fontWeight: '900',
    letterSpacing: 1.2, paddingHorizontal: 6, paddingTop: 4,
  },

  row: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
    backgroundColor: 'transparent', gap: 2,
  },
  rowActive: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#ffffff' },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowAvatar: { width: 18, height: 18, marginRight: 4 },
  rowTitle: { color: '#d4d4d4', fontSize: 13, fontWeight: '700', flex: 1 },
  rowTitleActive: { color: '#ffffff' },
  rowSubtitle: { color: '#737373', fontSize: 11, lineHeight: 14 },
  rowBadge: {
    color: '#a3a3a3',
    fontSize: 9, fontWeight: '900', letterSpacing: 0.6,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 4, borderWidth: 1, borderColor: '#262626',
  },
  rowBadgeActive: { color: '#ffffff', borderColor: '#ffffff' },
  rowHover: { backgroundColor: '#0a0a0a' },
  trashBtn: {
    width: 20, height: 20, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#262626', backgroundColor: 'transparent',
    marginLeft: 2,
  },
  trashText: { color: '#737373', fontSize: 11, fontWeight: '900', lineHeight: 11 },

  empty: {
    color: '#525252', fontSize: 12, lineHeight: 16,
    paddingHorizontal: 12, paddingVertical: 16, textAlign: 'center',
  },
});
