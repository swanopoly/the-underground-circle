/**
 * engineering-journal-bearing-core smoke.
 *
 * A hydrodynamic journal (sleeve) bearing floats the shaft on an oil film — no
 * rolling elements — so its behaviour is governed by ONE dimensionless group, the
 * Sommerfeld number S = (r/c)²·μN/P, and its clean analytic anchor is Petroff's
 * concentric-limit friction f = 2π²·(μN/P)·(r/c). This smoke IS the proof:
 *
 *  • SOMMERFELD is verified DIMENSIONLESS by scaling reasoning — S scales exactly as
 *    the grouping predicts (linear in μN/P, quadratic in r/c) and f linear in both.
 *  • PETROFF is pinned to a hand-computed case, with Tf=f·W·r and power=Tf·ω=Tf·2πN
 *    consistent, and shown to be the concentric LOWER bound (a loaded chart value
 *    exceeds it), plus the neat concentric property that Tf is load-independent.
 *  • FILM thickness h0=c(1−ε) squeezes monotonically to zero as ε→1 (failure).
 *  • UNIT DISCIPLINE: reyn→Pa·s and rpm→rev/s convert correctly at the boundary.
 *
 * Reference: Shigley, "Mechanical Engineering Design", ch. 12; Petroff (1883).
 */

import { journalBearing, OILS, REYN_TO_PA_S } from '../src/lib/engineeringJournalBearingCore';

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

const TWO_PI_SQ = 2 * Math.PI * Math.PI;

function main() {
  // ─── The clean SI anchor case (hand-computed end to end) ─────────────
  // r=25mm, c=0.025mm (r/c=1000), Lb=50mm, μ=0.05 Pa·s, N=30 rev/s, W=5000 N.
  // P = W/(2r·Lb) = 5000/(2·0.025·0.05) = 2.0e6 Pa = 2 MPa.
  // μN/P = 0.05·30/2e6 = 7.5e-7.  S = 1000²·7.5e-7 = 0.75.
  // f = 2π²·7.5e-7·1000 = 0.0148044.  (r/c)f = 2π²·0.75 = 14.8044.
  // Tf = f·W·r = 0.0148044·5000·0.025 = 1.85055 N·m.  ω = 2π·30 = 188.4956.
  // power = Tf·ω = 348.82 W.  h0 (ε=0.5) = c/2 = 0.0125mm = 12.5 µm.
  const base = { radius: 25, clearance: 0.025, length: 50, viscosity: 0.05, speed: 30, load: 5000 };
  {
    const b = ok(journalBearing(base), 'anchor case');
    near(b.radiusClearanceRatio, 1000, 'r/c = 1000');
    near(b.lengthDiameterRatio, 1, 'L/D = 50/50 = 1');
    near(b.unitLoad_Pa, 2_000_000, 'P = W/(2r·Lb) = 2 MPa');
    near(b.unitLoad_MPa, 2, 'P reported in MPa too');
    near(b.viscositySpeedLoad, 7.5e-7, 'μN/P group = 7.5e-7');
    near(b.sommerfeld, 0.75, 'S = (r/c)²·μN/P = 0.75');
    near(b.friction, TWO_PI_SQ * 7.5e-7 * 1000, 'Petroff f = 2π²·(μN/P)·(r/c) = 0.0148044');
    near(b.frictionVariable, TWO_PI_SQ * 0.75, '(r/c)f = 2π²·S = 14.8044 (the Petroff line)');
    assert(b.frictionSource === 'petroff', 'default friction source is Petroff (concentric)');
    near(b.frictionTorque_Nm, b.friction * 5000 * 0.025, 'Tf = f·W·r');
    near(b.frictionTorque_Nm, 1.85055, 'Tf ≈ 1.85055 N·m (hand-computed)');
    near(b.angularVelocity_rad_s, 2 * Math.PI * 30, 'ω = 2πN');
    near(b.powerLoss_W, b.frictionTorque_Nm * b.angularVelocity_rad_s, 'power = Tf·ω');
    near(b.powerLoss_W, 348.82, 'power ≈ 348.82 W (hand-computed)');
    // cross-check power a second way: friction force × surface speed = f·W · 2πrN.
    near(b.powerLoss_W, b.friction * 5000 * (2 * Math.PI * 0.025 * 30), 'power = f·W·(2πrN) surface-speed form');
    near(b.minFilmThickness_um, 12.5, 'h0 = c(1−0.5) = 12.5 µm at default ε=0.5');
  }

  // ─── SOMMERFELD is DIMENSIONLESS: verify by exact scaling ────────────
  // S = (r/c)²·(μN/P). f = 2π²·(μN/P)·(r/c). Scale each input and confirm S and f
  // scale EXACTLY as the grouping predicts — the signature of a dimensionless number.
  {
    const b = ok(journalBearing(base), 's0');
    // double μ  → μN/P doubles → S doubles, f doubles (both linear in μN/P).
    const bMu = ok(journalBearing({ ...base, viscosity: 0.10 }), 's-mu');
    near(bMu.sommerfeld, 2 * b.sommerfeld, 'doubling μ doubles S (linear in μN/P)');
    near(bMu.friction, 2 * b.friction, 'doubling μ doubles Petroff f');
    // double N  → μN/P doubles → S doubles, f doubles.
    const bN = ok(journalBearing({ ...base, speed: 60 }), 's-N');
    near(bN.sommerfeld, 2 * b.sommerfeld, 'doubling N doubles S');
    near(bN.friction, 2 * b.friction, 'doubling N doubles Petroff f');
    // double load W → P doubles → μN/P halves → S halves, f halves (load in denominator).
    const bW = ok(journalBearing({ ...base, load: 10000 }), 's-W');
    near(bW.sommerfeld, b.sommerfeld / 2, 'doubling load halves S (P in denominator)');
    near(bW.friction, b.friction / 2, 'doubling load halves Petroff f');
    // double r/c (halve the clearance) → S ×4 (quadratic), f ×2 (linear). THE key
    // asymmetry that proves the (r/c)² in S vs the (r/c)¹ in f.
    const bRC = ok(journalBearing({ ...base, clearance: 0.0125 }), 's-rc');
    near(bRC.radiusClearanceRatio, 2000, 'halving clearance doubles r/c to 2000');
    near(bRC.sommerfeld, 4 * b.sommerfeld, 'doubling r/c QUADRUPLES S (the squared term)');
    near(bRC.friction, 2 * b.friction, 'doubling r/c only DOUBLES f (linear term)');
    // combined scaling — the decisive dimensionless check: scale μN/P by k (via μ,
    // which leaves r/c and P untouched) and r/c by m (via clearance, which leaves P
    // untouched) at the same time. S must scale by k·m² but f only by k·m — the
    // differing powers of r/c are the whole point of the two groupings.
    const bComb = ok(journalBearing({ ...base, viscosity: 0.075, clearance: 0.0125 }), 's-comb');
    near(bComb.radiusClearanceRatio, 2000, 'combined case: r/c doubled to 2000 (m=2)');
    near(bComb.sommerfeld, 1.5 * 4 * b.sommerfeld, 'combined: S ∝ (μN/P)·(r/c)² ⇒ k·m² = 1.5·4 = 6×');
    near(bComb.friction, 1.5 * 2 * b.friction, 'combined: f ∝ (μN/P)·(r/c) ⇒ k·m = 1.5·2 = 3×');
  }

  // ─── PETROFF properties: monotonic in μN/P, torque load-independent ──
  {
    const b = ok(journalBearing(base), 'p0');
    // f rises with μN/P: thicker oil, faster, lighter load → MORE viscous friction.
    assert(ok(journalBearing({ ...base, viscosity: 0.10 }), 'p-mu').friction > b.friction, 'thicker oil raises f (μN/P up)');
    assert(ok(journalBearing({ ...base, speed: 60 }), 'p-N').friction > b.friction, 'faster speed raises f (μN/P up)');
    assert(ok(journalBearing({ ...base, load: 10000 }), 'p-W').friction < b.friction, 'heavier load lowers f (μN/P down)');
    // Petroff concentric torque Tf = 4π²μNr³L/c is INDEPENDENT of load: doubling W
    // halves f but doubles W, so Tf (and power) are unchanged — a neat concentric fact.
    const bW = ok(journalBearing({ ...base, load: 10000 }), 'p-load-torque');
    near(bW.frictionTorque_Nm, b.frictionTorque_Nm, 'Petroff friction torque is load-independent');
    near(bW.powerLoss_W, b.powerLoss_W, 'Petroff power loss is load-independent');
    // independent closed form Tf = 4π²·μ·N·r³·L/c (SI).
    const TfClosed = 4 * Math.PI * Math.PI * 0.05 * 30 * (0.025 ** 3) * 0.05 / 0.000025;
    near(b.frictionTorque_Nm, TfClosed, 'Tf matches closed form 4π²μNr³L/c');
  }

  // ─── PETROFF is the concentric LOWER bound (loaded chart exceeds it) ──
  // A real loaded (eccentric) bearing has a higher (r/c)f than the Petroff line
  // 2π²S. Feed a Raimondi–Boyd chart friction variable above it and confirm the
  // resulting f exceeds the pure Petroff f — i.e. Petroff under-predicts loaded friction.
  {
    const b = ok(journalBearing(base), 'chart0');
    const petroffFV = TWO_PI_SQ * b.sommerfeld; // 14.8044 for S=0.75
    const loadedFV = petroffFV * 1.5;           // charts sit above the Petroff line under load
    const c = ok(journalBearing({ ...base, frictionVariable: loadedFV }), 'loaded chart');
    assert(c.frictionSource === 'chart', 'supplying frictionVariable switches source to chart');
    near(c.frictionVariable, loadedFV, 'chart (r/c)f used as given');
    near(c.friction, loadedFV / 1000, 'f = (r/c)f / (r/c) from the chart value');
    assert(c.friction > b.friction, 'loaded chart friction EXCEEDS Petroff (Petroff is the lower bound)');
    // the pure Petroff value is still reported for comparison.
    near(c.petroffFriction, b.friction, 'petroffFriction still reported alongside the chart value');
    // torque and power follow the chart friction.
    near(c.frictionTorque_Nm, c.friction * 5000 * 0.025, 'chart Tf = f·W·r');
    near(c.powerLoss_W, c.frictionTorque_Nm * c.angularVelocity_rad_s, 'chart power = Tf·ω');
  }

  // ─── FILM thickness squeeze h0 = c·(1−ε) ─────────────────────────────
  {
    // ε=0 → h0=c (concentric, thickest film).
    near(ok(journalBearing({ ...base, eccentricity: 0 }), 'e0').minFilmThickness_mm, 0.025, 'ε=0 → h0=c (concentric)');
    // ε=0.5 → h0=c/2.
    near(ok(journalBearing({ ...base, eccentricity: 0.5 }), 'e50').minFilmThickness_mm, 0.0125, 'ε=0.5 → h0=c/2');
    // ε→1 → h0→0 (metal-to-metal, failure).
    const e99 = ok(journalBearing({ ...base, eccentricity: 0.99 }), 'e99');
    near(e99.minFilmThickness_mm, 0.025 * 0.01, 'ε=0.99 → h0 ≈ 0 (near failure)');
    // monotonic squeeze: more eccentricity → thinner film.
    const hs = [0, 0.25, 0.5, 0.75, 0.9].map((e) => ok(journalBearing({ ...base, eccentricity: e }), `film-${e}`).minFilmThickness_mm);
    for (let i = 1; i < hs.length; i++) assert(hs[i] < hs[i - 1], `film thins monotonically as ε rises (${hs[i]} < ${hs[i - 1]})`);
    // chart minFilmRatio h0/c → ε = 1 − h0/c.
    const hr = ok(journalBearing({ ...base, minFilmRatio: 0.3 }), 'minfilm');
    near(hr.eccentricity, 0.7, 'minFilmRatio h0/c=0.3 → ε = 0.7');
    near(hr.minFilmThickness_mm, 0.025 * 0.3, 'h0 = c·(h0/c) = 0.3c');
    assert(hr.eccentricitySource === 'chart', 'ε from minFilmRatio is sourced "chart"');
    // default ε when omitted is the moderate 0.5.
    assert(ok(journalBearing(base), 'e-def').eccentricitySource === 'default', 'default ε source flagged');
  }

  // ─── POWER loss scaling: power = Tf·ω ∝ N² (f∝N and ω∝N) ─────────────
  {
    const b = ok(journalBearing(base), 'pw0');
    const b2 = ok(journalBearing({ ...base, speed: 60 }), 'pw-2N');
    near(b2.powerLoss_W, 4 * b.powerLoss_W, 'doubling N QUADRUPLES power (Tf∝N, ω∝N ⇒ ∝N²)');
    const b3 = ok(journalBearing({ ...base, speed: 90 }), 'pw-3N');
    near(b3.powerLoss_W, 9 * b.powerLoss_W, 'tripling N → 9× power (∝N²)');
    // power always positive.
    assert(b.powerLoss_W > 0, 'power loss is positive');
  }

  // ─── UNIT DISCIPLINE: reyn → Pa·s and rpm → rev/s at the boundary ────
  {
    // 4 µreyn is a typical light-oil viscosity (Shigley Example 12-1 range).
    const b = ok(journalBearing({ ...base, viscosity: undefined, viscosityReyn: 4e-6 }), 'reyn');
    near(b.viscosity_Pa_s, 4e-6 * REYN_TO_PA_S, '4e-6 reyn → 0.0275790 Pa·s');
    assert(b.viscositySource === 'reyn', 'viscosity source flagged reyn');
    near(REYN_TO_PA_S, 6894.757, '1 reyn = 6894.757 Pa·s');
    // rpm → rev/s: 1800 rpm = 30 rev/s must reproduce the anchor case exactly.
    const byRpm = ok(journalBearing({ radius: 25, clearance: 0.025, length: 50, viscosity: 0.05, speed_rpm: 1800, load: 5000 }), 'rpm');
    near(byRpm.speed_rev_s, 30, '1800 rpm → 30 rev/s');
    near(byRpm.speed_rpm, 1800, 'rpm echoed back');
    near(byRpm.sommerfeld, 0.75, 'rpm path reproduces S = 0.75');
    near(byRpm.friction, ok(journalBearing(base), 'rps').friction, 'rpm and rev/s paths agree on f');
    // diameter instead of radius; diametral clearance instead of radial.
    const byDia = ok(journalBearing({ diameter: 50, diametralClearance: 0.05, length: 50, viscosity: 0.05, speed: 30, load: 5000 }), 'dia');
    near(byDia.radius_mm, 25, 'diameter 50 → radius 25');
    near(byDia.clearance_mm, 0.025, 'diametral clearance 0.05 → radial 0.025');
    near(byDia.sommerfeld, 0.75, 'diameter/diametral path reproduces S = 0.75');
  }

  // ─── Oil table + validation ──────────────────────────────────────────
  {
    assert(Object.values(OILS).every((o) => o.mu > 0), 'every oil grade has positive viscosity');
    assert(ok(journalBearing({ ...base, viscosity: undefined, oil: 'SAE 30' }), 'sae30').viscosity_Pa_s === OILS.sae30.mu, 'named "SAE 30" resolves to the table μ');
    assert(!journalBearing({ ...base, viscosity: undefined, oil: 'unobtanium' }).ok, 'unknown oil rejected');
    assert(!journalBearing({ ...base, load: 0 } as any).ok, 'non-positive load rejected');
    assert(!journalBearing({ radius: 25, clearance: 0.025, viscosity: 0.05, speed: 30, load: 5000 } as any).ok, 'missing length rejected');
    assert(!journalBearing({ radius: 25, length: 50, viscosity: 0.05, speed: 30, load: 5000 } as any).ok, 'missing clearance rejected');
    assert(!journalBearing({ clearance: 0.025, length: 50, viscosity: 0.05, speed: 30, load: 5000 } as any).ok, 'missing radius/diameter rejected');
    assert(!journalBearing({ ...base, viscosity: undefined } as any).ok, 'missing viscosity rejected');
    assert(!journalBearing({ radius: 25, clearance: 0.025, length: 50, viscosity: 0.05, load: 5000 } as any).ok, 'missing speed rejected');
    assert(!journalBearing({ ...base, clearance: 30 }).ok, 'clearance ≥ radius rejected (physically impossible)');
    assert(!journalBearing({ ...base, eccentricity: 1 }).ok, 'ε = 1 rejected (out of [0,1))');
    assert(!journalBearing({ ...base, eccentricity: -0.1 }).ok, 'negative ε rejected');
    assert(!journalBearing({ ...base, minFilmRatio: 1.5 }).ok, 'minFilmRatio > 1 rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-journal-bearing-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-journal-bearing-core smoke cases passed.');
}

main();
