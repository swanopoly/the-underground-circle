/**
 * chat-retrieval-rank-core-smoketest — the pure ranker that optimizes context
 * QUALITY for a chat turn (src/lib/chatRetrievalRankCore.ts).
 *
 * Load-bearing behavior asserted here:
 *   - rankRetrievalForTurn orders the COMBINED retrieval bag best-first by
 *     (relevance + source-trust + lexical-overlap) × recency-decay, mirroring
 *     memoryService.retrieveForTurn's `base * (0.6 + 0.4 * recencyFactor)` with a
 *     30-day half-life — so under a tight budget the BEST context survives.
 *   - Near-identical texts dedup to ONE survivor (exact-normalized, shared
 *     140-char prefix, or Jaccard >= 0.85), and after ranking the HIGHER-ranked
 *     copy is the one kept (generalizes openswanMemoryStores' 40-char dedup).
 *   - maxItems is respected; <=0 → []; huge → clamped; input count is bounded.
 *   - dedupeRetrieval is order-preserving first-wins (no reordering).
 *   - Every export is TOTAL — degenerate/hostile input never throws.
 *
 * Pure — loads under tsx (chatRetrievalRankCore has zero imports).
 */

import {
  rankRetrievalForTurn,
  dedupeRetrieval,
  normalizeRetrievalItems,
  RETRIEVAL_RANK_DEFAULTS,
  type RetrievalItem,
} from '../src/lib/chatRetrievalRankCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000; // fixed injected clock for deterministic recency

function mk(
  id: string,
  text: string,
  score?: number,
  source?: string,
  recencyMs?: number,
): RetrievalItem {
  const it: RetrievalItem = { id, text };
  if (score !== undefined) it.score = score;
  if (source !== undefined) it.source = source;
  if (recencyMs !== undefined) it.recencyMs = recencyMs;
  return it;
}
const ids = (r: RetrievalItem[]) => r.map((x) => x.id);

function main(): void {
  // ─── (1) Empty / degenerate input → [] (never throws) ──────────────────────
  assertEq(rankRetrievalForTurn([]).length, 0, '(1) empty array → []');
  assertEq(rankRetrievalForTurn(null).length, 0, '(1) null → []');
  assertEq(rankRetrievalForTurn(undefined).length, 0, '(1) undefined → []');
  assertEq(rankRetrievalForTurn(123 as unknown).length, 0, '(1) number → []');
  assertEq(rankRetrievalForTurn('nope' as unknown).length, 0, '(1) string → []');
  assertEq(rankRetrievalForTurn({} as unknown).length, 0, '(1) plain object → []');
  assertEq(rankRetrievalForTurn(NaN as unknown).length, 0, '(1) NaN → []');
  assertEq(dedupeRetrieval([]).length, 0, '(1) dedupe empty → []');
  assertEq(dedupeRetrieval(null).length, 0, '(1) dedupe null → []');
  assertEq(normalizeRetrievalItems(null).length, 0, '(1) normalize null → []');
  assertEq(normalizeRetrievalItems('x' as unknown).length, 0, '(1) normalize non-array → []');
  assert(Array.isArray(rankRetrievalForTurn(null)), '(1) always returns an array');

  // ─── (2) Higher relevance score ranks first ────────────────────────────────
  {
    const r = rankRetrievalForTurn([mk('lo', 'low relevance memo', 0.2), mk('hi', 'high relevance memo', 0.9)]);
    assertEq(r.length, 2, '(2) two distinct kept');
    assertEq(r[0].id, 'hi', '(2) higher score first');
    assertEq(r[1].id, 'lo', '(2) lower score second');
    assertEq(r[0].score, 0.9, '(2) original score preserved (not combined)');
  }

  // ─── (3) Recency: same score, newer ranks first (30-day half-life bites) ────
  {
    const r = rankRetrievalForTurn(
      [mk('old', 'same weight old', 0.5, undefined, NOW - 60 * DAY), mk('new', 'same weight new', 0.5, undefined, NOW)],
      { nowMs: NOW },
    );
    assertEq(r[0].id, 'new', '(3) fresher item first');
    assertEq(r[1].id, 'old', '(3) 60-day-old item second');
    // A day-scale gap under a 30-day half-life should NOT reorder (barely decays).
    const r2 = rankRetrievalForTurn(
      [mk('a', 'tiny gap a', 0.8, undefined, NOW - 1000), mk('b', 'tiny gap b', 0.81, undefined, NOW)],
      { nowMs: NOW },
    );
    assertEq(r2[0].id, 'b', '(3) tiny recency gap does not overpower a higher score');
  }

  // ─── (4) Combined score × recency ordering ─────────────────────────────────
  {
    const r = rankRetrievalForTurn(
      [
        mk('A', 'combined A', 0.9, undefined, NOW),
        mk('B', 'combined B', 0.9, undefined, NOW - 60 * DAY),
        mk('C', 'combined C', 0.4, undefined, NOW),
      ],
      { nowMs: NOW },
    );
    assertEq(ids(r).join(','), 'A,B,C', '(4) A(fresh .9) > B(old .9) > C(fresh .4)');
  }

  // ─── (5) Source-trust boost orders equal score+recency ─────────────────────
  {
    const sources = ['user', 'circle', 'agent', 'room', 'retrieved', 'session'];
    const items = sources.map((s, i) => mk('s_' + s, 'trust probe ' + i + ' unique ' + s, 0.5, s, NOW));
    // shuffle-ish input order to prove ranking, not input order, decides
    const shuffled = [items[3], items[0], items[5], items[2], items[4], items[1]];
    const r = rankRetrievalForTurn(shuffled, { nowMs: NOW });
    assertEq(ids(r).join(','), 's_user,s_circle,s_agent,s_room,s_retrieved,s_session', '(5) trust order user>circle>agent>room>retrieved>session');
    // unknown source has neutral (0) trust — below session (0.02)
    const r2 = rankRetrievalForTurn(
      [mk('unk', 'zzz unknown source alpha', 0.5, 'totally_unknown_store', NOW), mk('ses', 'zzz session source beta', 0.5, 'session', NOW)],
      { nowMs: NOW },
    );
    assertEq(r2[0].id, 'ses', '(5) session trust > unknown trust');
    // scope alias populates source (RetrievedMemory.scope → source)
    const nrm = normalizeRetrievalItems([{ id: 'x', content: 'via scope', scope: 'Circle' }]);
    assertEq(nrm[0].source, 'circle', '(5) scope→source normalized + lowercased');
  }

  // ─── (6) Exact-normalized dedup (whitespace/punctuation differences) ───────
  {
    const A = mk('A', 'Ship the router before the review.', 0.9);
    const B = mk('B', '  ship   the router,, before the REVIEW!!!  ', 0.1);
    const r = rankRetrievalForTurn([A, B]);
    assertEq(r.length, 1, '(6) exact-normalized near-dup collapses to one');
    assertEq(r[0].id, 'A', '(6) higher-ranked survivor kept');
    // reverse ranks → the other survives
    const r2 = rankRetrievalForTurn([mk('A', 'Ship the router before the review.', 0.1), mk('B', 'ship the router before the review', 0.9)]);
    assertEq(r2.length, 1, '(6) reverse still collapses to one');
    assertEq(r2[0].id, 'B', '(6) reverse: new higher-ranked survivor');
  }

  // ─── (7) Jaccard near-dup (paraphrase) — higher-ranked survives ────────────
  {
    // ~20 distinct tokens; a single mid-text substitution → jaccard ~0.905 (>=0.9).
    const base = 'the quarterly planning review meeting covers revenue targets hiring plans budget forecasts and the detailed product roadmap for the upcoming fiscal year';
    const para = 'the quarterly planning review meeting covers sales targets hiring plans budget forecasts and the detailed product roadmap for the upcoming fiscal year';
    const r = rankRetrievalForTurn([mk('base', base, 0.8), mk('para', para, 0.2)]);
    assertEq(r.length, 1, '(7) one-word paraphrase (jaccard>=.9) collapses');
    assertEq(r[0].id, 'base', '(7) higher-ranked paraphrase survives');
    const r2 = rankRetrievalForTurn([mk('base', base, 0.2), mk('para', para, 0.85)]);
    assertEq(r2[0].id, 'para', '(7) reverse ranks → other survives');
    // three near-dups → exactly one survives
    const p3 = 'the quarterly planning review meeting covers profit targets hiring plans budget forecasts and the detailed product roadmap for the upcoming fiscal year';
    assertEq(rankRetrievalForTurn([mk('a', base, 0.5), mk('b', para, 0.4), mk('c', p3, 0.3)]).length, 1, '(7) 3 near-dups → 1');
    // dedupeRetrieval standalone also collapses the paraphrase
    assertEq(dedupeRetrieval([mk('a', base), mk('b', para)]).length, 1, '(7) dedupeRetrieval collapses paraphrase');
  }

  // ─── (8) Distinct texts survive; long shared-prefix path dedups ────────────
  {
    const X = mk('X', 'database migration rollback plan', 0.5);
    const Y = mk('Y', 'frontend button color accessibility', 0.5);
    assertEq(rankRetrievalForTurn([X, Y]).length, 2, '(8) low-overlap distinct texts both survive');
    assertEq(dedupeRetrieval([X, Y]).length, 2, '(8) dedupe keeps both distinct');
    // Shared 140-char prefix but LOW-overlap tails → seenSig dedup path (not jaccard).
    const PREFIX = 'the annual engineering roadmap describes the platform migration effort including database schema changes service decomposition and phased rollout planning';
    assert(PREFIX.length >= 140, '(8) prefix exceeds sig window', `len=${PREFIX.length}`);
    const tailA = ' apple banana cherry date fig grape kiwi lemon mango nectarine olive peach quince raisin';
    const tailB = ' walnut xigua yellow zucchini apricot blackberry coconut durian elderberry feijoa guava tomato';
    const r = rankRetrievalForTurn([mk('pa', PREFIX + tailA, 0.9), mk('pb', PREFIX + tailB, 0.1)]);
    assertEq(r.length, 1, '(8) identical 140-char prefix → dedup');
    assertEq(r[0].id, 'pa', '(8) higher-ranked prefix-dup survives');
    // The tails ALONE (no shared prefix) are distinct → both survive (proves it was the prefix)
    assertEq(rankRetrievalForTurn([mk('ta', tailA.trim(), 0.9), mk('tb', tailB.trim(), 0.1)]).length, 2, '(8) tails alone are distinct');
  }

  // ─── (9) Cap / bounds ──────────────────────────────────────────────────────
  {
    const twenty = Array.from({ length: 20 }, (_, i) => mk('n' + i, 'distinct capped memo number ' + i, 1 - i / 100));
    assertEq(rankRetrievalForTurn(twenty, { maxItems: 5 }).length, 5, '(9) maxItems=5 respected');
    assertEq(rankRetrievalForTurn(twenty).length, 12, '(9) default maxItems=12');
    assertEq(rankRetrievalForTurn(twenty, { maxItems: 0 }).length, 0, '(9) maxItems=0 → []');
    assertEq(rankRetrievalForTurn(twenty, { maxItems: -3 }).length, 0, '(9) negative maxItems → []');
    assertEq(rankRetrievalForTurn(twenty, { maxItems: 999999 }).length, 20, '(9) huge maxItems clamps to available');
    // top-5 are the 5 highest scores (n0..n4)
    assertEq(ids(rankRetrievalForTurn(twenty, { maxItems: 5 })).join(','), 'n0,n1,n2,n3,n4', '(9) cap keeps the BEST, not the first-arriving');
    assertEq(RETRIEVAL_RANK_DEFAULTS.maxItems, 12, '(9) exported default maxItems=12');
    assertEq(RETRIEVAL_RANK_DEFAULTS.maxOutputItems, 200, '(9) exported max output cap');
  }

  // ─── (10) Query-token lexical-overlap nudge ────────────────────────────────
  {
    // Equal score+no recency: default order is input order (B before A).
    const B = mk('B', 'unrelated grocery shopping list for the weekend', 0.3);
    const A = mk('A', 'the deployment pipeline broke on staging today', 0.3);
    assertEq(ids(rankRetrievalForTurn([B, A])).join(','), 'B,A', '(10) no query → stable input order');
    // With matching query tokens, A gets an overlap boost and jumps ahead.
    assertEq(ids(rankRetrievalForTurn([B, A], { queryTokens: 'deployment pipeline' })).join(','), 'A,B', '(10) query overlap reorders (string form)');
    assertEq(ids(rankRetrievalForTurn([B, A], { queryTokens: ['deployment', 'pipeline'] })).join(','), 'A,B', '(10) query overlap reorders (array form)');
    // Irrelevant query tokens → no reorder.
    assertEq(ids(rankRetrievalForTurn([B, A], { queryTokens: 'xylophone quokka' })).join(','), 'B,A', '(10) non-matching query → no reorder');
    // Hostile queryTokens (object) → ignored, no throw.
    assertEq(ids(rankRetrievalForTurn([B, A], { queryTokens: { bad: 1 } })).join(','), 'B,A', '(10) object queryTokens ignored');
  }

  // ─── (11) Determinism / stability / idempotency ────────────────────────────
  {
    const set = [
      mk('a', 'stable alpha one', 0.5, 'circle', NOW),
      mk('b', 'stable beta two', 0.5, 'circle', NOW),
      mk('c', 'stable gamma three', 0.7, 'session', NOW - 5 * DAY),
    ];
    const r1 = rankRetrievalForTurn(set, { nowMs: NOW });
    const r2 = rankRetrievalForTurn(set, { nowMs: NOW });
    assertEq(JSON.stringify(r1), JSON.stringify(r2), '(11) deterministic across calls');
    // idempotent: ranking the output again yields the same order
    const r3 = rankRetrievalForTurn(r1, { nowMs: NOW });
    assertEq(JSON.stringify(r1), JSON.stringify(r3), '(11) rank(rank(x)) == rank(x)');
    // stable tie-break: equal score/recency/source keeps input order (a before b)
    assertEq(ids(r1.filter((x) => x.id === 'a' || x.id === 'b')).join(','), 'a,b', '(11) stable order on full ties');
  }

  // ─── (12) normalizeRetrievalItems coercion ─────────────────────────────────
  {
    const out = normalizeRetrievalItems([
      'a bare string becomes text',
      { id: 'k', text: 'has text', score: 0.4, source: 'Circle', recencyMs: 123 },
      { content: 'content fallback', score: '0.6' },        // numeric-string score, content→text
      { id: 'neg', text: 'negative recency dropped', recencyMs: -5 },
      { text: 'missing-id gets positional' },                // no id → positional r{idx}
      null, undefined, 42, { text: '' }, { text: '   ' },   // all dropped
    ]);
    assertEq(out.length, 5, '(12) junk/empty dropped, 5 valid kept');
    assertEq(out[0].id, 'r0', '(12) bare string → positional id r0');
    assertEq(out[0].text, 'a bare string becomes text', '(12) bare string → text');
    assertEq(out[1].source, 'circle', '(12) source lowercased');
    assertEq(out[1].recencyMs, 123, '(12) recencyMs kept');
    assertEq(out[2].text, 'content fallback', '(12) content→text fallback');
    assertEq(out[2].score, 0.6, '(12) numeric-string score coerced');
    assertEq(out[3].recencyMs, undefined, '(12) negative recency → dropped field');
    assert(out[4].id.startsWith('r'), '(12) missing id → positional');
    // huge text + huge id are bounded
    const big = normalizeRetrievalItems([{ id: 'x'.repeat(5000), text: 'y'.repeat(500000) }]);
    assert(big[0].id.length <= 200, '(12) id bounded to 200', `len=${big[0].id.length}`);
    assert(big[0].text.length <= 20000, '(12) text bounded to 20000', `len=${big[0].text.length}`);
  }

  // ─── (13) dedupeRetrieval: order-preserving, first-wins (NOT ranking) ───────
  {
    const r = dedupeRetrieval([
      mk('first', 'shared operating fact about the repo', 0.1),   // low score, but FIRST
      mk('mid', 'a genuinely different note', 0.9),
      mk('dup', 'shared operating fact about the repo', 0.9),     // high score dup — dropped
    ]);
    assertEq(r.length, 2, '(13) dedupe collapses the repeat');
    assertEq(ids(r).join(','), 'first,mid', '(13) first occurrence wins, order preserved (no score reorder)');
    // dedupe does NOT sort by score (proves it is not ranking)
    assertEq(r[0].id, 'first', '(13) low-score first occurrence retained over high-score dup');
  }

  // ─── (14) Hostile / degenerate input never throws ──────────────────────────
  try {
    // mixed junk array
    const junk = rankRetrievalForTurn([null, undefined, 1, 'x', {}, { text: '' }, { text: '  ' }, true, Symbol('s')] as unknown[]);
    assert(Array.isArray(junk), '(14) junk array → array');
    assertEq(junk.length, 1, '(14) only the bare "x" string survives junk');

    // throwing getters on text and score
    const badText: Record<string, unknown> = { id: 'bt' };
    Object.defineProperty(badText, 'text', { enumerable: true, get() { throw new Error('boom'); } });
    const badScore: Record<string, unknown> = { id: 'bs', text: 'ok text here' };
    Object.defineProperty(badScore, 'score', { enumerable: true, get() { throw new Error('boom'); } });
    const good = mk('good', 'a perfectly good memory item');
    const r = rankRetrievalForTurn([badText, badScore, good]);
    assert(Array.isArray(r), '(14) throwing getters → array');
    assert(r.some((x) => x.id === 'good'), '(14) good item still surfaces past hostile getters');
    assert(!r.some((x) => x.id === 'bt'), '(14) throwing-text item dropped');

    // cyclic object with real text
    const cyclic: Record<string, unknown> = { id: 'cy', text: 'cyclic but readable' };
    cyclic.self = cyclic;
    const rc = rankRetrievalForTurn([cyclic]);
    assertEq(rc.length, 1, '(14) cyclic object handled');
    assertEq(rc[0].id, 'cy', '(14) cyclic item id preserved');

    // huge input array bounded (100k identical → dedup to 1, no hang)
    const huge = Array.from({ length: 100000 }, () => mk('h', 'the exact same memory line repeated a lot'));
    assertEq(rankRetrievalForTurn(huge).length, 1, '(14) 100k identical → 1 (bounded + deduped)');

    // 2000 distinct + absurd maxItems → clamped to 200
    const many = Array.from({ length: 2000 }, (_, i) => mk('m' + i, 'unique memory item number ' + i + ' about topic ' + i, Math.random() === -1 ? 0 : (2000 - i) / 2000));
    assertEq(rankRetrievalForTurn(many, { maxItems: 1e9 }).length, 200, '(14) 2000 distinct, maxItems 1e9 → clamped 200');

    // hostile opts fields
    assert(Array.isArray(rankRetrievalForTurn([mk('z', 'z text')], { maxItems: NaN, nowMs: 'abc' as unknown as number, halfLifeMs: -5 })), '(14) hostile opts → array');
    assertEq(rankRetrievalForTurn([mk('z', 'z text')], { maxItems: NaN as unknown as number }).length, 1, '(14) NaN maxItems → default applies');

    // huge single text
    assertEq(rankRetrievalForTurn([mk('bigt', 'q'.repeat(500000), 0.5)]).length, 1, '(14) 500k-char text handled');

    // queryTokens array with a throwing element getter
    const badToks: unknown[] = [];
    Object.defineProperty(badToks, '0', { enumerable: true, get() { throw new Error('boom'); } });
    (badToks as unknown as { length: number }).length = 1;
    assert(Array.isArray(rankRetrievalForTurn([mk('q', 'q text')], { queryTokens: badToks })), '(14) hostile queryTokens getter → array');

    // dedupeRetrieval / normalize on hostile input
    assert(Array.isArray(dedupeRetrieval(42 as unknown)), '(14) dedupe non-array → array');
    assert(Array.isArray(normalizeRetrievalItems(badText as unknown)), '(14) normalize non-array obj → array');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (14) hostile input threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chat-retrieval-rank-core smoke cases passed (${passes} passed).`);
}

main();
