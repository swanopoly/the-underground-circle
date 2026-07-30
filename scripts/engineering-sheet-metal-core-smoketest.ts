/**
 * engineering-sheet-metal-core smoke.
 *
 * Sheet-metal bending turns on the bend allowance BA = θ(R + K·t). This pins it
 * against a hand-computed reference, then pins the invariant that makes the whole
 * discipline coherent: the fabrication flat length (uses K) and the geometric
 * mid-surface length (uses t/2) differ by EXACTLY Σθ·t·(0.5 − K). It also checks
 * the ribbon cross-section closes and that the extruded ribbon's polygon area
 * matches the analytic t·L_geo (the live drill measures the real STL against it).
 */

import {
  bendAllowance, sheetMetalGeometry, bentProfilePolygon, bentPartVolume, buildBentPartBlenderScript,
  type SheetMetalSpec,
} from '../src/lib/engineeringSheetMetalCore';

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

const L_BRACKET: SheetMetalSpec = { thickness: 2, width: 40, kFactor: 0.44, sequence: [{ flange: 50 }, { bend: 90, radius: 3 }, { flange: 30 }] };

function main() {
  // ─── Bend allowance, hand-computed ───────────────────────────────
  {
    // 90° bend, R=3, t=2, K=0.44 → BA = (π/2)(3 + 0.44·2) = (π/2)·3.88.
    near(bendAllowance(90, 3, 2, 0.44), (Math.PI / 2) * (3 + 0.44 * 2), 'BA = θ(R + K·t)');
    // a 180° hem doubles the arc
    near(bendAllowance(180, 1, 1, 0.4), Math.PI * (1 + 0.4), '180° BA = π(R + K·t)');
  }

  // ─── The flat-vs-geometric length invariant ──────────────────────
  {
    const g = ok(sheetMetalGeometry(L_BRACKET), 'L-bracket');
    near(g.flangeTotal, 80, 'flange total = 50 + 30');
    assert(g.bendCount === 1, 'one bend');
    // geometric mid-surface length uses (R + t/2); flat length uses (R + K·t).
    near(g.geometricDevelopedLength, 80 + (Math.PI / 2) * (3 + 1), 'geo developed length = flanges + θ(R + t/2)');
    near(g.flatPatternLength, 80 + (Math.PI / 2) * (3 + 0.44 * 2), 'flat length = flanges + BA');
    // the whole point of K: the two differ by exactly Σθ·t·(0.5 − K).
    near(g.geometricDevelopedLength - g.flatPatternLength, (Math.PI / 2) * 2 * (0.5 - 0.44), 'geo − flat = Σθ·t·(0.5 − K)');
    assert(g.flatPatternLength < g.geometricDevelopedLength, 'K < 0.5 → flat blank shorter than the mid-surface');
    near(g.crossSectionArea, 2 * g.geometricDevelopedLength, 'cross-section area = t · L_geo');
    near(g.volume, g.crossSectionArea * 40, 'volume = area · width');
    near(g.bbox.d, 40, 'bbox depth = width');
  }

  // ─── The ribbon closes and matches the analytic area ─────────────
  {
    const prof = ok(bentProfilePolygon(L_BRACKET), 'L-bracket profile');
    assert(prof.length >= 6 && prof.length % 2 === 0, 'ribbon has an even vertex count (outer + inner)');
    assert(prof.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'no NaN/inf in the ribbon');
    const g = ok(sheetMetalGeometry(L_BRACKET), 'L geo');
    // the faceted ribbon's shoelace volume ≈ the analytic t·L_geo·width (arc chords → slightly under).
    const v = ok(bentPartVolume(L_BRACKET), 'L extruded volume');
    assert(Math.abs(v - g.volume) <= 0.01 * g.volume, `extruded ribbon volume ≈ analytic (got ${Math.round(v * 10) / 10}, analytic ${g.volume})`);
  }

  // ─── A U-channel (two bends) ─────────────────────────────────────
  {
    const U: SheetMetalSpec = { thickness: 1.5, width: 60, sequence: [{ flange: 20 }, { bend: 90 }, { flange: 40 }, { bend: 90 }, { flange: 20 }] };
    const g = ok(sheetMetalGeometry(U), 'U-channel');
    assert(g.bendCount === 2, 'U-channel has two bends');
    near(g.flangeTotal, 80, 'U flange total = 20 + 40 + 20');
    // default bend radius = thickness (1.5); K default 0.44.
    near(g.geometricDevelopedLength, 80 + 2 * (Math.PI / 2) * (1.5 + 1.5 / 2), 'U geo length uses default R = t');
  }

  // ─── bpy construction (extruded, no boolean) ─────────────────────
  {
    const s = ok(buildBentPartBlenderScript(L_BRACKET, '/tmp/uc-sheet-smoke.stl'), 'bent-part bpy');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-sheet-smoke.stl"'), 'exports STL to the embedded path');
    assert(s.includes('extrude_face_region'), 'built by extruding the cross-section face');
    // the extruder carries an optional-bore boolean, but sheet metal never uses it → BORE_R = 0, inert.
    assert(s.includes('BORE_R = 0') && s.includes('if BORE_R > 0.0:'), 'bore boolean disabled (BORE_R = 0) → pure extrude at runtime');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'bent-part bpy balanced');
    assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf in the emitted profile');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!sheetMetalGeometry({ thickness: 2, width: 40, sequence: [{ flange: 50 }] }).ok, 'no bend → rejected (that is a plain plate)');
    assert(!sheetMetalGeometry({ thickness: 2, width: 40, sequence: [] }).ok, 'empty sequence → rejected');
    assert(!sheetMetalGeometry({ thickness: -1, width: 40, sequence: [{ flange: 10 }, { bend: 90 }, { flange: 10 }] }).ok, 'negative thickness → rejected');
    assert(!sheetMetalGeometry({ thickness: 2, width: 40, sequence: [{ flange: 10 }, { bend: 0 }, { flange: 10 }] }).ok, 'zero-angle bend → rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-sheet-metal-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-sheet-metal-core smoke cases passed.');
}

main();
