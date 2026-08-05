/**
 * engineering-profile-solid-live-drill — the Pappus cross-check.
 *
 * A solid of revolution's volume is 2π·R̄·A (Pappus), computable in closed form
 * from the profile with no engine. This drill builds real revolved and extruded
 * solids in Blender and asserts the mesh inspector measures back the analytical
 * volume — a THIRD independent volume method (after CSG-analytical and
 * prism-analytical) agreeing with the mesh. If the Screw revolve, the extrude,
 * or the profile geometry were wrong, the measured volume would not land on the
 * analytical prediction.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-profile-solid-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import {
  buildExtrudeBlenderScript, buildRevolveBlenderScript, buildPulleyBlenderScript,
  extrudeVolume, revolveVolume, pulleyProfile, type PulleySpec,
} from '../src/lib/engineeringProfileSolidCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';
import type { DraftPoint } from '../src/lib/engineeringDraftingCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

async function runAndInspect(bpy: string, stl: string, py: string): Promise<ReturnType<typeof inspectMesh> | null> {
  writeFileSync(py, bpy);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check the file */ }
  try { statSync(stl); } catch { return null; }
  return inspectMesh(new Uint8Array(readFileSync(stl)));
}

/** measured volume must match the analytical prediction within tolPct. */
function volOk(measured: number, analytical: number, tolPct: number): boolean {
  return Math.abs(measured - analytical) <= (tolPct / 100) * analytical;
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-profile-solid LIVE drill (analytical volume ↔ Blender solid ↔ measured volume)\n');

  // ── Extrude: an L-section prism, volume = area·height ──
  {
    const L: DraftPoint[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 40 }, { x: 0, y: 40 }];
    const analytical = extrudeVolume(L, 12); // area (40·10 + 30·30 = 700? no: L = 40×10 + 10×30 = 400+300=700) · 12
    const bpy = buildExtrudeBlenderScript(L, 12, '/tmp/uc-ps-ext.stl');
    if (!bpy.ok) { step(false, 'extrude: build', bpy.error); } else {
      const r = await runAndInspect(bpy.value, '/tmp/uc-ps-ext.stl', '/tmp/uc-ps-ext.py');
      if (!r) step(false, 'extrude: Blender', 'no STL');
      else if (!r.ok) step(false, 'extrude: inspect', r.error);
      else {
        step(volOk(r.value.volume_mm3, analytical, 0.5), 'extrude L-section: measured vol = area·height',
          `analytical ${analytical} mm³, measured ${r.value.volume_mm3} (${(100 * Math.abs(r.value.volume_mm3 - analytical) / analytical).toFixed(2)}%) | watertight ${r.value.watertight}`);
        step(r.value.watertight, 'extrude: watertight', r.value.watertight ? 'closed solid' : 'NOT watertight');
      }
    }
  }

  // ── Revolve: rectangle-at-radius → a tube, Pappus volume ──
  {
    const rect: DraftPoint[] = [{ x: 15, y: -5 }, { x: 25, y: -5 }, { x: 25, y: 5 }, { x: 15, y: 5 }];
    const analytical = revolveVolume(rect); // 2π·R̄·A = 2π·20·100 = 12566.4; tube π(25²−15²)·10 = same
    const bpy = buildRevolveBlenderScript(rect, '/tmp/uc-ps-rev.stl', { segments: 160 });
    if (!bpy.ok) { step(false, 'revolve: build', bpy.error); } else {
      const r = await runAndInspect(bpy.value, '/tmp/uc-ps-rev.stl', '/tmp/uc-ps-rev.py');
      if (!r) step(false, 'revolve: Blender', 'no STL');
      else if (!r.ok) step(false, 'revolve: inspect', r.error);
      else {
        step(volOk(r.value.volume_mm3, analytical, 0.5), 'revolve tube: measured vol = Pappus 2π·R̄·A',
          `analytical ${analytical.toFixed(1)} mm³, measured ${r.value.volume_mm3} (${(100 * Math.abs(r.value.volume_mm3 - analytical) / analytical).toFixed(2)}%) | ${r.value.triangles} tris`);
        step(r.value.watertight, 'revolve: watertight', r.value.watertight ? 'closed solid of revolution' : 'NOT watertight');
      }
    }
  }

  // ── Pulley: a V-groove pulley, its Pappus volume, and OD = bbox ──
  {
    const spec: PulleySpec = { outerDiameter: 80, boreDiameter: 16, width: 20, grooveDepth: 8, grooveTopWidth: 12, segments: 160 };
    const prof = pulleyProfile(spec);
    const analytical = prof.ok ? revolveVolume(prof.value) : 0;
    const bpy = buildPulleyBlenderScript(spec, '/tmp/uc-ps-pulley.stl');
    if (!bpy.ok) { step(false, 'pulley: build', bpy.error); } else {
      const r = await runAndInspect(bpy.value, '/tmp/uc-ps-pulley.stl', '/tmp/uc-ps-pulley.py');
      if (!r) step(false, 'pulley: Blender', 'no STL');
      else if (!r.ok) step(false, 'pulley: inspect', r.error);
      else {
        step(volOk(r.value.volume_mm3, analytical, 0.8), 'pulley: measured vol = Pappus of its section',
          `analytical ${analytical.toFixed(1)} mm³, measured ${r.value.volume_mm3} (${(100 * Math.abs(r.value.volume_mm3 - analytical) / analytical).toFixed(2)}%)`);
        step(Math.abs(r.value.bbox.dims.w - 80) <= 0.4 && r.value.watertight, 'pulley: OD = 80, watertight',
          `bbox ${r.value.bbox.dims.w}×${r.value.bbox.dims.d}×${r.value.bbox.dims.h}, watertight ${r.value.watertight}`);
      }
    }
  }

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
