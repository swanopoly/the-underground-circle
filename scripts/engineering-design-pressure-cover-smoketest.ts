/**
 * engineering-design-pressure-cover smoke.
 *
 * The one-call pressure-cover designer packages the PROVEN pressure-cover
 * composition chain (engineering-pressure-cover-integration): one pressure p
 * splits three ways — hoop in the wall, bending in the flat cover, and the end
 * load p·π·a² in the flange bolts. So this smoke ROUND-TRIPS every lane of the
 * returned design back through the core it was sized with (thickCylinder,
 * platePressure, separationLoad), closes the statics seam (bolt load = plate
 * load = p·π·a² computed ONCE), pins the thin-vs-Lamé relationship in both the
 * thin and thick regimes, and checks monotonicity + guard rails.
 */

import { designPressureCover, ceilToStockPlate, STOCK_PLATE_MM } from '../src/lib/engineeringDesignPressureCoverCore';
import { thickCylinder } from '../src/lib/engineeringThickCylinderCore';
import { platePressure } from '../src/lib/engineeringPlateBendingCore';
import { separationLoad, STRESS_AREA_COEFF } from '../src/lib/engineeringBoltedJointCore';
import { coarsePitchFor } from '../src/lib/engineeringThreadCore';
import { MATERIALS } from '../src/lib/engineeringCalcCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function need<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  const yieldSteel = MATERIALS.steel.yield; // 250 MPa — one yield serves all three lanes

  // ─── The worked case: 2 MPa on a Ø400 bore, steel, SF 3 (all defaults) ──────
  const d = need(designPressureCover({ pressure_MPa: 2, boreDiameter_mm: 400 }), 'worked design');
  const p = 2, a = 200, SF = 3, allow = yieldSteel / SF;

  assert(d.type === 'pressure_cover', 'type = pressure_cover');

  // THE SEAM: one statics number — bolt load = plate load = p·π·a², computed ONCE here.
  const F = p * Math.PI * a * a; // 251327.41 N
  near(d.lanes.bolts.endLoad_N, F, 'SEAM: designer end load = p·π·a² (251.3 kN, computed once)');
  near(d.lanes.bolts.perBoltLoad_N * d.lanes.bolts.count, F, 'SEAM: n × per-bolt load closes back to p·π·a² (statics closure)');
  near(d.lanes.cover.thickness_mm > 0 ? a : 0, d.dimensions.boreDiameter / 2, 'SEAM: plate span a = bore/2 — same radius in all three lanes');

  // ── WALL lane round-trip: the returned t back through the EXACT Lamé core ──
  assert(d.dimensions.wallThickness === 5, 'wall sized to 5 mm stock (thin-wall t_req = p·a/allow = 4.8)');
  assert(d.dimensions.wallThickness >= d.lanes.wall.thinWallRequired_mm, 'wall stock ≥ the thin-wall requirement (rounded UP)');
  const wallRT = need(thickCylinder({ innerRadius: a, outerRadius: a + d.dimensions.wallThickness, internalPressure: p }), 'wall round-trip');
  near(wallRT.hoopStressBore, d.lanes.wall.lameHoop_MPa, 'ROUND-TRIP: wall t back through thickCylinder reproduces the designer Lamé hoop');
  assert(wallRT.hoopStressBore <= allow, `wall Lamé bore hoop ${wallRT.hoopStressBore} MPa ≤ yield/SF = ${allow.toFixed(2)} MPa`);
  near(d.lanes.wall.thinWallHoop_MPa, (p * a) / 5, 'thin-wall hoop at the chosen t = p·a/t = 80 MPa');
  near(wallRT.thinWallHoopApprox, d.lanes.wall.thinWallHoop_MPa, 'SEAM: thickCylinder thin-wall reference === the designer thin-wall hoop (p·r/t)');

  // thin-vs-Lamé in the THIN regime: exact result a few % ABOVE the thin estimate.
  const gap = d.lanes.wall.lameHoop_MPa / d.lanes.wall.thinWallHoop_MPa - 1;
  assert(gap > 0 && gap < 0.03, `thin regime: Lamé is ${(gap * 100).toFixed(2)}% above p·r/t at r/t = 40 (exact > thin, small gap)`);
  assert(d.lanes.wall.lameGrewWall === false, 'thin regime: Lamé did NOT need to grow the thin-wall stock answer');

  // ── COVER lane round-trip: the returned t back through platePressure ────────
  assert(d.dimensions.coverThickness === 40, 'cover sized to 40 mm stock (t_req = a·√(kq/allow) = 34.47)');
  assert(d.dimensions.coverThickness >= d.lanes.cover.required_mm, 'cover stock ≥ the plate requirement (rounded UP)');
  const coverRT = need(platePressure({ shape: 'circular', radius: a, thickness: d.dimensions.coverThickness, pressure: p, edge: 'simply_supported', material: 'steel' }), 'cover round-trip');
  near(coverRT.sigmaMax_MPa, d.lanes.cover.sigmaMax_MPa, 'ROUND-TRIP: cover t back through platePressure reproduces the designer plate stress');
  assert(coverRT.sigmaMax_MPa <= allow, `cover stress ${coverRT.sigmaMax_MPa} MPa ≤ ${allow.toFixed(2)} MPa allowable`);
  near(coverRT.sigmaMax_MPa, 61.875, 'realised cover σ = (3/8)(3.3)·2·(200/40)² = 61.875 MPa (simply supported, ν = 0.3)');
  near(coverRT.characteristicLength_mm, a, 'SEAM: plate characteristic length === the vessel inner radius a');
  near(d.lanes.cover.deflection_mm, 0.173906, 'cover centre deflection ≈ 0.174 mm', 2e-3);
  near(coverRT.inputs.pressure_MPa, p, 'SEAM: plate pressure input === the vessel pressure');

  // ── BOLT lane round-trip ────────────────────────────────────────────────────
  assert(d.boltSize === 'M16', 'picked M16 (M12 stress-area fails at ~305 MPa, M16 lands at ~167 MPa)');
  assert(d.lanes.bolts.count === 16 && d.lanes.bolts.count % 4 === 0, 'sized 16 bolts (multiple of 4, ~20 kN per bolt target)');
  near(d.lanes.bolts.perBoltLoad_N, F / 16, 'per-bolt external load = F/16 = 15.7 kN');
  near(d.dimensions.preload_N, 1.5 * d.lanes.bolts.perBoltLoad_N, 'preload Fi = 1.5 × per-bolt load (the stated seating assumption)');
  // stress area from the ISO coarse pitch, recomputed independently:
  const pitch = coarsePitchFor('M16')!;
  assert(pitch === 2.0, 'M16 coarse pitch = 2.0 mm (ISO 261 table)');
  const ds = 16 - STRESS_AREA_COEFF * pitch;
  const At = (Math.PI / 4) * ds * ds;
  near(d.lanes.bolts.stressArea_mm2, At, 'ROUND-TRIP: designer At === (π/4)(d − 0.9382p)² recomputed here');
  // the max bolt stress the designer accepted really is (Fi + C·P)/At and under 0.75·yield:
  near(d.lanes.bolts.boltStress_MPa, (d.lanes.bolts.preload_N + d.lanes.bolts.stiffnessConstant_C * d.lanes.bolts.perBoltLoad_N) / d.lanes.bolts.stressArea_mm2, 'bolt stress = (Fi + C·P)/At', 5e-3);
  assert(d.lanes.bolts.boltStress_MPa <= 0.75 * yieldSteel, `bolt stress ${d.lanes.bolts.boltStress_MPa} MPa ≤ 0.75·yield = ${0.75 * yieldSteel} MPa`);
  assert(d.lanes.bolts.stiffnessConstant_C > 0 && d.lanes.bolts.stiffnessConstant_C < 0.5, `stiff steel members shed most of the load (C = ${d.lanes.bolts.stiffnessConstant_C} < 0.5)`);
  // capacity closure: n bolts at the allowable stress cover the whole end load.
  assert(d.lanes.bolts.count * d.lanes.bolts.stressArea_mm2 * 0.75 * yieldSteel >= F, 'n·At·(0.75·yield) covers the full p·π·a² end load');
  // separation round-trip through the bolted-joint core with the designer C:
  const sep = need(separationLoad({ preload: d.lanes.bolts.preload_N, stiffnessConstant: d.lanes.bolts.stiffnessConstant_C, externalLoad: d.lanes.bolts.perBoltLoad_N }), 'separation round-trip');
  near(sep.separationLoad_N, d.lanes.bolts.separationLoad_N, 'ROUND-TRIP: P0 = Fi/(1−C) reproduces the designer separation load', 5e-3);
  assert(sep.adequate === true && d.lanes.bolts.separationSafetyFactor > 1, `separation margin ${d.lanes.bolts.separationSafetyFactor} > 1 — the joint stays closed`);
  near(d.lanes.bolts.separationSafetyFactor, 1.7976, 'separation SF = 1.5/(1−C) ≈ 1.80', 5e-3);

  // ── Geometry + model ────────────────────────────────────────────────────────
  assert(d.dimensions.boltCircleDiameter === 440, 'bolt circle Ø440 = bore + 2.5·boltØ rounded to 5');
  assert(d.dimensions.boltCircleDiameter > d.dimensions.boreDiameter, 'bolts sit OUTSIDE the sealed bore');
  assert(d.dimensions.coverOuterDiameter === 480 && d.dimensions.coverOuterDiameter > d.dimensions.boltCircleDiameter, 'cover Ø480 overhangs the Ø440 bolt circle');
  assert(d.dimensions.boltCircleDiameter % 5 === 0 && d.dimensions.coverOuterDiameter % 5 === 0, 'circle diameters land on 5 mm increments');
  assert(d.dimensions.boltCircleDiameter + d.dimensions.boltHoleDiameter <= d.dimensions.coverOuterDiameter, 'bolt holes fall inside the cover OD');
  assert(d.model.positives.length === 1 && d.model.positives[0].kind === 'cylinder' && d.model.positives[0].r === 240, 'model = one Ø480 disc positive');
  assert((d.model.negatives ?? []).length === 16, 'model has exactly the 16 bolt holes (no centre hole)');
  assert((d.model.negatives ?? []).every((n) => n.kind === 'cylinder' && n.r === 9), 'every hole is the Ø18 clearance hole for M16');
  assert(d.bpy.includes('stl_export') && d.bpy.length > 100, 'a ready-to-compile Blender script is returned');
  const holeArea = 16 * Math.PI * 9 * 9;
  near(d.mass_kg, (Math.PI * 240 * 240 - holeArea) * 40 * 7.85e-6, 'mass = (disc − 16 holes) × 40 mm × steel density ≈ 55.5 kg');

  // ── Safety block ────────────────────────────────────────────────────────────
  assert(d.safety.note.includes('wall'), `the WALL governs this design (97% utilised vs cover 74%, bolts 89%) — ${d.safety.note}`);
  near(d.safety.realisedSafetyFactor!, yieldSteel / d.lanes.wall.lameHoop_MPa, 'realised safety factor = yield / governing Lamé hoop ≈ 3.09');
  assert(d.safety.realisedSafetyFactor! >= SF, 'the rounded-up design beats the 3× target');
  assert(d.summary.includes('M16') && d.summary.includes('wall'), 'summary names the bolt size and the governing lane');
  assert(d.notes.length >= 4 && d.notes.some((n) => n.startsWith('WALL')) && d.notes.some((n) => n.startsWith('COVER')) && d.notes.some((n) => n.startsWith('BOLTS')), 'notes narrate all three lanes');
  assert(d.notes.some((n) => n.includes('Lamé') && n.includes('thin-wall')), 'notes carry the thin-vs-Lamé comparison');

  // ─── THICK regime: Lamé must GOVERN and grow the wall beyond thin-wall ──────
  const thick = need(designPressureCover({ pressure_MPa: 50, boreDiameter_mm: 100, safetyFactor: 2 }), 'thick design');
  const thinReq50 = (50 * 50) / (yieldSteel / 2); // 20 mm — what thin-wall alone asks
  const thinStock50 = ceilToStockPlate(thinReq50)!;
  assert(thinStock50 === 20, 'thin-wall alone would pick 20 mm stock at 50 MPa / Ø100');
  assert(thick.dimensions.wallThickness === 30 && thick.dimensions.wallThickness > thinStock50, `Lamé GOVERNS the thick case: wall grew ${thinStock50} → ${thick.dimensions.wallThickness} mm`);
  assert(thick.lanes.wall.lameGrewWall === true, 'the designer records that Lamé grew the wall');
  // and the reason, directly: at the thin-wall t, exact Lamé exceeds what thin-wall claims.
  const atThin = need(thickCylinder({ innerRadius: 50, outerRadius: 50 + thinStock50, internalPressure: 50 }), 'Lamé at the thin-wall t');
  assert(atThin.hoopStressBore > (50 * 50) / thinStock50, `at equal t = 20: Lamé bore hoop ${atThin.hoopStressBore} MPa > thin-wall ${(50 * 50) / thinStock50} MPa (thin-wall is optimistic at r/t = 2.5)`);
  assert(atThin.hoopStressBore > yieldSteel / 2, 'the thin-wall answer would actually be OVER the allowable — the re-check is load-bearing');
  const thickRT = need(thickCylinder({ innerRadius: 50, outerRadius: 50 + thick.dimensions.wallThickness, internalPressure: 50 }), 'thick wall round-trip');
  assert(thickRT.hoopStressBore <= yieldSteel / 2, `the grown 30 mm wall passes Lamé: ${thickRT.hoopStressBore} MPa ≤ 125 MPa`);

  // ─── MONOTONICITY: double the pressure → everything (weakly) grows ──────────
  const d2 = need(designPressureCover({ pressure_MPa: 4, boreDiameter_mm: 400 }), 'doubled-pressure design');
  assert(d2.dimensions.wallThickness >= d.dimensions.wallThickness, `2× pressure: wall ${d.dimensions.wallThickness} → ${d2.dimensions.wallThickness} mm (weakly grows)`);
  assert(d2.dimensions.coverThickness >= d.dimensions.coverThickness, `2× pressure: cover ${d.dimensions.coverThickness} → ${d2.dimensions.coverThickness} mm (weakly grows)`);
  assert(d2.lanes.bolts.count * d2.lanes.bolts.stressArea_mm2 >= d.lanes.bolts.count * d.lanes.bolts.stressArea_mm2, `2× pressure: total bolt stress area ${Math.round(d.lanes.bolts.count * d.lanes.bolts.stressArea_mm2)} → ${Math.round(d2.lanes.bolts.count * d2.lanes.bolts.stressArea_mm2)} mm² (weakly grows)`);
  near(d2.lanes.bolts.endLoad_N, 2 * F, '2× pressure → exactly 2× the end load (linear statics)');

  // clamped edge is stiffer → thinner-or-equal cover at the same duty.
  const dc = need(designPressureCover({ pressure_MPa: 2, boreDiameter_mm: 400, edgeCondition: 'clamped' }), 'clamped design');
  assert(dc.dimensions.coverThickness <= d.dimensions.coverThickness, `clamped cover ${dc.dimensions.coverThickness} mm ≤ simply-supported ${d.dimensions.coverThickness} mm`);
  assert(dc.dimensions.coverThickness === 30, 'clamped needs 30 mm (t_req 26.8) vs 40 simply supported');
  const dcRT = need(platePressure({ shape: 'circular', radius: a, thickness: dc.dimensions.coverThickness, pressure: p, edge: 'clamped', material: 'steel' }), 'clamped round-trip');
  assert(dcRT.sigmaMax_MPa <= allow && dcRT.sigmaLocation === 'edge', 'clamped cover passes and peaks at the EDGE (bolted boundary)');

  // ─── Explicit bolt count is honoured ────────────────────────────────────────
  const d12 = need(designPressureCover({ pressure_MPa: 2, boreDiameter_mm: 400, boltCount: 12 }), '12-bolt design');
  assert(d12.lanes.bolts.count === 12, 'explicit boltCount = 12 is honoured');
  assert(d12.boltSize === 'M20', 'fewer bolts → bigger bolt: 12 bolts need M20 (M16 would run ~223 MPa > 187.5)');
  near(d12.lanes.bolts.perBoltLoad_N * 12, F, 'SEAM: 12 × per-bolt load still closes to p·π·a²');

  // ─── Guards: helpful ok:false paths ─────────────────────────────────────────
  const g1 = designPressureCover({ pressure_MPa: 0, boreDiameter_mm: 400 });
  assert(!g1.ok && g1.error.includes('pressure'), 'zero pressure → helpful error');
  const g2 = designPressureCover({ pressure_MPa: 2, boreDiameter_mm: -5 });
  assert(!g2.ok && g2.error.includes('boreDiameter'), 'negative bore → helpful error');
  const g3 = designPressureCover({ pressure_MPa: 2, boreDiameter_mm: 400, material: 'unobtanium' });
  assert(!g3.ok && g3.error.includes('unknown material') && g3.error.includes('steel'), 'unknown material → error lists the known ones');
  const g4 = designPressureCover({ pressure_MPa: 2, boreDiameter_mm: 400, boltCount: 2 });
  assert(!g4.ok && g4.error.includes('boltCount'), 'boltCount 2 → rejected (needs ≥ 4)');
  const g5 = designPressureCover({ pressure_MPa: 2, boreDiameter_mm: 400, edgeCondition: 'floppy' });
  assert(!g5.ok && g5.error.includes('edgeCondition'), 'bad edge condition → helpful error');
  const g6 = designPressureCover({ pressure_MPa: 60, boreDiameter_mm: 400 });
  assert(!g6.ok && g6.error.includes('stock'), `60 MPa on Ø400 needs a 144 mm wall — beyond stock, fails honestly (${!g6.ok ? g6.error.slice(0, 60) : ''}…)`);
  assert(STOCK_PLATE_MM[STOCK_PLATE_MM.length - 1] === 50, 'stock plate list tops out at 50 mm (the guard above is real)');

  // ── report ──────────────────────────────────────────────────────────────────
  console.log(`\nWorked design: Ø400 steel vessel @ 2 MPa, SF 3 →`);
  console.log(`  ${d.summary}`);
  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-design-pressure-cover failure(s)`); process.exit(1); }
  console.log('All engineering-design-pressure-cover smoke cases passed');
}

main();
