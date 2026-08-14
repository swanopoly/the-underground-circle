/**
 * RunStatusBar — Shows active run status, current subagent, step progress.
 * Renders inline in the chat above the message input.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ActivityIndicator, Animated, Easing } from 'react-native';
import { pickThinkingVerb } from '../../lib/thinkingVerbs';
import ThinkingDots from '../chat-animations/ThinkingDots';
import ThinkingLabel from '../chat-animations/ThinkingLabel';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  status: 'idle' | 'running' | 'delegated' | 'waiting_approval';
  subagentName?: string;
  subagentIcon?: string;
  subagentColor?: string;
  delegatedSubagents?: Array<{ name: string; icon?: string; color?: string }>;
  currentStep?: string;
  stepCount?: number;
  totalSteps?: number;
  pluginName?: string;
  onPause?: () => void;
  onCancel?: () => void;
  accentColor?: string;
}

export default function RunStatusBar({
  status,
  currentStep,
}: Props) {
  // Rotate the "noodling / pondering / …" verb every 1.5s so the
  // single line that's left on this bar actually breathes.
  const [verbIdx, setVerbIdx] = useState(0);
  useEffect(() => {
    setVerbIdx(0);
    // RunStatusBar stays mounted while Chat moves idle -> running -> idle.
    // Keep its hook topology stable and only suspend the timer while hidden;
    // returning before these hooks triggers React 19's static-flag warning.
    if (status === 'idle') return;
    const t = setInterval(() => setVerbIdx((i) => i + 1), 1500);
    return () => clearInterval(t);
  }, [status]);

  if (status === 'idle') return null;

  // Minimal design: just the animated colored dot + a single label.
  // Explicit run-step labels still win (they're load-bearing context
  // like "Awaiting approval"). Everything else — even "OpenSwan is" —
  // is stripped. Just the verb.
  const label = currentStep?.trim()
    ? currentStep.trim()
    : status === 'waiting_approval'
      ? 'waiting for approval'
      : pickThinkingVerb(verbIdx);

  return (
    <View style={s.bar}>
      {/* Same morphing 6-dot constellation as the Quick Actions
          accordion header — circle → triangle → square → DNA → back. */}
      <ThinkingDots scale={1} cycleDuration={5.5} glow />
      <ThinkingLabel text={label} />
    </View>
  );
}

function ActivityDots({ colors }: { colors: string[] }) {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View style={s.activityDotsWrap}>
      {colors.map((color, index) => {
        const segment = 1 / colors.length;
        const opacity = progress.interpolate({
          inputRange: [
            Math.max(0, segment * index - 0.12),
            segment * index,
            Math.min(1, segment * index + 0.2),
            Math.min(1, segment * index + 0.36),
          ],
          outputRange: [0.4, 1, 0.85, 0.4],
          extrapolate: 'clamp',
        });
        const translateY = progress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, -2, 0],
        });
        const scale = progress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.95, 1.15, 0.95],
        });
        return (
          <Animated.View
            key={`${color}-${index}`}
            style={[
              s.activityDot,
              {
                backgroundColor: color,
                opacity,
                transform: [{ translateY }, { scale }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function SubagentLiveChip({
  name,
  icon,
  color,
}: {
  name: string;
  icon?: string;
  color: string;
}) {
  const glow = React.useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [`${color}35`, `${color}85`],
  });

  return (
    <Animated.View style={[s.liveChip, { borderColor, backgroundColor: `${color}14` }]}>
      <ActivityDots colors={[color, '#6366f1', '#f59e0b']} />
      <View style={[s.liveChipBadge, { borderColor: `${color}50`, backgroundColor: `${color}20` }]}>
        <Text style={[s.liveChipBadgeText, { color }]}>{icon || name.charAt(0)}</Text>
      </View>
      <Text style={[s.liveChipText, { color }]} numberOfLines={1}>{name.toUpperCase()}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0a0a10',
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  statusSection: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 10, fontWeight: '700', fontFamily: MONO },
  stepText: { color: '#606075', fontSize: 9, fontFamily: MONO, marginTop: 1 },
  subagentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  subagentBadge: { width: 16, height: 16, borderRadius: 2, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  subagentBadgeText: { fontSize: 8, fontWeight: '800', fontFamily: MONO },
  activityDotsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 28,
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveChipBadge: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveChipBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    fontFamily: MONO,
  },
  liveChipText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: MONO,
    maxWidth: 96,
  },
  progressSection: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  progressBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#1a1a28', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 } as any,
  progressText: { color: '#3a3a4e', fontSize: 8, fontFamily: MONO },
  controls: { flexDirection: 'row', gap: 4 },
  controlBtn: { width: 20, height: 20, borderRadius: 2, backgroundColor: '#1a1a28', borderWidth: 1, borderColor: '#2a2a3e', justifyContent: 'center', alignItems: 'center' },
  cancelBtn: { borderColor: '#ef444440' },
  controlBtnText: { color: '#606075', fontSize: 8, fontWeight: '800', fontFamily: MONO },
});
