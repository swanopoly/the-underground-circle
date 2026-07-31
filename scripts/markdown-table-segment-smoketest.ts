/**
 * markdown-table-segment-smoketest — pins the GFM pipe-table support added to
 * the pure block-level markdown segmenter (src/lib/markdownSegmentCore.ts) so
 * chat bubbles render `| a | b |` replies as a real grid instead of raw text.
 *
 * Contract pinned here:
 *   PARSE: ≥2 consecutive lines that start+end with '|' (after trim) where
 *   line 2 is a divider row (cells of only -,:,spaces) become one
 *   {kind:'table', headerCells, rows, align}. Alignment: :-- left, :-: center,
 *   --: right, --- null. Escaped `\|` is a literal pipe inside a cell.
 *   VETOES (stay text/code): pipe rows inside a code fence, a single pipe
 *   line, missing divider, divider/header cell-count mismatch, '=' dividers
 *   (ASCII art), prose with inline pipes.
 *   BOUNDS: columns capped at MARKDOWN_TABLE_MAX_COLUMNS (extra dropped),
 *   body rows capped at MARKDOWN_TABLE_MAX_ROWS with a trailing
 *   '+N more rows' marker row, cells capped at MARKDOWN_TABLE_CELL_MAX.
 *   PRECHECK: hasRenderableMarkdown is true for table-only text and stays
 *   false for divider-less pipe prose; the forward invariant (false ⟹ only
 *   text segments) holds for pipe-bearing non-tables.
 *
 * Pure — loads under tsx (markdownSegmentCore has zero imports).
 */

import {
  segmentMarkdown,
  hasRenderableMarkdown,
  MARKDOWN_TABLE_MAX_COLUMNS,
  MARKDOWN_TABLE_MAX_ROWS,
  MARKDOWN_TABLE_CELL_MAX,
  MARKDOWN_SEGMENT_CONTENT_MAX,
  type MarkdownSegment,
  type MarkdownTableAlign,
} from '../src/lib/markdownSegmentCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

function kinds(segs: MarkdownSegment[]): string {
  return segs.map((s) => s.kind).join(',');
}

/** Shape invariant for any table segment: arrays present + consistent widths. */
function assertTableShape(seg: MarkdownSegment, label: string): void {
  assertEq(seg.kind, 'table', label + ': kind table');
  assert(Array.isArray(seg.headerCells), label + ': headerCells is array');
  assert(Array.isArray(seg.rows), label + ': rows is array');
  assert(Array.isArray(seg.align), label + ': align is array');
  const cols = seg.headerCells?.length ?? 0;
  assert(cols >= 1 && cols <= MARKDOWN_TABLE_MAX_COLUMNS, label + ': column count bounded', String(cols));
  assertEq(seg.align?.length, cols, label + ': align width matches header');
  assert((seg.rows?.length ?? 0) <= MARKDOWN_TABLE_MAX_ROWS + 1, label + ': rows bounded (+marker)', String(seg.rows?.length));
  for (const row of seg.rows ?? []) {
    assertEq(row.length, cols, label + ': row width matches header');
    for (const cell of row) {
      assert(typeof cell === 'string', label + ': cell is string');
      assert(cell.length <= MARKDOWN_TABLE_CELL_MAX, label + ': cell bounded', String(cell.length));
    }
  }
  for (const a of seg.align ?? []) {
    assert(a === 'left' || a === 'center' || a === 'right' || a === null, label + ': align value valid', String(a));
  }
  assert(typeof seg.content === 'string', label + ': content is string');
  assert(seg.content.length <= MARKDOWN_SEGMENT_CONTENT_MAX, label + ': content bounded');
}

function main(): void {
  // (1) basic table
  const basic = segmentMarkdown('| Name | Qty |\n| --- | --- |\n| bolt | 4 |\n| nut | 8 |');
  assertEq(basic.length, 1, 'basic: one segment');
  assertTableShape(basic[0], 'basic');
  assertEq(JSON.stringify(basic[0].headerCells), '["Name","Qty"]', 'basic: header cells');
  assertEq(JSON.stringify(basic[0].rows), '[["bolt","4"],["nut","8"]]', 'basic: body rows');
  assertEq(JSON.stringify(basic[0].align), '[null,null]', 'basic: plain divider -> null align');

  // (2) table embedded between text keeps order
  const embedded = segmentMarkdown('Spec sheet:\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nDone.');
  assertEq(kinds(embedded), 'text,table,text', 'embedded: text,table,text in order');
  assertEq(embedded[0].content, 'Spec sheet:', 'embedded: leading text');
  assertEq(embedded[2].content, 'Done.', 'embedded: trailing text');

  // (3) alignment row variants (single-dash divider allowed; colon fringe)
  const aligned = segmentMarkdown('| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |');
  assertTableShape(aligned[0], 'aligned');
  assertEq(
    JSON.stringify(aligned[0].align),
    '["left","center","right",null]',
    'aligned: :-- left, :-: center, --: right, --- null',
  );
  const tight = segmentMarkdown('|a|b|\n|:-|-:|\n|1|2|');
  assertTableShape(tight[0], 'tight (no spaces)');
  assertEq(JSON.stringify(tight[0].align), '["left","right"]', 'tight: minimal :- / -: cells');
  assertEq(JSON.stringify(tight[0].headerCells), '["a","b"]', 'tight: cells trimmed');

  // (4) short rows padded, long rows truncated to header width
  const ragged = segmentMarkdown('| a | b | c |\n| - | - | - |\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |');
  assertTableShape(ragged[0], 'ragged');
  assertEq(JSON.stringify(ragged[0].rows?.[0]), '["1","",""]', 'ragged: short row padded');
  assertEq(JSON.stringify(ragged[0].rows?.[1]), '["1","2","3"]', 'ragged: long row truncated');

  // (5) escaped \| is a literal pipe inside a cell
  const escaped = segmentMarkdown('| a \\| b | c |\n| --- | --- |\n| d \\| e | f |');
  assertTableShape(escaped[0], 'escaped');
  assertEq(JSON.stringify(escaped[0].headerCells), '["a | b","c"]', 'escaped: header keeps literal pipe');
  assertEq(JSON.stringify(escaped[0].rows), '[["d | e","f"]]', 'escaped: row keeps literal pipe');

  // (6) header-only table (zero body rows) is still a table
  const headerOnly = segmentMarkdown('| col |\n| --- |');
  assertTableShape(headerOnly[0], 'header-only');
  assertEq(headerOnly[0].rows?.length, 0, 'header-only: zero body rows');

  // (7) CRLF input parses identically
  const crlf = segmentMarkdown('| a |\r\n| - |\r\n| 1 |');
  assertTableShape(crlf[0], 'crlf');
  assertEq(JSON.stringify(crlf[0].rows), '[["1"]]', 'crlf: body row parsed');
  assert(!(crlf[0].content ?? '').includes('\r'), 'crlf: no \\r in content');

  // (8) VETO — pipe rows inside a code fence stay code, never table
  const fenced = segmentMarkdown('```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```');
  assertEq(kinds(fenced), 'code', 'fence veto: single code segment');
  assertEq(fenced[0].content, '| a | b |\n| --- | --- |\n| 1 | 2 |', 'fence veto: pipe lines preserved verbatim');

  // (9) VETO — single pipe line (no divider below) is text
  assertEq(kinds(segmentMarkdown('| just one row |')), 'text', 'single pipe line: text');

  // (10) VETO — missing divider is text
  const noDivider = segmentMarkdown('| a | b |\n| c | d |');
  assertEq(kinds(noDivider), 'text', 'missing divider: text');

  // (11) VETO — divider/header cell-count mismatch is text (GFM rule)
  assertEq(kinds(segmentMarkdown('| a | b |\n| --- |')), 'text', 'narrow divider: text');
  assertEq(kinds(segmentMarkdown('| a |\n| --- | --- |')), 'text', 'wide divider: text');

  // (12) VETO — ASCII-art style lines are not dividers
  assertEq(kinds(segmentMarkdown('| x |\n|===|')), 'text', 'equals divider: text');
  assertEq(kinds(segmentMarkdown('|----|\n|    |')), 'text', 'art: blank second row is not a divider');
  assertEq(kinds(segmentMarkdown('+----+\n| ab |\n+----+')), 'text', 'plus-corner box art: text');

  // (13) VETO — prose with inline pipes (no leading/trailing pipe) is text
  assertEq(kinds(segmentMarkdown('a | b\nc | d')), 'text', 'inline pipes without outer pipes: text');

  // (14) divider-looking row in the BODY is just a body row
  const bodyDivider = segmentMarkdown('| a |\n| - |\n| --- |\n| 1 |');
  assertTableShape(bodyDivider[0], 'body-divider');
  assertEq(JSON.stringify(bodyDivider[0].rows), '[["---"],["1"]]', 'body divider row kept as data');

  // (15) column cap — extra columns dropped
  const wideHeader = Array.from({ length: 20 }, (_, i) => 'c' + i);
  const wideSrc =
    '| ' + wideHeader.join(' | ') + ' |\n' +
    '|' + ' --- |'.repeat(20) + '\n' +
    '| ' + wideHeader.map((_, i) => 'v' + i).join(' | ') + ' |';
  const wide = segmentMarkdown(wideSrc);
  assertTableShape(wide[0], 'wide');
  assertEq(wide[0].headerCells?.length, MARKDOWN_TABLE_MAX_COLUMNS, 'wide: columns capped');
  assertEq(wide[0].headerCells?.[0], 'c0', 'wide: first column kept');
  assertEq(wide[0].rows?.[0]?.length, MARKDOWN_TABLE_MAX_COLUMNS, 'wide: rows capped to column cap');

  // (16) row cap — truncation adds one '+N more rows' marker row
  let tallSrc = '| n |\n| - |\n';
  for (let i = 0; i < MARKDOWN_TABLE_MAX_ROWS + 50; i++) tallSrc += '| ' + i + ' |\n';
  const tall = segmentMarkdown(tallSrc);
  assertTableShape(tall[0], 'tall');
  assertEq(tall[0].rows?.length, MARKDOWN_TABLE_MAX_ROWS + 1, 'tall: rows capped + marker');
  assertEq(tall[0].rows?.[MARKDOWN_TABLE_MAX_ROWS]?.[0], '+50 more rows', 'tall: marker cell text');
  assertEq(tall[0].rows?.[MARKDOWN_TABLE_MAX_ROWS - 1]?.[0], String(MARKDOWN_TABLE_MAX_ROWS - 1), 'tall: last kept row');
  // truncated tail must NOT leak into a following text segment
  assertEq(kinds(tall), 'table', 'tall: overflow rows consumed, no trailing text');

  // (17) giant cell capped with '…'
  const bigCell = segmentMarkdown('| ' + 'x'.repeat(1000) + ' |\n| --- |\n| ' + 'y'.repeat(1000) + ' |');
  assertTableShape(bigCell[0], 'big cell');
  assertEq(bigCell[0].headerCells?.[0]?.length, MARKDOWN_TABLE_CELL_MAX, 'big cell: header capped');
  assert((bigCell[0].headerCells?.[0] ?? '').endsWith('…'), 'big cell: truncation marked');
  assertEq(bigCell[0].rows?.[0]?.[0]?.length, MARKDOWN_TABLE_CELL_MAX, 'big cell: body capped');

  // (18) hasRenderableMarkdown — table-only text is now true
  assert(hasRenderableMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |'), 'precheck: basic table detected');
  assert(hasRenderableMarkdown('| a |\n| - |'), 'precheck: minimal header+divider detected');
  assert(hasRenderableMarkdown('|a|b|\n|:-|-:|'), 'precheck: tight aligned divider detected');
  assert(hasRenderableMarkdown('prose first\n| a |\n| - |'), 'precheck: table after prose detected');
  assert(hasRenderableMarkdown('| a |\r\n| - |'), 'precheck: CRLF table detected');
  // negatives (no other markdown cues present)
  assert(!hasRenderableMarkdown('| a | b |\n| c | d |'), 'precheck: divider-less pipes stay false');
  assert(!hasRenderableMarkdown('| just one row |'), 'precheck: single pipe line stays false');
  assert(!hasRenderableMarkdown('a | b and c | d in prose'), 'precheck: inline pipes stay false');

  // (19) invariants — every emitted table is detectable (reverse), and
  // pipe-bearing text that stays false segments to text only (forward)
  const tableProbes = [
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '| a |\n| - |',
    '|a|b|\n|:-:|---|',
    '| a \\| b |\n| --- |',
  ];
  for (const p of tableProbes) {
    const segs = segmentMarkdown(p);
    if (segs.some((s) => s.kind === 'table')) {
      assert(hasRenderableMarkdown(p), 'reverse invariant: emitted table detectable', JSON.stringify(p));
    } else {
      assert(false, 'table probe should emit a table', JSON.stringify(p));
    }
  }
  const pipeTextProbes = [
    '| a | b |',
    '| a | b |\n| c | d |',
    'x | y prose',
    '|| \nnothing here',
  ];
  for (const p of pipeTextProbes) {
    if (!hasRenderableMarkdown(p)) {
      const segs = segmentMarkdown(p);
      assert(segs.every((s) => s.kind === 'text'), 'forward invariant: false ⟹ text only', p + ' -> ' + kinds(segs));
    } else {
      assert(true, 'pipe probe read as markdown (skipped)');
    }
  }

  // (20) determinism + hostile pipe input never throws, stays bounded
  const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  assertEq(JSON.stringify(segmentMarkdown(doc)), JSON.stringify(segmentMarkdown(doc)), 'deterministic across calls');
  const hostile = [
    '|'.repeat(10_000),
    ('| a |\n| - |\n').repeat(5000),
    '| ' + '\\|'.repeat(2000) + ' |\n| --- |',
    '|\n|\n|\n| - |',
    '| a |\n| - |\n' + '| x |\n'.repeat(50_000),
  ];
  for (const input of hostile) {
    try {
      const out = segmentMarkdown(input);
      assert(Array.isArray(out), 'hostile: returns array');
      for (const s of out) {
        if (s.kind === 'table') assertTableShape(s, 'hostile table');
      }
      assertEq(typeof hasRenderableMarkdown(input), 'boolean', 'hostile: precheck returns boolean');
    } catch (e) {
      assert(false, 'hostile pipe input does not throw', String(e));
    }
  }

  // (21) non-table segments never carry table fields
  const mixedDoc = segmentMarkdown('# H\n| a |\n| - |\n- bullet');
  assertEq(kinds(mixedDoc), 'heading,table,bullet', 'mixed: heading,table,bullet order');
  for (const s of mixedDoc) {
    if (s.kind !== 'table') {
      assertEq(s.headerCells, undefined, 'non-table: no headerCells (' + s.kind + ')');
      assertEq(s.rows, undefined, 'non-table: no rows (' + s.kind + ')');
      assertEq(s.align, undefined, 'non-table: no align (' + s.kind + ')');
    }
  }

  // (22) exported bounds are sane
  assert(MARKDOWN_TABLE_MAX_COLUMNS >= 6 && MARKDOWN_TABLE_MAX_COLUMNS <= 24, 'column cap ~12');
  assert(MARKDOWN_TABLE_MAX_ROWS >= 50 && MARKDOWN_TABLE_MAX_ROWS <= 500, 'row cap ~100');
  assert(MARKDOWN_TABLE_CELL_MAX >= 100, 'cell cap generous');
  const alignSample: MarkdownTableAlign = null;
  assert(alignSample === null, 'MarkdownTableAlign type exported');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll markdown table segment smoke cases passed (' + passes + ' passed).');
}

main();
