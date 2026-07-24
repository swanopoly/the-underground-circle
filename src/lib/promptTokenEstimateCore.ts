// promptTokenEstimateCore — a PURE, heuristic LLM token *estimator*. It feeds
// cost forecasting (roughly how much a prompt/response will cost) and context
// compaction decisions (does this fit the budget; if not, trim it). It is NOT a
// real tokenizer: there is no vocabulary, no BPE merge table, and no
// provider-specific model. It approximates token counts from character/whitespace/
// punctuation statistics, so treat every number here as an *estimate* with a
// comfortable margin — never as an exact billing figure or a hard context limit.
//
// Why a heuristic is enough here: exact token counts require the provider's
// tokenizer (a network/CPU cost we do not want in a hot planning path). For
// budgeting and "should I compact?" gates, an estimate that is stable and errs
// slightly high is more useful than an exact count that is slow or unavailable.
//
// Model: English/code text averages ~4 characters per token. We collapse runs of
// whitespace before counting (many spaces/newlines do not create many tokens),
// then apply a small uplift when the text is punctuation/symbol dense (code, JSON,
// URLs, math) because those fragment into more tokens than prose of the same
// length. The divisor and uplift are deliberately conservative approximations.
//
// PURITY: zero imports, tsx-loadable (smoke: prompt-token-estimate-core). Fully
// DETERMINISTIC (no Date.now / Math.random). NEVER throws — any non-string / NaN
// input estimates to 0, and every budget helper degrades to safe zeros/empties.

export interface TokenEstimate {
  tokens: number;
  chars: number;
  method: 'heuristic';
}

/** Approximate characters-per-token for English/code text. Higher = fewer tokens. */
export const CHARS_PER_TOKEN = 4;
/** Role/framing overhead charged per chat message (approximate). */
export const PER_MESSAGE_OVERHEAD_TOKENS = 4;

// Characters treated as "dense" — punctuation, brackets, operators, and other
// symbols that tend to fragment into their own tokens (code, JSON, URLs, math).
// Letters, digits, whitespace, and the most common prose punctuation are excluded.
const DENSE_CHAR = /[!-/:-@\[-`{-~]/; // ASCII punctuation/symbol ranges (excludes letters/digits/space)

/** Collapse every run of whitespace to a single space and trim the ends. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Estimate the number of tokens in `text`.
 *
 * APPROXIMATE. Roughly ceil(effectiveChars / CHARS_PER_TOKEN) after collapsing
 * whitespace runs, with a mild uplift (up to ~1.15x) when the text is heavily
 * punctuation/symbol dense. Never throws: a non-string or empty input returns 0.
 */
export function estimateTokens(text: string): number {
  if (typeof text !== 'string') return 0;
  const collapsed = collapseWhitespace(text);
  const len = collapsed.length;
  if (len <= 0) return 0;

  // Count dense (punctuation/symbol) characters to gauge code/markup density.
  let dense = 0;
  for (let i = 0; i < len; i += 1) {
    if (DENSE_CHAR.test(collapsed[i])) dense += 1;
  }
  const density = dense / len; // 0..1

  // Base estimate: ~4 chars per token.
  const base = len / CHARS_PER_TOKEN;

  // Mild uplift for dense text: up to +15% when the text is ~half+ symbols.
  // Prose (low density) is left essentially unchanged.
  const uplift = 1 + Math.min(0.15, density * 0.3);

  const estimate = Math.ceil(base * uplift);
  return Number.isFinite(estimate) && estimate > 0 ? estimate : 0;
}

/**
 * Estimate tokens for a list of chat messages. Sums estimateTokens(content) plus
 * ~PER_MESSAGE_OVERHEAD_TOKENS per message for role/framing overhead. `chars` is
 * the total number of content characters (raw, before whitespace collapse).
 *
 * Never throws: a non-array, or entries with a missing/non-string content, simply
 * contribute nothing but the per-message overhead (which still applies per entry).
 */
export function estimateMessagesTokens(
  messages: Array<{ role?: string; content: string }>,
): TokenEstimate {
  const empty: TokenEstimate = { tokens: 0, chars: 0, method: 'heuristic' };
  if (!Array.isArray(messages)) return empty;

  let tokens = 0;
  let chars = 0;
  for (const msg of messages) {
    // Each message carries role/framing overhead regardless of content.
    tokens += PER_MESSAGE_OVERHEAD_TOKENS;
    const content = msg && typeof msg.content === 'string' ? msg.content : '';
    if (content.length > 0) {
      tokens += estimateTokens(content);
      chars += content.length;
    }
  }

  return {
    tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : 0,
    chars: Number.isFinite(chars) && chars > 0 ? chars : 0,
    method: 'heuristic',
  };
}

/**
 * Does `text` fit within `budgetTokens` (by estimate)? Returns the estimate and,
 * when over, by how many tokens. Never throws: non-string text estimates to 0; a
 * non-finite/negative budget is treated as 0 (so any non-empty text is over).
 */
export function fitsInBudget(
  text: string,
  budgetTokens: number,
): { fits: boolean; estimate: number; overBy: number } {
  const estimate = estimateTokens(text);
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? Math.floor(budgetTokens) : 0;
  const fits = estimate <= budget;
  const overBy = fits ? 0 : estimate - budget;
  return { fits, estimate, overBy };
}

/**
 * Trim `text` so its estimate fits (approximately) within `budgetTokens`.
 *
 * If the text already fits, it is returned unchanged with truncated:false. Else it
 * is cut to about budget*CHARS_PER_TOKEN characters, backing up to the nearest word
 * boundary so we do not slice a word in half, and `estimate` is recomputed on the
 * truncated text. Because the estimate is heuristic, the result targets — but is
 * not guaranteed to be exactly at — the budget.
 *
 * Guards: budget <= 0 (or non-finite) yields empty text, with truncated:true only
 * when the input was non-empty. Non-string input yields empty text, truncated:false.
 */
export function truncateToTokenBudget(
  text: string,
  budgetTokens: number,
): { text: string; truncated: boolean; estimate: number } {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: '', truncated: false, estimate: 0 };
  }

  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? Math.floor(budgetTokens) : 0;
  if (budget <= 0) {
    // No room for any tokens → drop everything; input was non-empty so mark truncated.
    return { text: '', truncated: true, estimate: 0 };
  }

  // Already within budget → no-op.
  if (estimateTokens(text) <= budget) {
    return { text, truncated: false, estimate: estimateTokens(text) };
  }

  // Cut to roughly budget*CHARS_PER_TOKEN characters.
  const targetChars = budget * CHARS_PER_TOKEN;
  let cut = text.slice(0, targetChars);

  // Back up to the last whitespace so we break on a word boundary (unless the
  // first token itself is longer than the whole target, in which case keep the hard cut).
  const lastSpace = cut.search(/\s\S*$/); // index of the last whitespace before trailing non-space
  if (lastSpace > 0) {
    cut = cut.slice(0, lastSpace);
  }
  cut = cut.replace(/\s+$/, '');

  return { text: cut, truncated: true, estimate: estimateTokens(cut) };
}
