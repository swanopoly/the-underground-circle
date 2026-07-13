// fusion360ScriptAdapter — PURE generator that turns a bounded op request into
// a validated Autodesk Fusion 360 Python script (adsk.core / adsk.fusion API)
// to run as an in-process script/add-in.
//
// VERIFY adsk.* API calls + the headless/script run mode on a real Fusion
// install before wiring. Fusion has NO documented headless desktop mode
// (docs/apps/fusion-360.md, P15 verdict): a Fusion Python script runs
// IN-PROCESS inside a *running GUI* via the Scripts and Add-Ins dialog (or a
// per-machine add-in install). The exact `adsk.*` entry points below follow
// the documented API shapes but were NOT freshly verified against a live
// install — every generated script carries a `# VERIFY` banner and every
// descriptor field is conservative. This module is the PURE generator only:
// it is NOT wired to any tool or bridge, never touches the filesystem, never
// spawns Fusion, and never resolves a binary.
//
// PURITY: zero runtime imports (`import type` only, and none are needed), so
// `npx tsx scripts/fusion360-script-adapter-smoketest.ts` loads it directly.
//
// SECURITY (mirrors src/lib/cadCodeExecutor.ts exactly): every user value —
// export path, parameter name, numeric value, units — is allowlist-validated
// FIRST, then embedded into the generated Python ONLY as an escaped string
// literal via `pythonStringLiteral` (JSON.stringify + non-ASCII → \uXXXX).
// User input is NEVER raw-concatenated into script text. Paths pass a
// validateCadPath-style check (length/control-char/shell-metachar/BMP/
// traversal). On any validation failure the builder DROPS the request with an
// explanatory note and a fail-closed script stub — it never throws and never
// emits a half-validated mutation.

// ── Operations ─────────────────────────────────────────────────────────────

export type Fusion360Operation = 'export_model' | 'set_user_parameter' | 'export_drawing_pdf';

export const FUSION360_OPERATIONS: readonly Fusion360Operation[] = [
  'export_model',
  'set_user_parameter',
  'export_drawing_pdf',
] as const;

/** Model export formats Fusion's ExportManager creates options for. */
export type Fusion360ExportFormat = 'step' | 'stl' | 'f3d';

export const FUSION360_EXPORT_FORMATS: readonly Fusion360ExportFormat[] = ['step', 'stl', 'f3d'] as const;

/** File extension produced per export format (F3D archive keeps .f3d). */
const FUSION360_EXPORT_EXTENSION: Record<Fusion360ExportFormat, string> = {
  step: 'step',
  stl: 'stl',
  f3d: 'f3d',
};

/** Units accepted for a user-parameter expression (Fusion internal + common). */
export const FUSION360_PARAM_UNITS: readonly string[] = [
  'mm',
  'cm',
  'm',
  'in',
  'ft',
  'deg',
  'rad',
  // Unitless / count parameters use an empty expression unit.
  '',
] as const;

export const FUSION360_SCRIPT_EXTENSION = 'py' as const;

// ── Allowlists ───────────────────────────────────────────────────────────────

/**
 * Fusion user-parameter NAME allowlist. Fusion parameter names are
 * identifiers: a letter/underscore start then letters/digits/underscores.
 * Bounded to 64 chars. This is the SAME shape cadCodeExecutor uses for
 * OpenSCAD -D keys — reused here for the Python `itemByName(<literal>)` lookup.
 */
export const FUSION360_PARAM_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Numeric VALUE allowlist: a plain finite decimal (optional leading minus,
 * up to 12 integer + 12 fraction digits). Exponent / hex / Infinity / NaN are
 * rejected — the same conservative shape as cadCodeExecutor's parameter-value
 * regex, so an assembled expression can never carry a surprise token.
 */
export const FUSION360_PARAM_VALUE_REGEX = /^-?\d{1,12}(?:\.\d{1,12})?$/;

/** Units token allowlist: short alpha unit or empty (validated against the set). */
export const FUSION360_PARAM_UNIT_REGEX = /^[A-Za-z]{0,4}$/;

// ── Path validation (pure mirror of cadCodeExecutor.validateCadPath) ──────────
// LOCKSTEP intent: byte-identical reject-set to cadCodeExecutor.validateCadPath
// / appScriptRunner.validateRunnerPath / the bridge's validateDesktopPathServer,
// PLUS the ".." traversal reject (appScriptRunner already adds this). A path
// that passes here must not fail a downstream validator for a different reason.
// Non-BMP code points are rejected because paths are embedded in generated
// Python string literals via \uXXXX escapes (lone surrogates are not encodable).
function validateFusionPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'path exceeds 1024 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'path contains control characters' };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'path contains a shell metacharacter' };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return {
        ok: false,
        error: 'path contains characters outside the basic multilingual plane (cannot be embedded safely in a generated Python literal)',
      };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: 'path must not contain ".." traversal' };
  return { ok: true, path: trimmed };
}

/**
 * Emit a value as a Python 3 string literal. IDENTICAL technique to
 * cadCodeExecutor.pythonStringLiteral: JSON.stringify (double-quoted,
 * backslash/quote/control escaped) then escape every non-ASCII char to \uXXXX
 * so the generated script is pure ASCII. `validateFusionPath` rejects non-BMP
 * code points, so surrogate escapes never reach Python. User values are NEVER
 * concatenated raw into script text — they only ever pass through here.
 */
function pythonStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeFormat(raw: unknown): Fusion360ExportFormat | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (FUSION360_EXPORT_FORMATS as readonly string[]).includes(value) ? (value as Fusion360ExportFormat) : null;
}

// ── Public request/result contracts ──────────────────────────────────────────

export interface Fusion360ExportModelInput {
  /** Absolute file path the export should be written to (validated). */
  outputPath: string;
  /** STEP / STL / F3D — must match the outputPath extension. */
  format: Fusion360ExportFormat;
}

export interface Fusion360SetUserParameterInput {
  /** Existing user-parameter name (identifier allowlist). */
  parameterName: string;
  /** New numeric value (plain-decimal allowlist). */
  value: number | string;
  /** Expression units (allowlisted; '' for a unitless/count parameter). */
  units?: string;
}

export interface Fusion360ExportDrawingPdfInput {
  /** Absolute .pdf path the active drawing is exported to (validated). */
  outputPath: string;
}

export type Fusion360OperationInput =
  | Fusion360ExportModelInput
  | Fusion360SetUserParameterInput
  | Fusion360ExportDrawingPdfInput;

export interface Fusion360ScriptResult {
  /** The generated Python source. On validation failure this is a fail-closed
   *  stub that raises with a UC_FUSION_ERROR sentinel and mutates nothing. */
  script: string;
  scriptExtension: typeof FUSION360_SCRIPT_EXTENSION;
  /** The file the script writes (export ops only), when the path validated. */
  outputHint?: string;
  notes: string[];
  /** True when the request validated into a real operation script. */
  ok: boolean;
}

export interface Fusion360ArgsValidation {
  ok: boolean;
  /** Normalized, safe-to-embed values (present only when ok). */
  normalized?: Record<string, string>;
  /** Human-readable reasons any input was rejected (drop-with-note). */
  notes: string[];
}

// Shared banner every generated Fusion script carries. The // VERIFY marker is
// intentionally inside the generated Python (as a #-comment) too, so a human
// reviewing a staged .py sees the unverified-API warning before running it in
// a live Fusion session.
const SCRIPT_BANNER = [
  '# Generated by Underground Circle fusion360ScriptAdapter - run in-process',
  '# inside a running Fusion 360 session (Scripts and Add-Ins). NOT headless.',
  '# VERIFY adsk.* API calls + the script run mode on a real Fusion install',
  '# before wiring: entry points follow documented shapes but are unverified.',
];

const FUSION_ERROR_SENTINEL = 'UC_FUSION_ERROR';
const FUSION_DONE_SENTINEL = 'UC_FUSION_DONE';

/**
 * Standard Fusion `run(context)` preamble: acquire the application, the active
 * product cast to a Design, and a UI handle for messages. Fusion scripts are
 * expected to expose a module-level `run(context)`; the adsk.autoTerminate /
 * adsk.terminate housekeeping is documented boilerplate.
 */
function designPreambleLines(): string[] {
  return [
    'import adsk.core',
    'import adsk.fusion',
    'import os',
    'import traceback',
    '',
    'def run(context):',
    '    app = adsk.core.Application.get()',
    '    ui = app.userInterface',
    '    try:',
    '        product = app.activeProduct',
    '        design = adsk.fusion.Design.cast(product)',
    '        if design is None:',
    `            raise RuntimeError("${FUSION_ERROR_SENTINEL}: no active Fusion design (open a design first)")`,
  ];
}

/** Standard trailer: report + surface exceptions with the error sentinel. */
function scriptTrailerLines(doneMessage: string): string[] {
  return [
    `        report = "${FUSION_DONE_SENTINEL}: " + ${doneMessage}`,
    '        app.log(report)',
    '        if ui:',
    '            ui.messageBox(report)',
    '    except Exception:',
    '        detail = traceback.format_exc()',
    `        message = "${FUSION_ERROR_SENTINEL}: " + detail`,
    '        app.log(message)',
    '        if ui:',
    '            ui.messageBox(message)',
    '        raise',
  ];
}

/** Fail-closed stub: a syntactically valid script that mutates nothing and
 *  raises with the error sentinel + the (bounded, plain-text) reason. */
function failClosedScript(reason: string): string {
  const safeReason = pythonStringLiteral(String(reason || 'invalid request').slice(0, 300));
  return [
    ...SCRIPT_BANNER,
    '# FAIL-CLOSED STUB: the request did not validate; this script mutates',
    '# nothing and raises immediately so no partial operation can run.',
    'import adsk.core',
    'import traceback',
    '',
    'def run(context):',
    '    app = adsk.core.Application.get()',
    '    ui = app.userInterface if app else None',
    `    message = "${FUSION_ERROR_SENTINEL}: " + ${safeReason}`,
    '    if app:',
    '        app.log(message)',
    '    if ui:',
    '        ui.messageBox(message)',
    '    raise RuntimeError(message)',
    '',
  ].join('\n');
}

// ── validateFusion360Args ─────────────────────────────────────────────────────

/**
 * Allowlist-validate an operation's inputs into safe, normalized string values.
 * Never throws; returns ok:false + notes on any rejection. This is the single
 * gate every user value passes before it can reach `pythonStringLiteral`.
 */
export function validateFusion360Args(op: unknown, input: unknown): Fusion360ArgsValidation {
  const notes: string[] = [];
  if (!(FUSION360_OPERATIONS as readonly string[]).includes(op as string)) {
    return { ok: false, notes: [`Unknown Fusion operation "${String(op).slice(0, 40)}".`] };
  }
  const operation = op as Fusion360Operation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  if (operation === 'export_model') {
    const format = normalizeFormat(record.format);
    if (!format) {
      notes.push(`export_model format must be one of ${FUSION360_EXPORT_FORMATS.join(', ')}.`);
    }
    const validated = validateFusionPath(record.outputPath);
    if (!validated.ok) {
      notes.push(`export_model outputPath: ${validated.error}.`);
      return { ok: false, notes };
    }
    const ext = extensionOf(validated.path);
    const expectedExt = format ? FUSION360_EXPORT_EXTENSION[format] : '';
    if (!format) return { ok: false, notes };
    if (ext !== expectedExt) {
      notes.push(`export_model outputPath must end in .${expectedExt} for format ${format} (got .${ext || '?'}).`);
      return { ok: false, notes };
    }
    return { ok: true, normalized: { outputPath: validated.path, format }, notes };
  }

  if (operation === 'export_drawing_pdf') {
    const validated = validateFusionPath(record.outputPath);
    if (!validated.ok) {
      notes.push(`export_drawing_pdf outputPath: ${validated.error}.`);
      return { ok: false, notes };
    }
    const ext = extensionOf(validated.path);
    if (ext !== 'pdf') {
      notes.push(`export_drawing_pdf outputPath must end in .pdf (got .${ext || '?'}).`);
      return { ok: false, notes };
    }
    return { ok: true, normalized: { outputPath: validated.path }, notes };
  }

  // operation === 'set_user_parameter'
  const rawName = String((record as Record<string, unknown>).parameterName ?? '').trim();
  if (!FUSION360_PARAM_NAME_REGEX.test(rawName)) {
    notes.push('set_user_parameter parameterName must be an identifier ([A-Za-z_][A-Za-z0-9_]*, ≤64 chars).');
    return { ok: false, notes };
  }
  const rawValueInput = (record as Record<string, unknown>).value;
  let valueStr: string | null = null;
  if (typeof rawValueInput === 'number' && Number.isFinite(rawValueInput)) valueStr = String(rawValueInput);
  else if (typeof rawValueInput === 'string') valueStr = rawValueInput.trim();
  if (valueStr === null || !FUSION360_PARAM_VALUE_REGEX.test(valueStr)) {
    notes.push('set_user_parameter value must be a plain finite decimal (no exponent/hex/Infinity/NaN).');
    return { ok: false, notes };
  }
  const rawUnits = String((record as Record<string, unknown>).units ?? '').trim();
  if (!FUSION360_PARAM_UNIT_REGEX.test(rawUnits) || !(FUSION360_PARAM_UNITS as readonly string[]).includes(rawUnits)) {
    notes.push(`set_user_parameter units must be one of ${FUSION360_PARAM_UNITS.filter(Boolean).join(', ')} (or empty for unitless).`);
    return { ok: false, notes };
  }
  return { ok: true, normalized: { parameterName: rawName, value: valueStr, units: rawUnits }, notes };
}

// ── buildFusion360Script ──────────────────────────────────────────────────────

/**
 * Turn a bounded op request into a validated Fusion 360 Python script. All
 * user values are validated by `validateFusion360Args` FIRST and embedded only
 * via `pythonStringLiteral`. On any validation failure a fail-closed stub is
 * returned (ok:false) — never a partial mutation, never a throw.
 */
export function buildFusion360Script(op: unknown, input: unknown): Fusion360ScriptResult {
  const validation = validateFusion360Args(op, input);
  if (!validation.ok || !validation.normalized) {
    const reason = validation.notes[0] ?? 'invalid Fusion request';
    return {
      script: failClosedScript(reason),
      scriptExtension: FUSION360_SCRIPT_EXTENSION,
      notes: validation.notes.length ? validation.notes : ['Request did not validate; emitted a fail-closed stub.'],
      ok: false,
    };
  }
  const operation = op as Fusion360Operation;
  const values = validation.normalized;
  const notes = [...validation.notes];

  if (operation === 'export_model') {
    const outputPath = values.outputPath;
    const format = values.format as Fusion360ExportFormat;
    const outputLiteral = pythonStringLiteral(outputPath);
    // ExportManager option factory per format (documented shapes). STL needs a
    // geometry (root component) argument; STEP/F3D take the whole design.
    // VERIFY the exact createXxxExportOptions signatures on a live install.
    const optionLines =
      format === 'stl'
        ? [
            '        root = design.rootComponent',
            '        options = export_mgr.createSTLExportOptions(root, OUTPUT_PATH)',
            "        options.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementMedium",
          ]
        : format === 'step'
          ? ['        options = export_mgr.createSTEPExportOptions(OUTPUT_PATH, design.rootComponent)']
          : ['        options = export_mgr.createFusionArchiveExportOptions(OUTPUT_PATH, design.rootComponent)'];
    const script = [
      ...SCRIPT_BANNER,
      `# Operation: export_model (${format.toUpperCase()}). Approval-gated export.`,
      ...designPreambleLines(),
      `        OUTPUT_PATH = ${outputLiteral}`,
      '        export_mgr = design.exportManager',
      ...optionLines,
      '        export_mgr.execute(options)',
      '        if not os.path.isfile(OUTPUT_PATH):',
      `            raise RuntimeError("${FUSION_ERROR_SENTINEL}: export finished without creating the output file")`,
      ...scriptTrailerLines('("exported ' + format.toUpperCase() + ' -> " + os.path.basename(OUTPUT_PATH))'),
      '',
    ].join('\n');
    notes.push(
      `Stage this as a .py Fusion script and run it inside a running Fusion session with the target design active; it writes ${outputPath} (verify with desktop.file_stat after).`,
      'Fusion has no headless mode: an editable design must already be open — fail closed to observation/approval if it is not.',
    );
    return { script, scriptExtension: FUSION360_SCRIPT_EXTENSION, outputHint: outputPath, notes, ok: true };
  }

  if (operation === 'export_drawing_pdf') {
    const outputPath = values.outputPath;
    const outputLiteral = pythonStringLiteral(outputPath);
    // Drawing PDF export goes through the active document's Drawing product.
    // VERIFY: the exact Drawing/ExportManager PDF option factory + whether the
    // active document must BE a drawing on a live install.
    const script = [
      ...SCRIPT_BANNER,
      '# Operation: export_drawing_pdf. Approval-gated export of the active drawing.',
      'import adsk.core',
      'import adsk.fusion',
      'import adsk.drawing',
      'import os',
      'import traceback',
      '',
      'def run(context):',
      '    app = adsk.core.Application.get()',
      '    ui = app.userInterface',
      '    try:',
      `        OUTPUT_PATH = ${outputLiteral}`,
      '        drawing = adsk.drawing.Drawing.cast(app.activeProduct)',
      '        if drawing is None:',
      `            raise RuntimeError("${FUSION_ERROR_SENTINEL}: active product is not a Fusion drawing (open the drawing first)")`,
      '        export_mgr = drawing.exportManager',
      '        options = export_mgr.createPDFExportOptions(OUTPUT_PATH)',
      '        export_mgr.execute(options)',
      '        if not os.path.isfile(OUTPUT_PATH):',
      `            raise RuntimeError("${FUSION_ERROR_SENTINEL}: PDF export finished without creating the output file")`,
      ...scriptTrailerLines('("exported drawing PDF -> " + os.path.basename(OUTPUT_PATH))'),
      '',
    ].join('\n');
    notes.push(
      `Stage this as a .py Fusion script and run it with the target DRAWING active; it writes ${outputPath} (verify with desktop.file_stat after).`,
      'The active product must be a Fusion drawing — the script fails closed if it is a model instead.',
    );
    return { script, scriptExtension: FUSION360_SCRIPT_EXTENSION, outputHint: outputPath, notes, ok: true };
  }

  // operation === 'set_user_parameter'
  const parameterName = values.parameterName;
  const value = values.value;
  const units = values.units;
  const nameLiteral = pythonStringLiteral(parameterName);
  // The expression is assembled from ALREADY-VALIDATED number + unit tokens.
  // It is still embedded as a single escaped literal (belt + suspenders) — the
  // Python receives one string, not concatenated fragments.
  const expression = units ? `${value} ${units}` : value;
  const expressionLiteral = pythonStringLiteral(expression);
  const script = [
    ...SCRIPT_BANNER,
    '# Operation: set_user_parameter. Approval-gated parameter mutation + recompute.',
    ...designPreambleLines(),
    `        PARAM_NAME = ${nameLiteral}`,
    `        NEW_EXPRESSION = ${expressionLiteral}`,
    '        parameter = design.userParameters.itemByName(PARAM_NAME)',
    '        if parameter is None:',
    `            raise RuntimeError("${FUSION_ERROR_SENTINEL}: no user parameter named " + PARAM_NAME)`,
    '        parameter.expression = NEW_EXPRESSION',
    '        design.computeAll()',
    '        applied = parameter.expression',
    ...scriptTrailerLines('("set parameter " + PARAM_NAME + " = " + applied)'),
    '',
  ].join('\n');
  notes.push(
    `Stage this as a .py Fusion script and run it with the target design active; it sets user parameter "${parameterName}" to "${expression}" and recomputes.`,
    'Fusion has no headless mode: the design must already be open and the parameter must already exist — the script fails closed otherwise.',
  );
  return { script, scriptExtension: FUSION360_SCRIPT_EXTENSION, notes, ok: true };
}

// ── describeFusion360Operation ────────────────────────────────────────────────

/** One-line plain-language description for an approval preview / notice. Never
 *  throws — returns a generic line for unknown ops/inputs. */
export function describeFusion360Operation(op: unknown, input: unknown): string {
  if (!(FUSION360_OPERATIONS as readonly string[]).includes(op as string)) {
    return 'Run a Fusion 360 script (approval-gated, in-process)';
  }
  const operation = op as Fusion360Operation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (operation === 'export_model') {
    const format = normalizeFormat(record.format);
    return `Export the active Fusion design to ${format ? format.toUpperCase() : 'a model file'} (approval-gated)`;
  }
  if (operation === 'export_drawing_pdf') {
    return 'Export the active Fusion drawing to PDF (approval-gated)';
  }
  const name = String(record.parameterName ?? '').trim().slice(0, 64);
  return `Set Fusion user parameter${name ? ` "${name}"` : ''} and recompute (approval-gated)`;
}
