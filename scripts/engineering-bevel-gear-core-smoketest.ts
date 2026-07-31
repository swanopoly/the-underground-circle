/**
 * engineering-bevel-gear-core smoke.
 *
 * Straight bevel gears drive INTERSECTING shafts. The geometry is closed-form, so
 * it is proven DIRECTLY — every number below is worked out by hand in the comment
 * and asserted (no app, no mesh, the smoke IS the proof). Four structural facts
 * are pinned:
 *   1. CONE-ANGLE SUM: γ_pinion + γ_gear = shaft angle Σ, for Σ = 90° and a
 *      non-90° angle, and a 1:1 pair splits it evenly (45° each at 90°). At 90°
 *      the ratio N_g/N_p equals tan γ_gear.
 *   2. SHARED CONE DISTANCE: r_pitch/sin γ is the same from the pinion and the
 *      gear (they share the apex) — a self-check, plus (m/2)√(N_p²+N_g²) at 90°.
 *   3. TREDGOLD: the equivalent spur teeth N_e = N/cos γ is ALWAYS > N (the back
 *      cone expands the tooth), and a larger cone angle → larger N_e.
 *   4. FORCE SWAP: the shared tangential load resolves so that, for Σ = 90°, the
 *      pinion's radial force = the gear's axial force and vice versa.
 * A full Shigley/Khurmi-style textbook case (N_p=20, N_g=40, m=4, Σ=90°, φ=20°,
 * F=30, T=200 N·m) is hand-computed end to end.
 */

import {
  bevelGearPair, pitchConeAngles, equivalentSpurTeeth,
} from '../src/lib/engineeringBevelGearCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
/** Assert a numeric value is within a relative/absolute tolerance of expected. */
function near(actual: number, expected: number, label: string, tol = 1e-6) {
  const okv = Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
  assert(okv, `${label} (got ${actual}, expected ≈ ${expected})`);
}
function ok<T>(rr: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!rr.ok) { failures.push(`${label}: ${rr.error}`); console.error(`FAIL: ${label} — ${rr.error}`); process.exit(1); }
  return rr.value;
}

const D = 180 / Math.PI;

function main() {
  // ─── Pitch cone angles: Σ = 90° ──────────────────────────────────
  {
    // N_p=20, N_g=40, Σ=90 → γ_p = atan(20/40) = 26.565°, γ_g = atan(40/20) = 63.435°.
    const a = pitchConeAngles(20, 40, 90);
    near(a.pinion, Math.atan(20 / 40) * D, 'γ_pinion = atan(N_p/N_g) = 26.565° at Σ=90');
    near(a.gear, Math.atan(40 / 20) * D, 'γ_gear = atan(N_g/N_p) = 63.435° at Σ=90');
    near(a.pinion + a.gear, 90, 'γ_pinion + γ_gear = Σ = 90° exactly');
    // Default shaft angle is 90° when omitted.
    const a0 = pitchConeAngles(20, 40);
    near(a0.pinion, a.pinion, 'shaft angle defaults to 90°');
    // 1:1 pair splits the shaft angle evenly.
    const e = pitchConeAngles(24, 24, 90);
    near(e.pinion, 45, '1:1 pair → γ_pinion = 45° at Σ=90');
    near(e.gear, 45, '1:1 pair → γ_gear = 45° at Σ=90');
  }

  // ─── Pitch cone angles: general Σ (incl. obtuse via atan2) ────────
  {
    // Σ=60, N_p=20, N_g=30 → the sum still equals Σ.
    const a = pitchConeAngles(20, 30, 60);
    near(a.pinion + a.gear, 60, 'γ_pinion + γ_gear = Σ = 60° (non-90 shaft angle)');
    // Σ=150 with a big ratio drives the gear denominator negative — atan2 must cope.
    const b = pitchConeAngles(20, 100, 150);
    near(b.pinion + b.gear, 150, 'γ_pinion + γ_gear = Σ = 150° (obtuse, atan2 path)');
    assert(b.gear > 90, 'obtuse-shaft gear cone angle exceeds 90° (second quadrant)');
    // A 1:1 pair at any Σ splits evenly.
    const c = pitchConeAngles(18, 18, 70);
    near(c.pinion, 35, '1:1 pair at Σ=70 → 35° each (pinion)');
    near(c.gear, 35, '1:1 pair at Σ=70 → 35° each (gear)');
  }

  // ─── Tredgold equivalent spur teeth: N_e = N/cos γ ───────────────
  {
    // N_e always exceeds N (cos γ < 1). At γ=26.565°, N_e = 20/cos = 22.3607.
    near(equivalentSpurTeeth(20, 26.56505117707799), 20 / Math.cos(26.56505117707799 / D), 'N_e(pinion) = N/cos γ = 22.3607');
    near(equivalentSpurTeeth(40, 63.43494882292201), 40 / Math.cos(63.43494882292201 / D), 'N_e(gear) = N/cos γ = 89.4427');
    assert(equivalentSpurTeeth(20, 26.565) > 20, 'N_e > N always (back cone expands the tooth) — pinion');
    assert(equivalentSpurTeeth(40, 63.435) > 40, 'N_e > N always — gear');
    near(equivalentSpurTeeth(20, 0), 20, 'γ=0 (flat, a spur gear) → N_e = N');
    // Larger cone angle → larger N_e, holding N fixed.
    assert(equivalentSpurTeeth(20, 45) > equivalentSpurTeeth(20, 26.565), 'larger cone angle → larger N_e (same N)');
    near(equivalentSpurTeeth(20, 45), 20 / Math.cos(Math.PI / 4), 'N_e at 45° = 20/cos45 = 28.2843');
  }

  // ─── Full pair geometry (Σ=90 textbook case, no load) ────────────
  {
    // N_p=20, N_g=40, m=4, Σ=90, φ=20. No torque → forces omitted.
    const g = ok(bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40 }), 'bevel pair geometry');
    assert(g.ratio === 2, 'ratio = N_g/N_p = 2');
    near(g.pinionConeAngleDeg, 26.56505117707799, 'γ_pinion = 26.565°');
    near(g.gearConeAngleDeg, 63.43494882292201, 'γ_gear = 63.435°');
    near(g.pinionConeAngleDeg + g.gearConeAngleDeg, 90, 'cone angles sum to Σ = 90°');
    // At 90° the ratio equals tan γ_gear.
    near(g.ratio, Math.tan(g.gearConeAngleDeg / D), 'ratio = tan γ_gear (Σ=90° identity)', 1e-5);
    // Pitch radii r = m·N/2.
    assert(g.pinionPitchRadius === 40 && g.gearPitchRadius === 80, 'pitch radii = m·N/2 (40, 80 mm)');
    // Shared cone distance: (m/2)·√(N_p²+N_g²) = 2·√2000 = 89.4427; and both members agree.
    near(g.coneDistance, (4 / 2) * Math.sqrt(20 * 20 + 40 * 40), 'cone distance = (m/2)√(N_p²+N_g²) = 89.4427');
    near(g.coneDistance, g.gearPitchRadius / Math.sin(g.gearConeAngleDeg / D), 'cone distance same from the gear (shared apex)', 1e-5);
    // Tredgold equivalents on both members.
    near(g.equivalentSpurTeethPinion, 22.360680, 'N_e(pinion) = 22.3607');
    near(g.equivalentSpurTeethGear, 89.442719, 'N_e(gear) = 89.4427');
    assert(g.equivalentSpurTeethPinion > 20 && g.equivalentSpurTeethGear > 40, 'both N_e exceed the actual tooth counts');
    // No load supplied → no force block.
    assert(g.forces === null, 'no torque/power → forces omitted');
  }

  // ─── 1:1 bevel pair (mitre gears) ────────────────────────────────
  {
    const g = ok(bevelGearPair({ module: 3, pinionTeeth: 20, gearTeeth: 20 }), '1:1 mitre pair');
    assert(g.ratio === 1, '1:1 ratio');
    near(g.pinionConeAngleDeg, 45, 'mitre pinion cone = 45°');
    near(g.gearConeAngleDeg, 45, 'mitre gear cone = 45°');
    near(g.equivalentSpurTeethPinion, g.equivalentSpurTeethGear, 'equal members → equal N_e');
    near(g.equivalentSpurTeethPinion, 20 / Math.cos(Math.PI / 4), 'mitre N_e = 20/cos45 = 28.2843');
  }

  // ─── Force analysis + the pinion/gear force SWAP (Σ=90) ──────────
  {
    // Textbook: N_p=20, N_g=40, m=4, F=30, φ=20, T_pinion=200 N·m.
    // γ_p=26.565°, γ_g=63.435°. r_pitch,p = 40 mm.
    // r_m,p = 40 − ½·30·sin26.565° = 40 − 15·0.447214 = 33.291796 mm.
    // r_m,g = 80 − ½·30·sin63.435° = 80 − 15·0.894427 = 66.583592 mm.
    // F_t = T/r_m,p = 200000 / 33.291796 = 6007.486 N (shared tangential load).
    // W_r,p = F_t·tan20°·cos26.565° = 6007.486·0.363970·0.894427 = 1955.706 N.
    // W_a,p = F_t·tan20°·sin26.565° = 6007.486·0.363970·0.447214 =  977.853 N.
    // W_r,g = F_t·tan20°·cos63.435° =  977.853 N   (= W_a,p — the SWAP).
    // W_a,g = F_t·tan20°·sin63.435° = 1955.706 N   (= W_r,p — the SWAP).
    const g = ok(bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, faceWidth: 30, pressureAngleDeg: 20, torque_Nm: 200 }), 'bevel forces');
    const f = g.forces!;
    assert(f !== null, 'torque supplied → force block present');
    assert(f.source === 'torque', 'force source = torque');
    near(g.pinionMeanRadius, 40 - 15 * Math.sin(Math.atan(0.5)), 'r_m(pinion) = 33.291796 mm');
    near(g.gearMeanRadius, 80 - 15 * Math.sin(Math.atan(2)), 'r_m(gear) = 66.583592 mm');
    const Ft = 200000 / (40 - 15 * Math.sin(Math.atan(0.5)));
    near(f.tangential_N, Ft, 'F_t = T/r_m,pinion = 6007.486 N (shared)');
    const tan20 = Math.tan(20 / D);
    near(f.pinionRadial_N, Ft * tan20 * Math.cos(Math.atan(0.5)), 'W_r(pinion) = 1955.706 N');
    near(f.pinionAxial_N, Ft * tan20 * Math.sin(Math.atan(0.5)), 'W_a(pinion) = 977.853 N');
    near(f.gearRadial_N, Ft * tan20 * Math.cos(Math.atan(2)), 'W_r(gear) = 977.853 N');
    near(f.gearAxial_N, Ft * tan20 * Math.sin(Math.atan(2)), 'W_a(gear) = 1955.706 N');
    // THE FORCE-SWAP IDENTITY (structural, for Σ=90).
    near(f.pinionRadial_N, f.gearAxial_N, 'IDENTITY: W_r(pinion) = W_a(gear)');
    near(f.pinionAxial_N, f.gearRadial_N, 'IDENTITY: W_a(pinion) = W_r(gear)');
    // Radial ≠ axial on a member (the cone angle is not 45°), so the swap is non-trivial.
    assert(Math.abs(f.pinionRadial_N - f.pinionAxial_N) > 1, 'pinion radial ≠ axial (γ ≠ 45°) — swap is non-trivial');
  }

  // ─── Power path matches the torque path ──────────────────────────
  {
    // Pick power so T = 200 N·m at 1000 rpm: P = T·ω = 200·(2π·1000/60).
    const rpm = 1000;
    const omega = (2 * Math.PI * rpm) / 60;
    const power = 200 * omega;
    const g = ok(bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, faceWidth: 30, pressureAngleDeg: 20, power_W: power, speed_rpm: rpm }), 'bevel forces via power');
    const Ft = 200000 / (40 - 15 * Math.sin(Math.atan(0.5)));
    assert(g.forces!.source === 'power', 'force source = power');
    near(g.forces!.pinionTorque_Nm, 200, 'power → torque = P/ω = 200 N·m');
    near(g.forces!.tangential_N, Ft, 'power path gives the same F_t = 6007.486 N');
  }

  // ─── Monotonic physics ───────────────────────────────────────────
  {
    const base = ok(bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, faceWidth: 30, torque_Nm: 200 }), 'σ base');
    const dbl = ok(bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, faceWidth: 30, torque_Nm: 400 }), 'σ double');
    near(dbl.forces!.tangential_N, 2 * base.forces!.tangential_N, 'doubling torque doubles F_t');
    // Larger pressure angle → larger separating (radial) force.
    const hiPhi = ok(bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, faceWidth: 30, pressureAngleDeg: 30, torque_Nm: 200 }), 'φ=30');
    assert(hiPhi.forces!.pinionRadial_N > base.forces!.pinionRadial_N, 'larger pressure angle → larger radial force');
    // No face width → mean radius = large-end pitch radius.
    const noF = ok(bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, torque_Nm: 200 }), 'no face width');
    assert(noF.pinionMeanRadius === noF.pinionPitchRadius, 'no faceWidth → mean radius = pitch radius');
  }

  // ─── Validation (fail-closed) ────────────────────────────────────
  {
    assert(!bevelGearPair({ module: 0, pinionTeeth: 20, gearTeeth: 40 }).ok, 'zero module rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 2, gearTeeth: 40 }).ok, 'too-few pinion teeth rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 3 }).ok, 'too-few gear teeth rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, shaftAngleDeg: 0 }).ok, 'shaft angle 0 rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, shaftAngleDeg: 180 }).ok, 'shaft angle 180 rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, pressureAngleDeg: 90 }).ok, 'pressure angle 90 rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, faceWidth: -5, torque_Nm: 200 }).ok, 'negative face width rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, faceWidth: 500, torque_Nm: 200 }).ok, 'over-large face width (r_m ≤ 0) rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, torque_Nm: -200 }).ok, 'negative torque rejected');
    assert(!bevelGearPair({ module: 4, pinionTeeth: 20, gearTeeth: 40, power_W: 1000 }).ok, 'power without speed rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-bevel-gear-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-bevel-gear-core smoke cases passed.');
}

main();
