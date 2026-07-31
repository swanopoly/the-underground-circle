/**
 * engineeringStressCore — COMBINED & PRINCIPAL STRESS: Mohr's circle and the
 * von Mises yield criterion. A real part almost never sees a single pure stress:
 * a loaded shaft carries bending AND torsion at once, a pressure-vessel nozzle
 * has hoop AND axial AND shear together. This core takes a general 2D (plane)
 * stress state {σx, σy, τxy} and answers the three questions that decide whether
 * the part lives — what are the PRINCIPAL stresses (the extreme normal stresses,
 * on the plane where shear vanishes), what is the MAXIMUM SHEAR, and what single
 * EQUIVALENT stress do you compare against a one-number yield strength?
 *
 * MOHR'S CIRCLE — THE WHOLE 2D THEORY IN ONE PICTURE. Rotate the axes of a stress
 * element and its (normal, shear) = (σ, τ) components trace a circle in the (σ, τ)
 * plane. The centre sits on the σ-axis at the average normal stress (σx+σy)/2, and
 * the radius R = √(((σx−σy)/2)² + τxy²) IS the maximum in-plane shear. The
 * principal stresses are simply where the circle crosses the σ-axis (τ = 0):
 * σ1 = centre + R, σ2 = centre − R (σ1 ≥ σ2). The principal plane is at
 * θp = ½·atan2(2τxy, σx−σy). Every other quantity is a reading off that circle,
 * which is why the invariants are so clean: σ1 + σ2 = σx + σy (the centre is
 * fixed under rotation) and σ1·σ2 = σxσy − τxy² (the stress-tensor determinant).
 *
 * MAX SHEAR IN 3D — THE OUT-OF-PLANE TRAP. The in-plane max shear is R, but a
 * plane-stress element still has a THIRD principal stress, σ3 = 0, out of plane.
 * The absolute maximum shear is (σmax − σmin)/2 over ALL THREE of {σ1, σ2, 0}.
 * When σ1 and σ2 share a sign (both tensile or both compressive), zero becomes the
 * true minimum (or maximum), so the governing shear is (σ1−0)/2 or (0−σ2)/2 —
 * LARGER than the in-plane R. Ignoring σ3 = 0 under-predicts the shear that
 * actually yields the part, so this core reports BOTH and flags which one governs.
 *
 * VON MISES — ONE NUMBER, TWO FORMULAS THAT MUST AGREE. The distortion-energy
 * (von Mises) equivalent stress collapses a multiaxial state to a single number
 * comparable with the uniaxial yield. From components it is
 * σ_vm = √(σx² − σxσy + σy² + 3τxy²); from the principals it is
 * σ_vm = √(σ1² − σ1σ2 + σ2²). These are ALGEBRAICALLY the same expression —
 * substitute the invariants σ1+σ2 = σx+σy and σ1σ2 = σxσy−τxy² into the identity
 * σ1²−σ1σ2+σ2² = (σ1+σ2)² − 3σ1σ2 and the component form falls straight out. So
 * computing σ_vm BOTH ways, through two independent code paths (one directly from
 * the components, one via the Mohr's-circle σ1/σ2), and demanding they agree is a
 * genuine self-check: a wrong principal solution or a dropped term would make the
 * two disagree. Safety factor against yield is n = σ_yield / σ_vm.
 *
 * IMPORTANT: stresses are SIGNED (tension +, compression −). Every stress input is
 * validated with a FINITE check, never a positive-only guard — a −150 MPa
 * compressive stress is perfectly valid input. Only the yield strength must be
 * positive (a strength is a magnitude).
 *
 * Works in MPa (= N/mm²), consistent with the mm/N/MPa system of the calc core,
 * and composes engineeringCalcCore's MATERIALS table for the yield → safety factor.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-stress-core-smoketest.ts):
 * the smoke IS the proof — every result is asserted against a hand-computed
 * textbook reference, and the two von Mises formulas cross-check each other.
 */

import { MATERIALS } from './engineeringCalcCore';

export type StressResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Finite check — stresses are SIGNED, so never guard positive-only. */
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Positive check — only for a yield strength (a magnitude). */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }
function r3(n: number): number { return Math.round(n * 1e3) / 1e3; }
const RAD_TO_DEG = 180 / Math.PI;

// ─── Principal stresses (Mohr's circle) ──────────────────────────────────────

export type PrincipalStressResult = {
  sigma1: number;            // major principal stress, MPa (σ1 ≥ σ2)
  sigma2: number;            // minor principal stress, MPa
  tauMaxInPlane: number;     // max in-plane shear = R, MPa
  principalAngleDeg: number; // θp to the σ1 plane, degrees
  center: number;            // Mohr's-circle centre = (σx+σy)/2, MPa
  radius: number;            // Mohr's-circle radius = R, MPa
};

/** Internal: the raw Mohr's-circle solution of a 2D stress state (no validation). */
function mohr(sx: number, sy: number, txy: number): PrincipalStressResult {
  const center = (sx + sy) / 2;
  const radius = Math.hypot((sx - sy) / 2, txy); // √(((σx−σy)/2)² + τxy²)
  const thetaP = 0.5 * Math.atan2(2 * txy, sx - sy) * RAD_TO_DEG;
  return {
    sigma1: r4(center + radius),
    sigma2: r4(center - radius),
    tauMaxInPlane: r4(radius),
    principalAngleDeg: r4(thetaP),
    center: r4(center),
    radius: r4(radius),
  };
}

/**
 * Principal stresses + max in-plane shear of a 2D stress state {σx, σy, τxy}
 * (all signed, MPa) via Mohr's circle. σ1 ≥ σ2, τmax = R, and the principal plane
 * angle θp = ½·atan2(2τxy, σx−σy). Zero and negative stresses are valid inputs.
 */
export function principalStresses(spec: { sigmaX: number; sigmaY: number; tauXY: number }): StressResult<PrincipalStressResult> {
  const sx = fin(spec?.sigmaX), sy = fin(spec?.sigmaY), txy = fin(spec?.tauXY);
  if (sx === null || sy === null || txy === null) return { ok: false, error: 'principalStresses needs finite sigmaX, sigmaY, tauXY (MPa, signed)' };
  return { ok: true, value: mohr(sx, sy, txy) };
}

// ─── von Mises equivalent stress (distortion-energy criterion) ────────────────

export type VonMisesResult = {
  vonMises: number;             // equivalent (distortion-energy) stress, MPa
  method: 'components' | 'principal';
  yieldStrength: number | null; // MPa, if a material/yield was supplied
  safetyFactor: number | null;  // n = σ_yield / σ_vm
};

/**
 * von Mises (distortion-energy) equivalent stress, from EITHER a full component
 * state {σx, σy, τxy} OR a principal pair {σ1, σ2} (components take precedence if
 * both are given). If a `material` (looked up in the calc-core table) or an
 * explicit positive `yield` (MPa) is supplied, also returns the distortion-energy
 * safety factor n = σ_yield / σ_vm.
 *
 * The two forms are the same invariant expressed differently — computing it via
 * components here and via σ1/σ2 (from principalStresses) elsewhere, then checking
 * agreement, is a real independent verification, not a tautology.
 */
export function vonMises(spec: {
  sigmaX?: number; sigmaY?: number; tauXY?: number;
  sigma1?: number; sigma2?: number;
  material?: string; yield?: number;
}): StressResult<VonMisesResult> {
  let vm: number;
  let method: 'components' | 'principal';
  const hasComponents = spec?.sigmaX !== undefined && spec?.sigmaY !== undefined && spec?.tauXY !== undefined;
  const hasPrincipals = spec?.sigma1 !== undefined && spec?.sigma2 !== undefined;
  if (hasComponents) {
    const sx = fin(spec.sigmaX), sy = fin(spec.sigmaY), txy = fin(spec.tauXY);
    if (sx === null || sy === null || txy === null) return { ok: false, error: 'vonMises: sigmaX, sigmaY, tauXY must be finite (MPa, signed)' };
    vm = Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy);
    method = 'components';
  } else if (hasPrincipals) {
    const s1 = fin(spec.sigma1), s2 = fin(spec.sigma2);
    if (s1 === null || s2 === null) return { ok: false, error: 'vonMises: sigma1, sigma2 must be finite (MPa, signed)' };
    vm = Math.sqrt(s1 * s1 - s1 * s2 + s2 * s2);
    method = 'principal';
  } else {
    return { ok: false, error: 'vonMises needs a full {sigmaX,sigmaY,tauXY} state or a {sigma1,sigma2} principal pair' };
  }
  // Optional yield → distortion-energy safety factor.
  let yieldStrength: number | null = null;
  if (spec.yield !== undefined) {
    const y = pos(spec.yield);
    if (y === null) return { ok: false, error: 'vonMises: yield strength must be a positive number (MPa)' };
    yieldStrength = y;
  }
  if (yieldStrength === null && typeof spec.material === 'string' && spec.material.trim()) {
    const m = MATERIALS[spec.material.trim().toLowerCase()];
    if (m) yieldStrength = m.yield;
  }
  const safetyFactor = yieldStrength !== null && vm > 0 ? r3(yieldStrength / vm) : null;
  return { ok: true, value: { vonMises: r4(vm), method, yieldStrength, safetyFactor } };
}

// ─── Maximum shear stress (in-plane vs absolute 3D) ───────────────────────────

export type MaxShearResult = {
  sigma1: number;                // major in-plane principal, MPa
  sigma2: number;                // minor in-plane principal, MPa
  sigma3: number;                // out-of-plane principal (0 for plane stress), MPa
  tauMaxInPlane: number;         // (σ1 − σ2)/2 — the two in-plane principals only
  tauMaxAbsolute: number;        // (σmax − σmin)/2 over {σ1, σ2, σ3}
  governedByOutOfPlane: boolean; // absolute > in-plane (σ1, σ2 share a sign)
};

/**
 * Maximum shear stress, honestly in 3D. Takes EITHER a component state
 * {σx, σy, τxy} (→ Mohr's circle for σ1, σ2) OR a principal pair {σ1, σ2}, plus an
 * optional out-of-plane σ3 (default 0 for plane stress). Returns the in-plane max
 * shear (σ1−σ2)/2 AND the absolute max shear (σmax−σmin)/2 over {σ1,σ2,σ3}, and
 * flags when the out-of-plane σ3 governs — which happens exactly when the two
 * in-plane principals share a sign, so 0 straddles neither and becomes an extreme.
 */
export function maxShearStress(spec: {
  sigmaX?: number; sigmaY?: number; tauXY?: number;
  sigma1?: number; sigma2?: number; sigma3?: number;
}): StressResult<MaxShearResult> {
  let s1: number; let s2: number;
  const hasComponents = spec?.sigmaX !== undefined && spec?.sigmaY !== undefined && spec?.tauXY !== undefined;
  const hasPrincipals = spec?.sigma1 !== undefined && spec?.sigma2 !== undefined;
  if (hasComponents) {
    const sx = fin(spec.sigmaX), sy = fin(spec.sigmaY), txy = fin(spec.tauXY);
    if (sx === null || sy === null || txy === null) return { ok: false, error: 'maxShearStress: sigmaX, sigmaY, tauXY must be finite (MPa, signed)' };
    const p = mohr(sx, sy, txy);
    s1 = p.sigma1; s2 = p.sigma2;
  } else if (hasPrincipals) {
    const a = fin(spec.sigma1), b = fin(spec.sigma2);
    if (a === null || b === null) return { ok: false, error: 'maxShearStress: sigma1, sigma2 must be finite (MPa, signed)' };
    s1 = Math.max(a, b); s2 = Math.min(a, b); // enforce σ1 ≥ σ2 regardless of input order
  } else {
    return { ok: false, error: 'maxShearStress needs a full {sigmaX,sigmaY,tauXY} state or a {sigma1,sigma2} principal pair' };
  }
  const s3 = spec.sigma3 !== undefined ? fin(spec.sigma3) : 0;
  if (s3 === null) return { ok: false, error: 'maxShearStress: sigma3 must be finite (MPa, signed)' };
  const tauInPlane = (s1 - s2) / 2;
  const hi = Math.max(s1, s2, s3), lo = Math.min(s1, s2, s3);
  const tauAbs = (hi - lo) / 2;
  return {
    ok: true,
    value: {
      sigma1: r4(s1), sigma2: r4(s2), sigma3: r4(s3),
      tauMaxInPlane: r4(tauInPlane),
      tauMaxAbsolute: r4(tauAbs),
      governedByOutOfPlane: tauAbs > tauInPlane + 1e-9,
    },
  };
}
