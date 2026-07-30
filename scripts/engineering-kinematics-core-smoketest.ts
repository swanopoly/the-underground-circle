/**
 * engineering-kinematics-core smoke.
 *
 * Grashof classifications are pinned against known linkages; the slider-crank is
 * pinned at its exact positions (TDC = r+l, BDC = l−r, stroke = 2r, mid = √(l²−r²));
 * and the four-bar position solver is verified not by a memorised output angle but
 * by its own LOOP-CLOSURE RESIDUAL — the solved geometry must place the crank tip
 * and rocker tip exactly one coupler-length apart, at many input angles and both
 * assembly circuits.
 */

import { grashof, fourBarPosition, crankSlider } from '../src/lib/engineeringKinematicsCore';

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
  // ─── Grashof classification ──────────────────────────────────────
  {
    // shortest = input, s+l < p+q → crank-rocker.
    const cr = ok(grashof(4, 2, 5, 5), 'crank-rocker');
    assert(cr.grashof && cr.classification.startsWith('crank-rocker'), 'ground4/crank2/coupler5/rocker5 = crank-rocker');
    // shortest = ground → double-crank (drag link).
    const dc = ok(grashof(1, 3, 3.5, 3), 'drag-link');
    assert(dc.grashof && dc.classification.startsWith('double-crank'), 'shortest = ground → double-crank');
    // s+l > p+q → non-Grashof.
    const ng = ok(grashof(3, 3, 3, 4), 'non-Grashof');
    assert(!ng.grashof && ng.classification.startsWith('non-Grashof'), '3/3/3/4 → non-Grashof triple-rocker');
    // s+l = p+q → change point.
    const cp = ok(grashof(2, 3.5, 3.5, 2), 'change point');
    assert(cp.classification.startsWith('change-point'), '2/3.5/3.5/2 → change point');
    assert(!grashof(-1, 2, 3, 4).ok, 'negative link rejected');
  }

  // ─── Slider-crank exact positions ────────────────────────────────
  {
    const r = 50, l = 150;
    near(ok(crankSlider({ crankRadius: r, conrodLength: l, crankAngleDeg: 0 }), 'TDC').pistonPosition, r + l, 'θ=0 → top dead centre r+l = 200');
    near(ok(crankSlider({ crankRadius: r, conrodLength: l, crankAngleDeg: 180 }), 'BDC').pistonPosition, l - r, 'θ=180 → bottom dead centre l−r = 100');
    near(ok(crankSlider({ crankRadius: r, conrodLength: l, crankAngleDeg: 90 }), 'mid').pistonPosition, Math.sqrt(l * l - r * r), 'θ=90 → √(l²−r²) = 141.42');
    const s = ok(crankSlider({ crankRadius: r, conrodLength: l, crankAngleDeg: 45 }), 'stroke');
    near(s.stroke, 2 * r, 'stroke = 2·r = 100');
    // velocity is zero at the dead centres.
    near(ok(crankSlider({ crankRadius: r, conrodLength: l, crankAngleDeg: 0, crankSpeed_rad_s: 100 }), 'v@TDC').pistonVelocity!, 0, 'piston velocity = 0 at TDC', 1e-6);
    assert(ok(crankSlider({ crankRadius: r, conrodLength: l, crankAngleDeg: 90, crankSpeed_rad_s: 100 }), 'v@90').pistonVelocity! < 0, 'piston moving toward crank at θ=90 (negative velocity)');
    assert(!crankSlider({ crankRadius: 100, conrodLength: 80, crankAngleDeg: 0 }).ok, 'conrod shorter than crank rejected');
  }

  // ─── Four-bar: the loop-closure residual IS the verification ─────
  {
    for (const th2 of [30, 60, 90, 150, 210, 300]) {
      for (const circuit of ['open', 'crossed'] as const) {
        const fb = fourBarPosition({ ground: 4, input: 2, coupler: 5, output: 5, inputAngleDeg: th2, circuit });
        if (!fb.ok) { failures.push(`four-bar @${th2}° ${circuit}: ${fb.error}`); console.error(`FAIL: four-bar @${th2}° ${circuit}`); continue; }
        assert(Math.abs(fb.value.loopClosureResidual) < 1e-6, `four-bar @${th2}° ${circuit}: loop closes (residual ${fb.value.loopClosureResidual})`);
        assert(fb.value.transmissionAngleDeg >= 0 && fb.value.transmissionAngleDeg <= 90, `four-bar @${th2}° ${circuit}: transmission angle in [0,90]`);
      }
    }
    // open and crossed circuits are genuinely different assemblies.
    const open = ok(fourBarPosition({ ground: 4, input: 2, coupler: 5, output: 5, inputAngleDeg: 60, circuit: 'open' }), 'open');
    const crossed = ok(fourBarPosition({ ground: 4, input: 2, coupler: 5, output: 5, inputAngleDeg: 60, circuit: 'crossed' }), 'crossed');
    assert(Math.abs(open.outputAngleDeg - crossed.outputAngleDeg) > 1, 'open and crossed give different output angles');
    // a non-assemblable position (a very short coupler at a reaching angle) is refused.
    assert(!fourBarPosition({ ground: 10, input: 1, coupler: 1, output: 1, inputAngleDeg: 90 }).ok, 'un-assemblable linkage refused (toggle)');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-kinematics-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-kinematics-core smoke cases passed.');
}

main();
