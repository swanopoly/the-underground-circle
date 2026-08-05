/**
 * engineeringThermalCore — HEAT TRANSFER, the thermal-flow domain: how fast heat
 * moves through a wall, off a surface, and through a layered assembly. It reuses
 * the material table (now carrying thermal conductivity k alongside E, G, α), so
 * the same steel you sized structurally also conducts heat here.
 *
 * THE UNIFYING IDEA — THERMAL RESISTANCE. Every heat path is a RESISTANCE in a
 * circuit where temperature difference is the "voltage" and heat rate Q is the
 * "current": Q = ΔT / R, exactly Ohm's law. Conduction through a slab has
 * R = L/(k·A); convection off a surface has R = 1/(h·A). Because they are
 * resistances, a layered wall with surface films is just resistances IN SERIES —
 * add them, and Q = ΔT/ΣR flows through all of them equally, which also gives the
 * temperature at every interface (each layer drops Q·R of the total ΔT). That one
 * analogy turns a composite-wall problem into arithmetic, and it is why the
 * insulation layer (tiny k, huge R) dominates while the metal skins barely matter.
 *
 * UNITS. SI: conductivity k in W/(m·K), film coefficient h in W/(m²·K), area in
 * m², temperature difference in K (= °C difference), heat rate in W. Layer
 * thickness is taken in mm and converted at the boundary — the convert-at-the-
 * edges discipline the fluids core also uses.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-thermal-core-smoketest.ts):
 * one import (MATERIALS for the conductivity lookup), no I/O.
 */

import { MATERIALS } from './engineeringCalcCore';

export type ThermalResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 5): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

function conductivityOf(spec: any): number | null {
  if (spec?.k !== undefined) return pos(spec.k);
  if (spec?.conductivity !== undefined) return pos(spec.conductivity);
  if (spec?.material) { const m = MATERIALS[String(spec.material).trim().toLowerCase()]; if (m) return m.k; }
  return null;
}

// ─── Conduction ──────────────────────────────────────────────────────────────

export type ConductionResult = {
  heatRate_W: number;
  thermalResistance_K_per_W: number;
  conductivity_W_per_mK: number;
  area_m2: number;
  thickness_mm: number;
  deltaT_K: number;
  fluxDensity_W_per_m2: number;
};

/** Steady conduction through a slab: Q = k·A·ΔT/L, R = L/(k·A). */
export function conduction(spec: { k?: number; conductivity?: number; material?: string; area: number; thickness: number; deltaT: number }): ThermalResult<ConductionResult> {
  const k = conductivityOf(spec);
  const A = pos(spec.area);
  const t_mm = pos(spec.thickness);
  const dT = fin(spec.deltaT);
  if (k === null) return { ok: false, error: `supply a conductivity k (W/m·K) or a material (${Object.keys(MATERIALS).join(', ')})` };
  if (A === null || t_mm === null || dT === null) return { ok: false, error: 'conduction needs area (m²), thickness (mm), and deltaT (K)' };
  const L = t_mm / 1000;
  const R = L / (k * A);
  const Q = dT / R;
  return {
    ok: true,
    value: {
      heatRate_W: r(Q), thermalResistance_K_per_W: r(R, 8),
      conductivity_W_per_mK: k, area_m2: A, thickness_mm: t_mm, deltaT_K: dT,
      fluxDensity_W_per_m2: r(Q / A),
    },
  };
}

// ─── Convection ──────────────────────────────────────────────────────────────

export type ConvectionResult = {
  heatRate_W: number;
  thermalResistance_K_per_W: number;
  filmCoefficient_W_per_m2K: number;
  area_m2: number;
  deltaT_K: number;
};

/** Newton's cooling off a surface: Q = h·A·ΔT, R = 1/(h·A). */
export function convection(spec: { h: number; area: number; deltaT: number }): ThermalResult<ConvectionResult> {
  const h = pos(spec.h), A = pos(spec.area), dT = fin(spec.deltaT);
  if (h === null || A === null || dT === null) return { ok: false, error: 'convection needs h (W/m²·K), area (m²), and deltaT (K)' };
  const R = 1 / (h * A);
  return {
    ok: true,
    value: { heatRate_W: r(h * A * dT), thermalResistance_K_per_W: r(R, 8), filmCoefficient_W_per_m2K: h, area_m2: A, deltaT_K: dT },
  };
}

// ─── Composite wall (series thermal resistances) ─────────────────────────────

export type WallLayer = { k?: number; conductivity?: number; material?: string; thickness: number; label?: string };

export type CompositeWallResult = {
  area_m2: number;
  deltaT_K: number;
  totalResistance_K_per_W: number;
  heatRate_W: number;
  uValue_W_per_m2K: number;
  layers: Array<{ label: string; resistance_K_per_W: number; kind: 'conduction' | 'convection' }>;
  interfaceTemperatures_C: number[]; // hot face → cold face
};

/**
 * A layered wall with optional inside/outside convection films — resistances in
 * series. Returns the total resistance, the heat rate, the U-value, and the
 * temperature at every interface (hot side first).
 */
export function compositeWall(spec: {
  area: number;
  hotTemperature: number; // °C
  coldTemperature: number; // °C
  layers: WallLayer[];
  insideFilm?: number; // h on the hot side (W/m²·K)
  outsideFilm?: number; // h on the cold side
}): ThermalResult<CompositeWallResult> {
  const A = pos(spec.area);
  const tHot = fin(spec.hotTemperature), tCold = fin(spec.coldTemperature);
  if (A === null || tHot === null || tCold === null) return { ok: false, error: 'composite wall needs area (m²) and hot/cold temperatures (°C)' };
  if (!Array.isArray(spec.layers) || spec.layers.length === 0) return { ok: false, error: 'composite wall needs at least one layer' };
  const dT = tHot - tCold;

  const resistors: Array<{ label: string; R: number; kind: 'conduction' | 'convection' }> = [];
  const hIn = spec.insideFilm !== undefined ? pos(spec.insideFilm) : null;
  if (hIn !== null) resistors.push({ label: 'inside film', R: 1 / (hIn * A), kind: 'convection' });
  for (let i = 0; i < spec.layers.length; i += 1) {
    const layer = spec.layers[i];
    const k = conductivityOf(layer);
    const t_mm = pos(layer.thickness);
    if (k === null) return { ok: false, error: `layer ${i} needs a conductivity or material` };
    if (t_mm === null) return { ok: false, error: `layer ${i} needs a positive thickness (mm)` };
    resistors.push({ label: layer.label ?? `layer ${i} (k=${k})`, R: (t_mm / 1000) / (k * A), kind: 'conduction' });
  }
  const hOut = spec.outsideFilm !== undefined ? pos(spec.outsideFilm) : null;
  if (hOut !== null) resistors.push({ label: 'outside film', R: 1 / (hOut * A), kind: 'convection' });

  const totalR = resistors.reduce((a, x) => a + x.R, 0);
  const Q = dT / totalR;
  // interface temperatures: start at the hot face, drop Q·R across each resistor.
  const temps: number[] = [tHot];
  let cur = tHot;
  for (const res of resistors) { cur -= Q * res.R; temps.push(cur); }

  return {
    ok: true,
    value: {
      area_m2: A, deltaT_K: dT,
      totalResistance_K_per_W: r(totalR, 8),
      heatRate_W: r(Q),
      uValue_W_per_m2K: r(1 / (totalR * A), 5),
      layers: resistors.map((x) => ({ label: x.label, resistance_K_per_W: r(x.R, 8), kind: x.kind })),
      interfaceTemperatures_C: temps.map((t) => r(t, 3)),
    },
  };
}
