/**
 * engineeringGearTrainCore — meshing gear PAIRS. The suite's first ASSEMBLY:
 * two parts positioned so they fit and function together, not a single part.
 *
 * WHY A GEAR PAIR IS THE RIGHT FIRST ASSEMBLY
 * Gears exist to transmit power, and they do it in pairs. "Design a 3:1
 * reduction" is a crisp, common engineering task, and a meshing pair has EXACT
 * geometric constraints the smoke pins:
 *   center distance   C = m·(N₁ + N₂)/2      (the pitch circles are TANGENT)
 *   gear ratio        i = N₂ / N₁
 *   both gears must share the same module m and pressure angle φ to mesh
 *   tip/root clearance = 0.25·m for standard proportions
 * and the assembly's overall span (ra₁ + C + ra₂) re-appears as the measured
 * bounding box when the pair is built and meshed — one number that validates
 * the placement and both gear sizes at once.
 *
 * MESHING PHASE. For the STATIC assembly to interlock (a tooth of one gear in a
 * space of the other along the line of centers, rather than tip-to-tip), the
 * second gear is rotated so a tooth SPACE faces the first. Gear 1 has a tooth
 * centered on +X (toward gear 2). Gear 2, sitting at (C, 0), must present a
 * space toward −X: rotating its profile by 180° + a half-tooth (180°/N₂) puts a
 * tooth just off the centerline and a space on it. The 0.25·m clearance then
 * guarantees no material overlap.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-gear-train-core-smoketest.ts):
 * reuses the gear core (geometry, profile, the reusable bpy unit), no I/O.
 */

import type { DraftEntity, DraftLayer, DraftDocument, DraftPoint } from './engineeringDraftingCore';
import { linearDimension } from './engineeringDimensionCore';
import {
  gearGeometry, spurGearProfile, gearBpyPrelude, gearObjectBpyLines,
  type GearGeometry,
} from './engineeringGearCore';
import { pyStringLiteral } from './engineeringSolidModelingCore';

export type GearTrainResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type GearPairSpec = {
  module: number;
  pressureAngleDeg?: number;
  /** Driving (pinion) tooth count. */
  pinionTeeth: number;
  /** Driven gear tooth count — OR supply `ratio` to derive it. */
  gearTeeth?: number;
  /** Desired ratio N₂/N₁; gearTeeth = round(pinionTeeth·ratio) when gearTeeth is absent. */
  ratio?: number;
  faceWidth?: number;
  /** Bore diameters; a single value applies to both. */
  pinionBore?: number;
  gearBore?: number;
};

export type GearPairGeometry = {
  module: number;
  pressureAngleDeg: number;
  pinion: GearGeometry;
  gear: GearGeometry;
  teeth1: number;
  teeth2: number;
  ratio: number;
  centerDistance: number;
  pitchRadius1: number;
  pitchRadius2: number;
  addendumRadius1: number;
  addendumRadius2: number;
  tipClearance: number;
  /** Degrees gear 2 is rotated for a proper static mesh. */
  meshPhaseDeg: number;
};

function resolveTeeth(spec: GearPairSpec): { N1: number; N2: number } | { error: string } {
  const N1 = Math.trunc(Number(spec.pinionTeeth));
  if (!Number.isFinite(N1) || N1 < 4) return { error: 'pinionTeeth must be at least 4' };
  let N2: number;
  if (spec.gearTeeth !== undefined) {
    N2 = Math.trunc(Number(spec.gearTeeth));
  } else if (spec.ratio !== undefined && Number(spec.ratio) > 0) {
    N2 = Math.round(N1 * Number(spec.ratio));
  } else {
    return { error: 'supply gearTeeth or a positive ratio' };
  }
  if (!Number.isFinite(N2) || N2 < 4) return { error: 'gear teeth must be at least 4 (increase ratio or pinionTeeth)' };
  return { N1, N2 };
}

export function gearPairGeometry(spec: GearPairSpec): GearTrainResult<GearPairGeometry> {
  const t = resolveTeeth(spec);
  if ('error' in t) return { ok: false, error: t.error };
  const phi = spec.pressureAngleDeg ?? 20;
  const g1 = gearGeometry(t.N1, spec.module, phi);
  if (!g1.ok) return g1;
  const g2 = gearGeometry(t.N2, spec.module, phi);
  if (!g2.ok) return g2;
  const m = g1.value.module;
  const C = (m * (t.N1 + t.N2)) / 2;
  return {
    ok: true,
    value: {
      module: m, pressureAngleDeg: phi,
      pinion: g1.value, gear: g2.value,
      teeth1: t.N1, teeth2: t.N2,
      ratio: t.N2 / t.N1,
      centerDistance: C,
      pitchRadius1: g1.value.pitchRadius, pitchRadius2: g2.value.pitchRadius,
      addendumRadius1: g1.value.addendumRadius, addendumRadius2: g2.value.addendumRadius,
      tipClearance: 0.25 * m, // = C − ra1 − rf2, the standard bottom clearance
      meshPhaseDeg: 180 + 180 / t.N2,
    },
  };
}

// ─── Profile transform helpers ───────────────────────────────────────────────

function rotateTranslate(points: DraftPoint[], deg: number, dx: number, dy: number): DraftPoint[] {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return points.map((p) => ({
    x: Math.round((p.x * c - p.y * s + dx) * 1e6) / 1e6,
    y: Math.round((p.x * s + p.y * c + dy) * 1e6) / 1e6,
  }));
}

// ─── 2D assembly drawing ─────────────────────────────────────────────────────

export const GEAR_PAIR_LAYERS: DraftLayer[] = [
  { name: 'GEAR', color: 7, linetype: 'CONTINUOUS' },
  { name: 'CONSTRUCTION', color: 8, linetype: 'CENTER' },
  { name: 'HOLES', color: 1, linetype: 'CONTINUOUS' },
  { name: 'DIMS', color: 2, linetype: 'CONTINUOUS' },
  { name: 'TEXT', color: 3, linetype: 'CONTINUOUS' },
];

/** A meshing gear-pair assembly drawing: both gear outlines, tangent pitch
 *  circles, center marks, a center-distance dimension, and a ratio callout. */
export function buildGearPairDrawing(spec: GearPairSpec): GearTrainResult<DraftDocument> {
  const geo = gearPairGeometry(spec);
  if (!geo.ok) return geo;
  const g = geo.value;
  const p1 = spurGearProfile({ teeth: g.teeth1, module: g.module, pressureAngleDeg: g.pressureAngleDeg });
  const p2 = spurGearProfile({ teeth: g.teeth2, module: g.module, pressureAngleDeg: g.pressureAngleDeg });
  if (!p1.ok) return p1;
  if (!p2.ok) return p2;

  const C = g.centerDistance;
  const gear2pts = rotateTranslate(p2.value.points, g.meshPhaseDeg, C, 0);

  const entities: DraftEntity[] = [
    { kind: 'polyline', layer: 'GEAR', closed: true, points: p1.value.points },
    { kind: 'polyline', layer: 'GEAR', closed: true, points: gear2pts },
    // Tangent pitch circles: r1 + r2 = C.
    { kind: 'circle', layer: 'CONSTRUCTION', cx: 0, cy: 0, r: g.pitchRadius1 },
    { kind: 'circle', layer: 'CONSTRUCTION', cx: C, cy: 0, r: g.pitchRadius2 },
    // Center marks.
    { kind: 'line', layer: 'CONSTRUCTION', x1: -g.module, y1: 0, x2: g.module, y2: 0 },
    { kind: 'line', layer: 'CONSTRUCTION', x1: 0, y1: -g.module, x2: 0, y2: g.module },
    { kind: 'line', layer: 'CONSTRUCTION', x1: C - g.module, y1: 0, x2: C + g.module, y2: 0 },
    { kind: 'line', layer: 'CONSTRUCTION', x1: C, y1: -g.module, x2: C, y2: g.module },
  ];
  // Center-distance dimension between the two centers (the value is measured).
  const dim = linearDimension(0, 0, C, 0, { orientation: 'horizontal', offset: g.addendumRadius1 + g.module * 3, textHeight: g.module, arrowSize: g.module });
  entities.push(...dim.entities);
  // Optional bores.
  const b1 = Number(spec.pinionBore); if (Number.isFinite(b1) && b1 > 0 && b1 < g.pinion.rootDiameter) entities.push({ kind: 'circle', layer: 'HOLES', cx: 0, cy: 0, r: b1 / 2 });
  const b2 = Number(spec.gearBore ?? spec.pinionBore); if (Number.isFinite(b2) && b2 > 0 && b2 < g.gear.rootDiameter) entities.push({ kind: 'circle', layer: 'HOLES', cx: C, cy: 0, r: b2 / 2 });
  // Callout.
  entities.push({ kind: 'text', layer: 'TEXT', x: C / 2, y: Math.max(g.addendumRadius1, g.addendumRadius2) + g.module * 2, height: g.module, text: `Z${g.teeth1}:Z${g.teeth2} m${g.module} ratio ${Math.round(g.ratio * 1000) / 1000}:1 C${Math.round(C * 100) / 100}` });

  return { ok: true, value: { layers: GEAR_PAIR_LAYERS, blocks: [], entities } };
}

// ─── 3D positioned pair (one assembly STL) ───────────────────────────────────

/** A bpy script building BOTH gears in their meshed positions and exporting
 *  one assembly STL. Reuses the proven per-gear bmesh-extrude + EXACT-bore unit. */
export function buildGearPairBlenderScript(spec: GearPairSpec, outputStlPath: string): GearTrainResult<string> {
  const geo = gearPairGeometry(spec);
  if (!geo.ok) return geo;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) return { ok: false, error: 'outputStlPath is required' };
  const g = geo.value;
  const width = (spec.faceWidth && spec.faceWidth > 0) ? spec.faceWidth : g.module * 4;

  const p1 = spurGearProfile({ teeth: g.teeth1, module: g.module, pressureAngleDeg: g.pressureAngleDeg });
  const p2 = spurGearProfile({ teeth: g.teeth2, module: g.module, pressureAngleDeg: g.pressureAngleDeg });
  if (!p1.ok) return p1;
  if (!p2.ok) return p2;
  const C = g.centerDistance;
  const gear2pts = rotateTranslate(p2.value.points, g.meshPhaseDeg, C, 0);

  const boreR1 = (() => { const b = Number(spec.pinionBore); return Number.isFinite(b) && b > 0 && b < g.pinion.rootDiameter ? b / 2 : 0; })();
  const boreR2 = (() => { const b = Number(spec.gearBore ?? spec.pinionBore); return Number.isFinite(b) && b > 0 && b < g.gear.rootDiameter ? b / 2 : 0; })();

  const lines = [
    ...gearBpyPrelude(),
    ...gearObjectBpyLines(p1.value.points, width, boreR1, 0, 0, '1'),
    ...gearObjectBpyLines(gear2pts, width, boreR2, C, 0, '2'),
    `OUT = ${pyStringLiteral(outputStlPath)}`,
    'bpy.ops.wm.stl_export(filepath=OUT)',
    '',
  ];
  return { ok: true, value: lines.join('\n') };
}
