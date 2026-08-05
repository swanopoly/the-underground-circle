/**
 * edge-tool-result-summary-smoketest — the LOCKSTEP guarantee that the v2 edge
 * tool-loop summarizes oversized tool results EXACTLY like the client.
 *
 * Two things are asserted:
 *
 *   LOCKSTEP: the Deno edge mirror
 *   supabase/functions/_shared/tool-result-summary.ts produces byte-for-byte
 *   identical output to the client core src/lib/toolResultSummaryCore.ts for the
 *   same input — short passthrough, a 50k log with error lines in the middle, a
 *   50k single-line blob with no newlines, custom-threshold inputs, and
 *   degenerate values (null/undefined/number/…). The exported tunables match on
 *   both sides. If the two ever diverge this smoke fails, which is the whole
 *   point: the model must see the same thing on the edge and in the client.
 *
 *   CONTINUATION PARITY: supabase/functions/_shared/swanbot-continuation.ts now
 *   SUMMARIZES (head + tail + signal lines) instead of hard-truncating oversized
 *   client tool-result content — the output carries the "…tool result
 *   summarized" marker and NOT the old "[client tool result truncated from N
 *   chars]" marker — while validateSwanBotResumeToolResults still rejects
 *   non-arrays, enforces the 40-count cap, and matches/orders ids.
 *
 * Pure — loads under tsx (both summarizers have zero runtime imports; the
 * continuation only imports the pure Deno mirror). Run:
 *   npx tsx scripts/edge-tool-result-summary-smoketest.ts
 */

import * as core from '../src/lib/toolResultSummaryCore';
import * as edge from '../supabase/functions/_shared/tool-result-summary.ts';
import {
  validateSwanBotResumeToolResults,
  SWANBOT_MAX_CLIENT_TOOL_RESULTS,
  SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS,
} from '../supabase/functions/_shared/swanbot-continuation.ts';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

type Opts = { thresholdChars?: number; headChars?: number; tailChars?: number };

const SUMMARY_MARKER = '…tool result summarized';
const OLD_TRUNCATION_MARKER = 'client tool result truncated from';

/**
 * Assert the edge mirror and the client core agree EXACTLY on `input`/`opts`:
 * identical full ToolResultSummary, identical model-facing text, identical
 * shouldSummarize verdict. Returns the (shared) core result for further checks.
 */
function assertLockstep(input: unknown, opts: Opts | undefined, label: string): core.ToolResultSummary {
  const a = core.summarizeToolResultText(input, opts);
  const b = edge.summarizeToolResultText(input, opts);
  assertEq(JSON.stringify(b), JSON.stringify(a), `${label}: full ToolResultSummary identical (edge == core)`);
  assertEq(edge.summarizeToolResultForModel(input, opts), core.summarizeToolResultForModel(input, opts),
    `${label}: forModel text identical (edge == core)`);
  assertEq(edge.shouldSummarizeToolResult(input, opts?.thresholdChars),
    core.shouldSummarizeToolResult(input, opts?.thresholdChars), `${label}: shouldSummarize identical (edge == core)`);
  return a;
}

/** Build a big multi-line log with scattered error/warning/timeout signal lines. */
function buildBigLinedText(minLen: number): string {
  const lines: string[] = [];
  let i = 0;
  let len = 0;
  while (len < minLen) {
    let line: string;
    if (i % 50 === 0) line = `ERROR: failure at row ${i} — operation timed out and was rejected`;
    else if (i % 31 === 0) line = `warning: resource pool ${i} nearly exhausted`;
    else line = `row ${String(i).padStart(5, '0')}: ordinary log output content padding to add length here`;
    lines.push(line);
    len += line.length + 1;
    i += 1;
  }
  return lines.join('\n');
}

type ContinuationResult = { ok: true; results: Array<{ tool_use_id: string; content: string; is_error?: boolean }> } | { ok: false; error: string };
function assertReject(res: ContinuationResult, pattern: RegExp, label: string): void {
  assert(res.ok === false, `${label}: expected validation rejection`);
  if (res.ok === false) assert(pattern.test(res.error), `${label}: error matches ${pattern}`, res.error);
}

function main(): void {
  // ─── (1) exported tunables match on both sides (lockstep at the constant level) ───
  assertEq(edge.TOOL_RESULT_SUMMARY_THRESHOLD_CHARS, core.TOOL_RESULT_SUMMARY_THRESHOLD_CHARS, '(1) THRESHOLD constant matches');
  assertEq(edge.SUMMARY_HEAD_CHARS, core.SUMMARY_HEAD_CHARS, '(1) HEAD_CHARS constant matches');
  assertEq(edge.SUMMARY_TAIL_CHARS, core.SUMMARY_TAIL_CHARS, '(1) TAIL_CHARS constant matches');
  assertEq(edge.SUMMARY_SIGNAL_LINE_MAX, core.SUMMARY_SIGNAL_LINE_MAX, '(1) SIGNAL_LINE_MAX constant matches');
  assertEq(edge.SUMMARY_SIGNAL_CHARS, core.SUMMARY_SIGNAL_CHARS, '(1) SIGNAL_CHARS constant matches');
  assertEq(edge.TOOL_RESULT_SUMMARY_THRESHOLD_CHARS, 20_000, '(1) THRESHOLD is 20k');

  // ─── (2) short string → passthrough, lockstep ────────────────────────────
  const short = 'error: this stays as-is\nsecond line with failure word\n';
  const r2 = assertLockstep(short, undefined, '(2) short passthrough');
  assertEq(r2.summarized, false, '(2) short input not summarized');
  assertEq(r2.text, short, '(2) short input returned verbatim');

  // ─── (3) 50k log with error lines in the middle → summarized, lockstep ───
  const bigLog = buildBigLinedText(50_000);
  assert(bigLog.length > 20_000, '(3) built log exceeds threshold', String(bigLog.length));
  const r3 = assertLockstep(bigLog, undefined, '(3) 50k log with errors');
  assertEq(r3.summarized, true, '(3) 50k log is summarized');
  assert(r3.signalLineCount > 0, '(3) signal lines surfaced from omitted middle', String(r3.signalLineCount));
  assert(r3.text.includes(SUMMARY_MARKER), '(3) summarized text carries the summary marker');
  assert(r3.text.includes('signal lines from omitted output:'), '(3) summarized text carries a signal block');
  assert(r3.text.length < bigLog.length, '(3) summarized text is shorter than the input');

  // ─── (4) 50k single-line blob, no newlines → hard cuts, no signals, lockstep ───
  const bigBlob = 'a'.repeat(25_000) + 'b'.repeat(25_000); // 50k, zero newlines
  const r4 = assertLockstep(bigBlob, undefined, '(4) 50k no-newline blob');
  assertEq(r4.summarized, true, '(4) no-newline blob is summarized');
  assertEq(r4.signalLineCount, 0, '(4) no signal lines without newlines');
  assert(r4.text.startsWith('a'.repeat(core.SUMMARY_HEAD_CHARS)), '(4) head is a hard cut at HEAD_CHARS');
  assert(r4.text.endsWith('b'.repeat(core.SUMMARY_TAIL_CHARS)), '(4) tail is a hard cut at TAIL_CHARS');

  // ─── (5) custom-threshold inputs → lockstep ──────────────────────────────
  const customOpts: Opts = { thresholdChars: 100, headChars: 70, tailChars: 60 };
  const customInput = [
    'H0 startup error in head region padding padding',
    'H1 head line padding padding padding padding',
    'M0 middle filler padding padding padding',
    'ERROR: middle boom timed out',
    'warning: disk almost full',
    'ERROR: middle boom timed out', // duplicate → deduped
    ...Array.from({ length: 12 }, (_, i) => `M-pad-${i} nothing to see here padding padding`),
    'T0 tail failed marker line padding',
    'T1 tail line ending padding padding',
  ].join('\n');
  const r5 = assertLockstep(customInput, customOpts, '(5) custom-threshold input');
  assertEq(r5.summarized, true, '(5) custom-threshold input summarized');
  // custom-threshold boundary agreement
  assertEq(edge.shouldSummarizeToolResult('x'.repeat(100), 100), core.shouldSummarizeToolResult('x'.repeat(100), 100),
    '(5) exactly-custom-threshold verdict matches (both false)');
  assertEq(edge.shouldSummarizeToolResult('x'.repeat(101), 100), core.shouldSummarizeToolResult('x'.repeat(101), 100),
    '(5) custom-threshold+1 verdict matches (both true)');
  // second custom shape (single-line, custom cuts) also lockstep
  assertLockstep('z'.repeat(300), { thresholdChars: 100, headChars: 40, tailChars: 30 }, '(5b) single-line custom cuts');

  // ─── (6) degenerate inputs never diverge and never throw ─────────────────
  const degenerate: Array<[unknown, string]> = [
    [null, 'null'], [undefined, 'undefined'], [42, 'number'], [true, 'boolean'],
    [{}, 'object'], [[], 'array'], [NaN, 'NaN'],
  ];
  try {
    for (const [value, name] of degenerate) {
      const r = assertLockstep(value, undefined, `(6) degenerate ${name}`);
      assertEq(r.text, '', `(6) degenerate ${name} → empty text`);
      assertEq(r.summarized, false, `(6) degenerate ${name} → summarized:false`);
    }
    // absurd opts fall back to defaults on both sides
    assertLockstep(short, { thresholdChars: NaN, headChars: -5, tailChars: 0 } as Opts, '(6) absurd opts fall back');
    assert(true, '(6) degenerate sweep completed without throwing');
  } catch (err) {
    failures += 1;
    console.error(`FAIL: (6) degenerate input threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── (7) continuation validation still enforced ──────────────────────────
  assertReject(validateSwanBotResumeToolResults(null, ['tool_a']), /array/, '(7) non-array rejected');
  assertReject(validateSwanBotResumeToolResults([], []), /no pending tool ids/, '(7) empty pending rejected');
  assertReject(validateSwanBotResumeToolResults([], ['tool_a']), /missing tool_result id/, '(7) missing result rejected');
  assertReject(validateSwanBotResumeToolResults([{ tool_use_id: 'tool_x', content: '' }], ['tool_a']),
    /unexpected tool_result id: tool_x/, '(7) unexpected id rejected');
  assertReject(validateSwanBotResumeToolResults([
    { tool_use_id: 'tool_a', content: 'one' }, { tool_use_id: 'tool_a', content: 'two' },
  ], ['tool_a']), /duplicate tool_result id: tool_a/, '(7) duplicate result id rejected');
  assertReject(validateSwanBotResumeToolResults([{ content: 'no id' }], ['tool_a']), /include tool_use_id/, '(7) blank id rejected');
  assertReject(validateSwanBotResumeToolResults([], ['tool_a', 'tool_a']), /duplicate pending tool ids/, '(7) duplicate pending id rejected');
  // 40-count cap (pending + results)
  const tooManyPending = Array.from({ length: SWANBOT_MAX_CLIENT_TOOL_RESULTS + 1 }, (_, i) => `tool_${i}`);
  assertReject(validateSwanBotResumeToolResults([], tooManyPending), /too many pending client tool calls/, '(7) too many pending rejected');
  const tooManyResults = Array.from({ length: SWANBOT_MAX_CLIENT_TOOL_RESULTS + 1 }, (_, i) => ({ tool_use_id: `tool_${i}`, content: 'x' }));
  assertReject(validateSwanBotResumeToolResults(tooManyResults, ['tool_0']), /too many toolResults/, '(7) too many results rejected');
  assertEq(SWANBOT_MAX_CLIENT_TOOL_RESULTS, 40, '(7) count cap is 40');
  // matches / orders ids and preserves content
  const okRes = validateSwanBotResumeToolResults([
    { tool_use_id: 'tool_b', content: { ok: true, data: { beta: 2 } }, is_error: true },
    { tool_use_id: 'tool_a', content: '{"ok":true}' },
    { id: 'tool_c', content: 'alias-id' },
  ], ['tool_a', 'tool_b', 'tool_c']);
  assert(okRes.ok === true, '(7) valid batch accepted');
  if (okRes.ok) {
    assertEq(okRes.results.map((r) => r.tool_use_id).join(','), 'tool_a,tool_b,tool_c', '(7) results follow pending id order');
    assertEq(okRes.results[0].content, '{"ok":true}', '(7) short string content preserved verbatim');
    assertEq(okRes.results[1].content, JSON.stringify({ ok: true, data: { beta: 2 } }), '(7) object content normalized to JSON');
    assertEq(okRes.results[1].is_error, true, '(7) is_error preserved');
    assertEq(okRes.results[2].content, 'alias-id', '(7) id alias accepted and content preserved');
  }
  // circular non-string content still falls back safely (no throw, no summary)
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const circRes = validateSwanBotResumeToolResults([{ tool_use_id: 'tool_a', content: circular }], ['tool_a']);
  assert(circRes.ok === true, '(7) circular content still validates');
  if (circRes.ok) assertEq(circRes.results[0].content, '[object Object]', '(7) circular content → safe fallback string');

  // ─── (8) continuation now SUMMARIZES (not hard-truncates) oversized content ───
  const bigContent = buildBigLinedText(30_000);
  assert(bigContent.length > SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS, '(8) content exceeds the legacy cap', String(bigContent.length));
  const sumRes = validateSwanBotResumeToolResults([{ tool_use_id: 'tool_a', content: bigContent }], ['tool_a']);
  assert(sumRes.ok === true, '(8) oversized content validates');
  if (sumRes.ok) {
    const content = sumRes.results[0].content;
    assert(content.includes(SUMMARY_MARKER), '(8) oversized content carries the NEW summary marker');
    assert(!content.includes(OLD_TRUNCATION_MARKER), '(8) oversized content does NOT carry the OLD truncation marker');
    assert(content.includes('signal lines from omitted output:'), '(8) summarized content surfaces signal lines');
    assert(content.length < bigContent.length, '(8) summarized content shorter than input');
    // lockstep THROUGH the continuation: identical to the pure summarizers' output
    assertEq(content, edge.summarizeToolResultForModel(bigContent), '(8) continuation output == edge summarizer output');
    assertEq(content, core.summarizeToolResultForModel(bigContent), '(8) continuation output == core summarizer output');
  }
  // object content over threshold is stringified THEN summarized
  const bigObject = { rows: Array.from({ length: 900 }, (_, i) => ({ i, note: `record ${i} with error timeout padding padding` })) };
  const bigObjectJson = JSON.stringify(bigObject);
  assert(bigObjectJson.length > 20_000, '(8) object stringifies over threshold', String(bigObjectJson.length));
  const objRes = validateSwanBotResumeToolResults([{ tool_use_id: 'tool_a', content: bigObject }], ['tool_a']);
  assert(objRes.ok === true, '(8) oversized object content validates');
  if (objRes.ok) {
    assert(objRes.results[0].content.includes(SUMMARY_MARKER), '(8) oversized object content is summarized');
    assertEq(objRes.results[0].content, edge.summarizeToolResultForModel(bigObjectJson), '(8) object content == summarized JSON');
  }
  // under-threshold string content passes through UNCHANGED (no marker at all)
  const smallContent = 'small tool output with the word error but under threshold';
  const smallRes = validateSwanBotResumeToolResults([{ tool_use_id: 'tool_a', content: smallContent }], ['tool_a']);
  assert(smallRes.ok === true, '(8) small content validates');
  if (smallRes.ok) {
    assertEq(smallRes.results[0].content, smallContent, '(8) under-threshold content unchanged (passthrough)');
    assert(!smallRes.results[0].content.includes(SUMMARY_MARKER), '(8) under-threshold content has no summary marker');
  }

  console.log(`\nedge-tool-result-summary smoketest: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
  process.exit(0);
}

main();
