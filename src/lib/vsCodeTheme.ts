/**
 * vsCodeTheme — central design tokens for the "VS Code Dark+" flavor of
 * UC's surfaces. Distinct from the default rounded-dark UC style — this
 * is the IDE-feel surface reserved for "developer console" areas:
 * memory inbox, agent run ledger, tool catalogs, terminals.
 *
 * Blend rules (per UC style guide):
 *  - Keep 2px sharp corners (VS Code signature; deviates from the
 *    default 10–12 radius used elsewhere — intentional).
 *  - Use `accent` (`#007acc`) for focus + active-tab underline.
 *  - Reserve `background` for the main canvas; `sidebar` for secondary
 *    panels; `activeSurface` for the lifted / selected element.
 *  - Monospace everywhere (this is the IDE surface).
 *  - No pure black — VS Code's darkest is `#1e1e1e` not `#000000`.
 *
 * Import from here rather than hardcoding hex values so the whole IDE
 * surface stays in lock-step if we swap themes (Monokai, Solarized, etc).
 */

import { Platform } from 'react-native';
import { SYSTEM_FONT, MONO_FONT } from './pixelDesign';

// ── Surface colors ────────────────────────────────────────────────────
// Layered backgrounds (lightest on top, darkest on bottom).
export const bg = {
  // Main editor canvas. Never go darker than this.
  editor:        '#1e1e1e',
  // Sidebar panels — slightly lighter than the editor to show hierarchy.
  sidebar:       '#252526',
  // Tab strip + title bar.
  tabStrip:      '#2d2d30',
  // Hover state for interactive rows.
  hover:         '#2a2d2e',
  // Selected row / active row highlight (subtle).
  selection:     '#094771',
  // Status bar at the bottom of the window.
  statusBar:     '#007acc',
  // Status bar when unfocused / idle.
  statusBarIdle: '#16825d',
  // Input fields.
  input:         '#3c3c3c',
  // Command-palette / dropdown / modal lift.
  dropdown:      '#252526',
} as const;

// ── Borders ───────────────────────────────────────────────────────────
export const border = {
  // Default 1px border between panels.
  default:       '#3c3c3c',
  // Slightly more visible border for focus/active.
  focus:         '#007acc',
  // Subtle divider inside a panel.
  subtle:        '#2d2d30',
} as const;

// ── Text ─────────────────────────────────────────────────────────────
export const text = {
  // Primary editor text.
  primary:       '#d4d4d4',
  // Secondary UI text (labels, chips).
  secondary:     '#cccccc',
  // Muted / disabled / placeholder.
  muted:         '#858585',
  // Faint metadata.
  faint:         '#6a6a6a',
  // Inverted (on blue status bar / buttons).
  onAccent:      '#ffffff',
} as const;

// ── Accents (VS Code Dark+ semantic palette) ─────────────────────────
// These are the same colors VS Code uses to highlight tokens in
// syntax highlighting. Reusing them for badges / chip colors keeps
// the surface feeling native to the IDE family.
export const accent = {
  // Default "active" / focus accent — the signature VS Code blue.
  blue:          '#007acc',
  // Used for key phrases / important actions. VS Code's keyword color.
  purple:        '#c586c0',
  // Strings / success / green.
  green:         '#89d185',
  // Numbers / constants / cyan.
  cyan:          '#4fc1ff',
  // Functions / calls. VS Code's yellow.
  yellow:        '#dcdcaa',
  // Types / classes. VS Code's teal.
  teal:          '#4ec9b0',
  // Warnings / attention.
  orange:        '#ce9178',
  // Errors.
  red:           '#f48771',
  // Strong error (bg).
  redStrong:     '#f14c4c',
} as const;

// ── Radius ────────────────────────────────────────────────────────────
// VS Code uses 2px corners for most inputs/buttons, 0 for tabs/strips.
export const radius = {
  sharp:  0,
  subtle: 2,
  // Slightly softer for buttons that need to feel tappable (mobile).
  button: 4,
} as const;

// ── Font ──────────────────────────────────────────────────────────────
// Re-exports from the app-level theme (pixelDesign.ts) so there's one
// source of truth. The IDE surface uses the mono stack for most chrome
// but the system UI stack is available for breadcrumb / status-bar meta.
export const font = {
  mono: MONO_FONT,
  ui:   SYSTEM_FONT,
} as const;

// ── Shadows ──────────────────────────────────────────────────────────
// VS Code modals use a subtle scrim + 1px white-outline lift.
export const shadow = {
  modalScrim: 'rgba(0, 0, 0, 0.6)',
  modalLift:  Platform.OS === 'web'
    ? ('0 0 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)' as any)
    : undefined,
} as const;

// ── Kind → accent mapping ────────────────────────────────────────────
// For memory kinds, agent sources, etc. Maps domain tokens to the
// syntax-highlight palette above so the surface feels native.
export function kindAccent(kind: string | null | undefined): string {
  switch (String(kind || '').toLowerCase()) {
    case 'preference': return accent.purple;
    case 'fact':       return accent.cyan;
    case 'decision':   return accent.yellow;
    case 'finding':    return accent.green;
    case 'instruction':return accent.purple;
    case 'policy':     return accent.blue;
    case 'context':    return text.muted;
    case 'error':      return accent.red;
    case 'warning':    return accent.orange;
    case 'success':    return accent.green;
    default:           return text.muted;
  }
}

// ── Convenience: button variants ─────────────────────────────────────
// Composable button styles for the IDE surface. Use via style arrays
// (`[vscBtn.base, vscBtn.primary]`).
export const vscBtn = {
  base: {
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  primary: {
    backgroundColor: accent.blue,
    borderColor: accent.blue,
  },
  secondary: {
    backgroundColor: bg.sidebar,
    borderColor: border.default,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: border.default,
  },
  danger: {
    backgroundColor: bg.sidebar,
    borderColor: accent.red + '88',
  },
} as const;
