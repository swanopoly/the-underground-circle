// Office Customization System
import { AgentStatus } from './officeAgents';

// ─── Office Floors ───────────────────────────────────────────────────────────

export interface OfficeFloor {
  id: string;
  name: string;
  themeId: string;
  agentIds: string[]; // which agents are assigned to this floor
  furniture: FurnitureItem[];
  order: number; // for sorting floors
}

export function createDefaultFloor(id: string, name: string, themeId: string, order: number): OfficeFloor {
  return {
    id,
    name,
    themeId,
    agentIds: [],
    furniture: [],
    order,
  };
}

export const DEFAULT_FLOORS: OfficeFloor[] = [
  createDefaultFloor('floor_1', '1F - Main', 'underground', 0),
];

// ─── Office Themes ───────────────────────────────────────────────────────────

export interface OfficeTheme {
  id: string;
  name: string;
  floorColor: string;
  gridColor: string;
  wallColor: string;
  wallBorder: string;
  accentGlow: string;
  rugColor: string;
  rugBorder: string;
  deskColor: string;
  deskBorder: string;
  chairColor: string;
  chairBorder: string;
  windowSkyColor: string;
  windowCityColor: string;
}

export const OFFICE_THEMES: Record<string, OfficeTheme> = {
  underground: {
    id: 'underground',
    name: 'Underground HQ',
    floorColor: '#0a0a0f',
    gridColor: '#ffffff04',
    wallColor: '#111118',
    wallBorder: '#1a1a2e',
    accentGlow: '#6366f1',
    rugColor: '#1a0a2e',
    rugBorder: '#2d1b4e',
    deskColor: '#2a1f14',
    deskBorder: '#3d2b1a',
    chairColor: '#1a1a2e',
    chairBorder: '#2a2a3e',
    windowSkyColor: '#0a1628',
    windowCityColor: '#1a1a2e',
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Neon District',
    floorColor: '#0a0510',
    gridColor: '#ff00ff08',
    wallColor: '#120820',
    wallBorder: '#ff00ff30',
    accentGlow: '#ff00ff',
    rugColor: '#1a0020',
    rugBorder: '#ff00ff20',
    deskColor: '#1a1025',
    deskBorder: '#ff00ff40',
    chairColor: '#150a20',
    chairBorder: '#00ffff30',
    windowSkyColor: '#0a0018',
    windowCityColor: '#200040',
  },
  forest: {
    id: 'forest',
    name: 'Forest Cabin',
    floorColor: '#0d0f08',
    gridColor: '#22c55e06',
    wallColor: '#1a1810',
    wallBorder: '#2d2a1a',
    accentGlow: '#22c55e',
    rugColor: '#1a2010',
    rugBorder: '#2d3a1a',
    deskColor: '#3d2b1a',
    deskBorder: '#5a4030',
    chairColor: '#2a2015',
    chairBorder: '#3d3020',
    windowSkyColor: '#0a1810',
    windowCityColor: '#1a2a15',
  },
  arctic: {
    id: 'arctic',
    name: 'Arctic Base',
    floorColor: '#080a10',
    gridColor: '#3b82f608',
    wallColor: '#0f1218',
    wallBorder: '#3b82f630',
    accentGlow: '#3b82f6',
    rugColor: '#0a1020',
    rugBorder: '#3b82f620',
    deskColor: '#1a2030',
    deskBorder: '#2a3040',
    chairColor: '#151a25',
    chairBorder: '#2a3040',
    windowSkyColor: '#0a1828',
    windowCityColor: '#15202e',
  },
  gold: {
    id: 'gold',
    name: 'Executive Suite',
    floorColor: '#0f0d08',
    gridColor: '#f59e0b06',
    wallColor: '#1a1508',
    wallBorder: '#f59e0b30',
    accentGlow: '#f59e0b',
    rugColor: '#201a08',
    rugBorder: '#f59e0b20',
    deskColor: '#3d3020',
    deskBorder: '#5a4830',
    chairColor: '#2a2015',
    chairBorder: '#3d3020',
    windowSkyColor: '#10100a',
    windowCityColor: '#2a2010',
  },
  pirate: {
    id: 'pirate',
    name: '☠️ Pirate Ship',
    floorColor: '#1a0e06',
    gridColor: '#8b4513' + '12',
    wallColor: '#2d1a08',
    wallBorder: '#8b4513',
    accentGlow: '#f59e0b',
    rugColor: '#1a0e0a',
    rugBorder: '#8b451340',
    deskColor: '#3d2210',
    deskBorder: '#8b4513',
    chairColor: '#2a1408',
    chairBorder: '#6b3410',
    windowSkyColor: '#020814',
    windowCityColor: '#0a0d18',
  },
  enchanted: {
    id: 'enchanted',
    name: '🏰 Enchanted Castle',
    floorColor: '#0d0818',
    gridColor: '#c084fc' + '08',
    wallColor: '#180d28',
    wallBorder: '#7c3aed',
    accentGlow: '#c084fc',
    rugColor: '#1a0a30',
    rugBorder: '#7c3aed40',
    deskColor: '#2a1848',
    deskBorder: '#7c3aed',
    chairColor: '#1e1035',
    chairBorder: '#5b21b6',
    windowSkyColor: '#06001a',
    windowCityColor: '#100830',
  },
  jungle: {
    id: 'jungle',
    name: '🌴 Jungle Adventure',
    floorColor: '#040f04',
    gridColor: '#16a34a' + '10',
    wallColor: '#071a07',
    wallBorder: '#15803d',
    accentGlow: '#4ade80',
    rugColor: '#051505',
    rugBorder: '#15803d40',
    deskColor: '#1a3d10',
    deskBorder: '#15803d',
    chairColor: '#0f2e0f',
    chairBorder: '#166534',
    windowSkyColor: '#02100a',
    windowCityColor: '#041a0a',
  },
  space: {
    id: 'space',
    name: '🚀 Space Station',
    floorColor: '#02020a',
    gridColor: '#3b82f6' + '08',
    wallColor: '#05050f',
    wallBorder: '#1e40af',
    accentGlow: '#60a5fa',
    rugColor: '#030310',
    rugBorder: '#1e3a8a40',
    deskColor: '#0d1424',
    deskBorder: '#1e40af',
    chairColor: '#080d1a',
    chairBorder: '#1e3a8a',
    windowSkyColor: '#00000d',
    windowCityColor: '#020210',
  },
  haunted: {
    id: 'haunted',
    name: '👻 Haunted Mansion',
    floorColor: '#090409',
    gridColor: '#6b21a8' + '10',
    wallColor: '#120812',
    wallBorder: '#581c87',
    accentGlow: '#a855f7',
    rugColor: '#0d040d',
    rugBorder: '#6b21a840',
    deskColor: '#1e0e1e',
    deskBorder: '#6b21a8',
    chairColor: '#160a16',
    chairBorder: '#4a0e4a',
    windowSkyColor: '#060008',
    windowCityColor: '#0d000d',
  },
  underwater: {
    id: 'underwater',
    name: '🐠 Underwater Lab',
    floorColor: '#010a10',
    gridColor: '#0891b2' + '10',
    wallColor: '#021018',
    wallBorder: '#0e7490',
    accentGlow: '#22d3ee',
    rugColor: '#011018',
    rugBorder: '#0e749040',
    deskColor: '#0a1e28',
    deskBorder: '#0e7490',
    chairColor: '#061418',
    chairBorder: '#0c5f72',
    windowSkyColor: '#000d14',
    windowCityColor: '#011220',
  },
  lava: {
    id: 'lava',
    name: '🌋 Volcano Lair',
    floorColor: '#0f0200',
    gridColor: '#dc2626' + '08',
    wallColor: '#1a0500',
    wallBorder: '#b91c1c',
    accentGlow: '#f97316',
    rugColor: '#1a0400',
    rugBorder: '#b91c1c40',
    deskColor: '#2d0a00',
    deskBorder: '#b91c1c',
    chairColor: '#1e0500',
    chairBorder: '#7f1d1d',
    windowSkyColor: '#0d0100',
    windowCityColor: '#1a0300',
  },
};

// ─── Agent Appearance ────────────────────────────────────────────────────────

export interface AgentAppearance {
  skinTone: string;
  hairStyle: 'flat' | 'spiky' | 'mohawk' | 'long' | 'bald' | 'cap';
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'bowtie' | 'scarf' | 'hoodie';
  hat: 'none' | 'cap' | 'tophat' | 'beanie' | 'crown';
  expression: 'neutral' | 'happy' | 'focused' | 'sleepy' | 'cool';
}

export const SKIN_TONES = ['#f5d0a9', '#e8b88a', '#c68642', '#8d5524', '#4a2c0a', '#f5e6cc'];
export const HAIR_COLORS = ['#1a1a1a', '#4a3728', '#8b6914', '#c41e3a', '#2563eb', '#9333ea', '#22c55e', '#f59e0b', '#ec4899', '#ffffff'];
export const SHIRT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#64748b'];

export const DEFAULT_APPEARANCE: AgentAppearance = {
  skinTone: '#f5d0a9',
  hairStyle: 'flat',
  hairColor: '#1a1a1a',
  shirtColor: '#6366f1',
  pantsColor: '#2d2d3d',
  accessory: 'none',
  hat: 'none',
  expression: 'neutral',
};

// ─── Office Layout ───────────────────────────────────────────────────────────

export type FurnitureType =
  | 'desk' | 'plant' | 'couch' | 'lamp' | 'bookshelf' | 'whiteboard'
  | 'server' | 'coffee' | 'watercooler' | 'arcade'
  | 'tv' | 'pingtable' | 'snackbar' | 'neonsign' | 'rug'
  | 'safe' | 'trophy' | 'standingdesk' | 'beanbag' | 'printer' | 'clock' | 'window';

export interface FurnitureItem {
  id: string;
  type: FurnitureType;
  x: number;
  y: number;
  rotation?: number;
  label?: string; // custom label (e.g. neon sign text)
}

export interface FurnitureCatalogEntry {
  type: FurnitureType;
  name: string;
  icon: string;
  width: number;
  height: number;
  category: 'work' | 'lounge' | 'decor' | 'tech';
  description: string;
}

export const FURNITURE_CATALOG: FurnitureCatalogEntry[] = [
  // Work
  { type: 'desk',        name: 'Desk',           icon: '🖥',  width: 100, height: 50,  category: 'work',   description: 'Standard workstation' },
  { type: 'standingdesk',name: 'Standing Desk',  icon: '📐',  width: 90,  height: 55,  category: 'work',   description: 'Ergonomic standing desk' },
  { type: 'whiteboard',  name: 'Whiteboard',     icon: '📋',  width: 120, height: 60,  category: 'work',   description: 'Planning board' },
  { type: 'printer',     name: 'Printer',        icon: '🖨',  width: 40,  height: 30,  category: 'work',   description: 'Network printer' },
  { type: 'server',      name: 'Server Rack',    icon: '🗄',  width: 50,  height: 60,  category: 'tech',   description: 'Hosts all the agents' },
  // Lounge
  { type: 'couch',       name: 'Couch',          icon: '🛋',  width: 80,  height: 40,  category: 'lounge', description: 'Chill zone seating' },
  { type: 'beanbag',     name: 'Bean Bag',       icon: '⬡',   width: 35,  height: 35,  category: 'lounge', description: 'Low-key seating' },
  { type: 'pingtable',   name: 'Ping Pong',      icon: '🏓',  width: 100, height: 50,  category: 'lounge', description: 'Team ping pong table' },
  { type: 'snackbar',    name: 'Snack Bar',      icon: '🍕',  width: 70,  height: 40,  category: 'lounge', description: 'Keep the team fueled' },
  { type: 'arcade',      name: 'Arcade',         icon: '🕹',  width: 30,  height: 50,  category: 'lounge', description: 'Retro arcade machine' },
  // Tech & decor
  { type: 'tv',          name: 'Big Screen TV',  icon: '📺',  width: 80,  height: 50,  category: 'tech',   description: 'Dashboard display' },
  { type: 'coffee',      name: 'Coffee Machine', icon: '☕',  width: 30,  height: 30,  category: 'lounge', description: 'Fuel for the grind' },
  { type: 'watercooler', name: 'Water Cooler',   icon: '💧',  width: 20,  height: 35,  category: 'lounge', description: 'Hydration station' },
  // Decor
  { type: 'plant',       name: 'Plant',          icon: '🌿',  width: 30,  height: 40,  category: 'decor',  description: 'Adds life to the office' },
  { type: 'lamp',        name: 'Floor Lamp',     icon: '💡',  width: 20,  height: 50,  category: 'decor',  description: 'Mood lighting' },
  { type: 'bookshelf',   name: 'Bookshelf',      icon: '📚',  width: 60,  height: 40,  category: 'decor',  description: 'Knowledge hub' },
  { type: 'rug',         name: 'Rug',            icon: '⬜',  width: 80,  height: 50,  category: 'decor',  description: 'Defines a space' },
  { type: 'neonsign',    name: 'Neon Sign',      icon: '✦',   width: 60,  height: 25,  category: 'decor',  description: 'Custom neon text' },
  { type: 'trophy',      name: 'Trophy Shelf',   icon: '🏆',  width: 50,  height: 40,  category: 'decor',  description: 'Show your wins' },
  { type: 'safe',        name: 'Safe',           icon: '🔒',  width: 30,  height: 35,  category: 'tech',   description: 'Secure vault' },
  { type: 'clock',       name: 'Wall Clock',     icon: '🕐',  width: 25,  height: 25,  category: 'decor',  description: 'Always be on time' },
  { type: 'window',      name: 'Window',         icon: '🪟',  width: 60,  height: 40,  category: 'decor',  description: 'Let the light in' },
];

// ─── OpenClaw Connection ─────────────────────────────────────────────────────

export interface OpenClawConnection {
  connected: boolean;
  endpoint: string;
  apiKey: string;
  lastPing: number | null;
  sessions: OpenClawSession[];
}

export interface OpenClawSession {
  id: string;
  kind: string;
  label: string;
  model: string;
  status: 'active' | 'idle' | 'completed';
  lastMessage: string;
  messageCount: number;
  createdAt: number;
  costEstimate: number;
}

export const DEFAULT_CONNECTION: OpenClawConnection = {
  connected: false,
  endpoint: 'http://localhost:3000',
  apiKey: '',
  lastPing: null,
  sessions: [],
};
