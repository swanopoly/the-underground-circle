/**
 * memory-retrieval-policy-core-smoketest — the PURE relevance policy behind
 * turn-time memory recall (src/lib/memoryRetrievalPolicyCore.ts).
 *
 * Retrieval quality has no user-visible error mode: a wrong decision here does
 * not throw, it just quietly changes what the model believes. All four defects
 * this core fixes were invisible in production for months. These assertions are
 * the guard on that:
 *
 *   scoreRetrievalCandidate: source-normalized relevance, the pinned boost, the
 *     recency decay (floored, never banning), and the two floors.
 *   selectRetrievalCandidates: floor filter + total-order ranking + finalCount.
 *   mergeRetrievalCandidates: semantic ∪ keyword, deduped, semantic winning.
 *   computeKeywordCoverage/keywordRelevance: lexical evidence on its OWN, lower
 *     ceiling — never masquerading as a cosine score.
 *   planMemoryBundleSections/clampSectionText: value-budgeted section fit
 *     replacing a tail slice.
 *
 * REGRESSION ANCHORS (the four verified defects):
 *   (1) PINNED WAS DEAD — the boost existed but the column never reached the
 *       scorer (missing from the match_memories projection AND mapMemoryEntry),
 *       so a pinned memory and an identical unpinned one scored the same.
 *   (2) NO RELEVANCE FLOOR — matchThreshold 0 + density-only selection meant the
 *       nearest neighbours of a totally unrelated question filled the block.
 *   (3) TAIL SLICE CUT THE RELEVANT SECTION — the query-ranked block was 4th of
 *       5 in a `.join().slice(0, 5000)`, so bulky always-on text truncated
 *       exactly the memories chosen BECAUSE they match this turn.
 *   (4) FALLBACK WAS AN `else` — match_memories filters `embedding IS NOT NULL`,
 *       so once ONE row in a circle was embedded every un-embedded row became
 *       permanently unreachable.
 *
 * Pure — loads under tsx (the core only imports the import-free budget core).
 *   npx tsx scripts/memory-retrieval-policy-core-smoketest.ts
 */

import {
  computeKeywordCoverage,
  keywordRelevance,
  relevanceFloorFor,
  finalScoreFloorFor,
  scoreRetrievalCandidate,
  selectRetrievalCandidates,
  mergeRetrievalCandidates,
  planMemoryBundleSections,
  clampSectionText,
  SEMANTIC_RELEVANCE_FLOOR,
  SEMANTIC_RPC_MATCH_THRESHOLD,
  KEYWORD_RELEVANCE_CEILING,
  KEYWORD_RELEVANCE_FLOOR,
  KEYWORD_TITLE_BONUS,
  KEYWORD_CONFIDENCE,
  SEMANTIC_CONFIDENCE,
  PINNED_BOOST,
  PINNED_FLOOR_RELIEF,
  MIN_FINAL_SCORE,
  IMPORTANCE_BONUS_WEIGHT,
  HELPFULNESS_SWING,
  RECENCY_FLOOR,
  RECENCY_HALF_LIFE_DAYS,
  DEFAULT_FINAL_COUNT,
  MEMORY_BUNDLE_SECTIONS,
  MEMORY_BUNDLE_BUDGET_CHARS,
  MEMORY_BUNDLE_SECTION_VALUE,
  MEMORY_BUNDLE_SECTION_SHARE_CAP,
  MEMORY_BUNDLE_RESERVED_SECTIONS,
  MEMORY_BUNDLE_MIN_REVIVE_CHARS,
  SECTION_TRUNCATION_MARKER,
  type RetrievalCandidateSignals,
} from '../src/lib/memoryRetrievalPolicyCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertClose(a: number, b: number, msg: string, eps = 1e-9): void {
  assert(Math.abs(a - b) < eps, msg, `got ${a} want ~${b}`);
}

// Fixed clock — the core never reads one, so every case is reproducible.
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

// ── call wrappers (keep hostile fixtures cast-free at the call sites) ────────
function score(c: unknown, nowMs: unknown = NOW, opts?: { enforceFloors?: boolean }) {
  return scoreRetrievalCandidate(c, nowMs, opts);
}
function select(cands: unknown, opts?: { nowMs?: number | null; finalCount?: number | null; enforceFloors?: boolean }) {
  return selectRetrievalCandidates(cands, { nowMs: NOW, ...(opts || {}) });
}
/** A semantic candidate: fresh, unboosted, unrated. Only `similarity` varies. */
function sem(id: string, similarity: number, over: Partial<RetrievalCandidateSignals> = {}): RetrievalCandidateSignals {
  return { id, matchSource: 'semantic', similarity, timestampMs: NOW, ...over };
}
/** A keyword (ILIKE-fallback) candidate — an UN-EMBEDDED row's only way in. */
function kw(id: string, coverage: number, over: Partial<RetrievalCandidateSignals> = {}): RetrievalCandidateSignals {
  return { id, matchSource: 'keyword', keywordCoverage: coverage, timestampMs: NOW, ...over };
}
function ids(list: Array<{ id: string }>): string[] {
  return list.map((x) => x.id);
}

function main(): void {
  // ── 1. computeKeywordCoverage ─────────────────────────────────────────────
  const terms = ['pgbouncer', 'pooling', 'postgres'];
  const full = computeKeywordCoverage(terms, 'Postgres pooling', 'We run pgbouncer for pooling.');
  assertClose(full.coverage, 1, 'coverage: every term present → 1');
  assertEq(full.titleHit, true, 'coverage: title hit detected');
  assertEq(full.matchedTerms, 3, 'coverage: counts matched terms');

  const none = computeKeywordCoverage(terms, 'Netlify build cache', 'Nothing relevant.');
  assertEq(none.coverage, 0, 'coverage: no term present → 0');
  assertEq(none.titleHit, false, 'coverage: no title hit');

  // length-weighted: the long distinctive token carries more than the short one
  const longOnly = computeKeywordCoverage(['pgbouncer', 'app'], '', 'pgbouncer runs here');
  const shortOnly = computeKeywordCoverage(['pgbouncer', 'app'], '', 'the app runs here');
  assert(longOnly.coverage > shortOnly.coverage, 'coverage: long distinctive term outweighs a short generic one',
    `${longOnly.coverage} vs ${shortOnly.coverage}`);
  assert(longOnly.coverage <= 1 && shortOnly.coverage >= 0, 'coverage: stays in [0,1]');

  assertEq(computeKeywordCoverage(terms, null, null).coverage, 0, 'coverage: null text → 0');
  assertEq(computeKeywordCoverage([], 'x', 'x').coverage, 0, 'coverage: no terms → 0');
  assertEq(computeKeywordCoverage(null, 'x', 'x').coverage, 0, 'coverage(null terms) → 0');
  assertEq(computeKeywordCoverage('nope', 'x', 'x').coverage, 0, 'coverage(non-array terms) → 0');
  // case-insensitive + body-only match must not claim a title hit
  const bodyOnly = computeKeywordCoverage(['PGBOUNCER'], 'unrelated title', 'we run PgBouncer');
  assertClose(bodyOnly.coverage, 1, 'coverage: case-insensitive');
  assertEq(bodyOnly.titleHit, false, 'coverage: body-only match is not a title hit');
  // duplicate terms must not inflate the denominator or the numerator
  assertClose(computeKeywordCoverage(['pooling', 'pooling'], '', 'pooling').coverage, 1, 'coverage: duplicate terms collapse');

  // ── 2. keywordRelevance — lexical evidence on its own, lower ceiling ───────
  assertEq(keywordRelevance(1, false), KEYWORD_RELEVANCE_CEILING, 'keyword: full coverage → the ceiling, not 1.0');
  assertEq(keywordRelevance(0, false), 0, 'keyword: zero coverage → 0');
  assert(keywordRelevance(1, true) <= KEYWORD_RELEVANCE_CEILING, 'keyword: title bonus cannot exceed the ceiling');
  assert(keywordRelevance(0.5, true) > keywordRelevance(0.5, false), 'keyword: title hit raises relevance');
  assertClose(keywordRelevance(0.5, true), KEYWORD_RELEVANCE_CEILING * (0.5 + KEYWORD_TITLE_BONUS), 'keyword: bonus is additive on coverage');
  assertEq(keywordRelevance(5, false), KEYWORD_RELEVANCE_CEILING, 'keyword: coverage > 1 clamps');
  assertEq(keywordRelevance(-3, false), 0, 'keyword: negative coverage clamps to 0');
  assertEq(keywordRelevance(null), 0, 'keyword(null) → 0');
  assertEq(keywordRelevance('nope'), 0, 'keyword(non-numeric) → 0');
  assertEq(keywordRelevance(NaN), 0, 'keyword(NaN) → 0');
  // [regression 4-adjacent] the old flat synthetic similarity is unreachable now
  assert(keywordRelevance(1, true) < 0.5, '[regression] no keyword row can reach the old synthetic 0.5', String(keywordRelevance(1, true)));

  // ── 3. floors ─────────────────────────────────────────────────────────────
  assertEq(relevanceFloorFor('semantic'), SEMANTIC_RELEVANCE_FLOOR, 'floor: semantic default');
  assertEq(relevanceFloorFor('keyword'), KEYWORD_RELEVANCE_FLOOR, 'floor: keyword default');
  assertEq(relevanceFloorFor('nonsense'), SEMANTIC_RELEVANCE_FLOOR, 'floor: unknown source treated as semantic');
  assertEq(relevanceFloorFor(null), SEMANTIC_RELEVANCE_FLOOR, 'floor(null) → semantic');
  assertClose(relevanceFloorFor('semantic', true), SEMANTIC_RELEVANCE_FLOOR - PINNED_FLOOR_RELIEF, 'floor: pin buys relief');
  assert(relevanceFloorFor('semantic', true) > 0, 'floor: pin relief never reaches zero (pin is not an exemption)');
  assert(relevanceFloorFor('keyword', true) > 0, 'floor: keyword pin relief stays positive');

  // the RPC-side threshold must never pre-empt a decision this core owns
  assert(SEMANTIC_RPC_MATCH_THRESHOLD <= relevanceFloorFor('semantic', true),
    '[bounds] RPC threshold <= the lowest semantic floor (a pinned row)', String(SEMANTIC_RPC_MATCH_THRESHOLD));
  assert(SEMANTIC_RPC_MATCH_THRESHOLD <= SEMANTIC_RELEVANCE_FLOOR, '[bounds] RPC threshold <= the semantic floor');

  assert(finalScoreFloorFor(SEMANTIC_RELEVANCE_FLOOR, SEMANTIC_CONFIDENCE) > finalScoreFloorFor(KEYWORD_RELEVANCE_FLOOR, KEYWORD_CONFIDENCE),
    '[bounds] the score gate is per-source, not one absolute number');
  assertEq(finalScoreFloorFor(0, 0), MIN_FINAL_SCORE, 'score gate: degenerate input → the absolute guard');
  assertEq(finalScoreFloorFor(null, null), MIN_FINAL_SCORE, 'score gate(null) → the absolute guard');

  // ── 4. scoreRetrievalCandidate — threshold boundaries ─────────────────────
  const semFloor = relevanceFloorFor('semantic');
  assertEq(score(sem('at', semFloor + 1e-6)).admissible, true, '[threshold] just above the semantic floor is admissible');
  const justBelow = score(sem('below', semFloor - 1e-6));
  assertEq(justBelow.admissible, false, '[threshold] just below the semantic floor is rejected');
  assertEq(justBelow.rejectReason, 'below_relevance_floor', '[threshold] rejection is attributed to the relevance floor');

  const pinFloor = relevanceFloorFor('semantic', true);
  assertEq(score(sem('pinAt', pinFloor + 1e-6, { pinned: true })).admissible, true, '[threshold] pinned row admitted at the relieved floor');
  assertEq(score(sem('pinBelow', pinFloor - 1e-6, { pinned: true })).admissible, false, '[threshold] pinned row still has a floor');
  assertEq(score(sem('unpinnedAtPinFloor', pinFloor + 1e-6)).admissible, false, '[threshold] the relief applies ONLY to pinned rows');

  assertEq(score(kw('kwOk', 0.5)).admissible, true, '[threshold] keyword coverage 0.5 clears the keyword floor');
  assertEq(score(kw('kwWeak', 0.3)).admissible, false, '[threshold] keyword coverage 0.3 does not');
  assertEq(score(kw('kwWeak', 0.3)).rejectReason, 'below_relevance_floor', '[threshold] weak lexical hit rejected on relevance');

  // ── 5. scoreRetrievalCandidate — shape of the score ───────────────────────
  const plain = score(sem('plain', 0.5));
  assertClose(plain.score, 0.5, 'score: fresh unboosted semantic score == similarity');
  assertEq(plain.recencyMultiplier, 1, 'score: a same-instant memory takes no decay');
  assertEq(plain.confidence, SEMANTIC_CONFIDENCE, 'score: semantic confidence is the reference 1');
  assertEq(plain.matchSource, 'semantic', 'score: match source echoed');

  const halfLife = score(sem('half', 0.5, { timestampMs: NOW - RECENCY_HALF_LIFE_DAYS * DAY }));
  assertClose(halfLife.recencyMultiplier, RECENCY_FLOOR + (1 - RECENCY_FLOOR) * 0.5, 'score: one half-life halves the decayable part');
  const ancient = score(sem('old', 0.5, { timestampMs: NOW - 4000 * DAY }));
  assertClose(ancient.recencyMultiplier, RECENCY_FLOOR, 'score: decay bottoms out at the floor (old is discounted, never banned)');
  assert(ancient.admissible, 'score: an ancient but relevant memory is still admissible');
  assertEq(score(sem('noStamp', 0.5, { timestampMs: null })).recencyMultiplier, 1,
    'score: a missing timestamp is neutral, not infinitely old');
  assertEq(score(sem('future', 0.5, { timestampMs: NOW + 90 * DAY })).recencyMultiplier, 1,
    'score: a clock-skewed future timestamp cannot exceed 1');

  assertClose(score(sem('imp', 0.5, { importance: 1 })).score, 0.5 + IMPORTANCE_BONUS_WEIGHT, 'score: importance bonus applied');
  assertClose(score(sem('soul', 0.5, { soulBoost: 0.25 })).score, 0.75, 'score: caller-supplied soul boost applied');
  assertClose(score(sem('task', 0.5, { taskAffinity: 0.1 })).score, 0.6, 'score: task affinity applied');
  assertClose(score(sem('help', 0.5, { helpfulness: 1 })).score, 0.5 + HELPFULNESS_SWING / 2, 'score: helpfulness swings up');
  assertClose(score(sem('unrated', 0.5, { helpfulness: null })).score, 0.5, 'score: an unrated memory is not penalized');

  // the score gate is a SUPPRESSION gate, and it works on each source's scale
  const suppressed = score(sem('sup', SEMANTIC_RELEVANCE_FLOOR, { helpfulness: 0 }));
  assertEq(suppressed.admissible, false, '[score gate] a floor-grazing memory voted "not helpful" is dropped');
  assertEq(suppressed.rejectReason, 'below_score_floor', '[score gate] attributed to the score floor, not relevance');
  assertEq(score(sem('sup', SEMANTIC_RELEVANCE_FLOOR)).admissible, true, '[score gate] the same memory without the down-vote survives');
  const kwSuppressed = score(kw('kwSup', 0.5, { helpfulness: 0 }));
  assertEq(kwSuppressed.admissible, false, '[score gate] suppression drops a keyword row too');
  assertEq(score(kw('kwFine', 0.5)).admissible, true, '[score gate] but an unsuppressed keyword row is NOT double-penalized');
  assert(score(kw('kwFull', 1, { timestampMs: NOW - 4000 * DAY })).admissible,
    '[score gate] a full-coverage ANCIENT keyword row still survives (the un-embedded reachability path)');

  // determinism
  assertEq(JSON.stringify(score(sem('d', 0.42, { importance: 0.5, helpfulness: 0.8 }))),
    JSON.stringify(score(sem('d', 0.42, { importance: 0.5, helpfulness: 0.8 }))), 'score: deterministic');

  // ── 6. REGRESSION (1): pinned actually changes the ranking ────────────────
  const pinnedRow = sem('pinned', 0.5, { pinned: true });
  const plainRow = sem('plain', 0.5);
  const pinnedScore = score(pinnedRow);
  const plainScore = score(plainRow);
  assert(pinnedScore.score > plainScore.score,
    '[regression 1] a pinned memory outranks an equal-similarity unpinned one', `${pinnedScore.score} vs ${plainScore.score}`);
  assertClose(pinnedScore.score - plainScore.score, PINNED_BOOST, '[regression 1] the gap is exactly the pinned boost');
  assert(pinnedScore.score !== plainScore.score, '[regression 1] the pre-fix TIE (pinned never reached the scorer) is gone');
  assertEq(pinnedScore.pinned, true, '[regression 1] pin state is echoed for the UI');
  assertEq(select([plainRow, pinnedRow]).keep[0].id, 'pinned', '[regression 1] and it wins the selection, not just the score');
  assertEq(select([pinnedRow, plainRow]).keep[0].id, 'pinned', '[regression 1] order-independently');

  // the boost is a thumb on the scale, not a takeover
  assertEq(select([sem('better', 0.55), pinnedRow]).keep[0].id, 'pinned',
    '[regression 1] a pin beats a slightly closer neighbour');
  assertEq(select([sem('muchBetter', 0.70), pinnedRow]).keep[0].id, 'muchBetter',
    '[regression 1] but NOT a much closer one — the boost is bounded');
  // a pinned row that is genuinely off-topic still must not be injected
  assertEq(score(sem('offTopic', 0.05, { pinned: true })).admissible, false,
    '[regression 1] pinning is not an unconditional inject (a pinned billing note ≠ a CSS answer)');

  // ── 7. REGRESSION (2): the relevance floor ───────────────────────────────
  // A question this circle has no memory about. Cosine still returns its nearest
  // neighbours; every one of them is noise-band.
  const unrelated = [
    sem('n1', 0.24), sem('n2', 0.21), sem('n3', 0.19), sem('n4', 0.13), sem('n5', 0.04),
  ];
  const unrelatedPick = select(unrelated);
  assertEq(unrelatedPick.keep.length, 0, '[regression 2] an unrelated question recalls NOTHING');
  assertEq(unrelatedPick.rejected.belowRelevanceFloor, 5, '[regression 2] all five neighbours attributed to the floor');
  assertEq(unrelatedPick.drop.length, 5, '[regression 2] every candidate is accounted for');
  // proof the FIXTURE is not the reason — with floors off, the old behavior returns
  const preFix = select(unrelated, { enforceFloors: false });
  assertEq(preFix.keep.length, 5, '[regression 2] pre-fix behavior (no floor) would have injected all five');
  // and a real hit in the same set still lands
  const mixed = select([...unrelated, sem('real', 0.46)]);
  assertEq(ids(mixed.keep).join(','), 'real', '[regression 2] the one real match survives, alone');

  // ── 8. REGRESSION (4): an un-embedded memory stays reachable ─────────────
  // match_memories filters `embedding IS NOT NULL`. The ILIKE branch used to be
  // an `else` on it returning nothing, so ONE embedded row hid every un-embedded
  // one forever. The branches must UNION.
  const embedded = [sem('e1', 0.34), sem('e2', 0.31), sem('e3', 0.29)];
  const unembedded = kw('u1', 1, { keywordTitleHit: true });

  const merged = mergeRetrievalCandidates<RetrievalCandidateSignals>(embedded, [unembedded]);
  assertEq(merged.length, 4, '[regression 4] the keyword branch CONTRIBUTES; it does not substitute');
  assert(ids(merged).includes('u1'), '[regression 4] the un-embedded row survives the merge while other rows ARE embedded');
  assertEq(ids(merged)[3], 'u1', '[regression 4] semantic rows keep their order ahead of it');
  assert(ids(select(merged, { finalCount: DEFAULT_FINAL_COUNT }).keep).includes('u1'),
    '[regression 4] and it is still there after floor-filtering + ranking');

  // the case that matters most: only the UN-EMBEDDED row knows the answer.
  const onlyUnembeddedKnows = mergeRetrievalCandidates<RetrievalCandidateSignals>(
    [sem('e1', 0.20), sem('e2', 0.17), sem('e3', 0.11)],  // embedded, all off-topic
    [kw('u1', 1, { keywordTitleHit: true })],             // un-embedded, lexically exact
  );
  assertEq(ids(select(onlyUnembeddedKnows).keep).join(','), 'u1',
    '[regression 4] the un-embedded memory is THE answer, and it is recalled');

  // dedup: a row returned by both branches keeps its semantic evidence
  const dupSemantic = sem('shared', 0.62);
  const dupKeyword = kw('shared', 1);
  const deduped = mergeRetrievalCandidates<RetrievalCandidateSignals>([dupSemantic], [dupKeyword]);
  assertEq(deduped.length, 1, '[regression 4] a row in both branches appears once');
  assertEq(deduped[0].matchSource, 'semantic', '[regression 4] semantic evidence wins the collision');
  assertEq(mergeRetrievalCandidates([], [unembedded]).length, 1, '[regression 4] keyword-only (nothing embedded yet) still works');
  assertEq(mergeRetrievalCandidates(embedded, []).length, 3, '[regression 4] semantic-only still works');

  // ── 9. keyword rows are not scored as semantic ones ──────────────────────
  const perfectKeyword = score(kw('kwPerfect', 1, { keywordTitleHit: true }));
  assertEq(perfectKeyword.confidence, KEYWORD_CONFIDENCE, 'keyword rows carry the confidence discount');
  assertClose(perfectKeyword.score, KEYWORD_RELEVANCE_CEILING * KEYWORD_CONFIDENCE, 'keyword: score == relevance × confidence');
  assert(perfectKeyword.score < score(sem('weakSemantic', SEMANTIC_RELEVANCE_FLOOR)).score,
    '[keyword discount] a PERFECT lexical match ranks below the weakest admissible semantic match',
    `${perfectKeyword.score} vs ${score(sem('weakSemantic', SEMANTIC_RELEVANCE_FLOOR)).score}`);
  assertEq(select([kw('k', 1, { keywordTitleHit: true }), sem('s', 0.29)]).keep[0].id, 's',
    '[keyword discount] and the semantic row wins the slot');
  // ...but the discount is a tiebreak, not a ban: real lexical evidence beats noise
  assertEq(select([kw('k', 1), sem('s', 0.29)], { finalCount: 2 }).keep.length, 2, 'both still land when there is room');

  // ── 10. selectRetrievalCandidates — ordering, caps, determinism ───────────
  const pool = [sem('a', 0.40), sem('b', 0.60), sem('c', 0.50), sem('d', 0.30)];
  assertEq(ids(select(pool).keep).join(','), 'b,c,a,d', 'select: score-descending');
  assertEq(ids(select([...pool].reverse()).keep).join(','), 'b,c,a,d', 'select: order-independent');
  assertEq(select(pool, { finalCount: 2 }).keep.length, 2, 'select: finalCount honored');
  assertEq(ids(select(pool, { finalCount: 2 }).keep).join(','), 'b,c', 'select: finalCount keeps the BEST two');
  assertEq(select(pool, { finalCount: 2 }).drop.length, 2, 'select: overflow is reported as dropped');
  assertEq(select(pool, { finalCount: 0 }).keep.length, 0, 'select: finalCount 0 keeps nothing');
  assertEq(select(pool, { finalCount: -5 }).keep.length, 0, 'select: negative finalCount keeps nothing');
  assertEq(select(pool, { finalCount: null }).keep.length, 4, 'select: null finalCount → the default cap');
  assertEq(JSON.stringify(select(pool)), JSON.stringify(select(pool)), 'select: deterministic across calls');

  // exact ties resolve by a total order (semantic first, then input index).
  // Floors off here on purpose: the only way a keyword row can TIE a semantic one
  // is at a score below the semantic floor, so this exercises the comparator.
  const tieScore = score(kw('probe', 1)).score;
  const tie = select([kw('tieKw', 1), sem('tieSem', tieScore)], { enforceFloors: false });
  assertClose(score(sem('tieSem', tieScore)).score, tieScore, 'select: tie fixture really is an exact tie');
  assertEq(tie.keep[0].id, 'tieSem', 'select: an exact score tie prefers semantic evidence');
  assertEq(select([sem('first', 0.5), sem('second', 0.5)]).keep[0].id, 'first',
    'select: a same-source tie falls back to input order');
  // duplicate ids inside one branch collapse
  assertEq(select([sem('dup', 0.5), sem('dup', 0.9)]).keep.length, 1, 'select: duplicate ids collapse (first wins)');
  assertClose(select([sem('dup', 0.5), sem('dup', 0.9)]).keep[0].score, 0.5, 'select: the first occurrence is the one kept');

  // ── 11. REGRESSION (3): the query-ranked section survives the budget ─────
  const sectionText = (heading: string, totalChars: number, fill: string): string => {
    const prefix = `${heading}\n`;
    return prefix + fill.repeat(Math.max(0, totalChars - prefix.length));
  };
  const RELEVANT_HEADING = '## Relevant Working Memory';
  const startupText = sectionText('## Startup Memory', 4800, 's');
  const wisdomText = sectionText('## Soul Wisdom', 900, 'w');
  const externalText = sectionText('## External Agents', 600, 'x');
  const relevantText = sectionText(RELEVANT_HEADING, 1200, 'r');
  const supportingText = sectionText('## Supporting Memory', 300, 'p');
  assertEq(startupText.length, 4800, 'fixture: startup is 4800 chars');
  assertEq(relevantText.length, 1200, 'fixture: relevant-turn is 1200 chars');

  const JOINER = '\n\n';
  const allSections = [
    { id: MEMORY_BUNDLE_SECTIONS.startup, text: startupText },
    { id: MEMORY_BUNDLE_SECTIONS.soulWisdom, text: wisdomText },
    { id: MEMORY_BUNDLE_SECTIONS.externalAgents, text: externalText },
    { id: MEMORY_BUNDLE_SECTIONS.relevantTurn, text: relevantText },
    { id: MEMORY_BUNDLE_SECTIONS.supporting, text: supportingText },
  ];

  // the PRE-FIX algorithm, run on the exact same input
  const legacy = allSections.map((s) => s.text).join(JOINER).slice(0, MEMORY_BUNDLE_BUDGET_CHARS);
  assert(!legacy.includes(RELEVANT_HEADING),
    '[regression 3] the old join+tail-slice cut the query-ranked section ENTIRELY');
  assert(legacy.includes('## Startup Memory'), '[regression 3] ...while keeping all of the bulky always-on text');

  const plan = planMemoryBundleSections(
    allSections.map((s) => ({ id: s.id, chars: s.text.length + JOINER.length })),
    MEMORY_BUNDLE_BUDGET_CHARS,
  );
  const slotOf = (id: string) => plan.sections.find((s) => s.id === id)!;
  assert(plan.keptIds.includes(MEMORY_BUNDLE_SECTIONS.relevantTurn), '[regression 3] the query-ranked section is KEPT');
  assertEq(slotOf(MEMORY_BUNDLE_SECTIONS.relevantTurn).truncated, false, '[regression 3] and kept INTACT — not truncated');
  assertEq(slotOf(MEMORY_BUNDLE_SECTIONS.relevantTurn).maxChars, relevantText.length + JOINER.length,
    '[regression 3] at its full requested length');
  assertEq(slotOf(MEMORY_BUNDLE_SECTIONS.startup).truncated, true,
    '[regression 3] the bulky always-on section is the one that gives up chars');
  assert(slotOf(MEMORY_BUNDLE_SECTIONS.startup).keep, '[regression 3] but startup is never dropped outright — it carries standing instructions');
  assert(plan.usedChars <= MEMORY_BUNDLE_BUDGET_CHARS, '[regression 3] the total budget is respected', String(plan.usedChars));
  assertEq(plan.sections.reduce((n, s) => n + s.maxChars, 0), plan.usedChars, '[regression 3] usedChars is the real sum');

  // rendering the plan produces a bundle inside the budget with the relevant text intact
  const rendered = allSections
    .map((s) => {
      const slot = slotOf(s.id);
      if (!slot.keep) return '';
      return slot.truncated ? clampSectionText(s.text, Math.max(0, slot.maxChars - JOINER.length)) : s.text;
    })
    .filter(Boolean)
    .join(JOINER);
  assert(rendered.length <= MEMORY_BUNDLE_BUDGET_CHARS, '[regression 3] rendered bundle fits the budget', String(rendered.length));
  assert(rendered.includes(relevantText), '[regression 3] the query-ranked block survives VERBATIM in the render');
  assert(rendered.includes(SECTION_TRUNCATION_MARKER), '[regression 3] truncation is disclosed, not silent');

  // ── 12. planMemoryBundleSections — invariants ────────────────────────────
  const small = planMemoryBundleSections(
    [{ id: MEMORY_BUNDLE_SECTIONS.startup, chars: 100 }, { id: MEMORY_BUNDLE_SECTIONS.relevantTurn, chars: 200 }],
    5000,
  );
  assertEq(small.keptIds.length, 2, '[plan] everything fits → everything is kept');
  assertEq(small.sections.every((s) => !s.truncated), true, '[plan] ...and nothing is clamped for no reason');
  assertEq(small.usedChars, 300, '[plan] usedChars is the untouched total');

  // reserved sections survive an extreme overflow that would otherwise starve them
  const starve = planMemoryBundleSections([
    { id: MEMORY_BUNDLE_SECTIONS.soulWisdom, chars: 4000 },
    { id: MEMORY_BUNDLE_SECTIONS.externalAgents, chars: 4000 },
    { id: MEMORY_BUNDLE_SECTIONS.supporting, chars: 4000 },
    { id: MEMORY_BUNDLE_SECTIONS.startup, chars: 4000 },
    { id: MEMORY_BUNDLE_SECTIONS.relevantTurn, chars: 4000 },
  ], 5000);
  for (const reserved of MEMORY_BUNDLE_RESERVED_SECTIONS) {
    assert(starve.keptIds.includes(reserved), `[plan] reserved section "${reserved}" survives a 4x overflow`);
  }
  assert(starve.usedChars <= 5000, '[plan] budget respected under extreme overflow', String(starve.usedChars));
  // the two reservations are co-satisfiable BY CONSTRUCTION (this is the invariant
  // that stops it degrading into "whichever reserved section is listed first wins")
  const reservedShare = MEMORY_BUNDLE_RESERVED_SECTIONS
    .reduce((sum, id) => sum + (MEMORY_BUNDLE_SECTION_SHARE_CAP[id] || 0), 0);
  assert(reservedShare <= 1, '[bounds] reserved share caps sum to <= 1', String(reservedShare));
  // ...and it holds regardless of the order the caller lists them in
  const reversedStarve = planMemoryBundleSections([
    { id: MEMORY_BUNDLE_SECTIONS.relevantTurn, chars: 4000 },
    { id: MEMORY_BUNDLE_SECTIONS.startup, chars: 4000 },
    { id: MEMORY_BUNDLE_SECTIONS.soulWisdom, chars: 4000 },
  ], 5000);
  for (const reserved of MEMORY_BUNDLE_RESERVED_SECTIONS) {
    assert(reversedStarve.keptIds.includes(reserved), `[plan] "${reserved}" survives regardless of input order`);
  }

  // no section may exceed its share cap while others are competing
  const capped = planMemoryBundleSections([
    { id: MEMORY_BUNDLE_SECTIONS.startup, chars: 50_000 },
    { id: MEMORY_BUNDLE_SECTIONS.relevantTurn, chars: 50_000 },
  ], 1000);
  assert(capped.usedChars <= 1000, '[plan] a runaway section cannot exceed the budget', String(capped.usedChars));
  assert(capped.keptIds.includes(MEMORY_BUNDLE_SECTIONS.relevantTurn), '[plan] the query-ranked section still gets its share');
  assert(capped.sections.find((s) => s.id === MEMORY_BUNDLE_SECTIONS.relevantTurn)!.maxChars
    >= Math.floor(1000 * MEMORY_BUNDLE_SECTION_SHARE_CAP[MEMORY_BUNDLE_SECTIONS.relevantTurn]),
    '[plan] at least its full share cap');

  // breadth before depth: the knapsack must DROP soul_wisdom here (capped sizes
  // 800+900+500 = 2200 > 2000, and the two reservations take 1700 of it), then
  // the residual pass revives it at a shorter length instead of padding startup.
  const revive = planMemoryBundleSections([
    { id: MEMORY_BUNDLE_SECTIONS.startup, chars: 1800 },
    { id: MEMORY_BUNDLE_SECTIONS.relevantTurn, chars: 1800 },
    { id: MEMORY_BUNDLE_SECTIONS.soulWisdom, chars: 1800 },
  ], 2000);
  assertEq(revive.keptIds.length, 3, '[plan] residual budget revives a dropped section rather than padding a present one');
  assertEq(revive.sections.find((s) => s.id === MEMORY_BUNDLE_SECTIONS.soulWisdom)!.truncated, true,
    '[plan] ...and the revived section is honestly marked truncated');
  assert(revive.usedChars <= 2000, '[plan] revival still respects the budget', String(revive.usedChars));
  assert(revive.usedChars > 1700, '[plan] revival actually spent the residual', String(revive.usedChars));

  // degenerate plans
  assertEq(planMemoryBundleSections([], 5000).keptIds.length, 0, '[plan] no sections → nothing kept');
  assertEq(planMemoryBundleSections(null, 5000).keptIds.length, 0, '[plan] null → nothing kept');
  assertEq(planMemoryBundleSections('nope', 5000).keptIds.length, 0, '[plan] non-array → nothing kept');
  assertEq(planMemoryBundleSections([{ id: 'x', chars: 100 }], 0).keptIds.length, 0, '[plan] zero budget keeps nothing');
  assertEq(planMemoryBundleSections([{ id: 'x', chars: 100 }], -50).budgetChars, MEMORY_BUNDLE_BUDGET_CHARS,
    '[plan] a nonsense budget falls back to the default');
  assertEq(planMemoryBundleSections([{ id: '', chars: 100 }, { id: 'x', chars: 0 }], 5000).keptIds.length, 0,
    '[plan] blank ids and empty sections are skipped');
  assertEq(planMemoryBundleSections([{ id: 'x', chars: 10 }, { id: 'x', chars: 99 }], 5000).sections.length, 1,
    '[plan] duplicate section ids collapse');
  const unknownSection = planMemoryBundleSections([{ id: 'brand_new_section', chars: 100 }], 5000);
  assertEq(unknownSection.keptIds.length, 1, '[plan] an unknown section id still gets a default value/cap');

  // ── 13. clampSectionText ─────────────────────────────────────────────────
  const long = `line one\nline two\n${'z'.repeat(400)}`;
  const clamped = clampSectionText(long, 100);
  assert(clamped.length <= 100, '[clamp] never exceeds maxChars', String(clamped.length));
  assert(clamped.endsWith(SECTION_TRUNCATION_MARKER), '[clamp] discloses the truncation');
  assert(long.startsWith(clamped.slice(0, clamped.length - SECTION_TRUNCATION_MARKER.length)), '[clamp] result is a prefix of the input');
  assertEq(clampSectionText('short', 100), 'short', '[clamp] under-budget text is returned untouched');
  assertEq(clampSectionText('short', 5), 'short', '[clamp] exactly-at-budget text is untouched');
  assertEq(clampSectionText('', 100), '', '[clamp] empty → empty');
  assertEq(clampSectionText(null, 100), '', '[clamp] null → ""');
  assertEq(clampSectionText(42, 100), '', '[clamp] non-string → ""');
  assertEq(clampSectionText('abc', 0), '', '[clamp] zero budget → ""');
  assertEq(clampSectionText('abc', -1), '', '[clamp] negative budget → ""');
  assertEq(clampSectionText('abcdefghij', NaN), '', '[clamp] NaN budget → ""');
  assertEq(clampSectionText('abcdefghij', 4).length, 4, '[clamp] budget below the marker still hard-clamps');
  // cutting on a line boundary keeps whole lines when one is available
  const lines = `${'a'.repeat(60)}\n${'b'.repeat(60)}`;
  const lineClamped = clampSectionText(lines, 80);
  assert(lineClamped.startsWith('a'.repeat(60)), '[clamp] prefers a line boundary');
  assert(!lineClamped.includes('b'.repeat(10)), '[clamp] does not emit a half-line');

  // ── 14. degenerate / hostile input ───────────────────────────────────────
  try {
    assertEq(score(null).admissible, false, '[degenerate] score(null) → inadmissible');
    assertEq(score(undefined).rejectReason, 'invalid', '[degenerate] score(undefined) → invalid');
    assertEq(score({}).rejectReason, 'invalid', '[degenerate] score({}) → invalid (no id)');
    assertEq(score({ id: '' }).rejectReason, 'invalid', '[degenerate] blank id → invalid');
    assertEq(score('nope').rejectReason, 'invalid', '[degenerate] score(string) → invalid');
    assertEq(score(sem('nan', NaN)).admissible, false, '[degenerate] NaN similarity → inadmissible');
    // A non-finite similarity is treated as ABSENT (0), not as a perfect match —
    // a corrupt value must never be able to force an injection.
    assertEq(score(sem('inf', Infinity)).relevance, 0, '[degenerate] Infinity similarity → treated as absent, not perfect');
    assertEq(score(sem('inf', Infinity)).admissible, false, '[degenerate] ...and is therefore inadmissible');
    assertEq(score(sem('neg', -5)).relevance, 0, '[degenerate] negative similarity clamps to 0');
    assertEq(score(sem('t', 0.5), NaN).recencyMultiplier, 1, '[degenerate] NaN nowMs → neutral recency');
    assertEq(score(sem('t', 0.5), null).recencyMultiplier, 1, '[degenerate] null nowMs → neutral recency');
    assert(Number.isFinite(score({ id: 'j', similarity: 0.5, importance: Infinity, soulBoost: Infinity }).score),
      '[hostile] infinite boosts still yield a finite score');

    assertEq(select(null).keep.length, 0, '[degenerate] select(null) → empty');
    assertEq(select(undefined).keep.length, 0, '[degenerate] select(undefined) → empty');
    assertEq(select([]).keep.length, 0, '[degenerate] select([]) → empty');
    assertEq(select('nope').keep.length, 0, '[degenerate] select(string) → empty');
    assertEq(select([null, undefined, 7, 'x', sem('ok', 0.5)]).keep.length, 1, '[degenerate] junk entries are skipped');
    assertEq(select([null, undefined, 7, 'x', sem('ok', 0.5)]).keep[0].id, 'ok', '[degenerate] the real one survives');

    assertEq(mergeRetrievalCandidates(null, null).length, 0, '[degenerate] merge(null,null) → []');
    assertEq(mergeRetrievalCandidates('a', 'b').length, 0, '[degenerate] merge(strings) → []');
    assertEq(mergeRetrievalCandidates([{ id: 'a' }], null).length, 1, '[degenerate] merge tolerates a null branch');
    assertEq(mergeRetrievalCandidates([null, { id: 'a' }, { }], [{ id: 'a' }, { id: 'b' }]).length, 2,
      '[degenerate] merge skips id-less junk and dedupes');

    const throwing = { id: 'th', get similarity() { throw new Error('boom'); }, matchSource: 'semantic' };
    assertEq(score(throwing).id, 'th', '[hostile] a throwing getter is tolerated');
    assertEq(score(throwing).admissible, false, '[hostile] ...and yields an inadmissible candidate, not a crash');

    const cyclic: Record<string, unknown> = { id: 'cy', matchSource: 'semantic', similarity: 0.9, timestampMs: NOW };
    cyclic.self = cyclic;
    assertEq(score(cyclic).admissible, true, '[hostile] a cyclic candidate is tolerated');

    const huge = Array.from({ length: 5000 }, (_, i) => sem(`h${i}`, 0.5));
    assert(select(huge, { finalCount: 12 }).keep.length === 12, '[hostile] 5000 candidates stay bounded');
    assertEq(computeKeywordCoverage(['x'.repeat(500_000)], 'y'.repeat(500_000), 'z'.repeat(500_000)).coverage, 0,
      '[hostile] 500k-char inputs are bounded and finite');
    assert(clampSectionText('q'.repeat(500_000), 1000).length <= 1000, '[hostile] clamping a 500k-char section stays bounded');
    assert(planMemoryBundleSections(
      Array.from({ length: 5000 }, (_, i) => ({ id: `s${i}`, chars: 50 })), 5000).usedChars <= 5000,
      '[hostile] 5000 sections stay inside the budget');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: [HOSTILE] sweep threw: ${(e as Error)?.message}`);
  }

  // ── 15. threshold sanity (documented invariants) ─────────────────────────
  assert(SEMANTIC_RELEVANCE_FLOOR > 0 && SEMANTIC_RELEVANCE_FLOOR < 0.5,
    '[bounds] the semantic floor sits above the noise band and below the on-topic band');
  assert(KEYWORD_RELEVANCE_CEILING < 0.5, '[bounds] lexical evidence cannot reach the on-topic band');
  assert(KEYWORD_RELEVANCE_FLOOR < KEYWORD_RELEVANCE_CEILING, '[bounds] the keyword floor is reachable');
  assert(KEYWORD_CONFIDENCE < SEMANTIC_CONFIDENCE, '[bounds] lexical evidence is trusted less than semantic');
  assert(KEYWORD_RELEVANCE_CEILING * KEYWORD_CONFIDENCE <= SEMANTIC_RELEVANCE_FLOOR,
    '[bounds] a perfect lexical match tops out at/below the weakest admissible semantic match');
  assert(PINNED_FLOOR_RELIEF < SEMANTIC_RELEVANCE_FLOOR, '[bounds] pin relief cannot zero the semantic floor');
  assert(PINNED_FLOOR_RELIEF < KEYWORD_RELEVANCE_FLOOR, '[bounds] pin relief cannot zero the keyword floor');
  assert(PINNED_BOOST > 0 && PINNED_BOOST < SEMANTIC_RELEVANCE_FLOOR,
    '[bounds] the pinned boost is a thumb on the scale, not an override');
  assert(RECENCY_FLOOR > 0 && RECENCY_FLOOR < 1, '[bounds] recency discounts but never bans');
  assert(MEMORY_BUNDLE_SECTION_VALUE[MEMORY_BUNDLE_SECTIONS.relevantTurn]
    > MEMORY_BUNDLE_SECTION_VALUE[MEMORY_BUNDLE_SECTIONS.startup],
    '[bounds] the query-ranked section outvalues standing context');
  assert(MEMORY_BUNDLE_SECTION_VALUE[MEMORY_BUNDLE_SECTIONS.startup]
    > MEMORY_BUNDLE_SECTION_VALUE[MEMORY_BUNDLE_SECTIONS.supporting],
    '[bounds] leftovers are valued last');
  assert(MEMORY_BUNDLE_MIN_REVIVE_CHARS > 0, '[bounds] revival needs a usable minimum');
  assert(MIN_FINAL_SCORE > 0, '[bounds] the absolute score guard is positive');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll memory-retrieval-policy-core smoke cases passed (${passes} passed).`);
}

main();
