/**
 * engineering-gear-core smoke.
 *
 * A gear is verifiable because its involute geometry has exact closed-form
 * properties: pitch diameter m·N, tip diameter m·(N+2), root m·(N−2.5), base
 * d·cos(φ), circular pitch π·m. This suite pins each against textbook truth,
 * checks the generated profile actually reaches the tip and root radii and has
 * the right tooth count, and confirms the 3D bpy is structurally sound. The
 * live drill separately runs it through Blender and measures the OD back.
 */

import {
  inv, gearGeometry, spurGearProfile, buildSpurGearDrawing, buildSpurGearBlenderScript,
} from '../src/lib/engineeringGearCore';
import { writeDxfR12, parseDxfForVerification } from '../src/lib/engineeringDraftingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

/** Count teeth by counting clusters of near-tip-radius profile points. */
function countTeeth(points: Array<{ x: number; y: number }>, ra: number): number {
  const nearTip = points.map((p) => Math.hypot(p.x, p.y) >= ra - 1e-3);
  let teeth = 0;
  for (let i = 0; i < nearTip.length; i += 1) {
    if (nearTip[i] && !nearTip[(i - 1 + nearTip.length) % nearTip.length]) teeth += 1;
  }
  return teeth;
}

function main() {
  // ─── inv() ───────────────────────────────────────────────────────
  {
    assert(inv(0) === 0, 'inv(0) = 0');
    near(inv(20 * Math.PI / 180), 0.014904, 'inv(20°) = 0.014904');
  }

  // ─── Geometry vs textbook, several specs ─────────────────────────
  {
    const g = ok(gearGeometry(24, 2, 20), 'Z24 m2');
    near(g.pitchDiameter, 48, 'PD = m·N = 48');
    near(g.outsideDiameter, 52, 'OD = m·(N+2) = 52');
    near(g.rootDiameter, 43, 'root = m·(N−2.5) = 43');
    near(g.baseRadius, 24 * Math.cos(20 * Math.PI / 180), 'base radius = pr·cos(20°)');
    near(g.circularPitch, Math.PI * 2, 'circular pitch = π·m');
    assert(g.undercut === true, 'Z24 undercuts (root < base)');

    const big = ok(gearGeometry(40, 1.5, 20), 'Z40 m1.5');
    near(big.pitchDiameter, 60, 'Z40 m1.5 PD = 60');
    near(big.outsideDiameter, 63, 'Z40 m1.5 OD = 63');
    // Undercut (root below base) occurs for N < 2·1.25/(1−cosφ) ≈ 41.5 at 20°,
    // so Z40 undercuts but Z50 does not — a real property, verified both ways.
    assert(big.undercut === true, 'Z40 still undercuts (N < ~41.5 at 20°)');
    assert(ok(gearGeometry(50, 1.5, 20), 'Z50').undercut === false, 'Z50 does NOT undercut (root > base)');

    const pa145 = ok(gearGeometry(20, 3, 14.5), 'Z20 m3 PA14.5');
    near(pa145.baseRadius, 30 * Math.cos(14.5 * Math.PI / 180), '14.5° base radius');
  }

  // ─── Profile reaches tip + root, right tooth count ───────────────
  {
    const p = ok(spurGearProfile({ teeth: 24, module: 2 }), 'Z24 profile');
    const radii = p.points.map((q) => Math.hypot(q.x, q.y));
    near(Math.max(...radii), p.geometry.addendumRadius, 'profile max radius = tip radius (ra)');
    near(Math.min(...radii), p.geometry.dedendumRadius, 'profile min radius = root radius (rf)', 1e-3);
    assert(countTeeth(p.points, p.geometry.addendumRadius) === 24, 'profile has exactly 24 teeth');

    // A no-undercut gear too.
    const p40 = ok(spurGearProfile({ teeth: 40, module: 1.5 }), 'Z40 profile');
    assert(countTeeth(p40.points, p40.geometry.addendumRadius) === 40, 'Z40 profile has 40 teeth');
    // Every profile point is within [root, tip] radius (nothing escapes the annulus).
    assert(p40.points.every((q) => { const r = Math.hypot(q.x, q.y); return r >= p40.geometry.dedendumRadius - 1e-2 && r <= p40.geometry.addendumRadius + 1e-2; }), 'all Z40 points within [root, tip]');
  }

  // ─── Involute flank passes through the pitch circle at the half-tooth ─
  {
    // At the pitch radius the flank half-angle should be π/(2N): the pitch-circle
    // tooth thickness equals the space, the defining property of a standard gear.
    const N = 30, m = 2;
    const p = ok(spurGearProfile({ teeth: N, module: m, flankSteps: 20 }), 'Z30 profile');
    const pr = p.geometry.pitchRadius;
    // Find the profile point closest to the pitch radius on the first tooth's right flank.
    const firstHalf = p.points.slice(0, Math.floor(p.points.length / N));
    let best = firstHalf[0], bestErr = Infinity;
    for (const q of firstHalf) { const e = Math.abs(Math.hypot(q.x, q.y) - pr); if (e < bestErr) { bestErr = e; best = q; } }
    const ang = Math.abs(Math.atan2(best.y, best.x)); // right flank near angle 0, |angle| ≈ π/(2N)
    near(ang, Math.PI / (2 * N), 'flank crosses pitch circle at the half-tooth angle π/(2N)', 5e-2);
  }

  // ─── 2D drawing round-trips + spans the OD ───────────────────────
  {
    const doc = ok(buildSpurGearDrawing({ teeth: 24, module: 2, boreDiameter: 10 }), 'gear drawing');
    const dxf = ok(writeDxfR12(doc), 'gear → DXF');
    const parsed = parseDxfForVerification(dxf);
    assert(parsed.layers.includes('GEAR') && parsed.layers.includes('CONSTRUCTION'), 'gear layers declared');
    assert((parsed.entityCounts.POLYLINE ?? 0) === 1, 'the gear outline is one closed polyline');
    // Circles present: pitch reference + bore = 2.
    assert((parsed.entityCounts.CIRCLE ?? 0) === 2, 'pitch-circle reference + bore circle');
    // Bbox spans the outside diameter: ±26.
    assert(Math.round(parsed.bbox!.maxX) === 26 && Math.round(parsed.bbox!.minX) === -26, 'drawing bbox spans the OD (±26)');
  }

  // ─── 3D bpy is structurally sound ────────────────────────────────
  {
    const s = ok(buildSpurGearBlenderScript({ teeth: 18, module: 3, faceWidth: 12, boreDiameter: 16 }, '/tmp/uc-gear-smoke.stl'), 'gear bpy');
    // Balanced brackets/parens.
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'bpy balanced parens/brackets');
    assert(s.includes('bmesh.ops.extrude_face_region'), 'bpy extrudes the profile face');
    assert(s.includes("m.solver = 'EXACT'"), 'bpy bore uses the EXACT solver');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)'), 'bpy exports STL');
    assert(s.includes('OUT = "/tmp/uc-gear-smoke.stl"'), 'output path embedded as a safe literal');
    assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf tokens in the profile');
  }

  // ─── Fail-closed ─────────────────────────────────────────────────
  {
    assert(!gearGeometry(3, 2, 20).ok, 'too-few teeth rejected');
    assert(!gearGeometry(20, 0, 20).ok, 'zero module rejected');
    assert(!gearGeometry(20, 2, 60).ok, 'out-of-range pressure angle rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-gear-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-gear-core smoke cases passed.');
}

main();
