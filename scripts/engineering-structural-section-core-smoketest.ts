/**
 * engineering-structural-section-core smoke.
 *
 * Section properties are textbook-exact, so this pins A / Ix / Iy / Sx and the
 * centroid of an I-beam, a channel, and an angle against hand-computed
 * references (the parallel-axis theorem over each section's rectangle
 * decomposition). The decisive cross-check: each section's OUTLINE polygon
 * shoelace area must equal its rectangle-sum area — two independent routes to A.
 * The doubly-symmetric I, the singly-symmetric channel, and the asymmetric angle
 * cover every centroid case. The live drill measures the extruded beam volume.
 */

import {
  sectionProperties, iBeamSection, channelSection, angleSection,
  resolveSection, beamGeometry, buildBeamBlenderScript, beamExtrudeVolume,
} from '../src/lib/engineeringStructuralSectionCore';
import { polygonArea } from '../src/lib/engineeringProfileSolidCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── I-beam H200×B100, tw6, tf10 — hand-computed ─────────────────
  {
    const sec = ok(iBeamSection({ height: 200, width: 100, webThickness: 6, flangeThickness: 10 }), 'I-beam');
    const p = ok(sectionProperties(sec.rects), 'I props');
    near(p.area, 3080, 'I area = 2·(100·10) + 6·180 = 3080');
    near(p.centroidX, 0, 'I centroid x = 0 (symmetric)');
    near(p.centroidY, 0, 'I centroid y = 0 (symmetric)');
    near(p.Ix, 20982666.67, 'I Ix = 20,982,666.67 mm⁴ (parallel axis)');
    near(p.Iy, 1669906.67, 'I Iy = 1,669,906.67 mm⁴');
    near(p.Sx, 209826.67, 'I Sx = Ix/(H/2) = 209,826.67 mm³');
    // the independent cross-check: outline shoelace = rectangle-sum area
    near(polygonArea(sec.outline), p.area, 'I outline shoelace area = rectangle-sum area');
  }

  // ─── Channel H100×B50, tw6, tf8 — singly symmetric ───────────────
  {
    const sec = ok(channelSection({ height: 100, width: 50, webThickness: 6, flangeThickness: 8 }), 'channel');
    const p = ok(sectionProperties(sec.rects), 'C props');
    near(p.area, 1304, 'C area = 6·100 + 2·(44·8) = 1304');
    near(p.centroidY, 50, 'C centroid y = 50 (symmetric about mid-height)');
    near(p.centroidX, 21512 / 1304, 'C centroid x shifts toward the web (16.497)');
    near(p.Ix, 1993418.67, 'C Ix = 1,993,418.67 mm⁴');
    near(polygonArea(sec.outline), p.area, 'C outline shoelace area = rectangle-sum area');
  }

  // ─── Angle 60×40×6 — fully asymmetric ────────────────────────────
  {
    const sec = ok(angleSection({ legX: 60, legY: 40, thickness: 6 }), 'angle');
    const p = ok(sectionProperties(sec.rects), 'L props');
    near(p.area, 564, 'L area = 60·6 + 6·34 = 564');
    near(p.centroidX, 11412 / 564, 'L centroid x = 20.234');
    near(p.centroidY, 5772 / 564, 'L centroid y = 10.234');
    near(p.Ix, 72817.1, 'L Ix ≈ 72,817 mm⁴ (parallel axis, off-centroid legs)', 5e-4);
    near(polygonArea(sec.outline), p.area, 'L outline shoelace area = rectangle-sum area');
  }

  // ─── Hollow via signed rectangles (box tube) ─────────────────────
  {
    // 100×60 outer, 6mm wall → inner 88×48 hole. A = 100·60 − 88·48 = 6000 − 4224 = 1776.
    const p = ok(sectionProperties([{ x: 0, y: 0, w: 60, h: 100 }, { x: 0, y: 0, w: 48, h: 88, hole: true }]), 'box tube');
    near(p.area, 1776, 'box tube net area = outer − inner = 1776');
    near(p.Ix, (60 * 100 ** 3 - 48 * 88 ** 3) / 12, 'box tube Ix = (b·h³ − bᵢ·hᵢ³)/12');
  }

  // ─── Resolve + beam geometry + composition ───────────────────────
  {
    near(ok(beamGeometry({ section: 'i_beam', height: 200, width: 100, webThickness: 6, flangeThickness: 10, length: 1000 }), 'I beam geo').volume, 3080 * 1000, 'beam volume = area · length');
    assert(resolveSection({ section: 'wide-flange', height: 200, width: 100, webThickness: 6, flangeThickness: 10 }).ok, "alias 'wide-flange' resolves to I-beam");
    assert(resolveSection({ section: 'c_channel', height: 100, width: 50, webThickness: 6, flangeThickness: 8 }).ok, "alias 'c_channel' resolves to channel");
    assert(!resolveSection({ section: 'octagon' }).ok, 'unknown section → rejected');
    // the extruded outline volume equals the analytic area·length (arc-free polygons → exact)
    const g = ok(beamGeometry({ section: 'channel', height: 100, width: 50, webThickness: 6, flangeThickness: 8, length: 500 }), 'C beam');
    near(ok(beamExtrudeVolume({ section: 'channel', height: 100, width: 50, webThickness: 6, flangeThickness: 8, length: 500 }), 'C extrude vol'), g.volume, 'extruded channel volume = area·length');
  }

  // ─── bpy construction (extruded, bore inert) ─────────────────────
  {
    const s = ok(buildBeamBlenderScript({ section: 'i_beam', height: 200, width: 100, webThickness: 6, flangeThickness: 10, length: 1000 }, '/tmp/uc-beam-smoke.stl'), 'beam bpy');
    assert(s.includes('extrude_face_region'), 'built by extruding the section face');
    assert(s.includes('BORE_R = 0'), 'no bore → pure extrude at runtime');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-beam-smoke.stl"'), 'exports STL to the embedded path');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'beam bpy balanced');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!iBeamSection({ height: 15, width: 100, webThickness: 6, flangeThickness: 10 }).ok, 'flanges thicker than height → rejected');
    assert(!angleSection({ legX: 5, legY: 40, thickness: 6 }).ok, 'thickness ≥ leg → rejected');
    assert(!sectionProperties([{ x: 0, y: 0, w: 10, h: 10, hole: true }]).ok, 'all-hole → net area ≤ 0 rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-structural-section-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-structural-section-core smoke cases passed.');
}

main();
