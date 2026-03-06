import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Pressable, Platform, Easing } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { AgentAppearance, DEFAULT_APPEARANCE, EnvironmentType, THEME_OUTFITS, NEON_SKIN_TONES } from '../../../../lib/officeConfig';
import ThoughtBubble from '../../../../components/ThoughtBubble';
import { ThoughtBubble as ThoughtData, generateThoughtBubble } from '../../../../lib/agentMessaging';

// Animated.loop is broken on React Native Web — runs once then stops silently.
// This helper recursively restarts the animation using a factory function.
function animLoop(factory: () => Animated.CompositeAnimation): { start: () => void; stop: () => void } {
  let stopped = false;
  const run = () => {
    if (stopped) return;
    factory().start(({ finished }) => {
      if (finished && !stopped) run();
    });
  };
  return {
    start: () => { stopped = false; run(); },
    stop: () => { stopped = true; },
  };
}

interface Props {
  agent: OfficeAgent;
  appearance?: AgentAppearance;
  environmentType?: EnvironmentType;
  onPress: () => void;
  selected: boolean;
  scale?: number;
  showThoughts?: boolean; // Enable thought bubbles
  totalAgents?: number;   // Total agents on floor — scales thought frequency down
  dancing?: boolean; // Badge celebration dance
  xp?: number;       // current XP points
  xpNext?: number;   // XP needed for next badge
  turns?: number;    // total turns/messages processed
  tokens?: number;   // total tokens used
  onAutomate?: (taskText: string) => void; // inline task assignment
}

export default function PixelAgent({ agent, appearance, environmentType, onPress, selected, scale = 1, showThoughts = false, totalAgents = 1, dancing = false, xp = 0, xpNext = 100, turns = 0, tokens = 0, onAutomate }: Props) {
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
  const swayAnim = useRef(new Animated.Value(0)).current; // whole-body rocking sway

  // Limb wiggle animations
  const leftArmWiggle = useRef(new Animated.Value(0)).current;
  const rightArmWiggle = useRef(new Animated.Value(0)).current;
  const leftLegWiggle = useRef(new Animated.Value(0)).current;
  const rightLegWiggle = useRef(new Animated.Value(0)).current;
  const celebJump = useRef(new Animated.Value(0)).current;

  // Aura animations
  const auraFlicker = useRef(new Animated.Value(0)).current;
  const auraPulse = useRef(new Animated.Value(1)).current;
  const auraRotate = useRef(new Animated.Value(0)).current;
  const auraDrift = useRef(new Animated.Value(0)).current;

  // Pet animations
  const petBounce = useRef(new Animated.Value(0)).current;
  const petTail = useRef(new Animated.Value(0)).current;
  const petCrawl = useRef(new Animated.Value(0)).current; // horizontal crawl/swim cycle
  const petCrawlY = useRef(new Animated.Value(0)).current; // vertical wave for swim
  const petWander = useRef(new Animated.Value(0)).current; // periodic walk to new position
  const petWanderY = useRef(new Animated.Value(0)).current; // vertical wander (for flying pets)
  const petLegAnim = useRef(new Animated.Value(0)).current; // leg walk cycle (0→1→0 rapid)

  const [currentThought, setCurrentThought] = useState<ThoughtData | null>(null);
  const [floatingText, setFloatingText] = useState<{id: number | string, text: string, color: string, x: number}[]>([]);
  const [mood, setMood] = useState<string | null>(null); // emoji mood indicator
  const [showSparkle, setShowSparkle] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [showAutomateButton, setShowAutomateButton] = useState(false);
  const [showAutomateInput, setShowAutomateInput] = useState(false);
  const [automateText, setAutomateText] = useState('');
  const floatId = useRef(0);
  const lastCost = useRef(agent.costToday);
  const lastStatus = useRef(agent.status);
  const lastXp = useRef(xp);
  const lastTurns = useRef(turns);
  const lastTokens = useRef(tokens);
  const buildStartTime = useRef<number>(0);
  const comboCount = useRef(0);        // consecutive builds without error
  const lastFloatTime = useRef(0);     // throttle rapid-fire floats
  const automateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const automateInputRef = useRef<TextInput>(null);

  const handlePressIn = () => {
    Animated.spring(pressScale, { toValue: 0.9, useNativeDriver: false }).start();
    setShowSparkle(true);
  };
  const handlePressOut = () => {
    Animated.spring(pressScale, { toValue: 1, friction: 3, tension: 40, useNativeDriver: false }).start();
  };

  const handleAutomateSubmit = useCallback(() => {
    const text = automateText.trim();
    if (!text || !onAutomate) return;
    onAutomate(text);
    setAutomateText('');
    setShowAutomateInput(false);
    setShowAutomateButton(false);
    // Show confirmation float
    setTimeout(() => {
      const id = `auto-${Date.now()}`;
      setFloatingText(prev => [...prev, { id, text: 'TASK SENT!', color: '#22c55e', x: 0 }]);
      setTimeout(() => setFloatingText(prev => prev.filter(f => f.id !== id)), 2000);
    }, 100);
  }, [automateText, onAutomate]);

  // Dance animation — triggered by badge earn
  useEffect(() => {
    if (!dancing) {
      danceX.setValue(0);
      danceY.setValue(0);
      danceRotate.setValue(0);
      danceScale.setValue(1);
      return;
    }
    const loop = animLoop(() => Animated.sequence([
        Animated.parallel([
          Animated.timing(danceX, { toValue: -8, duration: 120, useNativeDriver: false }),
          Animated.timing(danceY, { toValue: -10, duration: 120, useNativeDriver: false }),
          Animated.timing(danceRotate, { toValue: -15, duration: 120, useNativeDriver: false }),
          Animated.timing(danceScale, { toValue: 1.15, duration: 120, useNativeDriver: false }),
        ]),
        Animated.parallel([
          Animated.timing(danceX, { toValue: 8, duration: 120, useNativeDriver: false }),
          Animated.timing(danceY, { toValue: -4, duration: 120, useNativeDriver: false }),
          Animated.timing(danceRotate, { toValue: 15, duration: 120, useNativeDriver: false }),
          Animated.timing(danceScale, { toValue: 1.35, duration: 120, useNativeDriver: false }),
        ]),
        Animated.parallel([
          Animated.timing(danceX, { toValue: -6, duration: 100, useNativeDriver: false }),
          Animated.timing(danceY, { toValue: -12, duration: 100, useNativeDriver: false }),
          Animated.timing(danceRotate, { toValue: -10, duration: 100, useNativeDriver: false }),
          Animated.timing(danceScale, { toValue: 1.1, duration: 100, useNativeDriver: false }),
        ]),
        Animated.parallel([
          Animated.timing(danceX, { toValue: 0, duration: 150, useNativeDriver: false }),
          Animated.timing(danceY, { toValue: 0, duration: 150, useNativeDriver: false }),
          Animated.timing(danceRotate, { toValue: 0, duration: 150, useNativeDriver: false }),
          Animated.timing(danceScale, { toValue: 1, duration: 150, useNativeDriver: false }),
        ]),
      ]));
    loop.start();
    return () => loop.stop();
  }, [dancing]);

  // Bob + breathe + sway — always on for visible life
  useEffect(() => {
    const bobLoop = animLoop(() => Animated.sequence([
        Animated.parallel([
          Animated.timing(bobAnim, { toValue: -8, duration: 1400, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(breatheAnim, { toValue: 1.08, duration: 1400, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(bobAnim, { toValue: 0, duration: 1400, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(breatheAnim, { toValue: 1, duration: 1400, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
      ]));
    // Whole-body sway — gentle rocking left-right, always visible
    const swayLoop = animLoop(() => Animated.sequence([
        Animated.timing(swayAnim, { toValue: 4, duration: 2200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(swayAnim, { toValue: -4, duration: 2200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(swayAnim, { toValue: 2, duration: 1800, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(swayAnim, { toValue: -3, duration: 2000, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(swayAnim, { toValue: 0, duration: 1600, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    bobLoop.start();
    swayLoop.start();
    return () => { bobLoop.stop(); swayLoop.stop(); };
  }, []);

  // Glow animation
  useEffect(() => {
    if (agent.status === 'active') {
      const glowLoop = animLoop(() => Animated.sequence([
          Animated.timing(glowAnim, { toValue: 0.9, duration: 1500, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0.3, duration: 1500, useNativeDriver: false }),
        ]));
      glowLoop.start();
      return () => glowLoop.stop();
    }
  }, [agent.status]);

  // Eye blinking — periodic blink every 3-6s for alive agents
  useEffect(() => {
    if (agent.status === 'offline') return;
    const blink = () => {
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0, duration: 80, useNativeDriver: false }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 80, useNativeDriver: false }),
      ]).start();
    };
    // Double-blink occasionally
    const doubleBlink = () => {
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0, duration: 80, useNativeDriver: false }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 60, useNativeDriver: false }),
        Animated.delay(120),
        Animated.timing(blinkAnim, { toValue: 0, duration: 80, useNativeDriver: false }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 80, useNativeDriver: false }),
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
      const typingLoop = animLoop(() => Animated.sequence([
          Animated.timing(typingAnim, { toValue: 1, duration: 300, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: -1, duration: 300, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: 0.5, duration: 200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: -0.5, duration: 200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(typingAnim, { toValue: 0, duration: 150, useNativeDriver: false }),
          Animated.delay(400),
        ]));
      typingLoop.start();
      return () => typingLoop.stop();
    } else {
      typingAnim.setValue(0);
    }
  }, [agent.status]);

  // Look-around — always runs, head shifts left/right (big visible movement)
  useEffect(() => {
    const lookLoop = animLoop(() => Animated.sequence([
        Animated.delay(1500),
        Animated.timing(lookAnim, { toValue: 1, duration: 500, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
        Animated.delay(1200),
        Animated.timing(lookAnim, { toValue: -1, duration: 500, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
        Animated.delay(1000),
        Animated.timing(lookAnim, { toValue: 0.6, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
        Animated.delay(600),
        Animated.timing(lookAnim, { toValue: 0, duration: 400, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
      ]));
    lookLoop.start();
    return () => lookLoop.stop();
  }, []);

  // Limb fidget — always runs, big visible arm swings + leg shifts
  useEffect(() => {
    const fidgetLoop = animLoop(() => Animated.sequence([
        Animated.delay(1200),
        Animated.parallel([
          Animated.timing(leftArmWiggle, { toValue: -35, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightArmWiggle, { toValue: 15, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightLegWiggle, { toValue: 5, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(leftArmWiggle, { toValue: 0, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightArmWiggle, { toValue: 0, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightLegWiggle, { toValue: 0, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.delay(1500),
        Animated.parallel([
          Animated.timing(rightArmWiggle, { toValue: 35, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(leftArmWiggle, { toValue: -15, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(leftLegWiggle, { toValue: -5, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(rightArmWiggle, { toValue: 0, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(leftArmWiggle, { toValue: 0, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(leftLegWiggle, { toValue: 0, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.delay(800),
        Animated.parallel([
          Animated.timing(leftArmWiggle, { toValue: -30, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightArmWiggle, { toValue: 30, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(leftLegWiggle, { toValue: 4, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightLegWiggle, { toValue: -4, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(leftArmWiggle, { toValue: 25, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightArmWiggle, { toValue: -25, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(leftLegWiggle, { toValue: -4, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightLegWiggle, { toValue: 4, duration: 180, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(leftArmWiggle, { toValue: 0, duration: 250, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightArmWiggle, { toValue: 0, duration: 250, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(leftLegWiggle, { toValue: 0, duration: 250, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(rightLegWiggle, { toValue: 0, duration: 250, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        ]),
      ]));
    fidgetLoop.start();
    return () => fidgetLoop.stop();
  }, []);

  // Automate Me button — appears after 5s idle
  useEffect(() => {
    if (agent.status === 'idle' && onAutomate && !showAutomateInput) {
      automateTimerRef.current = setTimeout(() => setShowAutomateButton(true), 5000);
    } else {
      setShowAutomateButton(false);
      setShowAutomateInput(false);
      setAutomateText('');
      if (automateTimerRef.current) clearTimeout(automateTimerRef.current);
    }
    return () => { if (automateTimerRef.current) clearTimeout(automateTimerRef.current); };
  }, [agent.status, onAutomate, showAutomateInput]);

  // Aura animations — flicker, pulse, rotation, drift
  useEffect(() => {
    const flickerLoop = animLoop(() => Animated.sequence([
        Animated.timing(auraFlicker, { toValue: 1, duration: 400, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraFlicker, { toValue: 0.4, duration: 300, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraFlicker, { toValue: 0.8, duration: 350, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraFlicker, { toValue: 0.2, duration: 250, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    const pulseLoop = animLoop(() => Animated.sequence([
        Animated.timing(auraPulse, { toValue: 1.12, duration: 1200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraPulse, { toValue: 0.92, duration: 1200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    const rotateLoop = animLoop(() => {
      auraRotate.setValue(0);
      return Animated.timing(auraRotate, { toValue: 1, duration: 6000, useNativeDriver: false, easing: Easing.linear });
    });
    const driftLoop = animLoop(() => Animated.sequence([
        Animated.timing(auraDrift, { toValue: -2, duration: 1800, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(auraDrift, { toValue: 2, duration: 1800, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    flickerLoop.start();
    pulseLoop.start();
    rotateLoop.start();
    driftLoop.start();
    return () => { flickerLoop.stop(); pulseLoop.stop(); rotateLoop.stop(); driftLoop.stop(); };
  }, []);

  // Pet animations — big visible movements, all independent flat loops
  useEffect(() => {
    const bounceLoop = animLoop(() => Animated.sequence([
        Animated.timing(petBounce, { toValue: -8, duration: 400, useNativeDriver: false, easing: Easing.out(Easing.quad) }),
        Animated.timing(petBounce, { toValue: 0, duration: 400, useNativeDriver: false, easing: Easing.bounce }),
      ]));
    const tailLoop = animLoop(() => Animated.sequence([
        Animated.timing(petTail, { toValue: 1, duration: 200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petTail, { toValue: -1, duration: 200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    const crawlLoop = animLoop(() => Animated.sequence([
        Animated.timing(petCrawl, { toValue: 20, duration: 1500, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petCrawl, { toValue: -20, duration: 1500, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    const crawlYLoop = animLoop(() => Animated.sequence([
        Animated.timing(petCrawlY, { toValue: -6, duration: 900, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petCrawlY, { toValue: 6, duration: 900, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    const wanderLoop = animLoop(() => Animated.sequence([
        Animated.delay(1500),
        Animated.timing(petWander, { toValue: 25, duration: 1200, useNativeDriver: false, easing: Easing.inOut(Easing.quad) }),
        Animated.delay(1200),
        Animated.timing(petWander, { toValue: 0, duration: 1200, useNativeDriver: false, easing: Easing.inOut(Easing.quad) }),
        Animated.delay(2000),
        Animated.timing(petWander, { toValue: -22, duration: 1100, useNativeDriver: false, easing: Easing.inOut(Easing.quad) }),
        Animated.delay(1000),
        Animated.timing(petWander, { toValue: 0, duration: 1100, useNativeDriver: false, easing: Easing.inOut(Easing.quad) }),
      ]));
    const wanderYLoop = animLoop(() => Animated.sequence([
        Animated.timing(petWanderY, { toValue: -12, duration: 1800, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petWanderY, { toValue: 8, duration: 1800, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petWanderY, { toValue: -5, duration: 1400, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(petWanderY, { toValue: 0, duration: 1200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
    const legLoop = animLoop(() => Animated.sequence([
        Animated.timing(petLegAnim, { toValue: 1, duration: 150, useNativeDriver: false }),
        Animated.timing(petLegAnim, { toValue: -1, duration: 150, useNativeDriver: false }),
      ]));
    bounceLoop.start();
    tailLoop.start();
    crawlLoop.start();
    crawlYLoop.start();
    wanderLoop.start();
    wanderYLoop.start();
    legLoop.start();
    return () => { bounceLoop.stop(); tailLoop.stop(); crawlLoop.stop(); crawlYLoop.stop(); wanderLoop.stop(); wanderYLoop.stop(); legLoop.stop(); };
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
      } else if (agent.status === 'idle' && (lastStatus.current === 'active' || lastStatus.current === 'building')) {
        newMood = '🎉'; moodDuration = 4000;
      } else if (agent.status === 'error') {
        newMood = '😰'; moodDuration = 5000;
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

    // ─── Helper: spawn a floating text indicator ──────────────────────
    const spawnFloat = (text: string, color: string, delay = 0) => {
      const spawn = () => {
        const id = floatId.current++;
        const x = Math.random() * 30 - 15;
        setFloatingText(prev => [...prev, { id, text, color, x }]);
        setTimeout(() => setFloatingText(prev => prev.filter(t => t.id !== id)), 2500);
        lastFloatTime.current = Date.now();
      };
      if (delay > 0) setTimeout(spawn, delay);
      else spawn();
    };

    // ─── 1. Cost tracking ────────────────────────────────────────────
    if (agent.costToday > lastCost.current && agent.costToday > 0) {
      const diff = agent.costToday - lastCost.current;
      if (diff > 0.001) {
        spawnFloat(`-$${diff.toFixed(3)}`, '#ef4444');
        // Milestone costs
        if (lastCost.current < 0.10 && agent.costToday >= 0.10) spawnFloat('$0.10 SPENT', '#f97316', 400);
        if (lastCost.current < 1.00 && agent.costToday >= 1.00) spawnFloat('$1 MILESTONE!', '#f59e0b', 400);
      }
    }

    // ─── 2. Status transitions — the big ones ───────────────────────
    if (statusChanged) {
      if (agent.status === 'active' || agent.status === 'building') {
        buildStartTime.current = Date.now();
        comboCount.current++;
        const buildStarts = ['BUILDING', 'LOCKED IN', 'LET\'S GO', 'ON IT', 'WORKING'];
        spawnFloat(`+${buildStarts[Math.floor(Math.random() * buildStarts.length)]}`, '#22c55e');
        // Combo streaks
        if (comboCount.current >= 3) spawnFloat(`${comboCount.current}x COMBO!`, '#a855f7', 300);
        if (comboCount.current >= 5) spawnFloat('ON FIRE!', '#f97316', 500);
        if (comboCount.current >= 8) spawnFloat('BEAST MODE!', '#ec4899', 700);
        if (comboCount.current >= 10) spawnFloat('UNSTOPPABLE!', '#ec4899', 900);
        if (comboCount.current >= 15) spawnFloat('LEGENDARY!', '#fbbf24', 1100);
      } else if (agent.status === 'idle' && (lastStatus.current === 'active' || lastStatus.current === 'building')) {
        // Task complete — show duration + celebration
        const elapsed = Date.now() - buildStartTime.current;
        const secs = Math.round(elapsed / 1000);
        const finishWords = ['FINISHED ✓', 'DONE ✓', 'SHIPPED ✓', 'NAILED IT ✓', 'CRUSHED IT ✓'];
        spawnFloat(finishWords[Math.floor(Math.random() * finishWords.length)], '#22d3ee');
        if (secs > 0 && secs < 300) spawnFloat(`${secs}s BUILD`, '#818cf8', 350);
        if (secs <= 5) spawnFloat('SPEED RUN!', '#f59e0b', 600);
        if (secs <= 2) spawnFloat('INSTANT!', '#ec4899', 800);
        if (secs >= 30 && secs < 120) spawnFloat('SOLID WORK', '#a78bfa', 600);
        if (secs >= 120) spawnFloat('MARATHON BUILD!', '#ec4899', 600);
        // Random encouragement after finish
        if (Math.random() < 0.3) {
          const cheers = ['KEEP GOING', 'LETS STACK', 'MOMENTUM', 'NO STOPPING'];
          spawnFloat(cheers[Math.floor(Math.random() * cheers.length)], '#34d399', 900);
        }
        // Celebration animation — jump + arm pump + confetti
        setCelebrating(true);
        Animated.sequence([
          Animated.timing(celebJump, { toValue: -12, duration: 150, useNativeDriver: false, easing: Easing.out(Easing.quad) }),
          Animated.timing(celebJump, { toValue: 2, duration: 100, useNativeDriver: false }),
          Animated.timing(celebJump, { toValue: -6, duration: 120, useNativeDriver: false }),
          Animated.timing(celebJump, { toValue: 0, duration: 150, useNativeDriver: false, easing: Easing.bounce }),
        ]).start();
        Animated.sequence([
          Animated.parallel([
            Animated.timing(leftArmWiggle, { toValue: -25, duration: 150, useNativeDriver: false }),
            Animated.timing(rightArmWiggle, { toValue: 25, duration: 150, useNativeDriver: false }),
          ]),
          Animated.parallel([
            Animated.timing(leftArmWiggle, { toValue: 15, duration: 120, useNativeDriver: false }),
            Animated.timing(rightArmWiggle, { toValue: -15, duration: 120, useNativeDriver: false }),
          ]),
          Animated.parallel([
            Animated.timing(leftArmWiggle, { toValue: 0, duration: 200, useNativeDriver: false }),
            Animated.timing(rightArmWiggle, { toValue: 0, duration: 200, useNativeDriver: false }),
          ]),
        ]).start();
        setTimeout(() => setCelebrating(false), 1500);
      } else if (agent.status === 'error') {
        comboCount.current = 0; // break the combo
        spawnFloat('-ERROR', '#ef4444');
        spawnFloat('COMBO LOST', '#6b7280', 300);
      } else if (agent.status === 'offline') {
        spawnFloat('OFFLINE', '#6b7280');
      } else if (agent.status === 'idle' && lastStatus.current === 'offline') {
        spawnFloat('ONLINE!', '#22c55e');
        spawnFloat('READY', '#38bdf8', 400);
      }
    }

    // ─── 3. Turn/message tracking ────────────────────────────────────
    if (turns > lastTurns.current && lastTurns.current >= 0) {
      const delta = turns - lastTurns.current;
      if (delta > 0) {
        spawnFloat(`+${delta} MSG`, '#38bdf8');
        // Turn milestones
        if (lastTurns.current < 5 && turns >= 5) spawnFloat('5 MSGS', '#a78bfa', 350);
        if (lastTurns.current < 10 && turns >= 10) spawnFloat('10 MSGS!', '#a78bfa', 350);
        if (lastTurns.current < 25 && turns >= 25) spawnFloat('25 MSGS!', '#c084fc', 350);
        if (lastTurns.current < 50 && turns >= 50) spawnFloat('50 MSGS!', '#c084fc', 350);
        if (lastTurns.current < 100 && turns >= 100) spawnFloat('100 MSGS!', '#e879f9', 350);
        if (lastTurns.current < 250 && turns >= 250) spawnFloat('250 MSG BEAST!', '#f472b6', 350);
        if (lastTurns.current < 500 && turns >= 500) spawnFloat('500 MSG LEGEND!', '#f472b6', 350);
        if (lastTurns.current < 1000 && turns >= 1000) spawnFloat('1K MSGS!!!', '#ec4899', 350);
      }
    }
    lastTurns.current = turns;

    // ─── 4. Token tracking ───────────────────────────────────────────
    if (tokens > lastTokens.current && lastTokens.current >= 0) {
      const delta = tokens - lastTokens.current;
      if (delta > 50) {
        const k = Math.round(delta / 1000);
        spawnFloat(k > 0 ? `+${k}K TKN` : `+${delta} TKN`, '#34d399', 200);
        // Token milestones
        if (lastTokens.current < 1000 && tokens >= 1000) spawnFloat('1K TOKENS', '#6ee7b7', 500);
        if (lastTokens.current < 5000 && tokens >= 5000) spawnFloat('5K TOKENS', '#6ee7b7', 500);
        if (lastTokens.current < 10000 && tokens >= 10000) spawnFloat('10K TOKENS!', '#6ee7b7', 500);
        if (lastTokens.current < 50000 && tokens >= 50000) spawnFloat('50K TOKENS!', '#a7f3d0', 500);
        if (lastTokens.current < 100000 && tokens >= 100000) spawnFloat('100K TOKENS!', '#a7f3d0', 500);
        if (lastTokens.current < 500000 && tokens >= 500000) spawnFloat('500K TOKENS!!', '#fbbf24', 500);
        if (lastTokens.current < 1000000 && tokens >= 1000000) spawnFloat('1M TOKENS!!', '#fbbf24', 500);
      }
    }
    lastTokens.current = tokens;

    // ─── 5. XP tracking — FIXED: no longer skips first award ─────────
    if (xp > lastXp.current) {
      const gained = xp - lastXp.current;
      spawnFloat(`+${gained} XP`, '#fbbf24');
      // Level-up flash if crossed threshold
      if (lastXp.current < xpNext && xp >= xpNext) {
        setShowLevelUp(true);
        spawnFloat('LEVEL UP!', '#f59e0b', 400);
        spawnFloat('NEW BADGE!', '#ec4899', 700);
      }
      // XP milestones — more granular
      if (lastXp.current < 50 && xp >= 50) spawnFloat('50 XP!', '#fcd34d', 500);
      if (lastXp.current < 100 && xp >= 100) spawnFloat('100 XP!', '#fcd34d', 500);
      if (lastXp.current < 250 && xp >= 250) spawnFloat('250 XP!', '#fbbf24', 500);
      if (lastXp.current < 500 && xp >= 500) spawnFloat('500 XP!', '#fbbf24', 500);
      if (lastXp.current < 1000 && xp >= 1000) spawnFloat('1K XP!!', '#f59e0b', 500);
      if (lastXp.current < 2500 && xp >= 2500) spawnFloat('2.5K XP!!', '#f59e0b', 500);
      if (lastXp.current < 5000 && xp >= 5000) spawnFloat('5K XP LEGEND!', '#ef4444', 500);
      if (lastXp.current < 10000 && xp >= 10000) spawnFloat('10K XP GOD!', '#ec4899', 500);
      // Random encouragement on XP gain
      if (Math.random() < 0.25) {
        const xpVibes = ['NICE', 'STACKING', 'LEVELING UP', 'EXP GAINED'];
        spawnFloat(xpVibes[Math.floor(Math.random() * xpVibes.length)], '#d4a017', 600);
      }
    }
    lastXp.current = xp;

    // ─── 6. Periodic indicators during builds ──────────────────────
    if ((agent.status === 'active' || agent.status === 'building') && buildStartTime.current > 0) {
      const elapsed = Date.now() - buildStartTime.current;
      if (elapsed > 10000 && elapsed < 11000) spawnFloat('THINKING...', '#94a3b8');
      if (elapsed > 20000 && elapsed < 21000) {
        const mid = ['COOKING...', 'PROCESSING...', 'ALMOST...', 'CRAFTING...'];
        spawnFloat(mid[Math.floor(Math.random() * mid.length)], '#94a3b8');
      }
      if (elapsed > 30000 && elapsed < 31000) spawnFloat('DEEP WORK...', '#818cf8');
      if (elapsed > 45000 && elapsed < 46000) spawnFloat('IN THE ZONE', '#a78bfa');
      if (elapsed > 60000 && elapsed < 61000) spawnFloat('GRINDING...', '#a855f7');
      if (elapsed > 90000 && elapsed < 91000) spawnFloat('STILL AT IT...', '#c084fc');
      if (elapsed > 120000 && elapsed < 121000) spawnFloat('MARATHON!', '#ec4899');
      if (elapsed > 180000 && elapsed < 181000) spawnFloat('ABSOLUTE UNIT!', '#f472b6');
    }

    // ─── 6b. Random building encouragement ──────────────────────
    if ((agent.status === 'active' || agent.status === 'building') && Date.now() - lastFloatTime.current > 8000) {
      if (Math.random() < 0.20) {
        const buildVibes = ['COOKING', 'IN THE ZONE', 'FOCUSED', 'FLOW STATE', 'HEADS DOWN', 'LOCKED IN', 'BUILDING...', 'CRAFTING', 'SHIPPING'];
        const buildColors = ['#818cf8', '#a78bfa', '#c084fc', '#6366f1'];
        spawnFloat(buildVibes[Math.floor(Math.random() * buildVibes.length)], buildColors[Math.floor(Math.random() * buildColors.length)]);
      }
    }

    // ─── 7. Ambient idle vibes (periodic encouragement when idle) ────
    if (agent.status === 'idle' && Date.now() - lastFloatTime.current > 6000) {
      if (Math.random() < 0.30) {
        const hour = new Date().getHours();
        const ambientTexts: string[] = [];
        // Time-of-day vibes
        if (hour >= 5 && hour < 12) ambientTexts.push('GOOD MORNING', 'RISE & GRIND', 'FRESH START', 'EARLY BIRD', 'DAY MODE ON', 'COFFEE TIME');
        else if (hour >= 12 && hour < 17) ambientTexts.push('AFTERNOON PUSH', 'KEEP BUILDING', 'STAY FOCUSED', 'HEADS DOWN', 'CRUISING', 'PEAK HOURS');
        else if (hour >= 17 && hour < 22) ambientTexts.push('EVENING GRIND', 'NIGHT OWL', 'STILL HERE', 'AFTER HOURS', 'OVERTIME', 'GOLDEN HOUR');
        else ambientTexts.push('LATE NIGHT MODE', 'NO SLEEP', 'BURNING OIL', 'MIDNIGHT OIL', '3AM VIBES', 'INSOMNIA MODE');
        // General vibes — big pool
        ambientTexts.push(
          'READY', 'STANDING BY', 'WAITING...', 'IDLE', '...', 'ZZZ',
          'BORED', 'ASSIGN ME', 'NEED TASKS', 'WHAT NEXT?', 'SEND IT',
          'AVAILABLE', 'ON DECK', 'FREE AGENT',
          'JUST VIBING', 'DOING NOTHING', 'TWIDDLING THUMBS',
          'STRETCHING', 'YAWN', 'LOOKING AROUND', 'WHISTLING',
          'DAYDREAMING', 'AFK ENERGY', 'IDLE HANDS',
        );
        // XP-aware
        if (xp > 0) ambientTexts.push(`${xp} XP`, 'XP STACKING');
        if (comboCount.current > 0) ambientTexts.push(`${comboCount.current} STREAK`, 'COMBO READY');
        // Cost-aware
        if (agent.costToday > 0 && agent.costToday < 0.01) ambientTexts.push('EFFICIENT', 'LOW COST');
        if (agent.costToday === 0) ambientTexts.push('FREE MODE', '$0 VIBES');
        // Random motivational
        if (Math.random() < 0.3) ambientTexts.push('SHIP IT', 'BUILD MODE', 'LETS GO', 'ONE MORE TASK', 'STACK WINS', 'NO STOPPING', 'MOMENTUM');

        const pick = ambientTexts[Math.floor(Math.random() * ambientTexts.length)];
        const ambientColors = ['#64748b', '#94a3b8', '#6b7280', '#78716c', '#57534e'];
        spawnFloat(pick, ambientColors[Math.floor(Math.random() * ambientColors.length)]);
      }
    }

    lastCost.current = agent.costToday;
    lastStatus.current = agent.status;

    // Random thoughts — frequency scales down with more agents on the floor
    // 1-3 agents: 8-20s, 4-6: 15-35s, 7-10: 25-55s, 11+: 40-80s
    const crowdMultiplier = totalAgents <= 3 ? 1 : totalAgents <= 6 ? 1.8 : totalAgents <= 10 ? 3 : 4.5;
    const minDelay = 8000 * crowdMultiplier;
    const maxDelay = 20000 * crowdMultiplier;
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
  }, [agent.costToday, agent.status, showThoughts, currentThought, xp, turns, tokens]);

  // ─── Idle behavior floating text (cyan) ──────────────────────────
  const IDLE_BEHAVIOR_KEYWORDS: Record<string, string> = {
    'checking streaks': 'CHECKING...',
    'scanning tasks': 'REVIEWING...',
    'checking circle pulse': 'MONITORING...',
    'curating knowledge': 'CURATING...',
    'generating memory': 'DIGESTING...',
    'preparing morning': 'BRIEFING...',
    'generating weekly': 'REFLECTING...',
    'analyzing goal': 'ANALYZING...',
    'scanning codebase': 'SCANNING...',
    'checking dependencies': 'AUDITING...',
    'analyzing cost': 'OPTIMIZING...',
  };
  const lastIdleFloatRef = useRef(0);
  useEffect(() => {
    if (agent.status !== 'building') return;
    const activity = (agent.activity || '').toLowerCase();
    let behaviorText: string | null = null;
    for (const [prefix, text] of Object.entries(IDLE_BEHAVIOR_KEYWORDS)) {
      if (activity.startsWith(prefix)) { behaviorText = text; break; }
    }
    if (!behaviorText) return;
    const now = Date.now();
    if (now - lastIdleFloatRef.current < 3000) return;
    lastIdleFloatRef.current = now;
    const id = floatId.current++;
    setFloatingText(prev => [...prev, { id, text: behaviorText!, color: '#22d3ee', x: (Math.random() - 0.5) * 30 }]);
    setTimeout(() => setFloatingText(prev => prev.filter(f => f.id !== id)), 2500);
  }, [agent.status, agent.activity]);

  const statusColor = STATUS_COLORS[agent.status];
  const isOffline = agent.status === 'offline';
  const isWorking = agent.status === 'active' || agent.status === 'building';
  const PX = 2.5 * scale;

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : undefined}>
      <Animated.View style={[styles.container, {
          transform: [
            { translateX: Animated.add(danceX, swayAnim) },
            { translateY: Animated.add(Animated.add(bobAnim, danceY), celebJump) },
            { rotate: danceRotate.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }) },
            { scale: danceScale },
            { scale: pressScale },
          ],
        }]}>
        
        {/* Floating Gamified Text */}
        {floatingText.map(ft => (
          <FloatingText key={ft.id} text={ft.text} color={ft.color} xOffset={ft.x} />
        ))}

        {/* Celebration confetti */}
        {celebrating && <ConfettiBurst />}

        {/* Tamagotchi: Sleep ZZZs when offline */}
        {isOffline && <SleepZzz />}

        {/* Tamagotchi: Sweat drops during error */}
        {agent.status === 'error' && <SweatDrop />}

        {/* Tamagotchi: Sparkle on tap */}
        {showSparkle && <SparkleEffect onComplete={() => setShowSparkle(false)} />}

        {/* Tamagotchi: Level-up flash */}
        {showLevelUp && <LevelUpFlash onComplete={() => setShowLevelUp(false)} />}

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
            <Animated.View style={[styles.particle, { backgroundColor: agent.color, transform: [{ translateY: bobAnim.interpolate({ inputRange: [-8, 0], outputRange: [-20, 0] }) }], opacity: glowAnim }]} />
            <Animated.View style={[styles.particle, { left: 15, backgroundColor: agent.color, transform: [{ translateY: bobAnim.interpolate({ inputRange: [-8, 0], outputRange: [-10, 5] }) }], opacity: glowAnim }]} />
            <Animated.View style={[styles.particle, { right: 15, backgroundColor: agent.color, transform: [{ translateY: bobAnim.interpolate({ inputRange: [-8, 0], outputRange: [-15, 2] }) }], opacity: glowAnim }]} />
          </View>
        )}

        {/* Status dot */}
        <Animated.View style={[styles.statusDot, {
          backgroundColor: statusColor,
          opacity: agent.status === 'active' ? glowAnim : 1,
        }]} />

        {/* Hat */}
        {a.hat === 'crown' && (
          <Animated.View style={{ opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }), transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.97, 1.03] }) }] }}>
            <Text style={styles.hatEmoji}>{'👑'}</Text>
          </Animated.View>
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
            <Animated.View style={[styles.spaceHelmetAntennaTip, { opacity: auraFlicker, transform: [{ scale: auraPulse }] }]} />
            <View style={styles.spaceHelmetDome}>
              <View style={styles.spaceHelmetHighlight} />
            </View>
            <Animated.View style={[styles.spaceHelmetVisor, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }]} />
            <View style={styles.spaceHelmetRim} />
          </View>
        )}
        {a.hat === 'wizard_hat' && (
          <View style={styles.wizardHat}>
            <View style={[styles.wizardHatTop, { borderBottomColor: '#6366f1' }]} />
            <View style={[styles.wizardHatBrim, { backgroundColor: '#6366f1' }]} />
            <Animated.View style={[styles.wizardStar1, { opacity: auraFlicker, transform: [{ scale: auraPulse }] }]} />
            <Animated.View style={[styles.wizardStar2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [1.12, 0.92] }) }] }]} />
          </View>
        )}
        {a.hat === 'halo' && (
          <Animated.View style={[styles.haloRing, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }), transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.95, 1.05] }) }] }]} />
        )}
        {a.hat === 'antenna' && (
          <View style={styles.antennaWrap}>
            <View style={styles.antennaStalk} />
            <Animated.View style={[styles.antennaBobble, { opacity: auraFlicker, transform: [{ scale: auraPulse }] }]} />
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
            <Animated.View style={[styles.fezTassel, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) }] }]} />
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
          transform: [{ translateX: lookAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-6, 0, 6] }) }],
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
              <Animated.View style={[styles.accessoryChain, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-4deg', '4deg'] }) }] }]}>
                <Animated.View style={[styles.chainLink1, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }]} />
                <View style={styles.chainLink2} />
                <Animated.View style={[styles.chainLink3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }]} />
              </Animated.View>
            )}
            {a.accessory === 'piercing' && (
              <View style={styles.accessoryPiercing} />
            )}
            {a.accessory === 'visor_shades' && (
              <View style={styles.accessoryVisor}>
                <Animated.View style={[styles.visorStripe, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), transform: [{ translateX: auraDrift }] }]} />
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
            <Animated.View style={[styles.hpEar, { left: -2, transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.95, 1.05] }) }] }]} />
            <Animated.View style={[styles.hpEar, { right: -2, transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [1.05, 0.95] }) }] }]} />
          </View>
        )}

        {/* Scarf accessory — between head and body */}
        {a.accessory === 'scarf' && (
          <Animated.View style={[styles.scarf, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-2deg', '2deg'] }) }] }]}>
            <View style={[styles.scarfStrip, { backgroundColor: '#ef4444' }]} />
            <View style={[styles.scarfStrip, { backgroundColor: '#dc2626' }]} />
            <View style={[styles.scarfStrip, { backgroundColor: '#ef4444' }]} />
          </Animated.View>
        )}

        {/* Hoodie overlay */}
        {a.accessory === 'hoodie' && (
          <View style={[styles.hoodie, { backgroundColor: a.shirtColor }]} />
        )}

        {/* Back item — rendered behind body */}
        {a.backItem === 'cape' && (
          <Animated.View style={[styles.cape, { backgroundColor: a.shirtColor + 'cc', borderColor: a.shirtColor, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] }) }, { scaleY: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.97, 1.03] }) }] }]} />
        )}
        {a.backItem === 'backpack' && (
          <View style={styles.backpack}>
            <View style={[styles.backpackBody, { backgroundColor: '#6b7280' }]} />
          </View>
        )}
        {a.backItem === 'wings' && (
          <View style={styles.wingsWrap}>
            <Animated.View style={[styles.wing, styles.wingLeft, { borderBottomColor: '#a5b4fc70', transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) }] }]} />
            <Animated.View style={[styles.wingInner, styles.wingInnerLeft, { borderBottomColor: '#c7d2fe50', transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }) }] }]} />
            <Animated.View style={[styles.wing, styles.wingRight, { borderBottomColor: '#a5b4fc70', transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['8deg', '-8deg'] }) }] }]} />
            <Animated.View style={[styles.wingInner, styles.wingInnerRight, { borderBottomColor: '#c7d2fe50', transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['5deg', '-5deg'] }) }] }]} />
          </View>
        )}
        {a.backItem === 'jetpack' && (
          <View style={styles.jetpack}>
            <View style={styles.jetpackBody}>
              <View style={styles.jetpackDetail} />
            </View>
            <View style={styles.jetpackNozzle} />
            <Animated.View style={[styles.jetpackFlame, { opacity: auraFlicker, transform: [{ scaleY: auraPulse }] }]}>
              <Animated.View style={[styles.jetpackFlameInner, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]} />
            </Animated.View>
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
            <Animated.View style={[styles.tentacle, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-35deg', '-25deg'] }) }] }]} />
            <Animated.View style={[styles.tentacle, { height: PX * 4, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '-15deg'] }) }] }]} />
            <Animated.View style={[styles.tentacle, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['15deg', '5deg'] }) }] }]} />
            <Animated.View style={[styles.tentacle, { height: PX * 3.5, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['25deg', '35deg'] }) }] }]} />
          </View>
        )}
        {a.backItem === 'rocket' && (
          <View style={styles.rocketPack}>
            <View style={styles.rocketBody} />
            <View style={styles.rocketNose} />
            <Animated.View style={[styles.rocketFlame, { opacity: auraFlicker, transform: [{ scaleY: auraPulse }, { scaleX: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.2] }) }] }]} />
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
          <Animated.View style={[styles.boombox, { transform: [{ scale: auraPulse }] }]}>
            <View style={styles.boomboxBody} />
            <Animated.View style={[styles.boomboxSpeakerL, { transform: [{ scale: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) }] }]} />
            <Animated.View style={[styles.boomboxSpeakerR, { transform: [{ scale: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [1.15, 0.9] }) }] }]} />
            <View style={styles.boomboxHandle} />
          </Animated.View>
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
          {/* Left arm — typing wiggle when building + idle fidget */}
          <Animated.View style={[styles.arm, styles.leftArm, { backgroundColor: a.shirtColor,
            transform: [
              { translateY: typingAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-1, 0, 1] }) },
              { rotate: leftArmWiggle.interpolate({ inputRange: [-30, 0, 30], outputRange: ['-30deg', '0deg', '30deg'] }) },
            ],
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
          {/* Right arm — opposite phase typing + idle fidget */}
          <Animated.View style={[styles.arm, styles.rightArm, { backgroundColor: a.shirtColor,
            transform: [
              { translateY: typingAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, -1] }) },
              { rotate: rightArmWiggle.interpolate({ inputRange: [-30, 0, 30], outputRange: ['-30deg', '0deg', '30deg'] }) },
            ],
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
              <Animated.View style={[styles.lightsaberGlow, { backgroundColor: agent.color, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }), transform: [{ scaleX: auraPulse }] }]} />
              <Animated.View style={[styles.lightsaberBlade, { backgroundColor: agent.color + 'dd', shadowColor: agent.color, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }]} />
              <Animated.View style={[styles.lightsaberCore, { backgroundColor: agent.color, opacity: auraFlicker }]} />
              <View style={styles.lightsaberGuard} />
              <View style={styles.lightsaberHilt}>
                <View style={styles.lightsaberGrip1} />
                <View style={styles.lightsaberGrip2} />
              </View>
            </View>
          )}
          {(a.handItem || 'none') === 'coffee' && (
            <View style={styles.handCoffee}>
              <Animated.View style={[styles.handCoffeeSteam, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.7] }), transform: [{ translateY: auraDrift }, { scaleX: auraPulse }] }]} />
              <View style={styles.handCoffeeLid} />
              <View style={styles.handCoffeeBody} />
              <View style={styles.handCoffeeHandle} />
            </View>
          )}
          {(a.handItem || 'none') === 'laptop' && (
            <View style={styles.handLaptop}>
              <View style={styles.handLaptopScreen}>
                <Animated.View style={[styles.handLaptopScreenGlow, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }) }]} />
              </View>
              <View style={styles.handLaptopBase} />
            </View>
          )}
          {(a.handItem || 'none') === 'flag' && (
            <View style={styles.handFlag}>
              <View style={styles.handFlagPole} />
              <Animated.View style={[styles.handFlagCloth, { backgroundColor: agent.color + '80', transform: [{ scaleX: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.9, 1.1] }) }, { rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] }) }] }]} />
            </View>
          )}
          {(a.handItem || 'none') === 'wand' && (
            <View style={styles.handWand}>
              <Animated.View style={[styles.handWandSpark, { opacity: auraFlicker, transform: [{ scale: auraPulse }, { translateY: auraDrift }] }]} />
              <Animated.View style={[styles.handWandSpark2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [1.12, 0.92] }) }] }]} />
              <Animated.View style={[styles.handWandSpark3, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.9] }), transform: [{ translateX: auraDrift }] }]} />
              <View style={styles.handWandStick} />
            </View>
          )}
          {(a.handItem || 'none') === 'crab_claws' && (
            <View style={styles.handCrabClaws}>
              <View style={styles.handCrabArm} />
              <Animated.View style={[styles.handCrabClawTop, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '0deg'] }) }] }]} />
              <Animated.View style={[styles.handCrabClawBot, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['0deg', '8deg'] }) }] }]} />
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
              <Animated.View style={[styles.micHead, { transform: [{ scale: auraPulse }] }]} />
              <View style={styles.micStick} />
            </View>
          )}
          {(a.handItem || 'none') === 'torch' && (
            <View style={styles.handTorch}>
              <Animated.View style={[styles.torchFlame, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }), transform: [{ scaleY: auraPulse }, { scaleX: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }] }]} />
              <Animated.View style={[styles.torchFlameInner, { opacity: auraFlicker, transform: [{ translateY: auraDrift }] }]} />
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
          <Animated.View style={{ transform: [{ translateX: leftLegWiggle }] }}>
            <View style={[styles.leg, { backgroundColor: a.pantsColor }]}>
              <View style={styles.kneeShadow} />
              <View style={styles.pantCuff} />
            </View>
          </Animated.View>
          <Animated.View style={{ transform: [{ translateX: rightLegWiggle }] }}>
            <View style={[styles.leg, { backgroundColor: a.pantsColor }]}>
              <View style={styles.kneeShadow} />
              <View style={styles.pantCuff} />
            </View>
          </Animated.View>
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
            { scaleX: bobAnim.interpolate({ inputRange: [-8, 0], outputRange: [0.7, 1] }) },
            { scaleY: bobAnim.interpolate({ inputRange: [-8, 0], outputRange: [0.7, 1] }) }
          ],
          opacity: bobAnim.interpolate({ inputRange: [-8, 0], outputRange: [0.3, 0.7] })
        }]} />

        {/* Pet companion */}
        {(a.pet || 'none') === 'cat' && (
          <Animated.View style={[styles.petCat, { transform: [{ translateX: petWander }, { translateY: petBounce }] }]}>
            <View style={styles.catBody}>
              <View style={styles.catBelly} />
              <View style={styles.catStripe1} />
              <View style={styles.catStripe2} />
            </View>
            <Animated.View style={[styles.catLegFL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['15deg', '0deg', '-15deg'] }) }] }]} />
            <Animated.View style={[styles.catLegFR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-15deg', '0deg', '15deg'] }) }] }]} />
            <Animated.View style={[styles.catLegBL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-12deg', '0deg', '12deg'] }) }] }]} />
            <Animated.View style={[styles.catLegBR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['12deg', '0deg', '-12deg'] }) }] }]} />
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
          <Animated.View style={[styles.petDog, { transform: [{ translateX: petWander }, { translateY: petBounce }] }]}>
            <View style={styles.dogBody}>
              <View style={styles.dogBelly} />
              <View style={styles.dogCollar} />
              <Animated.View style={[styles.dogCollarTag, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '10deg'] }) }] }]} />
            </View>
            <Animated.View style={[styles.dogLegFL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['18deg', '0deg', '-18deg'] }) }] }]} />
            <Animated.View style={[styles.dogLegFR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-18deg', '0deg', '18deg'] }) }] }]} />
            <Animated.View style={[styles.dogLegBL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-14deg', '0deg', '14deg'] }) }] }]} />
            <Animated.View style={[styles.dogLegBR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['14deg', '0deg', '-14deg'] }) }] }]} />
            <View style={styles.dogHead}>
              <View style={styles.dogSnout} />
              <View style={styles.dogNose} />
              <Animated.View style={[styles.dogTongue, { transform: [{ translateY: petBounce.interpolate({ inputRange: [-2, 0], outputRange: [1, 0] }) }] }]} />
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
          <Animated.View style={[styles.petBird, { transform: [{ translateX: petWander }, { translateY: Animated.add(petBounce, petWanderY) }] }]}>
            <View style={styles.birdBody}>
              <View style={styles.birdChest} />
            </View>
            <View style={styles.birdHead}>
              <View style={styles.birdEye} />
              <Animated.View style={[styles.birdCrest, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }) }] }]} />
            </View>
            <Animated.View style={[styles.birdWingL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-25deg', '10deg'] }) }] }]} />
            <Animated.View style={[styles.birdWingR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['10deg', '-25deg'] }) }] }]} />
            <View style={styles.birdBeak} />
            <Animated.View style={[styles.birdTail, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) }] }]} />
            <Animated.View style={[styles.birdLegL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['10deg', '0deg', '-10deg'] }) }] }]} />
            <Animated.View style={[styles.birdLegR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-10deg', '0deg', '10deg'] }) }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'robot' && (
          <Animated.View style={[styles.petRobot, { transform: [{ translateX: petWander }, { translateY: petBounce }] }]}>
            <View style={styles.robotBody}>
              <Animated.View style={[styles.robotEye, { left: PX * 0.5, opacity: auraFlicker.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0.3, 1, 1] }) }]} />
              <Animated.View style={[styles.robotEye, { right: PX * 0.5, opacity: auraFlicker.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0.3, 1, 1] }) }]} />
              <View style={styles.robotChest} />
              <Animated.View style={[styles.robotPanel, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]} />
              <Animated.View style={[styles.robotBtn1, { opacity: auraFlicker }]} />
              <Animated.View style={[styles.robotBtn2, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }]} />
            </View>
            <Animated.View style={[styles.robotLegL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['12deg', '0deg', '-12deg'] }) }] }]} />
            <Animated.View style={[styles.robotLegR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-12deg', '0deg', '12deg'] }) }] }]} />
            <View style={styles.robotFootL} />
            <View style={styles.robotFootR} />
            <View style={styles.robotAntenna} />
            <Animated.View style={[styles.robotAntennaDot, { opacity: auraFlicker, transform: [{ scale: auraPulse }] }]} />
            <Animated.View style={[styles.robotArm, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-10deg', '0deg', '10deg'] }) }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'dragon' && (
          <Animated.View style={[styles.petDragon, { transform: [{ translateX: petWander }, { translateY: petBounce }] }]}>
            <View style={styles.dragonBody}>
              <View style={styles.dragonBelly} />
              <View style={styles.dragonSpine1} />
              <View style={styles.dragonSpine2} />
              <View style={styles.dragonSpine3} />
            </View>
            <Animated.View style={[{ transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-2deg', '2deg'] }) }] }]}>
              <View style={styles.dragonHead}>
                <View style={styles.dragonEye} />
                <View style={styles.dragonPupil} />
                <View style={styles.dragonSnout} />
                <Animated.View style={[styles.dragonNostril, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]} />
                <View style={styles.dragonHorn} />
              </View>
            </Animated.View>
            <Animated.View style={[styles.dragonWingL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-15deg', '20deg'] }) }] }]} />
            <Animated.View style={[styles.dragonWingR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['15deg', '-20deg'] }) }] }]} />
            <Animated.View style={[styles.dragonLegFL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['15deg', '0deg', '-15deg'] }) }] }]} />
            <Animated.View style={[styles.dragonLegFR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-15deg', '0deg', '15deg'] }) }] }]} />
            <Animated.View style={[styles.dragonTail, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-30deg', '0deg'] }) }] }]} />
            <Animated.View style={[styles.dragonTailTip, { opacity: auraFlicker, transform: [{ scale: auraPulse }] }]} />
            <Animated.View style={[styles.dragonBreath, { opacity: auraFlicker, transform: [{ scaleX: auraPulse }, { scaleY: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.3] }) }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'alien' && (
          <Animated.View style={[styles.petAlien, { transform: [{ translateX: petWander }, { translateY: petBounce }] }]}>
            <View style={styles.alienBody}>
              <View style={styles.alienBelt} />
              <Animated.View style={[styles.alienGem, { opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), transform: [{ scale: auraPulse }] }]} />
            </View>
            <Animated.View style={[{ transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] }) }] }]}>
              <View style={styles.alienHead}>
                <View style={[styles.alienEye, { left: PX * 0.4 }]} />
                <View style={[styles.alienEye, { right: PX * 0.4 }]} />
                <Animated.View style={[styles.alienPupil, { left: PX * 0.55, transform: [{ translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-0.5, 0.5] }) }] }]} />
                <Animated.View style={[styles.alienPupil, { right: PX * 0.55, transform: [{ translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-0.5, 0.5] }) }] }]} />
                <View style={styles.alienMouth} />
              </View>
            </Animated.View>
            <Animated.View style={[styles.alienAntennaL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }) }] }]} />
            <Animated.View style={[styles.alienAntennaR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['5deg', '-5deg'] }) }] }]} />
            <Animated.View style={[styles.alienAntennaTipL, { opacity: auraFlicker, transform: [{ scale: auraPulse }] }]} />
            <Animated.View style={[styles.alienAntennaTipR, { opacity: auraFlicker, transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [1.12, 0.92] }) }] }]} />
            <Animated.View style={[styles.alienLegL, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['10deg', '0deg', '-10deg'] }) }] }]} />
            <Animated.View style={[styles.alienLegR, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-10deg', '0deg', '10deg'] }) }] }]} />
          </Animated.View>
        )}

        {/* Crab pet */}
        {(a.pet || 'none') === 'crab' && (
          <Animated.View style={[styles.petCrab, { transform: [{ translateX: petWander }, { translateY: petBounce }] }]}>
            {/* Shell body */}
            <View style={styles.crabShell}>
              <View style={styles.crabShellHighlight} />
              <View style={styles.crabShellPattern1} />
              <View style={styles.crabShellPattern2} />
            </View>
            {/* Eye stalks */}
            <Animated.View style={[styles.crabEyeStalkL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }) }] }]} />
            <Animated.View style={[styles.crabEyeStalkR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['5deg', '-5deg'] }) }] }]} />
            <View style={[styles.crabEye, styles.crabEyeL]} />
            <View style={[styles.crabEye, styles.crabEyeR]} />
            <Animated.View style={[styles.crabPupil, styles.crabPupilL, { transform: [{ translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-0.3, 0.3] }) }] }]} />
            <Animated.View style={[styles.crabPupil, styles.crabPupilR, { transform: [{ translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-0.3, 0.3] }) }] }]} />
            {/* Claws */}
            <Animated.View style={[styles.crabClawL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) }] }]}>
              <View style={styles.crabClawPincerTop} />
              <View style={styles.crabClawPincerBot} />
            </Animated.View>
            <Animated.View style={[styles.crabClawR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['12deg', '-12deg'] }) }] }]}>
              <View style={styles.crabClawPincerTop} />
              <View style={styles.crabClawPincerBot} />
            </Animated.View>
            {/* Legs — animated walk */}
            <Animated.View style={[styles.crabLeg1L, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-12deg', '0deg', '12deg'] }) }] }]} />
            <Animated.View style={[styles.crabLeg2L, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['10deg', '0deg', '-10deg'] }) }] }]} />
            <Animated.View style={[styles.crabLeg3L, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-8deg', '0deg', '8deg'] }) }] }]} />
            <Animated.View style={[styles.crabLeg1R, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['12deg', '0deg', '-12deg'] }) }] }]} />
            <Animated.View style={[styles.crabLeg2R, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-10deg', '0deg', '10deg'] }) }] }]} />
            <Animated.View style={[styles.crabLeg3R, { transform: [{ rotate: petLegAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['8deg', '0deg', '-8deg'] }) }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'snake' && (
          <Animated.View style={[styles.petSnake, { transform: [{ translateX: petWander }, { translateY: petBounce }] }]}>
            <Animated.View style={[styles.snakeBody, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) }, { scaleX: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.95, 1.05] }) }] }]} />
            <Animated.View style={[{ transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['3deg', '-3deg'] }) }] }]}>
              <View style={styles.snakeHead}>
                <View style={styles.snakeEye} />
                <Animated.View style={[styles.snakeTongue, { transform: [{ scaleX: auraFlicker.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1.3, 0.5] }) }] }]} />
              </View>
            </Animated.View>
          </Animated.View>
        )}
        {(a.pet || 'none') === 'bat' && (
          <Animated.View style={[styles.petBat, { transform: [{ translateX: petWander }, { translateY: Animated.add(petBounce, petWanderY) }] }]}>
            <View style={styles.batBody} />
            <Animated.View style={[styles.batWingL, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-20deg', '25deg'] }) }] }]} />
            <Animated.View style={[styles.batWingR, { transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['20deg', '-25deg'] }) }] }]} />
            <Animated.View style={[styles.batEye, { left: PX * 0.3, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]} />
            <Animated.View style={[styles.batEye, { right: PX * 0.3, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'skull' && (
          <Animated.View style={[styles.petSkull, { transform: [{ translateX: petWander }, { translateY: Animated.add(petBounce, petWanderY) }, { rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }) }] }]}>
            <View style={styles.skullHead}>
              <Animated.View style={[styles.skullEye, { left: PX * 0.4, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]} />
              <Animated.View style={[styles.skullEye, { right: PX * 0.4, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]} />
              <View style={styles.skullNose} />
              <View style={styles.skullTeeth} />
            </View>
            <Animated.View style={[styles.skullJaw, { transform: [{ translateY: petTail.interpolate({ inputRange: [-1, 1], outputRange: [0, 1.5] }) }] }]} />
          </Animated.View>
        )}
        {(a.pet || 'none') === 'mushroom' && (
          <Animated.View style={[styles.petMushroom, { transform: [{ translateX: petWander }, { translateY: petBounce }, { rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-4deg', '4deg'] }) }] }]}>
            <Animated.View style={[styles.mushroomCap, { transform: [{ scale: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [0.97, 1.03] }) }] }]}>
              <View style={styles.mushroomSpot1} />
              <View style={styles.mushroomSpot2} />
            </Animated.View>
            <View style={styles.mushroomStem} />
            <Animated.View style={[styles.mushroomEye, { left: PX * 0.5, transform: [{ scaleY: auraFlicker.interpolate({ inputRange: [0, 0.05, 0.1, 1], outputRange: [0.1, 0.1, 1, 1] }) }] }]} />
            <Animated.View style={[styles.mushroomEye, { right: PX * 0.5, transform: [{ scaleY: auraFlicker.interpolate({ inputRange: [0, 0.05, 0.1, 1], outputRange: [0.1, 0.1, 1, 1] }) }] }]} />
          </Animated.View>
        )}

        {/* Spider pet — crawls side to side */}
        {(a.pet || 'none') === 'spider' && (
          <Animated.View style={[styles.petSpider, { transform: [{ translateX: Animated.add(petCrawl, petWander) }, { translateY: petCrawlY }] }]}>
            {/* Body */}
            <View style={{ width: PX * 3, height: PX * 2.2, backgroundColor: '#1a1a1a', borderRadius: PX * 1.1, position: 'absolute', top: 0, left: PX * 0.5 }} />
            {/* Head */}
            <View style={{ width: PX * 1.8, height: PX * 1.5, backgroundColor: '#2d2d2d', borderRadius: PX * 0.9, position: 'absolute', top: -PX * 0.8, left: PX * 1.1 }} />
            {/* Eyes — 8 red dots */}
            <View style={{ width: PX * 0.35, height: PX * 0.35, backgroundColor: '#ef4444', borderRadius: PX * 0.2, position: 'absolute', top: -PX * 0.5, left: PX * 1.3 }} />
            <View style={{ width: PX * 0.35, height: PX * 0.35, backgroundColor: '#ef4444', borderRadius: PX * 0.2, position: 'absolute', top: -PX * 0.5, left: PX * 1.7 }} />
            <View style={{ width: PX * 0.35, height: PX * 0.35, backgroundColor: '#ef4444', borderRadius: PX * 0.2, position: 'absolute', top: -PX * 0.5, left: PX * 2.1 }} />
            <View style={{ width: PX * 0.35, height: PX * 0.35, backgroundColor: '#ef4444', borderRadius: PX * 0.2, position: 'absolute', top: -PX * 0.5, left: PX * 2.5 }} />
            {/* Legs — 4 per side, animated with petTail */}
            <Animated.View style={{ position: 'absolute', top: PX * 0.2, left: -PX * 1.5, width: PX * 2, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-15deg', '15deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 0.8, left: -PX * 1.8, width: PX * 2.3, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['10deg', '-10deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 1.4, left: -PX * 1.6, width: PX * 2.1, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 1.8, left: -PX * 1.2, width: PX * 1.7, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['8deg', '-8deg'] }) }] }} />
            {/* Right legs */}
            <Animated.View style={{ position: 'absolute', top: PX * 0.2, right: -PX * 1.5, width: PX * 2, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['15deg', '-15deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 0.8, right: -PX * 1.8, width: PX * 2.3, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '10deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 1.4, right: -PX * 1.6, width: PX * 2.1, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['12deg', '-12deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 1.8, right: -PX * 1.2, width: PX * 1.7, height: PX * 0.3, backgroundColor: '#1a1a1a', borderRadius: PX * 0.15, transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) }] }} />
            {/* Web thread dangling */}
            <Animated.View style={{ position: 'absolute', top: -PX * 4, left: PX * 1.8, width: PX * 0.15, height: PX * 3.5, backgroundColor: '#ffffff30', opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] }) }} />
          </Animated.View>
        )}

        {/* Shark pet — swims back and forth */}
        {(a.pet || 'none') === 'shark' && (
          <Animated.View style={[styles.petShark, { transform: [{ translateX: Animated.add(petCrawl, petWander) }, { translateY: petCrawlY }] }]}>
            {/* Body */}
            <View style={{ width: PX * 5, height: PX * 2.5, backgroundColor: '#64748b', borderRadius: PX * 1.2, position: 'absolute', top: 0, left: 0 }}>
              {/* Belly */}
              <View style={{ position: 'absolute', bottom: 0, left: PX * 0.5, width: PX * 4, height: PX * 1, backgroundColor: '#e2e8f0', borderBottomLeftRadius: PX * 0.8, borderBottomRightRadius: PX * 0.8 }} />
            </View>
            {/* Dorsal fin */}
            <View style={{ position: 'absolute', top: -PX * 1.5, left: PX * 1.8, width: 0, height: 0, borderLeftWidth: PX * 0.8, borderRightWidth: PX * 0.8, borderBottomWidth: PX * 1.8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#475569' }} />
            {/* Tail fin */}
            <Animated.View style={{ position: 'absolute', top: -PX * 0.5, right: -PX * 1.5, width: 0, height: 0, borderTopWidth: PX * 1.2, borderBottomWidth: PX * 1.2, borderLeftWidth: PX * 1.8, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#475569', transform: [{ rotate: petTail.interpolate({ inputRange: [-1, 1], outputRange: ['-15deg', '15deg'] }) }] }} />
            {/* Pectoral fins */}
            <View style={{ position: 'absolute', top: PX * 1.8, left: PX * 1, width: PX * 1.2, height: PX * 0.4, backgroundColor: '#475569', borderRadius: PX * 0.2, transform: [{ rotate: '20deg' }] }} />
            <View style={{ position: 'absolute', top: PX * 1.8, left: PX * 2.8, width: PX * 1.2, height: PX * 0.4, backgroundColor: '#475569', borderRadius: PX * 0.2, transform: [{ rotate: '-20deg' }] }} />
            {/* Eye */}
            <View style={{ position: 'absolute', top: PX * 0.5, left: PX * 0.5, width: PX * 0.6, height: PX * 0.6, backgroundColor: '#0f172a', borderRadius: PX * 0.3 }} />
            <View style={{ position: 'absolute', top: PX * 0.55, left: PX * 0.55, width: PX * 0.25, height: PX * 0.25, backgroundColor: '#ffffff', borderRadius: PX * 0.15 }} />
            {/* Teeth */}
            <View style={{ position: 'absolute', top: PX * 1.5, left: PX * 0, width: PX * 1.5, height: PX * 0.3, backgroundColor: '#ffffff', borderRadius: PX * 0.1 }} />
            {/* Gill slits */}
            <View style={{ position: 'absolute', top: PX * 0.5, left: PX * 1.5, width: PX * 0.1, height: PX * 0.8, backgroundColor: '#47556950' }} />
            <View style={{ position: 'absolute', top: PX * 0.5, left: PX * 1.8, width: PX * 0.1, height: PX * 0.8, backgroundColor: '#47556950' }} />
            <View style={{ position: 'absolute', top: PX * 0.5, left: PX * 2.1, width: PX * 0.1, height: PX * 0.8, backgroundColor: '#47556950' }} />
          </Animated.View>
        )}

        {/* Bones pet — falling bones */}
        {(a.pet || 'none') === 'bones' && (
          <View style={[styles.petBones]}>
            {/* Bone 1 — falls slowly */}
            <Animated.View style={{ position: 'absolute', top: -PX * 6, left: -PX * 2, opacity: auraDrift.interpolate({ inputRange: [-2, 0, 2], outputRange: [0.3, 0.9, 0.3] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-4, 12] }) }, { rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
              <View style={{ width: PX * 1.5, height: PX * 0.4, backgroundColor: '#e2e8f0', borderRadius: PX * 0.2 }} />
              <View style={{ width: PX * 0.5, height: PX * 0.5, backgroundColor: '#e2e8f0', borderRadius: PX * 0.25, position: 'absolute', top: -PX * 0.2, left: -PX * 0.1 }} />
              <View style={{ width: PX * 0.5, height: PX * 0.5, backgroundColor: '#e2e8f0', borderRadius: PX * 0.25, position: 'absolute', top: -PX * 0.2, right: -PX * 0.1 }} />
              <View style={{ width: PX * 0.5, height: PX * 0.5, backgroundColor: '#e2e8f0', borderRadius: PX * 0.25, position: 'absolute', bottom: -PX * 0.2, left: -PX * 0.1 }} />
              <View style={{ width: PX * 0.5, height: PX * 0.5, backgroundColor: '#e2e8f0', borderRadius: PX * 0.25, position: 'absolute', bottom: -PX * 0.2, right: -PX * 0.1 }} />
            </Animated.View>
            {/* Bone 2 — offset timing */}
            <Animated.View style={{ position: 'absolute', top: -PX * 3, left: PX * 5, opacity: auraDrift.interpolate({ inputRange: [-2, 0, 2], outputRange: [0.8, 0.4, 0.8] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [8, -2] }) }, { rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '270deg'] }) }] }}>
              <View style={{ width: PX * 1.2, height: PX * 0.35, backgroundColor: '#cbd5e1', borderRadius: PX * 0.18 }} />
              <View style={{ width: PX * 0.4, height: PX * 0.4, backgroundColor: '#cbd5e1', borderRadius: PX * 0.2, position: 'absolute', top: -PX * 0.15, left: -PX * 0.08 }} />
              <View style={{ width: PX * 0.4, height: PX * 0.4, backgroundColor: '#cbd5e1', borderRadius: PX * 0.2, position: 'absolute', top: -PX * 0.15, right: -PX * 0.08 }} />
              <View style={{ width: PX * 0.4, height: PX * 0.4, backgroundColor: '#cbd5e1', borderRadius: PX * 0.2, position: 'absolute', bottom: -PX * 0.15, left: -PX * 0.08 }} />
              <View style={{ width: PX * 0.4, height: PX * 0.4, backgroundColor: '#cbd5e1', borderRadius: PX * 0.2, position: 'absolute', bottom: -PX * 0.15, right: -PX * 0.08 }} />
            </Animated.View>
            {/* Skull fragment */}
            <Animated.View style={{ position: 'absolute', top: -PX * 1, left: PX * 1, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [2, 10] }) }, { rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['30deg', '390deg'] }) }] }}>
              <View style={{ width: PX * 1.4, height: PX * 1.4, backgroundColor: '#f1f5f9', borderRadius: PX * 0.7 }} />
              <View style={{ width: PX * 0.3, height: PX * 0.3, backgroundColor: '#0f172a', borderRadius: PX * 0.15, position: 'absolute', top: PX * 0.3, left: PX * 0.25 }} />
              <View style={{ width: PX * 0.3, height: PX * 0.3, backgroundColor: '#0f172a', borderRadius: PX * 0.15, position: 'absolute', top: PX * 0.3, right: PX * 0.25 }} />
            </Animated.View>
            {/* Ribcage */}
            <Animated.View style={{ position: 'absolute', top: -PX * 8, left: PX * 3.5, opacity: auraDrift.interpolate({ inputRange: [-2, 0, 2], outputRange: [0.5, 0.8, 0.5] }), transform: [{ translateY: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-2, 14] }) }, { rotate: '15deg' }] }}>
              <View style={{ width: PX * 1.8, height: PX * 0.2, backgroundColor: '#e2e8f0', borderRadius: PX * 0.1 }} />
              <View style={{ width: PX * 1.6, height: PX * 0.2, backgroundColor: '#e2e8f0', borderRadius: PX * 0.1, marginTop: PX * 0.3, marginLeft: PX * 0.1 }} />
              <View style={{ width: PX * 1.4, height: PX * 0.2, backgroundColor: '#e2e8f0', borderRadius: PX * 0.1, marginTop: PX * 0.3, marginLeft: PX * 0.2 }} />
            </Animated.View>
          </View>
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
        {(a.aura || 'none') === 'galaxy' && (
          <Animated.View style={[styles.auraGalaxy, { transform: [{ rotate: auraRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
            {/* Spiral arm 1 */}
            <Animated.View style={{ position: 'absolute', top: PX * 1, left: PX * 0.5, width: PX * 5, height: PX * 1, backgroundColor: '#8b5cf640', borderRadius: PX * 0.5, transform: [{ rotate: '30deg' }, { scaleX: auraPulse }] }} />
            {/* Spiral arm 2 */}
            <Animated.View style={{ position: 'absolute', top: PX * 3, left: PX * -0.5, width: PX * 5, height: PX * 0.8, backgroundColor: '#3b82f640', borderRadius: PX * 0.4, transform: [{ rotate: '-40deg' }, { scaleX: auraPulse.interpolate({ inputRange: [0.92, 1.12], outputRange: [1.12, 0.92] }) }] }} />
            {/* Spiral arm 3 */}
            <Animated.View style={{ position: 'absolute', top: PX * 5, left: PX * 1, width: PX * 4, height: PX * 0.6, backgroundColor: '#ec489940', borderRadius: PX * 0.3, transform: [{ rotate: '60deg' }, { scaleX: auraPulse }] }} />
            {/* Galaxy core — bright center */}
            <Animated.View style={{ position: 'absolute', top: PX * 2.5, left: PX * 1.5, width: PX * 2, height: PX * 2, borderRadius: PX * 1, backgroundColor: '#fef08a', opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] }), shadowColor: '#fef08a', shadowRadius: 8, shadowOpacity: 0.8 }} />
            {/* Orbiting stars */}
            <Animated.View style={{ position: 'absolute', top: PX * 0.2, left: PX * 0.8, width: PX * 0.6, height: PX * 0.6, borderRadius: PX * 0.3, backgroundColor: '#fef08a', opacity: auraFlicker, shadowColor: '#fef08a', shadowRadius: 4, shadowOpacity: 1, transform: [{ translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-3, 3] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 1.5, right: PX * 0.2, width: PX * 0.5, height: PX * 0.5, borderRadius: PX * 0.25, backgroundColor: '#67e8f9', opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), shadowColor: '#67e8f9', shadowRadius: 3, shadowOpacity: 1, transform: [{ translateY: auraDrift }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 5.5, left: PX * 3, width: PX * 0.4, height: PX * 0.4, borderRadius: PX * 0.2, backgroundColor: '#f472b6', opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }), shadowColor: '#f472b6', shadowRadius: 3, shadowOpacity: 1 }} />
            <Animated.View style={{ position: 'absolute', top: PX * 4, left: PX * -0.5, width: PX * 0.45, height: PX * 0.45, borderRadius: PX * 0.23, backgroundColor: '#a78bfa', opacity: auraFlicker, shadowColor: '#a78bfa', shadowRadius: 4, shadowOpacity: 1, transform: [{ translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [2, -2] }) }, { translateY: auraDrift }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 0.8, left: PX * 3.5, width: PX * 0.35, height: PX * 0.35, borderRadius: PX * 0.18, backgroundColor: '#fbbf24', opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] }), shadowColor: '#fbbf24', shadowRadius: 3, shadowOpacity: 1 }} />
            {/* Comet trail */}
            <Animated.View style={{ position: 'absolute', top: PX * 1, left: PX * 4, width: PX * 3, height: PX * 0.25, backgroundColor: '#67e8f9', borderRadius: PX * 0.12, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }), transform: [{ rotate: '-20deg' }, { translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [-6, 2] }) }] }} />
            <Animated.View style={{ position: 'absolute', top: PX * 5, right: PX * 3.5, width: PX * 2.5, height: PX * 0.2, backgroundColor: '#f472b6', borderRadius: PX * 0.1, opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }), transform: [{ rotate: '25deg' }, { translateX: auraDrift.interpolate({ inputRange: [-2, 2], outputRange: [4, -4] }) }] }} />
            {/* Nebula clouds */}
            <Animated.View style={{ position: 'absolute', top: PX * -1, left: PX * -1, width: PX * 7, height: PX * 9, borderRadius: PX * 3.5, backgroundColor: '#7c3aed', opacity: auraFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.03, 0.1] }), transform: [{ scale: auraPulse }] }} />
          </Animated.View>
        )}

        {/* Name label */}
        <View style={styles.nameContainer}>
          <Text style={[styles.name, { color: agent.color }]} numberOfLines={1}>{agent.name}</Text>
        </View>

        {/* XP bar */}
        <XPBar xp={xp} xpNext={xpNext} color={agent.color} />

        {/* Automate Me button */}
        {showAutomateButton && onAutomate && !showAutomateInput && (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); setShowAutomateInput(true); setTimeout(() => automateInputRef.current?.focus(), 100); }}
            style={{ position: 'absolute', bottom: -16, left: '50%', marginLeft: -20, zIndex: 45, backgroundColor: '#8b5cf6', paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 3 }}
          >
            <Text style={{ color: '#fff', fontSize: 5, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 0.3 }}>AUTOMATE</Text>
          </Pressable>
        )}
        {showAutomateInput && onAutomate && (
          <View
            style={{ position: 'absolute', bottom: -22, left: '50%', marginLeft: -50, zIndex: 50, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#8b5cf6', borderRadius: 3, padding: 1.5 }}
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
          >
            <TextInput
              ref={automateInputRef}
              value={automateText}
              onChangeText={setAutomateText}
              onSubmitEditing={handleAutomateSubmit}
              placeholder="task..."
              placeholderTextColor="#666"
              style={{ width: 80, height: 12, fontSize: 6, color: '#e2e8f0', fontFamily: 'monospace', paddingHorizontal: 2, paddingVertical: 0 }}
              returnKeyType="go"
            />
            <Pressable onPress={(e) => { e.stopPropagation?.(); handleAutomateSubmit(); }} style={{ backgroundColor: '#8b5cf6', paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, marginLeft: 1 }}>
              <Text style={{ color: '#fff', fontSize: 5, fontWeight: '700', fontFamily: 'monospace' }}>GO</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

// ── CONFETTI BURST ────────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function ConfettiBurst() {
  const particles = useRef(
    Array.from({ length: 10 }, (_, i) => ({
      id: i,
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(1),
      rotate: new Animated.Value(0),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      angle: (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
      distance: 12 + Math.random() * 18,
    }))
  ).current;

  useEffect(() => {
    const anims = particles.map(p =>
      Animated.parallel([
        Animated.timing(p.x, { toValue: Math.cos(p.angle) * p.distance, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(p.y, { toValue: Math.sin(p.angle) * p.distance - 8, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(p.rotate, { toValue: 2 + Math.random() * 3, duration: 600, useNativeDriver: false }),
        Animated.timing(p.opacity, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      ])
    );
    Animated.parallel(anims).start();
  }, []);

  return (
    <View style={{ position: 'absolute', top: '30%', left: '50%', zIndex: 60 }}>
      {particles.map(p => (
        <Animated.View
          key={p.id}
          style={{
            position: 'absolute',
            width: 3,
            height: 3,
            borderRadius: 1,
            backgroundColor: p.color,
            opacity: p.opacity,
            transform: [
              { translateX: p.x },
              { translateY: p.y },
              { rotate: p.rotate.interpolate({ inputRange: [0, 5], outputRange: ['0deg', '1800deg'] }) },
            ],
          }}
        />
      ))}
    </View>
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
    const loop = animLoop(() => Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]));
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (!isFull) return;
    const loop = animLoop(() => {
      rainbowAnim.setValue(0);
      return Animated.timing(rainbowAnim, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: false });
    });
    loop.start();
    return () => loop.stop();
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
  const scaleAnim = useRef(new Animated.Value(0.3)).current;

  // Determine if this is a "big" indicator (milestones, combos, level ups)
  const isBig = text.includes('!') || text.includes('COMBO') || text.includes('LEVEL') || text.includes('FIRE') || text.includes('UNSTOPPABLE') || text.includes('LEGEND');

  useEffect(() => {
    Animated.parallel([
      // Pop-in scale
      Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 120, useNativeDriver: false }),
      // Float upward
      Animated.timing(animY, { toValue: isBig ? -45 : -35, duration: 2000, useNativeDriver: false, easing: Easing.out(Easing.cubic) }),
      // Fade out
      Animated.timing(opacity, { toValue: 0, duration: 2000, useNativeDriver: false, delay: 600 }),
    ]).start();
  }, []);

  return (
    <Animated.Text style={{
      position: 'absolute',
      top: -12,
      left: 10 + xOffset,
      color,
      fontSize: isBig ? 10 : 8,
      fontWeight: '900',
      fontFamily: 'monospace',
      textShadowColor: '#000000',
      textShadowOffset: { width: 1, height: 1 },
      textShadowRadius: 2,
      zIndex: 20,
      transform: [{ translateY: animY }, { scale: scaleAnim }],
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
    Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 60, useNativeDriver: false }).start(() => {
      const floatLoop = animLoop(() => Animated.sequence([
        Animated.timing(floatAnim, { toValue: -3, duration: 1200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1200, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ]));
      floatLoop.start();
    });
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

// ── TAMAGOTCHI: SLEEP ZZZ ───────────────────────────────────────────────

function SleepZzz() {
  const z1Y = useRef(new Animated.Value(0)).current;
  const z1Op = useRef(new Animated.Value(0)).current;
  const z2Y = useRef(new Animated.Value(0)).current;
  const z2Op = useRef(new Animated.Value(0)).current;
  const z3Y = useRef(new Animated.Value(0)).current;
  const z3Op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animateZ = (y: Animated.Value, op: Animated.Value, delay: number) =>
      animLoop(() => Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(y, { toValue: -20, duration: 1800, useNativeDriver: false, easing: Easing.out(Easing.sin) }),
            Animated.sequence([
              Animated.timing(op, { toValue: 1, duration: 400, useNativeDriver: false }),
              Animated.timing(op, { toValue: 0, duration: 1400, useNativeDriver: false }),
            ]),
          ]),
          Animated.timing(y, { toValue: 0, duration: 0, useNativeDriver: false }),
        ]));
    const z1 = animateZ(z1Y, z1Op, 0); z1.start();
    const z2 = animateZ(z2Y, z2Op, 600); z2.start();
    const z3 = animateZ(z3Y, z3Op, 1200); z3.start();
    return () => { z1.stop(); z2.stop(); z3.stop(); };
  }, []);

  return (
    <>
      <Animated.Text style={{ position: 'absolute', top: -4, left: 18, fontSize: 7, color: '#94a3b8', fontWeight: '900', fontFamily: 'monospace', transform: [{ translateY: z1Y }], opacity: z1Op, zIndex: 22 }}>z</Animated.Text>
      <Animated.Text style={{ position: 'absolute', top: -4, left: 24, fontSize: 9, color: '#94a3b8', fontWeight: '900', fontFamily: 'monospace', transform: [{ translateY: z2Y }], opacity: z2Op, zIndex: 22 }}>Z</Animated.Text>
      <Animated.Text style={{ position: 'absolute', top: -4, left: 32, fontSize: 11, color: '#94a3b8', fontWeight: '900', fontFamily: 'monospace', transform: [{ translateY: z3Y }], opacity: z3Op, zIndex: 22 }}>Z</Animated.Text>
    </>
  );
}

// ── TAMAGOTCHI: SPARKLE EFFECT ──────────────────────────────────────────

function SparkleEffect({ onComplete }: { onComplete: () => void }) {
  const particles = useRef(
    Array.from({ length: 6 }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      op: new Animated.Value(1),
      angle: Math.random() * Math.PI * 2,
    }))
  ).current;

  useEffect(() => {
    const anims = particles.map(p => {
      const dist = 12 + Math.random() * 10;
      return Animated.parallel([
        Animated.timing(p.x, { toValue: Math.cos(p.angle) * dist, duration: 500, useNativeDriver: false }),
        Animated.timing(p.y, { toValue: Math.sin(p.angle) * dist, duration: 500, useNativeDriver: false }),
        Animated.timing(p.op, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]);
    });
    Animated.parallel(anims).start(onComplete);
  }, []);

  const colors = ['#fbbf24', '#f472b6', '#60a5fa', '#a78bfa', '#34d399', '#fb923c'];
  return (
    <>
      {particles.map((p, i) => (
        <Animated.Text key={i} style={{
          position: 'absolute', top: 20, left: 25, fontSize: 6,
          color: colors[i],
          transform: [{ translateX: p.x }, { translateY: p.y }],
          opacity: p.op, zIndex: 30,
        }}>✦</Animated.Text>
      ))}
    </>
  );
}

// ── TAMAGOTCHI: SWEAT DROP ──────────────────────────────────────────────

function SweatDrop() {
  const dropY = useRef(new Animated.Value(0)).current;
  const dropOp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = animLoop(() => Animated.sequence([
        Animated.parallel([
          Animated.timing(dropY, { toValue: 8, duration: 800, useNativeDriver: false, easing: Easing.in(Easing.quad) }),
          Animated.sequence([
            Animated.timing(dropOp, { toValue: 1, duration: 200, useNativeDriver: false }),
            Animated.timing(dropOp, { toValue: 0, duration: 600, useNativeDriver: false }),
          ]),
        ]),
        Animated.timing(dropY, { toValue: 0, duration: 0, useNativeDriver: false }),
        Animated.delay(1500),
      ]));
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.Text style={{
      position: 'absolute', top: 8, right: 4, fontSize: 8,
      transform: [{ translateY: dropY }], opacity: dropOp, zIndex: 22,
    }}>💧</Animated.Text>
  );
}

// ── TAMAGOTCHI: LEVEL-UP FLASH ──────────────────────────────────────────

function LevelUpFlash({ onComplete }: { onComplete: () => void }) {
  const flashOp = useRef(new Animated.Value(0)).current;
  const flashScale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(flashOp, { toValue: 0.8, duration: 200, useNativeDriver: false }),
        Animated.spring(flashScale, { toValue: 1.5, friction: 4, tension: 60, useNativeDriver: false }),
      ]),
      Animated.timing(flashOp, { toValue: 0, duration: 600, useNativeDriver: false }),
    ]).start(onComplete);
  }, []);

  return (
    <Animated.View style={{
      position: 'absolute', top: -5, left: -5, right: -5, bottom: 15,
      borderRadius: 8, backgroundColor: '#fbbf24',
      opacity: flashOp, transform: [{ scale: flashScale }], zIndex: 15,
    }} />
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

  // ── Galaxy Aura ────────────────────────────────────
  auraGalaxy: { position: 'absolute', top: -PX * 2, left: -PX * 2, width: PX * 9, height: PX * 10, zIndex: -1 },

  // ── Spider Pet ─────────────────────────────────────
  petSpider: { position: 'absolute', bottom: 16, right: -14, width: PX * 6, height: PX * 4, zIndex: -1 },

  // ── Shark Pet ──────────────────────────────────────
  petShark: { position: 'absolute', bottom: 10, left: -18, width: PX * 8, height: PX * 4, zIndex: -1 },

  // ── Bones Pet ──────────────────────────────────────
  petBones: { position: 'absolute', top: -PX * 2, left: -PX * 2, width: PX * 10, height: PX * 14, zIndex: -1, overflow: 'visible' as const },

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
