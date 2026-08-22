// officeValidation.ts — Sanitize and validate all office customization content

import {
  OFFICE_ADDON_BY_TYPE,
  OFFICE_ADDON_TYPES,
  type FurnitureItem,
  type FurnitureType,
  type OfficeFloor,
} from './officeConfig';
import {
  OFFICE_FLOOR_HEIGHT,
  OFFICE_FLOOR_WIDTH,
} from '../screens/circles/tabs/office/officeFloorLayout';

// ─── Text Sanitization ─────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  /<script/i, /javascript:/i, /data:text\/html/i, /onerror\s*=/i,
  /onload\s*=/i, /onclick\s*=/i, /onmouseover\s*=/i, /eval\s*\(/i,
  /<iframe/i, /<object/i, /<embed/i, /<svg.*onload/i,
];

export function sanitizeOfficeText(text: string, maxLength: number = 200): string {
  if (!text || typeof text !== 'string') return '';
  let clean = text;
  // Strip HTML tags and dangerous substrings repeatedly until stable. A single
  // non-global pass left later occurrences ("javascript:javascript:") behind and
  // couldn't catch patterns re-formed by an earlier removal ("<scr<script>ipt>").
  // Each pass only deletes, so `clean` strictly shrinks until nothing matches.
  let prev: string;
  do {
    prev = clean;
    clean = clean.replace(/<[^>]*>/g, '');
    for (const pattern of DANGEROUS_PATTERNS) {
      clean = clean.replace(new RegExp(pattern.source, 'gi'), '');
    }
  } while (clean !== prev);
  // Trim and limit length
  return clean.trim().slice(0, maxLength);
}

// ─── URL Validation ─────────────────────────────────────────────────────────

const URL_RULES: Record<string, RegExp> = {
  videoCallLink: /^https:\/\/(zoom\.us|meet\.google\.com|teams\.microsoft\.com|discord\.com)\//,
  figmaBoardUrl: /^https:\/\/(www\.)?figma\.com\//,
  noteGifUrl: /^https:\/\/(media\.giphy\.com|tenor\.com|i\.imgur\.com|media\.tenor\.com)\//,
  twitchChannel: /^[a-zA-Z0-9_]{1,25}$/,
  githubRepo: /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/,
  genericUrl: /^https:\/\//,
};

export function validateOfficeUrl(url: string, fieldName: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string') return { valid: false, error: 'Empty URL' };
  if (url.startsWith('javascript:') || url.startsWith('data:')) return { valid: false, error: 'Dangerous URL scheme' };
  const rule = URL_RULES[fieldName] || URL_RULES.genericUrl;
  if (!rule.test(url)) return { valid: false, error: `Invalid URL for ${fieldName}` };
  return { valid: true };
}

// ─── Base64 Image Validation ────────────────────────────────────────────────

const ALLOWED_IMAGE_PREFIXES = ['data:image/jpeg', 'data:image/png', 'data:image/gif'];
const MAX_BASE64_SIZE = 100 * 1024; // 100KB

export function validateBase64Image(base64: string): { valid: boolean; error?: string } {
  if (!base64 || typeof base64 !== 'string') return { valid: false, error: 'Empty' };
  if (!ALLOWED_IMAGE_PREFIXES.some(p => base64.startsWith(p))) {
    return { valid: false, error: 'Only JPEG, PNG, and GIF images allowed (no SVG)' };
  }
  if (base64.length > MAX_BASE64_SIZE) {
    return { valid: false, error: `Image too large (max ${MAX_BASE64_SIZE / 1024}KB)` };
  }
  return { valid: true };
}

// ─── Full Layout Validation ─────────────────────────────────────────────────

const MAX_FLOORS = 10;
const MAX_FURNITURE_PER_FLOOR = 100;
const MAX_AGENTS_PER_FLOOR = 30;
const MAX_LAYOUT_SIZE = 500 * 1024; // 500KB
const MIN_ITEM_SIZE = 16;
const MAX_ID_LENGTH = 200;

const OFFICE_ADDON_TYPE_SET: ReadonlySet<string> = new Set(OFFICE_ADDON_TYPES);
const OFFICE_DATA_STATES = new Set(['local', 'demo', 'setup', 'live', 'stale', 'error']);

const ITEM_STRING_FIELDS = new Set([
  'label', 'dataState', 'nftMint', 'nftImageUrl', 'nftName', 'nftChain', 'imageSource',
  'noteText', 'noteColor', 'noteDrawing', 'noteGifUrl', 'fortuneText', 'lavaColor',
  'spotifyTrackName', 'spotifyArtist', 'spotifyUrl', 'discordChannel', 'discordStatus',
  'discordUrl', 'videoCallProvider', 'videoCallLink', 'messageSource', 'messagePreview',
  'tvApp', 'tvContentUrl', 'weatherCity', 'weatherCondition', 'twitchChannel',
  'cryptoTickerCoins', 'cryptoTickerPrices', 'cryptoTickerChanges', 'githubRepo',
  'githubActivity', 'calendarEvent', 'calendarTime', 'calendarProvider', 'worldClockZones',
  'worldClockLabels', 'figmaBoardUrl', 'emailProvider', 'emailSender', 'emailSubject',
  'emailTime', 'figmaBoardPreview', 'pokerHand', 'pokerPhase', 'pokerAction',
  'pokerHandRank', 'pokerBsHandRank', 'pokerDealer', 'pokerCryptoType',
  'pokerBlackswanHand', 'pokerBlackswanLine', 'pokerWinnerName', 'pokerCommunity',
  'chessPosition', 'chessTurn', 'chessBoard', 'coinFlipResult', 'coinFlipCryptoType',
  'connectFourBoard', 'triviaQuestion', 'triviaCategory', 'rouletteBetType',
  'rouletteCryptoType', 'scrabbleLastWord', 'emulatorSystem', 'gameCryptoType',
  'farmPlots', 'farmCrops', 'farmPlantedAt', 'farmUpgrades', 'farmCropsGrown', 'petType', 'petName', 'petStage',
  'petMood', 'petAccessory', 'petFoodsTried', 'petAchievements', 'petQuestDay',
  'petQuestCompleted',
]);

const ITEM_NUMBER_FIELDS = new Set([
  'dataUpdatedAt', 'timerEnd', 'lastDiceRoll', 'jukeboxTrack', 'whackScore',
  'fireplaceIntensity', 'aquariumFishCount', 'quoteIndex', 'progressValue', 'pixelScene',
  'zenPattern', 'hologramShape', 'aquariumFed', 'terrariumFed', 'terrariumCreature',
  'spotifyProgress', 'discordMemberCount', 'videoCallParticipants', 'messageCount',
  'tvWidth', 'tvHeight', 'weatherTemp', 'twitchViewers', 'pomodoroMinutes',
  'pomodoroSessions', 'githubCommits', 'githubPRs', 'calendarEvents',
  'musicVisualizerStyle', 'emailUnread', 'pokerChips', 'pokerPot', 'pokerBetAmount',
  'pokerHandsWon', 'pokerHandsPlayed', 'pokerBlinds', 'pokerSolWager',
  'pokerCryptoAmount', 'pokerBlackswanChips', 'pokerPlayerCount', 'pokerCurrentBet',
  'pokerPlayerBet', 'chessSelected', 'chessCursor', 'chessLastFrom', 'chessLastTo',
  'chessMoveCount', 'coinFlipStreak', 'coinFlipSolBet', 'coinFlipCryptoAmount',
  'coinFlipWins', 'coinFlipLosses', 'connectFourTurn', 'connectFourWinner',
  'connectFourCol', 'triviaAnswer', 'triviaScore', 'rouletteNumber', 'rouletteSolBet',
  'rouletteCryptoAmount', 'scrabbleScore1', 'scrabbleScore2', 'scrabbleTurn',
  'scrabbleWinner', 'gameCryptoWager', 'farmWaterLevel', 'farmLastWatered',
  'farmHarvested', 'farmGold', 'farmFertilizerUses', 'petHunger', 'petHappiness', 'petEnergy', 'petXp',
  'petLastFed', 'petLastPlayed', 'petLastSlept', 'petBornAt', 'petCleanliness',
  'petLastCleaned', 'petGold', 'petTrickCount', 'petStreak',
]);

const ITEM_BOOLEAN_FIELDS = new Set([
  'boomboxPlaying', 'vinylPlaying', 'focusBurning', 'spotifyConnected',
  'spotifyPlaying', 'discordConnected', 'videoCallActive', 'tvPoweredOn',
  'twitchLive', 'pomodoroBreak', 'musicVisualizerActive', 'emailConnected',
  'figmaBoardConnected', 'pokerBlackswanEnabled', 'pokerBlackswanFolded',
  'pokerPlayerTurn', 'chessGameOver', 'coinFlipBlackswan', 'connectFourBlackswan',
  'triviaBlackswan', 'rouletteSpinning', 'scrabbleActive', 'gameBlackswanActive',
]);

const ITEM_URL_FIELDS: Readonly<Record<string, string>> = {
  noteGifUrl: 'noteGifUrl',
  videoCallLink: 'videoCallLink',
  tvContentUrl: 'tvContentUrl',
  figmaBoardUrl: 'figmaBoardUrl',
  spotifyUrl: 'genericUrl',
  discordUrl: 'genericUrl',
};

export interface LayoutValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedLayout?: any;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export interface OfficeFurnitureGeometryInput {
  x: number;
  y: number;
  itemWidth: number;
  itemHeight: number;
  rotation?: number;
  floorWidth?: number;
  floorHeight?: number;
  minItemSize?: number;
}

export interface OfficeFurnitureGeometry {
  x: number;
  y: number;
  itemWidth: number;
  itemHeight: number;
  rotation: number;
  rotatedWidth: number;
  rotatedHeight: number;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  const candidate = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, candidate));
}

/**
 * Keep both an item's layout box and its center-rotated visual footprint inside
 * the Office floor. React Native/CSS rotate around the center, so bounding only
 * x + width and y + height can clip a rectangular item after a 90deg rotation.
 * This pure helper is shared by hydration and every editor mutation seam.
 */
export function constrainOfficeFurnitureGeometry(
  input: OfficeFurnitureGeometryInput,
): OfficeFurnitureGeometry {
  const floorWidth = Math.max(1, Math.round(clampFinite(
    input.floorWidth ?? OFFICE_FLOOR_WIDTH,
    1,
    Number.MAX_SAFE_INTEGER,
    OFFICE_FLOOR_WIDTH,
  )));
  const floorHeight = Math.max(1, Math.round(clampFinite(
    input.floorHeight ?? OFFICE_FLOOR_HEIGHT,
    1,
    Number.MAX_SAFE_INTEGER,
    OFFICE_FLOOR_HEIGHT,
  )));
  const minItemSize = Math.max(1, Math.min(
    Math.round(clampFinite(input.minItemSize ?? MIN_ITEM_SIZE, 1, Math.min(floorWidth, floorHeight), MIN_ITEM_SIZE)),
    floorWidth,
    floorHeight,
  ));
  const rotation = Number.isFinite(input.rotation)
    ? ((Math.round(input.rotation as number) % 360) + 360) % 360
    : 0;
  let itemWidth = clampInteger(input.itemWidth, minItemSize, floorWidth);
  let itemHeight = clampInteger(input.itemHeight, minItemSize, floorHeight);

  const radians = rotation * Math.PI / 180;
  const exactTrig = (value: number) => {
    const absolute = Math.abs(value);
    if (absolute < 1e-12) return 0;
    if (Math.abs(absolute - 1) < 1e-12) return 1;
    return absolute;
  };
  const cos = exactTrig(Math.cos(radians));
  const sin = exactTrig(Math.sin(radians));
  const rotatedSize = () => ({
    width: itemWidth * cos + itemHeight * sin,
    height: itemWidth * sin + itemHeight * cos,
  });
  let rotated = rotatedSize();

  // Arbitrary saved rotations can produce a bounding box larger than the
  // floor even when each unrotated dimension is legal. Scale proportionally;
  // the normal 0/90/180/270 editor path therefore remains exact.
  const fitScale = Math.min(1, floorWidth / rotated.width, floorHeight / rotated.height);
  if (fitScale < 1) {
    itemWidth = Math.max(minItemSize, Math.floor(itemWidth * fitScale));
    itemHeight = Math.max(minItemSize, Math.floor(itemHeight * fitScale));
    rotated = rotatedSize();
  }

  // Constrain the unrotated layout box as well as the center-rotated footprint.
  // The conservative box constraint keeps persisted x/y non-negative and makes
  // legacy callers that do not understand rotation safe too.
  const minX = Math.max(0, (rotated.width - itemWidth) / 2);
  const minY = Math.max(0, (rotated.height - itemHeight) / 2);
  const maxX = Math.max(minX, Math.min(
    floorWidth - itemWidth,
    floorWidth - (rotated.width + itemWidth) / 2,
  ));
  const maxY = Math.max(minY, Math.min(
    floorHeight - itemHeight,
    floorHeight - (rotated.height + itemHeight) / 2,
  ));
  const x = clampFinite(input.x, minX, maxX, minX);
  const y = clampFinite(input.y, minY, maxY, minY);

  return {
    x,
    y,
    itemWidth,
    itemHeight,
    rotation,
    rotatedWidth: rotated.width,
    rotatedHeight: rotated.height,
  };
}

function normalizedId(value: unknown, fallback: string, used: Set<string>): string {
  const text = typeof value === 'string' ? sanitizeOfficeText(value, MAX_ID_LENGTH) : '';
  const base = (text.replace(/[^a-zA-Z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '') || fallback)
    .slice(0, MAX_ID_LENGTH);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, MAX_ID_LENGTH - tail.length)}${tail}`;
  }
  used.add(candidate);
  return candidate;
}

function sanitizeItemState(raw: Record<string, any>): Record<string, any> {
  // Rebuild from the FurnitureItem allowlist instead of spreading the saved
  // row. This strips prototype-pollution keys, obsolete plugin payloads, and
  // nested objects that no current renderer understands.
  const clean: Record<string, any> = {};

  for (const key of ITEM_STRING_FIELDS) {
    if (!(key in raw) || typeof raw[key] !== 'string') continue;
    const maxLength = key === 'nftImageUrl' || key === 'noteDrawing'
      ? MAX_BASE64_SIZE
      : key.endsWith('Url') || key.endsWith('Link')
        ? 2_048
        : key === 'noteText'
          ? 500
          : ['farmPlantedAt', 'farmUpgrades', 'farmCropsGrown', 'petFoodsTried', 'petAchievements', 'petQuestCompleted'].includes(key)
            ? 4_000
            : 240;
    clean[key] = sanitizeOfficeText(raw[key], maxLength);
  }
  for (const key of ITEM_NUMBER_FIELDS) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) clean[key] = raw[key];
  }
  for (const key of ITEM_BOOLEAN_FIELDS) {
    if (typeof raw[key] === 'boolean') clean[key] = raw[key];
  }

  if ('buttonPresets' in raw) {
    clean.buttonPresets = Array.isArray(raw.buttonPresets)
      ? raw.buttonPresets
        .filter((value: unknown): value is string => typeof value === 'string')
        .slice(0, 20)
        .map((value: string) => sanitizeOfficeText(value, 80))
        .filter(Boolean)
      : undefined;
    if (!clean.buttonPresets) delete clean.buttonPresets;
  }
  if ('slotResult' in raw) {
    clean.slotResult = Array.isArray(raw.slotResult)
      && raw.slotResult.length === 3
      && raw.slotResult.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
      ? raw.slotResult.map((value: number) => Math.round(value))
      : undefined;
    if (!clean.slotResult) delete clean.slotResult;
  }
  if (clean.dataState && !OFFICE_DATA_STATES.has(clean.dataState)) delete clean.dataState;

  if (typeof clean.nftImageUrl === 'string') {
    const result = clean.nftImageUrl.startsWith('data:')
      ? validateBase64Image(clean.nftImageUrl)
      : validateOfficeUrl(clean.nftImageUrl, 'genericUrl');
    if (!result.valid) clean.nftImageUrl = null;
  }
  if (typeof clean.noteDrawing === 'string' && !validateBase64Image(clean.noteDrawing).valid) {
    clean.noteDrawing = null;
  }
  for (const [key, rule] of Object.entries(ITEM_URL_FIELDS)) {
    if (typeof clean[key] === 'string' && !validateOfficeUrl(clean[key], rule).valid) clean[key] = null;
  }
  if (typeof clean.githubRepo === 'string' && !validateOfficeUrl(clean.githubRepo, 'githubRepo').valid) {
    clean.githubRepo = null;
  }
  if (typeof clean.twitchChannel === 'string' && !validateOfficeUrl(clean.twitchChannel, 'twitchChannel').valid) {
    clean.twitchChannel = null;
  }

  return clean;
}

function sanitizeFurniture(
  value: unknown,
  floorIndex: number,
  itemIndex: number,
  usedIds: Set<string>,
): FurnitureItem | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !OFFICE_ADDON_TYPE_SET.has(value.type)) {
    return null;
  }
  if (typeof value.x !== 'number' || !Number.isFinite(value.x)
    || typeof value.y !== 'number' || !Number.isFinite(value.y)) {
    return null;
  }

  const type = value.type as FurnitureType;
  const definition = OFFICE_ADDON_BY_TYPE[type];
  if (!definition) return null;
  const requestedWidth = typeof value.itemWidth === 'number' && Number.isFinite(value.itemWidth)
    ? value.itemWidth
    : definition.width;
  const requestedHeight = typeof value.itemHeight === 'number' && Number.isFinite(value.itemHeight)
    ? value.itemHeight
    : definition.height;
  const geometry = constrainOfficeFurnitureGeometry({
    x: value.x,
    y: value.y,
    itemWidth: requestedWidth,
    itemHeight: requestedHeight,
    rotation: typeof value.rotation === 'number' ? value.rotation : 0,
  });
  const id = normalizedId(value.id, `item_${floorIndex + 1}_${itemIndex + 1}`, usedIds);
  const clean = sanitizeItemState(value);

  return {
    ...clean,
    id,
    type,
    x: geometry.x,
    y: geometry.y,
    itemWidth: geometry.itemWidth,
    itemHeight: geometry.itemHeight,
    ...(typeof value.rotation === 'number' && Number.isFinite(value.rotation)
      ? { rotation: geometry.rotation }
      : {}),
  } as FurnitureItem;
}

export function validateOfficeLayout(layout: any): LayoutValidationResult {
  const errors: string[] = [];
  if (layout == null) return { valid: true, errors: [], sanitizedLayout: layout };

  // Validation of untrusted input must never throw — JSON.stringify throws on a
  // circular/non-serializable layout, so fail closed instead.
  let json: string | undefined;
  try {
    json = JSON.stringify(layout);
  } catch {
    return { valid: false, errors: ['Layout is not serializable'] };
  }
  if (typeof json !== 'string') {
    return { valid: false, errors: ['Layout is not a serializable object'] };
  }
  if (json.length > MAX_LAYOUT_SIZE) {
    errors.push(`Layout too large (${Math.round(json.length / 1024)}KB, max ${MAX_LAYOUT_SIZE / 1024}KB)`);
    return { valid: false, errors };
  }

  // Never sanitize the caller's live React state in place. The previous
  // implementation edited nested furniture rows while a save was in flight,
  // which could change what the user was looking at without a setState and
  // could make an older network request share references with a newer edit.
  // JSON cloning also strips prototypes/functions before this payload crosses
  // the Supabase trust boundary.
  let normalized: unknown;
  try {
    normalized = JSON.parse(json);
  } catch {
    return { valid: false, errors: ['Layout could not be normalized'] };
  }
  if (!isRecord(normalized) || !Array.isArray(normalized.floors)) {
    return { valid: false, errors: ['Layout floors must be an array'] };
  }

  if (normalized.floors.length > MAX_FLOORS) {
    errors.push(`Too many floors (${normalized.floors.length}, max ${MAX_FLOORS})`);
  }

  const usedFloorIds = new Set<string>();
  const rawToNormalizedFloorId = new Map<string, string>();
  const floors: OfficeFloor[] = [];
  for (const [floorIndex, rawFloor] of normalized.floors.slice(0, MAX_FLOORS).entries()) {
    if (!isRecord(rawFloor)) continue;

    const id = normalizedId(rawFloor.id, `floor_${floorIndex + 1}`, usedFloorIds);
    if (typeof rawFloor.id === 'string' && !rawToNormalizedFloorId.has(rawFloor.id)) {
      rawToNormalizedFloorId.set(rawFloor.id, id);
    }
    const name = sanitizeOfficeText(
      typeof rawFloor.name === 'string' ? rawFloor.name : '',
      120,
    ) || `Floor ${floorIndex + 1}`;
    const requestedTheme = sanitizeOfficeText(
      typeof rawFloor.themeId === 'string' ? rawFloor.themeId : '',
      120,
    );
    // The renderer already falls back safely for a removed/legacy theme. Keep
    // its bounded id here so a temporarily unavailable custom theme can return.
    const themeId = requestedTheme || 'underground';

    const rawAgents = Array.isArray(rawFloor.agentIds) ? rawFloor.agentIds : [];
    if (rawAgents.length > MAX_AGENTS_PER_FLOOR) {
      errors.push(`Too many agents on floor "${name}" (${rawAgents.length}, max ${MAX_AGENTS_PER_FLOOR})`);
    }
    const agentIds = Array.from(new Set(rawAgents
      .slice(0, MAX_AGENTS_PER_FLOOR)
      .map((value: unknown) => typeof value === 'string' ? sanitizeOfficeText(value, MAX_ID_LENGTH) : '')
      .map((value: string) => value.replace(/[^a-zA-Z0-9._:-]+/g, '_').replace(/^_+|_+$/g, ''))
      .filter(Boolean)));
    const agentAssignmentMode = rawFloor.agentAssignmentMode === 'manual' ? 'manual' : 'auto';

    const rawFurniture = Array.isArray(rawFloor.furniture) ? rawFloor.furniture : [];
    if (rawFurniture.length > MAX_FURNITURE_PER_FLOOR) {
      errors.push(`Too many furniture items on floor "${name}" (${rawFurniture.length}, max ${MAX_FURNITURE_PER_FLOOR})`);
    }
    const usedItemIds = new Set<string>();
    const furniture = rawFurniture
      .slice(0, MAX_FURNITURE_PER_FLOOR)
      .map((item: unknown, itemIndex: number) => sanitizeFurniture(item, floorIndex, itemIndex, usedItemIds))
      .filter((item: FurnitureItem | null): item is FurnitureItem => item !== null);

    floors.push({
      id,
      name,
      themeId,
      agentAssignmentMode,
      agentIds,
      furniture,
      order: typeof rawFloor.order === 'number' && Number.isFinite(rawFloor.order)
        ? clampInteger(rawFloor.order, 0, MAX_FLOORS - 1)
        : floorIndex,
    });
  }

  if (floors.length === 0) {
    return { valid: false, errors: [...errors, 'Layout contains no usable floors'] };
  }

  const requestedCurrentFloorId = typeof normalized.currentFloorId === 'string'
    ? normalized.currentFloorId
    : '';
  const normalizedRequestedId = sanitizeOfficeText(requestedCurrentFloorId, MAX_ID_LENGTH)
    .replace(/[^a-zA-Z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const mappedCurrentFloorId = rawToNormalizedFloorId.get(requestedCurrentFloorId)
    || floors.find((floor) => floor.id === normalizedRequestedId)?.id;
  const currentFloorId = mappedCurrentFloorId || floors[0].id;
  const updatedAt = typeof normalized.updatedAt === 'number' && Number.isFinite(normalized.updatedAt)
    ? Math.max(0, Math.floor(normalized.updatedAt))
    : 0;

  return {
    valid: errors.length === 0,
    errors,
    sanitizedLayout: { floors, currentFloorId, updatedAt },
  };
}
