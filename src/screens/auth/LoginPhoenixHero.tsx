/**
 * LoginPhoenixHero — small BlackSwan pixel sprite with a red phoenix
 * bird looping around it. Sits in the hero panel of the LoginScreen
 * above the "UNDERGROUND ACCESS" eyebrow.
 *
 * The swan is the existing `swanai.png` asset. The phoenix is drawn
 * with absolutely-positioned colored Views forming a tiny pixel-art
 * bird (body / wing / tail / beak) plus a fading three-dot ember
 * trail. Animated.loop drives a translateX/Y figure-8 path so the
 * bird orbits the swan.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, View } from 'react-native';

const ORBIT_RX = 56;   // horizontal radius of the orbit
const ORBIT_RY = 30;   // vertical radius — squashed for figure-8 feel
const ORBIT_MS = 4200;

const SWAN_SIZE = 96;
const HERO_HEIGHT = 130;

export default function LoginPhoenixHero() {
  // Orbit angle 0 → 2π, loops forever. Phase shifted versions of this
  // drive the trail dots so they lag behind the body.
  const angle = useRef(new Animated.Value(0)).current;
  // Slight body bob so it doesn't look mechanical.
  const bob = useRef(new Animated.Value(0)).current;
  // Wing flap.
  const flap = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(angle, {
        toValue: 1,
        duration: ORBIT_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(bob, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(flap, { toValue: 1, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(flap, { toValue: 0, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    ).start();
  }, [angle, bob, flap]);

  // Phoenix body translate — figure-8 orbit. cos for x, sin(2θ)/2 for
  // y gives a tilted infinity loop that passes in front + behind the
  // swan over each cycle.
  const orbit = (phase: number) => {
    const t = Animated.add(angle, new Animated.Value(phase)).interpolate({
      inputRange: [0, 1],
      outputRange: [0, Math.PI * 2],
    }) as any;
    return {
      translateX: t.interpolate({
        inputRange: Array.from({ length: 33 }, (_, i) => (i / 32) * Math.PI * 2),
        outputRange: Array.from({ length: 33 }, (_, i) => Math.cos((i / 32) * Math.PI * 2) * ORBIT_RX),
      }),
      translateY: t.interpolate({
        inputRange: Array.from({ length: 33 }, (_, i) => (i / 32) * Math.PI * 2),
        outputRange: Array.from({ length: 33 }, (_, i) => Math.sin((i / 32) * Math.PI * 4) * (ORBIT_RY / 2)),
      }),
    };
  };

  const body = orbit(0);
  const trail1 = orbit(-0.06);
  const trail2 = orbit(-0.12);
  const trail3 = orbit(-0.18);

  const bobY = bob.interpolate({ inputRange: [0, 1], outputRange: [-1, 1] });
  const wingScale = flap.interpolate({ inputRange: [0, 1], outputRange: [1, 0.65] });

  return (
    <View style={s.root} pointerEvents="none">
      <View style={s.center}>
        <Image
          source={require('../../../assets/swanai.png')}
          style={s.swan}
          resizeMode="contain"
        />

        {/* Trail embers — three fading dots that follow the phoenix. */}
        <Animated.View style={[s.ember, { backgroundColor: '#fbbf24', opacity: 0.45, transform: [{ translateX: trail3.translateX }, { translateY: trail3.translateY }] }]} />
        <Animated.View style={[s.ember, { backgroundColor: '#f97316', opacity: 0.65, transform: [{ translateX: trail2.translateX }, { translateY: trail2.translateY }] }]} />
        <Animated.View style={[s.ember, { backgroundColor: '#ef4444', opacity: 0.85, transform: [{ translateX: trail1.translateX }, { translateY: trail1.translateY }] }]} />

        {/* Phoenix body — built from absolutely-positioned colored
            Views forming a tiny pixel-art bird. Centered on the orbit
            point so the whole thing translates as one. */}
        <Animated.View
          style={[
            s.phoenix,
            { transform: [{ translateX: body.translateX }, { translateY: Animated.add(body.translateY as any, bobY as any) }] },
          ]}
        >
          <PixelPhoenix wingScale={wingScale} />
        </Animated.View>
      </View>
    </View>
  );
}

function PixelPhoenix({ wingScale }: { wingScale: any }) {
  // 4x4-pixel block size. Sprite is roughly 7 wide x 5 tall = 28x20px.
  const PX = 3;
  // Color palette (red phoenix gradient).
  const RED   = '#dc2626';
  const ORG   = '#f97316';
  const YEL   = '#fbbf24';
  const DEEP  = '#991b1b';

  const block = (color: string, top: number, left: number, w = 1, h = 1) => (
    <View
      key={`${top}-${left}`}
      style={{
        position: 'absolute',
        top: top * PX,
        left: left * PX,
        width: w * PX,
        height: h * PX,
        backgroundColor: color,
      }}
    />
  );

  return (
    <View style={{ width: PX * 9, height: PX * 6 }}>
      {/* Glow halo behind the bird — soft blur effect via low-opacity
          large block. */}
      <View
        style={{
          position: 'absolute',
          top: -PX * 2,
          left: -PX * 2,
          width: PX * 13,
          height: PX * 10,
          backgroundColor: '#ef444433',
          borderRadius: PX * 5,
          ...(Platform.OS === 'web' ? { filter: 'blur(4px)' } as any : {}),
        }}
      />

      {/* Wing — animates with flap scale. Drawn behind the body. */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: PX * 1,
          width: PX * 5,
          height: PX * 3,
          transform: [{ scaleY: wingScale }],
        }}
      >
        {block(ORG, 0, 1)}
        {block(RED, 0, 2)}
        {block(RED, 0, 3)}
        {block(DEEP, 1, 0)}
        {block(RED, 1, 1)}
        {block(ORG, 1, 2)}
        {block(YEL, 1, 3)}
        {block(YEL, 1, 4)}
        {block(DEEP, 2, 1)}
        {block(RED, 2, 2)}
        {block(ORG, 2, 3)}
      </Animated.View>

      {/* Body. */}
      {block(DEEP, 2, 2)}
      {block(RED,  2, 3)}
      {block(RED,  2, 4)}
      {block(ORG,  2, 5)}
      {block(YEL,  2, 6)}
      {block(RED,  3, 2)}
      {block(ORG,  3, 3)}
      {block(YEL,  3, 4)}
      {block(YEL,  3, 5)}
      {block(ORG,  3, 6)}

      {/* Beak — small yellow triangle to the right. */}
      {block(YEL,  3, 7)}
      {block(ORG,  2, 7)}

      {/* Tail flames — trailing left of the body. */}
      {block(YEL,  3, 1)}
      {block(ORG,  4, 1, 2, 1)}
      {block(RED,  4, 0)}
      {block(YEL,  4, 3)}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    width: '100%',
    height: HERO_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  center: {
    position: 'relative',
    width: SWAN_SIZE,
    height: SWAN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swan: {
    width: SWAN_SIZE,
    height: SWAN_SIZE,
  },
  phoenix: {
    position: 'absolute',
    top: SWAN_SIZE / 2 - 9,
    left: SWAN_SIZE / 2 - 13,
  },
  ember: {
    position: 'absolute',
    top: SWAN_SIZE / 2 - 2,
    left: SWAN_SIZE / 2 - 2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
