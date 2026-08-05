/**
 * engineeringBearingCore — ROLLING-BEARING LIFE, one of the most-used machine
 * calculations there is: every rotating shaft rides on bearings, and selecting
 * one means checking it will survive the load for long enough. It pairs with the
 * shaft-torsion lane — the shaft carries the torque, the bearing carries the
 * radial and axial loads it puts on its supports.
 *
 * THE BASIC RATING LIFE, L10. A bearing's fatigue life is a steep power law of how
 * hard you load it relative to its catalogue Dynamic Load Rating C (the load that
 * gives one million revolutions of life): L10 = (C/P)^p million revolutions, where
 * P is the equivalent dynamic load and the exponent p is 3 for ball bearings and
 * 10/3 for roller bearings. The steepness is the whole story — because it is a
 * CUBE (or steeper), halving the load multiplies life eightfold, and a mere 26%
 * overload halves it. That is why bearing selection is so sensitive to getting the
 * load right, and why a small size increase (more C) buys a lot of life.
 *
 * EQUIVALENT LOAD. A bearing usually sees both a radial force Fr and an axial
 * (thrust) force Fa, combined into one equivalent P = X·Fr + Y·Fa with catalogue
 * factors X, Y. Pure radial (X=1, Y=0) is the default.
 *
 * RELIABILITY. L10 is the life 90% of bearings exceed. For a higher reliability
 * requirement the life is scaled by the ISO 281 factor a1 (95% → 0.64, 99% →
 * 0.25, 99.9% → 0.093) — demanding fewer failures means accepting a shorter
 * rated life.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-bearing-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type BearingResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** ISO 281 reliability adjustment factor a1 by required reliability (%). */
const A1: Record<string, number> = { '90': 1, '95': 0.64, '96': 0.55, '97': 0.47, '98': 0.37, '99': 0.25, '99.9': 0.093, '99.95': 0.077 };

export type BearingLifeResult = {
  dynamicLoadRating_N: number;
  equivalentLoad_N: number;
  loadRatio_C_over_P: number;
  exponent: number;
  bearingType: string;
  reliability_percent: number;
  a1: number;
  basicLife_Mrev: number; // L10 (or adjusted) in millions of revolutions
  life_hours?: number;
  speed_rpm?: number;
};

export function bearingLife(spec: {
  dynamicLoadRating: number; // C, N
  equivalentLoad?: number; // P, N (direct)
  radialLoad?: number; // Fr, N
  axialLoad?: number; // Fa, N
  X?: number; // radial factor (default 1)
  Y?: number; // axial factor (default 0)
  bearingType?: string; // ball | roller
  speed_rpm?: number;
  reliability?: number; // % (default 90)
}): BearingResult<BearingLifeResult> {
  const C = pos(spec.dynamicLoadRating);
  if (C === null) return { ok: false, error: 'bearing needs a positive dynamic load rating C (N)' };

  let P = spec.equivalentLoad !== undefined ? pos(spec.equivalentLoad) : null;
  if (P === null) {
    const Fr = spec.radialLoad !== undefined ? pos(spec.radialLoad) : null;
    const Fa = spec.axialLoad !== undefined ? (fin(spec.axialLoad) ?? 0) : 0;
    if (Fr !== null) {
      const X = spec.X !== undefined ? fin(spec.X) : 1;
      const Y = spec.Y !== undefined ? fin(spec.Y) : 0;
      P = (X ?? 1) * Fr + (Y ?? 0) * (Fa ?? 0);
    }
  }
  if (P === null || !(P > 0)) return { ok: false, error: 'supply an equivalentLoad P (N) or a radialLoad Fr (+ optional axialLoad Fa, X, Y)' };

  const type = String(spec.bearingType ?? 'ball').trim().toLowerCase();
  const p = type === 'roller' ? 10 / 3 : 3;

  const relKey = spec.reliability !== undefined ? String(spec.reliability) : '90';
  const a1 = A1[relKey];
  if (a1 === undefined) return { ok: false, error: `unsupported reliability — use one of ${Object.keys(A1).join(', ')} %` };

  const L10 = Math.pow(C / P, p); // million revolutions at 90%
  const life = a1 * L10;

  const out: BearingLifeResult = {
    dynamicLoadRating_N: C, equivalentLoad_N: r(P), loadRatio_C_over_P: r(C / P), exponent: r(p, 4),
    bearingType: type === 'roller' ? 'roller' : 'ball', reliability_percent: Number(relKey), a1,
    basicLife_Mrev: r(life, 4),
  };
  const n = spec.speed_rpm !== undefined ? pos(spec.speed_rpm) : null;
  if (n !== null) { out.speed_rpm = n; out.life_hours = r((life * 1e6) / (60 * n)); }
  return { ok: true, value: out };
}
