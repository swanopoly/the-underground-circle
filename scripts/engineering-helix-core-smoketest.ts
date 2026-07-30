/**
 * engineering-helix-core smoke.
 *
 * A helical solid's volume is its cross-section area times its DEVELOPED length
 * — unroll a coil into a right triangle (legs π·D and pitch, hypotenuse the
 * wire length). This pins the developed-length formula against known limits (a
 * zero-pitch helix is just stacked circles; a slender helix's length is
 * n·√((πD)²+p²)), the spring's wire volume against area·length, and the bpy
 * construction. The live drill confirms the meshed STL measures back to it.
 */

import {
  helixPoints, helixDevelopedLength, springGeometry, buildSpringBlenderScript,
} from '../src/lib/engineeringHelixCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Developed length: the two limits ────────────────────────────
  {
    // Pitch 0 → the helix is n stacked circles: L = n·2πR.
    near(helixDevelopedLength(10, 0, 5), 5 * 2 * Math.PI * 10, 'zero-pitch helix length = n·2πR');
    // General: R=10, pitch=5, n=8 → 8·√((2π·10)²+5²).
    near(helixDevelopedLength(10, 5, 8), 8 * Math.sqrt((2 * Math.PI * 10) ** 2 + 25), 'developed length = n·√((2πR)²+p²)');
    // A near-vertical helix (pitch ≫ circumference) → length ≈ n·pitch.
    const steep = helixDevelopedLength(0.001, 100, 3);
    near(steep, 300, 'steep helix length ≈ n·pitch', 1e-3);
  }

  // ─── Helix points trace the right path ───────────────────────────
  {
    const pts = helixPoints(10, 5, 2, 32);
    assert(pts.length === 2 * 32 + 1, '2 coils × 32 steps + 1 = 65 points');
    assert(Math.abs(pts[0].x - 10) < 1e-6 && Math.abs(pts[0].z) < 1e-6, 'starts at (R, 0, 0)');
    // After 2 full turns, z = 2·pitch = 10, back to x ≈ R.
    const last = pts[pts.length - 1];
    near(last.z, 10, 'ends at z = coils·pitch = 10');
    near(last.x, 10, 'ends back at x ≈ R (a whole number of turns)', 1e-3);
    // Every point sits on the mean-radius cylinder.
    assert(pts.every((p) => Math.abs(Math.hypot(p.x, p.y) - 10) < 1e-3), 'all points lie on the mean-radius cylinder');
  }

  // ─── Spring geometry ─────────────────────────────────────────────
  {
    // d=2, D=20, freeLength=40, coils=8 → pitch 5, OD 22, ID 18, index 10, active 6.
    const g = ok(springGeometry({ wireDiameter: 2, meanDiameter: 20, freeLength: 40, totalCoils: 8 }), 'spring');
    near(g.pitch, 5, 'pitch = freeLength / totalCoils = 5');
    near(g.outerDiameter, 22, 'OD = D + d = 22');
    near(g.innerDiameter, 18, 'ID = D − d = 18');
    near(g.springIndex, 10, 'spring index = D/d = 10');
    assert(g.activeCoils === 6, 'active coils default = total − 2 = 6');
    near(g.developedLength, 8 * Math.sqrt((2 * Math.PI * 10) ** 2 + 25), 'developed length matches the helix formula');
    near(g.wireVolume, Math.PI * 1 * g.developedLength, 'wire volume = π·(d/2)²·L');

    // Specify by outer diameter instead.
    const g2 = ok(springGeometry({ wireDiameter: 3, outerDiameter: 30, freeLength: 50, totalCoils: 10 }), 'spring by OD');
    near(g2.meanDiameter, 27, 'meanDiameter = outerDiameter − wire = 27');

    assert(!springGeometry({ wireDiameter: 5, meanDiameter: 5, freeLength: 40, totalCoils: 8 }).ok, 'mean ≤ wire rejected');
    assert(!springGeometry({ wireDiameter: 2, freeLength: 40, totalCoils: 8 } as any).ok, 'no diameter given → rejected');
  }

  // ─── bpy construction ────────────────────────────────────────────
  {
    const s = ok(buildSpringBlenderScript({ wireDiameter: 2, meanDiameter: 20, freeLength: 40, totalCoils: 8, stepsPerCoil: 48 }, '/tmp/uc-spring-smoke.stl'), 'spring bpy');
    assert(s.includes("curve.splines.new('POLY')"), 'builds a POLY curve of the helix centreline');
    assert(s.includes('curve.bevel_depth = WIRE_R') && s.includes('WIRE_R = 1'), 'bevel_depth = wire radius (WIRE_R = 1)');
    assert(s.includes('curve.use_fill_caps = True'), 'caps the ends → watertight');
    assert(s.includes("bpy.ops.object.convert(target='MESH')"), 'converts the beveled curve to a mesh');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-spring-smoke.stl"'), 'exports STL to the embedded path');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'spring bpy balanced');
    assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf in the helix points');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-helix-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-helix-core smoke cases passed.');
}

main();
