/**
 * engineeringThreadCore — ISO metric THREADED FASTENERS, the second helical
 * solid (after the compression spring) and the single most common engineering
 * part. A thread is a helical rib swept around a shank, so it belongs to the
 * same helical family as the spring — and it composes directly with the bolt
 * analysis already in engineeringCalcCore (size an M8 with `engineering.calc`
 * bolt/tap-drill, then MODEL the actual M8 threaded rod here).
 *
 * GEOMETRY — the ISO 68-1 / ISO 261 external thread. The fundamental triangle
 * has height H = P·√3/2 for pitch P. From the nominal (major) diameter d:
 *   pitch diameter   d2 = d − 0.6495·P   (= d − 0.75·H)
 *   external minor   d3 = d − 1.2269·P
 * The M-series coarse pitches are the standard table (M8 → 1.25, M12 → 1.75, …),
 * matching the tap-drill table in engineeringCalcCore.
 *
 * HOW IT VERIFIES — a volume BRACKET, not a single number. A threaded rod is a
 * shank with a helical rib, so its material volume is provably BETWEEN its minor
 * cylinder (π·r3²·L, all the metal that is always there) and its major cylinder
 * (π·(d/2)²·L, the metal if the thread were a full cylinder). The measured STL
 * volume MUST lie in [minorCyl, majorCyl] and sit near the pitch-diameter
 * cylinder (the ~50%-engagement line). That bracket is a rigorous invariant that
 * needs no faceting fudge — unlike a single target it cannot be met by accident.
 * The crests define the outside diameter exactly, so the bbox width = d is a
 * second exact check, and the length is a third.
 *
 * CONSTRUCTION (DE-RISK'd live before this core was written). The thread is a
 * radial HEIGHTFIELD on one swept tube: at each (θ, z) grid point the surface
 * radius is R_MINOR + threadHeight·tooth(phase), where phase = (z − θ·P/2π)/P
 * places you within the current pitch and tooth() is the truncated ISO profile
 * (valley 0.25·P at the minor radius, crest 0.125·P at the major, flanks
 * between). The seam closes because θ = 0 and θ = 2π differ by exactly one pitch
 * (mod P → same radius). Both ends are fan-capped to an axis vertex → ONE closed
 * 2-manifold mesh with NO boolean. This was chosen after the obvious
 * rib-plus-boolean-union approach measured watertight in Blender's in-memory
 * mesh yet left >2-face (non-manifold) edges on the exported, re-welded STL; a
 * single swept surface has no union boundary to go non-manifold.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-thread-core-smoketest.ts):
 * two value imports (the injection-safe path literal, developed length), no I/O.
 */

import { pyStringLiteral } from './engineeringSolidModelingCore';
import { helixDevelopedLength } from './engineeringHelixCore';

export type ThreadResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fmt(v: number): string { const r = Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6; const s = r.toString(); return /e/i.test(s) ? r.toFixed(6) : s; }

// ─── ISO metric thread geometry ──────────────────────────────────────────────

/** ISO 261 coarse-pitch series (mm). Keys are the nominal diameter in mm; the
 *  same pitches back the tap-drill table in engineeringCalcCore. */
export const ISO_COARSE_PITCH: Record<string, number> = {
  '1.6': 0.35, '2': 0.4, '2.5': 0.45, '3': 0.5, '4': 0.7, '5': 0.8, '6': 1.0,
  '8': 1.25, '10': 1.5, '12': 1.75, '14': 2.0, '16': 2.0, '20': 2.5, '24': 3.0,
  '30': 3.5, '36': 4.0, '42': 4.5, '48': 5.0,
};

export type IsoThread = {
  nominalDiameter: number;
  pitch: number;
  majorDiameter: number;
  pitchDiameter: number;
  minorDiameter: number;
  fundamentalHeight: number;
  threadHeightRadial: number;
};

/** Exact ISO external-thread diameters for nominal `d` and pitch `P`. */
export function isoMetricThread(d: number, P: number): ThreadResult<IsoThread> {
  const dd = pos(d), pp = pos(P);
  if (dd === null || pp === null) return { ok: false, error: 'thread needs a positive nominal diameter and pitch' };
  if (pp >= dd) return { ok: false, error: 'pitch must be smaller than the nominal diameter' };
  const H = (pp * Math.sqrt(3)) / 2;
  const d2 = dd - 0.6495 * pp;
  const d3 = dd - 1.2269 * pp;
  if (d3 <= 0) return { ok: false, error: 'pitch too coarse for this diameter (minor diameter ≤ 0)' };
  return {
    ok: true,
    value: {
      nominalDiameter: dd, pitch: pp,
      majorDiameter: dd,
      pitchDiameter: Math.round(d2 * 1e4) / 1e4,
      minorDiameter: Math.round(d3 * 1e4) / 1e4,
      fundamentalHeight: Math.round(H * 1e4) / 1e4,
      threadHeightRadial: Math.round(((dd - d3) / 2) * 1e4) / 1e4,
    },
  };
}

/** Resolve an "M8" / "m12" designation (or a bare number) to its coarse pitch. */
export function coarsePitchFor(nominal: string | number): number | null {
  const key = String(nominal).trim().toLowerCase().replace(/^m/, '');
  const n = Number(key);
  if (!Number.isFinite(n)) return null;
  // normalize "8.0" → "8" (and any float text) to a canonical table key
  return ISO_COARSE_PITCH[String(n)] ?? ISO_COARSE_PITCH[key] ?? null;
}

// ─── Threaded rod ─────────────────────────────────────────────────────────────

export type ThreadedRodSpec = {
  /** "M12" or a bare nominal diameter in mm. */
  thread?: string | number;
  nominalDiameter?: number;
  /** Explicit pitch (mm). Defaults to the ISO coarse pitch for the diameter. */
  pitch?: number;
  length: number;
  stepsPerCoil?: number;
};

export type ThreadedRodGeometry = IsoThread & {
  length: number;
  turns: number;
  developedLength: number;
  minorCylVolume: number;
  pitchCylVolume: number;
  majorCylVolume: number;
};

function resolveThread(spec: ThreadedRodSpec): ThreadResult<{ d: number; P: number }> {
  let d: number | null = null;
  if (spec.nominalDiameter !== undefined) d = pos(spec.nominalDiameter);
  if (d === null && spec.thread !== undefined) {
    const key = String(spec.thread).trim().toLowerCase().replace(/^m/, '');
    const n = Number(key);
    if (Number.isFinite(n) && n > 0) d = n;
  }
  if (d === null) return { ok: false, error: 'supply a thread designation (e.g. "M12") or nominalDiameter' };
  let P: number | null = spec.pitch !== undefined ? pos(spec.pitch) : null;
  if (P === null) P = coarsePitchFor(spec.thread ?? d);
  if (P === null) return { ok: false, error: `no coarse pitch known for M${d} — supply an explicit pitch` };
  return { ok: true, value: { d, P } };
}

export function threadedRodGeometry(spec: ThreadedRodSpec): ThreadResult<ThreadedRodGeometry> {
  const length = pos(spec.length);
  if (length === null) return { ok: false, error: 'threaded rod needs a positive length' };
  const res = resolveThread(spec);
  if (!res.ok) return res;
  const iso = isoMetricThread(res.value.d, res.value.P);
  if (!iso.ok) return iso;
  const g = iso.value;
  const turns = length / g.pitch;
  const rp = g.pitchDiameter / 2, r3 = g.minorDiameter / 2, rM = g.majorDiameter / 2;
  const developedLength = helixDevelopedLength(rp, g.pitch, turns);
  const cyl = (r: number) => Math.PI * r * r * length;
  return {
    ok: true,
    value: {
      ...g,
      length, turns: Math.round(turns * 1e4) / 1e4,
      developedLength: Math.round(developedLength * 1e4) / 1e4,
      minorCylVolume: Math.round(cyl(r3) * 1e4) / 1e4,
      pitchCylVolume: Math.round(cyl(rp) * 1e4) / 1e4,
      majorCylVolume: Math.round(cyl(rM) * 1e4) / 1e4,
    },
  };
}

/**
 * The proven bmesh-swept-rib + EXACT-union recipe as a self-contained bpy
 * script, exported to STL. The helix loop stays in Python (compact output); the
 * numeric constants and the output path are embedded via the safe literals.
 */
export function buildThreadedRodBlenderScript(spec: ThreadedRodSpec, outputStlPath: string): ThreadResult<string> {
  const geo = threadedRodGeometry(spec);
  if (!geo.ok) return geo;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const g = geo.value;
  const around = Math.max(24, Math.min(160, Math.trunc(Number(spec.stepsPerCoil) || 48)));
  const perPitch = 20; // axial samples per pitch — fine enough for a sharp tooth
  const nz = Math.max(8, Math.round(g.turns * perPitch));
  const rMajor = g.majorDiameter / 2;
  const r3 = g.minorDiameter / 2;

  const lines = [
    'import bpy, math', '',
    'bpy.ops.wm.read_factory_settings(use_empty=True)', '',
    `LENGTH = ${fmt(g.length)}`,
    `P = ${fmt(g.pitch)}`,
    `R_MAJOR = ${fmt(rMajor)}`,
    `R_MINOR = ${fmt(r3)}`,
    'THREAD_H = R_MAJOR - R_MINOR',
    `NA = ${around}   # angular divisions around the circle`,
    `NZ = ${nz}   # axial divisions (~20 per pitch)`,
    '',
    '# The thread is a radial HEIGHTFIELD on one swept tube: at (theta, z) the',
    '# surface radius is R_MINOR + THREAD_H * tooth(phase), phase = (z - theta*P/2pi)/P.',
    '# One closed mesh, fan-capped ends -> 2-manifold with NO boolean. A boolean',
    '# union of a separate rib leaves >2-face edges on the exported STL.',
    'def tooth(phase):',
    '    p = phase - math.floor(phase)          # fold into one pitch, 0..1',
    '    root, c0, c1 = 0.125, 0.4375, 0.5625   # valley 0.25P, crest 0.125P, flanks fill',
    '    if p < root or p >= 1.0 - root: return 0.0',
    '    if c0 <= p <= c1: return 1.0',
    '    if p < c0: return (p - root) / (c0 - root)',
    '    return (1.0 - root - p) / (1.0 - root - c1)',
    '',
    'verts = []',
    'def vidx(j, k): return j * NZ + k',
    'for j in range(NA):',
    '    theta = 2 * math.pi * j / NA',
    '    co, si = math.cos(theta), math.sin(theta)',
    '    for k in range(NZ):',
    '        z = LENGTH * k / (NZ - 1)',
    '        phase = (z - theta / (2 * math.pi) * P) / P',
    '        r = R_MINOR + THREAD_H * tooth(phase)',
    '        verts.append((r * co, r * si, z))',
    'cbot = len(verts); verts.append((0.0, 0.0, 0.0))',
    'ctop = len(verts); verts.append((0.0, 0.0, LENGTH))',
    '',
    'faces = []',
    'for j in range(NA):',
    '    jn = (j + 1) % NA',
    '    for k in range(NZ - 1):',
    '        faces.append((vidx(j, k), vidx(jn, k), vidx(jn, k + 1), vidx(j, k + 1)))',
    '    faces.append((cbot, vidx(jn, 0), vidx(j, 0)))            # bottom fan cap',
    '    faces.append((ctop, vidx(j, NZ - 1), vidx(jn, NZ - 1)))  # top fan cap',
    '',
    "mesh = bpy.data.meshes.new('thread')",
    "obj = bpy.data.objects.new('thread', mesh)",
    'bpy.context.collection.objects.link(obj)',
    'mesh.from_pydata(verts, [], faces)',
    'mesh.update()',
    '',
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}
