/**
 * steering-note-preservation-core-smoketest — verifies the per-thread parking
 * lot for mid-run steering notes the live bus dropped (steering opt v7).
 *
 * Covers: preserve→take drains once; chronological order; bound to MAX
 * (oldest dropped, keep most-recent); per-thread isolation; take-on-empty → [];
 * clear-one vs clear-all (and that a garbage id never clears all); note
 * normalization (whitespace/empty/huge); LRU thread cap; and hostile inputs
 * (null/undefined/wrong/huge/cyclic/symbol) never throw.
 *
 * Run: npx tsx scripts/steering-note-preservation-core-smoketest.ts
 */

import {
  MAX_UNAPPLIED_STEERING_NOTES,
  clearUnappliedNotes,
  hasUnappliedNotes,
  preserveUnappliedNote,
  takeUnappliedNotes,
} from '../src/lib/steeringNotePreservationCore';

let passes = 0,
  failures = 0;
function assert(c: unknown, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function assertArr(a: string[], b: string[], m: string) {
  assertEq(JSON.stringify(a), JSON.stringify(b), m);
}

function main() {
  // ── 1. MAX constant sanity ─────────────────────────────────────────────
  assert(typeof MAX_UNAPPLIED_STEERING_NOTES === 'number', 'MAX is a number');
  assert(Number.isInteger(MAX_UNAPPLIED_STEERING_NOTES), 'MAX is an integer');
  assert(MAX_UNAPPLIED_STEERING_NOTES > 0, 'MAX is positive');
  assertEq(MAX_UNAPPLIED_STEERING_NOTES, 5, 'MAX pinned at 5 (mirrors steering queue)');

  // ── 2. preserve → take drains exactly once ─────────────────────────────
  clearUnappliedNotes();
  assertEq(hasUnappliedNotes('t1'), false, 'fresh thread has no notes');
  assertArr(takeUnappliedNotes('t1'), [], 'take on fresh thread → []');
  preserveUnappliedNote('t1', 'use the monthly price');
  assertEq(hasUnappliedNotes('t1'), true, 'thread has a note after preserve');
  const first = takeUnappliedNotes('t1');
  assertEq(first.length, 1, 'take returns the one parked note');
  assertEq(first[0], 'use the monthly price', 'take returns the note text');
  assertEq(hasUnappliedNotes('t1'), false, 'take clears the bucket');
  assertArr(takeUnappliedNotes('t1'), [], 'second take → [] (drained once)');

  // ── 3. chronological order (oldest first for prepend) ──────────────────
  clearUnappliedNotes();
  preserveUnappliedNote('ord', 'a');
  preserveUnappliedNote('ord', 'b');
  preserveUnappliedNote('ord', 'c');
  assertArr(takeUnappliedNotes('ord'), ['a', 'b', 'c'], 'notes drain in insertion order');

  // ── 4. bounded to MAX — oldest dropped, keep most-recent ───────────────
  clearUnappliedNotes();
  const over = MAX_UNAPPLIED_STEERING_NOTES + 3; // push 8 when MAX=5
  for (let i = 1; i <= over; i += 1) preserveUnappliedNote('cap', 'n' + i);
  assertEq(hasUnappliedNotes('cap'), true, 'capped thread still has notes');
  const capped = takeUnappliedNotes('cap');
  assertEq(capped.length, MAX_UNAPPLIED_STEERING_NOTES, 'bucket bounded to MAX');
  assertEq(capped.includes('n1'), false, 'oldest note (n1) evicted');
  assertEq(capped.includes('n2'), false, 'second-oldest (n2) evicted');
  assertEq(capped.includes('n3'), false, 'third-oldest (n3) evicted');
  assertEq(capped[0], 'n4', 'first kept note is n4 (most-recent MAX)');
  assertEq(capped[capped.length - 1], 'n' + over, 'last kept note is the newest');

  // ── 5. distinct threads are isolated ───────────────────────────────────
  clearUnappliedNotes();
  preserveUnappliedNote('tA', 'only A');
  preserveUnappliedNote('tB', 'only B');
  assertEq(hasUnappliedNotes('tA'), true, 'thread A has its note');
  assertEq(hasUnappliedNotes('tB'), true, 'thread B has its note');
  assertArr(takeUnappliedNotes('tA'), ['only A'], "A drains only A's note");
  assertEq(hasUnappliedNotes('tB'), true, "draining A leaves B intact");
  assertArr(takeUnappliedNotes('tB'), ['only B'], "B drains only B's note");

  // ── 6. take/has on never-used thread ───────────────────────────────────
  assertArr(takeUnappliedNotes('never-used'), [], 'take on unknown thread → []');
  assertEq(hasUnappliedNotes('never-used'), false, 'has on unknown thread → false');

  // ── 7. clear a single thread only ──────────────────────────────────────
  clearUnappliedNotes();
  preserveUnappliedNote('c1', 'x');
  preserveUnappliedNote('c2', 'y');
  clearUnappliedNotes('c1');
  assertEq(hasUnappliedNotes('c1'), false, 'clear(threadId) empties that thread');
  assertEq(hasUnappliedNotes('c2'), true, 'clear(threadId) leaves other threads');
  assertArr(takeUnappliedNotes('c2'), ['y'], 'untouched thread still drains');

  // ── 8. clear-all with no arg / explicit undefined ──────────────────────
  clearUnappliedNotes();
  preserveUnappliedNote('z1', 'x');
  preserveUnappliedNote('z2', 'y');
  clearUnappliedNotes();
  assertEq(hasUnappliedNotes('z1'), false, 'clear() empties all threads (z1)');
  assertEq(hasUnappliedNotes('z2'), false, 'clear() empties all threads (z2)');
  preserveUnappliedNote('z3', 'x');
  clearUnappliedNotes(undefined);
  assertEq(hasUnappliedNotes('z3'), false, 'clear(undefined) empties all threads');

  // ── 9. note normalization ──────────────────────────────────────────────
  clearUnappliedNotes();
  preserveUnappliedNote('nrm', '  spaced   out  note  ');
  assertArr(takeUnappliedNotes('nrm'), ['spaced out note'], 'whitespace collapsed + trimmed');
  preserveUnappliedNote('nrm2', '   ');
  assertEq(hasUnappliedNotes('nrm2'), false, 'whitespace-only note is skipped');
  assertArr(takeUnappliedNotes('nrm2'), [], 'skipped note leaves nothing');
  preserveUnappliedNote('nrm3', '');
  assertEq(hasUnappliedNotes('nrm3'), false, 'empty note is skipped');
  preserveUnappliedNote('nrm4', 'x'.repeat(5000));
  const huge = takeUnappliedNotes('nrm4');
  assertEq(huge.length, 1, 'huge note is still stored (bounded)');
  assert(huge[0].length <= 2000, 'huge note clamped to <= 2000 chars', 'len=' + huge[0].length);
  assert(huge[0].length > 0, 'clamped note is non-empty');
  assert(huge[0].endsWith('…'), 'clamped note ends with ellipsis');

  // ── 10. non-string notes are dropped (never stored as noise) ───────────
  clearUnappliedNotes();
  const cycNote: any = { a: 1 };
  cycNote.self = cycNote;
  preserveUnappliedNote('bad', null);
  preserveUnappliedNote('bad', undefined);
  preserveUnappliedNote('bad', 42);
  preserveUnappliedNote('bad', true);
  preserveUnappliedNote('bad', {});
  preserveUnappliedNote('bad', { a: 1 });
  preserveUnappliedNote('bad', [1, 2, 3]);
  preserveUnappliedNote('bad', () => 'x');
  preserveUnappliedNote('bad', cycNote);
  preserveUnappliedNote('bad', Symbol('s'));
  assertEq(hasUnappliedNotes('bad'), false, 'no non-string note was stored');
  assertArr(takeUnappliedNotes('bad'), [], 'thread with only bad notes drains []');

  // ── 11. hostile thread ids are safe no-ops (never throw) ───────────────
  clearUnappliedNotes();
  const cycKey: any = {};
  cycKey.self = cycKey;
  let threw = false;
  try {
    preserveUnappliedNote(null, 'x');
    preserveUnappliedNote(undefined, 'x');
    preserveUnappliedNote({}, 'x');
    preserveUnappliedNote([], 'x');
    preserveUnappliedNote(cycKey, 'x');
    preserveUnappliedNote(Symbol('t'), 'x');
    preserveUnappliedNote(() => 'x', 'x');
    preserveUnappliedNote('', 'x');
    preserveUnappliedNote('   ', 'x');
    preserveUnappliedNote(NaN, 'x');
    preserveUnappliedNote(Infinity, 'x');
  } catch {
    threw = true;
  }
  assert(!threw, 'preserve with hostile thread ids never throws');
  assertEq(hasUnappliedNotes(''), false, 'empty-string id stored nothing');
  assertEq(hasUnappliedNotes('   '), false, 'whitespace id stored nothing');
  assertEq(hasUnappliedNotes(null), false, 'has(null) → false');
  assertEq(hasUnappliedNotes(undefined), false, 'has(undefined) → false');
  assertEq(hasUnappliedNotes({}), false, 'has(object) → false');
  assertEq(hasUnappliedNotes(cycKey), false, 'has(cyclic) → false');
  assertEq(hasUnappliedNotes(Symbol('t')), false, 'has(symbol) → false');

  let threw2 = false;
  try {
    assertArr(takeUnappliedNotes(null), [], 'take(null) → []');
    assertArr(takeUnappliedNotes(undefined), [], 'take(undefined) → []');
    assertArr(takeUnappliedNotes({}), [], 'take(object) → []');
    assertArr(takeUnappliedNotes(cycKey), [], 'take(cyclic) → []');
    assertArr(takeUnappliedNotes(Symbol('t')), [], 'take(symbol) → []');
  } catch {
    threw2 = true;
  }
  assert(!threw2, 'take with hostile thread ids never throws');

  // ── 12. garbage id passed to clear must NOT clear everything ────────────
  clearUnappliedNotes();
  preserveUnappliedNote('keep-me', 'important');
  let threw3 = false;
  try {
    clearUnappliedNotes(null);
    clearUnappliedNotes({});
    clearUnappliedNotes([]);
    clearUnappliedNotes(cycKey);
    clearUnappliedNotes(Symbol('t'));
    clearUnappliedNotes('');
    clearUnappliedNotes('   ');
  } catch {
    threw3 = true;
  }
  assert(!threw3, 'clear with garbage ids never throws');
  assertEq(hasUnappliedNotes('keep-me'), true, 'garbage id to clear() is a no-op, not clear-all');
  assertArr(takeUnappliedNotes('keep-me'), ['important'], 'preserved note survived garbage clears');

  // ── 13. LRU thread cap keeps the store bounded ─────────────────────────
  clearUnappliedNotes();
  const total = 200; // far above the internal thread cap
  for (let i = 0; i < total; i += 1) preserveUnappliedNote('lru' + i, 'note ' + i);
  assertEq(hasUnappliedNotes('lru0'), false, 'oldest thread evicted by LRU cap');
  assertEq(hasUnappliedNotes('lru' + (total - 1)), true, 'newest thread retained');
  assertEq(hasUnappliedNotes('lru1'), false, 'second-oldest thread evicted too');
  clearUnappliedNotes();

  // ── 14. re-preserve after take starts a fresh bucket ───────────────────
  clearUnappliedNotes();
  preserveUnappliedNote('re', 'one');
  assertArr(takeUnappliedNotes('re'), ['one'], 'first drain returns one');
  assertEq(hasUnappliedNotes('re'), false, 'bucket empty after first drain');
  preserveUnappliedNote('re', 'two');
  assertArr(takeUnappliedNotes('re'), ['two'], 'second run has no stale note');

  // ── 15. returned array is detached from the store ──────────────────────
  clearUnappliedNotes();
  preserveUnappliedNote('det', 'a');
  const drained = takeUnappliedNotes('det');
  drained.push('mutated');
  preserveUnappliedNote('det', 'b');
  assertArr(takeUnappliedNotes('det'), ['b'], 'mutating a drained array does not corrupt the store');
  clearUnappliedNotes();

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll steering-note-preservation smoke cases passed (' + passes + ' passed).');
}
main();
