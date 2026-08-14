/**
 * WorldClockBar.tsx — Horizontal bar showing each team member's local time
 *
 * Displays member time cards with day/night indicators and working hours overlap.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberInfo {
  id: string;
  name: string;
  timezone?: string;
}

interface Props {
  members: MemberInfo[];
  accentColor: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface LocalTime {
  hours: number;
  minutes: number;
  ampm: string;
  timeStr: string;
}

function getLocalTime(timezone: string, now: Date): LocalTime | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour');
    const minutePart = parts.find(p => p.type === 'minute');
    const dayPeriod = parts.find(p => p.type === 'dayPeriod');

    const h = Number.parseInt(hourPart?.value || '', 10);
    const m = Number.parseInt(minutePart?.value || '', 10);
    const ampm = dayPeriod?.value || 'AM';

    // Get 24h format for day/night check
    const formatter24 = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const hour24Part = formatter24.formatToParts(now).find(part => part.type === 'hour');
    const h24 = Number.parseInt(hour24Part?.value || '', 10);

    if (![h, m, h24].every(Number.isFinite)) return null;

    const timeStr = `${h}:${minutePart?.value || '00'}`;
    return { hours: h24 % 24, minutes: m, ampm: ampm.toUpperCase(), timeStr };
  } catch {
    return null;
  }
}

function isDayTime(hours24: number): boolean {
  return hours24 >= 8 && hours24 < 20;
}

function isWorkingHours(hours24: number): boolean {
  return hours24 >= 9 && hours24 < 17;
}

function getInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorldClockBar({ members, accentColor }: Props) {
  const [tick, setTick] = useState(0);

  // Update every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Calculate time data for each member
  const memberTimes = useMemo(() => {
    const now = new Date();
    return members.map(m => {
      if (!m.timezone) {
        return { ...m, time: null, isDay: false, isWorking: false };
      }
      const t = getLocalTime(m.timezone, now);
      if (!t) {
        return { ...m, time: null, isDay: false, isWorking: false };
      }
      return {
        ...m,
        time: t,
        isDay: isDayTime(t.hours),
        isWorking: isWorkingHours(t.hours),
      };
    });
  }, [members, tick]);

  // Find overlap groups (2+ members in working hours)
  const workingMemberIds = useMemo(() => {
    const working = memberTimes.filter(m => m.isWorking);
    return working.length >= 2 ? new Set(working.map(m => m.id)) : new Set<string>();
  }, [memberTimes]);

  if (members.length === 0) return null;

  return (
    <View nativeID="section-world-clock-bar" style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {memberTimes.map((member) => {
          const hasOverlap = workingMemberIds.has(member.id);

          return (
            <View
              key={member.id}
              accessible
              accessibilityLabel={member.time
                ? `${member.name}, ${member.time.timeStr} ${member.time.ampm} in ${member.timezone}${hasOverlap ? ', within shared working hours' : ''}`
                : `${member.name}, timezone unavailable`}
              style={[
                styles.card,
                hasOverlap && { borderColor: '#22c55e40' },
              ]}
            >
              {/* Avatar initial */}
              <View style={[
                styles.avatar,
                { backgroundColor: member.isDay ? accentColor + '30' : '#1a1a2e' },
              ]}>
                <Text style={[
                  styles.avatarText,
                  { color: member.isDay ? accentColor : '#555' },
                ]}>
                  {getInitial(member.name)}
                </Text>
              </View>

              {/* Name */}
              <Text
                style={[styles.memberName, !member.isDay && styles.dimmedText]}
                numberOfLines={1}
              >
                {member.name.length > 8 ? member.name.slice(0, 7) + '.' : member.name}
              </Text>

              {/* Time display */}
              {member.time ? (
                <View style={styles.timeWrap}>
                  <Text style={[
                    styles.timeText,
                    !member.isDay && styles.dimmedTime,
                  ]}>
                    {member.time.timeStr}
                  </Text>
                  <Text style={[
                    styles.ampmText,
                    !member.isDay && styles.dimmedText,
                  ]}>
                    {member.time.ampm}
                  </Text>
                </View>
              ) : (
                <Text style={styles.noTzText}>?</Text>
              )}

              {/* Sun/Moon indicator */}
              <Text style={styles.dayNightIcon}>
                {!member.time ? 'TZ?' : member.isDay ? 'DAY' : 'NIGHT'}
              </Text>

              {/* Overlap connector */}
              {hasOverlap && (
                <View style={styles.overlapDot} />
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: 44,
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: '#0a0a0f',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    height: 36,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  avatarText: {
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  memberName: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#999',
    maxWidth: 54,
  },
  dimmedText: {
    color: '#444',
  },
  timeWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
    color: '#e8e8e8',
    letterSpacing: -0.5,
  },
  dimmedTime: {
    color: '#555',
  },
  ampmText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: '#888',
  },
  noTzText: {
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'monospace',
    color: '#333',
  },
  dayNightIcon: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: '#555',
  },
  overlapDot: {
    width: 4,
    height: 4,
    borderRadius: 1,
    backgroundColor: '#22c55e',
    position: 'absolute',
    top: 2,
    right: 2,
  },
});
