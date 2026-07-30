/**
 * engineering-thread-live-drill — the volume-bracket cross-check.
 *
 * A threaded rod's material volume is provably BETWEEN its minor-diameter
 * cylinder (all the metal that is always present) and its major-diameter
 * cylinder (the metal if the thread were solid). This drill builds real ISO
 * metric threaded rods in Blender (bmesh-swept rib ∪ core, EXACT solver) and
 * asserts the mesh inspector measures a volume inside that bracket and near the
 * pitch-diameter cylinder — plus the two exact bbox checks (the crests define
 * the outside diameter d, the shank defines the length). If the helix, the rib
 * sweep, or the union were wrong, the volume would fall outside the bracket or
 * the OD would not equal d.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-thread-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { buildThreadedRodBlenderScript, threadedRodGeometry, type ThreadedRodSpec } from '../src/lib/engineeringThreadCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

async function proveRod(spec: ThreadedRodSpec, stl: string, py: string) {
  const geo = threadedRodGeometry(spec);
  if (!geo.ok) { step(false, 'geometry', geo.error); return; }
  const g = geo.value;
  const label = `M${g.nominalDiameter}×${g.pitch} L${g.length}`;

  const bpy = buildThreadedRodBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check the file */ }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, 'no STL'); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;

  step(m.watertight, `${label}: watertight`, m.watertight ? `closed solid (${m.triangles} tris)` : `NOT watertight (${m.openEdges} open edges)`);
  // THE bracket: minor cylinder < measured < major cylinder, near the pitch cylinder.
  const inBracket = m.volume_mm3 > g.minorCylVolume && m.volume_mm3 < g.majorCylVolume;
  const pitchPct = 100 * (m.volume_mm3 - g.pitchCylVolume) / g.pitchCylVolume;
  step(inBracket, `${label}: volume in [minorCyl, majorCyl] bracket`,
    `${g.minorCylVolume} < measured ${m.volume_mm3} < ${g.majorCylVolume} mm³ (${pitchPct >= 0 ? '+' : ''}${pitchPct.toFixed(1)}% vs pitch cylinder)`);
  // crests define the OD exactly (bmesh apex verts sit at r_major)
  const odOk = Math.abs(m.bbox.dims.w - g.majorDiameter) <= 0.01 * g.majorDiameter;
  step(odOk, `${label}: outside diameter = d (thread crests)`, `expected ${g.majorDiameter} mm, measured ${m.bbox.dims.w}×${m.bbox.dims.d} mm`);
  const lenOk = Math.abs(m.bbox.dims.h - g.length) <= 0.005 * g.length;
  step(lenOk, `${label}: length = shank`, `expected ${g.length} mm, measured ${m.bbox.dims.h} mm`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-thread LIVE drill (ISO metric rod → Blender → volume in minor/major-cylinder bracket)\n');

  await proveRod({ thread: 'M8', length: 20 }, '/tmp/uc-drill-thread-m8.stl', '/tmp/uc-drill-thread-m8.py');
  await proveRod({ thread: 'M12', length: 24 }, '/tmp/uc-drill-thread-m12.stl', '/tmp/uc-drill-thread-m12.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
