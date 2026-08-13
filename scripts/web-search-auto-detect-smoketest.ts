/**
 * web-search-auto-detect-smoketest — pins the heuristic that decides
 * whether a chat message should auto-attach OpenRouter web search.
 * Regression on this means false positives (cost + latency on every
 * code question) or false negatives (user types "today's news" and
 * the model answers from 2024).
 *
 * Run: npm run smoke:web-search-auto-detect
 */

import {
  shouldAutoAttachWebSearch,
  decideWebSearchForTurn,
  isConversationOnlyTurn,
  runOptionalWebSearchLane,
} from '../src/lib/webSearchAutoDetect';
import fs from 'node:fs';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
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
    'hello',                                                           // pure conversation
    'Hey there!',                                                      // pure conversation
    'Thanks',                                                          // acknowledgement
    'How are you?',                                                    // social question
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
  // Toggle on → attach for substantive turns, never auto.
  {
    const d = decideWebSearchForTurn('How does useEffect work', true);
    assert(d.attach && !d.auto, 'toggle on + code question → attach (manual), auto=false');
  }
  // A persistent toggle must not turn a greeting into a required tool call.
  // 'sup'/'wassup'/"what's good" added 2026-08-07: a real "sup" reached the
  // search lane, failed on the OpenRouter key, and prefixed the reply with a
  // paragraph about API keys. The greeting list is the thing that stops that.
  for (const greeting of [
    'hello', 'Hi!', 'hey there', 'Good morning OpenSwan', 'Thanks', 'How are you?',
    'sup', 'Sup!', 'wassup', "what's good", 'yo',
  ]) {
    const d = decideWebSearchForTurn(greeting, true);
    assert(!d.attach && !d.auto, `toggle on + conversation-only turn stays plain chat: "${greeting}"`);
    assert(isConversationOnlyTurn(greeting), `classifies conversation-only turn: "${greeting}"`);
  }
  // A greeting prefix must not hide a substantive current-information request.
  {
    const msg = 'Hello, what is the latest AI news today?';
    const d = decideWebSearchForTurn(msg, true);
    assert(d.attach && !d.auto && !isConversationOnlyTurn(msg), 'greeting plus real request still honors manual web search');
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

  // ── Optional lane terminal contract ─────────────────────────────────
  {
    let calls = 0;
    const result = await runOptionalWebSearchLane(
      { attach: false, auto: false },
      async () => { calls += 1; return 'unexpected'; },
    );
    assert(result.status === 'skipped' && calls === 0, 'optional lane skips without invoking search');
  }
  {
    let calls = 0;
    const result = await runOptionalWebSearchLane(
      { attach: true, auto: true, reason: 'current state' },
      async () => { calls += 1; return { response: 'fresh answer' }; },
    );
    assert(result.status === 'completed' && calls === 1, 'optional lane returns one successful search result');
  }
  {
    const missingKey = Object.assign(
      new Error('key_missing: Add your own OpenRouter API key.'),
      { code: 'key_missing', status: 400 },
    );
    const result = await runOptionalWebSearchLane(
      { attach: true, auto: false },
      async () => { throw missingKey; },
    );
    assert(result.status === 'degraded', 'search rejection resolves to degraded instead of throwing');
    assert(
      result.status === 'degraded'
        && result.failureCode === 'key_missing'
        && /plain Chat/i.test(result.userNotice)
        && /not claim.*web-verified/i.test(result.promptContext),
      'degraded key_missing keeps a safe provider notice and verification caveat',
    );
  }

  // Chat wiring: optional search failure must fall through to the canonical
  // path, not create a second provider router or a failed-action receipt.
  {
    const chatSource = fs.readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
    const start = chatSource.indexOf('// ─── Web Search routing (Phase 0 + auto-detect)');
    const end = chatSource.indexOf('// ─── Model capability routing', start);
    const webBlock = start >= 0 && end > start ? chatSource.slice(start, end) : '';
    assert(webBlock.includes('runOptionalWebSearchLane(webDecision'), 'Chat runs the injected optional Web Search lane');
    assert(!webBlock.includes("import('../../../lib/universalInvoke')"), 'search degradation does not start a duplicate provider router');
    assert(!webBlock.includes('addRecoverableChatErrorMessage({'), 'search-only failure does not create action recovery or a failed receipt');
    // Reversed 2026-08-07 by request: a failed enrichment lane is pipeline
    // detail, not chat copy. The user hit it by typing "sup" and got a
    // paragraph about OpenRouter keys before the reply. What must survive is
    // the MODEL-side context (asserted next), not a user-visible bubble.
    assert(
      !webBlock.includes("surface: 'web_search_degraded'")
        && !webBlock.includes('webSearchOutcome.userNotice'),
      'search degradation stays backend-only and is never rendered as a Chat notice',
    );
    assert(
      // In-order presence, not adjacency: other prompt parts may be inserted
      // between them (boundedMultiActionPromptBlock was, 2026-08-13) without
      // breaking the guarantee this pins — the degradation context rides the
      // same prompt-parts array as the user's message.
      /webSearchDegradationContext,[\s\S]{0,400}?cleanContent,\s*\][\s\S]{0,80}?\.filter\(Boolean\)/.test(chatSource),
      'canonical Chat receives the not-web-verified degradation context',
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} web-search-auto-detect smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll web-search-auto-detect smoke cases passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
