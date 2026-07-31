/**
 * engineeringKeyCore — PARALLEL KEY sizing: the small rectangular bar that keys a
 * hub (gear, pulley, sprocket, coupling) to a shaft so torque passes between them.
 * This closes the gap between the shaft-torsion lane (which sizes the SHAFT for a
 * torque T) and the thing that actually couples the shaft to whatever it drives.
 *
 * WHY A KEY IS INTERESTING. A parallel key is a DELIBERATE WEAK LINK — the fuse of
 * a drivetrain. It is cheap, standard, and easy to replace, so a machine is
 * usually designed for the key to fail before the far costlier shaft or gear. It
 * carries the whole torque through a tiny cross-section, and it can fail two
 * independent ways, exactly like a bolted joint:
 *
 *   THE FORCE. All of T is transmitted at the shaft surface, radius d/2, so the
 *   tangential force the key must carry is F = T / (d/2) = 2T/d. (T in N·mm, d in
 *   mm → F in N; a torque given in N·m is ×1000 to N·mm first.)
 *
 *   SHEAR. The key can shear straight across the shaft-hub parting plane, on the
 *   area width × length, w·L. Required length to survive: L_shear = F/(w·τ_allow).
 *
 *   BEARING / CRUSHING. The side of the key can crush against the keyway wall. Only
 *   half the key height bears on the hub (the other half sits in the shaft
 *   keyseat), so the bearing area is (h/2)·L. Required length: L_bear =
 *   F/((h/2)·σ_bear_allow). This is exactly the shear-vs-bearing pair a bolt has.
 *
 * The key must survive BOTH, so the required length is the max of the two and the
 * larger one is the GOVERNING mode. Allowable shear ≈ 0.4·σ_yield (a factored
 * distortion-energy shear limit) and allowable bearing/crushing ≈ 0.9·σ_yield are
 * the defaults; both accept explicit overrides.
 *
 * THE BALANCED-KEY RESULT (the clean anchor the smoke pins). For a SQUARE key the
 * two required lengths are in the ratio
 *     L_bear / L_shear = (w/(h/2))·(τ_allow/σ_bear_allow) = 2·(τ/σ_bear)   [w=h].
 * So if the bearing allowable is exactly twice the shear allowable (σ_bear = 2τ, a
 * common textbook assumption), the ratio is 1: a square key is EQUALLY strong in
 * shear and in crushing — the two failure modes are balanced, the classic result.
 * Make the key rectangular (w > h, as every standard key above Ø22 is) and, at the
 * same σ_bear = 2τ, the ratio becomes w/h > 1 so crushing governs.
 *
 * THE STANDARD SECTION. Key cross-sections are not free: ISO 773 / DIN 6885 tabulate
 * w×h against the shaft diameter (hard-coded below, as the ISO-fit table is hard-
 * coded elsewhere in this suite — the width tracks the classic w ≈ d/4 rule but the
 * exact steps are standardised). Off the table, w ≈ d/4 is the noted fallback.
 *
 * Every number is closed-form and unit-consistent in N / mm / MPa, so the smoke
 * pins each result against a hand-computed value and the smoke IS the proof.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-key-core-smoketest.ts): one
 * optional value import (the material table for yield strength), no I/O.
 */

import { MATERIALS } from './engineeringCalcCore';

export type KeyResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

export type KeyMode = 'shear' | 'bearing';

/** Default factored allowable shear on the key: τ_allow = 0.4·σ_yield. */
export const DEFAULT_SHEAR_FACTOR = 0.4;
/** Default factored allowable bearing/crushing on the key: σ_bear = 0.9·σ_yield. */
export const DEFAULT_BEARING_FACTOR = 0.9;

// ─── Standard parallel-key sections (ISO 773 / DIN 6885, sheet 1) ─────────────
// Shaft diameter is "over the previous row, up to and including maxDiameter (mm)".
// Width tracks the w ≈ d/4 rule of thumb but the exact steps are standardised.

export type KeyTableRow = { maxDiameter: number; width: number; height: number };

export const PARALLEL_KEY_TABLE: ReadonlyArray<KeyTableRow> = [
  { maxDiameter: 8, width: 2, height: 2 },
  { maxDiameter: 10, width: 3, height: 3 },
  { maxDiameter: 12, width: 4, height: 4 },
  { maxDiameter: 17, width: 5, height: 5 },
  { maxDiameter: 22, width: 6, height: 6 },
  { maxDiameter: 30, width: 8, height: 7 },
  { maxDiameter: 38, width: 10, height: 8 },
  { maxDiameter: 44, width: 12, height: 8 },
  { maxDiameter: 50, width: 14, height: 9 },
  { maxDiameter: 58, width: 16, height: 10 },
  { maxDiameter: 65, width: 18, height: 11 },
  { maxDiameter: 75, width: 20, height: 12 },
  { maxDiameter: 85, width: 22, height: 14 },
  { maxDiameter: 95, width: 25, height: 14 },
  { maxDiameter: 110, width: 28, height: 16 },
  { maxDiameter: 130, width: 32, height: 18 },
  { maxDiameter: 150, width: 36, height: 20 },
  { maxDiameter: 170, width: 40, height: 22 },
  { maxDiameter: 200, width: 45, height: 25 },
  { maxDiameter: 230, width: 50, height: 28 },
];

/** Smallest shaft diameter the standard table covers (mm). */
export const PARALLEL_KEY_TABLE_MIN = 6;

export type StandardKeyResult = {
  shaftDiameter_mm: number;
  width_mm: number;
  height_mm: number;
  /** true when read from the ISO/DIN table, false when the w≈d/4 fallback was used. */
  fromTable: boolean;
  source: string;
  /** The covered shaft-diameter band, e.g. "38–44 mm". */
  range: string;
};

/**
 * The standard square/rectangular parallel-key cross-section for a shaft diameter,
 * from the ISO 773 / DIN 6885 table. Outside the tabulated range (below ~6 mm or
 * above 230 mm) it falls back to the w ≈ d/4 (square) rule of thumb with a note.
 */
export function standardKeySize(shaftDiameter: number): KeyResult<StandardKeyResult> {
  const d = pos(shaftDiameter);
  if (d === null) return { ok: false, error: 'standardKeySize needs a positive shaft diameter (mm)' };

  if (d >= PARALLEL_KEY_TABLE_MIN) {
    for (let i = 0; i < PARALLEL_KEY_TABLE.length; i += 1) {
      const row = PARALLEL_KEY_TABLE[i];
      if (d <= row.maxDiameter) {
        const lo = i === 0 ? PARALLEL_KEY_TABLE_MIN : PARALLEL_KEY_TABLE[i - 1].maxDiameter;
        return {
          ok: true,
          value: {
            shaftDiameter_mm: r(d), width_mm: row.width, height_mm: row.height,
            fromTable: true, source: 'ISO 773 / DIN 6885 parallel-key table',
            range: `${lo}–${row.maxDiameter} mm`,
          },
        };
      }
    }
  }

  // fallback: the classic w ≈ d/4 rule of thumb, square section.
  const w = r(d / 4, 2);
  return {
    ok: true,
    value: {
      shaftDiameter_mm: r(d), width_mm: w, height_mm: w, fromTable: false,
      source: 'fallback rule-of-thumb w≈d/4 (outside the standard table — confirm against a current key standard)',
      range: 'outside table',
    },
  };
}

// ─── Allowable-stress resolution ─────────────────────────────────────────────

type AllowableSpec = {
  material?: string;
  yieldStrength?: number;
  allowableShear?: number;
  allowableBearing?: number;
  shearFactor?: number;
  bearingFactor?: number;
};

function resolveAllowables(spec: AllowableSpec): { yieldStrength: number | null; tau: number; sigmaBear: number } | { error: string } {
  const m = spec.material ? MATERIALS[String(spec.material).trim().toLowerCase()] : undefined;
  if (spec.material && !m) return { error: `unknown material "${spec.material}" — known: ${Object.keys(MATERIALS).join(', ')}` };
  let yieldStrength: number | null = spec.yieldStrength !== undefined ? pos(spec.yieldStrength) : null;
  if (yieldStrength === null && m) yieldStrength = m.yield;

  const shearFactor = spec.shearFactor !== undefined ? pos(spec.shearFactor) : DEFAULT_SHEAR_FACTOR;
  if (shearFactor === null) return { error: 'shearFactor must be positive' };
  const bearingFactor = spec.bearingFactor !== undefined ? pos(spec.bearingFactor) : DEFAULT_BEARING_FACTOR;
  if (bearingFactor === null) return { error: 'bearingFactor must be positive' };

  let tau: number | null = spec.allowableShear !== undefined ? pos(spec.allowableShear) : null;
  if (tau === null) {
    if (yieldStrength === null) return { error: 'supply a material, a yieldStrength (MPa), or an explicit allowableShear (MPa)' };
    tau = shearFactor * yieldStrength;
  }
  let sigmaBear: number | null = spec.allowableBearing !== undefined ? pos(spec.allowableBearing) : null;
  if (sigmaBear === null) {
    if (yieldStrength === null) return { error: 'supply a material, a yieldStrength (MPa), or an explicit allowableBearing (MPa)' };
    sigmaBear = bearingFactor * yieldStrength;
  }
  return { yieldStrength, tau, sigmaBear };
}

// ─── Key sizing (the shear + bearing two-route sizing) ───────────────────────

export type KeySizingResult = {
  shaftDiameter_mm: number;
  torque_Nm: number;
  torque_Nmm: number;
  width_mm: number;
  height_mm: number;
  keySource: string;
  /** Tangential force at the shaft surface, F = 2T/d (N). */
  force_N: number;
  yield_MPa: number | null;
  allowableShear_MPa: number;
  allowableBearing_MPa: number;
  requiredLengthShear_mm: number;
  requiredLengthBearing_mm: number;
  requiredLength_mm: number;
  governingMode: KeyMode;
  /** The length the stresses/SF below are reported at: `length` if given, else the required length. */
  length_mm: number;
  lengthBasis: string;
  shearStress_MPa: number;
  bearingStress_MPa: number;
  shearSafetyFactor: number;
  bearingSafetyFactor: number;
  /** Governing (min) safety factor at length_mm. */
  safetyFactor: number;
  adequate: boolean;
  /** Torque the chosen length can carry, governing mode (N·m). */
  torqueCapacity_Nm: number;
  notes: string[];
};

/**
 * Size a parallel key for a transmitted torque. Give the shaft diameter and the
 * torque (`torque` in N·m, or `torqueNmm` in N·mm to compose directly with the
 * shaft-torsion lane). The key section is explicit (`width`,`height`) or read from
 * the standard table for the shaft. Allowable stresses come from a `material`
 * (yield → 0.4·σy shear, 0.9·σy bearing by default) or explicit
 * `allowableShear`/`allowableBearing`/`yieldStrength`/factor overrides. An optional
 * `length` reports the stresses, safety factors, and adequacy at that key length;
 * otherwise the required (governing) length is used.
 */
export function keySizing(spec: {
  shaftDiameter: number;
  torque?: number;      // N·m
  torqueNmm?: number;   // N·mm (compose with shaft torsion)
  width?: number;       // mm (else from the table)
  height?: number;      // mm (else from the table)
  length?: number;      // mm (assumed/available key length for SF)
  material?: string;
  yieldStrength?: number;
  allowableShear?: number;
  allowableBearing?: number;
  shearFactor?: number;
  bearingFactor?: number;
}): KeyResult<KeySizingResult> {
  const d = pos(spec.shaftDiameter);
  if (d === null) return { ok: false, error: 'keySizing needs a positive shaftDiameter (mm)' };

  // torque → N·mm (accept N·m or N·mm)
  let torqueNmm: number | null = spec.torqueNmm !== undefined ? pos(spec.torqueNmm) : null;
  let torqueNm: number;
  if (torqueNmm === null) {
    const t = spec.torque !== undefined ? pos(spec.torque) : null;
    if (t === null) return { ok: false, error: 'keySizing needs a positive torque (N·m) or torqueNmm (N·mm)' };
    torqueNm = t; torqueNmm = t * 1000;
  } else {
    torqueNm = torqueNmm / 1000;
  }

  // key section: explicit or from the standard table
  let w: number | null = spec.width !== undefined ? pos(spec.width) : null;
  let h: number | null = spec.height !== undefined ? pos(spec.height) : null;
  let keySource: string;
  if (w === null || h === null) {
    const std = standardKeySize(d);
    if (!std.ok) return { ok: false, error: std.error };
    w = w === null ? std.value.width_mm : w;
    h = h === null ? std.value.height_mm : h;
    keySource = std.value.fromTable
      ? `standard section ${std.value.width_mm}×${std.value.height_mm} mm (${std.value.source}, ${std.value.range})`
      : `${std.value.width_mm}×${std.value.height_mm} mm — ${std.value.source}`;
  } else {
    keySource = `explicit section ${r(w)}×${r(h)} mm`;
  }

  const alw = resolveAllowables(spec);
  if ('error' in alw) return { ok: false, error: alw.error };
  const { yieldStrength, tau, sigmaBear } = alw;

  const F = (2 * torqueNmm) / d; // N, at the shaft surface

  const requiredLengthShear = F / (w * tau);
  const requiredLengthBearing = F / ((h / 2) * sigmaBear);
  const requiredLength = Math.max(requiredLengthShear, requiredLengthBearing);
  const governingMode: KeyMode = requiredLengthBearing > requiredLengthShear ? 'bearing' : 'shear';

  // report at the given length, else at the required (governing) length
  const givenLength = spec.length !== undefined ? pos(spec.length) : null;
  const length = givenLength !== null ? givenLength : requiredLength;
  const lengthBasis = givenLength !== null ? 'given' : 'required (governing mode, SF≈1)';

  const shearStress = F / (w * length);
  const bearingStress = F / ((h / 2) * length);
  const shearSafetyFactor = tau / shearStress;
  const bearingSafetyFactor = sigmaBear / bearingStress;
  const safetyFactor = Math.min(shearSafetyFactor, bearingSafetyFactor);

  // torque the chosen length can carry (governing mode) — the inverse
  const forceCapacity = Math.min(w * length * tau, (h / 2) * length * sigmaBear);
  const torqueCapacityNm = (forceCapacity * (d / 2)) / 1000;

  const notes: string[] = [
    `Force at the shaft surface: F = 2T/d = ${r(F, 2)} N.`,
    `${governingMode === 'bearing' ? 'BEARING (crushing) governs' : 'SHEAR governs'} — required key length ${r(requiredLength, 3)} mm (shear needs ${r(requiredLengthShear, 3)}, bearing needs ${r(requiredLengthBearing, 3)}).`,
    keySource,
    `Allowables: τ_allow = ${r(tau, 2)} MPa, σ_bear_allow = ${r(sigmaBear, 2)} MPa${yieldStrength !== null ? ` (σ_yield ${r(yieldStrength, 2)} MPa)` : ''}.`,
    'A parallel key is a deliberate weak link: sized to shear/crush before the shaft or hub fails, protecting the costlier parts.',
  ];
  if (givenLength !== null) {
    notes.push(safetyFactor >= 1
      ? `At L = ${r(length, 2)} mm the key is adequate (SF = ${r(safetyFactor, 3)}, ${governingMode} governs).`
      : `At L = ${r(length, 2)} mm the key is UNDERSIZED (SF = ${r(safetyFactor, 3)} < 1, ${governingMode} governs).`);
  }

  return {
    ok: true,
    value: {
      shaftDiameter_mm: r(d), torque_Nm: r(torqueNm, 4), torque_Nmm: r(torqueNmm, 2),
      width_mm: r(w), height_mm: r(h), keySource,
      force_N: r(F, 2),
      yield_MPa: yieldStrength === null ? null : r(yieldStrength, 2),
      allowableShear_MPa: r(tau, 4), allowableBearing_MPa: r(sigmaBear, 4),
      requiredLengthShear_mm: r(requiredLengthShear, 4),
      requiredLengthBearing_mm: r(requiredLengthBearing, 4),
      requiredLength_mm: r(requiredLength, 4),
      governingMode,
      length_mm: r(length, 4), lengthBasis,
      shearStress_MPa: r(shearStress, 4), bearingStress_MPa: r(bearingStress, 4),
      shearSafetyFactor: r(shearSafetyFactor, 4), bearingSafetyFactor: r(bearingSafetyFactor, 4),
      safetyFactor: r(safetyFactor, 4), adequate: safetyFactor >= 1,
      torqueCapacity_Nm: r(torqueCapacityNm, 4),
      notes,
    },
  };
}

// ─── Torque capacity of a given key (the inverse of sizing) ──────────────────

export type KeyTorqueCapacityResult = {
  shaftDiameter_mm: number;
  width_mm: number;
  height_mm: number;
  length_mm: number;
  allowableShear_MPa: number;
  allowableBearing_MPa: number;
  shearForceCapacity_N: number;
  bearingForceCapacity_N: number;
  shearTorqueCapacity_Nm: number;
  bearingTorqueCapacity_Nm: number;
  torqueCapacity_Nm: number;
  torqueCapacity_Nmm: number;
  governingMode: KeyMode;
};

/**
 * The maximum torque a given key (w × h × L on a shaft of diameter d) can transmit,
 * by each failure mode and the governing (smaller) one. The inverse of keySizing:
 * feeding a key's required length back in reproduces the design torque exactly.
 */
export function keyTorqueCapacity(spec: {
  shaftDiameter: number;
  width: number;
  height: number;
  length: number;
  material?: string;
  yieldStrength?: number;
  allowableShear?: number;
  allowableBearing?: number;
  shearFactor?: number;
  bearingFactor?: number;
}): KeyResult<KeyTorqueCapacityResult> {
  const d = pos(spec.shaftDiameter);
  if (d === null) return { ok: false, error: 'keyTorqueCapacity needs a positive shaftDiameter (mm)' };
  const w = pos(spec.width), h = pos(spec.height);
  if (w === null || h === null) return { ok: false, error: 'keyTorqueCapacity needs positive width and height (mm)' };
  const length = pos(spec.length);
  if (length === null) return { ok: false, error: 'keyTorqueCapacity needs a positive length (mm)' };

  const alw = resolveAllowables(spec);
  if ('error' in alw) return { ok: false, error: alw.error };
  const { tau, sigmaBear } = alw;

  const shearForce = w * length * tau;
  const bearingForce = (h / 2) * length * sigmaBear;
  const shearTorqueNmm = shearForce * (d / 2);
  const bearingTorqueNmm = bearingForce * (d / 2);
  const governingMode: KeyMode = bearingTorqueNmm < shearTorqueNmm ? 'bearing' : 'shear';
  const torqueNmm = Math.min(shearTorqueNmm, bearingTorqueNmm);

  return {
    ok: true,
    value: {
      shaftDiameter_mm: r(d), width_mm: r(w), height_mm: r(h), length_mm: r(length),
      allowableShear_MPa: r(tau, 4), allowableBearing_MPa: r(sigmaBear, 4),
      shearForceCapacity_N: r(shearForce, 2), bearingForceCapacity_N: r(bearingForce, 2),
      shearTorqueCapacity_Nm: r(shearTorqueNmm / 1000, 4),
      bearingTorqueCapacity_Nm: r(bearingTorqueNmm / 1000, 4),
      torqueCapacity_Nm: r(torqueNmm / 1000, 4),
      torqueCapacity_Nmm: r(torqueNmm, 2),
      governingMode,
    },
  };
}

/** Alias for the requested name; identical to {@link keyTorqueCapacity}. */
export const keyphaseTorqueCapacity = keyTorqueCapacity;
