/**
 * tool-catalog-perf-core-smoketest — the PURE tool-catalog hot-path helpers
 * (src/lib/toolCatalogPerfCore.ts) behind R4 + R5 of
 * docs/OPENSWAN_HOTPATH_OPTIMIZATION_PLAN.md. Load-bearing behaviour:
 *   - buildToolDefIndex: name→def Map, O(1) `.get`, LAST-WINS on dup name,
 *     skips non-object / missing / non-string / empty / over-long names,
 *     bounded to MAX_TOOL_DEFS, values are the original def references (R5).
 *   - toolCatalogMemoKey: STABLE + order-insensitive (reorder/dup allowlist →
 *     same key); surface/mode change → different key; mode null/undefined/''
 *     collapse but real modes stay distinct; the "no-filter (full catalog)"
 *     input is NEVER confused with a filter-to-nothing allowlist like [123];
 *     allowlist HASHED (secret-safe) + bounded output (R4).
 *   - shouldRebuildCatalog: same key → false (reuse); any drift / invalid →
 *     true (rebuild — fail toward correctness).
 *   - total: null/undefined/wrong-type/huge/hostile/cyclic → safe neutral.
 *
 * Pure — loads under tsx (toolCatalogPerfCore has zero imports).
 */

import {
  buildToolDefIndex,
  toolCatalogMemoKey,
  shouldRebuildCatalog,
  MAX_TOOL_DEFS,
  MAX_TOOL_NAME_CHARS,
  MAX_ALLOWLIST_ENTRIES,
  TOOL_CATALOG_MEMO_KEY_VERSION,
} from '../src/lib/toolCatalogPerfCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertNe(a: unknown, b: unknown, msg: string): void {
  assert(a !== b, msg, `both === ${JSON.stringify(a)}`);
}
/** Realistic OpenSwanToolDefinition-shaped factory (grounded in the real type). */
const def = (name: unknown, extra?: Record<string, unknown>) => ({
  name,
  label: typeof name === 'string' ? `${name} label` : 'label',
  surfaces: ['main_chat'],
  description: 'desc',
  ...(extra || {}),
});

function main(): void {
  // ─── (1) buildToolDefIndex: O(1) name→def lookup, correct values ─────────
  {
    const a = def('context.search', { disclosure: 'pinned' });
    const b = def('codebase.search');
    const c = def('tasks.list');
    const idx = buildToolDefIndex([a, b, c]);
    assert(idx instanceof Map, '(1) returns a Map');
    assertEq(idx.size, 3, '(1) three unique defs → size 3');
    assertEq(idx.get('context.search'), a, '(1) get returns the ORIGINAL def reference');
    assertEq(idx.get('codebase.search'), b, '(1) second def by name');
    assertEq(idx.get('tasks.list'), c, '(1) third def by name');
    assertEq(idx.has('context.search'), true, '(1) has() true for a present name');
    // The original object is preserved so callers can read .surfaces/.disclosure.
    assertEq((idx.get('context.search') as { disclosure?: string }).disclosure, 'pinned', '(1) def fields intact');
  }

  // ─── (2) buildToolDefIndex: absent name → undefined (O(1) miss) ──────────
  {
    const idx = buildToolDefIndex([def('a.one'), def('b.two')]);
    assertEq(idx.get('c.three'), undefined, '(2) absent name → undefined');
    assertEq(idx.has('c.three'), false, '(2) has() false for absent name');
  }

  // ─── (3) buildToolDefIndex: LAST-WINS on duplicate name ──────────────────
  {
    const first = def('dup.tool', { label: 'FIRST' });
    const second = def('dup.tool', { label: 'SECOND' });
    const idx = buildToolDefIndex([first, second]);
    assertEq(idx.size, 1, '(3) dup name collapses to one entry');
    assertEq(idx.get('dup.tool'), second, '(3) last write wins (matches new Map(...) semantics)');
    assertEq((idx.get('dup.tool') as { label: string }).label, 'SECOND', '(3) last-wins value');
  }

  // ─── (4) buildToolDefIndex: skips malformed entries, never throws ────────
  {
    const good = def('good.tool');
    const idx = buildToolDefIndex([
      good,
      null,               // non-object
      undefined,          // non-object
      42,                 // non-object
      'str',              // non-object
      {},                 // object, no name
      { name: 123 },      // non-string name
      { name: '' },       // empty name
      def(''),            // empty name via factory
      def(null),          // non-string name
      ['x'],              // array (object, but no 'name') → skipped
    ]);
    assertEq(idx.size, 1, '(4) only the one well-formed def survives');
    assertEq(idx.get('good.tool'), good, '(4) the good def is present');
    assertEq(idx.has(''), false, '(4) empty-string name never indexed');
  }

  // ─── (5) buildToolDefIndex: over-long name skipped, boundary kept ────────
  {
    const okName = 'x'.repeat(MAX_TOOL_NAME_CHARS);        // exactly at the cap → kept
    const tooLong = 'y'.repeat(MAX_TOOL_NAME_CHARS + 1);   // over the cap → skipped
    const okDef = def(okName);
    const idx = buildToolDefIndex([okDef, def(tooLong)]);
    assertEq(idx.size, 1, '(5) over-long name skipped, boundary name kept');
    assertEq(idx.get(okName), okDef, '(5) name at exactly MAX_TOOL_NAME_CHARS is indexed');
    assertEq(idx.get(tooLong), undefined, '(5) over-long name is not indexed (no clamp-collision)');
  }

  // ─── (6) buildToolDefIndex: bounded to MAX_TOOL_DEFS ─────────────────────
  {
    const many = [];
    for (let i = 0; i < MAX_TOOL_DEFS + 100; i++) many.push(def(`tool.${i}`));
    const idx = buildToolDefIndex(many);
    assertEq(idx.size, MAX_TOOL_DEFS, '(6) index capped at MAX_TOOL_DEFS');
    assertEq(idx.has('tool.0'), true, '(6) first (scanned) def present');
    assertEq(idx.has(`tool.${MAX_TOOL_DEFS - 1}`), true, '(6) last scanned def present');
    assertEq(idx.has(`tool.${MAX_TOOL_DEFS + 50}`), false, '(6) beyond-cap def absent');
  }

  // ─── (7) buildToolDefIndex: non-array / hostile inputs → empty Map ───────
  {
    for (const bad of [null, undefined, 42, 'nope', {}, true, Symbol('s')]) {
      const idx = buildToolDefIndex(bad as unknown);
      assert(idx instanceof Map && idx.size === 0, '(7) non-array input → empty Map', String(typeof bad));
    }
  }

  // ─── (8) toolCatalogMemoKey: order-insensitive across allowlist reorder ──
  {
    const k1 = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['tasks.list', 'context.search', 'codebase.search'] });
    const k2 = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['codebase.search', 'tasks.list', 'context.search'] });
    const k3 = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['context.search', 'codebase.search', 'tasks.list'] });
    assertEq(k1, k2, '(8) reordered allowlist → identical key');
    assertEq(k2, k3, '(8) any allowlist permutation → identical key');
    assert(k1.startsWith(TOOL_CATALOG_MEMO_KEY_VERSION), '(8) key carries the version tag');
  }

  // ─── (9) toolCatalogMemoKey: duplicate allowlist entries are deduped ─────
  {
    const base = toolCatalogMemoKey({ surface: 'office', allowlist: ['a.one', 'b.two'] });
    const dup = toolCatalogMemoKey({ surface: 'office', allowlist: ['a.one', 'a.one', 'b.two', 'b.two', 'a.one'] });
    assertEq(base, dup, '(9) duplicates collapse (downstream uses a Set) → same key');
  }

  // ─── (10) toolCatalogMemoKey: surface change → different key ─────────────
  {
    const chat = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['x.a'] });
    const office = toolCatalogMemoKey({ surface: 'office', mode: 'build', allowlist: ['x.a'] });
    const room = toolCatalogMemoKey({ surface: 'room_chat', mode: 'build', allowlist: ['x.a'] });
    assertNe(chat, office, '(10) surface main_chat vs office → different key');
    assertNe(office, room, '(10) surface office vs room_chat → different key');
    assertNe(chat, room, '(10) surface main_chat vs room_chat → different key');
  }

  // ─── (11) toolCatalogMemoKey: mode change → different key ─────────────────
  {
    const build = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['x.a'] });
    const review = toolCatalogMemoKey({ surface: 'main_chat', mode: 'review', allowlist: ['x.a'] });
    const execute = toolCatalogMemoKey({ surface: 'main_chat', mode: 'execute', allowlist: ['x.a'] });
    assertNe(build, review, '(11) mode build vs review → different key (never serve stale tools)');
    assertNe(build, execute, '(11) mode build vs execute → different key');
    assertNe(review, execute, '(11) mode review vs execute → different key');
  }

  // ─── (12) toolCatalogMemoKey: "no mode" spellings collapse; real modes distinct
  {
    const noMode = toolCatalogMemoKey({ surface: 'main_chat', allowlist: ['x.a'] });
    const nullMode = toolCatalogMemoKey({ surface: 'main_chat', mode: null, allowlist: ['x.a'] });
    const undefMode = toolCatalogMemoKey({ surface: 'main_chat', mode: undefined, allowlist: ['x.a'] });
    const emptyMode = toolCatalogMemoKey({ surface: 'main_chat', mode: '', allowlist: ['x.a'] });
    const numMode = toolCatalogMemoKey({ surface: 'main_chat', mode: 123, allowlist: ['x.a'] });
    assertEq(noMode, nullMode, '(12) absent mode === null mode (mirrors runtime modeKey=null)');
    assertEq(nullMode, undefMode, '(12) null mode === undefined mode');
    assertEq(undefMode, emptyMode, '(12) empty-string mode collapses to no-mode');
    assertEq(emptyMode, numMode, '(12) non-string mode collapses to no-mode');
    // 'none'/'talk' are real (non-empty) strings → distinct keys from the no-mode
    // token, matching the runtime, which still passes modeKey='none' through.
    const noneMode = toolCatalogMemoKey({ surface: 'main_chat', mode: 'none', allowlist: ['x.a'] });
    const talkMode = toolCatalogMemoKey({ surface: 'main_chat', mode: 'talk', allowlist: ['x.a'] });
    assertNe(noneMode, noMode, "(12) mode 'none' is a distinct key from no-mode");
    assertNe(talkMode, noMode, "(12) mode 'talk' is a distinct key from no-mode");
    assertNe(noneMode, talkMode, "(12) 'none' and 'talk' are distinct keys");
  }

  // ─── (13) CRITICAL: no-filter (full catalog) is never confused with a ────
  //         filter-to-nothing allowlist. absent === [], both differ from [123].
  {
    const absent = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build' });
    const emptyArr = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: [] });
    const nonArr = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: 'not-an-array' });
    const filterNothing = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: [123] });
    assertEq(absent, emptyArr, '(13) absent allowlist === empty array (both → full catalog)');
    assertEq(absent, nonArr, '(13) non-array allowlist treated as no-filter (neutral)');
    assertNe(absent, filterNothing, '(13) [123] filters to empty catalog ≠ full catalog (hasFilter flag)');
    // Sanity: the no-filter key is flagged 0, the filter key flagged 1.
    const parts = absent.split('\x1f');
    const fparts = filterNothing.split('\x1f');
    assertEq(parts[3], '0', '(13) no-filter → hasFilter flag 0');
    assertEq(fparts[3], '1', '(13) [123] → hasFilter flag 1');
  }

  // ─── (14) toolCatalogMemoKey: [''] filters to {''} — distinct from all ────
  {
    const absent = toolCatalogMemoKey({ surface: 'main_chat' });
    const emptyStr = toolCatalogMemoKey({ surface: 'main_chat', allowlist: [''] });
    const filterNothing = toolCatalogMemoKey({ surface: 'main_chat', allowlist: [123] });
    assertNe(emptyStr, absent, "(14) [''] (filter to empty-string set) ≠ full catalog");
    assertNe(emptyStr, filterNothing, "(14) [''] ≠ [123] (different string set)");
  }

  // ─── (15) toolCatalogMemoKey: non-string entries don't change the string set
  {
    // 'ctx' is the only real (string) matcher; 123 never matches a tool name, so
    // ['ctx',123] and ['ctx'] yield the same catalog → SAME key.
    const withJunk = toolCatalogMemoKey({ surface: 'main_chat', allowlist: ['ctx', 123, null, {}, true] });
    const clean = toolCatalogMemoKey({ surface: 'main_chat', allowlist: ['ctx'] });
    assertEq(withJunk, clean, '(15) non-string entries dropped from the string set → same key');
    // But an EXTRA string entry does change the set.
    const twoStrings = toolCatalogMemoKey({ surface: 'main_chat', allowlist: ['ctx', 'extra'] });
    assertNe(twoStrings, clean, '(15) adding a real string entry → different key');
  }

  // ─── (16) toolCatalogMemoKey: deterministic + secret-safe (allowlist hashed)
  {
    const secret = 'sk-live-SUPERSECRET-0xdeadbeef';
    const k1 = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: [secret, 'ctx'] });
    const k2 = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['ctx', secret] });
    assertEq(k1, k2, '(16) deterministic + order-insensitive with a long entry');
    assert(k1.indexOf(secret) === -1, '(16) allowlist entry is HASHED, never echoed (secret-safe)');
    assert(k1.indexOf('SUPERSECRET') === -1, '(16) no substring of the entry leaks into the key');
    // Different allowlist content → different hash → different key.
    const other = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['ctx', 'sk-live-OTHER'] });
    assertNe(k1, other, '(16) different allowlist content → different key');
  }

  // ─── (17) toolCatalogMemoKey: bounded output for a huge allowlist ─────────
  {
    const huge = [];
    for (let i = 0; i < MAX_ALLOWLIST_ENTRIES + 5000; i++) huge.push(`tool.${i}`);
    const k = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: huge });
    assertEq(typeof k, 'string', '(17) huge allowlist still yields a string key');
    assert(k.length < 512, '(17) key stays bounded (hashed) despite huge allowlist', `len=${k.length}`);
    // A giant single name is clamped before hashing (still no throw, still bounded).
    const bigName = 'z'.repeat(500_000);
    const k2 = toolCatalogMemoKey({ surface: 'main_chat', allowlist: [bigName] });
    assert(k2.length < 512, '(17) giant single name → bounded key');
    assertEq(k2, toolCatalogMemoKey({ surface: 'main_chat', allowlist: [bigName] }), '(17) still deterministic');
  }

  // ─── (18) toolCatalogMemoKey: hostile inputs → stable string, never throws ─
  {
    try {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const cyclicArr: unknown[] = [];
      cyclicArr.push(cyclicArr);
      const throwingSurface = new Proxy({}, { get(_t, p) { if (p === 'surface') throw new Error('boom'); return undefined; } });
      const throwingAllow = new Proxy([1], { get(_t, p) { if (p === 'length') return 2; throw new Error('idx'); } });
      const inputs: unknown[] = [
        null, undefined, 42, 'str', true, Symbol('s'), [], {},
        { surface: {}, mode: [], allowlist: {} },
        { surface: cyclic, mode: cyclic, allowlist: cyclicArr },
        cyclic, cyclicArr, throwingSurface,
        { surface: 'main_chat', allowlist: throwingAllow },
        { allowlist: [Symbol('x'), () => 0, NaN, Infinity, -Infinity] },
      ];
      for (const inp of inputs) {
        const k = toolCatalogMemoKey(inp as unknown);
        assertEq(typeof k, 'string', '(18) hostile input → string key', String(typeof inp));
        assert(k.length > 0 && k.length < 4096, '(18) hostile key bounded & non-empty');
      }
      passes += 1;
    } catch (e) {
      failures += 1;
      console.error(`FAIL: (18) hostile toolCatalogMemoKey threw: ${(e as Error)?.message}`);
    }
  }

  // ─── (19) buildToolDefIndex: hostile inputs → empty/partial, never throws ─
  {
    try {
      const cyclicArr: unknown[] = [];
      cyclicArr.push(cyclicArr);
      const throwingGetter = new Proxy({}, { get(_t, p) { if (p === 'name') throw new Error('boom'); return undefined; } });
      const throwingArr = new Proxy([1, 2], { get(_t, p) { if (p === 'length') return 2; throw new Error('idx'); } });
      // cyclic array element (an array) has no string 'name' → skipped.
      const i1 = buildToolDefIndex(cyclicArr);
      assert(i1 instanceof Map && i1.size === 0, '(19) cyclic array → empty Map');
      // throwing-getter def is skipped (readField swallows the throw).
      const good = def('safe.tool');
      const i2 = buildToolDefIndex([throwingGetter, good]);
      assertEq(i2.size, 1, '(19) throwing-getter def skipped, good def kept');
      assertEq(i2.get('safe.tool'), good, '(19) good def still indexed alongside hostile one');
      // throwing index access on a Proxy array → each read caught → empty Map.
      const i3 = buildToolDefIndex(throwingArr);
      assert(i3 instanceof Map && i3.size === 0, '(19) throwing index access → empty Map, no throw');
      passes += 1;
    } catch (e) {
      failures += 1;
      console.error(`FAIL: (19) hostile buildToolDefIndex threw: ${(e as Error)?.message}`);
    }
  }

  // ─── (20) shouldRebuildCatalog: same key → false, drift → true ───────────
  {
    const k = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['ctx'] });
    const same = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['ctx'] });
    const reordered = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['ctx'] });
    assertEq(shouldRebuildCatalog(k, same), false, '(20) identical key → no rebuild (reuse cache)');
    assertEq(shouldRebuildCatalog(k, reordered), false, '(20) equal keys → reuse');
    const changed = toolCatalogMemoKey({ surface: 'office', mode: 'build', allowlist: ['ctx'] });
    assertEq(shouldRebuildCatalog(k, changed), true, '(20) surface change → rebuild');
    const modeChanged = toolCatalogMemoKey({ surface: 'main_chat', mode: 'review', allowlist: ['ctx'] });
    assertEq(shouldRebuildCatalog(k, modeChanged), true, '(20) mode change → rebuild');
  }

  // ─── (21) shouldRebuildCatalog: integration — allowlist reorder across turns
  {
    const turnA = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['b', 'a', 'c'] });
    const turnB = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['c', 'b', 'a'] });
    assertEq(shouldRebuildCatalog(turnA, turnB), false, '(21) reordered allowlist between turns → cache HIT');
    const turnC = toolCatalogMemoKey({ surface: 'main_chat', mode: 'build', allowlist: ['c', 'b', 'a', 'd'] });
    assertEq(shouldRebuildCatalog(turnB, turnC), true, '(21) grown allowlist → cache MISS (rebuild)');
  }

  // ─── (22) shouldRebuildCatalog: fail toward REBUILD on any doubt ─────────
  {
    const k = toolCatalogMemoKey({ surface: 'main_chat' });
    assertEq(shouldRebuildCatalog(k, undefined), true, '(22) invalid next key → rebuild');
    assertEq(shouldRebuildCatalog(k, null), true, '(22) null next key → rebuild');
    assertEq(shouldRebuildCatalog(k, ''), true, '(22) empty next key → rebuild');
    assertEq(shouldRebuildCatalog(k, 42), true, '(22) non-string next key → rebuild');
    assertEq(shouldRebuildCatalog(undefined, k), true, '(22) no previous build → rebuild');
    assertEq(shouldRebuildCatalog(null, k), true, '(22) null previous → rebuild');
    assertEq(shouldRebuildCatalog('', k), true, '(22) empty previous → rebuild');
    assertEq(shouldRebuildCatalog(undefined, undefined), true, '(22) both invalid → rebuild');
    assertEq(shouldRebuildCatalog(k, k), false, '(22) identical valid keys → reuse');
  }

  // ─── (23) shouldRebuildCatalog: hostile inputs → boolean, never throws ───
  {
    try {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const throwing = new Proxy({}, { get() { throw new Error('boom'); } });
      const inputs: unknown[] = [null, undefined, 42, {}, [], true, Symbol('s'), cyclic, throwing, () => 0, NaN];
      for (const a of inputs) {
        for (const b of inputs) {
          const r = shouldRebuildCatalog(a, b);
          assertEq(typeof r, 'boolean', '(23) always returns a boolean');
        }
      }
      // A hostile giant string key is clamped, still compares deterministically.
      const giant = 'g'.repeat(100_000);
      assertEq(shouldRebuildCatalog(giant, giant), false, '(23) identical giant keys → reuse (clamped compare)');
      passes += 1;
    } catch (e) {
      failures += 1;
      console.error(`FAIL: (23) hostile shouldRebuildCatalog threw: ${(e as Error)?.message}`);
    }
  }

  // ─── (24) cross-check: memoKey ↔ shouldRebuild agree on real catalog inputs
  {
    // Simulate the R4 wiring: a per-turn key computed from the same inputs the
    // memo wrapper would pass to listOpenSwanAnthropicToolsForSurface.
    const prev = toolCatalogMemoKey({ surface: 'task_run', mode: 'execute', allowlist: ['git.run', 'local.run_shell', 'tasks.list'] });
    const nextSame = toolCatalogMemoKey({ surface: 'task_run', mode: 'execute', allowlist: ['tasks.list', 'git.run', 'local.run_shell'] });
    const nextDiff = toolCatalogMemoKey({ surface: 'task_run', mode: 'execute', allowlist: ['tasks.list', 'git.run'] });
    assert(!shouldRebuildCatalog(prev, nextSame), '(24) same effective catalog inputs → reuse');
    assert(shouldRebuildCatalog(prev, nextDiff), '(24) shrunk allowlist → rebuild');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll tool-catalog-perf-core smoke cases passed (${passes} passed).`);
}

main();
