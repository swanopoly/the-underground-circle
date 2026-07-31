/**
 * engineeringVibrationAbsorberCore — the UNDAMPED DYNAMIC (tuned) VIBRATION
 * ABSORBER: the classic 2-DOF result that sits one storey above the SDOF
 * vibration and forced-vibration cores. Those answer "how does one mass on one
 * spring oscillate, on its own (ωn = √(k/m)) and when driven (magnification
 * 1/√((1−r²)²+(2ζr)²))". This core answers the question a machine that shakes at
 * ONE stubborn frequency actually poses next: bolt a SECOND small mass-spring
 * onto it and the shaking of the main mass can be driven to ZERO.
 *
 * THE SYSTEM. A primary mass m1 on spring k1 is driven by a harmonic force
 * F0·sin(Ωt). Attach an absorber: mass m2 on spring k2, hung off m1. Assume the
 * undamped steady state x1 = X1·sin(Ωt), x2 = X2·sin(Ωt). The two equations of
 * motion collapse to a 2×2 linear system whose determinant is
 *     D = (k1 + k2 − m1·Ω²)(k2 − m2·Ω²) − k2²,
 * and Cramer's rule gives the exact steady-state amplitudes
 *     X1 = F0·(k2 − m2·Ω²) / D,     X2 = F0·k2 / D.
 *
 * THE TUNING — WHY IT EXISTS. Look at the numerator of X1. If the absorber is
 * TUNED so its own natural frequency ωa = √(k2/m2) equals the forcing Ω, then
 * k2 − m2·Ω² = 0 and X1 = 0 EXACTLY: the primary mass stands perfectly still
 * while the absorber alone vibrates. With that term zero, D = −k2², so
 * X2 = −F0/k2 and the absorber's spring force k2·X2 = −F0 — the little spring
 * pushes back on m1 with a force equal and opposite to the disturbance at every
 * instant, so the net force on the primary is nil. The absorber does not damp
 * energy; it stores and returns it in exact anti-phase. This is Den Hartog's
 * (and Frahm's original 1909) undamped dynamic absorber.
 *
 * THE COST — TWO NEW RESONANCES. Adding a degree of freedom adds a resonance.
 * The combined system's own natural frequencies are the roots of D = 0, a
 * quadratic in Ω²:  m1·m2·Ω⁴ − [(k1+k2)m2 + m1·k2]·Ω² + k1·k2 = 0. Its two
 * positive roots ω_low, ω_high STRADDLE the primary's original ωn = √(k1/m1):
 * evaluating the characteristic polynomial at ωn is always −μ·f²·k1·(…) < 0, so
 * ωn sits strictly between them for ANY tuning. The absorber trades one
 * resonance for two, killing the response only at the exact tuned frequency and
 * introducing danger on either side. A larger mass ratio μ = m2/m1 pushes the
 * two new resonances farther apart (when tuned to ωn the split ratio is exactly
 * √μ), widening the safe operating band around the target frequency — the
 * fundamental design trade of absorber size versus bandwidth.
 *
 * DIMENSIONLESS. Everything scales by the static deflection δst = F0/k1. In
 * terms of the tuning ratio f = ωa/ωn, the forcing ratio g = Ω/ωn, and the mass
 * ratio μ, Den Hartog's amplitude is
 *     X1/δst = (f² − g²) / [(1 − g²)(f² − g²) − μ·f²·g²],
 *     X2/δst = f²      / [(1 − g²)(f² − g²) − μ·f²·g²],
 * which is F0-free and makes the effect a pure ratio. This core computes the
 * dimensional determinant directly (so X1 = 0 is exact at tuning, no rounding),
 * and reports the dimensionless ratios and frequency split alongside.
 *
 * COMPOSES engineeringVibrationCore: ωn = √(k1/m1) and ωa = √(k2/m2) are both
 * resolved through `naturalFrequency`, the same √(k/m) the SDOF core uses, in
 * every mode. Three input styles are accepted — explicit (m1,k1,m2,k2,F0,Ω);
 * DESIGN (give the primary, the disturbance Ω, and a chosen μ → the absorber is
 * sized k2 = m2·Ω², m2 = μ·m1 to tune ωa = Ω); and a dimensionless study
 * (ωn + μ + tuning ratio f + forcing ratio g). SI internally (k N/m, m kg,
 * ω rad/s), amplitudes reported in mm at the boundary — the same
 * convert-at-the-edges discipline as the sibling cores.
 *
 * Pure + tsx-loadable (smoke:
 * scripts/engineering-vibration-absorber-core-smoketest.ts): the smoke IS the
 * proof — X1 = 0 and k2·X2 = −F0 pinned at tuning, the two-resonance split
 * straddling ωn with the √μ spacing, a textbook Den Hartog case hand-computed,
 * and the ωn/ωa composition checked against the vibration core.
 */

import { naturalFrequency } from './engineeringVibrationCore';

export type VibrationAbsorberResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Any finite number (may be negative or zero). */
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Strictly positive finite number. */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** First finite value among candidates, else null. */
function firstFinite(...vals: unknown[]): number | null {
  for (const v of vals) { if (v === undefined || v === null) continue; const n = fin(v); if (n !== null) return n; }
  return null;
}
/** Round to `dp` decimals; pass Infinity/NaN through unchanged. */
function r(n: number, dp = 6): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** Stiffness in N/m from an N/m key, an alias, or an N/mm key (×1000). */
function stiffnessOf(spec: any, key: string, keyMm: string, alt: string): number | null {
  if (spec?.[key] !== undefined) return pos(spec[key]);
  if (spec?.[alt] !== undefined) return pos(spec[alt]);
  if (spec?.[keyMm] !== undefined) { const k = pos(spec[keyMm]); return k === null ? null : k * 1000; }
  return null;
}
/** A positive mass (kg) from a primary key or an alias. */
function massOf(spec: any, key: string, alt: string): number | null {
  if (spec?.[key] !== undefined) return pos(spec[key]);
  if (spec?.[alt] !== undefined) return pos(spec[alt]);
  return null;
}
/** Forcing angular frequency Ω (rad/s) from rad/s or Hz inputs. */
function forcingOmega(spec: any): number | null {
  const rad = firstFinite(spec?.omega, spec?.forcingOmega, spec?.omega_rad_s);
  if (rad !== null && rad > 0) return rad;
  const hz = firstFinite(spec?.forcingFrequency_Hz, spec?.forcingHz);
  if (hz !== null && hz > 0) return hz * 2 * Math.PI;
  return null;
}
/** Primary natural angular frequency ωn (rad/s) from rad/s or Hz inputs. */
function primaryOmega(spec: any): number | null {
  const rad = firstFinite(spec?.omega_n, spec?.omegaN, spec?.omega_n_rad_s, spec?.primaryOmega);
  if (rad !== null && rad > 0) return rad;
  const hz = firstFinite(spec?.primaryFrequency_Hz, spec?.fn_Hz);
  if (hz !== null && hz > 0) return hz * 2 * Math.PI;
  return null;
}
/** Absorber natural angular frequency ωa (rad/s) from rad/s or Hz inputs. */
function absorberOmega(spec: any): number | null {
  const rad = firstFinite(spec?.omega_a, spec?.omegaA, spec?.omega_a_rad_s, spec?.absorberOmega);
  if (rad !== null && rad > 0) return rad;
  const hz = firstFinite(spec?.absorberFrequency_Hz, spec?.fa_Hz);
  if (hz !== null && hz > 0) return hz * 2 * Math.PI;
  return null;
}

export type DynamicAbsorberResult = {
  mode: 'explicit' | 'design' | 'dimensionless';
  // Primary mass–spring
  m1_kg: number | null;
  k1_N_per_m: number | null;
  omega_n_rad_s: number;             // ωn = √(k1/m1), via the vibration core
  frequency_n_Hz: number;
  // Absorber mass–spring (sized in design mode)
  m2_kg: number | null;
  k2_N_per_m: number | null;
  omega_a_rad_s: number;             // ωa = √(k2/m2), via the vibration core
  frequency_a_Hz: number;
  massRatio: number;                 // μ = m2/m1
  // Operating point
  omega_rad_s: number;               // Ω forcing angular frequency
  forcingRatio: number;              // g = Ω/ωn
  tuningRatio: number;               // f = ωa/ωn (Den Hartog's tuning)
  absorberToForcingRatio: number;    // ωa/Ω — exactly 1 when tuned to cancel
  tuned: boolean;                    // ωa = Ω (within tolerance)
  // Steady-state response
  determinant: number | null;        // D (dimensional; null in a dimensionless study)
  X1_over_deltaSt: number;           // X1/δst — 0 at tuning
  X2_over_deltaSt: number;           // X2/δst
  X1_mm: number | null;              // absolute primary amplitude (signed)
  X2_mm: number | null;              // absolute absorber amplitude (signed)
  staticDeflection_mm: number | null; // δst = F0/k1
  force_N: number | null;            // F0
  absorberForce_N: number | null;    // k2·X2 — equals −F0 at tuning
  absorberForceOverF0: number;       // k2·X2 / F0 — equals −1 at tuning
  // The cost: two new resonances straddling ωn
  naturalFrequencies_rad_s: [number, number] | null; // [ω_low, ω_high], roots of D=0
  naturalFrequencyRatios: [number, number] | null;   // [ω_low/ωn, ω_high/ωn]
  resonanceSeparation_rad_s: number | null;          // ω_high − ω_low
  resonanceSeparationRatio: number | null;           // (ω_high − ω_low)/ωn (=√μ when tuned to ωn)
  straddlesPrimary: boolean;                         // ω_low < ωn < ω_high
  notes: string[];
};

/**
 * The undamped dynamic (tuned) vibration absorber — a 2-DOF steady-state
 * solution. A primary mass m1 on spring k1 driven by F0·sin(Ωt) gets a second
 * mass m2 on spring k2; when the absorber is tuned so ωa = √(k2/m2) = Ω the
 * primary amplitude X1 goes to zero and the absorber's spring force cancels the
 * whole applied load. Reports both amplitudes, the dimensionless X/δst, the
 * absorber force, and the TWO new resonances the extra degree of freedom adds.
 *
 * Input styles (all composing √(k/m) through the vibration core):
 *   • EXPLICIT      — { m1, k1, m2, k2, force?, omega | forcingFrequency_Hz }
 *   • DESIGN        — { m1, k1, massRatio, omega|forcingFrequency_Hz, design:true }
 *                     sizes m2 = μ·m1, k2 = m2·Ω² to tune ωa = Ω.
 *   • DIMENSIONLESS — { omega_n | primaryFrequency_Hz, massRatio,
 *                       tuningRatio (f=ωa/ωn), forcingRatio (g=Ω/ωn) }
 */
export function dynamicAbsorber(spec: any): VibrationAbsorberResult<DynamicAbsorberResult> {
  // ─── Primary mass–spring & its natural frequency ─────────────────
  const m1 = massOf(spec, 'm1', 'primaryMass');
  const k1 = stiffnessOf(spec, 'k1', 'k1_N_per_mm', 'primaryStiffness');
  const omega_n0 = (m1 !== null && k1 !== null) ? Math.sqrt(k1 / m1) : primaryOmega(spec);
  if (omega_n0 === null || !(omega_n0 > 0)) {
    return { ok: false, error: 'give the primary as (m1, k1) or a primary natural frequency (omega_n / primaryFrequency_Hz)' };
  }

  // ─── Forcing frequency Ω ─────────────────────────────────────────
  let omega = forcingOmega(spec);
  if (omega === null) { const g = firstFinite(spec?.forcingRatio, spec?.g); if (g !== null && g > 0) omega = g * omega_n0; }
  if (omega === null || !(omega > 0)) {
    return { ok: false, error: 'give a forcing frequency: omega (rad/s), forcingFrequency_Hz, or forcingRatio g = Ω/ωn' };
  }

  // ─── Mass ratio μ and the absorber ───────────────────────────────
  const m2in = massOf(spec, 'm2', 'absorberMass');
  let mu = firstFinite(spec?.massRatio, spec?.mu);
  if ((mu === null || !(mu > 0)) && m2in !== null && m1 !== null) mu = m2in / m1;

  const designMode = spec?.design === true
    || String(spec?.mode ?? '').toLowerCase() === 'design'
    || String(spec?.tune ?? '').toLowerCase() === 'forcing';

  let m2 = m2in;
  let k2v = stiffnessOf(spec, 'k2', 'k2_N_per_mm', 'absorberStiffness');
  let omega_a0: number | null;
  let mode: 'explicit' | 'design' | 'dimensionless';

  if (designMode) {
    if (mu === null || !(mu > 0)) return { ok: false, error: 'design mode needs a positive massRatio μ (= m2/m1) to size the absorber' };
    omega_a0 = omega;                              // tune the absorber to the disturbance: ωa = Ω
    mode = 'design';
    if (m1 !== null) { m2 = mu * m1; k2v = m2 * omega_a0 * omega_a0; } // size m2, k2
  } else if (k2v !== null && m2 !== null) {
    omega_a0 = Math.sqrt(k2v / m2);
    mode = 'explicit';
  } else {
    omega_a0 = absorberOmega(spec);
    if (omega_a0 === null) { const f = firstFinite(spec?.tuningRatio, spec?.f); if (f !== null && f > 0) omega_a0 = f * omega_n0; }
    mode = 'dimensionless';
  }
  if (omega_a0 === null || !(omega_a0 > 0)) {
    return { ok: false, error: 'give the absorber as (m2, k2), an absorber natural frequency (omega_a / absorberFrequency_Hz) or tuning ratio f = ωa/ωn, or use design:true with a massRatio' };
  }
  if (mu === null || !(mu > 0)) {
    if (m2 !== null && m1 !== null) mu = m2 / m1;
    else return { ok: false, error: 'give a mass ratio μ (massRatio / mu) or both masses m1 and m2' };
  }

  // ─── Build the dimensional 2-DOF system (synthesize for a pure ratio study) ─
  const real = m1 !== null && k1 !== null && m2 !== null && k2v !== null;
  const M1 = real ? (m1 as number) : 1;
  const K1 = real ? (k1 as number) : omega_n0 * omega_n0 * M1;   // synth: k1 = ωn²·m1
  const M2 = real ? (m2 as number) : mu * M1;
  const K2 = real ? (k2v as number) : omega_a0 * omega_a0 * M2;  // synth: k2 = ωa²·m2

  // ─── ωn, ωa via the vibration core (COMPOSITION) ─────────────────
  const nfN = naturalFrequency({ stiffness: K1, mass: M1 });
  const nfA = naturalFrequency({ stiffness: K2, mass: M2 });
  const omegaN = nfN.ok ? nfN.value.omega_n_rad_s : omega_n0;
  const omegaA = nfA.ok ? nfA.value.omega_n_rad_s : omega_a0;

  // ─── Steady-state amplitudes from the exact determinant ──────────
  const Wsq = omega * omega;
  const absTerm = K2 - M2 * Wsq;                        // k2 − m2·Ω²  (→ 0 at tuning)
  const D = (K1 + K2 - M1 * Wsq) * absTerm - K2 * K2;   // system determinant
  const X1_over = D === 0 ? Infinity : (K1 * absTerm) / D;   // X1/δst (F0-free)
  const X2_over = D === 0 ? Infinity : (K1 * K2) / D;        // X2/δst
  const absorberForceOverF0 = Number.isFinite(X2_over) ? (K2 / K1) * X2_over : (X2_over > 0 ? Infinity : -Infinity);
  const tuned = Math.abs(absTerm) <= 1e-9 * Math.max(1, Math.abs(K2));

  // ─── Absolute amplitudes when a real force and stiffness are known ─
  const F0 = spec?.force !== undefined ? pos(spec.force) : spec?.F0 !== undefined ? pos(spec.F0) : null;
  let deltaSt_mm: number | null = null, X1_mm: number | null = null, X2_mm: number | null = null, absorberForce_N: number | null = null;
  if (F0 !== null && real) {
    const dSt = F0 / K1;                               // m
    deltaSt_mm = dSt * 1000;
    if (Number.isFinite(X1_over)) X1_mm = dSt * X1_over * 1000;
    if (Number.isFinite(X2_over)) { X2_mm = dSt * X2_over * 1000; absorberForce_N = K2 * (X2_mm / 1000); }
  }

  // ─── The two new natural frequencies (roots of D = 0 in Ω²) ──────
  const a = M1 * M2;
  const b = -((K1 + K2) * M2 + M1 * K2);
  const c = K1 * K2;
  const disc = b * b - 4 * a * c;
  let wLow: number | null = null, wHigh: number | null = null;
  if (disc >= 0 && a > 0) {
    const s = Math.sqrt(disc);
    const l1 = (-b - s) / (2 * a), l2 = (-b + s) / (2 * a);
    const lo = Math.min(l1, l2), hi = Math.max(l1, l2);
    if (lo > 0) wLow = Math.sqrt(lo);
    if (hi > 0) wHigh = Math.sqrt(hi);
  }
  const haveSplit = wLow !== null && wHigh !== null;
  const ratios: [number, number] | null = haveSplit ? [wLow! / omegaN, wHigh! / omegaN] : null;
  const sepRad = haveSplit ? wHigh! - wLow! : null;
  const sepRatio = haveSplit ? (wHigh! - wLow!) / omegaN : null;
  const straddles = haveSplit && wLow! < omegaN && omegaN < wHigh!;

  const f = omegaA / omegaN, g = omega / omegaN, absorberToForcing = omegaA / omega;

  // ─── Notes ───────────────────────────────────────────────────────
  const notes: string[] = [];
  if (mode === 'design') notes.push(`design: sized the absorber m2 = ${r(M2, 5)} kg, k2 = ${r(K2, 4)} N/m to tune ωa = Ω = ${r(omega, 4)} rad/s`);
  else notes.push(`mode = ${mode}; μ = ${r(mu, 4)}, f = ωa/ωn = ${r(f, 4)}, g = Ω/ωn = ${r(g, 4)}`);
  if (tuned) notes.push('tuned (ωa = Ω): primary amplitude X1 → 0; the absorber alone vibrates and its spring force k2·X2 = −F0 exactly cancels the disturbance.');
  else notes.push(`detuned (ωa/Ω = ${r(absorberToForcing, 4)}): X1 is nonzero — the absorber fully cancels only at ωa = Ω.`);
  if (ratios) notes.push(`two new resonances at ${r(ratios[0], 4)}·ωn and ${r(ratios[1], 4)}·ωn straddle the original ωn; a larger μ widens the split (= √μ when tuned to ωn).`);
  if (!Number.isFinite(X1_over)) notes.push('Ω coincides with a combined-system resonance (D = 0): the undamped amplitude is unbounded there.');

  return {
    ok: true,
    value: {
      mode,
      m1_kg: real ? r(M1, 6) : null,
      k1_N_per_m: real ? r(K1, 4) : null,
      omega_n_rad_s: r(omegaN, 4),
      frequency_n_Hz: r(omegaN / (2 * Math.PI), 4),
      m2_kg: real ? r(M2, 6) : null,
      k2_N_per_m: real ? r(K2, 4) : null,
      omega_a_rad_s: r(omegaA, 4),
      frequency_a_Hz: r(omegaA / (2 * Math.PI), 4),
      massRatio: r(mu, 6),
      omega_rad_s: r(omega, 4),
      forcingRatio: r(g, 6),
      tuningRatio: r(f, 6),
      absorberToForcingRatio: r(absorberToForcing, 6),
      tuned,
      determinant: real ? r(D, 4) : null,
      X1_over_deltaSt: r(X1_over, 6),
      X2_over_deltaSt: r(X2_over, 6),
      X1_mm: X1_mm === null ? null : r(X1_mm, 4),
      X2_mm: X2_mm === null ? null : r(X2_mm, 4),
      staticDeflection_mm: deltaSt_mm === null ? null : r(deltaSt_mm, 4),
      force_N: F0 === null ? null : r(F0, 4),
      absorberForce_N: absorberForce_N === null ? null : r(absorberForce_N, 4),
      absorberForceOverF0: r(absorberForceOverF0, 6),
      naturalFrequencies_rad_s: haveSplit ? [r(wLow!, 4), r(wHigh!, 4)] : null,
      naturalFrequencyRatios: ratios ? [r(ratios[0], 6), r(ratios[1], 6)] : null,
      resonanceSeparation_rad_s: sepRad === null ? null : r(sepRad, 4),
      resonanceSeparationRatio: sepRatio === null ? null : r(sepRatio, 6),
      straddlesPrimary: straddles,
      notes,
    },
  };
}
