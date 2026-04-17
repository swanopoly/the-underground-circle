import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import AgentEvolutionCard from '../../../../components/rpg/AgentEvolutionCard';
import XPEventFeed from '../../../../components/rpg/XPEventFeed';
import StreakFlame from '../../../../components/rpg/StreakFlame';
import { getAgentProgression, AgentProgression } from '../../../../lib/progression';
import { getBondProgress, getMasteryProgress, getMasteryLevel } from '../../../../lib/mastery';
import { loadStreak, isStreakActive } from '../../../../lib/missionStreaks';

interface Props {
  agentId: string;
  agentName: string;
  accentColor: string;
  circleId?: string;
  userId?: string | null;
  spirit?: string;
}

export default function AgentEvolutionPanel({ agentId, agentName, accentColor, circleId, userId, spirit }: Props) {
  const [progression, setProgression] = useState<AgentProgression | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !agentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getAgentProgression(userId, agentId)
      .then(data => {
        if (!cancelled) setProgression(data);
      })
      .catch(err => {
        console.warn('[AgentEvolutionPanel] Failed to load progression:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId, agentId]);

  if (loading) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={accentColor} />
      </View>
    );
  }

  const bondXP = progression?.bondXP ?? 0;
  const bondLevel = progression?.bondLevel;
  const bondProgressInfo = getBondProgress(bondXP);
  const bondProgress = bondProgressInfo.progress;
  const bondNextXp = bondProgressInfo.next?.xpRequired;
  const bondNextTitle = bondProgressInfo.next?.title;

  // Pick highest-XP mastery entry; fall back to level 1 if none.
  const topMastery = progression?.masteryEntries.length
    ? progression.masteryEntries.reduce(
        (best, e) => (e.mastery_xp > best.mastery_xp ? e : best),
        progression.masteryEntries[0],
      )
    : null;
  const masteryXP = topMastery?.mastery_xp ?? 0;
  const masteryLevelObj = getMasteryLevel(masteryXP);
  const masteryProgressInfo = getMasteryProgress(masteryXP);
  const masteryProgress = masteryProgressInfo.progress;
  const masteryNextXp = masteryProgressInfo.next?.xpRequired;
  const masteryNextTitle = masteryProgressInfo.next?.title;

  // Only the unlock_kind strings are used by AgentEvolutionCard
  const unlockKinds = (progression?.unlocks ?? []).map(u => u.unlock_kind);

  // Streak is user-level (mission streak system), not agent-level
  const streak = userId ? loadStreak(userId) : null;
  const streakDays = streak && isStreakActive(streak) ? streak.currentStreak : 0;

  return (
    <>
      <AgentEvolutionCard
        agentName={agentName}
        bondLevel={bondLevel?.level ?? 1}
        bondTitle={bondLevel?.title ?? 'Acquaintance'}
        bondXP={bondXP}
        bondProgress={bondProgress}
        bondNextXp={bondNextXp}
        bondNextTitle={bondNextTitle}
        masteryLevel={topMastery?.mastery_level ?? masteryLevelObj.level}
        masteryTitle={topMastery?.mastery_title ?? masteryLevelObj.title}
        masteryXP={masteryXP}
        masteryProgress={masteryProgress}
        masteryNextXp={masteryNextXp}
        masteryNextTitle={masteryNextTitle}
        spirit={spirit}
        unlocks={unlockKinds}
        accentColor={accentColor}
      />
      {circleId && userId && (
        <View style={{ marginTop: 8 }}>
          <XPEventFeed circleId={circleId} userId={userId} limit={15} />
        </View>
      )}
      <View style={{ alignItems: 'center', marginTop: 12 }}>
        <StreakFlame streakDays={streakDays} accentColor={accentColor} />
      </View>
    </>
  );
}
