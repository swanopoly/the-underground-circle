/**
 * prewarm-tool-selection-core-smoketest — the pure prewarm decision core
 * (src/lib/prewarmToolSelectionCore.ts) behind tool-catalog optimization v5:
 * fold high-confidence deferred tools into the pinned set for THIS turn so the
 * model skips the `tools.search` round-trip. Load-bearing assertions:
 *
 *   toolFamily: the name prefix before the first '.'; whole name for a flat
 *   tool; '' for non-strings/empty; leading-dot names returned unchanged.
 *
 *   selectPrewarmToolNames: only tools that are BOTH in a suggested family AND
 *   high-confidence (score >= PREWARM_MIN_SCORE) are prewarmed; non-suggested
 *   families are dropped even at score 1000; `tools.search` is never included
 *   (any casing); already-pinned tools are excluded; results are re-ranked by
 *   score (caller order can't leak), de-duplicated, and capped (default 5,
 *   hard ceiling 12); the top-K window bounds candidates; and every export is
 *   total — null / wrong-type / huge / hostile (throwing-getter) input never
 *   throws and degrades to [].
 *
 * Pure — loads under tsx (prewarmToolSelectionCore has zero imports).
 */

import {
  CatalogMatch,
  PREWARM_DEFAULT_CAP,
  PREWARM_MIN_SCORE,
  PREWARM_TOP_K,
  PREWARM_HARD_CAP,
  toolFamily,
  selectPrewarmToolNames,
} from '../src/lib/prewarmToolSelectionCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
/** Exact-order array equality (output is deterministic, so order is asserted). */
function assertEqArr(a: string[], b: string[], m: string) {
  assert(JSON.stringify(a) === JSON.stringify(b), m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
/** Membership regardless of order. */
function assertHas(arr: string[], name: string, m: string) {
  assert(Array.isArray(arr) && arr.indexOf(name) >= 0, m, 'missing ' + name + ' in ' + JSON.stringify(arr));
}
function assertNotHas(arr: string[], name: string, m: string) {
  assert(Array.isArray(arr) && arr.indexOf(name) < 0, m, 'unexpected ' + name + ' in ' + JSON.stringify(arr));
}
function match(tool: string, score: number): CatalogMatch {
  return { tool, score };
}

function main() {
  // ── 1. toolFamily ──────────────────────────────────────────────────────
  assertEq(toolFamily('tasks.create'), 'tasks', '1.1 dotted → prefix');
  assertEq(toolFamily('desktop.launch_app'), 'desktop', '1.2 underscore tail preserved in family? no, family is prefix');
  assertEq(toolFamily('research.web_search'), 'research', '1.3 dotted prefix');
  assertEq(toolFamily('a.b.c'), 'a', '1.4 only first dot splits');
  assertEq(toolFamily('gmail.read'), 'gmail', '1.5 gmail family');
  assertEq(toolFamily('fetch_url'), 'fetch_url', '1.6 flat tool → whole name');
  assertEq(toolFamily('save_memory'), 'save_memory', '1.7 flat tool → whole name');
  assertEq(toolFamily(''), '', '1.8 empty → empty');
  assertEq(toolFamily('.hidden'), '.hidden', '1.9 leading dot → unchanged (dot at 0)');
  assertEq(toolFamily('trailing.'), 'trailing', '1.10 trailing dot → prefix');
  assertEq(toolFamily(null), '', '1.11 null → empty');
  assertEq(toolFamily(undefined), '', '1.12 undefined → empty');
  assertEq(toolFamily(123), '', '1.13 number → empty');
  assertEq(toolFamily({}), '', '1.14 object → empty');
  assertEq(toolFamily(['tasks.create']), '', '1.15 array → empty');
  assertEq(toolFamily(true), '', '1.16 boolean → empty');

  // ── 2. constants ───────────────────────────────────────────────────────
  assertEq(PREWARM_DEFAULT_CAP, 5, '2.1 default cap = 5');
  assertEq(PREWARM_MIN_SCORE, 60, '2.2 min score = 60 (distinctive-name tier)');
  assertEq(typeof PREWARM_TOP_K, 'number', '2.3 top-K is a number');
  assertEq(typeof PREWARM_HARD_CAP, 'number', '2.4 hard cap is a number');
  assert(PREWARM_HARD_CAP < PREWARM_TOP_K, '2.5 hard cap below top-K (cap binds, not window)');
  assert(PREWARM_DEFAULT_CAP <= PREWARM_HARD_CAP, '2.6 default cap within hard ceiling');
  assert(PREWARM_MIN_SCORE > 30, '2.7 min score above the family-only tier (30)');

  // ── 3. happy path: matches ∩ suggested families → prewarmed ────────────
  {
    const r = selectPrewarmToolNames(
      [match('research.web_search', 400), match('desktop.launch_app', 1000)],
      ['research'],
    );
    assertEqArr(r, ['research.web_search'], '3.1 suggested family prewarmed');
    assertNotHas(r, 'desktop.launch_app', '3.2 non-suggested family excluded even at score 1000');
    assertEq(r.length, 1, '3.3 exactly one prewarmed');
  }

  // ── 4. family gate: only suggested families pass ───────────────────────
  {
    const r = selectPrewarmToolNames(
      [match('research.x', 500), match('desktop.y', 500), match('gmail.z', 500)],
      ['research', 'gmail'],
      { cap: 10 },
    );
    assertHas(r, 'research.x', '4.1 research suggested → included');
    assertHas(r, 'gmail.z', '4.2 gmail suggested → included');
    assertNotHas(r, 'desktop.y', '4.3 desktop not suggested → excluded');
    assertEq(r.length, 2, '4.4 exactly the two suggested-family tools');
    // equal scores → deterministic name-asc order.
    assertEqArr(r, ['gmail.z', 'research.x'], '4.5 equal-score ties resolved by name asc');
  }
  {
    // No suggested families at all → nothing prewarmed.
    const r = selectPrewarmToolNames([match('research.x', 900)], []);
    assertEqArr(r, [], '4.6 empty suggested list → []');
  }
  {
    // Case-insensitive family match.
    const r = selectPrewarmToolNames([match('Research.x', 900)], ['research']);
    assertEqArr(r, ['Research.x'], '4.7 family compared case-insensitively');
  }

  // ── 5. high-confidence score threshold ─────────────────────────────────
  {
    const r = selectPrewarmToolNames(
      [
        match('research.a', 60), // == threshold → included
        match('research.b', 59), // below → excluded
        match('research.c', 60), // == threshold → included
        match('research.d', 1000), // well above → included
        match('research.e', 0), // zero → excluded
        match('research.f', -5), // negative → excluded
      ],
      ['research'],
      { cap: 10 },
    );
    assertHas(r, 'research.a', '5.1 score == MIN_SCORE included (boundary)');
    assertNotHas(r, 'research.b', '5.2 score just below MIN_SCORE excluded');
    assertHas(r, 'research.c', '5.3 second boundary hit included');
    assertHas(r, 'research.d', '5.4 high score included');
    assertNotHas(r, 'research.e', '5.5 zero score excluded');
    assertNotHas(r, 'research.f', '5.6 negative score excluded');
    assertEq(r.length, 3, '5.7 exactly the three at/above threshold');
    assertEqArr(r, ['research.d', 'research.a', 'research.c'], '5.8 score desc then name asc');
  }

  // ── 6. tools.search is never prewarmed ─────────────────────────────────
  {
    const r = selectPrewarmToolNames(
      [match('tools.search', 1000), match('Tools.Search', 999), match('research.ok', 100)],
      ['tools', 'research'],
      { cap: 10 },
    );
    assertNotHas(r, 'tools.search', '6.1 tools.search excluded even at 1000 with family suggested');
    assertNotHas(r, 'Tools.Search', '6.2 tools.search excluded case-insensitively');
    assertHas(r, 'research.ok', '6.3 sibling still prewarmed');
    assertEqArr(r, ['research.ok'], '6.4 only the non-search tool remains');
  }

  // ── 7. already-pinned exclusion ────────────────────────────────────────
  {
    const r = selectPrewarmToolNames(
      [match('research.pinned', 900), match('research.fresh', 100)],
      ['research'],
      { alreadyPinned: ['research.pinned'] },
    );
    assertNotHas(r, 'research.pinned', '7.1 already-pinned tool excluded (no duplicate advertise)');
    assertHas(r, 'research.fresh', '7.2 fresh tool prewarmed');
    assertEqArr(r, ['research.fresh'], '7.3 exactly the fresh tool');
  }
  {
    // Whitespace-tolerant pinned matching.
    const r = selectPrewarmToolNames(
      [match('research.pinned', 900)],
      ['research'],
      { alreadyPinned: [' research.pinned '] },
    );
    assertEqArr(r, [], '7.4 pinned set trims → still excluded');
  }
  {
    // Non-array alreadyPinned is ignored (treated as none).
    const r = selectPrewarmToolNames([match('research.x', 100)], ['research'], {
      alreadyPinned: 'research.x' as unknown,
    });
    assertEqArr(r, ['research.x'], '7.5 non-array alreadyPinned ignored');
  }

  // ── 8. cap behavior ────────────────────────────────────────────────────
  {
    // 20 eligible tools, all in the suggested family, all high-confidence.
    const many: CatalogMatch[] = [];
    for (let i = 0; i < 20; i++) {
      const id = 'research.h' + (i < 10 ? '0' + i : '' + i); // zero-padded → lexicographic == numeric
      many.push(match(id, 200));
    }
    const def = selectPrewarmToolNames(many, ['research']);
    assertEq(def.length, PREWARM_DEFAULT_CAP, '8.1 default cap limits to 5');
    assertEqArr(
      def,
      ['research.h00', 'research.h01', 'research.h02', 'research.h03', 'research.h04'],
      '8.2 default cap keeps the first 5 by deterministic order',
    );

    const two = selectPrewarmToolNames(many, ['research'], { cap: 2 });
    assertEq(two.length, 2, '8.3 explicit cap=2 honored');
    assertEqArr(two, ['research.h00', 'research.h01'], '8.4 cap=2 keeps first 2');

    const zero = selectPrewarmToolNames(many, ['research'], { cap: 0 });
    assertEqArr(zero, [], '8.5 cap=0 → []');

    const neg = selectPrewarmToolNames(many, ['research'], { cap: -4 });
    assertEqArr(neg, [], '8.6 negative cap → []');

    const huge = selectPrewarmToolNames(many, ['research'], { cap: 1e9 });
    assertEq(huge.length, PREWARM_HARD_CAP, '8.7 huge cap clamped to hard ceiling (12)');
    assert(huge.length <= PREWARM_HARD_CAP, '8.8 output never exceeds hard ceiling');
    assertHas(huge, 'research.h00', '8.9 clamped set starts at first by order');
    assertHas(huge, 'research.h11', '8.10 clamped set includes 12th (h11)');
    assertNotHas(huge, 'research.h12', '8.11 clamped set stops before the 13th');

    const frac = selectPrewarmToolNames(many, ['research'], { cap: 3.9 });
    assertEq(frac.length, 3, '8.12 fractional cap floored to 3');

    const nan = selectPrewarmToolNames(many, ['research'], { cap: NaN });
    assertEq(nan.length, PREWARM_DEFAULT_CAP, '8.13 NaN cap → default');

    const inf = selectPrewarmToolNames(many, ['research'], { cap: Infinity });
    assertEq(inf.length, PREWARM_DEFAULT_CAP, '8.14 Infinity cap → default (not finite)');
  }

  // ── 9. re-ranking (caller order can't leak) + dedupe ───────────────────
  {
    const scrambled = [match('research.low', 70), match('research.high', 900), match('research.mid', 300)];
    const r = selectPrewarmToolNames(scrambled, ['research'], { cap: 5 });
    assertEqArr(r, ['research.high', 'research.mid', 'research.low'], '9.1 output sorted by score desc regardless of input order');
  }
  {
    // Duplicate tool name — highest-scored occurrence wins, one copy only.
    const dupes = [match('research.dup', 100), match('research.other', 300), match('research.dup', 500)];
    const r = selectPrewarmToolNames(dupes, ['research'], { cap: 5 });
    assertEqArr(r, ['research.dup', 'research.other'], '9.2 dedupe keeps single copy in ranked order');
    assertEq(r.filter((x) => x === 'research.dup').length, 1, '9.3 no duplicate names in output');
  }

  // ── 10. top-K window bounds candidates ─────────────────────────────────
  {
    // 24 high-score matches in a NON-suggested family fill ranks 1..24; three
    // eligible research tools sit at ranks 25,26,27. With PREWARM_TOP_K=25 only
    // the first eligible one (rank 25) is inside the candidate window.
    const filler: CatalogMatch[] = [];
    for (let n = 1; n <= 24; n++) {
      const id = 'desktop.d' + (n < 10 ? '0' + n : '' + n);
      filler.push(match(id, 1000 - n)); // 999..976, all above the research scores
    }
    const eligible = [match('research.r0', 100), match('research.r1', 99), match('research.r2', 98)];
    const r = selectPrewarmToolNames(filler.concat(eligible), ['research'], { cap: 5 });
    assertEqArr(r, ['research.r0'], '10.1 only the in-window eligible match is prewarmed');
    assertNotHas(r, 'research.r1', '10.2 eligible match beyond top-K excluded');
    assertNotHas(r, 'research.r2', '10.3 eligible match beyond top-K excluded');
  }

  // ── 11. hostile / degenerate — must never throw, always an array ───────
  const hostile: Array<[unknown, unknown, { cap?: number; alreadyPinned?: unknown } | undefined, string]> = [
    [null, null, undefined, '11.1 null,null'],
    [undefined, undefined, undefined, '11.2 undefined,undefined'],
    [123, ['research'], undefined, '11.3 numeric matches'],
    ['a string', ['research'], undefined, '11.4 string matches'],
    [{}, ['research'], undefined, '11.5 object matches'],
    [[], ['research'], undefined, '11.6 empty matches'],
    [[match('research.x', 100)], null, undefined, '11.7 null suggested'],
    [[match('research.x', 100)], 'research', undefined, '11.8 non-array suggested (string)'],
    [[match('research.x', 100)], 123, undefined, '11.9 numeric suggested'],
    [[1, 'x', null, undefined, true, {}, { tool: 5 }, { score: 9 }], ['research'], undefined, '11.10 junk match entries'],
    [[match('research.x', 100)], ['research'], 42 as unknown as { cap?: number }, '11.11 numeric opts'],
    [[match('research.x', 100)], ['research'], null as unknown as undefined, '11.12 null opts'],
  ];
  for (const [m, s, o, label] of hostile) {
    let threw = false;
    let res: string[] = ['sentinel'];
    try {
      res = selectPrewarmToolNames(m, s, o);
    } catch {
      threw = true;
    }
    assert(!threw, label + ' did not throw');
    assert(Array.isArray(res), label + ' returned an array');
    assert(res.length <= PREWARM_HARD_CAP, label + ' bounded output');
  }

  // Degenerate results resolve to sensible values.
  assertEqArr(selectPrewarmToolNames(123, ['research']), [], '11.13 non-array matches → []');
  assertEqArr(selectPrewarmToolNames([match('research.x', 100)], 'research'), [], '11.14 non-array suggested → []');
  assertEqArr(selectPrewarmToolNames([{ tool: 5 as unknown as string, score: 9 }], ['research']), [], '11.15 non-string tool → skipped');
  // Valid opts=42 (numeric) → cap falls back to default, prewarm still works.
  assertEqArr(selectPrewarmToolNames([match('research.x', 100)], ['research'], 42 as unknown as { cap?: number }), ['research.x'], '11.16 numeric opts → default cap, still prewarms');

  // Objects with throwing getters must be skipped, not fatal.
  {
    const evilTool = {
      get tool() {
        throw new Error('boom tool');
      },
      score: 100,
    };
    const evilScore = {
      tool: 'research.evil',
      get score() {
        throw new Error('boom score');
      },
    };
    const good = match('research.ok', 100);
    let threw = false;
    let res: string[] = [];
    try {
      res = selectPrewarmToolNames([evilTool, evilScore, good], ['research']);
    } catch {
      threw = true;
    }
    assert(!threw, '11.17 throwing-getter matches did not throw');
    assertEqArr(res, ['research.ok'], '11.18 hostile elements skipped, good survives');
  }

  // Huge inputs stay bounded and fast (dedupe collapses to one).
  {
    const huge: CatalogMatch[] = [];
    for (let i = 0; i < 5000; i++) huge.push(match('research.h', 100));
    let threw = false;
    let res: string[] = [];
    try {
      res = selectPrewarmToolNames(huge, ['research'], { cap: 5 });
    } catch {
      threw = true;
    }
    assert(!threw, '11.19 5000-entry matches did not throw');
    assertEqArr(res, ['research.h'], '11.20 huge dup input dedupes to one');
  }
  {
    const hugeFamilies: string[] = [];
    for (let i = 0; i < 5000; i++) hugeFamilies.push('fam' + i);
    hugeFamilies.push('research');
    let threw = false;
    let res: string[] = [];
    try {
      res = selectPrewarmToolNames([match('research.x', 100)], hugeFamilies, { cap: 5 });
    } catch {
      threw = true;
    }
    assert(!threw, '11.21 5000-entry suggested list did not throw');
    assert(Array.isArray(res), '11.22 huge suggested list still returns an array');
  }
  // 'tools' family suggested but only tools.search present → nothing.
  assertEqArr(selectPrewarmToolNames([match('tools.search', 1000)], ['tools']), [], '11.23 lone tools.search → []');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll prewarm-tool-selection-core smoke cases passed (' + passes + ' passed).');
}

main();
