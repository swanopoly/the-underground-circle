/**
 * markdown-segment-core-smoketest — pins the pure block-level markdown
 * segmenter (src/lib/markdownSegmentCore.ts) that lets SwanBot chat bubbles
 * style the model's answer instead of dumping raw ``` fences, `#` headings,
 * `-`/`1.` bullets, and `>` quotes into one <Text>. Load-bearing assertions:
 *
 *   SEGMENT (segmentMarkdown): plain text → one coalesced {kind:'text'};
 *   fenced code (```lang … ```) → {kind:'code', lang, content=inner} with the
 *   fences stripped and inner text/indentation/newlines preserved; a fence with
 *   no info string → lang undefined; an UNCLOSED fence → the rest is code;
 *   ATX headings #..###### → {kind:'heading', level, content} (7 hashes and
 *   `#nospace` are NOT headings; a trailing `##` is stripped); bullet lines
 *   -,*,+ and `N.`/`N)` → one {kind:'bullet', content} each with the marker
 *   dropped (`---` and `**bold**` lines are not bullets); consecutive `>` lines
 *   → one coalesced {kind:'quote'} with `> ` stripped; a MIXED document keeps
 *   segment ORDER; CRLF is normalized (no stray \r reaches content).
 *
 *   PRECHECK (hasRenderableMarkdown): a fence, heading, bullet, ordered item,
 *   blockquote, or `**bold**` → true; ordinary prose and non-strings → false.
 *
 *   BOUNDS: ≤ MARKDOWN_SEGMENT_MAX segments and every content ≤
 *   MARKDOWN_SEGMENT_CONTENT_MAX chars, even for megabyte / 500-bullet /
 *   giant-code-block input; non-string / empty / whitespace-only → [].
 *
 *   And: deterministic, fresh array per call, and every export is total —
 *   degenerate/hostile input never throws and always returns the safe shape.
 *
 * Pure — loads under tsx (markdownSegmentCore has zero imports).
 */

import {
  segmentMarkdown,
  hasRenderableMarkdown,
  MARKDOWN_SEGMENT_MAX,
  MARKDOWN_SEGMENT_CONTENT_MAX,
  type MarkdownSegment,
  type MarkdownSegmentKind,
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

const VALID_KINDS: MarkdownSegmentKind[] = ['text', 'code', 'heading', 'bullet', 'quote', 'table'];

function noThrow(label: string, fn: () => unknown): void {
  try {
    fn();
    assert(true, label + ' does not throw');
  } catch (e) {
    assert(false, label + ' does not throw', String(e));
  }
}

/** Invariant sweep: shape/kind/bounds hold for any produced segment array. */
function assertValidSegments(segs: MarkdownSegment[], label: string): void {
  assert(Array.isArray(segs), label + ': is array');
  assert(segs.length <= MARKDOWN_SEGMENT_MAX, label + ': <= MAX segments', 'len ' + segs.length);
  for (const s of segs) {
    assert(s !== null && typeof s === 'object', label + ': segment is object');
    assert((VALID_KINDS as string[]).includes(s.kind), label + ': valid kind', String(s.kind));
    assert(typeof s.content === 'string', label + ': content is string');
    assert(s.content.length <= MARKDOWN_SEGMENT_CONTENT_MAX, label + ': content bounded', 'len ' + s.content.length);
    if (s.level !== undefined) assert(s.level >= 1 && s.level <= 6, label + ': heading level 1..6', String(s.level));
    if (s.lang !== undefined) assert(typeof s.lang === 'string', label + ': lang is string');
  }
}

function kinds(segs: MarkdownSegment[]): string {
  return segs.map((s) => s.kind).join(',');
}

function main(): void {
  // (1) constants are sane exported bounds
  assertEq(typeof MARKDOWN_SEGMENT_MAX, 'number', 'MARKDOWN_SEGMENT_MAX is number');
  assertEq(typeof MARKDOWN_SEGMENT_CONTENT_MAX, 'number', 'MARKDOWN_SEGMENT_CONTENT_MAX is number');
  assert(MARKDOWN_SEGMENT_MAX >= 100 && MARKDOWN_SEGMENT_MAX <= 1000, 'segment cap ~hundreds');
  assert(MARKDOWN_SEGMENT_CONTENT_MAX >= 1000, 'content cap generous');

  // (2) non-string / empty / whitespace-only → []
  assertEq(JSON.stringify(segmentMarkdown(null)), '[]', 'null -> []');
  assertEq(JSON.stringify(segmentMarkdown(undefined)), '[]', 'undefined -> []');
  assertEq(JSON.stringify(segmentMarkdown(42)), '[]', 'number -> []');
  assertEq(JSON.stringify(segmentMarkdown(true)), '[]', 'boolean -> []');
  assertEq(JSON.stringify(segmentMarkdown({})), '[]', 'object -> []');
  assertEq(JSON.stringify(segmentMarkdown([])), '[]', 'array -> []');
  assertEq(JSON.stringify(segmentMarkdown('')), '[]', 'empty string -> []');
  assertEq(JSON.stringify(segmentMarkdown('   \n\t  \n ')), '[]', 'whitespace-only -> []');

  // (3) plain text → one coalesced text segment (paragraph spacing preserved)
  const plain = segmentMarkdown('Hello world');
  assertEq(plain.length, 1, 'plain: one segment');
  assertEq(plain[0].kind, 'text', 'plain: kind text');
  assertEq(plain[0].content, 'Hello world', 'plain: content preserved');
  const para = segmentMarkdown('Para one\n\nPara two');
  assertEq(para.length, 1, 'two paragraphs: one text segment');
  assertEq(para[0].content, 'Para one\n\nPara two', 'blank line between paragraphs kept');
  const squished = segmentMarkdown('A\n\n\n\n\nB');
  assertEq(squished[0].content, 'A\n\nB', 'runs of 3+ blank lines collapsed to one');

  // (4) fenced code block with language
  const codeDoc = segmentMarkdown('Before text\n```ts\nconst x = 1;\nconst y = 2;\n```\nAfter text');
  assertEq(kinds(codeDoc), 'text,code,text', 'code doc: text/code/text in order');
  assertEq(codeDoc[0].content, 'Before text', 'code doc: leading text');
  assertEq(codeDoc[1].kind, 'code', 'code doc: middle is code');
  assertEq(codeDoc[1].lang, 'ts', 'code doc: lang captured');
  assertEq(codeDoc[1].content, 'const x = 1;\nconst y = 2;', 'code doc: inner preserved, fences stripped');
  assert(!codeDoc[1].content.includes('```'), 'code content has no backtick fence');
  assertEq(codeDoc[2].content, 'After text', 'code doc: trailing text');

  // (5) fence with no info string → lang undefined; indentation preserved
  const noLang = segmentMarkdown('```\n  indented();\nplain();\n```');
  assertEq(noLang.length, 1, 'no-lang fence: single segment');
  assertEq(noLang[0].kind, 'code', 'no-lang fence: code');
  assertEq(noLang[0].lang, undefined, 'no-lang fence: lang undefined');
  assertEq(noLang[0].content, '  indented();\nplain();', 'no-lang fence: inner indentation preserved');

  // (6) UNCLOSED fence → the rest of the input is code
  const unclosed = segmentMarkdown('intro\n```js\nlet a = 1;\nlet b = 2;');
  assertEq(kinds(unclosed), 'text,code', 'unclosed fence: text then code');
  assertEq(unclosed[1].lang, 'js', 'unclosed fence: lang captured');
  assertEq(unclosed[1].content, 'let a = 1;\nlet b = 2;', 'unclosed fence: everything after treated as code');

  // (7) ATX headings
  const h1 = segmentMarkdown('# Title');
  assertEq(h1[0].kind, 'heading', 'h1: kind heading');
  assertEq(h1[0].level, 1, 'h1: level 1');
  assertEq(h1[0].content, 'Title', 'h1: content without hashes');
  assert(!h1[0].content.includes('#'), 'h1: no leading hash in content');
  const h6 = segmentMarkdown('###### Deep');
  assertEq(h6[0].level, 6, 'h6: level 6');
  assertEq(h6[0].content, 'Deep', 'h6: content');
  const h7 = segmentMarkdown('####### TooDeep');
  assertEq(h7[0].kind, 'text', '7 hashes is not a heading (text)');
  assertEq(h7[0].content, '####### TooDeep', '7-hash line kept as raw text');
  const noSpace = segmentMarkdown('#nospace');
  assertEq(noSpace[0].kind, 'text', '#nospace is not a heading');
  const closingHashes = segmentMarkdown('## Middle ##');
  assertEq(closingHashes[0].kind, 'heading', 'closing-hash heading recognized');
  assertEq(closingHashes[0].content, 'Middle', 'trailing ## stripped from heading');

  // (8) bullets: -, *, +, ordered N. / N) — one segment each, marker dropped
  const dash = segmentMarkdown('- buy milk');
  assertEq(dash[0].kind, 'bullet', 'dash bullet');
  assertEq(dash[0].content, 'buy milk', 'dash bullet content (marker dropped)');
  assert(dash[0].content[0] !== '-', 'dash bullet: no leading marker');
  assertEq(segmentMarkdown('* star')[0].content, 'star', 'star bullet content');
  assertEq(segmentMarkdown('+ plus')[0].content, 'plus', 'plus bullet content');
  assertEq(segmentMarkdown('1. first')[0].content, 'first', 'ordered "1." bullet content');
  assertEq(segmentMarkdown('2) second')[0].content, 'second', 'ordered "2)" bullet content');
  assertEq(segmentMarkdown('1. first')[0].kind, 'bullet', 'ordered item is a bullet');
  const list = segmentMarkdown('- a\n- b\n- c');
  assertEq(list.length, 3, 'bullet list: one segment per line');
  assertEq(kinds(list), 'bullet,bullet,bullet', 'bullet list: all bullets');
  assertEq(list.map((s) => s.content).join('|'), 'a|b|c', 'bullet list: contents in order');
  const hr = segmentMarkdown('---');
  assertEq(hr[0].kind, 'text', 'horizontal rule --- is not a bullet');
  const boldLine = segmentMarkdown('**bold line**');
  assertEq(boldLine[0].kind, 'text', '**bold** line is not a bullet');

  // (9) blockquotes — consecutive lines coalesced, `> ` stripped
  const q1 = segmentMarkdown('> a wise quote');
  assertEq(q1[0].kind, 'quote', 'quote: kind quote');
  assertEq(q1[0].content, 'a wise quote', 'quote: > marker stripped');
  const q2 = segmentMarkdown('> line one\n> line two');
  assertEq(q2.length, 1, 'multi-line quote coalesced to one segment');
  assertEq(q2[0].content, 'line one\nline two', 'multi-line quote content');
  assert(!q2[0].content.includes('>'), 'quote content has no > marker');

  // (10) mixed document keeps ORDER across every kind
  const mixed = segmentMarkdown(
    '# Title\nIntro paragraph.\n- item a\n- item b\n> a quote\n```js\ncode();\n```\nDone.',
  );
  assertEq(
    kinds(mixed),
    'heading,text,bullet,bullet,quote,code,text',
    'mixed doc: kinds in source order',
  );
  assertEq(mixed[0].content, 'Title', 'mixed: heading content');
  assertEq(mixed[1].content, 'Intro paragraph.', 'mixed: paragraph content');
  assertEq(mixed[5].lang, 'js', 'mixed: code lang');
  assertEq(mixed[5].content, 'code();', 'mixed: code content');
  assertEq(mixed[6].content, 'Done.', 'mixed: trailing text');
  assertValidSegments(mixed, 'mixed doc');

  // (11) CRLF normalization — no stray \r reaches content
  const crlf = segmentMarkdown('a\r\nb');
  assertEq(crlf[0].content, 'a\nb', 'CRLF collapsed to LF in text');
  assert(!crlf[0].content.includes('\r'), 'no carriage return in text content');
  const crlfCode = segmentMarkdown('```\r\nx\r\n```');
  assertEq(crlfCode[0].content, 'x', 'CRLF code content has no \\r');

  // (12) hasRenderableMarkdown — positives
  assert(hasRenderableMarkdown('text\n```\ncode\n```'), 'detects code fence');
  assert(hasRenderableMarkdown('# Heading'), 'detects heading at start');
  assert(hasRenderableMarkdown('intro\n## Sub'), 'detects heading after newline');
  assert(hasRenderableMarkdown('a **bold** b'), 'detects bold');
  assert(hasRenderableMarkdown('- bullet'), 'detects dash bullet');
  assert(hasRenderableMarkdown('1. ordered'), 'detects ordered bullet');
  assert(hasRenderableMarkdown('> quote'), 'detects blockquote');
  assert(hasRenderableMarkdown('line\n+ plus bullet'), 'detects bullet after newline');
  // (12b) hasRenderableMarkdown — negatives
  assert(!hasRenderableMarkdown('just plain words here'), 'plain prose: no markdown');
  assert(!hasRenderableMarkdown('no markdown, just a sentence.'), 'sentence: no markdown');
  assert(!hasRenderableMarkdown('5 apples and 3 pears'), 'numbers in prose: no false bullet');
  assert(!hasRenderableMarkdown('a * b = c'), 'lone asterisk: not bold/bullet');
  assert(!hasRenderableMarkdown(''), 'empty string: false');
  assert(!hasRenderableMarkdown(null), 'null: false');
  assert(!hasRenderableMarkdown(undefined), 'undefined: false');
  assert(!hasRenderableMarkdown(123), 'number: false');
  assert(!hasRenderableMarkdown({ md: '# x' }), 'object: false');
  assertEq(typeof hasRenderableMarkdown('# x'), 'boolean', 'hasRenderableMarkdown returns boolean');

  // (13) determinism + fresh array per call (no shared mutable state)
  assertEq(
    JSON.stringify(segmentMarkdown(mixed as unknown as string)),
    JSON.stringify(segmentMarkdown(mixed as unknown as string)),
    'deterministic (identity re-segment)',
  );
  const doc = '# H\n- a\n- b';
  assertEq(
    JSON.stringify(segmentMarkdown(doc)),
    JSON.stringify(segmentMarkdown(doc)),
    'deterministic across calls',
  );
  const r1 = segmentMarkdown(doc);
  const r2 = segmentMarkdown(doc);
  assert(r1 !== r2, 'each call returns a fresh array');
  r1.push({ kind: 'text', content: 'MUTATED' });
  r1[0].content = 'MUTATED';
  assertEq(segmentMarkdown(doc).length, 3, 'mutating a result does not affect later calls');

  // (14) BOUNDS — huge / many / giant inputs stay capped
  const hugeText = segmentMarkdown('x'.repeat(300_000));
  assertEq(hugeText.length, 1, 'huge single line: one text segment');
  assert(hugeText[0].content.length <= MARKDOWN_SEGMENT_CONTENT_MAX, 'huge text content bounded', 'len ' + hugeText[0].content.length);
  let manyBullets = '';
  for (let i = 0; i < 500; i++) manyBullets += '- item ' + i + '\n';
  const capped = segmentMarkdown(manyBullets);
  assertEq(capped.length, MARKDOWN_SEGMENT_MAX, '500 bullets capped to MARKDOWN_SEGMENT_MAX');
  assertValidSegments(capped, '500 bullets');
  const bigCode = segmentMarkdown('```\n' + 'a\n'.repeat(20_000) + '```');
  assertEq(bigCode.length, 1, 'giant code block: single segment');
  assertEq(bigCode[0].kind, 'code', 'giant code block: kind code');
  assert(bigCode[0].content.length <= MARKDOWN_SEGMENT_CONTENT_MAX, 'giant code content bounded', 'len ' + bigCode[0].content.length);

  // (15) degenerate / hostile input — never throws, always safe shape
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    1,
    NaN,
    Infinity,
    -Infinity,
    true,
    false,
    {},
    [],
    { toString() { return '# x'; } },
    Symbol('s'),
    () => '# x',
    123n,
    '`'.repeat(1000),
    '#'.repeat(1000),
    '>'.repeat(1000),
    '-'.repeat(1000),
    '*'.repeat(1000),
    '```'.repeat(500),
    'a\rb\rc',
    '\x00\x01\x02\x1b[31m',
    '　＃全角\n・emoji 🎉🚀\n',
    '__proto__\nconstructor\nprototype',
    '> '.repeat(1000),
    '1.'.repeat(1000),
    '\n'.repeat(5000),
    'y'.repeat(500_000),
    '```lang' + 'Z'.repeat(200_000),
  ];
  for (const input of hostile) {
    const label = 'segmentMarkdown(' + JSON.stringify(String(typeof input === 'symbol' ? 'symbol' : input)).slice(0, 24) + ')';
    noThrow(label, () => {
      const out = segmentMarkdown(input);
      assert(Array.isArray(out), label + ' returns array');
      assertValidSegments(out, label);
    });
    noThrow('hasRenderableMarkdown hostile', () => {
      assertEq(typeof hasRenderableMarkdown(input), 'boolean', 'hasRenderableMarkdown returns boolean for hostile input');
    });
  }
  // non-string hostile inputs specifically yield []
  assertEq(segmentMarkdown(Symbol('x') as unknown).length, 0, 'symbol -> []');
  assertEq(segmentMarkdown((() => 1) as unknown).length, 0, 'function -> []');
  assertEq(segmentMarkdown(123n as unknown).length, 0, 'bigint -> []');

  // (16) INVARIANT — hasRenderableMarkdown(x) === false ⟹ segmentMarkdown(x)
  //      yields only {kind:'text'} segments, so the caller's raw-<Text> path is
  //      byte-identical for non-markdown. This is the contract the wiring relies
  //      on ("when hasRenderableMarkdown, render segmented; else the old path").
  const plainProbes = [
    'just words',
    'a sentence with punctuation!',
    'email me at a@b.com about 3 items',
    '5 apples, 3 pears, 0 lemons',
    'a * b * c is math, not bold',
    'path/to/file and x=1',
    'multi\nline\nplain\nprose',
    'trailing spaces   \nand more',
    '#nospace and ## alsomid',
    '1.5 is a decimal, not a list',
    'ends with a hash #',
    'contains a lone > greater-than sign inline',
  ];
  for (const p of plainProbes) {
    if (!hasRenderableMarkdown(p)) {
      const segs = segmentMarkdown(p);
      assert(segs.every((s) => s.kind === 'text'), 'invariant: non-markdown stays text-only', p + ' -> ' + kinds(segs));
    } else {
      assert(true, 'invariant probe read as markdown (skipped)');
    }
  }
  // Reverse coverage — every block segment segmentMarkdown emits MUST be
  // detectable by hasRenderableMarkdown (no styled block ever renders raw).
  const blockProbes = [
    '> quote',
    '>  double-spaced quote', // regression: 2+ spaces after '>' still detected
    '>\ttab quote',
    '   > indented quote',
    'lead\r\n> crlf quote', // CRLF-separated block still detected
    'lead\r> cr-only quote', // lone-CR-separated block still detected
    '# H',
    '###### deep',
    '- b',
    '1) ordered',
    '```\ncode\n```',
    '~~~\ncode\n~~~',
    '| a | b |\n| --- | --- |\n| 1 | 2 |', // GFM pipe table (deep coverage: markdown-table-segment-smoketest)
  ];
  for (const p of blockProbes) {
    const segs = segmentMarkdown(p);
    if (segs.some((s) => s.kind !== 'text')) {
      assert(hasRenderableMarkdown(p), 'reverse invariant: emitted block is detectable', JSON.stringify(p));
    } else {
      assert(true, 'reverse probe emitted no block (skipped)');
    }
  }
  // Specific regression: an extra space after '>' must be seen by BOTH halves.
  assert(hasRenderableMarkdown('>  spaced'), 'double-spaced blockquote detected by hasRenderableMarkdown');
  assertEq(segmentMarkdown('>  spaced')[0].kind, 'quote', 'double-spaced blockquote segmented as quote');
  assertEq(segmentMarkdown('>  spaced')[0].content, 'spaced', 'double-spaced blockquote content trimmed');
  // A lone-CR-separated blockquote is detected (segmenter normalizes CR to LF).
  assert(hasRenderableMarkdown('a\r> q'), 'lone-CR blockquote detected by hasRenderableMarkdown');
  assertEq(kinds(segmentMarkdown('a\r> q')), 'text,quote', 'lone-CR blockquote segmented after CR normalization');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll markdownSegmentCore smoke cases passed (' + passes + ' passed).');
}

main();
