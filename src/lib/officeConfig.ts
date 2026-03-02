// Office Customization System
import { AgentStatus } from './officeAgents';

// Owner email for exclusive features (space helmet, lightsaber)
export const OWNER_EMAIL = 'chrisswanson189@gmail.com';

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

export type EnvironmentType = 'office' | 'ship' | 'castle' | 'station' | 'submarine' | 'mansion' | 'lair' | 'cabin' | 'temple' | 'garden' | 'cyber' | 'arctic';

export interface OfficeTheme {
  id: string;
  name: string;
  environmentType: EnvironmentType;
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
    environmentType: 'office',
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
    environmentType: 'office',
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
    environmentType: 'cabin',
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
    environmentType: 'office',
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
    environmentType: 'office',
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
    environmentType: 'ship',
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
    environmentType: 'castle',
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
    environmentType: 'cabin',
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
    environmentType: 'station',
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
    environmentType: 'mansion',
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
    environmentType: 'submarine',
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
    environmentType: 'lair',
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
  temple: {
    id: 'temple',
    name: '🏛️ Ancient Temple',
    environmentType: 'temple',
    floorColor: '#120c08',
    gridColor: '#d4a01706',
    wallColor: '#1e1608',
    wallBorder: '#3d2c14',
    accentGlow: '#d4a017',
    rugColor: '#1a0c04',
    rugBorder: '#d4a01730',
    deskColor: '#2a1e0a',
    deskBorder: '#5a4020',
    chairColor: '#1e1608',
    chairBorder: '#3d2c14',
    windowSkyColor: '#0a0618',
    windowCityColor: '#3d1a6e',
  },
  greenhouse: {
    id: 'greenhouse',
    name: '🌿 Rooftop Greenhouse',
    environmentType: 'garden',
    floorColor: '#0d1a08',
    gridColor: '#22c55e08',
    wallColor: '#0a1a0a',
    wallBorder: '#4a8a5a',
    accentGlow: '#22c55e',
    rugColor: '#1a2a10',
    rugBorder: '#22c55e30',
    deskColor: '#2a3d1a',
    deskBorder: '#4a6a2a',
    chairColor: '#1a2a10',
    chairBorder: '#2a4a18',
    windowSkyColor: '#87ceeb20',
    windowCityColor: '#4a8a5a20',
  },
  cyberden: {
    id: 'cyberden',
    name: '🤖 Cyber Den',
    environmentType: 'cyber',
    floorColor: '#050008',
    gridColor: '#ff00ff06',
    wallColor: '#0d0020',
    wallBorder: '#ff00ff40',
    accentGlow: '#ff00ff',
    rugColor: '#0a0020',
    rugBorder: '#ff00ff25',
    deskColor: '#150030',
    deskBorder: '#ff00ff50',
    chairColor: '#0a0020',
    chairBorder: '#00ffff30',
    windowSkyColor: '#000010',
    windowCityColor: '#1a0030',
  },
  icebase: {
    id: 'icebase',
    name: '❄️ Ice Research Station',
    environmentType: 'arctic',
    floorColor: '#08101c',
    gridColor: '#3b82f608',
    wallColor: '#0f1c2a',
    wallBorder: '#2a4060',
    accentGlow: '#38bdf8',
    rugColor: '#0a1828',
    rugBorder: '#3b82f625',
    deskColor: '#1a2c40',
    deskBorder: '#2a4060',
    chairColor: '#101828',
    chairBorder: '#1e3050',
    windowSkyColor: '#000814',
    windowCityColor: '#0a1828',
  },
};

// ─── Agent Appearance ────────────────────────────────────────────────────────

export interface AgentAppearance {
  skinTone: string;
  hairStyle: 'flat' | 'spiky' | 'mohawk' | 'long' | 'bald' | 'cap' | 'curly' | 'ponytail';
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
  shoeColor: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'bowtie' | 'scarf' | 'hoodie' | 'mask' | 'monocle' | 'eyepatch' | 'bandana';
  hat: 'none' | 'cap' | 'tophat' | 'beanie' | 'crown' | 'helmet' | 'horns' | 'space_helmet' | 'wizard_hat' | 'halo' | 'antenna';
  expression: 'neutral' | 'happy' | 'focused' | 'sleepy' | 'cool' | 'angry';
  backItem: 'none' | 'cape' | 'backpack' | 'wings' | 'jetpack' | 'shield' | 'sword' | 'quiver';
  eyeColor: string;
  facialHair: 'none' | 'stubble' | 'beard' | 'mustache' | 'goatee';
  pet: 'none' | 'cat' | 'dog' | 'bird' | 'robot' | 'dragon' | 'alien';
  aura: 'none' | 'fire' | 'ice' | 'electric' | 'nature' | 'shadow' | 'rainbow' | 'glitch' | 'cosmic';
  handItem: 'none' | 'lightsaber' | 'coffee' | 'laptop' | 'flag' | 'wand';
}

export const SKIN_TONES = ['#f5d0a9', '#e8b88a', '#c68642', '#8d5524', '#4a2c0a', '#f5e6cc'];
export const HAIR_COLORS = ['#1a1a1a', '#4a3728', '#8b6914', '#c41e3a', '#2563eb', '#9333ea', '#22c55e', '#f59e0b', '#ec4899', '#ffffff'];
export const SHIRT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#64748b'];
export const PANTS_COLORS = ['#2d2d3d', '#1a1a2e', '#3d2b1a', '#1e3a5f', '#2d1b4e', '#1a3d1a'];
export const SHOE_COLORS = ['#1a1a1a', '#4a3728', '#2d2d3d', '#8b4513', '#ef4444', '#ffffff'];
export const EYE_COLORS = ['#1a1a1a', '#4a3728', '#2563eb', '#22c55e', '#8b5cf6', '#ef4444'];

export const DEFAULT_APPEARANCE: AgentAppearance = {
  skinTone: '#f5d0a9',
  hairStyle: 'flat',
  hairColor: '#1a1a1a',
  shirtColor: '#6366f1',
  pantsColor: '#2d2d3d',
  shoeColor: '#1a1a1a',
  accessory: 'none',
  hat: 'none',
  expression: 'neutral',
  backItem: 'none',
  eyeColor: '#1a1a1a',
  facialHair: 'none',
  pet: 'none',
  aura: 'none',
  handItem: 'none',
};

// Default appearance for the built-in BlackSwan agent
export const UC_AGENT_APPEARANCE: AgentAppearance = {
  skinTone: '#c4956a',
  hairStyle: 'spiky',
  hairColor: '#a855f7',
  shirtColor: '#0d0d14',
  pantsColor: '#1a1a2e',
  shoeColor: '#a855f7',
  accessory: 'glasses',
  hat: 'none',
  expression: 'cool',
  backItem: 'none',
  eyeColor: '#a855f7',
  facialHair: 'none',
  pet: 'robot',
  aura: 'electric',
  handItem: 'none',
};

// ─── Office Layout ───────────────────────────────────────────────────────────

export type FurnitureType =
  | 'desk' | 'plant' | 'couch' | 'lamp' | 'bookshelf' | 'whiteboard'
  | 'server' | 'coffee' | 'watercooler' | 'arcade'
  | 'tv' | 'pingtable' | 'snackbar' | 'neonsign' | 'rug'
  | 'safe' | 'trophy' | 'standingdesk' | 'beanbag' | 'printer' | 'clock' | 'window'
  | 'nft_frame';

export interface FurnitureItem {
  id: string;
  type: FurnitureType;
  x: number;
  y: number;
  rotation?: number;
  label?: string; // custom label (e.g. neon sign text)
  // NFT frame data
  nftMint?: string;
  nftImageUrl?: string;
  nftName?: string;
  nftChain?: 'solana' | 'ethereum';
  imageSource?: 'upload' | 'nft';
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
  { type: 'nft_frame',   name: 'Image / NFT',    icon: '🖼',  width: 80,  height: 80,  category: 'decor',  description: 'Upload image or display NFT' },
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

// ─── Custom Theme Utilities ─────────────────────────────────────────────────

export const ENVIRONMENT_OPTIONS: { value: EnvironmentType; label: string; icon: string }[] = [
  { value: 'office', label: 'Office', icon: '🏢' },
  { value: 'ship', label: 'Ship', icon: '☠️' },
  { value: 'castle', label: 'Castle', icon: '🏰' },
  { value: 'station', label: 'Station', icon: '🚀' },
  { value: 'submarine', label: 'Submarine', icon: '🐠' },
  { value: 'mansion', label: 'Mansion', icon: '👻' },
  { value: 'lair', label: 'Lair', icon: '🌋' },
  { value: 'cabin', label: 'Cabin', icon: '🌴' },
  { value: 'temple', label: 'Temple', icon: '🏛️' },
  { value: 'garden', label: 'Garden', icon: '🌿' },
  { value: 'cyber', label: 'Cyber', icon: '🤖' },
  { value: 'arctic', label: 'Arctic', icon: '❄️' },
];

export interface ThemeColorProperty {
  key: keyof Omit<OfficeTheme, 'id' | 'name' | 'environmentType'>;
  label: string;
  group: 'floor' | 'walls' | 'furniture' | 'window';
}

export const THEME_COLOR_PROPERTIES: ThemeColorProperty[] = [
  { key: 'floorColor', label: 'Floor', group: 'floor' },
  { key: 'gridColor', label: 'Grid', group: 'floor' },
  { key: 'rugColor', label: 'Rug', group: 'floor' },
  { key: 'rugBorder', label: 'Rug Border', group: 'floor' },
  { key: 'wallColor', label: 'Wall', group: 'walls' },
  { key: 'wallBorder', label: 'Wall Border', group: 'walls' },
  { key: 'accentGlow', label: 'Accent', group: 'walls' },
  { key: 'deskColor', label: 'Desk', group: 'furniture' },
  { key: 'deskBorder', label: 'Desk Border', group: 'furniture' },
  { key: 'chairColor', label: 'Chair', group: 'furniture' },
  { key: 'chairBorder', label: 'Chair Border', group: 'furniture' },
  { key: 'windowSkyColor', label: 'Sky', group: 'window' },
  { key: 'windowCityColor', label: 'Scene', group: 'window' },
];

// ─── Theme Outfits (auto-applied by environment) ────────────────────────────

export interface ThemeOutfit {
  label: string;
  headgear?: 'bandana' | 'visor' | 'goggles' | 'hood' | 'straw_hat' | 'fur_hood' | 'led_visor';
  headgearColor?: string;
  chestOverlay?: 'armor' | 'vest' | 'apron' | 'robe' | 'parka' | 'wetsuit';
  chestColor?: string;
  beltStyle?: 'utility' | 'rope';
  beltColor?: string;
  bootColor?: string;
  accentColor?: string;
  extraElement?: 'eye_patch' | 'pocket_watch' | 'scar' | 'leaf_brooch' | 'circuit_lines' | 'oxygen_tube' | 'gauntlets';
}

export const THEME_OUTFITS: Record<EnvironmentType, ThemeOutfit> = {
  office: {
    label: 'Business',
  },
  ship: {
    label: 'Pirate',
    headgear: 'bandana',
    headgearColor: '#dc2626',
    chestOverlay: 'vest',
    chestColor: '#78350f',
    extraElement: 'eye_patch',
  },
  castle: {
    label: 'Knight',
    chestOverlay: 'armor',
    chestColor: '#9ca3af',
    accentColor: '#6b7280',
    extraElement: 'gauntlets',
  },
  station: {
    label: 'Astronaut',
    headgear: 'visor',
    headgearColor: '#ffffff40',
    chestOverlay: 'vest',
    chestColor: '#e5e7eb',
    beltStyle: 'utility',
    beltColor: '#6b7280',
  },
  submarine: {
    label: 'Diver',
    headgear: 'goggles',
    headgearColor: '#0ea5e9',
    chestOverlay: 'wetsuit',
    chestColor: '#0c4a6e',
    extraElement: 'oxygen_tube',
  },
  mansion: {
    label: 'Victorian',
    chestOverlay: 'vest',
    chestColor: '#1f1f1f',
    extraElement: 'pocket_watch',
  },
  lair: {
    label: 'Villain',
    accentColor: '#450a0a',
    extraElement: 'scar',
  },
  cabin: {
    label: 'Explorer',
    chestOverlay: 'vest',
    chestColor: '#4d7c0f',
    beltStyle: 'utility',
    beltColor: '#78350f',
    bootColor: '#78350f',
  },
  temple: {
    label: 'Monk',
    headgear: 'hood',
    headgearColor: '#d4a017',
    chestOverlay: 'robe',
    chestColor: '#92711a',
    beltStyle: 'rope',
    beltColor: '#a18249',
  },
  garden: {
    label: 'Gardener',
    headgear: 'straw_hat',
    headgearColor: '#d4a017',
    chestOverlay: 'apron',
    chestColor: '#166534',
    extraElement: 'leaf_brooch',
  },
  cyber: {
    label: 'Hacker',
    headgear: 'led_visor',
    headgearColor: '#00ffff',
    accentColor: '#ff00ff',
    extraElement: 'circuit_lines',
  },
  arctic: {
    label: 'Researcher',
    headgear: 'fur_hood',
    headgearColor: '#c4b5a0',
    chestOverlay: 'parka',
    chestColor: '#1e40af',
    bootColor: '#1e3a5f',
  },
};

export const COLOR_SWATCHES: Record<string, string[]> = {
  floor: [
    '#0a0a0f', '#0f0d08', '#0d0f08', '#080a10', '#0a0510', '#090409',
    '#010a10', '#0f0200', '#04040a', '#1a0e06', '#0d0818', '#040f04',
    '#02020a', '#0c0808', '#100810', '#060a0a', '#0a0a05', '#0f0b0b',
  ],
  walls: [
    '#111118', '#1a1810', '#120820', '#0f1218', '#1a1508', '#2d1a08',
    '#180d28', '#071a07', '#05050f', '#120812', '#021018', '#1a0500',
    '#1e1e2e', '#2a2020', '#0a1a2a', '#1a0a1a', '#1a1a0a', '#0a1a0a',
  ],
  furniture: [
    '#2a1f14', '#1a1025', '#3d2b1a', '#1a2030', '#3d3020', '#3d2210',
    '#2a1848', '#1a3d10', '#0d1424', '#1e0e1e', '#0a1e28', '#2d0a00',
    '#1e1e2e', '#2d2d40', '#402020', '#204020', '#202040', '#403020',
  ],
  window: [
    '#0a1628', '#0a0018', '#0a1810', '#0a1828', '#10100a', '#020814',
    '#06001a', '#02100a', '#00000d', '#060008', '#000d14', '#0d0100',
    '#0f1628', '#0a0f20', '#140a08', '#080a14', '#0a1010', '#101008',
  ],
};
