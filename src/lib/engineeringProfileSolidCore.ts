/**
 * engineeringProfileSolidCore — the two fundamental profile-based solid
 * operations as GENERAL capabilities: EXTRUDE (a 2D profile → a prism) and
 * REVOLVE (a 2D profile → a solid of revolution). Together with the CSG lane
 * (box/cylinder/sphere + booleans) these complete the modeling triad, and they
 * unlock an enormous space of real parts — any custom cross-section by extrude,
 * anything axisymmetric (pulleys, shafts, bushings, nozzles) by revolve.
 *
 * WHY REVOLVE'S VERIFICATION IS THE MOST ELEGANT IN THE SUITE
 * A solid of revolution's volume is exactly PAPPUS'S theorem: V = 2π·R̄·A, the
 * profile area A times the circumference traced by its centroid at radius R̄.
 * Both A (shoelace) and R̄ (polygon centroid) are computable in closed form from
 * the profile — so this core PREDICTS the volume analytically and the live
 * drill cross-checks that prediction against the mesh inspector's
 * divergence-theorem measurement of the actual revolved STL. That is a THIRD
 * independent volume method (after CSG-analytical and prism-analytical), and
 * the three agreeing is what proves the revolve is geometrically correct.
 *
 * AXIS CONVENTION. A revolve profile lives in the (x, y) plane with x = radial
 * distance from the axis (x ≥ 0) and y = axial position; it is revolved about
 * the line x = 0 (which becomes the Z axis of the 3D part). An extrude profile
 * is any simple polygon in (x, y), swept along +Z.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-profile-solid-core-smoketest.ts):
 * reuses the proven gear extrude unit, no I/O, no Date.now(), total functions.
 */

import type { DraftPoint } from './engineeringDraftingCore';
import { gearBpyPrelude, gearObjectBpyLines } from './engineeringGearCore';
import { pyStringLiteral } from './engineeringSolidModelingCore';

export type ProfileResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fmt(v: number): string { const r = Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6; const s = r.toString(); return /e/i.test(s) ? r.toFixed(6) : s; }

// ─── Polygon measures ────────────────────────────────────────────────────────

/** Signed area (shoelace): positive for CCW winding, negative for CW. */
export function polygonSignedArea(points: readonly DraftPoint[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i], b = points[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(points: readonly DraftPoint[]): number { return Math.abs(polygonSignedArea(points)); }

/** Area centroid of a simple polygon (winding-independent). */
export function polygonCentroid(points: readonly DraftPoint[]): { cx: number; cy: number } | null {
  const n = points.length;
  if (n < 3) return null;
  const A = polygonSignedArea(points);
  if (Math.abs(A) < 1e-12) return null;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i], b = points[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { cx: cx / (6 * A), cy: cy / (6 * A) };
}

export function polygonBBox(points: readonly DraftPoint[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

// ─── Analytical volumes ──────────────────────────────────────────────────────

/** Prism volume = profile area × height. Exact. */
export function extrudeVolume(points: readonly DraftPoint[], height: number): number {
  return polygonArea(points) * Math.abs(Number(height) || 0);
}

/**
 * Volume of the solid formed by revolving `points` a full turn about the axis
 * x = 0, by Pappus's (second) theorem: V = 2π·R̄·A, where R̄ is the centroid's
 * radial distance and A the profile area. Requires the profile on one side of
 * the axis (x ≥ 0), which the caller validates.
 */
export function revolveVolume(points: readonly DraftPoint[]): number {
  const c = polygonCentroid(points);
  if (!c) return 0;
  return 2 * Math.PI * Math.abs(c.cx) * polygonArea(points);
}

// ─── Validation ──────────────────────────────────────────────────────────────

function coerceProfile(raw: unknown): DraftPoint[] | null {
  if (!Array.isArray(raw)) return null;
  const pts: DraftPoint[] = [];
  for (const p of raw) {
    const x = Number((p as any)?.x), y = Number((p as any)?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push({ x, y });
  }
  return pts;
}

export function validateExtrudeProfile(raw: unknown): ProfileResult<DraftPoint[]> {
  const pts = coerceProfile(raw);
  if (!pts) return { ok: false, error: 'profile must be an array of {x, y} points with finite coordinates' };
  if (pts.length < 3) return { ok: false, error: 'a profile needs at least 3 points' };
  if (pts.length > 4000) return { ok: false, error: 'profile exceeds 4000 points' };
  if (polygonArea(pts) < 1e-9) return { ok: false, error: 'profile has zero area (collinear or degenerate)' };
  return { ok: true, value: pts };
}

export function validateRevolveProfile(raw: unknown): ProfileResult<DraftPoint[]> {
  const base = validateExtrudeProfile(raw);
  if (!base.ok) return base;
  if (base.value.some((p) => p.x < -1e-9)) return { ok: false, error: 'a revolve profile must be on one side of the axis (all x ≥ 0)' };
  return base;
}

// ─── Extrude (reuses the proven gear extrude unit) ───────────────────────────

/** Extrude any simple polygon to `height` along +Z, with an optional center bore. */
export function buildExtrudeBlenderScript(rawProfile: unknown, height: number, outputStlPath: string, opts: { boreDiameter?: number } = {}): ProfileResult<string> {
  const prof = validateExtrudeProfile(rawProfile);
  if (!prof.ok) return prof;
  const h = Number(height);
  if (!Number.isFinite(h) || h <= 0) return { ok: false, error: 'height must be positive' };
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const bore = Number(opts.boreDiameter);
  const boreR = Number.isFinite(bore) && bore > 0 ? bore / 2 : 0;
  // The bore is placed at the profile's centroid (a sensible default for a
  // symmetric part); callers wanting an off-centre hole should model it in the
  // profile itself.
  const c = polygonCentroid(prof.value) ?? { cx: 0, cy: 0 };
  const lines = [
    ...gearBpyPrelude(),
    ...gearObjectBpyLines(prof.value, h, boreR, c.cx, c.cy, ''),
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}

// ─── Revolve (Screw modifier around Z) ───────────────────────────────────────

export const REVOLVE_DEFAULT_SEGMENTS = 96;

/**
 * Revolve a closed profile (x = radius ≥ 0, y = axial) a full turn about the Z
 * axis and export STL. Built with Blender's Screw modifier on the profile's
 * closed edge loop; use_merge_vertices seals the 360° seam into a closed
 * manifold. A profile offset from the axis (min x > 0) yields a hollow part
 * (its own bore); a profile touching x = 0 yields a solid.
 */
export function buildRevolveBlenderScript(rawProfile: unknown, outputStlPath: string, opts: { segments?: number } = {}): ProfileResult<string> {
  const prof = validateRevolveProfile(rawProfile);
  if (!prof.ok) return prof;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const segs = Math.max(12, Math.min(512, Math.trunc(Number(opts.segments) || REVOLVE_DEFAULT_SEGMENTS)));
  const n = prof.value.length;
  // Profile verts in the XZ plane (x = radius, z = axial), y = 0.
  const vertsLiteral = `[${prof.value.map((p) => `(${fmt(p.x)}, 0.0, ${fmt(p.y)})`).join(', ')}]`;
  const edgesLiteral = `[${Array.from({ length: n }, (_, i) => `(${i}, ${(i + 1) % n})`).join(', ')}]`;

  const lines = [
    ...gearBpyPrelude(),
    `VERTS = ${vertsLiteral}`,
    `EDGES = ${edgesLiteral}`,
    `SEGS = ${segs}`,
    '',
    "mesh = bpy.data.meshes.new('revolve')",
    "obj = bpy.data.objects.new('revolve', mesh)",
    'bpy.context.collection.objects.link(obj)',
    'mesh.from_pydata(VERTS, EDGES, [])',
    'mesh.update()',
    'bpy.context.view_layer.objects.active = obj',
    "mod = obj.modifiers.new(name='ucscrew', type='SCREW')",
    "mod.axis = 'Z'",
    'mod.angle = 2.0 * math.pi',
    'mod.steps = SEGS',
    'mod.render_steps = SEGS',
    'mod.use_merge_vertices = True',
    'mod.merge_threshold = 1e-4',
    'mod.use_normal_calculate = True',
    "bpy.ops.object.modifier_apply(modifier=mod.name)",
    '',
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}

// ─── Turnkey revolved part: V-groove pulley ──────────────────────────────────

export type PulleySpec = {
  outerDiameter: number;
  boreDiameter: number;
  width: number;
  /** Depth of the V-groove cut into the rim (0 = flat rim). */
  grooveDepth?: number;
  /** Groove opening width at the rim. */
  grooveTopWidth?: number;
  segments?: number;
};

/** The radial cross-section (r, z) of a V-groove pulley, revolved into a solid.
 *  Returns the profile so its Pappus volume can be checked independently. */
export function pulleyProfile(spec: PulleySpec): ProfileResult<DraftPoint[]> {
  const ro = Number(spec.outerDiameter) / 2;
  const rb = Number(spec.boreDiameter) / 2;
  const W = Number(spec.width);
  if (!(ro > 0) || !(rb >= 0) || !(W > 0) || rb >= ro) return { ok: false, error: 'pulley needs 0 ≤ bore < outerDiameter and positive width' };
  const gd = Math.max(0, Math.min(ro - rb - 0.5, Number(spec.grooveDepth ?? 0)));
  const gt = Math.max(0, Math.min(W * 0.9, Number(spec.grooveTopWidth ?? (gd > 0 ? W * 0.6 : 0))));
  // Closed section from the bore out to the rim, with a V-notch on the rim.
  const pts: DraftPoint[] = [
    { x: rb, y: -W / 2 },
    { x: ro, y: -W / 2 },
  ];
  if (gd > 0 && gt > 0) {
    pts.push({ x: ro, y: -gt / 2 });
    pts.push({ x: ro - gd, y: 0 });
    pts.push({ x: ro, y: gt / 2 });
  }
  pts.push({ x: ro, y: W / 2 });
  pts.push({ x: rb, y: W / 2 });
  return { ok: true, value: pts };
}

export function buildPulleyBlenderScript(spec: PulleySpec, outputStlPath: string): ProfileResult<string> {
  const prof = pulleyProfile(spec);
  if (!prof.ok) return prof;
  return buildRevolveBlenderScript(prof.value, outputStlPath, { segments: spec.segments });
}
