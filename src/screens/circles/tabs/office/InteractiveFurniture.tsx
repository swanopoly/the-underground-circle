import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Animated, Easing, Pressable, Platform, Linking } from 'react-native';
import { animLoop } from '../../../../lib/animationHelpers';
import type { FurnitureItem, OfficeTheme } from '../../../../lib/officeConfig';
import type { OfficeAgent } from '../../../../lib/officeAgents';

interface ItemProps { item: FurnitureItem; theme: OfficeTheme; }
interface DataItemProps extends ItemProps { agents?: OfficeAgent[]; }

const S: any = Platform.OS === 'web' ? { cursor: 'default' } : {};

// ── Embed URL helpers (web only) ─────────────────────────────────────────────

/** Convert a YouTube watch/share URL into an embeddable URL */
function youtubeEmbedUrl(url: string): string | null {
  try {
    // https://www.youtube.com/watch?v=VIDEO_ID
    const m1 = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m1) return `https://www.youtube.com/embed/${m1[1]}?autoplay=1&mute=1`;
    // https://youtu.be/VIDEO_ID
    const m2 = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m2) return `https://www.youtube.com/embed/${m2[1]}?autoplay=1&mute=1`;
    // https://www.youtube.com/embed/VIDEO_ID (already embed)
    if (url.includes('youtube.com/embed/')) return url;
    return null;
  } catch { return null; }
}

/** Build a Twitch player embed URL */
function twitchEmbedUrl(channel: string): string | null {
  if (!channel) return null;
  const host = Platform.OS === 'web' ? window.location.hostname : 'localhost';
  return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${host}&muted=true`;
}

/** Get embed URL for a TV app + content URL */
function getTvEmbedUrl(app: string, contentUrl?: string): string | null {
  if (!contentUrl) return null;
  switch (app) {
    case 'youtube': return youtubeEmbedUrl(contentUrl);
    case 'twitch': {
      // Extract channel from twitch.tv URL or use as-is
      const m = contentUrl.match(/twitch\.tv\/([A-Za-z0-9_]+)/);
      return twitchEmbedUrl(m ? m[1] : contentUrl);
    }
    default: return null; // netflix/hulu/disney don't allow iframe embedding
  }
}

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

// ═══════════════════════════════════════════════════════════════════════════════
//  NEW ITEMS — VIBE & PRODUCTIVITY
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Fireplace — Crackling fire with dancing flames and floating embers ──────

export function FireplaceItem({ item, theme }: ItemProps) {
  const flame1 = useRef(new Animated.Value(0)).current;
  const flame2 = useRef(new Animated.Value(0)).current;
  const ember1 = useRef(new Animated.Value(0)).current;
  const ember2 = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const f1 = animLoop(() => Animated.sequence([
      Animated.timing(flame1, { toValue: 1, duration: 400 + Math.random() * 300, useNativeDriver: false }),
      Animated.timing(flame1, { toValue: 0, duration: 300 + Math.random() * 200, useNativeDriver: false }),
    ]));
    const f2 = animLoop(() => Animated.sequence([
      Animated.timing(flame2, { toValue: 1, duration: 500 + Math.random() * 200, useNativeDriver: false }),
      Animated.timing(flame2, { toValue: 0, duration: 350 + Math.random() * 250, useNativeDriver: false }),
    ]));
    const e1 = animLoop(() => {
      ember1.setValue(0);
      return Animated.timing(ember1, { toValue: 1, duration: 2000 + Math.random() * 1500, useNativeDriver: false });
    });
    const e2 = animLoop(() => {
      ember2.setValue(0);
      return Animated.timing(ember2, { toValue: 1, duration: 2500 + Math.random() * 1000, useNativeDriver: false });
    });
    const g = animLoop(() => Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    f1.start(); f2.start(); e1.start(); e2.start(); g.start();
    return () => { f1.stop(); f2.stop(); e1.stop(); e2.stop(); g.stop(); };
  }, []);

  const intensity = item.fireplaceIntensity ?? 1;
  const flameH1 = flame1.interpolate({ inputRange: [0, 1], outputRange: [14 + intensity * 4, 22 + intensity * 6] });
  const flameH2 = flame2.interpolate({ inputRange: [0, 1], outputRange: [10 + intensity * 3, 18 + intensity * 5] });
  const emberY1 = ember1.interpolate({ inputRange: [0, 1], outputRange: [0, -30] });
  const emberOp1 = ember1.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] });
  const emberX1 = ember1.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  const emberY2 = ember2.interpolate({ inputRange: [0, 1], outputRange: [0, -26] });
  const emberOp2 = ember2.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] });
  const emberX2 = ember2.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const glowOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] });

  return (
    <View style={{ width: 76, height: 64, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* Ambient glow */}
      <Animated.View style={{ position: 'absolute', bottom: 10, width: 60, height: 40, borderRadius: 20, backgroundColor: '#ff6600', opacity: glowOp }} />
      {/* Mantle */}
      <View style={{ position: 'absolute', top: 0, width: 72, height: 8, backgroundColor: '#5a3825', borderRadius: 2, borderWidth: 1, borderColor: '#3d2512' }} />
      {/* Brick surround */}
      <View style={{ position: 'absolute', top: 8, left: 2, width: 10, height: 50, backgroundColor: '#8b4513', borderWidth: 1, borderColor: '#5a3015' }} />
      <View style={{ position: 'absolute', top: 8, right: 2, width: 10, height: 50, backgroundColor: '#8b4513', borderWidth: 1, borderColor: '#5a3015' }} />
      {/* Hearth */}
      <View style={{ width: 52, height: 44, backgroundColor: '#1a0a00', borderBottomLeftRadius: 4, borderBottomRightRadius: 4, overflow: 'hidden', marginBottom: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
        {/* Flames */}
        <Animated.View style={{ position: 'absolute', bottom: 4, left: 10, width: 10, height: flameH1, backgroundColor: '#ff4500', borderRadius: 5, opacity: 0.9 }} />
        <Animated.View style={{ position: 'absolute', bottom: 4, left: 20, width: 12, height: flameH2, backgroundColor: '#ff6600', borderRadius: 6 }} />
        <Animated.View style={{ position: 'absolute', bottom: 4, right: 10, width: 10, height: flameH1, backgroundColor: '#ffaa00', borderRadius: 5, opacity: 0.8 }} />
        <Animated.View style={{ position: 'absolute', bottom: 6, left: 16, width: 6, height: flameH2, backgroundColor: '#ffcc00', borderRadius: 3, opacity: 0.7 }} />
        {/* Logs */}
        <View style={{ width: 36, height: 6, backgroundColor: '#3d1a00', borderRadius: 3, marginBottom: 2, transform: [{ rotate: '-8deg' }] }} />
        <View style={{ width: 30, height: 5, backgroundColor: '#4a2200', borderRadius: 2.5, marginBottom: 1, transform: [{ rotate: '5deg' }] }} />
      </View>
      {/* Embers */}
      <Animated.View style={{ position: 'absolute', bottom: 30, left: 28, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ffaa00', opacity: emberOp1, transform: [{ translateY: emberY1 }, { translateX: emberX1 }] }} />
      <Animated.View style={{ position: 'absolute', bottom: 28, right: 22, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ff6600', opacity: emberOp2, transform: [{ translateY: emberY2 }, { translateX: emberX2 }] }} />
      {/* Base */}
      <View style={{ width: 76, height: 6, backgroundColor: '#5a3825', borderRadius: 1, borderWidth: 1, borderColor: '#3d2512' }} />
    </View>
  );
}

// ─── Aquarium — Fish tank with swimming fish, bubbles, and swaying plant ─────

export function AquariumItem({ item, theme }: ItemProps) {
  const fish1X = useRef(new Animated.Value(0)).current;
  const fish2X = useRef(new Animated.Value(1)).current;
  const fish3X = useRef(new Animated.Value(0.5)).current;
  const bubble1 = useRef(new Animated.Value(0)).current;
  const bubble2 = useRef(new Animated.Value(0)).current;
  const plantSway = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const f1 = animLoop(() => Animated.sequence([
      Animated.timing(fish1X, { toValue: 1, duration: 3500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(fish1X, { toValue: 0, duration: 3500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const f2 = animLoop(() => Animated.sequence([
      Animated.timing(fish2X, { toValue: 0, duration: 4200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(fish2X, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const f3 = animLoop(() => Animated.sequence([
      Animated.timing(fish3X, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(fish3X, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const b1 = animLoop(() => { bubble1.setValue(0); return Animated.timing(bubble1, { toValue: 1, duration: 2200, useNativeDriver: false }); });
    const b2 = animLoop(() => { bubble2.setValue(0); return Animated.timing(bubble2, { toValue: 1, duration: 2800, useNativeDriver: false }); });
    const ps = animLoop(() => Animated.sequence([
      Animated.timing(plantSway, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(plantSway, { toValue: -1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    f1.start(); f2.start(); f3.start(); b1.start(); b2.start(); ps.start();
    return () => { f1.stop(); f2.stop(); f3.stop(); b1.stop(); b2.stop(); ps.stop(); };
  }, []);

  const f1Left = fish1X.interpolate({ inputRange: [0, 1], outputRange: [4, 62] });
  const f2Left = fish2X.interpolate({ inputRange: [0, 1], outputRange: [8, 56] });
  const f3Left = fish3X.interpolate({ inputRange: [0, 1], outputRange: [12, 50] });
  const b1Y = bubble1.interpolate({ inputRange: [0, 1], outputRange: [38, 4] });
  const b1Op = bubble1.interpolate({ inputRange: [0, 0.2, 0.9, 1], outputRange: [0, 0.8, 0.8, 0] });
  const b2Y = bubble2.interpolate({ inputRange: [0, 1], outputRange: [34, 6] });
  const b2Op = bubble2.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.6, 0.6, 0] });
  const swayRot = plantSway.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });

  return (
    <View style={{ width: 84, height: 54, backgroundColor: '#0a1628', borderWidth: 2, borderColor: '#64748b', borderRadius: 6, overflow: 'hidden' }}>
      {/* Water tint */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0066aa20' }} />
      {/* Gravel */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, backgroundColor: '#78350f' }} />
      <View style={{ position: 'absolute', bottom: 0, left: 6, width: 4, height: 3, borderRadius: 2, backgroundColor: '#92400e' }} />
      <View style={{ position: 'absolute', bottom: 1, left: 18, width: 3, height: 2, borderRadius: 1, backgroundColor: '#a16207' }} />
      {/* Plant */}
      <Animated.View style={{ position: 'absolute', bottom: 6, left: 8, width: 4, height: 22, backgroundColor: '#15803d', borderRadius: 2, transform: [{ rotate: swayRot }], transformOrigin: 'bottom center' }} />
      <Animated.View style={{ position: 'absolute', bottom: 10, left: 10, width: 3, height: 16, backgroundColor: '#22c55e', borderRadius: 1.5, transform: [{ rotate: swayRot }], transformOrigin: 'bottom center' }} />
      {/* Fish */}
      <Animated.View style={{ position: 'absolute', top: 14, left: f1Left, width: 10, height: 5, backgroundColor: '#f97316', borderRadius: 3 }}>
        <View style={{ position: 'absolute', right: -3, top: 0, width: 0, height: 0, borderLeftWidth: 4, borderLeftColor: '#f97316', borderTopWidth: 2.5, borderTopColor: 'transparent', borderBottomWidth: 2.5, borderBottomColor: 'transparent' }} />
        <View style={{ position: 'absolute', left: 2, top: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#000' }} />
      </Animated.View>
      <Animated.View style={{ position: 'absolute', top: 26, left: f2Left, width: 8, height: 4, backgroundColor: '#3b82f6', borderRadius: 2.5 }}>
        <View style={{ position: 'absolute', left: -2, top: 0, width: 0, height: 0, borderRightWidth: 3, borderRightColor: '#3b82f6', borderTopWidth: 2, borderTopColor: 'transparent', borderBottomWidth: 2, borderBottomColor: 'transparent' }} />
        <View style={{ position: 'absolute', right: 1, top: 1, width: 1.5, height: 1.5, borderRadius: 1, backgroundColor: '#000' }} />
      </Animated.View>
      <Animated.View style={{ position: 'absolute', top: 18, left: f3Left, width: 7, height: 3.5, backgroundColor: '#ec4899', borderRadius: 2 }}>
        <View style={{ position: 'absolute', left: 1, top: 0.5, width: 1.5, height: 1.5, borderRadius: 1, backgroundColor: '#000' }} />
      </Animated.View>
      {/* Bubbles */}
      <Animated.View style={{ position: 'absolute', left: 30, top: b1Y, width: 4, height: 4, borderRadius: 2, borderWidth: 1, borderColor: '#ffffff40', opacity: b1Op }} />
      <Animated.View style={{ position: 'absolute', left: 50, top: b2Y, width: 3, height: 3, borderRadius: 1.5, borderWidth: 1, borderColor: '#ffffff30', opacity: b2Op }} />
      {/* Light shimmer */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#ffffff08' }} />
    </View>
  );
}

// ─── Vinyl Player — Spinning record on turntable with tonearm ────────────────

export function VinylPlayerItem({ item, theme }: ItemProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const armAngle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (item.vinylPlaying) {
      const s = animLoop(() => Animated.timing(spin, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: false }));
      s.start();
      Animated.timing(armAngle, { toValue: 1, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
      return () => s.stop();
    } else {
      Animated.timing(armAngle, { toValue: 0, duration: 400, useNativeDriver: false }).start();
    }
  }, [item.vinylPlaying]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const armRot = armAngle.interpolate({ inputRange: [0, 1], outputRange: ['-30deg', '0deg'] });

  return (
    <View style={{ width: 56, height: 56, backgroundColor: '#2d1b0e', borderWidth: 1.5, borderColor: '#5a3825', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}>
      {/* Platter */}
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' }}>
        {/* Record */}
        <Animated.View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center', transform: [{ rotate }] }}>
          {/* Grooves */}
          <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 0.5, borderColor: '#1a1a1a' }} />
          <View style={{ position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 0.5, borderColor: '#1a1a1a' }} />
          <View style={{ position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 0.5, borderColor: '#1a1a1a' }} />
          {/* Label */}
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: item.vinylPlaying ? '#ef4444' : '#666', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#1a1a1a' }} />
          </View>
        </Animated.View>
      </View>
      {/* Tonearm */}
      <Animated.View style={{ position: 'absolute', top: 4, right: 6, width: 3, height: 22, backgroundColor: '#aaa', borderRadius: 1.5, transform: [{ rotate: armRot }], transformOrigin: 'top right' }} />
      {/* Status light */}
      <View style={{ position: 'absolute', bottom: 3, right: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: item.vinylPlaying ? '#22c55e' : '#333' }} />
    </View>
  );
}

// ─── Rain Window — Lo-fi window with animated rain drops ─────────────────────

export function RainWindowItem({ item, theme }: ItemProps) {
  const drop1 = useRef(new Animated.Value(0)).current;
  const drop2 = useRef(new Animated.Value(0)).current;
  const drop3 = useRef(new Animated.Value(0)).current;
  const drop4 = useRef(new Animated.Value(0)).current;
  const drop5 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeDrop = (v: Animated.Value, dur: number, delay: number) => {
      const l = animLoop(() => Animated.sequence([
        Animated.delay(delay),
        ...[{ setValue: 0 }].map(() => { v.setValue(0); return Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: false }); }),
      ]));
      l.start();
      return l;
    };
    const d1 = makeDrop(drop1, 900, 0);
    const d2 = makeDrop(drop2, 1100, 200);
    const d3 = makeDrop(drop3, 800, 400);
    const d4 = makeDrop(drop4, 1000, 150);
    const d5 = makeDrop(drop5, 950, 350);
    return () => { d1.stop(); d2.stop(); d3.stop(); d4.stop(); d5.stop(); };
  }, []);

  const mkY = (v: Animated.Value) => v.interpolate({ inputRange: [0, 1], outputRange: [0, 40] });
  const mkOp = (v: Animated.Value) => v.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 0.7, 0.7, 0] });

  return (
    <View style={{ width: 66, height: 46, backgroundColor: '#1a2744', borderWidth: 2, borderColor: '#5a3825', borderRadius: 4, overflow: 'hidden' }}>
      {/* Sky gradient */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 20, backgroundColor: '#2d3a52' }} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 12, backgroundColor: '#14192a' }} />
      {/* Distant buildings */}
      <View style={{ position: 'absolute', bottom: 10, left: 6, width: 8, height: 18, backgroundColor: '#1e293b' }} />
      <View style={{ position: 'absolute', bottom: 10, left: 16, width: 10, height: 24, backgroundColor: '#1e293b' }} />
      <View style={{ position: 'absolute', bottom: 10, right: 12, width: 12, height: 20, backgroundColor: '#1e293b' }} />
      <View style={{ position: 'absolute', bottom: 10, right: 6, width: 6, height: 14, backgroundColor: '#1e293b' }} />
      {/* Building windows (tiny yellow dots) */}
      <View style={{ position: 'absolute', bottom: 16, left: 18, width: 2, height: 2, backgroundColor: '#fbbf2480' }} />
      <View style={{ position: 'absolute', bottom: 22, left: 19, width: 2, height: 2, backgroundColor: '#fbbf2460' }} />
      <View style={{ position: 'absolute', bottom: 18, right: 14, width: 2, height: 2, backgroundColor: '#fbbf2450' }} />
      {/* Window divider */}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: '50%' as any, width: 2, backgroundColor: '#5a382580', zIndex: 3 }} />
      {/* Rain drops */}
      {[{ v: drop1, x: 8 }, { v: drop2, x: 20 }, { v: drop3, x: 35 }, { v: drop4, x: 48 }, { v: drop5, x: 56 }].map((d, i) => (
        <Animated.View key={i} style={{ position: 'absolute', top: 2, left: d.x, width: 1.5, height: 6, backgroundColor: '#94a3b8', borderRadius: 1, opacity: mkOp(d.v), transform: [{ translateY: mkY(d.v) }] }} />
      ))}
      {/* Condensation on glass */}
      <View style={{ position: 'absolute', bottom: 3, left: 10, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ffffff10' }} />
      <View style={{ position: 'absolute', bottom: 6, right: 15, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffffff08' }} />
    </View>
  );
}

// ─── Galaxy Orb — Floating cosmic sphere with orbiting stars ─────────────────

export function GalaxyOrbItem({ item, theme }: ItemProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const s = animLoop(() => Animated.timing(spin, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: false }));
    const p = animLoop(() => Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const f = animLoop(() => Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(float, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    s.start(); p.start(); f.start();
    return () => { s.stop(); p.stop(); f.stop(); };
  }, []);

  const rot = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const sc = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const glowOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <Animated.View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: floatY }] }}>
      {/* Outer glow */}
      <Animated.View style={{ position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: '#6366f1', opacity: glowOp }} />
      {/* Orb body */}
      <Animated.View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#0f0a2a', borderWidth: 1, borderColor: '#6366f180', overflow: 'hidden', transform: [{ scale: sc }] }}>
        {/* Nebula swirls */}
        <View style={{ position: 'absolute', top: 4, left: 2, width: 20, height: 8, backgroundColor: '#6366f130', borderRadius: 4, transform: [{ rotate: '30deg' }] }} />
        <View style={{ position: 'absolute', bottom: 6, right: 2, width: 16, height: 6, backgroundColor: '#ec489930', borderRadius: 3, transform: [{ rotate: '-20deg' }] }} />
        <View style={{ position: 'absolute', top: 14, left: 8, width: 12, height: 4, backgroundColor: '#22c55e20', borderRadius: 2, transform: [{ rotate: '10deg' }] }} />
      </Animated.View>
      {/* Orbiting stars */}
      <Animated.View style={{ position: 'absolute', width: 42, height: 42, transform: [{ rotate: rot }] }}>
        <View style={{ position: 'absolute', top: 0, left: 19, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fbbf24' }} />
        <View style={{ position: 'absolute', bottom: 4, right: 2, width: 2, height: 2, borderRadius: 1, backgroundColor: '#60a5fa' }} />
        <View style={{ position: 'absolute', top: 18, left: 0, width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: '#f472b6' }} />
      </Animated.View>
      {/* Center star */}
      <Animated.View style={{ position: 'absolute', width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#fff', opacity: glowOp }} />
    </Animated.View>
  );
}

// ─── Terrarium — Mini garden with butterflies and growing plants ─────────────

export function TerrariumItem({ item, theme }: ItemProps) {
  const butterfly1 = useRef(new Animated.Value(0)).current;
  const butterfly2 = useRef(new Animated.Value(0)).current;
  const wingFlap = useRef(new Animated.Value(0)).current;
  const plantGrow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const b1 = animLoop(() => Animated.sequence([
      Animated.timing(butterfly1, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(butterfly1, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const b2 = animLoop(() => Animated.sequence([
      Animated.timing(butterfly2, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(butterfly2, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const wf = animLoop(() => Animated.sequence([
      Animated.timing(wingFlap, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.timing(wingFlap, { toValue: 0, duration: 300, useNativeDriver: false }),
    ]));
    const pg = animLoop(() => Animated.sequence([
      Animated.timing(plantGrow, { toValue: 1, duration: 5000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(plantGrow, { toValue: 0, duration: 5000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    b1.start(); b2.start(); wf.start(); pg.start();
    return () => { b1.stop(); b2.stop(); wf.stop(); pg.stop(); };
  }, []);

  const b1X = butterfly1.interpolate({ inputRange: [0, 1], outputRange: [8, 40] });
  const b1Y = butterfly1.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [10, 4, 14, 8] });
  const b2X = butterfly2.interpolate({ inputRange: [0, 1], outputRange: [36, 12] });
  const b2Y = butterfly2.interpolate({ inputRange: [0, 0.5, 1], outputRange: [6, 16, 6] });
  const wingScale = wingFlap.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const flowerScale = plantGrow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] });

  return (
    <View style={{ width: 56, height: 46, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* Glass dome */}
      <View style={{ width: 50, height: 38, borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1.5, borderColor: '#ffffff20', borderBottomWidth: 0, backgroundColor: '#ffffff06', overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }}>
        {/* Soil */}
        <View style={{ width: '100%', height: 10, backgroundColor: '#3d2012' }} />
        {/* Plants */}
        <View style={{ position: 'absolute', bottom: 8, left: 10, width: 3, height: 16, backgroundColor: '#15803d', borderRadius: 1 }} />
        <Animated.View style={{ position: 'absolute', bottom: 22, left: 8, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#f472b6', transform: [{ scale: flowerScale }] }} />
        <View style={{ position: 'absolute', bottom: 8, right: 12, width: 2, height: 12, backgroundColor: '#166534', borderRadius: 1 }} />
        <View style={{ position: 'absolute', bottom: 8, left: 22, width: 2.5, height: 14, backgroundColor: '#22c55e', borderRadius: 1 }} />
        <Animated.View style={{ position: 'absolute', bottom: 20, left: 20, width: 6, height: 6, borderRadius: 3, backgroundColor: '#fbbf24', transform: [{ scale: flowerScale }] }} />
        {/* Mushroom */}
        <View style={{ position: 'absolute', bottom: 8, right: 8, width: 3, height: 6, backgroundColor: '#f5f5dc' }} />
        <View style={{ position: 'absolute', bottom: 13, right: 5, width: 9, height: 5, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: '#ef4444' }} />
        {/* Butterflies */}
        <Animated.View style={{ position: 'absolute', left: b1X, top: b1Y }}>
          <Animated.View style={{ width: 4, height: 3, backgroundColor: '#c084fc', borderRadius: 1.5, transform: [{ scaleX: wingScale }] }} />
        </Animated.View>
        <Animated.View style={{ position: 'absolute', left: b2X, top: b2Y }}>
          <Animated.View style={{ width: 3.5, height: 2.5, backgroundColor: '#60a5fa', borderRadius: 1.5, transform: [{ scaleX: wingScale }] }} />
        </Animated.View>
      </View>
      {/* Base plate */}
      <View style={{ width: 54, height: 6, backgroundColor: '#5a3825', borderRadius: 2, borderWidth: 1, borderColor: '#3d2512' }} />
    </View>
  );
}

// ─── Zen Garden — Raked sand with stones, click to change pattern ────────────

export function ZenGardenItem({ item, theme }: ItemProps) {
  const wavePhase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const w = animLoop(() => Animated.timing(wavePhase, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: false }));
    w.start();
    return () => w.stop();
  }, []);

  const pattern = (item.zenPattern ?? 0) % 3;
  const waveOp = wavePhase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.5, 0.3] });

  return (
    <View style={{ width: 76, height: 46, backgroundColor: '#f5f0dc', borderWidth: 1.5, borderColor: '#5a3825', borderRadius: 6, overflow: 'hidden', padding: 3 }}>
      {/* Sand lines */}
      {pattern === 0 && [8, 16, 24, 32].map(y => (
        <Animated.View key={y} style={{ position: 'absolute', left: 4, right: 4, top: y, height: 1, backgroundColor: '#c9b896', opacity: waveOp }} />
      ))}
      {pattern === 1 && [0, 1, 2].map(i => (
        <Animated.View key={i} style={{ position: 'absolute', left: 20 + i * 4, top: 10 + i * 4, width: 30 - i * 6, height: 22 - i * 4, borderRadius: (30 - i * 6) / 2, borderWidth: 1, borderColor: '#c9b896', opacity: waveOp }} />
      ))}
      {pattern === 2 && [6, 14, 22, 30, 38].map(y => (
        <Animated.View key={y} style={{ position: 'absolute', left: 4, right: 4, top: y, height: 1, backgroundColor: '#c9b896', opacity: waveOp, transform: [{ rotate: y % 2 === 0 ? '2deg' : '-2deg' }] }} />
      ))}
      {/* Stones */}
      <View style={{ position: 'absolute', top: 12, left: 14, width: 10, height: 8, borderRadius: 4, backgroundColor: '#6b7280' }} />
      <View style={{ position: 'absolute', top: 14, left: 22, width: 6, height: 5, borderRadius: 3, backgroundColor: '#9ca3af' }} />
      <View style={{ position: 'absolute', bottom: 10, right: 12, width: 8, height: 6, borderRadius: 3, backgroundColor: '#4b5563' }} />
      {/* Rake marks text */}
      <View style={{ position: 'absolute', bottom: 2, left: 4 }}>
        <Text style={{ fontSize: 4, color: '#a09070', fontFamily: 'monospace' }}>ZEN</Text>
      </View>
    </View>
  );
}

// ─── Focus Candle — Lit candle for deep work mode ────────────────────────────

export function FocusCandleItem({ item, theme }: ItemProps) {
  const flame = useRef(new Animated.Value(0)).current;
  const flicker = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!item.focusBurning) return;
    const f = animLoop(() => Animated.sequence([
      Animated.timing(flame, { toValue: 1, duration: 200 + Math.random() * 200, useNativeDriver: false }),
      Animated.timing(flame, { toValue: 0, duration: 150 + Math.random() * 150, useNativeDriver: false }),
    ]));
    const fl = animLoop(() => Animated.sequence([
      Animated.timing(flicker, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.timing(flicker, { toValue: 0.4, duration: 200, useNativeDriver: false }),
    ]));
    const g = animLoop(() => Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    f.start(); fl.start(); g.start();
    return () => { f.stop(); fl.stop(); g.stop(); };
  }, [item.focusBurning]);

  const flameH = flame.interpolate({ inputRange: [0, 1], outputRange: [8, 14] });
  const flickerOp = flicker.interpolate({ inputRange: [0.4, 1], outputRange: [0.7, 1] });
  const glowOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.35] });

  return (
    <View style={{ width: 26, height: 44, alignItems: 'center', justifyContent: 'flex-end' }}>
      {item.focusBurning && (
        <>
          <Animated.View style={{ position: 'absolute', top: 2, width: 24, height: 24, borderRadius: 12, backgroundColor: '#fbbf24', opacity: glowOp }} />
          <Animated.View style={{ position: 'absolute', top: 6, width: 6, height: flameH, backgroundColor: '#ff6600', borderRadius: 3, opacity: flickerOp }} />
          <Animated.View style={{ position: 'absolute', top: 8, width: 3, height: flameH, backgroundColor: '#ffcc00', borderRadius: 2 }} />
        </>
      )}
      {/* Wick */}
      <View style={{ width: 1.5, height: item.focusBurning ? 4 : 6, backgroundColor: '#333', marginBottom: 0, zIndex: 2 }} />
      {/* Candle body */}
      <View style={{ width: 16, height: 24, backgroundColor: '#f5f0dc', borderRadius: 2, borderWidth: 1, borderColor: '#ddd4b8' }}>
        {/* Wax drip */}
        <View style={{ position: 'absolute', top: -2, left: 2, width: 4, height: 6, backgroundColor: '#f5f0dc', borderRadius: 2 }} />
      </View>
      {/* Holder */}
      <View style={{ width: 22, height: 5, backgroundColor: '#b8860b', borderRadius: 2, borderWidth: 1, borderColor: '#8b6914' }} />
      {/* Label */}
      <Text style={{ fontSize: 4, color: item.focusBurning ? '#fbbf24' : '#666', fontFamily: 'monospace', marginTop: 1 }}>
        {item.focusBurning ? 'FOCUS' : 'LIGHT'}
      </Text>
    </View>
  );
}

// ─── Quote Board — Rotating inspirational quotes with typewriter feel ────────

export function QuoteBoardItem({ item, theme }: ItemProps) {
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const QUOTES = [
    '"Ship it." — Every builder',
    '"Done > Perfect."',
    '"The best time to start\nwas yesterday."',
    '"Focus on the process,\nnot the outcome."',
    '"Build in public.\nLearn in public."',
    '"Consistency beats\nintensity."',
    '"Your only competition\nis yesterday\'s you."',
    '"Small steps,\nbig destinations."',
    '"Start before\nyou\'re ready."',
    '"Execution eats\nstrategy for breakfast."',
  ];

  const quote = QUOTES[(item.quoteIndex ?? 0) % QUOTES.length];

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: false }).start();
  }, [item.quoteIndex]);

  return (
    <View style={{ width: 96, height: 46, backgroundColor: '#111118', borderWidth: 1.5, borderColor: theme.accentGlow + '40', borderRadius: 6, padding: 6, justifyContent: 'center' }}>
      {/* Accent bar */}
      <View style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, backgroundColor: theme.accentGlow, borderRadius: 1 }} />
      <Animated.View style={{ opacity: fadeAnim, paddingLeft: 6 }}>
        <Text style={{ color: '#ddd', fontSize: 6.5, fontFamily: 'monospace', lineHeight: 9 }}>{quote}</Text>
      </Animated.View>
      <View style={{ position: 'absolute', bottom: 2, right: 4 }}>
        <Text style={{ fontSize: 4, color: '#555', fontFamily: 'monospace' }}>tap → next</Text>
      </View>
    </View>
  );
}

// ─── Progress Bar — Team task completion with animated fill ──────────────────

export function ProgressBarItem({ item, theme }: ItemProps) {
  const fillAnim = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  const pct = item.progressValue ?? 0;

  useEffect(() => {
    Animated.timing(fillAnim, { toValue: pct, duration: 800, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
    if (pct > 0 && pct < 100) {
      const s = animLoop(() => Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1500, useNativeDriver: false }),
        Animated.timing(shimmer, { toValue: 0, duration: 1500, useNativeDriver: false }),
      ]));
      s.start();
      return () => s.stop();
    }
  }, [pct]);

  const fillWidth = fillAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%' as any, '100%' as any] });
  const shimmerOp = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] });
  const barColor = pct >= 100 ? '#22c55e' : pct >= 60 ? '#6366f1' : pct >= 30 ? '#f59e0b' : '#ef4444';

  return (
    <View style={{ width: 96, height: 36, backgroundColor: '#0a0a12', borderWidth: 1.5, borderColor: '#1a1a2e', borderRadius: 6, padding: 4, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ fontSize: 6, color: '#888', fontFamily: 'monospace', fontWeight: '800' }}>PROGRESS</Text>
        <Text style={{ fontSize: 7, color: barColor, fontFamily: 'monospace', fontWeight: '900' }}>{pct}%</Text>
      </View>
      {/* Track */}
      <View style={{ height: 10, backgroundColor: '#1a1a2e', borderRadius: 5, overflow: 'hidden' }}>
        <Animated.View style={{ height: '100%', width: fillWidth, backgroundColor: barColor, borderRadius: 5 }} />
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff', opacity: shimmerOp, borderRadius: 5 }} />
      </View>
      {pct >= 100 && <Text style={{ fontSize: 5, color: '#22c55e', fontFamily: 'monospace', textAlign: 'center', marginTop: 1 }}>COMPLETE!</Text>}
    </View>
  );
}

// ─── Hologram — Rotating wireframe shape with sci-fi glow ───────────────────

export function HologramItem({ item, theme }: ItemProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const scanline = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const s = animLoop(() => Animated.timing(spin, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false }));
    const p = animLoop(() => Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]));
    const sc = animLoop(() => { scanline.setValue(0); return Animated.timing(scanline, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: false }); });
    s.start(); p.start(); sc.start();
    return () => { s.stop(); p.stop(); sc.stop(); };
  }, []);

  const rot = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const glowOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
  const scanY = scanline.interpolate({ inputRange: [0, 1], outputRange: [0, 56] });
  const shape = (item.hologramShape ?? 0) % 3;

  return (
    <View style={{ width: 56, height: 64, alignItems: 'center' }}>
      {/* Base projector */}
      <View style={{ position: 'absolute', bottom: 0, width: 40, height: 8, backgroundColor: '#1e293b', borderRadius: 4, borderWidth: 1, borderColor: '#334155' }}>
        <View style={{ position: 'absolute', top: 2, left: '50%' as any, marginLeft: -3, width: 6, height: 3, borderRadius: 1.5, backgroundColor: '#00ffff40' }} />
      </View>
      {/* Projection cone */}
      <Animated.View style={{ position: 'absolute', bottom: 8, width: 30, height: 48, opacity: 0.06, backgroundColor: '#00ffff', borderTopLeftRadius: 8, borderTopRightRadius: 8 }} />
      {/* Hologram shape */}
      <View style={{ width: 40, height: 48, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Animated.View style={{ transform: [{ rotate: rot }], alignItems: 'center', justifyContent: 'center' }}>
          {shape === 0 && (
            /* Diamond */
            <Animated.View style={{ width: 24, height: 24, borderWidth: 1.5, borderColor: '#00ffff', transform: [{ rotate: '45deg' }], opacity: glowOp }} />
          )}
          {shape === 1 && (
            /* Triangle */
            <Animated.View style={{ width: 0, height: 0, borderLeftWidth: 14, borderRightWidth: 14, borderBottomWidth: 24, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#00ffff60', opacity: glowOp }} />
          )}
          {shape === 2 && (
            /* Circle */
            <Animated.View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: '#00ffff', opacity: glowOp }} />
          )}
        </Animated.View>
        {/* Scanline */}
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#00ffff30', top: scanY }} />
      </View>
      {/* Shape label */}
      <Text style={{ fontSize: 4, color: '#00ffff60', fontFamily: 'monospace', position: 'absolute', bottom: 10 }}>HOLO</Text>
    </View>
  );
}

// ─── Pixel Display — Animated pixel art scenes that cycle ────────────────────

export function PixelDisplayItem({ item, theme }: ItemProps) {
  const frameAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const f = animLoop(() => Animated.sequence([
      Animated.timing(frameAnim, { toValue: 1, duration: 1500, useNativeDriver: false }),
      Animated.timing(frameAnim, { toValue: 0, duration: 1500, useNativeDriver: false }),
    ]));
    f.start();
    return () => f.stop();
  }, []);

  const scene = (item.pixelScene ?? 0) % 4;
  const starOp = frameAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const waveY = frameAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 3] });

  const scenes = [
    // Scene 0: Night sky with twinkling stars
    <View key={0} style={{ width: '100%', height: '100%', backgroundColor: '#0a0a2e' }}>
      <Animated.View style={{ position: 'absolute', top: 6, left: 8, width: 2, height: 2, backgroundColor: '#fff', opacity: starOp }} />
      <Animated.View style={{ position: 'absolute', top: 10, left: 24, width: 2, height: 2, backgroundColor: '#fbbf24', opacity: starOp }} />
      <Animated.View style={{ position: 'absolute', top: 4, right: 14, width: 2, height: 2, backgroundColor: '#fff', opacity: starOp }} />
      <Animated.View style={{ position: 'absolute', top: 14, left: 40, width: 2, height: 2, backgroundColor: '#60a5fa', opacity: starOp }} />
      <View style={{ position: 'absolute', top: 4, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fbbf24' }} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10, backgroundColor: '#1a3d1a' }} />
      <View style={{ position: 'absolute', bottom: 10, left: 20, width: 4, height: 8, backgroundColor: '#166534' }} />
      <View style={{ position: 'absolute', bottom: 10, left: 17, width: 10, height: 6, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: '#15803d' }} />
    </View>,
    // Scene 1: Ocean sunset
    <View key={1} style={{ width: '100%', height: '100%', backgroundColor: '#ff6b3540' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 16, backgroundColor: '#f97316' }} />
      <View style={{ position: 'absolute', top: 8, left: 20, width: 14, height: 14, borderRadius: 7, backgroundColor: '#fbbf24' }} />
      <Animated.View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 14, backgroundColor: '#1e3a5f', transform: [{ translateY: waveY }] }} />
      <Animated.View style={{ position: 'absolute', bottom: 2, left: 0, right: 0, height: 10, backgroundColor: '#1e4d7a', transform: [{ translateY: waveY }] }} />
    </View>,
    // Scene 2: Mountain range
    <View key={2} style={{ width: '100%', height: '100%', backgroundColor: '#1a1a2e' }}>
      <View style={{ position: 'absolute', bottom: 0, left: 0, width: 0, height: 0, borderLeftWidth: 20, borderRightWidth: 20, borderBottomWidth: 22, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#334155' }} />
      <View style={{ position: 'absolute', bottom: 0, left: 16, width: 0, height: 0, borderLeftWidth: 16, borderRightWidth: 16, borderBottomWidth: 28, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#475569' }} />
      <View style={{ position: 'absolute', bottom: 0, right: 4, width: 0, height: 0, borderLeftWidth: 18, borderRightWidth: 18, borderBottomWidth: 18, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#334155' }} />
      <View style={{ position: 'absolute', bottom: 20, left: 20, width: 6, height: 4, backgroundColor: '#fff' }} />
      <Animated.View style={{ position: 'absolute', top: 5, left: 6, width: 2, height: 2, backgroundColor: '#fff', opacity: starOp }} />
      <Animated.View style={{ position: 'absolute', top: 8, right: 10, width: 2, height: 2, backgroundColor: '#fbbf24', opacity: starOp }} />
    </View>,
    // Scene 3: City at night
    <View key={3} style={{ width: '100%', height: '100%', backgroundColor: '#0a0a1a' }}>
      <View style={{ position: 'absolute', bottom: 0, left: 4, width: 10, height: 20, backgroundColor: '#1e293b' }} />
      <View style={{ position: 'absolute', bottom: 0, left: 16, width: 14, height: 28, backgroundColor: '#1e293b' }} />
      <View style={{ position: 'absolute', bottom: 0, left: 32, width: 8, height: 16, backgroundColor: '#1e293b' }} />
      <View style={{ position: 'absolute', bottom: 0, right: 4, width: 12, height: 22, backgroundColor: '#1e293b' }} />
      <Animated.View style={{ position: 'absolute', bottom: 8, left: 8, width: 2, height: 2, backgroundColor: '#fbbf24', opacity: starOp }} />
      <Animated.View style={{ position: 'absolute', bottom: 14, left: 20, width: 2, height: 2, backgroundColor: '#fbbf24', opacity: starOp }} />
      <Animated.View style={{ position: 'absolute', bottom: 20, left: 22, width: 2, height: 2, backgroundColor: '#60a5fa', opacity: starOp }} />
      <Animated.View style={{ position: 'absolute', bottom: 10, right: 8, width: 2, height: 2, backgroundColor: '#fbbf24', opacity: starOp }} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: '#334155' }} />
    </View>,
  ];

  return (
    <View style={{ width: 66, height: 46, backgroundColor: '#111', borderWidth: 2, borderColor: '#333', borderRadius: 4, overflow: 'hidden', padding: 2 }}>
      {scenes[scene]}
      {/* CRT scanlines overlay */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        {[0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40].map(y => (
          <View key={y} style={{ position: 'absolute', top: y, left: 0, right: 0, height: 1, backgroundColor: '#00000020' }} />
        ))}
      </View>
      <Text style={{ position: 'absolute', bottom: 1, right: 3, fontSize: 3.5, color: '#ffffff30', fontFamily: 'monospace' }}>
        {scene + 1}/4
      </Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INTEGRATION & CONNECTED ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Spotify Jukebox ──────────────────────────────────────────────────────────
export function SpotifyJukeboxItem({ item, theme }: ItemProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const barAnim = useRef([
    new Animated.Value(0), new Animated.Value(0.3),
    new Animated.Value(0.6), new Animated.Value(0.2), new Animated.Value(0.5),
  ]).current;

  useEffect(() => {
    if (!item.spotifyPlaying) return;
    const loops = barAnim.map((b, i) => {
      const l = animLoop(() => {
        b.setValue(0.2);
        return Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: 300 + i * 100, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(b, { toValue: 0.2, duration: 300 + i * 80, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]);
      });
      l.start();
      return l;
    });
    return () => loops.forEach(l => l.stop());
  }, [item.spotifyPlaying]);

  useEffect(() => {
    const l = animLoop(() => {
      pulse.setValue(0);
      return Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: false });
    });
    l.start();
    return () => l.stop();
  }, []);

  const connected = item.spotifyConnected;
  const trackName = item.spotifyTrackName || 'No Track';
  const artist = item.spotifyArtist || '';
  const playing = item.spotifyPlaying;
  const progress = item.spotifyProgress || 0;

  const glowOp = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.6, 0.3] });

  return (
    <View style={{ width: 66, height: 86, backgroundColor: '#191414', borderWidth: 2, borderColor: connected ? '#1DB954' : '#333', borderRadius: 10, alignItems: 'center', overflow: 'hidden' }}>
      {/* Spotify green glow */}
      <Animated.View style={{ position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 12, backgroundColor: '#1DB95420', opacity: connected ? glowOp : 0 }} />

      {/* Logo area */}
      <View style={{ width: '100%' as any, height: 18, backgroundColor: '#1DB954', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 7, fontWeight: '800', color: '#fff', fontFamily: 'monospace' }}>♫ SPOTIFY</Text>
      </View>

      {connected ? (
        <>
          {/* Album art placeholder */}
          <View style={{ width: 36, height: 36, backgroundColor: '#282828', borderRadius: 4, marginTop: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1DB95440' }}>
            <Text style={{ fontSize: 16 }}>{playing ? '🎵' : '⏸'}</Text>
          </View>

          {/* Track info */}
          <Text style={{ color: '#fff', fontSize: 5, fontFamily: 'monospace', marginTop: 2, textAlign: 'center', paddingHorizontal: 3 }} numberOfLines={1}>{trackName}</Text>
          <Text style={{ color: '#b3b3b3', fontSize: 4, fontFamily: 'monospace' }} numberOfLines={1}>{artist}</Text>

          {/* Progress bar */}
          <View style={{ width: 50, height: 3, backgroundColor: '#535353', borderRadius: 2, marginTop: 2 }}>
            <View style={{ width: `${progress}%` as any, height: '100%' as any, backgroundColor: '#1DB954', borderRadius: 2 }} />
          </View>

          {/* Equalizer bars */}
          <View style={{ flexDirection: 'row', gap: 1, marginTop: 2, height: 10, alignItems: 'flex-end' }}>
            {barAnim.map((b, i) => {
              const h = b.interpolate({ inputRange: [0, 1], outputRange: [2, 10] });
              return <Animated.View key={i} style={{ width: 3, backgroundColor: '#1DB954', borderRadius: 1, height: playing ? h : 2 }} />;
            })}
          </View>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
          <Text style={{ fontSize: 18 }}>🔗</Text>
          <Text style={{ color: '#1DB954', fontSize: 5, fontFamily: 'monospace', textAlign: 'center', marginTop: 2 }}>TAP TO{'\n'}CONNECT</Text>
        </View>
      )}
    </View>
  );
}

// ── Discord Hub ──────────────────────────────────────────────────────────────
export function DiscordHubItem({ item, theme }: ItemProps) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const l = animLoop(() => {
      pulseAnim.setValue(0);
      return Animated.timing(pulseAnim, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false });
    });
    l.start();
    return () => l.stop();
  }, []);

  const connected = item.discordConnected;
  const channel = item.discordChannel || 'general';
  const status = item.discordStatus || 'offline';
  const members = item.discordMemberCount || 0;

  const statusColors: Record<string, string> = { online: '#43b581', idle: '#faa61a', dnd: '#f04747', offline: '#747f8d' };
  const statusColor = statusColors[status] || statusColors.offline;

  const dotPulse = pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1, 0.6] });

  return (
    <View style={{ width: 76, height: 66, backgroundColor: '#36393f', borderWidth: 2, borderColor: connected ? '#5865F2' : '#40444b', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <View style={{ height: 16, backgroundColor: '#5865F2', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <Text style={{ fontSize: 7, fontWeight: '800', color: '#fff', fontFamily: 'monospace' }}>DISCORD</Text>
        <Animated.View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: statusColor, opacity: connected ? dotPulse : 0.4 }} />
      </View>

      {connected ? (
        <View style={{ flex: 1, padding: 4 }}>
          {/* Channel */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 3 }}>
            <Text style={{ color: '#72767d', fontSize: 6 }}>#</Text>
            <Text style={{ color: '#dcddde', fontSize: 5, fontFamily: 'monospace' }} numberOfLines={1}>{channel}</Text>
          </View>

          {/* Members */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 3 }}>
            <View style={{ flexDirection: 'row', gap: 1 }}>
              {[0, 1, 2].map(i => (
                <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ['#5865F2', '#57F287', '#FEE75C'][i], borderWidth: 1, borderColor: '#36393f', marginLeft: i > 0 ? -3 : 0 }} />
              ))}
            </View>
            <Text style={{ color: '#72767d', fontSize: 4.5, fontFamily: 'monospace' }}>{members} online</Text>
          </View>

          {/* Status indicator row */}
          <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: statusColor }} />
            <Text style={{ color: '#b9bbbe', fontSize: 4, fontFamily: 'monospace', textTransform: 'uppercase' }}>{status}</Text>
          </View>

          {/* Voice indicator */}
          <View style={{ position: 'absolute', bottom: 2, right: 3, flexDirection: 'row', alignItems: 'center', gap: 1 }}>
            <Text style={{ fontSize: 6 }}>🔊</Text>
            <Text style={{ color: '#43b581', fontSize: 3.5, fontFamily: 'monospace' }}>VOICE</Text>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>💬</Text>
          <Text style={{ color: '#5865F2', fontSize: 5, fontFamily: 'monospace', marginTop: 2 }}>CONNECT</Text>
        </View>
      )}
    </View>
  );
}

// ── Video Call ────────────────────────────────────────────────────────────────
export function VideoCallItem({ item, theme }: ItemProps) {
  const ringPulse = useRef(new Animated.Value(0)).current;
  const dotBlink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!item.videoCallActive) return;
    const r = animLoop(() => {
      ringPulse.setValue(0);
      return Animated.sequence([
        Animated.timing(ringPulse, { toValue: 1, duration: 800, useNativeDriver: false }),
        Animated.timing(ringPulse, { toValue: 0, duration: 800, useNativeDriver: false }),
      ]);
    });
    r.start();
    const d = animLoop(() => {
      dotBlink.setValue(1);
      return Animated.sequence([
        Animated.timing(dotBlink, { toValue: 0.3, duration: 600, useNativeDriver: false }),
        Animated.timing(dotBlink, { toValue: 1, duration: 600, useNativeDriver: false }),
      ]);
    });
    d.start();
    return () => { r.stop(); d.stop(); };
  }, [item.videoCallActive]);

  const active = item.videoCallActive;
  const provider = item.videoCallProvider || 'meet';
  const participants = item.videoCallParticipants || 0;

  const providerInfo: Record<string, { color: string; label: string; icon: string }> = {
    zoom: { color: '#2D8CFF', label: 'ZOOM', icon: '🔵' },
    meet: { color: '#00897B', label: 'MEET', icon: '🟢' },
    teams: { color: '#6264A7', label: 'TEAMS', icon: '🟣' },
  };
  const prov = providerInfo[provider] || providerInfo.meet;

  const ringScale = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const ringOp = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={{ width: 86, height: 66, backgroundColor: '#1a1a2e', borderWidth: 2, borderColor: active ? prov.color : '#333', borderRadius: 8, overflow: 'hidden', alignItems: 'center' }}>
      {/* Provider header */}
      <View style={{ width: '100%' as any, height: 14, backgroundColor: prov.color, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 6, fontWeight: '800', color: '#fff', fontFamily: 'monospace' }}>{prov.icon} {prov.label}</Text>
      </View>

      {active ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          {/* Camera grid */}
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {Array.from({ length: Math.min(participants, 4) }).map((_, i) => (
              <View key={i} style={{ width: 16, height: 12, backgroundColor: '#333', borderRadius: 2, borderWidth: 1, borderColor: prov.color + '60', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 6 }}>👤</Text>
              </View>
            ))}
          </View>

          {/* Live indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Animated.View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#ef4444', opacity: dotBlink }} />
            <Text style={{ color: '#ef4444', fontSize: 4.5, fontWeight: '700', fontFamily: 'monospace' }}>LIVE</Text>
            <Text style={{ color: '#888', fontSize: 4, fontFamily: 'monospace' }}>{participants}p</Text>
          </View>

          {/* Control bar */}
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 1 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 5 }}>🎤</Text>
            </View>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 5 }}>📹</Text>
            </View>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 5 }}>📞</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {/* Pulsing ring */}
          <Animated.View style={{ position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: prov.color, transform: [{ scale: ringScale }], opacity: ringOp }} />
          <Text style={{ fontSize: 20 }}>📹</Text>
          <Text style={{ color: prov.color, fontSize: 5, fontFamily: 'monospace', marginTop: 2 }}>START CALL</Text>
        </View>
      )}
    </View>
  );
}

// ── Message Board ────────────────────────────────────────────────────────────
export function MessageBoardItem({ item, theme }: ItemProps) {
  const notifBounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!item.messageCount) return;
    const l = animLoop(() => {
      notifBounce.setValue(0);
      return Animated.sequence([
        Animated.timing(notifBounce, { toValue: -3, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: false }),
        Animated.timing(notifBounce, { toValue: 0, duration: 300, easing: Easing.in(Easing.ease), useNativeDriver: false }),
        Animated.timing(notifBounce, { toValue: 0, duration: 2400, useNativeDriver: false }),
      ]);
    });
    l.start();
    return () => l.stop();
  }, [item.messageCount]);

  const source = item.messageSource || 'sms';
  const preview = item.messagePreview || 'No messages yet';
  const count = item.messageCount || 0;

  const sourceInfo: Record<string, { color: string; icon: string; label: string }> = {
    imessage: { color: '#34C759', icon: '💬', label: 'iMessage' },
    sms: { color: '#34C759', icon: '💬', label: 'SMS' },
    whatsapp: { color: '#25D366', icon: '📲', label: 'WhatsApp' },
  };
  const src = sourceInfo[source] || sourceInfo.sms;

  return (
    <View style={{ width: 56, height: 86, backgroundColor: '#1c1c1e', borderWidth: 2, borderColor: src.color + '80', borderRadius: 14, overflow: 'hidden', alignItems: 'center' }}>
      {/* Phone notch */}
      <View style={{ width: 20, height: 4, backgroundColor: '#000', borderBottomLeftRadius: 4, borderBottomRightRadius: 4, marginTop: 0 }} />

      {/* Status bar */}
      <View style={{ width: '100%' as any, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 2 }}>
        <Text style={{ color: '#fff', fontSize: 3.5, fontFamily: 'monospace' }}>9:41</Text>
        <View style={{ flexDirection: 'row', gap: 1 }}>
          <Text style={{ color: '#fff', fontSize: 3 }}>📶</Text>
          <Text style={{ color: '#fff', fontSize: 3 }}>🔋</Text>
        </View>
      </View>

      {/* Source label */}
      <Text style={{ color: src.color, fontSize: 5, fontWeight: '700', fontFamily: 'monospace', marginTop: 3 }}>{src.label}</Text>

      {/* Message bubbles */}
      <View style={{ flex: 1, width: '100%' as any, padding: 3, gap: 2 }}>
        <View style={{ backgroundColor: '#2c2c2e', borderRadius: 6, padding: 3, maxWidth: '85%' as any, alignSelf: 'flex-start' }}>
          <Text style={{ color: '#ddd', fontSize: 3.5, fontFamily: 'monospace' }} numberOfLines={2}>{preview}</Text>
        </View>
        <View style={{ backgroundColor: src.color, borderRadius: 6, padding: 3, maxWidth: '75%' as any, alignSelf: 'flex-end' }}>
          <Text style={{ color: '#fff', fontSize: 3.5, fontFamily: 'monospace' }}>Got it 👍</Text>
        </View>
      </View>

      {/* Notification badge */}
      {count > 0 && (
        <Animated.View style={{
          position: 'absolute', top: 6, right: 3,
          minWidth: 10, height: 10, borderRadius: 5,
          backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 2, transform: [{ translateY: notifBounce }],
        }}>
          <Text style={{ color: '#fff', fontSize: 5, fontWeight: '700' }}>{count > 9 ? '9+' : count}</Text>
        </Animated.View>
      )}

      {/* Home indicator */}
      <View style={{ width: 20, height: 2, backgroundColor: '#666', borderRadius: 1, marginBottom: 2, marginTop: 1 }} />
    </View>
  );
}

// ── Smart TV ─────────────────────────────────────────────────────────────────
export function SmartTVItem({ item, theme }: ItemProps) {
  const scanline = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!item.tvPoweredOn) return;
    const sl = animLoop(() => {
      scanline.setValue(0);
      return Animated.timing(scanline, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false });
    });
    sl.start();
    const gl = animLoop(() => {
      glow.setValue(0);
      return Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2000, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 2000, useNativeDriver: false }),
      ]);
    });
    gl.start();
    return () => { sl.stop(); gl.stop(); };
  }, [item.tvPoweredOn]);

  const powered = item.tvPoweredOn;
  const app = item.tvApp || 'youtube';
  const w = item.tvWidth || 120;
  const h = item.tvHeight || 80;

  const appInfo: Record<string, { color: string; bg: string; label: string; icon: string }> = {
    youtube:  { color: '#FF0000', bg: '#282828', label: 'YouTube',   icon: '▶' },
    netflix:  { color: '#E50914', bg: '#141414', label: 'Netflix',   icon: 'N' },
    hulu:     { color: '#1CE783', bg: '#0B0C0F', label: 'Hulu',      icon: 'H' },
    disney:   { color: '#0063e5', bg: '#0a1929', label: 'Disney+',   icon: 'D+' },
    twitch:   { color: '#9146FF', bg: '#18181b', label: 'Twitch',    icon: '◉' },
  };
  const a = appInfo[app] || appInfo.youtube;

  const scanY = scanline.interpolate({ inputRange: [0, 1], outputRange: [0, h - 10] });
  const glowOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.3] });

  const embedUrl = powered ? getTvEmbedUrl(app, item.tvContentUrl) : null;
  const isWeb = Platform.OS === 'web';

  return (
    <View style={{ width: w, height: h, alignItems: 'center' }}>
      {/* TV body */}
      <View style={{ width: w, height: h - 10, backgroundColor: powered ? a.bg : '#0a0a0a', borderWidth: 2, borderColor: powered ? a.color + '80' : '#222', borderRadius: 4, overflow: 'hidden' }}>
        {powered ? (
          <>
            {/* Embedded video (web only) — fills the entire TV screen */}
            {isWeb && embedUrl ? (
              <>
                {React.createElement('iframe', {
                  src: embedUrl,
                  style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    zIndex: 2,
                  },
                  allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture',
                  allowFullScreen: true,
                  frameBorder: '0',
                })}
                {/* Power LED over iframe */}
                <View style={{ position: 'absolute', bottom: 2, right: 4, width: 3, height: 3, borderRadius: 2, backgroundColor: '#22c55e', zIndex: 3 }} />
              </>
            ) : (
              <>
                {/* Ambient glow */}
                <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: a.color, opacity: glowOp }} />

                {/* App content area — branded placeholder (no embeddable URL or non-embeddable app) */}
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: a.color, fontSize: Math.min(w / 5, 22), fontWeight: '900', fontFamily: 'monospace' }}>{a.icon}</Text>
                  <Text style={{ color: '#fff', fontSize: Math.min(w / 12, 8), fontWeight: '700', fontFamily: 'monospace', marginTop: 2 }}>{a.label}</Text>

                  {/* Hint for non-embeddable apps */}
                  {item.tvContentUrl && !embedUrl ? (
                    <Text style={{ color: a.color + 'aa', fontSize: Math.min(w / 16, 6), fontFamily: 'monospace', marginTop: 4, textAlign: 'center' }}>TAP TO OPEN</Text>
                  ) : !item.tvContentUrl ? (
                    <View style={{ marginTop: 4, gap: 2, alignItems: 'center' }}>
                      <View style={{ width: w * 0.6, height: 2, backgroundColor: '#ffffff15', borderRadius: 1 }} />
                      <View style={{ width: w * 0.4, height: 2, backgroundColor: '#ffffff10', borderRadius: 1 }} />
                    </View>
                  ) : null}
                </View>

                {/* Scanline */}
                <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#ffffff08', transform: [{ translateY: scanY }] }} />

                {/* Power LED */}
                <View style={{ position: 'absolute', bottom: 2, right: 4, width: 3, height: 3, borderRadius: 2, backgroundColor: '#22c55e' }} />
              </>
            )}
          </>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: Math.min(w / 4, 24) }}>📺</Text>
            <Text style={{ color: '#444', fontSize: Math.min(w / 14, 7), fontFamily: 'monospace', marginTop: 2 }}>TAP TO POWER ON</Text>
          </View>
        )}
      </View>

      {/* TV stand */}
      <View style={{ width: w * 0.08, height: 6, backgroundColor: '#333' }} />
      <View style={{ width: w * 0.35, height: 3, backgroundColor: '#2a2a2a', borderRadius: 1.5 }} />
    </View>
  );
}

// ── Weather Station ──────────────────────────────────────────────────────────
export function WeatherStationItem({ item, theme }: ItemProps) {
  const cloudDrift = useRef(new Animated.Value(0)).current;
  const rainDrop = useRef(new Animated.Value(0)).current;
  const snowFlake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const c = animLoop(() => {
      cloudDrift.setValue(-4);
      return Animated.timing(cloudDrift, { toValue: 4, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: false });
    });
    c.start();
    const r = animLoop(() => {
      rainDrop.setValue(0);
      return Animated.timing(rainDrop, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: false });
    });
    r.start();
    const s = animLoop(() => {
      snowFlake.setValue(0);
      return Animated.timing(snowFlake, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false });
    });
    s.start();
    return () => { c.stop(); r.stop(); s.stop(); };
  }, []);

  const city = item.weatherCity || 'New York';
  const temp = item.weatherTemp ?? 72;
  const condition = item.weatherCondition || 'sunny';

  const conditionInfo: Record<string, { bg: string; icon: string; accent: string }> = {
    sunny:  { bg: '#87CEEB', icon: '☀️', accent: '#FFD700' },
    cloudy: { bg: '#708090', icon: '☁️', accent: '#B0C4DE' },
    rainy:  { bg: '#4a5568', icon: '🌧️', accent: '#63B3ED' },
    snowy:  { bg: '#B0C4DE', icon: '❄️', accent: '#E2E8F0' },
  };
  const cond = conditionInfo[condition] || conditionInfo.sunny;

  const rainY = rainDrop.interpolate({ inputRange: [0, 1], outputRange: [10, 38] });
  const rainOp = rainDrop.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.8, 0.8, 0] });
  const snowY = snowFlake.interpolate({ inputRange: [0, 1], outputRange: [8, 38] });
  const snowX = snowFlake.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-3, 3, -3] });

  return (
    <View style={{ width: 56, height: 46, backgroundColor: '#1a1a2e', borderWidth: 2, borderColor: cond.accent + '60', borderRadius: 8, overflow: 'hidden' }}>
      {/* Sky gradient */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 20, backgroundColor: cond.bg + '40' }} />

      {/* Weather icon with cloud drift */}
      <View style={{ alignItems: 'center', marginTop: 3 }}>
        <Animated.Text style={{ fontSize: 14, transform: [{ translateX: cloudDrift }] }}>{cond.icon}</Animated.Text>
      </View>

      {/* Rain drops */}
      {condition === 'rainy' && [0, 1, 2].map(i => (
        <Animated.View key={i} style={{
          position: 'absolute', left: 12 + i * 14, width: 1, height: 4,
          backgroundColor: '#63B3ED', borderRadius: 1,
          transform: [{ translateY: rainY }], opacity: rainOp,
        }} />
      ))}

      {/* Snow flakes */}
      {condition === 'snowy' && [0, 1, 2].map(i => (
        <Animated.Text key={i} style={{
          position: 'absolute', left: 10 + i * 16, fontSize: 4, color: '#fff',
          transform: [{ translateY: snowY }, { translateX: snowX }],
        }}>●</Animated.Text>
      ))}

      {/* Temp & city */}
      <View style={{ position: 'absolute', bottom: 3, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', fontFamily: 'monospace' }}>{temp}°</Text>
        <Text style={{ color: '#aaa', fontSize: 4, fontFamily: 'monospace' }} numberOfLines={1}>{city}</Text>
      </View>
    </View>
  );
}

// ── Twitch Stream ────────────────────────────────────────────────────────────
export function TwitchStreamItem({ item, theme }: ItemProps) {
  const chatScroll = useRef(new Animated.Value(0)).current;
  const liveGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const c = animLoop(() => {
      chatScroll.setValue(0);
      return Animated.timing(chatScroll, { toValue: -30, duration: 8000, easing: Easing.linear, useNativeDriver: false });
    });
    c.start();
    const g = animLoop(() => {
      liveGlow.setValue(0);
      return Animated.sequence([
        Animated.timing(liveGlow, { toValue: 1, duration: 800, useNativeDriver: false }),
        Animated.timing(liveGlow, { toValue: 0.3, duration: 800, useNativeDriver: false }),
      ]);
    });
    g.start();
    return () => { c.stop(); g.stop(); };
  }, []);

  const channel = item.twitchChannel || 'stream';
  const live = item.twitchLive;
  const viewers = item.twitchViewers || 0;
  const isWeb = Platform.OS === 'web';
  const embedSrc = live && channel ? twitchEmbedUrl(channel) : null;

  return (
    <View style={{ width: 86, height: 56, backgroundColor: '#18181b', borderWidth: 2, borderColor: live ? '#9146FF' : '#333', borderRadius: 6, overflow: 'hidden', flexDirection: 'row' }}>
      {/* Video area */}
      <View style={{ flex: 1, backgroundColor: '#0e0e10' }}>
        {live ? (
          <>
            {/* Embedded Twitch player (web) or placeholder (native) */}
            {isWeb && embedSrc ? (
              React.createElement('iframe', {
                src: embedSrc,
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  zIndex: 1,
                },
                allow: 'autoplay; encrypted-media; fullscreen',
                allowFullScreen: true,
                frameBorder: '0',
              })
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14 }}>🎮</Text>
              </View>
            )}

            {/* LIVE badge — overlays iframe */}
            <Animated.View style={{
              position: 'absolute', top: 3, left: 3, backgroundColor: '#ef4444',
              borderRadius: 2, paddingHorizontal: 3, paddingVertical: 1, opacity: liveGlow, zIndex: 2,
            }}>
              <Text style={{ color: '#fff', fontSize: 4, fontWeight: '900', fontFamily: 'monospace' }}>LIVE</Text>
            </Animated.View>

            {/* Viewer count */}
            <View style={{ position: 'absolute', bottom: 2, left: 3, flexDirection: 'row', alignItems: 'center', gap: 1, zIndex: 2 }}>
              <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: '#ef4444' }} />
              <Text style={{ color: '#ddd', fontSize: 3.5, fontFamily: 'monospace' }}>{viewers.toLocaleString()}</Text>
            </View>

            {/* Channel name */}
            <View style={{ position: 'absolute', bottom: 2, right: 3, zIndex: 2 }}>
              <Text style={{ color: '#9146FF', fontSize: 3.5, fontWeight: '700', fontFamily: 'monospace' }} numberOfLines={1}>{channel}</Text>
            </View>
          </>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 12 }}>🟣</Text>
            <Text style={{ color: '#9146FF', fontSize: 5, fontFamily: 'monospace', marginTop: 2 }}>OFFLINE</Text>
          </View>
        )}
      </View>

      {/* Chat sidebar — only show when no embedded player (avoids covering stream) */}
      {live && !(isWeb && embedSrc) && (
        <View style={{ width: 22, backgroundColor: '#1f1f23', borderLeftWidth: 1, borderLeftColor: '#333', overflow: 'hidden' }}>
          <Animated.View style={{ transform: [{ translateY: chatScroll }] }}>
            {['Pog', 'GG', 'LFG!', 'lol', '🔥', 'W', 'hype', 'ez'].map((msg, i) => (
              <Text key={i} style={{ color: ['#9146FF', '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3'][i % 5], fontSize: 3, fontFamily: 'monospace', padding: 1 }}>{msg}</Text>
            ))}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

// ── Pomodoro Room ────────────────────────────────────────────────────────────
export function PomodoroRoomItem({ item, theme }: ItemProps) {
  const tickAnim = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = animLoop(() => {
      tickAnim.setValue(0);
      return Animated.timing(tickAnim, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: false });
    });
    t.start();
    const b = animLoop(() => {
      breathe.setValue(0);
      return Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(breathe, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]);
    });
    b.start();
    return () => { t.stop(); b.stop(); };
  }, []);

  const minutes = item.pomodoroMinutes ?? 25;
  const isBreak = item.pomodoroBreak;
  const sessions = item.pomodoroSessions || 0;

  const color = isBreak ? '#4ECDC4' : '#FF6B6B';
  const secondHand = tickAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });

  return (
    <Animated.View style={{ width: 66, height: 56, backgroundColor: '#1a1a2e', borderWidth: 2, borderColor: color + '80', borderRadius: 10, overflow: 'hidden', alignItems: 'center', transform: [{ scale: breatheScale }] }}>
      {/* Header */}
      <View style={{ width: '100%' as any, height: 12, backgroundColor: color + '30', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 }}>
        <Text style={{ fontSize: 6 }}>🍅</Text>
        <Text style={{ color: color, fontSize: 5, fontWeight: '800', fontFamily: 'monospace' }}>{isBreak ? 'BREAK' : 'FOCUS'}</Text>
      </View>

      {/* Timer dial */}
      <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color, marginTop: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d0d1a' }}>
        <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900', fontFamily: 'monospace' }}>{minutes}</Text>
        <Text style={{ color: color, fontSize: 3.5, fontFamily: 'monospace' }}>min</Text>

        {/* Tick mark */}
        <Animated.View style={{
          position: 'absolute', top: 1, width: 1, height: 5,
          backgroundColor: color, borderRadius: 1,
          transform: [{ rotate: secondHand }], transformOrigin: 'bottom center' as any,
        }} />
      </View>

      {/* Session counter */}
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 2 }}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={{
            width: 5, height: 5, borderRadius: 3,
            backgroundColor: i < sessions % 4 ? color : '#333',
            borderWidth: 0.5, borderColor: color + '40',
          }} />
        ))}
      </View>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NEW CONNECTED — Crypto Ticker, GitHub, Calendar, World Clock, Visualizer, Figma
// ═══════════════════════════════════════════════════════════════════════════════

export function CryptoTickerItem({ item, theme }: ItemProps) {
  const scroll = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const s = animLoop(() => { scroll.setValue(0); return Animated.timing(scroll, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: false }); });
    s.start();
    const p = animLoop(() => { pulse.setValue(0.6); return Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 2000, useNativeDriver: false }), Animated.timing(pulse, { toValue: 0.6, duration: 2000, useNativeDriver: false })]); });
    p.start();
    return () => { s.stop(); p.stop(); };
  }, []);
  const coins = (item.cryptoTickerCoins || 'SOL,ETH,BTC').split(',');
  const prices = (item.cryptoTickerPrices || '148.52,3412.80,67250.00').split(',');
  const changes = (item.cryptoTickerChanges || '+2.5,-1.2,+0.8').split(',');
  const info: Record<string, { sym: string; color: string }> = { SOL: { sym: '◎', color: '#14F195' }, ETH: { sym: 'Ξ', color: '#627EEA' }, BTC: { sym: '₿', color: '#F7931A' }, USDC: { sym: '$', color: '#2775CA' }, MATIC: { sym: '⬡', color: '#8247E5' } };
  const tickX = scroll.interpolate({ inputRange: [0, 1], outputRange: [0, -60] });
  return (
    <View style={{ width: 96, height: 46, backgroundColor: '#0a0a14', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 6, overflow: 'hidden' }}>
      <View style={{ backgroundColor: '#111', paddingHorizontal: 4, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: '#888', fontSize: 4, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>CRYPTO</Text>
        <Animated.View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#22c55e', opacity: pulse }} />
      </View>
      <Animated.View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingTop: 3, transform: [{ translateX: tickX }] }}>
        {coins.map((coin, i) => {
          const c = info[coin.trim()] || { sym: '?', color: '#888' };
          const change = changes[i] || '+0.0';
          const up = change.startsWith('+');
          return (
            <View key={i} style={{ minWidth: 28, alignItems: 'center' }}>
              <Text style={{ color: c.color, fontSize: 7, fontWeight: '900', fontFamily: 'monospace' }}>{c.sym}</Text>
              <Text style={{ color: '#ddd', fontSize: 4.5, fontWeight: '700', fontFamily: 'monospace', marginTop: 1 }}>${prices[i]?.trim() || '0'}</Text>
              <Text style={{ color: up ? '#22c55e' : '#ef4444', fontSize: 3.5, fontWeight: '800', fontFamily: 'monospace' }}>{up ? '▲' : '▼'} {change.trim()}%</Text>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

export function GitHubFeedItem({ item, theme }: ItemProps) {
  const dot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const d = animLoop(() => { dot.setValue(0); return Animated.sequence([Animated.timing(dot, { toValue: 1, duration: 1500, useNativeDriver: false }), Animated.timing(dot, { toValue: 0, duration: 1500, useNativeDriver: false })]); });
    d.start();
    return () => d.stop();
  }, []);
  const repo = item.githubRepo || 'user/repo';
  const commits = item.githubCommits || 0;
  const prs = item.githubPRs || 0;
  const activity = item.githubActivity || 'No activity yet';
  const dotOp = dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  return (
    <View style={{ width: 86, height: 66, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, overflow: 'hidden' }}>
      <View style={{ backgroundColor: '#161b22', paddingHorizontal: 4, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Text style={{ fontSize: 7 }}>🐙</Text>
        <Text style={{ color: '#c9d1d9', fontSize: 4.5, fontWeight: '700', fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>{repo}</Text>
      </View>
      <View style={{ paddingHorizontal: 4, paddingTop: 3, gap: 2 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
            <Animated.View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#22c55e', opacity: dotOp }} />
            <Text style={{ color: '#8b949e', fontSize: 4, fontFamily: 'monospace' }}>{commits} commits</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#3b82f6' }} />
            <Text style={{ color: '#8b949e', fontSize: 4, fontFamily: 'monospace' }}>{prs} PRs</Text>
          </View>
        </View>
        <Text style={{ color: '#58a6ff', fontSize: 3.5, fontFamily: 'monospace' }} numberOfLines={2}>{activity}</Text>
        {/* Commit graph mini */}
        <View style={{ flexDirection: 'row', gap: 1, marginTop: 2 }}>
          {[3,1,4,2,5,3,2,4,1,5,3,2].map((v, i) => (
            <View key={i} style={{ width: 4, height: v * 2, backgroundColor: `rgba(34,197,94,${v / 5})`, borderRadius: 0.5 }} />
          ))}
        </View>
      </View>
    </View>
  );
}

export function CalendarWidgetItem({ item, theme }: ItemProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const p = animLoop(() => { pulse.setValue(0); return Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 2000, useNativeDriver: false }), Animated.timing(pulse, { toValue: 0, duration: 2000, useNativeDriver: false })]); });
    p.start();
    return () => p.stop();
  }, []);
  const event = item.calendarEvent || 'No upcoming events';
  const time = item.calendarTime || '';
  const provider = item.calendarProvider || 'google';
  const count = item.calendarEvents || 0;
  const provColor = provider === 'google' ? '#4285F4' : '#0078D4';
  const pulseOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const today = new Date();
  const dayNum = today.getDate();
  const dayName = ['SUN','MON','TUE','WED','THU','FRI','SAT'][today.getDay()];
  return (
    <View style={{ width: 76, height: 66, backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 8, overflow: 'hidden' }}>
      <View style={{ backgroundColor: provColor, paddingHorizontal: 4, paddingVertical: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 4.5, fontWeight: '800', fontFamily: 'monospace' }}>{dayName}</Text>
        <Text style={{ color: '#fff', fontSize: 7, fontWeight: '900', fontFamily: 'monospace' }}>{dayNum}</Text>
      </View>
      <View style={{ paddingHorizontal: 4, paddingTop: 3, flex: 1 }}>
        {time ? (
          <Animated.View style={{ opacity: pulseOp, flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 }}>
            <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: provColor }} />
            <Text style={{ color: provColor, fontSize: 4, fontWeight: '800', fontFamily: 'monospace' }}>{time}</Text>
          </Animated.View>
        ) : null}
        <Text style={{ color: '#ccc', fontSize: 4, fontFamily: 'monospace' }} numberOfLines={2}>{event}</Text>
        {count > 1 && <Text style={{ color: '#666', fontSize: 3.5, fontFamily: 'monospace', marginTop: 2 }}>+{count - 1} more today</Text>}
      </View>
    </View>
  );
}

export function WorldClockItem({ item, theme }: ItemProps) {
  const tick = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = animLoop(() => { tick.setValue(0); return Animated.timing(tick, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: false }); });
    t.start();
    return () => t.stop();
  }, []);
  const labels = (item.worldClockLabels || 'NYC,LDN,TYO').split(',');
  const zones = (item.worldClockZones || '-5,0,+9').split(',');
  const now = new Date();
  const dotOp = tick.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.2, 1] });
  return (
    <View style={{ width: 96, height: 46, backgroundColor: '#0a0a14', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 6, overflow: 'hidden' }}>
      <View style={{ backgroundColor: '#111', paddingHorizontal: 4, paddingVertical: 2 }}>
        <Text style={{ color: '#666', fontSize: 4, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>🌍 WORLD CLOCK</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 3, flex: 1 }}>
        {labels.map((label, i) => {
          const offset = parseInt(zones[i]?.trim() || '0');
          const utcH = now.getUTCHours();
          const h = ((utcH + offset) % 24 + 24) % 24;
          const m = now.getMinutes();
          const isDay = h >= 6 && h < 20;
          return (
            <View key={i} style={{ alignItems: 'center' }}>
              <Text style={{ color: isDay ? '#f59e0b' : '#6366f1', fontSize: 4.5, fontWeight: '900', fontFamily: 'monospace' }}>{label.trim()}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 7, fontWeight: '800', fontFamily: 'monospace' }}>{String(h).padStart(2, '0')}</Text>
                <Animated.Text style={{ color: '#fff', fontSize: 7, fontWeight: '800', fontFamily: 'monospace', opacity: dotOp }}>:</Animated.Text>
                <Text style={{ color: '#fff', fontSize: 7, fontWeight: '800', fontFamily: 'monospace' }}>{String(m).padStart(2, '0')}</Text>
              </View>
              <Text style={{ fontSize: 4 }}>{isDay ? '☀️' : '🌙'}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function MusicVisualizerItem({ item, theme }: ItemProps) {
  const bars = Array.from({ length: 12 }, () => useRef(new Animated.Value(0)).current);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anims = bars.map((bar, i) => {
      const a = animLoop(() => {
        bar.setValue(Math.random());
        return Animated.timing(bar, { toValue: Math.random(), duration: 200 + Math.random() * 400, easing: Easing.inOut(Easing.ease), useNativeDriver: false });
      });
      a.start();
      return a;
    });
    const g = animLoop(() => { glow.setValue(0); return Animated.sequence([Animated.timing(glow, { toValue: 1, duration: 3000, useNativeDriver: false }), Animated.timing(glow, { toValue: 0, duration: 3000, useNativeDriver: false })]); });
    g.start();
    return () => { anims.forEach(a => a.stop()); g.stop(); };
  }, []);
  const active = item.musicVisualizerActive !== false;
  const style = item.musicVisualizerStyle || 0;
  const glowOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.3] });
  const colors = ['#22c55e', '#3b82f6', '#8b5cf6'];
  const baseColor = colors[style % 3];
  return (
    <View style={{ width: 86, height: 56, backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: baseColor + '40', borderRadius: 8, overflow: 'hidden' }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: baseColor, opacity: glowOp }} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, paddingBottom: 6, paddingHorizontal: 6 }}>
        {bars.map((bar, i) => {
          const h = active ? bar.interpolate({ inputRange: [0, 1], outputRange: [4, 36] }) : 4;
          const op = active ? 0.9 : 0.2;
          return <Animated.View key={i} style={{ width: 4, height: h, backgroundColor: baseColor, borderRadius: 1, opacity: op }} />;
        })}
      </View>
      <View style={{ position: 'absolute', bottom: 2, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: baseColor, fontSize: 3.5, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.5 }}>{active ? ['BARS', 'WAVE', 'PULSE'][style % 3] : 'PAUSED'}</Text>
      </View>
    </View>
  );
}

export function FigmaBoardItem({ item, theme }: ItemProps) {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const s = animLoop(() => { shimmer.setValue(0); return Animated.timing(shimmer, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false }); });
    s.start();
    return () => s.stop();
  }, []);
  const connected = item.figmaBoardConnected;
  const preview = item.figmaBoardPreview || 'Dashboard v2';
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-40, 100] });
  return (
    <View style={{ width: 96, height: 76, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: connected ? '#a259ff' : '#333', borderRadius: 8, overflow: 'hidden' }}>
      <View style={{ backgroundColor: '#2c2c2c', paddingHorizontal: 4, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Text style={{ fontSize: 6 }}>🎨</Text>
        <Text style={{ color: connected ? '#a259ff' : '#666', fontSize: 4.5, fontWeight: '800', fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>Figma</Text>
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: connected ? '#22c55e' : '#555' }} />
      </View>
      {connected ? (
        <View style={{ flex: 1, padding: 4 }}>
          {/* Fake artboard preview */}
          <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <View style={{ position: 'absolute', top: 4, left: 4, right: 4, height: 8, backgroundColor: '#a259ff20', borderRadius: 2 }} />
            <View style={{ position: 'absolute', top: 16, left: 4, width: '40%' as any, height: 20, backgroundColor: '#a259ff10', borderRadius: 2 }} />
            <View style={{ position: 'absolute', top: 16, right: 4, width: '40%' as any, height: 20, backgroundColor: '#e2e2e2', borderRadius: 2 }} />
            <View style={{ position: 'absolute', bottom: 4, left: 4, right: 4, height: 6, backgroundColor: '#f0f0f0', borderRadius: 2 }} />
            <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: 20, backgroundColor: '#ffffff40', transform: [{ translateX: shimmerX }] }} />
          </View>
          <Text style={{ color: '#999', fontSize: 3.5, fontWeight: '700', fontFamily: 'monospace', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>{preview}</Text>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>🎨</Text>
          <Text style={{ color: '#555', fontSize: 4, fontFamily: 'monospace', marginTop: 2 }}>TAP TO CONNECT</Text>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GAMES — Poker, Chess, Coin Flip, Connect Four, Trivia, Roulette
// ═══════════════════════════════════════════════════════════════════════════════

// ── Poker Table (Enhanced) ──────────────────────────────────────────────────
export function PokerTableItem({ item, theme }: ItemProps) {
  const chipGlow = useRef(new Animated.Value(0)).current;
  const potPulse = useRef(new Animated.Value(0)).current;
  const bsGlow = useRef(new Animated.Value(0)).current;
  const dealerSpin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const cg = animLoop(() => {
      chipGlow.setValue(0);
      return Animated.sequence([
        Animated.timing(chipGlow, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(chipGlow, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]);
    });
    cg.start();
    const pp = animLoop(() => {
      potPulse.setValue(0.8);
      return Animated.sequence([
        Animated.timing(potPulse, { toValue: 1, duration: 1500, useNativeDriver: false }),
        Animated.timing(potPulse, { toValue: 0.8, duration: 1500, useNativeDriver: false }),
      ]);
    });
    pp.start();
    const bg = animLoop(() => {
      bsGlow.setValue(0.4);
      return Animated.sequence([
        Animated.timing(bsGlow, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(bsGlow, { toValue: 0.4, duration: 1200, useNativeDriver: false }),
      ]);
    });
    bg.start();
    const ds = animLoop(() => {
      dealerSpin.setValue(0);
      return Animated.timing(dealerSpin, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: false });
    });
    ds.start();
    return () => { cg.stop(); pp.stop(); bg.stop(); ds.stop(); };
  }, []);

  const chips = item.pokerChips ?? 2000;
  const hand = item.pokerHand || '';
  const pot = item.pokerPot || 0;
  const phase = item.pokerPhase || 'waiting';
  const action = item.pokerAction || '';
  const handRank = item.pokerHandRank || '';
  const bsHandRank = item.pokerBsHandRank || '';
  const handsWon = item.pokerHandsWon || 0;
  const handsPlayed = item.pokerHandsPlayed || 0;
  const blinds = item.pokerBlinds || 25;
  const dealer = item.pokerDealer || 'player';
  const cryptoType = item.pokerCryptoType || item.gameCryptoType || '';
  const cryptoAmount = item.pokerCryptoAmount || item.gameCryptoWager || 0;
  const bsEnabled = item.pokerBlackswanEnabled || item.gameBlackswanActive;
  const bsChips = item.pokerBlackswanChips ?? 2000;
  const bsFolded = item.pokerBlackswanFolded;
  const bsLine = item.pokerBlackswanLine || '';
  const winnerName = item.pokerWinnerName || '';
  const community = item.pokerCommunity || '';

  const cryptoColors: Record<string, string> = { SOL: '#14F195', ETH: '#627EEA', BTC: '#F7931A', USDC: '#2775CA', MATIC: '#8247E5' };
  const cryptoSymbols: Record<string, string> = { SOL: '◎', ETH: 'Ξ', BTC: '₿', USDC: '$', MATIC: '⬡' };
  const cColor = cryptoColors[cryptoType] || '#14F195';
  const cSymbol = cryptoSymbols[cryptoType] || '◎';
  const feltGlow = chipGlow.interpolate({ inputRange: [0, 1], outputRange: ['#0d5a0d00', '#0d5a0d30'] });
  const dealerRotate = dealerSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const phaseLabel: Record<string, string> = {
    waiting: 'TAP TO DEAL', deal: 'PRE-FLOP', flop: 'FLOP',
    turn: 'TURN', river: 'RIVER', showdown: winnerName ? `${winnerName} WINS!` : 'SHOWDOWN',
  };

  const communityCards = community ? community.split(' ') : [];
  const isShowdown = phase === 'showdown';
  const bsCards = isShowdown && !bsFolded && item.pokerBlackswanHand ? item.pokerBlackswanHand.split(' ') : [];

  // Card renderer helper
  const renderCard = (card: string, w: number, h: number) => {
    const isRed = card.includes('♥') || card.includes('♦');
    return (
      <View style={{ width: w, height: h, backgroundColor: '#fff', borderRadius: 1.5, borderWidth: 0.5, borderColor: '#bbb', alignItems: 'center', justifyContent: 'center', ...({ boxShadow: '0 1px 2px #0004' } as any) }}>
        <Text style={{ fontSize: w * 0.4, fontWeight: '800', color: isRed ? '#dc2626' : '#111', fontFamily: 'monospace' }}>{card}</Text>
      </View>
    );
  };

  return (
    <View style={{ width: 130, height: 100, backgroundColor: '#1a0a00', borderWidth: 2, borderColor: '#8B4513', borderRadius: 20, overflow: 'hidden' }}>
      {/* Felt surface */}
      <Animated.View style={{ position: 'absolute', top: 4, left: 4, right: 4, bottom: 4, backgroundColor: '#0d5a0d', borderRadius: 16, borderWidth: 2, borderColor: '#1a7a1a' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: feltGlow, borderRadius: 14 }} />
      </Animated.View>

      {/* Table edge accents */}
      <View style={{ position: 'absolute', top: 2, left: '15%' as any, right: '15%' as any, height: 2, backgroundColor: '#CD853F', borderRadius: 1 }} />
      <View style={{ position: 'absolute', bottom: 2, left: '15%' as any, right: '15%' as any, height: 2, backgroundColor: '#CD853F', borderRadius: 1 }} />

      {/* Dealer button */}
      <Animated.View style={{ position: 'absolute', top: dealer === 'blackswan' ? 16 : 72, left: dealer === 'blackswan' ? 26 : 56, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFD700', borderWidth: 1, borderColor: '#B8860B', alignItems: 'center', justifyContent: 'center', zIndex: 5, transform: [{ rotate: dealerRotate }] }}>
        <Text style={{ color: '#8B4513', fontSize: 4, fontWeight: '900' }}>D</Text>
      </Animated.View>

      {/* Phase label + blinds */}
      <View style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center', zIndex: 3 }}>
        <View style={{ backgroundColor: '#00000090', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1.5, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ color: isShowdown && winnerName ? '#22c55e' : '#FFD700', fontSize: 5, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
            {phaseLabel[phase] || phase.toUpperCase()}
          </Text>
          {phase !== 'waiting' && (
            <Text style={{ color: '#666', fontSize: 3.5, fontFamily: 'monospace' }}>{blinds}/{blinds * 2}</Text>
          )}
        </View>
      </View>

      {/* Community cards */}
      {communityCards.length > 0 && (
        <View style={{ position: 'absolute', top: 17, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 2, zIndex: 2 }}>
          {communityCards.map((card, i) => <View key={i}>{renderCard(card, 13, 17)}</View>)}
        </View>
      )}

      {/* Center pot */}
      <View style={{ position: 'absolute', top: 36, left: 0, right: 0, alignItems: 'center', zIndex: 2 }}>
        {pot > 0 && (
          <Animated.View style={{ opacity: potPulse, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', gap: 1, marginBottom: 1 }}>
              {[0, 1, 2].map(i => (
                <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ['#ef4444', '#3b82f6', '#22c55e'][i], borderWidth: 1, borderColor: '#fff' }} />
              ))}
            </View>
            <Text style={{ color: '#FFD700', fontSize: 6, fontWeight: '900', fontFamily: 'monospace' }}>{pot.toLocaleString()}</Text>
            {cryptoAmount > 0 && (
              <Text style={{ color: cColor, fontSize: 4, fontWeight: '900', fontFamily: 'monospace', marginTop: 0.5 }}>{cSymbol}{cryptoAmount} {cryptoType}</Text>
            )}
          </Animated.View>
        )}
      </View>

      {/* Player hand */}
      {hand ? (
        <View style={{ position: 'absolute', bottom: 14, left: '50%' as any, transform: [{ translateX: -16 }], zIndex: 2, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {hand.split(' ').slice(0, 2).map((card, i) => <View key={i}>{renderCard(card, 14, 18)}</View>)}
          </View>
          {/* Hand rank at showdown */}
          {isShowdown && handRank ? (
            <View style={{ backgroundColor: '#00000090', borderRadius: 2, paddingHorizontal: 3, paddingVertical: 0.5, marginTop: 1 }}>
              <Text style={{ color: '#FFD700', fontSize: 3, fontWeight: '900', fontFamily: 'monospace' }}>{handRank}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Player action indicator */}
      {action && phase !== 'waiting' && phase !== 'showdown' && (
        <View style={{ position: 'absolute', bottom: 34, right: 16, backgroundColor: action === 'raise' ? '#ef444490' : action === 'fold' ? '#55555590' : '#22c55e90', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, zIndex: 4 }}>
          <Text style={{ color: '#fff', fontSize: 3.5, fontWeight: '900', fontFamily: 'monospace' }}>{action.toUpperCase()}</Text>
        </View>
      )}

      {/* BlackSwan seat — top left */}
      {bsEnabled && (
        <View style={{ position: 'absolute', top: 14, left: 6, alignItems: 'center', zIndex: 2 }}>
          <Animated.View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#111', borderWidth: 1.5, borderColor: bsFolded ? '#555' : '#8b5cf6', alignItems: 'center', justifyContent: 'center', opacity: bsFolded ? 0.4 : bsGlow }}>
            <Text style={{ fontSize: 8 }}>🦢</Text>
          </Animated.View>
          <Text style={{ color: bsFolded ? '#555' : '#8b5cf6', fontSize: 3.5, fontWeight: '800', fontFamily: 'monospace', marginTop: 1 }}>
            {bsFolded ? 'FOLD' : bsChips.toLocaleString()}
          </Text>
          {/* Cards: face-down or revealed at showdown */}
          {phase !== 'waiting' && !bsFolded && (
            <View style={{ flexDirection: 'row', gap: 1, marginTop: 1 }}>
              {bsCards.length > 0 ? (
                bsCards.slice(0, 2).map((c, i) => <View key={i}>{renderCard(c, 8, 10)}</View>)
              ) : (
                <>
                  <View style={{ width: 8, height: 10, backgroundColor: '#3b28cc', borderRadius: 1, borderWidth: 0.5, borderColor: '#8b5cf6' }} />
                  <View style={{ width: 8, height: 10, backgroundColor: '#3b28cc', borderRadius: 1, borderWidth: 0.5, borderColor: '#8b5cf6' }} />
                </>
              )}
            </View>
          )}
          {isShowdown && bsHandRank && !bsFolded ? (
            <View style={{ backgroundColor: '#8b5cf620', borderRadius: 2, paddingHorizontal: 2, paddingVertical: 0.5, marginTop: 1 }}>
              <Text style={{ color: '#c4b5fd', fontSize: 2.5, fontWeight: '900', fontFamily: 'monospace' }}>{bsHandRank}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Empty player seats */}
      {[{ t: 14, l: 106 }, { t: 48, l: 4 }, { t: 48, l: 112 }].map((pos, i) => (
        <View key={i} style={{ position: 'absolute', top: pos.t, left: pos.l, width: 12, height: 12, borderRadius: 6, backgroundColor: '#222', borderWidth: 1, borderColor: '#444', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 6 }}>👤</Text>
        </View>
      ))}

      {/* Chip count + win record — bottom left */}
      <View style={{ position: 'absolute', bottom: 2, left: 6, zIndex: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFD700', borderWidth: 1, borderColor: '#B8860B' }} />
          <Text style={{ color: '#FFD700', fontSize: 5, fontWeight: '900', fontFamily: 'monospace' }}>{chips.toLocaleString()}</Text>
        </View>
        {handsPlayed > 0 && (
          <Text style={{ color: '#888', fontSize: 3, fontFamily: 'monospace', marginTop: 0.5 }}>{handsWon}W/{handsPlayed}H</Text>
        )}
      </View>

      {/* Crypto wager — bottom right */}
      {cryptoAmount > 0 && (
        <View style={{ position: 'absolute', bottom: 3, right: 6, backgroundColor: '#00000060', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, zIndex: 2 }}>
          <Text style={{ color: cColor, fontSize: 5, fontWeight: '900', fontFamily: 'monospace' }}>{cSymbol}{cryptoAmount}</Text>
        </View>
      )}

      {/* BlackSwan trash talk bubble */}
      {bsEnabled && bsLine ? (
        <View style={{ position: 'absolute', top: 5, left: 24, maxWidth: 52, zIndex: 3 }}>
          <View style={{ backgroundColor: '#8b5cf620', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, borderWidth: 0.5, borderColor: '#8b5cf640' }}>
            <Text style={{ color: '#c4b5fd', fontSize: 3, fontFamily: 'monospace' }} numberOfLines={2}>{bsLine}</Text>
          </View>
        </View>
      ) : null}

      {/* YOU label */}
      {hand ? (
        <View style={{ position: 'absolute', bottom: 7, left: '50%' as any, transform: [{ translateX: -6 }], zIndex: 2 }}>
          <Text style={{ color: '#FFD700', fontSize: 3.5, fontWeight: '800', fontFamily: 'monospace' }}>YOU</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Coin Flip ────────────────────────────────────────────────────────────────
export function CoinFlipItem({ item, theme }: ItemProps) {
  const shimmer = useRef(new Animated.Value(0)).current;
  const bsPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const s = animLoop(() => {
      shimmer.setValue(0);
      return Animated.timing(shimmer, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false });
    });
    s.start();
    const b = animLoop(() => {
      bsPulse.setValue(0.5);
      return Animated.sequence([
        Animated.timing(bsPulse, { toValue: 1, duration: 1000, useNativeDriver: false }),
        Animated.timing(bsPulse, { toValue: 0.5, duration: 1000, useNativeDriver: false }),
      ]);
    });
    b.start();
    return () => { s.stop(); b.stop(); };
  }, []);

  const result = item.coinFlipResult || '';
  const streak = item.coinFlipStreak || 0;
  const cryptoType = item.coinFlipCryptoType || item.gameCryptoType || '';
  const cryptoAmt = item.coinFlipCryptoAmount || item.gameCryptoWager || 0;
  const bsActive = item.coinFlipBlackswan || item.gameBlackswanActive;
  const wins = item.coinFlipWins || 0;
  const losses = item.coinFlipLosses || 0;

  const cryptoColors: Record<string, string> = { SOL: '#14F195', ETH: '#627EEA', BTC: '#F7931A', USDC: '#2775CA', MATIC: '#8247E5' };
  const cryptoSymbols: Record<string, string> = { SOL: '◎', ETH: 'Ξ', BTC: '₿', USDC: '$', MATIC: '⬡' };
  const cColor = cryptoColors[cryptoType] || '#14F195';
  const cSym = cryptoSymbols[cryptoType] || '◎';

  const shimmerOp = shimmer.interpolate({ inputRange: [0, 0.3, 0.5, 0.7, 1], outputRange: [0, 0.6, 0, 0, 0] });

  return (
    <View style={{ width: 56, height: 56, backgroundColor: '#1a1a2e', borderWidth: 2, borderColor: '#FFD700', borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Gold rim glow */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 26, backgroundColor: '#FFD700', opacity: shimmerOp }} />

      {/* Coin face */}
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: result === 'heads' ? '#FFD700' : result === 'tails' ? '#C0C0C0' : '#333', borderWidth: 2, borderColor: result === 'heads' ? '#B8860B' : result === 'tails' ? '#808080' : '#555', alignItems: 'center', justifyContent: 'center' }}>
        {result ? (
          <>
            <Text style={{ fontSize: 12, fontWeight: '900', color: result === 'heads' ? '#8B4513' : '#333' }}>
              {result === 'heads' ? '◎' : '✦'}
            </Text>
            <Text style={{ fontSize: 3.5, fontWeight: '800', fontFamily: 'monospace', color: result === 'heads' ? '#8B4513' : '#555', marginTop: -1 }}>
              {result.toUpperCase()}
            </Text>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 11 }}>🪙</Text>
            <Text style={{ fontSize: 3, color: '#888', fontFamily: 'monospace', marginTop: 1 }}>FLIP</Text>
          </>
        )}
      </View>

      {/* Streak badge */}
      {streak > 0 && (
        <View style={{ position: 'absolute', top: 1, right: 1, backgroundColor: '#ef4444', borderRadius: 6, minWidth: 12, height: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}>
          <Text style={{ color: '#fff', fontSize: 5, fontWeight: '900' }}>x{streak}</Text>
        </View>
      )}

      {/* BlackSwan opponent indicator */}
      {bsActive && (
        <Animated.View style={{ position: 'absolute', top: 1, left: 1, opacity: bsPulse }}>
          <Text style={{ fontSize: 8 }}>🦢</Text>
        </Animated.View>
      )}

      {/* Crypto wager */}
      {cryptoAmt > 0 && (
        <View style={{ position: 'absolute', bottom: 1, backgroundColor: '#00000080', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 0.5 }}>
          <Text style={{ color: cColor, fontSize: 4, fontWeight: '800', fontFamily: 'monospace' }}>{cSym}{cryptoAmt}</Text>
        </View>
      )}

      {/* W/L record */}
      {(wins > 0 || losses > 0) && (
        <View style={{ position: 'absolute', bottom: 1, left: 3 }}>
          <Text style={{ fontSize: 3, fontFamily: 'monospace' }}>
            <Text style={{ color: '#22c55e' }}>{wins}W</Text>
            <Text style={{ color: '#555' }}>-</Text>
            <Text style={{ color: '#ef4444' }}>{losses}L</Text>
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Roulette Wheel ───────────────────────────────────────────────────────────
export function RouletteWheelItem({ item, theme }: ItemProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const ballBounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!item.rouletteSpinning) return;
    const s = animLoop(() => {
      spin.setValue(0);
      return Animated.timing(spin, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: false });
    });
    s.start();
    return () => s.stop();
  }, [item.rouletteSpinning]);

  useEffect(() => {
    const b = animLoop(() => {
      ballBounce.setValue(0);
      return Animated.sequence([
        Animated.timing(ballBounce, { toValue: 1, duration: 500, useNativeDriver: false }),
        Animated.timing(ballBounce, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]);
    });
    b.start();
    return () => b.stop();
  }, []);

  const number = item.rouletteNumber ?? -1;
  const spinning = item.rouletteSpinning;
  const betType = item.rouletteBetType || '';
  const cryptoType = item.rouletteCryptoType || item.gameCryptoType || '';
  const cryptoAmt = item.rouletteCryptoAmount || item.gameCryptoWager || 0;
  const cryptoColors: Record<string, string> = { SOL: '#14F195', ETH: '#627EEA', BTC: '#F7931A', USDC: '#2775CA', MATIC: '#8247E5' };
  const cryptoSymbols: Record<string, string> = { SOL: '◎', ETH: 'Ξ', BTC: '₿', USDC: '$', MATIC: '⬡' };
  const cColor = cryptoColors[cryptoType] || '#14F195';
  const cSym = cryptoSymbols[cryptoType] || '◎';

  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ballY = ballBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const numColor = number === 0 ? '#22c55e' : redNums.includes(number) ? '#ef4444' : '#111';

  return (
    <View style={{ width: 86, height: 86, backgroundColor: '#1a0a00', borderWidth: 2, borderColor: '#8B4513', borderRadius: 43, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Outer rim */}
      <View style={{ position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#CD853F' }} />

      {/* Spinning wheel segments */}
      <Animated.View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: '#0d3a0d', borderWidth: 2, borderColor: '#1a5a1a', alignItems: 'center', justifyContent: 'center', transform: spinning ? [{ rotate: rotation }] : [] }}>
        {/* Colored segments */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <View key={i} style={{
            position: 'absolute', width: 8, height: 8, borderRadius: 4,
            backgroundColor: i % 2 === 0 ? '#ef4444' : '#111',
            top: 6 + Math.sin(i * Math.PI / 4) * 22,
            left: 25 + Math.cos(i * Math.PI / 4) * 22,
          }} />
        ))}

        {/* Center hub */}
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#0a2a0a', borderWidth: 2, borderColor: '#CD853F', alignItems: 'center', justifyContent: 'center' }}>
          {number >= 0 ? (
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: numColor, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900', fontFamily: 'monospace' }}>{number}</Text>
            </View>
          ) : (
            <Text style={{ fontSize: 10 }}>🎡</Text>
          )}
        </View>
      </Animated.View>

      {/* Ball */}
      {spinning && (
        <Animated.View style={{
          position: 'absolute', top: 8, left: '50%' as any,
          width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff',
          marginLeft: -2.5, transform: [{ translateY: ballY }],
        }} />
      )}

      {/* Bet indicator */}
      {betType ? (
        <View style={{ position: 'absolute', bottom: 4, backgroundColor: '#00000080', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 }}>
          <Text style={{ color: betType === 'red' ? '#ef4444' : betType === 'black' ? '#fff' : '#22c55e', fontSize: 4, fontWeight: '800', fontFamily: 'monospace' }}>
            {betType.toUpperCase()}{cryptoAmt > 0 ? ` ${cSym}${cryptoAmt}` : ''}
          </Text>
        </View>
      ) : (
        <View style={{ position: 'absolute', bottom: 5 }}>
          <Text style={{ color: '#CD853F', fontSize: 4, fontWeight: '700', fontFamily: 'monospace' }}>SPIN</Text>
        </View>
      )}
    </View>
  );
}

// ── Chess Board ──────────────────────────────────────────────────────────────
export function ChessBoardItem({ item, theme }: ItemProps) {
  const thinkPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = animLoop(() => {
      thinkPulse.setValue(0.5);
      return Animated.sequence([
        Animated.timing(thinkPulse, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(thinkPulse, { toValue: 0.5, duration: 1200, useNativeDriver: false }),
      ]);
    });
    t.start();
    return () => t.stop();
  }, []);

  const turn = item.chessTurn || 'white';
  const gameOver = item.chessGameOver;

  // Mini chess board with starting positions
  const pieces = [
    ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
    ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'],
    ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖'],
  ];

  const turnIndicatorOp = thinkPulse;

  return (
    <View style={{ width: 86, height: 86, backgroundColor: '#3e2723', borderWidth: 2, borderColor: '#8B4513', borderRadius: 4, padding: 3, overflow: 'hidden' }}>
      {/* Board */}
      <View style={{ flex: 1 }}>
        {pieces.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', flex: 1 }}>
            {row.map((piece, c) => (
              <View key={c} style={{
                flex: 1, alignItems: 'center', justifyContent: 'center',
                backgroundColor: (r + c) % 2 === 0 ? '#F0D9B5' : '#B58863',
              }}>
                {piece ? <Text style={{ fontSize: 6.5, lineHeight: 8 }}>{piece}</Text> : null}
              </View>
            ))}
          </View>
        ))}
      </View>

      {/* Turn indicator */}
      <View style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 10, backgroundColor: '#3e2723ee', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <Animated.View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: turn === 'white' ? '#F0D9B5' : '#3e2723', borderWidth: 1, borderColor: '#8B4513', opacity: turnIndicatorOp }} />
        <Text style={{ color: '#CD853F', fontSize: 5, fontWeight: '800', fontFamily: 'monospace' }}>
          {gameOver ? 'CHECKMATE' : `${turn.toUpperCase()}'S MOVE`}
        </Text>
      </View>
    </View>
  );
}

// ── Connect Four ─────────────────────────────────────────────────────────────
export function ConnectFourItem({ item, theme }: ItemProps) {
  const dropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const d = animLoop(() => {
      dropAnim.setValue(0);
      return Animated.sequence([
        Animated.timing(dropAnim, { toValue: 1, duration: 500, easing: Easing.bounce, useNativeDriver: false }),
        Animated.timing(dropAnim, { toValue: 1, duration: 3500, useNativeDriver: false }),
      ]);
    });
    d.start();
    return () => d.stop();
  }, []);

  const turn = item.connectFourTurn || 1; // 1=red, 2=yellow
  const winner = item.connectFourWinner || 0;
  const boardStr = item.connectFourBoard || '';

  // Parse board or use demo pattern
  const board: number[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: number[] = [];
    for (let c = 0; c < 7; c++) {
      const idx = r * 7 + c;
      row.push(boardStr.length > idx ? parseInt(boardStr[idx]) || 0 : 0);
    }
    board.push(row);
  }

  // Demo pattern if empty
  if (!boardStr) {
    board[5][3] = 1; board[5][2] = 2; board[4][3] = 1; board[5][4] = 2; board[5][1] = 1;
  }

  const turnColor = turn === 1 ? '#ef4444' : '#eab308';
  const dropY = dropAnim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });

  return (
    <View style={{ width: 76, height: 76, backgroundColor: '#1e40af', borderWidth: 2, borderColor: '#3b82f6', borderRadius: 6, padding: 2, overflow: 'hidden' }}>
      {/* Grid */}
      {board.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', flex: 1, gap: 1, justifyContent: 'center' }}>
          {row.map((cell, c) => (
            <View key={c} style={{ flex: 1, aspectRatio: 1, borderRadius: 100, backgroundColor: '#1e3a8a', alignItems: 'center', justifyContent: 'center', margin: 0.5 }}>
              {cell > 0 && (
                <View style={{ width: '80%' as any, height: '80%' as any, borderRadius: 100, backgroundColor: cell === 1 ? '#ef4444' : '#eab308' }} />
              )}
            </View>
          ))}
        </View>
      ))}

      {/* Dropping piece indicator */}
      <Animated.View style={{
        position: 'absolute', top: 0, left: '50%' as any, marginLeft: -4,
        width: 8, height: 8, borderRadius: 4, backgroundColor: turnColor,
        transform: [{ translateY: dropY }], opacity: winner ? 0 : 1,
      }} />

      {/* Status bar */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10, backgroundColor: '#1e3a8aee', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2 }}>
        {winner ? (
          <Text style={{ color: winner === 1 ? '#ef4444' : '#eab308', fontSize: 5, fontWeight: '900', fontFamily: 'monospace' }}>
            {winner === 1 ? 'RED' : 'YELLOW'} WINS!
          </Text>
        ) : (
          <>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: turnColor }} />
            <Text style={{ color: turnColor, fontSize: 4.5, fontWeight: '800', fontFamily: 'monospace' }}>DROP</Text>
          </>
        )}
      </View>
    </View>
  );
}

// ── Trivia Screen ────────────────────────────────────────────────────────────
export function TriviaScreenItem({ item, theme }: ItemProps) {
  const timerBar = useRef(new Animated.Value(1)).current;
  const correctFlash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = animLoop(() => {
      timerBar.setValue(1);
      return Animated.timing(timerBar, { toValue: 0, duration: 15000, easing: Easing.linear, useNativeDriver: false });
    });
    t.start();
    return () => t.stop();
  }, []);

  const question = item.triviaQuestion || 'What does SOL stand for?';
  const score = item.triviaScore || 0;
  const category = item.triviaCategory || 'crypto';
  const answer = item.triviaAnswer ?? -1;

  const catColors: Record<string, string> = { tech: '#3b82f6', crypto: '#14F195', general: '#f59e0b' };
  const catColor = catColors[category] || catColors.general;

  const timerWidth = timerBar.interpolate({ inputRange: [0, 1], outputRange: ['0%' as any, '100%' as any] });

  const options = ['Solana', 'Proof of History', 'Smart Object Ledger', 'None of these'];

  return (
    <View style={{ width: 86, height: 56, backgroundColor: '#0f172a', borderWidth: 2, borderColor: catColor + '80', borderRadius: 8, overflow: 'hidden' }}>
      {/* Category + score header */}
      <View style={{ height: 12, backgroundColor: catColor + '20', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <Text style={{ color: catColor, fontSize: 5, fontWeight: '800', fontFamily: 'monospace' }}>
          🧠 {category.toUpperCase()}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ color: '#FFD700', fontSize: 5, fontWeight: '900', fontFamily: 'monospace' }}>🔥{score}</Text>
        </View>
      </View>

      {/* Timer bar */}
      <View style={{ height: 2, backgroundColor: '#1e293b' }}>
        <Animated.View style={{ height: '100%' as any, backgroundColor: catColor, width: timerWidth }} />
      </View>

      {/* Question */}
      <View style={{ paddingHorizontal: 4, paddingTop: 2 }}>
        <Text style={{ color: '#e2e8f0', fontSize: 4.5, fontFamily: 'monospace', fontWeight: '600' }} numberOfLines={2}>{question}</Text>
      </View>

      {/* Answer grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 3, paddingTop: 2 }}>
        {options.map((opt, i) => {
          const selected = answer === i;
          return (
            <View key={i} style={{
              width: '47%' as any, height: 9,
              backgroundColor: selected ? catColor + '30' : '#1e293b',
              borderRadius: 3, borderWidth: 0.5,
              borderColor: selected ? catColor : '#334155',
              justifyContent: 'center', paddingHorizontal: 3,
            }}>
              <Text style={{ color: selected ? catColor : '#94a3b8', fontSize: 3.5, fontFamily: 'monospace' }} numberOfLines={1}>
                {String.fromCharCode(65 + i)}. {opt}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
