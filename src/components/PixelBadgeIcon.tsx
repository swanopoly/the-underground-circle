/**
 * PixelBadgeIcon — Renders badge icons as animated pixel art grids
 *
 * Used for Gold, Platinum, and Legendary tier badges instead of emoji.
 * Each icon is a grid of tiny View cells with tier-specific animations:
 *   Gold:      Scan-line sweep (row highlights top→bottom)
 *   Platinum:  Random pixel twinkle (cells flash bright)
 *   Legendary: Wave pulse + color cycling across the grid
 */
import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import type { BadgeTier } from '../lib/badges';

// ─── Pixel Art Definitions ──────────────────────────────────────────────────
// Each sprite is an array of strings. Characters:
//   '.' = transparent
//   '#' = primary color
//   '@' = accent/highlight color
//   'x' = secondary detail color

type PixelSprite = string[];

const SPRITES: Record<string, { grid: PixelSprite; primary: string; accent: string; detail: string }> = {
  // ─── GOLD ──────────────────────────────────────────────────────────────────
  // Warrant Officer — All-Seeing Eye
  warrant_officer: {
    grid: [
      '...###...',
      '..#.@.#..',
      '.#.@@@.#.',
      '#..@#@..#',
      '.#.@@@.#.',
      '..#.@.#..',
      '...###...',
    ],
    primary: '#ffd700',
    accent: '#fff8e1',
    detail: '#b8860b',
  },
  // Lieutenant — Command Star
  lieutenant: {
    grid: [
      '....#....',
      '...###...',
      '....#....',
      '.#.###.#.',
      '####@####',
      '.#.###.#.',
      '....#....',
      '...###...',
      '....#....',
    ],
    primary: '#ffd700',
    accent: '#ffffff',
    detail: '#daa520',
  },
  // Commander — Crown
  commander: {
    grid: [
      '.#...#...#.',
      '.##.###.##.',
      '.#########.',
      '..#######..',
      '..#@#@#@#..',
      '..#######..',
      '...#####...',
    ],
    primary: '#ffd700',
    accent: '#ff4444',
    detail: '#b8860b',
  },

  // ─── PLATINUM ──────────────────────────────────────────────────────────────
  // Captain — Diamond Gem
  captain: {
    grid: [
      '....#....',
      '...###...',
      '..##@##..',
      '.##@@@##.',
      '##@@#@@##',
      '.##@@@##.',
      '..##@##..',
      '...###...',
      '....#....',
    ],
    primary: '#c0c8d8',
    accent: '#ffffff',
    detail: '#8090a0',
  },
  // Major — Nebula / Starburst
  major: {
    grid: [
      '#...@...#',
      '.#..@..#.',
      '..#.@.#..',
      '...#@#...',
      '@@@@@@@@@',
      '...#@#...',
      '..#.@.#..',
      '.#..@..#.',
      '#...@...#',
    ],
    primary: '#b0b8c8',
    accent: '#e5e4e2',
    detail: '#7080a0',
  },

  // ─── LEGENDARY ─────────────────────────────────────────────────────────────
  // Spartan — Halo Helmet (front-facing visor)
  spartan: {
    grid: [
      '...#####...',
      '..#######..',
      '.####@####.',
      '.##@@@@@##.',
      '.##@@@@@##.',
      '.#########.',
      '..##.#.##..',
      '..##...##..',
      '...#####...',
    ],
    primary: '#00FF9C',
    accent: '#00ccff',
    detail: '#005533',
  },
  // Demon — Skull
  demon: {
    grid: [
      '..#######..',
      '.#########.',
      '.##@###@##.',
      '.##@###@##.',
      '.#########.',
      '..###.###..',
      '...#.#.#...',
      '..#.#.#.#..',
      '...#####...',
    ],
    primary: '#00FF9C',
    accent: '#ff0040',
    detail: '#004422',
  },
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  badgeId: string;
  tier: BadgeTier;
  size: number;         // total pixel area size in px
  animate?: boolean;
  earned?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PixelBadgeIcon({ badgeId, tier, size, animate = false, earned = true }: Props) {
  const sprite = SPRITES[badgeId];
  if (!sprite) return null;

  const rows = sprite.grid.length;
  const cols = Math.max(...sprite.grid.map(r => r.length));
  const cellSize = Math.max(2, Math.floor(size / Math.max(rows, cols)));

  // ── Animation values ────────────────────────────────────────────────────
  const scanAnim = useRef(new Animated.Value(0)).current;
  const twinkleAnims = useMemo(
    () => Array.from({ length: 6 }, () => ({
      opacity: new Animated.Value(0),
      row: Math.floor(Math.random() * rows),
      col: Math.floor(Math.random() * cols),
    })),
    [rows, cols],
  );
  const waveAnim = useRef(new Animated.Value(0)).current;
  const colorCycleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate || !earned) return;
    const anims: Animated.CompositeAnimation[] = [];

    if (tier === 'gold') {
      // Scan-line sweep: value goes 0 → rows, each integer = highlighted row
      anims.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(scanAnim, {
              toValue: rows,
              duration: rows * 280,
              easing: Easing.linear,
              useNativeDriver: false,
            }),
            Animated.delay(1200),
            Animated.timing(scanAnim, {
              toValue: 0,
              duration: 0,
              useNativeDriver: false,
            }),
          ]),
        ),
      );
    }

    if (tier === 'platinum') {
      // Random twinkle: 6 cells flash in sequence
      twinkleAnims.forEach((t, i) => {
        const runTwinkle = () => {
          t.row = Math.floor(Math.random() * rows);
          t.col = Math.floor(Math.random() * cols);
          Animated.sequence([
            Animated.delay(i * 300 + Math.random() * 400),
            Animated.timing(t.opacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: false,
            }),
            Animated.timing(t.opacity, {
              toValue: 0,
              duration: 400,
              useNativeDriver: false,
            }),
            Animated.delay(600 + Math.random() * 800),
          ]).start(() => runTwinkle());
        };
        runTwinkle();
      });
    }

    if (tier === 'legendary') {
      // Wave pulse: sweeps across columns
      anims.push(
        Animated.loop(
          Animated.timing(waveAnim, {
            toValue: cols,
            duration: cols * 200,
            easing: Easing.linear,
            useNativeDriver: false,
          }),
        ),
      );
      // Color cycle
      anims.push(
        Animated.loop(
          Animated.timing(colorCycleAnim, {
            toValue: 1,
            duration: 3000,
            easing: Easing.linear,
            useNativeDriver: false,
          }),
        ),
      );
    }

    anims.forEach(a => a.start());
    return () => {
      anims.forEach(a => a.stop());
      twinkleAnims.forEach(t => t.opacity.stopAnimation());
    };
  }, [animate, earned, tier]);

  // ── Scan-line listener for gold ─────────────────────────────────────────
  const [scanRow, setScanRow] = React.useState(-1);
  useEffect(() => {
    if (!animate || !earned || tier !== 'gold') return;
    const id = scanAnim.addListener(({ value }) => setScanRow(Math.floor(value)));
    return () => scanAnim.removeListener(id);
  }, [animate, earned, tier]);

  // ── Wave listener for legendary ─────────────────────────────────────────
  const [waveCol, setWaveCol] = React.useState(-1);
  const [colorPhase, setColorPhase] = React.useState(0);
  useEffect(() => {
    if (!animate || !earned || tier !== 'legendary') return;
    const id1 = waveAnim.addListener(({ value }) => setWaveCol(Math.floor(value)));
    const id2 = colorCycleAnim.addListener(({ value }) => setColorPhase(value));
    return () => {
      waveAnim.removeListener(id1);
      colorCycleAnim.removeListener(id2);
    };
  }, [animate, earned, tier]);

  // ── Twinkle state for platinum ──────────────────────────────────────────
  const [twinkleState, setTwinkleState] = React.useState<{ row: number; col: number; opacity: number }[]>([]);
  useEffect(() => {
    if (!animate || !earned || tier !== 'platinum') return;
    const listeners = twinkleAnims.map((t, i) =>
      t.opacity.addListener(({ value }) => {
        setTwinkleState(prev => {
          const next = [...prev];
          next[i] = { row: t.row, col: t.col, opacity: value };
          return next;
        });
      }),
    );
    return () => {
      twinkleAnims.forEach((t, i) => t.opacity.removeListener(listeners[i]));
    };
  }, [animate, earned, tier]);

  // ── Color helpers ───────────────────────────────────────────────────────

  const LEGENDARY_COLORS = ['#00FF9C', '#00ccff', '#8B5CF6', '#ff00ff', '#ffd700', '#00FF9C'];

  function getLegendaryColor(baseColor: string, col: number): string {
    if (!animate || !earned) return baseColor;
    // Wave proximity: cells near waveCol get boosted
    const dist = Math.abs(col - waveCol);
    if (dist > 2) return baseColor;
    // Cycle through legendary palette
    const idx = Math.floor(colorPhase * LEGENDARY_COLORS.length) % LEGENDARY_COLORS.length;
    return dist === 0 ? LEGENDARY_COLORS[idx] : LEGENDARY_COLORS[(idx + 1) % LEGENDARY_COLORS.length];
  }

  function getCellColor(char: string, row: number, col: number): string | null {
    if (char === '.') return null;

    let base: string;
    switch (char) {
      case '#': base = sprite.primary; break;
      case '@': base = sprite.accent; break;
      case 'x': base = sprite.detail; break;
      default:  base = sprite.primary; break;
    }

    if (!earned) return '#333333';

    // Gold scan-line boost
    if (tier === 'gold' && animate && scanRow >= 0) {
      const dist = Math.abs(row - scanRow);
      if (dist === 0) return '#ffffff';
      if (dist === 1) return blendColor(base, '#ffffff', 0.5);
    }

    // Platinum twinkle
    if (tier === 'platinum' && animate) {
      for (const t of twinkleState) {
        if (t && t.row === row && t.col === col && t.opacity > 0.1) {
          return blendColor(base, '#ffffff', t.opacity * 0.8);
        }
      }
    }

    // Legendary wave + color cycle
    if (tier === 'legendary' && animate) {
      return getLegendaryColor(base, col);
    }

    return base;
  }

  // ── Render pixel grid ───────────────────────────────────────────────────

  const gridWidth = cols * cellSize;
  const gridHeight = rows * cellSize;

  return (
    <View style={[styles.container, { width: gridWidth, height: gridHeight }]}>
      {sprite.grid.map((rowStr, r) => (
        <View key={r} style={styles.row}>
          {rowStr.split('').map((char, c) => {
            const color = getCellColor(char, r, c);
            if (!color) {
              return <View key={c} style={{ width: cellSize, height: cellSize }} />;
            }
            return (
              <View
                key={c}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: color,
                  },
                ]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function blendColor(base: string, overlay: string, amount: number): string {
  const b = hexToRgb(base);
  const o = hexToRgb(overlay);
  if (!b || !o) return base;
  const r = Math.round(b.r + (o.r - b.r) * amount);
  const g = Math.round(b.g + (o.g - b.g) * amount);
  const bl = Math.round(b.b + (o.b - b.b) * amount);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    // Each cell is a tiny pixel block — sharp edges, no border radius
  },
});

/** Check if a badge has a pixel sprite defined */
export function hasPixelSprite(badgeId: string): boolean {
  return badgeId in SPRITES;
}
