/**
 * engineering-stress-concentration-core smoke.
 *
 * Stress concentration and notch fatigue are ANALYSIS (no engine to run), so the
 * smoke IS the proof. Correctness is pinned two ways:
 *
 *  (1) EXACT ANCHORS. The whole subject rests on one closed-form value: a circular
 *      hole in an infinite plate has Kt = 3.0 (Kirsch). The elliptical-hole formula
 *      must REPRODUCE it — Inglis Kt = 1 + 2(a/b) with b = a is 1 + 2 = 3, the same
 *      anchor from a different equation. The finite-width fit must RETURN to 3 as
 *      d/w → 0. Inglis at hand ratios (a/b = 3 → Kt = 7, a/b = 2 → Kt = 5) is
 *      pinned to the last digit, and its ρ-form 1 + 2√(a/ρ) must equal the (a/b)
 *      form (a genuine two-path self-check).
 *
 *  (2) INVARIANTS a single point value would hide: Kt → 3 as d/w → 0; the shaft
 *      table interpolation exact at every node and monotonic between (Kt falls
 *      with r/d, rises with D/d, orders torsion < tension < bending); and above
 *      all the notch-fatigue law Kf = 1 + q(Kt−1) with q ∈ [0,1], so Kf ≤ Kt
 *      ALWAYS, Kf → Kt for a blunt notch (large r), Kf → 1 for a sharp one
 *      (small r), and Se_corrected = Se/Kf < Se.
 */

import { stressConcentration, notchFatigue } from '../src/lib/engineeringStressConcentrationCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

function main() {
  // ─── HOLE IN A PLATE: the exact Kirsch anchor and the finite-width fit ───
  {
    const inf = ok(stressConcentration({ geometry: 'hole_in_plate' }), 'hole infinite plate');
    near(inf.Kt, 3.0, 'Kirsch: infinite-plate circular hole Kt = 3.0 EXACTLY');
    assert(inf.nominalBasis === 'gross', 'infinite plate nominal basis = gross');
    near(inf.ratio!, 0, 'infinite plate d/w = 0');

    // Heywood/Roark finite-width fit: Kt = 3 − 3.14(d/w) + 3.667(d/w)² − 1.527(d/w)³.
    const half = ok(stressConcentration({ geometry: 'hole_in_plate', diameter: 50, width: 100 }), 'hole d/w=0.5');
    near(half.Kt, 3 - 3.14 * 0.5 + 3.667 * 0.25 - 1.527 * 0.125, 'finite hole d/w=0.5 → Kt = 2.155875');
    near(half.Kt, 2.155875, 'finite hole d/w=0.5 hand value = 2.155875');
    assert(half.nominalBasis === 'net', 'finite-width hole nominal basis = net');

    const p2 = ok(stressConcentration({ geometry: 'hole_in_plate', diameter: 20, width: 100 }), 'hole d/w=0.2');
    near(p2.Kt, 3 - 3.14 * 0.2 + 3.667 * 0.04 - 1.527 * 0.008, 'finite hole d/w=0.2 → Kt = 2.506464');
    const p1 = ok(stressConcentration({ geometry: 'hole_in_plate', diameter: 10, width: 100 }), 'hole d/w=0.1');
    near(p1.Kt, 3 - 3.14 * 0.1 + 3.667 * 0.01 - 1.527 * 0.001, 'finite hole d/w=0.1 → Kt = 2.721143');

    // INVARIANT: Kt → 3 as d/w → 0.
    const tiny = ok(stressConcentration({ geometry: 'hole_in_plate', diameter: 0.1, width: 1000 }), 'hole d/w→0');
    near(tiny.Kt, 3.0, 'INVARIANT: finite-width Kt → 3 as d/w → 0');
    assert(tiny.Kt < 3 && tiny.Kt > 2.99, 'd/w→0: Kt just below 3, approaching Kirsch');

    // Peak stress = Kt·σ_nom (net-section nominal).
    const withStress = ok(stressConcentration({ geometry: 'hole_in_plate', diameter: 50, width: 100, nominalStress: 100 }), 'hole peak stress');
    near(withStress.peakStress_MPa!, 2.155875 * 100, 'peak σ = Kt·σ_nom = 215.5875 MPa');

    // Signed nominal stress is valid (compressive far-field).
    const compressive = ok(stressConcentration({ geometry: 'hole_in_plate', nominalStress: -100 }), 'hole compressive nominal');
    near(compressive.peakStress_MPa!, -300, 'infinite plate, σ_nom=−100 → σ_max = 3·(−100) = −300 MPa');
  }

  // ─── ELLIPTICAL HOLE (Inglis): the circle limit reproduces Kt = 3 ───────
  {
    const circle = ok(stressConcentration({ geometry: 'elliptical_hole', a: 5, b: 5 }), 'ellipse b=a (circle)');
    near(circle.Kt, 3.0, 'Inglis circle (b=a): Kt = 1 + 2(1) = 3 — REPRODUCES Kirsch');
    near(circle.KtFromRadius!, 3.0, 'circle ρ-form 1 + 2√(a/ρ) = 3 (self-check)');
    near(circle.tipRadius_mm!, 5, 'circle tip radius ρ = b²/a = 5');

    const e1 = ok(stressConcentration({ geometry: 'elliptical_hole', a: 6, b: 2 }), 'ellipse a/b=3');
    near(e1.Kt, 7, 'Inglis a/b=3: Kt = 1 + 2(3) = 7');
    near(e1.KtFromRadius!, 7, 'a/b=3 via ρ: 1 + 2√(a/ρ) = 7 (two paths AGREE)');
    near(e1.tipRadius_mm!, (2 * 2) / 6, 'ρ = b²/a = 4/6 = 0.6667');

    const e2 = ok(stressConcentration({ geometry: 'elliptical_hole', a: 10, b: 5 }), 'ellipse a/b=2');
    near(e2.Kt, 5, 'Inglis a/b=2: Kt = 1 + 2(2) = 5');
    near(e2.KtFromRadius!, 5, 'a/b=2 self-check = 5');

    const e3 = ok(stressConcentration({ geometry: 'elliptical_hole', a: 4, b: 1 }), 'ellipse a/b=4');
    near(e3.Kt, 9, 'Inglis a/b=4: Kt = 1 + 2(4) = 9');

    // Give the tip radius instead of b: a=6, ρ=2/3 → b=√(a·ρ)=√4=2 → Kt=7.
    const byRadius = ok(stressConcentration({ geometry: 'elliptical_hole', a: 6, tipRadius: 2 / 3 }), 'ellipse by tip radius');
    near(byRadius.Kt, 7, 'ellipse from (a, ρ): b = √(a·ρ) = 2 → Kt = 7');

    // Sharpening (b ↓) raises Kt toward the crack limit.
    const blunt = ok(stressConcentration({ geometry: 'elliptical_hole', a: 10, b: 10 }), 'ellipse blunt');
    const mid = ok(stressConcentration({ geometry: 'elliptical_hole', a: 10, b: 5 }), 'ellipse mid');
    const sharp = ok(stressConcentration({ geometry: 'elliptical_hole', a: 10, b: 1 }), 'ellipse sharp');
    assert(sharp.Kt > mid.Kt && mid.Kt > blunt.Kt, 'sharper ellipse (smaller b) → larger Kt (toward crack)');
    near(sharp.Kt, 21, 'a/b=10: Kt = 1 + 2(10) = 21');
    near(blunt.Kt, 3, 'a/b=1 (circle) Kt = 3');
    // The two Kt formulas are algebraically identical everywhere.
    near(mid.KtFromRadius!, mid.Kt, 'SELF-CHECK: 1+2√(a/ρ) == 1+2(a/b) for every ratio');
  }

  // ─── STEPPED SHAFT: hard-coded Peterson/Shigley chart table, interpolated ─
  {
    // Exact tabulated NODES (bilinear interpolation must be exact at the nodes).
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.10 }), 'node b/2.0/0.10').Kt, 1.9, 'node: bending D/d=2.0 r/d=0.10 → Kt = 1.9');
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.02 }), 'node b/2.0/0.02').Kt, 2.9, 'node: bending D/d=2.0 r/d=0.02 → Kt = 2.9');
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 1.5, rrd: 0.10 }), 'node b/1.5/0.10').Kt, 1.8, 'node: bending D/d=1.5 r/d=0.10 → Kt = 1.8');
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'tension', DdRatio: 2.0, rrd: 0.05 }), 'node t/2.0/0.05').Kt, 2.2, 'node: tension D/d=2.0 r/d=0.05 → Kt = 2.2');
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'torsion', DdRatio: 2.0, rrd: 0.10 }), 'node s/2.0/0.10').Kt, 1.5, 'node: torsion D/d=2.0 r/d=0.10 → Kt = 1.5');
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'torsion', DdRatio: 1.5, rrd: 0.30 }), 'node s/1.5/0.30').Kt, 1.22, 'node: torsion D/d=1.5 r/d=0.30 → Kt = 1.22');

    // Interpolation between nodes (pinned by hand).
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.075 }), 'interp r/d').Kt, 2.1, 'r/d interp (0.05→2.3, 0.10→1.9) @0.075 → 2.1');
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 1.75, rrd: 0.10 }), 'interp D/d').Kt, 1.85, 'D/d interp (1.5→1.8, 2.0→1.9) @1.75 → 1.85');
    near(ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 1.75, rrd: 0.075 }), 'interp bilinear').Kt, 2.0375, 'bilinear @(D/d=1.75, r/d=0.075) → 2.0375');

    // Dimensioned input resolves the same ratios: D=40, d=20, r=2 → D/d=2, r/d=0.1.
    const dim = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', D: 40, d: 20, r: 2 }), 'shaft dimensioned');
    near(dim.Kt, 1.9, 'dimensioned D40/d20/r2 → D/d=2, r/d=0.1 → Kt = 1.9');
    near(dim.DdRatio!, 2, 'dimensioned D/d = 2');
    near(dim.ratio!, 0.1, 'dimensioned r/d = 0.1');

    // Clamping outside the chart range is flagged.
    const clampHi = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.50 }), 'clamp r/d high');
    near(clampHi.Kt, 1.45, 'r/d=0.50 (beyond 0.30) clamps to Kt = 1.45');
    assert(clampHi.clampedToTable === true, 'r/d beyond range flags clampedToTable');
    const clampLo = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.01 }), 'clamp r/d low');
    near(clampLo.Kt, 2.9, 'r/d=0.01 (below 0.02) clamps to Kt = 2.9');
    const clampDd = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 3.0, rrd: 0.10 }), 'clamp D/d high');
    near(clampDd.Kt, 1.9, 'D/d=3.0 (beyond 2.0) clamps to the D/d=2.0 row → 1.9');
    assert(clampDd.clampedToTable === true, 'D/d beyond range flags clampedToTable');

    // INVARIANTS. Kt falls as the fillet grows; rises as the step grows; mode order.
    const rd02 = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.02 }), 'inv rd 0.02').Kt;
    const rd10 = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.10 }), 'inv rd 0.10').Kt;
    const rd30 = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.30 }), 'inv rd 0.30').Kt;
    assert(rd02 > rd10 && rd10 > rd30, 'INVARIANT: Kt DECREASES as fillet r/d grows (blunter)');
    const dd15 = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 1.5, rrd: 0.10 }), 'inv Dd 1.5').Kt;
    const dd20 = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.10 }), 'inv Dd 2.0').Kt;
    assert(dd20 > dd15, 'INVARIANT: Kt INCREASES as step D/d grows (sharper transition)');
    const tKt = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'tension', DdRatio: 2.0, rrd: 0.10 }), 'inv tension').Kt;
    const bKt = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 2.0, rrd: 0.10 }), 'inv bending').Kt;
    const sKt = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'torsion', DdRatio: 2.0, rrd: 0.10 }), 'inv torsion').Kt;
    assert(sKt < tKt && tKt < bKt, 'INVARIANT: Kt ordered torsion < tension < bending at same geometry');
  }

  // ─── NOTCH FATIGUE: q, Kf ≤ Kt, and the corrected endurance limit ───────
  {
    // Peterson q = 1/(1+a/r), Kf = 1 + q(Kt−1). Kt=3, a=0.2mm, r=2mm.
    const nf = ok(notchFatigue({ Kt: 3, notchRadius: 2, a: 0.2, Se: 200 }), 'notch Kt=3 a=0.2 r=2');
    const qExp = 1 / (1 + 0.2 / 2);
    const KfExp = 1 + qExp * (3 - 1);
    near(nf.q, qExp, 'q = 1/(1+a/r) = 1/1.1 = 0.9091');
    near(nf.Kf, KfExp, 'Kf = 1 + q(Kt−1) = 2.8182');
    assert(nf.Kf <= nf.Kt, 'INVARIANT: Kf ≤ Kt (q ≤ 1)');
    assert(nf.q <= 1 && nf.q > 0, 'INVARIANT: q ∈ (0, 1]');
    near(nf.Se_corrected_MPa!, 200 / KfExp, 'Se_corrected = Se/Kf = 70.968 MPa');
    assert(nf.Se_corrected_MPa! < 200, 'INVARIANT: Se_corrected < Se (notch derates the endurance limit)');

    // BLUNT-notch limit: r → large ⇒ q → 1 ⇒ Kf → Kt.
    const blunt = ok(notchFatigue({ Kt: 3, notchRadius: 1000, a: 0.2 }), 'notch blunt');
    near(blunt.q, 1, 'blunt notch: q → 1');
    near(blunt.Kf, 3, 'blunt notch: Kf → Kt = 3');
    assert(blunt.Kf < 3 && blunt.Kf > 2.99, 'blunt: Kf just below Kt, approaching full sensitivity');

    // SHARP-notch limit: r → small ⇒ q → 0 ⇒ Kf → 1 (notch-size effect).
    const sharp = ok(notchFatigue({ Kt: 3, notchRadius: 0.0001, a: 0.2 }), 'notch sharp');
    near(sharp.q, 0, 'sharp notch: q → 0');
    near(sharp.Kf, 1, 'sharp notch: Kf → 1 (concentration too localised to matter in fatigue)');
    assert(sharp.Kf > 1 && sharp.Kf < 1.01, 'sharp: Kf just above 1');
    assert(sharp.Kf < nf.Kf && nf.Kf < blunt.Kf, 'MONOTONIC: sharper notch → smaller Kf');

    // Estimate the Peterson constant a from Su (steel): a = 0.025·(2070/Su)^1.8.
    const est400 = ok(notchFatigue({ Kt: 3, notchRadius: 2, ultimate: 400 }), 'notch Su=400 estimate a');
    near(est400.petersonConstant_mm, 0.025 * Math.pow(2070 / 400, 1.8), 'a(Su=400) = 0.025·(2070/400)^1.8 ≈ 0.482 mm');
    assert(est400.aEstimated === true, 'aEstimated flagged when derived from Su');
    assert(est400.Su_MPa === 400, 'Su echoed = 400');
    const est2070 = ok(notchFatigue({ Kt: 3, notchRadius: 2, ultimate: 2070 }), 'notch Su=2070 estimate a');
    near(est2070.petersonConstant_mm, 0.025, 'a(Su=2070) = 0.025·1^1.8 = 0.025 mm (anchor)');
    assert(est400.petersonConstant_mm > est2070.petersonConstant_mm, 'SOFT steel has a LARGER a than a HARD steel (hard steel feels sharp notches)');

    // Named material: Su ≈ 1.7·yield (matches the fatigue core), then estimate a.
    const steel = ok(notchFatigue({ Kt: 2.5, notchRadius: 1, material: 'steel' }), 'notch material=steel');
    assert(steel.Su_MPa === 1.7 * 250, 'steel Su = 1.7·yield = 425 MPa');
    near(steel.petersonConstant_mm, 0.025 * Math.pow(2070 / 425, 1.8), 'steel a from Su=425');
    assert(steel.Kf <= 2.5 && steel.Kf >= 1, 'steel Kf bounded 1 ≤ Kf ≤ Kt');

    // COMPOSITION: a stepped-shaft Kt feeds notch fatigue at the fillet radius.
    const sc = ok(stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', D: 40, d: 20, r: 2 }), 'compose: shaft Kt');
    const composed = ok(notchFatigue({ Kt: sc.Kt, notchRadius: 2, material: 'steel', Se: 150 }), 'compose: notch fatigue');
    assert(composed.Kf <= sc.Kt, 'composed Kf ≤ geometric Kt from the shaft');
    assert(composed.Se_corrected_MPa! < 150, 'composed Se_corrected < Se — the notched shaft has a lower fatigue limit');
  }

  // ─── VALIDATION: reject bad inputs, accept the edge cases that are valid ─
  {
    assert(!stressConcentration({ geometry: 'nonsense' }).ok, 'unknown geometry rejected');
    assert(!stressConcentration({ geometry: 'hole_in_plate', diameter: 100, width: 50 }).ok, 'hole diameter ≥ width rejected');
    assert(!stressConcentration({ geometry: 'elliptical_hole', a: 5 }).ok, 'ellipse without b or tipRadius rejected');
    assert(!stressConcentration({ geometry: 'elliptical_hole', a: -5, b: 5 }).ok, 'ellipse non-positive a rejected');
    assert(!stressConcentration({ geometry: 'stepped_shaft', mode: 'bending' }).ok, 'stepped_shaft without ratios rejected');
    assert(!stressConcentration({ geometry: 'stepped_shaft', mode: 'bending', DdRatio: 0.9, rrd: 0.1 }).ok, 'stepped_shaft D/d ≤ 1 rejected');
    assert(!stressConcentration({ geometry: 'stepped_shaft', mode: 'sideways', DdRatio: 2, rrd: 0.1 }).ok, 'stepped_shaft unknown mode rejected');
    assert(!stressConcentration({ geometry: 'hole_in_plate', nominalStress: Infinity as any }).ok, 'non-finite nominalStress rejected');

    assert(!notchFatigue({ notchRadius: 2, a: 0.2 }).ok, 'notchFatigue without Kt rejected');
    assert(!notchFatigue({ Kt: 0.5, notchRadius: 2, a: 0.2 }).ok, 'notchFatigue Kt < 1 rejected');
    assert(!notchFatigue({ Kt: 3, a: 0.2 }).ok, 'notchFatigue without radius rejected');
    assert(!notchFatigue({ Kt: 3, notchRadius: 2 }).ok, 'notchFatigue without a/Su/material rejected');
    assert(!notchFatigue({ Kt: 3, notchRadius: 2, a: 0.2, Se: -5 }).ok, 'notchFatigue non-positive Se rejected');
    assert(!notchFatigue({ Kt: 3, notchRadius: 2, material: 'unobtainium' }).ok, 'notchFatigue unknown material rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-stress-concentration-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-stress-concentration-core smoke cases passed');
}

main();
