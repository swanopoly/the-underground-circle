/**
 * app-script-runner-smoketest — the generalized headless-script substrate
 * (src/lib/appScriptRunner.ts, plan P2). The load-bearing assertions are the
 * SECURITY validation core (engine-agnostic): path traversal / shell-metachar /
 * control-char / BMP rejection, source+output extension allowlists, strict
 * extraArg deny, timeout clamp, and that buildArgs never emits an unsafe token.
 *
 * P76 adds the THREE invocation modes — script_file (matlab/maya/autocad),
 * inline_program (gimp `-b <program>`), render_job (kicad/aerender flags over an
 * existing file) — so this also pins per-mode required inputs, programText
 * bounds + single-line guarantee, and jobParam sanitization/allowlisting.
 *
 * Pure — loads under tsx (appScriptRunner has zero imports).
 */

import {
  APP_SCRIPT_ENGINES,
  APP_SCRIPT_ENGINE_REGISTRY,
  isAppScriptEngine,
  validateAppScriptRunRequest,
  buildAppScriptRunSpec,
  describeAppScriptRun,
} from '../src/lib/appScriptRunner';

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
  const MODES = ['script_file', 'inline_program', 'render_job'];

  // ─── (1) registry sanity ──────────────────────────────────────────────────
  assertEq(APP_SCRIPT_ENGINES.length, 6, '(1) six engines');
  for (const e of APP_SCRIPT_ENGINES) {
    const d = APP_SCRIPT_ENGINE_REGISTRY[e];
    assertEq(d.id, e, `(1) ${e} descriptor id matches`);
    assert(MODES.includes(d.mode), `(1) ${e} has a valid mode`, d.mode);
    // Only inline_program has no source file; every other mode needs source exts.
    if (d.mode === 'inline_program') assertEq(d.sourceExtensions.length, 0, `(1) ${e} inline_program has no source ext`);
    else assert(d.sourceExtensions.length > 0, `(1) ${e} has source extensions`);
    assert(d.defaultTimeoutMs <= d.maxTimeoutMs, `(1) ${e} default ≤ max timeout`);
    // Every engine ships unverified — must NOT be wired live until confirmed.
    assertEq(d.verifiedInvocation, false, `(1) ${e} invocation is unverified (fail-closed for live wiring)`);
  }
  assert(isAppScriptEngine('matlab') && isAppScriptEngine('gimp') && !isAppScriptEngine('nope'), '(1) engine guard');
  // mode coverage: at least one engine per mode.
  for (const m of MODES) {
    assert(APP_SCRIPT_ENGINES.some((e) => APP_SCRIPT_ENGINE_REGISTRY[e].mode === m), `(1) an engine exists for mode ${m}`);
  }

  // ─── (2) script_file happy paths + argv shape pins ────────────────────────
  const mat = validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/Users/x/work/analyze.m', outputPath: '/Users/x/work/out.mat' });
  assert(mat.ok, '(2) matlab valid');
  if (mat.ok) {
    assertEq(mat.plan.mode, 'script_file', '(2) matlab is script_file');
    assertEq(mat.plan.args[0], '-batch', '(2) matlab uses -batch');
    assert(mat.plan.args[1] === "run('/Users/x/work/analyze.m')", '(2) matlab runs the source file', mat.plan.args[1]);
  }
  // Maya (NEW, script_file): mayapy <script.py>
  const maya = validateAppScriptRunRequest({ engine: 'maya_python', sourcePath: '/p/build_scene.py', outputPath: '/p/out.mb' });
  assert(maya.ok, '(2) maya valid');
  if (maya.ok) {
    assertEq(maya.plan.mode, 'script_file', '(2) maya is script_file');
    assertEq(JSON.stringify(maya.plan.args), JSON.stringify(['/p/build_scene.py']), '(2) maya argv is just the script');
  }
  assertEq((validateAppScriptRunRequest({ engine: 'maya_python', sourcePath: '/p/x.scr' }) as any).ok, false, '(2) maya rejects non-.py source');
  // AutoCAD (script_file): /i input /s script
  const acad = validateAppScriptRunRequest({ engine: 'autocad_core', sourcePath: 'C:/w/cmd.scr', inputPath: 'C:/w/drawing.dwg' });
  assert(acad.ok, '(2) autocad valid');
  if (acad.ok) assertEq(JSON.stringify(acad.plan.args), JSON.stringify(['/i', 'C:/w/drawing.dwg', '/s', 'C:/w/cmd.scr']), '(2) autocad /i input /s script');
  const acad2 = validateAppScriptRunRequest({ engine: 'autocad_core', sourcePath: 'C:/w/cmd.scr' });
  assert(acad2.ok && JSON.stringify(acad2.plan.args) === JSON.stringify(['/s', 'C:/w/cmd.scr']), '(2) autocad /s only when no input');

  // ─── (2b) render_job happy paths (kicad + aerender) ───────────────────────
  const kc = validateAppScriptRunRequest({ engine: 'kicad_cli', sourcePath: '/p/board.kicad_pcb', outputPath: '/p/board.pdf' });
  assert(kc.ok, '(2b) kicad valid');
  if (kc.ok) {
    assertEq(kc.plan.mode, 'render_job', '(2b) kicad is render_job');
    assert(kc.plan.args.includes('export') && kc.plan.args.includes('/p/board.pdf'), '(2b) kicad export → output');
  }
  const ae = validateAppScriptRunRequest({
    engine: 'aerender',
    sourcePath: '/p/promo.aep',
    outputPath: '/p/out.mov',
    jobParams: { comp: 'Main Comp', startFrame: 0, endFrame: 120 },
  });
  assert(ae.ok, '(2b) aerender valid');
  if (ae.ok) {
    assertEq(ae.plan.mode, 'render_job', '(2b) aerender is render_job');
    assertEq(
      JSON.stringify(ae.plan.args),
      JSON.stringify(['-project', '/p/promo.aep', '-comp', 'Main Comp', '-output', '/p/out.mov', '-s', '0', '-e', '120']),
      '(2b) aerender argv shape',
    );
    assertEq(ae.plan.jobParams.comp, 'Main Comp', '(2b) comp jobParam kept (space allowed)');
  }
  // frames omitted → no -s/-e
  const aeNoFrames = validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/promo.aep', outputPath: '/p/out.mov', jobParams: { comp: 'Main' } });
  assert(aeNoFrames.ok && !aeNoFrames.plan.args.includes('-s') && !aeNoFrames.plan.args.includes('-e'), '(2b) aerender omits -s/-e when no frames');
  // aerender source must be .aep
  assertEq((validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/promo.txt', outputPath: '/p/out.mov', jobParams: { comp: 'Main' } }) as any).ok, false, '(2b) aerender rejects non-.aep project');

  // ─── (2c) render_job jobParam sanitization + required keys (fail-closed) ───
  assertEq((validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/promo.aep', outputPath: '/p/out.mov', jobParams: { startFrame: 0 } }) as any).ok, false, '(2c) aerender requires comp jobParam');
  // comp with a control char → sanitized away → required comp missing → error
  assertEq((validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/promo.aep', outputPath: '/p/out.mov', jobParams: { comp: 'a\u0007b' } }) as any).ok, false, '(2c) control-char comp dropped → comp missing');
  // comp with a shell metachar → sanitized away → error (defense-in-depth)
  assertEq((validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/promo.aep', outputPath: '/p/out.mov', jobParams: { comp: '$(rm -rf ~)' } }) as any).ok, false, '(2c) metachar comp dropped → comp missing');
  // unsafe jobParam KEY dropped with a note; comp still honored
  const badKey = validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/promo.aep', outputPath: '/p/out.mov', jobParams: { comp: 'Main', 'bad key!': 'x' } as any });
  assert(badKey.ok, '(2c) unsafe job-param key does not fail the request');
  if (badKey.ok) {
    assert(badKey.plan.notes.some((n) => /unsafe key/i.test(n)), '(2c) dropped-key note emitted');
    assert(!('bad key!' in badKey.plan.jobParams), '(2c) unsafe key not carried');
  }
  // out-of-range frame dropped (null) → not in argv
  const bigFrame = validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/promo.aep', outputPath: '/p/out.mov', jobParams: { comp: 'Main', startFrame: 99_999_999_999 } });
  assert(bigFrame.ok && !bigFrame.plan.args.includes('-s'), '(2c) out-of-range frame dropped from argv');

  // ─── (2d) inline_program (gimp) ───────────────────────────────────────────
  const prog = "img = pdb.gimp_file_load('/tmp/a.png', 'a.png'); pdb.gimp_image_flatten(img); pdb.file_png_save(img, img.active_drawable, '/tmp/o.png', 'o', 0, 9, 1, 1, 1, 1, 1)";
  const g = validateAppScriptRunRequest({ engine: 'gimp', programText: prog });
  assert(g.ok, '(2d) gimp valid with programText');
  if (g.ok) {
    assertEq(g.plan.mode, 'inline_program', '(2d) gimp is inline_program');
    assertEq(g.plan.sourcePath, '', '(2d) gimp has no source file');
    assert(g.plan.args.includes('--batch-interpreter=python-fu-eval'), '(2d) gimp batch interpreter flag');
    assert(g.plan.args.includes(prog), '(2d) program survives verbatim as one argv token');
    assert(g.plan.args[g.plan.args.length - 1] === 'pdb.gimp_quit(1)', '(2d) trailing quit token');
    // metachars ( ; ' . / ) are legit python and INERT in execFile argv — allowed
    assert(prog.includes(';') && g.plan.args.includes(prog), '(2d) `;` and quotes allowed in program (argv is shell-free)');
  }
  assertEq((validateAppScriptRunRequest({ engine: 'gimp' }) as any).ok, false, '(2d) gimp requires programText');
  assertEq((validateAppScriptRunRequest({ engine: 'gimp', programText: '   ' }) as any).ok, false, '(2d) gimp rejects blank programText');
  // single-line guarantee: a newline in the program is rejected by the token check
  assertEq((validateAppScriptRunRequest({ engine: 'gimp', programText: 'a\nb' }) as any).ok, false, '(2d) gimp rejects newline in program (single-line guarantee)');
  assertEq((validateAppScriptRunRequest({ engine: 'gimp', programText: 'a\u0007b' }) as any).ok, false, '(2d) gimp rejects control char in program');
  assertEq((validateAppScriptRunRequest({ engine: 'gimp', programText: 'x'.repeat(100_001) }) as any).ok, false, '(2d) gimp rejects oversized program');

  // ─── (2e) P77 hardening: option-injection + matlab in-string quote-injection ─
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '-rf.m' }) as any).ok, false, '(2e) leading-dash sourcePath rejected (CLI option-injection)');
  assertEq((validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/p.aep', outputPath: '/p/o.mov', jobParams: { comp: '-output' } }) as any).ok, false, '(2e) leading-dash comp jobParam dropped → comp missing');
  const mq = validateAppScriptRunRequest({ engine: 'matlab', sourcePath: "/p/x'),system('id.m" });
  assert(mq.ok, "(2e) matlab path with ' is valid (not a shell metachar)");
  if (mq.ok) assert(mq.plan.args[1] === "run('/p/x''),system(''id.m')", '(2e) matlab doubles single-quotes so the path cannot inject MATLAB code', mq.plan.args[1]);

  // ─── (3) engine gate ──────────────────────────────────────────────────────
  assertEq((validateAppScriptRunRequest({ engine: 'photoshop', sourcePath: '/p/x.py' }) as any).ok, false, '(3) unknown engine rejected');
  assertEq((validateAppScriptRunRequest({ sourcePath: '/p/x.m' }) as any).ok, false, '(3) missing engine rejected');

  // ─── (4) PATH SAFETY — the core (script_file engine) ──────────────────────
  const bad = [
    ['/p/../../etc/passwd.m', 'traversal ..'],
    ['/p/a;rm -rf ~.m', 'shell metachar ;'],
    ['/p/`whoami`.m', 'backtick'],
    ['/p/$(id).m', 'command sub $'],
    ['/p/a|b.m', 'pipe'],
    ['/p/a>b.m', 'redirect'],
    ['/p/a\nb.m', 'newline'],
  ];
  for (const [p, why] of bad) {
    assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: p }) as any).ok, false, `(4) reject sourcePath: ${why}`);
  }
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/a\u0007.m' }) as any).ok, false, '(4) reject control char');
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/\u{1F600}.m' }) as any).ok, false, '(4) reject non-BMP');
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/' + 'a'.repeat(1100) + '.m' }) as any).ok, false, '(4) reject >1024 path');
  assertEq((validateAppScriptRunRequest({ engine: 'autocad_core', sourcePath: 'C:/w/x.scr', inputPath: 'C:/w/$(evil).dwg' }) as any).ok, false, '(4) inputPath metachar rejected');
  assertEq((validateAppScriptRunRequest({ engine: 'kicad_cli', sourcePath: '/p/b.kicad_pcb', outputPath: '/p/a`b`.pdf' }) as any).ok, false, '(4) outputPath metachar rejected');

  // ─── (5) extension allowlists ─────────────────────────────────────────────
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/x.py' }) as any).ok, false, '(5) matlab rejects non-.m source');
  assertEq((validateAppScriptRunRequest({ engine: 'kicad_cli', sourcePath: '/p/b.kicad_pcb', outputPath: '/p/b.exe' }) as any).ok, false, '(5) kicad rejects disallowed output ext');
  assert(validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/x.m', outputPath: '/p/whatever.bin' }).ok, '(5) matlab allows script-chosen output ext');

  // ─── (6) extraArgs deny-all (fail-closed) + notes ─────────────────────────
  const withExtras = validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/x.m', extraArgs: ['-nodisplay', '--evil'] });
  assert(withExtras.ok, '(6) request still ok with (dropped) extras');
  if (withExtras.ok) {
    assert(!withExtras.plan.args.includes('-nodisplay') && !withExtras.plan.args.includes('--evil'), '(6) disallowed extras dropped from argv');
    assertEq(withExtras.plan.notes.length, 2, '(6) two dropped-arg notes');
  }

  // ─── (7) timeout clamp ────────────────────────────────────────────────────
  const t1 = validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/x.m', timeoutMs: 99_999_999 });
  assert(t1.ok && t1.plan.timeoutMs === APP_SCRIPT_ENGINE_REGISTRY.matlab.maxTimeoutMs, '(7) timeout clamps to engine max');
  const t2 = validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/x.m', timeoutMs: 1 });
  assert(t2.ok && t2.plan.timeoutMs === 5_000, '(7) timeout floors to 5s');
  const t3 = validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/x.m' });
  assert(t3.ok && t3.plan.timeoutMs === APP_SCRIPT_ENGINE_REGISTRY.matlab.defaultTimeoutMs, '(7) default timeout applied');

  // ─── (8) buildAppScriptRunSpec + verified gate + mode + describe ──────────
  const spec = buildAppScriptRunSpec({ engine: 'matlab', sourcePath: '/p/x.m', outputPath: '/p/o.mat' });
  assert(!!spec && spec.engine === 'matlab', '(8) spec built');
  assertEq(spec!.mode, 'script_file', '(8) spec carries the mode');
  assertEq(spec!.verifiedInvocation, false, '(8) spec carries the unverified gate (blocks live wiring)');
  const gspec = buildAppScriptRunSpec({ engine: 'gimp', programText: prog });
  assertEq(gspec!.mode, 'inline_program', '(8) gimp spec mode');
  const aespec = buildAppScriptRunSpec({ engine: 'aerender', sourcePath: '/p/p.aep', outputPath: '/p/o.mov', jobParams: { comp: 'C' } });
  assertEq(aespec!.mode, 'render_job', '(8) aerender spec mode');
  assertEq(buildAppScriptRunSpec({ engine: 'matlab', sourcePath: '/p/x.py' }), null, '(8) invalid → null spec');
  assert(describeAppScriptRun({ engine: 'kicad_cli', sourcePath: '/p/b.kicad_pcb', outputPath: '/p/b.pdf' }).includes('KiCad'), '(8) describe names the engine');
  assert(describeAppScriptRun({ engine: 'gimp', programText: prog }).includes('GIMP'), '(8) describe names gimp');
  assert(describeAppScriptRun({}).length > 0, '(8) describe safe on empty');

  // ─── (9) degenerate never throws ──────────────────────────────────────────
  try {
    validateAppScriptRunRequest(undefined as any);
    validateAppScriptRunRequest({});
    validateAppScriptRunRequest({ engine: 'matlab' });
    validateAppScriptRunRequest({ engine: 'gimp' });
    validateAppScriptRunRequest({ engine: 'aerender' });
    validateAppScriptRunRequest({ engine: 'aerender', sourcePath: '/p/p.aep', jobParams: null as any });
    buildAppScriptRunSpec(null as any);
    describeAppScriptRun(null);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (9) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll app-script-runner smoke cases passed (${passes} passed).`);
}

main();
