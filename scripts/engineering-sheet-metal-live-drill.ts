/**
 * engineering-sheet-metal-live-drill — the bent-part volume cross-check.
 *
 * A sheet-metal part is a ribbon of thickness t (following the folded centreline
 * of length L_geo) extruded across the part width W, so its volume is exactly
 * t·L_geo·W. This drill builds real bent parts in Blender (extruding the ribbon
 * cross-section) and asserts the mesh inspector measures that volume and the
 * predicted bounding box — a fourth solid family (after CSG, extrude/revolve, and
 * helical) whose measured volume lands on an independent closed-form prediction.
 * If the fold, the ribbon offset, or the bend geometry were wrong, the measured
 * volume or the envelope would not match.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-sheet-metal-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { buildBentPartBlenderScript, sheetMetalGeometry, type SheetMetalSpec } from '../src/lib/engineeringSheetMetalCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

/** Two multisets of three dims agree within tol (robust to axis-name order). */
function bboxMatches(measured: number[], expected: number[], tol: number): boolean {
  const a = [...measured].sort((x, y) => x - y), b = [...expected].sort((x, y) => x - y);
  return a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, b[i]));
}

async function proveBend(label: string, spec: SheetMetalSpec, stl: string, py: string) {
  const geo = sheetMetalGeometry(spec);
  if (!geo.ok) { step(false, `${label}: geometry`, geo.error); return; }
  const g = geo.value;

  const bpy = buildBentPartBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, 'no STL'); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;

  const volPct = 100 * Math.abs(m.volume_mm3 - g.volume) / g.volume;
  step(volPct <= 0.5, `${label}: volume = t·L_geo·width`,
    `analytical ${g.volume} mm³ (t ${g.thickness} × L_geo ${g.geometricDevelopedLength} × w ${g.width}), measured ${m.volume_mm3} (${volPct.toFixed(2)}%) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed solid' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  const dims = [m.bbox.dims.w, m.bbox.dims.d, m.bbox.dims.h];
  step(bboxMatches(dims, [g.bbox.w, g.bbox.h, g.bbox.d], 0.01), `${label}: bounding box = predicted envelope`,
    `expected {${g.bbox.w}, ${g.bbox.h}, ${g.bbox.d}} mm, measured {${dims.map((d) => Math.round(d * 100) / 100).join(', ')}}`);
  // the flat blank the shop cuts is shorter than the geometric developed length
  step(g.flatPatternLength < g.geometricDevelopedLength, `${label}: flat blank = ${g.flatPatternLength} mm (K-factor)`,
    `flat ${g.flatPatternLength} < mid-surface ${g.geometricDevelopedLength} by Σθt(0.5−K)`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-sheet-metal LIVE drill (bent part → Blender → volume = t·L_geo·width)\n');

  await proveBend('L-bracket 90°', { thickness: 2, width: 40, kFactor: 0.44, sequence: [{ flange: 50 }, { bend: 90, radius: 3 }, { flange: 30 }] }, '/tmp/uc-drill-sheet-l.stl', '/tmp/uc-drill-sheet-l.py');
  await proveBend('U-channel', { thickness: 1.5, width: 60, sequence: [{ flange: 20 }, { bend: 90 }, { flange: 40 }, { bend: 90 }, { flange: 20 }] }, '/tmp/uc-drill-sheet-u.stl', '/tmp/uc-drill-sheet-u.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
