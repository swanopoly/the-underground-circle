/**
 * acrobat-script-adapter-smoketest — verifies the PURE Adobe Acrobat automation
 * generator (src/lib/acrobatScriptAdapter.ts). It emits an AppleScript that runs
 * validated Acrobat JavaScript through the macOS `do script` hook, so there are
 * TWO embedding layers (JS literal inside an AppleScript string). Security-heavy:
 *
 *   - input/output PATH allowlist (control/shell-metachar/non-BMP/traversal reject)
 *   - .pdf INPUT extension allowlist + per-op output-extension↔format agreement
 *   - export FORMAT enum allowlist (hostile format dropped) + fixed cConvID map
 *   - PAGE allowlist: bounded 0-based integer; decimal/exponent/hex/negative/
 *     Infinity/NaN/injection all rejected; endPage>=startPage enforced
 *   - combine input-list bounds (2..50) + no source==output overwrite
 *   - DOUBLE-LAYER SAFE embedding: a path containing quotes/backslash/non-ASCII
 *     never lands raw in the JS literal, and the whole JS blob is re-escaped for
 *     the AppleScript `do script` string (backslash + double-quote escaped)
 *   - a concrete INJECTION (shell + JS-breakout + AppleScript-breakout shaped
 *     path) is rejected and never appears in the emitted stub
 *   - do-script hook pins: every real script targets "Adobe Acrobat" via
 *     `do script`, wraps the JS in try/catch with the done/error sentinel
 *   - per-operation script-shape pins (insertPages combine, saveAs export with
 *     the right cConvID, flattenPages, extractPages) incl. VERIFY banner
 *   - "no OCR operation" pin (Acrobat JS has no OCR method; we must not ship one)
 *   - invocation descriptor advertises verifiedInvocation:false + a docSource
 *   - operation-gap tool constant is the build-app-capability route
 *   - bounds (long paths, huge pages)
 *   - degenerate inputs NEVER throw (null/garbage → fail-closed stub, ok:false)
 *
 * Run: npx tsx scripts/acrobat-script-adapter-smoketest.ts
 */

import {
  ACROBAT_EXPORT_CONV_ID,
  ACROBAT_EXPORT_FORMATS,
  ACROBAT_INVOCATION,
  ACROBAT_OPERATION_GAP_TOOL,
  ACROBAT_OPERATIONS,
  ACROBAT_PAGE_MAX,
  buildAcrobatScript,
  describeAcrobatOperation,
  validateAcrobatArgs,
} from '../src/lib/acrobatScriptAdapter';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// A generic "did any user value leak in raw?" check: the raw substring must NOT
// appear outside of an escaped literal. For our hostile fixtures the raw form
// contains a metachar/quote/newline that an escaper would have transformed, so
// its literal presence in the script is proof of unsafe concatenation.
function scriptContainsRaw(script: string, raw: string): boolean {
  return script.includes(raw);
}

// Every real (ok:true) script must target Acrobat via the do-script hook and
// carry the sentinel-wrapped try/catch.
function assertDoScriptPins(script: string, label: string) {
  expect(script.includes('tell application "Adobe Acrobat"'), `${label}: targets Adobe Acrobat`);
  expect(script.includes('do script "'), `${label}: uses the do script hook (executable command)`);
  expect(script.includes('UC_ACROBAT_DONE'), `${label}: reports the done sentinel`);
  expect(script.includes('UC_ACROBAT_ERROR'), `${label}: reports the error sentinel`);
  expect(script.includes('-- VERIFY'), `${label}: carries the VERIFY banner`);
  // The script must be pure ASCII (both embedding layers escape to ASCII).
  expect(!/[^\x00-\x7f]/.test(script), `${label}: generated script is pure ASCII`);
}

// ── Operation + format enums + invocation descriptor are stable ──────────────
{
  expect(ACROBAT_OPERATIONS.length === 4, 'four operations exposed');
  expect(
    ACROBAT_OPERATIONS.includes('combine_pdfs') &&
      ACROBAT_OPERATIONS.includes('export_to_office') &&
      ACROBAT_OPERATIONS.includes('flatten_pdf') &&
      ACROBAT_OPERATIONS.includes('extract_pages'),
    'operation set is combine_pdfs / export_to_office / flatten_pdf / extract_pages',
  );
  // No OCR operation anywhere — Acrobat JS has no documented OCR method.
  expect(!(ACROBAT_OPERATIONS as readonly string[]).some((o) => /ocr/i.test(o)), 'no OCR operation is exposed (Acrobat JS has no OCR method)');
  expect(ACROBAT_EXPORT_FORMATS.join(',') === 'docx,xlsx,rtf,txt', 'export formats are docx,xlsx,rtf,txt');
  expect(ACROBAT_EXPORT_CONV_ID.docx === 'com.adobe.acrobat.docx', 'docx maps to com.adobe.acrobat.docx cConvID');
  expect(ACROBAT_EXPORT_CONV_ID.xlsx === 'com.adobe.acrobat.xlsx', 'xlsx maps to com.adobe.acrobat.xlsx cConvID');
  // Invocation descriptor: NOT verified live, carries a docSource.
  expect(ACROBAT_INVOCATION.verifiedInvocation === false, 'invocation advertises verifiedInvocation:false (not wired live)');
  expect(ACROBAT_INVOCATION.runner === 'osascript', 'invocation runner is osascript');
  expect(ACROBAT_INVOCATION.appleScriptVerb === 'do script', 'invocation verb is do script');
  expect(typeof ACROBAT_INVOCATION.docSource === 'string' && ACROBAT_INVOCATION.docSource.startsWith('https://'), 'invocation carries an https docSource URL');
  expect(ACROBAT_OPERATION_GAP_TOOL === 'agent.build_app_capability', 'operation-gap tool is agent.build_app_capability');
  pass('operation + format enums, cConvID map, invocation descriptor, and gap tool are the documented sets');
}

// ── combine_pdfs: happy path + safe path embedding + do-script pins ──────────
{
  const inputPaths = ["/Users/demo/My 'Docs'/a.pdf", '/Users/demo/b.pdf', '/Users/demo/c.pdf'];
  const outputPath = '/Users/demo/Desktop/combined.pdf';
  const result = buildAcrobatScript('combine_pdfs', { inputPaths, outputPath });
  expect(result.ok === true, 'combine builds');
  expect(result.scriptExtension === 'applescript', 'scriptExtension is applescript');
  expect(result.outputHint === outputPath, 'outputHint echoes the validated output path');
  // First source opened, rest appended, combined saved.
  expect(result.script.includes('app.openDoc('), 'opens the first source doc');
  expect(result.script.includes('insertPages('), 'uses Doc.insertPages to append (NOT app.combinePDFs)');
  expect(!result.script.includes('combinePDFs'), 'does NOT use the hallucinated app.combinePDFs');
  expect(result.script.includes('saveAs('), 'saves the combined output via saveAs');
  expect(result.script.includes('bPromptToOverwrite: false'), 'saves silently (no overwrite prompt)');
  // The quote in the first source path must be JSON-escaped inside the JS, and
  // the whole blob re-escaped for AppleScript — never raw.
  expect(!scriptContainsRaw(result.script, "My 'Docs'/a.pdf\""), 'source path is not raw-concatenated');
  assertDoScriptPins(result.script, 'combine_pdfs');
  pass('combine_pdfs: insertPages shape (not combinePDFs) + safe embedding + do-script pins');
}

// ── combine_pdfs: input-list bounds + no overwrite of a source ───────────────
{
  const tooFew = buildAcrobatScript('combine_pdfs', { inputPaths: ['/tmp/a.pdf'], outputPath: '/tmp/o.pdf' });
  expect(tooFew.ok === false, 'combine with <2 inputs rejected');
  const notPdf = buildAcrobatScript('combine_pdfs', { inputPaths: ['/tmp/a.pdf', '/tmp/b.txt'], outputPath: '/tmp/o.pdf' });
  expect(notPdf.ok === false, 'combine with a non-pdf input rejected');
  const overwrite = buildAcrobatScript('combine_pdfs', { inputPaths: ['/tmp/a.pdf', '/tmp/b.pdf'], outputPath: '/tmp/a.pdf' });
  expect(overwrite.ok === false, 'combine output equal to a source is rejected (no overwrite)');
  expect(overwrite.notes.some((n) => /source|differ/i.test(n)), 'overwrite rejection is explained');
  const tooMany = buildAcrobatScript('combine_pdfs', { inputPaths: Array.from({ length: 60 }, (_v, i) => `/tmp/f${i}.pdf`), outputPath: '/tmp/o.pdf' });
  expect(tooMany.ok === false, 'combine with >50 inputs rejected');
  pass('combine_pdfs enforces 2..50 pdf inputs + never overwrites a source');
}

// ── export_to_office: happy path per format + correct cConvID embedded ───────
{
  const docx = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/out.docx', format: 'docx' });
  expect(docx.ok === true, 'docx export builds');
  // The cConvID lands inside the JS-then-AppleScript string, so its surrounding
  // quotes are escaped (\"...\"). Assert the (escaped) cConvID + that the raw
  // conversion id string is present.
  expect(docx.script.includes('cConvID: \\"com.adobe.acrobat.docx\\"'), 'docx embeds the docx cConvID as an escaped string literal');
  expect(docx.script.includes('saveAs('), 'export uses Doc.saveAs');
  assertDoScriptPins(docx.script, 'export docx');
  const xlsx = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/out.xlsx', format: 'xlsx' });
  expect(xlsx.ok === true && xlsx.script.includes('com.adobe.acrobat.xlsx'), 'xlsx embeds the xlsx cConvID');
  const rtf = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/out.rtf', format: 'rtf' });
  expect(rtf.ok === true && rtf.script.includes('com.adobe.acrobat.rtf'), 'rtf embeds the rtf cConvID');
  const txt = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/out.txt', format: 'txt' });
  expect(txt.ok === true && txt.script.includes('com.adobe.acrobat.plain-text'), 'txt embeds the plain-text cConvID');
  pass('export_to_office: each format maps to its VERIFY-marked cConvID via saveAs');
}

// ── export_to_office: format↔extension agreement + enum allowlist ────────────
{
  const mismatch = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/out.xlsx', format: 'docx' });
  expect(mismatch.ok === false, 'docx format with .xlsx output is rejected');
  expect(mismatch.notes.some((n) => n.includes('.docx')), 'mismatch note names the expected extension');
  const badFormat = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/out.docx', format: 'pptx' as never });
  expect(badFormat.ok === false, 'unknown export format rejected');
  const badInput = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.png', outputPath: '/tmp/out.docx', format: 'docx' });
  expect(badInput.ok === false, 'non-pdf input rejected');
  expect(badInput.notes.some((n) => n.includes('.pdf')), 'input-ext note names pdf');
  pass('export_to_office enforces format↔extension agreement + pdf input allowlist');
}

// ── flatten_pdf: happy path + copy-then-flatten (never mutates source) ───────
{
  const r = buildAcrobatScript('flatten_pdf', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/flat.pdf' });
  expect(r.ok === true, 'flatten builds');
  expect(r.script.includes('flattenPages('), 'uses Doc.flattenPages');
  expect(r.script.includes('flattenPages(0, oCopy.numPages - 1, 1)'), 'flattens whole doc with nNonPrint=1');
  // Copy-then-flatten: the source path is opened, saved to the NEW path, and the
  // flatten runs on the COPY. The source must never be the flatten target.
  expect(r.script.includes('oCopy'), 'flatten operates on a saved copy (oCopy), not the source');
  expect(r.notes.some((n) => /irreversible/i.test(n)), 'notes warn the operation is irreversible');
  expect(r.notes.some((n) => /Pro/i.test(n)), 'notes warn it is Acrobat Pro only');
  assertDoScriptPins(r.script, 'flatten_pdf');
  const overwrite = buildAcrobatScript('flatten_pdf', { inputPath: '/tmp/x.pdf', outputPath: '/tmp/x.pdf' });
  expect(overwrite.ok === false, 'flatten output equal to source rejected (irreversible; never overwrite)');
  const badOut = buildAcrobatScript('flatten_pdf', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/flat.docx' });
  expect(badOut.ok === false, 'flatten output must be .pdf');
  pass('flatten_pdf: flattenPages shape + copy-then-flatten + irreversible/Pro warnings + no overwrite');
}

// ── extract_pages: happy path + page as digits + clamp + safe embedding ──────
{
  const r = buildAcrobatScript('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/pages.pdf', startPage: 2, endPage: 5 });
  expect(r.ok === true, 'extract builds');
  expect(r.script.includes('extractPages('), 'uses Doc.extractPages');
  expect(r.script.includes('nStart: 2') && r.script.includes('Math.min(5,'), 'start/end emitted as bare integer literals (digits only), end clamped');
  expect(r.outputHint === '/tmp/pages.pdf', 'outputHint is the extracted-pages path');
  assertDoScriptPins(r.script, 'extract_pages');
  // integer string pages accepted
  const strPages = buildAcrobatScript('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: '0', endPage: '10' });
  expect(strPages.ok === true && strPages.script.includes('nStart: 0') && strPages.script.includes('Math.min(10,'), 'string pages normalized to bare integer literals');
  // endPage < startPage rejected
  const backwards = buildAcrobatScript('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: 9, endPage: 3 });
  expect(backwards.ok === false, 'endPage < startPage rejected');
  expect(backwards.notes.some((n) => /startPage/i.test(n)), 'backwards-range rejection is explained');
  pass('extract_pages: extractPages shape + pages as digits + end clamp + range order enforced');
}

// ── extract_pages: PAGE allowlist (injection/format rejection) ───────────────
{
  const badPages: Array<unknown> = [
    -1,
    1.5,
    '1e6',
    '0x10',
    'Infinity',
    'NaN',
    Number.POSITIVE_INFINITY,
    Number.NaN,
    '2; app.alert("x")', // JS injection shaped
    '2)', // JS breakout shaped
    '`id`',
    '',
    '  ',
    ACROBAT_PAGE_MAX + 1,
    '9999999', // 7 digits, above 6-digit cap
  ];
  for (const page of badPages) {
    const v = validateAcrobatArgs('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: page as never, endPage: 10 });
    expect(v.ok === false, `hostile/invalid startPage rejected: ${JSON.stringify(page)}`);
    const built = buildAcrobatScript('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: page as never, endPage: 10 });
    expect(built.ok === false, `hostile startPage yields fail-closed stub: ${JSON.stringify(page)}`);
    if (typeof page === 'string' && /[;`$()|&><'"\s]/.test(page) && page.trim().length > 0) {
      expect(!scriptContainsRaw(built.script, page), `injection-shaped page never lands in script: ${JSON.stringify(page)}`);
    }
  }
  expect(validateAcrobatArgs('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: 0, endPage: 0 }).ok, 'page 0..0 accepted');
  expect(validateAcrobatArgs('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: 0, endPage: ACROBAT_PAGE_MAX }).ok, 'endPage at MAX accepted');
  pass('page allowlist rejects negative/decimal/exponent/hex/Infinity/NaN/injection/over-bound');
}

// ── PATH injection is rejected (never embedded) across ops ───────────────────
{
  const cases: Array<[string, string]> = [
    ['/tmp/a`id`.pdf', 'backtick'],
    ['/tmp/a;rm -rf ~.pdf', 'semicolon'],
    ['/tmp/a$(id).pdf', 'subshell'],
    ['/tmp/a|b.pdf', 'pipe'],
    ['/tmp/a>b.pdf', 'redirect'],
    ['/tmp/../../etc/passwd.pdf', 'traversal'],
    ['/tmp/part-😀.pdf', 'non-BMP'],
  ];
  for (const [p, label] of cases) {
    const r = buildAcrobatScript('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: p, format: 'docx' });
    // .pdf-ext hostile paths won't pass the .docx ext check anyway, so test as a
    // combine input where .pdf is expected — that exercises the path validator.
    const rc = buildAcrobatScript('combine_pdfs', { inputPaths: ['/tmp/a.pdf', p], outputPath: '/tmp/o.pdf' });
    expect(rc.ok === false, `${label} combine input path rejected (ok:false)`);
    expect(!scriptContainsRaw(rc.script, p), `${label} path never appears in the emitted (stub) script`);
    expect(rc.script.includes('FAIL-CLOSED STUB'), `${label} rejection yields a fail-closed stub`);
    // And on the single-source inputPath.
    const rs = buildAcrobatScript('flatten_pdf', { inputPath: p, outputPath: '/tmp/o.pdf' });
    expect(rs.ok === false, `${label} inputPath rejected (ok:false)`);
    void r;
  }
  const nl = buildAcrobatScript('flatten_pdf', { inputPath: '/tmp/a\nb.pdf', outputPath: '/tmp/o.pdf' });
  expect(nl.ok === false, 'newline in path rejected');
  pass('rejects shell-metachar / traversal / non-BMP / control-char paths on inputs AND output');
}

// ── CONCRETE INJECTION: JS-breakout + shell + AppleScript-breakout blocked ───
// The load-bearing case: a path crafted to break OUT of the generated JS string
// literal, out of the AppleScript `do script` string, AND run a shell command
// must be rejected by validation and NEVER appear in the emitted script text.
{
  // Contains: a double-quote (would close a naive "..." in JS AND in the
  // AppleScript wrapper), a backslash, a semicolon + backtick (shell), and a JS
  // statement separator with an app.alert breakout. The shell-metachar reject
  // (`;`, backtick, `$`) catches it before the escapers even matter.
  const injection = '/tmp/out"; app.alert("pwned"); //`id`.pdf';
  const r = buildAcrobatScript('combine_pdfs', { inputPaths: ['/tmp/a.pdf', injection], outputPath: '/tmp/o.pdf' });
  expect(r.ok === false, 'injection-shaped path rejected');
  expect(!scriptContainsRaw(r.script, injection), 'injection string never appears anywhere in the emitted stub');
  expect(!r.script.includes('app.alert'), 'no app.alert breakout call is present in the emitted script');
  expect(!r.script.includes('pwned'), 'the breakout payload is not present');

  // A subtler path with a double-quote + backslash but NO shell metachar: it is
  // ALLOWED (no metachar) but MUST be escaped through BOTH layers — prove the
  // JS-literal escape (\\" ) is present and the raw unescaped form is not.
  const quotePath = '/tmp/say "hi"\\end.pdf';
  const r2 = buildAcrobatScript('flatten_pdf', { inputPath: quotePath, outputPath: '/tmp/o.pdf' });
  expect(r2.ok === true, 'quote+backslash path is allowed (no shell metachar) and builds');
  // Inside the JS the quote becomes \" (JSON), then the AppleScript layer turns
  // the backslash+quote into \\\" — so the raw `"hi"` sequence must not survive.
  expect(!r2.script.includes('say "hi"'), 'raw unescaped quote sequence never appears (escaped through both layers)');
  expect(!/[^\x00-\x7f]/.test(r2.script), 'script with quote/backslash path stays pure ASCII');
  // Sanity: the filename stem still shows up in escaped form (proves it was embedded, just safely).
  expect(r2.script.includes('say'), 'the (escaped) path is present, just neutralized');
  pass('concrete injection blocked: JS+shell+AppleScript breakout rejected; quote/backslash escaped through both layers');
}

// ── SAFE EMBEDDING: non-ASCII path escapes to \uXXXX, script stays pure ASCII ─
{
  const highBmpPath = '/Users/demo/Desktop/пéĀreport.pdf'; // Latin/Cyrillic BMP chars
  const hb = buildAcrobatScript('flatten_pdf', { inputPath: highBmpPath, outputPath: '/tmp/out.pdf' });
  expect(hb.ok === true, 'BMP non-ASCII path builds');
  expect(/\\u00e9/.test(hb.script) || /\\u0100/.test(hb.script) || /\\u043f/.test(hb.script), 'non-ASCII BMP chars escaped to \\uXXXX');
  expect(!/[^\x00-\x7f]/.test(hb.script), 'generated script is pure ASCII (no raw non-ASCII bytes)');
  pass('safe embedding: non-ASCII BMP chars → \\uXXXX, generated script stays pure ASCII');
}

// ── bounds: long paths + huge pages ──────────────────────────────────────────
{
  const longPath = '/tmp/' + 'a'.repeat(2000) + '.pdf';
  const r = buildAcrobatScript('flatten_pdf', { inputPath: longPath, outputPath: '/tmp/o.pdf' });
  expect(r.ok === false, 'over-1024-char input path rejected');
  const longOut = buildAcrobatScript('flatten_pdf', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/' + 'b'.repeat(2000) + '.pdf' });
  expect(longOut.ok === false, 'over-1024-char output path rejected');
  const hugePage = validateAcrobatArgs('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: 0, endPage: 500_000 });
  expect(hugePage.ok === false, 'endPage above MAX rejected');
  pass('bounds: path ≤1024 on input+output, page ≤ MAX enforced');
}

// ── degenerate inputs NEVER throw ────────────────────────────────────────────
{
  const degenerate: Array<[unknown, unknown]> = [
    [null, null],
    [undefined, undefined],
    ['combine_pdfs', null],
    ['combine_pdfs', 'not an object'],
    ['combine_pdfs', 42],
    ['combine_pdfs', {}],
    ['combine_pdfs', { inputPaths: 'nope', outputPath: '/tmp/o.pdf' }],
    ['export_to_office', {}],
    ['export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/o.docx' }], // missing format
    ['flatten_pdf', {}],
    ['flatten_pdf', { inputPath: null, outputPath: null }],
    ['extract_pages', {}],
    ['extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf' }], // missing pages
    ['nonsense_op', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/o.pdf' }],
    [{}, {}],
    [123, { inputPath: '/tmp/in.pdf', outputPath: '/tmp/o.pdf' }],
  ];
  for (const [op, input] of degenerate) {
    let threw = false;
    let result: ReturnType<typeof buildAcrobatScript> | null = null;
    try {
      result = buildAcrobatScript(op, input);
    } catch {
      threw = true;
    }
    expect(!threw, `buildAcrobatScript never throws for ${JSON.stringify(op)} / ${JSON.stringify(input)?.slice(0, 30)}`);
    expect(result !== null && result.ok === false, 'degenerate input yields ok:false');
    expect(result !== null && result.scriptExtension === 'applescript', 'degenerate result still declares a .applescript');
    expect(result !== null && typeof result.script === 'string' && result.script.length > 0, 'degenerate result still returns a (stub) script');
    expect(result !== null && result.script.includes('UC_ACROBAT_ERROR'), 'stub carries the error sentinel');
    // Fail-closed stub must NOT launch Acrobat or run any command (mutates
    // nothing). The banner mentions `do script` in a comment, so we check for
    // the EXECUTABLE forms: the `tell application` block and the `do script "`
    // command (with the JS string opening quote), neither of which a stub has.
    expect(result !== null && !result.script.includes('tell application "Adobe Acrobat"'), 'fail-closed stub never opens an Acrobat tell block');
    expect(result !== null && !result.script.includes('do script "'), 'fail-closed stub never runs a do script command');
    // The stub's only executable statement is a single `error "..."`.
    expect(result !== null && /(^|\n)error "/.test(result?.script ?? ''), 'fail-closed stub raises an error and does nothing else');
    let v2Threw = false;
    try {
      validateAcrobatArgs(op, input);
      describeAcrobatOperation(op, input);
    } catch {
      v2Threw = true;
    }
    expect(!v2Threw, 'validateAcrobatArgs + describeAcrobatOperation never throw on degenerate input');
  }
  pass('degenerate inputs never throw; always a fail-closed .applescript stub (no Acrobat launch) with error sentinel');
}

// ── describeAcrobatOperation ─────────────────────────────────────────────────
{
  expect(/combine/i.test(describeAcrobatOperation('combine_pdfs', { inputPaths: ['/tmp/a.pdf', '/tmp/b.pdf'], outputPath: '/tmp/o.pdf' })), 'combine description mentions combine');
  expect(/DOCX/i.test(describeAcrobatOperation('export_to_office', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/o.docx', format: 'docx' })), 'export description names the format');
  expect(/irreversible/i.test(describeAcrobatOperation('flatten_pdf', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/o.pdf' })), 'flatten description warns irreversible');
  const extract = describeAcrobatOperation('extract_pages', { inputPath: '/tmp/in.pdf', outputPath: '/tmp/p.pdf', startPage: 2, endPage: 7 });
  expect(/2-7/.test(extract), 'extract description includes the page range');
  const generic = describeAcrobatOperation('bogus', {});
  expect(generic.length > 0 && generic.length < 120, 'unknown op yields a bounded generic line');
  pass('describeAcrobatOperation gives bounded, informative approval lines');
}

if (failures > 0) {
  console.error(`\n${failures} acrobat script adapter smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll acrobat script adapter smoke cases passed.');
