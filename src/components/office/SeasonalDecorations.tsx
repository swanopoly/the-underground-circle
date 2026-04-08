import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

type Season = 'none' | 'winter' | 'spring' | 'summer' | 'halloween' | 'holiday';

interface SeasonalDecorationsProps {
  season?: Season;
  floorWidth: number;
  floorHeight: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}

interface SpriteConfig {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  char?: string;
  delay: number;
  duration: number;
}

function generateSprites(
  season: Season,
  floorWidth: number,
  floorHeight: number,
): SpriteConfig[] {
  const sprites: SpriteConfig[] = [];
  const count = season === 'holiday' ? 20 : randInt(12, 18);

  for (let i = 0; i < count; i++) {
    const base: SpriteConfig = {
      id: i,
      x: rand(0, floorWidth - 12),
      y: rand(0, floorHeight - 12),
      size: randInt(3, 6),
      color: '#ffffff',
      delay: rand(0, 3000),
      duration: rand(2000, 5000),
    };

    switch (season) {
      case 'winter':
        base.color = ['#e0e8ff', '#c8d8ff', '#ffffff', '#d0e0ff'][i % 4];
        base.size = randInt(2, 5);
        break;
      case 'spring':
        base.color = ['#ffb7c5', '#ffc4d6', '#ffd6e7', '#ffe0f0', '#ff9eb8'][i % 5];
        base.size = randInt(3, 6);
        break;
      case 'summer':
        // Sun rays from top-left corner
        base.x = rand(0, floorWidth * 0.4);
        base.y = rand(0, floorHeight * 0.3);
        base.color = ['#fbbf24', '#f59e0b', '#fcd34d', '#fde68a'][i % 4];
        base.size = randInt(2, 4);
        break;
      case 'halloween':
        if (i < count / 2) {
          // Bats
          base.color = '#1a1a2e';
          base.char = 'W';
          base.size = randInt(4, 7);
          base.y = rand(0, floorHeight * 0.5);
        } else {
          // Pumpkins
          base.color = '#f97316';
          base.char = 'o';
          base.size = randInt(5, 8);
          base.y = rand(floorHeight * 0.7, floorHeight - 12);
        }
        break;
      case 'holiday':
        if (i < 10) {
          // String lights along top edge
          base.x = (floorWidth / 10) * i + rand(-4, 4);
          base.y = rand(2, 14);
          base.color = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#ec4899'][i % 5];
          base.size = 4;
        } else {
          // Presents in corners
          const corner = (i - 10) % 4;
          base.x = corner < 2 ? rand(4, 40) : rand(floorWidth - 44, floorWidth - 8);
          base.y = corner % 2 === 0 ? rand(floorHeight - 40, floorHeight - 8) : rand(floorHeight - 40, floorHeight - 8);
          base.color = ['#ef4444', '#22c55e', '#6366f1', '#eab308'][corner];
          base.size = randInt(6, 10);
          base.char = '#';
        }
        break;
    }

    sprites.push(base);
  }

  return sprites;
}

// ─── Individual Animated Sprite ─────────────────────────────────────────────

function AnimatedSprite({
  sprite,
  season,
  floorHeight,
}: {
  sprite: SpriteConfig;
  season: Season;
  floorHeight: number;
}) {
  const animY = useRef(new Animated.Value(0)).current;
  const animX = useRef(new Animated.Value(0)).current;
  const animOpacity = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    const startDelay = sprite.delay;

    // Y animation (falling / floating)
    const runYAnim = () => {
      let yAnimation: Animated.CompositeAnimation;

      if (season === 'winter' || season === 'spring') {
        // Falling — translate from top to floor
        const fallDist = floorHeight - sprite.y;
        yAnimation = Animated.sequence([
          Animated.delay(startDelay),
          Animated.timing(animY, {
            toValue: fallDist,
            duration: sprite.duration + rand(1000, 3000),
            useNativeDriver: false,
          }),
          Animated.timing(animY, {
            toValue: 0,
            duration: 0,
            useNativeDriver: false,
          }),
        ]);
      } else if (season === 'halloween') {
        // Bats: swoopy up-down
        yAnimation = Animated.sequence([
          Animated.delay(startDelay),
          Animated.timing(animY, {
            toValue: -20,
            duration: sprite.duration,
            useNativeDriver: false,
          }),
          Animated.timing(animY, {
            toValue: 10,
            duration: sprite.duration * 0.7,
            useNativeDriver: false,
          }),
          Animated.timing(animY, {
            toValue: 0,
            duration: sprite.duration * 0.5,
            useNativeDriver: false,
          }),
        ]);
      } else {
        // Default gentle float
        yAnimation = Animated.sequence([
          Animated.delay(startDelay),
          Animated.timing(animY, {
            toValue: -8,
            duration: sprite.duration,
            useNativeDriver: false,
          }),
          Animated.timing(animY, {
            toValue: 0,
            duration: sprite.duration,
            useNativeDriver: false,
          }),
        ]);
      }

      yAnimation.start(() => runYAnim());
    };

    // X animation (drift / sway)
    const runXAnim = () => {
      const drift = season === 'spring' ? rand(-15, 15) : rand(-6, 6);
      const xAnimation = Animated.sequence([
        Animated.delay(startDelay + rand(0, 500)),
        Animated.timing(animX, {
          toValue: drift,
          duration: sprite.duration * 1.2,
          useNativeDriver: false,
        }),
        Animated.timing(animX, {
          toValue: 0,
          duration: sprite.duration * 1.2,
          useNativeDriver: false,
        }),
      ]);
      xAnimation.start(() => runXAnim());
    };

    // Opacity pulse (for lights/glow effects)
    const runOpacityAnim = () => {
      if (season !== 'holiday' && season !== 'summer') return;
      const opAnim = Animated.sequence([
        Animated.timing(animOpacity, {
          toValue: 0.3,
          duration: rand(400, 800),
          useNativeDriver: false,
        }),
        Animated.timing(animOpacity, {
          toValue: 1,
          duration: rand(400, 800),
          useNativeDriver: false,
        }),
      ]);
      opAnim.start(() => runOpacityAnim());
    };

    runYAnim();
    runXAnim();
    runOpacityAnim();

    return () => {
      animY.stopAnimation();
      animX.stopAnimation();
      animOpacity.stopAnimation();
    };
  }, []);

  return (
    <Animated.View
      style={[
        styles.sprite,
        {
          left: sprite.x,
          top: sprite.y,
          width: sprite.size,
          height: sprite.size,
          backgroundColor: sprite.char ? 'transparent' : sprite.color,
          borderRadius: season === 'winter' ? sprite.size / 2 : 1,
          transform: [{ translateY: animY }, { translateX: animX }],
          opacity: animOpacity,
        },
      ]}
      pointerEvents="none"
    >
      {sprite.char ? (
        <Text
          style={[
            styles.spriteChar,
            {
              fontSize: sprite.size + 2,
              color: sprite.color,
            },
          ]}
        >
          {sprite.char}
        </Text>
      ) : null}
    </Animated.View>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function SeasonalDecorations({
  season = 'none',
  floorWidth,
  floorHeight,
}: SeasonalDecorationsProps) {
  if (season === 'none' || !floorWidth || !floorHeight) return null;

  const sprites = useMemo(
    () => generateSprites(season, floorWidth, floorHeight),
    [season, floorWidth, floorHeight],
  );

  return (
    <View style={[styles.container, { width: floorWidth, height: floorHeight }]} pointerEvents="none">
      {sprites.map(sprite => (
        <AnimatedSprite
          key={sprite.id}
          sprite={sprite}
          season={season}
          floorHeight={floorHeight}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  sprite: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spriteChar: {
    fontFamily: 'monospace',
    fontWeight: '700',
    lineHeight: 12,
  },
});
