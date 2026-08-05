/**
 * tool-result-summary-core-smoketest — the pure deterministic tool-result
 * summarizer (src/lib/toolResultSummaryCore.ts) behind P6 of
 * docs/CODING_AGENT_UPGRADE_PLAN.md (keep a 300KB test log from flooding the
 * model context). Load-bearing assertions:
 *
 *   PASSTHROUGH: at/under threshold the input is returned untouched
 *   (exact identity, summarized:false, omittedChars 0); non-strings never
 *   throw and yield the neutral result.
 *
 *   SUMMARIZATION: over threshold the head and tail are preserved VERBATIM
 *   at both ends, cuts snap to newline boundaries when one is nearby (hard
 *   cut on single-line input), and the marker carries the REAL kept/omitted
 *   numbers (kept first N + last M chars of T; X chars omitted).
 *
 *   SIGNAL LINES: extracted from the omitted MIDDLE only (errors kept in the
 *   head/tail are never duplicated into the block), trimmed, per-line capped
 *   at 300 chars, deduped exact-after-trim, capped at
 *   SUMMARY_SIGNAL_LINE_MAX lines and SUMMARY_SIGNAL_CHARS total.
 *
 *   And: deterministic (same input → identical output), boundary behavior of
 *   shouldSummarizeToolResult (== threshold → false, +1 → true), and every
 *   export is total — degenerate input never throws.
 *
 * Pure — loads under tsx (toolResultSummaryCore has zero runtime imports).
 */

import {
  shouldSummarizeToolResult,
  summarizeToolResultText,
  summarizeToolResultForModel,
  TOOL_RESULT_SUMMARY_THRESHOLD_CHARS,
  SUMMARY_HEAD_CHARS,
  SUMMARY_TAIL_CHARS,
  SUMMARY_SIGNAL_LINE_MAX,
  SUMMARY_SIGNAL_CHARS,
} from '../src/lib/toolResultSummaryCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: split a summarized text into head / marker / signal block / tail. */
function splitSummary(text: string): { head: string; marker: string; block: string; tail: string } | null {
  const mStart = text.indexOf('\n\n[…tool result summarized:');
  if (mStart < 0) return null;
  const mEnd = text.indexOf(']\n', mStart);
  if (mEnd < 0) return null;
  const head = text.slice(0, mStart);
  const marker = text.slice(mStart + 2, mEnd + 1);
  const rest = text.slice(mEnd + 2); // block + '\n\n' + tail (block may be '')
  const sep = rest.indexOf('\n\n');
  if (sep < 0) return null;
  return { head, marker, block: rest.slice(0, sep), tail: rest.slice(sep + 2) };
}
/** Helper: count exact occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return count;
    count += 1;
    from = idx + needle.length;
  }
}

function main(): void {
  // ─── (1) under-threshold passthrough is exact identity ────────────────────
  const small = 'error: this stays as-is\nsecond line with failure word\n';
  const r1 = summarizeToolResultText(small);
  assertEq(r1.text, small, '(1) under-threshold text is the exact input');
  assertEq(r1.summarized, false, '(1) under-threshold summarized:false');
  assertEq(r1.originalChars, small.length, '(1) under-threshold originalChars');
  assertEq(r1.omittedChars, 0, '(1) under-threshold omittedChars 0');
  assertEq(r1.signalLineCount, 0, '(1) under-threshold signalLineCount 0');
  assertEq(summarizeToolResultForModel(small), small, '(1) forModel identity under threshold');

  // ─── (2) shouldSummarizeToolResult boundaries + non-strings ──────────────
  assertEq(shouldSummarizeToolResult('x'.repeat(TOOL_RESULT_SUMMARY_THRESHOLD_CHARS)), false,
    '(2) exactly default threshold → false');
  assertEq(shouldSummarizeToolResult('x'.repeat(TOOL_RESULT_SUMMARY_THRESHOLD_CHARS + 1)), true,
    '(2) default threshold + 1 → true');
  assertEq(shouldSummarizeToolResult('x'.repeat(100), 100), false, '(2) exactly custom threshold → false');
  assertEq(shouldSummarizeToolResult('x'.repeat(101), 100), true, '(2) custom threshold + 1 → true');
  assertEq(shouldSummarizeToolResult(null), false, '(2) null → false');
  assertEq(shouldSummarizeToolResult(undefined), false, '(2) undefined → false');
  assertEq(shouldSummarizeToolResult(12345 as unknown), false, '(2) number → false');
  assertEq(shouldSummarizeToolResult({ length: 999999 } as unknown), false, '(2) object with length → false');

  // ─── (3) main summarization: newline snaps, marker numbers, middle-only signals ───
  const headLines = [
    'H00 startup error in head region', // 32 chars — 'error' kept in HEAD
    'H01 plain head line padding xx',   // 30 chars — newline lands at index 63
    'H02 plain head line padding yy',
    'H03 plain head line padding zz',
  ];
  const middleLines = [
    'M00 plain middle filler line',
    'ERROR: middle boom one',
    'M02 plain middle filler line',
    'warning: disk almost full',
    'ERROR: middle boom one',            // exact duplicate → deduped
    '   Timeout waiting for server   ',  // trims to 'Timeout waiting for server'
    ...Array.from({ length: 10 }, (_, i) => `M-pad-${i} nothing to see here`),
  ];
  const tailLines = [
    'T00 tail failed marker line', // 'failed' kept in TAIL
    'T01 plain tail line ending',
  ];
  const input3 = [...headLines, ...middleLines, ...tailLines].join('\n');
  const r3 = summarizeToolResultText(input3, { thresholdChars: 100, headChars: 70, tailChars: 60 });
  assertEq(r3.summarized, true, '(3) over threshold summarizes');
  assertEq(r3.originalChars, input3.length, '(3) originalChars is input length');
  const parts3 = splitSummary(r3.text);
  assert(parts3 !== null, '(3) summary text parses into head/marker/block/tail');
  if (parts3) {
    // head snapped back to the newline before the cut → first two lines, verbatim
    assertEq(parts3.head, headLines.slice(0, 2).join('\n'), '(3) head is first two full lines verbatim');
    assert(input3.startsWith(parts3.head), '(3) head is a verbatim prefix of the input');
    assertEq(input3[parts3.head.length], '\n', '(3) head cut lands exactly on a newline boundary');
    // tail snapped forward to the next newline → last two lines, verbatim
    assertEq(parts3.tail, tailLines.join('\n'), '(3) tail is last two full lines verbatim');
    assert(input3.endsWith(parts3.tail), '(3) tail is a verbatim suffix of the input');
    assertEq(input3[input3.length - parts3.tail.length - 1], '\n', '(3) tail cut lands right after a newline');
    // marker numbers are the ACTUAL kept/omitted values
    const wantOmitted = input3.length - parts3.head.length - parts3.tail.length;
    assertEq(r3.omittedChars, wantOmitted, '(3) omittedChars = original - head - tail');
    assert(
      parts3.marker.includes(`kept first ${parts3.head.length} + last ${parts3.tail.length} chars of ${input3.length}`),
      '(3) marker carries real kept-first/last/total numbers', parts3.marker,
    );
    assert(parts3.marker.includes(`${wantOmitted} chars omitted`), '(3) marker carries real omitted count');
    assert(parts3.marker.includes('3 signal lines follow'), '(3) marker carries real signal-line count');
    // signal lines: from the omitted middle only, trimmed, deduped, in order
    assertEq(r3.signalLineCount, 3, '(3) exactly 3 signal lines (dup collapsed)');
    assert(parts3.block.startsWith('signal lines from omitted output:\n'), '(3) signal block has the prefix');
    const blockLines3 = parts3.block.split('\n').slice(1);
    assertEq(blockLines3[0], 'ERROR: middle boom one', '(3) signal line 1 in middle order');
    assertEq(blockLines3[1], 'warning: disk almost full', '(3) signal line 2 in middle order');
    assertEq(blockLines3[2], 'Timeout waiting for server', '(3) signal line 3 trimmed');
    assertEq(countOccurrences(parts3.block, 'ERROR: middle boom one'), 1, '(3) duplicate signal deduped');
    assert(!parts3.block.includes('H00 startup error'), '(3) HEAD error line not duplicated into signals');
    assert(!parts3.block.includes('T00 tail failed'), '(3) TAIL failed line not duplicated into signals');
    assert(!parts3.block.includes('filler'), '(3) plain middle lines excluded from signals');
  }
  assert(r3.text.length < input3.length, '(3) summarized text is shorter than the input');
  assertEq(summarizeToolResultForModel(input3, { thresholdChars: 100, headChars: 70, tailChars: 60 }), r3.text,
    '(3) forModel returns the same composed text');

  // ─── (4) signal caps: line count, per-line 300 chars, total chars ─────────
  const capHead = 'head padding line one xxxx'; // 26 chars
  const capTail = 'tail padding line end yyyy'; // 26 chars
  const capOpts = { thresholdChars: 100, headChars: 30, tailChars: 30 };
  // (4a) line-count cap: 60 distinct signal lines → only the first 40 kept
  const input4a = [capHead, ...Array.from({ length: 60 }, (_, i) => `error case ${String(i).padStart(2, '0')} distinct`), capTail].join('\n');
  const r4a = summarizeToolResultText(input4a, capOpts);
  assertEq(r4a.signalLineCount, SUMMARY_SIGNAL_LINE_MAX, '(4a) signal lines capped at SUMMARY_SIGNAL_LINE_MAX');
  const parts4a = splitSummary(r4a.text);
  assert(parts4a !== null, '(4a) capped summary parses');
  if (parts4a) {
    assert(parts4a.block.includes('error case 00 distinct'), '(4a) first signal line kept');
    assert(parts4a.block.includes('error case 39 distinct'), '(4a) 40th signal line kept');
    assert(!parts4a.block.includes('error case 40 distinct'), '(4a) 41st signal line dropped');
    assert(!parts4a.block.includes('error case 59 distinct'), '(4a) last overflow signal line dropped');
  }
  // (4b) per-line 300-char cap + total SUMMARY_SIGNAL_CHARS cap
  const longSignal = (i: number) => `error ${String(i).padStart(2, '0')} ${'x'.repeat(320)}`; // 329 chars each
  const input4b = [capHead, ...Array.from({ length: 30 }, (_, i) => longSignal(i)), capTail].join('\n');
  const r4b = summarizeToolResultText(input4b, capOpts);
  const parts4b = splitSummary(r4b.text);
  assert(parts4b !== null, '(4b) char-capped summary parses');
  if (parts4b) {
    const lines4b = parts4b.block.split('\n').slice(1);
    assertEq(lines4b.length, r4b.signalLineCount, '(4b) block line count matches signalLineCount');
    assert(lines4b.every((l) => l.length === 300), '(4b) every long signal line capped at exactly 300 chars');
    const total4b = lines4b.reduce((sum, l) => sum + l.length, 0);
    assert(total4b <= SUMMARY_SIGNAL_CHARS, '(4b) total signal chars within SUMMARY_SIGNAL_CHARS', String(total4b));
    assertEq(r4b.signalLineCount, Math.floor(SUMMARY_SIGNAL_CHARS / 300), '(4b) char cap binds before line cap');
    assert(r4b.signalLineCount < SUMMARY_SIGNAL_LINE_MAX, '(4b) line cap not the binding constraint here');
  }

  // ─── (5) long single-line input: hard cuts, no signals ────────────────────
  const input5 = 'a'.repeat(150) + 'b'.repeat(150); // 300 chars, zero newlines
  const r5 = summarizeToolResultText(input5, { thresholdChars: 100, headChars: 40, tailChars: 30 });
  assertEq(r5.summarized, true, '(5) single-line over threshold summarizes');
  const parts5 = splitSummary(r5.text);
  assert(parts5 !== null, '(5) single-line summary parses');
  if (parts5) {
    assertEq(parts5.head, 'a'.repeat(40), '(5) hard head cut at exactly headChars');
    assertEq(parts5.tail, 'b'.repeat(30), '(5) hard tail cut at exactly tailChars');
    assert(parts5.marker.includes('kept first 40 + last 30 chars of 300; 230 chars omitted; 0 signal lines follow'),
      '(5) marker numbers exact on hard-cut path', parts5.marker);
    assertEq(parts5.block, '', '(5) no signal block when middle has no signals');
  }
  assertEq(r5.omittedChars, 230, '(5) omittedChars exact');
  assertEq(r5.signalLineCount, 0, '(5) signalLineCount 0');

  // ─── (6) default tunables: just over threshold, hard cuts ─────────────────
  const atThreshold = 'x'.repeat(TOOL_RESULT_SUMMARY_THRESHOLD_CHARS);
  const r6eq = summarizeToolResultText(atThreshold);
  assertEq(r6eq.summarized, false, '(6) exactly threshold-length passes through');
  assertEq(r6eq.text, atThreshold, '(6) exactly threshold-length text identity');
  const overThreshold = 'x'.repeat(TOOL_RESULT_SUMMARY_THRESHOLD_CHARS + 1);
  const r6 = summarizeToolResultText(overThreshold);
  assertEq(r6.summarized, true, '(6) threshold + 1 summarizes with defaults');
  const parts6 = splitSummary(r6.text);
  assert(parts6 !== null, '(6) default-tunable summary parses');
  if (parts6) {
    assertEq(parts6.head.length, SUMMARY_HEAD_CHARS, '(6) default head length (hard cut, no newlines)');
    assertEq(parts6.tail.length, SUMMARY_TAIL_CHARS, '(6) default tail length (hard cut, no newlines)');
  }
  assertEq(r6.omittedChars,
    TOOL_RESULT_SUMMARY_THRESHOLD_CHARS + 1 - SUMMARY_HEAD_CHARS - SUMMARY_TAIL_CHARS,
    '(6) default omittedChars exact');

  // ─── (7) determinism: same input → byte-identical output ─────────────────
  const d1 = summarizeToolResultText(input3, { thresholdChars: 100, headChars: 70, tailChars: 60 });
  const d2 = summarizeToolResultText(input3, { thresholdChars: 100, headChars: 70, tailChars: 60 });
  assertEq(d1.text, d2.text, '(7) repeated run gives identical text');
  assertEq(JSON.stringify(d1), JSON.stringify(d2), '(7) repeated run gives identical full result');
  assertEq(summarizeToolResultText(input4a, capOpts).text, r4a.text, '(7) capped path deterministic too');

  // ─── (8) degenerate inputs never throw ────────────────────────────────────
  try {
    for (const bad of [null, undefined, 42, true, {}, [], Symbol('x'), () => 'x'] as unknown[]) {
      const rb = summarizeToolResultText(bad);
      assertEq(rb.text, '', `(8) non-string ${String(typeof bad)} → empty text`);
      assertEq(rb.summarized, false, `(8) non-string ${String(typeof bad)} → summarized:false`);
      assertEq(rb.originalChars, 0, `(8) non-string ${String(typeof bad)} → originalChars 0`);
      assertEq(summarizeToolResultForModel(bad), '', `(8) forModel non-string ${String(typeof bad)} → ''`);
    }
    const re = summarizeToolResultText('');
    assertEq(re.text, '', '(8) empty string passthrough');
    assertEq(re.summarized, false, '(8) empty string not summarized');
    // absurd opts: NaN / negative / zero fall back to defaults, never throw
    const rWeird = summarizeToolResultText(small, { thresholdChars: NaN, headChars: -5, tailChars: 0 });
    assertEq(rWeird.text, small, '(8) NaN/negative/zero opts fall back to defaults (passthrough)');
    assert(shouldSummarizeToolResult('x'.repeat(50), -1) === false, '(8) negative threshold falls back to default');
    // head + tail cover the whole string → nothing to omit → identity passthrough
    const coverAll = 'z'.repeat(150);
    const rCover = summarizeToolResultText(coverAll, { thresholdChars: 100, headChars: 1000, tailChars: 1000 });
    assertEq(rCover.text, coverAll, '(8) head+tail covering everything → identity');
    assertEq(rCover.summarized, false, '(8) head+tail covering everything → summarized:false');
    const rOverlap = summarizeToolResultText(coverAll, { thresholdChars: 100, headChars: 100, tailChars: 100 });
    assertEq(rOverlap.summarized, false, '(8) partially overlapping head/tail → passthrough, no negative middle');
    assert(true, '(8) degenerate sweep completed without throwing');
  } catch (err) {
    failures += 1;
    console.error(`FAIL: (8) degenerate input threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`\ntool-result-summary-core smoketest: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
  process.exit(0);
}

main();
