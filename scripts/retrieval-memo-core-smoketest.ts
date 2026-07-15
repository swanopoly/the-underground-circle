/**
 * retrieval-memo-core-smoketest — guards the PURE retrieval memo core
 * (`src/lib/retrievalMemoCore.ts`), which dedupes the per-turn query
 * embed + rank that memoryService fires TWICE in one Promise.all wave.
 *
 * Covers:
 *   - buildRetrievalMemoKey: same inputs → same key; query trim/collapse/lower
 *     normalization; a different circle / user / soul / surface → a different
 *     key; empty/whitespace/non-string query → '' sentinel.
 *   - getMemoized / setMemoized: set+get within TTL → hit; at/after TTL → miss
 *     (+ evicted); custom ttl override; '' / invalid key never stored; garbage
 *     clock → no-op / miss.
 *   - bounded LRU: cap enforced at RETRIEVAL_MEMO_MAX; a get promotes an entry
 *     so it survives the next eviction.
 *   - hostile/degenerate inputs never throw.
 *
 * Imports the REAL module (pure, zero runtime imports).
 *
 * Run: npx tsx scripts/retrieval-memo-core-smoketest.ts
 */

import {
  buildRetrievalMemoKey,
  getMemoized,
  setMemoized,
  clearRetrievalMemo,
  retrievalMemoSize,
  RETRIEVAL_MEMO_TTL_MS,
  RETRIEVAL_MEMO_MAX,
} from '../src/lib/retrievalMemoCore';

let passes = 0,
  failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

const BASE = {
  queryText: 'How do I reset the widget?',
  circleId: 'circle-A',
  userId: 'user-1',
  activeSoulKey: 'soul:helper',
  surface: 'main_chat',
};

function main(): void {
  // ── 1. constants ───────────────────────────────────────────────────────────
  assertEq(RETRIEVAL_MEMO_TTL_MS, 30_000, 'TTL default is 30s');
  assertEq(RETRIEVAL_MEMO_MAX, 64, 'LRU cap is 64');
  assert(typeof buildRetrievalMemoKey === 'function', 'buildRetrievalMemoKey exported');
  assert(typeof getMemoized === 'function', 'getMemoized exported');
  assert(typeof setMemoized === 'function', 'setMemoized exported');
  assert(typeof clearRetrievalMemo === 'function', 'clearRetrievalMemo exported');

  // ── 2. key determinism & shape ───────────────────────────────────────────────
  const k1 = buildRetrievalMemoKey(BASE);
  const k2 = buildRetrievalMemoKey({ ...BASE });
  assert(typeof k1 === 'string' && k1.length > 0, 'non-empty query → non-empty key');
  assertEq(k1, k2, 'same inputs → same key');
  assert(k1.startsWith('rm1:'), 'key carries version prefix');
  // stable across property-object identity (fresh object, same values)
  assertEq(
    buildRetrievalMemoKey({
      queryText: 'How do I reset the widget?',
      circleId: 'circle-A',
      userId: 'user-1',
      activeSoulKey: 'soul:helper',
      surface: 'main_chat',
    }),
    k1,
    'independent object with equal values → same key',
  );

  // ── 3. query normalization (trim / collapse whitespace / lowercase) ──────────
  assertEq(
    buildRetrievalMemoKey({ ...BASE, queryText: '  How do I reset the widget?  ' }),
    k1,
    'leading/trailing whitespace ignored',
  );
  assertEq(
    buildRetrievalMemoKey({ ...BASE, queryText: 'HOW DO I RESET THE WIDGET?' }),
    k1,
    'case-insensitive query',
  );
  assertEq(
    buildRetrievalMemoKey({ ...BASE, queryText: 'How   do\tI\nreset  the widget?' }),
    k1,
    'internal whitespace runs collapse to single spaces',
  );
  assert(
    buildRetrievalMemoKey({ ...BASE, queryText: 'a different question entirely' }) !== k1,
    'different query text → different key',
  );

  // ── 4. each identity dimension participates in the key ───────────────────────
  assert(buildRetrievalMemoKey({ ...BASE, circleId: 'circle-B' }) !== k1, 'different circle → different key');
  assert(buildRetrievalMemoKey({ ...BASE, userId: 'user-2' }) !== k1, 'different user → different key');
  assert(buildRetrievalMemoKey({ ...BASE, activeSoulKey: 'soul:coder' }) !== k1, 'different soul → different key');
  assert(buildRetrievalMemoKey({ ...BASE, surface: 'room_chat' }) !== k1, 'different surface → different key');
  // null soul (no active soul) is a distinct, valid key vs a set soul
  const kNullSoul = buildRetrievalMemoKey({ ...BASE, activeSoulKey: null });
  assert(kNullSoul.length > 0 && kNullSoul !== k1, 'null soul → valid key, distinct from set soul');
  assertEq(
    buildRetrievalMemoKey({ ...BASE, activeSoulKey: undefined }),
    kNullSoul,
    'undefined soul normalizes same as null soul',
  );
  // field boundaries cannot be forged: value containing a quote/bracket can't
  // collide with a shifted tuple (JSON-encoded parts).
  assert(
    buildRetrievalMemoKey({ ...BASE, circleId: 'circle-A","user-1' }) !==
      buildRetrievalMemoKey({ ...BASE, circleId: 'circle-A' }),
    'field-boundary forgery does not collide',
  );

  // ── 5. empty / non-string query → '' uncacheable sentinel ────────────────────
  assertEq(buildRetrievalMemoKey({ ...BASE, queryText: '' }), '', 'empty query → sentinel');
  assertEq(buildRetrievalMemoKey({ ...BASE, queryText: '    ' }), '', 'whitespace query → sentinel');
  assertEq(buildRetrievalMemoKey({ ...BASE, queryText: '\t\n ' }), '', 'tab/newline-only query → sentinel');
  assertEq(buildRetrievalMemoKey({ ...BASE, queryText: 123 as any }), '', 'numeric query → sentinel (string-only)');
  assertEq(buildRetrievalMemoKey({ ...BASE, queryText: {} as any }), '', 'object query → sentinel');
  assertEq(buildRetrievalMemoKey({ ...BASE, queryText: null as any }), '', 'null query → sentinel');
  assertEq(buildRetrievalMemoKey({ ...BASE, queryText: undefined as any }), '', 'undefined query → sentinel');

  // ── 6. huge query → bounded key, no throw ────────────────────────────────────
  const hugeKey = buildRetrievalMemoKey({ ...BASE, queryText: 'x'.repeat(1_000_000) });
  assert(typeof hugeKey === 'string' && hugeKey.length > 0, 'huge query still yields a key');
  assert(hugeKey.length < 5_000, 'huge query key is bounded (<5k chars)');

  // ── 7. set + get within TTL → hit ────────────────────────────────────────────
  clearRetrievalMemo();
  const scored = [{ id: 'm1', score: 0.9 }, { id: 'm2', score: 0.7 }];
  setMemoized(k1, scored, 1_000);
  assertEq(retrievalMemoSize(), 1, 'one entry stored');
  assertEq(getMemoized(k1, 1_000), scored, 'immediate get → hit (same reference)');
  assertEq(getMemoized(k1, 1_000 + 29_999), scored, 'get at TTL-1ms → hit');

  // ── 8. at / past TTL → miss (+ eviction) ─────────────────────────────────────
  clearRetrievalMemo();
  setMemoized(k1, scored, 1_000);
  assertEq(getMemoized(k1, 1_000 + RETRIEVAL_MEMO_TTL_MS), undefined, 'get at exactly TTL → miss');
  assertEq(retrievalMemoSize(), 0, 'expired entry is evicted on read');
  setMemoized(k1, scored, 1_000);
  assertEq(getMemoized(k1, 1_000 + 60_000), undefined, 'get well past TTL → miss');

  // ── 9. custom ttl override ───────────────────────────────────────────────────
  clearRetrievalMemo();
  setMemoized(k1, scored, 0);
  assertEq(getMemoized(k1, 4_999, 5_000), scored, 'custom ttl: within → hit');
  setMemoized(k1, scored, 0);
  assertEq(getMemoized(k1, 5_000, 5_000), undefined, 'custom ttl: at boundary → miss');
  setMemoized(k1, scored, 0);
  assertEq(getMemoized(k1, 100, 0), undefined, 'ttl 0 → always miss');
  setMemoized(k1, scored, 0);
  assertEq(getMemoized(k1, 40_000, NaN as any), undefined, 'invalid ttl falls back to default (30s) → miss at 40s');
  setMemoized(k1, scored, 0);
  assertEq(getMemoized(k1, 10, -5 as any), scored, 'negative ttl falls back to default → hit at 10ms');

  // ── 10. '' / invalid key never stored; missing key → miss ────────────────────
  clearRetrievalMemo();
  setMemoized('', scored, 1_000);
  assertEq(retrievalMemoSize(), 0, "'' key never stored");
  assertEq(getMemoized('', 1_000), undefined, "get '' key → miss");
  setMemoized(null as any, scored, 1_000);
  setMemoized(undefined as any, scored, 1_000);
  setMemoized(42 as any, scored, 1_000);
  assertEq(retrievalMemoSize(), 0, 'non-string keys never stored');
  assertEq(getMemoized('never-set-key', 1_000), undefined, 'absent key → miss');

  // ── 11. garbage clock → no-op store / miss read ──────────────────────────────
  clearRetrievalMemo();
  setMemoized(k1, scored, NaN as any);
  assertEq(retrievalMemoSize(), 0, 'NaN clock → not stored');
  setMemoized(k1, scored, Infinity as any);
  assertEq(retrievalMemoSize(), 0, 'Infinity clock → not stored');
  setMemoized(k1, scored, 'nope' as any);
  assertEq(retrievalMemoSize(), 0, 'string clock → not stored');
  setMemoized(k1, scored, 1_000);
  assertEq(getMemoized(k1, NaN as any), undefined, 'NaN read clock → miss');
  assertEq(getMemoized(k1, undefined as any), undefined, 'undefined read clock → miss');
  assertEq(retrievalMemoSize(), 1, 'a failed/garbage-clock read leaves the live entry intact');

  // ── 12. overwrite same key updates value + anchor, not count ─────────────────
  clearRetrievalMemo();
  setMemoized(k1, 'first', 1_000);
  setMemoized(k1, 'second', 2_000);
  assertEq(retrievalMemoSize(), 1, 'overwrite keeps a single entry');
  assertEq(getMemoized(k1, 2_500), 'second', 'overwrite returns the newest value');
  assertEq(getMemoized(k1, 1_000 + RETRIEVAL_MEMO_TTL_MS + 1), 'second', 'TTL re-anchored to the overwrite time → still fresh');

  // ── 13. bounded LRU: cap enforced ────────────────────────────────────────────
  clearRetrievalMemo();
  const keys: string[] = [];
  for (let i = 0; i < RETRIEVAL_MEMO_MAX + 10; i++) {
    const key = buildRetrievalMemoKey({ ...BASE, queryText: 'lru query number ' + i });
    keys.push(key);
    setMemoized(key, i, 1_000);
  }
  assertEq(retrievalMemoSize(), RETRIEVAL_MEMO_MAX, 'size never exceeds cap');
  assertEq(getMemoized(keys[0], 1_000), undefined, 'oldest inserted key evicted');
  assertEq(getMemoized(keys[9], 1_000), undefined, 'first 10 (overflow) evicted');
  assertEq(getMemoized(keys[keys.length - 1], 1_000), keys.length - 1, 'newest key retained');
  assertEq(getMemoized(keys[10], 1_000), 10, 'exactly-cap boundary key retained');

  // ── 14. LRU: a get promotes an entry so it survives the next eviction ─────────
  clearRetrievalMemo();
  const lkeys: string[] = [];
  for (let i = 0; i < RETRIEVAL_MEMO_MAX; i++) {
    const key = buildRetrievalMemoKey({ ...BASE, queryText: 'promote query ' + i });
    lkeys.push(key);
    setMemoized(key, i, 1_000);
  }
  assertEq(retrievalMemoSize(), RETRIEVAL_MEMO_MAX, 'filled to cap');
  // promote the oldest (index 0) to most-recently-used
  assertEq(getMemoized(lkeys[0], 1_000), 0, 'oldest still present before promotion');
  // insert one more → eviction should drop lkeys[1] (now the LRU), not lkeys[0]
  const extra = buildRetrievalMemoKey({ ...BASE, queryText: 'promote query extra' });
  setMemoized(extra, 999, 1_000);
  assertEq(retrievalMemoSize(), RETRIEVAL_MEMO_MAX, 'still at cap after one more insert');
  assertEq(getMemoized(lkeys[0], 1_000), 0, 'promoted entry survived eviction');
  assertEq(getMemoized(lkeys[1], 1_000), undefined, 'new LRU (index 1) evicted instead');
  assertEq(getMemoized(extra, 1_000), 999, 'freshly inserted key present');

  // ── 15. clearRetrievalMemo empties the store ─────────────────────────────────
  setMemoized(k1, scored, 1_000);
  assert(retrievalMemoSize() > 0, 'store non-empty before clear');
  clearRetrievalMemo();
  assertEq(retrievalMemoSize(), 0, 'clear empties the store');
  assertEq(getMemoized(k1, 1_000), undefined, 'get after clear → miss');

  // ── 16. hostile / degenerate inputs never throw ──────────────────────────────
  clearRetrievalMemo();
  try {
    // hostile key-builder inputs
    buildRetrievalMemoKey(null as any);
    buildRetrievalMemoKey(undefined as any);
    buildRetrievalMemoKey(42 as any);
    buildRetrievalMemoKey('string' as any);
    buildRetrievalMemoKey([] as any);
    // throwing-getter Proxy for the whole input
    const boom = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter');
        },
      },
    );
    const bk = buildRetrievalMemoKey(boom as any);
    assertEq(bk, '', 'throwing-getter input → sentinel');
    // per-field hostile: a throwing circleId getter
    const badField: any = { queryText: 'ok query' };
    Object.defineProperty(badField, 'circleId', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    assertEq(buildRetrievalMemoKey(badField), '', 'throwing field getter → sentinel');
    // exotic value types as fields — coerced or ignored, never thrown
    buildRetrievalMemoKey({ ...BASE, circleId: Symbol('s') as any });
    buildRetrievalMemoKey({ ...BASE, userId: 10n as any });
    buildRetrievalMemoKey({ ...BASE, surface: true as any });
    buildRetrievalMemoKey({ ...BASE, activeSoulKey: { toString() { throw new Error('x'); } } as any });
    buildRetrievalMemoKey({ ...BASE, queryText: NaN as any });

    // hostile cache-op inputs
    getMemoized(undefined as any, 1_000);
    getMemoized(null as any, 1_000);
    getMemoized(k1, {} as any);
    getMemoized(k1, 1_000, {} as any);
    setMemoized(k1, undefined, 1_000);
    setMemoized(k1, null, 1_000);
    setMemoized(k1, { self: {} as any }, 1_000);
    setMemoized(k1, () => 0, 1_000);
    setMemoized({} as any, scored, 1_000);
    clearRetrievalMemo();
    clearRetrievalMemo();
    getMemoized('anything', 0);
    assert(true, 'hostile/degenerate inputs handled without throwing');
  } catch (e) {
    assert(false, 'hostile inputs must not throw', (e as Error)?.message);
  }

  // ── 17. round-trip after hostile section still works ─────────────────────────
  clearRetrievalMemo();
  const rk = buildRetrievalMemoKey(BASE);
  setMemoized(rk, [{ id: 'x' }], 5_000);
  const got = getMemoized(rk, 5_100) as any;
  assert(Array.isArray(got) && got[0].id === 'x', 'core still functional after hostile inputs');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll retrieval-memo smoke cases passed (' + passes + ' passed).');
}

main();
