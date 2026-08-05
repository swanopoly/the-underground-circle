/**
 * engineering-pipe-live-drill — the partial-revolve Pappus cross-check.
 *
 * A pipe elbow's wall volume is θ·Rb·π(ro²−ri²) (Pappus for a partial revolve).
 * This drill builds real elbows in Blender (a bmesh annulus swept along the bend,
 * annular end caps, no boolean) and asserts the mesh inspector measures that
 * volume, that the part is watertight, and that its volume sits BELOW the solid
 * (no-bore) elbow — proving the bore is really open. A fourth independent volume
 * method (partial Pappus) joining the extrude, full-revolve Pappus, and CSG
 * anchors already in the suite.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-pipe-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { elbowGeometry, buildElbowBlenderScript, type ElbowSpec } from '../src/lib/engineeringPipeCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

async function proveElbow(label: string, spec: ElbowSpec, stl: string, py: string) {
  const geo = elbowGeometry(spec);
  if (!geo.ok) { step(false, `${label}: geometry`, geo.error); return; }
  const g = geo.value;
  const bpy = buildElbowBlenderScript(spec, stl);
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
  step(volPct <= 0.5, `${label}: wall volume = θ·Rb·π(ro²−ri²) (Pappus)`,
    `analytical ${g.volume} mm³, measured ${m.volume_mm3} (${volPct.toFixed(2)}%, faceting) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed hollow elbow' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  // the hollow elbow must weigh less than the solid (no-bore) elbow of the same sweep.
  const solid = (g.angleDeg * Math.PI / 180) * g.bendRadius * Math.PI * g.outerRadius ** 2;
  step(m.volume_mm3 < solid * 0.99, `${label}: bore is really open`, `measured ${m.volume_mm3} < solid ${Math.round(solid)} mm³ (bore holds ${g.boreVolume} mm³)`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-pipe LIVE drill (elbow → Blender annulus-sweep → wall volume = partial-revolve Pappus)\n');

  await proveElbow('90° elbow DN50', { bendRadius: 60, outerDiameter: 50, innerDiameter: 40, angle: 90 }, '/tmp/uc-drill-elbow-90.stl', '/tmp/uc-drill-elbow-90.py');
  await proveElbow('45° elbow', { bendRadius: 100, outerDiameter: 40, wallThickness: 4, angle: 45 }, '/tmp/uc-drill-elbow-45.stl', '/tmp/uc-drill-elbow-45.py');
  await proveElbow('180° U-bend', { bendRadius: 50, outerDiameter: 30, innerDiameter: 24, angle: 180 }, '/tmp/uc-drill-elbow-180.stl', '/tmp/uc-drill-elbow-180.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
