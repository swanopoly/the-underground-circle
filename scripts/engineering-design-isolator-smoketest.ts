/**
 * engineering-design-isolator smoke.
 *
 * designIsolator packages the PROVEN vibration-isolation composition chain
 * (isolation % → TR → r > √2 → ωn → k_total → standard-wire spring geometry)
 * into one call, so this smoke does what the design-core smoke does for the
 * bracket: it ROUND-TRIPS every seam back through the composed cores rather
 * than trusting the designer's arithmetic — the returned spring's d/D/n must
 * reproduce k_each through calcCore springRate; the returned k_total must
 * reproduce the realised fn through the vibration core and the realised TR
 * through the forced-vibration core; the static deflection must agree computed
 * both ways (mg/k and g/ωn², the two faces of one fact); and the realised
 * isolation must MEET OR EXCEED the request, never undershoot it.
 */

import { designIsolator, STANDARD_WIRE_MM } from '../src/lib/engineeringDesignIsolatorCore';
import { transmissibility } from '../src/lib/engineeringForcedVibrationCore';
import { naturalFrequency } from '../src/lib/engineeringVibrationCore';
import { springRate } from '../src/lib/engineeringCalcCore';
import { springGeometry } from '../src/lib/engineeringHelixCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function need<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(label); console.error(`FAIL: ${label} — not ok: ${r.error}`); process.exit(1); }
  return r.value;
}

const G_ACCEL = 9.80665;

function main() {
  // ─── Worked case: 250 kg machine at 1500 rpm, 90% isolation, 4 springs ─────
  const iso = need(designIsolator({ mass_kg: 250, speed_rpm: 1500, isolationPercent: 90 }), 'worked 250 kg / 1500 rpm / 90%');
  const d = iso.dimensions;
  assert(iso.type === 'isolator', "type is 'isolator'");
  assert((STANDARD_WIRE_MM as readonly number[]).includes(d.wireDiameter), 'wire diameter comes from the standard list');
  assert(d.wireDiameter === 12, 'sized Ø12 mm wire');
  assert(d.springIndex === 7, 'index relaxed from the default 8 to C = 7 to land a sane coil count');
  assert(d.meanDiameter === d.springIndex * d.wireDiameter, 'mean diameter D = C·d = 84 mm');
  assert(d.activeCoils === 3, '3 active coils (2.474 raw, softened to the half-coil that still isolates)');
  assert(d.totalCoils === d.activeCoils + 2, 'total coils = active + 2 closed ends');
  near(d.solidLength, d.totalCoils * d.wireDiameter, 'solid length Ls = (n+2)·d = 60 mm');
  assert(d.freeLength === 70, 'free length 70 mm (solid + working-travel margin)');
  assert(d.solidLength < d.freeLength, 'solid length < free length');
  assert(d.freeLength / d.totalCoils > d.wireDiameter, 'free pitch > wire diameter (coils not touching at free length)');
  assert(d.springIndex >= 4 && d.springIndex <= 12, 'spring index C in the practical 4–12 band');
  assert(d.springCount === 4, 'defaulted to 4 corner springs');

  // ROUND-TRIP 1: the returned wire/coil geometry reproduces k_each via calcCore.
  const sr = springRate({ wireDiameter: d.wireDiameter, meanDiameter: d.meanDiameter, activeCoils: d.activeCoils, material: 'steel' });
  assert(sr.ok, 'calcCore springRate accepts the returned geometry');
  if (sr.ok) near(sr.value, d.k_each_N_mm, 'SEAM: springRate(d, D, n) reproduces the returned k_each = 115.598 N/mm');
  near(d.k_each_N_mm * d.springCount, d.k_total_N_mm, 'k_total = springCount × k_each');
  near(d.k_total_N_mm, 462.391, 'hand check: k_total = 4 × G·12⁴/(8·84³·3) ≈ 462.39 N/mm');

  // ROUND-TRIP 2: the returned k_total reproduces the realised fn via the vibration core.
  const nf = need(naturalFrequency({ springRate: d.k_total_N_mm, mass: 250 }), 'naturalFrequency from returned k_total');
  near(nf.frequency_Hz, d.realisedFn_Hz, 'SEAM: √(k/m) from the returned k_total = the returned realised fn');
  near(d.realisedFn_Hz, 6.845, 'realised mount fn ≈ 6.845 Hz');
  near(d.requiredFn_Hz, 25 / Math.sqrt(11) / 1, 'required fn = f/√(1+1/TR) = 25/√11 ≈ 7.538 Hz', 2e-3);
  assert(d.realisedFn_Hz <= d.requiredFn_Hz + 1e-9, 'realised fn ≤ required fn (coil rounding only ever SOFTENS the mount)');

  // ROUND-TRIP 3: the returned k_total reproduces the realised TR via the forced-vibration core.
  const ev = need(transmissibility({ forcingFrequency_Hz: 25, springRate: d.k_total_N_mm, mass: 250, dampingRatio: 0 }), 'transmissibility at the realised mount');
  near(ev.transmissibility, d.transmissibility, 'SEAM: core TR at (25 Hz, k_total, 250 kg) = the returned TR');
  assert(1 - ev.transmissibility >= 0.90, 'ROUND-TRIP: realised isolation through the core ≥ the 90% target');
  near(d.transmissibility, 1 / (d.frequencyRatio ** 2 - 1), 'undamped identity TR = 1/(r²−1) at the returned r');
  near(d.realisedIsolationPercent, (1 - d.transmissibility) * 100, 'returned isolation % = 100·(1 − TR)');
  assert(d.realisedIsolationPercent >= 90, 'realised isolation NEVER below the target');
  assert(d.realisedIsolationPercent <= 93, 'realised isolation within +3 points of the target (not absurdly overdesigned)');
  assert(d.frequencyRatio > Math.SQRT2, 'realised r > √2 — the mount sits in the ISOLATION region');

  // Two faces of one fact: δ_static from mg/k and from g/ωn² agree.
  near(d.staticDeflection_mm, (250 * G_ACCEL) / d.k_total_N_mm, 'δ_static = mg/k_total ≈ 5.302 mm');
  const wnReal = 2 * Math.PI * d.realisedFn_Hz;
  near(d.staticDeflection_mm, (G_ACCEL / (wnReal * wnReal)) * 1000, 'SEAM: δ_static = g/ωn² — the same sag from the frequency face');

  // Spring-set mass round-trips through the helix core's developed-length volume.
  const geo = need(springGeometry({ wireDiameter: d.wireDiameter, meanDiameter: d.meanDiameter, freeLength: d.freeLength, totalCoils: d.totalCoils, activeCoils: d.activeCoils }), 'springGeometry of the returned spring');
  near(iso.mass_kg, d.springCount * geo.wireVolume * 7.85e-6, 'SEAM: set mass = 4 × wire volume × steel density ≈ 4.69 kg');
  assert(iso.mass_kg > 0.5 && iso.mass_kg < 25, 'spring-set mass is a sane fraction of the 250 kg machine');

  // Deliverables.
  assert(iso.bpy.includes('stl_export') && iso.bpy.length > 500, 'a ready-to-compile Blender spring script is returned');
  assert(/isolat/i.test(iso.summary), 'summary states the isolation delivered');
  assert(iso.safety.note.includes('√2'), 'safety note states the r > √2 requirement');
  assert(iso.safety.realisedSafetyFactor! > 1, 'safety factor = r/√2 margin over the crossover > 1');
  near(iso.safety.realisedSafetyFactor!, d.frequencyRatio / Math.SQRT2, 'safety factor is exactly r/√2');
  assert(iso.notes.length >= 5, 'rich notes narrate the whole chain');

  // ─── rpm and Hz are the same duty ──────────────────────────────────────────
  const isoHz = need(designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 90 }), 'same duty via Hz');
  near(isoHz.dimensions.k_total_N_mm, d.k_total_N_mm, '1500 rpm and 25 Hz produce the SAME design (k_total)');
  assert(isoHz.dimensions.wireDiameter === d.wireDiameter, '…and the same wire diameter');

  // ─── The √2 law as an impossibility verdict ────────────────────────────────
  // 95% isolation of a 1 Hz disturbance needs fn ≈ 0.22 Hz → a ~5.2 m static
  // sag. No practical mount exists; the designer must SAY so, not emit one.
  const impossible = designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 1, isolationPercent: 95 });
  assert(!impossible.ok, 'a 1 Hz disturbance at 95% isolation returns ok:false (cannot isolate near/below resonance)');
  if (!impossible.ok) {
    assert(/sag|impractical|impossible/i.test(impossible.error), 'the refusal explains the impractical static sag');
    assert(/√2/.test(impossible.error), 'the refusal cites the √2 crossover physics');
  }

  // ─── Requested index honoured when feasible (5 Hz is soft-spring territory) ─
  const soft = need(designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 5, isolationPercent: 90 }), '5 Hz / 90% soft mount');
  assert(soft.dimensions.springIndex === 8, 'the default index 8 is used unrelaxed when it fits');
  assert(soft.dimensions.wireDiameter === 2, 'a soft mount needs thin Ø2 mm wire');
  assert(soft.dimensions.activeCoils === 7, '…and 7 active coils');
  assert(soft.dimensions.realisedIsolationPercent >= 90, 'soft mount still meets its target');
  assert(soft.dimensions.staticDeflection_mm > 100, 'a 5 Hz-disturbance mount sags >100 mm — why lower frequencies become impossible');

  // ─── MONOTONICITY: more isolation → softer; heavier → stiffer at the SAME fn ─
  const iso95 = need(designIsolator({ mass_kg: 250, speed_rpm: 1500, isolationPercent: 95 }), '95% variant');
  assert(iso95.dimensions.k_total_N_mm < d.k_total_N_mm, 'more isolation demanded → SOFTER springs (lower k_total)');
  assert(iso95.dimensions.staticDeflection_mm > d.staticDeflection_mm, 'more isolation → larger static deflection');
  assert(iso95.dimensions.realisedIsolationPercent >= 95, '95% variant meets its own target');
  assert(iso95.dimensions.realisedIsolationPercent <= 98, '…within +3 points');
  assert(iso95.dimensions.frequencyRatio > d.frequencyRatio, 'more isolation → larger frequency ratio r');

  const heavy = need(designIsolator({ mass_kg: 500, speed_rpm: 1500, isolationPercent: 90 }), '500 kg variant');
  assert(heavy.dimensions.k_total_N_mm > d.k_total_N_mm, 'heavier machine at the same target → HIGHER k_total');
  near(heavy.dimensions.requiredFn_Hz, d.requiredFn_Hz, 'SEAM: the required fn is mass-independent — same target, same r, same fn', 1e-6);
  assert(heavy.dimensions.realisedFn_Hz <= heavy.dimensions.requiredFn_Hz + 1e-9, 'heavy variant also lands at or below the required fn');
  assert(heavy.dimensions.realisedIsolationPercent >= 90, 'heavy variant meets the 90% target');

  // ─── Damped design (ζ passed through solve AND re-check) ───────────────────
  const damped = need(designIsolator({ mass_kg: 250, speed_rpm: 1500, isolationPercent: 90, dampingRatio: 0.1 }), 'damped ζ=0.1 design');
  assert(damped.dimensions.realisedIsolationPercent >= 90, 'damped design still meets 90% — the re-check uses the damped TR');
  assert(damped.dimensions.k_total_N_mm < d.k_total_N_mm, 'damping hurts isolation → the damped mount must be SOFTER than the undamped one');
  const evD = need(transmissibility({ ratio: damped.dimensions.frequencyRatio, dampingRatio: 0.1 }), 'damped TR round-trip');
  near(evD.transmissibility, damped.dimensions.transmissibility, 'SEAM: core damped TR at the returned r = the returned TR', 5e-3);
  assert(evD.transmissibility > 1 / (damped.dimensions.frequencyRatio ** 2 - 1), 'at the same r the damped TR exceeds the undamped TR (damping raises TR in the isolation region)');

  // ─── Input validation (DesignResult error strings) ─────────────────────────
  assert(!designIsolator({ disturbanceFrequency_Hz: 25, isolationPercent: 90 } as any).ok, 'missing mass rejected');
  assert(!designIsolator({ mass_kg: 250, isolationPercent: 90 } as any).ok, 'missing disturbance frequency/rpm rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 0 }).ok, 'isolationPercent 0 rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 100 }).ok, 'isolationPercent 100 rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 120 }).ok, 'isolationPercent 120 rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 90, springIndex: 3 }).ok, 'spring index below 4 rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 90, springIndex: 13 }).ok, 'spring index above 12 rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 90, material: 'unobtainium' }).ok, 'unknown material rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 90, springCount: 0 }).ok, 'springCount 0 rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 90, springCount: 2.5 }).ok, 'fractional springCount rejected');
  assert(!designIsolator({ mass_kg: 250, disturbanceFrequency_Hz: 25, isolationPercent: 90, dampingRatio: -0.1 }).ok, 'negative damping ratio rejected');

  // ─── worked summary ────────────────────────────────────────────────────────
  console.log('\n── isolator worked design (250 kg @ 1500 rpm, 90% target, 4 springs) ──');
  console.log(iso.summary);
  console.log(`spring: Ø${d.wireDiameter} wire / Ø${d.meanDiameter} mean (C=${d.springIndex}), ${d.activeCoils}+2 coils, free ${d.freeLength} / solid ${d.solidLength} mm`);
  console.log(`k = ${d.k_each_N_mm} N/mm each × ${d.springCount} = ${d.k_total_N_mm} N/mm; fn ${d.realisedFn_Hz} Hz (required ≤ ${d.requiredFn_Hz}); r = ${d.frequencyRatio}`);
  console.log(`TR = ${d.transmissibility} → ${d.realisedIsolationPercent}% isolation (target 90%); δ_static = ${d.staticDeflection_mm} mm; spring set ${iso.mass_kg} kg`);

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-design-isolator smoke failure(s)`); process.exit(1); }
  console.log('All engineering-design-isolator smoke cases passed — one call turns an isolation duty into a re-checked spring mount.');
}

main();
