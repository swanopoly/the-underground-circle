/**
 * cad-code-executor-smoketest — verifies the pure planning/validation layer
 * behind local code-CAD execution (src/lib/cadCodeExecutor.ts): OpenSCAD
 * compile plans (deterministic naming, -D allowlist incl. injection
 * rejection), FreeCAD headless script generation (safe Python literal
 * embedding, honest thumbnail unsupported), Blender headless bpy script
 * generation (mesh conversion + Workbench render previews), inspect-output
 * parsing, engine resolution matrix, install guidance, bounded compile
 * receipts, and the bridge-side LOCKSTEP surface (fixed blender binaries,
 * fixed argv, extraArgs rejection).
 *
 * Run: npx tsx scripts/cad-code-executor-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildBlenderPythonScript,
  buildCadCompileReceipt,
  buildFreeCadPythonScript,
  buildOpenScadCompilePlan,
  describeCadInstallGuidance,
  FREECAD_INSPECT_SENTINEL,
  isAllowedOpenScadExtraArg,
  parseFreeCadInspectOutput,
  resolveCadEngineForTask,
} from '../src/lib/cadCodeExecutor';

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

function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── buildOpenScadCompilePlan: naming ────────────────────────────────────────
{
  const plan = buildOpenScadCompilePlan({
    brief: 'Parametric Hinge Bracket, 3 holes!',
    outputKind: 'stl',
    workDir: '/Users/demo/Documents/uc-cad',
  });
  expect(plan.sourceFileName === 'parametric-hinge-bracket-3-holes.scad', `slugged source name (got ${plan.sourceFileName})`);
  expect(plan.outputFileName === 'parametric-hinge-bracket-3-holes.stl', 'output name shares the slug with .stl ext');
  expect(plan.sourcePath === '/Users/demo/Documents/uc-cad/parametric-hinge-bracket-3-holes.scad', 'sourcePath joined to workDir');
  expect(plan.outputPath.endsWith('.stl'), 'outputPath ends with output extension');
  const again = buildOpenScadCompilePlan({
    brief: 'Parametric Hinge Bracket, 3 holes!',
    outputKind: 'stl',
    workDir: '/Users/demo/Documents/uc-cad',
  });
  expect(deepEquals(plan, again), 'plan is deterministic — same inputs, same plan (no Date.now)');
  pass('openscad plan naming is slugged + deterministic');
}

// ── buildOpenScadCompilePlan: stamp + fallbacks ─────────────────────────────
{
  const stamped = buildOpenScadCompilePlan({ brief: 'lid', outputKind: '3mf', workDir: '/tmp/x', stamp: 'Run 7' });
  expect(stamped.sourceFileName === 'lid-run-7.scad', `stamp normalized into name (got ${stamped.sourceFileName})`);
  expect(stamped.outputFileName === 'lid-run-7.3mf', '3mf output extension honored');
  const empty = buildOpenScadCompilePlan({ brief: '???', outputKind: 'stl', workDir: '/tmp/x' });
  expect(empty.sourceFileName === 'cad-part.scad', 'unusable brief falls back to cad-part');
  const badKind = buildOpenScadCompilePlan({ brief: 'lid', outputKind: 'exe' as never, workDir: '/tmp/x' });
  expect(badKind.outputFileName.endsWith('.stl'), 'unsupported outputKind defaults to stl');
  expect(badKind.notes.some((n) => n.includes('defaulted to stl')), 'outputKind fallback is noted');
  const badDir = buildOpenScadCompilePlan({ brief: 'lid', outputKind: 'stl', workDir: 'bad;dir' });
  expect(badDir.sourcePath === 'lid.scad', 'invalid workDir leaves bare file names');
  expect(badDir.notes.some((n) => n.toLowerCase().includes('workdir invalid')), 'invalid workDir is noted');
  pass('stamp, outputKind, and workDir fallbacks behave');
}

// ── buildOpenScadCompilePlan: parameters → -D args ──────────────────────────
{
  const plan = buildOpenScadCompilePlan({
    brief: 'box',
    outputKind: 'stl',
    workDir: '/tmp/x',
    parameters: { width: 40, height: 12.5, rounded: true, label: 'false' },
  });
  expect(plan.extraArgs.includes('-Dwidth=40'), 'numeric parameter emitted as -D');
  expect(plan.extraArgs.includes('-Dheight=12.5'), 'decimal parameter emitted as -D');
  expect(plan.extraArgs.includes('-Drounded=true'), 'boolean parameter emitted as -D');
  expect(plan.extraArgs.includes('-Dlabel=false'), 'string "false" accepted as boolean value');
  expect(plan.extraArgs.every((a) => isAllowedOpenScadExtraArg(a)), 'every emitted arg passes the shared allowlist');
  pass('valid parameters become allowlisted -D args');
}

// ── buildOpenScadCompilePlan: injection rejection ───────────────────────────
{
  const plan = buildOpenScadCompilePlan({
    brief: 'box',
    outputKind: 'stl',
    workDir: '/tmp/x',
    parameters: {
      'width; rm -rf /': 10,
      depth: '12; touch /tmp/pwn',
      $fn: 64,
      cmd: '`id`',
      note: 'hello world',
      inf: Number.POSITIVE_INFINITY,
    },
  });
  expect(plan.extraArgs.length === 0, `all hostile/invalid parameters dropped (got ${JSON.stringify(plan.extraArgs)})`);
  expect(plan.notes.filter((n) => n.startsWith('Dropped parameter')).length >= 5, 'each dropped parameter is noted');
  pass('shell-injection-shaped parameters never reach argv');
}

// ── png plan extras ─────────────────────────────────────────────────────────
{
  const plan = buildOpenScadCompilePlan({ brief: 'preview', outputKind: 'png', workDir: '/tmp/x' });
  expect(plan.extraArgs.includes('--render'), 'png plan forces --render');
  expect(plan.extraArgs.includes('--imgsize=1024,768'), 'png plan sets bounded imgsize');
  expect(plan.outputFileName.endsWith('.png'), 'png output extension');
  pass('png plan adds render + imgsize extras');
}

// ── isAllowedOpenScadExtraArg matrix ────────────────────────────────────────
{
  expect(isAllowedOpenScadExtraArg('-Dwidth=10'), '-Dwidth=10 allowed');
  expect(isAllowedOpenScadExtraArg('-Dw_2=-0.5'), 'negative decimal allowed');
  expect(isAllowedOpenScadExtraArg('-Dflag=false'), 'boolean false allowed');
  expect(isAllowedOpenScadExtraArg('--render'), '--render allowed');
  expect(isAllowedOpenScadExtraArg('--imgsize=640,480'), 'comma imgsize allowed');
  expect(!isAllowedOpenScadExtraArg('-D width=10'), 'space after -D rejected');
  expect(!isAllowedOpenScadExtraArg('-Dwidth=10;rm -rf /'), 'semicolon injection rejected');
  expect(!isAllowedOpenScadExtraArg('-Dwidth=`id`'), 'backtick injection rejected');
  expect(!isAllowedOpenScadExtraArg('-Dwidth=$(id)'), 'subshell injection rejected');
  expect(!isAllowedOpenScadExtraArg('-Dname=1e9'), 'exponent value rejected (not plain number)');
  expect(!isAllowedOpenScadExtraArg('--imgsize=9,9'), 'imgsize below 16 rejected');
  expect(!isAllowedOpenScadExtraArg('--imgsize=800x600'), 'WxH form rejected (OpenSCAD CLI is comma form)');
  expect(!isAllowedOpenScadExtraArg('--imgsize=99999,768'), 'imgsize above 8192 rejected');
  expect(!isAllowedOpenScadExtraArg('-o/etc/passwd'), 'second -o rejected');
  expect(!isAllowedOpenScadExtraArg('--export-format=asciistl'), 'unknown long flag rejected');
  expect(!isAllowedOpenScadExtraArg(''), 'empty string rejected');
  expect(!isAllowedOpenScadExtraArg(42 as never), 'non-string rejected');
  pass('extraArgs allowlist matrix (allowed + rejected forms)');
}

// ── buildFreeCadPythonScript: convert ───────────────────────────────────────
{
  const inputPath = "/Users/demo/My 'Parts' Folder/bracket v2.step";
  const outputPath = '/Users/demo/Desktop/bracket-v2.stl';
  const built = buildFreeCadPythonScript({ operation: 'convert', inputPath, outputPath });
  expect(built.ok === true, 'step→stl convert script builds');
  if (built.ok) {
    expect(built.python.includes(`INPUT_PATH = ${JSON.stringify(inputPath)}`), 'input path embedded as escaped literal (JSON repr)');
    expect(built.python.includes(`OUTPUT_PATH = ${JSON.stringify(outputPath)}`), 'output path embedded as escaped literal');
    expect(built.python.includes('import FreeCAD'), 'imports FreeCAD App module');
    expect(built.python.includes('Mesh.export'), 'stl output uses Mesh.export');
    expect(built.python.includes('UC_CAD_ERROR'), 'script fails closed with sentinel errors');
    expect(built.python.includes('os.path.isfile(OUTPUT_PATH)'), 'script verifies its own output exists');
    expect(!built.python.includes('FreeCADGui'), 'no GUI module in headless script');
    expect(!built.python.includes('TechDraw'), 'no TechDraw in headless script');
    expect(built.suggestedScriptFileName === 'uc-freecad-convert.py', 'suggested staging name is deterministic');
  }
  pass('freecad convert script embeds paths safely and fails closed');
}

// ── buildFreeCadPythonScript: quote/backslash path escaping ─────────────────
{
  const trickyPath = '/Users/demo/Desktop/say "hi"\\part.fcstd';
  const built = buildFreeCadPythonScript({ operation: 'convert', inputPath: trickyPath, outputPath: '/tmp/out.step' });
  expect(built.ok === true, 'path with double quote + backslash still builds');
  if (built.ok) {
    expect(built.python.includes(JSON.stringify(trickyPath)), 'quotes/backslashes escaped via JSON repr, never raw');
    expect(!built.python.includes(`= "${trickyPath}"`), 'raw unescaped interpolation never happens');
  }
  pass('tricky characters in paths are escaped, not interpolated');
}

// ── buildFreeCadPythonScript: rejections ────────────────────────────────────
{
  const badInputExt = buildFreeCadPythonScript({ operation: 'convert', inputPath: '/tmp/mesh.stl', outputPath: '/tmp/out.step' });
  expect(!badInputExt.ok, 'stl input rejected for freecad convert (mesh, not BREP document)');
  const badOutputExt = buildFreeCadPythonScript({ operation: 'convert', inputPath: '/tmp/a.step', outputPath: '/tmp/out.png' });
  expect(!badOutputExt.ok, 'png output rejected for freecad convert');
  const missingOutput = buildFreeCadPythonScript({ operation: 'convert', inputPath: '/tmp/a.step' });
  expect(!missingOutput.ok, 'convert without outputPath rejected');
  const metachar = buildFreeCadPythonScript({ operation: 'convert', inputPath: '/tmp/a`b.step', outputPath: '/tmp/out.stl' });
  expect(!metachar.ok, 'backtick in path rejected (lockstep with bridge validator)');
  const semicolon = buildFreeCadPythonScript({ operation: 'convert', inputPath: '/tmp/a;b.step', outputPath: '/tmp/out.stl' });
  expect(!semicolon.ok, 'semicolon in path rejected');
  const emoji = buildFreeCadPythonScript({ operation: 'convert', inputPath: '/tmp/part-😀.step', outputPath: '/tmp/out.stl' });
  expect(!emoji.ok, 'non-BMP characters rejected (cannot embed as \\uXXXX Python literal)');
  if (!badInputExt.ok) expect(badInputExt.unsupported === false, 'invalid input is a validation error, not "unsupported"');
  pass('freecad script builder rejects bad extensions and hostile paths');
}

// ── buildFreeCadPythonScript: inspect ───────────────────────────────────────
{
  const built = buildFreeCadPythonScript({ operation: 'inspect', inputPath: '/Users/demo/Desktop/asm.fcstd' });
  expect(built.ok === true, 'inspect script builds for .fcstd');
  if (built.ok) {
    expect(built.python.includes(JSON.stringify(FREECAD_INSPECT_SENTINEL)), 'inspect prints behind the sentinel prefix');
    expect(built.python.includes('json.dumps(summary)[:4000]'), 'inspect JSON is bounded at print time');
    expect(built.python.includes('shape.isValid()'), 'inspect checks shape validity');
    expect(!built.python.includes('FreeCADGui'), 'inspect stays headless');
  }
  pass('freecad inspect script is sentinel-prefixed and bounded');
}

// ── buildFreeCadPythonScript: thumbnail honestly unsupported ────────────────
{
  const built = buildFreeCadPythonScript({ operation: 'thumbnail', inputPath: '/tmp/a.step', outputPath: '/tmp/a.png' });
  expect(!built.ok, 'thumbnail does not build a script');
  if (!built.ok) {
    expect(built.unsupported === true, 'thumbnail is flagged unsupported:true');
    expect(/headless|GUI/i.test(built.reason), 'reason explains the headless/GUI limitation');
  }
  pass('thumbnail returns unsupported instead of faking output');
}

// ── parseFreeCadInspectOutput ───────────────────────────────────────────────
{
  const summary = {
    objectCount: 4,
    shapeObjectCount: 3,
    invalidShapeCount: 1,
    bbox: { minX: 0, minY: -5, minZ: 0, maxX: 120, maxY: 75, maxZ: 15 },
    labels: ['Body', 'Bracket', 'Pad'],
  };
  const stdout = `FreeCAD 1.0 starting...\nsome noise\n${FREECAD_INSPECT_SENTINEL}${JSON.stringify(summary)}\n`;
  const parsed = parseFreeCadInspectOutput(stdout);
  expect(!!parsed, 'sentinel line parses');
  expect(parsed?.objectCount === 4 && parsed?.shapeObjectCount === 3 && parsed?.invalidShapeCount === 1, 'counts round-trip');
  expect(parsed?.bbox?.maxX === 120 && parsed?.bbox?.minY === -5, 'bbox round-trips');
  expect(deepEquals(parsed?.labels, ['Body', 'Bracket', 'Pad']), 'labels round-trip');
  expect(parseFreeCadInspectOutput('no sentinel here') === null, 'missing sentinel → null');
  expect(parseFreeCadInspectOutput(`${FREECAD_INSPECT_SENTINEL}{not json`) === null, 'bad JSON → null');
  expect(parseFreeCadInspectOutput('') === null, 'empty stdout → null');
  const overload = {
    objectCount: -3,
    shapeObjectCount: 1e15,
    invalidShapeCount: 'x',
    bbox: { minX: 0, minY: 0, minZ: 0, maxX: 'oops', maxY: 1, maxZ: 1 },
    labels: Array.from({ length: 30 }, (_, i) => `L${i}`.padEnd(120, 'x')),
  };
  const bounded = parseFreeCadInspectOutput(`${FREECAD_INSPECT_SENTINEL}${JSON.stringify(overload)}`);
  expect(bounded?.objectCount === 0, 'negative count clamps to 0');
  expect(bounded?.shapeObjectCount === 1_000_000_000, 'huge count clamps to 1e9');
  expect(bounded?.invalidShapeCount === 0, 'non-numeric count clamps to 0');
  expect(bounded?.bbox === null, 'non-finite bbox member drops the bbox');
  expect(bounded?.labels.length === 20 && bounded.labels[0].length === 80, 'labels bounded to 20 × 80 chars');
  pass('inspect output parsing: round-trip, null on garbage, bounded fields');
}

// ── buildBlenderPythonScript: convert stl→glb ───────────────────────────────
{
  const inputPath = "/Users/demo/My 'Meshes'/rocker arm.stl";
  const outputPath = '/Users/demo/Desktop/rocker-arm.glb';
  const built = buildBlenderPythonScript({ operation: 'convert', inputPath, outputPath });
  expect(built.ok === true, 'stl→glb blender convert script builds');
  if (built.ok) {
    expect(built.python.includes(`INPUT_PATH = ${JSON.stringify(inputPath)}`), 'blender input path embedded as escaped literal (JSON repr)');
    expect(built.python.includes(`OUTPUT_PATH = ${JSON.stringify(outputPath)}`), 'blender output path embedded as escaped literal');
    expect(built.python.includes('bpy.ops.wm.read_factory_settings(use_empty=True)'), 'scene reset to an EMPTY factory scene first');
    expect(built.python.includes('bpy.ops.wm.stl_import(filepath=INPUT_PATH)'), 'stl import uses the Blender 4.x wm operator');
    expect(built.python.includes("bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')"), 'glb export uses the glTF exporter in GLB mode');
    expect(built.python.includes('UC_CAD_ERROR'), 'blender script fails closed with sentinel errors');
    expect(built.python.includes('os.path.isfile(OUTPUT_PATH)'), 'blender script verifies its own output exists');
    expect(built.python.includes('no mesh objects imported'), 'empty import fails closed instead of exporting nothing');
    expect(built.suggestedScriptFileName === 'uc-blender-convert.py', 'blender convert staging name is deterministic');
    expect(built.notes.some((n) => n.includes('engine: "blender"')), 'notes point at cad_compile engine blender');
  }
  pass('blender convert script embeds paths safely and fails closed');
}

// ── buildBlenderPythonScript: render_preview ────────────────────────────────
{
  const built = buildBlenderPythonScript({ operation: 'render_preview', inputPath: '/tmp/part.obj', outputPath: '/tmp/part-preview.png' });
  expect(built.ok === true, 'obj render_preview script builds');
  if (built.ok) {
    expect(built.python.includes("scene.render.engine = 'BLENDER_WORKBENCH'"), 'headless render pins the Workbench engine (EEVEE needs a GPU/GL context)');
    expect(!/render\.engine\s*=\s*'BLENDER_EEVEE/.test(built.python), 'render engine is never set to an EEVEE variant');
    expect(built.python.includes('bpy.ops.wm.obj_import(filepath=INPUT_PATH)'), 'obj import uses the Blender 4.x wm operator');
    expect(built.python.includes('scene.render.filepath = OUTPUT_PATH'), 'render filepath is the escaped OUTPUT_PATH literal');
    expect(built.python.includes('bpy.ops.render.render(write_still=True)'), 'render writes the still image');
    expect(built.python.includes('scene.camera = camera_object'), 'auto-placed camera becomes the scene camera');
    expect(built.python.includes("to_track_quat('-Z', 'Y')"), 'camera aims at the mesh bbox center (no GUI viewport ops)');
    expect(built.suggestedScriptFileName === 'uc-blender-render-preview.py', 'render preview staging name is deterministic');
  }
  pass('blender render preview is Workbench-pinned with auto camera framing');
}

// ── buildBlenderPythonScript: quote/backslash path escaping ─────────────────
{
  const tricky = '/tmp/say "hi"\\mesh.stl';
  const built = buildBlenderPythonScript({ operation: 'convert', inputPath: tricky, outputPath: '/tmp/out.obj' });
  expect(built.ok === true, 'path with double quote + backslash still builds');
  if (built.ok) {
    expect(built.python.includes(JSON.stringify(tricky)), 'quotes/backslashes escaped via JSON repr, never raw');
    expect(!built.python.includes(`= "${tricky}"`), 'raw unescaped interpolation never happens (no user-input interpolation)');
  }
  pass('tricky characters in blender paths are escaped, not interpolated');
}

// ── buildBlenderPythonScript: rejections ────────────────────────────────────
{
  const stepInput = buildBlenderPythonScript({ operation: 'convert', inputPath: '/tmp/a.step', outputPath: '/tmp/out.stl' });
  expect(!stepInput.ok, 'step input rejected for blender (B-rep belongs to freecadcmd)');
  const stepOutput = buildBlenderPythonScript({ operation: 'convert', inputPath: '/tmp/a.stl', outputPath: '/tmp/out.step' });
  expect(!stepOutput.ok, 'step output rejected for blender (mesh→BREP is not a conversion)');
  const jpgPreview = buildBlenderPythonScript({ operation: 'render_preview', inputPath: '/tmp/a.stl', outputPath: '/tmp/out.jpg' });
  expect(!jpgPreview.ok, 'render_preview output must be .png');
  const metachar = buildBlenderPythonScript({ operation: 'convert', inputPath: '/tmp/a;b.stl', outputPath: '/tmp/out.glb' });
  expect(!metachar.ok, 'semicolon in blender path rejected (lockstep with bridge validator)');
  const emoji = buildBlenderPythonScript({ operation: 'convert', inputPath: '/tmp/mesh-😀.stl', outputPath: '/tmp/out.glb' });
  expect(!emoji.ok, 'non-BMP characters rejected for blender paths');
  const badOp = buildBlenderPythonScript({ operation: 'orbit' as never, inputPath: '/tmp/a.stl', outputPath: '/tmp/o.png' });
  expect(!badOp.ok, 'unknown blender operation rejected');
  pass('blender script builder rejects bad extensions, hostile paths, and unknown ops');
}

// ── resolveCadEngineForTask matrix ──────────────────────────────────────────
{
  expect(resolveCadEngineForTask({ sourceExt: 'scad', desiredOutputExt: 'stl' }) === 'openscad', 'scad→stl = openscad');
  expect(resolveCadEngineForTask({ sourceExt: '.SCAD', desiredOutputExt: '.PNG' }) === 'openscad', 'case/dot-insensitive scad→png');
  expect(resolveCadEngineForTask({ sourceExt: 'step', desiredOutputExt: 'stl' }) === 'freecadcmd', 'step→stl = freecadcmd');
  expect(resolveCadEngineForTask({ sourceExt: 'fcstd', desiredOutputExt: 'step' }) === 'freecadcmd', 'fcstd→step = freecadcmd');
  expect(resolveCadEngineForTask({ sourceExt: 'dxf', desiredOutputExt: 'dxf' }) === 'freecadcmd', 'dxf→dxf = freecadcmd');
  const scadToStep = resolveCadEngineForTask({ sourceExt: 'scad', desiredOutputExt: 'step' });
  expect(typeof scadToStep === 'object' && scadToStep.unsupported === true, 'scad→step honestly unsupported');
  const stlToStep = resolveCadEngineForTask({ sourceExt: 'stl', desiredOutputExt: 'step' });
  expect(typeof stlToStep === 'object' && stlToStep.reason === 'mesh_to_brep_not_supported', 'stl→step = mesh_to_brep_not_supported');
  const stlToStl = resolveCadEngineForTask({ sourceExt: 'stl', desiredOutputExt: 'stl' });
  expect(typeof stlToStl === 'object' && stlToStl.unsupported === true, 'stl→stl has no headless engine here');
  const docx = resolveCadEngineForTask({ sourceExt: 'docx', desiredOutputExt: 'stl' });
  expect(typeof docx === 'object' && docx.reason === 'unsupported_source_format', 'docx source unsupported');
  const missing = resolveCadEngineForTask({ sourceExt: '', desiredOutputExt: 'stl' });
  expect(typeof missing === 'object' && missing.reason === 'missing_source_extension', 'missing source extension reported');
  pass('engine resolution matrix (openscad / freecad / honest unsupported)');
}

// ── resolveCadEngineForTask: blender additions ──────────────────────────────
{
  expect(resolveCadEngineForTask({ sourceExt: 'stl', desiredOutputExt: 'glb' }) === 'blender', 'stl→glb = blender');
  expect(resolveCadEngineForTask({ sourceExt: 'obj', desiredOutputExt: 'stl' }) === 'blender', 'obj→stl = blender');
  expect(resolveCadEngineForTask({ sourceExt: 'glb', desiredOutputExt: 'obj' }) === 'blender', 'glb→obj = blender');
  expect(resolveCadEngineForTask({ sourceExt: 'ply', desiredOutputExt: 'gltf' }) === 'blender', 'ply→gltf = blender');
  expect(resolveCadEngineForTask({ sourceExt: '.GLTF', desiredOutputExt: '.STL' }) === 'blender', 'case/dot-insensitive gltf→stl = blender');
  expect(resolveCadEngineForTask({ sourceExt: 'stl', desiredOutputExt: 'png' }) === 'blender', 'stl→png render preview = blender');
  expect(resolveCadEngineForTask({ sourceExt: 'glb', desiredOutputExt: 'png' }) === 'blender', 'glb→png render preview = blender');
  const gltfToStep = resolveCadEngineForTask({ sourceExt: 'gltf', desiredOutputExt: 'step' });
  expect(typeof gltfToStep === 'object' && gltfToStep.reason === 'mesh_to_brep_not_supported', 'gltf→step = mesh_to_brep_not_supported (blender does not rebuild solids)');
  const glbToGlb = resolveCadEngineForTask({ sourceExt: 'glb', desiredOutputExt: 'glb' });
  expect(typeof glbToGlb === 'object' && glbToGlb.unsupported === true, 'glb→glb (same format) stays unsupported — a copy, not a conversion');
  const threeMf = resolveCadEngineForTask({ sourceExt: '3mf', desiredOutputExt: 'stl' });
  expect(typeof threeMf === 'object' && threeMf.reason === 'mesh_source_not_supported', '3mf source stays unsupported (blender import needs an addon)');
  pass('engine resolution: mesh↔mesh conversion + render previews route to blender');
}

// ── describeCadInstallGuidance ──────────────────────────────────────────────
{
  const scadHint = describeCadInstallGuidance('openscad');
  const freecadHint = describeCadInstallGuidance('freecadcmd');
  const blenderHint = describeCadInstallGuidance('blender');
  expect(scadHint.includes('brew install --cask openscad'), 'openscad hint carries the brew command');
  expect(freecadHint.includes('brew install --cask freecad'), 'freecad hint carries the brew command');
  expect(blenderHint.includes('brew install --cask blender'), 'blender hint carries the brew command');
  expect(scadHint.length < 200 && freecadHint.length < 200 && blenderHint.length < 200, 'hints stay one-liners');
  pass('install guidance is plain-language with exact brew commands');
}

// ── Bridge LOCKSTEP surface: fixed blender binaries, argv, extraArgs ────────
{
  const bridgeSource = readFileSync(path.resolve(process.cwd(), 'scripts/claude-bridge.js'), 'utf8');
  expect(bridgeSource.includes("'/Applications/Blender.app/Contents/MacOS/Blender'"), 'bridge carries the fixed Blender.app binary candidate');
  expect(bridgeSource.includes("'/opt/homebrew/bin/blender'"), 'bridge carries the homebrew blender candidate');
  expect(bridgeSource.includes("'/usr/local/bin/blender'"), 'bridge carries the /usr/local blender candidate');
  expect(
    bridgeSource.includes("['--background', '--factory-startup', '--python', sourcePath]"),
    'bridge blender argv is exactly --background --factory-startup --python <script>',
  );
  expect(
    bridgeSource.includes("engine !== 'openscad' && rawExtraArgs.length > 0"),
    'bridge rejects extraArgs for every script-driven engine (blender included)',
  );
  expect(
    bridgeSource.includes("engine !== 'openscad' && engine !== 'freecadcmd' && engine !== 'blender'"),
    'bridge engine enum accepts blender',
  );
  expect(bridgeSource.includes("'brew install --cask blender'"), 'bridge engine_not_installed hint covers blender');
  pass('bridge LOCKSTEP: fixed binary candidates, fixed argv, no extraArgs for blender');
}

// ── buildCadCompileReceipt ──────────────────────────────────────────────────
{
  const receipt = buildCadCompileReceipt({
    ok: true,
    engine: 'openscad',
    binaryPath: '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD',
    exitCode: 0,
    durationMs: 4312,
    stdoutTail: 'Geometries in cache: 12',
    stderrTail: 'x'.repeat(1000),
    output: { path: '/Users/demo/Desktop/part.stl', bytes: 84234, exists: true },
  });
  expect(receipt.engine === 'openscad' && receipt.exitOk && receipt.outputExists, 'success receipt fields');
  expect(receipt.outputBytes === 84234 && receipt.durationMs === 4312, 'numeric fields carried through');
  expect(receipt.stderrExcerpt.length === 300, 'stderr excerpt capped at 300 chars');
  const failed = buildCadCompileReceipt({ engine: 'freecadcmd', exitCode: 1, output: { bytes: -5, exists: false } });
  expect(!failed.exitOk && !failed.outputExists && failed.outputBytes === 0, 'failure receipt: exitOk false, negative bytes clamp to 0');
  const garbage = buildCadCompileReceipt(null);
  expect(garbage.engine === 'unknown' && garbage.outputBytes === 0 && garbage.stderrExcerpt === '', 'null input yields safe defaults, never throws');
  const stringy = buildCadCompileReceipt({ engine: 'x'.repeat(100), durationMs: 1e12, exitCode: '0' });
  expect(stringy.engine.length === 40, 'engine name bounded to 40 chars');
  expect(stringy.durationMs === 86_400_000, 'duration clamped to 24h');
  expect(!stringy.exitOk, 'string exitCode is not treated as success');
  pass('compile receipts are bounded and garbage-tolerant');
}

if (failures > 0) {
  console.error(`\n${failures} cad code executor smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll cad code executor smoke cases passed.');
