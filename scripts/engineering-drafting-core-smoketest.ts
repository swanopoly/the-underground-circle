/**
 * engineering-drafting-core smoke.
 *
 * The load-bearing idea is a ROUND TRIP: everything the writer emits, the
 * verification parser reads back, and the generators are asserted against
 * their DIMENSIONAL intent (a floor plan's bbox must equal the requested mm)
 * — not just "it produced some text". Plus the DXF entity-injection bar: a
 * newline in a layer name or label must never reach the output.
 */

import {
  writeDxfR12,
  parseDxfForVerification,
  validateDxfName,
  sanitizeDxfText,
  buildFloorPlan,
  buildElectricalSchematic,
  insertGrid,
  suggestModelingLane,
  buildBoltCircle,
  boltCirclePoints2d,
  ELECTRICAL_SYMBOLS,
  type DraftDocument,
} from '../src/lib/engineeringDraftingCore';

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

function main() {
  // ─── Name validation = the injection bar ─────────────────────────
  {
    assert(validateDxfName('WALLS').ok, 'plain layer name accepted');
    assert(validateDxfName('E-POWER_1$').ok, 'AutoCAD-legal name chars accepted');
    assert(!validateDxfName('has space').ok, 'space in name rejected');
    assert(!validateDxfName('two\nlines').ok, 'NEWLINE in name rejected (entity injection)');
    assert(!validateDxfName('x'.repeat(32)).ok, 'over-31-char name rejected');
    assert(!validateDxfName('').ok, 'empty name rejected');
    // Text sanitization strips, never rejects.
    assert(sanitizeDxfText('Room "A" — 12m²').includes('Room'), 'ordinary label text preserved');
    assert(!/\n/.test(sanitizeDxfText('line1\nline2')), 'newline stripped from label text');
    assert(!/[\u2028\u2029]/.test(sanitizeDxfText('a\u2028b\u2029c')), 'ES line separators stripped from label');
  }

  // ─── Writer → parser round trip ──────────────────────────────────
  {
    const doc: DraftDocument = {
      layers: [{ name: 'WALLS', color: 7 }, { name: 'DIMS', color: 2 }],
      blocks: [{ name: 'TICK', entities: [{ kind: 'line', layer: 'DIMS', x1: 0, y1: 0, x2: 1, y2: 1 }] }],
      entities: [
        { kind: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 100, y2: 0 },
        { kind: 'circle', layer: 'WALLS', cx: 50, cy: 50, r: 25 },
        { kind: 'arc', layer: 'WALLS', cx: 0, cy: 0, r: 10, startDeg: 0, endDeg: 90 },
        { kind: 'polyline', layer: 'WALLS', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        { kind: 'text', layer: 'DIMS', x: 5, y: 5, height: 2, text: 'hi' },
        { kind: 'insert', layer: 'DIMS', blockName: 'TICK', x: 3, y: 3 },
      ],
    };
    const dxf = unwrap(writeDxfR12(doc), 'writeDxfR12 round-trip doc');
    const p = parseDxfForVerification(dxf);
    assert(p.acadVersion === 'AC1009', 'parsed R12 version tag');
    assert(p.hasEof && p.sectionsBalanced, 'SECTION/ENDSEC balanced + EOF present');
    assert(p.layers.includes('WALLS') && p.layers.includes('DIMS') && p.layers.includes('0'), 'declared layers (incl. implicit 0) parsed back');
    assert(p.blocks.includes('TICK'), 'block definition parsed back');
    assert(p.entityCounts.LINE === 1, 'exactly 1 LINE in ENTITIES (block-internal lines not double-counted)');
    assert(p.entityCounts.CIRCLE === 1 && p.entityCounts.ARC === 1, 'circle + arc counted');
    assert(p.entityCounts.POLYLINE === 1, 'polyline counted once (its VERTEX/SEQEND excluded)');
    assert(p.entityCounts.INSERT === 1 && p.insertsByBlock.TICK === 1, 'INSERT attributed to its block');
    assert(p.entitiesByLayer.WALLS === 4, 'per-layer count: 4 WALLS entities');
    assert(p.entitiesByLayer.DIMS === 2, 'per-layer count: 2 DIMS entities');
  }

  // ─── Writer refuses undeclared layers + dangling block refs ─────
  {
    const badLayer = writeDxfR12({ layers: [], blocks: [], entities: [{ kind: 'line', layer: 'GHOST', x1: 0, y1: 0, x2: 1, y2: 1 }] });
    assert(!badLayer.ok && /undeclared layer/.test((badLayer as any).error), 'entity on undeclared layer refused');
    const badBlock = writeDxfR12({ layers: [{ name: 'L' }], blocks: [], entities: [{ kind: 'insert', layer: 'L', blockName: 'NOPE', x: 0, y: 0 }] });
    assert(!badBlock.ok && /undefined block/.test((badBlock as any).error), 'INSERT of undefined block refused');
    const badName = writeDxfR12({ layers: [{ name: 'bad name' }], blocks: [], entities: [] });
    assert(!badName.ok, 'invalid layer name refused at write time');
  }

  // ─── Floor plan: DIMENSIONAL correctness ─────────────────────────
  {
    const doc = unwrap(buildFloorPlan({
      width: 12000, height: 8000, wallThickness: 200,
      rooms: [{ name: 'Office', x: 500, y: 500, width: 4000, height: 3000 }],
      doors: [{ x: 4000, y: 200, width: 900 }, { x: 8000, y: 200 }],
      windows: [{ x: 2000, y: 7800, width: 1500 }],
      dimensions: true,
    }), 'buildFloorPlan');
    const dxf = unwrap(writeDxfR12(doc), 'floor plan → DXF');
    const p = parseDxfForVerification(dxf);
    // The building envelope drives the bbox max; dimension lines push minima negative.
    assert(p.bbox !== null && p.bbox.maxX >= 12000 - 1 && p.bbox.maxX <= 12000 + 1, `bbox width reaches requested 12000mm (got ${p.bbox?.maxX})`);
    assert(p.bbox !== null && p.bbox.maxY >= 8000 - 1 && p.bbox.maxY <= 8000 + 1, `bbox height reaches requested 8000mm (got ${p.bbox?.maxY})`);
    assert(p.layers.includes('WALLS') && p.layers.includes('DOORS') && p.layers.includes('WINDOWS') && p.layers.includes('DIMS'), 'all architectural layers declared');
    assert(p.insertsByBlock.DOOR === 2, 'two door blocks inserted');
    assert(p.insertsByBlock.WINDOW === 1, 'one window block inserted');
    assert((p.entityCounts.TEXT ?? 0) >= 3, 'room label + 2 dimension labels present as TEXT');
  }

  // ─── Electrical schematic: symbols as blocks ─────────────────────
  {
    const doc = unwrap(buildElectricalSchematic({
      placements: [
        { symbol: 'battery', x: 0, y: 0, label: 'BT1' },
        { symbol: 'resistor', x: 40, y: 0, label: 'R1' },
        { symbol: 'lamp', x: 80, y: 0, label: 'LP1' },
        { symbol: 'ground', x: 0, y: -40 },
        { symbol: 'resistor', x: 40, y: -40, label: 'R2' },
      ],
      wires: [
        { x1: 10, y1: 0, x2: 40, y2: 0 }, { x1: 50, y1: 0, x2: 80, y2: 0 },
        { x1: 5, y1: 0, x2: 5, y2: -30 },
      ],
    }), 'buildElectricalSchematic');
    const dxf = unwrap(writeDxfR12(doc), 'schematic → DXF');
    const p = parseDxfForVerification(dxf);
    assert(p.blocks.includes('SYM_BATTERY') && p.blocks.includes('SYM_RESISTOR') && p.blocks.includes('SYM_LAMP') && p.blocks.includes('SYM_GROUND'), 'used symbol blocks defined');
    assert(!p.blocks.includes('SYM_CAPACITOR'), 'unused symbol block NOT defined (define-only-what-is-used)');
    assert(p.insertsByBlock.SYM_RESISTOR === 2, 'resistor placed twice from one block def');
    assert(p.insertsByBlock.SYM_BATTERY === 1 && p.insertsByBlock.SYM_LAMP === 1, 'battery + lamp placed once each');
    assert(p.entityCounts.LINE === 3, 'three wire lines in the ENTITIES section');
    assert((p.entityCounts.TEXT ?? 0) === 4, 'four labels (ground had none)');
    assert(p.entitiesByLayer.WIRES === 3 && p.entitiesByLayer.SYMBOLS === 5 && p.entitiesByLayer.LABELS === 4, 'entities land on WIRES/SYMBOLS/LABELS layers');
  }

  // ─── All 7 symbols build and serialize ───────────────────────────
  {
    for (const symbol of ELECTRICAL_SYMBOLS) {
      const doc = unwrap(buildElectricalSchematic({ placements: [{ symbol, x: 0, y: 0 }] }), `schematic(${symbol})`);
      const dxf = unwrap(writeDxfR12(doc), `${symbol} → DXF`);
      const p = parseDxfForVerification(dxf);
      assert(p.blocks.length === 1 && p.insertsByBlock[p.blocks[0]] === 1, `${symbol}: one block, one insert`);
    }
  }

  // ─── Automation: insertGrid ──────────────────────────────────────
  {
    const grid = unwrap(insertGrid({ blockName: 'DESK', layer: 'FURNITURE', originX: 0, originY: 0, cols: 4, rows: 3, spacingX: 1500, spacingY: 1200 }), 'insertGrid');
    assert(grid.length === 12, 'grid produced cols×rows = 12 inserts');
    assert(grid.every((e) => e.kind === 'insert' && e.blockName === 'DESK' && e.layer === 'FURNITURE'), 'every grid entity is the right insert');
    const corner = grid[grid.length - 1];
    assert(corner.kind === 'insert' && corner.x === 4500 && corner.y === 2400, 'last cell at (3·1500, 2·1200)');
    const bad = insertGrid({ blockName: 'bad name', layer: 'L', originX: 0, originY: 0, cols: 1, rows: 1, spacingX: 1, spacingY: 1 });
    assert(!bad.ok, 'grid with an invalid block name refused');
  }

  // ─── 3D routing = honest boundary ────────────────────────────────
  {
    assert(suggestModelingLane('extrude this profile into a solid').engine === 'openscad', 'generic 3D → openscad');
    assert(suggestModelingLane('import the STEP assembly and fillet the edges').engine === 'freecadcmd', 'STEP/fillet → freecad');
    assert(suggestModelingLane('photoreal render with studio lighting').engine === 'blender', 'render → blender');
  }

  // ─── Bolt circle: exact trig + parse-back count ──────────────────
  {
    // 6 holes on Ø120 PCD from 0°: first at (60,0), positions every 60°.
    const pts = boltCirclePoints2d(6, 120, 0);
    assert(pts.length === 6, 'bolt circle: 6 points');
    assert(Math.round(pts[0].x) === 60 && Math.round(pts[0].y) === 0, 'hole 0 at (+60, 0)');
    assert(Math.round(pts[3].x) === -60 && Math.round(pts[3].y) === 0, 'hole 3 diametrically opposite at (-60, 0)');
    // 60° hole: (60·cos60, 60·sin60) = (30, 51.96)
    assert(Math.round(pts[1].x) === 30 && Math.round(pts[1].y) === 52, 'hole 1 at (30, 51.96)');

    // A flange face plate: OD 200, bore 80, 8 holes Ø14 on Ø160.
    const doc = unwrap(buildBoltCircle({ outerDiameter: 200, centerBore: 80, count: 8, pcd: 160, holeDiameter: 14 }), 'boltcircle');
    const dxf = unwrap(writeDxfR12(doc), 'boltcircle → DXF');
    const p = parseDxfForVerification(dxf);
    // Circles: 1 outer + 1 bore + 1 PCD reference + 8 holes = 11.
    assert(p.entityCounts.CIRCLE === 11, `11 circles (outer+bore+PCD+8 holes), got ${p.entityCounts.CIRCLE}`);
    assert(p.entitiesByLayer.HOLES === 9, '8 holes + bore on HOLES layer');
    assert(p.layers.includes('CONSTRUCTION') && p.layers.includes('OUTLINE'), 'mechanical layers declared');
    // The outer circle sets the bbox: Ø200 spans -100..100.
    assert(Math.round(p.bbox!.maxX) === 100 && Math.round(p.bbox!.minX) === -100, 'bbox spans the OD (±100)');
    assert((p.entityCounts.TEXT ?? 0) >= 1, 'PCD callout present');

    // Fail-closed: holes past the OD.
    assert(!buildBoltCircle({ outerDiameter: 100, centerBore: 0, count: 4, pcd: 95, holeDiameter: 12 }).ok, 'holes past OD rejected');
  }

  // ─── The written DXF never contains a raw injected newline value ─
  {
    // A hostile label with an embedded fake group code must be flattened.
    const doc = unwrap(buildElectricalSchematic({ placements: [{ symbol: 'resistor', x: 0, y: 0, label: 'R1\n0\nCIRCLE\n8\nHACK' }] }), 'hostile-label schematic');
    const dxf = unwrap(writeDxfR12(doc), 'hostile-label → DXF');
    const p = parseDxfForVerification(dxf);
    assert((p.entityCounts.CIRCLE ?? 0) === 0, 'injected fake CIRCLE via a label newline did NOT become an entity');
    assert(!p.layers.includes('HACK'), 'injected fake layer did not appear');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-drafting-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-drafting-core smoke cases passed.');
}

main();
