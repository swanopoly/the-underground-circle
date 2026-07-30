/**
 * engineering-helical-gear-core smoke.
 *
 * A helical gear is a spur profile twisted along the axis, so this pins the twist
 * (θ = W·tanβ/r_pitch) and the lead, and — the decisive check — the CAVALIERI
 * invariance: because every cross-section has the same area, the volume
 * (profileArea − bore)·faceWidth is INDEPENDENT of the helix angle, so a 0°, a
 * 20°, and a 35° helical gear of the same size all have the identical volume (the
 * spur gear's). The live drill measures the meshed solid against that.
 */

import { helicalGearGeometry, buildHelicalGearBlenderScript } from '../src/lib/engineeringHelicalGearCore';

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

const BASE = { teeth: 20, module: 2, faceWidth: 20, boreDiameter: 12 };

function main() {
  // ─── Twist geometry ──────────────────────────────────────────────
  {
    const g = ok(helicalGearGeometry({ ...BASE, helixAngleDeg: 20 }), 'helical 20°');
    near(g.gear.pitchDiameter, 40, 'pitch diameter = m·N = 40');
    near(g.gear.outsideDiameter, 44, 'outside diameter = m·(N+2) = 44');
    // twist = W·tanβ / r_pitch.
    near(g.twistAngleDeg, (20 * Math.tan(20 * Math.PI / 180) / 20) * 180 / Math.PI, 'twist = W·tanβ/r_pitch = 20.85°');
    // lead = π·d/tanβ.
    near(g.lead, Math.PI * 40 / Math.tan(20 * Math.PI / 180), 'lead = π·d/tanβ');
    assert(g.handedness === 'right', 'positive helix angle → right-handed');
    assert(ok(helicalGearGeometry({ ...BASE, helixAngleDeg: -20 }), 'left').handedness === 'left', 'negative helix angle → left-handed');
  }

  // ─── CAVALIERI: volume is independent of the helix angle ─────────
  {
    const spur = ok(helicalGearGeometry({ ...BASE, helixAngleDeg: 0 }), 'spur (0°)');
    const h20 = ok(helicalGearGeometry({ ...BASE, helixAngleDeg: 20 }), 'helical 20°');
    const h35 = ok(helicalGearGeometry({ ...BASE, helixAngleDeg: 35 }), 'helical 35°');
    near(h20.volume, spur.volume, 'helical 20° volume = spur volume (Cavalieri)');
    near(h35.volume, spur.volume, 'helical 35° volume = spur volume (Cavalieri)');
    // volume = (profileArea − bore) · faceWidth.
    near(spur.volume, (spur.profileArea - Math.PI * 6 * 6) * 20, 'volume = (profileArea − bore)·faceWidth');
    // twist DOES grow with angle even though volume doesn't.
    assert(h35.twistAngleDeg > h20.twistAngleDeg, 'a bigger helix angle twists more (but keeps the volume)');
  }

  // ─── bpy construction ────────────────────────────────────────────
  {
    const s = ok(buildHelicalGearBlenderScript({ ...BASE, helixAngleDeg: 20 }, '/tmp/uc-helical-smoke.stl'), 'helical bpy');
    assert(s.includes('for (x, y) in PTS]') && s.includes('math.cos(a)') && s.includes('math.sin(a)'), 'stacks the profile rotated at each height (twist-extrude)');
    assert(s.includes('bm.faces.new(layers[0][::-1])') && s.includes('bm.faces.new(layers[N])'), 'caps both ends → watertight');
    assert(s.includes("mod.operation = 'DIFFERENCE'") && s.includes('BORE_R'), 'subtracts a straight shaft bore');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-helical-smoke.stl"'), 'exports STL to the embedded path');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'helical bpy balanced');
    assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf in the emitted profile');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!helicalGearGeometry({ ...BASE, helixAngleDeg: 70 }).ok, 'helix angle ≥ 60° rejected');
    assert(!helicalGearGeometry({ teeth: 20, module: 2, helixAngleDeg: 20 } as any).ok, 'no faceWidth rejected');
    assert(!helicalGearGeometry({ ...BASE, boreDiameter: 100, helixAngleDeg: 20 }).ok, 'bore larger than the root rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-helical-gear-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-helical-gear-core smoke cases passed.');
}

main();
