/**
 * citation-extract-core-smoketest — the pure source-reference extractor
 * (src/lib/citationExtractCore.ts) for a "Sources" grounding/accountability UI.
 * Load-bearing: file:line → {path,line}; bare file w/ known ext → {path}; http(s)
 * → {url}; git-context hex → {sha}; conservatism (a bare version `1.2.3`, a domain
 * `example.com`, and a lone `deadbeef` in prose must NOT match); first-appearance
 * ordering; (kind|path|line|url|sha) dedupe; bounded render with "+N more";
 * non-string → [] / "" and never-throws.
 *
 * Pure — loads under tsx (citationExtractCore has zero imports).
 */

import {
  extractCitations,
  dedupeCitations,
  renderCitations,
  type Citation,
} from '../src/lib/citationExtractCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function kinds(text: string): string[] { return extractCitations(text).map((c) => c.kind); }
function only(text: string): Citation[] { return extractCitations(text); }
function has(cites: Citation[], pred: (c: Citation) => boolean): boolean { return cites.some(pred); }

function main(): void {
  // ─── (1) file_line: path:line[:col] → {path, line} ────────────────────────
  {
    const c = only('see src/lib/foo.ts:42 for the fix');
    assert(c.length === 1, '(1) single file_line extracted', String(c.length));
    assert(c[0].kind === 'file_line', '(1) kind file_line', c[0].kind);
    assert(c[0].path === 'src/lib/foo.ts', '(1) path parsed', c[0].path);
    assert(c[0].line === 42, '(1) line parsed', String(c[0].line));
    assert(c[0].raw === 'src/lib/foo.ts:42', '(1) raw is exact match', c[0].raw);
  }
  {
    const c = only('crash at app.py:100:7 today');
    assert(c[0]?.kind === 'file_line' && c[0]?.path === 'app.py' && c[0]?.line === 100, '(1) file:line:col keeps line, drops col into line only', JSON.stringify(c[0]));
    assert(c[0]?.raw === 'app.py:100:7', '(1) file:line:col raw includes col', c[0]?.raw);
  }

  // ─── (2) bare file with KNOWN extension → {path} ──────────────────────────
  {
    const c = only('open README.md now');
    assert(c.length === 1 && c[0].kind === 'file' && c[0].path === 'README.md', '(2) README.md → file', JSON.stringify(c));
  }
  for (const f of ['index.ts', 'a/b/c.tsx', 'main.py', 'schema.sql', 'run.sh', 'mod.go', 'lib.rs', 'App.java', 'style.css', 'page.html', 'config.yml', 'notes.txt', 'data.json']) {
    const c = only(`file ${f} here`);
    assert(c.length === 1 && c[0].kind === 'file' && c[0].path === f, `(2) known ext → file: ${f}`, JSON.stringify(c));
  }

  // ─── (3) url: http(s):// → {url} ──────────────────────────────────────────
  {
    const c = only('docs at https://x.com/a here');
    assert(c.length === 1 && c[0].kind === 'url' && c[0].url === 'https://x.com/a', '(3) https url', JSON.stringify(c));
    assert(c[0].raw === 'https://x.com/a', '(3) url raw exact', c[0].raw);
  }
  {
    const c = only('see (https://example.com/path?q=1) and http://plain.org.');
    assert(has(c, (x) => x.kind === 'url' && x.url === 'https://example.com/path?q=1'), '(3) url inside parens, query kept', JSON.stringify(c));
    assert(has(c, (x) => x.kind === 'url' && x.url === 'http://plain.org'), '(3) trailing period trimmed from url', JSON.stringify(c));
  }

  // ─── (4) commit: hex in git context → {sha} ───────────────────────────────
  {
    const c = only('landed in commit a1b2c3d recently');
    assert(c.length === 1 && c[0].kind === 'commit' && c[0].sha === 'a1b2c3d', '(4) commit <sha>', JSON.stringify(c));
    assert(c[0].raw === 'a1b2c3d', '(4) commit raw is the sha', c[0].raw);
  }
  {
    const c = only('at sha 0123456789abcdef0123456789abcdef01234567 exactly');
    assert(has(c, (x) => x.kind === 'commit' && x.sha === '0123456789abcdef0123456789abcdef01234567'), '(4) 40-hex sha after "sha "', JSON.stringify(c));
  }
  {
    const c = only('pinned @deadbeefcafe today');
    assert(has(c, (x) => x.kind === 'commit' && x.sha === 'deadbeefcafe'), '(4) @<sha> git context', JSON.stringify(c));
  }

  // ─── (5) CONSERVATISM — false positives must NOT match ────────────────────
  {
    const c = only('we upgraded to version 1.2.3 last week');
    assert(!has(c, (x) => x.kind === 'file' || x.kind === 'file_line'), '(5) version 1.2.3 is NOT a file', JSON.stringify(c));
    assert(c.length === 0, '(5) version number yields no citations', JSON.stringify(c));
  }
  {
    const c = only('visit example.com for details');
    assert(!has(c, (x) => x.kind === 'file'), '(5) bare domain example.com is NOT a file', JSON.stringify(c));
  }
  {
    const c = only('the word deadbeef appeared in the logs');
    assert(!has(c, (x) => x.kind === 'commit'), '(5) lone deadbeef in prose is NOT a commit', JSON.stringify(c));
    assert(c.length === 0, '(5) prose hex yields no citations', JSON.stringify(c));
  }
  {
    const c = only('unknown file kind data.bin and archive.zip');
    assert(c.length === 0, '(5) unknown extensions (.bin/.zip) are NOT files', JSON.stringify(c));
  }
  {
    // A file_line must NOT also surface as a bare file for the same span.
    const c = only('src/lib/foo.ts:12');
    assert(c.length === 1 && c[0].kind === 'file_line', '(5) file:line does not double-count as bare file', JSON.stringify(c));
  }

  // ─── (6) multiple + first-appearance ordering ─────────────────────────────
  {
    const text = 'first https://a.io then src/x.ts:9 then README.md then commit abc1234';
    const ks = kinds(text);
    assert(JSON.stringify(ks) === JSON.stringify(['url', 'file_line', 'file', 'commit']), '(6) ordered by appearance', JSON.stringify(ks));
  }
  {
    // file appearing BEFORE url in text should come first.
    const ks = kinds('open config.json and then https://z.dev');
    assert(ks[0] === 'file' && ks[1] === 'url', '(6) file-before-url ordering', JSON.stringify(ks));
  }

  // ─── (7) dedupe by (kind|path|line|url|sha), stable order ─────────────────
  {
    const text = 'foo.ts:5 and again foo.ts:5 and https://a.io twice https://a.io';
    const raw = only(text);
    assert(raw.length === 4, '(7) pre-dedupe has 4', String(raw.length));
    const d = dedupeCitations(raw);
    assert(d.length === 2, '(7) deduped to 2', String(d.length));
    assert(d[0].kind === 'file_line' && d[1].kind === 'url', '(7) dedupe preserves first-seen order', JSON.stringify(d.map((x) => x.kind)));
  }
  {
    // Same path different line → NOT deduped.
    const d = dedupeCitations(only('a.ts:1 a.ts:2'));
    assert(d.length === 2, '(7) same path different line kept', JSON.stringify(d));
  }
  {
    // file vs file_line for same path → different kind → both kept.
    const d = dedupeCitations([
      { kind: 'file', raw: 'a.ts', path: 'a.ts' },
      { kind: 'file_line', raw: 'a.ts:1', path: 'a.ts', line: 1 },
    ]);
    assert(d.length === 2, '(7) file vs file_line not merged', String(d.length));
  }

  // ─── (8) render: bounded "Sources:" list with "+N more" ───────────────────
  {
    const cites: Citation[] = [];
    for (let i = 0; i < 25; i += 1) cites.push({ kind: 'file', raw: `f${i}.ts`, path: `f${i}.ts` });
    const out = renderCitations(cites);
    assert(out.startsWith('Sources:'), '(8) render starts with Sources:', out.slice(0, 20));
    const bullets = out.split('\n').filter((l) => l.startsWith('- '));
    assert(bullets.length === 21, '(8) 20 shown + 1 "+N more" line = 21 bullets', String(bullets.length));
    assert(out.includes('+5 more'), '(8) "+5 more" note when 25 capped at 20', out);
    assert(out.includes('`f0.ts`'), '(8) first file rendered in backticks', out);
  }
  {
    const out = renderCitations(
      [{ kind: 'file', raw: 'a.ts', path: 'a.ts' }, { kind: 'file', raw: 'b.ts', path: 'b.ts' }, { kind: 'file', raw: 'c.ts', path: 'c.ts' }],
      { max: 2 },
    );
    assert(out.includes('+1 more'), '(8) custom max respected', out);
    assert(!out.includes('`c.ts`'), '(8) items beyond max omitted', out);
  }
  {
    const out = renderCitations([
      { kind: 'file_line', raw: 'x.ts:9', path: 'x.ts', line: 9 },
      { kind: 'url', raw: 'https://h.io', url: 'https://h.io' },
      { kind: 'commit', raw: 'abcdef0', sha: 'abcdef0' },
    ]);
    assert(out.includes('`x.ts:9`'), '(8) file_line renders path:line', out);
    assert(out.includes('https://h.io'), '(8) url rendered', out);
    assert(out.includes('commit `abcdef0`'), '(8) commit rendered', out);
    assert(!out.includes('+'), '(8) no "+N more" when under cap', out);
  }
  {
    // render dedupes before counting.
    const out = renderCitations([
      { kind: 'file', raw: 'a.ts', path: 'a.ts' },
      { kind: 'file', raw: 'a.ts', path: 'a.ts' },
    ]);
    assert(out === 'Sources:\n- `a.ts`', '(8) render dedupes duplicates', JSON.stringify(out));
  }

  // ─── (9) non-string / empty / degenerate → [] / "" and never throws ───────
  assert(extractCitations(undefined).length === 0, '(9) undefined → []');
  assert(extractCitations(null as unknown).length === 0, '(9) null → []');
  assert(extractCitations(123 as unknown).length === 0, '(9) number → []');
  assert(extractCitations({} as unknown).length === 0, '(9) object → []');
  assert(extractCitations('').length === 0, '(9) empty string → []');
  assert(dedupeCitations(undefined).length === 0, '(9) dedupe(undefined) → []');
  assert(dedupeCitations('nope' as unknown).length === 0, '(9) dedupe(non-array) → []');
  assert(dedupeCitations([null, undefined, 5, {}] as unknown).length === 0, '(9) dedupe skips junk entries');
  assert(renderCitations(undefined) === '', '(9) render(undefined) → ""');
  assert(renderCitations([]) === '', '(9) render([]) → ""');
  assert(renderCitations('x' as unknown) === '', '(9) render(non-array) → ""');
  try {
    extractCitations(Symbol('x') as unknown);
    extractCitations('a'.repeat(500_000));
    dedupeCitations([{ kind: 'file' } as Citation]);
    renderCitations([{ kind: 'file', raw: 'a', path: 'a' }], { max: -3 });
    renderCitations([{ kind: 'file', raw: 'a', path: 'a' }], { max: NaN as unknown as number });
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (9) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (10) real-world mixed blob (end-to-end) ──────────────────────────────
  {
    const blob = [
      'I reviewed the router in src/lib/chatComputerRequestRouter.ts:220 and the',
      'contract in src/lib/computerTaskEvidenceContract.ts. Reference docs at',
      'https://docs.example.com/routing#v2. Fixed in commit f511723 (see also',
      'the note about version 4.5.6 which is unrelated) and package deadbeef word.',
    ].join('\n');
    const c = only(blob);
    assert(has(c, (x) => x.kind === 'file_line' && x.path === 'src/lib/chatComputerRequestRouter.ts' && x.line === 220), '(10) file_line from blob', JSON.stringify(c));
    assert(has(c, (x) => x.kind === 'file' && x.path === 'src/lib/computerTaskEvidenceContract.ts'), '(10) bare file from blob', JSON.stringify(c));
    assert(has(c, (x) => x.kind === 'url' && x.url === 'https://docs.example.com/routing#v2'), '(10) url from blob', JSON.stringify(c));
    assert(has(c, (x) => x.kind === 'commit' && x.sha === 'f511723'), '(10) commit from blob', JSON.stringify(c));
    assert(!has(c, (x) => (x.path ?? '') === '4.5.6'), '(10) version 4.5.6 excluded', JSON.stringify(c));
    assert(!has(c, (x) => x.kind === 'commit' && x.sha === 'deadbeef'), '(10) prose "deadbeef" excluded', JSON.stringify(c));
    const rendered = renderCitations(c);
    assert(rendered.startsWith('Sources:') && rendered.includes('commit `f511723`'), '(10) blob renders a Sources list', rendered);
  }

  const total = passes + failures;
  console.log(`citation-extract-core smoke: ${passes} passed, ${failures} failed (of ${total})`);
  if (failures > 0) process.exit(1);
}

main();
