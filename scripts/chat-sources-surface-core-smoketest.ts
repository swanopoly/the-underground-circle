/**
 * chat-sources-surface-core-smoketest — RESPONSE_QUALITY R7 Sources surface
 * (src/lib/chatSourcesSurfaceCore.ts). Load-bearing behaviour:
 *   - extracted citations (file / file:line / url / commit) → shaped SourceItems;
 *   - a tool event whose result/metadata references a source → included (and it
 *     DEDUPES against the same URL cited in text);
 *   - 3 citations incl. a dup → deduped + ranked (files → urls → commits → tools);
 *   - secret-safety: `user:pass@` userinfo stripped, `?api_key=…` redacted,
 *     absolute/home path reduced to basename, Unicode-Tag smuggling stripped;
 *   - maxSources bounded (default 12, clamp 0..50); empty → {sources:[],md:'',0};
 *   - hostile (cyclic / huge / symbol / junk) → neutral, never throws.
 *
 * Pure — loads under tsx (chatSourcesSurfaceCore only imports the zero-import
 * citationExtractCore). Run: npx tsx scripts/chat-sources-surface-core-smoketest.ts
 */

import {
  buildSourcesSurface,
  type SourceItem,
  type SourcesSurface,
} from '../src/lib/chatSourcesSurfaceCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra !== undefined ? ` :: ${extra}` : ''}`);
  }
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg, ok ? '' : `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}
function isSurface(s: SourcesSurface): boolean {
  return (
    !!s &&
    Array.isArray(s.sources) &&
    typeof s.markdown === 'string' &&
    typeof s.count === 'number' &&
    s.count === s.sources.length
  );
}
function refs(s: SourcesSurface): string[] {
  return s.sources.map((x) => x.ref);
}
function kinds(s: SourcesSurface): string[] {
  return s.sources.map((x) => x.kind);
}
function find(s: SourcesSurface, pred: (x: SourceItem) => boolean): SourceItem | undefined {
  return s.sources.find(pred);
}

function main(): void {
  // ─── (1) empty / degenerate input → neutral surface, well-formed ──────────
  {
    const bad: unknown[] = [
      undefined, null, 123, 'str', true, Symbol('x'), {}, [],
      { citations: null }, { citations: undefined, toolEvents: undefined },
      { citations: 42 }, { citations: {}, toolEvents: {} },
      { citations: [] }, { toolEvents: [] },
    ];
    for (const b of bad) {
      const out = buildSourcesSurface(b as never);
      assert(isSurface(out), '(1) always a well-formed surface', JSON.stringify(b));
      assertEq(out, { sources: [], markdown: '', count: 0 }, '(1) neutral for empty/degenerate');
    }
    // A blob of prose with no references → empty.
    const none = buildSourcesSurface({ citations: 'just some words, version 1.2.3, example.com' });
    assertEq(none, { sources: [], markdown: '', count: 0 }, '(1) prose with no real refs → empty');
  }

  // ─── (2) single citation kinds → shaped SourceItem + markdown line ────────
  {
    const s = buildSourcesSurface({ citations: 'see src/lib/foo.ts:42 for the fix' });
    assert(s.count === 1, '(2) one file_line → one source', String(s.count));
    assertEq(s.sources[0], { label: 'src/lib/foo.ts:42', kind: 'file', ref: 'src/lib/foo.ts:42' }, '(2) file_line item');
    assert(s.markdown.startsWith('**Sources**'), '(2) markdown header', s.markdown);
    assert(s.markdown.includes('- `src/lib/foo.ts:42`'), '(2) file_line rendered in backticks', s.markdown);
  }
  {
    const s = buildSourcesSurface({ citations: 'open README.md now' });
    assertEq(s.sources[0], { label: 'README.md', kind: 'file', ref: 'README.md' }, '(2) bare file item');
    assert(s.markdown.includes('- `README.md`'), '(2) file markdown', s.markdown);
  }
  {
    const s = buildSourcesSurface({ citations: 'docs at https://docs.example.com/routing#v2 here' });
    assert(s.count === 1 && s.sources[0].kind === 'url', '(2) url kind', JSON.stringify(s.sources));
    assert(s.sources[0].ref === 'https://docs.example.com/routing#v2', '(2) url ref preserved', s.sources[0].ref);
    assert(s.sources[0].label === 'docs.example.com', '(2) url label is hostname', s.sources[0].label);
    assert(s.markdown.includes('https://docs.example.com/routing#v2'), '(2) url in markdown', s.markdown);
  }
  {
    const s = buildSourcesSurface({ citations: 'landed in commit a1b2c3d4e5f6 recently' });
    assert(s.sources[0].kind === 'commit', '(2) commit kind', JSON.stringify(s.sources[0]));
    assert(s.sources[0].label === 'a1b2c3d4e5', '(2) commit label shortened to 10', s.sources[0].label);
    assert(s.markdown.includes('commit `a1b2c3d4e5`'), '(2) commit markdown', s.markdown);
  }

  // ─── (3) 3 citations incl. a DUP → deduped + ranked list + markdown ───────
  {
    const s = buildSourcesSurface({
      citations: 'see src/lib/foo.ts:42 and https://a.io then again https://a.io',
    });
    assert(s.count === 2, '(3) dup url collapsed → 2 sources', String(s.count));
    assertEq(kinds(s), ['file', 'url'], '(3) ranked file before url after dedupe');
    assertEq(refs(s), ['src/lib/foo.ts:42', 'https://a.io'], '(3) deduped refs');
    const bullets = s.markdown.split('\n').filter((l) => l.startsWith('- '));
    assert(bullets.length === 2, '(3) markdown has 2 bullets (dup gone)', String(bullets.length));
  }
  {
    // Same via an explicit Citation[] array carrying an exact duplicate object.
    const s = buildSourcesSurface({
      citations: [
        { kind: 'file', raw: 'a.ts', path: 'a.ts' },
        { kind: 'url', raw: 'https://x.io', url: 'https://x.io' },
        { kind: 'url', raw: 'https://x.io', url: 'https://x.io' },
      ],
    });
    assert(s.count === 2, '(3) array-input dup deduped', String(s.count));
    assertEq(kinds(s), ['file', 'url'], '(3) array-input ranked');
  }
  {
    // Same file path, different line → NOT deduped (distinct refs).
    const s = buildSourcesSurface({ citations: 'a.ts:1 then a.ts:2' });
    assert(s.count === 2, '(3) same path different line kept', String(s.count));
    assertEq(refs(s), ['a.ts:1', 'a.ts:2'], '(3) both line refs present');
  }

  // ─── (4) ranking: mixed kinds group files → urls → commits → tools ────────
  {
    const s = buildSourcesSurface({
      citations: 'commit deadbeef1 then https://z.dev then src/x.ts:9 then README.md',
      toolEvents: [{ tool: 'search.web', summary: 'no refs here' }],
    });
    assertEq(kinds(s), ['file', 'file', 'url', 'commit', 'tool'], '(4) grouped by rank');
    // Within the file group, file_line (src/x.ts:9) ranks before bare file (README.md).
    assertEq(refs(s).slice(0, 2), ['src/x.ts:9', 'README.md'], '(4) file_line before bare file');
    assert(kinds(s)[kinds(s).length - 1] === 'tool', '(4) tool marker ranked last', JSON.stringify(kinds(s)));
  }

  // ─── (5) tool events: result / metadata / input refs + generic marker ─────
  {
    // URL in a tool result → a url source is INCLUDED.
    const s = buildSourcesSurface({
      toolEvents: [{ tool: 'browser.navigate', result: 'loaded https://news.example.org/story ok', status: 'completed' }],
    });
    assert(find(s, (x) => x.kind === 'url' && x.ref === 'https://news.example.org/story') !== undefined,
      '(5) url mined from tool result included', JSON.stringify(s.sources));
  }
  {
    // File reference in a tool summary → a file source.
    const s = buildSourcesSurface({
      toolEvents: [{ tool: 'local.read_file', summary: 'read src/lib/bar.ts:88 successfully' }],
    });
    assert(find(s, (x) => x.kind === 'file' && x.ref === 'src/lib/bar.ts:88') !== undefined,
      '(5) file:line mined from tool summary', JSON.stringify(s.sources));
  }
  {
    // Explicit metadata.url wins as the source ref.
    const s = buildSourcesSurface({
      toolEvents: [{ tool: 'web.fetch', metadata: { url: 'https://api.site.io/doc' }, summary: 'fetched' }],
    });
    assert(find(s, (x) => x.kind === 'url' && x.ref === 'https://api.site.io/doc') !== undefined,
      '(5) metadata.url surfaced', JSON.stringify(s.sources));
  }
  {
    // input.url also usable.
    const s = buildSourcesSurface({
      toolEvents: [{ tool: 'gdrive.read', input: { url: 'https://drive.example.com/f/1' } }],
    });
    assert(find(s, (x) => x.kind === 'url' && x.ref === 'https://drive.example.com/f/1') !== undefined,
      '(5) input.url surfaced', JSON.stringify(s.sources));
  }
  {
    // No extractable ref → generic tool marker labelled by tool name.
    const s = buildSourcesSurface({ toolEvents: [{ tool: 'gcal.list_events', summary: 'found 3 events' }] });
    assertEq(s.sources[0], { label: 'gcal.list_events', kind: 'tool', ref: 'gcal.list_events' }, '(5) generic tool marker');
    assert(s.markdown.includes('- gcal.list_events (tool)'), '(5) tool marker markdown', s.markdown);
  }
  {
    // Two generic tool markers of the same tool → deduped to one.
    const s = buildSourcesSurface({
      toolEvents: [{ tool: 'search.web' }, { tool: 'search.web' }],
    });
    assert(s.count === 1, '(5) same tool marker deduped', String(s.count));
  }
  {
    // A tool-fetched URL DEDUPES against the same URL cited in the answer text.
    const s = buildSourcesSurface({
      citations: 'per https://shared.example.com/x',
      toolEvents: [{ tool: 'web.fetch', metadata: { url: 'https://shared.example.com/x' } }],
    });
    assert(s.count === 1, '(5) tool url + text url dedupe to one', String(s.count));
    assert(s.sources[0].kind === 'url', '(5) merged as url', JSON.stringify(s.sources[0]));
  }
  {
    // alternate tool-name fields.
    const s = buildSourcesSurface({ toolEvents: [{ tool_name: 'x.y' }, { name: 'a.b' }] });
    assertEq(kinds(s), ['tool', 'tool'], '(5) tool_name/name fields recognized');
    assert(refs(s).includes('x.y') && refs(s).includes('a.b'), '(5) both tool refs present', JSON.stringify(refs(s)));
  }

  // ─── (6) secret-safety: userinfo / query keys / absolute paths / smuggling ─
  {
    const s = buildSourcesSurface({ citations: 'go https://user:pass@secret.example.com/a here' });
    assert(s.sources[0]?.ref === 'https://secret.example.com/a', '(6) userinfo stripped from url', s.sources[0]?.ref);
    assert(!s.markdown.includes('pass@') && !s.markdown.includes('user:'), '(6) no credentials in markdown', s.markdown);
  }
  {
    const s = buildSourcesSurface({ citations: 'fetch https://api.example.com/v1?api_key=SECRET123&page=2 now' });
    assert(s.sources[0]?.ref.includes('api_key=REDACTED'), '(6) sensitive query value redacted', s.sources[0]?.ref);
    assert(s.sources[0]?.ref.includes('page=2'), '(6) benign query value kept', s.sources[0]?.ref);
    assert(!s.markdown.includes('SECRET123'), '(6) secret never in markdown', s.markdown);
  }
  {
    const s = buildSourcesSurface({ citations: 'call https://h.io/x?token=abc&access_token=def&q=hi' });
    const r = s.sources[0]?.ref ?? '';
    assert(r.includes('token=REDACTED') && r.includes('access_token=REDACTED'), '(6) token + access_token redacted', r);
    assert(r.includes('q=hi'), '(6) q kept', r);
    assert(!r.includes('abc') && !r.includes('def'), '(6) secret values gone', r);
  }
  {
    // OAuth / Supabase implicit-flow tokens ride in the URL #fragment — redact it too.
    const s = buildSourcesSurface({ citations: 'auth https://app.io/#access_token=SECRET_AT&refresh_token=SECRET_RT&state=xyz' });
    const r = s.sources[0]?.ref ?? '';
    assert(r.includes('access_token=REDACTED') && r.includes('refresh_token=REDACTED'), '(6) FRAGMENT tokens redacted', r);
    assert(!r.includes('SECRET_AT') && !r.includes('SECRET_RT'), '(6) fragment secret values gone', r);
    assert(r.includes('state=xyz'), '(6) benign fragment param kept', r);
  }
  {
    // Absolute / home-dir path → reduced to basename (never leaks the username).
    const s = buildSourcesSurface({ citations: 'edited /Users/cswanson/the-underground-circle/src/lib/foo.ts today' });
    const f = find(s, (x) => x.kind === 'file');
    assert(f?.ref === 'foo.ts', '(6) absolute/home path reduced to basename', JSON.stringify(f));
    assert(!s.markdown.includes('cswanson'), '(6) username not leaked in markdown', s.markdown);
  }
  {
    // A relative path is preserved (it is safe and useful).
    const s = buildSourcesSurface({ citations: 'edited src/lib/foo.ts today' });
    assert(find(s, (x) => x.kind === 'file' && x.ref === 'src/lib/foo.ts') !== undefined, '(6) relative path kept', JSON.stringify(s.sources));
  }
  {
    // Unicode-Tag smuggling chars inside a path are stripped, no injection.
    const smuggled = `src/lib/ev\u{E0041}\u{E0042}il.ts`;
    const s = buildSourcesSurface({ citations: [{ kind: 'file', raw: smuggled, path: smuggled }] });
    assert(s.sources[0]?.ref === 'src/lib/evil.ts', '(6) Unicode-Tag chars stripped from path', JSON.stringify(s.sources[0]));
    assert(!/[\u{E0000}-\u{E007F}]/u.test(s.markdown), '(6) no tag chars survive into markdown', 'tag-check');
  }
  {
    // Backticks / markdown-image marker / angle brackets in a label are neutralized.
    const s = buildSourcesSurface({ citations: [{ kind: 'file', raw: 'a`b![x](y)<i>.ts', path: 'a`b![x](y)<i>.ts' }] });
    assert(!s.sources[0].ref.includes('`') && !s.sources[0].ref.includes('<'), '(6) backticks/angle brackets stripped', s.sources[0].ref);
    assert(!s.sources[0].ref.includes('!['), '(6) markdown image marker defanged', s.sources[0].ref);
    // markdown must not contain an unbalanced injected backtick fence beyond our own wrapping.
    const backticks = (s.markdown.match(/`/g) || []).length;
    assert(backticks % 2 === 0, '(6) backticks stay balanced (no fence breakout)', String(backticks));
  }

  // ─── (7) maxSources bound: default / custom / clamp / zero / negative ─────
  {
    const citeArr = [] as Array<{ kind: string; raw: string; path: string }>;
    for (let i = 0; i < 40; i += 1) citeArr.push({ kind: 'file', raw: `f${i}.ts`, path: `dir/f${i}.ts` });
    const dflt = buildSourcesSurface({ citations: citeArr });
    assert(dflt.count === 12, '(7) default max is 12', String(dflt.count));
    const custom = buildSourcesSurface({ citations: citeArr, maxSources: 5 });
    assert(custom.count === 5, '(7) custom max respected', String(custom.count));
    const huge = buildSourcesSurface({ citations: citeArr, maxSources: 9999 });
    assert(huge.count === 40, '(7) all 40 shown when max exceeds count', String(huge.count));
    const capped = buildSourcesSurface({ citations: citeArr, maxSources: 9999 });
    assert(capped.count <= 50, '(7) hard cap 50 never exceeded', String(capped.count));
    const zero = buildSourcesSurface({ citations: citeArr, maxSources: 0 });
    assertEq(zero, { sources: [], markdown: '', count: 0 }, '(7) max 0 → empty');
    const neg = buildSourcesSurface({ citations: citeArr, maxSources: -3 });
    assert(neg.count === 0, '(7) negative max clamped to 0', String(neg.count));
    const nan = buildSourcesSurface({ citations: citeArr, maxSources: Number.NaN });
    assert(nan.count === 12, '(7) NaN max → default 12', String(nan.count));
    const str = buildSourcesSurface({ citations: citeArr, maxSources: '3' as unknown });
    assert(str.count === 3, '(7) numeric string max coerced', String(str.count));
    const junk = buildSourcesSurface({ citations: citeArr, maxSources: {} as unknown });
    assert(junk.count === 12, '(7) object max → default', String(junk.count));
  }
  {
    // "+N more" is NOT this core's contract — a bounded slice + accurate count is.
    const citeArr = [] as Array<{ kind: string; raw: string; path: string }>;
    for (let i = 0; i < 60; i += 1) citeArr.push({ kind: 'file', raw: `x${i}.ts`, path: `x${i}.ts` });
    const s = buildSourcesSurface({ citations: citeArr, maxSources: 100 });
    assert(s.count === 50, '(7) 60 distinct capped at hard max 50', String(s.count));
    const bullets = s.markdown.split('\n').filter((l) => l.startsWith('- '));
    assert(bullets.length === 50, '(7) markdown bullet count matches source count', String(bullets.length));
  }

  // ─── (8) markdown format details ──────────────────────────────────────────
  {
    const s = buildSourcesSurface({
      citations: 'src/x.ts:9 and https://h.io and commit abcdef012345',
      toolEvents: [{ tool: 'gcal.list' }],
    });
    const lines = s.markdown.split('\n');
    assert(lines[0] === '**Sources**', '(8) first line is bold header', lines[0]);
    assert(lines.every((l, i) => i === 0 || l.startsWith('- ')), '(8) every non-header line is a bullet', s.markdown);
    assert(s.markdown.includes('- `src/x.ts:9`'), '(8) file_line line', s.markdown);
    assert(s.markdown.includes('- https://h.io'), '(8) url line bare', s.markdown);
    assert(s.markdown.includes('- commit `abcdef0123`'), '(8) commit line', s.markdown);
    assert(s.markdown.includes('- gcal.list (tool)'), '(8) tool line', s.markdown);
  }
  {
    const empty = buildSourcesSurface({ citations: '', toolEvents: [] });
    assert(empty.markdown === '', '(8) empty markdown for no sources', JSON.stringify(empty));
  }

  // ─── (9) HOSTILE inputs → neutral / bounded, never throws ─────────────────
  {
    let threw = false;
    try {
      const cyc: Record<string, unknown> = {};
      cyc.self = cyc;
      cyc.metadata = cyc;
      buildSourcesSurface({ citations: cyc, toolEvents: [cyc, cyc] });
      buildSourcesSurface({ citations: [cyc, null, undefined, 5, Symbol('z'), {}, { kind: 42 }] as unknown });
      buildSourcesSurface({ toolEvents: cyc as unknown });
      buildSourcesSurface({ citations: 'a'.repeat(500_000) });
      buildSourcesSurface({ citations: `${'https://x.io/'}${'y'.repeat(500_000)}` });
      const bigArr = new Array(100_000).fill({ kind: 'file', raw: 'z.ts', path: 'z.ts' });
      buildSourcesSurface({ citations: bigArr });
      const bigEvents = new Array(100_000).fill({ tool: 'search.web' });
      buildSourcesSurface({ toolEvents: bigEvents });
      buildSourcesSurface({ citations: Symbol('s') as unknown, toolEvents: Symbol('t') as unknown });
      buildSourcesSurface({ citations: [{ kind: 'url', url: {} }, { kind: 'commit', sha: 123 }] as unknown });
      buildSourcesSurface({ citations: [{ kind: 'file_line', path: 'a.ts', line: Number.POSITIVE_INFINITY }] as unknown });
      buildSourcesSurface({ maxSources: Number.POSITIVE_INFINITY, citations: 'x.ts' });
    } catch (e) {
      threw = true;
      console.error(`FAIL: (9) hostile input threw: ${(e as Error)?.message}`);
    }
    assert(!threw, '(9) hostile inputs never throw');
  }
  {
    // Huge single-token url stays bounded in the ref.
    const s = buildSourcesSurface({ citations: `https://x.io/${'y'.repeat(500_000)}` });
    if (s.count > 0) assert(s.sources[0].ref.length <= 301, '(9) oversized url ref bounded', String(s.sources[0].ref.length));
    else assert(true, '(9) oversized url produced no/bounded source');
  }
  {
    // Big distinct file array stays bounded by hard cap.
    const arr = [] as Array<{ kind: string; raw: string; path: string }>;
    for (let i = 0; i < 5000; i += 1) arr.push({ kind: 'file', raw: `p${i}.ts`, path: `p${i}.ts` });
    const s = buildSourcesSurface({ citations: arr, maxSources: 9999 });
    assert(s.count === 50, '(9) large distinct set capped at 50', String(s.count));
    assert(isSurface(s), '(9) surface still well-formed under load');
  }
  {
    // Junk-only citation objects (no valid kind) → no sources.
    const s = buildSourcesSurface({ citations: [{ path: 'x.ts' }, { kind: 'bogus' }, { kind: 'file' }] as unknown });
    assert(s.count === 0, '(9) junk citation objects yield no sources', JSON.stringify(s.sources));
  }

  // ─── (10) real-world end-to-end blob (citations text + tool events) ───────
  {
    const s = buildSourcesSurface({
      citations: [
        'Reviewed src/lib/chatComputerRequestRouter.ts:220 and the contract in',
        'src/lib/computerTaskEvidenceContract.ts. Docs: https://docs.example.com/routing#v2.',
        'Fixed in commit f5117230 (version 4.5.6 is unrelated).',
      ].join('\n'),
      toolEvents: [
        { tool: 'web.fetch', metadata: { url: 'https://docs.example.com/routing#v2' }, summary: 'fetched routing doc' },
        { tool: 'local.read_file', summary: 'read src/lib/chatComputerRequestRouter.ts:220' },
        { tool: 'gmail.search', summary: 'found 2 threads', status: 'completed' },
      ],
      maxSources: 10,
    });
    assert(isSurface(s), '(10) well-formed surface');
    assert(find(s, (x) => x.kind === 'file' && x.ref === 'src/lib/chatComputerRequestRouter.ts:220') !== undefined, '(10) file_line present', JSON.stringify(s.sources));
    assert(find(s, (x) => x.kind === 'file' && x.ref === 'src/lib/computerTaskEvidenceContract.ts') !== undefined, '(10) bare file present', JSON.stringify(s.sources));
    assert(find(s, (x) => x.kind === 'url' && x.ref === 'https://docs.example.com/routing#v2') !== undefined, '(10) url present', JSON.stringify(s.sources));
    assert(find(s, (x) => x.kind === 'commit' && x.ref === 'f5117230') !== undefined, '(10) commit present', JSON.stringify(s.sources));
    assert(find(s, (x) => x.kind === 'tool' && x.ref === 'gmail.search') !== undefined, '(10) tool marker present', JSON.stringify(s.sources));
    // The tool-fetched URL + the same text-cited URL collapse to ONE source.
    const urlCount = s.sources.filter((x) => x.kind === 'url' && x.ref === 'https://docs.example.com/routing#v2').length;
    assert(urlCount === 1, '(10) duplicate url (text + tool) deduped', String(urlCount));
    // The tool-read file:line + text-cited file:line collapse too.
    const rcount = s.sources.filter((x) => x.ref === 'src/lib/chatComputerRequestRouter.ts:220').length;
    assert(rcount === 1, '(10) duplicate file:line (text + tool) deduped', String(rcount));
    assert(!s.sources.some((x) => x.ref === '4.5.6'), '(10) version number excluded', JSON.stringify(s.sources));
    assertEq(kinds(s), ['file', 'file', 'url', 'commit', 'tool'], '(10) end-to-end rank order');
    assert(s.markdown.startsWith('**Sources**') && s.markdown.includes('commit `f5117230`'), '(10) markdown renders block', s.markdown);
    assert(!s.markdown.includes('cswanson'), '(10) markdown safe (no username leaked)');
  }

  const total = passes + failures;
  console.log(`chat-sources-surface-core smoke: ${passes} passed, ${failures} failed (of ${total})`);
  if (failures > 0) process.exit(1);
  console.log('chat-sources-surface-core smoke: ALL PASS');
}

main();
