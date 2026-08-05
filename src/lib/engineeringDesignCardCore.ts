/**
 * engineeringDesignCardCore — pure view-model builder for the chat
 * Engineering Design Card. Turns a bounded `EngineeringToolCapture`
 * (engineeringRuntimeCaptureCore) into a render-ready model: title,
 * humanized dimension rows, safety pill, mass/fit chips, bounded notes, and
 * ordered next-step chips whose `seedCommand` text a tap can drop into the
 * chat composer.
 *
 * Follows the `buildChatDesignTaskCardModel` precedent (chatDesignTaskCard):
 * pure, total, RN-free. Any malformed capture returns null — this function
 * must NEVER throw on garbage.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-design-card-core-smoketest.ts).
 */

import type {
  EngineeringCalcCapture,
  EngineeringDesignCapture,
  EngineeringToolCapture,
} from './engineeringRuntimeCaptureCore';

export type EngineeringCardTone = 'ok' | 'warn' | 'danger';

export type EngineeringDimensionRow = { key: string; label: string; value: string; unit?: string };
export type EngineeringSafetyPill = { tone: EngineeringCardTone; label: string; detail?: string };
export type EngineeringNextStep = { id: string; label: string; seedCommand: string };

export type EngineeringDesignCardModel = {
  kind: 'design';
  title: string;
  subtitle?: string;
  dimensionRows: EngineeringDimensionRow[];
  safetyPill: EngineeringSafetyPill | null;
  massChip: string | null;
  fitChip: string | null;
  materialChip: string | null;
  notes: string[];
  nextSteps: EngineeringNextStep[];
  truncated: boolean;
};

export type EngineeringCalcCardModel = {
  kind: 'calc';
  title: string;
  answer: string;
  formula: string | null;
  inputRows: EngineeringDimensionRow[];
  extraRows: EngineeringDimensionRow[];
  notes: string[];
  truncated: boolean;
};

export type EngineeringCardModel = EngineeringDesignCardModel | EngineeringCalcCardModel;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_DIMENSION_ROWS = 24;
const MAX_NOTES = 6;

/** Unit-suffix → display unit. Keys are lowercase key suffixes after `_`. */
const UNIT_DISPLAY: Record<string, string> = {
  mm: 'mm',
  mm2: 'mm²',
  mm3: 'mm³',
  mm4: 'mm⁴',
  um: 'µm',
  m: 'm',
  kg: 'kg',
  g: 'g',
  n: 'N',
  kn: 'kN',
  nm: 'N·m',
  nmm: 'N·mm',
  mpa: 'MPa',
  gpa: 'GPa',
  rpm: 'rpm',
  kw: 'kW',
  w: 'W',
  hz: 'Hz',
  deg: '°',
  s: 's',
  h: 'h',
  hours: 'h',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function titleCaseWord(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * Humanize a dimension key: `sectionModulus_mm3` → label 'Section modulus',
 * unit 'mm³'; `pitchDiameterPinion_mm` → 'Pitch diameter pinion' (mm);
 * `width` → 'Width' with no unit.
 */
export function humanizeDimensionKey(key: string): { label: string; unit?: string } {
  const raw = String(key || '').trim();
  if (!raw) return { label: '' };
  let base = raw;
  let unit: string | undefined;
  const underscore = raw.lastIndexOf('_');
  if (underscore > 0) {
    const suffix = raw.slice(underscore + 1);
    const display = UNIT_DISPLAY[suffix.toLowerCase()];
    if (display) {
      base = raw.slice(0, underscore);
      unit = display;
    }
  }
  const words = base
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const label = titleCaseWord(words.join(' '));
  return unit ? { label, unit } : { label };
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  if (abs >= 1000) return String(Math.round(value));
  if (abs >= 1) return String(Math.round(value * 100) / 100);
  return String(Math.round(value * 10000) / 10000);
}

/** '577 g' below 1 kg, '5.4 kg' at or above. */
export function formatMass(massKg: number): string | null {
  if (typeof massKg !== 'number' || !Number.isFinite(massKg) || massKg < 0) return null;
  if (massKg < 1) return `${Math.round(massKg * 1000)} g`;
  return `${Math.round(massKg * 100) / 100} kg`;
}

function boundedNotes(notes: unknown): string[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note): note is string => typeof note === 'string' && !!note.trim())
    .slice(0, MAX_NOTES);
}

// ─── Safety pill ─────────────────────────────────────────────────────────────

function buildSafetyPill(capture: EngineeringDesignCapture): EngineeringSafetyPill | null {
  const safety = isRecord(capture.safety) ? capture.safety : null;
  if (!safety) return null;
  const factor = typeof safety.realisedSafetyFactor === 'number' && Number.isFinite(safety.realisedSafetyFactor)
    ? safety.realisedSafetyFactor
    : null;
  const realised = typeof safety.realisedStress_MPa === 'number' && Number.isFinite(safety.realisedStress_MPa)
    ? safety.realisedStress_MPa
    : null;
  const allowable = typeof safety.allowableStress_MPa === 'number' && Number.isFinite(safety.allowableStress_MPa)
    ? safety.allowableStress_MPa
    : null;
  const note = typeof safety.note === 'string' ? safety.note : '';
  if (factor === null && realised === null && allowable === null && !note) return null;

  let tone: EngineeringCardTone = 'ok';
  if (/\bBELOW\b/.test(note)) tone = 'danger';
  else if (factor !== null && factor < 1) tone = 'danger';
  else if (realised !== null && allowable !== null && realised > allowable) tone = 'danger';
  else if (factor !== null && factor < 1.2) tone = 'warn';
  else if (/\bmeets\b/i.test(note)) tone = 'ok';

  const label = factor !== null
    ? `Safety ${formatNumber(factor)}×`
    : realised !== null && allowable !== null
      ? `σ ${formatNumber(realised)} / ${formatNumber(allowable)} MPa`
      : 'Safety';
  const detailParts: string[] = [];
  if (factor !== null && realised !== null && allowable !== null) {
    detailParts.push(`σ ${formatNumber(realised)} MPa vs ${formatNumber(allowable)} allowable`);
  }
  if (note) detailParts.push(note);
  return { tone, label, detail: detailParts.length > 0 ? detailParts.join(' — ') : undefined };
}

// ─── Next steps ──────────────────────────────────────────────────────────────

function buildNextSteps(capture: EngineeringDesignCapture): EngineeringNextStep[] {
  const stlPath = typeof capture.outputPath === 'string' && capture.outputPath.trim()
    ? capture.outputPath.trim()
    : '/tmp/uc-design.stl';
  const pyPath = stlPath.replace(/\.stl$/i, '') + '.py';
  const steps: EngineeringNextStep[] = [
    {
      id: 'compile_stl',
      label: 'Compile to STL',
      seedCommand: `Write the design's Blender script to ${pyPath} with desktop.file_write_text, then run desktop.cad_compile { engine: "blender", sourcePath: "${pyPath}", outputPath: "${stlPath}" } to build the STL.`,
    },
    {
      id: 'verify_mesh',
      label: 'Verify mesh',
      seedCommand: `Run engineering.inspect_mesh on "${stlPath}" and check the measured volume, bounding box, and watertightness against the designed dimensions${typeof capture.mass_kg === 'number' && Number.isFinite(capture.mass_kg) ? ` and ${formatMass(capture.mass_kg) ?? ''} mass`.trimEnd() : ''}.`,
    },
  ];
  if (capture.fit && typeof capture.fit.spec === 'string' && capture.fit.spec) {
    steps.push({
      id: 'check_fit',
      label: 'Check fit',
      seedCommand: `Explain the ${capture.fit.spec} ${capture.fit.type || ''} fit on this ${capture.type} — run engineering.calc { kind: "iso_fit" } for the bore diameter and confirm the clearance band suits the duty.`.replace(/\s+/g, ' '),
    });
  }
  return steps;
}

// ─── Card builders ───────────────────────────────────────────────────────────

function buildDesignCardModel(capture: EngineeringDesignCapture): EngineeringDesignCardModel | null {
  if (typeof capture.type !== 'string' || !capture.type.trim()) return null;
  if (!isRecord(capture.dimensions)) return null;

  const typeLabel = titleCaseWord(capture.type.trim().replace(/_/g, ' '));
  const mass = typeof capture.mass_kg === 'number' && Number.isFinite(capture.mass_kg)
    ? formatMass(capture.mass_kg)
    : null;
  const material = typeof capture.material === 'string' && capture.material.trim()
    ? capture.material.trim()
    : null;
  const titleTail = [mass, material].filter(Boolean).join(' ');
  const title = titleTail ? `${typeLabel} — ${titleTail}` : typeLabel;

  const dimensionRows: EngineeringDimensionRow[] = [];
  for (const [key, raw] of Object.entries(capture.dimensions)) {
    if (dimensionRows.length >= MAX_DIMENSION_ROWS) break;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const { label, unit } = humanizeDimensionKey(key);
    if (!label) continue;
    dimensionRows.push({ key, label, value: formatNumber(raw), ...(unit ? { unit } : {}) });
  }

  const fit = capture.fit;
  const fitChip = fit && typeof fit.spec === 'string' && fit.spec
    ? `${fit.spec}${typeof fit.type === 'string' && fit.type ? ` ${fit.type}` : ''}${
      typeof fit.minClearance_um === 'number' && typeof fit.maxClearance_um === 'number'
        ? ` ${formatNumber(fit.minClearance_um)}–${formatNumber(fit.maxClearance_um)} µm`
        : ''
    }`
    : null;

  return {
    kind: 'design',
    title,
    subtitle: typeof capture.summary === 'string' && capture.summary.trim() ? capture.summary.trim() : undefined,
    dimensionRows,
    safetyPill: buildSafetyPill(capture),
    massChip: mass,
    fitChip,
    materialChip: material,
    notes: boundedNotes(capture.notes),
    nextSteps: buildNextSteps(capture),
    truncated: capture.truncated === true,
  };
}

function buildCalcCardModel(capture: EngineeringCalcCapture): EngineeringCalcCardModel | null {
  if (typeof capture.quantity !== 'string' || !capture.quantity.trim()) return null;
  if (typeof capture.value !== 'number' || !Number.isFinite(capture.value)) return null;
  const unit = typeof capture.unit === 'string' ? capture.unit.trim() : '';

  const inputRows: EngineeringDimensionRow[] = [];
  if (isRecord(capture.inputs)) {
    for (const [key, raw] of Object.entries(capture.inputs)) {
      if (inputRows.length >= MAX_DIMENSION_ROWS) break;
      const value = typeof raw === 'number' && Number.isFinite(raw)
        ? formatNumber(raw)
        : typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      if (value === null) continue;
      const { label, unit: rowUnit } = humanizeDimensionKey(key);
      if (!label) continue;
      inputRows.push({ key, label, value, ...(rowUnit ? { unit: rowUnit } : {}) });
    }
  }
  const extraRows: EngineeringDimensionRow[] = [];
  if (isRecord(capture.extra)) {
    for (const [key, raw] of Object.entries(capture.extra)) {
      if (extraRows.length >= MAX_DIMENSION_ROWS) break;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const { label, unit: rowUnit } = humanizeDimensionKey(key);
      if (!label) continue;
      extraRows.push({ key, label, value: formatNumber(raw), ...(rowUnit ? { unit: rowUnit } : {}) });
    }
  }

  return {
    kind: 'calc',
    title: capture.quantity.trim(),
    answer: unit ? `${formatNumber(capture.value)} ${unit}` : formatNumber(capture.value),
    formula: typeof capture.formula === 'string' && capture.formula.trim() ? capture.formula.trim() : null,
    inputRows,
    extraRows,
    notes: boundedNotes(capture.notes),
    truncated: capture.truncated === true,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Capture → card model. Total: returns null on any malformed capture. */
export function buildEngineeringCardModel(capture: unknown): EngineeringCardModel | null {
  try {
    if (!isRecord(capture)) return null;
    if (capture.kind === 'design') return buildDesignCardModel(capture as unknown as EngineeringDesignCapture);
    if (capture.kind === 'calc') return buildCalcCardModel(capture as unknown as EngineeringCalcCapture);
    return null;
  } catch {
    return null;
  }
}

/** Convenience list mapper for the render layer (order-preserving, total). */
export function buildEngineeringCardModels(captures: readonly EngineeringToolCapture[] | null | undefined): EngineeringCardModel[] {
  if (!Array.isArray(captures)) return [];
  const models: EngineeringCardModel[] = [];
  for (const capture of captures) {
    const model = buildEngineeringCardModel(capture);
    if (model) models.push(model);
  }
  return models;
}
