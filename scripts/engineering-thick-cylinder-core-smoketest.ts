/**
 * engineering-thick-cylinder-core smoke.
 *
 * The thick-walled-cylinder (Lamé) core is pinned against EXACT boundary
 * conditions and HAND-COMPUTED textbook cases:
 *
 *  • Textbook Lamé case ri=100, ro=200, pi=100 MPa (po=0). ro²=40000, ri²=10000,
 *    ro²−ri²=30000 → A=pi·ri²/(ro²−ri²)=33.333, B=pi·ri²·ro²/(ro²−ri²)=1,333,333.
 *    So σθ,bore = A+B/ri² = 166.667 (max hoop), σr,bore = A−B/ri² = −100 (= −pi,
 *    EXACT), σθ,outer = 66.667, σr,outer = 0 (free surface, EXACT). Bore max shear
 *    = (σθ−σr)/2 = 133.333 = pi·ro²/(ro²−ri²). Capped-end axial σz = A = 33.333, so
 *    the 3D von Mises at the bore is (√3/2)|σθ−σr| = 230.940.
 *
 *  • The INVARIANT σr+σθ = 2A = 66.667 holds at EVERY radius (100…200) — sampled
 *    and asserted, a free self-consistency proof of the whole field.
 *
 *  • THIN-WALL LIMIT (the key cross-check): a thin cylinder ri=100, ro=102, pi=10
 *    has exact Lamé bore hoop 505.05, which agrees with the elementary thin-wall
 *    pr/t — and specifically REPRODUCES the engineering.calc pressure_vessel lane
 *    (pi·ri/t = 500) to ~1% — proving the thick formula degenerates correctly.
 *
 *  • PRESS/SHRINK FIT: a solid steel shaft in a steel hub, rc=25, ro=50, diametral
 *    interference δ=0.05 mm (radial δr=0.025). Hand value p = δr·E·(ro²−rc²)/(2·rc·ro²)
 *    = 75 MPa. The interference SPLITS: hub grows 0.018438 + shaft shrinks 0.006563
 *    = 0.025 = δr. Hub bore hoop = p(ro²+rc²)/(ro²−rc²) = 125 (tensile), shaft
 *    surface = −p = −75 (uniform compression). With µ=0.15, L=40 the friction
 *    holding torque T = µ·p·2π·rc²·L = 1.767×10⁶ N·mm. p, torque are LINEAR in δ
 *    and µ. The smoke IS the proof.
 */

import { thickCylinder, thickCylinderStressAt, pressFit } from '../src/lib/engineeringThickCylinderCore';
import { pressureVessel } from '../src/lib/engineeringCalcCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
/** Relative tolerance (default 1e-3). */
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
/** Absolute tolerance — for boundary conditions that must hold EXACTLY. */
function exact(a: number, b: number, label: string, tol = 1e-6) {
  assert(Math.abs(a - b) <= tol, `${label} (got ${a}, expected exactly ${b})`);
}
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Textbook thick cylinder: ri=100, ro=200, pi=100 (po=0) ─────────
  {
    const v = ok(thickCylinder({ innerRadius: 100, outerRadius: 200, internalPressure: 100 }), 'thick(100,200,pi=100)');
    near(v.lameA, 100 * 10000 / 30000, 'Lamé A = pi·ri²/(ro²−ri²) = 33.333');
    near(v.lameB, 100 * 10000 * 40000 / 30000, 'Lamé B = pi·ri²·ro²/(ro²−ri²) = 1,333,333');
    near(v.hoopStressBore, 166.6667, 'σθ,bore = A+B/ri² = 166.667 (MAX hoop)');
    exact(v.radialStressBore, -100, 'BC: σr,bore = −pi = −100 EXACT');
    near(v.hoopStressOuter, 66.6667, 'σθ,outer = 66.667');
    exact(v.radialStressOuter, 0, 'BC: σr,outer = −po = 0 EXACT (free surface)');
    near(v.maxShearBore, 133.3333, 'bore max shear = (σθ−σr)/2 = 133.333');
    near(v.maxShearBore, 100 * 40000 / 30000, 'bore max shear also = pi·ro²/(ro²−ri²)');
    near(v.invariantSum2A, 66.6667, 'invariant σθ+σr = 2A = 66.667');
    near(v.axialStress, 33.3333, 'capped-end axial σz = A = 33.333');
    near(v.vonMisesBore, 230.9401, 'von Mises at bore (capped) = (√3/2)|σθ−σr| = 230.940');
    near(v.radiusRatioRoRi, 2, 'ro/ri = 2');
    // The hoop stress is largest at the bore and smaller at the outer surface.
    assert(v.hoopStressBore > v.hoopStressOuter, 'hoop stress is MAX at the bore, falls toward outer');
  }

  // ─── Open (uncapped) ends: axial = 0, different von Mises ───────────
  {
    const v = ok(thickCylinder({ innerRadius: 100, outerRadius: 200, internalPressure: 100, closedEnds: false }), 'thick open ends');
    exact(v.axialStress, 0, 'open-ends axial σz = 0');
    near(v.vonMisesBore, 233.3333, 'open-ends von Mises at bore = 233.333');
    assert(v.closedEnds === false, 'closedEnds flag echoed false');
  }

  // ─── A second internal-pressure case (diameters in): ri=50, ro=100, pi=60 ─
  {
    const v = ok(thickCylinder({ innerDiameter: 100, outerDiameter: 200, internalPressure: 60 }), 'thick(d100,d200,pi=60)');
    exact(v.radialStressBore, -60, 'BC: σr,bore = −60 EXACT');
    exact(v.radialStressOuter, 0, 'BC: σr,outer = 0 EXACT');
    near(v.hoopStressBore, 100, 'σθ,bore = 60·(12500)/7500 = 100');
    near(v.hoopStressOuter, 40, 'σθ,outer = 40');
    near(v.invariantSum2A, 40, 'invariant 2A = 40');
    near(v.maxShearBore, 80, 'bore max shear = 80');
  }

  // ─── External pressure only: ri=100, ro=200, po=50 (pi=0) ───────────
  {
    const v = ok(thickCylinder({ innerRadius: 100, outerRadius: 200, externalPressure: 50 }), 'thick external po=50');
    exact(v.radialStressBore, 0, 'BC: σr,bore = −pi = 0 EXACT');
    exact(v.radialStressOuter, -50, 'BC: σr,outer = −po = −50 EXACT');
    near(v.hoopStressBore, -133.3333, 'σθ,bore = −133.333 (compressive under external pressure)');
    near(v.hoopStressOuter, -83.3333, 'σθ,outer = −83.333');
    near(v.invariantSum2A, -133.3333, 'invariant 2A = −133.333');
    assert(v.hoopStressBore < 0 && v.hoopStressOuter < 0, 'external pressure ⇒ compressive hoop everywhere');
  }

  // ─── Combined internal + external pressure: BCs still exact ─────────
  {
    const v = ok(thickCylinder({ innerRadius: 100, outerRadius: 200, internalPressure: 100, externalPressure: 50 }), 'thick pi=100,po=50');
    exact(v.radialStressBore, -100, 'combined BC: σr,bore = −pi = −100 EXACT');
    exact(v.radialStressOuter, -50, 'combined BC: σr,outer = −po = −50 EXACT');
    near(v.lameA, -33.3333, 'combined Lamé A = (pi·ri²−po·ro²)/(ro²−ri²) = −33.333');
    near(v.invariantSum2A, -66.6667, 'combined invariant 2A = −66.667');
  }

  // ─── The σr+σθ = 2A INVARIANT across the wall (textbook case) ───────
  {
    const spec = { innerRadius: 100, outerRadius: 200, internalPressure: 100 };
    const twoA = 66.6667;
    for (const rr of [100, 120, 150, 175, 200]) {
      const s = ok(thickCylinderStressAt(spec, rr), `stressAt r=${rr}`);
      near(s.sumSigma, twoA, `σr+σθ = 2A = 66.667 at r=${rr} (radius-invariant)`);
      assert(s.hoopStress >= s.radialStress, `σθ ≥ σr at r=${rr}`);
    }
    // Endpoints match the summary function.
    const at100 = ok(thickCylinderStressAt(spec, 100), 'stressAt bore');
    exact(at100.radialStress, -100, 'stressAt bore σr = −pi = −100 EXACT');
    near(at100.hoopStress, 166.6667, 'stressAt bore σθ = 166.667 (matches summary)');
    const at200 = ok(thickCylinderStressAt(spec, 200), 'stressAt outer');
    exact(at200.radialStress, 0, 'stressAt outer σr = 0 EXACT');
    near(at200.hoopStress, 66.6667, 'stressAt outer σθ = 66.667 (matches summary)');
  }

  // ─── THIN-WALL LIMIT reproduces the pressure_vessel lane ────────────
  {
    const thin = ok(thickCylinder({ innerRadius: 100, outerRadius: 102, internalPressure: 10 }), 'thin cylinder t=2');
    near(thin.hoopStressBore, 505.0495, 'thin Lamé bore hoop = 10·20404/404 = 505.05');
    near(thin.thinWallHoopApprox, 500, 'core thin-wall reference pi·ri/t = 10·100/2 = 500');

    // Direct cross-check against the ACTUAL engineering.calc pressure_vessel lane.
    const pv = pressureVessel({ pressure: 10, innerRadius: 100, wallThickness: 2 });
    assert(pv.ok, 'pressure_vessel lane computes');
    if (pv.ok) {
      const pvHoop = pv.extra!.hoop_stress_MPa;
      near(pvHoop, 500, 'pressure_vessel σ_hoop = p·r/t = 500');
      exact(thin.thinWallHoopApprox, pvHoop, 'thick core thin-wall reference == pressure_vessel hoop EXACT');
      // The exact Lamé bore hoop degenerates to the thin-wall value within ~1%.
      const relErr = Math.abs(thin.hoopStressBore - pvHoop) / pvHoop;
      assert(relErr < 0.015, `Lamé bore hoop within 1.5% of pressure_vessel (rel err ${(relErr * 100).toFixed(3)}%)`);
      // Using the MEAN radius the agreement is far tighter (~0.01%).
      const meanThin = 10 * 101 / 2; // pi·rmean/t
      assert(Math.abs(thin.hoopStressBore - meanThin) / meanThin < 0.001, 'Lamé bore hoop within 0.1% of pi·rmean/t');
    }

    // A genuinely THICK cylinder is far from thin-wall (proves it is NOT just pr/t).
    const thick = ok(thickCylinder({ innerRadius: 100, outerRadius: 200, internalPressure: 10 }), 'thick t=100');
    assert(Math.abs(thick.hoopStressBore - thick.thinWallHoopApprox) / thick.thinWallHoopApprox > 0.5,
      'thick cylinder bore hoop diverges >50% from thin-wall pr/t (thick theory is required)');
  }

  // ─── PRESS FIT: solid steel shaft in a steel hub (hand-verified) ────
  {
    const v = ok(pressFit({
      interfaceRadius: 25, outerRadius: 50, // solid shaft ⇒ ri = 0 (default)
      interference: 0.05, // diametral, mm
      material: 'steel', frictionCoefficient: 0.15, length: 40,
    }), 'pressFit solid steel');
    near(v.contactPressure, 75, 'contact pressure p = 75 MPa (hand value δr·E·(ro²−rc²)/(2·rc·ro²))');
    near(v.radialInterference, 0.025, 'radial interference δr = δ/2 = 0.025');
    near(v.diametralInterference, 0.05, 'diametral interference δ = 0.05');
    near(v.interfaceDiameter, 50, 'interface diameter = 2·rc = 50');
    near(v.hubBoreHoop, 125, 'hub bore hoop = p(ro²+rc²)/(ro²−rc²) = 125 (tensile)');
    near(v.hubOuterHoop, 50, 'hub outer hoop = 2p·rc²/(ro²−rc²) = 50');
    near(v.shaftInterfaceHoop, -75, 'shaft surface stress = −p = −75 (uniform compression)');
    near(v.shaftBoreHoop, -75, 'solid shaft is uniform: bore hoop = −p = −75');
    assert(v.contactPressure > 0, 'contact pressure is positive');
    assert(v.hubBoreHoop > 0, 'hub bore hoop is TENSILE (can split the hub)');
    assert(v.shaftInterfaceHoop < 0, 'shaft surface stress is COMPRESSIVE');

    // The interference SPLITS: hub grows outward + shaft shrinks inward = δr.
    near(v.hubRadialExpansion, 0.018438, 'hub radial growth = p·rc·Co = 0.018438');
    near(v.shaftRadialContraction, 0.006563, 'shaft radial shrink = p·rc·Ci = 0.006563');
    exact(v.hubRadialExpansion + v.shaftRadialContraction, 0.025, 'growth + shrink = δr = 0.025 (interference splits)', 1e-5);
    assert(v.hubRadialExpansion > 0 && v.shaftRadialContraction > 0, 'both members deform to accommodate the interference');

    // Friction holding torque + axial push-out force.
    near(v.holdingTorque_Nmm!, 1767145.87, 'holding torque T = µ·p·2π·rc²·L = 1.767×10⁶ N·mm');
    near(v.holdingTorque_Nm!, 1767.146, 'holding torque = 1767.1 N·m');
    near(v.axialHoldingForce_N!, 70685.83, 'axial push-out resistance = µ·p·2π·rc·L = 70,686 N');
    assert(v.frictionCoefficient === 0.15 && v.engagementLength === 40, 'µ and L echoed');
  }

  // ─── PRESS FIT: linearity of p in δ and of T in µ ───────────────────
  {
    const p1 = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.05, material: 'steel' }), 'pf δ=0.05');
    const p2 = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.10, material: 'steel' }), 'pf δ=0.10');
    near(p2.contactPressure, 150, 'double interference ⇒ p = 150 (LINEAR in δ)');
    near(p2.contactPressure, 2 * p1.contactPressure, 'p(2δ) = 2·p(δ) exactly');

    const t1 = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.05, material: 'steel', length: 40, frictionCoefficient: 0.15 }), 'pf µ=0.15');
    const t2 = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.05, material: 'steel', length: 40, frictionCoefficient: 0.30 }), 'pf µ=0.30');
    near(t2.holdingTorque_Nmm!, 2 * t1.holdingTorque_Nmm!, 'double µ ⇒ double torque (LINEAR in µ)');
    // Torque also scales with interference (through p).
    const t3 = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.10, material: 'steel', length: 40, frictionCoefficient: 0.15 }), 'pf δ=0.10 torque');
    near(t3.holdingTorque_Nmm!, 2 * t1.holdingTorque_Nmm!, 'double interference ⇒ double torque');
  }

  // ─── PRESS FIT: radial-interference input matches diametral ─────────
  {
    const d = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.05, material: 'steel' }), 'pf diametral 0.05');
    const rInput = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.025, diametral: false, material: 'steel' }), 'pf radial 0.025');
    near(rInput.contactPressure, d.contactPressure, 'radial 0.025 gives the same p as diametral 0.05');
    // µm input path.
    const um = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference_um: 50, material: 'steel' }), 'pf 50 µm');
    near(um.contactPressure, 75, '50 µm diametral interference ⇒ p = 75 MPa');
  }

  // ─── PRESS FIT: dissimilar materials (steel hub, aluminum shaft) ────
  {
    const v = ok(pressFit({
      interfaceRadius: 25, outerRadius: 50, interference: 0.05,
      E_hub: 200000, E_shaft: 69000, nu: 0.3,
    }), 'pf steel hub / aluminum shaft');
    near(v.contactPressure, 50.0544, 'dissimilar-material p = 50.05 MPa');
    assert(v.contactPressure < 75, 'a softer (aluminum) shaft ⇒ LOWER contact pressure than all-steel');
    assert(v.contactPressure > 0, 'dissimilar-material contact pressure still positive');
    near(v.hubBoreHoop, 50.0544 * (2500 + 625) / (2500 - 625), 'dissimilar hub bore hoop = p·(ro²+rc²)/(ro²−rc²)');
    near(v.E_shaft, 69000, 'shaft E echoed = 69000 (aluminum)');
  }

  // ─── PRESS FIT: HOLLOW shaft exercises the ri≠0 branch ──────────────
  {
    const v = ok(pressFit({
      interfaceRadius: 25, outerRadius: 50, innerRadius: 10, // hollow shaft
      interference: 0.05, material: 'steel', length: 40, frictionCoefficient: 0.15,
    }), 'pf hollow shaft');
    near(v.contactPressure, 65.625, 'hollow-shaft p = 65.625 MPa (bore reduces stiffness ⇒ lower p)');
    assert(v.contactPressure < 75, 'a hollow shaft is more compliant ⇒ lower p than a solid one');
    near(v.hubBoreHoop, 109.375, 'hollow-shaft hub bore hoop = 109.375');
    near(v.shaftInterfaceHoop, -90.625, 'hollow-shaft interface hoop = −90.625');
    near(v.shaftBoreHoop, -156.25, 'hollow-shaft BORE hoop = −156.25 (more compressive than the interface)');
    assert(Math.abs(v.shaftBoreHoop) > Math.abs(v.shaftInterfaceHoop), 'hollow shaft: |bore hoop| > |interface hoop|');
    exact(v.hubRadialExpansion + v.shaftRadialContraction, 0.025, 'hollow: growth + shrink = δr = 0.025', 1e-5);
  }

  // ─── Torque only when an engagement length is supplied ──────────────
  {
    const noL = ok(pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.05, material: 'steel' }), 'pf no length');
    assert(noL.holdingTorque_Nmm === null && noL.axialHoldingForce_N === null, 'no engagement length ⇒ torque/force null');
    assert(noL.contactPressure > 0, 'stresses still computed without a length');
  }

  // ─── Validation: fail closed on bad geometry / inputs ───────────────
  {
    assert(!thickCylinder({ innerRadius: 100, outerRadius: 80 }).ok, 'reject outer ≤ inner');
    assert(!thickCylinder({ innerRadius: 0, outerRadius: 100, internalPressure: 10 }).ok, 'reject non-positive inner radius');
    assert(!thickCylinder({ innerRadius: 100, outerRadius: 200, internalPressure: Number.NaN as any }).ok, 'reject non-finite pressure');
    assert(!thickCylinder({ innerRadius: 100, outerRadius: 200, internalPressure: -5 }).ok, 'reject negative pressure');
    assert(!thickCylinderStressAt({ innerRadius: 100, outerRadius: 200, internalPressure: 100 }, 250).ok, 'reject radius outside the wall (too big)');
    assert(!thickCylinderStressAt({ innerRadius: 100, outerRadius: 200, internalPressure: 100 }, 50).ok, 'reject radius outside the wall (too small)');
    assert(!pressFit({ interfaceRadius: 25, innerRadius: 30, outerRadius: 50, interference: 0.05, material: 'steel' }).ok, 'reject interface ≤ shaft bore');
    assert(!pressFit({ interfaceRadius: 25, outerRadius: 20, interference: 0.05, material: 'steel' }).ok, 'reject hub outer ≤ interface');
    assert(!pressFit({ interfaceRadius: 25, outerRadius: 50, interference: -0.01, material: 'steel' }).ok, 'reject non-positive interference');
    assert(!pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.05 }).ok, 'reject missing modulus (no material/E)');
    assert(!pressFit({ interfaceRadius: 25, outerRadius: 50, interference: 0.05, material: 'steel', nu: 0.6 }).ok, 'reject Poisson ratio ≥ 0.5');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-thick-cylinder-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-thick-cylinder-core smoke cases passed.');
}

main();
