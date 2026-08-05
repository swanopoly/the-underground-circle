/**
 * memory-dedupe-core-smoketest — the PURE identity/similarity layer behind the
 * `/remember` write path (src/lib/memoryDedupeCore.ts). Both consumers of this
 * core perform an in-place UPDATE of an existing `memory_entries` row with NO
 * history row, so a wrong match is silent, irreversible destruction of
 * user-authored memory. These assertions are the guard on that:
 *
 *   memorySimilarityScore(a,b): symmetric 0..1. exact→1; SUBSTANTIAL containment
 *     (shorter >= CONTAINMENT_MIN_CHARS and >= CONTAINMENT_MIN_LENGTH_RATIO of
 *     the longer) → 0.5 + 0.5*ratio; otherwise Jaccard |A∩B|/|A∪B|. A truncated
 *     (prefix-only) comparison is capped at TRUNCATED_SCORE_CEILING.
 *   inferExplicitMemoryKey(content, kind): stable for identical content, DISTINCT
 *     for distinct content — including two memories that merely share the
 *     "consider tradeoffs" phrase, and two that share an 80-char prefix.
 *   buildRememberTitle / inferRememberKind / normalizeRememberContent /
 *     slugifyMemoryKey: preserved behavior, minus the constant-title collision.
 *   pickDuplicateMemory(candidates, query): scope/ownership filters + the
 *     corroborated predicate; best-scoring wins; null on any degenerate input.
 *
 * REGRESSION ANCHORS (the two verified data-loss bugs):
 *   (a) `/remember postgres` must NOT overwrite a long memory mentioning postgres.
 *   (b) two unrelated memories both containing "consider tradeoffs" must NOT
 *       share an explicit key, a title, or a duplicate verdict.
 *
 * Pure — loads under tsx (the core has type-only imports).
 *   npx tsx scripts/memory-dedupe-core-smoketest.ts
 */

import {
  memorySimilarityScore,
  slugifyMemoryKey,
  inferExplicitMemoryKey,
  buildRememberTitle,
  normalizeRememberContent,
  inferRememberKind,
  isCanonicalResponseStandard,
  contentDiscriminator,
  pickDuplicateMemory,
  MAX_COMPARE_CHARS,
  MAX_KEY_SLUG_CHARS,
  CONTAINMENT_MIN_LENGTH_RATIO,
  CONTAINMENT_MIN_CHARS,
  DUPLICATE_TITLE_THRESHOLD,
  DUPLICATE_CONTENT_THRESHOLD,
  TITLE_MATCH_CONTENT_FLOOR,
  TRUNCATED_SCORE_CEILING,
  RESPONSE_STANDARD_DEFAULT_CONTENT,
  RESPONSE_STANDARD_MEMORY_KEY,
  RESPONSE_STANDARD_MEMORY_TITLE,
  type DuplicateMemoryCandidate,
} from '../src/lib/memoryDedupeCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── call wrappers (keep hostile fixtures cast-free at the call sites) ─────────
function sim(a?: unknown, b?: unknown): number {
  return memorySimilarityScore(a, b);
}
function pick(candidates?: unknown, query?: unknown) {
  return pickDuplicateMemory<DuplicateMemoryCandidate>(candidates, query);
}
function row(over: Partial<DuplicateMemoryCandidate>): DuplicateMemoryCandidate {
  return {
    id: 'm1',
    scope: 'user',
    user_id: 'u1',
    title: 'title',
    content: 'content',
    ...over,
  };
}
function userQuery(title: string, content: string) {
  return { title, content, scope: 'user', isPrivate: true, userId: 'u1' };
}

function main(): void {
  // ── 1. normalizeRememberContent ───────────────────────────────────────────
  assertEq(normalizeRememberContent('  "we use postgres"  '), 'we use postgres', 'normalize strips wrapping quotes + trims');
  assertEq(normalizeRememberContent('a\n\n  b\tc'), 'a b c', 'normalize collapses whitespace runs');
  assertEq(normalizeRememberContent(null), '', 'normalize(null) → ""');
  assertEq(normalizeRememberContent(undefined), '', 'normalize(undefined) → ""');
  assertEq(normalizeRememberContent(42), '42', 'normalize(number) → digits');
  assertEq(normalizeRememberContent({}), '', 'normalize(object) → ""');
  assertEq(normalizeRememberContent([1, 2]), '', 'normalize(array) → ""');

  // ── 2. inferRememberKind (behavior preserved) ─────────────────────────────
  assertEq(inferRememberKind('Always reason thoroughly'), 'instruction', 'kind: instruction');
  assertEq(inferRememberKind('I prefer dark mode'), 'preference', 'kind: preference');
  assertEq(inferRememberKind('We decided to ship on Friday'), 'decision', 'kind: decision');
  assertEq(inferRememberKind('The office wifi password rotates monthly'), 'fact', 'kind: fact default');
  assertEq(inferRememberKind(null), 'fact', 'kind(null) → fact');

  // ── 3. slugifyMemoryKey ───────────────────────────────────────────────────
  assertEq(slugifyMemoryKey('We use Postgres 16!'), 'we_use_postgres_16', 'slug: snake + trimmed underscores');
  assertEq(slugifyMemoryKey('!!!'), 'memory', 'slug: all-punctuation → "memory"');
  assertEq(slugifyMemoryKey(''), 'memory', 'slug: empty → "memory"');
  assertEq(slugifyMemoryKey(null), 'memory', 'slug(null) → "memory"');
  assert(slugifyMemoryKey('x'.repeat(500)).length <= MAX_KEY_SLUG_CHARS, 'slug: length-capped');

  // ── 4. memorySimilarityScore — core ladder ────────────────────────────────
  assertEq(sim('same text here', 'SAME TEXT HERE'), 1, 'sim: case-insensitive exact → 1');
  assertEq(sim('  padded  ', 'padded'), 1, 'sim: trim-insensitive exact → 1');
  assertEq(sim('', 'anything'), 0, 'sim: empty side → 0');
  assertEq(sim(null, 'anything'), 0, 'sim(null) → 0');
  assertEq(sim('!!!', '???'), 0, 'sim: no tokens either side → 0');

  // symmetry + determinism
  const pairs: Array<[string, string]> = [
    ['postgres', 'we run postgres 16 with pgbouncer in production for pooling'],
    ['I prefer dark mode in the editor', 'I prefer dark mode'],
    ['alpha beta gamma', 'beta gamma delta'],
    [RESPONSE_STANDARD_DEFAULT_CONTENT, 'When reviewing PRs, consider tradeoffs between speed and safety.'],
  ];
  for (const [a, b] of pairs) {
    assertEq(sim(a, b), sim(b, a), `sim symmetric :: ${a.slice(0, 24)}`);
    assertEq(sim(a, b), sim(a, b), `sim deterministic :: ${a.slice(0, 24)}`);
  }
  for (const [a, b] of pairs) {
    const s = sim(a, b);
    assert(s >= 0 && s <= 1, 'sim: in [0,1]', String(s));
  }

  // Jaccard, not overlap/min — a one-token side cannot score 1.0
  const longPg = 'we run postgres 16 with pgbouncer in production for connection pooling';
  const oneWord = sim('postgres', longPg);
  assert(oneWord < 0.2, 'sim: one-word vs long text scores low (Jaccard)', String(oneWord));
  assert(oneWord < DUPLICATE_CONTENT_THRESHOLD, 'sim: one-word below content threshold', String(oneWord));

  // pre-fix values that MUST no longer appear
  assert(sim('postgres', longPg) !== 0.92, 'sim: containment no longer hardcodes 0.92');
  assert(sim('postgres', longPg) !== 1, 'sim: overlap/min(size) 1.0 hazard gone');

  // containment ladder around the documented floor
  const base = 'we deploy the web app to netlify every friday afternoon'; // 55 chars
  assert(base.length >= CONTAINMENT_MIN_CHARS, 'fixture: base clears char floor');
  const superSmall = `${base} unless a release is frozen`; // ratio ~0.67
  const ratioSmall = base.length / superSmall.length;
  assert(ratioSmall >= CONTAINMENT_MIN_LENGTH_RATIO, 'fixture: small superset clears ratio floor', String(ratioSmall));
  const containedScore = sim(base, superSmall);
  assert(Math.abs(containedScore - (0.5 + 0.5 * ratioSmall)) < 1e-9, 'sim: containment score = 0.5 + 0.5*ratio', String(containedScore));

  const superBig = `${base} ${'and additional unrelated clauses about billing exports and vault rotation policies for the whole circle '.repeat(2)}`;
  const ratioBig = base.length / superBig.trim().length;
  assert(ratioBig < CONTAINMENT_MIN_LENGTH_RATIO, 'fixture: big superset below ratio floor', String(ratioBig));
  const dilutedScore = sim(base, superBig);
  assert(dilutedScore < DUPLICATE_CONTENT_THRESHOLD, 'sim: diluted containment is NOT a duplicate', String(dilutedScore));

  // short-but-fully-contained strings stay below the floor (topic words)
  const shortContained = sim('dark mode', 'dark mode is nice'); // 9 chars < CONTAINMENT_MIN_CHARS
  assert(shortContained < DUPLICATE_CONTENT_THRESHOLD, 'sim: sub-24-char containment not near-identity', String(shortContained));

  // ── 5. TRUNCATED comparison can never authorize an overwrite ──────────────
  const hugeA = `${'z'.repeat(MAX_COMPARE_CHARS + 10)}A`;
  const hugeB = `${'z'.repeat(MAX_COMPARE_CHARS + 10)}B`;
  const hugeScore = sim(hugeA, hugeB);
  assert(hugeScore <= TRUNCATED_SCORE_CEILING, 'sim: prefix-only comparison capped', String(hugeScore));
  assert(hugeScore < DUPLICATE_CONTENT_THRESHOLD, 'sim: truncated pair is never a content duplicate', String(hugeScore));
  assertEq(sim(hugeA, hugeA), 1, 'sim: identical huge strings still exact-match');

  // ── 6. contentDiscriminator ───────────────────────────────────────────────
  assertEq(contentDiscriminator('abc'), contentDiscriminator('abc'), 'digest deterministic');
  assert(contentDiscriminator('abc') !== contentDiscriminator('abd'), 'digest differs on content');
  assert(contentDiscriminator(`${'p'.repeat(200)}a`) !== contentDiscriminator(`${'p'.repeat(200)}b`), 'digest differs past the 80-char prefix');
  assert(/^[a-z0-9]{1,7}$/.test(contentDiscriminator('abc')), 'digest is a short base36 token', contentDiscriminator('abc'));
  assertEq(contentDiscriminator(null), contentDiscriminator(''), 'digest(null) === digest("")');

  // ── 7. REGRESSION (a): "consider tradeoffs" no longer collapses keys ───────
  const tradeoffA = 'When reviewing PRs, consider tradeoffs between shipping speed and long-term maintenance cost.';
  const tradeoffB = 'For database migrations, consider tradeoffs and always take a verified backup before running them.';
  const keyA = inferExplicitMemoryKey(tradeoffA, inferRememberKind(tradeoffA));
  const keyB = inferExplicitMemoryKey(tradeoffB, inferRememberKind(tradeoffB));
  assert(keyA !== keyB, '[regression a] two "consider tradeoffs" memories get DISTINCT keys', `${keyA} vs ${keyB}`);
  assert(keyA !== RESPONSE_STANDARD_MEMORY_KEY, '[regression a] non-canonical content does not seize the canonical key', keyA);
  assert(keyB !== RESPONSE_STANDARD_MEMORY_KEY, '[regression a] second one does not seize it either', keyB);

  const titleA = buildRememberTitle(tradeoffA, inferRememberKind(tradeoffA));
  const titleB = buildRememberTitle(tradeoffB, inferRememberKind(tradeoffB));
  assert(titleA !== titleB, '[regression a] titles are distinct too', `${titleA} vs ${titleB}`);
  assert(titleA !== RESPONSE_STANDARD_MEMORY_TITLE, '[regression a] no constant response-standard title', titleA);

  // and end-to-end: saving B must not select A as a duplicate
  const existingA = row({ id: 'a', title: titleA, content: tradeoffA });
  const dupTradeoff = pick([existingA], userQuery(titleB, tradeoffB));
  assertEq(dupTradeoff, null, '[regression a] unrelated "consider tradeoffs" memory is NOT a duplicate');

  // the canonical response standard still resolves to its one stable row
  assert(isCanonicalResponseStandard(RESPONSE_STANDARD_DEFAULT_CONTENT), '[canonical] default content recognized');
  assertEq(
    inferExplicitMemoryKey(RESPONSE_STANDARD_DEFAULT_CONTENT, 'instruction'),
    RESPONSE_STANDARD_MEMORY_KEY,
    '[canonical] default content keeps the canonical key',
  );
  assertEq(
    buildRememberTitle(RESPONSE_STANDARD_DEFAULT_CONTENT, 'instruction'),
    RESPONSE_STANDARD_MEMORY_TITLE,
    '[canonical] default content keeps the canonical title',
  );
  assert(!isCanonicalResponseStandard(tradeoffA), '[canonical] unrelated tradeoffs text is not canonical');
  assert(!isCanonicalResponseStandard('nothing relevant here'), '[canonical] unrelated text is not canonical');

  // ── 8. REGRESSION: 80-char-prefix key collision ───────────────────────────
  const prefix = 'The production deploy checklist for the underground circle web app requires that ';
  assert(prefix.length >= 80, 'fixture: shared prefix is >= 80 chars', String(prefix.length));
  const longA = `${prefix}the migration is applied first.`;
  const longB = `${prefix}the edge functions are redeployed last.`;
  const kA = inferExplicitMemoryKey(longA, 'fact');
  const kB = inferExplicitMemoryKey(longB, 'fact');
  assert(kA !== kB, '[regression] 80-char-prefix twins get DISTINCT keys', `${kA} vs ${kB}`);

  // key stability: same content → same key (idempotent /remember still updates)
  assertEq(inferExplicitMemoryKey(longA, 'fact'), kA, '[key] deterministic for identical content');
  assertEq(inferExplicitMemoryKey(`  "${longA}"  `, 'fact'), kA, '[key] normalization-insensitive');
  assert(inferExplicitMemoryKey(longA, 'preference') !== kA, '[key] kind participates in the key');

  // ── 9. REGRESSION (b): one-word /remember must not overwrite a row ────────
  const storedPg = row({
    id: 'pg',
    title: 'We run postgres 16 with pgbouncer in production for connection',
    content: 'We run postgres 16 with pgbouncer in production for connection pooling; max_connections is 200.',
  });
  const oneWordDup = pick([storedPg], userQuery('postgres', 'postgres'));
  assertEq(oneWordDup, null, '[regression b] one-word /remember does NOT overwrite an existing memory');

  const twoWordDup = pick([storedPg], userQuery('postgres pooling', 'postgres pooling'));
  assertEq(twoWordDup, null, '[regression b] short topic phrase does NOT overwrite either');

  // ── 10. pickDuplicateMemory — genuine duplicates still dedupe ─────────────
  const exact = pick([storedPg], userQuery(String(storedPg.title), String(storedPg.content)));
  assert(exact !== null, '[dupe] identical content IS a duplicate');
  assertEq(exact?.memory.id, 'pg', '[dupe] identical content selects the right row');
  assertEq(exact?.contentScore, 1, '[dupe] identical content scores 1');
  assertEq(exact?.matchedOn, 'content', '[dupe] identical content matched on content');

  // title-only collision (mechanical truncation twins) must NOT overwrite
  const truncTitle = `Instruction: ${'Always double check the deployment order'}`;
  const twinA = row({ id: 'ta', title: truncTitle, content: 'Always double check the deployment order before touching the database.' });
  const twinB = pick([twinA], userQuery(truncTitle, 'Always double check the deployment order when rotating the vault credentials for browser logins.'));
  assertEq(twinB, null, '[dupe] identical TITLE with unrelated body is NOT a duplicate');
  assertEq(sim(twinA.title, truncTitle), 1, '[dupe] (that title really did score 1.0)');

  // title match WITH corroborating body still dedupes
  const corroborated = pick(
    [row({ id: 'tc', title: truncTitle, content: 'Always double check the deployment order before touching the database.' })],
    userQuery(truncTitle, 'Always double check the deployment order before touching the database and the cache.'),
  );
  assert(corroborated !== null, '[dupe] title match + similar body IS a duplicate');
  assertEq(corroborated?.matchedOn, 'title', '[dupe] corroborated match really took the TITLE branch');
  assert(
    (corroborated?.contentScore ?? 0) >= TITLE_MATCH_CONTENT_FLOOR &&
      (corroborated?.contentScore ?? 1) < DUPLICATE_CONTENT_THRESHOLD,
    '[dupe] corroborating body sits between the floor and the content threshold',
    String(corroborated?.contentScore),
  );
  assert(
    (corroborated?.titleScore ?? 0) >= DUPLICATE_TITLE_THRESHOLD,
    '[dupe] corroborated match cleared the title threshold',
    String(corroborated?.titleScore),
  );

  // the rejected twin above must fail on the BODY floor, not on a weak title
  const twinBodyScore = sim(twinA.content, 'Always double check the deployment order when rotating the vault credentials for browser logins.');
  assert(twinBodyScore < TITLE_MATCH_CONTENT_FLOOR, '[dupe] rejected twin failed on the body floor', String(twinBodyScore));

  // ── 11. pickDuplicateMemory — scope / ownership filters ──────────────────
  const mine = row({ id: 'mine', title: 'x', content: 'shared body text that is quite long and specific' });
  const q = userQuery('x', 'shared body text that is quite long and specific');
  assert(pick([mine], q) !== null, '[filter] own private row matches');
  assertEq(pick([row({ ...mine, user_id: 'u2' })], q), null, '[filter] other user private row rejected');
  assertEq(pick([row({ ...mine, scope: 'circle' })], q), null, '[filter] scope mismatch rejected');
  assertEq(pick([row({ ...mine, id: '' })], q), null, '[filter] row without an id rejected');
  assertEq(pick([row({ ...mine, id: null })], q), null, '[filter] row with null id rejected');

  const circleQuery = { title: 'x', content: 'shared body text that is quite long and specific', scope: 'circle', isPrivate: false };
  assert(pick([row({ ...mine, scope: 'circle', user_id: null })], circleQuery) !== null, '[filter] circle row matches circle query');
  assertEq(pick([row({ ...mine, scope: 'user' })], circleQuery), null, '[filter] user row rejected for circle query');

  // ── 12. pickDuplicateMemory — best match wins, deterministically ─────────
  const body = 'The weekly BlackSwan training job runs on Sunday at 03:00 on the dev Mac.';
  const near = `${body} It is managed by launchd.`;
  const candidates = [
    row({ id: 'near', title: 'near', content: near }),
    row({ id: 'exact', title: 'exact', content: body }),
    row({ id: 'other', title: 'other', content: 'Unrelated note about the Netlify build cache.' }),
  ];
  const best = pick(candidates, userQuery('anything', body));
  assertEq(best?.memory.id, 'exact', '[best] highest-scoring candidate wins, not the first');
  assertEq(pick(candidates, userQuery('anything', body))?.memory.id, 'exact', '[best] deterministic across calls');
  const reversedBest = pick([...candidates].reverse(), userQuery('anything', body));
  assertEq(reversedBest?.memory.id, 'exact', '[best] order-independent winner');

  // ── 13. degenerate / hostile input ───────────────────────────────────────
  try {
    assertEq(pick(undefined, userQuery('t', 'c')), null, '[degenerate] undefined candidates → null');
    assertEq(pick(null, userQuery('t', 'c')), null, '[degenerate] null candidates → null');
    assertEq(pick([], userQuery('t', 'c')), null, '[degenerate] empty candidates → null');
    assertEq(pick('nope', userQuery('t', 'c')), null, '[degenerate] non-array candidates → null');
    assertEq(pick([mine], undefined), null, '[degenerate] undefined query → null');
    assertEq(pick([mine], {}), null, '[degenerate] empty query → null');
    assertEq(pick([mine], userQuery('x', '')), null, '[degenerate] empty incoming content → null');
    assertEq(pick([mine], userQuery('x', '    ')), null, '[degenerate] whitespace-only content → null');
    assertEq(pick([mine], { title: 'x', content: String(mine.content), scope: '', isPrivate: true, userId: 'u1' }), null, '[degenerate] empty scope → null');
    assertEq(pick([mine], { title: 'x', content: String(mine.content), scope: 'user', isPrivate: true }), null, '[degenerate] private query without userId → null');
    assertEq(pick([null, undefined, 5, 'str', mine], q)?.memory.id, 'mine', '[degenerate] junk entries skipped');

    const throwing = { get title() { throw new Error('boom'); }, id: 'th', scope: 'user', user_id: 'u1', content: String(mine.content) };
    assert(pick([throwing], q)?.memory.id === 'th', '[hostile] throwing getter tolerated');

    const cyclic: Record<string, unknown> = { id: 'cy', scope: 'user', user_id: 'u1', title: 't', content: String(mine.content) };
    cyclic.self = cyclic;
    assertEq(pick([cyclic], q)?.memory.id, 'cy', '[hostile] cyclic candidate tolerated');

    assertEq(sim(NaN, NaN), 1, '[hostile] NaN/NaN coerces to identical text');
    assertEq(sim({}, {}), 0, '[hostile] object/object → 0');
    assertEq(sim([], []), 0, '[hostile] array/array → 0');
    assert(Number.isFinite(sim('a'.repeat(300000), 'a'.repeat(300001))), '[hostile] 300k-char inputs → finite score');
    assert(typeof inferExplicitMemoryKey('x'.repeat(300000), 'fact') === 'string', '[hostile] huge key input → string');
    assert(inferExplicitMemoryKey('x'.repeat(300000), 'fact').length < 200, '[hostile] key stays bounded');
    assert(typeof buildRememberTitle(null, 'fact') === 'string', '[hostile] buildRememberTitle(null) → string');
    assertEq(buildRememberTitle(null, 'fact'), '', '[hostile] buildRememberTitle(null) → ""');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: [HOSTILE] sweep threw: ${(e as Error)?.message}`);
  }

  // ── 14. threshold sanity (documented invariants) ─────────────────────────
  assert(TRUNCATED_SCORE_CEILING < DUPLICATE_CONTENT_THRESHOLD, '[bounds] truncated ceiling below content threshold');
  assert(DUPLICATE_CONTENT_THRESHOLD <= DUPLICATE_TITLE_THRESHOLD, '[bounds] content threshold <= title threshold');
  assert(TITLE_MATCH_CONTENT_FLOOR < DUPLICATE_CONTENT_THRESHOLD, '[bounds] corroboration floor below content threshold');
  assert(CONTAINMENT_MIN_LENGTH_RATIO > 0.5 && CONTAINMENT_MIN_LENGTH_RATIO < 1, '[bounds] containment ratio floor sane');
  // 0.5 + 0.5*ratio at the floor must NOT already be a duplicate
  assert(0.5 + 0.5 * CONTAINMENT_MIN_LENGTH_RATIO < DUPLICATE_CONTENT_THRESHOLD, '[bounds] minimum containment is not a duplicate');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll memory-dedupe-core smoke cases passed (${passes} passed).`);
}

main();
