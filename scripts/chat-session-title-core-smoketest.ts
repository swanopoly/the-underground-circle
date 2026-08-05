/**
 * chat-session-title-core-smoketest — pins the pure session-title +
 * thread-preference derivation extracted from ChatTab (decomposition unit U6,
 * src/lib/chatSessionTitleCore.ts). Load-bearing assertions:
 *
 *   DERIVE (deriveSessionTitleFromMessage): stop-word filtering keeps the
 *   request's nouns/verbs ("Please help me build a login screen" ->
 *   "Login Screen"), title-casing preserves all-caps short tokens
 *   ("API rate limits" -> "API Rate Limits"), URLs and @/#-mentions are
 *   stripped, empty / whitespace / punctuation-only input falls back to
 *   SESSION_FALLBACK_TITLE, and a <2-meaningful-word message falls back to its
 *   raw first three words ("hi" -> "Hi").
 *
 *   AUTO-NAMED (isAutoNamedSession): '', the OpenSwan Session fallback, and
 *   'New Chat' are overwritable placeholders (case/whitespace-insensitive);
 *   a real title is not; bare 'openswan' is not.
 *
 *   MODEL PREF (normalizeThreadModelPreference): blank / whitespace / the
 *   legacy 'openswan' sentinel -> DEFAULT_CHAT_MODEL ('auto'); any other value
 *   passes through with original casing/whitespace preserved.
 *
 *   And: deterministic (no Date.now/Math.random), output bounded, and every
 *   export is total — degenerate/hostile input never throws.
 *
 * Pure — loads under tsx (chatSessionTitleCore has zero imports).
 */

import {
  SESSION_FALLBACK_TITLE,
  DEFAULT_CHAT_MODEL,
  TITLE_STOP_WORDS,
  formatSessionTitleWord,
  deriveSessionTitleFromMessage,
  isAutoNamedSession,
  normalizeThreadModelPreference,
} from '../src/lib/chatSessionTitleCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes++;
  else {
    failures++;
    console.error(`FAIL: ${msg}${extra ? ' :: ' + extra : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function noThrow(label: string, fn: () => unknown): void {
  try {
    fn();
    assert(true, `${label} does not throw`);
  } catch (e) {
    assert(false, `${label} does not throw`, String(e));
  }
}

/** A hard cap the core applies to any returned title (safety bound). */
const SESSION_TITLE_MAX = 120;

function main(): void {
  // (1) constants + shared invariants
  assertEq(SESSION_FALLBACK_TITLE, 'OpenSwan Session', 'SESSION_FALLBACK_TITLE value');
  assertEq(DEFAULT_CHAT_MODEL, 'auto', 'DEFAULT_CHAT_MODEL value');
  assert(TITLE_STOP_WORDS instanceof Set, 'TITLE_STOP_WORDS is a Set');
  assertEq(TITLE_STOP_WORDS.size, 31, 'TITLE_STOP_WORDS has the expected stop words');
  assert(TITLE_STOP_WORDS.has('the') && TITLE_STOP_WORDS.has('please') && TITLE_STOP_WORDS.has('build'), 'stop words include filler tokens');
  assert(!TITLE_STOP_WORDS.has('login') && !TITLE_STOP_WORDS.has('deploy'), 'stop words exclude meaningful tokens');
  // The fallback title must itself read as auto-named, so it is overwritable.
  assert(isAutoNamedSession(SESSION_FALLBACK_TITLE), 'fallback title is treated as auto-named');

  // (2) formatSessionTitleWord — capitalization + all-caps short-token preserve
  assertEq(formatSessionTitleWord('hello'), 'Hello', 'lower word -> Capitalized');
  assertEq(formatSessionTitleWord('HELLO'), 'Hello', 'long all-caps word -> Capitalized');
  assertEq(formatSessionTitleWord('login'), 'Login', 'login -> Login');
  assertEq(formatSessionTitleWord('mIxEd'), 'Mixed', 'mixed case normalized');
  assertEq(formatSessionTitleWord('API'), 'API', 'short all-caps token preserved (len<=4)');
  assertEq(formatSessionTitleWord('SQL'), 'SQL', 'SQL preserved');
  assertEq(formatSessionTitleWord('AI'), 'AI', 'AI preserved');
  assertEq(formatSessionTitleWord('APIS'), 'APIS', '4-char all-caps preserved');
  assertEq(formatSessionTitleWord('CLOUD'), 'Cloud', '5-char all-caps not preserved (len>4)');
  assertEq(formatSessionTitleWord('a'), 'A', 'single char capitalized');
  assertEq(formatSessionTitleWord(''), '', 'empty word -> empty');

  // (3) deriveSessionTitleFromMessage — representative real messages
  assertEq(deriveSessionTitleFromMessage('Please help me build a login screen'), 'Login Screen', 'stop-word filtering + capitalization');
  assertEq(deriveSessionTitleFromMessage('Deploy the production database migration'), 'Deploy Production Database', 'takes first three meaningful words');
  assertEq(deriveSessionTitleFromMessage('API rate limits'), 'API Rate Limits', 'all-caps short token survives derivation');
  assertEq(deriveSessionTitleFromMessage('Check out https://example.com/foo for the api docs'), 'Check Out Api', 'URL is stripped before deriving');
  assert(!deriveSessionTitleFromMessage('see https://a.co/x now please').toLowerCase().includes('http'), 'derived title never contains a URL');
  assertEq(deriveSessionTitleFromMessage('@channel please review #urgent build'), 'Please Review Build', 'mentions stripped; <2 meaningful words falls back to raw words');
  assertEq(deriveSessionTitleFromMessage('hi'), 'Hi', 'single short word falls back to capitalized raw word');
  assertEq(deriveSessionTitleFromMessage("don't panic yet"), "Don't Panic Yet", 'internal apostrophes preserved in title-cased words');

  // (4) deriveSessionTitleFromMessage — fallback on empty / degenerate content
  assertEq(deriveSessionTitleFromMessage(''), SESSION_FALLBACK_TITLE, 'empty content -> fallback');
  assertEq(deriveSessionTitleFromMessage('   \n\t  '), SESSION_FALLBACK_TITLE, 'whitespace-only -> fallback');
  assertEq(deriveSessionTitleFromMessage('!!! @#$ %%%'), SESSION_FALLBACK_TITLE, 'punctuation-only -> fallback');
  // "the a an to of": no word passes the (len>2 && !stopword) filter, so the
  // raw-words fallback title-cases the first three tokens.
  assertEq(deriveSessionTitleFromMessage('the a an to of'), 'The A An', 'no meaningful words -> first raw words title-cased');
  assert(deriveSessionTitleFromMessage('build create make help').length > 0, 'all-stop-words still yields a non-empty title');

  // (5) isAutoNamedSession — placeholder vs real title
  assert(isAutoNamedSession(''), 'empty is auto-named');
  assert(isAutoNamedSession('OpenSwan Session'), 'exact fallback is auto-named');
  assert(isAutoNamedSession('openswan session'), 'lowercase fallback is auto-named');
  assert(isAutoNamedSession('  OpenSwan Session  '), 'padded fallback is auto-named (trimmed)');
  assert(isAutoNamedSession('New Chat'), 'New Chat is auto-named');
  assert(isAutoNamedSession('new chat'), 'lowercase new chat is auto-named');
  assert(isAutoNamedSession(null), 'null is auto-named');
  assert(isAutoNamedSession(undefined), 'undefined is auto-named');
  assert(!isAutoNamedSession('Login Screen'), 'real title is NOT auto-named');
  assert(!isAutoNamedSession('My Project'), 'custom title is NOT auto-named');
  assert(!isAutoNamedSession('openswan'), 'bare "openswan" is NOT auto-named (precision)');
  assert(!isAutoNamedSession('OpenSwan Session Two'), 'suffixed fallback is NOT auto-named');

  // (6) normalizeThreadModelPreference — sentinel -> auto, else passthrough
  assertEq(normalizeThreadModelPreference(''), DEFAULT_CHAT_MODEL, 'empty pref -> auto');
  assertEq(normalizeThreadModelPreference('   '), DEFAULT_CHAT_MODEL, 'whitespace pref -> auto');
  assertEq(normalizeThreadModelPreference(null), DEFAULT_CHAT_MODEL, 'null pref -> auto');
  assertEq(normalizeThreadModelPreference(undefined), DEFAULT_CHAT_MODEL, 'undefined pref -> auto');
  assertEq(normalizeThreadModelPreference('openswan'), DEFAULT_CHAT_MODEL, 'legacy openswan sentinel -> auto');
  assertEq(normalizeThreadModelPreference('OpenSwan'), DEFAULT_CHAT_MODEL, 'cased openswan sentinel -> auto');
  assertEq(normalizeThreadModelPreference('  openswan  '), DEFAULT_CHAT_MODEL, 'padded openswan sentinel -> auto');
  assertEq(normalizeThreadModelPreference('auto'), 'auto', 'auto pref passes through');
  assertEq(normalizeThreadModelPreference('gpt-4o'), 'gpt-4o', 'model id passes through');
  assertEq(normalizeThreadModelPreference('GPT-4o'), 'GPT-4o', 'original casing preserved on passthrough');
  assertEq(normalizeThreadModelPreference('openrouter/auto'), 'openrouter/auto', 'provider-prefixed id passes through');
  assertEq(normalizeThreadModelPreference('  claude-opus  '), '  claude-opus  ', 'passthrough preserves surrounding whitespace verbatim');

  // (7) determinism + boundedness
  assertEq(
    deriveSessionTitleFromMessage('Please help me build a login screen'),
    deriveSessionTitleFromMessage('Please help me build a login screen'),
    'derivation is deterministic across calls',
  );
  assertEq(normalizeThreadModelPreference('gpt-4o'), normalizeThreadModelPreference('gpt-4o'), 'normalize is deterministic');
  const hugeWord = deriveSessionTitleFromMessage('x'.repeat(500_000));
  assert(typeof hugeWord === 'string' && hugeWord.length > 0, 'huge single-word input yields a non-empty title');
  assert(hugeWord.length <= SESSION_TITLE_MAX, 'huge single-word title stays bounded', `len ${hugeWord.length}`);
  const hugeWords = deriveSessionTitleFromMessage('deploy '.repeat(200_000));
  assert(hugeWords.length <= SESSION_TITLE_MAX, 'huge many-word title stays bounded', `len ${hugeWords.length}`);
  assertEq(hugeWords, 'Deploy Deploy Deploy', 'huge repeated-word input still yields first three words');

  // (8) hostile / degenerate input at every export — never throws
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    123,
    NaN,
    true,
    {},
    [],
    { toString() { throw new Error('boom'); } },
    Symbol('s'),
    () => 'nope',
    'z'.repeat(2_000_000),
  ];
  // give one input a self-reference (cyclic) to prove no deep traversal
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  hostile.push(cyclic);

  for (const input of hostile) {
    const label = (() => {
      try { return String(typeof input); } catch { return 'weird'; }
    })();
    noThrow(`deriveSessionTitleFromMessage(${label})`, () => deriveSessionTitleFromMessage(input as string));
    noThrow(`formatSessionTitleWord(${label})`, () => formatSessionTitleWord(input as string));
    noThrow(`isAutoNamedSession(${label})`, () => isAutoNamedSession(input as string));
    noThrow(`normalizeThreadModelPreference(${label})`, () => normalizeThreadModelPreference(input as string));
  }

  // (9) degenerate calls still return the documented safe shape
  assertEq(deriveSessionTitleFromMessage(null as unknown as string), SESSION_FALLBACK_TITLE, 'null message -> fallback title');
  assertEq(deriveSessionTitleFromMessage(42 as unknown as string), SESSION_FALLBACK_TITLE, 'number message -> fallback title');
  assertEq(deriveSessionTitleFromMessage({} as unknown as string), SESSION_FALLBACK_TITLE, 'object message -> fallback title');
  assertEq(typeof deriveSessionTitleFromMessage(undefined as unknown as string), 'string', 'derive always returns a string');
  assertEq(formatSessionTitleWord(99 as unknown as string), '', 'non-string word -> empty');
  assertEq(typeof formatSessionTitleWord(null as unknown as string), 'string', 'format always returns a string');
  assertEq(isAutoNamedSession(123 as unknown as string), true, 'non-string title treated as unnamed');
  assertEq(isAutoNamedSession({} as unknown as string), true, 'object title treated as unnamed');
  assertEq(normalizeThreadModelPreference(123 as unknown as string), DEFAULT_CHAT_MODEL, 'non-string pref -> auto');
  assertEq(normalizeThreadModelPreference([] as unknown as string), DEFAULT_CHAT_MODEL, 'array pref -> auto');
  assertEq(typeof normalizeThreadModelPreference(Symbol('m') as unknown as string), 'string', 'normalize always returns a string');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chatSessionTitleCore smoke cases passed (${passes} passed).`);
}

main();
