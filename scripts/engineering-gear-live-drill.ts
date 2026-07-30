/**
 * engineering-gear-live-drill — the gear mutual cross-check.
 *
 * A spur gear's outside diameter is exactly m·(N+2), independent of everything
 * else. So the whole involute-profile → 3D-extrude → mesh pipeline is verified
 * on one number: generate the gear bpy, build it in REAL Blender, measure the
 * STL with the mesh inspector, and assert the measured bounding box equals
 * m·(N+2) and the face width, and that the result is a watertight solid.
 * If the involute math, the bmesh extrude, or the bore boolean were wrong, the
 * measured OD would not land on m·(N+2).
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-gear-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { buildSpurGearBlenderScript, gearGeometry, type GearSpec } from '../src/lib/engineeringGearCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) {
  steps.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
}

async function proveGear(spec: GearSpec, stl: string, py: string) {
  const geo = gearGeometry(spec.teeth, spec.module, spec.pressureAngleDeg ?? 20);
  if (!geo.ok) { step(false, 'geometry', geo.error); return; }
  const g = geo.value;
  const label = `Z${g.teeth} m${g.module}`;
  const width = spec.faceWidth ?? g.module * 4;

  const bpy = buildSpurGearBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);

  let code: number | null = 0;
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); }
  catch (e: any) { code = e?.code ?? null; }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, `exit ${code}, no STL`); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;
  const measuredOD = Math.max(m.bbox.dims.w, m.bbox.dims.d);

  // OD tolerance ~0.5% — the tip arcs are faceted, so the measured OD is a hair
  // under the ideal m·(N+2).
  const odOk = Math.abs(measuredOD - g.outsideDiameter) <= 0.005 * g.outsideDiameter;
  step(odOk, `${label}: measured OD = m·(N+2)`,
    `expected ${g.outsideDiameter} mm, measured ${measuredOD} mm (${(100 * Math.abs(measuredOD - g.outsideDiameter) / g.outsideDiameter).toFixed(2)}%) | ${m.triangles} tris`);
  step(Math.abs(m.bbox.dims.h - width) <= 0.01, `${label}: face width`, `expected ${width} mm, measured ${m.bbox.dims.h} mm`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed solid (printable/machinable)' : `NOT watertight (${m.openEdges} open edges)`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-gear LIVE drill (involute profile → Blender extrude → measured OD = m·(N+2))\n');

  // A small undercut gear, a standard one, and a fine-module larger gear.
  await proveGear({ teeth: 12, module: 3, faceWidth: 10, boreDiameter: 8 }, '/tmp/uc-g12.stl', '/tmp/uc-g12.py');
  await proveGear({ teeth: 24, module: 2, faceWidth: 10, boreDiameter: 12 }, '/tmp/uc-g24.stl', '/tmp/uc-g24.py');
  await proveGear({ teeth: 40, module: 1.5, faceWidth: 8, boreDiameter: 20 }, '/tmp/uc-g40.stl', '/tmp/uc-g40.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
