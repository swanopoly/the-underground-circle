/**
 * engineering-fastener-core smoke.
 *
 * Hex fasteners are sized from the ISO across-flats standard and their volumes
 * are closed-form. This pins the across-flats table (M10 → 16 mm wrench), the hex
 * area (3√3/2)·R², and the bolt/nut volumes (head + shank − overlap; hex − bore).
 * The live drill measures the meshed part against these numbers.
 */

import {
  HEX_ACROSS_FLATS, hexBoltGeometry, hexNutGeometry,
  buildHexBoltBlenderScript, buildHexNutBlenderScript,
} from '../src/lib/engineeringFastenerCore';

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

const hexArea = (af: number) => { const R = af / Math.sqrt(3); return (3 * Math.sqrt(3) / 2) * R * R; };

function main() {
  // ─── Across-flats standard ───────────────────────────────────────
  {
    assert(HEX_ACROSS_FLATS['10'] === 16, 'M10 across-flats = 16 mm (wrench size)');
    assert(HEX_ACROSS_FLATS['8'] === 13, 'M8 across-flats = 13 mm');
    assert(HEX_ACROSS_FLATS['6'] === 10, 'M6 across-flats = 10 mm');
    assert(Object.entries(HEX_ACROSS_FLATS).every(([d, af]) => af > Number(d)), 'every hex is wider across-flats than its thread');
  }

  // ─── Hex bolt ────────────────────────────────────────────────────
  {
    const b = ok(hexBoltGeometry({ thread: 'M10', length: 30 }), 'M10 bolt');
    assert(b.acrossFlats === 16, 'M10 bolt head across-flats = 16');
    near(b.acrossCorners, 2 * 16 / Math.sqrt(3), 'across-corners = 2·AF/√3');
    near(b.headHeight, 7, 'default head height ≈ 0.7·d = 7 mm');
    near(b.totalHeight, 37, 'total height = head + shank = 37 mm');
    // volume = hexArea·headH + shank − overlap.
    const overlap = Math.min(1, b.headHeight / 2);
    const expect = hexArea(16) * b.headHeight + Math.PI * 25 * (30 + overlap) - Math.PI * 25 * overlap;
    near(b.volume, expect, 'bolt volume = head + shank − overlap');
    assert(!hexBoltGeometry({ thread: 'M10' } as any).ok, 'bolt without length rejected');
    assert(!hexBoltGeometry({ length: 30 } as any).ok, 'bolt without thread/diameter rejected');
    // custom across-flats for a non-standard size
    assert(ok(hexBoltGeometry({ diameter: 11, acrossFlats: 17, length: 20 }), 'custom AF').acrossFlats === 17, 'explicit acrossFlats honoured');
  }

  // ─── Hex nut ─────────────────────────────────────────────────────
  {
    const n = ok(hexNutGeometry({ thread: 'M10' }), 'M10 nut');
    assert(n.acrossFlats === 16, 'M10 nut across-flats = 16');
    near(n.height, 8, 'default nut height ≈ 0.8·d = 8 mm');
    near(n.boreDiameter, 8.5, 'default bore ≈ 0.85·d = 8.5 mm');
    // with a pitch → tapped-hole minor ≈ d − 1.0827·P.
    const nt = ok(hexNutGeometry({ thread: 'M10', pitch: 1.5 }), 'M10 nut with pitch');
    near(nt.boreDiameter, 10 - 1.0827 * 1.5, 'bore with pitch = d − 1.0827·P');
    // volume = hexArea·height − bore cylinder.
    near(n.volume, hexArea(16) * n.height - Math.PI * (8.5 / 2) ** 2 * n.height, 'nut volume = hex − bore');
    assert(!hexNutGeometry({ thread: 'M10', boreDiameter: 20 }).ok, 'bore ≥ across-flats rejected');
  }

  // ─── bpy construction ────────────────────────────────────────────
  {
    const bs = ok(buildHexBoltBlenderScript({ thread: 'M10', length: 30 }, '/tmp/uc-bolt-smoke.stl'), 'bolt bpy');
    assert(bs.includes('primitive_cylinder_add(vertices=6'), 'hex head = 6-vertex cylinder');
    assert(bs.includes("mod.operation = 'UNION'") && bs.includes("mod.solver = 'EXACT'"), 'head ∪ shank via EXACT union');
    assert(bs.includes('bpy.ops.wm.stl_export(filepath=OUT)') && bs.includes('OUT = "/tmp/uc-bolt-smoke.stl"'), 'bolt exports STL');

    const ns = ok(buildHexNutBlenderScript({ thread: 'M10' }, '/tmp/uc-nut-smoke.stl'), 'nut bpy');
    assert(ns.includes('primitive_cylinder_add(vertices=6'), 'hex nut body = 6-vertex cylinder');
    assert(ns.includes("mod.operation = 'DIFFERENCE'"), 'nut bore via EXACT difference');

    for (const s of [bs, ns]) {
      let round = 0, sq = 0;
      for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
      assert(round === 0 && sq === 0, 'fastener bpy balanced');
      assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf in the fastener bpy');
    }
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-fastener-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-fastener-core smoke cases passed.');
}

main();
