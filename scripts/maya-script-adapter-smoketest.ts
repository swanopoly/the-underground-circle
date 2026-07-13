/**
 * maya-script-adapter-smoketest — verifies the PURE Autodesk Maya headless
 * Python script generator (src/lib/mayaScriptAdapter.ts). Security-heavy:
 *
 *   - scene/output PATH allowlist (control/shell-metachar/non-BMP/traversal reject)
 *   - scene extension allowlist (.ma/.mb only) + per-op output-extension↔format agreement
 *   - export/render FORMAT enum allowlist (hostile format dropped)
 *   - FRAME allowlist: bounded non-negative integer; decimal/exponent/hex/negative/
 *     Infinity/NaN/injection all rejected
 *   - SAFE embedding: a path containing quotes/backslash/non-ASCII never lands raw
 *     in the generated Python — only as an escaped `pythonStringLiteral`; frame is
 *     emitted as digits only
 *   - a concrete INJECTION (shell + Python-breakout shaped path) is rejected and
 *     never appears in the emitted stub
 *   - maya.standalone init/uninit pins: every real script initializes first and
 *     uninitializes in a finally block
 *   - per-operation script-shape pins (export_scene FBX/OBJ/USD/ABC, single-frame
 *     render, .ma<->.mb convert) incl. fail-closed guards + VERIFY banner
 *   - bounds (long paths, huge frames)
 *   - degenerate inputs NEVER throw (null/garbage → fail-closed stub, ok:false)
 *
 * Run: npx tsx scripts/maya-script-adapter-smoketest.ts
 */

import {
  buildMayaScript,
  describeMayaOperation,
  MAYA_EXPORT_FORMATS,
  MAYA_FRAME_MAX,
  MAYA_IMAGE_FORMATS,
  MAYA_OPERATIONS,
  MAYA_SCENE_FORMATS,
  validateMayaArgs,
} from '../src/lib/mayaScriptAdapter';

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

// Every real (ok:true) script must bookend maya.standalone init/uninit.
function assertStandalonePins(script: string, label: string) {
  expect(script.includes('import maya.standalone'), `${label}: imports maya.standalone`);
  expect(script.includes("maya.standalone.initialize(name='python')"), `${label}: initializes maya.standalone first`);
  expect(script.includes('maya.standalone.uninitialize()'), `${label}: uninitializes maya.standalone`);
  expect(script.includes('finally:'), `${label}: uninitialize runs in a finally block (even on error)`);
  // initialize must appear before the first maya.cmds usage.
  const initIdx = script.indexOf("maya.standalone.initialize(name='python')");
  const cmdsIdx = script.indexOf('import maya.cmds as cmds');
  expect(initIdx >= 0 && cmdsIdx >= 0 && initIdx < cmdsIdx, `${label}: standalone.initialize precedes importing maya.cmds`);
}

// ── Operation + format enums are stable ──────────────────────────────────────
{
  expect(MAYA_OPERATIONS.length === 3, 'three operations exposed');
  expect(
    MAYA_OPERATIONS.includes('export_scene') &&
      MAYA_OPERATIONS.includes('playblast_or_render_frame') &&
      MAYA_OPERATIONS.includes('convert_format'),
    'operation set is export_scene / playblast_or_render_frame / convert_format',
  );
  expect(MAYA_EXPORT_FORMATS.join(',') === 'fbx,obj,usd,abc', 'export formats are fbx,obj,usd,abc');
  expect(MAYA_IMAGE_FORMATS.join(',') === 'png,jpg,tif,exr', 'image formats are png,jpg,tif,exr');
  expect(MAYA_SCENE_FORMATS.join(',') === 'ma,mb', 'scene formats are ma,mb');
  pass('operation + format enums are the documented sets');
}

// ── export_scene: FBX happy path + safe path embedding + standalone pins ──────
{
  const scenePath = "/Users/demo/My 'Scenes'/shot 010.ma";
  const outputPath = '/Users/demo/Desktop/shot-010.fbx';
  const result = buildMayaScript('export_scene', { scenePath, outputPath, format: 'fbx' });
  expect(result.ok === true, 'fbx export builds');
  expect(result.scriptExtension === 'py', 'scriptExtension is py');
  expect(result.outputHint === outputPath, 'outputHint echoes the validated path');
  expect(result.script.includes(`SCENE_PATH = ${JSON.stringify(scenePath)}`), 'scene path embedded as escaped literal (JSON repr)');
  expect(result.script.includes(`OUTPUT_PATH = ${JSON.stringify(outputPath)}`), 'output path embedded as escaped literal');
  expect(result.script.includes("cmds.file(SCENE_PATH, open=True"), 'opens the source scene');
  expect(result.script.includes('prompt=False') && result.script.includes('ignoreVersion=True'), 'open is script-node-safe (prompt off + ignoreVersion)');
  expect(result.script.includes("cmds.loadPlugin('fbxmaya')"), 'FBX loads the fbxmaya plugin');
  expect(result.script.includes("type='FBX export'"), 'FBX export uses the FBX file type');
  expect(result.script.includes('os.path.isfile(OUTPUT_PATH)'), 'script verifies its own output exists');
  expect(result.script.includes('UC_MAYA_ERROR'), 'script fails closed with the error sentinel');
  expect(result.script.includes('# VERIFY mayapy invocation'), 'generated script carries the VERIFY banner');
  assertStandalonePins(result.script, 'export_scene fbx');
  pass('export_scene FBX: shape pins + safe path embedding + standalone init/uninit + script-node-safe open');
}

// ── export_scene: OBJ / USD / ABC plugin + call shapes ───────────────────────
{
  const obj = buildMayaScript('export_scene', { scenePath: '/tmp/s.mb', outputPath: '/tmp/o.obj', format: 'obj' });
  expect(obj.ok === true, 'obj export builds');
  expect(obj.script.includes("cmds.loadPlugin('objExport')"), 'OBJ loads objExport plugin');
  expect(obj.script.includes("type='OBJexport'"), 'OBJ export uses the OBJexport file type');
  const usd = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: '/tmp/o.usd', format: 'usd' });
  expect(usd.ok === true, 'usd export builds');
  expect(usd.script.includes("cmds.loadPlugin('mayaUsdPlugin')"), 'USD loads mayaUsdPlugin');
  expect(usd.script.includes('cmds.mayaUSDExport('), 'USD uses mayaUSDExport');
  const abc = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: '/tmp/o.abc', format: 'abc' });
  expect(abc.ok === true, 'abc export builds');
  expect(abc.script.includes("cmds.loadPlugin('AbcExport')"), 'ABC loads AbcExport plugin');
  expect(abc.script.includes('cmds.AbcExport('), 'ABC uses AbcExport');
  assertStandalonePins(abc.script, 'export_scene abc');
  pass('export_scene OBJ/USD/ABC map to the right plugin + export call');
}

// ── export_scene: extension must match format ────────────────────────────────
{
  const mismatch = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: '/tmp/o.obj', format: 'fbx' });
  expect(mismatch.ok === false, 'FBX format with .obj output is rejected');
  expect(mismatch.notes.some((n) => n.includes('.fbx')), 'mismatch note names the expected extension');
  const badFormat = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: '/tmp/o.fbx', format: 'stl' as never });
  expect(badFormat.ok === false, 'unknown export format rejected');
  const badSceneExt = buildMayaScript('export_scene', { scenePath: '/tmp/s.blend', outputPath: '/tmp/o.fbx', format: 'fbx' });
  expect(badSceneExt.ok === false, 'non-.ma/.mb scene rejected');
  expect(badSceneExt.notes.some((n) => n.includes('.ma or .mb')), 'scene-ext note names the allowed set');
  pass('export_scene enforces format↔extension agreement + scene extension allowlist');
}

// ── never write over the source ──────────────────────────────────────────────
{
  const same = buildMayaScript('convert_format', { scenePath: '/tmp/s.ma', outputPath: '/tmp/s.ma' });
  expect(same.ok === false, 'convert to the SAME path as the source is rejected');
  expect(same.notes.some((n) => /differ|source/i.test(n)), 'same-path rejection is explained');
  // export writing over an (identically-pathed) source is impossible by ext, but
  // guard the identical-path case explicitly where extensions could coincide.
  const sameExport = buildMayaScript('export_scene', { scenePath: '/tmp/thing.ma', outputPath: '/tmp/thing.ma', format: 'fbx' });
  expect(sameExport.ok === false, 'export to the source path/ext is rejected (never overwrite source)');
  pass('scripts never target the source scene path (no overwrite)');
}

// ── export_scene: hostile path injection is rejected (never embedded) ────────
{
  const cases: Array<[string, string]> = [
    ['/tmp/a`id`.fbx', 'backtick'],
    ['/tmp/a;rm -rf ~.fbx', 'semicolon'],
    ['/tmp/a$(id).fbx', 'subshell'],
    ['/tmp/a|b.fbx', 'pipe'],
    ['/tmp/a>b.fbx', 'redirect'],
    ['/tmp/../../etc/passwd.fbx', 'traversal'],
    ['/tmp/part-😀.fbx', 'non-BMP'],
  ];
  for (const [p, label] of cases) {
    const r = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: p, format: 'fbx' });
    expect(r.ok === false, `${label} output path rejected (ok:false)`);
    expect(!scriptContainsRaw(r.script, p), `${label} output path never appears in the emitted (stub) script`);
    expect(r.script.includes('FAIL-CLOSED STUB'), `${label} rejection yields a fail-closed stub`);
    // Same hostile shape on the SCENE path is rejected too.
    const rs = buildMayaScript('export_scene', { scenePath: p.replace('.fbx', '.ma'), outputPath: '/tmp/o.fbx', format: 'fbx' });
    expect(rs.ok === false, `${label} scene path rejected (ok:false)`);
  }
  // Control char (newline) in path.
  const nl = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: '/tmp/a\nb.fbx', format: 'fbx' });
  expect(nl.ok === false, 'newline in path rejected');
  pass('export_scene rejects shell-metachar / traversal / non-BMP / control-char paths on scene AND output');
}

// ── CONCRETE INJECTION: a Python-breakout + shell-shaped path is blocked ──────
// This is the load-bearing case: a path crafted to break OUT of the generated
// Python string literal AND run a shell command must be rejected by validation
// and must NEVER appear in the emitted script text (not even in the stub).
{
  // Contains: a double-quote (would close a naive "..."), a semicolon + backtick
  // (shell), and a Python statement separator. Every one of these is caught by
  // the shell-metachar reject (`;` and backtick) before it can matter — but the
  // point is defense in depth: even the quote is JSON-escaped, never raw.
  const injection = '/tmp/out"; import os; os.system("id") #.fbx';
  const r = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: injection, format: 'fbx' });
  expect(r.ok === false, 'injection-shaped path rejected (contains ; and backtick? -> at least ; )');
  expect(!scriptContainsRaw(r.script, injection), 'injection string never appears anywhere in the emitted stub');
  expect(!r.script.includes('os.system'), 'no os.system call is present in the emitted script');
  expect(!r.script.includes('import os; os.system'), 'the breakout fragment is not present');
  // A second, subtler injection that has NO shell metachar but DOES carry a
  // double-quote + backslash: it is ALLOWED as a path (no metachar) but MUST be
  // JSON-escaped, never raw-concatenated — prove the escaper neutralizes it.
  const quotePath = '/tmp/say "pwned"\\end.fbx';
  const r2 = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: quotePath, format: 'fbx' });
  expect(r2.ok === true, 'quote+backslash path is allowed (no shell metachar) and builds');
  expect(r2.script.includes(JSON.stringify(quotePath)), 'quote/backslash path embedded via JSON-escaped literal');
  expect(!r2.script.includes(`OUTPUT_PATH = "${quotePath}"`), 'raw unescaped interpolation of the quote path never happens');
  pass('concrete injection blocked: shell-breakout rejected + quote/backslash JSON-escaped, never raw');
}

// ── playblast_or_render_frame: happy path + safe embedding + frame as digits ──
{
  const r = buildMayaScript('playblast_or_render_frame', {
    scenePath: '/Users/demo/shot.mb',
    outputPath: '/Users/demo/Desktop/frame.png',
    format: 'png',
    frame: 24,
  });
  expect(r.ok === true, 'single-frame render builds');
  expect(r.script.includes(`OUTPUT_PATH = ${JSON.stringify('/Users/demo/Desktop/frame.png')}`), 'render output path embedded as escaped literal');
  expect(r.script.includes('FRAME = 24'), 'frame emitted as a bare integer literal (digits only)');
  expect(r.script.includes('cmds.currentTime(24, edit=True)') || r.script.includes('cmds.currentTime(FRAME'), 'timeline pinned to the frame');
  expect(r.script.includes('cmds.setAttr'), 'render globals set for the single frame');
  expect(r.script.includes('.render('), 'invokes the render command');
  expect(r.script.includes('os.path.isfile(OUTPUT_PATH)'), 'verifies the rendered file exists');
  expect(r.outputHint === '/Users/demo/Desktop/frame.png', 'outputHint is the image path');
  assertStandalonePins(r.script, 'render frame');
  // frame accepts a plain integer string too
  const strFrame = buildMayaScript('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.exr', format: 'exr', frame: '101' });
  expect(strFrame.ok === true, 'integer string frame accepted');
  expect(strFrame.script.includes('FRAME = 101'), 'string frame normalized to a bare integer literal');
  pass('render frame: shape pins + safe path embedding + frame emitted as digits + standalone pins');
}

// ── playblast_or_render_frame: FRAME allowlist (injection/format rejection) ───
{
  const badFrames: Array<unknown> = [
    -1, // negative
    1.5, // decimal
    '1e6', // exponent
    '0x10', // hex
    'Infinity',
    'NaN',
    Number.POSITIVE_INFINITY,
    Number.NaN,
    '24; rm -rf /', // shell injection shaped
    '24)', // python breakout shaped
    '`id`',
    '',
    '  ', // whitespace only
    MAYA_FRAME_MAX + 1, // above bound
    '99999999', // 8 digits, above 7-digit cap
  ];
  for (const frame of badFrames) {
    const v = validateMayaArgs('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'png', frame: frame as never });
    expect(v.ok === false, `hostile/invalid frame rejected: ${JSON.stringify(frame)}`);
    const built = buildMayaScript('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'png', frame: frame as never });
    expect(built.ok === false, `hostile frame yields fail-closed stub: ${JSON.stringify(frame)}`);
    // Injection-shaped frame strings must never appear in the emitted stub.
    if (typeof frame === 'string' && /[;`$()|&><'"\s]/.test(frame) && frame.trim().length > 0) {
      expect(!scriptContainsRaw(built.script, frame), `injection-shaped frame never lands in script: ${JSON.stringify(frame)}`);
    }
  }
  // Good frames at the bounds.
  expect(validateMayaArgs('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'png', frame: 0 }).ok, 'frame 0 accepted');
  expect(validateMayaArgs('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'png', frame: MAYA_FRAME_MAX }).ok, 'frame at MAX accepted');
  // Image-format enforcement.
  const badImg = buildMayaScript('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'gif' as never, frame: 1 });
  expect(badImg.ok === false, 'unknown image format rejected');
  const extMismatch = buildMayaScript('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.jpg', format: 'png', frame: 1 });
  expect(extMismatch.ok === false, 'image output extension must match the format');
  pass('frame allowlist rejects negative/decimal/exponent/hex/Infinity/NaN/injection/over-bound; image format+ext enforced');
}

// ── convert_format: .ma <-> .mb happy path + safe embedding ──────────────────
{
  const maToMb = buildMayaScript('convert_format', { scenePath: '/Users/demo/scene.ma', outputPath: '/Users/demo/scene.mb' });
  expect(maToMb.ok === true, 'ma->mb convert builds');
  expect(maToMb.script.includes(`SCENE_PATH = ${JSON.stringify('/Users/demo/scene.ma')}`), 'scene path embedded as escaped literal');
  expect(maToMb.script.includes(`OUTPUT_PATH = ${JSON.stringify('/Users/demo/scene.mb')}`), 'output path embedded as escaped literal');
  expect(maToMb.script.includes("FILE_TYPE = \"mayaBinary\""), 'mb target uses mayaBinary file type');
  expect(maToMb.script.includes('cmds.file(rename=OUTPUT_PATH)'), 'renames the in-memory scene before saving (never overwrites source)');
  expect(maToMb.script.includes('cmds.file(save=True, type=FILE_TYPE'), 'saves as the target container type');
  expect(maToMb.script.includes('os.path.isfile(OUTPUT_PATH)'), 'verifies the saved file exists');
  assertStandalonePins(maToMb.script, 'convert ma->mb');
  const mbToMa = buildMayaScript('convert_format', { scenePath: '/tmp/s.mb', outputPath: '/tmp/s2.ma' });
  expect(mbToMa.ok === true && mbToMa.script.includes("FILE_TYPE = \"mayaAscii\""), 'mb->ma uses mayaAscii file type');
  const badOut = buildMayaScript('convert_format', { scenePath: '/tmp/s.ma', outputPath: '/tmp/s.fbx' });
  expect(badOut.ok === false, 'convert output must be .ma or .mb');
  pass('convert_format: .ma<->.mb shape pins + rename-before-save + safe embedding');
}

// ── SAFE EMBEDDING: non-ASCII path escapes to \uXXXX, script stays pure ASCII ─
{
  const highBmpPath = '/Users/demo/Desktop/пéĀshot.fbx'; // Latin/Cyrillic BMP chars
  const hb = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: highBmpPath, format: 'fbx' });
  expect(hb.ok === true, 'BMP non-ASCII path builds');
  expect(/\\u00e9/.test(hb.script) || /\\u0100/.test(hb.script) || /\\u043f/.test(hb.script), 'non-ASCII BMP chars escaped to \\uXXXX');
  expect(!/[^\x00-\x7f]/.test(hb.script), 'generated script is pure ASCII (no raw non-ASCII bytes)');
  // And a BMP non-ASCII SCENE path escapes too.
  const hbScene = buildMayaScript('convert_format', { scenePath: '/tmp/пシーン.ma', outputPath: '/tmp/out.mb' });
  expect(hbScene.ok === true, 'BMP non-ASCII scene path builds');
  expect(!/[^\x00-\x7f]/.test(hbScene.script), 'convert script stays pure ASCII too');
  pass('safe embedding: non-ASCII BMP chars → \\uXXXX, generated script stays pure ASCII');
}

// ── bounds: long paths + huge frames ─────────────────────────────────────────
{
  const longPath = '/tmp/' + 'a'.repeat(2000) + '.fbx';
  const r = buildMayaScript('export_scene', { scenePath: '/tmp/s.ma', outputPath: longPath, format: 'fbx' });
  expect(r.ok === false, 'over-1024-char output path rejected');
  const longScene = buildMayaScript('export_scene', { scenePath: '/tmp/' + 'a'.repeat(2000) + '.ma', outputPath: '/tmp/o.fbx', format: 'fbx' });
  expect(longScene.ok === false, 'over-1024-char scene path rejected');
  const hugeFrame = validateMayaArgs('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'png', frame: 5_000_000 });
  expect(hugeFrame.ok === false, 'frame above MAX rejected');
  pass('bounds: path ≤1024 on scene+output, frame ≤ MAX enforced');
}

// ── degenerate inputs NEVER throw ────────────────────────────────────────────
{
  const degenerate: Array<[unknown, unknown]> = [
    [null, null],
    [undefined, undefined],
    ['export_scene', null],
    ['export_scene', 'not an object'],
    ['export_scene', 42],
    ['export_scene', {}],
    ['playblast_or_render_frame', {}],
    ['playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png' }], // missing format+frame
    ['convert_format', {}],
    ['convert_format', { scenePath: null, outputPath: null }],
    ['nonsense_op', { scenePath: '/tmp/s.ma', outputPath: '/tmp/o.fbx', format: 'fbx' }],
    [{}, {}],
    [123, { scenePath: '/tmp/s.ma', outputPath: '/tmp/o.fbx', format: 'fbx' }],
  ];
  for (const [op, input] of degenerate) {
    let threw = false;
    let result: ReturnType<typeof buildMayaScript> | null = null;
    try {
      result = buildMayaScript(op, input);
    } catch {
      threw = true;
    }
    expect(!threw, `buildMayaScript never throws for ${JSON.stringify(op)} / ${JSON.stringify(input)?.slice(0, 30)}`);
    expect(result !== null && result.ok === false, 'degenerate input yields ok:false');
    expect(result !== null && result.scriptExtension === 'py', 'degenerate result still declares a .py script');
    expect(result !== null && typeof result.script === 'string' && result.script.length > 0, 'degenerate result still returns a (stub) script');
    expect(result !== null && result.script.includes('UC_MAYA_ERROR'), 'stub carries the error sentinel');
    // Fail-closed stub must NOT start maya.standalone (mutates nothing).
    expect(result !== null && !result.script.includes('maya.standalone.initialize'), 'fail-closed stub never initializes maya.standalone');
    // validate + describe never throw either
    let v2Threw = false;
    try {
      validateMayaArgs(op, input);
      describeMayaOperation(op, input);
    } catch {
      v2Threw = true;
    }
    expect(!v2Threw, 'validateMayaArgs + describeMayaOperation never throw on degenerate input');
  }
  pass('degenerate inputs never throw; always a fail-closed .py stub (no standalone init) with error sentinel');
}

// ── describeMayaOperation ────────────────────────────────────────────────────
{
  expect(/FBX/i.test(describeMayaOperation('export_scene', { scenePath: '/tmp/s.ma', outputPath: '/tmp/o.fbx', format: 'fbx' })), 'export description names the format');
  expect(/frame/i.test(describeMayaOperation('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'png', frame: 7 })), 'render description mentions frame');
  expect(/7/.test(describeMayaOperation('playblast_or_render_frame', { scenePath: '/tmp/s.ma', outputPath: '/tmp/f.png', format: 'png', frame: 7 })), 'render description includes the frame number');
  expect(/convert|MB|MA/i.test(describeMayaOperation('convert_format', { scenePath: '/tmp/s.ma', outputPath: '/tmp/s.mb' })), 'convert description mentions conversion/format');
  const generic = describeMayaOperation('bogus', {});
  expect(generic.length > 0 && generic.length < 120, 'unknown op yields a bounded generic line');
  pass('describeMayaOperation gives bounded, informative approval lines');
}

if (failures > 0) {
  console.error(`\n${failures} maya script adapter smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll maya script adapter smoke cases passed.');
