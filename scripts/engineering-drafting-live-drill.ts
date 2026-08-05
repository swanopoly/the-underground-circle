/**
 * engineering-drafting-live-drill — cross-IMPLEMENTATION proof that the DXF
 * this repo GENERATES parses identically under a reader written from scratch in
 * a DIFFERENT language (Python), independent of the TS parser.
 *
 * The smoke round-trips through our OWN parser, which proves internal
 * consistency but not that the format is objectively correct. This drill writes
 * a floor plan + electrical schematic to disk, runs an independent Python DXF
 * reader over each (scripts/dxf-verify.py — raw group-code pairs, no DXF
 * library, no shared code with the generator), and asserts the two
 * implementations AGREE on version, layers, blocks, entity counts, and bbox. A
 * file our parser likes but a foreign reader disagrees with would fail here.
 *
 * (Blender was the first choice for a real-CAD-tool import, but this Blender
 * build ships no DXF add-on — `import_scene.dxf` is registered but its addon is
 * absent — so a language-independent reader is the strongest verifier available
 * on this machine. FreeCAD/OpenSCAD, which read DXF natively, are not installed.)
 *
 * LIVE + MANUAL by design — never in a smoke chain. Writes only to /tmp.
 *
 * Usage: npx tsx scripts/engineering-drafting-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync } from 'node:fs';
import {
  writeDxfR12,
  parseDxfForVerification,
  buildFloorPlan,
  buildElectricalSchematic,
} from '../src/lib/engineeringDraftingCore';

const execFileAsync = promisify(execFile);
const VERIFIER = 'scripts/dxf-verify.py';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) {
  steps.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
}

async function independentVerify(dxfPath: string): Promise<any> {
  const { stdout } = await execFileAsync('python3', [VERIFIER, dxfPath], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/** Deep-equal on the fields both implementations must agree about. */
function agrees(ours: any, theirs: any): { ok: boolean; diff: string } {
  const norm = (o: any) => JSON.stringify({
    acadVersion: o.acadVersion,
    layers: [...(o.layers || [])].sort(),
    blocks: [...(o.blocks || [])].sort(),
    entityCounts: o.entityCounts || {},
    insertsByBlock: o.insertsByBlock || {},
    totalEntities: o.totalEntities,
    bbox: o.bbox && (Array.isArray(o.bbox)
      ? o.bbox
      : [Math.round(o.bbox.minX), Math.round(o.bbox.minY), Math.round(o.bbox.maxX), Math.round(o.bbox.maxY)]),
    hasEof: o.hasEof, sectionsBalanced: o.sectionsBalanced,
  });
  const a = norm(ours); const b = norm(theirs);
  return { ok: a === b, diff: a === b ? '' : `\n  ours:   ${a}\n  python: ${b}` };
}

async function main() {
  console.log('engineering-drafting LIVE cross-implementation drill (TS generator → independent Python DXF reader)\n');

  // ── Floor plan ────────────────────────────────────────────────────────────
  const fp = buildFloorPlan({
    width: 12000, height: 8000, wallThickness: 200,
    rooms: [
      { name: 'Lab', x: 500, y: 500, width: 5000, height: 4000 },
      { name: 'Office', x: 6000, y: 500, width: 5000, height: 4000 },
    ],
    doors: [{ x: 5500, y: 200 }, { x: 3000, y: 4500 }],
    windows: [{ x: 2000, y: 7800, width: 1500 }, { x: 9000, y: 7800, width: 1500 }],
    dimensions: true,
  });
  if (!fp.ok) { step(false, 'floor plan build', fp.error); return finish(); }
  const fpDxf = writeDxfR12(fp.value);
  if (!fpDxf.ok) { step(false, 'floor plan write', fpDxf.error); return finish(); }
  const fpPath = '/tmp/uc-floorplan.dxf';
  writeFileSync(fpPath, fpDxf.value);
  const fpSum = parseDxfForVerification(fpDxf.value);
  step(true, 'floor plan generated', `${statSync(fpPath).size} bytes → ${fpPath} | our parser: ${fpSum.totalEntities} entities, bbox to ${Math.round(fpSum.bbox!.maxX)}×${Math.round(fpSum.bbox!.maxY)}mm`);

  const fpForeign = await independentVerify(fpPath);
  const fpAgree = agrees(fpSum, fpForeign);
  step(fpAgree.ok, 'floor plan: independent Python reader AGREES',
    fpAgree.ok
      ? `foreign reader extracted the SAME ${fpForeign.totalEntities} entities, layers [${fpForeign.layers.join(', ')}], bbox ${JSON.stringify(fpForeign.bbox)}`
      : `disagreement${fpAgree.diff}`);

  // ── Electrical schematic ──────────────────────────────────────────────────
  const sch = buildElectricalSchematic({
    placements: [
      { symbol: 'battery', x: 0, y: 0, label: 'BT1' },
      { symbol: 'switch', x: 40, y: 0, label: 'SW1' },
      { symbol: 'resistor', x: 80, y: 0, label: 'R1' },
      { symbol: 'lamp', x: 120, y: 0, label: 'LP1' },
      { symbol: 'ground', x: 0, y: -40 },
    ],
    wires: [
      { x1: 10, y1: 0, x2: 40, y2: 0 }, { x1: 50, y1: 0, x2: 80, y2: 0 },
      { x1: 90, y1: 0, x2: 120, y2: 0 }, { x1: 125, y1: 0, x2: 125, y2: -50 },
      { x1: 5, y1: 0, x2: 5, y2: -30 },
    ],
  });
  if (!sch.ok) { step(false, 'schematic build', sch.error); return finish(); }
  const schDxf = writeDxfR12(sch.value);
  if (!schDxf.ok) { step(false, 'schematic write', schDxf.error); return finish(); }
  const schPath = '/tmp/uc-schematic.dxf';
  writeFileSync(schPath, schDxf.value);
  const schSum = parseDxfForVerification(schDxf.value);
  step(true, 'schematic generated', `${statSync(schPath).size} bytes → ${schPath} | blocks: ${schSum.blocks.join(', ')} | inserts: ${JSON.stringify(schSum.insertsByBlock)}`);

  const schForeign = await independentVerify(schPath);
  const schAgree = agrees(schSum, schForeign);
  step(schAgree.ok, 'schematic: independent Python reader AGREES',
    schAgree.ok
      ? `foreign reader confirmed blocks ${JSON.stringify(schForeign.blocks)} and inserts ${JSON.stringify(schForeign.insertsByBlock)}`
      : `disagreement${schAgree.diff}`);

  finish();
}

function finish() {
  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
