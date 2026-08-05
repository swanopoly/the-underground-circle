/**
 * chat-entity-linkify-core-smoketest — the PURE chat entity span detector
 * (src/lib/chatEntityLinkifyCore.ts) that finds the actionable substrings in a
 * bot reply so the renderer (ChatInlineRichText, invoked from ChatTab's
 * renderContent → bodyTextBlock) can wrap each in a Pressable. Load-bearing
 * assertions:
 *
 *   detectChatEntities(text): non-overlapping ChatEntitySpan[] in order of
 *   appearance —
 *     url:      http(s):// links; trailing sentence punctuation trimmed; stops
 *               at whitespace/quotes/brackets; a `#frag` inside a URL stays part
 *               of the URL (never a task ref).
 *     filepath: absolute (`/Users/x`), dot-relative (`./x`, `../a/b.ts`), or a
 *               bare relative WITH a file extension (`src/lib/foo.ts`). Bare
 *               relatives without an extension and non-path slash pairs
 *               (`and/or`, `I/O`, `TCP/IP`, dates `12/25/2026`) are NOT matched.
 *     mention:  `@file:PATH` / `@symbol:NAME` (case-insensitive; quoted values
 *               keep spaces; trailing punctuation stripped; mid-word `x@file:y`
 *               ignored; empty value skipped). target is the arg.
 *     task_ref: `task #<4-8 hex>` (word "task" lets a short id through) or a bare
 *               `#<exactly 8 hex>`. A 6-hex CSS color (`#1a2b3c`) is NOT a ref.
 *   Every span satisfies text.slice(start,end)===span.text; spans never overlap;
 *   output caps at MAX_SPANS (100); input over MAX_TEXT_LEN (100k) is truncated.
 *
 *   splitByEntities(text): alternating plain/entity chunks whose concatenated
 *   `.text` always reconstructs the original string; no empty chunks; entity
 *   chunks carry the span and plain chunks carry entity:null.
 *
 *   And: every export is TOTAL — a non-string / empty / huge / hostile input
 *   yields [] (never throws).
 *
 * Pure — loads under tsx (chatEntityLinkifyCore has zero imports).
 */

import {
  detectChatEntities,
  splitByEntities,
  type ChatEntitySpan,
  type ChatEntityKind,
} from '../src/lib/chatEntityLinkifyCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── helpers ────────────────────────────────────────────────────────────────
function kinds(text: unknown): ChatEntityKind[] {
  return detectChatEntities(text).map((s) => s.kind);
}
function targets(text: unknown): string[] {
  return detectChatEntities(text).map((s) => s.target);
}
function only(text: unknown): ChatEntitySpan | null {
  const s = detectChatEntities(text);
  return s.length === 1 ? s[0] : null;
}
/** The three structural invariants any result must satisfy for a real string. */
function invariantsHold(text: string): boolean {
  const spans = detectChatEntities(text);
  if (spans.length > 100) return false;
  let prevEnd = -1;
  for (const s of spans) {
    if (!(s.start >= 0 && s.end > s.start && s.end <= text.length)) return false; // in-bounds
    if (text.slice(s.start, s.end) !== s.text) return false; // slice invariant
    if (s.start < prevEnd) return false; // non-overlapping + ordered
    if (typeof s.target !== 'string' || s.target.length === 0) return false; // actionable
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) return false;
    prevEnd = s.end;
  }
  return true;
}
/** splitByEntities always reconstructs the original + has no empty chunks. */
function splitReconstructs(text: string): boolean {
  const chunks = splitByEntities(text);
  if (chunks.some((c) => c.text.length === 0)) return false;
  return chunks.map((c) => c.text).join('') === text;
}
/** Never throws + always returns arrays for arbitrary input. */
function totalOn(text: unknown): boolean {
  try {
    return Array.isArray(detectChatEntities(text)) && Array.isArray(splitByEntities(text));
  } catch {
    return false;
  }
}

function main(): void {
  // ─── (1) URLs ──────────────────────────────────────────────────────────────
  {
    const s = only('see https://example.com for docs');
    assert(!!s, '(1) single url detected');
    assertEq(s?.kind, 'url', '(1) kind url');
    assertEq(s?.text, 'https://example.com', '(1) url text');
    assertEq(s?.start, 4, '(1) url start offset');
    assertEq(s?.end, 23, '(1) url end offset');
    assertEq(s?.target, 'https://example.com', '(1) url target === link');
  }
  assertEq(only('visit https://example.com.')?.text, 'https://example.com', '(1) trailing dot trimmed off url');
  assertEq(only('ok https://a.com!!')?.text, 'https://a.com', '(1) trailing bangs trimmed off url');
  assertEq(only('(https://example.com/path)')?.text, 'https://example.com/path', '(1) closing paren not part of url');
  assertEq(only('http://localhost:8081/x')?.target, 'http://localhost:8081/x', '(1) http + port + path kept whole');
  // A #frag that looks like a task id stays part of the URL (one span, url).
  assertJson(kinds('https://x.com/#1a2b3c4d'), ['url'], '(1) #frag stays inside url (not a task ref)');
  assertEq(only('https://x.com/a?b=1#sec')?.end, 23, '(1) query + frag included in url span');
  assertJson(kinds('ftp://nope and file:x'), [], '(1) non-http(s) schemes are not urls');

  // ─── (2) file paths ─────────────────────────────────────────────────────────
  {
    const s = only('open /Users/cswanson/file.ts now');
    assertEq(s?.kind, 'filepath', '(2) absolute path kind');
    assertEq(s?.text, '/Users/cswanson/file.ts', '(2) absolute path text');
    assertEq(s?.start, 5, '(2) absolute path start');
    assertEq(s?.target, '/Users/cswanson/file.ts', '(2) absolute path target');
  }
  assertEq(only('edit src/lib/foo.ts please')?.target, 'src/lib/foo.ts', '(2) bare relative WITH ext is a path');
  assertJson(targets('run ./x and ../lib/y.ts'), ['./x', '../lib/y.ts'], '(2) both dot-relative paths');
  assertEq(only('(see /Users/x/a.ts)')?.text, '/Users/x/a.ts', '(2) trailing paren trimmed off path');
  assertEq(only('file /Users/x/a.ts.')?.text, '/Users/x/a.ts', '(2) trailing dot trimmed off path');
  // Non-path slash pairs must NOT linkify (a false file link is worse than a miss).
  assertJson(kinds('this and/or that'), [], '(2) and/or is not a path');
  assertJson(kinds('the I/O layer'), [], '(2) I/O is not a path');
  assertJson(kinds('over TCP/IP here'), [], '(2) TCP/IP is not a path');
  assertJson(kinds('on 12/25/2026 today'), [], '(2) a date is not a path');
  assertJson(kinds('the src/lib dir'), [], '(2) bare relative WITHOUT ext is not a path');
  assertJson(kinds('no slash here.ts'), [], '(2) a lone filename with no slash is not a path');

  // ─── (3) @file / @symbol mentions ───────────────────────────────────────────
  {
    const s = only('@file:src/lib/foo.ts here');
    assertEq(s?.kind, 'mention', '(3) @file kind mention');
    assertEq(s?.text, '@file:src/lib/foo.ts', '(3) mention text includes prefix');
    assertEq(s?.target, 'src/lib/foo.ts', '(3) mention target is the arg only');
    assertEq(s?.start, 0, '(3) mention start at 0');
  }
  assertEq(only('call @symbol:detectChatEntities now')?.target, 'detectChatEntities', '(3) @symbol target is the name');
  {
    const s = only('@file:"my file.ts" ok');
    assertEq(s?.text, '@file:"my file.ts"', '(3) quoted mention keeps quotes in text');
    assertEq(s?.target, 'my file.ts', '(3) quoted mention target keeps the space');
  }
  assertEq(only('@FILE:x done')?.target, 'x', '(3) prefix is case-insensitive');
  assertJson(kinds('email x@file:y no'), [], '(3) mid-word @file is ignored');
  assertJson(targets('see @symbol:foo, and @file:bar.'), ['foo', 'bar'], '(3) trailing punctuation stripped from both mentions');
  assertJson(kinds('x @file: y'), [], '(3) empty mention value is skipped');
  assertJson(kinds('x @file:"" y'), [], '(3) empty quoted mention value is skipped');

  // ─── (4) task refs + hex boundaries ─────────────────────────────────────────
  {
    const s = only('do task #1a2b now');
    assertEq(s?.kind, 'task_ref', '(4) task ctx kind');
    assertEq(s?.text, '#1a2b', '(4) task span covers the #token only');
    assertEq(s?.target, '1a2b', '(4) task target is the hex without #');
    assertEq(s?.start, 8, '(4) task span starts at the #');
  }
  assertEq(only('task #1a2b3c4d done')?.target, '1a2b3c4d', '(4) 8-hex task ref via context');
  assertEq(only('ref #1a2b3c4d here')?.target, '1a2b3c4d', '(4) bare 8-hex is a task ref');
  assertEq(only('ref #ABCDEF12 here')?.target, 'ABCDEF12', '(4) bare 8-hex uppercase is a task ref');
  assertJson(kinds('color #1a2b3c bg'), [], '(4) 6-hex CSS color is NOT a task ref');
  assertJson(kinds('ref #1a2b3c4 here'), [], '(4) bare 7-hex is not a task ref');
  assertJson(kinds('ref #1a2b3c4d5 here'), [], '(4) bare 9-hex is not a task ref');
  assertJson(kinds('do task #abc now'), [], '(4) context ref below 4 hex is rejected');
  assertEq(only('do task #abcd now')?.target, 'abcd', '(4) context ref at min 4 hex is accepted');
  assertJson(kinds('do task #abcdef123 now'), [], '(4) context ref above 8 hex is rejected (no truncation)');
  assertJson(kinds('x &#1a2b3c4d; y'), [], '(4) &#…; numeric-entity-like text is not a task ref');

  // ─── (5) ordering, nesting, non-overlap (first match wins) ──────────────────
  // A @file: mention CONTAINS a file path; the mention starts first and wins.
  assertJson(kinds('@file:src/lib/foo.ts here'), ['mention'], '(5) mention wins over the path it contains');
  assertEq(detectChatEntities('@file:src/lib/foo.ts here').length, 1, '(5) contained path is dropped (one span)');
  // @symbol: stops at whitespace, so the trailing #hex is a separate task ref.
  assertJson(kinds('@symbol:task #1a2b3c4d'), ['mention', 'task_ref'], '(5) mention then separate task ref');
  assertJson(targets('@symbol:task #1a2b3c4d'), ['task', '1a2b3c4d'], '(5) mention target task + task id');
  {
    const mixed = 'see https://a.com and src/lib/x.ts and task #abcd and @file:y.ts';
    assertJson(kinds(mixed), ['url', 'filepath', 'task_ref', 'mention'], '(5) four kinds emitted in text order');
    assert(invariantsHold(mixed), '(5) mixed input satisfies all span invariants');
  }
  assert(invariantsHold('@file:src/lib/foo.ts here'), '(5) nested case still non-overlapping + slice-exact');

  // ─── (6) splitByEntities ────────────────────────────────────────────────────
  {
    const t = 'see https://a.com and src/lib/x.ts done';
    const chunks = splitByEntities(t);
    assertEq(chunks.map((c) => c.text).join(''), t, '(6) chunks reconstruct the original text');
    assertEq(chunks.filter((c) => c.entity).length, 2, '(6) two entity chunks');
    assert(chunks.every((c) => c.text.length > 0), '(6) no empty chunks');
    const firstEntity = chunks.find((c) => c.entity);
    assertEq(firstEntity?.text, firstEntity?.entity?.text, '(6) entity chunk text === span text');
    assertEq(chunks[0].entity, null, '(6) leading plain chunk carries entity:null');
  }
  {
    // entity at very start → first chunk is the entity (no leading plain chunk).
    const chunks = splitByEntities('@file:x done');
    assert(!!chunks[0].entity, '(6) entity at start is the first chunk');
    assertEq(chunks[0].entity?.kind, 'mention', '(6) leading entity kind');
    assertEq(splitReconstructs('@file:x done'), true, '(6) reconstruct with leading entity');
  }
  {
    // entity at very end → last chunk is the entity (no trailing plain/empty chunk).
    const chunks = splitByEntities('see src/lib/x.ts');
    assert(!!chunks[chunks.length - 1].entity, '(6) entity at end is the last chunk');
    assert(chunks.every((c) => c.text.length > 0), '(6) no trailing empty chunk');
  }
  {
    // plain-only text → exactly one plain chunk.
    const chunks = splitByEntities('just some plain words');
    assertEq(chunks.length, 1, '(6) plain text is a single chunk');
    assertEq(chunks[0].entity, null, '(6) plain chunk entity:null');
    assertEq(chunks[0].text, 'just some plain words', '(6) plain chunk holds whole text');
  }
  assertJson(splitByEntities(''), [], '(6) empty string → []');
  assertJson(splitByEntities(42 as unknown), [], '(6) non-string → []');
  assert(splitReconstructs('a/b and /Users/x/y.ts and @file:z and #1a2b3c4d and https://q.com!'), '(6) rich mix reconstructs exactly');

  // ─── (7) bounds + structural invariants ─────────────────────────────────────
  {
    const huge = 'https://a.com '.repeat(50000);
    const spans = detectChatEntities(huge);
    assertEq(spans.length, 100, '(7) span output capped at MAX_SPANS (100)');
    assert(invariantsHold('https://a.com '.repeat(300)), '(7) many-url input stays invariant');
  }
  {
    // A URL beyond MAX_TEXT_LEN (100k) is truncated away; one within is kept.
    const pad = 'x'.repeat(100001);
    assertEq(detectChatEntities(`${pad} https://late.com`).length, 0, '(7) entity beyond MAX_TEXT_LEN is dropped');
    assertEq(detectChatEntities(`https://early.com ${pad}`).length, 1, '(7) entity within MAX_TEXT_LEN is kept');
  }
  assert(invariantsHold('mix /a/b.ts @symbol:Foo task #dead #deadbeef https://h.io/#frag ./rel.md'), '(7) dense multi-kind line satisfies invariants');
  assertJson(detectChatEntities('nothing actionable here at all'), [], '(7) prose with no entities → []');

  // ─── (8) degenerate / hostile inputs — never throw ──────────────────────────
  try {
    // non-string / nullish primitives → always []
    assertJson(detectChatEntities(undefined), [], '(8) undefined → []');
    assertJson(detectChatEntities(null), [], '(8) null → []');
    assertJson(detectChatEntities(12345), [], '(8) number → []');
    assertJson(detectChatEntities(true), [], '(8) boolean → []');
    assertJson(detectChatEntities(NaN), [], '(8) NaN → []');
    assertJson(detectChatEntities([1, 2, 3]), [], '(8) array → []');
    assertJson(detectChatEntities({ a: 1 }), [], '(8) object → []');
    assertJson(detectChatEntities(() => 'x'), [], '(8) function → []');
    assertJson(detectChatEntities(Symbol('s')), [], '(8) symbol → []');
    assertJson(detectChatEntities(''), [], '(8) empty string → []');

    // hostile / adversarial strings must be TOTAL (no throw, arrays back) and,
    // for real strings, keep the split-reconstruction contract.
    const hostile: string[] = [
      '@@@@@@@@@@',
      '//////////',
      '##########',
      '@file:@file:@file:',
      '@symbol:',
      'https://',
      'http://////',
      '((((()))))',
      '  control chars',
      '🔥💥 emoji /path/\u{1F600}.ts and @file:🚀',
      '‮reversed rtl override',
      'line1\nline2\ttab @file:a\r\n#deadbeef',
      '```code fence https://x.com src/a.ts```',
      'a/'.repeat(5000),
      '/'.repeat(5000),
      'https://' + 'a'.repeat(5000),
      '#'.repeat(5000) + 'deadbeef',
      '\\Windows\\style\\path.txt',
      'C:/win/style.ts',
      'task #'.repeat(3000),
    ];
    for (const h of hostile) {
      assert(totalOn(h), '(8) total (no throw) on hostile input', JSON.stringify(h.slice(0, 24)));
      assert(invariantsHold(h), '(8) invariants hold on hostile input', JSON.stringify(h.slice(0, 24)));
      assert(splitReconstructs(h), '(8) split reconstructs hostile input', JSON.stringify(h.slice(0, 24)));
    }
    // arbitrary non-strings never throw either
    for (const v of [undefined, null, 0, -1, Infinity, {}, [], Symbol.iterator, 9n]) {
      assert(totalOn(v as unknown), '(8) total on arbitrary non-string');
    }
    passes += 1; // reached end of the degenerate group without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (8) degenerate/hostile inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chat-entity-linkify-core smoke cases passed (${passes} passed).`);
}

main();
