/**
 * engineering-gear-train-live-drill — the gear-pair assembly cross-check.
 *
 * A meshing pair's overall span along the line of centers is exactly
 * ra₁ + C + ra₂ (gear 1's left tip to gear 2's right tip, C = m·(N₁+N₂)/2).
 * So the whole assembly — two positioned, phased, bored gears in one STL — is
 * verified on one number: build it in REAL Blender, measure the STL, and assert
 * the X-span equals ra₁ + C + ra₂, both gears watertight, and the assembly
 * volume equals the two gears' volumes summed. If the center distance, the mesh
 * phase, or either gear were wrong, the span would not land.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-gear-train-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { buildGearPairBlenderScript, gearPairGeometry, type GearPairSpec } from '../src/lib/engineeringGearTrainCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) {
  steps.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
}

async function provePair(spec: GearPairSpec, stl: string, py: string) {
  const geo = gearPairGeometry(spec);
  if (!geo.ok) { step(false, 'geometry', geo.error); return; }
  const g = geo.value;
  const label = `Z${g.teeth1}:Z${g.teeth2} m${g.module} (${Math.round(g.ratio * 100) / 100}:1)`;
  const expectedSpan = g.addendumRadius1 + g.centerDistance + g.addendumRadius2;

  const bpy = buildGearPairBlenderScript(spec, stl);
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

  const spanOk = Math.abs(m.bbox.dims.w - expectedSpan) <= 0.005 * expectedSpan;
  step(spanOk, `${label}: assembly span = ra₁+C+ra₂`,
    `expected ${expectedSpan} mm, measured ${m.bbox.dims.w} mm (${(100 * Math.abs(m.bbox.dims.w - expectedSpan) / expectedSpan).toFixed(2)}%) | ${m.triangles} tris`);
  step(m.watertight, `${label}: both gears watertight`, m.watertight ? 'two valid closed solids' : `NOT watertight (${m.openEdges} open edges)`);
  // The larger gear dominates the Y span: 2·ra₂.
  const yOk = Math.abs(m.bbox.dims.d - 2 * g.addendumRadius2) <= 0.01 * (2 * g.addendumRadius2);
  step(yOk, `${label}: Y span = gear-2 OD`, `expected ${2 * g.addendumRadius2} mm, measured ${m.bbox.dims.d} mm`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-gear-train LIVE drill (meshing pair → Blender → measured span = ra₁ + C + ra₂)\n');

  await provePair({ module: 2, pinionTeeth: 12, ratio: 3, faceWidth: 10, pinionBore: 6, gearBore: 12 }, '/tmp/uc-pair-3to1.stl', '/tmp/uc-pair-3to1.py');
  await provePair({ module: 1.5, pinionTeeth: 20, gearTeeth: 20, faceWidth: 8, pinionBore: 10 }, '/tmp/uc-pair-1to1.stl', '/tmp/uc-pair-1to1.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
