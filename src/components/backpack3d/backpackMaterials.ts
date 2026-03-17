/**
 * backpackMaterials.ts — SolarPunk-inspired PBR material configs.
 * Organic greens + neon tech accents on dark background.
 */

// ─── SolarPunk Color Palette ─────────────────────────────────────────────────

export const SOLAR = {
  // Organic base — brighter, richer greens
  body: '#3a6b1e',        // Vibrant forest green — main backpack
  bodyDark: '#245a30',    // Deep green — pockets, depth
  strap: '#4a8030',       // Bright olive green — straps
  vine: '#5a9058',        // Lush green — vine tendrils

  // Tech accents — cranked up for POP
  neonCyan: '#00ffb0',    // Primary glow — brighter cyan-green
  neonBlue: '#00e5ff',    // Secondary glow — electric blue
  bioGlow: '#39ff14',     // Activity indicators — neon green
  gold: '#ffc93c',        // Solar panels, warm metallic — brighter gold
  copper: '#cd8032',      // Buckles, hardware — warmer

  // Supporting
  purple: '#b366ff',      // Alt accent — brighter purple
  cream: '#fffff0',       // Highlights — near white

  // Scene
  bg: '#080c14',          // Deep dark blue-black background
} as const;

// ─── Material Presets ────────────────────────────────────────────────────────

export const BAG_BODY = {
  color: SOLAR.body,
  roughness: 0.6,
  metalness: 0.1,
} as const;

export const BAG_STRAP = {
  color: SOLAR.strap,
  roughness: 0.55,
  metalness: 0.08,
} as const;

export const BAG_HARDWARE = {
  color: SOLAR.copper,
  roughness: 0.3,
  metalness: 0.8,
} as const;

export const POCKET_BASE = {
  color: '#122e18',       // Dark base — accent tint makes each pocket unique
  roughness: 0.45,
  metalness: 0.18,
} as const;

export const SCENE_BG = SOLAR.bg;
