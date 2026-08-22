import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import AgentEvolutionCard from '../../../../components/rpg/AgentEvolutionCard';
import XPEventFeed from '../../../../components/rpg/XPEventFeed';
import StreakFlame from '../../../../components/rpg/StreakFlame';
import { getAgentProgression, AgentProgression } from '../../../../lib/progression';
import { getBondProgress, getMasteryProgress, getMasteryLevel } from '../../../../lib/mastery';
import {
  isStreakActive,
  loadMissionStreakExact,
  type MissionStreak,
} from '../../../../lib/missionStreaks';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from '../../../../lib/connectionManager';

interface Props {
  agentId: string;
  agentAliases?: string[];
  agentName: string;
  accentColor: string;
  circleId?: string;
  userId?: string | null;
  spirit?: string;
  identityAuthority: OfficeConnectionExactAuthority | null;
  isIdentityAuthorityCurrent: OfficeConnectionAuthorityFence;
}

export default function AgentEvolutionPanel({
  agentId,
  agentAliases = [],
  agentName,
  accentColor,
  circleId,
  userId,
  spirit,
  identityAuthority,
  isIdentityAuthorityCurrent,
}: Props) {
  const [progression, setProgression] = useState<AgentProgression | null>(null);
  const [streak, setStreak] = useState<MissionStreak | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const aliasKey = agentAliases.map(value => String(value || '').trim()).filter(Boolean).sort().join('\u0000');
  const exactAgentIds = useMemo(
    () => Array.from(new Set([agentId, ...aliasKey.split('\u0000')].filter(Boolean))),
    [agentId, aliasKey],
  );
  const exactAuthority = useMemo(() => {
    const authority = identityAuthority;
    if (
      !authority
      || !circleId
      || authority.circleId !== circleId
      || authority.userId !== userId
      || !authority.accessToken
      || !Number.isSafeInteger(authority.generation)
      || authority.generation <= 0
      || !isIdentityAuthorityCurrent(authority)
    ) return null;
    return authority;
  }, [circleId, identityAuthority, isIdentityAuthorityCurrent, userId]);

  useEffect(() => {
    if (!userId || !agentId || !exactAuthority) {
      setProgression(null);
      setStreak(null);
      setLoadError('Progression is unavailable until this agent has an authenticated identity.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setProgression(null);
    setStreak(null);
    const capturedAuthority = exactAuthority;
    Promise.all([
      getAgentProgression(userId, agentId, circleId, exactAgentIds, {
        authority: capturedAuthority,
        isAuthorityCurrent: isIdentityAuthorityCurrent,
        strict: true,
      }),
      loadMissionStreakExact(capturedAuthority, isIdentityAuthorityCurrent),
    ])
      .then(([data, streakResult]) => {
        if (cancelled || !isIdentityAuthorityCurrent(capturedAuthority)) return;
        if (!streakResult.ok) throw new Error(`streak_${streakResult.error}`);
        setProgression(data);
        setStreak(streakResult.streak);
      })
      .catch(err => {
        console.warn('[AgentEvolutionPanel] Failed to load progression:', err);
        if (!cancelled && isIdentityAuthorityCurrent(capturedAuthority)) setLoadError('Progression could not be loaded. Check the connection and try again.');
      })
      .finally(() => {
        if (!cancelled && isIdentityAuthorityCurrent(capturedAuthority)) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agentId, aliasKey, circleId, exactAuthority, isIdentityAuthorityCurrent, reloadGeneration, userId]);

  if (loading) {
    return (
      <View accessibilityLiveRegion="polite" style={{ padding: 24, alignItems: 'center', gap: 10 }}>
        <ActivityIndicator
          accessibilityRole="progressbar"
          accessibilityLabel="Loading verified agent progression and streak"
          size="small"
          color={accentColor}
        />
        <Text style={{ color: '#8b949e', fontSize: 12 }}>Loading verified progression…</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ padding: 16, gap: 10, borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#2a0b0b', borderRadius: 6 }}>
        <Text style={{ color: '#fca5a5', fontSize: 12, lineHeight: 18 }}>{loadError}</Text>
        <Pressable
          onPress={() => setReloadGeneration(value => value + 1)}
          accessibilityRole="button"
          accessibilityLabel="Retry loading agent progression"
          style={[{ minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#ef444466', justifyContent: 'center' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
        >
          <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '700' }}>Try again</Text>
        </Pressable>
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

  // Streak is user-level (mission streak system), not agent-level. The panel
  // uses only the exact durable receipt loaded above; a missing/corrupt local
  // cache or failed backend read can never masquerade as a verified zero.
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
      {circleId && userId && exactAuthority && (
        <View style={{ marginTop: 8 }}>
          <XPEventFeed
            circleId={circleId}
            userId={userId}
            agentIds={exactAgentIds}
            limit={15}
            identityAuthority={exactAuthority}
            isIdentityAuthorityCurrent={isIdentityAuthorityCurrent}
          />
        </View>
      )}
      <View style={{ alignItems: 'center', marginTop: 12 }}>
        <Text style={{ color: '#8b949e', fontSize: 11, marginBottom: 4 }}>Owner mission streak</Text>
        <StreakFlame streakDays={streakDays} accentColor={accentColor} />
      </View>
    </>
  );
}
