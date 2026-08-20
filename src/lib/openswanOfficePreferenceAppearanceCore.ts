import { DEFAULT_APPEARANCE, type AgentAppearance } from './officeConfig';

const APPEARANCE_KEYS = [
  'skinTone', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor', 'shoeColor',
  'accessory', 'hat', 'expression', 'backItem', 'eyeColor', 'facialHair', 'pet',
  'aura', 'handItem',
] as const satisfies ReadonlyArray<keyof AgentAppearance>;

const COLOR_KEYS = new Set<keyof AgentAppearance>([
  'skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoeColor', 'eyeColor',
]);

const ENUMS: Partial<Record<keyof AgentAppearance, ReadonlySet<string>>> = {
  hairStyle: new Set(['flat', 'spiky', 'mohawk', 'long', 'bald', 'cap', 'curly', 'ponytail', 'buzzcut', 'afro', 'undercut', 'pigtails']),
  accessory: new Set(['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing', 'visor_shades', 'gas_mask']),
  hat: new Set(['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', 'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet', 'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes']),
  expression: new Set(['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry', 'surprised', 'smirk', 'crying']),
  backItem: new Set(['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket', 'scroll', 'boombox']),
  facialHair: new Set(['none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu', 'sideburns', 'soul_patch']),
  pet: new Set(['none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones', 'swan']),
  aura: new Set(['none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy']),
  handItem: new Set(['none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand', 'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch']),
};

const COLOR_RE = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

function isValidAppearanceValue(key: keyof AgentAppearance, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return COLOR_KEYS.has(key) ? COLOR_RE.test(value) : ENUMS[key]?.has(value) === true;
}

/** Strict model-input boundary matching the complete §45 appearance validator. */
export function normalizeOpenSwanAgentAppearancePatch(
  input: unknown,
): Partial<AgentAppearance> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length < 1 || keys.length > APPEARANCE_KEYS.length) return null;
  const normalized: Partial<AgentAppearance> = {};
  for (const rawKey of keys) {
    if (!APPEARANCE_KEYS.includes(rawKey as keyof AgentAppearance)) return null;
    const key = rawKey as keyof AgentAppearance;
    const value = source[key];
    if (!isValidAppearanceValue(key, value)) return null;
    (normalized as Record<string, string>)[key] = value as string;
  }
  return normalized;
}

/** Project one complete exact-shape value before the server validator sees it. */
export function buildOpenSwanAgentAppearance(
  existing: unknown,
  patch: Partial<AgentAppearance>,
): AgentAppearance {
  const source = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  const next = { ...DEFAULT_APPEARANCE } as AgentAppearance;
  for (const key of APPEARANCE_KEYS) {
    if (isValidAppearanceValue(key, source[key])) {
      (next as unknown as Record<string, string>)[key] = source[key] as string;
    }
    const patchValue = (patch as Record<string, unknown>)[key];
    if (isValidAppearanceValue(key, patchValue)) {
      (next as unknown as Record<string, string>)[key] = patchValue as string;
    }
  }
  return next;
}
