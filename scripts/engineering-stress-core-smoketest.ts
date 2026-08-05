/**
 * engineering-stress-core smoke.
 *
 * Combined/principal stress is pinned against HAND-COMPUTED Mohr's-circle values:
 * the state σx=80, σy=20, τxy=30 MPa has centre 50, radius √1800 = 42.426, so
 * σ1 = 92.426, σ2 = 7.574, τmax(in-plane) = 42.426, θp = 22.5°. Its von Mises is
 * √(6400−1600+400+2700) = √7900 = 88.882 — and the SAME 88.882 must come back out
 * of the principal-stress form √(σ1²−σ1σ2+σ2²), a real independent cross-check of
 * two algebraically-identical formulas computed by different code paths. Because
 * both σ1 and σ2 are tensile the ABSOLUTE max shear (over {σ1,σ2,0}) is 46.213,
 * larger than the in-plane 42.426 — the out-of-plane σ3=0 governs. Stresses are
 * SIGNED: a fully-compressive state (−40,−100,0) is valid and shows the same 3D
 * effect from the other side. The smoke IS the proof.
 */

import { principalStresses, vonMises, maxShearStress } from '../src/lib/engineeringStressCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Principal stresses: the canonical Mohr's-circle case ────────
  {
    const p = ok(principalStresses({ sigmaX: 80, sigmaY: 20, tauXY: 30 }), 'principal(80,20,30)');
    near(p.center, 50, 'centre = (σx+σy)/2 = 50');
    near(p.radius, Math.sqrt(1800), 'radius R = √(30²+30²) = √1800 = 42.426');
    near(p.sigma1, 92.426, 'σ1 = centre + R = 92.426');
    near(p.sigma2, 7.574, 'σ2 = centre − R = 7.574');
    near(p.tauMaxInPlane, 42.426, 'τmax(in-plane) = R = 42.426');
    near(p.principalAngleDeg, 22.5, 'θp = ½·atan2(60,60) = 22.5°');
    near(p.sigma1 + p.sigma2, 80 + 20, 'invariant: σ1+σ2 = σx+σy = 100');
  }

  // ─── Pure shear: circle centred at the origin ────────────────────
  {
    const p = ok(principalStresses({ sigmaX: 0, sigmaY: 0, tauXY: 50 }), 'pure shear(0,0,50)');
    near(p.center, 0, 'pure shear centre = 0');
    near(p.sigma1, 50, 'pure shear σ1 = +τ = 50');
    near(p.sigma2, -50, 'pure shear σ2 = −τ = −50');
    near(p.tauMaxInPlane, 50, 'pure shear τmax = τ = 50');
    near(p.principalAngleDeg, 45, 'pure shear θp = 45°');
  }

  // ─── Uniaxial tension: σ2 collapses to zero ──────────────────────
  {
    const p = ok(principalStresses({ sigmaX: 100, sigmaY: 0, tauXY: 0 }), 'uniaxial(100,0,0)');
    near(p.sigma1, 100, 'uniaxial σ1 = 100');
    near(p.sigma2, 0, 'uniaxial σ2 = 0');
    near(p.principalAngleDeg, 0, 'uniaxial θp = 0° (already principal)');
    near(p.tauMaxInPlane, 50, 'uniaxial τmax = σ/2 = 50');
  }

  // ─── Signed inputs: a fully-compressive biaxial state ────────────
  {
    const p = ok(principalStresses({ sigmaX: -40, sigmaY: -100, tauXY: 0 }), 'compressive(−40,−100,0)');
    near(p.sigma1, -40, 'compressive σ1 = −40 (least negative)');
    near(p.sigma2, -100, 'compressive σ2 = −100 (most negative)');
    near(p.center, -70, 'compressive centre = −70');
  }

  // ─── von Mises component form + the two-ways cross-check ─────────
  {
    const vc = ok(vonMises({ sigmaX: 80, sigmaY: 20, tauXY: 30 }), 'vonMises components');
    assert(vc.method === 'components', 'vonMises method = components');
    near(vc.vonMises, Math.sqrt(7900), 'σ_vm = √(6400−1600+400+2700) = √7900 = 88.882');
    near(vc.vonMises, 88.882, 'σ_vm hand value = 88.882');

    // Independent path: principalStresses → principal-form von Mises must AGREE.
    const p = ok(principalStresses({ sigmaX: 80, sigmaY: 20, tauXY: 30 }), 'principal for cross-check');
    const vp = ok(vonMises({ sigma1: p.sigma1, sigma2: p.sigma2 }), 'vonMises principals');
    assert(vp.method === 'principal', 'vonMises method = principal');
    near(vp.vonMises, vc.vonMises, 'CROSS-CHECK: √(σ1²−σ1σ2+σ2²) == component σ_vm');
    near(vp.vonMises, 88.882, 'principal-form σ_vm also = 88.882');

    // Textbook special cases: uniaxial σ_vm = σ; pure shear σ_vm = √3·τ.
    near(ok(vonMises({ sigmaX: 100, sigmaY: 0, tauXY: 0 }), 'vm uniaxial').vonMises, 100, 'uniaxial σ_vm = σ = 100');
    near(ok(vonMises({ sigmaX: 0, sigmaY: 0, tauXY: 50 }), 'vm pure shear').vonMises, Math.sqrt(3) * 50, 'pure-shear σ_vm = √3·τ = 86.603');
  }

  // ─── Safety factor from yield / material ─────────────────────────
  {
    const v = ok(vonMises({ sigmaX: 80, sigmaY: 20, tauXY: 30, yield: 250 }), 'vonMises + yield=250');
    assert(v.yieldStrength === 250, 'yieldStrength echoed = 250');
    near(v.safetyFactor!, 2.813, 'safety factor n = 250/88.882 = 2.813');
    const vm = ok(vonMises({ sigmaX: 80, sigmaY: 20, tauXY: 30, material: 'steel' }), 'vonMises + material=steel');
    near(vm.safetyFactor!, 2.813, 'steel (yield 250) → same n = 2.813');
  }

  // ─── Max shear: the 3D out-of-plane effect (both principals +) ───
  {
    // From the principal pair directly (σ1, σ2 both tensile).
    const m = ok(maxShearStress({ sigma1: 92.426, sigma2: 7.574 }), 'maxShear from principals');
    near(m.tauMaxInPlane, 42.426, 'in-plane τmax = (σ1−σ2)/2 = 42.426');
    near(m.tauMaxAbsolute, 46.213, 'absolute τmax = (σ1−0)/2 = 46.213 (σ3=0 governs)');
    assert(m.tauMaxAbsolute > m.tauMaxInPlane, '3D absolute shear EXCEEDS in-plane when σ1,σ2 same sign');
    assert(m.governedByOutOfPlane === true, 'governedByOutOfPlane = true');

    // Same result straight from the component state.
    const mc = ok(maxShearStress({ sigmaX: 80, sigmaY: 20, tauXY: 30 }), 'maxShear from components');
    near(mc.tauMaxAbsolute, 46.213, 'components → absolute τmax = 46.213');
  }

  // ─── Max shear: opposite-sign principals → in-plane governs ──────
  {
    const m = ok(maxShearStress({ sigma1: 50, sigma2: -50 }), 'maxShear pure-shear principals');
    near(m.tauMaxInPlane, 50, 'opposite signs: in-plane τmax = 50');
    near(m.tauMaxAbsolute, 50, 'opposite signs: absolute = in-plane (0 is straddled)');
    assert(m.governedByOutOfPlane === false, 'no out-of-plane governance when signs differ');
  }

  // ─── Max shear: fully-compressive state (3D effect from below) ───
  {
    const m = ok(maxShearStress({ sigmaX: -40, sigmaY: -100, tauXY: 0 }), 'maxShear compressive');
    near(m.tauMaxInPlane, 30, 'compressive in-plane τmax = (−40−(−100))/2 = 30');
    near(m.tauMaxAbsolute, 50, 'compressive absolute τmax = (0−(−100))/2 = 50');
    assert(m.governedByOutOfPlane === true, 'compressive: σ3=0 is the max, so out-of-plane governs');
  }

  // ─── Validation: accept zero, reject non-finite, require inputs ──
  {
    const z = ok(principalStresses({ sigmaX: 0, sigmaY: 0, tauXY: 0 }), 'zero state accepted');
    assert(z.radius === 0 && z.sigma1 === 0 && z.sigma2 === 0, 'zero state → σ1=σ2=R=0');
    assert(!principalStresses({ sigmaX: 80, sigmaY: 20, tauXY: NaN as any }).ok, 'non-finite τxy rejected');
    assert(!vonMises({}).ok, 'vonMises with neither components nor principals rejected');
    assert(!vonMises({ sigmaX: 80, sigmaY: 20, tauXY: 30, yield: -5 }).ok, 'non-positive yield rejected');
    assert(!maxShearStress({ sigma1: Infinity as any, sigma2: 10 }).ok, 'non-finite principal rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-stress-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-stress-core smoke cases passed.');
}

main();
