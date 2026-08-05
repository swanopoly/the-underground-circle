// verification-diagnostics-core-smoketest — the PURE compiler/linter/test
// diagnostic extractor (src/lib/verificationDiagnosticsCore.ts). Load-bearing:
// tsc/eslint/jest/vitest/pytest/python-traceback parsing into structured
// Diagnostics, error-biased + bounded + secret-safe summarization, severity
// counting, and TOTAL behavior on degenerate/hostile/huge input (never throws,
// always bounded). This is the WHY-it-failed signal that
// openswanToolRuntime.ts:~6046 currently throws away by dropping stdout.
//
// Pure — loads under tsx (verificationDiagnosticsCore has zero imports).
// Run: npx tsx scripts/verification-diagnostics-core-smoketest.ts
//
// Any "secret-shaped" tokens below are OBVIOUSLY FAKE placeholders used only to
// prove redaction fires. Never put a real secret here.
import {
  parseDiagnostics,
  summarizeDiagnostics,
  countDiagnostics,
  MAX_DIAGNOSTICS,
  DEFAULT_SUMMARY_MAX_ITEMS,
  DEFAULT_SUMMARY_MAX_CHARS,
} from '../src/lib/verificationDiagnosticsCore';
import type { Diagnostic } from '../src/lib/verificationDiagnosticsCore';

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
  // ─── (1) tsc file/line/col/code block ─────────────────────────────────────
  const tsc = [
    "src/lib/foo.ts(12,5): error TS2304: Cannot find name 'foo'.",
    "src/lib/bar.ts(3,10): error TS1005: ';' expected.",
  ].join('\n');
  const tscD = parseDiagnostics(tsc);
  assertEq(tscD.length, 2, '(1) two tsc diagnostics parsed');
  assertEq(tscD[0].file, 'src/lib/foo.ts', '(1) tsc file');
  assertEq(tscD[0].line, 12, '(1) tsc line');
  assertEq(tscD[0].col, 5, '(1) tsc col');
  assertEq(tscD[0].code, 'TS2304', '(1) tsc code');
  assertEq(tscD[0].severity, 'error', '(1) tsc severity');
  assert(tscD[0].message.includes("Cannot find name 'foo'"), '(1) tsc message preserved', tscD[0].message);
  assertEq(tscD[1].code, 'TS1005', '(1) second tsc code');
  assertEq(tscD[1].line, 3, '(1) second tsc line');

  // ─── (2) tsc file-less general + tsc warning severity ─────────────────────
  const tsc2 = [
    'error TS18003: No inputs were found in config file.',
    "src/lib/baz.ts(8,9): warning TS6133: 'baz' is declared but never used.",
  ].join('\n');
  const tsc2D = parseDiagnostics(tsc2);
  assertEq(tsc2D.length, 2, '(2) general + warning parsed');
  assertEq(tsc2D[0].file, undefined, '(2) general error has no file');
  assertEq(tsc2D[0].code, 'TS18003', '(2) general error code');
  assertEq(tsc2D[0].severity, 'error', '(2) general error severity');
  assertEq(tsc2D[1].severity, 'warning', '(2) tsc warning severity');
  assertEq(tsc2D[1].col, 9, '(2) tsc warning col');
  assertEq(tsc2D[1].code, 'TS6133', '(2) tsc warning code');

  // ─── (3) eslint stylish block (file header + rows) ────────────────────────
  const eslintStylish = [
    '/app/src/a.jsx',
    "  12:5   error    'foo' is not defined  no-undef",
    '  15:1   warning  Missing semicolon  semi',
  ].join('\n');
  const esD = parseDiagnostics(eslintStylish);
  assertEq(esD.length, 2, '(3) two eslint rows parsed');
  assertEq(esD[0].file, '/app/src/a.jsx', '(3) eslint row inherits file header');
  assertEq(esD[0].line, 12, '(3) eslint row line');
  assertEq(esD[0].col, 5, '(3) eslint row col');
  assertEq(esD[0].severity, 'error', '(3) eslint row error severity');
  assertEq(esD[0].code, 'no-undef', '(3) eslint rule as code');
  assert(esD[0].message.includes('not defined'), '(3) eslint message', esD[0].message);
  assertEq(esD[1].severity, 'warning', '(3) eslint warning severity');
  assertEq(esD[1].code, 'semi', '(3) bare rule (2-space delimited) parsed');
  assertEq(esD[1].line, 15, '(3) eslint warning line');

  // ─── (4) eslint single-line (unix/compact) with trailing rule ─────────────
  const eslintLine = "/app/src/b.js:10:2 error 'bar' is assigned but never used no-unused-vars";
  const elD = parseDiagnostics(eslintLine);
  assertEq(elD.length, 1, '(4) single-line eslint parsed');
  assertEq(elD[0].file, '/app/src/b.js', '(4) single-line file');
  assertEq(elD[0].line, 10, '(4) single-line line');
  assertEq(elD[0].col, 2, '(4) single-line col');
  assertEq(elD[0].code, 'no-unused-vars', '(4) dashed rule peeled as code');
  assert(elD[0].message.includes('assigned but never used'), '(4) single-line message', elD[0].message);
  assert(!elD[0].message.includes('no-unused-vars'), '(4) rule removed from message', elD[0].message);

  // ─── (5) jest/vitest FAIL file + failing-test bullets ─────────────────────
  const jest = [
    'FAIL src/components/Button.test.tsx',
    '  ✕ renders label (4 ms)',
    '  ✕ handles click',
  ].join('\n');
  const jD = parseDiagnostics(jest);
  assertEq(jD.length, 3, '(5) FAIL file + 2 bullets');
  assertEq(jD[0].file, 'src/components/Button.test.tsx', '(5) jest fail file');
  assertEq(jD[0].severity, 'error', '(5) jest fail severity');
  assert(jD[1].message.includes('renders label'), '(5) bullet 1 message', jD[1].message);
  assert(!jD[1].message.includes('(4 ms)'), '(5) bullet timing stripped', jD[1].message);
  assert(jD[2].message.includes('handles click'), '(5) bullet 2 message', jD[2].message);

  // ─── (6) python traceback → deepest frame + terminal exception ────────────
  const trace = [
    'Traceback (most recent call last):',
    '  File "/app/main.py", line 3, in <module>',
    '    run()',
    '  File "/app/worker.py", line 42, in run',
    '    raise ValueError("bad value: 7")',
    'ValueError: bad value: 7',
  ].join('\n');
  const tD = parseDiagnostics(trace);
  assertEq(tD.length, 1, '(6) one diagnostic per traceback');
  assertEq(tD[0].file, '/app/worker.py', '(6) deepest frame file');
  assertEq(tD[0].line, 42, '(6) deepest frame line');
  assertEq(tD[0].code, 'ValueError', '(6) exception type as code');
  assert(tD[0].message.includes('bad value: 7'), '(6) exception message', tD[0].message);
  assertEq(tD[0].severity, 'error', '(6) traceback is an error');
  // an indented `raise ValueError(...)` inside the frame must NOT double-count
  assert(tD.length === 1, '(6) indented raise not double counted');

  // ─── (7) pytest FAILED summary + pytest short frame ───────────────────────
  const pytest = 'FAILED tests/test_math.py::test_add - assert 3 == 4';
  const pD = parseDiagnostics(pytest);
  assertEq(pD.length, 1, '(7) pytest FAILED parsed');
  assertEq(pD[0].file, 'tests/test_math.py', '(7) pytest file');
  assertEq(pD[0].severity, 'error', '(7) pytest severity');
  assert(pD[0].message.includes('test_add'), '(7) pytest test name', pD[0].message);
  assert(pD[0].message.includes('assert 3 == 4'), '(7) pytest detail', pD[0].message);

  // ─── (8) mixed input → error-biased, bounded summary ──────────────────────
  const mixed = [
    "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
    'src/b.ts(2,2): error TS2345: Argument type mismatch.',
    '/app/c.jsx',
    '  5:5  warning  Unexpected console statement  no-console',
    "src/d.ts(9,9): warning TS6133: 'y' is declared but never used.",
  ].join('\n');
  const mixedD = parseDiagnostics(mixed);
  assertEq(mixedD.length, 4, '(8) four mixed diagnostics');
  const mixedSummary = summarizeDiagnostics(mixed);
  assert(mixedSummary.includes('2 errors'), '(8) header error count', mixedSummary);
  assert(mixedSummary.includes('2 warnings'), '(8) header warning count', mixedSummary);
  const iErrA = mixedSummary.indexOf('TS2304');
  const iErrB = mixedSummary.indexOf('TS2345');
  const iWarnC = mixedSummary.indexOf('no-console');
  const iWarnD = mixedSummary.indexOf('TS6133');
  assert(iErrA >= 0 && iErrB >= 0 && iWarnC >= 0 && iWarnD >= 0, '(8) all four appear in summary');
  assert(iErrA < iWarnC && iErrA < iWarnD, '(8) errors listed before warnings (A)');
  assert(iErrB < iWarnC && iErrB < iWarnD, '(8) errors listed before warnings (B)');
  assert(mixedSummary.includes('warn'), '(8) warnings marked with warn prefix');
  assert(mixedSummary.length <= DEFAULT_SUMMARY_MAX_CHARS, '(8) summary within default char budget', String(mixedSummary.length));
  assert(!mixedSummary.includes('\n\n\n'), '(8) summary is compact (no raw gaps)');

  // ─── (9) countDiagnostics severity split ──────────────────────────────────
  assertEq(countDiagnostics(mixed).errors, 2, '(9) mixed error count');
  assertEq(countDiagnostics(mixed).warnings, 2, '(9) mixed warning count');
  assertEq(countDiagnostics(tsc).errors, 2, '(9) tsc error count');
  assertEq(countDiagnostics(tsc).warnings, 0, '(9) tsc warning count');
  assertEq(countDiagnostics(eslintStylish).warnings, 1, '(9) eslint warning count');
  assertEq(countDiagnostics('').errors, 0, '(9) empty count errors 0');

  // ─── (10) summarize bounding + fallback + empty ───────────────────────────
  const oneItem = summarizeDiagnostics(mixed, { maxItems: 1 });
  const oneItemBodyLines = oneItem.split('\n').filter((l) => l.length > 0);
  assert(oneItemBodyLines.length <= 3, '(10) maxItems:1 renders few lines', String(oneItemBodyLines.length));
  assert(oneItem.includes('more'), '(10) maxItems:1 notes remaining diagnostics', oneItem);
  const tightChars = summarizeDiagnostics(mixed, { maxChars: 120 });
  assert(tightChars.length <= 120, '(10) maxChars honored', String(tightChars.length));
  const fallback = summarizeDiagnostics('Building project...\nCompiling 42 modules\nDone in 3.2s');
  assert(fallback.startsWith('[no structured diagnostics parsed'), '(10) unparsed → redacted tail', fallback);
  assertEq(parseDiagnostics('Building project...\nDone in 3.2s').length, 0, '(10) unparsed → [] from parse');
  assertEq(summarizeDiagnostics('').length, 0, '(10) empty string → empty summary');
  assertEq(summarizeDiagnostics('   \n  \n').length, 0, '(10) whitespace-only → empty summary');

  // ─── (11) secret redaction (never leak credential values) ─────────────────
  const secretTrace = [
    'Traceback (most recent call last):',
    '  File "/app/auth.py", line 9, in login',
    '    raise RuntimeError("token sk-abcdefghijklmnopqrstuvwx rejected")',
    'RuntimeError: token sk-abcdefghijklmnopqrstuvwx rejected',
  ].join('\n');
  const secretD = parseDiagnostics(secretTrace);
  assertEq(secretD.length, 1, '(11) secret trace parsed');
  assert(!secretD[0].message.includes('sk-abcdefghijklmnopqrstuvwx'), '(11) raw key removed from message', secretD[0].message);
  assert(secretD[0].message.includes('[REDACTED'), '(11) key masked in message', secretD[0].message);
  assert(!summarizeDiagnostics(secretTrace).includes('sk-abcdefghijklmnopqrstuvwx'), '(11) raw key absent from summary');
  const bearerFallback = summarizeDiagnostics('log line Authorization: Bearer abcdefghijklmnop1234567890 here');
  assert(!bearerFallback.includes('abcdefghijklmnop1234567890'), '(11) bearer token masked in fallback tail', bearerFallback);
  const tscSecret = parseDiagnostics("src/x.ts(1,1): error TS1: api_key=SUPERSECRETVALUE0123456789 leaked");
  assert(!tscSecret[0].message.includes('SUPERSECRETVALUE0123456789'), '(11) api_key value masked in tsc message', tscSecret[0].message);

  // ─── (12) object-input leniency (whole result payload) ────────────────────
  const asObj = parseDiagnostics({ ok: false, executed: true, stdout: "src/z.ts(4,4): error TS2304: nope", stderr: '' });
  assertEq(asObj.length, 1, '(12) reads stdout from result object');
  assertEq(asObj[0].code, 'TS2304', '(12) object stdout parsed');
  assertEq(countDiagnostics({ stderr: 'src/z.ts(1,1): error TS9: e' }).errors, 1, '(12) reads stderr too');
  assert(summarizeDiagnostics({ stdout: mixed }).includes('2 errors'), '(12) summarize accepts object');
  assertEq(parseDiagnostics({}).length, 0, '(12) empty object → []');

  // ─── (13) huge input stays bounded ────────────────────────────────────────
  const hugeMatch = new Array(60_000).fill("src/x.ts(1,1): error TS2304: msg").join('\n');
  const hugeD = parseDiagnostics(hugeMatch);
  assertEq(hugeD.length, MAX_DIAGNOSTICS, '(13) parse capped at MAX_DIAGNOSTICS');
  const hugeCount = countDiagnostics(hugeMatch);
  assert(hugeCount.errors >= 500 && hugeCount.errors <= 1000, '(13) count bounded by scan ceiling', String(hugeCount.errors));
  const hugeSummary = summarizeDiagnostics(hugeMatch);
  assert(hugeSummary.length <= DEFAULT_SUMMARY_MAX_CHARS, '(13) huge summary bounded', String(hugeSummary.length));
  assert(hugeSummary.includes('more'), '(13) huge summary notes remaining');
  const hugeNoise = new Array(60_000).fill('just some log output here').join('\n');
  assertEq(parseDiagnostics(hugeNoise).length, 0, '(13) huge non-matching → []');
  assert(summarizeDiagnostics(hugeNoise).length <= DEFAULT_SUMMARY_MAX_CHARS, '(13) huge noise summary bounded');
  const longLine = 'x'.repeat(300_000);
  assertEq(parseDiagnostics(longLine).length, 0, '(13) 300k-char line → [] (no throw)');
  assert(summarizeDiagnostics(longLine).length <= DEFAULT_SUMMARY_MAX_CHARS, '(13) long-line summary bounded');

  // ─── (14) determinism ─────────────────────────────────────────────────────
  assertEq(JSON.stringify(parseDiagnostics(mixed)), JSON.stringify(parseDiagnostics(mixed)), '(14) parse is deterministic');
  assertEq(summarizeDiagnostics(mixed), summarizeDiagnostics(mixed), '(14) summary is deterministic');

  // ─── (15) exported constants ──────────────────────────────────────────────
  assertEq(MAX_DIAGNOSTICS, 50, '(15) MAX_DIAGNOSTICS is 50');
  assert(DEFAULT_SUMMARY_MAX_ITEMS > 0 && DEFAULT_SUMMARY_MAX_ITEMS <= 200, '(15) default max items sane');
  assert(DEFAULT_SUMMARY_MAX_CHARS >= 80, '(15) default max chars sane');

  // ─── (16) degenerate / hostile input → never throws ───────────────────────
  const hostile: unknown[] = [
    undefined, null, 123, 0, NaN, Infinity, -Infinity, true, false,
    {}, [], { stdout: 123 }, { stdout: null }, { stderr: undefined },
    () => 'x', Symbol.iterator, new Date(0),
    '\x00\x00\x00', '💥✕✗● not a real diagnostic',
    '(((((((((()))))))))\\1+$.*', ':::::', '\n\n\n\n\n',
    '('.repeat(100_000), '\n'.repeat(100_000), ' '.repeat(50_000),
    'FAIL', 'error TS', 'File "', 'Traceback (most recent call last):',
    'src/x.ts(999999999999999999999,1): error TS1: overflow line number',
  ];
  for (const h of hostile) {
    try {
      const p = parseDiagnostics(h);
      const s = summarizeDiagnostics(h, { maxChars: 200, maxItems: 5 });
      const c = countDiagnostics(h);
      assert(Array.isArray(p), `(16) parse returns array for ${String(h).slice(0, 24)}`);
      assert(p.length <= MAX_DIAGNOSTICS, '(16) parse bounded on hostile input');
      assert(typeof s === 'string', `(16) summarize returns string for ${String(h).slice(0, 24)}`);
      assert(s.length <= 200, '(16) summarize respects maxChars on hostile input');
      assert(typeof c.errors === 'number' && typeof c.warnings === 'number', '(16) count returns numbers');
      assert(c.errors >= 0 && c.warnings >= 0, '(16) counts non-negative');
    } catch (e) {
      failures += 1;
      console.error(`FAIL: (16) hostile input threw for ${String(h).slice(0, 40)} :: ${(e as Error)?.message}`);
    }
  }
  // opts themselves hostile
  try {
    summarizeDiagnostics(mixed, { maxChars: -5, maxItems: -1 });
    summarizeDiagnostics(mixed, { maxChars: NaN, maxItems: Infinity });
    summarizeDiagnostics(mixed, { maxChars: 10 ** 12, maxItems: 10 ** 12 });
    summarizeDiagnostics(mixed, {} as { maxChars?: number });
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (16) hostile opts threw :: ${(e as Error)?.message}`);
  }

  // ─── (17) parsed shape invariants ─────────────────────────────────────────
  const shapeSample: Diagnostic[] = parseDiagnostics(mixed);
  for (const d of shapeSample) {
    assert(typeof d.message === 'string', '(17) message is always a string');
    assert(d.severity === 'error' || d.severity === 'warning', '(17) severity is a valid literal');
    assert(d.file === undefined || typeof d.file === 'string', '(17) file is string or undefined');
    assert(d.line === undefined || typeof d.line === 'number', '(17) line is number or undefined');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll verification-diagnostics-core smoke cases passed (${passes} passed).`);
}

main();
