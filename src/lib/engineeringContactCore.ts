/**
 * engineeringContactCore — HERTZIAN CONTACT STRESS: the intense, highly localised
 * stresses that arise where two curved elastic bodies touch under load. This is the
 * physics that governs ball and roller BEARINGS (a ball pressed on a race groove),
 * GEAR teeth (two involute flanks meshing = two cylinders in line contact), CAM and
 * follower (a roller riding a cam), wheels on rails, and any rolling/pressing pair.
 * Those machine elements do not fail by the gross bending/torsion the calc core
 * sizes — they fail at the CONTACT: surface pitting and subsurface spalling driven
 * by a contact pressure that is tens of times higher than the nominal stress
 * elsewhere in the part. This core computes that pressure exactly.
 *
 * THE TWO CONTACT GEOMETRIES.
 *   • POINT contact (a SPHERE on a plane, a ball in a socket, two crossed rollers):
 *     the bodies touch initially at a POINT that flattens under load into a small
 *     CIRCLE of radius a. This is the ball-bearing / ball-on-race case.
 *   • LINE contact (two parallel CYLINDERS, a cylindrical roller on a race, a gear
 *     tooth flank, a cam roller): the bodies touch along a LINE that widens into a
 *     narrow RECTANGLE of half-width b and length L. This is the roller-bearing /
 *     gear-mesh case.
 *
 * THE HERTZ SOLUTION (J. Johnson, "Contact Mechanics", CUP 1985; Shigley,
 * "Mechanical Engineering Design"; Roark's Formulas for Stress & Strain). Two
 * material/geometry combinations collapse into two effective quantities:
 *
 *   effective (reduced) modulus   1/E* = (1−ν₁²)/E₁ + (1−ν₂²)/E₂
 *   effective radius              1/R  = 1/R₁ + 1/R₂
 *
 * With those, for the SPHERE (point):
 *   contact radius   a      = (3·F·R / (4·E*))^(1/3)     [Johnson eq. 3.39]
 *   max pressure     p_max  = 3F / (2π·a²)               (peak of the pressure dome)
 *   mean pressure    p_mean = F / (π·a²)                 (force ÷ circle area)
 *   ⇒ p_max / p_mean = 3/2 = 1.5 EXACTLY                 (a geometry-free anchor)
 *   approach         δ      = a² / R                     (mutual centre approach)
 *
 * and for the CYLINDER (line), with contact length L and load per unit length F/L:
 *   half-width       b      = √(4·F·R / (π·L·E*))
 *   max pressure     p_max  = 2F / (π·b·L)
 *   mean pressure    p_mean = F / (2·b·L)                (force ÷ rectangle area 2bL)
 *   ⇒ p_max / p_mean = 4/π ≈ 1.2732 EXACTLY              (the elliptical-dome anchor)
 *
 * WHY CONTACT STRESSES ARE SO CONCENTRATED. Because the contact patch GROWS with
 * load, the peak pressure rises only SUB-LINEARLY with force: for the sphere
 * p_max ∝ F^(1/3) (double the load and the pressure rises just 2^(1/3)≈26%), and
 * for the cylinder p_max ∝ F^(1/2). The flip side is that even a modest force on a
 * tiny patch produces gigapascal-level pressure — a 1 kN ball contact runs several
 * GPa, an order of magnitude above the material's yield. That is normal and
 * survivable: the contact stress is TRIAXIALLY confined (hydrostatic-like), so the
 * material tolerates p_max well above the uniaxial σ_yield; first yield is a
 * SUBSURFACE von-Mises event near p_max ≈ 1.6·σ_yield, and the practical limit is
 * rolling-contact FATIGUE (pitting/spalling), not gross yield.
 *
 * SIGN CONVENTION FOR THE MATE (R₂). R₂ omitted or +Infinity ⇒ a FLAT (1/R₂ = 0).
 * R₂ > 0 ⇒ a second convex body (two balls, two rollers). R₂ < 0 ⇒ a CONCAVE mate
 * (a ball seated in a hollow race/socket), for which 1/R = 1/R₁ − 1/|R₂|: the
 * conforming curvature enlarges the effective radius, spreads the load over a
 * bigger patch, and LOWERS the peak pressure — exactly why a bearing race groove is
 * ground to almost the ball radius. The overall contact must stay convex, so we
 * require 1/R > 0 (a ball larger than its socket, |R₂| < R₁, is rejected).
 *
 * COMPOSES the rest of the suite: the bearing lane (a ball/roller pressed on a
 * race), the gear lane (tooth flank = cylinder-on-cylinder line contact), and the
 * cam lane (roller-on-cam) all reduce to a Hertz contact. Poisson's ratio ν is not
 * in the calc-core MATERIALS table (which carries E, G, yield, density, α, k), so
 * it is taken as an input, defaulting to 0.3 — representative for metals, whose ν
 * spans ≈0.27–0.34 — and can be overridden per body.
 *
 * Works in the mm / N / MPa system of the calc core (E in MPa, R in mm, F in N ⇒
 * pressures in MPa, a/b/δ in mm).
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-contact-core-smoketest.ts): the
 * smoke IS the proof. The exact 1.5 and 4/π pressure ratios are pinned, a textbook
 * ball/roller case is hand-computed and asserted, the sphere-on-flat result is
 * shown to be the R₂→∞ limit of the sphere-sphere solution, and the F^(1/3) /
 * F^(1/2) signature scaling laws are verified.
 */

import { MATERIALS } from './engineeringCalcCore';

export type ContactResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Strictly-positive finite check (radii, forces, moduli, lengths). */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Signed finite check (a concave mate radius R₂ is a valid NEGATIVE input). */
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Round to `digits` decimals for stable display/parity (default 6, calc-core style). */
function r(x: number, digits = 6): number {
  if (!Number.isFinite(x)) return x;
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

export type ContactMode = 'sphere' | 'cylinder';

export type ContactStressArgs = {
  /** 'sphere' = point contact (ball/socket); 'cylinder' = line contact (roller/gear). */
  mode: ContactMode;
  /** Radius of body 1 (the convex ball/roller), mm, > 0. */
  R1: number;
  /**
   * Radius of the mate. Omitted or Infinity ⇒ flat (1/R₂ = 0); > 0 ⇒ convex;
   * < 0 ⇒ concave (ball in a race/socket, 1/R = 1/R₁ − 1/|R₂|).
   */
  R2?: number;
  /** Normal force pressing the bodies together, N, > 0. */
  force: number;
  /** Contact length L (mm) — REQUIRED for 'cylinder' (line) contact, ignored for 'sphere'. */
  length?: number;

  /** Material name applied to BOTH bodies (looks up E in the calc-core table). */
  material?: string;
  /** Per-body material name (overrides `material` for that body). */
  material1?: string;
  material2?: string;
  /** Explicit Young's modulus, MPa (overrides the material lookup for that body). */
  E1?: number;
  E2?: number;
  /** Poisson's ratio per body; falls back to `nu`, then 0.3 (0 ≤ ν < 0.5). */
  nu1?: number;
  nu2?: number;
  /** Shared Poisson's ratio for both bodies (default 0.3). */
  nu?: number;

  /** Optional yield strength (MPa) OR use the resolved body-1 material — enables the p_max/σ_yield note. */
  yield?: number;
};

export type ContactStressResult = {
  mode: ContactMode;
  /** Maximum (peak) contact pressure, MPa — the headline number. */
  pMax: number;
  /** Mean contact pressure over the patch, MPa. */
  pMean: number;
  /** p_max / p_mean — EXACTLY 1.5 (sphere) or 4/π (cylinder). */
  pMaxOverPMean: number;
  /** Contact dimension: circle radius a (sphere) or half-width b (cylinder), mm. */
  contactDim: number;
  contactDimKind: 'a_radius' | 'b_halfWidth';
  /** Contact patch area (circle πa², or rectangle 2b·L), mm². */
  contactArea: number;
  /** Mutual approach/indentation δ = a²/R (sphere only; null for line contact). */
  approach: number | null;
  /** Effective (reduced) modulus E*, MPa. */
  eStar: number;
  /** Effective radius R, mm. */
  rEff: number;
  /** Yield strength used for the ratio note (MPa), or null. */
  yieldStrength: number | null;
  /** p_max / σ_yield (dimensionless), or null. */
  pMaxOverYield: number | null;
  formula: string;
  notes: string[];
};

/** Resolve one body's (E, ν) from explicit values, a per-body material, or the shared material. */
function resolveBody(
  E: number | undefined,
  nu: number | undefined,
  materialName: string | undefined,
  sharedMaterial: string | undefined,
  sharedNu: number | undefined,
  which: 1 | 2,
): { E: number; nu: number } | { error: string } {
  // Young's modulus: explicit E wins, else material lookup.
  let Eval: number | null = null;
  if (E !== undefined) {
    Eval = pos(E);
    if (Eval === null) return { error: `E${which} must be a positive Young's modulus (MPa)` };
  } else {
    const name = materialName ?? sharedMaterial;
    if (name && String(name).trim()) {
      const m = MATERIALS[String(name).trim().toLowerCase()];
      if (!m) return { error: `unknown material "${name}" for body ${which} — known: ${Object.keys(MATERIALS).join(', ')}` };
      Eval = m.E;
    }
  }
  if (Eval === null) return { error: `body ${which} needs a material or an explicit E${which} (MPa)` };

  // Poisson's ratio: per-body nu, else shared nu, else 0.3 (not in the MATERIALS table).
  let nuVal = 0.3;
  if (nu !== undefined) { const n = fin(nu); if (n === null) return { error: `nu${which} must be finite` }; nuVal = n; }
  else if (sharedNu !== undefined) { const n = fin(sharedNu); if (n === null) return { error: 'nu must be finite' }; nuVal = n; }
  if (!(nuVal >= 0 && nuVal < 0.5)) return { error: `Poisson's ratio for body ${which} must satisfy 0 ≤ ν < 0.5 (got ${nuVal})` };
  return { E: Eval, nu: nuVal };
}

/**
 * Hertzian contact stress for a SPHERE (point contact) or CYLINDER (line contact).
 * Returns the peak/mean pressure, the contact dimension (circle radius a or line
 * half-width b), the effective modulus/radius, and — for the sphere — the mutual
 * approach δ. If a yield strength (explicit or via body-1's material) is supplied,
 * also reports the p_max/σ_yield ratio with a note on contact allowables.
 */
export function contactStress(args: ContactStressArgs): ContactResult<ContactStressResult> {
  const mode = args?.mode;
  if (mode !== 'sphere' && mode !== 'cylinder') return { ok: false, error: "contactStress needs mode 'sphere' (point) or 'cylinder' (line)" };

  const R1 = pos(args?.R1);
  if (R1 === null) return { ok: false, error: 'R1 (the convex ball/roller radius) must be positive (mm)' };
  const F = pos(args?.force);
  if (F === null) return { ok: false, error: 'force must be positive (N)' };

  // Effective radius, honouring the R₂ sign convention (flat / convex / concave).
  let invR2 = 0; // flat by default
  if (args.R2 !== undefined && args.R2 !== Infinity && args.R2 !== -Infinity) {
    const r2 = fin(args.R2);
    if (r2 === null || r2 === 0) return { ok: false, error: 'R2 must be a nonzero number, Infinity (flat), or omitted' };
    invR2 = 1 / r2;
  }
  const invR = 1 / R1 + invR2;
  if (!(invR > 0)) {
    return { ok: false, error: 'contact is not convex overall (1/R ≤ 0): a ball must be smaller than its concave race/socket (|R2| > R1)' };
  }
  const R = 1 / invR;

  // Effective (reduced) modulus from both bodies.
  const b1 = resolveBody(args.E1, args.nu1, args.material1, args.material, args.nu, 1);
  if ('error' in b1) return { ok: false, error: b1.error };
  const b2 = resolveBody(args.E2, args.nu2, args.material2, args.material, args.nu, 2);
  if ('error' in b2) return { ok: false, error: b2.error };
  const invEstar = (1 - b1.nu * b1.nu) / b1.E + (1 - b2.nu * b2.nu) / b2.E;
  const Estar = 1 / invEstar;

  // Optional yield strength for the contact-allowable ratio: explicit wins, else body-1 material.
  let yieldStrength: number | null = null;
  if (args.yield !== undefined) {
    const y = pos(args.yield);
    if (y === null) return { ok: false, error: 'yield strength must be positive (MPa)' };
    yieldStrength = y;
  } else {
    const name = args.material1 ?? args.material;
    if (name && String(name).trim()) { const m = MATERIALS[String(name).trim().toLowerCase()]; if (m) yieldStrength = m.yield; }
  }

  let pMax: number; let pMean: number; let contactDim: number; let contactDimKind: 'a_radius' | 'b_halfWidth';
  let contactArea: number; let approach: number | null; let formula: string;
  const notes: string[] = [];

  if (mode === 'sphere') {
    // Point contact — circular patch of radius a.
    const a = Math.cbrt((3 * F * R) / (4 * Estar)); // (3FR/4E*)^(1/3)
    pMax = (3 * F) / (2 * Math.PI * a * a);
    pMean = F / (Math.PI * a * a);
    approach = (a * a) / R;
    contactDim = a;
    contactDimKind = 'a_radius';
    contactArea = Math.PI * a * a;
    formula = 'a=(3FR/4E*)^(1/3), p_max=3F/(2πa²), p_mean=F/(πa²)=2p_max/3, δ=a²/R';
    notes.push(`Point (sphere) contact: circular patch radius a = ${r(a)} mm. p_max/p_mean = 3/2 exactly. p_max ∝ F^(1/3) — sub-linear in load.`);
  } else {
    // Line contact — needs a contact length L; rectangular patch of half-width b.
    const L = pos(args?.length);
    if (L === null) return { ok: false, error: 'cylinder (line) contact needs a positive contact length (mm)' };
    const bHalf = Math.sqrt((4 * F * R) / (Math.PI * L * Estar));
    pMax = (2 * F) / (Math.PI * bHalf * L);
    pMean = F / (2 * bHalf * L);
    approach = null; // line-contact approach is geometry-dependent (logarithmic) — not reported
    contactDim = bHalf;
    contactDimKind = 'b_halfWidth';
    contactArea = 2 * bHalf * L;
    formula = 'b=√(4FR/(πLE*)), p_max=2F/(πbL), p_mean=F/(2bL)=πp_max/4';
    notes.push(`Line (cylinder) contact over L = ${r(L)} mm: half-width b = ${r(bHalf)} mm. p_max/p_mean = 4/π exactly. p_max ∝ F^(1/2).`);
  }

  const pMaxOverPMean = pMax / pMean; // 1.5 (sphere) or 4/π (cylinder), to machine precision
  let pMaxOverYield: number | null = null;
  if (yieldStrength !== null) {
    pMaxOverYield = pMax / yieldStrength;
    notes.push(
      `p_max = ${r(pMaxOverYield, 2)}× the yield strength (${yieldStrength} MPa). Hertz contact is triaxially confined, so the surface tolerates p_max well above the uniaxial σ_yield: subsurface (von Mises) yield begins near p_max ≈ 1.6·σ_yield, and the usual failure is rolling-contact fatigue — pitting/spalling — not gross yield.`,
    );
  }

  return {
    ok: true,
    value: {
      mode,
      pMax: r(pMax),
      pMean: r(pMean),
      pMaxOverPMean: r(pMaxOverPMean),
      contactDim: r(contactDim),
      contactDimKind,
      contactArea: r(contactArea),
      approach: approach === null ? null : r(approach),
      eStar: r(Estar),
      rEff: r(R),
      yieldStrength,
      pMaxOverYield: pMaxOverYield === null ? null : r(pMaxOverYield, 4),
      formula,
      notes,
    },
  };
}
