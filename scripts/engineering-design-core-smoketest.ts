/**
 * engineering-design-core smoke.
 *
 * The one-call design recipes package the proven size → model → tolerance chain,
 * so this pins each against hand computation AND asserts self-consistency — the
 * model the recipe emits has the dimensions the recipe sized, and the realised
 * safety factor beats the target because the required size was rounded UP and
 * re-checked. The bracket recipe reproduces the workflow integration's numbers.
 */

import { designBracket, designShaft, designBeam, designPart, designBoundingBox } from '../src/lib/engineeringDesignCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Bracket recipe (= the workflow integration chain) ───────────
  {
    const b = ok(designBracket({ load: 500, arm: 100, material: 'steel', safetyFactor: 2, width: 40, boreDiameter: 20 }), 'bracket');
    assert(b.dimensions.thickness === 8, 'sized 8 mm plate (√60 = 7.75 rounded up to even)');
    near(b.dimensions.length, 120, 'length = arm + margin rounded to 5 = 120');
    near(b.safety.realisedStress_MPa!, 500 * 100 / (40 * 8 ** 2 / 6), 'realised σ = M/S = 117.2 MPa');
    near(b.safety.realisedSafetyFactor!, 250 / (500 * 100 / (40 * 8 ** 2 / 6)), 'realised safety factor = 2.13');
    assert(b.safety.realisedSafetyFactor! >= 2, 'the rounded-up size beats the 2× target');
    assert(b.fit && b.fit.type === 'clearance' && b.fit.minClearance_um === 7, 'Ø20 H7/g6 bore → 7–41 µm running clearance');
    near(b.mass_kg, (40 * 120 * 8 - Math.PI * 100 * 8 - 4 * Math.PI * 30.25 * 8) * 7.85e-6, 'mass = (plate − bore − 4 holes) × steel density ≈ 258 g');
    // SELF-CHECK: the emitted model has the sized dimensions.
    const bb = designBoundingBox(b)!;
    assert(bb.w === 40 && bb.d === 120 && bb.h === 8, 'the model bounding box = the sized 40 × 120 × 8 plate');
    assert(b.bpy.includes('stl_export') && b.bpy.length > 100, 'a ready-to-compile Blender script is returned');
  }

  // ─── Shaft recipe (torsion) ──────────────────────────────────────
  {
    const s = ok(designShaft({ torque: 100, material: 'steel', safetyFactor: 2 }), 'shaft');
    assert(s.dimensions.diameter === 20, 'sized Ø20 shaft (d_req 19.2 rounded up to even)');
    near(s.safety.realisedStress_MPa!, 16 * 100000 / (Math.PI * 20 ** 3), 'realised τ = 16T/πd³ = 63.66 MPa');
    assert(s.safety.realisedSafetyFactor! > 2, 'safety on shear yield beats the 2× target');
    assert(s.bpy.includes('stl_export'), 'returns a shaft model');
    // a bigger torque needs a bigger shaft.
    assert(ok(designShaft({ torque: 400, material: 'steel' }), 'big shaft').dimensions.diameter > s.dimensions.diameter, 'more torque → larger shaft');
  }

  // ─── Beam recipe (sizes a structural section) ────────────────────
  {
    const bm = ok(designBeam({ load: 10000, span: 1000, section: 'i_beam', material: 'steel', safetyFactor: 2 }), 'beam');
    assert(bm.safety.realisedStress_MPa! < bm.safety.allowableStress_MPa!, 'the sized section keeps σ under the allowable');
    assert(bm.safety.realisedSafetyFactor! >= 2, 'beam meets the 2× target');
    assert(bm.dimensions.Sx_mm3 >= (10000 * 1000 / 4) / bm.safety.allowableStress_MPa!, 'section modulus ≥ M/σ_allow (sized to the load)');
    assert(bm.bpy.includes('stl_export'), 'returns a beam model');
    // a heavier load forces a deeper section.
    assert(ok(designBeam({ load: 40000, span: 1000, section: 'i_beam' }), 'heavy beam').dimensions.height > bm.dimensions.height, 'more load → deeper beam');
  }

  // ─── Dispatcher + validation ─────────────────────────────────────
  {
    assert(designPart({ type: 'bracket', load: 500, arm: 100 }).ok, "designPart routes 'bracket'");
    assert(designPart({ type: 'shaft', torque: 100 }).ok, "designPart routes 'shaft'");
    assert(designPart({ type: 'beam', load: 5000, span: 800 }).ok, "designPart routes 'beam'");
    // wave-7 packaged designers (each has its own deep smoke; here we prove ROUTING).
    assert(designPart({ type: 'gearbox', power_kW: 5, inputSpeed_rpm: 1500, ratio: 3 }).ok, "designPart routes 'gearbox'");
    assert(designPart({ type: 'isolator', mass_kg: 250, speed_rpm: 1500, isolationPercent: 90 }).ok, "designPart routes 'isolator'");
    assert(designPart({ type: 'pressure_cover', pressure_MPa: 2, boreDiameter_mm: 400 }).ok, "designPart routes 'pressure_cover'");
    assert(designPart({ type: 'conveyor_drive', power_kW: 3, inputSpeed_rpm: 960, ratio: 3 }).ok, "designPart routes 'conveyor_drive'");
    assert(designPart({ type: 'brake', torque_Nm: 30, speed_rpm: 600, h_W_m2K: 100, dutyCycle: 0.05 }).ok, "designPart routes 'brake' (forced air, light duty)");
    // free-air defaults CANNOT shed real brake heat — the honest guard proves routing too.
    const brakeHot = designPart({ type: 'brake', torque_Nm: 30, speed_rpm: 600 });
    assert(!brakeHot.ok && !brakeHot.ok && (brakeHot as any).error.includes('cooling shortfall'), "designPart routes 'brake' fail-closed cooling guard");
    assert(!designPart({ type: 'spaceship' }).ok, 'unknown design type rejected');
    assert(!designBracket({ load: -1, arm: 100 } as any).ok, 'negative load rejected');
    assert(!designShaft({} as any).ok, 'shaft without torque rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-design-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-design-core smoke cases passed — one call sizes, models, and tolerances a part.');
}

main();
