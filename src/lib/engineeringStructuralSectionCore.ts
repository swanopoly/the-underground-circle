/**
 * engineeringStructuralSectionCore — STRUCTURAL STEEL sections (I-beam, channel,
 * angle, …) and the beams you extrude from them. This is the structural-
 * engineering arm: it turns a named section into exact section PROPERTIES for
 * analysis and an exact PROFILE for geometry, and the two feed the tools that
 * already exist — the beam calc (deflection δ=PL³/48EI needs the section's I) and
 * the profile-solid extruder (a beam is its section extruded along its length).
 *
 * ONE VERIFIED PRIMITIVE, MANY SECTIONS. Every open steel section is a set of
 * axis-aligned rectangles (an I-beam is two flanges + a web; an angle is two
 * legs), so all the section properties come from a single function over a
 * rectangle list: total area A = Σ wᵢhᵢ, centroid (x̄,ȳ) = Σ(Aᵢcᵢ)/A, and the
 * second moments about the CENTROID by the parallel-axis theorem
 * Iₓ = Σ(wᵢhᵢ³/12 + Aᵢ(yᵢ−ȳ)²). Rectangles may be holes (signed area) so the
 * same primitive also does hollow sections. Each named section is then just a
 * rectangle decomposition plus its outline polygon — and the polygon's shoelace
 * area is an INDEPENDENT check on the rectangle-sum A (two ways to the same
 * number). The doubly-symmetric I-beam, the singly-symmetric channel, and the
 * fully asymmetric angle exercise every centroid case.
 *
 * CONSTRUCTION — no boolean. A beam is the section polygon EXTRUDED by the length
 * through the proven profile-solid extruder, so its measured STL volume must
 * equal A·length (the live cross-check) and it inherits a verified mesh path.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-structural-section-core-smoketest.ts):
 * composes the profile-solid extruder + drafting DraftPoint, no I/O.
 */

import type { DraftPoint } from './engineeringDraftingCore';
import { polygonArea, extrudeVolume, buildExtrudeBlenderScript } from './engineeringProfileSolidCore';

export type SectionResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

// ─── The verified primitive: properties of a set of rectangles ────────────────

/** An axis-aligned rectangle centred at (x, y), size w×h; `hole` subtracts it. */
export type SectionRect = { x: number; y: number; w: number; h: number; hole?: boolean };

export type SectionProperties = {
  area: number;
  centroidX: number;
  centroidY: number;
  Ix: number; // 2nd moment about the centroidal horizontal (strong) axis
  Iy: number; // about the centroidal vertical axis
  Sx: number; // section modulus, strong axis
  Sy: number;
  rx: number; // radius of gyration
  ry: number;
  extentTop: number; extentBottom: number; extentLeft: number; extentRight: number;
};

/** Exact area / centroid / second-moments / section-moduli of a rectangle set. */
export function sectionProperties(rects: readonly SectionRect[]): SectionResult<SectionProperties> {
  if (!Array.isArray(rects) || rects.length === 0) return { ok: false, error: 'need at least one rectangle' };
  let A = 0, Ax = 0, Ay = 0;
  for (const r of rects) {
    const w = pos(r.w), h = pos(r.h);
    if (w === null || h === null) return { ok: false, error: 'each rectangle needs positive w and h' };
    const s = r.hole ? -1 : 1;
    const a = s * w * h;
    A += a; Ax += a * Number(r.x); Ay += a * Number(r.y);
  }
  if (!(A > 0)) return { ok: false, error: 'net area must be positive (holes exceed material)' };
  const cx = Ax / A, cy = Ay / A;
  let Ix = 0, Iy = 0;
  let top = -Infinity, bottom = Infinity, left = Infinity, right = -Infinity;
  for (const r of rects) {
    const w = Number(r.w), h = Number(r.h), s = r.hole ? -1 : 1, a = s * w * h;
    Ix += s * (w * h ** 3) / 12 + a * (Number(r.y) - cy) ** 2;
    Iy += s * (h * w ** 3) / 12 + a * (Number(r.x) - cx) ** 2;
    // material extents (holes don't extend the envelope)
    if (!r.hole) {
      top = Math.max(top, r.y + h / 2); bottom = Math.min(bottom, r.y - h / 2);
      left = Math.min(left, r.x - w / 2); right = Math.max(right, r.x + w / 2);
    }
  }
  const yMax = Math.max(top - cy, cy - bottom);
  const xMax = Math.max(right - cx, cx - left);
  return {
    ok: true,
    value: {
      area: r4(A), centroidX: r4(cx), centroidY: r4(cy),
      Ix: r4(Ix), Iy: r4(Iy),
      Sx: r4(Ix / yMax), Sy: r4(Iy / xMax),
      rx: r4(Math.sqrt(Ix / A)), ry: r4(Math.sqrt(Iy / A)),
      extentTop: r4(top), extentBottom: r4(bottom), extentLeft: r4(left), extentRight: r4(right),
    },
  };
}

// ─── Named sections: a rectangle decomposition + an outline polygon ───────────

export type NamedSection = { rects: SectionRect[]; outline: DraftPoint[]; label: string };

/** Symmetric I-beam / wide-flange: overall H×B, web tw, flange tf. Centroid at origin. */
export function iBeamSection(a: { height: number; width: number; webThickness: number; flangeThickness: number }): SectionResult<NamedSection> {
  const H = pos(a.height), B = pos(a.width), tw = pos(a.webThickness), tf = pos(a.flangeThickness);
  if (H === null || B === null || tw === null || tf === null) return { ok: false, error: 'I-beam needs positive height, width, webThickness, flangeThickness' };
  if (2 * tf >= H) return { ok: false, error: 'flanges too thick for the height' };
  if (tw >= B) return { ok: false, error: 'web wider than the flange' };
  const hw = H - 2 * tf; // clear web height
  const rects: SectionRect[] = [
    { x: 0, y: (H - tf) / 2, w: B, h: tf },
    { x: 0, y: -(H - tf) / 2, w: B, h: tf },
    { x: 0, y: 0, w: tw, h: hw },
  ];
  const b = B / 2, hh = H / 2, t = tw / 2, yf = H / 2 - tf;
  const outline: DraftPoint[] = [
    { x: -b, y: -hh }, { x: b, y: -hh }, { x: b, y: -yf }, { x: t, y: -yf },
    { x: t, y: yf }, { x: b, y: yf }, { x: b, y: hh }, { x: -b, y: hh },
    { x: -b, y: yf }, { x: -t, y: yf }, { x: -t, y: -yf }, { x: -b, y: -yf },
  ];
  return { ok: true, value: { rects, outline, label: `I ${H}×${B}×${tw}/${tf}` } };
}

/** Channel (C): web on the left (full height H), flanges of length B. Opens +x. */
export function channelSection(a: { height: number; width: number; webThickness: number; flangeThickness: number }): SectionResult<NamedSection> {
  const H = pos(a.height), B = pos(a.width), tw = pos(a.webThickness), tf = pos(a.flangeThickness);
  if (H === null || B === null || tw === null || tf === null) return { ok: false, error: 'channel needs positive height, width, webThickness, flangeThickness' };
  if (2 * tf >= H) return { ok: false, error: 'flanges too thick for the height' };
  if (tw >= B) return { ok: false, error: 'web wider than the flange length' };
  const fl = B - tw; // flange length past the web
  const rects: SectionRect[] = [
    { x: tw / 2, y: H / 2, w: tw, h: H },
    { x: tw + fl / 2, y: H - tf / 2, w: fl, h: tf },
    { x: tw + fl / 2, y: tf / 2, w: fl, h: tf },
  ];
  const outline: DraftPoint[] = [
    { x: 0, y: 0 }, { x: B, y: 0 }, { x: B, y: tf }, { x: tw, y: tf },
    { x: tw, y: H - tf }, { x: B, y: H - tf }, { x: B, y: H }, { x: 0, y: H },
  ];
  return { ok: true, value: { rects, outline, label: `C ${H}×${B}×${tw}/${tf}` } };
}

/** Angle (L): horizontal leg length a, vertical leg b, uniform thickness t. Asymmetric. */
export function angleSection(a: { legX: number; legY: number; thickness: number }): SectionResult<NamedSection> {
  const ax = pos(a.legX), by = pos(a.legY), t = pos(a.thickness);
  if (ax === null || by === null || t === null) return { ok: false, error: 'angle needs positive legX, legY, thickness' };
  if (t >= ax || t >= by) return { ok: false, error: 'thickness must be smaller than each leg' };
  const rects: SectionRect[] = [
    { x: ax / 2, y: t / 2, w: ax, h: t },        // horizontal leg
    { x: t / 2, y: (t + by) / 2, w: t, h: by - t }, // vertical leg (above the corner)
  ];
  const outline: DraftPoint[] = [
    { x: 0, y: 0 }, { x: ax, y: 0 }, { x: ax, y: t }, { x: t, y: t }, { x: t, y: by }, { x: 0, y: by },
  ];
  return { ok: true, value: { rects, outline, label: `L ${ax}×${by}×${t}` } };
}

const SECTION_BUILDERS: Record<string, (spec: any) => SectionResult<NamedSection>> = {
  i_beam: iBeamSection, ibeam: iBeamSection, wide_flange: iBeamSection,
  channel: channelSection, c_channel: channelSection,
  angle: angleSection, l_angle: angleSection,
};

/** Resolve a { section: 'i_beam' | 'channel' | 'angle', ... } spec to its geometry. */
export function resolveSection(spec: any): SectionResult<NamedSection> {
  const kind = String(spec?.section ?? spec?.type ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const build = SECTION_BUILDERS[kind];
  if (!build) return { ok: false, error: `unknown section '${kind}' — use i_beam, channel, or angle` };
  return build(spec);
}

export type BeamGeometry = SectionProperties & { label: string; length: number; volume: number; outlineArea: number };

/** Section properties + beam volume for a { section, length, ... } spec. */
export function beamGeometry(spec: any): SectionResult<BeamGeometry> {
  const sec = resolveSection(spec);
  if (!sec.ok) return sec;
  const length = pos(spec?.length);
  if (length === null) return { ok: false, error: 'beam needs a positive length' };
  const props = sectionProperties(sec.value.rects);
  if (!props.ok) return props;
  const outlineArea = polygonArea(sec.value.outline);
  return { ok: true, value: { ...props.value, label: sec.value.label, length, volume: r4(props.value.area * length), outlineArea: r4(outlineArea) } };
}

/** The 3D beam: extrude the section outline along the length (no boolean). */
export function buildBeamBlenderScript(spec: any, outputStlPath: string): SectionResult<string> {
  const sec = resolveSection(spec);
  if (!sec.ok) return sec;
  const length = pos(spec?.length);
  if (length === null) return { ok: false, error: 'beam needs a positive length' };
  const built = buildExtrudeBlenderScript(sec.value.outline, length, outputStlPath);
  return built.ok ? { ok: true, value: built.value } : { ok: false, error: built.error };
}

/** Volume the extruded beam should measure — for the drill/callers. */
export function beamExtrudeVolume(spec: any): SectionResult<number> {
  const sec = resolveSection(spec);
  if (!sec.ok) return sec;
  const length = pos(spec?.length);
  if (length === null) return { ok: false, error: 'beam needs a positive length' };
  return { ok: true, value: extrudeVolume(sec.value.outline, length) };
}
