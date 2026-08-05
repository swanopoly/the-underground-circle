/**
 * engineeringDesignIsolatorCore — ONE-CALL VIBRATION-ISOLATOR DESIGN, packaging
 * the proven dynamics composition chain (the vibration-isolation integration
 * drill) exactly the way engineeringDesignCore packages the statics chain.
 *
 * State the DUTY — "mount a 250 kg machine spinning at 1500 rpm so 90% of the
 * shaking force never reaches the floor" — and get back a finished spring-mount
 * design: the wire/coil geometry of each corner spring, the realised stiffness
 * and natural frequency, the isolation actually delivered (always ≥ the target,
 * because coil rounding is RE-CHECKED, house style), the static sag a
 * technician can measure, the spring-set mass, and a ready-to-compile Blender
 * model of one spring.
 *
 * THE CHAIN (each seam is a proven core, never a re-derived formula):
 *   1. isolation target → TR       TR = 1 − isolation%
 *   2. TR → frequency ratio r      transmissibility SOLVE (isolation demands
 *                                  r = Ω/ωn > √2 — below the crossover a mount
 *                                  AMPLIFIES; the core owns the damped solve)
 *   3. r → required mount ωn       ωn = Ω/r (the solve hands it back)
 *   4. ωn → total stiffness        k_total = m·ωn²
 *   5. k → spring geometry         invert k = G·d⁴/(8D³n) over STANDARD wire
 *                                  sizes, round the coils to 0.5 and RE-CHECK
 *                                  the realised isolation through the SAME
 *                                  transmissibility core (meets-or-exceeds)
 *   6. two-faces cross-check       δ_static = m·g/k must equal g/ωn² — the one
 *                                  fact a fitter can verify with a ruler
 *
 * IMPOSSIBILITY IS A RESULT: isolating a very low disturbance frequency needs
 * a mount natural frequency below ~1.3 Hz, i.e. a static sag beyond any real
 * spring (δ = g/ωn² grows without bound). That comes back ok:false with the
 * physics, not a silently absurd spring.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-design-isolator-smoketest.ts):
 * composes the forced-vibration, vibration, calc (spring/materials), and helix
 * cores; imports ONLY TYPES from engineeringDesignCore (the dispatcher there
 * imports this function, so a runtime import would be a cycle); no I/O.
 */

import type { DesignedPart, DesignResult } from './engineeringDesignCore';
import { transmissibility } from './engineeringForcedVibrationCore';
import { naturalFrequency } from './engineeringVibrationCore';
import { springRate, MATERIALS } from './engineeringCalcCore';
import { springGeometry, buildSpringBlenderScript } from './engineeringHelixCore';

const G_ACCEL = 9.80665; // m/s² — same constant the vibration cores use
const SQRT2 = Math.SQRT2;

/** Standard spring wire diameters (mm) the sizing loop may pick from. */
export const STANDARD_WIRE_MM = [2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 12] as const;

/** A practical steel coil spring cannot sag much more than this under its load. */
export const MAX_PRACTICAL_SAG_MM = 150;

/** Sane active-coil band: fewer than 3 coils isn't a helix, more than 15 buckles/surges. */
const COIL_MIN = 3;
const COIL_MAX = 15;

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r3(n: number): number { return Math.round(n * 1e3) / 1e3; }
function r5(n: number): number { return Math.round(n * 1e5) / 1e5; }

export type IsolatorSpec = {
  /** Supported machine mass, kg. */
  mass_kg: number;
  /** Disturbance (forcing) frequency, Hz — or give speed_rpm instead. */
  disturbanceFrequency_Hz?: number;
  /** Rotating-machine speed, rpm (converted to Hz = rpm/60). */
  speed_rpm?: number;
  /** Requested isolation, percent (e.g. 90 → TR = 0.10). Must be 0 < p < 100. */
  isolationPercent: number;
  /** Number of identical corner springs sharing the load (default 4). */
  springCount?: number;
  /** Spring material (default 'steel'; needs G + density in MATERIALS). */
  material?: string;
  /** Spring index C = D/d (default 8; must be 4–12). When given explicitly it is
   *  honoured exactly; the default may be relaxed to land a sane coil count. */
  springIndex?: number;
  /** Mount damping ratio ζ (default 0 = undamped design; damping WORSENS TR in
   *  the isolation region, and the solve/re-check both account for it). */
  dampingRatio?: number;
  outputPath?: string;
};

/**
 * One-call vibration-isolator design: isolation % → TR → r (> √2) → ωn →
 * k_total → standard-wire spring geometry, re-checked so the realised isolation
 * meets or exceeds the request. Returns a DesignedPart (type 'isolator') whose
 * bpy models ONE of the springs.
 */
export function designIsolator(spec: IsolatorSpec): DesignResult<DesignedPart> {
  const mass = pos(spec?.mass_kg);
  if (mass === null) return { ok: false, error: 'isolator needs a positive supported mass_kg' };

  let fHz: number | null = spec?.disturbanceFrequency_Hz !== undefined ? pos(spec.disturbanceFrequency_Hz) : null;
  if (fHz === null && spec?.speed_rpm !== undefined) { const rpm = pos(spec.speed_rpm); if (rpm !== null) fHz = rpm / 60; }
  if (fHz === null) return { ok: false, error: 'give the disturbance as disturbanceFrequency_Hz or speed_rpm (positive)' };

  const p = Number(spec?.isolationPercent);
  if (!Number.isFinite(p) || p <= 0 || p >= 100) return { ok: false, error: 'isolationPercent must be between 0 and 100 (exclusive) — it fixes the target TR = 1 − p/100' };
  const targetTR = 1 - p / 100;

  const count = spec?.springCount === undefined ? 4 : Number(spec.springCount);
  if (!Number.isFinite(count) || count < 1 || Math.trunc(count) !== count) return { ok: false, error: 'springCount must be a positive whole number of identical springs' };

  const matName = String(spec?.material ?? 'steel').trim().toLowerCase();
  const mat = MATERIALS[matName];
  if (!mat) return { ok: false, error: `unknown material "${matName}" — ${Object.keys(MATERIALS).join(', ')}` };

  let requestedC: number | null = null;
  if (spec?.springIndex !== undefined) {
    const c = pos(spec.springIndex);
    if (c === null || c < 4 || c > 12) return { ok: false, error: 'springIndex C = D/d must be in the practical 4–12 range' };
    requestedC = c;
  }

  const zeta = spec?.dampingRatio === undefined ? 0 : Number(spec.dampingRatio);
  if (!Number.isFinite(zeta) || zeta < 0) return { ok: false, error: 'dampingRatio (ζ) must be a finite value ≥ 0' };

  const Omega = 2 * Math.PI * fHz; // rad/s

  // ── 1–3. isolation target → TR → r → required ωn (the forced-vibration core's solver) ──
  const solve = transmissibility({ targetTR, forcingFrequency_Hz: fHz, dampingRatio: zeta });
  if (!solve.ok) return { ok: false, error: `isolation solve failed: ${solve.error}` };
  const sv = solve.value;
  const rReq = sv.ratio;
  const wnReq = sv.omega_n_required_rad_s;
  const deltaReq = sv.requiredStaticDeflection_mm;
  if (wnReq === null || deltaReq === null) return { ok: false, error: 'isolation solve returned no required natural frequency' };

  // ── impossibility guard: a too-low disturbance frequency needs an absurdly soft mount ──
  if (deltaReq > MAX_PRACTICAL_SAG_MM) {
    return {
      ok: false,
      error:
        `isolation is impractical at this frequency: ${r3(p)}% isolation of a ${r3(fHz)} Hz disturbance requires r = Ω/ωn = ${r3(rReq)} (> √2), ` +
        `i.e. a mount natural frequency of only ${r3(wnReq / (2 * Math.PI))} Hz — a static sag of ${r3(deltaReq)} mm, beyond the ~${MAX_PRACTICAL_SAG_MM} mm any practical coil spring can give. ` +
        `A mount only isolates well ABOVE √2×fn; a disturbance this close to (or below) any achievable resonance cannot be isolated — raise the disturbance frequency, reduce the target, or use a different strategy (e.g. a tuned absorber).`,
    };
  }

  // ── 4. required stiffness: ωn = √(k/m) → k_total = m·ωn² ──
  const kTotalReq_N_m = mass * wnReq * wnReq;      // N/m
  const kTotalReq = kTotalReq_N_m / 1000;          // N/mm (spring-lane units)
  const kEachTarget = kTotalReq / count;           // N/mm per spring

  // ── 5. size a standard spring: invert k = G·d⁴/(8D³n), round coils, RE-CHECK ──
  // Try the requested index first; the DEFAULT index may relax through the
  // practical band to land an active-coil count in [3, 15].
  const indexCandidates = requestedC !== null ? [requestedC] : [8, 7, 6, 5, 4, 9, 10, 11, 12];
  type Chosen = {
    C: number; d: number; D: number; n: number;
    kEach: number; kTotal: number; ratio: number; TR: number; isolation: number;
  };
  let chosen: Chosen | null = null;
  outer:
  for (const C of indexCandidates) {
    for (const d of STANDARD_WIRE_MM) {
      const D = C * d;
      const nRaw = (mat.G * d ** 4) / (8 * D ** 3 * kEachTarget);
      const nNear = Math.round(nRaw * 2) / 2;
      // nearest half-coil first; if that leaves the isolation short (or the band),
      // soften with the next half-coil — more coils → lower k → MORE isolation.
      for (const n of [nNear, nNear + 0.5]) {
        if (n < COIL_MIN || n > COIL_MAX) continue;
        const sr = springRate({ wireDiameter: d, meanDiameter: D, activeCoils: n, shearModulus: mat.G });
        if (!sr.ok) continue;
        const kEach = sr.value; // N/mm (core-rounded)
        const kTotal = kEach * count;
        // RE-CHECK through the SAME transmissibility core (evaluate mode).
        const ev = transmissibility({ forcingFrequency_Hz: fHz, springRate: kTotal, mass, dampingRatio: zeta });
        if (!ev.ok) continue;
        const TR = ev.value.transmissibility;
        if (!Number.isFinite(TR) || TR >= 1) continue;
        const isolation = 1 - TR;
        if (isolation + 1e-9 < p / 100) continue; // rounding made it stiffer → fell short → next combination
        chosen = { C, d, D, n, kEach, kTotal, ratio: ev.value.ratio, TR, isolation };
        break outer;
      }
    }
  }
  if (!chosen) {
    return {
      ok: false,
      error:
        `no standard-wire spring (Ø${STANDARD_WIRE_MM[0]}–${STANDARD_WIRE_MM[STANDARD_WIRE_MM.length - 1]} mm, ` +
        `${COIL_MIN}–${COIL_MAX} active coils${requestedC !== null ? `, index C = ${requestedC}` : ''}) delivers k ≈ ${r3(kEachTarget)} N/mm per spring — ` +
        `change springCount, springIndex, or material`,
    };
  }

  // ── realised mount: fn via the vibration core (the k the springs actually give) ──
  const nf = naturalFrequency({ springRate: chosen.kTotal, mass });
  if (!nf.ok) return { ok: false, error: `natural-frequency re-check failed: ${nf.error}` };
  const wnReal = nf.value.omega_n_rad_s;
  const fnReal = nf.value.frequency_Hz;

  // ── 6. static deflection — the two faces of one fact ──
  const deltaStatic = (mass * G_ACCEL) / chosen.kTotal;                 // δ = mg/k, mm (k in N/mm)
  const deltaFromWn = (G_ACCEL / (wnReal * wnReal)) * 1000;             // δ = g/ωn², mm
  if (Math.abs(deltaStatic - deltaFromWn) > 1e-3 * Math.max(1, deltaStatic)) {
    return { ok: false, error: 'internal cross-check failed: mg/k and g/ωn² disagree on the static deflection' };
  }

  // ── spring lengths: solid + working travel (50% dynamic reserve, 15% clash allowance) ──
  const nTotal = chosen.n + 2; // closed/ground ends
  const solidLength = nTotal * chosen.d;
  const workingDeflection = 1.5 * deltaStatic;
  const freeLength = Math.ceil(solidLength + 1.15 * workingDeflection);

  // ── mass + model of one spring (helix core) ──
  const springSpec = { wireDiameter: chosen.d, meanDiameter: chosen.D, freeLength, totalCoils: nTotal, activeCoils: chosen.n };
  const geo = springGeometry(springSpec);
  if (!geo.ok) return { ok: false, error: `spring geometry failed: ${geo.error}` };
  const setMass = count * geo.value.wireVolume * mat.density; // mm³ × kg/mm³
  const out = typeof spec?.outputPath === 'string' && spec.outputPath.trim() ? spec.outputPath : '<output>.stl';
  const bpy = buildSpringBlenderScript(springSpec, out);

  const isolationPct = chosen.isolation * 100;
  const notes = [
    `Isolation chain: ${r3(p)}% target → TR = ${r5(targetTR)} → solved r = Ω/ωn = ${r5(rReq)} (isolation only exists ABOVE the √2 crossover) → required ωn = ${r3(wnReq)} rad/s (fn = ${r3(wnReq / (2 * Math.PI))} Hz), δ_required = ${r3(deltaReq)} mm.`,
    `Stiffness: k_total = m·ωn² = ${r3(kTotalReq)} N/mm over ${count} springs → ${r3(kEachTarget)} N/mm each; inverted k = G·d⁴/(8D³n) over standard wires (G = ${mat.G} MPa ${mat.name}).`,
    `Chosen spring: Ø${chosen.d} mm wire, Ø${chosen.D} mm mean (index C = ${chosen.C}${requestedC === null && chosen.C !== 8 ? `, relaxed from the default 8 to land ${COIL_MIN}–${COIL_MAX} active coils` : ''}), ${chosen.n} active coils (+2 closed ends).`,
    `RE-CHECK at the rounded coils: realised k_total = ${r3(chosen.kTotal)} N/mm → fn = ${r3(fnReal)} Hz, r = ${r5(chosen.ratio)}, TR = ${r5(chosen.TR)} → ${r3(isolationPct)}% isolation — meets or exceeds the ${r3(p)}% target (coil rounding always softens, never stiffens, the accepted mount).`,
    `Static deflection two ways: mg/k = ${r3(deltaStatic)} mm = g/ωn² = ${r3(deltaFromWn)} mm — the sag a technician measures under the machine weight.`,
    `Lengths: solid Ls = (n+2)·d = ${r3(solidLength)} mm; free L0 = ${freeLength} mm (Ls + 1.15 × 1.5·δ_static working travel, so the spring never coil-binds under load).`,
    zeta > 0
      ? `Damped design (ζ = ${r5(zeta)}): the solve and re-check both use the damped TR — in the isolation region damping RAISES TR, so the damped mount is softer than an undamped one for the same target.`
      : 'Undamped design (ζ = 0) — the softest, best-isolating assumption; any real mount damping will raise TR slightly, which the re-check margin absorbs.',
  ];

  return {
    ok: true,
    value: {
      type: 'isolator',
      summary: `${count}× Ø${chosen.d}/${chosen.D} mm spring mount (C=${chosen.C}, ${chosen.n} coils, ${r3(chosen.kEach)} N/mm each): fn ${r3(fnReal)} Hz vs ${r3(fHz)} Hz disturbance → ${r3(isolationPct)}% isolation (target ${r3(p)}%), sag ${r3(deltaStatic)} mm`,
      dimensions: {
        wireDiameter: chosen.d,
        meanDiameter: chosen.D,
        springIndex: chosen.C,
        activeCoils: chosen.n,
        totalCoils: nTotal,
        freeLength,
        solidLength: r3(solidLength),
        springCount: count,
        k_each_N_mm: r3(chosen.kEach),
        k_total_N_mm: r3(chosen.kTotal),
        requiredFn_Hz: r3(wnReq / (2 * Math.PI)),
        realisedFn_Hz: r3(fnReal),
        frequencyRatio: r5(chosen.ratio),
        transmissibility: r5(chosen.TR),
        realisedIsolationPercent: r3(isolationPct),
        staticDeflection_mm: r3(deltaStatic),
      },
      safety: {
        realisedSafetyFactor: r3(chosen.ratio / SQRT2),
        note: `isolation requires r = Ω/ωn > √2 (below the crossover a mount AMPLIFIES); realised r = ${r5(chosen.ratio)} is ${r3(chosen.ratio / SQRT2)}× past the √2 crossover, and more damping there would only raise TR`,
      },
      material: matName,
      mass_kg: r3(setMass),
      model: { positives: [] }, // a spring is a swept helix, not CSG — the geometry lives in the bpy
      bpy: bpy.ok ? bpy.value : '',
      notes,
    },
  };
}
