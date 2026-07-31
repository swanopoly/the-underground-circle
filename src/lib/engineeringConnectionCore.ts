/**
 * engineeringConnectionCore — CONNECTION DESIGN: the welded and bolted joints
 * that hold a fabricated structure together. A beam, a bracket, a frame is only
 * as strong as the connection at its ends, so this closes the loop from the
 * structural-section / frame lanes (which size the MEMBERS) to the joint that
 * actually transfers the load between them.
 *
 * THE FILLET WELD. A fillet weld is a triangular bead laid in the corner between
 * two plates. Its leg is the size you can see and specify, but the weld does NOT
 * fail across the leg — it fails across its THROAT, the shortest line through the
 * triangle, which for an equal-leg weld is the 45° bisector. Geometry fixes that
 * length exactly: throat a = leg·sin45° = leg/√2 = 0.7071·leg. So the shear
 * capacity is the throat area (a·L) times the allowable shear on the weld metal,
 * V = 0.7071·leg·L·τ_allow. The single most common mistake is to size on the leg
 * and overstate the joint by 41% (1/0.707 − 1); the throat is smaller than the
 * leg and the throat is what carries the load. A weld run "all around" a
 * rectangular attachment simply has length L = 2(w+h). When welding to a code,
 * the allowable shear itself often comes from the electrode: an ASD design uses
 * τ_allow ≈ 0.30·FEXX (E70 → 0.30·482 ≈ 145 MPa).
 *
 * THE BOLTED JOINT — SHEAR. Bolts in a lap joint carry the load in SHEAR across
 * their cross-section. The load is shared equally by the group, so the force per
 * bolt is V/n; a bolt in DOUBLE shear (a plate sandwiched between two) has two
 * shear planes, so the same bolt resists that force across twice the area — it is
 * as if the group had 2n planes. The area that resists shear is the tensile
 * STRESS AREA As (threads intersecting the shear plane), not the nominal π/4·d²:
 * As = (π/4)·((d2+d3)/2)² = (π/4)·(d − 0.9382·p)² using the ISO pitch- and
 * minor-diameters (the mean coefficient 0.9382 = (0.6495+1.2269)/2). For M12
 * coarse (p=1.75) that is the standard 84.3 mm². Without a pitch, the classic
 * As ≈ (π/4)·(0.85·d)² approximation is used. The group is adequate when the
 * total capacity n·planes·τ_allow·As exceeds the applied shear.
 *
 * THE BOLTED JOINT — BEARING. The bolt shank also presses on the side of its
 * hole, and that BEARING stress acts on the PROJECTED area d·t (diameter × plate
 * thickness), never the hole's curved area: σ_bearing = P/(d·t·n). A joint can
 * pass the bolt-shear check and still tear out its plate in bearing, so it is a
 * separate limit state.
 *
 * ECCENTRIC BOLT GROUPS. When the load line misses the group centroid it adds a
 * torsional shear on top of the direct shear. By the elastic (vector) method the
 * direct component P/n acts on every bolt, and the torsional component M·rᵢ/J
 * acts perpendicular to the radius, where J = Σ(xᵢ²+yᵢ²) is the group's polar
 * moment about its centroid. The two vectors superpose, and the CRITICAL bolt is
 * the one where they most nearly align — usually the bolt farthest from the
 * centroid on the loaded side.
 *
 * Every number here is closed-form and unit-consistent in N / mm / MPa (a weld's
 * mm·mm·(N/mm²) = N; a bolt's mm²·(N/mm²) = N; a bearing's N/(mm·mm) = MPa) — so
 * the smoke pins each result against a hand-computed textbook value and the smoke
 * IS the proof. It reuses the verified ISO coarse-pitch table for the stress area.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-connection-core-smoketest.ts):
 * one optional import (the ISO thread lane for coarse pitch), no I/O.
 */

import { coarsePitchFor } from './engineeringThreadCore';

export type ConnectionResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** The 45° effective throat factor of an equal-leg fillet weld: a = leg·sin45° =
 *  leg/√2. Universally quoted as 0.707; this is its exact value. */
export const THROAT_FACTOR = Math.SQRT1_2; // 1/√2 = 0.70710678…

/** Mean of the ISO pitch- and minor-diameter coefficients — the tensile-stress-
 *  area diameter is d − STRESS_AREA_COEFF·p. (0.6495 + 1.2269)/2 = 0.9382. */
export const STRESS_AREA_COEFF = 0.9382;

// ─── Fillet weld ─────────────────────────────────────────────────────────────

export type FilletWeldResult = {
  leg_mm: number;
  throat_mm: number;
  length_mm: number;
  throatArea_mm2: number;
  allowableShear_MPa: number;
  capacity_N: number;
  /** Present only when a load was supplied. */
  load_N: number | null;
  stress_MPa: number | null;
  utilisation: number | null;
  adequate: boolean | null;
};

/**
 * A fillet weld in shear. Length is either explicit or, for a weld all around a
 * rectangular attachment, `perimeter` = {width,height} → L = 2(w+h). The
 * allowable shear on the throat is explicit, or derived from the electrode as
 * `electrodeFactor`·FEXX (default 0.30, the ASD allowable). A supplied `load`
 * adds the throat stress and the utilisation.
 */
export function filletWeld(spec: {
  leg: number;
  length?: number;
  perimeter?: { width: number; height: number };
  allowableShear?: number;
  electrodeStrength?: number;
  electrodeFactor?: number;
  load?: number;
}): ConnectionResult<FilletWeldResult> {
  const leg = pos(spec.leg);
  if (leg === null) return { ok: false, error: 'fillet weld needs a positive leg size (mm)' };

  // effective length: explicit, or the perimeter of a rectangular weld-all-around
  let length = spec.length !== undefined ? pos(spec.length) : null;
  if (length === null && spec.perimeter) {
    const w = pos(spec.perimeter.width), h = pos(spec.perimeter.height);
    if (w === null || h === null) return { ok: false, error: 'perimeter needs positive width and height (mm)' };
    length = 2 * (w + h);
  }
  if (length === null) return { ok: false, error: 'supply a length (mm) or a perimeter {width,height} for a weld all around' };

  // allowable shear on the throat: explicit, or electrodeFactor·FEXX
  let allow = spec.allowableShear !== undefined ? pos(spec.allowableShear) : null;
  if (allow === null && spec.electrodeStrength !== undefined) {
    const fexx = pos(spec.electrodeStrength);
    if (fexx === null) return { ok: false, error: 'electrodeStrength must be positive (MPa)' };
    const factor = pos(spec.electrodeFactor) ?? 0.30;
    allow = factor * fexx;
  }
  if (allow === null) return { ok: false, error: 'supply an allowableShear (MPa) or an electrodeStrength (MPa)' };

  const throat = THROAT_FACTOR * leg;
  const throatArea = throat * length;
  const capacity = throatArea * allow;

  let stress: number | null = null, utilisation: number | null = null, adequate: boolean | null = null;
  const load = spec.load !== undefined ? pos(spec.load) : null;
  if (load !== null) {
    stress = load / throatArea;
    utilisation = load / capacity;
    adequate = load <= capacity;
  }

  return {
    ok: true,
    value: {
      leg_mm: r(leg), throat_mm: r(throat), length_mm: r(length),
      throatArea_mm2: r(throatArea, 2), allowableShear_MPa: r(allow),
      capacity_N: r(capacity, 2),
      load_N: load === null ? null : r(load, 2),
      stress_MPa: stress === null ? null : r(stress),
      utilisation: utilisation === null ? null : r(utilisation),
      adequate,
    },
  };
}

// ─── Bolt group in shear ─────────────────────────────────────────────────────

export type BoltGroupShearResult = {
  boltCount: number;
  planes: number;
  boltDiameter_mm: number | null;
  boltArea_mm2: number;
  areaBasis: string;
  shearLoad_N: number;
  allowableShear_MPa: number;
  /** Force carried per bolt shear plane = V/(n·planes). */
  shearPerBolt_N: number;
  shearStress_MPa: number;
  capacityPerBolt_N: number;
  totalCapacity_N: number;
  safetyFactor: number;
  adequate: boolean;
};

/**
 * A bolt group loaded in shear. Give the shear area directly with `boltArea`
 * (mm²), or a `boltDiameter` (mm) and it is taken as the tensile stress area:
 * (π/4)·(d − 0.9382·p)² using the coarse pitch for a standard M-size (or an
 * explicit `pitch`), else the (π/4)·(0.85d)² approximation. `planes` = 1 single
 * shear (default) or 2 double shear.
 */
export function boltGroupShear(spec: {
  boltCount: number;
  boltDiameter?: number;
  boltArea?: number;
  pitch?: number;
  shearLoad: number;
  allowableShear: number;
  planes?: number;
}): ConnectionResult<BoltGroupShearResult> {
  const nRaw = Number(spec.boltCount);
  if (!Number.isFinite(nRaw) || Math.trunc(nRaw) < 1) return { ok: false, error: 'boltGroupShear needs boltCount ≥ 1' };
  const boltCount = Math.trunc(nRaw);

  const planesRaw = spec.planes === undefined ? 1 : Number(spec.planes);
  if (planesRaw !== 1 && planesRaw !== 2) return { ok: false, error: 'planes must be 1 (single shear) or 2 (double shear)' };
  const planes = planesRaw;

  const V = pos(spec.shearLoad);
  if (V === null) return { ok: false, error: 'boltGroupShear needs a positive shearLoad (N)' };
  const allow = pos(spec.allowableShear);
  if (allow === null) return { ok: false, error: 'boltGroupShear needs a positive allowableShear (MPa)' };

  // tensile stress area As
  let As = spec.boltArea !== undefined ? pos(spec.boltArea) : null;
  let basis = 'explicit boltArea';
  let dOut: number | null = null;
  if (As === null) {
    const d = spec.boltDiameter !== undefined ? pos(spec.boltDiameter) : null;
    if (d === null) return { ok: false, error: 'supply a boltDiameter (mm) or a boltArea (mm²)' };
    dOut = d;
    let pitch = spec.pitch !== undefined ? pos(spec.pitch) : null;
    if (pitch === null) pitch = coarsePitchFor(d); // reuse the verified ISO coarse-pitch table
    if (pitch !== null && pitch < d) {
      const ds = d - STRESS_AREA_COEFF * pitch;
      As = (Math.PI / 4) * ds * ds;
      basis = `tensile stress area (π/4·(d−0.9382·p)², p=${r(pitch, 3)})`;
    } else {
      const ds = 0.85 * d;
      As = (Math.PI / 4) * ds * ds;
      basis = 'approx (π/4·(0.85d)²)';
    }
  }
  if (As === null || As <= 0) return { ok: false, error: 'could not determine a positive bolt shear area (mm²)' };

  const shearPerBolt = V / (boltCount * planes);
  const shearStress = shearPerBolt / As;
  const capacityPerBolt = allow * As * planes;
  const totalCapacity = boltCount * planes * allow * As;
  const safetyFactor = totalCapacity / V;

  return {
    ok: true,
    value: {
      boltCount, planes,
      boltDiameter_mm: dOut === null ? null : r(dOut),
      boltArea_mm2: r(As, 3), areaBasis: basis,
      shearLoad_N: r(V, 2), allowableShear_MPa: r(allow),
      shearPerBolt_N: r(shearPerBolt, 2),
      shearStress_MPa: r(shearStress),
      capacityPerBolt_N: r(capacityPerBolt, 2),
      totalCapacity_N: r(totalCapacity, 2),
      safetyFactor: r(safetyFactor),
      adequate: safetyFactor >= 1,
    },
  };
}

// ─── Bolt bearing on a plate ─────────────────────────────────────────────────

export type BearingStressResult = {
  boltCount: number;
  boltDiameter_mm: number;
  plateThickness_mm: number;
  load_N: number;
  bearingArea_mm2: number;
  bearingStress_MPa: number;
  allowableBearing_MPa: number | null;
  safetyFactor: number | null;
  adequate: boolean | null;
};

/**
 * Bolt bearing on a plate: σ = P/(d·t·n) on the PROJECTED area. Supply an
 * `allowableBearing` (MPa) to get the safety factor.
 */
export function bearingStress(spec: {
  load: number;
  boltDiameter: number;
  plateThickness: number;
  boltCount?: number;
  allowableBearing?: number;
}): ConnectionResult<BearingStressResult> {
  const load = pos(spec.load);
  if (load === null) return { ok: false, error: 'bearingStress needs a positive load (N)' };
  const d = pos(spec.boltDiameter);
  if (d === null) return { ok: false, error: 'bearingStress needs a positive boltDiameter (mm)' };
  const t = pos(spec.plateThickness);
  if (t === null) return { ok: false, error: 'bearingStress needs a positive plateThickness (mm)' };
  const nRaw = spec.boltCount === undefined ? 1 : Number(spec.boltCount);
  if (!Number.isFinite(nRaw) || Math.trunc(nRaw) < 1) return { ok: false, error: 'boltCount must be ≥ 1' };
  const n = Math.trunc(nRaw);

  const area = d * t * n;
  const sigma = load / area;
  const allow = spec.allowableBearing !== undefined ? pos(spec.allowableBearing) : null;
  const sf = allow === null ? null : allow / sigma;

  return {
    ok: true,
    value: {
      boltCount: n, boltDiameter_mm: r(d), plateThickness_mm: r(t), load_N: r(load, 2),
      bearingArea_mm2: r(area, 2), bearingStress_MPa: r(sigma),
      allowableBearing_MPa: allow === null ? null : r(allow),
      safetyFactor: sf === null ? null : r(sf),
      adequate: sf === null ? null : sf >= 1,
    },
  };
}

// ─── Eccentrically loaded bolt group (elastic vector method) ─────────────────

export type BoltForce = { x: number; y: number; force_N: number };

export type BoltGroupEccentricResult = {
  boltCount: number;
  centroid: { x: number; y: number };
  moment_Nmm: number;
  polarMoment_mm2: number;
  directShearPerBolt_N: number;
  criticalForce_N: number;
  criticalBolt: { x: number; y: number };
  bolts: BoltForce[];
};

/**
 * An in-plane eccentric shear on a bolt group by the elastic (vector) method.
 * Give the bolt positions, the load magnitude and direction (`loadDir`, default
 * straight down (0,−1)), and the load line either as an application point `at`
 * or a perpendicular `eccentricity` from the centroid. Each bolt carries the
 * direct share P/n plus a torsional M·rᵢ/J perpendicular to its radius; the
 * resultants superpose and the largest is the critical bolt.
 */
export function boltGroupEccentric(spec: {
  bolts: Array<{ x: number; y: number }>;
  load: number;
  loadDir?: { x: number; y: number };
  at?: { x: number; y: number };
  eccentricity?: number;
}): ConnectionResult<BoltGroupEccentricResult> {
  const raw = Array.isArray(spec.bolts) ? spec.bolts : [];
  if (raw.length < 1) return { ok: false, error: 'boltGroupEccentric needs at least one bolt position' };
  const P = pos(spec.load);
  if (P === null) return { ok: false, error: 'boltGroupEccentric needs a positive load magnitude (N)' };

  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const x = fin(raw[i]?.x), y = fin(raw[i]?.y);
    if (x === null || y === null) return { ok: false, error: `bolt ${i} needs numeric x and y (mm)` };
    pts.push({ x, y });
  }

  // unit load direction
  let dx = spec.loadDir ? fin(spec.loadDir.x) : 0;
  let dy = spec.loadDir ? fin(spec.loadDir.y) : -1;
  if (dx === null || dy === null) return { ok: false, error: 'loadDir needs numeric x and y' };
  const dmag = Math.hypot(dx, dy);
  if (dmag === 0) return { ok: false, error: 'loadDir cannot be the zero vector' };
  dx /= dmag; dy /= dmag;
  const Fx = P * dx, Fy = P * dy;

  // group centroid
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  // polar moment of the group about its centroid
  let J = 0;
  for (const p of pts) { const rx = p.x - cx, ry = p.y - cy; J += rx * rx + ry * ry; }
  if (J === 0) return { ok: false, error: 'all bolts coincide — the group has no torsional resistance (J = 0)' };

  // moment about the centroid: r × F from an application point, or P·eccentricity
  let Mz: number;
  if (spec.at) {
    const ax = fin(spec.at.x), ay = fin(spec.at.y);
    if (ax === null || ay === null) return { ok: false, error: 'at needs numeric x and y' };
    Mz = (ax - cx) * Fy - (ay - cy) * Fx;
  } else {
    const e = fin(spec.eccentricity);
    if (e === null) return { ok: false, error: 'supply an application point `at` or a perpendicular `eccentricity`' };
    Mz = P * e;
  }

  const dirVx = Fx / n, dirVy = Fy / n;
  const forces: BoltForce[] = pts.map((p) => {
    const rx = p.x - cx, ry = p.y - cy;
    const tx = (Mz / J) * (-ry), ty = (Mz / J) * rx; // torsional component ⟂ radius
    return { x: p.x, y: p.y, force_N: r(Math.hypot(dirVx + tx, dirVy + ty), 2) };
  });

  let critical = -1, cbi = 0;
  for (let i = 0; i < forces.length; i += 1) { if (forces[i].force_N > critical) { critical = forces[i].force_N; cbi = i; } }

  return {
    ok: true,
    value: {
      boltCount: n,
      centroid: { x: r(cx), y: r(cy) },
      moment_Nmm: r(Mz, 2),
      polarMoment_mm2: r(J, 2),
      directShearPerBolt_N: r(P / n, 2),
      criticalForce_N: r(critical, 2),
      criticalBolt: { x: r(pts[cbi].x), y: r(pts[cbi].y) },
      bolts: forces,
    },
  };
}
