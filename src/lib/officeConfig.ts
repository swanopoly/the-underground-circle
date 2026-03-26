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
  createDefaultFloor('floor_1', 'Deck 1 - Bridge', 'gothic-cathedral', 0),
];

// ─── Office Themes ───────────────────────────────────────────────────────────

export type EnvironmentType = 'office' | 'ship' | 'castle' | 'station' | 'submarine' | 'mansion' | 'lair' | 'cabin' | 'temple' | 'garden' | 'cyber' | 'arctic' | 'cathedral';

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
  'gothic-cathedral': {
    id: 'gothic-cathedral',
    name: '⛪ Gothic Cathedral',
    environmentType: 'cathedral',
    floorColor: '#080608',           // Deep charcoal stone
    gridColor: '#b8860b06',          // Faint golden grid
    wallColor: '#0c0a10',            // Dark purple-black stone
    wallBorder: '#2a1f3a',           // Dim purple mortar
    accentGlow: '#b8860b',           // Dark gold / antique gold
    rugColor: '#120810',             // Deep crimson-black runner
    rugBorder: '#8b0000',            // Dark blood red
    deskColor: '#1a1018',            // Dark oak (near-black)
    deskBorder: '#2a1830',           // Purple-tinged wood grain
    chairColor: '#120a14',           // Ebony pew
    chairBorder: '#201428',          // Purple shadow
    windowSkyColor: '#0a0420',       // Deep midnight purple
    windowCityColor: '#1a0840',      // Stained glass violet
  },
  underground: {
    id: 'underground',
    name: 'Underground HQ',
    environmentType: 'office',
    floorColor: '#000000',
    gridColor: '#ffffff04',
    wallColor: '#222222',
    wallBorder: '#2a2a2a',
    accentGlow: '#6366f1',
    rugColor: '#1a0a2e',
    rugBorder: '#2d1b4e',
    deskColor: '#2a1f14',
    deskBorder: '#3d2b1a',
    chairColor: '#2a2a2a',
    chairBorder: '#333333',
    windowSkyColor: '#0a1628',
    windowCityColor: '#2a2a2a',
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
  hairStyle: 'flat' | 'spiky' | 'mohawk' | 'long' | 'bald' | 'cap' | 'curly' | 'ponytail' | 'buzzcut' | 'afro' | 'undercut' | 'pigtails';
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
  shoeColor: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'bowtie' | 'scarf' | 'hoodie' | 'mask' | 'monocle' | 'eyepatch' | 'bandana' | 'chain' | 'piercing' | 'visor_shades' | 'gas_mask';
  hat: 'none' | 'cap' | 'tophat' | 'beanie' | 'crown' | 'helmet' | 'horns' | 'space_helmet' | 'wizard_hat' | 'halo' | 'antenna' | 'crab_helmet' | 'pirate_hat' | 'cowboy_hat' | 'fez' | 'mohawk_spikes';
  expression: 'neutral' | 'happy' | 'focused' | 'sleepy' | 'cool' | 'angry' | 'surprised' | 'smirk' | 'crying';
  backItem: 'none' | 'cape' | 'backpack' | 'wings' | 'jetpack' | 'shield' | 'sword' | 'quiver' | 'crab_shell' | 'tentacles' | 'rocket' | 'scroll' | 'boombox';
  eyeColor: string;
  facialHair: 'none' | 'stubble' | 'beard' | 'mustache' | 'goatee' | 'fu_manchu' | 'sideburns' | 'soul_patch';
  pet: 'none' | 'cat' | 'dog' | 'bird' | 'robot' | 'dragon' | 'alien' | 'crab' | 'snake' | 'bat' | 'skull' | 'mushroom' | 'spider' | 'shark' | 'bones';
  aura: 'none' | 'fire' | 'ice' | 'electric' | 'nature' | 'shadow' | 'rainbow' | 'glitch' | 'cosmic' | 'toxic' | 'holy' | 'void' | 'galaxy';
  handItem: 'none' | 'lightsaber' | 'coffee' | 'laptop' | 'flag' | 'wand' | 'crab_claws' | 'sword_hand' | 'pizza' | 'microphone' | 'torch';
}

// Neon/glowing skin tones — detected in PixelAgent for glow effect
export const NEON_SKIN_TONES = ['#ff00ff', '#00ff88', '#00ffff', '#ff4444', '#ffff00', '#aa55ff'];

export const SKIN_TONES = [
  '#f5d0a9', '#e8b88a', '#c68642', '#8d5524', '#4a2c0a', '#f5e6cc',
  // Neon / glowing
  '#ff00ff', '#00ff88', '#00ffff', '#ff4444', '#ffff00', '#aa55ff',
];
export const HAIR_COLORS = ['#000000', '#4a3728', '#8b6914', '#c41e3a', '#2563eb', '#9333ea', '#22c55e', '#f59e0b', '#ec4899', '#ffffff'];
export const SHIRT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#64748b'];
export const PANTS_COLORS = ['#2d2d3d', '#2a2a2a', '#3d2b1a', '#1e3a5f', '#2d1b4e', '#1a3d1a'];
export const SHOE_COLORS = ['#000000', '#4a3728', '#2d2d3d', '#8b4513', '#ef4444', '#ffffff'];
export const EYE_COLORS = ['#000000', '#4a3728', '#2563eb', '#22c55e', '#8b5cf6', '#ef4444'];

export const DEFAULT_APPEARANCE: AgentAppearance = {
  skinTone: '#f5d0a9',
  hairStyle: 'flat',
  hairColor: '#000000',
  shirtColor: '#6366f1',
  pantsColor: '#2d2d3d',
  shoeColor: '#000000',
  accessory: 'none',
  hat: 'none',
  expression: 'neutral',
  backItem: 'none',
  eyeColor: '#000000',
  facialHair: 'none',
  pet: 'none',
  aura: 'none',
  handItem: 'none',
};

// Default appearance for the built-in BlackSwan agent (crab-red theme)
export const UC_AGENT_APPEARANCE: AgentAppearance = {
  skinTone: '#f0a0a0',       // pale crab-red skin
  hairStyle: 'bald',         // no hair
  hairColor: '#ef4444',
  shirtColor: '#1a0a0a',     // dark crimson suit
  pantsColor: '#150808',
  shoeColor: '#ef4444',      // crab-red boots
  accessory: 'mask',         // face visor
  hat: 'crab_helmet',        // crab helmet
  expression: 'cool',
  backItem: 'crab_shell',    // crab shell
  eyeColor: '#ff4444',       // bright red eyes
  facialHair: 'none',
  pet: 'crab',               // crab companion
  aura: 'fire',              // fire aura
  handItem: 'crab_claws',    // crab claws
};

// Generate a fully random appearance (for new agents or the Randomize button)
export function generateRandomAppearance(): AgentAppearance {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return {
    skinTone: pick(SKIN_TONES),
    hairStyle: pick<AgentAppearance['hairStyle']>(['flat', 'spiky', 'mohawk', 'long', 'bald', 'cap', 'curly', 'ponytail', 'buzzcut', 'afro', 'undercut', 'pigtails']),
    hairColor: pick(HAIR_COLORS),
    shirtColor: pick(SHIRT_COLORS),
    pantsColor: pick(PANTS_COLORS),
    shoeColor: pick(SHOE_COLORS),
    accessory: pick<AgentAppearance['accessory']>(['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing', 'visor_shades', 'gas_mask']),
    hat: pick<AgentAppearance['hat']>(['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', 'wizard_hat', 'halo', 'antenna', 'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes']),
    expression: pick<AgentAppearance['expression']>(['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry', 'surprised', 'smirk', 'crying']),
    backItem: pick<AgentAppearance['backItem']>(['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver', 'tentacles', 'rocket', 'scroll', 'boombox']),
    eyeColor: pick(EYE_COLORS),
    facialHair: pick<AgentAppearance['facialHair']>(['none', 'none', 'none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu', 'sideburns', 'soul_patch']),
    pet: pick<AgentAppearance['pet']>(['none', 'none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones']),
    aura: pick<AgentAppearance['aura']>(['none', 'none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy']),
    handItem: pick<AgentAppearance['handItem']>(['none', 'none', 'coffee', 'laptop', 'flag', 'wand', 'sword_hand', 'pizza', 'microphone', 'torch']),
  };
}

// ─── Office Layout ───────────────────────────────────────────────────────────

export type FurnitureType =
  | 'desk' | 'plant' | 'couch' | 'lamp' | 'bookshelf' | 'whiteboard'
  | 'server' | 'coffee' | 'watercooler' | 'arcade'
  | 'tv' | 'pingtable' | 'snackbar' | 'neonsign' | 'rug'
  | 'safe' | 'trophy' | 'standingdesk' | 'beanbag' | 'printer' | 'clock' | 'window'
  | 'nft_frame' | 'stickynote'
  | 'enter_key' | 'button_panel' | 'alarm_bell' | 'launch_pad'
  | 'jukebox' | 'dice_roller' | 'gong' | 'confetti_cannon'
  | 'timer_display' | 'scoreboard' | 'status_board' | 'command_console'
  | 'slot_machine' | 'crystal_ball' | 'mood_ring' | 'boom_box' | 'lava_lamp' | 'whack_a_mole'
  // New items
  | 'fireplace' | 'aquarium' | 'vinyl_player' | 'rain_window' | 'galaxy_orb'
  | 'zen_garden' | 'quote_board' | 'progress_bar' | 'terrarium' | 'hologram'
  | 'focus_candle' | 'pixel_display'
  // Integration items
  | 'spotify_jukebox' | 'discord_hub' | 'video_call' | 'message_board'
  | 'smart_tv' | 'weather_station' | 'twitch_stream' | 'pomodoro_room'
  | 'crypto_ticker' | 'github_feed' | 'calendar_widget' | 'world_clock'
  | 'music_visualizer' | 'figma_board' | 'email_hub'
  // Games
  | 'poker_table' | 'chess_board' | 'coin_flip' | 'connect_four' | 'trivia_screen' | 'roulette_wheel'
  | 'retro_console'
  | 'scrabble_board'
  // Farm & Pet
  | 'farm_plot' | 'office_pet'
  // AI / ML
  | 'hf_explorer' | 'hf_runner';

export interface FurnitureItem {
  id: string;
  type: FurnitureType;
  x: number;
  y: number;
  itemWidth?: number;   // user-resized width (defaults to catalog width)
  itemHeight?: number;  // user-resized height (defaults to catalog height)
  rotation?: number;
  label?: string; // custom label (e.g. neon sign text)
  // NFT frame data
  nftMint?: string;
  nftImageUrl?: string;
  nftName?: string;
  nftChain?: 'solana' | 'ethereum';
  imageSource?: 'upload' | 'nft';
  // Sticky note data
  noteText?: string;
  noteColor?: string;       // bg color of the sticky note
  noteDrawing?: string;     // base64 PNG of the drawing
  noteGifUrl?: string;      // GIF URL
  // Interactive item state
  buttonPresets?: string[];  // button_panel: array of quick-command labels
  timerEnd?: number;         // timer_display: Date.now() + duration (ms)
  lastDiceRoll?: number;     // dice_roller: last result 1-6
  jukeboxTrack?: number;     // jukebox: current track index 0-4
  slotResult?: [number, number, number]; // slot_machine column indices
  fortuneText?: string;      // crystal_ball: last fortune
  boomboxPlaying?: boolean;  // boom_box: playing state
  lavaColor?: string;        // lava_lamp: current color
  whackScore?: number;       // whack_a_mole: score
  // New item state
  fireplaceIntensity?: number;   // fireplace: 0-2 (low/med/high)
  aquariumFishCount?: number;    // aquarium: 1-8
  vinylPlaying?: boolean;        // vinyl_player: spinning state
  quoteIndex?: number;           // quote_board: current quote
  progressValue?: number;        // progress_bar: 0-100
  pixelScene?: number;           // pixel_display: scene index
  focusBurning?: boolean;        // focus_candle: lit state
  zenPattern?: number;           // zen_garden: pattern index
  hologramShape?: number;        // hologram: shape index
  aquariumFed?: number;          // aquarium: last fed timestamp
  terrariumFed?: number;         // terrarium: last fed timestamp
  terrariumCreature?: number;    // terrarium: creature variant 0-3
  // Integration item state
  spotifyConnected?: boolean;      // spotify_jukebox: OAuth connected
  spotifyTrackName?: string;       // spotify_jukebox: current track name
  spotifyArtist?: string;          // spotify_jukebox: current artist
  spotifyPlaying?: boolean;        // spotify_jukebox: playback state
  spotifyProgress?: number;        // spotify_jukebox: 0-100 playback progress
  discordConnected?: boolean;      // discord_hub: webhook connected
  discordChannel?: string;         // discord_hub: channel name
  discordStatus?: string;          // discord_hub: online/idle/dnd/offline
  discordMemberCount?: number;     // discord_hub: server member count
  videoCallActive?: boolean;       // video_call: in-call state
  videoCallProvider?: string;      // video_call: zoom/meet/teams
  videoCallLink?: string;          // video_call: meeting URL
  videoCallParticipants?: number;  // video_call: participant count
  messageSource?: string;          // message_board: imessage/sms/whatsapp
  messagePreview?: string;         // message_board: last message preview
  messageCount?: number;           // message_board: unread count
  tvApp?: string;                  // smart_tv: youtube/netflix/hulu/disney/twitch
  tvContentUrl?: string;           // smart_tv: embed/content URL
  tvWidth?: number;                // smart_tv: custom width
  tvHeight?: number;               // smart_tv: custom height
  tvPoweredOn?: boolean;           // smart_tv: power state
  weatherCity?: string;            // weather_station: city name
  weatherTemp?: number;            // weather_station: temperature
  weatherCondition?: string;       // weather_station: sunny/cloudy/rainy/snowy
  twitchChannel?: string;          // twitch_stream: channel name
  twitchLive?: boolean;            // twitch_stream: live status
  twitchViewers?: number;          // twitch_stream: viewer count
  pomodoroMinutes?: number;        // pomodoro_room: session minutes
  pomodoroBreak?: boolean;         // pomodoro_room: break or work
  pomodoroSessions?: number;       // pomodoro_room: completed sessions count
  // New connected items
  cryptoTickerCoins?: string;       // crypto_ticker: "SOL,ETH,BTC" coins to display
  cryptoTickerPrices?: string;      // crypto_ticker: "150.23,3400.11,68000.55" prices
  cryptoTickerChanges?: string;     // crypto_ticker: "+2.5,-1.2,+0.8" % changes
  githubRepo?: string;              // github_feed: "user/repo"
  githubActivity?: string;          // github_feed: recent activity summary
  githubCommits?: number;           // github_feed: commit count this week
  githubPRs?: number;               // github_feed: open PR count
  calendarEvent?: string;           // calendar_widget: next event title
  calendarTime?: string;            // calendar_widget: event time "2:00 PM"
  calendarProvider?: string;        // calendar_widget: google/outlook
  calendarEvents?: number;          // calendar_widget: events today count
  worldClockZones?: string;         // world_clock: "America/New_York,Europe/London,Asia/Tokyo"
  worldClockLabels?: string;        // world_clock: "NYC,LDN,TYO"
  musicVisualizerActive?: boolean;  // music_visualizer: playing
  musicVisualizerStyle?: number;    // music_visualizer: 0=bars, 1=wave, 2=circle
  figmaBoardUrl?: string;           // figma_board: Figma file URL
  // Email hub state
  emailProvider?: string;            // email_hub: outlook/gmail/yahoo
  emailConnected?: boolean;          // email_hub: connection status
  emailUnread?: number;              // email_hub: unread count
  emailSender?: string;              // email_hub: latest sender name
  emailSubject?: string;             // email_hub: latest subject line
  emailTime?: string;                // email_hub: latest email time
  figmaBoardConnected?: boolean;    // figma_board: connected state
  figmaBoardPreview?: string;       // figma_board: frame name
  // Game item state
  pokerChips?: number;              // poker_table: player chip count (starts 2000)
  pokerHand?: string;               // poker_table: current hand display e.g. "A♠ K♥"
  pokerPot?: number;                // poker_table: current pot size
  pokerPhase?: string;              // poker_table: waiting/deal/flop/turn/river/showdown
  pokerBetAmount?: number;          // poker_table: current bet
  pokerAction?: string;             // poker_table: last player action (fold/call/raise/check)
  pokerHandRank?: string;           // poker_table: evaluated hand name "PAIR OF ACES"
  pokerBsHandRank?: string;         // poker_table: BlackSwan hand rank at showdown
  pokerDealer?: string;             // poker_table: 'player' | 'blackswan' dealer position
  pokerHandsWon?: number;           // poker_table: total hands won
  pokerHandsPlayed?: number;        // poker_table: total hands played
  pokerBlinds?: number;             // poker_table: current blind level (25/50/100)
  pokerSolWager?: number;           // poker_table: SOL amount wagered (legacy)
  pokerCryptoType?: string;         // poker_table: SOL/ETH/BTC/USDC/MATIC
  pokerCryptoAmount?: number;       // poker_table: crypto wager amount
  pokerBlackswanEnabled?: boolean;  // poker_table: BlackSwan AI is playing
  pokerBlackswanChips?: number;     // poker_table: BlackSwan chip count
  pokerBlackswanHand?: string;      // poker_table: BlackSwan hand (hidden)
  pokerBlackswanFolded?: boolean;   // poker_table: BlackSwan folded
  pokerBlackswanLine?: string;      // poker_table: BlackSwan trash talk
  pokerPlayerCount?: number;        // poker_table: seats taken
  pokerWinnerName?: string;         // poker_table: last round winner
  pokerCommunity?: string;          // poker_table: community cards "A♠ K♥ Q♦"
  pokerPlayerTurn?: boolean;        // poker_table: true when waiting for player action
  pokerCurrentBet?: number;         // poker_table: current bet to call
  pokerPlayerBet?: number;          // poker_table: player's bet in current round
  chessPosition?: string;           // chess_board: FEN-like display state
  chessTurn?: string;               // chess_board: white/black
  chessGameOver?: boolean;          // chess_board: game ended
  chessBoard?: string;              // chess_board: 64-char board state
  chessSelected?: number;           // chess_board: selected piece index 0-63
  chessCursor?: number;             // chess_board: cursor into legal moves array
  chessLastFrom?: number;           // chess_board: last move source
  chessLastTo?: number;             // chess_board: last move dest
  chessMoveCount?: number;          // chess_board: total half-moves
  coinFlipResult?: string;          // coin_flip: heads/tails
  coinFlipStreak?: number;          // coin_flip: win streak
  coinFlipSolBet?: number;          // coin_flip: legacy SOL wager
  coinFlipCryptoType?: string;      // coin_flip: crypto type
  coinFlipCryptoAmount?: number;    // coin_flip: crypto wager
  coinFlipBlackswan?: boolean;      // coin_flip: BlackSwan is opponent
  coinFlipWins?: number;            // coin_flip: total wins
  coinFlipLosses?: number;          // coin_flip: total losses
  connectFourBoard?: string;        // connect_four: board state string
  connectFourTurn?: number;         // connect_four: 1=red, 2=yellow
  connectFourWinner?: number;       // connect_four: 0/1/2 (3=draw)
  connectFourBlackswan?: boolean;   // connect_four: BlackSwan as opponent
  connectFourCol?: number;          // connect_four: column cursor 0-6
  triviaQuestion?: string;          // trivia_screen: current question
  triviaAnswer?: number;            // trivia_screen: selected answer index
  triviaScore?: number;             // trivia_screen: streak score
  triviaCategory?: string;          // trivia_screen: tech/crypto/general
  triviaBlackswan?: boolean;        // trivia_screen: BlackSwan competing
  rouletteNumber?: number;          // roulette_wheel: last landed number
  rouletteBetType?: string;         // roulette_wheel: red/black/odd/even/number
  rouletteSpinning?: boolean;       // roulette_wheel: currently spinning
  rouletteSolBet?: number;          // roulette_wheel: legacy SOL wager
  rouletteCryptoType?: string;      // roulette_wheel: crypto type
  rouletteCryptoAmount?: number;    // roulette_wheel: crypto wager
  // Scrabble state
  scrabbleActive?: boolean;         // scrabble_board: game in progress
  scrabbleScore1?: number;          // scrabble_board: player 1 score
  scrabbleScore2?: number;          // scrabble_board: player 2 / AI score
  scrabbleTurn?: number;            // scrabble_board: 1 or 2
  scrabbleWinner?: number;          // scrabble_board: 0=playing, 1=p1, 2=p2
  scrabbleLastWord?: string;        // scrabble_board: last word played
  // Retro console state
  emulatorSystem?: string;          // retro_console: system id (gba, nes, snes, etc.)
  // Universal game state
  gameCryptoType?: string;          // any game: active crypto for wagers
  gameCryptoWager?: number;         // any game: current wager amount
  gameBlackswanActive?: boolean;    // any game: BlackSwan AI enabled
  // Farm plot state
  farmPlots?: string;               // farm_plot: 9-char string (0=empty,1=seed,2=sprout,3=growing,4=ready,5=dead)
  farmCrops?: string;               // farm_plot: 9-char crop types (t=tomato,w=wheat,p=pumpkin,c=crystal,0=none)
  farmPlantedAt?: string;           // farm_plot: JSON array of 9 timestamps
  farmWaterLevel?: number;          // farm_plot: 0-100
  farmLastWatered?: number;         // farm_plot: timestamp
  farmHarvested?: number;           // farm_plot: total harvests
  farmGold?: number;                // farm_plot: earned gold
  // Office pet state
  petType?: string;                 // office_pet: cat|dog|dragon|blob|fox
  petName?: string;                 // office_pet: custom name
  petHunger?: number;               // office_pet: 0-100 (100=full)
  petHappiness?: number;            // office_pet: 0-100
  petEnergy?: number;               // office_pet: 0-100
  petXp?: number;                   // office_pet: lifetime XP
  petStage?: string;                // office_pet: egg|baby|teen|adult|legendary
  petLastFed?: number;              // office_pet: timestamp
  petLastPlayed?: number;           // office_pet: timestamp
  petLastSlept?: number;            // office_pet: timestamp
  petMood?: string;                 // office_pet: happy|neutral|sad|sick|sleeping|dead
  petBornAt?: number;               // office_pet: timestamp
}

export type FurnitureCategory = 'games' | 'connected' | 'vibe' | 'productivity' | 'fun' | 'furniture';

export interface FurnitureCatalogEntry {
  type: FurnitureType;
  name: string;
  icon: string;
  width: number;
  height: number;
  category: FurnitureCategory;
  description: string;
}

export const FURNITURE_CATALOG: FurnitureCatalogEntry[] = [
  // ── Connected (apps, services & integrations) — first ──────────────────
  { type: 'crypto_ticker',    name: 'Crypto Ticker',    icon: '📈', width: 100, height: 50,  category: 'connected', description: 'Live SOL, ETH, BTC prices' },
  { type: 'github_feed',      name: 'GitHub Feed',      icon: '🐙', width: 90,  height: 70,  category: 'connected', description: 'Repo commits, PRs & activity' },
  { type: 'calendar_widget',  name: 'Calendar',         icon: '📅', width: 80,  height: 70,  category: 'connected', description: 'Google / Outlook next events' },
  { type: 'world_clock',      name: 'World Clock',      icon: '🌍', width: 100, height: 50,  category: 'connected', description: 'Multi-timezone display' },
  { type: 'music_visualizer', name: 'Music Visualizer', icon: '🎶', width: 90,  height: 60,  category: 'connected', description: 'Audio spectrum visualizer' },
  { type: 'figma_board',      name: 'Figma Board',      icon: '🎨', width: 100, height: 80,  category: 'connected', description: 'Preview your Figma designs' },
  { type: 'email_hub',        name: 'Email Hub',        icon: '📧', width: 85,  height: 70,  category: 'connected', description: 'Outlook / Gmail inbox at a glance' },
  { type: 'hf_explorer',      name: 'HF Explorer',      icon: 'HF', width: 90,  height: 70,  category: 'connected', description: 'Browse & add Hugging Face models and tools' },
  { type: 'hf_runner',        name: 'HF Runner',        icon: 'AI', width: 90,  height: 70,  category: 'connected', description: 'Run AI inference — images, text, translation & more' },
  { type: 'smart_tv',        name: 'Smart TV',        icon: '📺', width: 120, height: 80,  category: 'connected', description: 'Stream YouTube, Netflix, Hulu & more' },
  { type: 'spotify_jukebox', name: 'Spotify Jukebox', icon: '🎧', width: 70,  height: 90,  category: 'connected', description: 'Connect Spotify — control playback' },
  { type: 'discord_hub',     name: 'Discord Hub',     icon: '💬', width: 80,  height: 70,  category: 'connected', description: 'Connect Discord server widget' },
  { type: 'twitch_stream',   name: 'Twitch Stream',   icon: '🟣', width: 90,  height: 60,  category: 'connected', description: 'Watch or show a Twitch stream' },
  { type: 'video_call',      name: 'Video Call',      icon: '📹', width: 90,  height: 70,  category: 'connected', description: 'Start Zoom / Meet / Teams call' },
  { type: 'message_board',   name: 'Message Board',   icon: '📱', width: 60,  height: 90,  category: 'connected', description: 'View text messages & notifications' },
  { type: 'weather_station', name: 'Weather Station', icon: '🌤️', width: 60,  height: 50,  category: 'connected', description: 'Live local weather display' },
  { type: 'tv',              name: 'Dashboard TV',    icon: '🖥',  width: 80,  height: 50,  category: 'connected', description: 'Static dashboard display' },
  // ── Games (bet SOL, compete with circle) ───────────────────────────────
  { type: 'poker_table',    name: 'Poker Table',    icon: '🃏', width: 130, height: 100, category: 'games', description: '2K chips · Texas Hold\'em · bet crypto' },
  { type: 'coin_flip',      name: 'Coin Flip',      icon: '🪙', width: 60,  height: 60,  category: 'games', description: 'Flip a coin · wager SOL' },
  { type: 'roulette_wheel', name: 'Roulette',       icon: '🎡', width: 90,  height: 90,  category: 'games', description: 'Spin the wheel · bet SOL' },
  { type: 'chess_board',    name: 'Chess',           icon: '♟️', width: 90,  height: 90,  category: 'games', description: 'Classic chess match' },
  { type: 'connect_four',   name: 'Connect Four',   icon: '🔴', width: 80,  height: 80,  category: 'games', description: 'Drop chips · 4 in a row' },
  { type: 'trivia_screen',  name: 'Trivia',         icon: '🧠', width: 90,  height: 60,  category: 'games', description: 'Quick trivia rounds · streak score' },
  { type: 'retro_console',  name: 'Retro Console',  icon: '🎮', width: 100, height: 90,  category: 'games', description: 'GBA, GBC, NES, SNES, PS1 & more — load your ROMs' },
  { type: 'scrabble_board', name: 'Scrabble',       icon: '🔤', width: 100, height: 100, category: 'games', description: 'Word tiles · score big · vs BlackSwan AI' },
  { type: 'farm_plot',     name: 'Galaxy Farm',    icon: '🌌', width: 200, height: 180, category: 'games', description: 'Grow data crops on your planet · harvest stardust' },
  { type: 'office_pet',    name: 'AI Companion',   icon: '🛸', width: 140, height: 130, category: 'games', description: 'Raise a cosmic companion · feed · play · evolve' },
  // ── Vibe (aesthetic & ambient) ──────────────────────────────────────────
  { type: 'fireplace',     name: 'Fireplace',       icon: '🔥', width: 80,  height: 70,  category: 'vibe', description: 'Crackling fire with embers' },
  { type: 'aquarium',      name: 'Aquarium',        icon: '🐠', width: 90,  height: 60,  category: 'vibe', description: 'Fish tank with swimming fish' },
  { type: 'rain_window',   name: 'Rain Window',     icon: '🌧️', width: 70,  height: 50,  category: 'vibe', description: 'Rainy window — lo-fi vibes' },
  { type: 'galaxy_orb',    name: 'Galaxy Orb',      icon: '🌌', width: 50,  height: 50,  category: 'vibe', description: 'Floating galaxy sphere' },
  { type: 'terrarium',     name: 'Terrarium',       icon: '🦋', width: 60,  height: 50,  category: 'vibe', description: 'Mini garden with butterflies' },
  { type: 'zen_garden',    name: 'Zen Garden',      icon: '🪨', width: 80,  height: 50,  category: 'vibe', description: 'Rake new sand patterns' },
  { type: 'hologram',      name: 'Hologram',        icon: '🔷', width: 60,  height: 70,  category: 'vibe', description: 'Rotating holographic display' },
  { type: 'pixel_display', name: 'Pixel Display',   icon: '👾', width: 70,  height: 50,  category: 'vibe', description: 'Animated pixel art scenes' },
  { type: 'lava_lamp',     name: 'Lava Lamp',       icon: '🫧', width: 30,  height: 60,  category: 'vibe', description: 'Mesmerizing blobs' },
  { type: 'vinyl_player',  name: 'Vinyl Player',    icon: '💿', width: 60,  height: 60,  category: 'vibe', description: 'Spinning record player' },
  { type: 'focus_candle',  name: 'Focus Candle',    icon: '🕯️', width: 30,  height: 50,  category: 'vibe', description: 'Light to enter focus mode' },
  { type: 'nft_frame',     name: 'Image / NFT',     icon: '🖼',  width: 80,  height: 80,  category: 'vibe', description: 'Upload image or display NFT' },
  { type: 'neonsign',      name: 'Neon Sign',       icon: '✦',   width: 60,  height: 25,  category: 'vibe', description: 'Custom neon text' },
  // ── Productivity (work tools & tracking) ────────────────────────────────
  { type: 'pomodoro_room',   name: 'Pomodoro Room',   icon: '🍅', width: 70,  height: 60,  category: 'productivity', description: 'Focus timer with break tracking' },
  { type: 'quote_board',    name: 'Quote Board',     icon: '💬', width: 100, height: 50,  category: 'productivity', description: 'Rotating inspiration quotes' },
  { type: 'progress_bar',   name: 'Progress Bar',    icon: '📶', width: 100, height: 40,  category: 'productivity', description: 'Team task completion tracker' },
  { type: 'scoreboard',     name: 'Scoreboard',      icon: '📊', width: 100, height: 60,  category: 'productivity', description: 'Tasks completed today' },
  { type: 'status_board',   name: 'Status Board',    icon: '📋', width: 110, height: 70,  category: 'productivity', description: 'Agent status at a glance' },
  { type: 'timer_display',  name: 'Timer',           icon: '⏱',  width: 70,  height: 50,  category: 'productivity', description: '25-min pomodoro countdown' },
  { type: 'command_console',name: 'Command Console', icon: '💻', width: 90,  height: 60,  category: 'productivity', description: 'Send command to specific agent' },
  { type: 'enter_key',      name: 'Enter Key',       icon: '⏎',  width: 80,  height: 60,  category: 'productivity', description: 'Send a task to all agents' },
  { type: 'button_panel',   name: 'Button Panel',    icon: '🔘', width: 90,  height: 50,  category: 'productivity', description: 'Quick-command buttons' },
  { type: 'whiteboard',     name: 'Whiteboard',      icon: '📋', width: 120, height: 60,  category: 'productivity', description: 'Planning board' },
  { type: 'stickynote',     name: 'Sticky Note',     icon: '📝', width: 100, height: 100, category: 'productivity', description: 'Write, draw, or add GIFs' },
  // ── Fun (games & toys) ──────────────────────────────────────────────────
  { type: 'jukebox',        name: 'Jukebox',         icon: '🎵', width: 60,  height: 80,  category: 'fun', description: 'Cycle through tracks' },
  { type: 'boom_box',       name: 'Boom Box',        icon: '📻', width: 70,  height: 50,  category: 'fun', description: 'Animated equalizer' },
  { type: 'dice_roller',    name: 'Dice Roller',     icon: '🎲', width: 50,  height: 50,  category: 'fun', description: 'Roll a random number' },
  { type: 'slot_machine',   name: 'Slot Machine',    icon: '🎰', width: 60,  height: 80,  category: 'fun', description: 'Spin for a jackpot!' },
  { type: 'crystal_ball',   name: 'Crystal Ball',    icon: '🔮', width: 50,  height: 50,  category: 'fun', description: 'Reveal your fortune' },
  { type: 'whack_a_mole',   name: 'Whack-a-Mole',   icon: '🔨', width: 80,  height: 60,  category: 'fun', description: 'Mini whack game' },
  { type: 'confetti_cannon',name: 'Confetti Cannon', icon: '🎉', width: 50,  height: 60,  category: 'fun', description: 'Burst confetti on the floor' },
  { type: 'gong',           name: 'Gong',            icon: '🔊', width: 60,  height: 70,  category: 'fun', description: 'Strike for a ripple effect' },
  { type: 'alarm_bell',     name: 'Alarm Bell',      icon: '🔔', width: 50,  height: 50,  category: 'fun', description: 'Ring to get attention' },
  { type: 'launch_pad',     name: 'Launch Pad',      icon: '🚀', width: 70,  height: 70,  category: 'fun', description: 'Launch tasks to all agents' },
  { type: 'mood_ring',      name: 'Mood Ring',       icon: '💍', width: 50,  height: 50,  category: 'fun', description: 'Team vibe check' },
  { type: 'arcade',         name: 'Arcade',          icon: '🕹',  width: 30,  height: 50,  category: 'fun', description: 'Retro arcade machine' },
  { type: 'pingtable',      name: 'Ping Pong',       icon: '🏓', width: 100, height: 50,  category: 'fun', description: 'Team ping pong table' },
  // ── Furniture (office basics) ───────────────────────────────────────────
  { type: 'desk',         name: 'Desk',           icon: '🖥',  width: 100, height: 50,  category: 'furniture', description: 'Standard workstation' },
  { type: 'standingdesk', name: 'Standing Desk',  icon: '📐',  width: 90,  height: 55,  category: 'furniture', description: 'Ergonomic standing desk' },
  { type: 'couch',        name: 'Couch',          icon: '🛋',  width: 80,  height: 40,  category: 'furniture', description: 'Chill zone seating' },
  { type: 'beanbag',      name: 'Bean Bag',       icon: '⬡',   width: 35,  height: 35,  category: 'furniture', description: 'Low-key seating' },
  { type: 'server',       name: 'Server Rack',    icon: '🗄',  width: 50,  height: 60,  category: 'furniture', description: 'Hosts all the agents' },
  { type: 'printer',      name: 'Printer',        icon: '🖨',  width: 40,  height: 30,  category: 'furniture', description: 'Network printer' },
  { type: 'coffee',       name: 'Coffee Machine', icon: '☕',  width: 30,  height: 30,  category: 'furniture', description: 'Fuel for the grind' },
  { type: 'watercooler',  name: 'Water Cooler',   icon: '💧',  width: 20,  height: 35,  category: 'furniture', description: 'Hydration station' },
  { type: 'snackbar',     name: 'Snack Bar',      icon: '🍕',  width: 70,  height: 40,  category: 'furniture', description: 'Keep the team fueled' },
  { type: 'plant',        name: 'Plant',          icon: '🌿',  width: 30,  height: 40,  category: 'furniture', description: 'Adds life to the office' },
  { type: 'lamp',         name: 'Floor Lamp',     icon: '💡',  width: 20,  height: 50,  category: 'furniture', description: 'Mood lighting' },
  { type: 'bookshelf',    name: 'Bookshelf',      icon: '📚',  width: 60,  height: 40,  category: 'furniture', description: 'Knowledge hub' },
  { type: 'rug',          name: 'Rug',            icon: '⬜',  width: 80,  height: 50,  category: 'furniture', description: 'Defines a space' },
  { type: 'trophy',       name: 'Trophy Shelf',   icon: '🏆',  width: 50,  height: 40,  category: 'furniture', description: 'Show your wins' },
  { type: 'safe',         name: 'Safe',           icon: '🔒',  width: 30,  height: 35,  category: 'furniture', description: 'Secure vault' },
  { type: 'clock',        name: 'Wall Clock',     icon: '🕐',  width: 25,  height: 25,  category: 'furniture', description: 'Always be on time' },
  { type: 'window',       name: 'Window',         icon: '🪟',  width: 60,  height: 40,  category: 'furniture', description: 'Let the light in' },
];

export function isInteractiveFurniture(type: FurnitureType): boolean {
  return [
    'enter_key', 'button_panel', 'alarm_bell', 'launch_pad',
    'jukebox', 'dice_roller', 'gong', 'confetti_cannon',
    'timer_display', 'scoreboard', 'status_board', 'command_console',
    'slot_machine', 'crystal_ball', 'mood_ring', 'boom_box', 'lava_lamp', 'whack_a_mole',
    'vinyl_player', 'galaxy_orb', 'zen_garden', 'focus_candle',
    'quote_board', 'progress_bar', 'hologram', 'pixel_display',
    'spotify_jukebox', 'discord_hub', 'video_call', 'message_board',
    'smart_tv', 'weather_station', 'twitch_stream', 'pomodoro_room',
    'crypto_ticker', 'github_feed', 'calendar_widget', 'world_clock',
    'music_visualizer', 'figma_board', 'email_hub',
    'poker_table', 'chess_board', 'coin_flip', 'connect_four', 'trivia_screen', 'roulette_wheel',
    'retro_console', 'scrabble_board',
    'farm_plot', 'office_pet',
    'hf_explorer', 'hf_runner',
  ].includes(type);
}

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
    '#000000', '#0f0d08', '#0d0f08', '#080a10', '#0a0510', '#090409',
    '#010a10', '#0f0200', '#04040a', '#1a0e06', '#0d0818', '#040f04',
    '#02020a', '#0c0808', '#100810', '#060a0a', '#0a0a05', '#0f0b0b',
  ],
  walls: [
    '#222222', '#1a1810', '#120820', '#0f1218', '#1a1508', '#2d1a08',
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
