/**
 * engineeringGearCore — parametric INVOLUTE spur gears. The canonical
 * "look what parametric CAD does" capability, and one an engineer genuinely
 * cannot draw by hand: the tooth flank is the involute of the base circle.
 *
 * WHY GEARS ARE THE RIGHT SHOWCASE — AND VERIFIABLE
 * Every mechanism (gearbox, actuator, clock, robot joint) needs gears, and a
 * flat gear profile is directly usable for laser/waterjet cutting while the
 * extruded solid is usable for print/CNC. Crucially, an involute gear has
 * EXACT closed-form properties the smoke pins against textbook truth:
 *   pitch diameter  d  = m·N
 *   base circle     db = d·cos(φ)
 *   outside (tip)   Da = m·(N + 2)
 *   root diameter   Df = m·(N − 2.5)   (standard 1.25·m dedendum)
 *   circular pitch  p  = π·m
 * and the tip diameter re-appears as the measured bounding box when the gear is
 * extruded and meshed — so the 2D geometry, the 3D extrude, and the mesh
 * inspector all cross-check on one number, Da.
 *
 * THE TOOTH. Each tooth is symmetric about a radial center line. A flank point
 * at radius r sits at polar angle, measured from the tooth center,
 *   ψ(r) = π/(2N) + inv(φ) − inv(α_r),   α_r = acos(db/2 / r),   inv(a)=tan(a)−a
 * so at the pitch circle (α_r = φ) ψ = π/(2N) — a half-tooth — and the flank
 * narrows toward the tip. Below the base circle (small tooth counts undercut,
 * root < base) the flank drops radially to the root.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-gear-core-smoketest.ts):
 * type-only import of DraftDocument shapes, value import of the injection-safe
 * Python path literal, no I/O, no Date.now(), total functions.
 */

import type { DraftEntity, DraftLayer, DraftDocument, DraftPoint } from './engineeringDraftingCore';
import { pyStringLiteral } from './engineeringSolidModelingCore';

export type GearResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fmt(v: number): string { const r = Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6; const s = r.toString(); return /e/i.test(s) ? r.toFixed(6) : s; }

/** Involute function inv(a) = tan(a) − a. */
export function inv(a: number): number { return Math.tan(a) - a; }

// ─── Geometry ────────────────────────────────────────────────────────────────

export type GearGeometry = {
  teeth: number;
  module: number;
  pressureAngleDeg: number;
  pitchDiameter: number;
  pitchRadius: number;
  baseRadius: number;
  addendumRadius: number; // = outside/tip radius
  dedendumRadius: number; // = root radius
  outsideDiameter: number;
  rootDiameter: number;
  circularPitch: number;
  addendum: number;
  dedendum: number;
  undercut: boolean; // root below base circle
};

export function gearGeometry(teeth: number, moduleMm: number, pressureAngleDeg = 20): GearResult<GearGeometry> {
  const N = Math.trunc(Number(teeth));
  const m = pos(moduleMm);
  const phiDeg = Number(pressureAngleDeg);
  if (!Number.isFinite(N) || N < 4) return { ok: false, error: 'gear needs at least 4 teeth' };
  if (m === null) return { ok: false, error: 'module must be positive (mm)' };
  if (!(phiDeg > 0 && phiDeg < 45)) return { ok: false, error: 'pressure angle must be between 0 and 45° (14.5 or 20 typical)' };
  const phi = (phiDeg * Math.PI) / 180;
  const d = m * N;
  const pr = d / 2;
  const rb = pr * Math.cos(phi);
  const addendum = m;
  const dedendum = 1.25 * m;
  const ra = pr + addendum;
  const rf = Math.max(0.1, pr - dedendum);
  return {
    ok: true,
    value: {
      teeth: N, module: m, pressureAngleDeg: phiDeg,
      pitchDiameter: d, pitchRadius: pr, baseRadius: rb,
      addendumRadius: ra, dedendumRadius: rf,
      outsideDiameter: 2 * ra, rootDiameter: 2 * rf,
      circularPitch: Math.PI * m, addendum, dedendum,
      undercut: rf < rb,
    },
  };
}

// ─── 2D profile (closed CCW polygon of the whole gear outline) ───────────────

export type GearSpec = {
  teeth: number;
  module: number;
  pressureAngleDeg?: number;
  /** Face width (mm) for the 3D solid; ignored by the 2D profile. */
  faceWidth?: number;
  /** Center bore diameter (0 = solid). */
  boreDiameter?: number;
  /** Points sampled along each involute flank (smoothness). */
  flankSteps?: number;
};

/**
 * The full gear outline as one closed CCW polygon. Each tooth contributes a
 * right-flank involute (root→tip), a tip arc, a left-flank involute (tip→root),
 * and a root-land segment to the next tooth.
 */
export function spurGearProfile(spec: GearSpec): GearResult<{ points: DraftPoint[]; geometry: GearGeometry }> {
  const geo = gearGeometry(spec.teeth, spec.module, spec.pressureAngleDeg ?? 20);
  if (!geo.ok) return geo;
  const g = geo.value;
  const N = g.teeth, rb = g.baseRadius, ra = g.addendumRadius, rf = g.dedendumRadius;
  const phi = (g.pressureAngleDeg * Math.PI) / 180;
  const invPhi = inv(phi);
  const halfTooth = Math.PI / (2 * N);
  const steps = Math.max(4, Math.min(24, Math.trunc(Number(spec.flankSteps ?? 8))));
  const rInv = Math.max(rb, rf); // involute begins here; below it is radial (undercut)

  // Flank angle from tooth center at radius r (r ≥ rb).
  const psi = (r: number): number => {
    const cosA = Math.min(1, Math.max(-1, rb / r));
    const alpha = Math.acos(cosA);
    return halfTooth + invPhi - inv(alpha);
  };
  const psiRoot = psi(rInv);

  const points: DraftPoint[] = [];
  const push = (r: number, ang: number) => points.push({ x: Math.round(r * Math.cos(ang) * 1e6) / 1e6, y: Math.round(r * Math.sin(ang) * 1e6) / 1e6 });

  for (let i = 0; i < N; i += 1) {
    const gamma = (i * 2 * Math.PI) / N;

    // Right flank, going UP (root → tip), at angle gamma − ψ(r).
    if (g.undercut) push(rf, gamma - psiRoot); // radial root point below the base circle
    for (let s = 0; s <= steps; s += 1) {
      const r = rInv + ((ra - rInv) * s) / steps;
      push(r, gamma - psi(r));
    }
    // Tip arc from right to left across the tooth center.
    const tipHalf = psi(ra);
    push(ra, gamma - tipHalf * 0.5);
    push(ra, gamma + tipHalf * 0.5);
    // Left flank, going DOWN (tip → root), at angle gamma + ψ(r).
    for (let s = steps; s >= 0; s -= 1) {
      const r = rInv + ((ra - rInv) * s) / steps;
      push(r, gamma + psi(r));
    }
    if (g.undercut) push(rf, gamma + psiRoot);
    // Root land to the next tooth: a midpoint on the root circle.
    const nextGamma = ((i + 1) * 2 * Math.PI) / N;
    const landMid = (gamma + psiRoot + (nextGamma - psiRoot)) / 2;
    push(rf, landMid);
  }

  return { ok: true, value: { points, geometry: g } };
}

// ─── 2D gear drawing (DXF-ready DraftDocument) ───────────────────────────────

export const GEAR_LAYERS: DraftLayer[] = [
  { name: 'GEAR', color: 7, linetype: 'CONTINUOUS' },
  { name: 'CONSTRUCTION', color: 8, linetype: 'CENTER' },
  { name: 'HOLES', color: 1, linetype: 'CONTINUOUS' },
  { name: 'TEXT', color: 3, linetype: 'CONTINUOUS' },
];

export function buildSpurGearDrawing(spec: GearSpec): GearResult<DraftDocument> {
  const prof = spurGearProfile(spec);
  if (!prof.ok) return prof;
  const { points, geometry: g } = prof.value;
  const entities: DraftEntity[] = [
    { kind: 'polyline', layer: 'GEAR', closed: true, points },
    { kind: 'circle', layer: 'CONSTRUCTION', cx: 0, cy: 0, r: g.pitchRadius }, // pitch circle reference
  ];
  const bore = Number(spec.boreDiameter);
  if (Number.isFinite(bore) && bore > 0 && bore < g.rootDiameter) {
    entities.push({ kind: 'circle', layer: 'HOLES', cx: 0, cy: 0, r: bore / 2 });
  }
  // Center mark.
  const mk = g.module;
  entities.push({ kind: 'line', layer: 'CONSTRUCTION', x1: -mk, y1: 0, x2: mk, y2: 0 });
  entities.push({ kind: 'line', layer: 'CONSTRUCTION', x1: 0, y1: -mk, x2: 0, y2: mk });
  // Spec callout.
  entities.push({ kind: 'text', layer: 'TEXT', x: 0, y: -(g.addendumRadius) - g.module * 2, height: g.module, text: `Z${g.teeth} m${g.module} PA${g.pressureAngleDeg}` });
  return { ok: true, value: { layers: GEAR_LAYERS, blocks: [], entities } };
}

// ─── 3D extruded gear (Blender bpy: profile → extrude → bore → STL) ──────────

/** The fixed bpy prelude shared by single-gear and gear-assembly scripts. */
export function gearBpyPrelude(): string[] {
  return ['import bpy', 'import bmesh', 'import math', '', 'bpy.ops.wm.read_factory_settings(use_empty=True)', ''];
}

/**
 * bpy lines that build ONE extruded, bored gear object from an already-
 * positioned 2D profile (points are in world XY — a gear meant to sit at a
 * center other than the origin has its profile pre-transformed). `suffix`
 * makes the variable names unique so several gears can coexist in one script;
 * `boreCx/boreCy` place the bore cylinder at that gear's center.
 *
 * This is the reusable unit: buildSpurGearBlenderScript wraps ONE of these, the
 * gear-train builder composes SEVERAL, and every one uses the identical
 * proven bmesh-extrude + EXACT-boolean-bore path.
 */
export function gearObjectBpyLines(
  profilePoints: readonly DraftPoint[],
  width: number,
  boreR: number,
  boreCx: number,
  boreCy: number,
  suffix: string,
): string[] {
  const profileLiteral = `[${profilePoints.map((p) => `(${fmt(p.x)}, ${fmt(p.y)})`).join(', ')}]`;
  const v = (name: string) => `${name}${suffix}`;
  return [
    `PROFILE${suffix} = ${profileLiteral}`,
    `WIDTH${suffix} = ${fmt(width)}`,
    `BORE_R${suffix} = ${fmt(boreR)}`,
    `BORE_C${suffix} = (${fmt(boreCx)}, ${fmt(boreCy)})`,
    '',
    `${v('mesh')} = bpy.data.meshes.new('gear${suffix}')`,
    `${v('obj')} = bpy.data.objects.new('gear${suffix}', ${v('mesh')})`,
    `bpy.context.collection.objects.link(${v('obj')})`,
    `${v('bm')} = bmesh.new()`,
    `${v('vs')} = [${v('bm')}.verts.new((p[0], p[1], 0.0)) for p in PROFILE${suffix}]`,
    `${v('face')} = None`,
    'try:',
    `    ${v('face')} = ${v('bm')}.faces.new(${v('vs')})`,
    'except ValueError:',
    `    ${v('face')} = None`,
    `if ${v('face')} is not None:`,
    `    ${v('res')} = bmesh.ops.extrude_face_region(${v('bm')}, geom=[${v('face')}])`,
    `    ${v('ext')} = [e for e in ${v('res')}['geom'] if isinstance(e, bmesh.types.BMVert)]`,
    `    bmesh.ops.translate(${v('bm')}, verts=${v('ext')}, vec=(0.0, 0.0, WIDTH${suffix}))`,
    `    bmesh.ops.recalc_face_normals(${v('bm')}, faces=${v('bm')}.faces)`,
    `${v('bm')}.to_mesh(${v('mesh')})`,
    `${v('bm')}.free()`,
    `bpy.context.view_layer.objects.active = ${v('obj')}`,
    '',
    `if BORE_R${suffix} > 0.0:`,
    `    bpy.ops.mesh.primitive_cylinder_add(radius=BORE_R${suffix}, depth=WIDTH${suffix} * 2.0 + 2.0, location=(BORE_C${suffix}[0], BORE_C${suffix}[1], WIDTH${suffix} / 2.0), vertices=64)`,
    `    ${v('cut')} = bpy.context.active_object`,
    `    ${v('mod')} = ${v('obj')}.modifiers.new(name='ucbore${suffix}', type='BOOLEAN')`,
    `    ${v('mod')}.operation = 'DIFFERENCE'`,
    `    ${v('mod')}.solver = 'EXACT'`,
    `    ${v('mod')}.object = ${v('cut')}`,
    `    bpy.context.view_layer.objects.active = ${v('obj')}`,
    `    bpy.ops.object.modifier_apply(modifier=${v('mod')}.name)`,
    `    bpy.data.objects.remove(${v('cut')}, do_unlink=True)`,
    '',
  ];
}

/**
 * A self-contained bpy script that builds the gear as an extruded prism of the
 * involute profile, optionally bores a center hole, and exports STL. Uses
 * bmesh to face-fill the concave profile and extrude it — the CSG primitive
 * lane (box/cylinder) cannot make an arbitrary swept profile, so this is its
 * own path. The output STL path is embedded via the injection-safe literal.
 */
export function buildSpurGearBlenderScript(spec: GearSpec, outputStlPath: string): GearResult<string> {
  const prof = spurGearProfile(spec);
  if (!prof.ok) return prof;
  const width = pos(spec.faceWidth) ?? spec.module * 4;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const g = prof.value.geometry;
  const bore = Number(spec.boreDiameter);
  const boreR = Number.isFinite(bore) && bore > 0 && bore < g.rootDiameter ? bore / 2 : 0;

  const lines = [
    ...gearBpyPrelude(),
    ...gearObjectBpyLines(prof.value.points, width, boreR, 0, 0, ''),
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}
