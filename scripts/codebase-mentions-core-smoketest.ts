/**
 * codebase-mentions-core-smoketest — the pure `@file:` / `@symbol:` mention
 * parser + resolver (src/lib/codebaseMentionsCore.ts) behind Cursor-style chat
 * mentions (P4 of docs/CODING_AGENT_UPGRADE_PLAN.md). Load-bearing assertions:
 *
 *   PARSING: `@file:VALUE` + `@symbol:VALUE` found with trailing punctuation
 *   stripped; double-quoted values keep spaces (`@file:"src/my file.ts"`);
 *   mid-word (`x@file:y`) and email-like text ignored; prefix is
 *   case-insensitive but kind is normalized lowercase; dedupe by kind+value
 *   preserving order; cap at MAX_CODEBASE_MENTIONS; non-string input → [].
 *
 *   RESOLUTION: exact path (also `\` vs `/` + case normalized) → 'exact';
 *   unique path-suffix → 'exact', ambiguous suffix → 'fuzzy' shorter-path-first;
 *   basename-without-extension + rankFilesForQuery fallbacks → 'fuzzy'; symbol
 *   exact (matchedSymbol set, path asc) → 'exact', substring → 'fuzzy'; nothing
 *   → 'not_found'; every branch caps at MAX_MATCHES_PER_MENTION; degenerate
 *   file rows are skipped.
 *
 *   DESCRIPTION: one compact line per mention for each status, '' for empty.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (codebaseMentionsCore only imports codebaseIndexCore).
 */

import {
  parseCodebaseMentions,
  resolveCodebaseMentions,
  describeResolvedMentions,
  MAX_CODEBASE_MENTIONS,
  MAX_MATCHES_PER_MENTION,
} from '../src/lib/codebaseMentionsCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Shared indexed-file fixture for the resolution blocks. */
const FILES = [
  { path: 'src/lib/fileEditCore.ts', symbols: ['applyFileEdits', 'planFileEdits'], summary: 'Precise str_replace file editor core.' },
  { path: 'src/lib/shellCommandPolicy.ts', symbols: ['classifyShellCommand'], summary: 'Shell command read/mutate/blocked policy.' },
  { path: 'src/lib/authTokenValidator.ts', symbols: ['authTokenValidator', 'verifyToken'], summary: 'Validates auth tokens and refreshes them.' },
  { path: 'src/a/index.ts', symbols: ['bootA'] },
  { path: 'src/deep/nested/index.ts', symbols: ['bootNested'] },
  { path: 'src/ui/ButtonGroup.tsx', symbols: ['ButtonGroup'], summary: 'Renders a group of buttons.' },
];

function main(): void {
  // ─── (1) parse basic file + symbol mentions ───────────────────────────────
  const m1 = parseCodebaseMentions('look at @file:src/lib/foo.ts and @symbol:applyFileEdits now');
  assertEq(m1.length, 2, '(1) two mentions parsed');
  assertEq(m1[0].kind, 'file', '(1) first mention kind file');
  assertEq(m1[0].value, 'src/lib/foo.ts', '(1) file value parsed');
  assertEq(m1[0].raw, '@file:src/lib/foo.ts', '(1) file raw preserved');
  assertEq(m1[1].kind, 'symbol', '(1) second mention kind symbol');
  assertEq(m1[1].value, 'applyFileEdits', '(1) symbol value parsed');
  assertEq(m1[1].raw, '@symbol:applyFileEdits', '(1) symbol raw preserved');
  // start-of-string mention also parses
  assertEq(parseCodebaseMentions('@file:a.ts first')[0]?.value, 'a.ts', '(1) start-of-string mention parses');

  // ─── (2) quoted values keep spaces ────────────────────────────────────────
  const m2 = parseCodebaseMentions('open @file:"src/my file.ts" and @symbol:"my symbol name" please');
  assertEq(m2.length, 2, '(2) two quoted mentions parsed');
  assertEq(m2[0].value, 'src/my file.ts', '(2) quoted file value keeps the space');
  assertEq(m2[0].raw, '@file:"src/my file.ts"', '(2) quoted raw keeps the quotes');
  assertEq(m2[1].value, 'my symbol name', '(2) quoted symbol value keeps spaces');
  assertEq(parseCodebaseMentions('bad @file:"" here').length, 0, '(2) empty quoted value dropped');

  // ─── (3) trailing punctuation stripped from bare values ───────────────────
  assertEq(parseCodebaseMentions('see @file:foo.ts.')[0]?.value, 'foo.ts', '(3) trailing period stripped');
  assertEq(parseCodebaseMentions('see @file:foo.ts, then')[0]?.value, 'foo.ts', '(3) trailing comma stripped');
  assertEq(parseCodebaseMentions('what about @symbol:doThing?')[0]?.value, 'doThing', '(3) trailing ? stripped');
  assertEq(parseCodebaseMentions('(see @file:baz.ts)')[0]?.value, 'baz.ts', '(3) trailing ) stripped');
  assertEq(parseCodebaseMentions('run @symbol:go!;')[0]?.value, 'go', '(3) punctuation run stripped');
  assertEq(parseCodebaseMentions('see @file:foo.ts.')[0]?.raw, '@file:foo.ts', '(3) raw excludes stripped punctuation');
  assertEq(parseCodebaseMentions('empty @file:... end').length, 0, '(3) all-punctuation value dropped');

  // ─── (4) mid-word / email-like occurrences ignored ────────────────────────
  assertEq(parseCodebaseMentions('x@file:y').length, 0, '(4) mid-word x@file:y ignored');
  assertEq(parseCodebaseMentions('mail chris@file:8080 today').length, 0, '(4) email-like text ignored');
  assertEq(parseCodebaseMentions('9@symbol:foo').length, 0, '(4) digit before @ ignored');
  assertEq(parseCodebaseMentions('see (@file:ok.ts)')[0]?.value, 'ok.ts', '(4) non-alphanumeric char before @ still parses');

  // ─── (5) case-insensitive prefix, kind normalized lowercase ───────────────
  const m5 = parseCodebaseMentions('try @File:Foo.ts and @SYMBOL:BarThing');
  assertEq(m5.length, 2, '(5) mixed-case prefixes parsed');
  assertEq(m5[0].kind, 'file', '(5) @File: kind normalized to file');
  assertEq(m5[0].value, 'Foo.ts', '(5) value case preserved');
  assertEq(m5[1].kind, 'symbol', '(5) @SYMBOL: kind normalized to symbol');
  assertEq(m5[1].value, 'BarThing', '(5) symbol value case preserved');

  // ─── (6) dedupe by kind+value, order preserved ────────────────────────────
  const m6 = parseCodebaseMentions('@file:a.ts then @file:a.ts and @symbol:a.ts and @file:b.ts');
  assertEq(m6.length, 3, '(6) duplicate kind+value deduped');
  assertEq(m6[0].kind + ':' + m6[0].value, 'file:a.ts', '(6) first occurrence kept first');
  assertEq(m6[1].kind + ':' + m6[1].value, 'symbol:a.ts', '(6) same value different kind kept');
  assertEq(m6[2].value, 'b.ts', '(6) later distinct mention kept in order');

  // ─── (7) cap at MAX_CODEBASE_MENTIONS ─────────────────────────────────────
  assertEq(MAX_CODEBASE_MENTIONS, 8, '(7) MAX_CODEBASE_MENTIONS is 8');
  const many = Array.from({ length: 12 }, (_, i) => `@file:f${i}.ts`).join(' ');
  const m7 = parseCodebaseMentions(many);
  assertEq(m7.length, 8, '(7) parse capped at 8 mentions');
  assertEq(m7[0].value, 'f0.ts', '(7) first mention survives the cap');
  assertEq(m7[7].value, 'f7.ts', '(7) 8th mention is the last kept');

  // ─── (8) non-string parse input → [] ──────────────────────────────────────
  assertEq(parseCodebaseMentions(undefined).length, 0, '(8) parse(undefined) → []');
  assertEq(parseCodebaseMentions(null).length, 0, '(8) parse(null) → []');
  assertEq(parseCodebaseMentions(42 as any).length, 0, '(8) parse(number) → []');
  assertEq(parseCodebaseMentions({} as any).length, 0, '(8) parse(object) → []');
  assertEq(parseCodebaseMentions('').length, 0, '(8) parse("") → []');

  // ─── (9) resolve exact path match ─────────────────────────────────────────
  const r9 = resolveCodebaseMentions(
    [{ kind: 'file', raw: '@file:src/lib/fileEditCore.ts', value: 'src/lib/fileEditCore.ts' }],
    FILES,
  );
  assertEq(r9.length, 1, '(9) one resolution per mention');
  assertEq(r9[0].status, 'exact', '(9) exact path → status exact');
  assertEq(r9[0].matches.length, 1, '(9) exact path → single match');
  assertEq(r9[0].matches[0].path, 'src/lib/fileEditCore.ts', '(9) exact path resolved');
  assertEq(r9[0].matches[0].score, 1, '(9) exact path score 1');

  // ─── (10) separator + case normalization ──────────────────────────────────
  const r10 = resolveCodebaseMentions(
    [
      { kind: 'file', raw: 'r', value: 'SRC\\lib\\FILEEDITCORE.TS' },
      { kind: 'file', raw: 'r', value: './src/lib/fileEditCore.ts' },
    ],
    FILES,
  );
  assertEq(r10[0].status, 'exact', '(10) backslash + case normalized → exact');
  assertEq(r10[0].matches[0]?.path, 'src/lib/fileEditCore.ts', '(10) normalized match keeps real path');
  assertEq(r10[1].status, 'exact', '(10) leading ./ normalized → exact');

  // ─── (11) unique suffix → exact; ambiguous suffix → fuzzy shorter-first ───
  const r11 = resolveCodebaseMentions(
    [
      { kind: 'file', raw: 'r', value: 'fileEditCore.ts' },
      { kind: 'file', raw: 'r', value: 'lib/shellCommandPolicy.ts' },
      { kind: 'file', raw: 'r', value: 'index.ts' },
    ],
    FILES,
  );
  assertEq(r11[0].status, 'exact', '(11) unique basename suffix → exact');
  assertEq(r11[0].matches[0]?.path, 'src/lib/fileEditCore.ts', '(11) unique suffix resolved to full path');
  assertEq(r11[0].matches[0]?.score, 1, '(11) unique suffix score 1');
  assertEq(r11[1].status, 'exact', '(11) multi-segment suffix → exact');
  assertEq(r11[1].matches[0]?.path, 'src/lib/shellCommandPolicy.ts', '(11) multi-segment suffix resolved');
  assertEq(r11[2].status, 'fuzzy', '(11) ambiguous suffix → fuzzy');
  assertEq(r11[2].matches.length, 2, '(11) both index.ts candidates returned');
  assertEq(r11[2].matches[0]?.path, 'src/a/index.ts', '(11) shorter path ranked first');
  assertEq(r11[2].matches[1]?.path, 'src/deep/nested/index.ts', '(11) longer path second');

  // ─── (12) basename-without-extension + rank fallback → fuzzy ──────────────
  const r12 = resolveCodebaseMentions(
    [
      { kind: 'file', raw: 'r', value: 'fileEditCore' }, // basename minus ext
      { kind: 'file', raw: 'r', value: 'authToken' }, // rank fallback (symbol/summary hit)
    ],
    FILES,
  );
  assertEq(r12[0].status, 'fuzzy', '(12) basename-without-extension → fuzzy');
  assertEq(r12[0].matches[0]?.path, 'src/lib/fileEditCore.ts', '(12) basename match resolved');
  assertEq(r12[1].status, 'fuzzy', '(12) rank fallback → fuzzy');
  assertEq(r12[1].matches[0]?.path, 'src/lib/authTokenValidator.ts', '(12) rank fallback finds authTokenValidator');
  assert((r12[1].matches[0]?.score ?? 0) > 0, '(12) rank fallback score positive');
  assert((r12[1].matches[0]?.score ?? 1) < 1, '(12) rank fallback score below exact score 1');

  // ─── (13) symbol exact: matchedSymbol + path-asc ordering ─────────────────
  const symFiles = [
    { path: 'zz/late.ts', symbols: ['sharedThing'] },
    { path: 'aa/early.ts', symbols: ['sharedThing', 'other'] },
    ...FILES,
  ];
  const r13 = resolveCodebaseMentions(
    [
      { kind: 'symbol', raw: 'r', value: 'applyfileedits' }, // case-insensitive
      { kind: 'symbol', raw: 'r', value: 'sharedThing' },
    ],
    symFiles,
  );
  assertEq(r13[0].status, 'exact', '(13) case-insensitive exact symbol → exact');
  assertEq(r13[0].matches[0]?.path, 'src/lib/fileEditCore.ts', '(13) symbol resolved to owning file');
  assertEq(r13[0].matches[0]?.matchedSymbol, 'applyFileEdits', '(13) matchedSymbol keeps original casing');
  assertEq(r13[0].matches[0]?.score, 1, '(13) exact symbol score 1');
  assertEq(r13[1].status, 'exact', '(13) multi-file exact symbol → exact');
  assertEq(r13[1].matches.length, 2, '(13) both owning files returned');
  assertEq(r13[1].matches[0]?.path, 'aa/early.ts', '(13) exact symbol files sorted path asc');
  assertEq(r13[1].matches[1]?.path, 'zz/late.ts', '(13) later path second');

  // ─── (14) symbol substring → fuzzy; rank fallback; not_found ──────────────
  const r14 = resolveCodebaseMentions(
    [
      { kind: 'symbol', raw: 'r', value: 'fileedit' }, // substring of applyFileEdits
      { kind: 'symbol', raw: 'r', value: 'shellPolicy' }, // rank fallback via path/summary terms
      { kind: 'symbol', raw: 'r', value: 'zzzqqqxx' }, // nothing anywhere
      { kind: 'file', raw: 'r', value: 'zzzqqqxx.zz' }, // file not_found too
    ],
    FILES,
  );
  assertEq(r14[0].status, 'fuzzy', '(14) symbol substring → fuzzy');
  assertEq(r14[0].matches[0]?.path, 'src/lib/fileEditCore.ts', '(14) substring resolved to owning file');
  assertEq(r14[0].matches[0]?.matchedSymbol, 'applyFileEdits', '(14) substring sets matchedSymbol');
  assertEq(r14[1].status, 'fuzzy', '(14) symbol rank fallback → fuzzy');
  assertEq(r14[1].matches[0]?.path, 'src/lib/shellCommandPolicy.ts', '(14) fallback finds shell policy file');
  assertEq(r14[1].matches[0]?.matchedSymbol, undefined, '(14) rank fallback has no matchedSymbol');
  assertEq(r14[2].status, 'not_found', '(14) unknown symbol → not_found');
  assertEq(r14[2].matches.length, 0, '(14) not_found has empty matches');
  assertEq(r14[3].status, 'not_found', '(14) unknown file → not_found');

  // ─── (15) match cap at MAX_MATCHES_PER_MENTION on every branch ────────────
  assertEq(MAX_MATCHES_PER_MENTION, 3, '(15) MAX_MATCHES_PER_MENTION is 3');
  const capFiles = Array.from({ length: 6 }, (_, i) => ({
    path: `src/mod${i}/index.ts`,
    symbols: ['bootAll'],
  }));
  const r15 = resolveCodebaseMentions(
    [
      { kind: 'file', raw: 'r', value: 'index.ts' },
      { kind: 'symbol', raw: 'r', value: 'bootAll' },
    ],
    capFiles,
  );
  assertEq(r15[0].matches.length, 3, '(15) ambiguous file suffix capped at 3');
  assertEq(r15[1].matches.length, 3, '(15) exact symbol matches capped at 3');
  assertEq(r15[1].matches[0]?.path, 'src/mod0/index.ts', '(15) capped symbol matches still path asc');

  // ─── (16) degenerate mention/file rows skipped; determinism ───────────────
  const r16 = resolveCodebaseMentions(
    [
      null,
      42,
      { kind: 'nope', value: 'x' },
      { kind: 'file', value: '' },
      { kind: 'file', value: 'fileEditCore.ts' }, // raw missing → synthesized
    ] as any,
    [null, 7, {}, { path: '' }, { path: 5 }, ...FILES] as any,
  );
  assertEq(r16.length, 1, '(16) only the valid mention resolves');
  assertEq(r16[0].status, 'exact', '(16) valid mention still resolves against valid files');
  assertEq(r16[0].mention.raw, '@file:fileEditCore.ts', '(16) missing raw synthesized from kind+value');
  const againA = JSON.stringify(resolveCodebaseMentions(parseCodebaseMentions('@file:index.ts @symbol:verifyToken'), FILES));
  const againB = JSON.stringify(resolveCodebaseMentions(parseCodebaseMentions('@file:index.ts @symbol:verifyToken'), FILES));
  assertEq(againA, againB, '(16) resolution is deterministic across runs');

  // ─── (17) describeResolvedMentions formatting ─────────────────────────────
  const d17 = describeResolvedMentions(
    resolveCodebaseMentions(
      [
        { kind: 'file', raw: 'r', value: 'fileEditCore.ts' },
        { kind: 'symbol', raw: 'r', value: 'applyFileEdits' },
        { kind: 'file', raw: 'r', value: 'index.ts' },
        { kind: 'file', raw: 'r', value: 'zzzqqqxx.zz' },
      ],
      FILES,
    ),
  );
  const lines17 = d17.split('\n');
  assertEq(lines17.length, 4, '(17) one line per mention');
  assertEq(lines17[0], '@file:fileEditCore.ts → src/lib/fileEditCore.ts (exact)', '(17) exact file line format');
  assertEq(lines17[1], '@symbol:applyFileEdits → src/lib/fileEditCore.ts#applyFileEdits (exact)', '(17) exact symbol line uses path#symbol');
  assertEq(lines17[2], '@file:index.ts → src/a/index.ts, src/deep/nested/index.ts (fuzzy)', '(17) fuzzy multi-match line comma-joined');
  assertEq(lines17[3], '@file:zzzqqqxx.zz → no match in codebase index', '(17) not_found line wording');
  assertEq(describeResolvedMentions([]), '', '(17) empty input → empty string');

  // ─── (18) degenerate / undefined never throws ─────────────────────────────
  try {
    assertEq(parseCodebaseMentions(Symbol('x') as any).length, 0, '(18) parse(symbol) → []');
    assertEq(resolveCodebaseMentions(undefined, undefined).length, 0, '(18) resolve(undefined,undefined) → []');
    assertEq(resolveCodebaseMentions(null, null).length, 0, '(18) resolve(null,null) → []');
    assertEq(resolveCodebaseMentions('nope' as any, 'nope' as any).length, 0, '(18) resolve(string,string) → []');
    assertEq(resolveCodebaseMentions([{ kind: 'file', value: 'a.ts' }], undefined)[0]?.status, 'not_found', '(18) valid mention + no files → not_found');
    assertEq(describeResolvedMentions(undefined), '', '(18) describe(undefined) → ""');
    assertEq(describeResolvedMentions(null), '', '(18) describe(null) → ""');
    assertEq(describeResolvedMentions(42 as any), '', '(18) describe(number) → ""');
    assertEq(describeResolvedMentions([null, 7, {}, { mention: null }, { mention: { kind: 'file', value: '' } }] as any), '', '(18) describe(junk rows) → ""');
    assertEq(
      describeResolvedMentions([{ mention: { kind: 'file', raw: 'r', value: 'x.ts' }, status: 'exact', matches: 'nope' }] as any),
      '@file:x.ts → no match in codebase index',
      '(18) non-array matches treated as no match',
    );
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (18) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll codebase-mentions-core smoke cases passed (${passes} passed).`);
}

main();
