/**
 * thinkingVerbs — shared rotating-verb vocabulary for "the agent is
 * doing something" indicators. Used by both the typing strip below
 * the composer (idle state) and the RunStatusBar (active run state)
 * so every "thinking" affordance in the app speaks the same language.
 *
 * Design notes:
 *  - Present continuous, no emojis, no tool references (stays neutral
 *    across modes / models / agents)
 *  - Reads well after any subject: "BlackSwan is noodling",
 *    "OpenSwan is noodling", "the agent is noodling"
 *  - Deliberately varied in tone — mix of serious ("cross-referencing")
 *    + playful ("noodling") so users get a sense of personality, not
 *    a generic loading spinner
 */

export const THINKING_VERBS: readonly string[] = [
  'noodling',
  'pondering',
  'wrangling',
  'cooking',
  'rummaging',
  'parsing',
  'weaving',
  'dreaming up',
  'stitching',
  'tracing',
  'sketching',
  'turning it over',
  'riffing',
  'checking notes',
  'cross-referencing',
  'untangling',
  'lining things up',
  'thinking hard',
  'reading between the lines',
  'hunting for the thread',
  'measuring twice',
  'sharpening the edges',
  'looking under rocks',
  'putting the pieces together',
];

/** Deterministic verb pick — `idx` can be negative or >= length; modulo
 *  makes it safe for any integer. Deterministic means the rotation
 *  doesn't flicker when React rerenders between ticks.
 *  Returns the verb with the first letter capitalized. Multi-word
 *  phrases keep subsequent words lowercase ("Turning it over") which
 *  reads better than CSS `text-transform: capitalize` (which would
 *  give "Turning It Over"). */
export function pickThinkingVerb(idx: number): string {
  const n = THINKING_VERBS.length;
  const raw = THINKING_VERBS[((idx % n) + n) % n];
  return raw.length === 0 ? raw : raw[0].toUpperCase() + raw.slice(1);
}
