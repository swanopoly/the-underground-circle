/**
 * engineering-rack-live-drill — the rack volume cross-check.
 *
 * A gear rack is its toothed profile extruded by the face width, so its volume is
 * profileArea·faceWidth — and that profile area was proven in the smoke to equal
 * base-rectangle + N tooth-trapezoids two independent ways. This drill builds real
 * racks in Blender and asserts the mesh inspector measures that volume and the
 * length × height × faceWidth envelope, watertight. Confirms the toothed
 * involute-rack profile turns into a solid whose measured volume lands on the
 * independently-computed area.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-rack-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { rackGeometry, buildRackBlenderScript, type RackSpec } from '../src/lib/engineeringRackCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

function bboxMatches(measured: number[], expected: number[], tol: number): boolean {
  const a = [...measured].sort((x, y) => x - y), b = [...expected].sort((x, y) => x - y);
  return a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, b[i]));
}

async function proveRack(label: string, spec: RackSpec, stl: string, py: string) {
  const geo = rackGeometry(spec);
  if (!geo.ok) { step(false, `${label}: geometry`, geo.error); return; }
  const g = geo.value;
  const bpy = buildRackBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, 'no STL'); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;

  const volPct = 100 * Math.abs(m.volume_mm3 - g.volume) / g.volume;
  step(volPct <= 0.2, `${label}: volume = profileArea·faceWidth`,
    `analytical ${g.volume} mm³ (area ${g.crossSectionArea} = trapezoid ${g.trapezoidArea}), measured ${m.volume_mm3} (${volPct.toFixed(3)}%) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed rack' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  const dims = [m.bbox.dims.w, m.bbox.dims.d, m.bbox.dims.h];
  step(bboxMatches(dims, [g.length, g.height, g.faceWidth], 0.01), `${label}: envelope = length ${g.length} × height ${g.height} × face ${g.faceWidth}`,
    `measured {${dims.map((d) => Math.round(d * 100) / 100).join(', ')}}`);
  step(g.rootWidth > g.tipWidth, `${label}: teeth wider at root (${g.rootWidth}) than tip (${g.tipWidth})`, 'involute-rack trapezoid');
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-rack LIVE drill (gear rack → Blender extrude → volume = profileArea·faceWidth)\n');

  await proveRack('m2 × 6-tooth rack', { module: 2, teeth: 6, pressureAngleDeg: 20, faceWidth: 15, backThickness: 4 }, '/tmp/uc-drill-rack-m2.stl', '/tmp/uc-drill-rack-m2.py');
  await proveRack('m3 × 4-tooth rack', { module: 3, teeth: 4, pressureAngleDeg: 20, faceWidth: 20 }, '/tmp/uc-drill-rack-m3.stl', '/tmp/uc-drill-rack-m3.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
