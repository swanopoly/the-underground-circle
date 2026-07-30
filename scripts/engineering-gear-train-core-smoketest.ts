/**
 * engineering-gear-train-core smoke.
 *
 * A meshing gear pair has exact constraints: center distance m·(N₁+N₂)/2, ratio
 * N₂/N₁, TANGENT pitch circles (r₁+r₂ = C), and 0.25·m tip/root clearance. This
 * pins each, checks ratio-driven tooth selection, and confirms the 2D assembly
 * carries both gears and the center-distance dimension. The live drill builds
 * the pair in Blender and measures the assembly span m·(N₁+N₂)/2 + ra₁ + ra₂.
 */

import { gearPairGeometry, buildGearPairDrawing, buildGearPairBlenderScript } from '../src/lib/engineeringGearTrainCore';
import { writeDxfR12, parseDxfForVerification } from '../src/lib/engineeringDraftingCore';

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
  // ─── Pair geometry: the exact constraints ────────────────────────
  {
    // Explicit teeth: Z18 + Z36 m2.5.
    const g = ok(gearPairGeometry({ module: 2.5, pinionTeeth: 18, gearTeeth: 36 }), 'Z18:Z36 m2.5');
    near(g.centerDistance, (2.5 * (18 + 36)) / 2, 'center distance = m·(N₁+N₂)/2 = 67.5');
    near(g.ratio, 2, 'ratio = N₂/N₁ = 2');
    // Pitch circles tangent — the meshing condition.
    near(g.pitchRadius1 + g.pitchRadius2, g.centerDistance, 'pitch circles tangent: r₁ + r₂ = C');
    near(g.tipClearance, 0.25 * 2.5, 'tip/root clearance = 0.25·m');
    // Both gears share module + pressure angle (a mesh requirement).
    assert(g.pinion.module === g.gear.module && g.pinion.pressureAngleDeg === g.gear.pressureAngleDeg, 'both gears share module + pressure angle');
  }

  // ─── Ratio-driven tooth selection ────────────────────────────────
  {
    const g = ok(gearPairGeometry({ module: 2, pinionTeeth: 12, ratio: 3 }), '3:1 from ratio');
    assert(g.teeth2 === 36, 'ratio 3 with 12-tooth pinion → 36-tooth gear');
    near(g.centerDistance, 48, '3:1 center distance = 48');
    // A non-integer ratio rounds the driven teeth honestly.
    const g2 = ok(gearPairGeometry({ module: 1, pinionTeeth: 17, ratio: 2.5 }), '2.5:1');
    assert(g2.teeth2 === Math.round(17 * 2.5), '2.5× 17 → round(42.5) = 43 teeth');

    assert(!gearPairGeometry({ module: 2, pinionTeeth: 12 }).ok, 'neither gearTeeth nor ratio → rejected');
    assert(!gearPairGeometry({ module: 2, pinionTeeth: 2, ratio: 3 }).ok, 'too-few pinion teeth rejected');
  }

  // ─── Mesh phase places gear 2 for a proper static interlock ──────
  {
    const g = ok(gearPairGeometry({ module: 2, pinionTeeth: 24, gearTeeth: 24 }), 'Z24:Z24');
    near(g.meshPhaseDeg, 180 + 180 / 24, 'mesh phase = 180° + half-tooth (180/N₂)');
  }

  // ─── 2D assembly drawing ─────────────────────────────────────────
  {
    const doc = ok(buildGearPairDrawing({ module: 2, pinionTeeth: 12, gearTeeth: 36, pinionBore: 6, gearBore: 12 }), 'pair drawing');
    const dxf = ok(writeDxfR12(doc), 'pair → DXF');
    const p = parseDxfForVerification(dxf);
    assert((p.entityCounts.POLYLINE ?? 0) === 2, 'two gear outlines (the two meshing gears)');
    // Pitch circles (2) + two bores (2) = 4 circles.
    assert((p.entityCounts.CIRCLE ?? 0) === 4, 'two pitch circles + two bores');
    assert(p.layers.includes('GEAR') && p.layers.includes('DIMS'), 'gear + dims layers');
    // The center-distance dimension text = 48 (the measured center distance).
    assert(dxf.includes('\n48\n'), 'center-distance dimension text = 48 (measured)');
    // Assembly bbox: gear1 left edge at −ra1 (−14), gear2 right at C+ra2 (48+38=86).
    // ra1 = (12+2)·2/2 = 14, ra2 = (36+2)·2/2 = 38.
    assert(Math.round(p.bbox!.minX) <= -14 + 1 && Math.round(p.bbox!.maxX) >= 86 - 1, 'assembly bbox spans −ra₁ … C+ra₂');
  }

  // ─── 3D pair bpy is structurally sound (two positioned gear units) ─
  {
    const s = ok(buildGearPairBlenderScript({ module: 2, pinionTeeth: 12, gearTeeth: 24, faceWidth: 10, pinionBore: 6 }, '/tmp/uc-pair-smoke.stl'), 'pair bpy');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'pair bpy balanced parens/brackets');
    // Two gear units, suffixed 1 and 2, both extruded.
    assert(s.includes('PROFILE1 =') && s.includes('PROFILE2 ='), 'two profiles (both gears) embedded');
    assert((s.match(/extrude_face_region/g) || []).length === 2, 'both gears are extruded');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)'), 'exports one assembly STL');
    assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf in the assembly script');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-gear-train-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-gear-train-core smoke cases passed.');
}

main();
