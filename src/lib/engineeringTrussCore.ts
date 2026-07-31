/**
 * engineeringTrussCore — 2D PIN-JOINTED TRUSS analysis by the METHOD OF JOINTS,
 * the force-solving partner to the mechanism kinematics core. Given a planar
 * truss — its joint coordinates, its two-force members, its supports and its
 * applied loads — it returns the axial force in every member (signed: + tension,
 * − compression) and every support reaction.
 *
 * DETERMINACY FIRST. A truss is just a linear system. Each of the j joints gives
 * two scalar equilibrium equations (ΣFx = 0, ΣFy = 0), for 2j equations; the
 * unknowns are the m member forces plus the r support-reaction components. The
 * system is square — solvable by statics alone — exactly when m + r = 2j. Fewer
 * unknowns (m + r < 2j) is a MECHANISM that will collapse; more (m + r > 2j) is
 * STATICALLY INDETERMINATE and needs member stiffnesses this solver does not use.
 * So the count is checked up front and only the determinate case is solved.
 *
 * THE SOLVE. Every member is a two-force member: the force it carries acts along
 * its own axis, and by convention TENSION is positive and pulls each end joint
 * toward the member (toward the far end). Writing that contribution — axial force
 * times the unit vector from the joint toward the other end — for every member at
 * every joint, plus the reaction directions and the applied loads, assembles the
 * 2j × 2j system A·x = b. It is solved with a small dense GAUSSIAN ELIMINATION
 * with partial pivoting implemented here (no external solver). Because member
 * directions are unit vectors and reaction directions are unit vectors, the
 * matrix is always O(1)-scaled, so a zero pivot cleanly signals a geometrically
 * unstable (singular) arrangement even when the m + r = 2j count is satisfied.
 *
 * VERIFY BY THE JOINTS THEMSELVES — NO ANSWER KEY. Exactly as the four-bar
 * position solver is trusted only after its loop-closure residual is shown to be
 * ~0, this solver is trusted only after the EQUILIBRIUM RESIDUAL is recomputed at
 * every joint from the solved forces: sum the member pulls, the reactions and the
 * applied load at each joint and it must come to zero, independently, joint by
 * joint. That is the equilibrium the solve was supposed to enforce; if any of the
 * assembly or the elimination were wrong, some joint would not close. The smoke
 * uses that residual as its primary proof and only cross-checks a couple of
 * textbook trusses for the sign convention.
 *
 * Sign convention: member force > 0 = TENSION (pulls its joints together),
 * < 0 = COMPRESSION (pushes them apart), ≈ 0 = a zero-force member. Forces are
 * returned at full double precision (rounding is a display concern) so the
 * equilibrium residual can be checked to machine precision.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-truss-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type TrussResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type TrussJoint = { name: string; x: number; y: number };
export type TrussMember = { from: string; to: string };
/** A support: 'pin' contributes 2 reaction components; 'roller' contributes 1
 *  reaction normal to its rolling surface — its direction is `angle` degrees from
 *  +x (default 90°, i.e. a vertical reaction on a horizontal surface). */
export type TrussSupport = { joint: string; type: 'pin' | 'roller'; angle?: number };
export type TrussLoad = { joint: string; fx?: number; fy?: number };

export type MemberForce = {
  from: string;
  to: string;
  /** signed axial force: + tension, − compression, ≈ 0 zero-force. */
  force: number;
  type: 'tension' | 'compression' | 'zero';
  length: number;
};

export type ReactionForce = {
  joint: string;
  supportType: 'pin' | 'roller';
  fx: number;
  fy: number;
  magnitude: number;
  /** roller only: the scalar reaction along its normal, and that normal's angle. */
  scalar?: number;
  angleDeg?: number;
};

export type JointResidual = { joint: string; sumFx: number; sumFy: number };

export type TrussSolution = {
  determinacy: { joints: number; members: number; reactions: number; status: 'determinate' };
  members: MemberForce[];
  reactions: ReactionForce[];
  /** labels ("A-B") of members whose axial force is ≈ 0. */
  zeroForceMembers: string[];
  /** headline: the largest member force magnitude in the truss. */
  maxForce: number;
  maxTension: number;
  maxCompression: number;
  /** per-joint ΣFx/ΣFy recomputed from the solved forces — must all be ≈ 0. */
  jointResiduals: JointResidual[];
  maxResidual: number;
};

function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
const DEG = Math.PI / 180;
/** cos/sin snapped so the vertical/horizontal defaults are exactly (0,±1)/(±1,0). */
function trigSnap(deg: number): { c: number; s: number } {
  const c0 = Math.cos(deg * DEG), s0 = Math.sin(deg * DEG);
  return { c: Math.abs(c0) < 1e-12 ? 0 : c0, s: Math.abs(s0) < 1e-12 ? 0 : s0 };
}

// ─── Dense linear solve: Gaussian elimination with partial pivoting ───────────

/**
 * Solve A·x = b for a square n×n system by Gaussian elimination with partial
 * pivoting. Returns null when the matrix is singular (a pivot collapses to ~0),
 * which for a count-determinate truss means a geometrically unstable arrangement.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  if (A.length !== n || A.some((row) => row.length !== n)) return null;
  // Work on an augmented copy so the inputs are untouched.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot: pull the largest-magnitude entry in this column to the top.
    let piv = col, best = Math.abs(M[col][col]);
    for (let rr = col + 1; rr < n; rr++) {
      const a = Math.abs(M[rr][col]);
      if (a > best) { best = a; piv = rr; }
    }
    if (best < 1e-12) return null; // singular / unstable
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
    const pivVal = M[col][col];
    // Eliminate every row below the pivot.
    for (let rr = col + 1; rr < n; rr++) {
      const factor = M[rr][col] / pivVal;
      if (factor === 0) continue;
      for (let cc = col; cc <= n; cc++) M[rr][cc] -= factor * M[col][cc];
    }
  }
  // Back-substitution.
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let s = M[row][n];
    for (let cc = row + 1; cc < n; cc++) s -= M[row][cc] * x[cc];
    x[row] = s / M[row][row];
  }
  return x;
}

// ─── Joint equilibrium residual (the self-check, no answer key) ───────────────

/**
 * Recompute the net force at every joint from the SOLVED member forces, support
 * reactions and applied loads — independently of the matrix that produced them.
 * For a correct solve every joint must return ΣFx ≈ ΣFy ≈ 0. This is the truss
 * analogue of the four-bar loop-closure residual: the solver's own constraint,
 * checked directly.
 */
export function jointResiduals(input: {
  joints: TrussJoint[];
  memberForces: { from: string; to: string; force: number }[];
  reactions: { joint: string; fx: number; fy: number }[];
  loads: { joint: string; fx: number; fy: number }[];
}): JointResidual[] {
  const byName = new Map(input.joints.map((j) => [j.name, j]));
  return input.joints.map((j) => {
    let sumFx = 0, sumFy = 0;
    for (const m of input.memberForces) {
      let other: TrussJoint | undefined;
      if (m.from === j.name) other = byName.get(m.to);
      else if (m.to === j.name) other = byName.get(m.from);
      else continue;
      if (!other) continue;
      // Tension pulls this joint toward the other end: force · unit(j → other).
      const dx = other.x - j.x, dy = other.y - j.y, len = Math.hypot(dx, dy) || 1;
      sumFx += m.force * (dx / len);
      sumFy += m.force * (dy / len);
    }
    for (const rxn of input.reactions) if (rxn.joint === j.name) { sumFx += rxn.fx; sumFy += rxn.fy; }
    for (const load of input.loads) if (load.joint === j.name) { sumFx += load.fx; sumFy += load.fy; }
    return { joint: j.name, sumFx, sumFy };
  });
}

/** Whole-truss external balance: ΣFx, ΣFy, and ΣM about the origin over the
 *  reactions and applied loads (member internal forces cancel globally). */
export function globalEquilibrium(input: {
  reactions: { joint: string; fx: number; fy: number }[];
  loads: { joint: string; fx: number; fy: number }[];
  jointAt: (name: string) => { x: number; y: number } | undefined;
}): { sumFx: number; sumFy: number; sumMoment: number } {
  let sumFx = 0, sumFy = 0, sumMoment = 0;
  const acc = (name: string, fx: number, fy: number) => {
    sumFx += fx; sumFy += fy;
    const p = input.jointAt(name);
    if (p) sumMoment += p.x * fy - p.y * fx; // moment about the origin
  };
  for (const r of input.reactions) acc(r.joint, r.fx, r.fy);
  for (const l of input.loads) acc(l.joint, l.fx, l.fy);
  return { sumFx, sumFy, sumMoment };
}

// ─── The solver ───────────────────────────────────────────────────────────────

type ReactionDof =
  | { supportIdx: number; jointIdx: number; kind: 'pin_x' }
  | { supportIdx: number; jointIdx: number; kind: 'pin_y' }
  | { supportIdx: number; jointIdx: number; kind: 'roller'; c: number; s: number };

/**
 * Solve a 2D statically determinate pin-jointed truss by the method of joints.
 * Returns each member's signed axial force (+ tension / − compression), each
 * support reaction, the flagged zero-force members, and the per-joint
 * equilibrium residuals that prove the solve.
 */
export function solveTruss(args: {
  joints: TrussJoint[];
  members: TrussMember[];
  supports: TrussSupport[];
  loads?: TrussLoad[];
}): TrussResult<TrussSolution> {
  const joints = Array.isArray(args?.joints) ? args.joints : [];
  const members = Array.isArray(args?.members) ? args.members : [];
  const supports = Array.isArray(args?.supports) ? args.supports : [];
  const loadsIn = Array.isArray(args?.loads) ? args.loads : [];

  if (joints.length < 2) return { ok: false, error: 'a truss needs at least two joints' };
  if (members.length < 1) return { ok: false, error: 'a truss needs at least one member' };

  // Joints: finite unique names + coordinates.
  const index = new Map<string, number>();
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    const name = typeof j?.name === 'string' ? j.name.trim() : '';
    const x = fin(j?.x), y = fin(j?.y);
    if (!name) return { ok: false, error: `joint ${i} needs a non-empty name` };
    if (x === null || y === null) return { ok: false, error: `joint "${name}" needs finite x and y coordinates` };
    if (index.has(name)) return { ok: false, error: `duplicate joint name "${name}"` };
    index.set(name, i);
  }
  const jointAt = (name: string) => { const i = index.get(name); return i === undefined ? undefined : joints[i]; };

  // Members: reference real joints, distinct endpoints, no duplicate pair.
  const seenPairs = new Set<string>();
  const memList: { from: string; to: string; p: number; q: number; ux: number; uy: number; len: number }[] = [];
  for (let k = 0; k < members.length; k++) {
    const m = members[k];
    const p = index.get(String(m?.from)), q = index.get(String(m?.to));
    if (p === undefined || q === undefined) return { ok: false, error: `member ${k} references an unknown joint (${String(m?.from)}→${String(m?.to)})` };
    if (p === q) return { ok: false, error: `member ${k} connects joint "${m.from}" to itself` };
    const key = p < q ? `${p}-${q}` : `${q}-${p}`;
    if (seenPairs.has(key)) return { ok: false, error: `duplicate member between "${m.from}" and "${m.to}"` };
    seenPairs.add(key);
    const A0 = joints[p], B0 = joints[q];
    const dx = B0.x - A0.x, dy = B0.y - A0.y, len = Math.hypot(dx, dy);
    if (len < 1e-12) return { ok: false, error: `member "${m.from}-${m.to}" has zero length (coincident joints)` };
    memList.push({ from: joints[p].name, to: joints[q].name, p, q, ux: dx / len, uy: dy / len, len });
  }

  // Supports: real joints, one per joint, build the reaction degrees of freedom.
  const dofs: ReactionDof[] = [];
  const supportOf = new Map<number, 'pin' | 'roller'>();
  const supportAngle = new Map<number, number>();
  for (let s = 0; s < supports.length; s++) {
    const sup = supports[s];
    const ji = index.get(String(sup?.joint));
    if (ji === undefined) return { ok: false, error: `support ${s} references an unknown joint "${String(sup?.joint)}"` };
    if (supportOf.has(ji)) return { ok: false, error: `joint "${joints[ji].name}" has more than one support` };
    if (sup.type === 'pin') {
      supportOf.set(ji, 'pin');
      dofs.push({ supportIdx: s, jointIdx: ji, kind: 'pin_x' });
      dofs.push({ supportIdx: s, jointIdx: ji, kind: 'pin_y' });
    } else if (sup.type === 'roller') {
      const angle = sup.angle === undefined ? 90 : fin(sup.angle);
      if (angle === null) return { ok: false, error: `roller at "${joints[ji].name}" has a non-finite angle` };
      const { c, s: sn } = trigSnap(angle);
      supportOf.set(ji, 'roller');
      supportAngle.set(ji, angle);
      dofs.push({ supportIdx: s, jointIdx: ji, kind: 'roller', c, s: sn });
    } else {
      return { ok: false, error: `support ${s} has an unknown type "${String((sup as any)?.type)}" (use 'pin' or 'roller')` };
    }
  }

  // Loads: real joints, finite components; aggregate per joint.
  const loadByJoint = new Map<number, { fx: number; fy: number }>();
  for (let l = 0; l < loadsIn.length; l++) {
    const ld = loadsIn[l];
    const ji = index.get(String(ld?.joint));
    if (ji === undefined) return { ok: false, error: `load ${l} references an unknown joint "${String(ld?.joint)}"` };
    const fx = ld.fx === undefined ? 0 : fin(ld.fx);
    const fy = ld.fy === undefined ? 0 : fin(ld.fy);
    if (fx === null || fy === null) return { ok: false, error: `load at "${joints[ji].name}" has a non-finite component` };
    const cur = loadByJoint.get(ji) ?? { fx: 0, fy: 0 };
    cur.fx += fx; cur.fy += fy;
    loadByJoint.set(ji, cur);
  }

  // Determinacy: 2j equations vs (m member forces + r reaction components).
  const j = joints.length, m = memList.length, r = dofs.length;
  const eq = 2 * j, unk = m + r;
  if (unk < eq) {
    return { ok: false, error: `unstable mechanism: m + r = ${unk} < 2j = ${eq} — too few members or reactions to be rigid` };
  }
  if (unk > eq) {
    return { ok: false, error: `statically indeterminate: m + r = ${unk} > 2j = ${eq} — this solver handles determinate trusses only` };
  }

  // Assemble A·x = b. Columns 0..m-1 = member forces; m.. = reaction dofs.
  // Rows 2i / 2i+1 = ΣFx / ΣFy at joint i. Equilibrium is Σ(members+reactions)
  // = −(applied load), so the load goes on the right-hand side.
  const A: number[][] = Array.from({ length: eq }, () => new Array(unk).fill(0));
  const b: number[] = new Array(eq).fill(0);
  for (let k = 0; k < m; k++) {
    const mm = memList[k];
    // Tension pulls each joint toward the far end.
    A[2 * mm.p][k] += mm.ux;       A[2 * mm.p + 1][k] += mm.uy;
    A[2 * mm.q][k] += -mm.ux;      A[2 * mm.q + 1][k] += -mm.uy;
  }
  for (let d = 0; d < dofs.length; d++) {
    const dof = dofs[d], col = m + d, i = dof.jointIdx;
    if (dof.kind === 'pin_x') A[2 * i][col] += 1;
    else if (dof.kind === 'pin_y') A[2 * i + 1][col] += 1;
    else { A[2 * i][col] += dof.c; A[2 * i + 1][col] += dof.s; }
  }
  for (const [i, load] of loadByJoint) { b[2 * i] = -load.fx; b[2 * i + 1] = -load.fy; }

  const x = solveLinearSystem(A, b);
  if (x === null) {
    return { ok: false, error: 'geometrically unstable: the equilibrium matrix is singular (check support directions and geometry, even though m + r = 2j)' };
  }

  // Characteristic scale for the zero-force threshold.
  let scale = 1;
  for (let k = 0; k < m; k++) scale = Math.max(scale, Math.abs(x[k]));
  for (const [, ld] of loadByJoint) scale = Math.max(scale, Math.abs(ld.fx), Math.abs(ld.fy));
  const zeroTol = 1e-9 * scale;

  const memberForces: MemberForce[] = memList.map((mm, k) => {
    const force = x[k];
    const type: MemberForce['type'] = Math.abs(force) <= zeroTol ? 'zero' : force > 0 ? 'tension' : 'compression';
    return { from: mm.from, to: mm.to, force, type, length: mm.len };
  });

  const reactions: ReactionForce[] = supports.map((sup, s) => {
    const ji = index.get(String(sup.joint))!;
    if (sup.type === 'pin') {
      const dx = dofs.findIndex((d) => d.supportIdx === s && d.kind === 'pin_x');
      const dy = dofs.findIndex((d) => d.supportIdx === s && d.kind === 'pin_y');
      const fx = x[m + dx], fy = x[m + dy];
      return { joint: joints[ji].name, supportType: 'pin', fx, fy, magnitude: Math.hypot(fx, fy) };
    }
    const dr = dofs.findIndex((d) => d.supportIdx === s && d.kind === 'roller') as number;
    const dof = dofs[dr] as Extract<ReactionDof, { kind: 'roller' }>;
    const scalar = x[m + dr];
    const fx = scalar * dof.c, fy = scalar * dof.s;
    return { joint: joints[ji].name, supportType: 'roller', fx, fy, magnitude: Math.abs(scalar), scalar, angleDeg: supportAngle.get(ji) };
  });

  const forcesForResidual = memberForces.map((mf) => ({ from: mf.from, to: mf.to, force: mf.force }));
  const reactionsForResidual = reactions.map((rr) => ({ joint: rr.joint, fx: rr.fx, fy: rr.fy }));
  const loadsForResidual = [...loadByJoint].map(([i, ld]) => ({ joint: joints[i].name, fx: ld.fx, fy: ld.fy }));
  const residuals = jointResiduals({ joints, memberForces: forcesForResidual, reactions: reactionsForResidual, loads: loadsForResidual });
  const maxResidual = residuals.reduce((mx, rr) => Math.max(mx, Math.abs(rr.sumFx), Math.abs(rr.sumFy)), 0);

  const forces = memberForces.map((mf) => mf.force);
  const maxForce = forces.reduce((mx, f) => Math.max(mx, Math.abs(f)), 0);
  const maxTension = forces.reduce((mx, f) => Math.max(mx, f), 0);
  const maxCompression = forces.reduce((mn, f) => Math.min(mn, f), 0);

  return {
    ok: true,
    value: {
      determinacy: { joints: j, members: m, reactions: r, status: 'determinate' },
      members: memberForces,
      reactions,
      zeroForceMembers: memberForces.filter((mf) => mf.type === 'zero').map((mf) => `${mf.from}-${mf.to}`),
      maxForce,
      maxTension,
      maxCompression,
      jointResiduals: residuals,
      maxResidual,
    },
  };
}
