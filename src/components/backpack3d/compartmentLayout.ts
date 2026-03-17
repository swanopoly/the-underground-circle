/**
 * compartmentLayout.ts — Position/geometry data for all 11 backpack compartments.
 * Maps each compartment to a physical pocket on the SolarPunk 3D backpack.
 *
 * Layout math (backpack body: w=1.8, h=2.6, depth=0.9, centered):
 *   x: [-0.9, 0.9]   y: [-1.3, 1.3]   front face z ≈ 0.45
 *
 * Front face rows (all z=0.46, verified non-overlapping):
 *   Row 0: Analytics   y[0.94, 1.06]
 *   Row 1: Trading     y[0.64, 0.88]    gap 0.06 from Analytics
 *   Row 2: Terminal    y[-0.13, 0.49]    gap 0.15 from Trading
 *   Row 3: Canvas|Projects|Performance   y[-0.75, -0.41]    gap 0.28 from Terminal
 *          x gaps between bottom pockets: 0.12 each
 *
 * DEPTH VALUES are large (0.08-0.16) so pockets visibly protrude from the bag.
 */

export type CompartmentKey =
  | 'terminal' | 'trading' | 'cost' | 'traces' | 'farm'
  | 'analytics' | 'llm-bench' | 'canvas' | 'performance'
  | 'prompts' | 'projects';

export interface CompartmentLayout {
  key: CompartmentKey;
  label: string;
  iconLabel: string;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
  geometryArgs: [number, number, number];  // width, height, depth
  hoverScale: number;
  openAnimation: 'slide-out' | 'flip-open' | 'pop' | 'drawer';
}

export const COMPARTMENT_LAYOUTS: CompartmentLayout[] = [
  // ═══ FRONT FACE (z=0.46) ═══════════════════════════════════

  // Row 0 — Analytics strip
  {
    key: 'analytics',
    label: 'Analytics',
    iconLabel: '//',
    color: '#00ffb0',
    position: [0, 1.0, 0.46],
    rotation: [0, 0, 0],
    geometryArgs: [0.9, 0.12, 0.08],
    hoverScale: 1.12,
    openAnimation: 'pop',
  },

  // Row 1 — Trading (zip pocket)
  {
    key: 'trading',
    label: 'Trading Bot',
    iconLabel: '◎',
    color: '#ffc93c',
    position: [0, 0.76, 0.46],
    rotation: [0, 0, 0],
    geometryArgs: [1.1, 0.24, 0.13],
    hoverScale: 1.1,
    openAnimation: 'flip-open',
  },

  // Row 2 — Terminal / Command Center (main pocket — deepest)
  {
    key: 'terminal',
    label: 'Command Center',
    iconLabel: '>_',
    color: '#00ffb0',
    position: [0, 0.18, 0.46],
    rotation: [0, 0, 0],
    geometryArgs: [1.2, 0.62, 0.16],
    hoverScale: 1.06,
    openAnimation: 'slide-out',
  },

  // Row 3 — Bottom pockets
  {
    key: 'canvas',
    label: 'Canvas',
    iconLabel: '::',
    color: '#b366ff',
    position: [-0.44, -0.58, 0.46],
    rotation: [0, 0, 0],
    geometryArgs: [0.38, 0.34, 0.12],
    hoverScale: 1.12,
    openAnimation: 'pop',
  },
  {
    key: 'projects',
    label: 'Projects',
    iconLabel: '[]',
    color: '#cd8032',
    position: [0, -0.58, 0.46],
    rotation: [0, 0, 0],
    geometryArgs: [0.26, 0.34, 0.10],
    hoverScale: 1.12,
    openAnimation: 'pop',
  },
  {
    key: 'performance',
    label: 'Performance',
    iconLabel: '#',
    color: '#00e5ff',
    position: [0.44, -0.58, 0.46],
    rotation: [0, 0, 0],
    geometryArgs: [0.38, 0.34, 0.12],
    hoverScale: 1.12,
    openAnimation: 'pop',
  },

  // ═══ SIDE POCKETS ══════════════════════════════════════════

  {
    key: 'cost',
    label: 'Cost Tracker',
    iconLabel: '$',
    color: '#ffc93c',
    position: [-0.95, 0.1, 0],
    rotation: [0, Math.PI / 2, 0],
    geometryArgs: [0.55, 0.65, 0.12],
    hoverScale: 1.1,
    openAnimation: 'slide-out',
  },
  {
    key: 'traces',
    label: 'Traces',
    iconLabel: '~',
    color: '#00e5ff',
    position: [0.95, 0.1, 0],
    rotation: [0, -Math.PI / 2, 0],
    geometryArgs: [0.55, 0.65, 0.12],
    hoverScale: 1.1,
    openAnimation: 'slide-out',
  },

  // ═══ TOP FLAP ══════════════════════════════════════════════

  {
    key: 'farm',
    label: 'Agent Farm',
    iconLabel: '+',
    color: '#39ff14',
    position: [0, 1.33, 0.02],
    rotation: [-0.3, 0, 0],
    geometryArgs: [1.0, 0.2, 0.08],
    hoverScale: 1.08,
    openAnimation: 'flip-open',
  },

  // ═══ BACK (laptop sleeve) ═════════════════════════════════

  {
    key: 'llm-bench',
    label: 'LLM Bench',
    iconLabel: '|=|',
    color: '#ffc93c',
    position: [0, 0.1, -0.46],
    rotation: [0, Math.PI, 0],
    geometryArgs: [1.15, 1.2, 0.10],
    hoverScale: 1.04,
    openAnimation: 'slide-out',
  },

  // ═══ BOTTOM DRAWER ════════════════════════════════════════

  {
    key: 'prompts',
    label: 'Prompts',
    iconLabel: 'P',
    color: '#00ffb0',
    position: [0, -1.08, 0.1],
    rotation: [Math.PI / 2, 0, 0],
    geometryArgs: [1.1, 0.5, 0.08],
    hoverScale: 1.06,
    openAnimation: 'drawer',
  },
];
