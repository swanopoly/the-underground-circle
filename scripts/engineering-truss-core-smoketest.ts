/**
 * engineering-truss-core smoke.
 *
 * A determinate truss is a linear system, and the method of joints solves it. So
 * — exactly like the four-bar position solver, which is trusted only once its
 * loop-closure residual is shown to be ~0 — this solver is proven by its OWN
 * CONSTRAINT: for the solved member forces we recompute ΣFx and ΣFy at EVERY
 * joint (member pulls + reactions + applied load) and require each to be ~0 to
 * machine precision. No answer key is needed; the equilibrium the solve enforced
 * must actually hold, joint by joint. On top of that self-check we pin two
 * TEXTBOOK trusses (each hand-worked in the comments) so the sign convention and
 * the assembly are cross-checked, verify a couple of zero-force members, confirm
 * whole-truss (global) equilibrium, and prove the determinacy/stability guards.
 */

import {
  solveTruss, solveLinearSystem, jointResiduals, globalEquilibrium,
  type TrussSolution, type TrussJoint, type TrussLoad,
} from '../src/lib/engineeringTrussCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(actual: number, expected: number, label: string, tol = 1e-3) {
  const okv = Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
  assert(okv, `${label} (got ${actual}, expected ≈ ${expected})`);
}
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

/** Signed axial force of the member joining a and b (order-independent). */
function mf(sol: TrussSolution, a: string, b: string): number {
  const m = sol.members.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
  if (!m) { failures.push(`member ${a}-${b} not found`); console.error(`FAIL: member ${a}-${b} not found`); process.exit(1); }
  return m.force;
}
function reaction(sol: TrussSolution, joint: string) {
  const r = sol.reactions.find((x) => x.joint === joint);
  if (!r) { failures.push(`reaction at ${joint} not found`); console.error(`FAIL: reaction at ${joint} not found`); process.exit(1); }
  return r;
}

/** THE SELF-CHECK. Recompute per-joint equilibrium independently of the solve,
 *  confirm the solver's own reported residual, and confirm global balance. */
function proveEquilibrium(sol: TrussSolution, joints: TrussJoint[], loads: TrussLoad[], tag: string) {
  // (a) the solver's own residual, to machine precision.
  assert(sol.maxResidual < 1e-9, `${tag}: solver max joint residual ${sol.maxResidual} < 1e-9`);
  // (b) recomputed independently from the solved forces — the true self-check.
  const loadsN = loads.map((l) => ({ joint: l.joint, fx: l.fx ?? 0, fy: l.fy ?? 0 }));
  const res = jointResiduals({
    joints,
    memberForces: sol.members.map((m) => ({ from: m.from, to: m.to, force: m.force })),
    reactions: sol.reactions.map((r) => ({ joint: r.joint, fx: r.fx, fy: r.fy })),
    loads: loadsN,
  });
  for (const jr of res) {
    assert(Math.abs(jr.sumFx) < 1e-9, `${tag}: ΣFx≈0 at joint ${jr.joint} (${jr.sumFx})`);
    assert(Math.abs(jr.sumFy) < 1e-9, `${tag}: ΣFy≈0 at joint ${jr.joint} (${jr.sumFy})`);
  }
  // (c) whole-truss external balance: reactions cancel loads in force and moment.
  const byName = new Map(joints.map((j) => [j.name, j]));
  const g = globalEquilibrium({
    reactions: sol.reactions.map((r) => ({ joint: r.joint, fx: r.fx, fy: r.fy })),
    loads: loadsN,
    jointAt: (n) => byName.get(n),
  });
  assert(Math.abs(g.sumFx) < 1e-9, `${tag}: global ΣFx≈0 (${g.sumFx})`);
  assert(Math.abs(g.sumFy) < 1e-9, `${tag}: global ΣFy≈0 (${g.sumFy})`);
  assert(Math.abs(g.sumMoment) < 1e-9, `${tag}: global ΣM≈0 (${g.sumMoment})`);
}

function main() {
  // ─── The linear solver itself ────────────────────────────────────
  {
    // 2x1 + y = 3 ; x + 3y = 5  →  x = 0.8, y = 1.4 (hand-solved).
    const x = solveLinearSystem([[2, 1], [1, 3]], [3, 5]);
    assert(x !== null, 'solveLinearSystem returns a solution');
    near(x![0], 0.8, 'Gaussian solve x = 0.8');
    near(x![1], 1.4, 'Gaussian solve y = 1.4');
    // partial pivoting handles a zero leading pivot: swap y=1, x from 2nd row.
    const y = solveLinearSystem([[0, 2], [1, 1]], [4, 3]);
    near(y![1], 2, 'pivoting: second unknown = 2');
    near(y![0], 1, 'pivoting: first unknown = 1');
    // a singular matrix is rejected (returns null).
    assert(solveLinearSystem([[1, 2], [2, 4]], [1, 2]) === null, 'singular matrix → null');
  }

  // ─── T1. Right-triangle truss, horizontal load at the apex ────────
  // A(0,0) pin, B(4,0) roller (vertical reaction), C(0,3) directly above A.
  // Members AB(len 4), AC(len 3), BC(len 5 — a 3-4-5 triangle). A 900 N load
  // pushes C in +x. Hand solve:
  //   ΣM_A: By·4 − 900·3 = 0 → By = 675 ;  ΣFy: Ay = −675 ;  ΣFx: Ax = −900.
  //   Joint C: N_BC·0.8 + 900 = 0 → BC = −1125 (compression);
  //            −N_AC − 0.6·(−1125) = 0 → AC = +675 (tension).
  //   Joint B: −N_AB + 0.8·1125 = 0 → AB = +900 (tension).
  {
    const joints: TrussJoint[] = [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 4, y: 0 }, { name: 'C', x: 0, y: 3 }];
    const loads: TrussLoad[] = [{ joint: 'C', fx: 900 }];
    const sol = ok(solveTruss({
      joints,
      members: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'C' }],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'roller' }],
      loads,
    }), 'T1 solve');
    near(mf(sol, 'A', 'B'), 900, 'T1 AB = +900 (tension)');
    near(mf(sol, 'A', 'C'), 675, 'T1 AC = +675 (tension)');
    near(mf(sol, 'B', 'C'), -1125, 'T1 BC = −1125 (compression)');
    assert(sol.members.find((m) => m.from === 'B' && m.to === 'C')!.type === 'compression', 'T1 BC labelled compression');
    assert(sol.members.find((m) => m.from === 'A' && m.to === 'B')!.type === 'tension', 'T1 AB labelled tension');
    const A = reaction(sol, 'A'); near(A.fx, -900, 'T1 Ax = −900'); near(A.fy, -675, 'T1 Ay = −675');
    const B = reaction(sol, 'B'); near(B.fy, 675, 'T1 By = +675'); near(B.fx, 0, 'T1 Bx = 0 (vertical roller)', 1e-6);
    near(sol.maxForce, 1125, 'T1 max member force = 1125');
    proveEquilibrium(sol, joints, loads, 'T1');
  }

  // ─── T2. King-post truss — the classic zero-force member ──────────
  // A(0,0) pin, B(8,0) roller, D(4,0) mid-bottom, C(4,3) apex.
  // Members AD, DB (split bottom chord), AC, CB (rafters), CD (king post).
  // 1200 N down at C. By symmetry Ay = By = 600, Ax = 0.
  //   Joint D: only the vertical CD has a y-component and D is unloaded → CD = 0.
  //   Joint C: −1.2·N_CA − 1200 = 0 → AC = CB = −1000 (compression).
  //   Joint A: N_AD − 0.8·1000 = 0 → AD = DB = +800 (tension).
  {
    const joints: TrussJoint[] = [
      { name: 'A', x: 0, y: 0 }, { name: 'B', x: 8, y: 0 },
      { name: 'D', x: 4, y: 0 }, { name: 'C', x: 4, y: 3 },
    ];
    const loads: TrussLoad[] = [{ joint: 'C', fy: -1200 }];
    const sol = ok(solveTruss({
      joints,
      members: [
        { from: 'A', to: 'D' }, { from: 'D', to: 'B' },
        { from: 'A', to: 'C' }, { from: 'C', to: 'B' }, { from: 'C', to: 'D' },
      ],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'roller' }],
      loads,
    }), 'T2 solve');
    near(mf(sol, 'A', 'D'), 800, 'T2 AD = +800 (tension)');
    near(mf(sol, 'D', 'B'), 800, 'T2 DB = +800 (tension)');
    near(mf(sol, 'A', 'C'), -1000, 'T2 AC = −1000 (compression)');
    near(mf(sol, 'C', 'B'), -1000, 'T2 CB = −1000 (compression)');
    near(mf(sol, 'C', 'D'), 0, 'T2 CD ≈ 0 (king post)', 1e-6);
    assert(sol.members.find((m) => (m.from === 'C' && m.to === 'D'))!.type === 'zero', 'T2 CD labelled zero-force');
    assert(sol.zeroForceMembers.includes('C-D'), 'T2 zero-force list contains C-D');
    near(reaction(sol, 'A').fy, 600, 'T2 Ay = 600');
    near(reaction(sol, 'A').fx, 0, 'T2 Ax = 0', 1e-6);
    near(reaction(sol, 'B').fy, 600, 'T2 By = 600');
    proveEquilibrium(sol, joints, loads, 'T2');
  }

  // ─── T3. A 7-member Warren truss — proven WITHOUT a full answer key ─
  // Bottom chord A(0,0), C(4,0), E(8,0); top B(2,2), D(6,2). Pin A, roller E.
  // 2000 N down at C. Symmetry gives Ay = Ey = 1000, Ax = 0. A couple of members
  // are hand-checked (Joint A: AB = −1000√2 comp, AC = +1000 tension; the top
  // chord BD = −2000 comp), but the POINT is the residual: 10 joint equations
  // must all close with no memorised answer for the other members.
  {
    const joints: TrussJoint[] = [
      { name: 'A', x: 0, y: 0 }, { name: 'B', x: 2, y: 2 }, { name: 'C', x: 4, y: 0 },
      { name: 'D', x: 6, y: 2 }, { name: 'E', x: 8, y: 0 },
    ];
    const loads: TrussLoad[] = [{ joint: 'C', fy: -2000 }];
    const sol = ok(solveTruss({
      joints,
      members: [
        { from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'C' },
        { from: 'B', to: 'D' }, { from: 'C', to: 'D' }, { from: 'C', to: 'E' }, { from: 'D', to: 'E' },
      ],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'E', type: 'roller' }],
      loads,
    }), 'T3 solve');
    near(reaction(sol, 'A').fy, 1000, 'T3 Ay = 1000');
    near(reaction(sol, 'A').fx, 0, 'T3 Ax = 0', 1e-6);
    near(reaction(sol, 'E').fy, 1000, 'T3 Ey = 1000');
    near(mf(sol, 'A', 'C'), 1000, 'T3 AC = +1000 (bottom chord tension)');
    near(mf(sol, 'C', 'E'), 1000, 'T3 CE = +1000 (symmetry)');
    near(mf(sol, 'A', 'B'), -1000 * Math.SQRT2, 'T3 AB = −1000√2 (end diagonal compression)');
    near(mf(sol, 'B', 'D'), -2000, 'T3 BD = −2000 (top chord compression)');
    near(sol.maxForce, 2000, 'T3 max member force = 2000 (BD)');
    proveEquilibrium(sol, joints, loads, 'T3');
  }

  // ─── T4. Roller on a 30° incline (reaction line at 60° from +x) ────
  // A(0,0) pin, B(4,0) roller whose reaction acts along 60°, C(2,3). 1000 N down
  // at C. ΣM_A: R·(4·sin60°) = 2000 → R = 2000/(4·sin60°) = 577.35; then the
  // reaction components must lie along 60° (fx/fy = cot60°). Residual proves the
  // members; the point is that an inclined roller direction is honoured.
  {
    const joints: TrussJoint[] = [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 4, y: 0 }, { name: 'C', x: 2, y: 3 }];
    const loads: TrussLoad[] = [{ joint: 'C', fy: -1000 }];
    const sol = ok(solveTruss({
      joints,
      members: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'roller', angle: 60 }],
      loads,
    }), 'T4 solve');
    const B = reaction(sol, 'B');
    near(B.scalar!, 2000 / (4 * Math.sin(60 * Math.PI / 180)), 'T4 roller reaction scalar = 577.35');
    near(B.fx / B.fy, Math.cos(60 * Math.PI / 180) / Math.sin(60 * Math.PI / 180), 'T4 reaction lies along the 60° incline normal');
    near(B.fy, 500, 'T4 roller fy = R·sin60° = 500');
    proveEquilibrium(sol, joints, loads, 'T4');
  }

  // ─── Zero-force members (Rule 1): two non-collinear members at an ──
  // unloaded, unsupported joint carry nothing. Square A,B,C,D + diagonal AC.
  // Joint D has only DC (horizontal) and DA (vertical) and no load → both zero.
  {
    const joints: TrussJoint[] = [
      { name: 'A', x: 0, y: 0 }, { name: 'B', x: 4, y: 0 },
      { name: 'C', x: 4, y: 3 }, { name: 'D', x: 0, y: 3 },
    ];
    const loads: TrussLoad[] = [{ joint: 'C', fx: 800, fy: -1000 }];
    const sol = ok(solveTruss({
      joints,
      members: [
        { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' },
        { from: 'D', to: 'A' }, { from: 'A', to: 'C' },
      ],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'roller' }],
      loads,
    }), 'ZF solve');
    near(mf(sol, 'C', 'D'), 0, 'ZF CD ≈ 0', 1e-6);
    near(mf(sol, 'D', 'A'), 0, 'ZF DA ≈ 0', 1e-6);
    assert(sol.zeroForceMembers.includes('C-D') && sol.zeroForceMembers.includes('D-A'), 'ZF detects both D-members as zero-force');
    proveEquilibrium(sol, joints, loads, 'ZF');
  }

  // ─── Determinacy & stability guards ──────────────────────────────
  {
    const square: TrussJoint[] = [
      { name: 'A', x: 0, y: 0 }, { name: 'B', x: 4, y: 0 },
      { name: 'C', x: 4, y: 4 }, { name: 'D', x: 0, y: 4 },
    ];
    // MECHANISM: an unbraced square (4 members) — m + r = 4 + 3 = 7 < 8 = 2j.
    const mech = solveTruss({
      joints: square,
      members: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' }],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'roller' }],
      loads: [{ joint: 'C', fy: -1000 }],
    });
    assert(!mech.ok && /mechanism/.test(mech.ok ? '' : mech.error), 'unbraced square → unstable mechanism error');
    // INDETERMINATE: both diagonals → m + r = 6 + 3 = 9 > 8 = 2j.
    const indet = solveTruss({
      joints: square,
      members: [
        { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' },
        { from: 'A', to: 'C' }, { from: 'B', to: 'D' },
      ],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'roller' }],
      loads: [{ joint: 'C', fy: -1000 }],
    });
    assert(!indet.ok && /indeterminate/.test(indet.ok ? '' : indet.error), 'doubly-braced square → statically indeterminate error');
    // GEOMETRIC INSTABILITY: count is right (m+r=2j) but the middle joint C is
    // held only horizontally (all members collinear) → singular matrix.
    const singular = solveTruss({
      joints: [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 4, y: 0 }, { name: 'C', x: 2, y: 0 }],
      members: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'C', to: 'B' }],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'roller' }],
      loads: [{ joint: 'C', fy: -100 }],
    });
    assert(!singular.ok && /unstable|singular/.test(singular.ok ? '' : singular.error), 'collinear joint (count-OK) → geometrically unstable');
  }

  // ─── Input validation ────────────────────────────────────────────
  {
    const j2: TrussJoint[] = [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 4, y: 0 }, { name: 'C', x: 2, y: 3 }];
    const sup = [{ joint: 'A', type: 'pin' as const }, { joint: 'B', type: 'roller' as const }];
    assert(!solveTruss({ joints: [{ name: 'A', x: 0, y: 0 }], members: [], supports: [] }).ok, 'single joint rejected');
    assert(!solveTruss({ joints: j2, members: [{ from: 'A', to: 'Z' }], supports: sup }).ok, 'member to unknown joint rejected');
    assert(!solveTruss({ joints: j2, members: [{ from: 'A', to: 'A' }], supports: sup }).ok, 'self-loop member rejected');
    assert(!solveTruss({
      joints: [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 0, y: 0 }, { name: 'C', x: 2, y: 3 }],
      members: [{ from: 'A', to: 'B' }], supports: sup,
    }).ok, 'zero-length member (coincident joints) rejected');
    assert(!solveTruss({
      joints: [{ name: 'A', x: 0, y: 0 }, { name: 'A', x: 4, y: 0 }, { name: 'C', x: 2, y: 3 }],
      members: [{ from: 'A', to: 'C' }], supports: [{ joint: 'A', type: 'pin' }],
    }).ok, 'duplicate joint name rejected');
    assert(!solveTruss({
      joints: j2, members: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }, { from: 'A', to: 'C' }], supports: sup,
    }).ok, 'duplicate member pair rejected');
    assert(!solveTruss({
      joints: j2, members: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'A', type: 'roller' }],
    }).ok, 'two supports on one joint rejected');
    assert(!solveTruss({
      joints: j2, members: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
      supports: sup, loads: [{ joint: 'Z', fy: -1 }],
    }).ok, 'load on unknown joint rejected');
    assert(!solveTruss({
      joints: j2, members: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
      supports: [{ joint: 'A', type: 'pin' }, { joint: 'B', type: 'wedge' as any }],
    }).ok, 'unknown support type rejected');
    assert(!solveTruss({
      joints: j2, members: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
      supports: sup, loads: [{ joint: 'C', fy: Number.NaN }],
    }).ok, 'non-finite load rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-truss-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-truss-core smoke cases passed.');
}

main();
