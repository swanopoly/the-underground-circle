/**
 * engineering-bolted-joint-core smoke.
 *
 * The bolted-joint diagram, pinned against hand-computed Shigley references. A
 * bolt (spring kb) and its clamped members (spring km) share an external load in
 * parallel; because the members are a short fat barrel and the bolt is long and
 * slender, km ≫ kb and the fraction the BOLT picks up, C = kb/(kb+km), is SMALL
 * (≈ 0.24 for the M12-in-30 mm-steel joint here). That is the whole point: of an
 * external load P the bolt gains only C·P while the members shed (1−C)·P, and
 * those add back to exactly P — so a preloaded bolt feels a fraction of the load
 * a bare bolt would, and its fatigue is far milder. The joint opens (Fm = 0) at
 * P0 = Fi/(1−C); the bolt's alternating stress σa = C·(Pmax−Pmin)/(2At) carries
 * that same protective C, so a stiffer member (lower C) directly improves the
 * fatigue factor. The smoke IS the proof.
 */

import {
  jointStiffness, separationLoad, boltFatigue,
  TAN_FRUSTUM, STRESS_AREA_COEFF,
} from '../src/lib/engineeringBoltedJointCore';

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
  // ─── The TEXTBOOK joint (Shigley): M12 bolt, 30 mm steel grip ─────
  // d=12, L=30, Eb=Em=200000 → kb=240000π, km (frustum), C≈0.2380.
  const J = ok(jointStiffness({ boltDiameter: 12, grip: 30 }), 'textbook joint stiffness');
  near(J.boltStiffness_N_per_mm, 240000 * Math.PI, 'kb = (π/4·d²)·E/L = 240000π = 753,982 N/mm', 1e-6);
  near(J.memberStiffness_N_per_mm, 2413498.99, 'km = Shigley 30° frustum = 2,413,499 N/mm', 1e-5);
  near(J.stiffnessConstant_C, 0.238038, 'C = kb/(kb+km) = 0.2380', 1e-4);

  // C BOUNDS anchor: 0 < C < 1, and km ≫ kb makes it small.
  assert(J.stiffnessConstant_C > 0 && J.stiffnessConstant_C < 1, '0 < C < 1 always');
  assert(J.stiffnessConstant_C < 0.5, 'C < 0.5 for a typical steel joint (members far stiffer)');
  assert(J.memberStiffness_N_per_mm > 3 * J.boltStiffness_N_per_mm, 'km ≫ kb (members are far stiffer than the bolt)');
  near(J.memberLoadFraction, 1 - J.stiffnessConstant_C, 'member load fraction = 1 − C');

  // exported constants
  near(TAN_FRUSTUM, 1 / Math.sqrt(3), 'TAN_FRUSTUM is the exact tan30° = 1/√3');
  near(STRESS_AREA_COEFF, 0.9382, 'STRESS_AREA_COEFF = (0.6495+1.2269)/2 = 0.9382');

  // recompute km inline from the closed form → the code matches the cited formula
  {
    const d = 12, L = 30, E = 200000, t = TAN_FRUSTUM;
    const kmExpected = (Math.PI * E * d * t) / (2 * Math.log(5 * (L * t + 0.5 * d) / (L * t + 2.5 * d)));
    near(J.memberStiffness_N_per_mm, kmExpected, 'km matches π·E·d·tan30°/(2·ln[5(L·t+0.5d)/(L·t+2.5d)])', 1e-6);
  }

  // C = 0.5 EXACTLY when kb = km (pin the balance point)
  {
    const eq = ok(jointStiffness({ boltStiffness: 1000, memberStiffness: 1000 }), 'kb=km joint');
    near(eq.stiffnessConstant_C, 0.5, 'kb = km → C = 0.5 exactly');
    near(eq.memberLoadFraction, 0.5, 'kb = km → member fraction = 0.5');
    // explicit kb,km path needs no geometry
    const g = ok(jointStiffness({ boltStiffness: 750000, memberStiffness: 2250000 }), 'explicit stiffness path');
    near(g.stiffnessConstant_C, 0.25, 'C = kb/(kb+km) from explicit stiffnesses (750k/3000k = 0.25)');
  }

  // ─── THE PROTECTION anchor: the load split bookkeeping closes ────
  {
    // apply P=20 kN with Fi=40 kN on the textbook joint
    const s = ok(jointStiffness({ boltDiameter: 12, grip: 30, preload: 40000, externalLoad: 20000 }), 'joint with load');
    const C = s.stiffnessConstant_C;
    near(s.boltLoadIncrease_N!, C * 20000, 'bolt gains ΔFb = C·P');
    near(s.memberLoadDecrease_N!, (1 - C) * 20000, 'members shed ΔFm = (1−C)·P');
    // the two changes add back to exactly the external load P
    near(s.boltLoadIncrease_N! + s.memberLoadDecrease_N!, 20000, 'C·P + (1−C)·P = P (the split closes) — THE joint-diagram identity');
    // the bolt feels only a FRACTION of P
    assert(s.boltLoadIncrease_N! < 20000 && s.boltLoadIncrease_N! < 0.3 * 20000, 'bolt feels only C·P (≈24%) of the external load — this is why preload protects it');
    near(s.boltForce_N!, 40000 + C * 20000, 'Fb = Fi + C·P');
    near(s.memberForce_N!, 40000 - (1 - C) * 20000, 'Fm = Fi − (1−C)·P');
    assert(s.jointSeparated === false, 'members still clamped at P=20 kN (Fm > 0)');
  }

  // ─── Separation: P0 = Fi/(1−C); member force = 0 there ───────────
  {
    const C = 0.25, Fi = 40000;
    const sep = ok(separationLoad({ preload: Fi, stiffnessConstant: C, externalLoad: 20000 }), 'separation');
    near(sep.separationLoad_N, Fi / (1 - C), 'P0 = Fi/(1−C) = 40000/0.75 = 53,333 N');
    near(sep.separationLoad_N, 53333.33, 'P0 numeric', 1e-4);
    near(sep.safetyFactor!, (Fi / (1 - C)) / 20000, 'n0 = P0/P');
    assert(sep.adequate === true, 'P0 > P → adequate against separation');

    // feed P0 back into the joint diagram → member force is exactly 0 there
    const atP0 = ok(jointStiffness({ boltStiffness: 750000, memberStiffness: 2250000, preload: Fi, externalLoad: sep.separationLoad_N }), 'joint at P0');
    near(atP0.stiffnessConstant_C, 0.25, 'same C = 0.25 for this explicit joint');
    near(atP0.memberForce_N!, 0, 'at P = P0 the member force is exactly 0 (definition of separation)', 1e-6);

    // higher preload → higher separation load (MONOTONIC)
    const lo = ok(separationLoad({ preload: 20000, stiffnessConstant: 0.25 }), 'sep lo preload');
    const hi = ok(separationLoad({ preload: 60000, stiffnessConstant: 0.25 }), 'sep hi preload');
    assert(hi.separationLoad_N > lo.separationLoad_N, 'higher preload → higher separation load (monotonic)');
    near(hi.separationLoad_N / lo.separationLoad_N, 3, 'separation load scales linearly with preload (60k/20k = 3×)');

    // overload → not adequate
    const over = ok(separationLoad({ preload: 10000, stiffnessConstant: 0.25, externalLoad: 20000 }), 'sep overload');
    assert(over.adequate === false && over.safetyFactor! < 1, 'P0 < P → separates, not adequate');

    // C from explicit stiffnesses matches the direct-C path
    const viaK = ok(separationLoad({ preload: Fi, boltStiffness: 750000, memberStiffness: 2250000, externalLoad: 20000 }), 'sep via stiffness');
    near(viaK.separationLoad_N, sep.separationLoad_N, 'separation load same whether C is given or derived from kb,km');
  }

  // ─── Bolt fatigue: TEXTBOOK numbers (C=0.25, M12 class 8.8) ──────
  // Fi=40 kN, P: 0..20 kN, At=84.3, Su=830, Se=129, Sy=660.
  {
    const f = ok(boltFatigue({
      stiffnessConstant: 0.25, preload: 40000, loadMin: 0, loadMax: 20000,
      stressArea: 84.3, ultimate: 830, endurance: 129, proof: 660,
    }), 'textbook bolt fatigue');

    near(f.alternatingForce_N, 0.25 * 20000 / 2, 'alternating bolt force = C·(Pmax−Pmin)/2 = 2500 N');
    near(f.meanForce_N, 40000 + 0.25 * 20000 / 2, 'mean bolt force = Fi + C·(Pmax+Pmin)/2 = 42,500 N');
    near(f.alternating_MPa, 29.656, 'σa = C·ΔP/(2·At) = 2500/84.3 = 29.66 MPa', 1e-3);
    near(f.mean_MPa, 504.1518, 'σm = meanForce/At = 42500/84.3 = 504.15 MPa', 1e-4);
    near(f.preloadStress_MPa, 474.4958, 'σi = Fi/At = 40000/84.3 = 474.50 MPa', 1e-4);
    near(f.maxStress_MPa, 533.8078, 'σmax = σm + σa = 533.81 MPa', 1e-4);
    // for Pmin=0, σm − σi collapses to σa exactly
    near(f.mean_MPa - f.preloadStress_MPa, f.alternating_MPa, 'σm − σi = σa when Pmin = 0');

    near(f.nf_goodman, 1.1943, 'nf_goodman = 1/(σa/Se + σm/Su) = 1.1943 (naive, penalises the preload mean)', 1e-3);
    near(f.nf_preload!, 1.6125, 'nf_preload = Se(Su−σi)/(Su·σa+Se(σm−σi)) = 1.6125 (Shigley Eq.8-45)', 1e-3);
    near(f.nf_yield!, 1.2364, 'ny = Sy/σmax = 660/533.81 = 1.2364 (first-cycle yield)', 1e-3);

    // the preload-referenced form is the HIGHER, correct factor — preload helps
    assert(f.nf_preload! > f.nf_goodman, 'nf_preload > nf_goodman: crediting the preload as the load-line origin improves the fatigue factor');
    // first-cycle yield is the lowest here → it governs ("improves fatigue up to yield")
    assert(f.governing === 'first_cycle_yield', 'first-cycle yield governs (the yield ceiling caps the fatigue benefit)');
    near(f.governing_n, Math.min(f.nf_preload!, f.nf_yield!), 'governing n = min(fatigue, first-cycle yield)');
  }

  // ─── nf_preload reduces to standard Goodman when σi = 0 ──────────
  {
    // Fi=0 → σi=0 → the preload-referenced form must collapse to nf_goodman
    const z = ok(boltFatigue({
      stiffnessConstant: 0.25, preload: 0, loadMin: 0, loadMax: 20000,
      stressArea: 84.3, ultimate: 830, endurance: 129,
    }), 'zero-preload fatigue');
    near(z.preloadStress_MPa, 0, 'σi = 0 with no preload');
    near(z.nf_preload!, z.nf_goodman, 'nf_preload → nf_goodman when σi = 0 (consistency: the two formulas agree)', 1e-6);
  }

  // ─── THE DESIGN LEVER: stiffer member (lower C) → lower σa → higher nf
  {
    const common = { preload: 40000, loadMin: 0, loadMax: 20000, stressArea: 84.3, ultimate: 830, endurance: 129, boltStiffness: 750000 };
    const soft = ok(boltFatigue({ ...common, memberStiffness: 2400000 }), 'softer member'); // C≈0.238
    const stiff = ok(boltFatigue({ ...common, memberStiffness: 4800000 }), 'stiffer member'); // C≈0.135
    assert(stiff.stiffnessConstant_C < soft.stiffnessConstant_C, 'stiffer member (higher km) → lower C');
    assert(stiff.alternating_MPa < soft.alternating_MPa, 'lower C → lower σa (the alternating stress carries the factor C)');
    assert(stiff.nf_preload! > soft.nf_preload!, 'lower C → higher nf_preload (THE design lever: a stiffer joint protects the bolt)');
    assert(stiff.nf_goodman > soft.nf_goodman, 'lower C → higher nf_goodman too (same lever in the naive form)');
  }

  // ─── Higher preload raises the mean stress σm ────────────────────
  {
    const base = { stiffnessConstant: 0.25, loadMin: 0, loadMax: 20000, stressArea: 84.3, ultimate: 830, endurance: 129 };
    const lo = ok(boltFatigue({ ...base, preload: 30000 }), 'low preload');
    const hi = ok(boltFatigue({ ...base, preload: 50000 }), 'high preload');
    assert(hi.mean_MPa > lo.mean_MPa, 'higher preload raises σm (the mean is dominated by the preload)');
    near(hi.alternating_MPa, lo.alternating_MPa, 'σa is UNCHANGED by preload (it depends only on C and the load range)');
    assert(hi.preloadStress_MPa > lo.preloadStress_MPa, 'higher preload raises σi');
  }

  // ─── General Pmin ≠ 0: σa uses the range, σm uses the average ────
  {
    const g = ok(boltFatigue({
      stiffnessConstant: 0.25, preload: 40000, loadMin: 5000, loadMax: 25000,
      stressArea: 84.3, ultimate: 830, endurance: 129,
    }), 'nonzero Pmin fatigue');
    // same 20 kN range → same σa as the 0..20 kN case
    near(g.alternating_MPa, 29.656, 'σa depends only on the load RANGE (5..25 kN gives the same σa as 0..20 kN)', 1e-3);
    near(g.mean_MPa, 43750 / 84.3, 'σm = [Fi + C·(Pmax+Pmin)/2]/At = 43750/84.3 = 518.98 MPa', 1e-4);
    // now σm − σi ≠ σa (the mean load is off-zero)
    assert(Math.abs((g.mean_MPa - g.preloadStress_MPa) - g.alternating_MPa) > 1, 'with Pmin ≠ 0, σm − σi ≠ σa (the mean rides above the preload)');
    near(g.mean_MPa - g.preloadStress_MPa, 3750 / 84.3, 'σm − σi = C·(Pmax+Pmin)/2 / At = 3750/84.3');
  }

  // ─── At from diameter+pitch, and explicit override ──────────────
  {
    const byDia = ok(boltFatigue({
      stiffnessConstant: 0.25, preload: 40000, loadMax: 20000,
      boltDiameter: 12, pitch: 1.75, ultimate: 830, endurance: 129,
    }), 'At from M12 geometry');
    near(byDia.stressArea_mm2, 84.3, 'At(M12) = π/4·(12−0.9382·1.75)² ≈ 84.3 mm²', 2e-3);
    assert(byDia.stressAreaBasis.includes('0.9382'), 'stress-area basis is reported');

    const approx = ok(boltFatigue({
      stiffnessConstant: 0.25, preload: 40000, loadMax: 20000,
      boltDiameter: 11, ultimate: 830, endurance: 129,
    }), 'At approx (no pitch)');
    near(approx.stressArea_mm2, Math.PI / 4 * (0.85 * 11) ** 2, 'no pitch → At = π/4·(0.85d)² approximation', 1e-4);
  }

  // ─── Series bolt stiffness (shank + thread) is softer than either alone
  {
    const series = ok(jointStiffness({ boltDiameter: 12, grip: 40, shankLength: 25, threadLength: 15, stressArea: 84.3 }), 'series bolt kb');
    const d = 12, E = 200000;
    const Ad = Math.PI / 4 * d * d;
    const kd = Ad * E / 25, kt = 84.3 * E / 15;
    near(series.boltStiffness_N_per_mm, (kd * kt) / (kd + kt), 'series kb = kd·kt/(kd+kt) (shank + thread springs in series)', 1e-6);
    assert(series.boltStiffness_N_per_mm < kd && series.boltStiffness_N_per_mm < kt, 'series stiffness is softer than either portion alone');
    assert(series.boltStiffnessBasis.includes('series'), 'series basis reported');
  }

  // ─── Material lookup for the moduli (composes MATERIALS) ─────────
  {
    const al = ok(jointStiffness({ boltDiameter: 12, grip: 30, memberMaterial: 'aluminum' }), 'aluminum members');
    const st = ok(jointStiffness({ boltDiameter: 12, grip: 30, memberMaterial: 'steel' }), 'steel members');
    assert(al.memberStiffness_N_per_mm < st.memberStiffness_N_per_mm, 'aluminum members (lower E) are less stiff than steel');
    assert(al.stiffnessConstant_C > st.stiffnessConstant_C, 'softer members → the bolt picks up a LARGER share C');
  }

  // ─── Validation: bad inputs fail closed ─────────────────────────
  {
    assert(!jointStiffness({ boltDiameter: 12 }).ok, 'frustum km with no grip rejected');
    assert(!jointStiffness({ grip: 30 }).ok, 'frustum km with no diameter rejected');
    assert(!jointStiffness({ boltStiffness: 750000, memberStiffness: 2250000, preload: -1, externalLoad: 100 }).ok, 'negative preload rejected');
    assert(!separationLoad({ preload: 40000, stiffnessConstant: 1 }).ok, 'C = 1 (rigid members, never separates) rejected');
    assert(!separationLoad({ preload: 40000, stiffnessConstant: 0 }).ok, 'C = 0 rejected');
    assert(!separationLoad({ preload: 40000 } as any).ok, 'separation with no C and no stiffnesses rejected');
    assert(!separationLoad({ preload: 0, stiffnessConstant: 0.25 }).ok, 'non-positive preload rejected');
    assert(!boltFatigue({ stiffnessConstant: 0.25, preload: 40000, loadMax: 0, stressArea: 84.3, ultimate: 830, endurance: 129 }).ok, 'loadMax ≤ loadMin rejected (no load range)');
    assert(!boltFatigue({ stiffnessConstant: 0.25, preload: 40000, loadMax: 20000, stressArea: 84.3, endurance: 129 } as any).ok, 'fatigue with no ultimate rejected');
    assert(!boltFatigue({ stiffnessConstant: 0.25, preload: 40000, loadMax: 20000, stressArea: 84.3, ultimate: 830 } as any).ok, 'fatigue with no endurance rejected');
    assert(!boltFatigue({ stiffnessConstant: 0.25, preload: 4_000_000, loadMax: 20000, stressArea: 84.3, ultimate: 830, endurance: 129 }).ok, 'preload stress ≥ Su rejected (bolt overloaded by preload alone)');
    assert(!boltFatigue({ preload: 40000, loadMax: 20000, stressArea: 84.3, ultimate: 830, endurance: 129 } as any).ok, 'fatigue with no C and no stiffnesses rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-bolted-joint-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-bolted-joint-core smoke cases passed');
}

main();
