/**
 * engineering-column-core smoke.
 *
 * Intermediate & eccentric column analysis is pinned against HAND-COMPUTED
 * references and — crucially — against ITSELF at the Euler/Johnson transition.
 *
 * THE TANGENCY ANCHOR. For steel (E=200000 MPa, Sy=250 MPa) the transition
 * slenderness Cc = √(2π²E/Sy) = 125.6637. At λ = Cc the Euler hyperbola
 * σcr = π²E/λ² and the J.B. Johnson parabola σcr = Sy·[1 − Sy·λ²/(4π²E)] must give
 * the SAME stress (Sy/2 = 125 MPa) AND the SAME slope (−2π²E/Cc³ ≈ −1.9894). This
 * mutual value+slope agreement, computed by two independent formulas, is the
 * entire reason the transition is placed at Cc — and the smoke checks it directly,
 * evaluating both curves at Cc and finite-differencing both slopes.
 *
 * REGIME SELECTION. A short steel column (λ=40) → Johnson → σcr=237.335 MPa, close
 * to the yield 250; a long one (λ=180) → Euler → σcr=60.923 MPa, far below yield.
 * At λ=40 Euler ALONE would predict 1233.70 MPa — nearly 5× the yield, physically
 * absurd — so Johnson (lower, honest) governs, proving why Euler is not used there.
 *
 * SECANT. For P=100 kN, A=3000, e=10, c=50, k=30, E=200000, KL=3000: ec/k²=0.5556,
 * the secant argument is 0.645497 rad = (π/2)·√(P/Pcr), σmax=56.516 MPa (mean
 * 33.333 amplified ×1.6955). As e→0, σmax→P/A; larger e → larger σmax; and the
 * amplification runs away as P→Pcr. The smoke IS the proof.
 */

import {
  columnCritical,
  eccentricColumn,
  transitionSlenderness,
  eulerCriticalStress,
  johnsonCriticalStress,
  COLUMN_END_K,
} from '../src/lib/engineeringColumnCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

const E = 200_000; // steel Young's modulus, MPa
const SY = 250;    // steel yield, MPa

function main() {
  // ─── Pure curve pieces: transition, Euler, Johnson ───────────────
  {
    const Cc = transitionSlenderness(E, SY);
    near(Cc, 125.6637, 'transition Cc = √(2π²E/Sy) = 125.6637');
    // Euler AT Cc = Sy/2, Johnson AT Cc = Sy/2 — they MEET.
    near(eulerCriticalStress(E, Cc), 125, 'Euler σcr(Cc) = π²E/Cc² = Sy/2 = 125');
    near(johnsonCriticalStress(E, SY, Cc), 125, 'Johnson σcr(Cc) = Sy·[1−½] = Sy/2 = 125');
    near(eulerCriticalStress(E, Cc), johnsonCriticalStress(E, SY, Cc), 'the two curves are EQUAL at Cc');
    // Johnson endpoints and shape.
    near(johnsonCriticalStress(E, SY, 0), 250, 'Johnson σcr(λ=0) = Sy = 250 (short column → full yield)');
    assert(johnsonCriticalStress(E, SY, 40) < 250, 'Johnson σcr < Sy for λ>0 (parabola dips below yield)');
    assert(johnsonCriticalStress(E, SY, 40) > johnsonCriticalStress(E, SY, 100), 'Johnson σcr decreases with λ');
    // Euler shape.
    near(eulerCriticalStress(E, 40), 1233.70, 'Euler σcr(λ=40) = π²E/40² = 1233.70');
    near(eulerCriticalStress(E, 180), 60.923, 'Euler σcr(λ=180) = 60.923');
    assert(eulerCriticalStress(E, 40) > eulerCriticalStress(E, 80), 'Euler σcr decreases with λ');
  }

  // ─── THE TANGENCY: equal value AND equal slope at Cc ─────────────
  {
    const Cc = transitionSlenderness(E, SY);
    // Both formulas at Cc equal Sy/2 — pinned again as the anchor.
    near(eulerCriticalStress(E, Cc), SY / 2, 'ANCHOR: Euler(Cc) = Sy/2');
    near(johnsonCriticalStress(E, SY, Cc), SY / 2, 'ANCHOR: Johnson(Cc) = Sy/2');

    // Slopes by central finite difference — must match each other and the analytic value.
    const d = 0.001;
    const slopeEuler = (eulerCriticalStress(E, Cc + d) - eulerCriticalStress(E, Cc - d)) / (2 * d);
    const slopeJohnson = (johnsonCriticalStress(E, SY, Cc + d) - johnsonCriticalStress(E, SY, Cc - d)) / (2 * d);
    const slopeAnalytic = -(2 * Math.PI * Math.PI * E) / Math.pow(Cc, 3); // −2π²E/Cc³
    near(slopeAnalytic, -1.98944, 'analytic slope at Cc = −2π²E/Cc³ = −1.98944');
    near(slopeEuler, slopeAnalytic, 'Euler slope at Cc matches −2π²E/Cc³');
    near(slopeJohnson, slopeAnalytic, 'Johnson slope at Cc matches −2π²E/Cc³');
    near(slopeEuler, slopeJohnson, 'TANGENCY: Euler and Johnson have EQUAL slope at Cc');
    assert(slopeEuler < 0 && slopeJohnson < 0, 'both curves descend through Cc');
  }

  // ─── columnCritical: short column → JOHNSON, σcr near Sy ──────────
  {
    // radiusOfGyration=30, effective length via pinned length → λ = 1200/30 = 40.
    const v = ok(columnCritical({ material: 'steel', length: 1200, endCondition: 'pinned_pinned', area: 3000, radiusOfGyration: 30 }), 'short column λ=40');
    assert(v.regime === 'johnson', 'short column selects JOHNSON regime');
    near(v.slendernessRatio, 40, 'λ = KL/k = 1200/30 = 40');
    near(v.transitionCc, 125.6637, 'Cc echoed = 125.6637');
    near(v.criticalStress, 237.335, 'Johnson σcr(λ=40) = 237.335 MPa (near yield 250)');
    assert(v.criticalStress < 250 && v.criticalStress > 0.9 * 250, 'short-column σcr is close to (just under) the yield');
    // Euler ALONE would be absurd here, and Johnson is the lower/honest value.
    near(v.eulerStressAtLambda, 1233.70, 'Euler-at-λ=40 exposed = 1233.70 MPa (≈5× yield — absurd)');
    assert(v.eulerStressAtLambda > v.yieldStrength, 'Euler OVER-predicts: its σcr exceeds the yield at short λ');
    assert(v.criticalStress < v.eulerStressAtLambda, 'Johnson σcr < Euler σcr at short λ (Euler over-predicts)');
    // Pcr = σcr·A self-consistency.
    near(v.criticalLoad, v.criticalStress * v.area, 'Pcr = σcr·A self-consistent');
    near(v.criticalLoad, 237.335 * 3000, 'Pcr = 237.335·3000 ≈ 712005 N');
  }

  // ─── columnCritical: intermediate column λ=100 → JOHNSON ─────────
  {
    const v = ok(columnCritical({ material: 'steel', length: 3000, endCondition: 'pinned_pinned', area: 3000, radiusOfGyration: 30 }), 'intermediate λ=100');
    assert(v.regime === 'johnson', 'λ=100 (< Cc=125.66) still JOHNSON');
    near(v.slendernessRatio, 100, 'λ = 3000/30 = 100');
    near(v.criticalStress, 170.843, 'Johnson σcr(λ=100) = 170.843 MPa');
    assert(v.criticalStress < 237.335, 'σcr falls as the column lengthens (λ=100 < λ=40 stress)');
  }

  // ─── columnCritical: long column → EULER, σcr far below yield ─────
  {
    // radiusOfGyration=25, pinned length=4500 → λ = 4500/25 = 180 (> Cc).
    const v = ok(columnCritical({ material: 'steel', length: 4500, endCondition: 'pinned_pinned', area: 2000, radiusOfGyration: 25 }), 'long column λ=180');
    assert(v.regime === 'euler', 'long column selects EULER regime');
    near(v.slendernessRatio, 180, 'λ = 4500/25 = 180');
    near(v.criticalStress, 60.923, 'Euler σcr(λ=180) = 60.923 MPa');
    near(v.eulerStressAtLambda, v.criticalStress, 'in the Euler regime the exposed Euler stress == σcr');
    assert(v.criticalStress < 0.5 * v.yieldStrength, 'long-column σcr is well below yield (elastic buckling)');
  }

  // ─── columnCritical: the regime boundary is exactly Cc ───────────
  {
    const Cc = transitionSlenderness(E, SY); // 125.6637
    // k=1 so λ = Le; place Le a hair below and above Cc (the curve slope is ≈−1.99
    // MPa per unit λ, so probing 0.01 off the seam stays within 0.02 MPa of Sy/2).
    const below = ok(columnCritical({ material: 'steel', effectiveLength: Cc - 0.01, area: 100, radiusOfGyration: 1 }), 'just below Cc');
    const above = ok(columnCritical({ material: 'steel', effectiveLength: Cc + 0.01, area: 100, radiusOfGyration: 1 }), 'just above Cc');
    assert(below.regime === 'johnson', 'λ just below Cc → Johnson');
    assert(above.regime === 'euler', 'λ just above Cc → Euler');
    // Continuity: both are ≈ Sy/2 right at the seam (the curves meet there).
    near(below.criticalStress, 125, 'σcr just below Cc ≈ Sy/2 = 125 (curves meet)');
    near(above.criticalStress, 125, 'σcr just above Cc ≈ Sy/2 = 125 (curves meet)');
    assert(Math.abs(below.criticalStress - above.criticalStress) < 0.1, 'σcr is continuous across the Euler/Johnson seam');
  }

  // ─── columnCritical: end-condition K wired (fixed-free doubles λ) ─
  {
    const pinned = ok(columnCritical({ material: 'steel', length: 1000, endCondition: 'pinned_pinned', area: 1000, radiusOfGyration: 25 }), 'K pinned');
    const fixedFree = ok(columnCritical({ material: 'steel', length: 1000, endCondition: 'fixed_free', area: 1000, radiusOfGyration: 25 }), 'K fixed-free');
    near(pinned.K, 1.0, 'pinned-pinned K = 1.0');
    near(fixedFree.K, 2.0, 'fixed-free (cantilever) K = 2.0');
    near(pinned.slendernessRatio, 40, 'pinned λ = 1000/25 = 40');
    near(fixedFree.slendernessRatio, 80, 'fixed-free λ = (2·1000)/25 = 80 (K doubles the effective length)');
    near(fixedFree.criticalStress, 199.339, 'Johnson σcr(λ=80) = 199.339 MPa');
    assert(COLUMN_END_K.fixed_fixed === 0.5 && COLUMN_END_K.cantilever === 2.0, 'K table has the theoretical factors');
  }

  // ─── columnCritical: round bar (diameter → A, I, k=d/4) ──────────
  {
    const v = ok(columnCritical({ material: 'steel', length: 1000, endCondition: 'pinned_pinned', diameter: 40 }), 'round bar Ø40');
    near(v.radiusOfGyration, 10, 'solid round k = d/4 = 10');
    near(v.area, Math.PI * 40 * 40 / 4, 'round area A = π d²/4 = 1256.637');
    near(v.momentOfInertia, Math.PI * Math.pow(40, 4) / 64, 'round I = π d⁴/64 = 125663.7');
    near(v.slendernessRatio, 100, 'round λ = 1000/10 = 100');
    near(v.criticalStress, 170.843, 'round-bar σcr(λ=100) = 170.843 MPa (Johnson)');
  }

  // ─── columnCritical: composes section I + A → k = √(I/A) ─────────
  {
    // Same section as the round bar, but supplied as A and I (as the section core returns them).
    const A = Math.PI * 40 * 40 / 4;
    const I = Math.PI * Math.pow(40, 4) / 64;
    const v = ok(columnCritical({ material: 'steel', length: 1000, endCondition: 'pinned_pinned', area: A, momentOfInertia: I }), 'A+I → k');
    near(v.radiusOfGyration, 10, 'k = √(I/A) = 10 (matches the round-bar derivation)');
    near(v.criticalStress, 170.843, 'A+I path gives the same σcr = 170.843');
  }

  // ─── columnCritical: explicit E + yield (no material name) ───────
  {
    const v = ok(columnCritical({ E: 200_000, yield: 250, effectiveLength: 1000, area: 1000, radiusOfGyration: 10 }), 'explicit E/yield');
    near(v.E, 200_000, 'explicit E honored');
    near(v.yieldStrength, 250, 'explicit yield honored');
    near(v.effectiveLength, 1000, 'explicit effectiveLength honored');
    near(v.slendernessRatio, 100, 'λ = 1000/10 = 100');
  }

  // ─── SECANT: the textbook eccentric case ─────────────────────────
  {
    const v = ok(eccentricColumn({ load: 100_000, area: 3000, eccentricity: 10, extremeFibre: 50, radiusOfGyration: 30, E: 200_000, length: 3000, endCondition: 'pinned_pinned' }), 'secant textbook');
    near(v.eccentricityRatio, 0.555556, 'eccentricity ratio ec/k² = 10·50/900 = 0.5556');
    near(v.secArgument, 0.645497, 'secant argument (KL/2k)√(P/AE) = 0.645497 rad');
    near(v.secant, 1.25188, 'sec(0.645497) = 1.25188');
    near(v.axialStress, 33.3333, 'mean axial stress P/A = 100000/3000 = 33.333 MPa');
    near(v.amplification, 1.69549, 'amplification = 1 + (ec/k²)·sec = 1.6955');
    near(v.sigmaMax, 56.516, 'σmax = (P/A)·1.6955 = 56.516 MPa');
    near(v.criticalLoad, 592176.3, 'Euler Pcr = π²EI/KL² = 592176 N (I = A k² = 2.7e6)');
    near(v.loadRatio, 0.168869, 'P/Pcr = 100000/592176 = 0.1689');
    // The secant argument is exactly (π/2)·√(P/Pcr) — a pure closeness-to-Euler measure.
    near(v.secArgument, (Math.PI / 2) * Math.sqrt(v.loadRatio), 'IDENTITY: secant arg = (π/2)·√(P/Pcr)');
  }

  // ─── SECANT: e → 0 reduces to pure compression σmax = P/A ────────
  {
    const zero = ok(eccentricColumn({ load: 100_000, area: 3000, eccentricity: 0, extremeFibre: 50, radiusOfGyration: 30, E: 200_000, length: 3000, endCondition: 'pinned_pinned' }), 'secant e=0');
    near(zero.eccentricityRatio, 0, 'e=0 → ec/k² = 0');
    near(zero.amplification, 1, 'e=0 → amplification = 1 (no bending)');
    near(zero.sigmaMax, zero.axialStress, 'e=0 → σmax = P/A (pure compression)');
    near(zero.sigmaMax, 33.3333, 'e=0 → σmax = 33.333 MPa');
  }

  // ─── SECANT: larger eccentricity → larger σmax (monotonic) ───────
  {
    const base = { load: 100_000, area: 3000, extremeFibre: 50, radiusOfGyration: 30, E: 200_000, length: 3000, endCondition: 'pinned_pinned' };
    const e5 = ok(eccentricColumn({ ...base, eccentricity: 5 }), 'secant e=5');
    const e10 = ok(eccentricColumn({ ...base, eccentricity: 10 }), 'secant e=10');
    const e20 = ok(eccentricColumn({ ...base, eccentricity: 20 }), 'secant e=20');
    assert(e5.sigmaMax < e10.sigmaMax && e10.sigmaMax < e20.sigmaMax, 'σmax increases monotonically with eccentricity');
    near(e5.sigmaMax, 44.925, 'σmax(e=5) = 44.925 MPa');
    near(e20.sigmaMax, 79.699, 'σmax(e=20) = 79.699 MPa');
  }

  // ─── SECANT: amplification runs away as P → Pcr ──────────────────
  {
    const base = { area: 3000, eccentricity: 10, extremeFibre: 50, radiusOfGyration: 30, E: 200_000, length: 3000, endCondition: 'pinned_pinned' };
    const Pcr = ok(eccentricColumn({ ...base, load: 100_000 }), 'get Pcr').criticalLoad; // 592176.3
    const lo = ok(eccentricColumn({ ...base, load: 0.2 * Pcr }), 'load 0.2 Pcr');
    const mid = ok(eccentricColumn({ ...base, load: 0.5 * Pcr }), 'load 0.5 Pcr');
    const hi = ok(eccentricColumn({ ...base, load: 0.9 * Pcr }), 'load 0.9 Pcr');
    assert(lo.amplification < mid.amplification && mid.amplification < hi.amplification, 'amplification grows as P approaches Pcr');
    assert(hi.amplification > 5, 'amplification is large (>5) at 90% of Pcr — bending runs away');
    near(lo.loadRatio, 0.2, 'load ratio 0.2 recovered');
    near(hi.loadRatio, 0.9, 'load ratio 0.9 recovered');
  }

  // ─── SECANT: round bar auto extreme-fibre c = d/2 ────────────────
  {
    const v = ok(eccentricColumn({ load: 50_000, eccentricity: 5, diameter: 40, E: 200_000, length: 1000, endCondition: 'pinned_pinned' }), 'secant round bar');
    near(v.extremeFibre, 20, 'round bar auto extreme-fibre c = d/2 = 20');
    near(v.radiusOfGyration, 10, 'round bar k = d/4 = 10');
    near(v.eccentricityRatio, 5 * 20 / 100, 'ec/k² = 5·20/10² = 1.0');
  }

  // ─── SECANT: fails closed when P ≥ Pcr (buckling, σmax unbounded) ─
  {
    const base = { area: 3000, eccentricity: 10, extremeFibre: 50, radiusOfGyration: 30, E: 200_000, length: 3000, endCondition: 'pinned_pinned' };
    assert(!eccentricColumn({ ...base, load: 650_000 }).ok, 'P > Pcr (≈592176) rejected — column has buckled');
    assert(eccentricColumn({ ...base, load: 590_000 }).ok, 'P just below Pcr accepted');
  }

  // ─── Validation: missing/invalid inputs fail closed ──────────────
  {
    assert(!columnCritical({ length: 1000, area: 1000, radiusOfGyration: 10 }).ok, 'missing E/material rejected');
    assert(!columnCritical({ E: 200_000, length: 1000, area: 1000, radiusOfGyration: 10 }).ok, 'missing yield (with explicit E, no material) rejected');
    assert(!columnCritical({ material: 'steel', length: 1000, area: 1000 }).ok, 'missing section k/I/diameter rejected');
    assert(!columnCritical({ material: 'steel', length: 1000, radiusOfGyration: 10 }).ok, 'missing area rejected');
    assert(!columnCritical({ material: 'steel', length: 1000, area: 1000, radiusOfGyration: 10, endCondition: 'bogus' }).ok, 'unknown endCondition rejected');
    assert(!columnCritical({ material: 'unobtainium', length: 1000, area: 1000, radiusOfGyration: 10 }).ok, 'unknown material rejected');
    assert(!eccentricColumn({ load: 100_000, area: 3000, eccentricity: -5, extremeFibre: 50, radiusOfGyration: 30, E: 200_000, length: 3000 }).ok, 'negative eccentricity rejected');
    assert(!eccentricColumn({ load: -100, area: 3000, eccentricity: 10, extremeFibre: 50, radiusOfGyration: 30, E: 200_000, length: 3000 }).ok, 'non-positive load rejected');
    assert(!eccentricColumn({ load: 100_000, area: 3000, eccentricity: 10, radiusOfGyration: 30, E: 200_000, length: 3000 }).ok, 'missing extremeFibre (no diameter) rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-column-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-column-core smoke cases passed.');
}

main();
