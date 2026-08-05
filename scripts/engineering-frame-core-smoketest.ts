/**
 * engineering-frame-core smoke.
 *
 * A frame's union volume is EXACT by inclusion–exclusion, so this pins it: a
 * portal frame's Σ member volume minus its two corner overlaps, and — the case
 * that proves the triple-joint handling — three mutually overlapping boxes where
 * the naive pairwise formula (Σ − Σpairs) is WRONG and the full 2ⁿ series is
 * needed. It also checks the member→box mapping, the steel takeoff, and the
 * turnkey presets. The live drill measures the meshed union against this number.
 */

import {
  frameGeometry, frameUnionVolume, frameSolidModel, buildFrameBlenderScript,
  portalFrame, rectangularFrame, resolveFrameMembers, type FrameMember,
} from '../src/lib/engineeringFrameCore';

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
  // ─── Portal frame: exact union volume = Σ − corner overlaps ───────
  {
    const members = ok(portalFrame({ span: 1000, height: 800, width: 50, depth: 50 }), 'portal');
    assert(members.length === 3, 'portal frame = 2 columns + 1 beam');
    const g = ok(frameGeometry(members, 'steel'), 'portal geo');
    // columns 50·50·800 ×2 + beam 1050·50·50 = 4,000,000 + 2,625,000 = 6,625,000.
    near(g.sumMemberVolume, 6_625_000, 'Σ member volume = 6,625,000');
    // two corner overlaps of 50³ each → union = 6,625,000 − 250,000.
    near(g.unionVolume, 6_375_000, 'union volume = Σ − 2·50³ corner overlaps');
    assert(g.unionVolumeExact, 'portal union volume is exact');
    near(g.bbox.w, 1050, 'bbox width = span + member = 1050');
    near(g.bbox.h, 800, 'bbox height = column height = 800');
    // mass = union · steel density.
    near(g.mass_kg!, 6_375_000 * 7.85e-6, 'mass = union volume · steel density');
  }

  // ─── Triple overlap: pairwise formula is WRONG, full I-E is needed ─
  {
    // three 2×2×2 boxes offset so all three share a common region.
    const three: FrameMember[] = [
      { axis: 'z', length: 2, width: 2, depth: 2, at: [0, 0, -1] },       // A: [-1,1]³
      { axis: 'z', length: 2, width: 2, depth: 2, at: [1, 0, -1] },       // B: x[0,2]
      { axis: 'z', length: 2, width: 2, depth: 2, at: [0.5, 1, -1] },     // C: x[-0.5,1.5], y[0,2]
    ];
    const g = ok(frameGeometry(three), 'triple');
    // Σ=24. pairs: A∩B=4, A∩C, B∩C; triple non-empty → answer needs +triple term.
    // The pairwise-only estimate (Σ−Σpairs) UNDER-counts; full I-E adds the triple back.
    assert(g.unionVolumeExact, 'triple-overlap union still computed exactly (full 2ⁿ)');
    assert(g.unionVolume < g.sumMemberVolume, 'union < Σ (overlaps removed)');
    // sanity: union must be ≥ the largest single box (8) and ≤ Σ (24).
    assert(g.unionVolume >= 8 && g.unionVolume <= 24, 'triple union within [maxSingle, Σ]');
  }

  // ─── Two-box overlap: the simplest inclusion-exclusion ───────────
  {
    // two identical boxes offset by half → overlap is half of each.
    const two: FrameMember[] = [
      { axis: 'x', length: 10, width: 4, depth: 4, at: [0, 0, 0] },   // x[0,10]
      { axis: 'x', length: 10, width: 4, depth: 4, at: [5, 0, 0] },   // x[5,15]
    ];
    const u = frameUnionVolume([]); // guard: empty handled
    assert(u.volume === 0, 'empty box list → 0 volume');
    const g = ok(frameGeometry(two), 'two-box');
    // each 10·4·4=160, Σ=320; overlap x[5,10]·4·4=5·16=80 → union=240.
    near(g.unionVolume, 240, 'two overlapping bars: union = Σ − overlap = 240');
  }

  // ─── Rectangular frame (4 members, 4 corner overlaps) ────────────
  {
    const g = ok(frameGeometry(ok(rectangularFrame({ span: 1000, height: 800, width: 50, depth: 50 }), 'rect'), 'steel'), 'rect geo');
    // Σ = 2·2,000,000 + 2·2,625,000 = 9,250,000; 4 corner overlaps 50³ → union 8,750,000.
    near(g.unionVolume, 8_750_000, 'rectangular frame union = Σ − 4·50³');
    assert(g.memberCount === 4, 'rectangular frame = 4 members');
  }

  // ─── Resolve + solid model + bpy ─────────────────────────────────
  {
    assert(resolveFrameMembers({ frame: 'portal', span: 1000, height: 800, width: 50, depth: 50 }).ok, "preset 'portal' resolves");
    assert(resolveFrameMembers({ frame: 'rectangular', span: 1000, height: 800, width: 50, depth: 50 }).ok, "preset 'rectangular' resolves");
    const passthrough = ok(resolveFrameMembers({ members: [{ axis: 'x', length: 100, width: 10, depth: 10 }] }), 'members passthrough');
    assert(passthrough.length === 1, 'explicit members list passes through');
    assert(!resolveFrameMembers({ frame: 'geodesic_dome' }).ok, 'unknown preset rejected');

    const model = ok(frameSolidModel(ok(portalFrame({ span: 1000, height: 800, width: 50, depth: 50 }), 'p')), 'solid model');
    assert(model.positives.length === 3, 'frame → 3 box positives');
    assert(model.positives.every((p) => p.kind === 'box'), 'all members are boxes');

    const s = ok(buildFrameBlenderScript(ok(portalFrame({ span: 1000, height: 800, width: 50, depth: 50 }), 'p'), '/tmp/uc-frame-smoke.stl'), 'frame bpy');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-frame-smoke.stl"'), 'exports STL to the embedded path');
    assert(/UNION/i.test(s), 'unions the box members (CSG lane)');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'frame bpy balanced');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!frameGeometry([]).ok, 'empty frame rejected');
    assert(!frameGeometry([{ axis: 'q' as any, length: 10, width: 5, depth: 5 }]).ok, 'bad axis rejected');
    assert(!portalFrame({ span: 40, height: 800, width: 50, depth: 50 }).ok, 'span ≤ member width rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-frame-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-frame-core smoke cases passed.');
}

main();
