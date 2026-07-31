/**
 * engineeringShaftDesignCore — SHAFT DESIGN under SIMULTANEOUS bending + torsion.
 * This is the CAPSTONE of the mechanical analysis lane: a real power-transmission
 * shaft never sees one pure stress. It carries a BENDING moment M (from gear,
 * belt, or bearing loads pulling sideways) and a TORQUE T (the power it exists to
 * transmit) at the same instant, so the surface element is in a combined
 * normal-plus-shear state and must be sized by a proper FAILURE THEORY, not by one
 * stress at a time. This core composes the pieces the rest of the suite already
 * proved — the torsion shear τ=16T/πd³ (shaft_torsion), the bending stress
 * σ=32M/πd³ (beam/section), the Mohr/von-Mises combination (stress core), and the
 * endurance limit Se (fatigue core) — into the two questions an engineer actually
 * asks: what solid round diameter survives the STATIC peak, and what diameter
 * survives a lifetime of FATIGUE cycles.
 *
 * THE COMBINED STATE ON A ROUND SHAFT. At the outer fibre a solid shaft of
 * diameter d under M and T develops a bending normal stress σ = 32·M/(π·d³) and a
 * torsional shear stress τ = 16·T/(π·d³) (there is no σy, so it is the classic
 * σ-with-τ element). Feed that into a yield theory:
 *
 *   • MAX-SHEAR-STRESS theory (MSST / Tresca / Guest — the historic ASME code
 *     shaft rule). The maximum shear of a {σ, 0, τ} element is √((σ/2)² + τ²), and
 *     yielding is reached when it equals Sy/(2n). Substituting σ and τ and solving:
 *         d³ = (32·n / (π·Sy)) · √(M² + T²).
 *     The group √(M² + T²) is the EQUIVALENT MOMENT Me — the single pure bending-
 *     like moment that reproduces the combined shear. MSST is conservative.
 *
 *   • DISTORTION-ENERGY theory (DE / von Mises — the modern default). The von
 *     Mises stress of the same element is √(σ² + 3τ²), and yielding is at Sy/n:
 *         d³ = (32·n / (π·Sy)) · √(M² + (3/4)·T²).
 *     Because √(M² + ¾T²) ≤ √(M² + T²) for any T, the DE diameter is ALWAYS ≤ the
 *     MSST diameter (equal only when T = 0). DE spends less material for the same
 *     nominal safety, which is why MSST GOVERNS the conservative design.
 *
 * THE LIMITING CASES ARE THE COMPOSITION PROOF. Set T = 0 and both theories
 * collapse to pure bending σ = 32M/πd³ = Sy/n → d³ = 32nM/(πSy). Set M = 0 and MSST
 * collapses to pure torsion τ = 16T/πd³ = Sy/(2n) → d³ = 32nT/(πSy) — exactly the
 * τ=16T/πd³ the shaft_torsion lane computes. So this core does not replace those
 * lanes; it REDUCES to them at the edges and adds the interaction in between.
 *
 * FATIGUE — THE SHIGLEY DE-GOODMAN SHAFT EQUATION (Eq. 7-7 / 7-8). Most shafts
 * rotate, so a steady side load becomes a FULLY-REVERSED alternating bending moment
 * Ma at every point on the surface, while the transmitted torque is essentially
 * STEADY — a mean torque Tm with little alternating part. Static strength is the
 * wrong question; the shaft must survive millions of cycles. Shigley combines the
 * alternating and mean von-Mises stresses with the modified-Goodman line into a
 * single diameter equation (Budynas & Nisbett, "Shigley's Mechanical Engineering
 * Design", Eq. 7-7 for the factor of safety, Eq. 7-8 solved for d):
 *
 *     1/n = (16 / (π·d³)) · { (1/Se)·√[4·(Kf·Ma)² + 3·(Kfs·Ta)²]
 *                           + (1/Sut)·√[4·(Kf·Mm)² + 3·(Kfs·Tm)²] }
 *
 *     d   = ( (16·n/π) · { (1/Se)·√[4·(Kf·Ma)² + 3·(Kfs·Ta)²]
 *                        + (1/Sut)·√[4·(Kf·Mm)² + 3·(Kfs·Tm)²] } )^(1/3)
 *
 * The COEFFICIENTS ARE THE WHOLE POINT and the easiest thing to get subtly wrong:
 * a 4 multiplies the (moment)² terms and a 3 multiplies the (torque)² terms inside
 * the square roots, because a rotating shaft's bending stress is 32M/πd³ (the "4"
 * is 2² from the 32=2·16) while its torsional stress carries the von-Mises 3.
 * Kf is the bending fatigue stress-concentration factor and Kfs the torsional one
 * (both default 1). For the common rotating shaft (Ta = 0, Mm = 0) the roots reduce
 * to 2·Kf·Ma and √3·Kfs·Tm. The result is DE-based (von Mises) by construction; it
 * has no MSST variant. This is a verified worked example, not a re-derivation:
 * Shigley Ex. 7-1 (d=1.10 in, Ma=1260, Tm=1100 lbf·in, Se=31.1, Sut=105 kpsi,
 * Kf=1.68, Kfs=1.42) returns n = 1.614, matching the textbook's DE-Goodman answer.
 *
 * UNITS. Millimetre / newton / megapascal throughout: M and T in N·mm, strengths
 * in MPa (= N/mm²), diameters in mm. The safety factor n is dimensionless, so the
 * fatigue equation is unit-system-invariant — feeding the Shigley example in its
 * native lbf·in / psi returns the same n, which is how the smoke pins it exactly.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-shaft-design-core-smoketest.ts):
 * the ONLY import is the MATERIALS table from engineeringCalcCore (itself
 * import-free); no I/O, no Date.now()/Math.random(), total functions. The smoke IS
 * the proof — the T=0 / M=0 limits reproduce the pure-bending and pure-torsion
 * lanes, DE ≤ MSST is asserted directly, and the fatigue case is pinned to Shigley.
 */

import { MATERIALS } from './engineeringCalcCore';

export type ShaftResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Positive-only guard — strengths, safety factors, diameters, Kf. */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Non-negative guard — a moment/torque magnitude may legitimately be zero (a limiting case). */
function nonNeg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
/** Round for display parity; never used inside the invariant math. */
function r(n: number, dp = 4): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** Look up a yield strength (MPa) from the shared MATERIALS table, if named. */
function materialYield(name: string | undefined): number | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const m = MATERIALS[name.trim().toLowerCase()];
  return m ? m.yield : null;
}

// ─── Static design: combined bending + torsion (MSST & DE) ───────────────────

export type ShaftDiameterResult = {
  /** Required diameter by max-shear-stress (MSST/Tresca) theory, mm — the conservative one. */
  diameterMSST: number;
  /** Required diameter by distortion-energy (DE/von Mises) theory, mm — always ≤ MSST. */
  diameterDE: number;
  /** Which theory demands the larger diameter and therefore governs the safe design. */
  governing: 'MSST' | 'DE';
  /** The design recommendation = the governing (larger) diameter, mm. */
  recommendedDiameter: number;
  /** Equivalent moment Me = √(M²+T²), N·mm — the MSST group (a pure moment giving the same τ_max). */
  equivalentMoment: number;
  /** DE group √(M²+¾T²), N·mm. */
  deEquivalentMoment: number;
  /** Bending normal stress σ = 32M/πd³ at the recommended (MSST) diameter, MPa. */
  bendingStress: number;
  /** Torsional shear stress τ = 16T/πd³ at the recommended (MSST) diameter, MPa. */
  torsionalShear: number;
  /** Max shear √((σ/2)²+τ²) at the recommended diameter — equals Sy/(2n) exactly, MPa. */
  maxShearStress: number;
  /** von Mises √(σ²+3τ²) at the recommended diameter — ≤ Sy/n (MSST left margin), MPa. */
  vonMisesStress: number;
  /** Allowable normal stress Sy/n, MPa. */
  allowableNormal: number;
  /** Allowable shear stress Sy/(2n), MPa. */
  allowableShear: number;
  /** Realized MSST safety factor at the recommended diameter = Sy/(2·τ_max) ≈ target n. */
  realizedSafetyFactorMSST: number;
  /** Realized DE safety factor at the recommended diameter = Sy/σ_vm ≥ target n. */
  realizedSafetyFactorDE: number;
  bendingMoment: number;   // M echoed, N·mm
  torque: number;          // T echoed, N·mm
  yieldStrength: number;   // Sy used, MPa
  safetyFactor: number;    // n echoed
  notes: string[];
};

/**
 * Required SOLID round-shaft diameter under a static bending moment M and torque T,
 * by both the max-shear-stress (MSST) and distortion-energy (DE) failure theories.
 *   MSST: d³ = (32·n/(π·Sy))·√(M² + T²)
 *   DE:   d³ = (32·n/(π·Sy))·√(M² + ¾·T²)
 * MSST gives the larger (conservative) diameter and governs; DE equals it only when
 * T = 0. Reports both diameters, the stress state at the governing diameter, and the
 * realized safety factors. Supply M and T (N·mm), a safetyFactor n, and a yield
 * strength Sy (MPa) directly or via a known `material`.
 */
export function shaftDiameter(args: {
  bendingMoment: number; // M, N·mm  (≥ 0; magnitude)
  torque: number;        // T, N·mm  (≥ 0; magnitude)
  safetyFactor: number;  // n
  yield?: number;        // Sy, MPa
  material?: string;     // looks up Sy in MATERIALS
}): ShaftResult<ShaftDiameterResult> {
  const M = nonNeg(args?.bendingMoment);
  const T = nonNeg(args?.torque);
  if (M === null || T === null) return { ok: false, error: 'shaftDiameter needs finite, non-negative bendingMoment and torque (N·mm)' };
  if (M === 0 && T === 0) return { ok: false, error: 'shaftDiameter needs a non-zero bendingMoment or torque' };
  const n = pos(args?.safetyFactor);
  if (n === null) return { ok: false, error: 'shaftDiameter needs a positive safetyFactor n' };
  const Sy = args?.yield !== undefined ? pos(args.yield) : materialYield(args?.material);
  if (Sy === null) return { ok: false, error: 'shaftDiameter needs a positive yield strength (yield, MPa) or a known material' };

  const Me = Math.sqrt(M * M + T * T);              // MSST equivalent moment
  const deGroup = Math.sqrt(M * M + 0.75 * T * T);  // DE group √(M²+¾T²) ≤ Me
  const k = (32 * n) / (Math.PI * Sy);              // shared coefficient
  const dMSST = Math.cbrt(k * Me);
  const dDE = Math.cbrt(k * deGroup);
  const governing: 'MSST' | 'DE' = dDE <= dMSST ? 'MSST' : 'DE'; // always MSST (deGroup ≤ Me)

  // Evaluate the stress state at the governing (recommended) diameter, full precision.
  const d = dMSST;
  const d3 = d * d * d;
  const sigma = (32 * M) / (Math.PI * d3);                    // bending normal stress
  const tau = (16 * T) / (Math.PI * d3);                      // torsional shear stress
  const tauMax = Math.sqrt((sigma / 2) * (sigma / 2) + tau * tau); // = Sy/(2n) exactly
  const vm = Math.sqrt(sigma * sigma + 3 * tau * tau);        // = (Sy/n)·√(M²+¾T²)/√(M²+T²)
  const nMSST = tauMax > 0 ? Sy / (2 * tauMax) : Infinity;    // ≈ n
  const nDE = vm > 0 ? Sy / vm : Infinity;                    // ≥ n

  const notes = [
    `MSST governs (conservative): d = ${r(dMSST)} mm vs DE d = ${r(dDE)} mm; equal only at T=0.`,
    `Equivalent moment Me = √(M²+T²) = ${r(Me)} N·mm.`,
    `Round the diameter UP to the next standard/stock size — this is the minimum, not a final size.`,
  ];

  return {
    ok: true,
    value: {
      diameterMSST: r(dMSST),
      diameterDE: r(dDE),
      governing,
      recommendedDiameter: r(dMSST),
      equivalentMoment: r(Me),
      deEquivalentMoment: r(deGroup),
      bendingStress: r(sigma),
      torsionalShear: r(tau),
      maxShearStress: r(tauMax),
      vonMisesStress: r(vm),
      allowableNormal: r(Sy / n),
      allowableShear: r(Sy / (2 * n)),
      realizedSafetyFactorMSST: r(nMSST, 3),
      realizedSafetyFactorDE: r(nDE, 3),
      bendingMoment: r(M),
      torque: r(T),
      yieldStrength: r(Sy),
      safetyFactor: n,
      notes,
    },
  };
}

// ─── Fatigue design: Shigley DE-Goodman rotating-shaft equation (Eq. 7-8) ────

export type ShaftFatigueResult = {
  /** Required diameter for the target safety factor n, mm. */
  requiredDiameter: number;
  /** Realized factor of safety — at `diameter` if supplied (check mode), else at requiredDiameter (≈ n). */
  realizedSafetyFactor: number;
  /** The design target safety factor. */
  targetSafetyFactor: number;
  /** The diameter checked in check mode, mm, or null in pure design mode. */
  checkedDiameter: number | null;
  /** Alternating root √[4(Kf·Ma)² + 3(Kfs·Ta)²], N·mm. */
  alternatingTerm: number;
  /** Mean root √[4(Kf·Mm)² + 3(Kfs·Tm)²], N·mm. */
  meanTerm: number;
  alternatingMoment: number; // Ma echoed, N·mm
  meanTorque: number;        // Tm echoed, N·mm
  Se: number;                // endurance limit used, MPa
  Sut: number;               // ultimate strength used, MPa
  Kf: number;                // bending fatigue stress-concentration factor
  Kfs: number;               // torsional fatigue stress-concentration factor
  notes: string[];
};

/**
 * Required SOLID round-shaft diameter for FATIGUE, by Shigley's DE-Goodman shaft
 * equation (Budynas & Nisbett, "Shigley's Mechanical Engineering Design", Eq. 7-8):
 *
 *   d = ( (16·n/π)·{ (1/Se)·√[4(Kf·Ma)² + 3(Kfs·Ta)²]
 *                  + (1/Sut)·√[4(Kf·Mm)² + 3(Kfs·Tm)²] } )^(1/3)
 *
 * The default rotating-shaft model has a fully-reversed alternating bending moment
 * Ma and a steady mean torque Tm (Ta = 0, Mm = 0), reducing the roots to 2·Kf·Ma and
 * √3·Kfs·Tm. Kf (bending) and Kfs (torsion) are fatigue stress-concentration factors
 * (default 1). The criterion is distortion-energy (von Mises) by construction — there
 * is no MSST variant. Supply Se and Sut (MPa), Ma and Tm (N·mm), a target safetyFactor
 * n (default 2), and optionally Ta, Mm, Kf, Kfs. Pass an existing `diameter` (mm) to
 * report the realized factor of safety at that size instead of the design diameter.
 */
export function shaftFatigue(args: {
  alternatingMoment: number; // Ma, N·mm (fully-reversed bending)
  meanTorque: number;        // Tm, N·mm (steady torque)
  endurance: number;         // Se, MPa (corrected endurance limit — see fatigue core)
  ultimate: number;          // Sut, MPa
  safetyFactor?: number;     // target n (default 2)
  Kf?: number;               // bending fatigue stress-concentration factor (default 1)
  Kfs?: number;              // torsional fatigue stress-concentration factor (default 1)
  alternatingTorque?: number;// Ta, N·mm (default 0)
  meanMoment?: number;       // Mm, N·mm (default 0)
  diameter?: number;         // optional check mode: realized n at this diameter, mm
}): ShaftResult<ShaftFatigueResult> {
  const Ma = nonNeg(args?.alternatingMoment);
  const Tm = nonNeg(args?.meanTorque);
  if (Ma === null || Tm === null) return { ok: false, error: 'shaftFatigue needs finite, non-negative alternatingMoment (Ma) and meanTorque (Tm) in N·mm' };
  const Ta = args?.alternatingTorque !== undefined ? nonNeg(args.alternatingTorque) : 0;
  const Mm = args?.meanMoment !== undefined ? nonNeg(args.meanMoment) : 0;
  if (Ta === null || Mm === null) return { ok: false, error: 'shaftFatigue: alternatingTorque (Ta) and meanMoment (Mm) must be finite, non-negative (N·mm)' };
  if (Ma === 0 && Tm === 0 && Ta === 0 && Mm === 0) return { ok: false, error: 'shaftFatigue needs a non-zero load term' };
  const Se = pos(args?.endurance);
  const Sut = pos(args?.ultimate);
  if (Se === null || Sut === null) return { ok: false, error: 'shaftFatigue needs a positive endurance limit Se and ultimate strength Sut (MPa)' };
  const Kf = args?.Kf !== undefined ? pos(args.Kf) : 1;
  const Kfs = args?.Kfs !== undefined ? pos(args.Kfs) : 1;
  if (Kf === null || Kfs === null) return { ok: false, error: 'shaftFatigue: Kf and Kfs must be positive (default 1)' };
  const n = args?.safetyFactor !== undefined ? pos(args.safetyFactor) : 2;
  if (n === null) return { ok: false, error: 'shaftFatigue: safetyFactor must be positive (default 2)' };

  // Shigley Eq. 7-7 / 7-8 — the 4 multiplies the (moment)² terms, the 3 the (torque)².
  const A = Math.sqrt(4 * (Kf * Ma) ** 2 + 3 * (Kfs * Ta) ** 2); // alternating root
  const B = Math.sqrt(4 * (Kf * Mm) ** 2 + 3 * (Kfs * Tm) ** 2); // mean root
  const factor = A / Se + B / Sut;                               // N·mm / MPa = mm³
  const requiredDiameter = Math.cbrt((16 * n / Math.PI) * factor);

  const dCheck = args?.diameter !== undefined ? pos(args.diameter) : null;
  const dForN = dCheck !== null ? dCheck : requiredDiameter;
  const invN = (16 / (Math.PI * dForN ** 3)) * factor; // = 1/n at dForN
  const realizedN = invN > 0 ? 1 / invN : Infinity;

  const notes = [
    'DE-Goodman (Shigley Eq. 7-8); distortion-energy criterion — no MSST variant.',
    `Rotating shaft: fully-reversed bending Ma with steady mean torque Tm. Roots use 4·(moment)² + 3·(torque)².`,
    dCheck !== null
      ? `Check mode: realized n = ${r(realizedN, 3)} at d = ${r(dCheck)} mm.`
      : `Design mode: d = ${r(requiredDiameter)} mm for target n = ${n}. Round UP to a standard size.`,
  ];

  return {
    ok: true,
    value: {
      requiredDiameter: r(requiredDiameter),
      realizedSafetyFactor: r(realizedN, 4),
      targetSafetyFactor: n,
      checkedDiameter: dCheck !== null ? r(dCheck) : null,
      alternatingTerm: r(A),
      meanTerm: r(B),
      alternatingMoment: r(Ma),
      meanTorque: r(Tm),
      Se: r(Se),
      Sut: r(Sut),
      Kf,
      Kfs,
      notes,
    },
  };
}

// ─── Classic equivalent bending / twisting moments ───────────────────────────

export type EquivalentLoadsResult = {
  /** Equivalent bending moment Me = ½(M + √(M²+T²)), N·mm (max-principal-stress theory). */
  equivalentBendingMoment: number;
  /** Equivalent twisting moment Te = √(M²+T²), N·mm (max-shear theory). */
  equivalentTwistingMoment: number;
  bendingMoment: number; // M echoed
  torque: number;        // T echoed
  notes: string[];
};

/**
 * The classic combined-load reductions used before a diameter is chosen:
 *   • Equivalent twisting moment Te = √(M² + T²) — the pure torque giving the same
 *     maximum shear (τ_max = 16·Te/πd³), i.e. the MSST equivalent moment.
 *   • Equivalent bending moment Me = ½(M + √(M² + T²)) — the pure moment giving the
 *     same maximum principal (normal) stress (σ₁ = 32·Me/πd³).
 * Limits: T=0 → Te = Me = M (pure bending); M=0 → Te = T and Me = T/2 (pure torsion).
 */
export function equivalentLoads(args: {
  bendingMoment: number; // M, N·mm
  torque: number;        // T, N·mm
}): ShaftResult<EquivalentLoadsResult> {
  const M = nonNeg(args?.bendingMoment);
  const T = nonNeg(args?.torque);
  if (M === null || T === null) return { ok: false, error: 'equivalentLoads needs finite, non-negative bendingMoment and torque (N·mm)' };
  const Te = Math.sqrt(M * M + T * T);
  const Me = 0.5 * (M + Te);
  return {
    ok: true,
    value: {
      equivalentBendingMoment: r(Me),
      equivalentTwistingMoment: r(Te),
      bendingMoment: r(M),
      torque: r(T),
      notes: [
        `Te = √(M²+T²) = ${r(Te)} N·mm (same τ_max as combined). Me = ½(M+Te) = ${r(Me)} N·mm (same σ₁).`,
      ],
    },
  };
}
