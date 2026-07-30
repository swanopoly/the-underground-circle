/**
 * engineering-mesh-inspect-core smoke.
 *
 * The measurement math is proven against a HAND-BUILT known mesh — a 10mm cube
 * whose volume (1000 mm³), surface area (600 mm²), and watertightness are
 * textbook truths — round-tripped through the binary-STL writer and parser. No
 * Blender in the loop here; the live drill is the separate cross-check that a
 * REAL generated STL measures back to its analytical volume.
 */

import {
  parseBinaryStl, writeBinaryStl, boxMesh,
  meshVolume, meshSurfaceArea, meshBoundingBox, meshWatertight,
  inspectMesh, massFromVolume,
  type Triangle,
} from '../src/lib/engineeringMeshInspectCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(actual: number, expected: number, label: string, tol = 1e-2) {
  const ok = Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
  assert(ok, `${label} (got ${actual}, expected ≈ ${expected})`);
}

function main() {
  // ─── Unit cube: exact known volume / area / watertight ───────────
  {
    const cube = boxMesh(0, 0, 0, 10, 10, 10);
    assert(cube.length === 12, 'cube is 12 triangles (2 per face)');
    near(meshVolume(cube), 1000, 'cube volume = 10³ = 1000 mm³');
    near(meshSurfaceArea(cube), 600, 'cube surface area = 6·10² = 600 mm²');
    const bb = meshBoundingBox(cube)!;
    assert(bb.dims.w === 10 && bb.dims.d === 10 && bb.dims.h === 10, 'cube bbox = 10×10×10');
    const wt = meshWatertight(cube);
    assert(wt.watertight && wt.openEdges === 0, 'cube is watertight (every edge shared by 2)');
    // 12 tris × 3 edges / 2 shared = 18 unique edges.
    assert(wt.edgeCount === 18, 'cube has 18 unique edges');
  }

  // ─── Volume is winding-independent (absolute) + translation-invariant ─
  {
    const a = boxMesh(0, 0, 0, 20, 10, 5); // 1000 mm³
    const b = boxMesh(-1000, 500, 30, 20, 10, 5); // same size, far from origin
    near(meshVolume(a), 1000, 'box volume 20×10×5 = 1000');
    near(meshVolume(b), 1000, 'volume is translation-invariant (far from origin)');
  }

  // ─── A box with two through-holes: analytical vs measured ────────
  // We can't easily hand-triangulate a holed plate, so this case instead
  // proves the ADDITIVE property the live drill relies on: the volume of a
  // union of disjoint boxes equals the sum of their volumes.
  {
    const two: Triangle[] = [...boxMesh(0, 0, 0, 10, 10, 10), ...boxMesh(100, 0, 0, 10, 10, 20)];
    near(meshVolume(two), 1000 + 2000, 'two disjoint boxes: volumes add (1000+2000)');
  }

  // ─── Open mesh → not watertight, volume flagged unreliable ───────
  {
    const open = boxMesh(0, 0, 0, 10, 10, 10).slice(0, 11); // drop one triangle
    const wt = meshWatertight(open);
    assert(!wt.watertight && wt.openEdges > 0, 'mesh with a missing triangle is NOT watertight');
    const bytes = writeBinaryStl(open);
    const r = inspectMesh(bytes);
    assert(r.ok, 'open mesh still inspects (does not crash)');
    if (r.ok) assert(r.value.volumeReliable === false, 'open mesh flags volume as unreliable');
  }

  // ─── Writer → parser round trip ──────────────────────────────────
  {
    const cube = boxMesh(0, 0, 0, 12, 8, 6);
    const bytes = writeBinaryStl(cube);
    assert(bytes.length === 84 + 12 * 50, 'binary STL byte length matches the layout');
    const parsed = parseBinaryStl(bytes);
    assert(parsed.ok, 'round-trip parses');
    if (parsed.ok) {
      assert(parsed.value.declaredCount === 12 && parsed.value.triangles.length === 12, 'round-trip triangle count preserved');
      near(meshVolume(parsed.value.triangles), 12 * 8 * 6, 'round-trip volume = 576 mm³');
    }
    const insp = inspectMesh(bytes);
    assert(insp.ok, 'inspectMesh on round-tripped bytes');
    if (insp.ok) {
      assert(insp.value.watertight && insp.value.volumeReliable, 'round-tripped cube is watertight');
      near(insp.value.volume_mm3, 576, 'inspect volume = 576');
      assert(insp.value.bbox.dims.w === 12, 'inspect bbox w = 12');
    }
  }

  // ─── Parse guards ────────────────────────────────────────────────
  {
    assert(!parseBinaryStl(new Uint8Array(10)).ok, 'too-short buffer rejected');
    // ASCII STL header → specific rejection. Must be ≥ 84 bytes so it reaches
    // the length-mismatch path (a shorter buffer is caught as 'too short' first).
    const ascii = new TextEncoder().encode('solid part\n' + 'facet normal 0 0 1\n  outer loop\n'.repeat(4) + 'endsolid\n');
    const ar = parseBinaryStl(ascii);
    assert(!ar.ok && /ASCII/i.test((ar as any).error), 'ASCII STL rejected with a clear message');
    // A length that does not match the declared count → rejected.
    const bad = writeBinaryStl(boxMesh(0, 0, 0, 1, 1, 1));
    const truncated = bad.slice(0, bad.length - 10);
    assert(!parseBinaryStl(truncated).ok, 'truncated binary STL rejected');
  }

  // ─── Mass from volume (composes the materials table) ─────────────
  {
    // A 100×100×10 mm steel plate = 100000 mm³ · 7.85e-6 kg/mm³ = 0.785 kg.
    const m = massFromVolume(100000, 7.85e-6);
    assert(m.ok, 'mass computes');
    if (m.ok) near(m.value.mass_kg, 0.785, 'steel 100×100×10 plate = 0.785 kg');
    assert(!massFromVolume(-1, 7.85e-6).ok, 'negative volume rejected');
    assert(!massFromVolume(1000, 0).ok, 'zero density rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-mesh-inspect-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-mesh-inspect-core smoke cases passed.');
}

main();
