/**
 * conversationComplexityFloorCore — a bare mid-task follow-up ("yes", "go",
 * "do it") classifies as 'trivial' (agenticCodingProfile.estimateComplexity →
 * casual + no entities), so buildSystemPromptAsync loads ONLY the user profile
 * and drops memory / wisdom / retrieval / missions / skills. The agent forgets
 * what it was doing exactly when it should ACT on the plan it just proposed.
 *
 * This pure core derives a per-turn complexity FLOOR from the recent prior
 * USER turns: when the recent trail shows an active substantive task, a thin
 * current turn keeps a minimum context tier — ONE TIER BELOW that task's
 * estimated tier (prior 'complex' → floor 'moderate'; prior 'moderate' → floor
 * 'simple'). The floor decays back to null once the recent user turns are
 * genuinely casual again, and it is a no-op when the current turn is already
 * substantive on its own. It composes with the existing lane + context-depth
 * floors through composeComplexityFloors at the swanbot.ts chokepoint.
 *
 * A floor only ever RAISES the tier (applyChatPromptComplexityFloor takes the
 * max), so "the current trivial turn does not lower the floor" is structural:
 * we derive purely from PRIOR turns and never inspect the current turn to lower
 * anything.
 *
 * Load-bearing purity (the smoke runs under tsx/esbuild, which cannot load
 * react-native/supabase): type-only imports, no Date.now()/Math.random() at
 * module scope, every export TOTAL (never throws on null/undefined/wrong-type/
 * huge/hostile input → a safe neutral value), bounded work + output. In
 * particular this must NOT import agenticCodingProfile (react-tainted); the
 * small complexity estimate is inlined below.
 */

import type { ChatPromptComplexity } from './chatPromptAssembly';

export type { ChatPromptComplexity };

const RANK: Readonly<Record<ChatPromptComplexity, number>> = {
  trivial: 0,
  simple: 1,
  moderate: 2,
  complex: 3,
};

// ── Bounds (hostile/huge input can never blow up work) ──────────────────────
/** Per-turn text actually scanned by the estimator. */
const MAX_ANALYZE_CHARS = 20_000;
/** "last ~2-3 user turns" — the recency window we look back over. */
const RECENT_USER_TURNS = 3;
/** Never scan an unbounded history tail to find those user turns. */
const BACKWARD_SCAN_CAP = 100;
/**
 * How many casual user turns since the last substantive one before the task is
 * considered wound down (decay to null). Two casual follow-ups → the topic has
 * moved on.
 */
const DECAY_CASUAL_LIMIT = 2;

// ── Inlined signals (NO import of agenticCodingProfile) ─────────────────────
// Anchored greetings / affirmations / bare acknowledgements. Only trivial-izes
// SHORT messages (guarded by word count at the call site) so "yes, let's
// refactor the whole auth layer" is not mistaken for a bare "yes".
const CASUAL_RE =
  /^(hi|hey|hello|yo|sup|gm|gn|morning|evening|thanks|thank you|ty|thx|cool|nice|ok|okay|k|kk|got it|gotcha|understood|makes sense|perfect|great|awesome|yes|yeah|yep|yup|no|nope|nah|sure|sounds good|sg|right|exactly|true|correct|lgtm|ship it|go|go ahead|do it|please do|continue|proceed|next|lol|haha|lmao|bet|word|indeed|agreed)\b/i;

// Explicit action / task verbs — real work worth keeping context for. Kept to
// clear imperatives on purpose: under-detecting a substantive turn just means
// "no floor" (a byte-identical no-op, the safe direction), whereas over-
// detecting would load context the turn does not need.
const TASK_RE =
  /\b(build|implement|create|add|generate|make|write|code|scaffold|refactor|rewrite|rebuild|fix|fixing|debug|repair|resolve|review|audit|inspect|analyze|analyse|design|redesign|deploy|publish|release|ship|migrate|integrate|configure|update|remove|delete|architect|plan|research|investigate|optimize|optimise|set\s*up|wire\s*up|hook\s*up)\b/i;

const QUESTION_RE =
  /\b(what|why|how|when|where|who|which|can you|could you|would you|should i|is there|are there|explain|tell me|describe)\b/i;

// Multi-clause / sequenced work. The bounded {0,400} keeps "first … then"
// from matching two words an entire long message apart, and keeps the scan
// linear on the capped text.
const MULTISTEP_RE =
  /\band then\b|\bafter that\b|\badditionally\b|\bfirst\b[\s\S]{0,400}\bthen\b|\bstep\s*\d/i;

/**
 * The small inline complexity estimator. TOTAL: any non-string collapses to ''
 * (→ 'trivial'); output is always one of the four tiers. Deliberately coarse —
 * its only job is to bucket a prior user turn well enough to decide "is this
 * substantive?" and "one tier below what?".
 */
export function estimateTurnComplexity(text: unknown): ChatPromptComplexity {
  const raw = typeof text === 'string' ? text : '';
  const s = raw.length > MAX_ANALYZE_CHARS ? raw.slice(0, MAX_ANALYZE_CHARS) : raw;
  const trimmed = s.trim();
  if (!trimmed) return 'trivial';

  const wordCount = trimmed.split(/\s+/).length;

  // Bare follow-ups / greetings / affirmations → trivial.
  if (wordCount <= 2) return 'trivial';
  if (wordCount <= 6 && CASUAL_RE.test(trimmed)) return 'trivial';

  // Strong structure signals → complex.
  if (MULTISTEP_RE.test(trimmed)) return 'complex';
  if (wordCount > 80) return 'complex';

  // Explicit action/task verbs → real work (scales up with length).
  if (TASK_RE.test(trimmed)) return wordCount > 40 ? 'complex' : 'moderate';

  // Questions scale with length.
  if (trimmed.includes('?') || QUESTION_RE.test(trimmed)) {
    return wordCount > 30 ? 'moderate' : 'simple';
  }

  // Fall back to raw length.
  if (wordCount > 40) return 'complex';
  if (wordCount > 20) return 'moderate';
  return 'simple';
}

/** Accept only a real tier; anything else → null (unknown current turn). */
function coerceComplexity(v: unknown): ChatPromptComplexity | null {
  return v === 'trivial' || v === 'simple' || v === 'moderate' || v === 'complex' ? v : null;
}

/**
 * Collect up to `max` recent USER-turn texts, MOST-RECENT-FIRST, without
 * scanning an unbounded history tail. Tolerates any hostile array shape
 * (null/primitive elements, missing/renamed fields, non-string content).
 */
function recentUserTurns(input: unknown, max: number, scanCap: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const stop = Math.max(0, input.length - scanCap);
  for (let i = input.length - 1; i >= stop && out.length < max; i -= 1) {
    const item = input[i];
    if (!item || typeof item !== 'object') continue;
    if ((item as { role?: unknown }).role !== 'user') continue;
    const content = (item as { content?: unknown }).content;
    out.push(typeof content === 'string' ? content : '');
  }
  return out;
}

/** One tier below a substantive tier: complex → moderate, moderate → simple. */
function oneTierBelow(c: ChatPromptComplexity): ChatPromptComplexity {
  return c === 'complex' ? 'moderate' : 'simple';
}

/**
 * Derive the mid-task context floor for this turn, or null for a byte-identical
 * no-op.
 *
 * @param conversationMessages the PRIOR turns (chronological, oldest-first,
 *   most recent last) — NOT including the current turn. Any shape tolerated.
 * @param currentComplexity the current turn's own estimated tier (e.g.
 *   route.complexity). Only used to stay a no-op when the current turn is
 *   already substantive; a thin/unknown value proceeds.
 * @returns a floor ONE TIER BELOW the most recent substantive prior task
 *   ('complex' → 'moderate', 'moderate' → 'simple'), or null when the trail is
 *   empty/thin, the recent turns have decayed to casual, or the current turn is
 *   already substantive.
 */
export function resolveConversationComplexityFloor(
  conversationMessages: unknown,
  currentComplexity: unknown,
): ChatPromptComplexity | null {
  // Empty / thin trail → no-op. A single prior message is the opening turn:
  // there is no established task to keep warm yet.
  if (!Array.isArray(conversationMessages) || conversationMessages.length < 2) {
    return null;
  }

  // If THIS turn is already substantive, the message heuristic loads context on
  // its own. Our floor is at most 'moderate', so it could never raise a
  // moderate/complex turn — stay a no-op and only rescue thin/unknown turns.
  const current = coerceComplexity(currentComplexity);
  if (current && RANK[current] >= RANK.moderate) return null;

  const recent = recentUserTurns(conversationMessages, RECENT_USER_TURNS, BACKWARD_SCAN_CAP);
  if (recent.length === 0) return null;

  // Walk from the most-recent user turn back to the newest substantive one,
  // counting casual turns passed. Too many casual turns since → task wound down.
  let substantive: ChatPromptComplexity | null = null;
  let casualSince = 0;
  for (const content of recent) {
    const c = estimateTurnComplexity(content);
    if (RANK[c] >= RANK.moderate) {
      substantive = c;
      break;
    }
    casualSince += 1;
  }
  if (!substantive) return null;
  if (casualSince >= DECAY_CASUAL_LIMIT) return null;

  return oneTierBelow(substantive);
}
