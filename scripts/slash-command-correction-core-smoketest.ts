/**
 * slash-command-correction-core-smoketest — pins the pure slash-command
 * typo corrector (src/lib/slashCommandCorrectionCore.ts) that stops a
 * typo'd command ('/reserach', '/contxt') from silently falling through to
 * the LLM as plain chat. Load-bearing assertions:
 *
 *   levenshtein: classic distances (kitten/sitting=3), symmetry, case
 *   sensitivity, non-strings treated as '', both sides capped at
 *   MAX_LEVENSHTEIN_COMPARE_LENGTH (64) so huge inputs stay bounded.
 *
 *   suggestSlashCommand: non-slash input → neutral {isSlash:false}; exact
 *   leading-token match (case-insensitive, multi-word registry commands
 *   register by first token) → exact:true and NEVER suggests; typos within
 *   edit distance ≤2 or shared prefix ≥3 → up to 3 suggestions best first
 *   (distance, then prefix, then length, then alphabetical); 1–2 char junk
 *   tokens ('/x') suggest nothing; '//help' → d=0 rescue; junk known
 *   entries skipped; known list scan capped at MAX_KNOWN_COMMANDS (512);
 *   fresh arrays every call (no shared mutable state).
 *
 *   buildDidYouMean: exact rendered string with the typo'd token echoed in
 *   backticks (or the generic head when no token), junk/duplicate
 *   suggestions filtered, at most 3 rendered, backticks stripped from the
 *   echoed token, empty/invalid suggestions → ''.
 *
 *   And: every export is total — degenerate input (null/undefined/{}/[]/
 *   wrong types/huge strings) never throws.
 *
 * Pure — loads under tsx (slashCommandCorrectionCore has zero imports).
 */

import {
  levenshtein,
  suggestSlashCommand,
  buildDidYouMean,
  MAX_LEVENSHTEIN_COMPARE_LENGTH,
  MAX_SLASH_SUGGESTIONS,
  MAX_KNOWN_COMMANDS,
  type SlashSuggestion,
} from '../src/lib/slashCommandCorrectionCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Realistic known-command list: registry first tokens + aliases + extras. */
const KNOWN: string[] = [
  '/help', '/commands', '/summary', '/status', '/wiki', '/research',
  '/memories', '/memory', '/memory-bank', '/schedule', '/cron', '/remember',
  '/forget', '/reasoning-standard', '/deep-reasoning', '/mission',
  '/task new', '/room', '/gh', '/gh status', '/wp', '/run', '/vault',
  '/browser', '/watch', '/summarize', '/translate', '/classify',
  '/zero-shot', '/qa', '/imagine', '/vision', '/openmodel', '/bestof',
  '/best-of-n', '/review', '/create', '/make', '/apps', '/integrations',
  '/integration', '/screen', '/context', '/build-page', '/build', '/code',
  '/speak', '/hf', '/vote', '/votes', '/poll', '/propose', '/proposals',
  '/pin', '/pins', '/search', '/trace',
];

function main(): void {
  // ─── (1) levenshtein basics ───────────────────────────────────────────────
  assertEq(levenshtein('abc', 'abc'), 0, '(1) identical strings → 0');
  assertEq(levenshtein('', ''), 0, '(1) two empties → 0');
  assertEq(levenshtein('abc', ''), 3, '(1) vs empty → length');
  assertEq(levenshtein('', 'xy'), 2, '(1) empty vs → length');
  assertEq(levenshtein('kitten', 'sitting'), 3, '(1) kitten/sitting classic 3');
  assertEq(levenshtein('flaw', 'lawn'), 2, '(1) flaw/lawn classic 2');
  assertEq(levenshtein('research', 'reserach'), 2, '(1) the target typo is distance 2');
  assertEq(levenshtein('context', 'contxt'), 1, '(1) contxt is distance 1');
  assertEq(levenshtein('a', 'A'), 1, '(1) raw compare is case-sensitive');
  assertEq(
    levenshtein('reserach', 'research'),
    levenshtein('research', 'reserach'),
    '(1) symmetric',
  );

  // ─── (2) levenshtein caps + coercion ─────────────────────────────────────
  assertEq(MAX_LEVENSHTEIN_COMPARE_LENGTH, 64, '(2) compare cap pinned at 64');
  assertEq(levenshtein(null, 'abc'), 3, '(2) null left → treated as empty');
  assertEq(levenshtein(undefined, undefined), 0, '(2) both undefined → 0');
  assertEq(levenshtein(123, '123'), 3, '(2) number is NOT coerced to its digits');
  assertEq(levenshtein({}, []), 0, '(2) object vs array → both empty → 0');
  assertEq(levenshtein('a'.repeat(65), 'a'.repeat(64)), 0, '(2) tail beyond cap ignored');
  assertEq(
    levenshtein(`${'a'.repeat(64)}X`, `${'a'.repeat(64)}Y`),
    0,
    '(2) difference past the cap is invisible',
  );
  assertEq(levenshtein('a'.repeat(5000), 'b'), 64, '(2) huge vs tiny → capped distance');
  assertEq(
    levenshtein('x'.repeat(100000), 'y'.repeat(100000)),
    64,
    '(2) two huge strings → result never exceeds the cap',
  );

  // ─── (3) non-slash input → neutral ───────────────────────────────────────
  const plain = suggestSlashCommand('hello world', KNOWN);
  assertEq(plain.isSlash, false, '(3) plain text is not a slash message');
  assertEq(plain.exact, false, '(3) plain text is never exact');
  assertEq(plain.suggestions.length, 0, '(3) plain text gets no suggestions');
  assertEq(suggestSlashCommand('', KNOWN).isSlash, false, '(3) empty string neutral');
  assertEq(suggestSlashCommand('   ', KNOWN).isSlash, false, '(3) whitespace-only neutral');
  assertEq(suggestSlashCommand('research stuff', KNOWN).isSlash, false, '(3) bare command word without slash is plain chat');
  assertEq(suggestSlashCommand('see /help now', KNOWN).isSlash, false, '(3) mid-sentence slash is not a slash message');
  assertEq(suggestSlashCommand(null, KNOWN).isSlash, false, '(3) null input neutral');
  assertEq(suggestSlashCommand(42, KNOWN).isSlash, false, '(3) numeric input neutral');
  assert(Array.isArray(suggestSlashCommand(undefined, undefined).suggestions), '(3) neutral result still carries a real array');

  // ─── (4) exact matches — never suggest ───────────────────────────────────
  const exactHelp = suggestSlashCommand('/help', KNOWN);
  assertEq(exactHelp.isSlash, true, '(4) /help is a slash message');
  assertEq(exactHelp.exact, true, '(4) /help is exact');
  assertEq(exactHelp.suggestions.length, 0, '(4) exact match NEVER suggests');
  assertEq(suggestSlashCommand('/HELP', KNOWN).exact, true, '(4) exact match is case-insensitive');
  assertEq(suggestSlashCommand('/gh status', KNOWN).exact, true, '(4) leading token of a multi-word input matches /gh');
  assertEq(suggestSlashCommand('/task new fix the bug', KNOWN).exact, true, '(4) /task registered via first token of "/task new"');
  assertEq(suggestSlashCommand('/memory-bank update brief', KNOWN).exact, true, '(4) hyphenated command exact');
  assertEq(suggestSlashCommand('  /watch  daily prices  ', KNOWN).exact, true, '(4) surrounding whitespace tolerated');
  assertEq(suggestSlashCommand('/gh', ['/gh status']).exact, true, '(4) known list with ONLY multi-word form still yields exact /gh');

  // ─── (5) typo suggestions — the finding’s exact cases ────────────────────
  const reserach = suggestSlashCommand('/reserach quantum computing', KNOWN);
  assertEq(reserach.isSlash, true, '(5) /reserach is a slash message');
  assertEq(reserach.exact, false, '(5) /reserach is not exact');
  assertEq(reserach.suggestions[0], '/research', '(5) /reserach → /research first');
  assertEq(reserach.suggestions.length, 1, '(5) /reserach → only /research is close enough');
  const contxt = suggestSlashCommand('/contxt', KNOWN);
  assertEq(contxt.suggestions[0], '/context', '(5) /contxt → /context first');
  assertEq(contxt.suggestions.length, 1, '(5) /contxt → single suggestion');
  const hep = suggestSlashCommand('/hep', KNOWN);
  assertEq(hep.suggestions[0], '/help', '(5) /hep → /help');
  assertEq(hep.suggestions.length, 1, '(5) /hep → short 2-char commands not dragged in');
  assertEq(suggestSlashCommand('/serach for docs', KNOWN).suggestions[0], '/search', '(5) /serach → /search');
  assertEq(suggestSlashCommand('/vualt', KNOWN).suggestions[0], '/vault', '(5) /vualt → /vault');
  assertEq(suggestSlashCommand('/statu', KNOWN).suggestions[0], '/status', '(5) /statu → /status');

  // ─── (6) prefix rule, ordering, and the 3-suggestion cap ─────────────────
  const summ = suggestSlashCommand('/summ', KNOWN);
  assertEq(summ.suggestions.length, 2, '(6) /summ → both summary-family commands');
  assertEq(summ.suggestions[0], '/summary', '(6) smaller edit distance ranks first');
  assertEq(summ.suggestions[1], '/summarize', '(6) larger edit distance second');
  const mem = suggestSlashCommand('/mem', KNOWN);
  assertEq(mem.suggestions.length, 3, '(6) /mem → three memory-family commands');
  assertEq(mem.suggestions[0], '/memory', '(6) /memory first (distance 3)');
  assertEq(mem.suggestions[1], '/memories', '(6) /memories second (distance 5)');
  assertEq(mem.suggestions[2], '/memory-bank', '(6) /memory-bank third (distance 8)');
  const capped = suggestSlashCommand('/aaa', ['/aaa4', '/aaa3', '/aaa1', '/aaa2']);
  assertEq(capped.suggestions.length, MAX_SLASH_SUGGESTIONS, '(6) four eligible → capped at 3');
  assertEq(capped.suggestions.join(','), '/aaa1,/aaa2,/aaa3', '(6) ties break alphabetically, independent of known order');
  assertEq(suggestSlashCommand('/x', KNOWN).suggestions.length, 0, '(6) 1-char junk token suggests nothing');

  // ─── (7) junk-tolerant known list + scan cap ─────────────────────────────
  const junkKnown = suggestSlashCommand('/hep', ['/help', 42, null, '', '   ', 'nope', {}, [], '/help', undefined, true] as unknown[]);
  assertEq(junkKnown.suggestions.length, 1, '(7) junk + duplicate known entries collapse to one');
  assertEq(junkKnown.suggestions[0], '/help', '(7) surviving entry still suggested');
  const noArray = suggestSlashCommand('/hep', null);
  assertEq(noArray.isSlash, true, '(7) non-array known still reports slash-ness');
  assertEq(noArray.suggestions.length, 0, '(7) non-array known → no suggestions');
  assertEq(suggestSlashCommand('/hep', 'not-an-array').suggestions.length, 0, '(7) string known treated as empty');
  assertEq(suggestSlashCommand('/hep', ['help']).suggestions.length, 0, '(7) known entry without leading slash is junk');
  const bigKnown: string[] = [];
  for (let i = 0; i < 600; i += 1) bigKnown.push(`/filler${i}`);
  bigKnown[550] = '/target';
  assertEq(MAX_KNOWN_COMMANDS, 512, '(7) known scan cap pinned at 512');
  assertEq(suggestSlashCommand('/filler3', bigKnown).exact, true, '(7) entry inside the cap is seen');
  const beyondCap = suggestSlashCommand('/target', bigKnown);
  assertEq(beyondCap.exact, false, '(7) entry beyond the cap is ignored (fail-safe, not fail-slow)');
  assertEq(beyondCap.suggestions.length, 0, '(7) nothing near /target among capped fillers');

  // ─── (8) malformed slash forms ───────────────────────────────────────────
  const doubleSlash = suggestSlashCommand('//help', KNOWN);
  assertEq(doubleSlash.exact, false, '(8) //help is not literally a known command');
  assertEq(doubleSlash.suggestions[0], '/help', '(8) //help rescued via distance-0 name match');
  assertEq(suggestSlashCommand('/help?', KNOWN).suggestions[0], '/help', '(8) trailing punctuation → nearest command');
  const bareSlash = suggestSlashCommand('/', KNOWN);
  assertEq(bareSlash.isSlash, true, '(8) bare / is a slash message');
  assertEq(bareSlash.suggestions.length, 0, '(8) bare / has no name to correct');
  const hugeToken = suggestSlashCommand(`/${'z'.repeat(100000)} rest of message`, KNOWN);
  assertEq(hugeToken.isSlash, true, '(8) huge token still classified as slash');
  assertEq(hugeToken.suggestions.length, 0, '(8) huge token matches nothing and stays bounded');

  // ─── (9) buildDidYouMean rendering ───────────────────────────────────────
  assertEq(
    buildDidYouMean('/reserach quantum', ['/research', '/review']),
    "`/reserach` isn't a command I know. Did you mean: /research, /review?  (or just send it as a message)",
    '(9) token-echo rendering pinned exactly',
  );
  assertEq(
    buildDidYouMean(42, ['/research']),
    "That isn't a command I know. Did you mean: /research?  (or just send it as a message)",
    '(9) non-string input → generic head',
  );
  assertEq(buildDidYouMean('/x', []), '', '(9) empty suggestions → empty string');
  assertEq(buildDidYouMean('/x', null), '', '(9) null suggestions → empty string');
  assertEq(buildDidYouMean('/x', 'nope'), '', '(9) non-array suggestions → empty string');
  assertEq(buildDidYouMean('/x', [7, '', 'research']), '', '(9) no valid slash entries → empty string');
  assertEq(
    buildDidYouMean('/x', ['bad', 7, '/ok', '/ok', '/dup'] as unknown[]),
    "`/x` isn't a command I know. Did you mean: /ok, /dup?  (or just send it as a message)",
    '(9) junk filtered + duplicates collapsed',
  );
  const overCap = buildDidYouMean('/q', ['/a1', '/b2', '/c3', '/d4']);
  assert(overCap.includes('Did you mean: /a1, /b2, /c3?'), '(9) only first three suggestions rendered', overCap);
  assert(!overCap.includes('/d4'), '(9) fourth suggestion dropped');
  const backticked = buildDidYouMean('/`hi`', ['/help']);
  assert(backticked.includes('`/hi`'), '(9) backticks stripped from echoed token', backticked);
  assert(!backticked.includes('``'), '(9) no doubled backticks in output');
  assert(buildDidYouMean('/', ['/help']).startsWith("That isn't"), '(9) bare / falls back to generic head');
  assert(buildDidYouMean('plain text', ['/help']).startsWith("That isn't"), '(9) non-slash input falls back to generic head');
  const bigSuggestions: string[] = [];
  for (let i = 0; i < 10000; i += 1) bigSuggestions.push(`/s${i}`);
  assert(
    buildDidYouMean('/x', bigSuggestions).includes('/s0, /s1, /s2'),
    '(9) huge suggestion array → first three, bounded',
  );

  // ─── (10) determinism, freshness, bounds ─────────────────────────────────
  assertEq(
    JSON.stringify(suggestSlashCommand('/reserach', KNOWN)),
    JSON.stringify(suggestSlashCommand('/reserach', KNOWN)),
    '(10) same input → identical result (deterministic)',
  );
  assertEq(
    buildDidYouMean('/contxt', ['/context']),
    buildDidYouMean('/contxt', ['/context']),
    '(10) rendering deterministic',
  );
  const fresh: SlashSuggestion = suggestSlashCommand('/mem', KNOWN);
  fresh.suggestions.push('/mutated');
  assertEq(suggestSlashCommand('/mem', KNOWN).suggestions.length, 3, '(10) mutating a result never leaks into the next call');
  assert(
    suggestSlashCommand('/mem', KNOWN).suggestions.length <= MAX_SLASH_SUGGESTIONS,
    '(10) suggestion count always within cap',
  );
  assertEq(MAX_SLASH_SUGGESTIONS, 3, '(10) suggestion cap pinned at 3');
  const boundedEntry = suggestSlashCommand('/hep', [`/${'h'.repeat(500)}elp`, '/help']);
  assert(
    boundedEntry.suggestions.every((s) => s.length <= 81),
    '(10) suggestion strings stay bounded even from oversized known entries',
  );

  // ─── (11) degenerate input never throws ──────────────────────────────────
  const degenerates: unknown[] = [
    null, undefined, {}, [], 0, -1, 3.14, NaN, true, false, 'x', '/',
    () => {}, Symbol('s'), [[]], [{}], new Array(5),
    { length: 3 }, [null, undefined, NaN, () => {}],
  ];
  try {
    for (const d of degenerates) {
      levenshtein(d, d);
      levenshtein(d, 'help');
      levenshtein('help', d);
      suggestSlashCommand(d, d);
      suggestSlashCommand('/help', d);
      suggestSlashCommand(d, KNOWN);
      buildDidYouMean(d, d);
      buildDidYouMean(d, ['/help']);
      buildDidYouMean('/x', d);
    }
    const neutral = suggestSlashCommand(null, null);
    assertEq(neutral.isSlash, false, '(11) null/null → neutral shape');
    assert(Array.isArray(neutral.suggestions), '(11) neutral suggestions is a real array');
    assertEq(buildDidYouMean(null, null), '', '(11) null/null render → empty string');
    assertEq(typeof levenshtein(Symbol('a'), Symbol('b')), 'number', '(11) symbols → still a number');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll slash-command-correction-core smoke cases passed (${passes} passed).`);
}

main();
