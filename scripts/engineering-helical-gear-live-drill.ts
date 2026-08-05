/**
 * engineering-helical-gear-live-drill — the Cavalieri cross-check.
 *
 * A helical gear is a spur profile twisted along the axis, and Cavalieri's
 * principle says twisting a fixed-area cross-section does not change the volume.
 * So this builds real helical gears at DIFFERENT helix angles in Blender and
 * asserts the mesh inspector measures the SAME volume — the spur gear's
 * (profileArea − bore)·faceWidth — regardless of twist, all watertight, all with
 * the same outside-diameter envelope. Two gears of visibly different twist
 * measuring one identical volume is Cavalieri made concrete.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-helical-gear-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { helicalGearGeometry, buildHelicalGearBlenderScript, type HelicalGearSpec } from '../src/lib/engineeringHelicalGearCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

const measured: number[] = [];

async function proveHelical(spec: HelicalGearSpec, stl: string, py: string) {
  const geo = helicalGearGeometry(spec);
  if (!geo.ok) { step(false, 'geometry', geo.error); return; }
  const g = geo.value;
  const label = `Z${g.gear.teeth} m${g.gear.module} β${g.helixAngleDeg}°`;
  const bpy = buildHelicalGearBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, 'no STL'); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;
  measured.push(m.volume_mm3);

  const volPct = 100 * Math.abs(m.volume_mm3 - g.volume) / g.volume;
  step(volPct <= 0.1, `${label}: volume = (area−bore)·W (Cavalieri, twist-independent)`,
    `spur volume ${g.volume} mm³, measured ${m.volume_mm3} (${volPct.toFixed(3)}%, twist ${g.twistAngleDeg}°) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed helical gear' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  const odOk = Math.abs(m.bbox.dims.w - g.gear.outsideDiameter) <= 0.01 * g.gear.outsideDiameter && Math.abs(m.bbox.dims.h - g.faceWidth) <= 0.01 * g.faceWidth;
  step(odOk, `${label}: envelope = OD ${g.gear.outsideDiameter} × face ${g.faceWidth}`, `measured ${m.bbox.dims.w}×${m.bbox.dims.d}×${m.bbox.dims.h}`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-helical-gear LIVE drill (twist-extrude → Blender → volume = spur volume by Cavalieri)\n');

  await proveHelical({ teeth: 20, module: 2, faceWidth: 20, boreDiameter: 12, helixAngleDeg: 15 }, '/tmp/uc-drill-helical-15.stl', '/tmp/uc-drill-helical-15.py');
  await proveHelical({ teeth: 20, module: 2, faceWidth: 20, boreDiameter: 12, helixAngleDeg: 30 }, '/tmp/uc-drill-helical-30.stl', '/tmp/uc-drill-helical-30.py');
  await proveHelical({ teeth: 30, module: 1.5, faceWidth: 25, boreDiameter: 15, helixAngleDeg: 25 }, '/tmp/uc-drill-helical-z30.stl', '/tmp/uc-drill-helical-z30.py');

  // the two same-size gears at 15° and 30° must measure the SAME volume (Cavalieri).
  if (measured.length >= 2) {
    const diffPct = 100 * Math.abs(measured[0] - measured[1]) / measured[0];
    step(diffPct <= 0.1, 'Cavalieri LIVE: 15° and 30° gears measure the same volume', `${measured[0]} vs ${measured[1]} (${diffPct.toFixed(3)}% apart despite different twist)`);
  }

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
