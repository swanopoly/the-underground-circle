/**
 * engineeringPipeCore — PIPE FITTINGS, a new toroidal/swept geometry class the
 * suite lacked. A straight tube it already had (CSG); the new thing is a BENT
 * pipe — an elbow — a hollow pipe swept along a curved centreline. Elbows,
 * U-bends, and offsets all come from one parametrised sweep.
 *
 * WHY IT VERIFIES CLEANLY — PARTIAL-REVOLVE PAPPUS. An elbow is the pipe-wall
 * annulus (area A = π(ro² − ri²)) swept through the bend angle θ around an axis
 * at the bend radius Rb from the pipe centreline. By Pappus that swept volume is
 * exactly V = θ · Rb · A — the partial-revolve generalisation of the torus-shell
 * volume (θ = 2π gives the full shell). The BORE likewise holds a fluid volume
 * θ · Rb · π·ri². Both are closed form, so — like every solid in this suite — the
 * live drill cross-checks the meshed wall volume against θ·Rb·π(ro²−ri²).
 *
 * CONSTRUCTION — no boolean. The elbow is a bmesh sweep: at each step around the
 * bend, a full pipe cross-section (an outer ring and an inner bore ring) is
 * placed in the plane perpendicular to the centreline tangent; consecutive
 * cross-sections bridge into the outer wall and the (inward-facing) bore wall,
 * and the two open ends are closed with ANNULAR caps (outer ring bridged to
 * inner ring). Every vertex and cap is under our control, so the result is a
 * watertight hollow solid with no union boundary to go non-manifold — de-risked
 * watertight before this core was written.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-pipe-core-smoketest.ts):
 * one value import (the injection-safe path literal), no I/O.
 */

import { pyStringLiteral } from './engineeringSolidModelingCore';

export type PipeResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fmt(v: number): string { const r = Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6; const s = r.toString(); return /e/i.test(s) ? r.toFixed(6) : s; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

export type ElbowSpec = {
  bendRadius: number; // centreline bend radius Rb
  outerDiameter?: number;
  outerRadius?: number;
  innerDiameter?: number;
  wallThickness?: number;
  /** Bend angle in degrees (90 = a quarter-turn elbow). Default 90. */
  angle?: number;
  stepsAround?: number; // pipe circumference segments
  stepsAlong?: number; // bend segments
};

export type ElbowGeometry = {
  bendRadius: number;
  outerRadius: number;
  innerRadius: number;
  wallThickness: number;
  angleDeg: number;
  wallArea: number;
  centrelineLength: number;
  volume: number; // pipe wall material
  boreVolume: number; // fluid the elbow holds
};

function resolveElbow(spec: ElbowSpec): PipeResult<{ Rb: number; ro: number; ri: number; theta: number }> {
  const Rb = pos(spec.bendRadius);
  if (Rb === null) return { ok: false, error: 'elbow needs a positive bendRadius (centreline)' };
  let ro: number | null = spec.outerRadius !== undefined ? pos(spec.outerRadius) : null;
  if (ro === null && spec.outerDiameter !== undefined) { const od = pos(spec.outerDiameter); if (od !== null) ro = od / 2; }
  if (ro === null) return { ok: false, error: 'supply outerDiameter or outerRadius' };
  let ri: number | null = null;
  if (spec.innerDiameter !== undefined) { const id = pos(spec.innerDiameter); if (id !== null) ri = id / 2; }
  else if (spec.wallThickness !== undefined) { const t = pos(spec.wallThickness); if (t !== null) ri = ro - t; }
  if (ri === null) return { ok: false, error: 'supply innerDiameter or wallThickness' };
  if (ri <= 0 || ri >= ro) return { ok: false, error: 'inner radius must be between 0 and the outer radius' };
  if (Rb <= ro) return { ok: false, error: 'bendRadius must exceed the pipe outer radius (else the bend self-intersects)' };
  const angleDeg = Number(spec.angle);
  const theta = (Number.isFinite(angleDeg) && angleDeg > 0 ? angleDeg : 90) * Math.PI / 180;
  if (theta > 2 * Math.PI + 1e-9) return { ok: false, error: 'angle must be ≤ 360°' };
  return { ok: true, value: { Rb, ro, ri, theta } };
}

export function elbowGeometry(spec: ElbowSpec): PipeResult<ElbowGeometry> {
  const r = resolveElbow(spec);
  if (!r.ok) return r;
  const { Rb, ro, ri, theta } = r.value;
  const wallArea = Math.PI * (ro * ro - ri * ri);
  return {
    ok: true,
    value: {
      bendRadius: Rb, outerRadius: ro, innerRadius: ri, wallThickness: r4(ro - ri),
      angleDeg: r4(theta * 180 / Math.PI),
      wallArea: r4(wallArea),
      centrelineLength: r4(theta * Rb),
      volume: r4(theta * Rb * wallArea),
      boreVolume: r4(theta * Rb * Math.PI * ri * ri),
    },
  };
}

export function buildElbowBlenderScript(spec: ElbowSpec, outputStlPath: string): PipeResult<string> {
  const r = resolveElbow(spec);
  if (!r.ok) return r;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const { Rb, ro, ri, theta } = r.value;
  const around = Math.max(12, Math.min(160, Math.trunc(Number(spec.stepsAround) || 64)));
  const along = Math.max(4, Math.min(360, Math.trunc(Number(spec.stepsAlong) || Math.max(8, Math.round((theta * 180 / Math.PI) / 2)))));

  const lines = [
    'import bpy, bmesh, math', '',
    'bpy.ops.wm.read_factory_settings(use_empty=True)', '',
    `RB = ${fmt(Rb)}`,
    `RO = ${fmt(ro)}`,
    `RI = ${fmt(ri)}`,
    `THETA = ${fmt(theta)}`,
    `N = ${along}   # bend segments`,
    `M = ${around}  # pipe circumference segments`,
    '',
    "mesh = bpy.data.meshes.new('elbow')",
    "obj = bpy.data.objects.new('elbow', mesh)",
    'bpy.context.collection.objects.link(obj)',
    'bm = bmesh.new()',
    '',
    '# a point on the pipe surface at bend angle a, pipe radius r, circumference angle b',
    'def pt(a, r, b):',
    '    ca, sa = math.cos(a), math.sin(a)',
    '    cb, sb = math.cos(b), math.sin(b)',
    '    R = RB + r * cb',
    '    return (R * ca, R * sa, r * sb)',
    '',
    'outer = []',
    'inner = []',
    'for i in range(N + 1):',
    '    a = THETA * i / N',
    '    outer.append([bm.verts.new(pt(a, RO, 2 * math.pi * j / M)) for j in range(M)])',
    '    inner.append([bm.verts.new(pt(a, RI, 2 * math.pi * j / M)) for j in range(M)])',
    '',
    '# outer wall + inner bore wall (bore faces reversed to point inward)',
    'for i in range(N):',
    '    for j in range(M):',
    '        jn = (j + 1) % M',
    '        bm.faces.new((outer[i][j], outer[i][jn], outer[i + 1][jn], outer[i + 1][j]))',
    '        bm.faces.new((inner[i][j], inner[i + 1][j], inner[i + 1][jn], inner[i][jn]))',
    '',
    '# annular end caps close the two pipe openings → watertight',
    'for j in range(M):',
    '    jn = (j + 1) % M',
    '    bm.faces.new((outer[0][j], outer[0][jn], inner[0][jn], inner[0][j]))',
    '    bm.faces.new((outer[N][j], inner[N][j], inner[N][jn], outer[N][jn]))',
    '',
    'bm.normal_update()',
    'bm.to_mesh(mesh)',
    'bm.free()',
    '',
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}
