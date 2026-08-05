/**
 * engineering-key-core smoke.
 *
 * A parallel key keys a hub to a shaft and is a deliberate WEAK LINK, sized by two
 * independent failure modes exactly like a bolted joint: SHEAR across w·L and
 * BEARING/crushing across (h/2)·L, driven by the surface force F = 2T/d. The
 * required key length is the max of the two and the larger one governs.
 *
 * The clean anchor: for a SQUARE key L_bear/L_shear = 2·(τ/σ_bear), so with the
 * common σ_bear = 2τ the two required lengths are EQUAL — a square key is balanced
 * (equally strong in shear and crushing). Make it rectangular (w > h) at the same
 * allowables and crushing governs by exactly w/h. The standard ISO 773 / DIN 6885
 * section table is pinned at several diameters, sizing↔capacity round-trips, and a
 * textbook Ø40 / 500 N·m / 12×8 steel case is hand-computed. The smoke IS the proof.
 */

import {
  standardKeySize, keySizing, keyTorqueCapacity, keyphaseTorqueCapacity,
  PARALLEL_KEY_TABLE, DEFAULT_SHEAR_FACTOR, DEFAULT_BEARING_FACTOR,
} from '../src/lib/engineeringKeyCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

function main() {
  // ─── Standard section table (ISO 773 / DIN 6885) ─────────────────
  {
    const cases: Array<[number, number, number]> = [
      [6, 2, 2], [8, 2, 2], [9, 3, 3], [10, 3, 3], [11, 4, 4], [12, 4, 4],
      [15, 5, 5], [17, 5, 5], [20, 6, 6], [22, 6, 6], [25, 8, 7], [30, 8, 7],
      [35, 10, 8], [40, 12, 8], [44, 12, 8], [50, 14, 9], [70, 20, 12],
    ];
    for (const [d, w, h] of cases) {
      const s = ok(standardKeySize(d), `standardKeySize(${d})`);
      assert(s.fromTable, `Ø${d} is a table section`);
      assert(s.width_mm === w && s.height_mm === h, `Ø${d} → ${w}×${h} mm (got ${s.width_mm}×${s.height_mm})`);
    }
    // the boundary is "up to and including": Ø8 is 2×2, just above → 3×3.
    assert(ok(standardKeySize(8), 'Ø8').width_mm === 2, 'Ø8 lands in the 6–8 band (2×2)');
    assert(ok(standardKeySize(8.5), 'Ø8.5').width_mm === 3, 'Ø8.5 lands in the 8–10 band (3×3)');

    // width is monotonic non-decreasing with shaft diameter.
    let prev = 0;
    for (const d of [6, 9, 11, 15, 20, 25, 35, 45, 55, 70, 90, 120, 160, 220]) {
      const w = ok(standardKeySize(d), `mono Ø${d}`).width_mm;
      assert(w >= prev, `width non-decreasing at Ø${d}: ${w} ≥ ${prev}`);
      prev = w;
    }
    // rows above Ø22 are rectangular (w > h); the small ones are square (w = h).
    assert(ok(standardKeySize(10), 'sq').width_mm === ok(standardKeySize(10), 'sq').height_mm, 'small keys are square (w = h)');
    assert(ok(standardKeySize(40), 'rect').width_mm > ok(standardKeySize(40), 'rect').height_mm, 'larger keys are rectangular (w > h)');
    // the exported table is sorted by diameter with increasing width.
    for (let i = 1; i < PARALLEL_KEY_TABLE.length; i += 1) {
      assert(PARALLEL_KEY_TABLE[i].maxDiameter > PARALLEL_KEY_TABLE[i - 1].maxDiameter, `table diameter increases at row ${i}`);
      assert(PARALLEL_KEY_TABLE[i].width >= PARALLEL_KEY_TABLE[i - 1].width, `table width non-decreasing at row ${i}`);
    }

    // off-table fallback: w ≈ d/4, flagged.
    const big = ok(standardKeySize(300), 'Ø300 fallback');
    assert(!big.fromTable && big.width_mm === 75, 'Ø300 off-table → fallback w = d/4 = 75 mm');
    const tiny = ok(standardKeySize(3), 'Ø3 fallback');
    assert(!tiny.fromTable && tiny.width_mm === 0.75, 'Ø3 below the table → fallback w = d/4 = 0.75 mm');

    assert(!standardKeySize(0).ok, 'standardKeySize rejects a non-positive diameter');
    assert(DEFAULT_SHEAR_FACTOR === 0.4 && DEFAULT_BEARING_FACTOR === 0.9, 'default allowable factors are 0.4·σy shear, 0.9·σy bearing');
  }

  // ─── Textbook case: Ø40, T = 500 N·m, key 12×8 steel ─────────────
  {
    // F = 2T/d = 2·500000/40 = 25,000 N.
    // τ_allow = 0.4·250 = 100 MPa, σ_bear = 0.9·250 = 225 MPa.
    // L_shear = 25000/(12·100) = 20.8333 mm; L_bear = 25000/(4·225) = 27.7778 mm.
    // → bearing governs, required length 27.7778 mm.
    const k = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel' }), 'textbook Ø40/500/12×8');
    near(k.force_N, 25000, 'F = 2T/d = 25,000 N');
    near(k.torque_Nmm, 500000, 'T = 500 N·m = 500,000 N·mm');
    near(k.allowableShear_MPa, 100, 'τ_allow = 0.4·250 = 100 MPa');
    near(k.allowableBearing_MPa, 225, 'σ_bear_allow = 0.9·250 = 225 MPa');
    near(k.requiredLengthShear_mm, 25000 / (12 * 100), 'L_shear = F/(w·τ) = 20.833 mm');
    near(k.requiredLengthBearing_mm, 25000 / (4 * 225), 'L_bear = F/((h/2)·σ_bear) = 27.778 mm');
    near(k.requiredLength_mm, 25000 / (4 * 225), 'required length = max = 27.778 mm');
    assert(k.governingMode === 'bearing', 'bearing (crushing) governs a rectangular 12×8 key');
    near(k.yield_MPa!, 250, 'steel yield picked up from the material table');
    // at the required length the governing (bearing) SF is 1; shear has margin.
    near(k.safetyFactor, 1, 'governing SF = 1 at the required length');
    near(k.bearingSafetyFactor, 1, 'bearing SF = 1 (the governing mode)');
    near(k.shearSafetyFactor, (25000 / (4 * 225)) / (25000 / (12 * 100)), 'shear SF = L_bear/L_shear = 1.333 (the non-governing margin)');
    near(k.shearStress_MPa, 25000 / (12 * (25000 / (4 * 225))), 'shear stress at the required length = 75 MPa');
    near(k.shearStress_MPa, 75, 'shear stress = 75 MPa (hand value)');

    // the shaft the key protects: a solid Ø40 shaft at the same 100 MPa shear
    // allowable carries τ·(πD⁴/32)/(D/2) ≈ 1257 N·m — far more than the key's 500,
    // so the key is the fuse (composes the shaft-torsion physics τ = T·r/J).
    const D = 40, tauShaft = 100;
    const shaftCapacityNm = (tauShaft * (Math.PI * D ** 4 / 32) / (D / 2)) / 1000;
    near(shaftCapacityNm, 1256.637, 'Ø40 shaft torsional capacity ≈ 1256.6 N·m', 1e-3);
    assert(k.torqueCapacity_Nm < shaftCapacityNm, 'key torque capacity (500) < shaft capacity (1257) → the key fails first (weak link)');
    near(k.torqueCapacity_Nm, 500, 'key sized to the required length carries exactly the 500 N·m design torque');
  }

  // ─── The balanced square key: σ_bear = 2τ → L_shear = L_bear ─────
  {
    // square 10×10, τ = 100, σ_bear = 200 (= 2τ). d = 30, T = 300 N·m.
    // F = 2·300000/30 = 20,000 N. L_shear = 20000/(10·100) = 20; L_bear =
    // 20000/(5·200) = 20 → EQUAL. The two failure modes are balanced.
    const b = ok(keySizing({ shaftDiameter: 30, torque: 300, width: 10, height: 10, allowableShear: 100, allowableBearing: 200 }), 'balanced square');
    near(b.force_N, 20000, 'F = 20,000 N');
    near(b.requiredLengthShear_mm, 20, 'square key: L_shear = 20 mm');
    near(b.requiredLengthBearing_mm, 20, 'square key: L_bear = 20 mm');
    near(b.requiredLengthBearing_mm / b.requiredLengthShear_mm, 1, 'σ_bear = 2τ, square → L_bear/L_shear = 1 (balanced)');
    near(b.requiredLength_mm, 20, 'balanced required length = 20 mm');
    near(b.shearSafetyFactor, b.bearingSafetyFactor, 'balanced key: shear SF = bearing SF at every length');

    // the general clean relationship: square key ⇒ L_bear/L_shear = 2·(τ/σ_bear).
    // τ = 100, σ_bear = 225 → ratio 0.889 (< 1) so SHEAR governs a square key here.
    const s = ok(keySizing({ shaftDiameter: 30, torque: 300, width: 10, height: 10, allowableShear: 100, allowableBearing: 225 }), 'square, σ_bear=2.25τ');
    near(s.requiredLengthBearing_mm / s.requiredLengthShear_mm, 2 * (100 / 225), 'square: L_bear/L_shear = 2·(τ/σ_bear) = 0.889');
    assert(s.governingMode === 'shear', 'square key with σ_bear = 2.25τ → shear governs (ratio < 1)');
  }

  // ─── Rectangular key at σ_bear = 2τ → crushing governs by w/h ────
  {
    // 12×8, τ = 100, σ_bear = 200. For a rectangular key L_bear/L_shear =
    // (w/(h/2))·(τ/σ_bear) = (2w/h)·0.5 = w/h = 12/8 = 1.5 → bearing governs.
    const rct = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, allowableShear: 100, allowableBearing: 200 }), 'rect, σ_bear=2τ');
    near(rct.requiredLengthBearing_mm / rct.requiredLengthShear_mm, 12 / 8, 'rect + σ_bear=2τ: L_bear/L_shear = w/h = 1.5');
    assert(rct.governingMode === 'bearing', 'a real rectangular key (w > h) crushes before it shears');
  }

  // ─── Inverse round-trip: capacity of the required length reproduces T ─
  {
    // bearing-governed design.
    const k = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel' }), 'rt bearing size');
    const c = ok(keyTorqueCapacity({ shaftDiameter: 40, width: 12, height: 8, length: k.requiredLength_mm, material: 'steel' }), 'rt bearing capacity');
    near(c.torqueCapacity_Nm, 500, 'capacity at the required length reproduces the 500 N·m design torque');
    assert(c.governingMode === k.governingMode, 'capacity governing mode matches the sizing governing mode (bearing)');
    near(c.bearingTorqueCapacity_Nm, 500, 'bearing capacity = 500 N·m at the required length');
    assert(c.shearTorqueCapacity_Nm > c.bearingTorqueCapacity_Nm, 'shear capacity exceeds bearing (bearing is the weaker mode)');

    // shear-governed design (square key, σ_bear = 2.25τ) round-trips too.
    const ks = ok(keySizing({ shaftDiameter: 30, torque: 300, width: 10, height: 10, allowableShear: 100, allowableBearing: 225 }), 'rt shear size');
    const cs = ok(keyTorqueCapacity({ shaftDiameter: 30, width: 10, height: 10, length: ks.requiredLength_mm, allowableShear: 100, allowableBearing: 225 }), 'rt shear capacity');
    near(cs.torqueCapacity_Nm, 300, 'shear-governed capacity reproduces the 300 N·m design torque');
    assert(cs.governingMode === 'shear' && ks.governingMode === 'shear', 'shear governs both sizing and capacity');

    // direct capacity check with hand values: 12×8 × 27.7778 on Ø40, τ=100 σ=225.
    const direct = ok(keyTorqueCapacity({ shaftDiameter: 40, width: 12, height: 8, length: 27.77777778, allowableShear: 100, allowableBearing: 225 }), 'direct capacity');
    near(direct.shearForceCapacity_N, 12 * 27.77777778 * 100, 'shear force capacity = w·L·τ = 33,333 N');
    near(direct.bearingForceCapacity_N, 4 * 27.77777778 * 225, 'bearing force capacity = (h/2)·L·σ = 25,000 N');
    near(direct.torqueCapacity_Nm, 500, 'governing torque capacity ≈ 500 N·m');
    // alias exports the same function.
    assert(keyphaseTorqueCapacity === keyTorqueCapacity, 'keyphaseTorqueCapacity is the keyTorqueCapacity alias');
  }

  // ─── Monotonicity: more torque → longer key; bigger section → shorter ─
  {
    const base = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel' }), 'mono base');
    const dbl = ok(keySizing({ shaftDiameter: 40, torque: 1000, width: 12, height: 8, material: 'steel' }), 'mono double T');
    const half = ok(keySizing({ shaftDiameter: 40, torque: 250, width: 12, height: 8, material: 'steel' }), 'mono half T');
    assert(dbl.requiredLength_mm > base.requiredLength_mm && base.requiredLength_mm > half.requiredLength_mm, 'more torque → longer key');
    near(dbl.requiredLength_mm, 2 * base.requiredLength_mm, 'required length is linear in torque (double T → double L)');
    near(half.requiredLength_mm, 0.5 * base.requiredLength_mm, 'half the torque → half the length');

    // same torque, bigger key section → shorter required length.
    const small = ok(keySizing({ shaftDiameter: 50, torque: 800, width: 10, height: 8, material: 'steel' }), 'section small');
    const large = ok(keySizing({ shaftDiameter: 50, torque: 800, width: 16, height: 10, material: 'steel' }), 'section large');
    assert(large.requiredLength_mm < small.requiredLength_mm, 'a wider/taller key needs a shorter length for the same torque');
  }

  // ─── Auto-section from the table + torqueNmm composition path ────
  {
    // no width/height → the table picks 12×8 for Ø40.
    const auto = ok(keySizing({ shaftDiameter: 40, torque: 500, material: 'steel' }), 'auto section');
    assert(auto.width_mm === 12 && auto.height_mm === 8, 'auto section for Ø40 is the table 12×8');
    assert(auto.keySource.includes('DIN 6885'), 'auto section cites the standard table');

    // torqueNmm composes directly with the shaft-torsion lane (N·mm) and matches N·m.
    const viaNm = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel' }), 'via N·m');
    const viaNmm = ok(keySizing({ shaftDiameter: 40, torqueNmm: 500000, width: 12, height: 8, material: 'steel' }), 'via N·mm');
    near(viaNmm.torque_Nm, 500, 'torqueNmm 500,000 → 500 N·m');
    near(viaNmm.requiredLength_mm, viaNm.requiredLength_mm, 'N·mm and N·m torque inputs agree');
  }

  // ─── Given length → safety factor & adequacy ─────────────────────
  {
    // required (bearing) length is 27.778 mm. A 40 mm key has margin; a 20 mm key is short.
    const long = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel', length: 40 }), 'given long');
    assert(long.lengthBasis === 'given', 'a supplied length is reported as given');
    assert(long.adequate && long.safetyFactor > 1, 'L = 40 mm > required → adequate, SF > 1');
    near(long.safetyFactor, 40 / (25000 / (4 * 225)), 'bearing SF at L = 40 = L/L_bear_required = 1.44');

    const short = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel', length: 20 }), 'given short');
    assert(!short.adequate && short.safetyFactor < 1, 'L = 20 mm < required 27.8 → undersized, SF < 1');
    // two-route SF check: bearing SF = allowable/actual = L/L_bear_required.
    near(short.bearingSafetyFactor, short.allowableBearing_MPa / short.bearingStress_MPa, 'bearing SF = σ_bear_allow / σ_actual (two-route)');
    near(short.bearingSafetyFactor, 20 / (25000 / (4 * 225)), 'bearing SF also = L / L_bear_required (geometry route)');
  }

  // ─── Aluminum key: lower yield → longer key for the same torque ──
  {
    const steel = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel' }), 'mat steel');
    const alu = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'aluminum' }), 'mat aluminum');
    // aluminum 6061 yield 276 > steel 250, so it actually needs a SHORTER key — pin the direction by yield.
    assert(alu.allowableBearing_MPa > steel.allowableBearing_MPa, 'aluminum 6061 (σy 276) has a higher allowable than mild steel (σy 250)');
    assert(alu.requiredLength_mm < steel.requiredLength_mm, 'a stronger key material needs a shorter key for the same torque');
    const brass = ok(keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'brass' }), 'mat brass');
    assert(brass.requiredLength_mm > steel.requiredLength_mm, 'weaker brass (σy 124) needs a longer key than steel');
  }

  // ─── Validation: bad / missing inputs fail closed ────────────────
  {
    assert(!keySizing({ shaftDiameter: 0, torque: 500, material: 'steel' }).ok, 'non-positive shaft diameter rejected');
    assert(!keySizing({ shaftDiameter: 40, material: 'steel' } as any).ok, 'no torque rejected');
    assert(!keySizing({ shaftDiameter: 40, torque: 500 }).ok, 'no material/yield/allowable → cannot resolve allowables, rejected');
    assert(!keySizing({ shaftDiameter: 40, torque: 500, material: 'unobtanium' }).ok, 'unknown material rejected');
    assert(keySizing({ shaftDiameter: 40, torque: 500, allowableShear: 100, allowableBearing: 200 }).ok, 'explicit allowables need no material');
    assert(!keyTorqueCapacity({ shaftDiameter: 40, width: 12, height: 8, length: 0, material: 'steel' }).ok, 'capacity rejects a non-positive length');
    assert(!keyTorqueCapacity({ shaftDiameter: 40, width: 12, height: 8, length: 30 }).ok, 'capacity with no allowable source rejected');
    assert(!keySizing({ shaftDiameter: 40, torque: 500, width: 12, height: 8, material: 'steel', shearFactor: 0 }).ok, 'non-positive shearFactor rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-key-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-key-core smoke cases passed.');
}

main();
