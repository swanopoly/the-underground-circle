/**
 * pixelDesign.ts — Clean Dark Design System
 *
 * Inspired by GitHub Dark / Ollama aesthetic:
 *   - Dark backgrounds with meaningful color accents
 *   - Soft rounded corners (12-16px)
 *   - System fonts for UI, monospace only for code/terminal
 *   - Minimal, spacious layout
 *   - Subtle borders at low opacity
 *   - Dark mode default
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

// ─── Colors (GitHub Dark inspired palette) ───────────────────────────────────

export const PIXEL_COLORS = {
  // Backgrounds — pure black scale
  bg0: '#000000',      // Deepest black (page bg)
  bg1: '#0a0a0a',      // Panel / main background
  bg2: '#161616',      // Card background
  bg3: '#252525',      // Elevated surface

  // Borders — white at low opacity equivalents
  border0: '#1a1a1a',  // Subtle (≈ white/7%)
  border1: '#2a2a2a',  // Standard (≈ white/10%)
  border2: '#3e3e3e',  // Emphasis (≈ white/15%)

  // Text — gray scale
  text0: '#e8e8e8',    // Primary (≈ gray-200)
  text1: '#9e9e9e',    // Secondary (≈ gray-400)
  text2: '#6f6f6f',    // Muted (≈ gray-500)
  text3: '#3e3e3e',    // Ghost (≈ gray-700)

  // Accent palette — real colors
  indigo:  '#6366f1',
  green:   '#22c55e',
  amber:   '#f59e0b',
  red:     '#ef4444',
  cyan:    '#22d3ee',
  pink:    '#ec4899',
  purple:  '#a855f7',
  orange:  '#f97316',
  blue:    '#3b82f6',
  teal:    '#14b8a6',

  // Special
  gold:    '#fbbf24',
  scanline: '#ffffff04',
} as const;

// ─── Icon Blocks ─────────────────────────────────────────────────────────────

export interface PixelIcon {
  label: string;
  color: string;
  bgColor: string;
}

export const PIXEL_ICONS: Record<string, PixelIcon> = {
  cost:        { label: '$',  color: '#22c55e', bgColor: '#161616' },
  terminal:    { label: '>_', color: '#e8e8e8', bgColor: '#161616' },
  traces:      { label: '?',  color: '#f59e0b', bgColor: '#161616' },
  farm:        { label: '+',  color: '#22c55e', bgColor: '#161616' },
  performance: { label: '#',  color: '#3b82f6', bgColor: '#161616' },
  projects:    { label: '[ ]',color: '#a855f7', bgColor: '#161616' },
  analytics:   { label: '//', color: '#6366f1', bgColor: '#161616' },
  canvas:      { label: '[]', color: '#ec4899', bgColor: '#161616' },
  prompts:     { label: 'P',  color: '#f97316', bgColor: '#161616' },
  // Room types
  code:        { label: '{}', color: '#22d3ee', bgColor: '#161616' },
  docs:        { label: 'D',  color: '#3b82f6', bgColor: '#161616' },
  chat:        { label: '..',  color: '#22c55e', bgColor: '#161616' },
  config:      { label: '*',  color: '#f59e0b', bgColor: '#161616' },
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────
// One canonical font stack for the whole app. On web we use the
// native-OS-first stack Apple's HIG recommends — SF Pro on macOS/iOS,
// Segoe UI on Windows, Roboto on Android/ChromeOS, Helvetica/Arial as
// cross-platform fallbacks. On iOS native, `System` maps to SF Pro.
// On Android native we can't negotiate a stack — just `sans-serif`.
//
// Imported by `vsCodeTheme.ts` and every component that sets fontFamily
// explicitly. The `SYSTEM_FONT_STACK_WEB` string is also injected as a
// document-level CSS rule below so any `<Text>` that DOESN'T set its
// own fontFamily inherits this stack automatically.
export const SYSTEM_FONT_STACK_WEB =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const SYSTEM_FONT = Platform.OS === 'ios'
  ? 'System'
  : Platform.OS === 'web'
    ? SYSTEM_FONT_STACK_WEB
    : 'sans-serif';

export const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Web-only side effect: set the document's default font stack on <body>
// so every `<Text>` (and every raw DOM node) inherits it unless a more
// specific rule overrides it. Monospace surfaces (IDE console, code
// blocks, budget pills) still get their own fontFamily inline.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const STYLE_ID = 'uc-system-font-stack';
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
      :root {
        --uc-font-ui:   ${SYSTEM_FONT_STACK_WEB};
        --uc-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      }
      html, body, #root, #root > div, [data-reactroot] {
        font-family: var(--uc-font-ui);
      }
      /* Let Text that doesn't set its own font inherit from body. RN Web
         otherwise falls back to the platform UA font (Times on Safari,
         Arial on Chrome Win). */
      [class*="css-text-"], [class*="r-text-"] {
        font-family: inherit;
      }
    `;
    document.head.appendChild(el);
  }
}

// ─── Shared Styles ────────────────────────────────────────────────────────────

/** Clean card — rounded, subtle border */
export const pixelCard: ViewStyle = {
  backgroundColor: PIXEL_COLORS.bg2,
  borderWidth: 1,
  borderColor: PIXEL_COLORS.border1,
  borderRadius: 16,
  ...Platform.select({
    web: {
      boxShadow: `0 1px 3px rgba(0,0,0,0.3)`,
    } as any,
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.3,
      shadowRadius: 3,
      elevation: 2,
    },
  }),
};

/** Inset panel — recessed area */
export const pixelInset: ViewStyle = {
  backgroundColor: PIXEL_COLORS.bg0,
  borderWidth: 1,
  borderColor: PIXEL_COLORS.border0,
  borderRadius: 12,
};

/** Button — clean rounded */
export const pixelButton: ViewStyle = {
  backgroundColor: PIXEL_COLORS.bg3,
  borderWidth: 1,
  borderColor: PIXEL_COLORS.border2,
  borderRadius: 12,
  paddingHorizontal: GRID.md,
  paddingVertical: GRID.sm,
};

/** Pressed button */
export const pixelButtonPressed: ViewStyle = {
  backgroundColor: PIXEL_COLORS.border1,
  borderColor: PIXEL_COLORS.border2,
};

/** Header text — system font, semibold */
export const pixelHeader: TextStyle = {
  color: PIXEL_COLORS.text0,
  fontSize: 15,
  fontWeight: '600',
  letterSpacing: -0.3,
};

/** Section label — uppercase, muted */
export const pixelLabel: TextStyle = {
  color: PIXEL_COLORS.text2,
  fontSize: 11,
  fontWeight: '600',
  letterSpacing: 0.5,
  textTransform: 'uppercase',
};

/** Body text */
export const pixelBody: TextStyle = {
  color: PIXEL_COLORS.text1,
  fontSize: 13,
  lineHeight: 20,
};

/** Muted small text */
export const pixelMuted: TextStyle = {
  color: PIXEL_COLORS.text3,
  fontSize: 11,
};

// ─── Scanline overlay generator ───────────────────────────────────────────────

/** Number of scanlines for a given height */
export function scanlineCount(height: number): number {
  return Math.floor(height / 4);
}

// ─── Border helper ───────────────────────────────────────────────────────────

/** Create a subtle rounded border with a given accent color */
export function accentBorder(color: string): ViewStyle {
  return {
    borderWidth: 1,
    borderColor: color + '30',
    borderRadius: 12,
  };
}

/** Create an icon background style */
export function iconBoxStyle(color: string, size = 32): ViewStyle {
  return {
    width: size,
    height: size,
    backgroundColor: color + '14',
    borderWidth: 1,
    borderColor: color + '20',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  };
}
