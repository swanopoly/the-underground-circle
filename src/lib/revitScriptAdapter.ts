// VERIFY Revit API calls + pyRevit/RPS run mode + IronPython constraints on a real Revit install before wiring
//
// revitScriptAdapter — PURE builders that turn a bounded operation into a
// validated Autodesk Revit Python script. NOT wired: this is a generator only,
// mirroring the hardened precedent in `src/lib/cadCodeExecutor.ts`
// (pure builders, allowlist params, `pythonStringLiteral` safe embed, bounded
// output, explanatory notes, degenerate-never-throws) and the engine-descriptor
// shape in `src/lib/appScriptRunner.ts`. Revit is NOT in that registry today —
// the descriptor it WOULD need is reported by `describeRevitEngineDescriptor()`
// below (see the module tail) so the owner can register it once a live run
// confirms the invocation.
//
// PURITY: zero imports (no react-native / supabase / node), so
// `npx tsx scripts/revit-script-adapter-smoketest.ts` loads it directly and the
// desktop bridge can share the validators later (LOCKSTEP, when wired).
//
// ── RUNTIME SHAPE (documented, NOT freshly verified — see header) ─────────────
// The generated script targets Revit's Python surface as exposed by pyRevit,
// RevitPythonShell (RPS), or a pyRevit CLI `run` invocation. Those hosts inject
// `__revit__` (the UIApplication) into the script scope, from which the active
// `Document` is reached. All three host families are IronPython 2.7-era
// (CPython-3 constructs like f-strings and `pathlib` are unavailable), so this
// module obeys the SAME embedding constraints as an ExtendScript adapter:
//   - user text is embedded ONLY through a Python-literal escaper, never
//     concatenated raw;
//   - literals carrying escaped user text are emitted as `u"…"` UNICODE
//     literals, because in Python 2 a `\uXXXX` escape is only decoded inside a
//     unicode (`u"…"`) literal — a plain `"A"` is the 6 raw characters,
//     not "A". Emitting `u"…"` makes the escaper's `\uXXXX` output correct on
//     the IronPython 2.7 host (and remains valid on any Python 3 host too).
//
// ── SECURITY BAR (load-bearing) ───────────────────────────────────────────────
// Every user value — sheet set name, IFC/PDF/CSV export path, parameter name,
// parameter value, schedule view name — is allowlist-validated FIRST, then
// SAFELY embedded via `pythonStringLiteral` (mirrors
// cadCodeExecutor.pythonStringLiteral). Names are identifier/label-allowlisted;
// paths use a `validateCadPath`-style reject-set (no control chars, no shell
// metacharacters, BMP-only, no `..` traversal). Nothing is raw-concatenated;
// invalid inputs are DROPPED WITH A NOTE (degenerate builders return typed
// errors and never throw).
//
// ── MUTATION vs READ-ONLY ─────────────────────────────────────────────────────
// export_pdf / export_ifc / export_schedule_csv are READ-ONLY exports.
// set_parameter MUTATES the model: the generated script wraps the write in a
// Revit `Transaction` (open → set → Commit, RollBack on failure), and the
// builder both flags `mutates: true` and carries an approval note — per
// `docs/apps/revit.md`, BIM parameter mutation is high risk and requires
// `approvals.request` before acting.

export type RevitScriptOperation = 'export_pdf' | 'export_ifc' | 'set_parameter' | 'export_schedule_csv';

export const REVIT_SCRIPT_OPERATIONS: readonly RevitScriptOperation[] = [
  'export_pdf',
  'export_ifc',
  'set_parameter',
  'export_schedule_csv',
] as const;

/** Sentinel the generated scripts print before their machine-readable result. */
export const REVIT_RESULT_SENTINEL = 'UC_REVIT_RESULT:';
/** Sentinel the generated scripts print on a fail-closed error. */
export const REVIT_ERROR_SENTINEL = 'UC_REVIT_ERROR:';

// ── Bounds ────────────────────────────────────────────────────────────────────
const MAX_PATH_LEN = 1024;
const MAX_NAME_LEN = 200; // sheet set / schedule view / parameter name
const MAX_VALUE_LEN = 2048; // parameter value (text params can be long)
const MAX_NOTE_LEN = 240;

// ── Path validation (pure mirror of cadCodeExecutor.validateCadPath) ──────────
// LOCKSTEP-shaped with `validateCadPath` / `validateDesktopPathServer`: keep the
// reject-set identical so a plan that passes here cannot fail bridge validation
// for a different reason once wired. Additionally rejects non-BMP code points
// because paths are embedded in generated Python `u"…"` literals via \uXXXX
// escapes, and lone-surrogate escapes are not safely encodable. Also rejects
// `..` traversal (mirrors appScriptRunner.validateRunnerPath) so a plan never
// even LOOKS like a sandbox escape.
function validateRevitPath(raw: unknown, label: string): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > MAX_PATH_LEN) return { ok: false, error: `${label} exceeds ${MAX_PATH_LEN} chars` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: `${label} contains control characters` };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: `${label} contains a shell metacharacter` };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return {
        ok: false,
        error: `${label} contains characters outside the basic multilingual plane (cannot be embedded safely in a generated Python literal)`,
      };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: `${label} must not contain ".." traversal` };
  return { ok: true, path: trimmed };
}

// ── Name / label validation (allowlist) ───────────────────────────────────────
// Revit sheet-set names, schedule-view names, and parameter names are
// human-authored labels: letters, digits, spaces, and a conservative set of
// punctuation Revit permits in names. Deliberately EXCLUDES every Python and
// shell metacharacter (quotes, backslash, backtick, `${};|&<>` etc.) and every
// control/non-BMP char, so a name is safe to embed AND safe to compare against
// the model. This is stricter than strictly necessary — a label that trips it
// is dropped with a note rather than sanitized (never silently mangled).
const REVIT_NAME_REGEX = /^[A-Za-z0-9 _\-.,()#&/]+$/;

function validateRevitName(raw: unknown, label: string): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > MAX_NAME_LEN) return { ok: false, error: `${label} exceeds ${MAX_NAME_LEN} chars` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: `${label} contains control characters` };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: `${label} contains characters outside the basic multilingual plane` };
    }
  }
  if (!REVIT_NAME_REGEX.test(trimmed)) {
    return {
      ok: false,
      error: `${label} may only contain letters, digits, spaces, and _-.,()#&/ (got a disallowed character)`,
    };
  }
  return { ok: true, name: trimmed };
}

// ── Parameter value validation ────────────────────────────────────────────────
// A parameter value can be text, a number, or a boolean (Yes/No params). Unlike
// a name it may legitimately contain punctuation and quotes, so it is NOT
// name-allowlisted — instead it is bounded, control-char-free, and BMP-only, and
// then SAFELY embedded via `pythonStringLiteral`. The generated script coerces
// the string to the target parameter's storage type at write time (Double /
// Integer / String / ElementId-as-int), so the embedded literal is always a
// safe unicode string; no numeric value is ever concatenated into code.
function validateRevitParamValue(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  let asString: string;
  if (typeof raw === 'string') asString = raw;
  else if (typeof raw === 'number') asString = Number.isFinite(raw) ? String(raw) : '';
  else if (typeof raw === 'boolean') asString = raw ? '1' : '0';
  else return { ok: false, error: 'value must be a string, finite number, or boolean' };

  if (asString.length === 0) return { ok: false, error: 'value is empty' };
  if (asString.length > MAX_VALUE_LEN) return { ok: false, error: `value exceeds ${MAX_VALUE_LEN} chars` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(asString)) return { ok: false, error: 'value contains control characters' };
  for (const ch of asString) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: 'value contains characters outside the basic multilingual plane' };
    }
  }
  return { ok: true, value: asString };
}

/**
 * Emit a value as a Python UNICODE (`u"…"`) string literal that is correct on
 * IronPython 2.7 AND Python 3. Mirrors `cadCodeExecutor.pythonStringLiteral`:
 * JSON.stringify gives a double-quoted, backslash/quote/control-escaped literal;
 * we additionally escape every non-ASCII char to `\uXXXX` so the script text is
 * pure ASCII. The `u` prefix is REQUIRED (not decorative): in Python 2 a bare
 * `"A"` is NOT decoded, only `u"A"` is — so callers that embed
 * validated user text MUST use this helper and never hand-roll a literal.
 * Validation upstream rejects non-BMP code points, so surrogate escapes never
 * reach the host. Values are NEVER concatenated raw into script text.
 */
function pythonStringLiteral(value: string): string {
  const ascii = JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `u${ascii}`;
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function boundNote(note: string): string {
  return String(note || '').slice(0, MAX_NOTE_LEN);
}

// ── Operation catalog ──────────────────────────────────────────────────────────

export interface RevitOperationInfo {
  operation: RevitScriptOperation;
  /** True when the operation writes to the model (requires Transaction + approval). */
  mutates: boolean;
  /** One-line human description for an approval preview / notice. */
  summary: string;
  /** Allowed output extension for exports (empty when the op writes no file, e.g. never here). */
  outputExtensions: readonly string[];
}

const OPERATION_INFO: Record<RevitScriptOperation, RevitOperationInfo> = {
  export_pdf: {
    operation: 'export_pdf',
    mutates: false,
    summary: 'Export a Revit sheet set to PDF (read-only export)',
    outputExtensions: ['pdf'],
  },
  export_ifc: {
    operation: 'export_ifc',
    mutates: false,
    summary: 'Export the active Revit model to IFC (read-only export)',
    outputExtensions: ['ifc'],
  },
  set_parameter: {
    operation: 'set_parameter',
    mutates: true,
    summary: 'Set a Revit element/type parameter value (MUTATION — Transaction + approval required)',
    outputExtensions: [],
  },
  export_schedule_csv: {
    operation: 'export_schedule_csv',
    mutates: false,
    summary: 'Export a Revit schedule view to delimited text/CSV (read-only export)',
    outputExtensions: ['csv', 'txt'],
  },
};

export function isRevitScriptOperation(value: unknown): value is RevitScriptOperation {
  return typeof value === 'string' && (REVIT_SCRIPT_OPERATIONS as readonly string[]).includes(value);
}

/**
 * Static, input-independent description of an operation (for menus / approval
 * previews). Never throws — an unknown op yields a safe fallback.
 */
export function describeRevitOperation(operation: unknown): RevitOperationInfo & { known: boolean } {
  if (isRevitScriptOperation(operation)) return { ...OPERATION_INFO[operation], known: true };
  return {
    operation: 'export_pdf',
    mutates: false,
    summary: 'Unknown Revit operation',
    outputExtensions: [],
    known: false,
  };
}

// ── Input types ────────────────────────────────────────────────────────────────

export interface RevitExportPdfInput {
  /** Named sheet set to export (a ViewSheetSet in the model). Allowlist-validated. */
  sheetSetName: string;
  /** Absolute output .pdf path. `validateCadPath`-style validated. */
  outputPath: string;
}

export interface RevitExportIfcInput {
  /** Absolute output .ifc path. */
  outputPath: string;
}

export type RevitParamTarget = 'instance' | 'type';

export interface RevitSetParameterInput {
  /** How to locate the element whose parameter is set. */
  target: RevitParamTarget;
  /** ElementId (a positive integer) of the instance (or the instance whose type is edited when target='type'). */
  elementId: number;
  /** Parameter name (identifier/label allowlisted). */
  parameterName: string;
  /** New value (text/number/boolean → validated string, coerced to storage type in-script). */
  value: string | number | boolean;
}

export interface RevitExportScheduleCsvInput {
  /** Schedule view name to export. Allowlist-validated. */
  scheduleName: string;
  /** Absolute output .csv/.txt path. */
  outputPath: string;
}

// ── Validation result ────────────────────────────────────────────────────────

export type RevitArgsValidation =
  | { ok: true; operation: RevitScriptOperation; mutates: boolean; notes: string[] }
  | { ok: false; operation: RevitScriptOperation | null; error: string; notes: string[] };

function clampElementId(raw: unknown): { ok: true; id: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'elementId must be an integer' };
  // Revit ElementIds are positive; upper bound is generous but finite.
  if (n <= 0 || n > 9_000_000_000) return { ok: false, error: 'elementId must be a positive integer within range' };
  return { ok: true, id: n };
}

/**
 * Validate a bounded op + input WITHOUT generating a script. Pure gate that the
 * router/approval layer can call to preview whether a request is well-formed and
 * whether it mutates. Never throws; returns a typed error + notes on any problem.
 */
export function validateRevitArgs(operation: unknown, input: unknown): RevitArgsValidation {
  if (!isRevitScriptOperation(operation)) {
    return { ok: false, operation: null, error: `operation must be one of ${REVIT_SCRIPT_OPERATIONS.join(', ')}`, notes: [] };
  }
  const info = OPERATION_INFO[operation];
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const notes: string[] = [];

  if (operation === 'export_pdf') {
    const name = validateRevitName(record.sheetSetName, 'sheetSetName');
    if (!name.ok) return { ok: false, operation, error: name.error, notes };
    const out = validateRevitPath(record.outputPath, 'outputPath');
    if (!out.ok) return { ok: false, operation, error: out.error, notes };
    const ext = extensionOf(out.path);
    if (!info.outputExtensions.includes(ext)) {
      return { ok: false, operation, error: `outputPath must end in .${info.outputExtensions.join(' / .')} (got .${ext || '?'})`, notes };
    }
    return { ok: true, operation, mutates: false, notes };
  }

  if (operation === 'export_ifc') {
    const out = validateRevitPath(record.outputPath, 'outputPath');
    if (!out.ok) return { ok: false, operation, error: out.error, notes };
    const ext = extensionOf(out.path);
    if (!info.outputExtensions.includes(ext)) {
      return { ok: false, operation, error: `outputPath must end in .${info.outputExtensions.join(' / .')} (got .${ext || '?'})`, notes };
    }
    return { ok: true, operation, mutates: false, notes };
  }

  if (operation === 'export_schedule_csv') {
    const name = validateRevitName(record.scheduleName, 'scheduleName');
    if (!name.ok) return { ok: false, operation, error: name.error, notes };
    const out = validateRevitPath(record.outputPath, 'outputPath');
    if (!out.ok) return { ok: false, operation, error: out.error, notes };
    const ext = extensionOf(out.path);
    if (!info.outputExtensions.includes(ext)) {
      return { ok: false, operation, error: `outputPath must end in .${info.outputExtensions.join(' / .')} (got .${ext || '?'})`, notes };
    }
    return { ok: true, operation, mutates: false, notes };
  }

  // operation === 'set_parameter' (MUTATION)
  const target = record.target === 'type' ? 'type' : record.target === 'instance' ? 'instance' : null;
  if (!target) return { ok: false, operation, error: "target must be 'instance' or 'type'", notes };
  const id = clampElementId(record.elementId);
  if (!id.ok) return { ok: false, operation, error: id.error, notes };
  const paramName = validateRevitName(record.parameterName, 'parameterName');
  if (!paramName.ok) return { ok: false, operation, error: paramName.error, notes };
  const value = validateRevitParamValue(record.value);
  if (!value.ok) return { ok: false, operation, error: value.error, notes };
  notes.push(boundNote('set_parameter MUTATES the model: requires approvals.request before running and executes inside a Revit Transaction (RollBack on failure).'));
  return { ok: true, operation, mutates: true, notes };
}

// ── Script build result ────────────────────────────────────────────────────────

export type RevitScriptBuild =
  | {
      ok: true;
      operation: RevitScriptOperation;
      /** True for set_parameter — caller MUST gate on approval before running. */
      mutates: boolean;
      python: string;
      suggestedScriptFileName: string;
      /** Expected produced file for exports, else null. */
      expectedOutputPath: string | null;
      notes: string[];
    }
  | { ok: false; operation: RevitScriptOperation | null; error: string; notes: string[] };

// Shared script preamble: reach the active Document from the host-injected
// `__revit__` (pyRevit / RPS / pyRevit CLI all inject it). Fails closed with the
// error sentinel if no document is open. Kept ASCII + IronPython-2.7-safe.
function revitPreambleLines(): string[] {
  return [
    '# -*- coding: utf-8 -*-',
    '# Generated by Underground Circle revitScriptAdapter. IronPython 2.7-safe.',
    '# VERIFY Revit API calls + pyRevit/RPS run mode + IronPython constraints on a real Revit install before wiring.',
    'import clr',
    'clr.AddReference("RevitAPI")',
    'from Autodesk.Revit.DB import *',
    '',
    'def _uc_fail(message):',
    `    print(${pythonStringLiteral(REVIT_ERROR_SENTINEL)} + message)`,
    '    raise SystemExit(1)',
    '',
    '# pyRevit / RevitPythonShell / pyRevit-CLI inject __revit__ (UIApplication).',
    'try:',
    '    uidoc = __revit__.ActiveUIDocument',
    '    doc = uidoc.Document',
    'except Exception:',
    '    _uc_fail("no active Revit UIApplication/document (run inside pyRevit or RevitPythonShell)")',
    'if doc is None:',
    '    _uc_fail("no active Revit document is open")',
    '',
  ];
}

/**
 * Generate the Revit Python source for a bounded operation. Every user value is
 * validated (see `validateRevitArgs`) and embedded ONLY via `pythonStringLiteral`
 * — never concatenated raw. Read-only exports emit no Transaction; set_parameter
 * wraps the write in a `Transaction` (Commit / RollBack) and sets `mutates:true`
 * plus an approval note. Degenerate input returns a typed error and never throws.
 */
export function buildRevitScript(operation: unknown, input: unknown): RevitScriptBuild {
  const validation = validateRevitArgs(operation, input);
  if (!validation.ok) return { ok: false, operation: validation.operation, error: validation.error, notes: validation.notes };

  const op = validation.operation;
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  if (op === 'export_pdf') {
    // Re-validate for the narrowed literals (validateRevitArgs already passed).
    const sheetSet = validateRevitName(record.sheetSetName, 'sheetSetName');
    const out = validateRevitPath(record.outputPath, 'outputPath');
    if (!sheetSet.ok || !out.ok) return { ok: false, operation: op, error: 'export_pdf inputs failed re-validation', notes: [] };
    const dirLiteral = pythonStringLiteral(out.path.replace(/[\\/][^\\/]*$/, '') || out.path);
    const fileStemLiteral = pythonStringLiteral((out.path.split(/[\\/]/).pop() || 'export').replace(/\.pdf$/i, ''));
    const python = [
      ...revitPreambleLines(),
      `SHEET_SET_NAME = ${pythonStringLiteral(sheetSet.name)}`,
      `OUTPUT_DIR = ${dirLiteral}`,
      `OUTPUT_FILE_STEM = ${fileStemLiteral}`,
      '',
      '# Locate the named ViewSheetSet.',
      'sheet_set = None',
      'collector = FilteredElementCollector(doc).OfClass(ViewSheetSet)',
      'for candidate in collector:',
      '    if candidate.Name == SHEET_SET_NAME:',
      '        sheet_set = candidate',
      '        break',
      'if sheet_set is None:',
      '    _uc_fail("sheet set not found: " + SHEET_SET_NAME)',
      '',
      '# Read-only export: no Transaction (PDF export does not mutate the model).',
      'options = PDFExportOptions()',
      'options.FileName = OUTPUT_FILE_STEM',
      'options.Combine = True',
      'try:',
      '    doc.Export(OUTPUT_DIR, sheet_set.Views, options)',
      'except Exception, err:',  // IronPython 2.7 except syntax
      '    _uc_fail("PDF export failed: " + str(err))',
      `print(${pythonStringLiteral(REVIT_RESULT_SENTINEL)} + "export_pdf ok set=" + SHEET_SET_NAME)`,
      '',
    ].join('\n');
    return {
      ok: true,
      operation: op,
      mutates: false,
      python,
      suggestedScriptFileName: 'uc-revit-export-pdf.py',
      expectedOutputPath: out.path,
      notes: [
        boundNote('Read-only PDF export (no Transaction). PDFExportOptions is Revit 2022+; on older builds the PrintManager path is required — VERIFY on the target install.'),
        boundNote('Stat-verify the produced .pdf after the run (bridge desktop.file_stat) as proof — the script does not read files back.'),
      ],
    };
  }

  if (op === 'export_ifc') {
    const out = validateRevitPath(record.outputPath, 'outputPath');
    if (!out.ok) return { ok: false, operation: op, error: 'export_ifc inputs failed re-validation', notes: [] };
    const dirLiteral = pythonStringLiteral(out.path.replace(/[\\/][^\\/]*$/, '') || out.path);
    const fileNameLiteral = pythonStringLiteral(out.path.split(/[\\/]/).pop() || 'model.ifc');
    const python = [
      ...revitPreambleLines(),
      `OUTPUT_DIR = ${dirLiteral}`,
      `OUTPUT_FILE_NAME = ${fileNameLiteral}`,
      '',
      '# Read-only export: IFC export reads the model, it does not mutate it.',
      'options = IFCExportOptions()',
      'try:',
      '    doc.Export(OUTPUT_DIR, OUTPUT_FILE_NAME, options)',
      'except Exception, err:',
      '    _uc_fail("IFC export failed: " + str(err))',
      `print(${pythonStringLiteral(REVIT_RESULT_SENTINEL)} + "export_ifc ok file=" + OUTPUT_FILE_NAME)`,
      '',
    ].join('\n');
    return {
      ok: true,
      operation: op,
      mutates: false,
      python,
      suggestedScriptFileName: 'uc-revit-export-ifc.py',
      expectedOutputPath: out.path,
      notes: [
        boundNote('Read-only IFC export (no Transaction). IFCExportOptions defaults to the active IFC scheme — VERIFY the scheme/version on the target install.'),
        boundNote('Stat-verify the produced .ifc after the run as proof.'),
      ],
    };
  }

  if (op === 'export_schedule_csv') {
    const schedule = validateRevitName(record.scheduleName, 'scheduleName');
    const out = validateRevitPath(record.outputPath, 'outputPath');
    if (!schedule.ok || !out.ok) return { ok: false, operation: op, error: 'export_schedule_csv inputs failed re-validation', notes: [] };
    const dirLiteral = pythonStringLiteral(out.path.replace(/[\\/][^\\/]*$/, '') || out.path);
    const fileNameLiteral = pythonStringLiteral(out.path.split(/[\\/]/).pop() || 'schedule.csv');
    const python = [
      ...revitPreambleLines(),
      `SCHEDULE_NAME = ${pythonStringLiteral(schedule.name)}`,
      `OUTPUT_DIR = ${dirLiteral}`,
      `OUTPUT_FILE_NAME = ${fileNameLiteral}`,
      '',
      '# Locate the named ViewSchedule.',
      'schedule_view = None',
      'collector = FilteredElementCollector(doc).OfClass(ViewSchedule)',
      'for candidate in collector:',
      '    if candidate.Name == SCHEDULE_NAME:',
      '        schedule_view = candidate',
      '        break',
      'if schedule_view is None:',
      '    _uc_fail("schedule view not found: " + SCHEDULE_NAME)',
      '',
      '# Read-only export: ViewSchedule.Export writes delimited text, no Transaction.',
      'options = ViewScheduleExportOptions()',
      'try:',
      '    schedule_view.Export(OUTPUT_DIR, OUTPUT_FILE_NAME, options)',
      'except Exception, err:',
      '    _uc_fail("schedule export failed: " + str(err))',
      `print(${pythonStringLiteral(REVIT_RESULT_SENTINEL)} + "export_schedule_csv ok schedule=" + SCHEDULE_NAME)`,
      '',
    ].join('\n');
    return {
      ok: true,
      operation: op,
      mutates: false,
      python,
      suggestedScriptFileName: 'uc-revit-export-schedule-csv.py',
      expectedOutputPath: out.path,
      notes: [
        boundNote('Read-only schedule export (no Transaction). ViewSchedule.Export writes tab/comma-delimited text; the delimiter is set in ViewScheduleExportOptions — VERIFY on the target install.'),
        boundNote('Stat-verify the produced file after the run as proof.'),
      ],
    };
  }

  // op === 'set_parameter' (MUTATION — Transaction + approval)
  const target = record.target === 'type' ? 'type' : 'instance';
  const id = clampElementId(record.elementId);
  const paramName = validateRevitName(record.parameterName, 'parameterName');
  const value = validateRevitParamValue(record.value);
  if (!id.ok || !paramName.ok || !value.ok) {
    return { ok: false, operation: op, error: 'set_parameter inputs failed re-validation', notes: [] };
  }
  const python = [
    ...revitPreambleLines(),
    // ElementId embedded as an integer LITERAL derived from a validated integer
    // (never from user text) — but built from the numeric value, not string
    // concatenation of raw input.
    `ELEMENT_ID = ${id.id}`,
    `PARAMETER_NAME = ${pythonStringLiteral(paramName.name)}`,
    `NEW_VALUE = ${pythonStringLiteral(value.value)}`,
    `EDIT_TYPE = ${target === 'type' ? 'True' : 'False'}`,
    '',
    'element = doc.GetElement(ElementId(ELEMENT_ID))',
    'if element is None:',
    '    _uc_fail("element not found for id: " + str(ELEMENT_ID))',
    'if EDIT_TYPE:',
    '    type_id = element.GetTypeId()',
    '    if type_id is None or type_id == ElementId.InvalidElementId:',
    '        _uc_fail("element has no editable type")',
    '    element = doc.GetElement(type_id)',
    '    if element is None:',
    '        _uc_fail("type element not found")',
    '',
    'param = element.LookupParameter(PARAMETER_NAME)',
    'if param is None:',
    '    _uc_fail("parameter not found: " + PARAMETER_NAME)',
    'if param.IsReadOnly:',
    '    _uc_fail("parameter is read-only: " + PARAMETER_NAME)',
    '',
    '# MUTATION - wrap the write in a Transaction (Commit on success, RollBack on failure).',
    'transaction = Transaction(doc, "UC set parameter")',
    'transaction.Start()',
    'try:',
    '    storage = param.StorageType',
    '    if storage == StorageType.Double:',
    '        param.Set(float(NEW_VALUE))',
    '    elif storage == StorageType.Integer:',
    '        param.Set(int(float(NEW_VALUE)))',
    '    elif storage == StorageType.ElementId:',
    '        param.Set(ElementId(int(float(NEW_VALUE))))',
    '    else:',
    '        param.Set(NEW_VALUE)',  // StorageType.String — NEW_VALUE is a safe unicode literal
    '    transaction.Commit()',
    'except Exception, err:',
    '    transaction.RollBack()',
    '    _uc_fail("set parameter failed (rolled back): " + str(err))',
    `print(${pythonStringLiteral(REVIT_RESULT_SENTINEL)} + "set_parameter ok id=" + str(ELEMENT_ID) + " param=" + PARAMETER_NAME)`,
    '',
  ].join('\n');
  return {
    ok: true,
    operation: op,
    mutates: true,
    python,
    suggestedScriptFileName: 'uc-revit-set-parameter.py',
    expectedOutputPath: null,
    notes: [
      boundNote('MUTATION: requires approvals.request before running (docs/apps/revit.md: BIM parameter mutation is high risk).'),
      boundNote('Runs inside a Revit Transaction — Commit on success, RollBack on failure. Verify element/parameter identity once before, and re-read the parameter after as proof.'),
      boundNote('Worksharing note: a workshared model may need the element checked out / synced separately — VERIFY the worksharing state before acting.'),
    ],
  };
}

// ── Reported (not registered) appScriptRunner engine descriptor ────────────────
// Revit is intentionally NOT added to `src/lib/appScriptRunner.ts` here (that
// file is out of this task's edit scope). This is the descriptor the owner would
// register there. Two shared needs the runner does NOT yet express are called
// out in the module header comment and in the task report:
//   1. the runner has no per-engine "mutates / requires-approval" flag — Revit's
//      set_parameter needs the approval gate BEFORE the run, which the current
//      AppScriptEngineDescriptor shape does not carry; and
//   2. Revit's host is not a plain CLI: pyRevit CLI (`pyrevit run <script> <model>`)
//      OR RevitPythonShell need a run-mode the current `buildArgs` (binary +
//      argv) shape approximates but has not verified.
export interface ReportedRevitEngineDescriptor {
  id: 'revit_python';
  label: string;
  platform: 'windows';
  sourceExtensions: readonly string[];
  outputExtensions: readonly string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  verifiedInvocation: false;
  /** Extra flag the current AppScriptEngineDescriptor lacks — see header. */
  requiresApprovalForMutation: true;
  verifyNote: string;
}

/**
 * The engine descriptor Revit WOULD need in `appScriptRunner.ts`, returned for
 * the caller to register (NOT wired here). `verifiedInvocation:false` gates any
 * live wiring exactly like the seed engines.
 */
export function describeRevitEngineDescriptor(): ReportedRevitEngineDescriptor {
  return {
    id: 'revit_python',
    label: 'Autodesk Revit (pyRevit / RevitPythonShell IronPython 2.7)',
    platform: 'windows',
    sourceExtensions: ['py'],
    // Exports write files the script names; set_parameter writes nothing.
    // The runner stat-verifies the expected output where present.
    outputExtensions: ['pdf', 'ifc', 'csv', 'txt'],
    defaultTimeoutMs: 180_000,
    maxTimeoutMs: 600_000,
    verifiedInvocation: false,
    requiresApprovalForMutation: true,
    verifyNote:
      'VERIFY Revit API calls + pyRevit/RPS run mode + IronPython constraints on a real Revit install before wiring. Revit is Windows-only and reachable only through a connected Windows-host agent (docs/apps/revit.md).',
  };
}
