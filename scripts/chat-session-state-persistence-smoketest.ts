/**
 * chat-session-state-persistence-smoketest — pins the pure bounding +
 * (de)serialization helpers behind ChatTab's localStorage mirror of two
 * session-only chat state stores:
 *
 *   1. the chat failure-recovery ledger (duplicate-handoff suppression), and
 *   2. the last computer-app route resolution ("use X instead" diffing).
 *
 * ChatTab itself is not tsx-loadable (react-native), so the logic lives in
 * src/lib/chatSessionStatePersistence.ts and is exercised here directly.
 *
 * Run: npm run smoke:chat-session-state-persistence
 */

import type { ChatComputerAppResolution } from '../src/lib/chatComputerRequestRouter';
import {
  LAST_APP_RESOLUTION_MAX_SERIALIZED_BYTES,
  boundChatFailureLedgerEntries,
  deserializeChatFailureLedger,
  deserializeLastAppResolution,
  serializeChatFailureLedger,
  serializeLastAppResolution,
  type ChatFailureLedgerPair,
  type PersistedChatFailureLedgerEntry,
} from '../src/lib/chatSessionStatePersistence';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

// Match the runtime constants in ChatTab.
const RETENTION_MS = 60 * 60 * 1000;
const MAX = 64;
const NOW = 1_700_000_000_000;

function entry(overrides: Partial<PersistedChatFailureLedgerEntry> = {}): PersistedChatFailureLedgerEntry {
  return {
    firstAt: NOW,
    lastAt: NOW,
    count: 1,
    suppressedCount: 0,
    lastSuccessfulHandoffAt: null,
    ...overrides,
  };
}

// ── Ledger: retention window ──────────────────────────────────────────────

const withStale: ChatFailureLedgerPair[] = [
  ['fresh', entry({ lastAt: NOW - 1000 })],
  ['edge', entry({ lastAt: NOW - RETENTION_MS })], // exactly at boundary — kept (not strictly older)
  ['stale', entry({ lastAt: NOW - RETENTION_MS - 1 })], // one ms over — dropped
];
const boundedRetention = boundChatFailureLedgerEntries(withStale, NOW, RETENTION_MS, MAX);
const boundedKeys = boundedRetention.map(([key]) => key);
assert(boundedKeys.includes('fresh'), 'retention keeps a fresh entry');
assert(boundedKeys.includes('edge'), 'retention keeps an entry exactly at the retention boundary');
assert(!boundedKeys.includes('stale'), 'retention drops an entry past the window');
assert(boundedRetention.length === 2, 'retention keeps exactly the non-stale entries');

// ── Ledger: cap keeps newest-by-lastAt ────────────────────────────────────

const many: ChatFailureLedgerPair[] = Array.from({ length: MAX + 10 }, (_, index) => [
  `fp_${index}`,
  entry({ lastAt: NOW - (MAX + 10 - index) * 1000 }), // higher index == more recent
]);
const boundedCap = boundChatFailureLedgerEntries(many, NOW, RETENTION_MS, MAX);
assert(boundedCap.length === MAX, 'cap keeps at most MAX entries', `got ${boundedCap.length}`);
const capKeys = new Set(boundedCap.map(([key]) => key));
assert(capKeys.has(`fp_${MAX + 9}`), 'cap keeps the newest entry by lastAt');
assert(!capKeys.has('fp_0'), 'cap drops the oldest entry by lastAt');
assert(!capKeys.has('fp_9'), 'cap drops the 10 oldest entries by lastAt');
// The most-recent MAX entries are indices 10..MAX+9.
assert(capKeys.has('fp_10'), 'cap keeps the boundary of the newest MAX window');
assert(!capKeys.has('fp_9') && capKeys.has('fp_10'), 'cap boundary is exact (fp_9 out, fp_10 in)');
// Output preserves ascending-by-lastAt order (Map-insertion friendly).
const capLastAts = boundedCap.map(([, e]) => e.lastAt);
const capAscending = capLastAts.every((v, i) => i === 0 || v >= capLastAts[i - 1]);
assert(capAscending, 'cap output stays ascending by lastAt');

// ── Ledger: invalid / malformed input ─────────────────────────────────────

const dirty = [
  ['good', entry()],
  ['badKey', entry()],
  ['missingField', { firstAt: NOW, lastAt: NOW, count: 1 }], // no suppressedCount / handoff
  ['nanLast', entry({ lastAt: Number.NaN })],
  ['notObject', 42],
  ['nullEntry', null],
  ['emptyKey', entry()],
] as unknown as ChatFailureLedgerPair[];
// Overwrite the two intentionally-bad keys.
(dirty[1] as any)[0] = 123; // non-string key
(dirty[6] as any)[0] = '';  // empty key
const boundedDirty = boundChatFailureLedgerEntries(dirty, NOW, RETENTION_MS, MAX);
const dirtyKeys = boundedDirty.map(([key]) => key);
assert(dirtyKeys.length === 1 && dirtyKeys[0] === 'good', 'bounding drops all invalid entries', JSON.stringify(dirtyKeys));

// Bounding normalizes entries down to exactly the persisted fields.
const withExtra = [['fp', { ...entry(), extra: 'nope', another: 123 } as any]] as ChatFailureLedgerPair[];
const normalized = boundChatFailureLedgerEntries(withExtra, NOW, RETENTION_MS, MAX)[0][1] as Record<string, unknown>;
assert(!('extra' in normalized) && !('another' in normalized), 'bounding strips extra fields off entries');
assert(Object.keys(normalized).length === 5, 'normalized entry has exactly five fields');

// ── Ledger: serialize / deserialize round-trip ────────────────────────────

const roundTripInput: ChatFailureLedgerPair[] = [
  ['a', entry({ lastAt: NOW - 5000, count: 3, suppressedCount: 2, lastSuccessfulHandoffAt: NOW - 6000 })],
  ['b', entry({ lastAt: NOW - 1000 })],
];
const serialized = serializeChatFailureLedger(roundTripInput, NOW, RETENTION_MS, MAX);
assert(typeof serialized === 'string' && serialized.length > 0, 'serialize returns a JSON string for non-empty ledger');
const reloaded = deserializeChatFailureLedger(serialized, NOW, RETENTION_MS, MAX);
assert(reloaded.length === 2, 'round-trip preserves both entries');
const reloadedA = reloaded.find(([key]) => key === 'a')?.[1];
assert(
  reloadedA?.count === 3 && reloadedA?.suppressedCount === 2 && reloadedA?.lastSuccessfulHandoffAt === NOW - 6000,
  'round-trip preserves numeric fields exactly',
);

// Empty / all-stale ledgers serialize to null so the caller can removeItem.
assert(serializeChatFailureLedger([], NOW, RETENTION_MS, MAX) === null, 'empty ledger serializes to null');
assert(
  serializeChatFailureLedger([['x', entry({ lastAt: NOW - RETENTION_MS - 1 })]], NOW, RETENTION_MS, MAX) === null,
  'all-stale ledger serializes to null',
);

// Serialize re-applies retention (stale entry never written).
const serializedMixed = serializeChatFailureLedger(
  [['fresh', entry({ lastAt: NOW - 1000 })], ['stale', entry({ lastAt: NOW - RETENTION_MS - 1 })]],
  NOW,
  RETENTION_MS,
  MAX,
);
assert(!!serializedMixed && serializedMixed.includes('fresh') && !serializedMixed.includes('stale'), 'serialize drops stale before writing');

// Deserialize re-applies retention: something fresh when written goes stale
// while the tab was closed → dropped on hydrate.
const laterNow = NOW + RETENTION_MS + 10_000;
const staleOnReload = deserializeChatFailureLedger(serialized, laterNow, RETENTION_MS, MAX);
assert(staleOnReload.length === 0, 'deserialize drops entries that went stale while closed');

// ── Ledger: deserialize tolerates garbage (never throws) ──────────────────

assert(deserializeChatFailureLedger(null, NOW, RETENTION_MS, MAX).length === 0, 'deserialize null → empty');
assert(deserializeChatFailureLedger('', NOW, RETENTION_MS, MAX).length === 0, 'deserialize empty string → empty');
assert(deserializeChatFailureLedger('{ not json', NOW, RETENTION_MS, MAX).length === 0, 'deserialize malformed JSON → empty (no throw)');
assert(deserializeChatFailureLedger('[1,2,3]', NOW, RETENTION_MS, MAX).length === 0, 'deserialize JSON array → empty');
assert(deserializeChatFailureLedger('"a string"', NOW, RETENTION_MS, MAX).length === 0, 'deserialize JSON string → empty');
assert(deserializeChatFailureLedger('42', NOW, RETENTION_MS, MAX).length === 0, 'deserialize JSON number → empty');
assert(
  deserializeChatFailureLedger('{"a":{"firstAt":1},"b":null}', NOW, RETENTION_MS, MAX).length === 0,
  'deserialize object with only invalid entries → empty',
);

// ── Resolution: round-trip ────────────────────────────────────────────────

const resolution: ChatComputerAppResolution = {
  category: 'image_editing' as ChatComputerAppResolution['category'],
  best: {
    appId: 'pixelmator',
    displayName: 'Pixelmator Pro',
    surface: 'desktop',
    openVia: 'desktop_launch',
    openTarget: 'Pixelmator Pro',
    reason: 'installed on this Mac',
    availability: 'installed',
  },
  alternativesSummary: ['Photoshop — installed', 'Photopea — web', 'GIMP — installed'],
  explicitAppNamed: true,
  openStepLines: ['Open Pixelmator Pro', 'Open the target image'],
  namedAppIntent: 'pixelmator',
  recoveryFallback: null,
};
const resSerialized = serializeLastAppResolution(resolution);
assert(typeof resSerialized === 'string' && resSerialized.length > 0, 'resolution serializes to a JSON string');
const resReloaded = deserializeLastAppResolution(resSerialized);
assert(!!resReloaded, 'resolution round-trips back to an object');
assert(resReloaded?.best.appId === 'pixelmator', 'resolution round-trip preserves best.appId');
assert(resReloaded?.category === 'image_editing', 'resolution round-trip preserves category');
assert((resReloaded?.alternativesSummary.length || 0) === 3, 'resolution round-trip preserves ≤3 alternatives');
assert(resReloaded?.explicitAppNamed === true, 'resolution round-trip preserves explicitAppNamed');

// ── Resolution: null / guard behavior ─────────────────────────────────────

assert(serializeLastAppResolution(null) === null, 'serialize null resolution → null');
assert(serializeLastAppResolution(undefined) === null, 'serialize undefined resolution → null');
assert(deserializeLastAppResolution(null) === null, 'deserialize null → null');
assert(deserializeLastAppResolution('') === null, 'deserialize empty string → null');
assert(deserializeLastAppResolution('{ not json') === null, 'deserialize malformed JSON → null (no throw)');
assert(deserializeLastAppResolution('42') === null, 'deserialize JSON number → null');
assert(deserializeLastAppResolution('null') === null, 'deserialize literal null → null');

// Structural guard: valid JSON but wrong shape → null.
assert(deserializeLastAppResolution(JSON.stringify({ category: 'x' })) === null, 'deserialize resolution missing best → null');
assert(
  deserializeLastAppResolution(JSON.stringify({ category: 'x', best: {}, alternativesSummary: [], explicitAppNamed: true })) === null,
  'deserialize resolution with best missing appId → null',
);
assert(
  deserializeLastAppResolution(JSON.stringify({ best: { appId: 'a' }, alternativesSummary: [], explicitAppNamed: true })) === null,
  'deserialize resolution missing category → null',
);
assert(
  deserializeLastAppResolution(JSON.stringify({ category: 'x', best: { appId: 'a' }, alternativesSummary: 'nope', explicitAppNamed: true })) === null,
  'deserialize resolution with non-array alternatives → null',
);
assert(
  deserializeLastAppResolution(JSON.stringify({ category: 'x', best: { appId: 'a' }, alternativesSummary: [], explicitAppNamed: 'yes' })) === null,
  'deserialize resolution with non-boolean explicitAppNamed → null',
);

// Oversized guard: a payload far above the byte cap is rejected on both sides.
const oversizedResolution = {
  ...resolution,
  alternativesSummary: [`${'x'.repeat(LAST_APP_RESOLUTION_MAX_SERIALIZED_BYTES + 100)}`],
} as ChatComputerAppResolution;
assert(serializeLastAppResolution(oversizedResolution) === null, 'serialize rejects an oversized resolution');
const oversizedRaw = JSON.stringify(oversizedResolution);
assert(oversizedRaw.length > LAST_APP_RESOLUTION_MAX_SERIALIZED_BYTES, 'oversized fixture actually exceeds the byte cap');
assert(deserializeLastAppResolution(oversizedRaw) === null, 'deserialize rejects an oversized stored payload');

if (failures > 0) {
  console.error(`\n${failures} chat-session-state-persistence smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll chat-session-state persistence smoke cases passed.');
