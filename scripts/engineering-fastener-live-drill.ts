/**
 * engineering-fastener-live-drill — the closed-form fastener volume check.
 *
 * A hex bolt's volume is hexArea·headH + shank − overlap; a hex nut's is
 * hexArea·height − bore. This drill builds real hex bolts and nuts in Blender
 * (hex prism = 6-vertex cylinder; head∪shank and hex−bore via the EXACT solver)
 * and asserts the mesh inspector measures those volumes, plus the across-flats /
 * across-corners envelope and watertightness. For the nut it also confirms the
 * measured volume is below the solid-hex volume — i.e. the bore is really there.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-fastener-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import {
  hexBoltGeometry, hexNutGeometry, buildHexBoltBlenderScript, buildHexNutBlenderScript,
} from '../src/lib/engineeringFastenerCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

function bboxMatches(measured: number[], expected: number[], tol: number): boolean {
  const a = [...measured].sort((x, y) => x - y), b = [...expected].sort((x, y) => x - y);
  return a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, b[i]));
}

async function runToStl(bpy: string, stl: string, py: string): Promise<ReturnType<typeof inspectMesh> | null> {
  writeFileSync(py, bpy);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  try { statSync(stl); } catch { return null; }
  return inspectMesh(new Uint8Array(readFileSync(stl)));
}

async function proveBolt(spec: any, stl: string, py: string) {
  const geo = hexBoltGeometry(spec);
  if (!geo.ok) { step(false, 'bolt geometry', geo.error); return; }
  const g = geo.value;
  const label = `M${g.nominalDiameter}×${g.shankLength} bolt`;
  const bpy = buildHexBoltBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  const insp = await runToStl(bpy.value, stl, py);
  if (!insp || !insp.ok) { step(false, `${label}: inspect`, insp ? insp.error : 'no STL'); return; }
  const m = insp.value;
  const volPct = 100 * Math.abs(m.volume_mm3 - g.volume) / g.volume;
  step(volPct <= 0.5, `${label}: volume = head + shank − overlap`, `analytical ${g.volume} mm³, measured ${m.volume_mm3} (${volPct.toFixed(2)}%) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed solid' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  step(bboxMatches([m.bbox.dims.w, m.bbox.dims.d, m.bbox.dims.h], [g.acrossFlats, g.acrossCorners, g.totalHeight], 0.01),
    `${label}: envelope = AF ${g.acrossFlats} × corners ${g.acrossCorners} × ${g.totalHeight}`, `measured {${[m.bbox.dims.w, m.bbox.dims.d, m.bbox.dims.h].map((d) => Math.round(d * 100) / 100).join(', ')}}`);
}

async function proveNut(spec: any, stl: string, py: string) {
  const geo = hexNutGeometry(spec);
  if (!geo.ok) { step(false, 'nut geometry', geo.error); return; }
  const g = geo.value;
  const label = `M${g.nominalDiameter} nut`;
  const bpy = buildHexNutBlenderScript(spec, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  const insp = await runToStl(bpy.value, stl, py);
  if (!insp || !insp.ok) { step(false, `${label}: inspect`, insp ? insp.error : 'no STL'); return; }
  const m = insp.value;
  const volPct = 100 * Math.abs(m.volume_mm3 - g.volume) / g.volume;
  step(volPct <= 0.5, `${label}: volume = hex − bore`, `analytical ${g.volume} mm³, measured ${m.volume_mm3} (${volPct.toFixed(2)}%) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight (with the bore)`, m.watertight ? 'closed solid with a through-hole' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  const solidHex = (3 * Math.sqrt(3) / 2) * (g.acrossFlats / Math.sqrt(3)) ** 2 * g.height;
  step(m.volume_mm3 < solidHex * 0.98, `${label}: bore is really present`, `measured ${m.volume_mm3} < solid hex ${Math.round(solidHex)} mm³`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-fastener LIVE drill (hex bolt/nut → Blender → closed-form volume)\n');

  await proveBolt({ thread: 'M10', length: 30 }, '/tmp/uc-drill-bolt-m10.stl', '/tmp/uc-drill-bolt-m10.py');
  await proveBolt({ thread: 'M16', length: 50 }, '/tmp/uc-drill-bolt-m16.stl', '/tmp/uc-drill-bolt-m16.py');
  await proveNut({ thread: 'M10', pitch: 1.5 }, '/tmp/uc-drill-nut-m10.stl', '/tmp/uc-drill-nut-m10.py');
  await proveNut({ thread: 'M16', pitch: 2 }, '/tmp/uc-drill-nut-m16.stl', '/tmp/uc-drill-nut-m16.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
