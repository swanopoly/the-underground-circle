/**
 * buildBriefQuality — lightweight scoring for `/build-page`, `/build`, and
 * `/code` briefs so we can ask clarifying questions when the user hasn't
 * given us enough detail instead of firing a full build stream off a
 * one-word prompt.
 *
 * The goal is NOT to second-guess good briefs; it's to catch "/build-page
 * app" or "/code hello" before they turn into 30s of scaffolding noise
 * with nothing concrete to scaffold. Detailed briefs (multiple nouns,
 * specific layout, mentions pages/sections) pass through untouched.
 */

export interface BriefQuality {
  score: number;
  /** When score < threshold, UI should ask for more detail instead of building. */
  needsClarification: boolean;
  /** Short human-readable message explaining what's missing. */
  hint: string;
}

// Single words that are too vague on their own to build from.
const VAGUE_ONE_WORDERS = new Set([
  'app', 'site', 'page', 'tool', 'thing', 'feature', 'stuff',
  'idea', 'project', 'product', 'platform', 'website', 'dashboard',
  'form', 'system',
]);

// Concrete UI / structural nouns that signal the user has a shape in mind.
const STRUCTURAL_NOUNS = [
  'hero', 'navbar', 'nav', 'header', 'footer', 'sidebar',
  'section', 'card', 'grid', 'list', 'table', 'form',
  'button', 'cta', 'banner', 'tile', 'panel', 'modal',
  'feature', 'features', 'pricing', 'tier', 'plan',
  'testimonial', 'review', 'faq', 'contact',
  'login', 'signup', 'register', 'onboarding', 'checkout',
  'about', 'team', 'roadmap', 'changelog',
];

// Domain / purpose words — "for my saas", "for a podcast", etc.
const HAS_DOMAIN_CLUE = /\b(for\s+(my|a|an|the)\s+\w+|ai\s+startup|saas|podcast|blog|newsletter|agency|portfolio|coffee\s+shop|restaurant|studio|marketplace|dashboard|admin|ecommerce|commerce)\b/i;

// Style / aesthetic clues.
const HAS_STYLE_CLUE = /\b(dark|light|minimal|retro|pixel|neumorphic|brutalist|gradient|glassmorphic|terminal|monospace|neon|pastel|bold|playful|professional|corporate|editorial)\b/i;

export function analyzeBuildBrief(brief: string, kind: 'build-page' | 'build' | 'code' = 'build-page'): BriefQuality {
  const cleaned = brief.trim().toLowerCase();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  let score = 0;

  // Baseline from word count — rough bucket, not a straight multiplier.
  if (wordCount >= 20) score += 5;
  else if (wordCount >= 12) score += 4;
  else if (wordCount >= 7) score += 3;
  else if (wordCount >= 4) score += 2;
  else if (wordCount >= 2) score += 1;

  // Reject single vague nouns outright.
  if (wordCount === 1 && VAGUE_ONE_WORDERS.has(cleaned)) score -= 4;

  // Count structural nouns mentioned.
  const matchedStructural = STRUCTURAL_NOUNS.filter((noun) => new RegExp(`\\b${noun}s?\\b`).test(cleaned));
  score += Math.min(matchedStructural.length, 3); // cap so spamming keywords doesn't game the score

  if (HAS_DOMAIN_CLUE.test(cleaned)) score += 2;
  if (HAS_STYLE_CLUE.test(cleaned)) score += 1;

  // Thresholds raised after user testing — a single domain clue + a few
  // words used to pass (5pts > old threshold 4). Now a build-page brief
  // has to show both structure AND purpose AND style OR a very long
  // self-contained description. `/code` stays looser because snippets
  // are often terse by nature.
  const threshold = kind === 'code' ? 3 : 7;
  const needsClarification = score < threshold;

  const missing: string[] = [];
  if (matchedStructural.length === 0 && kind !== 'code') missing.push('what sections / pages');
  if (!HAS_DOMAIN_CLUE.test(cleaned)) missing.push('what it\'s for / who uses it');
  if (kind !== 'code' && !HAS_STYLE_CLUE.test(cleaned)) missing.push('style / feel');

  const hint = needsClarification
    ? `This brief is a bit thin. Tell me: ${missing.slice(0, 3).join('; ')}. Then re-run the command.`
    : '';

  return { score, needsClarification, hint };
}
