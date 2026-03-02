import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Platform, Easing } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { AgentAppearance, DEFAULT_APPEARANCE, EnvironmentType, THEME_OUTFITS } from '../../../../lib/officeConfig';
import ThoughtBubble from '../../../../components/ThoughtBubble';
import { ThoughtBubble as ThoughtData, generateThoughtBubble } from '../../../../lib/agentMessaging';

interface Props {
  agent: OfficeAgent;
  appearance?: AgentAppearance;
  environmentType?: EnvironmentType;
  onPress: () => void;
  selected: boolean;
  scale?: number;
  showThoughts?: boolean; // Enable thought bubbles
  dancing?: boolean; // Badge celebration dance
  xp?: number;       // current XP points
  xpNext?: number;   // XP needed for next badge
}

export default function PixelAgent({ agent, appearance, environmentType, onPress, selected, scale = 1, showThoughts = false, dancing = false, xp = 0, xpNext = 100 }: Props) {
  const a = appearance || { ...DEFAULT_APPEARANCE, shirtColor: agent.color, hairColor: agent.color };
  const outfit = environmentType ? THEME_OUTFITS[environmentType] : null;
  const showThemeHeadgear = outfit?.headgear && a.hat === 'none';
  const effectiveBootColor = outfit?.bootColor || a.shoeColor || '#1a1a1a';
  const bobAnim = useRef(new Animated.Value(0)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const danceX = useRef(new Animated.Value(0)).current;
  const danceY = useRef(new Animated.Value(0)).current;
  const danceRotate = useRef(new Animated.Value(0)).current;
  const danceScale = useRef(new Animated.Value(1)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const blinkAnim = useRef(new Animated.Value(1)).current; // 1 = open, 0 = closed
  const typingAnim = useRef(new Animated.Value(0)).current; // arm wiggle when building
  const lookAnim = useRef(new Animated.Value(0)).current; // subtle head shift when idle

  const [currentThought, setCurrentThought] = useState<ThoughtData | null>(null);
  const [floatingText, setFloatingText] = useState<{id: number, text: string, color: string, x: number}[]>([]);
  const [mood, setMood] = useState<string | null>(null); // emoji mood indicator
  const floatId = useRef(0);
  const lastCost = useRef(agent.costToday);
  const lastStatus = useRef(agent.status);
  const buildStartTime = useRef<number>(0);

  const handlePressIn = () => {
    Animated.spring(pressScale, { toValue: 0.9, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(pressScale, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();
  };

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
          Animated.timing(danceScale, { toValue: 1.35, duration: 120, useNativeDriver: true }),
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

  // Bob + breathe animation
  useEffect(() => {
    if (agent.status === 'active' || agent.status === 'idle') {
      const bobLoop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(bobAnim, { toValue: -2, duration: 1600, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
            Animated.timing(breatheAnim, { toValue: 1.04, duration: 1600, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          ]),
          Animated.parallel([
            Animated.timing(bobAnim, { toValue: 0, duration: 1600, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
            Animated.timing(breatheAnim, { toValue: 1, duration: 1600, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          ]),
        ])
      );
      bobLoop.start();
      return () => bobLoop.stop();
    }
  }, [agent.status]);

  // Glow animation
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

  // Eye blinking — periodic blink every 3-6s for alive agents
  useEffect(() => {
    if (agent.status === 'offline') return;
    const blink = () => {
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
      ]).start();
    };
    // Double-blink occasionally
    const doubleBlink = () => {
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.delay(120),
        Animated.timing(blinkAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
      ]).start();
    };
    const scheduleNext = () => {
      const delay = 3000 + Math.random() * 4000;
      return setTimeout(() => {
        Math.random() > 0.7 ? doubleBlink() : blink();
        timerId = scheduleNext();
      }, delay);
    };
    let timerId = scheduleNext();
    return () => clearTimeout(timerId);
  }, [agent.status === 'offline']);

  // Typing animation — arm wiggle when building/active
  useEffect(() => {
    if (agent.status === 'active' || agent.status === 'building') {
      const typingLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(typingAnim, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: -1, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: 0.5, duration: 200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: -0.5, duration: 200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
          Animated.delay(400),
        ])
      );
      typingLoop.start();
      return () => typingLoop.stop();
    } else {
      typingAnim.setValue(0);
    }
  }, [agent.status]);

  // Idle look-around — subtle head shift when idle
  useEffect(() => {
    if (agent.status === 'idle') {
      const lookLoop = Animated.loop(
        Animated.sequence([
          Animated.delay(3000),
          Animated.timing(lookAnim, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.delay(2000),
          Animated.timing(lookAnim, { toValue: -1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.delay(1500),
          Animated.timing(lookAnim, { toValue: 0, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );
      lookLoop.start();
      return () => lookLoop.stop();
    } else {
      lookAnim.setValue(0);
    }
  }, [agent.status]);

  // Mood indicator — reacts to agent activity
  const moodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const statusChanged = agent.status !== lastStatus.current;
    const costSpike = agent.costToday > lastCost.current + 0.10;
    let newMood: string | null = null;
    let moodDuration = 0;

    if (statusChanged) {
      if (agent.status === 'active' || agent.status === 'building') {
        buildStartTime.current = Date.now();
        newMood = '⚡'; moodDuration = 3000;
      } else if (agent.status === 'idle' && lastStatus.current === 'active') {
        newMood = '✅'; moodDuration = 4000;
      } else if (agent.status === 'offline') {
        newMood = '💤'; moodDuration = 0; // persist until status changes
      }
    }

    if (costSpike) {
      newMood = '🔥'; moodDuration = 3000;
    }

    if (newMood) {
      if (moodTimerRef.current) clearTimeout(moodTimerRef.current);
      setMood(newMood);
      if (moodDuration > 0) {
        moodTimerRef.current = setTimeout(() => setMood(null), moodDuration);
      }
    }

    return () => { if (moodTimerRef.current) clearTimeout(moodTimerRef.current); };
  }, [agent.status, agent.costToday]);

  // Thought bubble generation
  useEffect(() => {
    if (!showThoughts || currentThought) return;

    // Check for events
    const costSpike = agent.costToday > lastCost.current + 0.10;
    const statusChanged = agent.status !== lastStatus.current;
    const longIdle = agent.status === 'idle';

    // Spawn floating text on cost changes or status changes
    if (agent.costToday > lastCost.current && agent.costToday > 0) {
      const diff = agent.costToday - lastCost.current;
      if (diff > 0.001) {
        const id = floatId.current++;
        setFloatingText(prev => [...prev, { id, text: `-$${diff.toFixed(3)}`, color: '#ef4444', x: Math.random() * 20 - 10 }]);
        setTimeout(() => setFloatingText(prev => prev.filter(t => t.id !== id)), 2000);
      }
    }

    if (statusChanged && (agent.status === 'active' || agent.status === 'building')) {
      const id = floatId.current++;
      setFloatingText(prev => [...prev, { id, text: '+BUILD', color: '#22c55e', x: Math.random() * 20 - 10 }]);
      setTimeout(() => setFloatingText(prev => prev.filter(t => t.id !== id)), 2000);
    }

    lastCost.current = agent.costToday;
    lastStatus.current = agent.status;

    // Random thoughts every 8-20 seconds
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

    if (statusChanged || costSpike) {
      const thought = generateThoughtBubble(agent, thoughtCtx);
      if (thought) setCurrentThought(thought);
    }

    return () => clearTimeout(timer);
  }, [agent.costToday, agent.status, showThoughts, currentThought]);

  const statusColor = STATUS_COLORS[agent.status];
  const isOffline = agent.status === 'offline';
  const isWorking = agent.status === 'active' || agent.status === 'building';
  const PX = 2.5 * scale;

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : undefined}>
      <Animated.View style={[styles.container, {
          transform: [
            { translateX: danceX },
            { translateY: Animated.add(bobAnim, danceY) },
            { rotate: danceRotate.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }) },
            { scale: danceScale },
            { scale: pressScale },
          ],
        }]}>
        
        {/* Floating Gamified Text */}
        {floatingText.map(ft => (
          <FloatingText key={ft.id} text={ft.text} color={ft.color} xOffset={ft.x} />
        ))}

        {/* Thought bubble */}
        {showThoughts && currentThought && (
          <ThoughtBubble
            thought={currentThought}
            onDismiss={() => setCurrentThought(null)}
          />
        )}
        
        {selected && <View style={[styles.selectionRing, { borderColor: agent.color }]} />}

        {/* Active glow — pulsing backlight behind working agents */}
        {isWorking && !isOffline && (
          <Animated.View style={[styles.activeGlow, {
            backgroundColor: agent.color,
            opacity: glowAnim.interpolate({ inputRange: [0.3, 0.9], outputRange: [0.08, 0.2] }),
            transform: [{ scaleX: breatheAnim }],
          }]} />
        )}

        {/* Mood indicator — floating emoji above agent */}
        {mood && !isOffline && (
          <MoodBubble emoji={mood} />
        )}

        {/* Action Particles when building/active */}
        {(agent.status === 'active' || agent.status === 'building') && !isOffline && (
          <View style={styles.particlesContainer} pointerEvents="none">
            <Animated.View style={[styles.particle, { backgroundColor: agent.color, transform: [{ translateY: bobAnim.interpolate({ inputRange: [-2, 0], outputRange: [-20, 0] }) }], opacity: glowAnim }]} />
            <Animated.View style={[styles.particle, { left: 15, backgroundColor: agent.color, transform: [{ translateY: bobAnim.interpolate({ inputRange: [-2, 0], outputRange: [-10, 5] }) }], opacity: glowAnim }]} />
            <Animated.View style={[styles.particle, { right: 15, backgroundColor: agent.color, transform: [{ translateY: bobAnim.interpolate({ inputRange: [-2, 0], outputRange: [-15, 2] }) }], opacity: glowAnim }]} />
          </View>
        )}

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
        {a.hat === 'helmet' && (
          <View style={styles.helmet}>
            <View style={[styles.helmetDome, { backgroundColor: '#6b7280' }]} />
            <View style={styles.helmetVisor} />
          </View>
        )}
        {a.hat === 'horns' && (
          <View style={styles.hornsWrap}>
            <View style={[styles.horn, { borderBottomColor: '#b45309' }]} />
            <View style={{ width: PX * 4 }} />
            <View style={[styles.horn, { borderBottomColor: '#b45309' }]} />
          </View>
        )}
        {a.hat === 'space_helmet' && (
          <View style={styles.spaceHelmet}>
            <View style={styles.spaceHelmetDome} />
            <View style={styles.spaceHelmetVisor} />
          </View>
        )}
        {a.hat === 'wizard_hat' && (
          <View style={styles.wizardHat}>
            <View style={[styles.wizardHatTop, { borderBottomColor: '#6366f1' }]} />
            <View style={[styles.wizardHatBrim, { backgroundColor: '#6366f1' }]} />
            <View style={styles.wizardStar1} />
            <View style={styles.wizardStar2} />
          </View>
        )}
        {a.hat === 'halo' && (
          <View style={styles.haloRing} />
        )}
        {a.hat === 'antenna' && (
          <View style={styles.antennaWrap}>
            <View style={styles.antennaStalk} />
            <View style={styles.antennaBobble} />
          </View>
        )}

        {/* Theme headgear (only when user has no hat) */}
        {showThemeHeadgear && outfit.headgear === 'bandana' && (
          <View style={styles.bandana}>
            <View style={[styles.bandanaStrip, { backgroundColor: outfit.headgearColor }]} />
            <View style={[styles.bandanaTail, { backgroundColor: outfit.headgearColor }]} />
          </View>
        )}
        {showThemeHeadgear && outfit.headgear === 'visor' && (
          <View style={[styles.themeVisor, { backgroundColor: outfit.headgearColor }]} />
        )}
        {showThemeHeadgear && outfit.headgear === 'goggles' && (
          <View style={styles.gogglesWrap}>
            <View style={[styles.goggleLens, { borderColor: outfit.headgearColor }]} />
            <View style={[styles.goggleBridge, { backgroundColor: outfit.headgearColor }]} />
            <View style={[styles.goggleLens, { borderColor: outfit.headgearColor }]} />
          </View>
        )}
        {showThemeHeadgear && outfit.headgear === 'hood' && (
          <View style={[styles.themeHood, { backgroundColor: outfit.headgearColor }]} />
        )}
        {showThemeHeadgear && outfit.headgear === 'straw_hat' && (
          <View style={styles.strawHat}>
            <View style={[styles.strawHatDome, { backgroundColor: outfit.headgearColor }]} />
            <View style={[styles.strawHatBrim, { backgroundColor: outfit.headgearColor }]} />
          </View>
        )}
        {showThemeHeadgear && outfit.headgear === 'fur_hood' && (
          <View style={[styles.furHood, { backgroundColor: outfit.headgearColor }]}>
            <View style={styles.furTrim} />
          </View>
        )}
        {showThemeHeadgear && outfit.headgear === 'led_visor' && (
          <View style={[styles.ledVisor, { backgroundColor: outfit.headgearColor, shadowColor: outfit.headgearColor }]} />
        )}

        {/* Head — with look-around animation when idle */}
        <Animated.View style={[styles.head, isOffline && styles.offlineOpacity, {
          transform: [{ translateX: lookAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-1.5, 0, 1.5] }) }],
        }]}>
          {/* Ears */}
          <View style={[styles.ear, styles.earLeft, { backgroundColor: a.skinTone }]}>
            <View style={[styles.earInner, { backgroundColor: a.skinTone }]} />
          </View>
          <View style={[styles.ear, styles.earRight, { backgroundColor: a.skinTone }]}>
            <View style={[styles.earInner, { backgroundColor: a.skinTone }]} />
          </View>
          {/* Hair */}
          {a.hairStyle !== 'bald' && (
            <View style={[
              styles.hair,
              { backgroundColor: a.hairColor },
              a.hairStyle === 'spiky' && styles.hairSpiky,
              a.hairStyle === 'mohawk' && styles.hairMohawk,
              a.hairStyle === 'long' && styles.hairLong,
              a.hairStyle === 'curly' && styles.hairCurly,
              a.hairStyle === 'ponytail' && styles.hairPonytail,
            ]}>
              {/* Hair highlight — light hits from top-left */}
              <View style={styles.hairHighlight} />
            </View>
          )}
          {/* Bald head shine */}
          {a.hairStyle === 'bald' && (
            <View style={styles.baldShine} />
          )}
          {/* Ponytail tail */}
          {a.hairStyle === 'ponytail' && (
            <View style={[styles.ponytailTail, { backgroundColor: a.hairColor }]} />
          )}
          {/* Face */}
          <View style={[styles.face, { backgroundColor: a.skinTone }]}>
            {/* Brow ridge — subtle forehead depth */}
            <View style={styles.browRidge} />
            {/* Accessory: glasses */}
            {a.accessory === 'glasses' && (
              <View style={styles.glasses}>
                <View style={styles.glassLens} />
                <View style={styles.glassBridge} />
                <View style={styles.glassLens} />
              </View>
            )}
            {/* Expression brows */}
            {a.expression === 'focused' && (
              <View style={styles.browRow}>
                <View style={[styles.brow, { transform: [{ rotate: '-15deg' }] }]} />
                <View style={[styles.brow, { transform: [{ rotate: '15deg' }] }]} />
              </View>
            )}
            {a.expression === 'angry' && (
              <View style={styles.browRow}>
                <View style={[styles.brow, { transform: [{ rotate: '20deg' }], backgroundColor: '#1a1a1a' }]} />
                <View style={[styles.brow, { transform: [{ rotate: '-20deg' }], backgroundColor: '#1a1a1a' }]} />
              </View>
            )}
            {/* Eyes — with blink animation */}
            <Animated.View style={[styles.eyeRow, { transform: [{ scaleY: blinkAnim }] }]}>
              <View style={[styles.eye, isOffline && styles.closedEye, a.expression === 'cool' && styles.coolEye, a.expression === 'sleepy' && styles.sleepyEye]}>
                {!isOffline && a.expression !== 'sleepy' && (
                  <>
                    <View style={[styles.iris, { backgroundColor: a.eyeColor || '#3b82f6' }]}>
                      <View style={styles.pupil} />
                    </View>
                    <View style={styles.catchlight} />
                  </>
                )}
              </View>
              <View style={[styles.eye, isOffline && styles.closedEye, a.expression === 'cool' && styles.coolEye, a.expression === 'sleepy' && styles.sleepyEye]}>
                {!isOffline && a.expression !== 'sleepy' && (
                  <>
                    <View style={[styles.iris, { backgroundColor: a.eyeColor || '#3b82f6' }]}>
                      <View style={styles.pupil} />
                    </View>
                    <View style={styles.catchlight} />
                  </>
                )}
              </View>
            </Animated.View>
            {/* Sleepy z */}
            {a.expression === 'sleepy' && (
              <Text style={styles.sleepyZ}>z</Text>
            )}
            {/* Mouth */}
            <View style={[
              styles.mouth,
              isOffline && styles.sleepMouth,
              a.expression === 'happy' && styles.happyMouth,
              a.expression === 'angry' && styles.angryMouth,
            ]} />
            {/* Mask accessory */}
            {a.accessory === 'mask' && (
              <View style={styles.mask} />
            )}
            {a.accessory === 'monocle' && (
              <View style={styles.monocle}>
                <View style={styles.monocleFrame} />
                <View style={styles.monocleChain} />
              </View>
            )}
            {a.accessory === 'eyepatch' && (
              <View style={styles.accessoryEyePatch} />
            )}
            {a.accessory === 'bandana' && (
              <View style={styles.accessoryBandana} />
            )}
            {/* Theme extras on face */}
            {outfit?.extraElement === 'eye_patch' && (
              <View style={styles.eyePatch} />
            )}
            {outfit?.extraElement === 'scar' && (
              <View style={styles.scar} />
            )}
            {/* Nostril dots */}
            <View style={styles.nostrilRow}>
              <View style={[styles.nostril, { backgroundColor: a.skinTone + 'aa' }]} />
              <View style={[styles.nostril, { backgroundColor: a.skinTone + 'aa' }]} />
            </View>
            {/* Facial hair */}
            {(a.facialHair || 'none') === 'stubble' && (
              <View style={styles.stubbleRow}>
                {[0,1,2,3,4].map(i => (
                  <View key={i} style={[styles.stubbleDot, { backgroundColor: a.hairColor + '60' }]} />
                ))}
              </View>
            )}
            {(a.facialHair || 'none') === 'beard' && (
              <View style={[styles.beard, { backgroundColor: a.hairColor }]} />
            )}
            {(a.facialHair || 'none') === 'mustache' && (
              <View style={styles.mustacheRow}>
                <View style={[styles.mustacheHalf, { backgroundColor: a.hairColor, transform: [{ rotate: '15deg' }] }]} />
                <View style={[styles.mustacheHalf, { backgroundColor: a.hairColor, transform: [{ rotate: '-15deg' }] }]} />
              </View>
            )}
            {(a.facialHair || 'none') === 'goatee' && (
              <View style={[styles.goatee, { backgroundColor: a.hairColor }]} />
            )}
            {/* Cheek blush — happy expression */}
            {a.expression === 'happy' && !isOffline && (
              <>
                <View style={[styles.cheekBlush, styles.cheekL]} />
                <View style={[styles.cheekBlush, styles.cheekR]} />
              </>
            )}
            {/* Chin contour — adds jaw definition */}
            <View style={styles.chinContour} />
          </View>
        </Animated.View>

        {/* Accessory: headphones */}
        {a.accessory === 'headphones' && (
          <View style={styles.headphones}>
            <View style={styles.hpBand} />
            <View style={[styles.hpEar, { left: -2 }]} />
            <View style={[styles.hpEar, { right: -2 }]} />
          </View>
        )}

        {/* Scarf accessory — between head and body */}
        {a.accessory === 'scarf' && (
          <View style={styles.scarf}>
            <View style={[styles.scarfStrip, { backgroundColor: '#ef4444' }]} />
            <View style={[styles.scarfStrip, { backgroundColor: '#dc2626' }]} />
            <View style={[styles.scarfStrip, { backgroundColor: '#ef4444' }]} />
          </View>
        )}

        {/* Hoodie overlay */}
        {a.accessory === 'hoodie' && (
          <View style={[styles.hoodie, { backgroundColor: a.shirtColor }]} />
        )}

        {/* Back item — rendered behind body */}
        {a.backItem === 'cape' && (
          <View style={[styles.cape, { backgroundColor: a.shirtColor + 'cc', borderColor: a.shirtColor }]} />
        )}
        {a.backItem === 'backpack' && (
          <View style={styles.backpack}>
            <View style={[styles.backpackBody, { backgroundColor: '#6b7280' }]} />
          </View>
        )}
        {a.backItem === 'wings' && (
          <View style={styles.wingsWrap}>
            <View style={[styles.wing, styles.wingLeft, { borderBottomColor: '#a5b4fc60' }]} />
            <View style={[styles.wing, styles.wingRight, { borderBottomColor: '#a5b4fc60' }]} />
          </View>
        )}
        {a.backItem === 'jetpack' && (
          <View style={styles.jetpack}>
            <View style={styles.jetpackBody} />
            <View style={styles.jetpackNozzle} />
            <View style={styles.jetpackFlame} />
          </View>
        )}
        {a.backItem === 'shield' && (
          <View style={styles.shieldItem}>
            <View style={styles.shieldBody} />
            <View style={styles.shieldBoss} />
          </View>
        )}
        {a.backItem === 'sword' && (
          <View style={styles.swordItem}>
            <View style={styles.swordBlade} />
            <View style={styles.swordHilt} />
            <View style={styles.swordGuard} />
          </View>
        )}
        {a.backItem === 'quiver' && (
          <View style={styles.quiver}>
            <View style={styles.quiverBody} />
            <View style={styles.quiverArrow1} />
            <View style={styles.quiverArrow2} />
            <View style={styles.quiverArrow3} />
          </View>
        )}

        {/* Neck */}
        <View style={[styles.neck, { backgroundColor: a.skinTone }]}>
          <View style={styles.neckShadow} />
        </View>

        {/* Collar */}
        <View style={styles.collar}>
          <View style={[styles.collarPiece, { backgroundColor: a.shirtColor, transform: [{ rotate: '-20deg' }] }]} />
          <View style={[styles.collarPiece, { backgroundColor: a.shirtColor, transform: [{ rotate: '20deg' }] }]} />
        </View>

        {/* Body */}
        <Animated.View style={[styles.body, { backgroundColor: a.shirtColor, transform: [{ scaleX: breatheAnim }] }, isOffline && styles.offlineOpacity]}>
          {/* Body shading (directional light from top-left) */}
          <View style={styles.bodyShade} />
          {a.accessory === 'bowtie' && <View style={styles.bowtie} />}
          {/* Shirt buttons */}
          <View style={styles.shirtButtons}>
            <View style={[styles.button, { backgroundColor: a.shirtColor }]} />
            <View style={[styles.button, { backgroundColor: a.shirtColor }]} />
          </View>
          {/* Theme chest overlay */}
          {outfit?.chestOverlay === 'armor' && (
            <View style={[styles.chestArmor, { backgroundColor: outfit.chestColor }]} />
          )}
          {outfit?.chestOverlay === 'vest' && (
            <>
              <View style={[styles.vestStrip, styles.vestLeft, { backgroundColor: outfit.chestColor }]} />
              <View style={[styles.vestStrip, styles.vestRight, { backgroundColor: outfit.chestColor }]} />
            </>
          )}
          {outfit?.chestOverlay === 'apron' && (
            <View style={[styles.apron, { backgroundColor: outfit.chestColor }]} />
          )}
          {outfit?.chestOverlay === 'robe' && (
            <View style={[styles.robe, { backgroundColor: outfit.chestColor }]} />
          )}
          {outfit?.chestOverlay === 'parka' && (
            <View style={[styles.parka, { backgroundColor: outfit.chestColor }]} />
          )}
          {outfit?.chestOverlay === 'wetsuit' && (
            <View style={[styles.wetsuit, { backgroundColor: outfit.chestColor }]} />
          )}
          {/* Theme extras on body */}
          {outfit?.extraElement === 'pocket_watch' && (
            <View style={styles.pocketWatch} />
          )}
          {outfit?.extraElement === 'leaf_brooch' && (
            <View style={styles.leafBrooch} />
          )}
          {outfit?.extraElement === 'circuit_lines' && (
            <View style={styles.circuitLines}>
              <View style={[styles.circuitLine, { backgroundColor: outfit.accentColor }]} />
              <View style={[styles.circuitLine, styles.circuitLine2, { backgroundColor: outfit.accentColor }]} />
            </View>
          )}
          {outfit?.extraElement === 'oxygen_tube' && (
            <View style={styles.oxygenTube} />
          )}
          {/* Shirt pocket */}
          <View style={styles.shirtPocket} />
          {/* Left arm — typing wiggle when building */}
          <Animated.View style={[styles.arm, styles.leftArm, { backgroundColor: a.shirtColor,
            transform: [{ translateY: typingAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-1, 0, 1] }) }],
          }]}>
            <View style={styles.shoulderHighlight} />
            <View style={{ position: 'absolute', top: -1, left: -1, width: 2, height: 2, backgroundColor: a.shirtColor, opacity: 0.5, borderRadius: 1 }} />
            <View style={styles.armWrinkle} />
            <View style={[styles.wristCuff, { backgroundColor: a.shirtColor }]} />
            <View style={[styles.hand, { backgroundColor: outfit?.extraElement === 'gauntlets' ? (outfit.accentColor || '#6b7280') : a.skinTone }]}>
              <View style={styles.fingerLine} />
              <View style={[styles.fingerLine, styles.fingerLine2]} />
            </View>
          </Animated.View>
          {/* Right arm — opposite phase typing */}
          <Animated.View style={[styles.arm, styles.rightArm, { backgroundColor: a.shirtColor,
            transform: [{ translateY: typingAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, -1] }) }],
          }]}>
            <View style={styles.shoulderHighlight} />
            <View style={{ position: 'absolute', top: -1, left: -1, width: 2, height: 2, backgroundColor: a.shirtColor, opacity: 0.5, borderRadius: 1 }} />
            <View style={styles.armWrinkle} />
            <View style={[styles.wristCuff, { backgroundColor: a.shirtColor }]} />
            <View style={[styles.hand, { backgroundColor: outfit?.extraElement === 'gauntlets' ? (outfit.accentColor || '#6b7280') : a.skinTone }]}>
              <View style={styles.fingerLine} />
              <View style={[styles.fingerLine, styles.fingerLine2]} />
            </View>
          </Animated.View>
          {/* Hand item — rendered at right arm position */}
          {(a.handItem || 'none') === 'lightsaber' && (
            <View style={styles.handLightsaber}>
              <View style={[styles.lightsaberBlade, { backgroundColor: agent.color + 'cc', shadowColor: agent.color }]} />
              <View style={styles.lightsaberHilt} />
            </View>
          )}
          {(a.handItem || 'none') === 'coffee' && (
            <View style={styles.handCoffee}>
              <View style={styles.handCoffeeBody} />
              <View style={styles.handCoffeeHandle} />
            </View>
          )}
          {(a.handItem || 'none') === 'laptop' && (
            <View style={styles.handLaptop}>
              <View style={styles.handLaptopScreen} />
              <View style={styles.handLaptopBase} />
            </View>
          )}
          {(a.handItem || 'none') === 'flag' && (
            <View style={styles.handFlag}>
              <View style={styles.handFlagPole} />
              <View style={[styles.handFlagCloth, { backgroundColor: agent.color + '80' }]} />
            </View>
          )}
          {(a.handItem || 'none') === 'wand' && (
            <View style={styles.handWand}>
              <View style={styles.handWandStick} />
              <View style={styles.handWandSpark} />
            </View>
          )}
        </Animated.View>

        {/* Belt */}
        <View style={[styles.belt, { backgroundColor: outfit?.beltColor || '#1a1a1a' }]}>
          {/* Belt buckle */}
          <View style={styles.beltBuckle} />
          {outfit?.beltStyle === 'utility' && (
            <>
              <View style={styles.beltPouch} />
              <View style={[styles.beltPouch, { right: PX * 1 }]} />
            </>
          )}
          {outfit?.beltStyle === 'rope' && (
            <View style={[styles.ropeBelt, { backgroundColor: outfit.beltColor }]} />
          )}
        </View>

        {/* Legs */}
        <View style={[styles.legs, isOffline && styles.offlineOpacity]}>
          <View style={[styles.leg, { backgroundColor: a.pantsColor }]}>
            <View style={styles.kneeShadow} />
            <View style={styles.pantCuff} />
          </View>
          <View style={[styles.leg, { backgroundColor: a.pantsColor }]}>
            <View style={styles.kneeShadow} />
            <View style={styles.pantCuff} />
          </View>
        </View>

        {/* Shoes */}
        <View style={styles.shoes}>
          <View style={[styles.shoe, { backgroundColor: effectiveBootColor }]}>
            <View style={styles.shoeToeCap} />
            <View style={styles.shoeSole} />
          </View>
          <View style={[styles.shoe, { backgroundColor: effectiveBootColor }]}>
            <View style={styles.shoeToeCap} />
            <View style={styles.shoeSole} />
          </View>
        </View>

        {/* Drop shadow */}
        <Animated.View style={[styles.dropShadow, {
          transform: [
            { scaleX: bobAnim.interpolate({ inputRange: [-2, 0], outputRange: [0.8, 1] }) },
            { scaleY: bobAnim.interpolate({ inputRange: [-2, 0], outputRange: [0.8, 1] }) }
          ],
          opacity: bobAnim.interpolate({ inputRange: [-2, 0], outputRange: [0.4, 0.7] })
        }]} />

        {/* Pet companion */}
        {(a.pet || 'none') === 'cat' && (
          <View style={styles.petCat}>
            <View style={styles.catBody} />
            <View style={styles.catBelly} />
            <View style={styles.catHead}>
              <View style={styles.catEyeLeft} />
              <View style={styles.catEyeRight} />
              <View style={styles.catNose} />
              <View style={[styles.catEar, styles.catEarL]} />
              <View style={[styles.catEar, styles.catEarR]} />
            </View>
            <View style={styles.catTail} />
          </View>
        )}
        {(a.pet || 'none') === 'dog' && (
          <View style={styles.petDog}>
            <View style={styles.dogBody} />
            <View style={styles.dogBelly} />
            <View style={styles.dogHead}>
              <View style={styles.dogSnout} />
              <View style={styles.dogNose} />
              <View style={styles.dogEyeLeft} />
              <View style={styles.dogEyeRight} />
              <View style={[styles.dogEar, styles.dogEarL]} />
              <View style={[styles.dogEar, styles.dogEarR]} />
            </View>
            <View style={styles.dogTail} />
          </View>
        )}
        {(a.pet || 'none') === 'bird' && (
          <View style={styles.petBird}>
            <View style={styles.birdBody} />
            <View style={styles.birdWing} />
            <View style={styles.birdBeak} />
          </View>
        )}
        {(a.pet || 'none') === 'robot' && (
          <View style={styles.petRobot}>
            <View style={styles.robotBody}>
              <View style={[styles.robotEye, { left: PX * 0.3 }]} />
              <View style={[styles.robotEye, { right: PX * 0.3 }]} />
            </View>
            <View style={styles.robotAntenna} />
            <View style={styles.robotAntennaDot} />
          </View>
        )}
        {(a.pet || 'none') === 'dragon' && (
          <View style={styles.petDragon}>
            <View style={styles.dragonBody} />
            <View style={styles.dragonHead}>
              <View style={styles.dragonEye} />
            </View>
            <View style={styles.dragonWingL} />
            <View style={styles.dragonWingR} />
            <View style={styles.dragonTail} />
          </View>
        )}
        {(a.pet || 'none') === 'alien' && (
          <View style={styles.petAlien}>
            <View style={styles.alienBody} />
            <View style={styles.alienHead}>
              <View style={[styles.alienEye, { left: PX * 0.2 }]} />
              <View style={[styles.alienEye, { right: PX * 0.2 }]} />
            </View>
            <View style={styles.alienAntennaPart} />
          </View>
        )}

        {/* Aura effects */}
        {(a.aura || 'none') === 'fire' && (
          <View style={styles.auraFire}>
            <View style={styles.flame1} />
            <View style={styles.flame2} />
            <View style={styles.flame3} />
          </View>
        )}
        {(a.aura || 'none') === 'ice' && (
          <View style={styles.auraIce}>
            <View style={styles.iceFlake1} />
            <View style={styles.iceFlake2} />
            <View style={styles.iceFlake3} />
          </View>
        )}
        {(a.aura || 'none') === 'electric' && (
          <View style={styles.auraElectric}>
            <View style={styles.bolt1} />
            <View style={styles.bolt2} />
          </View>
        )}
        {(a.aura || 'none') === 'nature' && (
          <View style={styles.auraNature}>
            <View style={styles.leaf1} />
            <View style={styles.leaf2} />
            <View style={styles.leaf3} />
          </View>
        )}
        {(a.aura || 'none') === 'shadow' && (
          <View style={styles.auraShadow} />
        )}
        {(a.aura || 'none') === 'rainbow' && (
          <View style={styles.auraRainbow}>
            <View style={[styles.rainbowArc, { backgroundColor: '#ef444450', top: 0 }]} />
            <View style={[styles.rainbowArc, { backgroundColor: '#f59e0b50', top: PX * 0.6 }]} />
            <View style={[styles.rainbowArc, { backgroundColor: '#22c55e50', top: PX * 1.2 }]} />
            <View style={[styles.rainbowArc, { backgroundColor: '#3b82f650', top: PX * 1.8 }]} />
            <View style={[styles.rainbowArc, { backgroundColor: '#8b5cf650', top: PX * 2.4 }]} />
          </View>
        )}
        {(a.aura || 'none') === 'glitch' && (
          <View style={styles.auraGlitch}>
            <View style={[styles.glitchRect, { backgroundColor: '#ef444460', left: -PX, top: PX * 1, width: PX * 3, height: PX * 0.8 }]} />
            <View style={[styles.glitchRect, { backgroundColor: '#3b82f660', right: -PX * 0.5, top: PX * 3, width: PX * 2.5, height: PX * 0.6 }]} />
            <View style={[styles.glitchRect, { backgroundColor: '#22c55e60', left: PX * 0.5, top: PX * 5, width: PX * 2, height: PX * 0.5 }]} />
          </View>
        )}
        {(a.aura || 'none') === 'cosmic' && (
          <View style={styles.auraCosmic}>
            <View style={styles.cosmicStar1} />
            <View style={styles.cosmicStar2} />
            <View style={styles.cosmicStar3} />
            <View style={styles.cosmicStar4} />
            <View style={styles.cosmicStar5} />
          </View>
        )}

        {/* Name label */}
        <View style={styles.nameContainer}>
          <Text style={[styles.name, { color: agent.color }]} numberOfLines={1}>{agent.name}</Text>
        </View>

        {/* XP bar */}
        <XPBar xp={xp} xpNext={xpNext} color={agent.color} />
      </Animated.View>
    </Pressable>
  );
}

// ── XP BAR ───────────────────────────────────────────────────────────────

function XPBar({ xp, xpNext, color }: { xp: number; xpNext: number; color: string }) {
  const pct = Math.min(100, xpNext > 0 ? Math.round((xp / xpNext) * 100) : 0);
  const isFull = pct >= 100;

  // Pulse glow animation always running
  const pulseAnim = useRef(new Animated.Value(0)).current;
  // Rainbow shift for full bar (web only via CSS, native via hue cycle)
  const rainbowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (!isFull) return;
    Animated.loop(
      Animated.timing(rainbowAnim, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: false })
    ).start();
    return () => rainbowAnim.stopAnimation();
  }, [isFull]);

  // Glow opacity: stronger when full
  const glowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isFull ? [0.7, 1] : [0.2, 0.55],
  });

  // For non-web: animate fill color through rainbow segments when full
  const fillColor = isFull
    ? rainbowAnim.interpolate({
        inputRange: [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1],
        outputRange: ['#ff0080', '#ff8c00', '#ffe600', '#00ff88', '#00cfff', '#a855f7', '#ff0080'],
      })
    : color;

  // Glow color behind bar when full
  const glowColor = isFull ? '#ffffff' : color;

  if (Platform.OS === 'web') {
    // Web: inject a CSS keyframe animation for true rainbow gradient
    const styleId = 'xp-rainbow-style';
    if (isFull && !document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes xp-rainbow {
          0%   { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .xp-fill-rainbow {
          background: linear-gradient(90deg, #ff0080, #ff8c00, #ffe600, #00ff88, #00cfff, #a855f7, #ff0080);
          background-size: 200% 100%;
          animation: xp-rainbow 1.8s linear infinite;
        }
        .xp-fill-rainbow-glow {
          box-shadow: 0 0 6px 2px rgba(255,255,255,0.8), 0 0 12px 4px rgba(168,85,247,0.6);
        }
      `;
      document.head.appendChild(style);
    }

    return (
      <View style={xpStyles.outer}>
        {/* Glow behind the track */}
        {pct > 0 && (
          <Animated.View style={[
            xpStyles.glow,
            {
              width: `${pct}%` as any,
              backgroundColor: glowColor,
              opacity: glowOpacity,
            },
          ]} />
        )}
        {/* Track */}
        <View style={xpStyles.track}>
          {pct > 0 && (
            <View
              style={[
                xpStyles.fill,
                isFull ? { width: '100%' } : { width: `${pct}%` as any, backgroundColor: color },
              ] as any}
              // @ts-ignore web-only className
              className={isFull ? 'xp-fill-rainbow xp-fill-rainbow-glow' : undefined}
            />
          )}
        </View>
        {/* XP label */}
        <Text style={[xpStyles.label, isFull && xpStyles.labelFull]}>
          {isFull ? '✦ MAX ✦' : `${pct}%`}
        </Text>
      </View>
    );
  }

  // Native
  return (
    <View style={xpStyles.outer}>
      {pct > 0 && (
        <Animated.View style={[xpStyles.glow, { width: `${pct}%` as any, backgroundColor: glowColor, opacity: glowOpacity }]} />
      )}
      <View style={xpStyles.track}>
        {pct > 0 && (
          <Animated.View style={[xpStyles.fill, { width: `${pct}%` as any, backgroundColor: fillColor as any }]} />
        )}
      </View>
      <Text style={[xpStyles.label, isFull && xpStyles.labelFull]}>
        {isFull ? '✦ MAX ✦' : `${pct}%`}
      </Text>
    </View>
  );
}

const xpStyles = StyleSheet.create({
  outer: { width: 44, alignItems: 'flex-start', marginTop: 3 },
  glow: {
    position: 'absolute',
    top: 2,
    left: 0,
    height: 5,
    borderRadius: 3,
    // blur not supported natively, but opacity pulse creates the effect
  },
  track: {
    width: 44,
    height: 5,
    backgroundColor: '#111827',
    borderRadius: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2d3748',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  label: {
    fontSize: 5,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#6b7280',
    marginTop: 1,
    alignSelf: 'center',
  },
  labelFull: {
    color: '#a855f7',
    fontSize: 6,
  },
});

const PX = 2.5;


// ── FLOATING TEXT ────────────────────────────────────────────────────────

function FloatingText({ text, color, xOffset }: { text: string; color: string; xOffset: number }) {
  const animY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(animY, { toValue: -30, duration: 1500, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(opacity, { toValue: 0, duration: 1500, useNativeDriver: true, delay: 500 }),
    ]).start();
  }, []);

  return (
    <Animated.Text style={{
      position: 'absolute',
      top: -10,
      left: 10 + xOffset,
      color,
      fontSize: 8,
      fontWeight: '900',
      fontFamily: 'monospace',
      textShadowColor: '#000000',
      textShadowOffset: { width: 1, height: 1 },
      textShadowRadius: 1,
      zIndex: 20,
      transform: [{ translateY: animY }],
      opacity,
    }}>
      {text}
    </Animated.Text>
  );
}

// ── MOOD BUBBLE ──────────────────────────────────────────────────────────

function MoodBubble({ emoji }: { emoji: string }) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(floatAnim, { toValue: -3, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(floatAnim, { toValue: 0, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        ])
      ),
    ]).start();
  }, []);

  return (
    <Animated.View style={{
      position: 'absolute',
      top: -16,
      right: -2,
      zIndex: 25,
      transform: [{ scale: scaleAnim }, { translateY: floatAnim }],
    }}>
      <View style={{
        backgroundColor: '#0d0d14',
        borderRadius: 8,
        paddingHorizontal: 3,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: '#1a1a2e',
      }}>
        <Text style={{ fontSize: 9 }}>{emoji}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({

  container: {
    alignItems: 'center',
    width: 60,
    height: 92,
    position: 'relative',
  },
  selectionRing: {
    position: 'absolute',
    top: 8,
    left: 6,
    right: 6,
    bottom: 24,
    borderWidth: 1.5,
    borderRadius: 3,
    borderStyle: 'dashed',
  },
  activeGlow: {
    position: 'absolute',
    top: 10,
    left: 4,
    right: 4,
    bottom: 26,
    borderRadius: 6,
    zIndex: -1,
  },

  // Action Particles
  particlesContainer: { position: 'absolute', top: -10, left: 0, right: 0, height: 20, zIndex: 1 },
  particle: { position: 'absolute', bottom: 0, left: PX*3, width: PX*0.8, height: PX*0.8, borderRadius: PX*0.4, opacity: 0.8 },

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
  hatEmoji: { fontSize: 8, marginBottom: -8, zIndex: 5 },
  cap: {
    width: PX * 8,
    height: PX * 2,
    borderRadius: 2,
    marginBottom: -6,
    zIndex: 5,
  },
  tophat: { alignItems: 'center', marginBottom: -6, zIndex: 5 },
  tophatTop: { width: PX * 5, height: PX * 4, borderRadius: 1 },
  tophatBrim: { width: PX * 8, height: PX * 1.5 },
  beanie: {
    width: PX * 8,
    height: PX * 3,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    marginBottom: -6,
    zIndex: 5,
  },
  // Head
  head: {
    width: PX * 7,
    height: PX * 7,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#1e1b4b30',
    borderRadius: 1,
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
  hairCurly: { borderRadius: PX * 2, height: PX * 3.5, width: PX * 8 },
  hairPonytail: { borderTopLeftRadius: 2, borderTopRightRadius: 2, height: PX * 2.5 },
  ponytailTail: {
    position: 'absolute',
    top: 18,
    right: 2,
    width: PX * 2,
    height: PX * 5,
    borderBottomRightRadius: 4,
    borderTopRightRadius: 1,
  },
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
  eye: { width: PX * 1.2, height: PX * 1.5, position: 'relative', backgroundColor: '#ffffff', borderRadius: 1, overflow: 'hidden' },
  iris: { position: 'absolute', bottom: 0, right: 0, width: PX * 1, height: PX * 1.2, borderRadius: 1 },
  pupil: { position: 'absolute', top: '20%', left: '20%', width: PX * 0.5, height: PX * 0.5, backgroundColor: '#000000', borderRadius: PX * 0.25 },
  catchlight: { position: 'absolute', top: 0.5, right: 0.5, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#ffffff', borderRadius: PX * 0.2 },
  closedEye: { height: 0.8, width: PX * 1.4, backgroundColor: '#1e1b4b', alignSelf: 'center', marginTop: PX * 0.5 },
  coolEye: { height: PX * 0.8, width: PX * 1.4, alignSelf: 'center', marginTop: PX * 0.3 },
  sleepyEye: { height: PX * 0.4, width: PX * 1.4, borderRadius: 1, alignSelf: 'center', marginTop: PX * 0.6 },
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
  angryMouth: {
    width: PX * 1.8,
    height: PX * 0.5,
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  // Expression brows
  browRow: { position: 'absolute', top: -1, flexDirection: 'row', gap: PX * 1.2 },
  brow: { width: PX * 1.5, height: 1.5, backgroundColor: '#555' },
  sleepyZ: { position: 'absolute', top: -4, right: -2, fontSize: 5, fontWeight: '800', color: '#6b728080', fontFamily: 'monospace' },
  // Mask
  mask: {
    position: 'absolute',
    bottom: 0,
    width: PX * 6,
    height: PX * 2.5,
    backgroundColor: '#1a1a1a',
    borderRadius: 1,
  },
  // Ears
  ear: {
    position: 'absolute',
    width: PX * 1.2,
    height: PX * 1.5,
    borderRadius: PX * 0.6,
    top: PX * 3.5,
    zIndex: -1,
  },
  earLeft: { left: -PX * 0.5 },
  earRight: { right: -PX * 0.5 },
  // Collar
  collar: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: -1,
    marginBottom: 0,
    zIndex: 2,
    gap: 1,
  },
  collarPiece: {
    width: PX * 2,
    height: PX * 1.2,
    borderRadius: 1,
  },
  // Body
  body: {
    width: PX * 7,
    height: PX * 5,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1e1b4b30',
  },
  bodyShade: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: PX * 1.5,
    height: PX * 5,
    backgroundColor: '#00000012',
  },
  shirtButtons: {
    position: 'absolute',
    top: PX * 1,
    left: PX * 3,
    gap: PX * 1.2,
  },
  button: {
    width: PX * 0.6,
    height: PX * 0.6,
    borderRadius: PX * 0.3,
    borderWidth: 0.5,
    borderColor: '#1e1b4b50',
  },
  hand: {
    position: 'absolute',
    bottom: -1,
    width: PX * 1.8,
    height: PX * 1.5,
    borderRadius: PX * 0.7,
    alignSelf: 'center',
  },
  // Belt
  belt: {
    width: PX * 7,
    height: PX * 0.7,
    marginTop: 0,
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
  legs: { flexDirection: 'row', gap: PX * 0.7 },
  leg: { width: PX * 2.8, height: PX * 3, position: 'relative' },
  // Shoes
  shoes: { flexDirection: 'row', gap: PX * 0.7, marginTop: -1 },
  shoe: { width: PX * 3, height: PX * 1.2, borderRadius: 1, position: 'relative' },
  // Drop shadow
  dropShadow: { width: PX * 7, height: PX * 1.2, backgroundColor: '#312e8125', borderRadius: PX * 3, marginTop: 2 },
  // Scarf
  scarf: { flexDirection: 'row', marginTop: -1, marginBottom: -1, zIndex: 3 },
  scarfStrip: { width: PX * 2.3, height: PX * 1 },
  // Hoodie
  hoodie: {
    position: 'absolute',
    top: 6,
    width: PX * 8,
    height: PX * 3,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    zIndex: 4,
    opacity: 0.85,
  },
  // Back items
  cape: {
    position: 'absolute',
    top: 32,
    left: 8,
    width: PX * 8,
    height: PX * 9,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    borderWidth: 1,
    zIndex: -1,
  },
  backpack: {
    position: 'absolute',
    top: 30,
    right: 4,
    zIndex: -1,
  },
  backpackBody: {
    width: PX * 3.5,
    height: PX * 4,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  wingsWrap: {
    position: 'absolute',
    top: 30,
    flexDirection: 'row',
    zIndex: -1,
  },
  wing: {
    width: 0,
    height: 0,
    borderLeftWidth: PX * 3,
    borderRightWidth: PX * 3,
    borderBottomWidth: PX * 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  wingLeft: { marginRight: PX * 2 },
  wingRight: { marginLeft: PX * 2 },
  // Helmet
  helmet: { alignItems: 'center', marginBottom: -6, zIndex: 5 },
  helmetDome: {
    width: PX * 8,
    height: PX * 4,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  helmetVisor: {
    width: PX * 7,
    height: PX * 1,
    backgroundColor: '#1f293780',
    marginTop: -1,
  },
  // Horns
  hornsWrap: { flexDirection: 'row', marginBottom: -8, zIndex: 5 },
  horn: {
    width: 0,
    height: 0,
    borderLeftWidth: PX * 1,
    borderRightWidth: PX * 1,
    borderBottomWidth: PX * 2.5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  // Name
  nameContainer: { alignItems: 'center', marginTop: 2 },
  name: {
    fontSize: 7,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  offlineOpacity: { opacity: 0.4 },


  // --- INJECTED HI-RES PIXEL ART STYLES ---
  bodyHighlight: { position: 'absolute', top: 0, left: PX*0.5, width: PX*2, height: PX*1, backgroundColor: '#fef08a35', borderRadius: 1 },
  bodyCoreShadow: { position: 'absolute', bottom: 0, left: 0, width: '100%', height: PX*1.5, backgroundColor: '#312e8130' },
  bodyAmbientOcclusion: { position: 'absolute', top: 0, left: 0, width: '100%', height: PX*0.5, backgroundColor: '#312e8115' },
  
  faceHighlight: { position: 'absolute', top: PX*0.5, left: PX*1, width: PX*2, height: PX*1, backgroundColor: '#fef08a35', borderRadius: PX*0.5 },
  faceShadow: { position: 'absolute', bottom: 0, left: 0, width: '100%', height: PX*1, backgroundColor: '#312e8125', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  faceAmbientGlow: { position: 'absolute', top: '50%', left: PX*0.5, width: PX*1, height: PX*1, backgroundColor: '#ef444410', borderRadius: PX*0.5 },
  
  armShadow: { position: 'absolute', bottom: 0, left: 0, width: '100%', height: PX*1.5, backgroundColor: '#312e8135' },
  armShadowRight: { position: 'absolute', bottom: 0, left: 0, width: '100%', height: PX*1.5, backgroundColor: '#312e8140' },
  
  legHighlight: { position: 'absolute', top: 0, left: PX*0.2, width: PX*0.6, height: PX*2, backgroundColor: '#fef08a20' },
  legShadow: { position: 'absolute', right: 0, top: 0, width: PX*0.8, height: '100%', backgroundColor: '#312e8130' },
  
  shoeHighlight: { position: 'absolute', top: PX*0.2, left: PX*0.4, width: PX*1, height: PX*0.4, backgroundColor: '#ffffff20', borderRadius: 1 },
  shoeShadow: { position: 'absolute', right: 0, top: 0, width: PX*1, height: '100%', backgroundColor: '#312e8135' },
  shoeLaces: { position: 'absolute', top: PX*0.2, left: PX*1.5, width: PX*1, height: PX*0.5, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#ffffff30' },
  
  catBelly: { position: 'absolute', bottom: 0, left: PX*0.5, width: PX*1.5, height: PX*0.8, backgroundColor: '#ffffff40', borderRadius: PX*0.4 },
  catEyeLeft: { position: 'absolute', top: PX*0.5, left: PX*0.3, width: PX*0.3, height: PX*0.4, backgroundColor: '#22c55e', borderRadius: PX*0.2 },
  catEyeRight: { position: 'absolute', top: PX*0.5, right: PX*0.3, width: PX*0.3, height: PX*0.4, backgroundColor: '#22c55e', borderRadius: PX*0.2 },
  catNose: { position: 'absolute', top: PX*0.8, left: PX*0.6, width: PX*0.3, height: PX*0.2, backgroundColor: '#ef4444', borderRadius: PX*0.1 },

  dogBelly: { position: 'absolute', bottom: 0, left: PX*0.5, width: PX*2, height: PX*1, backgroundColor: '#ffffff30', borderRadius: PX*0.5 },
  dogSnout: { position: 'absolute', bottom: 0, left: PX*0.4, width: PX*1.2, height: PX*1, backgroundColor: '#ffffff40', borderRadius: PX*0.4 },
  dogNose: { position: 'absolute', bottom: PX*0.8, left: PX*0.8, width: PX*0.4, height: PX*0.3, backgroundColor: '#1a1a1a', borderRadius: PX*0.2 },
  dogEyeLeft: { position: 'absolute', top: PX*0.5, left: PX*0.4, width: PX*0.3, height: PX*0.3, backgroundColor: '#1a1a1a', borderRadius: PX*0.15 },
  dogEyeRight: { position: 'absolute', top: PX*0.5, right: PX*0.4, width: PX*0.3, height: PX*0.3, backgroundColor: '#1a1a1a', borderRadius: PX*0.15 },

  // ── Theme Headgear ──────────────────────────────────────────────
  // Bandana
  bandana: { alignItems: 'center', marginBottom: -6, zIndex: 5 },
  bandanaStrip: { width: PX * 8, height: PX * 1.5, borderRadius: 1 },
  bandanaTail: { position: 'absolute', right: -PX * 1, top: PX * 0.5, width: PX * 2, height: PX * 3, borderBottomRightRadius: 3 },
  // Visor
  themeVisor: { width: PX * 8, height: PX * 1.5, marginBottom: -5, zIndex: 5, opacity: 0.6, borderRadius: 1 },
  // Goggles
  gogglesWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: -7, zIndex: 6, gap: 1 },
  goggleLens: { width: PX * 2.5, height: PX * 2, borderWidth: 1.5, borderRadius: PX, backgroundColor: '#fef08a20' },
  goggleBridge: { width: PX * 1, height: 2 },
  // Hood
  themeHood: { width: PX * 9, height: PX * 4, borderTopLeftRadius: 8, borderTopRightRadius: 8, marginBottom: -7, zIndex: 4, opacity: 0.85 },
  // Straw hat
  strawHat: { alignItems: 'center', marginBottom: -6, zIndex: 5 },
  strawHatDome: { width: PX * 6, height: PX * 2.5, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  strawHatBrim: { width: PX * 10, height: PX * 1.2, borderRadius: 1, marginTop: -1 },
  // Fur hood
  furHood: { width: PX * 9, height: PX * 4, borderTopLeftRadius: 8, borderTopRightRadius: 8, marginBottom: -7, zIndex: 4 },
  furTrim: { position: 'absolute', bottom: 0, width: '100%' as any, height: PX * 1, backgroundColor: '#f5f5dc', borderRadius: 1 },
  // LED visor
  ledVisor: { width: PX * 8, height: PX * 1.2, marginBottom: -5, zIndex: 6, borderRadius: 1, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4 },

  // ── Theme Chest Overlays ────────────────────────────────────────
  chestArmor: { position: 'absolute', top: 0, left: PX * 0.5, width: PX * 6, height: PX * 4, borderRadius: 2, opacity: 0.75, zIndex: 1 },
  vestStrip: { position: 'absolute', top: 0, width: PX * 1.8, height: PX * 5, opacity: 0.7, zIndex: 1 },
  vestLeft: { left: 0 },
  vestRight: { right: 0 },
  apron: { position: 'absolute', top: PX * 0.5, left: PX * 1.5, width: PX * 4, height: PX * 4.5, borderRadius: 1, opacity: 0.8, zIndex: 1 },
  robe: { position: 'absolute', top: 0, left: 0, width: PX * 7, height: PX * 5, opacity: 0.6, zIndex: 1 },
  parka: { position: 'absolute', top: -1, left: -PX * 0.5, width: PX * 8, height: PX * 5.5, borderRadius: 3, opacity: 0.7, zIndex: 1 },
  wetsuit: { position: 'absolute', top: 0, left: 0, width: PX * 7, height: PX * 5, opacity: 0.5, zIndex: 1 },

  // ── Theme Extras ────────────────────────────────────────────────
  eyePatch: { position: 'absolute', top: PX * 0.5, left: PX * 0.8, width: PX * 2, height: PX * 1.8, backgroundColor: '#1a1a1a', borderRadius: PX * 0.5, zIndex: 2 },
  scar: { position: 'absolute', top: PX * 0.5, right: PX * 1, width: PX * 0.5, height: PX * 3, backgroundColor: '#dc262640', borderRadius: 1, transform: [{ rotate: '15deg' }], zIndex: 2 },
  pocketWatch: { position: 'absolute', top: PX * 1.5, right: PX * 1, width: PX * 1, height: PX * 1, backgroundColor: '#d4a017', borderRadius: PX * 0.5, zIndex: 2 },
  leafBrooch: { position: 'absolute', top: PX * 0.5, right: PX * 1.5, width: PX * 1.2, height: PX * 1.2, backgroundColor: '#22c55e', borderRadius: PX * 0.6, zIndex: 2 },
  circuitLines: { position: 'absolute', top: PX * 1, left: PX * 1, zIndex: 2 },
  circuitLine: { width: PX * 5, height: 1, marginBottom: PX * 1.5, opacity: 0.7 },
  circuitLine2: { width: PX * 3, marginLeft: PX * 1 },
  oxygenTube: { position: 'absolute', top: 0, right: -PX * 0.5, width: PX * 0.5, height: PX * 5, backgroundColor: '#6b728060', borderRadius: 1, zIndex: 2 },
  // Belt extras
  beltPouch: { position: 'absolute', top: -PX * 0.5, left: PX * 1, width: PX * 1.2, height: PX * 1, backgroundColor: '#4b5563', borderRadius: 1 },
  ropeBelt: { width: PX * 7, height: PX * 0.8, borderRadius: PX * 0.4, opacity: 0.7 },

  // ── Ear inner detail ──────────────────────────────────────────
  earInner: { position: 'absolute', top: PX * 0.4, left: PX * 0.2, width: PX * 0.6, height: PX * 0.7, borderRadius: PX * 0.3, backgroundColor: '#312e8115' },

  // ── Hair highlight (lighting from top-left) ─────────────────
  hairHighlight: { position: 'absolute', top: 0, left: PX * 0.5, width: PX * 2, height: PX * 0.8, backgroundColor: '#ffffff12', borderRadius: 1 },
  baldShine: { position: 'absolute', top: PX * 0.8, left: PX * 2.5, width: PX * 1.5, height: PX * 0.5, backgroundColor: '#ffffff10', borderRadius: PX * 0.5, zIndex: 2 },

  // ── Brow ridge ──────────────────────────────────────────────
  browRidge: { width: PX * 6, height: PX * 0.3, backgroundColor: '#00000008', marginBottom: 1 },

  // ── Cheek blush (happy expression) ──────────────────────────
  cheekBlush: { position: 'absolute', width: PX * 1.2, height: PX * 0.8, backgroundColor: '#ef444418', borderRadius: PX * 0.6 },
  cheekL: { left: PX * 0.2, bottom: PX * 1.2 },
  cheekR: { right: PX * 0.2, bottom: PX * 1.2 },

  // ── Chin contour ────────────────────────────────────────────
  chinContour: { position: 'absolute', bottom: 0, width: PX * 5, height: PX * 0.3, backgroundColor: '#00000008', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, alignSelf: 'center' },

  // ── Neck ────────────────────────────────────────────────────
  neck: { width: PX * 4, height: PX * 1, marginTop: -1, zIndex: 1 },
  neckShadow: { position: 'absolute', bottom: 0, width: PX * 4, height: PX * 0.3, backgroundColor: '#00000015' },

  // ── Shirt pocket ────────────────────────────────────────────
  shirtPocket: { position: 'absolute', top: PX * 0.8, left: PX * 0.8, width: PX * 1.8, height: PX * 1.5, borderWidth: 0.5, borderColor: '#00000015', borderRadius: 0.5, zIndex: 2 },

  // ── Arm wrinkle ─────────────────────────────────────────────
  armWrinkle: { position: 'absolute', top: PX * 2, left: 0, right: 0, height: PX * 0.3, backgroundColor: '#00000008' },

  // ── Wrist cuff ──────────────────────────────────────────────
  wristCuff: { position: 'absolute', bottom: PX * 1.2, left: 0, right: 0, height: PX * 0.5, borderTopWidth: 0.5, borderTopColor: '#00000015' },

  // ── Finger lines on hand ────────────────────────────────────
  fingerLine: { position: 'absolute', bottom: PX * 0.3, left: PX * 0.3, width: PX * 1, height: 0.5, backgroundColor: '#00000012' },
  fingerLine2: { left: PX * 0.7, bottom: PX * 0.6 },

  // ── Belt buckle ─────────────────────────────────────────────
  beltBuckle: { position: 'absolute', left: PX * 2.8, top: -PX * 0.1, width: PX * 1.2, height: PX * 0.8, backgroundColor: '#9ca3af40', borderRadius: PX * 0.2, zIndex: 1 },

  // ── Pant cuff ───────────────────────────────────────────────
  pantCuff: { position: 'absolute', bottom: 0, left: 0, right: 0, height: PX * 0.4, backgroundColor: '#312e8115' },

  // ── Nostril dots ──────────────────────────────────────────────
  nostrilRow: { flexDirection: 'row', gap: PX * 0.8, marginTop: -1, marginBottom: 1 },
  nostril: { width: PX * 0.3, height: PX * 0.3, borderRadius: PX * 0.15 },

  // ── Facial Hair ───────────────────────────────────────────────
  stubbleRow: { flexDirection: 'row', gap: PX * 0.5, position: 'absolute', bottom: -PX * 0.5 },
  stubbleDot: { width: PX * 0.3, height: PX * 0.3, borderRadius: PX * 0.15 },
  beard: { position: 'absolute', bottom: -PX * 2, width: PX * 4, height: PX * 2.5, borderBottomLeftRadius: PX, borderBottomRightRadius: PX, opacity: 0.85 },
  mustacheRow: { flexDirection: 'row', position: 'absolute', bottom: PX * 0.8, gap: 0 },
  mustacheHalf: { width: PX * 1.5, height: PX * 0.6, borderRadius: 1 },
  goatee: { position: 'absolute', bottom: -PX * 1.5, width: PX * 2, height: PX * 2, borderBottomLeftRadius: PX * 0.8, borderBottomRightRadius: PX * 0.8, opacity: 0.85 },

  // ── Shoe Details ──────────────────────────────────────────────
  shoeSole: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1.5, backgroundColor: '#312e8150', borderRadius: 0.5 },
  shoeToeCap: { position: 'absolute', top: 0, left: 0, width: PX * 1.2, height: '100%' as any, backgroundColor: '#ffffff10', borderTopLeftRadius: 1 },

  // ── Shoulder Highlights ───────────────────────────────────────
  shoulderHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: '#ffffff14' },

  // ── Knee Shadows ──────────────────────────────────────────────
  kneeShadow: { position: 'absolute', top: PX * 1.5, left: 0, right: 0, height: PX * 0.5, backgroundColor: '#0000000a' },

  // ── Pet Companions ────────────────────────────────────────────
  petCat: { position: 'absolute', bottom: 16, right: -4, width: PX * 4, height: PX * 3, zIndex: -1 },
  catBody: { position: 'absolute', bottom: 0, width: PX * 2.5, height: PX * 1.5, backgroundColor: '#f59e0b', borderRadius: PX * 0.7 },
  catHead: { position: 'absolute', bottom: PX * 1, left: 0, width: PX * 1.5, height: PX * 1.5, backgroundColor: '#f59e0b', borderRadius: PX * 0.7 },
  catEar: { position: 'absolute', top: -PX * 0.4, width: 0, height: 0, borderLeftWidth: PX * 0.4, borderRightWidth: PX * 0.4, borderBottomWidth: PX * 0.6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#f59e0b' },
  catEarL: { left: 0 },
  catEarR: { right: 0 },
  catTail: { position: 'absolute', bottom: PX * 0.5, right: -PX * 0.5, width: PX * 2, height: PX * 0.4, backgroundColor: '#f59e0b', borderTopRightRadius: PX * 1, transform: [{ rotate: '-20deg' }] },

  petDog: { position: 'absolute', bottom: 16, right: -6, width: PX * 5, height: PX * 3.5, zIndex: -1 },
  dogBody: { position: 'absolute', bottom: 0, width: PX * 3, height: PX * 1.8, backgroundColor: '#8b6914', borderRadius: PX * 0.8 },
  dogHead: { position: 'absolute', bottom: PX * 1.2, left: 0, width: PX * 2, height: PX * 2, backgroundColor: '#8b6914', borderRadius: PX },
  dogEar: { position: 'absolute', top: -PX * 0.2, width: PX * 0.8, height: PX * 1, backgroundColor: '#6b4f10', borderRadius: PX * 0.4 },
  dogEarL: { left: 0 },
  dogEarR: { right: 0 },
  dogTail: { position: 'absolute', bottom: PX * 1, right: -PX * 0.5, width: PX * 0.5, height: PX * 1.5, backgroundColor: '#8b6914', borderTopRightRadius: PX, transform: [{ rotate: '30deg' }] },

  petBird: { position: 'absolute', top: 12, right: -2, width: PX * 3, height: PX * 2, zIndex: 8 },
  birdBody: { position: 'absolute', bottom: 0, left: PX * 0.5, width: PX * 1.5, height: PX * 1.2, backgroundColor: '#3b82f6', borderRadius: PX * 0.6 },
  birdWing: { position: 'absolute', bottom: PX * 0.4, left: PX * 1.5, width: PX * 1, height: PX * 0.6, backgroundColor: '#60a5fa', borderRadius: PX * 0.3, transform: [{ rotate: '-10deg' }] },
  birdBeak: { position: 'absolute', bottom: PX * 0.5, left: 0, width: 0, height: 0, borderTopWidth: PX * 0.3, borderBottomWidth: PX * 0.3, borderRightWidth: PX * 0.5, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: '#f59e0b' },

  petRobot: { position: 'absolute', bottom: 16, right: -4, width: PX * 3, height: PX * 3, zIndex: -1 },
  robotBody: { position: 'absolute', bottom: 0, width: PX * 2, height: PX * 2, backgroundColor: '#6b7280', borderRadius: PX * 0.3, borderWidth: 0.5, borderColor: '#9ca3af' },
  robotEye: { position: 'absolute', top: PX * 0.4, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#22c55e', borderRadius: PX * 0.2 },
  robotAntenna: { position: 'absolute', bottom: PX * 2, left: PX * 0.8, width: PX * 0.3, height: PX * 0.8, backgroundColor: '#9ca3af' },
  robotAntennaDot: { position: 'absolute', bottom: PX * 2.6, left: PX * 0.6, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#ef4444', borderRadius: PX * 0.3 },

  // ── Aura Effects ──────────────────────────────────────────────
  auraFire: { position: 'absolute', top: 4, left: 2, right: 2, bottom: 20, zIndex: -1 },
  flame1: { position: 'absolute', top: 0, left: PX * 1, width: PX * 1.5, height: PX * 2, backgroundColor: '#ef444080', shadowColor: '#ef4440', shadowRadius: 6, shadowOpacity: 0.8, borderRadius: PX, transform: [{ rotate: '-10deg' }] },
  flame2: { position: 'absolute', top: -PX * 0.5, right: PX * 1.5, width: PX * 1.2, height: PX * 1.8, backgroundColor: '#f9731680', shadowColor: '#f97316', shadowRadius: 5, shadowOpacity: 0.8, borderRadius: PX * 0.6, transform: [{ rotate: '12deg' }] },
  flame3: { position: 'absolute', top: PX * 1, left: PX * 3, width: PX * 1, height: PX * 1.5, backgroundColor: '#f59e0b70', shadowColor: '#f59e0b', shadowRadius: 4, shadowOpacity: 0.8, borderRadius: PX * 0.5 },

  auraIce: { position: 'absolute', top: 8, left: 4, right: 4, bottom: 20, borderWidth: 1.5, borderColor: '#06b6d480', shadowColor: '#06b6d4', shadowRadius: 8, shadowOpacity: 0.6, borderRadius: 4, zIndex: -1 },
  iceFlake1: { position: 'absolute', top: PX * 0.5, left: 0, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#67e8f950', shadowColor: '#ffffff', shadowRadius: 3, shadowOpacity: 0.9, borderRadius: PX * 0.4 },
  iceFlake2: { position: 'absolute', bottom: PX * 2, right: 0, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#67e8f930', borderRadius: PX * 0.3 },
  iceFlake3: { position: 'absolute', top: PX * 3, right: PX * 0.5, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#67e8f925', borderRadius: PX * 0.25 },

  auraElectric: { position: 'absolute', top: 6, left: 0, right: 0, bottom: 20, zIndex: -1 },
  bolt1: { position: 'absolute', top: PX * 1, left: 0, width: PX * 1.5, height: 2, backgroundColor: '#fef08a', shadowColor: '#eab308', shadowRadius: 6, shadowOpacity: 1, transform: [{ rotate: '45deg' }] },
  bolt2: { position: 'absolute', top: PX * 3, right: 0, width: PX * 1.8, height: 2, backgroundColor: '#fef08a', shadowColor: '#eab308', shadowRadius: 6, shadowOpacity: 1, transform: [{ rotate: '-35deg' }] },

  auraNature: { position: 'absolute', top: 6, left: 0, right: 0, bottom: 20, zIndex: -1 },
  leaf1: { position: 'absolute', top: PX * 0.5, left: 0, width: PX * 1.2, height: PX * 1.2, backgroundColor: '#4ade8090', shadowColor: '#22c55e', shadowRadius: 4, shadowOpacity: 0.7, borderRadius: PX * 0.6, transform: [{ rotate: '30deg' }] },
  leaf2: { position: 'absolute', top: PX * 3, right: -1, width: PX * 1, height: PX * 1, backgroundColor: '#22c55e40', borderRadius: PX * 0.5, transform: [{ rotate: '-20deg' }] },
  leaf3: { position: 'absolute', bottom: PX * 3, left: PX * 1, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#22c55e35', borderRadius: PX * 0.4, transform: [{ rotate: '60deg' }] },

  auraShadow: { position: 'absolute', bottom: 12, left: 2, right: 2, height: PX * 2.5, backgroundColor: '#4c1d9520', borderRadius: PX * 3, zIndex: -1 },

  // ── New Hats ─────────────────────────────────────────────
  spaceHelmet: { alignItems: 'center', marginBottom: -6, zIndex: 5 },
  spaceHelmetDome: { width: PX * 9, height: PX * 5, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1.5, borderColor: '#ffffff40', backgroundColor: '#ffffff10' },
  spaceHelmetVisor: { width: PX * 7, height: PX * 1.5, backgroundColor: '#3b82f640', marginTop: -2, borderRadius: 1 },

  wizardHat: { alignItems: 'center', marginBottom: -6, zIndex: 5 },
  wizardHatTop: { width: 0, height: 0, borderLeftWidth: PX * 2.5, borderRightWidth: PX * 2.5, borderBottomWidth: PX * 5, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  wizardHatBrim: { width: PX * 9, height: PX * 1.5, borderRadius: 1, marginTop: -2 },
  wizardStar1: { position: 'absolute', top: PX * 1, left: PX * 2.5, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#fef08a80', borderRadius: PX * 0.3 },
  wizardStar2: { position: 'absolute', top: PX * 2.5, right: PX * 2, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#fef08a60', borderRadius: PX * 0.2 },

  haloRing: { width: PX * 6, height: PX * 1.5, borderWidth: 1.5, borderColor: '#f59e0b', borderRadius: PX * 3, marginBottom: -4, zIndex: 5, backgroundColor: '#f59e0b20', shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 0.6 },

  antennaWrap: { alignItems: 'center', marginBottom: -6, zIndex: 5 },
  antennaStalk: { width: PX * 0.4, height: PX * 3, backgroundColor: '#22c55e' },
  antennaBobble: { width: PX * 1.2, height: PX * 1.2, backgroundColor: '#22c55e', borderRadius: PX * 0.6, marginTop: -1, shadowColor: '#22c55e', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 0.8 },

  // ── New Accessories ──────────────────────────────────────
  monocle: { position: 'absolute', top: PX * 0.5, right: PX * 0.8, zIndex: 3 },
  monocleFrame: { width: PX * 2, height: PX * 2, borderWidth: 1, borderColor: '#d4a017', borderRadius: PX, backgroundColor: '#ffffff15' },
  monocleChain: { position: 'absolute', bottom: -PX * 1.5, right: 0, width: PX * 0.3, height: PX * 2, backgroundColor: '#d4a01780' },

  accessoryEyePatch: { position: 'absolute', top: PX * 0.5, left: PX * 0.8, width: PX * 2, height: PX * 1.8, backgroundColor: '#1a1a1a', borderRadius: PX * 0.5, zIndex: 2 },

  accessoryBandana: { position: 'absolute', bottom: 0, left: 0, right: 0, height: PX * 2, backgroundColor: '#1a1a1a', borderRadius: 1, zIndex: 2 },

  // ── New Back Items ───────────────────────────────────────
  jetpack: { position: 'absolute', top: 30, right: 2, zIndex: -1, alignItems: 'center' as const },
  jetpackBody: { width: PX * 3, height: PX * 4, backgroundColor: '#6b7280', borderRadius: 2, borderWidth: 1, borderColor: '#4b5563' },
  jetpackNozzle: { width: PX * 1, height: PX * 1, backgroundColor: '#4b5563', borderRadius: 1 },
  jetpackFlame: { width: PX * 1.5, height: PX * 2, backgroundColor: '#f97316', opacity: 0.6, borderBottomLeftRadius: PX, borderBottomRightRadius: PX, shadowColor: '#f97316', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 0.8 },

  shieldItem: { position: 'absolute', top: 30, left: 4, zIndex: -1 },
  shieldBody: { width: PX * 4, height: PX * 5, borderRadius: PX * 2, borderWidth: 1.5, backgroundColor: '#8b6914', borderColor: '#d4a017' },
  shieldBoss: { position: 'absolute', top: PX * 1.5, left: PX * 1.2, width: PX * 1.5, height: PX * 1.5, backgroundColor: '#d4a01780', borderRadius: PX * 0.75 },

  swordItem: { position: 'absolute', top: 26, right: 2, zIndex: -1, alignItems: 'center' as const },
  swordBlade: { width: PX * 0.8, height: PX * 7, backgroundColor: '#9ca3af', borderRadius: 1 },
  swordHilt: { width: PX * 2, height: PX * 1.2, backgroundColor: '#78350f', borderRadius: 1, marginTop: -1 },
  swordGuard: { width: PX * 2.5, height: PX * 0.5, backgroundColor: '#d4a017', borderRadius: 1, marginTop: -1 },

  quiver: { position: 'absolute', top: 28, right: 4, zIndex: -1 },
  quiverBody: { width: PX * 2.5, height: PX * 5, backgroundColor: '#78350f', borderRadius: 2, borderWidth: 1, borderColor: '#5a3a10' },
  quiverArrow1: { position: 'absolute', top: -PX * 1, left: PX * 0.3, width: PX * 0.3, height: PX * 2, backgroundColor: '#8b6914', borderRadius: 1 },
  quiverArrow2: { position: 'absolute', top: -PX * 1.5, left: PX * 1, width: PX * 0.3, height: PX * 2.5, backgroundColor: '#8b6914', borderRadius: 1 },
  quiverArrow3: { position: 'absolute', top: -PX * 0.8, left: PX * 1.7, width: PX * 0.3, height: PX * 1.8, backgroundColor: '#8b6914', borderRadius: 1 },

  // ── New Pets ─────────────────────────────────────────────
  petDragon: { position: 'absolute', bottom: 16, right: -6, width: PX * 5, height: PX * 4, zIndex: -1 },
  dragonBody: { position: 'absolute', bottom: 0, width: PX * 2.5, height: PX * 1.8, backgroundColor: '#dc2626', borderRadius: PX * 0.8 },
  dragonHead: { position: 'absolute', bottom: PX * 1.2, left: 0, width: PX * 1.8, height: PX * 1.5, backgroundColor: '#dc2626', borderRadius: PX * 0.6 },
  dragonEye: { position: 'absolute', top: PX * 0.3, left: PX * 0.5, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#f59e0b', borderRadius: PX * 0.2 },
  dragonWingL: { position: 'absolute', bottom: PX * 1.5, left: PX * 0.5, width: 0, height: 0, borderLeftWidth: PX * 1.5, borderBottomWidth: PX * 1.5, borderLeftColor: 'transparent', borderBottomColor: '#dc262680' },
  dragonWingR: { position: 'absolute', bottom: PX * 1.5, left: PX * 2, width: 0, height: 0, borderRightWidth: PX * 1.5, borderBottomWidth: PX * 1.5, borderRightColor: 'transparent', borderBottomColor: '#dc262680' },
  dragonTail: { position: 'absolute', bottom: PX * 0.3, right: -PX * 0.5, width: PX * 2, height: PX * 0.4, backgroundColor: '#dc2626', borderTopRightRadius: PX, transform: [{ rotate: '-15deg' }] },

  petAlien: { position: 'absolute', bottom: 16, right: -4, width: PX * 3.5, height: PX * 3, zIndex: -1 },
  alienBody: { position: 'absolute', bottom: 0, width: PX * 1.8, height: PX * 1.5, backgroundColor: '#22c55e', borderRadius: PX * 0.5 },
  alienHead: { position: 'absolute', bottom: PX * 1, left: 0, width: PX * 2, height: PX * 2, backgroundColor: '#22c55e', borderRadius: PX },
  alienEye: { position: 'absolute', top: PX * 0.5, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#1a1a1a', borderRadius: PX * 0.3 },
  alienAntennaPart: { position: 'absolute', bottom: PX * 2.8, left: PX * 0.8, width: PX * 0.3, height: PX * 0.8, backgroundColor: '#22c55e' },

  // ── New Auras ────────────────────────────────────────────
  auraRainbow: { position: 'absolute', top: 2, left: -2, right: -2, bottom: 20, zIndex: -1 },
  rainbowArc: { position: 'absolute', left: 0, right: 0, height: PX * 0.5, borderRadius: PX * 0.25 },

  auraGlitch: { position: 'absolute', top: 4, left: 0, right: 0, bottom: 20, zIndex: -1 },
  glitchRect: { position: 'absolute' },

  auraCosmic: { position: 'absolute', top: 4, left: -2, right: -2, bottom: 20, zIndex: -1 },
  cosmicStar1: { position: 'absolute', top: PX * 0.5, left: -1, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#fef08a', borderRadius: PX * 0.3, shadowColor: '#fef08a', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 1 },
  cosmicStar2: { position: 'absolute', top: PX * 2, right: -1, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#fef08a80', borderRadius: PX * 0.25 },
  cosmicStar3: { position: 'absolute', top: PX * 4, left: PX * 1, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#fef08a60', borderRadius: PX * 0.2 },
  cosmicStar4: { position: 'absolute', top: PX * 1.5, left: PX * 4, width: PX * 0.3, height: PX * 0.3, backgroundColor: '#ffffff80', borderRadius: PX * 0.15 },
  cosmicStar5: { position: 'absolute', top: PX * 3.5, right: PX * 0.5, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#fef08a50', borderRadius: PX * 0.25 },

  // ── Hand Items ───────────────────────────────────────────
  handLightsaber: { position: 'absolute', right: -PX * 2.5, bottom: PX * 0.5, zIndex: 3, alignItems: 'center' as const },
  lightsaberBlade: { width: PX * 0.5, height: PX * 6, borderRadius: PX * 0.25, shadowOffset: { width: 0, height: 0 }, shadowRadius: 6, shadowOpacity: 0.9 },
  lightsaberHilt: { width: PX * 0.8, height: PX * 1.5, backgroundColor: '#4b5563', borderRadius: 1, borderWidth: 0.5, borderColor: '#6b7280' },

  handCoffee: { position: 'absolute', right: -PX * 2, bottom: 0, zIndex: 3 },
  handCoffeeBody: { width: PX * 1.5, height: PX * 1.8, backgroundColor: '#f5f5f4', borderRadius: 1, borderWidth: 0.5, borderColor: '#9ca3af' },
  handCoffeeHandle: { position: 'absolute', right: -PX * 0.5, top: PX * 0.3, width: PX * 0.5, height: PX * 1, borderWidth: 0.5, borderColor: '#9ca3af', borderRadius: PX * 0.25, backgroundColor: 'transparent' },

  handLaptop: { position: 'absolute', right: -PX * 2.5, bottom: -PX * 0.5, zIndex: 3 },
  handLaptopScreen: { width: PX * 2.5, height: PX * 1.8, backgroundColor: '#0f172a', borderWidth: 0.5, borderColor: '#334155', borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  handLaptopBase: { width: PX * 2.8, height: PX * 0.4, backgroundColor: '#6b7280', borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },

  handFlag: { position: 'absolute', right: -PX * 2, bottom: 0, zIndex: 3 },
  handFlagPole: { width: PX * 0.3, height: PX * 4, backgroundColor: '#6b7280' },
  handFlagCloth: { position: 'absolute', top: 0, left: PX * 0.3, width: PX * 2, height: PX * 1.5, borderTopRightRadius: 1, borderBottomRightRadius: 1 },

  handWand: { position: 'absolute', right: -PX * 2, bottom: 0, zIndex: 3 },
  handWandStick: { width: PX * 0.4, height: PX * 3, backgroundColor: '#78350f', borderRadius: 1, transform: [{ rotate: '-15deg' }] },
  handWandSpark: { position: 'absolute', top: -PX * 0.5, left: PX * 0.5, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#fef08a', borderRadius: PX * 0.4, shadowColor: '#fef08a', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 1 },

});
