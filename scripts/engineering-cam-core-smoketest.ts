/**
 * engineering-cam-core smoke.
 *
 * A cam's shape is the polar plot of a displacement program, so this pins the
 * motion LAWS against their textbook values (all three pass 0→h and the
 * symmetric ones cross h/2 at the midpoint), checks the program must close
 * (return to its start displacement and sum to 360°), and pins the exact facts a
 * cam gives — greatest radius = base + max lift, and the extruded profile's own
 * shoelace volume. The live drill measures the meshed disc against that.
 */

import {
  motionFraction, camGeometry, camProfilePoints, camExtrudeVolume, buildCamBlenderScript, type CamSpec,
} from '../src/lib/engineeringCamCore';
import { polygonArea } from '../src/lib/engineeringProfileSolidCore';

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

const PROGRAM: CamSpec = {
  baseRadius: 25, thickness: 12, boreDiameter: 10,
  segments: [
    { kind: 'dwell', angle: 90 },
    { kind: 'rise', angle: 90, lift: 15, motion: 'harmonic' },
    { kind: 'dwell', angle: 90 },
    { kind: 'fall', angle: 90, lift: 15, motion: 'harmonic' },
  ],
};

function main() {
  // ─── Motion laws vs textbook ─────────────────────────────────────
  {
    for (const m of ['uniform', 'harmonic', 'cycloidal'] as const) {
      near(motionFraction(m, 0), 0, `${m} starts at 0`);
      near(motionFraction(m, 1), 1, `${m} ends at 1 (full lift)`);
    }
    near(motionFraction('uniform', 0.5), 0.5, 'uniform is linear (½ → ½)');
    near(motionFraction('harmonic', 0.5), 0.5, 'harmonic crosses ½ at the midpoint');
    near(motionFraction('cycloidal', 0.5), 0.5, 'cycloidal crosses ½ at the midpoint');
    near(motionFraction('harmonic', 0.25), (1 - Math.cos(Math.PI / 4)) / 2, 'harmonic at ¼ = (1−cos(π/4))/2');
    near(motionFraction('cycloidal', 0.25), 0.25 - Math.sin(Math.PI / 2) / (2 * Math.PI), 'cycloidal at ¼');
    // clamped outside [0,1]
    near(motionFraction('harmonic', 1.5), 1, 'fraction clamps above 1');
  }

  // ─── Cam geometry ────────────────────────────────────────────────
  {
    const g = ok(camGeometry(PROGRAM), 'cam geo');
    near(g.baseRadius, 25, 'base radius = 25');
    near(g.maxLift, 15, 'max lift = 15');
    near(g.maxRadius, 40, 'max radius = base + lift = 40');
    near(g.totalAngle, 360, 'program spans 360°');
    // the profile area is bounded by the base circle and the peak circle.
    assert(g.profileArea > Math.PI * 25 * 25 && g.profileArea < Math.PI * 40 * 40, 'profile area between base-circle and peak-circle');
    // volume = (profileArea − bore) · thickness, self-consistent with the extruder.
    near(g.volume, (g.profileArea - Math.PI * 5 * 5) * 12, 'volume = (area − bore)·thickness');
    near(ok(camExtrudeVolume(PROGRAM), 'cam extrude vol'), g.volume, 'extruded cam volume matches the geometry');
  }

  // ─── The profile is a closed polar polygon at the base radius ────
  {
    const p = ok(camProfilePoints(PROGRAM), 'cam profile');
    assert(p.length > 30, 'profile has many samples');
    // during the first dwell (θ near 0) the radius is exactly the base radius.
    near(Math.hypot(p[0].x, p[0].y), 25, 'first point sits on the base circle');
    // the farthest point is the peak radius.
    const maxR = Math.max(...p.map((q) => Math.hypot(q.x, q.y)));
    near(maxR, 40, 'farthest profile point = peak radius 40');
    assert(Math.abs(polygonArea(p) - ok(camGeometry(PROGRAM), 'g').profileArea) < 1e-3, 'profile shoelace area = reported area (to 4-dp rounding)');
  }

  // ─── bpy construction (extrude + shaft bore) ─────────────────────
  {
    const s = ok(buildCamBlenderScript(PROGRAM, '/tmp/uc-cam-smoke.stl'), 'cam bpy');
    assert(s.includes('extrude_face_region'), 'built by extruding the cam profile');
    assert(s.includes('BORE_R = 5') && s.includes("mod.operation = 'DIFFERENCE'"), 'shaft bore cut (BORE_R = 5)');
    assert(s.includes('bpy.ops.wm.stl_export(filepath=OUT)') && s.includes('OUT = "/tmp/uc-cam-smoke.stl"'), 'exports STL to the embedded path');
    let round = 0, sq = 0;
    for (const ch of s) { if (ch === '(') round++; else if (ch === ')') round--; else if (ch === '[') sq++; else if (ch === ']') sq--; }
    assert(round === 0 && sq === 0, 'cam bpy balanced');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!camGeometry({ baseRadius: 25, thickness: 12, segments: [{ kind: 'rise', angle: 180, lift: 10 }, { kind: 'dwell', angle: 180 }] }).ok, 'program not returning to start rejected');
    assert(!camGeometry({ baseRadius: 25, thickness: 12, segments: [{ kind: 'rise', angle: 90, lift: 10 }, { kind: 'fall', angle: 90, lift: 10 }] }).ok, 'segments not summing to 360° rejected');
    assert(!camGeometry({ baseRadius: 25, thickness: 12, segments: [{ kind: 'fall', angle: 180, lift: 30 }, { kind: 'rise', angle: 180, lift: 30 }] }).ok, 'fall exceeding the base circle rejected');
    assert(!camGeometry({ baseRadius: 25, thickness: 12, segments: [{ kind: 'rise', angle: 360 } as any] }).ok, 'rise without a lift rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-cam-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-cam-core smoke cases passed.');
}

main();
