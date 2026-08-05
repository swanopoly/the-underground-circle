/**
 * rhino-script-adapter-smoketest — verifies the PURE McNeel Rhino 3D
 * rhinoscriptsyntax script generator (src/lib/rhinoScriptAdapter.ts).
 * Security-heavy:
 *
 *   - model/output PATH allowlist (control/shell-metachar/non-BMP/traversal reject)
 *   - model extension allowlist (.3dm only) + per-op output-extension↔format agreement
 *   - export/convert FORMAT enum allowlist (hostile format dropped)
 *   - run_python_script op REMOVED (2026-07-13): a free-form Python body cannot be
 *     durably allowlisted in a pure generator — verified rejected as an unknown op
 *   - SAFE embedding: a path containing quotes/backslash/non-ASCII never lands raw
 *     in the generated Python — only as an escaped `pythonStringLiteral`; the export
 *     command additionally wraps the path in chr(34) quotes (double containment)
 *   - a concrete INJECTION (shell + Python-breakout shaped path) is rejected and
 *     never appears in the emitted stub
 *   - RhinoCode invocation descriptor pins: verifiedInvocation:false, doc source,
 *     operation-gap tool, macOS-not-headless constraint
 *   - per-operation script-shape pins (export_format, batch_convert,
 *     extract_geometry_report) incl. fail-closed guards + VERIFY banner
 *   - bounds (long paths)
 *   - degenerate inputs NEVER throw (null/garbage → fail-closed stub, ok:false)
 *
 * Run: npx tsx scripts/rhino-script-adapter-smoketest.ts
 */

import {
  buildRhinoScript,
  describeRhinoOperation,
  RHINO_EXPORT_FORMATS,
  RHINO_INVOCATION,
  RHINO_OPERATION_GAP_TOOL,
  RHINO_OPERATIONS,
  validateRhinoArgs,
} from '../src/lib/rhinoScriptAdapter';

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

// Every real (ok:true) script must import rhinoscriptsyntax, open the model, and
// wrap work in try/except with the error sentinel.
function assertRealScriptPins(script: string, label: string) {
  expect(script.includes('import rhinoscriptsyntax as rs'), `${label}: imports rhinoscriptsyntax`);
  expect(script.includes('rs.Command(q + "_-Open "'), `${label}: opens the source model via _-Open`);
  expect(script.includes('rs.UnitSystemName'), `${label}: verifies model units before acting`);
  expect(script.includes('try:') && script.includes('except Exception:'), `${label}: work wrapped in try/except`);
  expect(script.includes('UC_RHINO_ERROR'), `${label}: fails closed with the error sentinel`);
  expect(script.includes('# VERIFY the rhinocode invocation'), `${label}: carries the VERIFY banner`);
  // import must appear before the first rs.* usage.
  const importIdx = script.indexOf('import rhinoscriptsyntax as rs');
  const useIdx = script.indexOf('rs.Command(');
  expect(importIdx >= 0 && useIdx >= 0 && importIdx < useIdx, `${label}: rhinoscriptsyntax imported before first rs.* call`);
}

// ── Operation + format enums are stable ──────────────────────────────────────
{
  expect(RHINO_OPERATIONS.length === 3, 'three operations exposed');
  expect(
    RHINO_OPERATIONS.includes('export_format') &&
      RHINO_OPERATIONS.includes('batch_convert') &&
      RHINO_OPERATIONS.includes('extract_geometry_report'),
    'operation set is export_format / batch_convert / extract_geometry_report',
  );
  expect(!(RHINO_OPERATIONS as readonly string[]).includes('run_python_script'), 'run_python_script op is NOT exposed (removed 2026-07-13)');
  expect(RHINO_EXPORT_FORMATS.join(',') === 'step,stl,obj,dwg', 'export formats are step,stl,obj,dwg');
  pass('operation + format enums are the documented sets');
}

// ── Invocation descriptor: NOT wired + doc-verified + gap tool ────────────────
{
  expect(RHINO_INVOCATION.verifiedInvocation === false, 'verifiedInvocation is false (not wired)');
  expect(RHINO_INVOCATION.commandTemplate === 'rhinocode script {script}', 'doc-verified command template is `rhinocode script {script}`');
  expect(RHINO_INVOCATION.runner === 'rhinocode', 'runner is rhinocode');
  expect(RHINO_INVOCATION.surface === 'rhino_common_api', 'chosen surface is the profile top-ranked rhino_common_api');
  expect(RHINO_INVOCATION.headlessOnMac === false, 'descriptor states it is NOT headless on Mac');
  expect(RHINO_INVOCATION.requiresRunningRhinoScriptServer === true, 'descriptor states the script server must be running');
  expect(typeof RHINO_INVOCATION.docSource === 'string' && RHINO_INVOCATION.docSource.includes('developer.rhino3d.com'), 'docSource points at official McNeel docs');
  expect(RHINO_OPERATION_GAP_TOOL === 'agent.build_app_capability', 'operation-gap tool constant is agent.build_app_capability');
  pass('invocation descriptor is doc-verified, NOT wired, and names the buildout gap tool + Mac-not-headless constraint');
}

// ── export_format: STEP happy path + safe path embedding + double containment ─
{
  const modelPath = "/Users/demo/My 'Models'/part 010.3dm";
  const outputPath = '/Users/demo/Desktop/part-010.step';
  const result = buildRhinoScript('export_format', { modelPath, outputPath, format: 'step' });
  expect(result.ok === true, 'step export builds');
  expect(result.scriptExtension === 'py', 'scriptExtension is py');
  expect(result.outputHint === outputPath, 'outputHint echoes the validated path');
  expect(result.script.includes(`MODEL_PATH = ${JSON.stringify(modelPath)}`), 'model path embedded as escaped literal (JSON repr)');
  expect(result.script.includes(`OUTPUT_PATH = ${JSON.stringify(outputPath)}`), 'output path embedded as escaped literal');
  expect(result.script.includes('rs.AllObjects(select=True'), 'selects all objects before export');
  expect(result.script.includes('"_-Export "'), 'uses the _-Export command');
  // Double containment: path wrapped in chr(34) quotes inside the command string.
  expect(result.script.includes('q = chr(34)'), 'defines chr(34) quote helper');
  expect(result.script.includes('q + OUTPUT_PATH + q'), 'output path is chr(34)-quoted inside the Rhino command (double containment)');
  expect(result.script.includes('rs.IsFile(OUTPUT_PATH)'), 'script verifies its own output exists');
  expect(result.script.includes('UC_RHINO_ERROR'), 'script fails closed with the error sentinel');
  assertRealScriptPins(result.script, 'export_format step');
  pass('export_format STEP: shape pins + safe path embedding + chr(34) double containment + unit/open pins');
}

// ── export_format: STL / OBJ / DWG call shapes ───────────────────────────────
{
  const stl = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.stl', format: 'stl' });
  expect(stl.ok === true && stl.script.includes('"_-Export "'), 'stl export builds via _-Export');
  const obj = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.obj', format: 'obj' });
  expect(obj.ok === true && obj.script.includes('exported OBJ'), 'obj export builds and labels OBJ');
  const dwg = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.dwg', format: 'dwg' });
  expect(dwg.ok === true && dwg.script.includes('exported DWG'), 'dwg export builds and labels DWG');
  assertRealScriptPins(dwg.script, 'export_format dwg');
  pass('export_format STL/OBJ/DWG all build with the _-Export command');
}

// ── export_format: extension must match format + scene ext allowlist ─────────
{
  const mismatch = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.stl', format: 'step' });
  expect(mismatch.ok === false, 'STEP format with .stl output is rejected');
  expect(mismatch.notes.some((n) => n.includes('.step')), 'mismatch note names the expected extension');
  const badFormat = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.step', format: 'iges' as never });
  expect(badFormat.ok === false, 'unknown export format rejected');
  const badModelExt = buildRhinoScript('export_format', { modelPath: '/tmp/m.step', outputPath: '/tmp/o.stl', format: 'stl' });
  expect(badModelExt.ok === false, 'non-.3dm model rejected');
  expect(badModelExt.notes.some((n) => n.includes('.3dm')), 'model-ext note names the allowed set');
  pass('export_format enforces format↔extension agreement + .3dm model extension allowlist');
}

// ── never write over the source ──────────────────────────────────────────────
{
  const sameConvert = buildRhinoScript('batch_convert', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/m.3dm', format: 'stl' });
  // ext mismatch (.3dm is not a valid export ext) catches this first, but assert rejection.
  expect(sameConvert.ok === false, 'converting to the same .3dm path is rejected (bad export ext anyway)');
  const sameReport = buildRhinoScript('extract_geometry_report', { modelPath: '/tmp/thing.3dm', outputPath: '/tmp/thing.3dm' });
  expect(sameReport.ok === false, 'report output equal to the source is rejected');
  pass('scripts never target the source model path (no overwrite)');
}

// ── export_format: hostile path injection is rejected (never embedded) ───────
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
    const r = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: p, format: 'step' });
    expect(r.ok === false, `${label} output path rejected (ok:false)`);
    expect(!scriptContainsRaw(r.script, p), `${label} output path never appears in the emitted (stub) script`);
    expect(r.script.includes('FAIL-CLOSED STUB'), `${label} rejection yields a fail-closed stub`);
    // Same hostile shape on the MODEL path is rejected too.
    const rm = buildRhinoScript('export_format', { modelPath: p.replace('.step', '.3dm'), outputPath: '/tmp/o.step', format: 'step' });
    expect(rm.ok === false, `${label} model path rejected (ok:false)`);
  }
  // Control char (newline) in path.
  const nl = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/a\nb.step', format: 'step' });
  expect(nl.ok === false, 'newline in path rejected');
  pass('export_format rejects shell-metachar / traversal / non-BMP / control-char paths on model AND output');
}

// ── CONCRETE INJECTION #1: a Python-breakout + shell-shaped path is blocked ───
// The load-bearing path case: a path crafted to break OUT of the generated Python
// string literal AND run a shell command must be rejected by validation and must
// NEVER appear in the emitted script text (not even in the stub).
{
  const injection = '/tmp/out"; import os; os.system("id") #.step';
  const r = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: injection, format: 'step' });
  expect(r.ok === false, 'injection-shaped path rejected (contains ; and backtick? -> at least ; )');
  expect(!scriptContainsRaw(r.script, injection), 'injection string never appears anywhere in the emitted stub');
  expect(!r.script.includes('os.system'), 'no os.system call is present in the emitted script');
  expect(!r.script.includes('import os; os.system'), 'the breakout fragment is not present');
  // A subtler path with NO shell metachar but a double-quote + backslash: ALLOWED
  // as a path (no metachar) but MUST be JSON-escaped, never raw-concatenated.
  const quotePath = '/tmp/say "pwned"\\end.step';
  const r2 = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: quotePath, format: 'step' });
  expect(r2.ok === true, 'quote+backslash path is allowed (no shell metachar) and builds');
  expect(r2.script.includes(JSON.stringify(quotePath)), 'quote/backslash path embedded via JSON-escaped literal');
  expect(!r2.script.includes(`OUTPUT_PATH = "${quotePath}"`), 'raw unescaped interpolation of the quote path never happens');
  pass('concrete path injection blocked: shell-breakout rejected + quote/backslash JSON-escaped, never raw');
}

// ── run_python_script was REMOVED (2026-07-13) — verify it is now REJECTED ────
// A pure JS generator cannot durably allowlist arbitrary Python (an audit showed
// breakpoint()/help()/type()/comprehensions/nested-calls reached executable
// positions), so the free-form-body op is gone. Any request for it must fail
// closed as an unknown op — never a script that opens the model or runs a body.
{
  const anyBody = 'rs.AllObjects()\nimport os\nos.system("id")';
  const v = validateRhinoArgs('run_python_script', { modelPath: '/tmp/m.3dm', scriptBody: anyBody });
  expect(v.ok === false, 'run_python_script is rejected as an unknown operation');
  const built = buildRhinoScript('run_python_script', { modelPath: '/tmp/m.3dm', scriptBody: anyBody });
  expect(built.ok === false, 'run_python_script yields a fail-closed stub (op removed)');
  expect(built.script.includes('FAIL-CLOSED STUB'), 'removed op yields a fail-closed stub');
  expect(!built.script.includes('import rhinoscriptsyntax as rs'), 'removed op never imports rhinoscriptsyntax / opens a model');
  expect(!built.script.includes('os.system') && !built.script.includes('__import__('), 'no user Python body reaches the emitted stub');
  pass('run_python_script op removed — rejected as unknown op, fail-closed stub, no body ever emitted');
}

// ── batch_convert: happy path + safe embedding ───────────────────────────────
{
  const c = buildRhinoScript('batch_convert', { modelPath: '/Users/demo/in.3dm', outputPath: '/Users/demo/out.obj', format: 'obj' });
  expect(c.ok === true, 'batch_convert 3dm->obj builds');
  expect(c.script.includes(`MODEL_PATH = ${JSON.stringify('/Users/demo/in.3dm')}`), 'model path embedded as escaped literal');
  expect(c.script.includes(`OUTPUT_PATH = ${JSON.stringify('/Users/demo/out.obj')}`), 'output path embedded as escaped literal');
  expect(c.script.includes('"_-Export "'), 'batch_convert uses the _-Export command');
  expect(c.script.includes('q + OUTPUT_PATH + q'), 'batch_convert chr(34)-quotes the path (double containment)');
  assertRealScriptPins(c.script, 'batch_convert obj');
  const badOut = buildRhinoScript('batch_convert', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.pdf', format: 'obj' });
  expect(badOut.ok === false, 'batch_convert output ext must match format');
  pass('batch_convert: 3dm->{step,stl,obj,dwg} shape pins + double containment + ext↔format agreement');
}

// ── extract_geometry_report: read-only audit (txt + json) ────────────────────
{
  const txt = buildRhinoScript('extract_geometry_report', { modelPath: '/Users/demo/m.3dm', outputPath: '/Users/demo/report.txt' });
  expect(txt.ok === true, 'txt report builds');
  expect(txt.script.includes('rs.AllObjects(select=False'), 'reads objects read-only (select=False)');
  expect(txt.script.includes('rs.BoundingBox('), 'computes the world bounding box');
  expect(txt.script.includes('"objects: "'), 'txt report writes a plain-text payload');
  expect(!txt.script.includes('_-Export'), 'read-only report does NOT export/mutate');
  expect(txt.outputHint === '/Users/demo/report.txt', 'report outputHint is the report path');
  assertRealScriptPins(txt.script, 'extract_geometry_report txt');
  const json = buildRhinoScript('extract_geometry_report', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/r.json' });
  expect(json.ok === true, 'json report builds');
  expect(json.script.includes('import json') && json.script.includes('json.dumps'), 'json report uses json.dumps');
  const badExt = buildRhinoScript('extract_geometry_report', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/r.csv' });
  expect(badExt.ok === false, 'report output must be .txt or .json');
  pass('extract_geometry_report: read-only object/bbox/units audit → .txt/.json (no export/mutation)');
}

// ── SAFE EMBEDDING: non-ASCII path escapes to \uXXXX, script stays pure ASCII ─
{
  const highBmpPath = '/Users/demo/Desktop/пéĀmodel.step'; // Latin/Cyrillic BMP chars
  const hb = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: highBmpPath, format: 'step' });
  expect(hb.ok === true, 'BMP non-ASCII path builds');
  expect(/\\u00e9/.test(hb.script) || /\\u0100/.test(hb.script) || /\\u043f/.test(hb.script), 'non-ASCII BMP chars escaped to \\uXXXX');
  expect(!/[^\x00-\x7f]/.test(hb.script), 'generated script is pure ASCII (no raw non-ASCII bytes)');
  // And a BMP non-ASCII MODEL path escapes too.
  const hbModel = buildRhinoScript('extract_geometry_report', { modelPath: '/tmp/пモデル.3dm', outputPath: '/tmp/out.txt' });
  expect(hbModel.ok === true, 'BMP non-ASCII model path builds');
  expect(!/[^\x00-\x7f]/.test(hbModel.script), 'report script stays pure ASCII too');
  pass('safe embedding: non-ASCII BMP chars → \\uXXXX, generated script stays pure ASCII');
}

// ── bounds: long paths + oversized script body ───────────────────────────────
{
  const longPath = '/tmp/' + 'a'.repeat(2000) + '.step';
  const r = buildRhinoScript('export_format', { modelPath: '/tmp/m.3dm', outputPath: longPath, format: 'step' });
  expect(r.ok === false, 'over-1024-char output path rejected');
  const longModel = buildRhinoScript('export_format', { modelPath: '/tmp/' + 'a'.repeat(2000) + '.3dm', outputPath: '/tmp/o.step', format: 'step' });
  expect(longModel.ok === false, 'over-1024-char model path rejected');
  pass('bounds: path ≤1024 on model+output paths enforced');
}

// ── degenerate inputs NEVER throw ────────────────────────────────────────────
{
  const degenerate: Array<[unknown, unknown]> = [
    [null, null],
    [undefined, undefined],
    ['export_format', null],
    ['export_format', 'not an object'],
    ['export_format', 42],
    ['export_format', {}],
    ['run_python_script', { modelPath: '/tmp/m.3dm', scriptBody: 'rs.X()' }], // REMOVED op -> handled as unknown, never throws
    ['batch_convert', {}],
    ['extract_geometry_report', {}],
    ['extract_geometry_report', { modelPath: null, outputPath: null }],
    ['nonsense_op', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.step', format: 'step' }],
    [{}, {}],
    [123, { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.step', format: 'step' }],
  ];
  for (const [op, input] of degenerate) {
    let threw = false;
    let result: ReturnType<typeof buildRhinoScript> | null = null;
    try {
      result = buildRhinoScript(op, input);
    } catch {
      threw = true;
    }
    expect(!threw, `buildRhinoScript never throws for ${JSON.stringify(op)} / ${JSON.stringify(input)?.slice(0, 30)}`);
    expect(result !== null && result.ok === false, 'degenerate input yields ok:false');
    expect(result !== null && result.scriptExtension === 'py', 'degenerate result still declares a .py script');
    expect(result !== null && typeof result.script === 'string' && result.script.length > 0, 'degenerate result still returns a (stub) script');
    expect(result !== null && result.script.includes('UC_RHINO_ERROR'), 'stub carries the error sentinel');
    // Fail-closed stub must NOT import rhinoscriptsyntax or open a model (mutates nothing).
    expect(result !== null && !result.script.includes('import rhinoscriptsyntax'), 'fail-closed stub never imports rhinoscriptsyntax');
    expect(result !== null && !result.script.includes('_-Open'), 'fail-closed stub never opens a model');
    // validate + describe never throw either
    let v2Threw = false;
    try {
      validateRhinoArgs(op, input);
      describeRhinoOperation(op, input);
    } catch {
      v2Threw = true;
    }
    expect(!v2Threw, 'validateRhinoArgs + describeRhinoOperation never throw on degenerate input');
  }
  pass('degenerate inputs never throw; always a fail-closed .py stub (no rhinoscriptsyntax import / no open) with error sentinel');
}

// ── describeRhinoOperation ────────────────────────────────────────────────────
{
  expect(/STEP/i.test(describeRhinoOperation('export_format', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.step', format: 'step' })), 'export description names the format');
  expect(/convert/i.test(describeRhinoOperation('batch_convert', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/o.obj', format: 'obj' })), 'batch_convert description mentions conversion');
  expect(describeRhinoOperation('run_python_script', {}).length > 0, 'removed run_python_script op still yields a safe generic description (never throws)');
  expect(/report/i.test(describeRhinoOperation('extract_geometry_report', { modelPath: '/tmp/m.3dm', outputPath: '/tmp/r.txt' })), 'report description mentions the report');
  const generic = describeRhinoOperation('bogus', {});
  expect(generic.length > 0 && generic.length < 120, 'unknown op yields a bounded generic line');
  pass('describeRhinoOperation gives bounded, informative approval lines');
}

if (failures > 0) {
  console.error(`\n${failures} rhino script adapter smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll rhino script adapter smoke cases passed.');
