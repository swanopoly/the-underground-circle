/**
 * engineering-frame-live-drill — the inclusion–exclusion volume cross-check.
 *
 * A welded frame's volume is its members' union, LESS than their naive sum by the
 * joint overlaps — and for axis-aligned box members that union volume is exact by
 * inclusion–exclusion. This drill builds real frames in Blender (CSG-unioning the
 * box members) and asserts the mesh inspector measures exactly that union volume,
 * plus the envelope and watertightness. It is the structural ASSEMBLY analogue of
 * the gear-pair drill: the whole frame validated by one number that only comes
 * out right if every member's size AND position AND the joint overlaps are right.
 *
 * LIVE + MANUAL — never in a smoke chain. Writes only to /tmp.
 * Usage: npx tsx scripts/engineering-frame-live-drill.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { buildFrameBlenderScript, frameGeometry, portalFrame, rectangularFrame, type FrameMember } from '../src/lib/engineeringFrameCore';
import { inspectMesh } from '../src/lib/engineeringMeshInspectCore';

const execFileAsync = promisify(execFile);
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const steps: Array<{ ok: boolean; name: string; detail: string }> = [];
function step(ok: boolean, name: string, detail: string) { steps.push({ ok, name, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); }

function bboxMatches(measured: number[], expected: number[], tol: number): boolean {
  const a = [...measured].sort((x, y) => x - y), b = [...expected].sort((x, y) => x - y);
  return a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, b[i]));
}

async function proveFrame(label: string, members: FrameMember[], stl: string, py: string) {
  const geo = frameGeometry(members, 'steel');
  if (!geo.ok) { step(false, `${label}: geometry`, geo.error); return; }
  const g = geo.value;

  const bpy = buildFrameBlenderScript(members, stl);
  if (!bpy.ok) { step(false, `${label}: generate`, bpy.error); return; }
  writeFileSync(py, bpy.value);
  try { await execFileAsync(BLENDER, ['--background', '--factory-startup', '--python', py], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }); } catch { /* check file */ }
  let stat: ReturnType<typeof statSync> | null = null;
  try { stat = statSync(stl); } catch { /* none */ }
  if (!stat) { step(false, `${label}: Blender`, 'no STL'); return; }

  const insp = inspectMesh(new Uint8Array(readFileSync(stl)));
  if (!insp.ok) { step(false, `${label}: inspect`, insp.error); return; }
  const m = insp.value;

  const volPct = 100 * Math.abs(m.volume_mm3 - g.unionVolume) / g.unionVolume;
  step(volPct <= 0.5, `${label}: volume = inclusion-exclusion union`,
    `${g.memberCount} members, Σ ${g.sumMemberVolume} − overlaps → union ${g.unionVolume} mm³ (${g.unionVolumeExact ? 'exact' : 'estimate'}), measured ${m.volume_mm3} (${volPct.toFixed(3)}%) | ${m.triangles} tris`);
  step(m.watertight, `${label}: watertight`, m.watertight ? 'closed welded body' : `NOT watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold)`);
  const dims = [m.bbox.dims.w, m.bbox.dims.d, m.bbox.dims.h];
  step(bboxMatches(dims, [g.bbox.w, g.bbox.d, g.bbox.h], 0.005), `${label}: envelope = ${g.bbox.w}×${g.bbox.d}×${g.bbox.h} mm`,
    `measured {${dims.map((d) => Math.round(d * 100) / 100).join(', ')}}`);
  step(g.mass_kg! > 0, `${label}: steel takeoff ${g.mass_kg} kg`, `total member length ${g.totalMemberLength} mm`);
}

async function main() {
  try { if (!statSync(BLENDER).isFile()) throw new Error(); } catch { console.log('Blender not installed — skipping.'); process.exit(0); }
  console.log('engineering-frame LIVE drill (frame → Blender CSG union → volume = inclusion-exclusion)\n');

  await proveFrame('portal frame', (portalFrame({ span: 1000, height: 800, width: 50, depth: 50 }) as any).value, '/tmp/uc-drill-frame-portal.stl', '/tmp/uc-drill-frame-portal.py');
  await proveFrame('rectangular frame', (rectangularFrame({ span: 1200, height: 900, width: 60, depth: 40 }) as any).value, '/tmp/uc-drill-frame-rect.stl', '/tmp/uc-drill-frame-rect.py');

  // a ladder: 2 rails + 4 rungs — many members, pairwise-only exact path (no triple joints).
  const ladder: FrameMember[] = [
    { axis: 'z', length: 1000, width: 30, depth: 30, at: [-200, 0, 0], label: 'left rail' },
    { axis: 'z', length: 1000, width: 30, depth: 30, at: [200, 0, 0], label: 'right rail' },
    ...[200, 400, 600, 800].map((z, i) => ({ axis: 'x' as const, length: 430, width: 30, depth: 30, at: [-215, 0, z] as [number, number, number], label: `rung ${i + 1}` })),
  ];
  await proveFrame('ladder (6 members)', ladder, '/tmp/uc-drill-frame-ladder.stl', '/tmp/uc-drill-frame-ladder.py');

  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${passed === steps.length ? 'PASSED' : 'FAILED'}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch((e) => { console.error('drill error:', e?.message || e); process.exit(2); });
