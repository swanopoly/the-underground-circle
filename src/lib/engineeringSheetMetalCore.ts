/**
 * engineeringSheetMetalCore — SHEET-METAL bending, a new capability class (not
 * another solid of revolution). A sheet-metal part is a flat blank of thickness
 * t bent along straight lines; the whole discipline turns on ONE number, the
 * bend allowance, and this core makes it exact and then verifies it live.
 *
 * THE TWO DEVELOPED LENGTHS (this is the crux). Bending neither stretches nor
 * compresses the NEUTRAL axis, which sits a fraction K of the thickness in from
 * the inside radius (K ≈ 0.33–0.45, the "K-factor"). The flat blank you must cut
 * is therefore the sum of the flat flange runs plus, for each bend, the neutral
 * arc length — the BEND ALLOWANCE BA = θ·(R + K·t) (θ in radians, R the inside
 * radius). That FABRICATION length uses K. Separately, the part's own GEOMETRY
 * — its cross-section area, hence its solid volume — is set by the MID-surface
 * arc θ·(R + t/2). The two differ by exactly Σ θ·t·(0.5 − K), and keeping them
 * distinct is the entire point of the K-factor: the shop cuts the K length, the
 * solid weighs the mid-surface length.
 *
 * CONSTRUCTION — no boolean. The bent part is the EXTRUSION of its cross-section
 * (a constant-thickness "ribbon" following the folded centreline) along the part
 * width. So it reuses the proven profile-solid extruder and inherits its exact
 * area·height volume check; there is no union to go non-manifold. The ribbon is
 * built by offsetting the sampled centreline ±t/2 along its normal — a ribbon of
 * width t around a centreline of length L has area EXACTLY t·L (a straight run is
 * t·L; a bend annulus is (θ/2)((R+t)²−R²) = t·θ(R+t/2) = t·midArc), so the
 * measured STL volume must equal t·L_geo·width. That is the live cross-check.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-sheet-metal-core-smoketest.ts):
 * composes the profile-solid extruder + drafting DraftPoint, no I/O.
 */

import type { DraftPoint } from './engineeringDraftingCore';
import { extrudeVolume, buildExtrudeBlenderScript } from './engineeringProfileSolidCore';

export type SheetResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function num(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }

const DEG = Math.PI / 180;

// ─── Bend allowance ───────────────────────────────────────────────────────────

/** Neutral-axis arc length of one bend: BA = θ·(R + K·t), θ in radians. */
export function bendAllowance(angleDeg: number, insideRadius: number, thickness: number, kFactor = 0.44): number {
  const theta = Math.abs(Number(angleDeg) || 0) * DEG;
  const R = Math.abs(Number(insideRadius) || 0);
  const t = Math.abs(Number(thickness) || 0);
  const K = Number.isFinite(kFactor) ? kFactor : 0.44;
  return theta * (R + K * t);
}

// ─── Folded sheet spec ────────────────────────────────────────────────────────

export type SheetMetalOp =
  | { flange: number }
  | { bend: number; radius?: number }; // bend = signed angle in degrees (+ up/CCW, − down/CW)

export type SheetMetalSpec = {
  thickness: number;
  width: number;
  kFactor?: number;
  /** Inside bend radius when a bend omits its own; defaults to the thickness. */
  defaultBendRadius?: number;
  sequence: SheetMetalOp[];
  /** Centreline arc samples per bend (default derived from the angle). */
  stepsPerBend?: number;
};

export type SheetMetalGeometry = {
  thickness: number;
  width: number;
  kFactor: number;
  flangeTotal: number;
  bendCount: number;
  /** Fabrication flat-blank length = Σ flanges + Σ BA (uses K). */
  flatPatternLength: number;
  /** Geometric mid-surface developed length = Σ flanges + Σ θ(R + t/2). */
  geometricDevelopedLength: number;
  crossSectionArea: number;
  volume: number;
  bbox: { w: number; h: number; d: number };
};

type Built = { centreline: DraftPoint[]; profile: DraftPoint[]; geo: SheetMetalGeometry };

function rot(vx: number, vy: number, a: number): DraftPoint { const c = Math.cos(a), s = Math.sin(a); return { x: vx * c - vy * s, y: vx * s + vy * c }; }

/** Fold the centreline, then thicken it into the cross-section ribbon. */
function buildSheet(spec: SheetMetalSpec): SheetResult<Built> {
  const t = pos(spec.thickness);
  const width = pos(spec.width);
  if (t === null || width === null) return { ok: false, error: 'sheet metal needs a positive thickness and width' };
  if (!Array.isArray(spec.sequence) || spec.sequence.length === 0) return { ok: false, error: 'sequence must list at least one flange' };
  const K = Number.isFinite(spec.kFactor) ? Number(spec.kFactor) : 0.44;
  const defR = pos(spec.defaultBendRadius) ?? t;

  // Fold the centreline (mid-surface), sampling each bend arc.
  const pts: DraftPoint[] = [{ x: 0, y: 0 }];
  let phi = 0; // heading
  let flangeTotal = 0, bendCount = 0, flatBends = 0, geoBends = 0;
  for (const op of spec.sequence) {
    if ('flange' in op) {
      const L = pos(op.flange);
      if (L === null) return { ok: false, error: 'each flange length must be positive' };
      const last = pts[pts.length - 1];
      pts.push({ x: last.x + L * Math.cos(phi), y: last.y + L * Math.sin(phi) });
      flangeTotal += L;
    } else if ('bend' in op) {
      const angDeg = num(op.bend);
      if (angDeg === null || angDeg === 0) return { ok: false, error: 'each bend needs a non-zero angle (degrees)' };
      const R = pos(op.radius) ?? defR;
      const theta = angDeg * DEG;
      const s = Math.sign(theta);
      const Rc = R + t / 2; // mid-surface arc radius
      const last = pts[pts.length - 1];
      const perpLeftX = -Math.sin(phi), perpLeftY = Math.cos(phi);
      const cx = last.x + Rc * s * perpLeftX, cy = last.y + Rc * s * perpLeftY;
      const v0x = last.x - cx, v0y = last.y - cy;
      const n = Math.max(2, Math.trunc(Number(spec.stepsPerBend) || Math.max(4, Math.round(Math.abs(angDeg) / 5))));
      for (let i = 1; i <= n; i += 1) {
        const a = theta * (i / n);
        const r = rot(v0x, v0y, a);
        pts.push({ x: cx + r.x, y: cy + r.y });
      }
      phi += theta;
      bendCount += 1;
      flatBends += Math.abs(theta) * (R + K * t);
      geoBends += Math.abs(theta) * (R + t / 2);
    } else {
      return { ok: false, error: 'each op must be a flange or a bend' };
    }
  }
  if (bendCount === 0) return { ok: false, error: 'a sheet-metal part needs at least one bend (use a plain plate otherwise)' };

  // Thicken the centreline into a ±t/2 ribbon (finite-difference normals).
  const n = pts.length;
  const outer: DraftPoint[] = [], inner: DraftPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const nx = -ty, ny = tx; // left normal
    outer.push({ x: pts[i].x + (t / 2) * nx, y: pts[i].y + (t / 2) * ny });
    inner.push({ x: pts[i].x - (t / 2) * nx, y: pts[i].y - (t / 2) * ny });
  }
  const profile = [...outer, ...inner.reverse()];

  const geoLen = flangeTotal + geoBends;
  const flatLen = flangeTotal + flatBends;
  const area = t * geoLen;
  const xs = profile.map((p) => p.x), ys = profile.map((p) => p.y);
  const bboxW = Math.max(...xs) - Math.min(...xs);
  const bboxH = Math.max(...ys) - Math.min(...ys);

  return {
    ok: true,
    value: {
      centreline: pts,
      profile,
      geo: {
        thickness: t, width, kFactor: K,
        flangeTotal: Math.round(flangeTotal * 1e4) / 1e4,
        bendCount,
        flatPatternLength: Math.round(flatLen * 1e4) / 1e4,
        geometricDevelopedLength: Math.round(geoLen * 1e4) / 1e4,
        crossSectionArea: Math.round(area * 1e4) / 1e4,
        volume: Math.round(area * width * 1e4) / 1e4,
        bbox: { w: Math.round(bboxW * 1e4) / 1e4, h: Math.round(bboxH * 1e4) / 1e4, d: width },
      },
    },
  };
}

/** Derived sheet-metal numbers (flat length, geometry, volume) with no I/O. */
export function sheetMetalGeometry(spec: SheetMetalSpec): SheetResult<SheetMetalGeometry> {
  const b = buildSheet(spec);
  return b.ok ? { ok: true, value: b.value.geo } : b;
}

/** The bent cross-section as a closed polygon (for extrusion / a side-view DXF). */
export function bentProfilePolygon(spec: SheetMetalSpec): SheetResult<DraftPoint[]> {
  const b = buildSheet(spec);
  return b.ok ? { ok: true, value: b.value.profile } : b;
}

/**
 * The 3D bent part: EXTRUDE the cross-section ribbon along the part width. Reuses
 * the profile-solid extruder (no boolean), so the measured STL volume must equal
 * t·L_geo·width — the live cross-check.
 */
export function buildBentPartBlenderScript(spec: SheetMetalSpec, outputStlPath: string): SheetResult<string> {
  const b = buildSheet(spec);
  if (!b.ok) return b;
  const built = buildExtrudeBlenderScript(b.value.profile, b.value.geo.width, outputStlPath);
  if (!built.ok) return { ok: false, error: built.error };
  return { ok: true, value: built.value };
}

/** Volume the extruded ribbon should measure — for the drill/callers. */
export function bentPartVolume(spec: SheetMetalSpec): SheetResult<number> {
  const b = buildSheet(spec);
  if (!b.ok) return b;
  return { ok: true, value: extrudeVolume(b.value.profile, b.value.geo.width) };
}
