import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Platform, Easing } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { AgentAppearance, DEFAULT_APPEARANCE, EnvironmentType, THEME_OUTFITS, NEON_SKIN_TONES } from '../../../../lib/officeConfig';
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

  // Only apply theme outfits to agents using default appearance (not user-customized)
  const isCustomized = appearance != null && (
    a.hat !== 'none' || a.accessory !== 'none' || a.backItem !== 'none' ||
    a.pet !== 'none' || a.aura !== 'none' || a.handItem !== 'none' ||
    a.facialHair !== 'none' || a.expression !== 'neutral' ||
    a.shirtColor !== DEFAULT_APPEARANCE.shirtColor ||
    a.pantsColor !== DEFAULT_APPEARANCE.pantsColor ||
    a.shoeColor !== DEFAULT_APPEARANCE.shoeColor ||
    a.hairStyle !== DEFAULT_APPEARANCE.hairStyle ||
    a.hairColor !== DEFAULT_APPEARANCE.hairColor ||
    a.skinTone !== DEFAULT_APPEARANCE.skinTone ||
    a.eyeColor !== DEFAULT_APPEARANCE.eyeColor
  );
  const outfit = (environmentType && !isCustomized) ? THEME_OUTFITS[environmentType] : null;
  const showThemeHeadgear = outfit?.headgear && a.hat === 'none';
  const effectiveBootColor = outfit?.bootColor || a.shoeColor || '#1a1a1a';

  // Neon/glowing skin detection
  const isNeonSkin = NEON_SKIN_TONES.includes(a.skinTone);
  const neonGlow = isNeonSkin ? {
    shadowColor: a.skinTone,
    shadowOffset: { width: 0, height: 0 } as const,
    shadowRadius: 8,
    shadowOpacity: 0.9,
  } : {} as any;
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

  // Aura animations
  const auraFlicker = useRef(new Animated.Value(0)).current;
  const auraPulse = useRef(new Animated.Value(1)).current;
  const auraRotate = useRef(new Animated.Value(0)).current;
  const auraDrift = useRef(new Animated.Value(0)).current;

  // Pet animations
  const petBounce = useRef(new Animated.Value(0)).current;
  const petTail = useRef(new Animated.Value(0)).current;

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

  // Aura animations — flicker, pulse, rotation, drift
  useEffect(() => {
    const flickerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auraFlicker, { toValue: 1, duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraFlicker, { toValue: 0.4, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraFlicker, { toValue: 0.8, duration: 350, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraFlicker, { toValue: 0.2, duration: 250, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ])
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auraPulse, { toValue: 1.12, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraPulse, { toValue: 0.92, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ])
    );
    const rotateLoop = Animated.loop(
      Animated.timing(auraRotate, { toValue: 1, duration: 6000, useNativeDriver: true, easing: Easing.linear })
    );
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auraDrift, { toValue: -2, duration: 1800, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraDrift, { toValue: 2, duration: 1800, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ])
    );
    flickerLoop.start();
    pulseLoop.start();
    rotateLoop.start();
    driftLoop.start();
    return () => { flickerLoop.stop(); pulseLoop.stop(); rotateLoop.stop(); driftLoop.stop(); };
  }, []);

  // Pet animations — bounce and tail wag
  useEffect(() => {
    const bounceLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(petBounce, { toValue: -2, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petBounce, { toValue: 0, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ])
    );
    const tailLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(petTail, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petTail, { toValue: -1, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ])
    );
    bounceLoop.start();
    tailLoop.start();
    return () => { bounceLoop.stop(); tailLoop.stop(); };
  }, []);

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

        {/* Ground spotlight — always visible for non-offline agents */}
        {!isOffline && (
          <View style={[styles.groundSpotlight, { backgroundColor: agent.color }]} />
        )}

        {/* Active glow — pulsing backlight behind working agents */}
        {isWorking && !isOffline && (
          <Animated.View style={[styles.activeGlow, {
            backgroundColor: agent.color,
            opacity: glowAnim.interpolate({ inputRange: [0.3, 0.9], outputRange: [0.18, 0.45] }),
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
            <View style={[styles.tophatTop, { backgroundColor: '#1a1a1a' }]}>
              <View style={styles.tophatBand} />
            </View>
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
            <View style={styles.spaceHelmetAntenna} />
            <View style={styles.spaceHelmetAntennaTip} />
            <View style={styles.spaceHelmetDome}>
              <View style={styles.spaceHelmetHighlight} />
            </View>
            <View style={styles.spaceHelmetVisor} />
            <View style={styles.spaceHelmetRim} />
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
        {a.hat === 'crab_helmet' && (
          <View style={styles.crabHelmet}>
            <View style={styles.crabHelmetShell} />
            <View style={styles.crabHelmetHighlight} />
            <View style={styles.crabHelmetEyeStalkL} />
            <View style={styles.crabHelmetEyeStalkR} />
            <View style={[styles.crabHelmetEye, { left: PX * 0.5 }]} />
            <View style={[styles.crabHelmetEye, { right: PX * 0.5 }]} />
            <View style={styles.crabHelmetClawL} />
            <View style={styles.crabHelmetClawR} />
          </View>
        )}

        {a.hat === 'pirate_hat' && (
          <View style={styles.pirateHat}>
            <View style={styles.pirateHatCrown} />
            <View style={styles.pirateHatBrim} />
            <View style={styles.pirateHatSkull} />
          </View>
        )}
        {a.hat === 'cowboy_hat' && (
          <View style={styles.cowboyHat}>
            <View style={styles.cowboyHatCrown} />
            <View style={styles.cowboyHatBrim} />
          </View>
        )}
        {a.hat === 'fez' && (
          <View style={styles.fez}>
            <View style={styles.fezBody} />
            <View style={styles.fezTassel} />
          </View>
        )}
        {a.hat === 'mohawk_spikes' && (
          <View style={styles.mohawkSpikes}>
            <View style={styles.spike} />
            <View style={[styles.spike, { height: PX * 2.5 }]} />
            <View style={styles.spike} />
            <View style={[styles.spike, { height: PX * 1.5 }]} />
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
          <View style={[styles.ear, styles.earLeft, { backgroundColor: a.skinTone, ...neonGlow }]}>
            <View style={[styles.earInner, { backgroundColor: a.skinTone }]} />
          </View>
          <View style={[styles.ear, styles.earRight, { backgroundColor: a.skinTone, ...neonGlow }]}>
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
              a.hairStyle === 'buzzcut' && styles.hairBuzzcut,
              a.hairStyle === 'afro' && styles.hairAfro,
              a.hairStyle === 'undercut' && styles.hairUndercut,
              a.hairStyle === 'pigtails' && styles.hairPigtails,
            ]}>
              {/* Hair highlight — light hits from top-left */}
              <View style={styles.hairHighlight} />
            </View>
          )}
          {/* Pigtail bundles */}
          {a.hairStyle === 'pigtails' && (
            <>
              <View style={[styles.pigtailBundleL, { backgroundColor: a.hairColor }]} />
              <View style={[styles.pigtailBundleR, { backgroundColor: a.hairColor }]} />
            </>
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
          <View style={[styles.face, { backgroundColor: a.skinTone, ...neonGlow }]}>
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
            {a.expression === 'surprised' && (
              <View style={styles.browRow}>
                <View style={[styles.brow, { transform: [{ translateY: -PX * 0.5 }] }]} />
                <View style={[styles.brow, { transform: [{ translateY: -PX * 0.5 }] }]} />
              </View>
            )}
            {a.expression === 'smirk' && (
              <View style={styles.browRow}>
                <View style={[styles.brow, { transform: [{ rotate: '-10deg' }] }]} />
                <View style={[styles.brow, { transform: [{ rotate: '5deg' }, { translateY: -PX * 0.3 }] }]} />
              </View>
            )}
            {/* Eyes — with blink animation */}
            <Animated.View style={[styles.eyeRow, { transform: [{ scaleY: blinkAnim }] }]}>
              <View style={[styles.eye, isOffline && styles.closedEye, a.expression === 'cool' && styles.coolEye, a.expression === 'sleepy' && styles.sleepyEye, a.expression === 'surprised' && styles.surprisedEye, a.expression === 'smirk' && styles.smirkEyeL, a.expression === 'crying' && styles.cryingEye]}>
                {!isOffline && a.expression !== 'sleepy' && (
                  <>
                    <View style={[styles.iris, { backgroundColor: a.eyeColor || '#3b82f6' }]}>
                      <View style={styles.pupil} />
                    </View>
                    <View style={styles.catchlight} />
                  </>
                )}
              </View>
              <View style={[styles.eye, isOffline && styles.closedEye, a.expression === 'cool' && styles.coolEye, a.expression === 'sleepy' && styles.sleepyEye, a.expression === 'surprised' && styles.surprisedEye, a.expression === 'smirk' && styles.smirkEyeR, a.expression === 'crying' && styles.cryingEye]}>
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
            {/* Crying tears */}
            {a.expression === 'crying' && (
              <>
                <View style={[styles.tear, { left: PX * 1.2 }]} />
                <View style={[styles.tear, { right: PX * 1.2 }]} />
              </>
            )}
            {/* Mouth */}
            <View style={[
              styles.mouth,
              isOffline && styles.sleepMouth,
              a.expression === 'happy' && styles.happyMouth,
              a.expression === 'angry' && styles.angryMouth,
              a.expression === 'surprised' && styles.surprisedMouth,
              a.expression === 'smirk' && styles.smirkMouth,
              a.expression === 'crying' && styles.cryingMouth,
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
            {a.accessory === 'chain' && (
              <View style={styles.accessoryChain}>
                <View style={styles.chainLink1} />
                <View style={styles.chainLink2} />
                <View style={styles.chainLink3} />
              </View>
            )}
            {a.accessory === 'piercing' && (
              <View style={styles.accessoryPiercing} />
            )}
            {a.accessory === 'visor_shades' && (
              <View style={styles.accessoryVisor}>
                <View style={styles.visorStripe} />
              </View>
            )}
            {a.accessory === 'gas_mask' && (
              <View style={styles.accessoryGasMask}>
                <View style={styles.gasMaskFilterL} />
                <View style={styles.gasMaskFilterR} />
                <View style={styles.gasMaskVent} />
              </View>
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
            {(a.facialHair || 'none') === 'fu_manchu' && (
              <View style={styles.fuManchuRow}>
                <View style={[styles.fuManchuHalf, { backgroundColor: a.hairColor, transform: [{ rotate: '5deg' }] }]} />
                <View style={[styles.fuManchuHalf, { backgroundColor: a.hairColor, transform: [{ rotate: '-5deg' }] }]} />
              </View>
            )}
            {(a.facialHair || 'none') === 'sideburns' && (
              <>
                <View style={[styles.sideburn, styles.sideburnL, { backgroundColor: a.hairColor }]} />
                <View style={[styles.sideburn, styles.sideburnR, { backgroundColor: a.hairColor }]} />
              </>
            )}
            {(a.facialHair || 'none') === 'soul_patch' && (
              <View style={[styles.soulPatch, { backgroundColor: a.hairColor }]} />
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
            <View style={[styles.wing, styles.wingLeft, { borderBottomColor: '#a5b4fc70' }]} />
            <View style={[styles.wingInner, styles.wingInnerLeft, { borderBottomColor: '#c7d2fe50' }]} />
            <View style={[styles.wing, styles.wingRight, { borderBottomColor: '#a5b4fc70' }]} />
            <View style={[styles.wingInner, styles.wingInnerRight, { borderBottomColor: '#c7d2fe50' }]} />
          </View>
        )}
        {a.backItem === 'jetpack' && (
          <View style={styles.jetpack}>
            <View style={styles.jetpackBody}>
              <View style={styles.jetpackDetail} />
            </View>
            <View style={styles.jetpackNozzle} />
            <View style={styles.jetpackFlame}>
              <View style={styles.jetpackFlameInner} />
            </View>
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
        {a.backItem === 'crab_shell' && (
          <View style={styles.crabBackShell}>
            <View style={styles.crabBackShellInner} />
            <View style={styles.crabBackShellRidge1} />
            <View style={styles.crabBackShellRidge2} />
            <View style={styles.crabBackShellRidge3} />
          </View>
        )}
        {a.backItem === 'tentacles' && (
          <View style={styles.tentacles}>
            <View style={[styles.tentacle, { transform: [{ rotate: '-30deg' }] }]} />
            <View style={[styles.tentacle, { transform: [{ rotate: '-10deg' }], height: PX * 4 }]} />
            <View style={[styles.tentacle, { transform: [{ rotate: '10deg' }] }]} />
            <View style={[styles.tentacle, { transform: [{ rotate: '30deg' }], height: PX * 3.5 }]} />
          </View>
        )}
        {a.backItem === 'rocket' && (
          <View style={styles.rocketPack}>
            <View style={styles.rocketBody} />
            <View style={styles.rocketNose} />
            <View style={styles.rocketFlame} />
          </View>
        )}
        {a.backItem === 'scroll' && (
          <View style={styles.scrollBack}>
            <View style={styles.scrollBody} />
            <View style={styles.scrollCapTop} />
            <View style={styles.scrollCapBot} />
          </View>
        )}
        {a.backItem === 'boombox' && (
          <View style={styles.boombox}>
            <View style={styles.boomboxBody} />
            <View style={styles.boomboxSpeakerL} />
            <View style={styles.boomboxSpeakerR} />
            <View style={styles.boomboxHandle} />
          </View>
        )}

        {/* Neck */}
        <View style={[styles.neck, { backgroundColor: a.skinTone, ...neonGlow }]}>
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
            <View style={[styles.hand, { backgroundColor: outfit?.extraElement === 'gauntlets' ? (outfit.accentColor || '#6b7280') : a.skinTone, ...neonGlow }]}>
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
            <View style={[styles.hand, { backgroundColor: outfit?.extraElement === 'gauntlets' ? (outfit.accentColor || '#6b7280') : a.skinTone, ...neonGlow }]}>
              <View style={styles.fingerLine} />
              <View style={[styles.fingerLine, styles.fingerLine2]} />
            </View>
          </Animated.View>
          {/* Hand item — rendered at right arm position */}
          {(a.handItem || 'none') === 'lightsaber' && (
            <View style={styles.handLightsaber}>
              <View style={[styles.lightsaberGlow, { backgroundColor: agent.color }]} />
              <View style={[styles.lightsaberBlade, { backgroundColor: agent.color + 'dd', shadowColor: agent.color }]} />
              <View style={[styles.lightsaberCore, { backgroundColor: agent.color }]} />
              <View style={styles.lightsaberGuard} />
              <View style={styles.lightsaberHilt}>
                <View style={styles.lightsaberGrip1} />
                <View style={styles.lightsaberGrip2} />
              </View>
            </View>
          )}
          {(a.handItem || 'none') === 'coffee' && (
            <View style={styles.handCoffee}>
              <View style={styles.handCoffeeSteam} />
              <View style={styles.handCoffeeLid} />
              <View style={styles.handCoffeeBody} />
              <View style={styles.handCoffeeHandle} />
            </View>
          )}
          {(a.handItem || 'none') === 'laptop' && (
            <View style={styles.handLaptop}>
              <View style={styles.handLaptopScreen}>
                <View style={styles.handLaptopScreenGlow} />
              </View>
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
              <View style={styles.handWandSpark} />
              <View style={styles.handWandSpark2} />
              <View style={styles.handWandSpark3} />
              <View style={styles.handWandStick} />
            </View>
          )}
          {(a.handItem || 'none') === 'crab_claws' && (
            <View style={styles.handCrabClaws}>
              <View style={styles.handCrabArm} />
              <View style={styles.handCrabClawTop} />
              <View style={styles.handCrabClawBot} />
            </View>
          )}
          {(a.handItem || 'none') === 'sword_hand' && (
            <View style={styles.handSword}>
              <View style={styles.handSwordBlade} />
              <View style={styles.handSwordGuard} />
              <View style={styles.handSwordHilt} />
            </View>
          )}
          {(a.handItem || 'none') === 'pizza' && (
            <View style={styles.handPizza}>
              <View style={styles.pizzaSlice} />
              <View style={styles.pizzaCrust} />
              <View style={styles.pizzaTopping1} />
              <View style={styles.pizzaTopping2} />
            </View>
          )}
          {(a.handItem || 'none') === 'microphone' && (
            <View style={styles.handMic}>
              <View style={styles.micHead} />
              <View style={styles.micStick} />
            </View>
          )}
          {(a.handItem || 'none') === 'torch' && (
            <View style={styles.handTorch}>
              <View style={styles.torchFlame} />
              <View style={styles.torchFlameInner} />
              <View style={styles.torchStick} />
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
          <Animated.View style={[styles.petCat, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.catBody}>
              <View style={styles.catBelly} />
              <View style={styles.catStripe1} />
              <View style={styles.catStripe2} />
            </View>
            <View style={styles.catLegFL} />
            <View style={styles.catLegFR} />
            <View style={styles.catLegBL} />
            <View style={styles.catLegBR} />
            <View style={styles.catHead}>
              <View style={styles.catEyeLeft} />
              <View style={styles.catEyeRight} />
              <View style={styles.catPupilL} />
              <View style={styles.catPupilR} />
              <View style={styles.catNose} />
              <View style={styles.catMouth} />
              <View style={styles.catWhiskerL1} />
              <View style={styles.catWhiskerL2} />
              <View style={styles.catWhiskerR1} />
              <View style={styles.catWhiskerR2} />
              <View style={[styles.catEar, styles.catEarL]} />
              <View style={[styles.catEar, styles.catEarR]} />
              <View style={[styles.catEarInner, styles.catEarInnerL]} />
              <View style={[styles.catEarInner, styles.catEarInnerR]} />
            </View>
            <Animated.View style={[styles.catTail, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-30deg', '-10deg'] }) }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'dog' && (
          <Animated.View style={[styles.petDog, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.dogBody}>
              <View style={styles.dogBelly} />
              <View style={styles.dogCollar} />
              <View style={styles.dogCollarTag} />
            </View>
            <View style={styles.dogLegFL} />
            <View style={styles.dogLegFR} />
            <View style={styles.dogLegBL} />
            <View style={styles.dogLegBR} />
            <View style={styles.dogHead}>
              <View style={styles.dogSnout} />
              <View style={styles.dogNose} />
              <View style={styles.dogTongue} />
              <View style={styles.dogEyeLeft} />
              <View style={styles.dogEyeRight} />
              <View style={styles.dogBrowL} />
              <View style={styles.dogBrowR} />
              <View style={[styles.dogEar, styles.dogEarL]} />
              <View style={[styles.dogEar, styles.dogEarR]} />
            </View>
            <Animated.View style={[styles.dogTail, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['15deg', '45deg'] }) }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'bird' && (
          <Animated.View style={[styles.petBird, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.birdBody}>
              <View style={styles.birdChest} />
            </View>
            <View style={styles.birdHead}>
              <View style={styles.birdEye} />
              <View style={styles.birdCrest} />
            </View>
            <Animated.View style={[styles.birdWingL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-15deg', '5deg'] }) }] }]} />
            <Animated.View style={[styles.birdWingR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['5deg', '-15deg'] }) }] }]} />
            <View style={styles.birdBeak} />
            <View style={styles.birdTail} />
            <View style={styles.birdLegL} />
            <View style={styles.birdLegR} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'robot' && (
          <Animated.View style={[styles.petRobot, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.robotBody}>
              <View style={[styles.robotEye, { left: PX * 0.5 }]} />
              <View style={[styles.robotEye, { right: PX * 0.5 }]} />
              <View style={styles.robotChest} />
              <View style={styles.robotPanel} />
              <View style={styles.robotBtn1} />
              <View style={styles.robotBtn2} />
            </View>
            <View style={styles.robotLegL} />
            <View style={styles.robotLegR} />
            <View style={styles.robotFootL} />
            <View style={styles.robotFootR} />
            <View style={styles.robotAntenna} />
            <Animated.View style={[styles.robotAntennaDot, { opacity: auraFlicker }]} />
            <View style={styles.robotArm} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'dragon' && (
          <Animated.View style={[styles.petDragon, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.dragonBody}>
              <View style={styles.dragonBelly} />
              <View style={styles.dragonSpine1} />
              <View style={styles.dragonSpine2} />
              <View style={styles.dragonSpine3} />
            </View>
            <View style={styles.dragonHead}>
              <View style={styles.dragonEye} />
              <View style={styles.dragonPupil} />
              <View style={styles.dragonSnout} />
              <View style={styles.dragonNostril} />
              <View style={styles.dragonHorn} />
            </View>
            <Animated.View style={[styles.dragonWingL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '15deg'] }) }] }]} />
            <Animated.View style={[styles.dragonWingR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['5deg', '-15deg'] }) }] }]} />
            <View style={styles.dragonLegFL} />
            <View style={styles.dragonLegFR} />
            <Animated.View style={[styles.dragonTail, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-25deg', '-5deg'] }) }] }]} />
            <Animated.View style={[styles.dragonTailTip, { opacity: auraFlicker }]} />
            <Animated.View style={[styles.dragonBreath, { opacity: auraFlicker, transform: [{ scaleX: auraPulse }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'alien' && (
          <Animated.View style={[styles.petAlien, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.alienBody}>
              <View style={styles.alienBelt} />
              <View style={styles.alienGem} />
            </View>
            <View style={styles.alienHead}>
              <View style={[styles.alienEye, { left: PX * 0.4 }]} />
              <View style={[styles.alienEye, { right: PX * 0.4 }]} />
              <View style={[styles.alienPupil, { left: PX * 0.55 }]} />
              <View style={[styles.alienPupil, { right: PX * 0.55 }]} />
              <View style={styles.alienMouth} />
            </View>
            <View style={styles.alienAntennaL} />
            <View style={styles.alienAntennaR} />
            <Animated.View style={[styles.alienAntennaTipL, { opacity: auraFlicker }]} />
            <Animated.View style={[styles.alienAntennaTipR, { opacity: auraFlicker }]} />
            <View style={styles.alienLegL} />
            <View style={styles.alienLegR} />
          </Animated.View>
        )}

        {/* Crab pet */}
        {(a.pet || 'none') === 'crab' && (
          <Animated.View style={[styles.petCrab, { transform: [{ translateY: petBounce }] }]}>
            {/* Shell body */}
            <View style={styles.crabShell}>
              <View style={styles.crabShellHighlight} />
              <View style={styles.crabShellPattern1} />
              <View style={styles.crabShellPattern2} />
            </View>
            {/* Eye stalks */}
            <View style={styles.crabEyeStalkL} />
            <View style={styles.crabEyeStalkR} />
            <View style={[styles.crabEye, styles.crabEyeL]} />
            <View style={[styles.crabEye, styles.crabEyeR]} />
            <View style={[styles.crabPupil, styles.crabPupilL]} />
            <View style={[styles.crabPupil, styles.crabPupilR]} />
            {/* Claws */}
            <Animated.View style={[styles.crabClawL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) }] }]}>
              <View style={styles.crabClawPincerTop} />
              <View style={styles.crabClawPincerBot} />
            </Animated.View>
            <Animated.View style={[styles.crabClawR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['8deg', '-8deg'] }) }] }]}>
              <View style={styles.crabClawPincerTop} />
              <View style={styles.crabClawPincerBot} />
            </Animated.View>
            {/* Legs */}
            <View style={styles.crabLeg1L} />
            <View style={styles.crabLeg2L} />
            <View style={styles.crabLeg3L} />
            <View style={styles.crabLeg1R} />
            <View style={styles.crabLeg2R} />
            <View style={styles.crabLeg3R} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'snake' && (
          <Animated.View style={[styles.petSnake, { transform: [{ translateY: petBounce }] }]}>
            <Animated.View style={[styles.snakeBody, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] }) }] }]} />
            <View style={styles.snakeHead}>
              <View style={styles.snakeEye} />
              <View style={styles.snakeTongue} />
            </View>
          </Animated.View>
        )}
        {(a.pet || 'none') === 'bat' && (
          <Animated.View style={[styles.petBat, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.batBody} />
            <Animated.View style={[styles.batWingL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '20deg'] }) }] }]} />
            <Animated.View style={[styles.batWingR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['10deg', '-20deg'] }) }] }]} />
            <View style={[styles.batEye, { left: PX * 0.3 }]} />
            <View style={[styles.batEye, { right: PX * 0.3 }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'skull' && (
          <Animated.View style={[styles.petSkull, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.skullHead}>
              <View style={[styles.skullEye, { left: PX * 0.4 }]} />
              <View style={[styles.skullEye, { right: PX * 0.4 }]} />
              <View style={styles.skullNose} />
              <View style={styles.skullTeeth} />
            </View>
            <View style={styles.skullJaw} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'mushroom' && (
          <Animated.View style={[styles.petMushroom, { transform: [{ translateY: petBounce }] }]}>
            <View style={styles.mushroomCap}>
              <View style={styles.mushroomSpot1} />
              <View style={styles.mushroomSpot2} />
            </View>
            <View style={styles.mushroomStem} />
            <View style={[styles.mushroomEye, { left: PX * 0.5 }]} />
            <View style={[styles.mushroomEye, { right: PX * 0.5 }]} />
          </Animated.View>
        )}

        {/* Aura effects — animated */}
        {(a.aura || 'none') === 'fire' && (
          <Animated.View style={[styles.auraFire, { transform: [{ scale: auraPulse }] }]}>
            <Animated.View style={[styles.flame1, { opacity: auraFlicker, transform: [{ translateY: auraDrift }] }]} />
            <Animated.View style={[styles.flame2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [2, -2] }) }] }]} />
            <Animated.View style={[styles.flame3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }) }]} />
            <Animated.View style={[styles.flame4, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] }), transform: [{ translateY: auraDrift }] }]} />
            <Animated.View style={[styles.fireEmber1, { opacity: auraFlicker, transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-6, 0] }) }] }]} />
            <Animated.View style={[styles.fireEmber2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-4, 2] }) }] }]} />
            <View style={styles.fireGlow} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'ice' && (
          <Animated.View style={[styles.auraIce, { transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.97, 1.03] }) }] }]}>
            <Animated.View style={[styles.iceFlake1, { opacity: auraFlicker, transform: [{ translateY: auraDrift }, { rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
            <Animated.View style={[styles.iceFlake2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [1, -1] }) }] }]} />
            <Animated.View style={[styles.iceFlake3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }) }]} />
            <Animated.View style={[styles.iceFlake4, { opacity: auraFlicker, transform: [{ rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] }) }] }]} />
            <Animated.View style={[styles.iceMist, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.3] }) }]} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'electric' && (
          <Animated.View style={[styles.auraElectric, { transform: [{ scale: auraPulse }] }]}>
            <Animated.View style={[styles.bolt1, { opacity: auraFlicker }]} />
            <Animated.View style={[styles.bolt2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]} />
            <Animated.View style={[styles.bolt3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] }) }]} />
            <Animated.View style={[styles.spark1, { opacity: auraFlicker, transform: [{ translateY: auraDrift }] }]} />
            <Animated.View style={[styles.spark2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [2, -2] }) }] }]} />
            <Animated.View style={[styles.spark3, { opacity: auraFlicker }]} />
            <View style={styles.electricGlow} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'nature' && (
          <Animated.View style={[styles.auraNature]}>
            <Animated.View style={[styles.leaf1, { transform: [{ translateY: auraDrift }, { rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['30deg', '390deg'] }) }] }]} />
            <Animated.View style={[styles.leaf2, { opacity: auraFlicker, transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [1, -3] }) }, { rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '-380deg'] }) }] }]} />
            <Animated.View style={[styles.leaf3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [2, -1] }) }] }]} />
            <Animated.View style={[styles.leaf4, { opacity: auraFlicker, transform: [{ rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['60deg', '420deg'] }) }] }]} />
            <Animated.View style={[styles.natureVine, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] }) }]} />
            <Animated.View style={[styles.natureGlow, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.2] }) }]} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'shadow' && (
          <Animated.View style={[styles.auraShadow, { transform: [{ scaleX: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.9, 1.1] }) }], opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.35] }) }]}>
            <Animated.View style={[styles.shadowWisp1, { opacity: auraFlicker, transform: [{ translateY: auraDrift }] }]} />
            <Animated.View style={[styles.shadowWisp2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [1, -1] }) }] }]} />
            <Animated.View style={[styles.shadowWisp3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] }) }]} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'rainbow' && (
          <Animated.View style={[styles.auraRainbow, { transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.98, 1.02] }) }] }]}>
            <Animated.View style={[styles.rainbowArc, { backgroundColor: '#ef444450', top: 0, opacity: auraFlicker }]} />
            <Animated.View style={[styles.rainbowArc, { backgroundColor: '#f59e0b50', top: PX * 0.6, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }]} />
            <Animated.View style={[styles.rainbowArc, { backgroundColor: '#22c55e50', top: PX * 1.2 }]} />
            <Animated.View style={[styles.rainbowArc, { backgroundColor: '#3b82f650', top: PX * 1.8, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }]} />
            <Animated.View style={[styles.rainbowArc, { backgroundColor: '#8b5cf650', top: PX * 2.4, opacity: auraFlicker }]} />
            <Animated.View style={[styles.rainbowShimmer, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }), transform: [{ translateY: auraDrift }] }]} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'glitch' && (
          <Animated.View style={[styles.auraGlitch]}>
            <Animated.View style={[styles.glitchRect, { backgroundColor: '#ef444460', left: -PX, top: PX * 1, width: PX * 3, height: PX * 0.8, opacity: auraFlicker, transform: [{ translateX: auraDrift }] }]} />
            <Animated.View style={[styles.glitchRect, { backgroundColor: '#3b82f660', right: -PX * 0.5, top: PX * 3, width: PX * 2.5, height: PX * 0.6, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] }), transform: [{ translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [2, -2] }) }] }]} />
            <Animated.View style={[styles.glitchRect, { backgroundColor: '#22c55e60', left: PX * 0.5, top: PX * 5, width: PX * 2, height: PX * 0.5, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]} />
            <Animated.View style={[styles.glitchScanline, { opacity: auraFlicker, transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-PX * 2, PX * 6] }) }] }]} />
            <Animated.View style={[styles.glitchRect, { backgroundColor: '#ec489960', left: PX * 2, top: PX * 0.5, width: PX * 1.5, height: PX * 0.4, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0, 0.7] }) }]} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'cosmic' && (
          <Animated.View style={[styles.auraCosmic, { transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.95, 1.05] }) }] }]}>
            <Animated.View style={[styles.cosmicStar1, { opacity: auraFlicker, transform: [{ scale: auraPulse }] }]} />
            <Animated.View style={[styles.cosmicStar2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), transform: [{ translateY: auraDrift }] }]} />
            <Animated.View style={[styles.cosmicStar3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] }) }]} />
            <Animated.View style={[styles.cosmicStar4, { opacity: auraFlicker }]} />
            <Animated.View style={[styles.cosmicStar5, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] }), transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.8, 1.3] }) }] }]} />
            <Animated.View style={[styles.cosmicNebula, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.2] }), transform: [{ scale: auraPulse }] }]} />
            <Animated.View style={[styles.cosmicRing, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.3] }), transform: [{ rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
          </Animated.View>
        )}

        {(a.aura || 'none') === 'toxic' && (
          <Animated.View style={[styles.auraToxic, { transform: [{ scale: auraPulse }] }]}>
            <Animated.View style={[styles.toxicBubble1, { opacity: auraFlicker, transform: [{ translateY: auraDrift }] }]} />
            <Animated.View style={[styles.toxicBubble2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [1, -2] }) }] }]} />
            <Animated.View style={[styles.toxicBubble3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] }) }]} />
            <View style={styles.toxicGlow} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'holy' && (
          <Animated.View style={[styles.auraHoly, { transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.97, 1.03] }) }] }]}>
            <Animated.View style={[styles.holyRay1, { opacity: auraFlicker }]} />
            <Animated.View style={[styles.holyRay2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]} />
            <Animated.View style={[styles.holyRay3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] }) }]} />
            <View style={styles.holyGlow} />
          </Animated.View>
        )}
        {(a.aura || 'none') === 'void' && (
          <Animated.View style={[styles.auraVoid, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] }) }]}>
            <Animated.View style={[styles.voidRing, { transform: [{ scale: auraPulse }, { rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
            <Animated.View style={[styles.voidParticle1, { opacity: auraFlicker, transform: [{ translateY: auraDrift }] }]} />
            <Animated.View style={[styles.voidParticle2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }) }]} />
          </Animated.View>
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
const HPX = PX * 1.4; // hand items drawn bigger


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
    top: 5,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#0a0a14',
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
  tophat: { alignItems: 'center' as const, marginBottom: -6, zIndex: 5 },
  tophatTop: {
    width: PX * 5, height: PX * 4.5, borderRadius: 2,
    borderWidth: 0.5, borderColor: '#333',
  },
  tophatBand: {
    position: 'absolute' as const, bottom: PX * 0.5, left: 0, right: 0,
    height: PX * 0.8, backgroundColor: '#b91c1c', opacity: 0.8,
  },
  tophatBrim: { width: PX * 8.5, height: PX * 1.5, borderRadius: 1 },
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
    borderColor: '#3b3680',
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
    borderColor: '#3b3680',
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
    borderColor: '#4b45a0',
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
  dropShadow: { width: PX * 8, height: PX * 1.5, backgroundColor: '#1a1a3060', borderRadius: PX * 4, marginTop: 2 },
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
  wingInner: {
    position: 'absolute' as const,
    width: 0, height: 0,
    borderLeftWidth: PX * 1.8, borderRightWidth: PX * 1.8,
    borderBottomWidth: PX * 3,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  wingInnerLeft: { left: PX * 0.5, top: PX * 1 },
  wingInnerRight: { right: PX * 0.5, top: PX * 1 },
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
  nameContainer: {
    alignItems: 'center', marginTop: 2,
    backgroundColor: '#0a0a1499',
    paddingHorizontal: 4, paddingVertical: 1,
    borderRadius: 3,
  },
  name: {
    fontSize: 7,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  // Ground spotlight
  groundSpotlight: {
    position: 'absolute',
    bottom: 18,
    left: -2,
    right: -2,
    height: PX * 2,
    borderRadius: PX * 4,
    opacity: 0.12,
    zIndex: -2,
  },
  offlineOpacity: { opacity: 0.55 },


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

  // ── Pet Companions (enlarged + detailed) ────────────────────────────────
  petCat: { position: 'absolute', bottom: 14, right: -8, width: PX * 7, height: PX * 5.5, zIndex: -1 },
  catBody: { position: 'absolute', bottom: PX * 0.8, left: PX * 1.2, width: PX * 3.5, height: PX * 2, backgroundColor: '#f59e0b', borderRadius: PX * 0.8 },
  catBelly: { position: 'absolute', bottom: PX * 0.1, left: PX * 0.5, width: PX * 2, height: PX * 1, backgroundColor: '#fde68a', borderRadius: PX * 0.5, opacity: 0.7 },
  catStripe1: { position: 'absolute', top: PX * 0.2, left: PX * 0.8, width: PX * 2, height: PX * 0.25, backgroundColor: '#d97706', borderRadius: 1, opacity: 0.5 },
  catStripe2: { position: 'absolute', top: PX * 0.6, left: PX * 1, width: PX * 1.5, height: PX * 0.25, backgroundColor: '#d97706', borderRadius: 1, opacity: 0.4 },
  catHead: { position: 'absolute', bottom: PX * 2, left: PX * 0.2, width: PX * 2.2, height: PX * 2.2, backgroundColor: '#f59e0b', borderRadius: PX * 1 },
  catEyeLeft: { position: 'absolute', top: PX * 0.7, left: PX * 0.35, width: PX * 0.55, height: PX * 0.55, backgroundColor: '#22c55e', borderRadius: PX * 0.27 },
  catEyeRight: { position: 'absolute', top: PX * 0.7, right: PX * 0.35, width: PX * 0.55, height: PX * 0.55, backgroundColor: '#22c55e', borderRadius: PX * 0.27 },
  catPupilL: { position: 'absolute', top: PX * 0.8, left: PX * 0.5, width: PX * 0.25, height: PX * 0.4, backgroundColor: '#1a1a1a', borderRadius: PX * 0.12 },
  catPupilR: { position: 'absolute', top: PX * 0.8, right: PX * 0.5, width: PX * 0.25, height: PX * 0.4, backgroundColor: '#1a1a1a', borderRadius: PX * 0.12 },
  catNose: { position: 'absolute', top: PX * 1.2, left: PX * 0.85, width: PX * 0.4, height: PX * 0.25, backgroundColor: '#ec4899', borderRadius: PX * 0.2 },
  catMouth: { position: 'absolute', top: PX * 1.45, left: PX * 0.8, width: PX * 0.5, height: PX * 0.15, borderBottomWidth: 0.5, borderBottomColor: '#b4530960', borderRadius: PX * 0.1 },
  catWhiskerL1: { position: 'absolute', top: PX * 1.2, left: -PX * 0.6, width: PX * 1, height: 0.5, backgroundColor: '#d9770680', transform: [{ rotate: '-5deg' }] },
  catWhiskerL2: { position: 'absolute', top: PX * 1.35, left: -PX * 0.5, width: PX * 0.8, height: 0.5, backgroundColor: '#d9770660', transform: [{ rotate: '5deg' }] },
  catWhiskerR1: { position: 'absolute', top: PX * 1.2, right: -PX * 0.6, width: PX * 1, height: 0.5, backgroundColor: '#d9770680', transform: [{ rotate: '5deg' }] },
  catWhiskerR2: { position: 'absolute', top: PX * 1.35, right: -PX * 0.5, width: PX * 0.8, height: 0.5, backgroundColor: '#d9770660', transform: [{ rotate: '-5deg' }] },
  catEar: { position: 'absolute', top: -PX * 0.6, width: 0, height: 0, borderLeftWidth: PX * 0.55, borderRightWidth: PX * 0.55, borderBottomWidth: PX * 0.85, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#f59e0b' },
  catEarL: { left: PX * 0.1 },
  catEarR: { right: PX * 0.1 },
  catEarInner: { position: 'absolute', top: -PX * 0.35, width: 0, height: 0, borderLeftWidth: PX * 0.3, borderRightWidth: PX * 0.3, borderBottomWidth: PX * 0.5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fca5a5' },
  catEarInnerL: { left: PX * 0.25 },
  catEarInnerR: { right: PX * 0.25 },
  catLegFL: { position: 'absolute', bottom: 0, left: PX * 1.5, width: PX * 0.5, height: PX * 0.9, backgroundColor: '#f59e0b', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  catLegFR: { position: 'absolute', bottom: 0, left: PX * 2.3, width: PX * 0.5, height: PX * 0.9, backgroundColor: '#f59e0b', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  catLegBL: { position: 'absolute', bottom: 0, left: PX * 3.5, width: PX * 0.5, height: PX * 0.9, backgroundColor: '#d97706', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  catLegBR: { position: 'absolute', bottom: 0, left: PX * 4.2, width: PX * 0.5, height: PX * 0.9, backgroundColor: '#d97706', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  catTail: { position: 'absolute', bottom: PX * 1.2, left: PX * 4.2, width: PX * 2.5, height: PX * 0.5, backgroundColor: '#f59e0b', borderTopRightRadius: PX * 1.5, borderBottomRightRadius: PX * 0.5, transformOrigin: 'left center' },

  petDog: { position: 'absolute', bottom: 14, right: -10, width: PX * 8, height: PX * 6, zIndex: -1 },
  dogBody: { position: 'absolute', bottom: PX * 0.8, left: PX * 1.5, width: PX * 4, height: PX * 2.5, backgroundColor: '#a07020', borderRadius: PX * 1 },
  dogBelly: { position: 'absolute', bottom: PX * 0.1, left: PX * 0.5, width: PX * 2.5, height: PX * 1.2, backgroundColor: '#d4a44a', borderRadius: PX * 0.6, opacity: 0.6 },
  dogCollar: { position: 'absolute', top: PX * 0.15, left: PX * 0.2, width: PX * 3.6, height: PX * 0.35, backgroundColor: '#ef4444', borderRadius: 1 },
  dogCollarTag: { position: 'absolute', top: PX * 0.35, left: PX * 1.5, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#fef08a', borderRadius: PX * 0.2 },
  dogHead: { position: 'absolute', bottom: PX * 2.3, left: PX * 0.2, width: PX * 2.8, height: PX * 2.8, backgroundColor: '#a07020', borderRadius: PX * 1.2 },
  dogSnout: { position: 'absolute', bottom: PX * 0.3, left: PX * 0.2, width: PX * 1.8, height: PX * 1.2, backgroundColor: '#c49a3a', borderRadius: PX * 0.5 },
  dogNose: { position: 'absolute', bottom: PX * 1.1, left: PX * 0.5, width: PX * 0.6, height: PX * 0.4, backgroundColor: '#1a1a1a', borderRadius: PX * 0.3 },
  dogTongue: { position: 'absolute', bottom: PX * 0.1, left: PX * 0.7, width: PX * 0.5, height: PX * 0.6, backgroundColor: '#f472b6', borderBottomLeftRadius: PX * 0.25, borderBottomRightRadius: PX * 0.25 },
  dogEyeLeft: { position: 'absolute', top: PX * 0.6, left: PX * 0.5, width: PX * 0.55, height: PX * 0.55, backgroundColor: '#1a1a1a', borderRadius: PX * 0.27 },
  dogEyeRight: { position: 'absolute', top: PX * 0.6, right: PX * 0.5, width: PX * 0.55, height: PX * 0.55, backgroundColor: '#1a1a1a', borderRadius: PX * 0.27 },
  dogBrowL: { position: 'absolute', top: PX * 0.35, left: PX * 0.35, width: PX * 0.6, height: PX * 0.2, backgroundColor: '#6b4f10', borderRadius: 1 },
  dogBrowR: { position: 'absolute', top: PX * 0.35, right: PX * 0.35, width: PX * 0.6, height: PX * 0.2, backgroundColor: '#6b4f10', borderRadius: 1 },
  dogEar: { position: 'absolute', top: PX * 0.1, width: PX * 1, height: PX * 1.5, backgroundColor: '#7a5510', borderRadius: PX * 0.5, borderTopLeftRadius: PX * 0.3, borderTopRightRadius: PX * 0.3 },
  dogEarL: { left: -PX * 0.2 },
  dogEarR: { right: -PX * 0.2 },
  dogLegFL: { position: 'absolute', bottom: 0, left: PX * 1.8, width: PX * 0.6, height: PX * 1, backgroundColor: '#a07020', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  dogLegFR: { position: 'absolute', bottom: 0, left: PX * 2.8, width: PX * 0.6, height: PX * 1, backgroundColor: '#a07020', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  dogLegBL: { position: 'absolute', bottom: 0, left: PX * 4.2, width: PX * 0.6, height: PX * 1, backgroundColor: '#8a6518', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  dogLegBR: { position: 'absolute', bottom: 0, left: PX * 5, width: PX * 0.6, height: PX * 1, backgroundColor: '#8a6518', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  dogTail: { position: 'absolute', bottom: PX * 2, left: PX * 5.2, width: PX * 0.6, height: PX * 2, backgroundColor: '#a07020', borderTopRightRadius: PX * 1, borderTopLeftRadius: PX * 0.5, transformOrigin: 'center bottom' },

  petBird: { position: 'absolute', top: 8, right: -6, width: PX * 5.5, height: PX * 4.5, zIndex: 8 },
  birdBody: { position: 'absolute', bottom: PX * 0.6, left: PX * 1.2, width: PX * 2.5, height: PX * 2, backgroundColor: '#3b82f6', borderRadius: PX * 0.8 },
  birdChest: { position: 'absolute', bottom: PX * 0.2, left: PX * 0.3, width: PX * 1.5, height: PX * 1, backgroundColor: '#93c5fd', borderRadius: PX * 0.4, opacity: 0.7 },
  birdHead: { position: 'absolute', bottom: PX * 2, left: PX * 0.5, width: PX * 1.8, height: PX * 1.8, backgroundColor: '#3b82f6', borderRadius: PX * 0.9 },
  birdEye: { position: 'absolute', top: PX * 0.4, left: PX * 0.35, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#1a1a1a', borderRadius: PX * 0.25 },
  birdCrest: { position: 'absolute', top: -PX * 0.5, left: PX * 0.5, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#ef4444', borderTopLeftRadius: PX * 0.4, borderTopRightRadius: PX * 0.4, transform: [{ rotate: '-10deg' }] },
  birdWingL: { position: 'absolute', bottom: PX * 1.2, left: PX * 0.2, width: PX * 1.5, height: PX * 1, backgroundColor: '#60a5fa', borderRadius: PX * 0.4, transformOrigin: 'right center' },
  birdWingR: { position: 'absolute', bottom: PX * 1.2, right: PX * 0.5, width: PX * 1.5, height: PX * 1, backgroundColor: '#60a5fa', borderRadius: PX * 0.4, transformOrigin: 'left center' },
  birdBeak: { position: 'absolute', bottom: PX * 2.3, left: 0, width: 0, height: 0, borderTopWidth: PX * 0.4, borderBottomWidth: PX * 0.4, borderRightWidth: PX * 0.7, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: '#f59e0b' },
  birdTail: { position: 'absolute', bottom: PX * 1.2, left: PX * 3.2, width: PX * 1.2, height: PX * 0.8, backgroundColor: '#2563eb', borderTopRightRadius: PX * 0.8, borderBottomRightRadius: PX * 0.2, transform: [{ rotate: '15deg' }] },
  birdLegL: { position: 'absolute', bottom: 0, left: PX * 1.8, width: PX * 0.3, height: PX * 0.7, backgroundColor: '#f59e0b', borderBottomLeftRadius: PX * 0.1, borderBottomRightRadius: PX * 0.1 },
  birdLegR: { position: 'absolute', bottom: 0, left: PX * 2.6, width: PX * 0.3, height: PX * 0.7, backgroundColor: '#f59e0b', borderBottomLeftRadius: PX * 0.1, borderBottomRightRadius: PX * 0.1 },

  petRobot: { position: 'absolute', bottom: 14, right: -8, width: PX * 6, height: PX * 5.5, zIndex: -1 },
  robotBody: { position: 'absolute', bottom: PX * 0.8, left: PX * 0.8, width: PX * 3.2, height: PX * 2.8, backgroundColor: '#6b7280', borderRadius: PX * 0.4, borderWidth: 0.5, borderColor: '#9ca3af' },
  robotChest: { position: 'absolute' as const, bottom: PX * 0.5, left: PX * 0.6, width: PX * 2, height: PX * 0.6, backgroundColor: '#3b82f6', borderRadius: 1, opacity: 0.6, shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 0.6 },
  robotPanel: { position: 'absolute' as const, bottom: PX * 1.3, left: PX * 0.8, width: PX * 1.6, height: PX * 0.5, backgroundColor: '#4b5563', borderRadius: 1, borderWidth: 0.5, borderColor: '#6b7280' },
  robotBtn1: { position: 'absolute' as const, bottom: PX * 1.4, right: PX * 0.5, width: PX * 0.3, height: PX * 0.3, backgroundColor: '#22c55e', borderRadius: PX * 0.15 },
  robotBtn2: { position: 'absolute' as const, bottom: PX * 1.4, right: PX * 1, width: PX * 0.3, height: PX * 0.3, backgroundColor: '#ef4444', borderRadius: PX * 0.15 },
  robotEye: { position: 'absolute', top: PX * 0.5, width: PX * 0.7, height: PX * 0.7, backgroundColor: '#22c55e', borderRadius: PX * 0.35, shadowColor: '#22c55e', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 0.8 },
  robotLegL: { position: 'absolute', bottom: PX * 0.15, left: PX * 1.2, width: PX * 0.5, height: PX * 0.8, backgroundColor: '#6b7280' },
  robotLegR: { position: 'absolute', bottom: PX * 0.15, left: PX * 3, width: PX * 0.5, height: PX * 0.8, backgroundColor: '#6b7280' },
  robotFootL: { position: 'absolute', bottom: 0, left: PX * 1, width: PX * 0.8, height: PX * 0.25, backgroundColor: '#4b5563', borderRadius: PX * 0.1 },
  robotFootR: { position: 'absolute', bottom: 0, left: PX * 2.8, width: PX * 0.8, height: PX * 0.25, backgroundColor: '#4b5563', borderRadius: PX * 0.1 },
  robotAntenna: { position: 'absolute', bottom: PX * 3.6, left: PX * 2, width: PX * 0.3, height: PX * 1, backgroundColor: '#9ca3af' },
  robotAntennaDot: { position: 'absolute', bottom: PX * 4.4, left: PX * 1.8, width: PX * 0.7, height: PX * 0.7, backgroundColor: '#ef4444', borderRadius: PX * 0.35, shadowColor: '#ef4444', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 0.9 },
  robotArm: { position: 'absolute', bottom: PX * 1.5, right: PX * 0.2, width: PX * 0.4, height: PX * 1.5, backgroundColor: '#9ca3af', borderRadius: PX * 0.2 },

  // ── Aura Effects (animated + detailed) ──────────────────────────────────
  auraFire: { position: 'absolute', top: 0, left: -2, right: -2, bottom: 16, zIndex: -1 },
  flame1: { position: 'absolute', top: PX * 0.5, left: PX * 0.5, width: PX * 1.8, height: PX * 2.5, backgroundColor: '#ef444090', shadowColor: '#ef4440', shadowRadius: 8, shadowOpacity: 0.9, borderRadius: PX * 0.8, transform: [{ rotate: '-10deg' }] },
  flame2: { position: 'absolute', top: -PX * 0.3, right: PX * 1, width: PX * 1.5, height: PX * 2.2, backgroundColor: '#f9731690', shadowColor: '#f97316', shadowRadius: 7, shadowOpacity: 0.9, borderRadius: PX * 0.6, transform: [{ rotate: '12deg' }] },
  flame3: { position: 'absolute', top: PX * 1.5, left: PX * 3, width: PX * 1.2, height: PX * 1.8, backgroundColor: '#f59e0b80', shadowColor: '#f59e0b', shadowRadius: 5, shadowOpacity: 0.8, borderRadius: PX * 0.5 },
  flame4: { position: 'absolute', top: -PX * 0.8, left: PX * 2, width: PX * 1, height: PX * 1.5, backgroundColor: '#fef08a60', shadowColor: '#fef08a', shadowRadius: 4, shadowOpacity: 0.7, borderRadius: PX * 0.5, transform: [{ rotate: '5deg' }] },
  fireEmber1: { position: 'absolute', top: -PX * 1, left: PX * 1.5, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#fef08a', borderRadius: PX * 0.2, shadowColor: '#f97316', shadowRadius: 3, shadowOpacity: 1 },
  fireEmber2: { position: 'absolute', top: -PX * 0.5, right: PX * 0.5, width: PX * 0.3, height: PX * 0.3, backgroundColor: '#ef4444', borderRadius: PX * 0.15, shadowColor: '#ef4444', shadowRadius: 2, shadowOpacity: 1 },
  fireGlow: { position: 'absolute', bottom: 0, left: PX * 0.5, right: PX * 0.5, height: PX * 1.5, backgroundColor: '#ef444015', borderRadius: PX * 2, shadowColor: '#ef4444', shadowRadius: 12, shadowOpacity: 0.3 },

  auraIce: { position: 'absolute', top: 4, left: 0, right: 0, bottom: 16, borderWidth: 1.5, borderColor: '#06b6d480', shadowColor: '#06b6d4', shadowRadius: 12, shadowOpacity: 0.7, borderRadius: 6, zIndex: -1 },
  iceFlake1: { position: 'absolute', top: PX * 0.3, left: -1, width: PX * 1, height: PX * 1, backgroundColor: '#67e8f960', shadowColor: '#ffffff', shadowRadius: 4, shadowOpacity: 0.9, borderRadius: PX * 0.5 },
  iceFlake2: { position: 'absolute', bottom: PX * 2, right: -1, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#67e8f940', borderRadius: PX * 0.4, shadowColor: '#67e8f9', shadowRadius: 3, shadowOpacity: 0.6 },
  iceFlake3: { position: 'absolute', top: PX * 3, right: PX * 0.3, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#67e8f930', borderRadius: PX * 0.3 },
  iceFlake4: { position: 'absolute', top: PX * 1.5, left: PX * 3.5, width: PX * 0.7, height: PX * 0.7, backgroundColor: '#67e8f950', borderRadius: PX * 0.35, shadowColor: '#ffffff', shadowRadius: 2, shadowOpacity: 0.8 },
  iceMist: { position: 'absolute', bottom: 0, left: 0, right: 0, height: PX * 2, backgroundColor: '#06b6d4', borderRadius: PX, opacity: 0.15 },

  auraElectric: { position: 'absolute', top: 2, left: -4, right: -4, bottom: 16, zIndex: -1 },
  bolt1: { position: 'absolute', top: PX * 0.5, left: -1, width: PX * 2, height: 2.5, backgroundColor: '#fef08a', shadowColor: '#eab308', shadowRadius: 8, shadowOpacity: 1, transform: [{ rotate: '45deg' }] },
  bolt2: { position: 'absolute', top: PX * 3, right: -1, width: PX * 2.2, height: 2.5, backgroundColor: '#fef08a', shadowColor: '#eab308', shadowRadius: 8, shadowOpacity: 1, transform: [{ rotate: '-35deg' }] },
  bolt3: { position: 'absolute', top: PX * 1.5, left: PX * 2, width: PX * 1.5, height: 2, backgroundColor: '#fef08acc', shadowColor: '#eab308', shadowRadius: 6, shadowOpacity: 1, transform: [{ rotate: '70deg' }] },
  spark1: { position: 'absolute', top: PX * 0.2, left: PX * 3, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#fef08a', borderRadius: PX * 0.25, shadowColor: '#eab308', shadowRadius: 4, shadowOpacity: 1 },
  spark2: { position: 'absolute', top: PX * 2.5, left: -PX * 0.3, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#fef08a', borderRadius: PX * 0.2, shadowColor: '#eab308', shadowRadius: 3, shadowOpacity: 1 },
  spark3: { position: 'absolute', top: PX * 4, right: PX * 0.5, width: PX * 0.35, height: PX * 0.35, backgroundColor: '#fef08acc', borderRadius: PX * 0.17, shadowColor: '#eab308', shadowRadius: 2, shadowOpacity: 1 },
  electricGlow: { position: 'absolute', top: PX * 1, left: PX * 0.5, right: PX * 0.5, height: PX * 3, backgroundColor: '#eab30808', borderRadius: PX * 2, shadowColor: '#eab308', shadowRadius: 10, shadowOpacity: 0.15 },

  auraNature: { position: 'absolute', top: 2, left: -2, right: -2, bottom: 16, zIndex: -1 },
  leaf1: { position: 'absolute', top: PX * 0.3, left: -1, width: PX * 1.4, height: PX * 1.4, backgroundColor: '#4ade8090', shadowColor: '#22c55e', shadowRadius: 5, shadowOpacity: 0.7, borderRadius: PX * 0.7, transform: [{ rotate: '30deg' }] },
  leaf2: { position: 'absolute', top: PX * 3, right: -2, width: PX * 1.2, height: PX * 1.2, backgroundColor: '#22c55e50', borderRadius: PX * 0.6, transform: [{ rotate: '-20deg' }] },
  leaf3: { position: 'absolute', bottom: PX * 2.5, left: PX * 1, width: PX * 1, height: PX * 1, backgroundColor: '#22c55e40', borderRadius: PX * 0.5, transform: [{ rotate: '60deg' }] },
  leaf4: { position: 'absolute', top: PX * 1.5, right: PX * 1, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#86efac60', borderRadius: PX * 0.4, transform: [{ rotate: '-45deg' }] },
  natureVine: { position: 'absolute', bottom: PX * 1, left: PX * 0.5, width: PX * 4, height: PX * 0.3, backgroundColor: '#22c55e30', borderRadius: PX * 0.15, transform: [{ rotate: '-3deg' }] },
  natureGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#22c55e', borderRadius: 8, opacity: 0.1 },

  auraShadow: { position: 'absolute', top: 6, left: -2, right: -2, bottom: 10, zIndex: -1, overflow: 'hidden' as const },
  shadowWisp1: { position: 'absolute', top: PX * 1, left: PX * 0.5, width: PX * 2, height: PX * 0.8, backgroundColor: '#4c1d9530', borderRadius: PX * 2, transform: [{ rotate: '-5deg' }] },
  shadowWisp2: { position: 'absolute', top: PX * 3, right: PX * 0.3, width: PX * 1.5, height: PX * 0.6, backgroundColor: '#4c1d9525', borderRadius: PX * 1.5, transform: [{ rotate: '8deg' }] },
  shadowWisp3: { position: 'absolute', bottom: PX * 1, left: PX * 1, width: PX * 2.5, height: PX * 1, backgroundColor: '#4c1d9520', borderRadius: PX * 3 },

  // ── New Hats ─────────────────────────────────────────────
  spaceHelmet: { alignItems: 'center' as const, marginBottom: -6, zIndex: 5 },
  spaceHelmetDome: {
    width: PX * 9.5, height: PX * 5.5,
    borderTopLeftRadius: 14, borderTopRightRadius: 14,
    borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
    borderWidth: 1.5, borderColor: '#ffffff50',
    backgroundColor: '#ffffff08',
    shadowColor: '#60a5fa', shadowOffset: { width: 0, height: 0 }, shadowRadius: 6, shadowOpacity: 0.3,
  },
  spaceHelmetVisor: {
    width: PX * 7, height: PX * 2,
    backgroundColor: '#3b82f650', marginTop: -3,
    borderRadius: 2,
    borderWidth: 0.5, borderColor: '#60a5fa40',
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 0.5,
  },
  spaceHelmetHighlight: {
    position: 'absolute' as const, top: PX * 0.8, left: PX * 1.5,
    width: PX * 2, height: PX * 1,
    backgroundColor: '#ffffff20', borderRadius: PX * 0.5,
    transform: [{ rotate: '-20deg' }],
  },
  spaceHelmetRim: {
    width: PX * 10, height: PX * 1,
    backgroundColor: '#9ca3af40',
    borderRadius: 1, marginTop: -1,
    borderWidth: 0.5, borderColor: '#ffffff20',
  },
  spaceHelmetAntenna: {
    position: 'absolute' as const, top: -PX * 1.5, right: PX * 1.5,
    width: PX * 0.4, height: PX * 1.8, backgroundColor: '#9ca3af',
    borderRadius: 1,
  },
  spaceHelmetAntennaTip: {
    position: 'absolute' as const, top: -PX * 2.2, right: PX * 1.2,
    width: PX * 0.8, height: PX * 0.8, backgroundColor: '#ef4444',
    borderRadius: PX * 0.4,
    shadowColor: '#ef4444', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 0.8,
  },

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
  jetpackBody: {
    width: PX * 3, height: PX * 4, backgroundColor: '#6b7280',
    borderRadius: 2, borderWidth: 1, borderColor: '#4b5563',
  },
  jetpackDetail: {
    position: 'absolute' as const, top: PX * 0.5, left: PX * 0.5,
    width: PX * 0.8, height: PX * 0.8, backgroundColor: '#3b82f6',
    borderRadius: PX * 0.4,
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 0.6,
  },
  jetpackNozzle: { width: PX * 1.2, height: PX * 1, backgroundColor: '#4b5563', borderRadius: 1 },
  jetpackFlame: {
    width: PX * 1.5, height: PX * 2.5, backgroundColor: '#f97316',
    opacity: 0.7, borderBottomLeftRadius: PX, borderBottomRightRadius: PX,
    shadowColor: '#f97316', shadowOffset: { width: 0, height: 0 }, shadowRadius: 6, shadowOpacity: 0.9,
  },
  jetpackFlameInner: {
    position: 'absolute' as const, bottom: 0, left: PX * 0.3,
    width: PX * 0.9, height: PX * 1.5, backgroundColor: '#fbbf24',
    opacity: 0.8, borderBottomLeftRadius: PX * 0.5, borderBottomRightRadius: PX * 0.5,
  },

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

  // ── Pets (enlarged + detailed) ─────────────────────────────────────
  petDragon: { position: 'absolute', bottom: 14, right: -10, width: PX * 8, height: PX * 6.5, zIndex: -1 },
  dragonBody: {
    position: 'absolute', bottom: PX * 0.8, left: PX * 1.5, width: PX * 3.5, height: PX * 2.5,
    backgroundColor: '#dc2626', borderRadius: PX * 1,
    borderWidth: 0.5, borderColor: '#991b1b',
  },
  dragonBelly: {
    position: 'absolute' as const, bottom: PX * 0.2, left: PX * 0.5,
    width: PX * 2.2, height: PX * 1.2, backgroundColor: '#fca5a5',
    borderRadius: PX * 0.5, opacity: 0.6,
  },
  dragonSpine1: { position: 'absolute' as const, top: -PX * 0.3, left: PX * 0.8, width: PX * 0.4, height: PX * 0.5, backgroundColor: '#991b1b', borderTopLeftRadius: PX * 0.2, borderTopRightRadius: PX * 0.2 },
  dragonSpine2: { position: 'absolute' as const, top: -PX * 0.25, left: PX * 1.4, width: PX * 0.35, height: PX * 0.4, backgroundColor: '#991b1b', borderTopLeftRadius: PX * 0.2, borderTopRightRadius: PX * 0.2 },
  dragonSpine3: { position: 'absolute' as const, top: -PX * 0.2, left: PX * 2, width: PX * 0.3, height: PX * 0.35, backgroundColor: '#991b1b', borderTopLeftRadius: PX * 0.15, borderTopRightRadius: PX * 0.15 },
  dragonHead: {
    position: 'absolute', bottom: PX * 2.2, left: PX * 0.2,
    width: PX * 2.5, height: PX * 2.2, backgroundColor: '#dc2626',
    borderRadius: PX * 0.8, borderWidth: 0.5, borderColor: '#991b1b',
  },
  dragonEye: {
    position: 'absolute', top: PX * 0.4, left: PX * 0.6,
    width: PX * 0.7, height: PX * 0.55, backgroundColor: '#f59e0b',
    borderRadius: PX * 0.3,
    shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 0.9,
  },
  dragonPupil: {
    position: 'absolute', top: PX * 0.55, left: PX * 0.85,
    width: PX * 0.25, height: PX * 0.35, backgroundColor: '#1a1a1a',
    borderRadius: PX * 0.12,
  },
  dragonSnout: {
    position: 'absolute' as const, bottom: PX * 0.3, left: -PX * 0.4,
    width: PX * 1, height: PX * 0.7, backgroundColor: '#b91c1c',
    borderRadius: PX * 0.3,
  },
  dragonNostril: {
    position: 'absolute' as const, bottom: PX * 0.6, left: -PX * 0.2,
    width: PX * 0.2, height: PX * 0.2, backgroundColor: '#7f1d1d',
    borderRadius: PX * 0.1,
  },
  dragonHorn: {
    position: 'absolute' as const, top: -PX * 0.5, right: PX * 0.3,
    width: PX * 0.3, height: PX * 0.7, backgroundColor: '#d97706',
    borderTopLeftRadius: PX * 0.15, borderTopRightRadius: PX * 0.15,
    transform: [{ rotate: '15deg' }],
  },
  dragonWingL: {
    position: 'absolute', bottom: PX * 2, left: PX * 0.3,
    width: 0, height: 0,
    borderLeftWidth: PX * 2.5, borderBottomWidth: PX * 2.5,
    borderLeftColor: 'transparent', borderBottomColor: '#dc262670',
    transformOrigin: 'right bottom',
  },
  dragonWingR: {
    position: 'absolute', bottom: PX * 2, left: PX * 3.5,
    width: 0, height: 0,
    borderRightWidth: PX * 2.5, borderBottomWidth: PX * 2.5,
    borderRightColor: 'transparent', borderBottomColor: '#dc262670',
    transformOrigin: 'left bottom',
  },
  dragonLegFL: { position: 'absolute', bottom: 0, left: PX * 1.8, width: PX * 0.6, height: PX * 1, backgroundColor: '#dc2626', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  dragonLegFR: { position: 'absolute', bottom: 0, left: PX * 3.5, width: PX * 0.6, height: PX * 1, backgroundColor: '#b91c1c', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  dragonTail: {
    position: 'absolute', bottom: PX * 0.8, left: PX * 4.5, width: PX * 3, height: PX * 0.6,
    backgroundColor: '#dc2626', borderTopRightRadius: PX * 1.5, borderBottomRightRadius: PX * 0.3,
    transformOrigin: 'left center',
  },
  dragonTailTip: {
    position: 'absolute' as const, bottom: PX * 0.5, left: PX * 7.2,
    width: PX * 0.8, height: PX * 0.8, backgroundColor: '#f97316',
    borderRadius: PX * 0.4,
    shadowColor: '#f97316', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 0.9,
  },
  dragonBreath: {
    position: 'absolute' as const, bottom: PX * 3.2, left: -PX * 1.5,
    width: PX * 1.2, height: PX * 0.5, backgroundColor: '#f9731680',
    borderRadius: PX * 0.3,
    shadowColor: '#f97316', shadowOffset: { width: 0, height: 0 }, shadowRadius: 3, shadowOpacity: 0.6,
  },

  petAlien: { position: 'absolute', bottom: 14, right: -8, width: PX * 6, height: PX * 5.5, zIndex: -1 },
  alienBody: { position: 'absolute', bottom: PX * 0.6, left: PX * 0.8, width: PX * 2.8, height: PX * 2, backgroundColor: '#22c55e', borderRadius: PX * 0.6 },
  alienBelt: { position: 'absolute' as const, bottom: PX * 0.6, left: PX * 0.2, width: PX * 2.4, height: PX * 0.3, backgroundColor: '#6b7280', borderRadius: 1 },
  alienGem: { position: 'absolute' as const, bottom: PX * 0.5, left: PX * 1, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#8b5cf6', borderRadius: PX * 0.2, shadowColor: '#8b5cf6', shadowRadius: 3, shadowOpacity: 0.8 },
  alienHead: { position: 'absolute', bottom: PX * 2, left: PX * 0.2, width: PX * 3.2, height: PX * 2.8, backgroundColor: '#22c55e', borderRadius: PX * 1.5, borderTopLeftRadius: PX * 1.8, borderTopRightRadius: PX * 1.8 },
  alienEye: { position: 'absolute', top: PX * 0.7, width: PX * 0.9, height: PX * 0.9, backgroundColor: '#1a1a1a', borderRadius: PX * 0.45, shadowColor: '#1a1a1a', shadowRadius: 2, shadowOpacity: 0.5 },
  alienPupil: { position: 'absolute', top: PX * 0.85, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#6366f1', borderRadius: PX * 0.2, shadowColor: '#6366f1', shadowRadius: 2, shadowOpacity: 0.8 },
  alienMouth: { position: 'absolute', bottom: PX * 0.4, left: PX * 1.2, width: PX * 0.6, height: PX * 0.25, backgroundColor: '#16a34a', borderRadius: PX * 0.12, opacity: 0.5 },
  alienAntennaL: { position: 'absolute', bottom: PX * 4.5, left: PX * 0.6, width: PX * 0.25, height: PX * 1, backgroundColor: '#22c55e', transform: [{ rotate: '-15deg' }] },
  alienAntennaR: { position: 'absolute', bottom: PX * 4.5, right: PX * 1.2, width: PX * 0.25, height: PX * 1, backgroundColor: '#22c55e', transform: [{ rotate: '15deg' }] },
  alienAntennaTipL: { position: 'absolute', bottom: PX * 5.3, left: PX * 0.3, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#6366f1', borderRadius: PX * 0.25, shadowColor: '#6366f1', shadowRadius: 4, shadowOpacity: 0.9 },
  alienAntennaTipR: { position: 'absolute', bottom: PX * 5.3, right: PX * 1, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#6366f1', borderRadius: PX * 0.25, shadowColor: '#6366f1', shadowRadius: 4, shadowOpacity: 0.9 },
  alienLegL: { position: 'absolute', bottom: 0, left: PX * 1.2, width: PX * 0.5, height: PX * 0.7, backgroundColor: '#22c55e', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },
  alienLegR: { position: 'absolute', bottom: 0, left: PX * 2.5, width: PX * 0.5, height: PX * 0.7, backgroundColor: '#16a34a', borderBottomLeftRadius: PX * 0.2, borderBottomRightRadius: PX * 0.2 },

  // ── Auras (animated) ────────────────────────────────────────────
  auraRainbow: { position: 'absolute', top: 0, left: -4, right: -4, bottom: 16, zIndex: -1 },
  rainbowArc: { position: 'absolute', left: 0, right: 0, height: PX * 0.6, borderRadius: PX * 0.3 },
  rainbowShimmer: { position: 'absolute', top: 0, left: PX * 1, width: PX * 2, height: PX * 3, backgroundColor: '#ffffff', borderRadius: PX, opacity: 0.2 },

  auraGlitch: { position: 'absolute', top: 2, left: -2, right: -2, bottom: 16, zIndex: -1 },
  glitchRect: { position: 'absolute' },
  glitchScanline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#ffffff30' },

  auraCosmic: { position: 'absolute', top: 0, left: -4, right: -4, bottom: 16, zIndex: -1 },
  cosmicStar1: { position: 'absolute', top: PX * 0.3, left: -2, width: PX * 0.7, height: PX * 0.7, backgroundColor: '#fef08a', borderRadius: PX * 0.35, shadowColor: '#fef08a', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 1 },
  cosmicStar2: { position: 'absolute', top: PX * 2, right: -2, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#fef08a90', borderRadius: PX * 0.3, shadowColor: '#fef08a', shadowRadius: 3, shadowOpacity: 0.8 },
  cosmicStar3: { position: 'absolute', top: PX * 4, left: PX * 1, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#fef08a70', borderRadius: PX * 0.25, shadowColor: '#fef08a', shadowRadius: 2, shadowOpacity: 0.6 },
  cosmicStar4: { position: 'absolute', top: PX * 1.5, left: PX * 4, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#ffffff90', borderRadius: PX * 0.2, shadowColor: '#ffffff', shadowRadius: 2, shadowOpacity: 0.8 },
  cosmicStar5: { position: 'absolute', top: PX * 3.5, right: PX * 0.3, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#fef08a60', borderRadius: PX * 0.3 },
  cosmicNebula: { position: 'absolute', top: PX * 1, left: PX * 0.5, width: PX * 4, height: PX * 3, backgroundColor: '#8b5cf6', borderRadius: PX * 2, opacity: 0.1 },
  cosmicRing: { position: 'absolute', top: PX * 0.5, left: 0, right: 0, height: PX * 5, borderWidth: 1, borderColor: '#fef08a20', borderRadius: PX * 5 },

  // ── Hand Items (HPX = 1.4x bigger) ─────────────────────────
  handLightsaber: { position: 'absolute', right: -HPX * 2.5, bottom: HPX * 0.5, zIndex: 3, alignItems: 'center' as const },
  lightsaberGlow: {
    position: 'absolute' as const, top: 0, left: -HPX * 0.5,
    width: HPX * 1.5, height: HPX * 6.5,
    borderRadius: HPX * 0.75, opacity: 0.25,
  },
  lightsaberBlade: {
    width: HPX * 0.7, height: HPX * 6,
    borderRadius: HPX * 0.35,
    shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 1,
  },
  lightsaberCore: {
    position: 'absolute' as const, top: HPX * 5.8, left: HPX * 0.05,
    width: HPX * 0.6, height: HPX * 0.6,
    borderRadius: HPX * 0.3, opacity: 0.9,
  },
  lightsaberHilt: {
    width: HPX * 1.2, height: HPX * 2,
    backgroundColor: '#374151', borderRadius: 1,
    borderWidth: 0.5, borderColor: '#6b7280',
  },
  lightsaberGuard: {
    width: HPX * 1.8, height: HPX * 0.4,
    backgroundColor: '#6b7280', borderRadius: 1,
    marginTop: -1,
  },
  lightsaberGrip1: {
    position: 'absolute' as const, bottom: HPX * 0.5, left: HPX * 0.15,
    width: HPX * 0.9, height: HPX * 0.2,
    backgroundColor: '#1f2937', borderRadius: 0.5,
  },
  lightsaberGrip2: {
    position: 'absolute' as const, bottom: HPX * 0.9, left: HPX * 0.15,
    width: HPX * 0.9, height: HPX * 0.2,
    backgroundColor: '#1f2937', borderRadius: 0.5,
  },

  handCoffee: { position: 'absolute', right: -HPX * 2, bottom: 0, zIndex: 3 },
  handCoffeeBody: {
    width: HPX * 1.8, height: HPX * 2, backgroundColor: '#f5f5f4',
    borderRadius: 2, borderWidth: 0.5, borderColor: '#9ca3af',
  },
  handCoffeeLid: {
    position: 'absolute' as const, top: -HPX * 0.3, left: -HPX * 0.1,
    width: HPX * 2, height: HPX * 0.5, backgroundColor: '#78350f',
    borderRadius: 1, borderWidth: 0.5, borderColor: '#92400e',
  },
  handCoffeeHandle: {
    position: 'absolute', right: -HPX * 0.6, top: HPX * 0.4,
    width: HPX * 0.6, height: HPX * 1.2, borderWidth: 0.5,
    borderColor: '#9ca3af', borderRadius: HPX * 0.3, backgroundColor: 'transparent',
  },
  handCoffeeSteam: {
    position: 'absolute' as const, top: -HPX * 1.2, left: HPX * 0.5,
    width: HPX * 0.3, height: HPX * 0.8, backgroundColor: '#ffffff30',
    borderRadius: HPX * 0.15,
  },

  handLaptop: { position: 'absolute', right: -HPX * 2.5, bottom: -HPX * 0.5, zIndex: 3 },
  handLaptopScreen: {
    width: HPX * 2.5, height: HPX * 1.8, backgroundColor: '#0f172a',
    borderWidth: 0.5, borderColor: '#334155',
    borderTopLeftRadius: 2, borderTopRightRadius: 2,
    shadowColor: '#60a5fa', shadowOffset: { width: 0, height: 0 }, shadowRadius: 4, shadowOpacity: 0.3,
  },
  handLaptopScreenGlow: {
    position: 'absolute' as const, top: HPX * 0.3, left: HPX * 0.3,
    width: HPX * 1.9, height: HPX * 0.3, backgroundColor: '#3b82f640',
    borderRadius: 1,
  },
  handLaptopBase: {
    width: HPX * 2.8, height: HPX * 0.5, backgroundColor: '#6b7280',
    borderBottomLeftRadius: 1, borderBottomRightRadius: 1,
    borderWidth: 0.5, borderColor: '#4b5563',
  },

  handFlag: { position: 'absolute', right: -HPX * 2, bottom: 0, zIndex: 3 },
  handFlagPole: { width: HPX * 0.3, height: HPX * 4, backgroundColor: '#6b7280' },
  handFlagCloth: { position: 'absolute', top: 0, left: HPX * 0.3, width: HPX * 2, height: HPX * 1.5, borderTopRightRadius: 1, borderBottomRightRadius: 1 },

  handWand: { position: 'absolute', right: -HPX * 2, bottom: 0, zIndex: 3 },
  handWandStick: {
    width: HPX * 0.5, height: HPX * 3.5, backgroundColor: '#78350f',
    borderRadius: 1, transform: [{ rotate: '-15deg' }],
    borderWidth: 0.5, borderColor: '#92400e',
  },
  handWandSpark: {
    position: 'absolute', top: -HPX * 0.8, left: HPX * 0.3,
    width: HPX * 1, height: HPX * 1, backgroundColor: '#fef08a',
    borderRadius: HPX * 0.5,
    shadowColor: '#fef08a', shadowOffset: { width: 0, height: 0 }, shadowRadius: 6, shadowOpacity: 1,
  },
  handWandSpark2: {
    position: 'absolute' as const, top: -HPX * 0.3, left: HPX * 1.2,
    width: HPX * 0.4, height: HPX * 0.4, backgroundColor: '#fde68a80',
    borderRadius: HPX * 0.2,
  },
  handWandSpark3: {
    position: 'absolute' as const, top: HPX * 0.2, left: -HPX * 0.2,
    width: HPX * 0.3, height: HPX * 0.3, backgroundColor: '#fde68a60',
    borderRadius: HPX * 0.15,
  },

  // ── Crab Claws (hand item) ─────────────────────────────────────────
  handCrabClaws: { position: 'absolute', right: -HPX * 2.5, bottom: HPX * 0.5, zIndex: 3, alignItems: 'center' as const },
  handCrabArm: { width: HPX * 0.6, height: HPX * 2, backgroundColor: '#ef4444', borderRadius: 1, transform: [{ rotate: '-10deg' }] },
  handCrabClawTop: {
    position: 'absolute', top: -HPX * 0.8, left: -HPX * 0.6,
    width: HPX * 1.5, height: HPX * 0.7, backgroundColor: '#ef4444',
    borderTopLeftRadius: HPX * 0.8, borderTopRightRadius: HPX * 0.3,
    transform: [{ rotate: '-20deg' }],
  },
  handCrabClawBot: {
    position: 'absolute', top: -HPX * 0.1, left: -HPX * 0.6,
    width: HPX * 1.5, height: HPX * 0.7, backgroundColor: '#dc2626',
    borderBottomLeftRadius: HPX * 0.8, borderBottomRightRadius: HPX * 0.3,
    transform: [{ rotate: '10deg' }],
  },

  // ── Crab Helmet (hat) ──────────────────────────────────────────────
  crabHelmet: { alignItems: 'center' as const, marginBottom: -8, zIndex: 5, width: PX * 10, height: PX * 5 },
  crabHelmetShell: {
    position: 'absolute', bottom: 0, left: PX * 1, right: PX * 1,
    height: PX * 3.5, backgroundColor: '#ef4444',
    borderTopLeftRadius: PX * 4, borderTopRightRadius: PX * 4,
    borderWidth: 1, borderColor: '#b91c1c',
  },
  crabHelmetHighlight: {
    position: 'absolute', bottom: PX * 1.5, left: PX * 2.5,
    width: PX * 3, height: PX * 1.2, backgroundColor: '#f87171',
    borderRadius: PX * 1, opacity: 0.5,
  },
  crabHelmetEyeStalkL: {
    position: 'absolute', bottom: PX * 3, left: PX * 1.5,
    width: PX * 0.4, height: PX * 1.5, backgroundColor: '#ef4444',
    transform: [{ rotate: '-15deg' }],
  },
  crabHelmetEyeStalkR: {
    position: 'absolute', bottom: PX * 3, right: PX * 1.5,
    width: PX * 0.4, height: PX * 1.5, backgroundColor: '#ef4444',
    transform: [{ rotate: '15deg' }],
  },
  crabHelmetEye: {
    position: 'absolute', bottom: PX * 4.2,
    width: PX * 0.8, height: PX * 0.8, backgroundColor: '#1a1a1a',
    borderRadius: PX * 0.4,
  },
  crabHelmetClawL: {
    position: 'absolute', bottom: PX * 0.5, left: 0,
    width: PX * 1.2, height: PX * 1.5, backgroundColor: '#dc2626',
    borderRadius: PX * 0.6, transform: [{ rotate: '10deg' }],
  },
  crabHelmetClawR: {
    position: 'absolute', bottom: PX * 0.5, right: 0,
    width: PX * 1.2, height: PX * 1.5, backgroundColor: '#dc2626',
    borderRadius: PX * 0.6, transform: [{ rotate: '-10deg' }],
  },

  // ── Crab Shell (back item) ─────────────────────────────────────────
  crabBackShell: {
    position: 'absolute', top: PX * 1, left: PX * 0.5, right: PX * 0.5,
    height: PX * 6, backgroundColor: '#ef4444',
    borderRadius: PX * 3, zIndex: -1,
    borderWidth: 1, borderColor: '#b91c1c',
  },
  crabBackShellInner: {
    position: 'absolute', top: PX * 1, left: PX * 1, right: PX * 1,
    height: PX * 3, backgroundColor: '#f87171',
    borderRadius: PX * 2, opacity: 0.4,
  },
  crabBackShellRidge1: {
    position: 'absolute', top: PX * 1.5, left: PX * 0.8, right: PX * 0.8,
    height: PX * 0.3, backgroundColor: '#dc2626', borderRadius: 1, opacity: 0.5,
  },
  crabBackShellRidge2: {
    position: 'absolute', top: PX * 2.5, left: PX * 0.5, right: PX * 0.5,
    height: PX * 0.3, backgroundColor: '#dc2626', borderRadius: 1, opacity: 0.4,
  },
  crabBackShellRidge3: {
    position: 'absolute', top: PX * 3.5, left: PX * 0.8, right: PX * 0.8,
    height: PX * 0.3, backgroundColor: '#dc2626', borderRadius: 1, opacity: 0.3,
  },

  // ── Crab Pet ───────────────────────────────────────────────────────
  petCrab: { position: 'absolute', bottom: 14, right: -10, width: PX * 8, height: PX * 5.5, zIndex: -1 },
  crabShell: {
    position: 'absolute', bottom: PX * 1, left: PX * 1.5,
    width: PX * 3.5, height: PX * 2.2, backgroundColor: '#ef4444',
    borderTopLeftRadius: PX * 1.8, borderTopRightRadius: PX * 1.8,
    borderBottomLeftRadius: PX * 0.5, borderBottomRightRadius: PX * 0.5,
    borderWidth: 0.5, borderColor: '#b91c1c',
  },
  crabShellHighlight: {
    position: 'absolute', top: PX * 0.3, left: PX * 0.5,
    width: PX * 1.8, height: PX * 0.8, backgroundColor: '#f87171',
    borderRadius: PX * 0.5, opacity: 0.5,
  },
  crabShellPattern1: {
    position: 'absolute', top: PX * 0.8, left: PX * 0.3, right: PX * 0.3,
    height: PX * 0.2, backgroundColor: '#dc2626', borderRadius: 1, opacity: 0.4,
  },
  crabShellPattern2: {
    position: 'absolute', top: PX * 1.3, left: PX * 0.5, right: PX * 0.5,
    height: PX * 0.2, backgroundColor: '#dc2626', borderRadius: 1, opacity: 0.3,
  },
  // Eyes
  crabEyeStalkL: {
    position: 'absolute', bottom: PX * 2.8, left: PX * 2,
    width: PX * 0.3, height: PX * 1, backgroundColor: '#ef4444',
    transform: [{ rotate: '-10deg' }],
  },
  crabEyeStalkR: {
    position: 'absolute', bottom: PX * 2.8, left: PX * 4,
    width: PX * 0.3, height: PX * 1, backgroundColor: '#ef4444',
    transform: [{ rotate: '10deg' }],
  },
  crabEye: {
    position: 'absolute', bottom: PX * 3.6,
    width: PX * 0.6, height: PX * 0.6, backgroundColor: '#fef3c7',
    borderRadius: PX * 0.3, borderWidth: 0.5, borderColor: '#1a1a1a',
  },
  crabEyeL: { left: PX * 1.7 },
  crabEyeR: { left: PX * 3.7 },
  crabPupil: {
    position: 'absolute', bottom: PX * 3.7,
    width: PX * 0.3, height: PX * 0.3, backgroundColor: '#1a1a1a',
    borderRadius: PX * 0.15,
  },
  crabPupilL: { left: PX * 1.85 },
  crabPupilR: { left: PX * 3.85 },
  // Claws
  crabClawL: {
    position: 'absolute', bottom: PX * 1.5, left: -PX * 0.5,
    width: PX * 2, height: PX * 1.5,
    transformOrigin: 'right center',
  },
  crabClawR: {
    position: 'absolute', bottom: PX * 1.5, right: PX * 0.5,
    width: PX * 2, height: PX * 1.5,
    transformOrigin: 'left center',
  },
  crabClawPincerTop: {
    position: 'absolute', top: 0, left: 0,
    width: PX * 1.8, height: PX * 0.7, backgroundColor: '#ef4444',
    borderTopLeftRadius: PX * 1, borderTopRightRadius: PX * 0.3,
    borderWidth: 0.5, borderColor: '#b91c1c',
  },
  crabClawPincerBot: {
    position: 'absolute', bottom: 0, left: 0,
    width: PX * 1.8, height: PX * 0.7, backgroundColor: '#dc2626',
    borderBottomLeftRadius: PX * 1, borderBottomRightRadius: PX * 0.3,
    borderWidth: 0.5, borderColor: '#991b1b',
  },
  // Legs
  crabLeg1L: { position: 'absolute', bottom: PX * 0.2, left: PX * 1.2, width: PX * 1.5, height: PX * 0.3, backgroundColor: '#ef4444', borderRadius: 1, transform: [{ rotate: '-25deg' }] },
  crabLeg2L: { position: 'absolute', bottom: PX * 0.6, left: PX * 0.8, width: PX * 1.5, height: PX * 0.3, backgroundColor: '#ef4444', borderRadius: 1, transform: [{ rotate: '-15deg' }] },
  crabLeg3L: { position: 'absolute', bottom: PX * 1, left: PX * 0.5, width: PX * 1.3, height: PX * 0.3, backgroundColor: '#ef4444', borderRadius: 1, transform: [{ rotate: '-5deg' }] },
  crabLeg1R: { position: 'absolute', bottom: PX * 0.2, right: PX * 0.5, width: PX * 1.5, height: PX * 0.3, backgroundColor: '#dc2626', borderRadius: 1, transform: [{ rotate: '25deg' }] },
  crabLeg2R: { position: 'absolute', bottom: PX * 0.6, right: PX * 0.2, width: PX * 1.5, height: PX * 0.3, backgroundColor: '#dc2626', borderRadius: 1, transform: [{ rotate: '15deg' }] },
  crabLeg3R: { position: 'absolute', bottom: PX * 1, right: 0, width: PX * 1.3, height: PX * 0.3, backgroundColor: '#dc2626', borderRadius: 1, transform: [{ rotate: '5deg' }] },

  // ── New Hair Styles ─────────────────────────────────────────
  hairBuzzcut: { height: PX * 1.2, borderRadius: 1 },
  hairAfro: { width: PX * 9, height: PX * 5, borderRadius: PX * 4.5, marginTop: -PX * 1.5, marginLeft: -PX * 1 },
  hairUndercut: { height: PX * 2, borderTopLeftRadius: 2, borderTopRightRadius: 2, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  hairPigtails: { height: PX * 2, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  pigtailBundleL: { position: 'absolute', top: PX * 5, left: -PX * 1, width: PX * 1.5, height: PX * 2.5, borderRadius: PX * 0.8 },
  pigtailBundleR: { position: 'absolute', top: PX * 5, right: -PX * 1, width: PX * 1.5, height: PX * 2.5, borderRadius: PX * 0.8 },

  // ── New Hats (pirate, cowboy, fez, mohawk spikes) ──────────
  pirateHat: { alignItems: 'center' as const, marginBottom: -6, zIndex: 5 },
  pirateHatCrown: { width: PX * 7, height: PX * 3, backgroundColor: '#1a1a1a', borderTopLeftRadius: PX * 3, borderTopRightRadius: PX * 3 },
  pirateHatBrim: { width: PX * 9, height: PX * 1.2, backgroundColor: '#1a1a1a', borderRadius: 1, marginTop: -1 },
  pirateHatSkull: { position: 'absolute', top: PX * 0.8, left: PX * 2.5, width: PX * 1.5, height: PX * 1.5, backgroundColor: '#ffffff60', borderRadius: PX * 0.75 },

  cowboyHat: { alignItems: 'center' as const, marginBottom: -6, zIndex: 5 },
  cowboyHatCrown: { width: PX * 5, height: PX * 2.5, backgroundColor: '#92400e', borderTopLeftRadius: PX * 2, borderTopRightRadius: PX * 2 },
  cowboyHatBrim: { width: PX * 10, height: PX * 1.2, backgroundColor: '#78350f', borderRadius: PX * 0.6, marginTop: -1 },

  fez: { alignItems: 'center' as const, marginBottom: -6, zIndex: 5 },
  fezBody: { width: PX * 5, height: PX * 3.5, backgroundColor: '#dc2626', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  fezTassel: { position: 'absolute', top: 0, right: -PX * 1.5, width: PX * 0.4, height: PX * 2, backgroundColor: '#1a1a1a', borderRadius: 1, transform: [{ rotate: '20deg' }] },

  mohawkSpikes: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, marginBottom: -6, zIndex: 5, gap: 1 },
  spike: { width: PX * 1.2, height: PX * 2, backgroundColor: '#9ca3af', borderTopLeftRadius: PX * 0.5, borderTopRightRadius: PX * 0.5 },

  // ── New Accessories (chain, piercing, visor, gas mask) ─────
  accessoryChain: { position: 'absolute', bottom: -PX * 1, left: PX * 1, flexDirection: 'row' as const, gap: 1, zIndex: 2 },
  chainLink1: { width: PX * 0.8, height: PX * 0.8, borderWidth: 0.8, borderColor: '#d4a017', borderRadius: PX * 0.4 },
  chainLink2: { width: PX * 0.8, height: PX * 0.8, borderWidth: 0.8, borderColor: '#d4a017', borderRadius: PX * 0.4, marginTop: PX * 0.2 },
  chainLink3: { width: PX * 0.8, height: PX * 0.8, borderWidth: 0.8, borderColor: '#d4a017', borderRadius: PX * 0.4 },

  accessoryPiercing: { position: 'absolute', bottom: PX * 0.5, right: PX * 0.8, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#c0c0c0', borderRadius: PX * 0.3, borderWidth: 0.5, borderColor: '#9ca3af', zIndex: 3 },

  accessoryVisor: { position: 'absolute', top: 0, left: -PX * 0.3, right: -PX * 0.3, height: PX * 1.8, backgroundColor: '#1a1a1acc', borderRadius: 2, zIndex: 3 },
  visorStripe: { position: 'absolute', top: PX * 0.5, left: 0, right: 0, height: PX * 0.4, backgroundColor: '#3b82f680' },

  accessoryGasMask: { position: 'absolute', bottom: -PX * 0.5, left: 0, right: 0, height: PX * 3, backgroundColor: '#4b5563', borderRadius: 2, zIndex: 3 },
  gasMaskFilterL: { position: 'absolute', bottom: PX * 0.3, left: -PX * 0.8, width: PX * 1, height: PX * 1.5, backgroundColor: '#374151', borderRadius: PX * 0.3 },
  gasMaskFilterR: { position: 'absolute', bottom: PX * 0.3, right: -PX * 0.8, width: PX * 1, height: PX * 1.5, backgroundColor: '#374151', borderRadius: PX * 0.3 },
  gasMaskVent: { position: 'absolute', bottom: PX * 0.2, left: PX * 1.5, width: PX * 2.5, height: PX * 0.6, backgroundColor: '#1f2937', borderRadius: 1 },

  // ── New Expressions ────────────────────────────────────────
  surprisedEye: { width: PX * 1.5, height: PX * 1.8, borderRadius: PX * 0.75 },
  smirkEyeL: { width: PX * 1.2, height: PX * 1.2 },
  smirkEyeR: { width: PX * 1.4, height: PX * 1, borderRadius: PX * 0.5 },
  cryingEye: { width: PX * 1.2, height: PX * 1.6, borderBottomLeftRadius: PX * 0.3, borderBottomRightRadius: PX * 0.3 },
  surprisedMouth: { width: PX * 1.2, height: PX * 1.2, borderRadius: PX * 0.6, backgroundColor: '#1a1a1a' },
  smirkMouth: { width: PX * 2, height: PX * 0.6, borderBottomRightRadius: 3, backgroundColor: '#c4956a', transform: [{ rotate: '5deg' }] },
  cryingMouth: { width: PX * 2, height: PX * 0.8, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#1a1a1a' },
  tear: { position: 'absolute', bottom: PX * 0.5, width: PX * 0.4, height: PX * 1, backgroundColor: '#60a5fa80', borderRadius: PX * 0.2 },

  // ── New Facial Hair ────────────────────────────────────────
  fuManchuRow: { flexDirection: 'row' as const, position: 'absolute', bottom: -PX * 0.5, gap: PX * 0.8 },
  fuManchuHalf: { width: PX * 0.5, height: PX * 2.5, borderRadius: 1 },
  sideburn: { position: 'absolute', width: PX * 0.8, height: PX * 2, borderBottomLeftRadius: PX * 0.3, borderBottomRightRadius: PX * 0.3 },
  sideburnL: { left: -PX * 0.2, top: PX * 0.5 },
  sideburnR: { right: -PX * 0.2, top: PX * 0.5 },
  soulPatch: { position: 'absolute', bottom: -PX * 0.8, width: PX * 0.8, height: PX * 0.8, borderRadius: PX * 0.4, alignSelf: 'center' },

  // ── New Back Items ─────────────────────────────────────────
  tentacles: { position: 'absolute', top: 30, left: 2, zIndex: -1, flexDirection: 'row' as const, gap: 1 },
  tentacle: { width: PX * 0.6, height: PX * 5, backgroundColor: '#8b5cf6', borderRadius: PX * 0.3, borderBottomLeftRadius: PX * 1, borderBottomRightRadius: PX * 1 },

  rocketPack: { position: 'absolute', top: 28, right: 2, zIndex: -1, alignItems: 'center' as const },
  rocketBody: { width: PX * 2.5, height: PX * 4, backgroundColor: '#f5f5f4', borderRadius: PX * 1, borderWidth: 1, borderColor: '#d4d4d4' },
  rocketNose: { position: 'absolute', top: -PX * 1, width: 0, height: 0, borderLeftWidth: PX * 1.25, borderRightWidth: PX * 1.25, borderBottomWidth: PX * 1.5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ef4444' },
  rocketFlame: { width: PX * 1.5, height: PX * 2, backgroundColor: '#f97316', borderBottomLeftRadius: PX * 0.5, borderBottomRightRadius: PX * 0.5, opacity: 0.8, shadowColor: '#f97316', shadowRadius: 4, shadowOpacity: 0.8 },

  scrollBack: { position: 'absolute', top: 28, right: 4, zIndex: -1, alignItems: 'center' as const },
  scrollBody: { width: PX * 2, height: PX * 5, backgroundColor: '#fef3c7', borderWidth: 0.5, borderColor: '#d97706' },
  scrollCapTop: { position: 'absolute', top: -PX * 0.3, width: PX * 2.5, height: PX * 0.6, backgroundColor: '#92400e', borderRadius: PX * 0.3 },
  scrollCapBot: { position: 'absolute', bottom: -PX * 0.3, width: PX * 2.5, height: PX * 0.6, backgroundColor: '#92400e', borderRadius: PX * 0.3 },

  boombox: { position: 'absolute', top: 30, left: 2, zIndex: -1, alignItems: 'center' as const },
  boomboxBody: { width: PX * 5, height: PX * 3, backgroundColor: '#374151', borderRadius: 2, borderWidth: 1, borderColor: '#4b5563' },
  boomboxSpeakerL: { position: 'absolute', top: PX * 0.5, left: PX * 0.3, width: PX * 1.2, height: PX * 1.2, backgroundColor: '#1f2937', borderRadius: PX * 0.6, borderWidth: 0.5, borderColor: '#6b7280' },
  boomboxSpeakerR: { position: 'absolute', top: PX * 0.5, right: PX * 0.3, width: PX * 1.2, height: PX * 1.2, backgroundColor: '#1f2937', borderRadius: PX * 0.6, borderWidth: 0.5, borderColor: '#6b7280' },
  boomboxHandle: { position: 'absolute', top: -PX * 0.8, left: PX * 1, right: PX * 1, height: PX * 0.4, backgroundColor: '#6b7280', borderTopLeftRadius: 3, borderTopRightRadius: 3 },

  // ── New Pets ───────────────────────────────────────────────
  petSnake: { position: 'absolute', bottom: 14, right: -10, width: PX * 8, height: PX * 4, zIndex: -1 },
  snakeBody: { position: 'absolute', bottom: PX * 0.5, left: PX * 1, width: PX * 5, height: PX * 0.8, backgroundColor: '#22c55e', borderRadius: PX * 0.4, transform: [{ rotate: '-3deg' }] },
  snakeHead: { position: 'absolute', bottom: PX * 0.8, left: PX * 0.2, width: PX * 1.5, height: PX * 1.2, backgroundColor: '#22c55e', borderRadius: PX * 0.6 },
  snakeEye: { position: 'absolute', top: PX * 0.2, left: PX * 0.3, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#1a1a1a', borderRadius: PX * 0.2 },
  snakeTongue: { position: 'absolute', bottom: PX * 0.1, left: -PX * 0.5, width: PX * 0.8, height: PX * 0.15, backgroundColor: '#ef4444' },

  petBat: { position: 'absolute', top: 6, right: -8, width: PX * 6, height: PX * 4, zIndex: 8 },
  batBody: { position: 'absolute', bottom: PX * 0.5, left: PX * 1.8, width: PX * 2, height: PX * 1.5, backgroundColor: '#4b5563', borderRadius: PX * 0.7 },
  batWingL: { position: 'absolute', bottom: PX * 1, left: 0, width: PX * 2.2, height: PX * 1.5, backgroundColor: '#37415180', borderTopLeftRadius: PX * 1.5, borderBottomLeftRadius: PX * 0.2, transformOrigin: 'right center' },
  batWingR: { position: 'absolute', bottom: PX * 1, right: PX * 0.5, width: PX * 2.2, height: PX * 1.5, backgroundColor: '#37415180', borderTopRightRadius: PX * 1.5, borderBottomRightRadius: PX * 0.2, transformOrigin: 'left center' },
  batEye: { position: 'absolute', bottom: PX * 1.5, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#ef4444', borderRadius: PX * 0.2, shadowColor: '#ef4444', shadowRadius: 2, shadowOpacity: 0.8 },

  petSkull: { position: 'absolute', bottom: 14, right: -8, width: PX * 5, height: PX * 5, zIndex: -1 },
  skullHead: { position: 'absolute', bottom: PX * 0.5, left: PX * 0.5, width: PX * 3, height: PX * 2.8, backgroundColor: '#f5f5f4', borderTopLeftRadius: PX * 1.5, borderTopRightRadius: PX * 1.5, borderRadius: PX * 0.5 },
  skullEye: { position: 'absolute', top: PX * 0.6, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#1a1a1a', borderRadius: PX * 0.4 },
  skullNose: { position: 'absolute', bottom: PX * 0.8, left: PX * 1.2, width: PX * 0.5, height: PX * 0.3, backgroundColor: '#d4d4d480', borderRadius: PX * 0.15 },
  skullTeeth: { position: 'absolute', bottom: 0, left: PX * 0.5, right: PX * 0.5, height: PX * 0.4, backgroundColor: '#e5e5e5', borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },
  skullJaw: { position: 'absolute', bottom: 0, left: PX * 0.8, width: PX * 2.4, height: PX * 0.5, backgroundColor: '#e5e5e5', borderBottomLeftRadius: PX * 0.3, borderBottomRightRadius: PX * 0.3 },

  petMushroom: { position: 'absolute', bottom: 14, right: -8, width: PX * 5, height: PX * 4.5, zIndex: -1 },
  mushroomCap: { position: 'absolute', bottom: PX * 1.5, left: PX * 0.3, width: PX * 3.5, height: PX * 2, backgroundColor: '#ef4444', borderTopLeftRadius: PX * 2, borderTopRightRadius: PX * 2, borderBottomLeftRadius: PX * 0.5, borderBottomRightRadius: PX * 0.5 },
  mushroomSpot1: { position: 'absolute', top: PX * 0.3, left: PX * 0.5, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#ffffff60', borderRadius: PX * 0.4 },
  mushroomSpot2: { position: 'absolute', top: PX * 0.5, right: PX * 0.6, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#ffffff40', borderRadius: PX * 0.3 },
  mushroomStem: { position: 'absolute', bottom: 0, left: PX * 1.2, width: PX * 1.2, height: PX * 1.5, backgroundColor: '#fef3c7', borderBottomLeftRadius: PX * 0.3, borderBottomRightRadius: PX * 0.3 },
  mushroomEye: { position: 'absolute', bottom: PX * 1.8, width: PX * 0.4, height: PX * 0.4, backgroundColor: '#1a1a1a', borderRadius: PX * 0.2 },

  // ── New Auras (toxic, holy, void) ──────────────────────────
  auraToxic: { position: 'absolute', top: 0, left: -2, right: -2, bottom: 16, zIndex: -1 },
  toxicBubble1: { position: 'absolute', top: PX * 0.5, left: PX * 0.5, width: PX * 1.5, height: PX * 1.5, backgroundColor: '#22c55e60', borderRadius: PX * 0.75, shadowColor: '#22c55e', shadowRadius: 5, shadowOpacity: 0.7 },
  toxicBubble2: { position: 'absolute', top: PX * 2.5, right: PX * 0.5, width: PX * 1, height: PX * 1, backgroundColor: '#4ade8050', borderRadius: PX * 0.5, shadowColor: '#22c55e', shadowRadius: 4, shadowOpacity: 0.6 },
  toxicBubble3: { position: 'absolute', top: PX * 1, left: PX * 3, width: PX * 0.8, height: PX * 0.8, backgroundColor: '#86efac40', borderRadius: PX * 0.4 },
  toxicGlow: { position: 'absolute', bottom: 0, left: 0, right: 0, height: PX * 2, backgroundColor: '#22c55e10', borderRadius: PX * 2, shadowColor: '#22c55e', shadowRadius: 8, shadowOpacity: 0.2 },

  auraHoly: { position: 'absolute', top: -2, left: -2, right: -2, bottom: 16, zIndex: -1 },
  holyRay1: { position: 'absolute', top: 0, left: PX * 1, width: PX * 0.5, height: PX * 6, backgroundColor: '#fef08a30', borderRadius: PX * 0.25, transform: [{ rotate: '-5deg' }] },
  holyRay2: { position: 'absolute', top: -PX * 0.5, left: PX * 2.5, width: PX * 0.4, height: PX * 6.5, backgroundColor: '#fef08a25', borderRadius: PX * 0.2 },
  holyRay3: { position: 'absolute', top: 0, right: PX * 1, width: PX * 0.5, height: PX * 6, backgroundColor: '#fef08a20', borderRadius: PX * 0.25, transform: [{ rotate: '5deg' }] },
  holyGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fef08a', borderRadius: 8, opacity: 0.08, shadowColor: '#fef08a', shadowRadius: 12, shadowOpacity: 0.3 },

  auraVoid: { position: 'absolute', top: 2, left: -4, right: -4, bottom: 16, zIndex: -1 },
  voidRing: { position: 'absolute', top: PX * 0.5, left: 0, right: 0, height: PX * 5, borderWidth: 1.5, borderColor: '#6b21a830', borderRadius: PX * 5, backgroundColor: '#0a0a1440' },
  voidParticle1: { position: 'absolute', top: PX * 1, left: PX * 0.5, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#7c3aed', borderRadius: PX * 0.3, shadowColor: '#7c3aed', shadowRadius: 4, shadowOpacity: 0.9 },
  voidParticle2: { position: 'absolute', top: PX * 3, right: PX * 0.5, width: PX * 0.5, height: PX * 0.5, backgroundColor: '#4c1d95', borderRadius: PX * 0.25, shadowColor: '#4c1d95', shadowRadius: 3, shadowOpacity: 0.8 },

  // ── New Hand Items (bigger with HPX) ───────────────────────
  handSword: { position: 'absolute', right: -HPX * 2, bottom: HPX * 0.5, zIndex: 3, alignItems: 'center' as const },
  handSwordBlade: { width: HPX * 0.8, height: HPX * 5, backgroundColor: '#9ca3af', borderRadius: 1 },
  handSwordGuard: { width: HPX * 2.5, height: HPX * 0.5, backgroundColor: '#d4a017', borderRadius: 1, marginTop: -1 },
  handSwordHilt: { width: HPX * 1.2, height: HPX * 1.2, backgroundColor: '#78350f', borderRadius: 1, marginTop: -1 },

  handPizza: { position: 'absolute', right: -HPX * 1.8, bottom: 0, zIndex: 3 },
  pizzaSlice: { width: 0, height: 0, borderLeftWidth: HPX * 1.2, borderRightWidth: HPX * 1.2, borderBottomWidth: HPX * 2.5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#f59e0b' },
  pizzaCrust: { width: HPX * 2.4, height: HPX * 0.5, backgroundColor: '#92400e', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  pizzaTopping1: { position: 'absolute', top: HPX * 1.2, left: HPX * 0.6, width: HPX * 0.4, height: HPX * 0.4, backgroundColor: '#ef4444', borderRadius: HPX * 0.2 },
  pizzaTopping2: { position: 'absolute', top: HPX * 0.8, left: HPX * 1.3, width: HPX * 0.35, height: HPX * 0.35, backgroundColor: '#ef4444', borderRadius: HPX * 0.17 },

  handMic: { position: 'absolute', right: -HPX * 1.8, bottom: 0, zIndex: 3, alignItems: 'center' as const },
  micHead: { width: HPX * 1.2, height: HPX * 1.5, backgroundColor: '#6b7280', borderTopLeftRadius: HPX * 0.6, borderTopRightRadius: HPX * 0.6, borderWidth: 0.5, borderColor: '#9ca3af' },
  micStick: { width: HPX * 0.4, height: HPX * 2.5, backgroundColor: '#374151', borderRadius: 1 },

  handTorch: { position: 'absolute', right: -HPX * 1.8, bottom: 0, zIndex: 3, alignItems: 'center' as const },
  torchFlame: { width: HPX * 1.5, height: HPX * 1.8, backgroundColor: '#f97316', borderTopLeftRadius: HPX * 0.7, borderTopRightRadius: HPX * 0.7, borderRadius: HPX * 0.5, shadowColor: '#f97316', shadowRadius: 6, shadowOpacity: 0.9 },
  torchFlameInner: { position: 'absolute', top: HPX * 0.3, left: HPX * 0.3, width: HPX * 0.8, height: HPX * 1, backgroundColor: '#fef08a', borderRadius: HPX * 0.4, opacity: 0.7 },
  torchStick: { width: HPX * 0.5, height: HPX * 2.5, backgroundColor: '#78350f', borderRadius: 1 },

});
