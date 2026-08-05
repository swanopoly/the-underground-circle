/**
 * fusion360-script-adapter-smoketest — verifies the PURE Fusion 360 Python
 * script generator (src/lib/fusion360ScriptAdapter.ts). Security-heavy:
 *
 *   - parameter-NAME identifier allowlist (+ injection rejection)
 *   - numeric-VALUE plain-decimal allowlist (exponent/hex/Infinity/injection reject)
 *   - units allowlist (only the known set; hostile units dropped)
 *   - path allowlist (control/shell-metachar/non-BMP/traversal reject)
 *   - SAFE embedding: a path/value containing quotes + newline never lands raw
 *     in the generated Python — only as an escaped `pythonStringLiteral`
 *   - script-shape pins per operation (export_model STEP/STL/F3D,
 *     set_user_parameter, export_drawing_pdf) incl. fail-closed guards + banner
 *   - bounds (long strings, huge numbers)
 *   - degenerate inputs NEVER throw (null/garbage → fail-closed stub, ok:false)
 *
 * Run: npx tsx scripts/fusion360-script-adapter-smoketest.ts
 */

import {
  buildFusion360Script,
  describeFusion360Operation,
  FUSION360_EXPORT_FORMATS,
  FUSION360_OPERATIONS,
  validateFusion360Args,
} from '../src/lib/fusion360ScriptAdapter';

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
// contains a metachar/quote/newline that the escaper would have transformed, so
// its literal presence in the script is proof of unsafe concatenation.
function scriptContainsRaw(script: string, raw: string): boolean {
  return script.includes(raw);
}

// ── Operation + format enums are stable ──────────────────────────────────────
{
  expect(FUSION360_OPERATIONS.length === 3, 'three operations exposed');
  expect(
    FUSION360_OPERATIONS.includes('export_model') &&
      FUSION360_OPERATIONS.includes('set_user_parameter') &&
      FUSION360_OPERATIONS.includes('export_drawing_pdf'),
    'operation set is export_model / set_user_parameter / export_drawing_pdf',
  );
  expect(FUSION360_EXPORT_FORMATS.join(',') === 'step,stl,f3d', 'export formats are step,stl,f3d');
  pass('operation + export-format enums are the documented set');
}

// ── export_model: STEP happy path + safe path embedding ──────────────────────
{
  const outputPath = "/Users/demo/My 'Parts'/bracket v2.step";
  const result = buildFusion360Script('export_model', { outputPath, format: 'step' });
  expect(result.ok === true, 'step export builds');
  expect(result.scriptExtension === 'py', 'scriptExtension is py');
  expect(result.outputHint === outputPath, 'outputHint echoes the validated path');
  expect(result.script.includes(`OUTPUT_PATH = ${JSON.stringify(outputPath)}`), 'output path embedded as escaped literal (JSON repr)');
  expect(result.script.includes('createSTEPExportOptions'), 'STEP uses createSTEPExportOptions');
  expect(result.script.includes('export_mgr.execute(options)'), 'export executes the options');
  expect(result.script.includes('os.path.isfile(OUTPUT_PATH)'), 'script verifies its own output exists');
  expect(result.script.includes('UC_FUSION_ERROR'), 'script fails closed with the error sentinel');
  expect(result.script.includes('# VERIFY adsk.* API calls'), 'generated script carries the VERIFY banner');
  expect(result.script.includes('adsk.fusion.Design.cast'), 'casts active product to a Design');
  expect(result.script.includes('if design is None'), 'fails closed when no active design');
  pass('export_model STEP: shape pins + safe path embedding + fail-closed guards');
}

// ── export_model: STL + F3D shapes ───────────────────────────────────────────
{
  const stl = buildFusion360Script('export_model', { outputPath: '/tmp/part.stl', format: 'stl' });
  expect(stl.ok === true, 'stl export builds');
  expect(stl.script.includes('createSTLExportOptions'), 'STL uses createSTLExportOptions');
  expect(stl.script.includes('design.rootComponent'), 'STL export references the root component geometry');
  const f3d = buildFusion360Script('export_model', { outputPath: '/tmp/part.f3d', format: 'f3d' });
  expect(f3d.ok === true, 'f3d export builds');
  expect(f3d.script.includes('createFusionArchiveExportOptions'), 'F3D uses createFusionArchiveExportOptions');
  pass('export_model STL + F3D map to the right ExportManager factory');
}

// ── export_model: extension must match format ────────────────────────────────
{
  const mismatch = buildFusion360Script('export_model', { outputPath: '/tmp/part.stl', format: 'step' });
  expect(mismatch.ok === false, 'STEP format with .stl path is rejected');
  expect(mismatch.notes.some((n) => n.includes('.step')), 'mismatch note names the expected extension');
  const badFormat = buildFusion360Script('export_model', { outputPath: '/tmp/part.step', format: 'obj' as never });
  expect(badFormat.ok === false, 'unknown export format rejected');
  pass('export_model enforces format↔extension agreement');
}

// ── export_model: hostile path injection is rejected (never embedded) ────────
{
  const cases: Array<[string, string]> = [
    ['/tmp/a`id`.step', 'backtick'],
    ['/tmp/a;rm -rf ~.step', 'semicolon'],
    ['/tmp/a$(id).step', 'subshell'],
    ['/tmp/a|b.step', 'pipe'],
    ['/tmp/a>b.step', 'redirect'],
    ['/tmp/../../etc/passwd.step', 'traversal'],
    ['/tmp/part-😀.step', 'non-BMP'],
  ];
  for (const [p, label] of cases) {
    const r = buildFusion360Script('export_model', { outputPath: p, format: 'step' });
    expect(r.ok === false, `${label} path rejected (ok:false)`);
    // Fail-closed stub must not embed the hostile path anywhere.
    expect(!scriptContainsRaw(r.script, p), `${label} path never appears in the emitted (stub) script`);
    expect(r.script.includes('FAIL-CLOSED STUB'), `${label} rejection yields a fail-closed stub`);
  }
  // Control char (newline) in path.
  const nl = buildFusion360Script('export_model', { outputPath: '/tmp/a\nb.step', format: 'step' });
  expect(nl.ok === false, 'newline in path rejected');
  pass('export_model rejects shell-metachar / traversal / non-BMP / control-char paths');
}

// ── set_user_parameter: happy path + safe embedding ──────────────────────────
{
  const r = buildFusion360Script('set_user_parameter', { parameterName: 'width', value: 42.5, units: 'mm' });
  expect(r.ok === true, 'valid parameter mutation builds');
  expect(r.script.includes(`PARAM_NAME = ${JSON.stringify('width')}`), 'parameter name embedded as escaped literal');
  expect(r.script.includes(`NEW_EXPRESSION = ${JSON.stringify('42.5 mm')}`), 'expression embedded as a single escaped literal');
  expect(r.script.includes('design.userParameters.itemByName(PARAM_NAME)'), 'looks up the parameter by name');
  expect(r.script.includes('parameter.expression = NEW_EXPRESSION'), 'sets the expression from the literal');
  expect(r.script.includes('design.computeAll()'), 'recomputes after the change');
  expect(r.script.includes('if parameter is None'), 'fails closed when the parameter does not exist');
  expect(r.outputHint === undefined, 'parameter op has no output file hint');
  // Unitless / count parameter → bare number expression.
  const unitless = buildFusion360Script('set_user_parameter', { parameterName: 'count', value: 6, units: '' });
  expect(unitless.ok === true, 'unitless parameter builds');
  expect(unitless.script.includes(`NEW_EXPRESSION = ${JSON.stringify('6')}`), 'unitless expression is the bare number');
  pass('set_user_parameter: safe name/expression embedding + recompute + fail-closed');
}

// ── set_user_parameter: parameter-NAME allowlist (injection rejection) ───────
{
  const hostileNames = [
    "width'); import os; os.system('id",
    'width; drop',
    'width value',
    'width-2',
    '9lives',
    '',
    'a`b`',
    'name$(x)',
  ];
  for (const name of hostileNames) {
    const v = validateFusion360Args('set_user_parameter', { parameterName: name, value: 1, units: 'mm' });
    expect(v.ok === false, `hostile/invalid parameter name rejected: ${JSON.stringify(name).slice(0, 40)}`);
    const built = buildFusion360Script('set_user_parameter', { parameterName: name, value: 1, units: 'mm' });
    expect(built.ok === false && !scriptContainsRaw(built.script, name || 'ZZZ_never'), `hostile name never lands in script: ${JSON.stringify(name).slice(0, 30)}`);
  }
  // `__import__` MATCHES the identifier allowlist and is therefore accepted —
  // that is correct, because the name is only ever used as a QUOTED string arg
  // to itemByName (never as executable code), so there is no injection surface.
  // Assert it embeds only as an escaped literal.
  const underscoreDunder = validateFusion360Args('set_user_parameter', { parameterName: '__import__', value: 1, units: 'mm' });
  expect(underscoreDunder.ok === true, '__import__ is a valid identifier (accepted) — safety is that it is a string arg, not code');
  const dunderBuilt = buildFusion360Script('set_user_parameter', { parameterName: '__import__', value: 1, units: 'mm' });
  expect(dunderBuilt.script.includes(`PARAM_NAME = ${JSON.stringify('__import__')}`), '__import__ used only as a quoted itemByName arg, never as code');
  pass('parameter-name allowlist rejects injection/space/metachar/empty; identifiers embed as string literals only');
}

// ── set_user_parameter: numeric-VALUE allowlist (injection rejection) ────────
{
  const goodValues: Array<number | string> = [1, -3, 0, 42.5, '12.75', '-0.001', '100'];
  for (const value of goodValues) {
    const v = validateFusion360Args('set_user_parameter', { parameterName: 'w', value, units: 'mm' });
    expect(v.ok === true, `plain decimal accepted: ${JSON.stringify(value)}`);
  }
  const badValues: Array<unknown> = [
    '1e9', // exponent
    '0x1F', // hex
    'Infinity',
    'NaN',
    '10; rm -rf /',
    '10 mm', // units belong in the units field, not the value
    '10)',
    '`id`',
    Number.POSITIVE_INFINITY,
    Number.NaN,
    '10.5.5',
    '',
    '--10',
  ];
  for (const value of badValues) {
    const v = validateFusion360Args('set_user_parameter', { parameterName: 'w', value: value as never, units: 'mm' });
    expect(v.ok === false, `hostile/invalid value rejected: ${JSON.stringify(value)}`);
    const built = buildFusion360Script('set_user_parameter', { parameterName: 'w', value: value as never, units: 'mm' });
    expect(built.ok === false, `hostile value yields fail-closed stub: ${JSON.stringify(value)}`);
    // Raw-leak check only for values carrying an injection-significant char.
    // (Inert word/number tokens like "Infinity"/"NaN"/"10.5.5" are rejected by
    //  ok:false above; those words can appear in the fixed error-copy that the
    //  stub reports as its reason, so a substring match on them is not a leak.)
    if (typeof value === 'string' && /[;`$()|&><'"\s]/.test(value)) {
      expect(!scriptContainsRaw(built.script, value), `injection-shaped value string never lands in script: ${JSON.stringify(value)}`);
    }
  }
  pass('numeric-value allowlist rejects exponent/hex/Infinity/NaN/injection/embedded-units');
}

// ── set_user_parameter: units allowlist ──────────────────────────────────────
{
  for (const units of ['mm', 'cm', 'm', 'in', 'ft', 'deg', 'rad', '']) {
    const v = validateFusion360Args('set_user_parameter', { parameterName: 'w', value: 1, units });
    expect(v.ok === true, `known unit accepted: "${units}"`);
  }
  // NB: units are trimmed before validation, so a trailing '\n' would become
  // valid 'in'; the hostile fixtures below all carry an INTERNAL invalid char
  // (metachar/space/digit/case) that survives trim and fails the allowlist.
  const badUnits = ['mm; rm', 'furlong', 'm)', '`x`', 'mm mm', '12', 'MM', 'in;', 'i\tn'];
  for (const units of badUnits) {
    const v = validateFusion360Args('set_user_parameter', { parameterName: 'w', value: 1, units });
    expect(v.ok === false, `hostile/unknown unit rejected: ${JSON.stringify(units)}`);
  }
  pass('units allowlist accepts only the known set, rejects unknown/hostile units');
}

// ── SAFE EMBEDDING: a value with quotes + newline is escaped, never raw ───────
// The value allowlist would reject a quote/newline value, so this proves the
// escaper itself on the export path where richer strings (paths) are allowed:
// a path containing an embedded double-quote + backslash must be JSON-escaped.
{
  // A quote/backslash path is ALLOWED (no shell metachar / control char there)
  // and must be embedded via the escaper, never raw-concatenated.
  const trickyPath = '/Users/demo/Desktop/say "hi"\\bracket.step';
  const r = buildFusion360Script('export_model', { outputPath: trickyPath, format: 'step' });
  expect(r.ok === true, 'quote+backslash path is allowed (no shell metachar) and builds');
  expect(r.script.includes(JSON.stringify(trickyPath)), 'quotes/backslashes escaped via JSON repr');
  // The raw unescaped `= "<path>"` interpolation form must never appear.
  expect(!r.script.includes(`= "${trickyPath}"`), 'raw unescaped interpolation never happens');
  // And the tab/newline escaper: a BMP path with a literal control char is
  // rejected earlier, so construct a non-path proof via pythonStringLiteral
  // indirectly — a parameter name cannot hold a newline, so the escaper's
  // \uXXXX branch is exercised by any high-BMP char in an ALLOWED path.
  const highBmpPath = '/Users/demo/Desktop/пéĀart.step'; // Latin/Cyrillic BMP chars
  const hb = buildFusion360Script('export_model', { outputPath: highBmpPath, format: 'step' });
  expect(hb.ok === true, 'BMP non-ASCII path builds');
  expect(/\\u00e9/.test(hb.script) || /\\u0100/.test(hb.script), 'non-ASCII BMP chars escaped to \\uXXXX (pure-ASCII script)');
  expect(!/[^\x00-\x7f]/.test(hb.script), 'generated script is pure ASCII (no raw non-ASCII bytes)');
  pass('safe embedding: quotes/backslashes JSON-escaped, non-ASCII → \\uXXXX, script stays pure ASCII');
}

// ── export_drawing_pdf ───────────────────────────────────────────────────────
{
  const r = buildFusion360Script('export_drawing_pdf', { outputPath: '/Users/demo/Desktop/sheet.pdf' });
  expect(r.ok === true, 'drawing pdf export builds');
  expect(r.script.includes(`OUTPUT_PATH = ${JSON.stringify('/Users/demo/Desktop/sheet.pdf')}`), 'pdf path embedded as escaped literal');
  expect(r.script.includes('createPDFExportOptions'), 'uses the PDF export options factory');
  expect(r.script.includes('adsk.drawing.Drawing.cast'), 'casts the active product to a Drawing');
  expect(r.script.includes('if drawing is None'), 'fails closed when active product is not a drawing');
  expect(r.script.includes('os.path.isfile(OUTPUT_PATH)'), 'verifies the PDF was written');
  expect(r.outputHint === '/Users/demo/Desktop/sheet.pdf', 'outputHint is the pdf path');
  const notPdf = buildFusion360Script('export_drawing_pdf', { outputPath: '/tmp/sheet.png' });
  expect(notPdf.ok === false, 'non-.pdf output rejected for drawing export');
  const hostile = buildFusion360Script('export_drawing_pdf', { outputPath: '/tmp/a;b.pdf' });
  expect(hostile.ok === false && !scriptContainsRaw(hostile.script, '/tmp/a;b.pdf'), 'hostile pdf path rejected + never embedded');
  pass('export_drawing_pdf: shape pins + .pdf enforcement + fail-closed + safe embedding');
}

// ── bounds: long strings + huge numbers ──────────────────────────────────────
{
  const longPath = '/tmp/' + 'a'.repeat(2000) + '.step';
  const r = buildFusion360Script('export_model', { outputPath: longPath, format: 'step' });
  expect(r.ok === false, 'over-1024-char path rejected');
  const longName = 'a'.repeat(200);
  const n = validateFusion360Args('set_user_parameter', { parameterName: longName, value: 1, units: 'mm' });
  expect(n.ok === false, 'over-64-char parameter name rejected');
  const bigValue = validateFusion360Args('set_user_parameter', { parameterName: 'w', value: '1'.repeat(40), units: 'mm' });
  expect(bigValue.ok === false, 'over-12-integer-digit value rejected');
  const okBig = validateFusion360Args('set_user_parameter', { parameterName: 'w', value: '123456789012', units: 'mm' });
  expect(okBig.ok === true, '12-integer-digit value accepted at the bound');
  pass('bounds: path ≤1024, name ≤64, value ≤12 integer digits enforced');
}

// ── degenerate inputs NEVER throw ────────────────────────────────────────────
{
  const degenerate: Array<[unknown, unknown]> = [
    [null, null],
    [undefined, undefined],
    ['export_model', null],
    ['export_model', 'not an object'],
    ['export_model', 42],
    ['set_user_parameter', {}],
    ['set_user_parameter', { parameterName: null, value: null }],
    ['export_drawing_pdf', []],
    ['nonsense_op', { outputPath: '/tmp/x.step' }],
    [{}, {}],
    [123, { outputPath: '/tmp/x.step', format: 'step' }],
  ];
  for (const [op, input] of degenerate) {
    let threw = false;
    let result: ReturnType<typeof buildFusion360Script> | null = null;
    try {
      result = buildFusion360Script(op, input);
    } catch {
      threw = true;
    }
    expect(!threw, `buildFusion360Script never throws for ${JSON.stringify(op)} / ${JSON.stringify(input)?.slice(0, 30)}`);
    expect(result !== null && result.ok === false, 'degenerate input yields ok:false');
    expect(result !== null && result.scriptExtension === 'py', 'degenerate result still declares a .py script');
    expect(result !== null && typeof result.script === 'string' && result.script.length > 0, 'degenerate result still returns a (stub) script');
    expect(result !== null && result.script.includes('UC_FUSION_ERROR'), 'stub carries the error sentinel');
    // validate + describe never throw either
    let v2Threw = false;
    try {
      validateFusion360Args(op, input);
      describeFusion360Operation(op, input);
    } catch {
      v2Threw = true;
    }
    expect(!v2Threw, 'validateFusion360Args + describeFusion360Operation never throw on degenerate input');
  }
  pass('degenerate inputs never throw; always a fail-closed .py stub with error sentinel');
}

// ── describeFusion360Operation ────────────────────────────────────────────────
{
  expect(/STEP/i.test(describeFusion360Operation('export_model', { outputPath: '/tmp/x.step', format: 'step' })), 'export description names the format');
  expect(/parameter/i.test(describeFusion360Operation('set_user_parameter', { parameterName: 'width', value: 1, units: 'mm' })), 'parameter description mentions parameter');
  expect(/width/.test(describeFusion360Operation('set_user_parameter', { parameterName: 'width', value: 1, units: 'mm' })), 'parameter description includes the name');
  expect(/drawing|PDF/i.test(describeFusion360Operation('export_drawing_pdf', { outputPath: '/tmp/x.pdf' })), 'drawing description mentions drawing/PDF');
  const generic = describeFusion360Operation('bogus', {});
  expect(generic.length > 0 && generic.length < 120, 'unknown op yields a bounded generic line');
  pass('describeFusion360Operation gives bounded, informative approval lines');
}

if (failures > 0) {
  console.error(`\n${failures} fusion360 script adapter smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll fusion360 script adapter smoke cases passed.');
