/**
 * engineeringCamCore — DISC CAMS, opening the MOTION arm of the suite. A cam
 * turns rotation into a programmed follower motion; its shape is the polar plot
 * of a displacement program — dwell, rise, dwell, fall — wrapped around a base
 * circle. So a cam is a polar profile EXTRUDED into a disc with a shaft bore,
 * which reuses the profile-solid extruder (no new mesh path, no boolean beyond
 * the proven bore).
 *
 * THE MOTION LAWS ARE THE ENGINEERING. A rise of lift h over cam angle β is not
 * a straight ramp in good practice — a uniform-velocity rise has infinite
 * acceleration at its ends (an impact). The standard laws smooth that:
 *   uniform     s = h·f
 *   harmonic    s = (h/2)(1 − cos(π·f))          (simple harmonic motion)
 *   cycloidal   s = h·(f − sin(2π·f)/(2π))        (zero accel at both ends)
 * with f = φ/β the fraction through the segment. All three pass through 0 at the
 * start and h at the end, and the symmetric ones cross h/2 at the midpoint — the
 * facts the smoke pins. The cam radius is then r(θ) = base radius + s(θ).
 *
 * VERIFICATION. The profile area is a shoelace sum with no simpler closed form
 * (it depends on the whole program), so the solid is checked by the extrude
 * identity — measured STL volume = profileArea·thickness − bore — together with
 * the exact facts that the greatest radius is base + max lift, the disc height is
 * the thickness, and the bore is really open. The motion laws themselves are
 * pinned against their textbook values.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-cam-core-smoketest.ts):
 * composes the profile-solid extruder + drafting DraftPoint, no I/O.
 */

import type { DraftPoint } from './engineeringDraftingCore';
import { polygonArea, extrudeVolume, buildExtrudeBlenderScript } from './engineeringProfileSolidCore';

export type CamResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

export type CamMotion = 'uniform' | 'harmonic' | 'cycloidal';

/** Follower displacement fraction (0→1) of the lift, at fraction f (0→1) of the segment. */
export function motionFraction(motion: CamMotion, f: number): number {
  const x = Math.max(0, Math.min(1, f));
  if (motion === 'uniform') return x;
  if (motion === 'cycloidal') return x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
  return (1 - Math.cos(Math.PI * x)) / 2; // harmonic (default)
}

export type CamSegment = {
  kind: 'dwell' | 'rise' | 'fall';
  angle: number; // degrees of cam rotation this segment occupies
  lift?: number; // rise/fall amount (mm)
  motion?: CamMotion;
};

export type CamSpec = {
  baseRadius: number;
  thickness: number;
  boreDiameter?: number;
  segments: CamSegment[];
  stepsPerSegment?: number;
};

export type CamGeometry = {
  baseRadius: number;
  maxRadius: number;
  maxLift: number;
  thickness: number;
  boreDiameter: number;
  profileArea: number;
  volume: number;
  totalAngle: number;
};

type BuiltCam = { profile: DraftPoint[]; geo: CamGeometry };

function buildCam(spec: CamSpec): CamResult<BuiltCam> {
  const rb = pos(spec.baseRadius);
  const thickness = pos(spec.thickness);
  if (rb === null || thickness === null) return { ok: false, error: 'cam needs a positive baseRadius and thickness' };
  if (!Array.isArray(spec.segments) || spec.segments.length === 0) return { ok: false, error: 'cam needs a displacement program (segments)' };
  const bore = spec.boreDiameter !== undefined ? pos(spec.boreDiameter) : 0;
  if (bore !== null && bore > 0 && bore >= 2 * rb) return { ok: false, error: 'bore must be smaller than the base circle' };

  const steps = Math.max(2, Math.min(200, Math.trunc(Number(spec.stepsPerSegment) || 24)));
  const pts: DraftPoint[] = [];
  let thetaDeg = 0, disp = 0, maxLift = 0, totalAngle = 0;

  for (let si = 0; si < spec.segments.length; si += 1) {
    const seg = spec.segments[si];
    const ang = pos(seg.angle);
    if (ang === null) return { ok: false, error: `segment ${si} needs a positive angle` };
    const motion: CamMotion = seg.motion === 'uniform' || seg.motion === 'cycloidal' ? seg.motion : 'harmonic';
    const start = disp;
    let lift = 0;
    if (seg.kind === 'rise' || seg.kind === 'fall') {
      const L = pos(seg.lift);
      if (L === null) return { ok: false, error: `${seg.kind} segment ${si} needs a positive lift` };
      lift = seg.kind === 'rise' ? L : -L;
    } else if (seg.kind !== 'dwell') {
      return { ok: false, error: `segment ${si} kind must be dwell, rise, or fall` };
    }
    for (let k = 0; k < steps; k += 1) {
      const f = k / steps; // 0 .. <1 (next segment's k=0 supplies this segment's end)
      const s = start + lift * motionFraction(motion, f);
      const r = rb + s;
      if (r <= 0) return { ok: false, error: 'displacement drives the radius to ≤ 0 (fall exceeds the base circle)' };
      const th = (thetaDeg + ang * f) * Math.PI / 180;
      pts.push({ x: r4(r * Math.cos(th)), y: r4(r * Math.sin(th)) });
      maxLift = Math.max(maxLift, s);
    }
    disp = start + lift;
    thetaDeg += ang;
    totalAngle += ang;
  }
  if (Math.abs(disp) > 1e-6) return { ok: false, error: `the program must return to its start displacement (ends at ${r4(disp)} mm — add a matching fall/rise)` };
  if (Math.abs(totalAngle - 360) > 1e-6) return { ok: false, error: `segments must sum to 360° (got ${r4(totalAngle)}°)` };

  const area = polygonArea(pts);
  const boreArea = bore && bore > 0 ? Math.PI * (bore / 2) ** 2 : 0;
  return {
    ok: true,
    value: {
      profile: pts,
      geo: {
        baseRadius: rb, maxRadius: r4(rb + maxLift), maxLift: r4(maxLift), thickness,
        boreDiameter: bore ?? 0,
        profileArea: r4(area),
        volume: r4((area - boreArea) * thickness),
        totalAngle: r4(totalAngle),
      },
    },
  };
}

/** Derived cam geometry (radii, area, volume) with no I/O. */
export function camGeometry(spec: CamSpec): CamResult<CamGeometry> {
  const b = buildCam(spec);
  return b.ok ? { ok: true, value: b.value.geo } : b;
}

/** The cam radial profile as a closed polar polygon. */
export function camProfilePoints(spec: CamSpec): CamResult<DraftPoint[]> {
  const b = buildCam(spec);
  return b.ok ? { ok: true, value: b.value.profile } : b;
}

/** The 3D cam: extrude the polar profile by the thickness, with a shaft bore. */
export function buildCamBlenderScript(spec: CamSpec, outputStlPath: string): CamResult<string> {
  const b = buildCam(spec);
  if (!b.ok) return b;
  const built = buildExtrudeBlenderScript(b.value.profile, b.value.geo.thickness, outputStlPath, { boreDiameter: b.value.geo.boreDiameter || undefined });
  return built.ok ? { ok: true, value: built.value } : { ok: false, error: built.error };
}

/** Volume the extruded cam should measure — for the drill/callers. */
export function camExtrudeVolume(spec: CamSpec): CamResult<number> {
  const b = buildCam(spec);
  if (!b.ok) return b;
  const boreArea = b.value.geo.boreDiameter > 0 ? Math.PI * (b.value.geo.boreDiameter / 2) ** 2 : 0;
  return { ok: true, value: r4(extrudeVolume(b.value.profile, b.value.geo.thickness) - boreArea * b.value.geo.thickness) };
}
