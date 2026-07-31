/**
 * engineeringPlateBendingCore — FLAT PLATE BENDING under uniform pressure
 * (Roark's Formulas for Stress and Strain). This is the 2-D analogue of the 1-D
 * beam lane in engineeringCalcCore: where a beam carries a line load along one
 * axis, a flat PLATE — a tank head, a bolted-flat cover, an inspection panel, a
 * pressure-vessel end, a floor plate — carries a uniform PRESSURE over an area
 * and bends in two directions at once.
 *
 * WHY A SEPARATE CORE (the plate "signature")
 * A beam's stress scales with span L and its deflection with L³; a plate's max
 * stress scales with (a/t)² and its max deflection with a⁴/t³. Because the plate
 * bends biaxially, its stiffness carries the flexural rigidity
 * D = E·t³ / (12·(1−ν²)), so Poisson's ratio ν enters where it never does for a
 * slender beam. Two edge conditions bracket real hardware: a SIMPLY-SUPPORTED
 * plate is free to rotate at its rim (a cover resting in a groove) while a
 * CLAMPED plate is built in (a welded or bolted-flat boundary). Clamping is
 * stiffer — it deflects far less — but it pays for that with a bending-stress
 * concentration AT THE EDGE that a simply-supported plate does not have (a
 * simply-supported rim carries no radial bending moment at all).
 *
 * WHERE THE NUMBERS COME FROM
 * The CIRCULAR plate has exact closed forms, so its coefficients are computed
 * from ν directly — e.g. the clamped centre deflection is
 * y = 3·q·a⁴·(1−ν²) / (16·E·t³), which is 0.171·q·a⁴/(E·t³) at ν=0.3, and the
 * clamped edge stress is a clean 0.75·q·(a/t)². The RECTANGULAR plate has no
 * elementary closed form, so — exactly as engineeringToleranceCore hard-codes
 * the ISO 286 IT-grade table because the standard rounds to preferred numbers —
 * the Roark/Timoshenko β (stress) and α (deflection) coefficients are HARD-CODED
 * for aspect ratios a/b = 1.0 … 2.0 and the a/b → ∞ strip limit, then
 * interpolated. Those tables are tabulated at ν = 0.3 (Roark's convention). As
 * a/b → ∞ the coefficients approach the 1-D beam-strip values (β → 0.75 simply
 * supported, β → 0.5 clamped) — the plate collapsing back into a beam, which is
 * the physical cross-check that ties the 2-D table to the 1-D beam lane.
 *
 * Reference: R. J. Roark & W. C. Young, "Roark's Formulas for Stress and
 * Strain": Table 11.2 (circular plates) and Table 11.4 (rectangular plates),
 * uniform load over the entire plate; cross-checked against S. Timoshenko,
 * "Theory of Plates and Shells".
 *
 * UNITS: the same self-consistent mm / N / MPa set as engineeringCalcCore —
 * length mm, pressure q in MPa (= N/mm²), Young's modulus E in MPa, stress in
 * MPa, deflection in mm. In that system every formula comes out directly with no
 * conversion factors, which is exactly why the references are clean.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-plate-bending-core-smoketest.ts):
 * the only import is the type-free MATERIALS lookup (itself import-free), no
 * Date.now(), no I/O, total functions.
 */

import { MATERIALS } from './engineeringCalcCore';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Round to a sensible number of significant figures for display parity. */
function r(n: number, dp = 6): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

function ok(value: PlateBending): Result<PlateBending> { return { ok: true, value }; }
function bad(error: string): Result<PlateBending> { return { ok: false, error }; }

// ─── Poisson's ratio (engineeringCalcCore's MATERIALS carries E but not ν) ────

/**
 * Poisson's ratio for the engineeringCalcCore materials. The Roark rectangular
 * tables assume ν ≈ 0.3, and steels sit right there; the softer/lighter alloys
 * and polymers run higher. Supplied so a plate can be sized from a material name
 * (composing MATERIALS for E) the same way the calc core's column/shaft/thermal
 * kinds do. Explicit `poisson` always overrides; unknown materials fall to 0.3.
 */
export const POISSON_RATIO: Record<string, number> = {
  steel: 0.30, stainless: 0.30, aluminum: 0.33, titanium: 0.34, brass: 0.34, abs: 0.35, pla: 0.36,
};

// ─── Rectangular-plate coefficient tables (Roark Table 11.4, uniform load) ────

/**
 * One tabulated aspect-ratio row. `beta` is always the MAXIMUM stress
 * coefficient (σ_max = β·q·b²/t²) and `alpha` the max-deflection coefficient
 * (y_max = α·q·b⁴/(E·t³)), with b = the SHORT side. `betaCenter` (clamped only)
 * is the lower stress at the plate centre; for simply-supported plates the max
 * IS at the centre so it equals `beta`.
 */
type RectRow = { ar: number; beta: number; alpha: number; betaCenter?: number };

/**
 * All edges SIMPLY SUPPORTED, uniform load (Roark Table 11.4, case 1a; ν=0.3).
 * Max stress and max deflection are both at the plate centre. The a/b → ∞ row is
 * the strip limit: β = 6·(1/8) = 0.75 (a simply-supported beam strip, M=wb²/8)
 * and α = 5·12·(1−ν²)/384 = 0.1422 (that strip in cylindrical bending, rigidity
 * D not E·I). Monotone increasing in a/b.
 */
export const RECT_SIMPLY_SUPPORTED: readonly RectRow[] = [
  { ar: 1.0, beta: 0.2874, alpha: 0.0444 },
  { ar: 1.2, beta: 0.3762, alpha: 0.0616 },
  { ar: 1.4, beta: 0.4530, alpha: 0.0770 },
  { ar: 1.6, beta: 0.5172, alpha: 0.0906 },
  { ar: 1.8, beta: 0.5688, alpha: 0.1017 },
  { ar: 2.0, beta: 0.6102, alpha: 0.1106 },
  { ar: Infinity, beta: 0.7500, alpha: 0.1422 },
];

/**
 * All edges CLAMPED / built-in, uniform load (Roark Table 11.4, case 8a; ν=0.3).
 * Max stress is at the CENTRE OF THE LONG EDGE (`beta`); the plate centre carries
 * a lower stress (`betaCenter`). The a/b → ∞ row is the strip limit: β = 6·(1/12)
 * = 0.5 (a fixed-fixed beam strip, M=wb²/12 at the supports) and
 * α = 12·(1−ν²)/384 = 0.0284. A clamped plate deflects far less than a
 * simply-supported one (compare the α columns) — clamping trades deflection for
 * edge stress. Monotone increasing in a/b.
 */
export const RECT_CLAMPED: readonly RectRow[] = [
  { ar: 1.0, beta: 0.3078, alpha: 0.0138, betaCenter: 0.1386 },
  { ar: 1.2, beta: 0.3834, alpha: 0.0188, betaCenter: 0.1794 },
  { ar: 1.4, beta: 0.4356, alpha: 0.0226, betaCenter: 0.2094 },
  { ar: 1.6, beta: 0.4680, alpha: 0.0251, betaCenter: 0.2286 },
  { ar: 1.8, beta: 0.4872, alpha: 0.0267, betaCenter: 0.2406 },
  { ar: 2.0, beta: 0.4974, alpha: 0.0277, betaCenter: 0.2472 },
  { ar: Infinity, beta: 0.5000, alpha: 0.0284, betaCenter: 0.2500 },
];

const centerBeta = (row: RectRow): number => row.betaCenter ?? row.beta;

/**
 * Interpolate the β/α/β_center coefficients at an aspect ratio a/b ≥ 1. Within
 * the finite tabulated range the interpolation is linear in a/b; beyond a/b = 2
 * it is linear in 1/(a/b) toward the ∞ strip limit (so a/b = ∞ ⇒ 1/(a/b) = 0
 * lands exactly on the strip row). Both schemes are monotone, so the whole curve
 * is monotone.
 */
export function rectCoefficients(
  edge: Edge,
  aspectRatio: number,
): Result<{ beta: number; alpha: number; betaCenter: number; ar: number }> {
  const ar = pos(aspectRatio);
  if (ar === null || ar < 1) return { ok: false, error: `aspect ratio a/b must be ≥ 1 (got ${aspectRatio})` };
  const table = edge === 'clamped' ? RECT_CLAMPED : RECT_SIMPLY_SUPPORTED;
  const finite = table.filter((row) => Number.isFinite(row.ar));
  const infRow = table[table.length - 1]; // the a/b → ∞ strip limit
  const first = finite[0];
  const last = finite[finite.length - 1]; // a/b = 2.0

  if (ar <= first.ar) return { ok: true, value: { beta: first.beta, alpha: first.alpha, betaCenter: centerBeta(first), ar } };
  for (let i = 0; i < finite.length - 1; i += 1) {
    const lo = finite[i], hi = finite[i + 1];
    if (ar >= lo.ar && ar <= hi.ar) {
      const f = (ar - lo.ar) / (hi.ar - lo.ar);
      return {
        ok: true,
        value: {
          beta: lo.beta + f * (hi.beta - lo.beta),
          alpha: lo.alpha + f * (hi.alpha - lo.alpha),
          betaCenter: centerBeta(lo) + f * (centerBeta(hi) - centerBeta(lo)),
          ar,
        },
      };
    }
  }
  // ar > 2.0 → interpolate toward the ∞ strip limit, linearly in 1/ar.
  const s = Math.max(0, Math.min(1, (1 / last.ar - 1 / ar) / (1 / last.ar)));
  return {
    ok: true,
    value: {
      beta: last.beta + s * (infRow.beta - last.beta),
      alpha: last.alpha + s * (infRow.alpha - last.alpha),
      betaCenter: centerBeta(last) + s * (centerBeta(infRow) - centerBeta(last)),
      ar,
    },
  };
}

// ─── Public result shape ──────────────────────────────────────────────────────

export type Edge = 'simply_supported' | 'clamped';

export type PlateBending = {
  shape: 'circular' | 'rectangular';
  edge: Edge;
  /** Material name if one was resolved, else null. */
  material: string | null;
  /** Ready-made label for a dispatcher's `quantity` field. */
  quantityLabel: string;
  unit: 'MPa';
  /** Governing maximum bending stress (MPa) and where it occurs. */
  sigmaMax_MPa: number;
  sigmaLocation: 'center' | 'edge';
  /** Maximum deflection (mm) — always at the plate centre for these cases. */
  yMax_mm: number;
  /** The stress coefficient used (k_σ for circular, β for rectangular). */
  stressCoefficient: number;
  /** The deflection coefficient used (k_y for circular, α for rectangular). */
  deflectionCoefficient: number;
  /** Governing length in the formulas (mm): radius a (circular) / short side b (rectangular). */
  characteristicLength_mm: number;
  formula_sigma: string;
  formula_y: string;
  /** Numeric-only inputs, ready to drop into a dispatcher's Record<string,number>. */
  inputs: Record<string, number>;
  extra: Record<string, number>;
  notes: string[];
};

// ─── Edge / radius parsing ────────────────────────────────────────────────────

function normalizeEdge(raw: unknown): Edge | null {
  const s = String(raw ?? 'simply_supported').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'simply_supported' || s === 'simple' || s === 'ss' || s === 'supported' || s === 'pinned' || s === 'simply') return 'simply_supported';
  if (s === 'clamped' || s === 'fixed' || s === 'built_in' || s === 'builtin' || s === 'encastre' || s === 'fixed_fixed') return 'clamped';
  return null;
}

function resolveRadius(args: { a?: number; radius?: number; diameter?: number }): number | null {
  if (args.a !== undefined) return pos(args.a);
  if (args.radius !== undefined) return pos(args.radius);
  if (args.diameter !== undefined) { const d = pos(args.diameter); return d === null ? null : d / 2; }
  return null;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Flat plate under uniform pressure. Circular (radius `a`, or `radius`, or
 * `diameter`) or rectangular (sides `a` and `b`, order-free — the short side is
 * used as b in the formulas), thickness `t`, pressure `q` (MPa), edge condition,
 * and either a `material` name (E from MATERIALS, ν from POISSON_RATIO) or an
 * explicit `E`/`poisson`. Returns the governing max stress, max deflection, the
 * coefficients used, and where the stress peaks.
 */
export function platePressure(args: {
  shape: string;
  /** Circular: radius a (mm). Rectangular: one side (mm). */
  a?: number;
  /** Rectangular: the other side (mm). */
  b?: number;
  /** Circular convenience aliases. */
  radius?: number;
  diameter?: number;
  /** Plate thickness t (mm). */
  thickness: number;
  /** Uniform pressure q (MPa = N/mm²). */
  pressure: number;
  /** 'simply_supported' (default) or 'clamped'/'fixed'. */
  edge?: string;
  /** Material name → E (and ν) — OR supply E / poisson explicitly. */
  material?: string;
  E?: number;
  poisson?: number;
}): Result<PlateBending> {
  const shape = String(args.shape || '').trim().toLowerCase();
  const t = pos(args.thickness);
  const q = pos(args.pressure);
  if (t === null) return bad('plate needs a positive thickness t (mm)');
  if (q === null) return bad('plate needs a positive pressure q (MPa)');

  const edge = normalizeEdge(args.edge);
  if (!edge) return bad(`edge must be "simply_supported" or "clamped" (got "${args.edge}")`);

  // Resolve E (explicit or from the material table) and ν (explicit, per-material, or 0.3).
  let E: number | null = args.E !== undefined ? pos(args.E) : null;
  let nu: number | null = args.poisson !== undefined ? fin(args.poisson) : null;
  const matKey = args.material ? String(args.material).trim().toLowerCase() : '';
  if (matKey) {
    const m = MATERIALS[matKey];
    if (!m) return bad(`unknown material "${args.material}" — known: ${Object.keys(MATERIALS).join(', ')}`);
    if (E === null) E = m.E;
    if (nu === null && POISSON_RATIO[matKey] !== undefined) nu = POISSON_RATIO[matKey];
  }
  if (E === null) return bad('supply a material (for E) or an explicit E (MPa)');
  if (nu === null) nu = 0.3;
  if (!(nu >= 0 && nu < 0.5)) return bad('Poisson ratio ν must be 0 ≤ ν < 0.5');

  if (shape === 'circular' || shape === 'circle') {
    return circularPlate({ a: resolveRadius(args), t, q, E, nu, edge, matKey });
  }
  if (shape === 'rectangular' || shape === 'rectangle' || shape === 'rect') {
    return rectangularPlate({ a: pos(args.a), b: pos(args.b), t, q, E, nu, edge, matKey });
  }
  return bad(`shape must be "circular" or "rectangular" (got "${args.shape}")`);
}

// ─── Circular plate (exact ν-dependent Roark coefficients, Table 11.2) ────────

function circularPlate(p: { a: number | null; t: number; q: number; E: number; nu: number; edge: Edge; matKey: string }): Result<PlateBending> {
  const { a, t, q, E, nu, edge, matKey } = p;
  if (a === null) return bad('circular plate needs a positive radius a (or diameter)');
  const clamped = edge === 'clamped';
  const aOverT = a / t;

  // Roark Table 11.2, uniform load over the whole plate:
  //   clamped: σ_r(edge)   = 0.75·q(a/t)²  [MAX];  σ(centre) = (3/8)(1+ν)·q(a/t)²
  //            y(centre)   = 3·q·a⁴(1−ν²)/(16·E·t³)
  //   simple:  σ(centre)   = (3/8)(3+ν)·q(a/t)²  [MAX];  σ_r(edge) = 0 (free rotation)
  //            y(centre)   = 3·q·a⁴(1−ν)(5+ν)/(16·E·t³)
  const kSigmaEdge = clamped ? 0.75 : 0;
  const kSigmaCenter = clamped ? (3 / 8) * (1 + nu) : (3 / 8) * (3 + nu);
  const kSigmaMax = clamped ? kSigmaEdge : kSigmaCenter;
  const sigmaLocation: 'center' | 'edge' = clamped ? 'edge' : 'center';
  const kY = clamped ? (3 * (1 - nu * nu)) / 16 : (3 * (1 - nu) * (5 + nu)) / 16;

  const sig = (k: number): number => k * q * aOverT * aOverT;
  const sigmaMax = sig(kSigmaMax);
  const yMax = (kY * q * a ** 4) / (E * t ** 3);
  const D = (E * t ** 3) / (12 * (1 - nu * nu));

  return ok({
    shape: 'circular', edge, material: matKey || null,
    quantityLabel: `circular plate (${edge}) max bending stress`,
    unit: 'MPa',
    sigmaMax_MPa: r(sigmaMax, 4), sigmaLocation,
    yMax_mm: r(yMax, 6),
    stressCoefficient: r(kSigmaMax, 5), deflectionCoefficient: r(kY, 5),
    characteristicLength_mm: r(a, 4),
    formula_sigma: clamped
      ? 'σ_max = 0.75·q·(a/t)²  (radial, at the edge)'
      : 'σ_max = (3/8)(3+ν)·q·(a/t)²  (at the centre)',
    formula_y: clamped
      ? 'y_max = 3·q·a⁴·(1−ν²)/(16·E·t³)  (centre)'
      : 'y_max = 3·q·a⁴·(1−ν)(5+ν)/(16·E·t³)  (centre)',
    inputs: { radius_mm: r(a, 4), thickness_mm: r(t, 4), pressure_MPa: r(q, 6), E_MPa: r(E), poisson: r(nu, 4) },
    extra: {
      sigma_max_MPa: r(sigmaMax, 4),
      sigma_center_MPa: r(sig(kSigmaCenter), 4),
      sigma_edge_MPa: r(sig(kSigmaEdge), 4),
      y_max_mm: r(yMax, 6),
      a_over_t: r(aOverT, 4),
      k_sigma: r(kSigmaMax, 5),
      k_y: r(kY, 5),
      flexural_rigidity_D_Nmm: r(D, 3),
    },
    notes: [
      `Circular plate, ${clamped ? 'clamped (built-in)' : 'simply-supported'} edge, uniform pressure q.`,
      clamped
        ? `Max stress is RADIAL at the EDGE (k_σ=0.75); the centre is lower (k_σ=${r((3 / 8) * (1 + nu), 4)}). Clamping is stiffer but concentrates edge stress.`
        : `Max stress is at the CENTRE (k_σ=${r(kSigmaCenter, 4)}); the rim carries no radial moment, so it deflects much more (~4×) than a clamped plate of the same size.`,
      `a/t = ${r(aOverT, 3)}${aOverT < 10 ? ' — thin-plate (Kirchhoff) theory assumes a/t ≳ 10; treat as APPROXIMATE (transverse shear matters)' : ' (thin-plate/Kirchhoff regime).'}`,
      'Roark & Young, Formulas for Stress and Strain, Table 11.2 (circular plate, uniform load).',
    ],
  });
}

// ─── Rectangular plate (hard-coded Roark β/α table, Table 11.4) ───────────────

function rectangularPlate(p: { a: number | null; b: number | null; t: number; q: number; E: number; nu: number; edge: Edge; matKey: string }): Result<PlateBending> {
  const { a, b, t, q, E, nu, edge, matKey } = p;
  if (a === null || b === null) return bad('rectangular plate needs positive side lengths a and b (mm)');
  const long = Math.max(a, b);
  const short = Math.min(a, b); // b in the formulas is the SHORT side
  const ar = long / short; // a/b ≥ 1
  const coeff = rectCoefficients(edge, ar);
  if (!coeff.ok) return bad(coeff.error);
  const { beta, alpha, betaCenter } = coeff.value;
  const clamped = edge === 'clamped';

  const sigmaMax = (beta * q * short * short) / (t * t);
  const sigmaCenter = (betaCenter * q * short * short) / (t * t);
  const yMax = (alpha * q * short ** 4) / (E * t ** 3);
  const D = (E * t ** 3) / (12 * (1 - nu * nu));
  const sigmaLocation: 'center' | 'edge' = clamped ? 'edge' : 'center';
  const nuOffTable = Math.abs(nu - 0.3) > 1e-9;

  return ok({
    shape: 'rectangular', edge, material: matKey || null,
    quantityLabel: `rectangular plate (${edge}, a/b=${r(ar, 3)}) max bending stress`,
    unit: 'MPa',
    sigmaMax_MPa: r(sigmaMax, 4), sigmaLocation,
    yMax_mm: r(yMax, 6),
    stressCoefficient: r(beta, 5), deflectionCoefficient: r(alpha, 5),
    characteristicLength_mm: r(short, 4),
    formula_sigma: 'σ_max = β·q·b²/t²  (b = short side)',
    formula_y: 'y_max = α·q·b⁴/(E·t³)  (b = short side)',
    inputs: { long_side_mm: r(long, 4), short_side_mm: r(short, 4), aspect_ratio: r(ar, 4), thickness_mm: r(t, 4), pressure_MPa: r(q, 6), E_MPa: r(E), poisson: r(nu, 4) },
    extra: {
      sigma_max_MPa: r(sigmaMax, 4),
      sigma_center_MPa: r(sigmaCenter, 4),
      y_max_mm: r(yMax, 6),
      aspect_ratio: r(ar, 4),
      beta: r(beta, 5),
      alpha: r(alpha, 5),
      beta_center: r(betaCenter, 5),
      short_side_mm: r(short, 4),
      long_side_mm: r(long, 4),
      flexural_rigidity_D_Nmm: r(D, 3),
    },
    notes: [
      `Rectangular plate ${r(long, 2)}×${r(short, 2)} mm (a/b=${r(ar, 3)}), ${clamped ? 'all edges clamped' : 'all edges simply-supported'}, uniform pressure.`,
      clamped
        ? `Max stress is at the CENTRE OF THE LONG EDGE (β=${r(beta, 4)}); the plate centre is lower (β=${r(betaCenter, 4)}). Clamping deflects far less than simple support.`
        : `Max stress is at the plate CENTRE (β=${r(beta, 4)}); simply-supported edges carry no normal moment.`,
      `Roark's β,α are tabulated at ν=0.3${nuOffTable ? ` — your ν=${r(nu, 3)} is used only for the flexural rigidity D; the β,α themselves are the ν=0.3 standard values` : ''}.`,
      `As a/b→∞ the plate → a 1-D beam strip (β→${clamped ? '0.5' : '0.75'}, the ${clamped ? 'fixed-fixed' : 'simply-supported'} beam-strip value).`,
      'Roark & Young, Formulas for Stress and Strain, Table 11.4 (rectangular plate, uniform load).',
    ],
  });
}
