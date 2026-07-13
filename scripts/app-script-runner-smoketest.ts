/**
 * app-script-runner-smoketest — the generalized headless-script substrate
 * (src/lib/appScriptRunner.ts, plan P2). The load-bearing assertions are the
 * SECURITY validation core (engine-agnostic): path traversal / shell-metachar /
 * control-char / BMP rejection, source+output extension allowlists, strict
 * extraArg deny, timeout clamp, and that buildArgs never emits an unsafe token.
 * Also pins each seed engine's argv shape so an invocation change is caught.
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
  // ─── (1) registry sanity ──────────────────────────────────────────────────
  assertEq(APP_SCRIPT_ENGINES.length, 3, '(1) three seed engines');
  for (const e of APP_SCRIPT_ENGINES) {
    const d = APP_SCRIPT_ENGINE_REGISTRY[e];
    assertEq(d.id, e, `(1) ${e} descriptor id matches`);
    assert(d.sourceExtensions.length > 0, `(1) ${e} has source extensions`);
    assert(d.defaultTimeoutMs <= d.maxTimeoutMs, `(1) ${e} default ≤ max timeout`);
    // Every seed engine ships unverified — must NOT be wired live until confirmed.
    assertEq(d.verifiedInvocation, false, `(1) ${e} invocation is unverified (fail-closed for live wiring)`);
  }
  assert(isAppScriptEngine('matlab') && !isAppScriptEngine('nope'), '(1) engine guard');

  // ─── (2) happy paths per engine + argv shape pins ─────────────────────────
  const mat = validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/Users/x/work/analyze.m', outputPath: '/Users/x/work/out.mat' });
  assert(mat.ok, '(2) matlab valid');
  if (mat.ok) {
    assertEq(mat.plan.args[0], '-batch', '(2) matlab uses -batch');
    assert(mat.plan.args[1] === "run('/Users/x/work/analyze.m')", '(2) matlab runs the source file', mat.plan.args[1]);
  }
  const kc = validateAppScriptRunRequest({ engine: 'kicad_cli', sourcePath: '/p/board.kicad_pcb', outputPath: '/p/board.pdf' });
  assert(kc.ok, '(2) kicad valid');
  if (kc.ok) assert(kc.plan.args.includes('export') && kc.plan.args.includes('/p/board.pdf'), '(2) kicad export → output');
  const acad = validateAppScriptRunRequest({ engine: 'autocad_core', sourcePath: 'C:/w/cmd.scr', inputPath: 'C:/w/drawing.dwg' });
  assert(acad.ok, '(2) autocad valid');
  if (acad.ok) assertEq(JSON.stringify(acad.plan.args), JSON.stringify(['/i', 'C:/w/drawing.dwg', '/s', 'C:/w/cmd.scr']), '(2) autocad /i input /s script');
  // autocad without input drawing → just /s
  const acad2 = validateAppScriptRunRequest({ engine: 'autocad_core', sourcePath: 'C:/w/cmd.scr' });
  assert(acad2.ok && JSON.stringify(acad2.plan.args) === JSON.stringify(['/s', 'C:/w/cmd.scr']), '(2) autocad /s only when no input');

  // ─── (3) engine gate ──────────────────────────────────────────────────────
  assertEq((validateAppScriptRunRequest({ engine: 'gimp', sourcePath: '/p/x.py' }) as any).ok, false, '(3) unknown engine rejected');
  assertEq((validateAppScriptRunRequest({ sourcePath: '/p/x.m' }) as any).ok, false, '(3) missing engine rejected');

  // ─── (4) PATH SAFETY — the core ───────────────────────────────────────────
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
  // control char + non-BMP
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/a\u0007.m' }) as any).ok, false, '(4) reject control char');
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/\u{1F600}.m' }) as any).ok, false, '(4) reject non-BMP');
  // over-length
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/' + 'a'.repeat(1100) + '.m' }) as any).ok, false, '(4) reject >1024 path');
  // metachar in inputPath + outputPath too
  assertEq((validateAppScriptRunRequest({ engine: 'autocad_core', sourcePath: 'C:/w/x.scr', inputPath: 'C:/w/$(evil).dwg' }) as any).ok, false, '(4) inputPath metachar rejected');
  assertEq((validateAppScriptRunRequest({ engine: 'kicad_cli', sourcePath: '/p/b.kicad_pcb', outputPath: '/p/a`b`.pdf' }) as any).ok, false, '(4) outputPath metachar rejected');

  // ─── (5) extension allowlists ─────────────────────────────────────────────
  assertEq((validateAppScriptRunRequest({ engine: 'matlab', sourcePath: '/p/x.py' }) as any).ok, false, '(5) matlab rejects non-.m source');
  assertEq((validateAppScriptRunRequest({ engine: 'kicad_cli', sourcePath: '/p/b.kicad_pcb', outputPath: '/p/b.exe' }) as any).ok, false, '(5) kicad rejects disallowed output ext');
  // engines with empty outputExtensions accept any (script-chosen) output
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

  // ─── (8) buildAppScriptRunSpec + verified gate + describe ─────────────────
  const spec = buildAppScriptRunSpec({ engine: 'matlab', sourcePath: '/p/x.m', outputPath: '/p/o.mat' });
  assert(!!spec && spec.engine === 'matlab', '(8) spec built');
  assertEq(spec!.verifiedInvocation, false, '(8) spec carries the unverified gate (blocks live wiring)');
  assertEq(buildAppScriptRunSpec({ engine: 'matlab', sourcePath: '/p/x.py' }), null, '(8) invalid → null spec');
  assert(describeAppScriptRun({ engine: 'kicad_cli', sourcePath: '/p/b.kicad_pcb', outputPath: '/p/b.pdf' }).includes('KiCad'), '(8) describe names the engine');
  assert(describeAppScriptRun({}).length > 0, '(8) describe safe on empty');

  // ─── (9) degenerate never throws ──────────────────────────────────────────
  try {
    validateAppScriptRunRequest(undefined as any);
    validateAppScriptRunRequest({});
    validateAppScriptRunRequest({ engine: 'matlab' });
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
