/**
 * AgentEvolutionCard — RPG evolution status card for an agent
 *
 * Shown when tapping an agent in the Office. Displays:
 *   - Agent name + spirit + bond title
 *   - Dual XP bars (bond green, mastery purple)
 *   - Unlocks grid (earned/locked)
 *   - Evolution path to next unlock
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, Platform, AccessibilityInfo,
} from 'react-native';
import { BOND_UNLOCKS, BOND_LEVELS } from '../../lib/mastery';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

function useReducedMotionPreference(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        // Motion is decorative; if the preference cannot be read, fail to the
        // fully visible static state rather than guessing that motion is safe.
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
  agentName: string;
  bondLevel: number;
  bondTitle: string;
  bondXP: number;
  bondProgress: number;
  bondNextXp?: number;        // XP threshold for next bond level; omit if already MAX
  bondNextTitle?: string;     // Title for next bond level
  masteryLevel: number;
  masteryTitle: string;
  masteryXP: number;
  masteryProgress: number;
  masteryNextXp?: number;
  masteryNextTitle?: string;
  spirit?: string;
  unlocks: string[];
  accentColor: string;
}

// ─── Animated XP Bar ────────────────────────────────────────────────────────

function RPGBar({ progress, color, level, xp, title, label, nextXp, nextTitle, reduceMotion }: {
  progress: number;
  color: string;
  level: number;
  xp: number;
  title: string;
  label: string;
  // If provided, the panel renders "XP/NEXT → TITLE" under the bar so users
  // see exactly how far they are from the next milestone instead of guessing
  // from a percentage.
  nextXp?: number;
  nextTitle?: string;
  reduceMotion: boolean;
}) {
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fillAnim.stopAnimation();
    if (reduceMotion) {
      fillAnim.setValue(progress);
      return;
    }
    const fillAnimation = Animated.timing(fillAnim, {
      toValue: progress,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    fillAnimation.start();
    return () => fillAnimation.stop();
  }, [fillAnim, progress, reduceMotion]);

  return (
    <View style={barStyles.container}>
      {/* Label */}
      <Text style={[barStyles.label, { color: color + 'aa' }]}>{label}</Text>

      {/* Level number */}
      <View style={[barStyles.levelBox, { borderColor: color + '60', backgroundColor: color + '18' }]}>
        <Text style={[barStyles.levelNum, { color }]}>{level}</Text>
      </View>

      {/* Bar */}
      <View style={barStyles.track}>
        <Animated.View
          style={[
            barStyles.fill,
            {
              width: fillAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
              backgroundColor: color,
            },
          ]}
        />
        {/* Segment ticks */}
        {Array.from({ length: 9 }).map((_, i) => (
          <View key={i} style={[barStyles.tick, { left: `${(i + 1) * 10}%` as any }]} />
        ))}
      </View>

      {/* XP and current title */}
      <View style={barStyles.info}>
        <Text style={[barStyles.xpText, { color }]}>{xp} XP</Text>
        <Text style={barStyles.titleText}>{title}</Text>
      </View>

      {/* Milestone: "X/Y → NextTitle" if there's a next level, else MAX */}
      {nextXp !== undefined ? (
        <View style={barStyles.milestoneRow}>
          <Text style={[barStyles.milestoneXp, { color }]}>
            {xp}<Text style={barStyles.milestoneDim}>/{nextXp}</Text>
          </Text>
          {nextTitle ? (
            <Text style={barStyles.milestoneNext}>→ {nextTitle}</Text>
          ) : null}
          <Text style={[barStyles.pctText, { color }]}>{Math.round(progress * 100)}%</Text>
        </View>
      ) : (
        <View style={barStyles.milestoneRow}>
          <Text style={[barStyles.milestoneMax, { color }]}>MAX LEVEL</Text>
          <Text style={[barStyles.pctText, { color }]}>100%</Text>
        </View>
      )}
    </View>
  );
}

const barStyles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  levelBox: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  levelNum: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: '900',
  },
  track: {
    height: 6,
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 1,
  },
  tick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#00000040',
  },
  info: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  xpText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
  },
  titleText: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '600',
    color: '#6b6b80',
  },
  pctText: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'right',
    marginLeft: 'auto',
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  milestoneXp: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
  },
  milestoneDim: {
    color: '#6b6b80',
  },
  milestoneNext: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '600',
    color: '#8b8ba0',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  milestoneMax: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
});

// ─── Unlock Icon ────────────────────────────────────────────────────────────

const UNLOCK_ICONS: Record<string, string> = {
  greeting_pack: 'GP',
  memory_basic: 'MB',
  aura_tier1: 'A1',
  trait_reveal: 'TR',
  memory_contextual: 'MC',
  pet_upgrade: 'PU',
  initiative_suggestive: 'IS',
  workflow_pack: 'WP',
  signature_role: 'SR',
};

function UnlockIcon({ kind, label, earned, accentColor }: {
  kind: string; label: string; earned: boolean; accentColor: string;
}) {
  const iconText = UNLOCK_ICONS[kind] || kind.slice(0, 2).toUpperCase();
  return (
    <View style={[
      unlockStyles.box,
      earned
        ? { borderColor: accentColor + '60', backgroundColor: accentColor + '18' }
        : { borderColor: '#1a1a2e', backgroundColor: '#0a0a0f' },
    ]}>
      <Text style={[
        unlockStyles.icon,
        { color: earned ? accentColor : '#3a3a4e' },
      ]}>
        {iconText}
      </Text>
      <Text style={[
        unlockStyles.label,
        { color: earned ? '#8b8ba0' : '#2a2a3e' },
      ]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const unlockStyles = StyleSheet.create({
  box: {
    width: 56,
    height: 48,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  icon: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  label: {
    fontFamily: MONO,
    fontSize: 5,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 2,
  },
});

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AgentEvolutionCard({
  agentName, bondLevel, bondTitle, bondXP, bondProgress, bondNextXp, bondNextTitle,
  masteryLevel, masteryTitle, masteryXP, masteryProgress, masteryNextXp, masteryNextTitle,
  spirit, unlocks, accentColor,
}: Props) {
  const entranceAnim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    entranceAnim.stopAnimation();
    if (reduceMotion) {
      entranceAnim.setValue(1);
      return;
    }
    entranceAnim.setValue(0);
    const entranceAnimation = Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    entranceAnimation.start();
    return () => entranceAnimation.stop();
  }, [entranceAnim, reduceMotion]);

  // Determine next unlock
  const allUnlockLevels = Object.keys(BOND_UNLOCKS).map(Number).sort((a, b) => a - b);
  const nextUnlockLevel = allUnlockLevels.find(lv => lv > bondLevel);
  const nextUnlock = nextUnlockLevel != null ? BOND_UNLOCKS[nextUnlockLevel] : null;

  // XP needed for next unlock level
  const nextBondLevelData = nextUnlockLevel != null
    ? BOND_LEVELS.find(bl => bl.level === nextUnlockLevel)
    : null;
  const xpToNext = nextBondLevelData ? Math.max(0, nextBondLevelData.xpRequired - bondXP) : 0;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          borderColor: accentColor + '40',
          opacity: entranceAnim,
          transform: [{
            translateY: entranceAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            }),
          }],
        },
      ]}
      nativeID="section-agent-evolution-card"
    >
      {/* ── SECTION: header — agent name + spirit + bond title ── */}
      <View style={styles.header}>
        <View style={[styles.avatarBox, { borderColor: accentColor + '60', backgroundColor: accentColor + '18' }]}>
          <Text style={[styles.avatarLetter, { color: accentColor }]}>
            {agentName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            <Text style={[styles.agentName, { color: '#e2e2f0' }]}>{agentName.toUpperCase()}</Text>
            {spirit && <Text style={styles.spiritEmoji}>{spirit}</Text>}
          </View>
          <Text style={[styles.bondTitleText, { color: accentColor }]}>{bondTitle}</Text>
        </View>
      </View>

      {/* ── SECTION: xp-bars — dual bond + mastery bars ── */}
      <View style={styles.barsRow}>
        <RPGBar
          progress={bondProgress}
          color="#22c55e"
          level={bondLevel}
          xp={bondXP}
          title={bondTitle}
          label="BOND"
          nextXp={bondNextXp}
          nextTitle={bondNextTitle}
          reduceMotion={reduceMotion}
        />
        <View style={styles.barDivider} />
        <RPGBar
          progress={masteryProgress}
          color="#a855f7"
          level={masteryLevel}
          xp={masteryXP}
          title={masteryTitle}
          label="MASTERY"
          nextXp={masteryNextXp}
          nextTitle={masteryNextTitle}
          reduceMotion={reduceMotion}
        />
      </View>

      {/* ── SECTION: unlocks — earned/locked unlock grid ── */}
      <View style={styles.unlocksSection}>
        <Text style={styles.sectionLabel}>UNLOCKS</Text>
        <View style={styles.unlocksGrid}>
          {Object.entries(BOND_UNLOCKS).map(([levelStr, unlock]) => {
            const level = parseInt(levelStr, 10);
            const earned = unlocks.includes(unlock.kind);
            return (
              <UnlockIcon
                key={unlock.kind}
                kind={unlock.kind}
                label={unlock.label}
                earned={earned}
                accentColor={accentColor}
              />
            );
          })}
        </View>
      </View>

      {/* ── SECTION: evolution-path — next unlock indicator ── */}
      {nextUnlock && (
        <View style={[styles.evolutionPath, { borderColor: accentColor + '30' }]}>
          <Text style={styles.evolutionLabel}>EVOLUTION PATH</Text>
          <View style={styles.evolutionRow}>
            <View style={[styles.evolutionDot, { backgroundColor: accentColor }]} />
            <View style={styles.evolutionInfo}>
              <Text style={styles.evolutionTarget}>
                Lv{nextUnlockLevel}: {nextUnlock.label}
              </Text>
              <Text style={[styles.evolutionXP, { color: accentColor }]}>
                {xpToNext > 0 ? `${xpToNext} XP needed` : 'Ready!'}
              </Text>
            </View>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderRadius: 2,
    padding: 16,
    gap: 16,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #050508' } as any : {
      shadowColor: '#050508',
      shadowOffset: { width: 4, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 0,
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarBox: {
    width: 40,
    height: 40,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: '900',
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  agentName: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  spiritEmoji: {
    fontSize: 14,
  },
  bondTitleText: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  barsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  barDivider: {
    width: 1,
    backgroundColor: '#1a1a2e',
    marginVertical: 4,
  },
  unlocksSection: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '800',
    color: '#4a4a5e',
    letterSpacing: 2,
  },
  unlocksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  evolutionPath: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  evolutionLabel: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '800',
    color: '#4a4a5e',
    letterSpacing: 2,
  },
  evolutionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  evolutionDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  evolutionInfo: {
    flex: 1,
    gap: 2,
  },
  evolutionTarget: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: '700',
    color: '#c0c0d0',
  },
  evolutionXP: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
  },
});
