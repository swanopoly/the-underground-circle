/**
 * slashCommandCorrectionCore — pure fuzzy corrector for typo'd chat slash
 * commands ('/reserach', '/contxt').
 *
 * Finding fixed: a typo'd slash command matches none of ChatTab's slash
 * intercepts and silently falls through to the LLM as plain chat — no
 * did-you-mean, no hint that the command lane was missed. This core decides,
 * from the leading token alone, whether the message is (a) not a slash
 * message, (b) an exact known command (never suggest), or (c) an unknown
 * slash token with up to 3 nearest known commands by edit distance / shared
 * prefix, best first.
 *
 * The caller passes the known command list (e.g. CHAT_COMMAND_REGISTRY
 * commands + aliases + ChatTab-only extras like '/agents', '/lanes') so this
 * module stays pure. Multi-word registry commands ('/gh status',
 * '/memory-bank update') register by their FIRST token, matching how the
 * ChatTab intercepts dispatch on the leading token.
 *
 * PURITY CONTRACT (load-bearing — the smoke test runs under tsx/esbuild,
 * which cannot load react-native):
 * - Zero runtime imports. No react-native, no supabase, no app modules.
 * - Every export is TOTAL: never throws on any input (null / undefined /
 *   wrong types / huge values) — returns a safe neutral value instead.
 * - Bounded: compared lengths, scanned list sizes, and output sizes are all
 *   capped by the constants below.
 * - Deterministic: no Date.now() / Math.random().
 */

/** Levenshtein comparisons look at at most this many chars of each side. */
export const MAX_LEVENSHTEIN_COMPARE_LENGTH = 64;

/** At most this many did-you-mean suggestions are ever returned/rendered. */
export const MAX_SLASH_SUGGESTIONS = 3;

/** At most this many known-command entries are scanned (junk-tolerant). */
export const MAX_KNOWN_COMMANDS = 512;

/** Suggest only when the edit distance is at most this… */
const MAX_SUGGESTION_EDIT_DISTANCE = 2;

/** …or when at least this many leading chars are shared. */
const MIN_SHARED_PREFIX = 3;

/** Per known-command entry char cap (junk armor). */
const MAX_COMMAND_CHARS = 80;

/** Chars of the raw input examined when extracting the leading token. */
const MAX_INPUT_SCAN_CHARS = 2000;

/** Leading-token char cap. */
const MAX_TOKEN_CHARS = 64;

/** Entries of a caller-provided suggestions array scanned by buildDidYouMean. */
const MAX_SUGGESTION_SCAN = 64;

export interface SlashSuggestion {
  /** True when the input (after trim) starts with '/'. */
  isSlash: boolean;
  /** True when the leading token IS a known command — never suggest then. */
  exact: boolean;
  /** Up to MAX_SLASH_SUGGESTIONS nearest known commands, best first. */
  suggestions: string[];
}

/**
 * Bounded, total Levenshtein edit distance. Non-string inputs are treated as
 * ''. Each side is capped at MAX_LEVENSHTEIN_COMPARE_LENGTH chars, so the
 * result is always in [0, MAX_LEVENSHTEIN_COMPARE_LENGTH].
 */
export function levenshtein(a: unknown, b: unknown): number {
  try {
    const sa = typeof a === 'string' ? a.slice(0, MAX_LEVENSHTEIN_COMPARE_LENGTH) : '';
    const sb = typeof b === 'string' ? b.slice(0, MAX_LEVENSHTEIN_COMPARE_LENGTH) : '';
    if (sa === sb) return 0;
    const la = sa.length;
    const lb = sb.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    let prev: number[] = new Array(lb + 1);
    let curr: number[] = new Array(lb + 1);
    for (let j = 0; j <= lb; j += 1) prev[j] = j;
    for (let i = 1; i <= la; i += 1) {
      curr[0] = i;
      const ca = sa.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j += 1) {
        const cost = ca === sb.charCodeAt(j - 1) ? 0 : 1;
        const del = prev[j] + 1;
        const ins = curr[j - 1] + 1;
        const sub = prev[j - 1] + cost;
        curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
      }
      const swap = prev;
      prev = curr;
      curr = swap;
    }
    return prev[lb];
  } catch {
    return 0;
  }
}

/**
 * Leading slash token of the input, or null when the input is not a string
 * or does not trim to something starting with '/'. Capped at
 * MAX_TOKEN_CHARS chars.
 */
function firstSlashToken(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.slice(0, MAX_INPUT_SCAN_CHARS).trim();
  if (!trimmed.startsWith('/')) return null;
  const token = trimmed.split(/\s+/, 1)[0] || '';
  return token.slice(0, MAX_TOKEN_CHARS);
}

/**
 * Distinct lowercased command names (leading slashes stripped) from the
 * caller's known-command list. Junk entries (non-strings, empties, entries
 * not starting with '/') are ignored. Multi-word commands register by first
 * token. Scans at most MAX_KNOWN_COMMANDS entries.
 */
function collectKnownNames(known: unknown): string[] {
  const names: string[] = [];
  if (!Array.isArray(known)) return names;
  const seen: Record<string, true> = Object.create(null);
  const limit = Math.min(known.length, MAX_KNOWN_COMMANDS);
  for (let i = 0; i < limit; i += 1) {
    const entry = known[i];
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().slice(0, MAX_COMMAND_CHARS);
    if (!trimmed.startsWith('/')) continue;
    const first = (trimmed.split(/\s+/, 1)[0] || '').toLowerCase();
    const name = first.replace(/^\/+/, '');
    if (!name || seen[name]) continue;
    seen[name] = true;
    names.push(name);
  }
  return names;
}

/**
 * Decide whether an input is a slash message, whether its leading token is an
 * exact known command, and — when it is not — up to MAX_SLASH_SUGGESTIONS
 * nearest known commands, best first.
 *
 * Eligibility for a suggestion: distance 0 (e.g. '//help' → '/help'), OR
 * edit distance <= MAX_SUGGESTION_EDIT_DISTANCE with the longer name at
 * least distance+2 chars (keeps 1–2 char tokens like '/x' from matching
 * every short command), OR shared prefix >= MIN_SHARED_PREFIX (so partial
 * commands like '/mem' still surface '/memory', '/memories').
 *
 * Ordering: smaller distance, then longer shared prefix, then shorter name,
 * then alphabetical. Exact matches NEVER produce suggestions.
 */
export function suggestSlashCommand(input: unknown, known: unknown): SlashSuggestion {
  try {
    const token = firstSlashToken(input);
    if (token === null) return { isSlash: false, exact: false, suggestions: [] };
    const tokenLower = token.toLowerCase();
    const names = collectKnownNames(known);
    for (const name of names) {
      if (tokenLower === `/${name}`) return { isSlash: true, exact: true, suggestions: [] };
    }
    const inputName = tokenLower.replace(/^\/+/, '');
    if (!inputName) return { isSlash: true, exact: false, suggestions: [] };

    const candidates: Array<{ name: string; d: number; p: number }> = [];
    for (const name of names) {
      const d = levenshtein(inputName, name);
      let p = 0;
      const lim = Math.min(inputName.length, name.length, MAX_LEVENSHTEIN_COMPARE_LENGTH);
      while (p < lim && inputName.charCodeAt(p) === name.charCodeAt(p)) p += 1;
      const longest = Math.max(inputName.length, name.length);
      const eligible = d === 0
        || (d <= MAX_SUGGESTION_EDIT_DISTANCE && longest >= d + 2)
        || p >= MIN_SHARED_PREFIX;
      if (eligible) candidates.push({ name, d, p });
    }
    candidates.sort((x, y) => (
      x.d - y.d
      || y.p - x.p
      || x.name.length - y.name.length
      || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)
    ));
    const suggestions = candidates
      .slice(0, MAX_SLASH_SUGGESTIONS)
      .map((candidate) => `/${candidate.name}`);
    return { isSlash: true, exact: false, suggestions };
  } catch {
    return { isSlash: false, exact: false, suggestions: [] };
  }
}

/**
 * Render the did-you-mean chat notice. Empty/invalid suggestions → '' (the
 * caller then lets the message fall through as plain chat). When the input
 * yields a slash token it is echoed (backticks stripped) so the user sees
 * exactly which token missed; otherwise the generic head is used:
 *
 *   `/reserach` isn't a command I know. Did you mean: /research?  (or just
 *   send it as a message)
 */
export function buildDidYouMean(input: unknown, suggestions: unknown): string {
  try {
    const list: string[] = [];
    if (Array.isArray(suggestions)) {
      const limit = Math.min(suggestions.length, MAX_SUGGESTION_SCAN);
      for (let i = 0; i < limit && list.length < MAX_SLASH_SUGGESTIONS; i += 1) {
        const entry = suggestions[i];
        if (typeof entry !== 'string') continue;
        const trimmed = entry.trim().slice(0, MAX_COMMAND_CHARS);
        if (!trimmed.startsWith('/') || trimmed.length < 2) continue;
        if (list.indexOf(trimmed) !== -1) continue;
        list.push(trimmed);
      }
    }
    if (list.length === 0) return '';
    const rawToken = firstSlashToken(input);
    const cleanToken = rawToken === null ? '' : rawToken.replace(/`/g, '');
    const head = cleanToken.length > 1
      ? `\`${cleanToken}\` isn't a command I know.`
      : "That isn't a command I know.";
    return `${head} Did you mean: ${list.join(', ')}?  (or just send it as a message)`;
  } catch {
    return '';
  }
}
