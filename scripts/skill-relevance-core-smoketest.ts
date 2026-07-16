/**
 * skill-relevance-core-smoketest — the PURE content-aware skill relevance core
 * (src/lib/skillRelevanceCore.ts). Load-bearing behavior asserted here:
 *   - skillContentScore: lexical overlap over name/description/tags/keywords,
 *     field weighting (tags/keywords > name > description), whole-token match
 *     (no substring false positives), query de-dupe + stopword filtering,
 *     min-token-length, clamp to [0, CONTENT_SCORE_MAX], empty/absent → 0.
 *   - rankSkillsByRelevance: hintScore is the PRIMARY key (a hinted skill never
 *     drops below an unhinted higher-content one), content is the SECONDARY key
 *     (breaks ties WITHIN a hint tier), original order is the stable final key,
 *     maxSkills respected, determinism, and total never-throws safety on
 *     hostile / cyclic / huge inputs.
 *
 * Pure — loads under tsx (skillRelevanceCore has zero imports).
 */

import {
  skillContentScore,
  rankSkillsByRelevance,
  CONTENT_SCORE_MAX,
  type ScorableSkill,
} from '../src/lib/skillRelevanceCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function names(skills: ScorableSkill[]): string[] {
  return skills.map((s) => (s && typeof s === 'object' ? s.name : String(s)));
}

function main(): void {
  // ─── (1) basic lexical overlap across each field ────────────────────────────
  const desc = skillContentScore({ name: 'x', description: 'handles database migration work' }, 'database migration');
  assert(desc > 0, '(1) description overlap scores > 0');
  const tagHit = skillContentScore({ name: 'x', tags: ['database', 'migration'] }, 'database migration');
  assert(tagHit > 0, '(1) tag overlap scores > 0');
  const kwHit = skillContentScore({ name: 'x', keywords: ['database'] }, 'database migration');
  assert(kwHit > 0, '(1) keyword overlap scores > 0');
  const nameHit = skillContentScore({ name: 'database_helper' }, 'database migration');
  assert(nameHit > 0, '(1) name overlap scores > 0');
  const none = skillContentScore({ name: 'photoshop_export', description: 'exports layers' }, 'database migration');
  assertEq(none, 0, '(1) zero lexical overlap → 0');

  // ─── (2) field weighting: tags/keywords > name > description ─────────────────
  const q = 'payment';
  const inTag = skillContentScore({ name: 'zzz', description: 'zzz', tags: ['payment'] }, q);
  const inName = skillContentScore({ name: 'payment', description: 'zzz' }, q);
  const inDesc = skillContentScore({ name: 'zzz', description: 'payment flows' }, q);
  assert(inTag > inName, '(2) tag hit outweighs name hit');
  assert(inName > inDesc, '(2) name hit outweighs description hit');
  assertEq(inTag, 3, '(2) single tag hit == WEIGHT_STRONG(3)');
  assertEq(inName, 2, '(2) single name hit == WEIGHT_NAME(2)');
  assertEq(inDesc, 1, '(2) single description hit == WEIGHT_DESC(1)');
  const keywordSameAsTag = skillContentScore({ name: 'zzz', keywords: ['payment'] }, q);
  assertEq(keywordSameAsTag, 3, '(2) keyword hit weighted same as tag (strong)');

  // ─── (3) best-field-per-token: token counted once at its strongest field ────
  const both = skillContentScore({ name: 'payment', tags: ['payment'] }, 'payment');
  assertEq(both, 3, '(3) token in both name+tag counts once at strong weight, not summed');

  // ─── (4) more distinct query tokens matched → higher score ──────────────────
  const one = skillContentScore({ name: 'x', tags: ['alpha'] }, 'alpha beta gamma');
  const two = skillContentScore({ name: 'x', tags: ['alpha', 'beta'] }, 'alpha beta gamma');
  const three = skillContentScore({ name: 'x', tags: ['alpha', 'beta', 'gamma'] }, 'alpha beta gamma');
  assert(two > one, '(4) two matched tokens beat one');
  assert(three > two, '(4) three matched tokens beat two');

  // ─── (5) whole-token match, not substring (no "cat" ⊂ "category") ───────────
  const substringGuard = skillContentScore({ name: 'x', tags: ['category'] }, 'cat');
  assertEq(substringGuard, 0, '(5) "cat" does NOT match tag "category" (whole-token)');
  const exactToken = skillContentScore({ name: 'x', tags: ['cat'] }, 'cat');
  assertEq(exactToken, 3, '(5) exact token "cat" matches tag "cat"');
  const underscoreSplit = skillContentScore({ name: 'code_review_helper' }, 'review');
  assertEq(underscoreSplit, 2, '(5) underscore field name splits into tokens (review matches)');

  // ─── (6) query de-dupe: repeated query word counts once ─────────────────────
  const repeated = skillContentScore({ name: 'x', tags: ['sql'] }, 'sql sql sql sql');
  assertEq(repeated, 3, '(6) repeated query token counts once');

  // ─── (7) stopwords + min-token-length filtered out of the query ─────────────
  const stop = skillContentScore({ name: 'x', description: 'the and for you with that' }, 'the and for you with that');
  assertEq(stop, 0, '(7) pure-stopword query → 0 (all filtered)');
  const shortToks = skillContentScore({ name: 'x', tags: ['ab', 'io'] }, 'ab io');
  assertEq(shortToks, 0, '(7) sub-min-length query tokens (len<3) filtered → 0');
  const mixedStop = skillContentScore({ name: 'x', tags: ['refund'] }, 'please help with the refund');
  assertEq(mixedStop, 3, '(7) only the content token "refund" survives stopword filtering');

  // ─── (8) clamp to [0, CONTENT_SCORE_MAX] ────────────────────────────────────
  const manyTags = Array.from({ length: 40 }, (_v, i) => `tok${i}`);
  const manyQuery = manyTags.join(' ');
  const clamped = skillContentScore({ name: 'x', tags: manyTags }, manyQuery);
  assertEq(clamped, CONTENT_SCORE_MAX, '(8) huge overlap clamps to CONTENT_SCORE_MAX');
  assert(clamped <= CONTENT_SCORE_MAX && clamped >= 0, '(8) score always within [0, MAX]');

  // ─── (9) absent/empty inputs → 0 ────────────────────────────────────────────
  assertEq(skillContentScore({ name: 'x' }, ''), 0, '(9) empty query → 0');
  assertEq(skillContentScore({ name: 'x' }, '   \n\t '), 0, '(9) whitespace-only query → 0');
  assertEq(skillContentScore({ name: '' } as ScorableSkill, 'anything'), 0, '(9) field-less skill → 0');
  assertEq(skillContentScore({ name: 'database' }, undefined), 0, '(9) undefined query → 0');
  assertEq(skillContentScore({ name: 'database' }, null), 0, '(9) null query → 0');
  assertEq(skillContentScore({ name: 'database' }, 12345 as unknown), 0, '(9) numeric query → 0');

  // ─── (10) case-insensitive matching ─────────────────────────────────────────
  const caseHit = skillContentScore({ name: 'x', tags: ['DataBase'] }, 'DATABASE');
  assertEq(caseHit, 3, '(10) matching is case-insensitive');

  // ─── (11) rank: content is the SECONDARY key at the SAME hint tier ──────────
  const domain: ScorableSkill = { name: 'db_migrate', tags: ['database', 'migration'], hintScore: 0 };
  const offtopic: ScorableSkill = { name: 'photoshop', tags: ['image', 'design'], hintScore: 0 };
  const rankedSameTier = rankSkillsByRelevance([offtopic, domain], 'database migration plan');
  assertEq(names(rankedSameTier)[0], 'db_migrate', '(11) domain-matching skill outranks off-topic at same hint tier');
  assertEq(rankedSameTier.length, 2, '(11) both skills retained');

  // ─── (12) hint precedence: hinted beats unhinted higher-content skill ───────
  const hintedIrrelevant: ScorableSkill = { name: 'summarize_thread', hintScore: 5, tags: ['summary'] };
  const unhintedRelevant: ScorableSkill = { name: 'db_migrate', hintScore: 0, tags: ['database', 'migration', 'sql'] };
  const rankedByHint = rankSkillsByRelevance([unhintedRelevant, hintedIrrelevant], 'database migration sql schema');
  assertEq(names(rankedByHint)[0], 'summarize_thread', '(12) hinted skill wins even vs higher-content unhinted');
  assert(
    skillContentScore(unhintedRelevant, 'database migration sql schema') >
      skillContentScore(hintedIrrelevant, 'database migration sql schema'),
    '(12) the unhinted skill really does have higher content (precedence, not content, decided it)',
  );

  // ─── (13) hint tiers ordered strictly by hintScore desc ─────────────────────
  const tierA: ScorableSkill = { name: 'a', hintScore: 5 };
  const tierB: ScorableSkill = { name: 'b', hintScore: 3 };
  const tierC: ScorableSkill = { name: 'c', hintScore: 0, tags: ['everything'] };
  const tierRanked = rankSkillsByRelevance([tierC, tierB, tierA], 'everything');
  assertEq(names(tierRanked).join(','), 'a,b,c', '(13) strict hint-tier ordering 5>3>0 regardless of content');

  // ─── (14) content only re-orders WITHIN a tier, never across tiers ──────────
  const hiHintLowContent: ScorableSkill = { name: 'hi', hintScore: 3 };
  const midHintHiContent: ScorableSkill = { name: 'mid', hintScore: 2, tags: ['refactor', 'code', 'cleanup'] };
  const crossTier = rankSkillsByRelevance([midHintHiContent, hiHintLowContent], 'refactor code cleanup module');
  assertEq(names(crossTier)[0], 'hi', '(14) higher hint tier stays on top despite lower content');

  // ─── (15) stable order: full ties preserve original input order ─────────────
  const t1: ScorableSkill = { name: 'first', hintScore: 0 };
  const t2: ScorableSkill = { name: 'second', hintScore: 0 };
  const t3: ScorableSkill = { name: 'third', hintScore: 0 };
  const stable = rankSkillsByRelevance([t1, t2, t3], 'no overlap at all here');
  assertEq(names(stable).join(','), 'first,second,third', '(15) full ties keep original order (stable)');

  // ─── (16) maxSkills respected ───────────────────────────────────────────────
  const many: ScorableSkill[] = [
    { name: 's1', hintScore: 5 },
    { name: 's2', hintScore: 4 },
    { name: 's3', hintScore: 3 },
    { name: 's4', hintScore: 2 },
  ];
  assertEq(rankSkillsByRelevance(many, 'q', { maxSkills: 2 }).length, 2, '(16) maxSkills=2 → 2 results');
  assertEq(names(rankSkillsByRelevance(many, 'q', { maxSkills: 2 })).join(','), 's1,s2', '(16) keeps the top-2 by hint');
  assertEq(rankSkillsByRelevance(many, 'q', { maxSkills: 99 }).length, 4, '(16) maxSkills > len → all');
  assertEq(rankSkillsByRelevance(many, 'q', {}).length, 4, '(16) no maxSkills → all');
  assertEq(rankSkillsByRelevance(many, 'q').length, 4, '(16) omitted opts → all');
  assertEq(rankSkillsByRelevance(many, 'q', { maxSkills: 0 }).length, 0, '(16) maxSkills=0 → empty');
  assertEq(rankSkillsByRelevance(many, 'q', { maxSkills: -3 }).length, 0, '(16) negative maxSkills → empty');
  assertEq(rankSkillsByRelevance(many, 'q', { maxSkills: 2.9 }).length, 2, '(16) fractional maxSkills floored');
  assertEq(rankSkillsByRelevance(many, 'q', { maxSkills: NaN }).length, 4, '(16) NaN maxSkills → all');
  assertEq(rankSkillsByRelevance(many, 'q', { maxSkills: Infinity }).length, 4, '(16) Infinity maxSkills → all');

  // ─── (17) hintScore hostile values neutralized; finite-huge clamped ─────────
  const infHint: ScorableSkill = { name: 'inf', hintScore: Infinity };
  const nanHint: ScorableSkill = { name: 'nan', hintScore: NaN, tags: ['match'] };
  const normalHint: ScorableSkill = { name: 'norm', hintScore: 5 };
  const hostileHintRank = rankSkillsByRelevance([infHint, nanHint, normalHint], 'match');
  // Non-finite hints (Inf/NaN) are neutralized to tier 0 — a hostile Infinity
  // must NOT be able to force a skill to the top. Only the real 5 hints.
  assertEq(names(hostileHintRank)[0], 'norm', '(17) real hint 5 ranks top; non-finite hints neutralized to 0');
  assertEq(names(hostileHintRank)[1], 'nan', '(17) within neutralized tier, content decides (nan tag "match")');
  assertEq(names(hostileHintRank)[2], 'inf', '(17) inf hint neutralized to 0, no content → last');
  assert(hostileHintRank.every((s) => s && typeof s.name === 'string'), '(17) all entries intact, no throw');
  // A finite-but-huge hint is clamped to the cap but still dominates a real tier.
  const hugeHint: ScorableSkill = { name: 'huge', hintScore: 1e9 };
  const hugeHintRank = rankSkillsByRelevance([normalHint, hugeHint], 'q');
  assertEq(names(hugeHintRank)[0], 'huge', '(17) finite-huge hint clamped to cap still ranks above normal hint');

  // ─── (18) determinism: identical inputs → identical ordering ────────────────
  const detInput: ScorableSkill[] = [
    { name: 'x', hintScore: 0, tags: ['alpha'] },
    { name: 'y', hintScore: 0, tags: ['alpha', 'beta'] },
    { name: 'z', hintScore: 0, description: 'gamma' },
  ];
  const once = names(rankSkillsByRelevance(detInput, 'alpha beta gamma')).join(',');
  const twice = names(rankSkillsByRelevance(detInput, 'alpha beta gamma')).join(',');
  assertEq(once, twice, '(18) rank is deterministic across calls');
  assertEq(once, 'y,x,z', '(18) content ordering y(2)>x(1)>z(1, later index)');

  // ─── (19) rank input guards ─────────────────────────────────────────────────
  assertEq(rankSkillsByRelevance(null as unknown as ScorableSkill[], 'q').length, 0, '(19) null skills → []');
  assertEq(rankSkillsByRelevance(undefined as unknown as ScorableSkill[], 'q').length, 0, '(19) undefined skills → []');
  assertEq(rankSkillsByRelevance([], 'q').length, 0, '(19) empty skills → []');
  assertEq(rankSkillsByRelevance('nope' as unknown as ScorableSkill[], 'q').length, 0, '(19) non-array skills → []');

  // ─── (20) hostile / garbage entries tolerated, never dropped, never thrown ──
  const garbage: any[] = [
    null,
    undefined,
    42,
    'string-entry',
    { name: 'good', tags: ['keeper'], hintScore: 0 },
    { /* no name */ description: 'anonymous', hintScore: 0 },
    { name: 123 /* wrong type */, hintScore: 0 },
    { name: 'nested', tags: [null, 7, {}, ['x']], keywords: null, hintScore: 0 },
  ];
  let threw = false;
  let ranked: any[] = [];
  try {
    ranked = rankSkillsByRelevance(garbage as ScorableSkill[], 'keeper anonymous');
  } catch {
    threw = true;
  }
  assert(!threw, '(20) rank never throws on garbage entries');
  assertEq(ranked.length, garbage.length, '(20) garbage entries preserved (not dropped)');
  // The real matching skill should surface to the front of its (all-zero) tier.
  assertEq(ranked[0] && ranked[0].name, 'good', '(20) matching skill floats to front of tier');

  // ─── (21) hostile skillContentScore inputs never throw ──────────────────────
  const hostileSkills: any[] = [
    null,
    undefined,
    42,
    'not-an-object',
    {},
    { name: null, description: null, tags: null, keywords: null },
    { name: {}, description: [], tags: 'not-array', keywords: 5 },
    { name: 'x', tags: [Symbol('s') as any] },
  ];
  const hostileQueries: any[] = [null, undefined, 42, {}, [], Symbol('q'), true];
  let scoreThrew = false;
  try {
    for (const s of hostileSkills) {
      for (const query of hostileQueries) {
        const v = skillContentScore(s, query);
        assert(Number.isFinite(v) && v >= 0 && v <= CONTENT_SCORE_MAX, '(21) hostile score in-range', `got ${v}`);
      }
    }
  } catch {
    scoreThrew = true;
  }
  assert(!scoreThrew, '(21) skillContentScore never throws on hostile inputs');

  // ─── (22) cyclic input safety ───────────────────────────────────────────────
  const cyclic: any = { name: 'cyclic_node', tags: ['cyclic'], hintScore: 0 };
  cyclic.self = cyclic;
  cyclic.tags.push(cyclic); // cycle inside the array too
  let cyclicThrew = false;
  let cyclicScore = -1;
  try {
    cyclicScore = skillContentScore(cyclic, 'cyclic node');
    const cyclicRank = rankSkillsByRelevance([cyclic, { name: 'other', hintScore: 0 }], 'cyclic node');
    assertEq(cyclicRank.length, 2, '(22) rank tolerates cyclic entry');
  } catch {
    cyclicThrew = true;
  }
  assert(!cyclicThrew, '(22) cyclic input never throws');
  assert(cyclicScore >= 0 && cyclicScore <= CONTENT_SCORE_MAX, '(22) cyclic score in-range', `got ${cyclicScore}`);

  // ─── (23) huge input is bounded, no throw, in-range ─────────────────────────
  const hugeQuery = 'database '.repeat(50000);
  const hugeTags = Array.from({ length: 20000 }, (_v, i) => `t${i}`);
  hugeTags.push('database');
  let hugeThrew = false;
  let hugeScore = -1;
  try {
    hugeScore = skillContentScore({ name: 'x'.repeat(100000), tags: hugeTags }, hugeQuery);
    const hugeList = Array.from({ length: 12000 }, (_v, i) => ({ name: `s${i}`, hintScore: 0 } as ScorableSkill));
    const hugeRanked = rankSkillsByRelevance(hugeList, 'query', { maxSkills: 5 });
    assertEq(hugeRanked.length, 5, '(23) huge skill list still respects maxSkills');
  } catch {
    hugeThrew = true;
  }
  assert(!hugeThrew, '(23) huge input never throws');
  assert(hugeScore >= 0 && hugeScore <= CONTENT_SCORE_MAX, '(23) huge score clamped in-range', `got ${hugeScore}`);

  // ─── (24) original array not mutated by ranking ─────────────────────────────
  const orig: ScorableSkill[] = [
    { name: 'aa', hintScore: 0 },
    { name: 'bb', hintScore: 5 },
  ];
  const before = names(orig).join(',');
  rankSkillsByRelevance(orig, 'q');
  assertEq(names(orig).join(','), before, '(24) input array order left unmutated');

  console.log(`skill-relevance-core smoke: ${passes} passed, ${failures} failed`);
  if (failures > 0) {
    console.error(`\n${failures} fail`);
    process.exit(1);
  }
  console.log(`\nAll skill-relevance-core smoke cases passed (${passes} passed).`);
}

main();
