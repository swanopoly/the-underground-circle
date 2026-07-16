/**
 * Smoke test for src/lib/promptCacheSplitCore.ts
 *
 * Pure — loads under tsx (promptCacheSplitCore has zero runtime imports).
 * Also imports chatPromptAssembly (itself tsx-loadable, import-type-only) to
 * assert the copied boundary marker stays byte-identical to the real
 * CHAT_PROMPT_CACHE_BOUNDARY and that splitting a REAL composeChatSystemPrompt
 * blob reproduces the (base, extras) halves exactly.
 *
 * Covers (OPTIMIZE #1 — make the prompt cache boundary real): split at the real
 * marker → correct halves + splitApplied; no marker → all-frozen tail-empty
 * splitApplied=false; custom + degenerate markers; marker at edges;
 * buildCacheableSystemBlocks puts cache_control ONLY on the frozen block, skips
 * empty/whitespace blocks (empty tail → one block, empty frozen → one uncached
 * block, both empty → []); isVolatileAboveBoundary detects '## Current Context'
 * / chat-history / response-directive cues wrongly above the boundary, returns
 * [] for a clean prefix, respects custom + explicit-empty marker lists, dedups;
 * a round-trip split→blocks→guard on a real composed prompt; boundedness of
 * huge input; and hostile no-throw across every export.
 *
 * Run: npx tsx scripts/prompt-cache-split-core-smoketest.ts
 */

import {
  splitPromptAtCacheBoundary,
  buildCacheableSystemBlocks,
  isVolatileAboveBoundary,
  DEFAULT_CACHE_BOUNDARY_MARKER,
  DEFAULT_VOLATILE_MARKERS,
  type PromptCacheSplit,
  type AnthropicSystemBlock,
} from '../src/lib/promptCacheSplitCore';
import {
  CHAT_PROMPT_CACHE_BOUNDARY,
  composeChatSystemPrompt,
} from '../src/lib/chatPromptAssembly';

let passes = 0, failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Helpers -------------------------------------------------------------------
function hasCacheControl(b: any): boolean {
  return !!b && typeof b === 'object' && 'cache_control' in b;
}
function noThrow(label: string, fn: () => void): void {
  try { fn(); assert(true, label); }
  catch (e) { assert(false, label, String(e)); }
}

const MARKER = DEFAULT_CACHE_BOUNDARY_MARKER;
const FROZEN = 'You are SwanBot.\n\n## Identity\n- stable rules\n- capabilities';
const TAIL = '## Current Context\n- Talking to: Alice\n## Recent Chat Context\nfoo';

function main() {
  // 1) lockstep with the real assembler marker -----------------------------
  assertEq(
    DEFAULT_CACHE_BOUNDARY_MARKER, CHAT_PROMPT_CACHE_BOUNDARY,
    '1 boundary marker byte-identical to CHAT_PROMPT_CACHE_BOUNDARY',
  );
  assert(MARKER.length > 0, '1 marker non-empty');
  assert(Array.isArray(DEFAULT_VOLATILE_MARKERS) && DEFAULT_VOLATILE_MARKERS.length >= 3,
    '1 default volatile markers exported');

  // 2) split at the real marker → correct halves ---------------------------
  const composed = FROZEN + MARKER + TAIL;
  const s: PromptCacheSplit = splitPromptAtCacheBoundary(composed);
  assertEq(s.splitApplied, true, '2 splitApplied true when marker present');
  assertEq(s.frozenPrefix, FROZEN, '2 frozenPrefix = everything before marker');
  assertEq(s.dynamicTail, TAIL, '2 dynamicTail = everything after marker');
  assert(!s.frozenPrefix.includes(MARKER), '2 marker dropped from frozen');
  assert(!s.dynamicTail.includes(MARKER), '2 marker dropped from tail');

  // 3) split a REAL composeChatSystemPrompt blob ---------------------------
  const realComposed = composeChatSystemPrompt(FROZEN, TAIL);
  assert(realComposed.includes(MARKER), '3 composeChatSystemPrompt inserts the boundary');
  const s3 = splitPromptAtCacheBoundary(realComposed);
  assertEq(s3.frozenPrefix, FROZEN, '3 split reproduces base (byte-identity)');
  assertEq(s3.dynamicTail, TAIL, '3 split reproduces extras (byte-identity)');
  assertEq(s3.splitApplied, true, '3 splitApplied on real composed prompt');

  // 4) no marker → whole thing frozen, empty tail, splitApplied false ------
  const noMark = splitPromptAtCacheBoundary('just a plain prompt, no boundary');
  assertEq(noMark.splitApplied, false, '4 splitApplied false when no marker');
  assertEq(noMark.frozenPrefix, 'just a plain prompt, no boundary', '4 whole prompt is frozen');
  assertEq(noMark.dynamicTail, '', '4 tail empty when no marker');

  // composeChatSystemPrompt fast-path: no extras → returns base unchanged
  // (no boundary), so a split of it is all-frozen.
  const baseOnly = composeChatSystemPrompt(FROZEN, '');
  assertEq(baseOnly, FROZEN, '4 compose fast-path returns base when no extras');
  const s4 = splitPromptAtCacheBoundary(baseOnly);
  assertEq(s4.splitApplied, false, '4 base-only split not applied');
  assertEq(s4.frozenPrefix, FROZEN, '4 base-only frozen = base');
  assertEq(s4.dynamicTail, '', '4 base-only tail empty');

  // 5) custom boundary marker ----------------------------------------------
  const cust = splitPromptAtCacheBoundary('AAA<<CUT>>BBB', { boundaryMarker: '<<CUT>>' });
  assertEq(cust.splitApplied, true, '5 custom marker splits');
  assertEq(cust.frozenPrefix, 'AAA', '5 custom marker frozen half');
  assertEq(cust.dynamicTail, 'BBB', '5 custom marker tail half');
  // custom marker absent → all frozen
  const custAbsent = splitPromptAtCacheBoundary('AAABBB', { boundaryMarker: '<<CUT>>' });
  assertEq(custAbsent.splitApplied, false, '5 custom marker absent → not applied');
  assertEq(custAbsent.frozenPrefix, 'AAABBB', '5 custom marker absent → all frozen');

  // 6) degenerate opts fall back to default marker -------------------------
  const emptyMark = splitPromptAtCacheBoundary(composed, { boundaryMarker: '' });
  assertEq(emptyMark.splitApplied, true, '6 empty marker string falls back to default');
  assertEq(emptyMark.frozenPrefix, FROZEN, '6 empty-marker fallback still splits at default');
  const badMarkType = splitPromptAtCacheBoundary(composed, { boundaryMarker: 123 as any });
  assertEq(badMarkType.frozenPrefix, FROZEN, '6 non-string marker falls back to default');
  const noOpts = splitPromptAtCacheBoundary(composed, undefined);
  assertEq(noOpts.splitApplied, true, '6 undefined opts uses default marker');

  // 7) marker at the very edges --------------------------------------------
  const atStart = splitPromptAtCacheBoundary(MARKER + 'tailonly');
  assertEq(atStart.frozenPrefix, '', '7 marker at start → empty frozen');
  assertEq(atStart.dynamicTail, 'tailonly', '7 marker at start → tail is rest');
  assertEq(atStart.splitApplied, true, '7 marker at start splitApplied');
  const atEnd = splitPromptAtCacheBoundary('frozenonly' + MARKER);
  assertEq(atEnd.frozenPrefix, 'frozenonly', '7 marker at end → frozen is head');
  assertEq(atEnd.dynamicTail, '', '7 marker at end → empty tail');
  assertEq(atEnd.splitApplied, true, '7 marker at end splitApplied');
  // first occurrence wins (frozen prefix maximal-yet-stable)
  const twice = splitPromptAtCacheBoundary('A' + MARKER + 'B' + MARKER + 'C');
  assertEq(twice.frozenPrefix, 'A', '7 first marker occurrence chosen');
  assertEq(twice.dynamicTail, 'B' + MARKER + 'C', '7 tail keeps later marker text');

  // 8) buildCacheableSystemBlocks — cache_control ONLY on frozen -----------
  const blocks: AnthropicSystemBlock[] = buildCacheableSystemBlocks(FROZEN, TAIL);
  assertEq(blocks.length, 2, '8 two blocks for frozen+tail');
  assertEq(blocks[0].type, 'text', '8 frozen block type text');
  assertEq(blocks[0].text, FROZEN, '8 frozen block carries frozen text');
  assert(hasCacheControl(blocks[0]), '8 frozen block HAS cache_control');
  assertEq(blocks[0].cache_control?.type, 'ephemeral', '8 frozen cache_control ephemeral');
  assertEq(blocks[1].type, 'text', '8 dynamic block type text');
  assertEq(blocks[1].text, TAIL, '8 dynamic block carries tail text');
  assert(!hasCacheControl(blocks[1]), '8 dynamic block has NO cache_control');

  // 9) empty tail → one (frozen, cached) block -----------------------------
  const oneBlock = buildCacheableSystemBlocks(FROZEN, '');
  assertEq(oneBlock.length, 1, '9 empty tail → single block');
  assertEq(oneBlock[0].text, FROZEN, '9 single block is the frozen prefix');
  assert(hasCacheControl(oneBlock[0]), '9 single frozen block still cached');

  // 10) empty frozen, tail present → one UNcached block --------------------
  const tailOnly = buildCacheableSystemBlocks('', TAIL);
  assertEq(tailOnly.length, 1, '10 empty frozen → single block');
  assertEq(tailOnly[0].text, TAIL, '10 single block is the tail');
  assert(!hasCacheControl(tailOnly[0]), '10 tail-only block NOT cached (nothing stable)');

  // 11) both empty / whitespace-only → skipped -----------------------------
  assertEq(buildCacheableSystemBlocks('', '').length, 0, '11 both empty → []');
  assertEq(buildCacheableSystemBlocks('   ', '\n\t ').length, 0, '11 whitespace-only → []');
  const wsFrozen = buildCacheableSystemBlocks('   ', TAIL);
  assertEq(wsFrozen.length, 1, '11 whitespace frozen skipped, tail kept');
  assert(!hasCacheControl(wsFrozen[0]), '11 remaining tail block uncached');

  // 12) end-to-end: split then build the wire blocks -----------------------
  const s12 = splitPromptAtCacheBoundary(composed);
  const wire = buildCacheableSystemBlocks(s12.frozenPrefix, s12.dynamicTail);
  assertEq(wire.length, 2, '12 round-trip → 2 wire blocks');
  assert(hasCacheControl(wire[0]) && !hasCacheControl(wire[1]),
    '12 round-trip cache_control only on frozen');
  assertEq(wire[0].text + wire[1].text, FROZEN + TAIL, '12 round-trip text preserved (sans marker)');

  // 13) isVolatileAboveBoundary — detects poisoning ------------------------
  // Mirrors swanbot.ts buildSystemPrompt today: volatile fields sit ABOVE the
  // boundary, so they land in the frozen prefix and defeat the cache.
  const poisoned = FROZEN + '\n## Current Context\n- Talking to: Bob';
  const bad = isVolatileAboveBoundary(poisoned);
  assert(bad.includes('## Current Context'), '13 detects ## Current Context above boundary');
  assert(bad.length >= 1, '13 poisoned prefix flagged');

  // 14) clean frozen prefix → [] -------------------------------------------
  assertEq(isVolatileAboveBoundary(FROZEN).length, 0, '14 clean prefix → no volatile markers');
  assertEq(isVolatileAboveBoundary('').length, 0, '14 empty prefix → []');

  // 15) multiple volatile markers + defaults -------------------------------
  const multi = '## How to Respond\nx\n## Current Context\ny\n## Recent Chat Context\nz';
  const many = isVolatileAboveBoundary(multi);
  assert(many.includes('## Current Context'), '15 multi detects current-context');
  assert(many.includes('## How to Respond'), '15 multi detects response directive');
  assert(many.includes('## Recent Chat Context'), '15 multi detects chat history header');
  assert(many.length >= 3, '15 multi flags all three volatile sections');

  // 16) custom marker list --------------------------------------------------
  const custVol = isVolatileAboveBoundary('has SECRET-FIELD here', ['SECRET-FIELD', 'ABSENT']);
  assertEq(custVol.length, 1, '16 custom markers: only present one returned');
  assertEq(custVol[0], 'SECRET-FIELD', '16 custom marker value correct');

  // 17) explicit empty array respected → [] --------------------------------
  assertEq(isVolatileAboveBoundary(multi, []).length, 0, '17 explicit [] markers → []');

  // 18) dedup marker list ---------------------------------------------------
  const dup = isVolatileAboveBoundary('## Current Context', ['## Current Context', '## Current Context']);
  assertEq(dup.length, 1, '18 duplicate markers reported once');

  // 19) the wire we would send is cache-safe once volatile moved to tail ---
  const goodFrozen = FROZEN; // clean
  const goodTail = '## Current Context\n- live\n## How to Respond\ndirective';
  assertEq(isVolatileAboveBoundary(goodFrozen).length, 0, '19 frozen clean after moving volatile down');
  const goodWire = buildCacheableSystemBlocks(goodFrozen, goodTail);
  assert(hasCacheControl(goodWire[0]) && !hasCacheControl(goodWire[1]),
    '19 correct wire: stable cached, volatile uncached');

  // 20) boundedness — huge input clamped, never unbounded ------------------
  const huge = 'x'.repeat(5_000_000);
  const sHuge = splitPromptAtCacheBoundary(huge);
  assert(sHuge.frozenPrefix.length <= 2_000_000, '20 huge frozen clamped to bound');
  assertEq(sHuge.splitApplied, false, '20 huge no-marker not split');
  const hugeBlocks = buildCacheableSystemBlocks(huge, huge);
  assert(hugeBlocks[0].text.length <= 2_000_000, '20 huge block text clamped');
  const hugeMarker = 'a'.repeat(600);
  const vHuge = isVolatileAboveBoundary('a'.repeat(700), [hugeMarker]);
  assert(Array.isArray(vHuge), '20 huge marker scan returns array (bounded, no throw)');

  // 21) hostile no-throw across every export -------------------------------
  const cyclic: any = {}; cyclic.self = cyclic;
  const evil: any = { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } };
  const hostiles: any[] = [null, undefined, 0, 1, NaN, true, false, {}, [], cyclic, evil, Symbol('x'), () => 1];
  for (const h of hostiles) {
    noThrow('21 split no-throw for ' + String(typeof h), () => {
      const r = splitPromptAtCacheBoundary(h);
      assert(typeof r.frozenPrefix === 'string' && typeof r.dynamicTail === 'string' && typeof r.splitApplied === 'boolean',
        '21 split returns valid shape for hostile');
    });
    noThrow('21 buildBlocks no-throw for ' + String(typeof h), () => {
      const r = buildCacheableSystemBlocks(h, h);
      assert(Array.isArray(r), '21 buildBlocks returns array for hostile');
    });
    noThrow('21 volatile no-throw for ' + String(typeof h), () => {
      const r = isVolatileAboveBoundary(h, h);
      assert(Array.isArray(r), '21 volatile returns array for hostile');
    });
  }
  // hostile input coerces to safe neutral (non-strings ignored, never String()'d)
  assertEq(splitPromptAtCacheBoundary(cyclic).frozenPrefix, '', '21 cyclic → empty frozen');
  assertEq(splitPromptAtCacheBoundary(evil).splitApplied, false, '21 evil-toString → not split, no throw');
  assertEq(buildCacheableSystemBlocks(evil, evil).length, 0, '21 evil blocks → []');
  assertEq(isVolatileAboveBoundary(42 as any).length, 0, '21 number prefix → []');

  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll prompt-cache-split-core smoke cases passed (' + passes + ' passed).');
}
main();
