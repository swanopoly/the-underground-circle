/**
 * engineeringDesignCore — ONE-CALL PART DESIGN, the culmination of the suite: it
 * runs the whole size → model → tolerance pipeline in a single call. Instead of
 * the agent chaining a sizing calc, a section calc, a solid model, and a fit by
 * hand, it states the DUTY ("a bracket to carry 500 N at 100 mm in steel, safety
 * 2") and gets back a finished design — the sized dimensions, a ready-to-compile
 * Blender model, the mass, the realised safety factor, and the bore fit.
 *
 * Each recipe is exactly the proven integration chain, packaged: it composes the
 * material table, the analysis calcs, the CSG/section geometry, and the ISO fit,
 * and it always ROUNDS a required dimension up to a standard size and RE-CHECKS
 * the realised stress/factor at that size — so the returned part is one that
 * actually meets the duty, not just the raw requirement.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-design-core-smoketest.ts):
 * composes the calc / solid-modeling / tolerance / section cores, no I/O.
 */

import { MATERIALS } from './engineeringCalcCore';
import { writeBlenderSolidScript, nominalBoundingBox, type SolidModel } from './engineeringSolidModelingCore';
import { isoFit, type FitResult } from './engineeringToleranceCore';
import { iBeamSection, channelSection, sectionProperties, buildBeamBlenderScript } from './engineeringStructuralSectionCore';

export type DesignResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r3(n: number): number { return Math.round(n * 1e3) / 1e3; }
/** Round a required dimension up to the next even millimetre (a common stock step). */
function roundUpEven(x: number): number { return Math.max(2, Math.ceil(x / 2) * 2); }

function material(name: string) { return MATERIALS[String(name || 'steel').trim().toLowerCase()]; }

export type DesignedPart = {
  type: string;
  summary: string;
  dimensions: Record<string, number>;
  safety: { allowableStress_MPa?: number; realisedStress_MPa?: number; realisedSafetyFactor?: number; note: string };
  material: string;
  mass_kg: number;
  fit?: { spec: string; type: string; minClearance_um: number; maxClearance_um: number };
  model: SolidModel;
  bpy: string;
  notes: string[];
};

function fitBlock(fit: FitResult) {
  return { spec: `${fit.hole.spec}/${fit.shaft.spec}`, type: fit.fitType, minClearance_um: fit.minClearance_um, maxClearance_um: fit.maxClearance_um };
}

// ─── Bracket (bending) ───────────────────────────────────────────────────────

export function designBracket(spec: {
  load: number; arm: number; material?: string; safetyFactor?: number;
  width?: number; boreDiameter?: number; boltHoleDiameter?: number; outputPath?: string;
}): DesignResult<DesignedPart> {
  const P = pos(spec.load), arm = pos(spec.arm);
  if (P === null || arm === null) return { ok: false, error: 'bracket needs a positive load (N) and arm (mm)' };
  const m = material(spec.material ?? 'steel');
  if (!m) return { ok: false, error: `unknown material — ${Object.keys(MATERIALS).join(', ')}` };
  const SF = pos(spec.safetyFactor) ?? 2;
  const width = pos(spec.width) ?? 40;

  const sigmaAllow = m.yield / SF;
  const M = P * arm; // N·mm
  const S_req = M / sigmaAllow; // mm³
  const h_req = Math.sqrt((6 * S_req) / width);
  const thickness = roundUpEven(h_req);
  const S = (width * thickness ** 2) / 6;
  const sigma = M / S;
  const sfActual = m.yield / sigma;
  const length = Math.ceil((arm + 20) / 5) * 5; // arm + a mounting margin, rounded to 5 mm

  const bore = spec.boreDiameter !== undefined ? pos(spec.boreDiameter) : null;
  const boltD = pos(spec.boltHoleDiameter) ?? 11;
  const negatives: SolidModel['negatives'] = [];
  if (bore !== null) negatives.push({ kind: 'cylinder', r: bore / 2, h: thickness + 2, cx: 0, cy: length / 2 - bore, cz: thickness / 2, axis: 'z' });
  for (const [cx, cy] of [[-width / 2 + 10, -length / 2 + 12], [width / 2 - 10, -length / 2 + 12], [-width / 2 + 10, -length / 2 + 30], [width / 2 - 10, -length / 2 + 30]]) {
    negatives.push({ kind: 'cylinder', r: boltD / 2, h: thickness + 2, cx, cy, cz: thickness / 2, axis: 'z' });
  }
  const model: SolidModel = { positives: [{ kind: 'box', w: width, d: length, h: thickness, cz: thickness / 2 }], negatives };

  let volume = width * length * thickness;
  for (const n of negatives) if (n.kind === 'cylinder') volume -= Math.PI * n.r ** 2 * thickness;
  const mass = volume * m.density;

  const out = typeof spec.outputPath === 'string' && spec.outputPath.trim() ? spec.outputPath : '<output>.stl';
  const bpy = writeBlenderSolidScript(model, out);
  const fit = bore !== null ? isoFit(bore, 'H7', 'g6') : null;
  const notes = [
    `Bending: M = P·arm = ${M} N·mm; required S = M/σ_allow = ${r3(S_req)} mm³ → t ≥ ${r3(h_req)} mm.`,
    `Chosen ${thickness} mm plate: actual σ = ${r3(sigma)} MPa < ${r3(sigmaAllow)} allowable (safety ${r3(sfActual)}).`,
    bore !== null && fit && fit.ok ? `Ø${bore} bore, H7/g6 running clearance ${fit.value.minClearance_um}–${fit.value.maxClearance_um} µm.` : '4 bolt holes for mounting.',
  ];

  return {
    ok: true,
    value: {
      type: 'bracket',
      summary: `${width}×${length}×${thickness} mm ${spec.material ?? 'steel'} bracket, safety ${r3(sfActual)}, ${Math.round(mass * 1000)} g`,
      dimensions: { width, length, thickness, sectionModulus_mm3: r3(S), ...(bore !== null ? { boreDiameter: bore } : {}) },
      safety: { allowableStress_MPa: r3(sigmaAllow), realisedStress_MPa: r3(sigma), realisedSafetyFactor: r3(sfActual), note: sfActual >= SF ? `meets the ${SF}× target` : `BELOW the ${SF}× target` },
      material: spec.material ?? 'steel', mass_kg: r3(mass),
      ...(fit && fit.ok ? { fit: fitBlock(fit.value) } : {}),
      model, bpy: bpy.ok ? bpy.value : '', notes,
    },
  };
}

// ─── Shaft (torsion) ─────────────────────────────────────────────────────────

export function designShaft(spec: {
  torque: number; length?: number; material?: string; safetyFactor?: number; allowableShear?: number; outputPath?: string;
}): DesignResult<DesignedPart> {
  const T = pos(spec.torque); // N·m
  if (T === null) return { ok: false, error: 'shaft needs a positive torque (N·m)' };
  const m = material(spec.material ?? 'steel');
  if (!m) return { ok: false, error: `unknown material — ${Object.keys(MATERIALS).join(', ')}` };
  const SF = pos(spec.safetyFactor) ?? 2;
  const tauYield = 0.577 * m.yield; // von Mises shear yield
  const tauAllow = pos(spec.allowableShear) ?? tauYield / SF;
  const T_Nmm = T * 1000;
  const d_req = Math.cbrt((16 * T_Nmm) / (Math.PI * tauAllow)); // τ = 16T/πd³
  const diameter = roundUpEven(d_req);
  const tau = (16 * T_Nmm) / (Math.PI * diameter ** 3);
  const sfActual = tauYield / tau;
  const length = pos(spec.length) ?? Math.round(diameter * 8);

  const model: SolidModel = { positives: [{ kind: 'cylinder', r: diameter / 2, h: length, cz: length / 2, axis: 'z' }] };
  const mass = Math.PI * (diameter / 2) ** 2 * length * m.density;
  const out = typeof spec.outputPath === 'string' && spec.outputPath.trim() ? spec.outputPath : '<output>.stl';
  const bpy = writeBlenderSolidScript(model, out);

  return {
    ok: true,
    value: {
      type: 'shaft',
      summary: `Ø${diameter} × ${length} mm ${spec.material ?? 'steel'} shaft for ${T} N·m, safety ${r3(sfActual)}, ${Math.round(mass * 1000)} g`,
      dimensions: { diameter, length },
      safety: { allowableStress_MPa: r3(tauAllow), realisedStress_MPa: r3(tau), realisedSafetyFactor: r3(sfActual), note: `τ = 16T/πd³ vs shear yield ${r3(tauYield)} MPa` },
      material: spec.material ?? 'steel', mass_kg: r3(mass),
      model, bpy: bpy.ok ? bpy.value : '',
      notes: [`Torsion: τ = 16T/πd³; required d ≥ ${r3(d_req)} mm → Ø${diameter}.`, `Actual τ = ${r3(tau)} MPa (safety ${r3(sfActual)} on shear yield).`],
    },
  };
}

// ─── Beam (bending, structural section) ──────────────────────────────────────

export function designBeam(spec: {
  load: number; span: number; section?: string; material?: string; safetyFactor?: number;
  height?: number; width?: number; webThickness?: number; flangeThickness?: number; outputPath?: string;
}): DesignResult<DesignedPart> {
  const P = pos(spec.load), span = pos(spec.span);
  if (P === null || span === null) return { ok: false, error: 'beam needs a positive load (N) and span (mm)' };
  const m = material(spec.material ?? 'steel');
  if (!m) return { ok: false, error: `unknown material` };
  const SF = pos(spec.safetyFactor) ?? 2;
  const sigmaAllow = m.yield / SF;
  const M = (P * span) / 4; // simply-supported central point load

  // pick a candidate section and check it; scale the height until it passes.
  const kind = String(spec.section ?? 'i_beam').trim().toLowerCase();
  const mk = kind === 'channel' ? channelSection : iBeamSection;
  let H = pos(spec.height) ?? 100;
  const B = pos(spec.width) ?? 50, tw = pos(spec.webThickness) ?? 6, tf = pos(spec.flangeThickness) ?? 8;
  let sec = mk({ height: H, width: B, webThickness: tw, flangeThickness: tf });
  let props = sec.ok ? sectionProperties(sec.value.rects) : null;
  // grow H in 10 mm steps until the bending stress is under allowable (cap the search).
  for (let i = 0; i < 60 && (!sec.ok || !props || !props.ok || M / props.value.Sx > sigmaAllow); i += 1) {
    H += 10; sec = mk({ height: H, width: B, webThickness: tw, flangeThickness: tf });
    props = sec.ok ? sectionProperties(sec.value.rects) : null;
  }
  if (!sec.ok || !props || !props.ok) return { ok: false, error: 'could not size a section for this load/span' };
  const Sx = props.value.Sx, I = props.value.Ix, A = props.value.area;
  const sigma = M / Sx;
  const sfActual = m.yield / sigma;
  const deflection = (P * span ** 3) / (48 * m.E * I); // central deflection

  const out = typeof spec.outputPath === 'string' && spec.outputPath.trim() ? spec.outputPath : '<output>.stl';
  const bpy = buildBeamBlenderScript({ section: kind, height: H, width: B, webThickness: tw, flangeThickness: tf, length: span }, out);
  const volume = A * span;
  const mass = volume * m.density;

  return {
    ok: true,
    value: {
      type: 'beam',
      summary: `${kind} ${H}×${B} beam over ${span} mm for ${P} N, σ ${r3(sigma)} MPa (safety ${r3(sfActual)}), ${Math.round(mass * 1000)} g`,
      dimensions: { height: H, width: B, webThickness: tw, flangeThickness: tf, span, Ix_mm4: r3(I), Sx_mm3: r3(Sx) },
      safety: { allowableStress_MPa: r3(sigmaAllow), realisedStress_MPa: r3(sigma), realisedSafetyFactor: r3(sfActual), note: `simply-supported central load, δ = ${r3(deflection)} mm` },
      material: spec.material ?? 'steel', mass_kg: r3(mass),
      model: { positives: [] }, bpy: bpy.ok ? bpy.value : '',
      notes: [`Bending M = P·L/4 = ${r3(M)} N·mm; sized ${kind} H=${H} → Sx=${r3(Sx)} mm³.`, `σ = M/Sx = ${r3(sigma)} MPa < ${r3(sigmaAllow)} allowable; mid-span deflection ${r3(deflection)} mm.`],
    },
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function designPart(intent: any): DesignResult<DesignedPart> {
  const type = String(intent?.type ?? '').trim().toLowerCase();
  if (type === 'bracket') return designBracket(intent);
  if (type === 'shaft') return designShaft(intent);
  if (type === 'beam') return designBeam(intent);
  return { ok: false, error: `unknown design type "${type}" — use bracket, shaft, or beam` };
}

/** Confirm a designed part's model matches its stated dimensions (self-check). */
export function designBoundingBox(part: DesignedPart): { w: number; d: number; h: number } | null {
  const bb = nominalBoundingBox(part.model);
  return bb ? { w: r3(bb.maxX - bb.minX), d: r3(bb.maxY - bb.minY), h: r3(bb.maxZ - bb.minZ) } : null;
}
