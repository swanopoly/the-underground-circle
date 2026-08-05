/**
 * engineeringFastenerCore — the recognizable HEX FASTENERS: hex-head bolts and
 * hex nuts. The thread core already gives the working thread; this gives the
 * shapes people actually name ("model an M10 bolt"), sized from the ISO
 * across-flats (wrench-size) standard so a bolt and its nut share a spanner.
 *
 * CONSTRUCTION. A hexagonal prism is just a Blender cylinder with SIX vertices
 * (across-corners = 2·R, across-flats = R·√3), so the head and the nut body are
 * primitives, not bespoke meshes. A hex BOLT is that head unioned with a
 * cylindrical shank (EXACT boolean — de-risked watertight, since it is the same
 * clean box/cylinder-union class the CSG lane already relies on). A hex NUT is
 * the hex prism with a cylindrical bore subtracted. Both are therefore the
 * proven CSG-style boolean path, and their volumes are closed-form:
 *   bolt  = hexArea·headHeight + π(dₛ/2)²·shankLen − overlap
 *   nut   = hexArea·height − π(bore/2)²·height
 * with hexArea = (3√3/2)·R². The live drill measures the meshed part against these.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-fastener-core-smoketest.ts):
 * one value import (the injection-safe path literal), no I/O.
 */

import { pyStringLiteral } from './engineeringSolidModelingCore';

export type FastenerResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fmt(v: number): string { const r = Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6; const s = r.toString(); return /e/i.test(s) ? r.toFixed(6) : s; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

/** ISO 272 hex across-flats (wrench size), mm, by nominal thread diameter. */
export const HEX_ACROSS_FLATS: Record<string, number> = {
  '3': 5.5, '4': 7, '5': 8, '6': 10, '8': 13, '10': 16, '12': 18, '14': 21,
  '16': 24, '20': 30, '24': 36, '30': 46, '36': 55,
};

/** Resolve a thread designation / bare diameter to {nominal, acrossFlats}. */
function resolveHex(spec: any): FastenerResult<{ d: number; af: number }> {
  let d: number | null = spec?.diameter !== undefined ? pos(spec.diameter) : null;
  if (d === null && spec?.thread !== undefined) {
    const key = String(spec.thread).trim().toLowerCase().replace(/^m/, '');
    const n = Number(key);
    if (Number.isFinite(n) && n > 0) d = n;
  }
  if (d === null) return { ok: false, error: 'supply a thread (e.g. "M10") or a diameter (mm)' };
  let af: number | null = spec?.acrossFlats !== undefined ? pos(spec.acrossFlats) : null;
  if (af === null) af = HEX_ACROSS_FLATS[String(d)] ?? null;
  if (af === null) return { ok: false, error: `no standard across-flats for M${d} — supply acrossFlats (mm)` };
  return { ok: true, value: { d, af } };
}

function hexArea(af: number): number { const R = af / Math.sqrt(3); return (3 * Math.sqrt(3) / 2) * R * R; }
function acrossCorners(af: number): number { return (2 * af) / Math.sqrt(3); }

// ─── Hex bolt ─────────────────────────────────────────────────────────────────

export type HexBoltGeometry = {
  nominalDiameter: number; acrossFlats: number; acrossCorners: number;
  headHeight: number; shankDiameter: number; shankLength: number;
  headVolume: number; shankVolume: number; overlap: number; volume: number;
  totalHeight: number;
};

export function hexBoltGeometry(spec: any): FastenerResult<HexBoltGeometry> {
  const r = resolveHex(spec);
  if (!r.ok) return r;
  const { d, af } = r.value;
  const shankLength = pos(spec?.length);
  if (shankLength === null) return { ok: false, error: 'bolt needs a positive length (shank, mm)' };
  const headHeight = pos(spec?.headHeight) ?? r4(0.7 * d); // ISO head height ≈ 0.7·d
  const shankDiameter = pos(spec?.shankDiameter) ?? d;
  const overlap = Math.min(1, headHeight / 2);
  const headVol = hexArea(af) * headHeight;
  const shankVol = Math.PI * (shankDiameter / 2) ** 2 * (shankLength + overlap);
  const ovlVol = Math.PI * (shankDiameter / 2) ** 2 * overlap;
  return {
    ok: true,
    value: {
      nominalDiameter: d, acrossFlats: af, acrossCorners: r4(acrossCorners(af)),
      headHeight, shankDiameter, shankLength,
      headVolume: r4(headVol), shankVolume: r4(shankVol), overlap: r4(ovlVol),
      volume: r4(headVol + shankVol - ovlVol),
      totalHeight: r4(headHeight + shankLength),
    },
  };
}

export function buildHexBoltBlenderScript(spec: any, outputStlPath: string): FastenerResult<string> {
  const geo = hexBoltGeometry(spec);
  if (!geo.ok) return geo;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const g = geo.value;
  const R = g.acrossFlats / Math.sqrt(3);
  const overlap = Math.min(1, g.headHeight / 2);
  const shankDepth = g.shankLength + overlap;
  const lines = [
    'import bpy, math', '',
    'bpy.ops.wm.read_factory_settings(use_empty=True)', '',
    `R = ${fmt(R)}`,
    `HEAD_H = ${fmt(g.headHeight)}`,
    `SHANK_R = ${fmt(g.shankDiameter / 2)}`,
    `SHANK_DEPTH = ${fmt(shankDepth)}`,
    `OVERLAP = ${fmt(overlap)}`,
    '',
    '# hex head — a 6-vertex cylinder is a hexagonal prism (across-flats = R·√3)',
    'bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=R, depth=HEAD_H, location=(0, 0, HEAD_H / 2.0))',
    'head = bpy.context.active_object',
    '# cylindrical shank, poking OVERLAP into the head so the union has material to merge',
    'bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=SHANK_R, depth=SHANK_DEPTH, location=(0, 0, HEAD_H - OVERLAP + SHANK_DEPTH / 2.0))',
    'shank = bpy.context.active_object',
    "mod = head.modifiers.new('u', 'BOOLEAN')",
    "mod.operation = 'UNION'",
    "mod.solver = 'EXACT'",
    'mod.object = shank',
    'bpy.context.view_layer.objects.active = head',
    "bpy.ops.object.modifier_apply(modifier='u')",
    'bpy.data.objects.remove(shank, do_unlink=True)',
    '',
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}

// ─── Hex nut ──────────────────────────────────────────────────────────────────

export type HexNutGeometry = {
  nominalDiameter: number; acrossFlats: number; acrossCorners: number;
  height: number; boreDiameter: number; volume: number;
};

export function hexNutGeometry(spec: any): FastenerResult<HexNutGeometry> {
  const r = resolveHex(spec);
  if (!r.ok) return r;
  const { d, af } = r.value;
  const height = pos(spec?.height) ?? r4(0.8 * d); // ISO nut height ≈ 0.8·d
  let bore = pos(spec?.boreDiameter);
  if (bore === null) {
    const pitch = Number(spec?.pitch) || 0;
    bore = pitch > 0 ? d - 1.0827 * pitch : 0.85 * d; // tapped-hole minor ≈ d − 1.0827·P, or a representative 0.85·d
  }
  if (bore >= af) return { ok: false, error: 'bore must be smaller than the across-flats' };
  if (bore <= 0) return { ok: false, error: 'bore diameter must be positive' };
  const vol = hexArea(af) * height - Math.PI * (bore / 2) ** 2 * height;
  return {
    ok: true,
    value: {
      nominalDiameter: d, acrossFlats: af, acrossCorners: r4(acrossCorners(af)),
      height, boreDiameter: r4(bore), volume: r4(vol),
    },
  };
}

export function buildHexNutBlenderScript(spec: any, outputStlPath: string): FastenerResult<string> {
  const geo = hexNutGeometry(spec);
  if (!geo.ok) return geo;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const g = geo.value;
  const R = g.acrossFlats / Math.sqrt(3);
  const lines = [
    'import bpy, math', '',
    'bpy.ops.wm.read_factory_settings(use_empty=True)', '',
    `R = ${fmt(R)}`,
    `HEIGHT = ${fmt(g.height)}`,
    `BORE_R = ${fmt(g.boreDiameter / 2)}`,
    '',
    '# hex nut body — a 6-vertex cylinder (hexagonal prism)',
    'bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=R, depth=HEIGHT, location=(0, 0, HEIGHT / 2.0))',
    'nut = bpy.context.active_object',
    '# subtract the bore (the tapped hole envelope)',
    'bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=BORE_R, depth=HEIGHT * 2.0 + 2.0, location=(0, 0, HEIGHT / 2.0))',
    'bore = bpy.context.active_object',
    "mod = nut.modifiers.new('d', 'BOOLEAN')",
    "mod.operation = 'DIFFERENCE'",
    "mod.solver = 'EXACT'",
    'mod.object = bore',
    'bpy.context.view_layer.objects.active = nut',
    "bpy.ops.object.modifier_apply(modifier='d')",
    'bpy.data.objects.remove(bore, do_unlink=True)',
    '',
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}
