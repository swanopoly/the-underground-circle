/**
 * engineering-fatigue-core smoke.
 *
 * Fatigue is closed-form, so the smoke IS the proof: every criterion is pinned
 * against a HAND-COMPUTED reference, and — more powerfully — against the internal
 * invariants a single point value can hide. The reference case σa=100, σm=50,
 * Su=500, Se=200 gives n_Goodman = 1/(0.5+0.1) = 1.6667 exactly; the strict
 * nesting n_Soderberg < n_Goodman < n_Gerber catches a swapped criterion; the
 * S-N line must anchor exactly on f·Su at 10³ cycles and Se at 10⁶; and a σm ≤ 0
 * cycle must collapse to n = Se/σa. Se' = 0.5·Su is pinned with its 700 MPa cap
 * for hard steels.
 */

import {
  enduranceLimit, goodmanSafetyFactor, fullyReversedLife,
} from '../src/lib/engineeringFatigueCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

function main() {
  // ─── Endurance limit (Se' and Marin factors) ────────────────────────
  {
    // Se' = 0.5·Su, then Se = ka·kb·kc·Se'.
    const base = ok(enduranceLimit({ ultimate: 800 }), 'endurance Su=800');
    near(base.SePrime_MPa, 400, "Se' = 0.5·800 = 400 MPa");
    assert(base.capped === false, 'Su=800 is below the 700 cap (not capped)');
    near(base.Se_MPa, 400, 'polished/small/bending → Se = Se′ (all factors 1)');

    // explicit surface factor 0.8 → Se = 320 (the pinned reference).
    const machinedFactor = ok(enduranceLimit({ ultimate: 800, surfaceFactor: 0.8 }), 'endurance ka=0.8');
    near(machinedFactor.Se_MPa, 320, 'Su=800, ka=0.8, kb=1, kc=1 → Se = 320 MPa');

    // the "machined" finish name maps to ≈0.8 → same Se.
    const machinedName = ok(enduranceLimit({ ultimate: 800, surfaceFinish: 'machined' }), 'endurance machined');
    near(machinedName.ka_surface, 0.8, "surfaceFinish 'machined' → ka ≈ 0.8");
    near(machinedName.Se_MPa, 320, 'machined finish → Se = 320 MPa');

    // ground ≈ 0.9.
    const ground = ok(enduranceLimit({ ultimate: 800, surfaceFinish: 'ground' }), 'endurance ground');
    near(ground.ka_surface, 0.9, "surfaceFinish 'ground' → ka ≈ 0.9");
    near(ground.Se_MPa, 360, 'ground finish → Se = 0.9·400 = 360 MPa');

    // load factors: axial kc=0.85, torsion kc=0.59.
    const axial = ok(enduranceLimit({ ultimate: 800, loadType: 'axial' }), 'endurance axial');
    near(axial.kc_load, 0.85, 'axial load → kc = 0.85');
    near(axial.Se_MPa, 340, 'axial → Se = 0.85·400 = 340 MPa');
    const torsion = ok(enduranceLimit({ ultimate: 800, loadType: 'torsion' }), 'endurance torsion');
    near(torsion.kc_load, 0.59, 'torsion load → kc = 0.59');
    near(torsion.Se_MPa, 236, 'torsion → Se = 0.59·400 = 236 MPa');

    // Se' cap: Su > 1400 caps Se' at 700; Su = 1400 gives exactly 700 uncapped.
    const hard = ok(enduranceLimit({ ultimate: 1600 }), 'endurance hard steel');
    near(hard.SePrime_MPa, 700, "Su=1600 → Se' capped at 700 (not 800)");
    assert(hard.capped === true, 'Su=1600 trips the 700 MPa cap');
    const boundary = ok(enduranceLimit({ ultimate: 1400 }), 'endurance Su=1400');
    near(boundary.SePrime_MPa, 700, "Su=1400 → Se' = 0.5·1400 = 700 (boundary, uncapped)");
    assert(boundary.capped === false, 'Su=1400 is the boundary, not capped');

    // material estimate: Su ≈ 1.7·yield (steel yield 250 → Su 425).
    const mat = ok(enduranceLimit({ material: 'steel' }), 'endurance material steel');
    near(mat.Su_MPa, 425, 'steel: Su estimated as 1.7·250 = 425 MPa');
    near(mat.SePrime_MPa, 212.5, "steel: Se' = 0.5·425 = 212.5 MPa");
    assert(mat.suEstimated === true, 'material path flags Su as estimated');

    // size factor from a diameter (bending) vs axial (no size effect).
    const sized = ok(enduranceLimit({ ultimate: 800, diameter: 50 }), 'endurance Ø50 bending');
    near(sized.kb_size, 1.24 * Math.pow(50, -0.107), 'kb(Ø50, bending) = 1.24·50^-0.107 ≈ 0.816');
    assert(sized.kb_size > 0.7 && sized.kb_size < 0.9, 'kb(Ø50) sits in 0.7–0.9');
    const sizedAxial = ok(enduranceLimit({ ultimate: 800, loadType: 'axial', diameter: 50 }), 'endurance Ø50 axial');
    near(sizedAxial.kb_size, 1, 'axial loading has no size effect → kb = 1 even with a diameter');

    // validation
    assert(!enduranceLimit({}).ok, 'endurance with no ultimate/material is rejected');
    assert(!enduranceLimit({ ultimate: -100 }).ok, 'negative ultimate rejected');
    assert(!enduranceLimit({ ultimate: 800, loadType: 'bogus' }).ok, 'unknown loadType rejected');
  }

  // ─── Goodman / Soderberg / Gerber ───────────────────────────────────
  {
    // reference: σa=100, σm=50, Su=500, Se=200 → 1/n = 0.5 + 0.1 = 0.6 → n = 1.6667.
    const ref = ok(goodmanSafetyFactor({ alternating: 100, mean: 50, ultimate: 500, endurance: 200, yield: 400 }), 'Goodman reference');
    near(ref.n_goodman, 1 / 0.6, 'n_Goodman = 1/(100/200 + 50/500) = 1.6667');
    assert(ref.fullyReversed === false, 'tensile mean is not fully reversed');

    // Soderberg uses yield (400 < 500) so it is more conservative than Goodman.
    near(ref.n_soderberg!, 1 / (0.5 + 50 / 400), 'n_Soderberg = 1/(0.5 + 50/400) = 1.6');
    assert(ref.n_soderberg! < ref.n_goodman, 'Soderberg (yield) is MORE conservative than Goodman (Sy < Su)');

    // Gerber (parabola) is less conservative than Goodman.
    const termG = (2 * 50 * 200) / (500 * 100);
    const gerberRef = 0.5 * Math.pow(500 / 50, 2) * (100 / 200) * (-1 + Math.sqrt(1 + termG * termG));
    near(ref.n_gerber!, gerberRef, 'n_Gerber matches the closed-form parabola (≈1.9256)');
    assert(ref.n_gerber! > ref.n_goodman, 'Gerber is LESS conservative than Goodman');
    // the full nesting in one shot.
    assert(ref.n_soderberg! < ref.n_goodman && ref.n_goodman < ref.n_gerber, 'strict nesting n_Soderberg < n_Goodman < n_Gerber');

    // first-cycle yield (Langer): σmax = 150, Sy=400 → n_y = 2.6667; Goodman governs here.
    near(ref.n_yield!, 400 / 150, 'first-cycle yield n_y = Sy/(σa+σm) = 400/150 = 2.6667');
    assert(ref.governing === 'goodman', 'Goodman governs (1.667 < 2.667 yield)');
    near(ref.governing_n, 1 / 0.6, 'governing_n is the Goodman factor');

    // fully reversed (σm = 0) → n = Se/σa = 2.0 for all criteria.
    const fr = ok(goodmanSafetyFactor({ alternating: 100, mean: 0, ultimate: 500, endurance: 200 }), 'fully reversed');
    near(fr.n_goodman, 2.0, 'fully reversed n = Se/σa = 200/100 = 2.0');
    assert(fr.fullyReversed === true, 'σm = 0 flagged fully reversed');
    near(fr.n_gerber!, 2.0, 'Gerber also = Se/σa when fully reversed');

    // compressive mean is conservatively treated as fully reversed (no credit).
    const comp = ok(goodmanSafetyFactor({ alternating: 100, mean: -30, ultimate: 500, endurance: 200 }), 'compressive mean');
    near(comp.n_goodman, 2.0, 'compressive mean → n = Se/σa = 2.0 (benefit not credited)');
    assert(comp.fullyReversed === true, 'compressive mean flagged fully reversed');

    // overloaded cycle: n < 1 → failure. σa=180, σm=90 → 1/n = 0.9 + 0.18 = 1.08.
    const fail = ok(goodmanSafetyFactor({ alternating: 180, mean: 90, ultimate: 500, endurance: 200 }), 'overloaded');
    near(fail.n_goodman, 1 / 1.08, 'n = 1/(180/200 + 90/500) = 0.9259 < 1');
    assert(fail.n_goodman < 1, 'overloaded cycle predicts fatigue failure (n < 1)');

    // Se estimate path: no endurance given, Su=500 → Se = 250; n = 1/(100/250 + 50/500) = 2.0.
    const est = ok(goodmanSafetyFactor({ alternating: 100, mean: 50, ultimate: 500 }), 'Se estimated');
    near(est.Se_MPa, 250, "endurance estimated as 0.5·Su = 250 MPa");
    near(est.n_goodman, 2.0, 'estimated-Se Goodman n = 1/(0.4 + 0.1) = 2.0');
    assert(est.seEstimated === true && est.notes.some((s) => /estimated/i.test(s)), 'estimate is flagged in the result + notes');

    // material fills Su (1.7·250=425) and Sy (250).
    const mat = ok(goodmanSafetyFactor({ alternating: 50, mean: 30, material: 'steel', endurance: 150 }), 'material fill');
    near(mat.Su_MPa, 425, 'material steel → Su = 425 MPa');
    near(mat.Sy_MPa!, 250, 'material steel → Sy = 250 MPa');

    // validation
    assert(!goodmanSafetyFactor({ alternating: 0, ultimate: 500, endurance: 200 }).ok, 'zero alternating stress rejected');
    assert(!goodmanSafetyFactor({ alternating: 100, mean: 50, endurance: 200 }).ok, 'missing Su (with tensile mean) rejected');
  }

  // ─── Fully-reversed finite life (S-N) ───────────────────────────────
  {
    // Su=800, Se=320, f=0.9 → f·Su = 720. a = 720²/320 = 1620; the line anchors
    // on 720 at 10³ and 320 at 10⁶ by construction.
    const infinite = ok(fullyReversedLife({ alternating: 150, ultimate: 800, endurance: 320 }), 'S-N infinite');
    assert(infinite.classification === 'infinite' && infinite.cycles === null, 'σa=150 < Se=320 → infinite life');
    near(infinite.sn_a, 1620, 'a = (0.9·800)²/320 = 1620');

    const finite = ok(fullyReversedLife({ alternating: 500, ultimate: 800, endurance: 320 }), 'S-N finite');
    assert(finite.classification === 'finite', 'σa=500 between Se and f·Su → finite life');
    assert(finite.cycles !== null && finite.cycles > 1e3 && finite.cycles < 1e6, 'finite life sits between 10³ and 10⁶ cycles');
    // round-trip: plugging the life back into S = a·N^b returns σa.
    near(finite.sn_a * Math.pow(finite.cycles!, finite.sn_b), 500, 'S(N) round-trips to σa = 500 MPa', 1e-3);
    // anchors: S(10³) = f·Su, S(10⁶) = Se.
    near(finite.sn_a * Math.pow(1e3, finite.sn_b), 720, 'S-N anchor: S(10³) = f·Su = 720 MPa', 1e-3);
    near(finite.sn_a * Math.pow(1e6, finite.sn_b), 320, 'S-N anchor: S(10⁶) = Se = 320 MPa', 1e-3);

    const lowCycle = ok(fullyReversedLife({ alternating: 760, ultimate: 800, endurance: 320 }), 'S-N low cycle');
    assert(lowCycle.classification === 'low_cycle', 'σa=760 ≥ f·Su=720 → low-cycle (elastic S-N no longer applies)');

    // validation
    assert(!fullyReversedLife({ alternating: -5, ultimate: 800, endurance: 320 }).ok, 'negative alternating stress rejected');
    assert(!fullyReversedLife({ alternating: 400, ultimate: 800, endurance: 800 }).ok, 'Se ≥ f·Su rejected (degenerate S-N line)');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-fatigue-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-fatigue-core smoke cases passed.');
}

main();
