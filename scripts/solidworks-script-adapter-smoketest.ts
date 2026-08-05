/**
 * solidworks-script-adapter-smoketest — verifies the PURE SolidWorks VBA macro
 * generator (src/lib/solidworksScriptAdapter.ts). SECURITY-HEAVY by design:
 *   - VBA string escaper: quote-DOUBLING (not backslash), newline/control-char
 *     REJECTION (VBA has no in-literal escape/continuation), injection blocked.
 *   - Per-field allowlists: dimension-name pattern, plain-number pattern,
 *     absolute-Windows/UNC path (metachar/traversal/BMP rejects).
 *   - A concrete injection example that would break out of the literal is
 *     proven blocked.
 *   - Bounds (magnitude, macro size), macro-shape pins (Option Explicit,
 *     Sub main, SaveAs/SystemValue/EditRebuild, fail-closed MsgBox/Err),
 *     approval flags, engine-descriptor report shape.
 *   - Degenerate/hostile inputs NEVER throw (return typed { ok: false }).
 *
 * Run: npx tsx scripts/solidworks-script-adapter-smoketest.ts
 */

import {
  buildSolidWorksMacro,
  describeSolidWorksOperation,
  isSolidWorksOperation,
  SOLIDWORKS_ENGINE_DESCRIPTOR_REPORT,
  SOLIDWORKS_EXPORT_FORMATS,
  SOLIDWORKS_OPERATIONS,
  validateDimensionName,
  validateDimensionValue,
  validateSolidWorksArgs,
  validateSolidWorksPath,
  vbaStringLiteral,
} from '../src/lib/solidworksScriptAdapter';

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

// ── vbaStringLiteral: quote doubling ────────────────────────────────────────
{
  const r = vbaStringLiteral('C:\\Exports\\part.step');
  expect(r.ok === true, 'plain path becomes a literal');
  if (r.ok) {
    expect(r.literal === '"C:\\Exports\\part.step"', `backslashes are NOT escaped in VBA (got ${r.literal})`);
    // Critical: VBA uses backslash literally, unlike Python/JSON.
    expect(!r.literal.includes('\\\\'), 'VBA literal does not double backslashes (that would corrupt the path)');
  }
  const q = vbaStringLiteral('say "hi" now');
  expect(q.ok === true, 'quoted string becomes a literal');
  if (q.ok) {
    expect(q.literal === '"say ""hi"" now"', `embedded double-quotes are DOUBLED (got ${q.literal})`);
  }
  const many = vbaStringLiteral('""');
  expect(many.ok === true, 'string of only quotes builds');
  if (many.ok) expect(many.literal === '""""""', 'two quotes → four doubled quotes inside outer pair');
  pass('vbaStringLiteral doubles quotes and leaves backslashes literal (VBA rules, not JSON)');
}

// ── vbaStringLiteral: newline / control-char REJECTION ──────────────────────
{
  // A newline cannot be represented in a VBA literal → must be rejected, not
  // encoded. This is what makes quote-doubling sufficient against injection.
  const nl = vbaStringLiteral('a\nb');
  expect(!nl.ok, 'newline rejected (no in-literal line continuation in VBA)');
  const cr = vbaStringLiteral('a\r\nb');
  expect(!cr.ok, 'CRLF rejected');
  const tab = vbaStringLiteral('a\tb');
  expect(!tab.ok, 'tab (control char) rejected');
  const nul = vbaStringLiteral('a\x00b');
  expect(!nul.ok, 'NUL rejected');
  const del = vbaStringLiteral('a\x7fb');
  expect(!del.ok, 'DEL (0x7f) rejected');
  const c1 = vbaStringLiteral('a\x85b');
  expect(!c1.ok, 'C1 control (NEL 0x85) rejected');
  const lineSep = vbaStringLiteral('a b');
  expect(!lineSep.ok, 'Unicode LINE SEPARATOR rejected');
  const paraSep = vbaStringLiteral('a b');
  expect(!paraSep.ok, 'Unicode PARAGRAPH SEPARATOR rejected');
  const empty = vbaStringLiteral('');
  expect(!empty.ok, 'empty string rejected');
  const nonString = vbaStringLiteral(42 as never);
  expect(!nonString.ok, 'non-string rejected');
  pass('vbaStringLiteral rejects every newline/control-char form (unrepresentable in a VBA literal)');
}

// ── INJECTION EXAMPLE: a hostile value cannot break out of the literal ──────
{
  // Classic VBA-literal breakout attempt: close the string, inject a call, and
  // comment out the trailing quote — e.g. from a malicious "path":
  //   C:\x.step" : Shell "calc.exe" : '
  // If we naively wrote  exportPath = "<raw>"  this would become:
  //   exportPath = "C:\x.step" : Shell "calc.exe" : ''"
  // i.e. an injected `Shell` statement. The path allowlist rejects the quote,
  // and even the raw escaper would double the quotes into inert data. Prove
  // BOTH layers hold.
  const attack = 'C:\\x.step" : Shell "calc.exe" : \'';
  const viaPath = validateSolidWorksPath(attack);
  expect(!viaPath.ok, 'path allowlist rejects the injection (embedded double-quote)');

  // Even if such a value somehow reached the escaper directly, doubling makes
  // it inert data (no statement separator, no early close). It contains no
  // newline, so it is representable — the doubling is what neutralizes it.
  const escaped = vbaStringLiteral(attack);
  expect(escaped.ok === true, 'escaper still produces a literal (no newline present)');
  if (escaped.ok) {
    // Every original quote is doubled; the value stays one contiguous literal.
    expect(escaped.literal.startsWith('"') && escaped.literal.endsWith('"'), 'result is wrapped in a single outer pair');
    expect(escaped.literal.includes('""'), 'inner quotes were doubled');
    // The dangerous substring `" : Shell` must NOT appear as a literal-closer:
    // after doubling, the quote before " : Shell" is `""`, keeping it inside.
    expect(!/[^"]"\s*:\s*Shell/i.test(escaped.literal), 'no un-doubled quote precedes an injected statement separator');
  }

  // And the full macro build refuses the attack outright at the arg gate.
  const built = buildSolidWorksMacro('export', { outputPath: attack, format: 'step' });
  expect(!built.ok, 'buildSolidWorksMacro rejects the injection path (fail closed)');
  pass('INJECTION BLOCKED: `...step" : Shell "calc.exe" : \'` refused by allowlist + neutralized by escaper');
}

// ── validateSolidWorksPath allowlist matrix ─────────────────────────────────
{
  expect(validateSolidWorksPath('C:\\Exports\\part.step').ok, 'drive-absolute backslash path allowed');
  expect(validateSolidWorksPath('C:/Exports/part.step').ok, 'drive-absolute forward-slash path allowed');
  expect(validateSolidWorksPath('\\\\server\\share\\part.step').ok, 'UNC path allowed');
  expect(!validateSolidWorksPath('Exports\\part.step').ok, 'relative path rejected (would hit SolidWorks CWD)');
  expect(!validateSolidWorksPath('part.step').ok, 'bare filename rejected');
  expect(!validateSolidWorksPath('C:\\Exports\\..\\..\\Windows\\evil.step').ok, '.. traversal rejected');
  expect(!validateSolidWorksPath('C:\\a\\b.step; del *').ok, 'semicolon metachar rejected');
  expect(!validateSolidWorksPath('C:\\a\\`whoami`.step').ok, 'backtick rejected');
  expect(!validateSolidWorksPath('C:\\a\\$(id).step').ok, '$ rejected');
  expect(!validateSolidWorksPath('C:\\a\\b|c.step').ok, 'pipe rejected');
  expect(!validateSolidWorksPath('C:\\a\\b&c.step').ok, 'ampersand rejected');
  expect(!validateSolidWorksPath('C:\\a\\b>c.step').ok, 'redirect rejected');
  expect(!validateSolidWorksPath('C:\\a\\say"hi".step').ok, 'embedded double-quote rejected');
  expect(!validateSolidWorksPath('C:\\a\\part*.step').ok, 'wildcard * rejected');
  expect(!validateSolidWorksPath('C:\\a\\part?.step').ok, 'wildcard ? rejected');
  expect(!validateSolidWorksPath('C:\\a\\b\nc.step').ok, 'newline rejected');
  expect(!validateSolidWorksPath('C:\\a\\part-😀.step').ok, 'non-BMP char rejected');
  expect(!validateSolidWorksPath('C:\\' + 'x'.repeat(1100) + '.step').ok, 'over-length path rejected');
  expect(!validateSolidWorksPath('   ').ok, 'whitespace-only path rejected');
  expect(!validateSolidWorksPath(123 as never).ok, 'non-string path rejected');
  pass('path allowlist accepts absolute Windows/UNC and rejects relative/metachar/traversal/BMP/oversize');
}

// ── validateDimensionName allowlist matrix ──────────────────────────────────
{
  expect(validateDimensionName('D1@Sketch1').ok, 'D1@Sketch1 allowed');
  expect(validateDimensionName('Length@Boss-Extrude1').ok, 'hyphen + word dim allowed');
  expect(validateDimensionName('D2@Sketch3@Part1.Part').ok, 'multi-@ with dot allowed');
  expect(validateDimensionName('Overall Width@Sketch2').ok, 'space in dim name allowed');
  expect(!validateDimensionName('Sketch1').ok, 'name without @ separator rejected');
  expect(!validateDimensionName('D1@Sketch1"; Shell "x').ok, 'quote/semicolon injection in dim name rejected');
  expect(!validateDimensionName('D1@Sketch1\nEvil').ok, 'newline in dim name rejected');
  expect(!validateDimensionName('D1@Sketch(1)').ok, 'parentheses rejected');
  expect(!validateDimensionName('=cmd@x').ok, 'leading = rejected');
  expect(!validateDimensionName('@Sketch1').ok, 'empty dim part before @ rejected');
  expect(!validateDimensionName('D1@').ok, 'empty feature part after @ rejected');
  expect(!validateDimensionName('D1@' + 'x'.repeat(200)).ok, 'over-length dim name rejected');
  expect(!validateDimensionName('').ok, 'empty dim name rejected');
  expect(!validateDimensionName(null as never).ok, 'non-string dim name rejected');
  pass('dimension-name allowlist: requires @<feature>, no quotes/metachars/parens/newlines');
}

// ── validateDimensionValue allowlist + bounds ───────────────────────────────
{
  const a = validateDimensionValue(42);
  expect(a.ok && a.text === '42', 'integer value accepted, canonical text');
  const b = validateDimensionValue('12.5');
  expect(b.ok && b.value === 12.5 && b.text === '12.5', 'decimal string accepted');
  const c = validateDimensionValue(-3.25);
  expect(c.ok && c.text === '-3.25', 'negative decimal accepted');
  expect(!validateDimensionValue('1e9').ok, 'exponent notation rejected');
  expect(!validateDimensionValue('0x10').ok, 'hex rejected');
  expect(!validateDimensionValue('+5').ok, 'leading + rejected');
  expect(!validateDimensionValue('12; Shell "x"').ok, 'injection-shaped numeric string rejected');
  expect(!validateDimensionValue('12,5').ok, 'comma decimal rejected (locale ambiguity)');
  expect(!validateDimensionValue(Number.POSITIVE_INFINITY).ok, 'Infinity rejected');
  expect(!validateDimensionValue(Number.NaN).ok, 'NaN rejected');
  expect(!validateDimensionValue(5_000_000).ok, 'over-magnitude value rejected');
  expect(!validateDimensionValue({} as never).ok, 'object rejected');
  expect(!validateDimensionValue('').ok, 'empty string rejected');
  pass('dimension-value allowlist: plain finite decimals only, bounded, no exponent/injection');
}

// ── validateSolidWorksArgs: export ──────────────────────────────────────────
{
  const ok = validateSolidWorksArgs('export', { outputPath: 'C:\\Exports\\part.step', format: 'step' });
  expect(ok.ok, 'valid STEP export validates');
  const stp = validateSolidWorksArgs('export', { outputPath: 'C:\\Exports\\part.stp', format: 'step' });
  expect(stp.ok, '.stp accepted for STEP');
  const xt = validateSolidWorksArgs('export', { outputPath: 'C:\\Exports\\part.x_t', format: 'parasolid' });
  expect(xt.ok, '.x_t accepted for Parasolid');
  const pdf = validateSolidWorksArgs('export', { outputPath: 'C:\\Exports\\drawing.pdf', format: 'pdf' });
  expect(pdf.ok, '.pdf accepted for PDF');
  if (pdf.ok) expect(pdf.notes.some((n) => /drawing/i.test(n)), 'PDF note clarifies it targets the drawing doc');
  const mismatch = validateSolidWorksArgs('export', { outputPath: 'C:\\Exports\\part.pdf', format: 'step' });
  expect(!mismatch.ok, 'extension/format mismatch rejected (step vs .pdf)');
  const badFmt = validateSolidWorksArgs('export', { outputPath: 'C:\\Exports\\part.step', format: 'obj' });
  expect(!badFmt.ok, 'unknown format rejected');
  const badPath = validateSolidWorksArgs('export', { outputPath: 'part.step', format: 'step' });
  expect(!badPath.ok, 'relative export path rejected');
  pass('validateSolidWorksArgs export: format/extension agreement + path safety');
}

// ── validateSolidWorksArgs: set_dimension unit conversion ───────────────────
{
  const mm = validateSolidWorksArgs('set_dimension', { dimensionName: 'D1@Sketch1', value: 50, unit: 'mm' });
  expect(mm.ok, '50mm validates');
  if (mm.ok) {
    expect(mm.normalized.systemValueMetersText === '0.05', `50mm → 0.05m (got ${mm.normalized.systemValueMetersText})`);
    expect(mm.normalized.displayValue === '50', 'display value preserved');
  }
  const inch = validateSolidWorksArgs('set_dimension', { dimensionName: 'D1@Sketch1', value: 1, unit: 'in' });
  expect(inch.ok && inch.normalized.systemValueMetersText === '0.0254', '1in → 0.0254m');
  const dfltUnit = validateSolidWorksArgs('set_dimension', { dimensionName: 'D1@Sketch1', value: 10 });
  expect(dfltUnit.ok && dfltUnit.normalized.unit === 'mm', 'unit defaults to mm');
  const badUnit = validateSolidWorksArgs('set_dimension', { dimensionName: 'D1@Sketch1', value: 10, unit: 'furlong' });
  expect(!badUnit.ok, 'unknown unit rejected');
  const badName = validateSolidWorksArgs('set_dimension', { dimensionName: 'nope', value: 10 });
  expect(!badName.ok, 'bad dimension name rejected at args gate');
  const badVal = validateSolidWorksArgs('set_dimension', { dimensionName: 'D1@Sketch1', value: '1e9' });
  expect(!badVal.ok, 'bad value rejected at args gate');
  pass('validateSolidWorksArgs set_dimension: unit→meters conversion + fail-closed on bad name/value/unit');
}

// ── validateSolidWorksArgs: rebuild_and_save_copy ───────────────────────────
{
  const ok = validateSolidWorksArgs('rebuild_and_save_copy', { copyPath: 'C:\\Backups\\part-copy.sldprt' });
  expect(ok.ok, 'valid save-copy validates');
  if (ok.ok) expect(ok.notes.some((n) => /copy/i.test(n)), 'note clarifies copy does not move the open doc');
  const noExt = validateSolidWorksArgs('rebuild_and_save_copy', { copyPath: 'C:\\Backups\\noext' });
  expect(!noExt.ok, 'copy path without a document extension rejected');
  const badOp = validateSolidWorksArgs('detonate', { copyPath: 'C:\\x\\y.sldprt' });
  expect(!badOp.ok, 'unknown operation rejected');
  pass('validateSolidWorksArgs rebuild_and_save_copy: requires doc extension, rejects unknown op');
}

// ── buildSolidWorksMacro: export macro shape ────────────────────────────────
{
  const built = buildSolidWorksMacro('export', { outputPath: 'C:\\Exports\\part.step', format: 'step' });
  expect(built.ok, 'export macro builds');
  if (built.ok) {
    expect(built.vba.includes('Option Explicit'), 'macro declares Option Explicit');
    expect(built.vba.includes('Sub main()') && built.vba.includes('End Sub'), 'macro has Sub main entry point');
    expect(built.vba.includes('Set swApp = Application.SldWorks'), 'attaches to running SldWorks');
    expect(built.vba.includes('Set swModel = swApp.ActiveDoc'), 'gets active document');
    expect(built.vba.includes('If swModel Is Nothing Then'), 'fails closed when no active doc');
    expect(built.vba.includes('exportPath = "C:\\Exports\\part.step"'), 'path embedded as a VBA literal (backslashes intact)');
    expect(built.vba.includes('SaveAs3'), 'export uses SaveAs3');
    expect(built.vba.includes('UC_SW_ERROR'), 'macro raises sentinel errors on failure');
    expect(built.vba.includes('UC_SW_DONE'), 'macro prints a done sentinel');
    expect(built.vba.includes('\r\n'), 'macro uses CRLF line endings (VBA convention)');
    expect(built.suggestedFileName === 'uc-solidworks-export-step.bas', 'deterministic staging filename');
    expect(built.entryPoint === 'main', 'entry point reported');
    expect(built.mutates === true && built.requiresApproval === true, 'export flagged mutating + approval-required');
    expect(built.notes.some((n) => /[Aa]pproval/.test(n)), 'notes mention approval');
  }
  pass('export macro: preamble, fail-closed active-doc check, SaveAs3, sentinels, approval flags');
}

// ── buildSolidWorksMacro: set_dimension macro shape ─────────────────────────
{
  const built = buildSolidWorksMacro('set_dimension', { dimensionName: 'D1@Sketch1', value: 50, unit: 'mm' });
  expect(built.ok, 'set_dimension macro builds');
  if (built.ok) {
    expect(built.vba.includes('dimName = "D1@Sketch1"'), 'dimension name embedded as a VBA literal');
    expect(built.vba.includes('swModel.Parameter(dimName)'), 'resolves the named parameter');
    expect(built.vba.includes('.SystemValue = 0.05'), 'sets SystemValue in meters (50mm → 0.05)');
    expect(built.vba.includes('EditRebuild3'), 'rebuilds after the change');
    expect(!/\.SystemValue = 50\b/.test(built.vba), 'does NOT embed the raw mm value as SystemValue (would be 50 meters)');
    expect(built.suggestedFileName === 'uc-solidworks-set-dimension.bas', 'deterministic staging filename');
  }
  pass('set_dimension macro: named Parameter, meters SystemValue, EditRebuild3');
}

// ── buildSolidWorksMacro: rebuild_and_save_copy macro shape ─────────────────
{
  const built = buildSolidWorksMacro('rebuild_and_save_copy', { copyPath: 'C:\\Backups\\part-copy.sldprt' });
  expect(built.ok, 'rebuild_and_save_copy macro builds');
  if (built.ok) {
    expect(built.vba.includes('copyPath = "C:\\Backups\\part-copy.sldprt"'), 'copy path embedded as a VBA literal');
    expect(built.vba.includes('EditRebuild3'), 'rebuilds before saving the copy');
    expect(built.vba.includes('Extension.SaveAs'), 'uses Extension.SaveAs for the copy');
    expect(built.vba.includes(', 0, 2, Nothing,'), 'passes the Copy option (2) so the open doc path is unchanged');
    expect(built.suggestedFileName === 'uc-solidworks-rebuild-save-copy.bas', 'deterministic staging filename');
  }
  pass('rebuild_and_save_copy macro: EditRebuild3 then Extension.SaveAs with Copy option');
}

// ── Escaping is applied end-to-end in a built macro ─────────────────────────
{
  // A legitimate path containing a space and (hypothetically) survivable chars
  // must be embedded via the escaper. Use a path with a doubled-safe apostrophe
  // in a folder name (apostrophe is not a metachar and is legal in the literal).
  const built = buildSolidWorksMacro('export', { outputPath: "C:\\O'Brien Parts\\bracket.step", format: 'step' });
  expect(built.ok, "path with an apostrophe builds");
  if (built.ok) {
    // Apostrophe is legal in a VBA string literal and needs no doubling.
    expect(built.vba.includes('"C:\\O\'Brien Parts\\bracket.step"'), 'apostrophe path embedded verbatim inside the literal');
  }
  pass('legitimate special characters flow through the escaper into the literal');
}

// ── describeSolidWorksOperation ─────────────────────────────────────────────
{
  const exp = describeSolidWorksOperation('export', { outputPath: 'C:\\x\\p.step', format: 'step' });
  expect(/STEP/.test(exp) && /approval/i.test(exp), 'export description names STEP + approval');
  const dim = describeSolidWorksOperation('set_dimension', { dimensionName: 'D1@Sketch1', value: 50, unit: 'mm' });
  expect(/D1@Sketch1/.test(dim) && /50 mm/.test(dim), 'dimension description names the dim + value');
  const copy = describeSolidWorksOperation('rebuild_and_save_copy', { copyPath: 'C:\\x\\c.sldprt' });
  expect(/copy/i.test(copy), 'copy description mentions a copy');
  const bad = describeSolidWorksOperation('nope', {});
  expect(typeof bad === 'string' && bad.length > 0, 'bad op yields a safe generic description');
  pass('describeSolidWorksOperation gives plain-language, approval-aware one-liners');
}

// ── isSolidWorksOperation + constant surfaces ───────────────────────────────
{
  expect(isSolidWorksOperation('export') && isSolidWorksOperation('set_dimension') && isSolidWorksOperation('rebuild_and_save_copy'), 'all ops recognized');
  expect(!isSolidWorksOperation('delete_everything') && !isSolidWorksOperation(null), 'unknown/non-string ops rejected');
  expect(SOLIDWORKS_OPERATIONS.length === 3, 'three operations exported');
  expect(SOLIDWORKS_EXPORT_FORMATS.length === 4, 'four export formats exported');
  pass('operation guard + exported constant surfaces');
}

// ── Engine descriptor report shape (reported, NOT wired) ────────────────────
{
  const d = SOLIDWORKS_ENGINE_DESCRIPTOR_REPORT;
  expect(d.id === 'solidworks_macro', 'engine id is solidworks_macro');
  expect(d.platform === 'windows', 'platform is windows (no macOS SolidWorks)');
  expect(d.verifiedInvocation === false, 'verifiedInvocation is false — gates live wiring');
  expect(Array.isArray(d.sourceExtensions) && d.sourceExtensions.includes('swp') && d.sourceExtensions.includes('bas'), 'source extensions .swp/.bas');
  expect(Array.isArray(d.outputExtensions) && d.outputExtensions.length === 0, 'output extensions empty (macro chooses; stat-verified)');
  expect(d.defaultTimeoutMs <= d.maxTimeoutMs, 'default timeout within max');
  expect(d.entryPoint === 'main', 'entry point is main');
  expect(d.notes.some((n) => /RunMacro2/.test(n)), 'notes explain the COM RunMacro2 host (not execFile)');
  expect(d.notes.some((n) => /VERIFY/.test(n)), 'notes carry the VERIFY discipline');
  pass('engine descriptor report: shape matches AppScriptEngineDescriptor + windows/COM caveats');
}

// ── Degenerate inputs NEVER throw ───────────────────────────────────────────
{
  const cases: Array<[unknown, unknown]> = [
    [undefined, undefined],
    [null, null],
    ['export', null],
    ['export', {}],
    ['export', { outputPath: null, format: undefined }],
    ['set_dimension', { dimensionName: 123, value: {} }],
    ['rebuild_and_save_copy', 'not-an-object'],
    [{}, []],
    ['', ''],
    [42, 42],
    ['export', { outputPath: 'C:\\x\\p.step' }], // missing format
  ];
  for (const [op, input] of cases) {
    try {
      const v = validateSolidWorksArgs(op, input);
      expect(v.ok === false || v.ok === true, 'validate returns a typed result');
      const b = buildSolidWorksMacro(op, input);
      expect(typeof b.ok === 'boolean', 'build returns a typed result');
      const d = describeSolidWorksOperation(op, input);
      expect(typeof d === 'string', 'describe returns a string');
    } catch (err) {
      fail(`degenerate input threw: op=${JSON.stringify(op)} input=${JSON.stringify(input)} err=${String(err)}`);
    }
  }
  pass('degenerate/hostile inputs never throw — always a typed result');
}

if (failures > 0) {
  console.error(`\n${failures} solidworks script adapter smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll solidworks script adapter smoke cases passed.');
