// solidworksScriptAdapter — PURE builder + validator layer that turns a
// bounded operation into a validated SolidWorks VBA macro (.swp / .bas driven
// via the SolidWorks COM API `SldWorks` / `ModelDoc2`). Plan P4.
//
// VERIFY SldWorks/ModelDoc2 API calls + macro run mode on a real SolidWorks
// install before wiring. The COM API specifics below (SaveAs3 flag ints,
// Parameter().SystemValue units, EditRebuild3, SaveAs copy flag) follow the
// DOCUMENTED API shapes but were NOT freshly verified on a live SolidWorks;
// the bridge/connected-agent LOCKSTEP + one real run must confirm each before
// `desktop.run_solidworks_macro` (or equivalent) is wired. The
// validation/security logic below is correct regardless of those specifics.
//
// PURITY: zero imports, tsx-loadable (smoke: solidworks-script-adapter). It
// SHAPES and VALIDATES an operation into safe VBA source text; it never touches
// the filesystem, spawns SolidWorks, or resolves a binary — a connected agent
// on the Windows host does that. SolidWorks is Windows-only (no macOS build),
// so this file can only ever be a generator handed to that agent.
//
// SECURITY (VBA-specific, load-bearing): every user value (export path, named
// dimension like "D1@Sketch1", numeric value) is allowlist-validated, then
// SAFELY embedded into VBA. VBA string literals are DOUBLE-QUOTED and escape an
// embedded quote by DOUBLING it (""); VBA has NO line-continuation or escape
// sequence INSIDE a literal, so a newline or an unescaped quote does not just
// break the macro — it can terminate the literal early and inject trailing VBA
// statements. Therefore `vbaStringLiteral` rejects newlines/control chars
// outright (they cannot be represented) and doubles every quote. Values are
// NEVER raw-concatenated; anything that fails an allowlist is dropped and the
// caller is told why (validate*/describe* fail closed; builders never throw).
//
// APPROVAL: per docs/apps/solidworks.md, ALL model/drawing mutation and any
// SaveAs/export are high-risk and require `approvals.request` first. Every
// operation here carries `requiresApproval: true` and `mutates: true` — this
// module only generates the macro; it does not decide to run it.

export type SolidWorksOperation = 'export' | 'set_dimension' | 'rebuild_and_save_copy';

export const SOLIDWORKS_OPERATIONS: readonly SolidWorksOperation[] = [
  'export',
  'set_dimension',
  'rebuild_and_save_copy',
] as const;

/**
 * Export formats SolidWorks writes via `ModelDoc2.SaveAs3` / `Extension.SaveAs`.
 * STEP/STL/X_T (Parasolid) apply to part/assembly docs; PDF applies to the
 * open DRAWING doc (a drawing SaveAs to .pdf is the documented "PDF of drawing"
 * route — SolidWorks has no "print part to PDF" via SaveAs).
 */
export type SolidWorksExportFormat = 'step' | 'stl' | 'parasolid' | 'pdf';

export const SOLIDWORKS_EXPORT_FORMATS: readonly SolidWorksExportFormat[] = [
  'step',
  'stl',
  'parasolid',
  'pdf',
] as const;

/** File extension SolidWorks expects for each export format (SaveAs infers the
 *  translator from the extension; we still pin it so the path allowlist and the
 *  format agree). */
const EXPORT_FORMAT_EXTENSION: Record<SolidWorksExportFormat, string> = {
  step: 'step',
  stl: 'stl',
  parasolid: 'x_t',
  pdf: 'pdf',
};

// ── Bounds (macro stays small + auditable) ──────────────────────────────────
const MAX_PATH_LEN = 1024;
const MAX_DIMENSION_NAME_LEN = 120;
// SolidWorks dimensions are stored in SI (meters); real model dimensions are
// well within a generous ± bound. Reject NaN/Inf and absurd magnitudes so a
// hostile "value" can neither inject nor drive geometry to a pathological size.
const DIMENSION_VALUE_ABS_MAX = 1_000_000; // in the caller's chosen unit
const MAX_MACRO_BYTES = 20_000;

// ── Units for set_dimension ─────────────────────────────────────────────────
// SolidWorks `Dimension.SystemValue` is ALWAYS meters regardless of document
// units, so we convert the user's stated unit → meters at generate time and
// embed the meter value as a numeric literal. (Doing the conversion here, not
// in VBA, keeps the emitted literal a plain number the number-allowlist covers.)
export type SolidWorksLengthUnit = 'mm' | 'cm' | 'm' | 'in';

export const SOLIDWORKS_LENGTH_UNITS: readonly SolidWorksLengthUnit[] = ['mm', 'cm', 'm', 'in'] as const;

const UNIT_TO_METERS: Record<SolidWorksLengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
};

// ── VBA-safe string escaper (THE load-bearing security primitive) ───────────

export type VbaLiteralResult =
  | { ok: true; literal: string }
  | { ok: false; error: string };

/**
 * Turn a validated string into a VBA string literal, or fail closed.
 *
 * VBA literal rules (why this differs from the Python/JSON escaper used for the
 * FreeCAD/Blender lanes):
 *   - Delimited by DOUBLE QUOTES: "abc".
 *   - An embedded double quote is written by DOUBLING it: "say ""hi""".
 *   - There is NO backslash escaping and NO line continuation INSIDE a literal.
 *     A raw newline cannot appear in a literal at all, and the `_` line
 *     continuation only works BETWEEN tokens, never inside quotes. So a newline
 *     or control char is unrepresentable → we REJECT it (never try to encode).
 *
 * Rejecting control chars/newlines is what makes doubling-the-quote sufficient:
 * with no newline available, an attacker cannot close the literal and start a
 * new statement line, and every `"` they inject is doubled back into data.
 *
 * NOTE: callers should ALSO run a per-field allowlist first (path/dimension/
 * number). This escaper is the last line of defense, not the only one.
 */
export function vbaStringLiteral(value: unknown): VbaLiteralResult {
  if (typeof value !== 'string') return { ok: false, error: 'value must be a string' };
  if (value.length === 0) return { ok: false, error: 'value is empty' };
  if (value.length > MAX_PATH_LEN) return { ok: false, error: `value exceeds ${MAX_PATH_LEN} chars` };
  // Reject ANY C0/C1 control char, including \n \r \t \f \v and DEL, plus the
  // Unicode line/paragraph separators VBA/VBScript also treat as line breaks.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value)) {
    return { ok: false, error: 'value contains a control character or line break (cannot be represented in a VBA string literal)' };
  }
  // Double every double-quote; wrap in double-quotes. This is the ONLY escape
  // VBA offers and it is sufficient once control chars/newlines are excluded.
  const doubled = value.replace(/"/g, '""');
  return { ok: true, literal: `"${doubled}"` };
}

// ── Per-field allowlists ─────────────────────────────────────────────────────

/**
 * Windows path validation for a SolidWorks export target. Mirrors the spirit of
 * cadCodeExecutor.validateCadPath (length, control-char, shell-metachar, BMP)
 * but tuned for Windows: a drive-letter colon (`C:\...`) is allowed, and back-
 * slashes are the native separator. Everything that could break out of the VBA
 * literal or the eventual COM/shell context is rejected. Directory `..`
 * traversal is rejected so a plan never even *looks* like an escape.
 */
export function validateSolidWorksPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.length > MAX_PATH_LEN) return { ok: false, error: `path exceeds ${MAX_PATH_LEN} chars` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f]/.test(trimmed)) return { ok: false, error: 'path contains control characters' };
  // Reject shell/command metacharacters and quote chars. A double-quote in a
  // path would be doubled by the escaper (safe for the literal) but a path with
  // an embedded quote is never legitimate and would confuse any downstream
  // command context, so reject it here. Pipe/redirect/semicolon/backtick/$/&
  // and newline are hostile in every context.
  if (/[`$;|&<>\n\r"*?]/.test(trimmed)) return { ok: false, error: 'path contains a disallowed metacharacter or wildcard' };
  // No `..` path traversal (Windows or POSIX separator).
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: 'path must not contain ".." traversal' };
  // BMP-only: keep the emitted literal to characters that are unambiguous; VBA
  // source is typically written as ANSI/UTF-8 and non-BMP astral chars are a
  // needless risk in a generated macro path.
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: 'path contains characters outside the basic multilingual plane' };
    }
  }
  // Must be absolute-ish: a Windows drive (C:\ or C:/) or a UNC (\\server\...).
  // A bare relative name is rejected so SaveAs never writes to SolidWorks' CWD.
  const isDriveAbs = /^[A-Za-z]:[\\/]/.test(trimmed);
  const isUnc = /^\\\\[^\\/]/.test(trimmed);
  if (!isDriveAbs && !isUnc) {
    return { ok: false, error: 'path must be an absolute Windows path (e.g. C:\\\\Exports\\\\part.step) or a UNC path' };
  }
  return { ok: true, path: trimmed };
}

/**
 * A SolidWorks dimension name as used by `Parameter` / selection, e.g.
 * "D1@Sketch1", "Length@Boss-Extrude1", "D2@Sketch3@Part1.Part". Allowed chars:
 * letters, digits, underscore, hyphen, space, dot, and the `@` separator. This
 * is deliberately strict — it excludes quotes, parentheses, and every VBA/shell
 * metachar, so a dimension name can never carry an injection even before the
 * escaper runs. At least one `@` is required (a SolidWorks full dimension name
 * is always `<dim>@<feature>` form).
 */
const DIMENSION_NAME_REGEX = /^[A-Za-z0-9_][A-Za-z0-9_ .\-]*@[A-Za-z0-9_ .\-@]+$/;

export function validateDimensionName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'dimension name must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'dimension name is empty' };
  if (trimmed.length > MAX_DIMENSION_NAME_LEN) {
    return { ok: false, error: `dimension name exceeds ${MAX_DIMENSION_NAME_LEN} chars` };
  }
  if (!DIMENSION_NAME_REGEX.test(trimmed)) {
    return {
      ok: false,
      error: 'dimension name must look like "D1@Sketch1" — letters/digits/_/-/space/. plus at least one "@" separator, no quotes or metacharacters',
    };
  }
  return { ok: true, name: trimmed };
}

/**
 * A finite plain number (integer or decimal, optional leading minus). Rejects
 * NaN/Infinity, exponent notation (`1e9`), and out-of-bounds magnitudes. The
 * accepted value is returned as a canonical decimal STRING so the exact text
 * embedded in the macro is under our control (no locale/format surprises).
 */
export function validateDimensionValue(
  raw: unknown,
): { ok: true; value: number; text: string } | { ok: false; error: string } {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // Plain decimal only — no exponent, no hex, no leading +, no thousands sep.
    if (!/^-?\d{1,12}(?:\.\d{1,12})?$/.test(trimmed)) {
      return { ok: false, error: 'value must be a plain number (optional minus, up to 12 digits each side of the decimal; no exponent)' };
    }
    n = Number(trimmed);
  } else {
    return { ok: false, error: 'value must be a number or numeric string' };
  }
  if (!Number.isFinite(n)) return { ok: false, error: 'value must be finite (NaN/Infinity rejected)' };
  if (Math.abs(n) > DIMENSION_VALUE_ABS_MAX) {
    return { ok: false, error: `value magnitude must be <= ${DIMENSION_VALUE_ABS_MAX}` };
  }
  return { ok: true, value: n, text: canonicalNumberText(n) };
}

/**
 * Render a finite number as a plain, locale-independent decimal string with no
 * exponent — safe to embed as a VBA numeric literal. VBA reads `.` as the
 * decimal separator in source regardless of the machine's regional settings,
 * so a plain-decimal string is portable.
 */
function canonicalNumberText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Avoid toExponential for the magnitudes we allow; bound the fractional part.
  let s = n.toFixed(9);
  // Trim trailing zeros (but keep at least one digit after the dot).
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0');
  return s;
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9_]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

// ── Operation inputs ─────────────────────────────────────────────────────────

export interface SolidWorksExportInput {
  /** Absolute Windows (or UNC) path for the export target. Extension must match
   *  the format (e.g. .step for STEP, .x_t for Parasolid, .pdf for a drawing). */
  outputPath: string;
  format: SolidWorksExportFormat;
}

export interface SolidWorksSetDimensionInput {
  /** Named dimension, e.g. "D1@Sketch1". */
  dimensionName: string;
  /** New value in `unit` (default mm). Converted to meters for SystemValue. */
  value: number | string;
  unit?: SolidWorksLengthUnit;
}

export interface SolidWorksRebuildAndSaveCopyInput {
  /** Absolute Windows (or UNC) path for the saved COPY (same document type
   *  extension as the open doc, e.g. .sldprt). We do not force an extension so
   *  a part/assembly/drawing copy all work; the path allowlist still applies. */
  copyPath: string;
}

export type SolidWorksOperationInput =
  | SolidWorksExportInput
  | SolidWorksSetDimensionInput
  | SolidWorksRebuildAndSaveCopyInput;

// ── Validation ───────────────────────────────────────────────────────────────

export type SolidWorksArgsValidation =
  | { ok: true; operation: SolidWorksOperation; normalized: Record<string, unknown>; notes: string[] }
  | { ok: false; error: string };

export function isSolidWorksOperation(value: unknown): value is SolidWorksOperation {
  return typeof value === 'string' && (SOLIDWORKS_OPERATIONS as readonly string[]).includes(value);
}

function isExportFormat(value: unknown): value is SolidWorksExportFormat {
  return typeof value === 'string' && (SOLIDWORKS_EXPORT_FORMATS as readonly string[]).includes(value);
}

function normalizeUnit(raw: unknown): SolidWorksLengthUnit | null {
  if (raw == null) return 'mm';
  return typeof raw === 'string' && (SOLIDWORKS_LENGTH_UNITS as readonly string[]).includes(raw)
    ? (raw as SolidWorksLengthUnit)
    : null;
}

/**
 * Validate operation + input into a normalized, allowlist-clean shape (or a
 * typed error). Never throws. This is the gate `buildSolidWorksMacro` runs
 * before it emits any text, so an invalid arg can never reach the escaper as a
 * raw concatenation.
 */
export function validateSolidWorksArgs(op: unknown, input: unknown): SolidWorksArgsValidation {
  if (!isSolidWorksOperation(op)) {
    return { ok: false, error: `operation must be one of ${SOLIDWORKS_OPERATIONS.join(', ')}` };
  }
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const notes: string[] = [];

  if (op === 'export') {
    if (!isExportFormat(record.format)) {
      return { ok: false, error: `export format must be one of ${SOLIDWORKS_EXPORT_FORMATS.join(', ')}` };
    }
    const format = record.format;
    const pathResult = validateSolidWorksPath(record.outputPath);
    if (!pathResult.ok) return { ok: false, error: `outputPath: ${pathResult.error}` };
    const ext = extensionOf(pathResult.path);
    const expected = EXPORT_FORMAT_EXTENSION[format];
    const acceptable = format === 'step' ? ['step', 'stp'] : format === 'parasolid' ? ['x_t', 'x_b'] : [expected];
    if (!acceptable.includes(ext)) {
      return {
        ok: false,
        error: `outputPath extension ".${ext || '?'}" does not match ${format} (expected .${acceptable.join(' / .')})`,
      };
    }
    if (format === 'pdf') {
      notes.push('PDF export targets the OPEN DRAWING document (SaveAs .pdf); it is not a render of a 3D part.');
    }
    if (format === 'stl') {
      notes.push('STL is a mesh export — unitless triangles; state the unit convention in the proof.');
    }
    return { ok: true, operation: op, normalized: { outputPath: pathResult.path, format, extension: ext }, notes };
  }

  if (op === 'set_dimension') {
    const nameResult = validateDimensionName(record.dimensionName);
    if (!nameResult.ok) return { ok: false, error: `dimensionName: ${nameResult.error}` };
    const valueResult = validateDimensionValue(record.value);
    if (!valueResult.ok) return { ok: false, error: `value: ${valueResult.error}` };
    const unit = normalizeUnit(record.unit);
    if (unit === null) {
      return { ok: false, error: `unit must be one of ${SOLIDWORKS_LENGTH_UNITS.join(', ')}` };
    }
    const meters = valueResult.value * UNIT_TO_METERS[unit];
    // Re-validate the converted meter value so the embedded literal is also a
    // clean plain-decimal (conversion could produce many fractional digits).
    const metersText = canonicalNumberText(meters);
    notes.push(`Value ${valueResult.text} ${unit} → ${metersText} m embedded as Dimension.SystemValue (SystemValue is always meters).`);
    return {
      ok: true,
      operation: op,
      normalized: {
        dimensionName: nameResult.name,
        displayValue: valueResult.text,
        unit,
        systemValueMeters: meters,
        systemValueMetersText: metersText,
      },
      notes,
    };
  }

  // op === 'rebuild_and_save_copy'
  const copyResult = validateSolidWorksPath(record.copyPath);
  if (!copyResult.ok) return { ok: false, error: `copyPath: ${copyResult.error}` };
  const copyExt = extensionOf(copyResult.path);
  if (!copyExt) {
    return { ok: false, error: 'copyPath must include a document extension (e.g. .sldprt, .sldasm, .slddrw)' };
  }
  notes.push('Save-a-copy does NOT change the open document\'s path — the active doc stays put; the copy is written to copyPath.');
  return { ok: true, operation: op, normalized: { copyPath: copyResult.path, extension: copyExt }, notes };
}

// ── Macro shape ───────────────────────────────────────────────────────────────

export type SolidWorksMacroBuild =
  | {
      ok: true;
      operation: SolidWorksOperation;
      /** The VBA macro source (a `Sub main` module body). */
      vba: string;
      /** Suggested staging file name (.swp is a saved macro; .bas is the module
       *  source — a connected agent imports/records this into a .swp to run). */
      suggestedFileName: string;
      /** The `Sub` entry point the macro runner should invoke ("mod.main"). */
      entryPoint: string;
      mutates: true;
      requiresApproval: true;
      notes: string[];
    }
  | { ok: false; error: string; notes: string[] };

const MACRO_HEADER = [
  "' Generated by Underground Circle solidworksScriptAdapter (plan P4).",
  "' VERIFY SldWorks/ModelDoc2 API calls + macro run mode on a real SolidWorks install before wiring.",
  "' High-risk: this MUTATES / writes files — run only after approvals.request.",
  "' User values below were allowlist-validated and VBA-escaped by the generator; never edit them to raw input.",
];

/** Common preamble: attach to the running SwApp, get the active doc, fail
 *  closed with a MsgBox + exit if there is no open document. */
function macroPreambleLines(): string[] {
  return [
    'Dim swApp As Object',
    'Dim swModel As Object',
    'Set swApp = Application.SldWorks',
    'If swApp Is Nothing Then',
    '    Err.Raise vbObjectError, "UC_SW", "UC_SW_ERROR: could not attach to SldWorks"',
    'End If',
    'Set swModel = swApp.ActiveDoc',
    'If swModel Is Nothing Then',
    '    Err.Raise vbObjectError, "UC_SW", "UC_SW_ERROR: no active document open"',
    'End If',
  ];
}

/**
 * Build a validated SolidWorks VBA macro for a bounded operation, or fail
 * closed. NEVER throws — a degenerate/hostile input returns `{ ok: false }`.
 *
 * All user values reach the VBA source ONLY through `vbaStringLiteral` (strings)
 * or a validated canonical numeric string — never raw concatenation.
 */
export function buildSolidWorksMacro(op: unknown, input: unknown): SolidWorksMacroBuild {
  const validated = validateSolidWorksArgs(op, input);
  if (!validated.ok) return { ok: false, error: validated.error, notes: [] };
  const { operation, normalized, notes } = validated;

  let bodyLines: string[];
  let suggestedFileName: string;

  if (operation === 'export') {
    const outPath = String(normalized.outputPath);
    const format = normalized.format as SolidWorksExportFormat;
    const pathLit = vbaStringLiteral(outPath);
    if (!pathLit.ok) return { ok: false, error: `outputPath could not be safely embedded: ${pathLit.error}`, notes };
    bodyLines = [
      ...macroPreambleLines(),
      'Dim swErrors As Long',
      'Dim swWarnings As Long',
      'Dim savedOk As Boolean',
      `Dim exportPath As String`,
      `exportPath = ${pathLit.literal}`,
      // SaveAs3(name, version=0, options=0) — silent, no template prompts. The
      // translator is inferred from the extension. // VERIFY exact SaveAs
      // overload + option flags on the target SolidWorks version.
      'savedOk = swModel.SaveAs3(exportPath, 0, 0)',
      'If Not savedOk Then',
      '    Err.Raise vbObjectError, "UC_SW", "UC_SW_ERROR: SaveAs reported failure for the export target"',
      'End If',
      `Debug.Print "UC_SW_DONE: exported ${format} -> " & exportPath`,
    ];
    suggestedFileName = `uc-solidworks-export-${format}.bas`;
  } else if (operation === 'set_dimension') {
    const dimName = String(normalized.dimensionName);
    const metersText = String(normalized.systemValueMetersText);
    const nameLit = vbaStringLiteral(dimName);
    if (!nameLit.ok) return { ok: false, error: `dimensionName could not be safely embedded: ${nameLit.error}`, notes };
    // metersText came from canonicalNumberText on a magnitude-bounded finite
    // number — re-assert it is a plain decimal before embedding as a literal.
    if (!/^-?\d{1,16}(?:\.\d{1,12})?$/.test(metersText)) {
      return { ok: false, error: 'internal: converted dimension value is not a plain decimal', notes };
    }
    bodyLines = [
      ...macroPreambleLines(),
      'Dim swParam As Object',
      'Dim dimName As String',
      `dimName = ${nameLit.literal}`,
      // Parameter(name) resolves a named dimension; SystemValue is in meters.
      // // VERIFY Parameter vs. Dimension access + SetSystemValue3 return path.
      'Set swParam = swModel.Parameter(dimName)',
      'If swParam Is Nothing Then',
      '    Err.Raise vbObjectError, "UC_SW", "UC_SW_ERROR: dimension not found: " & dimName',
      'End If',
      `swParam.SystemValue = ${metersText}`,
      // Force a rebuild so the geometry reflects the new value before any proof.
      'swModel.EditRebuild3',
      `Debug.Print "UC_SW_DONE: set " & dimName & " = ${metersText} m (rebuilt)"`,
    ];
    suggestedFileName = 'uc-solidworks-set-dimension.bas';
  } else {
    // operation === 'rebuild_and_save_copy'
    const copyPath = String(normalized.copyPath);
    const pathLit = vbaStringLiteral(copyPath);
    if (!pathLit.ok) return { ok: false, error: `copyPath could not be safely embedded: ${pathLit.error}`, notes };
    bodyLines = [
      ...macroPreambleLines(),
      'Dim swErrors As Long',
      'Dim swWarnings As Long',
      'Dim savedOk As Boolean',
      'Dim copyPath As String',
      `copyPath = ${pathLit.literal}`,
      // Rebuild first so the copy reflects the current model state.
      'swModel.EditRebuild3',
      // swSaveAsOptions_Copy = 2 → save a COPY, leaving the open doc's path
      // unchanged. Extension.SaveAs(name, version=0, options=2, exportData=Nothing,
      // errors, warnings). // VERIFY the Copy option int + SaveAs signature on
      // the target version.
      'savedOk = swModel.Extension.SaveAs(copyPath, 0, 2, Nothing, swErrors, swWarnings)',
      'If Not savedOk Then',
      '    Err.Raise vbObjectError, "UC_SW", "UC_SW_ERROR: SaveAs (copy) reported failure; errors=" & swErrors',
      'End If',
      'Debug.Print "UC_SW_DONE: rebuilt and saved copy -> " & copyPath',
    ];
    suggestedFileName = 'uc-solidworks-rebuild-save-copy.bas';
  }

  const vba = [
    ...MACRO_HEADER,
    '',
    'Option Explicit',
    '',
    'Sub main()',
    ...bodyLines.map((line) => (line.length ? `    ${line}` : line)),
    'End Sub',
    '',
  ].join('\r\n'); // VBA modules are conventionally CRLF.

  if (vba.length > MAX_MACRO_BYTES) {
    return { ok: false, error: `generated macro exceeds ${MAX_MACRO_BYTES} bytes`, notes };
  }

  return {
    ok: true,
    operation,
    vba,
    suggestedFileName,
    entryPoint: 'main',
    mutates: true,
    requiresApproval: true,
    notes: [
      ...notes,
      'Stage this as a .bas module; a connected agent on the Windows host imports it into a .swp and runs Sub main via the SolidWorks macro runner.',
      'Approval is required BEFORE running: this mutates the model and/or writes a file (docs/apps/solidworks.md high-risk).',
      'Verify after: document type/active configuration before acting; dimension/feature state + desktop.file_stat on outputs after.',
    ],
  };
}

// ── Description (approval preview / notice) ────────────────────────────────────

/**
 * One-line, plain-language description of an operation for an approval preview
 * or user notice. Never throws; returns a safe generic line on bad input.
 */
export function describeSolidWorksOperation(op: unknown, input: unknown): string {
  const validated = validateSolidWorksArgs(op, input);
  if (!validated.ok) return 'Run a SolidWorks macro (approval-gated, Windows host)';
  const { operation, normalized } = validated;
  if (operation === 'export') {
    const fmt = String(normalized.format).toUpperCase();
    return `Export the active SolidWorks document to ${fmt} via a generated VBA macro (approval-gated SaveAs)`;
  }
  if (operation === 'set_dimension') {
    return `Set SolidWorks dimension ${normalized.dimensionName} = ${normalized.displayValue} ${normalized.unit} and rebuild via a generated VBA macro (approval-gated model edit)`;
  }
  return 'Rebuild the active SolidWorks document and save a copy via a generated VBA macro (approval-gated write)';
}

/**
 * The engine descriptor SolidWorks WOULD need in appScriptRunner's registry
 * (reported, NOT wired — this module must not edit appScriptRunner.ts). Shape
 * matches `AppScriptEngineDescriptor`. It is exported so the smoke can pin the
 * shape and a future wiring PR can lift it verbatim. `verifiedInvocation:false`
 * gates any live run.
 *
 * KEY DIFFERENCE from the seed engines: SolidWorks is NOT a CLI you exec — the
 * macro runs INSIDE a live SolidWorks process via COM (RunMacro2 / a connected
 * agent), so `buildArgs` here is only a placeholder describing the entry point.
 * The real runner is the COM macro host, not execFile of a binary. The
 * descriptor is reported so the wiring PR decides how the bridge/agent hosts it.
 */
export interface SolidWorksEngineDescriptorReport {
  id: 'solidworks_macro';
  label: string;
  platform: 'windows';
  sourceExtensions: readonly string[];
  outputExtensions: readonly string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  verifiedInvocation: false;
  /** COM macro entry point the runner invokes (module.Sub). */
  entryPoint: string;
  notes: string[];
}

export const SOLIDWORKS_ENGINE_DESCRIPTOR_REPORT: SolidWorksEngineDescriptorReport = {
  id: 'solidworks_macro',
  label: 'SolidWorks (VBA macro via COM RunMacro2)',
  platform: 'windows',
  sourceExtensions: ['swp', 'bas'],
  // Empty: the macro chooses what it writes (STEP/STL/X_T/PDF/.sldprt copy) and
  // the caller stat-verifies the target path after the run.
  outputExtensions: [],
  defaultTimeoutMs: 180_000,
  maxTimeoutMs: 600_000,
  verifiedInvocation: false,
  entryPoint: 'main',
  notes: [
    'Not an execFile CLI: the macro runs inside a live SolidWorks via COM (SldWorks.RunMacro2(macroPath, "mod", "main", ...)) driven by a connected agent on the Windows host.',
    'VERIFY RunMacro2 signature + macro-security/trusted-location settings on the target install before wiring.',
    'A .bas module must be imported into a .swp (or recorded) before it can be run; a connected-agent buildout step does that.',
  ],
};
