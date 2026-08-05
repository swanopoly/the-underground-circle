/**
 * engineeringVibrationCore — mechanical VIBRATION, the dynamics arm, and the
 * analysis that composes the most of what the suite already builds: put a mass on
 * the spring whose rate the spring calc gave you, or on the beam whose static
 * deflection the beam calc gave you, and this finds how it oscillates.
 *
 * THE ONE FACT AND ITS TWO FACES. A single-degree-of-freedom system's natural
 * angular frequency is ωn = √(k/m); the natural frequency is fn = ωn/2π. But the
 * SAME quantity also follows from the STATIC deflection δ the weight causes,
 * because at equilibrium k·δ = m·g, so k/m = g/δ and ωn = √(g/δ) — no need to
 * know k and m separately, only how far the thing sags. That second face is the
 * bridge to the beam lane: a beam's mid-span deflection under its load gives its
 * fundamental frequency directly. The smoke pins both faces and that they agree.
 *
 * DAMPING. Real systems lose energy, so the core also takes a damping coefficient
 * c: the damping ratio is ζ = c/(2√(k·m)) = c/c_c where c_c = 2√(k·m) is critical
 * damping, the boundary between oscillating (ζ<1, underdamped) and creeping back
 * (ζ≥1). An underdamped system oscillates at the slightly lower damped frequency
 * ωd = ωn·√(1−ζ²) and decays with logarithmic decrement δ_log = 2πζ/√(1−ζ²).
 *
 * UNITS. SI internally (stiffness N/m, mass kg, frequency Hz), converting a
 * spring rate given in N/mm or a deflection given in mm at the boundary — the
 * same convert-at-the-edges discipline the fluids core uses.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-vibration-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type VibrationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r(n: number, dp = 5): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

const G = 9.80665; // m/s²

/** Resolve a stiffness in N/m from either `stiffness` (N/m) or `springRate` (N/mm). */
function resolveStiffness(spec: any): number | null {
  if (spec?.stiffness !== undefined) return pos(spec.stiffness);
  if (spec?.stiffness_N_per_m !== undefined) return pos(spec.stiffness_N_per_m);
  if (spec?.springRate !== undefined) { const k = pos(spec.springRate); return k === null ? null : k * 1000; } // N/mm → N/m
  if (spec?.springRate_N_per_mm !== undefined) { const k = pos(spec.springRate_N_per_mm); return k === null ? null : k * 1000; }
  return null;
}

export type NaturalFrequencyResult = {
  omega_n_rad_s: number;
  frequency_Hz: number;
  period_s: number;
  stiffness_N_per_m: number | null;
  mass_kg: number | null;
  staticDeflection_mm: number | null;
  method: string;
};

/**
 * Undamped natural frequency, from EITHER stiffness + mass OR the static
 * deflection under gravity (ωn = √(g/δ)). Give whichever you have.
 */
export function naturalFrequency(spec: any): VibrationResult<NaturalFrequencyResult> {
  const mass = spec?.mass !== undefined ? pos(spec.mass) : null;
  const k = resolveStiffness(spec);
  const deflMm = spec?.staticDeflection !== undefined ? pos(spec.staticDeflection)
    : spec?.staticDeflection_mm !== undefined ? pos(spec.staticDeflection_mm) : null;

  let omega: number, method: string, defl: number | null = null;
  if (k !== null && mass !== null) {
    omega = Math.sqrt(k / mass);
    method = 'ωn = √(k/m)';
    defl = (mass * G) / k * 1000; // implied static deflection, mm
  } else if (deflMm !== null) {
    omega = Math.sqrt(G / (deflMm / 1000));
    method = 'ωn = √(g/δ)';
    defl = deflMm;
  } else {
    return { ok: false, error: 'give stiffness (N/m) or springRate (N/mm) + mass (kg), or a staticDeflection (mm)' };
  }
  const fn = omega / (2 * Math.PI);
  return {
    ok: true,
    value: {
      omega_n_rad_s: r(omega, 4), frequency_Hz: r(fn, 4), period_s: r(1 / fn, 6),
      stiffness_N_per_m: k, mass_kg: mass, staticDeflection_mm: defl === null ? null : r(defl, 4),
      method,
    },
  };
}

export type DampedVibrationResult = NaturalFrequencyResult & {
  dampingCoefficient_Ns_per_m: number;
  criticalDamping_Ns_per_m: number;
  dampingRatio: number;
  classification: 'underdamped' | 'critically damped' | 'overdamped';
  dampedFrequency_Hz: number | null;
  omega_d_rad_s: number | null;
  logDecrement: number | null;
};

/** Damped SDOF: damping ratio ζ, damped frequency, and classification. */
export function dampedVibration(spec: any): VibrationResult<DampedVibrationResult> {
  const base = naturalFrequency(spec);
  if (!base.ok) return base;
  const mass = base.value.mass_kg, k = base.value.stiffness_N_per_m;
  if (mass === null || k === null) return { ok: false, error: 'damped analysis needs both stiffness (N/m or springRate N/mm) and mass (kg)' };

  const cc = 2 * Math.sqrt(k * mass);
  let zeta: number | null = spec?.dampingRatio !== undefined ? pos(spec.dampingRatio) : null;
  let c: number | null = spec?.damping !== undefined ? pos(spec.damping)
    : spec?.dampingCoefficient !== undefined ? pos(spec.dampingCoefficient) : null;
  if (zeta === null && c !== null) zeta = c / cc;
  else if (zeta !== null && c === null) c = zeta * cc;
  if (zeta === null || c === null) return { ok: false, error: 'give a damping coefficient (N·s/m) or a dampingRatio' };

  const classification = zeta < 1 - 1e-12 ? 'underdamped' : Math.abs(zeta - 1) <= 1e-12 ? 'critically damped' : 'overdamped';
  const omega_n = base.value.omega_n_rad_s;
  let omega_d: number | null = null, fd: number | null = null, logDec: number | null = null;
  if (zeta < 1) {
    omega_d = omega_n * Math.sqrt(1 - zeta * zeta);
    fd = omega_d / (2 * Math.PI);
    logDec = (2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta);
  }
  return {
    ok: true,
    value: {
      ...base.value,
      dampingCoefficient_Ns_per_m: r(c, 5), criticalDamping_Ns_per_m: r(cc, 5),
      dampingRatio: r(zeta, 5), classification,
      omega_d_rad_s: omega_d === null ? null : r(omega_d, 4),
      dampedFrequency_Hz: fd === null ? null : r(fd, 4),
      logDecrement: logDec === null ? null : r(logDec, 5),
    },
  };
}
