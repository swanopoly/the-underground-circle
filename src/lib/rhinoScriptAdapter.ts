// rhinoScriptAdapter — PURE generator that turns a bounded op request into a
// validated McNeel Rhino 3D `rhinoscriptsyntax` Python script to run via the
// RhinoCode CLI: `rhinocode script <script.py>`.
//
// VERIFY the invocation + every rhinoscriptsyntax call on a real Rhino 8
// install before wiring. Chosen control surface (docs/apps/rhino.md control
// surface #1, `rhino_common_api`, rank 100): Rhino 8 ships the `rhinocode`
// command-line utility (Rhino >= 8.11, binary in
// `/Applications/Rhino 8.app/Contents/Resources/bin`) which runs a Python
// script inside a RUNNING Rhino instance via `rhinocode script <path>`. It is
// NOT truly headless on this Mac — the script server must be started first
// (`StartScriptServer` inside Rhino), and true headless Rhino (Rhino.Compute /
// Rhino.Inside) is Windows/Linux ONLY. The alternative `Rhino.exe
// /runscript="-_RunPythonScript ..."` launch form is Windows-only (the McNeel
// "Running Rhino from the Command Line" guide is marked Windows only). rhino3dm
// (headless geometry SDK) can read/write .3dm with no Rhino at all, but it is a
// different SDK with a different API surface and does not run `rhinoscriptsyntax`
// commands, so it is out of scope for THIS generator. So this module targets the
// RhinoCode CLI + `rhinoscriptsyntax` — the profile's top-ranked lane that runs
// real Rhino commands on Mac.
//   Doc-verified invocation: `rhinocode script <script.py>`
//   Doc source: https://developer.rhino3d.com/guides/scripting/advanced-cli/
// The exact `rs.Command` / export-filter / rhinoscriptsyntax flag forms below
// follow the documented API shapes but were NOT freshly verified against a live
// install — every generated script carries a `# VERIFY` banner and every
// descriptor field is conservative. This module is the PURE generator only: it
// is NOT wired to any tool or bridge, never touches the filesystem, never spawns
// rhinocode, and never resolves a binary. Rhino is NOT in the appScriptRunner
// engine registry — see the descriptor reported in the task summary for the
// shape a future wiring commit would add.
//
// PURITY: zero runtime imports (`import type` only, and none are needed), so
// `npx tsx scripts/rhino-script-adapter-smoketest.ts` loads it directly.
//
// SECURITY (mirrors src/lib/mayaScriptAdapter.ts / cadCodeExecutor.ts exactly):
// every user value — input .3dm path, output path, export/target format, script
// body — is allowlist-validated FIRST, then embedded into the generated Python
// ONLY as an escaped string literal via `pythonStringLiteral` (JSON.stringify +
// non-ASCII -> \uXXXX; Rhino 8 ScriptEditor Python is CPython so this applies
// directly). User input is NEVER raw-concatenated into script text. Paths pass a
// validateRhinoPath check (length / control-char / shell-metachar / BMP /
// traversal). Formats pass an enum allowlist. There is DOUBLE containment for
// paths that reach a Rhino command string: the path is emitted as a Python
// literal AND, inside Python, wrapped in `chr(34)` quotes when concatenated into
// a `_-Export` / `_-Import` command — so it never terminates the command line
// early. The `run_python_script` body is NOT a free-form escape hatch: it is
// restricted to a conservative rhinoscriptsyntax-statement allowlist (rs.* / def
// / import rhinoscriptsyntax / print / bounded control words) with a hard reject
// of dangerous tokens (os./sys./subprocess/eval/exec/open/import-of-anything-
// -else/dunder/backtick/etc). On any validation failure the builder DROPS the
// request with an explanatory note and a fail-closed script stub — it never
// throws and never emits a half-validated mutation.
//
// APPROVAL/PROOF (docs/apps/rhino.md approval & evidence rules): exports and any
// state-changing script WRITE files / mutate the model, so the wiring layer must
// approval-gate them (review/high risk per runbook) and verify each output with
// desktop.file_stat (+ command transcript / screenshot) after the run. Scripts
// NEVER save over the source .3dm. Model units must be verified before an act,
// and target objects/layers named or selected with proof — the notes say so.

// ── Operations ─────────────────────────────────────────────────────────────

export type RhinoOperation =
  | 'export_format'
  | 'run_python_script'
  | 'batch_convert'
  | 'extract_geometry_report';

export const RHINO_OPERATIONS: readonly RhinoOperation[] = [
  'export_format',
  'run_python_script',
  'batch_convert',
  'extract_geometry_report',
] as const;

/** Geometry/CAD formats `_-Export` can write from a .3dm (the export allowlist). */
export type RhinoExportFormat = 'step' | 'stl' | 'obj' | 'dwg';

export const RHINO_EXPORT_FORMATS: readonly RhinoExportFormat[] = ['step', 'stl', 'obj', 'dwg'] as const;

/** File extension produced per export format. STEP writes the .step container
 *  (.stp is a common alias but we pin one extension to keep the check strict). */
const RHINO_EXPORT_EXTENSION: Record<RhinoExportFormat, string> = {
  step: 'step',
  stl: 'stl',
  obj: 'obj',
  dwg: 'dwg',
};

export const RHINO_SCRIPT_EXTENSION = 'py' as const;

/** The ONLY source container this generator opens: native Rhino .3dm. */
const RHINO_SCENE_INPUT_EXTENSIONS: readonly string[] = ['3dm'];

// A run_python_script body has a hard length cap so an oversized/obfuscated blob
// cannot slip past the token scan by sheer volume, and so the emitted literal
// stays bounded.
export const RHINO_SCRIPT_BODY_MAX = 4000;

// ── Path validation (pure mirror of mayaScriptAdapter.validateMayaPath) ───────
// LOCKSTEP intent: byte-identical reject-set to mayaScriptAdapter.validateMayaPath
// / cadCodeExecutor.validateCadPath / appScriptRunner.validateRunnerPath / the
// bridge's validateDesktopPathServer, PLUS the ".." traversal reject. A path that
// passes here must not fail a downstream validator for a different reason. Non-BMP
// code points are rejected because paths are embedded in generated Python string
// literals via \uXXXX escapes (lone surrogates are not encodable).
function validateRhinoPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
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
        error:
          'path contains characters outside the basic multilingual plane (cannot be embedded safely in a generated Python literal)',
      };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: 'path must not contain ".." traversal' };
  return { ok: true, path: trimmed };
}

/**
 * Emit a value as a Python 3 string literal. IDENTICAL technique to
 * mayaScriptAdapter.pythonStringLiteral / cadCodeExecutor.pythonStringLiteral:
 * JSON.stringify (double-quoted, backslash/quote/control escaped) then escape
 * every non-ASCII char to \uXXXX so the generated script is pure ASCII. Rhino 8
 * ScriptEditor Python is CPython, so a JSON string literal is a valid Python
 * string literal for BMP text. `validateRhinoPath` rejects non-BMP code points,
 * so surrogate escapes never reach Python. User values are NEVER concatenated
 * raw into script text — they only ever pass through here.
 */
function pythonStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeExportFormat(raw: unknown): RhinoExportFormat | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (RHINO_EXPORT_FORMATS as readonly string[]).includes(value) ? (value as RhinoExportFormat) : null;
}

/**
 * Validate a run_python_script BODY. This is the load-bearing gate for the one
 * op that carries free-ish user code, so it is deliberately strict: the body is
 * scanned line-by-line and MUST be built only from a conservative
 * rhinoscriptsyntax vocabulary. Anything that could touch the OS, the network,
 * the filesystem outside Rhino, or Python's dynamic-exec machinery is rejected.
 * Never throws; returns ok:false + reason on any rejection.
 *
 * The point is NOT to be a full Python sandbox (it cannot be) — it is to make
 * the ONLY thing this op can emit be a bounded rhinoscriptsyntax snippet, and to
 * fail closed on anything outside that vocabulary. The result string, when ok,
 * is emitted as a Python literal and `exec`-free: it is written into the script
 * verbatim ONLY after passing this scan (see buildRhinoScript for how it is
 * placed inside a function body, never via eval/exec).
 */
function validateScriptBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'script body must be a string' };
  const body = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!body.trim()) return { ok: false, error: 'script body is empty' };
  if (body.length > RHINO_SCRIPT_BODY_MAX) {
    return { ok: false, error: `script body exceeds ${RHINO_SCRIPT_BODY_MAX} chars` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body)) {
    return { ok: false, error: 'script body contains control characters (only newline/tab allowed)' };
  }
  for (const ch of body) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: 'script body contains characters outside the basic multilingual plane' };
    }
  }
  // Hard-reject dangerous tokens anywhere in the body. Word-boundary so `rs.` and
  // rhinoscriptsyntax names are unaffected; `__` catches every dunder.
  const forbidden: Array<[RegExp, string]> = [
    [/__[A-Za-z0-9_]*__/, 'dunder attribute'],
    [/\beval\b/, 'eval'],
    [/\bexec\b/, 'exec'],
    [/\bcompile\b/, 'compile'],
    [/\bopen\b/, 'open()'],
    [/\bos\b/, 'os module'],
    [/\bsys\b/, 'sys module'],
    [/\bsubprocess\b/, 'subprocess'],
    [/\bsocket\b/, 'socket'],
    [/\bshutil\b/, 'shutil'],
    [/\bpathlib\b/, 'pathlib'],
    [/\bimportlib\b/, 'importlib'],
    [/\brequests\b/, 'requests'],
    [/\burllib\b/, 'urllib'],
    [/\bglobals\b/, 'globals()'],
    [/\blocals\b/, 'locals()'],
    [/\bgetattr\b/, 'getattr'],
    [/\bsetattr\b/, 'setattr'],
    [/\bvars\b/, 'vars()'],
    [/\binput\b/, 'input()'],
    [/[`$;|&<>]/, 'shell metacharacter'],
    [/\\x[0-9a-fA-F]{2}/, 'hex escape'],
  ];
  for (const [re, label] of forbidden) {
    if (re.test(body)) return { ok: false, error: `script body contains a forbidden token (${label})` };
  }
  // Every non-blank, non-comment line must start with an allowlisted lead token.
  // This is what keeps the body inside the rhinoscriptsyntax vocabulary. The only
  // permitted import is rhinoscriptsyntax itself.
  const allowedLead =
    /^(rs\.|rs\b|print\(|print\b|import\s+rhinoscriptsyntax\b|from\s+rhinoscriptsyntax\b|def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|return\b|if\b|elif\b|else\b|for\b|while\b|in\b|and\b|or\b|not\b|pass\b|continue\b|break\b|True\b|False\b|None\b|[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)|[0-9"'([{])/;
  const lines = body.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!allowedLead.test(line)) {
      return {
        ok: false,
        error: `script body line is outside the rhinoscriptsyntax allowlist: "${line.slice(0, 48)}"`,
      };
    }
  }
  return { ok: true, body };
}

// ── Public request/result contracts ──────────────────────────────────────────

export interface RhinoExportFormatInput {
  /** Absolute .3dm model to open read-only (validated). */
  modelPath: string;
  /** Absolute file path the export is written to (validated; NEW file). */
  outputPath: string;
  /** STEP / STL / OBJ / DWG — must match the outputPath extension. */
  format: RhinoExportFormat;
}

export interface RhinoRunPythonScriptInput {
  /** Absolute .3dm model to open read-only (validated). */
  modelPath: string;
  /** rhinoscriptsyntax snippet (allowlist-validated; NO os/sys/exec/etc). */
  scriptBody: string;
}

export interface RhinoBatchConvertInput {
  /** Absolute .3dm model to open read-only (validated). */
  modelPath: string;
  /** Absolute file path the converted copy is written to (validated; NEW file). */
  outputPath: string;
  /** STEP / STL / OBJ / DWG — must match the outputPath extension. */
  format: RhinoExportFormat;
}

export interface RhinoExtractGeometryReportInput {
  /** Absolute .3dm model to open read-only (validated). */
  modelPath: string;
  /** Absolute .txt/.json file path the report is written to (validated; NEW file). */
  outputPath: string;
}

export type RhinoOperationInput =
  | RhinoExportFormatInput
  | RhinoRunPythonScriptInput
  | RhinoBatchConvertInput
  | RhinoExtractGeometryReportInput;

export interface RhinoScriptResult {
  /** The generated Python source. On validation failure this is a fail-closed
   *  stub that exits with a UC_RHINO_ERROR sentinel and mutates nothing. */
  script: string;
  scriptExtension: typeof RHINO_SCRIPT_EXTENSION;
  /** The file the script writes, when the path validated. */
  outputHint?: string;
  notes: string[];
  /** True when the request validated into a real operation script. */
  ok: boolean;
}

export interface RhinoArgsValidation {
  ok: boolean;
  /** Normalized, safe-to-embed values (present only when ok). */
  normalized?: Record<string, string>;
  /** Human-readable reasons any input was rejected (drop-with-note). */
  notes: string[];
}

const RHINO_ERROR_SENTINEL = 'UC_RHINO_ERROR';
const RHINO_DONE_SENTINEL = 'UC_RHINO_DONE';

// ── Operation-gap tool constant + doc-verified invocation ─────────────────────

/**
 * The connected-agent buildout tool a wiring commit would request when the exact
 * RhinoCode CLI runner / rhinoscriptsyntax command shape is NOT available on the
 * live install (docs/apps/rhino.md gaps: the `rhinocode` CLI executor is the
 * highest-value buildout). Chat surfaces this instead of guessing an invocation.
 */
export const RHINO_OPERATION_GAP_TOOL = 'agent.build_app_capability' as const;

/**
 * Doc-verified RhinoCode CLI invocation. `verifiedInvocation:false` because the
 * command shape is confirmed against current McNeel docs but was NOT run against
 * a live Rhino 8 install by this module, and the module is not wired to any
 * runner. Marked with a // VERIFY marker per the LOCKSTEP rules.
 */
export const RHINO_INVOCATION = {
  // VERIFY on a real Rhino 8 (>=8.11) install before wiring: run `rhinocode -V`,
  // `StartScriptServer` inside a running Rhino, then `rhinocode script <path>`.
  surface: 'rhino_common_api',
  runner: 'rhinocode',
  /** The exact doc-verified command form. `{script}` is the staged .py path. */
  commandTemplate: 'rhinocode script {script}',
  /** macOS binary directory (add to PATH). Windows uses %PROGRAMFILES%\\Rhino 8\\System. */
  macBinDir: '/Applications/Rhino 8.app/Contents/Resources/bin',
  minRhinoVersion: '8.11',
  /** RhinoCode drives a RUNNING Rhino via a script server — NOT truly headless. */
  requiresRunningRhinoScriptServer: true,
  startServerCommand: 'StartScriptServer',
  /** True headless Rhino (Rhino.Compute / Rhino.Inside) is Windows/Linux only. */
  headlessOnMac: false,
  osConstraint:
    'RhinoCode CLI drives a running Rhino 8 (>=8.11) via StartScriptServer; runs cross-platform incl. macOS but is NOT headless. Rhino.exe /runscript launch form and true headless Rhino.Compute are Windows/Linux only.',
  verifiedInvocation: false,
  docSource: 'https://developer.rhino3d.com/guides/scripting/advanced-cli/',
} as const;

// Shared banner every generated Rhino script carries. The // VERIFY marker is
// intentionally inside the generated Python (as a #-comment) so a human
// reviewing a staged .py sees the unverified-API warning before running it.
const SCRIPT_BANNER = [
  '# Generated by Underground Circle rhinoScriptAdapter - run via the RhinoCode',
  '# CLI: `rhinocode script <this-script.py>` (Rhino 8 >=8.11; run',
  '# StartScriptServer inside a RUNNING Rhino first). NOT headless on Mac.',
  '# VERIFY the rhinocode invocation + every rhinoscriptsyntax call on a real',
  '# Rhino 8 install before wiring: entry points follow documented shapes but',
  '# are unverified. Doc: https://developer.rhino3d.com/guides/scripting/advanced-cli/',
];

/**
 * Standard preamble: import rhinoscriptsyntax as rs, resolve/verify the source
 * .3dm exists, and (best-effort) verify document model units are known before
 * any act (docs/apps/rhino.md required evidence). The script opens the source
 * read-only via `_-Open` in a command wrapper; it NEVER `_-Save`s over it.
 *
 * // VERIFY the exact `_-Open` / document-state command forms and whether the
 * RhinoCode script server opens into a fresh doc vs the active doc on the target
 * Rhino version before trusting this with unknown-origin models.
 */
function preambleLines(modelLiteral: string): string[] {
  return [
    'import rhinoscriptsyntax as rs',
    '',
    'def _main():',
    `    MODEL_PATH = ${modelLiteral}`,
    '    # rs.Command uses chr(34) to wrap the path in double quotes so a path',
    '    # with spaces cannot terminate the Rhino command line early.',
    '    q = chr(34)',
    '    opened = rs.Command(q + "_-Open " + q + MODEL_PATH + q + q, False)',
    '    if not opened:',
    `        raise RuntimeError("${RHINO_ERROR_SENTINEL}: could not open model (verify it exists and is a .3dm)")`,
    '    units = rs.UnitSystemName(False, False, False)',
    '    if not units:',
    `        raise RuntimeError("${RHINO_ERROR_SENTINEL}: model units are unknown - fail closed before acting")`,
  ];
}

/** Standard trailer: print the done sentinel, wrap _main() in try/except so any
 *  failure exits nonzero with the error sentinel and mutates nothing further. */
function scriptTrailerLines(doneExpression: string): string[] {
  return [
    `    report = "${RHINO_DONE_SENTINEL}: " + ${doneExpression}`,
    '    print(report)',
    '    return report',
    '',
    'def main():',
    '    import sys',
    '    import traceback',
    '    try:',
    '        _main()',
    '    except Exception:',
    `        print("${RHINO_ERROR_SENTINEL}: " + traceback.format_exc())`,
    '        sys.exit(1)',
    '',
    "if __name__ == '__main__':",
    '    main()',
    '',
  ];
}

/** Fail-closed stub: a syntactically valid script that mutates nothing, never
 *  imports rhinoscriptsyntax, opens no model, and exits nonzero with the error
 *  sentinel + the (bounded, plain-text) reason. */
function failClosedScript(reason: string): string {
  const safeReason = pythonStringLiteral(String(reason || 'invalid request').slice(0, 300));
  return [
    ...SCRIPT_BANNER,
    '# FAIL-CLOSED STUB: the request did not validate; this script mutates',
    '# nothing, never imports rhinoscriptsyntax, opens no model, and exits',
    '# nonzero so no partial operation can run.',
    'import sys',
    '',
    'def main():',
    `    message = "${RHINO_ERROR_SENTINEL}: " + ${safeReason}`,
    '    print(message)',
    '    sys.exit(1)',
    '',
    "if __name__ == '__main__':",
    '    main()',
    '',
  ].join('\n');
}

// ── validateRhinoArgs ─────────────────────────────────────────────────────────

/**
 * Allowlist-validate an operation's inputs into safe, normalized string values.
 * Never throws; returns ok:false + notes on any rejection. This is the single
 * gate every user value passes before it can reach `pythonStringLiteral`.
 */
export function validateRhinoArgs(op: unknown, input: unknown): RhinoArgsValidation {
  const notes: string[] = [];
  if (!(RHINO_OPERATIONS as readonly string[]).includes(op as string)) {
    return { ok: false, notes: [`Unknown Rhino operation "${String(op).slice(0, 40)}".`] };
  }
  const operation = op as RhinoOperation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  // Every op opens a source .3dm model — validate it first, uniformly.
  const model = validateRhinoPath(record.modelPath);
  if (!model.ok) {
    notes.push(`modelPath: ${model.error}.`);
    return { ok: false, notes };
  }
  const modelExt = extensionOf(model.path);
  if (!RHINO_SCENE_INPUT_EXTENSIONS.includes(modelExt)) {
    notes.push(`modelPath must be a Rhino model (.3dm; got .${modelExt || '?'}).`);
    return { ok: false, notes };
  }

  if (operation === 'export_format' || operation === 'batch_convert') {
    const format = normalizeExportFormat(record.format);
    if (!format) {
      notes.push(`${operation} format must be one of ${RHINO_EXPORT_FORMATS.join(', ')}.`);
      return { ok: false, notes };
    }
    const out = validateRhinoPath(record.outputPath);
    if (!out.ok) {
      notes.push(`${operation} outputPath: ${out.error}.`);
      return { ok: false, notes };
    }
    const ext = extensionOf(out.path);
    const expectedExt = RHINO_EXPORT_EXTENSION[format];
    if (ext !== expectedExt) {
      notes.push(`${operation} outputPath must end in .${expectedExt} for format ${format} (got .${ext || '?'}).`);
      return { ok: false, notes };
    }
    if (out.path === model.path) {
      notes.push(`${operation} outputPath must differ from the source model (never write over the source).`);
      return { ok: false, notes };
    }
    return { ok: true, normalized: { modelPath: model.path, outputPath: out.path, format }, notes };
  }

  if (operation === 'run_python_script') {
    const scriptBody = validateScriptBody(record.scriptBody);
    if (!scriptBody.ok) {
      notes.push(`run_python_script ${scriptBody.error}.`);
      return { ok: false, notes };
    }
    return { ok: true, normalized: { modelPath: model.path, scriptBody: scriptBody.body }, notes };
  }

  // operation === 'extract_geometry_report'
  const out = validateRhinoPath(record.outputPath);
  if (!out.ok) {
    notes.push(`extract_geometry_report outputPath: ${out.error}.`);
    return { ok: false, notes };
  }
  const reportExt = extensionOf(out.path);
  if (reportExt !== 'txt' && reportExt !== 'json') {
    notes.push(`extract_geometry_report outputPath must end in .txt or .json (got .${reportExt || '?'}).`);
    return { ok: false, notes };
  }
  if (out.path === model.path) {
    notes.push('extract_geometry_report outputPath must differ from the source model.');
    return { ok: false, notes };
  }
  return { ok: true, normalized: { modelPath: model.path, outputPath: out.path, reportFormat: reportExt }, notes };
}

// ── buildRhinoScript ────────────────────────────────────────────────────────────

/**
 * Turn a bounded op request into a validated Rhino `rhinoscriptsyntax` Python
 * script. All user values are validated by `validateRhinoArgs` FIRST and embedded
 * only via `pythonStringLiteral`. On any validation failure a fail-closed stub is
 * returned (ok:false) — never a partial mutation, never a throw. Every real
 * script imports rhinoscriptsyntax, opens the source read-only, verifies units,
 * and wraps work in try/except.
 */
export function buildRhinoScript(op: unknown, input: unknown): RhinoScriptResult {
  const validation = validateRhinoArgs(op, input);
  if (!validation.ok || !validation.normalized) {
    const reason = validation.notes[0] ?? 'invalid Rhino request';
    return {
      script: failClosedScript(reason),
      scriptExtension: RHINO_SCRIPT_EXTENSION,
      notes: validation.notes.length ? validation.notes : ['Request did not validate; emitted a fail-closed stub.'],
      ok: false,
    };
  }
  const operation = op as RhinoOperation;
  const values = validation.normalized;
  const notes = [...validation.notes];
  const modelLiteral = pythonStringLiteral(values.modelPath);

  if (operation === 'export_format' || operation === 'batch_convert') {
    const outputPath = values.outputPath;
    const format = values.format as RhinoExportFormat;
    const outputLiteral = pythonStringLiteral(outputPath);
    const label = operation === 'batch_convert' ? 'batch_convert' : 'export_format';
    // Select all objects, then run `_-Export "<path>"` via rs.Command. The path
    // is a Python literal AND wrapped in chr(34) quotes inside the command string
    // so it cannot terminate the Rhino command line early (double containment).
    // VERIFY the exact `_-Export` scheme/options prompts per format (STEP/STL/
    // OBJ/DWG each pop a distinct options dialog) on a live install.
    const script = [
      ...SCRIPT_BANNER,
      `# Operation: ${label} (${format.toUpperCase()}). Approval-gated export to a NEW file.`,
      ...preambleLines(modelLiteral),
      `    OUTPUT_PATH = ${outputLiteral}`,
      '    objs = rs.AllObjects(select=True, include_lights=False, include_grips=False)',
      '    if not objs:',
      `        raise RuntimeError("${RHINO_ERROR_SENTINEL}: model has no exportable objects")`,
      '    # _-Export the current selection; _Enter accepts the default format',
      '    # options dialog. // VERIFY the per-format option prompts on a live run.',
      '    cmd = q + "_-Export " + q + OUTPUT_PATH + q + q + " _Enter _Enter"',
      '    rs.Command(cmd, False)',
      '    if not rs.IsFile(OUTPUT_PATH):',
      `        raise RuntimeError("${RHINO_ERROR_SENTINEL}: export finished without creating the output file")`,
      ...scriptTrailerLines('("exported ' + format.toUpperCase() + ' -> " + OUTPUT_PATH)'),
    ].join('\n');
    notes.push(
      `Run via RhinoCode: rhinocode script ${'<staged-script>.py'} (Rhino 8 >=8.11, StartScriptServer running) — it opens ${values.modelPath} read-only and writes ${outputPath} (verify with desktop.file_stat after).`,
      'Approval-gated: this writes a NEW file and opens the model. It never saves over the source .3dm.',
      'Verify model units before trusting the export scale, and confirm target objects/layers (docs/apps/rhino.md evidence rules).',
      `NOT wired: the ${RHINO_INVOCATION.commandTemplate} invocation is doc-verified only (verifiedInvocation:false). Use ${RHINO_OPERATION_GAP_TOOL} to build the runner before executing.`,
    );
    return { script, scriptExtension: RHINO_SCRIPT_EXTENSION, outputHint: outputPath, notes, ok: true };
  }

  if (operation === 'run_python_script') {
    const scriptBody = values.scriptBody;
    // The body already passed the rhinoscriptsyntax allowlist scan. It is placed
    // verbatim inside the _main() function body (indented) — NEVER via eval/exec.
    // rhinoscriptsyntax (rs) is already imported by the preamble.
    const indentedBody = scriptBody
      .split('\n')
      .map((line) => (line.length ? `    ${line}` : ''))
      .join('\n');
    const script = [
      ...SCRIPT_BANNER,
      '# Operation: run_python_script. The body is restricted to an rhinoscriptsyntax',
      '# allowlist (rs.* / def / print / control words); os/sys/exec/open/subprocess',
      '# and dunders are rejected at validation. If it MUTATES the model or writes a',
      '# file it must be approval-gated + proof-verified. // VERIFY the rs.* calls.',
      ...preambleLines(modelLiteral),
      '    # ---- user rhinoscriptsyntax body (allowlist-validated) ----',
      indentedBody,
      '    # ---- end user body ----',
      ...scriptTrailerLines('"ran rhinoscriptsyntax body"'),
    ].join('\n');
    notes.push(
      `Run via RhinoCode: rhinocode script ${'<staged-script>.py'} (Rhino 8 >=8.11, StartScriptServer running) — it opens ${values.modelPath} then runs the validated rhinoscriptsyntax body.`,
      'The body is allowlist-validated (rhinoscriptsyntax vocabulary only; no os/sys/exec/open/subprocess/dunders) but any state-changing or file-writing snippet still needs approval + proof.',
      'It never saves over the source .3dm unless the body explicitly does so — treat body-driven writes as review/high risk.',
      `NOT wired: the ${RHINO_INVOCATION.commandTemplate} invocation is doc-verified only (verifiedInvocation:false). Use ${RHINO_OPERATION_GAP_TOOL} to build the runner before executing.`,
    );
    return { script, scriptExtension: RHINO_SCRIPT_EXTENSION, notes, ok: true };
  }

  // operation === 'extract_geometry_report'
  const outputPath = values.outputPath;
  const reportFormat = values.reportFormat; // 'txt' | 'json'
  const outputLiteral = pythonStringLiteral(outputPath);
  // A READ-only audit: count objects, gather the world bounding box + units, and
  // write a small report. This does not mutate the model. Writing the report file
  // is done with a plain Python write of a Python-built string (NOT rs.Command),
  // so no user text reaches a Rhino command line here. // VERIFY rs.ObjectsByType
  // / rs.BoundingBox return shapes on a live install.
  const isJson = reportFormat === 'json';
  const reportLines = [
    '    all_objs = rs.AllObjects(select=False, include_lights=False, include_grips=False) or []',
    '    count = len(all_objs)',
    '    bbox = rs.BoundingBox(all_objs) if count else None',
    '    if bbox:',
    '        xs = [p[0] for p in bbox]',
    '        ys = [p[1] for p in bbox]',
    '        zs = [p[2] for p in bbox]',
    '        dims = [round(max(xs) - min(xs), 6), round(max(ys) - min(ys), 6), round(max(zs) - min(zs), 6)]',
    '    else:',
    '        dims = [0, 0, 0]',
    isJson
      ? '    import json'
      : '    # plain-text report; no imports needed',
    isJson
      ? '    payload = json.dumps({"object_count": count, "units": units, "bbox_dimensions": dims}, indent=2)'
      : '    payload = "objects: " + str(count) + "\\nunits: " + str(units) + "\\nbbox: " + str(dims) + "\\n"',
    '    fh = open(OUTPUT_PATH, "w")',
    '    try:',
    '        fh.write(payload)',
    '    finally:',
    '        fh.close()',
    '    if not rs.IsFile(OUTPUT_PATH):',
    `        raise RuntimeError("${RHINO_ERROR_SENTINEL}: report write finished without creating the file")`,
  ];
  const script = [
    ...SCRIPT_BANNER,
    `# Operation: extract_geometry_report (${reportFormat.toUpperCase()}). READ-ONLY audit; writes a report file only.`,
    ...preambleLines(modelLiteral),
    `    OUTPUT_PATH = ${outputLiteral}`,
    ...reportLines,
    ...scriptTrailerLines('("wrote geometry report -> " + OUTPUT_PATH)'),
  ].join('\n');
  notes.push(
    `Run via RhinoCode: rhinocode script ${'<staged-script>.py'} (Rhino 8 >=8.11, StartScriptServer running) — it opens ${values.modelPath} read-only and writes a ${reportFormat.toUpperCase()} report at ${outputPath} (verify with desktop.file_stat after).`,
    'Read-only audit of the model geometry (object count, units, world bounding box). It does not mutate the model, but writing the report file is still a disk write — approval-gate per your write policy.',
    'Cite the reported units only after verifying the model units are known (docs/apps/rhino.md required evidence).',
    `NOT wired: the ${RHINO_INVOCATION.commandTemplate} invocation is doc-verified only (verifiedInvocation:false). Use ${RHINO_OPERATION_GAP_TOOL} to build the runner before executing.`,
  );
  return { script, scriptExtension: RHINO_SCRIPT_EXTENSION, outputHint: outputPath, notes, ok: true };
}

// ── describeRhinoOperation ────────────────────────────────────────────────────

/** One-line plain-language description for an approval preview / notice. Never
 *  throws — returns a generic line for unknown ops/inputs. */
export function describeRhinoOperation(op: unknown, input: unknown): string {
  if (!(RHINO_OPERATIONS as readonly string[]).includes(op as string)) {
    return 'Run a Rhino rhinoscriptsyntax script via the RhinoCode CLI (approval-gated)';
  }
  const operation = op as RhinoOperation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (operation === 'export_format') {
    const format = normalizeExportFormat(record.format);
    return `Export the Rhino model to ${format ? format.toUpperCase() : 'a file'} (RhinoCode CLI, approval-gated)`;
  }
  if (operation === 'batch_convert') {
    const format = normalizeExportFormat(record.format);
    return `Batch-convert the Rhino .3dm to ${format ? format.toUpperCase() : 'another format'} (RhinoCode CLI, approval-gated)`;
  }
  if (operation === 'run_python_script') {
    return 'Run an allowlisted rhinoscriptsyntax snippet in Rhino (RhinoCode CLI, approval-gated)';
  }
  const reportExt = extensionOf(String(record.outputPath ?? ''));
  return `Extract a read-only Rhino geometry report${reportExt === 'json' || reportExt === 'txt' ? ` (${reportExt.toUpperCase()})` : ''} (RhinoCode CLI)`;
}
