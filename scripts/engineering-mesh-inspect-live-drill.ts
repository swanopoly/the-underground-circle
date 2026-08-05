/**
 * engineering-mesh-inspect-live-drill — the mutual-verification showcase.
 *
 * The generation cores and the inspection core are independent code paths that
 * must agree on one thing: VOLUME. So this drill computes a part's volume THREE
 * ways and asserts they match:
 *
 *   1. ANALYTICAL — closed-form from the spec (a plate is w·d·t minus, for each
 *      through-hole, π·(d/2)²·t).
 *   2. GENERATED  — build the exact same part with engineeringSolidModelingCore,
 *      run it through REAL Blender, export a binary STL.
 *   3. MEASURED   — read that STL back with engineeringMeshInspectCore and
 *      integrate its volume via the divergence theorem.
 *
 * If (1) ≈ (2's STL) ≈ (3) the generator built the right solid AND the inspector
 * measures volume correctly — each proves the other. Then mass = volume ·
 * material density composes the calc core's materials table.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-mesh-inspect-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { writeBlenderSolidScript, buildPlateWithHoles, buildFlange } from '../src/lib/engineeringSolidModelingCore';
import { inspectMesh, massFromVolume } from '../src/lib/engineeringMeshInspectCore';
import { MATERIALS } from '../src/lib/engineeringCalcCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) {
  steps.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
}

async function runBlender(scriptPath: string): Promise<number | null> {
  try {
    await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', scriptPath], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return 0;
  } catch (e: any) { return e?.code ?? null; }
}

/** Relative agreement within `tolPct` percent. */
function agree(a: number, b: number, tolPct: number): boolean {
  return Math.abs(a - b) <= (tolPct / 100) * Math.max(Math.abs(a), Math.abs(b));
}

async function proveVolume(label: string, model: any, analyticalVolume: number, stl: string, py: string) {
  const bpy = writeBlenderSolidScript(model, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  const code = await runBlender(py);
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, `exit ${code}, no STL`); return; }
  step(true, `${label}: built in Blender`, `${stat.size}-byte STL`);

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;

  // The three-way agreement. Tolerance ~2% because a bore's cylinder faceting
  // slightly under-measures the removed volume (fewer facets = less removed =
  // a hair MORE solid), which is a real, bounded discretization effect.
  const measuredVsAnalytical = agree(m.volume_mm3, analyticalVolume, 2);
  step(measuredVsAnalytical, `${label}: volume cross-check`,
    `analytical=${analyticalVolume.toFixed(1)} mm³ vs measured=${m.volume_mm3} mm³ (${(100 * Math.abs(m.volume_mm3 - analyticalVolume) / analyticalVolume).toFixed(2)}% diff) | ${m.triangles} triangles`);

  step(m.watertight, `${label}: watertight`,
    m.watertight ? `closed 2-manifold (${m.openEdges} open edges)` : `NOT watertight — ${m.openEdges} open, ${m.nonManifoldEdges} non-manifold edges`);

  // Compose the materials table: weigh the measured volume in steel + aluminum.
  const steel = massFromVolume(m.volume_mm3, MATERIALS.steel.density);
  const alu = massFromVolume(m.volume_mm3, MATERIALS.aluminum.density);
  if (steel.ok && alu.ok) {
    step(steel.value.mass_kg > 0, `${label}: mass`,
      `${m.volume_mm3} mm³ → ${steel.value.mass_kg} kg in steel, ${alu.value.mass_kg} kg in aluminum`);
  }
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-mesh-inspect LIVE drill (analytical volume ↔ generated STL ↔ measured volume)\n');

  // Plate 120×80×10 with four Ø9 through-holes.
  // Analytical: 120·80·10 − 4·π·4.5²·10 = 96000 − 4·636.17 = 96000 − 2544.7 = 93455.3 mm³
  const holeR = 4.5, t = 10;
  const plateVol = 120 * 80 * t - 4 * Math.PI * holeR * holeR * t;
  const plate = buildPlateWithHoles({ width: 120, depth: 80, thickness: t, holes: [{ x: 40, y: 25, diameter: 9 }, { x: -40, y: 25, diameter: 9 }, { x: 40, y: -25, diameter: 9 }, { x: -40, y: -25, diameter: 9 }] });
  if (plate.ok) await proveVolume('plate', plate.value, plateVol, '/tmp/uc-mi-plate.stl', '/tmp/uc-mi-plate.py');

  // Flange OD100 t12, Ø40 bore, 6×Ø9 on Ø75 PCD.
  // Analytical: π·50²·12 − π·20²·12 − 6·π·4.5²·12
  //           = 12·π·(2500 − 400 − 6·20.25) = 12π·1978.5 = 74587.7 mm³
  const flangeVol = Math.PI * 12 * (50 * 50 - 20 * 20 - 6 * 4.5 * 4.5);
  const flange = buildFlange({ outerDiameter: 100, thickness: 12, centerBore: 40, boltCircle: { count: 6, pcd: 75, holeDiameter: 9 } });
  if (flange.ok) await proveVolume('flange', flange.value, flangeVol, '/tmp/uc-mi-flange.stl', '/tmp/uc-mi-flange.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
