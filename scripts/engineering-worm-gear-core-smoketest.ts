/**
 * engineering-worm-gear-core smoke.
 *
 * A worm IS a power screw that meshes a wheel, so this smoke's centrepiece is
 * the CROSS-CHECK: at the same lead angle λ and friction f, the worm's
 * self-locking verdict and lead angle are IDENTICAL to what
 * engineeringPowerScrewCore computes — the same λ<φ inclined-plane physics. It
 * then pins the worm's signature (velocity ratio VR = Zg/Zw, a huge single-stage
 * reduction), the efficiency η = tanλ/tan(λ+φ) computed two independent ways
 * that must agree, the clean invariants (self-locking ⇔ reverse efficiency ≤ 0,
 * self-locking ⇒ η < ½), and a textbook triple-start case (Zw=3, Zg=30, dw=60,
 * m=6, μ=0.05, φn=14.5° → VR=10, λ=16.70°, η≈84.0%, not self-locking).
 *
 * The smoke IS the proof: no app, no network, closed-form arithmetic.
 */

import { wormGear } from '../src/lib/engineeringWormGearCore';
import { powerScrew } from '../src/lib/engineeringPowerScrewCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(rr: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!rr.ok) { failures.push(`${label}: ${rr.error}`); console.error(`FAIL: ${label} — ${rr.error}`); process.exit(1); }
  return rr.value;
}

function main() {
  // ─── THE CROSS-CHECK: a worm IS a power screw ────────────────────
  // At the same lead angle λ and friction f (φn=0 ⇒ f=μ, matching a square
  // thread), the worm and the power screw MUST agree on the lead angle and the
  // self-locking verdict — it is the same unwrapped inclined plane.
  {
    // (a) a self-locking single-start worm.
    const w = ok(wormGear({ starts: 1, wheelTeeth: 40, module: 2, wormPitchDiameter: 50, frictionCoeff: 0.05 }), 'lock worm');
    const s = ok(powerScrew({ meanDiameter: 50, lead: w.lead_mm, load: 1000, frictionCoeff: 0.05, threadForm: 'square' }), 'lock screw');
    near(w.leadAngle_deg, s.leadAngle_deg, 'worm lead angle === power-screw lead angle (same helix)');
    assert(w.selfLocking === s.selfLocking, 'worm self-locking verdict === power-screw self-locking verdict (self-lock)');
    assert(w.selfLocking && s.selfLocking, 'both agree the small-lead worm/screw IS self-locking');

    // (b) a NOT-self-locking quad-start worm — the verdict flips together.
    const w2 = ok(wormGear({ starts: 4, wheelTeeth: 40, module: 4, wormPitchDiameter: 50, frictionCoeff: 0.03 }), 'free worm');
    const s2 = ok(powerScrew({ meanDiameter: 50, lead: w2.lead_mm, load: 1000, frictionCoeff: 0.03, threadForm: 'square' }), 'free screw');
    near(w2.leadAngle_deg, s2.leadAngle_deg, 'fast worm lead angle === power-screw lead angle');
    assert(w2.selfLocking === s2.selfLocking, 'worm self-locking verdict === power-screw verdict (not self-locking)');
    assert(!w2.selfLocking && !s2.selfLocking, 'both agree the large-lead worm/screw is NOT self-locking');

    // (c) the threshold itself is the power screw's: self-locking ⇔ f > tanλ.
    assert(w.effectiveFriction > Math.tan(w.leadAngle_deg / (180 / Math.PI)), 'self-lock case: f > tanλ (the power-screw threshold)');
    assert(w2.effectiveFriction < Math.tan(w2.leadAngle_deg / (180 / Math.PI)), 'free case: f < tanλ (below the threshold)');
  }

  // ─── VELOCITY RATIO: VR = Zg/Zw, huge from one mesh ──────────────
  {
    const a = ok(wormGear({ starts: 1, wheelTeeth: 40, module: 2, wormPitchDiameter: 50 }), 'VR 1-start');
    near(a.velocityRatio, 40, 'single-start worm on a 40-tooth wheel = 40:1 in ONE stage');
    const b = ok(wormGear({ starts: 2, wheelTeeth: 40, module: 2, wormPitchDiameter: 50 }), 'VR 2-start');
    near(b.velocityRatio, 20, 'two-start worm on the same wheel = 20:1');
    const c = ok(wormGear({ starts: 4, wheelTeeth: 40, module: 2, wormPitchDiameter: 50 }), 'VR 4-start');
    near(c.velocityRatio, 10, 'four-start worm on the same wheel = 10:1');
    assert(a.velocityRatio > c.velocityRatio, 'fewer starts ⇒ larger single-stage ratio');
    // center distance = (dw + m·Zg)/2
    near(a.wheelPitchDiameter_mm, 2 * 40, 'wheel pitch diameter = m·Zg = 80');
    near(a.centerDistance_mm, (50 + 80) / 2, 'center distance = (dw + dg)/2 = 65');
    near(a.axialPitch_mm, Math.PI * 2, 'axial pitch = π·m');
    near(a.lead_mm, 1 * Math.PI * 2, 'lead = Zw·px = 6.283');
  }

  // ─── EFFICIENCY: η = tanλ/tan(λ+φ), two ways must agree ──────────
  {
    // triple-start with a 14.5° pressure angle: the effective-friction form and
    // the full pressure-angle form are the SAME number.
    const w = ok(wormGear({ starts: 3, wheelTeeth: 30, module: 6, wormPitchDiameter: 60, frictionCoeff: 0.05, pressureAngle: 14.5 }), 'eta worm');
    const lambda = w.leadAngle_deg / (180 / Math.PI);
    const mu = 0.05, cphi = Math.cos(14.5 * Math.PI / 180);
    const f = mu / cphi, phi = Math.atan(f);
    near(w.effectiveFriction, f, 'effective friction f = μ/cos(φn) — the V-tooth wedge');
    const etaFrictionAngle = Math.tan(lambda) / Math.tan(lambda + phi);                 // form 1
    const etaPressureAngle = Math.tan(lambda) * (cphi - mu * Math.tan(lambda)) / (cphi * Math.tan(lambda) + mu); // form 2
    near(etaFrictionAngle, etaPressureAngle, 'η two ways agree: tanλ/tan(λ+φ) == tanλ(cosφn−μtanλ)/(cosφn·tanλ+μ)');
    near(w.efficiency, etaFrictionAngle, 'core efficiency == tanλ/tan(λ+φ)');
    near(w.efficiency, 0.83991, 'triple-start η ≈ 84.0%');
    assert(w.efficiency > 0.5 && !w.selfLocking, 'efficient (η>½) and not self-locking go together here');
  }

  // ─── CLEAN INVARIANTS: self-locking ⇔ reverse η ≤ 0, ⇒ η < ½ ─────
  {
    // exact iff: self-locking ⇔ the wheel cannot back-drive the worm (η_rev ≤ 0).
    const lock = ok(wormGear({ starts: 1, wheelTeeth: 40, module: 2, wormPitchDiameter: 50, frictionCoeff: 0.05 }), 'lock');
    assert(lock.selfLocking, 'small-lead single-start worm is self-locking');
    assert(lock.reverseEfficiency < 0, 'self-locking ⇒ reverse efficiency < 0 (the load cannot drive it back)');
    assert(lock.efficiency < 0.5, 'self-locking ⇒ forward η < ½ (a clean fact)');
    near(lock.efficiency, 0.44354, 'self-locking single-start η ≈ 44.4%');

    const free = ok(wormGear({ starts: 4, wheelTeeth: 40, module: 4, wormPitchDiameter: 50, frictionCoeff: 0.03 }), 'free');
    assert(!free.selfLocking, 'large-lead worm is not self-locking');
    assert(free.reverseEfficiency > 0, 'not self-locking ⇒ reverse efficiency > 0 (it back-drives)');
    near(free.efficiency, 0.90551, 'quad-start η ≈ 90.6% (efficient)');
    assert(free.efficiency > 0.5, 'not self-locking here ⇒ η > ½');

    // the boundary value itself: at λ=φ, η = (1 − f²)/2 < ½.
    assert((1 - 0.05 * 0.05) / 2 < 0.5, 'at the locking boundary λ=φ, η=(1−f²)/2 = 0.49875 < ½');

    // A SWEEP proves the rigorous direction (self-locking ⇒ η<½) and that η
    // rises with λ below the max-efficiency point. (The converse is NOT strict —
    // a razor-thin band just past λ=φ is not self-locking yet still η<½ — so we
    // assert only the true implication, honestly.)
    const modules = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
    let prevEta = -1;
    for (const mm of modules) {
      const s = ok(wormGear({ starts: 1, wheelTeeth: 40, module: mm, wormPitchDiameter: 50, frictionCoeff: 0.05 }), `sweep m=${mm}`);
      assert(!(s.selfLocking && s.efficiency >= 0.5), `sweep m=${mm}: self-locking ⇒ η<½ (never self-locking with η≥½)`);
      assert(s.efficiency > prevEta, `sweep m=${mm}: efficiency rises with lead angle`);
      prevEta = s.efficiency;
    }
  }

  // ─── TEXTBOOK CASE (triple-start, pressure angle, full output) ───
  {
    // Zw=3, Zg=30, dw=60, m=6, μ=0.05, φn=14.5°, input torque 50 N·m.
    const w = ok(wormGear({ starts: 3, wheelTeeth: 30, module: 6, wormPitchDiameter: 60, frictionCoeff: 0.05, pressureAngle: 14.5, inputTorque: 50 }), 'textbook');
    near(w.velocityRatio, 10, 'VR = Zg/Zw = 30/3 = 10');
    near(w.wheelPitchDiameter_mm, 180, 'wheel pitch diameter = m·Zg = 180');
    near(w.centerDistance_mm, 120, 'center distance = (60+180)/2 = 120');
    near(w.leadAngle_deg, Math.atan(0.3) * 180 / Math.PI, 'lead angle = atan(L/πdw) = atan(0.3) = 16.70°');
    near(w.helixAngle_deg, 90 - Math.atan(0.3) * 180 / Math.PI, 'helix angle = 90° − λ (complement)');
    near(w.frictionAngle_deg, Math.atan(0.05 / Math.cos(14.5 * Math.PI / 180)) * 180 / Math.PI, 'friction angle φ = atan(f)');
    assert(!w.selfLocking, 'the triple-start textbook worm is not self-locking (λ ≫ φ)');
    near(w.efficiency, 0.83991, 'textbook efficiency ≈ 84.0%');
    near(w.outputTorque_Nm!, 50 * w.velocityRatio * w.efficiency, 'torque out = Tin · VR · η');
    assert(w.outputTorque_Nm! > 400, 'a 10:1 worm at 84% turns 50 N·m into ~420 N·m');
    near(w.wormTangentialForce_N!, 2 * 50 * 1000 / 60, 'worm tangential force = 2·Tin/dw');
    assert(w.wheelTangentialForce_N! > w.wormTangentialForce_N!, 'the wheel carries the multiplied (larger) tangential force');
    assert(w.separatingForce_N! > 0, 'a pressure angle produces a positive separating (radial) force');
  }

  // ─── SIGNATURE contrast: 1-start locking/slow vs 4-start free/fast ─
  {
    const one = ok(wormGear({ starts: 1, wheelTeeth: 40, module: 2, wormPitchDiameter: 50, frictionCoeff: 0.05 }), 'one');
    const four = ok(wormGear({ starts: 4, wheelTeeth: 40, module: 4, wormPitchDiameter: 50, frictionCoeff: 0.03 }), 'four');
    assert(one.selfLocking && one.efficiency < 0.5, '1-start: self-locking AND inefficient (the holding worm)');
    assert(!four.selfLocking && four.efficiency > 0.85, '4-start: free AND efficient (the transmitting worm)');
    assert(one.velocityRatio > four.velocityRatio, '1-start gives the bigger single-stage ratio');
    assert(four.leadAngle_deg > one.leadAngle_deg, 'more starts ⇒ steeper lead angle');
  }

  // ─── VALIDATION ──────────────────────────────────────────────────
  {
    assert(!wormGear({ wormPitchDiameter: 50, module: 2 } as any).ok, 'missing wheelTeeth rejected');
    assert(!wormGear({ wheelTeeth: 40, module: 2 } as any).ok, 'missing wormPitchDiameter rejected');
    assert(!wormGear({ wheelTeeth: 40, wormPitchDiameter: 50 } as any).ok, 'missing module/axialPitch/lead rejected');
    assert(!wormGear({ wheelTeeth: 40.5, module: 2, wormPitchDiameter: 50 } as any).ok, 'non-integer wheelTeeth rejected');
    assert(!wormGear({ wheelTeeth: 40, module: 60, wormPitchDiameter: 50 }).ok, 'lead angle ≥ 45° rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-worm-gear-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-worm-gear-core smoke cases passed.');
}

main();
