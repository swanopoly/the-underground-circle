/**
 * engineering-calc-core smoke.
 *
 * Unlike the generation cores (proven by round-trip or by running a real
 * engine), a calculation core is proven DIRECTLY: every formula is checked
 * against a hand-computed textbook reference. The smoke IS the proof. If a
 * reference below looks arbitrary, it isn't — each is worked out in the comment
 * so a reviewer can re-derive it.
 */

import {
  sectionRectangle, sectionCircle, sectionTube,
  beam, safetyFactor, boltPreload, tapDrill,
  ohmsLaw, ledResistor, combineResistors, voltageDivider, rcTimeConstant,
  convertUnit, materialProps, MATERIALS, gearPairTransmission, gearTrain, springRate,
  columnBuckling, shaftTorsion, thermalExpansion, pressureVessel,
} from '../src/lib/engineeringCalcCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
/** Assert a numeric value is within a relative/absolute tolerance of expected. */
function near(actual: number, expected: number, label: string, tol = 1e-3) {
  const ok = Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
  assert(ok, `${label} (got ${actual}, expected ≈ ${expected})`);
}
function ok<T extends { ok: boolean }>(r: T, label: string): T & { ok: true } {
  if (!r.ok) { failures.push(`${label}: not ok`); console.error(`FAIL: ${label} — result not ok`); process.exit(1); }
  return r as any;
}

function main() {
  // ─── Section properties ──────────────────────────────────────────
  {
    // Rectangle 20 wide × 40 tall: I = b·h³/12 = 20·64000/12 = 106666.67 mm⁴
    // S = I/(h/2) = 106666.67/20 = 5333.33 mm³; A = 800 mm²
    const r = ok(sectionRectangle(20, 40), 'rect');
    near(r.extra!.I_mm4, 106666.667, 'rect I');
    near(r.extra!.S_mm3, 5333.333, 'rect S');
    near(r.extra!.area_mm2, 800, 'rect A');

    // Circle d=20: I = π·20⁴/64 = π·160000/64 = 7853.98 mm⁴; A = π·100 = 314.159
    const c = ok(sectionCircle(20), 'circle');
    near(c.extra!.I_mm4, 7853.982, 'circle I');
    near(c.extra!.area_mm2, 314.159, 'circle A');

    // Tube od=30 id=20: I = π(30⁴−20⁴)/64 = π·650000/64 = 31906.80 mm⁴
    const t = ok(sectionTube(30, 20), 'tube');
    near(t.extra!.I_mm4, 31906.800, 'tube I');
    assert(!sectionTube(20, 30).ok, 'tube rejects id ≥ od');
    assert(!sectionRectangle(-1, 10).ok, 'rect rejects negative');
  }

  // ─── Beam: simply-supported, central point load ──────────────────
  {
    // P=1000 N, L=1000 mm, steel E=200000 MPa, rect 20×40 → I=106666.67, S=5333.33
    // Mmax = PL/4 = 250000 N·mm
    // δmax = PL³/(48EI) = 1000·1e9 / (48·200000·106666.67) = 1e12 / 1.024e12 = 0.97656 mm
    // σ = Mmax/S = 250000/5333.33 = 46.875 MPa
    const b = ok(beam({ support: 'simply_supported', load: 'point_center', magnitude: 1000, length: 1000, E: 200000, I: 106666.667, S: 5333.333 }), 'ss point beam');
    near(b.value, 0.976563, 'SS point δmax');
    near(b.extra!.max_moment_Nmm, 250000, 'SS point Mmax');
    near(b.extra!.max_bending_stress_MPa, 46.875, 'SS point bending stress');
    near(b.extra!.reaction_each_N, 500, 'SS point reactions');
  }

  // ─── Beam: cantilever, end point load ────────────────────────────
  {
    // P=500 N, L=800 mm, alu E=69000, I=50000 mm⁴
    // Mmax = PL = 400000 N·mm
    // δmax = PL³/(3EI) = 500·5.12e8 / (3·69000·50000) = 2.56e11 / 1.035e10 = 24.7343 mm
    const b = ok(beam({ support: 'cantilever', load: 'point_end', magnitude: 500, length: 800, E: 69000, I: 50000 }), 'cant point beam');
    near(b.extra!.max_moment_Nmm, 400000, 'cantilever Mmax');
    near(b.value, 24.7343, 'cantilever δmax', 2e-3);
  }

  // ─── Beam: simply-supported UDL ──────────────────────────────────
  {
    // w=2 N/mm, L=1000, E=200000, I=106666.67
    // Mmax = wL²/8 = 2·1e6/8 = 250000 N·mm
    // δmax = 5wL⁴/(384EI) = 5·2·1e12 / (384·200000·106666.67) = 1e13 / 8.192e12 = 1.2207 mm
    const b = ok(beam({ support: 'simply_supported', load: 'udl', magnitude: 2, length: 1000, E: 200000, I: 106666.667 }), 'ss udl beam');
    near(b.extra!.max_moment_Nmm, 250000, 'SS UDL Mmax');
    near(b.value, 1.220703, 'SS UDL δmax');
    near(b.extra!.reaction_each_N, 1000, 'SS UDL reactions (wL/2)');
  }

  // ─── Safety factor ───────────────────────────────────────────────
  {
    const sf = ok(safetyFactor(250, 46.875), 'sf');
    near(sf.value, 5.3333, 'SF = 250/46.875', 1e-3);
    const fail = ok(safetyFactor(100, 200), 'sf fail');
    assert(fail.value === 0.5 && fail.notes!.some((n) => /FAIL/.test(n)), 'SF<1 flags failure');
  }

  // ─── Bolt preload + tap drill ────────────────────────────────────
  {
    // T=20000 N·mm (20 N·m), d=8 mm, K=0.2 → F = 20000/(0.2·8) = 12500 N
    const bp = ok(boltPreload({ torque: 20000, diameter: 8 }), 'bolt');
    near(bp.value, 12500, 'bolt preload F');
    // M8 coarse: pitch 1.25, tap drill 6.8, clearance 9.0
    const td = ok(tapDrill('M8'), 'M8 tap');
    assert(td.value === 6.8, 'M8 tap drill = 6.8 mm');
    assert(td.extra!.clearance_hole_mm === 9.0, 'M8 clearance = 9.0 mm');
    assert(ok(tapDrill('m3'), 'M3').value === 2.5, 'M3 tap drill = 2.5 mm (case-insensitive)');
    assert(!tapDrill('M99').ok, 'unknown thread rejected');
  }

  // ─── Ohm's law ───────────────────────────────────────────────────
  {
    // 12 V, 100 Ω → I=0.12 A, P=1.44 W
    const r = ok(ohmsLaw({ voltage: 12, resistance: 100 }), 'ohm VR');
    near(r.extra!.current_A, 0.12, 'ohm I');
    near(r.extra!.power_W, 1.44, 'ohm P');
    // 0.5 A through 47 Ω → V=23.5, P=11.75
    const r2 = ok(ohmsLaw({ current: 0.5, resistance: 47 }), 'ohm IR');
    near(r2.extra!.voltage_V, 23.5, 'ohm V');
    assert(!ohmsLaw({ voltage: 5 }).ok, 'ohm needs two knowns');
  }

  // ─── LED resistor ────────────────────────────────────────────────
  {
    // 5 V supply, 2 V Vf, 20 mA → R = (5−2)/0.02 = 150 Ω, P = 3·0.02 = 0.06 W
    const r = ok(ledResistor({ supply: 5, forwardVoltage: 2, current: 0.02 }), 'led');
    near(r.value, 150, 'LED resistor');
    near(r.extra!.resistor_power_W, 0.06, 'LED resistor power');
    assert(!ledResistor({ supply: 2, forwardVoltage: 3, current: 0.02 }).ok, 'LED rejects Vf ≥ supply');
  }

  // ─── Series / parallel / divider / RC ────────────────────────────
  {
    near(ok(combineResistors([100, 220, 330], 'series'), 'series').value, 650, 'series sum');
    // parallel 100 ∥ 100 = 50
    near(ok(combineResistors([100, 100], 'parallel'), 'parallel').value, 50, 'parallel two equal');
    // divider: 10 V, R1=R2=1000 → 5 V
    near(ok(voltageDivider({ vin: 10, r1: 1000, r2: 1000 }), 'divider').value, 5, 'divider half');
    // RC: 1000 Ω · 100 µF = 0.1 s
    near(ok(rcTimeConstant({ resistance: 1000, capacitance: 100e-6 }), 'rc').value, 0.1, 'RC tau', 1e-6);
  }

  // ─── Unit conversion ─────────────────────────────────────────────
  {
    near(ok(convertUnit(1, 'in', 'mm'), 'in→mm').value, 25.4, 'inch to mm');
    near(ok(convertUnit(100, 'lbf', 'N'), 'lbf→N').value, 444.822, 'lbf to N', 1e-4);
    near(ok(convertUnit(1, 'ksi', 'MPa'), 'ksi→MPa').value, 6.89476, 'ksi to MPa', 1e-4);
    near(ok(convertUnit(20, 'Nm', 'Nmm'), 'Nm→Nmm').value, 20000, 'Nm to Nmm');
    assert(!convertUnit(1, 'mm', 'N').ok, 'cross-dimension conversion rejected');
    assert(!convertUnit(1, 'furlong', 'mm').ok, 'unknown unit rejected');
  }

  // ─── Spring rate (composes materials via shear modulus G) ────────
  {
    // d=2, D=20, n=10, steel G=79300 → k = 79300·16/(8·8000·10) = 1.9825 N/mm.
    const r = ok(springRate({ wireDiameter: 2, meanDiameter: 20, activeCoils: 10, material: 'steel' }), 'spring rate');
    near(r.value, 1.9825, 'k = G·d⁴/(8·D³·n) = 1.9825 N/mm');
    near(r.extra!.spring_index_D_over_d, 10, 'spring index D/d = 10');
    // Explicit G overrides material.
    const r2 = ok(springRate({ wireDiameter: 2, meanDiameter: 20, activeCoils: 10, shearModulus: 79300 }), 'explicit G');
    near(r2.value, 1.9825, 'explicit shear modulus gives the same rate');
    assert(!springRate({ wireDiameter: 20, meanDiameter: 10, activeCoils: 5, material: 'steel' }).ok, 'mean ≤ wire diameter rejected');
    assert(!springRate({ wireDiameter: 2, meanDiameter: 20, activeCoils: 10 }).ok, 'no material and no G rejected');
    // Every material now carries a shear modulus.
    assert(Object.values(MATERIALS).every((m) => m.G > 0), 'every material has a positive shear modulus G');
  }

  // ─── Gear pair transmission (composes the geometry lane) ─────────
  {
    // Z12:Z36 m2 → ratio 3, C = 2·48/2 = 48. 5 N·m @ 1500 rpm in → 15 N·m @ 500 rpm out.
    const g = ok(gearPairTransmission({ pinionTeeth: 12, gearTeeth: 36, module: 2, inputTorque_Nm: 5, inputSpeed_rpm: 1500 }), 'gear pair');
    near(g.value, 3, 'ratio = N₂/N₁ = 3');
    near(g.extra!.center_distance_mm, 48, 'center distance = m·(N₁+N₂)/2 = 48');
    near(g.extra!.output_torque_Nm, 15, 'output torque = input · ratio = 15 N·m');
    near(g.extra!.output_speed_rpm, 500, 'output speed = input / ratio = 500 rpm');
    assert(!gearPairTransmission({ pinionTeeth: 2, gearTeeth: 36, module: 2 }).ok, 'too-few pinion teeth rejected');
  }

  // ─── Gear train (compound, completes the gear lane) ──────────────
  {
    // two-stage 20:60 × 20:60 → train value 9; 1800 rpm in → 200 out.
    const t = ok(gearTrain({ stages: [{ driver: 20, driven: 60 }, { driver: 20, driven: 60 }], inputSpeed_rpm: 1800, inputTorque_Nm: 10 }), 'gear train');
    near(t.value, 9, 'train value = Π(driven/driver) = 3·3 = 9');
    near(t.extra!.output_speed_rpm, 200, 'output speed = input / TV = 200 rpm');
    near(t.extra!.output_torque_Nm, 90, 'output torque = input · TV = 90 N·m');
    // an idler cancels: 20→40→60 gives the same 3:1 as 20→60 direct.
    const idler = ok(gearTrain({ stages: [{ driver: 20, driven: 40 }, { driver: 40, driven: 60 }] }), 'idler train');
    near(idler.value, 3, 'idler cancels — overall ratio 60/20 = 3');
    // single stage matches the gear pair.
    near(ok(gearTrain({ stages: [{ driver: 20, driven: 60 }] }), 'single').value, gearPairTransmission({ pinionTeeth: 20, gearTeeth: 60, module: 2 }).ok ? 3 : -1, 'single-stage train = gear pair ratio');
    assert(!gearTrain({ stages: [] }).ok, 'empty train rejected');
    assert(!gearTrain({ stages: [{ driver: 2, driven: 60 }] }).ok, 'too-few teeth rejected');
  }

  // ─── Column buckling (composes the structural-section lane) ──────
  {
    // I=1e6 mm⁴, L=2000 mm, pinned (K=1), steel E=200000 → Pcr = π²·200000·1e6/2000² = π²·50000.
    const b = ok(columnBuckling({ momentOfInertia: 1e6, length: 2000, endCondition: 'pinned_pinned', material: 'steel', area: 1000 }), 'column buckling');
    near(b.value, Math.PI ** 2 * 50000, 'Pcr = π²·E·I/(K·L)²');
    near(b.extra!.critical_stress_MPa, (Math.PI ** 2 * 50000) / 1000, 'critical stress = Pcr/A');
    // fixed-free (K=2) buckles at a quarter of the pinned load.
    const cant = ok(columnBuckling({ momentOfInertia: 1e6, length: 2000, endCondition: 'fixed_free', E: 200000 }), 'cantilever column');
    near(cant.value, (Math.PI ** 2 * 50000) / 4, 'fixed-free Pcr = pinned/4 (K=2)');
    assert(!columnBuckling({ momentOfInertia: 1e6, length: 2000, endCondition: 'welded' }).ok, 'unknown end condition rejected');
    assert(!columnBuckling({ momentOfInertia: 1e6, length: 2000 } as any).ok, 'no E / material rejected');
  }

  // ─── Shaft torsion (composes materials shear modulus G) ──────────
  {
    // T=100000 N·mm, D=20 mm solid → J=π·20⁴/32=15707.96, τ=T·(D/2)/J=63.662 MPa = 16T/(πD³).
    const s = ok(shaftTorsion({ torque: 100000, diameter: 20, length: 500, material: 'steel' }), 'shaft torsion');
    near(s.value, 63.662, 'τ_max = 16T/(πD³) = 63.662 MPa');
    near(s.extra!.polar_moment_J_mm4, Math.PI * 20 ** 4 / 32, 'J = π·d⁴/32');
    // θ = TL/(GJ), steel G=79300 → 0.04014 rad = 2.300°.
    near(s.extra!.angle_of_twist_deg, ((100000 * 500) / (79300 * (Math.PI * 20 ** 4 / 32))) * 180 / Math.PI, 'angle of twist = TL/(GJ)');
    assert(!shaftTorsion({ torque: 100000, diameter: 20, innerDiameter: 25 }).ok, 'id ≥ od rejected');
  }

  // ─── Thermal expansion (composes materials α) ────────────────────
  {
    // steel α=12e-6, L=1000, ΔT=50 → ΔL=0.6 mm; constrained stress E·α·ΔT=120 MPa.
    const th = ok(thermalExpansion({ length: 1000, deltaT: 50, material: 'steel' }), 'thermal');
    near(th.value, 0.6, 'ΔL = α·L·ΔT = 0.6 mm');
    near(th.extra!.constrained_stress_MPa, 120, 'constrained stress = E·α·ΔT = 120 MPa');
    // cooling gives negative ΔL.
    near(ok(thermalExpansion({ length: 1000, deltaT: -50, material: 'steel' }), 'cool').value, -0.6, 'cooling → ΔL negative');
    assert(Object.values(MATERIALS).every((m) => m.alpha > 0), 'every material has a positive thermal expansion α');
  }

  // ─── Thin-wall pressure vessel ───────────────────────────────────
  {
    // p=2 MPa, r=500, t=10 → hoop=pr/t=100, long=pr/2t=50.
    const pv = ok(pressureVessel({ pressure: 2, innerRadius: 500, wallThickness: 10 }), 'pressure vessel');
    near(pv.value, 100, 'hoop stress = p·r/t = 100 MPa');
    near(pv.extra!.longitudinal_stress_MPa, 50, 'longitudinal = p·r/(2t) = 50 MPa (half of hoop)');
    // diameter form matches radius form.
    near(ok(pressureVessel({ pressure: 2, innerDiameter: 1000, wallThickness: 10 }), 'pv by dia').value, 100, 'innerDiameter form = innerRadius form');
  }

  // ─── Materials ───────────────────────────────────────────────────
  {
    const m = ok(materialProps('aluminum'), 'alu');
    assert(m.extra!.E_MPa === 69000, 'aluminum E = 69000 MPa');
    assert(m.extra!.alpha_per_C === 23.6e-6, 'aluminum α = 23.6e-6 /°C');
    assert(Object.keys(MATERIALS).length >= 5, 'material table has the common set');
    assert(!materialProps('unobtanium').ok, 'unknown material rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-calc-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-calc-core smoke cases passed.');
}

main();
