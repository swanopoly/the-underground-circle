import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Pressable, Platform } from 'react-native';
import { animLoop } from '../../../../lib/animationHelpers';
import type { FurnitureItem, OfficeTheme } from '../../../../lib/officeConfig';
import type { OfficeAgent } from '../../../../lib/officeAgents';

interface ItemProps { item: FurnitureItem; theme: OfficeTheme; }
interface DataItemProps extends ItemProps { agents?: OfficeAgent[]; }

const S: any = Platform.OS === 'web' ? { cursor: 'default' } : {};

// ═══════════════════════════════════════════════════════════════════════════════
//  EXISTING 12 ITEMS — NOW ANIMATED
// ═══════════════════════════════════════════════════════════════════════════════

export function EnterKeyItem({ item, theme }: ItemProps) {
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = animLoop(() => Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  const glowOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.5] });
  return (
    <View style={{ width: 76, height: 52, backgroundColor: '#1e293b', borderWidth: 1, borderColor: theme.accentGlow, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Animated.View style={{ position: 'absolute', top: 6, width: 64, height: 32, borderRadius: 6, backgroundColor: theme.accentGlow, opacity: glowOp }} />
      <View style={{ backgroundColor: '#334155', borderRadius: 4, width: 60, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#475569', zIndex: 2 }}>
        <Text style={{ color: theme.accentGlow, fontSize: 9, fontWeight: '900', fontFamily: 'monospace' }}>ENTER</Text>
      </View>
      <Text style={{ color: theme.accentGlow + '60', fontSize: 6, marginTop: 2, fontFamily: 'monospace', zIndex: 2 }}>⏎ SEND TASK</Text>
    </View>
  );
}

export function ButtonPanelItem({ item, theme }: ItemProps) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = animLoop(() => Animated.timing(sweep, { toValue: 3, duration: 2400, easing: Easing.linear, useNativeDriver: false }));
    l.start();
    return () => { l.stop(); sweep.setValue(0); };
  }, []);
  const colors = ['#ef4444', '#22c55e', '#3b82f6'];
  return (
    <View style={{ width: 86, height: 44, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', borderRadius: 6, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
      {colors.map((c, i) => {
        const op = sweep.interpolate({ inputRange: [i, i + 0.5, i + 1, 3], outputRange: [0.5, 1, 0.5, 0.5], extrapolate: 'clamp' });
        return (
          <Animated.View key={i} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c, borderWidth: 1, borderColor: c + '80', opacity: op }} />
        );
      })}
    </View>
  );
}

export function AlarmBellItem({ item, theme }: ItemProps) {
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = animLoop(() => Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(sway, { toValue: -1, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(sway, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.delay(2000),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  const rot = sway.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-8deg', '0deg', '8deg'] });
  return (
    <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 28, height: 20, backgroundColor: '#f59e0b', borderTopLeftRadius: 14, borderTopRightRadius: 14 }} />
      <Animated.View style={{ transform: [{ rotate: rot }] }}>
        <View style={{ width: 8, height: 6, backgroundColor: '#d97706', borderRadius: 4 }} />
      </Animated.View>
      <View style={{ width: 36, height: 3, backgroundColor: '#92400e', borderRadius: 1, marginTop: 1 }} />
      <Text style={{ color: '#f59e0b80', fontSize: 5, marginTop: 1, fontFamily: 'monospace' }}>RING</Text>
    </View>
  );
}

export function LaunchPadItem({ item, theme }: ItemProps) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = animLoop(() => {
      rot.setValue(0);
      return Animated.timing(rot, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false });
    });
    l.start();
    return () => l.stop();
  }, []);
  const angle = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#1e293b', borderWidth: 2, borderColor: theme.accentGlow + '60', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 18 }}>🚀</Text>
        <Text style={{ color: theme.accentGlow, fontSize: 5, fontWeight: '900', fontFamily: 'monospace' }}>LAUNCH</Text>
      </View>
      <Animated.View style={{ position: 'absolute', width: 58, height: 58, transform: [{ rotate: angle }] }} pointerEvents="none">
        {[0, 90, 180, 270].map((deg, i) => (
          <View key={i} style={{
            position: 'absolute',
            width: 5, height: 5, borderRadius: 2.5,
            backgroundColor: theme.accentGlow,
            top: deg === 0 ? 0 : deg === 180 ? 53 : 26.5,
            left: deg === 90 ? 53 : deg === 270 ? 0 : 26.5,
          }} />
        ))}
      </Animated.View>
    </View>
  );
}

export function JukeboxItem({ item, theme }: ItemProps) {
  const noteY = useRef(new Animated.Value(0)).current;
  const noteOp = useRef(new Animated.Value(0)).current;
  const lightIdx = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const nl = animLoop(() => {
      noteY.setValue(0); noteOp.setValue(1);
      return Animated.parallel([
        Animated.timing(noteY, { toValue: -18, duration: 2500, useNativeDriver: false }),
        Animated.sequence([
          Animated.timing(noteOp, { toValue: 1, duration: 500, useNativeDriver: false }),
          Animated.timing(noteOp, { toValue: 0, duration: 2000, useNativeDriver: false }),
        ]),
      ]);
    });
    nl.start();
    const ll = animLoop(() => {
      lightIdx.setValue(0);
      return Animated.timing(lightIdx, { toValue: 4, duration: 1600, easing: Easing.linear, useNativeDriver: false });
    });
    ll.start();
    return () => { nl.stop(); ll.stop(); };
  }, []);
  const trackNames = ['Lo-fi Beats', 'Synthwave', 'Jazz Hop', 'Deep Focus', 'Ambient'];
  const trackName = trackNames[(item.jukeboxTrack || 0) % trackNames.length];
  const colors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b'];
  return (
    <View style={{ width: 54, height: 74, backgroundColor: '#7c2d12', borderWidth: 1, borderColor: '#f59e0b', borderRadius: 8, alignItems: 'center', overflow: 'hidden' }}>
      <View style={{ width: 40, height: 24, backgroundColor: '#0a0a1f', borderRadius: 4, marginTop: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f59e0b40' }}>
        <Text style={{ color: '#f59e0b', fontSize: 6, fontFamily: 'monospace' }} numberOfLines={1}>{trackName}</Text>
      </View>
      <Animated.Text style={{ position: 'absolute', top: 2, right: 4, fontSize: 8, color: '#f59e0b', opacity: noteOp, transform: [{ translateY: noteY }] }}>♫</Animated.Text>
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 4, justifyContent: 'center' }}>
        {colors.map((c, i) => {
          const op = lightIdx.interpolate({ inputRange: [i, i + 0.5, i + 1, 4], outputRange: [0.3, 1, 0.3, 0.3], extrapolate: 'clamp' });
          return <Animated.View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c, opacity: op }} />;
        })}
      </View>
      <Text style={{ color: '#f59e0b80', fontSize: 5, textAlign: 'center', marginTop: 2, fontFamily: 'monospace' }}>JUKEBOX</Text>
    </View>
  );
}

export function DiceRollerItem({ item, theme }: ItemProps) {
  const wobble = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = animLoop(() => Animated.sequence([
      Animated.timing(wobble, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(wobble, { toValue: -1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(wobble, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.delay(3000),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  const rot = wobble.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-3deg', '0deg', '3deg'] });
  const face = item.lastDiceRoll || 6;
  const dots: [number, number][] = face === 1 ? [[16,16]] : face === 2 ? [[8,8],[24,24]] : face === 3 ? [[8,8],[16,16],[24,24]] : face === 4 ? [[8,8],[24,8],[8,24],[24,24]] : face === 5 ? [[8,8],[24,8],[16,16],[8,24],[24,24]] : [[8,8],[24,8],[8,16],[24,16],[8,24],[24,24]];
  return (
    <Animated.View style={{ width: 44, height: 44, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: rot }] }}>
      <View style={{ width: 34, height: 34, position: 'relative' }}>
        {dots.map(([dx, dy], i) => (
          <View key={i} style={{ position: 'absolute', left: dx - 3, top: dy - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#1a1a1a' }} />
        ))}
      </View>
    </Animated.View>
  );
}

export function GongItem({ item, theme }: ItemProps) {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = animLoop(() => {
      shimmer.setValue(0);
      return Animated.timing(shimmer, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: false });
    });
    l.start();
    return () => l.stop();
  }, []);
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-20, 20] });
  const shimmerOp = shimmer.interpolate({ inputRange: [0, 0.3, 0.5, 0.7, 1], outputRange: [0, 0.4, 0.7, 0.4, 0] });
  return (
    <View style={{ width: 54, height: 64, alignItems: 'center' }}>
      <View style={{ width: 40, height: 4, backgroundColor: '#92400e', borderRadius: 2 }} />
      <View style={{ width: 2, height: 8, backgroundColor: '#78350f' }} />
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#f59e0b', borderWidth: 2, borderColor: '#d97706', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#92400e40' }} />
        <Animated.View style={{ position: 'absolute', width: 6, height: 38, backgroundColor: '#ffffff', opacity: shimmerOp, transform: [{ translateX: shimmerX }, { rotate: '15deg' }] }} />
      </View>
      <Text style={{ color: '#f59e0b80', fontSize: 5, marginTop: 1, fontFamily: 'monospace' }}>STRIKE</Text>
    </View>
  );
}

export function ConfettiCannonItem({ item, theme }: ItemProps) {
  const breathe = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const l = animLoop(() => Animated.sequence([
      Animated.timing(breathe, { toValue: 1.04, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(breathe, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  return (
    <View style={{ width: 44, height: 54, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 18, height: 8, backgroundColor: '#ef4444', borderTopLeftRadius: 9, borderTopRightRadius: 9 }} />
      <Animated.View style={{ width: 22, height: 30, backgroundColor: '#6b7280', borderRadius: 4, borderWidth: 1, borderColor: '#9ca3af', transform: [{ scaleY: breathe }] }} />
      <View style={{ width: 28, height: 6, backgroundColor: '#4b5563', borderRadius: 3 }} />
      <Text style={{ color: '#ef444480', fontSize: 5, marginTop: 1, fontFamily: 'monospace' }}>FIRE!</Text>
    </View>
  );
}

export function TimerDisplayItem({ item, theme }: ItemProps) {
  const [now, setNow] = useState(Date.now());
  const colonOp = useRef(new Animated.Value(1)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!item.timerEnd || item.timerEnd <= Date.now()) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [item.timerEnd]);

  useEffect(() => {
    const l = animLoop(() => Animated.sequence([
      Animated.timing(colonOp, { toValue: 0.2, duration: 500, useNativeDriver: false }),
      Animated.timing(colonOp, { toValue: 1, duration: 500, useNativeDriver: false }),
    ]));
    l.start();
    return () => l.stop();
  }, []);

  let mins = '25', secs = '00';
  let isFinished = false;
  if (item.timerEnd) {
    const remaining = Math.max(0, item.timerEnd - now);
    mins = String(Math.floor(remaining / 60000)).padStart(2, '0');
    secs = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
    isFinished = remaining <= 0 && item.timerEnd > 0;
  }

  useEffect(() => {
    if (!isFinished) { flashAnim.setValue(0); return; }
    const l = animLoop(() => Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 400, useNativeDriver: false }),
      Animated.timing(flashAnim, { toValue: 0, duration: 400, useNativeDriver: false }),
    ]));
    l.start();
    return () => l.stop();
  }, [isFinished]);

  const bgColor = isFinished
    ? flashAnim.interpolate({ inputRange: [0, 1], outputRange: ['#0f172a', '#3f0000'] })
    : '#0f172a';
  const textColor = isFinished ? '#ef4444' : '#22c55e';

  return (
    <Animated.View style={{ width: 64, height: 44, backgroundColor: bgColor, borderWidth: 1, borderColor: isFinished ? '#ef4444' : '#22c55e', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: textColor, fontSize: 16, fontWeight: '900', fontFamily: 'monospace' }}>{mins}</Text>
        <Animated.Text style={{ color: textColor, fontSize: 16, fontWeight: '900', fontFamily: 'monospace', opacity: colonOp }}>:</Animated.Text>
        <Text style={{ color: textColor, fontSize: 16, fontWeight: '900', fontFamily: 'monospace' }}>{secs}</Text>
      </View>
      <Text style={{ color: textColor + '60', fontSize: 5, fontFamily: 'monospace' }}>{isFinished ? 'TIME UP!' : 'POMODORO'}</Text>
    </Animated.View>
  );
}

export function ScoreboardItem({ item, theme, agents }: DataItemProps) {
  const activeCount = agents?.filter(a => a.status === 'active').length ?? 0;
  const doneCount = agents?.reduce((sum, a) => sum + (a.messagesProcessed || 0), 0) ?? 0;
  return (
    <View style={{ width: 94, height: 54, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#94a3b8', fontSize: 6, fontWeight: '700', fontFamily: 'monospace', marginTop: 2 }}>SCOREBOARD</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#22c55e', fontSize: 14, fontWeight: '900', fontFamily: 'monospace' }}>{doneCount}</Text>
          <Text style={{ color: '#64748b', fontSize: 5, fontFamily: 'monospace' }}>DONE</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#f59e0b', fontSize: 14, fontWeight: '900', fontFamily: 'monospace' }}>{activeCount}</Text>
          <Text style={{ color: '#64748b', fontSize: 5, fontFamily: 'monospace' }}>ACTIVE</Text>
        </View>
      </View>
    </View>
  );
}

export function StatusBoardItem({ item, theme, agents }: DataItemProps) {
  const list = (agents ?? []).slice(0, 5);
  const getColor = (s: string) => s === 'active' ? '#22c55e' : s === 'idle' ? '#eab308' : s === 'error' ? '#ef4444' : '#6b7280';
  return (
    <View style={{ width: 104, height: 64, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', borderRadius: 6, padding: 4 }}>
      <Text style={{ color: '#94a3b8', fontSize: 6, fontWeight: '700', fontFamily: 'monospace', marginBottom: 2 }}>STATUS BOARD</Text>
      {list.length > 0 ? list.map(a => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 1 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: getColor(a.status) }} />
          <Text style={{ color: '#94a3b8', fontSize: 5, fontFamily: 'monospace' }} numberOfLines={1}>{a.name.substring(0, 10)}</Text>
        </View>
      )) : [0, 1, 2].map(i => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 1 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: ['#22c55e', '#f59e0b', '#6b7280'][i] }} />
          <View style={{ width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2 }} />
        </View>
      ))}
    </View>
  );
}

export function CommandConsoleItem({ item, theme }: ItemProps) {
  const cursorOp = useRef(new Animated.Value(1)).current;
  const codeY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const cl = animLoop(() => Animated.sequence([
      Animated.timing(cursorOp, { toValue: 0, duration: 300, useNativeDriver: false }),
      Animated.timing(cursorOp, { toValue: 1, duration: 300, useNativeDriver: false }),
    ]));
    cl.start();
    const rl = animLoop(() => {
      codeY.setValue(0);
      return Animated.timing(codeY, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false });
    });
    rl.start();
    return () => { cl.stop(); rl.stop(); };
  }, []);
  const rainOp = codeY.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.15, 0] });
  const rainY = codeY.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });
  return (
    <View style={{ width: 84, height: 54, backgroundColor: '#0f172a', borderWidth: 1, borderColor: theme.accentGlow, borderRadius: 6, alignItems: 'center', overflow: 'hidden' }}>
      <View style={{ backgroundColor: '#020617', borderRadius: 3, width: 72, height: 30, marginTop: 3, padding: 3, borderWidth: 1, borderColor: theme.accentGlow + '30', overflow: 'hidden' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 3, opacity: rainOp, transform: [{ translateY: rainY }] }}>
          {[0, 1, 2].map(i => (
            <Text key={i} style={{ color: theme.accentGlow + '40', fontSize: 5, fontFamily: 'monospace' }}>{'01'.repeat(6)}</Text>
          ))}
        </Animated.View>
        <View style={{ flexDirection: 'row', zIndex: 2 }}>
          <Text style={{ color: theme.accentGlow, fontSize: 7, fontFamily: 'monospace' }}>{'>'}</Text>
          <Animated.Text style={{ color: theme.accentGlow, fontSize: 7, fontFamily: 'monospace', opacity: cursorOp }}>_</Animated.Text>
        </View>
      </View>
      <Text style={{ color: theme.accentGlow + '60', fontSize: 5, marginTop: 2, fontFamily: 'monospace', textAlign: 'center' }}>CONSOLE</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  6 NEW ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

const SLOT_SYMBOLS = ['🍒', '🔔', '💎', '7️⃣', '⭐', '🍀'];

export function SlotMachineItem({ item, theme }: ItemProps) {
  const result = item.slotResult ?? [0, 1, 2];
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState(result);
  const spinAnims = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    if (!item.slotResult) return;
    // Trigger spin animation when result changes
    setSpinning(true);
    const newResult = item.slotResult;
    spinAnims.forEach(a => a.setValue(0));
    const anims = spinAnims.map((a, i) =>
      Animated.timing(a, { toValue: 1, duration: 800 + i * 400, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    );
    Animated.parallel(anims).start(() => {
      setDisplay(newResult);
      setSpinning(false);
    });
  }, [item.slotResult?.[0], item.slotResult?.[1], item.slotResult?.[2]]);

  const leverPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = animLoop(() => Animated.sequence([
      Animated.timing(leverPulse, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(leverPulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  const leverGlow = leverPulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <View style={{ width: 56, height: 74, backgroundColor: '#7f1d1d', borderWidth: 1, borderColor: '#fbbf24', borderRadius: 6, alignItems: 'center', overflow: 'hidden' }}>
      <Text style={{ color: '#fbbf24', fontSize: 5, fontWeight: '900', fontFamily: 'monospace', marginTop: 2 }}>JACKPOT</Text>
      <View style={{ flexDirection: 'row', gap: 1, marginTop: 2, backgroundColor: '#0a0a0f', borderRadius: 3, padding: 2, borderWidth: 1, borderColor: '#fbbf2440' }}>
        {display.map((idx, i) => (
          <View key={i} style={{ width: 14, height: 18, backgroundColor: '#1a1a2e', borderRadius: 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#334155' }}>
            <Text style={{ fontSize: 10 }}>{SLOT_SYMBOLS[idx % SLOT_SYMBOLS.length]}</Text>
          </View>
        ))}
      </View>
      <Animated.View style={{ width: 8, height: 16, backgroundColor: '#ef4444', borderRadius: 4, marginTop: 3, opacity: leverGlow, borderWidth: 1, borderColor: '#fbbf24' }} />
      <Text style={{ color: '#fbbf2460', fontSize: 4, fontFamily: 'monospace', marginTop: 1 }}>PULL!</Text>
    </View>
  );
}

const FORTUNES = [
  'A merge conflict approaches...',
  'The CI pipeline smiles upon you',
  'Refactor now, or pay later',
  'A bug lurks in the shadows',
  'Your PR will be approved swiftly',
  'Avoid deploys during Mercury retrograde',
  'The tests... they will pass',
  'A new feature request draws near',
  'Your code review karma is strong',
  'Beware of scope creep',
  'The sprint gods favor you today',
  'An API rate limit awaits',
  'Your commit messages bring joy',
  'A dependency update looms',
  'Trust the process. Ship it.',
  'The stand-up will be brief today',
  'A tech debt payment is overdue',
  'Pair programming session will be legendary',
  'The backlog grows ever deeper',
  'Today you write your best code yet',
];

export function CrystalBallItem({ item, theme }: ItemProps) {
  const orb1 = useRef(new Animated.Value(0)).current;
  const orb2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l1 = animLoop(() => {
      orb1.setValue(0);
      return Animated.timing(orb1, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false });
    });
    const l2 = animLoop(() => {
      orb2.setValue(0);
      return Animated.timing(orb2, { toValue: 1, duration: 5000, easing: Easing.linear, useNativeDriver: false });
    });
    l1.start(); l2.start();
    return () => { l1.stop(); l2.stop(); };
  }, []);
  const o1x = orb1.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 8, 0, -8, 0] });
  const o1y = orb1.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [-6, 0, 6, 0, -6] });
  const o2x = orb2.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [6, 0, -6, 0, 6] });
  const o2y = orb2.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -5, 0, 5, 0] });
  return (
    <View style={{ width: 46, height: 50, alignItems: 'center' }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e0a3a', borderWidth: 2, borderColor: '#7c3aed', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#c084fc40', transform: [{ translateX: o1x }, { translateY: o1y }] }} />
        <Animated.View style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#a855f740', transform: [{ translateX: o2x }, { translateY: o2y }] }} />
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#c084fc80', zIndex: 2 }} />
      </View>
      <View style={{ width: 24, height: 6, backgroundColor: '#4c1d95', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
      {item.fortuneText && (
        <Text style={{ color: '#c084fc', fontSize: 4, fontFamily: 'monospace', textAlign: 'center', marginTop: 1, width: 50 }} numberOfLines={2}>{item.fortuneText}</Text>
      )}
    </View>
  );
}

export function MoodRingItem({ item, theme, agents }: DataItemProps) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const l = animLoop(() => Animated.sequence([
      Animated.timing(pulse, { toValue: 1.15, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  const hasError = agents?.some(a => a.status === 'error');
  const hasActive = agents?.some(a => a.status === 'active');
  const color = hasError ? '#ef4444' : hasActive ? '#f59e0b' : '#22c55e';
  const label = hasError ? 'STRESSED' : hasActive ? 'GRINDING' : 'CHILL';
  return (
    <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 4, borderColor: color, backgroundColor: color + '15', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pulse }] }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color + '40' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color + '80', margin: 5 }} />
        </View>
      </Animated.View>
      <Text style={{ color: color + '80', fontSize: 5, fontFamily: 'monospace', marginTop: 1 }}>{label}</Text>
    </View>
  );
}

export function BoomBoxItem({ item, theme }: ItemProps) {
  const isPlaying = item.boomboxPlaying ?? false;
  const bars = useRef(Array.from({ length: 5 }, () => new Animated.Value(0.3))).current;
  const waveOp = useRef(new Animated.Value(0)).current;
  const waveScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isPlaying) {
      bars.forEach(b => b.setValue(0.3));
      return;
    }
    const loops = bars.map((bar, i) => {
      const l = animLoop(() => Animated.sequence([
        Animated.timing(bar, { toValue: 0.3 + Math.random() * 0.7, duration: 150 + i * 50, useNativeDriver: false }),
        Animated.timing(bar, { toValue: 0.1 + Math.random() * 0.3, duration: 150 + i * 40, useNativeDriver: false }),
      ]));
      l.start();
      return l;
    });
    const wl = animLoop(() => {
      waveOp.setValue(0.6); waveScale.setValue(1);
      return Animated.parallel([
        Animated.timing(waveScale, { toValue: 1.8, duration: 1000, useNativeDriver: false }),
        Animated.timing(waveOp, { toValue: 0, duration: 1000, useNativeDriver: false }),
      ]);
    });
    wl.start();
    return () => { loops.forEach(l => l.stop()); wl.stop(); };
  }, [isPlaying]);

  return (
    <View style={{ width: 66, height: 46, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Speaker cones */}
      <View style={{ flexDirection: 'row', position: 'absolute', top: 4, gap: 30 }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#475569', backgroundColor: '#0f172a' }} />
        <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#475569', backgroundColor: '#0f172a' }} />
      </View>
      {/* Equalizer */}
      <View style={{ flexDirection: 'row', gap: 2, alignItems: 'flex-end', height: 20, marginTop: 6 }}>
        {bars.map((bar, i) => {
          const h = bar.interpolate({ inputRange: [0, 1], outputRange: [3, 18] });
          const colors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6'];
          return <Animated.View key={i} style={{ width: 5, height: h, backgroundColor: isPlaying ? colors[i] : '#334155', borderRadius: 1 }} />;
        })}
      </View>
      <Text style={{ color: isPlaying ? '#22c55e' : '#64748b', fontSize: 5, fontFamily: 'monospace', marginTop: 2 }}>
        {isPlaying ? '▶ PLAYING' : '⏸ PAUSED'}
      </Text>
      {/* Sound waves */}
      {isPlaying && (
        <Animated.View pointerEvents="none" style={{
          position: 'absolute', width: 80, height: 80, borderRadius: 40,
          borderWidth: 1, borderColor: theme.accentGlow + '30',
          opacity: waveOp, transform: [{ scale: waveScale }],
        }} />
      )}
    </View>
  );
}

export function LavaLampItem({ item, theme }: ItemProps) {
  const blob1Y = useRef(new Animated.Value(0)).current;
  const blob2Y = useRef(new Animated.Value(0)).current;
  const blob1S = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const l1 = animLoop(() => Animated.sequence([
      Animated.timing(blob1Y, { toValue: -14, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(blob1Y, { toValue: 14, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const l2 = animLoop(() => Animated.sequence([
      Animated.timing(blob2Y, { toValue: 10, duration: 3500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(blob2Y, { toValue: -10, duration: 3500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const ls = animLoop(() => Animated.sequence([
      Animated.timing(blob1S, { toValue: 1.3, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(blob1S, { toValue: 0.8, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    l1.start(); l2.start(); ls.start();
    return () => { l1.stop(); l2.stop(); ls.stop(); };
  }, []);
  const color = item.lavaColor || theme.accentGlow;
  return (
    <View style={{ width: 26, height: 56, alignItems: 'center' }}>
      {/* Cap */}
      <View style={{ width: 16, height: 4, backgroundColor: '#6b7280', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
      {/* Body */}
      <View style={{ width: 20, height: 40, backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{
          width: 10, height: 10, borderRadius: 5,
          backgroundColor: color + '90',
          transform: [{ translateY: blob1Y }, { scaleX: blob1S }],
        }} />
        <Animated.View style={{
          width: 7, height: 7, borderRadius: 3.5,
          backgroundColor: color + '60',
          transform: [{ translateY: blob2Y }],
          marginTop: -2,
        }} />
      </View>
      {/* Base */}
      <View style={{ width: 22, height: 6, backgroundColor: '#374151', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
    </View>
  );
}

export function WhackAMoleItem({ item, theme }: ItemProps) {
  const [activeMole, setActiveMole] = useState<number | null>(null);
  const [score, setScore] = useState(item.whackScore ?? 0);
  const [flash, setFlash] = useState<number | null>(null);

  useEffect(() => {
    let timeout: any;
    const spawn = () => {
      const hole = Math.floor(Math.random() * 6);
      setActiveMole(hole);
      timeout = setTimeout(() => {
        setActiveMole(prev => prev === hole ? null : prev);
        timeout = setTimeout(spawn, 800 + Math.random() * 1200);
      }, 1000);
    };
    timeout = setTimeout(spawn, 1000 + Math.random() * 1500);
    return () => clearTimeout(timeout);
  }, []);

  const whack = (hole: number) => {
    if (activeMole === hole) {
      setScore(s => s + 1);
      setActiveMole(null);
      setFlash(hole);
      setTimeout(() => setFlash(null), 300);
    }
  };

  return (
    <View style={{ width: 76, height: 56, backgroundColor: '#4a2c0a', borderWidth: 1, borderColor: '#78350f', borderRadius: 6, padding: 3 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ color: '#f59e0b', fontSize: 5, fontWeight: '900', fontFamily: 'monospace' }}>WHACK!</Text>
        <Text style={{ color: '#22c55e', fontSize: 5, fontWeight: '900', fontFamily: 'monospace' }}>{score}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <Pressable
            key={i}
            onPress={(e) => { e.stopPropagation?.(); whack(i); }}
            style={{
              width: 20, height: 16, borderRadius: 10,
              backgroundColor: flash === i ? '#fbbf24' : '#2a1a06',
              borderWidth: 1, borderColor: '#5a3510',
              alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
              ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
            }}
          >
            {activeMole === i && (
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#8b4513', marginTop: -2, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: '#000' }} />
                  <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: '#000' }} />
                </View>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
