/**
 * codebase-index-core-smoketest — the pure codebase-index + relevance-ranking core
 * (src/lib/codebaseIndexCore.ts) behind Cursor-style codebase awareness (P4 of
 * docs/CODING_AGENT_UPGRADE_PLAN.md). Load-bearing assertions:
 *
 *   INDEX PLANNING: vendored/build/VCS dirs (node_modules/.git/dist) ignored as
 *   path segments; the extension allowlist maps to correct language buckets;
 *   files >MAX_FILE_BYTES skipped 'too_large'; lock/minified files
 *   (package-lock.json / *.min.js) skipped 'generated'; MAX_INDEXED_FILES cap
 *   overflow skipped 'cap_exceeded'; deterministic.
 *
 *   QUERY RANKING (lexical, no embeddings): a path/symbol match for
 *   "auth token validation" ranks authTokenValidator.ts ABOVE an unrelated file;
 *   camelCase query tokenization (getUserProfile → get/user/profile) matches;
 *   zero-match files are excluded; ordering is deterministic (score desc, path asc).
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (codebaseIndexCore has zero imports).
 */

import {
  planCodebaseIndex,
  rankFilesForQuery,
  tokenize,
  MAX_FILE_BYTES,
  MAX_INDEXED_FILES,
  IGNORED_DIRS,
  EXTENSION_LANGUAGE,
  DEFAULT_RANK_LIMIT,
} from '../src/lib/codebaseIndexCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: set of paths that ended up in toIndex. */
function indexedPaths(plan: ReturnType<typeof planCodebaseIndex>): Set<string> {
  return new Set(plan.toIndex.map((f) => f.path));
}
/** Helper: the skip reason recorded for a given path (or undefined). */
function skipReason(plan: ReturnType<typeof planCodebaseIndex>, path: string): string | undefined {
  return plan.skipped.find((s) => s.path === path)?.reason;
}

function main(): void {
  // ─── (1) ignored dirs anywhere in the path ────────────────────────────────
  const p1 = planCodebaseIndex([
    { path: 'src/lib/foo.ts' },
    { path: 'node_modules/react/index.js' },
    { path: 'deep/nested/.git/objects/ab/cd' },
    { path: 'app/dist/bundle-out.js' },
    { path: 'a/b/coverage/report.js' },
  ]);
  const kept1 = indexedPaths(p1);
  assert(kept1.has('src/lib/foo.ts'), '(1) normal source file indexed');
  assertEq(skipReason(p1, 'node_modules/react/index.js'), 'ignored_dir', '(1) node_modules skipped ignored_dir');
  assertEq(skipReason(p1, 'deep/nested/.git/objects/ab/cd'), 'ignored_dir', '(1) .git nested skipped ignored_dir');
  assertEq(skipReason(p1, 'app/dist/bundle-out.js'), 'ignored_dir', '(1) dist skipped ignored_dir');
  assertEq(skipReason(p1, 'a/b/coverage/report.js'), 'ignored_dir', '(1) coverage skipped ignored_dir');
  // segment-wise (NOT substring): a dir merely containing "dist" is kept
  const p1b = planCodebaseIndex([{ path: 'src/distributed/queue.ts' }]);
  assert(indexedPaths(p1b).has('src/distributed/queue.ts'), '(1) "distributed" is not treated as "dist" (segment match)');

  // ─── (2) extension allowlist → language buckets ───────────────────────────
  const p2 = planCodebaseIndex([
    { path: 'a.ts' }, { path: 'b.tsx' }, { path: 'c.js' }, { path: 'd.py' },
    { path: 'e.go' }, { path: 'f.rs' }, { path: 'g.rb' }, { path: 'h.cpp' },
    { path: 'i.md' }, { path: 'j.json' }, { path: 'k.yaml' }, { path: 'l.sh' },
    { path: 'weird.xyz' }, { path: 'noext' }, { path: '.gitignore' },
  ]);
  const lang = (path: string) => p2.toIndex.find((f) => f.path === path)?.language;
  assertEq(lang('a.ts'), 'typescript', '(2) .ts → typescript');
  assertEq(lang('b.tsx'), 'typescript', '(2) .tsx → typescript');
  assertEq(lang('c.js'), 'javascript', '(2) .js → javascript');
  assertEq(lang('d.py'), 'python', '(2) .py → python');
  assertEq(lang('e.go'), 'go', '(2) .go → go');
  assertEq(lang('f.rs'), 'rust', '(2) .rs → rust');
  assertEq(lang('g.rb'), 'ruby', '(2) .rb → ruby');
  assertEq(lang('h.cpp'), 'cpp', '(2) .cpp → cpp');
  assertEq(lang('i.md'), 'markdown', '(2) .md → markdown');
  assertEq(lang('j.json'), 'config', '(2) .json → config');
  assertEq(lang('k.yaml'), 'config', '(2) .yaml → config');
  assertEq(lang('l.sh'), 'shell', '(2) .sh → shell');
  assertEq(skipReason(p2, 'weird.xyz'), 'unsupported_ext', '(2) unknown ext skipped unsupported_ext');
  assertEq(skipReason(p2, 'noext'), 'unsupported_ext', '(2) no-extension file skipped unsupported_ext');
  assertEq(skipReason(p2, '.gitignore'), 'unsupported_ext', '(2) dotfile has no extension → unsupported_ext');
  // byLanguage tallies match toIndex
  assertEq(p2.byLanguage.typescript, 2, '(2) byLanguage counts 2 typescript');
  assertEq(p2.byLanguage.config, 2, '(2) byLanguage counts 2 config (.json + .yaml)');
  assertEq(p2.totalIndexed, p2.toIndex.length, '(2) totalIndexed matches toIndex length');

  // ─── (3) too_large ────────────────────────────────────────────────────────
  const p3 = planCodebaseIndex([
    { path: 'small.ts', size: 1000 },
    { path: 'huge.ts', size: MAX_FILE_BYTES + 1 },
    { path: 'edge.ts', size: MAX_FILE_BYTES }, // exactly at limit → kept
  ]);
  assert(indexedPaths(p3).has('small.ts'), '(3) small file indexed');
  assertEq(skipReason(p3, 'huge.ts'), 'too_large', '(3) >MAX_FILE_BYTES skipped too_large');
  assert(indexedPaths(p3).has('edge.ts'), '(3) file exactly at MAX_FILE_BYTES is kept (strict >)');
  // custom threshold honored
  const p3b = planCodebaseIndex([{ path: 'x.ts', size: 100 }], { maxFileBytes: 50 });
  assertEq(skipReason(p3b, 'x.ts'), 'too_large', '(3) custom maxFileBytes honored');

  // ─── (4) generated / lock files ───────────────────────────────────────────
  const p4 = planCodebaseIndex([
    { path: 'package-lock.json' },
    { path: 'yarn.lock' },
    { path: 'pnpm-lock.yaml' },
    { path: 'dir/app.min.js' },
    { path: 'dir/app.js.map' },
    { path: 'dir/vendor.bundle.js' },
    { path: 'src/real.ts' },
  ]);
  assertEq(skipReason(p4, 'package-lock.json'), 'generated', '(4) package-lock.json → generated');
  assertEq(skipReason(p4, 'yarn.lock'), 'generated', '(4) yarn.lock → generated');
  assertEq(skipReason(p4, 'pnpm-lock.yaml'), 'generated', '(4) pnpm-lock.yaml → generated (beats config ext)');
  assertEq(skipReason(p4, 'dir/app.min.js'), 'generated', '(4) *.min.js → generated');
  assertEq(skipReason(p4, 'dir/app.js.map'), 'generated', '(4) *.map → generated');
  assertEq(skipReason(p4, 'dir/vendor.bundle.js'), 'generated', '(4) *.bundle.js → generated');
  assert(indexedPaths(p4).has('src/real.ts'), '(4) real source still indexed alongside generated');

  // ─── (5) cap_exceeded (deterministic overflow) ────────────────────────────
  const many = Array.from({ length: 10 }, (_, i) => ({ path: `f${String(i).padStart(2, '0')}.ts` }));
  const p5 = planCodebaseIndex(many, { maxIndexedFiles: 4 });
  assertEq(p5.totalIndexed, 4, '(5) cap limits totalIndexed to 4');
  assertEq(p5.toIndex.length, 4, '(5) exactly 4 files indexed');
  // deterministic: the FIRST 4 by sorted path are kept, the rest are cap_exceeded
  assertEq(p5.toIndex[0].path, 'f00.ts', '(5) lowest sorted path kept first');
  assertEq(p5.toIndex[3].path, 'f03.ts', '(5) 4th sorted path kept');
  assertEq(skipReason(p5, 'f04.ts'), 'cap_exceeded', '(5) 5th+ path skipped cap_exceeded');
  const capCount = p5.skipped.filter((s) => s.reason === 'cap_exceeded').length;
  assertEq(capCount, 6, '(5) remaining 6 files all cap_exceeded');

  // ─── (6) deterministic planning (same input → identical plan) ─────────────
  const shuffled = [
    { path: 'src/z.ts' }, { path: 'node_modules/x.js' }, { path: 'src/a.ts' },
    { path: 'b.py' }, { path: 'src/z.ts' /* dup ignored */ },
  ];
  const runA = planCodebaseIndex(shuffled);
  const runB = planCodebaseIndex([...shuffled].reverse());
  assertEq(JSON.stringify(runA), JSON.stringify(runB), '(6) planning is order-independent + deterministic');
  // dedupe: src/z.ts appears once
  assertEq(runA.toIndex.filter((f) => f.path === 'src/z.ts').length, 1, '(6) duplicate paths deduped');

  // ─── (7) RANKING: relevant file beats unrelated ───────────────────────────
  const files = [
    { path: 'src/auth/authTokenValidator.ts', symbols: ['authTokenValidator', 'verifyToken'], summary: 'Validates auth tokens and refreshes them.' },
    { path: 'src/ui/ButtonGroup.tsx', symbols: ['ButtonGroup'], summary: 'Renders a group of buttons for the toolbar.' },
    { path: 'src/net/httpClient.ts', symbols: ['httpClient'], summary: 'Low level HTTP client.' },
  ];
  const r7 = rankFilesForQuery('auth token validation', files);
  assert(r7.length >= 1, '(7) at least one file ranked for the query');
  assertEq(r7[0].path, 'src/auth/authTokenValidator.ts', '(7) authTokenValidator ranks #1 for "auth token validation"');
  const buttonRank = r7.find((f) => f.path === 'src/ui/ButtonGroup.tsx');
  assert(!buttonRank, '(7) unrelated ButtonGroup excluded (0 matched terms)');
  // the winner outscores everything else it ranked above
  if (r7.length >= 2) {
    assert(r7[0].score > r7[1].score, '(7) top score strictly beats runner-up', `${r7[0].score} vs ${r7[1].score}`);
  }
  assert(r7[0].matchedTerms.includes('auth') && r7[0].matchedTerms.includes('token'), '(7) matchedTerms records auth + token', JSON.stringify(r7[0].matchedTerms));

  // ─── (8) camelCase query tokenization matches ─────────────────────────────
  assertEq(JSON.stringify(tokenize('getUserProfile')), JSON.stringify(['get', 'user', 'profile']), '(8) camelCase → get/user/profile');
  assertEq(JSON.stringify(tokenize('parse_HTTP_response')), JSON.stringify(['parse', 'http', 'response']), '(8) snake_case + acronym split');
  // letter/digit boundary splits `utf8Decode` at both edges; the lone digit `8`
  // is then dropped by the single-char filter (a bare digit is search noise).
  assertEq(JSON.stringify(tokenize('utf8Decode')), JSON.stringify(['utf', 'decode']), '(8) letter/digit boundary split (lone digit dropped)');
  // a camelCase QUERY finds a file whose summary uses the spaced words
  const r8 = rankFilesForQuery('getUserProfile', [
    { path: 'src/user/profile.ts', symbols: ['getUserProfile'], summary: 'Fetch the user profile.' },
    { path: 'src/unrelated/theme.ts', symbols: ['applyTheme'], summary: 'Theme switching.' },
  ]);
  assertEq(r8[0].path, 'src/user/profile.ts', '(8) camelCase query matches getUserProfile symbol + summary');
  assertEq(r8.length, 1, '(8) unrelated theme file excluded (no shared terms)');

  // ─── (9) zero-match exclusion + stopword handling ─────────────────────────
  const r9 = rankFilesForQuery('the of and', [{ path: 'src/x.ts', summary: 'the quick brown fox' }]);
  assertEq(r9.length, 0, '(9) an all-stopword query matches nothing');
  const r9b = rankFilesForQuery('database', [
    { path: 'src/db.ts', summary: 'connects to the database' },
    { path: 'src/ui.ts', summary: 'renders a widget' },
  ]);
  assertEq(r9b.length, 1, '(9) only the term-bearing file is returned');
  assertEq(r9b[0].path, 'src/db.ts', '(9) correct file returned');

  // ─── (10) deterministic ranking + limit + tie-break ───────────────────────
  // Two files with identical scores must tie-break on path asc.
  const tieFiles = [
    { path: 'zzz/match.ts', symbols: ['payment'] },
    { path: 'aaa/match.ts', symbols: ['payment'] },
  ];
  const r10 = rankFilesForQuery('payment', tieFiles);
  assertEq(r10[0].path, 'aaa/match.ts', '(10) equal scores tie-break on path asc');
  assertEq(r10[1].path, 'zzz/match.ts', '(10) higher path comes second');
  // same query twice → identical output
  assertEq(JSON.stringify(rankFilesForQuery('payment', tieFiles)), JSON.stringify(r10), '(10) ranking is deterministic across runs');
  // limit is honored
  const limitFiles = Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.ts`, symbols: ['payment'] }));
  assertEq(rankFilesForQuery('payment', limitFiles, { limit: 3 }).length, 3, '(10) limit caps result count');
  assert(DEFAULT_RANK_LIMIT > 0, '(10) DEFAULT_RANK_LIMIT exported + positive');

  // ─── (11) constants exported + sane ───────────────────────────────────────
  assertEq(MAX_FILE_BYTES, 512_000, '(11) MAX_FILE_BYTES default is 512000');
  assertEq(MAX_INDEXED_FILES, 5000, '(11) MAX_INDEXED_FILES default is 5000');
  assert(IGNORED_DIRS.has('node_modules') && IGNORED_DIRS.has('.git') && IGNORED_DIRS.has('dist'), '(11) IGNORED_DIRS contains the core set');
  assertEq(EXTENSION_LANGUAGE.ts, 'typescript', '(11) EXTENSION_LANGUAGE map exported');

  // ─── (12) degenerate / undefined never throws ─────────────────────────────
  try {
    // planning
    assertEq(planCodebaseIndex(undefined as any).totalIndexed, 0, '(12) planCodebaseIndex(undefined) → empty');
    assertEq(planCodebaseIndex(null as any).totalIndexed, 0, '(12) planCodebaseIndex(null) → empty');
    assertEq(planCodebaseIndex([]).totalIndexed, 0, '(12) planCodebaseIndex([]) → empty');
    assertEq(planCodebaseIndex('nope' as any).totalIndexed, 0, '(12) planCodebaseIndex(string) → empty');
    assertEq(planCodebaseIndex([null, undefined, 42, {}, { path: '' }, { path: '   ' }] as any).totalIndexed, 0, '(12) junk entries ignored');
    planCodebaseIndex([{ path: 'a.ts', size: NaN as any }]); // non-finite size tolerated
    // ranking
    assertEq(rankFilesForQuery(undefined, undefined).length, 0, '(12) rankFilesForQuery(undefined,undefined) → []');
    assertEq(rankFilesForQuery('', []).length, 0, '(12) empty query → []');
    assertEq(rankFilesForQuery('x', null as any).length, 0, '(12) null files → []');
    assertEq(rankFilesForQuery('auth', [null, 7, {}, { path: 5 }, { path: 'ok.ts', symbols: [1, 'auth'] }] as any)[0]?.path, 'ok.ts', '(12) junk file rows tolerated; valid one still ranks');
    // tokenize degenerate
    assertEq(tokenize(undefined).length, 0, '(12) tokenize(undefined) → []');
    assertEq(tokenize(12345 as any).length, 0, '(12) tokenize(number) → []');
    assertEq(tokenize('').length, 0, '(12) tokenize("") → []');
    assertEq(tokenize('!!!___###').length, 0, '(12) tokenize(punctuation only) → []');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll codebase-index-core smoke cases passed (${passes} passed).`);
}

main();
