import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';

interface EffectProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RIPPLE — 3 concentric rings, staggered
// ═══════════════════════════════════════════════════════════════════════════════
export function RippleEffect({ x, y, onComplete }: EffectProps) {
  const rings = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    Animated.stagger(200, rings.map(r =>
      Animated.timing(r, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: false })
    )).start(() => onComplete());
  }, []);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x + 20, top: y + 20, zIndex: 40 }}>
      {rings.map((r, i) => {
        const size = r.interpolate({ inputRange: [0, 1], outputRange: [10, 100 + i * 30] });
        const op = r.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.7, 0] });
        return (
          <Animated.View key={i} style={{
            position: 'absolute',
            width: size, height: size,
            marginLeft: Animated.multiply(size, -0.5),
            marginTop: Animated.multiply(size, -0.5),
            borderRadius: 999,
            borderWidth: 2, borderColor: '#f59e0b',
            opacity: op,
          }} />
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFETTI — 20 particles, varied sizes, gravity arc
// ═══════════════════════════════════════════════════════════════════════════════
export function ConfettiEffect({ x, y, onComplete }: EffectProps) {
  const particles = useRef(
    Array.from({ length: 20 }, (_, i) => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      op: new Animated.Value(1),
      rot: new Animated.Value(0),
      angle: (i / 20) * Math.PI * 2 + (Math.random() - 0.5) * 0.6,
      dist: 20 + Math.random() * 50,
      size: 2 + Math.random() * 4,
      isCircle: Math.random() > 0.5,
      color: ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'][i % 8],
    }))
  ).current;

  useEffect(() => {
    const anims = particles.map(p =>
      Animated.parallel([
        Animated.timing(p.x, { toValue: Math.cos(p.angle) * p.dist, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.sequence([
          Animated.timing(p.y, { toValue: Math.sin(p.angle) * p.dist * 0.6 - 25, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: false }),
          Animated.timing(p.y, { toValue: Math.sin(p.angle) * p.dist + 15, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: false }),
        ]),
        Animated.timing(p.rot, { toValue: 2 + Math.random() * 4, duration: 900, useNativeDriver: false }),
        Animated.timing(p.op, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      ])
    );
    Animated.parallel(anims).start(() => onComplete());
  }, []);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x + 20, top: y + 20, zIndex: 40 }}>
      {particles.map((p, i) => (
        <Animated.View key={i} style={{
          position: 'absolute',
          width: p.size, height: p.size,
          borderRadius: p.isCircle ? p.size / 2 : 1,
          backgroundColor: p.color,
          opacity: p.op,
          transform: [
            { translateX: p.x }, { translateY: p.y },
            { rotate: p.rot.interpolate({ inputRange: [0, 6], outputRange: ['0deg', '2160deg'] }) },
          ],
        }} />
      ))}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROCKET — rises with exhaust trail
// ═══════════════════════════════════════════════════════════════════════════════
export function RocketEffect({ x, y, onComplete }: EffectProps) {
  const mainY = useRef(new Animated.Value(0)).current;
  const mainOp = useRef(new Animated.Value(1)).current;
  const exhaust = useRef(
    Array.from({ length: 6 }, (_, i) => ({
      y: new Animated.Value(0),
      op: new Animated.Value(0),
      x: new Animated.Value(0),
      delay: i * 120,
    }))
  ).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(mainY, { toValue: -150, duration: 1500, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      Animated.timing(mainOp, { toValue: 0, duration: 1500, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      ...exhaust.map((e) =>
        Animated.sequence([
          Animated.delay(e.delay),
          Animated.parallel([
            Animated.timing(e.y, { toValue: 20 + Math.random() * 15, duration: 600, useNativeDriver: false }),
            Animated.sequence([
              Animated.timing(e.op, { toValue: 0.8, duration: 100, useNativeDriver: false }),
              Animated.timing(e.op, { toValue: 0, duration: 500, useNativeDriver: false }),
            ]),
            Animated.timing(e.x, { toValue: (Math.random() - 0.5) * 12, duration: 600, useNativeDriver: false }),
          ]),
        ])
      ),
    ]).start(() => onComplete());
  }, []);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x + 20, top: y, zIndex: 40 }}>
      <Animated.Text style={{ fontSize: 20, opacity: mainOp, transform: [{ translateY: mainY }] }}>🚀</Animated.Text>
      {exhaust.map((e, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', top: 20,
          width: 4, height: 4, borderRadius: 2,
          backgroundColor: ['#f97316', '#fbbf24', '#ef4444'][i % 3],
          opacity: e.op,
          transform: [{ translateY: e.y }, { translateX: e.x }],
        }} />
      ))}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DICE — tumbling rotation + bounce
// ═══════════════════════════════════════════════════════════════════════════════
export function DiceEffect({ x, y, onComplete }: EffectProps) {
  const rot = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const posY = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(rot, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.5, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(scale, { toValue: 1, duration: 400, easing: Easing.bounce, useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.timing(posY, { toValue: -25, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(posY, { toValue: 0, duration: 400, easing: Easing.bounce, useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(op, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]),
    ]).start(() => onComplete());
  }, []);

  const rotation = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] });
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: x + 10, top: y - 10, zIndex: 40,
      opacity: op,
      transform: [{ translateY: posY }, { scale }, { rotate: rotation }],
    }}>
      <Text style={{ fontSize: 18 }}>🎲</Text>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PULSE — smooth expanding glow circle
// ═══════════════════════════════════════════════════════════════════════════════
export function PulseEffect({ x, y, onComplete }: EffectProps) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start(() => onComplete());
  }, []);
  const size = anim.interpolate({ inputRange: [0, 1], outputRange: [20, 80] });
  const op = anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.4, 0] });
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: x + 20, top: y + 20, zIndex: 40,
      width: size, height: size,
      marginLeft: Animated.multiply(size, -0.5),
      marginTop: Animated.multiply(size, -0.5),
      borderRadius: 999,
      backgroundColor: '#f59e0b',
      opacity: op,
    }} />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHAKE — sound wave arcs from alarm bell
// ═══════════════════════════════════════════════════════════════════════════════
export function ShakeEffect({ x, y, onComplete }: EffectProps) {
  const arcs = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    Animated.stagger(150, arcs.map(a =>
      Animated.timing(a, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: false })
    )).start(() => onComplete());
  }, []);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x + 30, top: y + 10, zIndex: 40 }}>
      {arcs.map((a, i) => {
        const size = a.interpolate({ inputRange: [0, 1], outputRange: [8, 30 + i * 12] });
        const op = a.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.6, 0] });
        return (
          <Animated.View key={i} style={{
            position: 'absolute',
            width: size, height: size,
            borderRadius: 999,
            borderWidth: 2, borderColor: '#f59e0b',
            borderLeftColor: 'transparent', borderBottomColor: 'transparent',
            opacity: op,
            transform: [{ rotate: '-45deg' }],
          }} />
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FIREWORKS — 3 burst points, staggered
// ═══════════════════════════════════════════════════════════════════════════════
export function FireworksEffect({ x, y, onComplete }: EffectProps) {
  const bursts = useRef(
    Array.from({ length: 3 }, (_, bi) => ({
      particles: Array.from({ length: 8 }, (_, pi) => ({
        px: new Animated.Value(0),
        py: new Animated.Value(0),
        op: new Animated.Value(0),
        angle: (pi / 8) * Math.PI * 2,
        dist: 15 + Math.random() * 25,
        color: ['#fbbf24', '#ef4444', '#22c55e', '#3b82f6', '#ec4899', '#8b5cf6', '#f97316', '#14b8a6'][pi],
      })),
      offsetX: (Math.random() - 0.5) * 40,
      offsetY: (Math.random() - 0.5) * 30 - 15,
      delay: bi * 250,
    }))
  ).current;

  useEffect(() => {
    const allAnims = bursts.flatMap(burst =>
      burst.particles.map(p =>
        Animated.sequence([
          Animated.delay(burst.delay),
          Animated.parallel([
            Animated.timing(p.px, { toValue: Math.cos(p.angle) * p.dist, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: false }),
            Animated.sequence([
              Animated.timing(p.py, { toValue: Math.sin(p.angle) * p.dist * 0.7 - 10, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: false }),
              Animated.timing(p.py, { toValue: Math.sin(p.angle) * p.dist + 8, duration: 350, easing: Easing.in(Easing.quad), useNativeDriver: false }),
            ]),
            Animated.sequence([
              Animated.timing(p.op, { toValue: 1, duration: 100, useNativeDriver: false }),
              Animated.delay(300),
              Animated.timing(p.op, { toValue: 0, duration: 300, useNativeDriver: false }),
            ]),
          ]),
        ])
      )
    );
    Animated.parallel(allAnims).start(() => onComplete());
  }, []);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x + 20, top: y + 20, zIndex: 40 }}>
      {bursts.map((burst, bi) => (
        <View key={bi} style={{ position: 'absolute', left: burst.offsetX, top: burst.offsetY }}>
          {burst.particles.map((p, pi) => (
            <Animated.View key={pi} style={{
              position: 'absolute',
              width: 3, height: 3, borderRadius: 1.5,
              backgroundColor: p.color,
              opacity: p.op,
              transform: [{ translateX: p.px }, { translateY: p.py }],
            }} />
          ))}
        </View>
      ))}
    </View>
  );
}
