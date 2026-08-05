/**
 * engineeringForcedVibrationCore — FORCED steady-state vibration + vibration
 * ISOLATION, the dynamics arm that sits directly on top of engineeringVibrationCore.
 * The sibling answers "how does an SDOF oscillate on its own" (natural frequency
 * ωn = √(k/m), damping ratio ζ = c/2√(km)); this core answers the two questions a
 * machine designer actually asks next: when I DRIVE it with a harmonic force, how
 * big does it shake — and how much of that force reaches the floor?
 *
 * FORCED RESPONSE. A damped SDOF pushed by F0·sin(ωt) settles into a steady-state
 * oscillation at the DRIVING frequency ω, not its own ωn. Scale everything by the
 * frequency ratio r = ω/ωn. The dynamic amplitude divided by the static deflection
 * (F0/k) is the MAGNIFICATION factor
 *     M = 1 / √((1−r²)² + (2ζr)²),
 * so the actual amplitude is X = (F0/k)·M, and the response lags the force by
 *     φ = atan2(2ζr, 1−r²).
 * Three regimes fall straight out of M: at LOW frequency (r→0) M→1 — the mass just
 * follows the force quasi-statically; at RESONANCE (r=1) M = 1/(2ζ) exactly — the
 * (1−r²) term vanishes and only damping limits the amplitude, so light damping
 * means a violent peak; at HIGH frequency (r→∞) M→0 — the mass has too much inertia
 * to keep up. The true peak of M is at r = √(1−2ζ²) (slightly BELOW resonance, and
 * only real for ζ < 1/√2), height 1/(2ζ√(1−ζ²)). For ROTATING UNBALANCE the force
 * itself grows with speed (F0 = m_u·e·ω²), so the displacement magnification takes
 * the companion form M_r = r²·M = r²/√((1−r²)²+(2ζr)²): it starts at 0, peaks near
 * r = 1/√(1−2ζ²) (ABOVE resonance), and tends to 1 at high speed rather than 0.
 *
 * TRANSMISSIBILITY & ISOLATION. Force/motion transmissibility is
 *     TR = √(1 + (2ζr)²) / √((1−r²)² + (2ζr)²).
 * The whole theory of vibration isolation is one exact, damping-independent fact:
 * TR = 1 at r = √2 for EVERY ζ (the (2ζr)² = 2·(2ζ²) terms cancel top and bottom).
 * Below r = √2 the mount AMPLIFIES (TR > 1); only ABOVE r = √2 does it ISOLATE
 * (TR < 1), so an isolator has to be soft enough that the disturbing frequency sits
 * well past √2·ωn. The counter-intuitive design tension lives here: damping TAMES
 * the resonance peak you pass through on start-up, but in the isolation region it
 * makes TR WORSE (more damping → higher TR at fixed r). Given a required TR (or
 * isolation %), this core solves the needed r — and, with the disturbing frequency,
 * the needed static deflection δ = g/ωn² (a softer, lower-frequency mount).
 *
 * COMPOSES the sibling: give it k, m, c (or ζ) and a forcing ω, and ωn and ζ are
 * resolved through naturalFrequency / dampedVibration, so the same spring rate,
 * mass, and damping the vibration core used flow straight in. Or hand it r and ζ
 * directly for a dimensionless study. SI internally (k N/m, m kg, ω rad/s),
 * amplitudes/deflections reported in mm at the boundary — the same
 * convert-at-the-edges discipline as the sibling.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-forced-vibration-core-smoketest.ts):
 * the smoke IS the proof — the √2 crossover is pinned for many ζ, the resonance
 * value 1/(2ζ) and the r→0/∞ limits are asserted, the damping-hurts-isolation
 * ordering is verified, and the isolation design round-trip recovers its target.
 */

import { naturalFrequency, dampedVibration } from './engineeringVibrationCore';

export type ForcedVibrationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Positive (strictly > 0) finite check. */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Non-negative finite check — a frequency ratio or a damping ratio may be exactly 0. */
function nonneg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
/** First finite value among candidates, else null. */
function firstFinite(...vals: unknown[]): number | null {
  for (const v of vals) { if (v === undefined || v === null) continue; const n = Number(v); if (Number.isFinite(n)) return n; }
  return null;
}
function r(n: number, dp = 5): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

const G = 9.80665; // m/s²
const RAD_TO_DEG = 180 / Math.PI;
const SQRT2 = Math.SQRT2;

// ─── Shared spec resolution (composes engineeringVibrationCore) ──────────────

/** Resolve ζ from a direct dampingRatio, from a damping coefficient via the
 * vibration core (needs k+m), or default to undamped ζ=0 with a note. */
function resolveZeta(spec: any): { zeta: number; note: string | null } | { error: string } {
  if (spec?.dampingRatio !== undefined) {
    const z = nonneg(spec.dampingRatio);
    if (z === null) return { error: 'dampingRatio (ζ) must be a finite value ≥ 0' };
    return { zeta: z, note: null };
  }
  if (spec?.damping !== undefined || spec?.dampingCoefficient !== undefined) {
    const dv = dampedVibration(spec); // composes the sibling: ζ = c/(2√(km))
    if (!dv.ok) return { error: `to convert a damping coefficient to ζ, also give stiffness/springRate and mass: ${dv.error}` };
    return { zeta: dv.value.dampingRatio, note: 'ζ = c/(2√(km)) via vibration core' };
  }
  return { zeta: 0, note: 'assumed undamped (ζ = 0)' };
}

/** Forcing angular frequency ω (rad/s) from `omega` (rad/s) or `forcingFrequency_Hz`. */
function resolveForcingOmega(spec: any): number | null {
  const rad = firstFinite(spec?.omega, spec?.forcingFrequency_rad_s, spec?.forcingOmega);
  if (rad !== null && rad > 0) return rad;
  const hz = firstFinite(spec?.forcingFrequency_Hz, spec?.forcingHz);
  if (hz !== null && hz > 0) return hz * 2 * Math.PI;
  return null;
}

/** Natural ωn (rad/s) and the resolved stiffness (N/m) via the vibration core, or nulls. */
function resolveNatural(spec: any): { omega_n: number | null; stiffness_N_per_m: number | null; mass_kg: number | null } {
  const nf = naturalFrequency(spec);
  if (nf.ok) return { omega_n: nf.value.omega_n_rad_s, stiffness_N_per_m: nf.value.stiffness_N_per_m, mass_kg: nf.value.mass_kg };
  return { omega_n: null, stiffness_N_per_m: null, mass_kg: null };
}

/** Resolve the frequency ratio r from a direct ratio, or ω/ωn. */
function resolveRatio(spec: any, omega_n: number | null): { ratio: number | null; omega: number | null } {
  const direct = firstFinite(spec?.ratio, spec?.frequencyRatio, spec?.r);
  if (direct !== null) return { ratio: direct >= 0 ? direct : null, omega: null };
  const omega = resolveForcingOmega(spec);
  if (omega !== null && omega_n !== null && omega_n > 0) return { ratio: omega / omega_n, omega };
  return { ratio: null, omega };
}

// ─── Forced steady-state response ────────────────────────────────────────────

export type ForcedResponseResult = {
  ratio: number;                    // r = ω/ωn
  dampingRatio: number;             // ζ
  magnification: number;            // M (displacement) or M_r (unbalance)
  magnificationType: 'displacement' | 'unbalance';
  phaseLagDeg: number;              // φ = atan2(2ζr, 1−r²)
  phaseLagRad: number;
  amplitude_mm: number | null;      // X = (F0/k)·M, or (m_u·e/m)·M_r for unbalance
  staticDeflection_mm: number | null; // δ_st = F0/k
  omega_n_rad_s: number | null;
  omega_rad_s: number | null;
  isResonant: boolean;              // within 5% of r = 1
  resonantMagnification: number;    // M at r=1 = 1/(2ζ)
  peakRatio: number | null;         // r at which M peaks (real only for ζ<1/√2)
  peakMagnification: number | null; // peak height 1/(2ζ√(1−ζ²))
  regime: 'below_resonance' | 'resonance' | 'above_resonance';
  notes: string[];
};

/**
 * Steady-state response of a damped SDOF under a harmonic force F0·sin(ωt).
 * Give either a frequency ratio `ratio` (r) directly, or a forcing `omega`
 * (rad/s) / `forcingFrequency_Hz` together with enough of {stiffness|springRate,
 * mass} or `staticDeflection` for the vibration core to supply ωn. Damping comes
 * from `dampingRatio` (ζ) or a `damping` coefficient (needs k+m). With a `force`
 * (F0, N) and a resolvable stiffness the absolute amplitude X (mm) is reported too.
 *
 * `type:'unbalance'` switches the magnification to the rotating-unbalance form
 * M_r = r²·M; the amplitude then uses X = (m_u·e/m)·M_r from `unbalanceMass`
 * (kg), `eccentricity` (mm), and `mass` (kg).
 */
export function forcedResponse(spec: any): ForcedVibrationResult<ForcedResponseResult> {
  const z = resolveZeta(spec);
  if ('error' in z) return { ok: false, error: z.error };
  const zeta = z.zeta;

  const nat = resolveNatural(spec);
  const rr = resolveRatio(spec, nat.omega_n);
  if (rr.ratio === null) {
    return { ok: false, error: 'give a frequency ratio (ratio = ω/ωn), or a forcing omega/forcingFrequency_Hz plus stiffness+mass (or staticDeflection) so ωn is known' };
  }
  const ratio = rr.ratio;

  const isUnbalance = String(spec?.type ?? '').toLowerCase() === 'unbalance';
  const oneMinusR2 = 1 - ratio * ratio;
  const twoZetaR = 2 * zeta * ratio;
  const denom = Math.sqrt(oneMinusR2 * oneMinusR2 + twoZetaR * twoZetaR);
  const M = denom === 0 ? Infinity : 1 / denom;                 // displacement magnification
  const Mr = denom === 0 ? Infinity : (ratio * ratio) / denom;  // rotating-unbalance magnification
  const magnification = isUnbalance ? Mr : M;

  const phaseRad = Math.atan2(twoZetaR, oneMinusR2); // 0→π; exactly π/2 at r=1
  const phaseDeg = phaseRad * RAD_TO_DEG;

  // Resonant (r=1) value is 1/(2ζ) for BOTH forms; the true peak sits slightly off r=1.
  const resonantMag = zeta > 0 ? 1 / (2 * zeta) : Infinity;
  let peakRatio: number | null = null, peakMag: number | null = null;
  if (zeta < 1 / SQRT2) {
    peakRatio = isUnbalance ? 1 / Math.sqrt(1 - 2 * zeta * zeta) : Math.sqrt(1 - 2 * zeta * zeta);
    peakMag = zeta > 0 ? 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)) : Infinity;
  }

  // Amplitude, if we can price the static deflection.
  let amplitude_mm: number | null = null, staticDeflection_mm: number | null = null;
  if (isUnbalance) {
    const mu = pos(spec?.unbalanceMass ?? spec?.unbalance_mass);
    const ecc = pos(spec?.eccentricity ?? spec?.eccentricity_mm);
    const mtot = pos(spec?.mass);
    if (mu !== null && ecc !== null && mtot !== null && Number.isFinite(Mr)) {
      amplitude_mm = (mu * ecc / mtot) * Mr; // kg·mm/kg → mm
    }
  } else {
    const F0 = pos(spec?.force ?? spec?.forceAmplitude ?? spec?.F0);
    const k = nat.stiffness_N_per_m;
    if (F0 !== null && k !== null && k > 0) {
      staticDeflection_mm = (F0 / k) * 1000; // m → mm
      if (Number.isFinite(M)) amplitude_mm = staticDeflection_mm * M;
    }
  }

  const regime = ratio < 1 - 1e-9 ? 'below_resonance' : ratio > 1 + 1e-9 ? 'above_resonance' : 'resonance';
  const notes: string[] = [];
  if (z.note) notes.push(z.note);
  notes.push(`r = ${r(ratio, 4)}, ζ = ${r(zeta, 4)}; M(r=1) = 1/(2ζ) = ${Number.isFinite(resonantMag) ? r(resonantMag, 4) : '∞'}.`);
  if (isUnbalance) notes.push('rotating-unbalance form M_r = r²·M (grows from 0, tends to 1 at high speed).');

  return {
    ok: true,
    value: {
      ratio: r(ratio, 5),
      dampingRatio: r(zeta, 5),
      magnification: r(magnification, 5),
      magnificationType: isUnbalance ? 'unbalance' : 'displacement',
      phaseLagDeg: r(phaseDeg, 4),
      phaseLagRad: r(phaseRad, 5),
      amplitude_mm: amplitude_mm === null ? null : r(amplitude_mm, 4),
      staticDeflection_mm: staticDeflection_mm === null ? null : r(staticDeflection_mm, 4),
      omega_n_rad_s: nat.omega_n === null ? null : r(nat.omega_n, 4),
      omega_rad_s: rr.omega === null ? null : r(rr.omega, 4),
      isResonant: Math.abs(ratio - 1) < 0.05,
      resonantMagnification: Number.isFinite(resonantMag) ? r(resonantMag, 5) : resonantMag,
      peakRatio: peakRatio === null ? null : r(peakRatio, 5),
      peakMagnification: peakMag === null ? null : (Number.isFinite(peakMag) ? r(peakMag, 5) : peakMag),
      regime,
      notes,
    },
  };
}

// ─── Transmissibility & vibration isolation ──────────────────────────────────

export type TransmissibilityResult = {
  ratio: number;                       // r (evaluated, or solved for a target)
  dampingRatio: number;                // ζ
  transmissibility: number;            // TR
  isolating: boolean;                  // r > √2
  isolationEfficiency: number | null;  // 1 − TR when TR < 1, else null
  regime: 'amplification' | 'crossover' | 'isolation';
  mode: 'evaluate' | 'solve';
  targetTR: number | null;             // solve mode: the TR asked for
  omega_n_required_rad_s: number | null;  // solve mode + forcing freq: needed ωn
  requiredStaticDeflection_mm: number | null; // solve mode + forcing freq: needed δ = g/ωn²
  forcingFrequency_Hz: number | null;
  notes: string[];
};

/** TR = √(1+(2ζr)²) / √((1−r²)²+(2ζr)²). */
function transmissibilityAt(ratio: number, zeta: number): number {
  const twoZetaR = 2 * zeta * ratio;
  const num = Math.sqrt(1 + twoZetaR * twoZetaR);
  const den = Math.sqrt((1 - ratio * ratio) ** 2 + twoZetaR * twoZetaR);
  return den === 0 ? Infinity : num / den;
}

/**
 * Solve the frequency ratio r that yields a target transmissibility TR (< 1, i.e.
 * an isolation target) at damping ζ. Squaring TR gives a quadratic in u = r²:
 *   T·u² + [−2T + 4ζ²(T−1)]·u + (T−1) = 0,  T = TR².
 * With T < 1 the constant term is negative, so exactly one root is positive; that
 * root is the physical r² (in the isolation region r > √2). Returns null if no
 * positive real root exists.
 */
function solveRatioForTR(targetTR: number, zeta: number): number | null {
  const T = targetTR * targetTR;
  const A = T;
  if (A === 0) return null;
  const B = -2 * T + 4 * zeta * zeta * (T - 1);
  const C = T - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const u = (-B + Math.sqrt(disc)) / (2 * A); // the positive root (product C/A < 0 for T<1)
  if (!(u > 0)) return null;
  return Math.sqrt(u);
}

/**
 * Force/motion transmissibility and vibration isolation. Two modes:
 *
 *  • EVALUATE — give a frequency ratio `ratio` (or a forcing `omega` /
 *    `forcingFrequency_Hz` plus stiffness+mass so ωn is known) and (optionally)
 *    damping, and it reports TR, whether the mount is isolating (r > √2), and the
 *    isolation efficiency 1 − TR.
 *
 *  • SOLVE — give a `targetTR` (or `isolationPercent` / `isolation` fraction) and
 *    damping, and it solves the frequency ratio r you must design to. With a
 *    forcing frequency it also returns the required ωn and static deflection
 *    δ = g/ωn² — a softer, lower-frequency mount isolates more.
 *
 * The exact crossover TR = 1 at r = √2 holds for ANY ζ; below it the mount
 * amplifies, above it it isolates, and in that isolation region MORE damping means
 * a HIGHER (worse) TR.
 */
export function transmissibility(spec: any): ForcedVibrationResult<TransmissibilityResult> {
  const z = resolveZeta(spec);
  if ('error' in z) return { ok: false, error: z.error };
  const zeta = z.zeta;
  const notes: string[] = [];
  if (z.note) notes.push(z.note);

  // Detect solve mode: an explicit TR/isolation target and no direct ratio.
  const targetTRraw = firstFinite(spec?.targetTR, spec?.requiredTR, spec?.TR_target);
  let target: number | null = targetTRraw;
  if (target === null && spec?.isolationPercent !== undefined) {
    const p = firstFinite(spec.isolationPercent);
    if (p !== null) target = 1 - p / 100;
  }
  if (target === null && spec?.isolation !== undefined) {
    const f = firstFinite(spec.isolation);
    if (f !== null) target = 1 - f;
  }

  let ratio: number;
  let mode: 'evaluate' | 'solve';
  let omega_n_required: number | null = null;
  let requiredStaticDeflection_mm: number | null = null;
  let forcingHz: number | null = null;

  if (target !== null && firstFinite(spec?.ratio, spec?.frequencyRatio, spec?.r) === null) {
    // SOLVE
    mode = 'solve';
    if (!(target > 0 && target < 1)) {
      return { ok: false, error: 'target transmissibility must be between 0 and 1 (an isolation target, TR < 1 → r > √2)' };
    }
    const solved = solveRatioForTR(target, zeta);
    if (solved === null) return { ok: false, error: 'no real frequency ratio achieves that transmissibility at this damping' };
    ratio = solved;
    const omega = resolveForcingOmega(spec);
    if (omega !== null) {
      forcingHz = omega / (2 * Math.PI);
      omega_n_required = omega / ratio;                 // ωn = ω / r
      requiredStaticDeflection_mm = (G / (omega_n_required * omega_n_required)) * 1000; // δ = g/ωn²
    }
    notes.push(`solved r = ${r(ratio, 4)} for TR = ${r(target, 4)} (${r((1 - target) * 100, 2)}% isolation).`);
  } else {
    // EVALUATE
    mode = 'evaluate';
    const nat = resolveNatural(spec);
    const rr = resolveRatio(spec, nat.omega_n);
    if (rr.ratio === null) {
      return { ok: false, error: 'give a frequency ratio (ratio), a forcing omega/forcingFrequency_Hz plus stiffness+mass, or a targetTR/isolationPercent to solve for r' };
    }
    ratio = rr.ratio;
  }

  const TR = transmissibilityAt(ratio, zeta);
  const isolating = ratio > SQRT2 + 1e-12;
  const regime: 'amplification' | 'crossover' | 'isolation' =
    Math.abs(ratio - SQRT2) <= 1e-9 ? 'crossover' : ratio > SQRT2 ? 'isolation' : 'amplification';
  const isolationEfficiency = TR < 1 ? 1 - TR : null;
  notes.push(`TR = ${Number.isFinite(TR) ? r(TR, 4) : '∞'}; crossover TR = 1 at r = √2 for any ζ. Below √2 amplifies, above √2 isolates.`);

  return {
    ok: true,
    value: {
      ratio: r(ratio, 5),
      dampingRatio: r(zeta, 5),
      transmissibility: Number.isFinite(TR) ? r(TR, 5) : TR,
      isolating,
      isolationEfficiency: isolationEfficiency === null ? null : r(isolationEfficiency, 5),
      regime,
      mode,
      targetTR: target === null ? null : r(target, 5),
      omega_n_required_rad_s: omega_n_required === null ? null : r(omega_n_required, 4),
      requiredStaticDeflection_mm: requiredStaticDeflection_mm === null ? null : r(requiredStaticDeflection_mm, 4),
      forcingFrequency_Hz: forcingHz === null ? null : r(forcingHz, 4),
      notes,
    },
  };
}
