/**
 * tool-auto-pin-core-smoketest — the pure auto-pin learner
 * (src/lib/toolAutoPinCore.ts) behind tool-catalog expansion v7: promote a
 * circle's heaviest-used DEFERRED tools into the pinned core that
 * openswanBridge.getProgressiveOpenSwanTools advertises every turn. Load-bearing
 * assertions:
 *
 *   COMPUTE: high-count deferred tools become auto-pins, sorted by count desc,
 *   capped (default 6); tools below minCount (default 3) are excluded;
 *   already-pinned tools (excludePinned) and `tools.search` are never returned;
 *   ties break deterministically by ascending name; array `ToolUsageRow[]`,
 *   `{ tool: count }` records, and `Map` inputs all work; duplicate rows sum;
 *   an explicit cap of 0 pins nothing; empty/absent usage → [].
 *
 *   MERGE: base + auto union is deduped, base-first, and bounded by cap.
 *
 *   And: every export is total — degenerate/hostile input never throws, output
 *   stays bounded.
 *
 * Pure — loads under tsx (toolAutoPinCore has zero imports).
 */

import {
  AUTO_PIN_DEFAULT_CAP,
  AUTO_PIN_MIN_COUNT,
  computeAutoPinSet,
  mergeAutoPins,
  type ToolUsageRow,
} from '../src/lib/toolAutoPinCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertArrEq(a: unknown, b: unknown[], msg: string): void {
  assert(Array.isArray(a) && JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) constants + basic shape ──────────────────────────────────────────
  assertEq(AUTO_PIN_DEFAULT_CAP, 6, '(1) default cap is 6');
  assertEq(AUTO_PIN_MIN_COUNT, 3, '(1) min count is 3');
  assert(Array.isArray(computeAutoPinSet([])), '(1) computeAutoPinSet returns an array');
  assert(Array.isArray(mergeAutoPins([], [])), '(1) mergeAutoPins returns an array');
  assertArrEq(computeAutoPinSet([]), [], '(1) empty usage → []');

  // ─── (2) high-count deferred tools become auto-pins, sorted by count desc ──
  const usage: ToolUsageRow[] = [
    { tool: 'desktop.screenshot', count: 42 },
    { tool: 'gmail.read', count: 30 },
    { tool: 'github.read_file', count: 12 },
    { tool: 'vault.find', count: 5 },
    { tool: 'wp.list_posts', count: 4 },
  ];
  const auto = computeAutoPinSet(usage);
  assertArrEq(
    auto,
    ['desktop.screenshot', 'gmail.read', 'github.read_file', 'vault.find', 'wp.list_posts'],
    '(2) all above minCount, sorted by count desc',
  );
  // top-of-list is the highest count
  assertEq(auto[0], 'desktop.screenshot', '(2) highest count first');
  assertEq(auto[auto.length - 1], 'wp.list_posts', '(2) lowest surviving count last');

  // ─── (3) minCount gate — below the threshold is dropped ───────────────────
  const belowMin = computeAutoPinSet([
    { tool: 'desktop.screenshot', count: 3 }, // exactly min → kept
    { tool: 'gmail.read', count: 2 }, // below min → dropped
    { tool: 'vault.find', count: 1 }, // below min → dropped
    { tool: 'wp.list_posts', count: 0 }, // zero → dropped
  ]);
  assertArrEq(belowMin, ['desktop.screenshot'], '(3) only count>=3 survives default minCount');
  // custom minCount raises the bar
  const strict = computeAutoPinSet(usage, { minCount: 13 });
  assertArrEq(strict, ['desktop.screenshot', 'gmail.read'], '(3) minCount=13 keeps only >=13');
  // minCount 0 keeps everything with a positive count (still cap-bounded)
  const loose = computeAutoPinSet([{ tool: 'a.b', count: 1 }, { tool: 'c.d', count: 2 }], { minCount: 0 });
  assertArrEq(loose, ['c.d', 'a.b'], '(3) minCount=0 keeps count>=0, sorted desc');

  // ─── (4) already-pinned excluded via excludePinned ────────────────────────
  const excl = computeAutoPinSet(usage, { excludePinned: ['gmail.read', 'desktop.screenshot'] });
  assertArrEq(excl, ['github.read_file', 'vault.find', 'wp.list_posts'], '(4) excludePinned removes those tools');
  assert(!excl.includes('gmail.read'), '(4) pinned gmail.read not re-pinned');
  assert(!excl.includes('desktop.screenshot'), '(4) pinned desktop.screenshot not re-pinned');
  // excludePinned accepts a Set
  const exclSet = computeAutoPinSet(usage, { excludePinned: new Set(['github.read_file']) });
  assert(!exclSet.includes('github.read_file'), '(4) excludePinned Set honored');
  // excludePinned accepts a record (keys = pinned names)
  const exclRec = computeAutoPinSet(usage, { excludePinned: { 'vault.find': true, 'gmail.read': 1 } });
  assert(!exclRec.includes('vault.find') && !exclRec.includes('gmail.read'), '(4) excludePinned record keys honored');

  // ─── (5) tools.search is NEVER auto-pinned, however heavy ─────────────────
  const withSearch = computeAutoPinSet([
    { tool: 'tools.search', count: 9999 },
    { tool: 'desktop.screenshot', count: 10 },
  ]);
  assertArrEq(withSearch, ['desktop.screenshot'], '(5) tools.search dropped despite huge count');
  assert(!withSearch.includes('tools.search'), '(5) tools.search excluded');
  // even when NOT in excludePinned, and combined with other exclusions
  const onlySearch = computeAutoPinSet([{ tool: 'tools.search', count: 500 }]);
  assertArrEq(onlySearch, [], '(5) usage of only tools.search → []');

  // ─── (6) cap behavior ─────────────────────────────────────────────────────
  const many: ToolUsageRow[] = [];
  for (let i = 0; i < 20; i += 1) many.push({ tool: `fam.tool_${String(i).padStart(2, '0')}`, count: 100 - i });
  const capped = computeAutoPinSet(many); // default cap 6
  assertEq(capped.length, 6, '(6) default cap limits to 6');
  assertArrEq(
    capped,
    ['fam.tool_00', 'fam.tool_01', 'fam.tool_02', 'fam.tool_03', 'fam.tool_04', 'fam.tool_05'],
    '(6) default cap keeps the 6 highest',
  );
  assertEq(computeAutoPinSet(many, { cap: 3 }).length, 3, '(6) custom cap=3 honored');
  assertEq(computeAutoPinSet(many, { cap: 10 }).length, 10, '(6) custom cap=10 honored');
  assertArrEq(computeAutoPinSet(many, { cap: 0 }), [], '(6) cap=0 pins nothing');
  assert(computeAutoPinSet(many, { cap: 99999 }).length <= 100, '(6) absurd cap clamped to hard max');
  assert(computeAutoPinSet(many, { cap: -5 }).length === 6, '(6) negative cap → default');
  assertEq(computeAutoPinSet(many, { cap: 2.9 }).length, 2, '(6) fractional cap floored');

  // ─── (7) deterministic tie-break by ascending name ────────────────────────
  const ties = computeAutoPinSet([
    { tool: 'zed.tool', count: 7 },
    { tool: 'alpha.tool', count: 7 },
    { tool: 'mid.tool', count: 7 },
  ]);
  assertArrEq(ties, ['alpha.tool', 'mid.tool', 'zed.tool'], '(7) equal counts sort by name asc');
  // stable across input ordering
  const tiesReordered = computeAutoPinSet([
    { tool: 'mid.tool', count: 7 },
    { tool: 'zed.tool', count: 7 },
    { tool: 'alpha.tool', count: 7 },
  ]);
  assertArrEq(tiesReordered, ['alpha.tool', 'mid.tool', 'zed.tool'], '(7) tie-break independent of input order');

  // ─── (8) alternate input shapes: record + Map ─────────────────────────────
  const fromRecord = computeAutoPinSet({ 'desktop.screenshot': 42, 'gmail.read': 30, 'vault.find': 1 });
  assertArrEq(fromRecord, ['desktop.screenshot', 'gmail.read'], '(8) record<tool,count> input works, minCount applied');
  const fromMap = computeAutoPinSet(new Map<string, number>([['a.x', 5], ['b.y', 9]]));
  assertArrEq(fromMap, ['b.y', 'a.x'], '(8) Map<tool,count> input works, sorted desc');
  // numeric-string counts (e.g. bigint serialized as text) are coerced
  const strCounts = computeAutoPinSet([{ tool: 'a.x', count: '9' as unknown as number }, { tool: 'b.y', count: '4' as unknown as number }]);
  assertArrEq(strCounts, ['a.x', 'b.y'], '(8) numeric-string counts coerced');

  // ─── (9) duplicate rows are summed ────────────────────────────────────────
  const dup = computeAutoPinSet([
    { tool: 'desktop.screenshot', count: 1 },
    { tool: 'desktop.screenshot', count: 1 },
    { tool: 'desktop.screenshot', count: 1 }, // sums to 3 → meets minCount
    { tool: 'gmail.read', count: 1 },
    { tool: 'gmail.read', count: 1 }, // sums to 2 → below minCount
  ]);
  assertArrEq(dup, ['desktop.screenshot'], '(9) duplicate rows summed before the minCount gate');

  // ─── (10) mergeAutoPins union / dedupe / order / bound ────────────────────
  const base = ['tasks.list', 'goals.list', 'tools.search'];
  const merged = mergeAutoPins(base, ['desktop.screenshot', 'gmail.read']);
  assertArrEq(
    merged,
    ['tasks.list', 'goals.list', 'tools.search', 'desktop.screenshot', 'gmail.read'],
    '(10) base first, then auto-pins appended',
  );
  const overlap = mergeAutoPins(['tasks.list', 'gmail.read'], ['gmail.read', 'desktop.screenshot']);
  assertArrEq(overlap, ['tasks.list', 'gmail.read', 'desktop.screenshot'], '(10) overlapping names deduped, base wins position');
  assertEq(mergeAutoPins(['a.x', 'a.x', 'a.x'], []).length, 1, '(10) intra-base dupes collapsed');
  // cap bounds the merged list, base-first
  const capMerge = mergeAutoPins(['a.x', 'b.y', 'c.z'], ['d.w', 'e.v'], 4);
  assertArrEq(capMerge, ['a.x', 'b.y', 'c.z', 'd.w'], '(10) merge cap truncates keeping base first');
  assertArrEq(mergeAutoPins(['a.x'], ['b.y'], 0), [], '(10) merge cap 0 → []');
  // real end-to-end: compute then merge into a pinned core
  const pinned = ['tasks.list', 'goals.list', 'tools.search', 'save_memory'];
  const learned = computeAutoPinSet(usage, { excludePinned: pinned });
  const finalPins = mergeAutoPins(pinned, learned);
  assert(finalPins.includes('tasks.list') && finalPins.includes('desktop.screenshot'), '(10) merged core keeps base + adds learned');
  assertEq(new Set(finalPins).size, finalPins.length, '(10) merged core has no duplicates');

  // ─── (11) invalid rows / names are skipped (not thrown) ───────────────────
  const messy = computeAutoPinSet([
    { tool: 'good.tool', count: 5 },
    { tool: 'has space', count: 99 }, // invalid shape → skipped
    { tool: '', count: 99 }, // empty → skipped
    { tool: 42 as unknown as string, count: 99 }, // non-string tool → skipped
    { tool: 'bad.count', count: NaN }, // NaN count → skipped
    { tool: 'neg.count', count: -4 }, // negative count → skipped
    { tool: 'null.count', count: null as unknown as number }, // null count → skipped
    null as unknown as ToolUsageRow, // null row → skipped
    'nope' as unknown as ToolUsageRow, // string row → skipped
  ]);
  assertArrEq(messy, ['good.tool'], '(11) only the one valid, above-min row survives');

  // ─── (12) hostile / degenerate — must never throw, output bounded ─────────
  try {
    assertArrEq(computeAutoPinSet(null), [], '(12) null usage → []');
    assertArrEq(computeAutoPinSet(undefined), [], '(12) undefined usage → []');
    assertArrEq(computeAutoPinSet(123 as unknown), [], '(12) number usage → []');
    assertArrEq(computeAutoPinSet('desktop.screenshot' as unknown), [], '(12) string usage → []');
    assertArrEq(computeAutoPinSet(true as unknown), [], '(12) boolean usage → []');
    assertArrEq(computeAutoPinSet([1, 2, 3] as unknown), [], '(12) array of primitives → []');
    assertArrEq(computeAutoPinSet({} as unknown), [], '(12) empty record → []');
    assertArrEq(computeAutoPinSet(NaN as unknown), [], '(12) NaN usage → []');
    // hostile opts
    assertArrEq(computeAutoPinSet(usage, null as unknown as undefined).length > 0 ? [] : [], [], '(12) null opts tolerated');
    assert(computeAutoPinSet(usage, 5 as unknown as undefined).length >= 0, '(12) number opts tolerated');
    assert(computeAutoPinSet(usage, 'x' as unknown as undefined).length >= 0, '(12) string opts tolerated');
    assert(computeAutoPinSet(usage, { cap: NaN }).length === 5, '(12) NaN cap → default (5 tools qualify)');
    assert(computeAutoPinSet(usage, { cap: Infinity }).length <= 100, '(12) Infinity cap clamped');
    assert(computeAutoPinSet(usage, { minCount: NaN }).length >= 0, '(12) NaN minCount → default, no throw');
    assert(computeAutoPinSet(usage, { minCount: -1 }).length >= 0, '(12) negative minCount → default');
    assert(computeAutoPinSet(usage, { excludePinned: 123 as unknown }).length >= 0, '(12) non-collection excludePinned tolerated');
    assert(computeAutoPinSet(usage, { excludePinned: 'gmail.read' }).length >= 0, '(12) string excludePinned tolerated');
    // huge, overlong, and hostile names
    const huge: ToolUsageRow[] = [];
    for (let i = 0; i < 12000; i += 1) huge.push({ tool: `f.t${i}`, count: (i % 7) + 3 });
    const hugeOut = computeAutoPinSet(huge);
    assert(Array.isArray(hugeOut) && hugeOut.length <= 6, '(12) 12k rows → bounded output');
    const overlong = 'x'.repeat(50000);
    assertArrEq(computeAutoPinSet([{ tool: overlong, count: 99 }]), [], '(12) 50k-char name rejected');
    // prototype-pollution-ish keys on a record
    const weird = computeAutoPinSet({ __proto__: 5, constructor: 5, 'safe.tool': 9 } as unknown);
    assert(Array.isArray(weird), '(12) record with __proto__/constructor keys → array, no throw');
    // mergeAutoPins hostile inputs
    assertArrEq(mergeAutoPins(null, null), [], '(12) merge(null,null) → []');
    assertArrEq(mergeAutoPins(undefined, undefined), [], '(12) merge(undefined,undefined) → []');
    assertArrEq(mergeAutoPins(123 as unknown, 456 as unknown), [], '(12) merge(number,number) → []');
    assertArrEq(mergeAutoPins('a.b' as unknown, 'c.d' as unknown), ['a.b', 'c.d'], '(12) merge(string,string) → single-name arrays');
    assert(mergeAutoPins(new Set(['a.b']), new Set(['c.d'])).length === 2, '(12) merge accepts Sets');
    assert(mergeAutoPins({ 'a.b': 1 }, { 'c.d': 1 }).length === 2, '(12) merge accepts records (keys)');
    assert(mergeAutoPins(['bad name', '', 42, 'ok.tool'] as unknown[], []).length === 1, '(12) merge skips invalid names');
    const bigBase: string[] = [];
    for (let i = 0; i < 5000; i += 1) bigBase.push(`b.t${i}`);
    assert(mergeAutoPins(bigBase, []).length <= 200, '(12) merge default cap bounds huge base');
    assert(mergeAutoPins(bigBase, [], 99999).length <= 1000, '(12) merge absurd cap clamped to hard max');
    assert(mergeAutoPins(bigBase, [], -1).length <= 200, '(12) merge negative cap → default');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll tool-auto-pin-core smoke cases passed (${passes} passed).`);
}

main();
