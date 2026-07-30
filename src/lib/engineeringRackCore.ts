/**
 * engineeringRackCore — the GEAR RACK, the linear "infinite-radius gear" that
 * meshes with a pinion to turn rotation into straight-line motion (rack and
 * pinion). It completes the gear family: the spur gear and gear pair were rotary,
 * this is their linear partner, and it shares their module and pressure angle.
 *
 * WHY THE RACK IS EXACTLY TRAPEZOIDAL. The involute of a straight line (the rack
 * is a gear of infinite radius, so its pitch "circle" is a straight line) is
 * itself a straight line, so a rack tooth has STRAIGHT flanks inclined at the
 * pressure angle φ — a trapezoid, no curve. With module m: circular pitch
 * p = π·m, tooth thickness = space = p/2 at the pitch line, addendum m above it,
 * dedendum 1.25·m below. A flank rises at φ, so a tooth is WIDER at its root
 * (p/2 + 2·b·tanφ) than at its tip (p/2 − 2·a·tanφ).
 *
 * VERIFICATION — TWO INDEPENDENT AREAS. The profile is a solid base strip with N
 * teeth on top, so its cross-section area is computable two ways that share no
 * code: the shoelace of the generated outline polygon, and the closed form
 * baseRect + N·(trapezoid tooth) = L·(root−bottom) + N·((w_root+w_tip)/2)·(a+b).
 * The smoke asserts they are equal (as the structural section asserts outline
 * shoelace = rectangle-sum), and the live drill measures the extruded rack's
 * volume against area·faceWidth.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-rack-core-smoketest.ts):
 * composes the profile-solid extruder + drafting DraftPoint, no I/O.
 */

import type { DraftPoint } from './engineeringDraftingCore';
import { polygonArea, extrudeVolume, buildExtrudeBlenderScript } from './engineeringProfileSolidCore';

export type RackResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

export type RackSpec = {
  module: number;
  teeth: number; // number of rack teeth (sets the length = teeth·π·module)
  pressureAngleDeg?: number; // default 20
  faceWidth: number; // extrude depth (rack thickness)
  backThickness?: number; // solid body below the tooth roots (default 2·module)
};

export type RackGeometry = {
  module: number;
  teeth: number;
  pressureAngleDeg: number;
  circularPitch: number;
  length: number;
  addendum: number;
  dedendum: number;
  toothHeight: number;
  tipWidth: number;
  rootWidth: number;
  faceWidth: number;
  height: number; // total profile height (bottom to tip)
  crossSectionArea: number; // shoelace of the outline
  trapezoidArea: number; // independent: base rect + N tooth trapezoids
  volume: number;
};

type BuiltRack = { profile: DraftPoint[]; geo: RackGeometry };

function buildRack(spec: RackSpec): RackResult<BuiltRack> {
  const m = pos(spec.module);
  const N = spec.teeth !== undefined && Number.isInteger(Number(spec.teeth)) && Number(spec.teeth) > 0 ? Number(spec.teeth) : null;
  const faceWidth = pos(spec.faceWidth);
  if (m === null || N === null || faceWidth === null) return { ok: false, error: 'rack needs a positive module, a positive integer teeth count, and a positive faceWidth' };
  const phi = (pos(spec.pressureAngleDeg) ?? 20) * Math.PI / 180;
  const tan = Math.tan(phi);
  const a = m;            // addendum
  const b = 1.25 * m;     // dedendum
  const p = Math.PI * m;  // circular pitch
  const back = pos(spec.backThickness) ?? 2 * m;

  const yTip = a, yRoot = -b, yBottom = yRoot - back;
  const L = N * p;

  // half-space at each end → symmetric: tooth i pitch-line edges at [i·p+p/4, i·p+3p/4]
  const wTip = p / 2 - 2 * a * tan;
  const wRoot = p / 2 + 2 * b * tan;
  if (wTip <= 0) return { ok: false, error: 'tooth tip vanishes — pressure angle too high for this module' };
  if (p / 2 - 2 * b * tan <= 0) return { ok: false, error: 'tooth roots merge — pressure angle too high' };

  const top: DraftPoint[] = [{ x: 0, y: yRoot }];
  for (let i = 0; i < N; i += 1) {
    const xL = i * p + p / 4, xR = i * p + 3 * p / 4;
    top.push({ x: r4(xL - b * tan), y: yRoot }); // approach the root
    top.push({ x: r4(xL + a * tan), y: yTip });  // up the left flank
    top.push({ x: r4(xR - a * tan), y: yTip });  // across the tip
    top.push({ x: r4(xR + b * tan), y: yRoot }); // down the right flank
  }
  top.push({ x: r4(L), y: yRoot });

  const profile: DraftPoint[] = [{ x: 0, y: r4(yBottom) }, ...top, { x: r4(L), y: r4(yBottom) }];

  const shoelace = polygonArea(profile);
  const trapezoid = L * (yRoot - yBottom) + N * ((wRoot + wTip) / 2) * (a + b);

  return {
    ok: true,
    value: {
      profile,
      geo: {
        module: m, teeth: N, pressureAngleDeg: r4(phi * 180 / Math.PI),
        circularPitch: r4(p), length: r4(L),
        addendum: r4(a), dedendum: r4(b), toothHeight: r4(a + b),
        tipWidth: r4(wTip), rootWidth: r4(wRoot),
        faceWidth, height: r4(yTip - yBottom),
        crossSectionArea: r4(shoelace),
        trapezoidArea: r4(trapezoid),
        volume: r4(shoelace * faceWidth),
      },
    },
  };
}

export function rackGeometry(spec: RackSpec): RackResult<RackGeometry> {
  const b = buildRack(spec);
  return b.ok ? { ok: true, value: b.value.geo } : b;
}

export function rackProfilePoints(spec: RackSpec): RackResult<DraftPoint[]> {
  const b = buildRack(spec);
  return b.ok ? { ok: true, value: b.value.profile } : b;
}

/** The 3D rack: extrude the toothed profile by the face width (no boolean). */
export function buildRackBlenderScript(spec: RackSpec, outputStlPath: string): RackResult<string> {
  const b = buildRack(spec);
  if (!b.ok) return b;
  const built = buildExtrudeBlenderScript(b.value.profile, b.value.geo.faceWidth, outputStlPath);
  return built.ok ? { ok: true, value: built.value } : { ok: false, error: built.error };
}

export function rackExtrudeVolume(spec: RackSpec): RackResult<number> {
  const b = buildRack(spec);
  if (!b.ok) return b;
  return { ok: true, value: r4(extrudeVolume(b.value.profile, b.value.geo.faceWidth)) };
}
