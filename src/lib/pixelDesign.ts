/**
 * pixelDesign.ts — Pixel Art Design System
 *
 * Centralized design tokens and utilities for a pixel-art-inspired UI.
 *
 * Design philosophy (from research — eBoy, Undertale, Hyper Light Drifter, Stardew Valley):
 *   - Sharp edges, NO rounded corners (max 2px)
 *   - Stepped/blocky borders (2px solid, not 1px hairline)
 *   - Dark backgrounds with selective neon accents
 *   - Pixel-grid aligned spacing (multiples of 4px)
 *   - Text labels over emoji — use pixel-block icons instead of emoji
 *   - Subtle scanline/CRT effects for depth
 *   - Isometric influence on cards (stepped shadow)
 */

import { Platform, ViewStyle, TextStyle } from 'react-native';

// ─── Grid ─────────────────────────────────────────────────────────────────────

export const PX = 4; // Base pixel unit — all spacing in multiples of PX

export const GRID = {
  xs:   PX,       // 4
  sm:   PX * 2,   // 8
  md:   PX * 3,   // 12
  lg:   PX * 4,   // 16
  xl:   PX * 6,   // 24
  xxl:  PX * 8,   // 32
} as const;

// ─── Colors ───────────────────────────────────────────────────────────────────

export const PIXEL_COLORS = {
  // Backgrounds — matte black palette (neutral, no blue tint)
  bg0: '#111111',      // Deepest matte black
  bg1: '#000000',      // Panel / main background
  bg2: '#222222',      // Card background
  bg3: '#2a2a2a',      // Elevated surface

  // Borders
  border0: '#2a2a2a',  // Subtle
  border1: '#333333',  // Standard
  border2: '#3d3d3d',  // Emphasis

  // Text
  text0: '#fff',       // Primary
  text1: '#c0c0d0',    // Secondary
  text2: '#666680',    // Muted
  text3: '#333348',    // Ghost

  // Accent palette (neon pixel colors)
  indigo:  '#6366f1',
  green:   '#22c55e',
  amber:   '#f59e0b',
  red:     '#ef4444',
  cyan:    '#06b6d4',
  pink:    '#ec4899',
  purple:  '#8b5cf6',
  orange:  '#f97316',
  blue:    '#3b82f6',
  teal:    '#14b8a6',

  // Special
  gold:    '#b8860b',
  scanline: '#ffffff04',
} as const;

// ─── Pixel Icon Blocks ────────────────────────────────────────────────────────
//
// Instead of emoji, use small colored pixel blocks.
// Each icon is defined by a label + a color — rendered as a 2x2 or 3x3 block.

export interface PixelIcon {
  label: string;       // Single char or short text rendered inside
  color: string;       // Primary color
  bgColor: string;     // Dark tinted background
}

export const PIXEL_ICONS: Record<string, PixelIcon> = {
  cost:        { label: '$',  color: PIXEL_COLORS.amber,  bgColor: '#1a150a' },
  terminal:    { label: '>_', color: PIXEL_COLORS.green,  bgColor: '#0a1a0a' },
  traces:      { label: '?',  color: PIXEL_COLORS.cyan,   bgColor: '#0a1a1a' },
  farm:        { label: '+',  color: PIXEL_COLORS.pink,   bgColor: '#1a0a14' },
  performance: { label: '#',  color: PIXEL_COLORS.indigo, bgColor: '#0d0d1a' },
  projects:    { label: '[ ]',color: PIXEL_COLORS.orange, bgColor: '#1a100a' },
  analytics:   { label: '//', color: PIXEL_COLORS.blue,   bgColor: '#0a0d1a' },
  canvas:      { label: '[]', color: PIXEL_COLORS.purple, bgColor: '#120a1a' },
  prompts:     { label: 'P',  color: PIXEL_COLORS.teal,   bgColor: '#0a1a14' },
  // Room types
  code:        { label: '{}', color: PIXEL_COLORS.green,  bgColor: '#0a140a' },
  docs:        { label: 'D',  color: PIXEL_COLORS.blue,   bgColor: '#0a0d14' },
  chat:        { label: '..',  color: PIXEL_COLORS.cyan,   bgColor: '#0a1414' },
  config:      { label: '*',  color: PIXEL_COLORS.amber,  bgColor: '#14140a' },
} as const;

// ─── Shared Styles ────────────────────────────────────────────────────────────

/** Pixel-art card — sharp edges, stepped border, isometric shadow */
export const pixelCard: ViewStyle = {
  backgroundColor: PIXEL_COLORS.bg2,
  borderWidth: 2,
  borderColor: PIXEL_COLORS.border1,
  borderRadius: 2,
  ...Platform.select({
    web: {
      boxShadow: `${PX}px ${PX}px 0px ${PIXEL_COLORS.bg0}`,
    } as any,
    default: {
      shadowColor: PIXEL_COLORS.bg0,
      shadowOffset: { width: PX, height: PX },
      shadowOpacity: 1,
      shadowRadius: 0,
      elevation: 4,
    },
  }),
};

/** Inset panel — dark recessed area */
export const pixelInset: ViewStyle = {
  backgroundColor: PIXEL_COLORS.bg0,
  borderWidth: 2,
  borderTopColor: PIXEL_COLORS.bg0,
  borderLeftColor: PIXEL_COLORS.bg0,
  borderRightColor: PIXEL_COLORS.border1,
  borderBottomColor: PIXEL_COLORS.border1,
  borderRadius: 0,
};

/** Pixel button — raised, 3D */
export const pixelButton: ViewStyle = {
  backgroundColor: PIXEL_COLORS.bg3,
  borderWidth: 2,
  borderTopColor: PIXEL_COLORS.border2,
  borderLeftColor: PIXEL_COLORS.border2,
  borderRightColor: PIXEL_COLORS.bg0,
  borderBottomColor: PIXEL_COLORS.bg0,
  borderRadius: 0,
  paddingHorizontal: GRID.md,
  paddingVertical: GRID.sm,
};

/** Pressed pixel button — inverted 3D */
export const pixelButtonPressed: ViewStyle = {
  borderTopColor: PIXEL_COLORS.bg0,
  borderLeftColor: PIXEL_COLORS.bg0,
  borderRightColor: PIXEL_COLORS.border2,
  borderBottomColor: PIXEL_COLORS.border2,
};

/** Monospace header text */
export const pixelHeader: TextStyle = {
  color: PIXEL_COLORS.text0,
  fontSize: 14,
  fontWeight: '900',
  fontFamily: 'monospace',
  letterSpacing: 2,
  textTransform: 'uppercase',
};

/** Section label */
export const pixelLabel: TextStyle = {
  color: PIXEL_COLORS.text2,
  fontSize: 10,
  fontWeight: '700',
  fontFamily: 'monospace',
  letterSpacing: 2,
  textTransform: 'uppercase',
};

/** Body text */
export const pixelBody: TextStyle = {
  color: PIXEL_COLORS.text1,
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: 18,
};

/** Muted small text */
export const pixelMuted: TextStyle = {
  color: PIXEL_COLORS.text3,
  fontSize: 10,
  fontFamily: 'monospace',
};

// ─── Scanline overlay generator ───────────────────────────────────────────────

/** Number of scanlines for a given height */
export function scanlineCount(height: number): number {
  return Math.floor(height / 4);
}

// ─── Pixel border helper ──────────────────────────────────────────────────────

/** Create a stepped/pixelated border effect with a given accent color */
export function accentBorder(color: string): ViewStyle {
  return {
    borderWidth: 2,
    borderColor: color + '40',
    borderRadius: 2,
  };
}

/** Create a pixel icon background style */
export function iconBoxStyle(color: string, size = 32): ViewStyle {
  return {
    width: size,
    height: size,
    backgroundColor: color + '18',
    borderWidth: 2,
    borderColor: color + '30',
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
  };
}
