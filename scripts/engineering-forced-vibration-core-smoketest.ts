/**
 * engineering-forced-vibration-core smoke.
 *
 * Forced steady-state response + vibration isolation, pinned against hand-computed
 * textbook values and the exact anchors of the theory:
 *
 *  • THE √2 CROSSOVER (famous, exact): TR = 1 at r = √2 for EVERY damping ζ — the
 *    (2ζr)² terms cancel top and bottom. Below √2 the mount amplifies (TR > 1),
 *    above √2 it isolates (TR < 1). We pin TR(√2, ζ) = 1 for ζ ∈ {0 … 2}.
 *  • RESONANCE: at r = 1, M = 1/(2ζ) exactly and the phase is exactly 90°. The true
 *    peak of M sits at r = √(1−2ζ²), height 1/(2ζ√(1−ζ²)), just above the r=1 value.
 *  • LIMITS: r→0 → M→1, TR→1 (quasi-static); r→∞ → M→0, TR→0 (inertia wins).
 *  • THE COUNTER-INTUITIVE ISOLATION FACT: in the isolation region (r > √2) MORE
 *    damping gives a HIGHER (worse) TR — the opposite of what it does at resonance.
 *  • Rotating unbalance uses M_r = r²·M: 0 at rest, 1/(2ζ) at r=1, →1 at high speed.
 *  • Isolation DESIGN round-trip: solve r for a target TR, feed it back, recover TR.
 *
 * The smoke IS the proof.
 */

import { forcedResponse, transmissibility } from '../src/lib/engineeringForcedVibrationCore';

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

const G = 9.80665;
const SQRT2 = Math.SQRT2;
// M and TR reference evaluators (independent re-derivation for cross-checks).
const Mref = (r: number, z: number) => 1 / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);
const TRref = (r: number, z: number) => Math.sqrt(1 + (2 * z * r) ** 2) / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);

function main() {
  // ─── THE √2 CROSSOVER: TR(√2, ζ) = 1 for ANY damping ─────────────
  {
    for (const z of [0, 0.05, 0.1, 0.25, 0.5, 1, 2]) {
      const t = ok(transmissibility({ ratio: SQRT2, dampingRatio: z }), `TR(√2, ζ=${z})`);
      near(t.transmissibility, 1, `√2 crossover: TR = 1 exactly at ζ=${z} (damping-independent)`);
    }
    const edge = ok(transmissibility({ ratio: SQRT2, dampingRatio: 0.2 }), 'crossover regime');
    assert(edge.regime === 'crossover', 'r = √2 is the crossover regime');
    assert(edge.isolating === false, 'r = √2 is NOT yet isolating (isolation is r > √2)');
  }

  // ─── Below √2 amplifies (TR > 1); above √2 isolates (TR < 1) ──────
  {
    for (const r of [0.5, 1.0, 1.2]) {
      const t = ok(transmissibility({ ratio: r, dampingRatio: 0.05 }), `TR below √2 at r=${r}`);
      assert(t.transmissibility > 1, `r=${r} < √2 → TR > 1 (amplification)`);
      assert(t.regime === 'amplification' && !t.isolating, `r=${r} labelled amplification`);
    }
    for (const r of [2, 3, 5]) {
      const t = ok(transmissibility({ ratio: r, dampingRatio: 0.05 }), `TR above √2 at r=${r}`);
      assert(t.transmissibility < 1, `r=${r} > √2 → TR < 1 (isolation)`);
      assert(t.regime === 'isolation' && t.isolating, `r=${r} labelled isolation`);
      near(t.isolationEfficiency!, 1 - t.transmissibility, `isolation efficiency = 1 − TR at r=${r}`);
    }
  }

  // ─── RESONANCE: M(1) = 1/(2ζ) exactly; phase = 90° ───────────────
  {
    for (const z of [0.05, 0.1, 0.25]) {
      const f = ok(forcedResponse({ ratio: 1, dampingRatio: z }), `M at resonance ζ=${z}`);
      near(f.magnification, 1 / (2 * z), `resonance M = 1/(2ζ) = ${1 / (2 * z)} at ζ=${z}`);
      near(f.resonantMagnification, 1 / (2 * z), `reported resonantMagnification = 1/(2ζ) at ζ=${z}`);
      near(f.phaseLagDeg, 90, `phase is exactly 90° at resonance (ζ=${z})`);
      assert(f.regime === 'resonance' && f.isResonant, `r=1 labelled resonance at ζ=${z}`);
    }
  }

  // ─── PEAK of M is at r = √(1−2ζ²), just above the r=1 value ───────
  {
    const z = 0.1;
    const f = ok(forcedResponse({ ratio: 1, dampingRatio: z }), 'peak info');
    near(f.peakRatio!, Math.sqrt(1 - 2 * z * z), 'peak of M at r = √(1−2ζ²) = 0.98995 (below resonance)');
    near(f.peakMagnification!, 1 / (2 * z * Math.sqrt(1 - z * z)), 'peak height = 1/(2ζ√(1−ζ²)) = 5.02519');
    assert(f.peakMagnification! > f.resonantMagnification, 'peak M exceeds the r=1 value (peak is off-resonance)');
    assert(f.peakRatio! < 1, 'displacement peak sits just BELOW resonance');
    // heavy damping (ζ ≥ 1/√2) has no interior peak
    const heavy = ok(forcedResponse({ ratio: 1, dampingRatio: 0.8 }), 'no peak when ζ>1/√2');
    assert(heavy.peakRatio === null, 'ζ = 0.8 > 1/√2 → M monotone, no interior peak');
  }

  // ─── LOW-frequency limit r→0: M→1, TR→1, phase→0 ─────────────────
  {
    const f = ok(forcedResponse({ ratio: 0.001, dampingRatio: 0.1 }), 'low-freq forced');
    near(f.magnification, 1, 'r→0: M → 1 (mass follows the force quasi-statically)');
    assert(f.phaseLagDeg >= 0 && f.phaseLagDeg < 0.02, 'r→0: phase lag → 0 (in phase with the force)');
    const t = ok(transmissibility({ ratio: 0.001, dampingRatio: 0.1 }), 'low-freq TR');
    near(t.transmissibility, 1, 'r→0: TR → 1 (all of the force is transmitted)');
  }

  // ─── HIGH-frequency limit r→∞: M→0, TR→0 ─────────────────────────
  {
    const f = ok(forcedResponse({ ratio: 100, dampingRatio: 0.1 }), 'high-freq forced');
    assert(f.magnification < 1e-3, 'r→∞: M → 0 (too much inertia to keep up)');
    assert(f.regime === 'above_resonance', 'r=100 is above resonance');
    const t = ok(transmissibility({ ratio: 100, dampingRatio: 0.1 }), 'high-freq TR');
    assert(t.transmissibility < 1e-2, 'r→∞: TR → 0 (near-total isolation)');
    assert(t.isolating, 'r=100 is deep in the isolation region');
  }

  // ─── THE COUNTER-INTUITIVE FACT: damping HURTS isolation (r>√2) ───
  {
    const a = ok(transmissibility({ ratio: 3, dampingRatio: 0.1 }), 'TR(3, 0.1)');
    const b = ok(transmissibility({ ratio: 3, dampingRatio: 0.3 }), 'TR(3, 0.3)');
    const c = ok(transmissibility({ ratio: 3, dampingRatio: 0.7 }), 'TR(3, 0.7)');
    assert(a.transmissibility < b.transmissibility, 'r=3: MORE damping → HIGHER TR (0.1 < 0.3)');
    assert(b.transmissibility < c.transmissibility, 'r=3: MORE damping → HIGHER TR (0.3 < 0.7)');
    assert(a.isolating && b.isolating && c.isolating, 'all still isolating (r=3 > √2), just less effectively');
    near(a.transmissibility, TRref(3, 0.1), 'TR(3,0.1) matches the closed form');
    // ...and the OPPOSITE below √2: damping HELPS (tames the peak you pass through)
    const p = ok(transmissibility({ ratio: 0.5, dampingRatio: 0.1 }), 'TR(0.5, 0.1)');
    const q = ok(transmissibility({ ratio: 0.5, dampingRatio: 0.5 }), 'TR(0.5, 0.5)');
    assert(p.transmissibility > q.transmissibility, 'r=0.5 < √2: MORE damping → LOWER TR (damping helps here)');
    assert(p.transmissibility > 1 && q.transmissibility > 1, 'both amplify below √2 — the design tension is real');
  }

  // ─── TEXTBOOK forced case: ζ=0.1, r=0.5, k=100 N/m, F0=10 N, m=1 kg ─
  {
    // M = 1/√(0.75² + 0.1²) = 1/√0.5725 = 1.321638; φ = atan2(0.1,0.75) = 7.5946°.
    // δ_st = F0/k = 0.1 m = 100 mm; X = δ_st·M = 132.164 mm.
    const f = ok(forcedResponse({ ratio: 0.5, dampingRatio: 0.1, force: 10, stiffness: 100, mass: 1 }), 'textbook forced');
    near(f.magnification, 1.321638, 'M = 1/√((1−r²)²+(2ζr)²) = 1.321638');
    near(f.magnification, Mref(0.5, 0.1), 'M matches the independent closed form');
    near(f.phaseLagDeg, 7.5946, 'phase φ = atan2(2ζr, 1−r²) = 7.5946°');
    near(f.staticDeflection_mm!, 100, 'static deflection δ_st = F0/k = 100 mm');
    near(f.amplitude_mm!, 132.1638, 'amplitude X = δ_st·M = 132.164 mm');
    near(f.ratio, 0.5, 'frequency ratio r = 0.5');
    assert(f.regime === 'below_resonance', 'r=0.5 is below resonance');
  }

  // ─── COMPOSITION with the vibration core: ωn from k+m, r = ω/ωn ───
  {
    // stiffness=100, mass=1 → ωn = √100 = 10 rad/s; ω = 5 → r = 0.5 (same case).
    const f = ok(forcedResponse({ stiffness: 100, mass: 1, omega: 5, dampingRatio: 0.1, force: 10 }), 'compose ωn from k,m');
    near(f.omega_n_rad_s!, 10, 'ωn = √(k/m) = 10 rad/s (via vibration core)');
    near(f.omega_rad_s!, 5, 'forcing ω = 5 rad/s echoed');
    near(f.ratio, 0.5, 'r = ω/ωn = 0.5 computed from physical inputs');
    near(f.magnification, 1.321638, 'same M as the direct-ratio case — composition is consistent');
  }

  // ─── COMPOSITION of damping: ζ from a coefficient c via the sibling ─
  {
    // k=1000, m=1, c=10 → ζ = 10/(2√1000) = 0.158114; at r=1, M = 1/(2ζ) = 3.16228.
    const f = ok(forcedResponse({ stiffness: 1000, mass: 1, damping: 10, ratio: 1 }), 'compose ζ from c');
    near(f.dampingRatio, 10 / (2 * Math.sqrt(1000)), 'ζ = c/(2√(km)) = 0.158114 (via vibration core)');
    near(f.magnification, 1 / (2 * (10 / (2 * Math.sqrt(1000)))), 'M(r=1) = 1/(2ζ) = 3.16228');
    // a damping coefficient with no k/m cannot be converted → error
    assert(!forcedResponse({ ratio: 1, damping: 10 }).ok, 'damping coefficient without k+m is rejected');
  }

  // ─── Phase crosses 90° through resonance ─────────────────────────
  {
    const below = ok(forcedResponse({ ratio: 0.5, dampingRatio: 0.1 }), 'phase below');
    const above = ok(forcedResponse({ ratio: 2, dampingRatio: 0.1 }), 'phase above');
    assert(below.phaseLagDeg < 90, 'below resonance the response lags by < 90°');
    assert(above.phaseLagDeg > 90, 'above resonance the response lags by > 90°');
    near(above.phaseLagDeg, Math.atan2(2 * 0.1 * 2, 1 - 4) * 180 / Math.PI, 'phase(r=2) = 172.405°');
  }

  // ─── ROTATING UNBALANCE: M_r = r²·M ──────────────────────────────
  {
    const res = ok(forcedResponse({ ratio: 1, dampingRatio: 0.1, type: 'unbalance' }), 'unbalance at resonance');
    assert(res.magnificationType === 'unbalance', 'magnification uses the unbalance form');
    near(res.magnification, 1 / (2 * 0.1), 'M_r(r=1) = 1²·1/(2ζ) = 5 (same as displacement resonance)');
    const hi = ok(forcedResponse({ ratio: 100, dampingRatio: 0.1, type: 'unbalance' }), 'unbalance high-speed');
    near(hi.magnification, 1, 'M_r → 1 at high speed (NOT 0 — unbalance force grows as ω²)');
    // unbalance peak sits ABOVE resonance, at r = 1/√(1−2ζ²)
    near(res.peakRatio!, 1 / Math.sqrt(1 - 2 * 0.01), 'unbalance peak at r = 1/√(1−2ζ²) = 1.01015 (above resonance)');
    assert(res.peakRatio! > 1, 'unbalance peak is ABOVE resonance (opposite of displacement)');
    // amplitude X = (m_u·e/m)·M_r: m_u=0.1 kg, e=10 mm, m=1 kg, r=1 → X = 1·5 = 5 mm
    const amp = ok(forcedResponse({ ratio: 1, dampingRatio: 0.1, type: 'unbalance', unbalanceMass: 0.1, eccentricity: 10, mass: 1 }), 'unbalance amplitude');
    near(amp.amplitude_mm!, 5, 'X = (m_u·e/m)·M_r = (0.1·10/1)·5 = 5 mm');
  }

  // ─── Isolation efficiency reporting ──────────────────────────────
  {
    const t = ok(transmissibility({ ratio: 3, dampingRatio: 0.05 }), 'isolation efficiency');
    near(t.transmissibility, TRref(3, 0.05), 'TR(3, 0.05) = 0.13041');
    assert(t.isolating, 'r=3 isolates');
    near(t.isolationEfficiency!, 1 - TRref(3, 0.05), 'efficiency = 1 − TR = 0.86959 (≈87% of the force blocked)');
    assert(t.regime === 'isolation', 'regime = isolation');
  }

  // ─── ISOLATION DESIGN round-trip: solve r for a target TR ────────
  {
    // Undamped: TR = 1/(r²−1) for r>√2 → r² = 1 + 1/TR. TR=0.1 → r = √11 = 3.31662.
    const s = ok(transmissibility({ targetTR: 0.1, dampingRatio: 0 }), 'solve r for TR=0.1, ζ=0');
    assert(s.mode === 'solve', 'solve mode engaged by a target TR');
    near(s.ratio, Math.sqrt(11), 'solved r = √(1 + 1/TR) = √11 = 3.31662');
    near(s.targetTR!, 0.1, 'target TR echoed = 0.1');
    // feed the solved r back → recover the target TR
    const back = ok(transmissibility({ ratio: s.ratio, dampingRatio: 0 }), 'feed r back');
    near(back.transmissibility, 0.1, 'round-trip: evaluating the solved r recovers TR = 0.1');

    // with damping the quadratic still solves and round-trips
    const sd = ok(transmissibility({ targetTR: 0.2, dampingRatio: 0.1 }), 'solve r for TR=0.2, ζ=0.1');
    const bd = ok(transmissibility({ ratio: sd.ratio, dampingRatio: 0.1 }), 'feed damped r back');
    near(bd.transmissibility, 0.2, 'damped round-trip recovers TR = 0.2');
    assert(sd.ratio > SQRT2, 'the isolation solution has r > √2');
  }

  // ─── ISOLATION DESIGN: needed static deflection from a forcing freq ─
  {
    // solve TR=0.1 (ζ=0) with the disturbance at 50 Hz → needed ωn = ω/r, δ = g/ωn².
    const s = ok(transmissibility({ targetTR: 0.1, dampingRatio: 0, forcingFrequency_Hz: 50 }), 'design deflection');
    near(s.forcingFrequency_Hz!, 50, 'forcing frequency echoed = 50 Hz');
    near(s.omega_n_required_rad_s! * s.ratio, 2 * Math.PI * 50, 'ωn·r = ω (the required natural frequency)');
    near(s.requiredStaticDeflection_mm!, G / (s.omega_n_required_rad_s! ** 2) * 1000, 'δ = g/ωn² (softer mount isolates more)');
    assert(s.requiredStaticDeflection_mm! > 0 && s.requiredStaticDeflection_mm! < 5, 'needed static deflection ≈ 1.09 mm');
  }

  // ─── Target given as isolation percent / fraction ────────────────
  {
    const byPct = ok(transmissibility({ isolationPercent: 90, dampingRatio: 0 }), 'isolationPercent=90');
    near(byPct.targetTR!, 0.1, '90% isolation → TR target 0.10');
    near(byPct.ratio, Math.sqrt(11), '90% isolation → same r = √11');
    const byFrac = ok(transmissibility({ isolation: 0.9, dampingRatio: 0 }), 'isolation=0.9');
    near(byFrac.targetTR!, 0.1, 'isolation fraction 0.9 → TR target 0.10');
  }

  // ─── Regime labels across the sweep ──────────────────────────────
  {
    assert(ok(forcedResponse({ ratio: 0.3, dampingRatio: 0.1 }), 'reg below').regime === 'below_resonance', 'r=0.3 below_resonance');
    assert(ok(forcedResponse({ ratio: 1, dampingRatio: 0.1 }), 'reg at').regime === 'resonance', 'r=1 resonance');
    assert(ok(forcedResponse({ ratio: 4, dampingRatio: 0.1 }), 'reg above').regime === 'above_resonance', 'r=4 above_resonance');
  }

  // ─── Validation & fail-closed ────────────────────────────────────
  {
    assert(!forcedResponse({ dampingRatio: 0.1 }).ok, 'forcedResponse without a ratio or forcing frequency rejected');
    assert(!forcedResponse({ ratio: 0.5, dampingRatio: -0.1 }).ok, 'negative damping ratio rejected');
    assert(!forcedResponse({ ratio: NaN as any, dampingRatio: 0.1 }).ok, 'non-finite ratio rejected');
    assert(!transmissibility({ dampingRatio: 0.1 }).ok, 'transmissibility with neither a ratio nor a target rejected');
    assert(!transmissibility({ targetTR: 1.5 }).ok, 'target TR ≥ 1 rejected (not an isolation target)');
    assert(!transmissibility({ targetTR: 0 }).ok, 'target TR = 0 rejected');
    assert(!transmissibility({ targetTR: -0.2 }).ok, 'negative target TR rejected');
    assert(!transmissibility({ ratio: 2, damping: 5 }).ok, 'damping coefficient without k+m rejected in transmissibility');
    // undamped default: a bare ratio still evaluates (ζ assumed 0)
    const undamped = ok(transmissibility({ ratio: 3 }), 'undamped default');
    near(undamped.transmissibility, TRref(3, 0), 'no damping given → ζ=0 assumed, TR = 1/(r²−1) = 0.125');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-forced-vibration-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-forced-vibration-core smoke cases passed.');
}

main();
