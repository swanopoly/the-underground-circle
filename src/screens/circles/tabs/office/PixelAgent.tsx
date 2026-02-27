import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Platform } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { AgentAppearance, DEFAULT_APPEARANCE } from '../../../../lib/officeConfig';
import ThoughtBubble from '../../../../components/ThoughtBubble';
import { ThoughtBubble as ThoughtData, generateThoughtBubble } from '../../../../lib/agentMessaging';

interface Props {
  agent: OfficeAgent;
  appearance?: AgentAppearance;
  onPress: () => void;
  selected: boolean;
  scale?: number;
  showThoughts?: boolean; // Enable thought bubbles
  dancing?: boolean; // Badge celebration dance
  xp?: number;       // current XP points
  xpNext?: number;   // XP needed for next badge
}

export default function PixelAgent({ agent, appearance, onPress, selected, scale = 1, showThoughts = false, dancing = false, xp = 0, xpNext = 100 }: Props) {
  const a = appearance || { ...DEFAULT_APPEARANCE, shirtColor: agent.color, hairColor: agent.color };
  const bobAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const danceX = useRef(new Animated.Value(0)).current;
  const danceY = useRef(new Animated.Value(0)).current;
  const danceRotate = useRef(new Animated.Value(0)).current;
  const danceScale = useRef(new Animated.Value(1)).current;

  const [currentThought, setCurrentThought] = useState<ThoughtData | null>(null);
  const lastCost = useRef(agent.costToday);
  const lastStatus = useRef(agent.status);

  // Dance animation — triggered by badge earn
  useEffect(() => {
    if (!dancing) {
      danceX.setValue(0);
      danceY.setValue(0);
      danceRotate.setValue(0);
      danceScale.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(danceX, { toValue: -8, duration: 120, useNativeDriver: true }),
          Animated.timing(danceY, { toValue: -10, duration: 120, useNativeDriver: true }),
          Animated.timing(danceRotate, { toValue: -15, duration: 120, useNativeDriver: true }),
          Animated.timing(danceScale, { toValue: 1.15, duration: 120, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(danceX, { toValue: 8, duration: 120, useNativeDriver: true }),
          Animated.timing(danceY, { toValue: -4, duration: 120, useNativeDriver: true }),
          Animated.timing(danceRotate, { toValue: 15, duration: 120, useNativeDriver: true }),
          Animated.timing(danceScale, { toValue: 1.2, duration: 120, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(danceX, { toValue: -6, duration: 100, useNativeDriver: true }),
          Animated.timing(danceY, { toValue: -12, duration: 100, useNativeDriver: true }),
          Animated.timing(danceRotate, { toValue: -10, duration: 100, useNativeDriver: true }),
          Animated.timing(danceScale, { toValue: 1.1, duration: 100, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(danceX, { toValue: 0, duration: 150, useNativeDriver: true }),
          Animated.timing(danceY, { toValue: 0, duration: 150, useNativeDriver: true }),
          Animated.timing(danceRotate, { toValue: 0, duration: 150, useNativeDriver: true }),
          Animated.timing(danceScale, { toValue: 1, duration: 150, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dancing]);

  useEffect(() => {
    if (agent.status === 'active' || agent.status === 'idle') {
      const bobLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(bobAnim, { toValue: -2, duration: 1200 + Math.random() * 400, useNativeDriver: true }),
          Animated.timing(bobAnim, { toValue: 0, duration: 1200 + Math.random() * 400, useNativeDriver: true }),
        ])
      );
      bobLoop.start();
      return () => bobLoop.stop();
    }
  }, [agent.status]);

  useEffect(() => {
    if (agent.status === 'active') {
      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 0.9, duration: 1500, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.3, duration: 1500, useNativeDriver: true }),
        ])
      );
      glowLoop.start();
      return () => glowLoop.stop();
    }
  }, [agent.status]);

  // Thought bubble generation
  useEffect(() => {
    if (!showThoughts || currentThought) return;

    // Check for events
    const costSpike = agent.costToday > lastCost.current + 0.10; // $0.10 spike
    const statusChanged = agent.status !== lastStatus.current;
    const longIdle = agent.status === 'idle';

    lastCost.current = agent.costToday;
    lastStatus.current = agent.status;

    // Random thoughts every 8-20 seconds — agents are proactive
    const minDelay = 8000;
    const maxDelay = 20000;
    const delay = Math.random() * (maxDelay - minDelay) + minDelay;

    const thoughtCtx = {
      recentCostSpike: costSpike,
      recentError: agent.status === 'error',
      longIdle,
      xp,
      xpNext,
    };

    const timer = setTimeout(() => {
      const thought = generateThoughtBubble(agent, thoughtCtx);
      if (thought) setCurrentThought(thought);
    }, delay);

    // Immediate thought on meaningful events
    if (statusChanged || costSpike) {
      const thought = generateThoughtBubble(agent, thoughtCtx);
      if (thought) setCurrentThought(thought);
    }

    return () => clearTimeout(timer);
  }, [agent.costToday, agent.status, showThoughts, currentThought]);

  const statusColor = STATUS_COLORS[agent.status];
  const isOffline = agent.status === 'offline';
  const PX = 2.5 * scale;

  return (
    <Pressable onPress={onPress} style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : undefined}>
      <Animated.View style={[styles.container, {
          transform: [
            { translateX: danceX },
            { translateY: Animated.add(bobAnim, danceY) },
            { rotate: danceRotate.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }) },
            { scale: danceScale },
          ],
        }]}>
        {/* Thought bubble */}
        {showThoughts && currentThought && (
          <ThoughtBubble
            thought={currentThought}
            onDismiss={() => setCurrentThought(null)}
          />
        )}
        
        {selected && <View style={[styles.selectionRing, { borderColor: agent.color }]} />}

        {/* Status dot */}
        <Animated.View style={[styles.statusDot, {
          backgroundColor: statusColor,
          opacity: agent.status === 'active' ? glowAnim : 1,
        }]} />

        {/* Hat */}
        {a.hat === 'crown' && (
          <Text style={styles.hatEmoji}>{'👑'}</Text>
        )}
        {a.hat === 'cap' && (
          <View style={[styles.cap, { backgroundColor: a.shirtColor }]} />
        )}
        {a.hat === 'tophat' && (
          <View style={styles.tophat}>
            <View style={[styles.tophatTop, { backgroundColor: '#1a1a1a' }]} />
            <View style={[styles.tophatBrim, { backgroundColor: '#1a1a1a' }]} />
          </View>
        )}
        {a.hat === 'beanie' && (
          <View style={[styles.beanie, { backgroundColor: a.shirtColor }]} />
        )}

        {/* Head */}
        <View style={[styles.head, isOffline && styles.offlineOpacity]}>
          {/* Hair */}
          {a.hairStyle !== 'bald' && (
            <View style={[
              styles.hair,
              { backgroundColor: a.hairColor },
              a.hairStyle === 'spiky' && styles.hairSpiky,
              a.hairStyle === 'mohawk' && styles.hairMohawk,
              a.hairStyle === 'long' && styles.hairLong,
            ]} />
          )}
          {/* Face */}
          <View style={[styles.face, { backgroundColor: a.skinTone }]}>
            {/* Accessory: glasses */}
            {a.accessory === 'glasses' && (
              <View style={styles.glasses}>
                <View style={styles.glassLens} />
                <View style={styles.glassBridge} />
                <View style={styles.glassLens} />
              </View>
            )}
            {/* Eyes */}
            <View style={styles.eyeRow}>
              <View style={[styles.eye, isOffline && styles.closedEye, a.expression === 'cool' && styles.coolEye]} />
              <View style={[styles.eye, isOffline && styles.closedEye, a.expression === 'cool' && styles.coolEye]} />
            </View>
            {/* Mouth */}
            <View style={[
              styles.mouth,
              isOffline && styles.sleepMouth,
              a.expression === 'happy' && styles.happyMouth,
            ]} />
          </View>
        </View>

        {/* Accessory: headphones */}
        {a.accessory === 'headphones' && (
          <View style={styles.headphones}>
            <View style={styles.hpBand} />
            <View style={[styles.hpEar, { left: -2 }]} />
            <View style={[styles.hpEar, { right: -2 }]} />
          </View>
        )}

        {/* Body */}
        <View style={[styles.body, { backgroundColor: a.shirtColor }, isOffline && styles.offlineOpacity]}>
          {a.accessory === 'bowtie' && <View style={styles.bowtie} />}
          <View style={[styles.arm, styles.leftArm, { backgroundColor: a.shirtColor }]} />
          <View style={[styles.arm, styles.rightArm, { backgroundColor: a.shirtColor }]} />
        </View>

        {/* Legs */}
        <View style={[styles.legs, isOffline && styles.offlineOpacity]}>
          <View style={[styles.leg, { backgroundColor: a.pantsColor }]} />
          <View style={[styles.leg, { backgroundColor: a.pantsColor }]} />
        </View>

        {/* Name label */}
        <View style={styles.nameContainer}>
          <Text style={[styles.name, { color: agent.color }]} numberOfLines={1}>{agent.name}</Text>
        </View>

        {/* XP bar */}
        <View style={styles.xpBarOuter}>
          <View style={[styles.xpBarFill, { width: `${Math.min(100, xpNext > 0 ? (xp / xpNext) * 100 : 0)}%`, backgroundColor: agent.color }]} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const PX = 2.5;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: 60,
    height: 80,
    position: 'relative',
  },
  selectionRing: {
    position: 'absolute',
    top: 8,
    left: 6,
    right: 6,
    bottom: 18,
    borderWidth: 1.5,
    borderRadius: 3,
    borderStyle: 'dashed',
  },
  statusDot: {
    position: 'absolute',
    top: 6,
    right: 10,
    width: 6,
    height: 6,
    borderRadius: 3,
    zIndex: 10,
  },
  // Hats
  hatEmoji: { fontSize: 8, marginBottom: -4, zIndex: 5 },
  cap: {
    width: PX * 8,
    height: PX * 2,
    borderRadius: 2,
    marginBottom: -2,
    zIndex: 5,
  },
  tophat: { alignItems: 'center', marginBottom: -2, zIndex: 5 },
  tophatTop: { width: PX * 5, height: PX * 4, borderRadius: 1 },
  tophatBrim: { width: PX * 8, height: PX * 1.5 },
  beanie: {
    width: PX * 8,
    height: PX * 3,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    marginBottom: -2,
    zIndex: 5,
  },
  // Head
  head: {
    width: PX * 7,
    height: PX * 7,
    alignItems: 'center',
    marginTop: 8,
  },
  hair: {
    width: PX * 7,
    height: PX * 2.5,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  hairSpiky: { borderTopLeftRadius: 0, borderTopRightRadius: 0, height: PX * 3 },
  hairMohawk: { width: PX * 3, height: PX * 4 },
  hairLong: { height: PX * 4 },
  face: {
    width: PX * 7,
    height: PX * 4.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Accessories
  glasses: {
    position: 'absolute',
    top: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  glassLens: {
    width: PX * 2,
    height: PX * 1.5,
    borderWidth: 0.5,
    borderColor: '#333',
    borderRadius: 1,
    backgroundColor: '#ffffff20',
  },
  glassBridge: { width: 2, height: 1, backgroundColor: '#333' },
  headphones: {
    position: 'absolute',
    top: 10,
    width: PX * 9,
    height: PX * 3,
    zIndex: 5,
  },
  hpBand: {
    position: 'absolute',
    top: 0,
    left: 2,
    right: 2,
    height: 2,
    backgroundColor: '#333',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  hpEar: {
    position: 'absolute',
    top: 1,
    width: 5,
    height: 6,
    backgroundColor: '#333',
    borderRadius: 2,
  },
  // Eyes
  eyeRow: { flexDirection: 'row', gap: PX * 1.5, marginBottom: 1 },
  eye: { width: PX * 0.8, height: PX * 0.8, backgroundColor: '#1a1a1a' },
  closedEye: { height: 0.5, width: PX * 1.2, backgroundColor: '#666' },
  coolEye: { height: PX * 0.5, width: PX * 1.2 },
  // Mouth
  mouth: { width: PX * 1.5, height: 0.8, backgroundColor: '#c4956a' },
  sleepMouth: { width: PX * 0.8, height: PX * 0.8, borderRadius: PX / 2 },
  happyMouth: {
    width: PX * 2,
    height: PX * 1,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: '#c4956a',
  },
  // Body
  body: {
    width: PX * 7,
    height: PX * 5,
    position: 'relative',
  },
  bowtie: {
    position: 'absolute',
    top: 0,
    left: PX * 2.5,
    width: PX * 2,
    height: PX * 1.5,
    backgroundColor: '#ef4444',
    borderRadius: 1,
  },
  arm: {
    position: 'absolute',
    width: PX * 1.5,
    height: PX * 4,
    top: 0,
    opacity: 0.85,
  },
  leftArm: { left: -PX * 1.5 },
  rightArm: { right: -PX * 1.5 },
  legs: { flexDirection: 'row', gap: PX * 0.5 },
  leg: { width: PX * 2.5, height: PX * 3 },
  // Name
  nameContainer: { alignItems: 'center', marginTop: 2 },
  name: {
    fontSize: 7,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  offlineOpacity: { opacity: 0.4 },
  xpBarOuter: {
    width: 40,
    height: 3,
    backgroundColor: '#1a1a2e',
    borderRadius: 2,
    marginTop: 2,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    borderRadius: 2,
    opacity: 0.8,
  },
});
