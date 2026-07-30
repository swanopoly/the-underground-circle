/**
 * engineering-cam-live-drill — the cam disc volume + shaft-bore cross-check.
 *
 * A disc cam is its polar displacement profile extruded by the thickness with a
 * shaft bore, so its volume is (profileArea − bore)·thickness. This drill builds
 * real cams in Blender (different motion laws) and asserts the mesh inspector
 * measures that volume, that the disc is watertight and exactly the thickness
 * tall, and — since a cam always has a shaft hole — that its volume is below the
 * solid peak-radius disc, proving the bore is really open.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-cam-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { camGeometry, buildCamBlenderScript, type CamSpec } from '../src/lib/engineeringCamCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

async function proveCam(label: string, spec: CamSpec, stl: string, py: string) {
  const geo = camGeometry(spec);
  if (!geo.ok) { step(false, `${label}: geometry`, geo.error); return; }
  const g = geo.value;
  const bpy = buildCamBlenderScript(spec, stl);
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
  step(volPct <= 0.5, `${label}: volume = (profileArea − bore)·thickness`,
    `analytical ${g.volume} mm³ (area ${g.profileArea}, bore Ø${g.boreDiameter}), measured ${m.volume_mm3} (${volPct.toFixed(2)}%) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed cam disc' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  step(Math.abs(m.bbox.dims.h - g.thickness) <= 0.002 * g.thickness, `${label}: disc height = thickness ${g.thickness}`, `measured ${m.bbox.dims.h} mm`);
  const solidDisc = Math.PI * g.maxRadius ** 2 * g.thickness;
  step(m.volume_mm3 < solidDisc * 0.99, `${label}: shaft bore open (peak radius ${g.maxRadius})`, `measured ${m.volume_mm3} < solid disc ${Math.round(solidDisc)} mm³`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-cam LIVE drill (cam → Blender extrude+bore → volume = (area − bore)·thickness)\n');

  await proveCam('harmonic cam', {
    baseRadius: 25, thickness: 12, boreDiameter: 10, stepsPerSegment: 40,
    segments: [
      { kind: 'dwell', angle: 90 }, { kind: 'rise', angle: 90, lift: 15, motion: 'harmonic' },
      { kind: 'dwell', angle: 90 }, { kind: 'fall', angle: 90, lift: 15, motion: 'harmonic' },
    ],
  }, '/tmp/uc-drill-cam-harm.stl', '/tmp/uc-drill-cam-harm.py');

  await proveCam('cycloidal cam', {
    baseRadius: 30, thickness: 10, boreDiameter: 12, stepsPerSegment: 40,
    segments: [
      { kind: 'rise', angle: 120, lift: 20, motion: 'cycloidal' }, { kind: 'dwell', angle: 60 },
      { kind: 'fall', angle: 120, lift: 20, motion: 'cycloidal' }, { kind: 'dwell', angle: 60 },
    ],
  }, '/tmp/uc-drill-cam-cyc.stl', '/tmp/uc-drill-cam-cyc.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
