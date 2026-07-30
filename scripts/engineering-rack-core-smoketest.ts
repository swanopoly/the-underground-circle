/**
 * engineering-rack-core smoke.
 *
 * A gear rack is a gear of infinite radius, so its involute teeth are exactly
 * TRAPEZOIDAL (straight flanks at the pressure angle). The decisive check is that
 * the toothed profile's area computed two independent ways agrees: the shoelace
 * of the generated outline vs the closed form base-rectangle + N tooth-trapezoids.
 * This also pins the tooth dimensions (circular pitch π·m, tip narrower than root)
 * and the rack length N·π·m. The live drill measures the extruded rack volume.
 */

import { rackGeometry, rackProfilePoints, rackExtrudeVolume, buildRackBlenderScript } from '../src/lib/engineeringRackCore';
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

const SPEC = { module: 2, teeth: 5, pressureAngleDeg: 20, faceWidth: 15, backThickness: 4 };

function main() {
  // ─── Tooth dimensions ────────────────────────────────────────────
  {
    const g = ok(rackGeometry(SPEC), 'rack');
    near(g.circularPitch, Math.PI * 2, 'circular pitch = π·m');
    near(g.length, 5 * Math.PI * 2, 'length = teeth · π·m');
    near(g.addendum, 2, 'addendum = m');
    near(g.dedendum, 2.5, 'dedendum = 1.25·m');
    near(g.toothHeight, 4.5, 'tooth height = a + b = 4.5');
    const tan = Math.tan(20 * Math.PI / 180);
    near(g.tipWidth, Math.PI - 2 * 2 * tan, 'tip width = p/2 − 2·a·tanφ');
    near(g.rootWidth, Math.PI + 2 * 2.5 * tan, 'root width = p/2 + 2·b·tanφ');
    assert(g.rootWidth > g.tipWidth, 'a rack tooth is wider at its root than its tip');
    near(g.height, 8.5, 'profile height = tip − bottom = 2 + 2.5 + 4');
  }

  // ─── THE independent area cross-check ────────────────────────────
  {
    const g = ok(rackGeometry(SPEC), 'rack');
    // the core's two area computations must agree.
    near(g.crossSectionArea, g.trapezoidArea, 'shoelace area = base-rect + N tooth-trapezoids');
    // and re-derive the trapezoid area here, sharing no code with the outline.
    const m = 2, N = 5, tan = Math.tan(20 * Math.PI / 180);
    const a = 2, b = 2.5, p = Math.PI * 2, L = N * p;
    const wTip = p / 2 - 2 * a * tan, wRoot = p / 2 + 2 * b * tan;
    const back = 4; // base-rectangle height = yRoot − yBottom = backThickness
    const indep = L * back + N * ((wRoot + wTip) / 2) * (a + b);
    near(g.trapezoidArea, indep, 'trapezoid area matches an independent re-derivation');
    // and the profile polygon's own shoelace equals the reported area.
    near(polygonArea(ok(rackProfilePoints(SPEC), 'profile')), g.crossSectionArea, 'profile shoelace = reported area', 1e-2);
    near(g.volume, g.crossSectionArea * 15, 'volume = area · faceWidth');
    near(ok(rackExtrudeVolume(SPEC), 'extrude vol'), g.volume, 'extruded rack volume matches the geometry');
  }

  // ─── Different module scales the pitch ───────────────────────────
  {
    const g = ok(rackGeometry({ module: 3, teeth: 4, faceWidth: 20 }), 'm3 rack');
    near(g.circularPitch, Math.PI * 3, 'm=3 → pitch 3π');
    near(g.length, 4 * Math.PI * 3, 'm=3, 4 teeth → length 12π');
    near(g.crossSectionArea, g.trapezoidArea, 'area cross-check holds at m=3 too');
  }

  // ─── bpy (extrude, no boolean) ───────────────────────────────────
  {
    const s = ok(buildRackBlenderScript(SPEC, '/tmp/uc-rack-smoke.stl'), 'rack bpy');
    assert(s.includes('extrude_face_region'), 'built by extruding the rack profile');
    assert(s.includes('BORE_R = 0'), 'no bore → pure extrude');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-rack-smoke.stl"'), 'exports STL to the embedded path');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'rack bpy balanced');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!rackGeometry({ module: 2, teeth: 0, faceWidth: 15 }).ok, 'zero teeth rejected');
    assert(!rackGeometry({ module: 2, teeth: 3.5 as any, faceWidth: 15 }).ok, 'non-integer teeth rejected');
    assert(!rackGeometry({ module: -1, teeth: 5, faceWidth: 15 }).ok, 'negative module rejected');
    assert(!rackGeometry({ module: 2, teeth: 5, faceWidth: 15, pressureAngleDeg: 70 }).ok, 'absurd pressure angle rejected (teeth degenerate)');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-rack-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-rack-core smoke cases passed.');
}

main();
