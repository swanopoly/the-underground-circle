/**
 * chat-room-handoff-smoketest — verifies the chat→room handoff heuristics
 * and seed copy (Phase 4c of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md):
 * conservative detection (files + user build intent), file extraction,
 * name/seed bounds.
 *
 * Run: npm run smoke:chat-room-handoff
 */

import {
  buildRoomHandoffSeedMessage,
  detectRoomHandoffSuggestion,
  extractMentionedFiles,
  ROOM_HANDOFF_MIN_FILES,
} from '../src/lib/chatRoomHandoff';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

const user = (content: string) => ({ content, isBot: false });
const bot = (content: string) => ({ content, isBot: true });

// ── Detection fires on multi-file build work ────────────────────────────────
{
  const suggestion = detectRoomHandoffSuggestion(
    [
      user('Can you refactor src/lib/auth.ts to use the new session helper?'),
      bot('Done — auth.ts now imports from src/lib/authSession.ts. `src/screens/Login.tsx` also needed the new hook.'),
      user('Great, now wire it into Login.tsx and add tests in scripts/auth-smoketest.ts'),
    ],
    { threadTitle: 'Auth migration' },
  );
  expect(!!suggestion, 'multi-file build conversation → suggestion');
  expect(suggestion!.suggestedRoomName === 'Auth migration', 'room name comes from the thread title');
  expect(suggestion!.filesMentioned.length >= ROOM_HANDOFF_MIN_FILES, 'suggestion lists the files');
  expect(/\d+ files/.test(suggestion!.reason), 'reason states the file count');
  pass('multi-file build work → room suggestion');
}

// ── Conservative: ordinary chat never fires ─────────────────────────────────
{
  expect(
    detectRoomHandoffSuggestion([
      user('What is the capital of France?'),
      bot('Paris.'),
    ]) === null,
    'plain Q&A → no suggestion',
  );
  expect(
    detectRoomHandoffSuggestion([
      user('Fix src/lib/a.ts please'),
      bot('Fixed src/lib/a.ts.'),
    ]) === null,
    'single file → no suggestion (below min files)',
  );
  expect(
    detectRoomHandoffSuggestion([
      bot('See src/a.ts, src/b.ts, src/c.ts, src/d.ts for details.'),
      user('thanks!'),
    ]) === null,
    'bot-only file mentions without user build intent → no suggestion',
  );
  expect(detectRoomHandoffSuggestion([]) === null, 'empty window → no suggestion');
  pass('detection stays conservative');
}

// ── File extraction ─────────────────────────────────────────────────────────
{
  const files = extractMentionedFiles([
    user('Look at `src/lib/foo.ts` and src/lib/bar.tsx (also SRC/LIB/FOO.TS again)'),
    bot('Also check styles.css and visit example.com for docs.'),
  ]);
  expect(files.some((f) => f.toLowerCase() === 'src/lib/foo.ts'), 'extracts backticked paths');
  expect(files.some((f) => f === 'src/lib/bar.tsx'), 'extracts parenthesised paths');
  expect(files.some((f) => f === 'styles.css'), 'extracts bare filenames');
  expect(!files.some((f) => /example\.com/i.test(f)), 'domains are not files');
  expect(
    files.filter((f) => f.toLowerCase() === 'src/lib/foo.ts').length === 1,
    'dedupe is case-insensitive',
  );
  pass('file extraction: paths in, domains out, deduped');
}

// ── Fallback naming + bounds ────────────────────────────────────────────────
{
  const suggestion = detectRoomHandoffSuggestion(
    [
      user('Build the checkout flow: checkout.ts, cart.tsx, payment.ts need work'),
    ],
    { threadTitle: 'New Chat' },
  );
  expect(!!suggestion, 'fires with fallback title');
  expect(/workspace$/.test(suggestion!.suggestedRoomName), 'generic thread title → file-stem workspace name');
  expect(suggestion!.suggestedRoomName.length <= 60, 'room name bounded');
  pass('fallback naming');
}

// ── Seed message ────────────────────────────────────────────────────────────
{
  const seed = buildRoomHandoffSeedMessage({
    threadTitle: 'Auth migration',
    filesMentioned: ['src/lib/auth.ts', 'src/screens/Login.tsx'],
    latestUserAsk: 'Wire the session helper into Login.tsx and add tests',
  });
  expect(seed.startsWith('**Continued from main chat.**'), 'seed leads with provenance');
  expect(seed.includes('Thread: Auth migration'), 'seed names the thread');
  expect(seed.includes('Current goal: Wire the session helper'), 'seed carries the live ask');
  expect(seed.includes('- `src/lib/auth.ts`'), 'seed lists files');
  const huge = buildRoomHandoffSeedMessage({
    threadTitle: 't'.repeat(300),
    filesMentioned: Array.from({ length: 30 }, (_, i) => `${'x'.repeat(200)}/${i}.ts`),
    latestUserAsk: 'a'.repeat(1000),
  });
  expect(huge.length < 2000, 'seed stays bounded for oversized inputs');
  pass('seed message shape + bounds');
}

if (failures > 0) {
  console.error(`\n${failures} chat room handoff smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat room handoff smoke cases passed.');
