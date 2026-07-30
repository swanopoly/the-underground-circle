/**
 * engineering-thread-core smoke.
 *
 * ISO metric threads have EXACT diameters — d2 = d − 0.6495·P and
 * d3 = d − 1.2269·P — so this pins them against hand-computed references, checks
 * the coarse-pitch table, and pins the verification invariant that makes the
 * live drill honest: a threaded rod's volume is bracketed by its minor and major
 * cylinders (minorCyl < pitchCyl < majorCyl), so the measured STL must land in
 * that range. It also checks the proven bmesh-swept-rib + EXACT-union bpy.
 */

import {
  isoMetricThread, coarsePitchFor, threadedRodGeometry, buildThreadedRodBlenderScript,
  ISO_COARSE_PITCH,
} from '../src/lib/engineeringThreadCore';
import { helixDevelopedLength } from '../src/lib/engineeringHelixCore';

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
  // ─── ISO external-thread diameters, hand-computed ────────────────
  {
    // M12 × 1.75: d2 = 12 − 0.6495·1.75 = 10.863375; d3 = 12 − 1.2269·1.75 = 9.852925.
    const t = ok(isoMetricThread(12, 1.75), 'M12×1.75');
    near(t.majorDiameter, 12, 'M12 major = 12');
    near(t.pitchDiameter, 12 - 0.6495 * 1.75, 'M12 pitch diameter = d − 0.6495P');
    near(t.minorDiameter, 12 - 1.2269 * 1.75, 'M12 minor diameter = d − 1.2269P');
    near(t.fundamentalHeight, (1.75 * Math.sqrt(3)) / 2, 'H = P·√3/2');
    near(t.threadHeightRadial, (12 - (12 - 1.2269 * 1.75)) / 2, 'radial tooth height = (d − d3)/2');

    // M8 × 1.25: d3 = 8 − 1.2269·1.25 = 6.466375.
    const m8 = ok(isoMetricThread(8, 1.25), 'M8×1.25');
    near(m8.minorDiameter, 8 - 1.2269 * 1.25, 'M8 minor diameter');

    assert(!isoMetricThread(2, 3).ok, 'pitch ≥ diameter rejected');
    assert(!isoMetricThread(-5, 1).ok, 'negative diameter rejected');
  }

  // ─── Coarse-pitch table ──────────────────────────────────────────
  {
    assert(coarsePitchFor('M8') === 1.25, 'M8 → 1.25 coarse pitch');
    assert(coarsePitchFor('m12') === 1.75, 'lowercase m12 → 1.75');
    assert(coarsePitchFor('12') === 1.75, 'bare "12" → 1.75');
    assert(coarsePitchFor(6) === 1.0, 'numeric 6 → 1.0');
    assert(coarsePitchFor('2.5') === 0.45, 'M2.5 → 0.45');
    assert(coarsePitchFor('M9') === null, 'no coarse pitch for M9 → null');
    // every table entry is a positive pitch smaller than its diameter
    for (const [d, p] of Object.entries(ISO_COARSE_PITCH)) {
      assert(p > 0 && p < Number(d), `coarse pitch ${p} valid for M${d}`);
    }
  }

  // ─── Threaded rod geometry + the volume bracket invariant ────────
  {
    const g = ok(threadedRodGeometry({ thread: 'M12', length: 24 }), 'M12 rod');
    near(g.pitch, 1.75, 'M12 default pitch = coarse 1.75');
    near(g.turns, 24 / 1.75, 'turns = length / pitch');
    near(g.developedLength, helixDevelopedLength(g.pitchDiameter / 2, g.pitch, g.turns), 'developed length at the pitch radius');
    // THE invariant the live drill leans on: minor < pitch < major cylinder.
    assert(g.minorCylVolume < g.pitchCylVolume && g.pitchCylVolume < g.majorCylVolume, 'volume bracket minorCyl < pitchCyl < majorCyl');
    near(g.majorCylVolume, Math.PI * 6 * 6 * 24, 'major cylinder = π·(d/2)²·L');

    // explicit pitch overrides the coarse default
    const fine = ok(threadedRodGeometry({ thread: 'M12', pitch: 1.25, length: 20 }), 'M12 fine');
    near(fine.pitch, 1.25, 'explicit fine pitch honoured');

    // bare nominal diameter also works
    const bare = ok(threadedRodGeometry({ nominalDiameter: 8, length: 16 }), 'bare Ø8 rod');
    near(bare.pitch, 1.25, 'nominalDiameter 8 → coarse 1.25');

    assert(!threadedRodGeometry({ thread: 'M12' } as any).ok, 'no length → rejected');
    assert(!threadedRodGeometry({ thread: 'M9', length: 20 }).ok, 'unknown coarse pitch, none given → rejected');
  }

  // ─── bpy construction (the DE-RISK'd recipe) ─────────────────────
  {
    const s = ok(buildThreadedRodBlenderScript({ thread: 'M12', length: 24 }, '/tmp/uc-thread-smoke.stl'), 'thread bpy');
    assert(s.includes('def tooth(phase):'), 'defines the truncated-ISO tooth profile');
    assert(s.includes('r = R_MINOR + THREAD_H * tooth(phase)'), 'radius is a heightfield: minor + threadHeight·tooth(phase)');
    assert(s.includes('phase = (z - theta / (2 * math.pi) * P) / P'), 'phase = (z − θ·P/2π)/P places you within the pitch');
    assert(s.includes('mesh.from_pydata(verts, [], faces)'), 'one swept mesh (no boolean union)');
    assert(!/BOOLEAN|modifier/.test(s), 'no boolean modifier — a single swept surface stays manifold on the STL');
    assert(s.includes('faces.append((cbot, vidx(jn, 0), vidx(j, 0)))') && s.includes('ctop'), 'fan-caps both ends → closed 2-manifold');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-thread-smoke.stl"'), 'exports STL to the embedded path');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'thread bpy balanced');
    assert(!/\b(nan|inf)\b/i.test(s), 'no nan/inf in the emitted constants');

    // path is embedded through the injection-safe literal
    const inj = ok(buildThreadedRodBlenderScript({ thread: 'M8', length: 16 }, '/tmp/a"; import os; os.system("x")#.stl'), 'injection path');
    assert(!inj.includes('os.system("x")') || inj.includes('\\"'), 'output path is escaped, not raw-injected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-thread-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-thread-core smoke cases passed.');
}

main();
