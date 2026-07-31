/**
 * engineering-cylinder-core smoke.
 *
 * Hydraulic/pneumatic cylinder actuator math, pinned to HAND-COMPUTED references
 * in the mm/N/MPa system (where 1 MPa = 1 N/mm², so force = p·A comes out in N):
 *   force   bore 50 @ 10 MPa → extend = 10·π·25² = 19,635 N; with a 25 rod the
 *           annulus is π(2500−625)/4 = π·468.75 = 1472.6 mm² → retract = 14,726 N.
 *   speed   bore 50 @ 20 L/min → Q = 20·1e6/60 = 333,333 mm³/s, v_ext = Q/A =
 *           169.8 mm/s; the 25 rod's annulus makes retract FASTER (226 mm/s).
 *   power   the cross-lane invariant F·v = p·Q on both strokes (extend strong+slow,
 *           retract weak+fast, same product) links the force and speed lanes.
 *   buckle  rod d25 over 500 mm, steel, pinned → I = π·25⁴/64 = 19,175 mm⁴,
 *           Pcr = π²·200000·I/500² ≈ 151.4 kN (Euler).
 *   input   100 bar = 10 MPa gives the same force (bar/10).
 * Plus the area/force/speed ratios all equal φ = A_piston/A_annulus, and validation.
 */

import {
  cylinderForce, cylinderSpeed, rodBuckling,
} from '../src/lib/engineeringCylinderCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

function main() {
  // ─── Force = pressure · area ─────────────────────────────────────
  {
    const f = ok(cylinderForce({ bore: 50, pressure: 10 }), 'force bore50 p10');
    near(f.pistonArea_mm2, Math.PI * 625, 'piston area = π·25² = 1963.5 mm²');
    near(f.extendForce_N, 19634.95, 'extend force = 10·π·625 ≈ 19,635 N', 1e-3);
    assert(f.retractForce_N === null && f.areaRatio === null && f.annulusArea_mm2 === null, 'no rod ⇒ retract/annulus/ratio all null');
    near(f.pressure_MPa, 10, 'pressure echoed as 10 MPa');

    const fr = ok(cylinderForce({ bore: 50, rodDiameter: 25, pressure: 10 }), 'force with rod25');
    near(fr.annulusArea_mm2!, Math.PI * 468.75, 'annulus area = π(2500−625)/4 = π·468.75 = 1472.6 mm²');
    near(fr.retractForce_N!, 14726.22, 'retract force = 10·π·468.75 ≈ 14,726 N', 1e-3);
    assert(fr.extendForce_N > fr.retractForce_N!, 'extend force > retract force (more area)');
    near(fr.areaRatio!, 4 / 3, 'area ratio φ = 2500/1875 = 4/3');
    near(fr.rodArea_mm2!, Math.PI * 156.25, 'rod area = π·12.5² = 490.9 mm²');
    near(fr.annulusArea_mm2!, fr.pistonArea_mm2 - fr.rodArea_mm2!, 'annulus = piston − rod area (independent identity)');
    near(fr.extendForce_N / fr.retractForce_N!, fr.areaRatio!, 'F_ext/F_ret = φ (force ratio = area ratio)');
  }

  // ─── pressure_bar input (1 bar = 0.1 MPa) ────────────────────────
  {
    const bar = ok(cylinderForce({ bore: 50, pressure_bar: 100 }), 'force 100 bar');
    near(bar.pressure_MPa, 10, '100 bar → 10 MPa');
    near(bar.extendForce_N, 19634.95, '100 bar gives the same extend force as 10 MPa', 1e-3);
  }

  // ─── Speed = flow / area ─────────────────────────────────────────
  {
    const s = ok(cylinderSpeed({ bore: 50, rodDiameter: 25, flowRate: 20, stroke: 300 }), 'speed bore50 flow20');
    near(s.flowRate_mm3_s, (20 * 1e6) / 60, 'flow 20 L/min = 333,333 mm³/s');
    near(s.extendSpeed_mm_s, 169.76527, 'extend speed = Q/A_piston ≈ 169.8 mm/s', 1e-4);
    near(s.retractSpeed_mm_s!, 226.35369, 'retract speed = Q/A_annulus ≈ 226.4 mm/s', 1e-4);
    assert(s.retractSpeed_mm_s! > s.extendSpeed_mm_s, 'retract speed > extend speed (less area)');
    near(s.speedRatio!, 4 / 3, 'v_ret/v_ext = φ = 4/3 (same ratio as force)');
    near(s.extendTime_s!, 300 / s.extendSpeed_mm_s, 'extend time = stroke/extendSpeed');
    assert(s.retractTime_s! < s.extendTime_s!, 'retract time < extend time (retract is faster)');
  }

  // ─── Cross-lane power invariant: F·v = p·Q on BOTH strokes ───────
  {
    const f = ok(cylinderForce({ bore: 50, rodDiameter: 25, pressure: 10 }), 'power: force');
    const s = ok(cylinderSpeed({ bore: 50, rodDiameter: 25, flowRate: 20 }), 'power: speed');
    const pQ = 10 * ((20 * 1e6) / 60); // MPa·mm³/s = N·mm/s
    near(f.extendForce_N * s.extendSpeed_mm_s, pQ, 'extend F·v = p·Q (hydraulic power)', 1e-3);
    near(f.retractForce_N! * s.retractSpeed_mm_s!, f.extendForce_N * s.extendSpeed_mm_s, 'retract F·v = extend F·v (both = p·Q — power conserved)', 1e-3);
  }

  // ─── Rod buckling (Euler) ────────────────────────────────────────
  {
    const rb = ok(rodBuckling({ rodDiameter: 25, strokeLength: 500, load: 30000, material: 'steel', endCondition: 'pinned' }), 'buckling steel pinned');
    near(rb.momentOfInertia_mm4, (Math.PI * 25 ** 4) / 64, 'I = π·25⁴/64 = 19,175 mm⁴');
    near(rb.momentOfInertia_mm4, 19174.7598, 'I hand-value ≈ 19,174.76 mm⁴', 1e-4);
    near(rb.criticalLoad_N, 151397.8, 'Pcr = π²·200000·I/500² ≈ 151,398 N', 1e-3);
    near(rb.criticalLoad_kN, 151.3978, 'Pcr ≈ 151.4 kN', 1e-3);
    near(rb.safetyFactor, rb.criticalLoad_N / 30000, 'SF = Pcr/load (consistency)');
    near(rb.safetyFactor, 5.0466, 'SF ≈ 5.05 vs 30 kN load', 1e-3);

    // fixed_free (K=2) doubles the effective length ⇒ Pcr drops to a quarter.
    const ff = ok(rodBuckling({ rodDiameter: 25, strokeLength: 500, load: 30000, material: 'steel', endCondition: 'fixed_free' }), 'buckling fixed_free');
    assert(ff.K === 2, 'fixed_free K = 2');
    near(ff.criticalLoad_N, rb.criticalLoad_N / 4, 'fixed_free Pcr = pinned Pcr / 4 (Le doubled)');

    // aluminum's lower E scales Pcr linearly (Pcr ∝ E).
    const al = ok(rodBuckling({ rodDiameter: 25, strokeLength: 500, load: 30000, material: 'aluminum', endCondition: 'pinned' }), 'buckling aluminum');
    near(al.criticalLoad_N, rb.criticalLoad_N * (69000 / 200000), 'aluminum Pcr = steel Pcr · (E_al/E_steel)');

    // default (no material, no E) is a steel rod.
    const def = ok(rodBuckling({ rodDiameter: 25, strokeLength: 500, load: 30000, endCondition: 'pinned' }), 'buckling default');
    assert(def.E_MPa === 200000, 'default material is steel (E = 200 GPa)');
    near(def.criticalLoad_N, rb.criticalLoad_N, 'default-steel Pcr matches explicit steel');
  }

  // ─── Validation (fail closed) ────────────────────────────────────
  {
    assert(!cylinderForce({ bore: 0, pressure: 10 }).ok, 'zero bore rejected');
    assert(!cylinderForce({ bore: 50 }).ok, 'missing pressure rejected');
    assert(!cylinderForce({ bore: 50, rodDiameter: 60, pressure: 10 }).ok, 'rod ≥ bore rejected (force)');
    assert(!cylinderSpeed({ bore: 50, flowRate: 0 }).ok, 'zero flow rejected (speed)');
    assert(!cylinderSpeed({ bore: 50, rodDiameter: 55, flowRate: 20 }).ok, 'rod ≥ bore rejected (speed)');
    assert(!rodBuckling({ rodDiameter: 25, strokeLength: 500, load: 0 }).ok, 'zero load rejected (buckling)');
    assert(!rodBuckling({ rodDiameter: 25, strokeLength: 500, load: 30000, endCondition: 'nonsense' }).ok, 'unknown endCondition rejected');
    assert(!rodBuckling({ rodDiameter: 25, strokeLength: 500, load: 30000, material: 'unobtainium' }).ok, 'unknown material rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-cylinder-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-cylinder-core smoke cases passed.');
}

main();
