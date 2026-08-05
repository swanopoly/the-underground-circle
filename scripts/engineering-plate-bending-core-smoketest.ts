/**
 * engineering-plate-bending-core smoke.
 *
 * A flat plate under uniform pressure is the 2-D analogue of a beam, and — like
 * the calc core — it is proven DIRECTLY: every coefficient is checked against a
 * hand-computed Roark/Timoshenko reference, and the plate "signatures" (σ ∝
 * (a/t)² and y ∝ a⁴/t³) are checked by scaling the geometry and reading off the
 * exact factor. The circular closed forms are ν-exact; the rectangular β/α come
 * from the hard-coded Roark table (Table 11.4) exactly as the ISO-286 IT grades
 * are hard-coded in the tolerance core.
 *
 * KEY PHYSICS PINNED
 *  - CIRCULAR clamped: σ_edge = 0.75·q(a/t)², y = 3q·a⁴(1−ν²)/(16E·t³).
 *  - CIRCULAR simply-supported: σ_center = (3/8)(3+ν)·q(a/t)²; deflects ~4× more
 *    than clamped, but its rim is unstressed (clamped has HIGHER edge stress).
 *  - RECTANGULAR: β·q·b²/t² and α·q·b⁴/(E·t³); table monotone in a/b; as a/b→∞
 *    the coefficients hit the 1-D beam-strip values (β=0.75 SS / 0.5 clamped).
 *  - SCALING: doubling a ⇒ σ×4, y×16; doubling t ⇒ σ×¼, y×⅛.
 */

import {
  platePressure, rectCoefficients, POISSON_RATIO,
  RECT_SIMPLY_SUPPORTED, RECT_CLAMPED,
  type PlateBending,
} from '../src/lib/engineeringPlateBendingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
/** Assert a numeric value is within a relative/absolute tolerance of expected. */
function near(actual: number, expected: number, label: string, tol = 1e-4) {
  const good = Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
  assert(good, `${label} (got ${actual}, expected ≈ ${expected})`);
}
function unwrap(res: { ok: true; value: PlateBending } | { ok: false; error: string }, label: string): PlateBending {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}
function strictlyIncreasing(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i += 1) if (!(xs[i] > xs[i - 1])) return false;
  return true;
}

function main() {
  // ─── Circular CLAMPED, textbook pin (steel a=500, t=10, q=0.1, E=200k, ν=0.3) ─
  {
    // (a/t)² = 50² = 2500.
    // σ_edge = 0.75·0.1·2500 = 187.5 MPa (MAX, at the edge).
    // σ_center = (3/8)(1+0.3)·0.1·2500 = 0.4875·250 = 121.875 MPa.
    // k_y = 3(1−0.09)/16 = 0.170625; y = 0.170625·0.1·500⁴/(2e8) = 0.170625·31.25 = 5.332031 mm.
    const c = unwrap(platePressure({ shape: 'circular', a: 500, thickness: 10, pressure: 0.1, edge: 'clamped', material: 'steel' }), 'circ clamped');
    near(c.sigmaMax_MPa, 187.5, 'circ clamped σ_max = 0.75·q(a/t)² = 187.5 MPa');
    assert(c.sigmaLocation === 'edge', 'circ clamped σ_max is at the EDGE');
    near(c.stressCoefficient, 0.75, 'circ clamped k_σ = 0.75');
    near(c.deflectionCoefficient, 0.170625, 'circ clamped k_y = 3(1−ν²)/16 = 0.170625');
    near(c.yMax_mm, 5.332031, 'circ clamped y_center = 5.332 mm');
    near(c.extra.sigma_center_MPa, 121.875, 'circ clamped σ_center = (3/8)(1+ν)q(a/t)² = 121.875 MPa');
    near(c.extra.sigma_edge_MPa, 187.5, 'circ clamped σ_edge = 187.5 MPa');
    near(c.extra.a_over_t, 50, 'circ clamped a/t = 50');
    near(c.extra.flexural_rigidity_D_Nmm, 2e8 / (12 * 0.91), 'circ clamped D = E·t³/(12(1−ν²))');
    // exact clamped-y pin, recomputed from first principles.
    const yExact = (3 * 0.1 * 500 ** 4 * (1 - 0.3 * 0.3)) / (16 * 200000 * 10 ** 3);
    near(c.yMax_mm, yExact, 'circ clamped y matches 3q·a⁴(1−ν²)/(16E·t³) exactly');
  }

  // ─── Circular SIMPLY-SUPPORTED, same plate ───────────────────────────────────
  {
    // k_σ = (3/8)(3+0.3) = 1.2375; σ_center = 1.2375·0.1·2500 = 309.375 MPa.
    // k_y = 3(1−0.3)(5+0.3)/16 = 3·0.7·5.3/16 = 0.695625; y = 0.695625·31.25 = 21.738281 mm.
    const s = unwrap(platePressure({ shape: 'circular', a: 500, thickness: 10, pressure: 0.1, edge: 'simply_supported', material: 'steel' }), 'circ SS');
    near(s.sigmaMax_MPa, 309.375, 'circ SS σ_max = (3/8)(3+ν)q(a/t)² = 309.375 MPa');
    assert(s.sigmaLocation === 'center', 'circ SS σ_max is at the CENTRE');
    near(s.stressCoefficient, 1.2375, 'circ SS k_σ = (3/8)(3+ν) = 1.2375');
    near(s.deflectionCoefficient, 0.695625, 'circ SS k_y = 3(1−ν)(5+ν)/16 = 0.695625');
    near(s.yMax_mm, 21.738281, 'circ SS y_center = 21.738 mm');
    near(s.extra.sigma_edge_MPa, 0, 'circ SS rim carries NO radial bending moment (σ_edge = 0)');
  }

  // ─── CLAMPED vs SIMPLY-SUPPORTED orderings (the edge-condition trade) ─────────
  {
    const cl = unwrap(platePressure({ shape: 'circular', a: 500, thickness: 10, pressure: 0.1, edge: 'clamped', material: 'steel' }), 'cmp clamped');
    const ss = unwrap(platePressure({ shape: 'circular', a: 500, thickness: 10, pressure: 0.1, edge: 'simply_supported', material: 'steel' }), 'cmp SS');
    assert(cl.yMax_mm < ss.yMax_mm, 'clamped plate deflects LESS than simply-supported (stiffer)');
    assert(cl.extra.sigma_edge_MPa > ss.extra.sigma_edge_MPa, 'clamped has HIGHER edge stress (187.5 > 0)');
    assert(ss.sigmaMax_MPa > cl.sigmaMax_MPa, 'SS peaks HIGHER at its centre than clamped peaks at its edge');
    near(ss.yMax_mm / cl.yMax_mm, 0.695625 / 0.170625, 'SS/clamped deflection ratio = k_y ratio ≈ 4.08');
  }

  // ─── SCALING LAW: σ ∝ (a/t)², y ∝ a⁴/t³ (circular, no aspect ratio to muddy) ──
  {
    const base = unwrap(platePressure({ shape: 'circular', a: 200, thickness: 10, pressure: 0.1, edge: 'clamped', E: 200000 }), 'scale base');
    const dblA = unwrap(platePressure({ shape: 'circular', a: 400, thickness: 10, pressure: 0.1, edge: 'clamped', E: 200000 }), 'scale 2a');
    const dblT = unwrap(platePressure({ shape: 'circular', a: 200, thickness: 20, pressure: 0.1, edge: 'clamped', E: 200000 }), 'scale 2t');
    near(dblA.sigmaMax_MPa / base.sigmaMax_MPa, 4, 'double a ⇒ σ ×4  (σ ∝ (a/t)²)', 1e-3);
    near(dblA.yMax_mm / base.yMax_mm, 16, 'double a ⇒ y ×16  (y ∝ a⁴)', 1e-3);
    near(dblT.sigmaMax_MPa / base.sigmaMax_MPa, 0.25, 'double t ⇒ σ ×¼  (σ ∝ 1/t²)', 1e-3);
    near(dblT.yMax_mm / base.yMax_mm, 0.125, 'double t ⇒ y ×⅛  (y ∝ 1/t³)', 1e-3);
  }

  // ─── Rectangular SIMPLY-SUPPORTED square, textbook pin (a=b=400, t=8, q=0.05) ─
  {
    // ar=1 ⇒ β=0.2874, α=0.0444; (b/t)²=2500.
    // σ = 0.2874·0.05·2500 = 35.925 MPa (centre); y = 0.0444·0.05·400⁴/(200000·512) = 0.555 mm.
    const rs = unwrap(platePressure({ shape: 'rectangular', a: 400, b: 400, thickness: 8, pressure: 0.05, edge: 'simply_supported', material: 'steel' }), 'rect SS sq');
    near(rs.extra.aspect_ratio, 1.0, 'rect SS square a/b = 1');
    near(rs.stressCoefficient, 0.2874, 'rect SS square β = 0.2874 (Roark table)');
    near(rs.deflectionCoefficient, 0.0444, 'rect SS square α = 0.0444 (Roark table)');
    near(rs.sigmaMax_MPa, 35.925, 'rect SS square σ_max = β·q·b²/t² = 35.925 MPa');
    assert(rs.sigmaLocation === 'center', 'rect SS σ_max is at the CENTRE');
    near(rs.yMax_mm, 0.555, 'rect SS square y_max = α·q·b⁴/(E·t³) = 0.555 mm');
    near(rs.characteristicLength_mm, 400, 'rect uses the SHORT side b as the characteristic length');
  }

  // ─── Rectangular CLAMPED square (same geometry) ──────────────────────────────
  {
    // ar=1 ⇒ β=0.3078 (long-edge centre, MAX), β_center=0.1386, α=0.0138.
    // σ = 0.3078·0.05·2500 = 38.475 MPa; y = 0.0138·0.05·250 = 0.1725 mm.
    const rc = unwrap(platePressure({ shape: 'rectangular', a: 400, b: 400, thickness: 8, pressure: 0.05, edge: 'clamped', material: 'steel' }), 'rect clamped sq');
    near(rc.stressCoefficient, 0.3078, 'rect clamped square β = 0.3078');
    near(rc.deflectionCoefficient, 0.0138, 'rect clamped square α = 0.0138');
    near(rc.extra.beta_center, 0.1386, 'rect clamped square β_center = 0.1386 (< edge β)');
    near(rc.sigmaMax_MPa, 38.475, 'rect clamped square σ_max = 38.475 MPa');
    assert(rc.sigmaLocation === 'edge', 'rect clamped σ_max is at the long-edge centre (EDGE)');
    near(rc.extra.sigma_center_MPa, 17.325, 'rect clamped square σ_center = 0.1386·q·b²/t² = 17.325 MPa');
    near(rc.yMax_mm, 0.1725, 'rect clamped square y_max = 0.1725 mm');
    // clamped rectangular is stiffer than simply-supported rectangular.
    const rs = unwrap(platePressure({ shape: 'rectangular', a: 400, b: 400, thickness: 8, pressure: 0.05, edge: 'simply_supported', material: 'steel' }), 'rect SS sq2');
    assert(rc.yMax_mm < rs.yMax_mm, 'clamped rect deflects LESS than simply-supported rect (0.1725 < 0.555)');
  }

  // ─── Rectangular scaling (short-side b², b⁴; keep or change t) ────────────────
  {
    const base = unwrap(platePressure({ shape: 'rectangular', a: 400, b: 400, thickness: 8, pressure: 0.05, edge: 'simply_supported', E: 200000 }), 'rect base');
    const dblT = unwrap(platePressure({ shape: 'rectangular', a: 400, b: 400, thickness: 16, pressure: 0.05, edge: 'simply_supported', E: 200000 }), 'rect 2t');
    const dblAB = unwrap(platePressure({ shape: 'rectangular', a: 800, b: 800, thickness: 8, pressure: 0.05, edge: 'simply_supported', E: 200000 }), 'rect 2ab');
    near(dblT.sigmaMax_MPa / base.sigmaMax_MPa, 0.25, 'rect double t ⇒ σ ×¼', 1e-3);
    near(dblT.yMax_mm / base.yMax_mm, 0.125, 'rect double t ⇒ y ×⅛', 1e-3);
    // scaling both sides keeps a/b, so β,α are unchanged and only b²/b⁴ scale.
    near(dblAB.extra.aspect_ratio, 1.0, 'scaling both sides keeps a/b = 1');
    near(dblAB.sigmaMax_MPa / base.sigmaMax_MPa, 4, 'rect double a&b ⇒ σ ×4  (σ ∝ b²)', 1e-3);
    near(dblAB.yMax_mm / base.yMax_mm, 16, 'rect double a&b ⇒ y ×16  (y ∝ b⁴)', 1e-3);
  }

  // ─── Rectangular coefficient table: interpolation + monotonicity ─────────────
  {
    // exact table hits at tabulated ratios.
    const at1 = rectCoefficients('simply_supported', 1.0);
    assert(at1.ok && Math.abs(at1.value.beta - 0.2874) < 1e-9, 'rectCoefficients SS a/b=1 → β=0.2874 (exact table row)');
    const at2 = rectCoefficients('simply_supported', 2.0);
    assert(at2.ok && Math.abs(at2.value.beta - 0.6102) < 1e-9, 'rectCoefficients SS a/b=2 → β=0.6102 (exact table row)');
    // linear interpolation at a/b=1.3 (halfway between 1.2 and 1.4).
    const at13 = rectCoefficients('simply_supported', 1.3);
    assert(at13.ok, 'rectCoefficients SS a/b=1.3 ok');
    if (at13.ok) {
      near(at13.value.beta, 0.3762 + 0.5 * (0.4530 - 0.3762), 'SS a/b=1.3 β interpolated = 0.4146');
      near(at13.value.alpha, 0.0616 + 0.5 * (0.0770 - 0.0616), 'SS a/b=1.3 α interpolated = 0.0693');
    }
    // clamped stiffer than SS at the same ratio (α smaller).
    const clAt1 = rectCoefficients('clamped', 1.0);
    assert(clAt1.ok && at1.ok && clAt1.value.alpha < at1.value.alpha, 'clamped α < SS α at a/b=1 (clamped is stiffer)');

    // table monotonicity (both β and α strictly increase with a/b).
    assert(strictlyIncreasing(RECT_SIMPLY_SUPPORTED.map((row) => row.beta)), 'SS β table is strictly increasing in a/b');
    assert(strictlyIncreasing(RECT_SIMPLY_SUPPORTED.map((row) => row.alpha)), 'SS α table is strictly increasing in a/b');
    assert(strictlyIncreasing(RECT_CLAMPED.map((row) => row.beta)), 'clamped β table is strictly increasing in a/b');
    assert(strictlyIncreasing(RECT_CLAMPED.map((row) => row.alpha)), 'clamped α table is strictly increasing in a/b');
    assert(strictlyIncreasing(RECT_CLAMPED.map((row) => row.betaCenter ?? row.beta)), 'clamped β_center table is strictly increasing');

    // a large a/b approaches (but has not reached) the strip limit, monotonically.
    const wide = rectCoefficients('simply_supported', 1000);
    assert(wide.ok, 'rectCoefficients SS a/b=1000 ok');
    if (wide.ok && at2.ok) {
      assert(wide.value.beta > at2.value.beta, 'β keeps increasing past a/b=2 toward the strip limit');
      near(wide.value.beta, 0.75, 'β(a/b=1000) ≈ 0.75 (near the strip limit)', 1e-3);
    }
  }

  // ─── a/b → ∞ IS the 1-D beam strip (ties the 2-D table to the beam lane) ──────
  {
    const ssInf = RECT_SIMPLY_SUPPORTED[RECT_SIMPLY_SUPPORTED.length - 1];
    const clInf = RECT_CLAMPED[RECT_CLAMPED.length - 1];
    assert(!Number.isFinite(ssInf.ar) && !Number.isFinite(clInf.ar), 'the last table row is the a/b → ∞ strip limit');
    // simply-supported strip: M=wb²/8 ⇒ β = 6·(1/8) = 0.75; y = 5wb⁴/384D ⇒ α = 5·12(1−ν²)/384.
    near(ssInf.beta, 6 * (1 / 8), 'SS strip β=0.75 = simply-supported beam-strip 6·(1/8)');
    near(ssInf.alpha, (5 * 12 * (1 - 0.3 * 0.3)) / 384, 'SS strip α=0.1422 = beam-strip 5·12(1−ν²)/384', 1e-3);
    // fixed-fixed strip: M=wb²/12 at supports ⇒ β = 6·(1/12) = 0.5; y = wb⁴/384D ⇒ α = 12(1−ν²)/384.
    near(clInf.beta, 6 * (1 / 12), 'clamped strip β=0.5 = fixed-fixed beam-strip 6·(1/12)');
    near(clInf.alpha, (12 * (1 - 0.3 * 0.3)) / 384, 'clamped strip α=0.0284 = beam-strip 12(1−ν²)/384', 1e-3);
    assert(ssInf.beta > clInf.beta, 'the SS strip is more stressed than the clamped strip (0.75 > 0.5)');
  }

  // ─── Material / Poisson wiring (composes MATERIALS + POISSON_RATIO) ───────────
  {
    const al = unwrap(platePressure({ shape: 'circular', a: 300, thickness: 6, pressure: 0.08, edge: 'clamped', material: 'aluminum' }), 'alu plate');
    near(al.inputs.E_MPa, 69000, 'aluminum plate uses E = 69000 MPa from MATERIALS');
    near(al.inputs.poisson, 0.33, 'aluminum plate uses ν = 0.33 from POISSON_RATIO');
    assert(POISSON_RATIO.steel === 0.3, 'POISSON_RATIO.steel = 0.30');
    // explicit E and ν override the material lookup.
    const ov = unwrap(platePressure({ shape: 'circular', a: 300, thickness: 6, pressure: 0.08, edge: 'clamped', material: 'aluminum', E: 70000, poisson: 0.25 }), 'override');
    near(ov.inputs.E_MPa, 70000, 'explicit E overrides the material E');
    near(ov.inputs.poisson, 0.25, 'explicit ν overrides the material ν');
    // diameter alias equals radius.
    const byDia = unwrap(platePressure({ shape: 'circular', diameter: 1000, thickness: 10, pressure: 0.1, edge: 'clamped', material: 'steel' }), 'by diameter');
    near(byDia.sigmaMax_MPa, 187.5, 'diameter=1000 ≡ radius=500 (σ_max = 187.5 MPa)');
  }

  // ─── Fail-closed input validation ────────────────────────────────────────────
  {
    assert(!platePressure({ shape: 'triangle', a: 100, thickness: 5, pressure: 0.1, material: 'steel' }).ok, 'unknown shape rejected');
    assert(!platePressure({ shape: 'circular', a: 100, thickness: 0, pressure: 0.1, material: 'steel' }).ok, 'non-positive thickness rejected');
    assert(!platePressure({ shape: 'circular', a: 100, thickness: 5, pressure: -1, material: 'steel' }).ok, 'non-positive pressure rejected');
    assert(!platePressure({ shape: 'circular', thickness: 5, pressure: 0.1, material: 'steel' }).ok, 'circular without radius/diameter rejected');
    assert(!platePressure({ shape: 'rectangular', a: 400, thickness: 8, pressure: 0.05, material: 'steel' }).ok, 'rectangular without side b rejected');
    assert(!platePressure({ shape: 'circular', a: 100, thickness: 5, pressure: 0.1, edge: 'wobbly', material: 'steel' }).ok, 'unknown edge condition rejected');
    assert(!platePressure({ shape: 'circular', a: 100, thickness: 5, pressure: 0.1, material: 'steel', poisson: 0.6 }).ok, 'Poisson ν ≥ 0.5 rejected');
    assert(!platePressure({ shape: 'circular', a: 100, thickness: 5, pressure: 0.1, material: 'unobtainium' }).ok, 'unknown material rejected');
    assert(!platePressure({ shape: 'circular', a: 100, thickness: 5, pressure: 0.1 }).ok, 'no material and no explicit E rejected');
    assert(!rectCoefficients('simply_supported', 0.5).ok, 'aspect ratio a/b < 1 rejected');
    // edge aliases resolve.
    assert(platePressure({ shape: 'circle', a: 100, thickness: 5, pressure: 0.1, edge: 'fixed', material: 'steel' }).ok, '"fixed" alias resolves to clamped');
    assert(platePressure({ shape: 'rect', a: 400, b: 300, thickness: 8, pressure: 0.05, edge: 'ss', material: 'steel' }).ok, '"ss" alias + "rect" shape resolve');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-plate-bending-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-plate-bending-core smoke cases passed');
}

main();
