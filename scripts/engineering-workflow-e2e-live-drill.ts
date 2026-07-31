/**
 * engineering-workflow-e2e-live-drill — the whole pipeline on one real part.
 *
 * Takes the bracket the integration test DESIGNED (cantilever, 800 N at 120 mm,
 * steel, SF ≥ 2.5 → a 50×140×12 plate with a Ø25 bore and four Ø11 bolt holes)
 * and drives it all the way through: analysis SIZES it, the CSG lane MODELS it,
 * real Blender BUILDS it, and the mesh inspector MEASURES it back — asserting the
 * manufactured part's volume, mass, and bounding box match what analysis and
 * geometry predicted. size → model → build → measure, closed.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-workflow-e2e-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { materialProps, sectionRectangle, beam, safetyFactor } from '../src/lib/engineeringCalcCore';
import { writeBlenderSolidScript, type SolidModel } from '../src/lib/engineeringSolidModelingCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';
import { isoFit } from '../src/lib/engineeringToleranceCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-workflow E2E drill (design → model → Blender → measure, one bracket)\n');

  // ── design ──
  const P = 800, arm = 120, SF = 2.5, W = 50, L = 140, boreDia = 25, boltDia = 11;
  const mat = materialProps('steel');
  if (!mat.ok) { step(false, 'material', mat.error); process.exit(1); }
  const yieldMPa = mat.ok ? mat.extra!.yield_MPa : 250, density = mat.ok ? mat.extra!.density_kg_per_mm3 : 7.85e-6, E = mat.ok ? mat.extra!.E_MPa : 200000;
  const sigmaAllow = yieldMPa / SF;
  const M = P * arm;
  const h_req = Math.sqrt((6 * (M / sigmaAllow)) / W);
  const t = Math.ceil(h_req / 2) * 2; // 12 mm
  const sec = sectionRectangle(W, t);
  const I = sec.ok ? sec.extra!.I_mm4 : 0, S = sec.ok ? sec.extra!.S_mm3 : 0;
  const bm = beam({ support: 'cantilever', load: 'point_end', magnitude: P, length: arm, E, I, S });
  const stress = bm.ok ? bm.extra!.max_bending_stress_MPa : 0;
  const sf = safetyFactor(yieldMPa, stress);
  const fit = isoFit(boreDia, 'H7', 'g6');
  step(t === 12 && stress < sigmaAllow, 'design: sized 12 mm plate, stress 80 < 100 MPa allowable',
    `SF ${sf.ok ? sf.value : '?'}, bore fit ${fit.ok ? `${fit.value.minClearance_um}–${fit.value.maxClearance_um} µm clearance` : '?'}`);

  // ── model ──
  const analyticalVol = W * L * t - Math.PI * (boreDia / 2) ** 2 * t - 4 * Math.PI * (boltDia / 2) ** 2 * t;
  const analyticalMass = analyticalVol * density;
  const model: SolidModel = {
    positives: [{ kind: 'box', w: W, d: L, h: t, cx: 0, cy: 0, cz: t / 2 }],
    negatives: [
      { kind: 'cylinder', r: boreDia / 2, h: t + 2, cx: 0, cy: 45, cz: t / 2, axis: 'z' },
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: -18, cy: -55, cz: t / 2, axis: 'z' },
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: 18, cy: -55, cz: t / 2, axis: 'z' },
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: -18, cy: -35, cz: t / 2, axis: 'z' },
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: 18, cy: -35, cz: t / 2, axis: 'z' },
    ],
  };
  const built = writeBlenderSolidScript(model, '/tmp/uc-workflow-bracket.stl');
  if (!built.ok) { step(false, 'model', built.error); process.exit(1); }

  // ── build + measure ──
  writeFileSync('/tmp/uc-workflow-bracket.py', built.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', '/tmp/uc-workflow-bracket.py'], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  try { statSync('/tmp/uc-workflow-bracket.stl'); } catch { step(false, 'build', 'no STL'); process.exit(1); }
  const insp = inspectMesh(new Uint8Array(readFileSync('/tmp/uc-workflow-bracket.stl')));
  if (!insp.ok) { step(false, 'measure', insp.error); process.exit(1); }
  const m = insp.value;

  const volPct = 100 * Math.abs(m.volume_mm3 - analyticalVol) / analyticalVol;
  step(volPct <= 0.5, 'MEASURE: manufactured volume = designed volume',
    `analytical ${Math.round(analyticalVol)} mm³, measured ${Math.round(m.volume_mm3)} (${volPct.toFixed(2)}%) | ${m.triangles} tris`);
  step(m.watertight, 'the manufactured part is a valid closed solid', m.watertight ? 'watertight' : `NOT watertight (${m.openEdges} open)`);
  const dims = [m.bbox.dims.w, m.bbox.dims.d, m.bbox.dims.h].sort((a, b) => a - b);
  const exp = [W, L, t].sort((a, b) => a - b);
  step(dims.every((d, i) => Math.abs(d - exp[i]) <= 0.02 * exp[i]), 'bounding box = the designed 50 × 140 × 12 plate', `measured {${dims.map((d) => Math.round(d)).join(', ')}}`);
  const measuredMass = insp.ok && m.mass_kg !== undefined ? m.mass_kg : m.volume_mm3 * density;
  step(Math.abs(measuredMass - analyticalMass) <= 0.02 * analyticalMass, 'measured mass = designed mass', `designed ${Math.round(analyticalMass * 1000)} g, measured ${Math.round(measuredMass * 1000)} g`);

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — E2E ${passed === steps.length ? 'PASSED (size → model → build → measure, closed)' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
