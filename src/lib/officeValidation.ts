// officeValidation.ts — Sanitize and validate all office customization content

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

export interface LayoutValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedLayout?: any;
}

export function validateOfficeLayout(layout: any): LayoutValidationResult {
  const errors: string[] = [];
  if (!layout) return { valid: true, errors: [], sanitizedLayout: layout };

  // Validation of untrusted input must never throw — JSON.stringify throws on a
  // circular/non-serializable layout, so fail closed instead.
  let json: string;
  try {
    json = JSON.stringify(layout);
  } catch {
    return { valid: false, errors: ['Layout is not serializable'] };
  }
  if (json.length > MAX_LAYOUT_SIZE) {
    errors.push(`Layout too large (${Math.round(json.length / 1024)}KB, max ${MAX_LAYOUT_SIZE / 1024}KB)`);
    return { valid: false, errors };
  }

  if (layout.floors && Array.isArray(layout.floors)) {
    if (layout.floors.length > MAX_FLOORS) {
      errors.push(`Too many floors (${layout.floors.length}, max ${MAX_FLOORS})`);
    }
    for (const floor of layout.floors) {
      // A null/non-object floor would crash on property access — skip it safely.
      if (!floor || typeof floor !== 'object') continue;
      if (floor.furniture && Array.isArray(floor.furniture)) {
        if (floor.furniture.length > MAX_FURNITURE_PER_FLOOR) {
          errors.push(`Too many furniture items on floor "${floor.name || 'unnamed'}" (${floor.furniture.length}, max ${MAX_FURNITURE_PER_FLOOR})`);
        }
        // Sanitize text fields on each furniture item
        for (const item of floor.furniture) {
          // A null/non-object item would crash on property access — skip it.
          if (!item || typeof item !== 'object') continue;
          if (item.label) item.label = sanitizeOfficeText(item.label, 40);
          if (item.noteText) item.noteText = sanitizeOfficeText(item.noteText, 500);
          if (item.petName) item.petName = sanitizeOfficeText(item.petName, 20);
          if (item.fortuneText) item.fortuneText = sanitizeOfficeText(item.fortuneText, 200);
          if (item.nftName) item.nftName = sanitizeOfficeText(item.nftName, 60);
          if (typeof item.nftImageUrl === 'string' && item.nftImageUrl.startsWith('data:')) {
            const imgResult = validateBase64Image(item.nftImageUrl);
            if (!imgResult.valid) item.nftImageUrl = null;
          }
          if (item.noteGifUrl) {
            const urlResult = validateOfficeUrl(item.noteGifUrl, 'noteGifUrl');
            if (!urlResult.valid) item.noteGifUrl = null;
          }
          if (item.videoCallLink) {
            const urlResult = validateOfficeUrl(item.videoCallLink, 'videoCallLink');
            if (!urlResult.valid) item.videoCallLink = null;
          }
          // tvContentUrl was the one office URL field never wired into this
          // validator, while it IS embedded in an unsandboxed iframe and
          // passed to window.open/Linking.openURL (OfficeTab.tsx:3406,3408).
          // The embed check in InteractiveFurniture is a substring test
          // (`url.includes('youtube.com/embed/')`), so
          // `javascript:/*youtube.com/embed/*/…` satisfied it and executed on
          // the app origin. Validate it like every sibling field.
          if (item.tvContentUrl) {
            const urlResult = validateOfficeUrl(item.tvContentUrl, 'tvContentUrl');
            if (!urlResult.valid) item.tvContentUrl = null;
          }
        }
      }
      if (floor.agentIds && Array.isArray(floor.agentIds)) {
        if (floor.agentIds.length > MAX_AGENTS_PER_FLOOR) {
          errors.push(`Too many agents on floor (${floor.agentIds.length}, max ${MAX_AGENTS_PER_FLOOR})`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, sanitizedLayout: layout };
}
