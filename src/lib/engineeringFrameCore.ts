/**
 * engineeringFrameCore — structural FRAMES and weldments, the structural
 * assembly (as the gear pair was the mechanical assembly). A frame is a set of
 * prismatic members welded into one body, so it is exactly a CSG union of box
 * members — which the solid-modeling lane already builds and which is already
 * proven watertight (plate/bracket/tube). This core adds the member ergonomics,
 * the steel takeoff, and — the interesting part — an EXACT expected volume.
 *
 * WHY THE VOLUME IS EXACT, NOT A BRACKET. When members overlap at a joint, the
 * union volume is LESS than the naive Σ of member volumes by exactly the
 * overlaps, and for axis-aligned boxes every overlap is another axis-aligned box
 * whose volume is a closed-form product. So the union volume is the
 * inclusion–exclusion sum V = Σ|Bᵢ| − Σ|Bᵢ∩Bⱼ| + Σ|Bᵢ∩Bⱼ∩Bₖ| − … , computed
 * here in closed form. Most frames have only pairwise joint overlaps (no point
 * lies in three members at once), so the series stops at the second term and is
 * exact for any number of members; when a genuine triple joint exists it falls
 * back to the full 2ⁿ series (n ≤ 16) or, beyond that, an honest bracket. The
 * live drill then measures the meshed frame against that exact number.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-frame-core-smoketest.ts):
 * composes the solid-modeling CSG builder + the materials table, no I/O.
 */

import type { SolidModel, SolidPrimitive } from './engineeringSolidModelingCore';
import { writeBlenderSolidScript } from './engineeringSolidModelingCore';
import { MATERIALS } from './engineeringCalcCore';

export type FrameResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

export type FrameAxis = 'x' | 'y' | 'z';

/** A prismatic member: a `width`×`depth` cross-section run `length` along `axis`
 *  from the start point `at`. width/depth map to the two non-axial axes in order. */
export type FrameMember = {
  axis: FrameAxis;
  length: number;
  width: number;
  depth: number;
  at?: [number, number, number];
  label?: string;
};

type Box = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

function memberBox(m: FrameMember): FrameResult<Box> {
  const L = pos(m.length), w = pos(m.width), d = pos(m.depth);
  if (L === null || w === null || d === null) return { ok: false, error: 'each member needs positive length, width, depth' };
  if (m.axis !== 'x' && m.axis !== 'y' && m.axis !== 'z') return { ok: false, error: `member axis must be x, y, or z (got ${m.axis})` };
  const [ax, ay, az] = m.at ?? [0, 0, 0];
  const sx = num(ax), sy = num(ay), sz = num(az);
  // width → first non-axial axis, depth → second; length runs along `axis` from `at`.
  if (m.axis === 'x') return { ok: true, value: { minX: sx, maxX: sx + L, minY: sy - w / 2, maxY: sy + w / 2, minZ: sz - d / 2, maxZ: sz + d / 2 } };
  if (m.axis === 'y') return { ok: true, value: { minX: sx - w / 2, maxX: sx + w / 2, minY: sy, maxY: sy + L, minZ: sz - d / 2, maxZ: sz + d / 2 } };
  return { ok: true, value: { minX: sx - w / 2, maxX: sx + w / 2, minY: sy - d / 2, maxY: sy + d / 2, minZ: sz, maxZ: sz + L } };
}

function boxToPrimitive(b: Box): SolidPrimitive {
  return { kind: 'box', w: b.maxX - b.minX, d: b.maxY - b.minY, h: b.maxZ - b.minZ, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, cz: (b.minZ + b.maxZ) / 2 };
}

function boxVolume(b: Box): number { return (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ); }

/** Axis-aligned intersection of a set of boxes (0 if they don't all overlap). */
function intersectionVolume(boxes: Box[]): number {
  let minX = -Infinity, minY = -Infinity, minZ = -Infinity, maxX = Infinity, maxY = Infinity, maxZ = Infinity;
  for (const b of boxes) {
    minX = Math.max(minX, b.minX); minY = Math.max(minY, b.minY); minZ = Math.max(minZ, b.minZ);
    maxX = Math.min(maxX, b.maxX); maxY = Math.min(maxY, b.maxY); maxZ = Math.min(maxZ, b.maxZ);
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
}

export type FrameUnionVolume = { volume: number; exact: boolean; method: string };

/** Exact union volume of the member boxes by inclusion–exclusion. */
export function frameUnionVolume(boxes: Box[]): FrameUnionVolume {
  const n = boxes.length;
  const sumSingle = boxes.reduce((a, b) => a + boxVolume(b), 0);
  // pairwise overlaps
  let sumPairs = 0;
  const overlappingPairs: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
    const v = intersectionVolume([boxes[i], boxes[j]]);
    if (v > 0) { sumPairs += v; overlappingPairs.push([i, j]); }
  }
  // any genuine triple overlap? (only among boxes that already pairwise-overlap)
  let hasTriple = false;
  for (let a = 0; a < overlappingPairs.length && !hasTriple; a += 1) {
    const [i, j] = overlappingPairs[a];
    for (let k = j + 1; k < n; k += 1) {
      if (intersectionVolume([boxes[i], boxes[j], boxes[k]]) > 0) { hasTriple = true; break; }
    }
  }
  if (!hasTriple) return { volume: r4(sumSingle - sumPairs), exact: true, method: 'inclusion-exclusion (pairwise; no triple joints)' };
  if (n <= 16) {
    let v = 0;
    for (let mask = 1; mask < (1 << n); mask += 1) {
      const subset: Box[] = [];
      let bits = 0;
      for (let i = 0; i < n; i += 1) if (mask & (1 << i)) { subset.push(boxes[i]); bits += 1; }
      const iv = intersectionVolume(subset);
      if (iv > 0) v += (bits % 2 === 1 ? 1 : -1) * iv;
    }
    return { volume: r4(v), exact: true, method: 'inclusion-exclusion (full 2ⁿ)' };
  }
  // too many members with triple joints for the exact series — honest bracket.
  const maxSingle = boxes.reduce((a, b) => Math.max(a, boxVolume(b)), 0);
  return { volume: r4(sumSingle - sumPairs), exact: false, method: `estimate (n=${n} with triple joints > 16; true volume in [${r4(maxSingle)}, ${r4(sumSingle)}])` };
}

export type FrameGeometry = {
  memberCount: number;
  totalMemberLength: number;
  sumMemberVolume: number;
  unionVolume: number;
  unionVolumeExact: boolean;
  unionVolumeMethod: string;
  mass_kg?: number;
  material?: string;
  bbox: { w: number; d: number; h: number };
  envelope: Box;
};

function buildBoxes(members: FrameMember[]): FrameResult<Box[]> {
  if (!Array.isArray(members) || members.length === 0) return { ok: false, error: 'a frame needs at least one member' };
  const boxes: Box[] = [];
  for (const m of members) { const b = memberBox(m); if (!b.ok) return b; boxes.push(b.value); }
  return { ok: true, value: boxes };
}

/** Steel-takeoff geometry for a member list (+ optional material for mass). */
export function frameGeometry(members: FrameMember[], material?: string): FrameResult<FrameGeometry> {
  const bx = buildBoxes(members);
  if (!bx.ok) return bx;
  const boxes = bx.value;
  const union = frameUnionVolume(boxes);
  const env: Box = {
    minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)), minZ: Math.min(...boxes.map((b) => b.minZ)),
    maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)), maxZ: Math.max(...boxes.map((b) => b.maxZ)),
  };
  const out: FrameGeometry = {
    memberCount: members.length,
    totalMemberLength: r4(members.reduce((a, m) => a + num(m.length), 0)),
    sumMemberVolume: r4(boxes.reduce((a, b) => a + boxVolume(b), 0)),
    unionVolume: union.volume,
    unionVolumeExact: union.exact,
    unionVolumeMethod: union.method,
    bbox: { w: r4(env.maxX - env.minX), d: r4(env.maxY - env.minY), h: r4(env.maxZ - env.minZ) },
    envelope: env,
  };
  if (material) {
    const m = MATERIALS[String(material).trim().toLowerCase()];
    if (m) { out.mass_kg = r4(union.volume * m.density); out.material = String(material).trim().toLowerCase(); }
  }
  return { ok: true, value: out };
}

/** The frame as a CSG SolidModel (box members unioned). */
export function frameSolidModel(members: FrameMember[]): FrameResult<SolidModel> {
  const bx = buildBoxes(members);
  if (!bx.ok) return bx;
  return { ok: true, value: { positives: bx.value.map(boxToPrimitive) } };
}

/** The 3D frame: union the box members through the proven CSG builder. */
export function buildFrameBlenderScript(members: FrameMember[], outputStlPath: string): FrameResult<string> {
  const model = frameSolidModel(members);
  if (!model.ok) return model;
  const built = writeBlenderSolidScript(model.value, outputStlPath);
  return built.ok ? { ok: true, value: built.value } : { ok: false, error: built.error };
}

// ─── Turnkey frames ───────────────────────────────────────────────────────────

/** A portal frame: two columns + a top beam spanning between their centrelines. */
export function portalFrame(a: { span: number; height: number; width: number; depth: number }): FrameResult<FrameMember[]> {
  const span = pos(a.span), height = pos(a.height), w = pos(a.width), d = pos(a.depth);
  if (span === null || height === null || w === null || d === null) return { ok: false, error: 'portal frame needs positive span, height, width, depth' };
  if (span <= w) return { ok: false, error: 'span must exceed the member width' };
  const members: FrameMember[] = [
    { axis: 'z', length: height, width: w, depth: d, at: [-span / 2, 0, 0], label: 'left column' },
    { axis: 'z', length: height, width: w, depth: d, at: [span / 2, 0, 0], label: 'right column' },
    // beam runs across the top between the column outer faces, at the top of the columns.
    { axis: 'x', length: span + w, width: w, depth: d, at: [-span / 2 - w / 2, 0, height - d / 2], label: 'top beam' },
  ];
  return { ok: true, value: members };
}

/** A closed rectangular frame in the XZ plane (four members, mitre-free butt at corners). */
export function rectangularFrame(a: { span: number; height: number; width: number; depth: number }): FrameResult<FrameMember[]> {
  const span = pos(a.span), height = pos(a.height), w = pos(a.width), d = pos(a.depth);
  if (span === null || height === null || w === null || d === null) return { ok: false, error: 'rectangular frame needs positive span, height, width, depth' };
  if (span <= w || height <= w) return { ok: false, error: 'span and height must exceed the member width' };
  const members: FrameMember[] = [
    { axis: 'z', length: height, width: w, depth: d, at: [-span / 2, 0, 0], label: 'left' },
    { axis: 'z', length: height, width: w, depth: d, at: [span / 2, 0, 0], label: 'right' },
    { axis: 'x', length: span + w, width: w, depth: d, at: [-span / 2 - w / 2, 0, height - d / 2], label: 'top' },
    { axis: 'x', length: span + w, width: w, depth: d, at: [-span / 2 - w / 2, 0, d / 2], label: 'bottom' },
  ];
  return { ok: true, value: members };
}

const FRAME_BUILDERS: Record<string, (spec: any) => FrameResult<FrameMember[]>> = {
  portal: portalFrame, portal_frame: portalFrame,
  rectangular: rectangularFrame, rectangular_frame: rectangularFrame, rectangle: rectangularFrame,
};

/** Resolve a { frame?: 'portal'|'rectangular', members?: [...] } spec to members. */
export function resolveFrameMembers(spec: any): FrameResult<FrameMember[]> {
  if (spec && Array.isArray(spec.members)) return { ok: true, value: spec.members as FrameMember[] };
  const kind = String(spec?.frame ?? spec?.type ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const build = FRAME_BUILDERS[kind];
  if (!build) return { ok: false, error: `provide members:[...] or a frame preset (portal, rectangular) — got '${kind}'` };
  return build(spec);
}
