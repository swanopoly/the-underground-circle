/**
 * engineeringSpringTypesCore — TORSION, EXTENSION, and BELLEVILLE (coned-disc)
 * springs: the three spring families beyond the plain helical COMPRESSION spring
 * that already lives in engineeringCalcCore (`springRate`). Its headline is a
 * genuine, easily-missed piece of mechanics — the SAME coil of the SAME wire has
 * a DIFFERENT stiffness law depending on HOW the load reaches the wire:
 *
 *   • A helical COMPRESSION spring (calcCore.springRate) twists its wire, so the
 *     wire is loaded in TORSION. Its rate is k = G·d⁴/(8·D³·n) — it depends on the
 *     SHEAR modulus G.
 *   • A helical TORSION spring (this core) winds/unwinds, so its wire is loaded in
 *     BENDING. Its angular rate is k' = E·d⁴/(10.8·D·n) — it depends on YOUNG'S
 *     modulus E.
 *
 * Same d, D, n; a different modulus, because the wire is stressed a different way.
 * For steel E ≈ 2.5·G (200 000 vs 79 300 MPa), so the two rates are NOT a rescaling
 * of one another — they are different physics. This E-vs-G duality is the anchor
 * the smoke pins: an extension spring (this core) reuses the compression G-law, a
 * torsion spring uses the bending E-law, and the two moduli genuinely differ.
 *
 * TORSION SPRING. A helical torsion spring resists a MOMENT about the coil axis.
 * The active wire behaves as a curved cantilever beam in bending, length πDN and
 * second moment I = πd⁴/64, so the angular deflection is θ = M·L/(EI). Working that
 * through and switching θ to TURNS (revolutions) gives the practical Shigley/Wahl
 * rate k' = d⁴E/(10.8·D·N) — torque PER REVOLUTION. (The theoretical constant is
 * 32/π = 10.2; the 10.8 is the measured value that folds in inter-coil friction and
 * curvature.) The peak bending stress is at the INNER fibre, magnified by the
 * curvature-correction factor Ki = (4C²−C−1)/(4C(C−1)), C = D/d, so
 * σ = Ki·32M/(π·d³). The core reports the rate (per turn, per radian, per degree),
 * the moment at a given angular deflection, and that stress.
 *
 * EXTENSION SPRING. A close-wound helical extension spring shares the compression
 * G-rate k = G·d⁴/(8·D³·n) — BUT it is coiled with INITIAL TENSION Fi: the coils
 * clamp together, so the spring already carries a force Fi at ZERO deflection and
 * does not begin to open until the applied force exceeds Fi. Thereafter it is
 * linear about that offset: F = Fi + k·x. The force at zero deflection is Fi, not
 * zero (the defining feature), and the deflection to reach a target force subtracts
 * Fi first: x = (F − Fi)/k (and is zero until F passes Fi).
 *
 * BELLEVILLE (coned disc) WASHER. A shallow truncated cone of spring steel with a
 * NONLINEAR load–deflection curve, from the classic Almen–Laszlo model:
 *   P = [4E / (K1·(1−ν²)·Do²)] · δ · [(h−δ/2)(h−δ)·t + t³]
 * with outer diameter Do, thickness t, cone height h (free height − t), deflection
 * δ, Poisson's ratio ν, and geometry factor K1 = (6/(π·ln R))·((R−1)/R)², R = Do/Di.
 * Because the load is CUBIC in δ, the disc is not a constant-rate spring; the ratio
 * h/t controls the shape of the curve. The tangent stiffness at full flattening
 * (δ = h) is proportional to (t² − ½h²), so:
 *   • h/t < √2  → positive rate at δ=h (a stiffening then softening but rising curve);
 *   • h/t = √2  → ZERO rate at δ=h — a near-constant-force PLATEAU (a real design
 *                 anchor: a Belleville tuned to h/t=√2 delivers roughly constant load
 *                 over its travel);
 *   • h/t > √2  → NEGATIVE rate (snap-through / bistable) region.
 * Discs STACK: nested the same way (parallel) the loads add at a shared deflection;
 * alternated (series) the deflections add at a shared load. The core reports the
 * load, the tangent stiffness, K1, the h/t ratio (flagging the √2 plateau and the
 * snap-through sign), and the parallel/series stack totals.
 *
 * UNIT SYSTEM. The self-consistent mm / N / MPa set of engineeringCalcCore: wire
 * and coil diameters in mm, forces in N, moments in N·mm, E and G in MPa. Composes
 * that core's MATERIALS table for E (torsion, Belleville) and G (extension).
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-spring-types-core-smoketest.ts):
 * no I/O, no Date.now(), total functions. The smoke IS the proof — every result is
 * asserted against a hand-computed reference, the E-vs-G duality is pinned against
 * the SHIPPED compression-spring function, and the Belleville nonlinearity + the
 * √2 flat region + the stack arithmetic are asserted directly.
 */

import { MATERIALS } from './engineeringCalcCore';

export type SpringResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Positive check (diameters, coils, thickness, moduli — all magnitudes). */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Finite check (signed quantities like an applied moment or a deflection angle). */
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Non-negative check (initial tension and a deflection may be zero, never negative). */
function nonneg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
/** Stack count → an integer ≥ 1 (defaults to 1 for a single disc). */
function count(v: unknown): number { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 ? n : 1; }
/** Round to `dp` decimals for display parity (mirrors the calc/stress cores). */
function r(n: number, dp = 4): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

const TWO_PI = 2 * Math.PI;
/** Default Poisson's ratio for spring steel (the MATERIALS table carries E/G, not ν). */
const POISSON_DEFAULT = 0.3;
/** The h/t ratio at which a Belleville disc has a constant-force (zero-rate) plateau. */
const BELLEVILLE_FLAT_RATIO = Math.SQRT2;

/**
 * Resolve a modulus: an explicit value wins, otherwise look the material up in the
 * calc-core MATERIALS table and take E (Young's) or G (shear) as requested.
 */
function resolveModulus(kind: 'E' | 'G', material?: string, explicit?: number): number | null {
  if (explicit !== undefined) { const e = pos(explicit); if (e !== null) return e; }
  if (typeof material === 'string' && material.trim()) {
    const m = MATERIALS[material.trim().toLowerCase()];
    if (m) return kind === 'E' ? m.E : m.G;
  }
  return null;
}

// ─── Helical torsion spring (wire in BENDING → Young's modulus E) ─────────────

export type TorsionSpringResult = {
  ratePerTurn: number;        // k' = E·d⁴/(10.8·D·N), N·mm per revolution (turn)
  ratePerRad: number;         // = ratePerTurn / 2π, N·mm per radian
  ratePerDeg: number;         // = ratePerTurn / 360, N·mm per degree
  springIndex: number;        // C = D/d
  curvatureFactorKi: number;  // inner-fibre bending correction (4C²−C−1)/(4C(C−1))
  youngsModulus: number;      // E used, MPa — the DUALITY: bending uses E, not G
  modulusKind: 'E';
  deflectionDeg: number | null; // operating angular deflection, degrees (if given)
  moment: number | null;        // moment at that deflection, N·mm
  bendingStress: number | null; // peak inner-fibre bending stress, MPa
};

/**
 * Helical TORSION spring — the wire works in BENDING, so the rate uses YOUNG'S
 * modulus E (contrast the compression/extension spring, which twists its wire and
 * uses the shear modulus G). Rate k' = E·d⁴/(10.8·D·N) is a TORQUE PER REVOLUTION
 * (Shigley/Wahl practical form; also returned per radian and per degree). Supply an
 * operating point as an angular deflection (`deflectionRev` | `deflectionDeg` |
 * `deflectionRad`) OR an `appliedMoment` (N·mm) to also get the moment and the peak
 * inner-fibre bending stress σ = Ki·32M/(π·d³).
 */
export function torsionSpring(args: {
  wireDiameter: number;   // d, mm
  meanDiameter: number;   // D, mm (mean coil diameter)
  activeCoils: number;    // N, active turns
  material?: string;      // → E from MATERIALS
  youngsModulus?: number; // explicit E, MPa
  deflectionRev?: number; // operating deflection in revolutions (turns)
  deflectionDeg?: number; // …or degrees
  deflectionRad?: number; // …or radians
  appliedMoment?: number; // …or drive directly with a moment, N·mm
}): SpringResult<TorsionSpringResult> {
  const d = pos(args.wireDiameter), D = pos(args.meanDiameter), n = pos(args.activeCoils);
  if (d === null || D === null || n === null) return { ok: false, error: 'torsionSpring needs positive wireDiameter, meanDiameter, activeCoils (mm, mm, turns)' };
  if (D <= d) return { ok: false, error: 'meanDiameter must exceed wireDiameter (spring index D/d > 1)' };
  const E = resolveModulus('E', args.material, args.youngsModulus);
  if (E === null) return { ok: false, error: "torsionSpring needs a material (for E) or an explicit youngsModulus (MPa) — a torsion spring BENDS its wire, so it uses Young's modulus E, not the shear modulus G" };

  const C = D / d;
  const ratePerTurn = (E * d ** 4) / (10.8 * D * n); // N·mm per revolution
  const ratePerRad = ratePerTurn / TWO_PI;
  const ratePerDeg = ratePerTurn / 360;
  const Ki = (4 * C * C - C - 1) / (4 * C * (C - 1)); // inner-fibre curvature correction

  // Operating point: an angular deflection (rev › deg › rad) OR an applied moment.
  let angleTurns: number | null = null;
  if (args.deflectionRev !== undefined) { const x = fin(args.deflectionRev); if (x !== null) angleTurns = x; }
  else if (args.deflectionDeg !== undefined) { const x = fin(args.deflectionDeg); if (x !== null) angleTurns = x / 360; }
  else if (args.deflectionRad !== undefined) { const x = fin(args.deflectionRad); if (x !== null) angleTurns = x / TWO_PI; }

  let moment: number | null = null;
  if (angleTurns !== null) moment = ratePerTurn * angleTurns;
  else if (args.appliedMoment !== undefined) { const mm = fin(args.appliedMoment); if (mm !== null) moment = mm; }

  const deflectionDeg = moment !== null ? moment / ratePerDeg : null;
  const bendingStress = moment !== null ? (Ki * 32 * moment) / (Math.PI * d ** 3) : null;

  return {
    ok: true,
    value: {
      ratePerTurn: r(ratePerTurn),
      ratePerRad: r(ratePerRad),
      ratePerDeg: r(ratePerDeg),
      springIndex: r(C, 3),
      curvatureFactorKi: r(Ki, 5),
      youngsModulus: E,
      modulusKind: 'E',
      deflectionDeg: deflectionDeg !== null ? r(deflectionDeg) : null,
      moment: moment !== null ? r(moment) : null,
      bendingStress: bendingStress !== null ? r(bendingStress) : null,
    },
  };
}

// ─── Helical extension spring (wire in TORSION → shear modulus G, plus Fi) ─────

export type ExtensionSpringResult = {
  rate: number;                 // k = G·d⁴/(8·D³·n), N/mm (same law as compression)
  springIndex: number;          // C = D/d
  initialTension: number;       // Fi, N — force carried at ZERO deflection
  shearModulus: number;         // G used, MPa — the DUALITY: torsion uses G, not E
  modulusKind: 'G';
  forceAtDeflection: number | null;  // F = Fi + k·x
  deflectionForForce: number | null; // x = (F − Fi)/k, clamped at 0 for F ≤ Fi
  deflectionClampedAtInitial: boolean; // true when the target force ≤ Fi (spring closed)
};

/**
 * Helical EXTENSION spring — like a compression spring its wire works in TORSION,
 * so the rate shares the shear-modulus law k = G·d⁴/(8·D³·n). What makes it an
 * extension spring is INITIAL TENSION Fi: it carries Fi at zero deflection and does
 * not open until the applied force exceeds Fi, then F = Fi + k·x. Optionally give a
 * `deflection` (→ force) and/or a `targetForce` (→ deflection, subtracting Fi first;
 * clamped to 0 when the force has not yet reached Fi).
 */
export function extensionSpring(args: {
  wireDiameter: number;   // d, mm
  meanDiameter: number;   // D, mm
  activeCoils: number;    // n, active coils
  initialTension: number; // Fi, N (≥ 0)
  material?: string;      // → G from MATERIALS
  shearModulus?: number;  // explicit G, MPa
  deflection?: number;    // x, mm → force
  targetForce?: number;   // N → deflection
}): SpringResult<ExtensionSpringResult> {
  const d = pos(args.wireDiameter), D = pos(args.meanDiameter), n = pos(args.activeCoils);
  if (d === null || D === null || n === null) return { ok: false, error: 'extensionSpring needs positive wireDiameter, meanDiameter, activeCoils' };
  if (D <= d) return { ok: false, error: 'meanDiameter must exceed wireDiameter (spring index D/d > 1)' };
  const Fi = nonneg(args.initialTension);
  if (Fi === null) return { ok: false, error: 'extensionSpring needs a non-negative initialTension Fi (N) — an extension spring carries Fi at zero deflection' };
  const G = resolveModulus('G', args.material, args.shearModulus);
  if (G === null) return { ok: false, error: 'extensionSpring needs a material (for G) or an explicit shearModulus (MPa) — like a compression spring it TWISTS its wire, so it uses the shear modulus G' };

  const C = D / d;
  const k = (G * d ** 4) / (8 * D ** 3 * n);

  let forceAtDeflection: number | null = null;
  if (args.deflection !== undefined) { const x = nonneg(args.deflection); if (x !== null) forceAtDeflection = Fi + k * x; }

  let deflectionForForce: number | null = null;
  let clamped = false;
  if (args.targetForce !== undefined) {
    const F = fin(args.targetForce);
    if (F !== null) {
      if (F <= Fi) { deflectionForForce = 0; clamped = true; } // spring has not begun to extend
      else deflectionForForce = (F - Fi) / k;
    }
  }

  return {
    ok: true,
    value: {
      rate: r(k),
      springIndex: r(C, 3),
      initialTension: r(Fi),
      shearModulus: G,
      modulusKind: 'G',
      forceAtDeflection: forceAtDeflection !== null ? r(forceAtDeflection) : null,
      deflectionForForce: deflectionForForce !== null ? r(deflectionForForce) : null,
      deflectionClampedAtInitial: clamped,
    },
  };
}

// ─── Belleville (coned-disc) washer — Almen–Laszlo, NONLINEAR (uses E) ─────────

export type BellevilleResult = {
  load: number;              // P at deflection δ, N (Almen–Laszlo)
  tangentStiffness: number;  // dP/dδ at δ, N/mm (sign tells the curve regime)
  geometryFactorK1: number;  // (6/(π·ln R))·((R−1)/R)², R = Do/Di
  diameterRatio: number;     // R = Do/Di
  heightToThickness: number; // h/t — controls the curve shape
  coneHeight: number;        // h, mm
  thickness: number;         // t, mm
  deflection: number;        // δ, mm
  youngsModulus: number;     // E used, MPa
  poisson: number;           // ν used
  flatRegion: boolean;       // h/t ≈ √2 → near-constant-force plateau design point
  negativeRate: boolean;     // dP/dδ < 0 at δ → snap-through / bistable region
  stackParallel: number;     // discs nested the same way (loads add)
  stackSeries: number;       // discs alternated (deflections add)
  stackLoad: number;         // parallel · P — total stack load at δ
  stackDeflection: number;   // series · δ — total stack deflection at P
};

/**
 * Belleville (coned-disc / cupped) spring washer via the Almen–Laszlo model:
 *   P = [4E / (K1·(1−ν²)·Do²)] · δ · [(h−δ/2)(h−δ)·t + t³],  K1 = (6/(π·ln R))·((R−1)/R)².
 * The load is CUBIC in δ, so the disc is NONLINEAR: unlike a helical spring it has
 * no single rate. The ratio h/t sets the curve shape — h/t = √2 gives a
 * near-constant-force plateau (zero tangent rate at full flattening), h/t > √2 gives
 * a snap-through/bistable (negative-rate) region. Reports the load, the tangent
 * stiffness (its sign flags the regime), K1, the h/t ratio, and the stack totals:
 * `parallel` discs (nested) add load, `series` discs (alternated) add deflection.
 */
export function belleville(args: {
  outerDiameter: number;  // Do, mm
  innerDiameter: number;  // Di, mm (bore)
  thickness: number;      // t, mm
  coneHeight: number;     // h, mm (free height − thickness)
  deflection: number;     // δ, mm
  material?: string;      // → E from MATERIALS
  youngsModulus?: number; // explicit E, MPa
  poisson?: number;       // ν (default 0.3)
  parallel?: number;      // stacked same-way → adds load (default 1)
  series?: number;        // stacked opposing → adds deflection (default 1)
}): SpringResult<BellevilleResult> {
  const Do = pos(args.outerDiameter), Di = pos(args.innerDiameter);
  const t = pos(args.thickness), h = pos(args.coneHeight), delta = pos(args.deflection);
  if (Do === null || Di === null || t === null || h === null || delta === null) return { ok: false, error: 'belleville needs positive outerDiameter, innerDiameter, thickness, coneHeight, deflection (mm)' };
  if (Di >= Do) return { ok: false, error: 'innerDiameter (bore) must be smaller than outerDiameter' };
  const E = resolveModulus('E', args.material, args.youngsModulus);
  if (E === null) return { ok: false, error: 'belleville needs a material (for E) or an explicit youngsModulus (MPa)' };
  const nu = args.poisson !== undefined ? fin(args.poisson) : POISSON_DEFAULT;
  if (nu === null || nu <= 0 || nu >= 0.5) return { ok: false, error: 'poisson ratio must be in (0, 0.5)' };

  const R = Do / Di;
  const K1 = (6 / (Math.PI * Math.log(R))) * ((R - 1) / R) ** 2;
  const A = (4 * E) / (K1 * (1 - nu * nu) * Do * Do);

  // Almen–Laszlo load and its analytic tangent stiffness dP/dδ.
  const load = A * delta * ((h - delta / 2) * (h - delta) * t + t ** 3);
  const stiffness = A * (t * h * h - 3 * t * h * delta + 1.5 * t * delta * delta + t ** 3);

  const parallel = count(args.parallel ?? 1);
  const series = count(args.series ?? 1);
  const hOverT = h / t;

  return {
    ok: true,
    value: {
      load: r(load),
      tangentStiffness: r(stiffness),
      geometryFactorK1: r(K1, 5),
      diameterRatio: r(R),
      heightToThickness: r(hOverT),
      coneHeight: r(h),
      thickness: r(t),
      deflection: r(delta),
      youngsModulus: E,
      poisson: nu,
      flatRegion: Math.abs(hOverT - BELLEVILLE_FLAT_RATIO) < 0.05,
      negativeRate: stiffness < 0,
      stackParallel: parallel,
      stackSeries: series,
      stackLoad: r(parallel * load),
      stackDeflection: r(series * delta),
    },
  };
}
