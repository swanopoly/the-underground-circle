/**
 * engineeringPowerScrewCore — POWER SCREWS (lead screws): the machine element
 * that turns a rotation into a large linear force — screw jacks, vice and press
 * spindles, CNC lead screws, linear actuators. It composes the ISO thread lane:
 * name an M-size and its pitch diameter and coarse pitch supply the screw's mean
 * diameter and lead, so the same thread you can MODEL you can now TORQUE.
 *
 * THE MECHANICS. Unwrap one turn of the thread at the mean diameter and it is an
 * inclined plane of lead angle λ = atan(l / (π·dm)), where l is the lead (axial
 * travel per turn = pitch × number of starts) and dm the mean diameter. Raising a
 * load F up that plane against friction needs torque
 *     T_raise = (F·dm/2)·(l + π·f·dm) / (π·dm − f·l),
 * and lowering it needs T_lower = (F·dm/2)·(π·f·dm − l)/(π·dm + f·l). The
 * efficiency is η = F·l / (2π·T_raise) — the useful work per turn over the work
 * put in. The friction coefficient is EFFECTIVE: for a square thread f = μ, but a
 * V-form thread wedges, so f = μ/cos(αn) with αn the thread half-angle (Acme
 * 14.5°, ISO metric 30°) — a sharper thread is less efficient for the same μ.
 *
 * SELF-LOCKING is the property that decides whether a jack holds its load with no
 * brake: if T_lower > 0 (equivalently f > tan λ, the lead angle below the
 * friction angle) the screw will NOT back-drive under load. Most single-start
 * fastening and jacking threads are self-locking; a fast multi-start lead screw
 * usually is not, which is why it needs a brake.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-power-screw-core-smoketest.ts):
 * one optional import (the ISO thread lane for designation lookup), no I/O.
 */

import { isoMetricThread, coarsePitchFor } from './engineeringThreadCore';

export type PowerScrewResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
const RAD = 180 / Math.PI;

const THREAD_HALF_ANGLE_DEG: Record<string, number> = { square: 0, acme: 14.5, trapezoidal: 15, iso: 30, metric: 30, vee: 30 };

export type PowerScrewResultData = {
  meanDiameter_mm: number;
  lead_mm: number;
  starts: number;
  leadAngle_deg: number;
  frictionAngle_deg: number;
  effectiveFriction: number;
  raiseTorque_Nmm: number;
  lowerTorque_Nmm: number;
  raiseTorque_Nm: number;
  efficiency: number;
  selfLocking: boolean;
  collarTorque_Nmm: number;
  totalRaiseTorque_Nm: number;
  load_N: number;
  threadForm: string;
};

export function powerScrew(spec: {
  meanDiameter?: number;
  thread?: string; // "M20" → mean diameter d2 + coarse pitch as lead
  lead?: number;
  pitch?: number;
  starts?: number;
  load: number; // N
  frictionCoeff?: number; // μ, default 0.15
  threadForm?: string; // square | acme | iso ...
  collarDiameter?: number; // mean collar friction diameter (mm)
  collarFriction?: number; // μ_c, default = frictionCoeff
}): PowerScrewResult<PowerScrewResultData> {
  const F = pos(spec.load);
  if (F === null) return { ok: false, error: 'power screw needs a positive load (N)' };
  const starts = spec.starts !== undefined && Number(spec.starts) >= 1 ? Math.trunc(Number(spec.starts)) : 1;

  // mean diameter + lead, possibly from a thread designation
  let dm = spec.meanDiameter !== undefined ? pos(spec.meanDiameter) : null;
  let pitch = spec.pitch !== undefined ? pos(spec.pitch) : null;
  if ((dm === null || (spec.lead === undefined && pitch === null)) && spec.thread) {
    const key = String(spec.thread).trim().toLowerCase().replace(/^m/, '');
    const d = Number(key);
    const p = coarsePitchFor(spec.thread);
    if (Number.isFinite(d) && p) {
      const iso = isoMetricThread(d, p);
      if (iso.ok) { if (dm === null) dm = iso.value.pitchDiameter; if (pitch === null) pitch = p; }
    }
  }
  if (dm === null) return { ok: false, error: 'supply a meanDiameter (mm) or a thread designation like "M20"' };
  let lead = spec.lead !== undefined ? pos(spec.lead) : null;
  if (lead === null && pitch !== null) lead = pitch * starts;
  if (lead === null) return { ok: false, error: 'supply a lead (mm) or a pitch (mm) [× starts], or a thread designation' };
  if (lead >= Math.PI * dm) return { ok: false, error: 'lead too large for this diameter (lead angle ≥ 45°)' };

  const form = String(spec.threadForm ?? 'square').trim().toLowerCase();
  const halfAngle = (THREAD_HALF_ANGLE_DEG[form] ?? 0) / RAD;
  const mu = pos(spec.frictionCoeff) ?? 0.15;
  const f = mu / Math.cos(halfAngle); // effective friction (V-thread wedge)

  const lambda = Math.atan(lead / (Math.PI * dm));
  const raiseNum = lead + Math.PI * f * dm;
  const raiseDen = Math.PI * dm - f * lead;
  const T_raise = (F * dm / 2) * (raiseNum / raiseDen);
  const T_lower = (F * dm / 2) * ((Math.PI * f * dm - lead) / (Math.PI * dm + f * lead));
  const efficiency = (F * lead) / (2 * Math.PI * T_raise);
  const selfLocking = f > Math.tan(lambda);

  // collar friction (thrust bearing), if given
  let collarT = 0;
  const dc = spec.collarDiameter !== undefined ? pos(spec.collarDiameter) : null;
  if (dc !== null) { const muc = pos(spec.collarFriction) ?? mu; collarT = muc * F * dc / 2; }

  return {
    ok: true,
    value: {
      meanDiameter_mm: r(dm), lead_mm: r(lead), starts,
      leadAngle_deg: r(lambda * RAD), frictionAngle_deg: r(Math.atan(f) * RAD), effectiveFriction: r(f),
      raiseTorque_Nmm: r(T_raise), lowerTorque_Nmm: r(T_lower),
      raiseTorque_Nm: r(T_raise / 1000),
      efficiency: r(efficiency),
      selfLocking,
      collarTorque_Nmm: r(collarT),
      totalRaiseTorque_Nm: r((T_raise + collarT) / 1000),
      load_N: F, threadForm: form,
    },
  };
}
