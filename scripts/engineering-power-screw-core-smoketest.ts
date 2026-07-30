/**
 * engineering-power-screw-core smoke.
 *
 * A power screw is an inclined plane wrapped around a cylinder, so this pins the
 * lead angle, the raise/lower torque, the efficiency, and the self-locking test
 * against a textbook example (dm=25, lead=5, μ=0.15, F=6000 → T_raise≈16.2 N·m,
 * η≈29.5%, self-locking). It also checks the composing behaviour: a V-form thread
 * wedges (higher effective friction → more torque, lower efficiency) and a fast
 * multi-start lead screw stops being self-locking.
 */

import { powerScrew } from '../src/lib/engineeringPowerScrewCore';

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
  // ─── The textbook square-thread jack ─────────────────────────────
  {
    // dm=25, lead=5, μ=0.15, F=6000 N, square thread.
    const s = ok(powerScrew({ meanDiameter: 25, lead: 5, load: 6000, frictionCoeff: 0.15, threadForm: 'square' }), 'jack');
    near(s.leadAngle_deg, Math.atan(5 / (Math.PI * 25)) * 180 / Math.PI, 'lead angle = atan(l/πdm) = 3.64°');
    near(s.raiseTorque_Nmm, 16179.1, 'raise torque = (Fdm/2)(l+πfdm)/(πdm−fl) = 16179 N·mm');
    near(s.raiseTorque_Nm, 16.1791, 'raise torque = 16.18 N·m');
    near(s.efficiency, 0.29511, 'efficiency = Fl/(2πT) = 29.5%');
    assert(s.selfLocking, 'μ=0.15 > tan λ → self-locking (holds the load)');
    assert(s.lowerTorque_Nmm > 0, 'positive lower torque confirms self-locking');
  }

  // ─── V-thread wedges: more torque, less efficiency ───────────────
  {
    const sq = ok(powerScrew({ meanDiameter: 25, lead: 5, load: 6000, frictionCoeff: 0.15, threadForm: 'square' }), 'square');
    const iso = ok(powerScrew({ meanDiameter: 25, lead: 5, load: 6000, frictionCoeff: 0.15, threadForm: 'iso' }), 'iso');
    near(iso.effectiveFriction, 0.15 / Math.cos(30 * Math.PI / 180), 'ISO effective friction = μ/cos30°');
    assert(iso.raiseTorque_Nmm > sq.raiseTorque_Nmm, 'a V-thread needs more torque than a square thread');
    assert(iso.efficiency < sq.efficiency, 'a V-thread is less efficient');
    const acme = ok(powerScrew({ meanDiameter: 25, lead: 5, load: 6000, threadForm: 'acme' }), 'acme');
    assert(acme.effectiveFriction > sq.effectiveFriction && acme.effectiveFriction < iso.effectiveFriction, 'Acme friction sits between square and ISO');
  }

  // ─── A fast lead screw is NOT self-locking ───────────────────────
  {
    // big lead, small friction → lead angle above the friction angle.
    const fast = ok(powerScrew({ meanDiameter: 25, lead: 20, load: 6000, frictionCoeff: 0.05, threadForm: 'square' }), 'fast');
    assert(!fast.selfLocking, 'a fast/low-friction lead screw back-drives (not self-locking)');
    assert(fast.lowerTorque_Nmm < 0, 'negative lower torque = the load drives it down');
    assert(fast.efficiency > 0.7, 'a fast lead screw is highly efficient');
  }

  // ─── Composition: a thread designation supplies dm and lead ──────
  {
    // M20 → pitch diameter d2 = 20 − 0.6495·2.5 = 18.376, coarse pitch 2.5 (single start).
    const m20 = ok(powerScrew({ thread: 'M20', load: 5000, frictionCoeff: 0.15, threadForm: 'iso' }), 'M20 screw');
    near(m20.meanDiameter_mm, 20 - 0.6495 * 2.5, 'M20 mean diameter from the ISO thread lane');
    near(m20.lead_mm, 2.5, 'M20 coarse pitch = lead 2.5 (single start)');
    assert(m20.selfLocking, 'an M20 fastening thread is self-locking');
    // multi-start doubles the lead.
    const two = ok(powerScrew({ meanDiameter: 25, pitch: 5, starts: 2, load: 6000 }), 'two-start');
    near(two.lead_mm, 10, 'two-start lead = 2 × pitch = 10');
  }

  // ─── Collar friction adds torque ─────────────────────────────────
  {
    const noCollar = ok(powerScrew({ meanDiameter: 25, lead: 5, load: 6000, frictionCoeff: 0.15 }), 'no collar');
    const withCollar = ok(powerScrew({ meanDiameter: 25, lead: 5, load: 6000, frictionCoeff: 0.15, collarDiameter: 40, collarFriction: 0.12 }), 'collar');
    near(withCollar.collarTorque_Nmm, 0.12 * 6000 * 40 / 2, 'collar torque = μc·F·dc/2');
    assert(withCollar.totalRaiseTorque_Nm > noCollar.totalRaiseTorque_Nm, 'collar friction adds to the raise torque');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!powerScrew({ meanDiameter: 25, lead: 5 } as any).ok, 'no load rejected');
    assert(!powerScrew({ lead: 5, load: 6000 } as any).ok, 'no diameter / designation rejected');
    assert(!powerScrew({ meanDiameter: 25, load: 6000 } as any).ok, 'no lead / pitch rejected');
    assert(!powerScrew({ meanDiameter: 10, lead: 40, load: 6000 }).ok, 'lead angle ≥ 45° rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-power-screw-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-power-screw-core smoke cases passed.');
}

main();
