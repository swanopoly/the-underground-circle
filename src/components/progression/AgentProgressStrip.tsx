/**
 * AgentProgressStrip — compact UI strip showing agent bond + mastery progress
 *
 * Single row layout:
 *   [Agent avatar circle] [Name + Bond Title] [Bond XP bar] [Mastery level badge]
 *
 * Dark theme, compact (height ~44px), monospace text.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { getAgentProgression, AgentProgression } from '../../lib/progression';
import { getBondProgress, getMasteryLevel } from '../../lib/mastery';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

type Props = {
  userId: string;
  agentId: string;
  agentName: string;
  agentColor?: string;
};

export default function AgentProgressStrip({ userId, agentId, agentName, agentColor = '#6366f1' }: Props) {
  const [progression, setProgression] = useState<AgentProgression | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentProgression(userId, agentId).then(data => {
      if (!cancelled) setProgression(data);
    }).catch(err => {
      console.warn('[AgentProgressStrip] load error:', err);
    });
    return () => { cancelled = true; };
  }, [userId, agentId]);

  if (!progression) {
    return (
      <View style={styles.container} nativeID="section-agent-progress-strip-loading">
        <View style={[styles.avatar, { backgroundColor: agentColor + '40' }]} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const bondProgress = getBondProgress(progression.bondXP);
  const topMastery = progression.masteryEntries.length > 0
    ? progression.masteryEntries.reduce((best, e) => e.mastery_xp > best.mastery_xp ? e : best, progression.masteryEntries[0])
    : null;
  const masteryLevel = topMastery ? getMasteryLevel(topMastery.mastery_xp) : null;

  return (
    <View style={styles.container} nativeID="section-agent-progress-strip">
      {/* ── SECTION: avatar — agent color circle ── */}
      <View style={[styles.avatar, { backgroundColor: agentColor }]}>
        <Text style={styles.avatarText}>{agentName.charAt(0).toUpperCase()}</Text>
      </View>

      {/* ── SECTION: name-title — agent name + bond title ── */}
      <View style={styles.nameBlock}>
        <Text style={styles.agentName} numberOfLines={1}>{agentName}</Text>
        <Text style={[styles.bondTitle, { color: agentColor }]}>{progression.bondTitle}</Text>
      </View>

      {/* ── SECTION: bond-bar — XP progress bar ── */}
      <View style={styles.barOuter}>
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              {
                width: `${Math.round(bondProgress.progress * 100)}%` as any,
                backgroundColor: agentColor,
              },
            ]}
          />
        </View>
        <Text style={styles.barLabel}>
          Lv{bondProgress.current.level}
          {bondProgress.next ? ` / ${bondProgress.next.xpRequired}xp` : ' MAX'}
        </Text>
      </View>

      {/* ── SECTION: mastery-badge — mastery level badge ── */}
      {masteryLevel && (
        <View style={styles.masteryBadge}>
          <Text style={styles.masteryNumber}>{masteryLevel.level}</Text>
          <Text style={styles.masteryTitle}>{masteryLevel.title}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 8,
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    gap: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  nameBlock: {
    flexShrink: 1,
    minWidth: 60,
  },
  agentName: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: '700',
    color: '#e2e2f0',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  bondTitle: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  barOuter: {
    flex: 1,
    minWidth: 60,
    gap: 2,
  },
  barTrack: {
    height: 5,
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 1,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 1,
  },
  barLabel: {
    fontFamily: MONO,
    fontSize: 8,
    color: '#6b6b80',
    textAlign: 'center',
  },
  masteryBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111118',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 40,
  },
  masteryNumber: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '700',
    color: '#f59e0b',
  },
  masteryTitle: {
    fontFamily: MONO,
    fontSize: 7,
    color: '#6b6b80',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loadingText: {
    fontFamily: MONO,
    fontSize: 10,
    color: '#3a3a4e',
  },
});
