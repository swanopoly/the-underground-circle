/**
 * engineeringHelixCore — HELICAL solids, the last major geometry class the
 * suite lacked. A helix is a revolution with axial travel, so it's the natural
 * extension of the profile-solid work: springs, threads, worms, and augers all
 * live here. This wave delivers the compression spring — the cleanest helical
 * solid to verify.
 *
 * WHY THE SPRING VERIFIES CLEANLY — THE DEVELOPED-LENGTH VOLUME
 * A spring is a circular wire swept along a helix. The wire's true length is
 * its DEVELOPED length — unroll one coil into a right triangle with legs π·D
 * (the circumference) and p (the pitch) and its hypotenuse is √((π·D)² + p²);
 * n coils give L = n·√((π·D)² + p²). The wire volume is then the cross-section
 * area times that length: V = π·(d/2)²·L. This is the helical analogue of
 * Pappus (which handled pure revolution), it is exact for a slender wire
 * (spring index D/d ≳ 4), and — like every solid in this suite — the live drill
 * cross-checks it against the mesh inspector's measurement of the real STL.
 *
 * CONSTRUCTION. The 3D spring is a Blender POLY curve following the helix
 * centreline with a circular bevel (bevel_depth = wire radius) and
 * use_fill_caps = True, converted to a mesh. The caps make it a WATERTIGHT
 * solid — an uncapped swept tube would be an open surface.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-helix-core-smoketest.ts):
 * one value import (the injection-safe Python path literal), no I/O.
 */

import { pyStringLiteral } from './engineeringSolidModelingCore';

export type HelixResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fmt(v: number): string { const r = Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6; const s = r.toString(); return /e/i.test(s) ? r.toFixed(6) : s; }

// ─── Helix geometry ──────────────────────────────────────────────────────────

export type HelixPoint = { x: number; y: number; z: number };

/** Centreline points of a helix of `coils` turns, radius `R`, axial `pitch` per
 *  turn, sampled `stepsPerCoil` per turn (starting at z = 0). */
export function helixPoints(R: number, pitch: number, coils: number, stepsPerCoil = 48): HelixPoint[] {
  const r = Math.abs(Number(R) || 0);
  const p = Number(pitch) || 0;
  const c = Math.max(0, Number(coils) || 0);
  const steps = Math.max(4, Math.min(512, Math.trunc(stepsPerCoil)));
  const total = Math.max(1, Math.round(c * steps));
  const pts: HelixPoint[] = [];
  for (let i = 0; i <= total; i += 1) {
    const t = (i / total) * c; // turns so far
    const theta = t * 2 * Math.PI;
    pts.push({
      x: Math.round(r * Math.cos(theta) * 1e6) / 1e6,
      y: Math.round(r * Math.sin(theta) * 1e6) / 1e6,
      z: Math.round(p * t * 1e6) / 1e6,
    });
  }
  return pts;
}

/** True (unrolled) length of the helix centreline: n·√((2πR)² + pitch²). */
export function helixDevelopedLength(R: number, pitch: number, coils: number): number {
  const r = Math.abs(Number(R) || 0), p = Number(pitch) || 0, c = Math.max(0, Number(coils) || 0);
  return c * Math.sqrt((2 * Math.PI * r) ** 2 + p * p);
}

// ─── Compression spring ──────────────────────────────────────────────────────

export type SpringSpec = {
  wireDiameter: number;
  /** Mean coil diameter (centreline). Give this OR outerDiameter. */
  meanDiameter?: number;
  outerDiameter?: number;
  /** Free (uncompressed) length, driving the pitch = freeLength / totalCoils. */
  freeLength: number;
  totalCoils: number;
  /** Active coils for the rate (default totalCoils − 2 for ground ends). */
  activeCoils?: number;
  stepsPerCoil?: number;
};

export type SpringGeometry = {
  wireDiameter: number;
  meanDiameter: number;
  outerDiameter: number;
  innerDiameter: number;
  freeLength: number;
  totalCoils: number;
  activeCoils: number;
  pitch: number;
  developedLength: number;
  wireVolume: number;
  solidHeight: number;
  springIndex: number;
};

export function springGeometry(spec: SpringSpec): HelixResult<SpringGeometry> {
  const d = pos(spec.wireDiameter);
  const freeLength = pos(spec.freeLength);
  const totalCoils = pos(spec.totalCoils);
  if (d === null || freeLength === null || totalCoils === null) return { ok: false, error: 'spring needs positive wire diameter, free length, and total coils' };
  let D: number | null = spec.meanDiameter !== undefined ? pos(spec.meanDiameter) : null;
  if (D === null && spec.outerDiameter !== undefined) { const od = pos(spec.outerDiameter); if (od !== null) D = od - d; }
  if (D === null) return { ok: false, error: 'supply meanDiameter or outerDiameter' };
  if (D <= d) return { ok: false, error: 'mean diameter must exceed the wire diameter' };

  const pitch = freeLength / totalCoils;
  const R = D / 2;
  const developedLength = helixDevelopedLength(R, pitch, totalCoils);
  const wireVolume = Math.PI * (d / 2) ** 2 * developedLength;
  const activeCoils = spec.activeCoils !== undefined && Number(spec.activeCoils) > 0 ? Number(spec.activeCoils) : Math.max(1, totalCoils - 2);
  return {
    ok: true,
    value: {
      wireDiameter: d, meanDiameter: D, outerDiameter: D + d, innerDiameter: D - d,
      freeLength, totalCoils, activeCoils,
      pitch, developedLength: Math.round(developedLength * 1e4) / 1e4,
      wireVolume: Math.round(wireVolume * 1e4) / 1e4,
      solidHeight: totalCoils * d,
      springIndex: Math.round((D / d) * 100) / 100,
    },
  };
}

/**
 * A self-contained bpy script building the compression spring as a beveled
 * helix curve (circular section, capped ends → watertight) converted to a
 * mesh, exported to STL. The output path is embedded via the injection-safe
 * literal.
 */
export function buildSpringBlenderScript(spec: SpringSpec, outputStlPath: string): HelixResult<string> {
  const geo = springGeometry(spec);
  if (!geo.ok) return geo;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const g = geo.value;
  const steps = Math.max(8, Math.min(128, Math.trunc(Number(spec.stepsPerCoil) || 48)));
  const pts = helixPoints(g.meanDiameter / 2, g.pitch, g.totalCoils, steps);
  const wireR = g.wireDiameter / 2;

  const ptsLiteral = `[${pts.map((p) => `(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`).join(', ')}]`;
  const lines = [
    'import bpy', 'import math', '',
    'bpy.ops.wm.read_factory_settings(use_empty=True)', '',
    `PTS = ${ptsLiteral}`,
    `WIRE_R = ${fmt(wireR)}`,
    '',
    "curve = bpy.data.curves.new('spring', 'CURVE')",
    "curve.dimensions = '3D'",
    "spline = curve.splines.new('POLY')",
    'spline.points.add(len(PTS) - 1)',
    'for i, p in enumerate(PTS):',
    '    spline.points[i].co = (p[0], p[1], p[2], 1.0)',
    'curve.bevel_depth = WIRE_R',
    'curve.bevel_resolution = 12',
    'curve.use_fill_caps = True',
    "obj = bpy.data.objects.new('spring', curve)",
    'bpy.context.collection.objects.link(obj)',
    'bpy.context.view_layer.objects.active = obj',
    'obj.select_set(True)',
    "bpy.ops.object.convert(target='MESH')",
    '',
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}
