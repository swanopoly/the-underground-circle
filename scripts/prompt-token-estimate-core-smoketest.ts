// Smoke test for src/lib/promptTokenEstimateCore.ts — a PURE heuristic token
// estimator. Run: npx tsx scripts/prompt-token-estimate-core-smoketest.ts
// Prints "prompt-token-estimate-core smoke: N passed, M failed" and exits 1 on failure.

import {
  estimateTokens,
  estimateMessagesTokens,
  fitsInBudget,
  truncateToTokenBudget,
  CHARS_PER_TOKEN,
  PER_MESSAGE_OVERHEAD_TOKENS,
  type TokenEstimate,
} from '../src/lib/promptTokenEstimateCore';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

// ---------------------------------------------------------------------------
// estimateTokens — empty / falsy
// ---------------------------------------------------------------------------
assert('empty string → 0 tokens', estimateTokens('') === 0);
assert('whitespace-only string → 0 tokens', estimateTokens('     \n\t  ') === 0);

// ---------------------------------------------------------------------------
// estimateTokens — pure ASCII ~ chars/4 (within tolerance)
// ---------------------------------------------------------------------------
const prose = 'the quick brown fox jumps over the lazy dog and runs away fast';
{
  const est = estimateTokens(prose);
  const collapsedLen = prose.replace(/\s+/g, ' ').trim().length;
  const approx = collapsedLen / CHARS_PER_TOKEN;
  // Allow generous tolerance: within ~30% of chars/4 for low-density prose.
  assert('prose estimate is positive', est > 0);
  assert('prose ~ chars/4 (within tolerance)', Math.abs(est - approx) <= approx * 0.3 + 2);
  assert('prose estimate is an integer', Number.isInteger(est));
}

// A single short word
{
  const est = estimateTokens('hello');
  assert('"hello" (5 chars) ≈ 1-2 tokens', est >= 1 && est <= 2);
}

// ---------------------------------------------------------------------------
// estimateTokens — monotonic: longer text ⇒ >= tokens
// ---------------------------------------------------------------------------
{
  const shortT = estimateTokens('hello world');
  const longT = estimateTokens('hello world hello world hello world hello world');
  assert('longer text ⇒ >= tokens (monotonic)', longT >= shortT);
  assert('4x repetition strictly grows the estimate', longT > shortT);
}
{
  // Building up one word at a time never decreases the estimate.
  let prev = 0;
  let mono = true;
  const words = 'alpha beta gamma delta epsilon zeta eta theta'.split(' ');
  let acc = '';
  for (const w of words) {
    acc = acc ? `${acc} ${w}` : w;
    const cur = estimateTokens(acc);
    if (cur < prev) mono = false;
    prev = cur;
  }
  assert('incremental growth is monotonic non-decreasing', mono);
}

// ---------------------------------------------------------------------------
// estimateTokens — whitespace collapse (many spaces don't inflate)
// ---------------------------------------------------------------------------
{
  const tight = 'one two three four';
  const spaced = 'one     two\n\n\nthree\t\t\tfour';
  assert('whitespace runs collapse (spaced == tight)', estimateTokens(spaced) === estimateTokens(tight));
}
{
  const padded = `${' '.repeat(500)}word${' '.repeat(500)}`;
  assert('leading/trailing whitespace does not inflate', estimateTokens(padded) === estimateTokens('word'));
}

// ---------------------------------------------------------------------------
// estimateTokens — code/punctuation density uplift
// ---------------------------------------------------------------------------
{
  // Same length, one prose, one symbol-dense → dense should estimate >= prose.
  const proseChunk = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';
  const codeChunk = '{[(<>)]};:{[(<>)]};:{[(<>)]};:{[(<>)]};';
  assert('same-length prose vs code: equal collapsed length', proseChunk.length === codeChunk.length);
  assert('dense/code text estimates >= prose of equal length', estimateTokens(codeChunk) >= estimateTokens(proseChunk));
}

// ---------------------------------------------------------------------------
// estimateTokens — never throws on bad input → 0
// ---------------------------------------------------------------------------
assert('non-string (number) → 0', estimateTokens(123 as unknown as string) === 0);
assert('non-string (null) → 0', estimateTokens(null as unknown as string) === 0);
assert('non-string (undefined) → 0', estimateTokens(undefined as unknown as string) === 0);
assert('non-string (object) → 0', estimateTokens({} as unknown as string) === 0);
assert('non-string (array) → 0', estimateTokens([] as unknown as string) === 0);
assert('NaN → 0', estimateTokens(NaN as unknown as string) === 0);

// ---------------------------------------------------------------------------
// estimateMessagesTokens — overhead + chars + shape
// ---------------------------------------------------------------------------
{
  const one: TokenEstimate = estimateMessagesTokens([{ role: 'user', content: 'hello world' }]);
  assert('messages result method is "heuristic"', one.method === 'heuristic');
  assert('messages chars = total content chars', one.chars === 'hello world'.length);
  assert('single message includes per-message overhead', one.tokens >= PER_MESSAGE_OVERHEAD_TOKENS + estimateTokens('hello world'));
  assert('single message tokens == content + overhead', one.tokens === estimateTokens('hello world') + PER_MESSAGE_OVERHEAD_TOKENS);
}
{
  // Overhead adds *per* message: splitting the same content into more messages costs more.
  const merged = estimateMessagesTokens([{ role: 'user', content: 'aaaa bbbb cccc dddd' }]);
  const split = estimateMessagesTokens([
    { role: 'user', content: 'aaaa bbbb' },
    { role: 'assistant', content: 'cccc dddd' },
  ]);
  assert('more messages ⇒ more overhead (per-message)', split.tokens > merged.tokens);
  assert('per-message overhead delta ≈ one overhead unit', split.tokens - merged.tokens >= PER_MESSAGE_OVERHEAD_TOKENS - 1);
}
{
  const emptyList = estimateMessagesTokens([]);
  assert('empty message list → 0 tokens', emptyList.tokens === 0);
  assert('empty message list → 0 chars', emptyList.chars === 0);
  assert('empty message list method is heuristic', emptyList.method === 'heuristic');
}
{
  // Non-array / malformed inputs never throw.
  const bad = estimateMessagesTokens(null as unknown as Array<{ content: string }>);
  assert('non-array messages → 0 tokens (safe)', bad.tokens === 0 && bad.chars === 0);
  const missingContent = estimateMessagesTokens([{ role: 'user' } as unknown as { content: string }]);
  assert('message with missing content → only overhead', missingContent.tokens === PER_MESSAGE_OVERHEAD_TOKENS);
  assert('message with missing content → 0 chars', missingContent.chars === 0);
  const nonStringContent = estimateMessagesTokens([{ content: 42 as unknown as string }]);
  assert('message with non-string content → only overhead, 0 chars', nonStringContent.tokens === PER_MESSAGE_OVERHEAD_TOKENS && nonStringContent.chars === 0);
}

// ---------------------------------------------------------------------------
// fitsInBudget — over / under / exact
// ---------------------------------------------------------------------------
{
  const text = 'hello world this is a moderately sized sentence for budgeting';
  const est = estimateTokens(text);

  const under = fitsInBudget(text, est + 100);
  assert('fitsInBudget under budget → fits', under.fits === true);
  assert('fitsInBudget under budget → overBy 0', under.overBy === 0);
  assert('fitsInBudget reports the estimate', under.estimate === est);

  const exact = fitsInBudget(text, est);
  assert('fitsInBudget exact budget → fits (<=)', exact.fits === true);
  assert('fitsInBudget exact budget → overBy 0', exact.overBy === 0);

  const over = fitsInBudget(text, est - 3);
  assert('fitsInBudget over budget → does not fit', over.fits === false);
  assert('fitsInBudget over budget → overBy = est - budget', over.overBy === 3);
}
{
  // Budget guard: <= 0 budget means any non-empty text is over.
  const z = fitsInBudget('some text', 0);
  assert('fitsInBudget budget 0 → non-empty text over', z.fits === false && z.overBy === z.estimate);
  const neg = fitsInBudget('some text', -50);
  assert('fitsInBudget negative budget → treated as 0', neg.fits === false && neg.overBy === neg.estimate);
  const emptyText = fitsInBudget('', 0);
  assert('fitsInBudget empty text + 0 budget → fits (0<=0)', emptyText.fits === true && emptyText.estimate === 0);
}

// ---------------------------------------------------------------------------
// truncateToTokenBudget — no-op / reduce / word boundary / guards
// ---------------------------------------------------------------------------
{
  // No-op when under budget.
  const text = 'short text';
  const res = truncateToTokenBudget(text, 1000);
  assert('truncate no-op when under budget (unchanged text)', res.text === text);
  assert('truncate no-op when under budget (truncated:false)', res.truncated === false);
  assert('truncate no-op reports estimate', res.estimate === estimateTokens(text));
}
{
  // Reduce a long text and mark truncated.
  const long = 'word '.repeat(400).trim(); // ~2000 chars
  const budget = 50; // ~200 chars
  const res = truncateToTokenBudget(long, budget);
  assert('truncate reduces length', res.text.length < long.length);
  assert('truncate marks truncated:true', res.truncated === true);
  assert('truncate result estimate recomputed on truncated text', res.estimate === estimateTokens(res.text));
  assert('truncate result roughly fits the budget', res.estimate <= budget + 5);
  // Word boundary: since input is space-separated words, the cut must not end mid-word.
  assert('truncate does not end on trailing whitespace', !/\s$/.test(res.text));
  assert('truncate breaks on a word boundary (ends with full word)', res.text.length === 0 || /\bword$/.test(res.text) || res.text.split(' ').every((w) => w === 'word' || w === ''));
}
{
  // Explicit word-boundary check with a budget large enough that a boundary exists.
  // "aa bb cc dd ee ff gg hh ii jj" → budget 5 (~20 chars) must cut BETWEEN words.
  const sentence = 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp';
  const res = truncateToTokenBudget(sentence, 5); // ~20 chars → forces a cut, boundary available
  assert('word-boundary truncate: no trailing whitespace', !/\s$/.test(res.text));
  // Every retained space-delimited chunk must be a whole word from the source.
  const sourceWords = new Set(sentence.split(' '));
  const ok = res.text.length === 0 || res.text.split(' ').every((w) => sourceWords.has(w));
  assert('word-boundary truncate: only whole source words retained', ok);
  assert('word-boundary truncate: marked truncated', res.truncated === true);
}
{
  // Documented fallback: when the FIRST token alone exceeds the char target,
  // there is no word boundary to back up to, so a hard cut is kept (not an error).
  const oneHugeWord = 'supercalifragilisticexpialidocious';
  const res = truncateToTokenBudget(oneHugeWord, 2); // target ~8 chars << word length
  assert('over-long leading token → hard cut kept (truncated)', res.truncated === true);
  assert('over-long leading token → non-empty prefix of source', res.text.length > 0 && oneHugeWord.startsWith(res.text));
  assert('over-long leading token → estimate recomputed', res.estimate === estimateTokens(res.text));
}
{
  // Budget <= 0 guard.
  const res0 = truncateToTokenBudget('non empty', 0);
  assert('truncate budget 0 → empty text', res0.text === '');
  assert('truncate budget 0 (non-empty input) → truncated:true', res0.truncated === true);
  assert('truncate budget 0 → estimate 0', res0.estimate === 0);
  const resNeg = truncateToTokenBudget('non empty', -10);
  assert('truncate negative budget → empty + truncated', resNeg.text === '' && resNeg.truncated === true);
}
{
  // Non-string / empty input → safe zeros, not truncated.
  const nonStr = truncateToTokenBudget(123 as unknown as string, 100);
  assert('truncate non-string → empty text', nonStr.text === '');
  assert('truncate non-string → truncated:false', nonStr.truncated === false);
  assert('truncate non-string → estimate 0', nonStr.estimate === 0);
  const emptyIn = truncateToTokenBudget('', 100);
  assert('truncate empty input → not truncated, empty', emptyIn.text === '' && emptyIn.truncated === false && emptyIn.estimate === 0);
}

// ---------------------------------------------------------------------------
// determinism — same input twice yields identical results
// ---------------------------------------------------------------------------
{
  const t = 'deterministic { check } with [some] symbols and words 12345';
  assert('estimateTokens is deterministic', estimateTokens(t) === estimateTokens(t));
  const a = truncateToTokenBudget(t, 4);
  const b = truncateToTokenBudget(t, 4);
  assert('truncateToTokenBudget is deterministic', a.text === b.text && a.estimate === b.estimate && a.truncated === b.truncated);
}

// ---------------------------------------------------------------------------
console.log(`prompt-token-estimate-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
