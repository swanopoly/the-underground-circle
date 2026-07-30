/**
 * engineering-belt-drive-core smoke.
 *
 * Pins the belt-drive geometry (speed ratio = diameter ratio, the open-belt
 * length, the small-pulley wrap angle) against hand computation, the invariant
 * that the two wrap angles sum to 360°, and the friction physics: the capstan
 * tension ratio T1/T2 = e^(μθ), a V-belt wedging to a far higher ratio than a
 * flat belt, and the transmissible power (T1−T2)·V.
 */

import { beltDrive } from '../src/lib/engineeringBeltDriveCore';

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
  // ─── Geometry: ratio, belt length, wrap angles ───────────────────
  {
    // D1=100 (driver), D2=200 (driven), C=400.
    const b = ok(beltDrive({ driverDiameter: 100, drivenDiameter: 200, centreDistance: 400, driverSpeed_rpm: 1000 }), 'geometry');
    near(b.speedRatio, 100 / 200, 'speed ratio = D_driver/D_driven = 0.5');
    near(b.drivenSpeed_rpm!, 500, 'driven runs at half speed = 500 rpm');
    // L = 2C + (π/2)(D+d) + (D−d)²/4C.
    near(b.beltLength, 2 * 400 + (Math.PI / 2) * 300 + (100 ** 2) / (4 * 400), 'open-belt length formula = 1277.49 mm');
    // wrap on the small pulley: π − 2·asin((D−d)/2C).
    near(b.wrapAngleSmall_deg, (Math.PI - 2 * Math.asin(100 / 800)) * 180 / Math.PI, 'small-pulley wrap = 165.6°');
    // the two wraps are supplementary around 360°.
    near(b.wrapAngleSmall_deg + b.wrapAngleLarge_deg, 360, 'wrap angles sum to 360°');
    assert(b.wrapAngleSmall_deg < 180 && b.wrapAngleLarge_deg > 180, 'small pulley wraps less than 180°, large more');
    // belt speed = π·D1·n1.
    near(b.beltSpeed_m_s!, (Math.PI * 0.1) * (1000 / 60), 'belt speed = π·D1·n1 = 5.236 m/s');
  }

  // ─── The capstan tension ratio ───────────────────────────────────
  {
    const flat = ok(beltDrive({ driverDiameter: 100, drivenDiameter: 200, centreDistance: 400, frictionCoeff: 0.3 }), 'flat');
    const wrapRad = flat.wrapAngleSmall_deg * Math.PI / 180;
    near(flat.tensionRatio!, Math.exp(0.3 * wrapRad), 'flat belt T1/T2 = e^(μθ)');
    near(flat.effectiveFriction!, 0.3, 'flat belt effective friction = μ');
    // a V-belt wedges: effective friction μ/sinβ, far higher ratio.
    const vee = ok(beltDrive({ driverDiameter: 100, drivenDiameter: 200, centreDistance: 400, frictionCoeff: 0.3, grooveHalfAngle_deg: 18 }), 'V-belt');
    near(vee.effectiveFriction!, 0.3 / Math.sin(18 * Math.PI / 180), 'V-belt effective friction = μ/sinβ');
    assert(vee.tensionRatio! > flat.tensionRatio! * 3, 'a V-belt grips far harder than a flat belt (≈ 3×+ tension ratio)');
  }

  // ─── Transmissible power ─────────────────────────────────────────
  {
    const p = ok(beltDrive({ driverDiameter: 100, drivenDiameter: 200, centreDistance: 400, driverSpeed_rpm: 1000, frictionCoeff: 0.3, tightSideTension_N: 1000 }), 'power');
    const T2 = 1000 / p.tensionRatio!;
    near(p.slackSideTension_N!, T2, 'slack tension = T1 / (T1/T2)');
    near(p.maxPower_kW!, (1000 - T2) * p.beltSpeed_m_s! / 1000, 'max power = (T1 − T2)·V');
    assert(p.maxPower_kW! > 0, 'positive transmissible power');
  }

  // ─── Symmetry + validation ───────────────────────────────────────
  {
    // swapping driver/driven inverts the speed ratio.
    const up = ok(beltDrive({ driverDiameter: 200, drivenDiameter: 100, centreDistance: 400, driverSpeed_rpm: 1000 }), 'overdrive');
    near(up.speedRatio, 2, 'big driver → driven overspeeds (ratio 2)');
    near(up.drivenSpeed_rpm!, 2000, 'driven runs at 2000 rpm');
    // belt length is the same regardless of which pulley drives.
    const a = ok(beltDrive({ driverDiameter: 100, drivenDiameter: 200, centreDistance: 400 }), 'a');
    near(a.beltLength, up.beltLength, 'belt length is independent of drive direction');
    assert(!beltDrive({ driverDiameter: 100, drivenDiameter: 500, centreDistance: 50 }).ok, 'centre distance too small rejected');
    assert(!beltDrive({ driverDiameter: 100, centreDistance: 400 } as any).ok, 'missing driven diameter rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-belt-drive-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-belt-drive-core smoke cases passed.');
}

main();
