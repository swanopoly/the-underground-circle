/**
 * diff-hunk-select-core-smoketest — the PURE per-hunk accept/reject code-review
 * primitive (src/lib/diffHunkSelectCore.ts). Load-bearing:
 *   parseUnifiedDiff (single/multi-file, multi-hunk, omitted counts, paths, body),
 *   selectHunks (keep chosen, drop emptied files, out-of-range ignored),
 *   reconstructDiff (round-trip + RECOMPUTED @@ headers + re-sequenced new starts),
 *   summarizeHunks (files/hunks/±), and never-throws on garbage.
 *
 * Pure — loads under tsx (diffHunkSelectCore has zero imports).
 */

import {
  parseUnifiedDiff,
  selectHunks,
  reconstructDiff,
  summarizeHunks,
  type ParsedFileDiff,
} from '../src/lib/diffHunkSelectCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// A single-file, single-hunk diff (3 old lines → 3 new; one '-' one '+').
const SINGLE = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 1111111..2222222 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,3 +1,3 @@ function foo()',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  ' const c = 4;',
  '',
].join('\n');

// Multi-file diff: file A (1 hunk) + file B (2 hunks).
const MULTI = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,2 +1,3 @@',
  ' keep-a',
  '+added-a',
  ' tail-a',
  'diff --git a/b.ts b/b.ts',
  '--- a/b.ts',
  '+++ b/b.ts',
  '@@ -1,2 +1,2 @@',
  ' b-top',
  '-b-old',
  '+b-new',
  '@@ -10,2 +10,3 @@',
  ' b-mid',
  '+b-extra',
  ' b-bot',
  '',
].join('\n');

// Omitted counts: `@@ -1 +1 @@` means one line each side.
const OMITTED = [
  'diff --git a/one.ts b/one.ts',
  '--- a/one.ts',
  '+++ b/one.ts',
  '@@ -1 +1 @@',
  '-old-only',
  '+new-only',
  '',
].join('\n');

function main(): void {
  // ─── (1) parse a single-file single-hunk diff: paths, @@ numbers, body ─────
  const s = parseUnifiedDiff(SINGLE);
  assertEq(s.length, 1, '(1) single file parsed');
  assertEq(s[0].oldPath, 'src/foo.ts', '(1) oldPath from a/ prefix');
  assertEq(s[0].newPath, 'src/foo.ts', '(1) newPath from b/ prefix');
  assertEq(s[0].hunks.length, 1, '(1) one hunk');
  assertEq(s[0].hunks[0].oldStart, 1, '(1) oldStart');
  assertEq(s[0].hunks[0].oldLines, 3, '(1) oldLines');
  assertEq(s[0].hunks[0].newStart, 1, '(1) newStart');
  assertEq(s[0].hunks[0].newLines, 3, '(1) newLines');
  assertEq(s[0].hunks[0].index, 0, '(1) hunk index 0');
  assertEq(s[0].hunks[0].lines.length, 4, '(1) 4 body lines captured');
  assert(s[0].hunks[0].lines[1] === '-const b = 2;', '(1) body keeps leading -');
  assert(s[0].hunks[0].lines[2] === '+const b = 3;', '(1) body keeps leading +');
  assert(s[0].preamble.includes('index 1111111..2222222 100644'), '(1) preamble carries index line');
  assert(s[0].hunks[0].header.includes('function foo()'), '(1) header keeps trailer context');

  // ─── (2) multi-file diff → correct file count + indexed multi-hunk file ────
  const m = parseUnifiedDiff(MULTI);
  assertEq(m.length, 2, '(2) two files parsed');
  assertEq(m[0].newPath, 'a.ts', '(2) file 0 path');
  assertEq(m[1].newPath, 'b.ts', '(2) file 1 path');
  assertEq(m[0].hunks.length, 1, '(2) file A has 1 hunk');
  assertEq(m[1].hunks.length, 2, '(2) file B has 2 hunks');
  assertEq(m[1].hunks[0].index, 0, '(2) file B hunk 0 index');
  assertEq(m[1].hunks[1].index, 1, '(2) file B hunk 1 index');
  assertEq(m[1].hunks[1].oldStart, 10, '(2) second hunk oldStart 10');

  // ─── (3) omitted counts default to 1 ───────────────────────────────────────
  const o = parseUnifiedDiff(OMITTED);
  assertEq(o.length, 1, '(3) omitted-count file parsed');
  assertEq(o[0].hunks[0].oldLines, 1, '(3) omitted oldLines defaults to 1');
  assertEq(o[0].hunks[0].newLines, 1, '(3) omitted newLines defaults to 1');
  assertEq(o[0].hunks[0].oldStart, 1, '(3) omitted oldStart');
  assertEq(o[0].hunks[0].newStart, 1, '(3) omitted newStart');

  // ─── (4) selectHunks keeps only chosen + drops emptied files ────────────────
  // Accept ONLY file B's second hunk (index 1). File A drops entirely.
  const selB1 = selectHunks(m, [{ file: 1, hunk: 1 }]);
  assertEq(selB1.length, 1, '(4) only file B kept');
  assertEq(selB1[0].newPath, 'b.ts', '(4) kept file is b.ts');
  assertEq(selB1[0].hunks.length, 1, '(4) only one hunk kept');
  assertEq(selB1[0].hunks[0].index, 1, '(4) kept hunk is index 1');
  assert(selB1[0].hunks[0].lines.includes('+b-extra'), '(4) kept hunk body intact');

  // Accepting nothing → no files.
  assertEq(selectHunks(m, []).length, 0, '(4) empty selection → no files');
  // Out-of-range picks are ignored (never throws, no phantom files).
  assertEq(selectHunks(m, [{ file: 9, hunk: 0 }]).length, 0, '(4) out-of-range file ignored');
  assertEq(selectHunks(m, [{ file: 0, hunk: 5 }]).length, 0, '(4) out-of-range hunk ignored');

  // Accept BOTH file B hunks → file B with 2 hunks, file A dropped.
  const selBboth = selectHunks(m, [{ file: 1, hunk: 0 }, { file: 1, hunk: 1 }]);
  assertEq(selBboth.length, 1, '(4) file B kept with both hunks');
  assertEq(selBboth[0].hunks.length, 2, '(4) both B hunks present');

  // selectHunks must not mutate the source hunks (deep-ish clone).
  selBboth[0].hunks[0].lines.push('MUTATION');
  assert(!m[1].hunks[0].lines.includes('MUTATION'), '(4) source hunk not mutated by clone');

  // ─── (5) reconstructDiff round-trips a fully-accepted single-hunk diff ─────
  const reSingle = reconstructDiff(selectHunks(s, [{ file: 0, hunk: 0 }]));
  const reSingleParsed = parseUnifiedDiff(reSingle);
  assertEq(reSingleParsed.length, 1, '(5) reconstructed single re-parses to 1 file');
  assertEq(reSingleParsed[0].hunks.length, 1, '(5) 1 hunk survives round-trip');
  assertEq(reSingleParsed[0].hunks[0].oldLines, 3, '(5) recomputed oldLines still 3');
  assertEq(reSingleParsed[0].hunks[0].newLines, 3, '(5) recomputed newLines still 3');
  assert(reSingle.includes('@@ -1,3 +1,3 @@'), '(5) recomputed header matches original counts');
  assert(reSingle.includes('function foo()'), '(5) header trailer preserved');
  assert(reSingle.includes('-const b = 2;') && reSingle.includes('+const b = 3;'), '(5) body preserved');
  assert(reSingle.endsWith('\n'), '(5) output ends with newline');

  // Reconstruct the omitted-count hunk → header re-emits short `@@ -1 +1 @@`.
  const reOmit = reconstructDiff(selectHunks(o, [{ file: 0, hunk: 0 }]));
  assert(reOmit.includes('@@ -1 +1 @@'), '(5) count==1 re-emits short header form');

  // ─── (6) reconstruct RECOMPUTES headers + re-sequences after dropping ──────
  // File B: keep ONLY hunk 0 (a -1/+1 replacement, so net size unchanged).
  const reB0 = reconstructDiff(selectHunks(m, [{ file: 1, hunk: 0 }]));
  assert(reB0.includes('@@ -1,2 +1,2 @@'), '(6) kept replacement hunk header recomputed');
  assert(!reB0.includes('b-extra'), '(6) dropped hunk body gone');

  // Keep BOTH file A hunk (net +1) — verify first hunk header recomputes to +1
  // line on the new side (2 old → 3 new).
  const reA = reconstructDiff(selectHunks(m, [{ file: 0, hunk: 0 }]));
  assert(reA.includes('@@ -1,2 +1,3 @@'), '(6) insertion hunk header recomputed (2→3)');

  // Drop the FIRST hunk of file B, keep the second; new-side start must be
  // re-sequenced from the surviving hunk's original relationship. It re-parses
  // cleanly and the second hunk's counts are recomputed (2 old → 3 new).
  const reBsecond = reconstructDiff(selectHunks(m, [{ file: 1, hunk: 1 }]));
  const reBsecondParsed = parseUnifiedDiff(reBsecond);
  assertEq(reBsecondParsed.length, 1, '(6) surviving-hunk-only patch re-parses');
  assertEq(reBsecondParsed[0].hunks[0].oldLines, 2, '(6) recomputed oldLines for kept 2nd hunk');
  assertEq(reBsecondParsed[0].hunks[0].newLines, 3, '(6) recomputed newLines for kept 2nd hunk');
  assertEq(reBsecondParsed[0].hunks[0].oldStart, 10, '(6) oldStart preserved for kept 2nd hunk');

  // Manually corrupted counts must be OVERWRITTEN by the recomputed body counts.
  const corrupt: ParsedFileDiff[] = [{
    oldPath: 'x.ts', newPath: 'x.ts',
    preamble: ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts'],
    hunks: [{
      index: 0,
      header: '@@ -1,99 +1,99 @@',          // lies: body is actually 2 old / 3 new
      oldStart: 1, oldLines: 99, newStart: 1, newLines: 99,
      lines: [' ctx', '-gone', '+new1', '+new2'],
    }],
  }];
  const reCorrupt = reconstructDiff(corrupt);
  assert(reCorrupt.includes('@@ -1,2 +1,3 @@'), '(6) header recomputed from body, not trusted');
  assert(!reCorrupt.includes(',99'), '(6) bogus 99 counts discarded');

  // Reconstructing a file with zero hunks emits nothing.
  assertEq(reconstructDiff([{ oldPath: 'z', newPath: 'z', preamble: ['x'], hunks: [] }]), '', '(6) hunkless file → empty');

  // ─── (7) summarizeHunks counts files / hunks / ± ────────────────────────────
  assertEq(summarizeHunks(m), '2 files · 3 hunks · +3 -1', '(7) multi-file summary');
  assertEq(summarizeHunks(s), '1 file · 1 hunk · +1 -1', '(7) singular file/hunk wording');
  assertEq(summarizeHunks([]), '0 files · 0 hunks · +0 -0', '(7) empty summary');
  assertEq(summarizeHunks(selectHunks(m, [{ file: 1, hunk: 1 }])), '1 file · 1 hunk · +1 -0', '(7) summary reflects selection');

  // ─── (8) malformed / degenerate input never throws ──────────────────────────
  try {
    assertEq(parseUnifiedDiff('').length, 0, '(8) empty string → []');
    assertEq(parseUnifiedDiff('   \n  \n').length, 0, '(8) whitespace → []');
    assertEq(parseUnifiedDiff('this is not a diff at all\njust prose').length, 0, '(8) garbage prose → []');
    assertEq(parseUnifiedDiff(null as any).length, 0, '(8) null → []');
    assertEq(parseUnifiedDiff(undefined as any).length, 0, '(8) undefined → []');
    assertEq(parseUnifiedDiff(42 as any).length, 0, '(8) non-string → []');
    // A header with no body and truncated input must not crash.
    const truncated = parseUnifiedDiff('diff --git a/t.ts b/t.ts\n@@ -1,2 +1,2 @@\n ctx');
    assertEq(truncated.length, 1, '(8) truncated hunk still parses one file');
    assertEq(truncated[0].hunks[0].lines.length, 1, '(8) truncated hunk keeps its one body line');
    // select / reconstruct / summarize on junk.
    assertEq(selectHunks(null as any, null as any).length, 0, '(8) selectHunks(null,null) → []');
    assertEq(reconstructDiff(null as any), '', '(8) reconstructDiff(null) → ""');
    assert(typeof summarizeHunks(null as any) === 'string', '(8) summarizeHunks(null) → string');
    assert(typeof summarizeHunks([{} as any, null as any]).length === 'number', '(8) summarize tolerates junk file entries');
    reconstructDiff([{ hunks: [null as any], preamble: null as any } as any]);
    passes += 1; // reached here → no throw across degenerate calls
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (8) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  console.log(`\ndiff-hunk-select-core smoke: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main();
