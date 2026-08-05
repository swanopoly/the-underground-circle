/**
 * engineering-clutch-brake-core smoke.
 *
 * Friction clutch & brake torque, pinned against hand computation and against the
 * suite's own primitives:
 *
 *  • THE DUALITY (like sheet-metal's two developed lengths). A disc clutch has TWO
 *    torque models — uniform pressure (new) and uniform wear (worn-in). For the
 *    textbook case ro=100, ri=50, F=2000, μ=0.3, single plate (n=2 faces):
 *      uniform WEAR      T = (1/2)μFn(ro+ri)             = 0.5·0.3·2000·2·150      = 90 000 N·mm = 90 N·m
 *      uniform PRESSURE  T = (2/3)μFn(ro³−ri³)/(ro²−ri²) = (2/3)·0.3·2000·2·116.667 = 93 333 N·mm = 93.333 N·m
 *    Wear is ALWAYS the lower (ratio 90000/93333 = 0.96429 = 3(1+x)²/[4(1+x+x²)]
 *    at x=ri/ro=0.5), so a clutch is DESIGNED on the wear torque. A solid disc
 *    (ri=0) gives the classic 3/4 ratio.
 *
 *  • THIN-RING LIMIT. As ri → ro the two models converge: both effective radii →
 *    the common radius R and both torques → μ·F·n·R.
 *
 *  • BAND BRAKE = CAPSTAN. T1/T2 = e^(μθ) exactly (pinned at μ=0.3, θ=270° →
 *    e^(0.3·4.712) = 4.1112), so doubling the wrap SQUARES the ratio; torque =
 *    (T1−T2)·rd.
 *
 *  • CONE CLUTCH = V-WEDGE. Torque = flat-clutch torque / sin(α); α=90° (flat plate)
 *    reduces to the disc clutch; a shallow cone multiplies torque by 1/sin(α).
 *
 * The smoke IS the proof.
 */

import { discClutch, bandBrake, coneClutch } from '../src/lib/engineeringClutchBrakeCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

function main() {
  // ─── 1. Disc clutch: the textbook case + the wear<pressure DUALITY ───
  {
    // ro=100, ri=50, F=2000, μ=0.3, single dry plate → n=2 faces.
    const d = ok(discClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, surfaces: 2 }), 'disc textbook');
    // Uniform wear: (1/2)·0.3·2000·2·(100+50) = 90 000 N·mm = 90 N·m.
    near(d.uniformWearTorque_Nmm, 90000, 'uniform-wear T = (1/2)μFn(ro+ri) = 90 000 N·mm');
    near(d.uniformWearTorque_Nm, 90, 'uniform-wear T = 90 N·m');
    near(d.uniformWearMeanRadius_mm, 75, 'uniform-wear mean radius = (ro+ri)/2 = 75 mm');
    // Uniform pressure: (2/3)·0.3·2000·2·(875000/7500) = 93 333.33 N·mm.
    near(d.uniformPressureTorque_Nmm, 93333.333, 'uniform-pressure T = (2/3)μFn(ro³−ri³)/(ro²−ri²) = 93 333 N·mm');
    near(d.uniformPressureTorque_Nm, 93.333, 'uniform-pressure T = 93.333 N·m');
    near(d.uniformPressureMeanRadius_mm, 77.7778, 'uniform-pressure effective radius = (2/3)(ro³−ri³)/(ro²−ri²) = 77.78 mm');

    // THE DUALITY anchor: wear < pressure ALWAYS (for ri<ro), and pin the ratio.
    assert(d.uniformWearTorque_Nm < d.uniformPressureTorque_Nm, 'DUALITY: uniform-wear torque < uniform-pressure torque');
    assert(d.lowerModel === 'uniform_wear', 'the lower (design) model is uniform_wear');
    near(d.designTorque_Nm, 90, 'designTorque = the lower (uniform-wear) value = 90 N·m');
    near(d.wearToPressureRatio, 0.964286, 'wear/pressure ratio = 3(1+x)²/[4(1+x+x²)] at x=0.5 = 0.96429');
    // Torque = μ·F·n·(effective radius) — the two models differ only in that radius.
    near(d.uniformWearTorque_Nmm, 0.3 * 2000 * 2 * d.uniformWearMeanRadius_mm, 'wear T = μFn·R_wear');
    near(d.uniformPressureTorque_Nmm, 0.3 * 2000 * 2 * d.uniformPressureMeanRadius_mm, 'pressure T = μFn·R_pressure');
    assert(d.uniformPressureMeanRadius_mm > d.uniformWearMeanRadius_mm, 'uniform-pressure effective radius sits outside the wear mean radius');
  }

  // ─── Disc clutch: n scales torque, single face default ───────────────
  {
    const n1 = ok(discClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3 }), 'disc default n');
    assert(n1.surfaces === 1, 'surfaces defaults to 1');
    near(n1.uniformWearTorque_Nmm, 45000, 'single face → 45 000 N·mm (half of the 2-face value)');
    const n4 = ok(discClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, surfaces: 4 }), 'disc 4 faces');
    near(n4.uniformWearTorque_Nmm, 180000, '4 rubbing faces → 4× the single-face torque');
    near(n4.uniformWearTorque_Nmm / n1.uniformWearTorque_Nmm, 4, 'torque is linear in the number of surfaces');
  }

  // ─── Disc clutch: SOLID disc → the classic 3/4 ratio ─────────────────
  {
    const s = ok(discClutch({ outerRadius: 100, innerRadius: 0, axialForce: 1000, frictionCoeff: 0.3 }), 'solid disc');
    near(s.uniformWearTorque_Nmm, 15000, 'solid uniform-wear T = (1/2)μF·ro = 15 000 N·mm');
    near(s.uniformPressureTorque_Nmm, 20000, 'solid uniform-pressure T = (2/3)μF·ro = 20 000 N·mm');
    near(s.wearToPressureRatio, 0.75, 'solid disc wear/pressure ratio = 3/4 exactly');
    near(s.uniformWearMeanRadius_mm, 50, 'solid wear radius = ro/2 = 50');
    near(s.uniformPressureMeanRadius_mm, 66.6667, 'solid pressure radius = (2/3)ro = 66.67');
  }

  // ─── Disc clutch: THIN-RING LIMIT (both models converge) ─────────────
  {
    // ri=99.9, ro=100 → a narrow friction ring at R ≈ 99.95.
    const t = ok(discClutch({ outerRadius: 100, innerRadius: 99.9, axialForce: 1000, frictionCoeff: 0.3 }), 'thin ring');
    const R = (100 + 99.9) / 2; // 99.95
    near(t.uniformWearMeanRadius_mm, R, 'thin-ring wear radius → R = 99.95');
    near(t.uniformPressureMeanRadius_mm, R, 'thin-ring pressure radius → R (models converge)');
    near(t.uniformWearMeanRadius_mm, t.uniformPressureMeanRadius_mm, 'THIN-RING LIMIT: the two effective radii agree');
    near(t.uniformWearTorque_Nmm, 0.3 * 1000 * 1 * R, 'thin-ring wear T → μ·F·n·R');
    near(t.uniformPressureTorque_Nmm, 0.3 * 1000 * 1 * R, 'thin-ring pressure T → μ·F·n·R');
    near(t.wearToPressureRatio, 1, 'THIN-RING LIMIT: wear/pressure ratio → 1');
    assert(t.wearToPressureRatio <= 1 + 1e-9, 'wear ≤ pressure holds right up to the limit');
  }

  // ─── Disc clutch: the ordering holds across many geometries ──────────
  {
    for (const ri of [0, 10, 25, 40, 60, 80, 95]) {
      const d = ok(discClutch({ outerRadius: 100, innerRadius: ri, axialForce: 1500, frictionCoeff: 0.35, surfaces: 2 }), `ordering ri=${ri}`);
      assert(d.uniformWearTorque_Nm <= d.uniformPressureTorque_Nm + 1e-9, `wear ≤ pressure at ri=${ri}`);
      assert(d.wearToPressureRatio <= 1 + 1e-9 && d.wearToPressureRatio >= 0.74, `ratio in [3/4, 1] at ri=${ri}`);
    }
  }

  // ─── 2. Band brake: the CAPSTAN cross-check T1/T2 = e^(μθ) ────────────
  {
    // μ=0.3, θ=270°, rd=150 mm, tight side T1=2000 N.
    const b = ok(bandBrake({ drumRadius: 150, frictionCoeff: 0.3, wrapAngle_deg: 270, tightSideTension_N: 2000 }), 'band 270°');
    const thetaRad = 270 * Math.PI / 180;
    near(b.wrapAngle_rad, thetaRad, 'wrap 270° → 4.712 rad');
    near(b.tensionRatio, Math.exp(0.3 * thetaRad), 'CAPSTAN: T1/T2 = e^(μθ) = e^(0.3·4.712)');
    near(b.tensionRatio, 4.111207, 'tension ratio pinned = 4.1112');
    near(b.tightSideTension_N, 2000, 'tight side T1 = 2000 N (given)');
    near(b.slackSideTension_N, 2000 / b.tensionRatio, 'slack side T2 = T1 / e^(μθ)');
    near(b.brakingTorque_Nmm, (b.tightSideTension_N - b.slackSideTension_N) * 150, 'braking torque = (T1−T2)·rd');
    near(b.brakingTorque_Nm, (2000 - 2000 / b.tensionRatio) * 150 / 1000, 'braking torque in N·m');
    assert(b.tightSideTension_N > b.slackSideTension_N, 'tight side carries more tension than the slack side');
  }

  // ─── Band brake: EXPONENTIAL in wrap → doubling θ SQUARES the ratio ───
  {
    const w90 = ok(bandBrake({ drumRadius: 100, frictionCoeff: 0.25, wrapAngle_deg: 90, slackSideTension_N: 100 }), 'wrap 90°');
    const w180 = ok(bandBrake({ drumRadius: 100, frictionCoeff: 0.25, wrapAngle_deg: 180, slackSideTension_N: 100 }), 'wrap 180°');
    const w270 = ok(bandBrake({ drumRadius: 100, frictionCoeff: 0.25, wrapAngle_deg: 270, slackSideTension_N: 100 }), 'wrap 270°');
    const w540 = ok(bandBrake({ drumRadius: 100, frictionCoeff: 0.25, wrapAngle_deg: 540, slackSideTension_N: 100 }), 'wrap 540°');
    assert(w180.tensionRatio > w90.tensionRatio && w270.tensionRatio > w180.tensionRatio, 'more wrap → exponentially more grip');
    near(w180.tensionRatio, w90.tensionRatio ** 2, 'doubling wrap (90→180) SQUARES the tension ratio');
    near(w540.tensionRatio, w270.tensionRatio ** 2, 'doubling wrap (270→540) SQUARES the tension ratio');
    // More grip at fixed slack tension → more retained tight tension → more torque.
    assert(w270.brakingTorque_Nm > w90.brakingTorque_Nm, 'more wrap → more braking torque at fixed actuating tension');
  }

  // ─── Band brake: giving the slack side recovers the same state ───────
  {
    const fromT1 = ok(bandBrake({ drumRadius: 120, frictionCoeff: 0.3, wrapAngle_deg: 220, tightSideTension_N: 1500 }), 'from T1');
    const fromT2 = ok(bandBrake({ drumRadius: 120, frictionCoeff: 0.3, wrapAngle_deg: 220, slackSideTension_N: fromT1.slackSideTension_N }), 'from T2');
    near(fromT2.tightSideTension_N, 1500, 'supplying the slack side recovers T1 = 1500 N');
    near(fromT2.brakingTorque_Nm, fromT1.brakingTorque_Nm, 'same torque whichever tension is given');
  }

  // ─── Band brake: radians input matches degrees input ─────────────────
  {
    const deg = ok(bandBrake({ drumRadius: 100, frictionCoeff: 0.2, wrapAngle_deg: 180, tightSideTension_N: 800 }), 'deg form');
    const rad = ok(bandBrake({ drumRadius: 100, frictionCoeff: 0.2, wrapAngle_rad: Math.PI, tightSideTension_N: 800 }), 'rad form');
    near(rad.tensionRatio, deg.tensionRatio, 'wrapAngle_rad=π matches wrapAngle_deg=180');
    near(rad.brakingTorque_Nm, deg.brakingTorque_Nm, 'same torque from radians or degrees');
    near(deg.tensionRatio, Math.exp(0.2 * Math.PI), '180° tension ratio = e^(0.2π)');
  }

  // ─── 3. Cone clutch: the V-WEDGE 1/sin(α) amplification ───────────────
  {
    // ro=100, ri=50, F=2000, μ=0.3, n=1, α=12°.
    const c = ok(coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 12 }), 'cone 12°');
    const sin12 = Math.sin(12 * Math.PI / 180);
    near(c.amplificationFactor, 1 / sin12, 'amplification = 1/sin(α) = 1/sin(12°) = 4.8097');
    near(c.meanRadius_mm, 75, 'cone mean radius = (ro+ri)/2 = 75');
    near(c.normalForce_N, 2000 / sin12, 'normal force = F/sin(α) = 9619 N (wedge amplified)');
    near(c.faceWidth_mm, 50 / sin12, 'cone face width = (ro−ri)/sin(α) = 240.5 mm');
    // Cone uniform-wear torque = flat clutch torque / sin(α).
    const flat = 0.5 * 0.3 * 2000 * 1 * 150; // 45 000 N·mm
    near(c.flatClutchTorque_Nm, flat / 1000, 'flat-clutch (α=90°) torque = 45 N·m');
    near(c.uniformWearTorque_Nmm, flat / sin12, 'cone T = flat-clutch T / sin(α)');
    near(c.uniformWearTorque_Nm, 216.438, 'cone uniform-wear torque = 216.44 N·m');
    near(c.uniformWearTorque_Nm, c.flatClutchTorque_Nm * c.amplificationFactor, 'cone T = flat T · (1/sinα)');
    assert(c.uniformWearTorque_Nm > c.flatClutchTorque_Nm, 'a cone clutch out-torques a flat clutch for the same axial force');
    // Cone pressure model also carries the same wedge factor and stays above wear.
    assert(c.uniformPressureTorque_Nm > c.uniformWearTorque_Nm, 'cone pressure torque > wear torque (same duality)');
  }

  // ─── Cone clutch: α=90° is the LIMITING flat-plate case = disc clutch ─
  {
    const flatPlate = ok(coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 90, surfaces: 2 }), 'cone 90°');
    const disc = ok(discClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, surfaces: 2 }), 'disc for cone-limit');
    near(flatPlate.amplificationFactor, 1, 'α=90° → amplification = 1/sin(90°) = 1');
    near(flatPlate.uniformWearTorque_Nm, disc.uniformWearTorque_Nm, 'LIMITING CASE: cone at α=90° == disc clutch (uniform wear)');
    near(flatPlate.uniformPressureTorque_Nm, disc.uniformPressureTorque_Nm, 'cone at α=90° == disc clutch (uniform pressure)');
    near(flatPlate.uniformWearTorque_Nm, 90, 'flat cone torque = the 90 N·m disc value');
  }

  // ─── Cone clutch: smaller α → larger amplification (monotonic) ───────
  {
    const a6 = ok(coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 6 }), 'cone 6°');
    const a12 = ok(coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 12 }), 'cone 12°');
    const a30 = ok(coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 30 }), 'cone 30°');
    const a90 = ok(coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 90 }), 'cone 90°');
    assert(a6.amplificationFactor > a12.amplificationFactor, 'shallower cone (6°) amplifies more than 12°');
    assert(a12.amplificationFactor > a30.amplificationFactor, '12° amplifies more than 30°');
    assert(a30.amplificationFactor > a90.amplificationFactor, '30° amplifies more than the flat 90°');
    near(a30.amplificationFactor, 1 / Math.sin(30 * Math.PI / 180), '30° amplification = 1/sin30 = 2 exactly');
    near(a30.amplificationFactor, 2, 'α=30° → torque doubles vs a flat clutch');
    assert(a6.uniformWearTorque_Nm > a12.uniformWearTorque_Nm && a12.uniformWearTorque_Nm > a30.uniformWearTorque_Nm, 'shallower cone → more torque');
  }

  // ─── Validation: reject bad inputs across all three ──────────────────
  {
    assert(!discClutch({ outerRadius: 50, innerRadius: 50, axialForce: 1000, frictionCoeff: 0.3 }).ok, 'disc: ri = ro rejected');
    assert(!discClutch({ outerRadius: 50, innerRadius: 60, axialForce: 1000, frictionCoeff: 0.3 }).ok, 'disc: ri > ro rejected');
    assert(!discClutch({ outerRadius: -50, innerRadius: 10, axialForce: 1000, frictionCoeff: 0.3 }).ok, 'disc: negative outer radius rejected');
    assert(!discClutch({ outerRadius: 50, innerRadius: 10, axialForce: 0, frictionCoeff: 0.3 }).ok, 'disc: zero force rejected');
    assert(discClutch({ outerRadius: 50, innerRadius: 0, axialForce: 1000, frictionCoeff: 0.3 }).ok, 'disc: solid disc (ri=0) accepted');

    assert(!bandBrake({ drumRadius: 100, frictionCoeff: 0.3, tightSideTension_N: 1000 }).ok, 'band: missing wrap angle rejected');
    assert(!bandBrake({ drumRadius: 100, frictionCoeff: 0.3, wrapAngle_deg: 180, wrapAngle_rad: 3.14, tightSideTension_N: 1000 }).ok, 'band: both wrap forms rejected');
    assert(!bandBrake({ drumRadius: 100, frictionCoeff: 0.3, wrapAngle_deg: 180 }).ok, 'band: no tension given rejected');
    assert(!bandBrake({ drumRadius: 100, frictionCoeff: 0.3, wrapAngle_deg: 180, tightSideTension_N: 1000, slackSideTension_N: 500 }).ok, 'band: both tensions given rejected');
    assert(!bandBrake({ drumRadius: 0, frictionCoeff: 0.3, wrapAngle_deg: 180, tightSideTension_N: 1000 }).ok, 'band: zero drum radius rejected');

    assert(!coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 0 }).ok, 'cone: α=0 rejected');
    assert(!coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 120 }).ok, 'cone: α>90° rejected');
    assert(!coneClutch({ outerRadius: 100, innerRadius: 100, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 12 }).ok, 'cone: ri = ro rejected');
    assert(coneClutch({ outerRadius: 100, innerRadius: 50, axialForce: 2000, frictionCoeff: 0.3, halfAngle_deg: 90 }).ok, 'cone: α=90° (flat plate) accepted');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-clutch-brake-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-clutch-brake-core smoke cases passed.');
}

main();
