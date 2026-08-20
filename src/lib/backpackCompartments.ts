/**
 * Canonical Backpack dashboard inventory.
 *
 * The visual backpack, focused panel router, and smoke coverage all consume
 * this registry so a pocket cannot exist without a real destination.
 */

export type BackpackCompartmentZone =
  | 'lid'
  | 'main'
  | 'front'
  | 'side-left'
  | 'side-right'
  | 'base';

interface BackpackCompartmentShape {
  key: string;
  label: string;
  shortLabel: string;
  iconLabel: string;
  color: string;
  description: string;
  zone: BackpackCompartmentZone;
}

export const BACKPACK_COMPARTMENTS = [
  {
    key: 'knowledge',
    label: 'Knowledge System',
    shortLabel: 'Knowledge',
    iconLabel: 'KN',
    color: '#a78bfa',
    description: 'Open your graph, notes, capture tools, review queue, and agent briefs.',
    zone: 'lid',
  },
  {
    key: 'cost',
    label: 'Cost Tracker',
    shortLabel: 'Costs',
    iconLabel: '$',
    color: '#f59e0b',
    description: 'Review token-based estimated spending analytics and scoped budget alerts.',
    zone: 'side-left',
  },
  {
    key: 'terminal',
    label: 'Command Center',
    shortLabel: 'Command',
    iconLabel: '>_',
    color: '#34d399',
    description: 'Review command history and open the Office for exact-authority dispatch.',
    zone: 'main',
  },
  {
    key: 'farm',
    label: 'Agent Farm',
    shortLabel: 'Farm',
    iconLabel: 'AF',
    color: '#4ade80',
    description: 'Review live status plus directional health estimates from session telemetry.',
    zone: 'main',
  },
  {
    key: 'performance',
    label: 'Performance',
    shortLabel: 'Performance',
    iconLabel: 'PF',
    color: '#fbbf24',
    description: 'Compare directional agent metrics derived from current session telemetry.',
    zone: 'main',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    shortLabel: 'Analytics',
    iconLabel: 'AN',
    color: '#c084fc',
    description: 'Explore detailed Office analytics.',
    zone: 'main',
  },
  {
    key: 'canvas',
    label: 'Canvas',
    shortLabel: 'Canvas',
    iconLabel: 'CV',
    color: '#818cf8',
    description: 'Open the visual agent canvas.',
    zone: 'main',
  },
  {
    key: 'llm-bench',
    label: 'LLM Bench',
    shortLabel: 'LLM Bench',
    iconLabel: 'AI',
    color: '#60a5fa',
    description: 'Explore a curated model comparison reference and live model metadata.',
    zone: 'main',
  },
  {
    key: 'model-lab',
    label: 'Model Lab',
    shortLabel: 'Model Lab',
    iconLabel: 'ML',
    color: '#e879f9',
    description: 'Explore the sample training and deployment workspace preview.',
    zone: 'main',
  },
  {
    key: 'projects',
    label: 'Projects',
    shortLabel: 'Projects',
    iconLabel: '[]',
    color: '#818cf8',
    description: 'Open project rooms, shared memory, and session tags.',
    zone: 'front',
  },
  {
    key: 'prompts',
    label: 'Prompts',
    shortLabel: 'Prompts',
    iconLabel: 'PR',
    color: '#fb7185',
    description: 'Manage your prompt library.',
    zone: 'front',
  },
  {
    key: 'traces',
    label: 'Traces',
    shortLabel: 'Traces',
    iconLabel: 'TR',
    color: '#38bdf8',
    description: 'Inspect request traces and replay details.',
    zone: 'front',
  },
  {
    key: 'devices',
    label: 'Devices',
    shortLabel: 'Devices',
    iconLabel: 'IO',
    color: '#d8b4fe',
    description: 'Manage printers, 3D printers, serial, and USB devices.',
    zone: 'side-right',
  },
  {
    key: 'trading',
    label: 'Trading Bot',
    shortLabel: 'Trading',
    iconLabel: 'TB',
    color: '#2dd4bf',
    description: 'Open Solana trading, DCA, alerts, and profit tracking.',
    zone: 'base',
  },
] as const satisfies readonly BackpackCompartmentShape[];

export type BackpackCompartmentDefinition = (typeof BACKPACK_COMPARTMENTS)[number];
export type BackpackCompartmentKey = BackpackCompartmentDefinition['key'];

export const BACKPACK_COMPARTMENT_KEYS: readonly BackpackCompartmentKey[] = BACKPACK_COMPARTMENTS.map(
  compartment => compartment.key,
);

export function isBackpackCompartmentKey(value: string): value is BackpackCompartmentKey {
  return BACKPACK_COMPARTMENT_KEYS.some(key => key === value);
}
