/**
 * engineeringThickCylinderCore — THICK-WALLED CYLINDERS (Lamé) and INTERFERENCE
 * (press / shrink) FITS. When a bore's wall is no longer "thin" (r/t < 10) the
 * hoop stress is NOT uniform across the wall — it is largest at the bore and
 * falls off toward the outer surface — so the single-number thin-wall estimate
 * σ = p·r/t is wrong. This core is the exact GENERAL case: Gabriel Lamé's 1833
 * elasticity solution for a cylinder under internal and/or external pressure.
 *
 * LAMÉ'S SOLUTION — TWO CONSTANTS, TWO STRESSES. Equilibrium + compatibility for
 * an axisymmetric pressurized cylinder collapses to two constants A and B, from
 * which the radial and hoop (circumferential) stresses at any radius r are
 *   σr(r) = A − B/r²     (radial,  −p at a pressurized surface)
 *   σθ(r) = A + B/r²     (hoop,    the one that splits the wall open)
 * with, for internal pressure pi and external pressure po between ri and ro,
 *   A = (pi·ri² − po·ro²) / (ro² − ri²)
 *   B = (pi − po)·ri²·ro² / (ro² − ri²).
 * The hoop stress is MAX at the bore (r = ri) and the radial stress there is
 * exactly −pi — a boundary condition the pressure itself imposes, not an
 * approximation. At a free outer surface (po = 0) the radial stress is exactly 0.
 * These two exact anchors (σr(ri) = −pi, σr(ro) = −po) are what pin the solution.
 *
 * THE INVARIANT. Because σr and σθ differ only by the SIGN of the B/r² term,
 * their sum σr + σθ = 2A is CONSTANT — independent of radius. (Physically 2A is
 * twice the axial stress of a capped cylinder; mathematically it is the trace of
 * the in-plane stress, invariant under the equilibrium field.) Checking σr + σθ
 * = 2A at several radii is a free self-consistency proof of the whole field.
 *
 * THIN-WALL DEGENERATION — REPRODUCING THE pressure_vessel LANE. As the wall
 * thins (t = ro − ri → 0) the exact bore hoop σθ,bore = pi·(ro²+ri²)/(ro²−ri²)
 * collapses to the elementary pi·r/t: ro²−ri² = (ro−ri)(ro+ri) = t·(ro+ri) ≈ 2rt
 * and ro²+ri² ≈ 2r², so σθ,bore → pi·2r²/(2rt) = pi·r/t. So the thick formula is
 * the parent whose thin limit is exactly the `engineering.calc` pressure_vessel
 * hoop stress — the smoke pins that they agree to a fraction of a percent for a
 * thin cylinder, which proves the thick core degenerates correctly.
 *
 * PRESS / SHRINK FITS — AN INTERFERENCE BECOMES A PRESSURE, A PRESSURE A TORQUE.
 * Force a shaft slightly larger than its hole (a diametral interference δ, the
 * very quantity the ISO-286 iso_fit lane reports for an interference fit such as
 * H7/s6) and the two members squeeze at a CONTACT PRESSURE p. The classic
 * thick-cylinder (Lamé) fit relation, with hub (outer) E_o/ν_o and shaft (inner)
 * E_i/ν_i, ties the RADIAL interference δr = δ/2 to that pressure:
 *   δr = p·rc·[ (1/E_o)((ro²+rc²)/(ro²−rc²) + ν_o) + (1/E_i)((rc²+ri²)/(rc²−ri²) − ν_i) ]
 * (Shigley/Budynas–Nisbett, "Mechanical Engineering Design", interference fits;
 * Roark's Formulas, Ch. 13). Inverting gives p. That p is then just an INTERNAL
 * pressure on the hub and an EXTERNAL pressure on the shaft, so the very same
 * Lamé engine above returns the hub's bore hoop (tensile, the stress that can
 * split a hub) and the shaft's surface stress (compressive). Finally the pressure
 * clamps the interface with friction: the fit transmits a holding torque
 *   T = μ · p · (2π·rc·L) · rc = μ·p·2π·rc²·L
 * (friction force μ·p·area acting at radius rc), and resists an axial push-out
 * force μ·p·2π·rc·L. So one interference fit COMPOSES three lanes: iso_fit (the δ),
 * thick-cylinder Lamé (the stresses), and shaft_torsion (the deliverable torque).
 *
 * SIGN / UNIT CONVENTION. Stresses are SIGNED (tension +, compression −) and work
 * in the mm/N/MPa set of engineeringCalcCore (pressure MPa = N/mm², radii mm,
 * torque N·mm). Pressures are non-negative magnitudes. Poisson's ratio is not in
 * the MATERIALS table, so ν defaults to 0.3 (steel) and may be given per member.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-thick-cylinder-core-smoketest.ts):
 * the smoke IS the proof — exact boundary conditions (σr = −pi at the bore, 0 at a
 * free surface), the σr+σθ = 2A invariant at several radii, the thin-wall limit
 * reproducing the pressure_vessel lane, and hand-computed textbook Lamé and
 * shrink-fit cases are all asserted directly.
 */

import { MATERIALS } from './engineeringCalcCore';

export type ThickCylResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Strictly-positive finite. */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Signed finite. */
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Non-negative finite (pressures, a solid-shaft bore radius of 0). */
function nonneg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
/** Rounding helper for display parity. */
function r(x: number, digits = 4): number { if (!Number.isFinite(x)) return x; const f = Math.pow(10, digits); return Math.round(x * f) / f; }

// ─── Lamé engine (shared by thickCylinder and pressFit) ──────────────────────

/** Lamé constants A, B for a cylinder ri..ro under internal pi and external po (MPa). */
function lameConstants(ri: number, ro: number, pi: number, po: number): { A: number; B: number } {
  const denom = ro * ro - ri * ri;
  const A = (pi * ri * ri - po * ro * ro) / denom;
  const B = ((pi - po) * ri * ri * ro * ro) / denom;
  return { A, B };
}

/** Radial + hoop stress at radius rr from Lamé constants (B = 0 ⇒ uniform field). */
function lameAt(A: number, B: number, rr: number): { sr: number; sth: number } {
  const term = B === 0 ? 0 : B / (rr * rr); // solid member has B = 0 ⇒ uniform A even at r = 0
  return { sr: A - term, sth: A + term };
}

/** von Mises equivalent stress from three principal stresses. */
function vonMises3(s1: number, s2: number, s3: number): number {
  return Math.sqrt(0.5 * ((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2));
}

// ─── Thick-walled cylinder (Lamé) ────────────────────────────────────────────

export type ThickCylinderSpec = {
  innerRadius?: number; innerDiameter?: number; // ri (bore)
  outerRadius?: number; outerDiameter?: number; // ro
  internalPressure?: number; externalPressure?: number; // pi, po (MPa, ≥ 0)
  /** Capped (closed) ends ⇒ axial σz = A (default). Open ends ⇒ σz = 0. */
  closedEnds?: boolean;
};

export type ThickCylinderResult = {
  lameA: number;                // A (MPa) — also the capped-end axial stress
  lameB: number;                // B (MPa·mm²)
  hoopStressBore: number;       // σθ(ri) — MAX hoop, MPa
  radialStressBore: number;     // σr(ri) = −pi (exact), MPa
  hoopStressOuter: number;      // σθ(ro), MPa
  radialStressOuter: number;    // σr(ro) = −po (= 0 for a free surface), MPa
  maxShearBore: number;         // (σθ − σr)/2 at the bore = pi·ro²/(ro²−ri²), MPa
  invariantSum2A: number;       // σθ + σr = 2A (constant with r), MPa
  axialStress: number;          // σz: capped → A, open → 0, MPa
  vonMisesBore: number;         // 3D von Mises at the bore (uses axialStress), MPa
  thinWallHoopApprox: number;   // pressure_vessel reference pi·ri/t (thin-wall lane), MPa
  radiusRatioRoRi: number;      // ro/ri
  closedEnds: boolean;
};

function resolveGeom(spec: ThickCylinderSpec): { ok: true; ri: number; ro: number } | { ok: false; error: string } {
  let ri = spec.innerRadius !== undefined ? pos(spec.innerRadius) : null;
  if (ri === null && spec.innerDiameter !== undefined) { const d = pos(spec.innerDiameter); if (d !== null) ri = d / 2; }
  let ro = spec.outerRadius !== undefined ? pos(spec.outerRadius) : null;
  if (ro === null && spec.outerDiameter !== undefined) { const d = pos(spec.outerDiameter); if (d !== null) ro = d / 2; }
  if (ri === null || ro === null) return { ok: false, error: 'thick cylinder needs a positive inner radius/diameter and outer radius/diameter (mm)' };
  if (ro <= ri) return { ok: false, error: `outer radius (${ro} mm) must exceed inner radius (${ri} mm)` };
  return { ok: true, ri, ro };
}

function resolvePressures(spec: ThickCylinderSpec): { ok: true; pi: number; po: number } | { ok: false; error: string } {
  const pi = spec.internalPressure !== undefined ? nonneg(spec.internalPressure) : 0;
  const po = spec.externalPressure !== undefined ? nonneg(spec.externalPressure) : 0;
  if (pi === null || po === null) return { ok: false, error: 'internal/external pressure must be finite and ≥ 0 (MPa)' };
  return { ok: true, pi, po };
}

/**
 * Lamé thick-walled-cylinder stresses. Reports σr and σθ at the bore (r=ri, where
 * hoop is max and σr = −pi) and at the outer surface (σr = −po), the bore max
 * shear, the σr+σθ = 2A invariant, and the 3D von Mises at the bore (capped ends
 * by default, σz = A). Also returns the thin-wall pi·ri/t reference so the caller
 * can see how far into thick-wall territory the geometry is.
 */
export function thickCylinder(spec: ThickCylinderSpec): ThickCylResult<ThickCylinderResult> {
  const g = resolveGeom(spec);
  if (!g.ok) return { ok: false, error: g.error };
  const pr = resolvePressures(spec);
  if (!pr.ok) return { ok: false, error: pr.error };
  const { ri, ro } = g;
  const { pi, po } = pr;
  const { A, B } = lameConstants(ri, ro, pi, po);
  const bore = lameAt(A, B, ri);
  const outer = lameAt(A, B, ro);
  const maxShearBore = (bore.sth - bore.sr) / 2;
  const closedEnds = spec.closedEnds !== false; // default capped
  const axialStress = closedEnds ? A : 0;        // capped-end axial equals the Lamé constant A
  const vm = vonMises3(bore.sth, axialStress, bore.sr);
  const t = ro - ri;
  const thinWall = (pi * ri) / t; // matches engineering.calc pressure_vessel (inner radius, internal pressure)
  return {
    ok: true,
    value: {
      lameA: r(A), lameB: r(B),
      hoopStressBore: r(bore.sth), radialStressBore: r(bore.sr),
      hoopStressOuter: r(outer.sth), radialStressOuter: r(outer.sr),
      maxShearBore: r(maxShearBore),
      invariantSum2A: r(2 * A),
      axialStress: r(axialStress),
      vonMisesBore: r(vm),
      thinWallHoopApprox: r(thinWall),
      radiusRatioRoRi: r(ro / ri),
      closedEnds,
    },
  };
}

/**
 * Radial + hoop stress at ONE radius inside the wall (ri ≤ r ≤ ro). Exposes the
 * raw Lamé field so a caller can plot the through-wall distribution and verify the
 * σr + σθ = 2A invariant directly at several radii.
 */
export function thickCylinderStressAt(
  spec: ThickCylinderSpec,
  radius: number,
): ThickCylResult<{ radius: number; radialStress: number; hoopStress: number; sumSigma: number }> {
  const g = resolveGeom(spec);
  if (!g.ok) return { ok: false, error: g.error };
  const pr = resolvePressures(spec);
  if (!pr.ok) return { ok: false, error: pr.error };
  const { ri, ro } = g;
  const rr = pos(radius);
  if (rr === null) return { ok: false, error: 'radius must be positive (mm)' };
  if (rr < ri - 1e-9 || rr > ro + 1e-9) return { ok: false, error: `radius ${radius} mm is outside the wall [${ri}, ${ro}] mm` };
  const { A, B } = lameConstants(ri, ro, pr.pi, pr.po);
  const s = lameAt(A, B, rr);
  return { ok: true, value: { radius: r(rr), radialStress: r(s.sr), hoopStress: r(s.sth), sumSigma: r(s.sr + s.sth) } };
}

// ─── Interference (press / shrink) fit ───────────────────────────────────────

export type PressFitSpec = {
  interfaceRadius?: number; interfaceDiameter?: number; // rc / Dc (nominal fit surface)
  outerRadius?: number; outerDiameter?: number;         // ro / Do (hub outer)
  innerRadius?: number; innerDiameter?: number;         // ri / Di (shaft bore; omit ⇒ solid shaft, ri=0)
  /** Interference in mm; DIAMETRAL by default (as an iso_fit fit gives). */
  interference?: number;
  /** Interference in µm (÷1000 → mm). */
  interference_um?: number;
  /** Is the supplied interference diametral (default true) or radial (false)? */
  diametral?: boolean;
  // Materials — per member, or one `material`/`E`/`nu` for both.
  hubMaterial?: string; shaftMaterial?: string; material?: string;
  E_hub?: number; E_shaft?: number;
  nu_hub?: number; nu_shaft?: number; nu?: number;
  // Friction / holding torque.
  frictionCoefficient?: number; // µ (default 0.15 when an engagement length is given)
  length?: number;              // L — interface engagement length, mm
};

export type PressFitResult = {
  contactPressure: number;        // p at the interface, MPa
  radialInterference: number;     // δr used in the fit relation, mm
  diametralInterference: number;  // δ (diametral), mm
  interfaceDiameter: number;      // 2·rc, mm
  hubBoreHoop: number;            // σθ hub at rc (tensile — the hub-splitting stress), MPa
  hubOuterHoop: number;           // σθ hub at ro, MPa
  shaftInterfaceHoop: number;     // σθ shaft at rc (compressive), MPa
  shaftBoreHoop: number;          // σθ shaft at its bore ri (solid ⇒ −p), MPa
  hubRadialExpansion: number;     // outward growth of the hub bore at rc, mm (+)
  shaftRadialContraction: number; // inward shrink of the shaft surface at rc, mm (+ magnitude)
  holdingTorque_Nmm: number | null; // T = µ·p·2π·rc²·L
  holdingTorque_Nm: number | null;
  axialHoldingForce_N: number | null; // push-out resistance = µ·p·2π·rc·L
  frictionCoefficient: number | null;
  engagementLength: number | null;
  E_hub: number; nu_hub: number; E_shaft: number; nu_shaft: number;
};

function resolveE(explicit: number | undefined, mat: string | undefined, fallbackMat: string | undefined): number | null {
  if (explicit !== undefined) return pos(explicit);
  const name = mat ?? fallbackMat;
  if (name) { const m = MATERIALS[String(name).trim().toLowerCase()]; if (m) return m.E; }
  return null;
}

function resolveNu(explicit: number | undefined, fallback: number | undefined): { ok: true; nu: number } | { ok: false; error: string } {
  const v = explicit ?? fallback ?? 0.3; // MATERIALS has no Poisson ratio → default steel 0.3
  const n = fin(v);
  if (n === null || n < 0 || n >= 0.5) return { ok: false, error: `Poisson ratio must be in [0, 0.5) (got ${v})` };
  return { ok: true, nu: n };
}

/**
 * Interference (press / shrink) fit between an outer hub (interface rc, outer ro)
 * and an inner shaft/cylinder (bore ri, interface rc; omit ri ⇒ solid shaft). Given
 * the DIAMETRAL interference δ (mm or µm — the quantity an iso_fit interference fit
 * yields), returns the contact pressure p, the hub bore hoop and shaft surface
 * stresses (both via the same Lamé engine as thickCylinder), the radial split of
 * the interference (hub grows + shaft shrinks = δ/2), and the friction holding
 * torque T = µ·p·2π·rc²·L (with the axial push-out force) when µ and L are given.
 */
export function pressFit(spec: PressFitSpec): ThickCylResult<PressFitResult> {
  // Geometry: rc (interface), ro (hub outer), ri (shaft bore, default solid = 0).
  let rc = spec.interfaceRadius !== undefined ? pos(spec.interfaceRadius) : null;
  if (rc === null && spec.interfaceDiameter !== undefined) { const d = pos(spec.interfaceDiameter); if (d !== null) rc = d / 2; }
  let ro = spec.outerRadius !== undefined ? pos(spec.outerRadius) : null;
  if (ro === null && spec.outerDiameter !== undefined) { const d = pos(spec.outerDiameter); if (d !== null) ro = d / 2; }
  let ri = 0;
  if (spec.innerRadius !== undefined) { const v = nonneg(spec.innerRadius); if (v === null) return { ok: false, error: 'shaft innerRadius must be finite and ≥ 0 (mm)' }; ri = v; }
  else if (spec.innerDiameter !== undefined) { const d = nonneg(spec.innerDiameter); if (d === null) return { ok: false, error: 'shaft innerDiameter must be finite and ≥ 0 (mm)' }; ri = d / 2; }
  if (rc === null || ro === null) return { ok: false, error: 'press fit needs an interfaceRadius/Diameter and an outerRadius/Diameter (mm)' };
  if (!(rc > ri)) return { ok: false, error: `interface radius (${rc} mm) must exceed the shaft bore radius (${ri} mm)` };
  if (!(ro > rc)) return { ok: false, error: `hub outer radius (${ro} mm) must exceed the interface radius (${rc} mm)` };

  // Interference (diametral by default) → radial interference δr.
  let dInput: number | null = null;
  if (spec.interference !== undefined) dInput = pos(spec.interference);
  else if (spec.interference_um !== undefined) { const u = pos(spec.interference_um); if (u !== null) dInput = u / 1000; }
  if (dInput === null) return { ok: false, error: 'press fit needs a positive interference (mm) or interference_um (µm)' };
  const diametral = spec.diametral !== false; // default true
  const deltaD = diametral ? dInput : dInput * 2;
  const deltaR = diametral ? dInput / 2 : dInput;

  // Materials.
  const Eo = resolveE(spec.E_hub, spec.hubMaterial, spec.material);
  const Ei = resolveE(spec.E_shaft, spec.shaftMaterial, spec.material);
  if (Eo === null) return { ok: false, error: 'press fit needs a hub E (E_hub) or hubMaterial/material for the modulus (MPa)' };
  if (Ei === null) return { ok: false, error: 'press fit needs a shaft E (E_shaft) or shaftMaterial/material for the modulus (MPa)' };
  const nuO = resolveNu(spec.nu_hub, spec.nu);
  if (!nuO.ok) return { ok: false, error: `hub ${nuO.error}` };
  const nuI = resolveNu(spec.nu_shaft, spec.nu);
  if (!nuI.ok) return { ok: false, error: `shaft ${nuI.error}` };

  // Lamé interference-fit relation → contact pressure.
  //   δr = p·rc·[ Co + Ci ],  Co = (1/Eo)((ro²+rc²)/(ro²−rc²) + νo),  Ci = (1/Ei)((rc²+ri²)/(rc²−ri²) − νi)
  const Co = (1 / Eo) * ((ro * ro + rc * rc) / (ro * ro - rc * rc) + nuO.nu);
  const Ci = (1 / Ei) * ((rc * rc + ri * ri) / (rc * rc - ri * ri) - nuI.nu);
  const compliance = rc * (Co + Ci);
  if (!(compliance > 0)) return { ok: false, error: 'degenerate fit compliance (check radii and Poisson ratios)' };
  const p = deltaR / compliance;

  // Split of the radial interference: hub grows outward, shaft shrinks inward (sum = δr).
  const hubExpansion = p * rc * Co;
  const shaftContraction = p * rc * Ci;

  // Member stresses reuse the SAME Lamé engine: hub sees internal p, shaft sees external p.
  const hub = lameConstants(rc, ro, p, 0);
  const hubBore = lameAt(hub.A, hub.B, rc);
  const hubOuter = lameAt(hub.A, hub.B, ro);
  const shaft = lameConstants(ri, rc, 0, p);
  const shaftInterface = lameAt(shaft.A, shaft.B, rc);
  const shaftBoreHoop = ri === 0 ? shaft.A : lameAt(shaft.A, shaft.B, ri).sth; // solid ⇒ uniform A = −p

  // Holding torque + axial push-out (friction clamp), when an engagement length is given.
  const L = spec.length !== undefined ? pos(spec.length) : null;
  const mu = spec.frictionCoefficient !== undefined ? pos(spec.frictionCoefficient) : 0.15;
  let torqueNmm: number | null = null;
  let axialForce: number | null = null;
  let muUsed: number | null = null;
  let lengthUsed: number | null = null;
  if (L !== null && mu !== null) {
    const area = 2 * Math.PI * rc * L;      // interface contact area
    axialForce = mu * p * area;             // push-out resistance
    torqueNmm = axialForce * rc;            // friction force × radius
    muUsed = mu;
    lengthUsed = L;
  }

  return {
    ok: true,
    value: {
      contactPressure: r(p),
      radialInterference: r(deltaR, 6),
      diametralInterference: r(deltaD, 6),
      interfaceDiameter: r(2 * rc),
      hubBoreHoop: r(hubBore.sth),
      hubOuterHoop: r(hubOuter.sth),
      shaftInterfaceHoop: r(shaftInterface.sth),
      shaftBoreHoop: r(shaftBoreHoop),
      hubRadialExpansion: r(hubExpansion, 6),
      shaftRadialContraction: r(shaftContraction, 6),
      holdingTorque_Nmm: torqueNmm === null ? null : r(torqueNmm),
      holdingTorque_Nm: torqueNmm === null ? null : r(torqueNmm / 1000),
      axialHoldingForce_N: axialForce === null ? null : r(axialForce),
      frictionCoefficient: muUsed,
      engagementLength: lengthUsed,
      E_hub: Eo, nu_hub: nuO.nu, E_shaft: Ei, nu_shaft: nuI.nu,
    },
  };
}
