/**
 * engineering-solid-modeling-core smoke.
 *
 * A GENERATOR whose output is a SCRIPT can't be round-tripped through a parser
 * like the DXF core — its correctness is proven by RUNNING it (that's the live
 * Blender→STL drill). So this suite proves everything that must hold BEFORE the
 * script runs: structural validity of both emitters, the injection-safe output
 * path, dimensional correctness of the nominal bbox (the number the live drill
 * asserts the STL against), and fail-closed validation.
 */

import {
  writeBlenderSolidScript,
  writeOpenScadSolid,
  pyStringLiteral,
  validateSolidModel,
  summarizeSolidModel,
  nominalBoundingBox,
  readBinaryStlTriangleCount,
  buildPlateWithHoles,
  buildBracket,
  buildTube,
  buildFlange,
  boltCirclePoints,
  type SolidModel,
} from '../src/lib/engineeringSolidModelingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

/** Very small Python-ish balance check: parens/brackets/braces + no bare nan/inf. */
function pyStructurallySane(src: string): { balanced: boolean; noNanInf: boolean } {
  let round = 0, sq = 0, cur = 0;
  for (const ch of src) {
    if (ch === '(') round++; else if (ch === ')') round--;
    else if (ch === '[') sq++; else if (ch === ']') sq--;
    else if (ch === '{') cur++; else if (ch === '}') cur--;
  }
  return {
    balanced: round === 0 && sq === 0 && cur === 0,
    noNanInf: !/\b(nan|inf|-inf|infinity)\b/i.test(src),
  };
}

function main() {
  // ─── pyStringLiteral: path safety ────────────────────────────────
  {
    assert(pyStringLiteral('/tmp/part.stl') === '"/tmp/part.stl"', 'plain path → double-quoted literal');
    assert(!pyStringLiteral('a"b').includes('a"b'), 'embedded quote is escaped');
    assert(!/\n/.test(pyStringLiteral('a\nb').slice(1, -1)) || pyStringLiteral('a\nb').includes('\\n'), 'newline escaped, never raw');
    assert(pyStringLiteral('a\u2028b').includes('\\u2028'), 'U+2028 escaped (JSON emits it raw otherwise)');
    // A backslash path (unlikely on mac but a real injection vector) stays escaped.
    assert(pyStringLiteral('c:\\x\\y').includes('\\\\'), 'backslashes doubled');
  }

  // ─── Blender emitter: structural validity + embedded output ──────
  {
    const model: SolidModel = {
      positives: [{ kind: 'box', w: 100, d: 60, h: 10, cz: 5 }],
      negatives: [{ kind: 'cylinder', r: 4, h: 30, cx: 40, cy: 20, cz: 5, axis: 'z' }],
    };
    const bpy = unwrap(writeBlenderSolidScript(model, '/tmp/uc-part.stl'), 'writeBlenderSolidScript');
    const sane = pyStructurallySane(bpy);
    assert(sane.balanced, 'bpy: balanced parens/brackets/braces');
    assert(sane.noNanInf, 'bpy: no bare nan/inf tokens');
    assert(bpy.includes('import bpy') && bpy.includes('import math'), 'bpy: imports present');
    assert(bpy.includes('read_factory_settings(use_empty=True)'), 'bpy: hard-resets to an empty scene');
    assert(bpy.includes('_box(100, 60, 10'), 'bpy: box primitive with exact dims');
    assert(bpy.includes("_boolean(part, n0, 'DIFFERENCE')"), 'bpy: negative subtracted via boolean');
    assert(bpy.includes("m.solver = 'EXACT'"), 'bpy: EXACT boolean solver (robust for CSG)');
    assert(bpy.includes('OUT = "/tmp/uc-part.stl"'), 'bpy: output path embedded as a safe literal');
    assert(bpy.includes('bpy.ops.wm.stl_export(filepath=OUT)'), 'bpy: exports STL to the embedded path');
    // The output path is the ONLY place the caller-supplied string appears —
    // and it is quoted. A hostile path cannot inject a statement.
    const hostile = unwrap(writeBlenderSolidScript(model, '/tmp/x.stl")\nimport os\nos.system("rm -rf ~'), 'hostile path');
    assert(pyStructurallySane(hostile).balanced, 'bpy: hostile output path keeps the script balanced');
    assert(!hostile.includes('import os\n'), 'bpy: injected statements do not appear as executable lines');
  }

  // ─── OpenSCAD emitter: structural validity ───────────────────────
  {
    const model: SolidModel = {
      positives: [{ kind: 'cylinder', r: 20, h: 15, axis: 'z' }],
      negatives: [{ kind: 'cylinder', r: 8, h: 17, axis: 'z' }],
    };
    const scad = unwrap(writeOpenScadSolid(model), 'writeOpenScadSolid');
    const balanced = (scad.match(/\{/g) || []).length === (scad.match(/\}/g) || []).length
      && (scad.match(/\(/g) || []).length === (scad.match(/\)/g) || []).length;
    assert(balanced, 'scad: balanced braces + parens');
    assert(scad.includes('difference()'), 'scad: difference() wraps the bore');
    assert(scad.includes('union()'), 'scad: union() groups positives');
    assert(scad.includes('cylinder(h = 15, r = 20'), 'scad: outer cylinder exact');
    assert(scad.includes('cylinder(h = 17, r = 8'), 'scad: bore cylinder exact');
    // No-negative model uses a bare union, not an empty difference.
    const solid = unwrap(writeOpenScadSolid({ positives: [{ kind: 'box', w: 10, d: 10, h: 10 }] }), 'scad no-neg');
    assert(solid.includes('union()') && !solid.includes('difference()'), 'scad: solid part is a bare union');
  }

  // ─── Nominal bbox = the dimensional expectation ──────────────────
  {
    // A 100×60×10 plate sitting on z=0 (center cz=5) spans exactly that box.
    const plate = unwrap(buildPlateWithHoles({ width: 100, depth: 60, thickness: 10 }), 'plate');
    const bbox = nominalBoundingBox(plate)!;
    assert(Math.round(bbox.maxX - bbox.minX) === 100, 'plate bbox width = 100');
    assert(Math.round(bbox.maxY - bbox.minY) === 60, 'plate bbox depth = 60');
    assert(Math.round(bbox.maxZ - bbox.minZ) === 10, 'plate bbox height = 10');
    assert(Math.round(bbox.minZ) === 0 && Math.round(bbox.maxZ) === 10, 'plate sits on z=0');
    const sum = summarizeSolidModel(plate);
    assert(sum.dimensions!.w === 100 && sum.dimensions!.h === 10, 'summary dimensions match');

    // Holes are negatives → they must NOT change the nominal bbox.
    const drilled = unwrap(buildPlateWithHoles({ width: 100, depth: 60, thickness: 10, holes: [{ x: 40, y: 20, diameter: 8 }, { x: -40, y: -20, diameter: 8 }] }), 'drilled plate');
    const db = nominalBoundingBox(drilled)!;
    assert(Math.round(db.maxX - db.minX) === 100 && Math.round(db.maxZ - db.minZ) === 10, 'drilled plate bbox unchanged by holes');
    assert(summarizeSolidModel(drilled).negativeCount === 2, 'two holes recorded as negatives');
  }

  // ─── Part generators ─────────────────────────────────────────────
  {
    // Bracket: two legs → bbox spans legX in X and legZ in Z.
    const bracket = unwrap(buildBracket({ legX: 80, legZ: 60, width: 40, thickness: 6 }), 'bracket');
    const bb = nominalBoundingBox(bracket)!;
    assert(Math.round(bb.maxX - bb.minX) === 80, 'bracket X span = legX');
    assert(Math.round(bb.maxZ - bb.minZ) === 60, 'bracket Z span = legZ');
    assert(Math.round(bb.maxY - bb.minY) === 40, 'bracket Y span = width');
    assert(summarizeSolidModel(bracket).positiveCount === 2, 'bracket is two positive legs');

    // Tube: OD span in the radial axes, height along axis.
    const tube = unwrap(buildTube({ outerDiameter: 30, innerDiameter: 20, height: 25 }), 'tube');
    const tb = nominalBoundingBox(tube)!;
    assert(Math.round(tb.maxX - tb.minX) === 30 && Math.round(tb.maxY - tb.minY) === 30, 'tube OD span = 30');
    assert(Math.round(tb.maxZ - tb.minZ) === 25, 'tube height = 25');
    assert(summarizeSolidModel(tube).negativeCount === 1, 'tube bore is one negative');
    // A solid rod (id=0) has no bore.
    const rod = unwrap(buildTube({ outerDiameter: 30, innerDiameter: 0, height: 25 }), 'rod');
    assert(summarizeSolidModel(rod).negativeCount === 0, 'solid rod has no negative');
  }

  // ─── Bolt circle + flange ────────────────────────────────────────
  {
    // 4 holes on Ø100 PCD starting at 0°: exact positions at 0/90/180/270°.
    const pts = boltCirclePoints(4, 100, 0);
    assert(pts.length === 4, 'bolt circle: 4 points');
    assert(Math.round(pts[0].x) === 50 && Math.round(pts[0].y) === 0, 'hole 0 at (+50, 0)');
    assert(Math.round(pts[1].x) === 0 && Math.round(pts[1].y) === 50, 'hole 1 at (0, +50)');
    assert(Math.round(pts[2].x) === -50 && Math.round(pts[2].y) === 0, 'hole 2 at (-50, 0)');
    assert(Math.round(pts[3].x) === 0 && Math.round(pts[3].y) === -50, 'hole 3 at (0, -50)');

    // A DN80-ish flange: OD 200, thickness 20, center bore 89, 8 holes Ø18 on Ø160.
    const flange = unwrap(buildFlange({ outerDiameter: 200, thickness: 20, centerBore: 89, boltCircle: { count: 8, pcd: 160, holeDiameter: 18 } }), 'flange');
    const fb = nominalBoundingBox(flange)!;
    assert(Math.round(fb.maxX - fb.minX) === 200 && Math.round(fb.maxY - fb.minY) === 200, 'flange OD span = 200');
    assert(Math.round(fb.maxZ - fb.minZ) === 20, 'flange thickness = 20');
    const fsum = summarizeSolidModel(flange);
    assert(fsum.positiveCount === 1, 'flange is one positive disc');
    assert(fsum.negativeCount === 9, 'flange has 1 bore + 8 bolt holes = 9 negatives');

    // Holes outside the OD fail closed.
    assert(!buildFlange({ outerDiameter: 100, thickness: 10, boltCircle: { count: 6, pcd: 95, holeDiameter: 10 } }).ok, 'bolt holes past the OD rejected');
    // A plain disc (no bore, no bolts) is valid.
    const disc = unwrap(buildFlange({ outerDiameter: 80, thickness: 8 }), 'disc');
    assert(summarizeSolidModel(disc).negativeCount === 0, 'plain disc has no negatives');
  }

  // ─── Fail-closed validation ──────────────────────────────────────
  {
    assert(!validateSolidModel({ positives: [] }).ok, 'empty positives rejected');
    assert(!validateSolidModel({ positives: [{ kind: 'box', w: -1, d: 1, h: 1 }] }).ok, 'negative dimension rejected');
    assert(!validateSolidModel({ positives: [{ kind: 'box', w: NaN, d: 1, h: 1 }] }).ok, 'NaN dimension rejected');
    assert(!buildTube({ outerDiameter: 20, innerDiameter: 25, height: 10 }).ok, 'bore >= OD rejected');
    assert(!buildPlateWithHoles({ width: 0, depth: 10, thickness: 5 }).ok, 'zero plate width rejected');
    // A non-finite CENTER must also fail (would emit nan into the script).
    assert(!validateSolidModel({ positives: [{ kind: 'box', w: 1, d: 1, h: 1, cx: Infinity }] }).ok, 'infinite center rejected');
  }

  // ─── Binary-STL triangle-count reader (drill helper) ─────────────
  {
    // Fabricate a minimal 1-triangle binary STL: 80-byte header + uint32(1) + 50 bytes.
    const buf = new Uint8Array(84 + 50);
    new DataView(buf.buffer).setUint32(80, 1, true);
    assert(readBinaryStlTriangleCount(buf) === 1, 'binary STL triangle count read');
    const ascii = new TextEncoder().encode('solid foo\n...');
    assert(readBinaryStlTriangleCount(ascii) === null, 'ASCII STL returns null (no binary header)');
    assert(readBinaryStlTriangleCount(new Uint8Array(10)) === null, 'too-short buffer returns null');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-solid-modeling-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-solid-modeling-core smoke cases passed.');
}

main();
