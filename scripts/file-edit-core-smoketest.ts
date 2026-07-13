/**
 * file-edit-core-smoketest — the pure precise-edit engine (src/lib/fileEditCore.ts)
 * behind a Claude-Code-style str_replace/multi-edit tool. Load-bearing assertions:
 * exact-match + UNIQUENESS enforcement (non-unique fails closed), sequential
 * multi-edit, create-mode, no-op/ not-found/ oversize rejection, LITERAL
 * replacement (a `$&`/`$1`/backslash in newString is inserted verbatim, never
 * reinterpreted as a regex backref), and a correct unified diff.
 *
 * Pure — loads under tsx (fileEditCore has zero imports).
 */

import {
  applyFileEdits,
  applyFileEdit,
  computeUnifiedDiff,
  describeFileEdits,
  MAX_EDIT_STRING,
  MAX_EDITS_PER_BATCH,
} from '../src/lib/fileEditCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) single edit, unique match ────────────────────────────────────────
  const r1 = applyFileEdit('const a = 1;\nconst b = 2;\n', 'const b = 2;', 'const b = 3;');
  assert(r1.ok, '(1) single unique edit applies');
  assertEq(r1.content, 'const a = 1;\nconst b = 3;\n', '(1) content updated');
  assertEq(r1.replacements, 1, '(1) one replacement');
  assertEq(r1.created, false, '(1) not a create');

  // ─── (2) sequential multi-edit (edit 2 matches result of edit 1) ──────────
  const r2 = applyFileEdits('a\nb\nc\n', [
    { oldString: 'a', newString: 'X' },
    { oldString: 'X\nb', newString: 'X\nY' }, // only matches AFTER edit 1 turned a→X
  ]);
  assert(r2.ok, '(2) sequential multi-edit applies');
  assertEq(r2.content, 'X\nY\nc\n', '(2) edits applied in order against running result');
  assertEq(r2.editsApplied, 2, '(2) two edits applied');

  // ─── (3) UNIQUENESS: a non-unique oldString fails closed ──────────────────
  const dup = applyFileEdit('x = 1\nx = 1\n', 'x = 1', 'x = 2');
  assertEq(dup.ok, false, '(3) non-unique match rejected (would edit the wrong one)');
  assert(/not unique|2 matches/i.test(dup.error || ''), '(3) error explains non-uniqueness', dup.error);
  assertEq(dup.content, 'x = 1\nx = 1\n', '(3) content unchanged on failure');
  assertEq(dup.errorIndex, 0, '(3) errorIndex points at the offending edit');

  // ─── (4) replaceAll replaces every occurrence ─────────────────────────────
  const all = applyFileEdit('x = 1\nx = 1\n', 'x = 1', 'x = 2', true);
  assert(all.ok, '(4) replaceAll applies');
  assertEq(all.content, 'x = 2\nx = 2\n', '(4) all occurrences replaced');
  assertEq(all.replacements, 2, '(4) two replacements counted');
  // split/join is safe even when newString contains oldString
  const grow = applyFileEdit('xax', 'x', 'xx', true);
  assert(grow.ok && grow.content === 'xxaxx' && grow.replacements === 2, '(4) replaceAll with overlapping-ish replacement is literal (no runaway)', grow.content);

  // ─── (5) not found ────────────────────────────────────────────────────────
  const nf = applyFileEdit('hello world', 'goodbye', 'x');
  assertEq(nf.ok, false, '(5) missing oldString rejected');
  assert(/not found/i.test(nf.error || ''), '(5) error says not found');

  // ─── (6) no-op (old === new) rejected ─────────────────────────────────────
  const noop = applyFileEdit('abc', 'abc', 'abc');
  assertEq(noop.ok, false, '(6) no-op edit rejected');
  assert(/identical|no-op/i.test(noop.error || ''), '(6) error says no-op');

  // ─── (7) create mode: null content + empty oldString ──────────────────────
  const create = applyFileEdits(null, [{ oldString: '', newString: 'brand new file\n' }], { path: 'new.ts' });
  assert(create.ok, '(7) create builds a new file');
  assertEq(create.content, 'brand new file\n', '(7) new content = newString');
  assertEq(create.created, true, '(7) created flag set');
  assert(create.diff.includes('+brand new file'), '(7) create diff shows added line');
  // create must be a single empty-oldString edit
  assertEq((applyFileEdits(null, [{ oldString: '', newString: 'a' }, { oldString: '', newString: 'b' }]) as any).ok, false, '(7) create rejects multiple edits');
  assertEq((applyFileEdits(null, [{ oldString: 'x', newString: 'y' }]) as any).ok, false, '(7) create rejects non-empty oldString');
  // empty oldString on an EXISTING file is rejected
  assertEq((applyFileEdit('existing', '', 'x') as any).ok, false, '(7) empty oldString rejected on existing file');

  // ─── (8) LITERAL replacement — $&/$1/backslash inserted verbatim ──────────
  const lit = applyFileEdit('foo bar baz', 'bar', '$& [$1] \\n end');
  assert(lit.ok, '(8) literal replacement applies');
  assertEq(lit.content, 'foo $& [$1] \\n end baz', '(8) $&/$1/backslash inserted LITERALLY (not regex backrefs)');

  // ─── (9) bounds ───────────────────────────────────────────────────────────
  assertEq((applyFileEdit('x', 'x', 'y'.repeat(MAX_EDIT_STRING + 1)) as any).ok, false, '(9) oversized newString rejected');
  const many = Array.from({ length: MAX_EDITS_PER_BATCH + 1 }, () => ({ oldString: 'a', newString: 'b' }));
  assertEq((applyFileEdits('a', many) as any).ok, false, '(9) too many edits rejected');
  assertEq((applyFileEdits('a', []) as any).ok, false, '(9) empty edit array rejected');
  assertEq((applyFileEdits('a', 'not an array' as any) as any).ok, false, '(9) non-array edits rejected');
  assertEq((applyFileEdits('a', [{ oldString: 1, newString: 'b' }] as any) as any).ok, false, '(9) non-string oldString rejected');

  // ─── (10) unified diff correctness ────────────────────────────────────────
  const diff = computeUnifiedDiff('line1\nline2\nline3\n', 'line1\nLINE2\nline3\n', { path: 'a.ts' });
  assert(diff.includes('@@'), '(10) diff has a hunk header');
  assert(diff.includes('-line2') && diff.includes('+LINE2'), '(10) diff shows the removed + added line');
  assert(diff.includes(' line1'), '(10) diff keeps leading context');
  assertEq(computeUnifiedDiff('same', 'same'), '', '(10) identical inputs → empty diff');
  // multi-edit result carries a diff
  assert(r1.diff.includes('-const b = 2;') && r1.diff.includes('+const b = 3;'), '(10) result diff reflects the edit');

  // ─── (11) describe + degenerate never-throws ──────────────────────────────
  assert(describeFileEdits([{ oldString: '', newString: 'x' }], { path: 'n.ts' }).toLowerCase().includes('create'), '(11) describe names create');
  assert(describeFileEdits([{ oldString: 'a', newString: 'b' }, { oldString: 'c', newString: 'd' }]).includes('2'), '(11) describe counts edits');
  try {
    applyFileEdits(undefined, undefined as any);
    applyFileEdits(null, null as any);
    applyFileEdit('x', 'x', 'y');
    computeUnifiedDiff('', '');
    describeFileEdits(null);
    describeFileEdits(undefined);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll file-edit-core smoke cases passed (${passes} passed).`);
}

main();
