/**
 * engineering-vibration-isolation-integration — proof that the DYNAMICS tools
 * compose, the vibration counterpart to the (statics) bracket workflow and the
 * (power-transmission) gearbox workflow.
 *
 * The bracket proved load → thickness → model → measure → fit. The gearbox
 * proved torque → reduction → shaft → bearing. This proves the design a
 * plant engineer actually does when a machine shakes the floor:
 *
 *   MOUNT A 200 kg MACHINE with a rotating unbalance forcing at 50 Hz (3000 rpm)
 *   so that only 10% of the disturbing force reaches the floor (TR = 0.1, 90%
 *   isolation).
 *
 *   1. isolation requirement  transmissibility SOLVE — the target TR fixes the
 *      frequency ratio r (and so the required mount natural frequency ωn = Ω/r).
 *   2. mount stiffness        ωn = √(k/m) → the total mount stiffness k = m·ωn².
 *   3. spring sizing          springRate k = G·d⁴/(8·D³·n) — pick a wire/coil and
 *      solve the coils so N corner springs deliver that total k.
 *   4. static deflection      δ = g/ωn² — the number a technician measures under
 *      the machine's own weight (must equal mg/k and the spring's own sag).
 *   5. tuned-absorber alt.    dynamicAbsorber — instead of soft-mounting, bolt a
 *      tuned mass on and drive the machine's motion to ZERO at the one frequency.
 *
 * The seams are the assertions: the target transmissibility the isolation lane
 * solves is the ωn the vibration lane turns into a stiffness; that stiffness is
 * the k the spring lane reproduces from real wire/coil geometry and feeds BACK
 * through √(k/m) to the same ωn and the same r; the static deflection computed
 * three independent ways (g/ωn², mg/k, spring sag) agrees; and the tuned absorber
 * cancels the primary motion exactly at the tuned frequency but nowhere else.
 * Pure — chains the tsx-loadable cores, no app, no I/O.
 */

import { transmissibility, forcedResponse } from '../src/lib/engineeringForcedVibrationCore';
import { naturalFrequency, dampedVibration } from '../src/lib/engineeringVibrationCore';
import { springRate } from '../src/lib/engineeringCalcCore';
import { dynamicAbsorber } from '../src/lib/engineeringVibrationAbsorberCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function need<T extends { ok: boolean }>(r: T, label: string): T {
  if (!r.ok) { failures.push(label); console.error(`FAIL: ${label} — not ok: ${(r as any).error}`); process.exit(1); }
  return r;
}

const G_ACCEL = 9.80665; // m/s² — the same gravity constant both cores use

function main() {
  // ── duty ──────────────────────────────────────────────────────────────────
  const mass_kg = 200;            // the machine
  const forcingHz = 50;           // rotating unbalance at 3000 rpm
  const Omega = 2 * Math.PI * forcingHz; // forcing angular frequency, rad/s
  const targetTR = 0.1;           // want 90% force isolation
  const N = 4;                    // four-corner spring mount
  near(Omega, 2 * Math.PI * 50, 'forcing Ω = 2π·50 ≈ 314.16 rad/s');

  // ── 1. ISOLATION REQUIREMENT — the target TR fixes the frequency ratio r ────
  // Undamped design pass (ζ = 0): the softest, best-isolating mount for a target.
  const iso = need(transmissibility({ targetTR, forcingFrequency_Hz: forcingHz, dampingRatio: 0 }), 'transmissibility solve');
  const isoV = (iso as any).value;
  // At ζ=0, TR = 1/(r²−1) in the isolation region → r² = 1 + 1/TR = 11.
  near(isoV.ratio, Math.sqrt(11), 'solved frequency ratio r = √(1+1/TR) = √11 ≈ 3.317');
  assert(isoV.ratio > Math.SQRT2, 'r > √2 → the mount is in the ISOLATION region (below √2 it AMPLIFIES)');
  assert(isoV.isolating === true && isoV.regime === 'isolation', 'core agrees: isolating, regime = isolation');
  near(isoV.transmissibility, targetTR, 'SEAM: the solved r reproduces the target TR = 0.1');
  near(isoV.isolationEfficiency, 0.9, 'isolation efficiency 1 − TR = 90%');
  near(isoV.forcingFrequency_Hz, forcingHz, 'forcing frequency echoed = 50 Hz');
  // The required mount natural frequency is Ω/r — the seam into the vibration lane.
  const wn_req = isoV.omega_n_required_rad_s;
  near(wn_req, Omega / isoV.ratio, 'SEAM: required mount ωn = Ω/r (isolation lane hands ωn to the vibration lane)');

  // Independent EVALUATE at that same ratio must return the same TR (round-trip).
  const isoEval = need(transmissibility({ ratio: isoV.ratio, dampingRatio: 0 }), 'transmissibility evaluate');
  near((isoEval as any).value.transmissibility, targetTR, 'SEAM: evaluate-mode TR at the solved r = the target TR');

  // The FORCED-RESPONSE lane, at ζ=0, gives the SAME magnitude 1/|1−r²| as TR.
  const frDisp = need(forcedResponse({ ratio: isoV.ratio, dampingRatio: 0 }), 'forced response (displacement)');
  near((frDisp as any).value.magnification, targetTR, 'SEAM: forced-response displacement magnification = TR at ζ=0 (both 1/|1−r²|)');

  // ── 2. MOUNT STIFFNESS — ωn = √(k/m) → total mount stiffness k = m·ωn² ───────
  const k_total_Npm = mass_kg * wn_req * wn_req; // N/m
  const nf = need(naturalFrequency({ stiffness: k_total_Npm, mass: mass_kg }), 'naturalFrequency from derived k');
  near((nf as any).value.omega_n_rad_s, wn_req, 'SEAM: the k derived from ωn reproduces ωn via naturalFrequency (√(k/m))');
  near((nf as any).value.frequency_Hz, wn_req / (2 * Math.PI), 'mount natural frequency fn = ωn/2π ≈ 15.08 Hz');
  const k_total_Npmm = k_total_Npm / 1000; // N/mm for the spring lane

  // ── 3. SPRING SIZING — N corner springs must combine to k_total ─────────────
  // Pick a heavy-duty steel wire/coil (d = 18 mm wire, D = 90 mm mean → index 5),
  // then SOLVE the active coils n so each of the N springs delivers k_total/N.
  const wire_d = 18, mean_D = 90;
  const k_each_target = k_total_Npmm / N;                 // N/mm each
  const G_steel = 79300;                                  // steel shear modulus, MPa (= N/mm²)
  const n_coils = (G_steel * wire_d ** 4) / (8 * mean_D ** 3 * k_each_target); // invert k = G·d⁴/(8D³n)
  const spring = need(springRate({ wireDiameter: wire_d, meanDiameter: mean_D, activeCoils: n_coils, material: 'steel' }), 'springRate');
  const k_each = (spring as any).extra.rate_N_per_mm;     // what one such spring actually delivers
  near(k_each, k_each_target, 'SEAM: the solved-coil spring delivers exactly k_total/N');
  near((spring as any).extra.spring_index_D_over_d, mean_D / wire_d, 'spring index D/d = 5 parsed from the geometry (mid-range)');
  near(N * k_each, k_total_Npmm, 'SEAM: N spring rates combine to the required total mount stiffness k');
  // Close the whole loop: spring geometry → k → √(k/m) → ωn → r must land back on the isolation r.
  const nf2 = need(naturalFrequency({ springRate: N * k_each, mass: mass_kg }), 'naturalFrequency from the combined spring rate');
  near((nf2 as any).value.omega_n_rad_s, wn_req, 'SEAM: spring geometry → k → ωn reproduces the required mount ωn');
  near(Omega / (nf2 as any).value.omega_n_rad_s, isoV.ratio, 'SEAM: the spring-built ωn reproduces the isolation ratio r → the target TR');

  // ── 4. STATIC DEFLECTION — the number a technician measures, three ways ──────
  const delta_from_wn = (G_ACCEL / (wn_req * wn_req)) * 1000;   // δ = g/ωn², mm
  near(delta_from_wn, isoV.requiredStaticDeflection_mm, 'SEAM: δ = g/ωn² equals the core-reported required static deflection ≈ 1.09 mm');
  const delta_mg_over_k = (mass_kg * G_ACCEL) / k_total_Npmm;   // δ = mg/k, mm (k in N/mm)
  near(delta_mg_over_k, delta_from_wn, 'SEAM: mg/k = g/ωn² (the weight sag equals the isolation deflection)');
  const delta_spring = (mass_kg * G_ACCEL / N) / k_each;        // each spring's sag under its share of the weight, mm
  near(delta_spring, delta_from_wn, 'SEAM: each spring sags mg/N ÷ k_each = the same δ under the machine weight');

  // Concrete shake number: the rotating unbalance (m_u·e = 2 kg × 10 mm) on the soft mount.
  const frUnb = need(forcedResponse({ ratio: isoV.ratio, dampingRatio: 0, type: 'unbalance', unbalanceMass: 2, eccentricity: 10, mass: mass_kg }), 'forced response (unbalance)');
  near((frUnb as any).value.magnification, isoV.ratio ** 2 * (frDisp as any).value.magnification, 'SEAM: rotating-unbalance magnification M_r = r²·M (the two forced-response forms)');
  const shake_mm = (frUnb as any).value.amplitude_mm;
  near(shake_mm, (2 * 10 / mass_kg) * (frUnb as any).value.magnification, 'machine shake amplitude X = (m_u·e/m)·M_r ≈ 0.11 mm');
  const F0_N = 2 * (10 / 1000) * Omega * Omega;                 // unbalance force m_u·e·Ω² at speed, N
  const F_transmitted_N = targetTR * F0_N;                      // only TR of it reaches the floor

  // ── 5. DAMPING TRADE-OFF — dampedVibration ζ → transmissibility (damping HURTS) ─
  // A real mount has damping; in the r>√2 isolation region MORE damping means a
  // WORSE (higher) TR. Get ζ from a damping coefficient via the vibration core.
  const c_total = 1900; // N·s/m mount damping
  const dv = need(dampedVibration({ stiffness: k_total_Npm, mass: mass_kg, damping: c_total }), 'dampedVibration');
  const zeta = (dv as any).value.dampingRatio;
  near(zeta, c_total / (2 * Math.sqrt(k_total_Npm * mass_kg)), 'SEAM: dampedVibration ζ = c/(2√(km)) ≈ 0.05');
  const isoDamped = need(transmissibility({ ratio: isoV.ratio, dampingRatio: zeta }), 'transmissibility damped');
  assert((isoDamped as any).value.transmissibility > targetTR, 'SEAM: damping RAISES TR in the isolation region (0.1 → higher) — damping hurts isolation');
  assert((isoDamped as any).value.isolating === true, 'even damped, r=√11 is still isolating (r > √2 holds for any ζ)');

  // ── 6. TUNED-ABSORBER ALTERNATIVE — kill the motion at ONE frequency ────────
  // Alternative to soft-mounting: hard-mount the machine (worst case: its own ωn = Ω,
  // i.e. running at resonance) and bolt on an absorber tuned to Ω. X1 → 0 exactly.
  const k1_res = mass_kg * Omega * Omega; // primary stiffness so ωn1 = Ω (resonance)
  const mu = 0.2;                          // absorber mass ratio m2/m1
  const abs = need(dynamicAbsorber({ m1: mass_kg, k1: k1_res, massRatio: mu, forcingFrequency_Hz: forcingHz, design: true, force: F0_N }), 'dynamicAbsorber design');
  const absV = (abs as any).value;
  assert(absV.tuned === true, 'absorber tuned: ωa = Ω');
  assert(Math.abs(absV.X1_over_deltaSt) < 1e-9, 'SEAM: at tuning the primary amplitude X1 → 0 EXACTLY (the machine stands still)');
  assert(absV.X1_mm !== null && Math.abs(absV.X1_mm) < 1e-6, 'absolute primary amplitude X1 ≈ 0 mm');
  near(absV.absorberForceOverF0, -1, 'SEAM: the absorber spring force k2·X2 = −F0 — it cancels the whole disturbance');
  assert(absV.straddlesPrimary === true, 'THE COST: two new resonances straddle the original ωn');
  near(absV.resonanceSeparationRatio, Math.sqrt(mu), 'SEAM: tuned-to-ωn resonance split = √μ (bigger absorber → wider safe band)');

  // THE TRADE: soft-mount isolation works at ALL r > √2; the absorber only at the
  // tuned frequency. Re-evaluate the SAME sized absorber 10% off-tune → X1 ≠ 0.
  const detuned = need(dynamicAbsorber({ m1: mass_kg, k1: k1_res, m2: absV.m2_kg, k2: absV.k2_N_per_m, forcingFrequency_Hz: forcingHz * 1.1, force: F0_N }), 'dynamicAbsorber detuned');
  assert((detuned as any).value.tuned === false, 'off-tune: absorber no longer tuned');
  assert(Math.abs((detuned as any).value.X1_over_deltaSt) > 1e-3, 'SEAM: 10% off the tuned frequency the primary amplitude is NONZERO — the absorber is single-frequency');

  // ── worked summary ──────────────────────────────────────────────────────────
  console.log('\n── vibration-isolation worked design ──');
  console.log(`machine ${mass_kg} kg, unbalance forcing ${forcingHz} Hz (Ω = ${Omega.toFixed(2)} rad/s)`);
  console.log(`target TR = ${targetTR} (${(isoV.isolationEfficiency * 100).toFixed(0)}% isolation) → r = ${isoV.ratio.toFixed(4)}, ωn = ${wn_req.toFixed(3)} rad/s (${(wn_req / (2 * Math.PI)).toFixed(2)} Hz)`);
  console.log(`mount stiffness k = ${k_total_Npmm.toFixed(1)} N/mm total over ${N} springs = ${k_each.toFixed(1)} N/mm each`);
  console.log(`spring: Ø${wire_d} mm wire, Ø${mean_D} mm mean (index ${mean_D / wire_d}), ${n_coils.toFixed(2)} active coils`);
  console.log(`static deflection δ = ${delta_from_wn.toFixed(3)} mm (technician measures this under the machine weight)`);
  console.log(`unbalance force ${F0_N.toFixed(0)} N at speed → only ${F_transmitted_N.toFixed(0)} N reaches the floor; machine shakes ${shake_mm.toFixed(3)} mm`);
  console.log(`damped (ζ = ${zeta.toFixed(3)}): TR = ${(isoDamped as any).value.transmissibility.toFixed(4)} (> ${targetTR} — damping hurts isolation)`);
  console.log(`tuned absorber alt: m2 = ${absV.m2_kg} kg (μ = ${mu}) drives X1 → 0 at ${forcingHz} Hz, but adds resonances at ${absV.naturalFrequencyRatios[0].toFixed(3)}·ωn and ${absV.naturalFrequencyRatios[1].toFixed(3)}·ωn`);

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-vibration-isolation-integration failure(s)`); process.exit(1); }
  console.log('All engineering-vibration-isolation-integration smoke cases passed');
}

main();
