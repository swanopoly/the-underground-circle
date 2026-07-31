/**
 * engineering-workflow-integration — proof that the engineering suite COMPOSES.
 *
 * The twenty capability waves are only useful if their outputs flow into each
 * other, so this designs ONE real part end to end and asserts the numbers match
 * ACROSS the cores — analysis feeding geometry, geometry feeding analysis, and
 * the material table feeding both:
 *
 *   a cantilever bracket carries 800 N at a 120 mm arm, in steel, safety ≥ 2.5.
 *
 *   1. materials      steel yield/density/E                    (engineeringCalcCore)
 *   2. sizing         σ_allow = yield/SF → required section    (calc)
 *   3. section        a plate thickness that meets it          (calc sectionRectangle)
 *   4. stress check   the beam stress at that thickness < σ_allow (calc beam)
 *   5. geometry       model the plate + bore + bolt holes      (engineeringSolidModelingCore)
 *   6. mass           volume × material density                (composed)
 *   7. fit            the bore↔shaft clearance                 (engineeringToleranceCore)
 *
 * The cross-core assertions are the point: the section modulus the GEOMETRY
 * provides is the one the STRESS calc consumes; the thickness the LOAD demands is
 * the one the MODEL is built with; the shaft the FIT sizes is the model's bore.
 * Pure — chains the tsx-loadable cores, no Blender (the live drill does that).
 */

import { materialProps, sectionRectangle, beam, safetyFactor } from '../src/lib/engineeringCalcCore';
import { validateSolidModel, nominalBoundingBox, type SolidModel } from '../src/lib/engineeringSolidModelingCore';
import { isoFit } from '../src/lib/engineeringToleranceCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function calcOK(r: ReturnType<typeof beam>, label: string) { if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); } return r; }

function main() {
  // ── design intent ──
  const P = 800, arm = 120, SF = 2.5, plateWidth = 50, plateLength = 140;
  const boreDia = 25, boltDia = 11;

  // 1. MATERIAL — the single source of steel's properties.
  const mat = calcOK(materialProps('steel'), 'material');
  const yieldMPa = mat.extra!.yield_MPa, density = mat.extra!.density_kg_per_mm3, E = mat.extra!.E_MPa;
  near(yieldMPa, 250, 'steel yield = 250 MPa');

  // 2. SIZING — allowable stress and the section the load demands.
  const sigmaAllow = yieldMPa / SF;
  near(sigmaAllow, 100, 'σ_allow = yield / SF = 100 MPa');
  const M = P * arm; // N·mm
  const S_req = M / sigmaAllow; // mm³
  near(S_req, 960, 'required section modulus S = M/σ_allow = 960 mm³');
  const h_req = Math.sqrt((6 * S_req) / plateWidth); // rectangular S = b·h²/6
  near(h_req, Math.sqrt(115.2), 'required thickness = √(6S/b) = 10.73 mm');
  const thickness = Math.ceil(h_req / 2) * 2; // round up to the next even mm
  assert(thickness === 12, 'chosen plate thickness = 12 mm (next standard ≥ 10.73)');
  assert(thickness >= h_req, 'the chosen thickness satisfies the load requirement');

  // 3. SECTION — the geometry's actual section modulus at that thickness.
  const sec = calcOK(sectionRectangle(plateWidth, thickness), 'section');
  near(sec.extra!.S_mm3, 1200, 'actual S of a 50×12 section = 1200 mm³');
  const I = sec.extra!.I_mm4, S = sec.extra!.S_mm3;

  // 4. STRESS CHECK — the beam calc CONSUMES the section the geometry provides.
  const b = calcOK(beam({ support: 'cantilever', load: 'point_end', magnitude: P, length: arm, E, I, S }), 'beam');
  near(b.extra!.max_moment_Nmm, 96000, 'cantilever moment = P·L = 96000 N·mm (matches the sizing)');
  near(b.extra!.max_bending_stress_MPa, 80, 'actual stress at 12 mm = M/S = 80 MPa');
  assert(b.extra!.max_bending_stress_MPa < sigmaAllow, 'CROSS-CHECK: actual stress < allowable → the sized part is safe');
  const sfActual = calcOK(safetyFactor(yieldMPa, b.extra!.max_bending_stress_MPa), 'SF');
  near(sfActual.value, 3.125, 'realised safety factor = 250/80 = 3.125 ≥ 2.5');

  // 5. GEOMETRY — build the plate with the SIZED thickness, a bore, and 4 bolt holes.
  const t = thickness;
  const model: SolidModel = {
    positives: [{ kind: 'box', w: plateWidth, d: plateLength, h: t, cx: 0, cy: 0, cz: t / 2 }],
    negatives: [
      { kind: 'cylinder', r: boreDia / 2, h: t + 2, cx: 0, cy: 45, cz: t / 2, axis: 'z' }, // shaft bore, loaded end
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: -18, cy: -55, cz: t / 2, axis: 'z' },
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: 18, cy: -55, cz: t / 2, axis: 'z' },
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: -18, cy: -35, cz: t / 2, axis: 'z' },
      { kind: 'cylinder', r: boltDia / 2, h: t + 2, cx: 18, cy: -35, cz: t / 2, axis: 'z' },
    ],
  };
  assert(validateSolidModel(model).ok, 'the designed solid model is valid');
  const bb = nominalBoundingBox(model)!;
  near(bb.maxX - bb.minX, plateWidth, 'model width = plate width (50) — geometry uses the design');
  near(bb.maxZ - bb.minZ, thickness, 'model thickness = the SIZED thickness (12) — analysis fed geometry');

  // 6. MASS — analytical volume × the material's density (composition).
  const volume = plateWidth * plateLength * t - Math.PI * (boreDia / 2) ** 2 * t - 4 * Math.PI * (boltDia / 2) ** 2 * t;
  near(volume, 84000 - Math.PI * 156.25 * 12 - 4 * Math.PI * 30.25 * 12, 'volume = plate − bore − 4 bolt holes');
  const mass = volume * density;
  near(mass, volume * 7.85e-6, 'mass = volume × steel density');
  assert(mass > 0.5 && mass < 0.65, `bracket mass ≈ ${Math.round(mass * 1000)} g`);

  // 7. FIT — the bore↔shaft clearance; the fit's nominal IS the model's bore.
  const fit = isoFit(boreDia, 'H7', 'g6');
  if (!fit.ok) { failures.push(`fit: ${fit.error}`); console.error(`FAIL: fit — ${fit.error}`); process.exit(1); }
  assert(fit.value.nominal === boreDia, 'CROSS-CHECK: the fit sizes the SAME Ø25 the model bored');
  assert(fit.value.fitType === 'clearance', 'H7/g6 bore↔shaft is a running clearance fit');
  assert(fit.value.minClearance_um > 0, `guaranteed clearance ${fit.value.minClearance_um}–${fit.value.maxClearance_um} µm (shaft always fits)`);

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-workflow-integration failure(s)`); process.exit(1); }
  console.log('All engineering-workflow-integration cases passed — the suite composes end to end.');
}

main();
