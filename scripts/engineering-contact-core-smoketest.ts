/**
 * engineering-contact-core smoke — Hertzian contact stress, proven directly.
 *
 * THE EXACT ANCHORS (geometry-free, so they pin the whole solution):
 *   • SPHERE (point contact): p_max/p_mean = 3/2 = 1.5 EXACTLY.
 *   • CYLINDER (line contact): p_max/p_mean = 4/π ≈ 1.27324 EXACTLY.
 * These follow purely from the shape of the pressure dome (parabolic-of-revolution
 * for the sphere, elliptical for the cylinder) and hold for every material/geometry.
 *
 * TEXTBOOK CASE — hand-computed (Johnson, "Contact Mechanics"; Shigley). Two
 * identical STEEL spheres, R₁=R₂=10 mm, E=200 GPa, ν=0.3, F=1000 N:
 *   1/E* = 2·(1−0.3²)/200000 = 9.1e-6  ⇒ E* = 109890.11 MPa
 *   1/R  = 1/10 + 1/10 = 0.2           ⇒ R  = 5 mm
 *   a    = (3·1000·5 / (4·109890.11))^(1/3) = (0.0341244)^(1/3) ≈ 0.324357 mm
 *   p_max= 3·1000 / (2π·0.324357²) ≈ 4538.3 MPa   (≈18× steel yield — normal for
 *          triaxially-confined contact; the ball does not yield)
 *   p_mean≈ 3025.8 MPa,  p_max/p_mean = 1.5,  δ = a²/R ≈ 0.021041 mm
 * A STEEL ROLLER on a flat (line), R=10 mm, L=20 mm, F=1000 N: b ≈ 0.076113 mm,
 * p_max ≈ 418.2 MPa, p_max/p_mean = 4/π — far lower than the point case because the
 * load is spread along a line, not squeezed to a point.
 *
 * PROVEN HERE: the two exact ratios; the textbook a/b/p_max/δ; sphere-on-flat as the
 * R₂→∞ limit of sphere-sphere (computed both ways, must match); a ball in a concave
 * race spreading the load to a LOWER pressure than the same ball on a flat; the
 * F^(1/3) (sphere) and F^(1/2) (cylinder) signature scaling laws; and (R₁,mat₁)↔
 * (R₂,mat₂) swap symmetry. The smoke IS the proof.
 */

import { contactStress } from '../src/lib/engineeringContactCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-6) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}
function isErr(res: { ok: boolean }, label: string) { assert(res.ok === false, label); }

// ─── Independent reference recomputations (a DIFFERENT arrangement of the same
//     physics — catches transcription errors in the core without echoing it). ────
function sphereRef(F: number, R1: number, R2: number, E1: number, nu1: number, E2: number, nu2: number) {
  const invR = 1 / R1 + (R2 === Infinity ? 0 : 1 / R2);
  const R = 1 / invR;
  const Estar = 1 / ((1 - nu1 * nu1) / E1 + (1 - nu2 * nu2) / E2);
  const a = Math.cbrt((0.75 * F * R) / Estar); // 3FR/4E* written as 0.75·FR/E*
  const pMax = (3 * F) / (2 * Math.PI * a * a);
  const pMean = F / (Math.PI * a * a);
  const delta = (a * a) / R;
  return { R, Estar, a, pMax, pMean, delta };
}
function cylRef(F: number, L: number, R1: number, R2: number, E1: number, nu1: number, E2: number, nu2: number) {
  const invR = 1 / R1 + (R2 === Infinity ? 0 : 1 / R2);
  const R = 1 / invR;
  const Estar = 1 / ((1 - nu1 * nu1) / E1 + (1 - nu2 * nu2) / E2);
  const b = Math.sqrt((4 * F * R) / (Math.PI * L * Estar));
  const pMax = (2 * F) / (Math.PI * b * L);
  const pMean = F / (2 * b * L);
  return { R, Estar, b, pMax, pMean };
}

function main() {
  const E_STEEL = 200_000, NU = 0.3;

  // ─── SPHERE textbook case: two identical steel spheres ───────────────
  {
    const v = ok(contactStress({ mode: 'sphere', R1: 10, R2: 10, force: 1000, material: 'steel', nu: 0.3 }), 'sphere two-steel');
    const ref = sphereRef(1000, 10, 10, E_STEEL, NU, E_STEEL, NU);
    assert(v.mode === 'sphere', 'mode echoed = sphere');
    assert(v.contactDimKind === 'a_radius', 'sphere contact dim is a circle radius a');
    near(v.eStar, 1 / 9.1e-6, 'E* = 1/9.1e-6 = 109890.11 MPa (hand)');
    near(v.eStar, ref.Estar, 'E* matches independent recompute');
    near(v.rEff, 5, 'R = 1/(1/10+1/10) = 5 mm');
    near(v.contactDim, ref.a, 'contact radius a matches recompute');
    near(v.contactDim, 0.324357, 'a ≈ 0.324357 mm (hand)', 5e-3);
    near(v.pMax, ref.pMax, 'p_max matches recompute');
    near(v.pMax, 4538.3, 'p_max ≈ 4538 MPa (hand)', 5e-3);
    near(v.pMean, ref.pMean, 'p_mean matches recompute');
    near(v.pMean, 3025.8, 'p_mean ≈ 3026 MPa (hand)', 5e-3);
    assert(v.approach !== null, 'sphere reports an approach δ');
    near(v.approach!, ref.delta, 'δ = a²/R matches recompute');
    near(v.approach!, 0.021041, 'δ ≈ 0.021041 mm (hand)', 5e-3);
    near(v.contactArea, Math.PI * ref.a * ref.a, 'contact area = πa²');
    // EXACT ANCHOR: p_max/p_mean = 3/2 exactly.
    assert(v.pMaxOverPMean === 1.5, 'EXACT ANCHOR: sphere p_max/p_mean = 1.5');
    near(v.pMean, v.pMax * (2 / 3), 'sphere p_mean = 2/3·p_max (same anchor)');
  }

  // ─── CYLINDER textbook case: steel roller on a steel flat ────────────
  {
    const v = ok(contactStress({ mode: 'cylinder', R1: 10, force: 1000, length: 20, material: 'steel' }), 'cylinder roller-on-flat');
    const ref = cylRef(1000, 20, 10, Infinity, E_STEEL, NU, E_STEEL, NU);
    assert(v.mode === 'cylinder', 'mode echoed = cylinder');
    assert(v.contactDimKind === 'b_halfWidth', 'cylinder contact dim is a half-width b');
    near(v.eStar, 1 / 9.1e-6, 'cylinder E* = 109890.11 MPa');
    near(v.rEff, 10, 'roller-on-flat R = 10 mm');
    near(v.contactDim, ref.b, 'half-width b matches recompute');
    near(v.contactDim, 0.076113, 'b ≈ 0.076113 mm (hand)', 5e-3);
    near(v.pMax, ref.pMax, 'cyl p_max matches recompute');
    near(v.pMax, 418.2, 'cyl p_max ≈ 418.2 MPa (hand)', 5e-3);
    near(v.pMean, ref.pMean, 'cyl p_mean matches recompute');
    near(v.pMean, 328.5, 'cyl p_mean ≈ 328.5 MPa (hand)', 5e-3);
    near(v.contactArea, 2 * ref.b * 20, 'contact area = 2bL');
    assert(v.approach === null, 'line contact reports no δ (logarithmic, geometry-dependent)');
    // EXACT ANCHOR: p_max/p_mean = 4/π exactly.
    near(v.pMaxOverPMean, 4 / Math.PI, 'EXACT ANCHOR: cyl p_max/p_mean = 4/π', 1e-5);
    near(v.pMaxOverPMean, 1.27324, 'cyl p_max/p_mean = 1.27324 (hand)', 1e-5);
    near(v.pMean, v.pMax * (Math.PI / 4), 'cyl p_mean = π/4·p_max (same anchor)');
  }

  // ─── LIMITING CASE: sphere-on-flat = sphere-sphere with R₂ = ∞ ───────
  {
    const flatOmit = ok(contactStress({ mode: 'sphere', R1: 10, force: 800, material: 'steel' }), 'sphere flat (R2 omitted)');
    const flatInf = ok(contactStress({ mode: 'sphere', R1: 10, R2: Infinity, force: 800, material: 'steel' }), 'sphere flat (R2=Infinity)');
    near(flatOmit.rEff, 10, 'flat: R = R1 = 10 (1/R2 = 0)');
    near(flatOmit.contactDim, flatInf.contactDim, 'omitted R2 ≡ R2=Infinity: same a');
    near(flatOmit.pMax, flatInf.pMax, 'omitted R2 ≡ R2=Infinity: same p_max');
    near(flatOmit.approach!, flatInf.approach!, 'omitted R2 ≡ R2=Infinity: same δ');
    // And the flat is the R2→∞ limit of a large-but-finite convex mate.
    const bigMate = ok(contactStress({ mode: 'sphere', R1: 10, R2: 1e7, force: 800, material: 'steel' }), 'sphere on huge convex');
    near(bigMate.pMax, flatInf.pMax, 'R2=1e7 → p_max approaches the flat limit', 1e-3);
  }

  // ─── CONFORMING CONTACT: a ball in a concave race spreads the load ───
  {
    const onFlat = ok(contactStress({ mode: 'sphere', R1: 10, force: 1000, material: 'steel' }), 'ball on flat');
    const inRace = ok(contactStress({ mode: 'sphere', R1: 10, R2: -15, force: 1000, material: 'steel' }), 'ball in R=15 race');
    near(onFlat.rEff, 10, 'ball-on-flat R = 10');
    near(inRace.rEff, 30, 'ball-in-race R = 1/(1/10 − 1/15) = 30 mm (concave enlarges R)');
    assert(inRace.rEff > onFlat.rEff, 'concave race gives a LARGER effective radius');
    assert(inRace.contactDim > onFlat.contactDim, 'concave race gives a LARGER contact circle');
    assert(inRace.contactArea > onFlat.contactArea, 'concave race gives a LARGER contact area');
    assert(inRace.pMax < onFlat.pMax, 'concave race LOWERS the peak pressure (conforming contact)');
    assert(inRace.pMean < onFlat.pMean, 'concave race lowers the mean pressure too');
  }

  // ─── CONVEXITY GUARD: a ball bigger than its socket is rejected ──────
  {
    isErr(contactStress({ mode: 'sphere', R1: 10, R2: -8, force: 1000, material: 'steel' }), 'ball bigger than socket (|R2|<R1) → 1/R<0 error');
    isErr(contactStress({ mode: 'sphere', R1: 10, R2: -10, force: 1000, material: 'steel' }), 'ball exactly conforming (|R2|=R1) → 1/R=0 error');
    // A concave mate LARGER than the ball is fine (that is a real race).
    assert(contactStress({ mode: 'sphere', R1: 10, R2: -10.0001, force: 1000, material: 'steel' }).ok, 'near-conforming but valid race accepted');
  }

  // ─── SIGNATURE LAW (sphere): p_max ∝ F^(1/3), a ∝ F^(1/3), δ ∝ F^(2/3) ─
  {
    const v1 = ok(contactStress({ mode: 'sphere', R1: 10, R2: 10, force: 1000, material: 'steel' }), 'sphere F=1000');
    const v2 = ok(contactStress({ mode: 'sphere', R1: 10, R2: 10, force: 2000, material: 'steel' }), 'sphere F=2000');
    // Ratios of 6-dp-rounded dimensions carry ~1e-5 error — 1e-4 still trivially
    // separates the F^(1/3) signature from any other exponent.
    near(v2.pMax / v1.pMax, Math.cbrt(2), 'double F → p_max × 2^(1/3) ≈ 1.2599 (sub-linear!)', 1e-4);
    near(v2.contactDim / v1.contactDim, Math.cbrt(2), 'double F → a × 2^(1/3)', 1e-4);
    near(v2.approach! / v1.approach!, Math.cbrt(4), 'double F → δ × 2^(2/3) ≈ 1.5874', 1e-4);
  }

  // ─── SIGNATURE LAW (cylinder): p_max ∝ F^(1/2), b ∝ F^(1/2) ──────────
  {
    const v1 = ok(contactStress({ mode: 'cylinder', R1: 10, force: 1000, length: 20, material: 'steel' }), 'cyl F=1000');
    const v2 = ok(contactStress({ mode: 'cylinder', R1: 10, force: 2000, length: 20, material: 'steel' }), 'cyl F=2000');
    near(v2.pMax / v1.pMax, Math.SQRT2, 'double F → p_max × √2 ≈ 1.4142', 1e-4);
    near(v2.contactDim / v1.contactDim, Math.SQRT2, 'double F → b × √2', 1e-4);
  }

  // ─── SYMMETRY (sphere): swapping (R,material) of the two bodies ──────
  {
    const a = ok(contactStress({ mode: 'sphere', R1: 10, R2: 20, force: 1500, material1: 'steel', material2: 'aluminum' }), 'sphere steel10/alu20');
    const b = ok(contactStress({ mode: 'sphere', R1: 20, R2: 10, force: 1500, material1: 'aluminum', material2: 'steel' }), 'sphere alu20/steel10 (swapped)');
    near(a.eStar, b.eStar, 'swap → identical E* (symmetric sum)');
    near(a.rEff, b.rEff, 'swap → identical R (symmetric sum)');
    near(a.contactDim, b.contactDim, 'swap → identical a');
    near(a.pMax, b.pMax, 'swap → identical p_max');
    near(a.approach!, b.approach!, 'swap → identical δ');
    // Dissimilar materials sit between the two same-material extremes. Softer
    // aluminum (lower E) deforms more, spreads the load, and gives a LOWER p_max
    // than stiffer steel — so the mixed pair lands between all-aluminum and all-steel.
    const bothSteel = ok(contactStress({ mode: 'sphere', R1: 10, R2: 20, force: 1500, material: 'steel' }), 'both steel');
    const bothAlu = ok(contactStress({ mode: 'sphere', R1: 10, R2: 20, force: 1500, material: 'aluminum' }), 'both aluminum');
    assert(bothAlu.pMax < a.pMax && a.pMax < bothSteel.pMax, 'mixed p_max between all-aluminum (softer, lower) and all-steel (stiffer, higher)');
  }

  // ─── SYMMETRY (cylinder): swap two rollers ──────────────────────────
  {
    const a = ok(contactStress({ mode: 'cylinder', R1: 10, R2: 25, force: 2000, length: 30, material1: 'steel', material2: 'aluminum' }), 'cyl steel10/alu25');
    const b = ok(contactStress({ mode: 'cylinder', R1: 25, R2: 10, force: 2000, length: 30, material1: 'aluminum', material2: 'steel' }), 'cyl alu25/steel10 (swapped)');
    near(a.contactDim, b.contactDim, 'cyl swap → identical b');
    near(a.pMax, b.pMax, 'cyl swap → identical p_max');
    near(a.eStar, b.eStar, 'cyl swap → identical E*');
  }

  // ─── MATERIAL STRENGTH NOTE (contact allowables run high) ───────────
  {
    const v = ok(contactStress({ mode: 'sphere', R1: 10, R2: 10, force: 1000, material: 'steel' }), 'sphere for strength note');
    assert(v.yieldStrength === 250, 'steel yield (250 MPa) picked up from the material');
    assert(v.pMaxOverYield !== null, 'p_max/σ_yield reported');
    near(v.pMaxOverYield!, v.pMax / 250, 'p_max/σ_yield = p_max/250');
    assert(v.pMaxOverYield! > 10, 'p_max is many× the yield (≈18×) — normal for confined contact');
    const joined = v.notes.join(' ');
    assert(joined.includes('pitting') && joined.includes('subsurface'), 'note explains subsurface yield + pitting/spalling failure');
    // Explicit yield overrides the material lookup.
    const ve = ok(contactStress({ mode: 'sphere', R1: 10, R2: 10, force: 1000, material: 'steel', yield: 500 }), 'explicit yield=500');
    assert(ve.yieldStrength === 500, 'explicit yield overrides material yield');
    // No material → no yield ratio (moduli given directly).
    const vn = ok(contactStress({ mode: 'sphere', R1: 10, R2: 10, force: 1000, E1: 200000, E2: 200000 }), 'explicit moduli, no material');
    assert(vn.yieldStrength === null && vn.pMaxOverYield === null, 'no material/yield → null strength ratio');
    near(vn.eStar, 1 / 9.1e-6, 'explicit E, default ν=0.3 → same E*');
  }

  // ─── Point vs line: the same load hurts far more as a point ──────────
  {
    const sph = ok(contactStress({ mode: 'sphere', R1: 10, force: 1000, material: 'steel' }), 'sphere-on-flat 1kN');
    const cyl = ok(contactStress({ mode: 'cylinder', R1: 10, force: 1000, length: 20, material: 'steel' }), 'roller-on-flat 1kN');
    assert(sph.pMax > cyl.pMax, 'point contact concentrates the same load to a much higher p_max than line contact');
  }

  // ─── VALIDATION: fail closed on bad inputs ──────────────────────────
  {
    isErr(contactStress({ mode: 'wedge' as any, R1: 10, force: 100 }), 'unknown mode rejected');
    isErr(contactStress({ mode: 'sphere', R1: -10, force: 100, material: 'steel' }), 'negative R1 rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, force: -5, material: 'steel' }), 'negative force rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, force: 0, material: 'steel' }), 'zero force rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, R2: 0, force: 100, material: 'steel' }), 'R2 = 0 (zero-radius mate) rejected');
    isErr(contactStress({ mode: 'cylinder', R1: 10, force: 100, material: 'steel' }), 'cylinder without length rejected');
    isErr(contactStress({ mode: 'cylinder', R1: 10, force: 100, length: -3, material: 'steel' }), 'cylinder negative length rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, force: 100, material: 'unobtanium' }), 'unknown material rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, force: 100, E1: 200000, E2: 200000, nu: 0.6 }), 'Poisson ratio ≥ 0.5 rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, force: 100, E1: 200000, E2: 200000, nu1: -0.1 }), 'negative Poisson ratio rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, force: 100, E1: -1, E2: 200000, nu: 0.3 }), 'negative E rejected');
    isErr(contactStress({ mode: 'sphere', R1: 10, force: 100 }), 'no material and no E rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-contact-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-contact-core smoke cases passed.');
}

main();
