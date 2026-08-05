/**
 * engineering-vibration-absorber-core smoke.
 *
 * The undamped dynamic (tuned) vibration absorber — Den Hartog / Frahm — pinned
 * against hand-computed values and the exact anchors of the theory:
 *
 *  • THE DEFINING ANCHOR: when the absorber is tuned so ωa = √(k2/m2) = Ω, the
 *    primary mass amplitude X1 = 0 EXACTLY — the whole reason the absorber
 *    exists. And the absorber's spring force k2·X2 = −F0: the little spring
 *    carries the entire applied load in exact anti-phase. Both are pinned.
 *  • DETUNING: move Ω off ωa and |X1| becomes nonzero and grows; |X1| is
 *    minimized (= 0) precisely at exact tuning.
 *  • THE SPLIT: the 2-DOF system has TWO natural frequencies (roots of D = 0)
 *    that STRADDLE the original ωn = √(k1/m1): ω_low < ωn < ω_high for ANY
 *    tuning. A larger mass ratio μ pushes them farther apart (spacing = √μ when
 *    tuned to ωn), widening the safe band.
 *  • A TEXTBOOK Den Hartog case (m1=1, k1=100, m2=0.2, k2=20, μ=0.2), all
 *    hand-computed in comments below.
 *  • COMPOSITION: ωn and ωa computed via √(k/m) match the vibration core's
 *    naturalFrequency form.
 *
 * The smoke IS the proof.
 */

import { dynamicAbsorber } from '../src/lib/engineeringVibrationAbsorberCore';
import { naturalFrequency } from '../src/lib/engineeringVibrationCore';

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

// Independent closed-form re-derivation of the dimensionless amplitude for cross-checks.
// X1/δst = (f²−g²) / [(1−g²)(f²−g²) − μ f² g²].
const X1ref = (f: number, g: number, mu: number) => (f * f - g * g) / ((1 - g * g) * (f * f - g * g) - mu * f * f * g * g);
const X2ref = (f: number, g: number, mu: number) => (f * f) / ((1 - g * g) * (f * f - g * g) - mu * f * f * g * g);

function main() {
  // ─── THE DEFINING ANCHOR: X1 = 0 and k2·X2 = −F0 at tuning ────────
  {
    // m1=1, k1=100 → ωn=√100=10 rad/s. m2=0.2, k2=20 → ωa=√(20/0.2)=√100=10.
    // Drive at Ω=10 (=ωa): k2−m2Ω² = 20−0.2·100 = 0 → X1 = 0. D = −k2² = −400.
    // X2/δst = k1k2/D = 100·20/−400 = −5. absorber force = k2·X2 = −F0.
    // δst = F0/k1 = 20/100 = 0.2 m = 200 mm; X2 = δst·(−5) = −1 m = −1000 mm.
    const v = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, force: 20, omega: 10 }), 'tuned anchor');
    assert(v.tuned === true, 'ωa = Ω is detected as tuned');
    assert(v.X1_over_deltaSt === 0, 'X1/δst = 0 EXACTLY at tuning (the defining anchor)');
    assert(v.X1_mm === 0, 'absolute X1 = 0 mm at tuning — the primary mass stands still');
    near(v.absorberForceOverF0, -1, 'absorber spring force k2·X2 = −F0 (carries the whole load, anti-phase)');
    near(v.absorberForce_N!, -20, 'absorber force = −F0 = −20 N (dimensional)');
    near(v.X2_over_deltaSt, -5, 'X2/δst = k1k2/D = −5');
    near(v.X2_mm!, -1000, 'absorber amplitude X2 = δst·(−5) = −1000 mm');
    near(v.staticDeflection_mm!, 200, 'static deflection δst = F0/k1 = 200 mm');
    near(v.massRatio, 0.2, 'mass ratio μ = m2/m1 = 0.2');
    near(v.tuningRatio, 1, 'tuning ratio f = ωa/ωn = 1 (tuned to the primary too)');
    near(v.forcingRatio, 1, 'forcing ratio g = Ω/ωn = 1');
    near(v.absorberToForcingRatio, 1, 'ωa/Ω = 1 at tuning');
    near(v.determinant!, -400, 'determinant D = −k2² = −400 at tuning');
  }

  // ─── THE SPLIT: two resonances straddle ωn, spacing = √μ ──────────
  {
    // Roots of m1m2 Ω⁴ − ((k1+k2)m2 + m1k2)Ω² + k1k2 = 0 for the anchor system:
    // 0.2λ² − 44λ + 2000 = 0 → λ = 64.174242, 155.825758 → ω = 8.010883, 12.483019.
    // Ratios 0.8010883, 1.2483019 straddle ωn=10; product = 1; spacing = √0.2.
    const v = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: 10 }), 'split');
    assert(v.straddlesPrimary === true, 'ω_low < ωn < ω_high (the two resonances straddle the original)');
    near(v.naturalFrequencies_rad_s![0], 8.010883, 'lower resonance ω_low = 8.010883 rad/s');
    near(v.naturalFrequencies_rad_s![1], 12.483019, 'upper resonance ω_high = 12.483019 rad/s');
    near(v.naturalFrequencyRatios![0], 0.8010883, 'ω_low/ωn = 0.8010883');
    near(v.naturalFrequencyRatios![1], 1.2483019, 'ω_high/ωn = 1.2483019');
    near(v.naturalFrequencyRatios![0] * v.naturalFrequencyRatios![1], 1, 'product of ratios = 1 (tuned to ωn)');
    assert(v.naturalFrequencies_rad_s![0] < 10 && 10 < v.naturalFrequencies_rad_s![1], 'ωn = 10 sits strictly between the two');
    near(v.resonanceSeparationRatio!, Math.sqrt(0.2), 'resonance spacing / ωn = √μ = √0.2 = 0.4472136 (tuned to ωn)');
    near(v.resonanceSeparation_rad_s!, 12.483019 - 8.010883, 'absolute spacing ω_high − ω_low = 4.472136 rad/s');
  }

  // ─── Larger μ widens the split (spacing = √μ, monotone) ──────────
  {
    let prevSpacing = -1;
    for (const mu of [0.05, 0.1, 0.2, 0.5, 1]) {
      // design tuned to ωn: drive at Ω = ωn = 10, size the absorber for this μ.
      const v = ok(dynamicAbsorber({ m1: 1, k1: 100, omega: 10, massRatio: mu, design: true }), `split spacing μ=${mu}`);
      near(v.resonanceSeparationRatio!, Math.sqrt(mu), `spacing/ωn = √μ = √${mu} when tuned to ωn`);
      assert(v.straddlesPrimary, `μ=${mu}: the two resonances still straddle ωn`);
      assert(v.resonanceSeparationRatio! > prevSpacing, `μ=${mu}: larger mass ratio → wider split (${v.resonanceSeparationRatio} > ${prevSpacing})`);
      prevSpacing = v.resonanceSeparationRatio!;
    }
  }

  // ─── The straddle holds for ANY tuning ratio f (not only f=1) ────
  {
    // P(ωn) = −μ f² k1(...) < 0 always, so ωn always lies between the two roots.
    for (const f of [0.7, 0.85, 1.0, 1.15, 1.3]) {
      const v = ok(dynamicAbsorber({ omega_n: 10, massRatio: 0.2, tuningRatio: f, forcingRatio: 1 }), `straddle f=${f}`);
      assert(v.straddlesPrimary === true, `f=${f}: ω_low < ωn < ω_high (straddle is tuning-independent)`);
      assert(v.naturalFrequencies_rad_s![0] < v.omega_n_rad_s && v.omega_n_rad_s < v.naturalFrequencies_rad_s![1], `f=${f}: ωn strictly between the roots`);
    }
  }

  // ─── DETUNING: |X1| minimized at exact tuning, grows away ────────
  {
    // Sample Ω around ωa=10 (all inside the resonance-free band 8.01…12.48).
    const at = (w: number) => Math.abs(ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: w }), `detune ${w}`).X1_over_deltaSt);
    const v95 = at(9.5), v99 = at(9.9), v10 = at(10), v101 = at(10.1), v105 = at(10.5);
    assert(v10 === 0, '|X1| = 0 exactly at exact tuning (Ω = 10)');
    assert(v10 < v99 && v10 < v101, '|X1| minimized at tuning vs its immediate neighbours');
    assert(v10 < v95 && v10 < v105, '|X1| minimized at tuning vs wider neighbours');
    assert(v99 > 0 && v101 > 0, 'detuning either side makes |X1| nonzero');
    assert(v95 > v99, 'detuning further below tuning grows |X1| (0.5702 > 0.1017)');
    assert(v105 > v101, 'detuning further above tuning grows |X1|');
    // pin the hand-computed detuned value at Ω=9: X1/δst = 0.19/−0.125905 = −1.509134
    const d9 = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: 9 }), 'detune 9 value');
    near(d9.X1_over_deltaSt, -1.509134, 'Ω=9: X1/δst = −1.509134 (hand-computed)');
    assert(d9.tuned === false, 'Ω=9 ≠ ωa → not tuned');
  }

  // ─── DESIGN mode: size the absorber to tune ωa = Ω ───────────────
  {
    // Given the primary (m1=1,k1=100), disturbance Ω=10, chosen μ=0.2 →
    // m2 = μ·m1 = 0.2, k2 = m2·Ω² = 0.2·100 = 20, ωa = √(20/0.2) = 10 = Ω.
    const v = ok(dynamicAbsorber({ m1: 1, k1: 100, omega: 10, massRatio: 0.2, design: true }), 'design tune');
    assert(v.mode === 'design', 'design mode engaged');
    near(v.m2_kg!, 0.2, 'sized absorber mass m2 = μ·m1 = 0.2 kg');
    near(v.k2_N_per_m!, 20, 'sized absorber stiffness k2 = m2·Ω² = 20 N/m');
    near(v.omega_a_rad_s, 10, 'sized absorber is tuned: ωa = √(k2/m2) = Ω = 10 rad/s');
    assert(v.tuned === true, 'design result is tuned by construction');
    assert(v.X1_over_deltaSt === 0, 'design kills the primary response: X1/δst = 0');
    assert(v.X1_mm === null, 'no force given → no absolute amplitude (dimensionless result)');
    near(v.absorberForceOverF0, -1, 'design: absorber force = −F0');

    // design at a DIFFERENT disturbance frequency (tunes to Ω, not to ωn)
    const v2 = ok(dynamicAbsorber({ m1: 1, k1: 100, omega: 20, massRatio: 0.2, design: true }), 'design tune @20');
    near(v2.k2_N_per_m!, 80, 'Ω=20: k2 = m2·Ω² = 0.2·400 = 80 N/m');
    near(v2.omega_a_rad_s, 20, 'ωa = √(80/0.2) = 20 = Ω (tuned to the disturbance)');
    assert(v2.X1_over_deltaSt === 0, 'still X1 = 0 (tuned), even though Ω ≠ ωn=10');
    assert(v2.tuned === true, 'design @20 is tuned');

    // design with a force → absolute amplitudes appear, X1=0 and force=−F0
    const v3 = ok(dynamicAbsorber({ m1: 1, k1: 100, omega: 10, massRatio: 0.2, design: true, force: 20 }), 'design w/ force');
    assert(v3.X1_mm === 0, 'design + force: X1 = 0 mm');
    near(v3.absorberForce_N!, -20, 'design + force: absorber force = −20 N = −F0');
    near(v3.staticDeflection_mm!, 200, 'design + force: δst = 200 mm');
  }

  // ─── DIMENSIONLESS study: ωn + μ + f + g ─────────────────────────
  {
    // Tuned (f = g = 1): X1/δst = 0, X2/δst = −5, split ratios 0.801088/1.248302.
    const t = ok(dynamicAbsorber({ omega_n: 10, massRatio: 0.2, tuningRatio: 1, forcingRatio: 1 }), 'dimensionless tuned');
    assert(t.mode === 'dimensionless', 'dimensionless mode engaged');
    assert(t.X1_over_deltaSt === 0, 'dimensionless tuned: X1/δst = 0');
    near(t.X2_over_deltaSt, -5, 'dimensionless tuned: X2/δst = −5');
    near(t.naturalFrequencyRatios![0], 0.8010883, 'dimensionless split lower ratio = 0.8010883');
    near(t.naturalFrequencyRatios![1], 1.2483019, 'dimensionless split upper ratio = 1.2483019');
    assert(t.m1_kg === null && t.k1_N_per_m === null, 'no absolute masses/stiffness in a pure ratio study');

    // Non-tuned dimensionless matches the independent closed form.
    for (const g of [0.6, 0.9, 1.1, 1.4]) {
      const v = ok(dynamicAbsorber({ omega_n: 10, massRatio: 0.2, tuningRatio: 1, forcingRatio: g }), `dimensionless g=${g}`);
      near(v.X1_over_deltaSt, X1ref(1, g, 0.2), `X1/δst(f=1,g=${g}) matches Den Hartog closed form`);
      near(v.X2_over_deltaSt, X2ref(1, g, 0.2), `X2/δst(f=1,g=${g}) matches Den Hartog closed form`);
      assert(Math.abs(v.X1_over_deltaSt) > 0, `g=${g} ≠ tuning → X1 nonzero`);
    }
    // pin the hand value at g=0.9: 0.19 / (0.19·0.19 − 0.2·0.81) = 0.19/−0.1259 = −1.509134
    const g09 = ok(dynamicAbsorber({ omega_n: 10, massRatio: 0.2, tuningRatio: 1, forcingRatio: 0.9 }), 'dimensionless g=0.9');
    near(g09.X1_over_deltaSt, -1.509134, 'g=0.9: X1/δst = −1.509134');
  }

  // ─── Static and high-frequency limits ────────────────────────────
  {
    // Ω → 0: both masses just deflect statically together → X1/δst = X2/δst = 1.
    const lo = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: 0.001 }), 'static limit');
    near(lo.X1_over_deltaSt, 1, 'Ω→0: X1/δst → 1 (quasi-static, primary deflects by δst)');
    near(lo.X2_over_deltaSt, 1, 'Ω→0: X2/δst → 1 (absorber rides along statically)');
    // Ω → ∞: inertia dominates, response dies.
    const hi = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: 1000 }), 'high limit');
    assert(Math.abs(hi.X1_over_deltaSt) < 1e-3, 'Ω→∞: X1/δst → 0 (too much inertia to follow)');
  }

  // ─── COMPOSITION with the vibration core (ωn, ωa via √(k/m)) ──────
  {
    const v = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: 10 }), 'compose base');
    const nfN = ok(naturalFrequency({ stiffness: 100, mass: 1 }), 'nf primary');
    const nfA = ok(naturalFrequency({ stiffness: 20, mass: 0.2 }), 'nf absorber');
    near(v.omega_n_rad_s, nfN.omega_n_rad_s, 'ωn matches naturalFrequency({k1,m1}) — composition');
    near(v.omega_a_rad_s, nfA.omega_n_rad_s, 'ωa matches naturalFrequency({k2,m2}) — composition');
    near(v.omega_n_rad_s, Math.sqrt(100 / 1), 'ωn = √(k1/m1) = 10 (the SDOF √(k/m) form)');
    near(v.omega_a_rad_s, Math.sqrt(20 / 0.2), 'ωa = √(k2/m2) = 10 (the SDOF √(k/m) form)');

    // a non-perfect-square system still composes: ωn=√(500/2)=√250, ωa=√(100/0.4)=√250.
    const v2 = ok(dynamicAbsorber({ m1: 2, k1: 500, m2: 0.4, k2: 100, omega: 12 }), 'compose non-square');
    near(v2.omega_n_rad_s, Math.sqrt(250), 'ωn = √(500/2) = √250 = 15.8114 rad/s');
    near(v2.omega_a_rad_s, Math.sqrt(250), 'ωa = √(100/0.4) = √250 = 15.8114 rad/s');
    near(v2.massRatio, 0.2, 'μ = m2/m1 = 0.4/2 = 0.2');
    near(v2.omega_n_rad_s, ok(naturalFrequency({ stiffness: 500, mass: 2 }), 'nf2').omega_n_rad_s, 'ωn matches the vibration core for the non-square case');
  }

  // ─── Forcing given as Hz and as a ratio agree ────────────────────
  {
    // ωn=10 rad/s = 1.59155 Hz. Drive at Ω=10 rad/s = 1.59155 Hz.
    const byRad = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: 10 }), 'by rad');
    const byHz = ok(dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, forcingFrequency_Hz: 10 / (2 * Math.PI) }), 'by Hz');
    near(byHz.omega_rad_s, byRad.omega_rad_s, 'forcingFrequency_Hz converts to the same Ω');
    near(byHz.X1_over_deltaSt, 0, 'Hz-specified tuning also gives X1 = 0');
    // forcingRatio g = 0.9 vs explicit Ω = 9 agree
    const byG = ok(dynamicAbsorber({ omega_n: 10, massRatio: 0.2, tuningRatio: 1, forcingRatio: 0.9 }), 'by g');
    near(byG.omega_rad_s, 9, 'forcingRatio 0.9 → Ω = 9 rad/s');
  }

  // ─── Validation & fail-closed ────────────────────────────────────
  {
    assert(!dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20 }).ok, 'no forcing frequency rejected');
    assert(!dynamicAbsorber({ m1: 1, k1: 100, omega: 10, design: true }).ok, 'design without a mass ratio rejected');
    assert(!dynamicAbsorber({ omega_n: 10, tuningRatio: 1, forcingRatio: 1 }).ok, 'dimensionless without a mass ratio rejected');
    assert(!dynamicAbsorber({ m1: 1, k1: 100, omega: 10, massRatio: 0.2 }).ok, 'no absorber (no k2/m2/ωa/f, not design) rejected');
    assert(!dynamicAbsorber({ m2: 0.2, k2: 20, omega: 10 }).ok, 'no primary (m1,k1 or ωn) rejected');
    assert(!dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: -5 }).ok, 'negative forcing frequency rejected');
    assert(!dynamicAbsorber({ m1: 1, k1: 100, m2: 0.2, k2: 20, omega: NaN as any }).ok, 'non-finite forcing frequency rejected');
    assert(!dynamicAbsorber({ m1: 1, k1: 100, omega: 10, massRatio: -0.2, design: true }).ok, 'negative mass ratio in design rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-vibration-absorber-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-vibration-absorber-core smoke cases passed.');
}

main();
