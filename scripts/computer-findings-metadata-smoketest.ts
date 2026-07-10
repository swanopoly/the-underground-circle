/**
 * computer-findings-metadata-smoketest (WI-4) — protects the persisted
 * `computerFindings` option-card field: bounded item count + per-field clamps,
 * and a full serialize -> parse round-trip that stays under
 * MAX_PERSISTED_BOT_MESSAGE_CHARS (9000).
 *
 * Run: npx tsx scripts/computer-findings-metadata-smoketest.ts
 */

import {
  computerFindingsMetadata,
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
  readPersistedComputerFindings,
  type PersistedComputerFindings,
} from '../src/lib/persistedChatMetadata';

const MAX_PERSISTED_BOT_MESSAGE_CHARS = 9000;
let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

// ── Builder: bounds + clamps ─────────────────────────────────────────────────

const rawFindings = Array.from({ length: 25 }, (_, i) => ({
  title: `Hotel Option ${i + 1} ${'name '.repeat(80)}`,
  url: `https://marriott.com/hotel/${i}/${'x'.repeat(600)}`,
  price: `$${100 + i}${'.00 per night '.repeat(20)}`,
  rating: `4.${i} stars ${'great '.repeat(20)}`,
  notes: `Notes about option ${i} ${'detail '.repeat(200)}`,
  // extra keys the builder must ignore
  thumbnail: 'https://example.com/thumb.png',
  secret: 'should-not-persist',
}));

const built = computerFindingsMetadata(rawFindings, { runId: 'run_abc', sessionId: 'sess_xyz' });
assert(!!built, 'builder returns findings for non-empty input');
assert(built!.items.length === 10, 'item count capped at 10', `got ${built!.items.length}`);
assert(built!.runId === 'run_abc', 'runId preserved');
assert(built!.sessionId === 'sess_xyz', 'sessionId preserved');

const firstItem = built!.items[0];
assert(firstItem.title.length <= 140, 'title clamped <=140', `len ${firstItem.title.length}`);
assert((firstItem.url || '').length <= 240, 'url clamped <=240', `len ${(firstItem.url || '').length}`);
assert((firstItem.price || '').length <= 40, 'price clamped <=40', `len ${(firstItem.price || '').length}`);
assert((firstItem.rating || '').length <= 40, 'rating clamped <=40', `len ${(firstItem.rating || '').length}`);
assert((firstItem.notes || '').length <= 200, 'notes clamped <=200', `len ${(firstItem.notes || '').length}`);
assert(!('thumbnail' in (firstItem as any)), 'unknown keys (thumbnail) dropped');
assert(!('secret' in (firstItem as any)), 'unknown keys (secret) dropped');

// Findings without a title are skipped.
const skipTitleless = computerFindingsMetadata(
  [{ title: '' }, { title: '   ' }, { url: 'https://x.com' } as any, { title: 'Kept' }],
  { runId: 'r', sessionId: 's' },
);
assert(skipTitleless!.items.length === 1, 'titleless findings skipped', `got ${skipTitleless!.items.length}`);
assert(skipTitleless!.items[0].title === 'Kept', 'only titled finding kept');

// Empty input with no ids returns undefined so callers can spread conditionally.
assert(computerFindingsMetadata([], {}) === undefined, 'empty findings + no ids -> undefined');
assert(computerFindingsMetadata(null, {}) === undefined, 'null findings + no ids -> undefined');
// ids-only still persists (so a follow-up can reuse the session even without options).
assert(!!computerFindingsMetadata([], { sessionId: 'sess_only' }), 'ids-only -> defined');

// Optional fields omitted when absent (no empty strings leaking into JSON).
const minimal = computerFindingsMetadata([{ title: 'Bare' }], { runId: 'r1', sessionId: null });
assert(minimal!.items[0].url === undefined, 'absent url omitted');
assert(minimal!.items[0].price === undefined, 'absent price omitted');
assert(minimal!.sessionId === null, 'null sessionId normalized to null');

// ── Round-trip within the byte cap ───────────────────────────────────────────

// Realistic completion body + 10 max-clamped findings must round-trip whole.
const message = formatPersistedChatBotMessage(
  'OpenSwan',
  'Here are your Chicago hotel options for this weekend. Reply "book option N" to continue.',
  { computerFindings: built },
);
assert(
  message.length <= MAX_PERSISTED_BOT_MESSAGE_CHARS,
  'persisted message within 9000-char cap',
  `len ${message.length}`,
);

const parsed = readPersistedChatBotMetadata(message);
assert(!!parsed, 'metadata parses back off the message');
const readFindings = readPersistedComputerFindings(parsed);
assert(!!readFindings, 'computerFindings read back');
assert((readFindings as PersistedComputerFindings).items.length >= 1, 'round-tripped items present');
assert((readFindings as PersistedComputerFindings).runId === 'run_abc', 'round-tripped runId matches');
assert((readFindings as PersistedComputerFindings).sessionId === 'sess_xyz', 'round-tripped sessionId matches');
assert(
  (readFindings as PersistedComputerFindings).items[0].title.startsWith('Hotel Option 1'),
  'round-tripped first title matches',
);

// Extreme case: huge findings alongside other big metadata still stays bounded
// (the tiered fallbacks in formatPersistedChatBotMessage kick in).
const heavy = formatPersistedChatBotMessage(
  'OpenSwan',
  'Massive response body. '.repeat(500),
  {
    computerFindings: built,
    browserPlans: [
      {
        planId: 'p1',
        task: 'x'.repeat(4000),
        backend: 'browserbase_stagehand',
        actions: Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, type: 'click', target: 'y'.repeat(300) })),
      } as any,
    ],
  },
);
assert(heavy.length <= MAX_PERSISTED_BOT_MESSAGE_CHARS, 'heavy message stays under cap', `len ${heavy.length}`);
// Even under pressure, findings survive at the minimal tier.
const heavyFindings = readPersistedComputerFindings(readPersistedChatBotMetadata(heavy));
assert(!!heavyFindings && heavyFindings.items.length >= 1, 'findings survive heavy-payload compaction');

// Reader is defensive against junk.
assert(readPersistedComputerFindings(null) === null, 'reader null-safe');
assert(readPersistedComputerFindings({ computerFindings: null } as any) === null, 'reader handles null field');
assert(
  readPersistedComputerFindings({ computerFindings: { items: [{ title: '' }] } } as any) === null,
  'reader drops all-empty findings',
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll computer-findings metadata assertions passed.');
