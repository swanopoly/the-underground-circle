/**
 * engineering-vibration-core smoke.
 *
 * SDOF vibration pinned against textbook: the natural frequency from stiffness +
 * mass (ωn = √(k/m)), the SAME frequency from the static deflection (ωn = √(g/δ),
 * the bridge to the beam lane), and their agreement; then damping — the damping
 * ratio ζ = c/(2√(km)), critical damping, the damped frequency, and the
 * under/critical/over classification.
 */

import { naturalFrequency, dampedVibration } from '../src/lib/engineeringVibrationCore';

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

const G = 9.80665;

function main() {
  // ─── Natural frequency from k and m ──────────────────────────────
  {
    // k=1000 N/m, m=1 kg → ωn=√1000=31.623 rad/s, fn=5.033 Hz.
    const n = ok(naturalFrequency({ stiffness: 1000, mass: 1 }), 'k,m');
    near(n.omega_n_rad_s, Math.sqrt(1000), 'ωn = √(k/m) = 31.623 rad/s');
    near(n.frequency_Hz, Math.sqrt(1000) / (2 * Math.PI), 'fn = ωn/2π = 5.033 Hz');
    near(n.period_s, 2 * Math.PI / Math.sqrt(1000), 'period = 1/fn');
    // a spring rate in N/mm is converted (1 N/mm = 1000 N/m).
    const sr = ok(naturalFrequency({ springRate: 1, mass: 1 }), 'springRate');
    near(sr.omega_n_rad_s, Math.sqrt(1000), 'springRate 1 N/mm = 1000 N/m → same ωn');
  }

  // ─── Natural frequency from static deflection (the beam bridge) ──
  {
    // δ = 1 mm → ωn = √(g/0.001) = 99.03 rad/s → fn = 15.76 Hz.
    const d = ok(naturalFrequency({ staticDeflection: 1 }), 'from deflection');
    near(d.omega_n_rad_s, Math.sqrt(G / 0.001), 'ωn = √(g/δ)');
    near(d.frequency_Hz, Math.sqrt(G / 0.001) / (2 * Math.PI), 'fn from δ = 15.76 Hz');
    // the two faces agree: a k,m system's implied deflection reproduces its fn.
    const km = ok(naturalFrequency({ stiffness: 1000, mass: 1 }), 'km');
    const viaDefl = ok(naturalFrequency({ staticDeflection: km.staticDeflection_mm! }), 'via implied δ');
    near(viaDefl.frequency_Hz, km.frequency_Hz, 'fn(k,m) = fn(g/δ) — the two faces agree');
  }

  // ─── Damping ─────────────────────────────────────────────────────
  {
    // k=1000, m=1, c=10 → cc=2√1000=63.246, ζ=10/63.246=0.15811 (underdamped).
    const u = ok(dampedVibration({ stiffness: 1000, mass: 1, damping: 10 }), 'underdamped');
    near(u.criticalDamping_Ns_per_m, 2 * Math.sqrt(1000), 'critical damping = 2√(km)');
    near(u.dampingRatio, 10 / (2 * Math.sqrt(1000)), 'ζ = c/(2√(km)) = 0.1581');
    assert(u.classification === 'underdamped', 'ζ < 1 → underdamped');
    near(u.omega_d_rad_s!, Math.sqrt(1000) * Math.sqrt(1 - (10 / (2 * Math.sqrt(1000))) ** 2), 'ωd = ωn√(1−ζ²)');
    assert(u.dampedFrequency_Hz! < u.frequency_Hz, 'damped frequency is below the natural frequency');
    near(u.logDecrement!, 2 * Math.PI * u.dampingRatio / Math.sqrt(1 - u.dampingRatio ** 2), 'log decrement = 2πζ/√(1−ζ²)');

    // giving ζ directly recovers the damping coefficient.
    const byRatio = ok(dampedVibration({ stiffness: 1000, mass: 1, dampingRatio: 0.5 }), 'by ratio');
    near(byRatio.dampingCoefficient_Ns_per_m, 0.5 * 2 * Math.sqrt(1000), 'c = ζ·cc');
    assert(byRatio.classification === 'underdamped', 'ζ=0.5 underdamped');

    // critically and over damped.
    const crit = ok(dampedVibration({ stiffness: 1000, mass: 1, dampingRatio: 1 }), 'critical');
    assert(crit.classification === 'critically damped' && crit.omega_d_rad_s === null, 'ζ=1 critically damped, no oscillation');
    const over = ok(dampedVibration({ stiffness: 1000, mass: 1, dampingRatio: 2 }), 'over');
    assert(over.classification === 'overdamped' && over.dampedFrequency_Hz === null, 'ζ>1 overdamped, no oscillation');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!naturalFrequency({ mass: 1 }).ok, 'mass alone (no k, no δ) rejected');
    assert(!naturalFrequency({ stiffness: 1000 }).ok, 'stiffness alone (no mass, no δ) rejected');
    assert(!dampedVibration({ staticDeflection: 1, damping: 5 }).ok, 'damped needs k and m, not just δ');
    assert(!dampedVibration({ stiffness: 1000, mass: 1 }).ok, 'damped without a damping value rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-vibration-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-vibration-core smoke cases passed.');
}

main();
