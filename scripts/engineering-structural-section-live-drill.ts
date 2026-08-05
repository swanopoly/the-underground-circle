/**
 * engineering-structural-section-live-drill — the beam volume cross-check.
 *
 * A beam is its section extruded along its length, so its volume is exactly
 * A·length where A is the section area computed by the parallel-axis primitive.
 * This drill builds real I-beams, channels, and angles in Blender and asserts the
 * mesh inspector measures A·length and the predicted envelope — the same section
 * area that the smoke proved equals the outline polygon's shoelace area, now
 * confirmed a third way by the meshed solid. If the section decomposition or the
 * outline were wrong, the measured volume would not match.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-structural-section-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { buildBeamBlenderScript, beamGeometry } from '../src/lib/engineeringStructuralSectionCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

function bboxMatches(measured: number[], expected: number[], tol: number): boolean {
  const a = [...measured].sort((x, y) => x - y), b = [...expected].sort((x, y) => x - y);
  return a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, b[i]));
}

async function proveBeam(spec: any, stl: string, py: string) {
  const geo = beamGeometry(spec);
  if (!geo.ok) { step(false, 'geometry', geo.error); return; }
  const g = geo.value;

  const bpy = buildBeamBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${g.label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${g.label}: Blender`, 'no STL'); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${g.label}: inspect`, insp.error); return; }
  const m = insp.value;

  const volPct = 100 * Math.abs(m.volume_mm3 - g.volume) / g.volume;
  step(volPct <= 0.5, `${g.label}: volume = A·length`,
    `analytical ${g.volume} mm³ (A ${g.area} × L ${g.length}), measured ${m.volume_mm3} (${volPct.toFixed(3)}%) | ${m.triangles} tris`);
  step(m.watertight, `${g.label}: watertight`, m.watertight ? 'closed solid' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  const secW = g.extentRight - g.extentLeft, secH = g.extentTop - g.extentBottom;
  const dims = [m.bbox.dims.w, m.bbox.dims.d, m.bbox.dims.h];
  step(bboxMatches(dims, [secW, secH, g.length], 0.01), `${g.label}: bbox = section ${Math.round(secW)}×${Math.round(secH)} × length ${g.length}`,
    `measured {${dims.map((d) => Math.round(d * 100) / 100).join(', ')}}`);
  // report the property an engineer feeds to engineering.calc beam
  step(g.Ix > 0 && g.Sx > 0, `${g.label}: Ix ${g.Ix} mm⁴, Sx ${g.Sx} mm³ → engineering.calc beam`, 'section properties available for deflection/stress');
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-structural-section LIVE drill (beam → Blender → volume = A·length)\n');

  await proveBeam({ section: 'i_beam', height: 200, width: 100, webThickness: 6, flangeThickness: 10, length: 1000 }, '/tmp/uc-drill-beam-i.stl', '/tmp/uc-drill-beam-i.py');
  await proveBeam({ section: 'channel', height: 100, width: 50, webThickness: 6, flangeThickness: 8, length: 800 }, '/tmp/uc-drill-beam-c.stl', '/tmp/uc-drill-beam-c.py');
  await proveBeam({ section: 'angle', legX: 60, legY: 40, thickness: 6, length: 600 }, '/tmp/uc-drill-beam-l.stl', '/tmp/uc-drill-beam-l.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
