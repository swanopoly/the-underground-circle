/**
 * engineering-solid-modeling-live-drill — LIVE proof that the bpy this repo
 * GENERATES actually builds a dimensionally-correct solid in REAL Blender and
 * exports a valid STL.
 *
 * The smoke proves the script is structurally sane; only a real Blender run
 * proves the operator names, boolean solver, and STL exporter behave — exactly
 * the class of bug the Illustrator/Blender live probes kept catching (a
 * DXF-import addon that was registered but absent; STL operators that moved
 * between Blender 3.x/4.x). This is the 3D analogue of the DXF cross-check.
 *
 *   generate  →  writeBlenderSolidScript(plate-with-holes, out.stl)
 *   run       →  REAL Blender --background --python <script>  (the exact
 *                cad_compile blender argv)
 *   verify    →  scripts/stl-verify.py reads the binary STL independently:
 *                triangles > 0 AND its bbox ≈ our nominal dimensions
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-solid-modeling-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import {
  writeBlenderSolidScript,
  summarizeSolidModel,
  readBinaryStlTriangleCount,
  buildPlateWithHoles,
  buildTube,
  type SolidModel,
} from '../src/lib/engineeringSolidModelingCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) {
  steps.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
}

async function runBlender(scriptPath: string): Promise<{ code: number | null; tail: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      BLENDER,
      ['--background', '--factory-startup', '--python', scriptPath],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return { code: 0, tail: `${stdout}\n${stderr}`.slice(-400) };
  } catch (e: any) {
    return { code: e?.code ?? null, tail: `${e?.stdout || ''}\n${e?.stderr || ''}`.slice(-400) };
  }
}

async function pyVerify(stlPath: string): Promise<any> {
  const { stdout } = await execFileAsync('python3', ['scripts/stl-verify.py', stlPath], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/** A generated solid is CORRECT if Blender produced triangles and the STL's
 *  measured dimensions match what the model nominally intended (± tolerance). */
function dimensionsAgree(nominal: { w: number; d: number; h: number }, measured: { w: number; d: number; h: number }): boolean {
  const tol = 0.6; // mm — Blender's cylinder faceting shrinks a bore's chord slightly; outer box dims are exact.
  return Math.abs(nominal.w - measured.w) <= tol
    && Math.abs(nominal.d - measured.d) <= tol
    && Math.abs(nominal.h - measured.h) <= tol;
}

async function proveModel(label: string, model: SolidModel, stlPath: string, scriptPath: string) {
  const sum = summarizeSolidModel(model);
  const bpy = writeBlenderSolidScript(model, stlPath);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(scriptPath, bpy.value);
  step(true, `${label}: generated bpy`, `${bpy.value.length} bytes, nominal ${sum.dimensions!.w}×${sum.dimensions!.d}×${sum.dimensions!.h}mm, ${sum.positiveCount} positive(s) − ${sum.negativeCount} negative(s)`);

  const run = await runBlender(scriptPath);
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stlPath); } catch { /* not created */ }
  step(!!stat && stat.isFile(), `${label}: Blender ran`,
    stat ? `exit ${run.code}, wrote ${stat.size}-byte STL` : `exit ${run.code}, NO STL — tail: ${run.tail}`);
  if (!stat) return;

  const tris = readBinaryStlTriangleCount(new Uint8Array(readFileSync(stlPath)));
  const foreign = await pyVerify(stlPath);
  const ok = foreign.ok && foreign.triangles > 0 && dimensionsAgree(sum.dimensions!, foreign.dimensions);
  step(ok, `${label}: independent STL verify`,
    ok
      ? `Python read ${foreign.triangles} triangles (our header said ${tris}); measured ${foreign.dimensions.w}×${foreign.dimensions.d}×${foreign.dimensions.h}mm ≈ nominal — the solid is dimensionally correct`
      : `mismatch — foreign=${JSON.stringify(foreign.dimensions)} vs nominal=${JSON.stringify(sum.dimensions)} (tris=${foreign.triangles})`);
}

async function main() {
  if (!statSyncSafe(BLENDER)) { console.log(`Blender not found at ${BLENDER} — skipping (this drill needs a real Blender).`); process.exit(0); }
  console.log('engineering-solid-modeling LIVE drill (bpy generator → real Blender → independent STL verify)\n');

  // A 120×80×10 mounting plate with four M8-clearance holes.
  const plate = buildPlateWithHoles({
    width: 120, depth: 80, thickness: 10,
    holes: [{ x: 50, y: 30, diameter: 9 }, { x: -50, y: 30, diameter: 9 }, { x: 50, y: -30, diameter: 9 }, { x: -50, y: -30, diameter: 9 }],
  });
  if (plate.ok) await proveModel('plate', plate.value, '/tmp/uc-plate.stl', '/tmp/uc-plate.py');

  // A tube / spacer: OD 30, ID 18, 25 tall.
  const tube = buildTube({ outerDiameter: 30, innerDiameter: 18, height: 25 });
  if (tube.ok) await proveModel('tube', tube.value, '/tmp/uc-tube.stl', '/tmp/uc-tube.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

function statSyncSafe(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
