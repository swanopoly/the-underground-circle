/**
 * engineeringColumnCore — INTERMEDIATE & ECCENTRIC COLUMN analysis: the J.B.
 * Johnson parabola and the SECANT formula. This is the honest COMPLEMENT to the
 * calc-core `column_buckling` kind, which computes only the Euler elastic
 * critical load Pcr = π²EI/(KL)².
 *
 * WHY EULER ALONE LIES FOR REAL COLUMNS. Euler's formula assumes the column
 * buckles ELASTICALLY — that its critical stress σcr = π²E/λ² (with the
 * slenderness ratio λ = KL/k and the radius of gyration k = √(I/A)) stays below
 * the yield strength. As a column gets shorter (λ → 0) Euler's σcr shoots to
 * INFINITY, predicting critical stresses many times the yield — which is
 * physically absurd, because a stocky column simply yields/crushes long before it
 * can buckle elastically. Euler is valid ONLY for slender columns. Short and
 * intermediate columns need a curve that respects the material strength.
 *
 * THE TRANSITION SLENDERNESS Cc AND THE J.B. JOHNSON PARABOLA. The dividing line
 * is the slenderness at which Euler's elastic critical stress has fallen to HALF
 * the yield: setting π²E/λ² = Sy/2 gives the transition Cc = √(2π²E/Sy). At or
 * above Cc (slender) the column is EULER, σcr = π²E/λ². Below Cc
 * (intermediate/stocky) it follows the J.B. JOHNSON parabola
 *   σcr = Sy·[1 − Sy·λ²/(4π²E)]  =  Sy·[1 − ½·(λ/Cc)²]
 * a parabola equal to the full yield Sy at λ = 0 that bends down to meet Euler at
 * Cc. (The equivalent middle form Sy − (Sy·λ/(2π·√E))² is the same expression;
 * Shigley, Mechanical Engineering Design §4-13, and any structural-steel text.)
 *
 * WHY Cc — THE TANGENCY. Cc is not an arbitrary switch: the Johnson parabola is
 * deliberately constructed so that at λ = Cc it shares BOTH the same value AND the
 * same slope as the Euler hyperbola, so the two join into one smooth C¹ column
 * curve. Both give σcr = Sy/2 there (Johnson: Sy·[1−½]; Euler: π²E/Cc² = Sy/2),
 * and both derivatives equal −2π²E/Cc³. The smoke proves this by evaluating BOTH
 * formulas at Cc and finite-differencing BOTH slopes — that mutual agreement is
 * precisely the reason the transition is placed at Cc.
 *
 * THE SECANT FORMULA — REAL COLUMNS ARE ECCENTRIC. No axial load lands perfectly
 * on the centroid. With the load P offset by an eccentricity e, the peak
 * compressive stress is the classic secant formula
 *   σmax = (P/A)·[1 + (e·c/k²)·sec( (KL/2k)·√(P/(A·E)) )]
 * where c is the distance from the neutral axis to the extreme fibre. The
 * dimensionless group e·c/k² is the eccentricity ratio; the bracket in excess of 1
 * is the amplification. As e → 0 the amplification → 1 and σmax → P/A (pure
 * compression); as P → the Euler Pcr the secant argument → π/2 and σmax → ∞, the
 * column running away in bending. (The secant argument identically equals
 * (π/2)·√(P/Pcr), so it is a pure measure of how close the load is to Euler.)
 *
 * UNITS: the mm / N / MPa system of engineeringCalcCore. E and Sy in MPa, lengths
 * in mm, area in mm², I in mm⁴, loads in N, stresses in MPa. Composes the
 * MATERIALS table (E and yield) and the structural-section core (A, I → k = √(I/A)).
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-column-core-smoketest.ts):
 * every result is asserted against a hand-computed reference and the Euler/Johnson
 * tangency is proven from both formulas. The smoke IS the proof; no app, no I/O.
 */

import { MATERIALS } from './engineeringCalcCore';

export type ColumnResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Positive-finite (a length, area, load, or strength — all magnitudes). */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Finite (any signed value). */
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Non-negative finite (an eccentricity may be exactly zero). */
function nn(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
/** Round to `digits` decimal places for display parity. */
function r(x: number, digits = 4): number { if (!Number.isFinite(x)) return x; const f = Math.pow(10, digits); return Math.round(x * f) / f; }

const PI = Math.PI;
const TWO_PI2 = 2 * PI * PI;   // 2π²
const FOUR_PI2 = 4 * PI * PI;  // 4π²

/** Theoretical effective-length factors K (same set as the calc-core Euler kind). */
export const COLUMN_END_K: Record<string, number> = {
  pinned_pinned: 1.0, pinned: 1.0,
  fixed_free: 2.0, cantilever: 2.0,
  fixed_fixed: 0.5, fixed: 0.5,
  fixed_pinned: 0.699, propped: 0.699,
};

// ─── The three pure column-curve pieces (exported for the tangency proof) ─────

/** Transition slenderness Cc = √(2π²E/Sy) — the λ at which Euler σcr falls to Sy/2. */
export function transitionSlenderness(E: number, yieldStrength: number): number {
  return Math.sqrt((TWO_PI2 * E) / yieldStrength);
}

/** Euler elastic critical stress σcr = π²E/λ² (valid for slender columns, λ ≥ Cc). */
export function eulerCriticalStress(E: number, lambda: number): number {
  return (PI * PI * E) / (lambda * lambda);
}

/**
 * J.B. Johnson parabolic critical stress σcr = Sy·[1 − Sy·λ²/(4π²E)] (intermediate
 * columns, λ < Cc). Equals Sy·[1 − ½·(λ/Cc)²]; = Sy at λ = 0, = Sy/2 at λ = Cc.
 */
export function johnsonCriticalStress(E: number, yieldStrength: number, lambda: number): number {
  return yieldStrength * (1 - (yieldStrength * lambda * lambda) / (FOUR_PI2 * E));
}

// ─── Input resolution (compose materials + section-property inputs) ───────────

function lookupMaterial(name?: string): { E: number; yield: number } | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const m = MATERIALS[name.trim().toLowerCase()];
  return m ? { E: m.E, yield: m.yield } : null;
}

/** Young's modulus from an explicit E (MPa) or a material name. */
function resolveE(args: { E?: number; material?: string }): number | null {
  if (args.E !== undefined) return pos(args.E);
  const m = lookupMaterial(args.material);
  return m ? m.E : null;
}

/** Yield strength from an explicit yield (MPa) or a material name. */
function resolveYield(args: { yield?: number; material?: string }): number | null {
  if (args.yield !== undefined) return pos(args.yield);
  const m = lookupMaterial(args.material);
  return m ? m.yield : null;
}

/**
 * Resolve the cross-section to { area A, radius of gyration k, second moment I }.
 * Accepts a round-bar `diameter` (A, I, k, and the natural extreme-fibre c = d/2
 * all derived), or an `area` plus either a `radiusOfGyration` k or a
 * `momentOfInertia` I (so it composes the structural-section core's A and Iₓ).
 */
function resolveGeometry(args: {
  area?: number; radiusOfGyration?: number; momentOfInertia?: number; diameter?: number;
}): { A: number; k: number; I: number; cRound?: number } | { error: string } {
  if (args.diameter !== undefined) {
    const d = pos(args.diameter);
    if (d === null) return { error: 'diameter must be positive (mm)' };
    const A = (PI * d * d) / 4;
    const I = (PI * Math.pow(d, 4)) / 64;
    return { A, k: d / 4, I, cRound: d / 2 }; // k = √(I/A) = d/4 for a solid round
  }
  const A = args.area !== undefined ? pos(args.area) : null;
  if (A === null) return { error: 'need a positive area (mm²), or a round-bar diameter (mm)' };
  const k0 = args.radiusOfGyration !== undefined ? pos(args.radiusOfGyration) : null;
  if (k0 !== null) return { A, k: k0, I: A * k0 * k0 };
  const I0 = args.momentOfInertia !== undefined ? pos(args.momentOfInertia) : null;
  if (I0 !== null) return { A, k: Math.sqrt(I0 / A), I: I0 };
  return { error: 'need radiusOfGyration k (mm), momentOfInertia I (mm⁴), or a round-bar diameter (mm)' };
}

/** Effective length KL: from an explicit `effectiveLength`, or `length` × end-condition K. */
function resolveEffectiveLength(args: {
  effectiveLength?: number; length?: number; endCondition?: string;
}): { Le: number; K: number; end: string } | { error: string } {
  if (args.effectiveLength !== undefined) {
    const Le = pos(args.effectiveLength);
    if (Le === null) return { error: 'effectiveLength must be positive (mm)' };
    const L = args.length !== undefined ? pos(args.length) : null;
    return { Le, K: L !== null ? Le / L : 1, end: 'explicit' };
  }
  const L = pos(args.length);
  if (L === null) return { error: 'need effectiveLength (mm) or length (mm)' };
  const key = String(args.endCondition || 'pinned_pinned').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const K = COLUMN_END_K[key];
  if (K === undefined) return { error: `unknown endCondition — use ${Object.keys(COLUMN_END_K).join(', ')}` };
  return { Le: K * L, K, end: key };
}

// ─── columnCritical: auto Euler / Johnson critical load ───────────────────────

export type ColumnCriticalResult = {
  regime: 'euler' | 'johnson';
  slendernessRatio: number;    // λ = KL/k
  transitionCc: number;        // Cc = √(2π²E/Sy)
  criticalStress: number;      // σcr, MPa
  criticalLoad: number;        // Pcr = σcr·A, N
  eulerStressAtLambda: number; // what Euler ALONE predicts at this λ (transparency)
  yieldStrength: number;       // Sy, MPa
  effectiveLength: number;     // KL, mm
  K: number;
  radiusOfGyration: number;    // k, mm
  area: number;                // A, mm²
  momentOfInertia: number;     // I, mm⁴
  E: number;                   // MPa
  endCondition: string;
};

/**
 * Critical buckling load of a column, choosing the correct regime automatically:
 * Euler σcr = π²E/λ² when λ ≥ Cc (slender), else the J.B. Johnson parabola
 * σcr = Sy·[1 − Sy·λ²/(4π²E)] (intermediate/stocky). Pcr = σcr·A. Reports the
 * regime, λ, Cc, σcr, Pcr, the effective length / K used, and — for transparency —
 * the (often absurd) stress Euler alone would predict at this λ.
 */
export function columnCritical(args: {
  material?: string; E?: number; yield?: number;
  length?: number; effectiveLength?: number; endCondition?: string;
  area?: number; radiusOfGyration?: number; momentOfInertia?: number; diameter?: number;
}): ColumnResult<ColumnCriticalResult> {
  const E = resolveE(args);
  if (E === null) return { ok: false, error: 'supply a material (for E) or an explicit E (MPa)' };
  const Sy = resolveYield(args);
  if (Sy === null) return { ok: false, error: 'supply a material (for yield) or an explicit yield strength (MPa)' };
  const geo = resolveGeometry(args);
  if ('error' in geo) return { ok: false, error: geo.error };
  const len = resolveEffectiveLength(args);
  if ('error' in len) return { ok: false, error: len.error };

  const lambda = len.Le / geo.k;
  const Cc = transitionSlenderness(E, Sy);
  const eulerAt = eulerCriticalStress(E, lambda);
  const regime: 'euler' | 'johnson' = lambda >= Cc ? 'euler' : 'johnson';
  const sigmaCr = regime === 'euler' ? eulerAt : johnsonCriticalStress(E, Sy, lambda);
  const Pcr = sigmaCr * geo.A;

  return {
    ok: true,
    value: {
      regime,
      slendernessRatio: r(lambda, 4),
      transitionCc: r(Cc, 4),
      criticalStress: r(sigmaCr, 4),
      criticalLoad: r(Pcr, 4),
      eulerStressAtLambda: r(eulerAt, 4),
      yieldStrength: r(Sy, 4),
      effectiveLength: r(len.Le, 4),
      K: r(len.K, 4),
      radiusOfGyration: r(geo.k, 4),
      area: r(geo.A, 4),
      momentOfInertia: r(geo.I, 4),
      E: r(E, 4),
      endCondition: len.end,
    },
  };
}

// ─── eccentricColumn: the secant formula ──────────────────────────────────────

export type EccentricColumnResult = {
  sigmaMax: number;          // σmax, MPa
  axialStress: number;       // mean axial stress P/A, MPa
  eccentricityRatio: number; // e·c/k² (dimensionless)
  amplification: number;     // σmax / (P/A) = 1 + (ec/k²)·sec(arg)
  secant: number;            // sec(arg)
  secArgument: number;       // (KL/2k)·√(P/AE) = (π/2)·√(P/Pcr), rad
  criticalLoad: number;      // Euler Pcr, N
  loadRatio: number;         // P/Pcr
  load: number;              // P, N
  effectiveLength: number;   // KL, mm
  K: number;
  radiusOfGyration: number;  // k, mm
  area: number;              // A, mm²
  extremeFibre: number;      // c, mm
  eccentricity: number;      // e, mm
  E: number;                 // MPa
};

/**
 * Secant-formula peak compressive stress in an eccentrically loaded column:
 *   σmax = (P/A)·[1 + (e·c/k²)·sec( (KL/2k)·√(P/(A·E)) )]
 * Given the load P it returns σmax (the formula is transcendental in P, so it is
 * evaluated forward for a given P rather than inverted for an allowable P). Reports
 * the eccentricity ratio e·c/k², the amplification beyond the mean stress P/A, and
 * — because the secant argument is (π/2)·√(P/Pcr) — how close P is to the Euler
 * critical load. Fails closed when P ≥ Pcr (σmax is unbounded: the column buckles).
 */
export function eccentricColumn(args: {
  load: number; eccentricity: number; extremeFibre?: number;
  material?: string; E?: number;
  length?: number; effectiveLength?: number; endCondition?: string;
  area?: number; radiusOfGyration?: number; momentOfInertia?: number; diameter?: number;
}): ColumnResult<EccentricColumnResult> {
  const P = pos(args.load);
  if (P === null) return { ok: false, error: 'eccentric column needs a positive load P (N)' };
  const e = nn(args.eccentricity);
  if (e === null) return { ok: false, error: 'eccentricity e must be a non-negative number (mm)' };
  const E = resolveE(args);
  if (E === null) return { ok: false, error: 'supply a material (for E) or an explicit E (MPa)' };
  const geo = resolveGeometry(args);
  if ('error' in geo) return { ok: false, error: geo.error };
  // c = distance to the extreme fibre; default to the round-bar radius when a diameter was given.
  const c = args.extremeFibre !== undefined ? pos(args.extremeFibre) : (geo.cRound ?? null);
  if (c === null) return { ok: false, error: 'need a positive extremeFibre c (mm), or supply a round-bar diameter' };
  const len = resolveEffectiveLength(args);
  if ('error' in len) return { ok: false, error: len.error };

  const Pcr = (PI * PI * E * geo.I) / (len.Le * len.Le);
  if (P >= Pcr) return { ok: false, error: `load P=${r(P, 2)} N ≥ Euler Pcr=${r(Pcr, 2)} N — the column buckles and σmax is unbounded (need P < Pcr)` };

  const arg = (len.Le / (2 * geo.k)) * Math.sqrt(P / (geo.A * E));
  const sec = 1 / Math.cos(arg);
  const eccRatio = (e * c) / (geo.k * geo.k);
  const axial = P / geo.A;
  const amplification = 1 + eccRatio * sec;
  const sigmaMax = axial * amplification;

  return {
    ok: true,
    value: {
      sigmaMax: r(sigmaMax, 4),
      axialStress: r(axial, 4),
      eccentricityRatio: r(eccRatio, 6),
      amplification: r(amplification, 6),
      secant: r(sec, 6),
      secArgument: r(arg, 6),
      criticalLoad: r(Pcr, 4),
      loadRatio: r(P / Pcr, 6),
      load: r(P, 4),
      effectiveLength: r(len.Le, 4),
      K: r(len.K, 4),
      radiusOfGyration: r(geo.k, 4),
      area: r(geo.A, 4),
      extremeFibre: r(c, 4),
      eccentricity: r(e, 4),
      E: r(E, 4),
    },
  };
}
