/**
 * engineering-profile-solid-core smoke.
 *
 * Extrude and revolve are proven on their analytical volumes: a prism is
 * area·height, and a solid of revolution is Pappus's 2π·R̄·A. The elegant check
 * is that Pappus and the independent closed-form volume of a known revolved
 * shape (a rectangle-at-radius → a tube) agree to the last digit — and the live
 * drill then confirms the meshed STL measures back to that same number.
 */

import {
  polygonArea, polygonSignedArea, polygonCentroid, polygonBBox,
  extrudeVolume, revolveVolume,
  validateExtrudeProfile, validateRevolveProfile,
  buildExtrudeBlenderScript, buildRevolveBlenderScript,
  pulleyProfile, buildPulleyBlenderScript,
} from '../src/lib/engineeringProfileSolidCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-6) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Polygon measures ────────────────────────────────────────────
  {
    const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    near(polygonArea(sq), 4, 'square 2×2 area = 4');
    assert(polygonSignedArea(sq) > 0, 'CCW square has positive signed area');
    assert(polygonSignedArea([...sq].reverse()) < 0, 'CW square has negative signed area');
    const c = polygonCentroid(sq)!;
    assert(c.cx === 1 && c.cy === 1, 'square centroid = (1,1) = center');
    // Right triangle (0,0)(6,0)(0,3): area 9, centroid = mean/3 = (2,1).
    const tri = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 3 }];
    near(polygonArea(tri), 9, 'triangle area = ½·6·3 = 9');
    const tc = polygonCentroid(tri)!;
    near(tc.cx, 2, 'triangle centroid x = 6/3 = 2'); near(tc.cy, 1, 'triangle centroid y = 3/3 = 1');
    const bb = polygonBBox(sq)!;
    assert(bb.minX === 0 && bb.maxX === 2 && bb.maxY === 2, 'bbox of the square');
  }

  // ─── Extrude volume = area × height ──────────────────────────────
  {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }];
    near(extrudeVolume(sq, 5), 200, 'extrude 10×4 profile h=5 → 40·5 = 200');
    // An L-section area is exact too: 10×10 minus a 6×6 corner = 64, ·3 = 192.
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    near(polygonArea(L), 100 - 36, 'L-section area = 64');
    near(extrudeVolume(L, 3), 192, 'L-section extruded h=3 → 192');
  }

  // ─── Revolve volume = Pappus, cross-checked vs the tube formula ──
  {
    // Rectangle at radius R=10 (x 8..12), height 6 (y −3..3). Revolve → a tube.
    // Pappus 2π·R̄·A = 2π·10·24 = 1507.964; tube π(12²−8²)·6 = 1507.964. IDENTICAL.
    const rect = [{ x: 8, y: -3 }, { x: 12, y: -3 }, { x: 12, y: 3 }, { x: 8, y: 3 }];
    const pappus = revolveVolume(rect);
    const tube = Math.PI * (12 * 12 - 8 * 8) * 6;
    near(pappus, tube, 'Pappus revolve volume == the closed-form tube volume');
    near(pappus, 2 * Math.PI * 10 * 24, 'Pappus = 2π·R̄·A = 2π·10·24');

    // A solid disc: rectangle from x=0 (touches the axis), R̄ = w/2.
    // Revolve a 5(wide)×2(tall) rect from x=0 → a cylinder r=5 h=2, vol π·25·2 = 157.08.
    const disc = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 2 }, { x: 0, y: 2 }];
    near(revolveVolume(disc), Math.PI * 25 * 2, 'revolve a rect from the axis → cylinder volume π·r²·h');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!validateExtrudeProfile([{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok, 'fewer than 3 points rejected');
    assert(!validateExtrudeProfile([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }]).ok, 'collinear (zero-area) profile rejected');
    assert(validateRevolveProfile([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }]).ok, 'valid revolve profile (x≥0) accepted');
    assert(!validateRevolveProfile([{ x: -1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }]).ok, 'revolve profile crossing the axis (x<0) rejected');
  }

  // ─── bpy structure ───────────────────────────────────────────────
  {
    const ext = ok(buildExtrudeBlenderScript([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], 4, '/tmp/uc-ext-smoke.stl', { boreDiameter: 3 }), 'extrude bpy');
    assert(ext.includes('extrude_face_region') && ext.includes('stl_export'), 'extrude bpy extrudes + exports');
    assert(ext.includes('OUT = "/tmp/uc-ext-smoke.stl"'), 'extrude output path embedded safely');

    const rev = ok(buildRevolveBlenderScript([{ x: 8, y: -3 }, { x: 12, y: -3 }, { x: 12, y: 3 }, { x: 8, y: 3 }], '/tmp/uc-rev-smoke.stl', { segments: 96 }), 'revolve bpy');
    assert(rev.includes("type='SCREW'") && rev.includes('use_merge_vertices = True'), 'revolve uses the Screw modifier + merges the seam');
    assert(rev.includes('mod.angle = 2.0 * math.pi'), 'revolve is a full 360° turn');
    let round = 0, sq2 = 0;
    for (const ch of rev) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq2++; else if (ch === ']') sq2--; }
    assert(round === 0 && sq2 === 0, 'revolve bpy balanced');
    assert(!/\b(nan|inf)\b/i.test(ext + rev), 'no nan/inf in either script');
  }

  // ─── Turnkey pulley (its own Pappus volume is verifiable) ────────
  {
    const prof = ok(pulleyProfile({ outerDiameter: 80, boreDiameter: 16, width: 20, grooveDepth: 8, grooveTopWidth: 12 }), 'pulley profile');
    // The profile spans from the bore radius (8) to the rim (40).
    const bb = polygonBBox(prof)!;
    assert(bb.minX === 8 && bb.maxX === 40, 'pulley section runs bore(8) → rim(40)');
    assert(bb.minY === -10 && bb.maxY === 10, 'pulley section is the full width (±10)');
    // The V-notch pulls three extra vertices into the outline.
    assert(prof.length === 7, 'V-groove pulley section has 7 vertices (rectangle + 3 notch)');
    assert(revolveVolume(prof) > 0, 'pulley has a positive Pappus volume');
    const s = ok(buildPulleyBlenderScript({ outerDiameter: 80, boreDiameter: 16, width: 20, grooveDepth: 8 }, '/tmp/uc-pulley-smoke.stl'), 'pulley bpy');
    assert(s.includes("type='SCREW'"), 'pulley is a revolve');
    // A flat-rim pulley (no groove) is a plain rectangle section.
    const flat = ok(pulleyProfile({ outerDiameter: 60, boreDiameter: 10, width: 15 }), 'flat pulley');
    assert(flat.length === 4, 'flat-rim pulley section is a rectangle');
    assert(!pulleyProfile({ outerDiameter: 20, boreDiameter: 25, width: 10 }).ok, 'bore ≥ OD rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-profile-solid-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-profile-solid-core smoke cases passed.');
}

main();
