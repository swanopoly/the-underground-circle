// skillRelevanceCore — content-aware lexical relevance for skill selection.
//
// WHY (skills opt v7): today the skill ranking in
// `openswanSkillResolution.resolveOpenSwanSkillsFromCatalog` only uses ~7
// hardcoded hint bonuses (matched-query-hint +5, task-hint +3, mode-hint +2).
// Those hints look at the *shape* of the request (mode / inferred task kind /
// a few regexes), NOT the actual turn CONTENT. So a genuinely domain-relevant
// skill whose name/description/tags overlap the query can lose to an
// irrelevant-but-hinted one, and two skills in the SAME hint tier fall back to
// an alphabetical `displayName` tiebreak that ignores relevance entirely.
//
// This core adds a lexical overlap score used strictly as a SECONDARY sort key.
// It is NEVER summed into the hint (primary) score — hint precedence is
// preserved exactly. A hinted skill can never drop below an unhinted one on
// content alone; content only re-orders skills that are already tied on hints.
//
// Scoring (bounded, deterministic): the query is tokenized into a de-duped set
// of lowercased word tokens (>= MIN_TOKEN_LEN chars, common stopwords removed).
// Each query token scores its BEST matching field on the skill —
//   tags/keywords → WEIGHT_STRONG, name → WEIGHT_NAME, description → WEIGHT_DESC
// — summed across distinct query tokens and clamped to [0, CONTENT_SCORE_MAX].
// Field text is tokenized the same way, so matching is whole-token overlap
// (no "cat" ⊂ "category" false positives) — the standard lexical-overlap read.
//
// PURITY: zero imports, tsx-loadable (smoke: skill-relevance-core). NO
// Date.now / Math.random. Every export is TOTAL — null/undefined/wrong-type/
// huge/hostile/cyclic input yields a safe neutral (0 / []), never throws.
// Bounded: input arrays, per-field text length, and token counts are all
// capped, so a hostile mega-payload can only ever do bounded work.

/** The minimal shape this core scores. A superset of both the persona `Skill`
 *  (name/description) and the library metadata (name/description/tags), so the
 *  same ranker works for either surface. `hintScore` carries the existing
 *  hardcoded hint bonus and stays the PRIMARY sort key. */
export interface ScorableSkill {
  name: string;
  description?: string;
  tags?: string[];
  keywords?: string[];
  hintScore?: number;
}

/** Upper bound of `skillContentScore`. Exported so callers/tests can reason
 *  about the clamp without hardcoding the literal. */
export const CONTENT_SCORE_MAX = 10;

// Field weights: a tag/keyword hit is the strongest relevance signal, the skill
// name next, and the (long, noisy) description weakest per token.
const WEIGHT_STRONG = 3; // tags + keywords
const WEIGHT_NAME = 2; // name
const WEIGHT_DESC = 1; // description

// Defensive bounds — none of these should ever bite a real skill catalog; they
// exist purely so a hostile/huge input does bounded work.
const MIN_TOKEN_LEN = 3; // shorter tokens are mostly stopwords/noise
const MAX_TEXT = 2000; // clip any one field string before tokenizing
const MAX_TOKENS = 200; // cap tokens taken from any one field / the query
const MAX_ARRAY = 100; // cap tags/keywords entries considered
const HINT_CAP = 1_000_000; // clamp finite hintScore magnitude (non-finite → 0)
const HARD_MAX_SKILLS = 5000; // cap skills processed by the ranker

// Compact stopword set: common English function/filler words that survive the
// length filter (all >= 3 chars) and would otherwise add uniform noise. Only
// applied to QUERY tokens — field stopwords are harmless since only query
// tokens drive matches.
const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'you', 'your', 'with', 'that', 'this', 'are', 'was',
  'has', 'have', 'had', 'its', 'from', 'into', 'use', 'using', 'get', 'gets',
  'how', 'can', 'will', 'would', 'should', 'could', 'about', 'what', 'when',
  'where', 'which', 'while', 'them', 'they', 'then', 'than', 'our', 'out',
  'not', 'but', 'all', 'any', 'some', 'more', 'most', 'been', 'were', 'does',
  'did', 'done', 'need', 'want', 'like', 'just', 'also', 'only', 'over', 'very',
  'such', 'each', 'please', 'help', 'make', 'made',
]);

/** Split arbitrary input into lowercased word tokens (>= MIN_TOKEN_LEN). Splits
 *  on every non-alphanumeric char (so `code_review` → ['code','review']).
 *  Non-strings and empties yield []. Bounded by MAX_TEXT / MAX_TOKENS. */
function tokenize(text: unknown): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const clipped = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const out: string[] = [];
  const parts = clipped.toLowerCase().split(/[^a-z0-9]+/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length >= MIN_TOKEN_LEN) {
      out.push(p);
      if (out.length >= MAX_TOKENS) break;
    }
  }
  return out;
}

/** De-duped, stopword-filtered token list for the QUERY side. */
function uniqueQueryTokens(text: unknown): string[] {
  const toks = tokenize(text);
  if (toks.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

/** Add tokens from a possibly-array field into a target set (bounded). */
function addArrayTokens(target: Set<string>, arr: unknown): void {
  if (!Array.isArray(arr)) return;
  const n = Math.min(arr.length, MAX_ARRAY);
  for (let i = 0; i < n; i++) {
    const toks = tokenize(arr[i]);
    for (let j = 0; j < toks.length; j++) {
      target.add(toks[j]);
      if (target.size >= MAX_TOKENS) return;
    }
  }
}

/**
 * Lexical overlap of the query against a skill's name / description / tags /
 * keywords, bounded to [0, CONTENT_SCORE_MAX]. Total: any non-object skill,
 * empty query, or field-less skill returns 0; never throws.
 */
export function skillContentScore(skill: ScorableSkill, queryText: unknown): number {
  const queryTokens = uniqueQueryTokens(queryText);
  if (queryTokens.length === 0) return 0;
  if (!skill || typeof skill !== 'object') return 0;

  const nameTokens = new Set(tokenize((skill as { name?: unknown }).name));
  const descTokens = new Set(tokenize((skill as { description?: unknown }).description));
  const strongTokens = new Set<string>();
  addArrayTokens(strongTokens, (skill as { tags?: unknown }).tags);
  addArrayTokens(strongTokens, (skill as { keywords?: unknown }).keywords);

  if (strongTokens.size === 0 && nameTokens.size === 0 && descTokens.size === 0) {
    return 0;
  }

  let score = 0;
  for (let i = 0; i < queryTokens.length; i++) {
    const tok = queryTokens[i];
    // Best (highest-weight) field this token hits — counted once per token.
    if (strongTokens.has(tok)) score += WEIGHT_STRONG;
    else if (nameTokens.has(tok)) score += WEIGHT_NAME;
    else if (descTokens.has(tok)) score += WEIGHT_DESC;
    if (score >= CONTENT_SCORE_MAX) return CONTENT_SCORE_MAX;
  }
  return score;
}

/** Read a bounded, finite hint score off an untrusted skill (0 when absent). */
function readHintScore(skill: unknown): number {
  if (!skill || typeof skill !== 'object') return 0;
  const raw = (skill as { hintScore?: unknown }).hintScore;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  if (raw > HINT_CAP) return HINT_CAP;
  if (raw < -HINT_CAP) return -HINT_CAP;
  return raw;
}

/** Resolve the effective slice length. undefined / non-finite → keep all;
 *  <= 0 → none; otherwise floor & clamp to the available length. */
function resolveMaxSkills(raw: unknown, len: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return len;
  const n = Math.floor(raw);
  if (n <= 0) return 0;
  return n >= len ? len : n;
}

/**
 * Re-rank skills so content relevance breaks ties WITHIN a hint tier without
 * ever overriding the hint precedence.
 *
 * Sort keys, in order:
 *   1. hintScore descending   (PRIMARY — existing hardcoded precedence)
 *   2. content score desc     (SECONDARY — this core's lexical overlap)
 *   3. original array order   (stable — decorated index tiebreak)
 *
 * Then sliced to `opts.maxSkills` (default: keep all). Total: a non-array,
 * empty, or garbage-laden input yields [] or the surviving entries scored as
 * neutral; never throws and never reorders across hint tiers.
 */
export function rankSkillsByRelevance<T extends ScorableSkill>(
  skills: T[],
  queryText: unknown,
  opts?: { maxSkills?: number },
): T[] {
  if (!Array.isArray(skills) || skills.length === 0) return [];

  const capped = skills.length > HARD_MAX_SKILLS ? skills.slice(0, HARD_MAX_SKILLS) : skills;
  const max = resolveMaxSkills(opts ? opts.maxSkills : undefined, capped.length);
  if (max <= 0) return [];

  const decorated = capped.map((skill, index) => ({
    skill,
    index,
    hint: readHintScore(skill),
    content: skillContentScore(skill as ScorableSkill, queryText),
  }));

  decorated.sort((a, b) => {
    if (a.hint !== b.hint) return b.hint - a.hint; // primary: hint precedence
    if (a.content !== b.content) return b.content - a.content; // secondary: content
    return a.index - b.index; // stable: preserve original order
  });

  const out: T[] = [];
  for (let i = 0; i < decorated.length && out.length < max; i++) {
    out.push(decorated[i].skill);
  }
  return out;
}
