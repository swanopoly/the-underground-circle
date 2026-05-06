/**
 * web-search-auto-detect-smoketest — pins the heuristic that decides
 * whether a chat message should auto-attach OpenRouter web search.
 * Regression on this means false positives (cost + latency on every
 * code question) or false negatives (user types "today's news" and
 * the model answers from 2024).
 *
 * Run: npm run smoke:web-search-auto-detect
 */

import { shouldAutoAttachWebSearch, decideWebSearchForTurn } from '../src/lib/webSearchAutoDetect';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ── Strong positives — should trigger ──────────────────────────
  const shouldTrigger = [
    'What were the major AI announcements this week?',
    'Latest GPT-5 pricing?',
    'What is the weather in Austin today',
    'Who is the current CEO of OpenAI?',
    'Is Bitcoin up or down right now',
    'What just happened in the Lakers game',
    'Latest version of Next.js',
    'What was announced at the Anthropic event today',
    'Stock price of NVDA',
    'When did Claude 4.7 release',
    'Search the web for benchmark results on Llama 4',
    'What\'s happening in the news',
    'Find out who won the election',
    'Read this for me: https://example.com/article',
    'Who is the prime minister of Canada',
    'What are the playoffs standings',
  ];
  for (const msg of shouldTrigger) {
    const r = shouldAutoAttachWebSearch(msg);
    assert(r.auto, `triggers: "${msg.slice(0, 60)}"`, r.debug ? `score=${r.debug.score}` : '');
  }

  // ── Strong negatives — should NOT trigger ──────────────────────
  const shouldNotTrigger = [
    'Write a TypeScript function that parses today\'s date',          // code + "today" but coding wins
    'How does React useEffect work',
    'Explain the difference between var, let, and const',
    'Refactor this function to be async',
    '```js\nfunction add(a,b){return a+b}\n```\nWhat does this return?',
    'Implement a binary search tree',
    'How do I format a date as YYYY-MM-DD',
    'What is the time complexity of quicksort',
    'Write a poem about the ocean',                                    // creative work, no time anchor
    'What\'s 17 * 23',                                                 // math
    'Explain monads',
    'Born in 1985, what year would they be 40',                        // historical anchor
  ];
  for (const msg of shouldNotTrigger) {
    const r = shouldAutoAttachWebSearch(msg);
    assert(!r.auto, `skips: "${msg.slice(0, 60)}"`, r.debug ? `pos=${r.debug.positiveHits.length}, neg=${r.debug.negativeHits.length}, score=${r.debug.score}` : '');
  }

  // ── Edge cases ─────────────────────────────────────────────────
  assert(!shouldAutoAttachWebSearch('').auto, 'empty string → no trigger');
  assert(!shouldAutoAttachWebSearch('hi').auto, 'too short → no trigger');
  assert(!shouldAutoAttachWebSearch('   ').auto, 'whitespace → no trigger');

  // Reason exposure
  const r1 = shouldAutoAttachWebSearch('What was announced today by Anthropic');
  assert(typeof r1.reason === 'string' && r1.reason.length > 0,
    'returns a human-readable reason when triggered',
    `got reason="${r1.reason}"`);

  // ── decideWebSearchForTurn — toggle integration ────────────────
  // Toggle on → always attach, never auto.
  {
    const d = decideWebSearchForTurn('How does useEffect work', true);
    assert(d.attach && !d.auto, 'toggle on + code question → attach (manual), auto=false');
  }
  // Toggle off + current-events question → attach via auto.
  {
    const d = decideWebSearchForTurn('What\'s happening in AI news today', false);
    assert(d.attach && d.auto && typeof d.reason === 'string',
      'toggle off + news question → attach via auto, reason exposed');
  }
  // Toggle off + code question → don\'t attach.
  {
    const d = decideWebSearchForTurn('Write a Python function to sort a list', false);
    assert(!d.attach && !d.auto, 'toggle off + code question → no attach');
  }

  if (failures > 0) {
    console.error(`\n${failures} web-search-auto-detect smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll web-search-auto-detect smoke cases passed.');
}

main();
