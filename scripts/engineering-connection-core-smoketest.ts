/**
 * engineering-connection-core smoke.
 *
 * Welded and bolted joints, pinned against hand-computed textbook values. A
 * fillet weld fails across its 45° THROAT (0.7071·leg), not its leg — a 6 mm weld
 * 100 mm long at 95 MPa carries 0.7071·6·100·95 ≈ 40,305 N, and a weld all around
 * a 50×80 plate has length 2(50+80)=260. A bolt group shares its shear equally:
 * 4 bolts under 40 kN single shear see 10 kN each, and the M12 tensile stress
 * area is the standard 84.3 mm²; double shear doubles the capacity. Bolt bearing
 * acts on the projected area d·t, so 40 kN on four Ø12 bolts through a 10 mm plate
 * is 83.3 MPa. An eccentric group adds a torsional M·r/J on top of the direct
 * P/n, and the resultants superpose onto a critical bolt. The smoke IS the proof.
 */

import {
  filletWeld, boltGroupShear, bearingStress, boltGroupEccentric, THROAT_FACTOR,
} from '../src/lib/engineeringConnectionCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Fillet weld: the throat governs, not the leg ────────────────
  {
    // leg=6, length=100, allowableShear=95 → throat=0.7071·6=4.2426, cap≈40,305 N.
    const w = ok(filletWeld({ leg: 6, length: 100, allowableShear: 95 }), 'fillet 6/100/95');
    near(w.throat_mm, 4.2426, 'throat = 0.7071·leg = 4.2426 mm');
    near(w.throat_mm, 6 * Math.sin(Math.PI / 4), 'throat = leg·sin45° (the 45° bisector)');
    near(w.throatArea_mm2, 424.26, 'throat area = throat·length = 424.26 mm²');
    near(w.capacity_N, 40305.09, 'capacity = throat·length·τ = 40,305 N (≈40,300)', 1e-3);
    near(THROAT_FACTOR, Math.SQRT1_2, 'THROAT_FACTOR is the exact 1/√2');

    // a load gives the throat stress and the utilisation.
    const wl = ok(filletWeld({ leg: 6, length: 100, allowableShear: 95, load: 30000 }), 'fillet +load');
    near(wl.stress_MPa!, 70.7107, 'stress = load/throatArea = 70.71 MPa');
    near(wl.utilisation!, 0.7443, 'utilisation = load/capacity = 0.744');
    assert(wl.adequate === true, '30 kN < capacity → adequate');

    const over = ok(filletWeld({ leg: 6, length: 100, allowableShear: 95, load: 50000 }), 'fillet overload');
    assert(over.adequate === false && over.utilisation! > 1, '50 kN > capacity → utilisation > 1, not adequate');
  }

  // ─── Weld all around a rectangle: length = 2(w+h) ────────────────
  {
    const w = ok(filletWeld({ leg: 6, perimeter: { width: 50, height: 80 }, allowableShear: 95 }), 'weld all-around');
    near(w.length_mm, 260, 'all-around length = 2(50+80) = 260 mm');
    near(w.capacity_N, 104793.22, 'all-around capacity = 0.7071·6·260·95 ≈ 104,793 N (≈104,800)', 1e-3);
  }

  // ─── Allowable shear from the electrode (ASD ≈ 0.30·FEXX) ─────────
  {
    const w = ok(filletWeld({ leg: 8, length: 100, electrodeStrength: 482 }), 'E70 weld');
    near(w.allowableShear_MPa, 144.6, 'E70: τ_allow = 0.30·FEXX = 0.30·482 = 144.6 MPa');
    near(w.capacity_N, 81798.11, 'capacity uses the derived allowable', 1e-3);
    const lrfd = ok(filletWeld({ leg: 8, length: 100, electrodeStrength: 482, electrodeFactor: 0.6 }), 'weld factor override');
    near(lrfd.allowableShear_MPa, 289.2, 'electrodeFactor override: 0.60·482 = 289.2 MPa');
  }

  // ─── Bolt group in shear: equal sharing, tensile stress area ─────
  {
    // 4 × M12, single shear, 40 kN, τ_allow=120 MPa.
    const g = ok(boltGroupShear({ boltCount: 4, boltDiameter: 12, shearLoad: 40000, allowableShear: 120 }), 'M12 x4 single');
    near(g.boltArea_mm2, 84.3, 'M12 tensile stress area ≈ 84.3 mm² (π/4·(d−0.9382p)²)', 2e-3);
    near(g.shearPerBolt_N, 10000, 'shear per bolt = V/(n·planes) = 40000/4 = 10,000 N');
    near(g.shearStress_MPa, 118.67, 'shear stress = 10000/84.27 = 118.67 MPa', 1e-3);
    near(g.safetyFactor, 1.0112, 'SF = totalCapacity/V = 1.011', 1e-3);
    assert(g.safetyFactor > 1 && g.safetyFactor < 1.05, 'SF is just above 1 (the joint is right at capacity)');
    assert(g.adequate === true, 'M12 x4 single shear is adequate at 40 kN');
    // two independent routes to SF must agree.
    near(g.safetyFactor, g.allowableShear_MPa / g.shearStress_MPa, 'SF = τ_allow/τ_applied (two-route check)', 1e-2);

    // double shear doubles the capacity and halves the per-plane shear.
    const d = ok(boltGroupShear({ boltCount: 4, boltDiameter: 12, shearLoad: 40000, allowableShear: 120, planes: 2 }), 'M12 x4 double');
    near(d.totalCapacity_N, 2 * g.totalCapacity_N, 'double shear → 2× total capacity', 1e-6);
    near(d.shearPerBolt_N, 5000, 'double shear → 5,000 N per shear plane');

    // explicit area overrides the diameter path.
    const ex = ok(boltGroupShear({ boltCount: 2, boltArea: 100, shearLoad: 10000, allowableShear: 150 }), 'explicit area');
    assert(ex.boltArea_mm2 === 100 && ex.areaBasis.includes('explicit'), 'explicit boltArea is used verbatim');

    // no pitch available → the (π/4)(0.85d)² approximation.
    const ap = ok(boltGroupShear({ boltCount: 1, boltDiameter: 11, shearLoad: 5000, allowableShear: 100 }), '0.85d approx');
    near(ap.boltArea_mm2, 68.66, 'non-standard Ø11, no pitch → As = π/4·(0.85·11)² = 68.66 mm²', 1e-3);
    assert(ap.areaBasis.includes('approx'), 'approximation basis is reported');
  }

  // ─── Bolt bearing on the projected area d·t ──────────────────────
  {
    const b = ok(bearingStress({ load: 40000, boltDiameter: 12, plateThickness: 10, boltCount: 4 }), 'bearing x4');
    near(b.bearingArea_mm2, 480, 'projected area = d·t·n = 12·10·4 = 480 mm²');
    near(b.bearingStress_MPa, 83.3333, 'σ_bearing = 40000/480 = 83.3 MPa');
    const bs = ok(bearingStress({ load: 40000, boltDiameter: 12, plateThickness: 10, boltCount: 4, allowableBearing: 200 }), 'bearing SF');
    near(bs.safetyFactor!, 2.4, 'SF = allowable/σ = 200/83.3 = 2.4');
    assert(bs.adequate === true, 'bearing is adequate at 200 MPa allowable');
    const b1 = ok(bearingStress({ load: 40000, boltDiameter: 12, plateThickness: 10 }), 'bearing single');
    near(b1.bearingStress_MPa, 333.3333, 'single bolt (n defaults to 1) → σ = 40000/120 = 333 MPa');
  }

  // ─── Eccentric bolt group: direct + torsional superpose ──────────
  {
    // 2 bolts at ±50 mm, 10 kN down applied 100 mm off the centroid.
    const e = ok(boltGroupEccentric({ bolts: [{ x: -50, y: 0 }, { x: 50, y: 0 }], load: 10000, at: { x: 100, y: 0 } }), 'eccentric');
    near(e.polarMoment_mm2, 5000, 'J = Σ(x²+y²) = 50²+50² = 5000 mm²');
    near(Math.abs(e.moment_Nmm), 1000000, 'M = P·e = 10000·100 = 1,000,000 N·mm');
    near(e.directShearPerBolt_N, 5000, 'direct shear = P/n = 10000/2 = 5,000 N');
    near(e.criticalForce_N, 15000, 'critical bolt = direct 5k + torsional 10k = 15,000 N');
    assert(e.criticalBolt.x === 50, 'critical bolt is the one on the loaded side (+50, where the two add)');

    // load through the centroid → pure direct shear, no torsion.
    const c = ok(boltGroupEccentric({ bolts: [{ x: -50, y: 0 }, { x: 50, y: 0 }], load: 10000, at: { x: 0, y: 0 } }), 'centroidal');
    near(c.criticalForce_N, 5000, 'load through the centroid → every bolt carries only the direct 5,000 N');
  }

  // ─── Validation: missing / bad inputs fail closed ────────────────
  {
    assert(!filletWeld({ leg: 0, length: 100, allowableShear: 95 } as any).ok, 'non-positive leg rejected');
    assert(!filletWeld({ leg: 6, allowableShear: 95 } as any).ok, 'weld with no length or perimeter rejected');
    assert(!filletWeld({ leg: 6, length: 100 } as any).ok, 'weld with no allowable/electrode rejected');
    assert(!boltGroupShear({ boltCount: 4, shearLoad: 40000, allowableShear: 120 } as any).ok, 'bolt group with no diameter or area rejected');
    assert(!boltGroupShear({ boltCount: 4, boltDiameter: 12, shearLoad: 40000, allowableShear: 120, planes: 3 } as any).ok, 'planes must be 1 or 2');
    assert(!boltGroupShear({ boltCount: 0, boltDiameter: 12, shearLoad: 40000, allowableShear: 120 }).ok, 'boltCount ≥ 1 enforced');
    assert(!bearingStress({ load: -40000, boltDiameter: 12, plateThickness: 10 }).ok, 'negative bearing load rejected');
    assert(!bearingStress({ load: 40000, boltDiameter: 12 } as any).ok, 'bearing with no plate thickness rejected');
    assert(!boltGroupEccentric({ bolts: [], load: 10000, at: { x: 100, y: 0 } }).ok, 'eccentric with no bolts rejected');
    assert(!boltGroupEccentric({ bolts: [{ x: 0, y: 0 }, { x: 0, y: 0 }], load: 10000, at: { x: 10, y: 0 } }).ok, 'coincident bolts (J=0) rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-connection-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-connection-core smoke cases passed.');
}

main();
