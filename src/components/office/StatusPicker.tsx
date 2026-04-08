/**
 * StatusPicker.tsx — Compact work status selector for the Office toolbar
 *
 * Shows 5 status pills in a horizontal row with optional note and timer presets.
 * Persists to profiles.user_status JSONB and broadcasts via Supabase Realtime.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, Platform, Animated,
} from 'react-native';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
  circleId: string;
  accentColor: string;
}

type StatusMode = 'available' | 'focusing' | 'in_meeting' | 'on_break' | 'away';

interface UserStatus {
  mode: StatusMode;
  note: string | null;
  expiresAt: string | null;
}

type TimerPreset = { label: string; minutes: number | null };

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { mode: StatusMode; label: string; color: string; icon: string }[] = [
  { mode: 'available',  label: 'Available',  color: '#22c55e', icon: 'O' },
  { mode: 'focusing',   label: 'Focusing',   color: '#f59e0b', icon: 'F' },
  { mode: 'in_meeting', label: 'Meeting',    color: '#ef4444', icon: 'M' },
  { mode: 'on_break',   label: 'Break',      color: '#3b82f6', icon: 'B' },
  { mode: 'away',       label: 'Away',       color: '#6b7280', icon: 'A' },
];

const TIMER_PRESETS: TimerPreset[] = [
  { label: '25m', minutes: 25 },
  { label: '1h',  minutes: 60 },
  { label: '2h',  minutes: 120 },
  { label: 'None', minutes: null },
];

const DEFAULT_STATUS: UserStatus = { mode: 'available', note: null, expiresAt: null };

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatusPicker({ userId, circleId, accentColor }: Props) {
  const [status, setStatus] = useState<UserStatus>(DEFAULT_STATUS);
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState('');
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ─── Load current status from profile ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('user_status')
          .eq('id', userId)
          .single();
        if (data?.user_status) {
          const s = data.user_status as UserStatus;
          setStatus(s);
          setNoteText(s.note || '');
          scheduleExpiry(s);
        }
      } catch {
        // Column may not exist yet — migration not run
      }
    })();
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, [userId]);

  // ─── Schedule auto-expire ─────────────────────────────────────────────────
  const scheduleExpiry = useCallback((s: UserStatus) => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    if (!s.expiresAt) return;
    const remaining = new Date(s.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      saveStatus({ ...DEFAULT_STATUS });
      return;
    }
    expiryTimerRef.current = setTimeout(() => {
      saveStatus({ ...DEFAULT_STATUS });
    }, Math.min(remaining, 2_147_483_647));
  }, []);

  // ─── Persist + broadcast ──────────────────────────────────────────────────
  const saveStatus = useCallback(async (newStatus: UserStatus) => {
    setStatus(newStatus);
    setNoteText(newStatus.note || '');
    scheduleExpiry(newStatus);

    try {
      await supabase
        .from('profiles')
        .update({ user_status: newStatus as any })
        .eq('id', userId);
    } catch {
      // Migration may not be run
    }

    // Broadcast to circle
    try {
      const channel = supabase.channel(`circle:${circleId}`);
      await channel.send({
        type: 'broadcast',
        event: 'status_update',
        payload: { userId, status: newStatus },
      });
      supabase.removeChannel(channel);
    } catch {
      // Best effort
    }
  }, [userId, circleId, scheduleExpiry]);

  // ─── Select status mode ───────────────────────────────────────────────────
  const handleSelectMode = useCallback((mode: StatusMode) => {
    const newStatus: UserStatus = {
      mode,
      note: noteText || null,
      expiresAt: status.expiresAt,
    };
    saveStatus(newStatus);

    // Pulse animation
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.85, duration: 80, useNativeDriver: false }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 120, useNativeDriver: false }),
    ]).start();
  }, [noteText, status.expiresAt, saveStatus, pulseAnim]);

  // ─── Set timer ────────────────────────────────────────────────────────────
  const handleSetTimer = useCallback((preset: TimerPreset) => {
    const expiresAt = preset.minutes
      ? new Date(Date.now() + preset.minutes * 60_000).toISOString()
      : null;
    saveStatus({ ...status, expiresAt });
  }, [status, saveStatus]);

  // ─── Save note on blur ────────────────────────────────────────────────────
  const handleNoteBlur = useCallback(() => {
    if (noteText !== (status.note || '')) {
      saveStatus({ ...status, note: noteText || null });
    }
  }, [noteText, status, saveStatus]);

  const currentOption = STATUS_OPTIONS.find(o => o.mode === status.mode) || STATUS_OPTIONS[0];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View nativeID="section-status-picker" style={styles.container}>
      {/* Compact row — always visible */}
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={[styles.compactRow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Animated.View style={[
          styles.statusDot,
          { backgroundColor: currentOption.color, transform: [{ scale: pulseAnim }] },
        ]} />
        <Text style={[styles.statusLabel, { color: currentOption.color }]}>
          {currentOption.label}
        </Text>
        {status.note ? (
          <Text style={styles.notePreview} numberOfLines={1}>
            {status.note}
          </Text>
        ) : null}
        <Text style={styles.chevron}>{expanded ? '^' : 'v'}</Text>
      </Pressable>

      {/* Expanded picker */}
      {expanded && (
        <View style={styles.expandedPanel}>
          {/* Status pills */}
          <View style={styles.pillRow}>
            {STATUS_OPTIONS.map(opt => {
              const isActive = opt.mode === status.mode;
              return (
                <Pressable
                  key={opt.mode}
                  onPress={() => handleSelectMode(opt.mode)}
                  style={[
                    styles.pill,
                    isActive && { backgroundColor: opt.color + '30', borderColor: opt.color },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <View style={[styles.pillDot, { backgroundColor: opt.color }]} />
                  <Text style={[
                    styles.pillText,
                    isActive && { color: opt.color },
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Note input */}
          <TextInput
            style={styles.noteInput}
            value={noteText}
            onChangeText={setNoteText}
            onBlur={handleNoteBlur}
            placeholder="Status note... (e.g. reviewing PR #42)"
            placeholderTextColor="#555"
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={handleNoteBlur}
          />

          {/* Timer presets */}
          <View style={styles.timerRow}>
            <Text style={styles.timerLabel}>TIMER:</Text>
            {TIMER_PRESETS.map(preset => {
              const isActive = preset.minutes === null
                ? !status.expiresAt
                : status.expiresAt && Math.abs(
                    new Date(status.expiresAt).getTime() - Date.now() - preset.minutes * 60_000
                  ) < 60_000;
              return (
                <Pressable
                  key={preset.label}
                  onPress={() => handleSetTimer(preset)}
                  style={[
                    styles.timerBtn,
                    isActive && { backgroundColor: accentColor + '30', borderColor: accentColor },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={[styles.timerBtnText, isActive && { color: accentColor }]}>
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0f',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    height: 40,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  notePreview: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
    flex: 1,
    marginLeft: 4,
  },
  chevron: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  expandedPanel: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111118',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 1,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#888',
    textTransform: 'uppercase',
  },
  noteInput: {
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#ccc',
    height: 32,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timerLabel: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: '#555',
    letterSpacing: 1,
  },
  timerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111118',
  },
  timerBtnText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#888',
  },
});
