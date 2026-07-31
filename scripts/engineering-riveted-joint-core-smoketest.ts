/**
 * engineering-riveted-joint-core smoke.
 *
 * The riveted / bolted LAP and BUTT joint — the classic boiler seam — sized per
 * PITCH by three competing failure modes, pinned against the hand-computed
 * Khurmi/Shigley boiler-joint method. The plate can TEAR across its net width
 * σt·(p−d)·t; the rivets can SHEAR across τ·(π/4·d²)·n·planes; the rivet can
 * CRUSH its plate on the projected area σc·d·t·n. The WEAKEST governs, and the
 * joint EFFICIENCY η = weakest / (σt·p·t) is always below 1 because the holes
 * weaken the plate. The anchor is Khurmi Example 9.2 — a double-riveted lap
 * joint, t=15 d=25 p=75, σt=400 τ=320 σc=640: tearing 300 kN governs (< shear
 * 314 kN < crush 480 kN), η = 300/450 = 66.7 %. A double-cover butt joint puts
 * every rivet in DOUBLE shear, doubling Ps. The smoke IS the proof.
 */

import { rivetedJoint, SHEAR_PLANES, QUARTER_PI } from '../src/lib/engineeringRivetJointCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Textbook anchor: Khurmi Ex. 9.2 — double-riveted LAP joint ──────
  // t=15, d=25, p=75, σt=400, τ=320, σc=640, n=2 rivets/pitch, single shear.
  {
    const j = ok(rivetedJoint({
      plateThickness: 15, rivetDiameter: 25, pitch: 75,
      tensileStress: 400, shearStress: 320, crushingStress: 640,
      jointType: 'lap', rivetsPerPitch: 2,
    }), 'Khurmi 9.2 anchor');
    near(j.tearing_N, 300000, 'tearing Pt = σt(p−d)t = 400·50·15 = 300,000 N');
    near(j.shearing_N, 314159.27, 'shearing Ps = τ·(π/4·d²)·n = 320·490.87·2 = 314,159 N', 1e-3);
    near(j.crushing_N, 480000, 'crushing Pc = σc·d·t·n = 640·25·15·2 = 480,000 N');
    assert(j.governingMode === 'tearing', 'weakest of {300k, 314k, 480k} → tearing governs');
    near(j.strength_N, 300000, 'joint strength per pitch = min = 300,000 N (Khurmi answer)');
    near(j.solidPlate_N, 450000, 'solid plate = σt·p·t = 400·75·15 = 450,000 N');
    near(j.efficiency, 2 / 3, 'efficiency η = 300,000/450,000 = 66.67 % (Khurmi answer)');
    assert(j.shearPlanes === 1, 'a lap joint is single shear → 1 plane/rivet');
  }

  // ─── Efficiency definition: η = weakest / solid-plate, always in (0,1) ──
  {
    const cases = [
      rivetedJoint({ t: 10, d: 20, p: 40, sigmaT: 100, tau: 80, sigmaC: 160 }),
      rivetedJoint({ t: 15, d: 25, p: 75, sigmaT: 400, tau: 320, sigmaC: 640, rivetsPerPitch: 2 }),
      rivetedJoint({ t: 6, d: 30, p: 90, sigmaT: 100, tau: 80, sigmaC: 160 }),
      rivetedJoint({ t: 10, d: 18, p: 60, sigmaT: 100, tau: 80, sigmaC: 160, rivetsPerPitch: 2 }),
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const v = ok(cases[i], `η-range case ${i}`);
      assert(v.efficiency > 0 && v.efficiency < 1, `case ${i}: η = ${v.efficiency} is strictly in (0,1) — holes always weaken the plate`);
      near(v.efficiency, v.strength_N / v.solidPlate_N, `case ${i}: η is exactly strength/solidPlate`);
      near(v.strength_N, Math.min(v.tearing_N, v.shearing_N, v.crushing_N), `case ${i}: strength is the least of the three modes`);
    }
  }

  // ─── Governing mode flips: each mode can be the weakest in turn ──────
  {
    // small net width → TEARING governs (Pt 20k < Ps 25.1k < Pc 32k).
    const tear = ok(rivetedJoint({ t: 10, d: 20, p: 40, sigmaT: 100, tau: 80, sigmaC: 160 }), 'tearing-governs');
    assert(tear.governingMode === 'tearing', 'small pitch (p−d=20) → tearing is weakest');
    near(tear.tearing_N, 20000, 'Pt = 100·20·10 = 20,000 N');
    assert(tear.tearing_N < tear.shearing_N && tear.tearing_N < tear.crushing_N, 'Pt is the least of the three');

    // small rivet + low τ → SHEARING governs (Ps 14.1k < Pc 32k < Pt 64k).
    const shear = ok(rivetedJoint({ t: 10, d: 16, p: 80, sigmaT: 100, tau: 70, sigmaC: 200 }), 'shearing-governs');
    assert(shear.governingMode === 'shearing', 'small rivet + low τ → shearing is weakest');
    near(shear.shearing_N, 14074.34, 'Ps = 70·(π/4·16²) = 14,074 N', 1e-3);

    // low σc, thin plate → CRUSHING governs (Pc 28.8k < Pt 36k < Ps 56.5k).
    const crush = ok(rivetedJoint({ t: 6, d: 30, p: 90, sigmaT: 100, tau: 80, sigmaC: 160 }), 'crushing-governs');
    assert(crush.governingMode === 'crushing', 'thin plate + big rivet → crushing is weakest');
    near(crush.crushing_N, 28800, 'Pc = 160·30·6 = 28,800 N');

    // pitch sweep with everything else fixed: Ps and Pc are constant, only Pt
    // grows with p, so the governing mode flips tearing → shearing as p opens up.
    const base = { t: 10, d: 20, sigmaT: 100, tau: 80, sigmaC: 160 } as const;
    const p40 = ok(rivetedJoint({ ...base, p: 40 }), 'sweep p40');
    const p50 = ok(rivetedJoint({ ...base, p: 50 }), 'sweep p50');
    assert(p40.governingMode === 'tearing', 'p=40: net width small → tearing governs');
    assert(p50.governingMode === 'shearing', 'p=50: wider net plate → shearing now governs');
    near(p40.shearing_N, p50.shearing_N, 'Ps is independent of pitch (rivets unchanged)');
    near(p40.crushing_N, p50.crushing_N, 'Pc is independent of pitch (rivets unchanged)');
    assert(p50.tearing_N > p40.tearing_N, 'only tearing grows as the pitch opens up');
  }

  // ─── Balanced joint beats an unbalanced one at the SAME solid plate ──
  {
    // identical solid plate (p=60, t=10, σt=100 → 60,000 N); only the rivet
    // diameter differs. Tiny rivets starve the shear mode (unbalanced, low η);
    // a well-sized rivet brings the three modes together (balanced, high η).
    const unbal = ok(rivetedJoint({ t: 10, d: 10, p: 60, sigmaT: 100, tau: 80, sigmaC: 160, rivetsPerPitch: 2 }), 'unbalanced');
    const bal = ok(rivetedJoint({ t: 10, d: 18, p: 60, sigmaT: 100, tau: 80, sigmaC: 160, rivetsPerPitch: 2 }), 'balanced');
    near(unbal.solidPlate_N, 60000, 'unbalanced solid plate = 60,000 N');
    near(bal.solidPlate_N, 60000, 'balanced solid plate = 60,000 N (identical)');
    near(unbal.efficiency, 0.20944, 'tiny rivets → shear-starved → η ≈ 20.9 %');
    near(bal.efficiency, 0.678584, 'well-sized rivets → modes balanced → η ≈ 67.9 %');
    assert(bal.efficiency > unbal.efficiency, 'balancing the three modes raises efficiency at the same solid plate');
    // the balanced joint really is more even: its three modes span a far
    // narrower band than the unbalanced joint's.
    const spread = (v: { tearing_N: number; shearing_N: number; crushing_N: number }) =>
      Math.max(v.tearing_N, v.shearing_N, v.crushing_N) / Math.min(v.tearing_N, v.shearing_N, v.crushing_N);
    assert(spread(bal) < spread(unbal), 'balanced joint has a tighter tearing/shearing/crushing spread');
  }

  // ─── Shear planes: a double-cover butt joint doubles the rivet shear ──
  {
    // same rivets both ways (t=10, d=20, p=50, τ=70, n=1). A lap joint is
    // single shear and its rivets govern; switch to a double-cover butt and Ps
    // doubles, so the governing mode moves off the rivets onto the plate.
    const lap = ok(rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, tau: 70, sigmaC: 160, jointType: 'lap' }), 'lap joint');
    const dcb = ok(rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, tau: 70, sigmaC: 160, jointType: 'double-cover-butt' }), 'double-cover butt');
    const scb = ok(rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, tau: 70, sigmaC: 160, jointType: 'single-cover-butt' }), 'single-cover butt');
    assert(lap.shearPlanes === 1 && scb.shearPlanes === 1 && dcb.shearPlanes === 2, 'lap & single-cover = 1 plane; double-cover = 2 planes');
    near(dcb.shearing_N, 2 * lap.shearing_N, 'double-cover butt Ps is exactly 2× the lap Ps (same rivets)');
    near(scb.shearing_N, lap.shearing_N, 'single-cover butt shears like a lap (1 plane)');
    near(lap.tearing_N, dcb.tearing_N, 'the plate tears the same either way (cover straps do not change the net section)');
    assert(lap.governingMode === 'shearing', 'lap joint: rivets are the weak link (Ps 21.99k < Pt 30k)');
    assert(dcb.governingMode === 'tearing', 'double-cover butt: doubled shear moves the weak link onto the plate');
    assert(dcb.strength_N > lap.strength_N, 'the double-cover butt is the stronger joint for the same rivets');
    assert(SHEAR_PLANES['double-cover-butt'] === 2 && SHEAR_PLANES['lap'] === 1, 'exported SHEAR_PLANES table matches');
  }

  // ─── More rivets/rows raise Ps and Pc, but tearing (p−d) may then govern ──
  {
    // fixed pitch/rivet/stresses (t=10, d=16, p=60), vary rivets per pitch. Ps
    // and Pc scale with n, but Pt does NOT (only one hole's width is torn per
    // row), so beyond some n the plate becomes the weak link.
    const g = { t: 10, d: 16, p: 60, sigmaT: 100, tau: 80, sigmaC: 160 } as const;
    const n1 = ok(rivetedJoint({ ...g, rivetsPerPitch: 1 }), 'n=1');
    const n2 = ok(rivetedJoint({ ...g, rivetsPerPitch: 2 }), 'n=2');
    const n3 = ok(rivetedJoint({ ...g, rivetsPerPitch: 3 }), 'n=3');
    near(n2.shearing_N, 2 * n1.shearing_N, 'Ps scales linearly with rivets/pitch (2× at n=2)');
    near(n2.crushing_N, 2 * n1.crushing_N, 'Pc scales linearly with rivets/pitch (2× at n=2)');
    near(n1.tearing_N, n2.tearing_N, 'Pt is independent of the rivet count (net plate section is unchanged)');
    near(n1.tearing_N, 44000, 'Pt = 100·(60−16)·10 = 44,000 N');
    assert(n1.governingMode === 'shearing' && n2.governingMode === 'shearing', 'few rivets → the rivets govern');
    assert(n3.governingMode === 'tearing', 'enough rivets → the plate tears first (Pt 44k < Ps 48.25k)');
    assert(n3.strength_N > n1.strength_N, 'adding rivets still raises the overall strength (up to the tearing ceiling)');
    // a butt-joint informational rows field is echoed, and falls back to n.
    const rowsEcho = ok(rivetedJoint({ ...g, rows: 3 }), 'rows echoed');
    assert(rowsEcho.rows === 3 && rowsEcho.rivetsPerPitch === 3, 'rows is echoed and, absent an explicit n, drives the rivet count');
  }

  // ─── Validation: bad / impossible inputs fail closed ────────────────
  {
    assert(!rivetedJoint({ d: 20, p: 50, sigmaT: 100, tau: 80, sigmaC: 160 } as any).ok, 'missing plate thickness rejected');
    assert(!rivetedJoint({ t: 10, p: 50, sigmaT: 100, tau: 80, sigmaC: 160 } as any).ok, 'missing rivet diameter rejected');
    assert(!rivetedJoint({ t: 10, d: 20, sigmaT: 100, tau: 80, sigmaC: 160 } as any).ok, 'missing pitch rejected');
    assert(!rivetedJoint({ t: 10, d: 50, p: 50, sigmaT: 100, tau: 80, sigmaC: 160 }).ok, 'pitch = diameter (no net plate) rejected');
    assert(!rivetedJoint({ t: 10, d: 60, p: 50, sigmaT: 100, tau: 80, sigmaC: 160 }).ok, 'pitch < diameter (overlapping holes) rejected');
    assert(!rivetedJoint({ t: 10, d: 20, p: 50, tau: 80, sigmaC: 160 } as any).ok, 'missing tensile stress rejected');
    assert(!rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, sigmaC: 160 } as any).ok, 'missing shear stress rejected');
    assert(!rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, tau: 80 } as any).ok, 'missing crushing stress rejected');
    assert(!rivetedJoint({ t: -10, d: 20, p: 50, sigmaT: 100, tau: 80, sigmaC: 160 }).ok, 'negative thickness rejected');
    assert(!rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, tau: 80, sigmaC: 160, jointType: 'welded' as any }).ok, 'unknown joint type rejected');
    assert(!rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, tau: 80, sigmaC: 160, rivetsPerPitch: 0 }).ok, 'rivetsPerPitch ≥ 1 enforced');
    assert(!rivetedJoint({ t: 10, d: 20, p: 50, sigmaT: 100, tau: 80, sigmaC: 160, rows: 0 }).ok, 'rows ≥ 1 enforced when supplied');
  }

  // ─── Constant sanity ────────────────────────────────────────────────
  near(QUARTER_PI, Math.PI / 4, 'QUARTER_PI is exactly π/4');

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-riveted-joint-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-riveted-joint-core smoke cases passed.');
}

main();
