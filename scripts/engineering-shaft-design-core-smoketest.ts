/**
 * engineering-shaft-design-core smoke — the CAPSTONE proof.
 *
 * A real shaft carries bending AND torsion at once, so it must be sized by a
 * failure theory, and this core is proven three ways that a single number cannot
 * fake:
 *
 *  1. LIMITING CASES = COMPOSITION. With T=0 the MSST/DE diameter reproduces PURE
 *     BENDING (σ=32M/πd³ = Sy/n), and with M=0 it reproduces PURE TORSION
 *     (τ=16T/πd³ = Sy/(2n)) with d³ = 32nT/πSy — the exact answer the existing
 *     shaft_torsion lane gives. The smoke feeds the computed pure-torsion diameter
 *     BACK into calc-core's shaftTorsion and gets Sy/(2n); it feeds the pure-bending
 *     diameter into sectionCircle and recovers Sy/n. The capstone reduces to the
 *     lanes it is built on.
 *
 *  2. THEORY ORDERING. For any combined M,T the DE diameter is SMALLER than MSST
 *     (√(M²+¾T²) ≤ √(M²+T²)), with equality only at T=0 — asserted directly. At the
 *     governing MSST diameter the max shear equals Sy/(2n) EXACTLY and the von Mises
 *     equals the stress core's √(σ²+3τ²), tying the capstone to the Mohr/von-Mises
 *     lane. The 3-4-5 case (M=300k, T=400k) makes σ=150, τ=100, τmax=125, vm=229.13.
 *
 *  3. FATIGUE PINNED TO SHIGLEY. The DE-Goodman shaft equation (Eq. 7-8) is pinned
 *     to worked Example 7-1 (d=1.10 in, Ma=1260, Tm=1100 lbf·in, Se=31.1, Sut=105
 *     kpsi, Kf=1.68, Kfs=1.42 → n=1.614); because n is dimensionless the US-unit
 *     inputs pin it exactly, and a deliberately coefficient-swapped computation
 *     (1.770) confirms the 4-and-3 coefficients are load-bearing.
 *
 * The smoke IS the proof: no app, no engine, no network.
 */

import { shaftDiameter, shaftFatigue, equivalentLoads } from '../src/lib/engineeringShaftDesignCore';
import { shaftTorsion, sectionCircle } from '../src/lib/engineeringCalcCore';
import { principalStresses, vonMises } from '../src/lib/engineeringStressCore';

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
  // ── equivalentLoads: the classic combined-load reductions ──────────────────
  {
    // 3-4-5: M=3000, T=4000 → Te=√(9e6+16e6)=5000, Me=½(3000+5000)=4000.
    const e = ok(equivalentLoads({ bendingMoment: 3000, torque: 4000 }), 'equivalentLoads(3000,4000)');
    near(e.equivalentTwistingMoment, 5000, 'Te = √(M²+T²) = 5000');
    near(e.equivalentBendingMoment, 4000, 'Me = ½(M+Te) = 4000');
    // T=0 limit → Te = Me = M (pure bending).
    const eb = ok(equivalentLoads({ bendingMoment: 7000, torque: 0 }), 'equivalentLoads pure bending');
    near(eb.equivalentTwistingMoment, 7000, 'T=0: Te = M = 7000');
    near(eb.equivalentBendingMoment, 7000, 'T=0: Me = M = 7000');
    // M=0 limit → Te = T, Me = T/2 (pure torsion).
    const et = ok(equivalentLoads({ bendingMoment: 0, torque: 8000 }), 'equivalentLoads pure torsion');
    near(et.equivalentTwistingMoment, 8000, 'M=0: Te = T = 8000');
    near(et.equivalentBendingMoment, 4000, 'M=0: Me = T/2 = 4000');
  }

  // ── STATIC combined case (3-4-5): M=300000, T=400000, Sy=500, n=2 ──────────
  // Me=√(3e5²+4e5²)=5e5. k=32·2/(π·500). dMSST=27.3114, dDE=26.5291 (hand-computed,
  // node-verified). At dMSST: σ=150, τ=100, τmax=√(75²+100²)=125=Sy/(2n),
  // vm=√(150²+3·100²)=√52500=229.1288, nMSST=2, nDE=2·Me/deG=2.18218.
  {
    const v = ok(shaftDiameter({ bendingMoment: 300000, torque: 400000, yield: 500, safetyFactor: 2 }), 'shaftDiameter combined');
    near(v.equivalentMoment, 500000, 'Me = √(M²+T²) = 500000 N·mm');
    near(v.deEquivalentMoment, Math.sqrt(300000 ** 2 + 0.75 * 400000 ** 2), 'DE group = √(M²+¾T²)');
    near(v.recommendedDiameter, 27.3114, 'MSST diameter = 27.3114 mm');
    near(v.diameterMSST, 27.3114, 'diameterMSST = 27.3114 mm');
    near(v.diameterDE, 26.5291, 'diameterDE = 26.5291 mm');
    assert(v.governing === 'MSST', 'MSST governs (conservative, larger d)');
    assert(v.diameterDE < v.diameterMSST, 'DE diameter is SMALLER than MSST for combined M,T');
    near(v.bendingStress, 150, 'σ = 32M/πd³ = 150 MPa at dMSST');
    near(v.torsionalShear, 100, 'τ = 16T/πd³ = 100 MPa at dMSST');
    near(v.maxShearStress, 125, 'τ_max = √((σ/2)²+τ²) = 125 MPa');
    near(v.maxShearStress, v.allowableShear, 'τ_max EXACTLY equals Sy/(2n) = 125 at the MSST diameter');
    near(v.vonMisesStress, Math.sqrt(52500), 'σ_vm = √(150²+3·100²) = √52500 = 229.1288 MPa');
    near(v.allowableNormal, 250, 'allowable normal = Sy/n = 250 MPa');
    near(v.allowableShear, 125, 'allowable shear = Sy/(2n) = 125 MPa');
    near(v.realizedSafetyFactorMSST, 2, 'realized MSST safety factor = target n = 2');
    near(v.realizedSafetyFactorDE, 2.18218, 'realized DE factor = n·Me/deG = 2.18218 (MSST left DE margin)');
    assert(v.realizedSafetyFactorDE > v.realizedSafetyFactorMSST, 'at the MSST diameter DE has MORE margin than target');

    // COMPOSE with the stress lane: the combined element {σ,0,τ} must give the same
    // τ_max and von Mises through Mohr's circle / the stress core.
    const p = ok(principalStresses({ sigmaX: v.bendingStress, sigmaY: 0, tauXY: v.torsionalShear }), 'stress-core Mohr of {σ,0,τ}');
    near(p.tauMaxInPlane, v.maxShearStress, 'CROSS-LANE: stress-core τ_max(in-plane) == shaft τ_max = 125');
    const vm = ok(vonMises({ sigmaX: v.bendingStress, sigmaY: 0, tauXY: v.torsionalShear }), 'stress-core von Mises of {σ,0,τ}');
    near(vm.vonMises, v.vonMisesStress, 'CROSS-LANE: stress-core σ_vm == shaft σ_vm = 229.1288');
  }

  // ── LIMITING CASE 1 — PURE BENDING (T=0): σ = Sy/n, d³ = 32nM/πSy ──────────
  {
    const v = ok(shaftDiameter({ bendingMoment: 300000, torque: 0, yield: 500, safetyFactor: 2 }), 'shaftDiameter pure bending');
    near(v.torsionalShear, 0, 'T=0 → τ = 0');
    near(v.bendingStress, 250, 'pure bending σ = 32M/πd³ = Sy/n = 250 MPa');
    near(v.vonMisesStress, 250, 'pure bending σ_vm = σ = Sy/n = 250');
    near(v.diameterMSST, v.diameterDE, 'T=0 → MSST diameter EQUALS DE diameter (equality case)');
    near(v.equivalentMoment, 300000, 'T=0 → Me = M = 300000');
    // d³ must equal 32nM/(πSy) exactly (the pure-bending sizing rule).
    near(v.recommendedDiameter ** 3, (32 * 2 * 300000) / (Math.PI * 500), 'd³ = 32nM/πSy (pure-bending rule)');
    // COMPOSE with the section lane: σ = M/S using sectionCircle's section modulus.
    const sc = sectionCircle(v.recommendedDiameter);
    assert(sc.ok, 'sectionCircle ok');
    if (sc.ok && sc.extra) {
      const S = sc.extra.S_mm3;
      near(300000 / S, v.bendingStress, 'CROSS-LANE: M/S from sectionCircle == bending stress = 250');
    }
  }

  // ── LIMITING CASE 2 — PURE TORSION (M=0): τ = Sy/(2n), d³ = 32nT/πSy ───────
  // This must reproduce the existing shaft_torsion lane exactly.
  {
    const v = ok(shaftDiameter({ bendingMoment: 0, torque: 400000, yield: 500, safetyFactor: 2 }), 'shaftDiameter pure torsion');
    near(v.bendingStress, 0, 'M=0 → σ = 0');
    near(v.torsionalShear, 125, 'pure torsion τ = 16T/πd³ = Sy/(2n) = 125 MPa');
    near(v.maxShearStress, 125, 'pure torsion τ_max = τ = 125');
    near(v.equivalentMoment, 400000, 'M=0 → Me = T = 400000');
    near(v.recommendedDiameter ** 3, (32 * 2 * 400000) / (Math.PI * 500), 'd³ = 32nT/πSy (pure-torsion rule)');
    assert(v.diameterDE < v.diameterMSST, 'M=0: DE still smaller (√¾·T < T)');
    near(v.realizedSafetyFactorDE, 2 * 400000 / Math.sqrt(0.75 * 400000 ** 2), 'pure torsion nDE = n·Me/deG = 2.3094');
    // COMPOSE with the shaft_torsion lane: feed the MSST diameter back and recover Sy/(2n).
    const st = shaftTorsion({ torque: 400000, diameter: v.recommendedDiameter });
    assert(st.ok, 'shaftTorsion ok');
    if (st.ok && st.extra) {
      near(st.extra.max_shear_stress_MPa, 125, 'CROSS-LANE: shaftTorsion(τ) at MSST diameter == Sy/(2n) = 125');
    }
  }

  // ── material lookup path == explicit yield ─────────────────────────────────
  {
    const byMat = ok(shaftDiameter({ bendingMoment: 200000, torque: 150000, material: 'steel', safetyFactor: 2 }), 'shaftDiameter material=steel');
    const byYield = ok(shaftDiameter({ bendingMoment: 200000, torque: 150000, yield: 250, safetyFactor: 2 }), 'shaftDiameter yield=250');
    near(byMat.recommendedDiameter, byYield.recommendedDiameter, 'material "steel" (Sy=250) == explicit yield 250');
    near(byMat.yieldStrength, 250, 'steel yield echoed = 250');
  }

  // ── STATIC monotonicity ────────────────────────────────────────────────────
  {
    const base = ok(shaftDiameter({ bendingMoment: 200000, torque: 150000, yield: 400, safetyFactor: 2 }), 'static base');
    const moreM = ok(shaftDiameter({ bendingMoment: 300000, torque: 150000, yield: 400, safetyFactor: 2 }), 'static +M');
    const moreT = ok(shaftDiameter({ bendingMoment: 200000, torque: 250000, yield: 400, safetyFactor: 2 }), 'static +T');
    const moreN = ok(shaftDiameter({ bendingMoment: 200000, torque: 150000, yield: 400, safetyFactor: 3 }), 'static +n');
    const moreSy = ok(shaftDiameter({ bendingMoment: 200000, torque: 150000, yield: 600, safetyFactor: 2 }), 'static +Sy');
    assert(moreM.recommendedDiameter > base.recommendedDiameter, 'bigger M → bigger d');
    assert(moreT.recommendedDiameter > base.recommendedDiameter, 'bigger T → bigger d');
    assert(moreN.recommendedDiameter > base.recommendedDiameter, 'bigger n → bigger d');
    assert(moreSy.recommendedDiameter < base.recommendedDiameter, 'bigger Sy → smaller d');
    // d scales as n^(1/3): tripling n multiplies d by 3^(1/3).
    near(moreN.recommendedDiameter / base.recommendedDiameter, Math.cbrt(3 / 2), 'd ∝ n^(1/3): n 2→3 scales d by (3/2)^(1/3)');
  }

  // ── FATIGUE clean SI design case: Ma=100k, Tm=50k, Se=200, Sut=500, n=2 ────
  // A=2·Ma=200000, B=√3·Tm=86602.54, factor=1000+173.205=1173.205,
  // d=((16·2/π)·1173.205)^(1/3)=22.8626 mm, realized n = 2 by construction.
  {
    const v = ok(shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 200, ultimate: 500, safetyFactor: 2 }), 'shaftFatigue SI design');
    near(v.alternatingTerm, 200000, 'alternating root A = 2·Kf·Ma = 200000 (Ta=0)');
    near(v.meanTerm, Math.sqrt(3) * 50000, 'mean root B = √3·Kfs·Tm = 86602.54 (Mm=0)');
    near(v.requiredDiameter, 22.8626, 'required d = 22.8626 mm (Shigley 7-8)');
    near(v.realizedSafetyFactor, 2, 'realized n at required d == target n = 2 (design/check inverse)');
    assert(v.checkedDiameter === null, 'no diameter supplied → checkedDiameter null');
    assert(v.Kf === 1 && v.Kfs === 1, 'Kf, Kfs default to 1');
  }

  // ── FATIGUE pinned to SHIGLEY Example 7-1 (US units; n is unit-invariant) ──
  // d=1.10 in, Ma=1260, Tm=1100 lbf·in, Se=31100, Sut=105000 psi, Kf=1.68, Kfs=1.42.
  {
    // check mode: realized n at d=1.10 → 1.6143 (textbook DE-Goodman ≈ 1.62).
    const chk = ok(shaftFatigue({
      alternatingMoment: 1260, meanTorque: 1100, endurance: 31100, ultimate: 105000,
      Kf: 1.68, Kfs: 1.42, diameter: 1.1,
    }), 'shaftFatigue Shigley Ex7-1 check');
    near(chk.realizedSafetyFactor, 1.6143, 'Shigley Ex 7-1: n = 1.614 at d=1.10 in (DE-Goodman)');
    near(chk.checkedDiameter!, 1.1, 'checkedDiameter echoed = 1.10 in');
    near(chk.alternatingTerm, 2 * 1.68 * 1260, 'A = 2·Kf·Ma = 4233.6');
    near(chk.meanTerm, Math.sqrt(3) * 1.42 * 1100, 'B = √3·Kfs·Tm = 2705.46');
    // design mode: target n=1.6143 must return d≈1.100 in (the inverse pins both ways).
    const des = ok(shaftFatigue({
      alternatingMoment: 1260, meanTorque: 1100, endurance: 31100, ultimate: 105000,
      Kf: 1.68, Kfs: 1.42, safetyFactor: 1.6143,
    }), 'shaftFatigue Shigley Ex7-1 design');
    near(des.requiredDiameter, 1.1, 'Shigley design: n=1.6143 → d = 1.100 in');
  }

  // ── FATIGUE coefficient discriminator: the 4 and 3 are load-bearing ────────
  // A correct Ta=0 root is 2·Kf·Ma; a wrong √3·Kf·Ma (3-under-bending) would shift
  // the Shigley answer to ~1.77. We assert the correct root, not the wrong one.
  {
    const v = ok(shaftFatigue({ alternatingMoment: 1260, meanTorque: 1100, endurance: 31100, ultimate: 105000, Kf: 1.68, Kfs: 1.42, diameter: 1.1 }), 'coeff check');
    const wrongA = Math.sqrt(3) * 1.68 * 1260; // if the bending root used 3 instead of 4
    assert(Math.abs(v.alternatingTerm - wrongA) > 1, 'bending root uses coefficient 4 (2·Kf·Ma), NOT 3');
    near(v.alternatingTerm, 2 * 1.68 * 1260, 'confirmed bending root = 2·Kf·Ma');
  }

  // ── FATIGUE monotonicity ───────────────────────────────────────────────────
  {
    const base = ok(shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 200, ultimate: 500 }), 'fatigue base');
    const moreMa = ok(shaftFatigue({ alternatingMoment: 150000, meanTorque: 50000, endurance: 200, ultimate: 500 }), 'fatigue +Ma');
    const moreTm = ok(shaftFatigue({ alternatingMoment: 100000, meanTorque: 90000, endurance: 200, ultimate: 500 }), 'fatigue +Tm');
    const moreN = ok(shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 200, ultimate: 500, safetyFactor: 3 }), 'fatigue +n');
    const moreSe = ok(shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 260, ultimate: 500 }), 'fatigue +Se');
    const moreSut = ok(shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 200, ultimate: 700 }), 'fatigue +Sut');
    const moreKf = ok(shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 200, ultimate: 500, Kf: 1.5 }), 'fatigue +Kf');
    assert(moreMa.requiredDiameter > base.requiredDiameter, 'bigger Ma → bigger d');
    assert(moreTm.requiredDiameter > base.requiredDiameter, 'bigger Tm → bigger d');
    assert(moreN.requiredDiameter > base.requiredDiameter, 'bigger n → bigger d');
    assert(moreSe.requiredDiameter < base.requiredDiameter, 'bigger Se → smaller d');
    assert(moreSut.requiredDiameter < base.requiredDiameter, 'bigger Sut → smaller d');
    assert(moreKf.requiredDiameter > base.requiredDiameter, 'bigger Kf (stress raiser) → bigger d');
    near(moreN.requiredDiameter / base.requiredDiameter, Math.cbrt(3 / 2), 'fatigue d ∝ n^(1/3)');
  }

  // ── Ta/Mm general form reduces to the rotating-shaft roots ─────────────────
  {
    // With Ta=0, Mm=0 the general roots collapse to 2·Kf·Ma and √3·Kfs·Tm.
    const rot = ok(shaftFatigue({ alternatingMoment: 80000, meanTorque: 60000, endurance: 200, ultimate: 500 }), 'rotating default');
    near(rot.alternatingTerm, 2 * 80000, 'rotating: A = 2·Ma (Ta=0)');
    near(rot.meanTerm, Math.sqrt(3) * 60000, 'rotating: B = √3·Tm (Mm=0)');
    // Adding a mean moment Mm and alternating torque Ta grows both roots.
    const gen = ok(shaftFatigue({ alternatingMoment: 80000, meanTorque: 60000, endurance: 200, ultimate: 500, alternatingTorque: 20000, meanMoment: 30000 }), 'general form');
    near(gen.alternatingTerm, Math.sqrt(4 * 80000 ** 2 + 3 * 20000 ** 2), 'general A = √[4Ma²+3Ta²]');
    near(gen.meanTerm, Math.sqrt(4 * 30000 ** 2 + 3 * 60000 ** 2), 'general B = √[4Mm²+3Tm²]');
    assert(gen.requiredDiameter > rot.requiredDiameter, 'adding Ta and Mm → bigger required d');
  }

  // ── Validation / fail-closed ───────────────────────────────────────────────
  {
    assert(!shaftDiameter({ bendingMoment: 0, torque: 0, yield: 250, safetyFactor: 2 }).ok, 'reject M=0 and T=0 together');
    assert(!shaftDiameter({ bendingMoment: -1, torque: 100, yield: 250, safetyFactor: 2 }).ok, 'reject negative moment');
    assert(!shaftDiameter({ bendingMoment: 100, torque: NaN as any, yield: 250, safetyFactor: 2 }).ok, 'reject non-finite torque');
    assert(!shaftDiameter({ bendingMoment: 100, torque: 100, safetyFactor: 2 }).ok, 'reject missing yield/material');
    assert(!shaftDiameter({ bendingMoment: 100, torque: 100, material: 'unobtanium', safetyFactor: 2 }).ok, 'reject unknown material');
    assert(!shaftDiameter({ bendingMoment: 100, torque: 100, yield: 250, safetyFactor: 0 }).ok, 'reject non-positive n');
    assert(!shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 0, ultimate: 500 }).ok, 'reject non-positive Se');
    assert(!shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 200, ultimate: -5 }).ok, 'reject non-positive Sut');
    assert(!shaftFatigue({ alternatingMoment: 0, meanTorque: 0, endurance: 200, ultimate: 500 }).ok, 'reject all-zero loads');
    assert(!shaftFatigue({ alternatingMoment: 100000, meanTorque: 50000, endurance: 200, ultimate: 500, Kf: 0 }).ok, 'reject non-positive Kf');
    assert(!equivalentLoads({ bendingMoment: -1, torque: 100 }).ok, 'equivalentLoads rejects negative moment');
    // Accept the limiting inputs (T=0 and M=0 are valid, not errors).
    assert(shaftDiameter({ bendingMoment: 100000, torque: 0, yield: 250, safetyFactor: 2 }).ok, 'accept T=0 (pure bending)');
    assert(shaftDiameter({ bendingMoment: 0, torque: 100000, yield: 250, safetyFactor: 2 }).ok, 'accept M=0 (pure torsion)');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-shaft-design-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-shaft-design-core smoke cases passed');
}

main();
