/**
 * engineering-chain-drive-core smoke — the smoke IS the proof (no app, no CAD).
 *
 * A roller chain is the positive-engagement member of the transmission family
 * (gear / belt / chain), so this pins the four facts that make it exact where a
 * belt is not:
 *   1. PITCH DIAMETER is polygon geometry — PD = p/sin(180°/N) — proven by the
 *      definitional identity PD·sin(180°/N) = p at every N, the 4-tooth square
 *      (PD = p·√2), and the polygon→circle limit.
 *   2. The RATIO is EXACT = N2/N1 (integer-exact where a belt would slip).
 *   3. The chain LENGTH rounds UP to an EVEN number of pitches, and the centre
 *      distance is solved back for that even chain (round-trip verified).
 *   4. CHORDAL (polygon) action = 1 − cos(180°/N) falls monotonically with tooth
 *      count (11T > 17T > 25T; 17T ≈ 1.7%), the reason ~17 teeth is a floor.
 * Formulas: Shigley §17-5 (chain length / centre distance); pins are hand-computed.
 */

import { chainDrive, sprocketPitchDiameter, chordalSpeedVariation } from '../src/lib/engineeringChainDriveCore';

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
  // ─── 1. Pitch diameter: the sprocket is a POLYGON, PD = p/sin(180°/N) ─────
  {
    // ANSI #40 chain (p = 12.7 mm = 1/2"), 17-tooth sprocket.
    const cd = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: 600 }), 'PD anchor');
    near(cd.pitchDiameterDriver, 12.7 / Math.sin(Math.PI / 17), 'PD1 = p/sin(180/17) (formula)');
    near(cd.pitchDiameterDriver, 69.115, 'PD1(17T,#40) ≈ 69.115 mm (hand)');
    near(cd.pitchDiameterDriven, 12.7 / Math.sin(Math.PI / 51), 'PD2 = p/sin(180/51) (formula)');
    assert(cd.pitchDiameterDriven > cd.pitchDiameterDriver, 'the larger sprocket has the larger pitch diameter');

    // Definitional polygon identity: PD·sin(180°/N) = p for EVERY N (exact, no π).
    for (const N of [4, 6, 9, 17, 25, 60, 200]) {
      near(sprocketPitchDiameter(12.7, N) * Math.sin(Math.PI / N), 12.7, `PD(${N})·sin(180/${N}) = p (polygon identity)`);
    }
    // A 4-tooth sprocket is a square: the pin centres form a square of side p, so
    // the pitch (circumscribed) diameter is the diagonal p·√2.
    near(sprocketPitchDiameter(12.7, 4), 12.7 * Math.SQRT2, '4-tooth sprocket PD = p·√2 (square diagonal)');
    // Polygon → circle limit: as N grows, π·PD → N·p (circumference ≈ perimeter).
    near((Math.PI * sprocketPitchDiameter(12.7, 1000)) / (1000 * 12.7), 1, 'N→∞: π·PD → N·p (polygon becomes a circle)', 1e-4);
    // ...but for a real (small-N) sprocket the polygon perimeter is clearly under the circle.
    assert((6 * 12.7) / (Math.PI * sprocketPitchDiameter(12.7, 6)) < 0.97, 'a 6-tooth polygon perimeter is < 96% of its circle');
  }

  // ─── 2. The ratio is EXACT (positive engagement — no slip, unlike a belt) ──
  {
    const cd = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: 600 }), 'ratio');
    assert(cd.ratio === 3, 'ratio = N2/N1 = 51/17 = 3 EXACTLY (integer-exact, a belt would creep)');
    assert(Number.isInteger(cd.ratio), 'a chain gives an integer-exact ratio here');
    const two = ok(chainDrive({ pitch: 15.875, driverTeeth: 21, drivenTeeth: 42, centreDistance: 700 }), 'ratio2');
    assert(two.ratio === 2, 'ratio = 42/21 = 2 EXACTLY');
    const step = ok(chainDrive({ pitch: 12.7, driverTeeth: 20, drivenTeeth: 35, centreDistance: 600 }), 'ratio3');
    near(step.ratio, 35 / 20, 'a non-integer ratio is still exact = 1.75');
  }

  // ─── 3. Chain length rounds UP to an EVEN number of pitches ───────────────
  {
    // p=12.7, N1=17, N2=51, C=600 → C_p=47.2441, A=34, K=(34/2π)²=29.2819.
    // L = 2·47.2441 + 34 + 29.2819/47.2441 = 129.108 → round up to even = 130.
    const cd = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: 600 }), 'length A');
    near(cd.centreDistance_pitches, 600 / 12.7, 'C_p = C/p = 47.244 pitches');
    near(cd.chainLength_pitches_exact, 129.108, 'exact chain length = 129.108 pitches (hand)');
    assert(cd.chainLength_pitches === 130, 'rounds UP to 130 pitches');
    assert(cd.chainLength_pitches % 2 === 0, 'rounded length is EVEN (no weak offset link)');
    assert(cd.chainLength_pitches >= cd.chainLength_pitches_exact, 'rounded length is ≥ the exact length');
    // The even chain rides at a slightly LARGER centre distance than requested.
    near(cd.adjustedCentreDistance, 605.70, 'adjusted centre distance ≈ 605.70 mm (solved back from 130 pitches)', 5e-4);
    assert(cd.adjustedCentreDistance > cd.centreDistance, 'rounding the chain UP grows the centre distance');
    // Round-trip self-check: feed the adjusted centre back in → exact length = 130.
    const back = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: cd.adjustedCentreDistance }), 'round-trip');
    near(back.chainLength_pitches_exact, 130, 'adjusted centre reproduces exactly 130 pitches (round-trip)', 1e-4);

    // A second case whose ceiling is ODD, exercising the +1 → even branch.
    // p=15.875, N1=19, N2=38, C=700 → C_p=44.0945, A=28.5, K=(19/2π)²=9.1442.
    // L = 88.189 + 28.5 + 0.2074 = 116.896 → ceil 117 (odd) → 118.
    const cd2 = ok(chainDrive({ pitch: 15.875, driverTeeth: 19, drivenTeeth: 38, centreDistance: 700 }), 'length B');
    near(cd2.chainLength_pitches_exact, 116.896, 'second exact length = 116.896 pitches (hand)');
    assert(cd2.chainLength_pitches === 118, 'ceil is 117 (odd) so it rounds UP to 118');
    assert(cd2.chainLength_pitches % 2 === 0, 'the odd-ceiling case still lands on an EVEN count');
    assert(cd2.chainLength_pitches >= cd2.chainLength_pitches_exact, 'still ≥ the exact length');
    assert(cd2.adjustedCentreDistance > cd2.centreDistance, 'adjusted centre distance grew');

    // An exact-even geometric length must NOT be bumped to the next even number.
    const back2 = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: back.adjustedCentreDistance }), 'exact-even');
    assert(back2.chainLength_pitches === 130, 'a length already ≈ 130 stays 130 (fp guard, not bumped to 132)');
  }

  // ─── 4. Chordal (polygon) action = 1 − cos(180°/N), falls as N rises ──────
  {
    const v11 = chordalSpeedVariation(11);
    const v17 = chordalSpeedVariation(17);
    const v25 = chordalSpeedVariation(25);
    near(v11, 1 - Math.cos(Math.PI / 11), 'chordal(11) = 1 − cos(180/11)');
    near(v11, 0.040507, '11-tooth chordal variation ≈ 4.05% (hand)');
    near(v17, 0.017026, '17-tooth chordal variation ≈ 1.70% (hand) — the ~17T recommendation floor');
    near(v25, 0.007886, '25-tooth chordal variation ≈ 0.79% (hand)');
    assert(v11 > v17 && v17 > v25, 'chordal variation FALLS with tooth count: 11T > 17T > 25T');
    // Monotone decreasing across a whole ladder of sprockets.
    const ladder = [6, 9, 13, 17, 21, 25, 40, 60];
    for (let i = 1; i < ladder.length; i++) {
      assert(chordalSpeedVariation(ladder[i]) < chordalSpeedVariation(ladder[i - 1]), `chordal(${ladder[i]}) < chordal(${ladder[i - 1]})`);
    }
    // A tiny sprocket runs brutally rough — a 4-tooth is barely more than a square.
    near(chordalSpeedVariation(4), 1 - Math.cos(Math.PI / 4), '4-tooth chordal = 1 − cos(45°)');
    near(chordalSpeedVariation(4), 0.292893, '4-tooth chordal variation ≈ 29.3% (very rough)');
    assert(chordalSpeedVariation(4) > 0.25, 'a 4-tooth sprocket has huge (> 25%) speed ripple');
    // The result exposes it as a PERCENT for both sprockets; the driver (fewer teeth) is worse.
    const cd = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: 600 }), 'chordal result');
    near(cd.chordalSpeedVariationDriver_pct / 100, chordalSpeedVariation(17), 'result driver chordal % = 100·(1−cos(180/N1))');
    near(cd.chordalSpeedVariationDriven_pct / 100, chordalSpeedVariation(51), 'result driven chordal % = 100·(1−cos(180/N2))');
    assert(cd.chordalSpeedVariationDriver_pct > cd.chordalSpeedVariationDriven_pct, 'the fewer-tooth driver sprocket has the worse chordal action');
  }

  // ─── 5. Chain speed & power: v = N1·p·n1, P = F·v ─────────────────────────
  {
    // p=12.7, N1=17, N2=51, n1=1500 rpm, P=5 kW.
    const cd = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: 600, driverSpeed_rpm: 1500, power_kW: 5 }), 'speed/power');
    // Chain advances N1 pitches per driver rev → v = N1·p·(n/60) = 17·12.7·25 mm/s = 5.3975 m/s.
    near(cd.chainSpeed_m_s!, 17 * 12.7 * (1500 / 60) / 1000, 'chain speed = N1·p·n1 (formula)');
    near(cd.chainSpeed_m_s!, 5.3975, 'chain speed ≈ 5.3975 m/s (hand)');
    // Driven speed is exact: 1500·17/51 = 500 rpm (ratio 3).
    near(cd.drivenSpeed_rpm!, 500, 'driven speed = n1/ratio = 500 rpm (exact)');
    assert(cd.drivenSpeed_rpm === 500, 'driven speed is exactly 500 rpm');
    // Power ties force and speed: F = P/v, and F·v = P.
    near(cd.tangentialForce_N!, 5000 / cd.chainSpeed_m_s!, 'tangential force = P/V');
    near(cd.tangentialForce_N! * cd.chainSpeed_m_s! / 1000, 5, 'F·V = P invariant (5 kW)');
    // The EXACT mean chain speed uses the polygon perimeter (N·p), which is below
    // the circle approximation π·PD·n — the polygon truth, not the circle.
    const circleApprox = Math.PI * (cd.pitchDiameterDriver / 1000) * (1500 / 60);
    assert(cd.chainSpeed_m_s! < circleApprox, 'polygon-perimeter chain speed < circle (π·PD·n) approximation');
  }

  // ─── 6. Validation — fail closed on bad input ─────────────────────────────
  {
    assert(!chainDrive({ driverTeeth: 17, drivenTeeth: 51, centreDistance: 600 } as any).ok, 'missing pitch rejected');
    assert(!chainDrive({ pitch: 12.7, drivenTeeth: 51, centreDistance: 600 } as any).ok, 'missing driver teeth rejected');
    assert(!chainDrive({ pitch: 12.7, driverTeeth: 17.5, drivenTeeth: 51, centreDistance: 600 }).ok, 'non-integer teeth rejected');
    assert(!chainDrive({ pitch: 12.7, driverTeeth: 2, drivenTeeth: 51, centreDistance: 600 }).ok, 'teeth < 3 rejected (not a polygon)');
    assert(!chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: 100 }).ok, 'centre distance too small (sprockets overlap) rejected');
    assert(!chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51 }).ok, 'missing centre distance rejected');
    // Centre distance may be given in pitches instead of mm.
    const bymm = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance: 600 }), 'mm');
    const bypitch = ok(chainDrive({ pitch: 12.7, driverTeeth: 17, drivenTeeth: 51, centreDistance_pitches: 600 / 12.7 }), 'pitches');
    near(bypitch.centreDistance, bymm.centreDistance, 'centre distance in pitches ≡ the same distance in mm');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-chain-drive-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-chain-drive-core smoke cases passed.');
}

main();
