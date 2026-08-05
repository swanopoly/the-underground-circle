/**
 * codebase-symbol-core-smoketest — the pure symbol/summary extraction core
 * (src/lib/codebaseSymbolCore.ts), the embed-pipeline half of P4 of
 * docs/CODING_AGENT_UPGRADE_PLAN.md. Load-bearing assertions:
 *
 *   SYMBOLS: ts/js export forms (function / async function / class / interface /
 *   type / enum / const / let / default function / top-level const arrow) all
 *   capture the identifier only; dedupe preserves first-seen order; python
 *   def/async def/class; go func + receiver methods + type; rust fn/struct/
 *   enum/trait/impl; markdown #/##/### heading text; unknown languages get the
 *   combined ts+python fallback; MAX_SYMBOLS_PER_FILE cap holds.
 *
 *   SUMMARY: leading block comment with `*` decoration stripped; `//` and `#`
 *   line-comment runs; MAX_SUMMARY_CHARS word-boundary cap + '…'; markdown
 *   heading + first paragraph; '' when the file starts with code.
 *
 *   EMBED TEXT: buildCodebaseEmbedText composes path / language / symbols /
 *   summary newline-separated, skips absent parts, caps at
 *   MAX_EMBED_TEXT_CHARS, and returns '' for degenerate input.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (codebaseSymbolCore has zero imports).
 */

import {
  extractCodebaseSymbols,
  extractCodebaseSummary,
  buildCodebaseEmbedText,
  MAX_SYMBOLS_PER_FILE,
  MAX_SUMMARY_CHARS,
  MAX_EMBED_TEXT_CHARS,
} from '../src/lib/codebaseSymbolCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) typescript export forms ──────────────────────────────────────────
  const ts = [
    'export function alpha(x: number) {',
    'export async function beta() {',
    'function gamma() {',
    'export class Delta {',
    'class Epsilon {',
    'export interface Zeta {',
    'export type Eta = { a: string };',
    'export enum Theta {',
    'export const iota = 42;',
    'export let kappa = "x";',
    'const lambdaFn = (a: number) => a + 1;',
    'const asyncArrow = async (a: number) => a;',
    'export default function omega() {',
  ].join('\n');
  const tsSyms = extractCodebaseSymbols(ts, 'typescript');
  assert(tsSyms.includes('alpha'), '(1) export function captured');
  assert(tsSyms.includes('beta'), '(1) export async function captured');
  assert(tsSyms.includes('gamma'), '(1) bare function captured');
  assert(tsSyms.includes('Delta'), '(1) export class captured');
  assert(tsSyms.includes('Epsilon'), '(1) bare class captured');
  assert(tsSyms.includes('Zeta'), '(1) export interface captured');
  assert(tsSyms.includes('Eta'), '(1) export type captured');
  assert(tsSyms.includes('Theta'), '(1) export enum captured');
  assert(tsSyms.includes('iota'), '(1) export const captured');
  assert(tsSyms.includes('kappa'), '(1) export let captured');
  assert(tsSyms.includes('lambdaFn'), '(1) top-level const arrow captured');
  assert(tsSyms.includes('asyncArrow'), '(1) top-level const async arrow captured');
  assert(tsSyms.includes('omega'), '(1) export default function captured');
  assert(!tsSyms.includes('export'), '(1) keyword never captured as identifier');
  // non-declarations do not leak
  const tsNoise = extractCodebaseSymbols('  const inner = (x) => x;\nreturn foo(bar);\nconst plain = 5;', 'typescript');
  assert(!tsNoise.includes('inner'), '(1) indented const arrow is NOT top level');
  assert(!tsNoise.includes('plain'), '(1) plain const value (no arrow) not captured');

  // ─── (2) dedupe preserving first-seen order ──────────────────────────────
  const dup = extractCodebaseSymbols(
    'export function one() {}\nexport function two() {}\nfunction one() {}\nexport class two {}',
    'typescript'
  );
  assertEq(JSON.stringify(dup), JSON.stringify(['one', 'two']), '(2) deduped, first-seen order kept');

  // ─── (3) python ───────────────────────────────────────────────────────────
  const py = extractCodebaseSymbols(
    'class Parser:\n    def parse(self):\n        pass\n\nasync def fetch_all():\n    pass\ndef main():\n    pass',
    'python'
  );
  assertEq(JSON.stringify(py), JSON.stringify(['Parser', 'parse', 'fetch_all', 'main']), '(3) python class/def/async def');

  // ─── (4) go incl. receiver methods ───────────────────────────────────────
  const go = extractCodebaseSymbols(
    'type Server struct {\n\taddr string\n}\n\nfunc NewServer(addr string) *Server {\n}\n\nfunc (s *Server) Listen(port int) error {\n}\nfunc (s Server) Close() {\n}',
    'go'
  );
  assert(go.includes('Server'), '(4) go type captured');
  assert(go.includes('NewServer'), '(4) go func captured');
  assert(go.includes('Listen'), '(4) go pointer-receiver method name captured');
  assert(go.includes('Close'), '(4) go value-receiver method name captured');
  assert(!go.includes('s'), '(4) receiver binding not captured');

  // ─── (5) rust ─────────────────────────────────────────────────────────────
  const rs = extractCodebaseSymbols(
    'pub struct Config {\n}\nenum Mode {\n}\npub trait Runner {\n    fn run(&self);\n}\nimpl Config {\n    pub fn load() -> Self {\n    }\n}\nfn helper() {}',
    'rust'
  );
  assert(rs.includes('Config'), '(5) rust struct captured');
  assert(rs.includes('Mode'), '(5) rust enum captured');
  assert(rs.includes('Runner'), '(5) rust trait captured');
  assert(rs.includes('run'), '(5) rust trait fn captured');
  assert(rs.includes('load'), '(5) rust pub fn in impl captured');
  assert(rs.includes('helper'), '(5) rust bare fn captured');

  // ─── (6) markdown headings ────────────────────────────────────────────────
  const md = extractCodebaseSymbols(
    '# Title Here\n\nSome text.\n\n## Section Two\n\n### Deep Section\n\n#### Too Deep (h4 ignored)\n\n#not-a-heading',
    'markdown'
  );
  assertEq(JSON.stringify(md), JSON.stringify(['Title Here', 'Section Two', 'Deep Section']), '(6) # ## ### headings only');
  const longHeading = extractCodebaseSymbols(`# ${'word '.repeat(30)}end`, 'markdown');
  assert(longHeading[0].length <= 64, '(6) heading symbol truncated to <=64 chars');

  // ─── (7) unknown-language fallback (ts+python combined) ──────────────────
  const fb = extractCodebaseSymbols(
    'export function tsStyle() {}\ndef py_style():\n    pass\nclass Mixed:',
    'brainfuck'
  );
  assert(fb.includes('tsStyle'), '(7) fallback matches ts pattern');
  assert(fb.includes('py_style'), '(7) fallback matches python def');
  assert(fb.includes('Mixed'), '(7) fallback matches class');
  const shell = extractCodebaseSymbols('export function deploy() {\ndef helper():', 'shell');
  assert(shell.includes('deploy') && shell.includes('helper'), '(7) shell label uses generic fallback');

  // ─── (8) symbol cap + short-identifier skip ───────────────────────────────
  const many = Array.from({ length: 200 }, (_, i) => `export function fn${i}() {}`).join('\n');
  const capped = extractCodebaseSymbols(many, 'typescript');
  assertEq(capped.length, MAX_SYMBOLS_PER_FILE, '(8) capped at MAX_SYMBOLS_PER_FILE');
  assertEq(capped[0], 'fn0', '(8) cap keeps earliest declarations');
  const short = extractCodebaseSymbols('export const x = 1;\nexport const ok = 2;', 'typescript');
  assert(!short.includes('x'), '(8) 1-char identifier skipped');
  assert(short.includes('ok'), '(8) 2-char identifier kept');

  // ─── (9) block-comment summary with * decoration stripped ────────────────
  const blockDoc = [
    '/**',
    ' * fooCore — the pure core of foo handling.',
    ' * ════════════════════════════════════════',
    ' * It never throws on degenerate input.',
    ' */',
    'export function foo() {}',
  ].join('\n');
  const s9 = extractCodebaseSummary(blockDoc, 'typescript');
  assert(s9.includes('fooCore'), '(9) block comment text extracted');
  assert(s9.includes('never throws on degenerate input'), '(9) multi-line block content joined');
  assert(!s9.includes('*'), '(9) * markers stripped');
  assert(!s9.includes('═'), '(9) box decoration stripped');
  assert(!s9.includes('/'), '(9) /** and */ stripped');
  const plainBlock = extractCodebaseSummary('/* single line summary */\nconst a = 1;', 'javascript');
  assertEq(plainBlock, 'single line summary', '(9) /* … */ one-liner cleaned exactly');

  // ─── (10) // and # line-comment summaries ────────────────────────────────
  const slashDoc = '// barCore — routing helper.\n// Second line of the doc.\n\nexport function bar() {}';
  const s10a = extractCodebaseSummary(slashDoc, 'typescript');
  assert(s10a.includes('barCore') && s10a.includes('Second line'), '(10) // run collected');
  assert(!s10a.includes('//'), '(10) // markers stripped');
  assert(!s10a.includes('export function'), '(10) code after comment run excluded');
  const hashDoc = '#!/usr/bin/env python\n# quux module: parses things.\n# More detail here.\nimport os';
  const s10b = extractCodebaseSummary(hashDoc, 'python');
  assert(s10b.includes('quux module') && s10b.includes('More detail'), '(10) # run collected (shebang skipped)');
  assert(!s10b.includes('#'), '(10) # markers stripped');
  assert(!s10b.includes('env python'), '(10) shebang not treated as doc');
  assertEq(extractCodebaseSummary('const a = 1;\n// trailing comment', 'typescript'), '', '(10) code-first file → empty summary');

  // ─── (11) summary word-boundary cap ──────────────────────────────────────
  const longDoc = `// ${'longword '.repeat(120)}`;
  const s11 = extractCodebaseSummary(longDoc, 'typescript');
  assert(s11.length <= MAX_SUMMARY_CHARS, '(11) summary length <= MAX_SUMMARY_CHARS', `len ${s11.length}`);
  assert(s11.endsWith('…'), '(11) capped summary ends with ellipsis');
  assert(s11.slice(0, -1).endsWith('longword'), '(11) cut lands on a word boundary', JSON.stringify(s11.slice(-20)));

  // ─── (12) markdown summary: heading + first paragraph ────────────────────
  const mdDoc = '# My Tool\n\nA tiny tool that does one thing well.\nIt also streams.\n\nSecond paragraph ignored.';
  const s12 = extractCodebaseSummary(mdDoc, 'markdown');
  assert(s12.includes('My Tool'), '(12) markdown heading included');
  assert(s12.includes('does one thing well') && s12.includes('It also streams.'), '(12) full first paragraph included');
  assert(!s12.includes('Second paragraph'), '(12) later paragraphs excluded');
  assertEq(extractCodebaseSummary('', 'markdown'), '', '(12) empty markdown → empty summary');

  // ─── (13) buildCodebaseEmbedText composition ─────────────────────────────
  const embed = buildCodebaseEmbedText({
    path: 'src/lib/foo.ts',
    language: 'typescript',
    symbols: ['alpha', 'beta'],
    summary: 'fooCore — pure foo handling.',
  });
  assertEq(
    embed,
    'src/lib/foo.ts\nlanguage: typescript\nsymbols: alpha, beta\nfooCore — pure foo handling.',
    '(13) full composition, newline-separated'
  );
  assertEq(buildCodebaseEmbedText({ path: 'a/b.py' }), 'a/b.py', '(13) path-only input → path only');
  const noSummary = buildCodebaseEmbedText({ path: 'x.go', language: 'go', symbols: [], summary: '' });
  assertEq(noSummary, 'x.go\nlanguage: go', '(13) empty symbols/summary skipped');
  const dirtySyms = buildCodebaseEmbedText({ path: 'x.ts', symbols: ['ok', '', '  ', 123 as unknown as string] });
  assertEq(dirtySyms, 'x.ts\nsymbols: ok', '(13) non-string/blank symbols filtered');

  // ─── (14) embed text cap + degenerate input ──────────────────────────────
  const hugeEmbed = buildCodebaseEmbedText({ path: 'p.ts', summary: 'x'.repeat(20_000) });
  assertEq(hugeEmbed.length, MAX_EMBED_TEXT_CHARS, '(14) embed text capped at MAX_EMBED_TEXT_CHARS');
  assertEq(buildCodebaseEmbedText(null), '', '(14) null input → empty');
  assertEq(buildCodebaseEmbedText(undefined), '', '(14) undefined input → empty');
  assertEq(buildCodebaseEmbedText({ path: '' }), '', '(14) empty path → empty');
  assertEq(buildCodebaseEmbedText({ path: '   ' }), '', '(14) blank path → empty');
  assertEq(buildCodebaseEmbedText({ path: 42 as unknown as string }), '', '(14) non-string path → empty');

  // ─── (15) degenerate inputs never throw ──────────────────────────────────
  try {
    assertEq(JSON.stringify(extractCodebaseSymbols(undefined, undefined)), '[]', '(15) symbols(undefined) → []');
    assertEq(JSON.stringify(extractCodebaseSymbols(null, 'typescript')), '[]', '(15) symbols(null) → []');
    assertEq(JSON.stringify(extractCodebaseSymbols(42, 'python')), '[]', '(15) symbols(number) → []');
    assertEq(JSON.stringify(extractCodebaseSymbols({ a: 1 }, [])), '[]', '(15) symbols(object, array-lang) → []');
    assertEq(extractCodebaseSummary(undefined, undefined), '', '(15) summary(undefined) → ""');
    assertEq(extractCodebaseSummary(null, null), '', '(15) summary(null) → ""');
    assertEq(extractCodebaseSummary(3.14, 'go'), '', '(15) summary(number) → ""');
    assertEq(extractCodebaseSummary('code here', 12 as unknown as string), '', '(15) summary(non-string lang) tolerated');
    // one huge single line (no newlines) must not blow up either path
    const hugeLine = `export function big() {} ${'z'.repeat(500_000)}`;
    const hugeSyms = extractCodebaseSymbols(hugeLine, 'typescript');
    assert(Array.isArray(hugeSyms) && hugeSyms.includes('big'), '(15) huge single line handled');
    const hugeSummary = extractCodebaseSummary(`// ${'z'.repeat(500_000)}`, 'typescript');
    assert(hugeSummary.length <= MAX_SUMMARY_CHARS, '(15) huge comment line still capped');
    // very many lines: scan bound keeps this fast and non-throwing
    const manyLines = Array.from({ length: 10_000 }, (_, i) => `export function deep${i}() {}`).join('\n');
    assert(extractCodebaseSymbols(manyLines, 'typescript').length === MAX_SYMBOLS_PER_FILE, '(15) 10k-line file bounded');
    passes += 1; // the whole block executed without throwing
  } catch (err) {
    failures += 1;
    console.error(`FAIL: (15) degenerate inputs threw :: ${String(err)}`);
  }

  if (failures > 0) {
    console.error(`codebase-symbol-core smoketest: ${failures} FAILED, ${passes} passed`);
    process.exit(1);
  }
  console.log(`codebase-symbol-core smoketest: all ${passes} assertions passed`);
}

main();
