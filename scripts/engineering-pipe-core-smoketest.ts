/**
 * engineering-pipe-core smoke.
 *
 * A pipe elbow's wall volume is the partial-revolve Pappus value θ·Rb·π(ro²−ri²),
 * and its bore holds θ·Rb·π·ri². This pins both against hand computation, the
 * torus-shell limit at θ = 360°, the wall/bore validation, and the bmesh sweep
 * bpy. The live drill measures the meshed wall volume against the Pappus formula.
 */

import { elbowGeometry, buildElbowBlenderScript } from '../src/lib/engineeringPipeCore';

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
  // ─── Elbow geometry: partial-revolve Pappus ──────────────────────
  {
    // Rb=60, od=50 (ro=25), id=40 (ri=20), 90° → V = (π/2)·60·π(625−400).
    const g = ok(elbowGeometry({ bendRadius: 60, outerDiameter: 50, innerDiameter: 40, angle: 90 }), '90° elbow');
    near(g.outerRadius, 25, 'outer radius = od/2 = 25');
    near(g.innerRadius, 20, 'inner radius = id/2 = 20');
    near(g.wallThickness, 5, 'wall = ro − ri = 5');
    near(g.wallArea, Math.PI * (25 * 25 - 20 * 20), 'wall area = π(ro²−ri²)');
    near(g.centrelineLength, (Math.PI / 2) * 60, 'centreline arc = θ·Rb');
    near(g.volume, (Math.PI / 2) * 60 * Math.PI * (625 - 400), 'wall volume = θ·Rb·π(ro²−ri²) (Pappus)');
    near(g.boreVolume, (Math.PI / 2) * 60 * Math.PI * 400, 'bore volume = θ·Rb·π·ri² (fluid held)');
  }

  // ─── The torus-shell limit at θ = 360° ───────────────────────────
  {
    const full = ok(elbowGeometry({ bendRadius: 60, outerRadius: 25, wallThickness: 5, angle: 360 }), 'full torus');
    near(full.volume, 2 * Math.PI * 60 * Math.PI * (625 - 400), 'θ=360° → full torus-shell volume 2π·Rb·A');
  }

  // ─── wallThickness form + validation ─────────────────────────────
  {
    const g = ok(elbowGeometry({ bendRadius: 100, outerDiameter: 60, wallThickness: 4, angle: 45 }), 'wall-thickness form');
    near(g.innerRadius, 26, 'wallThickness form → ri = ro − t = 26');
    near(g.angleDeg, 45, '45° bend');

    assert(!elbowGeometry({ bendRadius: 20, outerRadius: 25, wallThickness: 5 }).ok, 'bendRadius ≤ pipe radius rejected (self-intersect)');
    assert(!elbowGeometry({ bendRadius: 60, outerRadius: 25, innerDiameter: 60 }).ok, 'inner ≥ outer rejected');
    assert(!elbowGeometry({ bendRadius: 60, outerRadius: 25 } as any).ok, 'no inner/wall rejected');
    assert(!elbowGeometry({ outerRadius: 25, wallThickness: 5 } as any).ok, 'no bendRadius rejected');
  }

  // ─── bmesh sweep bpy (no boolean) ────────────────────────────────
  {
    const s = ok(buildElbowBlenderScript({ bendRadius: 60, outerDiameter: 50, innerDiameter: 40, angle: 90 }, '/tmp/uc-elbow-smoke.stl'), 'elbow bpy');
    assert(s.includes('def pt(a, r, b):') && s.includes('R = RB + r * cb'), 'sweeps a pipe cross-section around the bend');
    assert(s.includes('outer.append(') && s.includes('inner.append('), 'builds an outer wall and an inner bore wall');
    assert(s.includes('# annular end caps'), 'closes the ends with annular caps → watertight');
    assert(!/BOOLEAN|modifier/.test(s), 'no boolean — a single swept surface');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-elbow-smoke.stl"'), 'exports STL to the embedded path');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'elbow bpy balanced');
    assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf in the elbow bpy');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-pipe-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-pipe-core smoke cases passed.');
}

main();
