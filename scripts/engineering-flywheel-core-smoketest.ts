/**
 * engineering-flywheel-core smoke.
 *
 * Flywheel energy-storage & speed-fluctuation sizing, pinned to HAND-COMPUTED
 * references. Energy math lives in SI (I in kg·m², ω in rad/s ⇒ KE in J); the
 * shared MATERIALS density is kg/mm³ (mass = ρ·V_mm³ = kg) and radii convert
 * mm → m exactly where inertia/rim-speed need them.
 *
 *   shape   at the SAME mass & radius a thin RIM stores TWICE a solid DISC's
 *           inertia (I_rim = m·r² vs I_disc = ½·m·r²) — the reason flywheels are
 *           rims; an annulus interpolates (ri=0 ⇒ disc, ri=ro ⇒ rim).
 *   sizing  ΔE = I·ωavg²·Cs. Press wheel 200 rpm (ω = 20π/3), Cs = 0.05,
 *           ΔE = 5000 J ⇒ required I = 5000/(ω²·0.05) = 227.98 kg·m²; halving Cs
 *           DOUBLES I (I ∝ 1/Cs). Sizing KE = ½Iω² = ΔE/(2Cs) = 50,000 J.
 *   Khurmi  I = m·k² = 6500·1.8² = 21,060 kg·m², ΔE = 56 kN·m, N = 120 rpm
 *           ⇒ Cs = ΔE/(I·ω²) = 0.0168 (Theory of Machines flywheel example).
 *   energy  KE = ½Iω²; doubling ω QUADRUPLES KE (KE ∝ ω²); ωmax/ωmin = ωavg(1±Cs/2).
 *   burst   σ = ρv²; steel (7850 kg/m³) at v = 50 m/s ⇒ 19.625 MPa; burst speed
 *           v_burst = √(σ_allow/ρ) is SIZE-INDEPENDENT (a material property).
 *   worked  250 rpm, Cs = 0.03, ΔE = 4000 J ⇒ I = 194.54 kg·m²; a 0.6 m rim
 *           ⇒ mass = I/r² = 540.4 kg (round-trips back through flywheelInertia).
 */

import {
  flywheelInertia, flywheelEnergy, flywheelStress,
} from '../src/lib/engineeringFlywheelCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

function main() {
  const TWO_PI = 2 * Math.PI;

  // ─── SHAPE anchor: rim keeps 2× a disc's inertia per mass ─────────
  {
    const disc = ok(flywheelInertia({ shape: 'disc', mass: 100, radius: 500 }), 'disc mass100 r500');
    const rim = ok(flywheelInertia({ shape: 'rim', mass: 100, radius: 500 }), 'rim mass100 r500');
    near(disc.inertia_kg_m2, 0.5 * 100 * 0.5 ** 2, 'I_disc = ½·m·r² = 12.5 kg·m² (r=0.5 m)');
    near(disc.inertia_kg_m2, 12.5, 'I_disc hand value = 12.5 kg·m²');
    near(rim.inertia_kg_m2, 100 * 0.5 ** 2, 'I_rim = m·r² = 25 kg·m²');
    near(rim.inertia_kg_m2, 25, 'I_rim hand value = 25 kg·m²');
    near(rim.inertia_kg_m2 / disc.inertia_kg_m2, 2, 'ANCHOR: I_rim / I_disc = 2 (mass at the rim is twice as effective)');
    assert(disc.shape === 'disc' && rim.shape === 'rim', 'shapes echoed');
    // Radius of gyration: disc k = r/√2, rim k = r.
    near(disc.radiusOfGyration_m!, 0.5 / Math.SQRT2, 'disc k = r/√2');
    near(rim.radiusOfGyration_m!, 0.5, 'rim k = r');
  }

  // ─── Annulus interpolates disc (ri=0) ↔ rim (ri=ro) ──────────────
  {
    const solid = ok(flywheelInertia({ shape: 'annulus', mass: 100, outerRadius: 500, innerRadius: 0 }), 'annulus ri=0');
    const allRim = ok(flywheelInertia({ shape: 'annulus', mass: 100, outerRadius: 500, innerRadius: 500 }), 'annulus ri=ro');
    near(solid.inertia_kg_m2, 12.5, 'annulus ri=0 → I = ½·m·ro² = disc (12.5)');
    near(allRim.inertia_kg_m2, 25, 'annulus ri=ro → I = ½·m·2r² = m·r² = rim (25)');
    // General annulus: ro=500, ri=300 → I = ½·100·(0.5²+0.3²) = ½·100·0.34 = 17.
    const mid = ok(flywheelInertia({ shape: 'annulus', mass: 100, outerRadius: 500, innerRadius: 300 }), 'annulus 500/300');
    near(mid.inertia_kg_m2, 0.5 * 100 * (0.5 ** 2 + 0.3 ** 2), 'annulus I = ½·m·(ro²+ri²) = 17 kg·m²');
    near(mid.inertia_kg_m2, 17, 'annulus hand value = 17 kg·m²');
    assert(mid.inertia_kg_m2 > solid.inertia_kg_m2 && mid.inertia_kg_m2 < allRim.inertia_kg_m2, 'annulus lies between disc and rim');
  }

  // ─── Mass from geometry (composes MATERIALS density, kg/mm³) ──────
  {
    const g = ok(flywheelInertia({ shape: 'disc', material: 'steel', radius: 300, thickness: 50 }), 'steel disc geometry');
    const V = Math.PI * 300 ** 2 * 50; // mm³
    near(g.volume_mm3!, V, 'volume = π·r²·t = 14,137,167 mm³');
    near(g.mass_kg!, 7.85e-6 * V, 'mass = ρ·V (steel 7.85e-6 kg/mm³) ≈ 110.98 kg');
    near(g.mass_kg!, 110.976761, 'mass hand value ≈ 110.98 kg', 1e-5);
    near(g.inertia_kg_m2, 0.5 * (7.85e-6 * V) * 0.3 ** 2, 'I = ½·m·(0.3 m)² ≈ 4.994 kg·m²');
    near(g.inertia_kg_m2, 4.993954, 'I hand value ≈ 4.994 kg·m²', 1e-5);
    assert(g.density_kg_per_mm3 === 7.85e-6, 'steel density echoed (kg/mm³)');
    // Diameter alias gives the same wheel.
    const gd = ok(flywheelInertia({ shape: 'disc', material: 'steel', diameter: 600, thickness: 50 }), 'steel disc via diameter');
    near(gd.inertia_kg_m2, g.inertia_kg_m2, 'diameter 600 == radius 300 (same inertia)');
    // Annular geometry subtracts the bore ring from the mass.
    const ann = ok(flywheelInertia({ shape: 'annulus', material: 'steel', outerRadius: 300, innerRadius: 150, thickness: 50 }), 'steel annulus geometry');
    near(ann.volume_mm3!, Math.PI * (300 ** 2 - 150 ** 2) * 50, 'annulus V = π·(ro²−ri²)·t (bore removed)');
    assert(ann.mass_kg! < g.mass_kg!, 'annulus is lighter than the solid disc (bore removed)');
  }

  // ─── Inertia given directly (echoed) ─────────────────────────────
  {
    const d = ok(flywheelInertia({ inertia: 42 }), 'inertia direct');
    near(d.inertia_kg_m2, 42, 'inertia echoed = 42 kg·m²');
    assert(d.mass_kg === null && d.radiusOfGyration_m === null, 'direct inertia ⇒ mass/k unknown');
  }

  // ─── SIZING: ΔE = I·ωavg²·Cs → required I; smaller Cs ⇒ larger I ──
  {
    const s = ok(flywheelEnergy({ energyFluctuation: 5000, meanRpm: 200, coefficientOfFluctuation: 0.05 }), 'sizing 200rpm Cs0.05');
    const omega = (TWO_PI * 200) / 60; // 20π/3
    near(s.meanSpeed_rad_s, omega, 'ωavg = 2π·200/60 = 20π/3 rad/s');
    near(s.inertia_kg_m2, 5000 / (omega ** 2 * 0.05), 'required I = ΔE/(ωavg²·Cs)');
    near(s.inertia_kg_m2, 227.98255, 'required I hand value ≈ 227.98 kg·m²', 1e-4);
    assert(s.mode === 'sizing', 'mode = sizing');
    near(s.energyFluctuation_J, 5000, 'ΔE echoed = 5000 J');
    // Sizing KE = ½Iω² = ΔE/(2Cs).
    near(s.kineticEnergy_J, 5000 / (2 * 0.05), 'stored KE = ΔE/(2Cs) = 50,000 J');
    near(s.kineticEnergy_J, 50000, 'KE hand value = 50,000 J');
    // Speed band ±Cs/2.
    near(s.maxSpeed_rad_s, omega * 1.025, 'ωmax = ωavg·(1+Cs/2)');
    near(s.minSpeed_rad_s, omega * 0.975, 'ωmin = ωavg·(1−Cs/2)');
    near((s.maxSpeed_rad_s - s.minSpeed_rad_s) / s.meanSpeed_rad_s, 0.05, 'Cs = (ωmax−ωmin)/ωavg recovers 0.05');

    // Monotonic inverse: halve Cs (tighter regulation) ⇒ DOUBLE the inertia.
    const tight = ok(flywheelEnergy({ energyFluctuation: 5000, meanRpm: 200, coefficientOfFluctuation: 0.025 }), 'sizing Cs0.025');
    near(tight.inertia_kg_m2, 2 * s.inertia_kg_m2, 'I ∝ 1/Cs: halving Cs doubles required I');
    assert(tight.inertia_kg_m2 > s.inertia_kg_m2, 'tighter regulation needs a LARGER flywheel');
  }

  // ─── FORWARD: I + Cs → ΔE traded per cycle ───────────────────────
  {
    const f = ok(flywheelEnergy({ inertia: 227.98255, meanRpm: 200, Cs: 0.05 }), 'forward I+Cs');
    assert(f.mode === 'forward', 'mode = forward');
    near(f.energyFluctuation_J, 5000, 'ΔE = I·ωavg²·Cs recovers 5000 J (inverse of sizing)');
  }

  // ─── REGULATION (Khurmi): I + ΔE → achieved Cs ───────────────────
  {
    const I = 6500 * 1.8 ** 2; // m·k² = 21,060 kg·m²
    near(I, 21060, 'Khurmi I = m·k² = 6500·1.8² = 21,060 kg·m²');
    const reg = ok(flywheelEnergy({ inertia: I, energyFluctuation: 56000, meanRpm: 120 }), 'regulation Khurmi');
    assert(reg.mode === 'regulation', 'mode = regulation');
    const omega = (TWO_PI * 120) / 60; // 4π
    near(reg.coefficientOfFluctuation, 56000 / (I * omega ** 2), 'Cs = ΔE/(I·ωavg²)');
    near(reg.coefficientOfFluctuation, 0.0168, 'Khurmi Cs ≈ 0.0168 (textbook)', 1e-3);
  }

  // ─── ENERGY square law: KE ∝ ω² ──────────────────────────────────
  {
    const e1 = ok(flywheelEnergy({ inertia: 10, meanSpeed: 100, Cs: 0.05 }), 'KE at ω=100');
    const e2 = ok(flywheelEnergy({ inertia: 10, meanSpeed: 200, Cs: 0.05 }), 'KE at ω=200');
    near(e1.kineticEnergy_J, 0.5 * 10 * 100 ** 2, 'KE = ½·10·100² = 50,000 J');
    near(e2.kineticEnergy_J, 0.5 * 10 * 200 ** 2, 'KE = ½·10·200² = 200,000 J');
    near(e2.kineticEnergy_J / e1.kineticEnergy_J, 4, 'SQUARE LAW: doubling ω quadruples KE');
    near(e1.maxSpeed_rad_s, 102.5, 'ωmax = 100·1.025 = 102.5 rad/s');
    near(e1.minSpeed_rad_s, 97.5, 'ωmin = 100·0.975 = 97.5 rad/s');
  }

  // ─── BURSTING stress σ = ρ·v² and size-independent burst speed ───
  {
    const st = ok(flywheelStress({ material: 'steel', velocity: 50 }), 'stress steel v50');
    near(st.density_kg_m3, 7850, 'steel density 7.85e-6 kg/mm³ → 7850 kg/m³');
    near(st.hoopStress_MPa, (7850 * 50 ** 2) / 1e6, 'σ = ρ·v² = 7850·2500 = 19.625 MPa');
    near(st.hoopStress_MPa, 19.625, 'σ hand value = 19.625 MPa');

    // Speed+radius path must equal the velocity-direct path (v = ω·r).
    const viaRpm = ok(flywheelStress({ material: 'steel', radius: 500, speed: 100 }), 'stress via ω·r');
    near(viaRpm.rimVelocity_m_s, 50, 'v = ω·r = 100·0.5 = 50 m/s (radius mm→m)');
    near(viaRpm.hoopStress_MPa, st.hoopStress_MPa, 'ω·r path == velocity-direct path');

    // Burst speed v_burst = √(σ_allow/ρ) — independent of RADIUS (scale-invariant).
    const b1 = ok(flywheelStress({ material: 'steel', radius: 250, rpm: 1000, allowableStress: 200 }), 'burst r250');
    const b2 = ok(flywheelStress({ material: 'steel', radius: 1000, rpm: 1000, allowableStress: 200 }), 'burst r1000');
    near(b1.burstVelocity_m_s!, Math.sqrt((200e6) / 7850), 'v_burst = √(σ_allow/ρ) ≈ 159.62 m/s');
    near(b1.burstVelocity_m_s!, 159.6172, 'v_burst hand value ≈ 159.62 m/s', 1e-4);
    near(b2.burstVelocity_m_s!, b1.burstVelocity_m_s!, 'SCALE-INVARIANT: burst rim speed independent of radius');
    assert(b2.burstRpm! < b1.burstRpm!, 'the bigger wheel bursts at a LOWER rpm (same rim speed)');

    // Safety factor two ways: σ_allow/σ = (v_burst/v)².
    const sf = ok(flywheelStress({ material: 'steel', velocity: 50, allowableStress: 200 }), 'stress + SF');
    near(sf.safetyFactor!, 200 / sf.hoopStress_MPa, 'SF = σ_allow/σ_hoop');
    near(sf.safetyFactor!, (sf.burstVelocity_m_s! / 50) ** 2, 'SF = (v_burst/v)² (independent identity)');

    // Lighter material → lower stress, higher burst speed.
    const al = ok(flywheelStress({ material: 'aluminum', velocity: 50, allowableStress: 200 }), 'stress aluminum');
    near(al.density_kg_m3, 2700, 'aluminum 2.70e-6 kg/mm³ → 2700 kg/m³');
    assert(al.hoopStress_MPa < st.hoopStress_MPa, 'aluminum (lighter) has less hoop stress at the same v');
    assert(al.burstVelocity_m_s! > b1.burstVelocity_m_s!, 'aluminum bursts at a HIGHER rim speed (lower ρ)');
    // Default allowable from material yield when none given.
    const yld = ok(flywheelStress({ material: 'steel', velocity: 50 }), 'burst from yield default');
    near(yld.allowableStress_MPa!, 250, 'default allowable = steel yield (250 MPa)');
  }

  // ─── WORKED end-to-end: size I from regulation, then mass from a rim ──
  {
    const req = ok(flywheelEnergy({ energyFluctuation: 4000, meanRpm: 250, coefficientOfFluctuation: 0.03 }), 'worked sizing');
    near(req.inertia_kg_m2, 194.536649, 'worked required I ≈ 194.54 kg·m²', 1e-4);
    // Choose a 0.6 m rim; back out the mass: I_rim = m·r² → m = I/r².
    const rimRadius_m = 0.6;
    const mass = req.inertia_kg_m2 / rimRadius_m ** 2;
    near(mass, 540.379580, 'rim mass = I/r² ≈ 540.4 kg', 1e-4);
    // Round-trip: that mass+radius rebuilds the required inertia.
    const back = ok(flywheelInertia({ shape: 'rim', mass, radius: 600 }), 'worked round-trip');
    near(back.inertia_kg_m2, req.inertia_kg_m2, 'round-trip: rim(mass, 600 mm) reproduces the required I');
    near(back.radiusOfGyration_m!, 0.6, 'rim radius of gyration = rim radius = 0.6 m');
  }

  // ─── Validation (fail closed) ────────────────────────────────────
  {
    assert(!flywheelInertia({ shape: 'blob', mass: 10, radius: 100 }).ok, 'unknown shape rejected');
    assert(!flywheelInertia({ shape: 'disc' }).ok, 'no mass/geometry/inertia rejected');
    assert(!flywheelInertia({ shape: 'disc', mass: 10 }).ok, 'mass without radius rejected (need I)');
    assert(!flywheelInertia({ shape: 'disc', material: 'steel', radius: 100 }).ok, 'geometry without thickness rejected');
    assert(!flywheelInertia({ shape: 'disc', material: 'unobtainium', radius: 100, thickness: 10 }).ok, 'unknown material rejected');
    assert(!flywheelInertia({ shape: 'annulus', mass: 10, outerRadius: 100, innerRadius: 150 }).ok, 'inner > outer radius rejected');
    assert(!flywheelEnergy({ energyFluctuation: 5000, coefficientOfFluctuation: 0.05 }).ok, 'missing mean speed rejected');
    assert(!flywheelEnergy({ meanRpm: 200, coefficientOfFluctuation: 0.05 }).ok, 'only one of ΔE/I/Cs rejected');
    assert(!flywheelEnergy({ meanRpm: 200, energyFluctuation: 5000, coefficientOfFluctuation: 2.5 }).ok, 'Cs ≥ 2 rejected (ωmin ≤ 0)');
    assert(!flywheelStress({ velocity: 50 }).ok, 'stress without material/density rejected');
    assert(!flywheelStress({ material: 'kryptonite', velocity: 50 }).ok, 'stress unknown material rejected');
    assert(!flywheelStress({ material: 'steel', speed: 100 }).ok, 'stress from speed without radius rejected');
    assert(!flywheelStress({ material: 'steel' }).ok, 'stress without velocity/speed rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-flywheel-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-flywheel-core smoke cases passed.');
}

main();
