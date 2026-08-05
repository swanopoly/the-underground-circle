/**
 * engineering-helix-live-drill — the developed-length volume cross-check.
 *
 * A compression spring's wire volume is π·(d/2)²·L, where L is the DEVELOPED
 * (unrolled) helix length n·√((πD)²+p²). This drill builds real springs in
 * Blender (a beveled, capped helix curve) and asserts the mesh inspector
 * measures back that volume — the helical analogue of the Pappus cross-check.
 *
 * A note on tolerance: the beveled wire cross-section is a polygon INSCRIBED in
 * the ideal circle, so the meshed volume is slightly UNDER π·(d/2)²·L and
 * converges up as the bevel resolution rises (demonstrated during the build:
 * 8 segments → 1.8%, 12 → 1.0%). So the drill allows ~1.5% and reports the
 * residual — the convergence toward the formula is itself the evidence it is
 * the correct limit.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-helix-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { buildSpringBlenderScript, springGeometry, type SpringSpec } from '../src/lib/engineeringHelixCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

async function proveSpring(spec: SpringSpec, stl: string, py: string) {
  const geo = springGeometry(spec);
  if (!geo.ok) { step(false, 'geometry', geo.error); return; }
  const g = geo.value;
  const label = `d${g.wireDiameter} D${g.meanDiameter} ×${g.totalCoils}`;

  const bpy = buildSpringBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, 'no STL'); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;

  const volPct = 100 * Math.abs(m.volume_mm3 - g.wireVolume) / g.wireVolume;
  step(volPct <= 1.5, `${label}: wire volume = π(d/2)²·developed-length`,
    `analytical ${g.wireVolume} mm³, measured ${m.volume_mm3} (${volPct.toFixed(2)}%, faceting-limited) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed capped helix' : `NOT watertight (${m.openEdges} open edges)`);
  // OD = mean + wire; free length ≈ helix span + wire (the wire caps stick out).
  const odOk = Math.abs(m.bbox.dims.w - g.outerDiameter) <= 0.02 * g.outerDiameter;
  step(odOk, `${label}: OD = D + d`, `expected ${g.outerDiameter} mm, measured ${m.bbox.dims.w} mm`);
  const htOk = Math.abs(m.bbox.dims.h - (g.freeLength + g.wireDiameter)) <= 0.05 * (g.freeLength + g.wireDiameter);
  step(htOk, `${label}: free length ≈ helix span + wire`, `expected ${g.freeLength + g.wireDiameter} mm, measured ${m.bbox.dims.h} mm`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-helix LIVE drill (spring → Blender → measured volume = developed-length wire volume)\n');

  await proveSpring({ wireDiameter: 2, meanDiameter: 20, freeLength: 40, totalCoils: 8, stepsPerCoil: 64 }, '/tmp/uc-drill-spring-a.stl', '/tmp/uc-drill-spring-a.py');
  await proveSpring({ wireDiameter: 3, outerDiameter: 30, freeLength: 60, totalCoils: 6, stepsPerCoil: 64 }, '/tmp/uc-drill-spring-b.stl', '/tmp/uc-drill-spring-b.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
