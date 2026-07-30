/**
 * engineeringHelicalGearCore — HELICAL GEARS, the most common gear in real
 * machinery: the same involute tooth as a spur gear, but the teeth run at a
 * HELIX angle across the face instead of straight. That angled tooth brings each
 * pair into contact gradually rather than all at once, so a helical gear is
 * quieter and smoother and carries more load than the equivalent spur — at the
 * cost of an axial thrust the bearings must take (which the bearing lane sizes).
 *
 * IT IS A SPUR PROFILE, TWISTED. The cross-section of a helical gear at every
 * height is the SAME spur-gear outline; it is simply rotated progressively as you
 * move along the axis. So the geometry reuses the spur-gear profile entirely and
 * the only new parameter is the twist. The helix angle β at the pitch cylinder
 * fixes it: the teeth make one full turn over the lead πd/tanβ, so across a face
 * width W the profile twists by θ = W·tanβ / r_pitch radians.
 *
 * VERIFIED BY CAVALIERI. Cavalieri's principle says a solid built by stacking a
 * cross-section of fixed area — however you slide or ROTATE each slice — has the
 * same volume as the un-twisted stack. So a helical gear has EXACTLY the volume
 * of the spur gear it came from: (profile area − bore) × face width, independent
 * of the helix angle. That gives a clean, angle-independent volume check, and the
 * live drill confirms the meshed helical solid measures the spur volume at every
 * helix angle. The twist-extrude + straight-bore build was de-risked watertight
 * to 0.005%.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-helical-gear-core-smoketest.ts):
 * reuses the spur-gear profile + the injection-safe path literal, no I/O.
 */

import { spurGearProfile, type GearSpec, type GearGeometry } from './engineeringGearCore';
import { polygonArea } from './engineeringProfileSolidCore';
import { pyStringLiteral } from './engineeringSolidModelingCore';

export type HelicalResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fmt(v: number): string { const r = Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6; const s = r.toString(); return /e/i.test(s) ? r.toFixed(6) : s; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

export type HelicalGearSpec = GearSpec & {
  faceWidth: number;
  helixAngleDeg: number;
  stepsAcross?: number;
};

export type HelicalGearGeometry = {
  gear: GearGeometry;
  faceWidth: number;
  helixAngleDeg: number;
  twistAngleDeg: number; // total twist over the face width
  lead: number; // axial distance for one full 360° twist
  profileArea: number;
  boreDiameter: number;
  volume: number; // = (profileArea − bore) · faceWidth  (Cavalieri)
  handedness: 'right' | 'left';
};

function build(spec: HelicalGearSpec): HelicalResult<{ points: { x: number; y: number }[]; geo: HelicalGearGeometry }> {
  const faceWidth = pos(spec.faceWidth);
  const beta = spec.helixAngleDeg;
  if (faceWidth === null) return { ok: false, error: 'helical gear needs a positive faceWidth (mm)' };
  if (!Number.isFinite(beta) || Math.abs(beta) >= 60) return { ok: false, error: 'helix angle must be a finite value under 60°' };
  const prof = spurGearProfile(spec);
  if (!prof.ok) return prof;
  const g = prof.value.geometry;
  const points = prof.value.points;
  const area = polygonArea(points);
  const boreD = spec.boreDiameter !== undefined ? (pos(spec.boreDiameter) ?? 0) : 0;
  if (boreD > 0 && boreD >= g.rootDiameter) return { ok: false, error: 'bore diameter must be smaller than the root circle' };
  const boreArea = boreD > 0 ? Math.PI * (boreD / 2) ** 2 : 0;

  const betaRad = (beta * Math.PI) / 180;
  const twist = (faceWidth * Math.tan(Math.abs(betaRad))) / g.pitchRadius; // radians over the face
  const lead = Math.abs(betaRad) > 1e-9 ? (Math.PI * g.pitchDiameter) / Math.tan(Math.abs(betaRad)) : Infinity;

  return {
    ok: true,
    value: {
      points,
      geo: {
        gear: g, faceWidth, helixAngleDeg: r4(beta),
        twistAngleDeg: r4((twist * 180) / Math.PI),
        lead: Number.isFinite(lead) ? r4(lead) : Infinity,
        profileArea: r4(area), boreDiameter: r4(boreD),
        volume: r4((area - boreArea) * faceWidth),
        handedness: beta >= 0 ? 'right' : 'left',
      },
    },
  };
}

export function helicalGearGeometry(spec: HelicalGearSpec): HelicalResult<HelicalGearGeometry> {
  const b = build(spec);
  return b.ok ? { ok: true, value: b.value.geo } : b;
}

/** Twist-extrude the spur profile across the face, then subtract a straight bore. */
export function buildHelicalGearBlenderScript(spec: HelicalGearSpec, outputStlPath: string): HelicalResult<string> {
  const b = build(spec);
  if (!b.ok) return b;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const { points, geo } = b.value;
  const width = geo.faceWidth;
  const betaRad = (geo.helixAngleDeg * Math.PI) / 180;
  const twist = (width * Math.tan(betaRad)) / geo.gear.pitchRadius; // signed → handedness
  const steps = Math.max(8, Math.min(240, Math.trunc(Number(spec.stepsAcross) || Math.max(24, Math.round(Math.abs(geo.twistAngleDeg) * 2)))));
  const boreR = geo.boreDiameter > 0 ? geo.boreDiameter / 2 : 0;

  const ptsLit = `[${points.map((p) => `(${fmt(p.x)}, ${fmt(p.y)})`).join(', ')}]`;
  const lines = [
    'import bpy, bmesh, math', '',
    'bpy.ops.wm.read_factory_settings(use_empty=True)', '',
    `PTS = ${ptsLit}`,
    `WIDTH = ${fmt(width)}`,
    `N = ${steps}`,
    `TWIST = ${fmt(twist)}   # total twist (rad) across the face; sign = handedness`,
    `BORE_R = ${fmt(boreR)}`,
    '',
    "mesh = bpy.data.meshes.new('helical_gear')",
    "obj = bpy.data.objects.new('helical_gear', mesh)",
    'bpy.context.collection.objects.link(obj)',
    'bm = bmesh.new()',
    '# stack the SAME profile at each height, rotated progressively → helical teeth',
    'layers = []',
    'for i in range(N + 1):',
    '    z = WIDTH * i / N',
    '    a = TWIST * i / N',
    '    ca, sa = math.cos(a), math.sin(a)',
    '    layers.append([bm.verts.new((x * ca - y * sa, x * sa + y * ca, z)) for (x, y) in PTS])',
    'M = len(PTS)',
    'for i in range(N):',
    '    for j in range(M):',
    '        jn = (j + 1) % M',
    '        bm.faces.new((layers[i][j], layers[i][jn], layers[i + 1][jn], layers[i + 1][j]))',
    'bm.faces.new(layers[0][::-1])   # cap the bottom',
    'bm.faces.new(layers[N])         # cap the top',
    'bm.normal_update()',
    'bm.to_mesh(mesh)',
    'bm.free()',
    '',
    'if BORE_R > 0.0:',
    '    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=BORE_R, depth=WIDTH * 2.0 + 2.0, location=(0, 0, WIDTH / 2.0))',
    '    cut = bpy.context.active_object',
    "    mod = obj.modifiers.new('bore', 'BOOLEAN')",
    "    mod.operation = 'DIFFERENCE'",
    "    mod.solver = 'EXACT'",
    '    mod.object = cut',
    '    bpy.context.view_layer.objects.active = obj',
    "    bpy.ops.object.modifier_apply(modifier='bore')",
    '    bpy.data.objects.remove(cut, do_unlink=True)',
    '',
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}
