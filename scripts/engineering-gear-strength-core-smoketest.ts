/**
 * engineering-gear-strength-core smoke.
 *
 * Gear tooth strength (Lewis bending) is closed-form once the form factor Y is
 * known, so it is proven DIRECTLY — every number below is worked out by hand in
 * the comment and asserted, and the smoke IS the proof (no app, no mesh). The
 * tangential load links torque/power to the tooth force (Ft = T/r, T = P/ω), the
 * Lewis equation σ = Ft/(F·m·Y) turns that into a root bending stress, and
 * inverting it sizes the face width against an allowable. The physics identities
 * (P = Ft·v; more torque → more Ft → more stress → wider face) are pinned too.
 */

import {
  tangentialLoad, lewisBendingStress, sizeFaceWidth, lewisFormFactor, LEWIS_Y,
} from '../src/lib/engineeringGearStrengthCore';
import { MATERIALS } from '../src/lib/engineeringCalcCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
/** Assert a numeric value is within a relative/absolute tolerance of expected. */
function near(actual: number, expected: number, label: string, tol = 1e-3) {
  const okv = Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
  assert(okv, `${label} (got ${actual}, expected ≈ ${expected})`);
}
function ok<T extends { ok: boolean }>(r: T, label: string): T & { ok: true } {
  if (!r.ok) { failures.push(`${label}: not ok`); console.error(`FAIL: ${label} — result not ok`); process.exit(1); }
  return r as any;
}

function main() {
  // ─── Tangential load from torque ─────────────────────────────────
  {
    // m=3, N=40, T=100 N·m → d = m·N = 120 mm, r = 60 mm.
    // Ft = T/r = 100000 N·mm / 60 mm = 1666.6667 N.
    const t = ok(tangentialLoad({ module: 3, teeth: 40, torque_Nm: 100 }), 'Ft from torque');
    near(t.value, 100000 / 60, 'Ft = T/r = 1666.667 N');
    near(t.extra!.pitch_diameter_mm, 120, 'pitch diameter d = m·N = 120 mm');
    near(t.extra!.pitch_radius_mm, 60, 'pitch radius r = d/2 = 60 mm');
    near(t.extra!.torque_Nm, 100, 'torque echoed = 100 N·m');
  }

  // ─── Tangential load from power + speed, and P = Ft·v ─────────────
  {
    // Choose power so T is exactly 100 N·m at 1500 rpm: P = T·ω = 100·(2π·1500/60).
    const rpm = 1500;
    const omega = (2 * Math.PI * rpm) / 60; // 157.0796 rad/s
    const power = 100 * omega; // 15707.96 W
    const t = ok(tangentialLoad({ module: 3, teeth: 40, power_W: power, speed_rpm: rpm }), 'Ft from power');
    near(t.value, 100000 / 60, 'power path → same Ft = 1666.667 N (T = P/ω = 100 N·m)');
    // Pitch-line velocity v = π·d·n = π·0.12·(1500/60) = π·3 = 9.42478 m/s.
    near(t.extra!.pitch_line_velocity_m_s, Math.PI * 3, 'v = π·d·n = 9.42478 m/s');
    // The transmitted power must round-trip: P = Ft·v.
    near(t.extra!.transmitted_power_W, power, 'P = Ft·v recovers the input power');
  }

  // ─── Pitch-line velocity from a torque-specified gear ────────────
  {
    // Velocity depends only on d and n, so it is reported even in torque mode.
    const t = ok(tangentialLoad({ module: 3, teeth: 40, torque_Nm: 50, speed_rpm: 1500 }), 'velocity in torque mode');
    near(t.extra!.pitch_line_velocity_m_s, Math.PI * 3, 'v = 9.42478 m/s independent of torque');
  }

  // ─── Tangential-load validation ──────────────────────────────────
  {
    assert(!tangentialLoad({ module: 3, teeth: 40 } as any).ok, 'missing torque and power rejected');
    assert(!tangentialLoad({ module: 3, teeth: 40, torque_Nm: -100 }).ok, 'negative torque rejected');
    assert(!tangentialLoad({ module: -3, teeth: 40, torque_Nm: 100 }).ok, 'negative module rejected');
    assert(!tangentialLoad({ module: 3, teeth: 0, torque_Nm: 100 }).ok, 'zero teeth rejected');
    assert(!tangentialLoad({ module: 3, teeth: 40, power_W: 1000 }).ok, 'power without speed rejected');
  }

  // ─── Lewis form factor table ─────────────────────────────────────
  {
    assert(lewisFormFactor(40) === 0.389, 'Y(40) = 0.389 (exact table entry)');
    assert(lewisFormFactor(20) === 0.320, 'Y(20) = 0.320 (exact table entry)');
    // Interpolate 35: between 30→0.358 and 40→0.389 → 0.358 + 0.5·0.031 = 0.3735.
    near(lewisFormFactor(35), 0.358 + 0.5 * (0.389 - 0.358), 'Y(35) interpolated = 0.3735');
    assert(lewisFormFactor(8) === 0.245, 'Y clamps below the table to 0.245');
    assert(lewisFormFactor(200) === 0.446, 'Y clamps above the table to 0.446');
    // Monotone increasing: more teeth → fatter, stronger tooth → larger Y.
    let mono = true;
    for (let i = 1; i < LEWIS_Y.length; i += 1) if (LEWIS_Y[i][1] <= LEWIS_Y[i - 1][1]) mono = false;
    assert(mono, 'Lewis Y increases with tooth count');
  }

  // ─── Lewis bending stress ────────────────────────────────────────
  {
    // m=3, F=30, N=40 (Y=0.389), Ft=1000 → σ = 1000/(30·3·0.389) = 1000/35.01 = 28.5633 MPa.
    const s = ok(lewisBendingStress({ module: 3, faceWidth: 30, teeth: 40, tangentialLoad: 1000 }), 'Lewis σ direct Ft');
    near(s.value, 1000 / (30 * 3 * 0.389), 'σ = Ft/(F·m·Y) = 28.5633 MPa');
    assert(s.extra!.lewis_Y === 0.389, 'Y=0.389 reported for 40 teeth');

    // Same tooth via torque: m=3,F=30,N=40,T=100 → Ft=1666.667 → σ=1666.667/35.01=47.6054 MPa.
    const s2 = ok(lewisBendingStress({ module: 3, faceWidth: 30, teeth: 40, torque_Nm: 100 }), 'Lewis σ from torque');
    near(s2.value, (100000 / 60) / (30 * 3 * 0.389), 'σ from torque = 47.6054 MPa');
    near(s2.extra!.tangential_load_N, 100000 / 60, 'Ft derived = 1666.667 N');

    // Monotonic physics: more torque → more stress; wider face → less stress.
    const sLo = ok(lewisBendingStress({ module: 3, faceWidth: 30, teeth: 40, torque_Nm: 100 }), 'σ @ T=100');
    const sHi = ok(lewisBendingStress({ module: 3, faceWidth: 30, teeth: 40, torque_Nm: 200 }), 'σ @ T=200');
    assert(sHi.value > sLo.value, 'more torque → more Ft → more stress');
    near(sHi.value, 2 * sLo.value, 'doubling torque doubles stress');
    const sWide = ok(lewisBendingStress({ module: 3, faceWidth: 60, teeth: 40, torque_Nm: 100 }), 'σ wide face');
    assert(sWide.value < sLo.value, 'wider face → lower stress');
    near(sWide.value, sLo.value / 2, 'doubling face width halves stress');

    assert(!lewisBendingStress({ module: 3, faceWidth: -30, teeth: 40, tangentialLoad: 1000 }).ok, 'negative face width rejected');
  }

  // ─── Face-width sizing (invert Lewis) ────────────────────────────
  {
    // σ_allow=120, Ft=1666.667, m=3, N=40 (Y=0.389):
    // F_req = Ft/(σ_allow·m·Y) = 1666.667/(120·3·0.389) = 1666.667/140.04 = 11.901 → chosen 12.
    const Ft = 100000 / 60;
    const z = ok(sizeFaceWidth({ module: 3, teeth: 40, tangentialLoad: Ft, allowableStress: 120 }), 'size face width');
    near(z.extra!.required_face_width_mm, Ft / (120 * 3 * 0.389), 'required F = 11.901 mm');
    assert(z.value === 12, 'chosen face width rounds up to 12 mm');
    assert(z.extra!.realized_stress_MPa < 120, 'realised stress < allowable (rounded up)');
    near(z.extra!.realized_stress_MPa, Ft / (12 * 3 * 0.389), 'realised σ = 119.02 MPa at F=12');

    // Same via torque input rather than explicit Ft.
    const z2 = ok(sizeFaceWidth({ module: 3, teeth: 40, torque_Nm: 100, allowableStress: 120 }), 'size via torque');
    assert(z2.value === 12, 'torque-driven sizing also chooses 12 mm');

    // Material path: steel yield 250, SF 2 → allowable 125 MPa.
    const zm = ok(sizeFaceWidth({ module: 3, teeth: 40, tangentialLoad: Ft, material: 'steel', safetyFactor: 2 }), 'size via material');
    near(zm.extra!.allowable_stress_MPa, MATERIALS.steel.yield / 2, 'allowable = yield/SF = 125 MPa');
    near(zm.extra!.required_face_width_mm, Ft / (125 * 3 * 0.389), 'required F = 11.426 mm at 125 MPa');
    assert(zm.value === 12, 'material-driven sizing chooses 12 mm');
    assert(zm.extra!.realized_stress_MPa < 125, 'realised stress < material allowable');

    // roundToModule snaps up to a whole multiple of the module (3 mm here).
    const zk = ok(sizeFaceWidth({ module: 3, teeth: 40, tangentialLoad: Ft, allowableStress: 120, roundToModule: true }), 'round to module');
    assert(zk.value % 3 === 0 && zk.value >= zk.extra!.required_face_width_mm, 'chosen is a multiple of the module ≥ required');
    assert(zk.value === 12, 'next multiple of 3 above 11.901 is 12');

    // More torque → wider face required.
    const zHi = ok(sizeFaceWidth({ module: 3, teeth: 40, torque_Nm: 200, allowableStress: 120 }), 'size @ T=200');
    assert(zHi.value > z2.value, 'more torque → wider required face');

    // Sizing validation.
    assert(!sizeFaceWidth({ module: 3, teeth: 40, tangentialLoad: Ft }).ok, 'no allowable and no material rejected');
    assert(!sizeFaceWidth({ module: 3, teeth: 40, tangentialLoad: Ft, material: 'steel' }).ok, 'material without safety factor rejected');
    assert(!sizeFaceWidth({ module: 3, teeth: 40, tangentialLoad: Ft, material: 'unobtanium', safetyFactor: 2 }).ok, 'unknown material rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-gear-strength-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-gear-strength-core smoke cases passed.');
}

main();
