/**
 * engineeringRuntimeCaptureCore — pure, bounded transient-metadata capture for
 * the engineering tool results so the chat UI can render a structured design
 * card instead of losing everything but resultsText prose.
 *
 * Mirrors the designAppRuntimeManifest capture precedent
 * (`buildDesignAppRuntimeToolCaptureMetadata`): the runtime calls
 * `buildEngineeringToolCaptureMetadata(toolName, result, input)` at the
 * dispatch boundary and spreads the returned `{ engineeringCapture }` object
 * into the transient tool-event metadata. The render layer later pulls
 * captures back out with `extractEngineeringCapturesFromToolEvents`.
 *
 * HARD GUARANTEES:
 * - Only allowlisted primitive fields are copied — NEVER the bpy/script/dxf/
 *   openscad bodies, model trees, or resultsText.
 * - The serialized capture is deterministically clamped to
 *   `ENGINEERING_CAPTURE_MAX_BYTES` (2 500) so it can never crowd the 16 000
 *   byte message-metadata ceiling (messageMetadataCore) or the 9 000 char
 *   persisted bot-message cap (persistedChatMetadata).
 * - Totality: malformed input of any shape returns null, never throws.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-runtime-capture-core-smoketest.ts).
 */

export const ENGINEERING_TOOL_CAPTURE_KEY = 'engineeringCapture';
/** Hard ceiling on the serialized capture (the whole metadata cap is 16 000). */
export const ENGINEERING_CAPTURE_MAX_BYTES = 2_500;

// Structural bounds (tuning knobs; the byte ceiling above is the contract).
const SUMMARY_MAX_CHARS = 220;
const NOTE_MAX_CHARS = 220;
const NOTES_MAX_ITEMS = 6;
const DIMENSIONS_MAX_KEYS = 32;
const INPUTS_MAX_KEYS = 16;
const EXTRA_MAX_KEYS = 12;
const SHORT_TEXT_MAX = 160;
const KEY_MAX_CHARS = 64;
const MAX_EXTRACTED_CAPTURES = 4;

export type EngineeringSafetyCapture = {
  allowableStress_MPa?: number;
  realisedStress_MPa?: number;
  realisedSafetyFactor?: number;
  note?: string;
};

export type EngineeringFitCapture = {
  spec: string;
  type: string;
  minClearance_um?: number;
  maxClearance_um?: number;
};

export type EngineeringDesignCapture = {
  kind: 'design';
  tool: 'engineering.design_part';
  type: string;
  summary?: string;
  dimensions: Record<string, number>;
  safety?: EngineeringSafetyCapture;
  mass_kg?: number;
  fit?: EngineeringFitCapture;
  material?: string;
  notes?: string[];
  outputPath?: string;
  truncated?: boolean;
};

export type EngineeringCalcCapture = {
  kind: 'calc';
  tool: 'engineering.calc';
  calcKind?: string;
  quantity: string;
  value: number;
  unit: string;
  formula?: string;
  inputs?: Record<string, number | string>;
  extra?: Record<string, number>;
  notes?: string[];
  truncated?: boolean;
};

export type EngineeringToolCapture = EngineeringDesignCapture | EngineeringCalcCapture;

// ─── Small total helpers ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(1, max - 1))}…` : trimmed;
}

function clampKey(key: string): string {
  return key.length > KEY_MAX_CHARS ? key.slice(0, KEY_MAX_CHARS) : key;
}

/** Deterministic: preserves insertion order, keeps only finite numbers. */
function boundNumberMap(value: unknown, maxKeys: number): { map: Record<string, number>; clipped: boolean } {
  const map: Record<string, number> = {};
  let clipped = false;
  if (!isRecord(value)) return { map, clipped };
  let count = 0;
  for (const [key, raw] of Object.entries(value)) {
    const num = finite(raw);
    if (num === undefined) { clipped = clipped || raw !== undefined; continue; }
    if (count >= maxKeys) { clipped = true; break; }
    map[clampKey(key)] = num;
    count += 1;
  }
  return { map, clipped };
}

function boundInputsMap(value: unknown, maxKeys: number): { map: Record<string, number | string>; clipped: boolean } {
  const map: Record<string, number | string> = {};
  let clipped = false;
  if (!isRecord(value)) return { map, clipped };
  let count = 0;
  for (const [key, raw] of Object.entries(value)) {
    let entry: number | string | undefined;
    const num = finite(raw);
    if (num !== undefined) entry = num;
    else entry = clampText(raw, 80);
    if (entry === undefined) { clipped = clipped || raw !== undefined; continue; }
    if (count >= maxKeys) { clipped = true; break; }
    map[clampKey(key)] = entry;
    count += 1;
  }
  return { map, clipped };
}

function boundNotes(value: unknown, maxItems: number): { notes: string[]; clipped: boolean } {
  if (!Array.isArray(value)) return { notes: [], clipped: false };
  const notes: string[] = [];
  let clipped = false;
  for (const raw of value) {
    const text = clampText(raw, NOTE_MAX_CHARS);
    if (text === undefined) continue;
    if (typeof raw === 'string' && raw.trim().length > NOTE_MAX_CHARS) clipped = true;
    if (notes.length >= maxItems) { clipped = true; break; }
    notes.push(text);
  }
  return { notes, clipped };
}

function byteLength(value: string): number {
  // TextEncoder is available in RN/web/node; fall back to a UTF-8 estimate.
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return unescape(encodeURIComponent(value)).length;
  }
}

function captureBytes(capture: EngineeringToolCapture): number {
  try {
    return byteLength(JSON.stringify(capture));
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// ─── Design capture ──────────────────────────────────────────────────────────

function buildDesignCapture(result: Record<string, unknown>, input: unknown): EngineeringDesignCapture | null {
  const design = isRecord(result.design) ? result.design : null;
  if (!design) return null;
  const type = clampText(design.type, 40);
  if (!type) return null;

  const inputRecord = isRecord(input) ? input : {};
  let truncated = false;

  const dims = boundNumberMap(design.dimensions, DIMENSIONS_MAX_KEYS);
  truncated = truncated || dims.clipped;

  const capture: EngineeringDesignCapture = {
    kind: 'design',
    tool: 'engineering.design_part',
    type,
    dimensions: dims.map,
  };

  // Summary: prefer a structured field; otherwise recover the safe first
  // sentence of resultsText ("Designed <summary>. Dimensions: …"). Never the
  // whole resultsText (it carries script-writing guidance).
  const structuredSummary = clampText(design.summary ?? (result as Record<string, unknown>).summary, SUMMARY_MAX_CHARS);
  if (structuredSummary) {
    capture.summary = structuredSummary;
  } else if (typeof result.resultsText === 'string') {
    const match = /^Designed (.+?)\. Dimensions:/.exec(result.resultsText);
    const derived = match ? clampText(match[1], SUMMARY_MAX_CHARS) : undefined;
    if (derived) capture.summary = derived;
  }

  if (isRecord(design.safety)) {
    const safety: EngineeringSafetyCapture = {};
    const allowable = finite(design.safety.allowableStress_MPa);
    const realised = finite(design.safety.realisedStress_MPa);
    const factor = finite(design.safety.realisedSafetyFactor);
    const note = clampText(design.safety.note, SHORT_TEXT_MAX);
    if (allowable !== undefined) safety.allowableStress_MPa = allowable;
    if (realised !== undefined) safety.realisedStress_MPa = realised;
    if (factor !== undefined) safety.realisedSafetyFactor = factor;
    if (note) safety.note = note;
    if (Object.keys(safety).length > 0) capture.safety = safety;
  }

  const mass = finite(design.mass_kg);
  if (mass !== undefined) capture.mass_kg = mass;

  if (isRecord(design.fit)) {
    const spec = clampText(design.fit.spec, 40);
    const fitType = clampText(design.fit.type, 40);
    if (spec && fitType) {
      const fit: EngineeringFitCapture = { spec, type: fitType };
      const minC = finite(design.fit.minClearance_um);
      const maxC = finite(design.fit.maxClearance_um);
      if (minC !== undefined) fit.minClearance_um = minC;
      if (maxC !== undefined) fit.maxClearance_um = maxC;
      capture.fit = fit;
    }
  }

  const material = clampText(design.material ?? inputRecord.material, 60);
  if (material) capture.material = material;

  const notes = boundNotes(design.notes ?? (result as Record<string, unknown>).notes, NOTES_MAX_ITEMS);
  truncated = truncated || notes.clipped;
  if (notes.notes.length > 0) capture.notes = notes.notes;

  const outputPath = clampText(inputRecord.outputPath ?? design.outputPath, 200);
  if (outputPath) capture.outputPath = outputPath;

  if (truncated) capture.truncated = true;

  // Deterministic byte-budget enforcement: drop the heaviest optional blocks
  // in a fixed order until the serialized capture fits.
  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES && capture.notes) {
    // First halve the notes, then drop them entirely.
    capture.notes = capture.notes.slice(0, Math.max(1, Math.floor(capture.notes.length / 2)));
    capture.truncated = true;
    if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES) delete capture.notes;
  }
  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES) {
    const entries = Object.entries(capture.dimensions);
    while (entries.length > 4 && captureBytes({ ...capture, dimensions: Object.fromEntries(entries) }) > ENGINEERING_CAPTURE_MAX_BYTES) {
      entries.pop();
    }
    capture.dimensions = Object.fromEntries(entries);
    capture.truncated = true;
  }
  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES) {
    delete capture.summary;
    capture.truncated = true;
  }
  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES) return null;
  return capture;
}

// ─── Calc capture ────────────────────────────────────────────────────────────

function buildCalcCapture(result: Record<string, unknown>, input: unknown): EngineeringCalcCapture | null {
  const calc = isRecord(result.result) ? result.result : null;
  if (!calc || calc.ok === false) return null;
  const quantity = clampText(calc.quantity, 120);
  const value = finite(calc.value);
  const unit = clampText(calc.unit, 40);
  if (!quantity || value === undefined || unit === undefined) return null;

  let truncated = false;
  const capture: EngineeringCalcCapture = {
    kind: 'calc',
    tool: 'engineering.calc',
    quantity,
    value,
    unit,
  };

  const calcKind = clampText(isRecord(input) ? input.kind : undefined, 60);
  if (calcKind) capture.calcKind = calcKind;

  const formula = clampText(calc.formula, SHORT_TEXT_MAX);
  if (formula) capture.formula = formula;

  const inputs = boundInputsMap(calc.inputs, INPUTS_MAX_KEYS);
  truncated = truncated || inputs.clipped;
  if (Object.keys(inputs.map).length > 0) capture.inputs = inputs.map;

  const extra = boundNumberMap(calc.extra, EXTRA_MAX_KEYS);
  truncated = truncated || extra.clipped;
  if (Object.keys(extra.map).length > 0) capture.extra = extra.map;

  const notes = boundNotes(calc.notes, NOTES_MAX_ITEMS);
  truncated = truncated || notes.clipped;
  if (notes.notes.length > 0) capture.notes = notes.notes;

  if (truncated) capture.truncated = true;

  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES && capture.notes) {
    delete capture.notes;
    capture.truncated = true;
  }
  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES && capture.inputs) {
    delete capture.inputs;
    capture.truncated = true;
  }
  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES && capture.extra) {
    delete capture.extra;
    capture.truncated = true;
  }
  if (captureBytes(capture) > ENGINEERING_CAPTURE_MAX_BYTES) return null;
  return capture;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the transient metadata fragment for one engineering tool result.
 * Returns `{ engineeringCapture }` (spread it into the event metadata) or
 * null for other tools / failed / malformed results. Never throws.
 */
export function buildEngineeringToolCaptureMetadata(
  toolName: string,
  result: unknown,
  input?: unknown,
): { [ENGINEERING_TOOL_CAPTURE_KEY]: EngineeringToolCapture } | null {
  try {
    if (!isRecord(result) || result.ok === false) return null;
    if (toolName === 'engineering.design_part') {
      const capture = buildDesignCapture(result, input);
      return capture ? { [ENGINEERING_TOOL_CAPTURE_KEY]: capture } : null;
    }
    if (toolName === 'engineering.calc') {
      const capture = buildCalcCapture(result, input);
      return capture ? { [ENGINEERING_TOOL_CAPTURE_KEY]: capture } : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Validate a value already stored under the capture key. Never throws. */
export function parseEngineeringToolCapture(value: unknown): EngineeringToolCapture | null {
  try {
    if (!isRecord(value)) return null;
    if (value.kind === 'design') {
      if (typeof value.type !== 'string' || !value.type) return null;
      if (!isRecord(value.dimensions)) return null;
      return value as unknown as EngineeringDesignCapture;
    }
    if (value.kind === 'calc') {
      if (typeof value.quantity !== 'string' || !value.quantity) return null;
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return null;
      if (typeof value.unit !== 'string') return null;
      return value as unknown as EngineeringCalcCapture;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pull the bounded capture list out of a message's tool events for the render
 * layer. Order-preserving, capped at 4, never throws.
 */
export function extractEngineeringCapturesFromToolEvents(
  events: Array<{ tool?: string; metadata?: unknown }> | null | undefined,
): EngineeringToolCapture[] {
  const captures: EngineeringToolCapture[] = [];
  if (!Array.isArray(events)) return captures;
  for (const event of events) {
    if (captures.length >= MAX_EXTRACTED_CAPTURES) break;
    try {
      const metadata = isRecord(event?.metadata) ? event.metadata : null;
      const capture = metadata ? parseEngineeringToolCapture(metadata[ENGINEERING_TOOL_CAPTURE_KEY]) : null;
      if (capture) captures.push(capture);
    } catch {
      // Skip malformed events; extraction is total.
    }
  }
  return captures;
}
